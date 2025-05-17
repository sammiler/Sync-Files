import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { startWatching } from './watcher';

export interface Mapping {
    sourceUrl: string;
    targetPath: string;
}

export interface EnvVar {
    key: string;
    value: string;
}

interface Config {
    mappings: Mapping[];
    envVars: EnvVar[];
    pythonScriptPath: string;
    pythonExecutablePath: string;
}

export function getConfigFilePath(workspacePath: string): string {
    return path.join(workspacePath, '.syncfiles', 'config.json');
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

export async function saveConfig(
    mappings: Mapping[],
    envVars: Map<string, string>,
    pythonScriptPath: string,
    pythonExecutablePath: string,
    workspacePath: string
): Promise<void> {
    const config: Config = {
        mappings: mappings.filter(m => m.sourceUrl && m.targetPath),
        envVars: Array.from(envVars.entries()).map(([key, value]) => ({ key, value })).filter(e => e.key),
        pythonScriptPath,
        pythonExecutablePath
    };

    const configPath = getConfigFilePath(workspacePath);
    try {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        // Update watcher and refresh UI after saving config
        startWatching(workspacePath, () => {
            vscode.commands.executeCommand('vscode.refreshScripts');
        });
        // Ensure immediate UI refresh
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
            return JSON.parse(data) as Config;
        }
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to read config from ${configPath}: ${message}`);
    }
    return {
        mappings: [],
        envVars: [],
        pythonScriptPath: '',
        pythonExecutablePath: ''
    };
}