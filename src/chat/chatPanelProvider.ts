/**
 * ChatPanelProvider manages the Webview chat panel lifecycle and message routing.
 *
 * Creates and manages a vscode.WebviewPanel with retainContextWhenHidden,
 * handles incoming messages from the Webview, sends ACP streaming requests
 * through the CLI, and forwards responses/errors back to the Webview.
 *
 * Requirements: 4.1–4.8, 11.1–11.4, 12.1–12.5, 13.1
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CliManager } from '../cli/cliManager';
import { WorkspaceContextProvider } from '../context/workspaceContextProvider';
import type { ExtToWebviewMessage, WebviewToExtMessage, ContextUsage } from '../types';

const VIEW_TYPE = 'kiro.chatPanel';
const _log = vscode.window.createOutputChannel('Kiro Chat');

export class ChatPanelProvider implements vscode.Disposable {
    private _panel: vscode.WebviewPanel | undefined;
    private _lastFailedMessage: string | null = null;
    private readonly _disposables: vscode.Disposable[] = [];

    /** Current context usage data. */
    private _contextUsage: ContextUsage = { conversation: 0, mcpTools: 0, steeringFiles: 0, total: 0 };

    /** Callback for spec phase content capture. */
    private _specContentCapture: ((content: string) => void) | null = null;

    /** Callback for spec accept action. */
    private _onSpecAccept: (() => void) | null = null;

    /** Callback for spec save-only action. */
    private _onSpecSave: (() => void) | null = null;

    /** Callback for spec cancel action. */
    private _onSpecCancel: (() => void) | null = null;

    /**
     * Tracks the last known text editor so we can capture context even when
     * the webview panel has focus (which causes activeTextEditor to be null).
     */
    private _lastActiveTextEditor: vscode.TextEditor | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _cliManager: CliManager,
        _contextProvider: WorkspaceContextProvider
    ) {
        // Seed with the current active editor
        this._lastActiveTextEditor = vscode.window.activeTextEditor;

        // Track editor changes — update our snapshot whenever a real text editor gains focus
        this._disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    this._lastActiveTextEditor = editor;
                }
            })
        );

        // Wire up CLI manager message callbacks for auto-reconnect
        this._cliManager.setMessageCallbacks(
            (message) => this.postMessage({ type: 'systemMessage', message }),
            (message) => this.postMessage({ type: 'error', message })
        );
    }

    /**
     * Sets callbacks for spec workflow integration.
     */
    setSpecCallbacks(
        onContentCapture: (content: string) => void,
        onAccept: () => void,
        onSave: () => void,
        onCancel: () => void
    ): void {
        this._specContentCapture = onContentCapture;
        this._onSpecAccept = onAccept;
        this._onSpecSave = onSave;
        this._onSpecCancel = onCancel;
    }

    /**
     * Opens or reveals the chat panel.
     * Creates a new panel if one doesn't exist, otherwise brings it to focus.
     * The panel occupies 1/4 of the editor width and files won't open in its column.
     */
    openPanel(): void {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            'Kiro Chat',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this._extensionUri],
            }
        );

        this._panel.webview.html = this._getWebviewContent();

        // Set editor layout to make the panel 1/4 width after the panel is created
        setTimeout(() => {
            vscode.commands.executeCommand('vscode.setEditorLayout', {
                orientation: 0,
                groups: [{ size: 0.75 }, { size: 0.25 }]
            });
        }, 100);

        // Prevent files from opening in the chat panel's column.
        this._panel.onDidChangeViewState(
            (e) => {
                if (!e.webviewPanel.active) {
                    const editor = vscode.window.activeTextEditor;
                    if (editor && editor.viewColumn === this._panel?.viewColumn) {
                        vscode.commands.executeCommand('workbench.action.moveEditorToFirstGroup');
                    }
                }
            },
            undefined,
            this._disposables
        );

        // Handle messages from the Webview
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewToExtMessage) => this._onWebviewMessage(message),
            undefined,
            this._disposables
        );

        // Clean up when the panel is closed
        this._panel.onDidDispose(
            () => {
                this._panel = undefined;
            },
            undefined,
            this._disposables
        );
    }

    /**
     * Posts a typed message to the Webview from external components.
     * This is the public interface for sending messages to the chat panel,
     * used by SpecWorkflowManager, CommandRegistry, etc.
     */
    postMessage(message: ExtToWebviewMessage): void {
        this._postMessage(message);
    }

    /**
     * Sends a prompt through the CLI and streams the response to the Webview.
     * This is the core send method used by both regular messages and spec prompts.
     *
     * @param promptText The text to send (already enriched or raw)
     * @param isSpecPrompt If true, captures content for spec workflow
     */
    private async _sendPromptInternal(promptText: string, isSpecPrompt: boolean = false): Promise<void> {
        // Send loading start
        this._postMessage({ type: 'loading', active: true });

        try {
            const cliProcess = await this._cliManager.ensureProcess();
            _log.appendLine(`[Chat] Sending prompt: "${promptText.substring(0, 120)}"`);

            // Wire up metadata handler for context usage
            cliProcess.onMetadata = (metadata) => {
                this._handleMetadataNotification(metadata);
            };

            // Send config options to webview if available (Requirement 12.1)
            if (cliProcess.configOptions.length > 0) {
                this._postMessage({ type: 'configOptions', options: cliProcess.configOptions });
            }

            // Use the ACP session/prompt flow with session/update notifications
            await cliProcess.sendPrompt(promptText, (update) => {
                const sessionUpdate = update.sessionUpdate as string;
                _log.appendLine(`[Chat] Got update: ${sessionUpdate}`);

                if (sessionUpdate === 'agent_message_chunk') {
                    const content = update.content as { type: string; text?: string } | undefined;
                    if (content?.text) {
                        _log.appendLine(`[Chat] Chunk: "${content.text.substring(0, 50)}"`);
                        this._postMessage({ type: 'response', content: content.text, done: false });

                        // Capture content for spec workflow if active
                        if (isSpecPrompt) {
                            this._specContentCapture?.(content.text);
                        }
                    }
                } else if (sessionUpdate === 'tool_call' || sessionUpdate === 'tool_call_update') {
                    const title = update.title as string | undefined;
                    const status = update.status as string | undefined;
                    const kind = update.kind as string | undefined;
                    if (title) {
                        _log.appendLine(`[Chat] Tool: ${title} [${status || ''}]`);
                        this._postMessage({ type: 'toolStatus', title, status: status || '', kind: kind || '' });
                    }
                } else if (sessionUpdate === 'config_options_update') {
                    this._parseAndSendConfigOptions(update);
                } else if (sessionUpdate === 'context_usage') {
                    this._handleContextUsageUpdate(update);
                }
            });

            _log.appendLine(`[Chat] Prompt completed`);
            this._postMessage({ type: 'response', content: '', done: true });
            this._lastFailedMessage = null;

            // Refresh workspace files to detect changes made by the CLI (Requirement 13.1)
            this._refreshWorkspaceFiles();
        } catch (err) {
            const rawMessage = err instanceof Error ? err.message : 'An unknown error occurred';
            _log.appendLine(`[Chat] Error: ${rawMessage}`);

            const isSessionError =
                rawMessage.includes('terminated unexpectedly') ||
                rawMessage.includes('not authenticated') ||
                rawMessage.includes('not running') ||
                rawMessage.includes('stdin is not writable') ||
                rawMessage.includes('not alive');

            const displayMessage = isSessionError
                ? 'Session expired or CLI process is not running. Please use \'Kiro: Restart CLI\' from the Command Palette to reconnect.'
                : rawMessage;

            this._postMessage({ type: 'error', message: displayMessage });
            this._lastFailedMessage = promptText;

            const actions = isSessionError ? ['Retry', 'Restart CLI'] : ['Retry'];
            const action = await vscode.window.showErrorMessage(
                `Communication error: ${displayMessage}`,
                ...actions
            );
            if (action === 'Retry') {
                this._sendPromptInternal(promptText, isSpecPrompt);
            } else if (action === 'Restart CLI') {
                vscode.commands.executeCommand('kiro.restartCli');
            }
        } finally {
            this._postMessage({ type: 'loading', active: false });
        }
    }

    /**
     * Sends a user message through the CLI and streams the response to the Webview.
     * Prepends active file context before sending.
     */
    async handleUserMessage(text: string): Promise<void> {
        if (!this._panel) {
            return;
        }
        const enrichedText = this._buildContextEnrichedPrompt(text);
        await this._sendPromptInternal(enrichedText, false);
    }

    /**
     * Sends a spec workflow prompt through the CLI WITHOUT prepending editor context.
     * Shows a system message instead of the full prompt as a user bubble.
     * Captures streaming content for the spec manager.
     * Ensures the panel is open and ready before sending.
     */
    async handleSpecPrompt(prompt: string, phaseLabel: string): Promise<void> {
        // Ensure panel is open
        this.openPanel();

        // Wait for panel to be ready
        let retries = 10;
        while (!this._panel && retries > 0) {
            await new Promise<void>((r) => setTimeout(r, 100));
            retries--;
        }

        if (!this._panel) {
            vscode.window.showErrorMessage('Failed to open Kiro Chat panel.');
            return;
        }

        this._postMessage({ type: 'systemMessage', message: `Generating ${phaseLabel}...` });
        await this._sendPromptInternal(prompt, true);
    }

    /**
     * Disposes of the panel and all associated resources.
     */
    dispose(): void {
        this._panel?.dispose();
        this._panel = undefined;

        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
    }

    /**
     * Builds a prompt enriched with active file context and selected text.
     *
     * Uses _lastActiveTextEditor instead of vscode.window.activeTextEditor
     * because when the user types in the webview, the webview has focus and
     * activeTextEditor returns null. We track the last real text editor
     * separately to avoid this.
     */
    private _buildContextEnrichedPrompt(userText: string): string {
        const editor = this._lastActiveTextEditor;
        if (!editor || editor.document.isClosed) {
            return userText;
        }

        const filePath = vscode.workspace.asRelativePath(editor.document.uri);
        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        const parts: string[] = [];

        if (selectedText.trim()) {
            // User has highlighted code
            parts.push(`[Active file: ${filePath}]`);
            parts.push(`[Selected code in ${path.basename(filePath)}:]`);
            parts.push('```');
            parts.push(selectedText);
            parts.push('```');
        } else {
            // No selection — include file path and content
            const content = editor.document.getText();
            parts.push(`[Active file: ${filePath}]`);
            // Include file content if it's reasonably sized (< 10k chars)
            if (content.length > 0 && content.length < 10000) {
                parts.push(`[Content of ${path.basename(filePath)}:]`);
                parts.push('```');
                parts.push(content);
                parts.push('```');
            }
        }

        parts.push(userText);
        return parts.join('\n');
    }

    /**
     * Routes incoming Webview messages to the appropriate handler.
     */
    private _onWebviewMessage(message: WebviewToExtMessage): void {
        switch (message.type) {
            case 'sendMessage':
                this.handleUserMessage(message.text);
                break;
            case 'retry':
                // Re-send the last failed message if available (Requirement 11.3)
                if (this._lastFailedMessage !== null) {
                    this.handleUserMessage(this._lastFailedMessage);
                }
                break;
            case 'selectModel':
                // Handle model selection from the webview (Requirement 12.2)
                this._handleModelSelection(message.configId, message.value);
                break;
            case 'specAccept':
                this._onSpecAccept?.();
                break;
            case 'specSave':
                this._onSpecSave?.();
                break;
            case 'specCancel':
                this._onSpecCancel?.();
                break;
            case 'startSpec':
                vscode.commands.executeCommand('kiro.startSpec');
                break;
            case 'clearChat':
                // Forward clearChat back to webview to clear the UI
                this._postMessage({ type: 'clearChat' });
                break;
            case 'selectFiles':
            case 'advanceSpec':
                // Handled by other components (SpecWorkflowManager)
                break;
        }
    }

    /**
     * Handles `_kiro.dev/metadata` notifications from the CLI.
     * Parses contextUsagePercentage and sends it to the webview.
     */
    private _handleMetadataNotification(metadata: Record<string, unknown>): void {
        const contextUsagePercentage = metadata.contextUsagePercentage as number | undefined;
        if (contextUsagePercentage !== undefined) {
            _log.appendLine(`[Chat] Metadata: contextUsagePercentage=${contextUsagePercentage}`);
            this._contextUsage = {
                ...this._contextUsage,
                total: contextUsagePercentage,
            };
            this._postMessage({ type: 'contextUsage', usage: this._contextUsage });
        }
    }

    /**
     * Handles context_usage data from session/update notifications.
     */
    private _handleContextUsageUpdate(update: Record<string, unknown>): void {
        const conversation = (update.conversation as number) ?? this._contextUsage.conversation;
        const mcpTools = (update.mcpTools as number) ?? this._contextUsage.mcpTools;
        const steeringFiles = (update.steeringFiles as number) ?? this._contextUsage.steeringFiles;
        const total = (update.total as number) ?? this._contextUsage.total;

        this._contextUsage = { conversation, mcpTools, steeringFiles, total };
        this._postMessage({ type: 'contextUsage', usage: this._contextUsage });
    }

    /**
     * Handles model selection from the webview.
     * Tries ACP protocol first, falls back to kiro-cli settings command.
     *
     * Requirement 12.2, 12.3
     */
    private async _handleModelSelection(configId: string, value: string): Promise<void> {
        try {
            const cliProcess = await this._cliManager.ensureProcess();

            // Try ACP protocol first
            try {
                const updated = await cliProcess.setConfigOption(configId, value);
                this._postMessage({ type: 'configOptions', options: updated });
                this._postMessage({ type: 'systemMessage', message: `Model changed to ${value}` });
                return;
            } catch (acpErr) {
                _log.appendLine(`[Chat] ACP set_config_option failed, falling back to CLI: ${acpErr}`);
            }

            // Fallback: use kiro-cli settings command (Requirement 12.3)
            const cliPath = this._cliManager.resolvedCliPath;
            if (cliPath) {
                await this._setModelViaCli(cliPath, value);
            } else {
                this._postMessage({ type: 'error', message: 'CLI not found. Cannot change model.' });
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            this._postMessage({ type: 'error', message: `Failed to change model: ${errorMessage}` });
        }
    }

    /**
     * Sets the model using kiro-cli settings command as a fallback.
     */
    private _setModelViaCli(cliPath: string, modelValue: string): Promise<void> {
        const { execFile } = require('child_process');
        return new Promise<void>((resolve) => {
            execFile(cliPath, ['settings', 'chat.defaultModel', modelValue], { timeout: 10000 }, (error: Error | null, _stdout: string, stderr: string) => {
                if (error) {
                    this._postMessage({ type: 'error', message: `Failed to change model: ${stderr || error.message}` });
                } else {
                    this._postMessage({ type: 'systemMessage', message: `Model changed to ${modelValue}` });
                }
                resolve();
            });
        });
    }

    /**
     * Parses config options from a session/update notification and sends them to the webview.
     *
     * Requirement 12.4
     */
    private _parseAndSendConfigOptions(update: Record<string, unknown>): void {
        try {
            const configOptions = update.configOptions as Array<Record<string, unknown>> | undefined;
            if (!configOptions || !Array.isArray(configOptions)) {
                return;
            }

            const options = configOptions.map((o) => {
                const opts = (o.options as Array<Record<string, unknown>> || []).map((opt) => ({
                    value: (opt.value as string) || '',
                    name: (opt.name as string) || (opt.value as string) || '',
                    description: (opt.description as string) || '',
                }));
                return {
                    id: (o.id as string) || '',
                    name: (o.name as string) || (o.id as string) || '',
                    description: (o.description as string) || '',
                    category: (o.category as string) || '',
                    currentValue: (o.currentValue as string) || '',
                    options: opts,
                };
            });

            if (options.length > 0) {
                this._postMessage({ type: 'configOptions', options });
            }
        } catch (err) {
            _log.appendLine(`[Chat] Failed to parse config_options_update: ${err}`);
        }
    }

    /**
     * Refreshes workspace files to detect changes made by the CLI agent.
     *
     * Requirement 13.1
     */
    private _refreshWorkspaceFiles(): void {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            // Trigger a workspace file system watcher refresh
            const pattern = new vscode.RelativePattern(folders[0], '**/*');
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            // Dispose immediately — the creation itself triggers a scan
            setTimeout(() => watcher.dispose(), 1000);
        }
    }

    /**
     * Posts a typed message to the Webview.
     */
    private _postMessage(message: ExtToWebviewMessage): void {
        this._panel?.webview.postMessage(message);
    }

    /**
     * Builds the Webview HTML content by loading the template from disk
     * and injecting proper webview URIs for CSS/JS and a CSP nonce.
     *
     * In production the webview assets live under dist/webview/ (copied by
     * copy-webpack-plugin). During development they live under src/chat/webview/.
     * We try dist/webview/ first and fall back to src/chat/webview/.
     */
    private _getWebviewContent(): string {
        const webview = this._panel!.webview;

        // Resolve webview directory — prefer dist/webview (production), fall back to src/chat/webview (dev)
        const distWebviewPath = path.join(this._extensionUri.fsPath, 'dist', 'webview');
        const srcWebviewPath = path.join(this._extensionUri.fsPath, 'src', 'chat', 'webview');
        const useDistPath = fs.existsSync(path.join(distWebviewPath, 'index.html'));
        const webviewFsPath = useDistPath ? distWebviewPath : srcWebviewPath;
        const webviewDir = useDistPath
            ? vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview')
            : vscode.Uri.joinPath(this._extensionUri, 'src', 'chat', 'webview');

        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDir, 'styles.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDir, 'main.js'));
        const nonce = this._getNonce();

        const htmlPath = path.join(webviewFsPath, 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf-8');

        html = html.replace(/\{\{stylesUri\}\}/g, stylesUri.toString());
        html = html.replace(/\{\{scriptUri\}\}/g, scriptUri.toString());
        html = html.replace(/\{\{nonce\}\}/g, nonce);
        html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);

        return html;
    }

    /**
     * Generates a random nonce for the Content Security Policy.
     */
    private _getNonce(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let nonce = '';
        for (let i = 0; i < 32; i++) {
            nonce += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return nonce;
    }
}
