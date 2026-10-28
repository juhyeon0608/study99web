// 진입점: 로그인 게이트(시작 · 로그인 · 허용 안 됨 · 멈춤), 계정 메뉴, 사이드바(필터 · 폴더 · 컬렉션 · 태그 · 저장 공간),
// 화면 전환(#/library, #/discover, #/ask(3단계 AI 질문), #/read/:id, #/write, #/graph · #/graph/W…)

import { ApiError, api, setApiHooks, setApiLive } from "./api.js";
import { exchangeCode, googleAuthUrl, hasAuthCode, initAuth, sessionUser, signInWithGoogle, signOut, startSession, takeRedirectError } from "./auth.js";
import {
  cancelUploads, checkModeDone, folderIcon, folderPickDialog, folderSubtree, maskEmail, movedToast, settingsDialog, syncModeDialog,
  uploadPdfs, uploadsRunning, usageInfo,
} from "./dialogs.js";
import { closeAsk, renderAsk, scopeFromFilter, scopeHash } from "./ask.js";
import { resetCiteCache } from "./cite.js";
import { renderDiscover, resetDiscover } from "./discover.js";
import { closeGraph, renderGraph, resetGraphMemory } from "./graph.js";
import { flushLibrary, loadPapers, renderLibrary } from "./library.js";
import { closeJobs, renderJobs, startJobBadge, stopJobBadge } from "./jobs.js";
import { closeTrash, renderTrash } from "./trash.js";
import { closeReader, flushReader, openReader, stopSummaries } from "./reader.js";
import { folderMark, folderMenu, sizeText } from "./syncmode.js";
import { resetRefMemory } from "./refpane.js";
import { closeWriter, composeDialog, flushWriter, openManuscript, renderWriteList, unsavedDraft } from "./writing.js";
import { openPalette } from "./palette.js"; // 명령 팔레트 Ctrl+K (2026-10-28)
import { accessDialog, pendingCount } from "./adminaccess.js"; // 관리자 승인 가입 (2026-10-29)
import { actions, onRefresh, refreshAll, resetState, setUsageLoader, state } from "./state.js";
import {
  $, $$, avatarEl, closeMenus, confirmDialog, el, errorToast, esc, josa, modalOpen, popupMenu, promptDialog, saveError, store,
  toast,
} from "./ui.js";

const main = $("#main");
const gate = $("#gate");
const COLLAPSE_KEY = "paperlab.collapsed";
const FOLDER_COLLAPSE_KEY = "paperlab.folders.collapsed";
const RETURN_HASH_KEY = "paperlab.returnHash";
const EXPIRED = "로그인이 만료됐어요. 다시 로그인해 주세요.";
const DRAFT_NOTE = "저장하지 못한 원고는 이 브라우저에 보관해 두었어요. 다시 로그인하면 이어서 저장해요.";
const LOGIN_FAILED = "로그인하지 못했어요. 잠시 후 다시 시도해 주세요.";
const OFFLINE = "인터넷에 연결되지 않았어요. 연결을 확인하고 다시 시도해 주세요.";

const loadSet = (key) => { const v = store.json(key, []); return new Set(Array.isArray(v) ? v : []); };
const saveSet = (key, set) => store.set(key, [...set]);
const collapsed = loadSet(COLLAPSE_KEY);
const folderCollapsed = loadSet(FOLDER_COLLAPSE_KEY);

let authed = false; // 로그인을 마치고 서재를 그렸는지 (아니면 화면 전환 · 사이드바를 그리지 않음)

