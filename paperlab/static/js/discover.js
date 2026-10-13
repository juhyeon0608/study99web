// 논문 찾기: OpenAlex · arXiv · Semantic Scholar · Crossref · KCI · RISS · Europe PMC 검색 (Google Scholar 방식)

import { api, qs } from "./api.js";
import { EXT_MARK, ICON_INFO, ICON_WARN, SCHOLAR_LIBRARY_NOTE, addPaper, bindExtLink, citeDialog, copySearchQuery, extMark, openExternal } from "./dialogs.js";
import { INHA, inhaSearchTakesQuery, inhaSearchUrl, normalizeQuery, paperProxyTarget, scholarUrl } from "./extlinks.js";
import { openGraph, seedFromResult } from "./graph.js";
import {
  EMPTY_TEXT, GROUPS, OC_FAILED_TEXT, SORT_LABEL, SOURCE_META, adjustOptions, isNewSource, licenseLabel,
  oaOpenLabel, offReason, searchErrorView, sourceLimits, viaHtml,
} from "./sourcemeta.js";
import { state } from "./state.js";
import { $, $$, authorsShort, el, errorToast, esc, fmtNum, safeUrl } from "./ui.js";

const SOURCE_KEYS = Object.keys(SOURCE_META);
// "학교 DB에서 찾기" 줄 (docs/design/inha-proxy-ui.md 3장). 툴팁은 켜졌을 때 것, 꺼지면 "검색어를 입력하세요"
const SCHOOL_DBS = [
  ["riss", "RISS", `검색어로 RISS를 열어요 (${INHA.proxyName})`],
  ["dbpia", "DBpia", `검색어로 DBpia를 열어요 (${INHA.proxyName})`],
  ["kiss", "KISS", `검색어로 KISS를 열어요 (${INHA.proxyName})`],
];
const KISS_COPY_TITLE = "KISS 첫 페이지를 열고 검색어를 복사해요";
const SCHOLAR_TITLE = "검색어로 Google Scholar를 열어요. Scholar 설정 → 도서관 링크에서 ‘인하대학교’를 켜면 학교 구독 원문 링크가 함께 나와요.";
const EMPTY_QUERY = "검색어를 입력하세요";
const INHA_OPEN_TITLE = `${INHA.proxyName}(정석학술정보관)로 원문 페이지를 열어요`;
const KDB_INTRO_KEY = "paperlab.kdbIntro";
const OA_FIND_TITLE = "OpenAlex에서 무료 PDF를 찾아요. 라이선스가 확인되면 서재에 PDF까지 넣을 수 있어요.";
const OA_OPEN_TITLE = "라이선스를 확인하지 못한 PDF예요. 새 탭에서 직접 받아 [PDF 첨부]로 올려 주세요.";
const OA_OPEN_MARK = extMark("새 탭에서 열림 · 직접 받아 올려야 해요");
const OA_AFTER_CARD = `<div class="notice oa-after" data-tone="info">${ICON_INFO}<div>라이선스를 확인하지 못해 PaperLab이 대신 받지 않아요. 직접 받은 뒤 서재에 추가하고 <b>[PDF 첨부]</b>로 올려 주세요.</div></div>`;

const ds = {
  q: "", source: "openalex", yearFrom: "", yearTo: "", sort: "relevance", oa: false, page: 1,
  res: null, loading: false, error: "", errorCode: "", graph: null, // graph: {paper, kind, page, res}
  cursors: [], // Europe PMC: 지나온 쪽의 커서(K-6 — 메모리만). 마지막 값이 지금 쪽
  limitSaid: "", // 소스를 바꿔 정렬 · 필터를 되돌렸을 때의 알림(2.3절)
  seq: 0, // 늦게 도착한 이전 요청의 결과를 버리기 위한 번호
};
let srcStatus = null; // GET /api/sources 결과(화면을 처음 열 때 한 번). 실패하면 {} — 모두 켬(서버 503이 대신 알림)
let viewRef = null;

const srcOn = (s) => !srcStatus || !srcStatus[s] || srcStatus[s].enabled !== false;
const meta = (s) => SOURCE_META[s] || {};

function announce(text) {
  const live = viewRef && $("[data-discover-live]", viewRef);
  if (live) { live.textContent = ""; setTimeout(() => { live.textContent = text; }, 30); }
}

