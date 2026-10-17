'use strict';
// CLI 실행기 (명세 11장): 셸 없이 spawn(인자 배열), 프롬프트는 stdin 바이트로, 작업마다 빈 작업 폴더,
// 시간 제한 · 취소 · 리스 잃음 → 프로세스 트리 전체 종료(taskkill /T /F), 출력 크기 제한, 환경 변수 정리(K9),
// 실패 판정 8종(11.8 + output_too_large). 결과 원문 해석은 서버가 한다(워커는 원문만 올림).

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { shellCommandLine } = require('./resolve-exe');
const E = require('./engines');
const { redact } = require('../lib/redact');

const STDOUT_MAX = 16 * 1024 * 1024; // stream-json 은 조각마다 줄이 붙어 결과보다 큼
const RESULT_MAX = 2 * 1024 * 1024; // 서버 결과 상한 (8.6절)
const STDERR_KEEP = 64 * 1024;
const PARTIAL_MAX = 64 * 1024; // 서버 partial_text 상한 (5.3절)
const PROBE_TIMEOUT_MS = 30000;

// 부모 세션 값이 섞이면 CLI 가 엉뚱하게 실패 (11.4 — 1st My paper 실측) + 회사 API 키 · 엔드포인트 · 공급자를 바꾸는 변수 (K9 ①:
// CLI = 구독 로그인만, 예상 밖 종량 과금 방지). 이름은 각 CLI 공식 문서 기준(2026-10-08 확인):
// claude — ANTHROPIC_*(API 키 · 토큰 · BASE_URL · Bedrock/Vertex/Foundry 주소 · 프로젝트) · AWS_BEARER_TOKEN_BEDROCK · CLAUDE_CODE_*(USE_BEDROCK 등)
// codex — OPENAI_*(API 키 · BASE_URL · 조직) · CODEX_API_KEY
// gemini — GEMINI_API_KEY · GOOGLE_API_KEY · GOOGLE_APPLICATION_CREDENTIALS(서비스 계정) · GOOGLE_GENAI_USE_VERTEXAI ·
//          GOOGLE_GEMINI_BASE_URL · GOOGLE_VERTEX_BASE_URL. GOOGLE_CLOUD_PROJECT 는 일부 구글 계정 로그인에 필요해 남김
const STRIP_ENV = new RegExp('^(CLAUDECODE|CLAUDE_CODE_.*|CLAUDE_PREVIEW_.*|CLAUDE_AGENT_SDK_VERSION|CLAUDE_PID|CLAUDE_EFFORT|' +
  'ANTHROPIC_.*|AWS_BEARER_TOKEN_BEDROCK|OPENAI_.*|CODEX_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|' +
  'GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_GEMINI_BASE_URL|GOOGLE_VERTEX_BASE_URL|ELECTRON_.*|NODE_OPTIONS)$', 'i');

function childEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!STRIP_ENV.test(k)) out[k] = v;
  return out;
}

/** 프로세스 트리 전체 종료. taskkill 출력(cp949)은 읽지 않는다 */
function killTree(child) {
  return new Promise((resolve) => {
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return resolve();
    if (process.platform === 'win32') {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      try {
        const k = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        k.on('exit', finish);
        k.on('error', () => { try { child.kill('SIGKILL'); } catch { /* 이미 끝남 */ } finish(); });
      } catch { try { child.kill('SIGKILL'); } catch { /* 이미 끝남 */ } finish(); }
      setTimeout(finish, 10000);
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* 이미 끝남 */ } }
      resolve();
    }
  });
}

/**
 * 한 번 실행. resolved = resolve-exe 결과. 셸 경로(cmd.exe)는 인자가 안전한 값일 때만.
 * → {code, stdout, stderr, timedOut, aborted, abortReason, overflow, spawnError}
 */