// ------------------------------------------------------------------ theme
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set("paperlab.theme", theme);
}
if (!document.documentElement.dataset.theme) {
  applyTheme(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
$("#theme-toggle").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

// ------------------------------------------------------------------- gate
// 상태 표 (시안 2.2): boot · down = pending, login · denied = out
function showGate(kind) {
  closeMenus();
  document.body.dataset.auth = kind === "boot" || kind === "down" ? "pending" : "out";
  gate.dataset.gate = kind;
}

const pane = (name) => $(`.gate-pane[data-pane="${name}"]`, gate);

function bootScreen(text) {
  $("[data-boot-text]", gate).textContent = text;
  $("[data-boot]", gate).classList.remove("hidden");
  $("[data-wake]", gate).classList.add("hidden");
  showGate("boot");
}

// 3초 넘게 응답이 없으면 "서버에 연결하는 중…" (D6 — public-config를 보낸 순간부터)
let wakeTimer = null;
function armWake() {
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => {
    if (gate.dataset.gate !== "boot" || document.body.dataset.auth !== "pending") return;
    $("[data-boot]", gate).classList.add("hidden");
    $("[data-wake]", gate).classList.remove("hidden");
  }, 3000);
}

function setNotice(node, lines) {
  lines = [].concat(lines || []).filter(Boolean);
  $("div", node).innerHTML = lines.map(esc).join("<br>");
  node.classList.toggle("hidden", !lines.length);
}

function showLogin({ note = null, error = "" } = {}) {
  resetGoogleButtons();
  setNotice($("[data-gate-note]", gate), note);
  setNotice($("[data-gate-error]", gate), error);
  showGate("login");
  setTimeout(() => $("[data-google]", gate).focus(), 0);
}

// 관리자 승인 대기 (2026-10-29): 로그아웃하지 않고 기다림 — [다시 확인]은 /api/me를 다시 부름
function showPending(email = "") {
  resetGoogleButtons();
  const em = $("[data-pending-email]", gate);
  em.textContent = email;
  em.classList.toggle("hidden", !email);
  showGate("pending");
  setTimeout(() => $(".gate-title", pane("pending")).focus(), 0);
}

function showDenied(email = "") {
  resetGoogleButtons();
  const em = $("[data-gate-email]", gate);
  em.textContent = email;
  em.classList.toggle("hidden", !email);
  showGate("denied");
  setTimeout(() => $(".gate-title", pane("denied")).focus(), 0);
}

const DOWN = {
  paused: {
    d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 9v6M14 9v6", tone: "warn", title: "서비스가 잠시 멈춰 있어요",
    text: "관리자에게 알려 주세요. (관리자: Supabase 대시보드에서 프로젝트를 다시 켜 주세요)",
  },
  offline: {
    d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.5v.01", tone: "warn", title: "인터넷에 연결되지 않았어요",
    text: "연결을 확인하고 다시 시도해 주세요.",
  },
  error: {
    d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.5v.01", tone: "danger", title: "서버에 연결하지 못했어요",
    text: "잠시 후 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요.",
  },
};

// D5 시작할 때 멈춤 · 연결 실패. detail은 "HTTP 502" 같은 짧은 정보만 (토큰 · 주소 넣지 않음)
function showDown(kind, detail = "") {
  const d = DOWN[kind] || DOWN.error;
  const p = pane("down");
  $(".gate-icon", p).dataset.tone = d.tone;
  $(".gate-icon path", p).setAttribute("d", d.d);
  $("[data-down-title]", p).textContent = d.title;
  $("[data-down-text]", p).textContent = d.text;
  const det = $("[data-gate-detail]", p);
  det.textContent = kind === "error" ? detail : "";
  det.classList.toggle("hidden", !(kind === "error" && detail));
  showGate("down");
  setTimeout(() => $("[data-down-title]", p).focus(), 0);
}

function downOf(e) {
  if (e && e.network) return { kind: navigator.onLine === false ? "offline" : "error", detail: "" };
  if (e && e.code === "db_unavailable") return { kind: "paused", detail: "" };
  if (e && e.status) return { kind: "error", detail: `HTTP ${e.status}` };
  return { kind: "error", detail: e && e.message ? String(e.message).slice(0, 120) : "" };
}

// 공개 설정 (인증 없음): {supabase_url, supabase_anon_key}
async function loadPublicConfig() {
  let res;
  try {
    res = await fetch("/api/public-config", { headers: { "X-PaperLab": "1" } });
  } catch {
    throw new ApiError("", { network: true });
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError("", { status: res.status, code: (body && body.code) || "" });
  }
  return res.json();
}

// ------------------------------------------------------------------- boot
let redirectError; // 구글이 돌려보낸 오류 (첫 시작 때 한 번만 읽는다)
let returnedWithCode = false; // 구글에서 ?code= 를 들고 돌아왔는지 (다시 시도 때도 기억)

async function boot({ retry = false } = {}) {
  if (redirectError === undefined) redirectError = takeRedirectError();
  const redirect = redirectError;
  redirectError = null;
  // 구글에서 돌아온 ?code= 가 있었는지 (startSession이 주소에서 지우므로 먼저 기억)
  if (hasAuthCode()) returnedWithCode = true;
  setApiLive(false);
  if (!retry) bootScreen(returnedWithCode ? "로그인하는 중…" : "PaperLab을 여는 중…");
  armWake();
  try {
    const cfg = await loadPublicConfig();
    initAuth(cfg);
    authInitDone();
    // 개발 서버에서만: 테스트 프로젝트 이메일 로그인 칸 (운영 public-config에는 이 값이 없고 모듈도 404)
    if (cfg.dev_email_login) {
      import("./dev-login.js").then((m) => m.mountDevLogin(gate, () => boot({ retry: true })))
        .catch((e) => console.error(e));
    }
    const s = await startSession(); // 성공 · 실패 모두 주소의 code를 지운다
    // Supabase Auth가 응답하지 않음 → 멈춤 화면 (시안 2.2)
    if (s.retryable) return showDown(navigator.onLine === false ? "offline" : "paused");
    if (!s.session) {
      const codeFailed = returnedWithCode; // code가 있었는데 세션이 안 생김 = 교환 실패 (F12)
      returnedWithCode = false;
      if (redirect && redirect.notAllowed) return showDenied("");
      if (redirect && redirect.cancelled) return showLogin({ note: "로그인을 취소했어요." });
      if (redirect || s.error || codeFailed) return showLogin({ error: LOGIN_FAILED });
      return showLogin();
    }
    let me;
    try {
      me = await api.get("/api/me");
    } catch (e) {
      if (e.code === "pending_approval") return showPending((s.session.user && s.session.user.email) || "");
      if (e.code === "not_allowed" || e.code === "access_rejected") {
        // 화면을 그린 뒤 자동 로그아웃 (명세 6.2-5)
        showDenied((s.session.user && s.session.user.email) || "");
        await signOut();
        return;
      }
      if (e.status === 401) {
        await signOut();
        return showLogin({ note: EXPIRED });
      }
      throw e;
    }
    await enterApp(me);
  } catch (e) {
    console.error(e);
    const { kind, detail } = downOf(e);
    showDown(kind, detail);
  } finally {
    clearTimeout(wakeTimer);
  }
}

async function enterApp(me) {
  resetGraphMemory(); // 만료 뒤 다른 계정으로 로그인한 경우에도 이전 그래프를 쓰지 않음
  resetRefMemory(); // 참고 패널 추천 결과(메모리)도 같이
  const user = await sessionUser();
  const meta = (user && user.user_metadata) || {};
  state.user = {
    ...me,
    name: me.display_name || (me.email || "").split("@")[0] || "계정",
    photo: meta.avatar_url || meta.picture || "",
  };
  const [m, settings] = await Promise.all([api.get("/api/meta"), api.get("/api/settings")]);
  state.meta = m;
  state.settings = settings;
  state.sort = store.get("paperlab.sort") || "added";
  await loadSidebar(true);
  drawAccount();
  authed = true;
  document.body.dataset.auth = "in";
  setApiLive(true);
  startJobBadge(); // 사이드바 "작업" 진행 중 개수 + AI 작업 끝남 알림(어느 화면에서든 — 2026-10-16 백그라운드 AI)
  // 관리자: 승인 대기 중인 가입 신청이 있으면 알림 한 번 (2026-10-29)
  if (me.is_admin && me.access_approval) {
    pendingCount().then((n) => {
      state.accessPending = n;
      if (n) toast(`가입 신청 ${n}건이 승인을 기다려요 — 계정 메뉴 → 가입 신청`, "", { duration: 8000 });
    });
  }
  // 구글에서 돌아오면 주소에서 code를 지운 뒤(supabase-js) 떠나기 전 화면으로, 없으면 서재로
  let back = "";
  try { back = sessionStorage.getItem(RETURN_HASH_KEY) || ""; sessionStorage.removeItem(RETURN_HASH_KEY); } catch { /* 무시 */ }
  if (!location.hash || location.hash === "#") history.replaceState(history.state, "", back || "#/library");
  // 보관해 둔 원고를 먼저 저장해야 편집기가 그 내용을 연다
  await restoreDrafts(me.user_id);
  loadUsage();
  route().catch((e) => console.error(e));
  setTimeout(() => import("./alerts.js").then((m) => m.dailyAlertCheck()).catch(() => {}), 4000); // 새 논문 알림 — 하루 한 번
}

// ----------------------------------------------------------- google login
function setBusy(btn, busy) {
  btn.disabled = busy;
  btn.classList.toggle("is-loading", busy && btn.matches("[data-google]"));
  if (busy) btn.setAttribute("aria-busy", "true"); else btn.removeAttribute("aria-busy");
  const label = btn.matches("[data-google]") ? $(".btn-google-label", btn) : btn;
  if (!btn.dataset.label) btn.dataset.label = label.textContent;
  label.textContent = busy ? "구글로 이동하는 중…" : btn.dataset.label;
}

function resetGoogleButtons() {
  for (const b of [$("[data-google]", gate), $("[data-gate-switch]", gate)]) if (b.disabled) setBusy(b, false);
}

async function startGoogle(btn, selectAccount) {
  setNotice($("[data-gate-error]", gate), "");
  if (navigator.onLine === false) return showLogin({ error: OFFLINE });
  if (window.paperlabDesktop) return startDesktopLogin(btn, selectAccount);
  setBusy(btn, true);
  try { if (location.hash) sessionStorage.setItem(RETURN_HASH_KEY, location.hash); } catch { /* 무시 */ }
  try {
    await signInWithGoogle({ selectAccount }); // 이 페이지를 떠난다
  } catch (e) {
    console.error(e);
    return showLogin({ error: navigator.onLine === false ? OFFLINE : LOGIN_FAILED });
  }
  // 이동하지 못하고 이 페이지에 남아 있으면 원래대로 + 오류
  setTimeout(() => {
    if (btn.disabled && document.visibilityState === "visible" && document.body.dataset.auth === "out") {
      showLogin({ error: navigator.onLine === false ? OFFLINE : LOGIN_FAILED });
    }
  }, 15000);
}

// PaperLab PC 앱 창 (2단계 명세 13.4 ① · 디자인 11.3 E5): 시스템 브라우저에서 로그인 → paperlab:// 로 돌아온 code 를 세션으로
let authInitDone;
const authInitialized = new Promise((r) => { authInitDone = r; });
let desktopWait = null; // { selectAccount, timer }
const DESKTOP_WAIT_MS = 10 * 60 * 1000;

function endDesktopWait() {
  if (desktopWait) clearTimeout(desktopWait.timer);
  desktopWait = null;
}

// 앱 쪽 로그인 대기(loginUntil)도 바로 풀게 알린다 — 앱 0.3.1부터 있는 함수라 옛 앱에서는 부르지 않음. 결과는 기다리지 않음
function cancelDesktopLogin() {
  try { window.paperlabDesktop?.cancelGoogleLogin?.()?.catch?.(() => {}); } catch { /* 옛 앱 · 앱 쪽 오류는 무시 */ }
}

async function startDesktopLogin(btn, selectAccount) {
  if (btn) setBusy(btn, true);
  let ok = false;
  try {
    try { if (location.hash) sessionStorage.setItem(RETURN_HASH_KEY, location.hash); } catch { /* 무시 */ }
    const r = await window.paperlabDesktop.startGoogleLogin(await googleAuthUrl({ selectAccount }));
    ok = !!(r && r.ok);
  } catch (e) {
    console.error(e);
  }
  if (!ok) { endDesktopWait(); return showLogin({ error: "브라우저를 열지 못했어요. 다시 시도해 주세요." }); }
  resetGoogleButtons();
  endDesktopWait();
  desktopWait = { selectAccount, timer: setTimeout(() => {
    desktopWait = null;
    cancelDesktopLogin();
    showLogin({ note: "로그인 시간이 지났어요. 다시 시도해 주세요." });
  }, DESKTOP_WAIT_MS) };
  showGate("desktop-wait");
  setTimeout(() => $(".gate-title", pane("desktop-wait")).focus(), 0);
}

if (window.paperlabDesktop) {
  $("[data-desktop-reopen]", gate).onclick = () => startDesktopLogin(null, desktopWait ? desktopWait.selectAccount : false);
  $("[data-desktop-cancel]", gate).onclick = () => { endDesktopWait(); cancelDesktopLogin(); showLogin({ note: "로그인을 취소했어요." }); };
  window.paperlabDesktop.onAuthCallback(async (code, error) => {
    if (document.body.dataset.auth === "in") return; // 이미 로그인한 창은 무시
    endDesktopWait();
    if (!code) return showLogin(error === "access_denied" ? { note: "로그인을 취소했어요." } : { error: LOGIN_FAILED });
    bootScreen("로그인하는 중…");
    try {
      await authInitialized;
      await exchangeCode(code);
    } catch (e) {
      console.error(e);
      return showLogin({ error: LOGIN_FAILED });
    }
    boot({ retry: true });
  });
}

$("[data-google]", gate).onclick = (e) => startGoogle(e.currentTarget, false);
// 다른 계정으로: 구글 계정 고르기 창을 다시 띄운다 (안 그러면 같은 계정으로 돌아와 다시 거부될 수 있음)
$("[data-gate-switch]", gate).onclick = (e) => startGoogle(e.currentTarget, true);
// 승인 대기 화면: [다시 확인] = 처음부터 다시(승인됐으면 앱으로), [다른 계정으로 로그인] = 로그아웃 뒤 구글
$("[data-pending-check]", gate).onclick = () => boot();
$("[data-pending-out]", gate).onclick = async (e) => { await signOut(); startGoogle(e.currentTarget, true); };
// 구글 화면에서 뒤로 가기로 돌아오면(bfcache) 버튼을 원래대로
window.addEventListener("pageshow", (e) => { if (e.persisted) resetGoogleButtons(); });

$("[data-gate-retry]", gate).onclick = async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = "다시 연결하는 중…";
  try { await boot({ retry: true }); } finally {
    btn.disabled = false;
    btn.textContent = "다시 시도";
  }
};