function sourceOptions() {
  return GROUPS.map((g) => `<optgroup label="${esc(g)}">${SOURCE_KEYS.filter((k) => meta(k).group === g).map((k) => {
    const on = srcOn(k);
    return `<option value="${k}" ${k === ds.source ? "selected" : ""} ${on ? "" : "disabled"}>${esc(meta(k).name)}${on ? "" : " (키 등록 전)"}</option>`;
  }).join("")}</optgroup>`).join("");
}

export function renderDiscover(main) {
  main.innerHTML = "";
  const view = el(`<section class="view discover-view">
    <div class="discover-head">
      <h1>논문 찾기</h1>
      <div class="sub">공개 학술 데이터베이스에서 검색해요. DOI나 arXiv 주소를 넣으면 그 논문을 바로 찾아요.</div>
      <form class="discover-bar">
        <div class="searchbox"><input class="input" name="q" placeholder="주제, 제목, 저자, DOI, arXiv ID…" value="${esc(ds.q)}"></div>
        <select class="input" name="source" style="width:auto" aria-label="데이터베이스" aria-describedby="src-off-note">${sourceOptions()}</select>
        <button class="btn primary" style="height:40px;padding:0 20px">검색</button>
        <button type="button" class="btn" style="height:40px" data-ai-find title="입력한 글을 질문으로 여러 검색어로 찾아 한국어로 요약해요">✦ AI로 찾기</button>
      </form>
      <div class="discover-filters" role="group" aria-label="검색 조건" aria-describedby="src-limit-note">
        <span>기간</span>
        <input class="input" name="yf" placeholder="부터" style="width:74px" value="${esc(ds.yearFrom)}"> –
        <input class="input" name="yt" placeholder="까지" style="width:74px" value="${esc(ds.yearTo)}">
        <span style="margin-left:6px">정렬</span>
        <div class="seg" data-sort>${Object.entries(SORT_LABEL).map(([k, v]) => `<button type="button" data-v="${k}" class="${k === ds.sort ? "active" : ""}">${v}</button>`).join("")}</div>
        <label class="check" style="margin-left:6px"><input type="checkbox" name="oa" ${ds.oa ? "checked" : ""}> <span data-oa-label></span></label>
        <span class="muted small" data-srcdesc style="margin-left:auto"></span>
      </div>
      <p class="discover-note" id="src-off-note" data-src-off hidden></p>
      <p class="discover-note" id="src-limit-note" data-src-limits hidden></p>
      ${schoolBar()}
      <div class="sr-only" role="status" data-discover-live></div>
    </div>
    <div class="discover-results"></div></section>`);
  main.appendChild(view);
  viewRef = view;
  const form = $("form", view);
  const srcSel = $("[name=source]", view);
  srcSel.onchange = () => { ds.source = srcSel.value; applySource(view, true); if (ds.q) submit(); };
  const submit = () => {
    ds.q = $("[name=q]", view).value.trim();
    ds.source = srcSel.value;
    ds.yearFrom = $("[name=yf]", view).value.trim();
    ds.yearTo = $("[name=yt]", view).value.trim();
    ds.oa = $("[name=oa]", view).checked;
    ds.page = 1;
    ds.cursors = [];
    ds.graph = null;
    search();
  };
  view.submitSearch = submit;
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  // 3단계 AI로 찾기 (시안 2.2절 · AD-5): 입력 글을 메모리로 넘기고 바로 실행. 2자 미만이면 입력칸에 초점만
  $("[data-ai-find]", view).onclick = () => {
    const q = $("[name=q]", view).value.trim();
    if (q.length < 2) return $("[name=q]", view).focus();
    state.askFind = q;
    location.hash = "#/ask/find";
  };
  $$("[data-sort] button", view).forEach((b) => (b.onclick = () => {
    ds.sort = b.dataset.v;
    $$("[data-sort] button", view).forEach((x) => x.classList.toggle("active", x === b));
    if (ds.q) submit();
  }));
  $("[name=oa]", view).onchange = () => { if (ds.q) submit(); };
  for (const n of ["yf", "yt"]) $(`[name=${n}]`, view).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
  wireSchoolBar(view);
  applySource(view, false);
  draw();
  if (!ds.q) setTimeout(() => $("[name=q]", view).focus(), 30);
  if (srcStatus === null) {
    api.get("/api/sources").then((r) => { srcStatus = r || {}; }, () => { srcStatus = {}; })
      .then(() => { if (viewRef === view) { syncSourceSelect(view); applySource(view, false); } });
  }
}

