'use strict';
// 여러 PC 시뮬레이터(fixtures/sync-sim.js — tests/test_desktop_sync.py 가 띄움) 자체 시험. DB · 실제 서버 없이 가짜 HTTP 서버로.
// 1) 새 서버(선택 동기화 D-7)처럼 X-PaperLab-Sync 2 미만이면 426 을 주는 서버에서도 시작까지 감 — 실제 앱(sync/entry.js)과 같은 머리글.
// 2) 실패(426 등)로 끝날 때 error 줄을 남기고 종료 코드 2 로 깨끗이 끝남 — fetch 응답 바로 뒤 process.exit() 로
//    libuv "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"(Windows Node 24)로 죽지 않음.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fakeServer, waitFor } = require('./helpers');

const SIM = path.join(__dirname, 'fixtures', 'sync-sim.js');
const TOKEN = 'pld1.11111111-2222-3333-4444-555555555555.7.secret';

/** sync-sim 하나 → {lines(파싱한 JSON · raw), text, done: Promise<code>, send(cmd)} */
function runSim(url) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-sim-'));
  const env = { ...process.env, SIM_NAME: 'sim', APPDATA: path.join(dir, 'roaming'), LOCALAPPDATA: path.join(dir, 'local') };
  const p = spawn(process.execPath, [SIM, url, 'CODE-0000', path.join(dir, 'root'), path.join(dir, 'state')],
    { cwd: path.join(__dirname, '..'), env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const r = { text: '', lines: [] };
  const take = (c) => {
    r.text += c;
    const parts = r.text.split('\n');
    r.lines = parts.filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { event: 'raw', line: l }; } });
  };
  p.stdout.setEncoding('utf8').on('data', take);
  p.stderr.setEncoding('utf8').on('data', take);
  r.done = new Promise((resolve) => p.on('exit', (code) => resolve(code)));
  r.send = (cmd) => { try { p.stdin.write(`${JSON.stringify(cmd)}\n`); } catch { /* 끝남 */ } };
  r.kill = () => { try { p.kill(); } catch { /* 끝남 */ } };
  r.seen = (ev) => r.lines.some((l) => l.event === ev);
  return r;
}

/** ms 뒤 'timeout' (시험 프로세스를 붙잡지 않음) */
const within = (ms) => new Promise((r) => setTimeout(() => r('timeout'), ms).unref());

/** 새 서버의 D-7 규칙: 동기화 요청에 X-PaperLab-Sync 2 이상이 없으면 426 */
function syncServer({ always426 = false } = {}) {
  const old = () => ({ http: 426, body: { code: 'update_required', min_app_version: '0.4.0', min_sync_protocol: 2 } });
  const v2 = (fn) => (body, req) => (always426 || !(Number(req.headers['x-paperlab-sync']) >= 2) ? old() : fn(body, req));
  return fakeServer({
    '/api/worker/pair': () => ({ device_id: 7, token: TOKEN }),
    '/api/worker/sync/snapshot': v2(() => ({ folders: [], papers: [], trashed: [], tombstones: [], cursor: 'c1', more: false, other_sync_devices: 0 })),
    '/api/worker/sync/start': v2(() => ({ server_time: new Date().toISOString(), protocol: 2 })),
    '/api/worker/sync/changes': v2(() => ({ changes: [], cursor: 'c1', more: false, next_poll_s: 60 })),
    '/api/worker/sync/*': v2(() => ({})),
  });
}

test('sync-sim: 동기화 요청마다 X-PaperLab-Sync 2 + 앱 버전으로 연결 → 새 서버에서 시작까지', { timeout: 60000 }, async () => {
  const srv = await syncServer();
  const sim = runSim(srv.url);
  try {
    assert.ok(await waitFor(() => sim.seen('started') || sim.seen('error'), 45000), sim.text);
    assert.ok(sim.seen('started'), sim.text);
    const syncCalls = srv.calls.filter((c) => c.path.startsWith('/api/worker/sync/'));
    assert.ok(syncCalls.length >= 2, JSON.stringify(syncCalls.map((c) => c.path)));
    for (const c of syncCalls) assert.equal(c.headers['x-paperlab-sync'], '2', c.path);
    const pair = srv.calls.find((c) => c.path === '/api/worker/pair');
    assert.equal(pair.body.app_version, require('../package.json').version);
    sim.send({ cmd: 'stop' });
    assert.equal(await Promise.race([sim.done, within(15000)]), 0, sim.text);
  } finally {
    sim.kill();
    await srv.close();
  }
});

test('sync-sim: 426 으로 미리보기 실패 → error 줄 + 종료 코드 2 (libuv 중단 없음)', { timeout: 90000 }, async () => {
  const srv = await syncServer({ always426: true });
  try {
    for (let i = 0; i < 2; i++) { // 고치기 전에는 매번 중단(0xC0000409)
      const sim = runSim(srv.url);
      const code = await Promise.race([sim.done, within(40000)]);
      if (code === 'timeout') sim.kill();
      assert.doesNotMatch(sim.text, /Assertion failed/, sim.text);
      assert.equal(code, 2, sim.text);
      const err = sim.lines.find((l) => l.event === 'error');
      assert.ok(err, sim.text);
      assert.equal(err.code, 'update_required');
    }
  } finally {
    await srv.close();
  }
});
