'use strict';
// PaperLab PC 앱 main 프로세스 (명세 13장): 생명주기 · 단일 인스턴스 · 앱 창 · 이 PC 상태 창 · 트레이 · 자동 시작 ·
// 딥 링크(구글 로그인 콜백) · 워커(utilityProcess) · 기기 연결(pair) · 자동 업데이트 · 절전 막기.
// 문구는 디자인 문서 11장 · 12장 그대로.

const path = require('node:path');
const os = require('node:os');
const { app, Tray, Menu, nativeImage, session, shell, dialog, utilityProcess, powerSaveBlocker, safeStorage } = require('electron');
const { Logger } = require('../lib/log');
const { Store } = require('./store');
const { serverOrigin } = require('./config');
const { registerAppScheme, prepareSession, createAppWindow, createStatusWindow, PARTITION } = require('./window');
const { createOpenLimiter, originOf } = require('./links');
const { isAuthorizeUrl, parseCallback, findDeepLink, LOGIN_WAIT_MS } = require('./auth-bridge');
const { createUpdater } = require('./updater');
const ipc = require('./ipc');
const { createApi } = require('../worker/api-client');

const KIND = { summary: '요약', chat: '대화', write: '글쓰기' };
const DATA_NAME = app.isPackaged ? 'PaperLab' : 'PaperLab-dev'; // 개발 실행은 설치본과 데이터를 섞지 않음
app.setPath('userData', path.join(app.getPath('appData'), DATA_NAME));
registerAppScheme();

const S = {
  server: serverOrigin({ isPackaged: app.isPackaged }),
  supabaseUrl: '',
  worker: { workerState: 'unpaired', engines: [], running: [], lastProbeAt: null, lastError: '' },
  update: { state: 'idle' },
  quitting: false,
  win: null,
  statusWin: null,
  tray: null,
  child: null,
  psb: null,
  pendingCallback: null,
  loginUntil: 0, // 이 앱이 시작한 구글 로그인(화면에 PKCE 검증자가 있음)을 기다리는 시각 — 지나면 콜백을 무시
  offlineDetail: '',
  noSafeStorage: false,
  focusPair: false,
};
let log;
let store;
let updater;
const limiter = createOpenLimiter();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = findDeepLink(argv);
    if (link) handleDeepLink(link);
    else showAppWindow();
  });
  app.on('window-all-closed', () => { /* 트레이에 남음 (U4) */ });
  app.on('before-quit', () => { S.quitting = true; });
  app.whenReady().then(boot);
}

const userData = () => app.getPath('userData');
const iconDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.join(__dirname, '..', 'build'));
const icon = (name) => nativeImage.createFromPath(path.join(iconDir(), name));
const osLabel = () => `${os.version()} ${os.release()}`.trim().slice(0, 120);
const workRoot = () => path.join(process.env.LOCALAPPDATA || userData(), DATA_NAME, 'work');
const toWorker = (m) => { try { if (S.child) S.child.postMessage(m); } catch { /* 워커 다시 시작 중 */ } };

// ====================================================================== 시작
async function boot() {
  log = new Logger(path.join(userData(), 'logs', 'main.log'));
  store = new Store(userData(), safeStorage);
  log.info('앱 시작', { version: app.getVersion(), packaged: app.isPackaged ? 'yes' : 'no' });
  if (!S.server) {
    const msg = app.isPackaged ? '서버 주소 설정이 올바르지 않아요. 관리자에게 알려 주세요.'
      : '개발 실행에는 환경 변수 PAPERLAB_SERVER_URL(이 PC의 로컬 개발 서버 주소, 예: http://127.0.0.1:8765)이 필요해요. ' +
        '개발 실행이 운영 서버에 붙지 않도록 운영 주소로는 시작하지 않아요. CLI 탐지를 끄려면 PAPERLAB_NO_DETECT=1 도 함께 주세요.';
    log.error('시작하지 않음: 서버 주소 없음', { packaged: app.isPackaged ? 'yes' : 'no' });
    console.error(msg);
    dialog.showErrorBox('PaperLab', msg);
    app.quit();
    return;
  }
  prepareSession(session.fromPartition(PARTITION));
  prepareSession(session.defaultSession);
  S.noSafeStorage = !store.canEncrypt();
  ipc.register(controller, { serverOrigin: S.server, log });
  createTray();
  startWorker();
  updater = createUpdater({ isPackaged: app.isPackaged, log, onChange: onUpdate });
  S.update = updater.state();
  updater.start();
  applyAutoStart();
  const link = findDeepLink(process.argv);
  if (!process.argv.includes('--hidden') || link) showAppWindow();
  if (link) handleDeepLink(link);
}

