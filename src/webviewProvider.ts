import * as vscode from 'vscode';

/**
 * Returns the HTML content for the HeapLens tabbed webview.
 *
 * Four tabs:
 * 1. Overview — summary stats + top 10 objects table + pie chart
 * 2. Histogram — sortable class histogram table with search
 * 3. Dominator Tree — expandable tree with lazy drill-down + optional sunburst
 * 4. Leak Suspects — card layout with severity indicators
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
            right: 20px;
            padding: 8px 16px;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.3s;
            z-index: 200;
            pointer-events: none;
        }
        .source-toast.visible { opacity: 1; }
    </style>
</head>
<body>
    <div class="tab-bar">
        <button class="tab-btn active" data-tab="overview">Overview</button>
        <button class="tab-btn" data-tab="histogram">Histogram</button>
        <button class="tab-btn" data-tab="domtree">Dominator Tree</button>
        <button class="tab-btn" data-tab="leaks">Leak Suspects</button>
        <button class="tab-btn" data-tab="chat">AI Chat</button>
    </div>

    <!-- Tab 1: Overview -->
    <div id="tab-overview" class="tab-content active">
        <div class="stats-bar" id="stats-bar">
            <div class="loading">Waiting for analysis...</div>
        </div>
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

    <!-- Tab 5: AI Chat -->
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
            toast.textContent = 'Source not found: ' + className;
            toast.classList.add('visible');
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
        }

        // ---- Tab 1: Overview ----
        function renderOverview(data) {
            const s = data.summary;
            if (s) {
                document.getElementById('stats-bar').innerHTML = [
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

            row.innerHTML =
                '<span class="tree-toggle">' + (leaf ? '' : '▶') + '</span>' +
                '<span class="tree-name">' + escapeHtml(displayName) + '</span>' +
                '<span class="tree-type ' + typeCls + '">' + obj.node_type + '</span>' +
                '<span class="tree-shallow">' + fmt(obj.shallow_size) + '</span>' +
                '<span class="tree-size">' + fmt(obj.retained_size) + '</span>' +
                '<span class="tree-bar-wrap"><div class="tree-bar" style="width:' + barWidth + '%"></div></span>' +
                '<span class="tree-pct">' + pctStr + '%</span>' +
                (showSource ? '<span class="tree-source" title="Go to source">&#8599;</span>' : '');

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

        // ---- Tab 5: AI Chat ----
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
                return '<div class="suspect-card ' + severity + '">' +
                    '<div class="suspect-header">' +
                    '<span class="suspect-class">' + escapeHtml(s.class_name) + '</span>' +
                    '<span class="suspect-badge ' + severity + '">' + s.retained_percentage.toFixed(1) + '%</span>' +
                    '</div>' +
                    '<div class="suspect-desc">' + escapeHtml(s.description) + '</div>' +
                    '<div style="margin-top:8px;opacity:0.6;font-size:12px;">Retained: ' + fmt(s.retained_size) +
                    (s.object_id ? ' | Object ID: ' + s.object_id : '') +
                    sourceLink + '</div>' +
                    '</div>';
            }).join('');

            // Wire up "View Source" click handlers
            container.querySelectorAll('.go-to-source-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    vscode.postMessage({ command: 'goToSource', className: link.dataset.class });
                });
            });
        }
    })();
    </script>
</body>
</html>`;
}
