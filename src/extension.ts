// src/extension.ts
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml'; // For parsing YAML
import * as https from 'https';   // For downloading YAML file
// At the top of src/extension.ts
import { generateAndSaveTasksJson } from './tasksGenerator'; // Adjust path if you place it elsewhere
import { FetchVscodeRepoViewProvider, ScriptGroupTreeItem, ScriptItemTreeItem } from './view';
import { syncAllMappings, fetchDirectory } from './sync';
import { startWatching, stopWatching } from './watcher';
import { registerSettingsWebview } from './ui';
import { executePythonScript } from './python';
import {
    getPythonExecutablePath, getPythonScriptPath, getScriptGroups,
    addScriptGroup as addScriptGroupToConfig,
    updateScriptGroup as updateScriptGroupInConfig,
    removeScriptGroupAndSave,
    addScriptToGroupAndSave,
    updateScriptInGroupAndSave,
    ScriptGroupConfig, ScriptItemConfig,
    Config, getAllAssignedScriptPaths,
    getEnvVars,
    Mapping, EnvVar, WatchEntry,
    getMappings, getWatchEntries,
    saveCoreSettings,
    readConfig,
    saveFullConfig,
    DEFAULT_SCRIPT_GROUP_ID,
    synchronizeConfigWithFileSystem,
    getConfigFilePath // Make sure this is exported and imported
} from './config';
import { generateUUID, normalizePath, ensureAbsolute } from './utils';

let treeViewInstance: vscode.TreeView<vscode.TreeItem> | undefined;
let viewProviderInstance: FetchVscodeRepoViewProvider | undefined;

// --- Interfaces for Load Workflow ---
interface WorkflowPlatformConfig {
    sourceUrl?: string;
    targetDir?: string;
    mappings?: Mapping[];
    envVariables?: Record<string, string>;
    pythonScriptPath?: string;
    pythonExecutablePath?: string;
    watchEntries?: WatchEntry[];
}

interface WorkflowRootConfig {
    platforms: {
        windows?: WorkflowPlatformConfig;
        linux?: WorkflowPlatformConfig;
        macos?: WorkflowPlatformConfig;
    };
}

// --- Helper Functions for Load Workflow ---
function getCurrentPlatformKey(): 'windows' | 'linux' | 'macos' | undefined {
    switch (process.platform) {
        case 'win32': return 'windows';
        case 'linux': return 'linux';
        case 'darwin': return 'macos';
        default: return undefined;
    }
}

