import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getPythonScriptPath, getScriptGroups, ScriptGroupConfig, ScriptItemConfig, DEFAULT_SCRIPT_GROUP_ID } from './config';

export class ScriptGroupTreeItem extends vscode.TreeItem {
    constructor(
        public readonly groupConfig: ScriptGroupConfig
    ) {
        super(groupConfig.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = groupConfig.id;
        this.contextValue = 'scriptGroup';
        this.iconPath = groupConfig.id === DEFAULT_SCRIPT_GROUP_ID ? new vscode.ThemeIcon('inbox') : new vscode.ThemeIcon('folder');
        const scriptCount = (groupConfig.scripts || []).length;
        this.tooltip = `Group: ${groupConfig.name} (${scriptCount} script${scriptCount === 1 ? '' : 's'})`;
        if (groupConfig.id === DEFAULT_SCRIPT_GROUP_ID) this.description = `(${scriptCount} unassigned)`;
        else this.description = `(${scriptCount} script${scriptCount === 1 ? '' : 's'})`;
    }
}

export class ScriptItemTreeItem extends vscode.TreeItem {
    constructor(
        public readonly scriptConfig: ScriptItemConfig,
        public readonly parentGroupConfig: ScriptGroupConfig,
        private readonly workspaceRoot: string,
        private readonly pythonScriptRootPathSetting: string
    ) {
        const baseName = path.basename(scriptConfig.path);
        const displayLabel = scriptConfig.alias || baseName.replace(/\.py$/i, '');
        super(displayLabel, vscode.TreeItemCollapsibleState.None);
        this.id = scriptConfig.id;
        this.description = scriptConfig.alias ? baseName.replace(/\.py$/i, '') : (scriptConfig.description || '');

        let resolvedBaseScriptPath: string;
        if (path.isAbsolute(this.pythonScriptRootPathSetting)) resolvedBaseScriptPath = this.pythonScriptRootPathSetting;
        else if (this.pythonScriptRootPathSetting) resolvedBaseScriptPath = path.join(this.workspaceRoot, this.pythonScriptRootPathSetting);
        else resolvedBaseScriptPath = this.workspaceRoot;

        const absoluteScriptPathForUri = path.resolve(resolvedBaseScriptPath, this.scriptConfig.path);
        this.resourceUri = vscode.Uri.file(absoluteScriptPathForUri);
        this.contextValue = 'scriptItem';

        const clickAction = vscode.workspace.getConfiguration('syncfiles.view').get<string>('scriptClickAction', 'doNothing');
        let tooltipClickAction = "";

        if (clickAction === 'openFile') {
            this.command = { command: 'syncfiles.openScriptFile', title: 'Open Script File', arguments: [this] };
            this.iconPath = new vscode.ThemeIcon('file-code');
            tooltipClickAction = "open file";
        } else if (clickAction === 'executeDefault') {
            this.command = { command: 'syncfiles.runScriptDefault', title: 'Run Script (Default)', arguments: [this] };
            this.iconPath = new vscode.ThemeIcon('play-circle');
            tooltipClickAction = "run (default method)";
        } else { // doNothing
            this.command = undefined;
            this.iconPath = new vscode.ThemeIcon('file-code');
            tooltipClickAction = "do nothing (use context menu)";
        }
        this.tooltip = `${scriptConfig.path}${scriptConfig.description ? `\nDescription: ${scriptConfig.description}` : ''}\nLeft-Click: ${tooltipClickAction}`;
    }
}

export class FetchVscodeRepoViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private refreshTimeout: NodeJS.Timeout | null = null;
    constructor(private workspacePath: string) { }
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (!this.workspacePath) { vscode.window.showInformationMessage('SyncFiles: No workspace open.'); return Promise.resolve([]); }
        if (!element) {
            const items: vscode.TreeItem[] = [];
            items.push(Object.assign(new vscode.TreeItem('Actions', vscode.TreeItemCollapsibleState.Expanded), { iconPath: new vscode.ThemeIcon('tools'), contextValue: 'actionsRoot' }));
            items.push(Object.assign(new vscode.TreeItem('Scripts', vscode.TreeItemCollapsibleState.Expanded), { iconPath: new vscode.ThemeIcon('code'), contextValue: 'scriptsRoot' }));
            return Promise.resolve(items);
        } else if (element.contextValue === 'actionsRoot') {
            const items: vscode.TreeItem[] = [];
            items.push(Object.assign(new vscode.TreeItem('Start Sync', vscode.TreeItemCollapsibleState.None), { command: { command: 'syncfiles.syncAll', title: 'Start Sync' }, iconPath: new vscode.ThemeIcon('sync') }));
            items.push(Object.assign(new vscode.TreeItem('Refresh Tree View', vscode.TreeItemCollapsibleState.None), { command: { command: 'syncfiles.refreshTreeView', title: 'Refresh Tree View' }, iconPath: new vscode.ThemeIcon('refresh') }));
            items.push(Object.assign(new vscode.TreeItem('Open Settings', vscode.TreeItemCollapsibleState.None), { command: { command: 'syncfiles.openSettings', title: 'Open Settings' }, iconPath: new vscode.ThemeIcon('gear') }));
            return Promise.resolve(items);
        } else if (element.contextValue === 'scriptsRoot') {
            let scriptGroups = getScriptGroups(this.workspacePath);
            if (!scriptGroups.find(g => g.id === DEFAULT_SCRIPT_GROUP_ID)) console.warn("[SyncFiles View] Default group missing. Refresh or restart may be needed.");
            scriptGroups.sort((a, b) => { if (a.id === DEFAULT_SCRIPT_GROUP_ID) return -1; if (b.id === DEFAULT_SCRIPT_GROUP_ID) return 1; return a.name.localeCompare(b.name); });
            return Promise.resolve(scriptGroups.map(group => new ScriptGroupTreeItem(group)));
        } else if (element instanceof ScriptGroupTreeItem) {
            const groupConfig = element.groupConfig;
            const pythonScriptDirSetting = getPythonScriptPath(this.workspacePath);
            return Promise.resolve((groupConfig.scripts || []).slice().sort((a, b) => (a.alias || path.basename(a.path)).localeCompare(b.alias || path.basename(b.path))).map(scriptConfig => new ScriptItemTreeItem(scriptConfig, groupConfig, this.workspacePath, pythonScriptDirSetting)));
        }
        return Promise.resolve([]);
    }
    refresh(): void {
        if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
        this.refreshTimeout = setTimeout(() => { this._onDidChangeTreeData.fire(); this.refreshTimeout = null; console.log('[SyncFiles] Tree view refreshed.'); }, 250);
    }
}