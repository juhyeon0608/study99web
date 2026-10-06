// 논문 찾기: OpenAlex · arXiv · Semantic Scholar · Crossref 통합 검색 (Google Scholar 방식)

import { api, qs } from "./api.js";
import { addPaper, citeDialog } from "./dialogs.js";
import { state } from "./state.js";
import { $, $$, authorsShort, el, esc, fmtNum, safeUrl } from "./ui.js";

const SOURCES = [
  ["openalex", "OpenAlex", "2억+ 편, 피인용·인용 관계"],
  ["semanticscholar", "Semantic Scholar", "AI 요약(TL;DR) 제공"],
  ["arxiv", "arXiv", "최신 프리프린트"],
  ["crossref", "Crossref", "DOI 등록 출판물"],
];
const SORT_LABEL = { relevance: "관련도순", cited: "피인용순", date: "최신순" };

const ds = {
  q: "", source: "openalex", yearFrom: "", yearTo: "", sort: "relevance", oa: false, page: 1,
  res: null, loading: false, error: "", graph: null, // graph: {paper, kind, page, res}
  seq: 0, // 늦게 도착한 이전 요청의 결과를 버리기 위한 번호
};

export function renderDiscover(main) {
  main.innerHTML = "";
  const view = el(`<section class="view">
    <div class="discover-head">
      <h1>논문 찾기</h1>
      <div class="sub">공개 학술 데이터베이스에서 검색해요. DOI나 arXiv 주소를 넣으면 그 논문을 바로 찾아요.</div>
      <form class="discover-bar">
        <div class="searchbox"><input class="input" name="q" placeholder="주제, 제목, 저자, DOI, arXiv ID…" value="${esc(ds.q)}"></div>
        <select class="input" name="source" style="width:auto">${SOURCES.map(([k, n]) => `<option value="${k}" ${k === ds.source ? "selected" : ""}>${n}</option>`).join("")}</select>
        <button class="btn primary" style="height:40px;padding:0 20px">검색</button>
      </form>
      <div class="discover-filters">
        <span>기간</span>
        <input class="input" name="yf" placeholder="부터" style="width:74px" value="${esc(ds.yearFrom)}"> –
        <input class="input" name="yt" placeholder="까지" style="width:74px" value="${esc(ds.yearTo)}">
        <span style="margin-left:6px">정렬</span>
        <div class="seg" data-sort>${Object.entries(SORT_LABEL).map(([k, v]) => `<button type="button" data-v="${k}" class="${k === ds.sort ? "active" : ""}">${v}</button>`).join("")}</div>
        <label class="check" style="margin-left:6px"><input type="checkbox" name="oa" ${ds.oa ? "checked" : ""}> 무료 PDF 있는 논문만</label>
        <span class="muted small" data-srcdesc style="margin-left:auto"></span>
      </div>
    </div>
    <div class="discover-results"></div></section>`);
  main.appendChild(view);
  const form = $("form", view);
  const srcSel = $("[name=source]", view);
  const desc = () => { $("[data-srcdesc]", view).textContent = (SOURCES.find((s) => s[0] === srcSel.value) || [])[2] || ""; };
  desc();
  srcSel.onchange = () => { desc(); if (ds.q) submit(); };
  const submit = () => {
    ds.q = $("[name=q]", view).value.trim();
    ds.source = srcSel.value;
    ds.yearFrom = $("[name=yf]", view).value.trim();
    ds.yearTo = $("[name=yt]", view).value.trim();
    ds.oa = $("[name=oa]", view).checked;
    ds.page = 1;
    ds.graph = null;
    search();
  };
  form.onsubmit = (e) => { e.preventDefault(); submit(); };
  $$("[data-sort] button", view).forEach((b) => (b.onclick = () => {
    ds.sort = b.dataset.v;
    $$("[data-sort] button", view).forEach((x) => x.classList.toggle("active", x === b));
    if (ds.q) submit();
  }));
  $("[name=oa]", view).onchange = () => { if (ds.q) submit(); };
  for (const n of ["yf", "yt"]) $(`[name=${n}]`, view).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
  draw();
  if (!ds.q) setTimeout(() => $("[name=q]", view).focus(), 30);
}

