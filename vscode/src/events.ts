import * as http from "http";
import * as https from "https";
import { StringDecoder } from "string_decoder";
import { URL } from "url";
import { ApiConfig } from "./types";

/** 其他端保存的阅读进度（GET /openapi/v1/events，事件名 progress） */
export interface ProgressEvent {
  bookId: number;
  /** 服务器目录中的章节序号 */
  index: number;
  /** 章内位置（比例 0~10000） */
  pos: number;
  title?: string;
  time: number;
}

/** 断线后重连的等待时间：从 3 秒开始逐次加倍，最多 60 秒 */
const RETRY_MIN_MS = 3_000;
const RETRY_MAX_MS = 60_000;
/** 服务器每 25 秒发一次心跳；超过这么久没有任何数据就认为连接已断开 */
const IDLE_TIMEOUT_MS = 70_000;

/**
 * 订阅其他端的阅读进度（SSE）。断线自动重连；地址或 API Key 改了时调用 restart。
 * clientId 与保存进度时的 X-Client-Id 相同，服务器不会把本端保存的进度推送回来
 */
export class ProgressStream {
  private req: http.ClientRequest | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryMs = RETRY_MIN_MS;
  private stopped = true;

  constructor(
    private readonly configProvider: () => ApiConfig,
    private readonly clientId: string,
    private readonly onProgress: (e: ProgressEvent) => void,
    /** 连接状态日志（输出面板“Legado”），排查同步问题用 */
    private readonly log: (msg: string) => void = () => {}
  ) {}

  start(): void {
    this.stop();
    this.stopped = false;
    this.retryMs = RETRY_MIN_MS;
    this.connect();
  }

  restart(): void {
    this.start();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.req?.destroy();
    this.req = undefined;
  }

  dispose(): void {
    this.stop();
  }

  private connect(): void {
    const c = this.configProvider();
    const base = (c.address || "").trim().replace(/\/+$/, "");
    if (!base || !c.apiKey.trim()) {
      return;
    }
    let url: URL;
    try {
      url = new URL(base + "/openapi/v1/events");
    } catch {
      this.log(`服务器地址无效：${base}`);
      return;
    }
    this.log(`连接 ${url.toString()}`);
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          "X-API-Key": c.apiKey.trim(),
          "X-Client-Id": this.clientId,
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          this.log(
            res.statusCode === 404
              ? "服务器不支持进度同步（404），请把阅读 Web 更新到最新版本"
              : `连接失败：HTTP ${res.statusCode}${res.statusCode === 401 ? "（API Key 无效）" : ""}`
          );
          res.resume();
          // API Key 无效（401）时不必频繁重试
          this.scheduleRetry(req, res.statusCode === 401 ? RETRY_MAX_MS : undefined);
          return;
        }
        this.retryMs = RETRY_MIN_MS;
        this.log("已连接，等待其他端的进度（需要在阅读 Web 的“我的”页面开启“多端阅读同步”）");
        // 不用 res.setEncoding("utf8")：那样 data 事件给的是字符串，而调试时 Node 的网络检查器也监听 data，
        // 按 chunk.byteLength 记录，字符串没有这个属性会抛异常，HTTP 解析器随即报
        // “Parse Error: JS Exception” 并断开连接（只在调试扩展时出现）。自己把字节解码成文字
        const decoder = new StringDecoder("utf8");
        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += decoder.write(chunk);
          // 处理放到解析器回调之外：回调里抛出的异常会被 HTTP 解析器当成解析失败（“Parse Error: JS Exception”）
          // 并断开连接，之后的进度就都收不到了
          setImmediate(() => {
            try {
              // 事件之间以空行分隔
              let sep: number;
              while ((sep = buffer.search(/\r?\n\r?\n/)) >= 0) {
                const block = buffer.slice(0, sep);
                buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, "");
                this.handleBlock(block);
              }
            } catch (err) {
              this.log(`处理事件时出错：${describe(err)}`);
            }
          });
        });
        res.on("end", () => {
          this.log("连接已断开，稍后重连");
          this.scheduleRetry(req);
        });
        res.on("error", (e) => {
          this.log(`连接出错：${describe(e)}`);
          this.scheduleRetry(req);
        });
      }
    );
    req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error("idle")));
    req.on("error", (e) => {
      if (this.req === req) {
        this.log(`连接出错：${describe(e)}`);
      }
      this.scheduleRetry(req);
    });
    req.end();
    this.req = req;
  }

  private handleBlock(block: string): void {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (event !== "progress" || !data.length) {
      return;
    }
    try {
      const e = JSON.parse(data.join("\n")) as ProgressEvent;
      if (typeof e.bookId === "number" && typeof e.index === "number") {
        this.onProgress(e);
      }
    } catch (err) {
      // 处理出错（如跟随时视图已关闭）不影响连接，记下原因方便排查
      this.log(`处理进度时出错：${describe(err)}`);
    }
  }

  /** req：断开的连接。已经被新连接取代（重启）时不处理，免得同时开出两条连接 */
  private scheduleRetry(req: http.ClientRequest, delay?: number): void {
    if (this.req !== req) {
      return;
    }
    this.req = undefined;
    if (this.stopped || this.retryTimer) {
      return;
    }
    const wait = delay ?? this.retryMs;
    this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (!this.stopped) {
        this.connect();
      }
    }, wait);
  }
}

/** 错误的详细信息（错误码、解析器给出的原因、调用栈），写进日志排查用 */
function describe(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }
  const e = err as Error & { code?: string; reason?: string };
  return [e.message, e.code && `code=${e.code}`, e.reason && `reason=${e.reason}`, e.stack?.split(/\r?\n/).slice(1, 6).join(" | ")]
    .filter(Boolean)
    .join("；");
}
