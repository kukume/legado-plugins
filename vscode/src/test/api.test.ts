import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiClient } from "../api";
import { toPlainText } from "../text";
import { Book } from "../types";

const api = new ApiClient(() => ({
  address: "https://example.test",
  apiKey: "lgd_x",
  enableErrorLog: false,
}));

describe("toPlainText", () => {
  it("strips tags and decodes entities", () => {
    assert.equal(toPlainText("<p>你好&nbsp;世界</p><br/>下一行"), "你好 世界\n\n下一行");
  });

  it("keeps plain text", () => {
    assert.equal(toPlainText("abc&amp;d"), "abc&d");
  });

  it("drops inline images (review bubbles)", () => {
    assert.equal(toPlainText('　　第一段。<img src="data:image/svg+xml;base64,AAA">\n　　第二段'), "第一段。\n　　第二段");
  });
});

describe("parseBook", () => {
  it("maps open api shelf fields", () => {
    const book = api.parseBook({
      id: 9,
      name: "书名",
      author: "作者",
      originName: "某书源",
      latestChapterTitle: "第10章",
      durChapterIndex: 3,
      durChapterTitle: "第3章",
    });
    assert.equal(book.id, 9);
    assert.equal(book.name, "书名");
    assert.equal(book.author, "作者");
    assert.equal(book.originName, "某书源");
    assert.equal(book.durChapterIndex, 3);
    assert.equal(book.durChapterTitle, "第3章");
  });

  it("falls back to unknown author", () => {
    assert.equal(api.parseBook({ id: 1, name: "n" }).author, "未知作者");
  });
});

describe("resolveChapterIndex", () => {
  // 服务器目录：0 卷名（已过滤）、1、2、4（3 也是卷名）
  const chapters = [
    { index: 1, title: "一" },
    { index: 2, title: "二" },
    { index: 4, title: "四" },
  ];
  const book = (dur: number, title?: string): Book => ({
    id: 1, name: "n", author: "a", originName: "s", durChapterIndex: dur, durChapterPos: 0, durChapterTitle: title,
  });

  it("maps server index to list position", () => {
    assert.equal(api.resolveChapterIndex(book(2), chapters), 1);
  });

  it("moves past a volume heading", () => {
    assert.equal(api.resolveChapterIndex(book(3), chapters), 2);
    assert.equal(api.resolveChapterIndex(book(0), chapters), 0);
  });

  it("falls back to title, then the first chapter", () => {
    assert.equal(api.resolveChapterIndex(book(99, "二"), chapters), 1);
    assert.equal(api.resolveChapterIndex(book(99, "无"), chapters), 0);
  });
});
