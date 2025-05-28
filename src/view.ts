// src/view.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getPythonScriptPath, getScriptGroups, ScriptGroupConfig, ScriptItemConfig, DEFAULT_SCRIPT_GROUP_ID } from './config';
import { ensureAbsolute } from './utils'; // 假设 utils.ts 中有 ensureAbsolute

export class ScriptGroupTreeItem extends vscode.TreeItem {
    constructor(
        public readonly groupConfig: ScriptGroupConfig
    ) {
        super(groupConfig.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = groupConfig.id;
        this.contextValue = 'scriptGroup'; // 用于 package.json 中的 when 条件
        this.iconPath = groupConfig.id === DEFAULT_SCRIPT_GROUP_ID ? new vscode.ThemeIcon('inbox') : new vscode.ThemeIcon('folder');
        const scriptCount = (groupConfig.scripts || []).length;
        this.tooltip = `分组: ${groupConfig.name}\nID: ${groupConfig.id}\n包含 ${scriptCount} 个脚本`;
        if (groupConfig.id === DEFAULT_SCRIPT_GROUP_ID) {
            this.description = `(${scriptCount} 个未分配脚本)`;
        } else {
            this.description = `(${scriptCount} 个脚本)`;
        }
    }
}

export class ScriptItemTreeItem extends vscode.TreeItem {
    public readonly parentGroupConfig: ScriptGroupConfig; // 添加 public 使其可访问

    constructor(
        public readonly scriptConfig: ScriptItemConfig,
        parentGroupConfig: ScriptGroupConfig, // 从构造函数参数中获取
        private readonly workspaceRoot: string,
        private readonly pythonScriptRootPathSetting: string // 这是从配置中读取的 pythonScriptPath
    ) {
        const baseName = path.basename(scriptConfig.path);
        const displayLabel = scriptConfig.alias || baseName.replace(/\.py$/i, '');
        super(displayLabel, vscode.TreeItemCollapsibleState.None);

        this.parentGroupConfig = parentGroupConfig; // 赋值
        this.id = scriptConfig.id;
        this.description = scriptConfig.alias ? baseName.replace(/\.py$/i, '') : (scriptConfig.description || '');

        // 解析脚本的绝对路径，用于 resourceUri 和可能的其他操作
        let resolvedBaseScriptPath: string;
        if (this.pythonScriptRootPathSetting && path.isAbsolute(this.pythonScriptRootPathSetting)) {
            resolvedBaseScriptPath = this.pythonScriptRootPathSetting;
        } else if (this.pythonScriptRootPathSetting) {
            resolvedBaseScriptPath = ensureAbsolute(this.pythonScriptRootPathSetting, this.workspaceRoot);
        } else {
            // 如果 pythonScriptRootPathSetting 未设置，则脚本路径被认为是相对于工作区根目录
            resolvedBaseScriptPath = this.workspaceRoot;
        }

        // scriptConfig.path 是相对于 pythonScriptRootPathSetting 的路径
        const absoluteScriptPathForUri = path.resolve(resolvedBaseScriptPath, this.scriptConfig.path);
        this.resourceUri = vscode.Uri.file(absoluteScriptPathForUri);

        this.contextValue = 'scriptItem'; // 用于 package.json 中的 when 条件

        // 根据配置设置点击行为
        const clickAction = vscode.workspace.getConfiguration('syncfiles.view').get<string>('scriptClickAction', 'doNothing');
        let tooltipClickAction = "";

        if (clickAction === 'openFile') {
            this.command = { command: 'syncfiles.openScriptFile', title: '打开脚本文件', arguments: [this] };
            this.iconPath = new vscode.ThemeIcon('file-code'); // 文件图标
            tooltipClickAction = "打开文件";
        } else if (clickAction === 'executeDefault') {
            this.command = { command: 'syncfiles.runScriptDefault', title: '运行脚本 (默认)', arguments: [this] };
            this.iconPath = new vscode.ThemeIcon('play-circle'); // 运行图标
            tooltipClickAction = "运行 (默认方式)";
        } else { // 'doNothing' 或其他未定义行为
            this.command = undefined; // 无默认点击命令
            this.iconPath = new vscode.ThemeIcon('file-script'); // 脚本文件图标
            tooltipClickAction = "无操作 (使用右键菜单)";
        }
        this.tooltip = `脚本: ${scriptConfig.path}\n` +
                       (scriptConfig.alias ? `别名: ${scriptConfig.alias}\n` : '') +
                       (scriptConfig.description ? `描述: ${scriptConfig.description}\n` : '') +
                       `ID: ${scriptConfig.id}\n` +
                       `左键单击: ${tooltipClickAction}`;
    }
}

export class FetchVscodeRepoViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private refreshTimeout: NodeJS.Timeout | null = null;

    constructor(private workspacePath: string) { }