// --------------------------------------------- 만료 · 허용 안 됨 · 로그아웃
const draftKey = (uid, mid) => `paperlab.draft.${uid}.${mid}`;

// 저장 못 한 원고를 이 브라우저에 보관 (시안 6.1 — 키에 user_id: 다른 사람이 로그인해도 남의 원고를 저장하지 않게)
function stashDrafts() {
  const d = unsavedDraft();
  const uid = state.user && state.user.user_id;
  if (!d || !uid) return false;
  try {
    localStorage.setItem(draftKey(uid, d.id), JSON.stringify({ title: d.title, content: d.content, saved_at: new Date().toISOString() }));
    return true;
  } catch { return false; }
}

// 다시 로그인(같은 user_id)하면 보관한 원고를 저장하고, 성공하면 지운다
async function restoreDrafts(uid) {
  const prefix = `paperlab.draft.${uid}.`;
  const keys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
  } catch { return; }
  let saved = 0;
  let failed = 0;
  for (const k of keys) {
    const mid = Number(k.slice(prefix.length));
    let d = null;
    try { d = JSON.parse(localStorage.getItem(k)); } catch { /* 깨진 값 */ }
    if (!mid || !d || typeof d.content !== "string") { localStorage.removeItem(k); continue; }
    try {
      await api.patch(`/api/manuscripts/${mid}`, { content: d.content });
      localStorage.removeItem(k);
      saved++;
    } catch (e) {
      if (e.status === 404) {
        localStorage.removeItem(k);
        toast(`보관해 둔 원고 ${josa(`‘${d.title || "제목 없는 원고"}’`, "은/는")} 이미 지워져서 저장하지 않았어요.`, "", { duration: 8000 });
      } else if (e.status === 401 || e.code === "not_allowed") {
        return; // 화면이 이미 로그인 · 거부 화면으로 바뀜
      } else {
        failed++;
      }
    }
  }
  if (saved) toast(saved > 1 ? `보관해 둔 원고 ${saved}개를 저장했어요` : "보관해 둔 원고를 저장했어요", "success");
  if (failed) toast("보관해 둔 원고를 아직 저장하지 못했어요. 이 브라우저에 그대로 두고 다음에 다시 저장할게요.", "error", { duration: 8000 });
}

