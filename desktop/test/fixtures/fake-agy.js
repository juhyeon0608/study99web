'use strict';
// 가짜 agy (Google Antigravity CLI 1.4.0 흉내 — 2026-10-17 사용자 PC 실측 이벤트 모양). 진짜 agy 는 부르지도 설치하지도 않는다.
// fake-cli.js 가 engine === 'agy' 일 때 이 파일로 넘김(npm 셸 스크립트 흉내 bin/agy.js → fake-cli.js → 여기).
// Go flag 처럼: -p 는 값이 꼭 필요(-p= 는 빈 값), 모르는 플래그는 "flag provided but not defined" + 종료 코드 2.
// 동작은 환경 변수로: FAKE_MODE(ok · error · model · usage · login · permission · question · unknown · sleep · garbage · nodelta),
// FAKE_LOGGED_OUT=1('agy models' 실패), FAKE_AGY_MODELS=empty(모델 줄 없음), FAKE_AGY_NO_VERSION=1(--version 없음),
// FAKE_LOG(기록 파일), FAKE_TEXT(답), FAKE_PIDFILE(멈춰 있을 때 pid · 손자 pid)

const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const MODELS = [
  ['gemini-3.8-flash-high', 'Gemini 3.8 Flash (High)'],
  ['gemini-3.8-flash-medium', 'Gemini 3.8 Flash (Medium)'],
  ['gemini-3.8-flash-low', 'Gemini 3.8 Flash (Low)'],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6 (Thinking)'],
  ['claude-opus-4-6-thinking', 'Claude Opus 4.6 (Thinking)'],
  ['gpt-oss-120b-medium', 'GPT-OSS 120B (Medium)'],
];
const VALUE_FLAGS = new Set(['p', 'print', 'output-format', 'input-format', 'model', 'effort', 'mode', 'print-timeout', 'json-schema', 'add-dir']);
const BOOL_FLAGS = new Set(['sandbox', 'disable-slash-commands', 'dangerously-skip-permissions', 'version']);

function parse(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-') || rest.length) { rest.push(a); continue; }
    const m = /^--?([^=]+)(?:=(.*))?$/.exec(a);
    const name = m[1];
    if (VALUE_FLAGS.has(name)) {
      if (m[2] !== undefined) flags[name] = m[2];
      else if (i + 1 < argv.length) flags[name] = argv[++i];
      else return { error: `flag needs an argument: -${name}` };
    } else if (BOOL_FLAGS.has(name)) flags[name] = true;
    else return { error: `flag provided but not defined: -${name}` };
  }
  return { flags, rest };
}

