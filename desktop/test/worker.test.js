'use strict';
// 워커 ↔ 가짜 서버 (AC-53 · 54 · 58 · 62 · 63 · 64, 해지 · 리스 잃음 · 연결 끊김) — 실제 CLI · 운영 서버 없이
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('../worker/worker');
const { createApi } = require('../worker/api-client');
const { runTask, probeEngine } = require('../worker/cli-runner');
const { resolveEngine } = require('../worker/resolve-exe');
const { Logger } = require('../lib/log');
const { tempHome, makeShim, readLog, alive, waitFor, fakeServer } = require('./helpers');

const home = tempHome('pl-worker-');
const binDir = path.join(home, 'npm');
fs.mkdirSync(binDir, { recursive: true });
const shims = { claude: makeShim(binDir, 'claude'), codex: makeShim(binDir, 'codex'), gemini: makeShim(binDir, 'gemini') };
const logDir = path.join(home, 'AppData', 'Roaming', 'PaperLab', 'logs');
const TOKEN = `pld1.12345678-1234-1234-1234-123456789abc.7.${'A'.repeat(43)}`;
const PROMPT_MARK = 'PROMPT-MARK-7f3a9c';
const TEST_KEY = 'sk-ant-api03-TESTKEY0123456789abcdef';
let seq = 1000;
let logSeq = 0;

function makeWorker(server, { env = {}, settings = {}, pollTimers, emit } = {}) {
  const fakeLog = path.join(home, `fake-w${++logSeq}.log`); // 시험마다 따로
  const fullEnv = { ...process.env, FAKE_LOG: fakeLog, USERPROFILE: home, ...env };
  const settingsAll = { engines: { claude: { path: shims.claude, slots: 2 }, codex: { path: shims.codex }, gemini: { path: shims.gemini } }, totalSlots: 2, ...settings };
  const events = [];
  const w = new Worker({
    api: createApi({ baseUrl: server.url, getToken: () => w.token, timeoutMs: 5000 }),
    runTask, probe: (name, o) => probeEngine(name, { resolveEngine, env: fullEnv, ...o }),
    log: new Logger(path.join(logDir, 'worker.log')), emit: (m) => { events.push(m); if (emit) emit(m); },
    appVersion: '0.2.0', os: 'Windows 11 test', settings: settingsAll, token: TOKEN, workRoot: path.join(home, 'work'), env: fullEnv,
    pollTimers,
  });
  return { w, events, fakeLog };
}

