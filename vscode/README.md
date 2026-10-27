# Legado

在 VS Code 里阅读 [阅读 Web](https://github.com/kukume/legado-web) 书架中的文字书：目录、正文和进度同步。听书、视频、漫画不支持。

## 安装

在扩展市场搜索 **Legado** 并安装。

也可以从 [Releases](https://github.com/kukume/legado-plugins/releases/latest) 下载 `legado-*.vsix`，用 **Extensions: Install from VSIX…** 安装。

## 设置

打开设置，搜索 `Legado`：

- `legado.address`：阅读 Web 的服务器地址，例如 `http://192.168.1.10:8080`
- `legado.apiKey`：在阅读 Web 的「我的 → API Key」中创建，以 `lgd_` 开头

安装后从活动栏打开 **Legado**，刷新书架，再点书进入正文。

## 功能

- 书架、目录、正文、进度同步
- 侧栏阅读：返回、上一章 / 下一章、章节下拉（附近 10 章，可加载更多）
- 行内阅读：开启后，当前段显示在编辑器光标后面

行内翻段快捷键（避开 VS Code 默认绑定）：

| 动作 | Windows / Linux | macOS |
|---|---|---|
| 上一段 | `Ctrl+Alt+[` | `Control+Option+[` |
| 下一段 | `Ctrl+Alt+]` | `Control+Option+]` |

侧栏标题栏可开关行内阅读。也可在命令面板搜索「行内阅读」。

## 开发

```bash
cd vscode
npm install
npm test
npm run package
```
