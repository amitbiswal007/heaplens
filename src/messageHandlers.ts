import * as vscode from 'vscode';
import { RustClient } from './rustClient';
import { AnalysisData, formatAnalysisContext } from './analysisContext';
import { streamLlmResponse, LlmConfig, ChatMessage } from './llmClient';
import { HEAP_ANALYSIS_SYSTEM_PROMPT, buildObjectExplainPrompt, buildLeakSuspectExplainPrompt } from './promptTemplates';
import type { DependencyInfo } from './dependencyResolver';

/** Per-editor state, keyed by hprof file path. */
export interface EditorState {
    webviewPanel: vscode.WebviewPanel;
    analysisData: AnalysisData | null;
    chatHistory: ChatMessage[];
    pendingWebviewMessage: any;
    webviewReady: boolean;
    dependencyInfoCache: Map<string, { tier: string; dependency?: DependencyInfo }>;
}

export interface HandlerContext {
    hprofPath: string;
    state: EditorState;
    webviewPanel: vscode.WebviewPanel;
    client: RustClient;
    outputChannel: vscode.OutputChannel;
    provider: {
        handleChatMessage(text: string, hprofPath: string, webviewPanel: vscode.WebviewPanel): void;
        handleGoToSource(className: string, hprofPath: string, webviewPanel: vscode.WebviewPanel): Promise<void>;
        handleCopyReport(hprofPath: string, webviewPanel: vscode.WebviewPanel): void;
        clearChatHistory(hprofPath: string): void;
    };
}

export interface MessageHandler {
    command: string;
    handle(message: any, ctx: HandlerContext): Promise<void>;
}

// --- Handler implementations ---

const getChildrenHandler: MessageHandler = {
    command: 'getChildren',
    async handle(message, ctx) {
        ctx.outputChannel.appendLine(`[HeapLens] getChildren request for objectId: ${message.objectId}`);
        try {
            const children = await ctx.client.sendRequest('get_children', {
                path: ctx.hprofPath,
                object_id: message.objectId
            });
            ctx.outputChannel.appendLine(`[HeapLens] getChildren response: ${Array.isArray(children) ? children.length + ' children' : typeof children}`);
            if (Array.isArray(children) && children.length > 0) {
                ctx.outputChannel.appendLine(`[HeapLens] Sending childrenResponse with ${children.length} children`);
                ctx.webviewPanel.webview.postMessage({
                    command: 'childrenResponse',
                    objectId: message.objectId,
                    children
                });
            } else {
                ctx.outputChannel.appendLine(`[HeapLens] No children, sending noChildren`);
                ctx.webviewPanel.webview.postMessage({
                    command: 'noChildren',
                    objectId: message.objectId,
                    message: 'This object has no children in the dominator tree'
                });
            }
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] getChildren error: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'noChildren',
                objectId: message.objectId,
                message: error.message?.includes('not found')
                    ? 'This object has no children'
                    : error.message || String(error)
            });
        }
    }
};

const chatMessageHandler: MessageHandler = {
    command: 'chatMessage',
    async handle(message, ctx) {
        ctx.provider.handleChatMessage(message.text, ctx.hprofPath, ctx.webviewPanel);
    }
};

const goToSourceHandler: MessageHandler = {
    command: 'goToSource',
    async handle(message, ctx) {
        await ctx.provider.handleGoToSource(message.className, ctx.hprofPath, ctx.webviewPanel);
    }
};

const queryDependencyInfoHandler: MessageHandler = {
    command: 'queryDependencyInfo',
    async handle(message, ctx) {
        const cached = ctx.state.dependencyInfoCache.get(message.className);
        if (cached) {
            ctx.webviewPanel.webview.postMessage({
                command: 'dependencyResolved',
                className: message.className,
                tier: cached.tier,
                dependency: cached.dependency
            });
        }
    }
};

const getReferrersHandler: MessageHandler = {
    command: 'getReferrers',
    async handle(message, ctx) {
        ctx.outputChannel.appendLine(`[HeapLens] getReferrers request for objectId: ${message.objectId}`);
        try {
            const referrers = await ctx.client.sendRequest('get_referrers', {
                path: ctx.hprofPath,
                object_id: message.objectId
            });
            ctx.webviewPanel.webview.postMessage({
                command: 'referrersResponse',
                objectId: message.objectId,
                referrers: Array.isArray(referrers) ? referrers : []
            });
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] getReferrers error: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'referrersResponse',
                objectId: message.objectId,
                referrers: []
            });
        }
    }
};

