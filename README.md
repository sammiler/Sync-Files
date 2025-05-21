# SyncFiles - VSCode 扩展

**SyncFiles** 是一款 Visual Studio Code 扩展，旨在帮助开发者管理和自动化工作流程。它不仅可以从 GitHub 仓库同步文件和目录到本地工作区，还允许您配置在特定文件系统事件（如文件删除、修改或创建）发生时自动执行 Python 脚本，并提供了在 VSCode 侧边栏通过可交互的树视图来组织、管理和运行预置 Python 脚本的功能。

## 主要特性

- **文件/目录同步**：
    - 从指定的 GitHub 仓库（支持公共仓库的特定文件或目录）拉取内容到本地工作区。
    - 支持 GitHub 的 `blob/` (单个文件) 和 `tree/` (目录) 链接。
    - 自动处理 GitHub 的 HTTP 302 重定向。
    - **智能合并（目录）**：同步目录时，会合并内容，只覆盖或添加新文件，本地独有的文件会被保留。
- **Python 脚本集成与管理**：
    - **虚拟脚本组**：在插件UI中创建逻辑分类（如 "数据处理", "工具脚本"），将位于 `pythonScriptPath` 下的 `.py` 文件分配到这些组中。脚本的别名、描述和分组信息存储在配置文件中。
    - **事件驱动的脚本执行**：配置监视指定的文件或目录，当这些路径下发生创建、修改或删除事件时，自动执行您指定的 Python 脚本。
    - **脚本参数传递（事件驱动）**：触发的 Python 脚本会接收到事件类型（如 "Change New", "Change Mod", "Change Del"）和受影响文件的完整路径作为命令行参数。
    - **自定义环境变量**：可以为 Python 脚本执行环境配置自定义环境变量。
    - **侧边栏脚本运行器**：在 VSCode 的侧边栏树视图中以虚拟组的形式列出指定目录 (`pythonScriptPath`) 下的 Python 脚本。
        - 支持为脚本设置别名和描述。
        - 提供右键上下文菜单进行多种操作：运行（默认方式、后台API、终端）、配置脚本详情（别名/描述）、设置默认执行方式、设置左键单击行为、移动到不同组、从组中移除等。
        - **可配置的左键单击行为**：用户可以通过右键菜单设置左键单击脚本项是“无操作”（默认）、“打开文件”还是“执行默认方法”。
- **用户界面与配置**：
    - **图形化设置界面**：通过 "SyncFiles Settings" 面板轻松配置核心选项，包括 GitHub 映射、环境变量、Python 路径以及文件监视条目。
    - **侧边栏控制中心**：提供 "Start Sync"（手动触发所有 GitHub 同步）、"Refresh Tree View"（刷新配置和脚本树）和 "Open Settings" 按钮。
- **配置持久化**：所有配置（包括脚本组和脚本项的详细信息）都保存在工作区下的 `.vscode/syncfiles.json` 文件中，方便团队共享和版本控制。

## 安装

### 从 VSCode Marketplace (推荐)
1.  打开 VSCode。
2.  转到扩展视图（快捷键 `Ctrl+Shift+X` 或 `Cmd+Shift+X`）。
3.  搜索 `SyncFiles` (请注意：这是假设的发布名称，请替换为您的实际发布名称)。
4.  点击 “安装”。
5.  重启 VSCode (如果提示)。

