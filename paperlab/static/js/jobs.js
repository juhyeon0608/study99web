// 작업 큐 화면 (2단계 — docs/design/phase2-worker-electron-ui.md 5 · 6 · 9장): 상태 문구 · 진행 따라가기(폴링) · 작업 목록 · 사이드바 배지
// 서버 작업 보기(명세 7장)를 화면 문구로 바꾸는 곳은 여기 한 곳 — 요약 카드 · 대화 · 글쓰기 · 작업 목록이 함께 쓴다.

import { api, qs } from "./api.js";
import { state } from "./state.js";
import { $, $$, ICON_CLOCK, ICON_INFO, ICON_WARN, copyText, el, errorToast, esc, josa, store, toast } from "./ui.js";

export const COMPANY = { claude: "Anthropic", codex: "OpenAI", gemini: "Google" };
const KIND_LABEL = { summary: "요약", chat: "대화", write: "글쓰기", index: "색인", find: "AI로 찾기", verify: "인용 검증",
  explain: "쉬운 설명", translate: "선택 번역", translate_paper: "전체 번역" }; // 4단계 (시안 7.3절)
const XT_VIEW = { explain: "history", translate: "history", translate_paper: "paper" };
// 아직 끝나지 않은 작업인지 (요약 · 대화 · 설명 · 찾기 화면이 함께 씀)
export const isActive = (j) => !!j && (j.status === "queued" || j.status === "running");

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
  index_failed: "색인하지 못함", search_failed: "검색 결과를 받지 못함", // 3단계
};
export const errorLabel = (code, engine = "") => (ERROR_LABELS[code] || "실패").replace("{p}", engine);
export const slotName = (s) => (s.engine === "local" ? "서버에서 실행" : s.runner === "api" ? `${COMPANY[s.engine]} API` : `PC의 ${s.engine}`);

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
  if (isActive(job)) return `${job.runner}-${job.status === "queued" ? (job.runner === "api" ? "queued" : "waiting") : "running"}`;
  return job.status;
}
const WAITING = {
  no_online_worker: "PC에서 실행 대기 중 — 켜진 PC가 없어요",
  no_engine_on_worker: "PC에서 실행 대기 중 — {p}가 있는 PC가 없어요",
  all_workers_busy: "PC에서 실행 대기 중 — PC가 다른 작업 중이에요",
  // 로컬 항목(PC에만 둔 파일) 작업: 보관 PC만 잡음 — 서버 pinned_device.note("‘집 PC’가 켜지면 실행돼요")가 있으면 그것 (selective-sync.md 7.4 · 10.6절)
  holder_offline: "PC에서 실행 대기 중 — 파일을 가진 PC가 꺼져 있어요",
};
// 대기 이유 한 줄 — 모르는 이유(새 서버)여도 깨지지 않게
function waitingText(job, table, fallback) {
  const r = job.waiting_reason;
  if (r === "holder_offline" && job.pinned_device && job.pinned_device.note) {
    return table === WAITING ? `PC에서 실행 대기 중 — ${job.pinned_device.note}` : `${job.pinned_device.note}. 탭을 닫아도 기다려요.`;
  }
  return (table[r] || fallback).replace("{p}", job.engine);
}
const reassigned = (job) => job.attempts >= 2 && (job.history || []).slice(-1)[0]?.error_code === "lease_expired";

