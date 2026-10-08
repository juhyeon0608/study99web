// 논문 쓰기 화면의 참고 패널 (docs/specs/writing-reference-pane.md · docs/design/writing-reference-pane-ui.md)
// - PDF · 하이라이트 · 요약은 reader.js 임베드 모드(mountPdf — 같은 전역 R)를 쓴다. 넣기는 writing.js의 insertText 하나로.
// - 넣는 글의 모양은 refquote.js(순수 함수 — QUOTE_STYLE 한 곳)가 정한다.
// - 추천은 POST /api/graph/recommend(SSE). 씨앗은 본문의 서재 논문 id로만 보낸다(주소 쿼리에 넣지 않음).
//   결과는 브라우저 메모리에만(원고별 최근 1개) — localStorage에 쓰지 않고 로그아웃 때 비운다(9.8절).
// - 제목 · 저자 · 초록 · 하이라이트 · 노트 글은 esc() · textContent로만 넣는다.

import { api, streamEvents } from "./api.js";
import {
  EXT_MARK, ICON_INFO, ICON_WARN, SCHOLAR_LIBRARY_NOTE, addPaper, bindExtLink, editPaperDialog, issuesBox, settingsDialog,
} from "./dialogs.js";
import { INHA, paperProxyTarget, scholarUrl } from "./extlinks.js";
import { WARN_TEXT, firstFamily, fmt, scholarQuery, shortTitle, stepStates } from "./graphmath.js";
import { closeReader, drawSummary, embedPdf, highlightsTab, mountPdf, savePrefs as saveReaderPrefs } from "./reader.js";
import {
  basisText, citeMark, directQuote, manuscriptSeeds, ownWords, pageLocator, seedSignature, spaced,
} from "./refquote.js";
import { $, $$, authorsShort, el, errorToast, esc, modalOpen, safeUrl, toast } from "./ui.js";

// 오른쪽에 칸이 붙은 창 (도구 막대 [참고])
export const ICON_REF = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M16.5 8.5h2M16.5 12h2"/></svg>`;
const PREF_KEY = "paperlab.writeRef";
const RECENT_MAX = 8;
const PICK_DELAY = 400; // 닫힌 고르기 상자에서 ↑↓만 눌러도 change가 나는 브라우저 — 칸마다 PDF를 받지 않게(RD-4)
const NARROW = "(max-width: 1500px)"; // 패널이 열리면 [나란히]에서 미리보기가 숨는 폭(명세 6장)
const SPLIT_TITLE = "참고 패널을 닫거나 화면을 넓히면 미리보기도 보여요";
const INHA_OPEN_TITLE = `${INHA.proxyName}(정석학술정보관)로 원문 페이지를 열어요`;
const TABS = [["pdf", "PDF"], ["notes", "하이라이트·노트"], ["summary", "요약"], ["info", "정보"], ["recs", "추천"]];
const LOCKED = new Set(["pdf", "notes", "summary"]); // 서재 밖 논문에서 잠기는 탭
const KIND_TEXT = { coupling: "같은 참고문헌", cocitation: "함께 인용됨", related: "주제가 비슷함(인용 근거 없음)" };
const REC_STEPS = [["seeds", "인용 논문 정보 모으기"], ["finish", "초록 받기"], ["compute", "추천 계산"]];
const REC_STEP_IDS = REC_STEPS.map(([s]) => s);
const REC_ERR = {
  upstream_limited: ["OpenAlex 하루 사용량을 다 썼어요", "한국 시간 오전 9시에 초기화돼요. 설정에서 OpenAlex API 키(무료)를 넣으면 한도가 10배가 돼요.", "settings"],
  upstream_unavailable: ["OpenAlex에 연결할 수 없어요", "잠시 후 다시 시도해 주세요.", "retry"],
  internal: ["추천을 찾지 못했어요", "잠시 후 다시 시도해 주세요.", "retry"],
  graph_busy: ["이미 그래프나 추천을 만드는 중이에요", "다른 탭에서 그래프나 추천을 만드는 중이에요. 끝난 뒤 다시 눌러 주세요.", "retry"],
  graph_queue_full: ["지금 요청이 많아요", "잠시 후 다시 시도해 주세요.", "retry"],
  bad_request: ["추천 요청이 올바르지 않아요", "원고를 다시 열어 보고, 계속되면 알려 주세요.", "retry"],
  disconnected: ["연결이 끊겼어요", "그동안 받은 정보는 저장돼 있어서 다시 계산하면 더 빨라요.", "retry"],
};

let P = null; // 지금 원고 화면의 패널 상태 (원고 화면이 하나뿐이라 하나)
const recMemory = new Map(); // 원고 id → 추천 상태 {sig, ids, status, result, …} (브라우저 메모리만)

// 로그아웃 · 다른 계정으로 로그인할 때: 진행 중인 추천을 멈추고 결과를 비운다
export function resetRefMemory() {
  if (P) P.destroy();
  for (const st of recMemory.values()) if (st.ctl) st.ctl.abort();
  recMemory.clear();
}

function prefs() {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch { return {}; }
}
function savePrefs(patch) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ ...prefs(), ...patch })); } catch { /* 저장 못 함 */ }
}
// 최근 연 논문: 원고별 서재 논문 id만(최대 8, 새것이 앞 — 10장)
function loadRecent(mid) {
  try {
    const v = JSON.parse(localStorage.getItem(`${PREF_KEY}.recent.${mid}`) || "[]");
    return Array.isArray(v) ? v.filter((x) => Number.isInteger(x) && x > 0).slice(0, RECENT_MAX) : [];
  } catch { return []; }
}
function saveRecent() {
  try { localStorage.setItem(`${PREF_KEY}.recent.${P.mid}`, JSON.stringify(P.recent)); } catch { /* 저장 못 함 */ }
}

const visible = (node) => !!(node && node.offsetParent);
const cut = (t, n = 80) => shortTitle(t || "제목 없음", n);

