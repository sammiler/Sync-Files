import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    getMappings,
    getEnvVars,
    getPythonScriptPath,
    getPythonExecutablePath,
    getWatchEntries, // 导入新的 getter
    saveCoreSettings,
    Mapping,
    EnvVar,
    WatchEntry // 导入新的类型
} from './config';
// import { startWatching } from './watcher'; // startWatching 不应在这里调用，它在激活和保存配置时调用

// 定义 Webview 期望的消息类型
interface Message {
    command: string;
    mappings?: Mapping[];
    envVars?: EnvVar[];
    pythonScriptPath?: string;
    pythonExecutablePath?: string;
    watchEntries?: WatchEntry[]; // 添加到消息接口
    path?: string; // 用于浏览结果
    entryType?: 'watchedPath' | 'onEventScript'; // 用于区分 watch entries 的浏览调用
    index?: number; // 用于更新特定的 watch entry 路径
}

export function registerSettingsWebview(context: vscode.ExtensionContext, workspacePath: string) {
    console.log('Extension Host: registerSettingsWebview called. Workspace path:', workspacePath); // 调试日志

    const panel = vscode.window.createWebviewPanel(
        'syncFilesSettings',
        'SyncFiles Settings',
        vscode.ViewColumn.One,
        {
            enableScripts: true, // 必须为 true 才能运行 webview 中的 JavaScript
            retainContextWhenHidden: true, // 保持状态当 tab 不可见时
            localResourceRoots: [vscode.Uri.file(workspacePath)] // 如果你从工作区加载本地资源（如图片、css）
        }
    );

    panel.webview.html = getWebviewContent();

    panel.webview.onDidReceiveMessage(async (message: Message) => {
        console.log('Extension Host: Received message from webview:', message); // 调试日志: 记录从 webview 收到的所有消息
        // vscode.window.showInformationMessage(`Extension Host: Received command: ${message.command}`); // 临时调试：显示收到的命令

        switch (message.command) {
            case 'load':
                console.log('Extension Host: Handling "load" command.'); // 调试日志
                panel.webview.postMessage({
                    command: 'load',
                    mappings: getMappings(workspacePath),
                    envVars: Array.from(getEnvVars(workspacePath).entries()).map(([key, value]) => ({ key, value })),
                    pythonScriptPath: getPythonScriptPath(workspacePath),
                    pythonExecutablePath: getPythonExecutablePath(workspacePath),
                    watchEntries: getWatchEntries(workspacePath) // 加载 watch entries
                });
                break;
            case 'save':
                console.log('Extension Host: Handling "save" command.'); // 调试日志
                try {
                    const mappings: Mapping[] = message.mappings || [];
                    const envVars = new Map<string, string>(
                        (message.envVars || []).map(e => [e.key, e.value])
                    );
                    const pythonScriptPath: string = message.pythonScriptPath || '';
                    const pythonExecutablePath: string = message.pythonExecutablePath || '';
                    const watchEntries: WatchEntry[] = message.watchEntries || [];

                    // ... (此处应有完整的验证逻辑, 为简洁省略) ...
                    // 举例一个简单的验证
                    if (pythonExecutablePath && !fs.existsSync(path.resolve(workspacePath, pythonExecutablePath))) {
                         //throw new Error(`Python Executable Path does not exist: ${pythonExecutablePath}`);
                         // 最好是在保存前由用户确认，或者在UI上给出提示
                    }


                    await saveCoreSettings(workspacePath,mappings, envVars, pythonScriptPath, pythonExecutablePath, watchEntries);
                    vscode.window.showInformationMessage('Settings saved successfully!');
                    panel.dispose(); // 保存后关闭面板
                } catch (err) {
                    console.error('Extension Host: Error saving settings:', err); // 调试日志
                    vscode.window.showErrorMessage('Failed to save settings: ' + (err instanceof Error ? err.message : String(err)));
                }
                break;
            case 'browseScriptPath':
                console.log('Extension Host: Handling browseScriptPath command.'); // 调试日志
                // vscode.window.showInformationMessage('Extension Host: browseScriptPath triggered.'); // 临时调试
                try {
                    const scriptUri = await vscode.window.showOpenDialog({
                        canSelectFolders: true,
                        canSelectFiles: false,
                        openLabel: 'Select Python Scripts Directory',
                        // defaultUri: workspacePath ? vscode.Uri.file(workspacePath) : undefined // 可选：设置默认打开路径
                    });
                    console.log('Extension Host: showOpenDialog for script path returned:', scriptUri); // 调试日志
                    if (scriptUri && scriptUri[0]) {
                        panel.webview.postMessage({
                            command: 'setScriptPath',
                            path: path.relative(workspacePath, scriptUri[0].fsPath)
                        });
                    } else {
                         console.log('Extension Host: No script path selected or dialog cancelled.'); // 调试日志
                    }
                } catch (error) {
                    console.error('Extension Host: Error in browseScriptPath:', error); // 调试日志
                    vscode.window.showErrorMessage('Error browsing for script path: ' + (error instanceof Error ? error.message : String(error)));
                }
                break;
            case 'browseExecutablePath':
                console.log('Extension Host: Handling browseExecutablePath command.'); // 调试日志
                // vscode.window.showInformationMessage('Extension Host: browseExecutablePath triggered.'); // 临时调试
                try {
                    const exeUri = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        openLabel: 'Select Python Executable',
                        filters: { 'Executable': ['exe', 'bat', 'cmd', 'sh', 'py', ''] } // 调整了过滤器以获得更广泛的兼容性
                        // defaultUri: workspacePath ? vscode.Uri.file(workspacePath) : undefined // 可选
                    });
                    console.log('Extension Host: showOpenDialog for executable path returned:', exeUri); // 调试日志
                    if (exeUri && exeUri[0]) {
                        panel.webview.postMessage({
                            command: 'setExecutablePath',
                            path: path.relative(workspacePath, exeUri[0].fsPath)
                        });
                    } else {
                        console.log('Extension Host: No executable path selected or dialog cancelled.'); // 调试日志
                    }
                } catch (error) {
                    console.error('Extension Host: Error in browseExecutablePath:', error); // 调试日志
                    vscode.window.showErrorMessage('Error browsing for executable path: ' + (error instanceof Error ? error.message : String(error)));
                }
                break;
            case 'browseWatchEntryPath':
                console.log('Extension Host: Handling browseWatchEntryPath command.', message); // 调试日志
                if (typeof message.index !== 'number' || !message.entryType) {
                    console.warn('Extension Host: browseWatchEntryPath called with invalid index or entryType.');
                    break;
                }
                try {
                    if (message.entryType === 'watchedPath') {
                        const uri = await vscode.window.showOpenDialog({
                            canSelectFiles: true,
                            canSelectFolders: true,
                            openLabel: 'Select Path to Watch'
                        });
                        console.log('Extension Host: browseWatchEntryPath (watchedPath) dialog returned:', uri); // 调试日志
                        if (uri && uri[0]) {
                            panel.webview.postMessage({
                                command: 'setWatchEntryPath',
                                index: message.index,
                                entryType: 'watchedPath',
                                path: path.relative(workspacePath, uri[0].fsPath)
                            });
                        }
                    } else if (message.entryType === 'onEventScript') {
                        const uri = await vscode.window.showOpenDialog({
                            canSelectFiles: true,
                            canSelectFolders: false,
                            openLabel: 'Select Python Script for Deletion Event',
                            filters: { 'Python Scripts': ['py'] }
                        });
                        console.log('Extension Host: browseWatchEntryPath (onEventScript) dialog returned:', uri); // 调试日志
                        if (uri && uri[0]) {
                            panel.webview.postMessage({
                                command: 'setWatchEntryPath',
                                index: message.index,
                                entryType: 'onEventScript',
                                path: path.relative(workspacePath, uri[0].fsPath)
                            });
                        }
                    }
                } catch (error) {
                    console.error(`Extension Host: Error in browseWatchEntryPath for ${message.entryType}:`, error); // 调试日志
                    vscode.window.showErrorMessage(`Error browsing for ${message.entryType}: ` + (error instanceof Error ? error.message : String(error)));
                }
                break;
            default:
                console.warn('Extension Host: Received unknown command from webview:', message.command); // 调试日志
        }
    });

    // 当面板关闭时，进行一些清理（如果需要）
    panel.onDidDispose(() => {
        console.log('Extension Host: Settings panel disposed.'); // 调试日志
        // 在这里可以执行任何必要的清理工作
    }, null, context.subscriptions);

    console.log('Extension Host: Settings webview panel created and message listener attached.'); // 调试日志
    context.subscriptions.push(panel);
}

