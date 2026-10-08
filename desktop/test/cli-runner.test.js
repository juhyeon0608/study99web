'use strict';
// AC-50 · 51 · 52 · 54 · 55 · 56 · 57 · 59 · 61 (CLI 실행 — 가짜 CLI)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveEngine, shellCommandLine } = require('../worker/resolve-exe');
const { runTask, probeEngine, workDir } = require('../worker/cli-runner');
const { buildCommand } = require('../worker/engines');
const { tempHome, makeShim, makeOpaqueCmd, readLog, alive, waitFor } = require('./helpers');

const home = tempHome('pl-cli-');
const binDir = path.join(home, 'npm');
fs.mkdirSync(binDir, { recursive: true });
const shims = { claude: makeShim(binDir, 'claude'), codex: makeShim(binDir, 'codex'), gemini: makeShim(binDir, 'gemini') };
const workRoot = path.join(home, 'AppData', 'Local', 'PaperLab', 'work');
const logFile = path.join(home, 'fake.log');
const baseEnv = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`, FAKE_LOG: logFile, USERPROFILE: home };
const resolved = (engine) => resolveEngine(engine, { customPath: shims[engine], env: baseEnv });
const SCHEMA = { type: 'object', properties: { tldr: { type: 'string' } }, required: ['tldr'], additionalProperties: false };
let nextId = 100;

function task(over = {}) {
  return { id: nextId++, engine: 'claude', kind: 'summary', model: null, output: 'json', json_schema: SCHEMA, stream_partial: false,
    system: '당신은 연구 조수입니다.\n둘째 줄', prompt: '<paper>본문</paper>', timeout_s: 60, lease_token: 'x', ...over };
}
function run(t, env = {}, opts = {}) {
  return runTask(t, { resolved: resolved(t.engine), workRoot, env: { ...baseEnv, ...env }, ...opts });
}
function lastRecord() { const all = readLog(logFile); return all[all.length - 1]; }
test.beforeEach(() => { try { fs.rmSync(logFile); } catch { /* 없음 */ } });

test('AC-50 실행 파일 찾기: .exe 우선, npm .cmd 는 node <진입 js>, 셸 경로 인자에는 프롬프트 · 스키마 없음', async () => {
  const dir = path.join(home, 'both');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'claude.exe'), '');
  makeShim(dir, 'claude');
  const env = { PATH: dir };
  const r = resolveEngine('claude', { env });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'exe');
  assert.equal(r.command, path.join(dir, 'claude.exe'));

  const s = resolved('claude');
  assert.equal(s.via, 'node');
  assert.equal(path.basename(s.command).toLowerCase(), 'node.exe');
  assert.match(s.prefixArgs[0], /fake-claude[\\/]bin[\\/]claude\.js$/);
  const t = task({ prompt: 'PROMPT-MARK-50', system: 'SYSTEM-MARK-50' });
  const res = await run(t);
  assert.equal(res.outcome, 'succeeded');
  const rec = lastRecord();
  assert.ok(!JSON.stringify(rec.argv).includes('PROMPT-MARK-50') && !JSON.stringify(rec.argv).includes('SYSTEM-MARK-50'));

  // 셸 경로(cmd.exe): 고정 플래그 · 임시 파일 경로만. --json-schema(스키마 글)도 넣지 않음
  const opaque = makeOpaqueCmd(path.join(home, 'opaque'), 'claude');
  const sr = resolveEngine('claude', { customPath: opaque, env: baseEnv });
  assert.equal(sr.via, 'shell');
  const files = { system: path.join(workRoot, '1.in', 'system.txt'), schema: 'x', out: 'y' };
  const cmd = buildCommand(t, { files, model: null, schemaArg: false });
  const line = shellCommandLine(sr.shellTarget, cmd.args).join(' ');
  for (const bad of ['PROMPT-MARK-50', 'SYSTEM-MARK-50', '"tldr"', 'properties']) assert.ok(!line.includes(bad), bad);
  assert.equal(shellCommandLine(sr.shellTarget, ['a & calc']), null); // 셸 메타 문자는 실행 거부
  const res2 = await runTask(t, { resolved: sr, workRoot, env: baseEnv });
  assert.equal(res2.outcome, 'succeeded');
  const rec2 = lastRecord();
  assert.ok(!rec2.argv.includes('--json-schema'));
  assert.ok(!JSON.stringify(rec2.argv).includes('PROMPT-MARK-50'));
});

test('AC-51 · 61 여러 줄 · 한글 · 이모지 · 특수 문자 1MB 프롬프트가 stdin 으로 바이트 그대로, 시스템 프롬프트는 파일로', async () => {
  const unit = '첫 줄 "따옴표" & 앰퍼샌드 ^ 캐럿 % 퍼센트 %PATH% 😀 이모지\r\n둘째 줄 <tag> | 파이프\n';
  let prompt = '';
  while (Buffer.byteLength(prompt) < 1024 * 1024) prompt += unit;
  const system = '시스템 "프롬프트"\n여러 줄 & %TEMP% 😀';
  const res = await run(task({ prompt, system }));
  assert.equal(res.outcome, 'succeeded', JSON.stringify(res));
  const rec = lastRecord();
  assert.equal(rec.stdinSha, crypto.createHash('sha256').update(Buffer.from(prompt, 'utf8')).digest('hex'));
  assert.equal(rec.sysSha, crypto.createHash('sha256').update(Buffer.from(system, 'utf8')).digest('hex'));
  const i = rec.argv.indexOf('--system-prompt-file');
  assert.ok(i >= 0 && rec.argv[i + 1].includes('홍 길동'));
});

test('AC-52 시간 제한: 응답 없는 CLI 는 cli_timeout, 띄운 자식 프로세스까지 남지 않음', async () => {
  const pidfile = path.join(home, 'pids.txt');
  const t0 = Date.now();
  const res = await run(task(), { FAKE_MODE: 'sleep', FAKE_PIDFILE: pidfile }, { timeoutMs: 2000 });
  assert.equal(res.outcome, 'failed');
  assert.equal(res.error_code, 'cli_timeout');
  assert.ok(Date.now() - t0 < 15000);
  const pids = fs.readFileSync(pidfile, 'utf8').trim().split(' ').map(Number);
  assert.equal(pids.length, 2);
  assert.ok(await waitFor(() => pids.every((p) => !alive(p)), 5000), `남은 프로세스 ${pids.filter(alive)}`);
});

test('취소 신호 → 프로세스 트리 종료 · cancelled, 리스 잃음 → lost', async () => {
  for (const reason of ['cancelled', 'lost']) {
    const pidfile = path.join(home, `pids-${reason}.txt`);
    const ac = new AbortController();
    const p = run(task(), { FAKE_MODE: 'sleep', FAKE_PIDFILE: pidfile }, { signal: ac.signal });
    assert.ok(await waitFor(() => fs.existsSync(pidfile), 10000));
    const t0 = Date.now();
    ac.abort(reason);
    const res = await p;
    assert.equal(res.outcome, reason);
    assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0}ms`);
    const pids = fs.readFileSync(pidfile, 'utf8').trim().split(' ').map(Number);
    assert.ok(await waitFor(() => pids.every((x) => !alive(x)), 5000));
  }
});