function execOnce(resolved, args, { cwd, env, stdin = '', timeoutMs, signal, onLine } = {}) {
  return new Promise((resolve) => {
    let command = resolved.command;
    let argv = [...(resolved.prefixArgs || []), ...args];
    const opts = { cwd, env: env || childEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false };
    if (resolved.via === 'shell') {
      const line = shellCommandLine(resolved.shellTarget, args);
      if (!line) return resolve({ code: null, stdout: '', stderr: '', spawnError: { code: 'UNSAFE_ARGS' } });
      argv = line;
      opts.windowsVerbatimArguments = true;
    }
    if (process.platform !== 'win32') opts.detached = true;
    let child;
    try { child = spawn(command, argv, opts); } catch (e) { return resolve({ code: null, stdout: '', stderr: '', spawnError: e }); }
    const out = { code: null, stdout: '', stderr: '', timedOut: false, aborted: false, abortReason: '', overflow: false, spawnError: null };
    const chunks = [];
    let size = 0;
    let lineBuf = '';
    const decoder = new StringDecoder('utf8'); // 여러 바이트 글자가 조각 경계에 걸려도 깨지지 않게
    let settled = false;
    let killing = null;
    const stop = (why) => {
      if (killing) return;
      if (why === 'timeout') out.timedOut = true;
      else if (why === 'overflow') out.overflow = true;
      else { out.aborted = true; out.abortReason = String(why || 'cancelled'); }
      killing = killTree(child);
    };
    const timer = timeoutMs ? setTimeout(() => stop('timeout'), timeoutMs) : null;
    const onAbort = () => stop(signal.reason || 'cancelled');
    if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
    child.stdout.on('data', (b) => {
      size += b.length;
      if (size > STDOUT_MAX) { stop('overflow'); return; }
      chunks.push(b);
      if (onLine) {
        lineBuf += decoder.write(b);
        let i;
        while ((i = lineBuf.indexOf('\n')) >= 0) { onLine(lineBuf.slice(0, i)); lineBuf = lineBuf.slice(i + 1); }
      }
    });
    child.stderr.on('data', (b) => { out.stderr = (out.stderr + b.toString('utf8')).slice(-STDERR_KEEP); });
    child.stdin.on('error', () => { /* 받기 전에 끝난 프로세스 */ });
    const finish = async (code, err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (onLine) { const rest = lineBuf + decoder.end(); lineBuf = ''; if (rest.trim() && !out.overflow) onLine(rest); } // 줄바꿈 없는 마지막 줄
      if (signal) signal.removeEventListener('abort', onAbort);
      if (killing) await killing;
      out.code = code;
      if (err) out.spawnError = err;
      out.stdout = Buffer.concat(chunks).toString('utf8');
      resolve(out);
    };
    child.on('error', (e) => finish(null, e));
    child.on('close', (code) => finish(code));
    // 자식이 띄운 프로세스가 출력 파이프를 쥐고 있으면 close 가 오지 않음 → 끝난 뒤 2초 기다리고 마무리
    child.on('exit', (code) => setTimeout(() => finish(code), 2000).unref());
    child.stdin.end(Buffer.from(String(stdin), 'utf8'));
  });
}

function clip(s, n) {
  return redact(String(s || ''), n);
}

async function rmrf(p) {
  try { await fsp.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 다음 작업이 다시 지움 */ }
}

/**
 * agy: 'agy models' 로 로그인 확인 + 모델 목록 → {logged: true | false | null(모름), models: [{id, label}]}.
 * 종료 코드가 0 이 아니거나 모델 줄이 하나도 없으면 로그인 안 됨(로그인 필요). 출력 원문은 남기지 않는다
 */
async function agyModels(resolved, env) {
  const r = await execOnce(resolved, E.loginCommand('agy'), { env: childEnv(env), timeoutMs: PROBE_TIMEOUT_MS });
  if (r.spawnError || r.timedOut || r.overflow) return { logged: null, models: [] };
  const models = r.code === 0 ? E.parseAgyModels(r.stdout) : [];
  return { logged: models.length > 0, models };
}

/** 로그인 확인 → true(됨) · false(안 됨) · null(모름) */
async function checkLogin(engine, resolved, env) {
  if (engine === 'agy') return (await agyModels(resolved, env)).logged;
  const cmd = E.loginCommand(engine);
  if (!cmd) return E.geminiLoggedIn(env || process.env);
  const r = await execOnce(resolved, cmd, { env: childEnv(env), timeoutMs: PROBE_TIMEOUT_MS });
  if (r.spawnError || r.timedOut) return null;
  return r.code === 0;
}

