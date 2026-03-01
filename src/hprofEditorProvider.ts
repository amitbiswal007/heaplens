import * as vscode from 'vscode';
import * as fs from 'fs';
import { RustClient } from './rustClient';
import { getWebviewContent } from './webviewProvider';
import { AnalysisData, formatAnalysisContext } from './analysisContext';
import { streamLlmResponse, LlmConfig, ChatMessage } from './llmClient';
import { HEAP_ANALYSIS_SYSTEM_PROMPT, buildAnalyzePrompt } from './promptTemplates';
import { resolveSource } from './sourceResolver';
import type { DependencyInfo } from './dependencyResolver';

/**
 * Custom readonly editor provider for .hprof files.
 *
 * When a user opens a .hprof file, this provider spawns the Rust server,
 * sends an analyze_heap request, and renders the tabbed analysis UI.
 */
export class HprofEditorProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'heaplens.hprofEditor';

    private rustClient: RustClient | null = null;
    private outputChannel: vscode.OutputChannel;
    private lastAnalysisData: AnalysisData | null = null;
    private activeWebviewPanel: vscode.WebviewPanel | null = null;
    private currentHprofPath: string | null = null;
    private chatHistory: ChatMessage[] = [];
    private pendingWebviewMessage: any = null;
    private webviewReady = false;
    private dependencyInfoCache = new Map<string, { tier: string; dependency?: DependencyInfo }>();

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
        this.activeWebviewPanel = webviewPanel;
        this.currentHprofPath = hprofPath;
        this.webviewReady = false;
        this.pendingWebviewMessage = null;
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

        // Wire webview <-> RustClient message passing
        webviewPanel.webview.onDidReceiveMessage(async (message) => {
            this.outputChannel.appendLine(`[HeapLens] Webview message: ${message.command}`);
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
                    this.handleChatMessage(message.text, webviewPanel);
                    break;
                case 'goToSource':
                    await this.handleGoToSource(message.className, webviewPanel);
                    break;
                case 'queryDependencyInfo': {
                    const cached = this.dependencyInfoCache.get(message.className);
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
                case 'ready':
                    this.outputChannel.appendLine('[HeapLens] Webview ready');
                    this.webviewReady = true;
                    // Resend analysis data if it arrived before webview was ready
                    if (this.pendingWebviewMessage) {
                        this.outputChannel.appendLine('[HeapLens] Resending buffered analysisComplete to webview');
                        webviewPanel.webview.postMessage(this.pendingWebviewMessage);
                        this.pendingWebviewMessage = null;
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
        let analysisComplete = false;

        client.onNotification('heap_analysis_complete', (params: any) => {
            analysisComplete = true;
            this.outputChannel.appendLine(`[HeapLens] Received heap_analysis_complete notification, status: ${params.status}`);
            if (params.status === 'completed') {
                const topObjCount = (params.top_objects || []).length;
                const histCount = (params.class_histogram || []).length;
                const suspectCount = (params.leak_suspects || []).length;
                this.outputChannel.appendLine(`[HeapLens] Data: ${topObjCount} objects, ${histCount} histogram entries, ${suspectCount} leak suspects`);

                // Store analysis data for LLM integrations
                this.lastAnalysisData = {
                    summary: params.summary || null,
                    topObjects: params.top_objects || [],
                    leakSuspects: params.leak_suspects || [],
                    classHistogram: params.class_histogram || []
                };

                const webviewMessage = {
                    command: 'analysisComplete',
                    topObjects: params.top_objects || [],
                    topLayers: params.top_layers || [],
                    summary: params.summary || null,
                    classHistogram: params.class_histogram || [],
                    leakSuspects: params.leak_suspects || []
                };

                if (this.webviewReady) {
                    webviewPanel.webview.postMessage(webviewMessage);
                    this.outputChannel.appendLine('[HeapLens] Posted analysisComplete to webview');
                } else {
                    this.pendingWebviewMessage = webviewMessage;
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

                        const timeout = 300000;
                        const startTime = Date.now();
                        while (!analysisComplete && (Date.now() - startTime) < timeout) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }

                        if (!analysisComplete) {
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

    private handleChatMessage(text: string, webviewPanel: vscode.WebviewPanel): void {
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
        if (this.chatHistory.length === 0 && this.lastAnalysisData) {
            const context = formatAnalysisContext(this.lastAnalysisData);
            const userPrompt = buildAnalyzePrompt(context, text);
            messages.push({ role: 'user', content: userPrompt });
        } else {
            // Include prior conversation
            messages.push(...this.chatHistory);
            messages.push({ role: 'user', content: text });
        }

        // Track user message
        this.chatHistory.push({ role: 'user', content: text });

        let assistantResponse = '';

        streamLlmResponse(
            llmConfig,
            messages,
            (chunk) => {
                assistantResponse += chunk;
                webviewPanel.webview.postMessage({ command: 'chatChunk', text: chunk });
            },
            () => {
                this.chatHistory.push({ role: 'assistant', content: assistantResponse });
                webviewPanel.webview.postMessage({ command: 'chatDone' });
            },
            (error) => {
                this.outputChannel.appendLine(`[HeapLens] Chat error: ${error}`);
                webviewPanel.webview.postMessage({ command: 'chatError', message: error });
            }
        );
    }

    private async handleGoToSource(className: string, webviewPanel: vscode.WebviewPanel): Promise<void> {
        this.outputChannel.appendLine(`[HeapLens] Go to source requested for: ${className}`);
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
                this.dependencyInfoCache.set(className, info);

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
        if (!this.lastAnalysisData) {
            return null;
        }

        // Enrich leak suspects with cached dependency info
        const enriched: AnalysisData = {
            ...this.lastAnalysisData,
            leakSuspects: this.lastAnalysisData.leakSuspects.map(s => {
                const cached = this.dependencyInfoCache.get(s.class_name);
                if (cached?.dependency) {
                    return { ...s, dependency: cached.dependency };
                }
                return s;
            })
        };
        return enriched;
    }

    public getActiveWebviewPanel(): vscode.WebviewPanel | null {
        return this.activeWebviewPanel;
    }

    public getCurrentHprofPath(): string | null {
        return this.currentHprofPath;
    }

    public dispose(): void {
        if (this.rustClient) {
            this.rustClient.dispose();
            this.rustClient = null;
        }
    }
}
