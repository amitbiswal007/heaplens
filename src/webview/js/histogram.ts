export function getHistogramJs(): string {
    return `
        // ---- Tab 2: Histogram ----
        // Self-contained: owns sort/filter state and pagination.

        var _histSortCol = 'retained_size';
        var _histSortAsc = false;
        var _histFilter = '';
        var _histShowAll = false;
        var HISTOGRAM_PAGE_SIZE = 200;

        function renderHistogram(histogram) {
            var container = document.getElementById('histogram-table');
            var sorted = histogram.slice();

            sorted.sort(function(a, b) {
                var va = a[_histSortCol], vb = b[_histSortCol];
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
                { key: 'retained_size', label: 'Retained Size', cls: 'right' }
            ];

            var html = '<table><thead><tr>';
            cols.forEach(function(c) {
                var arrow = _histSortCol === c.key ? (_histSortAsc ? ' \\u25B2' : ' \\u25BC') : '';
                html += '<th class="' + c.cls + '" data-sort="' + c.key + '">' + c.label + '<span class="sort-arrow">' + arrow + '</span></th>';
            });
            html += '</tr></thead><tbody>';

            displayRows.forEach(function(e) {
                html += '<tr><td>' + escapeHtml(e.class_name) + '</td><td class="right">' + fmtNum(e.instance_count) + '</td><td class="right">' + fmt(e.shallow_size) + '</td><td class="right">' + fmt(e.retained_size) + '</td></tr>';
            });
            html += '</tbody></table>';

            if (!_histShowAll && totalCount > HISTOGRAM_PAGE_SIZE) {
                html += '<div style="text-align:center;padding:12px;"><button id="show-all-histogram" style="padding:6px 16px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;">Show all ' + totalCount.toLocaleString() + ' classes</button></div>';
            }

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
        }

        // ---- Self-register ----
        onMessage('analysisComplete', function(msg) {
            renderHistogram(msg.classHistogram || []);
        });

        document.getElementById('histogram-search').addEventListener('input', function(e) {
            _histFilter = e.target.value;
            if (analysisData) renderHistogram(analysisData.classHistogram || []);
        });
    `;
}