const label = (engine) => E.LABELS[engine] || engine;
const AGY_BLOCKED = 'agy_blocked'; // agy 가 도구 허락 · 사용자 질문을 청함 → 끄고 실패 (자동 승인 없음)

/** 실패 판정 (11.8) */
async function classifyFailure(engine, r, parsed, resolved, env) {
  const message = parsed && parsed.message ? parsed.message : '';
  const raw = `${message}\n${r.stderr || ''}`;
  if (E.MODEL_ERR_RE.test(raw)) return { error_code: 'cli_model', error: clip(message || r.stderr, 500) };
  if (E.USAGE_RE.test(raw)) return { error_code: 'cli_usage_limit', error: clip(message || r.stderr, 500) };
  const logged = await checkLogin(engine, resolved, env);
  if (logged === false || (engine === 'gemini' && E.AUTH_RE.test(raw))) {
    return { error_code: 'cli_not_logged_in', error: `이 PC의 ${label(engine)}가 로그인돼 있지 않아요` };
  }
  return { error_code: 'cli_exit', error: clip(message || r.stderr || `${label(engine)} 종료 코드 ${r.code}`, 500) };
}

/**
 * 작업 폴더 (11.4): work\<작업 id>-<리스 토큰 16진(최대 32자)> — 같은 작업을 다시 잡아도(새 리스) 옛 실행과 폴더를 서로 지우지 않게.
 * id 는 양의 안전한 정수만, 풀어 본 경로가 workRoot 바로 안이 아니면 null (서버 값으로 경로를 벗어나지 않게)
 */
function workDir(workRoot, task) {
  if (!task || !Number.isSafeInteger(task.id) || task.id <= 0) return null;
  const lease = String(task.lease_token || '').replace(/[^0-9a-f]/gi, '').slice(0, 32) || 'x';
  const root = path.resolve(workRoot);
  const dir = path.resolve(root, `${task.id}-${lease}`);
  return path.dirname(dir) === root ? dir : null;
}

/**
 * 작업 하나 실행 (11장). → {outcome: succeeded|failed|cancelled|lost, text, structured, error_code, error, stats}
 * opts: resolved(실행 파일), workRoot, signal(이유 'cancelled' | 'lost' | 'stop'), onPartial(text), timeoutMs(시험 주입), env,
 *       models(agy 탐지 때 받은 모델 목록 — 고른 모델이 여기 없으면 --model 없이), log(agy 의 모르는 · 막힌 이벤트 이름만 남김)
 * agy: 빈 작업 폴더(cwd)에서 --sandbox --mode plan --disable-slash-commands 로만. 허락 · 질문 이벤트가 오면 바로 끄고 실패
 */
