'use strict';
// agy (Google Antigravity CLI) 엔진 — 가짜 agy(test/fixtures/fake-agy.js)로만. 진짜 agy 는 이 PC에서 실행하지 않는다.
// 찾기(PATH · %LOCALAPPDATA%\agy\bin) · 탐지('agy models' = 로그인 + 모델) · 명령(stdin stream-json, 늘 --sandbox --mode plan
// --disable-slash-commands) · 진행 글(text_delta) · 결과(result.response) · 오류 대응 · 허락/질문 이벤트 → 끄고 실패 · 취소 · 시간 제한.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveEngine } = require('../worker/resolve-exe');
const { runTask, probeEngine, checkLogin } = require('../worker/cli-runner');
const E = require('../worker/engines');
const { Worker, normalizeSettings } = require('../worker/worker');
const { tempHome, makeShim, readLog, alive, waitFor } = require('./helpers');

const home = tempHome('pl-agy-');
const binDir = path.join(home, 'npm');
fs.mkdirSync(binDir, { recursive: true });
const shim = makeShim(binDir, 'agy');
const workRoot = path.join(home, 'AppData', 'Local', 'PaperLab', 'work');
const logFile = path.join(home, 'fake.log');
const baseEnv = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`, FAKE_LOG: logFile, USERPROFILE: home };
const resolved = resolveEngine('agy', { customPath: shim, env: baseEnv });
const MODELS = ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low', 'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium'];
const modelList = MODELS.map((id) => ({ id, label: id }));
let nextId = 500;

function task(over = {}) {
  return { id: nextId++, engine: 'agy', kind: 'chat', model: null, effort: null, output: 'text', json_schema: null, stream_partial: true,
    system: '당신은 연구 조수입니다.', prompt: '<paper>본문 "따옴표" & 😀\n둘째 줄</paper>', timeout_s: 60, lease_token: 'x', ...over };
}
function run(t, env = {}, opts = {}) {
  return runTask(t, { resolved, workRoot, env: { ...baseEnv, ...env }, ...opts });
}
const lastRecord = () => { const all = readLog(logFile); return all[all.length - 1]; };
const flagVal = (argv, f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
test.beforeEach(() => { try { fs.rmSync(logFile); } catch { /* 없음 */ } });

test('찾기: PATH 의 agy.exe, 없으면 %LOCALAPPDATA%\\agy\\bin\\agy.exe — antigravity.cmd(IDE 실행기)는 쓰지 않음', () => {
  const local = path.join(home, 'LocalAppData');
  const agyBin = path.join(local, 'agy', 'bin');
  const ide = path.join(local, 'Programs', 'Antigravity', 'bin');
  fs.mkdirSync(agyBin, { recursive: true });
  fs.mkdirSync(ide, { recursive: true });
  fs.writeFileSync(path.join(ide, 'antigravity.cmd'), '@echo off\r\n');
  fs.writeFileSync(path.join(ide, 'agy.cmd'), '@echo off\r\n'); // 있어도 PATH 에 없으면 보지 않음
  // PATH 에 없음 → 설치 폴더 대체
  assert.equal(resolveEngine('agy', { env: { PATH: ide.replace(/bin$/, 'nothing'), LOCALAPPDATA: local } }).ok, false);
  fs.writeFileSync(path.join(agyBin, 'agy.exe'), '');
  const r = resolveEngine('agy', { env: { PATH: path.join(home, 'nothing'), LOCALAPPDATA: local } });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'exe');
  assert.equal(r.command, path.join(agyBin, 'agy.exe'));
  // PATH 의 agy.exe 가 먼저
  const onPath = path.join(home, 'onpath');
  fs.mkdirSync(onPath, { recursive: true });
  fs.writeFileSync(path.join(onPath, 'agy.exe'), '');
  assert.equal(resolveEngine('agy', { env: { PATH: onPath, LOCALAPPDATA: local } }).command, path.join(onPath, 'agy.exe'));
  // 다른 엔진은 agy 폴더를 보지 않음
  assert.equal(resolveEngine('gemini', { env: { PATH: path.join(home, 'nothing'), LOCALAPPDATA: local } }).ok, false);
});

test('명령: stdin stream-json 한 줄, -p= · --sandbox · --mode plan · --disable-slash-commands 늘, 위험 플래그 · 경로 없음', () => {
  const t = task({ prompt: 'PROMPT-MARK', system: 'SYSTEM-MARK' });
  const cmd = E.buildCommand(t, { files: { system: 'S', schema: 'C', out: 'O' }, model: 'gemini-3.8-flash-medium', effort: 'high', timeoutS: 660 });
  assert.deepEqual(cmd.args, ['--input-format', 'stream-json', '--output-format', 'stream-json', '-p=', '--sandbox', '--mode', 'plan',
    '--disable-slash-commands', '--model', 'gemini-3.8-flash-medium', '--effort', 'high', '--print-timeout', '660s']);
  for (const bad of ['--add-dir', '--dangerously-skip-permissions', 'PROMPT-MARK', 'SYSTEM-MARK', '--json-schema']) {
    assert.ok(!cmd.args.some((a) => a.includes(bad)), bad);
  }
  assert.equal(cmd.writeSystem, false);
  assert.equal(cmd.writeSchema, false);
  assert.ok(cmd.stdin.endsWith('\n') && cmd.stdin.trim().split('\n').length === 1);
  const ev = JSON.parse(cmd.stdin);
  assert.equal(ev.event, 'user');
  assert.equal(ev.message.role, 'user');
  assert.equal(ev.message.content, '<instructions>\nSYSTEM-MARK\n</instructions>\n\nPROMPT-MARK');
  // 모델 · 생각 깊이: 허용 모양 · 탐지 목록 안의 id 만
  assert.equal(E.modelArg('agy', 'gemini-3.8-flash-medium', modelList), 'gemini-3.8-flash-medium');
  assert.equal(E.modelArg('agy', 'gemini-9-pro', modelList), null); // 이 PC 목록에 없음 → --model 없이
  assert.equal(E.modelArg('agy', 'gemini-9-pro', []), 'gemini-9-pro'); // 목록을 모르면 모양만 검사
  for (const bad of ['default', '', '--add-dir', 'a b', 'GEMINI', 'x'.repeat(70), '../x-y']) assert.equal(E.modelArg('agy', bad, []), null, bad);
  assert.equal(E.effortArg('agy', 'max'), 'max');
  assert.equal(E.effortArg('agy', 'ultra'), null);
  assert.equal(E.effortArg('claude', 'high'), null);
  const plain = E.buildCommand(task(), { files: {}, model: null });
  assert.ok(!plain.args.includes('--model') && !plain.args.includes('--effort') && !plain.args.includes('--print-timeout'));
});

test("'agy models' 읽기: id · 표시 이름, 머리글 · 오류 · 색 코드 줄은 거름", () => {
  const out = '\x1b[1mAvailable models\x1b[0m\n' + MODELS.map((m) => `${m.padEnd(28)}Name of ${m}`).join('\r\n') + '\nerror: x\n\n';
  const list = E.parseAgyModels(out);
  assert.deepEqual(list.map((m) => m.id), MODELS);
  assert.equal(list[3].label, 'Name of claude-sonnet-4-6');
  assert.deepEqual(E.parseAgyModels('error: not signed in. Run `agy` to sign in.\n'), []);
  assert.deepEqual(E.parseAgyModels(''), []);
});

test('이벤트 한 줄 판정: 답 조각 · 허락/질문(끔) · 모르는 이벤트(이름만)', () => {
  const su = (o) => JSON.stringify({ event: 'step_update', step_update: o });
  assert.deepEqual(E.agyLine(su({ state: 'ACTIVE', step_type: 'agent_response', text_delta: '안녕' })), { delta: '안녕' });
  assert.deepEqual(E.agyLine(su({ state: 'DONE', step_type: 'user_input', text_delta: '내 질문' })), { delta: '' });
  assert.deepEqual(E.agyLine(JSON.stringify({ event: 'init', init: { permission_mode: 'request-review' } })), {});
  assert.deepEqual(E.agyLine(JSON.stringify({ event: 'result', result: {} })), {});
  assert.ok(E.agyLine(JSON.stringify({ event: 'permission_request', permission_request: {} })).blocked);
  assert.ok(E.agyLine(JSON.stringify({ event: 'tool_approval' })).blocked);
  assert.ok(E.agyLine(su({ state: 'WAITING', step_type: 'ask_user_question' })).blocked);
  assert.ok(E.agyLine(su({ state: 'PENDING_REVIEW', step_type: 'run_command' })).blocked);
  assert.deepEqual(E.agyLine(JSON.stringify({ event: 'telemetry', telemetry: { secret: 's' } })), { unknown: 'telemetry' });
  assert.deepEqual(E.agyLine('error: boom'), {});
  assert.deepEqual(E.agyLine('{"event":"x<script>"}'), { unknown: 'xscript' });
});

test('탐지: 설치 · 로그인 · 모델 목록 · 버전, --version 이 없어도 설치로', async () => {
  const p = await probeEngine('agy', { resolveEngine, customPath: shim, env: baseEnv });
  assert.equal(p.installed, true);
  assert.equal(p.logged_in, true);
  assert.equal(p.version, '1.4.0');
  assert.deepEqual(p.models.map((m) => m.id), MODELS);
  assert.equal(p.models[1].label, 'Gemini 3.8 Flash (Medium)');
  const nov = await probeEngine('agy', { resolveEngine, customPath: shim, env: { ...baseEnv, FAKE_AGY_NO_VERSION: '1' } });
  assert.equal(nov.installed, true);
  assert.equal(nov.version, '');
  assert.equal(nov.logged_in, true);
  for (const env of [{ FAKE_LOGGED_OUT: '1' }, { FAKE_AGY_MODELS: 'empty' }]) { // 종료 코드 ≠ 0 · 모델 줄 없음 = 로그인 필요
    const out = await probeEngine('agy', { resolveEngine, customPath: shim, env: { ...baseEnv, ...env } });
    assert.equal(out.installed, true);
    assert.equal(out.logged_in, false, JSON.stringify(env));
    assert.deepEqual(out.models, []);
  }
  assert.equal(await checkLogin('agy', resolved, { ...baseEnv, FAKE_LOGGED_OUT: '1' }), false);
  const off = await probeEngine('agy', { resolveEngine, customPath: shim, env: baseEnv, enabled: false });
  assert.equal(off.reason, 'off');
  const none = await probeEngine('agy', { resolveEngine, env: { PATH: path.join(home, 'nothing') } });
  assert.equal(none.installed, false);
});

test('실행: 빈 작업 폴더에서, 프롬프트는 stdin 으로 바이트 그대로, 진행 글 = text_delta, 결과 = result.response, 폴더는 지움', async () => {
  const t = task({ model: 'gemini-3.8-flash-medium', effort: 'low' });
  const partials = [];
  const res = await run(t, { GEMINI_API_KEY: 'g', GOOGLE_API_KEY: 'k', GOOGLE_APPLICATION_CREDENTIALS: 'c' },
    { models: modelList, onPartial: (x) => partials.push(x) });
  assert.equal(res.outcome, 'succeeded', JSON.stringify(res));
  assert.equal(res.text, '가짜 답 [p.1]');
  assert.deepEqual(partials, ['가짜 ', '가짜 답 [p.1]']);
  assert.deepEqual(res.stats.usage, { input_tokens: 11650, output_tokens: 42, thinking_tokens: 10, cache_read_tokens: 0, total_tokens: 11702 });
  const rec = lastRecord();
  assert.equal(path.resolve(rec.cwd), path.join(workRoot, `${t.id}-x`));
  assert.deepEqual(rec.cwdEntries, []);
  assert.ok(!fs.existsSync(path.join(workRoot, `${t.id}-x`)) && !fs.existsSync(path.join(workRoot, `${t.id}-x.in`)));
  assert.equal(rec.stdinLines, 1);
  const want = `<instructions>\n${t.system}\n</instructions>\n\n${t.prompt}`;
  assert.equal(rec.contentSha, crypto.createHash('sha256').update(Buffer.from(want, 'utf8')).digest('hex'));
  assert.equal(flagVal(rec.argv, '--model'), 'gemini-3.8-flash-medium');
  assert.equal(flagVal(rec.argv, '--effort'), 'low');
  assert.equal(flagVal(rec.argv, '--mode'), 'plan');
  assert.equal(flagVal(rec.argv, '--print-timeout'), '120s'); // 시간 제한 60초 + 60초
  assert.ok(rec.argv.includes('--sandbox') && rec.argv.includes('--disable-slash-commands') && rec.argv.includes('-p='));
  assert.ok(!JSON.stringify(rec.argv).includes(home), '사용자 경로를 인자로 넘기지 않음');
  assert.deepEqual([rec.env.GEMINI_API_KEY, rec.env.GOOGLE_API_KEY, rec.env.GOOGLE_APPLICATION_CREDENTIALS], [null, null, null]);
  // 1MB 한글 · 이모지 프롬프트도 그대로
  let big = '';
  while (Buffer.byteLength(big) < 1024 * 1024) big += '첫 줄 "따옴표" & %PATH% 😀\r\n둘째 줄 <tag> | 파이프\n';
  const b = await run(task({ prompt: big, system: '' }));
  assert.equal(b.outcome, 'succeeded');
  assert.equal(lastRecord().contentSha, crypto.createHash('sha256').update(Buffer.from(big, 'utf8')).digest('hex'));
});

test('모델: 이 PC 목록에 없는 모델 · default 는 --model 없이, 모델 오류면 --model 없이 한 번 다시', async () => {
  await run(task({ model: 'gemini-9-pro' }), {}, { models: modelList });
  assert.ok(!lastRecord().argv.includes('--model'));
  await run(task({ model: 'default' }), {}, { models: modelList });
  assert.ok(!lastRecord().argv.includes('--model'));
  fs.rmSync(logFile);
  const res = await run(task({ model: 'claude-sonnet-4-6' }), { FAKE_MODE: 'model' }, { models: modelList });
  assert.equal(res.outcome, 'succeeded');
  assert.equal(res.stats.model_fallback, true);
  const recs = readLog(logFile);
  assert.equal(recs.length, 2);
  assert.ok(recs[0].argv.includes('--model') && !recs[1].argv.includes('--model'));
});

test('오류 대응: ERROR 결과 → cli_exit(문구), 사용 한도 → cli_usage_limit, 로그인 → cli_not_logged_in, 깨진 출력 → cli_bad_output', async () => {
  const e = await run(task(), { FAKE_MODE: 'error' });
  assert.equal(e.outcome, 'failed');
  assert.equal(e.error_code, 'cli_exit');
  assert.match(e.error, /something broke/);
  assert.equal((await run(task(), { FAKE_MODE: 'usage' })).error_code, 'cli_usage_limit');
  const l = await run(task(), { FAKE_MODE: 'login', FAKE_LOGGED_OUT: '1' });
  assert.equal(l.error_code, 'cli_not_logged_in');
  assert.match(l.error, /Antigravity/);
  assert.equal((await run(task(), { FAKE_MODE: 'garbage' })).error_code, 'cli_bad_output');
  const nd = await run(task(), { FAKE_MODE: 'nodelta' }); // 조각 없이 결과만 와도 답은 result.response
  assert.equal(nd.outcome, 'succeeded');
  assert.equal(nd.text, '가짜 답 [p.1]');
});

test('허락 요청 · 사용자 질문 이벤트 → 자동 승인 없이 프로세스 트리를 끄고 실패 (로그에는 이벤트 이름만)', async () => {
  for (const mode of ['permission', 'question']) {
    const pidfile = path.join(home, `pids-${mode}.txt`);
    const lines = [];
    const log = { info: (m, o) => lines.push([m, o]), warn: (m, o) => lines.push([m, o]), error: () => {} };
    const t0 = Date.now();
    const res = await run(task(), { FAKE_MODE: mode, FAKE_PIDFILE: pidfile }, { log });
    assert.equal(res.outcome, 'failed', mode);
    assert.equal(res.error_code, 'cli_exit');
    assert.match(res.error, /자동으로 허락하지 않아요/);
    assert.ok(Date.now() - t0 < 15000);
    assert.ok(await waitFor(() => fs.existsSync(pidfile), 5000));
    const pids = fs.readFileSync(pidfile, 'utf8').trim().split(' ').map(Number);
    assert.ok(await waitFor(() => pids.every((p) => !alive(p)), 5000), `남은 프로세스 ${pids.filter(alive)}`);
    const text = JSON.stringify(lines);
    assert.ok(lines.some(([, o]) => o && /permission_request|ask_user_question/.test(o.event)), text);
    assert.ok(!text.includes('del C:') && !text.includes('어느 쪽'), '이벤트 본문은 남기지 않음');
  }
});

test('모르는 이벤트는 무시하고 이름만 한 번 기록, 답은 그대로', async () => {
  const lines = [];
  const log = { info: (m, o) => lines.push([m, o]), warn: (m, o) => lines.push([m, o]), error: () => {} };
  const res = await run(task(), { FAKE_MODE: 'unknown' }, { log });
  assert.equal(res.outcome, 'succeeded');
  const unknown = lines.filter(([, o]) => o && o.event === 'telemetry');
  assert.equal(unknown.length, 1);
  assert.ok(!JSON.stringify(lines).includes('secret'));
});

test('취소 → cancelled · 리스 잃음 → lost, 시간 제한 → cli_timeout — 모두 프로세스 트리 종료', async () => {
  for (const reason of ['cancelled', 'lost', 'timeout']) {
    const pidfile = path.join(home, `pids-s-${reason}.txt`);
    const ac = new AbortController();
    const p = run(task(), { FAKE_MODE: 'sleep', FAKE_PIDFILE: pidfile }, reason === 'timeout' ? { timeoutMs: 2000 } : { signal: ac.signal });
    assert.ok(await waitFor(() => fs.existsSync(pidfile), 10000));
    if (reason !== 'timeout') ac.abort(reason);
    const res = await p;
    if (reason === 'timeout') assert.equal(res.error_code, 'cli_timeout');
    else assert.equal(res.outcome, reason);
    const pids = fs.readFileSync(pidfile, 'utf8').trim().split(' ').map(Number);
    assert.ok(await waitFor(() => pids.every((x) => !alive(x)), 5000), reason);
  }
});

test('워커: agy 기본 자리 1, hello 광고에 모델 목록, 모델 목록을 실행기에 넘김', async () => {
  const s = normalizeSettings({});
  assert.deepEqual(s.engines.agy, { enabled: true, slots: 1, path: '' });
  const probed = { name: 'agy', installed: true, logged_in: true, version: '1.4.0', models: [{ id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' }],
    resolved: { ok: true } };
  const seen = [];
  const w = new Worker({ api: { post: async () => ({}) }, runTask: async (t, o) => { seen.push(o.models); return { outcome: 'succeeded', text: 'x', stats: {} }; },
    probe: async (n) => (n === 'agy' ? probed : { name: n, installed: false }), workRoot, settings: {} });
  await w.doProbe();
  assert.deepEqual(w.advertised(), [{ name: 'agy', version: '1.4.0', logged_in: true, slots: 1,
    models: [{ id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' }] }]);
  assert.deepEqual(w.free(), { agy: 1 });
  const snap = w.snapshot().engines.find((e) => e.name === 'agy');
  assert.equal(snap.label, 'Antigravity');
  assert.equal(snap.models, 1);
  await w.execute({ id: 1, task: { id: 1, engine: 'agy', lease_token: 't' }, engine: 'agy', ac: new AbortController(), lost: true });
  assert.deepEqual(seen, [probed.models]);
});
