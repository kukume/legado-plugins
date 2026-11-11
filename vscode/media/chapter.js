const vscode = acquireVsCodeApi();

const headingEl = document.getElementById("heading");
const bodyEl = document.getElementById("body");
const errorEl = document.getElementById("error");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const nextEndBtn = document.getElementById("nextEnd");
const theEndEl = document.getElementById("theEnd");
const tocEl = document.getElementById("toc");
const progressEl = document.getElementById("progress");

let lastIndex = null;
let lastBody = null;
let current = { index: -1, total: 0, canPrev: false, canNext: false, loading: false };

/** 最近一次用户操作：用来区分用户滚动和程序滚动（恢复位置、跟随其他端） */
let lastInput = 0;
for (const ev of ["wheel", "keydown", "pointerdown", "touchstart"]) {
  window.addEventListener(
    ev,
    () => {
      lastInput = Date.now();
      if (ev === "wheel" || ev === "touchstart") {
        cancelAnim?.();
      }
    },
    { capture: true, passive: true }
  );
}

/**
 * 滚动动画（先快后慢）。不用 scrollTo 的 smooth：系统关闭了动画效果
 * （prefers-reduced-motion，如 Windows 的“动画效果”）时会直接跳过去。滚轮、触摸时停下
 */
let cancelAnim = null;
let animTarget = null;
function animateScroll(target, duration = 300) {
  cancelAnim?.();
  const doc = document.documentElement;
  const from = window.scrollY;
  const to = Math.max(0, Math.min(target, doc.scrollHeight - window.innerHeight));
  if (Math.abs(to - from) < 2) {
    return;
  }
  const start = performance.now();
  let timer = 0;
  animTarget = to;
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / duration);
    window.scrollTo(0, from + (to - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) {
      timer = setTimeout(step, 16);
    } else {
      cancelAnim = null;
      animTarget = null;
    }
  };
  cancelAnim = () => {
    clearTimeout(timer);
    cancelAnim = null;
    animTarget = null;
  };
  step();
}

/** 章内位置：视口顶部在整章内容中的比例（与网页版相同） */
function ratio() {
  const h = document.documentElement.scrollHeight;
  return h > 0 ? window.scrollY / h : 0;
}

/** 滚动到章内位置（比例 0~1）；smooth：跟随其他端时滑动过去 */
function applyRatio(r, smooth) {
  const top = Math.max(0, r) * document.documentElement.scrollHeight;
  if (smooth) {
    animateScroll(top, 450);
  } else {
    window.scrollTo(0, top);
  }
}

function updateProgress() {
  if (!current.total || current.index < 0) {
    progressEl.textContent = "";
    return;
  }
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  const inChapter = max > 0 ? Math.min(1, window.scrollY / max) : 1;
  const percent = ((current.index + inChapter) / current.total) * 100;
  progressEl.textContent = `第 ${current.index + 1}/${current.total} 章 · ${percent.toFixed(1)}%`;
}

window.addEventListener("scroll", () => {
  updateProgress();
  // progress：读到本章的多少（0~1），过半时预加载下一章
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const progress = max > 0 ? Math.min(1, window.scrollY / max) : 1;
  vscode.postMessage({ type: "scroll", index: lastIndex, ratio: ratio(), progress, user: Date.now() - lastInput < 1500 });
});

/** 排版：与网页的阅读设置相同；插件设置里单独填了字号、颜色时以插件设置为准 */
function applyLayout(msg) {
  const l = msg.layout || {};
  const s = document.documentElement.style;
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const fontSize = msg.fontSize > 0 ? msg.fontSize : num(l.fontSize, 0);
  s.setProperty("--r-font-size", fontSize > 0 ? `${fontSize}px` : "");
  s.setProperty("--r-line-height", String(num(l.lineHeight, 1.9)));
  s.setProperty("--r-para-gap", `${num(l.paragraphSpacing, 0.6)}em`);
  s.setProperty("--r-letter", `${num(l.letterSpacing, 0.02)}em`);
  s.setProperty("--r-width", l.width > 0 ? `${l.width}px` : "40em");
  s.setProperty("--r-indent", l.indent === false ? "0" : "2em");
  s.setProperty("--r-weight", String(num(l.fontWeight, 400)));
  bodyEl.style.color = msg.fontColor || "";
}