### 手动安装 (从 `.vsix` 文件)
1.  从项目的 [Releases 页面](https://github.com/sammiler/SyncFiles/releases) (如果已发布) 下载最新的 `.vsix` 文件。
2.  在 VSCode 中：
    *   转到扩展视图。
    *   点击视图右上角的 `...` (更多操作) 菜单。
    *   选择 “从 VSIX 安装... (Install from VSIX...)”。
    *   选择您下载的 `.vsix` 文件。
3.  重启 VSCode (如果提示)。

## 使用方法与配置详解

### 1. 打开工作区
   - SyncFiles 的所有配置和操作都基于当前打开的 VSCode 工作区。请确保您已打开一个文件夹。

### 2. 配置核心设置 (通过设置界面)
   - 首次使用或需要修改核心配置时，请通过以下方式打开设置界面：
     - 点击侧边栏 "SyncFiles" 视图中 "Actions" 下的 **"Open Settings"** 按钮。
     - 或者通过命令面板 (Ctrl+Shift+P) 搜索并运行 "SyncFiles: Open Settings"。

   - **设置界面包含以下主要部分**：

     - **File Mappings (GitHub URL to Local Path)**：
       - **Source URL**: 要同步的 GitHub 文件或目录的 URL。
         - 文件示例: `https://github.com/user/repo/blob/main/path/to/your/file.txt`
         - 目录示例: `https://github.com/user/repo/tree/main/path/to/your/directory`
       - **Target Path**: 本地工作区中相对于根目录的目标路径。例如，填入 `.vscode`。
       - 点击 "Add Mapping" 添加多条同步规则。

     - **Environment Variables for Python Scripts**:
       - **Variable Name**: 环境变量的名称 (例如 `MY_API_KEY`)。
       - **Value**: 环境变量的值。
       - 这些变量将在执行任何由 SyncFiles 触发的 Python 脚本时注入到其运行环境中。

     - **Python Scripts Directory (for Tree View)** (`pythonScriptPath`)：
       - **路径**: 指定一个相对于工作区根目录的文件夹路径。该文件夹下的 `.py` 文件将是侧边栏脚本树的数据源。
       - 例如，填入 `.vscode/py-scripts`。如果留空，插件将不会自动从文件系统同步脚本到配置中（即不会自动添加新脚本或移除已删除文件的脚本项），此时脚本项需要完全通过UI手动管理（添加、移除）。
       - 点击 "Browse" 可以通过文件对话框选择目录。

     - **Python Executable Path** (`pythonExecutablePath`)：
       - **路径**: Python 解释器的绝对路径、相对于工作区根目录的路径，或直接是 `python`、`python3` 等命令（如果它们在系统的 `PATH` 环境变量中可被找到）。
       - Windows 示例: `C:\Python39\python.exe` 或 `..\..\.pyenv\pyenv-win\versions\3.13.2\python.exe`
       - Linux/macOS 示例: `/usr/bin/python3` 或 `python3`
       - 这是执行所有 Python 脚本所必需的。
       - 点击 "Browse" 可以通过文件对话框选择可执行文件。

     - **Watched Paths for Events**:
       - **Path to Watch**: 相对于工作区根目录的文件或文件夹路径。
       - **Python Script on Event**: 当 "Path to Watch" 发生事件时执行的Python脚本路径（相对于工作区根目录）。
       - 点击 "Add Watch Entry" 添加多个监视规则。

   - 完成配置后，点击 **"Save Settings"**。核心配置将更新到工作区的 `.vscode/syncfiles.json` 文件中。该保存操作也会触发一次脚本列表与文件系统的同步（如果 `pythonScriptPath` 已配置）。

### 3. 管理和运行 Python 脚本 (侧边栏)

   - **脚本发现与 "Default" 组**：
     - 如果 "Python Scripts Directory" (`pythonScriptPath`) 已配置且目录有效：
       - 插件启动或刷新树视图时，会自动扫描该目录下的 `.py` 文件。
       - 文件系统中存在但尚未在任何组中配置的脚本，将被自动添加到一个名为 "Default" 的特殊虚拟组中（组名可通过VSCode设置 `syncfiles.scripts.defaultGroupName` 修改）。此组及其脚本信息会持久化到 `.vscode/syncfiles.json`。
       - 如果脚本文件从该目录中被删除，在下次刷新或保存配置时，对应的脚本项也会从配置文件中（包括"Default"组和其他组）被移除。
     - 如果 "Python Scripts Directory" 未配置（为空），插件将不会自动从文件系统同步脚本。已配置的脚本项（其路径将被视为相对于工作区根目录）会保留，直到用户手动将其从组中移除，或者脚本项的 `path` 字段本身被清空并保存配置。

   - **创建和管理虚拟组**：
     - 右键点击侧边栏中的 "Scripts" 根节点，选择 "Create New Script Group" 来创建新的虚拟组。
     - 右键点击已创建的组，可以选择 "Add Script to this Group..." (从 `pythonScriptPath` 下未被分配的脚本中选择)、"Rename Script Group" 或 "Delete Script Group"。
       - **注意**: "Default" 组本身不可被删除，但可以通过右键菜单中的相应选项清空其包含的脚本（这些脚本会变回未分配状态，如果 `pythonScriptPath` 有效，则在下次刷新时可能再次被添加到Default组，除非它们已被添加到其他组）。

   - **管理脚本项**：
     - **左键单击行为**：默认为“无操作”。可以通过右键脚本项 -> "Set Left-Click Action..." 子菜单，将其更改为：
        - **Do Nothing**: 左键单击无反应（需使用右键操作）。
        - **Open File**: 左键单击打开该脚本文件。
        - **Execute Default**: 左键单击执行该脚本的默认执行方法。
     - **右键上下文菜单**：右键点击组内的脚本项，可以进行多种操作：
       - **Open File**: 打开该脚本文件。
       - **Run (Default Method)**: 使用为该脚本设置的默认方法（终端或后台API）运行脚本。新添加的脚本默认在**终端**执行。
       - **Run in Terminal**: 在新的VSCode集成终端中运行脚本。
       - **Run with Background API**: 通过VSCode API在后台执行脚本，结果通过通知显示。
       - **Configure Script...**: 修改脚本的别名和描述。
       - **Set Default Execution Method...**: 选择此脚本未来通过 "Run (Default Method)" 或左键单击（如果设置为执行）时是“在终端运行”还是“通过后台API运行”。
       - **Set Left-Click Action...**: (如上所述) 修改左键单击此脚本项的行为。
       - **Move Script to Another Group...**: 将脚本移动到另一个已存在的虚拟组。
       - **Remove Script from Group**: 将脚本从此组中移除。如果 `pythonScriptPath` 有效，此脚本将变为未分配状态，并在下次刷新时回到 "Default" 组（除非它已被添加到其他组）。

### 4. Python 脚本交互详解

   - **事件驱动的脚本**：
     - 当您在 "Watched Paths for Events" 中配置了一个条目，例如：
       - `Path to Watch`: `data/config.json`
       - `Python Script on Event`: `.vscode/py-scripts/handle_config_change.py`
     - 如果 `data/config.json` 文件被 **创建 (Create)**、**修改 (Modify)** 或 **删除 (Delete)**，SyncFiles 会自动执行 `handle_config_change.py`。
     - **参数传递**：被执行的 Python 脚本会接收到两个命令行参数：
       1.  `sys.argv[1]` (第一个参数): 一个字符串，表示事件类型：
           - `"Change New"`: 文件或目录被创建。
           - `"Change Mod"`: 文件或目录被修改。
           - `"Change Del"`: 文件或目录被删除。
       2.  `sys.argv[2]` (第二个参数): 一个字符串，表示**受影响文件或目录的绝对路径**（路径分隔符为 `/`）。
     - **示例 Python 脚本 (`handle_config_change.py`)**：
       ```python
       import sys
       import datetime
       import os

       if __name__ == "__main__":
           if len(sys.argv) >= 3:
               event_type = sys.argv[1]
               file_path = sys.argv[2] # Path will use forward slashes
               timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
               log_message = f"[{timestamp}] Event: {event_type}, Path: {file_path}\n"
               
               # Example: Log to event.log in the workspace root
               # Ensure workspace_root is correctly determined if script is not in root
               workspace_root = os.getcwd() # Assumes CWD is workspace root
               log_file_path = os.path.join(workspace_root, "event.log")

               try:
                   with open(log_file_path, "a", encoding="utf-8") as f:
                       f.write(log_message)
                   print(f"Logged to {log_file_path}: {log_message.strip()}")
               except Exception as e:
                   print(f"Error logging event to {log_file_path}: {e}")
           else:
               print("Script called with insufficient arguments.")
               print(f"Arguments received: {sys.argv}")
       ```
     - **注意**：
       - Python 脚本的当前工作目录 (CWD) 是 VSCode 工作区的根目录。
       - 通过 "Environment Variables for Python Scripts" 配置的环境变量在此脚本中可用。
       - 文件监视器触发的脚本执行相关的通知（如“脚本已执行”）默认是**不弹窗**的。错误信息会记录在开发者控制台。

   - **手动运行的脚本 (从侧边栏)**：
     - **参数**：默认情况下，从侧边栏运行的脚本不会接收额外的命令行参数（除了脚本名本身被Python解释器作为 `sys.argv[0]`）。
     - **通知**：手动运行的脚本，其执行成功或失败的通知**会弹窗**显示。
     - 同样，配置的环境变量也对这些脚本可用。

### 5. 执行通用操作 (侧边栏 Actions)

   - **Start Sync**：
     - 点击侧边栏 "SyncFiles" 视图中 "Actions" 下的 "Start Sync" 按钮。
     - 这会根据您在 "File Mappings" 中的配置，从所有指定的 GitHub URL 拉取内容到对应的本地路径。
     - 通知会提示同步过程和结果。

   - **Refresh Tree View**：
     - 点击此按钮会：
       1.  重新读取 `.vscode/syncfiles.json` 配置文件。
       2.  如果 `pythonScriptPath` 已配置，则与文件系统同步脚本列表（移除不存在的，添加新的到Default组）。
       3.  刷新侧边栏的脚本树视图。
     - 当您在 `pythonScriptPath` 目录外手动更改了 `.py` 文件，或者直接编辑了 `syncfiles.json` 文件后，可以使用此按钮。

## 注意事项与故障排查

- **Python 环境**：确保 "Python Executable Path" 配置正确，并且该 Python 环境已安装您脚本所需的所有依赖库。路径问题（如包含空格）应由插件尝试通过加引号处理，但一个干净的、在PATH中的Python命令通常最可靠。
- **文件路径**：所有在设置中填写的路径（Target Path, Python Scripts Directory, Path to Watch, Python Script on Event）都应相对于当前 VSCode **工作区的根目录**，除非是 Python 可执行文件的绝对路径。插件内部会尝试将路径规范化（使用 `/` 分隔符）后传递给Python。
- **GitHub URL**：目前仅支持公共 GitHub 仓库。
- **首次同步与覆盖**：
    - 文件同步：目标文件若存在，将被覆盖。
    - 目录同步：进行合并，GitHub上的文件若本地没有则添加；若本地有同名文件则覆盖；本地独有的文件保留。
- **日志与调试**：
    - 遇到问题时，检查 VSCode 的开发者工具控制台 (菜单栏: "帮助 (Help)" -> "切换开发人员工具 (Toggle Developer Tools)" -> "控制台 (Console)")。扩展的 `console.log` 输出（以 `[SyncFiles]` 或 `[SyncConfig]` 开头）会在这里显示。
- **文件监视器行为**：
    - 依赖操作系统的事件通知，极端情况下可能不完全按预期触发。
    - 监视目录时，对目录内深层文件的更改也应该能被捕获。
    - 检查开发者控制台日志中是否有 watcher 设置和事件触发的相关信息。
- **配置保存**：在设置界面更改后务必点击 "Save Settings"。所有配置（包括组和脚本的详细信息）均存储在 `.vscode/syncfiles.json`。建议将此文件加入版本控制（如果适合您的项目）。
- **重载窗口**：在对扩展代码或有时对配置进行重大更改后，通过命令面板运行 "Developer: Reload Window" 可能有助于确保所有更改生效。

## 贡献

欢迎提交 Pull Requests 或 Issues 来改进此扩展！

## 许可证

[MIT](./LICENSE) 