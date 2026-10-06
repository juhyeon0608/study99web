// 진입점: 사이드바(필터·컬렉션·태그), 화면 전환(#/library, #/discover, #/read/:id)

import { api } from "./api.js";
import { settingsDialog, uploadPdfs } from "./dialogs.js";
import { renderDiscover } from "./discover.js";
import { loadPapers, renderLibrary } from "./library.js";
import { closeReader, openReader } from "./reader.js";
import { onRefresh, refreshAll, state } from "./state.js";
import { $, $$, confirmDialog, el, errorToast, esc, modalOpen, popupMenu, promptDialog } from "./ui.js";

const main = $("#main");
const COLLAPSE_KEY = "paperlab.collapsed";
let collapsed = new Set();
try { collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")); } catch { /* 저장소 없음 */ }

// ------------------------------------------------------------------ theme
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("paperlab.theme", theme); } catch { /* 무시 */ }
}
let savedTheme = null;
try { savedTheme = localStorage.getItem("paperlab.theme"); } catch { /* 무시 */ }
applyTheme(savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
$("#theme-toggle").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

// ---------------------------------------------------------------- sidebar
async function loadSidebar() {
  const [collections, tags, stats] = await Promise.all([
    api.get("/api/collections"), api.get("/api/tags"), api.get("/api/stats"),
  ]);
  Object.assign(state, { collections, tags, stats });
  renderSidebar();
}

function filterKey(f) {
  if (f.kind === "status") return `status:${f.id}`;
  return f.kind;
}

function renderSidebar() {
  for (const node of $$("[data-count]")) {
    const v = state.stats[node.dataset.count];
    node.textContent = v ? v : "";
  }
  const key = filterKey(state.filter);
  for (const b of $$("#sidebar .nav-item[data-filter]")) {
    b.classList.toggle("active", state.view === "library" && b.dataset.filter === key);
  }
  $$("#sidebar .nav-item[data-view]").forEach((b) => b.classList.toggle("active", state.view === b.dataset.view));

  // 컬렉션 트리
  const tree = $("#collection-tree");
  tree.innerHTML = "";
  const byParent = new Map();
  for (const c of state.collections) {
    const k = c.parent_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  }
  const build = (parentId, container) => {
    for (const c of byParent.get(parentId) || []) {
      const kids = byParent.get(c.id) || [];
      const isActive = state.view === "library" && state.filter.kind === "collection" && state.filter.id === c.id;
      const row = el(`<div class="tree-row">
        <button class="nav-item ${isActive ? "active" : ""}" data-cid="${c.id}">
          <i class="ico toggle">${kids.length ? (collapsed.has(c.id) ? "▸" : "▾") : "▫"}</i>
          <span class="label">${esc(c.name)}</span><span class="count">${c.count || ""}</span></button>
        <span class="menu-wrap"><button class="icon-btn small row-menu" title="메뉴">⋯</button></span></div>`);
      const btn = $(".nav-item", row);
      btn.onclick = (e) => {
        if (e.target.classList.contains("toggle") && kids.length) {
          collapsed.has(c.id) ? collapsed.delete(c.id) : collapsed.add(c.id);
          try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch { /* 무시 */ }
          return renderSidebar();
        }
        setFilter({ kind: "collection", id: c.id });
      };
      // 논문 행을 끌어다 놓으면 컬렉션에 추가
      btn.ondragover = (e) => { if (e.dataTransfer.types.includes("application/x-paperlab-ids")) { e.preventDefault(); btn.classList.add("drop-target"); } };
      btn.ondragleave = () => btn.classList.remove("drop-target");
      btn.ondrop = async (e) => {
        e.preventDefault();
        btn.classList.remove("drop-target");
        const ids = JSON.parse(e.dataTransfer.getData("application/x-paperlab-ids") || "[]");
        if (!ids.length) return;
        await api.post("/api/papers/bulk", { ids, action: "add_collection", value: c.id });
        refreshAll();
      };
      $(".row-menu", row).onclick = (e) => {
        e.stopPropagation();
        popupMenu(e.currentTarget, [
          { label: "하위 컬렉션 추가", action: () => newCollection(c.id) },
          { label: "이름 바꾸기", action: async () => {
            const name = await promptDialog("컬렉션 이름", { value: c.name });
            if (name) { await api.patch(`/api/collections/${c.id}`, { name }); refreshAll(); }
          } },
          ...(c.parent_id ? [{ label: "최상위로 옮기기", action: async () => { await api.patch(`/api/collections/${c.id}`, { parent_id: null }); refreshAll(); } }] : []),
          "-",
          { label: "삭제 (논문은 남아요)", danger: true, action: async () => {
            if (!(await confirmDialog(`'${c.name}' 컬렉션과 하위 컬렉션을 삭제할까요? 논문 자체는 서재에 남아요.`, { ok: "삭제" }))) return;
            await api.del(`/api/collections/${c.id}`);
            if (state.filter.kind === "collection" && state.filter.id === c.id) state.filter = { kind: "all", id: null };
            refreshAll();
          } },
        ], { left: true });
      };
      container.appendChild(row);
      if (kids.length && !collapsed.has(c.id)) {
        const sub = el(`<div class="tree-children"></div>`);
        build(c.id, sub);
        container.appendChild(sub);
      }
    }
  };
  build(0, tree);
  if (!state.collections.length) tree.appendChild(el(`<div class="empty-hint">＋를 눌러 주제별로 묶어 보세요</div>`));

  // 태그
  const tagBox = $("#tag-list");
  tagBox.innerHTML = "";
  for (const t of state.tags) {
    const isActive = state.view === "library" && state.filter.kind === "tag" && state.filter.id === t.id;
    const row = el(`<div class="tree-row"><button class="nav-item ${isActive ? "active" : ""}">
      <span class="tag-dot" style="${t.color ? `background:${esc(t.color)}` : ""}"></span><span class="label">${esc(t.name)}</span><span class="count">${t.count || ""}</span></button>
      <span class="menu-wrap"><button class="icon-btn small row-menu">⋯</button></span></div>`);
    $(".nav-item", row).onclick = () => setFilter({ kind: "tag", id: t.id });
    $(".row-menu", row).onclick = (e) => {
      e.stopPropagation();
      const colors = [["", "기본"], ["#e03131", "빨강"], ["#f08c00", "주황"], ["#2f9e44", "초록"], ["#1971c2", "파랑"], ["#9c36b5", "보라"]];
      popupMenu(e.currentTarget, [
        { label: "이름 바꾸기", action: async () => {
          const name = await promptDialog("태그 이름", { value: t.name });
          if (name) { await api.patch(`/api/tags/${t.id}`, { name }); refreshAll(); }
        } },
        ...colors.map(([c, n]) => ({ label: `색: ${n}`, action: async () => { await api.patch(`/api/tags/${t.id}`, { color: c }); refreshAll(); } })),
        "-",
        { label: "태그 삭제", danger: true, action: async () => {
          if (!(await confirmDialog(`'${t.name}' 태그를 모든 논문에서 지울까요?`, { ok: "삭제" }))) return;
          await api.del(`/api/tags/${t.id}`);
          if (state.filter.kind === "tag" && state.filter.id === t.id) state.filter = { kind: "all", id: null };
          refreshAll();
        } },
      ], { left: true });
    };
    tagBox.appendChild(row);
  }
  if (!state.tags.length) tagBox.appendChild(el(`<div class="empty-hint">논문에 태그를 달면 여기에 보여요</div>`));
}

async function newCollection(parentId = null) {
  const name = await promptDialog(parentId ? "하위 컬렉션 이름" : "새 컬렉션 이름", { placeholder: "예: 졸업논문 2장, 추천 시스템" });
  if (!name) return;
  try {
    const { id } = await api.post("/api/collections", { name, parent_id: parentId });
    if (parentId) collapsed.delete(parentId);
    state.filter = { kind: "collection", id };
    location.hash = "#/library";
    await refreshAll();
  } catch (e) { errorToast(e); }
}

export function setFilter(filter) {
  state.filter = filter;
  state.selected.clear();
  if (location.hash.startsWith("#/library")) {
    renderSidebar();
    renderLibrary(main);
  } else {
    location.hash = "#/library";
  }
}

for (const b of $$("#sidebar .nav-item[data-filter]")) {
  b.onclick = () => {
    const [kind, id] = b.dataset.filter.split(":");
    setFilter({ kind, id: id || null });
  };
}
$$("#sidebar .nav-item[data-view]").forEach((b) => (b.onclick = () => { location.hash = `#/${b.dataset.view}`; }));
$("#add-collection").onclick = () => newCollection();
$("#open-settings").onclick = () => settingsDialog();

// ----------------------------------------------------------------- router
async function route() {
  const hash = location.hash || "#/library";
  const app = $("#app");
  const m = hash.match(/^#\/read\/(\d+)(?:\/p(\d+))?/);
  if (m) {
    state.view = "reader";
    app.classList.add("reading");
    renderSidebar();
    return openReader(main, Number(m[1]), m[2] ? Number(m[2]) : null);
  }
  closeReader();
  app.classList.remove("reading");
  if (hash.startsWith("#/discover")) {
    state.view = "discover";
    renderSidebar();
    return renderDiscover(main);
  }
  state.view = "library";
  renderSidebar();
  return renderLibrary(main);
}

window.addEventListener("hashchange", route);

onRefresh(loadSidebar);
onRefresh(async () => { if (state.view === "library") await loadPapers(); });

// PDF 끌어다 놓기 (서재 화면 어디든)
let dragDepth = 0;
const isFileDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
window.addEventListener("dragenter", (e) => { if (isFileDrag(e) && state.view !== "reader") { dragDepth++; $("#drop-overlay").classList.remove("hidden"); } });
window.addEventListener("dragleave", (e) => { if (isFileDrag(e) && --dragDepth <= 0) { dragDepth = 0; $("#drop-overlay").classList.add("hidden"); } });
window.addEventListener("dragover", (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener("drop", (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").classList.add("hidden");
  if (state.view === "reader") return;
  uploadPdfs([...e.dataTransfer.files]);
});

// 단축키: / 검색, Esc는 각 화면/모달이 처리
window.addEventListener("keydown", (e) => {
  if (modalOpen()) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if (e.key === "/" && !typing) {
    const box = $("#main .searchbox input");
    if (box) { e.preventDefault(); box.focus(); box.select(); }
  }
});

async function boot() {
  try {
    const [meta, settings] = await Promise.all([api.get("/api/meta"), api.get("/api/settings")]);
    state.meta = meta;
    state.settings = settings;
    try { state.sort = localStorage.getItem("paperlab.sort") || "added"; } catch { /* 무시 */ }
    await loadSidebar();
    await route();
  } catch (e) {
    errorToast(e);
    main.innerHTML = `<div class="empty"><div class="big">⚠</div><h3>서버에 연결하지 못했어요</h3><p>${esc(e.message)}</p></div>`;
  }
}

// 외부 스크립트(KaTeX·marked)가 defer로 로드된 뒤 시작
if (document.readyState === "complete") boot(); else window.addEventListener("load", boot);
