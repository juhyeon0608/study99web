// 원고 공유 링크 · 받은 의견 (2026-10-27 사용자 요청 — 지도교수님 의견 받기). 서버 paperlab/shares.py, 공개 페이지 /s/토큰(share.js)
import { api } from "./api.js";
import { $, confirmDialog, copyText, el, errorToast, esc, fmtDate, modal, toast } from "./ui.js";

const DAYS = [["30", "30일"], ["7", "7일"], ["90", "90일"], ["", "끊을 때까지"]];
const linkOf = (token) => `${location.origin}/s/${token}`;

/** [공유]: 링크 만들기(이름 · 의견 허용 · 기간) · 목록(복사는 만들 때만 — 토큰은 서버에 해시만) · 끊기 */
export async function shareDialog(mid) {
  const body = el(`<div class="share-dlg">
    <p class="small muted" style="margin:0 0 8px">링크를 받은 분이 <b>처음 열 때 그때 원고가 검토본으로 복사</b>돼요. 받은 분은 로그인 없이
      검토본을 읽고, 글을 골라 의견을 남기거나 직접 고칠 수 있어요. 남긴 내용은 원고 화면 [의견]에서 빨간색으로 보여요.
      의견마다 수정 완료 · 거부를 고르고, 모두 처리하면 검토본은 지워져요. (읽기 전용 링크는 복사하지 않고 지금 원고를 보여 줘요.)
      링크 주소는 만들 때 한 번만 보여 드려요.</p>
    <form class="row share-new" style="gap:6px;flex-wrap:wrap;align-items:center">
      <input class="input" name="label" maxlength="60" placeholder="받는 분 (예: 김교수님)" style="flex:1;min-width:160px">
      <select class="input" name="days" style="width:auto" aria-label="기간">${DAYS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      <label class="small"><input type="checkbox" name="comments" checked> 의견 받기</label>
      <button class="btn primary">링크 만들기</button></form>
    <div class="share-made" data-made hidden></div>
    <h4 style="margin:14px 0 6px">만든 링크</h4><ul class="share-links" data-list><li class="small muted">불러오는 중…</li></ul></div>`);
  modal({ title: "원고 공유 (의견 받기)", body, wide: true });
  const list = $("[data-list]", body);
  const load = async () => {
    let r;
    try { r = await api.get(`/api/manuscripts/${mid}/shares`); } catch (e) { list.innerHTML = ""; return errorToast(e); }
    list.innerHTML = r.items.length ? "" : `<li class="small muted">아직 만든 링크가 없어요</li>`;
    for (const s of r.items) {
      const expired = s.expires_at && new Date(s.expires_at) < new Date();
      const state = s.revoked ? "끊음" : expired ? "기간 끝남" : s.expires_at ? `${fmtDate(s.expires_at)}까지` : "끊을 때까지";
      const li = el(`<li><div><b>${esc(s.label || "이름 없음")}</b> <span class="small muted">${esc(state)} · 의견 ${s.comments}개${s.open_comments ? ` (안 본 ${s.open_comments})` : ""}
        ${s.last_viewed_at ? ` · 마지막으로 연 때 ${esc(fmtDate(s.last_viewed_at))}` : " · 아직 안 열어 봄"}${s.allow_comments ? "" : " · 읽기 전용"}</span></div>
        ${!s.revoked && !expired ? `<button type="button" class="btn sm" data-revoke>링크 끊기</button>` : ""}</li>`);
      const b = $("[data-revoke]", li);
      if (b) b.onclick = async () => {
        if (!(await confirmDialog(`'${s.label || "이름 없음"}' 링크를 끊을까요? 그 주소로는 더 열 수 없어요. 받은 의견은 남아요.`, { ok: "링크 끊기" }))) return;
        try { await api.del(`/api/shares/${s.id}`); load(); } catch (e) { errorToast(e); }
      };
      list.append(li);
    }
  };
  $(".share-new", body).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const days = fd.get("days") ? Number(fd.get("days")) : null;
    let r;
    try {
      r = await api.post(`/api/manuscripts/${mid}/shares`, { label: fd.get("label") || "", days, allow_comments: fd.get("comments") === "on" });
    } catch (err) { return errorToast(err); }
    const url = linkOf(r.token);
    const made = $("[data-made]", body);
    made.hidden = false;
    made.innerHTML = `<div class="notice" data-tone="info"><div><b>링크를 만들었어요.</b> 지금 복사해 보내 주세요 — 이 창을 닫으면 다시 볼 수 없어요.
      <div class="row" style="gap:6px;margin-top:6px"><input class="input" readonly style="flex:1"><button type="button" class="btn sm primary" data-copy>복사</button></div></div></div>`;
    $("input", made).value = url;
    $("[data-copy]", made).onclick = () => copyText(url).then(() => toast("링크를 복사했어요"));
    copyText(url).then(() => toast("링크를 만들고 복사했어요")).catch(() => {});
    e.currentTarget.reset();
    load();
  };
  load();
}

/** 단추 숫자만 (원고를 열 때 · 30초마다) — 받은 의견 · 고친 글은 writereviewui.js(AI 패널 '검토') */
export async function openCommentCount(mid) {
  try { return (await api.get(`/api/manuscripts/${mid}/comments`)).open; } catch { return 0; }
}
