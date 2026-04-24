/**
 * SpecWorkflowManager orchestrates the Spec workflow phases through the CLI.
 *
 * Manages the fixed phase order (requirements → design → tasks), communicates
 * with the CLI via ACP, sends specPhase messages to the Chat Panel for UI
 * updates, and persists spec artifacts to disk.
 */

import * as vscode from 'vscode';
import { CliManager } from '../cli/cliManager';
import { ChatPanelProvider } from '../chat/chatPanelProvider';
import type { AcpRequest, SpecPhase } from '../types';

/** Fixed phase ordering for the Spec workflow. */
const PHASE_ORDER: SpecPhase[] = ['requirements', 'design', 'tasks'];

export class SpecWorkflowManager {
    private _currentPhase: SpecPhase | null = null;
    private _requestCounter = 0;

    constructor(
        private readonly _cliManager: CliManager,
        private readonly _chatPanelProvider: ChatPanelProvider
    ) { }

    /**
     * Returns the current workflow phase, or null if no workflow is active.
     */
    get currentPhase(): SpecPhase | null {
        return this._currentPhase;
    }

    /**
     * Starts a new Spec workflow by setting the phase to 'requirements'
     * and sending the initial ACP request to the CLI.
     *
     * Requirement 5.1
     */
    async startWorkflow(): Promise<void> {
        this._currentPhase = PHASE_ORDER[0];
        this._notifyPhase();

        const cliProcess = await this._cliManager.ensureProcess();
        const request = this._buildRequest('spec/start', {
            specPhase: this._currentPhase,
        });

        await cliProcess.sendRequest(request);
    }

    /**
     * Sends the completed phase output to the CLI and advances to the
     * next phase in the fixed order: requirements → design → tasks.
     *
     * When the tasks phase completes, the workflow ends and currentPhase
     * becomes null.
     */
    async advancePhase(phaseOutput: string): Promise<void> {
        if (!this._currentPhase) {
            throw new Error('No active spec workflow. Call startWorkflow() first.');
        }

        const cliProcess = await this._cliManager.ensureProcess();
        const request = this._buildRequest('spec/advancePhase', {
            specPhase: this._currentPhase,
            specOutput: phaseOutput,
        });

        await cliProcess.sendRequest(request);

        // Move to the next phase
        const currentIndex = PHASE_ORDER.indexOf(this._currentPhase);
        const nextIndex = currentIndex + 1;

        if (nextIndex < PHASE_ORDER.length) {
            this._currentPhase = PHASE_ORDER[nextIndex];
            this._notifyPhase();
        } else {
            // Workflow complete
            this._currentPhase = null;
        }
    }

    /**
     * Saves spec artifacts to `.kiro/specs/{specName}/` in the workspace.
     *
     * Creates the directory if it doesn't exist and writes each artifact
     * file with its content.
     */
    async saveArtifacts(specName: string, artifacts: Map<string, string>): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open. Cannot save spec artifacts.');
        }

        const specDir = vscode.Uri.joinPath(
            workspaceFolder.uri,
            '.kiro',
            'specs',
            specName
        );

        // Ensure the directory exists
        await vscode.workspace.fs.createDirectory(specDir);

        // Write each artifact file
        const writePromises: Promise<void>[] = [];
        for (const [fileName, content] of artifacts) {
            const fileUri = vscode.Uri.joinPath(specDir, fileName);
            const encoded = Buffer.from(content, 'utf-8');
            writePromises.push(Promise.resolve(vscode.workspace.fs.writeFile(fileUri, encoded)));
        }

        await Promise.all(writePromises);
    }

    /**
     * Sends a specPhase message to the Chat Panel so the UI can display
     * the current phase as a navigable step indicator.
     */
    private _notifyPhase(): void {
        if (!this._currentPhase) {
            return;
        }

        const phaseIndex = PHASE_ORDER.indexOf(this._currentPhase);
        this._chatPanelProvider.postMessage({
            type: 'specPhase',
            phase: this._currentPhase,
            phaseIndex,
        });
    }

    /**
     * Builds an ACP request with a unique ID.
     */
    private _buildRequest(
        method: string,
        params: AcpRequest['params']
    ): AcpRequest {
        return {
            jsonrpc: '2.0',
            id: `spec-${++this._requestCounter}`,
            method,
            params,
        };
    }
}
