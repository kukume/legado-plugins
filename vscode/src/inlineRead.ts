import * as vscode from "vscode";
import { ApiClient } from "./api";
import {
  chunkAtPosition,
  chunkText,
  clampChunkSize,
  maxChunkIndex,
  plainBody,
  positionOfChunk,
  PRELOAD_REMAINING_CHUNKS,
} from "./chunk";
import { getChunkSize, getInlineReadFontSize, getInlineReadOptions } from "./config";
import { CommentStyle, getCommentStyle, invalidateCommentColor } from "./themeColor";
import { ReadSession } from "./session";

export class InlineReadController implements vscode.Disposable {
  private enabledInternal = false;
  private chunkIndex = 0;
  private pendingJumpToLastChunk = false;
  private pendingShowAfterLoad = false;
  private preloadedNextKey: string | undefined;
  private readonly decoration: vscode.TextEditorDecorationType;
  private readonly status: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private lastEditor: vscode.TextEditor | undefined;
  /** 只在这个文档里显示。切换文件后清空，等下一次鼠标左键。 */
  private shownDocumentInternal: string | undefined;

  /** 显示状态变化时通知宿主（侧栏据此决定是否显示正文） */
  private get shownDocument(): string | undefined {
    return this.shownDocumentInternal;
  }

  private set shownDocument(value: string | undefined) {
    const changed = this.shownDocumentInternal !== value;
    this.shownDocumentInternal = value;
    if (changed) {
      this.onDidChangeShowing?.();
      this.syncActiveContext();
    }
  }

  /**
   * 编辑器标题栏的翻段按钮用这个上下文键决定是否显示：
   * 只要编辑器里正显示行内正文就一直显示，不受焦点在侧栏还是编辑器影响。
   * 进入或离开正文时由宿主调用，因为 session.reading 变了但 shownDocument 可能还没变
   */
  syncActiveContext(): void {
    const active = this.enabledInternal && this.session.reading && !!this.shownDocumentInternal;
    void vscode.commands.executeCommand("setContext", "legado.inlineActive", active);
  }

