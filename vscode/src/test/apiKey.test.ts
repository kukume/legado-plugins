import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isConfigured, sanitizeApiKey } from "../apiKey";

describe("sanitizeApiKey", () => {
  it("trims and strips wrapping quotes", () => {
    assert.equal(sanitizeApiKey('  "lgd_abc"  '), "lgd_abc");
    assert.equal(sanitizeApiKey("'lgd_abc'"), "lgd_abc");
    assert.equal(sanitizeApiKey("lgd_abc"), "lgd_abc");
  });

  it("requires both address and key", () => {
    assert.equal(isConfigured("", "lgd_x"), false);
    assert.equal(isConfigured("http://h:8080", '""'), false);
    assert.equal(isConfigured("http://h:8080", "lgd_x"), true);
  });
});

describe("webview loading merge", () => {
  it("clears loading when the host omits the field", () => {
    const prev = { loading: true, error: "", bookshelf: [{ name: "书" }] };
    const rest = { error: "", bookshelf: [{ name: "书" }] };
    const next = { ...prev, ...rest };
    if (!Object.prototype.hasOwnProperty.call(rest, "loading")) {
      next.loading = false;
    }
    assert.equal(next.loading, false);
    assert.equal(next.bookshelf.length, 1);
  });
});
