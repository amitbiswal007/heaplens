export function getRegistryJs(): string {
    return `
        // ---- Message handler registry ----
        // Each tab self-registers handlers via onMessage(command, fn).
        // Adding a new tab never requires editing this file.
        var _messageHandlers = {};

        function onMessage(command, fn) {
            if (!_messageHandlers[command]) _messageHandlers[command] = [];
            _messageHandlers[command].push(fn);
        }

        window.addEventListener('message', function(event) {
            var msg = event.data;
            var handlers = _messageHandlers[msg.command];
            if (handlers) {
                for (var i = 0; i < handlers.length; i++) {
                    handlers[i](msg);
                }
            }
        });

        // ---- Tab activation hooks ----
        // Tabs call onTabActivate(tabName, fn) to run code when their tab is shown.
        var _tabActivateHandlers = {};

        function onTabActivate(tabName, fn) {
            if (!_tabActivateHandlers[tabName]) _tabActivateHandlers[tabName] = [];
            _tabActivateHandlers[tabName].push(fn);
        }

        // ---- Tab switching ----
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
                document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.remove('active'); });
                btn.classList.add('active');
                document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

                var hooks = _tabActivateHandlers[btn.dataset.tab];
                if (hooks) {
                    for (var i = 0; i < hooks.length; i++) {
                        hooks[i]();
                    }
                }
            });
        });
    `;
}
