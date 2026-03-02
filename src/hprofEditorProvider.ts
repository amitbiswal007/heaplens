import * as vscode from 'vscode';
import * as fs from 'fs';
import { RustClient } from './rustClient';
import { getWebviewContent } from './webviewProvider';
import { AnalysisData, formatAnalysisContext } from './analysisContext';
import { streamLlmResponse, LlmConfig, ChatMessage } from './llmClient';
import { HEAP_ANALYSIS_SYSTEM_PROMPT, buildAnalyzePrompt } from './promptTemplates';
import { resolveSource } from './sourceResolver';
import type { DependencyInfo } from './dependencyResolver';

/** Per-editor state, keyed by hprof file path. */
interface EditorState {
    webviewPanel: vscode.WebviewPanel;
    analysisData: AnalysisData | null;
    chatHistory: ChatMessage[];
    pendingWebviewMessage: any;
    webviewReady: boolean;
    dependencyInfoCache: Map<string, { tier: string; dependency?: DependencyInfo }>;
}

/**
 * Custom readonly editor provider for .hprof files.
 *
 * When a user opens a .hprof file, this provider spawns the Rust server,
 * sends an analyze_heap request, and renders the tabbed analysis UI.
 */
export class HprofEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'heaplens.hprofEditor';

    private static readonly MAX_CHAT_HISTORY = 40; // 20 user + 20 assistant messages

    private rustClient: RustClient | null = null;
    private outputChannel: vscode.OutputChannel;
    /** Per-editor state keyed by hprof file path. */
    private editors = new Map<string, EditorState>();
    /** Tracks the most recently focused editor's hprof path. */
    private activeHprofPath: string | null = null;

    constructor(
        private readonly context: vscode.ExtensionContext,
        outputChannel: vscode.OutputChannel,
        private readonly getServerPath: () => string
    ) {
        this.outputChannel = outputChannel;
    }

    public async openCustomDocument(
        uri: vscode.Uri
    ): Promise<vscode.CustomDocument> {
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        return { uri, dispose: () => { /* no-op */ } };
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
        };

        const hprofPath = document.uri.fsPath;
        this.activeHprofPath = hprofPath;

        // Create per-editor state
        const editorState: EditorState = {
            webviewPanel,
            analysisData: null,
            chatHistory: [],
            pendingWebviewMessage: null,
            webviewReady: false,
            dependencyInfoCache: new Map()
        };
        this.editors.set(hprofPath, editorState);

        this.outputChannel.show(true);
        this.outputChannel.appendLine(`[HeapLens] Opening HPROF file: ${hprofPath}`);
        this.outputChannel.appendLine(`[HeapLens] File exists: ${fs.existsSync(hprofPath)}`);

        webviewPanel.webview.html = getWebviewContent(webviewPanel.webview);

        // Ensure Rust client is running
        const client = this.getOrCreateClient();
        if (!client) {
            this.outputChannel.appendLine('[HeapLens] ERROR: Failed to create Rust client');
            webviewPanel.webview.postMessage({
                command: 'error',
                message: 'Failed to start analysis server'
            });
            return;
        }
        this.outputChannel.appendLine('[HeapLens] Rust client created successfully');

        // Clean up when the editor tab is closed
        webviewPanel.onDidDispose(() => {
            this.outputChannel.appendLine(`[HeapLens] Editor disposed for: ${hprofPath}`);
            this.editors.delete(hprofPath);
            if (this.activeHprofPath === hprofPath) {
                this.activeHprofPath = null;
            }
        });

        // Wire webview <-> RustClient message passing
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            this.outputChannel.appendLine(`[HeapLens] Webview message: ${message.command}`);
            const state = this.editors.get(hprofPath);
            if (!state) { return; } // editor was disposed
            switch (message.command) {
                case 'getChildren':
                    this.outputChannel.appendLine(`[HeapLens] getChildren request for objectId: ${message.objectId}`);
                    try {
                        const children = await client.sendRequest('get_children', {
                            path: hprofPath,
                            object_id: message.objectId
                        });
                        this.outputChannel.appendLine(`[HeapLens] getChildren response: ${Array.isArray(children) ? children.length + ' children' : typeof children}`);
                        if (Array.isArray(children) && children.length > 0) {
                            this.outputChannel.appendLine(`[HeapLens] Sending childrenResponse with ${children.length} children`);
                            webviewPanel.webview.postMessage({
                                command: 'childrenResponse',
                                objectId: message.objectId,
                                children
                            });
                        } else {
                            this.outputChannel.appendLine(`[HeapLens] No children, sending noChildren`);
                            webviewPanel.webview.postMessage({
                                command: 'noChildren',
                                objectId: message.objectId,
                                message: 'This object has no children in the dominator tree'
                            });
                        }
                    } catch (error: any) {
                        this.outputChannel.appendLine(`[HeapLens] getChildren error: ${error.message}`);
                        webviewPanel.webview.postMessage({
                            command: 'noChildren',
                            objectId: message.objectId,
                            message: error.message?.includes('not found')
                                ? 'This object has no children'
                                : error.message || String(error)
                        });
                    }
                    break;
                case 'chatMessage':
                    this.handleChatMessage(message.text, hprofPath, webviewPanel);
                    break;
                case 'goToSource':
                    await this.handleGoToSource(message.className, hprofPath, webviewPanel);
                    break;
                case 'queryDependencyInfo': {
                    const cached = state.dependencyInfoCache.get(message.className);
                    if (cached) {
                        webviewPanel.webview.postMessage({
                            command: 'dependencyResolved',
                            className: message.className,
                            tier: cached.tier,
                            dependency: cached.dependency
                        });
                    }
                    break;
                }
                case 'gcRootPath':
                    this.outputChannel.appendLine(`[HeapLens] gcRootPath request for objectId: ${message.objectId}`);
                    try {
                        const gcPath = await client.sendRequest('gc_root_path', {
                            path: hprofPath,
                            object_id: message.objectId
                        });
                        webviewPanel.webview.postMessage({
                            command: 'gcRootPathResponse',
                            path: gcPath
                        });
                    } catch (error: any) {
                        this.outputChannel.appendLine(`[HeapLens] gcRootPath error: ${error.message}`);
                        webviewPanel.webview.postMessage({
                            command: 'gcRootPathResponse',
                            path: null
                        });
                    }
                    break;
                case 'copyReport':
                    this.handleCopyReport(hprofPath, webviewPanel);
                    break;
                case 'ready':
                    this.outputChannel.appendLine('[HeapLens] Webview ready');
                    state.webviewReady = true;
                    if (state.pendingWebviewMessage) {
                        this.outputChannel.appendLine('[HeapLens] Resending buffered analysisComplete to webview');
                        webviewPanel.webview.postMessage(state.pendingWebviewMessage);
                        state.pendingWebviewMessage = null;
                    }
                    break;
            }
        });

        // Start analysis
        await this.analyzeFile(hprofPath, webviewPanel, client);
    }

    private getOrCreateClient(): RustClient | null {
        if (this.rustClient && !this.rustClient.isDisposed) {
            this.outputChannel.appendLine('[HeapLens] Reusing existing Rust client');
            return this.rustClient;
        }

        const serverPath = this.getServerPath();
        this.outputChannel.appendLine(`[HeapLens] Server binary path: ${serverPath}`);
        this.outputChannel.appendLine(`[HeapLens] Server binary exists: ${fs.existsSync(serverPath)}`);

        if (!fs.existsSync(serverPath)) {
            vscode.window.showErrorMessage(`HeapLens server not found at ${serverPath}. Build with: cd hprof-analyzer && cargo build --release`);
            return null;
        }

        try {
            this.rustClient = new RustClient(serverPath);
            this.rustClient.onStderr = (msg: string) => {
                this.outputChannel.appendLine(`[server] ${msg.trim()}`);
            };
            this.outputChannel.appendLine('[HeapLens] Rust server process spawned');
            return this.rustClient;
        } catch (error: any) {
            this.outputChannel.appendLine(`[HeapLens] ERROR spawning server: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to start HeapLens server: ${error.message}`);
            return null;
        }
    }

    private async analyzeFile(
        hprofPath: string,
        webviewPanel: vscode.WebviewPanel,
        client: RustClient
    ): Promise<void> {
        let resolveAnalysis: (() => void) | null = null;
        const analysisPromise = new Promise<void>((resolve) => { resolveAnalysis = resolve; });

        client.onNotification('heap_analysis_complete', (params: any) => {
            resolveAnalysis?.();
            const state = this.editors.get(hprofPath);
            this.outputChannel.appendLine(`[HeapLens] Received heap_analysis_complete notification, status: ${params.status}`);
            if (params.status === 'completed') {
                const topObjCount = (params.top_objects || []).length;
                const histCount = (params.class_histogram || []).length;
                const suspectCount = (params.leak_suspects || []).length;
                this.outputChannel.appendLine(`[HeapLens] Data: ${topObjCount} objects, ${histCount} histogram entries, ${suspectCount} leak suspects`);

                // Store analysis data for LLM integrations (per-editor)
                const analysisData: AnalysisData = {
                    summary: params.summary || null,
                    topObjects: params.top_objects || [],
                    leakSuspects: params.leak_suspects || [],
                    classHistogram: params.class_histogram || [],
                    wasteAnalysis: params.waste_analysis || undefined
                };
                if (state) { state.analysisData = analysisData; }

                const webviewMessage = {
                    command: 'analysisComplete',
                    topObjects: params.top_objects || [],
                    topLayers: params.top_layers || [],
                    summary: params.summary || null,
                    classHistogram: params.class_histogram || [],
                    leakSuspects: params.leak_suspects || [],
                    wasteAnalysis: params.waste_analysis || null
                };

                if (state?.webviewReady) {
                    webviewPanel.webview.postMessage(webviewMessage);
                    this.outputChannel.appendLine('[HeapLens] Posted analysisComplete to webview');
                } else if (state) {
                    state.pendingWebviewMessage = webviewMessage;
                    this.outputChannel.appendLine('[HeapLens] Webview not ready yet, buffering analysisComplete');
                }
            } else if (params.status === 'error') {
                this.outputChannel.appendLine(`[HeapLens] Analysis error: ${params.error}`);
                webviewPanel.webview.postMessage({
                    command: 'error',
                    message: params.error || 'Unknown error'
                });
            }
        });

        this.outputChannel.appendLine(`[HeapLens] Sending analyze_heap request for: ${hprofPath}`);

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'HeapLens: Analyzing HPROF File',
                cancellable: false
            },
            async (progress) => {
                progress.report({ increment: 0, message: 'Starting analysis...' });

                try {
                    this.outputChannel.appendLine('[HeapLens] Awaiting analyze_heap response...');
                    const response = await client.sendRequest('analyze_heap', { path: hprofPath });
                    this.outputChannel.appendLine(`[HeapLens] Got response: ${JSON.stringify(response)}`);

                    if (response.status === 'processing') {
                        progress.report({ increment: 30, message: 'Building heap graph...' });
                        this.outputChannel.appendLine('[HeapLens] Status=processing, waiting for notification...');

                        const startTime = Date.now();
                        const timeoutPromise = new Promise<'timeout'>((resolve) =>
                            setTimeout(() => resolve('timeout'), 300000)
                        );
                        const result = await Promise.race([
                            analysisPromise.then(() => 'done' as const),
                            timeoutPromise
                        ]);

                        if (result === 'timeout') {
                            throw new Error('Analysis timed out after 5 minutes');
                        }
                        this.outputChannel.appendLine(`[HeapLens] Analysis completed in ${Date.now() - startTime}ms`);
                        progress.report({ increment: 100, message: 'Done!' });
                    }
                } catch (error: any) {
                    this.outputChannel.appendLine(`[HeapLens] ERROR: ${error.message}`);
                    vscode.window.showErrorMessage(`HeapLens analysis failed: ${error.message}`);
                } finally {
                    client.offNotification('heap_analysis_complete');
                }
            }
        );
    }

    private handleChatMessage(text: string, hprofPath: string, webviewPanel: vscode.WebviewPanel): void {
        const state = this.editors.get(hprofPath);
        if (!state) { return; }

        const config = vscode.workspace.getConfiguration('heaplens.llm');
        const llmConfig: LlmConfig = {
            provider: config.get<'anthropic' | 'openai'>('provider', 'anthropic'),
            apiKey: config.get<string>('apiKey', ''),
            baseUrl: config.get<string>('baseUrl', '') || undefined,
            model: config.get<string>('model', '') || undefined,
        };

        if (!llmConfig.apiKey) {
            webviewPanel.webview.postMessage({
                command: 'chatError',
                message: 'No API key configured. Go to Settings and search for "heaplens.llm.apiKey" to set your API key.'
            });
            return;
        }

        // Build messages with analysis context
        const messages: ChatMessage[] = [
            { role: 'system', content: HEAP_ANALYSIS_SYSTEM_PROMPT }
        ];

        // Add analysis context on first message or if no history
        if (state.chatHistory.length === 0 && state.analysisData) {
            const context = formatAnalysisContext(state.analysisData);
            const userPrompt = buildAnalyzePrompt(context, text);
            messages.push({ role: 'user', content: userPrompt });
        } else {
            // Include prior conversation (capped to prevent unbounded growth)
            messages.push(...state.chatHistory);
            messages.push({ role: 'user', content: text });
        }

        // Track user message
        state.chatHistory.push({ role: 'user', content: text });

        // Trim chat history if it exceeds the limit
        if (state.chatHistory.length > HprofEditorProvider.MAX_CHAT_HISTORY) {
            state.chatHistory = state.chatHistory.slice(-HprofEditorProvider.MAX_CHAT_HISTORY);
        }

        let assistantResponse = '';

        streamLlmResponse(
            llmConfig,
            messages,
            (chunk) => {
                assistantResponse += chunk;
                webviewPanel.webview.postMessage({ command: 'chatChunk', text: chunk });
            },
            () => {
                state.chatHistory.push({ role: 'assistant', content: assistantResponse });
                webviewPanel.webview.postMessage({ command: 'chatDone' });
            },
            (error) => {
                this.outputChannel.appendLine(`[HeapLens] Chat error: ${error}`);
                webviewPanel.webview.postMessage({ command: 'chatError', message: error });
            }
        );
    }

    private fmtBytes(bytes: number): string {
        if (bytes === 0) { return '0 B'; }
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const idx = Math.min(i, sizes.length - 1);
        return (bytes / Math.pow(k, idx)).toFixed(idx > 1 ? 2 : 0) + ' ' + sizes[idx];
    }

    private handleCopyReport(hprofPath: string, webviewPanel: vscode.WebviewPanel): void {
        const state = this.editors.get(hprofPath);
        if (!state?.analysisData) {
            vscode.window.showWarningMessage('No analysis data available for report.');
            return;
        }

        const data = state.analysisData;
        const lines: string[] = [];

        lines.push('# HeapLens Incident Report');
        lines.push('');
        lines.push(`**File:** ${hprofPath}`);
        lines.push(`**Generated:** ${new Date().toISOString()}`);
        lines.push('');

        // Heap Summary
        if (data.summary) {
            const s = data.summary;
            lines.push('## Heap Summary');
            lines.push('');
            lines.push(`- **Total Heap Size:** ${this.fmtBytes(s.total_heap_size)}`);
            lines.push(`- **Reachable Heap Size:** ${this.fmtBytes(s.reachable_heap_size || s.total_heap_size)}`);
            lines.push(`- **Objects:** ${s.total_instances.toLocaleString()}`);
            lines.push(`- **Classes:** ${s.total_classes.toLocaleString()}`);
            lines.push(`- **Arrays:** ${s.total_arrays.toLocaleString()}`);
            lines.push(`- **GC Roots:** ${s.total_gc_roots.toLocaleString()}`);
            lines.push('');
        }

        // Leak Suspects
        if (data.leakSuspects && data.leakSuspects.length > 0) {
            lines.push('## Leak Suspects');
            lines.push('');
            data.leakSuspects.forEach((s: any) => {
                const severity = s.retained_percentage > 30 ? 'HIGH' : 'MEDIUM';
                lines.push(`- **[${severity}] ${s.class_name}** — ${s.retained_percentage.toFixed(1)}% of heap (${this.fmtBytes(s.retained_size)})`);
                lines.push(`  ${s.description}`);
            });
            lines.push('');
        }

        // Top 10 classes
        if (data.classHistogram && data.classHistogram.length > 0) {
            lines.push('## Top 10 Classes by Retained Size');
            lines.push('');
            lines.push('| Class | Instances | Shallow | Retained |');
            lines.push('|-------|-----------|---------|----------|');
            data.classHistogram.slice(0, 10).forEach((e: any) => {
                lines.push(`| ${e.class_name} | ${e.instance_count.toLocaleString()} | ${this.fmtBytes(e.shallow_size)} | ${this.fmtBytes(e.retained_size)} |`);
            });
            lines.push('');
        }

        // Waste Analysis
        if (data.wasteAnalysis && data.wasteAnalysis.total_wasted_bytes > 0) {
            const w = data.wasteAnalysis;
            lines.push('## Waste Analysis');
            lines.push('');
            lines.push(`- **Total Waste:** ${this.fmtBytes(w.total_wasted_bytes)} (${w.waste_percentage.toFixed(1)}% of heap)`);
            lines.push(`- **Duplicate Strings:** ${this.fmtBytes(w.duplicate_string_wasted_bytes)}`);
            lines.push(`- **Empty Collections:** ${this.fmtBytes(w.empty_collection_wasted_bytes)}`);

            if (w.duplicate_strings && w.duplicate_strings.length > 0) {
                lines.push('');
                lines.push('**Top Duplicate Strings:**');
                lines.push('');
                lines.push('| Preview | Copies | Wasted |');
                lines.push('|---------|--------|--------|');
                w.duplicate_strings.slice(0, 10).forEach((d: any) => {
                    const preview = (d.preview || '(empty)').substring(0, 60).replace(/\|/g, '\\|');
                    lines.push(`| ${preview} | ${d.count.toLocaleString()} | ${this.fmtBytes(d.wasted_bytes)} |`);
                });
            }

            if (w.empty_collections && w.empty_collections.length > 0) {
                lines.push('');
                lines.push('**Empty Collections:**');
                lines.push('');
                lines.push('| Class | Count | Wasted |');
                lines.push('|-------|-------|--------|');
                w.empty_collections.forEach((e: any) => {
                    lines.push(`| ${e.class_name} | ${e.count.toLocaleString()} | ${this.fmtBytes(e.wasted_bytes)} |`);
                });
            }
            lines.push('');
        }

        const report = lines.join('\n');
        vscode.env.clipboard.writeText(report).then(() => {
            webviewPanel.webview.postMessage({ command: 'reportCopied' });
            this.outputChannel.appendLine('[HeapLens] Incident report copied to clipboard');
        });
    }

    private async handleGoToSource(className: string, hprofPath: string, webviewPanel: vscode.WebviewPanel): Promise<void> {
        this.outputChannel.appendLine(`[HeapLens] Go to source requested for: ${className}`);
        const state = this.editors.get(hprofPath);
        try {
            const result = await resolveSource(className);
            if (result) {
                this.outputChannel.appendLine(`[HeapLens] Source found: tier=${result.tier}, uri=${result.uri.fsPath}`);
                await vscode.window.showTextDocument(result.uri, { viewColumn: vscode.ViewColumn.Beside });

                // Cache and send dependency info to webview
                const info: { tier: string; dependency?: DependencyInfo } = { tier: result.tier };
                if (result.dependency) {
                    info.dependency = result.dependency;
                }
                state?.dependencyInfoCache.set(className, info);

                webviewPanel.webview.postMessage({
                    command: 'dependencyResolved',
                    className,
                    tier: result.tier,
                    dependency: result.dependency
                });
            } else {
                this.outputChannel.appendLine(`[HeapLens] No source found for: ${className}`);
                webviewPanel.webview.postMessage({ command: 'sourceNotFound', className });
            }
        } catch (error: any) {
            this.outputChannel.appendLine(`[HeapLens] Go to source error for ${className}: ${error.message}`);
            webviewPanel.webview.postMessage({ command: 'sourceNotFound', className });
        }
    }

    public getRustClient(): RustClient | null {
        return this.rustClient;
    }

    public getAnalysisData(): AnalysisData | null {
        const state = this.activeHprofPath ? this.editors.get(this.activeHprofPath) : undefined;
        if (!state?.analysisData) {
            return null;
        }

        // Enrich leak suspects with cached dependency info
        const enriched: AnalysisData = {
            ...state.analysisData,
            leakSuspects: state.analysisData.leakSuspects.map(s => {
                const cached = state.dependencyInfoCache.get(s.class_name);
                if (cached?.dependency) {
                    return { ...s, dependency: cached.dependency };
                }
                return s;
            })
        };
        return enriched;
    }

    public getActiveWebviewPanel(): vscode.WebviewPanel | null {
        const state = this.activeHprofPath ? this.editors.get(this.activeHprofPath) : undefined;
        return state?.webviewPanel ?? null;
    }

    public getCurrentHprofPath(): string | null {
        return this.activeHprofPath;
    }

    public dispose(): void {
        if (this.rustClient) {
            this.rustClient.dispose();
            this.rustClient = null;
        }
        this.editors.clear();
    }
}
