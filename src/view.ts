import * as vscode from 'vscode';
import fs from 'fs';
import * as path from 'path';
import { getPythonScriptPath, getScriptGroups, ScriptGroupConfig, ScriptItemConfig } from './config'; // Added ScriptGroupConfig, ScriptItemConfig

// Define custom TreeItem types
export class ScriptGroupTreeItem extends vscode.TreeItem {
    constructor(
        public readonly groupConfig: ScriptGroupConfig
    ) {
        super(groupConfig.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = groupConfig.id;
        this.contextValue = 'scriptGroup';
        this.iconPath = new vscode.ThemeIcon('folder');
        this.tooltip = `Group: ${groupConfig.name}`;
    }
}

export class ScriptItemTreeItem extends vscode.TreeItem {
    constructor(
        public readonly scriptConfig: ScriptItemConfig,
        public readonly parentGroupConfig: ScriptGroupConfig | null, // null if ungrouped or directly under "Scripts"
        private readonly workspaceRoot: string,
        private readonly pythonScriptRootPath: string // Relative path from workspace root to python scripts folder
    ) {
        const baseName = path.basename(scriptConfig.path);
        const displayLabel = scriptConfig.alias || baseName.replace(/\.py$/i, '');
        super(displayLabel, vscode.TreeItemCollapsibleState.None);

        this.id = scriptConfig.id;
        this.description = scriptConfig.alias ? baseName.replace(/\.py$/i, '') : scriptConfig.description;
        this.tooltip = `${scriptConfig.path}${scriptConfig.description ? `\n${scriptConfig.description}` : ''}`;
        
        const absoluteScriptPath = path.join(this.workspaceRoot, this.pythonScriptRootPath, scriptConfig.path);
        this.resourceUri = vscode.Uri.file(absoluteScriptPath);

        this.contextValue = 'scriptItem';
        this.iconPath = new vscode.ThemeIcon('file-code'); // Python icon: new vscode.ThemeIcon('python')

        // Command to open the script file when the item is clicked
        this.command = {
            command: 'vscode.open',
            title: 'Open Script',
            arguments: [this.resourceUri]
        };
    }
}

// Represents an ungrouped script file
export class UngroupedScriptFileTreeItem extends vscode.TreeItem {
    constructor(
        public readonly scriptPath: string, // Relative path from pythonScriptPath
        private readonly workspaceRoot: string,
        private readonly pythonScriptRootPath: string
    ) {
        const baseName = path.basename(scriptPath);
        super(baseName.replace(/\.py$/i, ''), vscode.TreeItemCollapsibleState.None);
        
        const absoluteScriptPath = path.join(this.workspaceRoot, this.pythonScriptRootPath, scriptPath);
        this.resourceUri = vscode.Uri.file(absoluteScriptPath);
        this.tooltip = `Ungrouped: ${scriptPath}`;
        this.contextValue = 'ungroupedScriptItem'; // For context menu to add to group
        this.iconPath = new vscode.ThemeIcon('file-text');
        this.command = {
            command: 'vscode.open',
            title: 'Open Script',
            arguments: [this.resourceUri]
        };
    }
}


export class FetchVscodeRepoViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    
    private refreshTimeout: NodeJS.Timeout | null = null;

    constructor(private workspacePath: string) {}

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (!this.workspacePath) {
            vscode.window.showInformationMessage('No workspace open.');
            return Promise.resolve([]);
        }

