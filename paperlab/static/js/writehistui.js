// 원고 버전 기록 창 (docs/specs/manuscript-history.md): 목록 · 지금 원고와 비교 · 되돌리기 · 복사 · 이름 붙이기 · 지우기 ·
// [지금 버전 저장]. 비교 · 문구는 writehist.js(순수 함수), 서버는 /api/manuscripts/{id}/versions
// writing.js는 도구 줄 단추 하나([data-history])와 historyTools 한 줄, AI 넣기 전 saveVersion만 부른다

import { api } from "./api.js";
import { $, $$, confirmDialog, copyText, el, errorToast, esc, modal, modalOpen, toast } from "./ui.js";
import { applyEdit } from "./writetools.js";
import {
  diffRows, diffStats, lineDiff, reasonName, timeText, versionSub, versionTitle,
} from "./writehist.js";

const MAX_ROWS = 4000; // 비교 화면에 그리는 줄 상한 (아주 긴 원고가 통째로 바뀐 경우)

// AI 결과를 넣기 직전 글을 남긴다(실패해도 넣기는 그대로 — 조용히)
export function saveVersion(mid, content, reason = "ai_apply") {
  return api.post(`/api/manuscripts/${mid}/versions`, { reason, content }).catch(() => null);
}

// 원고 화면에 [기록] 단추 · Alt+H 연결. ta: 편집기, flush: 쓰던 글 지금 저장(Promise)
export function historyTools(view, { mid, ta, flush, redline = null }) {
  const open = () => historyDialog({ mid, ta, flush, redline });
  const btn = $("[data-history]", view);
  if (btn) btn.onclick = open;
  view.addEventListener("keydown", (e) => {
    if (e.code !== "KeyH" || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || modalOpen()) return;
    e.preventDefault(); // macOS Option+H의 ˙ 막기
    open();
  });
}

function diffHtml(rows) {
  const shown = rows.slice(0, MAX_ROWS);
  const line = (cls, inner) => `<div class="hist-line ${cls}">${inner || "&#8203;"}</div>`;
  const html = shown.map((r) => {
    if (r.op === "skip") return `<div class="hist-skip">… 같은 줄 ${Number(r.n).toLocaleString("ko-KR")}줄 …</div>`;
    if (r.op === "same") return line("", esc(r.text));
    if (r.op === "del") return line("del", `<del>${esc(r.text)}</del>`);
    if (r.op === "ins") return line("ins", `<ins>${esc(r.text)}</ins>`);
    return line("mod", r.parts.map((x) => (x.op === "same" ? esc(x.text) : `<${x.op === "del" ? "del" : "ins"}>${esc(x.text)}</${x.op === "del" ? "del" : "ins"}>`)).join(""));
  }).join("");
  const more = rows.length > shown.length ? `<div class="hist-skip">너무 길어 앞부분 ${MAX_ROWS.toLocaleString("ko-KR")}줄만 보여요</div>` : "";
  return html + more;
}

