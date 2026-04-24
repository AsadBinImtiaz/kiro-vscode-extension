/**
 * StatusManager manages the Activity Bar icon status indicator based on CLI state.
 *
 * Listens to CliManager.onDidChangeState to derive the extension status and
 * sets VS Code context keys to toggle icon appearance via `when` clauses.
 */

import * as vscode from 'vscode';
import { CliManager } from '../cli/cliManager';
import { CliState, ExtensionStatus } from '../types';

const CONTEXT_KEY = 'kiro.status';

export class StatusManager implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _currentStatus: ExtensionStatus = 'inactive';

    constructor(cliManager: CliManager) {
        // Set initial status based on current CLI state
        this.updateStatus(StatusManager.deriveStatus(cliManager.state));

        // Listen for future state changes
        this._disposables.push(
            cliManager.onDidChangeState((state: CliState) => {
                this.updateStatus(StatusManager.deriveStatus(state));
            })
        );
    }

    /**
     * Updates the sidebar icon status by setting the VS Code context key.
     * The context key `kiro.status` can be used in package.json `when` clauses
     * to control icon visibility and appearance.
     */
    updateStatus(status: ExtensionStatus): void {
        this._currentStatus = status;
        vscode.commands.executeCommand('setContext', CONTEXT_KEY, status);
    }

    /** Returns the current extension status. */
    get currentStatus(): ExtensionStatus {
        return this._currentStatus;
    }

    /**
     * Derives the ExtensionStatus from a CliState.
     *
     * - `running` → `active` (CLI is running and authenticated)
     * - `ready` → `inactive` (CLI found but not running)
     * - `not_found`, `not_authenticated`, `error` → `inactive`
     */
    static deriveStatus(state: CliState): ExtensionStatus {
        switch (state.status) {
            case 'running':
                return 'active';
            case 'ready':
            case 'not_found':
            case 'not_authenticated':
            case 'error':
                return 'inactive';
        }
    }

    dispose(): void {
        for (const d of this._disposables) {
            d.dispose();
        }
        this._disposables.length = 0;
    }
}
