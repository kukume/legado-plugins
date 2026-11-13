import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunkAtPosition,
  chunkText,
  clampChunkSize,
  DEFAULT_CHUNK_SIZE,
  maxChunkIndex,
  plainBody,
  positionOfChunk,
  splitChunks,
} from "../chunk";
import { ReadSession } from "../session";

describe("chunk", () => {
  it("clamps invalid sizes", () => {
    assert.equal(clampChunkSize(0), DEFAULT_CHUNK_SIZE);
    assert.equal(clampChunkSize(999), DEFAULT_CHUNK_SIZE);
    assert.equal(clampChunkSize(40), 40);
  });

  it("hard-cuts text without punctuation into 80-char pages", () => {
    const text = "甲".repeat(200);
    assert.equal(maxChunkIndex(text, 80), 2);
    assert.equal(chunkText(text, 0, 80).length, 80);
    assert.equal(chunkText(text, 2, 80).length, 40);
  });

  it("cuts at exactly the configured size, ignoring punctuation", () => {
    // 句号在第 70 字后，但按字数切，第 80 字处断
    const text = "甲".repeat(69) + "。" + "乙".repeat(60);
    const chunks = splitChunks(text, 80);
    assert.equal(chunks[0].text.length, 80);
    assert.equal(chunks[0].text.slice(-1), "乙");
    assert.equal(chunks[1].text.length, 50);
  });

  it("does not count or join whitespace across the cut", () => {
    // 换行和全角缩进不显示也不计数：每页仍是 80 个可见字
    const text = "甲".repeat(70) + "\n　　" + "乙".repeat(30);
    const chunks = splitChunks(text, 80);
    assert.equal(chunks[0].text.replace(/\s/g, "").length, 80);
    assert.equal(chunks[0].text.startsWith("甲"), true);
    assert.equal(chunks[1].text.replace(/\s/g, "").length, 20);
  });

  it("keeps every visible character exactly once", () => {
    const text = "甲".repeat(37) + "\n" + "乙".repeat(51) + "\n　" + "丙".repeat(9);
    const joined = splitChunks(text, 80).map((c) => c.text).join("").replace(/\s/g, "");
    assert.equal(joined, text.replace(/\s/g, ""));
  });

  it("maps chapter positions to pages and back", () => {
    const text = "甲".repeat(100) + "\n" + "乙".repeat(100);
    const n = maxChunkIndex(text, 80) + 1;
    for (let i = 0; i < n; i++) {
      assert.equal(chunkAtPosition(text, positionOfChunk(text, i, 80), 80), i);
    }
    assert.equal(chunkAtPosition(text, 0, 80), 0);
    assert.equal(chunkAtPosition(text, 10000, 80), n - 1);
  });
});

describe("ReadSession chapter window", () => {
  it("centers a 10-chapter window on the current index", () => {
    const s = new ReadSession();
    s.chapters = Array.from({ length: 40 }, (_, i) => ({
      title: `c${i}`,
      index: i,
    }));
    s.index = 20;
    s.resetChapterWindow(10);
    assert.equal(s.chapterWindowStart, 15);
    assert.equal(s.chapterWindowEnd, 25);
    s.index = 0;
    s.ensureCurrentInWindow(10);
    assert.equal(s.chapterWindowStart, 0);
    assert.equal(s.chapterWindowEnd, 10);
  });
});
