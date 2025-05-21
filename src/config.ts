import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { startWatching } from './watcher'; // Keep watcher import for potential re-init on save
// Removed generateUUID import as it's not used directly in this file anymore, but used by callers

export interface Mapping {
    sourceUrl: string;
    targetPath: string;
}

export interface EnvVar {
    key: string;
    value: string;
}

export interface WatchEntry {
    watchedPath: string;
    onEventScript: string;
}

// New interfaces for script groups and items
export interface ScriptItemConfig {
    id: string; // UUID for stable reference
    path: string; // Relative path to the script from pythonScriptPath
    alias?: string;
    description?: string;
    executionMode?: 'vscodeApi' | 'directTerminal'; // Preferred execution method
}

export interface ScriptGroupConfig {
    id: string; // UUID for stable reference
    name: string;
    scripts: ScriptItemConfig[];
}

interface Config {
    mappings: Mapping[];
    envVars: EnvVar[];
    pythonScriptPath: string;
    pythonExecutablePath: string;
    watchEntries: WatchEntry[];
    scriptGroups: ScriptGroupConfig[]; // New: for virtual script groups
}

export function getConfigFilePath(workspacePath: string): string {
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

export function getWatchEntries(workspacePath: string): WatchEntry[] {
    return readConfig(workspacePath).watchEntries || [];
}

export function getScriptGroups(workspacePath: string): ScriptGroupConfig[] {
    return readConfig(workspacePath).scriptGroups || [];
}

// Function to save the entire configuration
export async function saveFullConfig(workspacePath: string, config: Config): Promise<void> {
    const configPath = getConfigFilePath(workspacePath);
    try {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

        // It's important that startWatching and refreshScripts are aware of the full config context
        // If startWatching re-reads the config, this is fine.
        // Consider passing the workspacePath to startWatching and let it re-read.
        startWatching(workspacePath, () => {
            vscode.commands.executeCommand('syncfiles.refreshTreeView');
        });
        await vscode.commands.executeCommand('syncfiles.refreshTreeView'); // Changed command name
    } catch (err) {
        throw new Error(`Failed to save config to ${configPath}: ${(err as Error).message}`);
    }
}


// Updated saveConfig to be more general or use a more specific one like saveCoreSettings
export async function saveCoreSettings(
    workspacePath: string,
    mappings: Mapping[],
    envVars: Map<string, string>,
    pythonScriptPath: string,
    pythonExecutablePath: string,
    watchEntries: WatchEntry[]
    // scriptGroups are managed separately now or by saveFullConfig
): Promise<void> {
    const currentConfig = readConfig(workspacePath);
    const newConfig: Config = {
        ...currentConfig, // Preserve other parts of config like scriptGroups
        mappings: mappings.filter(m => m.sourceUrl && m.targetPath),
        envVars: Array.from(envVars.entries()).map(([key, value]) => ({ key, value })).filter(e => e.key),
        pythonScriptPath,
        pythonExecutablePath,
        watchEntries: watchEntries.filter(w => w.watchedPath && w.onEventScript)
    };
    await saveFullConfig(workspacePath, newConfig);
}


export function readConfig(workspacePath: string): Config {
    const configPath = getConfigFilePath(workspacePath);
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf8');
            const parsedData = JSON.parse(data) as Partial<Config>; // Use Partial for forward compatibility
            return {
                mappings: parsedData.mappings || [],
                envVars: parsedData.envVars || [],
                pythonScriptPath: parsedData.pythonScriptPath || '',
                pythonExecutablePath: parsedData.pythonExecutablePath || '',
                watchEntries: parsedData.watchEntries || [],
                scriptGroups: parsedData.scriptGroups || [] // Default for new field
            };
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to read config from ${configPath}: ${message}`);
        vscode.window.showErrorMessage(`Error reading SyncFiles config: ${message}. A default configuration will be used.`);
    }
    // Default config if file doesn't exist or is corrupted
    return {
        mappings: [],
        envVars: [],
        pythonScriptPath: '',
        pythonExecutablePath: '',
        watchEntries: [],
        scriptGroups: [] // Default for new field
    };
}

// Helper functions to manage scriptGroups specifically
export async function addScriptGroup(workspacePath: string, group: ScriptGroupConfig): Promise<void> {
    const config = readConfig(workspacePath);
    config.scriptGroups.push(group);
    await saveFullConfig(workspacePath, config);
}

export async function updateScriptGroup(workspacePath: string, updatedGroup: ScriptGroupConfig): Promise<void> {
    const config = readConfig(workspacePath);
    const index = config.scriptGroups.findIndex(g => g.id === updatedGroup.id);
    if (index !== -1) {
        config.scriptGroups[index] = updatedGroup;
        await saveFullConfig(workspacePath, config);
    } else {
        throw new Error(`Group with id ${updatedGroup.id} not found.`);
    }
}

export async function removeScriptGroup(workspacePath: string, groupId: string): Promise<void> {
    const config = readConfig(workspacePath);
    config.scriptGroups = config.scriptGroups.filter(g => g.id !== groupId);
    await saveFullConfig(workspacePath, config);
}

export async function addScriptToGroup(workspacePath: string, groupId: string, scriptItem: ScriptItemConfig): Promise<void> {
    const config = readConfig(workspacePath);
    const group = config.scriptGroups.find(g => g.id === groupId);
    if (group) {
        group.scripts.push(scriptItem);
        await saveFullConfig(workspacePath, config);
    } else {
        throw new Error(`Group with id ${groupId} not found.`);
    }
}

export async function updateScriptInGroup(workspacePath: string, groupId: string, updatedScriptItem: ScriptItemConfig): Promise<void> {
    const config = readConfig(workspacePath);
    const group = config.scriptGroups.find(g => g.id === groupId);
    if (group) {
        const scriptIndex = group.scripts.findIndex(s => s.id === updatedScriptItem.id);
        if (scriptIndex !== -1) {
            group.scripts[scriptIndex] = updatedScriptItem;
            await saveFullConfig(workspacePath, config);
        } else {
            throw new Error(`Script with id ${updatedScriptItem.id} not found in group ${groupId}.`);
        }
    } else {
        throw new Error(`Group with id ${groupId} not found.`);
    }
}

export async function removeScriptFromGroup(workspacePath: string, groupId: string, scriptId: string): Promise<void> {
    const config = readConfig(workspacePath);
    const group = config.scriptGroups.find(g => g.id === groupId);
    if (group) {
        group.scripts = group.scripts.filter(s => s.id !== scriptId);
        await saveFullConfig(workspacePath, config);
    } else {
        throw new Error(`Group with id ${groupId} not found.`);
    }
}

// Find a script item and its parent group by script ID
export function findScriptAndGroup(workspacePath: string, scriptId: string): { group: ScriptGroupConfig, script: ScriptItemConfig } | null {
    const groups = getScriptGroups(workspacePath);
    for (const group of groups) {
        const script = group.scripts.find(s => s.id === scriptId);
        if (script) {
            return { group, script };
        }
    }
    return null;
}

// Function to get all script paths currently assigned to any group
export function getAllAssignedScriptPaths(workspacePath: string): Set<string> {
    const groups = getScriptGroups(workspacePath);
    const assignedPaths = new Set<string>();
    groups.forEach(group => {
        group.scripts.forEach(script => {
            assignedPaths.add(script.path);
        });
    });
    return assignedPaths;
}