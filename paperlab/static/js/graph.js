// 인용 그래프 화면 #/graph · #/graph/W… (docs/specs/citation-graph.md 10장 · docs/design/citation-graph-ui.md)
// - 서버 POST /api/graph(SSE)로 받고, d3-force(그래프 화면에 들어올 때만 불러옴)로 배치만 계산, 그리기는 SVG로 직접.
// - 씨앗은 요청 본문으로만 보낸다(주소 쿼리에 넣지 않음). 화면 주소의 해시 #/graph/W…는 서버로 가지 않는다.
// - 제목 · 저자 · 초록은 esc() · textContent로만 넣는다(SVG <text> 포함 — AC-G51).
// - 만든 그래프는 서버에 기록하지 않는다(U-1). 같은 탭에서 뒤로 가기 때 다시 그리려고 브라우저 메모리에만 둔다.

import { streamEvents } from "./api.js";
import { EXT_MARK, ICON_GRAPH, SCHOLAR_LIBRARY_NOTE, addPaper, bindExtLink, citeDialog, settingsDialog } from "./dialogs.js";
import { INHA, paperProxyTarget, scholarUrl } from "./extlinks.js";
import {
  DEFAULT_SIZE, GRAPH_SIZES, REL_TEXT, STEPS, STEP_LABELS, closest, countFromMessage, edgeBetween, edgeOpacity,
  edgeWidth, fitTransform, fmt, groupNotices, layoutGraph, nearestInDirection, nodeAriaLabel, relationText,
  scholarQuery, seedFromResult, seedRelationText, shortTitle, sortCaption, sortRows, stepStates, toModel,
  yearRamp, zoomAt,
} from "./graphmath.js";
import { state } from "./state.js";
import { $, $$, authorsShort, el, esc, modalOpen, safeUrl } from "./ui.js";