// ------------------------------------------------------------------ 진입 (writing.js가 부름)
// view = section.writer, aside = .ref-pane 자리, hooks = { mid, ta, insert(text), pick(onPick), papers(), built(),
// libraryChanged() }. 돌려주는 것: { toggle, altR, open(pid, opts), citesChanged, layout, currentId, destroy }
export function refPane(view, aside, hooks) {
  if (P) P.destroy();
  const p0 = prefs();
  P = {
    view, aside, mid: hooks.mid, ta: hooks.ta, hooks, open: false,
    tab: TABS.some(([k]) => k === p0.tab) ? p0.tab : "pdf",
    recent: loadRecent(hooks.mid), current: null, paper: null, ext: null, loading: false, error: null, summary: undefined,
    seq: 0, drawTok: 0, noticed: new Set(), mq: matchMedia(NARROW), toggleBtn: $("[data-ref-toggle]", view),
  };
  const me = P;
  P.onMq = () => layout();
  P.mq.addEventListener("change", P.onMq);
  P.onKey = (e) => { // Alt+R (RD-1): 닫혀 있으면 열기 · 열려 있고 초점이 밖이면 패널로 · 안이면 닫기
    if (e.code !== "KeyR" || !e.altKey || e.ctrlKey || e.metaKey || e.repeat || modalOpen()) return;
    e.preventDefault(); // macOS Option+R의 ® 막기
    altR();
  };
  document.addEventListener("keydown", P.onKey);
  P.destroy = () => {
    if (P !== me) return;
    clearTimeout(me.pickTimer);
    me.mq.removeEventListener("change", me.onMq);
    document.removeEventListener("keydown", me.onKey);
    closeReader();
    const st = recMemory.get(me.mid);
    if (st && st.ctl) st.ctl.abort(); // 원고를 떠나면 추천도 멈춤(9.9절)
    P = null;
  };
  drawFrame();
  if (p0.open) show({ focus: false });
  return {
    toggle: () => (P === me && (me.open ? hide() : show({ focus: true }))),
    altR: () => P === me && altR(),
    open: (pid, opts) => P === me && openFrom(pid, opts),
    citesChanged: () => P === me && citesChanged(),
    layout: () => P === me && layout(),
    currentId: () => (P === me && me.open && me.paper ? me.paper.id : null),
    destroy: () => me.destroy(),
  };
}

function say(msg) {
  const live = $("[data-ref-live]", P.view);
  if (!live) return;
  live.textContent = "";
  setTimeout(() => { if (live.isConnected) live.textContent = msg; }, 60);
}

function layout() {
  const split = $('[data-view] button[data-v="split"]', P.view);
  if (!split) return;
  if (P.open && P.mq.matches) split.title = SPLIT_TITLE;
  else split.removeAttribute("title");
}

function focusEditor() {
  if (visible(P.ta)) P.ta.focus();
  else if (P.toggleBtn) P.toggleBtn.focus();
}

function focusPick() {
  const pick = $("[data-ref-pick]", P.aside);
  if (pick) pick.focus();
}

function show({ focus = true, pid = null } = {}) {
  P.open = true;
  P.view.dataset.ref = "open";
  if (P.toggleBtn) P.toggleBtn.setAttribute("aria-pressed", "true");
  savePrefs({ open: true });
  layout();
  const target = pid || (!P.paper && !P.ext && !P.loading ? P.recent[0] : null);
  if (target) openPaper(target);
  else { drawPick(); drawTab(); }
  if (focus) focusPick();
}

function hide() {
  clearTimeout(P.pickTimer);
  P.open = false;
  delete P.view.dataset.ref;
  if (P.toggleBtn) P.toggleBtn.setAttribute("aria-pressed", "false");
  savePrefs({ open: false });
  P.seq++;
  closeReader(); // PDF 메모리 풀기(추천은 계속 — 9.9절)
  Object.assign(P, { paper: null, ext: null, current: null, loading: false, error: null, summary: undefined });
  layout();
  markCiteRows();
  focusEditor();
}

function altR() {
  if (!P.open) return show({ focus: true });
  if (P.aside.contains(document.activeElement)) return hide();
  focusPick();
}

// 왼쪽 "이 원고의 인용" · 자동완성 [보기]: peek = 원고 입력을 끊지 않음(초점 그대로).
// page: PDF 탭의 그 쪽으로 (3단계 인용 검증 근거 — 시안 6.2절)
function openFrom(pid, { peek = false, title = "", page = null } = {}) {
  P.goPage = page ? { pid, page } : null;
  if (!P.open) show({ focus: false, pid });
  else if (P.current !== pid || P.ext) openPaper(pid);
  else goPending();
  if (peek) say("참고 패널에서 열었어요: " + (title || "논문"));
  else focusPick();
}

function goPending() {
  const g = P.goPage;
  if (!g || !P.paper || P.paper.id !== g.pid) return;
  P.goPage = null;
  setTab("pdf");
  embedPdf(g.page);
  say(`참고 패널에서 p.${g.page}를 열었어요`);
}

// ------------------------------------------------------------------ 틀 · 고르기 상자 · 탭
function drawFrame() {
  P.aside.innerHTML = `<div class="ref-head">
      <select class="input ref-pick" data-ref-pick aria-label="열린 논문"></select>
      <button type="button" class="btn sm" data-ref-cite aria-label="이 논문 인용 넣기">＋ 인용</button>
      <button type="button" class="icon-btn" data-ref-close aria-label="참고 패널 닫기" title="닫기 (Alt+R)">✕</button>
    </div>
    <div class="tabs" role="tablist" aria-label="참고 자료">${TABS.map(([k, name]) =>
      `<button type="button" role="tab" id="ref-tab-${k}" data-ref-tab="${k}" aria-controls="${k === "pdf" ? "ref-pdf" : "ref-tabpanel"}" aria-selected="false" tabindex="-1">${name}${k === "recs" ? `<span class="graph-tab-n"></span>` : ""}</button>`).join("")}</div>
    <div class="ref-pdf hidden" id="ref-pdf" role="tabpanel" aria-labelledby="ref-tab-pdf"></div>
    <div class="panel-body hidden" id="ref-tabpanel" role="tabpanel" aria-labelledby="ref-tab-pdf" data-ref-body></div>`;
  const pick = $("[data-ref-pick]", P.aside);
  pick.onchange = () => {
    clearTimeout(P.pickTimer);
    const v = pick.value;
    P.pickTimer = setTimeout(() => {
      if (!P) return;
      if (v === "__pick") { pick.value = P.pickValue; return pickOther(); }
      const id = Number(v);
      if (id && id !== P.current) openPaper(id, { user: true });
    }, PICK_DELAY);
  };
  $("[data-ref-cite]", P.aside).onclick = () => { if (P.paper) put(citeMark(P.paper.citekey)); };
  $("[data-ref-close]", P.aside).onclick = hide;
  const tabs = $$("[data-ref-tab]", P.aside);
  for (const t of tabs) {
    t.onclick = () => setTab(t.dataset.refTab);
    t.onkeydown = (e) => {
      const i = tabs.indexOf(t);
      const j = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
      if (j === undefined) return;
      e.preventDefault();
      setTab(tabs[j].dataset.refTab, { focus: true });
    };
  }
  P.aside.addEventListener("keydown", (e) => { // Esc: 떠 있는 상자가 없으면 원고로(패널은 닫지 않음)
    if (e.key !== "Escape" || modalOpen() || document.querySelector(".sel-pop")) return;
    e.preventDefault();
    focusEditor();
  });
  drawTabs();
}

