const vscode = acquireVsCodeApi();

const toolbar = document.getElementById("toolbar");
const errorEl = document.getElementById("error");
const content = document.getElementById("content");

let state = {
  reading: false,
  actionBarsVisible: true,
  bookshelf: [],
  bookName: "",
  chapterTitle: "",
  body: "",
  index: -1,
  chapterOptions: [],
  fontColor: "",
  fontSize: 0,
  configured: false,
  loading: false,
  error: "",
};

/** 章节菜单打开时保留，避免“加载更早/更晚”把列表拆掉 */
let chapterMenuSticky = null;
let menuEl = null;
let menuAnchor = null;
let renderedContentKey = "";

/** 最近一次用户操作（滚轮、按键、点击、触摸）：用来区分用户滚动和程序滚动（恢复位置、跟随其他端） */
let lastInput = 0;
for (const ev of ["wheel", "keydown", "pointerdown", "touchstart"]) {
  window.addEventListener(
    ev,
    () => {
      lastInput = Date.now();
      if (cancelAnim) {
        cancelAnim();
      }
    },
    { capture: true, passive: true }
  );
}

/**
 * 滚动动画（先快后慢，约 0.45 秒）。不用 scrollTo 的 smooth：系统关闭了动画效果
 * （prefers-reduced-motion，如 Windows 的“动画效果”）时会直接跳过去。用户自己滚动时停下
 */
let cancelAnim = null;
function animateScroll(getTop, setTop, maxTop, target, duration = 450) {
  if (cancelAnim) {
    cancelAnim();
  }
  const from = getTop();
  const to = Math.max(0, Math.min(target, maxTop()));
  if (Math.abs(to - from) < 2) {
    return;
  }
  const start = performance.now();
  let timer = 0;
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / duration);
    setTop(from + (to - from) * (1 - Math.pow(1 - t, 3)));
    if (t < 1) {
      timer = setTimeout(step, 16);
    } else {
      cancelAnim = null;
    }
  };
  cancelAnim = () => {
    clearTimeout(timer);
    cancelAnim = null;
  };
  step();
}


window.addEventListener("message", (event) => {
  const msg = event.data;
  // 跟随其他端：同一章内滚动到对应位置
  if (msg && msg.type === "scroll" && typeof msg.ratio === "number") {
    applyRatio(msg.ratio, true);
    return;
  }
  if (!msg || msg.type !== "state") {
    return;
  }
  const { type: _type, scrollTo, restoreScroll, scrollRatio, ...rest } = msg;
  state = { ...state, ...rest };
  // 宿主若漏发 loading，不能把上一次的 true 一直留下
  if (!Object.prototype.hasOwnProperty.call(rest, "loading")) {
    state.loading = false;
  }
  const keepScroll = content.scrollTop;
  render();
  if (typeof scrollRatio === "number") {
    applyRatio(scrollRatio, false);
  } else if (typeof scrollTo === "number") {
    applyScroll(scrollTo);
  } else if (typeof restoreScroll === "number") {
    applyScroll(restoreScroll);
  } else {
    applyScroll(keepScroll);
  }
});

content.addEventListener("scroll", () => {
  const max = content.scrollHeight - content.clientHeight;
  const progress = max > 0 ? content.scrollTop / max : 0;
  // 章内位置与网页版相同：视口顶部在整章内容中的比例
  const ratio = content.scrollHeight > 0 ? content.scrollTop / content.scrollHeight : 0;
  const user = Date.now() - lastInput < 1500;
  vscode.postMessage({ type: "scroll", progress, ratio, user, scrollTop: content.scrollTop, index: state.index });
});

/** 滚动到章内位置（比例 0~1）；smooth：跟随其他端时滑动过去 */
function applyRatio(ratio, smooth) {
  const top = () => Math.max(0, ratio) * content.scrollHeight;
  if (smooth) {
    animateScroll(
      () => content.scrollTop,
      (v) => (content.scrollTop = v),
      () => content.scrollHeight - content.clientHeight,
      top()
    );
    return;
  }
  content.scrollTop = top();
  requestAnimationFrame(() => (content.scrollTop = top()));
}