// d3-force + 의존 3개 (UMD — window.d3). 해시는 vendor/THIRD_PARTY.md와 같아야 함(AC-G52)
export const D3_FILES = [
  ["d3-dispatch.min.js", "sha384-oGUk7ZMuIJXyjegrWZrjUkxuWZHJoUPTeaUNKzjcEhND8HzfagI4EnXVspF2mP60"],
  ["d3-quadtree.min.js", "sha384-JzQQZeN94rbeGRpksNSu8TCkRWLlzTHev53JZngDT0faxrmd9bApgXS5pZWShqJb"],
  ["d3-timer.min.js", "sha384-brChTSJXF1bpEGi+e8fNotmiEQtehLbv5EWt3njlDFlYjl/SwmXs4xofe0gvWd7E"],
  ["d3-force.min.js", "sha384-RM+ykRJc5/xPC56TVMOAYbZeVThoKXqcRlmRHZZc3YDHDCvFJrsEH2dpLMqL50K8"],
];
const D3_BASE = "/static/vendor/d3/";
const LEGEND_KEY = "paperlab.graphLegend";
const MEMORY_MAX = 8;
const NARROW = "(max-width: 900px)";
const SVG_NS = "http://www.w3.org/2000/svg";
const ICON_WARN = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.5v.01"/></svg>`;
const ICON_INFO = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5v.01"/></svg>`;
const ICON_FIT = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`;
const INHA_OPEN_TITLE = `${INHA.proxyName}(정석학술정보관)로 원문 페이지를 열어요`;
const KEYS_TEXT = "끌어서 이동 · 휠로 확대 · 키보드: 화살표로 이동, Enter로 고르기";
const ERR = {
  seed_not_found: ["이 논문을 OpenAlex에서 찾지 못했어요", "DOI가 있으면 더 정확하게 찾아요. 서재 논문이라면 ⋯ → ‘정보 수정’에서 DOI를 넣고 다시 시도해 보세요.", ["scholar", "back"]],
  upstream_limited: ["OpenAlex 하루 사용량을 다 썼어요", "한국 시간 오전 9시에 초기화돼요. 설정에서 OpenAlex API 키(무료)를 넣으면 한도가 10배가 돼요.", ["settings", "back"]],
  upstream_unavailable: ["OpenAlex에 연결할 수 없어요", "잠시 후 다시 시도해 주세요.", ["retry", "back"]],
  internal: ["그래프를 만들지 못했어요", "잠시 후 다시 시도해 주세요.", ["retry", "back"]],
  graph_busy: ["이미 그래프를 만드는 중이에요", "끝난 뒤 다시 눌러 주세요. 다른 탭에서 만들고 있을 수도 있어요.", ["retry", "back"]],
  graph_queue_full: ["지금 그래프 요청이 많아요", "잠시 후 다시 시도해 주세요.", ["retry", "back"]],
  bad_seed: ["이 논문으로는 그래프를 만들 수 없어요", "DOI · arXiv 번호 · 제목 형식을 알아보지 못했어요.", ["back"]],
  not_found: ["서재에서 이 논문을 찾지 못했어요", "삭제됐을 수 있어요.", ["library"]],
  disconnected: ["연결이 끊겼어요", "그동안 받은 정보는 저장돼 있어서 다시 만들면 더 빨라요.", ["retry", "back"]],
  cancelled: ["그래프 만들기를 취소했어요", "그동안 받은 정보는 저장돼 있어서 다시 만들면 더 빨라요.", ["retry", "back"]],
  empty: ["연결된 논문을 충분히 찾지 못했어요", "OpenAlex에 인용 정보가 적은 논문일 수 있어요. Google Scholar에서 ‘인용’ · ‘관련 학술자료’를 살펴보세요.", ["scholar", "back"]],
  noseed: ["그래프를 만들 논문을 골라 주세요", "서재 논문 상세의 ‘인용 관계’ 탭이나 논문 찾기 결과의 ‘그래프’에서 시작해요.", ["library", "discover"]],
};

let pending = null; // openGraph가 넘긴 씨앗 {seed, from, title, size}
const memory = new Map(); // `${W}:${size}` → graph (브라우저 메모리만)
let d3Promise = null;
let g = null; // 지금 화면 상태
let seq = 0;

// ------------------------------------------------------------------ 진입
// 진입점(서재 상세 · 찾기 카드 · 노드 패널)이 부른다. seed = {paper_id} | {openalex_id, doi, arxiv_id, title}
export function openGraph(seed, { title = "", size = DEFAULT_SIZE } = {}) {
  pending = { seed, from: location.hash || "#/library", title, size };
  if (location.hash === "#/graph") window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = "#/graph";
}

export { seedFromResult };

// 로그아웃 · 다른 계정으로 로그인할 때: 브라우저 메모리의 그래프(서재 표시 포함)를 비운다(품질팀 M-5)
export function resetGraphMemory() {
  closeGraph();
  memory.clear();
  pending = null;
}

export function closeGraph() {
  if (!g) return;
  seq++;
  if (g.ctl) g.ctl.abort();
  clearTimeout(g.progressTimer);
  if (g.ro) g.ro.disconnect();
  if (g.mo) g.mo.disconnect();
  if (g.mq) g.mq.removeEventListener("change", g.onNarrow);
  window.removeEventListener("keydown", g.onEsc, true);
  g = null;
}

function loadD3() {
  if (window.d3 && window.d3.forceSimulation) return Promise.resolve(window.d3);
  if (!d3Promise) {
    d3Promise = D3_FILES.reduce((p, [file, hash]) => p.then(() => new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = D3_BASE + file;
      s.integrity = hash;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error("그래프 라이브러리를 불러오지 못했어요"));
      document.head.appendChild(s);
    })), Promise.resolve()).then(() => window.d3).catch((e) => { d3Promise = null; throw e; });
  }
  return d3Promise;
}

function remember(graph) {
  const key = `${graph.seed}:${graph.size}`;
  memory.delete(key);
  memory.set(key, graph);
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
}

// ------------------------------------------------------------------ 화면 틀
export function renderGraph(main) {
  closeGraph();
  const m = (location.hash || "").match(/^#\/graph\/(W[1-9]\d{0,11})$/);
  let seed = null;
  let from = null;
  let title = "";
  let size = DEFAULT_SIZE;
  if (pending && location.hash === "#/graph") {
    ({ seed, from, title, size } = pending);
  } else if (m) {
    seed = { openalex_id: m[1] };
    from = (history.state && history.state.graphFrom) || null;
    size = (history.state && GRAPH_SIZES.includes(history.state.graphSize)) ? history.state.graphSize : DEFAULT_SIZE;
  }
  pending = null;
  main.innerHTML = "";
  const view = el(`<section class="view graph-view" data-graph-state="loading" data-graph-mode="graph">
    <header class="graph-bar">
      <button type="button" class="btn sm" data-graph-back>← 돌아가기</button>
      <h1 class="graph-title" tabindex="-1"><span class="muted">인용 그래프 · </span><span data-graph-name></span></h1>
      <div class="graph-ctls">
        <div class="graph-ctl" role="radiogroup" aria-labelledby="graph-size-label">
          <span id="graph-size-label">논문 수</span>
          <div class="seg seg-radio">${GRAPH_SIZES.map((n) => `<label><input type="radio" name="graph-size" value="${n}"><span>${n}</span></label>`).join("")}</div>
        </div>
        <div class="graph-ctl" role="radiogroup" aria-labelledby="graph-mode-label">
          <span id="graph-mode-label">보기</span>
          <div class="seg seg-radio">
            <label><input type="radio" name="graph-mode" value="graph" checked><span>그래프</span></label>
            <label><input type="radio" name="graph-mode" value="list"><span>목록</span></label>
          </div>
        </div>
        <button type="button" class="btn sm" data-graph-legend aria-expanded="true" aria-controls="graph-legend">범례</button>
      </div>
    </header>
    <div class="graph-body">
      <div class="graph-main">
        <div class="graph-notices" data-graph-notices></div>
        <div class="graph-stage"></div>
        <div class="graph-list"></div>
        <div class="graph-foot"><span data-foot-count></span><span data-foot-src></span>
          <span class="graph-keys" id="graph-keys">${KEYS_TEXT}</span></div>
      </div>
      <aside class="panel graph-panel" aria-label="논문 정보">
        <div class="tabs" role="tablist" aria-label="그래프 정보">
          <button type="button" role="tab" id="graph-tab-info" data-graph-tab="info" aria-selected="true" aria-controls="graph-tabpanel" tabindex="0" class="active">논문 정보</button>
          <button type="button" role="tab" id="graph-tab-prior" data-graph-tab="prior" aria-selected="false" aria-controls="graph-tabpanel" tabindex="-1">이전 연구<span class="graph-tab-n"></span></button>
          <button type="button" role="tab" id="graph-tab-derivative" data-graph-tab="derivative" aria-selected="false" aria-controls="graph-tabpanel" tabindex="-1">이후 연구<span class="graph-tab-n"></span></button>
        </div>
        <div class="panel-body" role="tabpanel" id="graph-tabpanel" aria-labelledby="graph-tab-info"></div>
      </aside>
    </div>
    <div class="sr-only" role="status" data-graph-live></div>
  </section>`);
  main.appendChild(view);
  g = {
    view, main, seed, from, size, mode: "graph", model: null, pos: null, t: null, base: null, sel: null, rov: null,
    tab: "info", panelItem: null, sort: { key: "score", dir: "desc" }, hidden: new Set(), ctl: null, built: false,
    legendOpen: legendDefault(), seedTitle: title,
  };
  wireBar();
  setBack();
  setName(title);
  if (!seed || !Object.keys(seed).length) return showState("noseed");
  const cached = seed.openalex_id && memory.get(`${seed.openalex_id}:${size}`);
  if (cached) {
    loadD3().then(() => { if (g && g.view === view) showGraph(cached, { first: true }); })
      .catch(() => showState("internal"));
    return;
  }
  loadD3().catch(() => {}); // 받는 동안 미리
  build({ seed, size });
}

function setName(title) {
  const n = $("[data-graph-name]", g.view);
  n.textContent = shortTitle(title, 70);
  $(".graph-title", g.view).title = title || "";
}

function setBack() {
  const b = $("[data-graph-back]", g.view);
  const f = g.from || "";
  b.title = f.startsWith("#/discover") ? "논문 찾기로 돌아가요" : f.startsWith("#/graph") ? "이전 그래프로 돌아가요" : "서재로 돌아가요";
}

function goBack() {
  if (g && g.from) history.back();
  else location.hash = "#/library";
}

function setState(s) {
  g.view.dataset.graphState = s;
}

function announce(msg) {
  const live = $("[data-graph-live]", g.view);
  live.textContent = "";
  setTimeout(() => { if (live.isConnected) live.textContent = msg; }, 60);
}

function legendDefault() {
  try {
    const v = localStorage.getItem(LEGEND_KEY);
    if (v === "1" || v === "0") return v === "1";
  } catch { /* 기본값 */ }
  return !matchMedia(NARROW).matches;
}

function saveLegend(open) {
  try { localStorage.setItem(LEGEND_KEY, open ? "1" : "0"); } catch { /* 저장 못 함 */ }
}

function wireBar() {
  const v = g.view;
  $("[data-graph-back]", v).onclick = goBack;
  for (const r of $$("input[name=graph-size]", v)) {
    r.checked = Number(r.value) === g.size;
    r.onchange = () => { if (r.checked) changeSize(Number(r.value)); };
  }
  for (const r of $$("input[name=graph-mode]", v)) r.onchange = () => { if (r.checked) setMode(r.value); };
  $("[data-graph-legend]", v).onclick = () => toggleLegend(!g.legendOpen);
  wireTabs();
  g.onEsc = (e) => {
    if (e.key !== "Escape" || modalOpen() || !g || !g.svg) return;
    if (g.view.contains(document.activeElement)) unhighlight();
  };
  window.addEventListener("keydown", g.onEsc, true);
  g.mq = matchMedia(NARROW);
  g.onNarrow = () => updateJump();
  g.mq.addEventListener("change", g.onNarrow);
}

// ------------------------------------------------------------------ 만들기 (SSE)
async function build({ seed, size, resize = false }) {
  if (g.ctl) g.ctl.abort();
  const ctl = new AbortController();
  const mine = ++seq;
  g.ctl = ctl;
  g.lastReq = { seed, size };
  showProgress({ resize, size });
  let done = null;
  let err = null;
  try {
    await streamEvents("/api/graph", { seed, size }, (ev) => {
      if (mine !== seq || !g) return;
      if (ev.type === "progress") onProgress(ev);
      else if (ev.type === "done") done = ev.graph;
      else if (ev.type === "error") err = ev;
    }, ctl.signal);
  } catch (e) {
    if (e && e.name === "AbortError") return;
    err = { code: e.code || (e.status === 404 ? "not_found" : e.status === 400 ? "bad_seed" : "internal") };
  }
  if (mine !== seq || !g) return;
  hideProgress();
  if (done) {
    remember(done);
    g.size = done.size;
    try {
      await loadD3();
    } catch {
      return showState("internal");
    }
    if (mine !== seq || !g) return;
    showGraph(done, { first: !resize });
  } else if (resize && g.model) {
    g.extra = "resize_failed";
    syncSizeRadios();
    drawNotices();
  } else {
    showState(err ? err.code : "disconnected");
  }
}

function showProgress({ resize, size }) {
  clearTimeout(g.progressTimer);
  const stage = $(".graph-stage", g.view);
  $(".graph-progress", stage)?.remove();
  if (resize) {
    $(".graph-main", g.view).setAttribute("aria-busy", "true");
    $$("input[name=graph-size]", g.view).forEach((r) => { r.disabled = true; });
  } else {
    setState("loading");
    $(".graph-state", g.view)?.remove();
  }
  const card = el(`<div class="graph-progress hidden" data-graph-progress>
    <div class="graph-progress-card">
      <div class="graph-progress-head"><span class="spinner" aria-hidden="true"></span><span>${resize ? `논문 ${size}편으로 다시 그리는 중…` : "그래프를 만드는 중…"}</span></div>
      <div class="progress indeterminate" role="progressbar" aria-label="그래프 만들기 진행" aria-valuemin="0" aria-valuemax="100"><div style="width:5%"></div></div>
      <ol class="graph-steps ${resize ? "hidden" : ""}">${STEPS.map((s) => `<li data-step="${s}" data-state="todo">${esc(STEP_LABELS[s])} <span class="graph-step-msg"></span></li>`).join("")}</ol>
      <p class="graph-progress-msg" role="status"></p>
      <div class="graph-progress-foot"><span class="small muted">처음 보는 논문은 10~30초 걸릴 수 있어요.</span>
        <button type="button" class="btn sm" data-graph-cancel>취소</button></div>
    </div></div>`);
  stage.appendChild(card);
  $("[data-graph-cancel]", card).onclick = cancel;
  // 캐시면 보통 바로 끝나므로 0.4초 뒤에 보임(번쩍임 방지)
  g.progressTimer = setTimeout(() => card.classList.remove("hidden"), 400);
  g.lastStep = null;
}

function onProgress(ev) {
  const card = $(".graph-progress", g.view);
  if (!card) return;
  const bar = $(".progress", card);
  if (typeof ev.progress === "number") {
    bar.classList.remove("indeterminate");
    const pct = Math.round(ev.progress * 100);
    bar.setAttribute("aria-valuenow", String(pct));
    $("div", bar).style.width = `${pct}%`;
  }
  const steps = $(".graph-steps", card);
  steps.classList.remove("hidden");
  const st = stepStates(ev.step);
  for (const li of $$("li", steps)) {
    const s = li.dataset.step;
    li.dataset.state = st[s];
    if (st[s] === "now") li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    let done = $(".sr-only", li);
    if (st[s] === "done" && !done) li.appendChild(el(`<span class="sr-only">(완료)</span>`));
    if (st[s] !== "done" && done) done.remove();
  }
  const count = countFromMessage(ev.message);
  if (count && ev.step !== "wait") {
    const li = $(`li[data-step="${ev.step}"] .graph-step-msg`, steps);
    if (li) li.textContent = count;
  }
  if (ev.step !== g.lastStep) { // 단계가 바뀔 때만 읽힘
    g.lastStep = ev.step;
    $(".graph-progress-msg", card).textContent = ev.step === "wait" ? "다른 그래프가 끝나기를 기다리는 중이에요" : String(ev.message || "");
  }
}

function hideProgress() {
  clearTimeout(g.progressTimer);
  $(".graph-progress", g.view)?.remove();
  $(".graph-main", g.view).removeAttribute("aria-busy");
  $$("input[name=graph-size]", g.view).forEach((r) => { r.disabled = false; });
}

function cancel() {
  seq++;
  if (g.ctl) g.ctl.abort();
  hideProgress();
  if (g.model) { // 크기 바꾸던 중: 이전 그래프 그대로
    syncSizeRadios();
    return;
  }
  showState("cancelled");
}

function changeSize(size) {
  if (!g.model || size === g.model.size) return;
  g.extra = null;
  const cached = memory.get(`${g.model.seedId}:${size}`);
  if (cached) return showGraph(cached, { first: false });
  build({ seed: { openalex_id: g.model.seedId }, size, resize: true });
}

function syncSizeRadios() {
  const size = g.model ? g.model.size : g.size;
  for (const r of $$("input[name=graph-size]", g.view)) r.checked = Number(r.value) === size;
}

// ------------------------------------------------------------------ 오류 · 빈 상태
function showState(code) {
  hideProgress();
  const [title, text, buttons] = ERR[code] || ERR.internal;
  const stateName = code === "empty" ? "empty" : code === "cancelled" ? "cancelled" : code === "noseed" ? "noseed" : "error";
  setState(stateName);
  const stage = $(".graph-stage", g.view);
  $(".graph-state", g.view)?.remove();
  const q = scholarQuery(g.model && g.model.seed ? g.model.seed.paper : { title: g.seedTitle || (g.seed && g.seed.title) || "", doi: g.seed && g.seed.doi });
  const scholar = q ? scholarUrl(q) : null;
  const btns = [];
  for (const b of buttons) {
    if (b === "scholar" && scholar) btns.push(`<a class="btn" href="${esc(scholar)}" target="_blank" rel="noopener noreferrer" data-scholar-open title="${esc(SCHOLAR_LIBRARY_NOTE)}">${esc(INHA.buttons.scholar)}${EXT_MARK}</a>`);
    if (b === "back") btns.push(`<button type="button" class="btn" data-graph-back>돌아가기</button>`);
    if (b === "retry") btns.push(`<button type="button" class="btn" data-graph-retry>${code === "cancelled" ? "다시 만들기" : "다시 시도"}</button>`);
    if (b === "settings") btns.push(`<button type="button" class="btn" data-graph-settings>설정 열기</button>`);
    if (b === "library") btns.push(`<a class="btn" href="#/library">서재로</a>`);
    if (b === "discover") btns.push(`<a class="btn" href="#/discover">논문 찾기로</a>`);
  }
  const box = el(`<div class="empty graph-state"><h3 tabindex="-1">${esc(title)}</h3><p>${esc(text)}</p>
    <div class="empty-actions">${btns.join("")}</div></div>`);
  const first = $(".empty-actions > *", box);
  if (first) first.classList.add("primary");
  $$("[data-graph-back]", box).forEach((b) => { b.onclick = goBack; });
  const retry = $("[data-graph-retry]", box);
  if (retry) retry.onclick = () => build(g.lastReq || { seed: g.seed, size: g.size });
  const set = $("[data-graph-settings]", box);
  if (set) set.onclick = () => settingsDialog();
  $(".graph-main", g.view).insertBefore(box, stage);
  setTimeout(() => { if (box.isConnected) $("h3", box).focus(); }, 0);
}

// ------------------------------------------------------------------ 그래프 그리기
function showGraph(graph, { first }) {
  const model = toModel(graph);
  g.extra = null;
  g.model = model;
  g.size = model.size;
  syncSizeRadios();
  if (model.seed) setName(model.seed.paper.title || "");
  g.seedTitle = model.seed ? model.seed.paper.title : g.seedTitle;
  history.replaceState({ ...(history.state || {}), graphFrom: g.from, graphSize: model.size }, "", `#/graph/${model.seedId}`);
  if (model.nodes.length < 3) return showState("empty");
  $(".graph-state", g.view)?.remove();
  setState("ready");
  g.hidden = new Set();
  g.pos = layoutGraph(model, window.d3);
  const keep = g.sel && model.byId.has(g.sel) ? g.sel : model.seedId;
  g.sel = keep;
  g.rov = keep;
  drawFoot();
  drawNotices();
  drawStage();
  drawList();
  drawTabs();
  showInfo(keep, { announceIt: false });
  updateJump();
  const warn = model.warnings.length ? ` 알림 ${model.warnings.length}개가 있어요.` : "";
  announce(`논문 ${model.nodes.length}편 그래프를 그렸어요. ‘목록’ 보기로 표를 볼 수 있어요.${warn}`);
  if (first) setTimeout(() => { if (g) $(".graph-title", g.view).focus(); }, 0);
}

