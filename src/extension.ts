import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import AdmZip from "adm-zip";

// 映射配置接口
interface Mapping {
    sourceUrl: string;
    targetPath: string;
}

import { parse } from 'jsonc-parser';

const ensureSettingsFile = async (workspacePath: string): Promise<void> => {
    const settingsPath = path.join(workspacePath, '.vscode', 'settings.json');
    console.log(`检查文件路径: ${settingsPath}`);

    const initialSettings = {
        "syncFiles.map": [
            {
                "sourceUrl": "",
                "targetPath": ".vscode"
            }
        ]
    };

    try {
        let existingSettings: { [key: string]: any } = {};
        if (fs.existsSync(settingsPath)) {
            console.log(`发现已有的 ${settingsPath}`);
            const content = await fs.promises.readFile(settingsPath, 'utf8');
            existingSettings = parse(content); // 用 jsonc-parser 解析
            if (!existingSettings["syncFiles.map"]) {
                console.log('无 syncFiles.map，添加默认值');
                existingSettings["syncFiles.map"] = initialSettings["syncFiles.map"];
                const settingsContent = JSON.stringify(existingSettings, null, 2);
                await fs.promises.writeFile(settingsPath, settingsContent, 'utf8');
                await vscode.workspace.getConfiguration().update('syncFiles.map', existingSettings["syncFiles.map"], vscode.ConfigurationTarget.Workspace);
                console.log(`已更新 ${settingsPath}`);
            } else {
                console.log('syncFiles.map 已存在，跳过');
            }
        } else {
            console.log(`未找到 ${settingsPath}，创建新文件`);
            fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
            const settingsContent = JSON.stringify(initialSettings, null, 2);
            await fs.promises.writeFile(settingsPath, settingsContent, 'utf8');
            await vscode.workspace.getConfiguration().update('syncFiles.map', initialSettings["syncFiles.map"], vscode.ConfigurationTarget.Workspace);
            console.log(`已更新 ${settingsPath}`);
        }
    } catch (err) {
        console.error(`更新 ${settingsPath} 失败:`, err);
        throw err;
    }
};