function applyScroll(top) {
  content.scrollTop = top;
  requestAnimationFrame(() => {
    content.scrollTop = top;
  });
}

document.addEventListener("click", () => {
  chapterMenuSticky = null;
  closeChapterMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    chapterMenuSticky = null;
    closeChapterMenu();
  }
});

function render() {
  if (state.error) {
    errorEl.textContent = state.error;
    errorEl.classList.remove("hidden");
  } else {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }

  const key = contentKey();
  if (key !== renderedContentKey) {
    renderedContentKey = key;
    renderContent();
  }
  renderToolbar();
}

function contentKey() {
  return JSON.stringify({
    configured: state.configured,
    reading: state.reading,
    loading: !!state.loading,
    bookName: state.bookName,
    chapterTitle: state.chapterTitle,
    body: state.body,
    error: state.error,
    panelOpen: !!state.panelOpen,
    fontColor: state.fontColor,
    fontSize: state.fontSize,
    bookshelf: state.bookshelf,
  });
}

function renderToolbar() {
  if (!state.reading || !state.actionBarsVisible) {
    chapterMenuSticky = null;
  }
  if (
    chapterMenuSticky &&
    menuEl &&
    menuEl.isConnected &&
    menuAnchor &&
    menuAnchor.isConnected &&
    state.reading &&
    state.actionBarsVisible
  ) {
    refillChapterMenu(menuEl);
    positionChapterMenu(menuAnchor, menuEl);
    const stick = chapterMenuSticky;
    requestAnimationFrame(() => scrollChapterMenu(menuEl, stick));
    return;
  }

  closeChapterMenu();
  toolbar.innerHTML = "";
  if (!state.actionBarsVisible || !state.reading) {
    toolbar.classList.add("hidden");
    return;
  }
  toolbar.classList.remove("hidden");
  addIconBtn("back", "返回书架", "back");
  addSep();
  addIconBtn("previousChapter", "上一章", "prevChapter");
  addIconBtn("nextChapter", "下一章", "nextChapter");
  addIconBtn("openInEditor", "在编辑器中打开", "openInEditor");
  addSep();
  addChapterSelect();
  addSep();
  addIconBtn("showBookInfo", "当前阅读信息", "showBookInfo");
}

