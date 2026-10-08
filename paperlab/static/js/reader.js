// 읽기 화면: PDF 뷰어(PDF.js) + 하이라이트/메모 + AI 요약·질문 + 노트 + 인용
// 임베드 모드(mountPdf — 논문 쓰기 화면의 참고 패널, docs/specs/writing-reference-pane.md 4.2절): 같은 전역 R을 쓴다.
// 읽기 화면과 쓰기 화면은 동시에 열리지 않으므로(라우터가 closeReader) 한 번에 하나뿐. R.embed = 패널이 준 옵션.

import { api, streamEvents } from "./api.js";
import { listStyles, render, styleOptions } from "./cite.js";
import { EXT_MARK, bindExtLink, citeDialog, editPaperDialog, issuesBox, settingsDialog, uploadPdfs } from "./dialogs.js";
import { INHA, paperProxyTarget } from "./extlinks.js";
import {
  ICON_WARN, cancelJob, errorLabel, retryJob, setStatusLine, statusLineEl, summaryCard,
  updateSummaryCard, watchJob,
} from "./jobs.js";
import { exportAnnotations } from "./library.js";
import { quoteRuleText } from "./refquote.js";
import { onRefresh, state } from "./state.js";
import {
  $, $$, authorsShort, confirmDialog, copyText, debounce, el, errorToast, esc, fmtDate, modalOpen, pickFiles, renderMarkdown,
  renderTex, toast,
} from "./ui.js";

const COLORS = ["yellow", "green", "blue", "pink", "purple"];
const COLOR_NAMES = { yellow: "노랑", green: "초록", blue: "파랑", pink: "분홍", purple: "보라" };
const LEVELS = [["elementary", "초등"], ["middle", "중등"], ["high", "고등"], ["graduate", "대학원"]];

let pdfjs = null;
let R = null; // 현재 열린 논문의 읽기 상태
let openSeq = 0; // 열기 도중 다른 화면으로 가면 늦게 끝난 열기를 버린다

// 요약은 서버 작업(2단계 15장 — 탭을 닫아도 계속, U8). 화면은 진행 중인 요약 작업만 따라간다: 논문 id → stop()
const watches = new Map();
const ACTIVE = (j) => j && (j.status === "queued" || j.status === "running");

// 로그아웃할 때: 화면의 따라가기만 멈춘다 (서버 작업은 계속)
export function stopSummaries() {
  for (const stop of watches.values()) stop();
  watches.clear();
}

// 쓰던 노트를 지금 저장한다 (로그아웃 전)
export async function flushReader() {
  if (R && R.noteSave) await R.noteSave.flush();
}

async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("/static/vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/static/vendor/pdfjs/pdf.worker.min.mjs";
  }
  return pdfjs;
}

function prefs() {
  try { return JSON.parse(localStorage.getItem("paperlab.reader") || "{}"); } catch { return {}; }
}
export function savePrefs(patch) {
  try { localStorage.setItem("paperlab.reader", JSON.stringify({ ...prefs(), ...patch })); } catch { /* 무시 */ }
}

function teardown() {
  openSeq++;
  if (!R) return;
  R.observer && R.observer.disconnect();
  R.resizeObserver && R.resizeObserver.disconnect();
  R.abort && R.abort.abort(); // 질문 스트림만 (요약 스트림은 runs가 따로 가진다)
  R.noteSave && R.noteSave.flush();
  R.doc && R.doc.destroy();
  document.removeEventListener("keydown", R.onKey);
  document.removeEventListener("selectionchange", R.onSelChange);
  hidePopups();
  R = null;
}

export function closeReader() {
  teardown();
}

export async function openReader(main, pid, startPage = null) {
  teardown();
  const seq = openSeq;
  state.lastReadId = pid; // AI 질문 화면의 "한 논문만: 읽기 화면 대화 →" (시안 AD-1)
  // AI 질문 출처에서 왔으면(시안 4장) 쪽 이동 대신 그 위치 표시 — 하이라이트를 다 그린 뒤
  const spot = state.askSpot && state.askSpot.paper_id === pid ? state.askSpot : null;
  state.askSpot = null;
  if (spot) startPage = null;
  main.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  let paper;
  try {
    [paper] = await Promise.all([api.get(`/api/papers/${pid}`), api.post(`/api/papers/${pid}/open`)]);
  } catch (e) {
    if (seq === openSeq) main.innerHTML = `<div class="empty"><h3>논문을 열 수 없어요</h3><p>${esc(e.message)}</p><a class="btn" href="#/library">서재로</a></div>`;
    return;
  }
  if (seq !== openSeq) return;
  const p0 = prefs();
  R = {
    pid, paper, annotations: [], pages: [], scale: 1, fit: p0.fit !== false, color: p0.color || "yellow",
    tab: p0.tab || "summary", level: p0.level || "high", chat: null, summary: null, quote: "",
  };
  const me = R;
  main.innerHTML = "";
  const view = el(`<section class="reader ${p0.panelClosed ? "panel-closed" : ""}">
    <div class="reader-main">
      <div class="reader-bar">
        <a class="btn ghost sm" href="#/library" title="서재로 (Esc)">← 서재</a>
        <div class="title" title="${esc(paper.title)}">${esc(paper.title)}</div>
        <div class="pageno"><input class="input" data-page value="1"> / <span data-total>…</span></div>
        <button class="icon-btn" data-zoom="-1" title="축소">−</button>
        <button class="btn sm ghost" data-fit title="폭 맞춤">맞춤</button>
        <button class="icon-btn" data-zoom="1" title="확대">＋</button>
        ${colorsHtml()}
        <button class="icon-btn" data-panel title="오른쪽 패널 열고 닫기">◧</button>
      </div>
      <div class="pdf-scroll"><div class="pdf-pages"></div></div>
    </div>
    <aside class="panel">
      <div class="tabs">
        <button data-tab="summary">AI 요약</button><button data-tab="chat">질문하기</button>
        <button data-tab="highlights">하이라이트</button><button data-tab="note">노트</button><button data-tab="cite">정보·인용</button>
      </div>
      <div class="panel-body"></div>
    </aside></section>`);
  main.appendChild(view);
  R.view = view;
  R.scroller = $(".pdf-scroll", view);
  R.pagesEl = $(".pdf-pages", view);

  $$("[data-tab]", view).forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  wireBar(view);
  $("[data-panel]", view).onclick = () => {
    const closed = view.classList.toggle("panel-closed");
    savePrefs({ panelClosed: closed });
    if (R.fit) setTimeout(() => setScale(fitScale(), true), 50);
  };
  R.onKey = (e) => {
    if (document.querySelector(".modal-backdrop")) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (e.key === "Escape") {
      if (document.querySelector(".sel-pop")) return hidePopups();
      location.hash = "#/library";
    }
  };
  document.addEventListener("keydown", R.onKey);

  showTab(R.tab);
  const [annotations] = await Promise.all([api.get(`/api/papers/${pid}/annotations`), loadPdf(startPage)]);
  if (R !== me) return;
  R.annotations = annotations;
  drawAllHighlights();
  if (R.tab === "highlights") showTab("highlights");
  if (spot) goToSpot(spot.page, spot.rect, spot.text);
}

// 하이라이트 색 버튼 (읽기 화면 막대 · 참고 패널 막대 공용 — 색 이름 · 고른 색을 화면 읽기에도)
function colorsHtml() {
  return `<div class="hl-colors" role="group" aria-label="하이라이트 색" title="하이라이트 색">${COLORS.map((c) =>
    `<button class="hl-color ${c === R.color ? "active" : ""}" data-c="${c}" aria-label="${COLOR_NAMES[c]}" aria-pressed="${c === R.color}"></button>`).join("")}</div>`;
}

function syncColors() {
  $$(".reader-bar .hl-color", R.view).forEach((x) => {
    x.classList.toggle("active", x.dataset.c === R.color);
    x.setAttribute("aria-pressed", String(x.dataset.c === R.color));
  });
}

