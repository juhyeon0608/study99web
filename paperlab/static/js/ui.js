// 화면 공통 도우미: DOM 생성, 모달, 토스트, 마크다운·수식 렌더링

import { refreshAll } from "./state.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 알림 · 상태 아이콘 (여러 화면이 함께 씀 — 한 곳에만 둔다)
export const ICON_WARN = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.5v.01"/></svg>`;
export const ICON_INFO = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5v.01"/></svg>`;
export const ICON_CLOCK = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2"/></svg>`;

// localStorage (사생활 모드 · 꺼진 저장소에서도 멈추지 않게 — 읽기 실패는 null/fallback, 쓰기 실패는 무시).
// set: 글자는 그대로, 그 밖의 값은 JSON, null이면 지움
export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  json(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch { /* 저장 못 함 */ }
  },
};

// 조사: josa("논문", "을/를") → "논문을". 앞 = 받침 있을 때, 뒤 = 없을 때. "으로/로"는 ㄹ 받침도 "로".
// 끝의 따옴표 · 괄호는 건너뛰고 본다. 한글 · 숫자 · 영문 끝 글자로 판단, 모르면 "을(를)"처럼 둘 다
const DIGIT_JONG = [1, 8, 0, 1, 0, 0, 1, 8, 1, 0]; // 영 일 이 삼 사 오 육 칠 팔 구 → 0 없음, 1 있음, 8 ㄹ
export function josa(word, pair) {
  const w = String(word ?? "");
  const [withJ, noJ] = pair.split("/");
  const ch = w.replace(/[\s'"’”)\]}>」』…·.,!?]+$/u, "").slice(-1);
  let jong = null; // 0 없음 · 1 있음 · 8 ㄹ
  if (/[가-힣]/.test(ch)) { const j = (ch.charCodeAt(0) - 0xac00) % 28; jong = j === 0 ? 0 : j === 8 ? 8 : 1; }
  else if (/[0-9]/.test(ch)) jong = DIGIT_JONG[Number(ch)];
  else if (/[a-z]/i.test(ch)) {
    const tail = w.match(/[A-Za-z]+(?=[^A-Za-z]*$)/)[0];
    jong = /^[A-Z]+$/.test(tail) ? (/[LMNR]$/.test(tail) ? (/[LR]$/.test(tail) ? 8 : 1) : 0) // 약어는 글자 이름(엘 · 엠 · 엔 · 알)
      : /(ng|[mnkptbdg])$/i.test(tail) ? 1 : /l$/i.test(tail) ? 8 : 0;
  }
  if (jong == null) return `${w}${withJ}(${noJ})`;
  const useNo = withJ === "으로" ? jong !== 1 : jong === 0;
  return w + (useNo ? noJ : withJ);
}

// 화면 읽기 프로그램 알림 줄(role=status)에 글을 넣는다 — 같은 글을 다시 넣어도 읽게 한 번 비운 뒤
export function liveSay(box, msg) {
  if (!box) return;
  box.textContent = "";
  setTimeout(() => { if (box.isConnected) box.textContent = msg; }, 50);
}

// 탭 줄 접근성: role=tablist/tab, ←→ · Home · End로 옆 탭(누른 것처럼). selectTab이 aria-selected · 초점 순서를 맞춘다
export function markTabs(bar, label = "") {
  const tabs = $$("[data-tab]", bar);
  bar.setAttribute("role", "tablist");
  if (label) bar.setAttribute("aria-label", label);
  for (const b of tabs) b.setAttribute("role", "tab");
  bar.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const n = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    tabs[n].focus();
    tabs[n].click();
  });
}
export function selectTab(bar, value) {
  for (const b of $$("[data-tab]", bar)) {
    const on = b.dataset.tab === value;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  }
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
// action: {label, onClick} — 토스트 안 버튼(6단계 [되돌리기], K-35). 버튼이 있으면 마우스가 위에 있거나
// 버튼에 초점이 있는 동안은 닫지 않는다. 없으면 지금과 같다
export function toast(msg, type = "", { duration, action } = {}) {
  const t = el(action ? `<div class="toast ${type}"><span>${esc(msg)}</span></div>` : `<div class="toast ${type}">${esc(msg)}</div>`);
  $("#toasts").appendChild(t);
  const ms = duration || (action ? 8000 : type === "error" ? 6000 : 3200);
  if (!action) {
    setTimeout(() => t.remove(), ms);
    return t;
  }
  const b = el(`<button type="button" class="toast-action">${esc(action.label)}</button>`);
  if (action.attr) b.setAttribute(action.attr, "");
  b.onclick = () => { t.remove(); action.onClick && action.onClick(); };
  t.appendChild(b);
  let timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => t.matches(":hover") || t.contains(document.activeElement) ? arm() : t.remove(), ms); };
  t.addEventListener("mouseleave", arm);
  b.addEventListener("blur", arm);
  arm();
  return t;
}

