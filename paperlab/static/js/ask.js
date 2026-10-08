// AI 질문 #/ask (3단계 — docs/specs/phase3-rag-verify-search.md 5 · 11 · 13장, 시안 docs/design/phase3-ask-ui.md)
// [내 서재에 묻기] 범위(서재 전체 · 컬렉션 · 폴더) 질문 — 출처 번호 → 읽기 화면 그 쪽 · 위치
// [논문 찾기 (AI로 찾기)] OpenAlex · Semantic Scholar → 출처 번호 달린 한국어 요약 + 결과 카드
// 질문 · 답 · 제목은 모두 esc() · textContent로만, 질문은 주소(hash)에 넣지 않는다(AC-L03).

import { api, streamEvents } from "./api.js";
import {
  ICON_CLOCK, ICON_INFO, ICON_WARN, cancelJob, errorLabel, jobLine, jobState, retryJob, setStatusLine, statusLineEl,
  watchJob,
} from "./jobs.js";
import { state } from "./state.js";
import { $, $$, confirmDialog, el, errorToast, esc, renderMarkdown, toast } from "./ui.js";

// ------------------------------------------------------------------ 순수 함수 (tests/js/ask.test.mjs)
// #/ask · #/ask/c12 · #/ask/f3 · #/ask/find · #/ask/find/j55
export function parseAskHash(hash) {
  const m = String(hash || "").match(/^#\/ask(?:\/(?:(c|f)([1-9]\d{0,14})|(find)(?:\/j([1-9]\d{0,15}))?))?\/?$/);
  if (!m) return { tab: "library", scope: "library", job: null };
  if (m[3]) return { tab: "find", scope: null, job: m[4] ? Number(m[4]) : null };
  return { tab: "library", scope: m[1] ? `${m[1]}${m[2]}` : "library", job: null };
}
export const scopeHash = (scope) => (scope && scope !== "library" ? `#/ask/${scope}` : "#/ask");
// 사이드바에서 컬렉션 · 폴더를 고른 상태면 그 범위 (시안 2.2절)
export function scopeFromFilter(filter) {
  if (filter && filter.kind === "collection" && filter.id) return `c${filter.id}`;
  if (filter && filter.kind === "folder" && filter.id) return `f${filter.id}`;
  return "library";
}

// 색인 상태 (시안 3.2절) → { state: ok|indexing|pending|failed, text, html }
export function indexState(index, job) {
  const active = job && (job.status === "queued" || job.status === "running");
  const noText = index.no_text ? ` · ${index.no_text}편은 본문이 없어 빠져요(스캔본)` : "";
  if (active) {
    const msg = ((job.progress || {}).message || "").match(/(\d+)\/(\d+)/);
    return { state: "indexing", text: `${index.with_pdf}편 중 ${index.indexed}편 색인됨 · ${index.pending}편 색인 중${msg ? ` (${msg[1]}/${msg[2]})` : ""}` };
  }
  if (index.pending && job && job.status === "failed") {
    return { state: "failed", text: `색인하지 못한 논문이 있어요 (${errorLabel(job.error_code)})` };
  }
  if (index.pending) return { state: "pending", text: `${index.pending}편이 아직 색인되지 않았어요` };
  return { state: "ok", text: `이 범위 ${index.indexed}편 모두 색인됨${noText}` };
}

export const FIND_STEPS = [["queries", "검색어 만들기"], ["search", "검색"], ["pick", "관련 논문 고르기"], ["summary", "한국어 요약 쓰기"]];
// AI로 찾기 단계 (시안 5.1절) → [{step, name, state: done|now|"" , note}]
export function findSteps(job) {
  const p = job.progress || {};
  const c = p.counts || {};
  const done = job.status === "succeeded";
  let cur = FIND_STEPS.findIndex(([k]) => k === p.step);
  if (cur < 0) cur = 0;
  const notes = { queries: c.queries ? `${c.queries}개` : "", search: c.candidates != null ? `OpenAlex · Semantic Scholar ${c.candidates}편` : "",
    pick: c.picked != null ? `${c.picked}편` : "" };
  return FIND_STEPS.map(([k, name], i) => ({
    step: k, name, note: done || i < cur ? notes[k] || "" : "",
    state: done || i < cur ? "done" : i === cur && (job.status === "queued" || job.status === "running") ? "now" : "",
  }));
}

export const FIND_WARN = {
  openalex_failed: "OpenAlex 검색이 응답하지 않아 Semantic Scholar 결과로만 골랐어요.",
  s2_failed: "Semantic Scholar 검색이 응답하지 않아 OpenAlex 결과로만 골랐어요.",
  partial: "45초 안에 다 받지 못해 받은 결과로만 골랐어요.",
};
export const FIND_FAIL = {
  search_failed: "검색 결과를 받지 못했어요. 잠시 후 다시 시도해 주세요.",
  bad_output: "요약을 제대로 만들지 못했어요(출처 번호 · 한국어 검사). 다시 시도해 주세요.",
};

// 인용 검증 표시 (시안 6장 — writing.js가 씀). 판정 이름은 모양(CSS .vd) + 글자
const VD = { supported: ["근거 있음", "직접 인용 일치"], weak: ["근거 약함", "직접 인용 다름"],
  unsupported: ["근거 없음", "직접 인용 불일치"], unchecked: ["확인 못 함", "확인 못 함"], pending: ["확인 중", "확인 중"] };
export const VD_ORDER = ["unsupported", "weak", "unchecked", "pending", "supported"];
export const vdName = (it) => (VD[it.verdict] || VD.unchecked)[it.method === "quote" ? 1 : 0];
// 목록 순서: 근거 없음 → 약함 → 확인 못 함 → 확인 중 → 근거 있음, 같은 판정 안은 원고 순서 (6.2절)
export function sortVerify(items) {
  return items.map((it, i) => ({ ...it, i })).sort((a, b) => VD_ORDER.indexOf(a.verdict) - VD_ORDER.indexOf(b.verdict) || a.i - b.i);
}
// 미리보기에 표시할 인용(marker_index → 가장 나쁜 판정): 약함 · 근거 없음만 (AD-2 · AD-7)
export function verifyMarks(items) {
  const marks = new Map();
  items.forEach((it, i) => {
    if (it.verdict !== "weak" && it.verdict !== "unsupported") return;
    const cur = marks.get(it.marker_index);
    if (!cur || (cur.verdict === "weak" && it.verdict === "unsupported")) {
      marks.set(it.marker_index, { verdict: it.verdict, name: vdName(it), reason: it.reason || "", i });
    }
  });
  return marks;
}
// 1100px 이하 상태 줄 요약 (AD-4) · 끝 알림 (6.4절)
export function verifySummary(counts = {}) {
  const parts = [counts.unsupported ? `✕ ${counts.unsupported}` : "", counts.weak ? `◐ ${counts.weak}` : ""].filter(Boolean);
  return parts.length ? `인용 검증: ${parts.join(" · ")} — 미리보기에 표시했어요` : "";
}
export function verifyDoneText(counts = {}) {
  return `인용 검증을 마쳤어요. 근거 없음 ${counts.unsupported || 0}개, 약함 ${counts.weak || 0}개`;
}

// ------------------------------------------------------------------ 화면
const SUGGEST = ["이 논문들의 공통 연구 방법은?", "결론이 서로 다른 논문이 있어?", "가장 많이 쓴 측정 도구는?"];
const ACTIVE = (j) => j && (j.status === "queued" || j.status === "running");
let A = null; // 지금 화면 { view, tab, scope, … }

export function closeAsk() {
  if (!A) return;
  A.abort && A.abort.abort();
  clearTimeout(A.poll);
  for (const stop of A.stops) stop();
  A = null;
}

export function renderAsk(main) {
  const h = parseAskHash(location.hash);
  if (A && A.view.isConnected) return applyHash(h); // 범위 · 탭만 바뀜: 그리던 대화 · 스트림은 그대로
  closeAsk();
  main.innerHTML = "";
  const view = el(`<section class="view ask" aria-labelledby="ask-h">
    <div class="discover-head">
      <h1 id="ask-h">AI 질문</h1>
      <div class="sub">내 서재 논문의 원문이나 공개 학술 DB를 근거로, 출처 번호가 붙은 답을 받아요.</div>
      <div class="tabs" role="tablist" aria-label="질문 방식">
        <button type="button" role="tab" id="ask-tab-library" aria-controls="ask-pane-library" data-tab="library">내 서재에 묻기</button>
        <button type="button" role="tab" id="ask-tab-find" aria-controls="ask-pane-find" data-tab="find">논문 찾기 (AI로 찾기)</button>
      </div>
    </div>
    <div class="ask-pane" role="tabpanel" id="ask-pane-library" data-ask-pane="library" aria-labelledby="ask-tab-library"></div>
    <div class="ask-pane hidden" role="tabpanel" id="ask-pane-find" data-ask-pane="find" aria-labelledby="ask-tab-find"></div>
    <div class="sr-only" role="status" data-ask-live></div></section>`);
  main.appendChild(view);
  A = { view, tab: null, scope: null, stops: [], poll: null, abort: null, sending: false, findJob: null };
  const tabs = $$("[role=tab]", view);
  tabs.forEach((b, i) => {
    b.onclick = () => go(b.dataset.tab);
    b.onkeydown = (e) => {
      const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (k === undefined) return;
      e.preventDefault();
      const t = tabs[(k + tabs.length) % tabs.length];
      t.focus();
      go(t.dataset.tab);
    };
  });
  drawLibraryPane();
  drawFindPane();
  applyHash(h);
}

function go(tab) {
  location.hash = tab === "find" ? "#/ask/find" : scopeHash(A.scope || scopeFromFilter(state.filter));
}

function say(text) {
  const live = A && $("[data-ask-live]", A.view);
  if (live) { live.textContent = ""; setTimeout(() => { live.textContent = text; }, 50); }
}

function applyHash(h) {
  A.tab = h.tab;
  $$("[role=tab]", A.view).forEach((b) => {
    const on = b.dataset.tab === h.tab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  });
  $("#ask-pane-library", A.view).classList.toggle("hidden", h.tab !== "library");
  $("#ask-pane-find", A.view).classList.toggle("hidden", h.tab !== "find");
  if (h.tab === "library") {
    if (h.scope !== A.scope) loadScope(h.scope);
  } else {
    const q = state.askFind;
    state.askFind = "";
    if (q) startFind(q);
    else if (h.job && (!A.findJob || A.findJob.id !== h.job)) showFindJob(h.job);
  }
}

// ================================================================== 내 서재에 묻기
function drawLibraryPane() {
  const pane = $("#ask-pane-library", A.view);
  const noC = !state.collections.length;
  const noF = !state.folders.length;
  pane.innerHTML = `<div class="discover-filters">
      <span id="ask-scope-l">범위</span>
      <div class="seg seg-radio" role="radiogroup" aria-labelledby="ask-scope-l">
        <label><input type="radio" name="ask-scope" value="library"><span>서재 전체</span></label>
        <label${noC ? ` title="컬렉션이 없어요"` : ""}><input type="radio" name="ask-scope" value="collection"${noC ? " disabled" : ""}><span>컬렉션</span></label>
        <label${noF ? ` title="폴더가 없어요"` : ""}><input type="radio" name="ask-scope" value="folder"${noF ? " disabled" : ""}><span>폴더</span></label>
      </div>
      <select class="input hidden" data-ask-scope-id style="width:auto;max-width:240px"></select>
      ${state.lastReadId ? `<a class="small" data-ask-paper href="#/read/${Number(state.lastReadId)}">한 논문만: 읽기 화면 대화 →</a>` : ""}
      <span class="spacer"></span>
      <button type="button" class="btn sm ghost" data-ask-clear>대화 지우기</button>
    </div>
    <div class="chat-log" role="log" aria-label="이 범위의 대화"></div>
    <div class="chat-input"><textarea class="input" rows="1" aria-label="질문" placeholder="이 범위 논문들에 물어보세요" title="Enter 전송 · Shift+Enter 줄바꿈"></textarea>
      <button type="button" class="btn primary" data-send>보내기</button></div>`;
  $$("[name=ask-scope]", pane).forEach((r) => (r.onchange = () => {
    if (r.value === "library") return void (location.hash = "#/ask");
    const list = r.value === "collection" ? state.collections : state.folders;
    const cur = A.scope && A.scope[0] === r.value[0] ? A.scope : `${r.value[0]}${list[0].id}`;
    location.hash = scopeHash(cur);
  }));
  const sel = $("[data-ask-scope-id]", pane);
  sel.onchange = () => { location.hash = scopeHash(sel.value); };
  $("[data-ask-clear]", pane).onclick = async () => {
    if (!A.messages || !A.messages.length || !(await confirmDialog("이 범위의 대화를 모두 지울까요?", { ok: "지우기" }))) return;
    try {
      await api.del(`/api/ask?scope=${encodeURIComponent(A.scope)}`);
      A.messages = [];
      drawLog();
    } catch (e) { errorToast(e); }
  };
  const ta = $("textarea", pane);
  $("[data-send]", pane).onclick = () => send();
  ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
  ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; };
}

