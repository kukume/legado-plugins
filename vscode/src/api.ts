import * as http from "http";
import * as https from "https";
import { URL } from "url";
import { Book, BookChapter, ApiConfig } from "./types";
import { textOf, toPlainText } from "./text";

const PREFIX = "/openapi/v1";

interface CacheEntry {
  value: string;
  expiresAt: number;
}

/**
 * 阅读 Web 开放接口客户端（API Key 鉴权，请求头 X-API-Key）。
 *
 * 书架：GET /openapi/v1/shelf
 * 目录：GET /openapi/v1/books/{id}
 * 正文：GET /openapi/v1/books/{id}/content?index=&saveProgress=false
 * 进度：PUT /openapi/v1/books/{id}/progress  body={index, title}
 */
export class ApiClient {
  /** 正文缓存：预加载下一章后，切章可以直接显示 */
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 10 * 60 * 1000;
  private readonly cacheMax = 20;

  constructor(private readonly configProvider: () => ApiConfig) {}

  private config(): ApiConfig {
    return this.configProvider();
  }

  private baseUrl(): string {
    return (this.config().address || "").trim().replace(/\/+$/, "");
  }

  private ensureConfigured(): void {
    if (!this.baseUrl()) {
      throw new Error("请先在设置中填写阅读 Web 的服务器地址（搜索 legado.address）");
    }
    if (!this.config().apiKey.trim()) {
      throw new Error("请先在设置中填写 API Key（在阅读 Web 的“我的 → API Key”中创建，搜索 legado.apiKey）");
    }
  }