export function errorToast(e) {
  // 알림 띠 · 로그인 화면이 이미 알린 오류(api.js의 quiet)는 토스트를 겹쳐 띄우지 않는다
  if (e && e.quiet) return;
  toast(e && e.message ? e.message : String(e), "error");
}

// 저장 · 바꾸기 요청이 실패했을 때: 토스트 + 이미 없어진 항목(404)이면 서재 목록을 다시 받아 화면을 맞춘다
export function saveError(e) {
  errorToast(e);
  if (e && e.status === 404) refreshAll();
}

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), "
  + "textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])";
const focusables = (root) => (root ? $$(FOCUSABLE, root).filter((n) => n.getClientRects().length) : []);

// 창이 열려 있으면 맨 위 창 말고는(#app · 계정 버튼 · 아래 창) inert — 화면 읽기 · Tab이 창 밖으로 나가지 않게.
// 토스트 · 연결 알림 띠는 그대로 둔다
function syncInert() {
  const top = $$("body > .modal-backdrop").pop();
  for (const n of document.body.children) {
    if (n.id !== "toasts" && n.id !== "app-banner") n.inert = !!top && n !== top;
  }
}

let openModals = 0;
let modalSeq = 0;
export function modal({ title, body = "", foot = null, wide = false, onClose = null }) {
  const tid = `modal-title-${++modalSeq}`;
  const back = el(`<div class="modal-backdrop">
    <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="${tid}">
      <div class="modal-head"><h3 id="${tid}">${esc(title)}</h3><button class="icon-btn" data-close title="닫기" aria-label="닫기">✕</button></div>
      <div class="modal-body"></div>
    </div></div>`);
  const box = $(".modal", back);
  const bodyEl = $(".modal-body", back);
  if (typeof body === "string") bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  let footEl = null;
  if (foot) {
    footEl = el(`<div class="modal-foot"></div>`);
    if (typeof foot === "string") footEl.innerHTML = foot; else footEl.appendChild(foot);
    box.appendChild(footEl);
  }
  const opener = document.activeElement; // 닫으면 초점을 여기로 되돌린다
  const close = () => {
    if (!back.isConnected) return;
    back.remove();
    openModals--;
    document.removeEventListener("keydown", onKey);
    syncInert();
    if (opener && opener !== document.body && opener.isConnected) opener.focus();
    onClose && onClose();
  };
  const onKey = (e) => {
    if (back !== $$("body > .modal-backdrop").pop()) return;
    if (e.key === "Escape") return close();
    if (e.key !== "Tab") return;
    // 초점 가두기: 마지막 → 처음, 처음 → 마지막 (창 밖은 inert라 브라우저 주소창으로 빠지지 않게)
    const f = focusables(box);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (i < 0) return; // 창 밖에 뜬 상자(인용 고르기 등)에 초점이 있으면 그대로
    if (e.shiftKey ? i === 0 : i === f.length - 1) {
      e.preventDefault();
      f[e.shiftKey ? f.length - 1 : 0].focus();
    }
  };
  back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
  $("[data-close]", back).onclick = close;
  document.addEventListener("keydown", onKey);
  document.body.appendChild(back);
  openModals++;
  syncInert();
  // 처음 초점: 글 입력 칸 → 본문의 첫 초점 요소 → 아래 단추 → 닫기. 부른 쪽이 이미 옮겼으면(confirmDialog 등) 그대로
  setTimeout(() => {
    if (!back.isConnected || box.contains(document.activeElement)) return;
    const f = $("input:not([type=checkbox]):not([type=radio]), textarea", bodyEl) || focusables(bodyEl)[0] || focusables(footEl)[0]
      || $("[data-close]", back);
    f.focus();
  }, 30);
  return { el: back, body: bodyEl, close };
}