function getWebviewContent(): string {
    // CSS 和现有的 HTML 结构
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>SyncFiles Settings</title>
            <style>
                body {
                    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif);
                    padding: 20px;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                }
                h2, h3 {
                    color: var(--vscode-editor-foreground);
                    border-bottom: 1px solid var(--vscode-editorWidget-border, #454545);
                    padding-bottom: 5px;
                    margin-top: 25px;
                }
                h2:first-child, h3:first-child {
                    margin-top: 0;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 20px;
                    background-color: var(--vscode-sideBar-background, var(--vscode-editorWidget-background));
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                }
                th, td {
                    border: 1px solid var(--vscode-editorGroup-border, #333);
                    padding: 10px;
                    text-align: left;
                }
                th {
                    background-color: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-quickInputList-focusBackground));
                    color: var(--vscode-tab-activeForeground, var(--vscode-quickInputList-focusForeground));
                    font-weight: 600;
                }
                td input[type="text"], td input[type="password"] {
                    width: 100%;
                    padding: 6px;
                    border: 1px solid var(--vscode-input-border, #3C3C3C);
                    border-radius: 4px;
                    box-sizing: border-box;
                    font-size: 14px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                }
                button {
                    padding: 8px 12px;
                    margin: 5px;
                    border: 1px solid var(--vscode-button-border, transparent);
                    border-radius: 4px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    cursor: pointer;
                    font-size: 14px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .path-field {
                    display: flex;
                    align-items: center;
                    margin-bottom: 15px;
                }
                .path-field input {
                    flex-grow: 1;
                    padding: 8px;
                    margin-right: 10px;
                    border: 1px solid var(--vscode-input-border, #3C3C3C);
                    border-radius: 4px;
                    font-size: 14px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                }
                .remove-button {
                    background-color: var(--vscode-button-secondaryBackground, #5c2323);
                    color: var(--vscode-button-secondaryForeground, #ffffff);
                }
                .remove-button:hover {
                     background-color: var(--vscode-button-secondaryHoverBackground, #8b3232);
                }
                .action-buttons {
                    margin-top: 30px;
                }
            </style>
        </head>
        <body>
            <h2>SyncFiles Settings</h2>

            <h3>File Mappings (GitHub URL to Local Path)</h3>
            <table id="mappingsTable">
                <thead><tr><th>Source URL</th><th>Target Path</th><th>Action</th></tr></thead>
                <tbody></tbody>
            </table>
            <button onclick="addMappingRow()">Add Mapping</button>

            <h3>Environment Variables for Python Scripts</h3>
            <table id="envVarsTable">
                <thead><tr><th>Variable Name</th><th>Value</th><th>Action</th></tr></thead>
                <tbody></tbody>
            </table>
            <button onclick="addEnvVarRow()">Add Variable</button>

            <h3>Python Scripts Directory (for Tree View)</h3>
            <div class="path-field">
                <input type="text" id="pythonScriptPath" placeholder="Enter directory path for scripts in tree view">
                <button onclick="browseScriptPath()">Browse</button>
            </div>

            <h3>Python Executable Path</h3>
            <div class="path-field">
                <input type="text" id="pythonExecutablePath" placeholder="Enter Python executable path (e.g., /usr/bin/python3 or C:\\Python39\\python.exe)">
                <button onclick="browseExecutablePath()">Browse</button>
            </div>

            <h3>Watched Paths for Deletion Event</h3>
            <table id="watchEntriesTable">
                <thead>
                    <tr>
                        <th>Path to Watch (File or Directory)</th>
                        <th>Python Script on Delete</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
            <button onclick="addWatchEntryRow()">Add Watch Entry</button>

            <div class="action-buttons">
                <button onclick="saveSettings()">Save Settings</button>
                <button onclick="resetSettings()">Reset to Loaded</button>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let mappings = [];
                let envVars = [];
                let watchEntries = [];
                let originalData = {}; // 用于存储加载时的原始数据，方便重置

                console.log('WebView JS: Script loaded.'); // 调试日志：确认脚本已加载

                window.addEventListener('message', event => {
                    const message = event.data;
                    console.log('WebView JS: Received message from extension:', message); // 调试日志：记录从插件后端收到的所有消息

                    if (message.command === 'load') {
                        console.log('WebView JS: Handling "load" message from extension.', message); // 调试日志
                        originalData = JSON.parse(JSON.stringify(message)); // 深拷贝以供重置
                        mappings = message.mappings || [];
                        envVars = message.envVars || [];
                        watchEntries = message.watchEntries || [];
                        document.getElementById('pythonScriptPath').value = message.pythonScriptPath ?? '';
                        document.getElementById('pythonExecutablePath').value = message.pythonExecutablePath ?? '';
                        renderAllTables();
                    } else if (message.command === 'setScriptPath') {
                        console.log('WebView JS: Setting script path input to:', message.path); // 调试日志
                        // alert('WebView JS: Received setScriptPath: ' + message.path); // 临时调试
                        document.getElementById('pythonScriptPath').value = message.path;
                    } else if (message.command === 'setExecutablePath') {
                        console.log('WebView JS: Setting executable path input to:', message.path); // 调试日志
                        // alert('WebView JS: Received setExecutablePath: ' + message.path); // 临时调试
                        document.getElementById('pythonExecutablePath').value = message.path;
                    } else if (message.command === 'setWatchEntryPath') {
                        console.log('WebView JS: Handling "setWatchEntryPath" message.', message); // 调试日志
                        if (typeof message.index === 'number' && message.entryType && watchEntries[message.index]) {
                            watchEntries[message.index][message.entryType] = message.path;
                            renderWatchEntriesTable(); // 只重新渲染这个表可能更好
                        } else {
                            console.warn('WebView JS: Invalid setWatchEntryPath message received.', message);
                        }
                    }
                });

                function renderAllTables() {
                    console.log('WebView JS: renderAllTables called.'); // 调试日志
                    renderMappingsTable();
                    renderEnvVarsTable();
                    renderWatchEntriesTable();
                }

                function renderMappingsTable() {
                    const tbody = document.getElementById('mappingsTable').querySelector('tbody');
                    tbody.innerHTML = ''; // 清空现有行
                    mappings.forEach((m, i) => {
                        const row = tbody.insertRow();
                        row.innerHTML = \`
                            <td><input type="text" value="\${m.sourceUrl || ''}" oninput="updateMapping(\${i}, 'sourceUrl', this.value)" placeholder="https://github.com/user/repo/blob/main/file.txt"></td>
                            <td><input type="text" value="\${m.targetPath || ''}" oninput="updateMapping(\${i}, 'targetPath', this.value)" placeholder="local/path/to/file.txt"></td>
                            <td><button class="remove-button" onclick="removeMapping(\${i})">Remove</button></td>
                        \`;
                    });
                }

                function renderEnvVarsTable() {
                    const tbody = document.getElementById('envVarsTable').querySelector('tbody');
                    tbody.innerHTML = '';
                    envVars.forEach((e, i) => {
                        const row = tbody.insertRow();
                        row.innerHTML = \`
                            <td><input type="text" value="\${e.key || ''}" oninput="updateEnvVar(\${i}, 'key', this.value)" placeholder="MY_VARIABLE"></td>
                            <td><input type="text" value="\${e.value || ''}" oninput="updateEnvVar(\${i}, 'value', this.value)" placeholder="its_value"></td>
                            <td><button class="remove-button" onclick="removeEnvVar(\${i})">Remove</button></td>
                        \`;
                    });
                }

                function renderWatchEntriesTable() {
                    const tbody = document.getElementById('watchEntriesTable').querySelector('tbody');
                    tbody.innerHTML = '';
                    watchEntries.forEach((w, i) => {
                        const row = tbody.insertRow();
                        row.innerHTML = \`
                            <td>
                                <div class="path-field" style="margin-bottom: 0;">
                                    <input type="text" value="\${w.watchedPath || ''}" oninput="updateWatchEntry(\${i}, 'watchedPath', this.value)" placeholder="e.g., src/data.json or project/logs/">
                                    <button onclick="browseWatchEntryPath(\${i}, 'watchedPath')">Browse</button>
                                </div>
                            </td>
                            <td>
                                <div class="path-field" style="margin-bottom: 0;">
                                    <input type="text" value="\${w.onEventScript || ''}" oninput="updateWatchEntry(\${i}, 'onEventScript', this.value)" placeholder="e.g., scripts/cleanup_on_delete.py">
                                    <button onclick="browseWatchEntryPath(\${i}, 'onEventScript')">Browse</button>
                                </div>
                            </td>
                            <td><button class="remove-button" onclick="removeWatchEntry(\${i})">Remove</button></td>
                        \`;
                    });
                }

                // Mappings functions
                function addMappingRow() { console.log('WebView JS: addMappingRow'); mappings.push({ sourceUrl: '', targetPath: '' }); renderMappingsTable(); }
                function updateMapping(index, field, value) { mappings[index][field] = value; console.log('WebView JS: updateMapping', index, field, value); }
                function removeMapping(index) { console.log('WebView JS: removeMapping', index); mappings.splice(index, 1); renderMappingsTable(); }

                // EnvVars functions
                function addEnvVarRow() { console.log('WebView JS: addEnvVarRow'); envVars.push({ key: '', value: '' }); renderEnvVarsTable(); }
                function updateEnvVar(index, field, value) { envVars[index][field] = value; console.log('WebView JS: updateEnvVar', index, field, value); }
                function removeEnvVar(index) { console.log('WebView JS: removeEnvVar', index); envVars.splice(index, 1); renderEnvVarsTable(); }

                // WatchEntries functions
                function addWatchEntryRow() { console.log('WebView JS: addWatchEntryRow'); watchEntries.push({ watchedPath: '', onEventScript: '' }); renderWatchEntriesTable(); }
                function updateWatchEntry(index, field, value) { watchEntries[index][field] = value; console.log('WebView JS: updateWatchEntry', index, field, value); }
                function removeWatchEntry(index) { console.log('WebView JS: removeWatchEntry', index); watchEntries.splice(index, 1); renderWatchEntriesTable(); }

                function browseWatchEntryPath(index, entryType) {
                    console.log('WebView JS: browseWatchEntryPath() called for index:', index, 'type:', entryType); // 调试日志
                    // alert('WebView JS: browseWatchEntryPath() called. Sending message...'); // 临时调试
                    vscode.postMessage({ command: 'browseWatchEntryPath', index, entryType });
                }

                // General Path Browsing
                function browseScriptPath() {
                    console.log('WebView JS: browseScriptPath() called.'); // 调试日志
                    // alert('WebView JS: browseScriptPath() called. Sending message...'); // 临时调试
                    vscode.postMessage({ command: 'browseScriptPath' });
                }

                function browseExecutablePath() {
                    console.log('WebView JS: browseExecutablePath() called.'); // 调试日志
                    // alert('WebView JS: browseExecutablePath() called. Sending message...'); // 临时调试
                    vscode.postMessage({ command: 'browseExecutablePath' });
                }

                function saveSettings() {
                    console.log('WebView JS: saveSettings() called.'); // 调试日志
                    const pythonScriptPath = document.getElementById('pythonScriptPath').value;
                    const pythonExecutablePath = document.getElementById('pythonExecutablePath').value;
                    vscode.postMessage({
                        command: 'save',
                        mappings: mappings.filter(m => m.sourceUrl || m.targetPath), // 允许部分为空以便用户可以稍后填充
                        envVars: envVars.filter(e => e.key),
                        pythonScriptPath,
                        pythonExecutablePath,
                        watchEntries: watchEntries.filter(w => w.watchedPath || w.onEventScript)
                    });
                }

                function resetSettings() {
                    console.log('WebView JS: resetSettings() called.'); // 调试日志
                    if (originalData && Object.keys(originalData).length > 0) {
                        mappings = JSON.parse(JSON.stringify(originalData.mappings || []));
                        envVars = JSON.parse(JSON.stringify(originalData.envVars || []));
                        watchEntries = JSON.parse(JSON.stringify(originalData.watchEntries || []));
                        document.getElementById('pythonScriptPath').value = originalData.pythonScriptPath ?? '';
                        document.getElementById('pythonExecutablePath').value = originalData.pythonExecutablePath ?? '';
                        renderAllTables();
                        vscode.window.showInformationMessage('Settings have been reset to the last loaded state.');
                    } else {
                        vscode.window.showWarningMessage('No original data to reset to. Try loading settings again.');
                    }
                }

                // 首次加载数据
                console.log('WebView JS: Requesting initial data from extension using "load" command.'); // 调试日志
                vscode.postMessage({ command: 'load' });
            </script>
        </body>
        </html>
    `;
}