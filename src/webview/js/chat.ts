export function getChatJs(): string {
    return `
        // ---- Tab 9: AI Chat ----
        // Self-contained: owns streaming state, bubble creation, DOM refs.

        var _chatMessages = document.getElementById('chat-messages');
        var _chatInput = document.getElementById('chat-input');
        var _chatSend = document.getElementById('chat-send');
        var _chatPlaceholder = document.getElementById('chat-placeholder');
        var _currentBubble = null;
        var _isChatStreaming = false;
        var _chatStreamBuffer = '';
        var _pendingChatQuery = null; // { bubble, codeBlock } when waiting for query result

        function addChatBubble(role, text) {
            if (_chatPlaceholder) _chatPlaceholder.style.display = 'none';
            var bubble = document.createElement('div');
            bubble.className = 'chat-bubble ' + role;
            bubble.textContent = text;
            _chatMessages.appendChild(bubble);
            _chatMessages.scrollTop = _chatMessages.scrollHeight;
            return bubble;
        }

        function sendChatMessage() {
            var text = _chatInput.value.trim();
            if (!text || _isChatStreaming) return;
            addChatBubble('user', text);
            _chatInput.value = '';
            _chatInput.style.height = 'auto';
            _currentBubble = addChatBubble('assistant', '');
            _chatStreamBuffer = '';
            _isChatStreaming = true;
            _chatSend.disabled = true;
            vscode.postMessage({ command: 'chatMessage', text: text });
        }

        _chatSend.addEventListener('click', sendChatMessage);
        _chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
        });
        _chatInput.addEventListener('input', function() {
            _chatInput.style.height = 'auto';
            _chatInput.style.height = Math.min(_chatInput.scrollHeight, 120) + 'px';
        });

        // ---- Self-register ----
        onMessage('chatChunk', function(msg) {
            if (_currentBubble) {
                _chatStreamBuffer += msg.text;
                _currentBubble.textContent = _chatStreamBuffer;
                _chatMessages.scrollTop = _chatMessages.scrollHeight;
            }
        });

        function attachHeapqlButtons(bubble) {
            var codeBlocks = bubble.querySelectorAll('code.language-heapql');
            codeBlocks.forEach(function(codeEl) {
                var pre = codeEl.closest('pre');
                if (!pre) return;
                var query = codeEl.textContent.trim();
                if (!query) return;
                var btn = document.createElement('button');
                btn.className = 'chat-run-query-btn';
                btn.textContent = 'Run Query';
                btn.addEventListener('click', function() {
                    btn.disabled = true;
                    btn.textContent = 'Running...';
                    _pendingChatQuery = { bubble: bubble, codeBlock: pre, button: btn };
                    vscode.postMessage({ command: 'executeQuery', query: query });
                });
                pre.insertAdjacentElement('afterend', btn);
            });
        }

        function renderChatQueryResult(pre, btn, result) {
            // Remove any existing result for this block
            var existing = pre.parentElement.querySelector('.chat-query-result');
            if (existing) existing.remove();

            var container = document.createElement('div');
            container.className = 'chat-query-result';

            if (!result || !result.rows || result.rows.length === 0) {
                container.innerHTML = '<div style="opacity:0.5;padding:8px;">No results</div>';
                btn.insertAdjacentElement('afterend', container);
                btn.textContent = 'Run Query';
                btn.disabled = false;
                return;
            }

            var cols = result.columns || [];
            var rows = result.rows || [];
            var maxRows = Math.min(rows.length, 50);

            var html = '<table><thead><tr>';
            cols.forEach(function(c) { html += '<th>' + escapeHtml(c) + '</th>'; });
            html += '</tr></thead><tbody>';

            for (var i = 0; i < maxRows; i++) {
                html += '<tr>';
                cols.forEach(function(c, ci) {
                    var val = rows[i][ci];
                    if (c === 'shallow_size' || c === 'retained_size') {
                        html += '<td class="right">' + fmt(val) + '</td>';
                    } else {
                        html += '<td>' + escapeHtml(String(val != null ? val : '')) + '</td>';
                    }
                });
                html += '</tr>';
            }
            html += '</tbody></table>';

            if (rows.length > maxRows) {
                html += '<div class="chat-query-more">Showing ' + maxRows + ' of ' + rows.length + ' rows. <span class="chat-query-link">See full results in Query tab</span></div>';
            }

            var timeMs = result.execution_time_ms !== undefined ? result.execution_time_ms : '?';
            html += '<div class="chat-query-status">' + rows.length + ' rows (' + timeMs + 'ms)</div>';

            container.innerHTML = html;
            btn.insertAdjacentElement('afterend', container);
            btn.textContent = 'Run Query';
            btn.disabled = false;

            // "See full results" link switches to query tab
            var link = container.querySelector('.chat-query-link');
            if (link) {
                link.addEventListener('click', function() {
                    var queryTab = document.querySelector('.tab-btn[data-tab="query"]');
                    if (queryTab) queryTab.click();
                });
            }

            _chatMessages.scrollTop = _chatMessages.scrollHeight;
        }

        onMessage('chatDone', function() {
            if (_currentBubble && _chatStreamBuffer) {
                _currentBubble.innerHTML = renderMarkdown(_chatStreamBuffer);
                _currentBubble.classList.add('rendered');
                attachHeapqlButtons(_currentBubble);
            }
            _isChatStreaming = false;
            _chatSend.disabled = false;
            _currentBubble = null;
            _chatStreamBuffer = '';
        });

        onMessage('chatError', function(msg) {
            _isChatStreaming = false;
            _chatSend.disabled = false;
            _currentBubble = null;
            _chatStreamBuffer = '';
            addChatBubble('error', msg.message || 'An error occurred');
        });

        onMessage('queryResult', function(msg) {
            if (_pendingChatQuery) {
                renderChatQueryResult(_pendingChatQuery.codeBlock, _pendingChatQuery.button, msg.result);
                _pendingChatQuery = null;
                return true;
            }
            return false;
        });

        onMessage('restoreChatHistory', function(msg) {
            var messages = msg.messages || [];
            if (messages.length === 0) return;
            if (_chatPlaceholder) _chatPlaceholder.style.display = 'none';
            messages.forEach(function(m) {
                if (m.role === 'user') {
                    addChatBubble('user', m.content);
                } else if (m.role === 'assistant') {
                    var bubble = addChatBubble('assistant', '');
                    bubble.innerHTML = renderMarkdown(m.content);
                    bubble.classList.add('rendered');
                    attachHeapqlButtons(bubble);
                }
            });
        });

        var _chatClear = document.getElementById('chat-clear');
        if (_chatClear) {
            _chatClear.addEventListener('click', function() {
                _chatMessages.innerHTML = '';
                if (_chatPlaceholder) {
                    _chatPlaceholder.style.display = 'block';
                    _chatMessages.appendChild(_chatPlaceholder);
                }
                vscode.postMessage({ command: 'clearChatHistory' });
            });
        }
    `;
}
