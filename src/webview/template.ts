export function getHtmlTemplate(): string {
    return `
    <div class="tab-bar">
        <button class="tab-btn active" data-tab="overview">Overview</button>
        <button class="tab-btn" data-tab="histogram">Histogram</button>
        <button class="tab-btn" data-tab="domtree">Dominator Tree</button>
        <button class="tab-btn" data-tab="leaks">Leak Suspects</button>
        <button class="tab-btn" data-tab="waste">Waste</button>
        <button class="tab-btn" data-tab="source">Source</button>
        <button class="tab-btn" data-tab="query">Query</button>
        <button class="tab-btn" data-tab="compare">Compare</button>
        <button class="tab-btn" data-tab="chat">AI Chat</button>
    </div>

    <!-- Tab 1: Overview -->
    <div id="tab-overview" class="tab-content active">
        <div class="stats-bar" id="stats-bar">
            <div class="loading">Waiting for analysis...</div>
        </div>
        <div id="report-actions">
            <button class="btn" id="copy-report-btn">Copy Incident Report</button>
            <span class="report-copied" id="report-copied">Copied!</span>
        </div>
        <div id="diagnosis-section" class="diagnosis-section"></div>
        <div class="section-title">Top Objects by Retained Size</div>
        <div id="top-objects-table"></div>
        <div class="section-title">Heap Composition</div>
        <div id="pie-chart"></div>
        <div id="bar-chart"></div>
    </div>

    <!-- Tab 2: Histogram -->
    <div id="tab-histogram" class="tab-content">
        <input type="text" class="search-box" id="histogram-search" placeholder="Filter by class name...">
        <div id="histogram-table"></div>
    </div>

    <!-- Tab 3: Dominator Tree -->
    <div id="tab-domtree" class="tab-content">
        <button class="btn" id="reset-tree-btn" style="display:none; margin-bottom: 12px;">Back to Root</button>
        <div id="domtree-header" style="display:none;">
            <div class="tree-row" style="opacity:0.6; font-size:11px; border-bottom:2px solid var(--vscode-panel-border); cursor:default;">
                <span class="tree-toggle"></span>
                <span class="tree-name" style="font-weight:bold;">Class / Object</span>
                <span class="tree-type" style="background:none; border:none;">Type</span>
                <span class="tree-shallow" style="font-weight:bold;">Shallow</span>
                <span class="tree-size" style="font-weight:bold;">Retained</span>
                <span class="tree-bar-wrap"></span>
                <span class="tree-pct" style="font-weight:bold;">%</span>
            </div>
        </div>
        <div id="dominator-tree"><div class="loading">Waiting for analysis...</div></div>
        <div id="sunburst-chart"></div>
    </div>

    <!-- Tab 4: Leak Suspects -->
    <div id="tab-leaks" class="tab-content">
        <div id="leak-suspects"><div class="loading">Waiting for analysis...</div></div>
    </div>

    <!-- Tab 5: Waste -->
    <div id="tab-waste" class="tab-content">
        <div class="waste-summary-bar" id="waste-summary-bar">
            <div class="loading">Waiting for analysis...</div>
        </div>
        <div class="waste-section-title" id="waste-dup-title" style="display:none;">Duplicate Strings</div>
        <div id="waste-dup-table"></div>
        <div class="waste-section-title" id="waste-empty-title" style="display:none;">Empty Collections</div>
        <div id="waste-empty-table"></div>
    </div>

    <!-- Tab 6: Source -->
    <div id="tab-source" class="tab-content">
        <input type="text" class="search-box" id="source-search" placeholder="Filter by class name...">
        <div class="source-stats" id="source-stats"></div>
        <div id="source-table"><div class="loading">Waiting for analysis...</div></div>
    </div>

    <!-- Tab 7: Query -->
    <div id="tab-query" class="tab-content">
        <div class="query-container">
            <div class="query-input-row">
                <textarea class="query-input" id="query-input" placeholder="SELECT * FROM class_histogram ORDER BY retained_size DESC LIMIT 10" rows="3"></textarea>
                <div class="query-actions">
                    <button class="btn query-run-btn" id="query-run-btn">Run</button>
                    <button class="btn query-help-btn" id="query-help-btn" title="Show help">?</button>
                </div>
            </div>
            <div class="query-status" id="query-status"></div>
            <div class="query-history" id="query-history"></div>
            <div class="query-help" id="query-help" style="display:none;">
                <div class="query-help-title">HeapQL Reference</div>
                <div class="query-help-section">
                    <b>Tables:</b>
                    <code>instances</code> (object_id, node_type, class_name, shallow_size, retained_size),
                    <code>class_histogram</code> (class_name, instance_count, shallow_size, retained_size),
                    <code>dominator_tree</code> (same as instances; use WHERE object_id = X),
                    <code>leak_suspects</code> (class_name, object_id, retained_size, retained_percentage, description)
                </div>
                <div class="query-help-section">
                    <b>Syntax:</b> SELECT [columns|*] FROM table [WHERE conditions] [ORDER BY col [ASC|DESC]] [LIMIT n]
                </div>
                <div class="query-help-section">
                    <b>Operators:</b> =, !=, &gt;, &lt;, &gt;=, &lt;=, LIKE (% wildcards). Combine with AND / OR.
                </div>
                <div class="query-help-section">
                    <b>Special commands:</b>
                    <code>:path &lt;id&gt;</code> GC root path,
                    <code>:refs &lt;id&gt;</code> referrers,
                    <code>:children &lt;id&gt;</code> dominator children,
                    <code>:info &lt;id&gt;</code> object details
                </div>
                <div class="query-help-section">
                    <b>Examples:</b><br>
                    <code>SELECT * FROM class_histogram ORDER BY retained_size DESC LIMIT 10</code><br>
                    <code>SELECT * FROM instances WHERE class_name LIKE '%Cache%' AND retained_size &gt; 1024</code><br>
                    <code>SELECT class_name, retained_size FROM leak_suspects</code><br>
                    <code>:info 12345</code>
                </div>
            </div>
            <div class="query-results" id="query-results"></div>
        </div>
    </div>

    <!-- Tab 8: Compare -->
    <div id="tab-compare" class="tab-content">
        <div class="compare-controls">
            <label for="compare-select" style="font-size:13px; margin-right:8px;">Baseline file:</label>
            <select class="compare-select" id="compare-select">
                <option value="">-- Select a baseline --</option>
            </select>
            <button class="btn" id="compare-btn" disabled>Compare</button>
            <span class="compare-status" id="compare-status"></span>
        </div>
        <div id="compare-results"></div>
    </div>

    <!-- Tab 9: AI Chat -->
    <div id="tab-chat" class="tab-content">
        <div class="chat-container">
            <div class="chat-messages" id="chat-messages">
                <div class="chat-placeholder" id="chat-placeholder">
                    Ask questions about your heap dump analysis.<br>
                    Configure your API key in Settings > HeapLens to get started.
                </div>
            </div>
            <div class="chat-input-row">
                <textarea class="chat-input" id="chat-input" placeholder="Ask about your heap dump..." rows="1"></textarea>
                <button class="chat-send" id="chat-send">Send</button>
            </div>
        </div>
    </div>

    <div id="gc-path-container"></div>
    <div id="inspector-panel" class="inspector-panel"></div>
    <div class="source-toast" id="source-toast"></div>
    `;
}
