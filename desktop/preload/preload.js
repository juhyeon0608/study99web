'use strict';
// preload (sandbox — electron 모듈만 쓸 수 있음). 체크리스트 20번: Electron API 를 그대로 내주지 않고 정한 함수만.
// - 클라우드 화면(서버 출처): window.paperlabDesktop — 명세 13.3 표의 6개 함수만. 토큰은 어디에도 없음(AC-74).
// - 로컬 화면(app://): window.paperlabLocal — 첫 실행 · 연결 불가 · 이 PC 상태 화면용.
// 어느 쪽이든 main 의 ipc 처리기가 보낸 프레임의 출처를 다시 검사한다(체크리스트 17번) — 여기의 분기는 편의일 뿐 경계가 아님.

const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'app:') {
  contextBridge.exposeInMainWorld('paperlabLocal', {
    state: () => ipcRenderer.invoke('local:state'),
    action: (name, arg) => ipcRenderer.invoke('local:action', String(name), arg === undefined ? null : arg),
    onState: (fn) => {
      const h = (_e, s) => fn(s);
      ipcRenderer.on('local:state', h);
      return () => ipcRenderer.removeListener('local:state', h);
    },
  });
} else if (location.protocol === 'https:' || location.protocol === 'http:') {
  contextBridge.exposeInMainWorld('paperlabDesktop', {
    info: () => ipcRenderer.invoke('pl:info'),
    pair: (code) => ipcRenderer.invoke('pl:pair', String(code == null ? '' : code)),
    nudge: () => { ipcRenderer.send('pl:nudge'); },
    startGoogleLogin: (authorizeUrl) => ipcRenderer.invoke('pl:google-login', String(authorizeUrl || '')),
    onAuthCallback: (fn) => {
      const h = (_e, code, error) => fn(code, error);
      ipcRenderer.on('pl:auth-callback', h);
      return () => ipcRenderer.removeListener('pl:auth-callback', h);
    },
    openStatusWindow: () => { ipcRenderer.send('pl:open-status'); },
  });
}
