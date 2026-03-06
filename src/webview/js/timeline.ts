export function getTimelineJs(): string {
    return `
        // ---- Tab: Timeline ----
        // Self-contained: file selection, D3 line charts, growth rate table.

        var _timelineFiles = [];
        var _timelineSnapshots = null;

        function _shortPath(p) {
            var parts = p.replace(/\\\\\\\\/g, '/').split('/');
            return parts[parts.length - 1];
        }

        function populateTimelineFiles(files) {
            _timelineFiles = files || [];
            var list = document.getElementById('timeline-file-list');
            if (!list) return;
            if (files.length < 2) {
                list.innerHTML = '<div style="opacity:0.5; font-size:13px;">Open and analyze at least 2 .hprof files to build a timeline.</div>';
                var btn = document.getElementById('timeline-build-btn');
                if (btn) btn.disabled = true;
                return;
            }
            var html = '';
            files.forEach(function(f, i) {
                html += '<label class="timeline-file-item">'
                    + '<input type="checkbox" value="' + escapeHtml(f) + '" checked> '
                    + escapeHtml(_shortPath(f))
                    + '</label>';
            });
            list.innerHTML = html;
            updateBuildBtn();

            list.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
                cb.addEventListener('change', updateBuildBtn);
            });
        }

        function updateBuildBtn() {
            var checked = document.querySelectorAll('#timeline-file-list input[type="checkbox"]:checked');
            var btn = document.getElementById('timeline-build-btn');
            if (btn) btn.disabled = checked.length < 2;
        }

        var _buildBtn = document.getElementById('timeline-build-btn');
        if (_buildBtn) {
            _buildBtn.addEventListener('click', function() {
                var checked = document.querySelectorAll('#timeline-file-list input[type="checkbox"]:checked');
                var paths = [];
                checked.forEach(function(cb) { paths.push(cb.value); });
                if (paths.length < 2) return;
                _buildBtn.disabled = true;
                _buildBtn.textContent = 'Building...';
                vscode.postMessage({ command: 'getTimelineData', paths: paths, topN: 10 });
            });
        }

        function renderTimeline(result) {
            var btn = document.getElementById('timeline-build-btn');
            if (btn) { btn.disabled = false; btn.textContent = 'Build Timeline'; }
            if (!result || !result.snapshots || result.snapshots.length < 2) {
                document.getElementById('timeline-charts').innerHTML = '<div style="opacity:0.5;">Not enough data to build timeline.</div>';
                return;
            }

            _timelineSnapshots = result.snapshots;
            var snapshots = result.snapshots;
            var chartsEl = document.getElementById('timeline-charts');
            chartsEl.innerHTML = '';

            // 1. Total heap size line chart
            renderHeapSizeLine(chartsEl, snapshots);

            // 2. Top class multi-line chart
            renderClassLines(chartsEl, snapshots);

            // 3. Growth rate table
            renderGrowthTable(chartsEl, snapshots);
        }

        function renderHeapSizeLine(container, snapshots) {
            if (typeof d3 === 'undefined') return;
            var titleDiv = document.createElement('div');
            titleDiv.className = 'section-title';
            titleDiv.textContent = 'Total Heap Size Over Snapshots';
            container.appendChild(titleDiv);

            var w = container.clientWidth || 600;
            var h = 250;
            var margin = { top: 20, right: 30, bottom: 40, left: 80 };

            var svg = d3.select(container).append('svg').attr('width', w).attr('height', h);
            var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
            var innerW = w - margin.left - margin.right;
            var innerH = h - margin.top - margin.bottom;

            var x = d3.scaleLinear().domain([0, snapshots.length - 1]).range([0, innerW]);
            var maxHeap = d3.max(snapshots, function(s) { return s.summary.total_heap_size; }) || 1;
            var y = d3.scaleLinear().domain([0, maxHeap * 1.1]).range([innerH, 0]);

            g.append('g').attr('transform', 'translate(0,' + innerH + ')')
                .call(d3.axisBottom(x).ticks(snapshots.length).tickFormat(function(i) { return _shortPath(snapshots[i] ? snapshots[i].path : ''); }))
                .selectAll('text').attr('transform', 'rotate(-20)').style('text-anchor', 'end').attr('font-size', '10px');

            g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(function(v) { return fmt(v); }));

            var line = d3.line()
                .x(function(d, i) { return x(i); })
                .y(function(d) { return y(d.summary.total_heap_size); });

            g.append('path').datum(snapshots).attr('d', line)
                .attr('fill', 'none').attr('stroke', 'var(--vscode-charts-blue, #4fc1ff)').attr('stroke-width', 2);

            g.selectAll('circle').data(snapshots).enter().append('circle')
                .attr('cx', function(d, i) { return x(i); })
                .attr('cy', function(d) { return y(d.summary.total_heap_size); })
                .attr('r', 4)
                .attr('fill', 'var(--vscode-charts-blue, #4fc1ff)');
        }

        function renderClassLines(container, snapshots) {
            if (typeof d3 === 'undefined') return;

            // Collect all class names across snapshots and find top 10 by total retained delta
            var classMap = {};
            snapshots.forEach(function(snap) {
                (snap.top_classes || []).forEach(function(c) {
                    if (!classMap[c.class_name]) classMap[c.class_name] = [];
                });
            });

            // For each class, collect retained sizes per snapshot
            Object.keys(classMap).forEach(function(cn) {
                snapshots.forEach(function(snap, i) {
                    var entry = (snap.top_classes || []).find(function(c) { return c.class_name === cn; });
                    classMap[cn].push(entry ? entry.retained_size : 0);
                });
            });

            // Find top 10 by absolute delta (last - first)
            var classes = Object.keys(classMap).map(function(cn) {
                var vals = classMap[cn];
                var delta = Math.abs(vals[vals.length - 1] - vals[0]);
                return { name: cn, values: vals, delta: delta };
            });
            classes.sort(function(a, b) { return b.delta - a.delta; });
            classes = classes.slice(0, 10);

            if (classes.length === 0) return;

            var titleDiv = document.createElement('div');
            titleDiv.className = 'section-title';
            titleDiv.textContent = 'Top Classes by Change';
            container.appendChild(titleDiv);

            var w = container.clientWidth || 600;
            var h = 300;
            var margin = { top: 20, right: 150, bottom: 40, left: 80 };

            var svg = d3.select(container).append('svg').attr('width', w).attr('height', h);
            var g = svg.append('g').attr('transform', 'translate(' + margin.left + ',' + margin.top + ')');
            var innerW = w - margin.left - margin.right;
            var innerH = h - margin.top - margin.bottom;

            var x = d3.scaleLinear().domain([0, snapshots.length - 1]).range([0, innerW]);
            var maxVal = 0;
            classes.forEach(function(c) { c.values.forEach(function(v) { if (v > maxVal) maxVal = v; }); });
            var y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([innerH, 0]);
            var color = d3.scaleOrdinal(d3.schemeCategory10);

            g.append('g').attr('transform', 'translate(0,' + innerH + ')')
                .call(d3.axisBottom(x).ticks(snapshots.length).tickFormat(function(i) { return '#' + (i + 1); }));
            g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(function(v) { return fmt(v); }));

            var line = d3.line()
                .x(function(d, i) { return x(i); })
                .y(function(d) { return y(d); });

            classes.forEach(function(c, ci) {
                g.append('path').datum(c.values).attr('d', line)
                    .attr('fill', 'none').attr('stroke', color(ci)).attr('stroke-width', 1.5);

                // Legend
                var shortName = c.name;
                var lastDot = shortName.lastIndexOf('.');
                if (lastDot !== -1) shortName = shortName.substring(lastDot + 1);
                if (shortName.length > 20) shortName = shortName.substring(0, 19) + '\\u2026';
                svg.append('text')
                    .attr('x', w - margin.right + 10)
                    .attr('y', margin.top + ci * 14 + 10)
                    .attr('fill', color(ci)).attr('font-size', '10px')
                    .text(shortName);
            });
        }

        function renderGrowthTable(container, snapshots) {
            if (snapshots.length < 2) return;

            var titleDiv = document.createElement('div');
            titleDiv.className = 'section-title';
            titleDiv.textContent = 'Growth Rate';
            container.appendChild(titleDiv);

            // Build class deltas between first and last snapshot
            var first = snapshots[0];
            var last = snapshots[snapshots.length - 1];
            var firstMap = {};
            var lastMap = {};
            (first.top_classes || []).forEach(function(c) { firstMap[c.class_name] = c.retained_size; });
            (last.top_classes || []).forEach(function(c) { lastMap[c.class_name] = c.retained_size; });

            var allClasses = {};
            Object.keys(firstMap).forEach(function(k) { allClasses[k] = true; });
            Object.keys(lastMap).forEach(function(k) { allClasses[k] = true; });

            var rows = Object.keys(allClasses).map(function(cn) {
                var f = firstMap[cn] || 0;
                var l = lastMap[cn] || 0;
                var delta = l - f;
                var growthPct = f > 0 ? ((delta / f) * 100) : (l > 0 ? 100 : 0);
                // Anomaly: >50% consecutive growth across all snapshots
                var anomaly = false;
                if (snapshots.length >= 3) {
                    var consecutive = 0;
                    for (var si = 1; si < snapshots.length; si++) {
                        var prevEntry = (snapshots[si - 1].top_classes || []).find(function(c) { return c.class_name === cn; });
                        var currEntry = (snapshots[si].top_classes || []).find(function(c) { return c.class_name === cn; });
                        var prevVal = prevEntry ? prevEntry.retained_size : 0;
                        var currVal = currEntry ? currEntry.retained_size : 0;
                        if (prevVal > 0 && ((currVal - prevVal) / prevVal) > 0.5) consecutive++;
                        else consecutive = 0;
                    }
                    anomaly = consecutive >= 2;
                }
                return { class_name: cn, first: f, last: l, delta: delta, growthPct: growthPct, anomaly: anomaly };
            });

            rows.sort(function(a, b) { return Math.abs(b.delta) - Math.abs(a.delta); });

            var html = '<table class="timeline-growth-table"><thead><tr><th>Class</th><th class="right">First</th><th class="right">Last</th><th class="right">Delta</th><th class="right">Growth %</th><th></th></tr></thead><tbody>';
            rows.forEach(function(r) {
                var cls = r.anomaly ? ' class="anomaly"' : '';
                html += '<tr' + cls + '>';
                html += '<td>' + escapeHtml(r.class_name) + '</td>';
                html += '<td class="right">' + fmt(r.first) + '</td>';
                html += '<td class="right">' + fmt(r.last) + '</td>';
                html += '<td class="right ' + (r.delta > 0 ? 'delta-positive' : (r.delta < 0 ? 'delta-negative' : 'delta-zero')) + '">' + (r.delta > 0 ? '\\u2191+' : (r.delta < 0 ? '\\u2193' : '')) + fmt(Math.abs(r.delta)) + '</td>';
                html += '<td class="right">' + r.growthPct.toFixed(1) + '%</td>';
                html += '<td>' + (r.anomaly ? '\\u26A0 Anomaly' : '') + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';

            var tableDiv = document.createElement('div');
            tableDiv.innerHTML = html;
            container.appendChild(tableDiv);
        }

        // ---- Self-register ----
        onTabActivate('timeline', function() {
            vscode.postMessage({ command: 'listAllAnalyzedFiles' });
        });

        onMessage('allAnalyzedFiles', function(msg) {
            populateTimelineFiles(msg.files || []);
        });

        onMessage('timelineDataResponse', function(msg) {
            renderTimeline(msg.result);
        });
    `;
}
