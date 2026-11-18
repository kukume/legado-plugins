import * as path from "node:path";
import * as vscode from "vscode";

/**
 * 当前主题里注释（TextMate scope "comment"）的样式。
 *
 * VS Code 没有读取 token 样式的 API，只能顺着当前主题的定义文件自己解析：
 * 从 `workbench.colorTheme` 找到贡献这个主题的扩展，读它的 json，
 * 按 `include` 链从父主题到子主题依次覆盖，取最后一条匹配 `comment` 的设置。
 * 主题是第三方扩展、文件读不到、或链里没有定义时返回空对象，调用方自己兜底。
 */

/** 主题 json 的绝对路径 */
type ThemeFile = string;

/** 主题里 comment 这个 scope 的样式；字段缺省表示主题没定义 */
export interface CommentStyle {
  /** 前景色，如 #6A9955 */
  color?: string;
  /** 斜体 */
  italic?: boolean;
  /** 粗体 */
  bold?: boolean;
}

let cachedKey = "";
let cachedStyle: CommentStyle = {};
let resolved = false;

export async function getCommentStyle(): Promise<CommentStyle> {
  const themeName = vscode.workspace.getConfiguration("workbench").get<string>("colorTheme") || "";
  if (resolved && themeName === cachedKey) {
    return cachedStyle;
  }
  cachedKey = themeName;
  resolved = true;
  cachedStyle = {};
  const file = findThemeFile(themeName);
  if (!file) {
    return cachedStyle;
  }
  try {
    cachedStyle = await readCommentStyle(file, new Set());
  } catch {
    cachedStyle = {};
  }
  return cachedStyle;
}

/** 主题改名或换了主题后重新解析 */
export function invalidateCommentColor(): void {
  resolved = false;
  cachedKey = "";
}

function findThemeFile(themeName: string): ThemeFile | undefined {
  if (!themeName) {
    return undefined;
  }
  for (const extension of vscode.extensions.all) {
    const themes = extension.packageJSON?.contributes?.themes;
    if (!Array.isArray(themes)) {
      continue;
    }
    for (const theme of themes) {
      if (!theme || typeof theme.path !== "string") {
        continue;
      }
      const label = typeof theme.label === "string" ? theme.label : "";
      // 主题名可能是 %xxx% 的本地化 key，也允许用户填 label
      if (theme.id === themeName || label === themeName) {
        return vscode.Uri.joinPath(extension.extensionUri, theme.path).fsPath;
      }
    }
  }
  return undefined;
}

/** 顺着 include 链从父到子合并，取最后定义的 comment 样式 */
async function readCommentStyle(file: ThemeFile, seen: Set<string>): Promise<CommentStyle> {
  if (seen.has(file)) {
    return {};
  }
  seen.add(file);
  const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
  const theme = JSON.parse(new TextDecoder().decode(raw)) as {
    include?: string;
    tokenColors?: { scope?: string | string[]; settings?: { foreground?: string; fontStyle?: string } }[];
  };
  let inherited: CommentStyle = {};
  if (typeof theme.include === "string") {
    // include 相对当前主题文件所在的目录，不是扩展根目录
    inherited = await readCommentStyle(path.resolve(path.dirname(file), theme.include), seen);
  }
  let own: CommentStyle = {};
  for (const entry of theme.tokenColors ?? []) {
    const settings = entry?.settings;
    if (!settings || (!settings.foreground && !settings.fontStyle)) {
      continue;
    }
    const scopes = Array.isArray(entry.scope) ? entry.scope : [entry.scope];
    // "comment" 精确匹配；"comment.line" 这类子 scope 也能用在注释上，但优先级更低
    if (scopes.includes("comment")) {
      own = parseFontStyle(settings.fontStyle, settings.foreground);
    } else if (!own.color && scopes.some((s) => typeof s === "string" && s.startsWith("comment."))) {
      own = parseFontStyle(settings.fontStyle, settings.foreground);
    }
  }
  return { ...inherited, ...own };
}

function parseFontStyle(fontStyle: string | undefined, color: string | undefined): CommentStyle {
  const style: CommentStyle = {};
  if (color) {
    style.color = color;
  }
  if (typeof fontStyle === "string") {
    // 主题里是空格分隔的 "italic bold underline"；空字符串表示显式取消父主题的样式
    style.italic = fontStyle.split(/\s+/).includes("italic");
    style.bold = fontStyle.split(/\s+/).includes("bold");
  }
  return style;
}