// 로그인 화면 위에 떠 있을 창 · 메뉴 · 팝업을 닫는다
function closeOverlays() {
  closeMenus();
  $$(".modal-backdrop [data-close]").reverse().forEach((b) => b.click());
  $$("body > .sel-pop, body > .cite-picker, body > .cite-suggest").forEach((n) => n.remove());
  $("#drop-overlay").classList.add("hidden");
}

// D4: 토큰 갱신까지 실패 → 원고 보관 → 토스트 → 로그인 화면 (#app 내용은 지우지 않고 숨기기만)
function onExpired() {
  if (!authed) return;
  authed = false;
  setApiLive(false);
  const stashed = stashDrafts();
  closeOverlays();
  toast(EXPIRED);
  showLogin({ note: [EXPIRED, stashed ? DRAFT_NOTE : ""] });
  signOut();
}

// 쓰는 도중 허용 목록에서 빠짐 (403 not_allowed)
function onDenied() {
  if (!authed) return;
  authed = false;
  setApiLive(false);
  closeOverlays();
  showDenied((state.user && state.user.email) || "");
  signOut();
}

// 직접 로그아웃: 쓰던 원고 · 노트를 먼저 저장(보관하지 않음) → signOut → 상태 · 화면 비움
async function logout() {
  if (!authed) return;
  closeOverlays();
  await Promise.allSettled([flushWriter(), flushLibrary(), flushReader()]);
  if (!authed) return; // 저장하다 만료됨 → 만료 화면이 처리
  authed = false;
  setApiLive(false);
  stopSummaries();
  stopJobBadge();
  cancelUploads();
  await signOut();
  clearApp();
  showLogin({ note: "로그아웃했어요." });
}
actions.logout = logout;

function clearApp() {
  closeJobs();
  closeTrash();
  closeReader();
  closeWriter();
  resetGraphMemory(); // 다음 사용자에게 이전 계정의 그래프(서재 표시)가 남지 않게
  resetRefMemory(); // 참고 패널 추천 결과 · 진행 중인 추천(메모리만 — 1C 명세 9.8절)
  resetCiteCache(); // 내 스타일 목록 · 스타일 XML
  resetDiscover(); // 논문 찾기 검색어 · 결과
  resetState();
  main.innerHTML = "";
  for (const id of ["#collection-tree", "#folder-tree", "#tag-list"]) $(id).innerHTML = "";
  for (const node of $$("[data-count]")) node.textContent = "";
  $$("#sidebar .nav-item.active").forEach((b) => b.classList.remove("active"));
  drawMeter();
  drawAccount();
  $("#app").classList.remove("reading");
}

setApiHooks({ expired: onExpired, denied: onDenied, retry: () => { if (authed) { refreshAll(); loadUsage(); } } });

// ------------------------------------------------------------- 계정 (D3)
function drawAccount() {
  const u = state.user || { name: "", email: "" };
  for (const holder of [$("#account-btn .avatar"), $("#account-mini .avatar")]) holder.replaceWith(avatarEl(u));
  $("#account-btn .account-name").textContent = u.name || "";
}

