export function getFlamegraphJs(): string {
    return `
        // ---- Flame Graph (Icicle Chart) for Dominator Tree ----
        // Self-contained: renders a D3 partition (icicle) layout in #sunburst-chart.

        var _flameData = null;
        var _flameBreadcrumb = [];
        var _flameViewActive = false;

        function renderFlameGraph(data) {
            _flameData = data;
            _flameBreadcrumb = [{ name: data.name || 'Heap', object_id: data.object_id || 0 }];
            drawIcicle(data);
        }

        function drawIcicle(rootData) {
            var container = document.getElementById('sunburst-chart');
            container.innerHTML = '';
            if (!rootData || typeof d3 === 'undefined') {
                container.innerHTML = '<div class="loading">No data available for flame graph</div>';
                return;
            }

            var w = container.clientWidth || 800;
            var cellH = 24;

            // Build breadcrumb bar
            var breadcrumbHtml = '<div class="flame-breadcrumb">';
            _flameBreadcrumb.forEach(function(bc, i) {
                if (i > 0) breadcrumbHtml += ' <span class="flame-bc-arrow">\\u203A</span> ';
                var shortName = bc.name;
                var lastDot = shortName.lastIndexOf('.');
                if (lastDot !== -1) shortName = shortName.substring(lastDot + 1);
                if (i < _flameBreadcrumb.length - 1) {
                    breadcrumbHtml += '<a class="flame-bc-link" data-idx="' + i + '" data-oid="' + bc.object_id + '">' + escapeHtml(shortName) + '</a>';
                } else {
                    breadcrumbHtml += '<span class="flame-bc-current">' + escapeHtml(shortName) + '</span>';
                }
            });
            breadcrumbHtml += '</div>';
            container.insertAdjacentHTML('beforeend', breadcrumbHtml);

            // Wire breadcrumb clicks
            container.querySelectorAll('.flame-bc-link').forEach(function(link) {
                link.addEventListener('click', function() {
                    var idx = parseInt(link.dataset.idx, 10);
                    var oid = parseInt(link.dataset.oid, 10);
                    _flameBreadcrumb = _flameBreadcrumb.slice(0, idx + 1);
                    vscode.postMessage({ command: 'getDominatorSubtree', objectId: oid, maxDepth: 6, maxChildren: 20 });
                });
            });

            var root = d3.hierarchy(rootData)
                .sum(function(d) { return d.children && d.children.length > 0 ? 0 : d.retained_size; })
                .sort(function(a, b) { return b.value - a.value; });

            var depth = 0;
            root.each(function(d) { if (d.depth > depth) depth = d.depth; });
            var h = (depth + 1) * cellH;

            d3.partition().size([w, h]).padding(1)(root);

            var svg = d3.select(container).append('svg').attr('width', w).attr('height', h);

            var colorMap = {
                Instance: 'var(--vscode-charts-blue, #4fc1ff)',
                Array: 'var(--vscode-charts-green, #73c991)',
                Root: 'var(--vscode-charts-orange, #cca700)',
                Aggregated: 'var(--vscode-panel-border, #555)',
                SuperRoot: 'var(--vscode-charts-orange, #cca700)'
            };

            // Tooltip div
            var tooltip = d3.select(container).append('div')
                .attr('class', 'flame-tooltip')
                .style('display', 'none');

            var cells = svg.selectAll('g').data(root.descendants()).enter().append('g')
                .attr('transform', function(d) { return 'translate(' + d.x0 + ',' + d.y0 + ')'; });

            cells.append('rect')
                .attr('width', function(d) { return Math.max(0, d.x1 - d.x0); })
                .attr('height', function(d) { return Math.max(0, d.y1 - d.y0); })
                .attr('fill', function(d) { return colorMap[d.data.node_type] || colorMap.Instance; })
                .attr('stroke', 'var(--vscode-editor-background)')
                .attr('stroke-width', 0.5)
                .style('opacity', 0.85)
                .style('cursor', function(d) { return d.data.children && d.data.children.length > 0 ? 'pointer' : 'default'; })
                .on('click', function(event, d) {
                    if (d.data.node_type === 'Aggregated' || !d.data.object_id) return;
                    if (d.data.children && d.data.children.length > 0) {
                        _flameBreadcrumb.push({ name: d.data.name || 'Unknown', object_id: d.data.object_id });
                        vscode.postMessage({ command: 'getDominatorSubtree', objectId: d.data.object_id, maxDepth: 6, maxChildren: 20 });
                    }
                })
                .on('mouseenter', function(event, d) {
                    var parentRet = d.parent ? d.parent.data.retained_size : d.data.retained_size;
                    var pctParent = parentRet > 0 ? ((d.data.retained_size / parentRet) * 100).toFixed(1) : '0.0';
                    tooltip.style('display', 'block')
                        .html('<strong>' + escapeHtml(d.data.name) + '</strong><br>Retained: ' + fmt(d.data.retained_size) + '<br>' + pctParent + '% of parent');
                })
                .on('mousemove', function(event) {
                    tooltip.style('left', (event.offsetX + 12) + 'px')
                        .style('top', (event.offsetY - 10) + 'px');
                })
                .on('mouseleave', function() {
                    tooltip.style('display', 'none');
                });

            cells.each(function(d) {
                var cellW = d.x1 - d.x0;
                if (cellW > 60) {
                    var shortName = d.data.name || '';
                    var lastDot = shortName.lastIndexOf('.');
                    if (lastDot !== -1) shortName = shortName.substring(lastDot + 1);
                    var maxChars = Math.floor(cellW / 7);
                    if (shortName.length > maxChars) shortName = shortName.substring(0, maxChars - 1) + '\\u2026';
                    d3.select(this).append('text')
                        .attr('x', 3).attr('y', 15)
                        .text(shortName)
                        .attr('fill', '#fff').attr('font-size', '11px')
                        .style('pointer-events', 'none')
                        .style('text-shadow', '0 1px 2px rgba(0,0,0,0.5)');
                }
            });
        }

        // Toggle buttons
        var _treeToggleBtn = document.getElementById('domtree-view-tree');
        var _flameToggleBtn = document.getElementById('domtree-view-flame');
        var _domTreeEl = document.getElementById('dominator-tree');
        var _domHeaderEl = document.getElementById('domtree-header');
        var _resetTreeBtnEl = document.getElementById('reset-tree-btn');
        var _sunburstEl = document.getElementById('sunburst-chart');

        function setDomtreeView(mode) {
            _flameViewActive = mode === 'flame';
            if (_treeToggleBtn) _treeToggleBtn.classList.toggle('active', mode === 'tree');
            if (_flameToggleBtn) _flameToggleBtn.classList.toggle('active', mode === 'flame');
            if (mode === 'flame') {
                _domTreeEl.style.display = 'none';
                _domHeaderEl.style.display = 'none';
                _resetTreeBtnEl.style.display = 'none';
                _sunburstEl.style.display = 'block';
                // Fetch root subtree
                vscode.postMessage({ command: 'getDominatorSubtree', objectId: 0, maxDepth: 6, maxChildren: 20 });
            } else {
                _domTreeEl.style.display = '';
                _domHeaderEl.style.display = '';
                _resetTreeBtnEl.style.display = '';
                _sunburstEl.style.display = 'none';
            }
        }

        if (_treeToggleBtn) _treeToggleBtn.addEventListener('click', function() { setDomtreeView('tree'); });
        if (_flameToggleBtn) _flameToggleBtn.addEventListener('click', function() { setDomtreeView('flame'); });

        onMessage('dominatorSubtreeResponse', function(msg) {
            if (msg.subtree && _flameViewActive) {
                renderFlameGraph(msg.subtree);
            }
        });
    `;
}
