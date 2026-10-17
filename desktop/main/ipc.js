'use strict';
// preload 요청 처리 (명세 13.2 IPC · 13.3, 체크리스트 17번): 모든 처리기가 보낸 프레임의 출처를 검사한다.
// 클라우드 채널(pl:*)은 서버 출처의 최상위 프레임만, 로컬 채널(local:*)은 app://ui 의 최상위 프레임만(추출 창 제외).
// 선택 동기화(selective-sync.md 9.1 · 9.2 · 11장 2): pl:local-file · pl:open-local · pl:local-has 도 클라우드 출처 검사 그대로, 인자는 논문 id
// (양의 안전한 정수)만 · 배열은 500개까지. extract:* 는 app://ui/extract.html 최상위 프레임만(PDF 본문 추출 창 — 그 창은 local:* 를 못 씀).

const { originOf } = require('./links');

const MAX_HAS = 500;

function isCloudSender(frame, serverOrigin) {
  return !!frame && !frame.parent && originOf(frame.url) === serverOrigin;
}

function appPath(frame) {
  if (!frame || frame.parent) return null;
  try {
    const u = new URL(frame.url);
    return u.protocol === 'app:' && u.host === 'ui' ? u.pathname : null;
  } catch {
    return null;
  }
}

/** app://ui 최상위 프레임(이 PC 상태 · 첫 실행 · 연결 불가 화면). PDF 를 여는 추출 창은 제외 */
function isLocalSender(frame) {
  const p = appPath(frame);
  return p !== null && p !== '/extract.html';
}

/** 로컬 PDF 본문 추출 창(app://ui/extract.html 최상위 프레임)만 */
function isExtractSender(frame) {
  return appPath(frame) === '/extract.html';
}

const validId = (id) => Number.isSafeInteger(id) && id > 0;

/** ctl = main.js 의 처리 함수 묶음 */
function register(ctl, { serverOrigin, log }) {
  const { ipcMain } = require('electron');
  const deny = (channel) => { log.warn('IPC 거부(보낸 곳이 맞지 않음)', { channel }); return null; };
  const cloud = (channel, fn) => ipcMain.handle(channel, (e, ...a) => (isCloudSender(e.senderFrame, serverOrigin) ? fn(...a) : deny(channel)));
  const cloudOn = (channel, fn) => ipcMain.on(channel, (e, ...a) => { if (isCloudSender(e.senderFrame, serverOrigin)) fn(...a); else deny(channel); });
  const local = (channel, fn) => ipcMain.handle(channel, (e, ...a) => (isLocalSender(e.senderFrame) ? fn(e.sender, ...a) : deny(channel)));

  cloud('pl:info', () => ctl.info());
  cloud('pl:pair', (code) => ctl.pair(String(code || '').slice(0, 32)));
  cloud('pl:google-login', (url) => ctl.startGoogleLogin(String(url || '').slice(0, 4096)));
  cloudOn('pl:google-login-cancel', () => ctl.cancelGoogleLogin());
  cloudOn('pl:nudge', () => ctl.nudge());
  cloudOn('pl:open-status', () => ctl.showStatusWindow());
  // 로컬 파일 다리(9.1): 경로는 받지도 돌려주지도 않음 — id 만
  cloud('pl:local-file', (id) => (validId(id) ? ctl.localFile(id) : { ok: false, code: 'not_local' }));
  cloud('pl:open-local', (id) => (validId(id) ? ctl.openLocal(id) : { ok: false, code: 'not_local' }));
  cloud('pl:local-has', (ids) => (Array.isArray(ids) ? ctl.localHas(ids.filter(validId).slice(0, MAX_HAS)) : {}));
  local('local:state', () => ctl.localState());
  local('local:action', (sender, name, arg) => ctl.localAction(String(name), arg, sender));
  const extractOn = (channel, fn) => ipcMain.on(channel, (e, ...a) => { if (isExtractSender(e.senderFrame)) fn(e.sender, ...a); else deny(channel); });
  extractOn('extract:ready', (sender) => ctl.extractReady(sender));
  extractOn('extract:done', (sender, id, pages, code) => ctl.extractDone(sender, Number(id), pages, String(code || '').slice(0, 40)));
}

module.exports = { register, isCloudSender, isLocalSender, isExtractSender, validId };