// 소스 목록을 지금 상태(키 없음 등)로 다시 그림. 고른 소스가 꺼졌으면 OpenAlex로 되돌림(2.1절)
function syncSourceSelect(view) {
  const srcSel = $("[name=source]", view);
  if (!srcOn(ds.source)) {
    ds.limitSaid = `${meta(ds.source).name}를 지금 쓸 수 없어 OpenAlex로 바꿨어요.`;
    ds.source = "openalex";
  }
  srcSel.innerHTML = sourceOptions();
  srcSel.value = ds.source;
}

// 소스에 맞춰 설명 · 쓸 수 없는 이유 · 정렬/필터 비활성 · 이유 줄 (2.2 · 2.3절 · AD-2 — 네이티브 disabled + 늘 보이는 이유 줄)
function applySource(view, changed) {
  $("[data-srcdesc]", view).textContent = meta(ds.source).desc || "";
  const off = SOURCE_KEYS.filter((k) => !srcOn(k)).map((k) => offReason(k, srcStatus[k].reason));
  const offEl = $("[data-src-off]", view);
  offEl.textContent = off.join(" ");
  offEl.hidden = !off.length;
  const lim = sourceLimits(ds.source);
  if (changed) {
    const adj = adjustOptions(ds.source, { sort: ds.sort, oa: $("[name=oa]", view).checked });
    if (adj.said) {
      ds.limitSaid = adj.said;
      ds.sort = adj.sort;
      $("[name=oa]", view).checked = adj.oa;
      announce(`${lim.note} ${adj.said}`);
    } else ds.limitSaid = "";
  }
  $$("[data-sort] button", view).forEach((b) => {
    b.disabled = lim.sortOff.includes(b.dataset.v);
    b.classList.toggle("active", b.dataset.v === ds.sort);
  });
  const oa = $("[name=oa]", view);
  oa.disabled = lim.oaOff;
  if (lim.oaOff) oa.checked = false;
  $("[data-oa-label]", view).textContent = lim.oaLabel;
  const note = [lim.note, ds.limitSaid].filter(Boolean).join(" ");
  const limEl = $("[data-src-limits]", view);
  limEl.textContent = note;
  limEl.hidden = !note;
}

// 학교 DB 버튼에 질의가 들어가지 않으면(KISS 임시안) 첫 페이지를 열고 검색어를 복사한다
function schoolTitle(db, title) {
  return inhaSearchTakesQuery(db) ? title : KISS_COPY_TITLE;
}

function schoolBar() {
  return `<div class="school-bar" data-school-bar role="group" aria-labelledby="school-bar-label">
    <span class="school-bar-label" id="school-bar-label">${esc(INHA.buttons.searchDb)}</span>
    <div class="school-links">
      ${SCHOOL_DBS.map(([db, name, title]) => `<button type="button" class="btn sm" data-inha-search="${db}" title="${esc(schoolTitle(db, title))}">${esc(name)}${inhaSearchTakesQuery(db) ? EXT_MARK : extMark("새 탭에서 열림 · 검색어를 복사해요")}</button>`).join("")}
      <span class="school-sep" aria-hidden="true"></span>
      <button type="button" class="btn sm" data-scholar-search title="${esc(SCHOLAR_TITLE)}">Google Scholar${EXT_MARK}</button>
    </div>
    <span class="school-hint hidden" id="school-hint" data-school-hint>${EMPTY_QUERY}</span>
  </div>`;
}

