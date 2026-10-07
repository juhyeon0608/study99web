// 서재 화면: 목록, 일괄 작업, 상세 패널(정보·태그·컬렉션·노트·인용 관계)

import { api, downloadBlob, qs, safeFilename } from "./api.js";
import {
  EXT_MARK, G5_NOTICE, ICON_GRAPH, SCHOLAR_LIBRARY_NOTE, addByIdentifierDialog, addPaper, bibliographyDialog, bindExtLink,
  citeDialog, copySearchQuery, editPaperDialog, exportPapers, folderIcon, folderPath, importDialog, issuesBox,
  moveToFolderDialog, openExternal, uploadPdfs,
} from "./dialogs.js";
import { INHA, inhaSearchTakesQuery, inhaSearchUrl, normalizeQuery, paperProxyTarget, scholarUrl } from "./extlinks.js";
import { openGraph } from "./graph.js";
import { refreshAll, refreshUsage, state } from "./state.js";
import {
  $, $$, authorName, authorsShort, confirmDialog, debounce, el, errorToast, esc, fmtDate, fmtNum, modalOpen, pickFiles,
  copyText, popupMenu, promptDialog, renderMarkdown, safeUrl, toast,
} from "./ui.js";

let root = null;
let detailTab = "info";
let relatedKind = "cited_by";
let noteSaver = null;
let detailToken = 0;

const INHA_OPEN_TITLE = `${INHA.proxyName}(정석학술정보관)로 원문 페이지를 열어요`;
const TITLE_SEARCH_DBS = [["riss", "RISS"], ["dbpia", "DBpia"], ["kiss", "KISS"]];

const SORTS = [["added", "추가한 순"], ["opened", "최근 연 순"], ["year", "연도 (최신)"], ["title", "제목"], ["first_author", "제1저자"], ["cited", "피인용 많은 순"]];

function filterTitle() {
  const f = state.filter;
  if (f.kind === "collection") return (state.collections.find((c) => c.id === f.id) || {}).name || "컬렉션";
  if (f.kind === "tag") return "#" + ((state.tags.find((t) => t.id === f.id) || {}).name || "태그");
  if (f.kind === "status") return state.meta.statuses[f.id] || "상태";
  if (f.kind === "folder") return (state.folders.find((x) => x.id === f.id) || {}).name || "폴더";
  if (f.kind === "no_folder") return "폴더 없음";
  return { all: "모든 논문", recent: "최근 연 논문", starred: "즐겨찾기", unfiled: "미분류" }[f.kind] || "서재";
}

function queryParams() {
  const f = state.filter;
  const p = { q: state.q, sort: state.sort };
  if (f.kind === "collection") p.collection = f.id;
  if (f.kind === "tag") p.tag = f.id;
  if (f.kind === "status") p.status = f.id;
  if (f.kind === "starred") p.starred = true;
  if (f.kind === "unfiled") p.filter = "unfiled";
  if (f.kind === "folder") p.folder = f.id;
  if (f.kind === "no_folder") p.filter = "no_folder";
  if (f.kind === "recent") p.sort = "opened";
  return p;
}

// 쓰던 노트를 지금 저장한다 (로그아웃 전)
export async function flushLibrary() {
  if (noteSaver) await noteSaver.flush();
}