function scopeName(scope) {
  if (!scope || scope === "library") return "서재 전체";
  const list = scope[0] === "c" ? state.collections : state.folders;
  const it = list.find((x) => `${scope[0]}${x.id}` === scope);
  return `${scope[0] === "c" ? "컬렉션" : "폴더"} ${it ? it.name : ""}`.trim();
}

function syncScopeControls() {
  const pane = $("#ask-pane-library", A.view);
  const kind = A.scope === "library" ? "library" : A.scope[0] === "c" ? "collection" : "folder";
  $$("[name=ask-scope]", pane).forEach((r) => { r.checked = r.value === kind; });
  const sel = $("[data-ask-scope-id]", pane);
  sel.classList.toggle("hidden", kind === "library");
  if (kind === "library") return;
  const list = kind === "collection" ? state.collections : state.folders;
  sel.setAttribute("aria-label", kind === "collection" ? "컬렉션 고르기" : "폴더 고르기");
  sel.innerHTML = list.map((x) => `<option value="${kind[0]}${x.id}">${esc(x.name)}</option>`).join("");
  sel.value = A.scope;
}

async function loadScope(scope, { quiet = false } = {}) {
  const me = A;
  A.scope = scope;
  syncScopeControls();
  if (!quiet) {
    A.messages = null;
    $(".chat-log", A.view).innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  }
  clearTimeout(A.poll);
  let data;
  try {
    data = await api.get(`/api/ask?scope=${encodeURIComponent(scope)}`);
  } catch (e) {
    if (A !== me || A.scope !== scope) return;
    $(".chat-log", A.view).innerHTML = `<div class="empty"><h3>이 범위를 열 수 없어요</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  if (A !== me || A.scope !== scope) return;
  const first = !quiet;
  A.index = data.index;
  A.indexJob = data.job;
  drawStatus();
  if (first) {
    A.messages = data.messages;
    A.jobs = [];
    drawLog();
    if (scope !== "library") say(`${scopeName(scope)}의 대화를 불러왔어요`);
    resumeJobs(scope);
  }
  const wasIndexing = A.wasIndexing;
  A.wasIndexing = ACTIVE(data.job);
  if (wasIndexing && !A.wasIndexing) say("색인을 마쳤어요");
  if (ACTIVE(data.job) || !data.index.loaded) A.poll = setTimeout(() => loadScope(scope, { quiet: true }), 3000);
}

// 진행 중인 범위 질문(PC 실행)을 이어서 보여 준다
async function resumeJobs(scope) {
  const me = A;
  let jobs = [];
  try { jobs = (await api.get("/api/jobs?status=active&kind=chat")).jobs; } catch { return; }
  if (A !== me || A.scope !== scope) return;
  for (const j of jobs.reverse()) {
    if (j.paper_id || !j.scope) continue;
    const s = j.scope.type === "library" ? "library" : `${j.scope.type[0]}${j.scope.id}`;
    if (s === scope) addJobNode(j);
  }
}

function drawStatus() {
  const pane = $("#ask-pane-library", A.view);
  $$(":scope > [data-ask-index], :scope > [data-ask-load], :scope > [data-ask-embed]", pane).forEach((n) => n.remove());
  const log = $(".chat-log", pane);
  const ix = A.index;
  const st = indexState(ix, A.indexJob);
  const nodes = [];
  if (st.state === "ok") {
    if (ix.indexed) nodes.push(el(`<p class="small muted" data-ask-index data-state="ok" style="margin:8px 16px 0">${esc(st.text)}</p>`));
  } else {
    const icon = st.state === "indexing" ? `<span class="spinner" aria-hidden="true"></span>` : st.state === "failed" ? ICON_WARN : ICON_CLOCK;
    const line = el(`<div class="status-line${st.state === "failed" ? " bad" : ""}" data-ask-index data-state="${st.state}">${icon}<span class="grow"></span></div>`);
    $(".grow", line).textContent = st.text;
    if (st.state === "indexing") line.appendChild(el(`<a class="small" href="#/jobs">작업 보기</a>`));
    else {
      const b = el(`<button type="button" class="btn sm" data-ask-index-run>${st.state === "failed" ? "다시 색인하기" : "색인하기"}</button>`);
      b.onclick = () => loadScope(A.scope, { quiet: true });
      line.appendChild(b);
    }
    nodes.push(line);
  }
  if (!ix.loaded && ix.indexed) {
    nodes.push(el(`<div class="status-line" data-ask-load><span class="spinner" aria-hidden="true"></span><span class="grow">서재 색인을 불러오는 중이에요 — 처음 한 번은 몇 초 걸려요. 그동안 질문을 써 두세요.</span></div>`));
  }
  if (!ix.embed) {
    nodes.push(el(`<div class="notice" data-tone="warn" data-ask-embed>${ICON_WARN}<div><b>지금은 낱말 검색만 해요.</b> 의미 검색 모델이 서버에 없어요. 논문에 나오는 낱말(영어 논문이면 영어 용어)을 넣어 물으면 더 잘 찾아요.</div></div>`));
  }
  for (const n of nodes) pane.insertBefore(n, log);
  if (A.messages && !A.messages.length) drawLog(); // 빈 상태 문구는 색인 수에 따라 다름
}

function drawLog() {
  const log = $(".chat-log", A.view);
  log.innerHTML = "";
  if (A.index && !A.index.indexed) {
    log.appendChild(el(`<div class="empty"><h3>이 범위에 색인된 논문이 없어요</h3><p>PDF가 있는 논문을 넣으면 자동으로 색인해요. 색인이 끝나면 여기서 물어볼 수 있어요.</p></div>`));
  } else if (!A.messages.length && !(A.jobs || []).length) {
    const box = el(`<div><div class="empty" style="padding:24px 0 8px"><h3>이 범위 논문들에 물어보세요</h3><p>답의 문장마다 출처 번호가 붙고, 누르면 그 논문의 그 쪽이 열려요.</p></div><div class="suggest"></div></div>`);
    for (const q of SUGGEST) {
      const b = el(`<button type="button">${esc(q)}</button>`);
      b.onclick = () => send(q);
      $(".suggest", box).appendChild(b);
    }
    log.appendChild(box);
  }
  for (const m of A.messages || []) log.appendChild(messageEl(m));
  for (const j of A.jobs || []) log.append(j.q, j.node);
  log.scrollTop = log.scrollHeight;
}

function messageEl(m) {
  if (m.role === "user") return el(`<div class="msg user">${esc(m.content)}</div>`);
  const node = el(`<div class="msg assistant"><div class="prose"></div><ol class="cite-list" aria-label="출처"></ol></div>`);
  updateAnswer(node, m);
  return node;
}

function updateAnswer(node, m) {
  const prose = $(".prose", node);
  node.setAttribute("aria-busy", String(!!m.pending));
  if (m.pending && !m.content) {
    prose.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>${A.index && !A.index.loaded ? ` <span class="small muted">색인을 다 불러오면 답해요</span>` : ""}`;
    return;
  }
  prose.innerHTML = renderMarkdown(m.content, { citations: !m.pending });
  const list = $(".cite-list", node);
  list.innerHTML = "";
  const cites = m.citations || [];
  for (const c of cites) {
    const li = el(`<li><button type="button" class="cite-item" data-n="${Number(c.n)}" title="읽기 화면에서 이 위치 열기">
      <span class="cite-ref">${Number(c.n)}</span>${c.page ? `<span class="page-link">p.${Number(c.page)}</span>` : ""}
      <span><b></b>${c.year ? ` · ${esc(c.year)}` : ""} <q></q></span></button></li>`);
    $("b", li).textContent = c.title || "제목 없음";
    $("q", li).textContent = c.text || "";
    $("button", li).onclick = () => openSource(c);
    list.appendChild(li);
  }
  $$("button[data-cite]", prose).forEach((b) => {
    const c = cites.find((x) => String(x.n) === b.dataset.cite);
    if (!c) { b.replaceWith(document.createTextNode(`[${b.dataset.cite}]`)); return; }
    b.setAttribute("aria-label", `출처 ${c.n} 보기`);
    b.title = `${c.title || ""}${c.page ? ` · p.${c.page}` : ""}`;
    b.onclick = () => {
      const item = $(`.cite-item[data-n="${c.n}"]`, node);
      if (!item) return;
      item.focus();
      item.classList.add("is-flash");
      setTimeout(() => item.classList.remove("is-flash"), 1500);
    };
  });
}

