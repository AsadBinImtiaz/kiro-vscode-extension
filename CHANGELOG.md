# Changelog

All notable changes to the Kiro VS Code Extension will be documented in this file.

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