function drawFoot() {
  const st = g.model.stats || {};
  $("[data-foot-count]", g.view).textContent = `후보 ${fmt(st.candidates || g.model.nodes.length)}편 중 ${g.model.nodes.length}편`;
  $("[data-foot-src]", g.view).textContent = `OpenAlex 기준 · ${st.built_on || ""}`;
}

function drawNotices() {
  const box = $("[data-graph-notices]", g.view);
  box.innerHTML = "";
  const warnings = [...g.model.warnings];
  if (g.extra) warnings.push({ code: g.extra, message: "" });
  for (const n of groupNotices(warnings)) {
    if (g.hidden.has(n.code)) continue;
    let body;
    if (n.code === "partial") {
      body = `<div><b>일부 정보 없이 그렸어요.</b> 그래프가 덜 정확할 수 있어요.<ul>${n.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
    } else if (n.tone === "info") {
      const parts = [];
      if (n.infos.includes("weak_citation_data")) parts.push("이 논문 주변은 인용 정보가 적어 주제 유사도로 보강했어요. <b>점선</b>은 인용 근거 없이 주제만 비슷한 연결이에요. (국문 논문은 OpenAlex 인용 정보가 적은 편이에요.)");
      if (n.infos.includes("truncated")) parts.push("참고문헌이 많아 앞의 300편만 비교했어요.");
      body = `<div>${parts.join(" ")}</div>`;
    } else if (n.code === "upstream_limited") {
      body = `<div>OpenAlex 하루 사용량을 다 써서 저장돼 있던 정보로만 그렸어요(한국 시간 오전 9시에 초기화). 설정에서 OpenAlex API 키를 넣으면 한도가 10배가 돼요.
        <div><button type="button" class="btn sm" data-graph-settings>설정 열기</button></div></div>`;
    } else {
      body = `<div>논문 수를 바꾸지 못했어요. 이전 그래프를 그대로 보여 드려요.</div>`;
    }
    const node = el(`<div class="notice" data-tone="${n.tone}" data-code="${esc(n.code)}">${n.tone === "info" ? ICON_INFO : ICON_WARN}${body}
      <button type="button" class="icon-btn small" data-notice-close aria-label="알림 닫기">✕</button></div>`);
    $("[data-notice-close]", node).onclick = () => {
      g.hidden.add(n.code);
      if (n.code === "resize_failed") g.extra = null;
      drawNotices();
    };
    const set = $("[data-graph-settings]", node);
    if (set) set.onclick = () => settingsDialog();
    box.appendChild(node);
  }
}

const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

function drawStage() {
  const stage = $(".graph-stage", g.view);
  for (const n of $$(":scope > :not(.graph-progress)", stage)) n.remove();
  const { model, pos } = g;
  const svg = svgEl("svg", { class: "graph-svg", role: "group", "aria-describedby": "graph-keys",
    "aria-label": `인용 그래프, 논문 ${model.nodes.length}편 · 연결 ${model.edges.length}개` });
  const vp = svgEl("g", { class: "graph-viewport" });
  const ge = svgEl("g", { class: "graph-edges" });
  const gn = svgEl("g", { class: "graph-nodes" });
  g.edgeEls = [];
  for (const e of model.edges) {
    const a = pos.get(e.source);
    const b = pos.get(e.target);
    const line = svgEl("line", { class: "g-edge", "data-source": e.source, "data-target": e.target, "data-kind": e.kind,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y, "stroke-width": edgeWidth(e.weight).toFixed(2),
      "stroke-opacity": edgeOpacity(e.weight).toFixed(2) });
    ge.appendChild(line);
    g.edgeEls.push(line);
  }
  g.nodeEls = new Map();
  // 작은 노드 먼저(큰 노드의 이름표가 위에), 씨앗은 맨 위
  const order = [...model.nodes].sort((a, b) => (a.isSeed - b.isSeed) || (a.r - b.r) || a.id.localeCompare(b.id));
  for (const n of order) {
    const p = pos.get(n.id);
    const node = svgEl("g", { class: "g-node", "data-id": n.id, "data-yb": n.yb, role: "button", tabindex: "-1",
      "aria-pressed": "false", transform: `translate(${p.x} ${p.y})` });
    node.classList.toggle("is-seed", n.isSeed);
    node.classList.toggle("show-label", n.showLabel);
    node.appendChild(svgEl("circle", { class: "g-node-hit", r: Math.max(n.r, 12).toFixed(1) }));
    if (n.isSeed) node.appendChild(svgEl("circle", { class: "g-node-seed", r: (n.r + 5).toFixed(1) }));
    node.appendChild(svgEl("circle", { class: "g-node-dot", r: n.r.toFixed(1) }));
    node.appendChild(svgEl("circle", { class: "g-node-focus", r: (n.r + (n.isSeed ? 9 : 5)).toFixed(1) }));
    const label = svgEl("text", { class: "g-node-label", y: (n.r + 13).toFixed(1) });
    label.textContent = n.label;
    node.appendChild(label);
    gn.appendChild(node);
    g.nodeEls.set(n.id, node);
    updateNode(n.id);
  }
  vp.append(ge, gn);
  svg.appendChild(vp);
  g.svg = svg;
  g.vp = vp;
  const zoom = el(`<div class="graph-zoom" role="group" aria-label="확대 · 축소">
    <button type="button" class="icon-btn" data-zoom="in" aria-label="확대" title="확대 (+)">＋</button>
    <button type="button" class="icon-btn" data-zoom="out" aria-label="축소" title="축소 (−)">－</button>
    <button type="button" class="icon-btn" data-zoom="fit" aria-label="화면에 맞추기" title="화면에 맞추기 (0)">${ICON_FIT}</button></div>`);
  $$("[data-zoom]", zoom).forEach((b) => { b.onclick = () => zoomBy(b.dataset.zoom); });
  const legend = el(`<section class="graph-legend" id="graph-legend" aria-labelledby="graph-legend-title"></section>`);
  const jump = el(`<button type="button" class="btn sm graph-jump hidden" data-graph-jump><span></span></button>`);
  jump.onclick = () => {
    const panel = $(".graph-panel", g.view);
    panel.scrollIntoView({ block: "start" });
    const t = $(".graph-paper-title", panel);
    if (t) t.focus();
  };
  const progress = $(".graph-progress", stage);
  stage.insertBefore(svg, progress);
  stage.insertBefore(zoom, progress);
  stage.insertBefore(legend, progress);
  stage.insertBefore(jump, progress);
  drawLegend();
  wireSvg();
  fit();
  if (!g.ro) {
    g.ro = new ResizeObserver(() => onResize());
    g.ro.observe(stage);
  }
  g.mo?.disconnect();
  g.mo = new MutationObserver(() => drawLegend());
  g.mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function updateNode(id) {
  const n = g.model.byId.get(id);
  const node = g.nodeEls && g.nodeEls.get(id);
  if (!n || !node) return;
  node.classList.toggle("is-lib", !!n.inLibrary);
  node.classList.toggle("is-selected", g.sel === id);
  node.setAttribute("aria-pressed", g.sel === id ? "true" : "false");
  node.setAttribute("tabindex", g.rov === id ? "0" : "-1");
  node.setAttribute("aria-label", nodeAriaLabel(n));
  const badge = $(".g-node-lib", node);
  if (n.inLibrary && !badge) {
    const gb = svgEl("g", { class: "g-node-lib", transform: `translate(${(0.72 * n.r).toFixed(1)} ${(-0.72 * n.r).toFixed(1)})` });
    gb.append(svgEl("circle", { r: 5.5 }), svgEl("path", { d: "M-2.4 0.1 -0.7 1.8 2.5-1.7" }));
    node.insertBefore(gb, $(".g-node-label", node));
  } else if (!n.inLibrary && badge) badge.remove();
}

function drawLegend() {
  const box = $("#graph-legend", g.view);
  if (!box || !g.model) return;
  const m = g.model;
  const dark = document.documentElement.dataset.theme === "dark";
  const ramp = yearRamp(m.yearScale);
  box.innerHTML = `<div class="graph-legend-head"><span id="graph-legend-title">범례</span>
      <button type="button" class="icon-btn small" data-legend-close aria-label="범례 닫기">✕</button></div>
    <ul class="graph-legend-items">
      <li><svg width="40" height="24" viewBox="-20 -12 40 24" aria-hidden="true"><circle class="g-node-dot" cx="-14" cy="6" r="4"/><circle class="g-node-dot" cx="-4" cy="3" r="7"/><circle class="g-node-dot" cx="10" cy="0" r="10"/></svg>
        <span><b>크기</b> 피인용 수(로그 척도, 최대 ${esc(fmt(m.cMax))}회)</span></li>
      <li class="g-legend-ramp"><span><b>색</b> 출판 연도 · ${dark ? "밝을수록" : "진할수록"} 최근</span>
        <ol class="g-ramp" aria-label="연도 구간" style="--g-bins:${ramp.length || 1}">
          ${ramp.map((b) => `<li title="${esc(b.title)}"><span class="g-swatch" data-yb="${b.yb}"></span>${esc(b.label)}</li>`).join("")}
          ${m.hasNoYear ? `<li class="g-ramp-none"><span class="g-swatch" data-yb="none"></span>없음</li>` : ""}
        </ol></li>
      <li><svg width="40" height="16" viewBox="0 0 40 16" aria-hidden="true"><line class="g-edge" x1="2" y1="4" x2="38" y2="4" stroke-width="1.2" stroke-opacity=".6"/><line class="g-edge" x1="2" y1="12" x2="38" y2="12" stroke-width="4" stroke-opacity=".85"/></svg>
        <span><b>선</b> 굵을수록 더 비슷(함께 인용 · 같은 문헌 인용)</span></li>
      ${m.hasRelated ? `<li><svg width="40" height="8" viewBox="0 0 40 8" aria-hidden="true"><line class="g-edge" data-kind="related" x1="2" y1="4" x2="38" y2="4" stroke-width="2" stroke-opacity=".85"/></svg>
        <span><b>점선</b> 주제만 비슷(인용 근거 없음)</span></li>` : ""}
      <li class="g-legend-pair">
        <span><svg width="24" height="24" viewBox="-12 -12 24 24" aria-hidden="true"><circle class="g-node-seed" r="10"/><circle class="g-node-dot" r="5.5"/></svg><b>씨앗 논문</b></span>
        <span><svg width="24" height="24" viewBox="-12 -12 24 24" aria-hidden="true"><circle class="g-node-dot" r="7"/><g class="g-node-lib" transform="translate(5 -5)"><circle r="5.5"/><path d="M-2.4 0.1 -0.7 1.8 2.5-1.7"/></g></svg><b>서재에 있음</b></span></li>
    </ul>
    <p class="graph-legend-note">후보 ${esc(fmt((m.stats && m.stats.candidates) || m.nodes.length))}편을 비교해 고른 그래프예요(전체 문헌을 다 본 것은 아니에요).</p>`;
  $("[data-legend-close]", box).onclick = () => {
    toggleLegend(false);
    $("[data-graph-legend]", g.view).focus();
  };
  toggleLegend(g.legendOpen, { save: false });
}

function toggleLegend(open, { save = true } = {}) {
  g.legendOpen = open;
  const box = $("#graph-legend", g.view);
  if (box) box.classList.toggle("hidden", !open);
  $("[data-graph-legend]", g.view).setAttribute("aria-expanded", open ? "true" : "false");
  if (save) saveLegend(open);
}

// ------------------------------------------------------------------ 확대 · 이동
function stageSize() {
  const s = $(".graph-stage", g.view);
  return { w: s.clientWidth, h: s.clientHeight };
}

function points() {
  return g.model.nodes.map((n) => ({ ...g.pos.get(n.id), r: n.r }));
}

function applyT() {
  const { k, x, y } = g.t;
  g.vp.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${k.toFixed(4)})`);
}

function fit() {
  const { w, h } = stageSize();
  g.needsFit = !w || !h; // 목록 보기 등으로 그림 칸이 숨어 있으면 보일 때 맞춤
  g.base = fitTransform(points(), w, h, 24);
  g.t = { ...g.base };
  g.lastSize = { w, h };
  applyT();
}

function zoomBy(kind) {
  if (!g.t) return;
  if (kind === "fit") return fit();
  const { w, h } = stageSize();
  g.t = zoomAt(g.t, kind === "in" ? 1.25 : 1 / 1.25, w / 2, h / 2, g.base.k * 0.4, g.base.k * 4);
  applyT();
}

function onResize() {
  if (!g || !g.t || g.view.dataset.graphState !== "ready") return;
  const { w, h } = stageSize();
  if (!w || !h) return;
  if (g.needsFit) return fit();
  if (!g.lastSize) g.lastSize = { w, h };
  // 지금 배율은 그대로, 가운데만 맞춤
  g.t.x += (w - g.lastSize.w) / 2;
  g.t.y += (h - g.lastSize.h) / 2;
  g.lastSize = { w, h };
  g.base = fitTransform(points(), w, h, 24);
  applyT();
}

function ensureVisible(id) {
  const p = g.pos.get(id);
  const n = g.model.byId.get(id);
  if (!p || !n) return;
  const { w, h } = stageSize();
  const sx = p.x * g.t.k + g.t.x;
  const sy = p.y * g.t.k + g.t.y;
  const r = n.r * g.t.k + 8;
  if (sx - r < 0 || sy - r < 0 || sx + r > w || sy + r > h) {
    g.t = { ...g.t, x: w / 2 - p.x * g.t.k, y: h / 2 - p.y * g.t.k };
    applyT();
  }
}

function wireSvg() {
  const svg = g.svg;
  const ptrs = new Map();
  let drag = null;
  let pinch = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { svg.setPointerCapture(e.pointerId); } catch { /* 이미 끝난 포인터 */ }
    if (ptrs.size === 1) {
      drag = { x: e.clientX, y: e.clientY, t: { ...g.t }, moved: false, node: e.target.closest(".g-node") };
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), t: { ...g.t } };
      drag = null;
    }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const rect = svg.getBoundingClientRect();
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2 - rect.left;
      const my = (a.y + b.y) / 2 - rect.top;
      g.t = zoomAt(pinch.t, d / (pinch.d || 1), mx, my, g.base.k * 0.4, g.base.k * 4);
      applyT();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    svg.classList.add("is-panning");
    g.t = { ...drag.t, x: drag.t.x + dx, y: drag.t.y + dy };
    applyT();
  });
  const end = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (drag && ptrs.size === 0) {
      svg.classList.remove("is-panning");
      if (!drag.moved && e.type === "pointerup") {
        if (drag.node) {
          const id = drag.node.dataset.id;
          select(id);
          setRoving(id);
          drag.node.focus({ preventScroll: true });
          if (e.pointerType !== "mouse") highlight(id);
        } else {
          unhighlight();
        }
      }
      drag = null;
    }
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    g.t = zoomAt(g.t, e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top, g.base.k * 0.4, g.base.k * 4);
    applyT();
  }, { passive: false });
  svg.addEventListener("pointerover", (e) => {
    const n = e.target.closest(".g-node");
    if (n && e.pointerType === "mouse") highlight(n.dataset.id);
  });
  svg.addEventListener("pointerout", (e) => {
    const n = e.target.closest(".g-node");
    if (n && e.pointerType === "mouse" && !(e.relatedTarget && n.contains(e.relatedTarget))) {
      const f = document.activeElement && document.activeElement.closest && document.activeElement.closest(".g-node");
      if (f && svg.contains(f)) highlight(f.dataset.id); else unhighlight();
    }
  });
  svg.addEventListener("focusin", (e) => {
    const n = e.target.closest(".g-node");
    if (n) highlight(n.dataset.id);
  });
  svg.addEventListener("focusout", (e) => {
    if (!g) return;
    if (!e.relatedTarget || !svg.contains(e.relatedTarget)) unhighlight();
  });
  svg.addEventListener("keydown", onSvgKey);
}

