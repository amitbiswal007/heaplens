import * as vscode from 'vscode';

/**
 * Returns the HTML content for the HeapLens tabbed webview.
 *
 * Six tabs:
 * 1. Overview — summary stats + top 10 objects table + pie chart
 * 2. Histogram — sortable class histogram table with search
 * 3. Dominator Tree — expandable tree with lazy drill-down + optional sunburst
 * 4. Leak Suspects — card layout with severity indicators
 * 5. Source — browsable resolvable classes with source resolution status
 * 6. AI Chat — LLM-powered heap analysis Q&A
 */
export function getWebviewContent(_webview: vscode.Webview): string {
    const d3Uri = 'https://d3js.org/d3.v7.min.js';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://d3js.org; style-src 'unsafe-inline';">
    <title>HeapLens</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            overflow-x: hidden;
        }

        /* Tab bar */
        .tab-bar {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editorGroupHeader-tabsBackground);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .tab-btn {
            padding: 10px 20px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            font-size: 13px;
            border-bottom: 2px solid transparent;
            opacity: 0.7;
        }
        .tab-btn:hover { opacity: 1; }
        .tab-btn.active {
            opacity: 1;
            border-bottom-color: var(--vscode-focusBorder);
            color: var(--vscode-foreground);
        }

        /* Tab content */
        .tab-content { display: none; padding: 16px; }
        .tab-content.active { display: block; }

        /* Stats bar */
        .stats-bar {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
            margin-bottom: 20px;
        }
        .stat-card {
            padding: 12px 20px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            min-width: 140px;
        }
        .stat-card .label {
            font-size: 11px;
            text-transform: uppercase;
            opacity: 0.7;
            margin-bottom: 4px;
        }
        .stat-card .value {
            font-size: 20px;
            font-weight: bold;
        }

        /* Tables */
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }
        th, td {
            padding: 8px 12px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        th {
            background: var(--vscode-editorWidget-background);
            cursor: pointer;
            user-select: none;
            position: sticky;
            top: 42px;
            z-index: 10;
        }
        th:hover { background: var(--vscode-list-hoverBackground); }
        th .sort-arrow { margin-left: 4px; opacity: 0.5; }
        tr:hover { background: var(--vscode-list-hoverBackground); }
        .right { text-align: right; }

        /* Search */
        .search-box {
            padding: 6px 12px;
            margin-bottom: 12px;
            width: 100%;
            max-width: 400px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
        }
        .search-box:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        /* Dominator tree */
        .tree-row {
            display: flex;
            align-items: center;
            padding: 6px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .tree-row.expandable { cursor: pointer; }
        .tree-row:hover { background: var(--vscode-list-hoverBackground); }
        .tree-toggle { width: 20px; text-align: center; opacity: 0.6; flex-shrink: 0; font-size: 11px; }
        .tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .tree-type {
            font-size: 10px;
            padding: 1px 5px;
            border-radius: 3px;
            margin-left: 8px;
            flex-shrink: 0;
            opacity: 0.7;
        }
        .tree-type.array { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .tree-type.instance { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); }
        .tree-shallow { min-width: 80px; text-align: right; opacity: 0.5; font-size: 12px; }
        .tree-size { min-width: 90px; text-align: right; opacity: 0.8; }
        .tree-bar-wrap { width: 60px; flex-shrink: 0; margin: 0 8px; }
        .tree-bar { height: 4px; border-radius: 2px; background: var(--vscode-progressBar-background); min-width: 1px; }
        .tree-pct { min-width: 50px; text-align: right; opacity: 0.6; font-size: 12px; }
        .tree-children { padding-left: 20px; }
        .tree-source {
            margin-left: 6px;
            flex-shrink: 0;
            cursor: pointer;
            opacity: 0;
            font-size: 12px;
            transition: opacity 0.15s;
        }
        .tree-row:hover .tree-source { opacity: 0.6; }
        .tree-source:hover { opacity: 1 !important; }
        .dep-badge {
            display: inline-block;
            font-size: 10px;
            padding: 1px 6px;
            border-radius: 3px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            opacity: 0.8;
            margin-left: 6px;
            white-space: nowrap;
        }
        .dep-badge.workspace { background: var(--vscode-testing-iconPassed, #388a34); }
        .dep-badge.decompiled { opacity: 0.6; font-style: italic; }

        /* Leak suspect cards */
        .suspect-card {
            padding: 16px;
            margin-bottom: 12px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            border-left: 4px solid var(--vscode-editorWarning-foreground);
        }
        .suspect-card.high { border-left-color: var(--vscode-editorError-foreground); }
        .suspect-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .suspect-class { font-weight: bold; font-size: 14px; }
        .suspect-badge {
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: bold;
        }
        .suspect-badge.high {
            background: var(--vscode-editorError-foreground);
            color: var(--vscode-editor-background);
        }
        .suspect-badge.medium {
            background: var(--vscode-editorWarning-foreground);
            color: var(--vscode-editor-background);
        }
        .suspect-desc { opacity: 0.8; font-size: 13px; }
        .go-to-source-link {
            cursor: pointer;
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            margin-left: 8px;
        }
        .go-to-source-link:hover { text-decoration: underline; }

        /* Charts */
        #pie-chart { width: 100%; max-width: 500px; margin: 20px auto; }
        #sunburst-chart { width: 100%; display: flex; justify-content: center; margin-top: 16px; }

        /* AI Chat tab */
        .chat-container {
            display: flex;
            flex-direction: column;
            height: calc(100vh - 60px);
        }
        .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }
        .chat-bubble {
            max-width: 80%;
            padding: 10px 14px;
            margin-bottom: 10px;
            border-radius: 8px;
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .chat-bubble.user {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: auto;
            border-bottom-right-radius: 2px;
        }
        .chat-bubble.assistant {
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            margin-right: auto;
            border-bottom-left-radius: 2px;
        }
        .chat-bubble.error {
            background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
            border: 1px solid var(--vscode-editorError-foreground);
            margin-right: auto;
            border-bottom-left-radius: 2px;
        }
        .chat-input-row {
            display: flex;
            gap: 8px;
            padding: 12px 16px;
            border-top: 1px solid var(--vscode-panel-border);
            background: var(--vscode-editorWidget-background);
        }
        .chat-input {
            flex: 1;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
            font-family: inherit;
            resize: none;
            min-height: 36px;
            max-height: 120px;
        }
        .chat-input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .chat-send {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            align-self: flex-end;
        }
        .chat-send:hover { background: var(--vscode-button-hoverBackground); }
        .chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
        .chat-placeholder {
            text-align: center;
            opacity: 0.5;
            padding: 40px;
            font-size: 13px;
        }

        .loading {
            padding: 40px;
            text-align: center;
            opacity: 0.6;
            font-size: 14px;
        }

        .section-title {
            font-size: 16px;
            font-weight: bold;
            margin: 20px 0 12px 0;
        }

        .btn {
            padding: 6px 14px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            margin-right: 8px;
        }
        .btn:hover { background: var(--vscode-button-hoverBackground); }

        /* Source-not-found toast */
        .source-toast {
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            padding: 10px 20px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWarning-foreground, #cca700);
            border-radius: 6px;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.3s;
            z-index: 200;
            pointer-events: none;
            max-width: 80%;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .source-toast.visible { opacity: 1; }

        /* GC Root Path Breadcrumb */
        .gc-path-breadcrumb {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 10px 16px;
            margin-bottom: 12px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow-x: auto;
            white-space: nowrap;
            position: relative;
        }
        .gc-path-label {
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
            opacity: 0.6;
            margin-right: 8px;
            flex-shrink: 0;
        }
        .gc-path-node {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 12px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            flex-shrink: 0;
        }
        .gc-path-node.root {
            background: var(--vscode-testing-iconPassed, #388a34);
            color: #fff;
        }
        .gc-path-node.target {
            background: var(--vscode-editorError-foreground);
            color: #fff;
        }
        .gc-path-arrow {
            opacity: 0.4;
            font-size: 11px;
            flex-shrink: 0;
        }
        .gc-path-close {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            cursor: pointer;
            opacity: 0.5;
            font-size: 14px;
            padding: 2px 6px;
            border: none;
            background: none;
            color: var(--vscode-foreground);
        }
        .gc-path-close:hover { opacity: 1; }
        .tree-pin {
            margin-left: 6px;
            flex-shrink: 0;
            cursor: pointer;
            opacity: 0;
            font-size: 12px;
            transition: opacity 0.15s;
        }
        .tree-row:hover .tree-pin { opacity: 0.6; }
        .tree-pin:hover { opacity: 1 !important; }

        /* Auto-Diagnosis cards */
        .diagnosis-section { margin-bottom: 20px; }
        .diagnosis-card {
            padding: 12px 16px;
            margin-bottom: 8px;
            border-radius: 6px;
            font-size: 13px;
            border-left: 4px solid var(--vscode-panel-border);
            background: var(--vscode-editorWidget-background);
        }
        .diagnosis-card.critical {
            border-left-color: var(--vscode-editorError-foreground);
            background: color-mix(in srgb, var(--vscode-editorError-foreground) 8%, var(--vscode-editorWidget-background));
        }
        .diagnosis-card.warning {
            border-left-color: var(--vscode-editorWarning-foreground);
            background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 8%, var(--vscode-editorWidget-background));
        }
        .diagnosis-card.info {
            border-left-color: var(--vscode-focusBorder);
        }
        .diagnosis-severity {
            font-size: 10px;
            font-weight: bold;
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        .diagnosis-card.critical .diagnosis-severity { color: var(--vscode-editorError-foreground); }
        .diagnosis-card.warning .diagnosis-severity { color: var(--vscode-editorWarning-foreground); }
        .diagnosis-card.info .diagnosis-severity { color: var(--vscode-focusBorder); }
        .diagnosis-title { font-weight: bold; margin-bottom: 4px; }
        .diagnosis-detail { opacity: 0.8; font-size: 12px; }

        /* Report button */
        #report-actions {
            display: none;
            margin-bottom: 16px;
        }
        .report-copied {
            display: inline-block;
            margin-left: 8px;
            font-size: 12px;
            color: var(--vscode-testing-iconPassed, #388a34);
            opacity: 0;
            transition: opacity 0.3s;
        }
        .report-copied.visible { opacity: 1; }

        /* Source tab */
        .source-status {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            margin-right: 6px;
            vertical-align: middle;
        }
        .source-status.not-tried { background: var(--vscode-panel-border); }
        .source-status.resolving { background: var(--vscode-focusBorder); animation: pulse 1s infinite; }
        .source-status.found { background: var(--vscode-testing-iconPassed, #388a34); }
        .source-status.not-found { background: var(--vscode-editorError-foreground); opacity: 0.5; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .source-view-btn {
            padding: 3px 10px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }
        .source-view-btn:hover { background: var(--vscode-button-hoverBackground); }
        .source-view-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .source-stats {
            font-size: 12px;
            opacity: 0.6;
            margin-bottom: 12px;
        }
    </style>
</head>
<body>
    <div class="tab-bar">
        <button class="tab-btn active" data-tab="overview">Overview</button>
        <button class="tab-btn" data-tab="histogram">Histogram</button>
        <button class="tab-btn" data-tab="domtree">Dominator Tree</button>
        <button class="tab-btn" data-tab="leaks">Leak Suspects</button>
        <button class="tab-btn" data-tab="source">Source</button>
        <button class="tab-btn" data-tab="chat">AI Chat</button>
    </div>

    <!-- Tab 1: Overview -->
    <div id="tab-overview" class="tab-content active">
        <div class="stats-bar" id="stats-bar">
            <div class="loading">Waiting for analysis...</div>
        </div>
        <div id="report-actions">
            <button class="btn" id="copy-report-btn">Copy Incident Report</button>
            <span class="report-copied" id="report-copied">Copied!</span>
        </div>
        <div id="diagnosis-section" class="diagnosis-section"></div>
        <div class="section-title">Top Objects by Retained Size</div>
        <div id="top-objects-table"></div>
        <div class="section-title">Heap Composition</div>
        <div id="pie-chart"></div>
    </div>

    <!-- Tab 2: Histogram -->
    <div id="tab-histogram" class="tab-content">
        <input type="text" class="search-box" id="histogram-search" placeholder="Filter by class name...">
        <div id="histogram-table"></div>
    </div>

    <!-- Tab 3: Dominator Tree -->
    <div id="tab-domtree" class="tab-content">
        <button class="btn" id="reset-tree-btn" style="display:none; margin-bottom: 12px;">Back to Root</button>
        <div id="domtree-header" style="display:none;">
            <div class="tree-row" style="opacity:0.6; font-size:11px; border-bottom:2px solid var(--vscode-panel-border); cursor:default;">
                <span class="tree-toggle"></span>
                <span class="tree-name" style="font-weight:bold;">Class / Object</span>
                <span class="tree-type" style="background:none; border:none;">Type</span>
                <span class="tree-shallow" style="font-weight:bold;">Shallow</span>
                <span class="tree-size" style="font-weight:bold;">Retained</span>
                <span class="tree-bar-wrap"></span>
                <span class="tree-pct" style="font-weight:bold;">%</span>
            </div>
        </div>
        <div id="dominator-tree"><div class="loading">Waiting for analysis...</div></div>
        <div id="sunburst-chart"></div>
    </div>

    <!-- Tab 4: Leak Suspects -->
    <div id="tab-leaks" class="tab-content">
        <div id="leak-suspects"><div class="loading">Waiting for analysis...</div></div>
    </div>

    <!-- Tab 5: Source -->
    <div id="tab-source" class="tab-content">
        <input type="text" class="search-box" id="source-search" placeholder="Filter by class name...">
        <div class="source-stats" id="source-stats"></div>
        <div id="source-table"><div class="loading">Waiting for analysis...</div></div>
    </div>

    <!-- Tab 6: AI Chat -->
    <div id="tab-chat" class="tab-content">
        <div class="chat-container">
            <div class="chat-messages" id="chat-messages">
                <div class="chat-placeholder" id="chat-placeholder">
                    Ask questions about your heap dump analysis.<br>
                    Configure your API key in Settings > HeapLens to get started.
                </div>
            </div>
            <div class="chat-input-row">
                <textarea class="chat-input" id="chat-input" placeholder="Ask about your heap dump..." rows="1"></textarea>
                <button class="chat-send" id="chat-send">Send</button>
            </div>
        </div>
    </div>

    <div id="gc-path-container"></div>
    <div class="source-toast" id="source-toast"></div>

    <script src="${d3Uri}"></script>
    <script>
    (function() {
        const vscode = acquireVsCodeApi();

        // State
        let analysisData = null;
        let histogramSortCol = 'retained_size';
        let histogramSortAsc = false;
        let histogramFilter = '';
        const depInfoCache = {};

        // Source tab state
        let sourceSortCol = 'retained_size';
        let sourceSortAsc = false;
        let sourceFilter = '';
        const sourceStatusMap = {};

        // ---- Tab switching ----
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
            });
        });

        // ---- Message handling ----
        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.command) {
                case 'analysisComplete':
                    analysisData = msg;
                    renderOverview(msg);
                    renderHistogram(msg.classHistogram || []);
                    renderDominatorTree(msg.topLayers || []);
                    renderLeakSuspects(msg.leakSuspects || []);
                    renderSourceTab(msg.classHistogram || []);
                    break;
                case 'childrenResponse':
                    expandTreeNode(msg.objectId, msg.children);
                    break;
                case 'noChildren':
                    console.log('[HeapLens] noChildren received for:', msg.objectId);
                    markLeaf(msg.objectId);
                    break;
                case 'sourceNotFound':
                    showSourceToast(msg.className);
                    sourceStatusMap[msg.className] = 'not-found';
                    updateSourceRow(msg.className);
                    break;
                case 'dependencyResolved':
                    depInfoCache[msg.className] = { tier: msg.tier, dependency: msg.dependency };
                    updateDependencyBadges(msg.className, msg.tier, msg.dependency);
                    sourceStatusMap[msg.className] = 'found';
                    updateSourceRow(msg.className);
                    break;
                case 'gcRootPathResponse':
                    renderGcRootPath(msg.path);
                    break;
                case 'reportCopied':
                    showReportCopied();
                    break;
                case 'error':
                    showError(msg.message);
                    break;
            }
        });

        vscode.postMessage({ command: 'ready' });

        // ---- Helpers ----
        function fmt(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return (bytes / Math.pow(k, i)).toFixed(i > 1 ? 2 : 0) + ' ' + sizes[i];
        }

        function fmtNum(n) {
            return n.toLocaleString();
        }

        function showError(message) {
            document.getElementById('stats-bar').innerHTML =
                '<div class="loading" style="color: var(--vscode-editorError-foreground);">Error: ' + escapeHtml(message) + '</div>';
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        function isResolvableClass(className) {
            if (!className) return false;
            const primArrays = ['byte[]','short[]','int[]','long[]','float[]','double[]','char[]','boolean[]'];
            if (primArrays.indexOf(className) !== -1) return false;
            const prefixes = ['java.','javax.','sun.','com.sun.','jdk.'];
            for (let i = 0; i < prefixes.length; i++) {
                if (className.indexOf(prefixes[i]) === 0) return false;
            }
            return true;
        }

        let toastTimer = null;
        function showSourceToast(className) {
            const toast = document.getElementById('source-toast');
            toast.textContent = 'No source found for ' + className + '. Open a Java project with source files in this workspace.';
            toast.classList.add('visible');
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove('visible'), 5000);
        }

        function makeBadgeHtml(tier, dep) {
            let text, tooltip, cls;
            if (tier === 'workspace') {
                text = 'workspace';
                tooltip = 'Resolved from workspace source';
                cls = 'dep-badge workspace';
            } else {
                text = dep ? dep.artifactId + ':' + dep.version : tier;
                tooltip = dep ? dep.groupId + ':' + dep.artifactId + ':' + dep.version + ' (' + tier + ')' : tier;
                cls = 'dep-badge' + (tier === 'decompiled' ? ' decompiled' : '');
            }
            return '<span class="' + cls + '" title="' + escapeHtml(tooltip) + '">' + escapeHtml(text) + '</span>';
        }

        function updateDependencyBadges(className, tier, dep) {
            const badgeHtml = makeBadgeHtml(tier, dep);

            // Update leak suspect cards
            document.querySelectorAll('.go-to-source-link[data-class="' + className + '"]').forEach(function(link) {
                // Remove existing badge if present
                const existing = link.parentElement.querySelector('.dep-badge');
                if (existing) existing.remove();
                link.insertAdjacentHTML('afterend', badgeHtml);
            });

            // Update dominator tree rows
            document.querySelectorAll('.tree-row').forEach(function(row) {
                const nameEl = row.querySelector('.tree-name');
                if (nameEl && nameEl.textContent === className) {
                    // Remove existing badge if present
                    const existing = row.querySelector('.dep-badge');
                    if (existing) existing.remove();
                    const sourceEl = row.querySelector('.tree-source');
                    if (sourceEl) {
                        sourceEl.insertAdjacentHTML('afterend', badgeHtml);
                    }
                }
            });
        }

        // ---- Tab 1: Overview ----
        function renderOverview(data) {
            const s = data.summary;
            if (s) {
                document.getElementById('stats-bar').innerHTML = [
                    { label: 'Reachable Heap', value: fmt(s.reachable_heap_size || s.total_heap_size) },
                    { label: 'Total Heap', value: fmt(s.total_heap_size) },
                    { label: 'Objects', value: fmtNum(s.total_instances) },
                    { label: 'Classes', value: fmtNum(s.total_classes) },
                    { label: 'Arrays', value: fmtNum(s.total_arrays) },
                    { label: 'GC Roots', value: fmtNum(s.total_gc_roots) }
                ].map(c => '<div class="stat-card"><div class="label">' + c.label + '</div><div class="value">' + c.value + '</div></div>').join('');
            }

            // Top 10 objects table
            const objs = (data.topObjects || []).filter(o => o.node_type !== 'Class' && o.node_type !== 'SuperRoot' && o.retained_size > 0).slice(0, 10);
            let html = '<table><thead><tr><th>#</th><th>Class</th><th>Type</th><th class="right">Shallow</th><th class="right">Retained</th></tr></thead><tbody>';
            objs.forEach((o, i) => {
                html += '<tr><td>' + (i+1) + '</td><td>' + escapeHtml(o.class_name || o.node_type) + '</td><td>' + o.node_type + '</td><td class="right">' + fmt(o.shallow_size) + '</td><td class="right">' + fmt(o.retained_size) + '</td></tr>';
            });
            html += '</tbody></table>';
            document.getElementById('top-objects-table').innerHTML = html;

            // Pie chart
            renderPieChart(objs);

            // Show report button
            document.getElementById('report-actions').style.display = 'block';

            // Auto-diagnosis
            renderDiagnosis(data);
        }

        function renderPieChart(objs) {
            if (typeof d3 === 'undefined' || objs.length === 0) return;
            const container = document.getElementById('pie-chart');
            container.innerHTML = '';
            const w = 400, h = 400, r = Math.min(w, h) / 2;

            const svg = d3.select(container).append('svg').attr('width', w).attr('height', h);
            const g = svg.append('g').attr('transform', 'translate(' + w/2 + ',' + h/2 + ')');

            const color = d3.scaleOrdinal(d3.schemeCategory10);
            const pie = d3.pie().value(d => d.retained_size).sort(null);
            const arc = d3.arc().innerRadius(r * 0.4).outerRadius(r - 10);

            const arcs = g.selectAll('path').data(pie(objs)).enter().append('path')
                .attr('d', arc)
                .attr('fill', (d, i) => color(i))
                .attr('stroke', 'var(--vscode-editor-background)')
                .attr('stroke-width', 2)
                .style('opacity', 0.85);

            arcs.append('title').text(d => (d.data.class_name || d.data.node_type) + ': ' + fmt(d.data.retained_size));
        }

        // ---- Tab 2: Histogram ----
        function renderHistogram(histogram) {
            const container = document.getElementById('histogram-table');
            let sorted = [...histogram];

            sorted.sort((a, b) => {
                const va = a[histogramSortCol], vb = b[histogramSortCol];
                if (typeof va === 'string') return histogramSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                return histogramSortAsc ? va - vb : vb - va;
            });

            if (histogramFilter) {
                const f = histogramFilter.toLowerCase();
                sorted = sorted.filter(e => e.class_name.toLowerCase().includes(f));
            }

            const cols = [
                { key: 'class_name', label: 'Class Name', cls: '' },
                { key: 'instance_count', label: 'Instances', cls: 'right' },
                { key: 'shallow_size', label: 'Shallow Size', cls: 'right' },
                { key: 'retained_size', label: 'Retained Size', cls: 'right' }
            ];

            let html = '<table><thead><tr>';
            cols.forEach(c => {
                const arrow = histogramSortCol === c.key ? (histogramSortAsc ? ' ▲' : ' ▼') : '';
                html += '<th class="' + c.cls + '" data-sort="' + c.key + '">' + c.label + '<span class="sort-arrow">' + arrow + '</span></th>';
            });
            html += '</tr></thead><tbody>';

            sorted.forEach(e => {
                html += '<tr><td>' + escapeHtml(e.class_name) + '</td><td class="right">' + fmtNum(e.instance_count) + '</td><td class="right">' + fmt(e.shallow_size) + '</td><td class="right">' + fmt(e.retained_size) + '</td></tr>';
            });
            html += '</tbody></table>';
            container.innerHTML = html;

            // Sort click handlers
            container.querySelectorAll('th[data-sort]').forEach(th => {
                th.addEventListener('click', () => {
                    const col = th.dataset.sort;
                    if (histogramSortCol === col) histogramSortAsc = !histogramSortAsc;
                    else { histogramSortCol = col; histogramSortAsc = false; }
                    renderHistogram(histogram);
                });
            });
        }

        document.getElementById('histogram-search').addEventListener('input', (e) => {
            histogramFilter = e.target.value;
            if (analysisData) renderHistogram(analysisData.classHistogram || []);
        });

        // ---- Tab 3: Dominator Tree ----
        let treeData = [];
        let totalRetained = 0;

        const PRIMITIVE_ARRAYS = new Set([
            'byte[]', 'short[]', 'int[]', 'long[]',
            'float[]', 'double[]', 'char[]', 'boolean[]'
        ]);

        function isLeafType(obj) {
            return PRIMITIVE_ARRAYS.has(obj.class_name);
        }

        function renderDominatorTree(layers) {
            treeData = layers.filter(o => o.node_type !== 'Class' && o.node_type !== 'SuperRoot' && o.retained_size > 0);
            totalRetained = treeData.reduce((sum, o) => sum + o.retained_size, 0);

            document.getElementById('domtree-header').style.display = treeData.length > 0 ? 'block' : 'none';
            document.getElementById('reset-tree-btn').style.display = treeData.length > 0 ? 'inline-block' : 'none';

            const container = document.getElementById('dominator-tree');
            container.innerHTML = '';

            treeData.forEach(obj => {
                container.appendChild(createTreeRow(obj, 0));
            });
        }

        function createTreeRow(obj, depth) {
            const leaf = isLeafType(obj);
            const row = document.createElement('div');
            row.className = 'tree-row' + (leaf ? '' : ' expandable');
            row.style.paddingLeft = (12 + depth * 20) + 'px';
            row.dataset.objectId = obj.object_id;
            row.dataset.depth = depth;

            const pct = totalRetained > 0 ? ((obj.retained_size / totalRetained) * 100) : 0;
            const pctStr = pct.toFixed(1);
            const barWidth = Math.max(1, Math.min(100, pct));
            const displayName = obj.class_name || obj.node_type;
            const typeCls = obj.node_type === 'Array' ? 'array' : 'instance';

            const showSource = (obj.node_type === 'Instance' || obj.node_type === 'Array') && isResolvableClass(displayName);

            const cachedDep = depInfoCache[displayName];
            const depBadge = cachedDep ? makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';

            const showPin = obj.object_id > 0;

            row.innerHTML =
                '<span class="tree-toggle">' + (leaf ? '' : '▶') + '</span>' +
                '<span class="tree-name">' + escapeHtml(displayName) + '</span>' +
                '<span class="tree-type ' + typeCls + '">' + obj.node_type + '</span>' +
                '<span class="tree-shallow">' + fmt(obj.shallow_size) + '</span>' +
                '<span class="tree-size">' + fmt(obj.retained_size) + '</span>' +
                '<span class="tree-bar-wrap"><div class="tree-bar" style="width:' + barWidth + '%"></div></span>' +
                '<span class="tree-pct">' + pctStr + '%</span>' +
                (showPin ? '<span class="tree-pin" title="Show GC root path">&#x1F4CD;</span>' : '') +
                (showSource ? '<span class="tree-source" title="Go to source">&#8599;</span>' : '') +
                depBadge;

            if (!leaf) {
                row.addEventListener('click', () => {
                    const toggle = row.querySelector('.tree-toggle');
                    const childContainer = row.nextElementSibling;

                    if (childContainer && childContainer.classList.contains('tree-children')) {
                        childContainer.style.display = childContainer.style.display === 'none' ? 'block' : 'none';
                        toggle.textContent = childContainer.style.display === 'none' ? '▶' : '▼';
                    } else if (toggle.textContent !== '·') {
                        toggle.textContent = '⏳';
                        vscode.postMessage({ command: 'getChildren', objectId: obj.object_id });
                    }
                });
            }

            if (showPin) {
                row.querySelector('.tree-pin').addEventListener('click', (e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'gcRootPath', objectId: obj.object_id });
                });
            }

            if (showSource) {
                row.querySelector('.tree-source').addEventListener('click', (e) => {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'goToSource', className: displayName });
                });
            }

            return row;
        }

        function expandTreeNode(objectId, children) {
            const rows = document.querySelectorAll('.tree-row[data-object-id="' + objectId + '"]');
            rows.forEach(row => {
                const toggle = row.querySelector('.tree-toggle');
                const existing = row.nextElementSibling;
                if (existing && existing.classList.contains('tree-children')) {
                    existing.remove();
                }

                const depth = parseInt(row.dataset.depth || '0') + 1;
                const filtered = children.filter(c => c.node_type !== 'Class' && c.retained_size > 0);

                if (filtered.length === 0) {
                    toggle.textContent = '·';
                    row.classList.remove('expandable');
                    return;
                }

                toggle.textContent = '▼';

                const childContainer = document.createElement('div');
                childContainer.className = 'tree-children';

                filtered.forEach(child => {
                    childContainer.appendChild(createTreeRow(child, depth));
                });

                row.after(childContainer);
            });
        }

        function markLeaf(objectId) {
            const selector = '.tree-row[data-object-id="' + objectId + '"]';
            const rows = document.querySelectorAll(selector);
            console.log('[HeapLens] markLeaf:', objectId, 'selector:', selector, 'matched:', rows.length);
            rows.forEach(row => {
                const toggle = row.querySelector('.tree-toggle');
                toggle.textContent = '·';
                row.classList.remove('expandable');
            });
        }

        document.getElementById('reset-tree-btn').addEventListener('click', () => {
            if (analysisData) renderDominatorTree(analysisData.topLayers || []);
        });

        // ---- Tab 5: Source ----
        let sourceHistogram = [];

        function renderSourceTab(histogram) {
            sourceHistogram = histogram.filter(e => isResolvableClass(e.class_name));

            // Deduplicate by class name (keep entry with largest retained_size)
            const seen = {};
            sourceHistogram = sourceHistogram.filter(e => {
                if (seen[e.class_name]) return false;
                seen[e.class_name] = true;
                return true;
            });

            renderSourceTable();
        }

        function renderSourceTable() {
            const container = document.getElementById('source-table');
            let sorted = [...sourceHistogram];

            sorted.sort((a, b) => {
                const va = a[sourceSortCol], vb = b[sourceSortCol];
                if (typeof va === 'string') return sourceSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                return sourceSortAsc ? va - vb : vb - va;
            });

            if (sourceFilter) {
                const f = sourceFilter.toLowerCase();
                sorted = sorted.filter(e => e.class_name.toLowerCase().includes(f));
            }

            // Update stats
            const resolvedCount = sourceHistogram.filter(e => sourceStatusMap[e.class_name] === 'found').length;
            document.getElementById('source-stats').textContent =
                sorted.length + ' resolvable class' + (sorted.length !== 1 ? 'es' : '') +
                ' \\u00b7 ' + resolvedCount + ' resolved';

            const cols = [
                { key: 'class_name', label: 'Class Name', cls: '' },
                { key: 'instance_count', label: 'Instances', cls: 'right' },
                { key: 'retained_size', label: 'Retained Size', cls: 'right' },
                { key: '_status', label: 'Status', cls: '' },
                { key: '_action', label: '', cls: '' }
            ];

            let html = '<table><thead><tr>';
            cols.forEach(c => {
                if (c.key.startsWith('_')) {
                    html += '<th class="' + c.cls + '">' + c.label + '</th>';
                } else {
                    const arrow = sourceSortCol === c.key ? (sourceSortAsc ? ' \\u25B2' : ' \\u25BC') : '';
                    html += '<th class="' + c.cls + '" data-source-sort="' + c.key + '">' + c.label + '<span class="sort-arrow">' + arrow + '</span></th>';
                }
            });
            html += '</tr></thead><tbody>';

            sorted.forEach(e => {
                const cn = e.class_name;
                const status = sourceStatusMap[cn] || 'not-tried';
                const cachedDep = depInfoCache[cn];
                const badge = cachedDep ? ' ' + makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';
                const statusLabel = status === 'not-tried' ? '' : status === 'resolving' ? 'resolving...' : status === 'found' ? 'found' : 'not found';
                const btnDisabled = status === 'resolving' || status === 'found' ? ' disabled' : '';

                html += '<tr data-source-class="' + escapeHtml(cn) + '">' +
                    '<td>' + escapeHtml(cn) + '</td>' +
                    '<td class="right">' + fmtNum(e.instance_count) + '</td>' +
                    '<td class="right">' + fmt(e.retained_size) + '</td>' +
                    '<td><span class="source-status ' + status + '"></span>' + statusLabel + badge + '</td>' +
                    '<td><button class="source-view-btn" data-class="' + escapeHtml(cn) + '"' + btnDisabled + '>View Source</button></td>' +
                    '</tr>';
            });
            html += '</tbody></table>';
            container.innerHTML = html;

            // Sort click handlers
            container.querySelectorAll('th[data-source-sort]').forEach(th => {
                th.addEventListener('click', () => {
                    const col = th.dataset.sourceSort;
                    if (sourceSortCol === col) sourceSortAsc = !sourceSortAsc;
                    else { sourceSortCol = col; sourceSortAsc = false; }
                    renderSourceTable();
                });
            });

            // View Source click handlers
            container.querySelectorAll('.source-view-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const cn = btn.dataset.class;
                    if (sourceStatusMap[cn] === 'found') return;
                    sourceStatusMap[cn] = 'resolving';
                    updateSourceRow(cn);
                    vscode.postMessage({ command: 'goToSource', className: cn });
                });
            });
        }

        function updateSourceRow(className) {
            const row = document.querySelector('tr[data-source-class="' + className + '"]');
            if (!row) return;

            const status = sourceStatusMap[className] || 'not-tried';
            const cachedDep = depInfoCache[className];
            const badge = cachedDep ? ' ' + makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';
            const statusLabel = status === 'not-tried' ? '' : status === 'resolving' ? 'resolving...' : status === 'found' ? 'found' : 'not found';

            // Update status cell (4th td)
            const cells = row.querySelectorAll('td');
            if (cells.length >= 4) {
                cells[3].innerHTML = '<span class="source-status ' + status + '"></span>' + statusLabel + badge;
            }

            // Update button state (5th td)
            if (cells.length >= 5) {
                const btn = cells[4].querySelector('.source-view-btn');
                if (btn) btn.disabled = (status === 'resolving' || status === 'found');
            }

            // Update resolved count in stats
            const resolvedCount = sourceHistogram.filter(e => sourceStatusMap[e.class_name] === 'found').length;
            const statsEl = document.getElementById('source-stats');
            if (statsEl) {
                const total = sourceFilter
                    ? sourceHistogram.filter(e => e.class_name.toLowerCase().includes(sourceFilter.toLowerCase())).length
                    : sourceHistogram.length;
                statsEl.textContent = total + ' resolvable class' + (total !== 1 ? 'es' : '') +
                    ' \\u00b7 ' + resolvedCount + ' resolved';
            }
        }

        document.getElementById('source-search').addEventListener('input', (e) => {
            sourceFilter = e.target.value;
            if (analysisData) renderSourceTable();
        });

        // ---- Tab 6: AI Chat ----
        const chatMessages = document.getElementById('chat-messages');
        const chatInput = document.getElementById('chat-input');
        const chatSend = document.getElementById('chat-send');
        const chatPlaceholder = document.getElementById('chat-placeholder');
        let currentAssistantBubble = null;
        let isChatStreaming = false;

        function addChatBubble(role, text) {
            if (chatPlaceholder) chatPlaceholder.style.display = 'none';
            const bubble = document.createElement('div');
            bubble.className = 'chat-bubble ' + role;
            bubble.textContent = text;
            chatMessages.appendChild(bubble);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return bubble;
        }

        function sendChatMessage() {
            const text = chatInput.value.trim();
            if (!text || isChatStreaming) return;

            addChatBubble('user', text);
            chatInput.value = '';
            chatInput.style.height = 'auto';

            // Create empty assistant bubble for streaming
            currentAssistantBubble = addChatBubble('assistant', '');
            isChatStreaming = true;
            chatSend.disabled = true;

            vscode.postMessage({ command: 'chatMessage', text: text });
        }

        chatSend.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });

        // Auto-resize textarea
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        });

        // Handle chat streaming messages
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'chatChunk' && currentAssistantBubble) {
                currentAssistantBubble.textContent += msg.text;
                chatMessages.scrollTop = chatMessages.scrollHeight;
            } else if (msg.command === 'chatDone') {
                isChatStreaming = false;
                chatSend.disabled = false;
                currentAssistantBubble = null;
            } else if (msg.command === 'chatError') {
                isChatStreaming = false;
                chatSend.disabled = false;
                currentAssistantBubble = null;
                addChatBubble('error', msg.message || 'An error occurred');
            }
        });

        // ---- Tab 4: Leak Suspects ----
        function renderLeakSuspects(suspects) {
            const container = document.getElementById('leak-suspects');
            if (!suspects || suspects.length === 0) {
                container.innerHTML = '<div class="loading">No leak suspects detected (no single object or class retains >10% of heap)</div>';
                return;
            }

            container.innerHTML = suspects.map(s => {
                const severity = s.retained_percentage > 30 ? 'high' : 'medium';
                const sourceLink = isResolvableClass(s.class_name)
                    ? ' | <a class="go-to-source-link" data-class="' + escapeHtml(s.class_name) + '">View Source</a>'
                    : '';
                const gcPathLink = s.object_id
                    ? ' | <a class="gc-path-link" data-object-id="' + s.object_id + '" style="cursor:pointer;color:var(--vscode-textLink-foreground);">GC Path</a>'
                    : '';
                const cachedDep = depInfoCache[s.class_name];
                const depBadge = cachedDep ? makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';
                return '<div class="suspect-card ' + severity + '" data-class="' + escapeHtml(s.class_name) + '">' +
                    '<div class="suspect-header">' +
                    '<span class="suspect-class">' + escapeHtml(s.class_name) + '</span>' +
                    '<span class="suspect-badge ' + severity + '">' + s.retained_percentage.toFixed(1) + '%</span>' +
                    '</div>' +
                    '<div class="suspect-desc">' + escapeHtml(s.description) + '</div>' +
                    '<div style="margin-top:8px;opacity:0.6;font-size:12px;">Retained: ' + fmt(s.retained_size) +
                    (s.object_id ? ' | Object ID: ' + s.object_id : '') +
                    sourceLink + gcPathLink + depBadge + '</div>' +
                    '</div>';
            }).join('');

            // Wire up "View Source" click handlers
            container.querySelectorAll('.go-to-source-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    vscode.postMessage({ command: 'goToSource', className: link.dataset.class });
                });
            });

            // Wire up "GC Path" click handlers
            container.querySelectorAll('.gc-path-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const objectId = parseInt(link.dataset.objectId, 10);
                    if (objectId) vscode.postMessage({ command: 'gcRootPath', objectId: objectId });
                });
            });
        }
        // ---- GC Root Path ----
        function closeGcPath() {
            document.getElementById('gc-path-container').innerHTML = '';
        }

        function renderGcRootPath(path) {
            const container = document.getElementById('gc-path-container');
            if (!path || path.length === 0) {
                container.innerHTML = '<div class="gc-path-breadcrumb"><span class="gc-path-label">GC Path</span><span style="opacity:0.5;font-size:12px;">No path to GC root found</span><button class="gc-path-close">&times;</button></div>';
                container.querySelector('.gc-path-close').addEventListener('click', closeGcPath);
                return;
            }

            let html = '<div class="gc-path-breadcrumb"><span class="gc-path-label">GC Path</span>';
            path.forEach(function(node, i) {
                const isRoot = node.node_type === 'Root' || node.node_type === 'SuperRoot';
                const isTarget = i === path.length - 1;
                const cls = isRoot ? 'root' : isTarget ? 'target' : '';
                const label = node.class_name || node.node_type;
                const title = label + ' (' + fmt(node.retained_size) + ')';
                if (i > 0) html += '<span class="gc-path-arrow">&#9654;</span>';
                html += '<span class="gc-path-node ' + cls + '" title="' + escapeHtml(title) + '">' + escapeHtml(label) + '</span>';
            });
            html += '<button class="gc-path-close">&times;</button></div>';
            container.innerHTML = html;
            container.querySelector('.gc-path-close').addEventListener('click', closeGcPath);
        }

        // ---- Incident Report ----
        document.getElementById('copy-report-btn').addEventListener('click', function() {
            vscode.postMessage({ command: 'copyReport' });
        });

        function showReportCopied() {
            const el = document.getElementById('report-copied');
            el.classList.add('visible');
            setTimeout(function() { el.classList.remove('visible'); }, 3000);
        }

        // ---- Auto-Diagnosis ----
        function getRecommendation(className, severity) {
            const cn = className.toLowerCase();
            if (cn.indexOf('cache') !== -1 || cn.indexOf('cach') !== -1) {
                return severity === 'critical'
                    ? 'Cache is consuming excessive memory. Check eviction policy, consider bounded caches (LRU/LFU), or reduce max size.'
                    : 'Review cache eviction settings and TTL configuration.';
            }
            if (cn.indexOf('pool') !== -1 || cn.indexOf('connection') !== -1 || cn.indexOf('datasource') !== -1) {
                return 'Check for connection leaks. Ensure connections are closed after use. Review pool max size and idle timeout settings.';
            }
            if (cn.indexOf('session') !== -1 || cn.indexOf('httpsession') !== -1) {
                return 'Check session timeout settings. Look for session attributes storing large objects. Consider session size limits.';
            }
            if (cn.indexOf('queue') !== -1 || cn.indexOf('buffer') !== -1 || cn.indexOf('blocking') !== -1) {
                return 'Possible backpressure issue. Check consumer throughput, queue capacity limits, and producer rate.';
            }
            if (cn.indexOf('thread') !== -1) {
                return 'Check for thread pool exhaustion or thread-local leaks. Review pool sizing.';
            }
            if (cn === 'byte[]' || cn === 'char[]') {
                return severity === 'critical'
                    ? 'Large byte/char arrays suggest buffering or serialization issues. Check for unclosed streams, large response bodies, or excessive string operations.'
                    : 'Review buffer sizes and ensure streams are properly closed.';
            }
            if (severity === 'critical') {
                return 'This class retains a very large portion of the heap. Investigate why these objects are not being garbage collected.';
            }
            return 'Consider if the number of instances and retained size are expected for your application workload.';
        }

        function renderDiagnosis(data) {
            const section = document.getElementById('diagnosis-section');
            if (!data.summary || !data.classHistogram) {
                section.innerHTML = '';
                return;
            }

            const totalHeap = data.summary.reachable_heap_size || data.summary.total_heap_size;
            if (totalHeap === 0) { section.innerHTML = ''; return; }

            const findings = [];

            // Check leak suspects
            const suspects = data.leakSuspects || [];
            suspects.forEach(function(s) {
                if (s.retained_percentage > 50) {
                    findings.push({
                        severity: 'critical',
                        title: s.class_name + ' retains ' + s.retained_percentage.toFixed(1) + '% of heap',
                        detail: getRecommendation(s.class_name, 'critical')
                    });
                } else if (s.retained_percentage > 20) {
                    findings.push({
                        severity: 'warning',
                        title: s.class_name + ' retains ' + s.retained_percentage.toFixed(1) + '% of heap',
                        detail: getRecommendation(s.class_name, 'warning')
                    });
                }
            });

            // Check class histogram patterns
            const histogram = data.classHistogram || [];
            histogram.forEach(function(entry) {
                const pct = (entry.retained_size / totalHeap) * 100;
                const cn = entry.class_name;
                const cnLower = cn.toLowerCase();

                // byte[]/char[] > 20% of heap
                if ((cn === 'byte[]' || cn === 'char[]') && pct > 20) {
                    const alreadyReported = findings.some(function(f) { return f.title.indexOf(cn) !== -1; });
                    if (!alreadyReported) {
                        findings.push({
                            severity: 'warning',
                            title: cn + ' occupies ' + pct.toFixed(1) + '% of heap',
                            detail: getRecommendation(cn, 'warning')
                        });
                    }
                }

                // Pattern matching for known problematic classes
                if (pct > 10) {
                    const patterns = ['cache', 'pool', 'connection', 'session', 'queue', 'buffer'];
                    patterns.forEach(function(pat) {
                        if (cnLower.indexOf(pat) !== -1) {
                            const alreadyReported = findings.some(function(f) { return f.title.indexOf(cn) !== -1; });
                            if (!alreadyReported) {
                                findings.push({
                                    severity: pct > 30 ? 'critical' : 'warning',
                                    title: cn + ' pattern detected (' + pct.toFixed(1) + '% heap)',
                                    detail: getRecommendation(cn, pct > 30 ? 'critical' : 'warning')
                                });
                            }
                        }
                    });
                }

                // Instance count > 100K with > 3% heap
                if (entry.instance_count > 100000 && pct > 3) {
                    const alreadyReported = findings.some(function(f) { return f.title.indexOf(cn) !== -1; });
                    if (!alreadyReported) {
                        findings.push({
                            severity: 'info',
                            title: fmtNum(entry.instance_count) + ' instances of ' + cn + ' (' + pct.toFixed(1) + '% heap)',
                            detail: 'High instance count may indicate object accumulation. Check if objects are being properly released.'
                        });
                    }
                }
            });

            // Sort: critical > warning > info
            const order = { critical: 0, warning: 1, info: 2 };
            findings.sort(function(a, b) { return order[a.severity] - order[b.severity]; });

            if (findings.length === 0) {
                section.innerHTML = '';
                return;
            }

            let html = '<div class="section-title">Auto-Diagnosis</div>';
            findings.forEach(function(f) {
                html += '<div class="diagnosis-card ' + f.severity + '">' +
                    '<div class="diagnosis-severity">' + f.severity.toUpperCase() + '</div>' +
                    '<div class="diagnosis-title">' + escapeHtml(f.title) + '</div>' +
                    '<div class="diagnosis-detail">' + escapeHtml(f.detail) + '</div>' +
                    '</div>';
            });
            section.innerHTML = html;
        }
    })();
    </script>
</body>
</html>`;
}
