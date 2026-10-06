// 화면 공통 도우미: DOM 생성, 모달, 토스트, 마크다운·수식 렌더링

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.flush = (...args) => { clearTimeout(t); return fn(...args); };
  return wrapped;
}

// duration(ms)을 주지 않으면 보통 3.2초 · 오류 6초. 긴 안내는 8초로 띄운다
export function toast(msg, type = "", { duration } = {}) {
  const t = el(`<div class="toast ${type}">${esc(msg)}</div>`);
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), duration || (type === "error" ? 6000 : 3200));
}

export function errorToast(e) {
  toast(e && e.message ? e.message : String(e), "error");
}

let openModals = 0;
export function modal({ title, body = "", foot = null, wide = false, onClose = null }) {
  const back = el(`<div class="modal-backdrop">
    <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close title="닫기">✕</button></div>
      <div class="modal-body"></div>
    </div></div>`);
  const box = $(".modal", back);
  const bodyEl = $(".modal-body", back);
  if (typeof body === "string") bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  if (foot) {
    const f = el(`<div class="modal-foot"></div>`);
    if (typeof foot === "string") f.innerHTML = foot; else f.appendChild(foot);
    box.appendChild(f);
  }
  const close = () => {
    if (!back.isConnected) return;
    back.remove();
    openModals--;
    document.removeEventListener("keydown", onKey);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === "Escape" && back === [...document.querySelectorAll(".modal-backdrop")].pop()) close(); };
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  $("[data-close]", back).onclick = close;
  document.addEventListener("keydown", onKey);
  document.body.appendChild(back);
  openModals++;
  setTimeout(() => { const f = $("input:not([type=checkbox]):not([type=radio]), textarea", bodyEl); f && f.focus(); }, 30);
  return { el: back, body: bodyEl, close };
}

export const modalOpen = () => openModals > 0;

export function confirmDialog(message, { ok = "확인", danger = false } = {}) {
  return new Promise((resolve) => {
    const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button>
      <button class="btn ${danger ? "primary danger-fill" : "primary"}" data-yes>${esc(ok)}</button></div>`);
    let result = false;
    const m = modal({ title: "확인", body: `<p style="margin:4px 0 8px">${esc(message)}</p>`, foot, onClose: () => resolve(result) });
    $("[data-no]", foot).onclick = () => m.close();
    $("[data-yes]", foot).onclick = () => { result = true; m.close(); };
    setTimeout(() => $("[data-yes]", foot).focus(), 40);
  });
}

export function promptDialog(title, { value = "", placeholder = "", ok = "확인" } = {}) {
  return new Promise((resolve) => {
    const body = el(`<form><input class="input" style="width:100%" placeholder="${esc(placeholder)}" value="${esc(value)}"></form>`);
    const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button><button class="btn primary" data-yes>${esc(ok)}</button></div>`);
    let result = null;
    const m = modal({ title, body, foot, onClose: () => resolve(result) });
    const input = $("input", body);
    const submit = () => { result = input.value.trim() || null; m.close(); };
    body.onsubmit = (e) => { e.preventDefault(); submit(); };
    $("[data-yes]", foot).onclick = submit;
    $("[data-no]", foot).onclick = () => m.close();
    setTimeout(() => input.select(), 40);
  });
}

// 메뉴: 버튼 아래에 항목들을 띄운다. items: [{label, sub, action, danger} | "-"]
export function popupMenu(anchor, items, { left = false } = {}) {
  closeMenus();
  const wrap = anchor.closest(".menu-wrap") || anchor.parentElement;
  const menu = el(`<div class="menu ${left ? "left" : ""}"></div>`);
  for (const it of items) {
    if (it === "-") { menu.appendChild(el("<hr>")); continue; }
    const b = el(`<button class="${it.danger ? "danger" : ""}">${esc(it.label)}${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ""}</button>`);
    b.onclick = (e) => { e.stopPropagation(); closeMenus(); it.action(); };
    menu.appendChild(b);
  }
  if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
  wrap.appendChild(menu);
  const r = menu.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 8) { menu.style.top = "auto"; menu.style.bottom = "calc(100% + 4px)"; }
  if (r.right > window.innerWidth - 8) { menu.style.right = "0"; menu.style.left = "auto"; }
  if (r.left < 8) { menu.style.left = "0"; menu.style.right = "auto"; }
  setTimeout(() => document.addEventListener("click", closeMenus, { once: true }), 0);
  return menu;
}

