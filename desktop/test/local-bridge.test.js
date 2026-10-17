'use strict';
// 로컬 파일 다리 · 보안 [Node] (docs/specs/selective-sync.md 9.1 · 9.2 · 11장 · 14장 S4x): checkInRoot(AC-S41) · IPC 처리기 출처 · 인자 · 횟수(AC-S42) ·
// 이 PC 보관 로컬 항목만(AC-S43) · window.uiFile(AC-S45) · 추출 창 · 추출 프로세스 관리(main/extract-host.js).
// 실제 동기화 엔진 + 가짜 서버(v2)에 main 쪽 sync-host 를 가짜 utilityProcess 로 이어 붙인다. Electron 은 require.cache 의 가짜 모듈.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { setup, TOKEN } = require('./sync-harness');
const M = require('./fixtures/make-office');
const { extractText } = require('../extract/parse');

// ---------------------------------------------------------------- 가짜 electron (ipc.js · window.js 가 require)
const handlers = { handle: new Map(), on: new Map() };
const fakeElectron = {
  ipcMain: { handle: (c, fn) => handlers.handle.set(c, fn), on: (c, fn) => handlers.on.set(c, fn) },
  BrowserWindow: function BrowserWindow() {}, shell: {}, protocol: { registerSchemesAsPrivileged() {} }, screen: {},
};
require.cache[require.resolve('electron')] = { id: 'electron', filename: 'electron', loaded: true, exports: fakeElectron };
const ipc = require('../main/ipc');
const { uiFile, extractFile, EXTRACT_CSP, LOCAL_CSP } = require('../main/window');
const { createSyncHost, checkInRoot } = require('../main/sync-host');
const { createExtractHost, clampPages, unpacked } = require('../main/extract-host');

// ---------------------------------------------------------------- AC-S41 checkInRoot
test('AC-S41 checkInRoot: 루트 밖 · .. · 정션 상위 · UNC · \\\\?\\ · 확장자 밖 · 없음 · 너무 큼 → 거부, 루트 안 일반 파일만', () => {
  const env = setup();
  const ok = env.write('폴더\\a.pdf', 'A');
  assert.deepEqual(checkInRoot(ok, env.root), { ok: true, size: fs.statSync(ok).size });
  const outside = path.join(env.home, 'outside.pdf');
  fs.writeFileSync(outside, 'x');
  assert.equal(checkInRoot(outside, env.root).code, 'path');
  assert.equal(checkInRoot(path.join(env.root, '..', 'outside.pdf'), env.root).code, 'path');
  assert.equal(checkInRoot(`\\\\server\\share\\a.pdf`, env.root).code, 'path');
  assert.equal(checkInRoot(`\\\\?\\${ok}`, env.root).code, 'path');
  assert.equal(checkInRoot('폴더\\a.pdf', env.root).code, 'path', '상대 경로');
  const exe = path.join(env.root, 'run.exe');
  fs.writeFileSync(exe, 'MZ');
  assert.equal(checkInRoot(exe, env.root).code, 'path');
  assert.equal(checkInRoot(path.join(env.root, '없음.pdf'), env.root).code, 'missing');
  assert.equal(checkInRoot(ok, env.root, { maxBytes: 3 }).code, 'too_big');
  assert.equal(checkInRoot(path.join(env.root, '폴더'), env.root).code, 'path', '디렉터리');
  // 정션: 루트 안 정션이 루트 밖을 가리킴 → 그 아래 파일은 거부
  const target = path.join(env.home, '밖');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'b.pdf'), 'B');
  fs.symlinkSync(target, path.join(env.root, '연결'), 'junction');
  assert.equal(checkInRoot(path.join(env.root, '연결', 'b.pdf'), env.root).code, 'path');
});

