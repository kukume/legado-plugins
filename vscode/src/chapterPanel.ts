import * as vscode from "vscode";

export interface ChapterPanelState {
  bookName: string;
  chapterTitle: string;
  body: string;
  index: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  fontColor: string;
  fontSize: number;
  loading: boolean;
  error: string;
}

/** 在编辑器区域自己画正文，不走带行号的文本编辑器。 */
export class ChapterPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private latest: ChapterPanelState | undefined;
  private readonly listeners: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onCommand: (type: "prevChapter" | "nextChapter") => void
  ) {}

  show(state: ChapterPanelState): void {
    this.latest = state;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      this.post(state);
      return;
    }
    const panel = vscode.window.createWebviewPanel("legado.chapter", this.tabTitle(state), vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    });
    this.panel = panel;
    panel.webview.html = this.html(panel.webview);
    this.listeners.push(
      panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
        if (msg?.type === "ready" && this.latest) {
          this.post(this.latest);
          return;
        }
        if (msg?.type === "prevChapter" || msg?.type === "nextChapter") {
          this.onCommand(msg.type);
        }
      }),
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.clearListeners();
      })
    );
    this.post(state);
  }

  sync(state: ChapterPanelState): void {
    this.latest = state;
    if (!this.panel) {
      return;
    }
    this.post(state);
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.clearListeners();
  }

  private post(state: ChapterPanelState): void {
    if (!this.panel) {
      return;
    }
    this.panel.title = this.tabTitle(state);
    void this.panel.webview.postMessage({ type: "state", ...state });
  }

  private tabTitle(state: ChapterPanelState): string {
    const title = state.chapterTitle || state.bookName || "阅读";
    return state.bookName && state.chapterTitle ? `${state.bookName} ${state.chapterTitle}` : title;
  }

  private clearListeners(): void {
    for (const listener of this.listeners) {
      listener.dispose();
    }
    this.listeners.length = 0;
  }

  private html(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "chapter.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "chapter.js"));
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${css}" />
</head>
<body>
  <div class="page">
    <h1 id="heading"></h1>
    <div id="error" class="error" hidden></div>
    <div id="body" class="body"></div>
  </div>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
