import * as vscode from "vscode";

/** 网页“阅读设置”里的排版（GET /openapi/v1/reader-config），字段都可能缺省 */
export interface ReaderLayout {
  /** 字号（px） */
  fontSize?: number;
  /** 行高（倍数） */
  lineHeight?: number;
  /** 段间距（em） */
  paragraphSpacing?: number;
  /** 字间距（em） */
  letterSpacing?: number;
  /** 正文宽度（px） */
  width?: number;
  /** 首行缩进两字 */
  indent?: boolean;
  fontWeight?: number;
}

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
  /** 加载完章节后滚动到的章内位置（比例 0~1） */
  scrollRatio?: number;
  /** 目录（章节名，按列表下标），用于章节下拉框 */
  chapterTitles: string[];
  /** 排版，与网页的阅读设置相同 */
  layout: ReaderLayout;
}

/** 在编辑器区域自己画正文，不走带行号的文本编辑器。 */
export class ChapterPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private latest: ChapterPanelState | undefined;
  private readonly listeners: vscode.Disposable[] = [];
  /** 上次发给页面的目录：目录没变时不再重复发送（几千章的目录每次都发太浪费） */
  private sentTitlesKey = "";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onCommand: (type: "prevChapter" | "nextChapter") => void,
    /** 正文滚动（index 为目录列表下标，ratio 为章内位置 0~1，user 为是否用户自己滚动） */
    private readonly onScroll: (index: number, ratio: number, user: boolean, progress: number) => void = () => {},
    /** 在章节下拉框里选了一章（目录列表下标） */
    private readonly onSelect: (index: number) => void = () => {},
    /** 面板打开或关闭（侧栏据此收起或恢复正文） */
    private readonly onOpenChanged: (open: boolean) => void = () => {}
  ) {}

  get isOpen(): boolean {
    return !!this.panel;
  }

  /** 面板打开并且正显示在编辑器里（不是被别的标签页挡住） */
  get isVisible(): boolean {
    return !!this.panel?.visible;
  }

  /** 跟随其他端：同一章内平滑滚到 ratio（0~1） */
  scrollTo(ratio: number): void {
    void this.panel?.webview.postMessage({ type: "scroll", ratio });
  }

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
    this.sentTitlesKey = "";
    panel.webview.html = this.html(panel.webview);
    this.listeners.push(
      panel.webview.onDidReceiveMessage((msg: { type?: string; index?: number; ratio?: number; progress?: number; user?: boolean }) => {
        if (msg?.type === "ready" && this.latest) {
          this.sentTitlesKey = "";
          this.post(this.latest);
          return;
        }
        if (msg?.type === "scroll") {
          this.onScroll(Number(msg.index), Number(msg.ratio) || 0, msg.user === true, Number(msg.progress) || 0);
          return;
        }
        if (msg?.type === "selectChapter") {
          this.onSelect(Number(msg.index));
          return;
        }
        if (msg?.type === "prevChapter" || msg?.type === "nextChapter") {
          this.onCommand(msg.type);
        }
      }),
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.clearListeners();
        this.onOpenChanged(false);
      })
    );
    this.post(state);
    this.onOpenChanged(true);
  }

  sync(state: ChapterPanelState): void {
    this.latest = state;
    if (!this.panel) {
      return;
    }
    this.post(state);
  }

  /** 关闭面板（侧栏里点“回到侧栏阅读”） */
  close(): void {
    this.panel?.dispose();
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
    const titlesKey = `${state.bookName}\u0000${state.chapterTitles.length}\u0000${state.chapterTitles[0] ?? ""}`;
    const { chapterTitles, ...rest } = state;
    const msg: Record<string, unknown> = { type: "state", ...rest };
    if (titlesKey !== this.sentTitlesKey) {
      this.sentTitlesKey = titlesKey;
      msg.chapterTitles = chapterTitles;
    }
    void this.panel.webview.postMessage(msg);
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
  <div class="bar">
    <button id="prev" type="button" title="上一章（←）">‹ 上一章</button>
    <select id="toc" title="选择章节"></select>
    <button id="next" type="button" title="下一章（→）">下一章 ›</button>
    <span id="progress" class="progress"></span>
  </div>
  <div class="page">
    <h1 id="heading"></h1>
    <div id="error" class="error" hidden></div>
    <div id="body" class="body"></div>
    <div class="end">
      <button id="nextEnd" type="button">下一章 ›</button>
      <span id="theEnd" class="the-end" hidden>— 全书完 —</span>
    </div>
  </div>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}
