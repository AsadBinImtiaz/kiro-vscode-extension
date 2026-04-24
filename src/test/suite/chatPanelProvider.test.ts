/**
 * Unit tests for ChatPanelProvider retry logic.
 *
 * Requirements: 11.2, 11.3
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ChatPanelProvider } from '../../chat/chatPanelProvider';
import { CliManager } from '../../cli/cliManager';
import { WorkspaceContextProvider } from '../../context/workspaceContextProvider';

suite('ChatPanelProvider - Retry Logic', () => {
    let sandbox: sinon.SinonSandbox;
    let provider: ChatPanelProvider;
    let cliManager: sinon.SinonStubbedInstance<CliManager>;
    let contextProvider: sinon.SinonStubbedInstance<WorkspaceContextProvider>;
    let showErrorMessageStub: sinon.SinonStub;
    let fakeWebview: { postMessage: sinon.SinonStub; html: string; onDidReceiveMessage: sinon.SinonStub; cspSource: string; asWebviewUri: sinon.SinonStub };
    let fakePanel: any;

    setup(() => {
        sandbox = sinon.createSandbox();

        cliManager = sandbox.createStubInstance(CliManager);
        contextProvider = sandbox.createStubInstance(WorkspaceContextProvider);
        contextProvider.gatherContext.resolves({
            activeFile: null,
            selectedFiles: [],
            steeringFiles: [],
        });

        showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage').resolves(undefined);

        fakeWebview = {
            postMessage: sandbox.stub().resolves(),
            html: '',
            onDidReceiveMessage: sandbox.stub(),
            cspSource: '',
            asWebviewUri: sandbox.stub().returns(vscode.Uri.parse('https://fake')),
        };

        fakePanel = {
            webview: fakeWebview,
            reveal: sandbox.stub(),
            onDidDispose: sandbox.stub(),
            dispose: sandbox.stub(),
        };

        sandbox.stub(vscode.window, 'createWebviewPanel').returns(fakePanel as any);

        // Stub fs.readFileSync to return minimal HTML
        const fsModule = require('fs');
        sandbox.stub(fsModule, 'readFileSync').returns('<html></html>');

        const extensionUri = vscode.Uri.file('/fake/extension');
        provider = new ChatPanelProvider(
            extensionUri,
            cliManager as unknown as CliManager,
            contextProvider as unknown as WorkspaceContextProvider
        );

        // Open the panel so _panel is set
        provider.openPanel();
    });

    teardown(() => {
        provider.dispose();
        sandbox.restore();
    });

    test('stores last failed message on communication error', async () => {
        cliManager.ensureProcess.rejects(new Error('Connection refused'));

        await provider.handleUserMessage('hello world');

        // Should show VS Code error notification with Retry action
        assert.ok(showErrorMessageStub.calledOnce, 'Should show error message');
        const errorMsg = showErrorMessageStub.firstCall.args[0] as string;
        assert.ok(errorMsg.includes('Communication error'), 'Should include "Communication error" prefix');
        assert.ok(errorMsg.includes('Connection refused'), 'Should include original error message');
        assert.strictEqual(showErrorMessageStub.firstCall.args[1], 'Retry', 'Should offer Retry action');
    });

    test('retries the failed message when user clicks Retry on notification', async () => {
        let callCount = 0;
        cliManager.ensureProcess.callsFake(() => {
            callCount++;
            if (callCount === 1) {
                return Promise.reject(new Error('Connection refused'));
            }
            // Second call succeeds
            return Promise.resolve({
                sendStreamingRequest: sandbox.stub().resolves({ id: 'req-2' }),
            } as any);
        });

        // First call: user clicks "Retry"
        showErrorMessageStub.onFirstCall().resolves('Retry');
        // Second call (after retry): no action needed
        showErrorMessageStub.onSecondCall().resolves(undefined);

        await provider.handleUserMessage('hello world');

        assert.strictEqual(callCount, 2, 'ensureProcess should be called twice (original + retry)');
    });

    test('does not retry when user dismisses the error notification', async () => {
        cliManager.ensureProcess.rejects(new Error('Connection refused'));
        showErrorMessageStub.resolves(undefined); // User dismisses

        await provider.handleUserMessage('hello world');

        assert.ok(cliManager.ensureProcess.calledOnce, 'Should only attempt once');
    });

    test('handles retry from webview message when last failed message exists', async () => {
        // First: cause a failure to store _lastFailedMessage
        cliManager.ensureProcess.rejects(new Error('broken pipe'));
        showErrorMessageStub.resolves(undefined); // dismiss notification

        await provider.handleUserMessage('test message');

        // Now set up success for the retry
        cliManager.ensureProcess.resolves({
            sendStreamingRequest: sandbox.stub().resolves({ id: 'req-2' }),
        } as any);

        // Get the onDidReceiveMessage handler and simulate a retry message
        const messageHandler = fakeWebview.onDidReceiveMessage.firstCall.args[0];
        await messageHandler({ type: 'retry' });

        // ensureProcess should be called again (once for failure, once for retry)
        assert.strictEqual(cliManager.ensureProcess.callCount, 2, 'Should retry via webview message');
    });

    test('webview retry does nothing when no failed message exists', async () => {
        // No prior failure — _lastFailedMessage is null
        const messageHandler = fakeWebview.onDidReceiveMessage.firstCall.args[0];
        await messageHandler({ type: 'retry' });

        assert.ok(cliManager.ensureProcess.notCalled, 'Should not call ensureProcess when no failed message');
    });

    test('clears last failed message on successful completion', async () => {
        // First call fails
        cliManager.ensureProcess.onFirstCall().rejects(new Error('timeout'));
        showErrorMessageStub.resolves(undefined);

        await provider.handleUserMessage('my message');

        // Second call succeeds
        cliManager.ensureProcess.onSecondCall().resolves({
            sendStreamingRequest: sandbox.stub().resolves({ id: 'req-2' }),
        } as any);

        await provider.handleUserMessage('my message');

        // Now retry from webview should do nothing since success cleared the stored message
        cliManager.ensureProcess.resetHistory();
        const messageHandler = fakeWebview.onDidReceiveMessage.firstCall.args[0];
        await messageHandler({ type: 'retry' });

        assert.ok(cliManager.ensureProcess.notCalled, 'Should not retry after successful completion');
    });

    test('forwards error to webview in addition to showing notification', async () => {
        cliManager.ensureProcess.rejects(new Error('process crashed'));
        showErrorMessageStub.resolves(undefined);

        await provider.handleUserMessage('test');

        // Check that an error message was posted to the webview
        const errorPost = fakeWebview.postMessage.getCalls().find(
            (c: sinon.SinonSpyCall) => c.args[0]?.type === 'error'
        );
        assert.ok(errorPost, 'Should post error to webview');
        assert.ok(
            (errorPost!.args[0].message as string).includes('process crashed'),
            'Webview error should contain original message'
        );
    });
});