function onSvgKey(e) {
  const cur = e.target.closest && e.target.closest(".g-node");
  const k = e.key;
  if (k === "+" || k === "=") { e.preventDefault(); return zoomBy("in"); }
  if (k === "-" || k === "_") { e.preventDefault(); return zoomBy("out"); }
  if (k === "0") { e.preventDefault(); return zoomBy("fit"); }
  if (!cur) return;
  const id = cur.dataset.id;
  if (k.startsWith("Arrow")) {
    e.preventDefault();
    const next = nearestInDirection(g.pos, id, k);
    if (next) focusNode(next);
  } else if (k === "Home") {
    e.preventDefault();
    focusNode(g.model.seedId);
  } else if (k === "Enter" || k === " ") {
    e.preventDefault();
    select(id);
  } else if (k === "Escape") {
    unhighlight();
  }
}

function setRoving(id) {
  const prev = g.rov;
  g.rov = id;
  if (prev && prev !== id) updateNode(prev);
  updateNode(id);
}

function focusNode(id) {
  setRoving(id);
  ensureVisible(id);
  const n = g.nodeEls.get(id);
  if (n) n.focus({ preventScroll: true });
}

function highlight(id) {
  if (!g || !g.svg) return; // 화면을 닫는 중(포커스가 빠지며 불림)
  const near = new Set([id, ...(g.model.nbrs.get(id) || [])]);
  g.svg.classList.add("is-dimming");
  for (const [nid, node] of g.nodeEls) node.classList.toggle("is-near", near.has(nid));
  for (const line of g.edgeEls) {
    line.classList.toggle("is-near", line.dataset.source === id || line.dataset.target === id);
  }
}