  /** 刚用快捷键打开时，忽略同一次点击带来的编辑器焦点抖动。 */
  private stickShown = false;
  private stickTimer: ReturnType<typeof setTimeout> | undefined;
  /** 用户翻段后通知阅读视图保存章内位置（0~10000） */
  onUserPosition: ((pos: number) => void) | undefined;
  /** 开关或显示状态变了：侧栏据此决定是否显示正文 */
  onDidChangeShowing: (() => void) | undefined;
  /** 当前主题里注释的样式（伪装成注释时用），读不到就用主题的 CodeLens 颜色 */
  private commentStyle: CommentStyle = {};

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: ReadSession,
    private readonly api: ApiClient,
    private readonly onNeedChapter: (delta: 0) => Promise<void>
  ) {
    this.enabledInternal = context.globalState.get("legado.inlineRead.enabled", false);
    this.decoration = vscode.window.createTextEditorDecorationType({});
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
    this.status.command = "legado.toggleInlineRead";
    this.disposables.push(
      this.decoration,
      this.status,
      vscode.window.onDidChangeTextEditorSelection((e) => this.onSelection(e)),
      vscode.window.onDidChangeActiveTextEditor(() => this.onActiveEditorChanged()),
      // 一编辑代码就隐藏（老板键）：下次单击再显示
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (
          e.contentChanges.length &&
          this.shownDocument === e.document.uri.toString() &&
          getInlineReadOptions().hideOnType
        ) {
          this.shownDocument = undefined;
          this.stickShown = false;
          this.clear();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration("legado.inlineReadFontSize") ||
          e.affectsConfiguration("legado.inlineReadChunkSize") ||
          e.affectsConfiguration("legado.inlineReadStyle") ||
          e.affectsConfiguration("legado.inlineReadColor") ||
          e.affectsConfiguration("editor.fontSize") ||
          e.affectsConfiguration("editor.fontFamily")
        ) {
          this.refresh();
        }
        if (e.affectsConfiguration("workbench.colorTheme")) {
          void this.loadCommentColor();
        }
      })
    );
    this.updateStatus();
    void this.loadCommentColor();
  }

  /** 读当前主题里注释的样式：伪装成注释时用它，和真正的注释一致 */
  private async loadCommentColor(): Promise<void> {
    invalidateCommentColor();
    const style = await getCommentStyle();
    if (
      style.color === this.commentStyle.color &&
      style.italic === this.commentStyle.italic &&
      style.bold === this.commentStyle.bold
    ) {
      return;
    }
    this.commentStyle = style;
    // 样式变了要重画一次，否则要等下一次翻段才生效
    this.refresh();
  }

  dispose(): void {
    if (this.stickTimer) {
      clearTimeout(this.stickTimer);
    }
    this.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  get enabled(): boolean {
    return this.enabledInternal;
  }

  /**
   * 正文显示在编辑器里：开着行内阅读、正在读正文，并且这个文档里已经显示（或即将显示）。
   * 在侧栏开启行内阅读时还没有活动编辑器，此时也算“要显示”——
   * 否则侧栏会同时显示整章正文，和行内阅读重复。
   */
  get isShowing(): boolean {
    return this.enabledInternal && this.session.reading;
  }

  async setEnabled(value: boolean): Promise<void> {
    if (this.enabledInternal === value) {
      if (value) {
        this.pinActive();
        this.refresh();
      }
      return;
    }
    this.enabledInternal = value;
    if (value) {
      this.pinActive();
      this.refresh();
    } else {
      this.pendingShowAfterLoad = false;
      this.shownDocument = undefined;
      this.stickShown = false;
      this.clear();
    }
    this.updateStatus();
    this.onDidChangeShowing?.();
    await this.context.globalState.update("legado.inlineRead.enabled", value);
    await vscode.commands.executeCommand("setContext", "legado.inlineRead", value);
    this.syncActiveContext();
  }

  async toggle(): Promise<boolean> {
    await this.setEnabled(!this.enabledInternal);
    return this.enabledInternal;
  }

  resetToFirstChunk(): void {
    if (!this.pendingJumpToLastChunk) {
      this.chunkIndex = 0;
    }
  }

  /** 正文加载完成；pos 为要定位到的章内位置（0~10000，打开书或跟随其他端时） */
  afterBodyLoaded(pos = 0): void {
    const text = plainBody(this.session.body);
    if (!text) {
      this.chunkIndex = 0;
      this.pendingJumpToLastChunk = false;
      this.pendingShowAfterLoad = false;
      this.refresh();
      return;
    }
    if (this.pendingJumpToLastChunk) {
      this.pendingJumpToLastChunk = false;
      this.chunkIndex = maxChunkIndex(text, this.chunkSize(), this.firstChunkSize());
      this.notifyPosition(text);
    } else if (pos > 0) {
      this.chunkIndex = this.chunkForPosition(text, pos);
    } else {
      this.chunkIndex = Math.min(
        Math.max(this.chunkIndex, 0),
        maxChunkIndex(text, this.chunkSize(), this.firstChunkSize())
      );
    }
    if (this.pendingShowAfterLoad) {
      this.pendingShowAfterLoad = false;
    }
    this.refresh();
  }

  /** 跟随其他端：同一章内跳到 pos（0~10000）对应的段 */
  applyPosition(pos: number): void {
    const text = plainBody(this.session.body);
    if (!text) {
      return;
    }
    this.chunkIndex = this.chunkForPosition(text, pos);
    this.refresh();
  }

  /** 章内位置（0~10000，按字数比例）落在第几段 */
  private chunkForPosition(text: string, pos: number): number {
    return chunkAtPosition(text, pos, this.chunkSize(), this.firstChunkSize());
  }

  /** 当前段的开头在本章中的位置（0~10000） */
  private notifyPosition(text = plainBody(this.session.body)): void {
    if (!text || !this.onUserPosition) {
      return;
    }
    this.onUserPosition(positionOfChunk(text, this.chunkIndex, this.chunkSize(), this.firstChunkSize()));
  }

  async nextChunk(): Promise<void> {
    if (!this.enabledInternal) {
      void vscode.window.showInformationMessage("请先开启行内阅读");
      return;
    }
    this.pinActive();
    const loading = await this.step(true);
    if (!loading) {
      this.refresh();
    }
  }

  async previousChunk(): Promise<void> {
    if (!this.enabledInternal) {
      void vscode.window.showInformationMessage("请先开启行内阅读");
      return;
    }
    this.pinActive();
    const loading = await this.step(false);
    if (!loading) {
      this.refresh();
    }
  }

  private onActiveEditorChanged(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      if (this.stickShown) {
        return;
      }
      this.shownDocument = undefined;
      this.clear();
      return;
    }
    const key = this.documentKey(editor);
    if (key === this.shownDocument) {
      return;
    }
    if (this.stickShown) {
      this.shownDocument = key;
      this.lastEditor = editor;
      this.refresh();
      return;
    }
    this.shownDocument = undefined;
    this.clear();
  }

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    this.lastEditor = e.textEditor;
    if (!this.enabledInternal) {
      return;
    }
    if (e.kind === vscode.TextEditorSelectionChangeKind.Mouse) {
      this.shownDocument = this.documentKey(e.textEditor);
      this.refresh();
      return;
    }
    if (this.shownDocument && this.documentKey(e.textEditor) === this.shownDocument) {
      this.refresh();
    }
  }

  private pinActive(): void {
    const editor = vscode.window.activeTextEditor ?? this.lastEditor;
    if (!editor) {
      return;
    }
    this.lastEditor = editor;
    this.shownDocument = this.documentKey(editor);
    this.stickShown = true;
    if (this.stickTimer) {
      clearTimeout(this.stickTimer);
    }
    this.stickTimer = setTimeout(() => {
      this.stickShown = false;
    }, 300);
  }

  private documentKey(editor: vscode.TextEditor): string {
    return editor.document.uri.toString();
  }

  private editorForShow(): vscode.TextEditor | undefined {
    const active = vscode.window.activeTextEditor;
    if (active && this.shownDocument === this.documentKey(active)) {
      return active;
    }
    if (this.lastEditor && this.shownDocument === this.documentKey(this.lastEditor)) {
      return this.lastEditor;
    }
    return active ?? this.lastEditor;
  }

  private chunkSize(): number {
    return clampChunkSize(getChunkSize());
  }

  /** 第一页前面要放章节名：从第一页里扣掉章节名占的字数，整页仍是设置的字数 */
  private firstChunkSize(): number {
    const title = this.session.currentChapter()?.title;
    if (!title) {
      return this.chunkSize();
    }
    const head = `【${title}】`.length;
    return Math.max(1, this.chunkSize() - head);
  }

  private async step(forward: boolean): Promise<boolean> {
    if (this.pendingShowAfterLoad) {
      this.refresh("加载中…");
      return true;
    }
    const text = plainBody(this.session.body);
    if (!text) {
      this.refresh("暂无正文，请先在 Legado 打开一章");
      return false;
    }
    const max = maxChunkIndex(text, this.chunkSize(), this.firstChunkSize());
    if (forward) {
      if (this.chunkIndex < max) {
        this.chunkIndex++;
        this.maybePreload(max);
        this.notifyPosition(text);
        return false;
      }
      if (this.session.index >= 0 && this.session.index + 1 < this.session.chapters.length) {
        this.session.index += 1;
        this.chunkIndex = 0;
        this.pendingShowAfterLoad = true;
        this.refresh("加载中…");
        await this.onNeedChapter(0);
        return true;
      }
      return false;
    }
    if (this.chunkIndex > 0) {
      this.chunkIndex--;
      this.notifyPosition(text);
      return false;
    }
    if (this.session.index > 0 && this.session.index < this.session.chapters.length) {
      this.session.index -= 1;
      this.pendingJumpToLastChunk = true;
      this.pendingShowAfterLoad = true;
      this.refresh("加载中…");
      await this.onNeedChapter(0);
      return true;
    }
    return false;
  }

  private maybePreload(maxChunk: number): void {
    if (!this.enabledInternal) {
      return;
    }
    if (maxChunk - this.chunkIndex > PRELOAD_REMAINING_CHUNKS) {
      return;
    }
    const book = this.session.book;
    const nextIndex = this.session.index + 1;
    if (!book || nextIndex < 0 || nextIndex >= this.session.chapters.length) {
      return;
    }
    const key = `${book.id}:${nextIndex}`;
    if (key === this.preloadedNextKey) {
      return;
    }
    this.preloadedNextKey = key;
    void this.api.getBookContent(book, this.session.chapters, nextIndex).catch(() => {
      if (this.preloadedNextKey === key) {
        this.preloadedNextKey = undefined;
      }
    });
  }

  refresh(override?: string): void {
    this.updateStatus();
    // 没在读正文（在书架页）时不留正文：返回书架后要立刻把行尾的正文清掉
    const editor = this.editorForShow();
    if (
      !this.enabledInternal ||
      !this.session.reading ||
      !editor ||
      !this.shownDocument ||
      this.shownDocument !== this.documentKey(editor)
    ) {
      this.clear();
      return;
    }
    this.lastEditor = editor;
    let label = override;
    if (!label) {
      const text = plainBody(this.session.body);
      if (!text) {
        label = "暂无正文，请先在 Legado 打开一章";
      } else if (this.pendingShowAfterLoad) {
        label = "加载中…";
      } else {
        label = this.chunkLabel(text);
        this.maybePreload(maxChunkIndex(text, this.chunkSize(), this.firstChunkSize()));
      }
    }
    // 显示在当前行代码的末尾：不把光标后面的代码挤开，长行时也不会跑出屏幕
    const line = editor.document.lineAt(editor.selection.active.line);
    const end = line.range.end;
    const options = getInlineReadOptions();
    const comment = options.style === "comment";
    const fontSize = getInlineReadFontSize();
    editor.setDecorations(this.decoration, [
      {
        range: new vscode.Range(end, end),
        renderOptions: {
          after: {
            contentText: `${comment ? commentPrefix(editor.document.languageId) : ""}${label.replace(/\s+/g, " ")}`,
            color: options.color || (comment && this.commentStyle.color) || new vscode.ThemeColor("editorCodeLens.foreground"),
            // 行尾有代码时空出两格，像行尾注释
            margin: line.isEmptyOrWhitespace ? "0" : "0 0 0 2ch",
            // 跟随主题的注释样式：VS Code 默认主题的注释不是斜体，只有主题里勾了斜体才用斜体
            fontStyle: comment && this.commentStyle.italic === true ? "italic" : "normal",
            fontWeight: comment && this.commentStyle.bold === true ? "bold" : "normal",
            // VS Code 装饰器没有字号字段，用 textDecoration 注入，避免再套一层背景框
            textDecoration: inlineTextStyle(fontSize),
          },
        },
      },
    ]);
  }

  /**
   * 当前段的文字：只有正文，后面跟 第几段/共几段。
   * 章节名不加在这里——它会让第一页比设置的字数长；章节名在侧栏和标签页上已经有了
   */
  private chunkLabel(text: string): string {
    const size = this.chunkSize();
    const firstSize = this.firstChunkSize();
    const chunk = chunkText(text, this.chunkIndex, size, firstSize);
    if (!chunk.trim()) {
      return "（无内容）";
    }
    const max = maxChunkIndex(text, size, firstSize);
    const title = this.session.currentChapter()?.title;
    const head = this.chunkIndex === 0 && title ? `【${title}】` : "";
    const hasNext = this.session.index + 1 < this.session.chapters.length;
    const tail = this.chunkIndex >= max ? (hasNext ? " →下一章" : " （全书完）") : "";
    return `${head}${chunk} ·${this.chunkIndex + 1}/${max + 1}${tail}`;
  }

  private clear(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decoration, []);
    }
  }

  private updateStatus(): void {
    // 没打开正文时不显示行内阅读状态（开关状态本身仍然保留）
    if (!this.enabledInternal || !this.session.reading) {
      this.status.hide();
      return;
    }
    const text = plainBody(this.session.body);
    if (!text) {
      this.status.text = "$(book) 行内阅读";
    } else {
      const max = maxChunkIndex(text, this.chunkSize(), this.firstChunkSize());
      this.status.text = `$(book) 行内 ${this.chunkIndex + 1}/${max + 1}`;
    }
    this.status.tooltip = "行内阅读：Ctrl+Alt+I 开关，左键显示；上一段 / 下一段默认不绑定快捷键，可在键盘快捷方式里自行绑定";
    this.status.show();
  }
}

