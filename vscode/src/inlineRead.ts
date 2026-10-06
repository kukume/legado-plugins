import * as vscode from "vscode";
import { ApiClient } from "./api";
import {
  clampChunkSize,
  formatChunkLabel,
  maxChunkIndex,
  plainBody,
  PRELOAD_REMAINING_CHUNKS,
} from "./chunk";
import { getChunkSize } from "./config";
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
      vscode.window.onDidChangeTextEditorSelection(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refresh())
    );
    this.updateStatus();
    if (this.enabledInternal) {
      this.refresh();
    }
  }

  dispose(): void {
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
        this.refresh();
      }
      return;
    }
    this.enabledInternal = value;
    await this.context.globalState.update("legado.inlineRead.enabled", value);
    this.updateStatus();
    await vscode.commands.executeCommand("setContext", "legado.inlineRead", value);
    if (value) {
      this.refresh();
    } else {
      this.pendingShowAfterLoad = false;
      this.clear();
    }
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
    const loading = await this.step(false);
    if (!loading) {
      this.refresh();
    }
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
    const editor = vscode.window.activeTextEditor ?? this.lastEditor;
    if (!this.enabledInternal || !editor) {
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
    editor.setDecorations(this.decoration, [
      {
        range,
        renderOptions: {
          after: {
            contentText: ` ${label}`,
            color: new vscode.ThemeColor("editorCodeLens.foreground"),
            margin: "0 0 0 8px",
            fontStyle: "normal",
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
    this.status.tooltip = "行内阅读：Ctrl+Alt+] 下一段，Ctrl+Alt+[ 上一段";
    this.status.show();
  }
}