  /** 发送请求；出错时取服务器返回的 { error } 作为提示 */
  private async request(path: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
    this.ensureConfigured();
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-API-Key": this.config().apiKey.trim(),
    };
    if (init.body) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = String(Buffer.byteLength(init.body));
    }
    const { status, body } = await httpText(this.baseUrl() + PREFIX + path, {
      method: init.method || "GET",
      headers,
      body: init.body,
    });
    let json: unknown;
    try {
      json = body ? (JSON.parse(body) as unknown) : undefined;
    } catch {
      json = undefined;
    }
    if (status < 200 || status >= 300) {
      throw new Error(textOf(json, "error") || `HTTP ${status}: ${body.slice(0, 200)}`);
    }
    if (json === undefined) {
      throw new Error("接口返回非 JSON");
    }
    return json;
  }

  parseBook(node: unknown): Book {
    const o = (node ?? {}) as Record<string, unknown>;
    return {
      id: Number(o.id),
      name: textOf(o, "name"),
      author: textOf(o, "author") || "未知作者",
      originName: textOf(o, "originName"),
      coverUrl: textOf(o, "coverUrl") || undefined,
      intro: textOf(o, "intro") || undefined,
      kind: textOf(o, "kind") || undefined,
      latestChapterTitle: textOf(o, "latestChapterTitle") || undefined,
      totalChapterNum: typeof o.totalChapterNum === "number" ? o.totalChapterNum : undefined,
      durChapterIndex: typeof o.durChapterIndex === "number" ? o.durChapterIndex : 0,
      durChapterPos: 0,
      durChapterTitle: textOf(o, "durChapterTitle") || undefined,
    };
  }

  /** 书架（只保留文字书：听书、视频、漫画不支持） */
  async getBookshelf(): Promise<Book[]> {
    const data = await this.request("/shelf");
    if (!Array.isArray(data)) {
      throw new Error("书架数据格式错误");
    }
    return data
      .filter((o: Record<string, unknown>) => !o.isAudio && !o.isVideo && !o.isImage)
      .map((o) => this.parseBook(o));
  }

  /** 目录（去掉卷名）；顺便用服务器上最新的阅读进度更新 book */
  async getChapterList(book: Book): Promise<BookChapter[]> {
    const json = (await this.request(`/books/${book.id}`)) as { book?: Record<string, unknown>; chapters?: unknown };
    if (json.book) {
      if (typeof json.book.durChapterIndex === "number") {
        book.durChapterIndex = json.book.durChapterIndex;
      }
      const title = textOf(json.book, "durChapterTitle");
      if (title) {
        book.durChapterTitle = title;
      }
    }
    if (!Array.isArray(json.chapters)) {
      throw new Error("目录数据格式错误");
    }
    return json.chapters
      .filter((c: Record<string, unknown>) => !c.isVolume && typeof c.index === "number")
      .map((c: Record<string, unknown>) => ({ index: c.index as number, title: textOf(c, "title") || `第${(c.index as number) + 1}章` }));
  }

  private cacheGet(key: string): string | undefined {
    const hit = this.cache.get(key);
    if (!hit) {
      return undefined;
    }
    if (Date.now() > hit.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return hit.value;
  }

  private cachePut(key: string, value: string): void {
    if (this.cache.size >= this.cacheMax) {
      const first = this.cache.keys().next().value;
      if (first) {
        this.cache.delete(first);
      }
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
  }

  /**
   * 正文（index 为目录列表下标）。不记录进度：预加载下一章时也会调用，进度由 saveBookProgress 单独保存
   */
  async getBookContent(book: Book, chapters: BookChapter[], index: number): Promise<string> {
    if (index < 0 || index >= chapters.length) {
      throw new Error(`章节下标越界: ${index} / ${chapters.length}`);
    }
    const serverIndex = chapters[index].index;
    const cacheKey = `${book.id}:${serverIndex}`;
    const cached = this.cacheGet(cacheKey);
    if (cached) {
      return cached;
    }
    const json = await this.request(`/books/${book.id}/content?index=${serverIndex}&saveProgress=false`);
    const raw = textOf(json, "content");
    if (!raw.trim()) {
      throw new Error("正文为空");
    }
    const text = toPlainText(raw);
    this.cachePut(cacheKey, text);
    return text;
  }

  /** 保存阅读进度（index 为目录列表下标）；失败不影响阅读 */
  async saveBookProgress(book: Book, chapters: BookChapter[], index: number): Promise<void> {
    if (index < 0 || index >= chapters.length) {
      return;
    }
    const chapter = chapters[index];
    try {
      await this.request(`/books/${book.id}/progress`, {
        method: "PUT",
        body: JSON.stringify({ index: chapter.index, title: chapter.title }),
      });
      book.durChapterIndex = chapter.index;
      book.durChapterTitle = chapter.title;
    } catch {
      // 进度同步失败不影响阅读
    }
  }

  /**
   * 根据书的阅读进度（服务器目录序号）定位到目录列表下标：
   * 进度停在卷名上时取它后面的第一章；找不到时按标题匹配，再不行从头开始
   */
  resolveChapterIndex(book: Book, chapters: BookChapter[]): number {
    const dur = book.durChapterIndex;
    if (dur >= 0) {
      const exact = chapters.findIndex((c) => c.index === dur);
      if (exact >= 0) {
        return exact;
      }
      const after = chapters.findIndex((c) => c.index > dur);
      if (after >= 0) {
        return after;
      }
    }
    if (book.durChapterTitle) {
      const found = chapters.findIndex((c) => c.title === book.durChapterTitle);
      if (found >= 0) {
        return found;
      }
    }
    return 0;
  }
}

/** 正文没有缓存时服务器要向书源请求，可能比较慢 */
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;

export function httpText(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string },
  redirects = 0
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      reject(new Error(`无效 URL: ${url}`));
      return;
    }
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) {
            reject(new Error("重定向过多"));
            return;
          }
          const nextUrl = new URL(location, url).toString();
          const nextMethod = status === 307 || status === 308 ? options.method : "GET";
          const nextBody = nextMethod === "GET" ? undefined : options.body;
          const headers = { ...options.headers };
          if (nextMethod === "GET") {
            delete headers["Content-Length"];
            delete headers["Content-Type"];
          }
          httpText(nextUrl, { method: nextMethod, headers, body: nextBody }, redirects + 1).then(
            resolve,
            reject
          );
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ status, body: Buffer.concat(chunks).toString("utf8") });
        });
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("请求超时（120s），请检查网络或服务器地址"));
    });
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}