function applyAutoStart() {
  if (!app.isPackaged) return; // 개발 실행은 레지스트리를 건드리지 않음
  app.setLoginItemSettings({ openAtLogin: !!store.get('autoStart'), args: ['--hidden'] });
}

// ====================================================================== 워커
function startWorker() {
  const child = utilityProcess.fork(path.join(__dirname, '..', 'worker', 'entry.js'), [], { serviceName: 'PaperLab Worker', stdio: 'ignore' });
  S.child = child;
  child.on('message', onWorkerMessage);
  child.on('exit', (code) => {
    if (S.child === child) S.child = null;
    if (!S.quitting) {
      log.warn('워커가 멈춤 — 다시 시작', { code });
      setTimeout(() => { if (!S.quitting && !S.child) startWorker(); }, 3000);
    }
  });
  child.postMessage({ type: 'init', noDetect: process.env.PAPERLAB_NO_DETECT === '1', serverUrl: S.server, token: store.readToken(), appVersion: app.getVersion(), os: osLabel(),
    settings: store.get('worker'), logFile: path.join(userData(), 'logs', 'worker.log'), workRoot: workRoot() });
}

function stopWorker() {
  return new Promise((resolve) => {
    const child = S.child;
    if (!child) return resolve();
    const t = setTimeout(() => { try { child.kill(); } catch { /* 끝남 */ } resolve(); }, 12000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
    toWorker({ type: 'stop' });
  });
}

function onWorkerMessage(m) {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'state') {
    const before = S.worker.running.length;
    S.worker = m;
    if (m.running.length && !S.psb) S.psb = powerSaveBlocker.start('prevent-app-suspension');
    if (!m.running.length && S.psb !== null) { powerSaveBlocker.stop(S.psb); S.psb = null; }
    if (before && !m.running.length && S.update.restartWhenIdle && S.update.state === 'ready') restartNow(true);
    refreshUi();
  } else if (m.type === 'hello') {
    store.set({ deviceId: m.deviceId || store.get('deviceId'), deviceName: m.name || '', accountHint: m.accountHint || '' });
    refreshUi();
  } else if (m.type === 'token-invalid') {
    store.clearToken();
    store.set({ deviceId: null, accountHint: '' });
    if (m.code === 'device_revoked') balloon('PaperLab', '이 PC 연결이 해지됐어요. 다시 쓰려면 이 PC 상태에서 연결해 주세요.', { always: true });
    refreshUi();
  } else if (m.type === 'update-required') {
    if (updater) updater.check();
  } else if (m.type === 'job-finished') {
    jobBalloon(m);
  }
}

function jobBalloon(m) {
  const kind = KIND[m.kind] || '작업';
  if (m.outcome === 'succeeded' && m.status === 'succeeded') balloon('PaperLab', `이 PC에서 ${kind} 작업을 끝냈어요.`);
  else if (m.status === 'queued' && ['cli_not_logged_in', 'cli_not_found'].includes(m.error_code)) {
    balloon('PaperLab', `${m.engine}에 로그인되어 있지 않아 작업을 다른 PC로 넘겼어요. 눌러서 이 PC 상태를 확인해 주세요.`);
  } else if (m.status === 'failed') balloon('PaperLab', `${kind} 작업이 실패했어요: ${ERROR_LABEL[m.error_code] || 'CLI가 오류로 끝났어요'}.`);
}

const ERROR_LABEL = {
  cli_usage_limit: '이 계정의 CLI 사용 한도에 걸렸어요', cli_model: '선택한 CLI 모델을 쓸 수 없어요', cli_timeout: '시간 제한 안에 끝나지 않았어요',
  cli_bad_output: 'CLI 결과를 읽지 못했어요', cli_exit: 'CLI가 오류로 끝났어요', output_too_large: '결과가 너무 길어요',
};

