import { MessageHandler, HandlerContext } from './messageHandlers';
import { MonitorService, MonitorConfig } from './monitorService';
import * as vscode from 'vscode';

/**
 * Message handlers for the Monitor tab.
 * These follow the same MessageHandler interface as other handlers.
 */

const startMonitorHandler: MessageHandler = {
    command: 'startMonitor',
    async handle(message, ctx) {
        const host = message.host || 'localhost';
        const port = message.port || 9095;

        ctx.outputChannel.appendLine(`[HeapLens] startMonitor: ${host}:${port}`);

        // Check if already monitoring
        const existing = (ctx.provider as any).getMonitorService?.();
        if (existing?.isConnected) {
            ctx.webviewPanel.webview.postMessage({
                command: 'monitorError',
                message: 'Already connected. Disconnect first.'
            });
            return;
        }

        const pollInterval = vscode.workspace.getConfiguration('heaplens.monitor')
            .get<number>('pollInterval', 2000);

        const config: MonitorConfig = {
            host,
            port,
            pollIntervalMs: pollInterval
        };

        const service = new MonitorService(config);

        // Wire events to webview
        service.onEvent((event) => {
            switch (event.type) {
                case 'connected':
                    ctx.webviewPanel.webview.postMessage({ command: 'monitorConnected' });
                    break;
                case 'disconnected':
                    ctx.webviewPanel.webview.postMessage({ command: 'monitorDisconnected' });
                    break;
                case 'metrics':
                    ctx.webviewPanel.webview.postMessage({
                        command: 'monitorMetrics',
                        data: event.data
                    });
                    break;
                case 'histogram':
                    ctx.webviewPanel.webview.postMessage({
                        command: 'monitorHistogram',
                        data: event.data
                    });
                    break;
                case 'error':
                    ctx.webviewPanel.webview.postMessage({
                        command: 'monitorError',
                        message: event.data
                    });
                    break;
            }
        });

        try {
            await service.connect();
            // Store the service on the provider for lifecycle management
            if ((ctx.provider as any).setMonitorService) {
                (ctx.provider as any).setMonitorService(service);
            }
            ctx.outputChannel.appendLine(`[HeapLens] Monitor connected to ${host}:${port}`);
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] Monitor connection failed: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'monitorError',
                message: `Connection failed: ${error.message}`
            });
            service.dispose();
        }
    }
};

const stopMonitorHandler: MessageHandler = {
    command: 'stopMonitor',
    async handle(_message, ctx) {
        ctx.outputChannel.appendLine('[HeapLens] stopMonitor');
        const service = (ctx.provider as any).getMonitorService?.() as MonitorService | null;
        if (service) {
            service.disconnect();
            service.dispose();
            if ((ctx.provider as any).setMonitorService) {
                (ctx.provider as any).setMonitorService(null);
            }
        }
    }
};

const requestMonitorHistogramHandler: MessageHandler = {
    command: 'requestMonitorHistogram',
    async handle(_message, ctx) {
        ctx.outputChannel.appendLine('[HeapLens] requestMonitorHistogram');
        const service = (ctx.provider as any).getMonitorService?.() as MonitorService | null;
        if (service?.isConnected) {
            service.requestHistogram();
        } else {
            ctx.webviewPanel.webview.postMessage({
                command: 'monitorError',
                message: 'Not connected to agent'
            });
        }
    }
};

export const monitorHandlers: MessageHandler[] = [
    startMonitorHandler,
    stopMonitorHandler,
    requestMonitorHistogramHandler,
];
