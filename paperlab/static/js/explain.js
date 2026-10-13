// 4단계 쉬운 설명 · 번역 — 읽기 화면 패널 탭 "설명·번역" (docs/design/phase4-explain-translate-ui.md · 명세 5 · 7 · 10장)
// [선택 기록] 선택 설명 · 번역 카드(SSE · PC 작업) / [전체 번역] PDF 옆 쪽 따라가기 보기 · 시작 창 · 진행.
// 선택 글 · 설명 · 번역문은 esc · textContent · renderMarkdown으로만, 개념 그림은 ui.renderSvg(<img src="blob:">)로만 그린다.
// 읽기 화면 상태(R)는 reader.js가 host로 넘긴다: { pid, paper, prefs(), savePrefs(), goToSpot, goToPage, currentPage(),
// addAnnotation(page, rects, text, color, comment) } — 탭 그리기 함수는 export만(1C 참고 패널은 AI를 하지 않음 — 명세 3장).

import { api, streamEvents } from "./api.js";
import { COMPANY, ICON_INFO, ICON_WARN, cancelJob, errorLabel, setStatusLine, statusLineEl, watchJob } from "./jobs.js";
import {
  $, $$, confirmDialog, copyText, el, errorToast, esc, fmtDate, modal, popupMenu, renderMarkdown, renderSvg, toast,
} from "./ui.js";

export const LANGS = { ko: "한국어", en: "English", ja: "日本語", zh: "简体中文" };
export const TEXT_MIN = 2;
export const TEXT_MAX = 4000;
export const BUSY_TIP = "앞의 요청이 끝나면 할 수 있어요";
const KIND = {
  explain: { chip: "쉬운 설명", verb: "설명", doing: "쉬운 설명을 만들고 있어요", done: "쉬운 설명을 다 썼어요",
    fail: "설명을 만들지 못했어요.", cached: "저장된 설명을 보여 드려요" },
  translate: { chip: "번역", verb: "번역", doing: "번역하고 있어요", done: "번역을 다 썼어요", fail: "번역하지 못했어요.",
    cached: "저장된 번역을 보여 드려요" },
};
const FIG_NOTE = { failed: "그림을 그리지 못했어요 — 설명 글은 위에 그대로 있어요.", unsafe: "그림이 안전 검사를 통과하지 못해 빼었어요.",
  too_large: "그림이 너무 커서 빼었어요." };
const ACTIVE = (j) => !!j && (j.status === "queued" || j.status === "running");

// ====================================================================== 순수 함수 (tests/js/explain.test.mjs)
export const normText = (s) => String(s || "").replace(/\s+/g, " ").trim();

// 보내기 전 화면 검사 (시안 2장): 2자 미만은 조용히 무시, 4,000자 초과는 안내
export function selCheck(text) {
  const t = normText(text);
  if (t.length < TEXT_MIN) return { ok: false, msg: "" };
  if (t.length > TEXT_MAX) return { ok: false, msg: "4,000자까지 설명할 수 있어요. 조금 줄여서 골라 주세요" };
  return { ok: true, text: t };
}

// [[x, y, w, h]…] → [x0, y0, x1, y1] (goToSpot)
export function rectBox(rects) {
  if (!rects || !rects.length) return null;
  const r4 = (x) => Math.round(x * 10000) / 10000;
  return [r4(Math.min(...rects.map((r) => r[0]))), r4(Math.min(...rects.map((r) => r[1]))),
    r4(Math.max(...rects.map((r) => r[0] + r[2]))), r4(Math.max(...rects.map((r) => r[1] + r[3])))];
}

export function trCounts(st) {
  const n = (c) => [...String(st || "")].filter((x) => x === c).length;
  return { done: n("d"), failed: n("f"), pending: n("-"), skipped: n("s"), refs: n("r"), outside: n("."),
    total: n("d") + n("f") + n("-") };
}

// 번역 범위(. 아닌 쪽의 처음 · 끝)
export function trRange(st) {
  const s = String(st || "");
  const a = s.search(/[^.]/);
  if (a < 0) return null;
  return [a + 1, s.length - [...s].reverse().join("").search(/[^.]/)];
}

// 쪽 상태 한 글자 → 문구 · 버튼 (시안 5.4절, AD-4: 건너뛴 쪽은 한 문구)
export function pageView(ch, { lang = "ko", active = false, range = null, code = "" } = {}) {
  const name = LANGS[lang] || lang;
  switch (ch) {
    case "d": return { mode: "text" };
    case "-": return active ? { mode: "wait", text: "아직 번역 전이에요. 차례가 오면 바로 보여 드려요." }
      : { mode: "notice", text: "아직 번역 전이에요.", action: { label: "이어서 번역", pages: "pending" } };
    case "f": return { mode: "notice", tone: "warn", strong: "이 쪽은 번역하지 못했어요.", text: errorLabel(code || "bad_output"),
      action: { label: "이 쪽 다시", pages: "page" } };
    case "s": return { mode: "notice", text: `글자가 거의 없거나 이미 ${name}인 쪽이라 건너뛰었어요.` };
    case "r": return { mode: "notice", text: "참고문헌 이후 쪽이라 번역하지 않았어요.", action: { label: "포함해 번역", includeRefs: true } };
    default: return { mode: "notice", text: `번역 범위 밖이에요${range ? ` (p.${range[0]}~${range[1]}만 번역했어요)` : ""}.`,
      action: { label: "이 쪽도 번역", pages: "page" } };
  }
}

