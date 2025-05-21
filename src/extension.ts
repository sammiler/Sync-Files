import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FetchVscodeRepoViewProvider, ScriptGroupTreeItem, ScriptItemTreeItem, UngroupedScriptFileTreeItem } from './view'; // Import new TreeItem types
import { syncAllMappings } from './sync';
import { startWatching, stopWatching } from './watcher';
import { registerSettingsWebview } from './ui';
import { executePythonScript } from './python';
import {
    getPythonExecutablePath,
    getPythonScriptPath,
    getScriptGroups,
    addScriptGroup,
    updateScriptGroup,
    removeScriptGroup,
    addScriptToGroup,
    updateScriptInGroup,
    removeScriptFromGroup,
    findScriptAndGroup,
    getAllAssignedScriptPaths,
    ScriptGroupConfig,
    ScriptItemConfig,
    getEnvVars,
    readConfig, // For saving full config directly if needed
    saveFullConfig
} from './config';
import { generateUUID } from './utils'; // Import UUID generator

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "SyncFiles" activated!');

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('SyncFiles: Please open a workspace first.');
        return;
    }
    const workspacePath = workspaceFolders[0].uri.fsPath;

    const viewProvider = new FetchVscodeRepoViewProvider(workspacePath);
    vscode.window.registerTreeDataProvider('syncView', viewProvider);

    // --- COMMAND REGISTRATIONS ---

    // Core commands
    context.subscriptions.push(
        vscode.commands.registerCommand('syncfiles.syncAll', async () => { // Changed name
            try {
                await syncAllMappings(workspacePath);
                vscode.window.showInformationMessage('SyncFiles: Synchronization complete!');
            } catch (err) {
                console.error('SyncFiles Sync error:', err);
                vscode.window.showErrorMessage('SyncFiles: Synchronization failed: ' + (err instanceof Error ? err.message : String(err)));
            }
        }),
        vscode.commands.registerCommand('syncfiles.refreshTreeView', () => { // Changed name
            viewProvider.refresh();
        }),
        vscode.commands.registerCommand('syncfiles.openSettings', () => {
            registerSettingsWebview(context, workspacePath);
        })
    );

    // Script Execution Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('syncfiles.runScriptVSCodeAPI', async (item: ScriptItemTreeItem | { scriptPath: string, scriptId?: string }) => {
            let scriptPathToRun: string;
            let scriptName: string;

            if (item instanceof ScriptItemTreeItem) {
                scriptPathToRun = item.scriptConfig.path;
                scriptName = item.label as string;
            } else if (item && typeof item.scriptPath === 'string') { // For running event scripts from watcher
                scriptPathToRun = item.scriptPath;
                scriptName = path.basename(scriptPathToRun);
            } else {
                vscode.window.showErrorMessage('SyncFiles: Invalid script item for execution.');
                return;
            }
            
            const exePath = getPythonExecutablePath(workspacePath);
            if (!exePath) {
                vscode.window.showErrorMessage('SyncFiles: Python executable path not configured.');
                return;
            }
            // Ensure scriptPathToRun is relative to pythonScriptPath for executePythonScript if it expects that
            // Or make it absolute here. executePythonScript already resolves it from workspacePath.
            // If scriptPathToRun is already relative to pythonScriptPath, and pythonScriptPath is relative to workspace:
            const fullRelativePath = path.join(getPythonScriptPath(workspacePath), scriptPathToRun);

            try {
                await executePythonScript(
                    workspacePath,
                    exePath,
                    fullRelativePath,
                    [],
                    {
                        showNotifications: true,
                        showErrorModal: true,
                        successMessage: `Script '${scriptName}' executed successfully via VSCode API.`
                    }
                );
            } catch (err) {
                // executePythonScript already shows an error
                // vscode.window.showErrorMessage('Script execution failed: ' + (err instanceof Error ? err.message : String(err)));
            }
        }),
        vscode.commands.registerCommand('syncfiles.runScriptInTerminal', async (item: ScriptItemTreeItem) => {
            if (!(item instanceof ScriptItemTreeItem)) {
                vscode.window.showErrorMessage('SyncFiles: Invalid script item for terminal execution.');
                return;
            }

            const scriptConfig = item.scriptConfig;
            const pythonScriptDir = getPythonScriptPath(workspacePath);
            const absoluteScriptPath = path.join(workspacePath, pythonScriptDir, scriptConfig.path);
            const pythonExecutable = getPythonExecutablePath(workspacePath);

            if (!pythonExecutable) {
                vscode.window.showErrorMessage('SyncFiles: Python executable path not configured.');
                return;
            }
            if (!fs.existsSync(absoluteScriptPath)) {
                vscode.window.showErrorMessage(`SyncFiles: Script file not found: ${absoluteScriptPath}`);
                return;
            }

            const termName = `Run: ${scriptConfig.alias || path.basename(scriptConfig.path)}`;
            let terminal = vscode.window.terminals.find(t => t.name === termName);
            if (terminal && (await vscode.window.showWarningMessage(`Terminal "${termName}" already exists. Reuse it?`, "Reuse", "Create New")) === "Create New") {
                terminal.dispose();
                terminal = undefined;
            }
            if (!terminal) {
                const terminalEnv: { [key: string]: string | null } = {};
                const configEnvVars = getEnvVars(workspacePath);
                configEnvVars.forEach((value, key) => {
                    terminalEnv[key] = value;
                });
                terminal = vscode.window.createTerminal({ name: termName, env: terminalEnv });
            }
            
            // Ensure path quoting for safety
            const command = `"${pythonExecutable}" "${absoluteScriptPath}"`;
            terminal.sendText(command); // sendText automatically adds newline/CR based on OS if needed.
            terminal.show();
        })
    );

    // Script Group Management Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('syncfiles.createScriptGroup', async () => {
            const groupName = await vscode.window.showInputBox({ prompt: 'Enter new script group name' });
            if (groupName) {
                const newGroup: ScriptGroupConfig = {
                    id: generateUUID(),
                    name: groupName,
                    scripts: []
                };
                await addScriptGroup(workspacePath, newGroup);
                viewProvider.refresh();
            }
        }),
        vscode.commands.registerCommand('syncfiles.renameScriptGroup', async (item: ScriptGroupTreeItem) => {
            if (!(item instanceof ScriptGroupTreeItem)) return;
            const newName = await vscode.window.showInputBox({ value: item.groupConfig.name, prompt: 'Enter new group name' });
            if (newName && newName !== item.groupConfig.name) {
                const updatedGroup = { ...item.groupConfig, name: newName };
                await updateScriptGroup(workspacePath, updatedGroup);
                viewProvider.refresh();
            }
        }),
        vscode.commands.registerCommand('syncfiles.deleteScriptGroup', async (item: ScriptGroupTreeItem) => {
            if (!(item instanceof ScriptGroupTreeItem)) return;
            const confirm = await vscode.window.showWarningMessage(`Are you sure you want to delete group "${item.groupConfig.name}"? Scripts within it will become ungrouped.`, { modal: true }, 'Delete');
            if (confirm === 'Delete') {
                await removeScriptGroup(workspacePath, item.groupConfig.id);
                viewProvider.refresh();
            }
        })
    );

    // Script Item Management Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('syncfiles.addScriptToGroup', async (item: ScriptGroupTreeItem | UngroupedScriptFileTreeItem) => {
            let targetGroupId: string | undefined;
            let preselectedScriptPath: string | undefined;

            if (item instanceof ScriptGroupTreeItem) {
                targetGroupId = item.groupConfig.id;
            } else if (item instanceof UngroupedScriptFileTreeItem) {
                // If adding from an ungrouped item, ask which group to add to
                const groups = getScriptGroups(workspacePath);
                if (groups.length === 0) {
                    vscode.window.showInformationMessage("No script groups available. Please create one first.");
                    return;
                }
                const pickedGroup = await vscode.window.showQuickPick(
                    groups.map(g => ({ label: g.name, id: g.id })),
                    { placeHolder: "Select a group to add the script to" }
                );
                if (!pickedGroup) return;
                targetGroupId = pickedGroup.id;
                preselectedScriptPath = item.scriptPath;
            }

            if (!targetGroupId) {
                 const groups = getScriptGroups(workspacePath);
                 if (groups.length === 0) {
                     vscode.window.showInformationMessage("No script groups available to add to. Create one first.");
                     return;
                 }
                 const chosenGroup = await vscode.window.showQuickPick(groups.map(g => ({label: g.name, id: g.id})), {placeHolder: "Select group to add script to"});
                 if (!chosenGroup) return;
                 targetGroupId = chosenGroup.id;
            }


            const pythonScriptDir = getPythonScriptPath(workspacePath);
            if (!pythonScriptDir) {
                vscode.window.showErrorMessage('SyncFiles: Python script path not set.');
                return;
            }
            const fullScriptDirPath = path.resolve(workspacePath, pythonScriptDir);
            if (!fs.existsSync(fullScriptDirPath) || !fs.statSync(fullScriptDirPath).isDirectory()) {
                 vscode.window.showErrorMessage(`SyncFiles: Python script directory not found: ${fullScriptDirPath}`);
                return;
            }

            const assignedPaths = getAllAssignedScriptPaths(workspacePath);
            const availableScripts = fs.readdirSync(fullScriptDirPath)
                .filter(file => file.toLowerCase().endsWith('.py') && !fs.statSync(path.join(fullScriptDirPath, file)).isDirectory() && !assignedPaths.has(file))
                .map(file => ({ label: file, description: `Add ${file} to group` , filePath: file }));

            if (availableScripts.length === 0 && !preselectedScriptPath) {
                vscode.window.showInformationMessage('SyncFiles: No new scripts available to add (all .py files in the script directory are already in groups).');
                return;
            }
            
            let scriptPathToAdd: string | undefined = preselectedScriptPath;

            if (!scriptPathToAdd) {
                const pickedScript = await vscode.window.showQuickPick(availableScripts, { placeHolder: 'Select a script to add' });
                if (!pickedScript) return;
                scriptPathToAdd = pickedScript.filePath;
            }
            
            if (!scriptPathToAdd) return; // Should not happen if logic is correct

            const alias = await vscode.window.showInputBox({ prompt: `Enter an alias for "${path.basename(scriptPathToAdd)}" (optional, press Enter for default)` });
            const description = await vscode.window.showInputBox({ prompt: `Enter a description for "${path.basename(scriptPathToAdd)}" (optional)` });

            const newScriptItem: ScriptItemConfig = {
                id: generateUUID(),
                path: scriptPathToAdd, // Relative to pythonScriptPath
                alias: alias || undefined,
                description: description || undefined,
                executionMode: 'vscodeApi' // Default execution mode
            };

            await addScriptToGroup(workspacePath, targetGroupId, newScriptItem);
            viewProvider.refresh();
        }),

        vscode.commands.registerCommand('syncfiles.editScriptDetails', async (item: ScriptItemTreeItem) => {
            if (!(item instanceof ScriptItemTreeItem) || !item.parentGroupConfig) return;

            const oldConf = item.scriptConfig;
            const newAlias = await vscode.window.showInputBox({
                prompt: 'Enter new alias (or leave blank to remove)',
                value: oldConf.alias || ''
            });
            const newDescription = await vscode.window.showInputBox({
                prompt: 'Enter new description (or leave blank to remove)',
                value: oldConf.description || ''
            });

            if (newAlias !== undefined && newDescription !== undefined) { // Check if user didn't cancel
                const updatedScriptItem: ScriptItemConfig = {
                    ...oldConf,
                    alias: newAlias || undefined,
                    description: newDescription || undefined
                };
                await updateScriptInGroup(workspacePath, item.parentGroupConfig.id, updatedScriptItem);
                viewProvider.refresh();
            }
        }),
        vscode.commands.registerCommand('syncfiles.setScriptExecutionMode', async (item: ScriptItemTreeItem, mode?: 'vscodeApi' | 'directTerminal') => {
            if (!(item instanceof ScriptItemTreeItem) || !item.parentGroupConfig) return;

            let chosenMode = mode;
            if (!chosenMode) {
                const pick = await vscode.window.showQuickPick([
                    { label: "VSCode API (Background)", description: "Runs script using VSCode's internal execution, good for quick tasks.", mode: 'vscodeApi' as const },
                    { label: "Direct Terminal Call", description: "Runs script in a new VSCode terminal, good for interactive scripts or visible output.", mode: 'directTerminal' as const }
                ], { placeHolder: "Select default execution mode for this script" });
                if (!pick) return;
                chosenMode = pick.mode;
            }
            
            const updatedScriptItem: ScriptItemConfig = { ...item.scriptConfig, executionMode: chosenMode };
            await updateScriptInGroup(workspacePath, item.parentGroupConfig.id, updatedScriptItem);
            viewProvider.refresh();
            vscode.window.showInformationMessage(`Default execution for '${item.label}' set to ${chosenMode === 'directTerminal' ? 'Direct Terminal' : 'VSCode API'}.`);
        }),

        vscode.commands.registerCommand('syncfiles.runScriptDefault', async (item: ScriptItemTreeItem) => {
            if (!(item instanceof ScriptItemTreeItem)) return;
            const mode = item.scriptConfig.executionMode || 'vscodeApi'; // Default to vscodeApi if not set
            if (mode === 'directTerminal') {
                vscode.commands.executeCommand('syncfiles.runScriptInTerminal', item);
            } else {
                vscode.commands.executeCommand('syncfiles.runScriptVSCodeAPI', item);
            }
        }),

        vscode.commands.registerCommand('syncfiles.removeScriptFromGroup', async (item: ScriptItemTreeItem) => {
            if (!(item instanceof ScriptItemTreeItem) || !item.parentGroupConfig) return;
            const confirm = await vscode.window.showWarningMessage(`Are you sure you want to remove "${item.label}" from group "${item.parentGroupConfig.name}"? It will become an ungrouped script.`, { modal: true }, 'Remove');
            if (confirm === 'Remove') {
                await removeScriptFromGroup(workspacePath, item.parentGroupConfig.id, item.scriptConfig.id);
                viewProvider.refresh();
            }
        }),
        vscode.commands.registerCommand('syncfiles.moveScriptToGroup', async (item: ScriptItemTreeItem) => {
            if (!(item instanceof ScriptItemTreeItem) || !item.parentGroupConfig) return;

            const currentGroupId = item.parentGroupConfig.id;
            const scriptToMove = item.scriptConfig;

            const availableGroups = getScriptGroups(workspacePath)
                .filter(g => g.id !== currentGroupId) // Exclude current group
                .map(g => ({ label: g.name, id: g.id }));

            if (availableGroups.length === 0) {
                vscode.window.showInformationMessage('SyncFiles: No other groups available to move the script to.');
                return;
            }

            const pickedGroup = await vscode.window.showQuickPick(availableGroups, { placeHolder: 'Select a new group for the script' });
            if (!pickedGroup) return;

            // Atomically remove from old and add to new
            const config = readConfig(workspacePath);
            const oldGroup = config.scriptGroups.find(g => g.id === currentGroupId);
            const newGroup = config.scriptGroups.find(g => g.id === pickedGroup.id);

            if (oldGroup && newGroup) {
                oldGroup.scripts = oldGroup.scripts.filter(s => s.id !== scriptToMove.id);
                newGroup.scripts.push(scriptToMove); // Add the original script item object
                await saveFullConfig(workspacePath, config); // Save the whole config once
                viewProvider.refresh();
            } else {
                vscode.window.showErrorMessage('SyncFiles: Error finding source or destination group.');
            }
        })
    );

    // Initialize watcher
    startWatching(workspacePath, () => {
        viewProvider.refresh();
    });
}

export function deactivate() {
    console.log('Extension "SyncFiles" deactivated.');
    stopWatching();
}