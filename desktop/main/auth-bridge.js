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

const isLinkArg = (a) => typeof a === 'string' && a.toLowerCase().startsWith(`${PROTOCOL}://`);

/** 프로세스 인자에서 딥 링크 찾기 (두 번째 실행 · 처음 실행 둘 다). paperlab:// 인자가 꼭 하나일 때만(둘 이상 · 너무 김 → null) */
function findDeepLink(argv) {
  const links = (argv || []).filter(isLinkArg);
  return links.length === 1 && links[0].length <= 4096 ? links[0] : null;
}

/** 실행 스위치(--hidden 등): 딥 링크 · "--" 앞의 것만 읽고 그 뒤는 무시(주소에 스위치를 끼워 넣는 것 막기) */
function launchSwitches(argv) {
  const out = [];
  for (const a of (argv || []).slice(1)) {
    if (a === '--' || isLinkArg(a)) break;
    if (typeof a === 'string' && a.startsWith('--')) out.push(a);
  }
  return out;
}

/**
 * paperlab:// 를 이 실행 파일에 등록(HKCU\Software\Classes\paperlab — 사용자별, 관리자 권한 없음). electron-builder NSIS 는 protocols 를
 * 등록하지 않아 앱이 시작할 때마다 직접 한다(같은 값이면 그대로). 명령은 "PaperLab.exe" -- "%1": "--" 뒤라 주소에 따옴표 · 스위치를 끼워
 * 넣어도 Chromium 스위치로 읽히지 않음(Electron 의 CVE-2018-1000006 권고 — Electron 도 주소 뒤 인자가 있으면 시작하지 않음).
 * 개발 실행은 건너뜀(이 PC 레지스트리를 바꾸지 않음 — 개발 실행의 앱 창 로그인은 README 참고). 제거할 때 지우기는 build/installer.nsh.
 */
function registerProtocol(app, execPath = process.execPath) {
  if (!app.isPackaged) return false;
  return app.setAsDefaultProtocolClient(PROTOCOL, execPath, ['--']) === true;
}

module.exports = { isAuthorizeUrl, parseCallback, findDeepLink, launchSwitches, registerProtocol, LOGIN_WAIT_MS, PROTOCOL };
