import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import AdmZip from 'adm-zip';
import { Mapping, getMappings } from './config';

export function fetchFile(url: string, targetPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { headers: { 'User-Agent': 'VSCode-SyncFiles-Extension' } }, (response) => {
            if (response.statusCode === 302 && response.headers.location) {
                return fetchFile(response.headers.location, targetPath).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to fetch file (${url}). Status: ${response.statusCode}`));
                return;
            }
            const dir = path.dirname(targetPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const file = fs.createWriteStream(targetPath);
            response.pipe(file);
            file.on('finish', () => file.close(err => err ? reject(err) : resolve()));
            file.on('error', reject);
        });
        request.on('error', reject);
    });
}

export function fetchDirectory(repoUrl: string, targetPath: string, workspacePath: string): Promise<void> {
    const normalizedUrl = repoUrl.replace(/\/tree\/.+$/, '');
    const branchAndPath = repoUrl.match(/\/tree\/(.+)/)?.[1] || 'main';
    const branch = branchAndPath.split('/')[0];
    const subPath = branchAndPath.split('/').slice(1).join('/');
    const zipUrl = `${normalizedUrl}/archive/refs/heads/${branch}.zip`;
    const zipPath = path.join(workspacePath, 'temp-repo.zip');
    const tempExtractPath = path.join(workspacePath, 'temp-extract');

    return new Promise((resolve, reject) => {
        const request = https.get(zipUrl, { headers: { 'User-Agent': 'VSCode-SyncFiles-Extension' } }, (response) => {
            if (response.statusCode === 302 && response.headers.location) {
                return fetchDirectoryWithUrl(response.headers.location, subPath, targetPath, workspacePath).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to fetch ZIP (${zipUrl}). Status: ${response.statusCode}`));
                return;
            }
            const file = fs.createWriteStream(zipPath);
            response.pipe(file);
            file.on('finish', () => {
                file.close(async err => {
                    if (err) return reject(err);
                    try {
                        const zip = new AdmZip(zipPath);
                        const extractRoot = zip.getEntries()[0].entryName.split('/')[0];
                        zip.extractAllTo(tempExtractPath, true);
                        const sourceDir = path.join(tempExtractPath, extractRoot, subPath);
                        await mergeDirectory(sourceDir, targetPath);
                        fs.rmSync(tempExtractPath, { recursive: true, force: true });
                        fs.unlinkSync(zipPath);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });
            });
        });
        request.on('error', reject);
    });
}

async function fetchDirectoryWithUrl(zipUrl: string, subPath: string, targetPath: string, workspacePath: string): Promise<void> {
    subPath = decodeURIComponent(subPath);
    const zipPath = path.join(workspacePath, 'temp-repo.zip');
    const tempExtractPath = path.join(workspacePath, 'temp-extract');
    
    await new Promise<void>((resolve, reject) => {
        const request = https.get(zipUrl, { headers: { 'User-Agent': 'VSCode-SyncFiles-Extension' } }, (response) => {
            if (response.statusCode === 302 && response.headers.location) {
                return fetchDirectoryWithUrl(response.headers.location, subPath, targetPath, workspacePath).then(resolve).catch(reject);
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to fetch ZIP. Status: ${response.statusCode}`));
                return;
            }
            const file = fs.createWriteStream(zipPath);
            response.pipe(file);
            file.on('finish', () => file.close(err => err ? reject(err) : resolve()));
        });
        request.on('error', reject);
    });

    const zip = new AdmZip(zipPath);
    const extractRoot = zip.getEntries()[0].entryName.split('/')[0];
    zip.extractAllTo(tempExtractPath, true);
    const sourceDir = path.join(tempExtractPath, extractRoot, subPath);
    await mergeDirectory(sourceDir, targetPath);
    fs.rmSync(tempExtractPath, { recursive: true, force: true });
    fs.unlinkSync(zipPath);
}

async function mergeDirectory(sourceDir: string, targetDir: string): Promise<void> {
    if (!fs.existsSync(sourceDir)) {
        console.warn(`Source directory does not exist: ${sourceDir}`);
        return;
    }
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    const files = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const file of files) {
        const sourcePath = path.join(sourceDir, file.name);
        const targetPath = path.join(targetDir, file.name);
        if (file.isDirectory()) {
            await mergeDirectory(sourcePath, targetPath);
        } else {
            if (!fs.existsSync(targetPath) || !filesAreIdentical(sourcePath, targetPath)) {
                fs.copyFileSync(sourcePath, targetPath);
                console.log(`File copied: ${targetPath}`);
            }
        }
    }
}

function filesAreIdentical(source: string, target: string): boolean {
    const sourceStats = fs.statSync(source);
    const targetStats = fs.statSync(target);
    if (sourceStats.size !== targetStats.size) return false;
    if (sourceStats.size === 0) return true;
    const sourceData = fs.readFileSync(source);
    const targetData = fs.readFileSync(target);
    return sourceData.equals(targetData);
}

export async function syncAllMappings(workspacePath: string): Promise<void> {
    const mappings = getMappings(workspacePath);

    if (mappings.length === 0) {
        vscode.window.showWarningMessage('No mappings configured. Please check settings.');
        return;
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Syncing GitHub Files',
        cancellable: false
    }, async (progress) => {
        progress.report({ message: 'Starting synchronization...' });
        let count = 0;
        const total = mappings.length;

        for (const mapping of mappings) {
            count++;
            progress.report({ message: `Syncing (${count}/${total}): ${mapping.sourceUrl.substring(0, 50)}...`, increment: (1 / total) * 100 });
            const targetPath = path.join(workspacePath, mapping.targetPath);
            try {
                if (mapping.sourceUrl.includes('raw.githubusercontent.com') || mapping.sourceUrl.includes('/blob/')) {
                    const rawUrl = mapping.sourceUrl.replace('/blob/', '/raw/');
                    await fetchFile(rawUrl, targetPath);
                } else if (mapping.sourceUrl.includes('/tree/')) {
                    await fetchDirectory(mapping.sourceUrl, targetPath, workspacePath);
                } else {
                    vscode.window.showWarningMessage(`Unsupported URL format: ${mapping.sourceUrl}`);
                }
            } catch (err) {
                console.error(`Error syncing ${mapping.sourceUrl}:`, err);
                throw err;
            }
        }
        progress.report({ message: 'Synchronization complete.' });
    });
}