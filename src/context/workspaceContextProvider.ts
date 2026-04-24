/**
 * WorkspaceContextProvider - Gathers workspace context for ACP requests.
 *
 * Provides active file context, steering file scanning, gitignore filtering,
 * and combined context gathering.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import ignore, { type Ignore } from 'ignore';
import type { FileContext, WorkspaceContext } from '../types';

export class WorkspaceContextProvider {
    private _ignoreInstance: Ignore | null = null;

    /**
     * Gets the active editor file context.
     * Returns null if no editor is active.
     */
    getActiveFileContext(): FileContext | null {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return null;
        }

        const document = editor.document;
        return {
            path: document.uri.fsPath,
            content: document.getText(),
            languageId: document.languageId,
        };
    }

    /**
     * Scans `.kiro/steering/` for markdown steering files.
     * Returns an empty array if the directory doesn't exist or contains no .md files.
     */
    async getSteeringFiles(): Promise<FileContext[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const steeringDir = path.join(workspaceFolder.uri.fsPath, '.kiro', 'steering');

        if (!fs.existsSync(steeringDir)) {
            return [];
        }

        let entries: string[];
        try {
            entries = fs.readdirSync(steeringDir);
        } catch {
            return [];
        }

        const steeringFiles: FileContext[] = [];

        for (const entry of entries) {
            if (!entry.endsWith('.md')) {
                continue;
            }

            const filePath = path.join(steeringDir, entry);

            try {
                const stat = fs.statSync(filePath);
                if (!stat.isFile()) {
                    continue;
                }

                const content = fs.readFileSync(filePath, 'utf-8');
                steeringFiles.push({
                    path: filePath,
                    content,
                    languageId: 'markdown',
                });
            } catch {
                // Skip files that can't be read
            }
        }

        return steeringFiles;
    }

    /**
     * Checks if a file path is ignored by .gitignore rules.
     * Uses the `ignore` npm package for pattern matching.
     */
    isIgnored(filePath: string): boolean {
        const ig = this._getIgnoreInstance();
        if (!ig) {
            return false;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        // Convert to relative path for ignore matching
        const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);

        // Don't filter paths outside the workspace
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            return false;
        }

        return ig.ignores(relativePath);
    }

    /**
     * Gathers the current workspace context for an ACP request.
     * Combines active file, selected files, and steering files,
     * filtering out ignored files.
     */
    async gatherContext(selectedFiles?: string[]): Promise<WorkspaceContext> {
        // Get active file context, filter if ignored
        let activeFile = this.getActiveFileContext();
        if (activeFile && this.isIgnored(activeFile.path)) {
            activeFile = null;
        }

        // Read selected files, filtering out ignored ones
        const selectedFileContexts: FileContext[] = [];
        if (selectedFiles) {
            for (const filePath of selectedFiles) {
                if (this.isIgnored(filePath)) {
                    continue;
                }

                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const ext = path.extname(filePath);
                    selectedFileContexts.push({
                        path: filePath,
                        content,
                        languageId: this._languageIdFromExtension(ext),
                    });
                } catch {
                    // Skip files that can't be read
                }
            }
        }

        // Get steering files, filtering out ignored ones
        const allSteeringFiles = await this.getSteeringFiles();
        const steeringFiles = allSteeringFiles.filter(f => !this.isIgnored(f.path));

        return {
            activeFile,
            selectedFiles: selectedFileContexts,
            steeringFiles,
        };
    }

    /**
     * Resets the cached ignore instance, forcing a re-read of .gitignore on next use.
     */
    resetIgnoreCache(): void {
        this._ignoreInstance = null;
    }

    private _getIgnoreInstance(): Ignore | null {
        if (this._ignoreInstance) {
            return this._ignoreInstance;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return null;
        }

        const gitignorePath = path.join(workspaceFolder.uri.fsPath, '.gitignore');

        const ig = ignore();

        if (fs.existsSync(gitignorePath)) {
            try {
                const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
                ig.add(gitignoreContent);
            } catch {
                // If we can't read .gitignore, proceed without filtering
            }
        }

        this._ignoreInstance = ig;
        return ig;
    }

    private _languageIdFromExtension(ext: string): string | undefined {
        const map: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescriptreact',
            '.js': 'javascript',
            '.jsx': 'javascriptreact',
            '.json': 'json',
            '.md': 'markdown',
            '.py': 'python',
            '.rs': 'rust',
            '.go': 'go',
            '.java': 'java',
            '.html': 'html',
            '.css': 'css',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.xml': 'xml',
            '.sh': 'shellscript',
            '.sql': 'sql',
        };
        return map[ext.toLowerCase()];
    }
}