function openAccountMenu(btn, e, left) {
  e.stopPropagation();
  if (btn.getAttribute("aria-expanded") === "true") return closeMenus();
  const u = state.user || {};
  const head = el(`<div class="account-menu-head"><span data-avatar></span>
    <div><div class="account-menu-name">${esc(u.name || "")}</div><div class="account-menu-email">${esc(u.email || "")}</div></div></div>`);
  $("[data-avatar]", head).replaceWith(avatarEl(u, true));
  btn.setAttribute("aria-expanded", "true");
  const items = [
    { label: "설정", action: () => settingsDialog() },
    { label: "로그아웃", action: logout },
  ];
  // 관리자: 가입 신청 관리 (2026-10-29 — 관리자 승인 가입)
  if (u.is_admin) items.unshift({ label: `가입 신청${state.accessPending ? ` (${state.accessPending})` : ""}`,
    sub: state.accessPending ? "승인 대기" : "", action: () => accessDialog({ onCount: (n) => { state.accessPending = n; } }) });
  // 좁은 화면(사이드바 숨김)에서는 "작업 (n)" · "AI 질문" 항목 (디자인 9.1, 3단계 팀장 결정 — 시안 8장)
  // 6단계 SW-1: 좁은 화면에서는 "휴지통 (n)"을 "작업" 다음에
  if (!left) items.unshift({ label: `휴지통${state.stats.trash ? ` (${state.stats.trash})` : ""}`, action: () => { location.hash = "#/trash"; } });
  if (!left) items.unshift({ label: `작업${state.stats.jobs ? ` (${state.stats.jobs})` : ""}`, action: () => { location.hash = "#/jobs"; } });
  if (!left) items.unshift({ label: "AI 질문", action: () => { location.hash = scopeHash(scopeFromFilter(state.filter)); } });
  const dk = window.paperlabDesktop;
  if (dk) items.unshift(desktopItem);
  btn.setAttribute("aria-expanded", "true");
  popupMenu(btn, items, { left, head, className: "account-menu", focus: e.detail === 0, onClose: () => btn.setAttribute("aria-expanded", "false") });
}

// 앱 창에서만: 계정 메뉴 맨 위 "이 PC 상태" (디자인 10장 — S11). info()는 비동기라 열기 전에 미리 받아 둔다
const desktopItem = { label: "이 PC 상태", sub: "", action: () => window.paperlabDesktop.openStatusWindow() };
async function refreshDesktopItem() {
  const dk = window.paperlabDesktop;
  if (!dk) return;
  let info = null;
  try { info = await dk.info(); } catch { info = null; }
  const mine = maskEmail((state.user || {}).email);
  desktopItem.sub = !info || !info.paired ? "연결 안 됨"
    : info.accountHint && info.accountHint !== mine ? "다른 계정에 연결됨"
      : info.workerState === "paused" ? "작업 받기 멈춤" : info.workerState === "update_required" ? "업데이트 필요"
        : info.workerState === "offline" ? "서버 연결 끊김" : `${info.deviceName || "이 PC"} · 연결됨`;
}

$("#account-btn").onmouseenter = refreshDesktopItem;
$("#account-btn").onfocus = refreshDesktopItem;
$("#account-btn").onclick = (e) => openAccountMenu(e.currentTarget, e, true);
// 좁은 화면 오른쪽 아래 버튼: 오른쪽 맞춤
$("#account-mini").onclick = (e) => openAccountMenu(e.currentTarget, e, false);
$("#open-settings").onclick = () => settingsDialog();
$("#open-palette").onclick = () => openPalette();

// -------------------------------------------------------- 저장 공간 (D14)
let meter = null;

async function loadUsage() {
  if (!authed) return null;
  let u = null;
  try { u = await api.get("/api/storage/usage"); } catch { /* 실패하면 숨김 */ }
  if (!authed) return null;
  state.usage = u;
  drawMeter();
  return u;
}
setUsageLoader(loadUsage);

// 사이드바 .sidebar-foot 바로 앞. 불러오기 전 · 실패 시에는 넣지 않는다
function drawMeter() {
  const u = authed ? state.usage : null;
  if (!u) {
    if (meter) meter.remove();
    return;
  }
  if (!meter) {
    meter = el(`<div class="storage-meter" data-storage data-level="ok">
      <div class="storage-meter-head"><span>저장 공간</span><span class="storage-meter-num" data-storage-text></span></div>
      <div class="usage-bar" role="meter" aria-label="저장 공간" aria-valuemin="0" aria-valuemax="100"><span></span></div>
      <div class="storage-meter-msg" data-storage-msg></div></div>`);
  }
  if (!meter.isConnected) $("#sidebar .sidebar-foot").before(meter);
  const x = usageInfo(u);
  const w = Math.min(100, x.pct);
  meter.dataset.level = x.level;
  meter.title = `모든 사용자가 함께 쓰는 저장 공간이에요 · 내 PDF ${x.mine}${x.trash ? ` · 휴지통 ${x.trash}` : ""}${u.local_bytes
    ? ` · PC에만 둔 파일 ${sizeText(u.local_bytes)}(서버 공간을 쓰지 않음)` : ""}`;
  $("[data-storage-text]", meter).textContent = `${x.used} / ${x.limit}`;
  const bar = $(".usage-bar", meter);
  bar.setAttribute("aria-valuenow", w);
  bar.setAttribute("aria-valuetext", `${x.limit} 중 ${x.used} 사용`);
  $("span", bar).style.width = `${w}%`;
  $("[data-storage-msg]", meter).textContent = x.level === "warn" ? `저장 공간 ${x.pct}% 사용 중`
    : x.level === "full" ? "PDF를 더 올릴 수 없어요" : "";
}

// ---------------------------------------------------------------- sidebar
async function loadSidebar(force = false) {
  if (!authed && !force) return;
  const [collections, folders, tags, stats] = await Promise.all([
    api.get("/api/collections"), api.get("/api/folders"), api.get("/api/tags"), api.get("/api/stats"),
  ]);
  if (!authed && !force) return;
  Object.assign(state, { collections, folders, tags, stats });
  renderSidebar();
  checkModeDone(stats); // 선택 동기화: 끄기 대기가 모두 끝났으면 "…에만 두었어요" 토스트 (10.5절)
}

function filterKey(f) {
  if (f.kind === "status") return `status:${f.id}`;
  return f.kind;
}

