import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getMappings, getEnvVars, getPythonScriptPath, getPythonExecutablePath, saveConfig, Mapping, EnvVar } from './config';
import { startWatching } from './watcher';

// Define the expected message types from the Webview
interface Message {
    command: string;
    mappings?: Mapping[];
    envVars?: EnvVar[];
    pythonScriptPath?: string;
    pythonExecutablePath?: string;
}

export function registerSettingsWebview(context: vscode.ExtensionContext, workspacePath: string) {
    const panel = vscode.window.createWebviewPanel(
        'syncFilesSettings',
        'SyncFiles Settings',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    panel.webview.html = getWebviewContent();

    panel.webview.onDidReceiveMessage(async (message: Message) => {
        switch (message.command) {
            case 'load':
                console.log('Loading settings UI');
                panel.webview.postMessage({
                    command: 'load',
                    mappings: getMappings(workspacePath),
                    envVars: Array.from(getEnvVars(workspacePath).entries()).map(([key, value]) => ({ key, value })),
                    pythonScriptPath: getPythonScriptPath(workspacePath),
                    pythonExecutablePath: getPythonExecutablePath(workspacePath)
                });
                // Update watcher and refresh UI after loading config
                startWatching(workspacePath, () => {
                    console.log('Watcher callback triggered refresh');
                    vscode.commands.executeCommand('vscode.refreshScripts');
                });
                await vscode.commands.executeCommand('vscode.refreshScripts');
                break;
            case 'save':
                try {
                    const mappings: Mapping[] = message.mappings || [];
                    const envVars = new Map<string, string>(
                        (message.envVars || []).map(e => [e.key, e.value])
                    );
                    const pythonScriptPath: string = message.pythonScriptPath || '';
                    const pythonExecutablePath: string = message.pythonExecutablePath || '';

                    // Validation
                    for (let i = 0; i < mappings.length; i++) {
                        const m = mappings[i];
                        if (!m.sourceUrl) throw new Error(`Mapping source URL cannot be empty (row ${i + 1}).`);
                        if (!m.targetPath) throw new Error(`Mapping target path cannot be empty (row ${i + 1}).`);
                        if (!m.sourceUrl.match(/^https?:\/\//)) throw new Error(`Invalid source URL format (row ${i + 1}). Must start with http:// or https://.`);
                        try { path.resolve(workspacePath, m.targetPath); } catch (e) { throw new Error(`Invalid target path format (row ${i + 1}): ${(e as Error).message}`); }
                    }
                    for (const key of envVars.keys()) {
                        if (!key) throw new Error('Environment variable name cannot be empty.');
                    }
                    if (pythonScriptPath) {
                        const scriptPath = path.resolve(workspacePath, pythonScriptPath);
                        if (!fs.existsSync(scriptPath)) throw new Error(`Python Scripts Directory does not exist: ${scriptPath}`);
                        if (!fs.statSync(scriptPath).isDirectory()) throw new Error(`Python Scripts Path must be a directory: ${scriptPath}`);
                    }
                    if (pythonExecutablePath) {
                        const exePath = path.resolve(workspacePath, pythonExecutablePath);
                        if (!fs.existsSync(exePath)) throw new Error(`Python Executable does not exist: ${exePath}`);
                        if (!fs.statSync(exePath).isFile()) throw new Error(`Python Executable Path must be a file: ${exePath}`);
                    }

                    await saveConfig(mappings, envVars, pythonScriptPath, pythonExecutablePath, workspacePath);
                    vscode.window.showInformationMessage('Settings saved successfully!');
                    panel.dispose();
                } catch (err) {
                    vscode.window.showErrorMessage('Failed to save settings: ' + (err instanceof Error ? err.message : String(err)));
                }
                break;
            case 'browseScriptPath':
                const scriptUri = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    openLabel: 'Select Python Scripts Directory'
                });
                if (scriptUri && scriptUri[0]) {
                    panel.webview.postMessage({
                        command: 'setScriptPath',
                        path: path.relative(workspacePath, scriptUri[0].fsPath)
                    });
                }
                break;
            case 'browseExecutablePath':
                const exeUri = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    openLabel: 'Select Python Executable',
                    filters: { 'Executable': ['exe', ''] }
                });
                if (exeUri && exeUri[0]) {
                    panel.webview.postMessage({
                        command: 'setExecutablePath',
                        path: path.relative(workspacePath, exeUri[0].fsPath)
                    });
                }
                break;
        }
    });

    context.subscriptions.push(panel);
}