export const modalOpen = () => openModals > 0;

// focus: "cancel"이면 처음 초점을 [취소]에(되돌릴 수 없는 동작 — K-35). 기본은 지금처럼 확인 버튼
export function confirmDialog(message, { ok = "확인", danger = false, title = "확인", focus = "ok" } = {}) {
  return new Promise((resolve) => {
    const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button>
      <button class="btn ${danger ? "primary danger-fill" : "primary"}" data-yes>${esc(ok)}</button></div>`);
    let result = false;
    const m = modal({ title, body: `<p style="margin:4px 0 8px">${esc(message)}</p>`, foot, onClose: () => resolve(result) });
    $("[data-no]", foot).onclick = () => m.close();
    $("[data-yes]", foot).onclick = () => { result = true; m.close(); };
    setTimeout(() => $(focus === "cancel" ? "[data-no]" : "[data-yes]", foot).focus(), 40);
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
// head: 맨 앞에 넣을 요소, className: 메뉴에 더할 클래스, focus: 첫 항목에 포커스(키보드로 열 때), onClose: 닫힐 때
export function popupMenu(anchor, items, { left = false, head = null, className = "", focus = false, onClose = null } = {}) {
  closeMenus();
  const wrap = anchor.closest(".menu-wrap") || anchor.parentElement;
  const menu = el(`<div class="menu ${left ? "left" : ""} ${className}" role="menu"></div>`);
  if (head) menu.append(head, el("<hr>"));
  for (const it of items) {
    if (it === "-") { menu.appendChild(el("<hr>")); continue; }
    const b = el(`<button role="menuitem" class="${it.danger ? "danger" : ""}">${esc(it.label)}${it.sub ? `<span class="sub">${esc(it.sub)}</span>` : ""}</button>`);
    b.onclick = (e) => { e.stopPropagation(); closeMenus(); it.action(); };
    menu.appendChild(b);
  }
  if (getComputedStyle(wrap).position === "static") wrap.style.position = "relative";
  wrap.appendChild(menu);
  const r = menu.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 8) { menu.style.top = "auto"; menu.style.bottom = "calc(100% + 4px)"; }
  if (r.right > window.innerWidth - 8) { menu.style.right = "0"; menu.style.left = "auto"; }
  if (r.left < 8) { menu.style.left = "0"; menu.style.right = "auto"; }
  // Esc = 메뉴만 닫고 연 버튼으로 포커스 (창 · 읽기 화면의 Esc보다 먼저 받는다).
  // ↑↓ · Home · End = 항목 사이 이동 (연 버튼에 초점이 있어도 첫 · 끝 항목으로 들어감)
  const onKey = (e) => {
    if (!menu.isConnected) return;
    const btns = $$("button", menu);
    const i = btns.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) && btns.length && (i >= 0 || document.activeElement === anchor)) {
      e.preventDefault();
      e.stopPropagation();
      const n = e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1
        : i < 0 ? (e.key === "ArrowDown" ? 0 : btns.length - 1) : (i + (e.key === "ArrowDown" ? 1 : btns.length - 1)) % btns.length;
      btns[n].focus();
      return;
    }
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    closeMenus();
    anchor.focus();
  };
  window.addEventListener("keydown", onKey, true);
  menu._onClose = () => { window.removeEventListener("keydown", onKey, true); onClose && onClose(); };
  if (focus) { const first = $("button", menu); first && first.focus(); }
  setTimeout(() => document.addEventListener("click", closeMenus, { once: true }), 0);
  return menu;
}

export function closeMenus() {
  $$(".menu").forEach((m) => { m.remove(); if (m._onClose) m._onClose(); });
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

// 저장 공간 크기: 1GiB 미만은 MB 정수, 이상은 GB 소수 한 자리 (10GB처럼 .0은 뺀다)
export function fmtBytes(n) {
  const b = Math.max(0, Number(n) || 0);
  if (b < 1024 ** 3) return `${Math.round(b / 1024 ** 2)}MB`;
  return `${(b / 1024 ** 3).toFixed(1).replace(/\.0$/, "")}GB`;
}

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "short", day: "numeric" });
}

// 수식($..$, $$..$$, \(..\), \[..\])을 먼저 KaTeX로 바꿔 두고 마크다운을 렌더링한다
// AI 답 · 마크다운을 그릴 때: 바깥 주소를 부르는 그림 · 미디어 · style(배경 그림)과 폼(가짜 입력 · 보내기)을 막는다
// (3단계 품질팀 M1 · N4 — 읽음 추적 · 주소 유출 · 피싱 방지)
// 4단계 품질팀 H-1 · L-2: class · id 금지(AI 글이 앱 클래스 · id로 가짜 창 · 단추를 흉내 내지 못하게 — 수식 · 인용 단추는 정화 뒤에
// 끼워 넣으므로 영향 없음, 코드 블록의 language-* class는 쓰는 곳 없음), HTML 프로필만 + svg · math 금지(그림은 renderSvg로만)
export const MD_PURIFY = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["img", "image", "picture", "source", "video", "audio", "form", "input", "button", "textarea", "select", "style",
    "svg", "math", "dialog"],
  FORBID_ATTR: ["style", "srcset", "background", "class", "id", "popover", "popovertarget", "popovertargetaction"],
};

// MD_PURIFY로 정화할 때만 링크를 새 탭(noopener noreferrer)으로 — DOMPurify 훅은 전역이라 표시(mdLinks)를 켠 동안만 손댄다
let mdLinks = false;
let mdHook = false;
export function purifyMd(html) {
  const P = window.DOMPurify;
  if (!P) return null;
  if (!mdHook) {
    mdHook = true;
    P.addHook("afterSanitizeAttributes", (node) => {
      if (mdLinks && node.tagName === "A" && node.hasAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }
  mdLinks = true;
  try { return P.sanitize(html, MD_PURIFY); } finally { mdLinks = false; }
}

// 인용 문구 · 참고문헌 HTML(citeproc 출력): 서식 태그만. DOMPurify가 없으면 태그를 글자로(fail-closed)
export const CITE_PURIFY = { ALLOWED_TAGS: ["i", "b", "em", "strong", "sup", "sub", "span", "a"], ALLOWED_ATTR: ["href", "style"] };
export const cleanCiteHtml = (html) => (window.DOMPurify ? window.DOMPurify.sanitize(String(html ?? ""), CITE_PURIFY) : esc(html));

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
  html = purifyMd(html) ?? esc(src);
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

// 프로필: 사진이 있으면 <img>(구글 사진은 referrer가 있으면 막힐 수 있음, 실패하면 이니셜), 없으면 이니셜
export function avatarEl({ name = "", photo = "" } = {}, lg = false) {
  const first = [...String(name).trim()][0] || "?";
  const initial = /[a-z]/i.test(first) ? first.toUpperCase() : first;
  const span = el(`<span class="avatar ${lg ? "lg" : ""}" aria-hidden="true">${esc(initial)}</span>`);
  const src = safeUrl(photo);
  if (!src) return span;
  const img = el(`<img class="avatar ${lg ? "lg" : ""}" alt="" referrerpolicy="no-referrer">`);
  img.onerror = () => img.replaceWith(span);
  img.src = src;
  return img;
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

// ------------------------------------------------------------- 4단계 AI 개념 그림 (docs/specs/phase4-explain-translate.md 7.3절)
// AI가 만든 SVG는 믿지 않는다: DOMPurify SVG 프로필(필터 프로필은 켜지 않음)로 정화 → 크기 · url() · 색 처리 → 직렬화해서
// <img src="blob:">로만 그린다. 이미지로 그린 SVG는 스크립트를 실행하지 않고 바깥 자원을 부르지 않으며, 안의 스타일 · id · class가
// 앱 화면에 닿지 않는다. SVG 문자열을 innerHTML로 앱 DOM에 넣지 않는다 (MD_PURIFY로도 그리지 않음).
export const SVG_PURIFY = {
  USE_PROFILES: { svg: true },
  FORBID_TAGS: ["style", "image", "a", "use", "foreignObject", "script", "feImage", "animate", "set", "animateMotion",
    "animateTransform", "textPath", "mpath"],
  FORBID_ATTR: ["style", "href", "xlink:href", "class"],
};
export const SVG_MAX_ELEMENTS = 1500;
export const SVG_MAX_SIDE = 4000;
const SVG_NS = "http://www.w3.org/2000/svg";

// 순수 함수 (Node 테스트 — AC-G03)
export const svgColor = (value, { text, accent }) => String(value)
  .replace(/currentColor/gi, text).replace(/var\(\s*--[\w-]+\s*(?:,[^()]*)?\)/g, accent);
// CSS 이스케이프(\72 · \r)를 푼 글 (품질팀 L-1 — u\72l(…) 우회)
export const cssUnescape = (v) => String(v)
  .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, h) => { const c = parseInt(h, 16); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : "�"; })
  .replace(/\\(.)/g, "$1");
// url(#이름)만 남김 — 이스케이프를 푼 뒤 다른 url(…)이 하나라도 있으면 그 속성은 지운다
export const svgUrlOk = (value) => cssUnescape(value).replace(/url\(#[A-Za-z_][\w.-]*\)/g, "").search(/url\s*\(/i) < 0;
export function svgViewBoxOk(vb) {
  const n = String(vb || "").trim().split(/[\s,]+/).map(Number);
  return n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 && n[2] <= SVG_MAX_SIDE && n[3] <= SVG_MAX_SIDE;
}
export const svgCountOk = (count) => count <= SVG_MAX_ELEMENTS;

// 지금 테마의 글자색 · 강조 글자색 (그림을 그릴 때의 계산값 — 테마를 바꾸면 다시 그림)
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  return { text: cs.getPropertyValue("--text").trim() || "#1b1f27", accent: cs.getPropertyValue("--accent-text").trim() || "#1e40af" };
}

// AI SVG → <img> 요소 (blob URL은 불러오거나 실패하면 바로 revoke). 그릴 수 없으면 null
export function renderSvg(svgText, { text = "", colors = null } = {}) {
  if (!svgText || !window.DOMPurify) return null;
  const frag = window.DOMPurify.sanitize(String(svgText), { ...SVG_PURIFY, RETURN_DOM_FRAGMENT: true });
  const root = frag.firstElementChild;
  if (frag.children.length !== 1 || !root || root.namespaceURI !== SVG_NS || root.localName !== "svg") return null;
  const all = [root, ...root.querySelectorAll("*")];
  if (!svgCountOk(all.length) || !svgViewBoxOk(root.getAttribute("viewBox"))) return null;
  const c = colors || themeColors();
  for (const node of all) {
    for (const a of [...node.attributes]) {
      if (!svgUrlOk(a.value)) { node.removeAttribute(a.name); continue; }
      const v = svgColor(a.value, c);
      if (v !== a.value) node.setAttribute(a.name, v);
    }
  }
  root.removeAttribute("width");
  root.removeAttribute("height");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" }));
  const img = document.createElement("img");
  img.alt = text;
  img.decoding = "async";
  const revoke = () => URL.revokeObjectURL(url);
  img.addEventListener("load", revoke, { once: true });
  img.addEventListener("error", revoke, { once: true });
  img.src = url;
  return img;
}
