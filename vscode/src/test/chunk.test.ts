import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunkAtPosition,
  chunkText,
  clampChunkSize,
  DEFAULT_CHUNK_SIZE,
  formatChunkLabel,
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
    assert.match(formatChunkLabel(text, 1, 80), /·2\/3$/);
  });

  it("breaks at the sentence end nearest to the page size", () => {
    // 句号在第 70 字和第 95 字后：第一页断在 70（离 80 更近），而不是硬切在 80
    const text = "甲".repeat(69) + "。" + "乙".repeat(24) + "。" + "丙".repeat(60);
    const chunks = splitChunks(text, 80);
    assert.equal(chunks[0].text, "甲".repeat(69) + "。");
    assert.equal(chunks[1].text.startsWith("乙"), true);
  });

  it("keeps closing quotes with the sentence", () => {
    const text = "甲".repeat(70) + "。”" + "乙".repeat(60);
    assert.equal(splitChunks(text, 80)[0].text.endsWith("。”"), true);
  });

  it("never joins two paragraphs into one page", () => {
    const chunks = splitChunks("a\n　　b\nc", 80);
    assert.deepEqual(chunks.map((c) => c.text), ["a", "b", "c"]);
    assert.equal(plainBody(" \r\n hi \n"), "hi");
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