        if (!element) { // Root nodes
            const items: vscode.TreeItem[] = [];
            const actionsNode = new vscode.TreeItem('Actions', vscode.TreeItemCollapsibleState.Expanded);
            actionsNode.iconPath = new vscode.ThemeIcon('tools');
            actionsNode.contextValue = 'actionsRoot'; // For potential context menu on the category itself
            items.push(actionsNode);

            const scriptsNode = new vscode.TreeItem('Scripts', vscode.TreeItemCollapsibleState.Expanded);
            scriptsNode.iconPath = new vscode.ThemeIcon('code'); // Using 'code' for a more generic script icon
            scriptsNode.contextValue = 'scriptsRoot'; // For "Create New Group" context menu
            items.push(scriptsNode);
            
            return Promise.resolve(items);

        } else if (element.contextValue === 'actionsRoot' || element.label === 'Actions') { // Children of "Actions"
            const items: vscode.TreeItem[] = [];
            const syncButton = new vscode.TreeItem('Start Sync', vscode.TreeItemCollapsibleState.None);
            syncButton.command = { command: 'syncfiles.syncAll', title: 'Start Sync' }; // Ensure command name matches
            syncButton.iconPath = new vscode.ThemeIcon('sync');
            items.push(syncButton);

            const refreshButton = new vscode.TreeItem('Refresh Tree View', vscode.TreeItemCollapsibleState.None);
            refreshButton.command = { command: 'syncfiles.refreshTreeView', title: 'Refresh Tree View' };
            refreshButton.iconPath = new vscode.ThemeIcon('refresh');
            items.push(refreshButton);

            const settingsButton = new vscode.TreeItem('Open Settings', vscode.TreeItemCollapsibleState.None);
            settingsButton.command = { command: 'syncfiles.openSettings', title: 'Open Settings' };
            settingsButton.iconPath = new vscode.ThemeIcon('gear');
            items.push(settingsButton);
            return Promise.resolve(items);

        } else if (element.contextValue === 'scriptsRoot' || element.label === 'Scripts') { // Children of "Scripts" -> Groups and Ungrouped
            const scriptGroups = getScriptGroups(this.workspacePath);
            const groupItems = scriptGroups.map(group => new ScriptGroupTreeItem(group));
            
            // Handle Ungrouped Scripts
            const pythonScriptDir = getPythonScriptPath(this.workspacePath);
            let ungroupedItems: UngroupedScriptFileTreeItem[] = [];
            if (pythonScriptDir) {
                const fullScriptPath = path.resolve(this.workspacePath, pythonScriptDir);
                if (fs.existsSync(fullScriptPath) && fs.statSync(fullScriptPath).isDirectory()) {
                    const assignedPaths = new Set<string>();
                    scriptGroups.forEach(g => g.scripts.forEach(s => assignedPaths.add(s.path)));
                    
                    const allPyFiles = fs.readdirSync(fullScriptPath)
                        .filter(file => file.toLowerCase().endsWith('.py') && !fs.statSync(path.join(fullScriptPath, file)).isDirectory());
                    
                    ungroupedItems = allPyFiles
                        .filter(file => !assignedPaths.has(file)) // Show only those not in any group
                        .map(file => new UngroupedScriptFileTreeItem(file, this.workspacePath, pythonScriptDir));
                }
            }

            if (ungroupedItems.length > 0) {
                const ungroupedCategory = new vscode.TreeItem('Ungrouped Scripts', vscode.TreeItemCollapsibleState.Collapsed);
                ungroupedCategory.contextValue = 'ungroupedScriptsCategory';
                ungroupedCategory.iconPath = new vscode.ThemeIcon('files');
                // To get children of Ungrouped Scripts, the element will be this category item
                return Promise.resolve([...groupItems, ungroupedCategory]);
            }
            
            return Promise.resolve(groupItems);

        } else if (element instanceof ScriptGroupTreeItem) { // Children of a Script Group
            const groupConfig = (element as ScriptGroupTreeItem).groupConfig;
            const pythonScriptDir = getPythonScriptPath(this.workspacePath);
            return Promise.resolve(
                groupConfig.scripts.map(scriptConfig => 
                    new ScriptItemTreeItem(scriptConfig, groupConfig, this.workspacePath, pythonScriptDir)
                )
            );
        } else if (element.contextValue === 'ungroupedScriptsCategory') { // Children of "Ungrouped Scripts" category
            const pythonScriptDir = getPythonScriptPath(this.workspacePath);
            if (pythonScriptDir) {
                const fullScriptPath = path.resolve(this.workspacePath, pythonScriptDir);
                if (fs.existsSync(fullScriptPath) && fs.statSync(fullScriptPath).isDirectory()) {
                    const scriptGroups = getScriptGroups(this.workspacePath);
                    const assignedPaths = new Set<string>();
                    scriptGroups.forEach(g => g.scripts.forEach(s => assignedPaths.add(s.path)));
                    
                    const allPyFiles = fs.readdirSync(fullScriptPath)
                        .filter(file => file.toLowerCase().endsWith('.py') && !fs.statSync(path.join(fullScriptPath, file)).isDirectory());
                    
                    const ungroupedItems = allPyFiles
                        .filter(file => !assignedPaths.has(file))
                        .map(file => new UngroupedScriptFileTreeItem(file, this.workspacePath, pythonScriptDir));
                    return Promise.resolve(ungroupedItems);
                }
            }
            return Promise.resolve([]);
        }


        return Promise.resolve([]);
    }

    refresh(): void {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        // Debounce refresh
        this.refreshTimeout = setTimeout(() => {
            console.log('[SyncFiles] Tree view refreshing');
            this._onDidChangeTreeData.fire();
            this.refreshTimeout = null;
        }, 100); 
    }
}