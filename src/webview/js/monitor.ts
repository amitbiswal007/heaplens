export function getMonitorJs(): string {
    return `
        // ---- Tab: Monitor ----
        // Live JVM monitoring: connection controls, stat cards, D3 charts, histogram.

        var _monitorConnected = false;
        var _monitorHistory = [];
        var _monitorMaxHistory = 300;

        // --- Connection controls ---
        var _monHostInput = document.getElementById('monitor-host');
        var _monPortInput = document.getElementById('monitor-port');
        var _monConnectBtn = document.getElementById('monitor-connect-btn');
        var _monDisconnectBtn = document.getElementById('monitor-disconnect-btn');
        var _monStatusDot = document.getElementById('monitor-status-dot');
        var _monStatusText = document.getElementById('monitor-status-text');

        if (_monConnectBtn) {
            _monConnectBtn.addEventListener('click', function() {
                var host = (_monHostInput && _monHostInput.value) || 'localhost';
                var port = parseInt((_monPortInput && _monPortInput.value) || '9095', 10);
                if (isNaN(port) || port < 1 || port > 65535) {
                    _monSetStatus('error', 'Invalid port number');
                    return;
                }
                _monSetStatus('connecting', 'Connecting...');
                _monConnectBtn.disabled = true;
                vscode.postMessage({ command: 'startMonitor', host: host, port: port });
            });
        }

        if (_monDisconnectBtn) {
            _monDisconnectBtn.addEventListener('click', function() {
                vscode.postMessage({ command: 'stopMonitor' });
            });
        }

        function _monSetStatus(state, text) {
            if (_monStatusDot) {
                _monStatusDot.className = 'monitor-status-dot monitor-status-' + state;
            }
            if (_monStatusText) {
                _monStatusText.textContent = text || '';
            }
        }

        function _monSetConnected(connected) {
            _monitorConnected = connected;
            if (_monConnectBtn) _monConnectBtn.disabled = connected;
            if (_monDisconnectBtn) _monDisconnectBtn.disabled = !connected;
            if (_monHostInput) _monHostInput.disabled = connected;
            if (_monPortInput) _monPortInput.disabled = connected;
            var histBtn = document.getElementById('monitor-histogram-btn');
            if (histBtn) histBtn.disabled = !connected;
        }

        // --- Stat Cards ---
        function _monUpdateStats(m) {
            _monSetStat('monitor-heap-used', fmt(m.heapUsed));
            _monSetStat('monitor-heap-max', fmt(m.heapMax));
            var pct = m.heapMax > 0 ? ((m.heapUsed / m.heapMax) * 100).toFixed(1) + '%' : 'N/A';
            _monSetStat('monitor-heap-pct', pct);
            _monSetStat('monitor-threads', m.threadCount);
            _monSetStat('monitor-uptime', _monFmtUptime(m.uptime));
            _monSetStat('monitor-non-heap', fmt(m.nonHeapUsed));

            // GC stats
            var gcHtml = '';
            if (m.gcCollectors && m.gcCollectors.length > 0) {
                m.gcCollectors.forEach(function(gc) {
                    gcHtml += '<div class="monitor-gc-row">'
                        + '<span class="monitor-gc-name">' + escapeHtml(gc.name) + '</span>'
                        + '<span class="monitor-gc-count">' + fmtNum(gc.collectionCount) + ' collections</span>'
                        + '<span class="monitor-gc-time">' + fmtNum(gc.collectionTimeMs) + ' ms</span>'
                        + '</div>';
                });
            } else {
                gcHtml = '<div style="opacity:0.5;">No GC data</div>';
            }
            var gcEl = document.getElementById('monitor-gc-stats');
            if (gcEl) gcEl.innerHTML = gcHtml;
        }

        function _monSetStat(id, value) {
            var el = document.getElementById(id);
            if (el) el.textContent = value;
        }

        function _monFmtUptime(ms) {
            var s = Math.floor(ms / 1000);
            var h = Math.floor(s / 3600);
            var m = Math.floor((s % 3600) / 60);
            var sec = s % 60;
            if (h > 0) return h + 'h ' + m + 'm ' + sec + 's';
            if (m > 0) return m + 'm ' + sec + 's';
            return sec + 's';
        }

        // --- D3 Heap Gauge ---
        function _monRenderGauge(pct) {
            var container = document.getElementById('monitor-gauge');
            if (!container || typeof d3 === 'undefined') return;

            var w = 180, h = 110;
            container.innerHTML = '';
            var svg = d3.select(container).append('svg')
                .attr('width', w).attr('height', h);

            var arcGen = d3.arc()
                .innerRadius(50).outerRadius(70)
                .startAngle(-Math.PI / 2);

            // Background arc
            svg.append('path')
                .datum({ endAngle: Math.PI / 2 })
                .attr('d', arcGen)
                .attr('fill', 'var(--vscode-editorWidget-background)')
                .attr('transform', 'translate(' + (w/2) + ',' + 85 + ')');

            // Value arc
            var angle = -Math.PI/2 + (pct / 100) * Math.PI;
            var color = pct > 90 ? '#e74c3c' : pct > 70 ? '#f39c12' : '#27ae60';
            svg.append('path')
                .datum({ endAngle: angle })
                .attr('d', arcGen)
                .attr('fill', color)
                .attr('transform', 'translate(' + (w/2) + ',' + 85 + ')');

            // Center text
            svg.append('text')
                .attr('x', w/2).attr('y', 80)
                .attr('text-anchor', 'middle')
                .attr('fill', 'var(--vscode-foreground)')
                .attr('font-size', '18px')
                .attr('font-weight', 'bold')
                .text(pct.toFixed(1) + '%');

            svg.append('text')
                .attr('x', w/2).attr('y', 100)
                .attr('text-anchor', 'middle')
                .attr('fill', 'var(--vscode-foreground)')
                .attr('font-size', '11px')
                .attr('opacity', 0.6)
                .text('Heap Usage');
        }

        // --- D3 Rolling Line Chart ---
        function _monRenderLineChart() {
            var container = document.getElementById('monitor-line-chart');
            if (!container || typeof d3 === 'undefined' || _monitorHistory.length < 2) return;

            var margin = { top: 10, right: 60, bottom: 30, left: 60 };
            var w = Math.max(container.clientWidth || 400, 300);
            var h = 200;
            var innerW = w - margin.left - margin.right;
            var innerH = h - margin.top - margin.bottom;

            container.innerHTML = '';
            var svg = d3.select(container).append('svg')
                .attr('width', w).attr('height', h);
            var g = svg.append('g')
                .attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');

            var data = _monitorHistory;
            var x = d3.scaleLinear().domain([0, data.length - 1]).range([0, innerW]);
            var maxHeap = d3.max(data, function(d) { return Math.max(d.heapUsed, d.heapMax); }) || 1;
            var y = d3.scaleLinear().domain([0, maxHeap]).range([innerH, 0]);

            // Axes
            g.append('g')
                .attr('transform', 'translate(0,' + innerH + ')')
                .call(d3.axisBottom(x).ticks(5).tickFormat(function(d) {
                    var idx = Math.round(d);
                    if (idx >= 0 && idx < data.length) {
                        var ago = (data.length - 1 - idx) * 2;
                        return ago === 0 ? 'now' : '-' + ago + 's';
                    }
                    return '';
                }))
                .selectAll('text,line,path').attr('stroke', 'var(--vscode-foreground)').attr('fill', 'var(--vscode-foreground)').attr('opacity', 0.5);

            g.append('g')
                .call(d3.axisLeft(y).ticks(4).tickFormat(function(d) { return fmt(d); }))
                .selectAll('text,line,path').attr('stroke', 'var(--vscode-foreground)').attr('fill', 'var(--vscode-foreground)').attr('opacity', 0.5);

            // Max line
            var maxLine = d3.line()
                .x(function(d, i) { return x(i); })
                .y(function(d) { return y(d.heapMax); });
            g.append('path')
                .datum(data)
                .attr('fill', 'none')
                .attr('stroke', 'var(--vscode-editorWidget-border)')
                .attr('stroke-width', 1)
                .attr('stroke-dasharray', '4,4')
                .attr('d', maxLine);

            // Used line
            var usedLine = d3.line()
                .x(function(d, i) { return x(i); })
                .y(function(d) { return y(d.heapUsed); });
            g.append('path')
                .datum(data)
                .attr('fill', 'none')
                .attr('stroke', '#3498db')
                .attr('stroke-width', 2)
                .attr('d', usedLine);

            // Area under used
            var area = d3.area()
                .x(function(d, i) { return x(i); })
                .y0(innerH)
                .y1(function(d) { return y(d.heapUsed); });
            g.append('path')
                .datum(data)
                .attr('fill', '#3498db')
                .attr('opacity', 0.1)
                .attr('d', area);

            // Legend
            svg.append('text').attr('x', w - 55).attr('y', 20)
                .attr('fill', '#3498db').attr('font-size', '11px').text('Used');
            svg.append('text').attr('x', w - 55).attr('y', 35)
                .attr('fill', 'var(--vscode-editorWidget-border)').attr('font-size', '11px').text('Max');
        }

        // --- Histogram Table ---
        function _monRenderHistogram(entries) {
            var container = document.getElementById('monitor-histogram-table');
            if (!container) return;

            if (!entries || entries.length === 0) {
                container.innerHTML = '<div style="opacity:0.5;">No histogram data</div>';
                return;
            }

            // Sort by totalBytes desc, show top 50
            entries.sort(function(a, b) { return b.totalBytes - a.totalBytes; });
            var top = entries.slice(0, 50);

            var html = '<table class="data-table monitor-histogram"><thead><tr>'
                + '<th>#</th><th>Class</th><th>Instances</th><th>Total Size</th>'
                + '</tr></thead><tbody>';
            top.forEach(function(e, i) {
                html += '<tr>'
                    + '<td>' + (i + 1) + '</td>'
                    + '<td class="class-name">' + escapeHtml(e.className) + '</td>'
                    + '<td class="num">' + fmtNum(e.instanceCount) + '</td>'
                    + '<td class="num">' + fmt(e.totalBytes) + '</td>'
                    + '</tr>';
            });
            html += '</tbody></table>';
            container.innerHTML = html;
        }

        // --- Histogram Button ---
        var _monHistBtn = document.getElementById('monitor-histogram-btn');
        if (_monHistBtn) {
            _monHistBtn.addEventListener('click', function() {
                if (!_monitorConnected) return;
                _monHistBtn.disabled = true;
                _monHistBtn.textContent = 'Loading...';
                vscode.postMessage({ command: 'requestMonitorHistogram' });
            });
        }

        // --- Message Handlers ---
        onMessage('monitorConnected', function() {
            _monitorConnected = true;
            _monSetConnected(true);
            _monSetStatus('connected', 'Connected');
            _monitorHistory = [];
        });

        onMessage('monitorDisconnected', function() {
            _monitorConnected = false;
            _monSetConnected(false);
            _monSetStatus('disconnected', 'Disconnected');
        });

        onMessage('monitorMetrics', function(msg) {
            if (!msg.data) return;
            _monitorHistory.push(msg.data);
            if (_monitorHistory.length > _monitorMaxHistory) {
                _monitorHistory.shift();
            }
            _monUpdateStats(msg.data);
            var pct = msg.data.heapMax > 0 ? (msg.data.heapUsed / msg.data.heapMax) * 100 : 0;
            _monRenderGauge(pct);
            _monRenderLineChart();
        });

        onMessage('monitorHistogram', function(msg) {
            var btn = document.getElementById('monitor-histogram-btn');
            if (btn) { btn.disabled = false; btn.textContent = 'Snapshot Histogram'; }
            _monRenderHistogram(msg.data || []);
        });

        onMessage('monitorError', function(msg) {
            _monSetStatus('error', msg.message || 'Error');
            if (_monConnectBtn) _monConnectBtn.disabled = false;
        });
    `;
}