// 한 줄 상태 (대화 · 글쓰기 · 작업 목록 · 요약 카드 메시지 공용)
export function jobLine(job, verb = "실행", { elapsed = true } = {}) {
  const st = jobState(job);
  const p = job.progress || {};
  const pct = typeof p.fraction === "number" ? ` · ${Math.round(p.fraction * 100)}%` : "";
  const dev = job.device ? `‘${job.device.name}’` : "PC";
  switch (st) {
    case "api-queued": return job.engine === "local" ? "서버 차례를 기다리는 중" : `${COMPANY[job.engine]} API 차례를 기다리는 중`;
    case "api-running": return `${job.engine === "local" ? "서버에서" : `${COMPANY[job.engine]} API로`} ${verb}하는 중${p.message ? ` · ${p.message}` : ""}${pct}`;
    case "cli-waiting": return job.waiting_reason ? waitingText(job, WAITING, "PC가 곧 작업을 가져가요") : "PC가 곧 작업을 가져가요";
    case "cli-running": return `${reassigned(job) ? "PC 연결이 끊겨 다른 PC로 넘겼어요 · " : ""}${dev}에서 실행 중 (${job.engine})${elapsed && job.started_at ? ` · ${elapsedText(job)}` : ""}`;
    case "cancelling": return "취소하는 중…";
    case "succeeded": return job.engine === "local" ? "완료 · 서버에서 실행" : job.runner === "api" ? `완료 · ${COMPANY[job.engine]} API` : `완료 · ${dev}(${job.engine})에서 실행`;
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
      state = job.status === "succeeded" ? "done" : job.status === "failed" ? "failed" : isActive(job) ? "now" : "";
      msg = job.status === "failed" ? errorLabel(job.error_code, slot.engine) : isActive(job) ? jobLine(job) : "";
      if (fails.length && isActive(job)) msg = `${errorLabel(fails[fails.length - 1].error_code, slot.engine)} → ${msg}`;
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
      if (!isActive(job)) { stopped = true; return; }
    } catch (e) {
      if (stopped) return;
      if (e.status === 404) { stopped = true; onUpdate(null); return; }
    }
    timer = setTimeout(tick, document.hidden ? 10000 : 1500);
  };
  if (first) { onUpdate(first); if (!isActive(first)) return () => {}; timer = setTimeout(tick, 1500); }
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
// 경과 시간은 1.5초마다 바뀌므로 role=status 글에 넣지 않고 옆 칸(aria-hidden)에 — 화면 읽기가 계속 읽지 않게
export function setStatusLine(line, job, verb) {
  const st = jobState(job);
  const text = jobLine(job, verb, { elapsed: false });
  line.dataset.jobState = st;
  const icon = st.endsWith("waiting") ? ICON_CLOCK : st === "failed" ? ICON_WARN : `<span class="spinner" aria-hidden="true"></span>`;
  if (line.dataset.text !== text) {
    line.dataset.text = text;
    $("[data-icon]", line).innerHTML = icon;
    $(".grow", line).textContent = text + (st.endsWith("waiting") && job.deadline_at ? ` · ${deadlineText(job)}` : "");
  }
  $("[data-tick]", line).textContent = st === "cli-running" && job.started_at ? ` · ${elapsedText(job)}` : "";
}
export function statusLineEl(onCancel) {
  const line = el(`<div class="status-line" data-job-line><span data-icon></span><span class="grow" role="status"></span><span data-tick aria-hidden="true"></span>
    ${onCancel ? `<button type="button" class="btn sm ghost" data-job-cancel>취소</button>` : ""}</div>`);
  if (onCancel) $("[data-job-cancel]", line).onclick = onCancel;
  return line;
}

