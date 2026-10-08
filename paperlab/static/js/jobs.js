// 작업 큐 화면 (2단계 — docs/design/phase2-worker-electron-ui.md 5 · 6 · 9장): 상태 문구 · 진행 따라가기(폴링) · 작업 목록 · 사이드바 배지
// 서버 작업 보기(명세 7장)를 화면 문구로 바꾸는 곳은 여기 한 곳 — 요약 카드 · 대화 · 글쓰기 · 작업 목록이 함께 쓴다.

import { api, qs } from "./api.js";
import { state } from "./state.js";
import { $, $$, copyText, el, errorToast, esc, toast } from "./ui.js";

export const COMPANY = { claude: "Anthropic", codex: "OpenAI", gemini: "Google" };
const KIND_LABEL = { summary: "요약", chat: "대화", write: "글쓰기" };
const ACTIVE = new Set(["queued", "running"]);
export const ICON_CLOCK = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2"/></svg>`;
export const ICON_WARN = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.5v.01"/></svg>`;
export const ICON_INFO = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5v.01"/></svg>`;
export const ICON_JOBS = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11"/><circle cx="5.5" cy="18" r="1.5"/></svg>`;

// 5.4절 오류 이름 (history.error_code → 짧은 글)
const ERROR_LABELS = {
  api_auth: "키가 올바르지 않음", api_permission: "이 키로 쓸 수 없는 모델", api_rate_limit: "API 사용 한도에 걸림",
  api_overloaded: "API 서버 오류", api_server: "API 서버 오류", api_connection: "API에 연결하지 못함", api_timeout: "API에 연결하지 못함",
  api_bad_request: "API가 요청을 받지 않음", api_refusal: "AI가 답하기를 거절함", api_max_tokens: "결과가 너무 길어 끊김",
  api_no_key: "API 키 없음", no_worker_timeout: "기한 안에 켜진 PC 없음", apply_failed: "결과를 저장하지 못함",
  cli_not_found: "{p} 설치 안 됨", cli_not_logged_in: "{p} 로그인 안 됨", cli_usage_limit: "CLI 사용 한도에 걸림",
  cli_model: "고른 CLI 모델을 쓸 수 없음", cli_timeout: "시간 제한을 넘김", cli_bad_output: "결과를 읽지 못함", bad_output: "결과를 읽지 못함",
  cli_exit: "CLI가 오류로 끝남", lease_exhausted: "PC 연결이 계속 끊김", lease_expired: "PC 연결이 끊김", input_too_large: "논문 본문이 너무 김",
  output_too_large: "결과가 너무 김", bad_input: "읽을 수 있는 본문이 없음",
};
export const errorLabel = (code, engine = "") => (ERROR_LABELS[code] || "실패").replace("{p}", engine);
export const slotName = (s) => (s.runner === "api" ? `${COMPANY[s.engine]} API` : `PC의 ${s.engine}`);

