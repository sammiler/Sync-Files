// src/watcher.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getPythonScriptPath, getWatchEntries, getPythonExecutablePath, WatchEntry, getConfigFilePath } from './config';
import { executePythonScript } from './python'; // 确保 executePythonScript 能正确处理错误，不阻塞 watcher

// 将 activeWatchers 移到模块级别，使其在 startWatching 和 stopWatching 之间共享
const activeWatchers: Map<string, vscode.FileSystemWatcher> = new Map();

function addWatcherInstance(
    key: string,
    watcher: vscode.FileSystemWatcher,
    context?: vscode.ExtensionContext // 可选的 context 用于注册 dispose
) {
    if (activeWatchers.has(key)) {
        console.log(`[Watcher] Disposing existing watcher for key: ${key}`);
        activeWatchers.get(key)?.dispose();
    }
    activeWatchers.set(key, watcher);
    console.log(`[Watcher] New watcher set for key: ${key}`);

    // 如果提供了 context，将 watcher 的 dispose 方法添加到 context.subscriptions
    // 这样当插件停用时，VS Code 会自动调用 watcher.dispose()
    if (context) {
        context.subscriptions.push({ dispose: () => watcher.dispose() });
    }
}

export function startWatching(
    workspacePath: string,
    onTreeRefreshNeeded: () => void,
    context?: vscode.ExtensionContext // 接收 context
): void {
    console.log(`[Watcher] startWatching called. Workspace: ${workspacePath}`);
    stopWatching(); // 清理所有现有的 watcher

    const workspaceUri = vscode.Uri.file(workspacePath);

    // 1. 监视 Python 脚本目录以更新树视图
    const treeViewScriptDirPath = getPythonScriptPath(workspacePath);
    if (treeViewScriptDirPath) {
        const absoluteTreeViewScriptDirPath = path.resolve(workspacePath, treeViewScriptDirPath);
        if (fs.existsSync(absoluteTreeViewScriptDirPath) && fs.statSync(absoluteTreeViewScriptDirPath).isDirectory()) {
            const scriptDirWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(absoluteTreeViewScriptDirPath), '**/*.py')
            );
            const onChangeHandler = (uri?: vscode.Uri) => {
                console.log(`[Watcher Event] Python script directory change detected (${uri?.fsPath || 'N/A'}). Triggering tree refresh.`);
                onTreeRefreshNeeded();
            };
            scriptDirWatcher.onDidChange(onChangeHandler);
            scriptDirWatcher.onDidCreate(onChangeHandler);
            scriptDirWatcher.onDidDelete(onChangeHandler);
            addWatcherInstance('treeViewScriptsDirWatcher', scriptDirWatcher, context);
            console.log(`[Watcher] Watching script directory for tree view: ${absoluteTreeViewScriptDirPath}`);
        } else {
            console.warn(`[Watcher] TreeView Script directory does not exist or is not a directory: ${absoluteTreeViewScriptDirPath}`);
        }
    } else {
        console.log('[Watcher] No Python script directory configured for tree view watching.');
    }

    // 2. 监视配置中定义的 watchEntries
    const watchEntries = getWatchEntries(workspacePath);
    const pythonExecutable = getPythonExecutablePath(workspacePath);

    watchEntries.forEach((entry: WatchEntry, index: number) => {
        if (!entry.watchedPath) {
            console.warn(`[Watcher] Watch Entry #${index} has no watchedPath configured. Skipping.`);
            return;
        }
        const absoluteWatchedPath = path.resolve(workspacePath, entry.watchedPath);
        let absoluteOnEventScriptPath: string | undefined = undefined;
        if (entry.onEventScript) {
            absoluteOnEventScriptPath = path.resolve(workspacePath, entry.onEventScript);
        }

        if (!fs.existsSync(absoluteWatchedPath)) {
            console.warn(`[Watcher] Entry #${index} - Watched path does not exist, cannot watch: ${absoluteWatchedPath}`);
            return;
        }

        let globPattern: vscode.GlobPattern;
        let isDirectoryWatch = false;
        try {
            const stats = fs.statSync(absoluteWatchedPath);
            const workspaceFolderForEntry = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(absoluteWatchedPath));
            if (!workspaceFolderForEntry) {
                 console.warn(`[Watcher] Entry #${index} - Path ${absoluteWatchedPath} is not within an open workspace folder.`);
                 return;
            }
            if (stats.isDirectory()) {
                isDirectoryWatch = true;
                globPattern = new vscode.RelativePattern(vscode.Uri.file(absoluteWatchedPath), '**');
            } else {
                globPattern = new vscode.RelativePattern(vscode.Uri.file(path.dirname(absoluteWatchedPath)), path.basename(absoluteWatchedPath));
            }
        } catch(e) {
            console.error(`[Watcher] Entry #${index} - Error processing path ${absoluteWatchedPath} for glob: `, e);
            return;
        }

        const pathWatcher = vscode.workspace.createFileSystemWatcher(globPattern, false, false, false); // ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents
        const handleFileSystemEvent = async (eventType: string, uri: vscode.Uri) => {
            console.log(`[Watcher Event] For entry '${entry.watchedPath}': ${eventType} detected at ${uri.fsPath}.`);
            // 简单的目录检查（如果需要更精确的匹配，可以使用minimatch等库）
            if (isDirectoryWatch && !uri.fsPath.startsWith(absoluteWatchedPath + path.sep) && uri.fsPath !== absoluteWatchedPath) {
                // console.log(`[Watcher Event] Event URI ${uri.fsPath} is outside watched directory ${absoluteWatchedPath}. Ignoring script call.`);
                // return; // 这个判断可能过于严格，因为父目录的事件也可能相关
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
            }
        };
        pathWatcher.onDidCreate((uri) => handleFileSystemEvent("CREATION", uri));
        pathWatcher.onDidChange((uri) => handleFileSystemEvent("MODIFICATION", uri));
        pathWatcher.onDidDelete((uri) => handleFileSystemEvent("DELETION", uri));
        addWatcherInstance(`watchEntry_${index}_${entry.watchedPath.replace(/[/\\]/g, '_')}`, pathWatcher, context);
        console.log(`[Watcher] Entry #${index} - Now watching ${absoluteWatchedPath} -> script: ${entry.onEventScript || 'None'}`);
    });


    // 3. 监视 syncfiles.json 文件本身
    const configFilePathString = getConfigFilePath(workspacePath); // 从 config.ts 导入
    const configFileDirectoryUri = vscode.Uri.file(path.dirname(configFilePathString));
    const configFileName = path.basename(configFilePathString);

    // 只有当 .vscode 目录存在时才监视 syncfiles.json (因为它是其父目录)
    // 如果 .vscode 目录不存在，那么 syncfiles.json 也不存在，这个 watcher 没有意义
    if (fs.existsSync(configFileDirectoryUri.fsPath)) {
        console.log(`[Watcher] Attempting to watch config file: Dir='${configFileDirectoryUri.fsPath}', File='${configFileName}'`);
        const configFileWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(configFileDirectoryUri, configFileName)
        );

        const handleConfigFileChange = (eventType: string, uri: vscode.Uri) => {
            console.log(`[Watcher Event] Config file ${uri.fsPath} ${eventType}. Triggering full refresh.`);
            onTreeRefreshNeeded();
        };

        configFileWatcher.onDidChange((uri) => handleConfigFileChange("changed", uri));
        configFileWatcher.onDidCreate((uri) => handleConfigFileChange("created", uri));
        configFileWatcher.onDidDelete((uri) => handleConfigFileChange("deleted", uri));

        addWatcherInstance('configFileWatcher_syncfiles.json', configFileWatcher, context);
        console.log(`[Watcher] Now watching config file for C/U/D: ${configFilePathString}`);
    } else {
        console.log(`[Watcher] Directory for config file (${configFileDirectoryUri.fsPath}) does not exist. Not watching syncfiles.json directly.`);
    }

    // 4. 监视 .vscode 目录本身的删除
    // 这个 watcher 的 base 是 workspacePath, pattern 是 ".vscode"
    const dotVscodeDirPath = path.join(workspacePath, ".vscode");
    // 只有当 .vscode 目录在启动时存在，才监视它的删除。
    // 如果它之后被创建，这个 watcher 不会动态添加 (除非 startWatching 被重新调用)。
    // 对于 .vscode 目录的创建，configFileWatcher 对 syncfiles.json 的 onDidCreate 应该能间接触发刷新。
    if (fs.existsSync(dotVscodeDirPath)) {
        const dotVscodeDirWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceUri, ".vscode") // 监视工作区根目录下的 ".vscode" 这个条目
            // 注意：这个glob pattern `.vscode` 只会匹配名为 `.vscode` 的文件或目录。
            // 如果想匹配 `.vscode` 目录下的所有内容，应该是 `new vscode.RelativePattern(vscode.Uri.file(dotVscodeDirPath), '**')`
            // 但我们这里主要关心 `.vscode` 目录本身的删除。
        );

        dotVscodeDirWatcher.onDidDelete(uri => {
            // 确保被删除的是 .vscode 目录本身
            if (normalizeFsPath(uri.fsPath) === normalizeFsPath(dotVscodeDirPath)) {
                console.log(`[Watcher Event] .vscode directory itself deleted: ${uri.fsPath}. Triggering full refresh.`);
                onTreeRefreshNeeded(); // 触发刷新，因为配置文件肯定没了
            }
        });
        // .vscode 目录的 onDidChange 和 onDidCreate 事件通常意义不大，因为我们更关心其内部文件的变化（由其他 watcher 处理）
        // 或者它被删除的事件。
        addWatcherInstance('dotVscodeDirectoryWatcher', dotVscodeDirWatcher, context);
        console.log(`[Watcher] Now watching .vscode directory itself for deletion: ${dotVscodeDirPath}`);
    } else {
        console.log(`[Watcher] .vscode directory does not exist at startup, not watching it for deletion directly.`);
        // 如果 .vscode 目录在插件启动时不存，之后被创建了，
        // 那么 `configFileWatcher` (如果它的父目录存在) 对 `syncfiles.json` 的 `onDidCreate` 事件应该会触发刷新。
    }
}

export function stopWatching(): void {
    console.log('[Watcher] stopWatching called.');
    activeWatchers.forEach((watcher, key) => {
        try {
            watcher.dispose(); // 正确调用 dispose
            console.log(`[Watcher] Disposed watcher: ${key}`);
        } catch (e) {
            console.error(`[Watcher] Error disposing watcher ${key}:`, e);
        }
    });
    activeWatchers.clear();
    console.log('[Watcher] All active watchers cleared.');
}

// 辅助函数，用于规范化路径以进行比较（可选，但有时有用）
function normalizeFsPath(fsPath: string): string {
    return path.normalize(fsPath).toLowerCase(); // 根据需要调整规范化级别
}