// ---------------------------------------------------------------- 가짜 utilityProcess 로 sync-host ↔ 엔진
function bridgeHost(env, engine, { tamper = null, shell = {}, extract = null } = {}) {
  const data = { sync: { enabled: true, root: env.root, installId: 'I1', previousRoot: '', paused: false, notify: true } };
  const child = { handlers: {}, posted: [], kill() {} };
  child.on = (ev, fn) => { child.handlers[ev] = fn; };
  child.once = (ev, fn) => { child.handlers[`once:${ev}`] = fn; };
  child.postMessage = (m) => {
    child.posted.push(m);
    setImmediate(() => {
      if (m.type === 'resolve') { let r = engine.resolveLocal(m.paper_id); if (tamper) r = tamper(r); child.handlers.message({ type: 'resolve-result', id: m.id, ...r }); }
      if (m.type === 'local-has') child.handlers.message({ type: 'local-has-result', id: m.id, map: engine.localHas(m.ids) });
    });
  };
  const logs = [];
  const h = createSyncHost({
    utilityProcess: { fork: () => child }, shell, dialog: {}, store: { get: (k) => data[k], set: (p) => Object.assign(data, p) },
    log: { info: (msg, f) => logs.push([msg, f]), warn: (msg, f) => logs.push([msg, f]), error() {} },
    serverUrl: 'http://127.0.0.1:9', userData: () => env.home, appVersion: '0.4.0', isPackaged: false, onChange() {}, balloon() {},
    readToken: () => TOKEN, env: { USERPROFILE: '' }, readInstallId: async () => 'I1', extract,
  });
  return { h, child, data, logs, ready: async () => { await h.start(); await child.handlers.message({ type: 'state', state: 'idle', proto: 2, counts: {} }); } };
}

async function localWorld() {
  const env = setup({ protocol: 2 });
  env.api.folder('개인', null, 'local');
  env.writeBytes('개인\\보고서.docx', M.docx(['PaperLab 시험 문서 가나다 ABC']));
  env.write('개인\\논문.pdf', 'LOCALPDF');
  env.writeBytes('개인\\옛 발표.ppt', Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]));
  env.writeBytes('개인\\사진.png', Buffer.from('\x89PNG\r\n\x1a\n0000', 'latin1'));
  env.write('공개.pdf', 'CLOUD');
  const e = await env.connect(env.make());
  const id = (name) => env.api.live().find((p) => p.file_name === name).id;
  return { env, e, id };
}

test('AC-S43 localFile: 이 PC 보관 로컬 항목만 바이트(ArrayBuffer) · 이름 · 해시, 켬 항목 · 없는 id → not_local, 꺼짐 → sync_off · 로그에 이름 · 경로 없음', async () => {
  const { env, e, id } = await localWorld();
  const b = bridgeHost(env, e);
  await b.ready();
  const r = await b.h.localFile(id('논문.pdf'));
  assert.equal(r.ok, true);
  assert.ok(r.data instanceof ArrayBuffer);
  assert.deepEqual(Buffer.from(r.data), env.read('개인\\논문.pdf'));
  assert.deepEqual([r.name, r.ext, r.size], ['논문.pdf', '.pdf', env.read('개인\\논문.pdf').length]);
  assert.equal(r.sha256, crypto.createHash('sha256').update(env.read('개인\\논문.pdf')).digest('hex'));
  assert.equal((await b.h.localFile(id('공개.pdf'))).code, 'not_local');
  assert.equal((await b.h.localFile(987654)).code, 'not_local');
  assert.deepEqual(await b.h.localHas([id('논문.pdf'), id('공개.pdf'), 987654]), { [id('논문.pdf')]: 'here' });
  assert.deepEqual(b.h.syncInfo(), { syncProtocol: 2, syncOn: true });
  b.data.sync.enabled = false;
  assert.equal((await b.h.localFile(id('논문.pdf'))).code, 'sync_off');
  assert.deepEqual(await b.h.localHas([id('논문.pdf')]), {});
  assert.ok(!JSON.stringify(b.logs).includes('논문') && !JSON.stringify(b.logs).includes(env.root));
});

test('AC-S41 main 은 엔진을 믿지 않음: 루트 밖 · 실행 파일 위치를 주면 path, 해시가 저널과 다르면 changed(검사와 읽기 사이 바뀜)', async () => {
  const { env, e, id } = await localWorld();
  const outside = path.join(env.home, '비밀.pdf');
  fs.writeFileSync(outside, 'secret');
  let mode = 'outside';
  const shell = { opened: [], openPath: async (p) => { shell.opened.push(p); return ''; } };
  const b = bridgeHost(env, e, { shell, tamper: (r) => {
    if (mode === 'outside') return { ...r, abs: outside, size: 6 };
    if (mode === 'exe') { const exe = path.join(env.root, '개인', 'x.exe'); fs.writeFileSync(exe, 'MZ'); return { ...r, abs: exe, size: 2 }; }
    if (mode === 'sha') return { ...r, sha256: 'f'.repeat(64) };
    return r;
  } });
  await b.ready();
  const pid = id('논문.pdf');
  assert.equal((await b.h.localFile(pid)).code, 'path');
  assert.equal((await b.h.openLocal(pid)).code, 'path');
  mode = 'exe';
  assert.equal((await b.h.openLocal(pid)).code, 'path', '실행 파일은 열지 않음');
  mode = 'sha';
  assert.equal((await b.h.localFile(pid)).code, 'changed');
  mode = '';
  assert.deepEqual(await b.h.openLocal(pid), { ok: true, code: '' });
  assert.deepEqual(shell.opened, [path.join(env.root, '개인', '논문.pdf')]);
});

