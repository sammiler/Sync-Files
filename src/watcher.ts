// watcher.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
// MODIFIED: Added getConfigFilePath to imports
import { getPythonScriptPath, getWatchEntries, getPythonExecutablePath, WatchEntry, getConfigFilePath } from './config';
import { executePythonScript } from './python';

const activeWatchers: Map<string, vscode.FileSystemWatcher> = new Map();

function addWatcherInstance(key: string, watcher: vscode.FileSystemWatcher) {
    console.log(`[Watcher DEBUG] addWatcherInstance called for key: ${key}`);
    if (activeWatchers.has(key)) {
        console.log(`[Watcher DEBUG] Disposing existing watcher for key: ${key}`);
        activeWatchers.get(key)?.dispose();
    }
    activeWatchers.set(key, watcher);
    console.log(`[Watcher DEBUG] New watcher set for key: ${key}`);
}

export function startWatching(workspacePath: string, onTreeRefreshNeeded: () => void): void {
    console.log(`[Watcher] startWatching called. Workspace: ${workspacePath}`);
    stopWatching(); // Clears all existing watchers before creating new ones

    // 1. Watch Python Scripts Directory for Tree View updates (existing logic)
    const treeViewScriptDirPath = getPythonScriptPath(workspacePath);
    console.log(`[Watcher] Config - TreeView Script Dir Path: "${treeViewScriptDirPath}"`);
    if (treeViewScriptDirPath) {
        const absoluteTreeViewScriptDirPath = path.resolve(workspacePath, treeViewScriptDirPath);
        console.log(`[Watcher] Resolved TreeView Script Dir Absolute Path: "${absoluteTreeViewScriptDirPath}"`);
        if (fs.existsSync(absoluteTreeViewScriptDirPath) && fs.statSync(absoluteTreeViewScriptDirPath).isDirectory()) {
            const scriptDirWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(absoluteTreeViewScriptDirPath, '**/*.py')
            );
            console.log(`[Watcher] Created FileSystemWatcher for TreeView scripts: Pattern base "${absoluteTreeViewScriptDirPath}", pattern "**/*.py"`);

            const onChangeHandler = (uri?: vscode.Uri) => {
                const eventUri = uri ? uri.fsPath : 'N/A';
                console.log(`[Watcher Event] Change detected in Python script directory: ${absoluteTreeViewScriptDirPath}. Event URI: ${eventUri}. Triggering tree refresh.`);
                onTreeRefreshNeeded();
            };
            scriptDirWatcher.onDidChange(onChangeHandler);
            scriptDirWatcher.onDidCreate(onChangeHandler);
            scriptDirWatcher.onDidDelete(onChangeHandler);
            addWatcherInstance('treeViewScriptsDirWatcher', scriptDirWatcher);
            console.log(`[Watcher] Watching script directory for tree view: ${absoluteTreeViewScriptDirPath}`);
        } else {
            console.warn(`[Watcher] TreeView Script directory does not exist or is not a directory: ${absoluteTreeViewScriptDirPath}`);
        }
    } else {
        console.log('[Watcher] No Python script directory configured for tree view watching.');
    }

    // 2. Watch specific paths for deletion events (and other events) (existing logic)
    const watchEntries = getWatchEntries(workspacePath);
    console.log(`[Watcher] Config - Watch Entries: ${JSON.stringify(watchEntries, null, 2)}`);
    const pythonExecutable = getPythonExecutablePath(workspacePath);
    console.log(`[Watcher] Config - Python Executable Path: "${pythonExecutable}"`);

    if (!pythonExecutable && watchEntries.some(entry => entry.onEventScript)) {
        console.warn('[Watcher] Python executable path not configured. Watchers that trigger Python scripts might not function.');
    }
    if (!watchEntries || watchEntries.length === 0) {
        console.log('[Watcher] No custom watch entries configured.');
    }

    watchEntries.forEach((entry: WatchEntry, index: number) => {
        console.log(`[Watcher] Processing Watch Entry #${index}: Path="${entry.watchedPath}", Script="${entry.onEventScript}"`);
        if (!entry.watchedPath) {
            console.warn(`[Watcher] Watch Entry #${index} has no watchedPath configured. Skipping.`);
            return;
        }
        const absoluteWatchedPath = path.resolve(workspacePath, entry.watchedPath);
        console.log(`[Watcher] Entry #${index} - Resolved Watched Absolute Path: "${absoluteWatchedPath}"`);
        
        let absoluteOnEventScriptPath: string | undefined = undefined;
        if (entry.onEventScript) {
            absoluteOnEventScriptPath = path.resolve(workspacePath, entry.onEventScript);
            console.log(`[Watcher] Entry #${index} - Resolved Script Absolute Path: "${absoluteOnEventScriptPath}"`);
        }

        if (!fs.existsSync(absoluteWatchedPath)) {
            console.warn(`[Watcher] Entry #${index} - Watched path does not exist, cannot watch: ${absoluteWatchedPath}`);
            return;
        }
        if (entry.onEventScript) {
            if (!pythonExecutable) {
                console.warn(`[Watcher] Entry #${index} - Cannot run script for ${absoluteWatchedPath}: Python executable not set.`);
            }
            if (absoluteOnEventScriptPath && !fs.existsSync(absoluteOnEventScriptPath)) {
                console.warn(`[Watcher] Entry #${index} - Script path does not exist for ${absoluteWatchedPath}: ${absoluteOnEventScriptPath}`);
            }
        }
        
        let globPattern: vscode.GlobPattern;
        let isDirectoryWatch = false;
        try {
            const stats = fs.statSync(absoluteWatchedPath);
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absoluteWatchedPath));
            if (!workspaceFolder) {
                 console.warn(`[Watcher] Entry #${index} - Cannot create watcher: Path ${absoluteWatchedPath} is not within an open workspace folder.`);
                 return;
            }
            if (stats.isDirectory()) {
                isDirectoryWatch = true;
                const watchedDirUri = vscode.Uri.file(absoluteWatchedPath);
                globPattern = new vscode.RelativePattern(watchedDirUri, '**');
                console.log(`[Watcher] Entry #${index} - Setting up DIRECTORY watch. Base URI: ${watchedDirUri.toString()}, Pattern: "**"`);
            } else {
                const watchedFileDirUri = vscode.Uri.file(path.dirname(absoluteWatchedPath));
                const watchedFileName = path.basename(absoluteWatchedPath);
                globPattern = new vscode.RelativePattern(watchedFileDirUri, watchedFileName);
                console.log(`[Watcher] Entry #${index} - Setting up FILE watch. Base URI: ${watchedFileDirUri.toString()}, Pattern: "${watchedFileName}"`);
            }
        } catch(e) {
            console.error(`[Watcher] Entry #${index} - Error stating path ${absoluteWatchedPath} or processing for glob: `, e);
            return;
        }

        const watcherKey = `pathWatcher_${entry.watchedPath.replace(/[/\\]/g, '_')}`;
        const pathWatcher = vscode.workspace.createFileSystemWatcher(globPattern, false, false, false);
        console.log(`[Watcher] Entry #${index} - Created FileSystemWatcher with key ${watcherKey}. Base: "${globPattern.baseUri.toString()}", Pattern: "${globPattern.pattern}"`);

        const handleFileSystemEvent = async (eventType: string, uri: vscode.Uri) => {
            console.log(`[Watcher Event] ${eventType} detected by watcher for base "${globPattern.baseUri.toString()}" with pattern "${globPattern.pattern}". Event URI: ${uri.fsPath}. Configured watch: ${entry.watchedPath}`);
            if (isDirectoryWatch && !uri.fsPath.startsWith(absoluteWatchedPath + path.sep) && uri.fsPath !== absoluteWatchedPath) {
                console.log(`[Watcher Event] ${eventType} URI ${uri.fsPath} is outside watched directory ${absoluteWatchedPath}. Glob: pattern "${globPattern.pattern}", base "${globPattern.baseUri.toString()}". Ignoring script call based on this check.`);
            }
            if (entry.onEventScript && pythonExecutable && absoluteOnEventScriptPath && fs.existsSync(absoluteOnEventScriptPath)) {
                try {
                    let scriptArgEventType = "Unknown Event";
                    if (eventType === "DELETION") scriptArgEventType = "Change Del";
                    else if (eventType === "MODIFICATION") scriptArgEventType = "Change Mod";
                    else if (eventType === "CREATION") scriptArgEventType = "Change New";
                    await executePythonScript(workspacePath, pythonExecutable, absoluteOnEventScriptPath, [scriptArgEventType, uri.fsPath], {showNotifications:false});
                } catch (err) {
                    console.error(`[Watcher] Error executing script for ${eventType} on ${uri.fsPath}:`, err);
                }
            } else if (entry.onEventScript && !pythonExecutable) {
                console.warn(`[Watcher] Cannot run script for ${eventType} on ${uri.fsPath}: Python executable not set.`);
            } else if (entry.onEventScript && absoluteOnEventScriptPath && !fs.existsSync(absoluteOnEventScriptPath)) {
                 console.warn(`[Watcher] Cannot run script for ${eventType} on ${uri.fsPath}: Script ${entry.onEventScript} not found.`);
            }
        };
        pathWatcher.onDidCreate((uri) => handleFileSystemEvent("CREATION", uri));
        pathWatcher.onDidChange((uri) => handleFileSystemEvent("MODIFICATION", uri));
        pathWatcher.onDidDelete((uri) => handleFileSystemEvent("DELETION", uri));
        addWatcherInstance(watcherKey, pathWatcher);
        console.log(`[Watcher] Entry #${index} - Now watching for C/U/D on base: ${globPattern.baseUri.toString()}, pattern: ${globPattern.pattern} -> script: ${entry.onEventScript || 'None'}`);
    });

    // --- NEW SECTION: Watch the syncfiles.json config file itself ---
    const configFilePathString = getConfigFilePath(workspacePath);
    const configFileUri = vscode.Uri.file(configFilePathString);
    console.log(`[Watcher] Attempting to watch config file: ${configFileUri.fsPath}`);

    // Create a FileSystemWatcher for the specific config file.
    // The base for RelativePattern should be the directory containing the file (.vscode).
    // The pattern is the filename (syncfiles.json).
    const configFileWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.dirname(configFileUri.fsPath)), path.basename(configFileUri.fsPath))
    );
    console.log(`[Watcher] Created FileSystemWatcher for config file: ${configFileUri.fsPath}`);

    const handleConfigFileChange = (eventType: string, uri: vscode.Uri) => {
        console.log(`[Watcher Event] Config file ${uri.fsPath} ${eventType}. Triggering full refresh.`);
        // The onTreeRefreshNeeded callback should handle reading the new config and updating the UI.
        // This callback is typically: async () => { await vscode.commands.executeCommand('syncfiles.refreshTreeView'); }
        // which in turn calls refreshAndSyncConfig, which reads the config file.
        onTreeRefreshNeeded();
    };

    configFileWatcher.onDidChange((uri) => handleConfigFileChange("changed (onDidChange)", uri));
    configFileWatcher.onDidCreate((uri) => handleConfigFileChange("created (onDidCreate)", uri));
    configFileWatcher.onDidDelete((uri) => handleConfigFileChange("deleted (onDidDelete)", uri));

    addWatcherInstance('configFileWatcher_syncfiles.json', configFileWatcher); // Using a specific and unique key
    console.log(`[Watcher] Now watching config file for C/U/D: ${configFileUri.fsPath}`);
    // --- END NEW SECTION ---
}

export function stopWatching(): void {
    console.log('[Watcher] stopWatching called.');
    activeWatchers.forEach((watcher, key) => {
        watcher.dispose();
        console.log(`[Watcher] Stopped and disposed watcher: ${key}`);
    });
    activeWatchers.clear();
    console.log('[Watcher] All active watchers cleared.');
}