async function search() {
  const mine = ++ds.seq;
  ds.loading = true;
  ds.error = "";
  draw();
  let res = null;
  let error = "";
  try {
    res = await api.get("/api/search" + qs({
      q: ds.q, source: ds.source, page: ds.page, year_from: ds.yearFrom, year_to: ds.yearTo, sort: ds.sort, oa: ds.oa,
    }));
  } catch (e) {
    error = e.message;
  }
  if (mine !== ds.seq) return;
  Object.assign(ds, { res, error, loading: false });
  draw();
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

function draw() {
  const box = $(".discover-results");
  if (!box) return;
  box.innerHTML = "";
  box.scrollTop = 0;
  if (ds.graph) return drawGraph(box);
  if (ds.loading) {
    box.appendChild(el(`<div class="result-info"><span class="spinner"></span> 검색 중…</div>`));
    return;
  }
  if (ds.error) {
    box.appendChild(el(`<div class="status-line bad" style="margin-top:16px;max-width:900px">${esc(ds.error)}</div>`));
    return;
  }
  if (!ds.res) {
    box.appendChild(el(`<div class="empty"><div class="big">⌕</div><h3>무엇을 찾고 있나요?</h3>
      <p>키워드로 검색하고, 마음에 드는 논문은 한 번에 서재에 담으세요.<br>‘피인용’을 누르면 그 논문을 인용한 후속 연구를 따라갈 수 있어요.</p></div>`));
    return;
  }
  const { items, total } = ds.res;
  box.appendChild(el(`<div class="result-info">검색 결과 약 ${fmtNum(total)}건 · ${esc((SOURCES.find((s) => s[0] === ds.source) || [])[1] || "")}</div>`));
  if (!items.length) box.appendChild(el(`<p class="muted">결과가 없어요. 검색어를 바꾸거나 다른 데이터베이스를 골라 보세요.</p>`));
  for (const it of items) box.appendChild(resultCard(it));
  box.appendChild(pager(ds.page, total, (p) => { ds.page = p; search(); }));
}

function drawGraph(box) {
  const g = ds.graph;
  const label = { cited_by: "을(를) 인용한 논문", references: "의 참고문헌", related: "와(과) 관련된 논문" }[g.kind];
  const crumb = el(`<div class="crumb" style="max-width:900px"><button class="btn sm" data-back>← 검색 결과로</button>
    <span><b>${esc(g.paper.title.length > 70 ? g.paper.title.slice(0, 70) + "…" : g.paper.title)}</b>${label}</span></div>`);
  $("[data-back]", crumb).onclick = () => { ds.seq++; ds.graph = null; draw(); };
  box.appendChild(crumb);
  if (g.loading) return box.appendChild(el(`<div class="result-info"><span class="spinner"></span> 불러오는 중…</div>`));
  if (g.error) return box.appendChild(el(`<div class="status-line bad" style="max-width:900px">${esc(g.error)}</div>`));
  box.appendChild(el(`<div class="result-info">${fmtNum(g.res.total)}편${g.kind === "cited_by" ? " · 피인용 많은 순" : ""}</div>`));
  for (const it of g.res.items) box.appendChild(resultCard(it));
  box.appendChild(pager(g.page, g.res.total, (p) => loadGraph(g.paper, g.kind, p)));
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

function resultCard(it) {
  const venue = [it.venue, it.year].filter(Boolean).join(", ");
  const host = it.pdf_url ? (() => { try { return new URL(it.pdf_url).hostname.replace(/^www\./, ""); } catch { return "PDF"; } })() : "";
  const card = el(`<div class="result">
    <div class="r-title">${safeUrl(it.url) ? `<a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}</div>
    <div class="r-meta">${esc(authorsShort(it.authors, 4))}${venue ? ` - ${esc(venue)}` : ""}${it.doi ? ` - doi:${esc(it.doi)}` : it.arxiv_id ? ` - arXiv:${esc(it.arxiv_id)}` : ""}</div>
    ${it.tldr ? `<div class="r-tldr"><b>TL;DR</b> ${esc(it.tldr)}</div>` : ""}
    ${it.abstract ? `<div class="r-abs clamp" title="눌러서 펼치기">${esc(it.abstract)}</div>` : ""}
    <div class="r-actions">
      <span data-lib></span>
      <button class="link" data-cite>인용</button>
      ${it.cited_by_count != null ? `<button class="link" data-g="cited_by">피인용 ${fmtNum(it.cited_by_count)}</button>` : ""}
      <button class="link" data-g="references">참고문헌</button>
      <button class="link" data-g="related">관련 논문</button>
      ${safeUrl(it.pdf_url) ? `<a href="${esc(safeUrl(it.pdf_url))}" target="_blank" rel="noopener">[PDF] ${esc(host)}</a>` : ""}
    </div></div>`);
  const abs = $(".r-abs", card);
  if (abs) abs.onclick = () => abs.classList.toggle("clamp");
  const lib = $("[data-lib]", card);
  const drawLib = () => {
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
    if (it.pdf_url) {
      const addPdf = el(`<button class="btn sm" style="margin-left:6px">PDF 포함 추가</button>`);
      addPdf.onclick = () => doAdd(true, addPdf);
      lib.appendChild(addPdf);
    }
  };
  const doAdd = async (withPdf, btn) => {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${withPdf ? "PDF 받는 중" : "추가 중"}`;
    const r = await addPaper(it, { downloadPdf: withPdf });
    if (r) it.in_library = r.id;
    drawLib();
  };
  drawLib();
  $("[data-cite]", card).onclick = () => citeDialog(it);
  $$("[data-g]", card).forEach((b) => (b.onclick = () => loadGraph(it, b.dataset.g)));
  return card;
}