const ICONS = {
  refresh:
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M771.776 794.88A384 384 0 0 1 128 512h64a320 320 0 0 0 555.712 216.448H654.72a32 32 0 1 1 0-64h149.056a32 32 0 0 1 32 32v148.928a32 32 0 1 1-64 0v-50.56zM276.288 295.616h92.992a32 32 0 0 1 0 64H220.16a32 32 0 0 1-32-32V178.56a32 32 0 0 1 64 0v50.56A384 384 0 0 1 896.128 512h-64a320 320 0 0 0-555.776-216.384z"/></svg>',
  back:
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M365.44 112.32v133.76h237.888a340.928 340.928 0 0 1 340.928 335.36v5.632a340.928 340.928 0 0 1-335.296 340.864l-5.632 0.064h-324.48a16 16 0 0 1-16-16v-64a16 16 0 0 1 16-16h324.48a244.928 244.928 0 0 0 5.12-489.856H130.432a16 16 0 0 1-11.136-27.52l218.88-213.76a16 16 0 0 1 27.2 11.456z"/></svg>',
  previousChapter:
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M653.184 116.672a16 16 0 0 1 22.656 0l45.248 45.248a16 16 0 0 1 0 22.656L393.152 512.512l327.936 327.936a16 16 0 0 1 0 22.592l-45.248 45.248a16 16 0 0 1-22.656 0L268.672 523.84a16 16 0 0 1 0-22.656l384.512-384.512z"/></svg>',
  nextChapter:
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M368.576 116.672a16 16 0 0 0-22.656 0l-45.248 45.248a16 16 0 0 0 0 22.656l327.936 327.936-327.936 327.936a16 16 0 0 0 0 22.592l45.248 45.248a16 16 0 0 0 22.656 0l384.512-384.448a16 16 0 0 0 0-22.656L368.576 116.672z"/></svg>',
  openInEditor:
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M160 128h448a32 32 0 0 1 32 32v128h192a32 32 0 0 1 32 32v544a32 32 0 0 1-32 32H416a32 32 0 0 1-32-32V768H160a32 32 0 0 1-32-32V160a32 32 0 0 1 32-32zm64 64v512h192V384a32 32 0 0 1 32-32h160V192H224zm224 224v448h384V448H448zm64 96h256v48H512v-48zm0 128h256v48H512v-48zm0 128h160v48H512v-48z"/></svg>',
  showBookInfo:
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M158.1 149.9h518.3v230.3c0 13.8 11.2 25 25 25s25-11.2 25-25V148.9c0-27.1-21.9-49-49-49H157.1c-27.1 0-49 21.9-49 49v650.3c0 27.1 21.9 49 49 49H408c13.8 0 25-11.2 25-25s-11.2-25-25-25H158.1V149.9z"/><path fill="currentColor" d="M565.1 276.6c0-13.8-11.2-25-25-25H294.4c-13.8 0-25 11.2-25 25s11.2 25 25 25h245.7c13.8 0 25-11.2 25-25zM565.1 422.2c0-13.8-11.2-25-25-25H294.4c-13.8 0-25 11.2-25 25s11.2 25 25 25h245.7c13.8 0 25-11.2 25-25zM294.4 542.7c-13.8 0-25 11.2-25 25s11.2 25 25 25h100.2c13.8 0 25-11.2 25-25s-11.2-25-25-25H294.4zM856.6 544.3c-41.6-41.6-96.8-64.5-155.6-64.5s-114.1 22.9-155.6 64.5c-41.6 41.6-64.5 96.8-64.5 155.6s22.9 114.1 64.5 155.6C587 897.1 642.2 920 701 920s114.1-22.9 155.6-64.5C898.1 814 921 758.8 921 700s-22.9-114.1-64.4-155.7zM703.3 870.1c-95.7 1.3-173.8-76.8-172.5-172.5 1.2-90.2 77.5-166.5 167.7-167.7 95.7-1.3 173.8 76.8 172.5 172.5-1.2 90.1-77.5 166.4-167.7 167.7z"/></svg>',
};

function addIconBtn(iconKey, title, messageType) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "icon-btn";
  b.title = title;
  b.setAttribute("aria-label", title);
  const wrap = document.createElement("span");
  wrap.className = "icon";
  wrap.innerHTML = ICONS[iconKey] || "";
  b.appendChild(wrap);
  b.addEventListener("click", () => vscode.postMessage({ type: messageType }));
  toolbar.appendChild(b);
}

function addSep() {
  const s = document.createElement("span");
  s.className = "sep";
  toolbar.appendChild(s);
}

function addChapterSelect() {
  const wrap = document.createElement("div");
  wrap.className = "chapter-picker";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chapter-select";
  btn.title = "选择章节（默认仅显示附近 10 章）";
  const label = document.createElement("span");
  label.className = "chapter-picker-label";
  const current = (state.chapterOptions || []).find((opt) => opt.type === "chapter" && opt.index === state.index);
  label.textContent = current ? `${current.index + 1}. ${current.title}` : "选择章节";
  const caret = document.createElement("span");
  caret.className = "chapter-caret";
  caret.textContent = "▾";
  btn.append(label, caret);
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menuEl && menuEl.isConnected) {
      chapterMenuSticky = null;
      closeChapterMenu();
      return;
    }
    openChapterMenu(btn, "current");
  });
  wrap.appendChild(btn);
  toolbar.appendChild(wrap);
}

function openChapterMenu(anchor, stick) {
  closeChapterMenu();
  const menu = document.createElement("div");
  menu.className = "chapter-menu";
  menu.setAttribute("role", "listbox");
  menu.addEventListener("click", (event) => event.stopPropagation());
  refillChapterMenu(menu);
  document.body.appendChild(menu);
  menuEl = menu;
  menuAnchor = anchor;
  chapterMenuSticky = stick;
  positionChapterMenu(anchor, menu);
  requestAnimationFrame(() => scrollChapterMenu(menu, stick));
}

function closeChapterMenu() {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
  menuAnchor = null;
}