function drawPick() {
  const pick = $("[data-ref-pick]", P.aside);
  const byId = new Map((P.hooks.papers() || []).map((p) => [p.id, p]));
  if (P.paper) byId.set(P.paper.id, P.paper);
  const recent = P.recent.filter((id) => byId.has(id));
  let html = "";
  if (P.ext) html += `<option value="ext" selected>${esc("서재 밖 · " + cut(P.ext.paper.title))}</option>`;
  else if (!P.current || !byId.has(P.current)) html += `<option value="" selected disabled>${P.loading ? "불러오는 중…" : "열린 논문 없음"}</option>`;
  if (recent.length) {
    const label = (id) => esc(cut(byId.get(id).title));
    html += `<optgroup label="최근 연 논문">${recent.map((id) => `<option value="${id}" ${!P.ext && id === P.current ? "selected" : ""}>${label(id)}</option>`).join("")}</optgroup>`;
  }
  html += `<option value="__pick">다른 논문 찾기…</option>`;
  pick.innerHTML = html;
  pick.title = P.ext ? P.ext.paper.title || "" : P.paper ? P.paper.title || "" : "";
  P.pickValue = pick.value;
  const cite = $("[data-ref-cite]", P.aside);
  cite.disabled = !P.paper;
  cite.title = P.paper ? "이 논문 인용을 원고 커서 자리에 넣어요 (" + citeMark(P.paper.citekey) + ")" : P.ext ? "서재에 추가하면 인용할 수 있어요" : "";
}

function pickOther() {
  P.hooks.pick((keys) => {
    const p = (P.hooks.papers() || []).find((x) => x.citekey === keys[0]);
    if (p) openPaper(p.id, { user: true });
  });
}

function drawTabs() {
  for (const t of $$("[data-ref-tab]", P.aside)) {
    const k = t.dataset.refTab;
    const on = k === P.tab;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
    if (P.ext && LOCKED.has(k)) t.setAttribute("aria-disabled", "true");
    else t.removeAttribute("aria-disabled");
  }
  const st = recMemory.get(P.mid);
  const n = st && st.status === "ready" && st.result ? st.result.items.length : null;
  $("#ref-tab-recs .graph-tab-n", P.aside).textContent = n == null ? "" : String(n);
}

function setTab(tab, { focus = false } = {}) {
  P.tab = tab;
  savePrefs({ tab });
  drawTabs();
  if (focus) $(`#ref-tab-${tab}`, P.aside).focus();
  drawTab();
}

// 지금 탭 내용. PDF 칸(.ref-pdf)은 지우지 않고 숨기기만(다른 탭을 보는 동안에도 PDF를 다시 받지 않게)
function drawTab() {
  const tok = ++P.drawTok;
  const pdf = $("#ref-pdf", P.aside);
  const body = $("[data-ref-body]", P.aside);
  const t = P.tab;
  const showPdf = t === "pdf" && !!P.paper && !P.loading;
  pdf.classList.toggle("hidden", !showPdf);
  body.classList.toggle("hidden", showPdf);
  body.setAttribute("aria-labelledby", `ref-tab-${t}`);
  if (showPdf) return embedPdf();
  body.innerHTML = "";
  if (t === "recs") return drawRecs(body, { auto: true });
  if (P.loading) {
    body.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
    return;
  }
  if (P.error) return drawError(body);
  if (!P.paper && !P.ext) return drawEmpty(body);
  if (P.ext && LOCKED.has(t)) return drawLocked(body);
  if (t === "notes") return drawNotes(body);
  if (t === "summary") return drawSummaryTab(body, tok);
  return drawInfo(body, tok);
}

function stateBox(body, title, text, buttons, { focus = false, attr = "" } = {}) {
  const box = el(`<div ${attr}><div class="empty"><h3 tabindex="-1">${esc(title)}</h3><p>${esc(text)}</p>
    <div class="empty-actions">${buttons}</div></div></div>`);
  body.appendChild(box);
  if (focus) setTimeout(() => { if (box.isConnected) $("h3", box).focus(); }, 0);
  return box;
}

function drawEmpty(body) {
  const box = stateBox(body, "옆에 띄워 볼 논문을 골라 주세요", "원고에 인용한 논문이나 서재 논문을 골라 옆에 띄워 보세요.",
    `<button type="button" class="btn primary" data-ref-browse>서재에서 고르기</button><button type="button" class="btn" data-ref-goto-recs>추천 보기</button>`);
  $("[data-ref-browse]", box).onclick = pickOther;
  $("[data-ref-goto-recs]", box).onclick = () => setTab("recs", { focus: true });
}

function drawError(body) {
  const gone = P.error === "gone";
  const box = stateBox(body, gone ? "서재에서 이 논문을 찾지 못했어요" : "논문 정보를 불러오지 못했어요",
    gone ? "삭제됐을 수 있어요. 최근 목록에서도 뺐어요." : "잠시 후 다시 시도해 주세요.",
    `${gone ? "" : `<button type="button" class="btn primary" data-ref-retry>다시 시도</button>`}<button type="button" class="btn${gone ? " primary" : ""}" data-ref-browse>다른 논문 고르기</button>`,
    { focus: P.errorFocus });
  const retry = $("[data-ref-retry]", box);
  if (retry) retry.onclick = () => openPaper(P.current, { user: true });
  $("[data-ref-browse]", box).onclick = pickOther;
}

function drawLocked(body) {
  const box = stateBox(body, "서재에 추가하면 볼 수 있어요",
    "추천에서 연 서재 밖 논문은 정보만 볼 수 있어요. 서재에 추가하면 PDF · 하이라이트 · 요약을 볼 수 있어요.",
    `<button type="button" class="btn primary" data-ref-add>＋ 서재에 추가</button>`);
  const add = $("[data-ref-add]", box);
  add.onclick = () => addRec(P.ext, add, { cite: false, then: "open" });
}

// ------------------------------------------------------------------ 논문 열기
// 서재 논문: 정보(노트 포함)를 받고 reader.js 임베드 모드로 R · 하이라이트를 만든다(PDF는 PDF 탭을 볼 때)
async function openPaper(pid, { user = false } = {}) {
  clearTimeout(P.pickTimer);
  const me = P;
  const seq = ++P.seq;
  closeReader();
  Object.assign(P, { current: pid, paper: null, ext: null, loading: true, error: null, summary: undefined });
  P.aside.setAttribute("aria-busy", "true");
  drawPick();
  drawTabs();
  drawTab();
  markCiteRows();
  let paper;
  try {
    paper = await api.get(`/api/papers/${pid}`);
  } catch (e) {
    if (P !== me || seq !== P.seq) return;
    P.loading = false;
    P.aside.removeAttribute("aria-busy");
    if (e.status === 404) { // 서재에서 지워짐: 최근 목록에서 조용히 뺌
      P.recent = P.recent.filter((x) => x !== pid);
      saveRecent();
    }
    Object.assign(P, { error: e.status === 404 ? "gone" : "load", errorFocus: user });
    drawPick();
    drawTab();
    return;
  }
  if (P !== me || seq !== P.seq) return;
  P.recent = [pid, ...P.recent.filter((x) => x !== pid)].slice(0, RECENT_MAX);
  saveRecent();
  const pdfHost = $("#ref-pdf", P.aside);
  await mountPdf(pdfHost, paper, {
    basis: basisText(paper),
    onQuote: ({ text, pages }) => quote(text, pages),
    onGoto: (n) => { setTab("pdf"); embedPdf(n); const s = $(".pdf-scroll", pdfHost); if (s) s.focus(); },
    onChange: () => { if (P && P.tab === "notes" && P.paper) drawTab(); },
    onAttached: (p) => { if (P && P.paper && P.paper.id === p.id) openPaper(p.id); }, // PDF 첨부가 끝남 → 패널만 다시
  });
  if (P !== me || seq !== P.seq) return;
  Object.assign(P, { paper, loading: false });
  P.aside.removeAttribute("aria-busy");
  drawPick();
  drawTab();
  markCiteRows();
  goPending();
}

