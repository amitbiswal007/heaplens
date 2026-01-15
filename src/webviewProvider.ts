import * as vscode from 'vscode';
import { RustClient } from './rustClient';

/**
 * Provider for the heap analysis webview.
 * 
 * This provider creates and manages the webview panel that displays
 * the Sunburst chart visualization of the heap.
 */
export class HeapAnalysisWebviewProvider {
    private static readonly viewType = 'heapAnalysis';
    private static currentPanel: vscode.WebviewPanel | undefined = undefined;

    /**
     * Creates or reveals the webview panel.
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        rustClient: RustClient,
        hprofPath: string
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (HeapAnalysisWebviewProvider.currentPanel) {
            HeapAnalysisWebviewProvider.currentPanel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            HeapAnalysisWebviewProvider.viewType,
            'Heap Analysis',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media')
                ]
            }
        );

        HeapAnalysisWebviewProvider.currentPanel = panel;

        // Set the webview's initial html content
        const htmlContent = HeapAnalysisWebviewProvider.getWebviewContent(
            panel.webview,
            extensionUri
        );
        panel.webview.html = htmlContent;
        
        // Log that webview was created
        console.log('[WebviewProvider] Webview panel created and HTML set');

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            async (message) => {
                console.log(`[WebviewProvider] Received message: ${message.command}`);
                switch (message.command) {
                    case 'getChildren':
                        try {
                            const children = await rustClient.sendRequest('get_children', {
                                path: hprofPath,
                                object_id: message.objectId
                            });
                            
                            // Check if children is an array and has items
                            if (Array.isArray(children) && children.length > 0) {
                                panel.webview.postMessage({
                                    command: 'childrenResponse',
                                    objectId: message.objectId,
                                    children: children
                                });
                            } else {
                                // No children found - show a message instead of error
                                panel.webview.postMessage({
                                    command: 'noChildren',
                                    objectId: message.objectId,
                                    message: 'This object has no children in the dominator tree'
                                });
                            }
                        } catch (error: any) {
                            console.error(`[WebviewProvider] Error getting children:`, error);
                            // Check if it's a "not found" error
                            if (error.message && error.message.includes('not found')) {
                                panel.webview.postMessage({
                                    command: 'noChildren',
                                    objectId: message.objectId,
                                    message: 'This object has no children or was not found'
                                });
                            } else {
                                panel.webview.postMessage({
                                    command: 'error',
                                    message: error.message || String(error)
                                });
                            }
                        }
                        break;
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
                        break;
                    case 'ready':
                        // Webview is ready, can send data now
                        console.log('[WebviewProvider] Webview is ready');
                        break;
                }
            },
            undefined,
            []
        );

        // Clean up when the panel is disposed
        panel.onDidDispose(
            () => {
                HeapAnalysisWebviewProvider.currentPanel = undefined;
            },
            null,
            []
        );
        
        // Add command to open webview developer tools (for debugging)
        // Note: This requires VS Code API that may not be available in all versions
        // Users can also right-click the webview and select "Open Developer Tools"
    }

    /**
     * Updates the webview with initial analysis data.
     */
    public static updateWithData(topLayers: any[]): void {
        if (HeapAnalysisWebviewProvider.currentPanel) {
            console.log(`[WebviewProvider] Sending ${topLayers.length} items to webview`);
            
            // Wait a bit longer to ensure webview is fully initialized
            setTimeout(() => {
                if (HeapAnalysisWebviewProvider.currentPanel) {
                    try {
                        HeapAnalysisWebviewProvider.currentPanel.webview.postMessage({
                            command: 'updateData',
                            data: topLayers
                        });
                        console.log('[WebviewProvider] Message sent successfully');
                    } catch (error: any) {
                        console.error('[WebviewProvider] Error sending message:', error);
                    }
                }
            }, 1000); // Wait 1 second for webview to be ready
        } else {
            console.error('[WebviewProvider] No current panel to update');
        }
    }

