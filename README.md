# Legado

IDE 小说阅读插件，对接 [阅读 Web](https://github.com/kukume/legado-web) 的开放接口：书架、目录、正文、进度同步。IntelliJ 插件兼容 2025.2 及以上。

> **需要先搭建阅读 Web 服务端。** [legado-web](https://github.com/kukume/legado-web)（Docker 一键部署，见其 README）。

使用前在阅读 Web 中打开“我的 → API Key”创建一个 Key（`lgd_` 开头），然后在插件设置里填写服务器地址和这个 Key。只显示书架中的文字书（听书、视频、漫画不支持）。

本仓库同时包含两个客户端：

| 目录 | 平台 |
|---|---|
| [`IntelliJ/`](IntelliJ/) | IntelliJ IDEA 插件（[说明](#intellij-插件)） |
| [`vscode/`](vscode/) | Visual Studio Code 扩展（[说明](#vs-code-扩展)） |

## VS Code 扩展

1. 在扩展市场搜索 **Legado**。也可以从 [Releases](https://github.com/kukume/legado-plugins/releases/latest) 下载 `legado-*.vsix`（或在 `vscode/` 下执行 `npm install && npm run package`），再用 **Install from VSIX…** 安装。
2. 打开设置搜索 `Legado`，填入阅读 Web 的 **服务器地址**（如 `http://192.168.1.10:8080`）与 **API Key**。
3. 活动栏打开 Legado 侧栏，刷新书架后即可阅读。

行内阅读开启后，单击一行代码，正文会显示在这一行的末尾（编辑代码时自动隐藏）。上下翻段快捷键：

- **上一段**：`Ctrl+Alt+[`（macOS：`Control+Option+[`）
- **下一段**：`Ctrl+Alt+]`（macOS：`Control+Option+]`）


## IntelliJ 插件

原项目 https://github.com/nancheung/legado-reader

兼容 IntelliJ Platform 2025.2（build 252）及以上。

1. 在 IDE 的 Settings → Plugins → Marketplace 搜索 **Legado**。也可以从 [Releases](https://github.com/kukume/legado-plugins/releases/latest) 下载 zip，用 Settings → Plugins → ⚙ → **Install Plugin from Disk…** 安装。
2. 在 Settings → Tools → **Legado** 中填写阅读 Web 的 **服务器地址** 与 **API Key**。
3. 打开右侧的 Legado 工具窗口，刷新书架后即可阅读。同时打开多个项目时，每个项目有自己的阅读窗口。

本地构建：在 `IntelliJ/` 目录执行

```bash
./gradlew buildPlugin
```

生成的 zip 位于 `IntelliJ/build/distributions/`。
