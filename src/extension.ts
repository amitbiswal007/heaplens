import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { JsonRpcClient } from './client';
import { RustClient } from './rustClient';
import { HeapAnalysisWebviewProvider } from './webviewProvider';

let client: JsonRpcClient | null = null;
let rustClient: RustClient | null = null;
let outputChannel: vscode.OutputChannel | null = null;

/**
 * Gets the path to the Rust analysis engine binary (legacy).
 */
function getBinaryPath(): string {
    const platform = process.platform;
    const extensionPath = path.dirname(__dirname);
    
    if (platform === 'win32') {
        return path.join(extensionPath, 'bin', 'analysis-engine.exe');
    } else {
        return path.join(extensionPath, 'bin', 'analysis-engine');
    }
}

/**
 * Gets the path to the hprof-server binary (new async server).
 */
function getHprofServerPath(): string {
    const platform = process.platform;
    const extensionPath = path.dirname(__dirname);
    
    // The binary is built from hprof-analyzer crate
    // In development, it's in hprof-analyzer/target/release/hprof-server
    // In production, it should be copied to bin/ directory
    const devPath = path.join(extensionPath, 'hprof-analyzer', 'target', 'release', 
        platform === 'win32' ? 'hprof-server.exe' : 'hprof-server');
    const prodPath = path.join(extensionPath, 'bin', 
        platform === 'win32' ? 'hprof-server.exe' : 'hprof-server');
    
    // Prefer production path, fall back to dev path
    if (fs.existsSync(prodPath)) {
        return prodPath;
    }
    if (fs.existsSync(devPath)) {
        return devPath;
    }
    
    // Return production path as default (will show error if not found)
    return prodPath;
}

