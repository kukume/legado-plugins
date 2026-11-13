import * as vscode from "vscode";
import { ApiClient } from "./api";
import { getApiConfig, getBodyFont } from "./config";
import { ProgressEvent, ProgressStream } from "./events";
import { ReadingStatsReporter } from "./stats";
import { isConfigured } from "./apiKey";
import { ChapterPanel, ChapterPanelState, ReaderLayout } from "./chapterPanel";
import { InlineReadController } from "./inlineRead";
import { ReadSession } from "./session";
import { Book, ChapterOption } from "./types";

const CHAPTER_PAGE = 10;
/** 滚动停下这么久后保存章内位置 */
const SAVE_DELAY_MS = 1500;
/** 本端最近这么久内有操作时，不跟随其他端的进度（免得两边互相拉扯） */
const LOCAL_ACTIVE_MS = 3000;

export class ReaderViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = "legado.reader";
  private view: vscode.WebviewView | undefined;
  private currentPreload: string | undefined;
  private contentScrollTop = 0;
  private readonly chapterPanel: ChapterPanel;
  private readonly disposables: vscode.Disposable[] = [];
  /** 多端同步：订阅其他端保存的进度 */
  private readonly stream: ProgressStream;
  /** 多端同步的日志（输出面板“Legado”） */
  private readonly output = vscode.window.createOutputChannel("Legado");
  /** 每次加载章节加一：连续切换章节时，先发出、后返回的旧结果不能覆盖新章节 */
  private loadSeq = 0;
  /** 当前章内位置（0~10000） */
  private currentPos = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** 最近一次本端的用户操作（滚动正文、切换章节、行内阅读翻页） */
  private lastLocalInput = 0;
  /** 刚跟随其他端跳转：这段时间内不保存进度（位置就是服务器上的进度，存回去会让其他端又跟着跳） */
  private remoteUntil = 0;
  /** 网页“阅读设置”里的排版，编辑器面板按它显示 */
  private layout: ReaderLayout = {};
  /** 阅读统计（时长、字数，与网页合在一起） */
  private readonly stats: ReadingStatsReporter;
  /** session.body 是哪一章（目录列表下标）的正文：翻到下一章时把它的字数计入阅读统计 */
  private loadedIndex = -1;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: ReadSession,
    private readonly api: ApiClient,
    private readonly inline: InlineReadController
  ) {
    this.chapterPanel = new ChapterPanel(
      context,
      (type) => {
        if (type === "prevChapter") {
          void this.previousChapter();
        } else {
          void this.nextChapter();
        }
      },
      (index, ratio, user, progress) => {
        this.onBodyScrolled(index, ratio, user);
        void this.maybePreloadFromScroll(progress);
      },
      (index) => void this.selectChapter(index),
      // 面板打开时侧栏只留目录和按钮，关闭后恢复显示正文
      () => this.postState()
    );
    this.stream = new ProgressStream(
      getApiConfig,
      api.clientId,
      (e) => this.onRemoteProgress(e),
      (msg) => this.log(msg)
    );
    if (getConfigured()) {
      this.stream.start();
    }
    this.inline.onUserPosition = (pos) => this.onInlinePosition(pos);
    // 行内阅读开关或显示状态变了：侧栏据此切换“显示正文 / 只留提示”。
    // 行内阅读收起时，侧栏要回到当前进度所在的位置，而不是停在旧滚动位置
    this.inline.onDidChangeShowing = () => {
      this.postState(this.inline.isShowing ? {} : { scrollRatio: this.currentPos / 10000 });
    };
    // 正文正在显示（侧栏、编辑器面板或行内阅读）时才计阅读时间
    this.stats = new ReadingStatsReporter(api, () => {
      const book = this.session.book;
      if (!this.session.reading || !book || this.session.loading) {
        return 0;
      }
      const shown = (this.view?.visible && !this.chapterPanel.isOpen) || this.chapterPanel.isVisible || this.inline.isShowing;
      return shown ? book.id : 0;
    });
    this.disposables.push(
      this.chapterPanel,
      this.stats,
      this.stream,
      this.output,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("legado")) {
          return;
        }
        this.postState();
        this.inline.refresh();
        if (e.affectsConfiguration("legado.apiKey") || e.affectsConfiguration("legado.address")) {
          if (getConfigured()) {
            this.stream.restart();
          } else {
            this.stream.stop();
          }
          if (!this.session.reading && getConfigured()) {
            void this.refreshBookshelf();
          }
        }
      })
    );
  }

  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    // 侧栏视图被关闭（移走、重置布局等）后不再向它发消息
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "media")],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: { type: string; [k: string]: unknown }) => {
      void this.onMessage(msg);
    });
    this.postState({ restoreScroll: this.contentScrollTop });
    if (!this.session.bookshelf.length && !this.session.reading && getConfigured()) {
      void this.refreshBookshelf();
    }
  }

  async refreshBookshelf(): Promise<void> {
    this.session.reading = false;
    this.inline.refresh();
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
    // 行内阅读的开关状态由用户决定（存在 globalState 里），进出正文都不改变它；
    // 但正文不能留在编辑器里，refreshBookshelf 会清掉行尾的正文
    await this.refreshBookshelf();
  }

  async openBook(book: Book): Promise<void> {
    // 排版与网页的阅读设置相同（每次打开书时取一次，网页里改了设置后重新打开书即可生效）
    void this.api.getReaderConfig().then((l) => {
      this.layout = l as ReaderLayout;
      this.chapterPanel.sync(this.editorState());
    });
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
      // 回到服务器上的进度：进度正好在这一章时连章内位置一起恢复（进度停在卷名上时从下一章开头读）
      const pos = chapters[index]?.index === book.durChapterIndex ? book.durChapterPos ?? 0 : 0;
      this.session.resetChapterWindow(CHAPTER_PAGE);
      await this.loadCurrentChapter(pos, false);
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
    this.markLocalInput();
    this.session.index -= 1;
    await this.switchChapter(0);
  }

  async nextChapter(): Promise<void> {
    if (this.session.index + 1 >= this.session.chapters.length) {
      return;
    }
    this.markLocalInput();
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

  /** 标题栏的刷新按钮：书架页刷新书架，正文页刷新文章 */
  async refresh(): Promise<void> {
    if (this.session.reading) {
      await this.refreshTextBody();
    } else {
      await this.refreshBookshelf();
    }
  }

  openInEditor(): void {
    const book = this.session.book;
    const chapter = this.session.currentChapter();
    if (!book || !chapter) {
      void vscode.window.showInformationMessage("尚未打开章节");
      return;
    }
    // 带上当前章内位置：编辑器面板从侧栏读到的位置打开，而不是回到章首
    this.chapterPanel.show({ ...this.editorState(), scrollRatio: this.currentPos / 10000 });
  }

  /**
   * 加载当前章节（session.index）并滚动到 pos（0~10000）。
   * save：是否保存进度（打开书、跟随其他端时位置就是服务器上的进度，不用保存）
   */
  private async loadCurrentChapter(pos: number, save = true): Promise<void> {
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
    const seq = ++this.loadSeq;
    this.currentPos = pos;
    // 自己翻到下一章：上一章算读完了（跟随其他端翻过来的不算，那一端会自己统计）
    if (save && index === this.loadedIndex + 1 && this.session.body) {
      this.stats.addChars(book.id, this.session.body.replace(/\s/g, "").length);
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    try {
      const content = await this.api.getBookContent(book, this.session.chapters, index);
      if (seq !== this.loadSeq) {
        return;
      }
      this.session.body = content;
      this.loadedIndex = index;
      this.inline.afterBodyLoaded(pos);
      this.session.loading = false;
      this.session.error = "";
      this.postState({ scrollRatio: pos / 10000 });
    } catch (e) {
      if (seq !== this.loadSeq) {
        return;
      }
      this.session.body = "";
      this.loadedIndex = -1;
      this.inline.afterBodyLoaded();
      this.session.loading = false;
      this.session.error = rootMessage(e);
      this.postState();
    }
    if (save) {
      void this.api.saveBookProgress(book, this.session.chapters, index, pos);
    }
  }

  // ---------------- 多端同步 ----------------

  private markLocalInput(): void {
    this.lastLocalInput = Date.now();
    this.stats.touch();
    // 跟随其他端之后用户自己又操作了：照常保存（否则这几秒内的翻章、滚动不会保存）
    this.remoteUntil = 0;
  }

  /** 侧栏或编辑器里的正文滚动：只有用户自己滚动才记为进度（跟随其他端、恢复位置引起的滚动不算） */
  private onBodyScrolled(index: number, ratio: number, user: boolean): void {
    if (index !== this.session.index || !user || this.session.loading) {
      return;
    }
    this.markLocalInput();
    this.currentPos = Math.max(0, Math.min(10000, Math.round(ratio * 10000)));
    this.scheduleSave();
  }

  /** 滚动或行内阅读翻页后，停一会儿再保存章内位置 */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      const book = this.session.book;
      if (!book || !this.session.reading || Date.now() < this.remoteUntil) {
        return;
      }
      void this.api.saveBookProgress(book, this.session.chapters, this.session.index, this.currentPos);
    }, SAVE_DELAY_MS);
  }

  private onInlinePosition(pos: number): void {
    this.markLocalInput();
    this.currentPos = pos;
    this.scheduleSave();
  }

  /**
   * 其他端（网页、手机、另一个 IDE）保存了进度：正在读同一本书时跟着翻章、滚动；
   * 不在读这本书时只更新书架上显示的进度
   */
  private log(msg: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] 进度同步：${msg}`);
  }

  private onRemoteProgress(e: ProgressEvent): void {
    this.log(`收到其他端的进度：书 ${e.bookId}，第 ${e.index} 章（${e.title ?? ""}），位置 ${e.pos}`);
    const shelfBook = this.session.bookshelf.find((b) => b.id === e.bookId);
    if (shelfBook) {
      shelfBook.durChapterIndex = e.index;
      shelfBook.durChapterPos = e.pos;
      if (e.title) {
        shelfBook.durChapterTitle = e.title;
      }
    }
    const book = this.session.book;
    if (!this.session.reading || !book || book.id !== e.bookId) {
      this.log(this.session.reading && book ? `正在读的是另一本书（${book.id}），只更新书架` : "没有在阅读，只更新书架");
      if (!this.session.reading && shelfBook) {
        this.postState();
      }
      return;
    }
    if (Date.now() - this.lastLocalInput < LOCAL_ACTIVE_MS) {
      this.log("本端 3 秒内有操作，不跟随");
      return;
    }
    const chapters = this.session.chapters;
    let target = chapters.findIndex((c) => c.index === e.index);
    if (target < 0) {
      // 进度停在卷名上：取它后面的第一章
      target = chapters.findIndex((c) => c.index > e.index);
    }
    if (target < 0) {
      this.log("目录里找不到这一章，请刷新目录");
      return;
    }
    if (target === this.session.index && Math.abs(e.pos - this.currentPos) < 30) {
      return;
    }
    this.log(target === this.session.index ? "跟随：同一章内滚动" : `跟随：切换到 ${chapters[target].title}`);
    this.remoteUntil = Date.now() + LOCAL_ACTIVE_MS;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    book.durChapterIndex = e.index;
    book.durChapterPos = e.pos;
    if (target === this.session.index) {
      this.currentPos = e.pos;
      this.inline.applyPosition(e.pos);
      void this.view?.webview.postMessage({ type: "scroll", ratio: e.pos / 10000 });
      this.chapterPanel.scrollTo(e.pos / 10000);
      return;
    }
    this.session.index = target;
    this.inline.resetToFirstChunk();
    void this.loadCurrentChapter(e.pos, false);
  }

  private async onMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case "ready":
        this.postState({ restoreScroll: this.contentScrollTop });
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
      case "selectChapter":
        {
          const target = Number(msg.index);
          if (target === this.session.index) {
            break;
          }
          if (target >= 0 && target < this.session.chapters.length) {
            this.markLocalInput();
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
        if (Number(msg.index) === this.session.index) {
          this.contentScrollTop = Math.max(0, Number(msg.scrollTop) || 0);
          this.onBodyScrolled(Number(msg.index), Number(msg.ratio) || 0, msg.user === true);
        }
        await this.maybePreloadFromScroll(Number(msg.progress) || 0);
        break;
      case "openSettings":
        await vscode.commands.executeCommand("workbench.action.openSettings", "legado");
        break;
      case "openInEditor":
        this.openInEditor();
        break;
      case "closePanel":
        this.chapterPanel.close();
        break;
      case "backToSidebar":
        // 回到侧栏阅读：关掉行内阅读和编辑器面板，并跳到当前进度
        await this.inline.setEnabled(false);
        this.chapterPanel.close();
        this.postState({ scrollRatio: this.currentPos / 10000 });
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

  private editorState(): ChapterPanelState {
    const font = getBodyFont();
    const chapter = this.session.currentChapter();
    const total = this.session.chapters.length;
    const index = this.session.index;
    return {
      bookName: this.session.book?.name || "",
      chapterTitle: chapter?.title || "",
      body: this.session.body,
      index,
      total,
      canPrev: index > 0,
      canNext: index >= 0 && index + 1 < total,
      fontColor: font.color,
      fontSize: font.size,
      loading: this.session.loading,
      error: this.session.error,
      chapterTitles: this.session.chapters.map((c, i) => c.title || `第${i + 1}章`),
      layout: this.layout,
    };
  }

  /** 选了目录里的一章（侧栏或编辑器面板的章节下拉框） */
  private async selectChapter(target: number): Promise<void> {
    if (target === this.session.index || target < 0 || target >= this.session.chapters.length) {
      return;
    }
    this.markLocalInput();
    this.session.index = target;
    await this.switchChapter(0);
  }

  private postState(extra: Record<string, unknown> = {}): void {
    if (typeof extra.scrollTo === "number") {
      this.contentScrollTop = 0;
    }
    const font = getBodyFont();
    const chapter = this.session.currentChapter();
    this.chapterPanel.sync({
      ...this.editorState(),
      ...(typeof extra.scrollRatio === "number" ? { scrollRatio: extra.scrollRatio } : {}),
    });
    void this.view?.webview.postMessage({
      type: "state",
      reading: this.session.reading,
      bookshelf: this.session.bookshelf.map((b) => ({
        name: b.name,
        current: b.durChapterTitle || b.latestChapterTitle || "",
        source: b.originName,
        author: b.author,
      })),
      panelOpen: this.chapterPanel.isOpen,
      inlineOpen: this.inline.isShowing,
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