// 검색창의 지금 입력값(검색 버튼을 누르기 전 값도)으로 버튼을 켜고 끈다. 누르면 그 순간의 값으로 연다
function wireSchoolBar(view) {
  const input = $("[name=q]", view);
  const bar = $("[data-school-bar]", view);
  const buttons = $$("[data-inha-search], [data-scholar-search]", bar);
  const sync = () => {
    const empty = !normalizeQuery(input.value);
    for (const b of buttons) {
      b.disabled = empty;
      if (empty) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
      const db = b.dataset.inhaSearch;
      b.title = empty ? EMPTY_QUERY : db ? schoolTitle(db, SCHOOL_DBS.find((d) => d[0] === db)[2]) : SCHOLAR_TITLE;
    }
    $("[data-school-hint]", bar).classList.toggle("hidden", !empty);
  };
  input.addEventListener("input", sync);
  sync();
  for (const b of $$("[data-inha-search]", bar)) {
    b.onclick = () => {
      const db = b.dataset.inhaSearch;
      const q = normalizeQuery(input.value);
      const url = inhaSearchUrl(db, q);
      if (!url) return sync();
      openExternal(url, { returnFocus: b, before: inhaSearchTakesQuery(db) ? null : () => copySearchQuery(q) });
    };
  }
  $("[data-scholar-search]", bar).onclick = (e) => {
    const url = scholarUrl(input.value);
    if (!url) return sync();
    openExternal(url, { guide: false, returnFocus: e.currentTarget });
  };
}

async function search() {
  const mine = ++ds.seq;
  ds.loading = true;
  ds.error = "";
  ds.errorCode = "";
  draw();
  let res = null;
  let error = "";
  let code = "";
  const source = ds.source;
  const cursor = meta(source).cursor ? ds.cursors[ds.cursors.length - 1] || "" : "";
  try {
    res = await api.get("/api/search" + qs({
      q: ds.q, source, page: ds.page, year_from: ds.yearFrom, year_to: ds.yearTo, sort: ds.sort, oa: ds.oa,
      ...(cursor ? { cursor } : {}),
    }));
  } catch (e) {
    error = e.message;
    code = searchErrorView(e.code, source) ? e.code : "";
  }
  if (mine !== ds.seq) return;
  Object.assign(ds, { res, error, errorCode: code, errorSource: source, loading: false });
  if (code === "source_unconfigured" && isNewSource(source)) {
    // 새로 고침 없이 2장 상태와 맞춤(D8): 그 옵션을 비활성, 기본 소스(OpenAlex)로 되돌리고 이유 줄
    srcStatus = { ...(srcStatus || {}), [source]: { enabled: false, reason: "unconfigured" } };
    if (viewRef) { syncSourceSelect(viewRef); applySource(viewRef, false); }
  }
  draw();
  if (code) announce(searchErrorView(code, source).head);
}

async function loadGraph(paper, kind, page = 1) {
  const mine = ++ds.seq;
  const g = { paper, kind, page, res: null, loading: true, error: "" };
  ds.graph = g;
  draw();
  try {
    g.res = await api.post("/api/related", { paper, kind, page });
  } catch (e) {
    g.error = e.message;
  }
  if (mine !== ds.seq || ds.graph !== g) return;
  g.loading = false;
  draw();
}

function readIntroDismissed() {
  try { return localStorage.getItem(KDB_INTRO_KEY) === "1"; } catch { return false; }
}

function introNotice(box) {
  const n = el(`<div class="notice" data-tone="info" data-kdb-intro>${ICON_INFO}<div>KCI · RISS 검색은 PaperLab 공용 키로 요청해요. 원문은 각 사이트(또는 <b>인하대에서 보기</b>)에서 직접 받아 <b>[PDF 첨부]</b>로 올려 주세요.</div>
    <button type="button" class="icon-btn small" data-kdb-intro-close aria-label="안내 닫기">✕</button></div>`);
  $("[data-kdb-intro-close]", n).onclick = () => {
    try { localStorage.setItem(KDB_INTRO_KEY, "1"); } catch { /* 못 쓰면 다음에 또 보임 */ }
    n.remove();
    $(".result-info", box)?.focus();
  };
  return n;
}

