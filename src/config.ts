import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { startWatching } from './watcher'; // Keep watcher import for potential re-init on save

export interface Mapping {
    sourceUrl: string;
    targetPath: string;
}

export interface EnvVar {
    key: string;
    value: string;
}

export interface WatchEntry { // New interface for watched entries
    watchedPath: string;
    onDeleteScript: string;
}

interface Config {
    mappings: Mapping[];
    envVars: EnvVar[];
    pythonScriptPath: string; // Directory for scripts listed in the tree view
    pythonExecutablePath: string;
    watchEntries: WatchEntry[]; // New config property
}

// Updated config file path
export function getConfigFilePath(workspacePath: string): string {
    // Ensure .vscode directory exists, though saveConfig will also do this.
    // This is more for functions that might read before a save occurs.
    const vscodeDir = path.join(workspacePath, '.vscode');
    if (!fs.existsSync(vscodeDir)) {
        fs.mkdirSync(vscodeDir, { recursive: true });
    }
    return path.join(workspacePath, '.vscode', 'syncfiles.json');
}

export function getMappings(workspacePath: string): Mapping[] {
    return readConfig(workspacePath).mappings;
}

export function getEnvVars(workspacePath: string): Map<string, string> {
    const config = readConfig(workspacePath);
    const map = new Map<string, string>();
    config.envVars.forEach(e => {
        if (e.key) {
            map.set(e.key, e.value || '');
        }
    });
    return map;
}

export function getPythonScriptPath(workspacePath: string): string {
    return readConfig(workspacePath).pythonScriptPath || '';
}

export function getPythonExecutablePath(workspacePath: string): string {
    return readConfig(workspacePath).pythonExecutablePath || '';
}

export function getWatchEntries(workspacePath: string): WatchEntry[] { // New getter
    return readConfig(workspacePath).watchEntries || [];
}

export async function saveConfig(
    mappings: Mapping[],
    envVars: Map<string, string>,
    pythonScriptPath: string,
    pythonExecutablePath: string,
    watchEntries: WatchEntry[], // Add watchEntries to parameters
    workspacePath: string
): Promise<void> {
    const config: Config = {
        mappings: mappings.filter(m => m.sourceUrl && m.targetPath),
        envVars: Array.from(envVars.entries()).map(([key, value]) => ({ key, value })).filter(e => e.key),
        pythonScriptPath,
        pythonExecutablePath,
        watchEntries: watchEntries.filter(w => w.watchedPath && w.onDeleteScript) // Filter invalid entries
    };

    const configPath = getConfigFilePath(workspacePath);
    try {
        // fs.mkdirSync will create .vscode if it doesn't exist, and syncfiles subfolder if specified and doesn't exist.
        // getConfigFilePath now ensures .vscode exists, so this mainly ensures the direct parent of config.json exists.
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        
        // Update watcher and refresh UI after saving config
        // This will re-initialize all watchers, including the new deletion watchers
        startWatching(workspacePath, () => {
            vscode.commands.executeCommand('vscode.refreshScripts'); // This refreshes the tree view scripts
        });
        // Ensure immediate UI refresh for tree view
        await vscode.commands.executeCommand('vscode.refreshScripts');
    } catch (err) {
        throw new Error(`Failed to save config to ${configPath}: ${(err as Error).message}`);
    }
}

function readConfig(workspacePath: string): Config {
    const configPath = getConfigFilePath(workspacePath);
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf8');
            const parsedData = JSON.parse(data) as Config;
            // Ensure new fields have default values if loading an old config
            return {
                mappings: parsedData.mappings || [],
                envVars: parsedData.envVars || [],
                pythonScriptPath: parsedData.pythonScriptPath || '',
                pythonExecutablePath: parsedData.pythonExecutablePath || '',
                watchEntries: parsedData.watchEntries || [] // Default for new field
            };
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to read config from ${configPath}: ${message}`);
        // Log to VS Code output channel for better visibility
        vscode.window.showErrorMessage(`Error reading SyncFiles config: ${message}. A default configuration will be used.`);
    }
    // Default config if file doesn't exist or is corrupted
    return {
        mappings: [],
        envVars: [],
        pythonScriptPath: '',
        pythonExecutablePath: '',
        watchEntries: [] // Default for new field
    };
}