import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getPythonScriptPath } from './config';

const watchers: Map<string, vscode.FileSystemWatcher> = new Map();

export function addWatch(workspacePath: string, dirPath: string, onChange: () => void): void {
    if (!dirPath) {
        console.log('No directory path provided for watching.');
        return;
    }

    const absolutePath = path.resolve(workspacePath, dirPath);
    if (!fs.existsSync(absolutePath)) {
        console.log(`Directory does not exist: ${absolutePath}`);
        return;
    }

    // Avoid duplicate watchers
    if (watchers.has(absolutePath)) {
        console.log(`Already watching directory: ${absolutePath}`);
        return;
    }

    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(absolutePath, '**/*.py')
    );
    watcher.onDidChange(() => {
        console.log(`Python script changed in ${absolutePath}`);
        onChange();
    });
    watcher.onDidCreate(() => {
        console.log(`Python script created in ${absolutePath}`);
        onChange();
    });
    watcher.onDidDelete(() => {
        console.log(`Python script deleted in ${absolutePath}`);
        onChange();
    });

    watchers.set(absolutePath, watcher);
    console.log(`Added watch for directory: ${absolutePath}`);
}

export function startWatching(workspacePath: string, onChange: () => void): void {
    stopWatching();
    const scriptPath = getPythonScriptPath(workspacePath);
    if (scriptPath) {
        addWatch(workspacePath, scriptPath, onChange);
    } else {
        console.log('No valid Python script path configured for watching.');
    }
}

export function stopWatching(): void {
    watchers.forEach((watcher, path) => {
        watcher.dispose();
        console.log(`Stopped watching directory: ${path}`);
    });
    watchers.clear();
}