// 출처 → 읽기 화면의 그 쪽 · 위치 (시안 3.4 · 4장). 위치는 화면 메모리로만 넘긴다
async function openSource(c) {
  try {
    await api.get(`/api/papers/${Number(c.paper_id)}`);
  } catch (e) {
    if (e.status === 404) return toast("이 논문은 서재에서 지워졌어요");
    return errorToast(e);
  }
  state.askSpot = { paper_id: Number(c.paper_id), page: Number(c.page) || 1, rect: Array.isArray(c.rect) ? c.rect : null, text: c.text || "" };
  location.hash = `#/read/${Number(c.paper_id)}/p${Number(c.page) || 1}`;
}

function setBusy(on) {
  A.sending = on || (A.jobs || []).length > 0;
  const pane = $("#ask-pane-library", A.view);
  $("[data-send]", pane).disabled = A.sending;
  if (A.sending) $("[data-send]", pane).setAttribute("aria-busy", "true"); else $("[data-send]", pane).removeAttribute("aria-busy");
}

async function send(text) {
  const pane = $("#ask-pane-library", A.view);
  const ta = $("textarea", pane);
  const question = (text || ta.value).trim();
  if (!question || A.sending) return;
  if (A.index && !A.index.indexed) return toast("이 범위에 색인된 논문이 없어요");
  ta.value = "";
  ta.style.height = "auto";
  const me = A;
  const scope = A.scope;
  A.messages.push({ role: "user", content: question });
  drawLog();
  const pending = { role: "assistant", content: "", citations: [], pending: true };
  const node = messageEl(pending);
  const log = $(".chat-log", pane);
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
  setBusy(true);
  A.abort = new AbortController();
  let jobEv = null;
  try {
    await streamEvents("/api/ask", { scope, question }, (ev) => {
      if (A !== me) return;
      if (ev.type === "queued" || ev.type === "fallback") jobEv = ev;
      else if (ev.type === "delta") { pending.content += ev.text; updateAnswer(node, pending); }
      else if (ev.type === "done") {
        Object.assign(pending, { content: ev.text, citations: ev.citations || [], pending: false });
        updateAnswer(node, pending);
      } else if (ev.type === "error") throw new Error(ev.error);
      if (log.scrollHeight - log.scrollTop - log.clientHeight < 140) log.scrollTop = log.scrollHeight;
    }, A.abort.signal);
    if (A !== me) return;
    if (jobEv) { // PC(CLI)로 감: 이미 나온 API 글은 지우고 작업을 따라간다
      A.messages.pop();
      node.remove();
      addJobNode(jobEv.job, question, jobEv.type === "fallback" && jobEv.job.history.length
        ? errorLabel(jobEv.job.history[jobEv.job.history.length - 1].error_code) : null);
      return;
    }
    if (pending.pending) throw new Error("응답이 끝나기 전에 연결이 끊겼어요");
    A.messages.push(pending);
    say(`답을 다 썼어요. 출처 ${pending.citations.length}개`);
  } catch (e) {
    if (A !== me || e.name === "AbortError") return;
    A.messages.pop();
    const msg = e.status === 503 ? "색인을 불러오는 데 시간이 오래 걸려요. 잠시 후 다시 물어봐 주세요." : e.message;
    const err = el(`<div class="msg error" role="alert"><div class="row"><span class="grow"></span><button type="button" class="btn sm">다시 보내기</button></div></div>`);
    $(".grow", err).textContent = msg;
    $("button", err).onclick = () => { err.remove(); send(question); };
    node.replaceWith(err);
  } finally {
    if (A === me) setBusy(false);
  }
}