async function runTask(task, opts) {
  const started = Date.now();
  const engine = task.engine;
  const stats = { duration_ms: 0, cli_version: opts.version || '', exit_code: null };
  const done = (o) => ({ text: '', structured: null, error_code: '', error: '', ...o, stats: { ...stats, duration_ms: Date.now() - started } });
  if (!E.ENGINES.includes(engine)) return done({ outcome: 'failed', error_code: 'cli_exit', error: '알 수 없는 엔진' });
  const resolved = opts.resolved;
  if (!resolved || !resolved.ok) return done({ outcome: 'failed', error_code: 'cli_not_found', error: `이 PC에서 ${label(engine)} 실행 파일을 찾지 못했어요` });
  const log = opts.log || null;

  const cwd = workDir(opts.workRoot, task);
  if (!cwd) return done({ outcome: 'failed', error_code: 'cli_exit', error: '작업 정보가 올바르지 않아 실행하지 않았어요' });
  const inDir = `${cwd}.in`;
  await rmrf(cwd);
  await rmrf(inDir);
  await fsp.mkdir(cwd, { recursive: true });
  await fsp.mkdir(inDir, { recursive: true });
  const files = { system: path.join(inDir, 'system.txt'), schema: path.join(inDir, 'schema.json'), out: path.join(inDir, 'last-message.txt') };
  const env = childEnv(opts.env || process.env);
  const ts = Number(task.timeout_s);
  const timeoutMs = opts.timeoutMs || (Number.isFinite(ts) && ts > 0 ? Math.min(ts, 7200) : 600) * 1000;

  const once = async (model) => {
    // agy --print-timeout 은 우리 시간 제한보다 1분 길게 — 먼저 끝나는 쪽이 늘 우리(cli_timeout · 프로세스 트리 종료)
    const cmd = E.buildCommand(task, { files, model, schemaArg: resolved.via !== 'shell', effort: E.effortArg(engine, task.effort),
      timeoutS: Math.ceil(timeoutMs / 1000) + 60 });
    if (cmd.writeSystem) await fsp.writeFile(files.system, String(task.system || ''), 'utf8');
    if (cmd.writeSchema) await fsp.writeFile(files.schema, JSON.stringify(task.json_schema), 'utf8');
    await rmrf(files.out);
    let partial = '';
    let signal = opts.signal;
    let onLine = cmd.stream && opts.onPartial ? (line) => {
      const t = E.partialDelta(line);
      if (t) { partial = (partial + t).slice(-PARTIAL_MAX); opts.onPartial(partial); }
    } : null;
    let blocked = '';
    let unhook = null;
    if (cmd.ndjson) {
      // agy NDJSON: 답 조각(text_delta) → 진행 글, 허락 · 질문 이벤트 → 바로 끔. 모르는 이벤트는 이름만 한 번 남김(본문 없음)
      const ac = new AbortController();
      const outer = opts.signal;
      const relay = () => ac.abort(outer.reason || 'cancelled');
      if (outer) {
        if (outer.aborted) relay(); else outer.addEventListener('abort', relay, { once: true });
        unhook = () => outer.removeEventListener('abort', relay);
      }
      signal = ac.signal;
      const seen = new Set();
      onLine = (line) => {
        const ev = E.agyLine(line);
        if (ev.blocked && !blocked) {
          blocked = ev.blocked;
          if (log) log.warn('agy 가 허락 · 질문을 청해 실행을 멈춤', { job: task.id, event: ev.blocked });
          ac.abort(AGY_BLOCKED);
        } else if (ev.unknown && !seen.has(ev.unknown) && seen.size < 20) {
          seen.add(ev.unknown);
          if (log) log.info('agy 의 모르는 이벤트(무시)', { job: task.id, event: ev.unknown });
        } else if (ev.delta && cmd.stream && opts.onPartial) {
          partial = (partial + ev.delta).slice(-PARTIAL_MAX);
          opts.onPartial(partial);
        }
      };
    }
    const r = await execOnce(resolved, cmd.args, { cwd, env, stdin: cmd.stdin, timeoutMs, signal, onLine });
    if (unhook) unhook();
    stats.exit_code = r.code;
    if (r.spawnError) {
      if (r.spawnError.code === 'ENOENT') return { outcome: 'failed', error_code: 'cli_not_found', error: `이 PC에서 ${label(engine)} 실행 파일을 찾지 못했어요` };
      if (r.spawnError.code === 'UNSAFE_ARGS') return { outcome: 'failed', error_code: 'cli_exit', error: '실행 경로에 쓸 수 없는 글자가 있어 실행하지 않았어요. 이 PC 상태에서 실행 파일 경로를 직접 골라 주세요.' };
      return { outcome: 'failed', error_code: 'cli_exit', error: clip(`${label(engine)} 실행 오류: ${r.spawnError.code || r.spawnError.message}`, 500) };
    }
    if (blocked && !(r.aborted && r.abortReason !== AGY_BLOCKED)) { // 취소 · 리스 잃음이 먼저였으면 그쪽
      return { outcome: 'failed', error_code: 'cli_exit',
        error: 'Antigravity가 도구 사용 허락이나 추가 질문을 요청해 실행을 멈췄어요. PaperLab은 자동으로 허락하지 않아요. 다시 시도하거나 다른 엔진을 써 주세요.' };
    }
    if (r.aborted) return { outcome: r.abortReason === 'cancelled' ? 'cancelled' : 'lost' };
    if (r.timedOut) return { outcome: 'failed', error_code: 'cli_timeout', error: `시간 제한(${Math.round(timeoutMs / 1000)}초) 안에 끝나지 않았어요` };
    if (r.overflow) return { outcome: 'failed', error_code: 'output_too_large', error: '결과가 너무 길어요' };
    const parsed = E.parseOutput(engine, { stdout: r.stdout, files, stream: cmd.stream });
    if (parsed.usage && Object.keys(parsed.usage).length) stats.usage = parsed.usage; // 토큰 수만 (본문 없음)
    if (r.code === 0 && parsed.ok) {
      if (!String(parsed.text || '').trim() && !parsed.structured) return { outcome: 'failed', error_code: 'cli_bad_output', error: 'CLI 결과가 비어 있어요' };
      if (Buffer.byteLength(parsed.text || '', 'utf8') > RESULT_MAX) return { outcome: 'failed', error_code: 'output_too_large', error: '결과가 너무 길어요' };
      return { outcome: 'succeeded', text: parsed.text || '', structured: parsed.structured || null };
    }
    if (r.code === 0 && parsed.bad) return { outcome: 'failed', error_code: 'cli_bad_output', error: 'CLI 결과를 읽지 못했어요' };
    return { outcome: 'failed', ...(await classifyFailure(engine, r, parsed, resolved, opts.env)) };
  };

  try {
    const model = E.modelArg(engine, task.model, opts.models);
    let res = await once(model);
    // 모델 오류면 --model 없이 한 번 다시 (11.6 · K8 ①)
    if (model && res.error_code === 'cli_model') {
      res = await once(null);
      stats.model_fallback = true;
    }
    return done(res);
  } finally {
    await rmrf(cwd);
    await rmrf(inDir);
  }
}