export function closeMenus() {
  $$(".menu").forEach((m) => m.remove());
}

// ------------------------------------------------------------- text format
export function authorName(a) {
  if (!a) return "";
  if (a.literal) return a.literal;
  if (/[぀-ヿ㐀-鿿가-힣]/.test((a.family || "") + (a.given || ""))) return (a.family || "") + (a.given || "");
  return [a.given, a.family].filter(Boolean).join(" ");
}

export function authorsShort(authors, max = 3) {
  const list = (authors || []).map(authorName).filter(Boolean);
  if (!list.length) return "저자 미상";
  if (list.length <= max) return list.join(", ");
  return list.slice(0, max).join(", ") + ` 외 ${list.length - max}명`;
}

export function fmtNum(n) {
  return n == null ? "" : Number(n).toLocaleString("ko-KR");
}

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

// 수식($..$, $$..$$, \(..\), \[..\])을 먼저 KaTeX로 바꿔 두고 마크다운을 렌더링한다
export function renderMarkdown(text, { citations = false } = {}) {
  if (!text) return "";
  const store = [];
  const keep = (html) => { store.push(html); return `@@MATH${store.length - 1}@@`; };
  const tex = (src, display) => {
    try {
      return window.katex.renderToString(src, { displayMode: display, throwOnError: false, strict: "ignore" });
    } catch {
      return esc(src);
    }
  };
  let src = String(text)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => keep(tex(m.trim(), true)))
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => keep(tex(m.trim(), true)))
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => keep(tex(m.trim(), false)))
    .replace(/(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, pre, m) => pre + keep(tex(m, false)));
  let html = window.marked ? window.marked.parse(src, { breaks: true, gfm: true }) : `<p>${esc(src)}</p>`;
  html = window.DOMPurify ? window.DOMPurify.sanitize(html) : esc(src);
  // 수식·인용 번호는 정화한 뒤 텍스트 노드에서만 바꾼다 (속성 안의 같은 글자는 건드리지 않는다)
  const t = document.createElement("template");
  t.innerHTML = html;
  const walker = document.createTreeWalker(t.content, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const pattern = citations ? /@@MATH(\d+)@@|\[(\d{1,3})\]/g : /@@MATH(\d+)@@/g;
  for (const node of nodes) {
    const text = node.nodeValue;
    if (!pattern.test(text)) continue;
    pattern.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(pattern)) {
      frag.append(text.slice(last, m.index));
      if (m[1] !== undefined) {
        const span = document.createElement("span");
        span.innerHTML = store[Number(m[1])];
        frag.append(...span.childNodes);
      } else {
        const b = document.createElement("button");
        b.className = "cite-ref";
        b.dataset.cite = m[2];
        b.textContent = m[2];
        frag.append(b);
      }
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  const div = document.createElement("div");
  div.appendChild(t.content);
  return div.innerHTML;
}

// http(s) 주소만 링크로 쓴다 (javascript: 같은 주소 차단)
export function safeUrl(url) {
  return /^https?:\/\//i.test(String(url || "").trim()) ? String(url).trim() : "";
}

export function renderTex(latex, display = true) {
  try {
    return window.katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: "ignore" });
  } catch {
    return `<code>${esc(latex)}</code>`;
  }
}

export async function copyText(text, html = null) {
  try {
    if (html && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
  } catch {
    const ta = el(`<textarea style="position:fixed;opacity:0"></textarea>`);
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("복사했어요");
}

export function pickFiles({ accept = "", multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = el(`<input type="file" ${multiple ? "multiple" : ""} accept="${esc(accept)}" style="display:none">`);
    input.onchange = () => { resolve([...input.files]); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}
