'use strict';
// 앱 창 구글 로그인 (명세 13.4 ① — 시스템 브라우저 + paperlab:// 딥 링크 + PKCE, K10).
// 화면이 supabase-js 로 받은 인증 주소를 main 이 검사(Supabase 출처의 /auth/v1/authorize)한 뒤 시스템 브라우저로 연다.
// Supabase 가 paperlab://auth-callback?code=… 로 돌려보내면 Windows 가 앱을 다시 부르고, 단일 인스턴스 잠금의
// second-instance 로 받은 주소에서 code 만 꺼내 화면에 넘긴다(PKCE 검증자는 앱 창 저장소에 있어 다른 앱이 가로채도 쓸모없음).

const PROTOCOL = 'paperlab';
const CODE_RE = /^[A-Za-z0-9._~-]{8,512}$/;
const LOGIN_WAIT_MS = 15 * 60 * 1000;

function isAuthorizeUrl(url, supabaseUrl) {
  let u;
  let base;
  try { u = new URL(url); base = new URL(supabaseUrl); } catch { return false; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) return false;
  return u.origin === base.origin && u.pathname === '/auth/v1/authorize' && !u.username && !u.password;
}

/** paperlab://auth-callback?code=… → {code, error} | null */
function parseCallback(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== `${PROTOCOL}:` || u.hostname !== 'auth-callback') return null;
  const code = u.searchParams.get('code') || '';
  if (code && CODE_RE.test(code)) return { code, error: '' };
  const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
  const error = u.searchParams.get('error') || hash.get('error') || 'invalid_callback';
  return { code: '', error: error.slice(0, 80) };
}

/** 프로세스 인자에서 딥 링크 찾기 (두 번째 실행 · 처음 실행 둘 다) */
function findDeepLink(argv) {
  return (argv || []).find((a) => typeof a === 'string' && a.toLowerCase().startsWith(`${PROTOCOL}://`)) || null;
}

module.exports = { isAuthorizeUrl, parseCallback, findDeepLink, LOGIN_WAIT_MS };