// 추천에서 연 서재 밖 논문: 정보 탭만(메모리에만 — 다른 논문으로 바꾸면 사라짐)
function openExt(item) {
  P.seq++;
  closeReader();
  Object.assign(P, { current: null, paper: null, ext: item, loading: false, error: null, summary: undefined });
  P.aside.removeAttribute("aria-busy");
  drawPick();
  markCiteRows();
  setTab("info");
  const t = $(".graph-paper-title", P.aside);
  if (t) t.focus();
}

// 왼쪽 "이 원고의 인용" 줄: 지금 패널에 열린 논문에 aria-current
function markCiteRows() {
  const cur = P.open && P.current ? String(P.current) : "";
  for (const b of $$("button.cite-row[data-ref-open]", P.view)) {
    if (b.dataset.refOpen === cur) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  }
}

// ------------------------------------------------------------------ 원고에 넣기 (8장)
// 모든 넣기는 writing.js의 insertText 하나로(커서 자리 · 저장 · 미리보기 갱신 · 초점은 원고).
// 편집 칸이 숨어 있으면(미리보기 보기) 화면 읽기 알림에 더해 토스트(RD-6)
function put(text, { block = false, msg = "원고에 넣었어요", extra = "" } = {}) {
  const ta = P.ta;
  const origin = document.activeElement;
  P.hooks.insert(spaced(ta.value.slice(0, ta.selectionStart), text, block, ta.value.slice(ta.selectionEnd)));
  say(extra ? `${msg}. ${extra}` : msg);
  if (!visible(ta)) {
    toast(msg, "success");
    keepFocus(origin);
  }
  if (extra) toast(extra, "", { duration: 8000 });
}

// 편집 칸이 숨어 있을 때(미리보기 보기): 초점은 누른 단추에 그대로, 그 단추가 다시 그려져 없어졌으면 [참고] 버튼으로
function keepFocus(origin) {
  if (visible(P.ta)) return;
  const target = origin && origin.isConnected && origin !== document.body ? origin : P.toggleBtn;
  if (target) target.focus();
}

// 인쇄 쪽을 모르는 논문은 처음 넣을 때 한 번 안내(8.5절 2번)
function pageExtra(p, loc, printed) {
  if (printed || !loc || P.noticed.has(p.id)) return "";
  P.noticed.add(p.id);
  return `인쇄된 쪽 번호를 알 수 없어 PDF 쪽(${loc.replace(/^pp?\. /, "")})으로 넣었어요. 필요하면 원고에서 고쳐 주세요.`;
}

function quote(text, pages) {
  const p = P && P.paper;
  if (!p) return;
  const { loc, printed } = pageLocator(p, pages);
  const q = directQuote(text, p.citekey, loc);
  put(q.text, { block: q.block, extra: pageExtra(p, loc, printed) });
}

function insertAnn(a, kind) {
  const p = P.paper;
  if (kind === "quote") return quote(a.text, [a.page]);
  const { loc, printed } = pageLocator(p, [a.page]);
  put(ownWords(a.comment, p.citekey, loc), { extra: pageExtra(p, loc, printed) });
}

// ------------------------------------------------------------------ 하이라이트·노트 (7.2절)
function drawNotes(body) {
  const list = el(`<div></div>`);
  body.appendChild(list);
  highlightsTab(list, { onInsert: insertAnn });
  body.appendChild(el(`<div class="section-title">노트</div>`));
  const note = String(P.paper.note || "");
  if (!note.trim()) {
    body.appendChild(el(`<p class="small muted" data-note-empty>노트가 없어요. 읽기 화면에서 쓸 수 있어요.</p>`));
    return;
  }
  const ta = el(`<textarea class="input ref-note" readonly rows="8" aria-label="노트 (읽기 전용)" aria-describedby="ref-note-hint"></textarea>`);
  ta.value = note;
  const row = el(`<div class="ref-note-actions"><button type="button" class="btn sm" data-note-insert disabled aria-describedby="ref-note-hint">선택한 부분 넣기</button>
    <span class="small muted" id="ref-note-hint">노트에서 넣을 부분을 고르세요. 노트는 읽기 화면에서 고칠 수 있어요.</span></div>`);
  const btn = $("[data-note-insert]", row);
  const sync = () => { btn.disabled = ta.selectionStart === ta.selectionEnd; };
  for (const ev of ["select", "keyup", "mouseup"]) ta.addEventListener(ev, sync);
  btn.onclick = () => {
    const text = ta.value.slice(ta.selectionStart, ta.selectionEnd);
    if (text.trim()) put(ownWords(text, P.paper.citekey));
  };
  body.append(ta, row);
}

// ------------------------------------------------------------------ 요약 (7.3절) — 이미 있는 것만 보여 줌
async function drawSummaryTab(body, tok) {
  const me = P;
  const p = P.paper;
  if (P.summary === undefined) {
    body.innerHTML = `<div class="ai-cta"><span class="spinner"></span></div>`;
    let r;
    try {
      r = await api.get(`/api/papers/${p.id}/summary`);
    } catch {
      if (P !== me || tok !== P.drawTok) return;
      body.innerHTML = "";
      const v = el(`<div class="ai-cta"><h3>요약을 불러오지 못했어요</h3><button type="button" class="btn primary" data-ref-retry>다시 시도</button></div>`);
      $("[data-ref-retry]", v).onclick = () => drawTab();
      body.appendChild(v);
      return;
    }
    if (P !== me || P.paper !== p) return;
    P.summary = r.summary || null;
    if (tok !== P.drawTok) return;
    body.innerHTML = "";
  }
  if (P.summary) return drawSummary(body, P.summary, { ask: false });
  const v = el(`<div class="ai-cta" data-ref-summary="none"><div class="big">✦</div><h3>아직 AI 요약이 없어요</h3>
    <p class="small">읽기 화면에서 만들 수 있어요. 원고는 자동으로 저장돼요.</p>
    <a class="btn primary" href="#/read/${p.id}" data-ref-read>읽기 화면에서 열기</a></div>`);
  // 읽기 화면이 요약 탭으로 열리게(그곳의 [요약 만들기]를 사용자가 누름 — 패널에서 AI를 부르지 않음, RD-3)
  $("[data-ref-read]", v).onclick = () => saveReaderPrefs({ tab: "summary" });
  body.appendChild(v);
}