// 검색 오류 상자 (6.1절). 버튼: OpenAlex로 검색 · 다시 시도 · RISS에서 이 검색어로 찾기 · 관련도순으로 검색
function errorNotice(view) {
  const n = el(`<div class="notice" data-tone="warn" data-search-error="${esc(ds.errorCode)}">${ICON_WARN}<div><b>${esc(view.head)}</b> ${esc(view.body)}
    <div class="notice-actions"></div></div></div>`);
  const row = $(".notice-actions", n);
  const LABELS = { openalex: "OpenAlex로 검색", retry: "다시 시도", relevance: "관련도순으로 검색" };
  for (const a of view.actions) {
    const b = a === "riss"
      ? el(`<button type="button" class="btn sm">RISS에서 이 검색어로 찾기${EXT_MARK}</button>`)
      : el(`<button type="button" class="btn sm">${esc(LABELS[a])}</button>`);
    b.onclick = () => {
      if (a === "riss") {
        const url = inhaSearchUrl("riss", normalizeQuery(ds.q));
        if (url) openExternal(url, { returnFocus: b });
        return;
      }
      if (a === "openalex") {
        ds.source = "openalex";
        if (viewRef) { $("[name=source]", viewRef).value = "openalex"; applySource(viewRef, false); }
      }
      if (a === "relevance") {
        ds.sort = "relevance";
        if (viewRef) applySource(viewRef, false);
      }
      ds.page = 1;
      ds.cursors = [];
      search();
    };
    row.appendChild(b);
  }
  return n;
}

function draw() {
  const box = $(".discover-results");
  if (!box) return;
  box.innerHTML = "";
  box.scrollTop = 0;
  if (ds.graph) return drawGraph(box);
  const m = meta(ds.source);
  if (ds.loading) {
    box.appendChild(el(`<div class="result-info"><span class="spinner"></span> ${isNewSource(ds.source) ? `${esc(m.name)}에서 검색 중…` : "검색 중…"}</div>`));
    return;
  }
  if (ds.error) {
    const v = ds.errorCode ? searchErrorView(ds.errorCode, ds.errorSource || ds.source) : null;
    box.appendChild(v ? errorNotice(v) : el(`<div class="status-line bad" style="margin-top:16px;max-width:900px">${esc(ds.error)}</div>`));
    return;
  }
  if (!ds.res) {
    box.appendChild(el(`<div class="empty"><div class="big">⌕</div><h3>무엇을 찾고 있나요?</h3>
      <p>키워드로 검색하고, 마음에 드는 논문은 한 번에 서재에 담으세요.<br>‘피인용’을 누르면 그 논문을 인용한 후속 연구를 따라갈 수 있어요.</p></div>`));
    return;
  }
  const { items, total } = ds.res;
  if ((ds.source === "kci" || ds.source === "riss") && items.length && !readIntroDismissed()) box.appendChild(introNotice(box));
  box.appendChild(el(`<div class="result-info" tabindex="-1">검색 결과 약 ${fmtNum(total)}건 · ${esc(m.name || "")}</div>`));
  if (!items.length) box.appendChild(el(`<p class="muted">${esc(EMPTY_TEXT)}${m.empty ? ` ${esc(m.empty)}` : ""}</p>`));
  for (const it of items) box.appendChild(resultCard(it));
  if (items.length && m.src) box.appendChild(el(`<p class="result-src" data-result-src>${esc(m.src)}</p>`));
  if (m.cursor) box.appendChild(cursorPager());
  else box.appendChild(pager(ds.page, total, (p) => { ds.page = p; search(); }));
}

function drawGraph(box) {
  const g = ds.graph;
  const label = { cited_by: "을(를) 인용한 논문", references: "의 참고문헌", related: "와(과) 관련된 논문" }[g.kind];
  const crumb = el(`<div class="crumb" style="max-width:900px"><button class="btn sm" data-back>← 검색 결과로</button>
    <span><b>${esc(g.paper.title.length > 70 ? g.paper.title.slice(0, 70) + "…" : g.paper.title)}</b>${label}</span></div>`);
  $("[data-back]", crumb).onclick = () => { ds.seq++; ds.graph = null; draw(); };
  box.appendChild(crumb);
  const loadingText = g.kind === "references" ? "참고문헌을 불러오는 중… OpenAlex에 없으면 OpenCitations에서 찾아요" : "불러오는 중…";
  if (g.loading) return box.appendChild(el(`<div class="result-info"><span class="spinner"></span> ${loadingText}</div>`));
  if (g.error) return box.appendChild(el(`<div class="status-line bad" style="max-width:900px">${esc(g.error)}</div>`));
  const failed = (g.res.warnings || []).some((w) => w.code === "oc_failed");
  if (failed && !g.res.items.length) {
    const n = el(`<div class="notice" data-tone="warn" data-code="oc_failed">${ICON_WARN}<div>${esc(OC_FAILED_TEXT)}
      <div class="notice-actions"><button type="button" class="btn sm" data-retry>다시 시도</button></div></div></div>`);
    $("[data-retry]", n).onclick = () => loadGraph(g.paper, g.kind, 1);
    return box.appendChild(n);
  }
  box.appendChild(viaBlock(g.res) || el(`<div class="result-info">${fmtNum(g.res.total)}편${g.kind === "cited_by" ? " · 피인용 많은 순" : ""}</div>`));
  for (const it of g.res.items) box.appendChild(resultCard(it));
  box.appendChild(pager(g.page, g.res.total, (p) => loadGraph(g.paper, g.kind, p)));
}

