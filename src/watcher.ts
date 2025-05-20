import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getPythonScriptPath, getWatchEntries, getPythonExecutablePath, WatchEntry } from './config'; // Import new config items
import { executePythonScript } from './python'; // Import for executing scripts

// Store all watchers (script dir watcher and custom path watchers)
// Key can be 'scriptDirWatcher' or the watchedPath for deletion watchers
const activeWatchers: Map<string, vscode.FileSystemWatcher> = new Map();

// Helper to add a watcher and store it
function addWatcherInstance(key: string, watcher: vscode.FileSystemWatcher) {
    if (activeWatchers.has(key)) {
        activeWatchers.get(key)?.dispose();
    }
    activeWatchers.set(key, watcher);
}

export function startWatching(workspacePath: string, onTreeRefreshNeeded: () => void): void {
    stopWatching(); // Clear existing watchers before starting new ones

    // 1. Watch Python Scripts Directory for Tree View updates
    const treeViewScriptDirPath = getPythonScriptPath(workspacePath);
    if (treeViewScriptDirPath) {
        const absoluteTreeViewScriptDirPath = path.resolve(workspacePath, treeViewScriptDirPath);
        if (fs.existsSync(absoluteTreeViewScriptDirPath) && fs.statSync(absoluteTreeViewScriptDirPath).isDirectory()) {
            const scriptDirWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(absoluteTreeViewScriptDirPath, '**/*.py')
            );
            const onChangeHandler = () => {
                console.log(`Change detected in Python script directory: ${absoluteTreeViewScriptDirPath}`);
                onTreeRefreshNeeded();
            };
            scriptDirWatcher.onDidChange(onChangeHandler);
            scriptDirWatcher.onDidCreate(onChangeHandler);
            scriptDirWatcher.onDidDelete(onChangeHandler);
            addWatcherInstance('treeViewScriptsDirWatcher', scriptDirWatcher);
            console.log(`Watching script directory for tree view: ${absoluteTreeViewScriptDirPath}`);
        } else {
            console.log(`Script directory for tree view does not exist or is not a directory: ${absoluteTreeViewScriptDirPath}`);
        }
    } else {
        console.log('No Python script directory configured for tree view watching.');
    }

    // 2. Watch specific paths for deletion events
    const watchEntries = getWatchEntries(workspacePath);
    const pythonExecutable = getPythonExecutablePath(workspacePath);

    if (!pythonExecutable) {
        console.warn('Python executable path not configured. Deletion watchers that trigger Python scripts will not function.');
    }

    watchEntries.forEach((entry: WatchEntry) => {
        const absoluteWatchedPath = path.resolve(workspacePath, entry.watchedPath);
        const absoluteOnDeleteScriptPath = path.resolve(workspacePath, entry.onDeleteScript);

        if (!fs.existsSync(absoluteWatchedPath)) {
            console.warn(`Watched path does not exist, cannot watch: ${absoluteWatchedPath}`);
            return;
        }
        if (!pythonExecutable && entry.onDeleteScript) {
            console.warn(`Cannot run script for ${absoluteWatchedPath} on delete: Python executable not set.`);
            return;
        }
        if (entry.onDeleteScript && !fs.existsSync(absoluteOnDeleteScriptPath)) {
            console.warn(`onDeleteScript path does not exist, cannot run for ${absoluteWatchedPath}: ${absoluteOnDeleteScriptPath}`);
            return;
        }
        
        // Create a glob pattern. If it's a directory, watch all files within.
        // If it's a file, watch that specific file.
        let globPattern: vscode.GlobPattern;
        try {
            const stats = fs.statSync(absoluteWatchedPath);
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absoluteWatchedPath));
            if (!workspaceFolder) {
                 console.warn(`Cannot create watcher: ${absoluteWatchedPath} is not within a workspace folder.`);
                 return;
            }

            if (stats.isDirectory()) {
                globPattern = new vscode.RelativePattern(workspaceFolder, path.join(path.relative(workspaceFolder.uri.fsPath, absoluteWatchedPath), '**/*'));
            } else { // Is a file
                globPattern = new vscode.RelativePattern(workspaceFolder, path.relative(workspaceFolder.uri.fsPath, absoluteWatchedPath));
            }
        } catch(e) {
            console.error(`Error stating path ${absoluteWatchedPath}: `, e);
            return;
        }


        const deletionWatcher = vscode.workspace.createFileSystemWatcher(globPattern);

        deletionWatcher.onDidDelete(async (uri: vscode.Uri) => {
            console.log(`Deletion detected for watched path: ${uri.fsPath} (matches entry for ${absoluteWatchedPath})`);
            if (entry.onDeleteScript && pythonExecutable) {
                try {
                    vscode.window.showInformationMessage(`File deleted: ${uri.fsPath}. Triggering script: ${entry.onDeleteScript}`);
                    await executePythonScript(
                        workspacePath,
                        pythonExecutable,
                        absoluteOnDeleteScriptPath, // Ensure this is an absolute path
                        ["Change Del", uri.fsPath] // Pass "Change Del" and the deleted file path
                    );
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to execute onDelete script for ${uri.fsPath}: ${err instanceof Error ? err.message : String(err)}`);
                    console.error(`Error executing onDelete script for ${uri.fsPath}:`, err);
                }
            } else if (!pythonExecutable && entry.onDeleteScript) {
                 vscode.window.showWarningMessage(`File deleted: ${uri.fsPath}, but Python executable not set. Cannot run script.`);
            }
        });
        
        // It's also good practice to handle onDidChange and onDidCreate if the watched path itself is modified/recreated
        // For now, focusing on onDidDelete as per requirement.

        addWatcherInstance(`deletionWatcher_${absoluteWatchedPath}`, deletionWatcher);
        console.log(`Watching for deletions (and sub-deletions if dir): ${absoluteWatchedPath} -> script: ${entry.onDeleteScript || 'None'}`);
    });
}

export function stopWatching(): void {
    activeWatchers.forEach((watcher, key) => {
        watcher.dispose();
        console.log(`Stopped watching: ${key}`);
    });
    activeWatchers.clear();
}