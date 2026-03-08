import * as net from 'net';
import * as readline from 'readline';

/**
 * Configuration for connecting to the HeapLens JVM agent.
 */
export interface MonitorConfig {
    host: string;
    port: number;
    pollIntervalMs: number;
}

/**
 * JVM metrics snapshot from the agent.
 */
export interface JvmMetrics {
    timestamp: number;
    heapUsed: number;
    heapMax: number;
    heapCommitted: number;
    nonHeapUsed: number;
    nonHeapCommitted: number;
    threadCount: number;
    daemonThreadCount: number;
    uptime: number;
    gcCollectors: Array<{
        name: string;
        collectionCount: number;
        collectionTimeMs: number;
    }>;
    memoryPools: Array<{
        name: string;
        type: string;
        used: number;
        max: number;
        committed: number;
    }>;
}

/**
 * Class histogram entry from the agent.
 */
export interface MonitorClassHistogramEntry {
    className: string;
    instanceCount: number;
    totalBytes: number;
}

/**
 * Events emitted by MonitorService.
 */
export type MonitorEventType = 'connected' | 'disconnected' | 'metrics' | 'histogram' | 'error';

export interface MonitorEvent {
    type: MonitorEventType;
    data?: JvmMetrics | MonitorClassHistogramEntry[] | string;
}

type MonitorEventListener = (event: MonitorEvent) => void;

/**
 * MonitorService connects to the HeapLens JVM agent via TCP,
 * polls for metrics at a configurable interval, and emits typed events.
 *
 * Uses net.Socket + readline (same pattern as RustClient).
 */
export class MonitorService {
    private config: MonitorConfig;
    private socket: net.Socket | null = null;
    private rl: readline.Interface | null = null;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private listeners: MonitorEventListener[] = [];
    private history: JvmMetrics[] = [];
    private connected = false;
    private disposed = false;

    private static readonly MAX_HISTORY = 300; // ~60KB at ~200 bytes per snapshot

    constructor(config: MonitorConfig) {
        this.config = config;
    }

    /**
     * Registers an event listener.
     */
    onEvent(listener: MonitorEventListener): void {
        this.listeners.push(listener);
    }

    /**
     * Connects to the agent TCP server and starts polling.
     */
    async connect(): Promise<void> {
        if (this.disposed) { throw new Error('MonitorService is disposed'); }
        if (this.connected) { return; }

        return new Promise<void>((resolve, reject) => {
            this.socket = new net.Socket();

            this.socket.on('error', (err: Error) => {
                if (!this.connected) {
                    reject(err);
                } else {
                    this.emit({ type: 'error', data: err.message });
                    this.handleDisconnect();
                }
            });

            this.socket.on('close', () => {
                if (this.connected) {
                    this.handleDisconnect();
                }
            });

            this.socket.connect(this.config.port, this.config.host, () => {
                this.connected = true;

                // Set up line-based reading
                this.rl = readline.createInterface({
                    input: this.socket!,
                    crlfDelay: Infinity
                });

                this.rl.on('line', (line: string) => {
                    this.handleLine(line);
                });

                // Start polling
                this.startPolling();

                this.emit({ type: 'connected' });
                resolve();
            });
        });
    }

    /**
     * Disconnects from the agent and stops polling.
     */
    disconnect(): void {
        this.stopPolling();
        if (this.rl) {
            this.rl.close();
            this.rl = null;
        }
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        if (this.connected) {
            this.connected = false;
            this.emit({ type: 'disconnected' });
        }
    }

    /**
     * Requests an on-demand class histogram from the agent.
     */
    requestHistogram(): void {
        this.sendCommand('get_histogram');
    }

    /**
     * Returns whether the service is currently connected.
     */
    get isConnected(): boolean {
        return this.connected;
    }

    /**
     * Returns the metrics history (up to MAX_HISTORY snapshots).
     */
    getMetricsHistory(): JvmMetrics[] {
        return this.history;
    }

    /**
     * Disposes all resources.
     */
    dispose(): void {
        if (this.disposed) { return; }
        this.disposed = true;
        this.disconnect();
        this.listeners = [];
        this.history = [];
    }

    private startPolling(): void {
        this.stopPolling();
        // Immediately request first metrics
        this.sendCommand('get_metrics');
        this.pollTimer = setInterval(() => {
            this.sendCommand('get_metrics');
        }, this.config.pollIntervalMs);
    }

    private stopPolling(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private sendCommand(command: string): void {
        if (!this.socket || this.socket.destroyed || !this.connected) { return; }
        const msg = JSON.stringify({ command }) + '\n';
        this.socket.write(msg);
    }

    private handleLine(line: string): void {
        line = line.trim();
        if (!line) { return; }

        try {
            const msg = JSON.parse(line);
            switch (msg.type) {
                case 'metrics':
                    if (msg.data) {
                        const metrics: JvmMetrics = msg.data;
                        this.history.push(metrics);
                        if (this.history.length > MonitorService.MAX_HISTORY) {
                            this.history.shift();
                        }
                        this.emit({ type: 'metrics', data: metrics });
                    }
                    break;

                case 'histogram':
                    this.emit({ type: 'histogram', data: msg.data || [] });
                    break;

                case 'pong':
                    // Silently handle pong
                    break;

                case 'error':
                    this.emit({ type: 'error', data: msg.message || 'Unknown agent error' });
                    break;

                default:
                    break;
            }
        } catch {
            // Ignore unparseable lines
        }
    }

    private handleDisconnect(): void {
        this.connected = false;
        this.stopPolling();
        this.emit({ type: 'disconnected' });
    }

    private emit(event: MonitorEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                // Ignore listener errors
            }
        }
    }
}
