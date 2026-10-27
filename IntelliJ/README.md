原项目 https://github.com/nancheung/legado-reader

IntelliJ IDEA 插件。合并到主分支后，zip 会随 GitHub Release 一起发布。

对接阅读 Web 的开放接口：在 Settings → Tools → Legado 中填写服务器地址和 API Key（在阅读 Web 的“我的 → API Key”中创建）。

兼容 IntelliJ Platform 2025.2（build 252）及以上。

本地构建：

```bash
./gradlew buildPlugin
```

生成的 zip 位于 `build/distributions/`。安装：IDE → Settings → Plugins → Install Plugin from Disk…

上传到 JetBrains Marketplace 前需要作者签名。设置环境变量 `CERTIFICATE_CHAIN`、`PRIVATE_KEY`、`PRIVATE_KEY_PASSWORD` 后执行 `./gradlew signPlugin`，上传签过名的 zip。上传表单中的许可证选 GPL-3.0-or-later。首次发布必须在 Marketplace 网页上手动上传。
