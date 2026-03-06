export function getWasteJs(): string {
    return `
        // ---- Tab 5: Waste ----
        // Self-contained: no private state, pure render from data.

        function renderWaste(wasteAnalysis) {
            var summaryBar = document.getElementById('waste-summary-bar');
            var dupTitle = document.getElementById('waste-dup-title');
            var dupTable = document.getElementById('waste-dup-table');
            var emptyTitle = document.getElementById('waste-empty-title');
            var emptyTable = document.getElementById('waste-empty-table');
            var overallocTitle = document.getElementById('waste-overalloc-title');
            var overallocTable = document.getElementById('waste-overalloc-table');
            var boxedTitle = document.getElementById('waste-boxed-title');
            var boxedTable = document.getElementById('waste-boxed-table');

            if (!wasteAnalysis) {
                summaryBar.innerHTML = '<div class="loading">No waste analysis data available</div>';
                return;
            }

            var w = wasteAnalysis;

            var cards = [
                { label: 'Total Waste', value: fmt(w.total_wasted_bytes), highlight: w.waste_percentage > 5 },
                { label: '% of Heap', value: w.waste_percentage.toFixed(1) + '%', highlight: w.waste_percentage > 10 },
                { label: 'Dup Strings', value: fmt(w.duplicate_string_wasted_bytes), highlight: false },
                { label: 'Empty Collections', value: fmt(w.empty_collection_wasted_bytes), highlight: false }
            ];
            if (w.over_allocated_wasted_bytes > 0) {
                cards.push({ label: 'Over-Allocated', value: fmt(w.over_allocated_wasted_bytes), highlight: false });
            }
            if (w.boxed_primitive_wasted_bytes > 0) {
                cards.push({ label: 'Boxed Primitives', value: fmt(w.boxed_primitive_wasted_bytes), highlight: false });
            }
            summaryBar.innerHTML = cards.map(function(c) {
                return '<div class="waste-stat-card"><div class="label">' + c.label + '</div><div class="value' + (c.highlight ? ' highlight' : '') + '">' + c.value + '</div></div>';
            }).join('');

            var dups = w.duplicate_strings || [];
            if (dups.length > 0) {
                dupTitle.style.display = 'block';
                var html = '<table><thead><tr><th>Preview</th><th class="right">Copies</th><th class="right">Wasted</th><th class="right">Total</th></tr></thead><tbody>';
                dups.forEach(function(d) {
                    var preview = d.preview || '(empty)';
                    html += '<tr><td><span class="waste-preview" title="' + escapeHtml(preview) + '">' + escapeHtml(preview) + '</span></td>'
                        + '<td class="right">' + fmtNum(d.count) + '</td>'
                        + '<td class="right">' + fmt(d.wasted_bytes) + '</td>'
                        + '<td class="right">' + fmt(d.total_bytes) + '</td></tr>';
                });
                html += '</tbody></table>';
                dupTable.innerHTML = html;
            } else {
                dupTitle.style.display = 'none';
                dupTable.innerHTML = '';
            }

            var empties = w.empty_collections || [];
            if (empties.length > 0) {
                emptyTitle.style.display = 'block';
                var ehtml = '<table><thead><tr><th>Class</th><th class="right">Count</th><th class="right">Wasted</th></tr></thead><tbody>';
                empties.forEach(function(e) {
                    ehtml += '<tr><td>' + escapeHtml(e.class_name) + '</td>'
                        + '<td class="right">' + fmtNum(e.count) + '</td>'
                        + '<td class="right">' + fmt(e.wasted_bytes) + '</td></tr>';
                });
                ehtml += '</tbody></table>';
                emptyTable.innerHTML = ehtml;
            } else {
                emptyTitle.style.display = 'none';
                emptyTable.innerHTML = '';
            }

            var overallocs = w.over_allocated_collections || [];
            if (overallocs.length > 0) {
                overallocTitle.style.display = 'block';
                var ohtml = '<table><thead><tr><th>Class</th><th class="right">Count</th><th class="right">Wasted</th><th class="right">Avg Fill %</th></tr></thead><tbody>';
                overallocs.forEach(function(o) {
                    ohtml += '<tr><td>' + escapeHtml(o.class_name) + '</td>'
                        + '<td class="right">' + fmtNum(o.count) + '</td>'
                        + '<td class="right">' + fmt(o.wasted_bytes) + '</td>'
                        + '<td class="right">' + o.avg_fill_ratio.toFixed(1) + '%</td></tr>';
                });
                ohtml += '</tbody></table>';
                overallocTable.innerHTML = ohtml;
            } else {
                overallocTitle.style.display = 'none';
                overallocTable.innerHTML = '';
            }

            var boxed = w.boxed_primitives || [];
            if (boxed.length > 0) {
                boxedTitle.style.display = 'block';
                var bhtml = '<table><thead><tr><th>Class</th><th class="right">Count</th><th class="right">Wasted</th><th class="right">Unboxed Size</th></tr></thead><tbody>';
                boxed.forEach(function(b) {
                    bhtml += '<tr><td>' + escapeHtml(b.class_name) + '</td>'
                        + '<td class="right">' + fmtNum(b.count) + '</td>'
                        + '<td class="right">' + fmt(b.wasted_bytes) + '</td>'
                        + '<td class="right">' + fmt(b.unboxed_size) + '</td></tr>';
                });
                bhtml += '</tbody></table>';
                boxedTable.innerHTML = bhtml;
            } else {
                boxedTitle.style.display = 'none';
                boxedTable.innerHTML = '';
            }
        }

        // ---- Self-register ----
        onTabMessage('waste', 'analysisComplete', function(msg) {
            renderWaste(msg.wasteAnalysis);
        });
    `;
}
