export function getLeakSuspectsJs(): string {
    return `
        // ---- Tab 4: Leak Suspects ----
        // Self-contained: owns explain-leak streaming buffers + rendering.

        var _explainLeakBuffers = {};

        function renderLeakSuspects(suspects) {
            var container = document.getElementById('leak-suspects');
            if (!suspects || suspects.length === 0) {
                container.innerHTML = '<div class="loading">No leak suspects detected (no single object or class retains >10% of heap)</div>';
                return;
            }

            container.innerHTML = suspects.map(function(s) {
                var severity = s.retained_percentage > 30 ? 'high' : 'medium';
                var sourceLink = isResolvableClass(s.class_name)
                    ? ' | <a class="go-to-source-link" data-class="' + escapeHtml(s.class_name) + '">View Source</a>'
                    : '';
                var gcPathLink = s.object_id
                    ? ' | <a class="gc-path-link" data-object-id="' + s.object_id + '" style="cursor:pointer;color:var(--vscode-textLink-foreground);">GC Path</a>'
                    : '';
                var cachedDep = depInfoCache[s.class_name];
                var depBadge = cachedDep ? makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';
                var sanitizedId = s.class_name.replace(/[^a-zA-Z0-9]/g, '_');
                var explainLink = ' | <a class="suspect-explain-link" data-class="' + escapeHtml(s.class_name) +
                    '" data-retained="' + s.retained_size +
                    '" data-pct="' + s.retained_percentage +
                    '" data-desc="' + escapeHtml(s.description) +
                    '" data-target="explain-' + sanitizedId + '">Explain</a>';
                return '<div class="suspect-card ' + severity + '" data-class="' + escapeHtml(s.class_name) + '">' +
                    '<div class="suspect-header">' +
                    '<span class="suspect-class">' + escapeHtml(s.class_name) + '</span>' +
                    '<span class="suspect-badge ' + severity + '">' + s.retained_percentage.toFixed(1) + '%</span>' +
                    '</div>' +
                    '<div class="suspect-desc">' + escapeHtml(s.description) + '</div>' +
                    '<div style="margin-top:8px;opacity:0.6;font-size:12px;">Retained: ' + fmt(s.retained_size) +
                    (s.object_id ? ' | Object ID: ' + s.object_id : '') +
                    sourceLink + gcPathLink + explainLink + depBadge + '</div>' +
                    '<div class="suspect-explain-area" id="explain-' + sanitizedId + '"></div>' +
                    '</div>';
            }).join('');

            container.querySelectorAll('.go-to-source-link').forEach(function(link) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    vscode.postMessage({ command: 'goToSource', className: link.dataset.class });
                });
            });

            container.querySelectorAll('.gc-path-link').forEach(function(link) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var objectId = parseInt(link.dataset.objectId, 10);
                    if (objectId) vscode.postMessage({ command: 'gcRootPath', objectId: objectId });
                });
            });

            container.querySelectorAll('.suspect-explain-link').forEach(function(link) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    var targetId = link.dataset.target;
                    var area = document.getElementById(targetId);
                    if (!area) return;
                    link.textContent = 'Analyzing...';
                    area.classList.add('visible', 'streaming');
                    area.classList.remove('error');
                    area.textContent = '';
                    vscode.postMessage({
                        command: 'explainLeakSuspect',
                        className: link.dataset.class,
                        retainedSize: parseFloat(link.dataset.retained),
                        retainedPercentage: parseFloat(link.dataset.pct),
                        description: link.dataset.desc
                    });
                });
            });
        }

        // ---- Self-register ----
        onMessage('analysisComplete', function(msg) {
            renderLeakSuspects(msg.leakSuspects || []);
        });

        onMessage('explainLeakChunk', function(msg) {
            var sanitizedId = msg.className.replace(/[^a-zA-Z0-9]/g, '_');
            if (!_explainLeakBuffers[sanitizedId]) _explainLeakBuffers[sanitizedId] = '';
            _explainLeakBuffers[sanitizedId] += msg.text;
            var area = document.getElementById('explain-' + sanitizedId);
            if (area) {
                area.textContent = _explainLeakBuffers[sanitizedId];
                area.scrollTop = area.scrollHeight;
            }
        });

        onMessage('explainLeakDone', function(msg) {
            var sanitizedId = msg.className.replace(/[^a-zA-Z0-9]/g, '_');
            var area = document.getElementById('explain-' + sanitizedId);
            if (area) {
                area.classList.remove('streaming');
                area.classList.add('rendered');
                area.innerHTML = renderMarkdown(_explainLeakBuffers[sanitizedId] || '');
                area.scrollTop = 0;
            }
            delete _explainLeakBuffers[sanitizedId];
            document.querySelectorAll('.suspect-explain-link[data-class="' + msg.className + '"]').forEach(function(link) {
                link.textContent = 'Explain';
            });
        });

        onMessage('explainLeakError', function(msg) {
            var sanitizedId = msg.className.replace(/[^a-zA-Z0-9]/g, '_');
            delete _explainLeakBuffers[sanitizedId];
            var area = document.getElementById('explain-' + sanitizedId);
            if (area) {
                area.classList.remove('streaming');
                area.classList.add('error', 'visible');
                area.textContent = msg.message || 'An error occurred';
            }
            document.querySelectorAll('.suspect-explain-link[data-class="' + msg.className + '"]').forEach(function(link) {
                link.textContent = 'Explain';
            });
        });
    `;
}
