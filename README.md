# SyncFiles - VSCode Extension



**SyncFiles** 是一款轻量级的 Visual Studio Code 扩展，旨在帮助开发者从 GitHub 仓库自动同步配置文件（如 `.vscode/settings.json`）到本地工作区。无论是个人项目还是团队协作，SyncFiles 都能确保你的 VSCode 配置保持最新，提升开发效率。

## 特性

- **自动同步**：从指定的 GitHub 仓库拉取文件或目录到本地 `.vscode` 文件夹。
- **智能合并**：保留本地文件，只覆盖或添加新文件，避免破坏现有配置。
- **初始配置**：首次使用时自动创建 `.vscode/settings.json`，并提供默认同步设置。
- **用户友好**：通过左侧活动栏的 “Start Sync” 按钮一键触发同步。
- **支持重定向**：无缝处理 GitHub 的 302 重定向，确保下载稳定。

## 安装

### 从 VSCode Marketplace 安装
1. 打开 VSCode。
2. 转到扩展视图（`Ctrl+Shift+X` 或 `Cmd+Shift+X`）。
3. 搜索 `SyncFiles`。
4. 点击 “安装”。

### 手动安装
1. 下载最新的 `.vsix` 文件（发布版本可在 [Releases](https://github.com/sammiler/SyncFiles/releases) 获取）。
2. 在 VSCode 中：
   - 转到扩展视图。
   - 点击右上角的 `...` 菜单，选择 “从 VSIX 安装”。
   - 选择下载的 `.vsix` 文件。
3. 重启 VSCode。

## 使用方法

1. **打开工作区**：
   - 确保在 VSCode 中打开一个文件夹作为工作区。
2. **触发同步**：
   - 点击左侧活动栏的 “Sync Files” 图标。
   - 在 “Sync Control” 视图中，点击 “Start Sync” 按钮。
