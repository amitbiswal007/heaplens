import * as vscode from 'vscode';
import { getStyles } from './webview/styles';
import { getHtmlTemplate } from './webview/template';
import { getRegistryJs } from './webview/js/registry';
import { getHelperJs } from './webview/js/helpers';
import { getOverviewJs } from './webview/js/overview';
import { getHistogramJs } from './webview/js/histogram';
import { getDominatorTreeJs } from './webview/js/dominatorTree';
import { getSourceJs } from './webview/js/source';
import { getChatJs } from './webview/js/chat';
import { getWasteJs } from './webview/js/waste';
import { getLeakSuspectsJs } from './webview/js/leakSuspects';
import { getGcPathJs } from './webview/js/gcPath';
import { getInspectorJs } from './webview/js/inspector';
import { getQueryJs } from './webview/js/query';
import { getCompareJs } from './webview/js/compare';

/**
 * Returns the HTML content for the HeapLens tabbed webview.
 *
 * Nine tabs:
 * 1. Overview — summary stats + top 10 objects table + treemap + bar chart
 * 2. Histogram — sortable class histogram table with search
 * 3. Dominator Tree — expandable tree with lazy drill-down
 * 4. Leak Suspects — card layout with severity indicators
 * 5. Waste — duplicate strings and empty collections analysis
 * 6. Source — browsable resolvable classes with source resolution status
 * 7. Query — HeapQL execution
 * 8. Compare — baseline comparison with delta charts
 * 9. AI Chat — LLM-powered heap analysis Q&A
 */
export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const d3Uri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'd3.v7.min.js'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${webview.cspSource}; style-src 'unsafe-inline';">
    <title>HeapLens</title>
    <style>
${getStyles()}
    </style>
</head>
<body>
${getHtmlTemplate()}

    <script src="${d3Uri}"></script>
    <script>
    (function() {
        const vscode = acquireVsCodeApi();

        // Shared state: set once on analysisComplete, read by tabs that need re-render
        var analysisData = null;

${getRegistryJs()}
${getHelperJs()}
${getOverviewJs()}
${getHistogramJs()}
${getDominatorTreeJs()}
${getSourceJs()}
${getChatJs()}
${getWasteJs()}
${getLeakSuspectsJs()}
${getGcPathJs()}
${getInspectorJs()}
${getQueryJs()}
${getCompareJs()}

        // Store analysisData for tabs that re-render on filter/sort/reset
        onMessage('analysisComplete', function(msg) {
            analysisData = msg;
        });

        vscode.postMessage({ command: 'ready' });
    })();
    </script>
</body>
</html>`;
}
