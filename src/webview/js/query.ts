export function getQueryJs(): string {
    return `
        // ---- Tab 7: Query ----
        // Self-contained: owns query history, DOM refs, result rendering.

        var _queryInput = document.getElementById('query-input');
        var _queryRunBtn = document.getElementById('query-run-btn');
        var _queryHelpBtn = document.getElementById('query-help-btn');
        var _queryHelp = document.getElementById('query-help');
        var _queryStatus = document.getElementById('query-status');
        var _queryResults = document.getElementById('query-results');
        var _queryHistoryEl = document.getElementById('query-history');
        var _queryHistory = [];

        function runQuery() {
            var q = _queryInput.value.trim();
            if (!q) return;
            _queryStatus.className = 'query-status';
            _queryStatus.textContent = 'Running...';
            _queryResults.innerHTML = '';
            _queryRunBtn.disabled = true;
            vscode.postMessage({ command: 'executeQuery', query: q });
        }

        _queryRunBtn.addEventListener('click', runQuery);
        _queryInput.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runQuery(); }
        });
        _queryHelpBtn.addEventListener('click', function() {
            _queryHelp.style.display = _queryHelp.style.display === 'none' ? 'block' : 'none';
        });

        function _addToHistory(q) {
            var idx = _queryHistory.indexOf(q);
            if (idx !== -1) _queryHistory.splice(idx, 1);
            _queryHistory.unshift(q);
            if (_queryHistory.length > 10) _queryHistory.pop();
            _renderQueryHistory();
        }

        function _renderQueryHistory() {
            _queryHistoryEl.innerHTML = '';
            _queryHistory.forEach(function(q) {
                var el = document.createElement('span');
                el.className = 'query-history-item';
                el.textContent = q;
                el.title = q;
                el.addEventListener('click', function() { _queryInput.value = q; _queryInput.focus(); });
                _queryHistoryEl.appendChild(el);
            });
        }

        function renderQueryResult(result, query) {
            _queryRunBtn.disabled = false;
            _addToHistory(query);

            var cols = result.columns || [];
            var rows = result.rows || [];
            var scanned = result.total_scanned || 0;
            var matched = result.total_matched || 0;
            var timeMs = (result.execution_time_ms || 0).toFixed(1);

            _queryStatus.className = 'query-status';
            _queryStatus.textContent = rows.length + ' row' + (rows.length !== 1 ? 's' : '') +
                ' returned (' + matched + ' matched, ' + scanned + ' scanned, ' + timeMs + 'ms)';

            if (rows.length === 0) {
                _queryResults.innerHTML = '<div style="opacity:0.5; padding:12px;">No results</div>';
                return;
            }

            var sizeCols = ['shallow_size', 'retained_size', 'wasted_bytes', 'total_bytes'];
            var html = '<table><thead><tr>';
            cols.forEach(function(col) {
                var isSize = sizeCols.indexOf(col) !== -1;
                html += '<th' + (isSize ? ' class="right"' : '') + '>' + escapeHtml(col) + '</th>';
            });
            html += '</tr></thead><tbody>';

            rows.forEach(function(row) {
                html += '<tr>';
                row.forEach(function(val, i) {
                    var col = cols[i];
                    var isSize = sizeCols.indexOf(col) !== -1;
                    var display;
                    if (isSize && typeof val === 'number') display = fmt(val);
                    else if (typeof val === 'number' && col === 'retained_percentage') display = val.toFixed(1) + '%';
                    else if (typeof val === 'number') display = fmtNum(val);
                    else display = escapeHtml(String(val == null ? '' : val));
                    html += '<td' + (isSize ? ' class="right"' : '') + '>' + display + '</td>';
                });
                html += '</tr>';
            });
            html += '</tbody></table>';
            _queryResults.innerHTML = html;
        }

        function renderQueryError(error, query) {
            _queryRunBtn.disabled = false;
            if (query) _addToHistory(query);
            _queryStatus.className = 'query-status error';
            _queryStatus.textContent = 'Error: ' + error;
            _queryResults.innerHTML = '';
        }

        // ---- Self-register ----
        onMessage('queryResult', function(msg) {
            renderQueryResult(msg.result, msg.query);
        });

        onMessage('queryError', function(msg) {
            renderQueryError(msg.error, msg.query);
        });
    `;
}