// 막대: 색 · 확대/축소 · 맞춤 · 쪽 번호 (data 속성으로 찾음 — 읽기 화면 · 참고 패널 공용)
function wireBar(view) {
  $$(".reader-bar .hl-color", view).forEach((b) => (b.onclick = () => {
    R.color = b.dataset.c;
    savePrefs({ color: R.color });
    syncColors();
  }));
  $$("[data-zoom]", view).forEach((b) => (b.onclick = () => setScale(R.scale * (b.dataset.zoom === "1" ? 1.15 : 1 / 1.15), false)));
  $("[data-fit]", view).onclick = () => setScale(fitScale(), true);
  const pageInput = $("[data-page]", view);
  pageInput.onkeydown = (e) => { if (e.key === "Enter") { goToPage(Number(pageInput.value)); pageInput.blur(); } };
}

// ------------------------------------------------------------------- 임베드 모드 (참고 패널)
// host에 작은 막대 + PDF 칸을 그리고 R을 만든 뒤 하이라이트를 받는다. PDF 파일은 embedPdf()를 처음 부를 때 받음.
// 읽기 화면과 다른 점: /open을 부르지 않음(읽기 상태 그대로 — K-10), Esc로 서재에 가지 않음, [AI에게 묻기] 대신
// [인용으로 넣기](opts.onQuote), 처음 배율은 맞춤.
// opts = { onQuote({text, pages}), onGoto(page), onChange(), onAttached(paper), basis: {text, title} }
export async function mountPdf(host, paper, opts = {}) {
  teardown();
  const p0 = prefs();
  R = { pid: paper.id, paper, annotations: [], pages: [], scale: 1, fit: true, color: p0.color || "yellow",
    level: p0.level || "high", embed: opts, quote: "" };
  const me = R;
  host.innerHTML = `<div class="reader-bar">
      <div class="pageno"><input class="input" data-page value="1" aria-label="쪽 번호"> / <span data-total>…</span></div>
      <button class="icon-btn" data-zoom="-1" title="축소" aria-label="축소">−</button>
      <button class="btn sm ghost" data-fit title="폭 맞춤">맞춤</button>
      <button class="icon-btn" data-zoom="1" title="확대" aria-label="확대">＋</button>
      ${colorsHtml()}
      ${opts.basis ? `<span class="ref-basis" title="${esc(opts.basis.title)}">${esc(opts.basis.text)}</span>` : ""}
    </div>
    <div class="pdf-scroll" tabindex="0" aria-label="PDF 원문"><div class="pdf-pages"></div></div>`;
  R.view = host;
  R.scroller = $(".pdf-scroll", host);
  R.pagesEl = $(".pdf-pages", host);
  wireBar(host);
  R.onKey = (e) => { // 떠 있는 선택 상자 · 하이라이트 상자만 닫음(패널의 Esc는 refpane.js가)
    if (e.key === "Escape" && !modalOpen() && document.querySelector(".sel-pop")) hidePopups();
  };
  document.addEventListener("keydown", R.onKey);
  try {
    const annotations = await api.get(`/api/papers/${paper.id}/annotations`);
    if (R !== me) return false;
    R.annotations = annotations;
    drawAllHighlights();
  } catch (e) {
    if (R === me) errorToast(e);
  }
  return R === me;
}

// 임베드 모드: PDF를 아직 안 받았으면 받고, page가 있으면 그 쪽으로
export function embedPdf(page = null) {
  if (!R || !R.embed) return;
  if (!R.pdfLoad) R.pdfLoad = loadPdf(page);
  else if (page) R.pdfLoad.then(() => goToPage(page));
}

// 하이라이트를 만들거나 고치거나 지운 뒤: 읽기 화면은 하이라이트 탭을, 참고 패널은 자기 목록을 다시 그림
function annsChanged() {
  if (R.embed) { if (R.embed.onChange) R.embed.onChange(); }
  else if (R.tab === "highlights") showTab("highlights");
}

// 쪽 이동(p.N): 참고 패널은 PDF 탭으로 바꾼 뒤(onGoto)
function gotoPage(n) {
  if (R.embed && R.embed.onGoto) R.embed.onGoto(n);
  else goToPage(n);
}

// ------------------------------------------------------------------- PDF
// PDF 없는 논문: [인하대에서 보기](대상 있을 때) · [PDF 첨부] (docs/design/inha-proxy-ui.md 6장)
function drawPdfMissing() {
  const target = paperProxyTarget(R.paper);
  R.pagesEl.innerHTML = `<div class="empty pdf-missing">
    <h3>PDF가 없어요</h3>
    <p>${target ? "인하대에서 논문을 열어 PDF를 받은 뒤 [PDF 첨부]로 올려 주세요."
      : "PDF 파일이 있으면 [PDF 첨부]로 올려 주세요. 무료 PDF는 서재 상세 패널의 [PDF 받기]로 찾을 수 있어요."}</p>
    <div class="empty-actions">
      ${target ? `<a class="btn primary" href="${esc(target)}" target="_blank" rel="noopener noreferrer" data-inha-open>${esc(INHA.buttons.view)}${EXT_MARK}</a>` : ""}
      <button type="button" class="btn${target ? "" : " primary"}" data-attach>PDF 첨부</button>
    </div></div>`;
  const link = $("[data-inha-open]", R.pagesEl);
  if (link) bindExtLink(link);
  const me = R;
  $("[data-attach]", R.pagesEl).onclick = async () => {
    const [file] = await pickFiles({ accept: ".pdf,application/pdf" });
    if (!file || R !== me) return;
    me.awaitingPdf = true; // 올리기가 끝나면(refreshAll) 다시 불러 PDF를 표시
    uploadPdfs([file], { attachTo: me.pid });
  };
}

// 첨부가 끝나 서재 데이터가 새로 고쳐지면, 그 논문에 PDF가 생겼는지 보고 읽기 화면을 다시 연다
onRefresh(async () => {
  const me = R;
  if (!me || !me.awaitingPdf) return;
  let p;
  try { p = await api.get(`/api/papers/${me.pid}`); } catch { return; }
  if (R !== me || !p.has_pdf) return;
  me.awaitingPdf = false;
  if (me.embed) return me.embed.onAttached(p); // 참고 패널: 원고 화면은 그대로 두고 패널 PDF만 다시 띄움
  window.dispatchEvent(new HashChangeEvent("hashchange")); // 라우터가 같은 주소로 openReader를 다시 부름
});

