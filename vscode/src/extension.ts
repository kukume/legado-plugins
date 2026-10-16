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
    vscode.commands.registerCommand("legado.refreshBookshelf", () => reader!.refreshBookshelf()),
    vscode.commands.registerCommand("legado.backBookshelf", () => reader!.backBookshelf()),
    vscode.commands.registerCommand("legado.previousChapter", () => reader!.previousChapter()),
    vscode.commands.registerCommand("legado.nextChapter", () => reader!.nextChapter()),
    vscode.commands.registerCommand("legado.refreshTextBody", () => reader!.refreshTextBody()),
    vscode.commands.registerCommand("legado.showBookInfo", () => reader!.showBookInfo()),
    vscode.commands.registerCommand("legado.toggleActionBar", () => reader!.toggleActionBars()),
    vscode.commands.registerCommand("legado.toggleInlineRead", async () => {
      const on = await inline.toggle();
      void vscode.window.showInformationMessage(on ? "已开启行内阅读。Ctrl+Alt+] 下一页，Ctrl+Alt+[ 上一页" : "已关闭行内阅读");
    }),
    vscode.commands.registerCommand("legado.inlineNextChunk", () => inline.nextChunk()),
    vscode.commands.registerCommand("legado.inlinePrevChunk", () => inline.previousChunk()),
    vscode.commands.registerCommand("legado.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "legado")
    )
  );

  void vscode.commands.executeCommand("setContext", "legado.inlineRead", inline.enabled);
}

export function deactivate(): void {
  // subscriptions disposed by VS Code
}