// ------------------------------------------------------------------ 정보 (7.4절)
function abstractBlock(box, text) {
  if (!text) {
    box.appendChild(el(`<p class="small muted">초록이 없어요.</p>`));
    return;
  }
  const abs = el(`<div class="abstract clamp" id="ref-abs"></div>`);
  abs.textContent = text;
  const tog = el(`<button type="button" class="btn sm ghost graph-abs-toggle hidden" aria-expanded="false" aria-controls="ref-abs">펼치기</button>`);
  box.append(abs, tog);
  requestAnimationFrame(() => { if (abs.scrollHeight > abs.clientHeight + 2) tog.classList.remove("hidden"); });
  tog.onclick = () => {
    const open = abs.classList.toggle("clamp") === false;
    tog.setAttribute("aria-expanded", open ? "true" : "false");
    tog.textContent = open ? "접기" : "펼치기";
  };
}

function titleHtml(p) {
  const url = safeUrl(p.url) || (p.doi ? safeUrl("https://doi.org/" + p.doi) : "");
  const t = esc(p.title || "제목 없음");
  return `<h2 class="graph-paper-title" tabindex="-1">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${t}${EXT_MARK}</a>` : t}</h2>`;
}

function venueLine(p) {
  return [p.venue, p.issued || (Number.isInteger(p.year) ? p.year : "")].filter(Boolean).join(" · ");
}

async function drawInfo(body, tok) {
  if (P.ext) return drawExtInfo(body);
  const me = P;
  const p = P.paper;
  const venue = venueLine(p);
  const box = el(`<div class="graph-paper">${titleHtml(p)}
    <div class="graph-paper-authors">${esc(authorsShort(p.authors, 8))}</div>
    ${venue ? `<div class="graph-paper-venue">${esc(venue)}</div>` : ""}
    <div class="actions"><button type="button" class="btn sm primary" data-ref-insert-key>인용 넣기</button>
      <a class="btn sm" href="#/read/${p.id}" data-ref-read>읽기 화면에서 열기</a></div>
    <div data-issues></div>
    <dl class="kv"><dt>인용키</dt><dd><code>@${esc(p.citekey)}</code></dd>
      ${p.doi ? `<dt>DOI</dt><dd><a href="${esc("https://doi.org/" + p.doi)}" target="_blank" rel="noopener noreferrer">${esc(p.doi)}${EXT_MARK}</a></dd>` : ""}
      ${p.pages ? `<dt>쪽</dt><dd>${esc(p.pages)}</dd>` : ""}</dl>
    <div class="section-title">초록</div></div>`);
  $("[data-ref-insert-key]", box).onclick = () => put(citeMark(p.citekey));
  abstractBlock(box, p.abstract);
  body.appendChild(box);
  try { // 인용 정보가 빈 경우 경고(채우기 버튼 포함) — 지금 issuesBox 재사용
    const cite = await api.get(`/api/papers/${p.id}/cite`);
    if (P !== me || tok !== P.drawTok) return;
    const ib = issuesBox(cite.issues, async () => editPaperDialog(await api.get(`/api/papers/${p.id}`)));
    if (ib) $("[data-issues]", box).appendChild(ib);
  } catch { /* 경고 없이 */ }
}

// 바깥 링크(RD-2 — 1A 규칙): 인하대는 대상이 있을 때만(처음이면 안내 창), Scholar 질의 = 제목(없으면 DOI)
function extLinks(p, cls) {
  const out = [];
  const proxy = paperProxyTarget(p);
  if (proxy) {
    const a = el(`<a class="${cls}" href="${esc(proxy)}" target="_blank" rel="noopener noreferrer" data-inha-open title="${esc(INHA_OPEN_TITLE)}">${esc(INHA.buttons.view)}${EXT_MARK}</a>`);
    bindExtLink(a);
    out.push(a);
  }
  const q = scholarQuery(p);
  if (q) out.push(el(`<a class="${cls}" href="${esc(scholarUrl(q))}" target="_blank" rel="noopener noreferrer" data-scholar-open title="${esc(SCHOLAR_LIBRARY_NOTE)}">${esc(INHA.buttons.scholar)}${EXT_MARK}</a>`));
  return out;
}

// 씨앗 번호 → 원고에 인용한 서재 논문의 인용키 (서버는 번호만 돌려줌 — 9.6절)
function seedKeys(seeds) {
  const byNo = new Map((P.hooks.papers() || []).map((x) =>
    [String(x.openalex_id || "").trim().replace(/^https:\/\/openalex\.org\//, ""), "@" + x.citekey]));
  return (seeds || []).map((w) => byNo.get(w)).filter(Boolean);
}

function reasonText(it) {
  const keys = seedKeys(it.seeds);
  const link = keys.length ? (it.linked > 1 ? `${keys[0]} 외 ${it.linked - 1}편과 연결` : `${keys[0]}와 연결`) : `내 인용 ${it.linked}편과 연결`;
  return `${KIND_TEXT[it.kind] || ""} · ${link}`;
}

function drawExtInfo(body) {
  const it = P.ext;
  const p = it.paper;
  const venue = venueLine(p);
  const box = el(`<div class="graph-paper">
    <button type="button" class="btn sm ghost graph-list-back" data-ref-back-recs>← 추천 목록</button>
    <div class="chips"><span class="chip">서재 밖 논문</span><span class="chip accent">내 인용 ${Number(it.linked) || 0}편과 연결</span></div>
    ${titleHtml(p)}
    <div class="graph-paper-authors">${esc(authorsShort(p.authors, 8))}</div>
    ${venue ? `<div class="graph-paper-venue">${esc(venue)}</div>` : ""}
    <div class="actions"><button type="button" class="btn sm primary" data-ref-add>＋ 서재에 추가</button>
      ${safeUrl(p.pdf_url) ? `<button type="button" class="btn sm" data-ref-addpdf>PDF 포함 추가</button>` : ""}
      <button type="button" class="btn sm" data-ref-addcite>추가하고 인용</button></div>
    <dl class="kv"><dt>추천 이유</dt><dd>${esc(reasonText(it))}</dd>
      <dt>피인용</dt><dd>${esc(fmt(p.cited_by_count || 0))}회</dd>
      ${p.doi ? `<dt>DOI</dt><dd><a href="${esc("https://doi.org/" + p.doi)}" target="_blank" rel="noopener noreferrer">${esc(p.doi)}${EXT_MARK}</a></dd>` : ""}</dl>
    <div class="section-title">초록</div></div>`);
  const actions = $(".actions", box);
  actions.append(...extLinks(p, "btn sm"));
  $("[data-ref-back-recs]", box).onclick = () => {
    setTab("recs");
    const b = $(`[data-ref-rec="${CSS.escape(it.id)}"]`, P.aside);
    if (b) b.focus();
  };
  const add = $("[data-ref-add]", box);
  add.onclick = () => addRec(it, add, { then: "open" });
  const addPdf = $("[data-ref-addpdf]", box);
  if (addPdf) addPdf.onclick = () => addRec(it, addPdf, { pdf: true, then: "open" });
  const addCite = $("[data-ref-addcite]", box);
  addCite.onclick = () => addRec(it, addCite, { cite: true, then: "open" });
  abstractBlock(box, p.abstract);
  body.appendChild(box);
}

// 서재에 추가(1B doAdd와 같은 모양) → 추천 표시 갱신 · 자동완성 · 미리보기의 주황 표시가 풀리게(libraryChanged).
// cite: 받은 인용키로 [@키] 넣기(K-12), then: "open" = 그 논문을 서재 논문으로 패널에 열기, 아니면 새 [인용 넣기]로 초점
async function addRec(it, btn, { pdf = false, cite = false, then = "" } = {}) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> ${pdf ? "PDF 받는 중" : "추가 중"}`;
  const me = P;
  const r = await addPaper(it.paper, { downloadPdf: pdf });
  if (P !== me) return;
  if (!r) {
    btn.disabled = false;
    btn.textContent = label;
    return;
  }
  const st = recMemory.get(P.mid);
  for (const x of (st && st.result ? st.result.items : [])) if (x.id === it.id) x.in_library = r.id;
  it.in_library = r.id;
  // 인용을 먼저 넣고 서재 목록 · 미리보기를 새로 받아야 "원고에 인용함" 칩이 바로 맞음
  if (cite) put(citeMark(r.citekey), { msg: "서재에 추가하고 원고에 인용했어요" });
  else say("서재에 추가했어요");
  await P.hooks.libraryChanged();
  if (P !== me) return;
  if (then === "open") { // 서재 밖 정보 · 잠김 화면 → 같은 탭에서 서재 논문으로(잠김이 풀림)
    await openPaper(r.id);
    const t = P === me && $(".graph-paper-title", P.aside);
    if (t && !cite) t.focus();
    return;
  }
  if (P.tab === "recs") { // 목록만 다시(자동 다시 계산 없음 — 넣은 인용은 "인용이 바뀌었어요" 알림으로)
    const body = $("[data-ref-body]", P.aside);
    body.innerHTML = "";
    drawRecs(body);
    const b = $(`[data-ref-rec="${CSS.escape(it.id)}"]`, P.aside);
    const ins = b && $("[data-ref-insert-key]", b.closest(".graph-item"));
    if (ins && !cite) ins.focus();
  }
  if (cite) keepFocus(btn);
}