async function loadPdf(startPage) {
  const me = R;
  if (!R.paper.has_pdf) return drawPdfMissing();
  R.pagesEl.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  try {
    const lib = await loadPdfjs();
    // 서명 주소(10분)로 파일 전체를 받아 둔다: 주소가 만료돼도 이미 받은 파일로 계속 읽음 (명세 6.7)
    const { url } = await api.get(`/api/papers/${R.pid}/pdf-url`);
    if (R !== me) return;
    let res;
    try {
      res = await fetch(url, { credentials: "omit" });
    } catch {
      throw new Error("PDF를 받지 못했어요. 인터넷 연결을 확인하고 다시 열어 주세요.");
    }
    if (!res.ok) throw new Error(res.status === 403 ? "PDF 주소가 만료됐어요. 다시 열어 주세요." : `PDF를 받지 못했어요 (HTTP ${res.status})`);
    const data = new Uint8Array(await res.arrayBuffer());
    if (R !== me) return;
    const doc = await lib.getDocument({ data, isEvalSupported: false }).promise;
    if (R !== me) { doc.destroy(); return; }
    R.doc = doc;
    $("[data-total]", R.view).textContent = doc.numPages;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      if (R !== me) return;
      const vp = page.getViewport({ scale: 1 });
      pages.push({ num: i, page, w: vp.width, h: vp.height, el: null, rendered: false, renderTask: null });
    }
    R.pages = pages;
  } catch (e) {
    if (R !== me) return;
    R.pagesEl.innerHTML = `<div class="empty"><h3>PDF를 열지 못했어요</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  R.scale = R.fit ? fitScale() : (prefs().scale || 1.2);
  buildPages();
  R.scroller.addEventListener("scroll", onScroll, { passive: true });
  R.pagesEl.addEventListener("mouseup", onMouseUp);
  R.onSelChange = onSelectionChange;
  document.addEventListener("selectionchange", R.onSelChange);
  R.pagesEl.addEventListener("mousedown", (e) => {
    const tl = e.target.closest(".textLayer");
    if (tl) tl.classList.add("selecting");
    if (!e.target.closest(".sel-pop")) hidePopups();
  });
  let lastW = R.scroller.clientWidth;
  R.resizeObserver = new ResizeObserver(() => {
    // 다른 탭을 보는 동안 숨겨진 칸(폭 0)은 건너뜀 — 돌아와도 배율이 작아지지 않게(참고 패널)
    if (R !== me || !R.fit || !R.scroller.clientWidth || Math.abs(R.scroller.clientWidth - lastW) < 8) return;
    lastW = R.scroller.clientWidth;
    setScale(fitScale(), true);
  });
  R.resizeObserver.observe(R.scroller);
  if (startPage) setTimeout(() => goToPage(startPage), 50);
}

function fitScale() {
  const maxW = Math.max(...R.pages.map((p) => p.w), 600);
  return Math.max(0.5, Math.min(2.5, (R.scroller.clientWidth - 48) / maxW));
}

function buildPages() {
  R.observer && R.observer.disconnect();
  R.pagesEl.innerHTML = "";
  R.observer = new IntersectionObserver((entries) => {
    for (const en of entries) {
      const pg = R.pages[Number(en.target.dataset.page) - 1];
      if (en.isIntersecting && !pg.rendered) renderPage(pg);
    }
  }, { root: R.scroller, rootMargin: "1200px 0px" });
  for (const pg of R.pages) {
    const d = el(`<div class="pdf-page" data-page="${pg.num}"><span class="page-label">${pg.num}</span>
      <div class="textLayer"></div><div class="hl-layer"></div></div>`);
    pg.el = d;
    pg.rendered = false;
    sizePage(pg);
    R.pagesEl.appendChild(d);
    R.observer.observe(d);
  }
  drawAllHighlights();
}

function sizePage(pg) {
  pg.el.style.width = `${Math.floor(pg.w * R.scale)}px`;
  pg.el.style.height = `${Math.floor(pg.h * R.scale)}px`;
  pg.el.style.setProperty("--scale-factor", R.scale);
}

async function renderPage(pg) {
  pg.rendered = true;
  const scale = R.scale;
  const viewport = pg.page.getViewport({ scale });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  const ctx = canvas.getContext("2d");
  try {
    pg.renderTask = pg.page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
    await pg.renderTask.promise;
  } catch (e) {
    if (e && e.name === "RenderingCancelledException") return;
    console.error(e);
  }
  if (!R || scale !== R.scale || !pg.el.isConnected) return;
  pg.el.querySelector("canvas")?.remove();
  pg.el.prepend(canvas);
  const tl = pg.el.querySelector(".textLayer");
  tl.innerHTML = "";
  try {
    const layer = new pdfjs.TextLayer({ textContentSource: pg.page.streamTextContent(), container: tl, viewport });
    await layer.render();
    tl.appendChild(el(`<div class="endOfContent"></div>`));
    if (R && R.pendingFlash && R.pendingFlash.page === pg.num) flashText(pg, R.pendingFlash.text);
  } catch (e) { console.error(e); }
}

// PDF.js 뷰어와 같은 방식: 선택 끝 지점 바로 뒤로 endOfContent를 옮겨, 빈 곳으로 끌어도
// 페이지 끝까지 선택되지 않게 한다
let prevRange = null;
function resetEnd(tl) {
  const end = tl.querySelector(".endOfContent");
  if (end) {
    end.style.width = "";
    end.style.height = "";
    tl.append(end);
  }
  tl.classList.remove("selecting");
}
function onSelectionChange() {
  if (!R) return;
  const sel = document.getSelection();
  const layers = $$(".textLayer", R.pagesEl);
  if (!sel || sel.rangeCount === 0) { layers.forEach(resetEnd); prevRange = null; return; }
  const range = sel.getRangeAt(0);
  const active = new Set();
  for (const tl of layers) if (range.intersectsNode(tl)) active.add(tl);
  layers.forEach((tl) => { if (!active.has(tl)) resetEnd(tl); });
  if (!active.size || sel.isCollapsed) { prevRange = range.cloneRange(); return; }
  const modifyStart = prevRange && (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0
    || range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
  let anchor = modifyStart ? range.startContainer : range.endContainer;
  if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
  const tl = anchor.parentElement && anchor.parentElement.closest(".textLayer");
  const end = tl && tl.querySelector(".endOfContent");
  if (end && anchor.parentElement && anchor !== end) {
    tl.classList.add("selecting");
    end.style.width = tl.style.width;
    end.style.height = tl.style.height;
    anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
  }
  prevRange = range.cloneRange();
}

function setScale(scale, fit) {
  if (!R || !R.pages.length || !R.pages[0].el) return;
  const anchorPage = R.currentPage || 1;
  const pg = R.pages[anchorPage - 1];
  const offset = pg && pg.el ? (R.scroller.scrollTop - pg.el.offsetTop) / pg.el.offsetHeight : 0;
  R.scale = Math.max(0.4, Math.min(4, scale));
  R.fit = fit;
  savePrefs({ fit, scale: R.scale });
  for (const p of R.pages) {
    p.renderTask && p.renderTask.cancel();
    p.rendered = false;
    sizePage(p);
    p.el.querySelector("canvas")?.remove();
    p.el.querySelector(".textLayer").innerHTML = "";
  }
  if (pg && pg.el) R.scroller.scrollTop = pg.el.offsetTop + offset * pg.el.offsetHeight;
  R.observer.disconnect();
  R.pages.forEach((p) => R.observer.observe(p.el));
}

function onScroll() {
  if (!R) return;
  const mid = R.scroller.scrollTop + R.scroller.clientHeight / 3;
  let cur = 1;
  for (const p of R.pages) {
    if (p.el.offsetTop <= mid) cur = p.num; else break;
  }
  if (cur !== R.currentPage) {
    R.currentPage = cur;
    const input = $("[data-page]", R.view);
    if (document.activeElement !== input) input.value = cur;
  }
}

export function goToPage(n, flashTextStr = "") {
  if (!R || !R.pages.length) return;
  n = Math.max(1, Math.min(R.pages.length, Number(n) || 1));
  const pg = R.pages[n - 1];
  if (!pg.el) return;
  R.scroller.scrollTo({ top: pg.el.offsetTop - 12, behavior: "smooth" });
  pg.el.classList.add("flash");
  setTimeout(() => pg.el.classList.remove("flash"), 1300);
  if (flashTextStr) {
    R.pendingFlash = { page: n, text: flashTextStr };
    if (pg.rendered && pg.el.querySelector(".textLayer span")) flashText(pg, flashTextStr);
  }
}

// 3단계 출처 위치(시안 4장): 그 쪽에서 rect(0~1) 위쪽이 화면 위 1/4에 오게 스크롤 → .spot-rect 6초 + 글 반짝임.
// rect가 없으면 쪽 이동 + 글 반짝임만
export function goToSpot(page, rect, text = "") {
  if (!R || !R.pages.length) return;
  const n = Math.max(1, Math.min(R.pages.length, Number(page) || 1));
  const pg = R.pages[n - 1];
  if (!pg.el) return;
  if (!rect) { goToPage(n, text); toast(`p.${n}의 출처 위치를 표시했어요`); return; }
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top = pg.el.offsetTop + rect[1] * pg.el.offsetHeight - R.scroller.clientHeight / 4;
  R.scroller.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  const box = el(`<div class="spot-rect"></div>`);
  Object.assign(box.style, { left: `${rect[0] * 100}%`, top: `${rect[1] * 100}%`, width: `${(rect[2] - rect[0]) * 100}%`,
    height: `${(rect[3] - rect[1]) * 100}%` });
  pg.el.querySelector(".hl-layer").appendChild(box);
  setTimeout(() => box.remove(), 6000);
  if (text) {
    R.pendingFlash = { page: n, text };
    if (pg.rendered && pg.el.querySelector(".textLayer span")) flashText(pg, text);
  }
  toast(`p.${n}의 출처 위치를 표시했어요`);
}

// 인용된 문장과 겹치는 텍스트 조각을 잠깐 표시한다
function flashText(pg, text) {
  R.pendingFlash = null;
  const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const target = norm(text);
  if (target.length < 6) return;
  const spans = [...pg.el.querySelectorAll(".textLayer span")].filter((s) => s.textContent.trim().length > 3);
  const hits = spans.filter((s) => target.includes(norm(s.textContent)));
  if (!hits.length) return;
  const pr = pg.el.getBoundingClientRect();
  const layer = pg.el.querySelector(".hl-layer");
  for (const s of hits.slice(0, 40)) {
    const r = s.getBoundingClientRect();
    const d = el(`<div class="hl-rect blue pulse" style="pointer-events:none"></div>`);
    Object.assign(d.style, { left: `${((r.left - pr.left) / pr.width) * 100}%`, top: `${((r.top - pr.top) / pr.height) * 100}%`, width: `${(r.width / pr.width) * 100}%`, height: `${(r.height / pr.height) * 100}%` });
    layer.appendChild(d);
    setTimeout(() => d.remove(), 3500);
  }
}

// ------------------------------------------------------------ highlights
function drawAllHighlights() {
  if (!R) return;
  for (const pg of R.pages) if (pg.el) pg.el.querySelector(".hl-layer").innerHTML = "";
  for (const a of R.annotations) drawHighlight(a);
}

function drawHighlight(a) {
  const pg = R.pages[a.page - 1];
  if (!pg || !pg.el) return;
  const layer = pg.el.querySelector(".hl-layer");
  layer.querySelectorAll(`[data-ann="${a.id}"]`).forEach((n) => n.remove());
  const rects = a.rects && a.rects.length ? a.rects : [[0.02, 0.02, 0.04, 0.03]];
  rects.forEach((r, i) => {
    const d = el(`<div class="hl-rect ${esc(a.color)} ${a.comment && i === rects.length - 1 ? "has-comment" : ""}" data-ann="${a.id}" title="${esc(a.comment || "")}"></div>`);
    Object.assign(d.style, { left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` });
    d.onclick = (e) => { e.stopPropagation(); annotationPopup(a, d); };
    layer.appendChild(d);
  });
}