function unhighlight() {
  if (!g || !g.svg) return; // 화면을 닫는 중(포커스가 빠지며 불림)
  g.svg.classList.remove("is-dimming");
  for (const node of g.nodeEls.values()) node.classList.remove("is-near");
  for (const line of g.edgeEls) line.classList.remove("is-near");
}

// ------------------------------------------------------------------ 고르기 · 패널
function select(id, { announceIt = true } = {}) {
  if (!g.model.byId.has(id)) return;
  const prev = g.sel;
  g.sel = id;
  if (prev && prev !== id) updateNode(prev);
  updateNode(id);
  for (const tr of $$(".graph-table tr[data-id]", g.view)) {
    const on = tr.dataset.id === id;
    tr.classList.toggle("is-selected", on);
    const b = $(".graph-row-btn", tr);
    if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
  }
  showInfo(id, { announceIt });
  updateJump();
}

function updateJump() {
  const jump = $("[data-graph-jump]", g.view);
  if (!jump || !g.model) return;
  const n = g.model.byId.get(g.sel);
  const show = matchMedia(NARROW).matches && n && g.mode === "graph";
  jump.classList.toggle("hidden", !show);
  if (n) $("span", jump).textContent = "선택: " + n.label + " · 정보 보기 ↓";
}

function wireTabs() {
  const tabs = $$("[data-graph-tab]", g.view);
  for (const t of tabs) {
    t.onclick = () => openTab(t.dataset.graphTab);
    t.onkeydown = (e) => {
      const i = tabs.indexOf(t);
      let j = null;
      if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
      if (e.key === "ArrowLeft") j = (i + tabs.length - 1) % tabs.length;
      if (e.key === "Home") j = 0;
      if (e.key === "End") j = tabs.length - 1;
      if (j === null) return;
      e.preventDefault();
      openTab(tabs[j].dataset.graphTab);
      tabs[j].focus();
    };
  }
}

