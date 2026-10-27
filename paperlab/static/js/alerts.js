// 새 논문 알림 (2026-10-27 사용자 요청 — Google Scholar 알림 · ResearchRabbit처럼)
// 관심 주제 · 저자(설정 paper_alerts)를 하루 한 번 OpenAlex에서 확인 → 새 논문이 있으면 알림 · '논문 찾기'의 [🔔 새 논문]에서 보기
import { api } from "./api.js";
import { state } from "./state.js";
import { $, el, errorToast, modal, toast } from "./ui.js";

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD (이 PC 날짜)
let lastResult = null;

const alertsOf = () => (state.settings && state.settings.paper_alerts) || { queries: [], checked: "" };

async function saveAlerts(queries) {
  const s = await api.put("/api/settings", { paper_alerts: { queries, checked: alertsOf().checked } });
  state.settings = s;
  return s.paper_alerts;
}

/** 앱을 열 때: 검색어가 있고 오늘 아직 확인하지 않았으면 확인(오늘로 표시) → 새 논문이 있으면 알림 */
export async function dailyAlertCheck() {
  const a = alertsOf();
  if (!a.queries || !a.queries.length || a.checked === today()) return;
  let r;
  try { r = await api.post("/api/alerts/check", { mark: true }); } catch { return; }
  if (state.settings && state.settings.paper_alerts) state.settings.paper_alerts.checked = today();
  lastResult = r;
  if (r.total) toast(`관심 주제에 새 논문이 ${r.total}편 있어요`, "", { duration: 12000, action: { label: "보기", onClick: () => alertsDialog(r) } });
}

/** 관심 주제 · 저자 관리 + 새 논문 보기. result: 앱을 열 때 받은 결과(있으면 다시 묻지 않음) */
export function alertsDialog(result = lastResult) {
  let queries = [...(alertsOf().queries || [])];
  const body = el(`<div class="alerts-box">
    <p class="small muted" style="margin:0 0 8px">관심 주제나 저자를 넣어 두면 앱을 열 때 하루 한 번 OpenAlex에서 새 논문을 확인해 알려 줘요.
      서재에 이미 있는 논문은 빼요. 한국어 검색어도 돼요(국내 학술지 중 OpenAlex에 있는 논문).</p>
    <form class="row alerts-add" style="gap:6px"><select class="input" name="kind" style="width:auto" aria-label="종류">
      <option value="topic">주제</option><option value="author">저자</option></select>
      <input class="input" name="q" placeholder="예: 청소년 우울 사회적 지지 · 저자 이름" style="flex:1" maxlength="200">
      <button class="btn">추가</button></form>
    <ul class="alerts-list" data-list></ul>
    <div class="row" style="gap:8px;align-items:center;margin:8px 0"><button type="button" class="btn sm primary" data-check>지금 새 논문 확인</button>
      <select class="input" data-since style="width:auto" aria-label="기간"><option value="">마지막 확인 이후</option>
        <option value="7">최근 7일</option><option value="30">최근 30일</option><option value="90">최근 90일</option></select>
      <span class="small muted" data-st aria-live="polite"></span></div>
    <div data-out></div></div>`);
  modal({ title: "🔔 새 논문 알림", body, wide: true });
  const list = $("[data-list]", body);
  const draw = () => {
    list.innerHTML = queries.length ? "" : `<li class="small muted">아직 관심 주제가 없어요</li>`;
    queries.forEach((q, i) => {
      const li = el(`<li><span class="chip">${q.kind === "author" ? "저자" : "주제"}</span> <span></span>
        <button type="button" class="icon-btn" aria-label="지우기" title="지우기">✕</button></li>`);
      $("span:not(.chip)", li).textContent = q.q;
      $("button", li).onclick = async () => {
        try { queries = (await saveAlerts(queries.filter((_, k) => k !== i))).queries; draw(); } catch (e) { errorToast(e); }
      };
      list.append(li);
    });
  };
  draw();
  $(".alerts-add", body).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const q = String(fd.get("q") || "").trim();
    if (q.length < 2) return toast("두 글자 이상 넣어 주세요", "error");
    try {
      queries = (await saveAlerts([...queries, { q, kind: fd.get("kind") }])).queries;
      e.currentTarget.reset();
      draw();
    } catch (err) { errorToast(err); }
  };
  const out = $("[data-out]", body);
  const st = $("[data-st]", body);
  const show = async (r) => {
    out.innerHTML = "";
    st.textContent = r.total ? `${r.since} 이후 새 논문 ${r.total}편` : `${r.since} 이후 새 논문이 없어요`;
    if (r.errors) st.textContent += ` (검색어 ${r.errors}개는 확인하지 못했어요)`;
    const { resultCard } = await import("./discover.js");
    for (const g of r.groups) {
      if (!g.items.length) continue;
      const sec = el(`<section class="alerts-group"><h4></h4><ol class="ask-sources"></ol></section>`);
      $("h4", sec).textContent = `${g.kind === "author" ? "저자" : "주제"}: ${g.q} — ${g.items.length}편`;
      for (const it of g.items) {
        const li = el(`<li></li>`);
        li.append(resultCard(it, { lite: true }));
        $("ol", sec).append(li);
      }
      out.append(sec);
    }
  };
  $("[data-check]", body).onclick = async () => {
    if (!queries.length) return toast("관심 주제나 저자를 먼저 넣어 주세요", "error");
    const days = Number($("[data-since]", body).value);
    const since = days ? new Date(Date.now() - days * 86400000).toLocaleDateString("sv-SE") : undefined;
    st.innerHTML = `<span class="spinner" aria-hidden="true"></span> 확인하는 중…`;
    try {
      const r = await api.post("/api/alerts/check", { since, mark: true });
      if (state.settings && state.settings.paper_alerts) state.settings.paper_alerts.checked = today();
      lastResult = r;
      show(r);
    } catch (e) { st.textContent = ""; errorToast(e); }
  };
  if (result && result.groups) show(result);
}

export const alertsButton = () => `<button type="button" class="btn" style="height:40px" data-alerts title="관심 주제 · 저자의 새 논문 알림">🔔 새 논문</button>`;