function selectionRects(range) {
  const groups = new Map();
  for (const r of range.getClientRects()) {
    if (r.width < 1 || r.height < 1) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const pg = R.pages.find((p) => {
      if (!p.el) return false;
      const b = p.el.getBoundingClientRect();
      return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
    });
    if (!pg) continue;
    const b = pg.el.getBoundingClientRect();
    const nr = [(r.left - b.left) / b.width, (r.top - b.top) / b.height, r.width / b.width, r.height / b.height];
    if (nr[2] > 0.98 && nr[3] > 0.5) continue; // endOfContent 같은 전체 영역
    if (!groups.has(pg.num)) groups.set(pg.num, []);
    groups.get(pg.num).push(nr);
  }
  // 같은 줄의 조각들을 이어 붙인다
  for (const [num, rects] of groups) {
    rects.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const merged = [];
    for (const r of rects) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last[1] - r[1]) < Math.min(last[3], r[3]) * 0.5 && r[0] <= last[0] + last[2] + 0.015) {
        const right = Math.max(last[0] + last[2], r[0] + r[2]);
        const top = Math.min(last[1], r[1]);
        const bottom = Math.max(last[1] + last[3], r[1] + r[3]);
        last[0] = Math.min(last[0], r[0]); last[2] = right - last[0]; last[1] = top; last[3] = bottom - top;
      } else merged.push([...r]);
    }
    groups.set(num, merged.map((r) => r.map((x) => Math.round(x * 10000) / 10000)));
  }
  return groups;
}

function hidePopups() {
  $$(".sel-pop").forEach((p) => p.remove());
}