// "참고문헌 23편 (OpenCitations 기준)" + 설명 (5.1절) — via가 없으면 null
function viaBlock(res) {
  const html = viaHtml(res);
  return html ? el(`<div>${html}</div>`) : null;
}

function pager(page, total, go) {
  // 데이터베이스가 깊은 쪽은 주지 않는다 (Semantic Scholar 1,000건, OpenAlex 10,000건)
  const pages = Math.min(Math.ceil(total / 20), ds.source === "semanticscholar" && !ds.graph ? 50 : 500);
  const p = el(`<div class="pager"></div>`);
  if (pages <= 1) return p;
  const prev = el(`<button class="btn sm" ${page <= 1 ? "disabled" : ""}>← 이전</button>`);
  prev.onclick = () => go(page - 1);
  const next = el(`<button class="btn sm" ${page >= pages ? "disabled" : ""}>다음 →</button>`);
  next.onclick = () => go(page + 1);
  p.append(prev, el(`<span class="small muted" style="align-self:center;padding:0 8px">${page} / ${fmtNum(Math.min(pages, 9999))}</span>`), next);
  return p;
}

// Europe PMC(K-6): 커서라 전체 쪽 수를 모름 → "← 이전 · N쪽 · 다음 →" (3.4절)
function cursorPager() {
  const p = el(`<div class="pager" data-cursor></div>`);
  const next = ds.res && ds.res.next_cursor;
  if (ds.page <= 1 && !next) return p;
  const prev = el(`<button class="btn sm" ${ds.page <= 1 ? "disabled" : ""}>← 이전</button>`);
  prev.onclick = () => { ds.cursors.pop(); ds.page -= 1; search(); };
  const nx = el(`<button class="btn sm" ${next ? "" : "disabled"}>다음 →</button>`);
  nx.onclick = () => { ds.cursors.push(next); ds.page += 1; search(); };
  p.append(prev, el(`<span class="small muted" style="align-self:center;padding:0 8px">${ds.page}쪽</span>`), nx);
  return p;
}

// 새 소스 카드의 배지 줄 (3.2절): 소스 · 등재 · 원문 공개 · 소스 피인용(글). 비면 null
function badgeRow(it) {
  const m = meta(it.source);
  const bits = [`<span class="chip src-chip">${esc(m.chip)}</span>`];
  let free = !!it.is_oa;
  for (const b of Array.isArray(it.badges) ? it.badges : []) {
    if (b === "무료 원문") { free = true; continue; }
    bits.push(`<span class="chip accent">${esc(b)}</span>`);
  }
  if (free) bits.push(`<span class="chip success">${esc(m.oaChip)}</span>`);
  if (m.cites && it.cited_by_count != null) bits.push(`<span class="r-cites">${esc(m.cites)} ${fmtNum(it.cited_by_count)}</span>`);
  return `<div class="r-badges">${bits.join("")}</div>`;
}

// [무료 PDF 열기 ↗] 링크 (4.2절 — 프록시로 감싸지 않음, 학교 안내 창 없음)
function oaTabLink(url, kind, cls = "btn sm") {
  return `<a class="${cls}" data-oa-open href="${esc(url)}" target="_blank" rel="noopener noreferrer" title="${esc(OA_OPEN_TITLE)}">${esc(oaOpenLabel(kind))}${OA_OPEN_MARK}</a>`;
}

