'use strict';
// 자동 업데이트 (명세 13.7 · 13.7.1, 확정 U5): electron-updater generic provider — 주소는 빌드가 app-update.yml 에 넣음
// (setFeedURL 을 부르지 않음). 자동으로 받고 다음 종료 때 설치, 시작 때 + 6시간마다 확인.
// 받은 파일은 latest.yml 의 sha512 로 검증(electron-updater 기본) — 맞지 않으면 설치하지 않고 "손상" 상태.
// 서버에 연결할 수 없을 때의 실패는 오류 창 없이 상태 줄에만(13.6). 앱 창(클라우드 화면)에는 알리지 않음(PD-8).

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

function createUpdater({ isPackaged, log, onChange }) {
  const state = { state: isPackaged ? 'idle' : 'dev', version: '', percent: 0, checkedAt: null, restartWhenIdle: false };
  const set = (patch) => { Object.assign(state, patch); onChange({ ...state }); };
  if (!isPackaged) {
    return { state: () => ({ ...state }), check: async () => ({ ...state }), start() {}, installNow() {}, setRestartWhenIdle() {} };
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => set({ state: 'latest', checkedAt: Date.now() }));
  autoUpdater.on('update-available', (info) => {
    log.info('업데이트 있음', { version: info && info.version });
    set({ state: 'downloading', version: (info && info.version) || '', percent: 0, checkedAt: Date.now() });
  });
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round((p && p.percent) || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    log.info('업데이트 받음', { version: info && info.version });
    set({ state: 'ready', version: (info && info.version) || state.version, percent: 100 });
  });
  autoUpdater.on('error', (err) => {
    const msg = String((err && err.message) || '');
    const corrupt = /sha512|checksum/i.test(msg);
    log.warn(corrupt ? '업데이트 파일 손상 — 설치하지 않음' : '업데이트 확인 실패', { error: msg.split('\n')[0].slice(0, 160) });
    set({ state: corrupt ? 'corrupt' : 'failed', checkedAt: Date.now() });
  });

  let checking = null;
  async function check() {
    if (state.state === 'ready' || state.state === 'downloading') return { ...state };
    if (!checking) {
      checking = autoUpdater.checkForUpdates().catch(() => null).finally(() => { checking = null; });
    }
    await checking;
    return { ...state };
  }

  return {
    state: () => ({ ...state }),
    check,
    start() {
      check();
      setInterval(check, CHECK_EVERY_MS).unref();
    },
    setRestartWhenIdle(on) { set({ restartWhenIdle: !!on }); },
    installNow() {
      // NSIS 한 번에 설치 — 조용히 설치하고 다시 켬
      autoUpdater.quitAndInstall(true, true);
    },
  };
}

module.exports = { createUpdater, CHECK_EVERY_MS };