// PC(CLI)에서 만드는 답 자리 — 읽기 화면 대화와 같은 문구 (jobs.js)
function addJobNode(job, question = job.question || "", fallback = null) {
  const q = el(`<div class="msg user"></div>`);
  q.textContent = question;
  const node = el(`<div class="msg assistant" data-job-id="${job.id}" aria-busy="true">
    ${fallback ? `<div class="notice" data-tone="warn">${ICON_WARN}<div>API가 실패해서 PC로 넘겼어요 (${esc(fallback)}).</div></div>` : ""}</div>`);
  const line = statusLineEl(async () => { try { await cancelJob(job.id); } catch (e) { errorToast(e); } });
  node.appendChild(line);
  const entry = { id: job.id, q, node };
  A.jobs = [...(A.jobs || []), entry];
  const log = $(".chat-log", A.view);
  log.append(q, node);
  log.scrollTop = log.scrollHeight;
  setBusy(false);
  const me = A;
  const stop = watchJob(job.id, async (j) => {
    if (A !== me) return;
    if (j && ACTIVE(j)) return setStatusLine(line, j, "답을 만드는");
    A.jobs = A.jobs.filter((x) => x !== entry);
    if (j && j.status === "failed") {
      const err = el(`<div class="msg error" role="alert"><div class="row"><span class="grow"></span><button type="button" class="btn sm">다시 시도</button></div></div>`);
      $(".grow", err).textContent = j.error || "답을 만들지 못했어요";
      $("button", err).onclick = async () => { try { const r = await retryJob(j.id); err.remove(); addJobNode(r.job, question); } catch (e) { errorToast(e); } };
      node.replaceWith(err);
    } else if (j && j.status === "succeeded") {
      try { A.messages = (await api.get(`/api/ask?scope=${encodeURIComponent(A.scope)}`)).messages; } catch { /* 다음에 열면 보임 */ }
      if (A !== me) return;
      drawLog();
      say("답을 다 썼어요");
    } else { q.remove(); node.remove(); }
    setBusy(false);
  }, { first: job });
  A.stops.push(stop);
}