test('AC-54 로그인 안 됨: is_error + auth status 1 → cli_not_logged_in, 탐지도 logged_in false', async () => {
  const env = { FAKE_MODE: 'login', FAKE_LOGGED_OUT: '1' };
  const res = await run(task(), env);
  assert.equal(res.error_code, 'cli_not_logged_in');
  const p = await probeEngine('claude', { resolveEngine, customPath: shims.claude, env: { ...baseEnv, ...env } });
  assert.equal(p.installed, true);
  assert.equal(p.logged_in, false);
  const ok = await probeEngine('claude', { resolveEngine, customPath: shims.claude, env: baseEnv });
  assert.equal(ok.logged_in, true);
  assert.equal(ok.version, '2.1.300');
  const old = await probeEngine('claude', { resolveEngine, customPath: shims.claude, env: { ...baseEnv, FAKE_VERSION: '2.1.210' } });
  assert.equal(old.outdated, true); // --permission-prompts 는 2.1.259 이상
});

test('AC-55 모델: 별칭만 --model, default · API id 는 붙이지 않음, 모델 오류면 --model 없이 한 번 다시', async () => {
  await run(task({ model: 'opus' }));
  let rec = lastRecord();
  assert.deepEqual(rec.argv.slice(rec.argv.indexOf('--model'), rec.argv.indexOf('--model') + 2), ['--model', 'opus']);
  for (const model of [null, 'default', 'claude-opus-5-5']) {
    await run(task({ model }));
    rec = lastRecord();
    assert.ok(!rec.argv.includes('--model'), String(model));
    assert.ok(!JSON.stringify(rec.argv).includes('claude-opus-5-5'));
  }
  fs.rmSync(logFile);
  const res = await run(task({ model: 'opus' }), { FAKE_MODE: 'model' });
  assert.equal(res.outcome, 'succeeded');
  assert.equal(res.stats.model_fallback, true);
  const recs = readLog(logFile);
  assert.equal(recs.length, 2);
  assert.ok(recs[0].argv.includes('--model') && !recs[1].argv.includes('--model'));
});