function spawnRustProcess(): ChildProcess | null {
    const binaryPath = getBinaryPath();
    
    if (!fs.existsSync(binaryPath)) {
        vscode.window.showErrorMessage(
            `Rust binary not found at ${binaryPath}. Please build the Rust sidecar first.`
        );
        return null;
    }

    try {
        const process = spawn(binaryPath, [], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        process.on('error', (error: Error) => {
            vscode.window.showErrorMessage(`Failed to spawn Rust process: ${error.message}`);
            if (outputChannel) {
                outputChannel.appendLine(`[ERROR] Failed to spawn Rust process: ${error.message}`);
            }
        });

        return process;
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to spawn Rust process: ${error.message}`);
        if (outputChannel) {
            outputChannel.appendLine(`[ERROR] Failed to spawn Rust process: ${error.message}`);
        }
        return null;
    }
}

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Heap Analyzer');
    outputChannel.appendLine('Heap Analyzer extension activated');
    
    const extensionUri = context.extensionUri;

    const disposable = vscode.commands.registerCommand('heapAnalyzer.parse', async () => {
        const fileUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'HPROF Files': ['hprof']
            },
            openLabel: 'Select HPROF File'
        });

        if (!fileUri || fileUri.length === 0) {
            return;
        }

        const hprofPath = fileUri[0].fsPath;
        
        if (!outputChannel) {
            outputChannel = vscode.window.createOutputChannel('Heap Analyzer');
        }
        
        outputChannel.clear();
        outputChannel.show();
        outputChannel.appendLine(`Analyzing HPROF file: ${hprofPath}`);
        outputChannel.appendLine('');

        // Spawn Rust process if not already running
        if (!client) {
            const process = spawnRustProcess();
            if (!process) {
                return;
            }
            client = new JsonRpcClient(process);
        }

        try {
            outputChannel.appendLine('Sending parse request...');
            const result = await client.sendRequest('parse_hprof', { path: hprofPath });
            
            outputChannel.appendLine('Analysis complete:');
            outputChannel.appendLine(JSON.stringify(result, null, 2));
            
            vscode.window.showInformationMessage('HPROF analysis completed successfully');
        } catch (error: any) {
            const errorMessage = error.message || String(error);
            outputChannel.appendLine(`[ERROR] ${errorMessage}`);
            vscode.window.showErrorMessage(`HPROF analysis failed: ${errorMessage}`);
        }
    });

    // Register the new javaheap.analyzeFile command
    const analyzeFileDisposable = vscode.commands.registerCommand('javaheap.analyzeFile', async () => {
        // Open file picker
        const fileUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                'HPROF Files': ['hprof']
            },
            openLabel: 'Select HPROF File to Analyze'
        });

        if (!fileUri || fileUri.length === 0) {
            return;
        }

        const hprofPath = fileUri[0].fsPath;

        // Ensure output channel exists
        if (!outputChannel) {
            outputChannel = vscode.window.createOutputChannel('Heap Analyzer');
        }
        outputChannel.clear();
        outputChannel.show();
        outputChannel.appendLine(`Analyzing HPROF file: ${hprofPath}`);
        outputChannel.appendLine('');

        // Get or create Rust client
        const serverPath = getHprofServerPath();
        
        if (!fs.existsSync(serverPath)) {
            const errorMsg = `Rust server binary not found at ${serverPath}. Please build the hprof-server first.`;
            vscode.window.showErrorMessage(errorMsg);
            outputChannel.appendLine(`[ERROR] ${errorMsg}`);
            return;
        }

        if (!rustClient || rustClient.isDisposed) {
            try {
                rustClient = new RustClient(serverPath);
                rustClient.onStderr = (message: string) => {
                    outputChannel?.appendLine(`[Rust stderr] ${message.trim()}`);
                };
                outputChannel.appendLine('Connected to Rust analysis server');
            } catch (error: any) {
                const errorMsg = `Failed to start Rust server: ${error.message}`;
                vscode.window.showErrorMessage(errorMsg);
                outputChannel.appendLine(`[ERROR] ${errorMsg}`);
                return;
            }
        }

        // Set up notification handler for completion
        let analysisComplete = false;
        let analysisResult: any = null;
        let analysisError: Error | null = null;

        rustClient.onNotification('heap_analysis_complete', (params: any) => {
            outputChannel?.appendLine(`[DEBUG] Received heap_analysis_complete notification`);
            outputChannel?.appendLine(`[DEBUG] Status: ${params.status}`);
            analysisComplete = true;
            if (params.status === 'completed') {
                analysisResult = params.top_objects || [];
                const topLayers = params.top_layers || [];
                
                outputChannel?.appendLine('Analysis completed successfully!');
                outputChannel?.appendLine(`Found ${analysisResult.length} top objects by retained size`);
                outputChannel?.appendLine(`Top layers for visualization: ${topLayers.length} items`);
                outputChannel?.appendLine('');
                outputChannel?.appendLine('Top Objects:');
                outputChannel?.appendLine(JSON.stringify(analysisResult, null, 2));
                
                // Create and show webview with Sunburst chart
                if (rustClient) {
                    HeapAnalysisWebviewProvider.createOrShow(extensionUri, rustClient, hprofPath);
                    
                    // Wait a bit for webview to initialize, then send data
                    setTimeout(() => {
                        if (topLayers.length > 0) {
                            outputChannel?.appendLine(`[DEBUG] Sending ${topLayers.length} items to webview`);
                            HeapAnalysisWebviewProvider.updateWithData(topLayers);
                        } else {
                            outputChannel?.appendLine('[WARNING] top_layers is empty, using top_objects instead');
                            // Fallback: use top_objects if top_layers is empty
                            if (analysisResult.length > 0) {
                                HeapAnalysisWebviewProvider.updateWithData(analysisResult.slice(0, 50));
                            }
                        }
                    }, 500);
                }
                
                vscode.window.showInformationMessage(
                    `HPROF analysis completed: ${analysisResult.length} objects analyzed`
                );
            } else if (params.status === 'error') {
                analysisError = new Error(params.error || 'Unknown error');
                outputChannel?.appendLine(`[ERROR] ${analysisError.message}`);
                vscode.window.showErrorMessage(`HPROF analysis failed: ${analysisError.message}`);
            }
        });

        // Show progress bar
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Analyzing HPROF File',
                cancellable: false
            },
            async (progress) => {
                progress.report({ increment: 0, message: 'Starting analysis...' });

                try {
                    // Send analyze_heap request
                    outputChannel?.appendLine('Sending analyze_heap request...');
                    progress.report({ increment: 20, message: 'Request sent, processing...' });

                    const response = await rustClient!.sendRequest('analyze_heap', { path: hprofPath });
                    
                    if (response.status === 'processing') {
                        outputChannel?.appendLine(`Request accepted, processing (request_id: ${response.request_id})...`);
                        progress.report({ increment: 30, message: 'Building heap graph...' });

                        // Wait for completion notification (with timeout)
                        const timeout = 300000; // 5 minutes
                        const startTime = Date.now();
                        
                        while (!analysisComplete && (Date.now() - startTime) < timeout) {
                            await new Promise(resolve => setTimeout(resolve, 100));
                            if (analysisComplete) {
                                break;
                            }
                        }

                        if (!analysisComplete) {
                            throw new Error('Analysis timed out after 5 minutes');
                        }

                        if (analysisError) {
                            throw analysisError;
                        }

                        progress.report({ increment: 100, message: 'Analysis complete!' });
                    } else {
                        throw new Error(`Unexpected response status: ${response.status}`);
                    }
                } catch (error: any) {
                    const errorMessage = error.message || String(error);
                    outputChannel?.appendLine(`[ERROR] ${errorMessage}`);
                    vscode.window.showErrorMessage(`HPROF analysis failed: ${errorMessage}`);
                    throw error;
                } finally {
                    // Clean up notification handler after completion or error
                    if (rustClient) {
                        rustClient.offNotification('heap_analysis_complete');
                    }
                }
            }
        );
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(analyzeFileDisposable);
    context.subscriptions.push({
        dispose: () => {
            if (client) {
                client.dispose();
                client = null;
            }
            if (rustClient) {
                rustClient.dispose();
                rustClient = null;
            }
            if (outputChannel) {
                outputChannel.dispose();
                outputChannel = null;
            }
        }
    });
}

export function deactivate() {
    if (client) {
        client.dispose();
        client = null;
    }
    if (rustClient) {
        rustClient.dispose();
        rustClient = null;
    }
    if (outputChannel) {
        outputChannel.dispose();
        outputChannel = null;
    }
}
