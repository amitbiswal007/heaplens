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
        panel.webview.html = HeapAnalysisWebviewProvider.getWebviewContent(
            panel.webview,
            extensionUri
        );

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'getChildren':
                        try {
                            const children = await rustClient.sendRequest('get_children', {
                                path: hprofPath,
                                object_id: message.objectId
                            });
                            panel.webview.postMessage({
                                command: 'childrenResponse',
                                objectId: message.objectId,
                                children: children
                            });
                        } catch (error: any) {
                            panel.webview.postMessage({
                                command: 'error',
                                message: error.message || String(error)
                            });
                        }
                        break;
                    case 'alert':
                        vscode.window.showErrorMessage(message.text);
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
    }

    /**
     * Updates the webview with initial analysis data.
     */
    public static updateWithData(topLayers: any[]): void {
        if (HeapAnalysisWebviewProvider.currentPanel) {
            HeapAnalysisWebviewProvider.currentPanel.webview.postMessage({
                command: 'updateData',
                data: topLayers
            });
        }
    }

    /**
     * Gets the HTML content for the webview.
     */
    private static getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        // Get the URI for React and D3.js from CDN
        const reactUri = 'https://unpkg.com/react@18/umd/react.production.min.js';
        const reactDomUri = 'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js';
        const d3Uri = 'https://d3js.org/d3.v7.min.js';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
        #chart-container {
            width: 100%;
            height: calc(100vh - 100px);
            display: flex;
            justify-content: center;
        }
        #sunburst {
            width: 100%;
            height: 100%;
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
    </style>
</head>
<body>
    <div id="chart-container">
        <div id="sunburst"></div>
        <div class="tooltip" id="tooltip"></div>
    </div>

    <script src="${reactUri}"></script>
    <script src="${reactDomUri}"></script>
    <script src="${d3Uri}"></script>
    <script>
        const vscode = acquireVsCodeApi();
        
        // Sunburst chart implementation using D3.js
        class SunburstChart {
            constructor(containerId) {
                this.container = document.getElementById(containerId);
                this.width = 800;
                this.height = 800;
                this.radius = Math.min(this.width, this.height) / 2;
                this.data = null;
                this.currentRoot = null;
                
                // Create SVG
                this.svg = d3.select(this.container)
                    .append('svg')
                    .attr('width', this.width)
                    .attr('height', this.height);
                
                this.g = this.svg.append('g')
                    .attr('transform', \`translate(\${this.width / 2}, \${this.height / 2})\`);
                
                // Create tooltip
                this.tooltip = d3.select('#tooltip');
                
                // Color scale
                this.color = d3.scaleOrdinal(d3.schemeCategory20);
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
                
                // Convert data to nodes
                const nodes = data.map(d => ({
                    name: d.object_id === 0 
                        ? d.node_type 
                        : \`\${d.node_type} #\${d.object_id}\`,
                    value: d.retained_size,
                    objectId: d.object_id,
                    nodeType: d.node_type,
                    shallowSize: d.shallow_size,
                    retainedSize: d.retained_size,
                    children: [] // Will be populated on drill-down
                }));
                
                // Sort by retained size (descending)
                nodes.sort((a, b) => b.value - a.value);
                
                root.children = nodes;
                root.value = d3.sum(nodes, d => d.value);
                
                return root;
            }
            
            // Update chart with new data
            update(data, rootNode = null) {
                this.data = data;
                this.currentRoot = rootNode;
                
                const root = this.buildHierarchy(data);
                const partition = d3.partition()
                    .size([2 * Math.PI, this.radius]);
                
                const arc = d3.arc()
                    .startAngle(d => d.x0)
                    .endAngle(d => d.x1)
                    .innerRadius(d => d.y0)
                    .outerRadius(d => d.y1);
                
                const rootHierarchy = d3.hierarchy(root)
                    .sum(d => d.value)
                    .sort((a, b) => b.value - a.value);
                
                partition(rootHierarchy);
                
                // Clear previous arcs
                this.g.selectAll('path').remove();
                
                // Draw arcs
                const paths = this.g.selectAll('path')
                    .data(rootHierarchy.descendants())
                    .enter()
                    .append('path')
                    .attr('d', arc)
                    .style('fill', d => {
                        while (d.depth > 1) d = d.parent;
                        return this.color(d.data.name);
                    })
                    .style('stroke', '#fff')
                    .style('stroke-width', '2px')
                    .style('opacity', 0.8)
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
            }
            
            // Handle drill-down to show children
            drillDown(children, parentObjectId) {
                // Update chart with children data, showing them as children of the parent
                const root = this.buildHierarchy(children, parentObjectId);
                
                // Animate transition to new view
                this.update(children, parentObjectId);
            }
            
            // Reset to root view
            reset() {
                if (this.data) {
                    this.update(this.data, null);
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
        
        // Initialize chart
        const chart = new SunburstChart('sunburst');
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'updateData':
                    chart.update(message.data);
                    break;
                case 'childrenResponse':
                    chart.drillDown(message.children, message.objectId);
                    break;
                case 'error':
                    console.error('Error:', message.message);
                    break;
            }
        });
        
        // Request initial data (will be sent by extension after analysis completes)
    </script>
</body>
</html>`;
    }
}
