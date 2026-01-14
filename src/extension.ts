import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { JsonRpcClient } from './client';

let client: JsonRpcClient | null = null;
let outputChannel: vscode.OutputChannel | null = null;

function getBinaryPath(): string {
    const platform = process.platform;
    const extensionPath = path.dirname(__dirname);
    
    if (platform === 'win32') {
        return path.join(extensionPath, 'bin', 'analysis-engine.exe');
    } else {
        return path.join(extensionPath, 'bin', 'analysis-engine');
    }
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

    context.subscriptions.push(disposable);
    context.subscriptions.push({
        dispose: () => {
            if (client) {
                client.dispose();
                client = null;
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
    if (outputChannel) {
        outputChannel.dispose();
        outputChannel = null;
    }
}
