# Kiro — AI-Powered Development for VS Code

Chat with Kiro AI agents, run Spec workflows, and get context-aware coding help directly in your editor.

> **Important:** This extension requires the **Kiro CLI** to be installed separately. It does not bundle the CLI. See [Prerequisites](#prerequisites) below.

## Prerequisites

This extension is a UI wrapper around the Kiro CLI. You must install and authenticate the CLI before the extension will work.

### 1. Install the Kiro CLI

Download and install `kiro-cli` from [kiro.dev](https://kiro.dev).

On macOS/Linux, the CLI is typically installed to `~/.local/bin/kiro-cli`. Make sure this directory is on your PATH:

```bash
# Check if kiro-cli is available
which kiro-cli

# If not found, add ~/.local/bin to your PATH (add to your shell profile)
export PATH="$HOME/.local/bin:$PATH"
```

### 2. Authenticate

Run one of:

```bash
kiro-cli login
```

Or use the **`Kiro: Login`** command from the VS Code Command Palette after installing the extension. This opens a browser window for authentication.

### 3. Verify

```bash
kiro-cli whoami
```

If this prints your username, you're ready to go.

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

## Commands

| Command | Description |
|---------|-------------|
| `Kiro: Open Chat` | Open the AI chat panel |
| `Kiro: Start Spec` | Start a spec workflow |
| `Kiro: Restart CLI` | Restart the CLI process (checks auth, auto-logs in if needed) |
| `Kiro: Login` | Authenticate with the Kiro CLI |

## Getting Started

1. Install the Kiro CLI ([kiro.dev](https://kiro.dev))
2. Run `kiro-cli login` to authenticate
3. Install this extension from the Marketplace
4. Open the Command Palette (`Cmd+Shift+P`) and run **`Kiro: Open Chat`**
5. Start chatting — your active file is automatically included as context

## Extension Settings

This extension does not add any VS Code settings. Configuration is managed through the Kiro CLI (`kiro-cli settings`).

## Troubleshooting

**"Kiro CLI not found" error on activation**
The extension couldn't find `kiro-cli` on your PATH. Make sure it's installed and accessible:
```bash
which kiro-cli
```
If it's installed but not found, add its location to your PATH in your shell profile (`~/.zshrc`, `~/.bashrc`, etc.).

**"Kiro CLI is not authenticated" warning**
Run `Kiro: Login` from the Command Palette, or run `kiro-cli login` in your terminal.

**Chat panel doesn't show editor context**
Make sure you have a file open in the editor before opening the chat panel. The extension captures the last active text editor and includes it with your prompts.

## License

[MIT](LICENSE.md)
