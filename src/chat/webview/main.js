/**
 * Kiro Chat Panel — Webview main script.
 *
 * Handles message exchange with the extension host via postMessage,
 * renders markdown content with syntax-highlighted code blocks and copy buttons,
 * manages model selection, tool status display, system messages, and chat UI state.
 *
 * Requirements: 4.2–4.8, 11.1, 12.1–12.5
 */

(function () {
    // @ts-ignore — acquireVsCodeApi is injected by the VS Code webview runtime
    const vscode = acquireVsCodeApi();

    // ---- DOM References ----
    const messagesEl = document.getElementById('messages');
    const loadingEl = document.getElementById('loading-indicator');
    const specPhaseBar = document.getElementById('spec-phase-bar');
    const inputEl = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const modelSelector = document.getElementById('model-selector');
    const clearChatBtn = document.getElementById('clear-chat-btn');
    const contextRing = document.getElementById('context-ring');
    const contextUsageEl = document.getElementById('context-usage');

    /** @type {HTMLDivElement|null} Current assistant message element being streamed into */
    let currentAssistantMsg = null;
    /** @type {string} Accumulated content for the current streaming response */
    let streamBuffer = '';
    /** @type {Object<string, string>} Maps display name to config value for model selector */
    let modelValueMap = {};
    /** @type {string|null} The config option ID for the model selector */
    let modelConfigId = null;
    /** @type {boolean} Guard to prevent model selector change events during programmatic updates */
    let updatingModelSelector = false;

    // ---- Default Models (Requirement 12.5) ----
    var defaultModels = [
        { name: 'Auto', value: 'auto' },
        { name: 'Claude Opus 4.6', value: 'claude-opus4.6' },
        { name: 'Claude Opus 4.5', value: 'claude-opus4.5' },
        { name: 'Claude Sonnet 4.6', value: 'claude-sonnet4.6' },
        { name: 'Claude Sonnet 4.5', value: 'claude-sonnet4.5' },
        { name: 'Claude Sonnet 4.0', value: 'claude-sonnet4.0' },
        { name: 'Claude Haiku 4.5', value: 'claude-haiku4.5' },
        { name: 'MiniMax 2.5', value: 'minimax-2.5' },
        { name: 'DeepSeek 3.2', value: 'deepseek-3.2' },
        { name: 'MiniMax 2.1', value: 'minimax-2.1' },
        { name: 'Qwen3 Coder Next', value: 'qwen3-coder-next' }
    ];

    // Initialize model selector with defaults
    initializeDefaultModels();

    // ---- Outgoing Messages ----

    /**
     * Sends a user message to the extension host.
     */
    function sendMessage() {
        var text = inputEl.value.trim();
        if (!text) {
            return;
        }
        appendUserMessage(text);
        vscode.postMessage({ type: 'sendMessage', text: text });
        inputEl.value = '';
        autoResizeInput();
    }

    /**
     * Sends a retry request to the extension host.
     */
    function sendRetry() {
        vscode.postMessage({ type: 'retry' });
    }

    // ---- Clear Chat Button ----
    if (clearChatBtn) {
        clearChatBtn.addEventListener('click', function () {
            vscode.postMessage({ type: 'clearChat' });
        });
    }

    // ---- Start Spec Button ----
    var startSpecBtn = document.getElementById('start-spec-btn');
    if (startSpecBtn) {
        startSpecBtn.addEventListener('click', function () {
            vscode.postMessage({ type: 'startSpec' });
        });
    }

    // ---- Incoming Messages ----

    window.addEventListener('message', function (event) {
        var msg = event.data;
        switch (msg.type) {
            case 'response':
                handleResponse(msg.content, msg.done);
                break;
            case 'toolStatus':
                handleToolStatus(msg.title, msg.status, msg.kind);
                break;
            case 'error':
                handleError(msg.message);
                break;
            case 'loading':
                handleLoading(msg.active);
                break;
            case 'specPhase':
                handleSpecPhase(msg.phase, msg.phaseIndex);
                break;
            case 'specPhaseBar':
                handleSpecPhaseBar(msg.phase, msg.phaseIndex, msg.phases);
                break;
            case 'systemMessage':
                handleSystemMessage(msg.message);
                break;
            case 'configOptions':
                handleConfigOptions(msg.options);
                break;
            case 'clearChat':
                handleClearChat();
                break;
            case 'contextUsage':
                handleContextUsage(msg.usage);
                break;
        }
    });

    // ---- Message Handlers ----

    /**
     * Handles a streaming response chunk from the extension host.
     * Appends content to the current assistant message, or creates one.
     * When done=true, finalizes the message with copy buttons on code blocks.
     * @param {string} content
     * @param {boolean} done
     */
    function handleResponse(content, done) {
        if (!currentAssistantMsg) {
            currentAssistantMsg = createMessageEl('assistant');
            streamBuffer = '';
        }

        streamBuffer += content;

        // Render accumulated markdown
        currentAssistantMsg.innerHTML = renderMarkdown(streamBuffer);

        if (done) {
            // Add copy buttons to code blocks (Requirement 4.4)
            addCopyButtons(currentAssistantMsg);
            currentAssistantMsg = null;
            streamBuffer = '';
        }

        scrollToBottom();
    }

    /**
     * Handles a tool status update from the extension host.
     * Shows tool activity as a separate compact element between text chunks.
     * Requirement 4.6
     * @param {string} title
     * @param {string} status
     * @param {string} kind
     */
    function handleToolStatus(title, status, kind) {
        // Finalize current assistant message so tool status appears separately
        if (currentAssistantMsg && streamBuffer) {
            currentAssistantMsg.innerHTML = renderMarkdown(streamBuffer);
            addCopyButtons(currentAssistantMsg);
            currentAssistantMsg = null;
            streamBuffer = '';
        }

        // Skip generic entries (e.g. just "read" or "write")
        if (status === 'in_progress' && (title === 'read' || title === 'write' || title === 'shell')) {
            return;
        }

        var icon = status === 'completed' ? '✓' : '⏳';
        var el = document.createElement('div');
        el.className = 'tool-status' + (status === 'completed' ? ' completed' : '');
        el.textContent = icon + ' ' + title;
        messagesEl.appendChild(el);

        scrollToBottom();
    }

    /**
     * Displays an error message with a red label and retry button.
     * Requirement 11.1
     * @param {string} message
     */
    function handleError(message) {
        // Finalize any in-progress assistant message
        if (currentAssistantMsg && streamBuffer) {
            currentAssistantMsg.innerHTML = renderMarkdown(streamBuffer);
            addCopyButtons(currentAssistantMsg);
        }
        currentAssistantMsg = null;
        streamBuffer = '';

        var el = createMessageEl('error');
        el.innerHTML =
            '<span class="error-label">Error:</span> ' +
            escapeHtml(message) +
            '<br><button class="error-retry-btn">Retry</button>';

        var retryBtn = el.querySelector('.error-retry-btn');
        if (retryBtn) {
            retryBtn.addEventListener('click', sendRetry);
        }

        scrollToBottom();
    }

    /**
     * Shows or hides the animated loading indicator.
     * Requirement 4.5
     * @param {boolean} active
     */
    function handleLoading(active) {
        if (loadingEl) {
            if (active) {
                loadingEl.classList.remove('hidden');
            } else {
                loadingEl.classList.add('hidden');
            }
        }
        scrollToBottom();
    }

    /**
     * Displays the spec phase indicator bar (legacy simple version).
     * @param {string} phase
     * @param {number} phaseIndex
     */
    function handleSpecPhase(phase, phaseIndex) {
        if (!specPhaseBar) {
            return;
        }
        var phases = ['requirements', 'design', 'tasks'];
        specPhaseBar.classList.remove('hidden');
        specPhaseBar.innerHTML = phases
            .map(function (p, i) {
                var cls = 'spec-phase' + (i === phaseIndex ? ' active' : '');
                return '<span class="' + cls + '">' + escapeHtml(p) + '</span>';
            })
            .join('');
    }

    /**
     * Renders the interactive spec phase bar with badges and action buttons.
     * Green badge for completed phases, blue for current, grey for future.
     * @param {string} phase - Current phase name
     * @param {number} phaseIndex - Current phase index
     * @param {string[]} phases - All phase names
     */
    function handleSpecPhaseBar(phase, phaseIndex, phases) {
        if (!specPhaseBar) {
            return;
        }

        // Hide if no phases (workflow ended)
        if (!phases || phases.length === 0 || phaseIndex < 0) {
            specPhaseBar.classList.add('hidden');
            specPhaseBar.innerHTML = '';
            return;
        }

        specPhaseBar.classList.remove('hidden');

        var isLastPhase = phaseIndex === phases.length - 1;

        // Build phase badges
        var badgesHtml = '<div class="spec-phases-list">';
        for (var i = 0; i < phases.length; i++) {
            var badgeClass = 'spec-phase';
            if (i < phaseIndex) {
                badgeClass += ' completed';
            } else if (i === phaseIndex) {
                badgeClass += ' active';
            } else {
                badgeClass += ' future';
            }
            badgesHtml += '<span class="' + badgeClass + '">' + escapeHtml(phases[i]) + '</span>';
        }
        badgesHtml += '<span class="spec-phase-description">Phase ' + (phaseIndex + 1) + ' of ' + phases.length + '</span>';
        badgesHtml += '</div>';

        // Build action buttons: Save | Save & Continue (or Save & Finish) | Cancel
        var actionsHtml = '<div class="spec-phase-actions">';
        actionsHtml += '<button class="spec-save-only-btn" id="spec-save-only-btn">💾 Save</button>';
        if (isLastPhase) {
            actionsHtml += '<button class="spec-accept-btn" id="spec-accept-btn">✅ Save &amp; Finish</button>';
        } else {
            actionsHtml += '<button class="spec-accept-btn" id="spec-accept-btn">✅ Save &amp; Continue →</button>';
        }
        actionsHtml += '<button class="spec-cancel-btn" id="spec-cancel-btn">✕ Cancel</button>';
        actionsHtml += '</div>';

        specPhaseBar.innerHTML = badgesHtml + actionsHtml;

        // Wire up button events
        var saveOnlyBtn = document.getElementById('spec-save-only-btn');
        var acceptBtn = document.getElementById('spec-accept-btn');
        var cancelBtn = document.getElementById('spec-cancel-btn');

        if (saveOnlyBtn) {
            saveOnlyBtn.addEventListener('click', function () {
                vscode.postMessage({ type: 'specSave' });
            });
        }
        if (acceptBtn) {
            acceptBtn.addEventListener('click', function () {
                vscode.postMessage({ type: 'specAccept' });
            });
        }
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () {
                vscode.postMessage({ type: 'specCancel' });
            });
        }
    }

    /**
     * Displays a system message with muted styling.
     * Requirement 4.7
     * @param {string} message
     */
    function handleSystemMessage(message) {
        var el = document.createElement('div');
        el.className = 'system-message';
        el.textContent = message;
        messagesEl.appendChild(el);
        scrollToBottom();
    }

    /**
     * Updates the model selector dropdown from config options.
     * Requirement 12.1, 12.4
     * @param {Array} options
     */
    function handleConfigOptions(options) {
        var modelOption = null;
        for (var i = 0; i < options.length; i++) {
            if (options[i].category === 'model') {
                modelOption = options[i];
                break;
            }
        }
        if (!modelOption) {
            return;
        }

        modelConfigId = modelOption.id;
        updatingModelSelector = true;

        // Clear and repopulate
        modelSelector.innerHTML = '';
        modelValueMap = {};

        for (var j = 0; j < modelOption.options.length; j++) {
            var opt = modelOption.options[j];
            var optEl = document.createElement('option');
            optEl.value = opt.value;
            optEl.textContent = opt.name;
            modelSelector.appendChild(optEl);
            modelValueMap[opt.name] = opt.value;
        }

        // Select current value
        modelSelector.value = modelOption.currentValue;
        modelSelector.style.display = modelOption.options.length > 0 ? '' : 'none';

        updatingModelSelector = false;
    }

    /**
     * Clears all messages from the chat panel.
     */
    function handleClearChat() {
        messagesEl.innerHTML = '';
        currentAssistantMsg = null;
        streamBuffer = '';
    }

    /**
     * Updates the context usage indicator SVG ring and tooltip.
     * Color-coded: green (<50%), yellow (50-80%), red (>80%).
     * @param {{ conversation: number, mcpTools: number, steeringFiles: number, total: number }} usage
     */
    function handleContextUsage(usage) {
        if (!contextRing || !contextUsageEl) {
            return;
        }

        var total = usage.total || 0;
        var circumference = 2 * Math.PI * 7; // r=7, circumference ≈ 43.98

        // Calculate stroke-dasharray for the filled portion
        var filled = (total / 100) * circumference;
        var remaining = circumference - filled;
        contextRing.setAttribute('stroke-dasharray', filled + ' ' + remaining);

        // Color based on usage level
        var color;
        if (total < 50) {
            color = '#73c991'; // green
        } else if (total < 80) {
            color = '#cca700'; // yellow
        } else {
            color = '#f48771'; // red
        }
        contextRing.setAttribute('stroke', color);

        // Update tooltip text
        contextUsageEl.title = 'Context usage: ' + Math.round(total) + '%';

        var ctxConversation = document.getElementById('ctx-conversation');
        var ctxMcp = document.getElementById('ctx-mcp');
        var ctxSteering = document.getElementById('ctx-steering');
        var ctxTotal = document.getElementById('ctx-total');

        if (ctxConversation) { ctxConversation.textContent = Math.round(usage.conversation || 0); }
        if (ctxMcp) { ctxMcp.textContent = Math.round(usage.mcpTools || 0); }
        if (ctxSteering) { ctxSteering.textContent = Math.round(usage.steeringFiles || 0); }
        if (ctxTotal) { ctxTotal.textContent = Math.round(total); }
    }

    // ---- Model Selector ----

    /**
     * Initialize the model selector with default models.
     * Requirement 12.5
     */
    function initializeDefaultModels() {
        updatingModelSelector = true;
        modelSelector.innerHTML = '';
        modelValueMap = {};
        modelConfigId = 'chat.model';

        for (var i = 0; i < defaultModels.length; i++) {
            var m = defaultModels[i];
            var optEl = document.createElement('option');
            optEl.value = m.value;
            optEl.textContent = m.name;
            modelSelector.appendChild(optEl);
            modelValueMap[m.name] = m.value;
        }

        modelSelector.value = 'auto';
        updatingModelSelector = false;
    }

    modelSelector.addEventListener('change', function () {
        if (updatingModelSelector) {
            return;
        }
        var value = modelSelector.value;
        var configId = modelConfigId || 'chat.model';
        vscode.postMessage({ type: 'selectModel', configId: configId, value: value });
    });

    // ---- DOM Helpers ----

    /**
     * Appends a user message bubble to the chat.
     * @param {string} text
     */
    function appendUserMessage(text) {
        var el = createMessageEl('user');
        el.textContent = text;
        scrollToBottom();
    }

    /**
     * Creates a message element and appends it to the messages container.
     * @param {'user'|'assistant'|'error'} role
     * @returns {HTMLDivElement}
     */
    function createMessageEl(role) {
        var el = document.createElement('div');
        el.className = 'message ' + role;
        messagesEl.appendChild(el);
        return el;
    }

    /**
     * Adds copy-to-clipboard buttons to all code blocks in a message element.
     * Requirement 4.4
     * @param {HTMLElement} messageEl
     */
    function addCopyButtons(messageEl) {
        var codeBlocks = messageEl.querySelectorAll('pre');
        for (var i = 0; i < codeBlocks.length; i++) {
            var pre = codeBlocks[i];
            // Skip if already has a copy button
            if (pre.querySelector('.copy-btn')) {
                continue;
            }

            var btn = document.createElement('button');
            btn.className = 'copy-btn';
            btn.textContent = '📋';
            btn.title = 'Copy to clipboard';
            btn.setAttribute('aria-label', 'Copy code to clipboard');

            // Capture the code content for the click handler
            (function (codeBlock, copyBtn) {
                copyBtn.addEventListener('click', function () {
                    var codeEl = codeBlock.querySelector('code');
                    var text = codeEl ? codeEl.textContent : codeBlock.textContent;
                    navigator.clipboard.writeText(text || '').then(function () {
                        copyBtn.textContent = '✓';
                        setTimeout(function () {
                            copyBtn.textContent = '📋';
                        }, 1500);
                    });
                });
            })(pre, btn);

            // Position the button in the code block header if present, otherwise in the pre
            var header = pre.querySelector('.code-block-header');
            if (header) {
                header.appendChild(btn);
            } else {
                pre.style.position = 'relative';
                btn.style.position = 'absolute';
                btn.style.top = '4px';
                btn.style.right = '4px';
                pre.appendChild(btn);
            }
        }
    }

    function scrollToBottom() {
        if (messagesEl) {
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
    }

    // ---- Input Handling ----

    inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    inputEl.addEventListener('input', autoResizeInput);

    sendBtn.addEventListener('click', sendMessage);

    function autoResizeInput() {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    }

    // ---- Markdown Renderer ----

    /**
     * Lightweight inline markdown renderer.
     * Handles: code blocks with language tags, inline code, bold, italic,
     * links, unordered/ordered lists, and paragraphs.
     *
     * @param {string} text
     * @returns {string} HTML string
     */
    function renderMarkdown(text) {
        // Normalize line endings
        var src = text.replace(/\r\n/g, '\n');

        var html = '';
        var lines = src.split('\n');
        var i = 0;

        while (i < lines.length) {
            var line = lines[i];

            // Fenced code block
            var codeMatch = line.match(/^```(\w*)/);
            if (codeMatch) {
                var lang = codeMatch[1] || '';
                var codeLines = [];
                i++;
                while (i < lines.length && !lines[i].match(/^```\s*$/)) {
                    codeLines.push(lines[i]);
                    i++;
                }
                i++; // skip closing ```
                var codeContent = codeLines.join('\n');
                var header = lang
                    ? '<div class="code-block-header"><span class="code-lang">' + escapeHtml(lang) + '</span></div>'
                    : '<div class="code-block-header"></div>';
                html += '<pre>' + header + '<code>' + highlightCode(escapeHtml(codeContent), lang) + '</code></pre>';
                continue;
            }

            // Unordered list item
            if (line.match(/^\s*[-*+]\s+/)) {
                html += '<ul>';
                while (i < lines.length && lines[i].match(/^\s*[-*+]\s+/)) {
                    var itemText = lines[i].replace(/^\s*[-*+]\s+/, '');
                    html += '<li>' + renderInline(itemText) + '</li>';
                    i++;
                }
                html += '</ul>';
                continue;
            }

            // Ordered list item
            if (line.match(/^\s*\d+\.\s+/)) {
                html += '<ol>';
                while (i < lines.length && lines[i].match(/^\s*\d+\.\s+/)) {
                    var olText = lines[i].replace(/^\s*\d+\.\s+/, '');
                    html += '<li>' + renderInline(olText) + '</li>';
                    i++;
                }
                html += '</ol>';
                continue;
            }

            // Blank line — skip
            if (line.trim() === '') {
                i++;
                continue;
            }

            // Heading
            var headingMatch = line.match(/^(#{1,6})\s+(.*)/);
            if (headingMatch) {
                var level = headingMatch[1].length;
                html += '<h' + level + '>' + renderInline(headingMatch[2]) + '</h' + level + '>';
                i++;
                continue;
            }

            // Default: paragraph (collect consecutive non-blank, non-special lines)
            var paraLines = [];
            while (
                i < lines.length &&
                lines[i].trim() !== '' &&
                !lines[i].match(/^```/) &&
                !lines[i].match(/^\s*[-*+]\s+/) &&
                !lines[i].match(/^\s*\d+\.\s+/) &&
                !lines[i].match(/^#{1,6}\s+/)
            ) {
                paraLines.push(lines[i]);
                i++;
            }
            html += '<p>' + renderInline(paraLines.join('\n')) + '</p>';
        }

        return html;
    }

    /**
     * Renders inline markdown: bold, italic, inline code, links.
     * @param {string} text
     * @returns {string}
     */
    function renderInline(text) {
        // Inline code (must come first to avoid processing inside code spans)
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Bold
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
        // Italic
        text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
        text = text.replace(/_(.+?)_/g, '<em>$1</em>');
        // Links
        text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        // Line breaks
        text = text.replace(/\n/g, '<br>');
        return text;
    }

    /**
     * Basic syntax highlighting for code blocks using CSS classes.
     * @param {string} code Already HTML-escaped code
     * @param {string} lang Language identifier
     * @returns {string}
     */
    function highlightCode(code, lang) {
        if (!lang) {
            return code;
        }

        // Comments: // ... and /* ... */
        code = code.replace(/(\/\/[^\n]*)/g, '<span class="token-comment">$1</span>');
        code = code.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="token-comment">$1</span>');
        // Strings: double-quoted and single-quoted
        code = code.replace(
            /(&quot;(?:[^&]|&(?!quot;))*?&quot;)/g,
            '<span class="token-string">$1</span>'
        );
        code = code.replace(
            /(&#x27;(?:[^&]|&(?!#x27;))*?&#x27;)/g,
            '<span class="token-string">$1</span>'
        );
        code = code.replace(
            /('(?:[^'\\]|\\.)*')/g,
            '<span class="token-string">$1</span>'
        );
        // Numbers
        code = code.replace(/\b(\d+\.?\d*)\b/g, '<span class="token-number">$1</span>');
        // Keywords (common across JS/TS/Python/Java/C)
        var keywords =
            '\\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|' +
            'class|extends|implements|interface|type|enum|import|export|from|default|new|this|' +
            'try|catch|finally|throw|async|await|yield|of|in|typeof|instanceof|void|null|undefined|' +
            'true|false|def|self|print|elif|except|raise|with|as|pass|lambda|None|True|False|' +
            'public|private|protected|static|final|abstract|override|readonly|declare)\\b';
        code = code.replace(new RegExp(keywords, 'g'), '<span class="token-keyword">$1</span>');

        return code;
    }

    /**
     * Escapes HTML special characters.
     * @param {string} str
     * @returns {string}
     */
    function escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');
    }
})();
