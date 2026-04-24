# Kiro — AI-Powered Development for VS Code

Chat with Kiro AI agents, run Spec workflows, and get context-aware coding help directly in your editor.

## Features

### AI Chat Panel

Open a chat panel alongside your editor to converse with Kiro agents. Responses stream in real-time with Markdown rendering, syntax-highlighted code blocks, and copy-to-clipboard buttons.

### Editor Context Awareness

Your active file and selected code are automatically included as context with every prompt, so the agent gives relevant, accurate answers without you having to paste anything.

### Tool Call Visibility

See what the agent is doing — file reads, writes, and shell commands appear as compact status indicators between response chunks.

### Model Selection

Switch between available AI models from a dropdown in the chat header. Supports all models available through the Kiro CLI.

### Spec Workflow

Define features through a structured three-phase workflow: requirements → design → tasks. Artifacts are saved to `.kiro/specs/` in your workspace.

### Steering Files

Place Markdown files in `.kiro/steering/` to guide the agent with project-specific rules and conventions. They're automatically included with every request.

## Requirements

- **Kiro CLI** installed and on your PATH. Visit [kiro.dev](https://kiro.dev) for installation instructions.
- **Authentication** — run `kiro-cli login` or use the `Kiro: Login` command from the Command Palette.

## Commands

| Command | Description |
|---------|-------------|
| `Kiro: Open Chat` | Open the AI chat panel |
| `Kiro: Start Spec` | Start a spec workflow |
| `Kiro: Restart CLI` | Restart the CLI process (checks auth, auto-logs in if needed) |
| `Kiro: Login` | Authenticate with the Kiro CLI |

## Getting Started

1. Install the extension from the Marketplace
2. Ensure `kiro-cli` is installed and on your PATH (or in `~/.local/bin`)
3. Open the Command Palette and run `Kiro: Login` to authenticate
4. Run `Kiro: Open Chat` to start chatting

## Extension Settings

This extension does not add any VS Code settings. Configuration is managed through the Kiro CLI (`kiro-cli settings`).

## Known Issues

- The extension requires the Kiro CLI to be installed separately. It does not bundle the CLI.
- On some systems, the CLI may not be found if it was installed via a shell-specific PATH modification. The extension attempts to source common shell profiles, but if discovery fails, ensure `kiro-cli` is in a standard PATH location.

## License

[MIT](LICENSE.md)
