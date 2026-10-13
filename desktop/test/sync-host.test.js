'use strict';
// main 쪽 폴더 동기화(sync-host) · 품질팀 회귀(D1 · D2 · D3 · D6): 재설치 뒤 [다시 연결…], 대기 중 되살림, tmp 정리, 설치 ID 읽기 실패
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSyncHost, readInstallId } = require('../main/sync-host');
const { setup, TOKEN } = require('./sync-harness');

function host(env, sync, extra = {}) {
  const posted = [];
  const opened = [];
  const data = { sync: { ...sync } };
  const store = { get: (k) => data[k], set: (p) => Object.assign(data, p) };
  const child = { on() {}, once() {}, postMessage: (m) => posted.push(m), kill() {} };
  const h = createSyncHost({
    utilityProcess: { fork: () => child }, shell: {}, store, log: { info() {}, warn() {}, error() {} },
    dialog: { showOpenDialog: async (_o, opts) => { opened.push(opts); return { canceled: false, filePaths: [extra.pick || env.root] }; } },
    serverUrl: 'http://127.0.0.1:9', userData: () => env.home, appVersion: '0.3.0', isPackaged: false, onChange() {}, balloon() {},
    readToken: () => TOKEN, env: { USERPROFILE: path.join(env.home, '없는 사용자') }, // 임시 폴더가 AppData 아래라 그 거부만 뺀 환경
    readInstallId: async () => ('installId' in extra ? extra.installId : 'I2'), rootDeps: { driveType: async () => 'Fixed' }, recycleNuke: async () => 'off',
  });
  return { h, posted, opened, data };
}

test('D1 · AC-673b 재설치(설치 ID 다름) → 설정은 꺼짐 + 전에 쓰던 폴더, [다시 연결…]은 그 폴더에서 열려 살펴보기로 이어짐(겹침 거부 없음)', async () => {
  const env = setup();
  env.write('a.pdf', 'A');
  const e = await env.connect(env.make());
  e.stop();
  const journalBefore = fs.readFileSync(env.journalFile);
  const { h, posted, opened, data } = host(env, { enabled: true, root: env.root, installId: 'I1', previousRoot: '', paused: false, notify: true });
  await h.start();
  assert.deepEqual([data.sync.enabled, data.sync.root, data.sync.previousRoot], [false, '', env.root]);
  assert.equal(posted.find((m) => m.type === 'init').settings.enabled, false);
  assert.deepEqual(fs.readFileSync(env.journalFile), journalBefore, '저널은 건드리지 않음');
  assert.ok(fs.existsSync(path.join(env.root, 'a.pdf')));
  const r = await h.action('sync-pick', { from: 'previous' }, null);
  assert.equal(opened[0].defaultPath, env.root);
  assert.deepEqual(r, { ok: true });
  assert.equal(h.localState().pickError, null);
  const probe = posted.find((m) => m.type === 'probe');
  assert.ok(probe && probe.root.toLowerCase() === fs.realpathSync.native(env.root).toLowerCase());
});

test('D1 같은 설치 ID(업데이트)면 설정을 바꾸지 않음 · 설치 ID 를 못 읽으면(빈 값) 설정 그대로 두고 꺼짐', async () => {
  const env = setup();
  const s = { enabled: true, root: env.root, installId: 'I1', previousRoot: '', paused: false, notify: true };
  const same = host(env, s, { installId: 'I1' });
  await same.h.start();
  assert.deepEqual(same.data.sync, s);
  const failed = host(env, s, { installId: '' });
  await failed.h.start();
  assert.deepEqual(failed.data.sync, s);
  assert.equal(failed.posted.find((m) => m.type === 'init').installId, '');
});

test('D6 설치 ID: 읽기 실패(시간 초과 · 실행 못 함)는 새로 쓰지 않음, "값 없음"(종료 코드 1)일 때만 reg add', async () => {
  const calls = [];
  const reg = (seq) => async (cmd, args) => { calls.push(args[0]); return seq.shift(); };
  assert.equal(await readInstallId({ packaged: true, reg: reg([{ code: null, out: '' }]) }), '');
  assert.deepEqual(calls.splice(0), ['query']);
  const id = await readInstallId({ packaged: true, reg: reg([{ code: 1, out: '' }, { code: 0, out: '' }]) });
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls.splice(0), ['query', 'add']);
  assert.equal(await readInstallId({ packaged: true, reg: reg([{ code: 1, out: '' }, { code: 5, out: '' }]) }), '');
  calls.length = 0;
  const v = await readInstallId({ packaged: true, reg: reg([{ code: 0, out: '    InstallId    REG_SZ    3B0F1C2E-AAAA-BBBB-CCCC-1234567890AB\r\n' }]) });
  assert.equal(v, '3b0f1c2e-aaaa-bbbb-cccc-1234567890ab');
  assert.deepEqual(calls, ['query']);
  assert.equal(await readInstallId({ packaged: true, reg: reg([{ code: 0, out: 'garbage' }]) }), '');
  assert.equal(await readInstallId({ packaged: false, env: { PAPERLAB_INSTALL_ID: 'x' } }), 'x');
});

test('D2 서재 → PC 대량 삭제 대기 중 다른 곳에서 되살리면 대기가 풀리고, 그 뒤 PC 삭제도 반영됨', async () => {
  const env = setup();
  for (let i = 0; i < 12; i++) env.write(`h${i}.pdf`, `H${i}`);
  const e = await env.connect(env.make());
  await env.spin(e, 2);
  const ids = [...env.api.papers.keys()];
  for (const id of ids.slice(0, 11)) env.api.webTrash(id);
  await env.spin(e, 3);
  assert.equal(e.snapshot().state, 'waiting_confirm');
  for (const id of ids.slice(0, 11)) env.api.webRestore(id);
  await env.spin(e, 2);
  assert.equal(e.snapshot().state, 'idle');
  assert.equal(env.trashed.length, 0);
  fs.unlinkSync(path.join(env.root, 'h11.pdf'));
  await env.spin(e, 2);
  assert.equal(env.api.opCount('file.delete'), 1);
});

test('D3 시작 때 .paperlab-sync\\tmp 바로 아래 *.part 만 지우고 다른 파일은 그대로, tmp 안 파일은 올리지 않음', async () => {
  const env = setup();
  env.write('a.pdf', 'A');
  const e = await env.connect(env.make());
  e.stop();
  const tmp = path.join(env.root, '.paperlab-sync', 'tmp');
  fs.writeFileSync(path.join(tmp, 'deadbeef.part'), 'half');
  fs.writeFileSync(path.join(tmp, 'other.pdf'), 'x');
  fs.mkdirSync(path.join(tmp, 'sub.part'));
  env.api.calls.length = 0;
  const e2 = env.make({ settings: { enabled: true, root: env.root, installId: 'I1' } });
  await e2.start();
  await env.spin(e2, 2);
  assert.ok(!fs.existsSync(path.join(tmp, 'deadbeef.part')));
  assert.ok(fs.existsSync(path.join(tmp, 'other.pdf')));
  assert.ok(fs.existsSync(path.join(tmp, 'sub.part')));
  assert.equal(env.api.count('/api/worker/sync/upload-slots') + env.api.count('/api/worker/sync/files/add'), 0);
});