// ------------------------------------------------------------------ 요약 진행 카드 (6장)
const CARD_MSG = {
  no_online_worker: "PaperLab 앱이 켜진 PC가 생기면 바로 시작해요. 탭을 닫아도 기다려요.",
  no_engine_on_worker: "{p}가 설치 · 로그인된 PC가 연결돼 있지 않아요. 설정에서 PC를 연결하거나 엔진 순서를 바꿔 주세요.",
  all_workers_busy: "PC가 하던 작업을 끝내면 시작해요.",
  holder_offline: "이 파일을 가진 PC가 켜지면 시작해요. 탭을 닫아도 기다려요.",
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
    : waiting ? waitingText(job, CARD_MSG, "PC가 곧 작업을 가져가요.") : jobLine(job, "정리", { elapsed: false });
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
// 배지와 끝남 알림은 같은 주기로 (진행 중이 있으면 5초, 없으면 30초 — 탭이 숨으면 15초 · 60초)
export function startJobBadge() {
  stopJobBadge();
  N.on = true;
  pollJobs();
}
export function stopJobBadge() {
  clearTimeout(N.timer);
  Object.assign(N, { on: false, timer: null, since: "", fast: 0 });
  N.seen.clear();
  N.handled.clear();
  setJobBadge(0);
}

// ------------------------------------------------------------------ 끝남 알림 (2026-10-16 백그라운드 AI)
// AI 작업은 서버(내 API 키) · 내 PC(CLI)에서 끝까지 돌고, 화면은 어디에 있든 끝나면 알린다: 앱 안 토스트 + [열기],
// 브라우저 알림(허락했을 때 · 화면을 보고 있지 않을 때). 그 화면이 이미 결과를 보여 줬으면(handledJob) 토스트는 생략.
const NOTIFY_KINDS = new Set(["summary", "chat", "write", "find", "verify", "explain", "translate", "translate_paper"]);
const SEEN_AT_KEY = "paperlab.jobsSeenAt"; // 마지막으로 확인한 서버 시각 — 앱을 닫은 동안 끝난 작업 세기
const ASKED_KEY = "paperlab.notifyAsked"; // 브라우저 알림 허락을 한 번 물어봤는지
const N = { on: false, timer: null, since: "", fast: 0, seen: new Set(), handled: new Set() };

// 이 화면이 결과를 직접 보여 줬음 (대화 답이 SSE로 옴 · 글쓰기 창에서 결과를 봄) — 토스트를 띄우지 않음
export function handledJob(id) {
  if (id) N.handled.add(Number(id));
}
// 방금 만든 작업: 다음 확인을 앞당기고 10분 동안 빠른 주기로
export function trackJob(job) {
  if (!N.on || !job) return;
  N.fast = Date.now() + 10 * 60 * 1000;
  clearTimeout(N.timer);
  N.timer = setTimeout(pollJobs, 1500);
}

async function pollJobs() {
  clearTimeout(N.timer);
  if (!N.on) return;
  let active = 0;
  try {
    const a = await api.get("/api/jobs?status=active&limit=1");
    active = a.total;
    setJobBadge(a.total);
    if (!N.since) await catchUp(a.now);
    else {
      // 트랜잭션 시각 차이를 덮으려고 1분 겹쳐 묻고 이미 본 작업은 건너뜀
      const since = new Date(new Date(N.since).getTime() - 60000).toISOString();
      const f = await api.get(`/api/jobs${qs({ status: "finished", since, limit: 50 })}`);
      N.since = f.now;
      store.set(SEEN_AT_KEY, f.now);
      f.jobs.slice().reverse().forEach(announce);
    }
  } catch { /* 다음 주기에 */ }
  if (!N.on) return;
  const fast = active > 0 || Date.now() < N.fast;
  N.timer = setTimeout(pollJobs, document.hidden ? (fast ? 15000 : 60000) : (fast ? 5000 : 30000));
}

// 앱을 열 때: 지난번 뒤로(7일 안) 끝난 AI 작업을 한 번에 알림
async function catchUp(now) {
  const last = store.get(SEEN_AT_KEY);
  N.since = now;
  store.set(SEEN_AT_KEY, now);
  if (!last || Number.isNaN(Date.parse(last))) return;
  const f = await api.get(`/api/jobs${qs({ status: "finished", since: last, limit: 50 })}`);
  const done = f.jobs.filter((j) => NOTIFY_KINDS.has(j.kind) && j.status !== "cancelled");
  f.jobs.forEach((j) => N.seen.add(j.id));
  if (!done.length) return;
  if (done.length === 1) return announce(done[0], { force: true });
  const failed = done.filter((j) => j.status === "failed").length;
  toast(`앱을 닫은 동안 AI 작업 ${done.length}개가 끝났어요${failed ? ` (실패 ${failed}개)` : ""}`, failed ? "error" : "success",
    { duration: 10000, action: { label: "작업 보기", onClick: () => { location.hash = "#/jobs"; } } });
}

export function finishedText(j) {
  const title = jobTitle(j);
  if (j.status === "failed") return `${kindLabel(j)} 실패 — ${j.error || errorLabel(j.error_code, j.engine)} (${title})`;
  if (j.kind === "write") return `AI 글쓰기 결과가 준비됐어요 — ${title}`;
  return `${josa(kindLabel(j), "이/가")} 끝났어요 — ${title}`;
}

function announce(j, { force = false } = {}) {
  if (!force && N.seen.has(j.id)) return;
  N.seen.add(j.id);
  if (!NOTIFY_KINDS.has(j.kind) || j.status === "cancelled") return;
  // 그 화면이 이미 결과를 보여 줬으면(handledJob) 토스트도 브라우저 알림도 띄우지 않는다 — 같은 결과를 두 번 알리지 않음
  if (N.handled.has(j.id)) return;
  const text = finishedText(j);
  osNotify(j, text);
  toast(text, j.status === "failed" ? "error" : "success",
    { duration: 12000, action: { label: j.status === "failed" ? "작업 보기" : "열기", onClick: () => (j.status === "failed" ? openJobs() : openJob(j)) } });
}

function osNotify(j, text) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (!document.hidden && document.hasFocus()) return; // 화면을 보고 있으면 앱 안 토스트만
    const n = new Notification("PaperLab", { body: text, tag: `paperlab-job-${j.id}` });
    n.onclick = () => { try { window.focus(); } catch { /* 무시 */ } n.close(); openJob(j); };
  } catch { /* 알림을 못 띄우는 환경 */ }
}
const openJobs = () => { location.hash = "#/jobs"; };

