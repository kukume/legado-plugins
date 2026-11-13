import * as vscode from "vscode";
import { ApiClient } from "./api";
import { getApiConfig } from "./config";
import { InlineReadController } from "./inlineRead";
import { ReaderViewProvider } from "./readerView";
import { ReadSession } from "./session";

export function activate(context: vscode.ExtensionContext): void {
  const session = new ReadSession();
  const api = new ApiClient(() => getApiConfig());

  let reader: ReaderViewProvider | undefined;
  const inline = new InlineReadController(context, session, api, async () => {
    await reader?.switchChapter(0);
  });
  reader = new ReaderViewProvider(context, session, api, inline);

  context.subscriptions.push(
    inline,
    reader,
    vscode.window.registerWebviewViewProvider(ReaderViewProvider.viewId, reader, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    // 只注册需要用户绑定快捷键的三个命令。其余按钮都在 webview 里，用消息驱动：
    // 注册过的命令都会出现在“键盘快捷方式”列表里，哪怕没有默认绑定。
    // 标题栏的刷新用 _ 前缀的私有 id：能显示图标，但 VS Code 会跳过它，不进快捷键列表。
    vscode.commands.registerCommand("_legado.refresh", () => reader!.refresh()),
    vscode.commands.registerCommand("legado.toggleInlineRead", async () => {
      const on = await inline.toggle();
      void vscode.window.showInformationMessage(on ? "已开启行内阅读" : "已关闭行内阅读");
    }),
    vscode.commands.registerCommand("legado.inlineNextChunk", () => inline.nextChunk()),
    vscode.commands.registerCommand("legado.inlinePrevChunk", () => inline.previousChunk())
  );

  void vscode.commands.executeCommand("setContext", "legado.inlineRead", inline.enabled);
}

export function deactivate(): void {
  // subscriptions disposed by VS Code
}