// 시작 창 예상 다시 셈 (AD-3 — 서버 translate.estimate가 준 쪽별 글자 수 · 상수로, 서버 계획 · 묶음 규칙과 같게)
export function estimateFor(est, { from = 1, to = est.n, includeRefs = false, lang = "ko" } = {}) {
  const k = est.k;
  const chars = (p) => (p === est.refs_from && !includeRefs ? est.refs_cut : est.page_chars[p - 1]);
  const st = [];
  for (let p = 1; p <= est.n; p++) {
    if (p < from || p > to) st.push(".");
    else if (est.refs_from && p > est.refs_from && !includeRefs) st.push("r");
    else if (chars(p) < 20 || (lang === "ko" && est.page_ko[p - 1])) st.push("s");
    else st.push("-");
  }
  let chunks = 0;
  let total = 0;
  for (let p = 1; p <= est.n;) {
    if (st[p - 1] !== "-") { p++; continue; }
    let n = 1;
    let c = chars(p);
    while (n < k.chunk_pages && st[p + n - 1] === "-" && c + chars(p + n) <= k.chunk_chars) { c += chars(p + n); n++; }
    chunks++;
    total += c;
    p += n;
  }
  const tokens = total / k.chars_per_token;
  const output = tokens * k.out_ratio;
  return { state: st.join(""), pages: st.filter((x) => x === "-").length, refs: st.filter((x) => x === "r").length,
    skipped: st.filter((x) => x === "s").length, chunks, input: Math.round(tokens + chunks * k.chunk_overhead),
    output: Math.round(output), minutes: chunks ? Math.ceil((output / k.tokens_per_s + chunks * k.chunk_wait_s) / 60) : 0 };
}

// 토큰 수 → "약 2만" · "약 2.3만" · "약 5천"
export function fmtTok(n) {
  if (n >= 10000) return `약 ${String(Math.round(n / 1000) / 10).replace(/\.0$/, "")}만`;
  if (n >= 1000) return `약 ${Math.round(n / 1000)}천`;
  return `약 ${Math.round(n)}`;
}

// ====================================================================== 상태 (논문 하나 — 탭을 바꿔도 이어짐)
let S = null;

export function resetExplain() {
  if (!S) return;
  if (S.run) { S.run.abort && S.run.abort.abort(); S.run.stop && S.run.stop(); }
  S.trStop && S.trStop();
  S.themeObs && S.themeObs.disconnect();
  clearTimeout(S.followTimer);
  S = null;
}

