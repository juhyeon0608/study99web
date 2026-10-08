'use strict';
// 가짜 CLI (claude · codex · gemini 흉내) — 실제 CLI 는 부르지 않는다.
// 사용: node fake-cli.js <엔진> [인자…]  (npm 셸 스크립트 흉내 폴더의 bin/<엔진>.js 가 이 파일을 부름)
// 동작은 환경 변수로: FAKE_MODE(ok · sleep · login · model · usage · garbage · big · error · slow), FAKE_LOG(기록 파일),
// FAKE_TEXT(답), FAKE_PIDFILE(sleep 때 손자 프로세스 pid), FAKE_SLEEP_MS, FAKE_LOGGED_OUT=1, FAKE_VERSION

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

module.exports = function fake(engine, argv = process.argv.slice(2)) {
  const env = process.env;
  const mode = env.FAKE_MODE || 'ok';
  const version = env.FAKE_VERSION || (engine === 'claude' ? '2.1.300' : '0.200.0');
  const has = (f) => argv.includes(f);
  const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

  if (has('--version')) { process.stdout.write(`${version} (${engine})\n`); return process.exit(0); }
  if ((engine === 'claude' && argv[0] === 'auth' && argv[1] === 'status') || (engine === 'codex' && argv[0] === 'login' && argv[1] === 'status')) {
    return process.exit(env.FAKE_LOGGED_OUT === '1' ? 1 : 0);
  }

  const chunks = [];
  process.stdin.on('data', (c) => chunks.push(c));
  process.stdin.on('end', () => {
    const stdin = Buffer.concat(chunks);
    const sysFile = val('--system-prompt-file');
    const record = {
      engine, argv, cwd: process.cwd(), cwdEntries: fs.readdirSync(process.cwd()), pid: process.pid, start: Date.now(),
      stdinSha: crypto.createHash('sha256').update(stdin).digest('hex'), stdinLen: stdin.length,
      sysSha: sysFile ? crypto.createHash('sha256').update(fs.readFileSync(sysFile)).digest('hex') : null,
      env: Object.fromEntries(['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'FAKE_MODE', 'CODEX_API_KEY',
        'OPENAI_BASE_URL', 'GOOGLE_GEMINI_BASE_URL', 'ANTHROPIC_VERTEX_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'GEMINI_API_KEY', 'GOOGLE_CLOUD_PROJECT']
        .map((k) => [k, env[k] === undefined ? null : env[k]])),
    };
    const log = () => { if (env.FAKE_LOG) fs.appendFileSync(env.FAKE_LOG, JSON.stringify({ ...record, end: Date.now() }) + '\n'); };
    const text = env.FAKE_TEXT || '가짜 답 [p.1]';
    const ok = () => {
      if (engine === 'claude') {
        if (has('stream-json')) {
          for (const part of [text.slice(0, 3), text.slice(3)]) {
            process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: part } } }) + '\n');
          }
          process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: text, total_cost_usd: 0 }) + '\n');
        } else {
          process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: text, total_cost_usd: 0 }));
        }
      } else if (engine === 'codex') {
        fs.writeFileSync(val('-o'), text, 'utf8');
        process.stdout.write('codex log line\n');
      } else {
        process.stdout.write(JSON.stringify({ response: text, stats: {} }));
      }
      log();
      process.exit(0);
    };
    const fail = (message, code = 1) => {
      if (engine === 'claude') process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: message }));
      else if (engine === 'gemini') process.stdout.write(JSON.stringify({ error: { message } }));
      else process.stderr.write(message + '\n');
      log();
      process.exit(code);
    };
    if (mode === 'sleep') {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
      if (env.FAKE_PIDFILE) fs.writeFileSync(env.FAKE_PIDFILE, `${process.pid} ${child.pid}`);
      log();
      setTimeout(() => process.exit(0), 60000);
      return;
    }
    if (mode === 'slow') { setTimeout(ok, Number(env.FAKE_SLEEP_MS || 400)); return; }
    if (mode === 'login') return fail('Not logged in · Please run /login');
    if (mode === 'model') return has('--model') || has('-m') ? fail("There's an issue with the selected model (opus). It may not exist or you may not have access to it.") : ok();
    if (mode === 'usage') return fail('Claude AI usage limit reached|1760000000');
    if (mode === 'error') { process.stderr.write('boom: something broke sk-ant-api03-SECRETSECRETSECRET\n'); log(); return process.exit(3); }
    if (mode === 'garbage') { process.stdout.write('this is not json'); log(); return process.exit(0); }
    if (mode === 'big') {
      const big = 'x'.repeat(3 * 1024 * 1024);
      process.stdout.write(engine === 'claude' ? JSON.stringify({ type: 'result', is_error: false, result: big }) : JSON.stringify({ response: big }));
      log();
      return process.exit(0);
    }
    return ok();
  });
};

if (require.main === module) module.exports(process.argv[2], process.argv.slice(3));