// 작업 결과 열기: 지금 화면이 열 수 있으면 그 화면이 연다(같은 원고의 글쓰기 결과 — writing.js가 이벤트를 받음), 아니면 그 화면으로
export function openJob(j) {
  const ev = new CustomEvent("paperlab:open-job", { detail: j, cancelable: true });
  if (!window.dispatchEvent(ev)) return;
  rememberTab(j);
  location.hash = jobHref(j) || "#/jobs";
}
function rememberTab(j) {
  if (XT_VIEW[j.kind] && j.paper_id) state.readerTab = { pid: j.paper_id, tab: "explain", view: XT_VIEW[j.kind] };
  else if (j.kind === "chat" && j.paper_id) state.readerTab = { pid: j.paper_id, tab: "chat" };
}

// 브라우저 알림을 켤지 한 번만 물어보는 안내 (사용자가 누른 단추 안에서 requestPermission — 브라우저 규칙).
// 지원하지 않음 · 이미 정함 · 이미 물어봄 · PC 앱 창(앱이 알림 권한을 막음)이면 null
export function notifyOffer() {
  if (typeof Notification === "undefined" || window.paperlabDesktop || Notification.permission !== "default" || store.get(ASKED_KEY)) return null;
  const box = el(`<div class="notice" data-tone="info" data-notify-offer>${ICON_INFO}<div><b>끝나면 알려 드릴까요?</b>
    브라우저 알림을 켜 두면 다른 탭이나 창에 있어도 작업이 끝났을 때 알려 드려요. 알림 말고는 아무것도 보내지 않아요.
    <div class="row" style="gap:6px;margin-top:6px"><button type="button" class="btn sm primary" data-notify-yes>알림 켜기</button>
    <button type="button" class="btn sm ghost" data-notify-no>괜찮아요</button></div></div></div>`);
  $("[data-notify-yes]", box).onclick = async () => {
    store.set(ASKED_KEY, "1");
    box.remove();
    let p = "default";
    try { p = await Notification.requestPermission(); } catch { /* 옛 브라우저 */ }
    toast(p === "granted" ? "작업이 끝나면 알림으로 알려 드릴게요" : "알림을 켜지 않았어요. 앱 안에서만 알려 드릴게요", p === "granted" ? "success" : "");
  };
  $("[data-notify-no]", box).onclick = () => { store.set(ASKED_KEY, "1"); box.remove(); };
  return box;
}