function placePopup(pop, x, y) {
  document.body.appendChild(pop);
  const r = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, x - r.width / 2))}px`;
  pop.style.top = `${y - r.height - 10 < 8 ? y + 26 : y - r.height - 10}px`;
}

function onMouseUp(e) {
  if (e.target.closest(".hl-rect") || e.target.closest(".sel-pop")) return;
  setTimeout(() => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    if (!R.pagesEl.contains(range.commonAncestorContainer)) return;
    const groups = selectionRects(range);
    if (!groups.size) return;
    hidePopups();
    const pop = el(`<div class="sel-pop">${COLORS.map((c) => `<button class="hl-color ${c === R.color ? "active" : ""}" data-c="${c}" title="하이라이트" aria-label="${COLOR_NAMES[c]}${c === "purple" ? "로" : "으로"} 하이라이트"></button>`).join("")}
      <span class="sep"></span>${R.embed ? `<button class="btn sm primary" data-quote title="${esc(quoteRuleText())}">인용으로 넣기</button>` : ""}<button class="btn sm ghost" data-note>메모</button>${R.embed ? "" : `<button class="btn sm ghost" data-ask>AI에게 묻기</button>`}<button class="btn sm ghost" data-copy>복사</button></div>`);
    const create = async (color, comment = "") => {
      hidePopups();
      sel.removeAllRanges();
      for (const [page, rects] of groups) {
        try {
          const a = await api.post(`/api/papers/${R.pid}/annotations`, { page, rects, text, color, comment });
          R.annotations.push(a);
          drawHighlight(a);
        } catch (err) { errorToast(err); }
      }
      annsChanged();
    };
    $$(".hl-color", pop).forEach((b) => (b.onclick = () => {
      R.color = b.dataset.c;
      savePrefs({ color: R.color });
      syncColors();
      create(b.dataset.c);
    }));
    $("[data-note]", pop).onclick = () => {
      pop.classList.add("ann-pop");
      pop.innerHTML = `<b class="small">메모 추가</b><textarea class="input" rows="3" placeholder="이 부분에 대한 생각"></textarea>
        <div class="row"><span class="spacer"></span><button class="btn sm" data-x>취소</button><button class="btn sm primary" data-s>저장</button></div>`;
      const ta = $("textarea", pop);
      ta.focus();
      $("[data-x]", pop).onclick = hidePopups;
      $("[data-s]", pop).onclick = () => create(R.color, ta.value.trim());
      ta.onkeydown = (ev) => { if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) create(R.color, ta.value.trim()); };
    };
    if (R.embed) {
      $("[data-quote]", pop).onclick = () => {
        hidePopups();
        sel.removeAllRanges();
        R.embed.onQuote({ text, pages: [...groups.keys()] });
      };
    } else {
      $("[data-ask]", pop).onclick = () => {
        hidePopups();
        R.quote = text;
        showTab("chat");
      };
    }
    $("[data-copy]", pop).onclick = () => { copyText(text); hidePopups(); };
    const rr = range.getBoundingClientRect();
    placePopup(pop, rr.left + rr.width / 2, rr.top);
  }, 10);
}

function annotationPopup(a, anchor) {
  hidePopups();
  const pop = el(`<div class="sel-pop ann-pop">
    <div class="row">${COLORS.map((c) => `<button class="hl-color ${c === a.color ? "active" : ""}" data-c="${c}" aria-label="${COLOR_NAMES[c]}"></button>`).join("")}
      <span class="spacer"></span>${R.embed ? `<button class="btn sm ghost" data-quote title="${esc(quoteRuleText())}">인용으로 넣기</button>`
        : `<button class="btn sm ghost" data-ask>AI에게 묻기</button>`}</div>
    <div class="small muted" style="max-height:60px;overflow:hidden">“${esc(a.text.slice(0, 160))}${a.text.length > 160 ? "…" : ""}”</div>
    <textarea class="input" rows="3" placeholder="메모">${esc(a.comment)}</textarea>
    <div class="row"><button class="btn sm danger" data-del>삭제</button><span class="spacer"></span><button class="btn sm" data-copy>복사</button><button class="btn sm primary" data-save>저장</button></div></div>`);
  const update = async (patch) => {
    try {
      Object.assign(a, await api.patch(`/api/annotations/${a.id}`, patch));
      drawHighlight(a);
      annsChanged();
    } catch (e) { errorToast(e); }
  };
  $$(".hl-color", pop).forEach((b) => (b.onclick = () => {
    $$(".hl-color", pop).forEach((x) => x.classList.toggle("active", x === b));
    update({ color: b.dataset.c });
  }));
  $("[data-save]", pop).onclick = () => { update({ comment: $("textarea", pop).value.trim() }); hidePopups(); };
  $("[data-copy]", pop).onclick = () => copyText(a.text);
  if (R.embed) $("[data-quote]", pop).onclick = () => { hidePopups(); R.embed.onQuote({ text: a.text, pages: [a.page] }); };
  else $("[data-ask]", pop).onclick = () => { hidePopups(); R.quote = a.text; showTab("chat"); };
  $("[data-del]", pop).onclick = () => { hidePopups(); deleteAnnotation(a); };
  const r = anchor.getBoundingClientRect();
  placePopup(pop, r.left + r.width / 2, r.top);
}

async function deleteAnnotation(a) {
  try {
    await api.del(`/api/annotations/${a.id}`);
    R.annotations = R.annotations.filter((x) => x.id !== a.id);
    $$(`[data-ann="${a.id}"]`).forEach((n) => n.remove());
    annsChanged();
  } catch (e) { errorToast(e); }
}

// ----------------------------------------------------------------- panel
function showTab(tab) {
  if (!R) return;
  if (R.noteSave) { R.noteSave.flush(); R.noteSave = null; }
  R.tab = tab;
  savePrefs({ tab });
  $$("[data-tab]", R.view).forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const body = $(".panel-body", R.view);
  body.className = "panel-body" + (tab === "chat" ? " chat-body" : "");
  body.innerHTML = "";
  ({ summary: summaryTab, chat: chatTab, highlights: highlightsTab, note: noteTab, cite: citeTab })[tab](body);
}

function pageLink(n) {
  return n ? `<button class="page-link" data-goto="${n}">p.${n}</button>` : "";
}

function bindPageLinks(root) {
  $$("[data-goto]", root).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); gotoPage(Number(b.dataset.goto)); }));
}

// ------------------------------------------------------------- summary
async function summaryTab(body) {
  const me = R;
  if (!R.summaryLoaded) {
    body.innerHTML = `<div class="ai-cta"><span class="spinner"></span></div>`;
    try {
      const r = await api.get(`/api/papers/${R.pid}/summary`);
      if (R !== me) return;
      R.summary = r.summary;
      R.summaryJob = r.job;
      R.summaryLoaded = true;
      if (ACTIVE(r.job)) followSummary(R.pid, r.job); // 다시 열면 진행 중 작업을 이어서 (AC-92)
    } catch (e) { body.innerHTML = `<div class="msg error">${esc(e.message)}</div>`; return; }
    if (R.tab !== "summary") return;
  }
  body.innerHTML = "";
  const job = R.summaryJob;
  if (ACTIVE(job) || (job && job.status === "failed" && !R.summary && !R.failSeen)) return drawJobCard(body, job);
  if (!R.summary) return drawSummaryCta(body);
  drawSummary(body, R.summary);
}

async function drawSummaryCta(body) {
  const st = await api.get("/api/ai/status").catch(() => ({ ready: false, message: "" }));
  if (!R || R.tab !== "summary") return;
  body.innerHTML = "";
  // 쓸 방법이 없으면 버튼은 aria-disabled + 이유 (디자인 6.1 — S10)
  const v = el(`<div class="ai-cta"><div class="big">✦</div><h3>AI로 이 논문 정리하기</h3>
    <p class="small">한 줄 요약, 초등~대학원 수준별 설명, 섹션별 요약, 핵심 수식 풀이, 기여와 한계를 만들어요.</p>
    <button class="btn primary" data-go ${st.ready ? "" : `aria-disabled="true" aria-describedby="ai-off-why"`}>요약 만들기</button>
    ${st.ready ? "" : `<p class="small" id="ai-off-why" tabindex="-1" style="margin-top:8px">${esc(st.message)} <a href="#" data-set>설정 열기</a></p>`}
  </div>`);
  $("[data-go]", v).onclick = () => (st.ready ? startSummary() : $("#ai-off-why", v).focus());
  const set = $("[data-set]", v);
  if (set) set.onclick = (e) => { e.preventDefault(); settingsDialog(); };
  body.appendChild(v);
}

// 요약 시작: 작업을 만들고(202 · 진행 중이면 그 작업) 따라간다. 탭을 닫아도 서버에서 계속
async function startSummary() {
  if (!R) return;
  const pid = R.pid;
  let r;
  try { r = await api.post(`/api/papers/${pid}/summary`); } catch (e) { return errorToast(e); }
  if (R && R.pid === pid) { R.summaryJob = r.job; R.failSeen = false; }
  followSummary(pid, r.job);
  if (R && R.pid === pid) showTab("summary");
}

function followSummary(pid, job) {
  if (watches.has(pid)) watches.get(pid)();
  const stop = watchJob(job.id, (j) => onSummaryJob(pid, j), { first: job });
  watches.set(pid, stop);
}

async function onSummaryJob(pid, j) {
  const here = R && R.pid === pid;
  if (!j) { watches.delete(pid); return; }
  if (here) R.summaryJob = j;
  if (ACTIVE(j)) {
    if (here && R.tab === "summary") {
      const card = $("[data-summary-progress]", R.view);
      if (card && card.dataset.jobId === String(j.id)) updateSummaryCard(card, j);
      else showTab("summary");
    }
    return;
  }
  watches.delete(pid);
  if (j.status === "succeeded") {
    let s = null;
    try { s = (await api.get(`/api/papers/${pid}/summary`)).summary; } catch { s = null; }
    if (R && R.pid === pid) {
      R.summary = s;
      // 폴백 · PC로 만들었으면 맨 위에 작은 줄 한 번 (디자인 6장)
      R.summaryNote = j.runner === "cli" && (j.history || []).length
        ? `PC의 ${j.engine}로 만들었어요 (${errorLabel(j.history[0].error_code, j.history[0].engine)}로 넘김)` : "";
    }
    toast("AI 요약이 준비됐어요", "success");
  } else if (j.status === "cancelled") {
    toast("요약을 취소했어요");
  } else if (!(R && R.pid === pid && R.tab === "summary")) {
    toast(j.error || "요약을 만들지 못했어요", "error");
  }
  if (R && R.pid === pid && R.tab === "summary") showTab("summary");
}

function drawJobCard(body, job) {
  const card = summaryCard(job, {
    onCancel: async () => {
      try {
        const r = await cancelJob(job.id);
        if (r.status === "cancelled" && R) { R.summaryJob = { ...R.summaryJob, status: "cancelled" }; }
      } catch (e) { errorToast(e); }
    },
    onRetry: async () => {
      try {
        const r = await retryJob(R.summaryJob.id);
        R.summaryJob = r.job;
        followSummary(R.pid, r.job);
        showTab("summary");
      } catch (e) { errorToast(e); }
    },
  });
  if (job.status === "failed") R.failSeen = true;
  body.appendChild(card);
}

// 요약 그리기 (읽기 화면 · 참고 패널 공용). ask: false면 [물어보기] · [다시 만들기] 없음(참고 패널 — 보여 주기만)
export function drawSummary(body, s, { ask = true } = {}) {
  const d = s.data;
  const note = ask && R && R.summaryNote ? R.summaryNote : "";
  if (note) R.summaryNote = "";
  const v = el(`<div>${note ? `<p class="small muted" style="margin:0 0 8px">${esc(note)}</p>` : ""}
    <div class="tldr"><b>한 줄 요약</b>${esc(d.tldr)}</div>
    <div class="qmr">
      ${d.research_question ? `<div><b>연구 질문</b>${esc(d.research_question)}</div>` : ""}
      ${d.method ? `<div><b>방법</b>${esc(d.method)}</div>` : ""}
      ${d.results ? `<div><b>결과</b>${esc(d.results)}</div>` : ""}
    </div>
    ${d.keywords.length ? `<div class="chips" style="margin-top:12px">${d.keywords.map((k) => `<span class="chip">${esc(k)}</span>`).join("")}</div>` : ""}
    <div class="section-title">수준별 설명</div>
    <div class="level-pick">${LEVELS.map(([k, n]) => `<button data-lv="${k}" class="${k === R.level ? "active" : ""}">${n}</button>`).join("")}</div>
    <div class="prose" data-overview></div>
    ${d.sections.length ? `<div class="section-title">섹션별 정리</div><div data-sections></div>` : ""}
    ${d.formulas.length ? `<div class="section-title">핵심 수식</div><div data-formulas></div>` : ""}
    ${listBlock("기여", d.contributions)}${listBlock("한계", d.limitations)}${listBlock("생각해 볼 질문", d.questions, ask)}
    <div class="row small muted" style="margin-top:22px"><span>${esc(s.model)} · ${fmtDate(s.created_at)}</span><span class="spacer"></span>
      ${ask ? `<button class="btn sm" data-redo>다시 만들기</button>` : ""}</div></div>`);
  const drawLevel = () => {
    $$(".level-pick button", v).forEach((b) => b.classList.toggle("active", b.dataset.lv === R.level));
    $("[data-overview]", v).innerHTML = renderMarkdown(d.overview[R.level] || "") || `<p class="muted">이 수준의 설명이 없어요</p>`;
    const secBox = $("[data-sections]", v);
    if (secBox) {
      const open = new Set($$(".acc.open", secBox).map((a) => a.dataset.i));
      if (!secBox.children.length) open.add("0");
      secBox.innerHTML = "";
      d.sections.forEach((sec, i) => {
        const acc = el(`<div class="acc ${open.has(String(i)) ? "open" : ""}" data-i="${i}">
          <div class="acc-head" role="button" tabindex="0"><span class="num">${i + 1}</span><span class="h">${esc(sec.heading)}</span>${pageLink(sec.page)}<span class="arrow">▼</span></div>
          <div class="acc-body"><div class="prose">${renderMarkdown(sec.levels[R.level] || sec.summary)}</div>
            ${sec.keyPoints.length ? `<ul class="keypoints">${sec.keyPoints.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}
            ${sec.levels[R.level] && sec.summary ? `<details style="margin-top:8px" class="small"><summary class="muted" style="cursor:pointer">원래 요약 보기</summary><div class="prose small" style="margin-top:6px">${renderMarkdown(sec.summary)}</div></details>` : ""}
          </div></div>`);
        const head = $(".acc-head", acc);
        head.onclick = () => acc.classList.toggle("open");
        head.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); acc.classList.toggle("open"); } };
        secBox.appendChild(acc);
      });
      bindPageLinks(secBox);
    }
  };
  $$(".level-pick button", v).forEach((b) => (b.onclick = () => { R.level = b.dataset.lv; savePrefs({ level: R.level }); drawLevel(); }));
  drawLevel();
  const fBox = $("[data-formulas]", v);
  if (fBox) {
    for (const f of d.formulas) {
      fBox.appendChild(el(`<div class="formula">
        <div class="f-head"><span class="f-name">${esc(f.name)}</span>${pageLink(f.page)}</div>
        <div class="f-tex">${renderTex(f.latex)}</div>
        ${f.meaning ? `<div class="prose small" style="margin-top:8px">${renderMarkdown(f.meaning)}</div>` : ""}
        ${f.variables.length ? `<table>${f.variables.map((x) => `<tr><td>${renderTex(x.symbol.replace(/^\$|\$$/g, ""), false)}</td><td>${esc(x.meaning)}</td></tr>`).join("")}</table>` : ""}
        ${f.derivation ? `<details><summary>유도 과정 보기</summary><div class="prose" style="margin-top:6px">${renderMarkdown(f.derivation)}</div></details>` : ""}
      </div>`));
    }
    bindPageLinks(fBox);
  }
  $$("[data-askq]", v).forEach((b) => (b.onclick = () => { R.prefill = b.dataset.askq; showTab("chat"); }));
  if (ask) {
    $("[data-redo]", v).onclick = async () => {
      if (await confirmDialog("요약을 다시 만들까요? 지금 요약은 새 결과로 바뀌어요.", { ok: "다시 만들기" })) startSummary();
    };
  }
  body.appendChild(v);
}