test('AC-S42 횟수 제한: 동시 2 · 분당 30 — 넘으면 busy', async () => {
  const { env, e, id } = await localWorld();
  const b = bridgeHost(env, e);
  await b.ready();
  const pid = id('논문.pdf');
  const three = await Promise.all([b.h.localFile(pid), b.h.localFile(pid), b.h.localFile(pid)]);
  assert.deepEqual(three.map((r) => r.ok || r.code), [true, true, 'busy']);
  const rest = [];
  for (let i = 0; i < 30; i++) rest.push(await b.h.localFile(pid));
  assert.equal(rest.filter((r) => r.ok).length, 28, '분당 30 (앞의 2 포함)');
  assert.equal(rest[rest.length - 1].code, 'busy');
});

test('9.2 localText: 형식별로 추출 경로를 고르고(PDF 창 · 문서 프로세스), 옛 .ppt → local_unsupported, 사진 → local_no_text, 해시 다름 → local_file', async () => {
  const { env, e, id } = await localWorld();
  const used = [];
  const extract = {
    extractPdf: async (bytes) => { used.push(['pdf', bytes.length]); return { ok: true, pages: ['pdf 글'] }; },
    extractDoc: async (ext, bytes) => { used.push([ext, bytes.length]); return { ok: true, pages: await extractText(ext, bytes) }; },
  };
  const b = bridgeHost(env, e, { extract });
  await b.ready();
  const sha = (name) => e.J.files[id(name)].sha256;
  assert.deepEqual(await b.h.localText(id('보고서.docx'), sha('보고서.docx')), { ok: true, pages: ['PaperLab 시험 문서 가나다 ABC'] });
  assert.deepEqual(await b.h.localText(id('논문.pdf'), sha('논문.pdf')), { ok: true, pages: ['pdf 글'] });
  assert.deepEqual(await b.h.localText(id('공개.pdf'), sha('공개.pdf')), { ok: true, pages: ['pdf 글'] }, '켬 항목도 AI 본문은 이 PC 파일에서(9.2)');
  assert.deepEqual(await b.h.localText(id('옛 발표.ppt'), sha('옛 발표.ppt')), { ok: false, code: 'local_unsupported' });
  assert.deepEqual(await b.h.localText(id('사진.png'), sha('사진.png')), { ok: false, code: 'local_no_text' });
  assert.deepEqual(await b.h.localText(id('보고서.docx'), 'b'.repeat(64)), { ok: false, code: 'local_file' });
  assert.deepEqual(await b.h.localText(id('보고서.docx'), 'nope'), { ok: false, code: 'local_file' });
  assert.deepEqual(used.map((u) => u[0]), ['.docx', 'pdf', 'pdf']);
});

// ---------------------------------------------------------------- AC-S42 IPC 처리기
const SERVER = 'https://paperlab.example';
const calls = [];
const ctl = {
  localFile: (id) => { calls.push(['localFile', id]); return { ok: true }; }, openLocal: (id) => { calls.push(['openLocal', id]); return { ok: true }; },
  localHas: (ids) => { calls.push(['localHas', ids]); return {}; }, extractReady: () => calls.push(['ready']), extractDone: (_s, id, pages, code) => calls.push(['done', id, pages, code]),
  localState: () => ({}), localAction: () => null, info: () => ({}),
};
ipc.register(ctl, { serverOrigin: SERVER, log: { warn() {} } });
const ev = (url, parent = null) => ({ senderFrame: { url, parent }, sender: {} });

