'use strict';
// main 쪽 폴더 동기화 (명세 15.1 · 15.3 · 7.1~7.3, 디자인 0.1 IPC 훅): 동기화 utilityProcess 띄우기 · 다시 띄우기, 휴지통 보내기(shell.trashItem —
// main 에서만 동작, S-3), 폴더 고르기 · 거부 검사, 설치 ID, 로컬 화면 동작(sync-*). 렌더러는 상대 경로 · 정해진 값만 보내고 경로를 조작하지 못한다.
// 로그에는 경로 · 파일 이름을 쓰지 않는다(12.6).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { run } = require('../lib/run');
const { checkRoot, rootProblem, oneDriveRoots, recycleNuke, linkInChain } = require('../sync/rootcheck');
const { safeJoin, isInside, SYNC_DIR, MAX_PATH } = require('../sync/paths');
const { parseToken } = require('../sync/engine');
const { createApi } = require('../worker/api-client');

const SUGGESTED_NAME = 'PaperLab 논문';
const REG_KEY = 'HKCU\\Software\\PaperLab';
const CHOICES = new Set(['continue', 'revert', 'later', 'off']);

/**
 * 설치 ID(K-33 · S-5 f): HKCU\Software\PaperLab\InstallId. 없으면 만들어 씀. 제거할 때 설치 프로그램이 이 키를 지움
 * (build/installer.nsh — 업데이트 설치(--updated)에서는 지우지 않음) → 업데이트로는 그대로, 제거 후 새로 설치하면 새 값.
 * 개발 실행은 PAPERLAB_INSTALL_ID 또는 'dev'(레지스트리를 건드리지 않음).
 */
