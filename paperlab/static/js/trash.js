// 6단계 서재 휴지통 화면 #/trash (docs/design/phase6-folder-sync-ui.md 8장 SW-1 · 9장 SW-2).
// 휴지통 논문은 열 수 없으므로 제목은 링크가 아님. 제목 · 파일 이름은 esc()로만 넣는다(AC-693).
import { api } from "./api.js";
import { $, $$, authorsShort, confirmDialog, el, errorToast, esc, fmtBytes, fmtDate, toast } from "./ui.js";
import { refreshAll, refreshUsage, state } from "./state.js";

const TRASH_ICON = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/></svg>`;
const DAY = 86400000;
let T = null; // {view, items, selected, total}

// 휴지통에서 되살리기 (서재 토스트 [되돌리기] · 중복 안내 [되살리기] · 휴지통 화면 공용)
export async function restoreFromTrash(ids, done = "") {
  try {
    const r = await api.post("/api/trash/restore", { ids });
    let msg = done || (r.restored === 1 ? "되살렸어요" : `${r.restored}편을 되살렸어요`);
    if (!done && r.renamed && r.renamed.length) msg += ` · ${r.renamed.length}편은 같은 이름이 있어 이름 끝에 (2)를 붙였어요`;
    if (!done && r.to_root) msg += ` · ${r.to_root}편은 원래 폴더가 없어 ‘폴더 없음’에 두었어요`;
    toast(msg, "success", { duration: r.to_root || (r.renamed && r.renamed.length) ? 8000 : undefined });
    refreshAll();
    refreshUsage();
    return r;
  } catch (e) { errorToast(e); return null; }
}

// 남은 날 칩: 2일 이상 "{n}일 남음", 1일 "내일 영구 삭제", 24시간 안 "오늘 영구 삭제" (8.1절)
export function leftChip(purgeAt, now = Date.now()) {
  const ms = new Date(purgeAt).getTime() - now;
  if (ms <= DAY) return { text: "오늘 영구 삭제", warn: true };
  if (ms <= 2 * DAY) return { text: "내일 영구 삭제", warn: true };
  return { text: `${Math.ceil(ms / DAY)}일 남음`, warn: false };
}

export function closeTrash() {
  T = null;
}

export async function renderTrash(main) {
  const view = el(`<section class="view" data-view="trash">
    <div class="toolbar"><h1 tabindex="-1">휴지통</h1><span class="trash-total" data-trash-total></span><span class="spacer"></span>
      <button type="button" class="btn sm danger" data-trash-empty hidden>휴지통 비우기</button></div>
    <div class="trash-body"><div class="status-line"><span class="spinner"></span> 휴지통을 불러오는 중…</div></div></section>`);
  main.innerHTML = "";
  main.appendChild(view);
  T = { view, items: [], selected: new Set(), total: 0 };
  const t = T;
  $("[data-trash-empty]", view).onclick = () => emptyTrash();
  try {
    const r = await api.get("/api/trash");
    if (T !== t) return;
    t.items = r.items;
    t.total = r.total_bytes;
  } catch (e) {
    if (T === t) $(".trash-body", view).innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
    return;
  }
  draw();
}

function draw(focusId = null) {
  const t = T;
  if (!t) return;
  const { view, items } = t;
  $("[data-trash-total]", view).textContent = items.length ? `${items.length}편${t.total ? ` · ${fmtBytes(t.total)}` : ""}` : "";
  $("[data-trash-empty]", view).hidden = !items.length;
  const body = $(".trash-body", view);
  body.innerHTML = "";
  if (!items.length) {
    body.appendChild(el(`<div class="empty"><div class="big">${TRASH_ICON}</div><h3 tabindex="-1" data-trash-empty-title>휴지통이 비어 있어요</h3>
      <p>서재에서 지운 논문은 여기에 30일 동안 남아 있다가 영구 삭제돼요.</p></div>`));
    return;
  }
  const sync = state.stats && state.stats.sync_on;
  body.appendChild(el(`<div class="notice" data-tone="info" data-trash-intro><div>지운 논문은 30일 동안 여기 있다가 영구 삭제돼요.
    되살리면 하이라이트 · 노트 · 요약도 그대로 ${sync ? "돌아오고, 폴더 동기화를 쓰는 PC에는 파일이 다시 생겨요" : "돌아와요"}.</div></div>`));
  if (t.selected.size) {
    const bar = el(`<div class="bulkbar"><b>${t.selected.size}편 선택</b>
      <button type="button" class="btn sm" data-trash-restore-sel>되살리기</button>
      <button type="button" class="btn sm danger" data-trash-purge-sel>영구 삭제</button>
      <span class="spacer"></span><button type="button" class="btn sm ghost" data-clear>선택 해제</button></div>`);
    $("[data-trash-restore-sel]", bar).onclick = () => restore([...t.selected]);
    $("[data-trash-purge-sel]", bar).onclick = () => purge([...t.selected]);
    $("[data-clear]", bar).onclick = () => { t.selected.clear(); draw(); };
    body.appendChild(bar);
  } else {
    const head = el(`<div class="list-head"><input type="checkbox" aria-label="모두 선택"><span>최근 지운 순</span></div>`);
    $("input", head).onchange = () => { items.forEach((p) => t.selected.add(p.id)); draw(); };
    body.appendChild(head);
  }
  const list = el(`<ul class="trash-list" aria-label="휴지통의 논문"></ul>`);
  for (const p of items) list.appendChild(row(p));
  body.appendChild(list);
  if (focusId) {
    const b = $(`.trash-row[data-trash-id="${focusId}"] [data-trash-restore]`, list);
    if (b) b.focus();
  }
}

function row(p) {
  const t = T;
  const chip = leftChip(p.purge_at);
  const where = (p.deleted_folder_path || "").split("/").filter(Boolean).join(" › ") || "폴더 없음";
  const who = p.deleted_by_label === "웹" ? "웹에서" : `‘${p.deleted_by_label}’에서`;
  const meta = [`원래 폴더: ${where}`, `${fmtDate(p.deleted_at)} ${who} 지움`, p.pdf_size ? fmtBytes(p.pdf_size) : ""].filter(Boolean);
  const sub = [authorsShort(p.authors || []), p.year].filter(Boolean).join(" · ");
  const name = p.title || "제목 없음"; // 단추 · 칸 이름용 (빈 제목이면 ‘’만 읽히지 않게)
  const li = el(`<li class="trash-row" data-trash-id="${Number(p.id)}">
    <input type="checkbox" aria-label="‘${esc(name)}’ 선택" ${t.selected.has(p.id) ? "checked" : ""}>
    <div class="trash-main"><div class="paper-title">${esc(p.title || "(제목 없음)")}</div>
      ${sub ? `<div class="paper-sub">${esc(sub)}</div>` : ""}
      <p class="trash-meta">${esc(meta.join(" · "))}</p>
      ${p.file_name ? `<p class="trash-file">${esc(p.file_name)}</p>` : ""}</div>
    <div class="trash-side"><span class="chip trash-left${chip.warn ? " warn" : ""}" title="${esc(fmtDate(p.purge_at))}에 영구 삭제돼요">${esc(chip.text)}</span>
      <span class="item-actions"><button type="button" class="btn sm" data-trash-restore aria-label="‘${esc(name)}’ 되살리기">되살리기</button>
        <button type="button" class="btn sm danger" data-trash-purge aria-label="‘${esc(name)}’ 영구 삭제">영구 삭제</button></span></div></li>`);
  $("input", li).onchange = (e) => {
    if (e.target.checked) t.selected.add(p.id); else t.selected.delete(p.id);
    draw();
    const again = $(`.trash-row[data-trash-id="${p.id}"] input`, t.view);
    if (again) again.focus();
  };
  $("[data-trash-restore]", li).onclick = () => restore([p.id]);
  $("[data-trash-purge]", li).onclick = () => purge([p.id]);
  return li;
}

// 끝난 줄을 지우고 다음 줄의 [되살리기]로 초점(없으면 이전 줄, 그것도 없으면 빈 상태 제목 — 8.2절)
function removeRows(ids) {
  const t = T;
  if (!t) return;
  const gone = new Set(ids);
  const idx = t.items.findIndex((p) => gone.has(p.id));
  const rest = t.items.filter((p) => !gone.has(p.id));
  const next = rest[idx] || rest[idx - 1] || null;
  t.total = rest.reduce((n, p) => n + (p.pdf_size || 0), 0);
  t.items = rest;
  ids.forEach((i) => t.selected.delete(i));
  draw(next ? next.id : null);
  if (!next) {
    const h = $("[data-trash-empty-title]", t.view);
    if (h) h.focus();
  }
}

function busy(ids, on) {
  for (const id of ids) {
    $$(`.trash-row[data-trash-id="${id}"] button`, T && T.view).forEach((b) => { b.disabled = on; });
  }
}

async function restore(ids) {
  busy(ids, true);
  const r = await restoreFromTrash(ids);
  if (r) removeRows(ids); else busy(ids, false);
}

async function purge(ids) {
  const t = T;
  const one = ids.length === 1 ? t.items.find((p) => p.id === ids[0]) : null;
  const ok = await confirmDialog(one ? `‘${one.title || "제목 없음"}’의 PDF · 하이라이트 · 노트 · 요약이 모두 지워지고 되살릴 수 없어요.`
    : "PDF · 하이라이트 · 노트 · 요약이 모두 지워지고 되살릴 수 없어요.",
  { title: one ? "영구 삭제할까요?" : `${ids.length}편을 영구 삭제할까요?`, ok: "영구 삭제", danger: true, focus: "cancel" });
  if (!ok) return;
  busy(ids, true);
  try {
    const r = await api.post("/api/trash/purge", { ids });
    toast(r.purged === 1 ? "영구 삭제했어요" : `${r.purged}편을 영구 삭제했어요`, "success");
    removeRows(ids);
    refreshAll();
    refreshUsage();
  } catch (e) { busy(ids, false); errorToast(e); }
}

async function emptyTrash() {
  const t = T;
  if (!t || !t.items.length) return;
  const ok = await confirmDialog(`휴지통의 논문 ${t.items.length}편${t.total ? `(${fmtBytes(t.total)})` : ""}을 모두 영구 삭제해요. 되살릴 수 없어요.`,
    { title: "휴지통을 비울까요?", ok: "비우기", danger: true, focus: "cancel" });
  if (!ok) return;
  try {
    await api.post("/api/trash/empty");
    toast("휴지통을 비웠어요", "success");
    removeRows(t.items.map((p) => p.id));
    refreshAll();
    refreshUsage();
  } catch (e) { errorToast(e); }
}
