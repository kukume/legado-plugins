原项目 https://github.com/nancheung/legado-reader

IntelliJ IDEA 插件。合并到主分支后，zip 会随 GitHub Release 一起发布。

对接阅读 Web 的开放接口：在 Settings → Tools → Legado Reader 中填写服务器地址和 API Key（在阅读 Web 的“我的 → API Key”中创建）。

本地构建：

```bash
./gradlew buildPlugin
```

生成的 zip 位于 `build/distributions/`。安装：IDE → Settings → Plugins → Install Plugin from Disk…