async function fetchYamlContent(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { headers: { 'User-Agent': 'VSCode-SyncFiles-Extension/1.0' } }, (response) => {
            let data = '';
            if (response.statusCode === 301 || response.statusCode === 302) {
                if (response.headers.location) {
                    fetchYamlContent(response.headers.location).then(resolve).catch(reject);
                    return;
                } else {
                    return reject(new Error(`YAML fetch redirect from ${url} has no location header.`));
                }
            }
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to fetch YAML from ${url}. Status: ${response.statusCode} ${response.statusMessage}`));
            }
            response.setEncoding('utf8');
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => resolve(data));
        });
        request.on('error', (err) => reject(new Error(`Error fetching YAML from ${url}: ${err.message}`)));
        request.end();
    });
}

async function refreshAndSyncConfig(workspacePath: string): Promise<void> {
    let currentConfig = readConfig(workspacePath);
    const changed = synchronizeConfigWithFileSystem(currentConfig, workspacePath);
    if (changed) {
        await saveFullConfig(workspacePath, currentConfig);
    }
    if (viewProviderInstance) {
        viewProviderInstance.refresh();
    }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Extension "SyncFiles" activated!');
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('SyncFiles: Please open a workspace first.');
        return;
    }
    const workspacePath = workspaceFolders[0].uri.fsPath;

    await refreshAndSyncConfig(workspacePath);

    viewProviderInstance = new FetchVscodeRepoViewProvider(workspacePath);
    treeViewInstance = vscode.window.createTreeView('syncView', { treeDataProvider: viewProviderInstance });
    context.subscriptions.push(treeViewInstance);

    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.refreshTreeView', async () => {
        await refreshAndSyncConfig(workspacePath);
        if (viewProviderInstance) { // Ensure view provider refreshes if config was already in sync
            viewProviderInstance.refresh();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.syncAll', async () => {
        try {
            await syncAllMappings(workspacePath);
            vscode.window.showInformationMessage('SyncFiles: Synchronization complete!');
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            vscode.window.showErrorMessage('SyncFiles: Synchronization failed: ' + msg);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.openSettings', () => {
        registerSettingsWebview(context, workspacePath);
    }));

    // --- "Load Workflow" Command Implementation ---
    context.subscriptions.push(vscode.commands.registerCommand('syncfiles.loadWorkflow', async () => {
        if (!workspacePath) {
            vscode.window.showErrorMessage('Please open a workspace first to load a workflow.');
            return;
        }

        const defaultWorkflowUrl = "https://raw.githubusercontent.com/sammiler/CodeConf/refs/heads/main/Cpp/SyncFiles/VSCode/workflow.yaml";
        const yamlUrl = await vscode.window.showInputBox({
            title: "Load Workflow Configuration (YAML)",
            prompt: "输入工作流 YAML 文件 URL。此操作会下载文件并用 YAML 中的设置更新 SyncFiles 配置。",
            value: defaultWorkflowUrl,
            ignoreFocusOut: true
        });

        if (!yamlUrl) {
            vscode.window.showInformationMessage('Load Workflow 已取消。');
            return;
        }

        const confirmation = await vscode.window.showWarningMessage(
            `加载此工作流 (${path.basename(yamlUrl)}) 将执行以下操作：\n` +
            `1. 如果 YAML 中定义了 'sourceUrl' 和 'targetDir'，将下载或覆盖这些文件/目录。\n` +
            `2. 使用 YAML 中的值更新 SyncFiles 的 Python路径、环境变量和监控条目设置。\n` +
            `3. 脚本列表和分组将根据新的脚本路径设置自动刷新。\n\n` +
            `您当前的 SyncFiles 配置文件 (syncfiles.json) 将被备份为 syncfiles.json.bak。\n` +
            `是否继续加载？`,
            { modal: true },
            "继续加载",
            "取消"
        );

        if (confirmation !== "继续加载") {
            vscode.window.showInformationMessage('Load Workflow 已取消。');
            return;
        }

        const configFilePath = getConfigFilePath(workspacePath);
        const backupConfigPath = configFilePath + '.bak';

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: '正在加载工作流',
            cancellable: false
        }, async (progress) => {
            try {
                if (fs.existsSync(configFilePath)) {
                    fs.copyFileSync(configFilePath, backupConfigPath);
                    progress.report({ message: '当前配置已备份到 syncfiles.json.bak' });
                }

                progress.report({ message: '正在获取工作流配置...' });
                const yamlContent = await fetchYamlContent(yamlUrl);

                progress.report({ message: '正在解析 YAML 配置...' });
                const workflowConfigRoot = yaml.load(yamlContent) as WorkflowRootConfig;

                if (!workflowConfigRoot || typeof workflowConfigRoot !== 'object' || !workflowConfigRoot.platforms) {
                    throw new Error('无效的 YAML 结构："platforms" 键缺失或 YAML 不是一个对象。');
                }

                const platformKey = getCurrentPlatformKey();
                if (!platformKey) {
                    throw new Error('不支持的操作系统，无法确定工作流平台。');
                }

                const platformYamlConfig = workflowConfigRoot.platforms[platformKey];
                if (!platformYamlConfig) {
                    throw new Error(`在工作流 YAML 中未找到当前平台 ("${platformKey}") 的配置。`);
                }

                if (platformYamlConfig.sourceUrl && platformYamlConfig.targetDir) {
                    progress.report({ message: `正在从 ${platformYamlConfig.sourceUrl} 下载文件...` });
                    const absoluteTargetDir = ensureAbsolute(platformYamlConfig.targetDir, workspacePath);
                    const parentOfTargetDir = path.dirname(absoluteTargetDir);
                    if (!fs.existsSync(parentOfTargetDir)) {
                         fs.mkdirSync(parentOfTargetDir, { recursive: true });
                    }
                    if (!fs.existsSync(absoluteTargetDir)) {
                        fs.mkdirSync(absoluteTargetDir, { recursive: true });
                    }
                    await fetchDirectory(platformYamlConfig.sourceUrl, absoluteTargetDir, workspacePath);
                    vscode.window.showInformationMessage(`文件已从 ${platformYamlConfig.sourceUrl} 下载到 ${platformYamlConfig.targetDir}`);
                }

                progress.report({ message: '正在更新本地 SyncFiles 配置...' });

                const currentDiskConfig = readConfig(workspacePath);
                const mappingsToSave: Mapping[] = platformYamlConfig.mappings !== undefined
                    ? platformYamlConfig.mappings  // 如果 YAML 中定义了 mappings，则使用它
                    : currentDiskConfig.mappings; 

                const envVarsMap = new Map<string, string>();
                (currentDiskConfig.envVars || []).forEach(ev => envVarsMap.set(ev.key, ev.value));

                if (platformYamlConfig.envVariables) {
                    for (const key in platformYamlConfig.envVariables) {
                        if (Object.prototype.hasOwnProperty.call(platformYamlConfig.envVariables, key)) {
                            let value = platformYamlConfig.envVariables[key];
                            if (key === 'PROJECT_DIR' && (value === '.' || value === './' || value === '.\\')) {
                                value = ensureAbsolute('', workspacePath);
                            }
                            envVarsMap.set(key, value);
                        }
                    }
                }

                const pythonScriptPathToSave = platformYamlConfig.pythonScriptPath !== undefined
                    ? platformYamlConfig.pythonScriptPath
                    : currentDiskConfig.pythonScriptPath;
                const pythonExecutablePathToSave = platformYamlConfig.pythonExecutablePath !== undefined
                    ? platformYamlConfig.pythonExecutablePath
                    : currentDiskConfig.pythonExecutablePath;
                const watchEntriesToSave = platformYamlConfig.watchEntries !== undefined
                    ? platformYamlConfig.watchEntries
                    : currentDiskConfig.watchEntries;

                await saveCoreSettings(
                    workspacePath,
                    mappingsToSave,
                    envVarsMap,
                    pythonScriptPathToSave,
                    pythonExecutablePathToSave,
                    watchEntriesToSave
                );
            await vscode.commands.executeCommand('syncfiles.refreshTreeView');
            // Generate tasks.json using the now-updated configuration
            progress.report({ message: '正在生成 tasks.json...' });
            await generateAndSaveTasksJson(workspacePath); // Call the new function

            progress.report({ message: '工作流加载完成，配置已更新，tasks.json 已生成！' });
            vscode.window.showInformationMessage('工作流加载成功！配置已更新，tasks.json 已生成。旧文件已备份。');

                progress.report({ message: '工作流加载完成，配置已更新！' });
                vscode.window.showInformationMessage('工作流加载成功！配置已更新，旧配置已备份。');

                await vscode.commands.executeCommand('syncfiles.refreshTreeView');

            } catch (error: any) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`加载工作流失败: ${errorMessage}`);
                if (fs.existsSync(backupConfigPath)) {
                    vscode.window.showInformationMessage(`您可以从备份文件 ${path.basename(backupConfigPath)} 恢复之前的配置。`);
                }
            }
        });
    }));

    // --- Other Command Registrations (Script Management, UI, etc.) ---
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
            const pythonScriptDirSetting = getPythonScriptPath(workspacePath); // This is from syncfiles.json
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
            } catch (e) { /* executePythonScript handles errors by throwing */ }
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
                // getEnvVars from config.ts returns a Map
                (await getEnvVars(workspacePath)).forEach((v, k) => { env[k] = v; });
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

    startWatching(workspacePath, async () => {
        await vscode.commands.executeCommand('syncfiles.refreshTreeView');
    },context);

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async event => {
        const affects = (key: string) => event.affectsConfiguration(`syncfiles.${key}`);
        // Check for VS Code level settings that might affect the extension's behavior
        if (affects('scripts.defaultGroupName') || affects('view.scriptClickAction')) {
            await vscode.commands.executeCommand('syncfiles.refreshTreeView');
        }
        // Note: Changes directly to syncfiles.json are handled by the watcher in watcher.ts
    }));
}

export function deactivate() {
    console.log('Extension "SyncFiles" deactivated.');
    stopWatching();
}