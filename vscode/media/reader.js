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

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "state") {
    return;
  }
  const { type: _type, ...rest } = msg;
  state = { ...state, ...rest };
  // 宿主若漏发 loading，不能把上一次的 true 一直留下
  if (!Object.prototype.hasOwnProperty.call(rest, "loading")) {
    state.loading = false;
  }
  render();
  if (typeof msg.scrollTo === "number") {
    content.scrollTop = 0;
  }
});

content.addEventListener("scroll", () => {
  const max = content.scrollHeight - content.clientHeight;
  const progress = max > 0 ? content.scrollTop / max : 0;
  vscode.postMessage({ type: "scroll", progress });
});

function render() {
  if (state.error) {
    errorEl.textContent = state.error;
    errorEl.classList.remove("hidden");
  } else {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }

  renderToolbar();
  renderContent();
}

function renderToolbar() {
  toolbar.innerHTML = "";
  if (!state.actionBarsVisible) {
    toolbar.classList.add("hidden");
    return;
  }
  toolbar.classList.remove("hidden");

  if (!state.reading) {
    addIconBtn("refresh", "刷新书架", "refreshBookshelf");
    addSep();
    addIconBtn("settings", "设置", "openSettings");
    return;
  }
  addIconBtn("back", "返回书架", "back");
  addSep();
  addIconBtn("previousChapter", "上一章", "prevChapter");
  addIconBtn("nextChapter", "下一章", "nextChapter");
  addSep();
  addChapterSelect();
  addSep();
  addIconBtn("showBookInfo", "当前阅读信息", "showBookInfo");
  addIconBtn("refresh", "刷新文章", "refreshBody");
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
  showBookInfo:
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M158.1 149.9h518.3v230.3c0 13.8 11.2 25 25 25s25-11.2 25-25V148.9c0-27.1-21.9-49-49-49H157.1c-27.1 0-49 21.9-49 49v650.3c0 27.1 21.9 49 49 49H408c13.8 0 25-11.2 25-25s-11.2-25-25-25H158.1V149.9z"/><path fill="currentColor" d="M565.1 276.6c0-13.8-11.2-25-25-25H294.4c-13.8 0-25 11.2-25 25s11.2 25 25 25h245.7c13.8 0 25-11.2 25-25zM565.1 422.2c0-13.8-11.2-25-25-25H294.4c-13.8 0-25 11.2-25 25s11.2 25 25 25h245.7c13.8 0 25-11.2 25-25zM294.4 542.7c-13.8 0-25 11.2-25 25s11.2 25 25 25h100.2c13.8 0 25-11.2 25-25s-11.2-25-25-25H294.4zM856.6 544.3c-41.6-41.6-96.8-64.5-155.6-64.5s-114.1 22.9-155.6 64.5c-41.6 41.6-64.5 96.8-64.5 155.6s22.9 114.1 64.5 155.6C587 897.1 642.2 920 701 920s114.1-22.9 155.6-64.5C898.1 814 921 758.8 921 700s-22.9-114.1-64.4-155.7zM703.3 870.1c-95.7 1.3-173.8-76.8-172.5-172.5 1.2-90.2 77.5-166.5 167.7-167.7 95.7-1.3 173.8 76.8 172.5 172.5-1.2 90.1-77.5 166.4-167.7 167.7z"/></svg>',
  settings:
    '<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M512 362.7a149.3 149.3 0 1 1 0 298.6 149.3 149.3 0 0 1 0-298.6zm0 64a85.3 85.3 0 1 0 0 170.6 85.3 85.3 0 0 0 0-170.6z"/><path fill="currentColor" d="M512 154.7l21.3 135.5a256 256 0 0 1 88.6 36.8l115.2-79.1 90.5 90.5-79.1 115.2a256 256 0 0 1 36.8 88.6L920.5 490.7v42.6L785 554.7a256 256 0 0 1-36.8 88.6l79.1 115.2-90.5 90.5-115.2-79.1a256 256 0 0 1-88.6 36.8L533.3 869.3h-42.6L469.3 733.9a256 256 0 0 1-88.6-36.8l-115.2 79.1-90.5-90.5 79.1-115.2a256 256 0 0 1-36.8-88.6L103.5 533.3v-42.6L239 469.3a256 256 0 0 1 36.8-88.6l-79.1-115.2 90.5-90.5 115.2 79.1a256 256 0 0 1 88.6-36.8L490.7 154.7h21.3z"/></svg>',
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
  const select = document.createElement("select");
  select.className = "chapter-select";
  select.title = "选择章节（默认仅显示附近 10 章）";
  for (const opt of state.chapterOptions || []) {
    const o = document.createElement("option");
    if (opt.type === "morePrev") {
      o.value = "morePrev";
      o.textContent = `▲ 加载更早章节（剩余 ${opt.remaining}）`;
    } else if (opt.type === "moreNext") {
      o.value = "moreNext";
      o.textContent = `▼ 加载更晚章节（剩余 ${opt.remaining}）`;
    } else {
      o.value = String(opt.index);
      o.textContent = `${opt.index + 1}. ${opt.title}`;
      if (opt.index === state.index) {
        o.selected = true;
      }
    }
    select.appendChild(o);
  }
  select.addEventListener("change", () => {
    const v = select.value;
    if (v === "morePrev") {
      vscode.postMessage({ type: "morePrev" });
    } else if (v === "moreNext") {
      vscode.postMessage({ type: "moreNext" });
    } else {
      vscode.postMessage({ type: "selectChapter", index: Number(v) });
    }
  });
  toolbar.appendChild(select);
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
  const pre = document.createElement("pre");
  pre.className = "body";
  if (state.fontColor) {
    pre.style.color = state.fontColor;
  }
  if (state.fontSize > 0) {
    pre.style.fontSize = `${state.fontSize}px`;
  }
  pre.textContent = state.body || (state.loading ? "加载中…" : "");
  content.appendChild(pre);
}

vscode.postMessage({ type: "ready" });