function drawTabs() {
  $("#graph-tab-prior .graph-tab-n", g.view).textContent = String(g.model.prior.length);
  $("#graph-tab-derivative .graph-tab-n", g.view).textContent = String(g.model.derivative.length);
}

function openTab(name, { focusItem = null } = {}) {
  g.tab = name;
  for (const t of $$("[data-graph-tab]", g.view)) {
    const on = t.dataset.graphTab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
  }
  const body = $("#graph-tabpanel", g.view);
  body.setAttribute("aria-labelledby", `graph-tab-${name}`);
  if (name === "info") return renderInfo();
  renderWorks(name, focusItem);
}

// item: {kind: "node" | "prior" | "derivative", id}
function showInfo(id, { announceIt = true } = {}) {
  g.panelItem = { kind: "node", id };
  openTab("info");
  if (announceIt) {
    const n = g.model.byId.get(id);
    announce(((n && n.paper.title) || "논문") + "을 골랐어요.");
  }
}

function currentEntry() {
  const it = g.panelItem;
  if (!it) return null;
  if (it.kind === "node") {
    const n = g.model.byId.get(it.id);
    return n ? { kind: "node", id: n.id, paper: n.paper, node: n, inLibrary: n.inLibrary } : null;
  }
  const list = it.kind === "prior" ? g.model.prior : g.model.derivative;
  const x = list.find((w) => w.id === it.id);
  return x ? { kind: it.kind, id: x.id, paper: x.paper, item: x, inLibrary: x.in_library } : null;
}