// AI를 시작하기 전에: 이 작업 종류의 경로(내 API 키 · 연결된 내 PC의 CLI)가 있는지. 없으면 안내 + [설정 열기] → false.
// 서버 PC의 CLI · 서버 키로 대신하지 않는다 (2026-10-16 제품 책임자 결정)
export const NO_ROUTE_TEXT = "AI를 실행할 방법이 없어요. 설정 → 연결된 PC에서 PaperLab 앱을 설치한 내 PC를 연결하거나, 설정 → AI 엔진에서 내 API 키를 넣어 주세요.";
export async function ensureAiRoute(kind) {
  let st;
  try { st = await api.get("/api/ai/status"); } catch { return true; } // 상태를 못 받으면 서버가 판단(경로 없음 400 — 같은 문구)
  const k = st && st.kinds && st.kinds[kind];
  if (k && k.first) return true;
  toast((k && k.message) || NO_ROUTE_TEXT, "error", { duration: 12000, action: { label: "설정 열기", onClick: openSettings } });
  return false;
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
    const active = data.jobs.filter((j) => isActive(j));
    if (me.tab === "active") { $("[data-n]", view).textContent = data.total || ""; setJobBadge(data.total); }
    drawList(list, data.jobs, me.tab, load);
    if (active.length) me.timer = setTimeout(load, document.hidden ? 10000 : 1500);
  };
  load();
}