async function readInstallId({ packaged, env = process.env, reg = run }) {
  if (!packaged) return String(env.PAPERLAB_INSTALL_ID || 'dev').slice(0, 64);
  const q = await reg('reg.exe', ['query', REG_KEY, '/v', 'InstallId']);
  const m = q.code === 0 && q.out.match(/InstallId\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
  if (m) return m[1].toLowerCase();
  // 읽기 실패(시간 초과 · 실행 못 함)는 "값 없음"과 다름 — 새 ID 를 쓰지 않고 이번 실행은 꺼짐('' — 다음 시작 때 다시 읽음)
  if (q.code !== 1) return ''; // reg query 종료 코드 1 = 값(키) 없음일 때만 새로 씀
  const id = crypto.randomUUID();
  const add = await reg('reg.exe', ['add', REG_KEY, '/v', 'InstallId', '/t', 'REG_SZ', '/d', id, '/f']);
  return add.code === 0 ? id : ''; // 못 쓰면 '' → 저장된 루트가 있어도 켜지지 않음(안전한 쪽)
}

/** main 의 휴지통 보내기: 루트 안 · 링크 아님 · \\?\ 아님을 다시 확인한 뒤 shell.trashItem (K-43) */
async function trashInRoot(abs, root, shell) {
  const p = String(abs || '');
  if (!root || p.startsWith('\\\\') || !path.isAbsolute(p) || !isInside(root, p)) return { ok: false, reason: 'parse_failed' };
  let cur = path.resolve(p);
  const top = path.resolve(root).toLowerCase();
  try { if (!fs.lstatSync(cur).isFile()) return { ok: false, reason: 'parse_failed' }; } catch { return { ok: false, reason: 'parse_failed' }; }
  while (cur.toLowerCase() !== top) {
    try { if (fs.lstatSync(cur).isSymbolicLink()) return { ok: false, reason: 'parse_failed' }; } catch { return { ok: false, reason: 'parse_failed' }; }
    if (path.dirname(cur) === cur) return { ok: false, reason: 'parse_failed' };
    cur = path.dirname(cur);
  }
  try {
    await shell.trashItem(p);
    return { ok: true, reason: p.length > MAX_PATH ? 'long_path' : '' };
  } catch (e) {
    const msg = String((e && e.message) || '');
    // Electron 은 사용자 창 없이(FOF_NOERRORUI) 보내므로 잠긴 파일 · 그 밖의 거절이 모두 "Operation was aborted" — 잠김으로 단정하지 않음
    if (/aborted/i.test(msg)) return { ok: false, reason: 'aborted' };
    if (/parse path/i.test(msg)) return { ok: false, reason: 'parse_failed' };
    return { ok: false, reason: 'other' };
  }
}

function createSyncHost(d) {
  const { utilityProcess, dialog, shell, store, log, serverUrl, userData, appVersion, isPackaged, onChange, balloon } = d;
  const env = d.env || process.env;
  const H = {
    child: null, state: { state: 'off', counts: {} }, installId: '', pickError: null, suggestion: null, quitting: false, startWaiters: new Map(), startSeq: 0,
    oneDrive: [], focus: '',
  };
  const to = (m) => { try { if (H.child) H.child.postMessage(m); } catch { /* 다시 시작 중 */ } };
  const settings = () => store.get('sync');
  const journalFile = () => path.join(userData(), 'sync', 'state.json');

  async function start() {
    H.installId = await (d.readInstallId || readInstallId)({ packaged: isPackaged });
    // 재설치(설치 ID 가 다름 — K-33): 저장된 루트를 "전에 쓰던 폴더"로만 남기고 꺼짐으로 정리. 파일 · 저널은 건드리지 않음.
    // 설치 ID 를 읽지 못한 실행('')은 설정을 그대로 두고 꺼짐으로만(다음 시작 때 다시 읽음 — 엔진이 '' 로는 켜지 않음)
    const s0 = settings();
    if (H.installId && s0.root && s0.installId !== H.installId) {
      store.set({ sync: { ...s0, enabled: false, root: '', installId: '', previousRoot: s0.root } });
      log.info('설치 ID 가 달라 동기화를 끈 상태로 시작');
    }
    H.oneDrive = await oneDriveRoots(env).catch(() => []);
    computeSuggestion();
    fork();
  }

  function fork() {
    if (H.quitting) return;
    const child = utilityProcess.fork(path.join(__dirname, '..', 'sync', 'entry.js'), [], { serviceName: 'PaperLab Sync', stdio: 'ignore' });
    H.child = child;
    child.on('message', onMessage);
    child.on('exit', (code) => {
      if (H.child === child) H.child = null;
      if (!H.quitting) {
        log.warn('동기화 프로세스가 멈춤 — 다시 시작', { code });
        setTimeout(() => { if (!H.quitting && !H.child) fork(); }, 3000);
      }
    });
    child.postMessage({ type: 'init', serverUrl, dev: !isPackaged, token: d.readToken(), appVersion, installId: H.installId, settings: settings(),
      journalFile: journalFile(), logFile: path.join(userData(), 'logs', 'sync.log') });
  }

  function stop() {
    H.quitting = true;
    return new Promise((resolve) => {
      const child = H.child;
      if (!child) return resolve();
      const t = setTimeout(() => { try { child.kill(); } catch { /* 끝남 */ } resolve(); }, 8000);
      child.once('exit', () => { clearTimeout(t); resolve(); });
      to({ type: 'stop' });
    });
  }

  async function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'state') {
      const before = H.state.state;
      H.state = m;
      if (m.state !== before && ['preview', 'waiting_confirm'].includes(m.state)) H.focus = m.state === 'preview' ? 'preview' : 'confirm';
      onChange();
    } else if (m.type === 'trash') {
      const r = await trashInRoot(m.path, settings().root || H.state.root, shell);
      if (!r.ok) log.info('휴지통 보내기 실패', { reason: r.reason });
      to({ type: 'trash-result', id: m.id, ok: r.ok, reason: r.reason });
    } else if (m.type === 'notify') {
      const look = require('../ui/sync-look').syncBalloon(m, { userCap: H.state.userCap });
      if (look) balloon(look.title, look.content, { always: !!look.always, sync: true, focus: m.kind });
    } else if (m.type === 'started') {
      store.set({ sync: { ...settings(), enabled: true, root: String(m.root), installId: H.installId, previousRoot: '' } });
      H.pickError = null;
      to({ type: 'settings', settings: settings() });
      onChange();
    } else if (m.type === 'turned-off') {
      const s = settings();
      store.set({ sync: { ...s, enabled: false, root: '', previousRoot: String(m.root || s.root || s.previousRoot || '') } });
      to({ type: 'settings', settings: settings() });
      onChange();
    } else if (m.type === 'start-result') {
      const w = H.startWaiters.get(m.id);
      if (w) w(m);
    } else if (m.type === 'token-invalid') {
      if (d.onTokenInvalid) d.onTokenInvalid(String(m.code || ''));
    } else if (m.type === 'update-required') {
      if (d.onUpdateRequired) d.onUpdateRequired();
    }
  }

  // ------------------------------------------------------------------ 제안 위치 · 고르기 (7.1 · 디자인 2.1 · 3장)
  function computeSuggestion() {
    const home = env.USERPROFILE || '';
    const p = home ? path.join(home, SUGGESTED_NAME) : '';
    if (!p) { H.suggestion = { path: '', ok: false, reason: 'unknown' }; return; }
    const code = rootProblem({ p, env, oneDrive: H.oneDrive, otherRoots: [], isDir: true, link: linkInChain(home) === true, drive: 'Fixed', writable: true });
    H.suggestion = { path: p, ok: !code, reason: code, exists: fs.existsSync(p) };
  }

  /** 거부 검사 + 표식(다른 사용자 · 다른 기기 — Q-2 ①) + 휴지통 "바로 삭제"(Q-5). → '' | 거부 코드 */
  async function judge(p) {
    const s = settings();
    const running = s.enabled && s.root ? [s.root] : [];
    const r = await checkRoot(p, { env, otherRoots: running, deps: { oneDriveRoots: async () => H.oneDrive, ...(d.rootDeps || {}) } });
    if (r.code) return { code: r.code, real: r.real };
    const who = parseToken(d.readToken());
    if (!who) return { code: 'unpaired', real: r.real };
    const mk = r.marker;
    if (mk) {
      if (mk.user_id && mk.user_id !== who.uid) return { code: 'other_device', real: r.real }; // 다른 사용자의 표식은 서버 답과 관계없이 거부
      if (Number(mk.device_id) !== who.deviceId) {
        try {
          const res = await createApi({ baseUrl: serverUrl, getToken: d.readToken }).post('/api/worker/sync/device-check', { device_id: Number(mk.device_id) || 0 });
          if (!['self', 'same_user_revoked', 'unknown'].includes(res && res.status)) return { code: 'other_device', real: r.real };
        } catch (e) {
          if (e.status === 400) return { code: 'other_device', real: r.real };
          return { code: 'check_failed', real: r.real };
        }
      }
    }
    if ((await (d.recycleNuke || recycleNuke)(r.real)) === 'on') return { code: 'recycle_off', real: r.real };
    return { code: '', real: r.real };
  }

  async function pick(owner, arg) {
    computeSuggestion();
    const s = settings();
    const sug = H.suggestion;
    let start = sug.ok && sug.exists ? sug.path : env.USERPROFILE;
    if (arg && arg.from === 'previous' && s.previousRoot && fs.existsSync(s.previousRoot)) start = s.previousRoot;
    if (arg && arg.from === 'created' && sug.ok && fs.existsSync(sug.path)) start = sug.path;
    if (arg && arg.from === 'parent' && s.root) start = path.dirname(s.root);

    const r = await dialog.showOpenDialog(owner, { title: '동기화할 논문 폴더 고르기', buttonLabel: '폴더 선택', defaultPath: start, properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const p = r.filePaths[0];
    H.pickError = null;
    onChange();
    const j = await judge(p);
    if (j.code) {
      H.pickError = { code: j.code, path: p };
      log.info('동기화 폴더 거부', { code: j.code });
      onChange();
      return { ok: false, code: j.code };
    }
    to({ type: 'probe', root: j.real });
    return { ok: true };
  }

  async function createSuggested(owner) {
    computeSuggestion();
    const sug = H.suggestion;
    if (!sug.ok || sug.exists) return pick(owner, {});
    try { fs.mkdirSync(sug.path); } catch { H.pickError = { code: 'create_failed', path: sug.path }; onChange(); return { ok: false, code: 'create_failed' }; }
    computeSuggestion();
    return pick(owner, { from: 'created' });
  }

  async function startSync(place) {
    if (!['local', 'library'].includes(place)) return { ok: false };
    const id = ++H.startSeq;
    const r = await new Promise((resolve) => {
      const done = (m) => { clearTimeout(t); H.startWaiters.delete(id); resolve(m); };
      const t = setTimeout(() => done({ ok: false, code: 'timeout' }), 120000);
      H.startWaiters.set(id, done);
      to({ type: 'start', place, id });
    });
    if (!r.ok && r.code === 'not_writable') { H.pickError = { code: 'not_writable', path: (H.state.preview && H.state.preview.root) || '' }; onChange(); }
    return { ok: !!r.ok, code: r.code || '' };
  }

  async function confirmOff(owner) {
    const r = await dialog.showMessageBox(owner, { type: 'question', title: 'PaperLab', message: '폴더 동기화를 끌까요?',
      detail: '이 PC의 파일과 서재는 그대로 남아요. 다시 쓰려면 폴더를 다시 고르고 미리보기에서 [시작]을 눌러야 해요.',
      buttons: ['끄기', '취소'], defaultId: 1, cancelId: 1, noLink: true });
    return r.response === 0;
  }

  /** 로컬 화면 동작(sync-*) — 입력은 이름 · 정해진 값 · 상대 경로만 */
  async function action(name, arg, owner) {
    const s = settings();
    switch (name) {
      case 'sync-pick': return pick(owner, arg && typeof arg === 'object' ? { from: ['previous', 'parent'].includes(arg.from) ? arg.from : '' } : {});
      case 'sync-create-suggested': return createSuggested(owner);
      case 'sync-start': return startSync(String((arg && arg.place) || ''));
      case 'sync-preview-place': if (['local', 'library'].includes(arg)) to({ type: 'preview-place', place: arg }); return true;
      case 'sync-preview-recheck': to({ type: 'preview-recheck' }); return true;
      case 'sync-cancel-preview': to({ type: 'cancel-preview' }); return true;
      case 'sync-pause': store.set({ sync: { ...s, paused: !!arg } }); to({ type: 'pause', on: !!arg }); onChange(); return true;
      case 'sync-now': to({ type: 'now' }); return true;
      case 'sync-confirm': {
        if (!arg || typeof arg !== 'object' || !CHOICES.has(arg.choice) || typeof arg.batch_id !== 'string') return false;
        if (arg.choice === 'off' && !(await confirmOff(owner))) return false;
        to({ type: 'confirm', batch_id: arg.batch_id.slice(0, 64), choice: arg.choice });
        return true;
      }
      case 'sync-off': if (!(await confirmOff(owner))) return false; to({ type: 'off' }); return true;
      case 'sync-open-folder': if (s.root && fs.existsSync(s.root)) shell.openPath(s.root); return true;
      case 'sync-open-archive': {
        const a = s.root && path.join(s.root, SYNC_DIR, '보관함');
        if (a && fs.existsSync(a)) shell.openPath(a);
        return true;
      }
      case 'sync-reveal': {
        const rel = typeof arg === 'string' ? arg.slice(0, 1000) : '';
        const abs = rel && s.root ? safeJoin(s.root, rel, { file: /\.pdf$/i.test(rel) }) : null;
        if (abs && fs.existsSync(abs)) shell.showItemInFolder(abs);
        return !!abs;
      }
      case 'sync-notify': store.set({ sync: { ...s, notify: !!arg } }); onChange(); return true;
      case 'sync-clear-error': H.pickError = null; onChange(); return true;
      default: return null;
    }
  }

  function localState() {
    const s = settings();
    const st = H.state || {};
    const out = {
      ...st, settings: { root: s.root, previousRoot: s.previousRoot || st.previousRoot || '', paused: s.paused, notify: s.notify, enabled: s.enabled },
      pickError: H.pickError || (st.pickError ? { code: st.pickError, path: st.previewRoot || '' } : null), suggestion: H.suggestion, focus: H.focus,
    };
    H.focus = '';
    return out;
  }

  return {
    start, stop, action, localState, state: () => H.state, settings,
    token: (t) => to({ type: 'token', token: t }), nudge: () => to({ type: 'nudge' }), focusOn: (f) => { H.focus = f; },
  };
}

module.exports = { createSyncHost, trashInRoot, readInstallId };
