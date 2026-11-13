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

## 开发

```bash
cd vscode
npm install
npm test
npm run package
```
