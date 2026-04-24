# Changelog

All notable changes to the Kiro VS Code Extension will be documented in this file.

## [0.1.3] — 2025-04-24

### Added

- Enhanced spec workflow with input dialogs for name/description, collision detection, and .bak backup
- Interactive spec phase bar with 💾 Save, ✅ Save & Continue, and ✕ Cancel buttons
- Phase prompts instruct AI not to create files — content captured and saved by the extension
- 📋 Start Spec button in chat header for quick access
- Context usage indicator (circular ring) showing model context window consumption
- 🗑 Clear chat button in header
- Auto-reconnect with exponential backoff (3 attempts: 2s, 4s, 8s) on unexpected CLI exit
- Custom extension icon

### Fixed

- Spec prompts no longer prepend editor context (dedicated handleSpecPrompt method)
- Chat panel auto-opens when starting a spec workflow
- Spec content properly captured from streaming responses and saved to .kiro/specs/

### Changed

- Updated extension description to clarify it's a UI wrapper for the Kiro CLI
- Rewrote README with prominent prerequisites section and troubleshooting guide

## [0.1.2] — 2025-04-24

### Changed

- Updated extension description to clarify it's a UI wrapper for the Kiro CLI
- Rewrote README with prominent prerequisites section, install steps, and troubleshooting guide

## [0.1.1] — 2025-04-24

### Fixed

- Editor context not sent when the chat panel has focus. The extension now tracks the last active text editor so file context is always included in prompts, even when the webview input is focused.

## [0.1.0] — 2025-04-23

### Added

- AI chat panel with streaming Markdown responses, syntax-highlighted code blocks, and copy-to-clipboard buttons
- Editor context awareness — active file and selected code sent with prompts automatically
- Tool call status indicators showing agent activity (file reads, writes, shell commands)
- Model selector dropdown in the chat header to switch between available AI models
- Spec workflow management for structured feature development (requirements → design → tasks)
- Integrated login flow — authenticate directly from VS Code without switching to a terminal
- CLI discovery with shell profile sourcing (~/.zshrc, ~/.bashrc, etc.) for non-standard PATH setups
- Workspace file refresh after CLI operations so VS Code picks up agent-created files
- Session error detection with friendly messages and one-click CLI restart
- Status bar context key reflecting CLI connection state (active/inactive)
- Activity Bar icon and editor title button for quick access to the chat panel
- System messages in chat for status updates (auth, model changes, restarts)
- Retry action on failed prompts with stored message replay

### Commands

- `Kiro: Open Chat` — Open the AI chat panel
- `Kiro: Start Spec` — Start a spec workflow
- `Kiro: Restart CLI` — Restart the CLI process (with auth check and auto-login)
- `Kiro: Login` — Authenticate with the Kiro CLI