test('AC-S42 pl:local-*: 서버 출처 최상위 프레임만(하위 프레임 · 다른 출처 · app:// 거부), id 는 양의 안전한 정수만, 배열은 500개까지', async () => {
  const file = handlers.handle.get('pl:local-file');
  const has = handlers.handle.get('pl:local-has');
  calls.length = 0;
  assert.equal(await file(ev(`${SERVER}/#/reader/5`), 5).ok, true);
  assert.equal(await file(ev(`${SERVER}/x`, {}), 5), null, '하위 프레임');
  assert.equal(await file(ev('https://evil.example/'), 5), null, '다른 출처');
  assert.equal(await file(ev('app://ui/status.html'), 5), null, 'app:// 프레임');
  assert.equal(await file(ev('app://ui/extract.html'), 5), null, '추출 창');
  for (const bad of [0, -1, 1.5, '5', null, 2 ** 60, NaN]) assert.deepEqual(await file(ev(`${SERVER}/`), bad), { ok: false, code: 'not_local' });
  await handlers.handle.get('pl:open-local')(ev(`${SERVER}/`), 7);
  await has(ev(`${SERVER}/`), [...Array.from({ length: 600 }, (_v, i) => i + 1), 'x', -3]);
  assert.deepEqual(await has(ev(`${SERVER}/`), 'nope'), {});
  assert.deepEqual(calls.map((c) => c[0]), ['localFile', 'openLocal', 'localHas']);
  assert.equal(calls[2][1].length, 500);
});

test('11장 2 추출 채널: extract:* 는 app://ui/extract.html 최상위 프레임만, 그 창은 local:* 를 못 씀', async () => {
  calls.length = 0;
  handlers.on.get('extract:done')(ev('app://ui/extract.html'), 1, ['a'], '');
  handlers.on.get('extract:done')(ev('app://ui/status.html'), 1, ['b'], '');
  handlers.on.get('extract:done')(ev(`${SERVER}/`), 1, ['c'], '');
  handlers.on.get('extract:ready')(ev('app://ui/extract.html', {}));
  assert.deepEqual(calls, [['done', 1, ['a'], '']]);
  assert.equal(ipc.isLocalSender({ url: 'app://ui/extract.html', parent: null }), false);
  assert.equal(ipc.isLocalSender({ url: 'app://ui/status.html', parent: null }), true);
  assert.equal(await handlers.handle.get('local:state')(ev('app://ui/extract.html')), null);
});

// ---------------------------------------------------------------- AC-S45 window.uiFile
test('AC-S45 uiFile: 평평한 이름 + 정확히 두 vendor 경로만(PDF.js), 다른 .mjs · 하위 폴더 · .. 는 null · 추출 세션은 네 파일만', () => {
  const ui = (p) => uiFile(`app://ui/${p}`);
  assert.ok(ui('status.html').endsWith(path.join('ui', 'status.html')));
  assert.ok(ui('vendor/pdf.min.mjs').endsWith(path.join('ui', 'vendor', 'pdf.min.mjs')));
  assert.ok(ui('vendor/pdf.worker.min.mjs').endsWith(path.join('ui', 'vendor', 'pdf.worker.min.mjs')));
  for (const bad of ['vendor/other.mjs', 'vendor/..%2Fmain.js', 'vendor/../../main/main.js', 'x.mjs', 'vendor/pdf.min.mjs.map', 'sub/a.js', 'vendor%2Fpdf.min.mjs']) assert.equal(ui(bad), null, bad);
  assert.equal(uiFile('app://other/vendor/pdf.min.mjs'), null);
  assert.ok(extractFile('app://ui/extract.html'));
  assert.ok(extractFile('app://ui/vendor/pdf.worker.min.mjs'));
  assert.equal(extractFile('app://ui/status.html'), null);
  assert.equal(extractFile('app://ui/status.js'), null);
  assert.equal(EXTRACT_CSP, `${LOCAL_CSP}; worker-src 'self'`);
  assert.match(LOCAL_CSP, /connect-src 'none'/);
});

// ---------------------------------------------------------------- 추출 관리(main/extract-host.js)
function fakeUtility(behaviors) {
  const forks = [];
  return {
    forks,
    fork: (file, args, opts) => {
      const c = { file, opts, handlers: {}, killed: false, posted: [] };
      c.on = (e, fn) => { c.handlers[e] = fn; };
      c.kill = () => { c.killed = true; };
      c.postMessage = (m) => { c.posted.push(m); setImmediate(() => behaviors.onPost(c, m)); };
      forks.push(c);
      setImmediate(() => behaviors.onFork(c, forks.length));
      return c;
    },
  };
}