// ================================================================== 논문 찾기 (AI로 찾기)
function drawFindPane() {
  const pane = $("#ask-pane-find", A.view);
  pane.innerHTML = `<form class="discover-bar" role="search" aria-label="AI로 찾기">
      <div class="searchbox"><input class="input" name="q" maxlength="1000" aria-label="찾고 싶은 내용" placeholder="예: 대학생의 학업 스트레스와 수면의 관계"></div>
      <button class="btn primary" style="height:40px;padding:0 20px">AI로 찾기</button>
    </form>
    <p class="small muted" style="margin:0">OpenAlex · Semantic Scholar에서 여러 검색어로 찾아 8편을 골라 한국어로 요약해요. 결과는 24시간 뒤 지워져요.</p>
    <div data-find-out></div>`;
  $("form", pane).onsubmit = (e) => {
    e.preventDefault();
    const q = $("[name=q]", pane).value.trim();
    if (q.length < 2) return $("[name=q]", pane).focus();
    startFind(q);
  };
}

function findBusy(on) {
  const pane = $("#ask-pane-find", A.view);
  $("[name=q]", pane).disabled = on;
  $("button.primary", pane).disabled = on;
}

async function startFind(question) {
  const pane = $("#ask-pane-find", A.view);
  $("[name=q]", pane).value = question;
  const out = $("[data-find-out]", pane);
  out.innerHTML = "";
  findBusy(true);
  let job;
  try {
    job = (await api.post("/api/find", { question })).job;
  } catch (e) {
    findBusy(false);
    out.appendChild(failCard(e.message, question, e.code === "no_route"));
    return;
  }
  history.replaceState(history.state, "", `#/ask/find/j${job.id}`); // 결과 다시 보기 주소 (AD-8) — 질문은 넣지 않음
  followFind(job, question);
}

