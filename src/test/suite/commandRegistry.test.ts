/**
 * Unit tests for CommandRegistry.
 *
 * Requirements: 8.1, 8.2, 8.3
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { CommandRegistry } from '../../commands/commandRegistry';
import { CliManager } from '../../cli/cliManager';
import { ChatPanelProvider } from '../../chat/chatPanelProvider';
import { SpecWorkflowManager } from '../../spec/specWorkflowManager';

suite('CommandRegistry', () => {
    let sandbox: sinon.SinonSandbox;
    let cliManager: CliManager;
    let chatPanelProvider: sinon.SinonStubbedInstance<ChatPanelProvider>;
    let specWorkflowManager: sinon.SinonStubbedInstance<SpecWorkflowManager>;
    let showErrorMessageStub: sinon.SinonStub;
    let registerCommandStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();

        cliManager = new CliManager();

        chatPanelProvider = sandbox.createStubInstance(ChatPanelProvider);
        specWorkflowManager = sandbox.createStubInstance(SpecWorkflowManager);

        showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves();
        registerCommandStub = sandbox.stub(vscode.commands, 'registerCommand');
        registerCommandStub.callsFake((_id: string, _cb: Function) => ({
            dispose: sandbox.stub(),
        }));
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('registerCommands', () => {
        test('registers three commands', () => {
            const registry = new CommandRegistry(
                cliManager,
                chatPanelProvider as unknown as ChatPanelProvider,
                specWorkflowManager as unknown as SpecWorkflowManager
            );

            const disposables = registry.registerCommands();

            assert.strictEqual(disposables.length, 3);
            assert.ok(registerCommandStub.calledWith('kiro.openChat'));
            assert.ok(registerCommandStub.calledWith('kiro.startSpec'));
            assert.ok(registerCommandStub.calledWith('kiro.restartCli'));

            registry.dispose();
        });

        test('returns disposable array', () => {
            const registry = new CommandRegistry(
                cliManager,
                chatPanelProvider as unknown as ChatPanelProvider,
                specWorkflowManager as unknown as SpecWorkflowManager
            );

            const disposables = registry.registerCommands();

            assert.ok(Array.isArray(disposables));
            disposables.forEach((d) => assert.ok(typeof d.dispose === 'function'));

            registry.dispose();
        });
    });

    suite('command guard - CLI not found', () => {
        test('kiro.openChat shows error when CLI not found', () => {
            const registry = new CommandRegistry(
                cliManager,
                chatPanelProvider as unknown as ChatPanelProvider,
                specWorkflowManager as unknown as SpecWorkflowManager
            );

            registry.registerCommands();

            // Get the callback registered for kiro.openChat and invoke it
            const openChatCall = registerCommandStub.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0] === 'kiro.openChat'
            );
            assert.ok(openChatCall, 'kiro.openChat should be registered');
            openChatCall.args[1](); // invoke the handler

            assert.ok(showErrorMessageStub.calledOnce, 'Should show error message');
            assert.ok(
                (showErrorMessageStub.firstCall.args[0] as string).includes('Kiro CLI not found'),
                'Error message should mention CLI not found'
            );
            assert.ok(
                chatPanelProvider.openPanel.notCalled,
                'openPanel should not be called when CLI is not found'
            );

            registry.dispose();
        });

        test('kiro.startSpec shows error when CLI not found', () => {
            const registry = new CommandRegistry(
                cliManager,
                chatPanelProvider as unknown as ChatPanelProvider,
                specWorkflowManager as unknown as SpecWorkflowManager
            );

            registry.registerCommands();

            const startSpecCall = registerCommandStub.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0] === 'kiro.startSpec'
            );
            assert.ok(startSpecCall);
            startSpecCall.args[1]();

            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(
                specWorkflowManager.startWorkflow.notCalled,
                'startWorkflow should not be called when CLI is not found'
            );

            registry.dispose();
        });

        test('kiro.restartCli shows error when CLI not found', () => {
            const registry = new CommandRegistry(
                cliManager,
                chatPanelProvider as unknown as ChatPanelProvider,
                specWorkflowManager as unknown as SpecWorkflowManager
            );

            registry.registerCommands();

            const restartCall = registerCommandStub.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0] === 'kiro.restartCli'
            );
            assert.ok(restartCall);
            restartCall.args[1]();

            assert.ok(showErrorMessageStub.calledOnce);
            assert.ok(
                (cliManager as any)._process === null,
                'restartProcess should not be called when CLI is not found'
            );

            registry.dispose();
        });
    });

    suite('command execution - CLI available', () => {
        test('kiro.openChat calls openPanel when CLI is ready', async () => {
            // Resolve CLI path to move state away from not_found
            const mgr = new CliManager({ cliPath: '/usr/bin/kiro' });
            await mgr.resolveCliPath();

            const registry = new CommandRegistry(
                mgr,
                chatPanelProvider as unknown as ChatPanelProvider,
                specWorkflowManager as unknown as SpecWorkflowManager
            );

            registry.registerCommands();

            const openChatCall = registerCommandStub.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0] === 'kiro.openChat'
            );
            openChatCall!.args[1]();

            assert.ok(chatPanelProvider.openPanel.calledOnce, 'openPanel should be called');
            assert.ok(showErrorMessageStub.notCalled, 'No error should be shown');

            registry.dispose();
            mgr.dispose();
        });

        test('kiro.startSpec calls startWorkflow when CLI is ready', async () => {
            const mgr = new CliManager({ cliPath: '/usr/bin/kiro' });
            await mgr.resolveCliPath();

            const registry = new CommandRegistry(
                mgr,
                chatPanelProvider as unknown as ChatPanelProvider,
                specWorkflowManager as unknown as SpecWorkflowManager
            );

            registry.registerCommands();

            const startSpecCall = registerCommandStub.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0] === 'kiro.startSpec'
            );
            startSpecCall!.args[1]();

            assert.ok(specWorkflowManager.startWorkflow.calledOnce, 'startWorkflow should be called');
            assert.ok(showErrorMessageStub.notCalled);

            registry.dispose();
            mgr.dispose();
        });

        test('kiro.restartCli calls restartProcess when CLI is ready', async () => {
            const mgr = new CliManager({ cliPath: '/usr/bin/kiro' });
            await mgr.resolveCliPath();

            const restartStub = sandbox.stub(mgr, 'restartProcess').resolves({} as any);

            const registry = new CommandRegistry(
                mgr,
                chatPanelProvider as unknown as ChatPanelProvider,
                specWorkflowManager as unknown as SpecWorkflowManager
            );

            registry.registerCommands();

            const restartCall = registerCommandStub.getCalls().find(
                (c: sinon.SinonSpyCall) => c.args[0] === 'kiro.restartCli'
            );
            restartCall!.args[1]();

            assert.ok(restartStub.calledOnce, 'restartProcess should be called');
            assert.ok(showErrorMessageStub.notCalled);

            registry.dispose();
            mgr.dispose();
        });
    });

    suite('dispose', () => {
        test('disposes all registered command disposables', () => {
            const disposeStubs = [sandbox.stub(), sandbox.stub(), sandbox.stub()];
            let callIndex = 0;
            registerCommandStub.callsFake(() => ({
                dispose: disposeStubs[callIndex++],
            }));

            const registry = new CommandRegistry(
                cliManager,
                chatPanelProvider as unknown as ChatPanelProvider,
                specWorkflowManager as unknown as SpecWorkflowManager
            );

            registry.registerCommands();
            registry.dispose();

            disposeStubs.forEach((stub, i) => {
                assert.ok(stub.calledOnce, `Disposable ${i} should be disposed`);
            });
        });
    });
});
