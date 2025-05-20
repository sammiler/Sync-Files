# SyncFiles - VSCode 扩展

**SyncFiles** 是一款 Visual Studio Code 扩展，旨在帮助开发者管理和自动化工作流程。它不仅可以从 GitHub 仓库同步文件和目录到本地工作区，还允许您配置在特定文件系统事件（如文件删除、修改或创建）发生时自动执行 Python 脚本，并提供了在 VSCode 侧边栏直接运行预置 Python 脚本的功能。

## 主要特性

- **文件/目录同步**：
    - 从指定的 GitHub 仓库（支持公共仓库的特定文件或目录）拉取内容到本地工作区。
    - 支持 GitHub 的 `blob/` (单个文件) 和 `tree/` (目录) 链接。
    - 自动处理 GitHub 的 HTTP 302 重定向。
    - **智能合并（目录）**：同步目录时，会合并内容，只覆盖或添加新文件，本地独有的文件会被保留。
- **Python 脚本集成**：
    - **事件驱动的脚本执行**：配置监视指定的文件或目录，当这些路径下发生创建、修改或删除事件时，自动执行您指定的 Python 脚本。
    - **脚本参数传递**：触发的 Python 脚本会接收到事件类型（如 "Change New", "Change Mod", "Change Del"）和受影响文件的完整路径作为命令行参数。
    - **自定义环境变量**：可以为 Python 脚本执行环境配置自定义环境变量。
    - **侧边栏脚本运行器**：在 VSCode 的侧边栏树视图中列出指定目录下的 Python 脚本，方便一键点击运行。
- **用户界面与配置**：
    - **图形化设置界面**：通过 "SyncFiles Settings" 面板轻松配置所有选项，包括 GitHub 映射、环境变量、Python 路径以及文件监视条目。
    - **侧边栏控制中心**：提供 "Start Sync"（手动触发所有 GitHub 同步）、"Refresh Scripts"（刷新侧边栏脚本列表）和 "Open Settings" 按钮。
- **配置持久化**：所有配置都保存在工作区下的 `.vscode/syncfiles.json` 文件中，方便团队共享和版本控制。

## 安装

### 从 VSCode Marketplace (推荐)
1. 打开 VSCode。
2. 转到扩展视图（快捷键 `Ctrl+Shift+X` 或 `Cmd+Shift+X`）。
3. 搜索 `SyncFiles` (请注意，实际发布到市场的名称可能需要您确认)。
4. 点击 “安装”。
5. 重启 VSCode (如果提示)。

