import * as vscode from 'vscode';
import { FetchVscodeRepoViewProvider } from './view';
import { syncAllMappings } from './sync';
import { startWatching, stopWatching } from './watcher';
import { registerSettingsWebview } from './ui';
import { executePythonScript } from './python';
import { getPythonExecutablePath } from './config';

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "SyncFiles" activated!');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('Please open a workspace first.');
        return;
    }
    const workspacePath = workspaceFolders[0].uri.fsPath;

    // Register tree view
    const viewProvider = new FetchVscodeRepoViewProvider(workspacePath);
    vscode.window.registerTreeDataProvider('syncView', viewProvider);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('vscode.sync', async () => {
            try {
                await syncAllMappings(workspacePath);
                vscode.window.showInformationMessage('Synchronization complete!');
            } catch (err) {
                console.error('Sync error:', err);
                vscode.window.showErrorMessage('Synchronization failed: ' + (err instanceof Error ? err.message : String(err)));
            }
        }),
        vscode.commands.registerCommand('vscode.refreshScripts', () => {
            viewProvider.refresh();
        }),
        vscode.commands.registerCommand('vscode.openSettings', () => {
            registerSettingsWebview(context, workspacePath);
        }),
        vscode.commands.registerCommand('vscode.runScript', async (scriptPath: string) => {
            const exePath = getPythonExecutablePath(workspacePath);
            if (!exePath) {
                vscode.window.showErrorMessage('Python executable path not configured.');
                return;
            }
            try {
                await executePythonScript(workspacePath, exePath, scriptPath);
            } catch (err) {
                vscode.window.showErrorMessage('Script execution failed: ' + (err instanceof Error ? err.message : String(err)));
            }
        })
    );

    // Initialize watcher on activation
    startWatching(workspacePath, () => {
        vscode.commands.executeCommand('vscode.refreshScripts');
    });
}

export function deactivate() {
    console.log('Extension "SyncFiles" deactivated.');
    stopWatching();
}