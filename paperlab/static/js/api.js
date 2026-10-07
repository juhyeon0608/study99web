// 서버 API 호출 도우미: Bearer 토큰 · 401 갱신 · 만료/허용 안 됨/503 처리 · 위쪽 알림 띠 (명세 6.5~6.6, 시안 4.2 · 5장)

import { accessToken, refreshToken } from "./auth.js";

// 원래 오래 걸리는 요청: 3초 넘어도 "서버에 연결하는 중" 띠를 띄우지 않는다
// (PDF 추출 · URL에서 받기 · compose · 워드/한글 내보내기 · 외부 학술 DB 조회)
const LONG_RE = /^\/api\/(uploads\/[^/]+\/complete|papers\/\d+\/(pdf\/complete|fetch-pdf|refresh|related)|compose\/|export-document|search|related|resolve)\b/;

let live = false; // 로그인을 마치고 화면을 쓰는 중인지 (시작 중에는 띠 · 만료 처리 대신 오류를 그대로 던진다)
const hooks = { expired: null, denied: null, retry: null };

export function setApiLive(on) {
  live = on;
  if (!on) banner.hide();
}

export function setApiHooks(h) {
  Object.assign(hooks, h);
}

// status · code(서버 본문의 code) · network(응답을 못 받음) · quiet(알림 띠 · 만료 화면이 이미 알렸으니 토스트 생략)
export class ApiError extends Error {
  constructor(message, { status = 0, code = "", network = false, quiet = false } = {}) {
    super(message);
    this.name = "ApiError";
    Object.assign(this, { status, code, network, quiet });
  }
}

// ------------------------------------------------------------ 알림 띠 (#app-banner)
const BANNER_TEXT = {
  wake: "서버에 연결하는 중…",
  paused: "서비스가 잠시 멈춰 있어요. 관리자에게 알려 주세요.",
  offline: "인터넷 연결이 끊겼어요. 연결되면 다시 시도해 주세요.",
};

const banner = {
  kind: null,
  slow: 0,
  show(kind) {
    const b = document.getElementById("app-banner");
    if (!b) return;
    if (kind === "wake" && (this.kind === "paused" || this.kind === "offline")) return; // 오류 띠가 먼저
    this.kind = kind;
    b.dataset.kind = kind;
    b.setAttribute("role", kind === "wake" ? "status" : "alert");
    b.querySelector(".spinner").classList.toggle("hidden", kind !== "wake");
    b.querySelector("svg.ico").classList.toggle("hidden", kind === "wake");
    b.querySelector(".app-banner-text").textContent = BANNER_TEXT[kind];
    b.querySelector("[data-banner-retry]").classList.toggle("hidden", kind === "wake");
    b.classList.remove("hidden");
  },
  // 종류를 주면 그 종류일 때만 숨긴다
  hide(...kinds) {
    if (!this.kind || (kinds.length && !kinds.includes(this.kind))) return;
    this.kind = null;
    const b = document.getElementById("app-banner");
    if (b) b.classList.add("hidden");
  },
  slowStart() {
    this.slow++;
    this.show("wake");
  },
  slowEnd() {
    this.slow = Math.max(0, this.slow - 1);
    if (!this.slow) this.hide("wake");
  },
};

document.addEventListener("click", (e) => {
  if (!e.target.closest("#app-banner [data-banner-retry]")) return;
  banner.hide();
  if (hooks.retry) hooks.retry();
});
window.addEventListener("online", () => banner.hide("offline"));

// ------------------------------------------------------------------ 보내기
async function send(url, init, long) {
  let slow = false;
  const timer = live && !long ? setTimeout(() => { slow = true; banner.slowStart(); }, 3000) : null;
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    if (live) banner.show("offline");
    throw new ApiError(navigator.onLine === false ? "인터넷에 연결되지 않았어요" : "서버에 연결하지 못했어요",
      { network: true, quiet: live });
  } finally {
    clearTimeout(timer);
    if (slow) banner.slowEnd();
  }
}

// 토큰을 붙여 보내고, 401이면 토큰을 한 번 갱신해 같은 요청을 한 번만 다시 보낸다
async function authedFetch(url, init = {}, { long = false } = {}) {
  long = long || LONG_RE.test(url);
  // 쓰기 요청을 이 화면에서 보냈다는 표시 (서버가 다른 사이트의 요청을 막는 데 쓴다)
  const headers = { ...(init.headers || {}), "X-PaperLab": "1" };
  const go = async () => {
    const token = await accessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    else delete headers.Authorization;
    return send(url, { ...init, headers }, long);
  };
  let res = await go();
  if (res.status === 401) {
    const r = await refreshToken();
    if (r.network) {
      if (live) banner.show("offline");
      throw new ApiError("서버에 연결하지 못했어요", { network: true, quiet: live });
    }
    if (r.token) res = await go();
    if (res.status === 401) {
      // 만료 · 거부는 로그인 화면이 알리므로 토스트는 늘 생략 (시작 중에는 app.js가 직접 처리)
      if (live && hooks.expired) hooks.expired();
      throw new ApiError("로그인이 만료됐어요. 다시 로그인해 주세요.", { status: 401, code: "auth_required", quiet: true });
    }
  }
  if (res.status === 403 || res.status === 503) {
    const body = await res.clone().json().catch(() => null);
    const code = (body && body.code) || "";
    if (code === "not_allowed") {
      if (live && hooks.denied) hooks.denied();
      throw new ApiError(body.detail || "허용되지 않은 계정이에요", { status: 403, code, quiet: true });
    }
    if (code === "db_unavailable") {
      if (live) banner.show("paused");
      throw new ApiError(body.detail || "데이터베이스에 연결할 수 없어요", { status: 503, code, quiet: live });
    }
  }
  if (res.ok) banner.hide("paused", "offline");
  return res;
}

async function request(method, url, body, opts = {}) {
  const init = { method, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await authedFetch(url, init, opts);
  if (opts.raw) return res;
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 409 && opts.allowConflict) return { conflict: true, ...data };
    const detail = data && data.detail ? data.detail : (typeof data === "string" && data) || `오류 (${res.status})`;
    const msg = Array.isArray(detail) ? detail.map((d) => d.msg).join(", ") : String(detail);
    throw new ApiError(msg, { status: res.status, code: (data && data.code) || "" });
  }
  return data;
}

export const api = {
  get: (url, opts) => request("GET", url, undefined, opts),
  post: (url, body, opts) => request("POST", url, body, opts),
  put: (url, body) => request("PUT", url, body),
  patch: (url, body) => request("PATCH", url, body),
  del: (url) => request("DELETE", url),
  raw: (method, url, body) => request(method, url, body, { raw: true }),
};

export function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// 서버가 보내는 text/event-stream을 읽어 이벤트마다 콜백을 부른다 (토큰은 시작할 때만 검사 — 명세 6.6)
export async function streamEvents(url, body, onEvent, signal) {
  const res = await authedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }, { long: true });
  if (!res.ok) {
    let msg = `오류 (${res.status})`;
    let code = "";
    try {
      const b = await res.json();
      msg = b.detail || msg;
      code = b.code || "";
    } catch { /* 본문 없음 */ }
    throw new ApiError(msg, { status: res.status, code });
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
      }
    }
  }
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// 파일 이름에 쓸 수 없는 글자를 빼고 줄인다
export function safeFilename(name, fallback = "paper") {
  const s = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return s || fallback;
}