export function renderLibrary(main) {
  if (noteSaver) noteSaver.flush();
  main.innerHTML = "";
  root = el(`<section class="view">
    <div class="toolbar">
      <h1>${esc(filterTitle())}</h1>
      <div class="searchbox"><input class="input" placeholder="서재 검색: 제목·저자·초록·본문·메모  ( / )" value="${esc(state.q)}"></div>
      <select class="input" data-sort title="정렬" style="width:auto">${SORTS.map(([k, v]) => `<option value="${k}" ${k === state.sort ? "selected" : ""}>${v}</option>`).join("")}</select>
      <span class="spacer"></span>
      <span class="menu-wrap"><button class="btn" data-export>내보내기 ▾</button></span>
      <span class="menu-wrap"><button class="btn primary" data-add>＋ 논문 추가 ▾</button></span>
    </div>
    <div class="lib-body no-detail">
      <div class="lib-list" tabindex="0"></div>
      <aside class="detail"></aside>
    </div></section>`);
  main.appendChild(root);
  const search = $(".searchbox input", root);
  const doSearch = debounce(() => { state.q = search.value.trim(); loadPapers(); }, 250);
  search.oninput = doSearch;
  search.onkeydown = (e) => { if (e.key === "Escape") { search.value = ""; doSearch.flush(); } };
  $("[data-sort]", root).onchange = (e) => {
    state.sort = e.target.value;
    try { localStorage.setItem("paperlab.sort", state.sort); } catch { /* 무시 */ }
    loadPapers();
  };
  $("[data-add]", root).onclick = (e) => {
    e.stopPropagation();
    popupMenu(e.currentTarget, [
      { label: "PDF 파일 추가", sub: "끌어다 놓기도 돼요", action: async () => uploadPdfs(await pickFiles({ accept: ".pdf,application/pdf", multiple: true })) },
      { label: "DOI · arXiv · 제목으로 추가", action: addByIdentifierDialog },
      { label: "직접 입력", action: () => editPaperDialog() },
      "-",
      { label: "논문 찾기에서 검색", action: () => { location.hash = "#/discover"; } },
      { label: "BibTeX · RIS · EndNote 가져오기", action: importDialog },
    ]);
  };
  $("[data-export]", root).onclick = (e) => {
    e.stopPropagation();
    const scope = exportScope();
    const label = scope.ids ? `선택한 ${scope.ids.length}편` : "지금 보이는 목록";
    popupMenu(e.currentTarget, [
      { label: "참고문헌 목록 만들기", sub: label, action: () => bibliographyDialog(scope) },
      "-",
      { label: "BibTeX (.bib)", sub: "LaTeX · Zotero", action: () => exportPapers("bibtex", scope) },
      { label: "RIS (.ris)", sub: "EndNote · Mendeley", action: () => exportPapers("ris", scope) },
      { label: "CSL-JSON (.json)", sub: "Zotero · Pandoc", action: () => exportPapers("csljson", scope) },
    ]);
  };
  const list = $(".lib-list", root);
  list.onkeydown = onListKey;
  loadPapers();
}

function exportScope() {
  if (state.selected.size) return { ids: [...state.selected] };
  return { ids: state.papers.map((p) => p.id) };
}

export async function loadPapers() {
  if (!root || !root.isConnected) return;
  try {
    const res = await api.get("/api/papers" + qs(queryParams()));
    state.papers = res.items;
    state.total = res.total;
    const ids = new Set(res.items.map((p) => p.id));
    for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id);
    if (state.activeId && !ids.has(state.activeId)) state.activeId = null;
    $(".toolbar h1", root).textContent = filterTitle();
    renderList();
    renderDetail();
  } catch (e) { errorToast(e); }
}

function renderList() {
  const list = $(".lib-list", root);
  const scrollTop = list.scrollTop;
  list.innerHTML = "";
  if (state.selected.size) list.appendChild(bulkBar());
  else {
    const head = el(`<div class="list-head"><input type="checkbox" title="모두 선택" ${state.papers.length ? "" : "disabled"}>
      <span>${state.q ? `‘${esc(state.q)}’ 검색 결과 ` : ""}${fmtNum(state.total)}편</span></div>`);
    $("input", head).onchange = () => { state.papers.forEach((p) => state.selected.add(p.id)); renderList(); };
    list.appendChild(head);
  }
  if (!state.papers.length) {
    list.appendChild(emptyState());
    return;
  }
  const frag = document.createDocumentFragment();
  for (const p of state.papers) frag.appendChild(paperRow(p));
  list.appendChild(frag);
  list.scrollTop = scrollTop;
}

function emptyState() {
  if (state.q) return el(`<div class="empty"><div class="big">⌕</div><h3>찾는 논문이 없어요</h3><p>다른 검색어를 써 보거나, ‘논문 찾기’에서 새 논문을 검색해 보세요.</p></div>`);
  if (state.filter.kind === "folder") return el(`<div class="empty"><div class="big">▤</div><h3>이 폴더에 논문이 없어요</h3><p>논문을 끌어다 놓거나 ‘폴더로 이동…’으로 옮겨 보세요.</p></div>`);
  if (state.filter.kind !== "all") return el(`<div class="empty"><div class="big">▤</div><h3>아직 비어 있어요</h3><p>논문을 이 목록으로 끌어다 놓거나, 여기서 논문을 추가하면 이곳에 들어가요.</p></div>`);
  const e = el(`<div class="empty"><div class="big">📚</div><h3>서재가 비어 있어요</h3>
    <p>PDF를 이 창에 끌어다 놓으면 DOI·arXiv 정보를 찾아 자동으로 정리해요.<br>또는 논문을 검색해서 바로 추가할 수 있어요.</p>
    <div class="row" style="margin-top:8px"><button class="btn primary" data-up>PDF 추가</button><button class="btn" data-find>논문 찾기</button><button class="btn" data-imp>BibTeX/RIS 가져오기</button></div></div>`);
  $("[data-up]", e).onclick = async () => uploadPdfs(await pickFiles({ accept: ".pdf", multiple: true }));
  $("[data-find]", e).onclick = () => { location.hash = "#/discover"; };
  $("[data-imp]", e).onclick = importDialog;
  return e;
}