export { ensureSettingsFile };
// 视图提供者类
class FetchVscodeRepoViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (!element) {
            const syncButton = new vscode.TreeItem('Start Sync', vscode.TreeItemCollapsibleState.None);
            syncButton.command = {
                command: 'vscode.sync',
                title: 'Start Sync'
            };
            return Promise.resolve([syncButton]);
        }
        return Promise.resolve([]);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('扩展 "SyncFiles" 已激活！');

    // 注册视图
    const viewProvider = new FetchVscodeRepoViewProvider();
    vscode.window.registerTreeDataProvider('syncView', viewProvider);

    // 获取配置
    const getMappings = (): Mapping[] => {
        return vscode.workspace.getConfiguration().get('syncFiles.map') as Mapping[];
    };

    const fetchFile = (url: string, targetPath: string): Promise<void> => {
        return new Promise((resolve, reject) => {
            const request = https.get(url, (response) => {
                if (response.statusCode === 302 && response.headers.location) {
                    console.log(`文件重定向 (${url}) 到: ${response.headers.location}`);
                    fetchFile(response.headers.location, targetPath).then(resolve).catch(reject);
                    return;
                }
                if (response.statusCode !== 200) {
                    console.error(`拉取文件失败 (${url})，状态码: ${response.statusCode}`);
                    reject(new Error(`状态码: ${response.statusCode}`));
                    return;
                }
                let data = '';
                response.on('data', (chunk) => data += chunk);
                response.on('end', () => {
                    const dir = path.dirname(targetPath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFile(targetPath, data, (err) => {
                        if (err) {
                            console.error(`保存文件失败 (${targetPath}):`, err);
                            reject(err);
                        } else {
                            console.log(`文件已保存到 ${targetPath}`);
                            resolve();
                        }
                    });
                });
            });
            request.on('error', (err) => {
                console.error(`下载文件出错 (${url}):`, err);
                reject(err);
            });
        });
    };
    
    const fetchDirectory = (repoUrl: string, dirPath: string, targetPath: string, workspacePath: string): Promise<void> => {
        const repoRoot = repoUrl.replace(/\/tree\/.+$/, '');
        const branchAndPath = repoUrl.match(/\/tree\/(.+)/)?.[1] || 'main';
        const zipUrl = `${repoRoot}/archive/refs/heads/${branchAndPath.split('/')[0]}.zip`;
        const zipPath = path.join(workspacePath, 'temp-repo.zip');
    
        return new Promise((resolve, reject) => {
            const request = https.get(zipUrl, (response) => {
                if (response.statusCode === 302 && response.headers.location) {
                    console.log(`ZIP 重定向 (${zipUrl}) 到: ${response.headers.location}`);
                    fetchDirectoryWithUrl(response.headers.location, dirPath, targetPath, workspacePath).then(resolve).catch(reject);
                    return;
                }
                if (response.statusCode !== 200) {
                    console.error(`拉取 ZIP 失败 (${zipUrl})，状态码: ${response.statusCode}`);
                    reject(new Error(`状态码: ${response.statusCode}`));
                    return;
                }
                const file = fs.createWriteStream(zipPath);
                response.pipe(file);
                file.on('finish', () => {
                    file.close((err) => { // 添加 err 参数
                        if (err) {
                            console.error(`关闭文件失败 (${zipPath}):`, err);
                            reject(err);
                        } else {
                            try {
                                const zip = new AdmZip(zipPath);
                                const extractRoot = zip.getEntries()[0].entryName.split('/')[0];
                                const relativeDir = dirPath.replace(/.*\/tree\/[^\/]+\//, '');
                                const tempExtractPath = path.join(workspacePath, 'temp-extract');
                                zip.extractAllTo(tempExtractPath, true);
                                const sourceDir = path.join(tempExtractPath, extractRoot, relativeDir);
                                mergeDirectory(sourceDir, targetPath);
                                fs.rmSync(tempExtractPath, { recursive: true, force: true });
                                fs.unlinkSync(zipPath);
                                console.log(`目录已保存到 ${targetPath}`);
                                resolve();
                            } catch (err) {
                                console.error('解压或移动目录失败:', err);
                                reject(err);
                            }
                        }
                    });
                });
            });
            request.on('error', (err) => {
                console.error(`下载 ZIP 出错 (${zipUrl}):`, err);
                reject(err);
            });
        });
    };
    
    const fetchDirectoryWithUrl = (zipUrl: string, dirPath: string, targetPath: string, workspacePath: string): Promise<void> => {
        const zipPath = path.join(workspacePath, 'temp-repo.zip');
        return new Promise<void>((resolve, reject) => {
            const request = https.get(zipUrl, (response) => {
                if (response.statusCode === 302 && response.headers.location) {
                    return fetchDirectoryWithUrl(response.headers.location, dirPath, targetPath, workspacePath).then(resolve).catch(reject);
                }
                if (response.statusCode !== 200) {
                    reject(new Error(`拉取失败，状态码: ${response.statusCode}`));
                    return;
                }
                const file = fs.createWriteStream(zipPath);
                response.pipe(file);
                file.on('finish', () => {
                    file.close((err) => { // 添加 err 参数
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
            });
            request.on('error', reject);
        }).then(() => {
            const zip = new AdmZip(zipPath);
            const extractRoot = zip.getEntries()[0].entryName.split('/')[0];
            const decodedPath = decodeURIComponent(dirPath);
            const relativeDir = decodedPath.replace(/.*\/tree\/[^\/]+\//, '');
            const tempExtractPath = path.join(workspacePath, 'temp-extract');
            zip.extractAllTo(tempExtractPath, true);
            const sourceDir = path.join(tempExtractPath, extractRoot, relativeDir);
            mergeDirectory(sourceDir, targetPath); 
            fs.rmSync(tempExtractPath, { recursive: true, force: true });
            fs.unlinkSync(zipPath);
            console.log(`目录已保存到 ${targetPath}`);
        });
    };
    // 新增：合并目录函数，保留现有文件
const mergeDirectory = (sourceDir: string, targetDir: string) => {
    if (!fs.existsSync(sourceDir)) {
        console.warn(`源目录不存在: ${sourceDir}`);
        return;
    }

    // 确保目标目录存在
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    // 读取源目录内容
    const files = fs.readdirSync(sourceDir, { withFileTypes: true });
    for (const file of files) {
        const sourcePath = path.join(sourceDir, file.name);
        const targetPath = path.join(targetDir, file.name);

        if (file.isDirectory()) {
            // 递归合并子目录
            mergeDirectory(sourcePath, targetPath);
        } else {
            // 复制文件，覆盖已存在文件
            fs.copyFileSync(sourcePath, targetPath);
            console.log(`文件已复制: ${targetPath}`);
        }
    }
};
    // 同步所有映射
    const syncAllMappings = async (workspacePath: string) => {
        const mappings = getMappings();
        if (!mappings || mappings.length === 0) {
            vscode.window.showWarningMessage('未配置任何映射，请检查设置');
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "同步 GitHub 文件和目录",
            cancellable: false
        }, async (progress) => {
            progress.report({ message: '开始同步...' });
            try {
                await Promise.all(
                    mappings.map(async (mapping) => {
                        const targetPath = path.join(workspacePath, mapping.targetPath);
                        if (mapping.sourceUrl.includes('raw.githubusercontent.com')) {
                            await fetchFile(mapping.sourceUrl, targetPath);
                        } else if (mapping.sourceUrl.includes('/tree/')) {
                            await fetchDirectory(mapping.sourceUrl, mapping.sourceUrl, targetPath, workspacePath);
                        } else {
                            console.warn(`不支持的 URL 格式: ${mapping.sourceUrl}`);
                        }
                    })
                );
                vscode.window.showInformationMessage('同步完成！');
            } catch (err) {
                console.error('同步出错:', err);
                vscode.window.showErrorMessage('同步过程中出错');
            }
        });
    };
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return;
    }
    const workspacePath = workspaceFolders[0].uri.fsPath;
    context.subscriptions.push(vscode.commands.registerCommand('vscode.sync', async() => {
        await ensureSettingsFile(workspacePath);
        await syncAllMappings(workspacePath);
    }));
}

export function deactivate() {
    console.log('扩展 "SyncFiles" 已停用。');
}