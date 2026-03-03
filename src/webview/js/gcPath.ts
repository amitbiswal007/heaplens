export function getGcPathJs(): string {
    return `
        // ---- GC Root Path ----
        // Self-contained: breadcrumb rendering + close handler.

        function closeGcPath() {
            document.getElementById('gc-path-container').innerHTML = '';
        }

        function renderGcRootPath(path) {
            var container = document.getElementById('gc-path-container');
            if (!path || path.length === 0) {
                container.innerHTML = '<div class="gc-path-breadcrumb"><span class="gc-path-label">GC Path</span><span style="opacity:0.5;font-size:12px;">No path to GC root found</span><button class="gc-path-close">&times;</button></div>';
                container.querySelector('.gc-path-close').addEventListener('click', closeGcPath);
                return;
            }

            var html = '<div class="gc-path-breadcrumb"><span class="gc-path-label">GC Path</span>';
            path.forEach(function(node, i) {
                var isRoot = node.node_type === 'Root' || node.node_type === 'SuperRoot';
                var isTarget = i === path.length - 1;
                var cls = isRoot ? 'root' : isTarget ? 'target' : '';
                var label = node.class_name || node.node_type;
                var title = label + ' (' + fmt(node.retained_size) + ')';
                if (i > 0) {
                    if (node.field_name) {
                        html += '<span class="gc-path-arrow">&#9654;</span><span class="gc-path-field">(' + escapeHtml(node.field_name) + ')</span>';
                    } else {
                        html += '<span class="gc-path-arrow">&#9654;</span>';
                    }
                }
                html += '<span class="gc-path-node ' + cls + '" title="' + escapeHtml(title) + '">' + escapeHtml(label) + '</span>';
            });
            html += '<button class="gc-path-close">&times;</button></div>';
            container.innerHTML = html;
            container.querySelector('.gc-path-close').addEventListener('click', closeGcPath);
        }

        // ---- Self-register ----
        onMessage('gcRootPathResponse', function(msg) {
            renderGcRootPath(msg.path);
        });
    `;
}
