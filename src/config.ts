import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { startWatching } from './watcher';
import { ensureAbsolute, generateUUID } from './utils'; // generateUUID might be needed here

export const DEFAULT_SCRIPT_GROUP_ID = "syncfiles-default-group-id";

export interface Mapping { sourceUrl: string; targetPath: string; }
export interface EnvVar { key: string; value: string; }
export interface WatchEntry { watchedPath: string; onEventScript: string; }
export interface ScriptItemConfig {
    id: string;
    path: string;
    alias?: string;
    description?: string;
    executionMode?: 'vscodeApi' | 'directTerminal';
}
export interface ScriptGroupConfig { id: string; name: string; scripts: ScriptItemConfig[]; }
export interface Config {
    mappings: Mapping[];
    envVars: EnvVar[];
    pythonScriptPath: string;
    pythonExecutablePath: string;
    watchEntries: WatchEntry[];
    scriptGroups: ScriptGroupConfig[];
}

export function getConfigFilePath(workspacePath: string): string {
    const vscodeDir = path.join(workspacePath, '.vscode');
    if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir, { recursive: true });
    return path.join(workspacePath, '.vscode', 'syncfiles.json');
}

export function getMappings(workspacePath: string): Mapping[] { return readConfig(workspacePath).mappings; }
export function getEnvVars(workspacePath: string): Map<string, string> {
    const config = readConfig(workspacePath);
    const map = new Map<string, string>();
    (config.envVars || []).forEach(e => { if (e.key) map.set(e.key, e.value || ''); });
    return map;
}
export function getPythonScriptPath(workspacePath: string): string { return readConfig(workspacePath).pythonScriptPath || ''; }
export function getPythonExecutablePath(workspacePath: string): string { return readConfig(workspacePath).pythonExecutablePath || ''; }
export function getWatchEntries(workspacePath: string): WatchEntry[] { return readConfig(workspacePath).watchEntries || []; }
export function getScriptGroups(workspacePath: string): ScriptGroupConfig[] { return readConfig(workspacePath).scriptGroups || []; }
export function getDefaultGroupNameSetting(): string { return vscode.workspace.getConfiguration('syncfiles.scripts').get<string>('defaultGroupName') || "Default"; }