function listBlock(title, items, askable = false) {
  if (!items || !items.length) return "";
  return `<div class="section-title">${esc(title)}</div><div class="list-block"><ul>${items.map((x) =>
    `<li>${esc(x)}${askable ? ` <button class="page-link" data-askq="${esc(x)}">물어보기</button>` : ""}</li>`).join("")}</ul></div>`;
}

// ---------------------------------------------------------------- chat
async function chatTab(body) {
  const me = R;
  if (!R.chat) {
    body.innerHTML = `<div class="ai-cta"><span class="spinner"></span></div>`;
    try { R.chat = await api.get(`/api/papers/${R.pid}/chat`); } catch (e) { R.chat = []; errorToast(e); }
    // 진행 중인 대화 작업(PC 실행 · 탭을 닫았다 다시 연 경우)을 이어서 보여 준다
    R.chatJobs = await api.get(`/api/jobs?status=active&kind=chat&paper_id=${R.pid}`).then((r) => r.jobs.reverse()).catch(() => []);
    if (R !== me || R.tab !== "chat") return;
    body.innerHTML = "";
  }
  const log = el(`<div class="chat-log"></div>`);
  const quote = el(`<div class="quote-chip hidden"><span></span><button class="icon-btn small">✕</button></div>`);
  const input = el(`<div class="chat-input"><textarea class="input" rows="1" placeholder="논문에 대해 물어보세요" title="Enter 전송 · Shift+Enter 줄바꿈"></textarea>
    <button class="btn primary" data-send>보내기</button></div>`);
  const foot = el(`<div class="row small" style="padding:0 12px 8px;color:var(--text-3)"><span>답변의 [번호]를 누르면 근거가 있는 쪽으로 이동해요</span><span class="spacer"></span><a class="btn sm ghost" href="#/ask" title="서재 전체 · 컬렉션 · 폴더의 논문들을 함께 근거로 물어봐요">여러 논문에 질문 →</a><button class="btn sm ghost" data-clear>대화 지우기</button></div>`);
  body.append(log, quote, input, foot);
  const ta = $("textarea", input);
  const sendBtn = $("[data-send]", input);

  const drawQuote = () => {
    quote.classList.toggle("hidden", !R.quote);
    $("span", quote).textContent = R.quote ? `“${R.quote}”` : "";
  };
  $("button", quote).onclick = () => { R.quote = ""; drawQuote(); };
  drawQuote();

  const draw = () => {
    log.innerHTML = "";
    if (!R.chat.length) {
      const sug = el(`<div><div class="ai-cta" style="padding:20px 0 10px"><div class="big">💬</div><h3>논문과 대화하기</h3>
        <p class="small">논문 내용을 근거로 답하고, 근거가 된 쪽을 함께 보여줘요.</p></div><div class="suggest"></div></div>`);
      const qs = (R.summary && R.summary.data.questions.length ? R.summary.data.questions.slice(0, 3) : [])
        .concat(["이 논문의 핵심 아이디어를 쉽게 설명해 줘", "실험은 어떻게 설계했고 결과는 어땠어?", "이 연구의 한계와 후속 연구 방향은?"]).slice(0, 5);
      for (const q of qs) {
        const b = el(`<button>${esc(q)}</button>`);
        b.onclick = () => send(q);
        $(".suggest", sug).appendChild(b);
      }
      log.appendChild(sug);
    }
    for (const m of R.chat) log.appendChild(messageEl(m));
    for (const job of R.chatJobs || []) {
      log.appendChild(el(`<div class="msg user">${esc(job.question || "")}</div>`));
      log.appendChild(jobNode(job));
    }
    log.scrollTop = log.scrollHeight;
  };

  // PC(CLI)에서 만드는 답 자리: 폴백 안내 · 중간 글 · 한 줄 상태 + [취소]
  const jobNodes = new Map();
  const jobNode = (job, fallback = null) => {
    if (jobNodes.has(job.id)) return jobNodes.get(job.id).node;
    const node = el(`<div class="msg assistant" data-job-id="${job.id}">
      ${fallback ? `<div class="notice" data-tone="warn" data-job-fallback>${ICON_WARN}<div>API가 실패해서 PC로 넘겼어요 (${esc(fallback)}).</div></div>` : ""}
      <div class="prose hidden"></div></div>`);
    const line = statusLineEl(async () => {
      try { await cancelJob(job.id); } catch (e) { errorToast(e); }
    });
    node.appendChild(line);
    if (!R.chatWaitNoted) {
      R.chatWaitNoted = true;
      node.appendChild(el(`<p class="small muted" style="margin:4px 0 0">탭을 닫아도 답은 저장돼요. 다시 열면 보여요.</p>`));
    }
    const entry = { node, stop: null };
    jobNodes.set(job.id, entry);
    const me = R;
    busy(true);
    entry.stop = watchJob(job.id, async (j) => {
      if (R !== me) { entry.stop && entry.stop(); return; }
      if (!j || j.status === "cancelled") return finishJob(job.id, null);
      if (j.status === "succeeded") {
        try { R.chat = await api.get(`/api/papers/${R.pid}/chat`); } catch { /* 다음에 열면 보임 */ }
        R.chatJobs = (R.chatJobs || []).filter((x) => x.id !== j.id);
        jobNodes.delete(j.id);
        busy(false);
        draw();
        if (j.runner === "cli") log.appendChild(el(`<p class="small muted" style="margin:0">PC의 ${esc(j.engine)}로 답했어요</p>`));
        return;
      }
      if (j.status === "failed") {
        const err = el(`<div class="msg error" data-job-state="failed"><div class="row"><span class="grow">${esc(j.error || "답을 만들지 못했어요")}</span>
          <button type="button" class="btn sm" data-job-retry>다시 시도</button></div></div>`);
        $("[data-job-retry]", err).onclick = async () => {
          try {
            const r = await retryJob(j.id);
            err.replaceWith(jobNode(r.job));
          } catch (e) { errorToast(e); }
        };
        node.replaceWith(err);
        return finishJob(j.id, err);
      }
      const partial = (j.progress || {}).partial_text || "";
      const prose = $(".prose", node);
      if (partial) { prose.classList.remove("hidden"); prose.innerHTML = renderMarkdown(partial); }
      setStatusLine(line, j, "답을 만드는");
      if (j.status === "running" && j.runner === "cli") $(".grow", line).textContent = `${j.device ? `‘${j.device.name}’` : "PC"}에서 답을 만드는 중 (${j.engine})`;
    }, { first: job });
    return node;
  };
  const finishJob = (id, keep) => {
    const e = jobNodes.get(id);
    if (e && !keep) e.node.remove();
    jobNodes.delete(id);
    R.chatJobs = (R.chatJobs || []).filter((x) => x.id !== id);
    busy(false);
  };
  const busy = (on) => {
    R.sending = on || jobNodes.size > 0;
    sendBtn.disabled = R.sending;
    ta.placeholder = R.sending ? "답을 기다리는 중이에요…" : "논문에 대해 물어보세요";
  };

  const send = async (text) => {
    text = (text || ta.value).trim();
    if (!text || R.sending) return;
    const question = R.quote ? `다음 부분에 대해:\n> ${R.quote}\n\n${text}` : text;
    R.quote = "";
    drawQuote();
    ta.value = "";
    R.sending = true;
    sendBtn.disabled = true;
    R.chat.push({ role: "user", content: question });
    draw();
    const pending = { role: "assistant", content: "", citations: [], pending: true };
    const node = messageEl(pending);
    log.appendChild(node);
    log.scrollTop = log.scrollHeight;
    const me = R;
    R.abort = new AbortController();
    let jobEv = null;
    try {
      await streamEvents(`/api/papers/${R.pid}/chat`, { question }, (ev) => {
        if (R !== me) return;
        if (ev.type === "queued" || ev.type === "fallback") {
          jobEv = ev; // CLI로 감: 이미 나온 API 글은 지우고 작업을 따라간다
        } else if (ev.type === "delta") {
          pending.content += ev.text;
          updateMessage(node, pending);
        } else if (ev.type === "done") {
          pending.content = ev.text;
          pending.citations = ev.citations;
          pending.pending = false;
          updateMessage(node, pending);
        } else if (ev.type === "error") {
          throw new Error(ev.error);
        }
        const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
        if (nearBottom) log.scrollTop = log.scrollHeight;
      }, R.abort.signal);
      if (R !== me) return;
      if (jobEv) {
        R.chat.pop();
        R.chatJobs = [...(R.chatJobs || []), jobEv.job];
        jobNode(jobEv.job, jobEv.type === "fallback" && jobEv.job.history.length
          ? errorLabel(jobEv.job.history[jobEv.job.history.length - 1].error_code) : null);
        draw();
        return;
      }
      if (pending.pending) throw new Error("응답이 끝나기 전에 연결이 끊겼어요");
      R.chat.push(pending);
    } catch (e) {
      if (R !== me || e.name === "AbortError") return;
      R.chat.pop();
      node.replaceWith(el(`<div class="msg error">${esc(e.message)}</div>`));
      ta.value = text;
    } finally {
      if (R === me) busy(false);
    }
  };

  sendBtn.onclick = () => send();
  ta.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  };
  ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
  $("[data-clear]", foot).onclick = async () => {
    if (!R.chat.length || !(await confirmDialog("이 논문과 나눈 대화를 모두 지울까요?", { ok: "지우기" }))) return;
    await api.del(`/api/papers/${R.pid}/chat`);
    R.chat = [];
    draw();
  };
  draw();
  if (R.prefill) { const q = R.prefill; R.prefill = ""; send(q); }
  else ta.focus();
}

