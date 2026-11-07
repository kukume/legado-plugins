# Legado

在 VS Code 里阅读 [阅读 Web](https://github.com/kukume/legado-web) 书架中的文字书：目录、正文和进度同步。听书、视频、漫画不支持。

> **需要先搭建阅读 Web 服务端。** 本扩展只是客户端，书架、书源和正文都来自你自己部署的 [legado-web](https://github.com/kukume/legado-web)（Docker 一键部署，见其 README）。部署好后在网页“我的 → API Key”中创建 Key，再在扩展设置里填写服务器地址和 Key。

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
- 多端同步：在网页、手机或另一个 IDE 里读同一本书时，翻章和滚动会自动跟随（本端正在操作时不跟随）。需要在阅读 Web 的“我的”页面开启“多端阅读同步”
- 侧栏阅读：返回、上一章 / 下一章、章节下拉（附近 10 章，可加载更多）
- 行内阅读：开启后，单击一行代码，当前段显示在这一行的末尾（可伪装成注释，编辑代码时自动隐藏）

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