async function showFindJob(id) {
  const pane = $("#ask-pane-find", A.view);
  const out = $("[data-find-out]", pane);
  out.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  let job;
  try { job = await api.get(`/api/jobs/${id}`); } catch (e) {
    out.innerHTML = "";
    out.appendChild(el(`<div class="empty"><h3>결과를 찾을 수 없어요</h3><p>다시 찾으려면 질문을 입력해 주세요.</p></div>`));
    return;
  }
  if (job.kind !== "find") { out.innerHTML = ""; return; }
  if (job.question) $("[name=q]", pane).value = job.question;
  followFind(job, job.question || "");
}

function followFind(job, question) {
  const me = A;
  A.findJob = job;
  const out = $("[data-find-out]", $("#ask-pane-find", A.view));
  out.innerHTML = "";
  const card = el(`<div class="graph-progress-card job-card" style="width:100%">
    <div class="graph-progress-head"><span data-icon><span class="spinner" aria-hidden="true"></span></span><span>AI로 찾는 중</span></div>
    <ol class="graph-steps" aria-label="진행 단계"></ol>
    <p class="graph-progress-msg" role="status"></p>
    <div class="graph-progress-foot"><a class="small" href="#/jobs">작업 목록에서 보기</a><button type="button" class="btn sm" data-job-cancel>취소</button></div></div>`);
  $("[data-job-cancel]", card).onclick = async () => { try { await cancelJob(job.id); } catch (e) { errorToast(e); } };
  if (ACTIVE(job)) { out.appendChild(card); findBusy(true); }
  const stop = watchJob(job.id, (j) => {
    if (A !== me || A.findJob !== job) return;
    if (!j) { out.innerHTML = ""; findBusy(false); return; }
    if (ACTIVE(j)) {
      card.dataset.jobState = jobState(j);
      $(".graph-steps", card).innerHTML = findSteps(j).map((s) =>
        `<li data-step="${s.step}"${s.state ? ` data-state="${s.state}"` : ""}>${esc(s.name)} <span class="graph-step-msg">${esc(s.note)}</span></li>`).join("");
      const msg = `${jobLine(j, "실행", { elapsed: false })}. 보통 30초~1분 걸려요. 다른 화면으로 가도 계속돼요.`;
      const p = $(".graph-progress-msg", card);
      if (p.textContent !== msg) p.textContent = msg;
      return;
    }
    findBusy(false);
    out.innerHTML = "";
    if (j.status === "succeeded" && j.result) drawFindResult(out, j.result);
    else if (j.status === "succeeded" || !(question || j.question)) out.appendChild(el(`<div class="empty"><h3>이 결과는 24시간이 지나 지워졌어요</h3><p>다시 찾으려면 질문을 입력해 주세요.</p></div>`));
    else if (j.status === "failed") out.appendChild(failCard(FIND_FAIL[j.error_code] || j.error || "찾지 못했어요", question || j.question || ""));
    else { toast("취소했어요"); }
  }, { first: job });
  A.stops.push(stop);
}