function stateFor(host) {
  if (!S || S.pid !== host.pid) {
    resetExplain();
    S = { pid: host.pid, host, items: [], jobs: [], loaded: false, run: null, view: host.prefs().xtView || "history",
      tr: null, trLoaded: false, trPage: null, follow: true, trStop: null, followTimer: null, noted: false, memo: new Set() };
    S.themeObs = new MutationObserver(() => redrawFigures());
    S.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  S.host = host;
  return S;
}

// 진행 중이면 상자 버튼은 aria-disabled (한 읽기 화면에 하나 — 명세 5.1절)
export const explainBusy = () => !!(S && S.run && !S.run.failed);

function live(msg) {
  const box = S && S.body && $("[data-xt-live]", S.body);
  if (!box) return;
  box.textContent = "";
  setTimeout(() => { box.textContent = msg; }, 30);
}

// ====================================================================== 탭 그리기
export function explainTab(body, host) {
  const s = stateFor(host);
  body.innerHTML = "";
  const top = el(`<div class="row" style="margin-bottom:12px"><div class="seg" role="group" aria-label="보기">
    <button type="button" data-xt-view="history">선택 기록</button><button type="button" data-xt-view="paper">전체 번역</button></div></div>`);
  body.append(top, el(`<div class="sr-only" role="status" data-xt-live></div>`), el(`<div data-xt-box></div>`));
  s.body = body;
  $$("[data-xt-view]", top).forEach((b) => (b.onclick = () => {
    s.view = b.dataset.xtView;
    host.savePrefs({ xtView: s.view });
    drawView();
  }));
  body.onkeydown = (e) => { // 전체 번역 보기: 패널 안에 초점이 있을 때만 [ ] 로 쪽 넘김 (시안 8.3절)
    if (s.view !== "paper" || !$("[data-xt-box]", body) || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
      || !(e.key === "[" || e.key === "]")) return;
    e.preventDefault();
    stepPage(e.key === "]" ? 1 : -1);
  };
  drawView();
}

function box() {
  return S && S.body && S.body.isConnected ? $("[data-xt-box]", S.body) : null;
}

function drawView() {
  const b = box();
  if (!b) return;
  $$("[data-xt-view]", S.body).forEach((x) => {
    const on = x.dataset.xtView === S.view;
    x.classList.toggle("active", on);
    x.setAttribute("aria-pressed", String(on));
  });
  b.innerHTML = "";
  if (S.view === "paper") drawPaper(); else drawHistory();
}

// ---------------------------------------------------------------------- 선택 기록
async function loadList() {
  const s = S;
  const r = await api.get(`/api/papers/${s.pid}/explanations`);
  if (S !== s) return;
  s.items = r.items;
  s.keep = r.keep;
  s.loaded = true;
  // PC로 넘어간 작업 · 탭을 떠났다 온 작업(2단계 규칙): 진행 카드로 다시 (한 번에 하나)
  const job = r.jobs[0];
  if (job && !s.run) followJob({ kind: job.kind, text: job.source_text || "", page: job.page || 1, rects: [] }, job);
}

async function drawHistory() {
  const s = S;
  let b = box();
  if (!s.loaded) {
    b.innerHTML = `<div class="ai-cta"><span class="spinner"></span></div>`;
    try { await loadList(); } catch (e) { if (box()) box().innerHTML = `<div class="msg error">${esc(e.message)}</div>`; return; }
    b = box();
    if (S !== s || s.view !== "history" || !b) return;
  }
  b.innerHTML = "";
  const list = el(`<ol aria-label="설명·번역 기록" style="list-style:none;margin:0;padding:0"></ol>`);
  if (s.run) list.appendChild(runCard(s.run));
  for (const it of s.items) list.appendChild(itemCard(it));
  if (!list.children.length) {
    b.appendChild(el(`<div class="ai-cta"><h3>아직 설명·번역이 없어요</h3>
      <p class="small">PDF에서 문장을 드래그하고 [쉽게 설명]이나 [번역]을 눌러 보세요.</p></div>`));
    return;
  }
  b.appendChild(list);
  b.appendChild(el(`<p class="small muted" style="margin:8px 0 0">최근 ${esc(s.keep || 300)}개까지 보관해요.</p>`));
}

function headHtml(kind, lang, page, date, cached) {
  const chip = kind === "explain" ? `<span class="chip accent">${KIND.explain.chip}</span>`
    : `<span class="chip">번역 · ${esc(LANGS[lang] || lang)}</span>`;
  return `<div class="foot">${chip}${page ? `<button type="button" class="page-link" data-goto="${Number(page)}">p.${Number(page)}</button>` : ""}
    ${date ? `<span>${esc(fmtDate(date))}</span>` : ""}${cached ? `<span class="chip">저장된 결과</span>` : ""}</div>`;
}

const quoteText = (t) => `“${esc(t.slice(0, 120))}${t.length > 120 ? "…" : ""}”`;

function itemCard(it) {
  const li = el(`<li class="ann-item" data-kind="${it.kind === "translate" ? "translate" : "explain"}" data-xt-id="${Number(it.id)}">
    ${headHtml(it.kind, it.lang, it.page, it.created_at, it.cached)}<div class="q">${quoteText(it.source_text)}</div></li>`);
  if (it.kind === "explain") {
    li.appendChild(el(`<div class="prose"><p><strong>${esc(it.one_line)}</strong></p></div>`));
    if (it.easy) $(".prose", li).insertAdjacentHTML("beforeend", renderMarkdown(it.easy));
    if (it.detail) {
      const d = el(`<details><summary>자세한 설명</summary><div class="prose"></div></details>`);
      $(".prose", d).innerHTML = renderMarkdown(it.detail);
      li.appendChild(d);
    }
    if (it.svg || it.svg_note) li.appendChild(figureEl(it));
  } else {
    const p = el(`<div class="prose" lang="${esc(it.lang)}"></div>`);
    p.innerHTML = renderMarkdown(it.text);
    li.appendChild(p);
  }
  const memoDone = S.memo.has(it.id);
  const foot = el(`<div class="foot"><button type="button" class="btn sm ghost" data-xt-goto>원문 위치</button>
    ${it.rects && it.rects.length ? `<button type="button" class="btn sm ghost" data-xt-memo ${memoDone ? 'aria-disabled="true"' : ""}>${memoDone ? "메모로 남김 ✓" : "메모로 남기기"}</button>` : ""}
    <button type="button" class="btn sm ghost" data-xt-copy>복사</button><span class="spacer"></span>
    <button type="button" class="icon-btn small" data-xt-more aria-haspopup="menu" aria-label="더 보기: 다시 만들기 · 지우기">⋯</button></div>`);
  li.appendChild(foot);
  const goto = () => { S.host.goToSpot(it.page, it.rect, it.source_text); live(`p.${it.page}의 원문 위치를 표시했어요`); };
  $("[data-xt-goto]", li).onclick = goto;
  const pg = $("[data-goto]", li);
  if (pg) pg.onclick = goto;
  const memo = $("[data-xt-memo]", li);
  if (memo) memo.onclick = async () => {
    if (memo.getAttribute("aria-disabled") === "true") return;
    const comment = it.kind === "explain" ? [it.one_line, it.easy].filter(Boolean).join("\n\n") : it.text;
    try {
      await S.host.addAnnotation(it.page, it.rects, it.source_text, "yellow", comment.slice(0, 5000));
      S.memo.add(it.id);
      memo.textContent = "메모로 남김 ✓";
      memo.setAttribute("aria-disabled", "true");
      toast("노랑 하이라이트와 메모로 남겼어요");
    } catch (e) { errorToast(e); }
  };
  $("[data-xt-copy]", li).onclick = () => copyText(it.kind === "explain" ? [it.one_line, it.easy, it.detail].filter(Boolean).join("\n\n") : it.text);
  const more = $("[data-xt-more]", li);
  more.onclick = (e) => {
    e.stopPropagation();
    popupMenu(more, [
      { label: "다시 만들기", sub: "요금이 다시 나가요", action: () => startExplain(it.kind, { text: it.source_text, page: it.page, rects: it.rects }, S.host, { force: true, redo: it.id }) },
      { label: "지우기", danger: true, action: () => removeItem(it, li) },
    ], { focus: e.detail === 0 });
  };
  return li;
}

async function removeItem(it, li) {
  try {
    await api.del(`/api/explanations/${it.id}`);
  } catch (e) { errorToast(e); return; }
  const next = li.nextElementSibling;
  S.items = S.items.filter((x) => x.id !== it.id);
  li.remove();
  const f = next && $("[data-xt-goto]", next);
  if (f) f.focus(); else { const v = S.body && $('[data-xt-view="history"]', S.body); if (v) v.focus(); }
  if (!S.items.length && !S.run) drawView();
  live("지웠어요");
}

// 개념 그림 (시안 4장)
function figureEl(it) {
  const fig = el(`<figure class="xt-figure"></figure>`);
  fig._item = it;
  drawFigure(fig);
  return fig;
}

function drawFigure(fig) {
  const it = fig._item;
  fig.innerHTML = "";
  const fail = (note) => {
    fig.dataset.state = "failed";
    fig.setAttribute("role", "note");
    fig.textContent = FIG_NOTE[note] || FIG_NOTE.failed;
  };
  if (it.svg_note) return fail(it.svg_note);
  const img = renderSvg(it.svg, { text: it.one_line });
  if (!img) return fail("failed");
  fig.dataset.state = "ok";
  fig.removeAttribute("role");
  img.addEventListener("error", () => fail("failed"), { once: true });
  fig.append(img, el(`<figcaption>AI가 그린 개념 그림이라 틀릴 수 있어요</figcaption>`));
}

function redrawFigures() {
  if (S && S.body && S.body.isConnected) $$("figure.xt-figure", S.body).forEach((f) => f._item && drawFigure(f));
}

// ---------------------------------------------------------------------- 진행 카드
function runCard(run) {
  const li = el(`<li class="ann-item" data-kind="${run.kind}" data-state="${run.failed ? "failed" : "running"}" ${run.failed ? "" : 'aria-busy="true"'}>
    ${headHtml(run.kind, run.lang || "", run.page, "", false)}<div class="q">${quoteText(run.text)}</div></li>`);
  run.li = li;
  const pg = $("[data-goto]", li);
  if (pg) pg.onclick = () => S.host.goToSpot(run.page, rectBox(run.rects), run.text);
  if (run.failed) {
    li.appendChild(el(`<div class="notice" data-tone="danger" role="alert">${ICON_WARN}<div><b>${KIND[run.kind].fail}</b> ${esc(run.error || "")}</div></div>`));
    const row = el(`<div class="foot"><span class="spacer"></span><button type="button" class="btn sm" data-x>닫기</button>
      <button type="button" class="btn sm primary" data-retry>다시 시도</button></div>`);
    li.appendChild(row);
    $("[data-x]", row).onclick = () => { endRun(run); drawView(); };
    $("[data-retry]", row).onclick = () => { endRun(run); startExplain(run.kind, run, S.host, { force: run.force, redo: run.redo }); };
    return li;
  }
  const line = statusLineEl(() => cancelRun(run));
  li.appendChild(line);
  run.line = line;
  const prose = el(`<div class="prose${run.kind === "translate" ? "" : " hidden"}" aria-busy="true"></div>`);
  if (run.kind === "translate") prose.innerHTML = run.partial ? renderMarkdown(run.partial) : `<span class="typing"><span></span><span></span><span></span></span>`;
  li.appendChild(prose);
  run.prose = prose;
  paintRun(run);
  return li;
}

function paintRun(run) {
  if (!run.line || !run.line.isConnected) return;
  const verb = KIND[run.kind].verb;
  if (run.job) setStatusLine(run.line, run.job, verb);
  else setStatusLine(run.line, { status: "running", runner: "api", engine: run.engine || "claude", progress: {} }, verb);
  if (run.kind === "translate" && run.prose && run.partial) run.prose.innerHTML = renderMarkdown(run.partial);
}

async function cancelRun(run) {
  if (run.abort) { run.abort.abort(); return; }
  if (run.job) {
    try { await cancelJob(run.job.id); } catch (e) { errorToast(e); }
  }
}

function endRun(run, ok = false) {
  if (S && S.run === run) S.run = null;
  run.stop && run.stop();
  if (!ok && run.redoItem && S && !S.items.some((x) => x.id === run.redoItem.id)) S.items.unshift(run.redoItem);
}

// 상자 버튼 → 시작 (reader.js). sel = { text, page, rects }
export async function startExplain(kind, sel, host, { force = false, redo = null } = {}) {
  const s = stateFor(host);
  if (explainBusy()) { toast(BUSY_TIP); return; }
  const chk = selCheck(sel.text);
  if (!chk.ok) { if (chk.msg) toast(chk.msg); return; }
  const run = { kind, text: chk.text, page: sel.page, rects: sel.rects || [], force, redo, partial: "", job: null,
    abort: new AbortController(), lang: kind === "translate" ? (host.settings().translate_language || "ko") : "" };
  if (redo) { // 그 카드가 그 자리에서 진행 상태로 (새 카드 만들지 않음). 실패 · 취소면 되돌림
    run.redoItem = s.items.find((x) => x.id === redo) || null;
    s.items = s.items.filter((x) => x.id !== redo);
  }
  s.run = run;
  s.view = "history";
  host.savePrefs({ xtView: "history" });
  host.showExplainTab();
  live(KIND[kind].doing);
  api.get("/api/ai/status").then((st) => { // 상태 줄의 회사 이름 (첫 경로 칸)
    const first = st && st.kinds && st.kinds[kind] && st.kinds[kind].first;
    if (first) { run.engine = first.engine; paintRun(run); }
  }).catch(() => {});
  let done = null;
  let jobEv = null;
  try {
    await streamEvents(`/api/papers/${s.pid}/explain`, { kind, text: run.text, page: run.page, rects: run.rects, force },
      (ev) => {
        if (ev.type === "delta") { run.partial += ev.text; paintRun(run); }
        else if (ev.type === "done") done = ev;
        else if (ev.type === "queued" || ev.type === "fallback") jobEv = ev;
        else if (ev.type === "error") throw Object.assign(new Error(ev.error || "실패했어요"), { job: ev.job });
      }, run.abort.signal);
  } catch (e) {
    run.abort = null;
    if (S !== s) return;
    if (e.name === "AbortError") { endRun(run); redrawIfHistory(); toast("취소했어요"); return; }
    if (e.status) { endRun(run); redrawIfHistory(); errorToast(e); return; } // 400(이미 한국어 · 경로 없음 등)은 카드 없이
    return failRun(run, e.message);
  }
  run.abort = null;
  if (S !== s) return;
  if (jobEv) return followJob(run, jobEv.job, jobEv.type === "fallback");
  if (!done) return failRun(run, "응답이 끝나기 전에 연결이 끊겼어요");
  endRun(run, true);
  addItem(done.item, done.cached);
}

function redrawIfHistory() {
  if (S && S.view === "history" && box()) drawView();
}

function failRun(run, msg) {
  run.failed = true;
  run.error = msg;
  run.abort = null;
  redrawIfHistory();
  live(`${KIND[run.kind].fail.replace(/\.$/, "")}: ${msg}`);
}

function addItem(item, cached) {
  const old = S.items.findIndex((x) => x.id === item.id);
  if (old >= 0) S.items.splice(old, 1);
  S.items.unshift({ ...item, cached: !!cached });
  redrawIfHistory();
  const li = S.body && $(`[data-xt-id="${Number(item.id)}"]`, S.body);
  if (cached && li) { li.style.background = "var(--accent-soft)"; setTimeout(() => { li.style.background = ""; }, 1500); }
  live(cached ? KIND[item.kind].cached : KIND[item.kind].done);
}

// PC(CLI)로 간 작업 · 폴백 · 다시 연 진행 작업: 작업을 따라가다 끝나면 목록을 다시 받음
function followJob(run, job, fallback = false) {
  const s = S;
  run.job = job;
  run.abort = null;
  if (fallback) run.fallback = true;
  s.run = run;
  redrawIfHistory();
  run.stop = watchJob(job.id, async (j) => {
    if (S !== s || s.run !== run) return;
    if (!j || j.status === "cancelled") { endRun(run); redrawIfHistory(); if (j) toast("취소했어요"); return; }
    run.job = j;
    if (j.status === "succeeded") {
      endRun(run, true);
      try { await loadList(); } catch { /* 다음에 열면 보임 */ }
      const item = s.items.find((x) => x.id === (j.result || {}).explanation_id);
      if (item) addItem(item, false); else redrawIfHistory();
      return;
    }
    if (j.status === "failed") { run.stop = null; return failRun(run, j.error || errorLabel(j.error_code, j.engine)); }
    run.partial = (j.progress || {}).partial_text || run.partial;
    paintRun(run);
  }, { first: job });
}

// ---------------------------------------------------------------------- 전체 번역 (K-1 · K-5 · K-13)
async function loadTr() {
  const s = S;
  const r = await api.get(`/api/papers/${s.pid}/translation`);
  if (S !== s) return null;
  s.tr = r;
  s.trLoaded = true;
  if (ACTIVE(r.job)) watchTr(r.job); else { s.trStop && s.trStop(); s.trStop = null; }
  return r;
}

function watchTr(job) {
  const s = S;
  if (s.trJobId === job.id && s.trStop) return;
  s.trStop && s.trStop();
  s.trJobId = job.id;
  let last = JSON.stringify((job.progress || {}).counts || {});
  s.trStop = watchJob(job.id, async (j) => {
    if (S !== s || !j) return;
    const counts = JSON.stringify((j.progress || {}).counts || {});
    const changed = counts !== last || !ACTIVE(j);
    last = counts;
    s.tr.job = j;
    if (!ACTIVE(j)) {
      s.trStop = null;
      s.trJobId = null;
      await loadTr().catch(() => {});
      if (S !== s) return;
      const c = trCounts(s.tr.translation && s.tr.translation.page_state);
      if (j.status === "succeeded") live(`전체 번역을 마쳤어요. ${c.total}쪽 중 ${c.done}쪽 완료${c.failed ? `, ${c.failed}쪽 실패` : ""}`);
      if (s.view === "paper") drawPaperKeepScroll();
      return;
    }
    if (changed) { await loadTr().catch(() => {}); if (S === s && s.view === "paper") drawPaperKeepScroll(); return; }
    const line = s.body && $("[data-xt-tr-line]", s.body);
    if (line) setStatusLine(line, j, "번역");
  }, { first: job });
}

function drawPaperKeepScroll() {
  const body = S && S.body;
  const top = body ? body.scrollTop : 0;
  drawView();
  if (body) body.scrollTop = top;
}

async function drawPaper() {
  const s = S;
  let b = box();
  if (!s.trLoaded) {
    b.innerHTML = `<div class="ai-cta"><span class="spinner"></span></div>`;
    try { await loadTr(); } catch (e) { if (box()) box().innerHTML = `<div class="msg error">${esc(e.message)}</div>`; return; }
    b = box();
    if (S !== s || s.view !== "paper" || !b) return;
  }
  b.innerHTML = "";
  const { translation: tr, job, estimate } = s.tr;
  if (!tr) {
    const off = !estimate;
    const cta = el(`<div class="ai-cta"><h3>이 논문을 통째로 번역해요</h3>
      <p class="small">끝난 쪽부터 PDF 옆에서 바로 읽을 수 있어요. 시작 전에 쪽 수와 예상 비용을 보여 드려요.</p>
      <button type="button" class="btn primary" data-xt-start ${off ? 'aria-disabled="true" aria-describedby="xt-off-why"' : ""}>전체 번역 시작…</button>
      ${off ? `<p class="small" id="xt-off-why" style="margin-top:8px">PDF 글자를 읽을 수 없는 논문이에요(스캔본).</p>` : ""}</div>`);
    $("[data-xt-start]", cta).onclick = () => (off ? null : startDialog());
    if (ACTIVE(job)) cta.prepend(trStatus(job));
    // 6단계 SW-7(K-28): PDF가 바뀌어 전체 번역을 지웠으면 안내 — 새로 번역을 시작하면 서버가 표시를 비워 사라짐
    if (s.tr.translation_cleared_at) {
      cta.prepend(el(`<div class="notice" data-tone="info" data-tr-cleared><div><b>PDF가 바뀌어 번역을 지웠어요.</b>
        다시 번역하려면 [전체 번역 시작…]을 눌러 주세요.</div></div>`));
    }
    b.appendChild(cta);
    return;
  }
  const st = tr.page_state;
  const c = trCounts(st);
  const active = ACTIVE(job);
  const lang = LANGS[tr.lang] || tr.lang;
  const chip = (cls, ch, label, n) => (n ? `<span class="chip ${cls}" data-page-state="${ch}">${label} ${n}</span>` : "");
  b.appendChild(el(`<div><div class="row small muted" style="margin-bottom:6px">${esc(lang)} 번역 · ${c.total}쪽 중 ${c.done}쪽 완료</div>
    <div class="chips" style="margin-bottom:10px">${chip("success", "d", "완료", c.done)}${chip("", "-", "대기", c.pending)}${chip("warn", "f", "실패", c.failed)}${chip("", "s", "건너뜀", c.skipped)}${chip("", "r", "참고문헌 제외", c.refs)}</div></div>`));
  if (job && (active || job.status === "failed")) b.appendChild(trStatus(job));
  if (active) {
    b.appendChild(el(`<div class="progress" role="progressbar" aria-label="번역 진행" aria-valuemin="0" aria-valuemax="${c.total}" aria-valuenow="${c.done}" aria-valuetext="${c.total}쪽 중 ${c.done}쪽" style="margin:8px 0"><div style="width:${c.total ? Math.round((c.done / c.total) * 100) : 0}%"></div></div>`));
    if (!s.noted) {
      s.noted = true;
      b.appendChild(el(`<div class="notice" data-tone="info" data-keep-open style="margin-bottom:8px">${ICON_INFO}<div>탭을 닫아도 계속돼요. 끝난 쪽부터 바로 읽을 수 있어요.</div></div>`));
    }
  }
  if (tr.error) {
    const n = el(`<div class="notice" data-tone="danger" role="alert" style="margin:8px 0">${ICON_WARN}<div>${esc(tr.error)} <button type="button" class="btn sm" data-xt-delete>번역 지우기</button></div></div>`);
    $("[data-xt-delete]", n).onclick = deleteTr;
    b.appendChild(n);
  }
  if (!s.trPage) s.trPage = Math.min(st.length, Math.max(1, s.host.currentPage() || 1));
  b.appendChild(pageSection(tr, active));
  const row = el(`<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:14px">
    ${!active && c.failed ? `<button type="button" class="btn sm" data-xt-retry="failed">실패한 쪽 다시 (${c.failed})</button>` : ""}
    ${!active && c.pending ? `<button type="button" class="btn sm" data-xt-continue>이어서 번역</button>` : ""}
    ${c.done ? `<button type="button" class="btn sm" data-xt-manuscript>원고로 만들기</button>` : ""}
    ${!active ? `<button type="button" class="btn sm ghost" data-xt-other>다른 언어로 번역…</button>` : ""}
    <span class="spacer"></span><button type="button" class="btn sm ghost danger" data-xt-delete>번역 지우기</button></div>`);
  const on = (sel, fn) => { const x = $(sel, row); if (x) x.onclick = fn; };
  on("[data-xt-retry]", () => continueTr({ pages: "failed" }));
  on("[data-xt-continue]", () => continueTr({ pages: "pending" }));
  on("[data-xt-manuscript]", (e) => makeManuscript(e.currentTarget));
  on("[data-xt-delete]", deleteTr);
  on("[data-xt-other]", () => startDialog(tr.lang)); // 시작 창 → 409면 확인 뒤 replace (품질팀 L-5)
  b.appendChild(row);
}

function trStatus(job) {
  const line = statusLineEl(ACTIVE(job) ? async () => { try { await cancelJob(job.id); } catch (e) { errorToast(e); } } : null);
  line.dataset.xtTrLine = "";
  setStatusLine(line, job, "번역");
  return line;
}

function pageSection(tr, active) {
  const s = S;
  const n = s.trPage;
  const st = tr.page_state;
  const wrap = el(`<div data-xt-page-wrap>
    <div class="xt-head"><h3><button type="button" class="page-link" data-goto="${n}">p.${n}</button> 번역</h3>
      <button type="button" class="icon-btn" data-xt-prev aria-label="이전 쪽 번역" ${n <= 1 ? "disabled" : ""}>◀</button>
      <button type="button" class="icon-btn" data-xt-next aria-label="다음 쪽 번역" ${n >= st.length ? "disabled" : ""}>▶</button>
      <span class="spacer"></span><button type="button" class="btn sm ghost" data-xt-follow aria-pressed="${s.follow}">따라가기</button></div>
    <div data-xt-page="${n}"></div></div>`);
  $("[data-goto]", wrap).onclick = () => s.host.goToPage(n);
  $("[data-xt-prev]", wrap).onclick = () => stepPage(-1);
  $("[data-xt-next]", wrap).onclick = () => stepPage(1);
  $("[data-xt-follow]", wrap).onclick = (e) => {
    s.follow = !s.follow;
    e.currentTarget.setAttribute("aria-pressed", String(s.follow));
    if (s.follow) followPage(s.host.currentPage(), true);
  };
  const slot = $("[data-xt-page]", wrap);
  const v = pageView(st[n - 1], { lang: tr.lang, active, range: trRange(st), code: (tr.page_errors || {})[String(n)] });
  if (v.mode === "text") {
    const text = (tr.pages || {})[String(n)];
    const p = el(`<div class="prose" lang="${esc(tr.lang)}"></div>`);
    p.innerHTML = text ? renderMarkdown(text) : `<p class="small muted">번역 글을 불러오지 못했어요.</p>`;
    slot.appendChild(p);
    if (tr.refs_from === n && !tr.include_refs) slot.appendChild(el(`<p class="small muted">이 아래는 참고문헌이라 번역하지 않았어요.</p>`));
  } else if (v.mode === "wait") {
    slot.appendChild(el(`<p class="small muted">${esc(v.text)} <span class="typing"><span></span><span></span><span></span></span></p>`));
  } else {
    const box2 = el(`<div class="notice"${v.tone ? ` data-tone="${v.tone}"` : ""}>${v.tone ? ICON_WARN : ICON_INFO}<div>${v.strong ? `<b>${esc(v.strong)}</b> ` : ""}${esc(v.text)}</div></div>`);
    if (v.action && !active) {
      const btn = el(`<button type="button" class="btn sm" style="margin-left:6px">${esc(v.action.label)}</button>`);
      btn.onclick = () => continueTr(v.action.includeRefs ? { pages: "pending", include_refs: true }
        : { pages: v.action.pages === "page" ? [n] : v.action.pages });
      $("div", box2).appendChild(btn);
    }
    slot.appendChild(box2);
  }
  return wrap;
}

function showPage(n, announce = false) {
  const s = S;
  const st = s.tr && s.tr.translation && s.tr.translation.page_state;
  if (!st) return;
  n = Math.max(1, Math.min(st.length, n));
  if (n === s.trPage && !announce) return;
  s.trPage = n;
  const wrap = s.body && $("[data-xt-page-wrap]", s.body);
  if (!wrap) return;
  const fresh = pageSection(s.tr.translation, ACTIVE(s.tr.job));
  wrap.replaceWith(fresh);
  const head = $(".xt-head", fresh);
  if (head && s.body) s.body.scrollTop = Math.max(0, head.offsetTop - 4); // 쪽 머리 위치로 (진행 줄은 위에 그대로)
  if (announce) live(`p.${n} 번역을 보여 드려요`);
}

function stepPage(d) {
  const s = S;
  const n = (s.trPage || 1) + d;
  if (s.follow) s.host.goToPage(n); // 따라가기 켬: PDF도 함께 넘김 — 둘이 늘 같은 쪽
  showPage(n, true);
}

// reader.js가 PDF 쪽이 바뀔 때 부름 — 300ms 멈춘 뒤 따라감 (5.3절)
export function followPage(n, now = false) {
  if (!S || !S.follow || S.view !== "paper") return;
  clearTimeout(S.followTimer);
  S.followTimer = setTimeout(() => showPage(n), now ? 0 : 300);
}

async function continueTr(body) {
  const s = S;
  try {
    const r = await api.post(`/api/papers/${s.pid}/translation/continue`, body);
    s.tr.job = r.job;
    watchTr(r.job);
    await loadTr();
  } catch (e) { errorToast(e); return; }
  if (S === s && s.view === "paper") drawPaperKeepScroll();
}

async function deleteTr() {
  const s = S;
  const lang = LANGS[(s.tr.translation || {}).lang] || "";
  if (!(await confirmDialog(`이 논문의 ${lang} 번역을 지울까요? 원고로 만든 글은 남아요.`, { ok: "번역 지우기", danger: true }))) return;
  try { await api.del(`/api/papers/${s.pid}/translation`); } catch (e) { errorToast(e); return; }
  s.trStop && s.trStop();
  s.trStop = null;
  s.trPage = null;
  await loadTr().catch(() => {});
  if (S === s && s.view === "paper") drawView();
  live("지웠어요");
}

async function makeManuscript(btn) {
  btn.setAttribute("aria-busy", "true");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> 만드는 중…`;
  try {
    const r = await api.post(`/api/papers/${S.pid}/translation/manuscript`);
    const a = el(`<a class="btn sm" href="#/write/${Number(r.id)}">원고 열기 →</a>`);
    btn.replaceWith(a);
    toast(`원고 ‘${r.title}’을 만들었어요`, "success");
  } catch (e) {
    errorToast(e);
    btn.removeAttribute("aria-busy");
    btn.disabled = false;
    btn.textContent = "원고로 만들기";
  }
}

// 시작 창 (시안 5.2절)
async function startDialog(current = "") {
  const s = S;
  const est = s.tr.estimate;
  const settings = s.host.settings();
  const [status, devices] = await Promise.all([api.get("/api/ai/status").catch(() => null), api.get("/api/devices").catch(() => [])]);
  const first = status && status.kinds && status.kinds.translate && status.kinds.translate.first;
  let how = "AI를 쓸 수 있는 방법이 없어요 — 설정에서 API 키를 넣거나 PC를 연결해 주세요.";
  if (first && first.runner === "api") how = `${COMPANY[first.engine]} API 키 — 쓰는 만큼 키 계정에 요금이 나가요`;
  else if (first) {
    const pc = (devices || []).find((d) => !d.revoked && d.online && (d.engines || []).some((e) => e.name === first.engine));
    how = `${pc ? `‘${pc.name}’` : "PC"}의 ${first.engine} 구독으로 실행 — 구독 사용 한도를 써요. PC가 꺼져 있으면 24시간까지 기다려요.`;
  }
  let lang0 = LANGS[settings.translate_language] ? settings.translate_language : "ko";
  if (lang0 === current) lang0 = Object.keys(LANGS).find((k) => k !== current); // [다른 언어로 번역…]: 지금 언어가 아닌 것부터
  const form = el(`<form id="xt-start-form" autocomplete="off">
    <div class="field"><label for="xt-lang">번역할 언어</label><select class="input" id="xt-lang">
      ${Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === lang0 ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
      <div class="hint">설정의 ‘번역 언어’가 기본이에요.</div></div>
    <div class="field"><label id="xt-range-l">쪽 범위</label><div class="xt-range" role="group" aria-labelledby="xt-range-l">
      <input class="input" type="number" min="1" max="${est.n}" value="1" aria-label="시작 쪽" data-xt-from> ~
      <input class="input" type="number" min="1" max="${est.n}" value="${est.n}" aria-label="끝 쪽" data-xt-to> / 전체 ${est.n}쪽</div>
      <div class="hint">한 번에 100쪽까지 번역할 수 있어요.</div></div>
    ${est.refs_from ? `<div class="field"><label class="row" style="gap:6px;font-weight:400"><input type="checkbox" data-xt-refs> 참고문헌 이후(p.${est.refs_from}~${est.n})도 번역</label>
      <div class="hint">참고문헌은 보통 번역할 필요가 없어 기본으로 빼요.</div></div>`
    : `<div class="field"><div class="hint">참고문헌 제목을 찾지 못해 모든 쪽을 번역해요.</div></div>`}
    <div class="section-title" style="margin-top:4px">예상 (대략)</div><dl class="kv" data-xt-est></dl>
    <div class="notice hidden" data-tone="warn" data-xt-start-error role="alert"></div>
    <div class="notice" data-tone="info">${ICON_INFO}<div>탭을 닫아도 계속돼요. 끝난 쪽부터 바로 읽을 수 있고, 취소해도 끝난 쪽은 남아요.</div></div>
    <button type="submit" hidden></button></form>`);
  const foot = el(`<div style="display:contents"><button type="button" class="btn" data-no>취소</button>
    <button type="button" class="btn primary" data-go>번역 시작</button></div>`);
  const m = modal({ title: "전체 번역 시작", body: form, foot });
  const go = $("[data-go]", foot);
  const from = $("[data-xt-from]", form);
  const to = $("[data-xt-to]", form);
  const refs = $("[data-xt-refs]", form);
  const lang = $("#xt-lang", form);
  const errBox = $("[data-xt-start-error]", form);
  const read = () => ({ from: Number(from.value) || 1, to: Number(to.value) || est.n, includeRefs: !!(refs && refs.checked), lang: lang.value });
  const recalc = () => {
    const o = read();
    const ok = o.from >= 1 && o.to <= est.n && o.from <= o.to;
    const e = ok ? estimateFor(est, o) : { pages: 0 };
    const kv = $("[data-xt-est]", form);
    if (!e.pages) kv.innerHTML = `<dt>번역할 쪽</dt><dd>번역할 쪽이 없어요</dd>`;
    else {
      const extra = [e.refs ? `참고문헌 이후 ${e.refs}쪽 제외` : "", e.skipped ? `글자 없음 · 이미 같은 언어 ${e.skipped}쪽 건너뜀` : ""].filter(Boolean).join(", ");
      kv.innerHTML = `<dt>번역할 쪽</dt><dd>${e.pages}쪽${extra ? ` (${esc(extra)})` : ""}</dd>
        <dt>토큰</dt><dd>입력 ${esc(fmtTok(e.input))} · 출력 ${esc(fmtTok(e.output))}</dd><dt>시간</dt><dd>약 ${e.minutes}분</dd>
        <dt>실행</dt><dd>${esc(how)}</dd>`;
    }
    go.disabled = !e.pages || e.pages > 100;
    go.textContent = e.pages ? `번역 시작 (${e.pages}쪽)` : "번역 시작";
  };
  [from, to, lang, refs].forEach((x) => x && x.addEventListener("input", recalc));
  recalc();
  setTimeout(() => lang.focus(), 40);
  const submit = async (replace = false) => {
    if (go.disabled) return;
    const o = read();
    errBox.classList.add("hidden");
    go.disabled = true;
    try {
      const r = await api.post(`/api/papers/${s.pid}/translation`, { lang: o.lang, from: o.from, to: o.to, include_refs: o.includeRefs, replace });
      m.close();
      s.trPage = null;
      s.noted = false;
      watchTr(r.job);
      await loadTr().catch(() => {});
      if (S === s && s.view === "paper") drawView();
    } catch (e) {
      go.disabled = false;
      if (e.status === 409 && e.code === "other_lang") {
        if (await confirmDialog(e.message, { ok: "지우고 새로 번역", danger: true })) submit(true);
        return;
      }
      errBox.innerHTML = `${ICON_WARN}<div>${esc(e.message)}${e.code === "no_route" ? ' <a href="#" data-set>설정 열기</a>' : ""}</div>`;
      errBox.classList.remove("hidden");
      const set = $("[data-set]", errBox);
      if (set) set.onclick = (ev) => { ev.preventDefault(); m.close(); import("./dialogs.js").then((d) => d.settingsDialog()); };
    }
  };
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  go.onclick = () => submit();
  $("[data-no]", foot).onclick = () => m.close();
}