// 이름 입력 (빈 칸 = 이름 빼기). 취소면 null
function labelDialog(value) {
  return new Promise((resolve) => {
    const body = el(`<form><input class="input" style="width:100%" maxlength="60" placeholder="예: 지도교수 검토 전" value="${esc(value || "")}">
      <p class="small muted" style="margin:6px 0 0">이름을 붙인 버전은 자동으로 정리되지 않아요. 비우면 이름을 빼요.</p></form>`);
    const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button><button class="btn primary" data-yes>저장</button></div>`);
    let result = null;
    const m = modal({ title: "버전 이름", body, foot, onClose: () => resolve(result) });
    const submit = () => { result = $("input", body).value.trim(); m.close(); };
    body.onsubmit = (e) => { e.preventDefault(); submit(); };
    $("[data-yes]", foot).onclick = submit;
    $("[data-no]", foot).onclick = () => m.close();
  });
}

export async function historyDialog({ mid, ta, flush, redline = null }) {
  const base = `/api/manuscripts/${mid}/versions`;
  const body = el(`<div class="hist">
    <div class="hist-side">
      <form class="hist-save" data-save-form><input class="input" maxlength="60" placeholder="이름 (선택)" aria-label="새 버전 이름 (선택)">
        <button class="btn sm primary" type="submit" data-save>지금 버전 저장</button></form>
      <div class="hist-list" role="listbox" aria-label="버전 목록" data-list><div class="muted small" style="padding:8px">불러오는 중…</div></div>
      <p class="small muted hist-hint" data-hint></p>
    </div>
    <div class="hist-view">
      <div class="hist-head"><div class="grow" style="min-width:0"><b data-title></b><div class="small muted" data-sub></div></div>
        <div class="seg" data-mode><button type="button" data-m="diff" class="active">바뀐 부분</button><button type="button" data-m="full">이 버전 전체</button></div></div>
      <div class="hist-body" data-body aria-live="polite"><div class="muted small">왼쪽에서 버전을 고르세요.</div></div>
      <p class="small muted ai-diff-legend hist-legend" data-legend><del>이 버전에만 있는 글</del> · <ins>지금 원고에만 있는 글</ins></p>
    </div></div>`);
  const foot = el(`<div style="display:contents"><div class="left"><button class="btn" data-label disabled>이름</button>
    <button class="btn" data-del disabled>삭제</button></div>
    ${redline ? `<button class="btn" data-redline disabled title="이 버전 → 지금 원고에서 바뀐 곳을 워드의 변경 내용 추적(넣은 글 · 지운 글)으로 표시해 내보내요">수정 표시 워드</button>` : ""}
    <button class="btn" data-copy disabled>복사</button><button class="btn primary" data-restore disabled>이 버전으로 되돌리기</button></div>`);
  const dlg = modal({ title: "버전 기록", body, foot, wide: true });
  dlg.el.querySelector(".modal").classList.add("hist-modal");
  const S = { items: [], cur: null, mode: "diff", cache: new Map(), seq: 0 };
  const listEl = $("[data-list]", body);

  const setButtons = () => {
    for (const k of ["[data-label]", "[data-del]", "[data-copy]", "[data-restore]", "[data-redline]"]) if ($(k, foot)) $(k, foot).disabled = !S.cur;
  };

  const content = async (v) => {
    if (!S.cache.has(v.id)) S.cache.set(v.id, (await api.get(`${base}/${v.id}`)).content);
    return S.cache.get(v.id);
  };

  const drawView = async () => {
    const v = S.cur;
    const seq = ++S.seq;
    setButtons();
    $$("[data-mode] button", body).forEach((b) => b.classList.toggle("active", b.dataset.m === S.mode));
    if (!v) {
      $("[data-title]", body).textContent = "";
      $("[data-sub]", body).textContent = "";
      $("[data-body]", body).innerHTML = `<div class="muted small">${S.items.length ? "왼쪽에서 버전을 고르세요." : "아직 남은 버전이 없어요."}</div>`;
      return;
    }
    $("[data-title]", body).textContent = `${timeText(v.created_at)} · ${versionTitle(v)}`;
    $("[data-sub]", body).textContent = `${v.label ? `${reasonName(v.reason)} · ` : ""}${versionSub(v)}`;
    const box = $("[data-body]", body);
    box.innerHTML = `<div class="muted small"><span class="spinner"></span></div>`;
    let text;
    try { text = await content(v); } catch (e) {
      if (seq === S.seq) box.innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
      return;
    }
    if (seq !== S.seq) return;
    $("[data-legend]", body).classList.toggle("hidden", S.mode !== "diff");
    if (S.mode === "full") {
      box.innerHTML = `<div class="hist-full">${esc(text)}</div>`;
      return;
    }
    const ops = lineDiff(text, ta.value);
    const rows = diffRows(ops);
    const st = diffStats(ops);
    $("[data-sub]", body).textContent += rows.length ? ` · 지금 원고와 비교: −${st.removed}줄 +${st.added}줄` : " · 지금 원고와 같아요";
    box.innerHTML = rows.length ? diffHtml(rows) : `<div class="muted small">지금 원고와 같아요.</div>`;
  };

  const select = (v, focus = false) => {
    S.cur = v;
    $$(".hist-item", listEl).forEach((b) => {
      const on = v && Number(b.dataset.vid) === v.id;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    drawView();
  };

  const drawList = () => {
    listEl.innerHTML = "";
    if (!S.items.length) {
      listEl.innerHTML = `<div class="muted small" style="padding:8px">아직 남은 버전이 없어요. 편집하면 자동으로 남아요.</div>`;
    }
    for (const v of S.items) {
      const b = el(`<button type="button" class="hist-item" role="option" aria-selected="false" tabindex="-1" data-vid="${Number(v.id)}">
        <span class="hist-time">${esc(timeText(v.created_at))}</span>
        <span class="hist-tag" data-reason="${esc(v.reason)}">${esc(reasonName(v.reason))}</span>
        ${v.label ? `<span class="hist-label">${esc(v.label)}</span>` : ""}
        <span class="hist-size">${esc(versionSub(v))}</span></button>`);
      b.onclick = () => select(v);
      listEl.appendChild(b);
    }
    const first = $(".hist-item", listEl);
    if (first && !S.cur) first.tabIndex = 0;
  };

  const load = async (keepId = null) => {
    let data;
    try { data = await api.get(base); } catch (e) {
      listEl.innerHTML = `<div class="msg error">${esc(e.message)}</div>`;
      return;
    }
    S.items = data.items || [];
    $("[data-hint]", body).textContent = `편집하는 동안 ${Number(data.every_minutes) || 10}분마다, AI 결과를 넣기 전과 되돌리기 전에 자동으로 남아요. `
      + "자동 버전은 최근 것부터 정리되고, 직접 저장하거나 이름 붙인 버전은 남아요.";
    drawList();
    select(S.items.find((v) => v.id === keepId) || S.items[0] || null);
  };

  listEl.addEventListener("keydown", (e) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || !S.items.length) return;
    e.preventDefault();
    const i = Math.max(0, S.items.findIndex((v) => S.cur && v.id === S.cur.id));
    const j = e.key === "Home" ? 0 : e.key === "End" ? S.items.length - 1
      : Math.min(S.items.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)));
    select(S.items[j], true);
  });
  $$("[data-mode] button", body).forEach((b) => (b.onclick = () => { S.mode = b.dataset.m; drawView(); }));

  $("[data-save-form]", body).onsubmit = async (e) => {
    e.preventDefault();
    const input = $("[data-save-form] input", body);
    const btn = $("[data-save]", body);
    btn.disabled = true;
    try {
      if (flush) await flush();
      const v = await api.post(base, { label: input.value.trim(), content: ta.value });
      input.value = "";
      toast(v.created ? "지금 버전을 저장했어요" : "마지막 버전과 같아서 새로 저장하지 않았어요", v.created ? "success" : "");
      await load(v.id);
    } catch (err) { errorToast(err); } finally { btn.disabled = false; }
  };

  if (redline) {
    $("[data-redline]", foot).onclick = async () => {
      const v = S.cur;
      if (!v) return;
      let text;
      try { text = await content(v); } catch (e) { return errorToast(e); }
      redline(text, `${timeText(v.created_at)} · ${versionTitle(v)}`);
    };
  }
  $("[data-copy]", foot).onclick = async () => {
    if (!S.cur) return;
    try { copyText(await content(S.cur)); } catch (e) { errorToast(e); }
  };

  $("[data-label]", foot).onclick = async () => {
    const v = S.cur;
    if (!v) return;
    const label = await labelDialog(v.label);
    if (label === null || label === v.label) return;
    try {
      await api.patch(`${base}/${v.id}`, { label });
      await load(v.id);
    } catch (e) { errorToast(e); }
  };

  $("[data-del]", foot).onclick = async () => {
    const v = S.cur;
    if (!v) return;
    if (!(await confirmDialog(`${timeText(v.created_at)} ‘${versionTitle(v)}’ 버전을 지울까요? 되돌릴 수 없어요.`,
      { ok: "삭제", danger: true, focus: "cancel" }))) return;
    try {
      await api.del(`${base}/${v.id}`);
    } catch (e) { if (e.status !== 404) return errorToast(e); }
    S.cache.delete(v.id);
    S.cur = null;
    await load();
  };

  $("[data-restore]", foot).onclick = async () => {
    const v = S.cur;
    if (!v) return;
    if (!(await confirmDialog(`원고를 ${timeText(v.created_at)} ‘${versionTitle(v)}’ 버전으로 되돌릴까요? `
      + "지금 원고는 ‘되돌리기 전’ 버전으로 남아서 언제든 다시 돌아올 수 있어요.", { ok: "되돌리기", title: "이 버전으로 되돌리기" }))) return;
    const btn = $("[data-restore]", foot);
    btn.disabled = true;
    try {
      if (flush) await flush(); // 저장 안 된 글을 먼저 저장 (실패해도 아래 current로 서버가 ‘되돌리기 전’ 버전에 남김)
      const r = await api.post(`${base}/${v.id}/restore`, { current: ta.value });
      if (!ta.isConnected) return;
      dlg.close(); // 창을 먼저 닫아야(inert 풀림) 편집기에 초점이 가고 Ctrl+Z로 되돌리기를 취소할 수 있음
      if (ta.value !== r.content) {
        // 실행 취소에 남도록 applyEdit(insertText) — 저장 · 미리보기 · 개요는 input 이벤트로 편집과 같은 길
        const at = Math.min(ta.selectionStart || 0, r.content.length);
        applyEdit(ta, { from: 0, to: ta.value.length, text: r.content, selStart: at, selEnd: at });
      }
      toast(r.changed ? "이 버전으로 되돌렸어요. 되돌리기 전 원고는 기록에 남았어요" : "지금 원고와 같은 버전이에요", r.changed ? "success" : "");
    } catch (e) { errorToast(e); btn.disabled = !S.cur; }
  };

  await load();
}
