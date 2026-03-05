export function getHistogramJs(): string {
    return `
        // ---- Tab 2: Histogram ----
        // Self-contained: owns sort/filter state, pagination, % of heap column, CSV export.

        var _histSortCol = 'retained_size';
        var _histSortAsc = false;
        var _histFilter = '';
        var _histShowAll = false;
        var HISTOGRAM_PAGE_SIZE = 200;

        function renderHistogram(histogram) {
            var container = document.getElementById('histogram-table');
            var sorted = histogram.slice();

            // Compute total retained for % column
            var totalRetained = sorted.reduce(function(sum, e) { return sum + e.retained_size; }, 0) || 1;

            sorted.sort(function(a, b) {
                var va = a[_histSortCol], vb = b[_histSortCol];
                if (_histSortCol === 'heap_pct') {
                    va = a.retained_size / totalRetained;
                    vb = b.retained_size / totalRetained;
                }
                if (typeof va === 'string') return _histSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
                return _histSortAsc ? va - vb : vb - va;
            });

            if (_histFilter) {
                var f = _histFilter.toLowerCase();
                sorted = sorted.filter(function(e) { return e.class_name.toLowerCase().indexOf(f) !== -1; });
            }

            var totalCount = sorted.length;
            var displayRows = _histShowAll ? sorted : sorted.slice(0, HISTOGRAM_PAGE_SIZE);

            var cols = [
                { key: 'class_name', label: 'Class Name', cls: '' },
                { key: 'instance_count', label: 'Instances', cls: 'right' },
                { key: 'shallow_size', label: 'Shallow Size', cls: 'right' },
                { key: 'retained_size', label: 'Retained Size', cls: 'right' },
                { key: 'heap_pct', label: '% of Heap', cls: 'right' }
            ];

            var html = '<table><thead><tr>';
            cols.forEach(function(c) {
                var arrow = _histSortCol === c.key ? (_histSortAsc ? ' \\u25B2' : ' \\u25BC') : '';
                html += '<th class="' + c.cls + '" data-sort="' + c.key + '">' + c.label + '<span class="sort-arrow">' + arrow + '</span></th>';
            });
            html += '</tr></thead><tbody>';

            displayRows.forEach(function(e) {
                var pct = ((e.retained_size / totalRetained) * 100).toFixed(1);
                html += '<tr><td>' + escapeHtml(e.class_name) + '</td><td class="right">' + fmtNum(e.instance_count) + '</td><td class="right">' + fmt(e.shallow_size) + '</td><td class="right">' + fmt(e.retained_size) + '</td><td class="right">' + pct + '%</td></tr>';
            });
            html += '</tbody></table>';

            if (!_histShowAll && totalCount > HISTOGRAM_PAGE_SIZE) {
                html += '<div style="text-align:center;padding:12px;"><button id="show-all-histogram" style="padding:6px 16px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;">Show all ' + totalCount.toLocaleString() + ' classes</button></div>';
            }

            // Export CSV button
            html += '<div style="text-align:right;padding:8px 0;"><button class="btn" id="export-csv-btn" style="font-size:11px;">Export CSV</button></div>';

            container.innerHTML = html;

            var showAllBtn = document.getElementById('show-all-histogram');
            if (showAllBtn) {
                showAllBtn.addEventListener('click', function() {
                    _histShowAll = true;
                    renderHistogram(histogram);
                });
            }

            container.querySelectorAll('th[data-sort]').forEach(function(th) {
                th.addEventListener('click', function() {
                    var col = th.dataset.sort;
                    if (_histSortCol === col) _histSortAsc = !_histSortAsc;
                    else { _histSortCol = col; _histSortAsc = false; }
                    _histShowAll = false;
                    renderHistogram(histogram);
                });
            });

            var exportBtn = document.getElementById('export-csv-btn');
            if (exportBtn) {
                exportBtn.addEventListener('click', function() {
                    var csv = 'Class Name,Instances,Shallow Size,Retained Size,% of Heap\\n';
                    sorted.forEach(function(e) {
                        var pct = ((e.retained_size / totalRetained) * 100).toFixed(1);
                        csv += '"' + e.class_name.replace(/"/g, '""') + '",' + e.instance_count + ',' + e.shallow_size + ',' + e.retained_size + ',' + pct + '\\n';
                    });
                    vscode.postMessage({ command: 'exportHistogramCsv', csv: csv });
                });
            }
        }

        // ---- Self-register ----
        onTabMessage('histogram', 'analysisComplete', function(msg) {
            renderHistogram(msg.classHistogram || []);
        });

        document.getElementById('histogram-search').addEventListener('input', function(e) {
            _histFilter = e.target.value;
            _histShowAll = false;
            if (analysisData) renderHistogram(analysisData.classHistogram || []);
        });
    `;
}