// ------------------------------------------------------------------ 추천 (7.5 · 9.5 · 9.9절)
function currentSeeds() {
  const built = P.hooks.built();
  const papers = P.hooks.papers();
  if (!built || !papers) return null; // 미리보기 · 서재 목록을 아직 못 받음
  return manuscriptSeeds(built.clusters, papers);
}

function drawRecs(body, { auto = false } = {}) {
  const seeds = currentSeeds();
  if (!seeds) {
    body.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
    return;
  }
  let st = recMemory.get(P.mid);
  const sig = seedSignature(seeds.ids);
  if (!st || (!st.result && st.status !== "loading")) { // 결과가 없을 때만 원고 상태로 판단(서버를 부르지 않음)
    if (!seeds.ids.length) {
      return stateBox(body, "아직 인용한 논문이 없어요", "원고에 인용한 논문을 바탕으로 찾아요. [@로 서재 논문을 인용해 보세요.", "",
        { attr: 'data-ref-recs="noseed"' });
    }
    if (!seeds.numbered) {
      return stateBox(body, "인용한 논문으로 찾을 수 없어요",
        "인용한 논문에 OpenAlex 번호가 없어 찾을 수 없어요. 서재 상세의 [인용 그래프 보기]를 한 번 열면 번호가 채워져요.", "",
        { attr: 'data-ref-recs="nonumber"' });
    }
  }
  if (auto && seeds.numbered && (!st || (st.status !== "loading" && st.sig !== sig))) {
    startRec(seeds);
    st = recMemory.get(P.mid);
  }
  if (!st) return;
  if (st.status === "loading") return drawRecProgress(body, st);
  if (st.status === "cancelled" && !st.result) {
    return recStateBox(body, "cancelled", "추천 찾기를 취소했어요", "그동안 받은 정보는 저장돼 있어서 다시 계산하면 더 빨라요.", "다시 계산");
  }
  if (st.status === "error" && st.error === "no_seeds") {
    return stateBox(body, "인용한 논문으로 찾을 수 없어요",
      "인용한 논문에 OpenAlex 번호가 없어 찾을 수 없어요. 서재 상세의 [인용 그래프 보기]를 한 번 열면 번호가 채워져요.", "",
      { attr: 'data-ref-recs="nonumber"' });
  }
  if (st.status === "error" && !st.result) {
    const [title, text, kind] = REC_ERR[st.error] || REC_ERR.internal;
    return recStateBox(body, "error", title, text, kind === "settings" ? null : "다시 시도", { settings: kind === "settings" });
  }
  drawRecResult(body, st, seeds);
}

function recStateBox(body, state, title, text, retryLabel, { settings = false } = {}) {
  const box = stateBox(body, title, text,
    `${retryLabel ? `<button type="button" class="btn primary" data-ref-rec-retry>${esc(retryLabel)}</button>` : ""}${settings ? `<button type="button" class="btn primary" data-ref-settings>설정 열기</button>` : ""}`,
    { attr: `data-ref-recs="${state}"`, focus: P.recFocus });
  P.recFocus = false;
  wireRecButtons(box);
  return box;
}

function wireRecButtons(root) {
  $$("[data-ref-rec-retry]", root).forEach((b) => (b.onclick = () => {
    const seeds = currentSeeds();
    if (seeds && seeds.ids.length) { startRec(seeds); P.recFocus = true; drawTab(); }
  }));
  $$("[data-ref-settings]", root).forEach((b) => (b.onclick = () => settingsDialog()));
}

function startRec(seeds) {
  const mid = P.mid;
  const prev = recMemory.get(mid);
  if (prev && prev.ctl) { prev.replaced = true; prev.ctl.abort(); }
  const st = {
    sig: seedSignature(seeds.ids), ids: seeds.ids, missing: seeds.missing, status: "loading", step: null, message: "",
    progress: null, started: Date.now(), ctl: new AbortController(), hidden: new Set(),
    // 이전 결과는 다시 계산이 실패하거나 취소되면 그대로 보여 줌
    result: prev ? prev.result : null, resultSig: prev ? prev.resultSig : "", resultMissing: prev ? prev.resultMissing : 0,
  };
  recMemory.set(mid, st);
  runRec(mid, st);
}

