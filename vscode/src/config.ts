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

export function getBodyFont(): { color: string; size: number } {
  const c = vscode.workspace.getConfiguration("legado");
  const color = (c.get<string>("textBodyFontColor") || "").trim();
  const size = c.get<number>("textBodyFontSize") || 0;
  return { color, size };
}