const gcRootPathHandler: MessageHandler = {
    command: 'gcRootPath',
    async handle(message, ctx) {
        ctx.outputChannel.appendLine(`[HeapLens] gcRootPath request for objectId: ${message.objectId}`);
        try {
            const gcPath = await ctx.client.sendRequest('gc_root_path', {
                path: ctx.hprofPath,
                object_id: message.objectId
            });
            ctx.webviewPanel.webview.postMessage({
                command: 'gcRootPathResponse',
                path: gcPath
            });
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] gcRootPath error: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'gcRootPathResponse',
                path: null
            });
        }
    }
};

const inspectObjectHandler: MessageHandler = {
    command: 'inspectObject',
    async handle(message, ctx) {
        ctx.outputChannel.appendLine(`[HeapLens] inspectObject request for objectId: ${message.objectId}`);
        try {
            const fields = await ctx.client.sendRequest('inspect_object', {
                path: ctx.hprofPath,
                object_id: message.objectId
            });
            ctx.webviewPanel.webview.postMessage({
                command: 'inspectObjectResponse',
                objectId: message.objectId,
                fields: fields
            });
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] inspectObject error: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'inspectObjectResponse',
                objectId: message.objectId,
                fields: null
            });
        }
    }
};

const explainObjectHandler: MessageHandler = {
    command: 'explainObject',
    async handle(message, ctx) {
        const config = vscode.workspace.getConfiguration('heaplens.llm');
        const llmConfig: LlmConfig = {
            provider: config.get<string>('provider', 'anthropic'),
            apiKey: config.get<string>('apiKey', ''),
            baseUrl: config.get<string>('baseUrl', '') || undefined,
            model: config.get<string>('model', '') || undefined,
        };

        const objectId = message.objectId;

        if (!llmConfig.apiKey) {
            ctx.webviewPanel.webview.postMessage({
                command: 'explainError',
                objectId,
                message: 'No API key configured. Go to Settings and search for "heaplens.llm.apiKey" to set your API key.'
            });
            return;
        }

        let gcPath: any = null;
        try {
            gcPath = await ctx.client.sendRequest('gc_root_path', {
                path: ctx.hprofPath,
                object_id: objectId
            });
        } catch {
            // ignore — GC path is optional
        }

        const heapContext = ctx.state.analysisData ? formatAnalysisContext(ctx.state.analysisData) : '';
        const totalHeapSize = ctx.state.analysisData?.summary?.total_heap_size || 0;

        const gcRootPath = Array.isArray(gcPath) ? gcPath.map((n: any) => ({
            class_name: n.class_name || n.node_type,
            field_name: n.field_name
        })) : undefined;

        const prompt = buildObjectExplainPrompt(heapContext, {
            className: message.className || '',
            shallowSize: message.shallowSize || 0,
            retainedSize: message.retainedSize || 0,
            totalHeapSize,
            fields: message.fields || [],
            gcRootPath
        });

        const messages: ChatMessage[] = [
            { role: 'system', content: HEAP_ANALYSIS_SYSTEM_PROMPT },
            { role: 'user', content: prompt }
        ];

        streamLlmResponse(
            llmConfig,
            messages,
            (chunk) => {
                ctx.webviewPanel.webview.postMessage({ command: 'explainChunk', objectId, text: chunk });
            },
            () => {
                ctx.webviewPanel.webview.postMessage({ command: 'explainDone', objectId });
            },
            (error) => {
                ctx.outputChannel.appendLine(`[HeapLens] Explain error: ${error}`);
                ctx.webviewPanel.webview.postMessage({ command: 'explainError', objectId, message: error });
            }
        );
    }
};

