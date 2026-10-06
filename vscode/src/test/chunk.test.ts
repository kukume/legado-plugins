import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunkText,
  clampChunkSize,
  DEFAULT_CHUNK_SIZE,
  formatChunkLabel,
  maxChunkIndex,
  plainBody,
} from "../chunk";
import { ReadSession } from "../session";

describe("chunk", () => {
  it("clamps invalid sizes", () => {
    assert.equal(clampChunkSize(0), DEFAULT_CHUNK_SIZE);
    assert.equal(clampChunkSize(999), DEFAULT_CHUNK_SIZE);
    assert.equal(clampChunkSize(40), 40);
  });

  it("splits text into 80-char pages", () => {
    const text = "甲".repeat(200);
    assert.equal(maxChunkIndex(text, 80), 2);
    assert.equal(chunkText(text, 0, 80).length, 80);
    assert.equal(chunkText(text, 2, 80).length, 40);
    assert.match(formatChunkLabel(text, 1, 80), /·2\/3$/);
  });

  it("collapses newlines in a chunk", () => {
    assert.equal(chunkText("a\nb\nc", 0, 80), "a b c");
    assert.equal(plainBody(" \r\n hi \n"), "hi");
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