async function runRec(mid, st) {
  let done = null;
  let err = null;
  try {
    await streamEvents("/api/graph/recommend", { paper_ids: st.ids }, (ev) => {
      if (ev.type === "progress") {
        Object.assign(st, { step: ev.step, message: String(ev.message || ""), progress: typeof ev.progress === "number" ? ev.progress : null });
        updateRecProgress(mid, st);
      } else if (ev.type === "done") done = ev.recommend;
      else if (ev.type === "error") err = ev.code || "internal";
    }, st.ctl.signal);
  } catch (e) {
    if (e && e.name === "AbortError") {
      if (st.replaced || recMemory.get(mid) !== st) return;
      st.ctl = null;
      if (st.cancelled) st.status = st.result ? "ready" : "cancelled"; // [취소]: 이전 결과가 있으면 그대로
      else if (st.result) st.status = "ready"; // 원고를 떠남: 이전 결과만 남김
      else recMemory.delete(mid);
      return redrawRecs(mid);
    }
    err = (e && e.code) || (e && e.status === 400 ? "bad_request" : "disconnected");
  }
  if (recMemory.get(mid) !== st) return; // 다시 계산 · 로그아웃으로 바뀜
  st.ctl = null;
  if (done) {
    Object.assign(st, { status: "ready", result: done, resultSig: st.sig, resultMissing: st.missing, error: null, hidden: new Set() });
    const k = noticeCount(st);
    if (P && P.mid === mid) say(`추천 ${done.items.length}편을 찾았어요.${k ? ` 알림 ${k}개가 있어요.` : ""}`);
  } else {
    Object.assign(st, { status: "error", error: err || "disconnected" });
    if (P && P.mid === mid) say((REC_ERR[st.error] || REC_ERR.internal)[0]);
  }
  redrawRecs(mid);
}

function redrawRecs(mid) {
  if (!P || P.mid !== mid) return;
  drawTabs();
  if (P.open && P.tab === "recs") drawTab();
}

function drawRecProgress(body, st) {
  const box = el(`<div data-ref-recs="loading"><div class="graph-progress-card">
      <div class="graph-progress-head"><span class="spinner" aria-hidden="true"></span><span>참고할 논문을 찾는 중…</span></div>
      <div class="progress indeterminate" role="progressbar" aria-label="추천 찾기 진행" aria-valuemin="0" aria-valuemax="100"><div style="width:5%"></div></div>
      <ol class="graph-steps">${REC_STEPS.map(([s, name]) => `<li data-step="${s}" data-state="todo">${esc(name)} <span class="graph-step-msg"></span></li>`).join("")}</ol>
      <p class="graph-progress-msg" role="status"></p>
      <div class="graph-progress-foot"><span class="small muted">처음 계산하면 10~40초 걸릴 수 있어요.</span>
        <button type="button" class="btn sm" data-ref-rec-cancel>취소</button></div></div></div>`);
  $("[data-ref-rec-cancel]", box).onclick = () => {
    st.cancelled = true;
    if (st.ctl) st.ctl.abort();
  };
  body.appendChild(box);
  P.lastStep = null;
  fillProgress(box, st);
  const wait = 400 - (Date.now() - st.started); // 캐시면 보통 바로 끝남 → 0.4초 뒤에 보임(번쩍임 방지)
  if (wait > 0) {
    box.classList.add("hidden");
    setTimeout(() => box.classList.remove("hidden"), wait);
  }
}

function updateRecProgress(mid, st) {
  if (!P || P.mid !== mid || !P.open || P.tab !== "recs") return;
  const box = $('[data-ref-recs="loading"]', P.aside);
  if (box) fillProgress(box, st);
}

function fillProgress(box, st) {
  const bar = $(".progress", box);
  if (st.progress != null) {
    const pct = Math.round(st.progress * 100);
    bar.classList.remove("indeterminate");
    bar.setAttribute("aria-valuenow", String(pct));
    $("div", bar).style.width = `${pct}%`;
  }
  const states = stepStates(st.step, REC_STEP_IDS);
  REC_STEP_IDS.forEach((s) => {
    const li = $(`li[data-step="${s}"]`, box);
    const state = states[s];
    li.dataset.state = state;
    if (state === "now") li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    const doneMark = $(".sr-only", li);
    if (state === "done" && !doneMark) li.appendChild(el(`<span class="sr-only">(완료)</span>`));
    if (state !== "done" && doneMark) doneMark.remove();
  });
  const m = st.message.match(/\((\d+\/\d+)\)/);
  if (m && st.step === "seeds") $('li[data-step="seeds"] .graph-step-msg', box).textContent = m[1];
  if (st.step !== P.lastStep) { // 단계가 바뀔 때만 읽힘
    P.lastStep = st.step;
    // (n/N)은 단계 줄 숫자만 갱신 — 문구에서는 빼서 서로 어긋나지 않게
    $(".graph-progress-msg", box).textContent = st.step === "wait" ? "다른 그래프나 추천이 끝나기를 기다리는 중이에요"
      : st.message.replace(/\s*\(\d+\/\d+\)/, "");
  }
}

// 알림 상자들 (시안 9.4절 순서): [{code, tone, html, close}]
function notices(st, seeds) {
  const r = st.result;
  const out = [];
  const codes = new Set(r.warnings.map((w) => w.code));
  if (seeds && seedSignature(seeds.ids) !== st.resultSig) {
    out.push({ code: "stale", tone: "info", close: false,
      html: `원고의 인용이 바뀌었어요. <div><button type="button" class="btn sm" data-ref-rec-retry>다시 계산</button></div>` });
  }
  if (st.status === "error") {
    const [title] = REC_ERR[st.error] || REC_ERR.internal;
    out.push({ code: "retry_failed", tone: "warn", close: true, html: `다시 계산하지 못했어요. 이전 결과를 그대로 보여 드려요. (${esc(title)})` });
  }
  const cover = [];
  if (codes.has("partial")) cover.push(`한 번에 다 보지 못해 ${r.seeds_total}편 중 ${r.seeds_used}편만 반영했어요. [다시 계산]하면 이어서 반영해요.`);
  if (codes.has("seeds_capped")) cover.push("인용이 많아 처음 나온 20편만 바탕으로 했어요.");
  if (st.resultMissing) cover.push(`OpenAlex 번호가 없는 ${st.resultMissing}편은 빠졌어요.`);
  if (cover.length) out.push({ code: "coverage", tone: "info", close: true, html: cover.map(esc).join("<br>") });
  const known = new Set(["partial", "seeds_capped", "upstream_limited", "weak_citation_data"]);
  const fails = r.warnings.filter((w) => !known.has(w.code)).map((w) => WARN_TEXT[w.code] || String(w.message || "")).filter(Boolean);
  if (fails.length) {
    out.push({ code: "failed", tone: "warn", close: true,
      html: `<b>일부 정보 없이 찾았어요.</b> 추천이 덜 정확할 수 있어요.<ul>${fails.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` });
  }
  if (codes.has("upstream_limited")) {
    out.push({ code: "upstream_limited", tone: "warn", close: true,
      html: `OpenAlex 하루 사용량을 다 써서 저장돼 있던 정보로만 찾았어요(한국 시간 오전 9시에 초기화). 설정에서 OpenAlex API 키를 넣으면 한도가 10배가 돼요.
        <div><button type="button" class="btn sm" data-ref-settings>설정 열기</button></div>` });
  }
  if (codes.has("weak_citation_data")) {
    out.push({ code: "weak_citation_data", tone: "info", close: true,
      html: "인용 정보가 적어 주제가 비슷한 논문으로 보강했어요. <b>‘주제가 비슷함’</b>은 인용 근거가 없는 추천이에요. (국문 논문은 OpenAlex 인용 정보가 적은 편이에요.)" });
  }
  return out.filter((n) => !st.hidden.has(n.code));
}

