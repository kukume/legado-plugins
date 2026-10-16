import * as vscode from "vscode";
import { sanitizeApiKey } from "./apiKey";
import { ApiConfig } from "./types";
import { clampChunkSize, DEFAULT_CHUNK_SIZE } from "./chunk";

export function getApiConfig(): ApiConfig {
  const c = vscode.workspace.getConfiguration("legado");
  return {
    address: (c.get<string>("address") || "").trim(),
    apiKey: sanitizeApiKey(c.get<string>("apiKey")),
    enableErrorLog: Boolean(c.get<boolean>("enableErrorLog")),
  };
}

export function getChunkSize(): number {
  const n = vscode.workspace.getConfiguration("legado").get<number>("inlineReadChunkSize");
  return clampChunkSize(n ?? DEFAULT_CHUNK_SIZE);
}

/** 行内阅读字号。0 表示跟随编辑器字号。 */
export function getInlineReadFontSize(): number {
  const configured = vscode.workspace.getConfiguration("legado").get<number>("inlineReadFontSize") ?? 0;
  if (!Number.isFinite(configured) || configured <= 0) {
    const editorSize = vscode.workspace.getConfiguration("editor").get<number>("fontSize") || 14;
    return Math.min(72, Math.max(8, Math.trunc(editorSize)));
  }
  return Math.min(72, Math.max(8, Math.trunc(configured)));
}

export function getBodyFont(): { color: string; size: number } {
  const c = vscode.workspace.getConfiguration("legado");
  const color = (c.get<string>("textBodyFontColor") || "").trim();
  const size = c.get<number>("textBodyFontSize") || 0;
  return { color, size };
}
