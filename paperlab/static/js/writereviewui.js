// 검토본 보기 (2026-10-28 사용자 요청): 공유 링크를 교수님이 처음 연 때 복사된 원고(검토본)와 그 위의 의견 · 고친 글을
// 원고 편집기 옆(AI 패널 '검토')에서 빨간색으로 보며 내 원고를 고친다. 의견마다 [수정 완료] · [거부], 모두 처리하면 서버가
// 검토본을 지운다(shares.py clear_if_done). 30초마다 새로 받음. 표시는 reviewmark.js (공개 페이지와 같은 모양)
import { api } from "./api.js";
import { STATUS_LABEL, findSpan, markReview, prepareShare } from "./reviewmark.js";
import { $, el, errorToast, esc, purifyMd, toast } from "./ui.js";

const POLL_MS = 30000;

/** h: { mid, ta, alive(), select(a, b), flash(a, b), replace(from, to, text), onCount(n) } */
export function reviewView(root, h) {
  const S = { items: [], sel: null, tab: "list", shown: false, timer: null, key: "" };
  root.innerHTML = `<div class="rv-head row" style="gap:6px;align-items:center">
      <select class="input rv-pick" data-rv-pick aria-label="볼 검토본"></select>
      <button type="button" class="btn sm" data-rv-reload>새로 보기</button></div>
    <p class="small muted rv-info" data-rv-info></p>
    <div class="seg rv-tabs" role="group" aria-label="검토 보기">
      <button type="button" data-rv-tab="list">의견 목록</button><button type="button" data-rv-tab="doc">검토본 전체</button></div>
    <ol class="rv-list" data-rv-list></ol>
    <article class="doc rv-doc hidden" data-rv-doc></article>`;
  const pick = $("[data-rv-pick]", root);
  const cur = () => S.items.find((x) => x.share_id === S.sel) || S.items[0] || null;

  const locate = (quote) => {
    const span = findSpan(h.ta.value, quote) || findSpan(h.ta.value, String(quote).slice(0, 40));
    if (!span) return null;
    h.select(span[0], span[1]);
    return span;
  };

  const setStatus = async (c, status) => {
    let r;
    try { r = await api.patch(`/api/comments/${c.id}`, { status }); } catch (e) { return errorToast(e); }
    c.status = status;
    if (r.cleared) toast("모든 의견을 처리해서 이 검토본을 지웠어요", "success");
    await load(true);
  };

  const item = (c) => {
    const st = STATUS_LABEL[c.status] || "";
    const li = el(`<li class="rv-item${c.status !== "open" ? " rv-closed" : ""}" data-cid="${c.id}">
      <div class="small"><b></b> <span class="muted"></span> ${st ? `<span class="chip ${c.status === "done" ? "success" : ""}">${esc(st)}</span>` : ""}</div>
      <div class="rv-what"></div><p class="rv-note"></p>
      <div class="row rv-acts" style="gap:6px;flex-wrap:wrap"></div></li>`);
    $("b", li).textContent = c.author;
    $(".muted", li).textContent = new Date(c.created_at).toLocaleString("ko-KR");
    const what = $(".rv-what", li);
    if (c.kind === "edit") {
      what.append(el(`<del class="rv-del"></del>`), " → ", el(`<ins class="rv-ins"></ins>`));
      $("del", what).textContent = c.quote;
      $("ins", what).textContent = c.replacement;
    } else if (c.quote) {
      what.append(el(`<mark class="rv-mark"></mark>`));
      $("mark", what).textContent = c.quote;
    }
    const note = $(".rv-note", li);
    note.textContent = c.body || "";
    note.hidden = !c.body;
    const acts = $(".rv-acts", li);
    const btn = (label, cls, fn) => { const b = el(`<button type="button" class="btn sm ${cls}">${label}</button>`); b.onclick = fn; acts.append(b); };
    if (c.quote) btn("원고에서 찾기", "ghost", () => { if (!locate(c.quote)) toast("내 원고에서 이 글을 찾지 못했어요 — 그 사이 고쳤을 수 있어요", "error"); });
    if (c.status === "open") {
      if (c.kind === "edit") btn("고친 글로 바꾸기", "", async () => {
        const span = locate(c.quote);
        if (!span) return toast("내 원고에서 이 글을 찾지 못했어요 — 직접 고친 뒤 [수정 완료]를 눌러 주세요", "error");
        h.replace(span[0], span[1], c.replacement);
        await setStatus(c, "done");
      });
      btn("수정 완료", "primary", () => setStatus(c, "done"));
      btn("거부", "", () => setStatus(c, "rejected"));
    } else {
      btn("다시 열기", "ghost", () => setStatus(c, "open"));
    }
    return li;
  };

  const draw = () => {
    const it = cur();
    pick.innerHTML = S.items.map((x) => {
      const open = x.comments.filter((c) => c.status === "open").length;
      return `<option value="${x.share_id}">${esc(x.label || "이름 없는 링크")} 검토본${open ? ` · 남은 의견 ${open}` : ""}</option>`;
    }).join("");
    pick.hidden = S.items.length < 2;
    if (it) pick.value = String(it.share_id);
    const info = $("[data-rv-info]", root);
    const list = $("[data-rv-list]", root);
    const doc = $("[data-rv-doc]", root);
    root.querySelectorAll("[data-rv-tab]").forEach((b) => b.classList.toggle("active", b.dataset.rvTab === S.tab));
    list.classList.toggle("hidden", S.tab !== "list");
    doc.classList.toggle("hidden", S.tab !== "doc");
    if (!it) {
      info.textContent = "";
      list.innerHTML = `<li class="small muted">아직 검토본이 없어요. 원고 위 [공유]로 링크를 만들어 보내면, 받은 분이 처음 열 때 그때 원고가 검토본으로 복사돼요.</li>`;
      doc.innerHTML = "";
      return;
    }
    const open = it.comments.filter((c) => c.status === "open").length;
    info.textContent = `${it.label ? `${it.label} · ` : ""}${it.snapshot_at ? `${new Date(it.snapshot_at).toLocaleString("ko-KR")}에 복사한 원고` : "검토본을 지웠어요"}`
      + ` · 의견 ${it.comments.length}개${open ? `, 남은 의견 ${open}개` : " — 모두 처리했어요"}`;
    list.innerHTML = "";
    if (!it.comments.length) list.append(el(`<li class="small muted">아직 받은 의견이 없어요. 의견이 오면 여기에 빨간색으로 보여요.</li>`));
    for (const c of it.comments) list.append(item(c));
    const md = prepareShare(it.content, it.cites, "");
    doc.innerHTML = it.has_copy ? (purifyMd(window.marked.parse(md)) ?? esc(md)) : `<p class="muted">검토본을 지웠어요.</p>`;
    if (it.has_copy) markReview(doc, it.comments);
  };

  const load = async (force = false) => {
    let r;
    try { r = await api.get(`/api/manuscripts/${h.mid}/reviews`); } catch (e) { if (force) errorToast(e); return; }
    if (!h.alive()) return;
    h.onCount(r.open);
    const key = JSON.stringify(r.items.map((x) => [x.share_id, x.snapshot_at, x.comments.map((c) => [c.id, c.status])]));
    if (!force && key === S.key) return;
    S.key = key;
    S.items = r.items;
    if (S.sel && !S.items.some((x) => x.share_id === S.sel)) S.sel = null;
    draw();
  };
  const tick = async () => {
    clearTimeout(S.timer);
    if (!S.shown || !h.alive()) return;
    await load();
    S.timer = setTimeout(tick, POLL_MS);
  };

  pick.onchange = () => { S.sel = Number(pick.value); draw(); };
  $("[data-rv-reload]", root).onclick = () => load(true);
  root.querySelector(".rv-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rv-tab]");
    if (b) { S.tab = b.dataset.rvTab; draw(); }
  });
  // 검토본 전체에서 빨간 글을 누르면 그 의견으로
  $("[data-rv-doc]", root).addEventListener("click", (e) => {
    const m = e.target.closest("[data-cid]");
    if (!m) return;
    S.tab = "list";
    draw();
    const li = root.querySelector(`.rv-item[data-cid="${m.dataset.cid}"]`);
    if (li) { li.scrollIntoView({ block: "center" }); li.classList.add("rv-flash"); setTimeout(() => li.classList.remove("rv-flash"), 1500); }
  });

  return {
    show: () => { S.shown = true; S.key = ""; tick(); },
    hide: () => { S.shown = false; clearTimeout(S.timer); },
    destroy: () => { S.shown = false; clearTimeout(S.timer); },
  };
}