function job(over = {}) {
  seq += 1;
  return { id: seq, lease_token: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`, lease_s: 90, heartbeat_s: 30, kind: 'summary',
    engine: 'claude', model: null, output: 'json', json_schema: null, stream_partial: false,
    system: `시스템 ${TEST_KEY}`, prompt: `<paper>${PROMPT_MARK}</paper>`, timeout_s: 60, ...over };
}

/** 한 번씩만 작업을 주는 claim 처리기 */
function queue(jobs, idle = 60) {
  const list = [...jobs];
  return () => (list.length ? { job: list.shift(), next_poll_s: 0 } : { job: null, next_poll_s: idle });
}

test('왕복: hello(엔진 광고) → claim → 실행 → result(원문) · 헤더(토큰 · X-PaperLab) · bye', async () => {
  const j = job();
  const results = [];
  const srv = await fakeServer({
    '/api/worker/hello': () => ({ device_id: 7, name: '집 PC', account_hint: 'a***@example.com', min_protocol: 1, min_app_version: '0.2.0', poll: { idle_s: 60, active_s: 5 } }),
    '/api/worker/claim': queue([j]),
    '/api/worker/jobs/*': (b) => { results.push(b); return { status: 'succeeded' }; },
    '/api/worker/bye': () => ({ ok: true }),
  });
  const { w, events } = makeWorker(srv);
  w.start();
  assert.ok(await waitFor(() => results.length === 1, 15000));
  const hello = srv.calls.find((c) => c.path === '/api/worker/hello');
  assert.equal(hello.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(hello.headers['x-paperlab'], '1');
  assert.equal(hello.headers.origin, undefined);
  assert.deepEqual(hello.body.engines.map((e) => [e.name, e.logged_in, e.slots]), [['claude', true, 2], ['codex', true, 1], ['gemini', false, 1]]);
  assert.equal(hello.body.protocol, 1);
  const claim = srv.calls.find((c) => c.path === '/api/worker/claim');
  assert.deepEqual(claim.body, { free: { claude: 2, codex: 1 }, paused: false });
  assert.equal(results[0].outcome, 'succeeded');
  assert.equal(results[0].lease_token, j.lease_token);
  assert.equal(results[0].text, '가짜 답 [p.1]');
  assert.ok(events.some((e) => e.type === 'hello' && e.deviceId === 7 && e.accountHint === 'a***@example.com'));
  await w.stop();
  assert.ok(srv.calls.some((c) => c.path === '/api/worker/bye'));
  await srv.close();
});

test('AC-64 적응형 폴링: next_poll_s 60 이면 60초 기다리고(시계 주입), nudge 면 바로 claim', async () => {
  const srv = await fakeServer({
    '/api/worker/hello': () => ({ device_id: 7, name: 'pc' }),
    '/api/worker/claim': () => ({ job: null, next_poll_s: 60 }),
  });
  const waits = [];
  const pollTimers = { setTimeout: (fn, ms) => { waits.push(ms); return 1; }, clearTimeout: () => {} };
  const { w } = makeWorker(srv, { pollTimers });
  w.start();
  const claims = () => srv.calls.filter((c) => c.path === '/api/worker/claim').length;
  assert.ok(await waitFor(() => claims() === 1 && waits.length === 1, 10000));
  assert.equal(waits[0], 60000);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(claims(), 1); // 가짜 시계라 60초가 지나지 않음
  w.nudge();
  assert.ok(await waitFor(() => claims() === 2, 3000));
  await w.stop({ bye: false });
  await srv.close();
});

test('AC-63 426 update_required: claim 을 더 하지 않고 상태 update_required', async () => {
  for (const where of ['hello', 'claim']) {
    const srv = await fakeServer({
      '/api/worker/hello': () => (where === 'hello' ? { http: 426, body: { code: 'update_required', min_app_version: '0.3.0' } } : { device_id: 7 }),
      '/api/worker/claim': () => ({ http: 426, body: { code: 'update_required' } }),
    });
    const { w, events } = makeWorker(srv);
    w.start();
    assert.ok(await waitFor(() => w.workerState() === 'update_required', 10000), where);
    const n = srv.calls.filter((c) => c.path === '/api/worker/claim').length;
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(srv.calls.filter((c) => c.path === '/api/worker/claim').length, n);
    assert.equal(n, where === 'hello' ? 0 : 1);
    assert.ok(events.some((e) => e.type === 'update-required'));
    await w.stop({ bye: false });
    await srv.close();
  }
});

test('AC-53 취소: 하트비트 응답 cancel:true → 1초 안에 프로세스 트리 종료 · cancelled 결과', async () => {
  const pidfile = path.join(home, 'cancel-pids.txt');
  const j = job({ heartbeat_s: 0.3 });
  let cancel = false;
  let cancelSentAt = 0;
  const results = [];
  const srv = await fakeServer({
    '/api/worker/hello': () => ({ device_id: 7 }),
    '/api/worker/claim': queue([j]),
    '/api/worker/heartbeat': (b) => {
      if (cancel && !cancelSentAt) cancelSentAt = Date.now();
      return { jobs: b.jobs.map((x) => ({ id: x.id, ok: true, lease_until: 'x', cancel })) };
    },
    '/api/worker/jobs/*': (b) => { results.push({ b, at: Date.now() }); return { status: 'cancelled' }; },
  });
  const { w } = makeWorker(srv, { env: { FAKE_MODE: 'sleep', FAKE_PIDFILE: pidfile } });
  w.start();
  assert.ok(await waitFor(() => fs.existsSync(pidfile), 10000));
  assert.ok(await waitFor(() => srv.calls.some((c) => c.path === '/api/worker/heartbeat'), 3000));
  const first = srv.calls.find((c) => c.path === '/api/worker/heartbeat');
  assert.equal(first.body.jobs[0].lease_token, j.lease_token);
  assert.equal(first.body.jobs[0].progress.message, 'claude 실행 중');
  cancel = true;
  assert.ok(await waitFor(() => results.length === 1, 5000));
  assert.equal(results[0].b.outcome, 'cancelled');
  assert.ok(results[0].at - cancelSentAt < 1000, `${results[0].at - cancelSentAt}ms`); // cancel:true 응답 → 1초 안에 끄고 보고
  const pids = fs.readFileSync(pidfile, 'utf8').trim().split(' ').map(Number);
  assert.ok(await waitFor(() => pids.every((p) => !alive(p)), 3000));
  await w.stop({ bye: false });
  await srv.close();
});

test('리스 잃음: 하트비트 ok:false → 프로세스를 끄고 결과를 올리지 않음', async () => {
  const pidfile = path.join(home, 'lost-pids.txt');
  const j = job({ heartbeat_s: 0.2 });
  const srv = await fakeServer({
    '/api/worker/hello': () => ({ device_id: 7 }),
    '/api/worker/claim': queue([j]),
    '/api/worker/heartbeat': (b) => ({ jobs: b.jobs.map((x) => ({ id: x.id, ok: false, code: 'lease_lost' })) }),
    '/api/worker/jobs/*': () => ({ status: 'succeeded' }),
  });
  const { w } = makeWorker(srv, { env: { FAKE_MODE: 'sleep', FAKE_PIDFILE: pidfile } });
  w.start();
  assert.ok(await waitFor(() => fs.existsSync(pidfile), 10000));
  assert.ok(await waitFor(() => w.running.size === 0, 5000));
  const pids = fs.readFileSync(pidfile, 'utf8').trim().split(' ').map(Number);
  assert.ok(await waitFor(() => pids.every((p) => !alive(p)), 3000));
  assert.equal(srv.calls.filter((c) => c.path.startsWith('/api/worker/jobs/')).length, 0);
  await w.stop({ bye: false });
  await srv.close();
});

test('AC-58 동시 실행: claude 자리 2 · 전체 2 에서 작업 5건 → 동시에 도는 CLI 최대 2개', async () => {
  const jobs = [job(), job(), job(), job(), job()];
  const results = [];
  const srv = await fakeServer({
    '/api/worker/hello': () => ({ device_id: 7 }),
    '/api/worker/claim': (b) => {
      const free = (b.free && b.free.claude) || 0;
      return free > 0 && jobs.length ? { job: jobs.shift(), next_poll_s: 0 } : { job: null, next_poll_s: 5 };
    },
    '/api/worker/jobs/*': (b) => { results.push(b); return { status: 'succeeded' }; },
  });
  const { w, fakeLog } = makeWorker(srv, { env: { FAKE_MODE: 'slow', FAKE_SLEEP_MS: '500' }, settings: { totalSlots: 2 } });
  w.start();
  assert.ok(await waitFor(() => results.length === 5, 30000));
  const recs = readLog(fakeLog);
  assert.equal(recs.length, 5);
  let max = 0;
  for (const r of recs) max = Math.max(max, recs.filter((o) => o.start < r.end && r.start < o.end).length);
  assert.equal(max, 2);
  for (const c of srv.calls.filter((x) => x.path === '/api/worker/claim')) assert.ok((c.body.free.claude || 0) <= 2);
  await w.stop({ bye: false });
  await srv.close();
});

test('AC-54 로그인 안 됨: 결과 cli_not_logged_in → 다시 탐지해 hello 에서 claude logged_in false · 자리 없음', async () => {
  const j = job();
  const results = [];
  const srv = await fakeServer({
    '/api/worker/hello': () => ({ device_id: 7 }),
    '/api/worker/claim': queue([j]), // 가짜 서버는 자리와 상관없이 한 번 줌(로그인이 끝난 뒤 만료된 경우 흉내)
    '/api/worker/jobs/*': (b) => { results.push(b); return { status: 'queued' }; },
  });
  const { w } = makeWorker(srv, { env: { FAKE_MODE: 'login', FAKE_LOGGED_OUT: '1' } });
  w.start();
  assert.ok(await waitFor(() => results.length === 1, 15000));
  assert.equal(results[0].outcome, 'failed');
  assert.equal(results[0].error_code, 'cli_not_logged_in');
  assert.ok(await waitFor(() => srv.calls.filter((c) => c.path === '/api/worker/hello').length >= 1, 5000));
  for (const hello of srv.calls.filter((c) => c.path === '/api/worker/hello')) {
    assert.equal(hello.body.engines.find((e) => e.name === 'claude').logged_in, false);
  }
  const claims = srv.calls.filter((c) => c.path === '/api/worker/claim');
  assert.equal(claims[0].body.free.claude, undefined); // 로그인 안 된 엔진은 자리를 내지 않음
  await w.stop({ bye: false });
  await srv.close();
});

test('해지(401 device_revoked): 실행 중 프로세스를 끄고 토큰을 버림 · token-invalid', async () => {
  const pidfile = path.join(home, 'revoke-pids.txt');
  const j = job({ heartbeat_s: 0.2 });
  const srv = await fakeServer({
    '/api/worker/hello': () => ({ device_id: 7 }),
    '/api/worker/claim': queue([j]),
    '/api/worker/heartbeat': () => ({ http: 401, body: { detail: '이 PC 연결이 해지됐어요', code: 'device_revoked' } }),
  });
  const { w, events } = makeWorker(srv, { env: { FAKE_MODE: 'sleep', FAKE_PIDFILE: pidfile } });
  w.start();
  assert.ok(await waitFor(() => events.some((e) => e.type === 'token-invalid'), 15000));
  assert.equal(events.find((e) => e.type === 'token-invalid').code, 'device_revoked');
  assert.equal(w.token, null);
  assert.equal(w.workerState(), 'revoked');
  const pids = fs.readFileSync(pidfile, 'utf8').trim().split(' ').map(Number);
  assert.ok(await waitFor(() => pids.every((p) => !alive(p)), 5000));
  assert.equal(srv.calls.filter((c) => c.path.startsWith('/api/worker/jobs/')).length, 0);
  await w.stop({ bye: false });
  await srv.close();
});

test('서버 연결 끊김: offline · 백오프 5초에서 두 배씩(최대 5분)', async () => {
  const srv = await fakeServer({});
  const url = srv.url;
  await srv.close();
  const waits = [];
  const pollTimers = { setTimeout: (fn, ms) => { waits.push(ms); setImmediate(fn); return 1; }, clearTimeout: () => {} };
  const { w } = makeWorker({ url }, { pollTimers });
  w.start();
  assert.ok(await waitFor(() => waits.length >= 8, 20000));
  await w.stop({ bye: false });
  assert.equal(w.workerState(), 'offline');
  assert.deepEqual(waits.slice(0, 8), [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]);
});

test('AC-62 로그에 프롬프트 · 기기 토큰 · 시험 키가 없음 (위 시험 전체의 worker.log)', () => {
  const text = fs.readFileSync(path.join(logDir, 'worker.log'), 'utf8');
  assert.ok(text.includes('작업 시작') && text.includes('작업 결과'));
  for (const bad of [PROMPT_MARK, TOKEN, TOKEN.split('.').pop(), TEST_KEY, '가짜 답']) assert.ok(!text.includes(bad), bad);
});

test('연결 전에도 엔진을 탐지(서버 요청 없음), 끈 엔진은 실행하지 않고 찾기만', async () => {
  const srv = await fakeServer({});
  const { w } = makeWorker(srv, { settings: { engines: { claude: { path: shims.claude }, codex: { path: shims.codex, enabled: false }, gemini: { path: shims.gemini, enabled: false } } } });
  w.token = null;
  w.start();
  assert.ok(await waitFor(() => w.lastProbe > 0, 10000));
  const e = Object.fromEntries(w.snapshot().engines.map((x) => [x.name, x]));
  assert.equal(w.workerState(), 'unpaired');
  assert.deepEqual([e.claude.installed, e.claude.version, e.claude.logged_in], [true, '2.1.300', true]);
  assert.deepEqual([e.codex.installed, e.codex.enabled, e.codex.version, e.codex.reason], [true, false, '', 'off']); // --version 도 부르지 않음
  assert.equal(srv.calls.length, 0);
  assert.deepEqual(w.advertised().map((x) => x.name), ['claude']);
  await w.stop({ bye: false });
  await srv.close();
});

test('F1 같은 작업 id 를 새 리스로 다시 잡음: 옛 실행을 끄고 끝난 뒤 새로 시작, 표 · 하트비트 · 결과는 새 리스만', async () => {
  let n = 0;
  const results = [];
  const hb = [];
  const A = '00000000-0000-0000-0000-00000000aaaa';
  const B = '00000000-0000-0000-0000-00000000bbbb';
  const mk = (lt) => job({ id: 6001, lease_token: lt, heartbeat_s: 0.3 });
  const srv = await fakeServer({
    '/api/worker/hello': () => ({ device_id: 7 }),
    '/api/worker/claim': () => {
      n += 1;
      if (n === 1) return { job: mk(A), next_poll_s: 0 };
      if (n === 2) return { job: mk(B), next_poll_s: 0 };
      return { job: null, next_poll_s: 60 };
    },
    '/api/worker/heartbeat': (b) => { hb.push(b.jobs.map((j) => j.lease_token)); return { jobs: b.jobs.map((j) => ({ id: j.id, ok: j.lease_token === B, cancel: false })) }; },
    '/api/worker/jobs/*': (b) => { results.push(b); return b.lease_token === B ? { status: 'succeeded' } : { http: 409, body: { code: 'lease_lost' } }; },
  });
  const { w, fakeLog } = makeWorker(srv, { env: { FAKE_MODE: 'slow', FAKE_SLEEP_MS: '1500' } });
  w.start();
  assert.ok(await waitFor(() => results.length === 1 && w.running.size === 0, 20000));
  assert.deepEqual(results.map((r) => [r.lease_token, r.outcome]), [[B, 'succeeded']]); // 옛 리스(A)는 결과를 올리지 않음
  assert.ok(hb.every((list) => list.length === 1 && list[0] === B), JSON.stringify(hb)); // 하트비트는 새 리스만
  const recs = readLog(fakeLog);
  assert.equal(recs.length, 1, JSON.stringify(recs.map((r) => [r.cwd, r.start, r.end]))); // 옛 실행은 끝나기 전에 꺼짐(결과를 쓰지 않음) — 새 실행만 끝까지
  assert.ok(recs[0].cwd.endsWith(`6001-${B.replace(/-/g, '')}`), recs[0].cwd);
  await w.stop({ bye: false });
  await srv.close();
});

test('F3 서버가 준 작업 id 가 양의 안전한 정수가 아니면 받지 않음(실행 · 결과 없음)', async () => {
  const bad = ['..\\..\\X', '7', -3, 0, 1.5, 2 ** 53, null];
  const srv = await fakeServer({
    '/api/worker/hello': () => ({ device_id: 7 }),
    '/api/worker/claim': () => (bad.length ? { job: job({ id: bad.shift() }), next_poll_s: 0 } : { job: null, next_poll_s: 60 }),
    '/api/worker/jobs/*': () => ({ status: 'succeeded' }),
  });
  const waits = [];
  const pollTimers = { setTimeout: (fn, ms) => { waits.push(ms); if (ms <= 5000) setImmediate(fn); return 1; }, clearTimeout: () => {} };
  const { w, fakeLog } = makeWorker(srv, { pollTimers });
  w.start();
  assert.ok(await waitFor(() => waits.includes(60000), 15000));
  assert.equal(w.running.size, 0);
  assert.equal(readLog(fakeLog).length, 0);
  assert.equal(srv.calls.filter((c) => c.path.startsWith('/api/worker/jobs/')).length, 0);
  assert.ok(!fs.existsSync(path.join(home, 'X')));
  await w.stop({ bye: false });
  await srv.close();
});

test('PAPERLAB_NO_DETECT: CLI 를 찾지도 실행하지도 않고 엔진 없음으로', async () => {
  const srv = await fakeServer({});
  const calls = [];
  const { w } = makeWorker(srv);
  w.noDetect = true;
  w.probe = (n) => { calls.push(n); return {}; };
  w.token = null;
  w.start();
  assert.ok(await waitFor(() => w.lastProbe > 0, 5000));
  assert.deepEqual(calls, []);
  assert.ok(w.snapshot().engines.every((e) => !e.installed && e.reason === 'detect_off'));
  await w.stop({ bye: false });
  await srv.close();
});

test('모델 대체 실행은 worker.log 에 한 줄', async () => {
  const results = [];
  const srv = await fakeServer({
    '/api/worker/hello': () => ({ device_id: 7 }),
    '/api/worker/claim': queue([job({ model: 'opus' })]),
    '/api/worker/jobs/*': (b) => { results.push(b); return { status: 'succeeded' }; },
  });
  const { w } = makeWorker(srv, { env: { FAKE_MODE: 'model' } });
  w.start();
  assert.ok(await waitFor(() => results.length === 1, 15000));
  assert.equal(results[0].stats.model_fallback, true);
  await w.stop({ bye: false });
  await srv.close();
  const text = fs.readFileSync(path.join(logDir, 'worker.log'), 'utf8');
  assert.match(text, /선택한 CLI 모델을 쓸 수 없어 기본 모델로 다시 실행함 .*model=opus/);
});
