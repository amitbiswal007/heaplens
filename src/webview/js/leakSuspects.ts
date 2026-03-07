export function getLeakSuspectsJs(): string {
    return `
        // ---- Tab 4: Leak Suspects ----
        // Self-contained: owns explain-leak streaming buffers, rendering, pagination, threshold filtering.

        var _explainLeakBuffers = {};
        var _leakPage = 0;
        var LEAK_PAGE_SIZE = 10;
        var _leakSuspectsData = [];
        var _allLeakSuspects = [];
        var _leakThreshold = 10;

        function renderLeakSuspects(suspects) {
            _allLeakSuspects = suspects || [];
            _leakPage = 0;
            applyLeakThreshold();
        }

        function applyLeakThreshold() {
            _leakSuspectsData = _allLeakSuspects.filter(function(s) {
                return s.retained_percentage >= _leakThreshold;
            });
            _leakPage = 0;

            // Show/hide threshold row
            var thresholdRow = document.getElementById('leak-threshold-row');
            if (thresholdRow) {
                thresholdRow.style.display = _allLeakSuspects.length > 0 ? 'flex' : 'none';
            }

            renderLeakPage();
        }

        function renderLeakPage() {
            var container = document.getElementById('leak-suspects');
            var suspects = _leakSuspectsData;

            if (_allLeakSuspects.length === 0) {
                container.innerHTML = '<div class="loading">No leak suspects detected (no single object or class retains >10% of heap)</div>';
                return;
            }

            if (suspects.length === 0) {
                container.innerHTML = '<div class="loading">No suspects at current threshold (' + _leakThreshold + '%). Lower the minimum retained % to see more.</div>';
                return;
            }

            var totalPages = Math.ceil(suspects.length / LEAK_PAGE_SIZE);
            var start = _leakPage * LEAK_PAGE_SIZE;
            var pageSuspects = suspects.slice(start, start + LEAK_PAGE_SIZE);

            var html = pageSuspects.map(function(s) {
                var severity = s.retained_percentage > 30 ? 'high' : 'medium';
                var sourceLink = isResolvableClass(s.class_name)
                    ? ' | <a class="go-to-source-link" data-class="' + escapeHtml(s.class_name) + '">View Source</a>'
                    : '';
                var fixLink = isResolvableClass(s.class_name)
                    ? ' | <a class="fix-with-ai-link" data-class="' + escapeHtml(s.class_name) +
                      '" data-retained="' + s.retained_size +
                      '" data-pct="' + s.retained_percentage +
                      '" data-desc="' + escapeHtml(s.description) + '">Fix with AI</a>'
                    : '';
                var gcPathLink = s.object_id
                    ? ' <button class="why-alive-btn gc-path-link" data-object-id="' + s.object_id + '">Why alive?</button>'
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
                    sourceLink + gcPathLink + explainLink + fixLink + depBadge + '</div>' +
                    '<div class="suspect-explain-area" id="explain-' + sanitizedId + '"></div>' +
                    '</div>';
            }).join('');

            // Pagination controls
            if (totalPages > 1) {
                html += '<div class="leak-pagination">';
                html += '<button class="btn leak-prev-btn"' + (_leakPage === 0 ? ' disabled' : '') + '>Prev</button>';
                html += '<span class="leak-page-info">Page ' + (_leakPage + 1) + ' of ' + totalPages + '</span>';
                html += '<button class="btn leak-next-btn"' + (_leakPage >= totalPages - 1 ? ' disabled' : '') + '>Next</button>';
                html += '</div>';
            }

            container.innerHTML = html;

            // Wire up pagination
            var prevBtn = container.querySelector('.leak-prev-btn');
            var nextBtn = container.querySelector('.leak-next-btn');
            if (prevBtn) prevBtn.addEventListener('click', function() { if (_leakPage > 0) { _leakPage--; renderLeakPage(); } });
            if (nextBtn) nextBtn.addEventListener('click', function() { var tp = Math.ceil(_leakSuspectsData.length / LEAK_PAGE_SIZE); if (_leakPage < tp - 1) { _leakPage++; renderLeakPage(); } });

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

            container.querySelectorAll('.fix-with-ai-link').forEach(function(link) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    if (link.classList.contains('disabled') || link.classList.contains('fixed')) return;
                    vscode.postMessage({
                        command: 'fixWithAi',
                        className: link.dataset.class,
                        retainedSize: parseFloat(link.dataset.retained),
                        retainedPercentage: parseFloat(link.dataset.pct),
                        description: link.dataset.desc
                    });
                });
            });
        }

        // Threshold slider
        var _leakSlider = document.getElementById('leak-threshold-slider');
        var _leakThresholdValue = document.getElementById('leak-threshold-value');
        if (_leakSlider) {
            _leakSlider.addEventListener('input', function() {
                _leakThreshold = parseInt(_leakSlider.value, 10);
                if (_leakThresholdValue) _leakThresholdValue.textContent = _leakThreshold + '%';
                applyLeakThreshold();
            });
        }

        // ---- Self-register ----
        onTabMessage('leaks', 'analysisComplete', function(msg) {
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