    // --- 实现 getTreeItem 方法 ---
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        // 由于我们的 ScriptGroupTreeItem 和 ScriptItemTreeItem 已经配置好了所有 TreeItem 属性，
        // 直接返回元素本身即可。
        return element;
    }
    // ---------------------------

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (!this.workspacePath) {
            // vscode.window.showInformationMessage('SyncFiles: 请先打开一个工作区。');
            return Promise.resolve([]);
        }

        if (!element) {
            // 根级别：显示 "Actions" 和 "Scripts"
            const items: vscode.TreeItem[] = [];
            items.push(Object.assign(new vscode.TreeItem('Actions', vscode.TreeItemCollapsibleState.Expanded), {
                iconPath: new vscode.ThemeIcon('tools'),
                contextValue: 'actionsRoot'
            }));
            items.push(Object.assign(new vscode.TreeItem('Scripts', vscode.TreeItemCollapsibleState.Expanded), {
                iconPath: new vscode.ThemeIcon('checklist'), // 或者 'code', 'list-ordered'
                contextValue: 'scriptsRoot'
            }));
            return Promise.resolve(items);
        } else if (element.contextValue === 'actionsRoot') {
            const items: vscode.TreeItem[] = [];
            items.push(Object.assign(new vscode.TreeItem('Start Sync (所有映射)', vscode.TreeItemCollapsibleState.None), {
                command: { command: 'syncfiles.syncAll', title: 'Start Sync' },
                iconPath: new vscode.ThemeIcon('sync'),
                tooltip: "从所有配置的GitHub URL同步文件到本地路径"
            }));

            items.push(Object.assign(new vscode.TreeItem('Load Workflow (加载工作流)', vscode.TreeItemCollapsibleState.None), {
                command: { command: 'syncfiles.loadWorkflow', title: 'Load Workflow from URL' },
                iconPath: new vscode.ThemeIcon('cloud-download'), // 选择一个合适的图标
                tooltip: "从指定的URL下载YAML配置文件，并根据其内容设置项目和SyncFiles配置"
            }));

            items.push(Object.assign(new vscode.TreeItem('Refresh Tree View (刷新视图)', vscode.TreeItemCollapsibleState.None), {
                command: { command: 'syncfiles.refreshTreeView', title: 'Refresh Tree View' },
                iconPath: new vscode.ThemeIcon('refresh'),
                tooltip: "刷新此树状视图，重新加载脚本和配置"
            }));
            items.push(Object.assign(new vscode.TreeItem('Open Settings (打开设置)', vscode.TreeItemCollapsibleState.None), {
                command: { command: 'syncfiles.openSettings', title: 'Open Settings' },
                iconPath: new vscode.ThemeIcon('settings-gear'), // 使用 'gear' 或 'settings-gear'
                tooltip: "打开SyncFiles的图形化设置界面"
            }));
            return Promise.resolve(items);
        } else if (element.contextValue === 'scriptsRoot') {
            // "Scripts" 的子节点：脚本分组
            let scriptGroups = getScriptGroups(this.workspacePath);
            // 确保默认分组存在且排在最前面
            if (!scriptGroups.find(g => g.id === DEFAULT_SCRIPT_GROUP_ID)) {
                console.warn("[SyncFiles View] 默认分组 (Default Group) 未在配置中找到。可能需要刷新或重启。");
                // 可以在这里选择是否动态添加一个空的默认分组，但这通常应该由 config.ts 中的 synchronizeConfigWithFileSystem 处理
            }
            scriptGroups.sort((a, b) => {
                if (a.id === DEFAULT_SCRIPT_GROUP_ID) return -1; // 默认组总是在最前
                if (b.id === DEFAULT_SCRIPT_GROUP_ID) return 1;
                return a.name.localeCompare(b.name); // 其他按名称排序
            });
            return Promise.resolve(scriptGroups.map(group => new ScriptGroupTreeItem(group)));
        } else if (element instanceof ScriptGroupTreeItem) {
            // 脚本分组的子节点：该分组下的脚本项
            const groupConfig = element.groupConfig;
            const pythonScriptDirSetting = getPythonScriptPath(this.workspacePath); // 这是 syncfiles.json 中的 pythonScriptPath
            
            const scripts = (groupConfig.scripts || []);
            // 按别名或路径排序脚本
            scripts.sort((a, b) => {
                const nameA = a.alias || path.basename(a.path);
                const nameB = b.alias || path.basename(b.path);
                return nameA.localeCompare(nameB);
            });

            return Promise.resolve(
                scripts.map(scriptConfig => new ScriptItemTreeItem(scriptConfig, groupConfig, this.workspacePath, pythonScriptDirSetting))
            );
        }

        return Promise.resolve([]); // 默认返回空数组
    }

    refresh(): void {
        // 使用防抖动来避免过于频繁的刷新
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            this._onDidChangeTreeData.fire(); // 触发数据变化事件，让 VS Code 重新获取节点
            this.refreshTimeout = null;
            console.log('[SyncFiles ViewProvider] Tree view refreshed.');
        }, 250); // 250ms 的延迟
    }
}