function messageEl(m) {
  if (m.role === "user") return el(`<div class="msg user">${esc(m.content)}</div>`);
  const node = el(`<div class="msg assistant"><div class="prose"></div><div class="cite-list"></div></div>`);
  updateMessage(node, m);
  return node;
}

function updateMessage(node, m) {
  const prose = $(".prose", node);
  if (m.pending && !m.content) {
    prose.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;
    return;
  }
  prose.innerHTML = renderMarkdown(m.content, { citations: !m.pending });
  const list = $(".cite-list", node);
  list.innerHTML = "";
  const cites = m.citations || [];
  for (const c of cites) {
    const item = el(`<div class="cite-item"><span class="cite-ref">${c.n}</span>${c.page ? `<span class="page-link">p.${c.page}${c.end_page && c.end_page !== c.page ? `–${c.end_page}` : ""}</span>` : ""}${c.text ? `<q>${esc(c.text)}</q>` : ""}</div>`);
    item.onclick = () => c.page && goToPage(c.page, c.text);
    list.appendChild(item);
  }
  $$("[data-cite]", prose).forEach((b) => {
    const c = cites.find((x) => String(x.n) === b.dataset.cite);
    if (!c) { b.replaceWith(document.createTextNode(`[${b.dataset.cite}]`)); return; }
    b.title = c.page ? `p.${c.page}${c.text ? ` · ${c.text.slice(0, 120)}` : ""}` : c.text;
    b.onclick = () => c.page && goToPage(c.page, c.text);
  });
}