function getWebviewContent(): string {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>SyncFiles Settings</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                    padding: 20px;
                    background-color: #f5f5f5;
                }
                h2 {
                    color: #333;
                    font-size: 24px;
                    margin-bottom: 20px;
                }
                h3 {
                    color: #333;
                    font-size: 18px;
                    margin: 15px 0 10px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 20px;
                    background-color: #fff;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                }
                th, td {
                    border: 1px solid #ddd;
                    padding: 10px;
                    text-align: left;
                }
                th {
                    background-color: #f8f8f8;
                    color: #000;
                    font-weight: 600;
                }
                td input {
                    width: 100%;
                    padding: 6px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    box-sizing: border-box;
                    font-size: 14px;
                }
                td input[type="text"] {
                    min-width: 250px;
                }
                button {
                    padding: 8px 12px;
                    margin: 5px;
                    border: none;
                    border-radius: 4px;
                    background-color: #0078d4;
                    color: #fff;
                    cursor: pointer;
                    font-size: 14px;
                }
                button:hover {
                    background-color: #005ba1;
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
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    font-size: 14px;
                }
                .path-field button {
                    background-color: #0078d4;
                }
                .path-field button:hover {
                    background-color: #005ba1;
                }
            </style>
        </head>
        <body>
            <h2>SyncFiles Settings</h2>
            
            <h3>File Mappings (GitHub URL to Local Path)</h3>
            <table id="mappingsTable">
                <thead>
                    <tr><th>Source URL</th><th>Target Path</th><th></th></tr>
                </thead>
                <tbody></tbody>
            </table>
            <button onclick="addMappingRow()">Add Mapping</button>

            <h3>Environment Variables for Python Scripts</h3>
            <table id="envVarsTable">
                <thead>
                    <tr><th>Variable Name</th><th>Value</th><th></th></tr>
                </thead>
                <tbody></tbody>
            </table>
            <button onclick="addEnvVarRow()">Add Variable</button>

            <h3>Python Scripts Directory</h3>
            <div class="path-field">
                <input type="text" id="pythonScriptPath" placeholder="Enter directory path">
                <button onclick="browseScriptPath()">Browse</button>
            </div>

            <h3>Python Executable Path</h3>
            <div class="path-field">
                <input type="text" id="pythonExecutablePath" placeholder="Enter executable path">
                <button onclick="browseExecutablePath()">Browse</button>
            </div>

            <div>
                <button onclick="saveSettings()">Save</button>
                <button onclick="resetSettings()">Reset</button>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                let mappings = [];
                let envVars = [];
                let originalData = {};

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'load') {
                        console.log('Webview received load message:', message);
                        originalData = message;
                        mappings = message.mappings || [];
                        envVars = message.envVars || [];
                        document.getElementById('pythonScriptPath').value = message.pythonScriptPath ?? '';
                        document.getElementById('pythonExecutablePath').value = message.pythonExecutablePath ?? '';
                        renderTables();
                    } else if (message.command === 'setScriptPath') {
                        document.getElementById('pythonScriptPath').value = message.path;
                    } else if (message.command === 'setExecutablePath') {
                        document.getElementById('pythonExecutablePath').value = message.path;
                    }
                });

                function renderTables() {
                    const mappingsTbody = document.getElementById('mappingsTable').querySelector('tbody');
                    mappingsTbody.innerHTML = '';
                    mappings.forEach((m, i) => {
                        const row = document.createElement('tr');
                        row.innerHTML = \`
                            <td><input type="text" value="\${m.sourceUrl}" oninput="updateMapping(\${i}, 'sourceUrl', this.value)"></td>
                            <td><input type="text" value="\${m.targetPath}" oninput="updateMapping(\${i}, 'targetPath', this.value)"></td>
                            <td><button onclick="removeMapping(\${i})">Remove</button></td>
                        \`;
                        mappingsTbody.appendChild(row);
                    });

                    const envVarsTbody = document.getElementById('envVarsTable').querySelector('tbody');
                    envVarsTbody.innerHTML = '';
                    envVars.forEach((e, i) => {
                        const row = document.createElement('tr');
                        row.innerHTML = \`
                            <td><input type="text" value="\${e.key}" oninput="updateEnvVar(\${i}, 'key', this.value)"></td>
                            <td><input type="text" value="\${e.value}" oninput="updateEnvVar(\${i}, 'value', this.value)"></td>
                            <td><button onclick="removeEnvVar(\${i})">Remove</button></td>
                        \`;
                        envVarsTbody.appendChild(row);
                    });
                }

                function addMappingRow() {
                    mappings.push({ sourceUrl: '', targetPath: '' });
                    renderTables();
                }

                function addEnvVarRow() {
                    envVars.push({ key: '', value: '' });
                    renderTables();
                }

                function updateMapping(index, field, value) {
                    mappings[index][field] = value;
                }

                function updateEnvVar(index, field, value) {
                    envVars[index][field] = value;
                }

                function removeMapping(index) {
                    mappings.splice(index, 1);
                    renderTables();
                }

                function removeEnvVar(index) {
                    envVars.splice(index, 1);
                    renderTables();
                }

                function browseScriptPath() {
                    vscode.postMessage({ command: 'browseScriptPath' });
                }

                function browseExecutablePath() {
                    vscode.postMessage({ command: 'browseExecutablePath' });
                }

                function saveSettings() {
                    const pythonScriptPath = document.getElementById('pythonScriptPath').value;
                    const pythonExecutablePath = document.getElementById('pythonExecutablePath').value;
                    vscode.postMessage({
                        command: 'save',
                        mappings: mappings.filter(m => m.sourceUrl && m.targetPath),
                        envVars: envVars.filter(e => e.key),
                        pythonScriptPath,
                        pythonExecutablePath
                    });
                }

                function resetSettings() {
                    mappings = originalData.mappings || [];
                    envVars = originalData.envVars || [];
                    document.getElementById('pythonScriptPath').value = originalData.pythonScriptPath ?? '';
                    document.getElementById('pythonExecutablePath').value = originalData.pythonExecutablePath ?? '';
                    renderTables();
                }

                // Load initial data
                vscode.postMessage({ command: 'load' });
            </script>
        </body>
        </html>
    `;
}