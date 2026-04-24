/**
 * CliManager manages CLI discovery, authentication verification, login,
 * and process lifecycle. It provides a single CLI process per workspace
 * with lazy spawning.
 *
 * Requirements: 1.1–1.4, 2.1–2.5, 3.1–3.4, 12, 13
 */

import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as pathModule from 'path';
import * as fs from 'fs';
import { CliProcess } from './cliProcess';
import { CliState } from '../types';

export interface CliManagerOptions {
    /** Override CLI path for testing. */
    cliPath?: string;
}

export class CliManager implements vscode.Disposable {
    private _state: CliState = { status: 'not_found' };
    private _resolvedCliPath: string | null = null;
    private _process: CliProcess | null = null;
    private readonly _options: CliManagerOptions;
    private _isReconnecting = false;

    /** Callback to post system messages during reconnect. */
    private _onSystemMessage: ((message: string) => void) | null = null;
    /** Callback to post error messages during reconnect. */
    private _onErrorMessage: ((message: string) => void) | null = null;

    private readonly _onDidChangeState = new vscode.EventEmitter<CliState>();
    public readonly onDidChangeState: vscode.Event<CliState> = this._onDidChangeState.event;

    constructor(options?: CliManagerOptions) {
        this._options = options ?? {};
    }

    /** Returns the current CLI state. */
    get state(): CliState {
        return this._state;
    }

    /** Returns the resolved CLI path, or null if not yet resolved. */
    get resolvedCliPath(): string | null {
        return this._resolvedCliPath;
    }

    /**
     * Sets callbacks for system/error messages during auto-reconnect.
     */
    setMessageCallbacks(
        onSystem: (message: string) => void,
        onError: (message: string) => void
    ): void {
        this._onSystemMessage = onSystem;
        this._onErrorMessage = onError;
    }

    /**
     * Resolves the CLI binary path from the system PATH.
     * If a cliPath override was provided via options, uses that instead.
     *
     * On Unix, also attempts to source common shell profiles (~/.zshrc,
     * ~/.bashrc, ~/.bash_profile, ~/.profile) to discover CLI binaries
     * installed via shell-specific PATH modifications.
     *
     * Returns null if the binary is not found.
     *
     * Requirement 1.1, 1.3, 1.4
     */
    async resolveCliPath(): Promise<string | null> {
        if (this._options.cliPath) {
            this._resolvedCliPath = this._options.cliPath;
            this._setState({ status: 'ready', cliPath: this._resolvedCliPath });
            return this._resolvedCliPath;
        }

        // Try simple which/where first
        try {
            const path = await this._which('kiro-cli');
            if (path) {
                this._resolvedCliPath = path;
                this._setState({ status: 'ready', cliPath: path });
                return path;
            }
        } catch {
            // Fall through to shell profile sourcing
        }

        // On Unix, try sourcing shell profiles to get the full PATH
        if (process.platform !== 'win32') {
            const profilePath = await this._findViaShellProfile('kiro-cli');
            if (profilePath) {
                this._resolvedCliPath = profilePath;
                this._setState({ status: 'ready', cliPath: profilePath });
                return profilePath;
            }
        }

        this._resolvedCliPath = null;
        this._setState({ status: 'not_found' });
        return null;
    }