function refillChapterMenu(menu) {
  menu.textContent = "";
  for (const opt of state.chapterOptions || []) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "chapter-item";
    if (opt.type === "morePrev") {
      item.classList.add("more");
      item.textContent = `▲ 加载更早章节（剩余 ${opt.remaining}）`;
      item.addEventListener("click", () => {
        chapterMenuSticky = "start";
        vscode.postMessage({ type: "morePrev" });
      });
    } else if (opt.type === "moreNext") {
      item.classList.add("more");
      item.textContent = `▼ 加载更晚章节（剩余 ${opt.remaining}）`;
      item.addEventListener("click", () => {
        chapterMenuSticky = "end";
        vscode.postMessage({ type: "moreNext" });
      });
    } else {
      item.textContent = `${opt.index + 1}. ${opt.title}`;
      item.classList.toggle("active", opt.index === state.index);
      item.addEventListener("click", () => {
        chapterMenuSticky = null;
        closeChapterMenu();
        if (opt.index !== state.index) {
          vscode.postMessage({ type: "selectChapter", index: opt.index });
        }
      });
    }
    menu.appendChild(item);
  }
}

function positionChapterMenu(anchor, menu) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, Math.max(rect.width, 220));
  let left = rect.left;
  if (left + width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - width - 8);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.bottom + 2}px`;
  menu.style.width = `${width}px`;
  menu.style.maxHeight = `${Math.max(120, Math.min(280, window.innerHeight - rect.bottom - 12))}px`;
}

function scrollChapterMenu(menu, stick) {
  if (!menu) {
    return;
  }
  if (stick === "end") {
    menu.scrollTop = menu.scrollHeight;
  } else if (stick === "start") {
    menu.scrollTop = 0;
  } else {
    const active = menu.querySelector(".chapter-item.active");
    if (active && typeof active.scrollIntoView === "function") {
      active.scrollIntoView({ block: "center" });
    }
  }
}

function renderContent() {
  content.innerHTML = "";
  if (!state.configured && !state.reading) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "请先在设置中填写阅读 Web 的服务器地址与 API Key（在阅读 Web 的“我的 → API Key”中创建），然后刷新书架。";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "link-btn";
    b.textContent = "打开设置";
    b.addEventListener("click", () => vscode.postMessage({ type: "openSettings" }));
    content.appendChild(p);
    content.appendChild(b);
    return;
  }
  if (state.loading && !state.body) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "加载中…";
    content.appendChild(p);
    return;
  }
  if (!state.reading) {
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>书名</th><th>进度</th><th>书源</th><th>作者</th></tr>";
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    (state.bookshelf || []).forEach((book, i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td></td><td></td><td></td><td></td>`;
      tr.children[0].textContent = book.name;
      tr.children[1].textContent = book.current;
      tr.children[2].textContent = book.source;
      tr.children[3].textContent = book.author;
      tr.addEventListener("click", () => vscode.postMessage({ type: "openBook", index: i }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    content.appendChild(table);
    if (!(state.bookshelf || []).length && !state.error) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "书架为空。";
      content.appendChild(p);
    }
    return;
  }

  const title = document.createElement("h2");
  title.textContent = state.chapterTitle || state.bookName;
  content.appendChild(title);
  // 正文已在编辑器里打开：侧栏只留目录和按钮，不重复显示正文
  if (state.panelOpen) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "正文已在编辑器中打开。";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "link-btn";
    b.textContent = "回到侧栏阅读";
    b.addEventListener("click", () => vscode.postMessage({ type: "closePanel" }));
    content.appendChild(p);
    content.appendChild(b);
    return;
  }
  const pre = document.createElement("pre");
  pre.className = "body";
  if (state.fontColor) {
    pre.style.color = state.fontColor;
  }
  if (state.fontSize > 0) {
    pre.style.fontSize = `${state.fontSize}px`;
  }
  // 加载新章节期间显示“加载中…”，不先显示新章节名配旧章节正文
  pre.textContent = state.loading ? "加载中…" : state.body || "";
  content.appendChild(pre);
}

vscode.postMessage({ type: "ready" });
