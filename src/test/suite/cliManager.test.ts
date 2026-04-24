/**
 * Unit tests for CliManager.
 *
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.3, 3.4
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { CliManager } from '../../cli/cliManager';
import { CliState } from '../../types';

suite('CliManager', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('resolveCliPath', () => {
        test('returns override path when cliPath option is provided', async () => {
            const manager = new CliManager({ cliPath: '/custom/path/kiro' });
            const result = await manager.resolveCliPath();
            assert.strictEqual(result, '/custom/path/kiro');
            assert.deepStrictEqual(manager.state, { status: 'ready', cliPath: '/custom/path/kiro' });
            manager.dispose();
        });

        test('fires onDidChangeState when path is resolved', async () => {
            const manager = new CliManager({ cliPath: '/test/kiro' });
            const states: CliState[] = [];
            manager.onDidChangeState((s) => states.push(s));

            await manager.resolveCliPath();

            assert.strictEqual(states.length, 1);
            assert.deepStrictEqual(states[0], { status: 'ready', cliPath: '/test/kiro' });
            manager.dispose();
        });
    });

    suite('ensureProcess', () => {
        test('throws if CLI path not resolved', async () => {
            const manager = new CliManager();
            await assert.rejects(
                () => manager.ensureProcess(),
                /CLI path not resolved/
            );
            manager.dispose();
        });

        test('fires onDidChangeState to running when process is spawned', async () => {
            // We use a cliPath override pointing to a real binary to test spawning
            const manager = new CliManager({ cliPath: process.execPath });
            await manager.resolveCliPath();

            const states: CliState[] = [];
            manager.onDidChangeState((s) => states.push(s));

            const proc = await manager.ensureProcess();
            assert.ok(proc);

            // Should have fired a 'running' state
            const runningState = states.find((s) => s.status === 'running');
            assert.ok(runningState, 'Expected a running state transition');

            manager.dispose();
        });

        test('reuses existing process if alive', async () => {
            const manager = new CliManager({ cliPath: process.execPath });
            await manager.resolveCliPath();

            const proc1 = await manager.ensureProcess();
            const proc2 = await manager.ensureProcess();
            assert.strictEqual(proc1, proc2, 'Should reuse the same process');

            manager.dispose();
        });
    });

    suite('restartProcess', () => {
        test('returns a new process after restart', async () => {
            const manager = new CliManager({ cliPath: process.execPath });
            await manager.resolveCliPath();

            const proc1 = await manager.ensureProcess();
            const proc2 = await manager.restartProcess();
            assert.notStrictEqual(proc1, proc2, 'Should return a different process');

            manager.dispose();
        });
    });

    suite('dispose', () => {
        test('terminates the running process', async () => {
            const manager = new CliManager({ cliPath: process.execPath });
            await manager.resolveCliPath();

            const proc = await manager.ensureProcess();
            assert.ok(proc.isAlive, 'Process should be alive before dispose');

            manager.dispose();

            // Give a moment for SIGTERM to take effect
            await new Promise((resolve) => setTimeout(resolve, 100));
            assert.ok(!proc.isAlive, 'Process should not be alive after dispose');
        });
    });

    suite('state transitions', () => {
        test('initial state is not_found', () => {
            const manager = new CliManager();
            assert.deepStrictEqual(manager.state, { status: 'not_found' });
            manager.dispose();
        });

        test('transitions to ready after resolveCliPath', async () => {
            const manager = new CliManager({ cliPath: '/test/kiro' });
            await manager.resolveCliPath();
            assert.strictEqual(manager.state.status, 'ready');
            manager.dispose();
        });
    });
});
