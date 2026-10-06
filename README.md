# Legado Reader

IDE 小说阅读插件，对接 [阅读 Web](https://github.com/kukume/legado-web) 的开放接口：书架、目录、正文、进度同步。

使用前在阅读 Web 中打开“我的 → API Key”创建一个 Key（`lgd_` 开头），然后在插件设置里填写服务器地址和这个 Key。只显示书架中的文字书（听书、视频、漫画不支持）。

本仓库同时包含两个客户端：

| 目录 | 平台 |
|---|---|
| [`IntelliJ/`](IntelliJ/) | IntelliJ IDEA 插件 |
| [`vscode/`](vscode/) | Visual Studio Code 扩展 |

原项目：https://github.com/nancheung/legado-reader

## VS Code 扩展

1. 从 [Releases](https://github.com/kukume/legado/releases/latest) 下载 `legado-reader-*.vsix`（也可在 `vscode/` 下执行 `npm install && npm run package`）。
2. VS Code / Cursor：`Extensions` → `⋯` → **Install from VSIX…**，选中该文件。
3. 打开设置搜索 `Legado Reader`，填入阅读 Web 的 **服务器地址**（如 `http://192.168.1.10:8080`）与 **API Key**。
4. 活动栏打开 Legado Reader 侧栏，刷新书架后即可阅读。

行内阅读开启后，正文会显示在光标后面。上下翻段快捷键：

- **上一段**：`Ctrl+Alt+[`（macOS：`Control+Option+[`）
- **下一段**：`Ctrl+Alt+]`（macOS：`Control+Option+]`）


## IntelliJ 插件

见 [`IntelliJ/README.md`](IntelliJ/README.md)。在 `IntelliJ/` 目录执行 `./gradlew buildPlugin`。