// ------------------------------------------------------------------ 시간 (1장 — 사용자 PC 시간대)
const pad = (n) => String(n).padStart(2, "0");
function hm(d) {
  const h = d.getHours();
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${pad(d.getMinutes())}`;
}
export function fmtClock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return hm(d);
  if (diff === 1) return `내일 ${hm(d)}`;
  if (diff === -1) return `어제 ${hm(d)}`;
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm(d)}`;
}
export function fmtElapsed(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}분${sec % 60 ? ` ${sec % 60}초` : ""}`;
  return `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`;
}
export function fmtAgo(iso) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
export function deadlineText(job) {
  if (!job.deadline_at) return "";
  const left = (new Date(job.deadline_at).getTime() - Date.now()) / 1000;
  const tail = left > 0 && left < 3600 ? ` (${Math.max(1, Math.round(left / 60))}분 남음)` : "";
  return `${fmtClock(job.deadline_at)}까지 기다려요${tail}`;
}
const elapsedText = (job) => (job.started_at ? fmtElapsed((Date.now() - new Date(job.started_at).getTime()) / 1000) : "");

// ------------------------------------------------------------------ 상태 (5.1절)
export function jobState(job) {
  if (job.status === "running" && job.cancel_requested) return "cancelling";
  if (ACTIVE.has(job.status)) return `${job.runner}-${job.status === "queued" ? (job.runner === "api" ? "queued" : "waiting") : "running"}`;
  return job.status;
}
const WAITING = {
  no_online_worker: "PC에서 실행 대기 중 — 켜진 PC가 없어요",
  no_engine_on_worker: "PC에서 실행 대기 중 — {p}가 있는 PC가 없어요",
  all_workers_busy: "PC에서 실행 대기 중 — PC가 다른 작업 중이에요",
};
const reassigned = (job) => job.attempts >= 2 && (job.history || []).slice(-1)[0]?.error_code === "lease_expired";

// 한 줄 상태 (대화 · 글쓰기 · 작업 목록 · 요약 카드 메시지 공용)
export function jobLine(job, verb = "실행", { elapsed = true } = {}) {
  const st = jobState(job);
  const p = job.progress || {};
  const pct = typeof p.fraction === "number" ? ` · ${Math.round(p.fraction * 100)}%` : "";
  const dev = job.device ? `‘${job.device.name}’` : "PC";
  switch (st) {
    case "api-queued": return `${COMPANY[job.engine]} API 차례를 기다리는 중`;
    case "api-running": return `${COMPANY[job.engine]} API로 ${verb}하는 중${p.message ? ` · ${p.message}` : ""}${pct}`;
    case "cli-waiting": return job.waiting_reason ? WAITING[job.waiting_reason].replace("{p}", job.engine) : "PC가 곧 작업을 가져가요";
    case "cli-running": return `${reassigned(job) ? "PC 연결이 끊겨 다른 PC로 넘겼어요 · " : ""}${dev}에서 실행 중 (${job.engine})${elapsed && job.started_at ? ` · ${elapsedText(job)}` : ""}`;
    case "cancelling": return "취소하는 중…";
    case "succeeded": return job.runner === "api" ? `완료 · ${COMPANY[job.engine]} API` : `완료 · ${dev}(${job.engine})에서 실행`;
    case "failed": return `실패: ${job.error || errorLabel(job.error_code, job.engine)}`;
    default: return "취소됨";
  }
}

// 경로 단계 (5.3절) — 경로가 1칸이고 기록이 없으면 그리지 않음
export function stepsHtml(job) {
  const route = job.route || [];
  const hist = job.history || [];
  if (route.length < 2 && !hist.length) return "";
  const items = route.map((slot, i) => {
    const fails = hist.filter((h) => h.runner === slot.runner && h.engine === slot.engine);
    let state = "";
    let msg = "";
    if (i < job.route_index) { state = "failed"; msg = fails.length ? errorLabel(fails[fails.length - 1].error_code, slot.engine) : ""; }
    else if (i === job.route_index) {
      state = job.status === "succeeded" ? "done" : job.status === "failed" ? "failed" : ACTIVE.has(job.status) ? "now" : "";
      msg = job.status === "failed" ? errorLabel(job.error_code, slot.engine) : ACTIVE.has(job.status) ? jobLine(job) : "";
      if (fails.length && ACTIVE.has(job.status)) msg = `${errorLabel(fails[fails.length - 1].error_code, slot.engine)} → ${msg}`;
    }
    return `<li${state ? ` data-state="${state}"` : ""}>${esc(slotName(slot))} <span class="graph-step-msg">${esc(msg)}</span></li>`;
  });
  return `<ol class="graph-steps" aria-label="실행 순서">${items.join("")}</ol>`;
}

// ------------------------------------------------------------------ 진행 따라가기 (명세 7.1 — K3 폴링)
// 탭이 보이면 1.5초, 숨으면 10초. 끝 상태가 되면 멈춘다. stop()을 돌려준다
export function watchJob(id, onUpdate, { first = null } = {}) {
  nudgeDesktop(first);
  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    try {
      const job = await api.get(`/api/jobs/${id}`);
      if (stopped) return;
      onUpdate(job);
      if (!ACTIVE.has(job.status)) { stopped = true; return; }
    } catch (e) {
      if (stopped) return;
      if (e.status === 404) { stopped = true; onUpdate(null); return; }
    }
    timer = setTimeout(tick, document.hidden ? 10000 : 1500);
  };
  if (first) { onUpdate(first); if (!ACTIVE.has(first.status)) return () => {}; timer = setTimeout(tick, 1500); }
  else tick();
  return () => { stopped = true; clearTimeout(timer); };
}

export const cancelJob = (id) => api.post(`/api/jobs/${id}/cancel`);
export const retryJob = (id) => api.post(`/api/jobs/${id}/retry`).then((r) => { nudgeDesktop(r && r.job); return r; });

// PC 앱 창에서 PC 실행 작업을 만들었으면 같은 PC의 작업 받기를 바로 깨운다 (명세 10.2 로컬 신호 — 브라우저에서는 없음)
export function nudgeDesktop(job) {
  const dk = window.paperlabDesktop;
  if (!dk || !job || job.runner !== "cli" || job.status !== "queued") return;
  try { dk.nudge(); } catch { /* 앱 쪽 오류는 무시 — 폴링이 곧 잡음 */ }
}
const openSettings = () => import("./dialogs.js").then((m) => m.settingsDialog({ focus: "pc" }));

// 대화 · 글쓰기의 한 줄 상태 (`.status-line[data-job-line]`) — 같은 글이면 다시 넣지 않는다(화면 읽기 중복 방지)
export function setStatusLine(line, job, verb) {
  const st = jobState(job);
  const text = jobLine(job, verb);
  line.dataset.jobState = st;
  const icon = st.endsWith("waiting") ? ICON_CLOCK : st === "failed" ? ICON_WARN : `<span class="spinner" aria-hidden="true"></span>`;
  if (line.dataset.text !== text) {
    line.dataset.text = text;
    $("[data-icon]", line).innerHTML = icon;
    $(".grow", line).textContent = text + (st.endsWith("waiting") && job.deadline_at ? ` · ${deadlineText(job)}` : "");
  }
}
export function statusLineEl(onCancel) {
  const line = el(`<div class="status-line" role="status" data-job-line><span data-icon></span><span class="grow"></span>
    ${onCancel ? `<button type="button" class="btn sm ghost" data-job-cancel>취소</button>` : ""}</div>`);
  if (onCancel) $("[data-job-cancel]", line).onclick = onCancel;
  return line;
}

// ------------------------------------------------------------------ 요약 진행 카드 (6장)
const CARD_MSG = {
  no_online_worker: "PaperLab 앱이 켜진 PC가 생기면 바로 시작해요. 탭을 닫아도 기다려요.",
  no_engine_on_worker: "{p}가 설치 · 로그인된 PC가 연결돼 있지 않아요. 설정에서 PC를 연결하거나 엔진 순서를 바꿔 주세요.",
  all_workers_busy: "PC가 하던 작업을 끝내면 시작해요.",
};
export function summaryCard(job, { onCancel, onRetry }) {
  const card = el(`<div class="graph-progress-card job-card" data-summary-progress>
    <div class="graph-progress-head"><span data-icon></span><span data-title></span></div>
    <div class="progress indeterminate hidden" role="progressbar" aria-label="요약 진행" aria-valuemin="0" aria-valuemax="100"><div style="width:5%"></div></div>
    <div data-steps></div>
    <p class="graph-progress-msg" role="status"></p>
    <div class="notice hidden" data-tone="info" data-keep-open>${ICON_INFO}<div>탭을 닫아도 계속돼요. 다시 열면 이어서 보여 드려요.</div></div>
    <div class="graph-progress-foot"><span class="small muted" data-job-time></span><span class="row" style="gap:6px">
      <button type="button" class="btn sm hidden" data-job-settings>설정 열기</button>
      <button type="button" class="btn sm" data-job-cancel>취소</button>
      <button type="button" class="btn sm primary hidden" data-job-retry>다시 시도</button></span></div></div>`);
  $("[data-job-cancel]", card).onclick = onCancel;
  $("[data-job-retry]", card).onclick = onRetry;
  $("[data-job-settings]", card).onclick = openSettings;
  updateSummaryCard(card, job);
  return card;
}
export function updateSummaryCard(card, job) {
  const st = jobState(job);
  const waiting = st === "cli-waiting";
  const running = st.endsWith("running") || st === "api-queued";
  const title = waiting ? "PC에서 실행 대기 중" : st === "failed" ? "요약을 만들지 못했어요" : st === "cancelling" ? "취소하는 중…" : "논문을 정리하고 있어요";
  const msg = st === "failed" ? job.error || errorLabel(job.error_code, job.engine)
    : waiting ? (CARD_MSG[job.waiting_reason] || "PC가 곧 작업을 가져가요.").replace("{p}", job.engine) : jobLine(job, "정리", { elapsed: false });
  card.dataset.jobId = job.id;
  card.dataset.waiting = job.waiting_reason || "";
  if (card.dataset.jobState !== st) {
    card.dataset.jobState = st;
    $("[data-icon]", card).innerHTML = waiting ? ICON_CLOCK : st === "failed" ? ICON_WARN : `<span class="spinner" aria-hidden="true"></span>`;
    $("[data-title]", card).textContent = title;
    $(".progress", card).classList.toggle("hidden", !running);
    $("[data-keep-open]", card).classList.toggle("hidden", !running);
    $("[data-job-settings]", card).classList.toggle("hidden", !(waiting && job.waiting_reason === "no_engine_on_worker"));
    $("[data-job-cancel]", card).classList.toggle("hidden", st === "failed");
    $("[data-job-cancel]", card).disabled = st === "cancelling";
    $("[data-job-retry]", card).classList.toggle("hidden", st !== "failed");
  }
  const msgEl = $(".graph-progress-msg", card);
  msgEl.setAttribute("role", st === "failed" ? "alert" : "status");
  // role=status 글은 상태가 바뀔 때만 (경과 시간은 아래 줄에서 따로 — 13장)
  const key = `${st}|${job.waiting_reason}|${job.device && job.device.id}|${(job.progress || {}).message || ""}|${(job.progress || {}).fraction}|${job.error}`;
  if (msgEl.dataset.key !== key) { msgEl.dataset.key = key; msgEl.textContent = msg; }
  $("[data-steps]", card).innerHTML = stepsHtml(job);
  const p = job.progress || {};
  const bar = $(".progress", card);
  const pct = typeof p.fraction === "number" ? Math.round(p.fraction * 100) : null;
  bar.classList.toggle("indeterminate", pct == null);
  $("div", bar).style.width = `${pct || 5}%`;
  if (pct != null) bar.setAttribute("aria-valuenow", pct); else bar.removeAttribute("aria-valuenow");
  const started = job.started_at ? (Date.now() - new Date(job.started_at).getTime()) / 1000 : 0;
  $("[data-job-time]", card).textContent = waiting ? deadlineText(job)
    : st === "failed" ? (job.started_at ? `${fmtClock(job.started_at)} 시작` : "")
    : started && started > 180 ? `시작한 지 ${fmtElapsed(started)}` : "보통 1~3분 걸려요";
}

// ------------------------------------------------------------------ 사이드바 배지 (9.1절)
let badgeTimer = null;
export function setJobBadge(n) {
  state.stats.jobs = n || 0;
  for (const node of $$('[data-count="jobs"]')) {
    node.textContent = n ? n : "";
    node.toggleAttribute("data-active", !!n);
    if (n) node.setAttribute("aria-label", `진행 중 ${n}개`); else node.removeAttribute("aria-label");
  }
}
export async function refreshJobBadge() {
  try { setJobBadge((await api.get("/api/jobs?status=active&limit=1")).total); } catch { /* 다음 주기에 */ }
}
export function startJobBadge() {
  stopJobBadge();
  refreshJobBadge();
  badgeTimer = setInterval(() => { if (!document.hidden) refreshJobBadge(); }, 30000);
}
export function stopJobBadge() {
  clearInterval(badgeTimer);
  badgeTimer = null;
  setJobBadge(0);
}

// ------------------------------------------------------------------ 작업 목록 화면 #/jobs (9.2절)
let jobsView = null;
export function closeJobs() {
  if (jobsView) { clearTimeout(jobsView.timer); jobsView = null; }
}
export async function renderJobs(main) {
  closeJobs();
  const me = { tab: "active", timer: null };
  jobsView = me;
  main.innerHTML = "";
  const view = el(`<section class="view">
    <div class="toolbar"><h1>작업</h1><div class="seg" role="group" aria-label="보기"><button type="button" data-tab="active" class="active" aria-pressed="true">진행 중 <span data-n></span></button><button type="button" data-tab="recent" aria-pressed="false">최근 7일</button></div></div>
    <div class="discover-results" style="padding:16px"><ul class="item-list" data-job-list aria-label="작업"></ul></div></section>`);
  main.appendChild(view);
  const list = $("[data-job-list]", view);
  $$("[data-tab]", view).forEach((b) => (b.onclick = () => {
    me.tab = b.dataset.tab;
    $$("[data-tab]", view).forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
    list.innerHTML = "";
    load();
  }));
  const load = async () => {
    clearTimeout(me.timer);
    if (jobsView !== me) return;
    let data;
    try { data = await api.get(`/api/jobs${qs({ status: me.tab, limit: 100 })}`); } catch (e) { errorToast(e); return; }
    if (jobsView !== me) return;
    const active = data.jobs.filter((j) => ACTIVE.has(j.status));
    if (me.tab === "active") { $("[data-n]", view).textContent = data.total || ""; setJobBadge(data.total); }
    drawList(list, data.jobs, me.tab, load);
    if (active.length) me.timer = setTimeout(load, document.hidden ? 10000 : 1500);
  };
  load();
}

function jobTitle(j) {
  if (j.kind === "write") return j.manuscript_title ? `원고: ${j.manuscript_title}` : "글쓰기 도우미";
  return j.paper_title || "삭제된 논문";
}

function drawList(list, jobs, tab, reload) {
  if (!jobs.length) {
    list.innerHTML = `<li class="empty">${tab === "active" ? "진행 중인 작업이 없어요" : "최근 7일 동안 한 작업이 없어요"}</li>`;
    return;
  }
  list.querySelector(".empty")?.remove();
  const keep = new Set(jobs.map((j) => String(j.id)));
  $$("[data-job-id]", list).forEach((li) => { if (!keep.has(li.dataset.jobId)) li.remove(); });
  jobs.forEach((j, i) => {
    let li = $(`[data-job-id="${j.id}"]`, list);
    const sig = JSON.stringify([j.status, j.cancel_requested, j.waiting_reason, j.device, j.error, j.route_index, j.history.length, j.manuscript_title, (j.progress || {}).message]);
    if (li && li.dataset.sig === sig) {
      const meta = $("[data-elapsed]", li);
      if (meta) meta.textContent = jobLine(j);
      return;
    }
    const fresh = jobItem(j, reload);
    fresh.dataset.sig = sig;
    if (li) {
      // 초점이 있는 카드는 통째로 바꾸지 않고 글만 바꾼다 (13장)
      if (li.contains(document.activeElement)) { $(".status-line .grow", li).textContent = jobLine(j); li.dataset.sig = ""; return; }
      li.replaceWith(fresh);
    } else list.insertBefore(fresh, list.children[i] || null);
  });
}

function jobItem(j, reload) {
  const st = jobState(j);
  const active = ACTIVE.has(j.status);
  const title = jobTitle(j);
  const href = j.paper_id && j.kind !== "write" ? `#/read/${j.paper_id}` : "";
  const meta = [
    (j.route || []).map(slotName).join(" → "),
    j.started_at ? `${fmtClock(j.started_at)} 시작` : `${fmtClock(j.created_at)} 만듦`,
    st.endsWith("waiting") ? deadlineText(j) : "",
    j.status === "failed" && j.attempts > 1 ? `${j.attempts}번 시도` : "",
  ].filter(Boolean).join(" · ");
  const tone = j.status === "failed" ? " bad" : j.status === "succeeded" ? " ok" : "";
  const li = el(`<li class="item-card" data-job-id="${j.id}" data-job-state="${st}">
    <div class="item-head"><span class="chip">${KIND_LABEL[j.kind]}</span>
      ${href ? `<a class="item-title" href="${href}">${esc(title)}</a>` : `<span class="item-title">${esc(title)}</span>`}
      <span class="item-actions"></span></div>
    <div class="status-line${tone}"><span class="grow" data-elapsed>${esc(jobLine(j))}</span></div>
    <p class="item-meta">${esc(meta)}</p>
    ${(j.history || []).length ? `<details><summary>시도한 순서 보기</summary>${stepsHtml(j) || `<ol class="graph-steps">${j.history.map((h) => `<li data-state="failed">${esc(slotName(h))} <span class="graph-step-msg">${esc(errorLabel(h.error_code, h.engine))}</span></li>`).join("")}</ol>`}</details>` : ""}
  </li>`);
  const acts = $(".item-actions", li);
  const btn = (label, cls, fn) => { const b = el(`<button type="button" class="btn sm ${cls}">${label}</button>`); b.onclick = fn; acts.appendChild(b); return b; };
  if (active) {
    if (j.waiting_reason === "no_engine_on_worker") btn("설정 열기", "", openSettings);
    const c = btn("취소", "", async () => { c.disabled = true; try { await cancelJob(j.id); } catch (e) { errorToast(e); } reload(); });
    c.disabled = st === "cancelling";
    c.setAttribute("aria-label", `${title} 작업 취소`);
  } else if (j.status === "failed" || j.status === "cancelled") {
    btn("다시 시도", "primary", async () => { try { await retryJob(j.id); toast("작업을 다시 시작했어요", "success"); } catch (e) { errorToast(e); } reload(); });
  } else if (j.kind === "write" && j.result && j.result.text) {
    btn("결과 복사", "", () => { copyText(j.result.text); toast("결과를 복사했어요", "success"); }).title = "결과 글은 24시간 동안 복사할 수 있어요";
  } else if (href) {
    btn("열기", "", () => { location.hash = href; });
  }
  return li;
}