const explainLeakSuspectHandler: MessageHandler = {
    command: 'explainLeakSuspect',
    async handle(message, ctx) {
        const config = vscode.workspace.getConfiguration('heaplens.llm');
        const llmConfig: LlmConfig = {
            provider: config.get<string>('provider', 'anthropic'),
            apiKey: config.get<string>('apiKey', ''),
            baseUrl: config.get<string>('baseUrl', '') || undefined,
            model: config.get<string>('model', '') || undefined,
        };

        const className = message.className;

        if (!llmConfig.apiKey) {
            ctx.webviewPanel.webview.postMessage({
                command: 'explainLeakError',
                className,
                message: 'No API key configured. Go to Settings and search for "heaplens.llm.apiKey" to set your API key.'
            });
            return;
        }

        const heapContext = ctx.state.analysisData ? formatAnalysisContext(ctx.state.analysisData) : '';

        const prompt = buildLeakSuspectExplainPrompt(heapContext, {
            className: message.className || '',
            retainedSize: message.retainedSize || 0,
            retainedPercentage: message.retainedPercentage || 0,
            description: message.description || ''
        });

        const messages: ChatMessage[] = [
            { role: 'system', content: HEAP_ANALYSIS_SYSTEM_PROMPT },
            { role: 'user', content: prompt }
        ];

        streamLlmResponse(
            llmConfig,
            messages,
            (chunk) => {
                ctx.webviewPanel.webview.postMessage({ command: 'explainLeakChunk', className, text: chunk });
            },
            () => {
                ctx.webviewPanel.webview.postMessage({ command: 'explainLeakDone', className });
            },
            (error) => {
                ctx.outputChannel.appendLine(`[HeapLens] Explain leak error: ${error}`);
                ctx.webviewPanel.webview.postMessage({ command: 'explainLeakError', className, message: error });
            }
        );
    }
};

const executeQueryHandler: MessageHandler = {
    command: 'executeQuery',
    async handle(message, ctx) {
        ctx.outputChannel.appendLine(`[HeapLens] executeQuery: ${message.query}`);
        try {
            const queryResult = await ctx.client.sendRequest('execute_query', {
                path: ctx.hprofPath,
                query: message.query
            });
            ctx.webviewPanel.webview.postMessage({
                command: 'queryResult',
                result: queryResult,
                query: message.query
            });
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] executeQuery error: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'queryError',
                error: error.message || String(error),
                query: message.query
            });
        }
    }
};

const listAnalyzedFilesHandler: MessageHandler = {
    command: 'listAnalyzedFiles',
    async handle(_message, ctx) {
        try {
            const files = await ctx.client.sendRequest('list_analyzed_files', {});
            const otherFiles = Array.isArray(files) ? files.filter((f: string) => f !== ctx.hprofPath) : [];
            ctx.webviewPanel.webview.postMessage({
                command: 'analyzedFiles',
                files: otherFiles
            });
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] listAnalyzedFiles error: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'analyzedFiles',
                files: []
            });
        }
    }
};

const compareHeapsHandler: MessageHandler = {
    command: 'compareHeaps',
    async handle(message, ctx) {
        try {
            const compareResult = await ctx.client.sendRequest('compare_heaps', {
                current_path: ctx.hprofPath,
                baseline_path: message.baselinePath
            });
            ctx.webviewPanel.webview.postMessage({
                command: 'compareResult',
                result: compareResult
            });
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] compareHeaps error: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'compareError',
                error: error.message || String(error)
            });
        }
    }
};

const copyReportHandler: MessageHandler = {
    command: 'copyReport',
    async handle(_message, ctx) {
        ctx.provider.handleCopyReport(ctx.hprofPath, ctx.webviewPanel);
    }
};

const readyHandler: MessageHandler = {
    command: 'ready',
    async handle(_message, ctx) {
        ctx.outputChannel.appendLine('[HeapLens] Webview ready');
        ctx.state.webviewReady = true;
        if (ctx.state.pendingWebviewMessage) {
            ctx.outputChannel.appendLine('[HeapLens] Resending buffered analysisComplete to webview');
            ctx.webviewPanel.webview.postMessage(ctx.state.pendingWebviewMessage);
            ctx.state.pendingWebviewMessage = null;
        }
        // Restore chat history if available
        if (ctx.state.chatHistory.length > 0) {
            ctx.webviewPanel.webview.postMessage({
                command: 'restoreChatHistory',
                messages: ctx.state.chatHistory
            });
            ctx.outputChannel.appendLine(`[HeapLens] Restored ${ctx.state.chatHistory.length} chat messages`);
        }
    }
};

const clearChatHistoryHandler: MessageHandler = {
    command: 'clearChatHistory',
    async handle(_message, ctx) {
        ctx.state.chatHistory = [];
        ctx.provider.clearChatHistory(ctx.hprofPath);
        ctx.outputChannel.appendLine('[HeapLens] Chat history cleared');
    }
};

