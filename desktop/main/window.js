'use strict';
// 앱 창 · 이 PC 상태 창 · app:// 로컬 화면 (명세 13.2 · 13.2.1 · 13.6, 디자인 11.1).
// 보안: contextIsolation · sandbox · nodeIntegration 끔 · webview 없음, 새 창은 늘 deny(외부 링크 규칙을 통과하면 시스템 브라우저),
// 앱 창은 서버 출처 밖으로 이동하지 않음(will-navigate · will-redirect), 다른 출처 iframe 금지(will-frame-navigate),
// 권한은 클립보드 쓰기만, 로컬 화면에는 엄격한 CSP.

const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, shell, protocol, screen } = require('electron');
const { decideExternal, schemeOf, originOf } = require('./links');

const PARTITION = 'persist:paperlab';
const EXTRACT_PARTITION = 'paperlab-extract'; // 로컬 PDF 본문 추출 창 전용(메모리 세션 — 선택 동기화 9.4절)
const UI_DIR = path.join(__dirname, '..', 'ui');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const LOCAL_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const EXTRACT_CSP = `${LOCAL_CSP}; worker-src 'self'`; // extract.html 만 — PDF.js 작업자(app://ui/vendor/pdf.worker.min.mjs)
const UI_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
// 평평한 app://ui/이름.(html|js|css|svg) 밖에 허용하는 것은 정확히 이 두 경로(PDF.js — 빌드가 서버 static/vendor/pdfjs 에서 복사, copy-vendor.js)
const VENDOR_FILES = new Set(['vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs']);
const EXTRACT_FILES = new Set(['extract.html', 'extract.js', ...VENDOR_FILES]);
const WEB_PREFS = {
  preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false, webviewTag: false, spellcheck: false, navigateOnDragDrop: false, safeDialogs: true,
};

function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);
}

/** app://ui/<이름>.<확장자> → ui 폴더 안 파일(하위 폴더 · .. 없음) + 정확히 두 vendor 경로(PDF.js) */
function uiFile(requestUrl) {
  let u;
  try { u = new URL(requestUrl); } catch { return null; }
  if (u.protocol !== 'app:' || u.host !== 'ui') return null;
  const rel = u.pathname.replace(/^\/+/, '');
  if (VENDOR_FILES.has(rel)) return path.join(UI_DIR, ...rel.split('/'));
  if (!/^[A-Za-z0-9_-]+\.(html|js|css|svg)$/.test(rel)) return null;
  return path.join(UI_DIR, rel);
}

/** 추출 세션에서 내주는 파일: extract.html · extract.js · PDF.js 두 파일뿐 */
function extractFile(requestUrl) {
  const file = uiFile(requestUrl);
  if (!file) return null;
  const rel = new URL(requestUrl).pathname.replace(/^\/+/, '');
  return EXTRACT_FILES.has(rel) ? file : null;
}

function serveApp(ses, pick, cspFor) {
  ses.protocol.handle('app', async (req) => {
    const file = pick(req.url);
    if (!file) return new Response('not found', { status: 404 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { 'content-type': UI_TYPES[path.extname(file)], 'content-security-policy': cspFor(file),
        'x-content-type-options': 'nosniff', 'cache-control': 'no-store' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

/**
 * 세션 하나 준비: app:// 처리기 + 권한(클립보드 쓰기 · 서버 화면의 알림만).
 * 알림(notifications): AI 작업이 끝나면 Windows 알림을 띄우게 서버 주소(serverOrigin)의 화면에만 허용 (2026-10-17 — 0.4.0)
 */
function prepareSession(ses, serverOrigin = null) {
  serveApp(ses, uiFile, () => LOCAL_CSP);
  const allowed = (permission, url) => permission === 'clipboard-sanitized-write'
    || (permission === 'notifications' && !!serverOrigin && originOf(url || '') === serverOrigin);
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => cb(allowed(permission, details && details.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => allowed(permission, requestingOrigin));
  // 다운로드(하이라이트 · 워드/한글 내보내기 Blob)는 Electron 기본 저장 대화상자 그대로 (13.2)
}

/**
 * 로컬 PDF 본문 추출 창의 세션(9.4 · 11장 5): app://ui 의 정해진 네 파일만, app: 밖 요청은 전부 취소(네트워크 0), 권한 전부 거부,
 * 다운로드 취소. 메모리 세션이라 저장소 · 쿠키가 디스크에 남지 않음.
 */
function prepareExtractSession(ses) {
  serveApp(ses, extractFile, (file) => (path.basename(file) === 'extract.html' ? EXTRACT_CSP : LOCAL_CSP));
  ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !/^app:\/\/ui\//.test(details.url) }));
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (event) => event.preventDefault());
  return ses;
}

/** 숨은 추출 창(샌드박스 · contextIsolation 그대로, 별도 세션). 탐색 · 새 창 · webview 금지 */
function createExtractWindow({ session }) {
  const win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { ...WEB_PREFS, session, backgroundThrottling: false } });
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event) => event.preventDefault());
  wc.on('will-attach-webview', (event) => event.preventDefault());
  win.loadURL('app://ui/extract.html');
  return win;
}

function initialBounds(saved) {
  const area = screen.getPrimaryDisplay().workAreaSize;
  if (saved && saved.width >= 400 && saved.height >= 560) {
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return saved.x < b.x + b.width - 40 && saved.x + saved.width > b.x + 40 && saved.y >= b.y - 10 && saved.y < b.y + b.height - 40;
    });
    if (visible) return saved;
  }
  return { width: Math.min(1280, Math.round(area.width * 0.9)), height: Math.min(800, Math.round(area.height * 0.9)) };
}

