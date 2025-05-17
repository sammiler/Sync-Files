import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getPythonScriptPath } from './config';

export class FetchVscodeRepoViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private workspacePath: string;
    private refreshTimeout: NodeJS.Timeout | null = null;

    constructor(workspacePath: string) {
        this.workspacePath = workspacePath;
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (!element) {
            const items: vscode.TreeItem[] = [];

            // Actions Node
            const actionsNode = new vscode.TreeItem('Actions', vscode.TreeItemCollapsibleState.Expanded);
            actionsNode.iconPath = new vscode.ThemeIcon('tools');
            items.push(actionsNode);

            // Scripts Node
            const scriptsNode = new vscode.TreeItem('Scripts', vscode.TreeItemCollapsibleState.Expanded);
            scriptsNode.iconPath = new vscode.ThemeIcon('file-code');
            items.push(scriptsNode);

            return Promise.resolve(items);
        } else if (element.label === 'Actions') {
            const items: vscode.TreeItem[] = [];

            // Sync Button
            const syncButton = new vscode.TreeItem('Start Sync', vscode.TreeItemCollapsibleState.None);
            syncButton.command = { command: 'vscode.sync', title: 'Start Sync' };
            syncButton.iconPath = new vscode.ThemeIcon('sync');
            items.push(syncButton);

            // Refresh Button
            const refreshButton = new vscode.TreeItem('Refresh Scripts', vscode.TreeItemCollapsibleState.None);
            refreshButton.command = { command: 'vscode.refreshScripts', title: 'Refresh Scripts' };
            refreshButton.iconPath = new vscode.ThemeIcon('refresh');
            items.push(refreshButton);

            // Settings Button
            const settingsButton = new vscode.TreeItem('Open Settings', vscode.TreeItemCollapsibleState.None);
            settingsButton.command = { command: 'vscode.openSettings', title: 'Open Settings' };
            settingsButton.iconPath = new vscode.ThemeIcon('gear');
            items.push(settingsButton);

            return Promise.resolve(items);
        } else if (element.label === 'Scripts') {
            const items: vscode.TreeItem[] = [];
            const scriptPath = getPythonScriptPath(this.workspacePath);
            if (scriptPath) {
                const fullPath = path.resolve(this.workspacePath, scriptPath);
                if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
                    try {
                        const scripts = fs.readdirSync(fullPath)
                            .filter(f => f.toLowerCase().endsWith('.py'))
                            .sort();
                        console.log('Scripts loaded:', scripts);
                        scripts.forEach(script => {
                            const scriptItem = new vscode.TreeItem(script.replace(/\.py$/i, ''), vscode.TreeItemCollapsibleState.None);
                            scriptItem.command = {
                                command: 'vscode.runScript',
                                title: 'Run Script',
                                arguments: [path.join(scriptPath, script)]
                            };
                            scriptItem.iconPath = new vscode.ThemeIcon('play');
                            items.push(scriptItem);
                        });
                    } catch (err) {
                        console.error(`Failed to read scripts from ${fullPath}:`, err);
                    }
                }
            }
            return Promise.resolve(items);
        }
        return Promise.resolve([]);
    }

    refresh(): void {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }
        this.refreshTimeout = setTimeout(() => {
            console.log('Tree view refreshing');
            this._onDidChangeTreeData.fire();
            this.refreshTimeout = null;
        }, 100);
    }
}