    /**
     * Gets the HTML content for the webview.
     */
    private static getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        // Get the URI for D3.js from CDN
        const d3Uri = 'https://d3js.org/d3.v7.min.js';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' https://d3js.org https://unpkg.com; style-src 'unsafe-inline';">
    <title>Heap Analysis - Sunburst Chart</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
            overflow: hidden;
        }
        #debug {
            position: fixed;
            top: 10px;
            right: 10px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 10px;
            font-size: 11px;
            max-width: 300px;
            z-index: 1000;
        }
        #chart-container {
            width: 100%;
            height: calc(100vh - 100px);
            display: flex;
            justify-content: center;
        }
        #sunburst {
            width: 100%;
            height: 100%;
            min-height: 600px;
        }
        #sunburst svg {
            display: block;
            margin: 0 auto;
        }
        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            font-size: 18px;
        }
        .tooltip {
            position: absolute;
            padding: 10px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            pointer-events: none;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.3s;
        }
        .tooltip.visible {
            opacity: 1;
        }
        .controls {
            position: fixed;
            top: 10px;
            left: 10px;
            z-index: 1000;
        }
        .btn {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            margin-right: 8px;
        }
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
    <div id="debug">Webview loaded. Waiting for data...</div>
    <div class="controls">
        <button id="reset-btn" class="btn" style="display: none;">← Back to Root</button>
    </div>
    <div id="chart-container">
        <div id="sunburst"></div>
        <div class="tooltip" id="tooltip"></div>
    </div>

    <script src="${d3Uri}"></script>
    <script>
        console.log('[Webview] Script starting to execute...');
        
        // Check if acquireVsCodeApi is available
        if (typeof acquireVsCodeApi === 'undefined') {
            console.error('[Webview] acquireVsCodeApi is not available!');
            document.body.innerHTML = '<div class="loading">Error: VS Code API not available</div>';
        } else {
            console.log('[Webview] acquireVsCodeApi found');
        }
        
        const vscode = acquireVsCodeApi();
        console.log('[Webview] VS Code API acquired');
        
        // Check if D3 loaded (it loads asynchronously, so we'll check later)
        console.log('[Webview] Checking for D3.js...');
        
        // Sunburst chart implementation using D3.js
        class SunburstChart {
            constructor(containerId) {
                this.container = document.getElementById(containerId);
                this.width = 800;
                this.height = 800;
                this.radius = Math.min(this.width, this.height) / 2;
                this.data = null;
                this.originalData = null; // Store original data for reset
                this.currentRoot = null;
                
                // Clear container first
                this.container.innerHTML = '';
                
                // Create SVG
                this.svg = d3.select(this.container)
                    .append('svg')
                    .attr('width', this.width)
                    .attr('height', this.height)
                    .style('display', 'block');
                
                this.g = this.svg.append('g')
                    .attr('transform', \`translate(\${this.width / 2}, \${this.height / 2})\`);
                
                // Create tooltip
                this.tooltip = d3.select('#tooltip');
                
                // Color scale - D3 v7 uses different scheme names
                // schemeCategory20 was removed in v7, use schemeCategory10 or a custom array
                let colorScheme;
                if (d3.schemeCategory10) {
                    colorScheme = d3.schemeCategory10;
                } else if (d3.schemeSet3) {
                    colorScheme = d3.schemeSet3;
                } else {
                    // Fallback: custom color palette
                    colorScheme = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf', '#aec7e8', '#ffbb78', '#98df8a', '#ff9896', '#c5b0d5', '#c49c94', '#f7b6d3', '#dbdb8d', '#9edae5'];
                }
                this.color = d3.scaleOrdinal(colorScheme);
            }
            
            // Convert flat array to hierarchical structure
            // For the initial view (top 2 layers), we show nodes in a flat structure
            // When drilling down, we'll receive children and update the hierarchy
            buildHierarchy(data, parentId = null) {
                // Create root node
                const root = {
                    name: parentId === null ? 'GC Roots' : \`Node #\${parentId}\`,
                    children: [],
                    value: 0,
                    objectId: parentId,
                    nodeType: parentId === null ? 'SuperRoot' : 'Node',
                    shallowSize: 0,
                    retainedSize: 0
                };
                
                // Convert data to nodes, filtering out invalid entries
                const nodes = data
                    .filter(d => d && d.retained_size > 0 && d.node_type !== 'Class')
                    .map(d => {
                        // Create a more meaningful name
                        let name;
                        if (d.object_id === 0) {
                            name = d.node_type;
                        } else {
                            const shortId = d.object_id.toString().slice(-8);
                            const sizeMB = (d.retained_size / (1024 * 1024)).toFixed(2);
                            name = \`\${d.node_type} (\${sizeMB} MB)\`;
                        }
                        
                        return {
                            name: name,
                            value: d.retained_size,
                            objectId: d.object_id,
                            nodeType: d.node_type,
                            shallowSize: d.shallow_size || 0,
                            retainedSize: d.retained_size || 0,
                            children: [] // Will be populated on drill-down
                        };
                    });
                
                // Sort by retained size (descending)
                nodes.sort((a, b) => b.value - a.value);
                
                // Use all nodes (already filtered and sorted)
                const topNodes = nodes;
                
                root.children = topNodes;
                root.value = d3.sum(topNodes, d => d.value);
                
                console.log('[SunburstChart] Built hierarchy:', {
                    totalNodes: nodes.length,
                    displayedNodes: topNodes.length,
                    totalValue: root.value
                });
                
                return root;
            }
            
            // Update chart with new data
            update(data, rootNode = null) {
                try {
                    console.log('[SunburstChart] update called with', data ? data.length : 0, 'items');
                    
                    if (!data || data.length === 0) {
                        console.error('[SunburstChart] No data provided');
                        this.container.innerHTML = '<div class="loading">No data available</div>';
                        return;
                    }
                    
                    if (typeof d3 === 'undefined') {
                        console.error('[SunburstChart] D3 is not available');
                        this.container.innerHTML = '<div class="loading">D3.js not loaded</div>';
                        return;
                    }
                    
                    this.data = data;
                    // Store original data if this is the root view
                    if (rootNode === null) {
                        this.originalData = data;
                    }
                    this.currentRoot = rootNode;
                    
                    const root = this.buildHierarchy(data, rootNode);
                    console.log('[SunburstChart] Built hierarchy, root has', root.children ? root.children.length : 0, 'children');
                    
                    const partition = d3.partition()
                        .size([2 * Math.PI, this.radius]);
                    
                    const arc = d3.arc()
                        .startAngle(d => d.x0)
                        .endAngle(d => d.x1)
                        .innerRadius(d => d.y0)
                        .outerRadius(d => d.y1);
                    
                    const rootHierarchy = d3.hierarchy(root)
                        .sum(d => d.value || 0)
                        .sort((a, b) => (b.value || 0) - (a.value || 0));
                    
                    partition(rootHierarchy);
                    
                    console.log('[SunburstChart] Partition computed, descendants:', rootHierarchy.descendants().length);
                    
                    // Clear previous arcs and labels
                    this.g.selectAll('path').remove();
                    this.g.selectAll('text').remove();
                    
                    // Draw arcs
                    const paths = this.g.selectAll('path')
                        .data(rootHierarchy.descendants().filter(d => d.depth > 0)) // Filter out root node itself
                        .enter()
                        .append('path')
                        .attr('d', arc)
                        .style('fill', d => {
                            while (d.depth > 1) d = d.parent;
                            return this.color(d.data.name);
                        })
                        .style('stroke', '#fff')
                        .style('stroke-width', '1px')
                        .style('opacity', 0.9)
                        .style('cursor', 'pointer')
                        .on('mouseover', (event, d) => {
                            this.tooltip
                                .html(\`
                                    <strong>\${d.data.name}</strong><br/>
                                    Type: \${d.data.nodeType || 'N/A'}<br/>
                                    Retained: \${this.formatBytes(d.data.retainedSize || d.value)}<br/>
                                    Shallow: \${this.formatBytes(d.data.shallowSize || 0)}<br/>
                                    Object ID: \${d.data.objectId || 'N/A'}
                                \`)
                                .style('left', (event.pageX + 10) + 'px')
                                .style('top', (event.pageY - 10) + 'px')
                                .classed('visible', true);
                        })
                        .on('mouseout', () => {
                            this.tooltip.classed('visible', false);
                        })
                        .on('click', (event, d) => {
                            if (d.data.objectId !== undefined && d.data.objectId !== 0) {
                                // Request children for this node
                                vscode.postMessage({
                                    command: 'getChildren',
                                    objectId: d.data.objectId
                                });
                            }
                        });
                    
                    console.log('[SunburstChart] Chart updated successfully, paths drawn:', paths.size());
                    
                    // Hide loading message
                    const loadingEl = this.container.querySelector('.loading');
                    if (loadingEl) {
                        loadingEl.style.display = 'none';
                    }
                } catch (error) {
                    console.error('[SunburstChart] Error in update:', error);
                    this.container.innerHTML = \`<div class="loading">Error rendering chart: \${error.message}</div>\`;
                }
            }
            
            // Handle drill-down to show children
            drillDown(children, parentObjectId) {
                // Update chart with children data, showing them as children of the parent
                // Animate transition to new view
                this.update(children, parentObjectId);
            }
            
            // Reset to root view
            reset() {
                if (this.originalData) {
                    this.currentRoot = null;
                    this.update(this.originalData, null);
                    // Hide reset button
                    const resetBtn = document.getElementById('reset-btn');
                    if (resetBtn) {
                        resetBtn.style.display = 'none';
                    }
                }
            }
            
            formatBytes(bytes) {
                if (bytes === 0) return '0 B';
                const k = 1024;
                const sizes = ['B', 'KB', 'MB', 'GB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
            }
        }
        
        // Wait for D3.js to load, then initialize chart
        let chart = null;
        let d3Loaded = false;
        let d3CheckAttempts = 0;
        const maxD3CheckAttempts = 50; // 5 seconds total (50 * 100ms)
        let pendingData = null; // Queue data if it arrives before chart is ready
        
        function checkD3AndInit() {
            d3CheckAttempts++;
            if (typeof d3 !== 'undefined' && !d3Loaded) {
                d3Loaded = true;
                console.log('[Webview] D3.js loaded successfully, version:', d3.version);
                updateDebug('D3.js loaded, initializing chart...');
                try {
                    chart = new SunburstChart('sunburst');
                    console.log('[Webview] Chart initialized successfully');
                    updateDebug('Chart initialized, ready for data');
                    
                    // If we have pending data, process it now
                    if (pendingData) {
                        console.log('[Webview] Processing queued data now that chart is ready');
                        updateDebug('Processing queued data...');
                        try {
                            chart.update(pendingData);
                            updateDebug('Chart updated successfully');
                            pendingData = null; // Clear the queue
                        } catch (error) {
                            console.error('[Webview] Error updating chart with queued data:', error);
                            updateDebug(\`ERROR: \${error.message}\`);
                        }
                    }
                } catch (error) {
                    console.error('[Webview] Failed to initialize chart:', error);
                    updateDebug(\`ERROR: Failed to initialize chart: \${error.message}\`);
                    const sunburstEl = document.getElementById('sunburst');
                    if (sunburstEl) {
                        sunburstEl.innerHTML = \`<div class="loading">Failed to initialize chart: \${error.message}</div>\`;
                    }
                }
            } else if (!d3Loaded && d3CheckAttempts < maxD3CheckAttempts) {
                // D3 not loaded yet, check again in 100ms
                updateDebug(\`Waiting for D3.js... (attempt \${d3CheckAttempts}/\${maxD3CheckAttempts})\`);
                setTimeout(checkD3AndInit, 100);
            } else if (!d3Loaded) {
                // Timeout reached
                console.error('[Webview] D3.js failed to load after', maxD3CheckAttempts * 100, 'ms');
                updateDebug('ERROR: D3.js failed to load. Check internet connection.');
                const sunburstEl = document.getElementById('sunburst');
                if (sunburstEl) {
                    sunburstEl.innerHTML = '<div class="loading">Error: D3.js library failed to load. Please check your internet connection.</div>';
                }
            }
        }
        
        // Start checking for D3 after a short delay to let the script tag load
        setTimeout(() => {
            checkD3AndInit();
        }, 200);
        
        // Notify extension that webview is ready
        vscode.postMessage({ command: 'ready' });
        console.log('[Webview] Sent ready message to extension');
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            console.log('[Webview] Received message:', message.command, message.data ? message.data.length : 'no data');
            updateDebug(\`Received: \${message.command}\`);
            
            // Log full message for debugging (first 1000 chars)
            const msgStr = JSON.stringify(message).substring(0, 1000);
            console.log('[Webview] Full message:', msgStr);
            
            switch (message.command) {
                case 'updateData':
                    updateDebug(\`Received: \${message.command} with \${message.data ? message.data.length : 0} items\`);
                    
                    if (!message.data || message.data.length === 0) {
                        console.error('[Webview] No data received for updateData');
                        updateDebug('ERROR: No data in message');
                        document.getElementById('sunburst').innerHTML = '<div class="loading">No data available</div>';
                        return;
                    }
                    
                    if (!chart) {
                        console.log('[Webview] Chart not initialized yet, queueing data');
                        updateDebug('Chart not ready, queueing data...');
                        pendingData = message.data; // Queue the data
                        return;
                    }
                    
                    // Chart is ready, update it
                    console.log('[Webview] Updating chart with', message.data.length, 'items');
                    updateDebug(\`Updating chart with \${message.data.length} items\`);
                    try {
                        chart.update(message.data, null); // null means root view
                        updateDebug('Chart updated successfully');
                        // Hide reset button for root view
                        const resetBtn = document.getElementById('reset-btn');
                        if (resetBtn) {
                            resetBtn.style.display = 'none';
                        }
                    } catch (error) {
                        console.error('[Webview] Error updating chart:', error);
                        updateDebug(\`ERROR: \${error.message}\`);
                        document.getElementById('sunburst').innerHTML = \`<div class="loading">Error updating chart: \${error.message}</div>\`;
                    }
                    break;
                case 'childrenResponse':
                    if (!chart) {
                        console.error('[Webview] Chart not initialized, cannot drill down');
                        return;
                    }
                    console.log('[Webview] Received children for object', message.objectId);
                    try {
                        chart.drillDown(message.children, message.objectId);
                        // Show reset button when drilling down
                        const resetBtn = document.getElementById('reset-btn');
                        if (resetBtn) {
                            resetBtn.style.display = 'block';
                        }
                    } catch (error) {
                        console.error('[Webview] Error drilling down:', error);
                        updateDebug(\`ERROR drilling down: \${error.message}\`);
                    }
                    break;
                case 'noChildren':
                    console.log('[Webview] No children for object', message.objectId);
                    updateDebug(\`No children: \${message.message}\`);
                    // Show a temporary message
                    const sunburstEl = document.getElementById('sunburst');
                    if (sunburstEl) {
                        const msgEl = document.createElement('div');
                        msgEl.className = 'loading';
                        msgEl.textContent = message.message || 'This object has no children';
                        msgEl.style.position = 'absolute';
                        msgEl.style.top = '50%';
                        msgEl.style.left = '50%';
                        msgEl.style.transform = 'translate(-50%, -50%)';
                        msgEl.style.zIndex = '1000';
                        sunburstEl.appendChild(msgEl);
                        setTimeout(() => msgEl.remove(), 3000);
                    }
                    break;
                case 'error':
                    console.error('[Webview] Error:', message.message);
                    document.getElementById('sunburst').innerHTML = \`<div class="loading">Error: \${message.message}</div>\`;
                    break;
            }
        });
        
        // Show loading state initially
        const sunburstEl = document.getElementById('sunburst');
        const debugEl = document.getElementById('debug');
        const resetBtn = document.getElementById('reset-btn');
        
        function updateDebug(msg) {
            if (debugEl) {
                debugEl.textContent = \`[DEBUG] \${msg}\`;
                console.log('[Webview]', msg);
            }
        }
        
        // Handle reset button click
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                if (chart) {
                    console.log('[Webview] Reset button clicked');
                    chart.reset();
                }
            });
        }
        
        if (sunburstEl) {
            sunburstEl.innerHTML = '<div class="loading">Loading heap analysis data...</div>';
            updateDebug('Sunburst element found, waiting for data...');
        } else {
            console.error('[Webview] Could not find sunburst element');
            updateDebug('ERROR: Sunburst element not found!');
        }
        
        updateDebug('Script loaded and initialized');
    </script>
</body>
</html>`;
    }
}
