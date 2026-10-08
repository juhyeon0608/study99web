// 로그인 · 세션 · 토큰 (Supabase Auth, 구글 로그인만 — 명세 6.2 · 6.6)
// supabase-js는 vendor/supabase/supabase.js(UMD, window.supabase)를 index.html에서 먼저 불러 둔다

let client = null;
let refreshing = null;

const lib = () => window.supabase;

// 일시적인 실패(네트워크 · 5xx)인지: 이때는 "만료"로 보지 않는다
export function isRetryable(err) {
  if (!err) return false;
  const l = lib();
  if (l && typeof l.isAuthRetryableFetchError === "function" && l.isAuthRetryableFetchError(err)) return true;
  return Number(err.status) >= 500 || err.name === "TypeError";
}

// GET /api/public-config 값으로 클라이언트를 한 번만 만든다
export function initAuth({ supabase_url: url, supabase_anon_key: key }) {
  if (client) return client;
  const l = lib();
  if (!l || typeof l.createClient !== "function") throw new Error("로그인 모듈을 불러오지 못했어요");
  if (!url || !key) throw new Error("로그인 설정이 비어 있어요");
  client = l.createClient(url, key, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export const authReady = () => !!client;

// 구글에서 돌아온 주소(?code=)인지
export function hasAuthCode() {
  return new URL(location.href).searchParams.has("code");
}

// 시작할 때: ?code= 를 세션으로 바꾸는 것까지 기다린 뒤 지금 세션을 돌려준다
export async function startSession() {
  let error = null;
  try { ({ error } = await client.auth.initialize()); } catch (e) { error = e; }
  // 바꾸기에 실패했으면 주소에 남은 code를 지운다 (성공하면 supabase-js가 지운다)
  if (hasAuthCode()) {
    const u = new URL(location.href);
    u.searchParams.delete("code");
    history.replaceState(history.state, "", u.toString());
  }
  const { data, error: e2 } = await client.auth.getSession();
  const err = error || e2 || null;
  return { session: data ? data.session : null, error: err, retryable: isRetryable(err) };
}

// 구글이 돌려보낸 오류(쿼리 · #조각 둘 다)를 읽고 주소에서 지운다. 없으면 null
export function takeRedirectError() {
  const url = new URL(location.href);
  const hash = url.hash.replace(/^#/, "");
  const fromHash = /(^|&)(error|error_code|error_description)=/.test(hash) ? new URLSearchParams(hash) : null;
  const pick = (k) => url.searchParams.get(k) || (fromHash && fromHash.get(k)) || "";
  const err = { error: pick("error"), code: pick("error_code"), description: pick("error_description") };
  if (!err.error && !err.code && !err.description) return null;
  for (const k of ["error", "error_code", "error_description"]) url.searchParams.delete(k);
  if (fromHash) url.hash = "";
  history.replaceState(history.state, "", url.toString());
  // 허용 목록 Auth Hook 거부: 설명에 "not_allowed"가 들어 있다 (마이그레이션 …_auth_hook.sql)
  err.notAllowed = /not_allowed/i.test(`${err.error} ${err.code} ${err.description}`);
  err.cancelled = !err.notAllowed && err.error === "access_denied";
  return err;
}

// 요청마다 최신 access token (supabase-js가 만료 전에 알아서 갱신)
export async function accessToken() {
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    return (data && data.session && data.session.access_token) || null;
  } catch {
    return null;
  }
}

// 401을 받았을 때 한 번: { token } | { expired: true } | { network: true }
export function refreshToken() {
  if (!client) return Promise.resolve({ expired: true });
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const { data, error } = await client.auth.refreshSession();
        if (data && data.session) return { token: data.session.access_token };
        return isRetryable(error) ? { network: true } : { expired: true };
      } catch (e) {
        return isRetryable(e) ? { network: true } : { expired: true };
      } finally {
        setTimeout(() => { refreshing = null; }, 0);
      }
    })();
  }
  return refreshing;
}

// 구글 로그인: 이 페이지를 떠난다. selectAccount면 구글 계정 고르기 창을 다시 띄운다
export async function signInWithGoogle({ selectAccount = false } = {}) {
  const options = { redirectTo: location.origin + "/" };
  if (selectAccount) options.queryParams = { prompt: "select_account" };
  const { error } = await client.auth.signInWithOAuth({ provider: "google", options });
  if (error) throw error;
}

// PaperLab PC 앱 창: 앱 안에서는 구글 로그인을 하지 않는다(구글이 막음) — 인증 주소만 받아 시스템 브라우저로 넘기고,
// 돌아온 paperlab://auth-callback?code= 를 이 창에서 세션으로 바꾼다. PKCE 검증자는 이 창 저장소에 있다 (2단계 명세 13.4 ①)
export async function googleAuthUrl({ selectAccount = false } = {}) {
  const options = { redirectTo: "paperlab://auth-callback", skipBrowserRedirect: true };
  if (selectAccount) options.queryParams = { prompt: "select_account" };
  const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options });
  if (error) throw error;
  return data.url;
}

export async function exchangeCode(code) {
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) throw error;
}

// 개발 서버 전용(public-config.dev_email_login): 테스트 프로젝트 이메일 · 비밀번호 로그인. 운영에서는 부르지 않는다
export async function signInWithPassword(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

// 이 브라우저의 세션만 끝낸다 (다른 기기 세션은 그대로 — 명세 6.6)
export async function signOut() {
  if (!client) return;
  try { await client.auth.signOut({ scope: "local" }); } catch { /* 이미 끝난 세션 */ }
}

// 세션의 사용자(프로필 사진 등 user_metadata)
export async function sessionUser() {
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    return (data && data.session && data.session.user) || null;
  } catch {
    return null;
  }
}