function failCard(message, question, settings = false) {
  const card = el(`<div class="graph-progress-card job-card" data-job-state="failed" style="width:100%">
    <div class="graph-progress-head">${ICON_WARN}<span>찾지 못했어요</span></div>
    <p class="graph-progress-msg" role="alert"></p>
    <div class="graph-progress-foot"><span></span><span class="row" style="gap:6px">
      ${settings ? `<button type="button" class="btn sm" data-open-settings>설정 열기</button>` : ""}
      ${question ? `<button type="button" class="btn sm primary" data-find-retry>다시 찾기</button>` : ""}</span></div></div>`);
  $(".graph-progress-msg", card).textContent = message;
  const s = $("[data-open-settings]", card);
  if (s) s.onclick = () => import("./dialogs.js").then((m) => m.settingsDialog());
  const r = $("[data-find-retry]", card);
  if (r) r.onclick = () => startFind(question);
  return card;
}

async function drawFindResult(out, res) {
  const { resultCard } = await import("./discover.js"); // 화면 순수 함수 시험(ask.test.mjs)이 이 모듈만 불러올 수 있게 늦게
  out.appendChild(el(`<div class="graph-notices">
    <div class="notice" data-tone="info">${ICON_INFO}<div><b>초록을 바탕으로 쓴 요약이에요.</b> 원문과 다를 수 있으니 출처 논문을 확인해 주세요. 이 결과는 24시간 뒤 지워져요 — 필요한 논문은 서재에 추가해 두세요.</div></div>
    ${(res.warnings || []).filter((w) => FIND_WARN[w]).map((w) => `<div class="notice" data-tone="warn">${ICON_WARN}<div>${esc(FIND_WARN[w])}</div></div>`).join("")}
  </div>`));
  if ((res.queries || []).length) {
    const row = el(`<div class="discover-filters" style="margin:12px 0 0"><span>쓴 검색어</span><div class="chips"></div></div>`);
    for (const q of res.queries) { const c = el(`<span class="chip"></span>`); c.textContent = q; $(".chips", row).appendChild(c); }
    out.appendChild(row);
  }
  const sources = res.sources || [];
  if (!sources.length) {
    out.appendChild(el(`<div class="empty"><h3>관련 논문을 찾지 못했어요</h3><p>더 구체적으로 묻거나 영어 용어를 넣어 보세요.</p></div>`));
    return;
  }
  const answer = el(`<div class="msg assistant" style="margin-top:12px"><div class="prose"></div></div>`);
  $(".prose", answer).innerHTML = renderMarkdown(res.answer || "", { citations: true });
  out.appendChild(answer);
  out.appendChild(el(`<div class="section-title" id="find-src-h">출처 논문 ${sources.length}편</div>`));
  const list = el(`<ol class="ask-sources" aria-labelledby="find-src-h"></ol>`);
  for (const it of sources) {
    const li = el(`<li id="find-src-${Number(it.n)}"></li>`);
    li.appendChild(resultCard(it, { n: it.n, lite: true }));
    list.appendChild(li);
  }
  out.appendChild(list);
  $$("button[data-cite]", answer).forEach((b) => {
    const n = b.dataset.cite;
    const li = $(`#find-src-${n}`, list);
    if (!li) { b.replaceWith(document.createTextNode(`[${n}]`)); return; }
    b.setAttribute("aria-label", `출처 ${n} 보기`);
    b.onclick = () => {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const link = $(".r-title a, .r-title [tabindex]", li);
      if (link) link.focus({ preventScroll: true }); // 초점 먼저 — 부드러운 스크롤 중에 초점을 옮기면 스크롤이 멈춤
      const pane = li.closest(".ask-pane"); // 칸만 스크롤 (scrollIntoView는 바깥 칸까지 밀어 머리가 가려짐)
      pane.scrollBy({ top: li.getBoundingClientRect().top - pane.getBoundingClientRect().top - 12, behavior: reduce ? "auto" : "smooth" });
      li.classList.add("is-flash");
      setTimeout(() => li.classList.remove("is-flash"), 1500);
    };
  });
  say(`요약과 출처 논문 ${sources.length}편을 찾았어요`);
}