test('추출 프로세스: 권한 모델(--permission)로 먼저 띄우고, 못 뜨면 플래그 없이 · 결과 상한(2,000조각 · 8MB) · 죽으면 local_unreadable 뒤 다시 띄움', async () => {
  let crash = false;
  const up = fakeUtility({
    onFork: (c, n) => { if (n === 1) c.handlers.exit(1); else c.handlers.message({ type: 'ready', permission: false }); },
    onPost: (c, m) => {
      if (crash) { c.handlers.exit(1); return; }
      c.handlers.message({ type: 'result', id: m.id, ok: true, pages: Array.from({ length: 2100 }, () => 'x') });
    },
  });
  const logs = [];
  const host = createExtractHost({ utilityProcess: up, log: { info: (m, f) => logs.push([m, f]) } });
  const r = await host.extractDoc('.docx', Buffer.from('PK'));
  assert.equal(r.pages.length, 2000);
  assert.deepEqual(up.forks[0].opts.execArgv.slice(0, 1), ['--permission']);
  assert.ok(up.forks[0].opts.execArgv.includes('--allow-worker'));
  assert.deepEqual(up.forks[1].opts.execArgv, []);
  assert.equal(up.forks[1].opts.serviceName, 'PaperLab Extract');
  crash = true;
  assert.deepEqual(await host.extractDoc('.docx', Buffer.from('PK')), { ok: false, code: 'local_unreadable' });
  crash = false;
  assert.equal((await host.extractDoc('.docx', Buffer.from('PK'))).ok, true, '다시 띄움');
  assert.equal(up.forks.length, 3);
  assert.ok(!JSON.stringify(logs).includes('"x"'));
  host.stop();
  assert.equal(clampPages(['가'.repeat(2 * 1024 * 1024), '나'.repeat(1024 * 1024), '다']).length, 1, '8MB(6MB + 3MB 에서 멈춤)');
  assert.deepEqual(clampPages(['a', 5, null]), ['a', '', '']);
  assert.equal(unpacked('C:\\P\\resources\\app.asar\\extract\\entry.js'), 'C:\\P\\resources\\app.asar.unpacked\\extract\\entry.js');
});

test('PDF 추출 창: 준비 신호(그 창에서만) 뒤에 바이트를 보내고 결과를 받으면 창을 닫음, 다른 창의 결과는 무시 · 한 번에 하나', async () => {
  const wins = [];
  const host = createExtractHost({ utilityProcess: { fork() { throw new Error('no'); } }, log: { info() {} }, openPdfWindow: () => {
    const wc = { sent: [], once() {}, send: (c, job) => wc.sent.push([c, job]) };
    const win = { webContents: wc, destroyed: false, isDestroyed: () => win.destroyed, destroy: () => { win.destroyed = true; } };
    wins.push(win);
    return win;
  } });
  const p1 = host.extractPdf(Buffer.from('%PDF-1'));
  const p2 = host.extractPdf(Buffer.from('%PDF-2'));
  assert.equal(wins.length, 1, '한 번에 하나');
  host.onReady({});
  assert.equal(wins[0].webContents.sent.length, 0, '다른 창의 준비 신호는 무시');
  host.onReady(wins[0].webContents);
  host.onReady(wins[0].webContents);
  assert.equal(wins[0].webContents.sent.length, 1);
  const [ch, job] = wins[0].webContents.sent[0];
  assert.equal(ch, 'extract:job');
  assert.equal(Buffer.from(job.data).toString(), '%PDF-1');
  host.onDone({}, 1, ['남의 글'], '');
  host.onDone(wins[0].webContents, 1, ['1쪽', 2, '3쪽'], '');
  assert.deepEqual(await p1, { ok: true, pages: ['1쪽', '', '3쪽'] });
  assert.ok(wins[0].destroyed);
  assert.equal(wins.length, 2);
  host.onReady(wins[1].webContents);
  host.onDone(wins[1].webContents, 1, [], 'local_no_text');
  assert.deepEqual(await p2, { ok: false, code: 'local_no_text' });
});
