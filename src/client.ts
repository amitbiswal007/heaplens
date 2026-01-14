import * as readline from 'readline';
import { ChildProcess } from 'child_process';

interface JsonRpcRequest {
    jsonrpc: string;
    id: number;
    method: string;
    params?: any;
}

interface JsonRpcResponse {
    jsonrpc: string;
    id: number;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
}

export class JsonRpcClient {
    private requestId: number = 0;
    private pendingRequests: Map<number, PendingRequest> = new Map();
    private rl: readline.Interface;
    private process: ChildProcess;
    private isShutdown: boolean = false;

    constructor(process: ChildProcess) {
        this.process = process;
        this.rl = readline.createInterface({
            input: process.stdout!,
            crlfDelay: Infinity
        });

        this.rl.on('line', (line: string) => {
            this.handleResponse(line);
        });

        process.stderr?.on('data', (data: Buffer) => {
            // Log stderr but don't treat as fatal unless process exits
            console.error(`[Rust sidecar stderr] ${data.toString()}`);
        });

        process.on('exit', (code: number | null, signal: string | null) => {
            this.shutdown(code !== 0 ? new Error(`Process exited with code ${code}, signal ${signal}`) : null);
        });

        process.on('error', (error: Error) => {
            this.shutdown(error);
        });
    }

    private handleResponse(line: string): void {
        if (this.isShutdown) {
            return;
        }

        try {
            const response: JsonRpcResponse = JSON.parse(line);
            
            if (response.jsonrpc !== '2.0') {
                console.error(`Invalid JSON-RPC version: ${response.jsonrpc}`);
                return;
            }

            const pending = this.pendingRequests.get(response.id);
            if (!pending) {
                console.error(`No pending request found for ID ${response.id}`);
                return;
            }

            this.pendingRequests.delete(response.id);

            if (response.error) {
                pending.reject(new Error(`JSON-RPC error: ${response.error.message} (code: ${response.error.code})`));
            } else {
                pending.resolve(response.result);
            }
        } catch (error) {
            console.error(`Failed to parse JSON-RPC response: ${line}`, error);
        }
    }

    private shutdown(error: Error | null): void {
        if (this.isShutdown) {
            return;
        }
        this.isShutdown = true;

        // Reject all pending requests
        const errorToUse = error || new Error('Client shutdown');
        for (const pending of this.pendingRequests.values()) {
            pending.reject(errorToUse);
        }
        this.pendingRequests.clear();

        this.rl.close();
    }

    public async sendRequest(method: string, params?: any): Promise<any> {
        if (this.isShutdown) {
            throw new Error('Client is shutdown');
        }

        const id = ++this.requestId;
        const request: JsonRpcRequest = {
            jsonrpc: '2.0',
            id: id,
            method: method,
            params: params
        };

        return new Promise<any>((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });

            const requestLine = JSON.stringify(request) + '\n';
            
            if (!this.process.stdin || this.process.stdin.destroyed) {
                reject(new Error('Process stdin is not available'));
                return;
            }

            this.process.stdin.write(requestLine, (error) => {
                if (error) {
                    this.pendingRequests.delete(id);
                    reject(error);
                }
            });
        });
    }

    public dispose(): void {
        this.shutdown(null);
        if (this.process.stdin && !this.process.stdin.destroyed) {
            this.process.stdin.end();
        }
        if (!this.process.killed) {
            this.process.kill();
        }
    }
}