module.exports = function fakeAgy(argv) {
  const env = process.env;
  const mode = env.FAKE_MODE || 'ok';
  const p = parse(argv);
  if (p.error) { process.stderr.write(`${p.error}\nUsage of agy:\n`); return process.exit(2); }
  const { flags, rest } = p;
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

  if (flags.version) {
    if (env.FAKE_AGY_NO_VERSION === '1') { process.stderr.write('flag provided but not defined: -version\n'); return process.exit(2); }
    process.stdout.write('agy version 1.4.0\n');
    return process.exit(0);
  }
  if (rest[0] === 'models') {
    if (env.FAKE_LOGGED_OUT === '1') { process.stdout.write('error: not signed in. Run `agy` to sign in.\n'); return process.exit(1); }
    if (env.FAKE_AGY_MODELS === 'empty') return process.exit(0);
    process.stdout.write(MODELS.map(([id, name]) => `${id.padEnd(28)}${name}`).join('\n') + '\n');
    return process.exit(0);
  }
  // 위험한 플래그 · 사용자 경로가 오면 시험이 바로 알 수 있게 실패
  if (flags['dangerously-skip-permissions'] || flags['add-dir'] !== undefined) { process.stderr.write('error: forbidden flag\n'); return process.exit(9); }
  if (flags['input-format'] === 'stream-json' && flags['output-format'] !== 'stream-json') {
    process.stderr.write('error: --input-format stream-json requires --output-format stream-json\n');
    return process.exit(2);
  }

  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    const stdin = Buffer.concat(chunks).toString('utf8');
    let content = '';
    const lines = stdin.split('\n').filter((l) => l.trim());
    try {
      const ev = JSON.parse(lines[0]);
      const c = ev && ev.event === 'user' && ev.message ? ev.message.content : null;
      content = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join('') : '';
    } catch { content = ''; }
    const record = {
      engine: 'agy', argv, cwd: process.cwd(), cwdEntries: fs.readdirSync(process.cwd()), pid: process.pid, start: Date.now(),
      stdinLines: lines.length, contentSha: crypto.createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex'), contentLen: content.length,
      env: Object.fromEntries(['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'FAKE_MODE']
        .map((k) => [k, env[k] === undefined ? null : env[k]])),
    };
    const log = () => { if (env.FAKE_LOG) fs.appendFileSync(env.FAKE_LOG, JSON.stringify({ ...record, end: Date.now() }) + '\n'); };
    if (!content) { process.stdout.write('error: empty prompt\n'); log(); return process.exit(1); }
    const conv = 'conv-0001';
    out({ event: 'init', init: { cwd: process.cwd(), tools: ['view_file', 'list_dir'], permission_mode: 'request-review' } });
    out({ event: 'step_update', step_update: { conversation_id: conv, step_index: 0, state: 'DONE', step_type: 'user_input', text_delta: '' } });
    const usage = { input_tokens: 11650, output_tokens: 42, thinking_tokens: 10, cache_read_tokens: 0, total_tokens: 11702 };
    const result = (status, extra) => out({ event: 'result', result: { conversation_id: conv, status, duration_seconds: 1.2, num_turns: 1, usage, ...extra } });
    // 멈춰 기다림: 손자 프로세스 · pid 파일을 먼저 만든 뒤 이벤트를 쓴다(워커가 이벤트를 보자마자 꺼도 pid 가 남게)
    const hang = (...events) => {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
      if (env.FAKE_PIDFILE) fs.writeFileSync(env.FAKE_PIDFILE, `${process.pid} ${child.pid}`);
      log();
      for (const ev of events) out(ev);
      setTimeout(() => process.exit(0), 60000);
    };
    const fail = (message) => {
      result('ERROR', { response: '', error: message });
      process.stderr.write(`error: ${message}\n`);
      log();
      process.exit(1);
    };
    const text = env.FAKE_TEXT || '가짜 답 [p.1]';
    const ok = () => {
      if (mode !== 'nodelta') {
        const parts = [text.slice(0, 3), text.slice(3)];
        for (const part of parts) {
          out({ event: 'step_update', step_update: { conversation_id: conv, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: part } });
        }
      }
      out({ event: 'step_update', step_update: { conversation_id: conv, step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: '', usage } });
      result('SUCCESS', { response: text, error: '' });
      log();
      process.exit(0);
    };
    if (mode === 'error') return fail('internal error: something broke');
    if (mode === 'model') return flags.model ? fail(`model not found: ${flags.model}`) : ok();
    if (mode === 'usage') return fail('RESOURCE_EXHAUSTED: quota exceeded for this account');
    if (mode === 'login') return fail('not signed in');
    if (mode === 'garbage') { process.stdout.write('this is not json\n'); log(); return process.exit(0); }
    if (mode === 'unknown') { out({ event: 'telemetry', telemetry: { secret: 'x' } }); out({ event: 'telemetry', telemetry: {} }); return ok(); }
    if (mode === 'permission') {
      return hang({ event: 'step_update', step_update: { conversation_id: conv, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: '파일을 ' } },
        { event: 'permission_request', permission_request: { tool: 'run_command', command: 'del C:\\x' } });
    }
    if (mode === 'question') {
      return hang({ event: 'step_update', step_update: { conversation_id: conv, step_index: 1, state: 'WAITING', step_type: 'ask_user_question', text_delta: '어느 쪽?' } });
    }
    if (mode === 'sleep') {
      return hang({ event: 'step_update', step_update: { conversation_id: conv, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: '생각 중' } });
    }
    return ok();
  });
};
