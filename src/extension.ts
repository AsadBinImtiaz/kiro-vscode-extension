/**
 * Extension entry point for the Kiro VS Code Extension.
 *
 * Handles activation (CLI discovery, authentication, component initialization)
 * and deactivation (graceful CLI shutdown).
 *
 * Requirements: 1.1–1.4, 2.1–2.4, 3.4
 */

import * as vscode from 'vscode';
import { CliManager } from './cli/cliManager';
import { WorkspaceContextProvider } from './context/workspaceContextProvider';
import { ChatPanelProvider } from './chat/chatPanelProvider';
import { SpecWorkflowManager } from './spec/specWorkflowManager';
import { CommandRegistry } from './commands/commandRegistry';
import { StatusManager } from './status/statusManager';

let cliManager: CliManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // 1. Create CliManager
    cliManager = new CliManager();

    // 2. Resolve CLI path — show error if not found (Req 1.1, 1.2, 1.3, 1.4)
    const cliPath = await cliManager.resolveCliPath();
    if (!cliPath) {
        vscode.window.showErrorMessage(
            'Kiro CLI not found. Please install the Kiro CLI and ensure it is available on your system PATH. ' +
            'Visit https://kiro.dev for installation instructions.'
        );
    }

    // 3. If CLI found, check authentication (Req 2.1, 2.2, 2.4)
    if (cliPath) {
        const isAuthenticated = await cliManager.checkAuthentication(cliPath);
        if (!isAuthenticated) {
            const action = await vscode.window.showWarningMessage(
                'Kiro CLI is not authenticated. Please log in to use Kiro features.',
                'Login',
                'Dismiss'
            );
            if (action === 'Login') {
                try {
                    const success = await cliManager.login();
                    if (success) {
                        vscode.window.showInformationMessage('Kiro CLI authenticated successfully.');
                    } else {
                        vscode.window.showErrorMessage(
                            'Kiro login failed. Please run "kiro-cli login" manually in your terminal.'
                        );
                    }
                } catch {
                    vscode.window.showErrorMessage(
                        'Kiro login failed. Please run "kiro-cli login" manually in your terminal.'
                    );
                }
            }
        }
    }

    // 4. Create WorkspaceContextProvider
    const contextProvider = new WorkspaceContextProvider();

    // 5. Create ChatPanelProvider
    const chatPanelProvider = new ChatPanelProvider(context.extensionUri, cliManager, contextProvider);

    // 6. Create SpecWorkflowManager
    const specWorkflowManager = new SpecWorkflowManager(cliManager, chatPanelProvider);

    // Wire up spec workflow callbacks
    chatPanelProvider.setSpecCallbacks(
        (content) => specWorkflowManager.capturePhaseContent(content),
        () => specWorkflowManager.advancePhase(),
        () => specWorkflowManager.saveCurrentPhase(),
        () => specWorkflowManager.cancelWorkflow()
    );

    // 7. Create CommandRegistry and register commands
    const commandRegistry = new CommandRegistry(cliManager, chatPanelProvider, specWorkflowManager);

    // 8. Register commands and push disposables
    const commandDisposables = commandRegistry.registerCommands();
    context.subscriptions.push(...commandDisposables);

    // 9. Create StatusManager
    const statusManager = new StatusManager(cliManager);

    // 10. Push all disposables to context.subscriptions
    context.subscriptions.push(cliManager);
    context.subscriptions.push(chatPanelProvider);
    context.subscriptions.push(commandRegistry);
    context.subscriptions.push(statusManager);
}

export async function deactivate(): Promise<void> {
    // Graceful shutdown of CLI processes (Req 3.4)
    if (cliManager) {
        cliManager.dispose();
        cliManager = undefined;
    }
}
