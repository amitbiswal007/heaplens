import * as vscode from 'vscode';
import * as fs from 'fs';
import { RustClient } from './rustClient';
import { getWebviewContent } from './webviewProvider';

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
                    try {
                        const children = await client.sendRequest('get_children', {
                            path: hprofPath,
                            object_id: message.objectId
                        });
                        if (Array.isArray(children) && children.length > 0) {
                            webviewPanel.webview.postMessage({
                                command: 'childrenResponse',
                                objectId: message.objectId,
                                children
                            });
                        } else {
                            webviewPanel.webview.postMessage({
                                command: 'noChildren',
                                objectId: message.objectId,
                                message: 'This object has no children in the dominator tree'
                            });
                        }
                    } catch (error: any) {
                        webviewPanel.webview.postMessage({
                            command: 'noChildren',
                            objectId: message.objectId,
                            message: error.message?.includes('not found')
                                ? 'This object has no children'
                                : error.message || String(error)
                        });
                    }
                    break;
                case 'ready':
                    this.outputChannel.appendLine('[HeapLens] Webview ready');
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
                webviewPanel.webview.postMessage({
                    command: 'analysisComplete',
                    topObjects: params.top_objects || [],
                    topLayers: params.top_layers || [],
                    summary: params.summary || null,
                    classHistogram: params.class_histogram || [],
                    leakSuspects: params.leak_suspects || []
                });
                this.outputChannel.appendLine('[HeapLens] Posted analysisComplete to webview');
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

    public getRustClient(): RustClient | null {
        return this.rustClient;
    }

    public dispose(): void {
        if (this.rustClient) {
            this.rustClient.dispose();
            this.rustClient = null;
        }
    }
}