/** 正文按段落显示（每行一段） */
function renderBody(text) {
  bodyEl.textContent = "";
  for (const line of text.split(/\r?\n/)) {
    const t = line.replace(/^[\s　]+/, "").replace(/\s+$/, "");
    if (!t) {
      continue;
    }
    const p = document.createElement("p");
    p.textContent = t;
    bodyEl.appendChild(p);
  }
}

function renderToc(titles) {
  tocEl.textContent = "";
  titles.forEach((t, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = `${i + 1}. ${t}`;
    tocEl.appendChild(o);
  });
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg && msg.type === "scroll" && typeof msg.ratio === "number") {
    applyRatio(msg.ratio, true);
    return;
  }
  if (!msg || msg.type !== "state") {
    return;
  }
  current = msg;
  if (Array.isArray(msg.chapterTitles)) {
    renderToc(msg.chapterTitles);
  }
  if (msg.index >= 0) {
    tocEl.value = String(msg.index);
  }
  headingEl.textContent = msg.chapterTitle || msg.bookName || "";
  errorEl.textContent = msg.error || "";
  errorEl.hidden = !msg.error;
  prevBtn.disabled = !msg.canPrev || msg.loading;
  nextBtn.disabled = !msg.canNext || msg.loading;
  nextEndBtn.hidden = !msg.canNext;
  nextEndBtn.disabled = msg.loading;
  theEndEl.hidden = msg.canNext || msg.loading || !msg.body;
  applyLayout(msg);

  const switched = msg.index !== lastIndex;
  if (switched) {
    lastIndex = msg.index;
    cancelAnim?.();
    window.scrollTo(0, 0);
  }
  const text = msg.loading ? "" : msg.body || "";
  if (msg.loading) {
    bodyEl.textContent = "加载中…";
    lastBody = null;
  } else if (text !== lastBody) {
    lastBody = text;
    renderBody(text);
  }
  if (typeof msg.scrollRatio === "number" && !msg.loading) {
    applyRatio(msg.scrollRatio, false);
  }
  updateProgress();
});

prevBtn.addEventListener("click", () => vscode.postMessage({ type: "prevChapter" }));
nextBtn.addEventListener("click", () => vscode.postMessage({ type: "nextChapter" }));
nextEndBtn.addEventListener("click", () => vscode.postMessage({ type: "nextChapter" }));
tocEl.addEventListener("change", () => vscode.postMessage({ type: "selectChapter", index: Number(tocEl.value) }));

/** 翻一屏；已经在章末再往下翻时进入下一章 */
function pageDown() {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  const base = animTarget ?? window.scrollY;
  if (base >= max - 2) {
    if (current.canNext && !current.loading) {
      vscode.postMessage({ type: "nextChapter" });
    }
    return;
  }
  animateScroll(base + window.innerHeight - 60);
}

function pageUp() {
  const base = animTarget ?? window.scrollY;
  animateScroll(base - (window.innerHeight - 60));
}

document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.target === tocEl) {
    return;
  }
  if (event.key === "ArrowLeft") {
    vscode.postMessage({ type: "prevChapter" });
  } else if (event.key === "ArrowRight") {
    vscode.postMessage({ type: "nextChapter" });
  } else if ((event.key === " " && !event.shiftKey) || event.key === "PageDown") {
    event.preventDefault();
    pageDown();
  } else if ((event.key === " " && event.shiftKey) || event.key === "PageUp") {
    event.preventDefault();
    pageUp();
  }
});

vscode.postMessage({ type: "ready" });