// 논문 행을 끌어다 놓을 수 있는 자리
function dropTarget(btn, onIds) {
  btn.ondragover = (e) => { if (e.dataTransfer.types.includes("application/x-paperlab-ids")) { e.preventDefault(); btn.classList.add("drop-target"); } };
  btn.ondragleave = () => btn.classList.remove("drop-target");
  btn.ondrop = async (e) => {
    e.preventDefault();
    btn.classList.remove("drop-target");
    const ids = JSON.parse(e.dataTransfer.getData("application/x-paperlab-ids") || "[]");
    if (!ids.length) return;
    try { await onIds(ids); } catch (err) { saveError(err); return; }
    refreshAll();
  };
}

function renderSidebar() {
  for (const node of $$("[data-count]")) {
    const v = state.stats[node.dataset.count];
    node.textContent = v ? v : "";
  }
  renderFolders();
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
          <span class="label" title="${esc(c.name)}">${esc(c.name)}</span><span class="count">${c.count || ""}</span></button>
        <span class="menu-wrap"><button class="icon-btn small row-menu" title="메뉴" aria-label="‘${esc(c.name)}’ 컬렉션 메뉴">⋯</button></span></div>`);
      const btn = $(".nav-item", row);
      btn.onclick = (e) => {
        if (e.target.classList.contains("toggle") && kids.length) {
          collapsed.has(c.id) ? collapsed.delete(c.id) : collapsed.add(c.id);
          saveSet(COLLAPSE_KEY, collapsed);
          return renderSidebar();
        }
        setFilter({ kind: "collection", id: c.id });
      };
      // 논문 행을 끌어다 놓으면 컬렉션에 추가
      dropTarget(btn, (ids) => api.post("/api/papers/bulk", { ids, action: "add_collection", value: c.id }));
      $(".row-menu", row).onclick = (e) => {
        e.stopPropagation();
        popupMenu(e.currentTarget, [
          { label: "하위 컬렉션 추가", action: () => newCollection(c.id) },
          { label: "이름 바꾸기", action: async () => {
            const name = await promptDialog("컬렉션 이름", { value: c.name });
            if (name) { try { await api.patch(`/api/collections/${c.id}`, { name }); refreshAll(); } catch (err) { saveError(err); } }
          } },
          ...(c.parent_id ? [{ label: "최상위로 옮기기", action: () => api.patch(`/api/collections/${c.id}`, { parent_id: null }).then(refreshAll, saveError) }] : []),
          "-",
          { label: "삭제 (논문은 남아요)", danger: true, action: async () => {
            if (!(await confirmDialog(`‘${c.name}’ 컬렉션과 하위 컬렉션을 삭제할까요? 논문 자체는 서재에 남아요.`, { ok: "삭제" }))) return;
            try { await api.del(`/api/collections/${c.id}`); } catch (err) { return saveError(err); }
            if (state.filter.kind === "collection" && state.filter.id === c.id) state.filter = { kind: "all", id: null };
            refreshAll();
          } },
        ], { left: true, focus: e.detail === 0 });
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
      <span class="tag-dot"${t.name === "충돌 사본" && !t.color ? ' data-tag-kind="conflict"' : ""} style="${t.color ? `background:${esc(t.color)}` : ""}"></span><span class="label" title="${esc(t.name)}">${esc(t.name)}</span><span class="count">${t.count || ""}</span></button>
      <span class="menu-wrap"><button class="icon-btn small row-menu" title="메뉴" aria-label="‘${esc(t.name)}’ 태그 메뉴">⋯</button></span></div>`);
    $(".nav-item", row).onclick = () => setFilter({ kind: "tag", id: t.id });
    $(".row-menu", row).onclick = (e) => {
      e.stopPropagation();
      const colors = [["", "기본"], ["#e03131", "빨강"], ["#f08c00", "주황"], ["#2f9e44", "초록"], ["#1971c2", "파랑"], ["#9c36b5", "보라"]];
      popupMenu(e.currentTarget, [
        { label: "이름 바꾸기", action: async () => {
          const name = await promptDialog("태그 이름", { value: t.name });
          if (name) { try { await api.patch(`/api/tags/${t.id}`, { name }); refreshAll(); } catch (err) { saveError(err); } }
        } },
        ...colors.map(([c, n]) => ({ label: `색: ${n}`, action: () => api.patch(`/api/tags/${t.id}`, { color: c }).then(refreshAll, saveError) })),
        "-",
        { label: "태그 삭제", danger: true, action: async () => {
          if (!(await confirmDialog(`‘${t.name}’ 태그를 모든 논문에서 지울까요?`, { ok: "삭제" }))) return;
          try { await api.del(`/api/tags/${t.id}`); } catch (err) { return saveError(err); }
          if (state.filter.kind === "tag" && state.filter.id === t.id) state.filter = { kind: "all", id: null };
          refreshAll();
        } },
      ], { left: true, focus: e.detail === 0 });
    };
    tagBox.appendChild(row);
  }
  if (!state.tags.length) tagBox.appendChild(el(`<div class="empty-hint">논문에 태그를 달면 여기에 보여요</div>`));
}

