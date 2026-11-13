import { Book, BookChapter } from "./types";

export class ReadSession {
  book: Book | undefined;
  chapters: BookChapter[] = [];
  index = -1;
  body = "";
  bookshelf: Book[] = [];
  reading = false;
  loading = false;
  error = "";
  chapterWindowStart = 0;
  chapterWindowEnd = 0;

  currentChapter(): BookChapter | undefined {
    if (this.index < 0 || this.index >= this.chapters.length) {
      return undefined;
    }
    return this.chapters[this.index];
  }

  resetChapterWindow(pageSize: number): void {
    if (!this.chapters.length) {
      this.chapterWindowStart = 0;
      this.chapterWindowEnd = 0;
      return;
    }
    let idx = this.index;
    if (idx < 0) {
      idx = 0;
    }
    if (idx >= this.chapters.length) {
      idx = this.chapters.length - 1;
    }
    const half = Math.floor(pageSize / 2);
    this.chapterWindowStart = Math.max(0, idx - half);
    this.chapterWindowEnd = Math.min(this.chapters.length, this.chapterWindowStart + pageSize);
    if (this.chapterWindowEnd - this.chapterWindowStart < pageSize) {
      this.chapterWindowStart = Math.max(0, this.chapterWindowEnd - pageSize);
    }
  }

  ensureCurrentInWindow(pageSize: number): void {
    if (!this.chapters.length) {
      return;
    }
    if (this.index < 0 || this.index >= this.chapters.length) {
      return;
    }
    if (this.chapterWindowEnd <= this.chapterWindowStart) {
      this.resetChapterWindow(pageSize);
      return;
    }
    if (this.index < this.chapterWindowStart || this.index >= this.chapterWindowEnd) {
      const half = Math.floor(pageSize / 2);
      this.chapterWindowStart = Math.max(0, this.index - half);
      this.chapterWindowEnd = Math.min(this.chapters.length, this.chapterWindowStart + pageSize);
      if (this.chapterWindowEnd - this.chapterWindowStart < pageSize) {
        this.chapterWindowStart = Math.max(0, this.chapterWindowEnd - pageSize);
      }
    }
  }
}