function paperRow(p) {
  const sel = state.selected.has(p.id);
  const snippet = p.snippet ? esc(p.snippet).replace(/\[\[/g, "<mark>").replace(/\]\]/g, "</mark>") : "";
  const row = el(`<div class="paper-row ${p.id === state.activeId ? "active" : ""}" draggable="true" data-id="${p.id}">
    <input type="checkbox" ${sel ? "checked" : ""}>
    <button class="star ${p.starred ? "on" : ""}" title="즐겨찾기">${p.starred ? "★" : "☆"}</button>
    <div style="min-width:0">
      <div class="paper-title">${esc(p.title || "(제목 없음)")}</div>
      <div class="paper-sub">${esc(authorsShort(p.authors))}${p.venue ? ` · <span class="venue">${esc(p.venue)}</span>` : ""}${p.year ? ` · ${p.year}` : ""}</div>
      <div class="paper-meta">
        <span class="badge-status ${p.status}">${esc(state.meta.statuses[p.status] || p.status)}</span>
        ${p.tags.map((t) => `<span class="chip" ${t.color ? `style="color:${esc(t.color)}"` : ""}>#${esc(t.name)}</span>`).join("")}
        ${p.has_summary ? `<span class="chip accent">AI 요약</span>` : ""}
        ${p.annotation_count ? `<span class="chip">하이라이트 ${p.annotation_count}</span>` : ""}
      </div>
      ${snippet ? `<div class="paper-snippet">…${snippet}…</div>` : ""}
    </div>
    <div class="row-side">
      ${p.has_pdf ? `<span class="pdf-badge">PDF</span>` : ""}
      ${p.cited_by_count != null ? `<span title="피인용">인용 ${fmtNum(p.cited_by_count)}</span>` : ""}
    </div></div>`);
  $("input", row).onclick = (e) => {
    e.stopPropagation();
    e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id);
    renderList();
  };
  $(".star", row).onclick = async (e) => {
    e.stopPropagation();
    await api.patch(`/api/papers/${p.id}`, { starred: !p.starred });
    refreshAll();
  };
  row.onclick = (e) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      state.selected.has(p.id) ? state.selected.delete(p.id) : state.selected.add(p.id);
      return renderList();
    }
    setActive(p.id);
  };
  row.ondblclick = () => openPaper(p);
  row.ondragstart = (e) => {
    const ids = state.selected.has(p.id) ? [...state.selected] : [p.id];
    e.dataTransfer.setData("application/x-paperlab-ids", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "copy";
    row.classList.add("dragging");
  };
  row.ondragend = () => row.classList.remove("dragging");
  return row;
}

function setActive(id) {
  state.activeId = id;
  $$(".paper-row", root).forEach((r) => r.classList.toggle("active", Number(r.dataset.id) === id));
  renderDetail();
}

function onListKey(e) {
  if (modalOpen() || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const idx = state.papers.findIndex((p) => p.id === state.activeId);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next = state.papers[Math.max(0, Math.min(state.papers.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) {
      setActive(next.id);
      $(`.paper-row[data-id="${next.id}"]`, root)?.scrollIntoView({ block: "nearest" });
    }
  } else if (e.key === "Enter" && idx >= 0) {
    openPaper(state.papers[idx]);
  } else if (e.key === "Delete" && idx >= 0) {
    deletePapers([state.papers[idx].id]);
  }
}

export function openPaper(p) {
  if (p.has_pdf) location.hash = `#/read/${p.id}`;
  else { setActive(p.id); toast("PDF가 없는 논문이에요. 상세 패널에서 PDF를 받거나 첨부해 주세요."); }
}

async function deletePapers(ids) {
  const msg = ids.length === 1 ? "이 논문을 서재에서 삭제할까요? PDF·하이라이트·노트도 함께 지워져요." : `${ids.length}편을 삭제할까요? PDF·하이라이트·노트도 함께 지워져요.`;
  if (!(await confirmDialog(msg, { ok: "삭제", danger: true }))) return;
  if (ids.length === 1) await api.del(`/api/papers/${ids[0]}`);
  else await api.post("/api/papers/bulk", { ids, action: "delete" });
  state.selected.clear();
  toast("삭제했어요");
  refreshAll();
  refreshUsage();
}

function bulkBar() {
  const ids = [...state.selected];
  const bar = el(`<div class="bulkbar"><b>${ids.length}편 선택</b>
    <span class="menu-wrap"><button class="btn sm" data-col>컬렉션에 넣기 ▾</button></span>
    <button class="btn sm" data-folder>폴더로 이동…</button>
    ${state.filter.kind === "collection" ? `<button class="btn sm" data-uncol>이 컬렉션에서 빼기</button>` : ""}
    <button class="btn sm" data-tag>태그 달기</button>
    <span class="menu-wrap"><button class="btn sm" data-status>상태 ▾</button></span>
    <button class="btn sm" data-star>★ 즐겨찾기</button>
    <button class="btn sm" data-bib>참고문헌 목록</button>
    <button class="btn sm danger" data-del>삭제</button>
    <span class="spacer"></span><button class="btn sm ghost" data-clear>선택 해제</button></div>`);
  const bulk = async (action, value) => { await api.post("/api/papers/bulk", { ids, action, value }); refreshAll(); };
  $("[data-col]", bar).onclick = (e) => {
    e.stopPropagation();
    const items = state.collections.map((c) => ({ label: c.name, action: () => bulk("add_collection", c.id).then(() => toast(`'${c.name}'에 넣었어요`)) }));
    items.push("-", { label: "새 컬렉션 만들어 넣기", action: async () => {
      const name = await promptDialog("새 컬렉션 이름");
      if (!name) return;
      const { id } = await api.post("/api/collections", { name });
      bulk("add_collection", id);
    } });
    popupMenu(e.currentTarget, items, { left: true });
  };
  $("[data-folder]", bar).onclick = () => moveToFolderDialog(ids);
  const un = $("[data-uncol]", bar);
  if (un) un.onclick = () => bulk("remove_collection", state.filter.id);
  $("[data-tag]", bar).onclick = async () => {
    const name = await promptDialog("붙일 태그", { placeholder: "예: 핵심논문" });
    if (name) bulk("add_tag", name);
  };
  $("[data-status]", bar).onclick = (e) => {
    e.stopPropagation();
    popupMenu(e.currentTarget, Object.entries(state.meta.statuses).map(([k, v]) => ({ label: v, action: () => bulk("status", k) })), { left: true });
  };
  $("[data-star]", bar).onclick = () => bulk("star", true);
  $("[data-bib]", bar).onclick = () => bibliographyDialog({ ids });
  $("[data-del]", bar).onclick = () => deletePapers(ids);
  $("[data-clear]", bar).onclick = () => { state.selected.clear(); renderList(); };
  return bar;
}

// ----------------------------------------------------------- detail panel
async function renderDetail() {
  if (!root) return;
  const body = $(".lib-body", root);
  const panel = $(".detail", root);
  const token = ++detailToken;
  // 쓰던 노트를 먼저 저장하고 나서 다시 불러와야 방금 친 글자가 사라지지 않는다
  if (noteSaver) { const pending = noteSaver.flush(); noteSaver = null; await pending; }
  if (token !== detailToken) return;
  if (!state.activeId) { body.classList.add("no-detail"); panel.innerHTML = ""; return; }
  let p;
  try { p = await api.get(`/api/papers/${state.activeId}`); } catch (e) { return errorToast(e); }
  // 그사이 다른 논문을 골랐거나 다시 그리기가 시작됐으면 이 결과는 버린다
  if (token !== detailToken || p.id !== state.activeId) return;
  body.classList.remove("no-detail");
  const ids = (p.doi ? `<dt>DOI</dt><dd><a href="https://doi.org/${esc(p.doi)}" target="_blank" rel="noopener">${esc(p.doi)}</a></dd>` : "")
    + (p.arxiv_id ? `<dt>arXiv</dt><dd><a href="https://arxiv.org/abs/${esc(p.arxiv_id)}" target="_blank" rel="noopener">${esc(p.arxiv_id)}</a></dd>` : "")
    + (safeUrl(p.url) && !p.doi ? `<dt>링크</dt><dd><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\//, "").slice(0, 50))}</a></dd>` : "")
    + scholarRow(p);
  // 학교 프록시로 열 주소(없으면 숨김), 대상이 없을 때 제목으로 학교 DB 검색 (시안 5장)
  const inha = paperProxyTarget(p);
  const titleQ = normalizeQuery(p.title);
  const inhaBtn = p.has_pdf ? "" : inha
    ? `<a class="btn" href="${esc(inha)}" target="_blank" rel="noopener noreferrer" data-inha-open title="${INHA_OPEN_TITLE}">${esc(INHA.buttons.view)}${EXT_MARK}</a>`
    : titleQ ? `<span class="menu-wrap"><button class="btn" data-inha-title-search aria-haspopup="menu" aria-expanded="false">학교 DB에서 제목 검색 ▾</button></span>` : "";
  const venueBits = [p.venue, p.volume && `${p.volume}권`, p.issue && `${p.issue}호`, p.pages && `${p.pages}쪽`].filter(Boolean).join(", ");
  panel.innerHTML = "";
  const inner = el(`<div class="detail-inner">
    <div class="row" style="align-items:flex-start">
      <h2 class="grow">${esc(p.title)}</h2>
      <button class="icon-btn" data-close title="닫기">✕</button>
    </div>
    <div class="authors">${esc((p.authors || []).map(authorName).join(", ") || "저자 미상")}</div>
    <div class="venue-line">${esc([venueBits, p.year].filter(Boolean).join(" · "))}</div>
    <div class="actions">
      ${p.has_pdf ? `<button class="btn primary" data-read>읽기 · AI 요약</button>` : `<button class="btn primary" data-fetch>PDF 받기</button>${inhaBtn}<button class="btn" data-attach>PDF 첨부</button>`}
      <button class="btn" data-cite>인용</button>
      <span class="menu-wrap"><button class="btn" data-more>⋯</button></span>
    </div>
    <div class="inha-after-slot" data-inha-after role="status"></div>
    <div data-issues></div>
    <div class="row" style="gap:14px;flex-wrap:wrap">
      <div class="seg" data-status>${Object.entries(state.meta.statuses).map(([k, v]) => `<button data-v="${k}" class="${p.status === k ? "active" : ""}">${v}</button>`).join("")}</div>
      <div class="rating" title="중요도">${[1, 2, 3, 4, 5].map((n) => `<button data-r="${n}" class="${p.rating >= n ? "on" : ""}">★</button>`).join("")}</div>
    </div>
    <div class="section-title">태그</div>
    <div class="tag-input">${p.tags.map((t) => `<span class="chip">#${esc(t.name)}<button data-untag="${esc(t.name)}">✕</button></span>`).join("")}
      <input placeholder="태그 입력 후 Enter" list="tag-suggest"><datalist id="tag-suggest">${state.tags.map((t) => `<option value="${esc(t.name)}">`).join("")}</datalist></div>
    <div class="section-title">폴더</div>
    <div class="folder-line" data-folder-line></div>
    <div class="section-title">컬렉션</div>
    <div class="chips">${p.collections.map((cid) => {
      const c = state.collections.find((x) => x.id === cid);
      return c ? `<span class="chip">${esc(c.name)}<button data-uncol="${cid}">✕</button></span>` : "";
    }).join("")}<span class="menu-wrap"><button class="btn sm" data-addcol>＋ 넣기</button></span></div>
    <div class="tabs"><button data-tab="info">정보</button><button data-tab="note">노트</button><button data-tab="related">인용 관계</button></div>
    <div class="tab-body"></div></div>`);
  panel.appendChild(inner);
  const reload = () => { refreshAll(); };
  drawFolderLine($("[data-folder-line]", inner), p);

  const ib = issuesBox(p.cite_issues, () => editPaperDialog(p));
  if (ib) {
    ib.insertAdjacentHTML("beforeend", `<button class="btn sm ghost" data-online>온라인에서 찾기</button>`);
    $("[data-online]", ib).onclick = () => fillOnline(p);
    $("[data-issues]", inner).appendChild(ib);
  }
  $("[data-close]", inner).onclick = () => { state.activeId = null; renderList(); renderDetail(); };
  const read = $("[data-read]", inner);
  if (read) read.onclick = () => openPaper(p);
  const fetchBtn = $("[data-fetch]", inner);
  if (fetchBtn) fetchBtn.onclick = async () => {
    fetchBtn.disabled = true;
    fetchBtn.innerHTML = `<span class="spinner"></span> 찾는 중`;
    try { await api.post(`/api/papers/${p.id}/fetch-pdf`); toast("PDF를 받았어요", "success"); reload(); refreshUsage(); }
    catch (e) { errorToast(e); fetchBtn.disabled = false; fetchBtn.textContent = "PDF 받기"; }
  };
  const attach = $("[data-attach]", inner);
  if (attach) attach.onclick = () => attachPdf(p.id, false);
  // G-5: 실제로 새 탭을 연 뒤 한 줄 안내 — 패널을 다시 그릴 때까지 (D-1)
  const showAfter = () => { $("[data-inha-after]", inner).innerHTML = G5_NOTICE; };
  const inhaLink = $("[data-inha-open]", inner);
  if (inhaLink) bindExtLink(inhaLink, { onOpen: showAfter });
  const titleSearch = $("[data-inha-title-search]", inner);
  if (titleSearch) titleSearch.onclick = (e) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    btn.setAttribute("aria-expanded", "true");
    popupMenu(btn, TITLE_SEARCH_DBS.map(([db, name]) => ({
      label: name,
      sub: inhaSearchTakesQuery(db) ? "새 탭" : "새 탭 · 제목 복사",
      action: () => openExternal(inhaSearchUrl(db, titleQ), {
        returnFocus: btn, before: inhaSearchTakesQuery(db) ? null : () => copySearchQuery(titleQ),
      }),
    })), { left: true, focus: e.detail === 0, onClose: () => btn.setAttribute("aria-expanded", "false") });
  };
  $("[data-cite]", inner).onclick = () => citeDialog(p.id);
  const moreBtn = $("[data-more]", inner);
  moreBtn.onclick = (e) => {
    e.stopPropagation();
    popupMenu(e.currentTarget, [
      { label: "정보 수정", action: () => editPaperDialog(p) },
      { label: "폴더로 이동…", action: () => moveToFolderDialog([p.id], p.folder_id ?? null) },
      { label: "온라인 정보로 채우기", sub: "DOI·arXiv·제목", action: () => fillOnline(p) },
      ...(p.has_pdf ? [{ label: "PDF 바꾸기", action: () => attachPdf(p.id, true) },
        { label: "PDF 파일 열기", action: () => openPdfFile(p.id) },
        ...(inha ? [{ label: INHA.buttons.view, sub: "새 탭", action: () => openExternal(inha, { returnFocus: moreBtn }) }] : [])] : []),
      { label: "하이라이트·노트 내보내기 (.md)", action: () => exportAnnotations(p.id, p.title) },
      "-",
      { label: "삭제", danger: true, action: () => deletePapers([p.id]) },
    ]);
  };
  $$("[data-status] button", inner).forEach((b) => (b.onclick = async () => { await api.patch(`/api/papers/${p.id}`, { status: b.dataset.v }); reload(); }));
  $$(".rating button", inner).forEach((b) => (b.onclick = async () => {
    const r = Number(b.dataset.r);
    await api.patch(`/api/papers/${p.id}`, { rating: p.rating === r ? 0 : r });
    reload();
  }));
  const tagInput = $(".tag-input input", inner);
  tagInput.onkeydown = async (e) => {
    if (e.key === "Enter" && tagInput.value.trim()) {
      e.preventDefault();
      await api.patch(`/api/papers/${p.id}`, { tags: [...p.tags.map((t) => t.name), tagInput.value.trim()] });
      reload();
    }
  };
  $$("[data-untag]", inner).forEach((b) => (b.onclick = async () => {
    await api.patch(`/api/papers/${p.id}`, { tags: p.tags.map((t) => t.name).filter((n) => n !== b.dataset.untag) });
    reload();
  }));
  $$("[data-uncol]", inner).forEach((b) => (b.onclick = async () => {
    await api.post("/api/papers/bulk", { ids: [p.id], action: "remove_collection", value: Number(b.dataset.uncol) });
    reload();
  }));
  $("[data-addcol]", inner).onclick = (e) => {
    e.stopPropagation();
    const items = state.collections.filter((c) => !p.collections.includes(c.id))
      .map((c) => ({ label: c.name, action: async () => { await api.post("/api/papers/bulk", { ids: [p.id], action: "add_collection", value: c.id }); reload(); } }));
    items.push("-", { label: "새 컬렉션…", action: async () => {
      const name = await promptDialog("새 컬렉션 이름");
      if (!name) return;
      const { id } = await api.post("/api/collections", { name });
      await api.post("/api/papers/bulk", { ids: [p.id], action: "add_collection", value: id });
      reload();
    } });
    popupMenu(e.currentTarget, items, { left: true });
  };
  const showTab = (tab) => {
    if (noteSaver) { noteSaver.flush(); noteSaver = null; }
    detailTab = tab;
    $$(".tabs button", inner).forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    const tb = $(".tab-body", inner);
    tb.innerHTML = "";
    if (tab === "note") tb.appendChild(noteEditor(p));
    else if (tab === "related") tb.appendChild(relatedView(p));
    else tb.appendChild(infoView(p, ids));
  };
  $$(".tabs button", inner).forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  showTab(detailTab);
}

// 정보 탭 "바로가기" 줄: Google Scholar (질의 = 제목, 제목이 비면 DOI — IK-3). 둘 다 없으면 줄을 뺌
function scholarRow(p) {
  const url = scholarUrl(p.title) || scholarUrl(p.doi);
  return url ? `<dt>바로가기</dt><dd><a class="ext-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-scholar-open
    title="${esc(SCHOLAR_LIBRARY_NOTE)}">${esc(INHA.buttons.scholar)}${EXT_MARK}</a></dd>` : "";
}

function infoView(p, ids) {
  const v = el(`<div>
    ${p.abstract ? `<div class="section-title">초록</div><div class="abstract clamp">${esc(p.abstract)}</div>` : `<p class="small muted" style="margin-top:14px">초록이 없어요. ⋯ 메뉴의 ‘온라인 정보로 채우기’를 눌러 보세요.</p>`}
    ${p.keywords && p.keywords.length ? `<div class="section-title">키워드</div><div class="chips">${p.keywords.map((k) => `<span class="chip">${esc(k)}</span>`).join("")}</div>` : ""}
    <dl class="kv">
      ${ids}
      <dt>유형</dt><dd>${esc(state.meta.item_types[p.item_type] || p.item_type)}</dd>
      ${p.publisher ? `<dt>출판사</dt><dd>${esc(p.publisher)}</dd>` : ""}
      ${p.cited_by_count != null ? `<dt>피인용</dt><dd>${fmtNum(p.cited_by_count)}회</dd>` : ""}
      ${p.page_count ? `<dt>쪽수</dt><dd>${p.page_count}쪽</dd>` : ""}
      <dt>인용 키</dt><dd><code>${esc(p.citekey)}</code> <button class="btn sm" data-copykey title="원고·워드·한글 본문에 붙여넣으세요">[@인용키] 복사</button></dd>
      <dt>추가한 날</dt><dd>${fmtDate(p.added_at)}</dd>
      ${p.last_opened_at ? `<dt>최근 읽음</dt><dd>${fmtDate(p.last_opened_at)}</dd>` : ""}
    </dl></div>`);
  const abs = $(".abstract", v);
  if (abs) abs.onclick = () => abs.classList.toggle("clamp");
  $("[data-copykey]", v).onclick = () => copyText(`[@${p.citekey}]`);
  return v;
}

function noteEditor(p) {
  const v = el(`<div style="margin-top:12px">
    <div class="row" style="margin-bottom:8px"><div class="seg"><button class="active" data-m="edit">쓰기</button><button data-m="view">미리보기</button></div>
    <span class="spacer"></span><span class="small muted" data-st></span></div>
    <textarea class="input note-editor" placeholder="마크다운으로 자유롭게 정리하세요. 수식은 $E=mc^2$ 처럼 쓰면 돼요.">${esc(p.note || "")}</textarea>
    <div class="prose hidden" style="min-height:200px"></div></div>`);
  const ta = $("textarea", v);
  const st = $("[data-st]", v);
  const save = debounce(async () => {
    try { await api.put(`/api/papers/${p.id}/note`, { content: ta.value }); p.note = ta.value; st.textContent = "저장됨"; }
    catch (e) { st.textContent = "저장 실패"; errorToast(e); }
  }, 700);
  noteSaver = { flush: () => (ta.value !== (p.note || "") ? save.flush() : null) };
  ta.oninput = () => { st.textContent = "입력 중…"; save(); };
  $$(".seg button", v).forEach((b) => (b.onclick = () => {
    $$(".seg button", v).forEach((x) => x.classList.toggle("active", x === b));
    const view = b.dataset.m === "view";
    ta.classList.toggle("hidden", view);
    const prev = $(".prose", v);
    prev.classList.toggle("hidden", !view);
    if (view) prev.innerHTML = renderMarkdown(ta.value) || `<p class="muted">비어 있어요</p>`;
  }));
  return v;
}

function relatedView(p) {
  const v = el(`<div style="margin-top:12px">
    <div class="graph-entry">
      ${ICON_GRAPH}
      <div class="graph-entry-text"><b>인용 그래프</b><span>주제가 가까운 논문 수십 편을 한 장의 그림으로 보여 줘요.</span></div>
      <button type="button" class="btn sm primary" data-graph-open>인용 그래프 보기</button>
    </div>
    <div class="seg"><button data-k="cited_by">이 논문을 인용한 논문</button><button data-k="references">참고문헌</button><button data-k="related">관련 논문</button></div>
    <div class="mini-list" style="margin-top:8px"></div></div>`);
  // 씨앗 = 서재 논문 번호만 (서버가 내 권한으로 읽어 식별자를 찾음)
  $("[data-graph-open]", v).onclick = () => openGraph({ paper_id: p.id }, { title: p.title || "" });
  const list = $(".mini-list", v);
  let seq = 0;
  const load = async (kind, page = 1) => {
    const mine = ++seq;
    relatedKind = kind;
    $$(".seg button", v).forEach((b) => b.classList.toggle("active", b.dataset.k === kind));
    if (page === 1) list.innerHTML = `<div class="status-line" style="margin-top:6px"><span class="spinner"></span> OpenAlex에서 불러오는 중…</div>`;
    try {
      const res = await api.get(`/api/papers/${p.id}/related${qs({ kind, page })}`);
      if (mine !== seq) return; // 그사이 다른 탭을 눌렀다
      if (page === 1) list.innerHTML = `<div class="small muted" style="padding:6px 0">${fmtNum(res.total)}편${kind === "cited_by" ? " (피인용 많은 순)" : ""}</div>`;
      else $(".more", list)?.remove();
      for (const it of res.items) list.appendChild(miniResult(it));
      if (!res.items.length && page === 1) list.appendChild(el(`<p class="small muted">결과가 없어요</p>`));
      if (res.total > page * 20) {
        const more = el(`<button class="btn sm more" style="margin-top:8px">더 보기</button>`);
        more.onclick = () => load(kind, page + 1);
        list.appendChild(more);
      }
    } catch (e) {
      if (mine === seq) list.innerHTML = `<div class="status-line bad" style="margin-top:6px">${esc(e.message)}</div>`;
    }
  };
  $$(".seg button", v).forEach((b) => (b.onclick = () => load(b.dataset.k)));
  load(relatedKind);
  return v;
}

export function miniResult(it) {
  const m = el(`<div class="mini">
    <div class="t">${safeUrl(it.url) ? `<a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}</div>
    <div class="s">${esc(authorsShort(it.authors, 2))}${it.venue ? ` · ${esc(it.venue)}` : ""}${it.year ? ` · ${it.year}` : ""}${it.cited_by_count != null ? ` · 인용 ${fmtNum(it.cited_by_count)}` : ""}</div>
    <div class="a">${it.in_library ? `<span class="chip success">서재에 있음</span>` : `<button class="btn sm" data-add>＋ 서재에 추가</button>`}
      ${it.pdf_url && !it.in_library ? `<button class="btn sm ghost" data-addpdf>PDF 포함 추가</button>` : ""}</div></div>`);
  const add = async (withPdf, btn) => {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>`;
    const r = await addPaper(it, { downloadPdf: withPdf });
    if (r) { it.in_library = r.id; $(".a", m).innerHTML = `<span class="chip success">서재에 있음</span>`; }
    else { btn.disabled = false; btn.textContent = "다시 시도"; }
  };
  const a = $("[data-add]", m);
  if (a) a.onclick = () => add(false, a);
  const ap = $("[data-addpdf]", m);
  if (ap) ap.onclick = () => add(true, ap);
  return m;
}

async function fillOnline(p) {
  try {
    const fresh = await api.post(`/api/papers/${p.id}/refresh`, {});
    const left = fresh.cite_issues || [];
    toast(left.length ? `채웠어요. 아직 빈 항목: ${left.join(", ")}` : "빈 항목과 피인용 수를 채웠어요", left.length ? "" : "success");
    refreshAll();
  } catch (err) {
    toast(err.message, "error");
    const id = await promptDialog("DOI나 arXiv ID를 직접 입력해 주세요", { placeholder: "10.xxxx/... 또는 2303.08774" });
    if (!id) return;
    try { await api.post(`/api/papers/${p.id}/refresh`, { identifier: id, overwrite: true }); refreshAll(); }
    catch (e2) { errorToast(e2); }
  }
}

// PDF 첨부 · 바꾸기: 업로드 창에 한 줄로 (시안 12장)
async function attachPdf(id, replace) {
  const [file] = await pickFiles({ accept: ".pdf,application/pdf" });
  if (!file) return;
  uploadPdfs([file], { attachTo: id, replace });
}

// 상세 패널 "폴더" 줄: 지금 폴더 경로 + [옮기기]
function drawFolderLine(line, p) {
  const names = p.folder_id != null ? folderPath(p.folder_id) : [];
  line.innerHTML = `${folderIcon(!names.length)}
    <span class="folder-path ${names.length ? "" : "is-none"}" title="${esc(names.join(" › "))}">${names.length
      ? names.map(esc).join(`<span class="sep">›</span>`) : "폴더 없음"}</span>
    <button class="btn sm" data-move-folder>옮기기</button>`;
  $("[data-move-folder]", line).onclick = () => moveToFolderDialog([p.id], p.folder_id ?? null);
}

// "PDF 파일 열기": 빈 창을 먼저 열고(팝업 차단 회피) 서명 주소로 보낸다 (명세 6.7)
export async function openPdfFile(pid) {
  const w = window.open("", "_blank");
  if (w) {
    try { w.opener = null; w.document.title = "PDF"; w.document.body.textContent = "PDF를 여는 중…"; } catch { /* 무시 */ }
  }
  try {
    const { url } = await api.get(`/api/papers/${pid}/pdf-url`);
    if (w && !w.closed) w.location.replace(url);
    else window.open(url, "_blank", "noopener");
  } catch (e) {
    if (w && !w.closed) w.close();
    errorToast(e);
  }
}

// 하이라이트 · 노트 내보내기: 헤더를 붙여 받아 파일로 저장 (명세 6.7)
export async function exportAnnotations(pid, title) {
  try {
    const res = await api.raw("GET", `/api/annotations/export/${pid}`);
    if (!res.ok) {
      let msg = `오류 (${res.status})`;
      try { msg = (await res.json()).detail || msg; } catch { /* 본문 없음 */ }
      throw new Error(msg);
    }
    downloadBlob(await res.blob(), `${safeFilename(title, "highlights")}.md`);
  } catch (e) { errorToast(e); }
}