// ====================================================================== 서버 확인 · 앱 창
function errName(e) {
  const code = (e && e.cause && e.cause.code) || (e && e.name) || '';
  if (code === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return '연결 시간 초과 (ETIMEDOUT)';
  if (code === 'ECONNREFUSED') return '연결 거부 (ECONNREFUSED)';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `주소를 찾지 못함 (${code})`;
  return code ? String(code).slice(0, 40) : '';
}

async function checkServer() {
  const get = (p) => fetch(S.server + p, { headers: { 'X-PaperLab': '1' }, signal: AbortSignal.timeout(10000) });
  try {
    const h = await get('/api/health');
    if (!h.ok) return { ok: false, detail: `HTTP ${h.status}` };
    const c = await get('/api/public-config');
    if (!c.ok) return { ok: false, detail: `HTTP ${c.status}` };
    const cfg = await c.json();
    S.supabaseUrl = String((cfg && cfg.supabase_url) || '');
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: errName(e) };
  }
}

function showAppWindow() {
  if (S.win && !S.win.isDestroyed()) {
    if (S.win.isMinimized()) S.win.restore();
    S.win.show();
    S.win.focus();
    return;
  }
  S.win = createAppWindow({ serverOrigin: S.server, bounds: store.get('bounds'), icon: icon('icon.ico'), log, limiter, onFailLoad: showOffline });
  S.win.once('ready-to-show', () => S.win.show());
  S.win.on('close', (e) => {
    if (!S.win.isMinimized() && !S.win.isMaximized()) store.set({ bounds: S.win.getBounds() });
    if (S.quitting) return;
    e.preventDefault();
    S.win.hide();
    if (!store.get('trayHintShown')) {
      store.set({ trayHintShown: true });
      balloon('PaperLab은 트레이에서 계속 실행돼요', '끄려면 트레이 아이콘을 오른쪽 클릭 → [종료]를 눌러 주세요.', { always: true });
    }
  });
  S.win.webContents.on('did-finish-load', deliverCallback);
  openStart();
}

async function openStart() {
  if (!store.get('setupDone')) return S.win.loadURL('app://ui/setup.html');
  const r = await checkServer();
  if (r.ok) S.win.loadURL(`${S.server}/`);
  else showOffline(r.detail);
}

function showOffline(detail) {
  S.offlineDetail = detail || '';
  log.warn('서버에 연결할 수 없음(앱 창)', { detail: S.offlineDetail });
  if (S.win && !S.win.isDestroyed()) S.win.loadURL('app://ui/offline.html');
}

function showStatusWindow({ focusPair = false } = {}) {
  S.focusPair = focusPair;
  if (!S.statusWin || S.statusWin.isDestroyed()) {
    S.statusWin = createStatusWindow({ icon: icon('icon.ico'), session: session.defaultSession });
    S.statusWin.on('close', (e) => { if (!S.quitting) { e.preventDefault(); S.statusWin.hide(); } });
    S.statusWin.once('ready-to-show', () => S.statusWin.show());
    S.statusWin.loadURL('app://ui/status.html');
  } else {
    S.statusWin.show();
    S.statusWin.focus();
    pushLocal();
  }
}

