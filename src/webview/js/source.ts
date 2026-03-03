export function getSourceJs(): string {
    return `
        // ---- Tab 6: Source ----
        // Self-contained: owns sort/filter state, source status tracking.

        var _srcSortCol = 'retained_size';
        var _srcSortAsc = false;
        var _srcFilter = '';
        var _srcStatusMap = {};
        var _srcHistogram = [];

        function renderSourceTab(histogram) {
            _srcHistogram = histogram.filter(function(e) { return isResolvableClass(e.class_name); });
            var seen = {};
            _srcHistogram = _srcHistogram.filter(function(e) {
                if (seen[e.class_name]) return false;
                seen[e.class_name] = true;
                return true;
            });
            renderSourceTable();
        }

        function renderSourceTable() {
            var container = document.getElementById('source-table');
            var sorted = _srcHistogram.slice();

            sorted.sort(function(a, b) {
                var va = a[_srcSortCol], vb = b[_srcSortCol];
                if (typeof va === 'string') return _srcSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                return _srcSortAsc ? va - vb : vb - va;
            });

            if (_srcFilter) {
                var f = _srcFilter.toLowerCase();
                sorted = sorted.filter(function(e) { return e.class_name.toLowerCase().indexOf(f) !== -1; });
            }

            var resolvedCount = _srcHistogram.filter(function(e) { return _srcStatusMap[e.class_name] === 'found'; }).length;
            document.getElementById('source-stats').textContent =
                sorted.length + ' resolvable class' + (sorted.length !== 1 ? 'es' : '') +
                ' \\u00b7 ' + resolvedCount + ' resolved';

            var cols = [
                { key: 'class_name', label: 'Class Name', cls: '' },
                { key: 'instance_count', label: 'Instances', cls: 'right' },
                { key: 'retained_size', label: 'Retained Size', cls: 'right' },
                { key: '_status', label: 'Status', cls: '' },
                { key: '_action', label: '', cls: '' }
            ];

            var html = '<table><thead><tr>';
            cols.forEach(function(c) {
                if (c.key.indexOf('_') === 0) {
                    html += '<th class="' + c.cls + '">' + c.label + '</th>';
                } else {
                    var arrow = _srcSortCol === c.key ? (_srcSortAsc ? ' \\u25B2' : ' \\u25BC') : '';
                    html += '<th class="' + c.cls + '" data-source-sort="' + c.key + '">' + c.label + '<span class="sort-arrow">' + arrow + '</span></th>';
                }
            });
            html += '</tr></thead><tbody>';

            sorted.forEach(function(e) {
                var cn = e.class_name;
                var status = _srcStatusMap[cn] || 'not-tried';
                var cachedDep = depInfoCache[cn];
                var badge = cachedDep ? ' ' + makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';
                var statusLabel = status === 'not-tried' ? '' : status === 'resolving' ? 'resolving...' : status === 'found' ? 'found' : 'not found';
                var btnDisabled = status === 'resolving' || status === 'found' ? ' disabled' : '';

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

            container.querySelectorAll('th[data-source-sort]').forEach(function(th) {
                th.addEventListener('click', function() {
                    var col = th.dataset.sourceSort;
                    if (_srcSortCol === col) _srcSortAsc = !_srcSortAsc;
                    else { _srcSortCol = col; _srcSortAsc = false; }
                    renderSourceTable();
                });
            });

            container.querySelectorAll('.source-view-btn').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var cn = btn.dataset.class;
                    if (_srcStatusMap[cn] === 'found') return;
                    _srcStatusMap[cn] = 'resolving';
                    _updateSourceRow(cn);
                    vscode.postMessage({ command: 'goToSource', className: cn });
                });
            });
        }

        function _updateSourceRow(className) {
            var row = document.querySelector('tr[data-source-class="' + className + '"]');
            if (!row) return;

            var status = _srcStatusMap[className] || 'not-tried';
            var cachedDep = depInfoCache[className];
            var badge = cachedDep ? ' ' + makeBadgeHtml(cachedDep.tier, cachedDep.dependency) : '';
            var statusLabel = status === 'not-tried' ? '' : status === 'resolving' ? 'resolving...' : status === 'found' ? 'found' : 'not found';

            var cells = row.querySelectorAll('td');
            if (cells.length >= 4) {
                cells[3].innerHTML = '<span class="source-status ' + status + '"></span>' + statusLabel + badge;
            }
            if (cells.length >= 5) {
                var btn = cells[4].querySelector('.source-view-btn');
                if (btn) btn.disabled = (status === 'resolving' || status === 'found');
            }

            var resolvedCount = _srcHistogram.filter(function(e) { return _srcStatusMap[e.class_name] === 'found'; }).length;
            var statsEl = document.getElementById('source-stats');
            if (statsEl) {
                var total = _srcFilter
                    ? _srcHistogram.filter(function(e) { return e.class_name.toLowerCase().indexOf(_srcFilter.toLowerCase()) !== -1; }).length
                    : _srcHistogram.length;
                statsEl.textContent = total + ' resolvable class' + (total !== 1 ? 'es' : '') +
                    ' \\u00b7 ' + resolvedCount + ' resolved';
            }
        }

        // ---- Self-register ----
        onMessage('analysisComplete', function(msg) {
            renderSourceTab(msg.classHistogram || []);
        });

        onMessage('sourceNotFound', function(msg) {
            _srcStatusMap[msg.className] = 'not-found';
            _updateSourceRow(msg.className);
        });

        onMessage('dependencyResolved', function(msg) {
            _srcStatusMap[msg.className] = 'found';
            _updateSourceRow(msg.className);
        });

        document.getElementById('source-search').addEventListener('input', function(e) {
            _srcFilter = e.target.value;
            if (analysisData) renderSourceTable();
        });
    `;
}