    /**
     * Checks if the CLI has valid authentication credentials by running
     * `kiro-cli whoami`. Returns true if authenticated, false otherwise.
     *
     * Requirement 2.1
     */
    async checkAuthentication(cliPath: string): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            execFile(cliPath, ['whoami'], { timeout: 10000 }, (error, _stdout, _stderr) => {
                if (error) {
                    this._setState({ status: 'not_authenticated' });
                    resolve(false);
                } else {
                    // Restore ready state with the CLI path
                    if (this._state.status !== 'running') {
                        this._setState({ status: 'ready', cliPath });
                    }
                    resolve(true);
                }
            });
        });
    }

    /**
     * Runs `kiro-cli login` to authenticate the user via browser-based OAuth.
     * Returns true if login succeeded, false otherwise.
     *
     * Requirement 2.4
     */
    async login(): Promise<boolean> {
        const cliPath = this._resolvedCliPath ?? await this.resolveCliPath();
        if (!cliPath) {
            throw new Error('CLI binary not found. Please install kiro-cli.');
        }

        return new Promise<boolean>((resolve) => {
            const home = process.env.HOME || process.env.USERPROFILE || '';
            const env: Record<string, string | undefined> = { ...process.env };
            if (home) {
                env.HOME = home;
                if (!process.env.XDG_CONFIG_HOME) {
                    env.XDG_CONFIG_HOME = pathModule.join(home, '.config');
                }
            }

            execFile(cliPath, ['login'], { timeout: 120000, env }, (error, _stdout, _stderr) => {
                if (!error) {
                    this._setState({ status: 'ready', cliPath });
                    resolve(true);
                } else {
                    // Check if already authenticated despite login exit code
                    this.checkAuthentication(cliPath).then((isAuth) => {
                        if (isAuth) {
                            this._setState({ status: 'ready', cliPath });
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    });
                }
            });
        });
    }

    /**
     * Spawns a CLI process if one isn't already alive. Reuses the existing
     * process if it's still running (lazy spawning).
     *
     * Requirement 3.1
     */
    async ensureProcess(): Promise<CliProcess> {
        // Reuse existing process if alive
        if (this._process && this._process.isAlive) {
            return this._process;
        }

        // Clean up dead process
        if (this._process) {
            this._process.dispose();
            this._process = null;
        }

        // Determine CLI path, re-resolving if needed
        let cliPath = this._resolvedCliPath;
        if (!cliPath) {
            cliPath = await this.resolveCliPath();
            if (!cliPath) {
                throw new Error('CLI binary not found. Please install kiro-cli and ensure it\'s in your PATH.');
            }
        }

        const workspacePath = this._getWorkspacePath();
        const cliProcess = new CliProcess(cliPath, workspacePath);
        this._process = cliProcess;

        // Listen for unexpected exits (Requirement 3.3)
        cliProcess.onDidExit((exitInfo) => {
            if (this._process === cliProcess) {
                this._process = null;
                this._setState({ status: 'ready', cliPath: cliPath! });

                // Attempt auto-reconnect on unexpected exits
                const wasUnexpected = exitInfo.code !== 0 && exitInfo.code !== null;
                if (wasUnexpected && !this._isReconnecting) {
                    this._attemptAutoReconnect();
                }
            }
        });

        // Initialize ACP and create session
        await cliProcess.initializeAndCreateSession(workspacePath);

        this._setState({ status: 'running', cliPath, process: cliProcess });
        return cliProcess;
    }

    /**
     * Terminates the current CLI process and spawns a new one.
     *
     * Requirement 8.2
     */
    async restartProcess(): Promise<CliProcess> {
        if (this._process) {
            this._process.dispose();
            this._process = null;
        }

        // Re-resolve CLI path to handle environment changes
        await this.resolveCliPath();

        return this.ensureProcess();
    }

    /**
     * Gracefully terminates all CLI processes.
     * Sends SIGTERM first, then SIGKILL after 5 seconds if still alive.
     *
     * Requirement 3.4
     */
    dispose(): void {
        if (this._process) {
            const proc = this._process;
            this._process = null;

            // Send SIGTERM
            proc.kill();

            // Force kill after 5 seconds if still alive
            const killTimeout = setTimeout(() => {
                if (proc.isAlive) {
                    try {
                        proc.dispose();
                    } catch {
                        // Ignore errors during forced cleanup
                    }
                }
            }, 5000);

            // If the process exits before the timeout, clear it
            proc.onDidExit(() => {
                clearTimeout(killTimeout);
            });
        }

        this._onDidChangeState.dispose();
    }

    /**
     * Attempts to auto-reconnect with exponential backoff after an unexpected exit.
     * Makes 3 attempts with delays of 2s, 4s, 8s.
     */
    private async _attemptAutoReconnect(): Promise<void> {
        const MAX_ATTEMPTS = 3;
        const BASE_DELAY_MS = 2000;
        this._isReconnecting = true;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 2s, 4s, 8s

            this._onSystemMessage?.(
                `CLI process exited unexpectedly. Reconnect attempt ${attempt}/${MAX_ATTEMPTS} in ${delay / 1000}s...`
            );

            await new Promise<void>((resolve) => setTimeout(resolve, delay));

            try {
                await this.ensureProcess();
                this._onSystemMessage?.('CLI reconnected successfully.');
                this._isReconnecting = false;
                return;
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'Unknown error';
                this._onSystemMessage?.(`Reconnect attempt ${attempt} failed: ${msg}`);
            }
        }

        // All attempts failed
        this._isReconnecting = false;
        this._onErrorMessage?.(
            'Failed to reconnect after 3 attempts. Use "Kiro: Restart CLI" from the Command Palette to reconnect manually.'
        );
    }

    /**
     * Uses `which` (Unix) or `where` (Windows) to locate a binary on PATH.
     * Also checks ~/.local/bin as a common install location for kiro-cli.
     */
    private _which(binary: string): Promise<string | null> {
        const command = process.platform === 'win32' ? 'where' : 'which';
        // Include ~/.local/bin in PATH for the lookup
        const env = { ...process.env };
        const home = process.env.HOME || process.env.USERPROFILE || '';
        if (home) {
            const localBin = pathModule.join(home, '.local', 'bin');
            env.PATH = `${localBin}${pathModule.delimiter}${env.PATH || ''}`;
        }
        return new Promise<string | null>((resolve) => {
            execFile(command, [binary], { env }, (error, stdout) => {
                if (error || !stdout.trim()) {
                    resolve(null);
                } else {
                    // `where` on Windows may return multiple lines; take the first
                    resolve(stdout.trim().split('\n')[0].trim());
                }
            });
        });
    }

    /**
     * Attempts to find a binary by sourcing common shell profiles.
     * Tries ~/.zshrc, ~/.bashrc, ~/.bash_profile, ~/.profile in order.
     *
     * Requirement 1.4
     */
    private async _findViaShellProfile(binary: string): Promise<string | null> {
        const shell = process.env.SHELL || '/bin/bash';
        const home = process.env.HOME || '';
        if (!home) {
            return null;
        }

        const profileFiles = ['.zshrc', '.bashrc', '.bash_profile', '.profile'];

        for (const profile of profileFiles) {
            const profilePath = pathModule.join(home, profile);
            if (!fs.existsSync(profilePath)) {
                continue;
            }

            const result = await new Promise<string | null>((resolve) => {
                const shellCommand = `source ${profilePath} 2>/dev/null; which ${binary}`;
                execFile(shell, ['-c', shellCommand], { timeout: 10000 }, (error, stdout) => {
                    if (error || !stdout.trim()) {
                        resolve(null);
                    } else {
                        resolve(stdout.trim().split('\n')[0].trim());
                    }
                });
            });

            if (result) {
                return result;
            }
        }

        return null;
    }

    /**
     * Gets the current workspace folder path, falling back to the home directory.
     */
    private _getWorkspacePath(): string {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            return folders[0].uri.fsPath;
        }
        return process.env.HOME || process.env.USERPROFILE || '.';
    }

    /**
     * Updates the internal state and fires the state change event.
     */
    private _setState(newState: CliState): void {
        this._state = newState;
        this._onDidChangeState.fire(newState);
    }
}