// src/config.ts
export function synchronizeConfigWithFileSystem(config: Config, workspacePath: string): boolean {
    let changed = false;
    const defaultGroupNameFromSettings = getDefaultGroupNameSetting();

    // Ensure Default Group structure (always do this)
    let defaultGroup = config.scriptGroups.find(g => g.id === DEFAULT_SCRIPT_GROUP_ID);
    if (!defaultGroup) {
        defaultGroup = { id: DEFAULT_SCRIPT_GROUP_ID, name: defaultGroupNameFromSettings, scripts: [] };
        config.scriptGroups.unshift(defaultGroup);
        changed = true;
    } else {
        if (defaultGroup.name !== defaultGroupNameFromSettings) { defaultGroup.name = defaultGroupNameFromSettings; changed = true; }
        if (!defaultGroup.scripts) { defaultGroup.scripts = []; changed = true; }
    }

    const pythonScriptDirSetting = config.pythonScriptPath;

    if (pythonScriptDirSetting && pythonScriptDirSetting.trim() !== "") {
        // ... (Existing logic for when pythonScriptPath IS SET - scan, remove non-existent, add new to Default) ...
        // This part remains the same as the last full version.
        const resolvedScriptDirPath = ensureAbsolute(pythonScriptDirSetting, workspacePath);
        if (fs.existsSync(resolvedScriptDirPath) && fs.statSync(resolvedScriptDirPath).isDirectory()) {
            const filesInDir = new Set(fs.readdirSync(resolvedScriptDirPath).filter(f => f.toLowerCase().endsWith('.py') && !fs.statSync(path.join(resolvedScriptDirPath, f)).isDirectory()));
            const allPathsInConfigAfterCleanup = new Set<string>();

            for (const group of config.scriptGroups) {
                if (group.scripts) {
                    const initialCount = group.scripts.length;
                    group.scripts = group.scripts.filter(scriptItem => {
                        const fileExists = filesInDir.has(scriptItem.path);
                        if (!fileExists) {
                            console.log(`[SyncConfig] Script file '${scriptItem.path}' in group '${group.name}' no longer exists. Removing.`);
                            // changed = true; // This will be set if initialCount changes
                        }
                        return fileExists;
                    });
                    if (group.scripts.length !== initialCount) changed = true;
                    group.scripts.forEach(s => allPathsInConfigAfterCleanup.add(s.path));
                }
            }
            
            const dg = config.scriptGroups.find(g => g.id === DEFAULT_SCRIPT_GROUP_ID);
             if (dg) {
                if (!dg.scripts) dg.scripts = [];
                for (const fileName of filesInDir) {
                    if (!allPathsInConfigAfterCleanup.has(fileName)) {
                        dg.scripts.push({ id: generateUUID(), path: fileName, executionMode: 'directTerminal', description: `Auto-added ${new Date().toLocaleDateString()}` });
                        changed = true;
                        console.log(`[SyncConfig] New script '${fileName}' added to Default group.`);
                    }
                }
            }
        } else {
            console.warn(`[SyncConfig] pythonScriptPath '${resolvedScriptDirPath}' is invalid. Skipping filesystem sync for scripts, but will check for existing configured scripts that might now be orphaned.`);
            // If the configured script directory is now invalid, we should remove scripts that were expected to be there.
            // This assumes scriptItem.path is relative to the (now invalid) pythonScriptPath.
            // This is aggressive if the directory is temporarily unavailable.
            // A safer bet is to do nothing here and let user manually clean them or fix the path.
            // For now, let's stick to only removing if file doesn't exist when dir *is* valid.
            // If pythonScriptPath becomes invalid, existing items remain until their path is empty or user removes them.
        }
    } else {
        // pythonScriptPath IS EMPTY or whitespace only.
        console.log("[SyncConfig] pythonScriptPath is not set. Clearing all script items from all groups.");
        let scriptsWereCleared = false;
        for (const group of config.scriptGroups) {
            if (group.scripts && group.scripts.length > 0) {
                group.scripts = []; // Clear all scripts from this group
                scriptsWereCleared = true;
            }
        }
        if (scriptsWereCleared) {
            changed = true;
        }
        // Default group's scripts are also cleared by the loop above if it had any.
    }
    return changed;
}
export async function saveFullConfig(workspacePath: string, config: Config): Promise<void> {
    const configPath = getConfigFilePath(workspacePath);
    try {
        // MUTATES config object by removing scripts with empty paths
        if (config.scriptGroups) {
            config.scriptGroups.forEach(group => {
                if (group.scripts) {
                    group.scripts = group.scripts.filter(script => typeof script.path === 'string' && script.path.trim() !== '');
                }
            });
        }

        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        
        startWatching(workspacePath, async () => { 
            await vscode.commands.executeCommand('syncfiles.refreshTreeView'); 
        });
    } catch (err) { 
        throw new Error(`Failed to save config to ${configPath}: ${(err as Error).message}`); 
    }
}

export async function saveCoreSettings(workspacePath: string, mappings: Mapping[], envVars: Map<string, string>, pythonScriptPath: string, pythonExecutablePath: string, watchEntries: WatchEntry[]): Promise<void> {
    let currentConfig = readConfig(workspacePath); // Read fresh config
    // Update specific fields
    currentConfig.mappings = mappings.filter(m => m.sourceUrl && m.targetPath);
    currentConfig.envVars = Array.from(envVars.entries()).map(([key, value]) => ({ key, value })).filter(e => e.key);
    currentConfig.pythonScriptPath = pythonScriptPath;
    currentConfig.pythonExecutablePath = pythonExecutablePath;
    currentConfig.watchEntries = watchEntries.filter(w => w.watchedPath && w.onEventScript);
    
    // Synchronize this potentially modified config with the filesystem before saving
    synchronizeConfigWithFileSystem(currentConfig, workspacePath); // This mutates currentConfig

    await saveFullConfig(workspacePath, currentConfig); 
    await vscode.commands.executeCommand('syncfiles.refreshTreeView');
}

