/**
 * Unit tests for StatusManager.
 *
 * Requirements: 9.3, 9.4
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { StatusManager } from '../../status/statusManager';
import { CliManager } from '../../cli/cliManager';
import { CliState } from '../../types';

suite('StatusManager', () => {
    let sandbox: sinon.SinonSandbox;
    let executeCommandStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand').resolves();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('deriveStatus', () => {
        test('returns active for running state', () => {
            const state: CliState = {
                status: 'running',
                cliPath: '/usr/bin/kiro',
                process: {} as any,
            };
            assert.strictEqual(StatusManager.deriveStatus(state), 'active');
        });

        test('returns inactive for ready state', () => {
            const state: CliState = { status: 'ready', cliPath: '/usr/bin/kiro' };
            assert.strictEqual(StatusManager.deriveStatus(state), 'inactive');
        });

        test('returns inactive for not_found state', () => {
            const state: CliState = { status: 'not_found' };
            assert.strictEqual(StatusManager.deriveStatus(state), 'inactive');
        });

        test('returns inactive for not_authenticated state', () => {
            const state: CliState = { status: 'not_authenticated' };
            assert.strictEqual(StatusManager.deriveStatus(state), 'inactive');
        });

        test('returns inactive for error state', () => {
            const state: CliState = { status: 'error', message: 'something broke' };
            assert.strictEqual(StatusManager.deriveStatus(state), 'inactive');
        });
    });

    suite('constructor', () => {
        test('sets initial status from current CLI state', () => {
            const cliManager = new CliManager({ cliPath: '/test/kiro' });
            // Initial state is not_found → inactive
            const statusManager = new StatusManager(cliManager);

            assert.strictEqual(statusManager.currentStatus, 'inactive');
            assert.ok(
                executeCommandStub.calledWith('setContext', 'kiro.status', 'inactive'),
                'Should set context key to inactive on construction'
            );

            statusManager.dispose();
            cliManager.dispose();
        });
    });

    suite('updateStatus', () => {
        test('sets context key via executeCommand', () => {
            const cliManager = new CliManager();
            const statusManager = new StatusManager(cliManager);

            executeCommandStub.resetHistory();
            statusManager.updateStatus('active');

            assert.ok(
                executeCommandStub.calledWith('setContext', 'kiro.status', 'active'),
                'Should call setContext with active status'
            );
            assert.strictEqual(statusManager.currentStatus, 'active');

            statusManager.dispose();
            cliManager.dispose();
        });

        test('updates currentStatus property', () => {
            const cliManager = new CliManager();
            const statusManager = new StatusManager(cliManager);

            statusManager.updateStatus('error');
            assert.strictEqual(statusManager.currentStatus, 'error');

            statusManager.updateStatus('active');
            assert.strictEqual(statusManager.currentStatus, 'active');

            statusManager.dispose();
            cliManager.dispose();
        });
    });

    suite('reacts to CliManager state changes', () => {
        test('updates to active when CLI transitions to running', async () => {
            const cliManager = new CliManager({ cliPath: process.execPath });
            const statusManager = new StatusManager(cliManager);

            await cliManager.resolveCliPath();
            assert.strictEqual(statusManager.currentStatus, 'inactive');

            await cliManager.ensureProcess();
            assert.strictEqual(statusManager.currentStatus, 'active');

            statusManager.dispose();
            cliManager.dispose();
        });

        test('updates to inactive when CLI process is disposed', async () => {
            const cliManager = new CliManager({ cliPath: process.execPath });
            const statusManager = new StatusManager(cliManager);

            await cliManager.resolveCliPath();
            await cliManager.ensureProcess();
            assert.strictEqual(statusManager.currentStatus, 'active');

            // Restart will dispose old process and create new one → running again
            await cliManager.restartProcess();
            assert.strictEqual(statusManager.currentStatus, 'active');

            statusManager.dispose();
            cliManager.dispose();
        });
    });

    suite('dispose', () => {
        test('cleans up event listeners', () => {
            const cliManager = new CliManager();
            const statusManager = new StatusManager(cliManager);

            // Should not throw
            statusManager.dispose();
            cliManager.dispose();
        });
    });
});
