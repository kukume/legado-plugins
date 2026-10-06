import * as vscode from "vscode";
import { ApiClient } from "./api";
import { getBodyFont } from "./config";
import { isConfigured } from "./apiKey";
import { InlineReadController } from "./inlineRead";
import { ReadSession } from "./session";
import { Book, ChapterOption } from "./types";

const CHAPTER_PAGE = 10;

export class ReaderViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = "legado.reader";
  private view: vscode.WebviewView | undefined;
  private currentPreload: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: ReadSession,
    private readonly api: ApiClient,
    private readonly inline: InlineReadController
  ) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("legado")) {
          return;
        }
        this.postState();
        this.inline.refresh();
        if (e.affectsConfiguration("legado.apiKey") || e.affectsConfiguration("legado.address")) {
          if (!this.session.reading && getConfigured()) {
            void this.refreshBookshelf();
          }
        }
      })
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: { type: string; [k: string]: unknown }) => {
      void this.onMessage(msg);
    });
    this.postState();
    if (!this.session.bookshelf.length && !this.session.reading && getConfigured()) {
      void this.refreshBookshelf();
    }
  }

  reveal(): void {
    if (this.view) {
      this.view.show?.(true);
    } else {
      void vscode.commands.executeCommand("legado.reader.focus");
    }
  }

  async refreshBookshelf(): Promise<void> {
    this.session.reading = false;
    this.session.loading = true;
    this.session.error = "";
    this.postState();
    try {
      const books = await this.api.getBookshelf();
      this.session.bookshelf = books;
      this.session.loading = false;
      this.session.error = "";
      this.postState();
    } catch (e) {
      this.session.bookshelf = [];
      this.session.loading = false;
      this.session.error = `获取书架列表失败: ${rootMessage(e)}`;
      this.postState();
    }
  }

  async backBookshelf(): Promise<void> {
    this.session.reading = false;
    this.postState();
    await this.refreshBookshelf();
  }

  async openBook(book: Book): Promise<void> {
    this.session.book = book;
    this.session.index = book.durChapterIndex ?? 0;
    this.session.reading = true;
    this.session.body = "";
    this.inline.resetToFirstChunk();
    this.session.loading = true;
    this.session.error = "";
    this.postState();
    try {
      const chapters = await this.api.getChapterList(book);
      this.session.chapters = chapters;
      const index = this.api.resolveChapterIndex(book, chapters);
      this.session.index = index;
      book.durChapterIndex = index;
      if (index >= 0 && index < chapters.length) {
        book.durChapterTitle = chapters[index].title;
      }
      this.session.resetChapterWindow(CHAPTER_PAGE);
      await this.loadCurrentChapter(book.durChapterPos ?? 0);
    } catch (e) {
      this.session.loading = false;
      this.session.error = rootMessage(e);
      this.postState();
    }
  }

  async previousChapter(): Promise<void> {
    if (this.session.index < 1) {
      return;
    }
    this.session.index -= 1;
    await this.switchChapter(0);
  }

  async nextChapter(): Promise<void> {
    if (this.session.index + 1 >= this.session.chapters.length) {
      return;
    }
    this.session.index += 1;
    await this.switchChapter(0);
  }

  async switchChapter(_pos: number): Promise<void> {
    this.inline.resetToFirstChunk();
    await this.loadCurrentChapter(_pos);
  }

  async refreshTextBody(): Promise<void> {
    if (!this.session.book) {
      return;
    }
    await this.openBook(this.session.book);
  }

  toggleActionBars(): void {
    this.session.actionBarsVisible = !this.session.actionBarsVisible;
    this.postState();
  }

  showBookInfo(): void {
    const book = this.session.book;
    const chapter = this.session.currentChapter();
    if (!book || !chapter) {
      void vscode.window.showInformationMessage("尚未打开书籍");
      return;
    }
    void vscode.window.showInformationMessage(`${book.name} — ${chapter.title}`);
  }

  private async loadCurrentChapter(pos: number): Promise<void> {
    const book = this.session.book;
    if (!book) {
      return;
    }
    if (this.session.index < 0 || this.session.index >= this.session.chapters.length) {
      this.session.loading = false;
      this.session.error = "章节下标无效";
      this.postState();
      return;
    }
    this.session.ensureCurrentInWindow(CHAPTER_PAGE);
    this.session.reading = true;
    this.session.loading = true;
    this.session.error = "";
    this.postState({ scrollTo: 0 });
    const index = this.session.index;
    try {
      const content = await this.api.getBookContent(book, this.session.chapters, index);
      this.session.body = content;
      this.inline.afterBodyLoaded();
      book.durChapterIndex = index;
      book.durChapterTitle = this.session.chapters[index]?.title;
      this.session.loading = false;
      this.session.error = "";
      this.postState({ scrollTo: pos });
    } catch (e) {
      this.session.body = "";
      this.inline.afterBodyLoaded();
      this.session.loading = false;
      this.session.error = rootMessage(e);
      this.postState();
    }
    void this.api.saveBookProgress(book, this.session.chapters, index);
  }

  private async onMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.postState();
        break;
      case "refreshBookshelf":
        await this.refreshBookshelf();
        break;
      case "openBook":
        {
          const i = Number(msg.index);
          const book = this.session.bookshelf[i];
          if (book) {
            await this.openBook(book);
          }
        }
        break;
      case "back":
        await this.backBookshelf();
        break;
      case "prevChapter":
        await this.previousChapter();
        break;
      case "nextChapter":
        await this.nextChapter();
        break;
      case "refreshBody":
        await this.refreshTextBody();
        break;
      case "selectChapter":
        {
          const target = Number(msg.index);
          if (target === this.session.index) {
            break;
          }
          if (target >= 0 && target < this.session.chapters.length) {
            this.session.index = target;
            await this.switchChapter(0);
          }
        }
        break;
      case "morePrev":
        this.expandPrev();
        this.postState();
        break;
      case "moreNext":
        this.expandNext();
        this.postState();
        break;
      case "scroll":
        await this.maybePreloadFromScroll(Number(msg.progress) || 0);
        break;
      case "openSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "legado");
        break;
      case "showBookInfo":
        this.showBookInfo();
        break;
      default:
        break;
    }
  }

  private expandPrev(): void {
    if (this.session.chapterWindowStart <= 0) {
      return;
    }
    this.session.chapterWindowStart = Math.max(0, this.session.chapterWindowStart - CHAPTER_PAGE);
  }

  private expandNext(): void {
    const size = this.session.chapters.length;
    if (this.session.chapterWindowEnd >= size) {
      return;
    }
    this.session.chapterWindowEnd = Math.min(size, this.session.chapterWindowEnd + CHAPTER_PAGE);
  }

  private async maybePreloadFromScroll(progress: number): Promise<void> {
    if (progress <= 0.5) {
      return;
    }
    const book = this.session.book;
    const nextIndex = this.session.index + 1;
    if (!book || nextIndex >= this.session.chapters.length) {
      return;
    }
    const key = `${book.id}:${nextIndex}`;
    if (key === this.currentPreload) {
      return;
    }
    this.currentPreload = key;
    try {
      await this.api.getBookContent(book, this.session.chapters, nextIndex);
    } catch {
      if (this.currentPreload === key) {
        this.currentPreload = undefined;
      }
    }
  }

  private chapterOptions(): ChapterOption[] {
    const chapters = this.session.chapters;
    if (!chapters.length) {
      return [];
    }
    this.session.ensureCurrentInWindow(CHAPTER_PAGE);
    const options: ChapterOption[] = [];
    if (this.session.chapterWindowStart > 0) {
      options.push({ type: "morePrev", remaining: this.session.chapterWindowStart });
    }
    for (let i = this.session.chapterWindowStart; i < this.session.chapterWindowEnd && i < chapters.length; i++) {
      options.push({ type: "chapter", index: i, title: chapters[i].title || `第${i + 1}章` });
    }
    if (this.session.chapterWindowEnd < chapters.length) {
      options.push({ type: "moreNext", remaining: chapters.length - this.session.chapterWindowEnd });
    }
    return options;
  }

  private postState(extra: Record<string, unknown> = {}): void {
    const font = getBodyFont();
    const chapter = this.session.currentChapter();
    void this.view?.webview.postMessage({
      type: "state",
      reading: this.session.reading,
      actionBarsVisible: this.session.actionBarsVisible,
      bookshelf: this.session.bookshelf.map((b) => ({
        name: b.name,
        current: b.durChapterTitle || b.latestChapterTitle || "",
        source: b.originName,
        author: b.author,
      })),
      bookName: this.session.book?.name || "",
      chapterTitle: chapter?.title || "",
      body: this.session.body,
      index: this.session.index,
      chapterOptions: this.chapterOptions(),
      fontColor: font.color,
      fontSize: font.size,
      configured: getConfigured(),
      loading: this.session.loading,
      error: this.session.error,
      ...extra,
    });
  }

  private html(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "reader.css"));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "reader.js"));
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${css}" />
</head>
<body>
  <div id="app">
    <div id="toolbar" class="toolbar"></div>
    <div id="error" class="error hidden"></div>
    <div id="content"></div>
  </div>
  <script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }
}

/** 服务器地址和 API Key 都已填写 */
function getConfigured(): boolean {
  const c = vscode.workspace.getConfiguration("legado");
  return isConfigured(c.get<string>("address"), c.get<string>("apiKey"));
}

function rootMessage(err: unknown): string {
  if (err instanceof Error) {
    let t: Error = err;
    while (t.cause instanceof Error) {
      t = t.cause;
    }
    return t.message || String(t);
  }
  return String(err);
}