/** 엔진 하나 탐지 (11.7): 버전(30초) → 로그인 확인. 끈 엔진은 찾기만 */
async function probeEngine(name, { resolveEngine, customPath = '', env = process.env, enabled = true }) {
  const resolved = resolveEngine(name, { customPath, env });
  const base = { name, installed: false, version: '', logged_in: false, outdated: false, resolved, path: '', source: resolved.source };
  if (!resolved.ok) return { ...base, reason: resolved.reason };
  base.path = resolved.display;
  // 끈 엔진은 실행 파일이 있는지만 본다(실행하지 않음) — 화면의 켜기 체크를 쓸 수 있게
  if (!enabled) return { ...base, installed: true, reason: 'off' };
  if (name === 'agy') {
    // agy: 'agy models' 가 설치 · 로그인 확인 · 모델 목록을 한 번에. --version 은 있으면 쓰고, 실패해도 설치로 본다(Go flag — 확인 필요)
    const v = await execOnce(resolved, ['--version'], { env: childEnv(env), timeoutMs: PROBE_TIMEOUT_MS });
    if (v.spawnError) return { ...base, reason: 'spawn_failed' };
    const m = v.code === 0 ? /(\d+\.\d+\.\d+)/.exec(`${v.stdout} ${v.stderr}`) : null;
    const a = await agyModels(resolved, env);
    return { ...base, installed: true, version: m ? m[1] : '', outdated: false, logged_in: a.logged === true, models: a.models, reason: '' };
  }
  const v = await execOnce(resolved, ['--version'], { env: childEnv(env), timeoutMs: PROBE_TIMEOUT_MS });
  if (v.spawnError || v.timedOut || v.code !== 0) return { ...base, reason: v.spawnError ? 'spawn_failed' : 'version_failed' };
  const m = /(\d+\.\d+\.\d+)/.exec(`${v.stdout} ${v.stderr}`);
  const version = m ? m[1] : '';
  const outdated = !!E.MIN_VERSION[name] && E.versionBelow(version, E.MIN_VERSION[name]);
  const logged = await checkLogin(name, resolved, env);
  return { ...base, installed: true, version, outdated, logged_in: logged === true, reason: '' };
}

module.exports = { runTask, probeEngine, execOnce, killTree, childEnv, checkLogin, workDir, RESULT_MAX, PARTIAL_MAX };