function noticeCount(st) {
  return notices(st, null).length;
}

function drawNotices(box, st, seeds) {
  box.innerHTML = "";
  for (const n of notices(st, seeds)) {
    const node = el(`<div class="notice" data-tone="${n.tone}" data-code="${n.code}">${n.tone === "info" ? ICON_INFO : ICON_WARN}<div>${n.html}</div>
      ${n.close ? `<button type="button" class="icon-btn small" data-notice-close aria-label="알림 닫기">✕</button>` : ""}</div>`);
    const x = $("[data-notice-close]", node);
    if (x) x.onclick = () => { st.hidden.add(n.code); drawNotices(box, st, currentSeeds()); };
    wireRecButtons(node);
    box.appendChild(node);
  }
}

function drawRecResult(body, st, seeds) {
  const r = st.result;
  const box = el(`<div data-ref-recs="${r.items.length ? "ready" : "empty"}">
    <div class="row"><p class="graph-intro grow">이 원고의 인용 <b>${Number(r.seeds_used) || 0}편</b>을 바탕으로 찾았어요 · OpenAlex 기준 ${esc((r.stats || {}).built_on || "")}</p>
      <button type="button" class="btn sm" data-ref-rec-retry>다시 계산</button></div>
    <div class="graph-notices" data-ref-notices></div></div>`);
  wireRecButtons($(".row", box));
  drawNotices($("[data-ref-notices]", box), st, seeds);
  body.appendChild(box);
  if (!r.items.length) {
    stateBox(box, "연결된 논문을 찾지 못했어요",
      "인용한 논문들과 연결된 논문을 찾지 못했어요. OpenAlex에 인용 정보가 적은 논문(국문 등)일 수 있어요.", "");
    return;
  }
  const cited = new Set(seeds ? seeds.ids : []);
  const ol = el(`<ol class="graph-items"></ol>`);
  for (const it of r.items) ol.appendChild(recItem(it, cited));
  box.appendChild(ol);
}

function recItem(it, cited) {
  const p = it.paper;
  const fam = firstFamily(p);
  const sub = [fam ? `${fam} 외` : "", Number.isInteger(p.year) ? p.year : "", `피인용 ${fmt(p.cited_by_count || 0)}`].filter(Boolean).join(" · ");
  const keys = seedKeys(it.seeds);
  const lib = it.in_library;
  const cur = (P.ext && P.ext.id === it.id) || (lib && P.paper && P.paper.id === lib && P.tab === "info");
  const li = el(`<li class="graph-item">
    <button type="button" class="graph-item-btn" data-ref-rec="${esc(it.id)}" ${cur ? `aria-current="true"` : ""}>
      <span class="graph-item-title">${esc(p.title || "제목 없음")}</span><span class="graph-item-sub">${esc(sub)}</span></button>
    <div class="graph-item-meta"><span class="graph-count" ${keys.length ? `title="${esc(`${keys.join(" · ")} 와 연결`)}"` : ""}>내 인용 ${Number(it.linked) || 0}편과 연결</span><span>· ${esc(KIND_TEXT[it.kind] || "")}</span>
      ${lib ? `<span class="chip success">✓ 서재에 있음</span>` : ""}${lib && cited.has(lib) ? `<span class="chip accent">원고에 인용함</span>` : ""}</div>
    <div class="ref-rec-actions">${lib ? `<button type="button" class="btn sm" data-ref-insert-key>인용 넣기</button>`
      : `<button type="button" class="btn sm" data-ref-add>＋ 서재에 추가</button><button type="button" class="btn sm" data-ref-addcite>추가하고 인용</button>`}</div></li>`);
  $(".graph-item-btn", li).onclick = () => {
    if (!lib) return openExt(it);
    P.tab = "info";
    savePrefs({ tab: "info" });
    openPaper(lib, { user: true }).then(() => { const t = P && $(".graph-paper-title", P.aside); if (t) t.focus(); });
  };
  const actions = $(".ref-rec-actions", li);
  if (lib) {
    $("[data-ref-insert-key]", li).onclick = async () => {
      let p2 = (P.hooks.papers() || []).find((x) => x.id === lib);
      if (!p2) {
        try { p2 = await api.get(`/api/papers/${lib}`); } catch (e) { return errorToast(e); }
      }
      if (P) put(citeMark(p2.citekey));
    };
  } else {
    const add = $("[data-ref-add]", li);
    add.onclick = () => addRec(it, add);
    const addCite = $("[data-ref-addcite]", li);
    addCite.onclick = () => addRec(it, addCite, { cite: true });
    actions.append(...extLinks(p, "ext-link")); // 서재에 있는 항목에는 링크 없음(RD-2 · M-R05a)
  }
  return li;
}

// 원고 인용이 바뀜(미리보기를 새로 계산할 때마다): 추천 탭을 보는 중이면 알림만(자동으로 다시 하지 않음 — K-7)
function citesChanged() {
  markCiteRows();
  if (!P.open || P.tab !== "recs") return;
  const st = recMemory.get(P.mid);
  const box = $("[data-ref-notices]", P.aside);
  if (st && st.result && box) {
    const seeds = currentSeeds();
    const was = !!$('[data-code="stale"]', box);
    drawNotices(box, st, seeds);
    const now = !!$('[data-code="stale"]', box);
    if (now && !was) say("원고의 인용이 바뀌었어요. 다시 계산할 수 있어요.");
    return;
  }
  if (!st || st.status !== "loading") drawTab(); // 아직 결과가 없음: 원고 상태(인용 없음 · 번호 없음 · 첫 계산)를 다시
}
