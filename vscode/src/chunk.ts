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

/** 句末标点（后面可以跟着引号、括号） */
const SENTENCE_END = /[。！？!?…；;]+[”’」』）)》]*/g;
/** 次一级的停顿：逗号、顿号、冒号 */
const CLAUSE_END = /[，,、：:]+[”’」』）)》]*/g;

/**
 * 在 [from, to] 范围内找最接近 target 的断点（标点之后的位置），找不到返回 -1
 */
function nearestBreak(para: string, from: number, to: number, target: number, re: RegExp): number {
  let best = -1;
  re.lastIndex = 0;
  for (let m = re.exec(para); m; m = re.exec(para)) {
    const at = m.index + m[0].length;
    if (at < from) {
      continue;
    }
    if (at > to) {
      break;
    }
    if (best < 0 || Math.abs(at - target) < Math.abs(best - target)) {
      best = at;
    }
  }
  return best;
}

/**
 * 把一段话切成若干页：每页约 size 字，尽量断在句末（其次是逗号），一页在 size 的 0.75~1.25 倍之间浮动；
 * 一整句都找不到标点时才按 size 硬切
 */
function splitParagraph(para: string, offset: number, size: number, out: Chunk[]): void {
  const min = Math.max(1, Math.floor(size * 0.75));
  const max = Math.ceil(size * 1.25);
  let pos = 0;
  while (para.length - pos > max) {
    const rest = para.slice(pos);
    let cut = nearestBreak(rest, min, max, size, SENTENCE_END);
    if (cut < 0) {
      cut = nearestBreak(rest, min, max, size, CLAUSE_END);
    }
    if (cut < 0) {
      cut = size;
    }
    out.push({ start: offset + pos, end: offset + pos + cut, text: rest.slice(0, cut) });
    pos += cut;
  }
  if (pos < para.length) {
    out.push({ start: offset + pos, end: offset + para.length, text: para.slice(pos) });
  }
}

let cacheKey = "";
let cacheChunks: Chunk[] = [];

/**
 * 正文分页：按段落分开（一页不会跨两段），段内按句子切成约 size 字的页。
 * 同一章反复调用时用缓存
 */
export function splitChunks(text: string, size: number): Chunk[] {
  const key = `${size}\u0000${text}`;
  if (key === cacheKey) {
    return cacheChunks;
  }
  const out: Chunk[] = [];
  const re = /[^\n]+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // 段首的空白（含全角空格缩进）不显示
    const lead = m[0].length - m[0].replace(/^[\s　]+/, "").length;
    const para = m[0].slice(lead).replace(/[\s　]+$/, "");
    if (para) {
      splitParagraph(para, m.index + lead, size, out);
    }
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

export function formatChunkLabel(text: string, chunkIndex: number, chunkSize: number): string {
  const body = plainBody(text);
  const chunk = chunkText(body, chunkIndex, chunkSize);
  if (!chunk.trim()) {
    return "（无内容）";
  }
  const max = maxChunkIndex(body, chunkSize);
  return `${chunk} ·${chunkIndex + 1}/${max + 1}`;
}

/** 第 chunkIndex 页的开头在本章中的位置（0~10000，按字数比例，与网页版的章内位置大致对应） */
export function positionOfChunk(text: string, chunkIndex: number, chunkSize: number): number {
  const chunks = splitChunks(text, chunkSize);
  const c = chunks[Math.min(Math.max(chunkIndex, 0), chunks.length - 1)];
  return c && text.length ? Math.round((c.start / text.length) * 10000) : 0;
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
