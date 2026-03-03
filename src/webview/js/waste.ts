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

            if (!wasteAnalysis) {
                summaryBar.innerHTML = '<div class="loading">No waste analysis data available</div>';
                return;
            }

            var w = wasteAnalysis;

            summaryBar.innerHTML = [
                { label: 'Total Waste', value: fmt(w.total_wasted_bytes), highlight: w.waste_percentage > 5 },
                { label: '% of Heap', value: w.waste_percentage.toFixed(1) + '%', highlight: w.waste_percentage > 10 },
                { label: 'Dup Strings', value: fmt(w.duplicate_string_wasted_bytes), highlight: false },
                { label: 'Empty Collections', value: fmt(w.empty_collection_wasted_bytes), highlight: false }
            ].map(function(c) {
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
        }

        // ---- Self-register ----
        onMessage('analysisComplete', function(msg) {
            renderWaste(msg.wasteAnalysis);
        });
    `;
}