// ====================================================================== 구글 로그인 (13.4 ①)
async function startGoogleLogin(url) {
  if (!S.supabaseUrl) await checkServer();
  if (!S.supabaseUrl || !isAuthorizeUrl(url, S.supabaseUrl)) {
    log.warn('로그인 주소 거부(Supabase authorize 가 아님)');
    return { ok: false };
  }
  try {
    await shell.openExternal(url);
    S.loginUntil = Date.now() + LOGIN_WAIT_MS;
    log.info('시스템 브라우저에서 로그인 시작');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

function handleDeepLink(link) {
  const cb = parseCallback(link);
  if (!cb) return;
  // 이 앱이 시작한 로그인(PKCE 검증자가 화면 저장소에 있음)을 기다릴 때만 화면에 넘김 — 아니면 무시 (품질팀 F8)
  if (Date.now() > S.loginUntil) { log.info('로그인 콜백 무시(진행 중인 앱 로그인 없음)'); return; }
  S.loginUntil = 0;
  log.info('로그인 콜백 받음', { ok: cb.code ? 'yes' : 'no' });
  S.pendingCallback = cb;
  showAppWindow();
  deliverCallback();
}

function deliverCallback() {
  const cb = S.pendingCallback;
  if (!cb || !S.win || S.win.isDestroyed()) return;
  const wc = S.win.webContents;
  if (wc.isLoading() || originOf(wc.getURL()) !== S.server) return; // 화면을 받은 뒤 did-finish-load 에서 다시
  S.pendingCallback = null;
  wc.send('pl:auth-callback', cb.code, cb.error);
}

// ====================================================================== 기기 연결 (12.2)
function pairError(e) {
  if (e.network) return '서버에 연결할 수 없어요.';
  if (e.status === 429) return '잠시 뒤에 다시 시도해 주세요.';
  if (e.code === 'bad_code') return '연결 코드가 맞지 않거나 시간이 지났어요.';
  return (e.body && typeof e.body.detail === 'string' && e.body.detail.slice(0, 200)) || '잠시 후 다시 시도해 주세요.';
}

async function pair(code) {
  const api = createApi({ baseUrl: S.server });
  let r;
  try {
    r = await api.post('/api/worker/pair', { code, name: os.hostname(), os: osLabel(), app_version: app.getVersion(), protocol: 1 }, { auth: false });
  } catch (e) {
    log.info('이 PC 연결 실패', { status: e.status || 'network', code: e.code });
    return { ok: false, error: pairError(e) };
  }
  if (!r || typeof r.token !== 'string' || !r.token.startsWith('pld1.')) return { ok: false, error: '잠시 후 다시 시도해 주세요.' };
  S.noSafeStorage = !store.saveToken(r.token);
  store.set({ deviceId: r.device_id, deviceName: r.name || '', accountHint: r.account_hint || '' });
  toWorker({ type: 'token', token: r.token });
  log.info('이 PC 연결됨', { device_id: r.device_id, saved: S.noSafeStorage ? 'memory' : 'dpapi' });
  refreshUi();
  return { ok: true, deviceName: r.name || '' };
}

function paired() { return !!store.readToken(); }

function info() {
  const ws = S.worker.workerState;
  return {
    appVersion: app.getVersion(), paired: paired(), deviceId: store.get('deviceId'), deviceName: store.get('deviceName'),
    accountHint: store.get('accountHint'),
    workerState: ['idle', 'running', 'paused', 'update_required'].includes(ws) ? ws : 'offline',
    engines: S.worker.engines.map((e) => ({ name: e.name, enabled: e.enabled, installed: e.installed, version: e.version, logged_in: e.logged_in })),
  };
}

// ====================================================================== 업데이트 (13.7 · E7)
function onUpdate(u) {
  const was = S.update.state;
  S.update = u;
  if (u.state === 'ready' && was !== 'ready') balloon('PaperLab', `새 버전 ${u.version}을 받았어요. 다음에 앱을 끌 때 설치돼요.`, { always: true });
  refreshUi();
}

async function restartNow(skipConfirm = false) {
  if (S.update.state !== 'ready') return;
  const n = S.worker.running.length;
  if (n && !skipConfirm) {
    const r = await dialog.showMessageBox(S.statusWin && S.statusWin.isVisible() ? S.statusWin : undefined, {
      type: 'question', title: 'PaperLab', message: `실행 중인 작업이 ${n}개 있어요.`,
      detail: '작업이 끝나면 다시 시작할까요? 지금 다시 시작하면 작업은 다른 PC로 넘어가거나 다시 대기해요.',
      buttons: ['끝나면 다시 시작', '지금 다시 시작', '취소'], defaultId: 2, cancelId: 2, noLink: true });
    if (r.response === 0) { updater.setRestartWhenIdle(true); return; }
    if (r.response !== 1) return;
  }
  S.quitting = true;
  await stopWorker();
  updater.installNow();
}

// ====================================================================== 트레이 (E3)
function trayLook() {
  const ws = S.worker.workerState;
  const name = store.get('deviceName') || '이 PC';
  const n = S.worker.running.length;
  if (ws === 'offline' || ws === 'error') return { icon: 'error', tip: 'PaperLab — 서버에 연결할 수 없어요', line: '서버에 연결할 수 없어요' };
  if (ws === 'revoked') return { icon: 'error', tip: 'PaperLab — 이 PC가 연결되지 않았어요', line: '이 PC 연결이 해지됐어요' };
  if (ws === 'unpaired') return { icon: 'error', tip: 'PaperLab — 이 PC가 연결되지 않았어요', line: '이 PC가 연결되지 않았어요' };
  if (ws === 'update_required') return { icon: 'error', tip: 'PaperLab — 업데이트가 필요해요', line: '업데이트가 필요해요' };
  if (ws === 'paused') return { icon: 'paused', tip: 'PaperLab — 작업 받기 일시 중지', line: `${name} · 작업 받기 멈춤` };
  if (n) return { icon: 'running', tip: `PaperLab — 작업 ${n}개 실행 중`, line: `${name} · 작업 ${n}개 실행 중` };
  if (noEngine()) return { icon: 'error', tip: 'PaperLab — 대기 중', line: `${name} · 대기 중` };
  return { icon: 'idle', tip: 'PaperLab — 대기 중', line: `${name} · 대기 중` };
}

function noEngine() {
  return S.worker.lastProbeAt !== null && !S.worker.engines.some((e) => e.enabled && e.installed && e.logged_in && !e.outdated);
}

let trayKey = '';
function createTray() {
  S.tray = new Tray(icon('tray-idle.ico'));
  S.tray.on('click', () => showAppWindow());
  S.tray.on('double-click', () => showAppWindow());
  S.tray.on('balloon-click', () => showStatusWindow());
  updateTray();
}

function updateTray() {
  if (!S.tray) return;
  const look = trayLook();
  const ws = S.worker.workerState;
  const pairedNow = paired();
  const ready = S.update.state === 'ready';
  const key = JSON.stringify([look, ws, pairedNow, ready, S.update.version]);
  if (key === trayKey) return;
  trayKey = key;
  S.tray.setImage(icon(`tray-${look.icon}.ico`));
  S.tray.setToolTip(look.tip);
  const items = [
    { label: look.line, enabled: false },
    { type: 'separator' },
    { label: 'PaperLab 열기', click: () => showAppWindow() },
    { label: '이 PC 상태', click: () => showStatusWindow() },
  ];
  if (!pairedNow) items.push({ label: '코드로 연결…', click: () => showStatusWindow({ focusPair: true }) });
  items.push({ type: 'separator' },
    { label: '작업 받기 일시 중지', type: 'checkbox', checked: !!store.get('worker').paused, enabled: pairedNow, click: (mi) => setPaused(mi.checked) },
    { type: 'separator' },
    ready ? { label: `업데이트 설치하고 다시 시작 (${S.update.version})`, click: () => restartNow() }
      : { label: '업데이트 확인', click: () => trayCheckUpdate() },
    { label: '로그 폴더 열기', click: () => openLogs() },
    { type: 'separator' },
    { label: '종료', click: () => quitApp() });
  S.tray.setContextMenu(Menu.buildFromTemplate(items));
}

async function trayCheckUpdate() {
  const u = await updater.check();
  if (u.state === 'dev') balloon('PaperLab', '개발 실행에서는 업데이트를 확인하지 않아요.', { always: true });
  else if (u.state === 'latest') balloon('PaperLab', `최신 버전이에요 (${app.getVersion()})`, { always: true });
  else if (u.state === 'downloading') balloon('PaperLab', `새 버전 ${u.version}을 받는 중이에요`, { always: true });
  else if (u.state === 'failed' || u.state === 'corrupt') balloon('PaperLab', '업데이트를 확인하지 못했어요 — 서버에 연결할 수 없어요', { always: true });
}

/** 트레이 알림: 앱 창이 숨었을 때만 · 설정에서 끌 수 있음(첫 숨김 · 업데이트 · 해지는 늘) */
function balloon(title, content, { always = false } = {}) {
  if (!S.tray) return;
  if (!always && (!store.get('notify') || (S.win && !S.win.isDestroyed() && S.win.isVisible() && !S.win.isMinimized()))) return;
  try { S.tray.displayBalloon({ title, content, iconType: 'info' }); } catch { /* 알림을 못 띄우는 환경 */ }
}

async function quitApp() {
  const n = S.worker.running.length;
  if (n) {
    const r = await dialog.showMessageBox({ type: 'question', title: 'PaperLab 종료', message: `실행 중인 작업이 ${n}개 있어요.`,
      detail: '지금 끄면 작업은 다른 PC로 넘어가거나 다시 대기해요.', buttons: ['종료', '취소'], defaultId: 1, cancelId: 1, noLink: true });
    if (r.response !== 0) return;
  }
  S.quitting = true;
  await stopWorker();
  app.quit();
}

function openLogs() {
  shell.openPath(path.join(userData(), 'logs'));
}

function setPaused(on) {
  store.set({ worker: { ...store.get('worker'), paused: !!on } });
  toWorker({ type: 'settings', settings: store.get('worker') });
  refreshUi();
}

// ====================================================================== 로컬 화면 (E2 · E4 · E6 · E9)
function banner() {
  const ws = S.worker.workerState;
  if (ws === 'revoked') return 'revoked';
  if (ws === 'update_required') return 'update_required';
  if (ws === 'offline' || ws === 'error') return 'offline';
  if (paired() && noEngine()) return 'no_engine';
  if (paired() && S.noSafeStorage) return 'no_safe_storage';
  return '';
}

function localState() {
  return {
    appVersion: app.getVersion(), paired: paired(), deviceId: store.get('deviceId'), deviceName: store.get('deviceName'),
    accountHint: store.get('accountHint'), worker: S.worker, settings: store.get('worker'), update: S.update,
    autoStart: store.get('autoStart'), notify: store.get('notify'), banner: banner(), offlineDetail: S.offlineDetail,
    focusPair: S.focusPair, packaged: app.isPackaged,
  };
}

function pushLocal() {
  const s = localState();
  S.focusPair = false;
  for (const w of [S.statusWin, S.win]) {
    if (w && !w.isDestroyed() && w.webContents.getURL().startsWith('app://ui/')) w.webContents.send('local:state', s);
  }
}

function refreshUi() {
  updateTray();
  pushLocal();
}

function setWorkerSettings(patch) {
  store.set({ worker: { ...store.get('worker'), ...patch } });
  toWorker({ type: 'settings', settings: store.get('worker') });
  refreshUi();
}

async function localAction(name, arg, sender) {
  const owner = [S.statusWin, S.win].find((w) => w && !w.isDestroyed() && w.webContents === sender);
  switch (name) {
    case 'setup-check': return checkServer();
    case 'setup-start': {
      store.set({ setupDone: true, autoStart: arg !== false });
      applyAutoStart();
      return openStart();
    }
    case 'retry': {
      const r = await checkServer();
      if (!r.ok) S.offlineDetail = r.detail || '';
      else if (S.win && !S.win.isDestroyed()) S.win.loadURL(store.get('setupDone') ? `${S.server}/` : 'app://ui/setup.html');
      return r;
    }
    case 'offline': showOffline(String(arg || '').slice(0, 80)); return true;
    case 'open-logs': return openLogs();
    case 'pair': return pair(String(arg || '').slice(0, 32));
    case 'unpair': {
      const r = await dialog.showMessageBox(owner, { type: 'warning', title: 'PaperLab', message: '이 PC에서 연결 정보를 지울까요?',
        detail: '웹 설정의 연결된 PC 목록에는 남아 있어요. 그곳에서도 해지해 주세요.', buttons: ['연결 끊기', '취소'], defaultId: 1, cancelId: 1, noLink: true });
      if (r.response !== 0) return false;
      store.clearToken();
      store.set({ deviceId: null, accountHint: '' });
      toWorker({ type: 'token', token: null });
      log.info('이 PC에서 연결 정보를 지움');
      refreshUi();
      return true;
    }
    case 'pause': return setPaused(!!arg);
    case 'cancel': toWorker({ type: 'cancel', id: Number(arg) }); return true;
    case 'engine': {
      if (!arg || !['claude', 'codex', 'gemini'].includes(arg.name)) return false;
      const w = store.get('worker');
      const cur = w.engines[arg.name];
      const next = { ...cur };
      if (typeof arg.enabled === 'boolean') next.enabled = arg.enabled;
      if (arg.slots !== undefined) next.slots = Number(arg.slots);
      if (arg.auto === true) next.path = '';
      setWorkerSettings({ engines: { ...w.engines, [arg.name]: next } });
      return true;
    }
    case 'pick-path': {
      if (!['claude', 'codex', 'gemini'].includes(arg)) return false;
      const r = await dialog.showOpenDialog(owner, { title: `${arg} 실행 파일 고르기`, properties: ['openFile'],
        filters: [{ name: '실행 파일 (*.exe; *.cmd)', extensions: ['exe', 'cmd'] }] });
      if (r.canceled || !r.filePaths[0]) return false;
      const w = store.get('worker');
      setWorkerSettings({ engines: { ...w.engines, [arg]: { ...w.engines[arg], path: r.filePaths[0] } } });
      return true;
    }
    case 'total': setWorkerSettings({ totalSlots: Number(arg) }); return true;
    case 'recheck': toWorker({ type: 'recheck' }); return true;
    case 'check-update': return updater.check();
    case 'restart-now': return restartNow();
    case 'cancel-restart': updater.setRestartWhenIdle(false); return true;
    case 'auto-start': store.set({ autoStart: !!arg }); applyAutoStart(); refreshUi(); return true;
    case 'notify': store.set({ notify: !!arg }); refreshUi(); return true;
    case 'close': if (owner) owner.hide(); return true;
    default: return null;
  }
}

const controller = {
  info, pair, startGoogleLogin, localState, localAction,
  nudge: () => toWorker({ type: 'nudge' }),
  showStatusWindow: () => showStatusWindow(),
};
