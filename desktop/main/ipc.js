'use strict';
// preload 요청 처리 (명세 13.2 IPC · 13.3, 체크리스트 17번): 모든 처리기가 보낸 프레임의 출처를 검사한다.
// 클라우드 채널(pl:*)은 서버 출처의 최상위 프레임만, 로컬 채널(local:*)은 app://ui 의 최상위 프레임만.

const { originOf } = require('./links');

function isCloudSender(frame, serverOrigin) {
  return !!frame && !frame.parent && originOf(frame.url) === serverOrigin;
}

function isLocalSender(frame) {
  if (!frame || frame.parent) return false;
  try {
    const u = new URL(frame.url);
    return u.protocol === 'app:' && u.host === 'ui';
  } catch {
    return false;
  }
}

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
  cloudOn('pl:nudge', () => ctl.nudge());
  cloudOn('pl:open-status', () => ctl.showStatusWindow());
  local('local:state', () => ctl.localState());
  local('local:action', (sender, name, arg) => ctl.localAction(String(name), arg, sender));
}

module.exports = { register, isCloudSender, isLocalSender };
