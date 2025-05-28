// src/tasksGenerator.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getPythonExecutablePath, getPythonScriptPath, getEnvVars } from './config'; // From syncfiles' config
import { ensureAbsolute, normalizePath } from './utils';

interface VsCodeTask {
    label: string;
    type: string;
    command: string;
    args?: string[];
    options?: {
        cwd?: string;
        env?: Record<string, string>;
    };
    group?: string | { kind?: string; isDefault?: boolean };
    presentation?: {
        echo?: boolean;
        reveal?: string;
        focus?: boolean;
        panel?: string;
        showReuseMessage?: boolean;
        clear?: boolean;
    };
    problemMatcher?: any[];
    detail?: string;
}

interface VsCodeTasksRoot {
    version: string;
    tasks: VsCodeTask[];
    inputs?: any[]; // We won't populate this from generator, but acknowledge its existence
}

export async function generateAndSaveTasksJson(workspacePath: string): Promise<void> {
    console.log('[TasksGenerator] Attempting to generate tasks.json...');

    // These getters now reflect the state after YAML processing and saving to syncfiles.json
    const pyExecutablePathFromConfig = getPythonExecutablePath(workspacePath);
    const pyScriptPathFromConfig = getPythonScriptPath(workspacePath);
    const envVarsMap = await getEnvVars(workspacePath); // This is async in your provided code

    if (!pyScriptPathFromConfig) {
        console.log('[TasksGenerator] pythonScriptPath is not configured in syncfiles.json. Skipping tasks.json generation.');
        return;
    }

    const absoluteScriptDir = ensureAbsolute(pyScriptPathFromConfig, workspacePath);

    if (!fs.existsSync(absoluteScriptDir) || !fs.statSync(absoluteScriptDir).isDirectory()) {
        console.warn(`[TasksGenerator] Python script directory does not exist or is not a directory: ${absoluteScriptDir}. Skipping tasks.json generation.`);
        // Optionally notify user if you want:
        // vscode.window.showWarningMessage(`Script directory '${pyScriptPathFromConfig}' not found. tasks.json not generated.`);
        return;
    }

    let pythonCommandForTasks = pyExecutablePathFromConfig;
    if (!pythonCommandForTasks) {
        pythonCommandForTasks = 'python'; // Default to 'python' if not specified, rely on PATH
        console.log('[TasksGenerator] pythonExecutablePath is empty in syncfiles.json, defaulting task command to "python".');
    }
    // pythonCommandForTasks is now the command string (e.g., "C:/Python/python.exe" or "python3" or "python")

    const envForTasks: Record<string, string> = {};
    envVarsMap.forEach((value, key) => {
        envForTasks[key] = value;
    });

    const generatedTasks: VsCodeTask[] = [];
    try {
        const scriptFiles = fs.readdirSync(absoluteScriptDir).filter(file => file.toLowerCase().endsWith('.py') && !fs.statSync(path.join(absoluteScriptDir, file)).isDirectory());

        if (scriptFiles.length === 0) {
            console.log(`[TasksGenerator] No Python scripts found in ${absoluteScriptDir}. tasks.json will have an empty tasks array.`);
        }

        for (const scriptFile of scriptFiles) {
            const taskLabel = scriptFile.replace(/\.py$/i, '');
            
            // Script path relative to workspaceFolder for tasks.json's args.
            // pyScriptPathFromConfig is already relative (e.g., .vscode/py-script) or absolute.
            // If pyScriptPathFromConfig is absolute, path.join will handle it.
            // We need to ensure the final path in "args" is understood by tasks relative to ${workspaceFolder}
            let scriptArgPath: string;
            if (path.isAbsolute(pyScriptPathFromConfig)) {
                // If config path is absolute, make script path relative to workspace for task arg
                scriptArgPath = normalizePath(path.relative(workspacePath, path.join(pyScriptPathFromConfig, scriptFile)));
            } else {
                // If config path is relative, just join
                 scriptArgPath = normalizePath(path.join(pyScriptPathFromConfig, scriptFile));
            }
            // Ensure it doesn't start with / if it's meant to be relative to workspace root for tasks.json
            if (scriptArgPath.startsWith('/') || scriptArgPath.startsWith('\\')) {
                scriptArgPath = scriptArgPath.substring(1);
            }


            generatedTasks.push({
                label: taskLabel,
                type: 'shell',
                command: pythonCommandForTasks, // Use the determined python command
                args: [scriptArgPath],
                options: {
                    cwd: '${workspaceFolder}', // Standard CWD for tasks
                    env: envForTasks,          // Environment variables from syncfiles.json
                },
                group: 'build', // A common default group
                presentation: {
                    echo: true,
                    reveal: 'always',
                    focus: false,
                    panel: 'shared',
                    showReuseMessage: true,
                    clear: false,
                },
                problemMatcher: [], // Default empty problem matcher
                detail: `Runs the ${scriptFile} script.`
            });
        }
    } catch (error: any) {
        console.error(`[TasksGenerator] Error reading script directory ${absoluteScriptDir}: ${error.message}`);
        vscode.window.showErrorMessage(`Error generating tasks from script directory '${pyScriptPathFromConfig}': ${error.message}`);
        return; // Stop if we can't read scripts
    }

    const tasksJsonPath = path.join(workspacePath, '.vscode', 'tasks.json');
    const tasksJsonDir = path.dirname(tasksJsonPath);

    if (!fs.existsSync(tasksJsonDir)) {
        fs.mkdirSync(tasksJsonDir, { recursive: true });
    }

    const backupTasksJsonPath = tasksJsonPath + '.sfbak'; // SyncFiles Backup
    if (fs.existsSync(tasksJsonPath)) {
        try {
            fs.copyFileSync(tasksJsonPath, backupTasksJsonPath);
            console.log(`[TasksGenerator] Existing tasks.json backed up to ${backupTasksJsonPath}`);
        } catch (error: any) {
            console.warn(`[TasksGenerator] Failed to backup existing tasks.json to ${backupTasksJsonPath}: ${error.message}`);
            // Proceed with writing new file even if backup fails, but warn user
            vscode.window.showWarningMessage(`Could not back up existing tasks.json: ${error.message}. It will be overwritten.`);
        }
    }

    const tasksRoot: VsCodeTasksRoot = {
        version: '2.0.0',
        tasks: generatedTasks,
        // 'inputs' are not carried over from old tasks.json by this generator.
        // For complex inputs, the workflow YAML should provide the full tasks.json.
    };

    try {
        fs.writeFileSync(tasksJsonPath, JSON.stringify(tasksRoot, null, 4), 'utf8');
        if (generatedTasks.length > 0) {
            vscode.window.showInformationMessage(`tasks.json has been generated with ${generatedTasks.length} tasks based on scripts in '${pyScriptPathFromConfig}'.`);
        } else {
            vscode.window.showInformationMessage(`tasks.json has been updated. No Python scripts found in '${pyScriptPathFromConfig}' to generate tasks.`);
        }
        console.log(`[TasksGenerator] tasks.json successfully written to ${tasksJsonPath}`);
    } catch (error: any) {
        console.error(`[TasksGenerator] Failed to write tasks.json: ${error.message}`);
        vscode.window.showErrorMessage(`Failed to write tasks.json: ${error.message}`);
    }
}