export function readConfig(workspacePath: string): Config {
    const configPath = getConfigFilePath(workspacePath);
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf8');
            const parsedData = JSON.parse(data) as Partial<Config>;
            return { 
                mappings: parsedData.mappings || [], 
                envVars: parsedData.envVars || [], 
                pythonScriptPath: parsedData.pythonScriptPath || '', 
                pythonExecutablePath: parsedData.pythonExecutablePath || '', 
                watchEntries: parsedData.watchEntries || [], 
                scriptGroups: parsedData.scriptGroups || [] 
            };
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to read config from ${configPath}: ${message}`);
        vscode.window.showErrorMessage(`Error reading SyncFiles config: ${message}. A default configuration will be used.`);
    }
    return { mappings: [], envVars: [], pythonScriptPath: '', pythonExecutablePath: '', watchEntries: [], scriptGroups: [] };
}

export async function addScriptGroup(workspacePath: string, group: ScriptGroupConfig): Promise<void> {
    const config = readConfig(workspacePath);
    config.scriptGroups.push(group);
    // synchronizeConfigWithFileSystem will be called by saveFullConfig
    await saveFullConfig(workspacePath, config); 
}

export async function updateScriptGroup(workspacePath: string, updatedGroup: ScriptGroupConfig): Promise<void> {
    const config = readConfig(workspacePath);
    const groupIndex = config.scriptGroups.findIndex(g => g.id === updatedGroup.id);
    if (groupIndex !== -1) {
        if (updatedGroup.id === DEFAULT_SCRIPT_GROUP_ID) config.scriptGroups[groupIndex].name = updatedGroup.name;
        else config.scriptGroups[groupIndex] = updatedGroup;
        await saveFullConfig(workspacePath, config);
    } else { 
        throw new Error(`Group with id ${updatedGroup.id} not found for update.`); 
    }
}

export async function removeScriptGroupAndSave(workspacePath: string, groupId: string): Promise<void> { // Renamed to avoid conflict with internal vars
    let config = readConfig(workspacePath);
    if (groupId === DEFAULT_SCRIPT_GROUP_ID) { 
        vscode.window.showWarningMessage("The Default group cannot be deleted."); 
        return; // Do not proceed with removal
    }
    config.scriptGroups = config.scriptGroups.filter(g => g.id !== groupId);
    await saveFullConfig(workspacePath, config);
}

export async function addScriptToGroupAndSave(workspacePath: string, groupId: string, scriptItem: ScriptItemConfig): Promise<void> { // Renamed
    const config = readConfig(workspacePath);
    const targetGroup = config.scriptGroups.find(g => g.id === groupId);
    if (targetGroup) {
        if (!targetGroup.scripts) targetGroup.scripts = [];
        if (targetGroup.scripts.some(s => s.path === scriptItem.path)) { 
            vscode.window.showWarningMessage(`Script '${scriptItem.path}' is already in group '${targetGroup.name}'.`); 
            return; 
        }
        targetGroup.scripts.push(scriptItem);
        // No need to explicitly remove from Default here, synchronizeConfigWithFileSystem will handle it if script path is set
        await saveFullConfig(workspacePath, config);
    } else { 
        throw new Error(`Target group with id ${groupId} not found.`); 
    }
}

export async function updateScriptInGroupAndSave(workspacePath: string, groupId: string, updatedScriptItem: ScriptItemConfig): Promise<void> { // Renamed
    const config = readConfig(workspacePath);
    const group = config.scriptGroups.find(g => g.id === groupId);
    if (group && group.scripts) {
        const scriptIndex = group.scripts.findIndex(s => s.id === updatedScriptItem.id);
        if (scriptIndex !== -1) {
            group.scripts[scriptIndex] = updatedScriptItem;
        } else { 
            throw new Error(`Script with id ${updatedScriptItem.id} not found in group ${groupId}.`); 
        }
        await saveFullConfig(workspacePath, config);
    } else { 
        if (!group) throw new Error(`Group with id ${groupId} not found.`); 
        else throw new Error(`Scripts array missing in group ${groupId}.`); 
    }
}

export function findScriptAndGroup(workspacePath: string, scriptId: string): { group: ScriptGroupConfig, script: ScriptItemConfig } | null {
    const groups = getScriptGroups(workspacePath); // Reads fresh config
    for (const group of groups) { 
        if (group.scripts) { 
            const script = group.scripts.find(s => s.id === scriptId); 
            if (script) return { group, script }; 
        } 
    }
    return null;
}

// This version of getAllAssignedScriptPaths takes a Config object
export function getAllAssignedScriptPaths(config: Config): Set<string> {
    const assignedPaths = new Set<string>();
    (config.scriptGroups || []).forEach(group => { 
        (group.scripts || []).forEach(script => { 
            if (script.path && script.path.trim() !== '') {
                assignedPaths.add(script.path); 
            }
        }); 
    });
    return assignedPaths;
}