/** 개발자 도구: 배포본 메뉴에는 없음, F12 · Ctrl+Shift+I 로만(문제 조사용 — 13.2). F5 = 새로 고침 */
function devKeys(wc, { reload = false } = {}) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const k = String(input.key || '').toLowerCase();
    if (k === 'f12' || (input.control && input.shift && k === 'i')) { wc.toggleDevTools(); event.preventDefault(); }
    else if (reload && k === 'f5') { wc.reload(); event.preventDefault(); }
  });
}

/**
 * 앱 창(클라우드 화면 + 첫 실행 · 연결 불가 로컬 화면).
 * o = {serverOrigin, bounds, icon, log, limiter, onFailLoad(desc)}
 */
function createAppWindow(o) {
  const win = new BrowserWindow({
    title: 'PaperLab', ...initialBounds(o.bounds), minWidth: 400, minHeight: 560, show: false, icon: o.icon,
    autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { ...WEB_PREFS, partition: PARTITION },
  });
  win.setMenu(null);
  const wc = win.webContents;
  const main = wc.mainFrame;

  const external = (url, requester) => {
    const d = decideExternal({ url, requester, serverOrigin: o.serverOrigin, limiter: o.limiter, now: Date.now() });
    if (d.open) shell.openExternal(d.open).catch(() => o.log.warn('외부 링크 열기 실패', { scheme: schemeOf(url) }));
    else o.log.info('외부 링크 거부', { reason: d.deny, scheme: schemeOf(url) });
  };
  const frameRequester = (frame) => (frame ? { origin: originOf(frame.url), isMainFrame: !frame.parent } : null);

  // 새 창: 늘 deny. 처리기에 요청한 프레임 정보가 없어(Electron HandlerDetails) 하위 프레임이 하나라도 있으면 거부하고,
  // 다른 출처 하위 프레임은 아예 열리지 않게 막는다(아래 will-frame-navigate) — 명세 13.2.1 7번의 대안(보고서 참고)
  wc.setWindowOpenHandler(({ url }) => {
    external(url, { origin: originOf(main.url), isMainFrame: main.framesInSubtree.length <= 1 });
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event) => {
    if (originOf(event.url) === o.serverOrigin) return;
    event.preventDefault();
    external(event.url, frameRequester(event.initiator));
  });
  wc.on('will-redirect', (event) => {
    if (!event.isMainFrame || originOf(event.url) === o.serverOrigin) return;
    event.preventDefault();
    external(event.url, frameRequester(event.initiator || main));
  });
  wc.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    if (originOf(event.url) !== o.serverOrigin && !/^about:(blank|srcdoc)$/.test(event.url)) {
      event.preventDefault();
      o.log.info('하위 프레임 이동 거부', { scheme: schemeOf(event.url) });
    }
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && originOf(url) === o.serverOrigin) o.onFailLoad(desc || `ERR ${code}`);
  });
  devKeys(wc, { reload: true });
  return win;
}

/** 이 PC 상태 창 (E4 — 480×720, 최소 380×480, 닫으면 숨김, Esc = 닫기) */
function createStatusWindow({ icon, session }) {
  const win = new BrowserWindow({
    title: 'PaperLab — 이 PC 상태', width: 480, height: 720, minWidth: 380, minHeight: 480, show: false, icon,
    autoHideMenuBar: true, webPreferences: { ...WEB_PREFS, session },
  });
  win.setMenu(null);
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event) => event.preventDefault());
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.on('before-input-event', (event, input) => {
    // 창 안 대화상자(동기화 미리보기 · 확인)가 열려 있으면 Esc 는 대화상자의 것(디자인 6단계 4.3 · 11.1)
    if (input.type === 'keyDown' && input.key === 'Escape' && !win.paperlabDialogOpen) { win.hide(); event.preventDefault(); }
  });
  devKeys(wc);
  return win;
}

module.exports = {
  registerAppScheme, prepareSession, prepareExtractSession, createAppWindow, createStatusWindow, createExtractWindow, uiFile, extractFile,
  PARTITION, EXTRACT_PARTITION, LOCAL_CSP, EXTRACT_CSP,
};
