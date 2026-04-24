/**
 * CommandRegistry registers and guards VS Code commands for the Kiro extension.
 *
 * All commands are guarded: if the CLI state is `not_found`, an error
 * notification is shown with install instructions and the command returns early.
 *
 * Requirements: 8.1, 8.2, 8.3, 2.4, 2.5
 */

import * as vscode from 'vscode';
import { CliManager } from '../cli/cliManager';
import { ChatPanelProvider } from '../chat/chatPanelProvider';
import { SpecWorkflowManager } from '../spec/specWorkflowManager';

const CLI_NOT_FOUND_MESSAGE =
    'Kiro CLI (kiro-cli) not found. Please install it and ensure ~/.local/bin is on your PATH.';

export class CommandRegistry implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _cliManager: CliManager,
        private readonly _chatPanelProvider: ChatPanelProvider,
        private readonly _specWorkflowManager: SpecWorkflowManager
    ) { }

    /**
     * Registers all extension commands and returns their disposables.
     * Each command is guarded against a missing CLI binary.
     */
    registerCommands(): vscode.Disposable[] {
        const commands: vscode.Disposable[] = [
            vscode.commands.registerCommand('kiro.openChat', () => {
                if (this._guardCliAvailable()) {
                    return;
                }
                this._chatPanelProvider.openPanel();
            }),

            vscode.commands.registerCommand('kiro.startSpec', () => {
                if (this._guardCliAvailable()) {
                    return;
                }
                this._specWorkflowManager.startWorkflow();
            }),

            vscode.commands.registerCommand('kiro.restartCli', () => {
                this._handleRestartCli();
            }),

            vscode.commands.registerCommand('kiro.login', () => {
                this._handleLogin();
            }),
        ];

        this._disposables.push(...commands);
        return commands;
    }

    /**
     * Disposes of all registered command disposables.
     */
    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
    }

    /**
     * Returns true (and shows an error) if the CLI is not found,
     * signalling the caller to return early.
     */
    private _guardCliAvailable(): boolean {
        if (this._cliManager.state.status === 'not_found') {
            vscode.window.showErrorMessage(CLI_NOT_FOUND_MESSAGE);
            return true;
        }
        return false;
    }

    /**
     * Handles the Restart CLI command with authentication check and login flow.
     * Mirrors the PyCharm RestartCliAction behavior:
     * 1. Clear chat and show system messages
     * 2. Resolve CLI path
     * 3. Check authentication, attempt login if needed
     * 4. Restart the CLI process
     *
     * Requirement 2.5, 8.2
     */
    private async _handleRestartCli(): Promise<void> {
        // Clear chat and show progress
        this._chatPanelProvider.postMessage({ type: 'clearChat' });
        this._chatPanelProvider.postMessage({
            type: 'systemMessage',
            message: 'Checking authentication...',
        });

        try {
            // Resolve CLI path
            const cliPath = await this._cliManager.resolveCliPath();
            if (!cliPath) {
                this._chatPanelProvider.postMessage({
                    type: 'error',
                    message: 'CLI binary not found. Please install kiro-cli and ensure it\'s in your PATH.',
                });
                return;
            }

            // Check authentication
            const isAuthenticated = await this._cliManager.checkAuthentication(cliPath);
            if (!isAuthenticated) {
                this._chatPanelProvider.postMessage({
                    type: 'systemMessage',
                    message: 'Not authenticated. Running kiro-cli login...',
                });

                const loginSuccess = await this._cliManager.login();
                if (!loginSuccess) {
                    this._chatPanelProvider.postMessage({
                        type: 'error',
                        message: 'Login failed. Please run \'kiro-cli login\' manually in your terminal.',
                    });
                    return;
                }

                this._chatPanelProvider.postMessage({
                    type: 'systemMessage',
                    message: 'Login successful. Starting CLI process...',
                });
            } else {
                this._chatPanelProvider.postMessage({
                    type: 'systemMessage',
                    message: 'Already authenticated. Starting CLI process...',
                });
            }

            // Restart the process
            await this._cliManager.restartProcess();

            this._chatPanelProvider.postMessage({
                type: 'systemMessage',
                message: 'CLI restarted. Ready for a new session.',
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            this._chatPanelProvider.postMessage({
                type: 'error',
                message: `Failed to restart CLI: ${errorMessage}`,
            });
        }
    }

    /**
     * Handles the Login command.
     *
     * Requirement 2.4
     */
    private async _handleLogin(): Promise<void> {
        try {
            this._chatPanelProvider.postMessage({
                type: 'systemMessage',
                message: 'Running kiro-cli login...',
            });

            const success = await this._cliManager.login();
            if (success) {
                this._chatPanelProvider.postMessage({
                    type: 'systemMessage',
                    message: 'Login successful.',
                });
                vscode.window.showInformationMessage('Kiro CLI authenticated successfully.');
            } else {
                this._chatPanelProvider.postMessage({
                    type: 'error',
                    message: 'Login failed. Please try running \'kiro-cli login\' manually.',
                });
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            vscode.window.showErrorMessage(`Kiro login failed: ${errorMessage}`);
        }
    }
}