// 3단계 작업 이름 · 여는 주소 (docs/design/phase3-ask-ui.md 7.1절)
const SCOPE_LABEL = { library: "서재 전체", collection: "컬렉션", folder: "폴더" };
export function kindLabel(j) {
  return j.kind === "chat" && !j.paper_id && j.scope ? "서재 질문" : KIND_LABEL[j.kind] || j.kind;
}
export function jobTitle(j) {
  if (j.kind === "write") return j.manuscript_title ? `원고: ${j.manuscript_title}` : "글쓰기 도우미";
  if (j.kind === "verify") return j.manuscript_title ? `원고: ${j.manuscript_title}` : "인용 검증 (원고가 지워졌어요)";
  if (j.kind === "index") return "서재 색인";
  if (j.kind === "find") return j.question ? `“${j.question.length > 40 ? `${j.question.slice(0, 40)}…` : j.question}”` : "AI로 찾기 (결과가 지워졌어요)";
  if (j.kind === "chat" && !j.paper_id && j.scope) return SCOPE_LABEL[j.scope.type] || "서재 질문";
  return j.paper_title || "삭제된 논문";
}
export function jobHref(j) {
  if (j.kind === "index") return "#/ask";
  if (j.kind === "find") return `#/ask/find/j${j.id}`;
  if (j.kind === "verify") return j.manuscript_id ? `#/write/${j.manuscript_id}` : "";
  if (j.kind === "chat" && !j.paper_id && j.scope) return j.scope.type === "library" ? "#/ask" : `#/ask/${j.scope.type[0]}${j.scope.id}`;
  // 글쓰기 결과: 그 원고를 열고 결과 창을 띄움 (#/write/원고/j작업 — 2026-10-16 백그라운드 AI)
  if (j.kind === "write") return j.manuscript_id && j.manuscript_title != null ? `#/write/${Number(j.manuscript_id)}/j${Number(j.id)}` : "";
  return j.paper_id ? `#/read/${j.paper_id}` : "";
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
    const sig = JSON.stringify([j.status, j.cancel_requested, j.waiting_reason, j.device, j.error, j.route_index, j.history.length, j.manuscript_title, (j.progress || {}).message,
      j.write && j.write.handled]);
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
  const active = isActive(j);
  const title = jobTitle(j);
  const expired = j.kind === "find" && !j.question; // 24시간 정리로 질문 · 결과가 지워짐 (3단계 품질팀 L4)
  const href = jobHref(j);
  // 4단계 작업은 읽기 화면을 "설명·번역" 탭으로, 대화는 "대화" 탭으로 연다 (화면 메모리 — 시안 7.3절)
  const remember = () => rememberTab(j);
  const handled = j.kind === "write" && j.write && j.write.handled;
  const meta = [
    (j.route || []).map(slotName).join(" → "),
    j.started_at ? `${fmtClock(j.started_at)} 시작` : `${fmtClock(j.created_at)} 만듦`,
    st.endsWith("waiting") ? deadlineText(j) : "",
    j.status === "failed" && j.attempts > 1 ? `${j.attempts}번 시도` : "",
    handled === "applied" ? "원고에 넣음" : handled === "dismissed" ? "넣지 않음" : "",
  ].filter(Boolean).join(" · ");
  const tone = j.status === "failed" ? " bad" : j.status === "succeeded" ? " ok" : "";
  const li = el(`<li class="item-card" data-job-id="${j.id}" data-job-state="${st}">
    <div class="item-head"><span class="chip">${esc(kindLabel(j))}</span>
      ${href ? `<a class="item-title" href="${esc(href)}">${esc(title)}</a>` : `<span class="item-title">${esc(title)}</span>`}
      <span class="item-actions"></span></div>
    <div class="status-line${tone}"><span class="grow" data-elapsed>${esc(expired && !active ? "만료됨 — 24시간이 지나 지워졌어요" : jobLine(j))}</span></div>
    <p class="item-meta">${esc(meta)}</p>
    ${(j.history || []).length ? `<details><summary>시도한 순서 보기</summary>${stepsHtml(j) || `<ol class="graph-steps">${j.history.map((h) => `<li data-state="failed">${esc(slotName(h))} <span class="graph-step-msg">${esc(errorLabel(h.error_code, h.engine))}</span></li>`).join("")}</ol>`}</details>` : ""}
  </li>`);
  const link = $("a.item-title", li);
  if (link) link.addEventListener("click", remember);
  const acts = $(".item-actions", li);
  const btn = (label, cls, fn) => { const b = el(`<button type="button" class="btn sm ${cls}">${label}</button>`); b.onclick = fn; acts.appendChild(b); return b; };
  if (active) {
    if (j.waiting_reason === "no_engine_on_worker") btn("설정 열기", "", openSettings);
    const c = btn("취소", "", async () => { c.disabled = true; try { await cancelJob(j.id); } catch (e) { errorToast(e); } reload(); });
    c.disabled = st === "cancelling";
    c.setAttribute("aria-label", `${title} 작업 취소`);
  } else if (expired) {
    // 다시 시도할 질문이 없음 — 버튼 없음
  } else if (j.status === "failed" || j.status === "cancelled") {
    btn("다시 시도", "primary", async () => { try { await retryJob(j.id); toast("작업을 다시 시작했어요", "success"); } catch (e) { errorToast(e); } reload(); });
  } else if (j.kind === "write" && j.result && j.result.text) {
    // 글쓰기 결과는 7일 동안: 원고에서 열어 넣기(바뀐 부분 확인) · 복사
    if (href) btn(handled ? "원고에서 보기" : "원고에 넣기", handled ? "" : "primary", () => openJob(j));
    btn("결과 복사", "", () => copyText(j.result.text)).title = "결과 글은 7일 동안 열 수 있어요";
  } else if (href) {
    btn("열기", "", () => { remember(); location.hash = href; });
  }
  return li;
}