/** 伪装成注释时用的注释符号（按文件的语言） */
function commentPrefix(languageId: string): string {
  if (["python", "shellscript", "ruby", "yaml", "perl", "r", "powershell", "dockerfile", "makefile", "toml", "properties", "coffeescript", "elixir", "julia", "nim", "graphql"].includes(languageId)) {
    return "# ";
  }
  if (["sql", "lua", "haskell", "elm", "ada"].includes(languageId)) {
    return "-- ";
  }
  if (["bat"].includes(languageId)) {
    return "REM ";
  }
  if (["vb"].includes(languageId)) {
    return "' ";
  }
  if (["erlang", "latex", "tex", "matlab"].includes(languageId)) {
    return "% ";
  }
  if (["clojure", "lisp", "scheme", "racket", "ini"].includes(languageId)) {
    return "; ";
  }
  if (["html", "xml", "markdown", "vue-html", "svg"].includes(languageId)) {
    return "<!-- ";
  }
  if (["css"].includes(languageId)) {
    return "/* ";
  }
  return "// ";
}


/** 装饰器没有字号接口，借 textDecoration 把样式写进同一条 CSS。 */
function inlineTextStyle(fontSize: number): string {
  const family = (vscode.workspace.getConfiguration("editor").get<string>("fontFamily") || "")
    .replace(/["']/g, "")
    .trim();
  const fontFamily = family
    ? `font-family: ${family}, "Microsoft YaHei", sans-serif`
    : `font-family: "Microsoft YaHei", sans-serif`;
  return [
    "none",
    "white-space: nowrap",
    "display: inline",
    "padding: 0",
    "border: none",
    "background: none",
    "vertical-align: baseline",
    `font-size: ${fontSize}px`,
    `line-height: ${Math.round(fontSize * 1.2)}px`,
    fontFamily,
  ].join("; ");
}