test('AC-56 작업 폴더: 실행 중 cwd = work\\<id>(빈 폴더), 성공 · 실패 · 취소 뒤 지움', async () => {
  const t = task();
  await run(t);
  const rec = lastRecord();
  assert.equal(path.resolve(rec.cwd), path.join(workRoot, `${t.id}-x`)); // <작업 id>-<리스 토큰 16진>
  assert.deepEqual(rec.cwdEntries, []);
  assert.ok(!fs.existsSync(path.join(workRoot, `${t.id}-x`)) && !fs.existsSync(path.join(workRoot, `${t.id}-x.in`)));
  const f = task();
  await run(f, { FAKE_MODE: 'error' });
  assert.ok(!fs.existsSync(path.join(workRoot, `${f.id}-x`)) && !fs.existsSync(path.join(workRoot, `${f.id}-x.in`)));
});

test('AC-57 환경: 부모 세션 값 · 회사 API 키(K9)를 자식에게 넘기지 않음', async () => {
  await run(task(), { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', ANTHROPIC_BASE_URL: 'http://x', ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-test',
    CODEX_API_KEY: 'k', OPENAI_BASE_URL: 'http://x', GOOGLE_GEMINI_BASE_URL: 'http://x', ANTHROPIC_VERTEX_PROJECT_ID: 'p', GOOGLE_APPLICATION_CREDENTIALS: 'c',
    GEMINI_API_KEY: 'g', GOOGLE_CLOUD_PROJECT: 'keep' });
  const rec = lastRecord();
  assert.deepEqual([rec.env.CLAUDECODE, rec.env.CLAUDE_CODE_ENTRYPOINT, rec.env.ANTHROPIC_BASE_URL, rec.env.ANTHROPIC_API_KEY, rec.env.OPENAI_API_KEY],
    [null, null, null, null, null]);
  // F7: 키 · 엔드포인트 · 공급자를 바꾸는 변수도 (각 CLI 공식 문서 이름) — 구글 계정 로그인에 필요한 GOOGLE_CLOUD_PROJECT 는 남김
  for (const k of ['CODEX_API_KEY', 'OPENAI_BASE_URL', 'GOOGLE_GEMINI_BASE_URL', 'ANTHROPIC_VERTEX_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'GEMINI_API_KEY']) {
    assert.equal(rec.env[k], null, k);
  }
  assert.equal(rec.env.GOOGLE_CLOUD_PROJECT, 'keep');
});

test('AC-59 도구 끔: claude --tools "" · --permission-prompts none, codex --sandbox read-only, --bare 없음', async () => {
  await run(task());
  let a = lastRecord().argv;
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.equal(a[a.indexOf('--permission-prompts') + 1], 'none');
  assert.ok(a.includes('--no-session-persistence') && a.includes('--strict-mcp-config') && !a.includes('--bare'));
  const res = await run(task({ engine: 'codex' }));
  assert.equal(res.outcome, 'succeeded');
  assert.equal(res.text, '가짜 답 [p.1]');
  a = lastRecord().argv;
  assert.equal(a[0], 'exec');
  assert.equal(a[a.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(a.includes('--output-schema') && a[a.length - 1] === '-' && !a.includes('--bare'));
  const g = await run(task({ engine: 'gemini', json_schema: null, kind: 'chat' }));
  assert.equal(g.outcome, 'succeeded');
  assert.equal(g.text, '가짜 답 [p.1]');
});

test('실패 판정: 사용 한도 · 결과 깨짐 · 너무 긺 · 그 밖 종료(키 지움) · 실행 파일 없음', async () => {
  assert.equal((await run(task(), { FAKE_MODE: 'usage' })).error_code, 'cli_usage_limit');
  assert.equal((await run(task(), { FAKE_MODE: 'garbage' })).error_code, 'cli_bad_output');
  assert.equal((await run(task(), { FAKE_MODE: 'big' })).error_code, 'output_too_large');
  const e = await run(task({ engine: 'codex' }), { FAKE_MODE: 'error' });
  assert.equal(e.error_code, 'cli_exit');
  assert.match(e.error, /boom/);
  assert.ok(!e.error.includes('SECRETSECRET'));
  const missing = await runTask(task(), { resolved: resolveEngine('claude', { env: { PATH: path.join(home, 'nothing') } }), workRoot, env: baseEnv });
  assert.equal(missing.error_code, 'cli_not_found');
});

test('대화 · 글쓰기 중간 글: stream-json 조각을 onPartial 로', async () => {
  const seen = [];
  const res = await run(task({ kind: 'chat', output: 'text', json_schema: null, stream_partial: true }), { FAKE_TEXT: '안녕하세요 반가워요' }, { onPartial: (t) => seen.push(t) });
  assert.equal(res.outcome, 'succeeded');
  assert.equal(res.text, '안녕하세요 반가워요');
  assert.equal(seen[seen.length - 1], '안녕하세요 반가워요');
  const a = lastRecord().argv;
  assert.ok(a.includes('stream-json') && a.includes('--include-partial-messages'));
});

test('F3 작업 폴더: id 는 양의 안전한 정수만, 경로는 workRoot 바로 안 · 리스마다 다른 폴더', async () => {
  const root = path.join(home, 'wr');
  assert.equal(workDir(root, { id: 12, lease_token: 'abcdef12-0000-0000-0000-000000000000' }), path.join(root, '12-abcdef12000000000000000000000000'));
  assert.notEqual(workDir(root, { id: 12, lease_token: '11111111-0000' }), workDir(root, { id: 12, lease_token: '22222222-0000' }));
  for (const id of ['..\\..\\X', '../x', '7', -1, 0, 1.5, 2 ** 53, NaN, null, undefined]) assert.equal(workDir(root, { id, lease_token: 'aa' }), null, String(id));
  const res = await run(task({ id: '..\\..\\X' }));
  assert.equal(res.outcome, 'failed');
  assert.ok(!fs.existsSync(path.join(home, 'X')));
});

test('F5 중간 글: 여러 바이트 글자가 출력 조각 경계에 걸려도 깨지지 않음(StringDecoder)', async () => {
  const fake = path.join(home, 'stream-big.js');
  fs.writeFileSync(fake, "process.stdin.resume(); process.stdin.on('end', () => { const t = '가'.repeat(100000);" +
    " process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } }) + '\\n');" +
    " process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: t }) + '\\n'); process.exit(0); });");
  const resolvedBig = { ok: true, command: process.execPath, prefixArgs: [fake], via: 'node', display: fake };
  let partial = '';
  const r = await runTask(task({ kind: 'chat', json_schema: null, stream_partial: true }), { resolved: resolvedBig, workRoot, env: baseEnv, onPartial: (t) => { partial = t; } });
  assert.equal(r.outcome, 'succeeded');
  assert.ok(partial.length > 0 && !partial.includes('�') && /^가+$/.test(partial));
});