function authorsLine(p) {
  const list = (p.authors || []);
  const total = Math.max(p.author_count || 0, list.length);
  if (!list.length) return "저자 미상";
  const shown = authorsShort(list.slice(0, 3), 3);
  return total > 3 ? `${shown} 외 ${total - 3}명` : shown;
}

function renderInfo() {
  const body = $("#graph-tabpanel", g.view);
  const ent = currentEntry();
  body.innerHTML = "";
  if (!ent) return;
  const p = ent.paper;
  const n = ent.node;
  const isSeed = n && n.isSeed;
  const chips = [];
  if (isSeed) chips.push(`<span class="chip accent">씨앗 논문</span>`);
  if (n) for (const r of n.relation) if (REL_TEXT[r]) chips.push(`<span class="chip">${esc(REL_TEXT[r])}</span>`);
  if (ent.kind === "prior") chips.push(`<span class="chip">이전 연구 · 그래프 논문 ${ent.item.count}편이 인용</span>`);
  if (ent.kind === "derivative") chips.push(`<span class="chip">이후 연구 · 그래프 논문 ${ent.item.count}편을 인용</span>`);
  if (ent.inLibrary) chips.push(`<span class="chip success">✓ 서재에 있음</span>`);
  const url = safeUrl(p.url);
  const proxy = paperProxyTarget(p);
  const sq = scholarQuery(p);
  const scholar = sq ? scholarUrl(sq) : null;
  const seedEdge = n && !isSeed ? edgeBetween(n.id, g.model.seedId, g.model.edges) : null;
  const venue = [p.venue, Number.isInteger(p.year) ? p.year : ""].filter(Boolean).join(" · ");
  const back = ent.kind !== "node" ? `<button type="button" class="btn sm ghost graph-list-back" data-graph-back-list>← ${ent.kind === "prior" ? "이전" : "이후"} 연구 목록</button>` : "";
  const box = el(`<div class="graph-paper">
    ${back}
    ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
    <h2 class="graph-paper-title" tabindex="-1">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(p.title || "제목 없음")}${EXT_MARK}</a>` : esc(p.title || "제목 없음")}</h2>
    <div class="graph-paper-authors">${esc(authorsLine(p))}</div>
    ${venue ? `<div class="graph-paper-venue">${esc(venue)}</div>` : ""}
    <div class="actions" data-actions></div>
    <dl class="kv">
      <dt>피인용</dt><dd>${esc(fmt(p.cited_by_count || 0))}회</dd>
      ${n && !isSeed ? `<dt>씨앗과</dt><dd>${esc(seedRelationText(seedEdge))}</dd>` : ""}
      ${p.doi ? `<dt>DOI</dt><dd><a href="${esc("https://doi.org/" + p.doi)}" target="_blank" rel="noopener">${esc(p.doi)}</a></dd>` : ""}
    </dl>
    <div class="section-title">초록</div>
    ${p.abstract ? `<div class="abstract clamp" id="graph-abs">${esc(p.abstract)}</div>
      <button type="button" class="btn sm ghost graph-abs-toggle hidden" aria-expanded="false" aria-controls="graph-abs">펼치기</button>`
      : `<p class="small muted">초록이 없어요.</p>`}
  </div>`);
  const actions = $("[data-actions]", box);
  drawActions(actions, ent, { proxy, scholar, isSeed });
  const backBtn = $("[data-graph-back-list]", box);
  if (backBtn) backBtn.onclick = () => openTab(ent.kind, { focusItem: ent.id });
  if (n) {
    const near = closest(n.id, g.model.edges, 5);
    if (near.length) {
      box.appendChild(el(`<div class="section-title">가장 가까운 논문</div>`));
      const ol = el(`<ol class="graph-items"></ol>`);
      for (const { id } of near) {
        const m = g.model.byId.get(id);
        if (!m) continue;
        const li = itemEl(id, m.paper, { libId: m.inLibrary });
        $(".graph-item-btn", li).onclick = () => { select(id); if (g.mode === "graph") focusNode(id); };
        ol.appendChild(li);
      }
      box.appendChild(ol);
    }
  }
  body.appendChild(box);
  const abs = $("#graph-abs", box);
  const tog = $(".graph-abs-toggle", box);
  if (abs && tog) {
    requestAnimationFrame(() => {
      if (abs.scrollHeight > abs.clientHeight + 2) tog.classList.remove("hidden");
    });
    tog.onclick = () => {
      const open = abs.classList.toggle("clamp") === false;
      tog.setAttribute("aria-expanded", open ? "true" : "false");
      tog.textContent = open ? "접기" : "펼치기";
    };
  }
}

function drawActions(box, ent, { proxy, scholar, isSeed }) {
  const p = ent.paper;
  box.innerHTML = "";
  if (ent.inLibrary) {
    const b = el(`<button type="button" class="btn sm in-lib" data-graph-openlib>✓ 서재에 있음 · 열기</button>`);
    b.onclick = () => {
      state.activeId = ent.inLibrary;
      state.filter = { kind: "all", id: null };
      state.q = "";
      location.hash = "#/library";
    };
    box.appendChild(b);
  } else {
    const add = el(`<button type="button" class="btn sm primary" data-graph-add>＋ 서재에 추가</button>`);
    add.onclick = () => doAdd(ent, false, add);
    box.appendChild(add);
    if (safeUrl(p.pdf_url)) {
      const addPdf = el(`<button type="button" class="btn sm" data-graph-addpdf>PDF 포함 추가</button>`);
      addPdf.onclick = () => doAdd(ent, true, addPdf);
      box.appendChild(addPdf);
    }
  }
  const cite = el(`<button type="button" class="btn sm" data-graph-cite>인용</button>`);
  cite.onclick = () => citeDialog(p);
  box.appendChild(cite);
  if (proxy) {
    const a = el(`<a class="btn sm" href="${esc(proxy)}" target="_blank" rel="noopener noreferrer" data-inha-open title="${esc(INHA_OPEN_TITLE)}">${esc(INHA.buttons.view)}${EXT_MARK}</a>`);
    bindExtLink(a);
    box.appendChild(a);
  }
  if (scholar) {
    box.appendChild(el(`<a class="btn sm" href="${esc(scholar)}" target="_blank" rel="noopener noreferrer" data-scholar-open title="${esc(SCHOLAR_LIBRARY_NOTE)}">${esc(INHA.buttons.scholar)}${EXT_MARK}</a>`));
  }
  if (!isSeed && p.openalex_id) {
    const re = el(`<button type="button" class="btn sm" data-graph-reseed>${ICON_GRAPH}이 논문으로 새 그래프</button>`);
    re.onclick = () => openGraph(seedFromResult(p), { title: p.title || "", size: g.model.size });
    box.appendChild(re);
  }
}

async function doAdd(ent, withPdf, btn) {
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${withPdf ? "PDF 받는 중" : "추가 중"}`;
  const view = g && g.view;
  const r = await addPaper(ent.paper, { downloadPdf: withPdf });
  if (!g || g.view !== view) return;
  if (!r) {
    btn.disabled = false;
    btn.textContent = withPdf ? "PDF 포함 추가" : "＋ 서재에 추가";
    return;
  }
  setLibrary(ent.id, r.id);
  announce("서재에 추가했어요");
}

