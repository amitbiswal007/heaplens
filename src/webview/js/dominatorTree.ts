export function getDominatorTreeJs(): string {
    return `
        // ---- Tab 3: Dominator Tree ----
        // Self-contained: owns tree state + expand/collapse + rendering.

        var _treeData = [];
        var _totalRetained = 0;
        var PRIMITIVE_ARRAYS = ['byte[]', 'short[]', 'int[]', 'long[]', 'float[]', 'double[]', 'char[]', 'boolean[]'];

        function isLeafType(obj) {
            return PRIMITIVE_ARRAYS.indexOf(obj.class_name) !== -1;
        }

        function renderDominatorTree(layers) {
            _treeData = layers.filter(function(o) { return o.node_type !== 'Class' && o.node_type !== 'SuperRoot' && o.retained_size > 0; });
            _totalRetained = _treeData.reduce(function(sum, o) { return sum + o.retained_size; }, 0);

            document.getElementById('domtree-header').style.display = _treeData.length > 0 ? 'block' : 'none';
            document.getElementById('reset-tree-btn').style.display = _treeData.length > 0 ? 'inline-block' : 'none';

            var container = document.getElementById('dominator-tree');
            container.innerHTML = '';
            _treeData.forEach(function(obj) { container.appendChild(createTreeRow(obj, 0)); });
        }

        function createTreeRow(obj, depth) {
            var leaf = isLeafType(obj);
            var row = document.createElement('div');
            row.className = 'tree-row' + (leaf ? '' : ' expandable');
            row.style.paddingLeft = (12 + depth * 20) + 'px';
            row.dataset.objectId = obj.object_id;
            row.dataset.depth = depth;

            var pct = _totalRetained > 0 ? ((obj.retained_size / _totalRetained) * 100) : 0;
            var pctStr = pct.toFixed(1);
            var barWidth = Math.max(1, Math.min(100, pct));
            var displayName = obj.class_name || obj.node_type;
            var typeCls = obj.node_type === 'Array' ? 'array' : 'instance';
            var showSource = (obj.node_type === 'Instance' || obj.node_type === 'Array') && isResolvableClass(displayName);
            var cachedDep = depInfoCache[displayName];
            var depBadge = cachedDep ? makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';
            var showPin = obj.object_id > 0;
            var showInspect = obj.node_type === 'Instance' && obj.object_id > 0;
            var fieldNameHtml = obj.field_name ? '<span class="tree-field-name">' + escapeHtml(obj.field_name) + ' =</span>' : '';

            row.innerHTML =
                '<span class="tree-toggle">' + (leaf ? '' : '\\u25B6') + '</span>' +
                fieldNameHtml +
                '<span class="tree-name">' + escapeHtml(displayName) + '</span>' +
                '<span class="tree-type ' + typeCls + '">' + obj.node_type + '</span>' +
                '<span class="tree-shallow">' + fmt(obj.shallow_size) + '</span>' +
                '<span class="tree-size">' + fmt(obj.retained_size) + '</span>' +
                '<span class="tree-bar-wrap"><div class="tree-bar" style="width:' + barWidth + '%"></div></span>' +
                '<span class="tree-pct">' + pctStr + '%</span>' +
                (showPin ? '<span class="tree-pin" title="Show GC root path">\\uD83D\\uDCCD</span>' : '') +
                (showInspect ? '<span class="tree-inspect" title="Inspect fields">\\uD83D\\uDD0D</span>' : '') +
                (showSource ? '<span class="tree-source" title="Go to source">\\u2197</span>' : '') +
                depBadge;

            if (!leaf) {
                row.addEventListener('click', function() {
                    var toggle = row.querySelector('.tree-toggle');
                    var childContainer = row.nextElementSibling;
                    if (childContainer && childContainer.classList.contains('tree-children')) {
                        childContainer.style.display = childContainer.style.display === 'none' ? 'block' : 'none';
                        toggle.textContent = childContainer.style.display === 'none' ? '\\u25B6' : '\\u25BC';
                    } else if (toggle.textContent !== '\\u00B7') {
                        toggle.textContent = '\\u23F3';
                        vscode.postMessage({ command: 'getChildren', objectId: obj.object_id });
                    }
                });
            }

            if (showPin) {
                row.querySelector('.tree-pin').addEventListener('click', function(e) {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'gcRootPath', objectId: obj.object_id });
                });
            }

            if (showInspect) {
                row.querySelector('.tree-inspect').addEventListener('click', function(e) {
                    e.stopPropagation();
                    openInspector(obj.object_id, displayName, obj.shallow_size, obj.retained_size);
                });
            }

            if (showSource) {
                row.querySelector('.tree-source').addEventListener('click', function(e) {
                    e.stopPropagation();
                    vscode.postMessage({ command: 'goToSource', className: displayName });
                });
            }

            return row;
        }

        function expandTreeNode(objectId, children) {
            var rows = document.querySelectorAll('.tree-row[data-object-id="' + objectId + '"]');
            rows.forEach(function(row) {
                var toggle = row.querySelector('.tree-toggle');
                var existing = row.nextElementSibling;
                if (existing && existing.classList.contains('tree-children')) existing.remove();

                var depth = parseInt(row.dataset.depth || '0') + 1;
                var filtered = children.filter(function(c) { return c.node_type !== 'Class' && c.retained_size > 0; });

                if (filtered.length === 0) {
                    toggle.textContent = '\\u00B7';
                    row.classList.remove('expandable');
                    return;
                }

                toggle.textContent = '\\u25BC';
                var childContainer = document.createElement('div');
                childContainer.className = 'tree-children';
                filtered.forEach(function(child) { childContainer.appendChild(createTreeRow(child, depth)); });
                row.after(childContainer);
            });
        }

        function markLeaf(objectId) {
            var rows = document.querySelectorAll('.tree-row[data-object-id="' + objectId + '"]');
            rows.forEach(function(row) {
                row.querySelector('.tree-toggle').textContent = '\\u00B7';
                row.classList.remove('expandable');
            });
        }

        // ---- Self-register ----
        onMessage('analysisComplete', function(msg) {
            renderDominatorTree(msg.topLayers || []);
        });

        onMessage('childrenResponse', function(msg) {
            expandTreeNode(msg.objectId, msg.children);
        });

        onMessage('noChildren', function(msg) {
            markLeaf(msg.objectId);
        });

        document.getElementById('reset-tree-btn').addEventListener('click', function() {
            if (analysisData) renderDominatorTree(analysisData.topLayers || []);
        });
    `;
}