// ---------------------------------------------------------- highlights
// 하이라이트 목록 (읽기 화면 · 참고 패널 공용). onInsert(a, "quote" | "comment")가 있으면 [묻기] 대신 [넣기] · [메모 넣기]
export function highlightsTab(body, { onInsert = null } = {}) {
  const anns = [...R.annotations].sort((a, b) => a.page - b.page || (a.rects[0]?.[1] || 0) - (b.rects[0]?.[1] || 0));
  const v = el(`<div><div class="row" style="margin-bottom:12px"><span class="small muted">${anns.length}개</span><span class="spacer"></span>
    <div class="seg" data-filter><button class="active" data-c="">전체</button>${COLORS.map((c) => `<button data-c="${c}"><span class="hl-color" data-c="${c}" style="display:inline-block;width:10px;height:10px;border:0"></span></button>`).join("")}</div>
    <button class="btn sm" data-export>.md</button></div><div data-list></div></div>`);
  const list = $("[data-list]", v);
  const draw = (color) => {
    list.innerHTML = "";
    const shown = anns.filter((a) => !color || a.color === color);
    if (!shown.length) {
      list.innerHTML = `<div class="ai-cta"><div class="big">🖍</div><h3>하이라이트가 없어요</h3><p class="small">PDF에서 문장을 드래그하면 색을 골라 칠하고 메모를 남길 수 있어요.</p></div>`;
      return;
    }
    for (const a of shown) {
      const item = el(`<div class="ann-item ${esc(a.color)}">
        <div class="q">${a.text ? esc(a.text) : '<span class="muted">(메모)</span>'}</div>
        ${a.comment ? `<div class="c">${esc(a.comment)}</div>` : ""}
        <div class="foot">${pageLink(a.page)}<span>${fmtDate(a.created_at)}</span><span class="spacer"></span>
          ${onInsert ? `<button class="btn sm" data-insert title="${esc(quoteRuleText())}">넣기</button>${a.comment ? `<button class="btn sm ghost" data-insert-comment title="메모를 내 말로(따옴표 없이) 넣어요">메모 넣기</button>` : ""}` : ""}
          <button class="btn sm ghost" data-edit>메모</button>${onInsert ? "" : `<button class="btn sm ghost" data-ask>묻기</button>`}<button class="btn sm ghost danger" data-del>삭제</button></div></div>`);
      $(".q", item).onclick = () => { gotoPage(a.page); setTimeout(() => $$(`[data-ann="${a.id}"]`).forEach((n) => { n.classList.add("pulse"); setTimeout(() => n.classList.remove("pulse"), 3000); }), 400); };
      $("[data-del]", item).onclick = () => deleteAnnotation(a);
      if (onInsert) {
        $("[data-insert]", item).onclick = () => onInsert(a, "quote");
        const ic = $("[data-insert-comment]", item);
        if (ic) ic.onclick = () => onInsert(a, "comment");
      } else $("[data-ask]", item).onclick = () => { R.quote = a.text; showTab("chat"); };
      $("[data-edit]", item).onclick = () => {
        const ta = el(`<textarea class="input" rows="3" style="width:100%;margin-top:6px">${esc(a.comment)}</textarea>`);
        const c = $(".c", item);
        c ? c.replaceWith(ta) : $(".q", item).after(ta);
        ta.focus();
        ta.onblur = async () => {
          try { Object.assign(a, await api.patch(`/api/annotations/${a.id}`, { comment: ta.value.trim() })); drawHighlight(a); } catch (e) { errorToast(e); }
          draw(color);
        };
      };
      list.appendChild(item);
    }
    bindPageLinks(list);
  };
  $$("[data-filter] button", v).forEach((b) => (b.onclick = () => {
    $$("[data-filter] button", v).forEach((x) => x.classList.toggle("active", x === b));
    draw(b.dataset.c);
  }));
  $("[data-export]", v).onclick = () => exportAnnotations(R.pid, R.paper.title);
  draw("");
  body.appendChild(v);
}

// ---------------------------------------------------------------- note
async function noteTab(body) {
  const me = R;
  const p = await api.get(`/api/papers/${R.pid}`);
  if (R !== me || R.tab !== "note") return;
  R.paper = p;
  const v = el(`<div>
    <div class="row" style="margin-bottom:8px"><div class="seg"><button class="active" data-m="edit">쓰기</button><button data-m="view">미리보기</button></div>
      <span class="spacer"></span><span class="small muted" data-st></span><button class="btn sm" data-ins title="하이라이트와 메모를 노트 끝에 붙여요">하이라이트 가져오기</button></div>
    <textarea class="input note-editor" style="min-height:calc(100vh - 210px)" placeholder="이 논문에 대한 생각을 마크다운으로 정리하세요. 수식은 $...$">${esc(p.note || "")}</textarea>
    <div class="prose hidden"></div></div>`);
  const ta = $("textarea", v);
  const st = $("[data-st]", v);
  let saved = p.note || "";
  const save = debounce(async () => {
    try { await api.put(`/api/papers/${R.pid}/note`, { content: ta.value }); saved = ta.value; st.textContent = "저장됨"; }
    catch (e) { st.textContent = "저장 실패"; errorToast(e); }
  }, 700);
  R.noteSave = { flush: () => (ta.value !== saved ? save.flush() : null) };
  ta.oninput = () => { st.textContent = "입력 중…"; save(); };
  $$(".seg button", v).forEach((b) => (b.onclick = () => {
    $$(".seg button", v).forEach((x) => x.classList.toggle("active", x === b));
    const view = b.dataset.m === "view";
    ta.classList.toggle("hidden", view);
    const prev = $(".prose", v);
    prev.classList.toggle("hidden", !view);
    if (view) prev.innerHTML = renderMarkdown(ta.value) || `<p class="muted">비어 있어요</p>`;
  }));
  $("[data-ins]", v).onclick = () => {
    const lines = [...R.annotations].sort((a, b) => a.page - b.page).map((a) =>
      `> ${a.text} (p.${a.page})${a.comment ? `\n\n${a.comment}` : ""}`);
    if (!lines.length) return toast("하이라이트가 없어요");
    ta.value = (ta.value.trim() ? ta.value.trim() + "\n\n" : "") + "## 하이라이트\n\n" + lines.join("\n\n") + "\n";
    ta.oninput();
  };
  body.appendChild(v);
}

// ------------------------------------------------------------ info/cite
async function citeTab(body) {
  const me = R;
  const [p, cite, styles] = await Promise.all([api.get(`/api/papers/${R.pid}`), api.get(`/api/papers/${R.pid}/cite`),
    listStyles().catch(() => [])]);
  if (R !== me || R.tab !== "cite") return;
  const v = el(`<div>
    <h3 style="margin:0 0 4px;font-size:15px;line-height:1.4">${esc(p.title)}</h3>
    <div class="small muted">${esc(authorsShort(p.authors, 8))}</div>
    <div class="small muted">${esc([p.venue, p.issued || p.year].filter(Boolean).join(" · "))}</div>
    ${p.abstract ? `<div class="section-title">초록</div><div class="abstract">${esc(p.abstract)}</div>` : ""}
    <div class="section-title">인용</div>
    <div data-issues></div>
    <select class="input" data-style style="width:100%;margin-bottom:8px">${styleOptions(styles, state.settings.citation_style || "apa")}</select>
    <div data-out><div class="status-line"><span class="spinner"></span> 만드는 중…</div></div>
    <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn sm" data-bib>BibTeX 복사</button><button class="btn sm" data-all>자세히</button></div>
  </div>`);
  const ib = issuesBox(cite.issues, async () => editPaperDialog(await api.get(`/api/papers/${R.pid}`)));
  if (ib) $("[data-issues]", v).appendChild(ib);
  const draw = async () => {
    const out = $("[data-out]", v);
    try {
      const r = await render([cite.csl], { style: $("[data-style]", v).value });
      const e = r.entries[0] || { html: "", text: "" };
      out.innerHTML = "";
      const block = el(`<div class="cite-block"><div class="body">${e.html || window.DOMPurify.sanitize(r.citation.html)}</div>
        <div class="row" style="margin-top:8px"><span class="small muted">${r.note ? "각주" : "본문"}: ${window.DOMPurify.sanitize(r.citation.html)}</span><span class="spacer"></span>
        <button class="btn sm" data-c1>참고문헌 복사</button><button class="btn sm" data-c2>본문 인용 복사</button></div></div>`);
      $("[data-c1]", block).onclick = () => copyText(e.text || r.citation.text, e.html || r.citation.html);
      $("[data-c2]", block).onclick = () => copyText(r.citation.text, r.citation.html);
      out.appendChild(block);
    } catch (err) {
      out.innerHTML = `<div class="status-line bad">${esc(err.message)}</div>`;
    }
  };
  $("[data-style]", v).onchange = async () => {
    try { state.settings = await api.put("/api/settings", { citation_style: $("[data-style]", v).value }); } catch { /* 무시 */ }
    draw();
  };
  $("[data-bib]", v).onclick = () => copyText(cite.bibtex);
  $("[data-all]", v).onclick = () => citeDialog(R.pid);
  body.appendChild(v);
  draw();
}