// 서재 추가 뒤: 노드 배지 · 이름 · 목록 칩 · 이전/이후 연구 항목을 모두 갱신
function setLibrary(id, libId) {
  const n = g.model.byId.get(id);
  if (n) { n.inLibrary = libId; updateNode(id); }
  for (const x of [...g.model.prior, ...g.model.derivative]) if (x.id === id) x.in_library = libId;
  for (const graph of memory.values()) { // 크기를 바꾸거나 뒤로 와도 서재 표시가 남게
    for (const x of [...graph.nodes, ...graph.prior, ...graph.derivative]) if (x.id === id) x.in_library = libId;
  }
  drawList();
  if (g.tab === "info") renderInfo(); else renderWorks(g.tab);
}

function itemEl(id, paper, { count = null, kind = "", inGraph = false, libId = null } = {}) {
  const fam = ((paper.authors || [])[0] || {}).family || "";
  const sub = [fam ? `${fam} 외` : "", Number.isInteger(paper.year) ? paper.year : "", `피인용 ${fmt(paper.cited_by_count || 0)}`]
    .filter(Boolean).join(" · ");
  const meta = [];
  if (count != null) meta.push(`<span class="graph-count">그래프 논문 ${count}편${kind === "prior" ? "이 인용" : "을 인용"}</span>`);
  if (inGraph) meta.push(`<span class="chip accent">그래프에 있음</span>`);
  if (libId) meta.push(`<span class="chip success">✓ 서재에 있음</span>`);
  const cur = g.panelItem && g.panelItem.id === id;
  return el(`<li class="graph-item"><button type="button" class="graph-item-btn" data-graph-pick="${esc(id)}" ${cur ? `aria-current="true"` : ""}>
      <span class="graph-item-title">${esc(paper.title || "제목 없음")}</span><span class="graph-item-sub">${esc(sub)}</span></button>
    ${meta.length ? `<div class="graph-item-meta">${meta.join("")}</div>` : ""}</li>`);
}

function renderWorks(kind, focusItem = null) {
  const body = $("#graph-tabpanel", g.view);
  body.innerHTML = "";
  const list = kind === "prior" ? g.model.prior : g.model.derivative;
  body.appendChild(el(kind === "prior"
    ? `<p class="graph-intro">그래프 논문들이 <b>공통으로 많이 인용한</b> 논문이에요. 이 분야의 기초 · 대표 문헌일 수 있어요.</p>`
    : `<p class="graph-intro">그래프 논문들을 <b>공통으로 많이 인용하는</b> 논문이에요. 최근 연구나 리뷰일 수 있어요.</p>`));
  if (!list.length) {
    body.appendChild(el(`<p class="small muted">${kind === "prior" ? "그래프 논문 2편 이상이 함께 인용한 논문이 없어요." : "그래프 논문 2편 이상을 함께 인용한 논문이 없어요."}</p>`));
    return;
  }
  const ol = el(`<ol class="graph-items"></ol>`);
  for (const x of list) {
    const inGraph = x.in_graph && g.model.byId.has(x.id);
    const li = itemEl(x.id, x.paper, { count: x.count, kind, inGraph, libId: x.in_library });
    $(".graph-item-btn", li).onclick = () => {
      if (inGraph) {
        select(x.id);
        if (g.mode === "graph") focusNode(x.id);
      } else {
        // 그래프 밖 논문: 고름은 풀고 논문 정보 탭에
        const prev = g.sel;
        g.sel = null;
        if (prev) updateNode(prev);
        g.panelItem = { kind, id: x.id };
        openTab("info");
        const t = $(".graph-paper-title", g.view);
        if (t) t.focus();
      }
    };
    ol.appendChild(li);
  }
  body.appendChild(ol);
  if (focusItem) {
    const b = $(`[data-graph-pick="${CSS.escape(focusItem)}"]`, body);
    if (b) b.focus();
  }
}

// ------------------------------------------------------------------ 목록 보기 (표)
function drawList() {
  const box = $(".graph-list", g.view);
  if (!g.model) return;
  const { key, dir } = g.sort;
  const rows = sortRows(g.model.nodes, key, dir);
  const caption = sortCaption(key, dir, g.model.nodes.length);
  const th = (k, name, cls = "") => {
    const on = k === key;
    return `<th scope="col" class="${cls}" ${on ? `aria-sort="${dir === "asc" ? "ascending" : "descending"}"` : ""}><button type="button" class="graph-sort" data-sort="${k}">${name}${on ? ` <span aria-hidden="true">${dir === "asc" ? "▲" : "▼"}</span>` : ""}</button></th>`;
  };
  box.innerHTML = "";
  const table = el(`<table class="graph-table"><caption>${esc(caption)}</caption>
    <thead><tr>${th("title", "제목")}${th("year", "연도", "num")}${th("cited", "피인용", "num")}${th("score", "유사도", "num")}<th scope="col" class="col-rel">관계</th></tr></thead>
    <tbody></tbody></table>`);
  const tb = $("tbody", table);
  for (const n of rows) {
    const p = n.paper;
    const sel = g.sel === n.id;
    const fam = ((p.authors || [])[0] || {}).family || "";
    const sub = [fam ? `${fam} 외` : "", p.venue].filter(Boolean).join(" · ");
    const score = n.score == null ? "—" : n.score.toFixed(2);
    const pct = n.score == null ? 0 : Math.round(Math.min(1, n.score) * 100);
    const tr = el(`<table><tbody><tr data-id="${esc(n.id)}" class="${sel ? "is-selected" : ""}">
      <td><button type="button" class="graph-row-btn" data-graph-pick="${esc(n.id)}" ${sel ? `aria-current="true"` : ""}>${esc(p.title || "제목 없음")}</button>
        ${sub ? `<div class="graph-row-sub">${esc(sub)}</div>` : ""}
        ${n.isSeed ? `<span class="chip accent">씨앗</span>` : ""}${n.inLibrary ? `<span class="chip success">✓ 서재에 있음</span>` : ""}</td>
      <td class="num"><span class="g-swatch" data-yb="${n.yb}" aria-hidden="true"></span> ${Number.isInteger(p.year) ? p.year : "—"}</td>
      <td class="num">${esc(fmt(p.cited_by_count || 0))}</td>
      <td class="num">${n.score == null ? "" : `<span class="graph-sim" aria-hidden="true"><span style="width:${pct}%"></span></span>`}${score}</td>
      <td class="col-rel">${esc(n.isSeed ? "씨앗" : relationText(n.relation))}</td></tr></tbody></table>`).querySelector("tr");
    $(".graph-row-btn", tr).onclick = () => select(n.id);
    tb.appendChild(tr);
  }
  $$(".graph-sort", table).forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.sort;
      if (g.sort.key === k) g.sort.dir = g.sort.dir === "asc" ? "desc" : "asc";
      else g.sort = { key: k, dir: k === "title" ? "asc" : "desc" };
      drawList();
      announce(sortCaption(g.sort.key, g.sort.dir, g.model.nodes.length));
      const again = $(`.graph-sort[data-sort="${k}"]`, g.view);
      if (again) again.focus();
    };
  });
  box.appendChild(table);
}

function setMode(mode) {
  g.mode = mode;
  g.view.dataset.graphMode = mode;
  const lb = $("[data-graph-legend]", g.view);
  lb.disabled = mode === "list";
  updateJump();
  if (mode === "graph" && g.sel && g.nodeEls) {
    onResize();
    focusNode(g.sel);
  }
}
