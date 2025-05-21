import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FetchVscodeRepoViewProvider, ScriptGroupTreeItem, ScriptItemTreeItem } from './view';
import { syncAllMappings } from './sync';
import { startWatching, stopWatching } from './watcher';
import { registerSettingsWebview } from './ui';
import { executePythonScript } from './python';
import {
    getPythonExecutablePath, getPythonScriptPath, getScriptGroups, 
    addScriptGroup as addScriptGroupToConfig, // Use alias to avoid confusion
    updateScriptGroup as updateScriptGroupInConfig,
    removeScriptGroupAndSave, // Use new distinct name
    addScriptToGroupAndSave, 
    updateScriptInGroupAndSave,
    ScriptGroupConfig, ScriptItemConfig, getEnvVars, readConfig, saveFullConfig,
    DEFAULT_SCRIPT_GROUP_ID, getDefaultGroupNameSetting, 
    synchronizeConfigWithFileSystem, Config, getAllAssignedScriptPaths // Import new function
} from './config';
import { generateUUID, normalizePath, ensureAbsolute } from './utils';

let treeViewInstance: vscode.TreeView<vscode.TreeItem> | undefined;
let viewProviderInstance: FetchVscodeRepoViewProvider | undefined; // Store viewProvider instance

async function refreshAndSyncConfig(workspacePath: string): Promise<void> {
    console.log("[SyncFiles] Executing refreshAndSyncConfig...");
    let currentConfig = readConfig(workspacePath); // Read fresh config from disk
    
    // synchronizeConfigWithFileSystem MUTATES currentConfig and returns a boolean
    const changed = synchronizeConfigWithFileSystem(currentConfig, workspacePath); 

    if (changed) {
        console.log("[SyncFiles] Config changed during sync, saving...");
        // currentConfig is already the updated one (mutated by synchronizeConfigWithFileSystem)
        // saveFullConfig will perform its own final cleanup of empty script.path and save
        await saveFullConfig(workspacePath, currentConfig); 
    }
    
    // Refresh the view using the viewProvider instance
    if (viewProviderInstance) {
        viewProviderInstance.refresh();
    } else {
        console.warn("[SyncFiles] viewProviderInstance not available for refresh. TreeView might not update immediately.");
        // As a fallback, if direct refresh isn't possible, trigger the command.
        // This command itself calls refreshAndSyncConfig, ensure this path doesn't cause infinite loop.
        // The 'changed' flag above should prevent re-saving if config is already in sync.
        // However, to be safe, direct refresh is preferred.
        // await vscode.commands.executeCommand('syncfiles.refreshTreeView'); 
    }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Extension "SyncFiles" activated!');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) { vscode.window.showErrorMessage('SyncFiles: Please open a workspace first.'); return; }
    const workspacePath = workspaceFolders[0].uri.fsPath;

    // Initial sync when activating
    await refreshAndSyncConfig(workspacePath); 

    viewProviderInstance = new FetchVscodeRepoViewProvider(workspacePath); // Assign to global
    treeViewInstance = vscode.window.createTreeView('syncView', { treeDataProvider: viewProviderInstance });
    context.subscriptions.push(treeViewInstance);

    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.refreshTreeView', async () => {
        // This command is now the main entry point for a full sync and UI update
        await refreshAndSyncConfig(workspacePath); 
        // refreshAndSyncConfig does not directly refresh the view anymore,
        // so we ensure viewProviderInstance.refresh() is called here if viewProviderInstance is set.
        if (viewProviderInstance) {
            viewProviderInstance.refresh();
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.syncAll', async () => { try { await syncAllMappings(workspacePath); vscode.window.showInformationMessage('SyncFiles: Synchronization complete!'); } catch (e) { const msg = e instanceof Error ? e.message : String(e); console.error('SyncFiles Sync error:', e); vscode.window.showErrorMessage('SyncFiles: Synchronization failed: ' + msg); } }));
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.openSettings', () => registerSettingsWebview(context, workspacePath)));

    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.openScriptFile', async (item?: ScriptItemTreeItem | vscode.Uri) => {
        let uriToOpen: vscode.Uri | undefined;
        if (item instanceof ScriptItemTreeItem) uriToOpen = item.resourceUri;
        else if (item instanceof vscode.Uri) uriToOpen = item;
        else if (treeViewInstance?.selection[0] instanceof ScriptItemTreeItem) uriToOpen = (treeViewInstance.selection[0] as ScriptItemTreeItem).resourceUri;
        if (uriToOpen) { try { await vscode.commands.executeCommand('vscode.open', uriToOpen); } catch (e) { vscode.window.showErrorMessage(`Failed to open file: ${e instanceof Error ? e.message : String(e)}`); } }
        else vscode.window.showWarningMessage('SyncFiles: No script selected or URI provided to open.');
    }));

    const executeScriptSharedLogic = async (itemOrPath: ScriptItemTreeItem | string, executionType: 'api' | 'terminal') => {
        const pythonExecutableSetting = getPythonExecutablePath(workspacePath);
        if (!pythonExecutableSetting) { vscode.window.showErrorMessage('Python executable path not configured.'); return; }
        const resolvedPythonExecutable = normalizePath(ensureAbsolute(pythonExecutableSetting, workspacePath));

        let scriptPathForExecution: string;
        let scriptName: string;

        if (itemOrPath instanceof ScriptItemTreeItem) {
            scriptName = (itemOrPath.label as string) || path.basename(itemOrPath.scriptConfig.path);
            const pythonScriptDirSetting = getPythonScriptPath(workspacePath);
            const scriptDir = ensureAbsolute(pythonScriptDirSetting, workspacePath);
            scriptPathForExecution = normalizePath(path.resolve(scriptDir, itemOrPath.scriptConfig.path));
        } else if (typeof itemOrPath === 'string') {
            scriptPathForExecution = normalizePath(ensureAbsolute(itemOrPath, workspacePath));
            scriptName = path.basename(scriptPathForExecution);
        } else {
            vscode.window.showErrorMessage('Invalid item for script execution.'); return;
        }
        
        const unquotedExecutable = resolvedPythonExecutable.replace(/^"|"$/g, '');
        if (!fs.existsSync(unquotedExecutable)) {
            try {
                const { execFileSync } = require('child_process');
                execFileSync(unquotedExecutable, ['--version'], { timeout: 2000, stdio: 'ignore' });
            } catch (e) {
                vscode.window.showErrorMessage(`Python executable '${unquotedExecutable}' could not be verified. Error: ${e instanceof Error ? e.message : String(e)}`);
                return;
            }
        }
        if (!fs.existsSync(scriptPathForExecution)) {vscode.window.showErrorMessage(`Script file not found: ${scriptPathForExecution}`); return;}

        if (executionType === 'api') {
            try {
                await executePythonScript(workspacePath, resolvedPythonExecutable, scriptPathForExecution, [], { showNotifications: true, showErrorModal: true, successMessage: `Script '${scriptName}' (Background API) executed successfully.` });
            } catch (e) { /* executePythonScript handles errors */ }
        } else { // terminal
            const termName = `Run: ${scriptName}`;
            let terminal = vscode.window.terminals.find(t => t.name === termName);
            if (terminal) {
                const action = await vscode.window.showWarningMessage(`Terminal "${termName}" is active.`, { modal: true }, "Reuse Terminal", "Close and Create New");
                if (action === "Close and Create New") { terminal.dispose(); terminal = undefined; }
                else if (action !== "Reuse Terminal") return;
            }
            if (!terminal) {
                const env: { [key: string]: string | undefined } = { ...process.env };
                getEnvVars(workspacePath).forEach((v, k) => { env[k] = v; });
                terminal = vscode.window.createTerminal({ name: termName, env, cwd: workspacePath });
            }
            const quotedExec = resolvedPythonExecutable.includes(' ') && !resolvedPythonExecutable.startsWith('"') ? `"${resolvedPythonExecutable}"` : resolvedPythonExecutable;
            const quotedScript = scriptPathForExecution.includes(' ') && !scriptPathForExecution.startsWith('"') ? `"${scriptPathForExecution}"` : scriptPathForExecution;
            const command = `${quotedExec} ${quotedScript}`;
            terminal.sendText(command, true);
            terminal.show();
        }
    };

    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.runScriptVSCodeAPI', (itemOrPath) => executeScriptSharedLogic(itemOrPath, 'api')));
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.runScriptInTerminal', (item) => executeScriptSharedLogic(item, 'terminal')));
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.runScriptDefault', (item: ScriptItemTreeItem) => {
        if (!(item instanceof ScriptItemTreeItem)) { vscode.window.showErrorMessage('Invalid item for default run.'); return; }
        const mode = item.scriptConfig.executionMode || 'directTerminal';
        executeScriptSharedLogic(item, mode === 'directTerminal' ? 'terminal' : 'api');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.createScriptGroup', async () => { const n = await vscode.window.showInputBox({prompt:'Enter new script group name'}); if(n) {await addScriptGroupToConfig(workspacePath, {id:generateUUID(),name:n,scripts:[]}); await vscode.commands.executeCommand('syncfiles.refreshTreeView');} }));
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.renameScriptGroup', async (i:ScriptGroupTreeItem) => { if(!(i instanceof ScriptGroupTreeItem))return; const n=await vscode.window.showInputBox({value:i.groupConfig.name,prompt:'Enter new group name'}); if(n&&n!==i.groupConfig.name){await updateScriptGroupInConfig(workspacePath,{...i.groupConfig,name:n}); await vscode.commands.executeCommand('syncfiles.refreshTreeView');}}));
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.deleteScriptGroup', async (i:ScriptGroupTreeItem) => { 
        if(!(i instanceof ScriptGroupTreeItem))return; 
        if(i.groupConfig.id===DEFAULT_SCRIPT_GROUP_ID){
            const c=await vscode.window.showWarningMessage(`This will clear all scripts from the '${i.groupConfig.name}' group. They will become unassigned. Continue?`,{modal:true},"Clear Scripts"); 
            if(c==="Clear Scripts"){
                let cfg=readConfig(workspacePath);
                const g=cfg.scriptGroups.find(x=>x.id===DEFAULT_SCRIPT_GROUP_ID);
                if(g)g.scripts=[];
                await saveFullConfig(workspacePath,cfg);
            }
        } else {
            const c=await vscode.window.showWarningMessage(`Delete group "${i.groupConfig.name}"? Scripts inside will become unassigned.`,{modal:true},"Delete Group"); 
            if(c==="Delete Group") await removeScriptGroupAndSave(workspacePath,i.groupConfig.id);
        } 
        await vscode.commands.executeCommand('syncfiles.refreshTreeView');
    }));

    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.addScriptToGroup', async (targetItemOrContext:ScriptGroupTreeItem|any) => { 
        let targetGroupId:string; 
        if(targetItemOrContext instanceof ScriptGroupTreeItem) {
            targetGroupId=targetItemOrContext.groupConfig.id;
        } else {
            const groups=getScriptGroups(workspacePath).map(g=>({label:g.name,id:g.id,description:g.id===DEFAULT_SCRIPT_GROUP_ID?"(Default)":`(${(g.scripts||[]).length})`}));
            if(!groups.length){vscode.window.showInformationMessage("No groups exist.");return;}
            const chosenGroup=await vscode.window.showQuickPick(groups,{placeHolder:"Select group"});
            if(!chosenGroup)return;
            targetGroupId=chosenGroup.id;
        } 
        const pythonScriptDirSetting=getPythonScriptPath(workspacePath);
        if(!pythonScriptDirSetting){vscode.window.showErrorMessage("Python script path not set.");return;}
        const resolvedDir=ensureAbsolute(pythonScriptDirSetting,workspacePath);
        if(!fs.existsSync(resolvedDir)||!fs.statSync(resolvedDir).isDirectory()){vscode.window.showErrorMessage(`Script directory not found: ${resolvedDir}`);return;}
        
        const currentConfigForPaths = readConfig(workspacePath);
        const assigned=getAllAssignedScriptPaths(currentConfigForPaths);

        const available=fs.readdirSync(resolvedDir).filter(f=>f.toLowerCase().endsWith('.py')&&!fs.statSync(path.join(resolvedDir,f)).isDirectory()&&!assigned.has(f)).map(f=>({label:f,filePath:f}));
        if(!available.length){vscode.window.showInformationMessage("No new, unassigned scripts found to add.");return;}
        const picked=await vscode.window.showQuickPick(available,{placeHolder:"Select script"});
        if(!picked)return;
        const alias=await vscode.window.showInputBox({prompt:`Alias for "${picked.label}"?`});if(alias===undefined)return;
        const desc=await vscode.window.showInputBox({prompt:`Description for "${picked.label}"?`});if(desc===undefined)return;
        
        await addScriptToGroupAndSave(workspacePath,targetGroupId,{id:generateUUID(),path:picked.filePath,alias:alias||undefined,description:desc||undefined,executionMode:'directTerminal'});
        await vscode.commands.executeCommand('syncfiles.refreshTreeView');
    }));
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.editScriptDetails', async (i:ScriptItemTreeItem) => { if(!(i instanceof ScriptItemTreeItem))return;const o=i.scriptConfig;const na=await vscode.window.showInputBox({value:o.alias||'',prompt:'New alias'});if(na===undefined)return;const nd=await vscode.window.showInputBox({value:o.description||'',prompt:'New description'});if(nd===undefined)return;await updateScriptInGroupAndSave(workspacePath,i.parentGroupConfig.id,{...o,alias:na||undefined,description:nd||undefined});await vscode.commands.executeCommand('syncfiles.refreshTreeView');}));
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.setScriptExecutionMode', async (i:ScriptItemTreeItem) => { if(!(i instanceof ScriptItemTreeItem))return;const p=await vscode.window.showQuickPick([{label:"Run in Terminal",description:"Default for new scripts. Interactive output.",mode:'directTerminal'as const},{label:"Run with Background API",description:"Silent execution via VSCode API.",mode:'vscodeApi'as const}],{placeHolder:"Select execution method"});if(!p)return;await updateScriptInGroupAndSave(workspacePath,i.parentGroupConfig.id,{...i.scriptConfig,executionMode:p.mode});await vscode.commands.executeCommand('syncfiles.refreshTreeView');}));
    
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.removeScriptFromGroup', async (i:ScriptItemTreeItem) => { 
        if(!(i instanceof ScriptItemTreeItem))return;
        const c=await vscode.window.showWarningMessage(`Remove "${i.label}" from "${i.parentGroupConfig.name}"? Script will become unassigned.`,{modal:true},"Remove");
        if(c==="Remove"){
            let cfg=readConfig(workspacePath); 
            const g=cfg.scriptGroups.find(x=>x.id===i.parentGroupConfig.id); 
            if(g&&g.scripts)g.scripts=g.scripts.filter(s=>s.id!==i.scriptConfig.id); 
            await saveFullConfig(workspacePath,cfg); 
            await vscode.commands.executeCommand('syncfiles.refreshTreeView');
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.moveScriptToGroup', async (i:ScriptItemTreeItem) => { 
        if(!(i instanceof ScriptItemTreeItem))return;
        const s=i.scriptConfig;const sgid=i.parentGroupConfig.id;
        const ags=getScriptGroups(workspacePath).filter(g=>g.id!==sgid).map(g=>({label:g.name,id:g.id}));
        if(!ags.length){vscode.window.showInformationMessage("No other groups.");return;}
        const pg=await vscode.window.showQuickPick(ags,{placeHolder:"Select new group"});
        if(!pg)return;
        let cfg=readConfig(workspacePath);
        const og=cfg.scriptGroups.find(x=>x.id===sgid);
        const ng=cfg.scriptGroups.find(x=>x.id===pg.id);
        if(og&&ng){
            if(og.scripts)og.scripts=og.scripts.filter(x=>x.id!==s.id);
            if(!ng.scripts)ng.scripts=[];
            if(!ng.scripts.some(x=>x.path===s.path))ng.scripts.push(s);
            else vscode.window.showWarningMessage("Script path exists in target group.");
            await saveFullConfig(workspacePath,cfg);
            await vscode.commands.executeCommand('syncfiles.refreshTreeView');
        }
    }));

    const setScriptClickAction = async (action: 'doNothing' | 'openFile' | 'executeDefault') => {
        try {
            await vscode.workspace.getConfiguration('syncfiles.view').update('scriptClickAction', action, vscode.ConfigurationTarget.Workspace);
            vscode.window.showInformationMessage(`Script left-click action set to: '${action}'.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to set click action: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.setClickAction.doNothing', () => setScriptClickAction('doNothing')));
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.setClickAction.openFile', () => setScriptClickAction('openFile')));
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.setClickAction.executeDefault', () => setScriptClickAction('executeDefault')));

    startWatching(workspacePath, async () => { await vscode.commands.executeCommand('syncfiles.refreshTreeView'); });
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
        const affects = (key: string) => event.affectsConfiguration(`syncfiles.${key}`);
        if (affects('scripts.defaultGroupName') || affects('view.scriptClickAction') || affects('pythonScriptPath') || affects('pythonExecutablePath')) {
            console.log("[SyncFiles] Relevant configuration changed, triggering refresh and sync.");
            await vscode.commands.executeCommand('syncfiles.refreshTreeView'); // This will call refreshAndSyncConfig
        }
    }));
}

export function deactivate() {
    console.log('Extension "SyncFiles" deactivated.');
    stopWatching();
}