// ------------------------------------------------------------ 폴더 (D8)
function renderFolders() {
  const tree = $("#folder-tree");
  tree.innerHTML = "";
  const byParent = new Map();
  for (const f of state.folders) {
    const k = f.parent_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(f);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const build = (parentId, container) => {
    for (const f of byParent.get(parentId) || []) {
      const kids = byParent.get(f.id) || [];
      const open = kids.length && !folderCollapsed.has(f.id);
      const isActive = state.view === "library" && state.filter.kind === "folder" && state.filter.id === f.id;
      const mark = folderMark(f); // 실효 끔(PC에만) 폴더: 이름 뒤 작은 PC 표 (선택 동기화 10.2절)
      const row = el(`<div class="tree-row folder-row">
        ${kids.length ? `<button class="tree-toggle" aria-expanded="${open ? "true" : "false"}" aria-label="‘${esc(f.name)}’ 하위 폴더 ${open ? "접기" : "펼치기"}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>`
          : `<span class="tree-toggle-spacer"></span>`}
        <button class="nav-item ${isActive ? "active" : ""}" data-fid="${f.id}">${folderIcon()}<span class="label" title="${esc(f.name)}">${esc(f.name)}</span>${mark
          ? `<span class="folder-pc"${mark.own ? " data-own" : ""} title="${esc(mark.title)}" aria-label="${esc(mark.title)}">${esc(mark.text)}</span>` : ""}<span class="count">${f.count || ""}</span></button>
        <span class="menu-wrap"><button class="icon-btn small row-menu" title="메뉴" aria-label="‘${esc(f.name)}’ 폴더 메뉴">⋯</button></span></div>`);
      const toggle = $(".tree-toggle", row);
      if (toggle) toggle.onclick = () => {
        folderCollapsed.has(f.id) ? folderCollapsed.delete(f.id) : folderCollapsed.add(f.id);
        saveSet(FOLDER_COLLAPSE_KEY, folderCollapsed);
        renderSidebar();
        const again = $(`#folder-tree .nav-item[data-fid="${f.id}"]`);
        const t = again && again.parentElement.querySelector(".tree-toggle");
        if (t) t.focus();
      };
      const btn = $(".nav-item", row);
      btn.onclick = () => setFilter({ kind: "folder", id: f.id });
      dropTarget(btn, async (ids) => {
        await api.post("/api/papers/bulk", { ids, action: "move_folder", value: f.id });
        movedToast(ids, f.id); // 저장 위치가 폴더 설정과 달라지면 [폴더 설정대로 맞추기]
      });
      $(".row-menu", row).onclick = (e) => {
        e.stopPropagation();
        // 선택 동기화 켜고 끄기 (10.3절 — 폴더 동기화를 켠 PC가 하나라도 있을 때만)
        const sync = folderMenu(f, { syncOn: !!(state.stats && state.stats.sync_on) })
          .map((it) => ({ label: it.label, action: () => syncModeDialog({ folder: f, mode: it.mode, target: { type: "folder", name: f.name } }) }));
        popupMenu(e.currentTarget, [
          { label: "하위 폴더 만들기", action: () => newFolder(f.id) },
          { label: "이름 바꾸기", action: () => renameFolder(f) },
          { label: "옮기기…", action: () => moveFolder(f) },
          ...(sync.length ? ["-", ...sync] : []),
          "-",
          { label: "삭제 (논문은 남아요)", danger: true, action: () => deleteFolder(f, kids.length) },
        ], { left: true, focus: e.detail === 0 });
      };
      container.appendChild(row);
      if (open) {
        const sub = el(`<div class="tree-children"></div>`);
        build(f.id, sub);
        container.appendChild(sub);
      }
    }
  };
  build(0, tree);
  if (!state.folders.length) {
    tree.appendChild(el(`<div class="empty-hint">＋를 눌러 논문 파일을 정리할 폴더를 만들어 보세요</div>`));
    if (state.filter.kind === "no_folder") state.filter = { kind: "all", id: null };
    return;
  }
  // 폴더가 1개 이상일 때만 "폴더 없음"
  const inFolders = state.folders.reduce((n, f) => n + (f.count || 0), 0);
  const none = Math.max(0, (state.stats.total || 0) - inFolders);
  const row = el(`<div class="tree-row folder-row"><span class="tree-toggle-spacer"></span>
    <button class="nav-item" data-filter="no_folder">${folderIcon(true)}<span class="label">폴더 없음</span><span class="count">${none || ""}</span></button></div>`);
  const btn = $(".nav-item", row);
  btn.onclick = () => setFilter({ kind: "no_folder", id: null });
  dropTarget(btn, async (ids) => {
    await api.post("/api/papers/bulk", { ids, action: "move_folder", value: null });
    movedToast(ids, null);
  });
  tree.appendChild(row);
}

async function newFolder(parentId = null) {
  const name = await promptDialog(parentId ? "하위 폴더 이름" : "새 폴더 이름",
    parentId ? {} : { placeholder: "예: 2장 선행연구, 학회 발표 자료" });
  if (!name) return;
  try {
    const { id } = await api.post("/api/folders", { name, parent_id: parentId });
    if (parentId) { folderCollapsed.delete(parentId); saveSet(FOLDER_COLLAPSE_KEY, folderCollapsed); }
    state.filter = { kind: "folder", id };
    state.selected.clear();
    location.hash = "#/library";
    await refreshAll();
  } catch (e) { errorToast(e); }
}

async function renameFolder(f) {
  const name = await promptDialog("폴더 이름", { value: f.name });
  if (!name || name === f.name) return;
  try { await api.patch(`/api/folders/${f.id}`, { name }); refreshAll(); } catch (e) { saveError(e); }
}

async function moveFolder(f) {
  const r = await folderPickDialog({
    title: `‘${f.name}’ 폴더 옮기기`, current: f.parent_id ?? null, firstLabel: "맨 위 (상위 폴더 없음)", disabled: folderSubtree(f.id),
  });
  if (!r) return;
  try {
    await api.patch(`/api/folders/${f.id}`, { parent_id: r.value });
    if (r.value) { folderCollapsed.delete(r.value); saveSet(FOLDER_COLLAPSE_KEY, folderCollapsed); }
    toast(`‘${f.name}’ 폴더를 옮겼어요`);
    refreshAll();
  } catch (e) { saveError(e); }
}

