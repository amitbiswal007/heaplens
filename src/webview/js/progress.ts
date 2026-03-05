export function getProgressJs(): string {
    return `
        // ---- Progress Bar + File Metadata ----
        // Self-contained: shows multi-phase progress and file metadata.
        // Auto-hides on analysisComplete.

        var _progressPhaseLabels = {
            loading: 'Loading file',
            graph_building: 'Building graph',
            graph_built: 'Graph built',
            dominators: 'Computing dominators'
        };

        function renderProgressBar(stage, phase, totalPhases) {
            var bar = document.getElementById('progress-bar');
            if (!bar) return;
            var html = '<div class="progress-steps">';
            for (var i = 1; i <= totalPhases; i++) {
                var cls = 'progress-step';
                if (i < phase) cls += ' done';
                else if (i === phase) cls += ' active';
                html += '<div class="' + cls + '">';
                html += '<span class="progress-dot"></span>';
                if (i === phase) {
                    var label = _progressPhaseLabels[stage] || ('Phase ' + i);
                    html += '<span class="progress-label">' + escapeHtml(label) + '...</span>';
                }
                html += '</div>';
                if (i < totalPhases) html += '<span class="progress-connector' + (i < phase ? ' done' : '') + '"></span>';
            }
            html += '</div>';
            bar.innerHTML = html;
            bar.style.display = 'block';
        }

        function renderFileMetadata(meta) {
            var el = document.getElementById('file-metadata');
            if (!el || !meta) return;
            var parts = [];
            if (meta.file_size) parts.push('File size: ' + fmt(meta.file_size));
            if (parts.length > 0) {
                el.innerHTML = parts.map(function(p) { return '<span class="file-meta-item">' + p + '</span>'; }).join('');
                el.style.display = 'flex';
            }
        }

        onMessage('analysisProgress', function(msg) {
            if (msg.phase && msg.totalPhases) {
                renderProgressBar(msg.stage, msg.phase, msg.totalPhases);
            }
            if (msg.fileMetadata) {
                renderFileMetadata(msg.fileMetadata);
            }
        });

        onMessage('analysisComplete', function() {
            var bar = document.getElementById('progress-bar');
            if (bar) bar.style.display = 'none';
        });
    `;
}