const exportHistogramCsvHandler: MessageHandler = {
    command: 'exportHistogramCsv',
    async handle(message, ctx) {
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('histogram.csv'),
            filters: { 'CSV': ['csv'] }
        });
        if (uri) {
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(uri, encoder.encode(message.csv));
            ctx.outputChannel.appendLine(`[HeapLens] Histogram CSV exported to: ${uri.fsPath}`);
        }
    }
};

const cancelAnalysisHandler: MessageHandler = {
    command: 'cancelAnalysis',
    async handle(message, ctx) {
        ctx.outputChannel.appendLine('[HeapLens] Cancel analysis requested from webview');
        try {
            await ctx.client.sendRequest('cancel_analysis', { path: ctx.hprofPath });
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] cancel_analysis error: ${error.message}`);
        }
    }
};

const retryAnalysisHandler: MessageHandler = {
    command: 'retryAnalysis',
    async handle(_message, ctx) {
        ctx.outputChannel.appendLine('[HeapLens] Retry analysis requested from webview');
        ctx.webviewPanel.webview.postMessage({ command: 'analysisRetrying' });
        try {
            const response = await ctx.client.sendRequest('analyze_heap', { path: ctx.hprofPath });
            if (response.status !== 'processing') {
                ctx.webviewPanel.webview.postMessage({
                    command: 'error',
                    message: 'Unexpected response: ' + JSON.stringify(response)
                });
            }
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] Retry error: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'error',
                message: error.message || String(error)
            });
        }
    }
};

const getDominatorSubtreeHandler: MessageHandler = {
    command: 'getDominatorSubtree',
    async handle(message, ctx) {
        ctx.outputChannel.appendLine(`[HeapLens] getDominatorSubtree request for objectId: ${message.objectId}`);
        try {
            const subtree = await ctx.client.sendRequest('get_dominator_subtree', {
                path: ctx.hprofPath,
                object_id: message.objectId || 0,
                max_depth: message.maxDepth || 6,
                max_children: message.maxChildren || 20
            });
            ctx.webviewPanel.webview.postMessage({
                command: 'dominatorSubtreeResponse',
                subtree
            });
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] getDominatorSubtree error: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'dominatorSubtreeResponse',
                subtree: null
            });
        }
    }
};

const getTimelineDataHandler: MessageHandler = {
    command: 'getTimelineData',
    async handle(message, ctx) {
        ctx.outputChannel.appendLine(`[HeapLens] getTimelineData request for ${message.paths?.length || 0} files`);
        try {
            const result = await ctx.client.sendRequest('get_timeline_data', {
                paths: message.paths || [],
                top_n: message.topN || 10
            });
            ctx.webviewPanel.webview.postMessage({
                command: 'timelineDataResponse',
                result
            });
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] getTimelineData error: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'timelineDataResponse',
                result: null
            });
        }
    }
};

const listAllAnalyzedFilesHandler: MessageHandler = {
    command: 'listAllAnalyzedFiles',
    async handle(_message, ctx) {
        try {
            const files = await ctx.client.sendRequest('list_analyzed_files', {});
            ctx.webviewPanel.webview.postMessage({
                command: 'allAnalyzedFiles',
                files: Array.isArray(files) ? files : []
            });
        } catch (error: any) {
            ctx.outputChannel.appendLine(`[HeapLens] listAllAnalyzedFiles error: ${error.message}`);
            ctx.webviewPanel.webview.postMessage({
                command: 'allAnalyzedFiles',
                files: []
            });
        }
    }
};

export const allHandlers: MessageHandler[] = [
    getChildrenHandler,
    getReferrersHandler,
    chatMessageHandler,
    goToSourceHandler,
    queryDependencyInfoHandler,
    gcRootPathHandler,
    inspectObjectHandler,
    explainObjectHandler,
    explainLeakSuspectHandler,
    executeQueryHandler,
    listAnalyzedFilesHandler,
    compareHeapsHandler,
    copyReportHandler,
    readyHandler,
    cancelAnalysisHandler,
    retryAnalysisHandler,
    exportHistogramCsvHandler,
    clearChatHistoryHandler,
    getDominatorSubtreeHandler,
    getTimelineDataHandler,
    listAllAnalyzedFilesHandler,
];