async function deleteFolder(f, kidCount) {
  const top = !f.parent_id;
  const n = f.count || 0;
  let msg;
  if (!n && !kidCount) msg = `‘${f.name}’ 폴더를 삭제할까요? 빈 폴더예요.`;
  else {
    const what = n && kidCount ? `안의 논문 ${n}편과 하위 폴더는` : n ? `안의 논문 ${n}편은` : "하위 폴더는";
    msg = `‘${f.name}’ 폴더를 삭제할까요? ${what} ${top ? "폴더 밖으로" : "상위 폴더로"} 옮겨져요.`;
  }
  // 6단계 9장: 폴더 동기화를 켠 PC가 있으면 한 줄 더
  if (state.stats && state.stats.sync_on) {
    msg += ` 폴더 동기화를 쓰는 PC에서도 같은 폴더가 없어지고 파일은 ${top ? "동기화 폴더 맨 위로" : "위 폴더로"} 옮겨져요.`;
  }
  if (!(await confirmDialog(msg, { ok: "삭제", danger: true }))) return;
  try {
    const r = await api.del(`/api/folders/${f.id}`);
    // 0인 항목은 빼고, 조사는 마지막 낱말에 맞춘다 (…편은 / …개는)
    const parts = [];
    if (r.moved_papers) parts.push(`논문 ${r.moved_papers}편`);
    if (r.moved_folders) parts.push(`하위 폴더 ${r.moved_folders}개`);
    const topic = parts.join("과 ") + (r.moved_folders ? "는" : "은");
    toast(parts.length ? `폴더를 지웠어요 · ${topic} ${top ? "폴더 밖으로" : "상위 폴더로"} 옮겼어요` : "폴더를 지웠어요");
    if (state.filter.kind === "folder" && state.filter.id === f.id) state.filter = { kind: "all", id: null };
    refreshAll();
  } catch (e) { saveError(e); }
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
  if (!authed) return;
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
// AI 질문: 서재에서 컬렉션 · 폴더를 고른 상태면 그 범위로 (3단계 시안 2.2절)
$$("#sidebar .nav-item[data-view]").forEach((b) => (b.onclick = () => {
  location.hash = b.dataset.view === "ask" ? scopeHash(scopeFromFilter(state.filter)) : `#/${b.dataset.view}`;
}));
$("#add-collection").onclick = () => newCollection();
$("#add-folder").onclick = () => newFolder();

// ----------------------------------------------------------------- router
async function route() {
  if (!authed) return; // 로그인 전 · 로그아웃 뒤(뒤로 가기)에는 아무것도 그리지 않음
  const hash = location.hash || "#/library";
  const app = $("#app");
  const m = hash.match(/^#\/read\/(\d+)(?:\/p(\d+))?/);
  if (!hash.startsWith("#/write")) closeWriter();
  if (!hash.startsWith("#/ask")) closeAsk();
  if (!hash.startsWith("#/jobs")) closeJobs();
  if (!hash.startsWith("#/trash")) closeTrash();
  if (!/^#\/graph(\/|$)/.test(hash)) closeGraph();
  if (m) {
    state.view = "reader";
    app.classList.add("reading");
    renderSidebar();
    return openReader(main, Number(m[1]), m[2] ? Number(m[2]) : null);
  }
  closeReader();
  if (hash.startsWith("#/jobs")) {
    app.classList.remove("reading");
    state.view = "jobs";
    renderSidebar();
    return renderJobs(main);
  }
  if (hash.startsWith("#/trash")) { // 6단계 휴지통 (SW-1)
    app.classList.remove("reading");
    state.view = "trash";
    renderSidebar();
    return renderTrash(main);
  }
  if (/^#\/graph(\/|$)/.test(hash)) {
    // 인용 그래프: 읽기 화면처럼 사이드바를 숨기고 전체 폭 (디자인 GD-1). 사이드바 메뉴 항목은 없음(K-12)
    state.view = "graph";
    app.classList.add("reading");
    renderSidebar();
    return renderGraph(main);
  }
  const w = hash.match(/^#\/write(?:\/(\d+))?/);
  if (w) {
    state.view = "write";
    app.classList.toggle("reading", !!w[1]);
    renderSidebar();
    return w[1] ? openManuscript(main, Number(w[1])) : renderWriteList(main);
  }
  app.classList.remove("reading");
  if (hash.startsWith("#/ask")) {
    state.view = "ask";
    renderSidebar();
    return renderAsk(main);
  }
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

onRefresh(() => loadSidebar());
onRefresh(async () => { if (authed && state.view === "library") await loadPapers(); });

// 파일 끌어다 놓기 (서재 화면 어디든 — PDF · 워드 · 한글 · PPT · 엑셀 · 사진, uploadPdfs가 거름) — 로그인한 뒤에만.
// 쓰기 화면은 예전처럼 .docx · .hwpx를 인용 넣기(composeDialog)로
let dragDepth = 0;
const isFileDrag = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
const signedIn = () => document.body.dataset.auth === "in";
window.addEventListener("dragenter", (e) => {
  if (!signedIn() || !isFileDrag(e) || state.view === "reader" || state.view === "graph" || /^#\/write\/\d/.test(location.hash)) return;
  dragDepth++;
  $("#drop-overlay div").textContent = state.view === "write" ? "워드·한글 문서를 놓으면 인용을 넣어 드려요" : "PDF · 워드 · 한글 · 사진 파일을 놓으면 서재에 추가돼요";
  $("#drop-overlay").classList.remove("hidden");
});
window.addEventListener("dragleave", (e) => { if (isFileDrag(e) && --dragDepth <= 0) { dragDepth = 0; $("#drop-overlay").classList.add("hidden"); } });
window.addEventListener("dragover", (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener("drop", (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").classList.add("hidden");
  if (!signedIn() || state.view === "reader" || state.view === "graph") return;
  const files = [...e.dataTransfer.files];
  if (state.view === "write") {
    const doc = files.find((f) => /\.(docx|hwpx)$/i.test(f.name));
    if (doc) composeDialog(doc);
    else toast("워드(.docx)나 한글(.hwpx) 문서를 놓으면 인용을 넣어 드려요");
    return;
  }
  uploadPdfs(files);
});

// 단축키: / 검색, Esc는 각 화면/모달이 처리
window.addEventListener("keydown", (e) => {
  if (!signedIn() || modalOpen()) return;
  // 명령 팔레트 (2026-10-28): 입력 중에도 — 다시 누르면 닫힘
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "k" || e.key === "K" || e.code === "KeyK")) {
    e.preventDefault();
    openPalette();
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if (e.key === "/" && !typing) {
    const box = $("#main .searchbox input");
    if (box) { e.preventDefault(); box.focus(); box.select(); }
  }
});

// 업로드가 진행 중이면 탭을 닫기 전에 브라우저 확인 창 (문구는 브라우저가 정함). 요약은 서버 작업이라 탭을 닫아도 계속(2단계 U8)
window.addEventListener("beforeunload", (e) => {
  if (uploadsRunning()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// 외부 스크립트(supabase-js · KaTeX · marked)가 defer로 로드된 뒤 시작
if (document.readyState === "complete") boot(); else window.addEventListener("load", () => boot());