// 결과 카드. AI로 찾기 출처(시안 5.2 · AD-3)는 { n, lite: true } — 번호 · Scholar 링크, 이 화면 안에서만 도는 버튼(피인용 · 참고문헌 · 관련)은 뺌
export function resultCard(it, { n = null, lite = false } = {}) {
  const nsrc = isNewSource(it.source);
  const venue = [it.venue, it.year].filter(Boolean).join(", ");
  const scholar = lite || nsrc ? scholarUrl(it.title || it.doi || "") : null; // 새 소스 카드에도 (팀장 결정 6)
  const titleLabel = n ? ` aria-label="출처 ${n}: ${esc(it.title)}"` : "";
  const inha = paperProxyTarget(it); // 학교 프록시로 열 주소 — 없으면 링크를 그리지 않음
  const host = it.pdf_url ? (() => { try { return new URL(it.pdf_url).hostname.replace(/^www\./, ""); } catch { return "PDF"; } })() : "";
  const links = !nsrc || !!it.doi; // 새 소스: 참고문헌 · 관련 논문 · 그래프는 DOI 있을 때만(AD-6)
  const card = el(`<div class="result"${it.source ? ` data-source="${esc(it.source)}"` : ""}>
    <div class="r-title">${n ? `<span class="cite-ref" aria-hidden="true">${n}</span>` : ""}${safeUrl(it.url) ? `<a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener"${titleLabel}>${esc(it.title)}</a>` : `<span tabindex="-1"${titleLabel}>${esc(it.title)}</span>`}</div>
    <div class="r-meta">${esc(authorsShort(it.authors, 4))}${venue ? ` - ${esc(venue)}` : ""}${it.doi ? ` - doi:${esc(it.doi)}` : it.arxiv_id ? ` - arXiv:${esc(it.arxiv_id)}` : ""}</div>
    ${nsrc ? badgeRow(it) : ""}
    ${it.tldr ? `<div class="r-tldr"><b>TL;DR</b> ${esc(it.tldr)}</div>` : ""}
    ${it.abstract ? `<div class="r-abs clamp" title="눌러서 펼치기">${esc(it.abstract)}</div>` : nsrc ? `<p class="r-noabs">${esc(meta(it.source).noAbs)}</p>` : ""}
    <div class="r-actions">
      <span data-lib></span>
      <button class="link" data-cite>인용</button>
      ${lite ? "" : `${it.cited_by_count != null && !nsrc ? `<button class="link" data-g="cited_by">피인용 ${fmtNum(it.cited_by_count)}</button>` : ""}
      ${links ? `<button class="link" data-g="references">참고문헌</button>
      <button class="link" data-g="related">관련 논문</button>` : ""}`}
      ${links ? `<button class="link" data-graph-open title="이 논문과 주제가 가까운 논문들을 그래프로 봐요">그래프</button>` : ""}
      ${safeUrl(it.pdf_url) ? `<a href="${esc(safeUrl(it.pdf_url))}" target="_blank" rel="noopener">[PDF] ${esc(host)}</a>` : ""}
      ${inha ? `<a class="ext-link" href="${esc(inha)}" target="_blank" rel="noopener noreferrer" data-inha-open title="${INHA_OPEN_TITLE}">${esc(INHA.buttons.view)}${EXT_MARK}</a>` : ""}
      ${scholar ? `<a class="ext-link" href="${esc(scholar)}" target="_blank" rel="noopener noreferrer" data-scholar-open title="${esc(SCHOLAR_LIBRARY_NOTE)}">${esc(INHA.buttons.scholar)}${EXT_MARK}</a>` : ""}
    </div></div>`);
  const inhaLink = $("[data-inha-open]", card);
  if (inhaLink) bindExtLink(inhaLink);
  const abs = $(".r-abs", card);
  if (abs) abs.onclick = () => abs.classList.toggle("clamp");
  const lib = $("[data-lib]", card);
  const drawLib = (focusSel = "") => {
    lib.innerHTML = "";
    if (it.in_library) {
      const b = el(`<button class="link in-lib">✓ 서재에 있음 · 열기</button>`);
      b.onclick = () => {
        state.activeId = it.in_library;
        state.filter = { kind: "all", id: null };
        state.q = "";
        location.hash = "#/library";
      };
      lib.appendChild(b);
      return;
    }
    const add = el(`<button class="btn sm primary">＋ 서재에 추가</button>`);
    add.onclick = () => doAdd(false, add);
    lib.appendChild(add);
    const safeOpen = safeUrl(it.oa_open_url);
    if (it.pdf_url) {
      const addPdf = el(`<button class="btn sm" data-addpdf style="margin-left:6px">PDF 포함 추가</button>`);
      addPdf.onclick = () => doAdd(true, addPdf);
      lib.appendChild(addPdf);
      const lic = licenseLabel(it._oaLicense);
      if (lic) {
        lib.appendChild(el(`<span class="chip success" data-oa-license style="margin-left:6px" title="${esc(`라이선스: ${lic} — PaperLab이 받아 서재에 저장해요`)}">${esc(lic)}<span class="sr-only"> 라이선스 — PaperLab이 받아 저장할 수 있어요</span></span>`));
      }
    } else if (safeOpen) {
      const a = el(oaTabLink(safeOpen, it._oaKind || "pdf"));
      a.style.marginLeft = "6px";
      const after = () => { if (!$(".oa-after", card)) card.appendChild(el(OA_AFTER_CARD)); };
      a.addEventListener("click", after);
      a.addEventListener("auxclick", (e) => { if (e.button === 1) after(); });
      lib.appendChild(a);
    } else if (it._oaNone) {
      lib.appendChild(el(`<span class="oa-none" tabindex="-1" style="margin-left:6px">무료 PDF 없음</span>`));
    } else if (it.doi && !lite) {
      const f = el(`<button class="btn sm" data-oa-find style="margin-left:6px" title="${esc(OA_FIND_TITLE)}">무료 PDF 찾기</button>`);
      f.onclick = () => findOa(f);
      lib.appendChild(f);
    }
    if (focusSel) $(focusSel, lib)?.focus();
  };
  // [무료 PDF 찾기] → 그 자리에서 ① PDF 포함 추가 ② 무료 PDF 열기 ③ 무료 PDF 없음 (4.4절 · 7.2절 3번 — 초점을 바뀐 자리로)
  const findOa = async (btn) => {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML = `<span class="spinner"></span> 찾는 중`;
    let r;
    try { r = await api.post("/api/oa/lookup", { doi: it.doi }); } catch (e) {
      errorToast(e);
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.textContent = "무료 PDF 찾기";
      return;
    }
    const oa = r && r.oa;
    if (!oa) {
      it._oaNone = true;
      drawLib(".oa-none");
      return announce("무료 PDF를 찾지 못했어요");
    }
    if (oa.server_fetch && oa.pdf_url) {
      it.pdf_url = oa.pdf_url;
      it._oaLicense = oa.license;
      drawLib("[data-addpdf]");
      const lic = licenseLabel(oa.license);
      return announce(`${lic ? `${lic} 라이선스 ` : ""}PDF를 찾았어요. PDF 포함 추가를 누르면 서재에 넣고 저장해요`);
    }
    it.oa_open_url = oa.open_url;
    it._oaKind = oa.open_kind;
    drawLib("[data-oa-open]");
    announce("무료 PDF가 있지만 라이선스를 확인하지 못했어요. 새 탭에서 직접 받아 주세요");
  };
  const doAdd = async (withPdf, btn) => {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${withPdf ? "PDF 받는 중" : "추가 중"}`;
    const payload = { ...it };
    for (const k of ["_oaLicense", "_oaKind", "_oaNone"]) delete payload[k];
    const r = await addPaper(payload, { downloadPdf: withPdf });
    if (r) it.in_library = r.id;
    drawLib();
  };
  drawLib();
  $("[data-cite]", card).onclick = () => citeDialog(it);
  $$("[data-g]", card).forEach((b) => (b.onclick = () => loadGraph(it, b.dataset.g)));
  // 씨앗 = 결과의 식별자 묶음(openalex_id · doi · arxiv_id · title)만 요청 본문으로
  const gopen = $("[data-graph-open]", card);
  if (gopen) gopen.onclick = () => openGraph(seedFromResult(it), { title: it.title || "" });
  return card;
}