### 手动安装 (从 `.vsix` 文件)
1. 从项目的 [Releases 页面](https://github.com/sammiler/SyncFiles/releases) (如果已发布) 下载最新的 `.vsix` 文件。
2. 在 VSCode 中：
   - 转到扩展视图。
   - 点击视图右上角的 `...` (更多操作) 菜单。
   - 选择 “从 VSIX 安装... (Install from VSIX...)”。
   - 选择您下载的 `.vsix` 文件。
3. 重启 VSCode (如果提示)。

## 使用方法与配置详解

### 1. 打开工作区
   - SyncFiles 的所有配置和操作都基于当前打开的 VSCode 工作区。请确保您已打开一个文件夹。

### 2. 配置扩展 (重要)
   - 首次使用或需要修改配置时，请通过以下方式打开设置界面：
     - 点击侧边栏 "SyncFiles" 视图中 "Actions" 下的 **"Open Settings"** 按钮。
     - 或者通过命令面板 (Ctrl+Shift+P) 搜索并运行 "SyncFiles: Open Settings"。

   - **设置界面包含以下主要部分**：

     - **File Mappings (GitHub URL to Local Path)**：
       - **Source URL**: 要同步的 GitHub 文件或目录的 URL。
         - **文件示例**: `https://github.com/user/repo/blob/main/path/to/your/file.txt`
         - **目录示例**: `https://github.com/user/repo/tree/main/path/to/your/directory`
       - **Target Path**: 本地工作区中相对于根目录的目标路径。例如，填入 `.vscode` 会将源内容同步到工作区的 `.vscode` 文件夹下。
       - 点击 "Add Mapping" 添加多条同步规则。

     - **Environment Variables for Python Scripts**:
       - **Variable Name**: 环境变量的名称 (例如 `MY_API_KEY`)。
       - **Value**: 环境变量的值。
       - 这些变量将在执行任何由 SyncFiles 触发的 Python 脚本时注入到其运行环境中。

     - **Python Scripts Directory (for Tree View)**：
       - **路径**: 指定一个相对于工作区根目录的文件夹路径，该文件夹下的 `.py` 文件将显示在侧边栏的 "Scripts" 区域，供您点击运行。
       - 例如，填入 `.vscode/py-scripts`。
       - 点击 "Browse" 可以通过文件对话框选择目录。

     - **Python Executable Path**:
       - **路径**: Python 解释器的绝对路径或相对于工作区根目录的路径。
       - **Windows 示例**: `C:\Python39\python.exe` 或 `..\..\.pyenv\pyenv-win\versions\3.13.2\python.exe`
       - **Linux/macOS 示例**: `/usr/bin/python3` 或 `~/.pyenv/versions/3.11.4/bin/python`
       - 这是执行所有 Python 脚本（包括事件触发和手动运行的）所必需的。
       - 点击 "Browse" 可以通过文件对话框选择可执行文件。

     - **Watched Paths for Events**:
       - **Path to Watch (File or Directory)**: 指定一个相对于工作区根目录的文件或文件夹路径。当此路径下的内容发生变化时，将触发关联的脚本。
         - 点击 "Browse" 可以选择文件或目录。
       - **Python Script on Event**: 指定一个 Python 脚本的路径（相对于工作区根目录），当上述 "Path to Watch" 发生事件时执行此脚本。
         - 点击 "Browse" 可以选择脚本文件。
       - 点击 "Add Watch Entry" 添加多个监视规则。

   - 完成配置后，点击 **"Save Settings"**。配置将保存到工作区的 `.vscode/syncfiles.json` 文件中。

### 3. Python 脚本交互详解

   - **事件触发的脚本**：
     - 当您在 "Watched Paths for Events" 中配置了一个条目，例如：
       - `Path to Watch`: `data/config.json`
       - `Python Script on Event`: `.vscode/py-scripts/handle_config_change.py`
     - 如果 `data/config.json` 文件被 **创建 (Create)**、**修改 (Modify)** 或 **删除 (Delete)**，SyncFiles 会自动执行 `handle_config_change.py`。
     - **参数传递**：被执行的 Python 脚本会接收到两个命令行参数：
       1.  `sys.argv[1]` (第一个参数): 一个字符串，表示事件类型：
           - `"Change New"`: 文件或目录被创建。
           - `"Change Mod"`: 文件或目录被修改。
           - `"Change Del"`: 文件或目录被删除。
       2.  `sys.argv[2]` (第二个参数): 一个字符串，表示**受影响文件或目录的绝对路径**。
     - **示例 Python 脚本 (`handle_config_change.py`)**：
       ```python
       import sys
       import datetime

       if __name__ == "__main__":
           if len(sys.argv) >= 3:
               event_type = sys.argv[1]
               file_path = sys.argv[2]
               timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
               log_message = f"[{timestamp}] Event: {event_type}, Path: {file_path}\n"
               
               # 例如，将日志追加到项目根目录的 event.log 文件
               try:
                   with open("event.log", "a", encoding="utf-8") as f:
                       f.write(log_message)
                   print(f"Logged: {log_message.strip()}")
               except Exception as e:
                   print(f"Error logging event: {e}")
           else:
               print("Script called with insufficient arguments.")
               print(f"Arguments received: {sys.argv}")
       ```
     - **注意**：
       - Python 脚本的当前工作目录 (CWD) 通常是 VSCode 工作区的根目录。
       - 通过 "Environment Variables for Python Scripts" 配置的环境变量在此脚本中可用。
       - 文件监视器触发的脚本执行相关的通知（如“脚本已执行”）默认是**不弹窗**的，以避免在高频事件下打扰用户。错误信息会记录在开发者控制台。

   - **手动运行的脚本 (从侧边栏)**：
     - 在 "Python Scripts Directory (for Tree View)" 中指定的目录下的 `.py` 文件会显示在侧边栏的 "Scripts" 部分。
     - 点击脚本名称旁边的播放图标 ▶️ 来运行它。
     - **参数**：默认情况下，从侧边栏运行的脚本不会传递额外的命令行参数（除了脚本名本身）。如果您需要为这些脚本传递参数，目前需要通过修改扩展代码或使用其他方式（如读取配置文件）来实现。
     - **通知**：手动运行的脚本，其执行成功或失败的通知**会弹窗**显示，包括脚本的 stdout/stderr (如果配置了显示)。
     - 同样，配置的环境变量也对这些脚本可用。

### 4. 执行操作

   - **手动同步 GitHub 文件 (Start Sync)**：
     - 点击侧边栏 "SyncFiles" 视图中 "Actions" 下的 "Start Sync" 按钮。
     - 这会根据您在 "File Mappings" 中的配置，从所有指定的 GitHub URL 拉取内容到对应的本地路径。
     - 通知会提示同步过程和结果。

   - **刷新侧边栏脚本列表 (Refresh Scripts)**：
     - 如果您在 "Python Scripts Directory" 指定的文件夹中添加或删除了 Python 脚本，点击此按钮可以更新侧边栏 "Scripts" 部分的列表。

## 注意事项与故障排查

- **Python 环境**：确保 "Python Executable Path" 配置正确，并且该 Python 环境已安装您脚本所需的所有依赖库。
- **文件路径**：所有在设置中填写的路径（Target Path, Python Scripts Directory, Python Executable Path, Path to Watch, Python Script on Event）都应相对于当前 VSCode **工作区的根目录**，除非是 Python 可执行文件的绝对路径。
- **GitHub URL**：目前仅支持公共 GitHub 仓库。私有仓库或需要认证的访问可能无法工作。
- **首次同步与覆盖**：
    - 对于**文件同步**，如果目标文件已存在，它将被来自 GitHub 的版本覆盖。
    - 对于**目录同步**，它会进行合并：GitHub 仓库中的文件如果本地不存在则添加；如果本地已存在同名文件，则会被覆盖；本地独有的文件则会保留。
- **日志与调试**：
    - 如果遇到问题，请检查 VSCode 的开发者工具控制台获取详细日志：
        1.  菜单栏: "帮助 (Help)" -> "切换开发人员工具 (Toggle Developer Tools)"
        2.  在新窗口/面板中选择 "控制台 (Console)" 标签页。
    - 扩展的 `console.log` 输出会在这里显示，包括文件监视事件、脚本执行命令等。
- **文件监视器行为**：
    - 文件监视器依赖操作系统的事件通知。在某些情况下（如非常快速的连续修改、复杂的外部工具操作如 `git reset --hard`），事件可能被合并或不完全按预期触发。
    - 监视目录时，对目录内深层文件的更改也应该能被捕获。
    - 如果监视不起作用，请仔细检查开发者控制台的日志，确认 watcher 是否已正确为目标路径和 glob 模式设置。
- **配置保存**：更改设置后务必点击 "Save Settings"。配置存储在 `.vscode/syncfiles.json`。建议将此文件加入版本控制（如果适合您的项目）。
- **重载窗口**：在对扩展代码或有时对配置进行重大更改后，通过命令面板运行 "Developer: Reload Window" 可能有助于确保所有更改生效。

## 贡献

欢迎提交 Pull Requests 或 Issues 来改进此扩展！

## 许可证

[MIT](./LICENSE)