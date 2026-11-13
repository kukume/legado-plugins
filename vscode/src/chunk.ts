export const DEFAULT_CHUNK_SIZE = 80;
export const PRELOAD_REMAINING_CHUNKS = 2;

export function clampChunkSize(n: number | undefined): number {
  if (n == null || !Number.isFinite(n) || n < 1 || n > 500) {
    return DEFAULT_CHUNK_SIZE;
  }
  return Math.trunc(n);
}

export function plainBody(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

/** 一段：在正文（plainBody）中的起止位置和显示的文字 */
export interface Chunk {
  start: number;
  end: number;
  text: string;
}

let cacheKey = "";
let cacheChunks: Chunk[] = [];

/**
 * 正文分页：按设置的字数硬切，一页正好 size 个可见字，不按段落、也不按标点。
 * 换行和缩进这类空白不显示、也不计数，所以每页显示的字数就是设置的字数。
 * 同一章反复调用时用缓存
 */
export function splitChunks(text: string, size: number): Chunk[] {
  const key = `${size}\u0000${text}`;
  if (key === cacheKey) {
    return cacheChunks;
  }
  const out: Chunk[] = [];
  let start = -1;
  let count = 0;
  let end = 0;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      continue;
    }
    if (start < 0) {
      start = i;
    }
    count++;
    end = i + 1;
    if (count === size) {
      out.push({ start, end, text: text.slice(start, end) });
      start = -1;
      count = 0;
    }
  }
  if (start >= 0) {
    out.push({ start, end, text: text.slice(start, end) });
  }
  cacheKey = key;
  cacheChunks = out;
  return out;
}

export function maxChunkIndex(text: string, chunkSize: number): number {
  return Math.max(0, splitChunks(text, chunkSize).length - 1);
}

export function chunkText(text: string, chunkIndex: number, chunkSize: number): string {
  const chunks = splitChunks(text, chunkSize);
  if (!chunks.length) {
    return "";
  }
  return chunks[Math.min(Math.max(chunkIndex, 0), chunks.length - 1)].text;
}

/** 第 chunkIndex 页的开头在本章中的位置（0~10000，按字数比例，与网页版的章内位置大致对应） */
export function positionOfChunk(text: string, chunkIndex: number, chunkSize: number): number {
  const chunks = splitChunks(text, chunkSize);
  const c = chunks[Math.min(Math.max(chunkIndex, 0), chunks.length - 1)];
  // 向上取整：按比例换算回去时不能落到本页开头之前（否则 chunkAtPosition 会退回上一页）
  return c && text.length ? Math.ceil((c.start / text.length) * 10000) : 0;
}

/** 章内位置 pos（0~10000）落在第几页 */
export function chunkAtPosition(text: string, pos: number, chunkSize: number): number {
  const chunks = splitChunks(text, chunkSize);
  if (!chunks.length) {
    return 0;
  }
  const at = (Math.max(0, Math.min(10000, pos)) / 10000) * text.length;
  let i = 0;
  while (i + 1 < chunks.length && chunks[i + 1].start <= at) {
    i++;
  }
  return i;
}
