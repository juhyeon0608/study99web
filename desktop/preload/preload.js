'use strict';
// preload (sandbox — electron 모듈만 쓸 수 있음). 체크리스트 20번: Electron API 를 그대로 내주지 않고 정한 함수만.
// - 클라우드 화면(서버 출처): window.paperlabDesktop — 명세 13.3 표의 6개 함수 + cancelGoogleLogin(로그인 대기 취소 — 품질 점검 후속). 토큰은 어디에도 없음(AC-74).
// - 로컬 화면(app://): window.paperlabLocal — 첫 실행 · 연결 불가 · 이 PC 상태 화면용.
// - 로컬 PDF 본문 추출 창(app://ui/extract.html — 선택 동기화 9.4절): window.paperlabExtract(ready · onJob · done)만. 이 창에는 paperlabLocal 이 없음.
// - 클라우드 화면 로컬 파일 다리(선택 동기화 9.1절, 계약 C-3): localFile · openLocal · localHas — 논문 id 만 보내고 경로는 받지도 돌려주지도 않음.
// 어느 쪽이든 main 의 ipc 처리기가 보낸 프레임의 출처를 다시 검사한다(체크리스트 17번) — 여기의 분기는 편의일 뿐 경계가 아님.

const { contextBridge, ipcRenderer } = require('electron');

const idOf = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

if (location.href === 'app://ui/extract.html') {
  contextBridge.exposeInMainWorld('paperlabExtract', {
    ready: () => { ipcRenderer.send('extract:ready'); },
    onJob: (fn) => { ipcRenderer.on('extract:job', (_e, job) => fn(job)); },
    done: (id, pages, code) => { ipcRenderer.send('extract:done', Number(id) || 0, Array.isArray(pages) ? pages.map((p) => String(p)) : [], String(code || '')); },
  });
} else if (location.protocol === 'app:') {
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
    cancelGoogleLogin: () => { ipcRenderer.send('pl:google-login-cancel'); },
    onAuthCallback: (fn) => {
      const h = (_e, code, error) => fn(code, error);
      ipcRenderer.on('pl:auth-callback', h);
      return () => ipcRenderer.removeListener('pl:auth-callback', h);
    },
    openStatusWindow: () => { ipcRenderer.send('pl:open-status'); },
    localFile: (paperId) => ipcRenderer.invoke('pl:local-file', idOf(paperId)),
    openLocal: (paperId) => ipcRenderer.invoke('pl:open-local', idOf(paperId)),
    localHas: (paperIds) => ipcRenderer.invoke('pl:local-has', Array.isArray(paperIds) ? paperIds.slice(0, 500).map(idOf) : []),
  });
}
