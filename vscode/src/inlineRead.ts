import * as vscode from "vscode";
import { ApiClient } from "./api";
import {
  clampChunkSize,
  formatChunkLabel,
  maxChunkIndex,
  plainBody,
  PRELOAD_REMAINING_CHUNKS,
} from "./chunk";
import { getChunkSize, getInlineReadFontSize } from "./config";
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
  private shownDocument: string | undefined;
  /** 刚用快捷键打开时，忽略同一次点击带来的编辑器焦点抖动。 */
  private stickShown = false;
  private stickTimer: ReturnType<typeof setTimeout> | undefined;

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
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration("legado.inlineReadFontSize") ||
          e.affectsConfiguration("legado.inlineReadChunkSize") ||
          e.affectsConfiguration("editor.fontSize") ||
          e.affectsConfiguration("editor.fontFamily")
        ) {
          this.refresh();
        }
      })
    );
    this.updateStatus();
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
    await this.context.globalState.update("legado.inlineRead.enabled", value);
    await vscode.commands.executeCommand("setContext", "legado.inlineRead", value);
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

  afterBodyLoaded(): void {
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
      this.chunkIndex = maxChunkIndex(text, this.chunkSize());
    } else {
      this.chunkIndex = Math.min(Math.max(this.chunkIndex, 0), maxChunkIndex(text, this.chunkSize()));
    }
    if (this.pendingShowAfterLoad) {
      this.pendingShowAfterLoad = false;
    }
    this.refresh();
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

  private async step(forward: boolean): Promise<boolean> {
    if (this.pendingShowAfterLoad) {
      this.refresh("加载中…");
      return true;
    }
    const text = plainBody(this.session.body);
    if (!text) {
      this.refresh("暂无正文，请先在 Legado Reader 打开一章");
      return false;
    }
    const max = maxChunkIndex(text, this.chunkSize());
    if (forward) {
      if (this.chunkIndex < max) {
        this.chunkIndex++;
        this.maybePreload(max);
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
    const editor = this.editorForShow();
    if (!this.enabledInternal || !editor || !this.shownDocument || this.shownDocument !== this.documentKey(editor)) {
      this.clear();
      return;
    }
    this.lastEditor = editor;
    const pos = editor.selection.active;
    let label = override;
    if (!label) {
      const text = plainBody(this.session.body);
      if (!text) {
        label = "暂无正文，请先在 Legado Reader 打开一章";
      } else if (this.pendingShowAfterLoad) {
        label = "加载中…";
      } else {
        label = formatChunkLabel(text, this.chunkIndex, this.chunkSize());
        this.maybePreload(maxChunkIndex(text, this.chunkSize()));
      }
    }
    const range = new vscode.Range(pos, pos);
    const fontSize = getInlineReadFontSize();
    editor.setDecorations(this.decoration, [
      {
        range,
        renderOptions: {
          after: {
            contentText: ` ${label.replace(/\s+/g, " ")}`,
            color: new vscode.ThemeColor("editorCodeLens.foreground"),
            margin: "0 0 0 0.6em",
            fontStyle: "normal",
            fontWeight: "normal",
            // VS Code 装饰器没有字号字段，用 textDecoration 注入，避免再套一层背景框
            textDecoration: inlineTextStyle(fontSize),
          },
        },
      },
    ]);
  }

  private clear(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decoration, []);
    }
  }

  private updateStatus(): void {
    if (!this.enabledInternal) {
      this.status.hide();
      return;
    }
    const text = plainBody(this.session.body);
    if (!text) {
      this.status.text = "$(book) 行内阅读";
    } else {
      const max = maxChunkIndex(text, this.chunkSize());
      this.status.text = `$(book) 行内 ${this.chunkIndex + 1}/${max + 1}`;
    }
    this.status.tooltip = "行内阅读：Ctrl+Alt+I 开关，左键显示；Ctrl+Alt+] 下一页，Ctrl+Alt+[ 上一页";
    this.status.show();
  }
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
