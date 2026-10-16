const vscode = acquireVsCodeApi();

const headingEl = document.getElementById("heading");
const bodyEl = document.getElementById("body");
const errorEl = document.getElementById("error");

let lastIndex = null;

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "state") {
    return;
  }
  const heading = msg.chapterTitle || msg.bookName || "";
  headingEl.textContent = heading;
  errorEl.textContent = msg.error || "";
  errorEl.hidden = !msg.error;
  const switched = msg.index !== lastIndex;
  if (switched) {
    lastIndex = msg.index;
    window.scrollTo(0, 0);
  }
  bodyEl.textContent = switched && msg.loading ? "加载中…" : msg.body || (msg.loading ? "加载中…" : "");
  bodyEl.style.color = msg.fontColor || "";
  bodyEl.style.fontSize = msg.fontSize > 0 ? `${msg.fontSize}px` : "";
});

document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return;
  }
  if (event.key === "ArrowLeft") {
    vscode.postMessage({ type: "prevChapter" });
  } else if (event.key === "ArrowRight") {
    vscode.postMessage({ type: "nextChapter" });
  }
});

vscode.postMessage({ type: "ready" });
