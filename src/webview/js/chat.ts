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

        onMessage('chatDone', function() {
            if (_currentBubble && _chatStreamBuffer) {
                _currentBubble.innerHTML = renderMarkdown(_chatStreamBuffer);
                _currentBubble.classList.add('rendered');
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
    `;
}
