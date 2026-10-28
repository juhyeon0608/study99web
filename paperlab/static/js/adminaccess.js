// 가입 신청 관리 (2026-10-29 — 관리자 승인 가입, 서버 paperlab/access.py): 관리자의 계정 메뉴 [가입 신청]에서
// 승인 대기 · 승인 · 거절 목록을 보고 바꾼다. 승인하면 그 사람은 바로(최대 5초 뒤) 앱을 쓸 수 있다
import { api } from "./api.js";
import { $, confirmDialog, el, errorToast, esc, fmtDate, modal, toast } from "./ui.js";

const LABEL = { pending: "승인 대기", approved: "승인됨", rejected: "거절됨" };

export async function pendingCount() {
  try { return (await api.get("/api/admin/access")).pending; } catch { return 0; }
}

export function accessDialog({ onCount } = {}) {
  const body = el(`<div class="acc-box"><p class="small muted" data-note></p><ul class="acc-list" data-list><li class="small muted">불러오는 중…</li></ul></div>`);
  modal({ title: "가입 신청 관리", body, wide: true });
  const load = async () => {
    let r;
    try { r = await api.get("/api/admin/access"); } catch (e) { return errorToast(e); }
    if (onCount) onCount(r.pending);
    $("[data-note]", body).textContent = r.enabled
      ? "Google로 로그인한 사람은 여기서 승인해야 PaperLab을 쓸 수 있어요. 승인 · 거절은 언제든 바꿀 수 있어요."
      : "지금은 관리자 승인 방식이 꺼져 있어요(서버 설정 PAPERLAB_ALLOWLIST=approval 이 아님). 목록만 볼 수 있어요.";
    const list = $("[data-list]", body);
    list.innerHTML = r.items.length ? "" : `<li class="small muted">아직 가입 신청이 없어요</li>`;
    for (const a of r.items) {
      const li = el(`<li class="acc-item" data-st="${esc(a.status)}"><div class="grow" style="min-width:0">
          <div><b></b> <span class="chip acc-st"></span></div><div class="small muted acc-sub"></div></div>
        <div class="row acc-acts" style="gap:6px"></div></li>`);
      $("b", li).textContent = a.name || a.email || "(이름 없음)";
      $(".acc-st", li).textContent = LABEL[a.status];
      $(".acc-sub", li).textContent = `${a.email} · 신청 ${fmtDate(a.requested_at)}${a.decided_at ? ` · ${LABEL[a.status]} ${fmtDate(a.decided_at)}` : ""}`;
      const acts = $(".acc-acts", li);
      const btn = (label, cls, status, ask) => {
        const b = el(`<button type="button" class="btn sm ${cls}">${label}</button>`);
        b.onclick = async () => {
          if (ask && !(await confirmDialog(ask, { ok: label, danger: status === "rejected" }))) return;
          b.disabled = true;
          try {
            await api.post(`/api/admin/access/${encodeURIComponent(a.user_id)}`, { status });
            toast(status === "approved" ? `${a.email} 님을 승인했어요` : status === "rejected" ? `${a.email} 님을 거절했어요` : "승인 대기로 되돌렸어요", "success");
            load();
          } catch (e) { b.disabled = false; errorToast(e); }
        };
        acts.append(b);
      };
      if (a.status !== "approved") btn("승인", "primary", "approved");
      if (a.status !== "rejected") btn(a.status === "approved" ? "접근 막기" : "거절", "", "rejected",
        a.status === "approved" ? `${a.email} 님이 더 이상 PaperLab을 쓰지 못하게 할까요? 서재 자료는 지우지 않아요.` : "");
      list.append(li);
    }
  };
  load();
}
