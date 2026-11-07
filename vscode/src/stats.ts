import * as vscode from "vscode";
import { ApiClient } from "./api";

/** 多久没有操作就不再计入阅读时间 */
const IDLE_MS = 3 * 60 * 1000;
/** 多久上报一次 */
const FLUSH_MS = 60 * 1000;
/** 每次上报最多计这么多秒（服务器的上限）：上报失败攒下的时间分几次上报 */
const MAX_REPORT_SECONDS = 900;

/** 本地日期 yyyy-MM-dd（按用户所在时区统计“今天”，与网页相同） */
function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 阅读统计（与网页的“我的 → 阅读统计”合在一起）：
 * VS Code 窗口在前台、正文正在显示（侧栏、编辑器面板或行内阅读）、最近 3 分钟内有操作时每秒累计阅读时间；
 * 自己翻到下一章时累计上一章的字数。每分钟上报一次
 */
export class ReadingStatsReporter implements vscode.Disposable {
  private seconds = 0;
  private chars = 0;
  /** 正在累计的书：换了书时先把上一本书的数据上报 */
  private bookId = 0;
  private lastActivity = Date.now();
  private readonly tickTimer: ReturnType<typeof setInterval>;
  private readonly flushTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly api: ApiClient,
    /** 正在显示正文的书的 id，没有在读时为 0 */
    private readonly readingBook: () => number
  ) {
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
  }

  /** 用户有操作（滚动、翻段、换章） */
  touch(): void {
    this.lastActivity = Date.now();
  }

  /** 读完一章（自己翻到下一章时） */
  addChars(bookId: number, n: number): void {
    if (n <= 0 || bookId <= 0) {
      return;
    }
    this.switchBook(bookId);
    this.chars += n;
  }

  dispose(): void {
    clearInterval(this.tickTimer);
    clearInterval(this.flushTimer);
    this.flush();
  }

  private switchBook(id: number): void {
    if (this.bookId && id !== this.bookId) {
      this.flush();
    }
    this.bookId = id;
  }

  private tick(): void {
    if (!vscode.window.state.focused) {
      return;
    }
    const id = this.readingBook();
    if (!id) {
      return;
    }
    this.switchBook(id);
    if (Date.now() - this.lastActivity < IDLE_MS) {
      this.seconds++;
    }
  }

  private flush(): void {
    if ((!this.seconds && !this.chars) || !this.bookId) {
      return;
    }
    const seconds = Math.min(this.seconds, MAX_REPORT_SECONDS);
    const r = { day: localDay(), bookId: this.bookId, seconds, chars: this.chars };
    this.seconds -= seconds;
    this.chars = 0;
    void this.api.reportReading(r).catch(() => {
      // 上报失败（离线等）：放回去，下次一起上报（换了书时丢弃，避免算到别的书上）
      if (this.bookId === r.bookId) {
        this.seconds += r.seconds;
        this.chars += r.chars;
      }
    });
  }
}
