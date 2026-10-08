'use strict';
// 엔진별 명령 · 결과 읽기 · 실패 문구 (명세 11.4 · 11.6 · 11.8).
// 프롬프트는 늘 stdin. 시스템 프롬프트 · 스키마는 파일(claude --system-prompt-file, codex --output-schema).
// 인자에는 미리 정한 플래그 · 우리가 만든 임시 파일 경로 · 허용 목록의 모델 별칭만 들어간다.
// codex · gemini에는 시스템 프롬프트 플래그가 없어 stdin 앞에 붙인다.

const fs = require('node:fs');
const path = require('node:path');

const ENGINES = ['claude', 'codex', 'gemini'];
const DEFAULT_SLOTS = { claude: 2, codex: 1, gemini: 1 }; // 확정 U9
const DEFAULT_TOTAL = 2;
// 엔진별 최소 버전 (명세 19장 "CLI 버전 · 플래그 변화"): claude --permission-prompts 는 2.1.259 이상 (22장)
const MIN_VERSION = { claude: '2.1.259' };
// CLI에는 API 모델 id를 넘기지 않는다 (11.6 · AC-55): claude는 별칭만, 나머지는 모양 검사 + claude- 거부
const CLAUDE_MODELS = new Set(['opus', 'sonnet', 'haiku', 'fable']);
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const GEMINI_INSTRUCTION = '표준 입력으로 받은 지시와 자료를 따라 답만 출력하세요.';

const USAGE_RE = /usage limit|rate[ _-]?limit|quota|too many requests|limit reached|limit exceeded|\b429\b|credit balance/i;
const MODEL_ERR_RE = /issue with the selected model|model_not_found|unrecognized[_ ]model|(unknown|invalid|unsupported|not available|not found|does not exist)[^.\n]{0,40}model|model[^.\n]{0,60}(not found|does not exist|not available|unknown|invalid|unsupported|not supported)/i;
const AUTH_RE = /not logged in|please (log ?in|login|run .{0,20}login)|login required|authentication (failed|required)|authentication_failed|unauthori[sz]ed|invalid api key|oauth|credentials?/i;

function versionTuple(v) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(v || ''));
  return m ? m.slice(1).map(Number) : null;
}

function versionBelow(v, min) {
  const a = versionTuple(v);
  const b = versionTuple(min);
  if (!a || !b) return false; // 버전을 못 읽으면 막지 않음 (실패하면 cli_exit 로 보고)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

function modelArg(engine, model) {
  if (!model || model === 'default') return null;
  if (engine === 'claude') return CLAUDE_MODELS.has(model) ? model : null;
  return MODEL_RE.test(model) && !/^claude-/i.test(model) ? model : null;
}

/** 실행할 인자 · stdin. files = {system, schema, out} (워커 임시 폴더 안 경로) */
function buildCommand(task, { files, model, schemaArg = true }) {
  const engine = task.engine;
  const schema = task.json_schema && typeof task.json_schema === 'object' ? task.json_schema : null;
  const system = String(task.system || '');
  const prompt = String(task.prompt || '');
  const withSystem = system ? `<instructions>\n${system}\n</instructions>\n\n${prompt}` : prompt;
  if (engine === 'claude') {
    const stream = !!task.stream_partial;
    const args = ['-p', '--output-format', stream ? 'stream-json' : 'json'];
    if (stream) args.push('--verbose', '--include-partial-messages');
    args.push('--no-session-persistence', '--tools', '', '--setting-sources', '', '--strict-mcp-config',
      '--permission-prompts', 'none', '--system-prompt-file', files.system);
    if (model) args.push('--model', model);
    // 스키마 JSON 은 셸(cmd.exe)을 거치지 않을 때만 인자로 (AC-50) — 셸 경로에서는 프롬프트 안 스키마 글로 충분
    if (schema && schemaArg) args.push('--json-schema', JSON.stringify(schema));
    return { args, stdin: prompt, writeSystem: true, writeSchema: false, stream };
  }
  if (engine === 'codex') {
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never', '-o', files.out];
    if (schema) args.push('--output-schema', files.schema);
    if (model) args.push('-m', model);
    args.push('-');
    return { args, stdin: withSystem, writeSystem: false, writeSchema: !!schema, stream: false };
  }
  if (engine === 'gemini') {
    const args = ['-p', GEMINI_INSTRUCTION, '--output-format', 'json'];
    if (model) args.push('-m', model);
    return { args, stdin: withSystem, writeSystem: false, writeSchema: false, stream: false };
  }
  throw new Error(`unknown engine ${engine}`);
}

/** stream-json 한 줄에서 중간 글 조각 (claude --include-partial-messages) */
function partialDelta(line) {
  let ev;
  try { ev = JSON.parse(line); } catch { return ''; }
  const d = ev && ev.type === 'stream_event' && ev.event && ev.event.delta;
  return d && d.type === 'text_delta' && typeof d.text === 'string' ? d.text : '';
}

/**
 * 실행 결과 원문 → {ok, text, structured, message, cost}. ok=false 면 message 에 CLI 가 낸 오류 문구.
 * bad = 결과 모양을 읽지 못함(cli_bad_output 후보)
 */
function parseOutput(engine, { stdout, files, stream }) {
  if (engine === 'claude') {
    let obj = null;
    if (stream) {
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try { const ev = JSON.parse(line); if (ev && ev.type === 'result') obj = ev; } catch { /* 다음 줄 */ }
      }
    } else {
      try { obj = JSON.parse(stdout.trim()); } catch { obj = null; }
    }
    if (!obj || typeof obj !== 'object') return { ok: false, bad: true, text: '', message: '' };
    const text = typeof obj.result === 'string' ? obj.result : '';
    const structured = obj.structured_output && typeof obj.structured_output === 'object' ? obj.structured_output : null;
    if (obj.is_error) return { ok: false, text: '', message: text || String(obj.subtype || '') };
    return { ok: true, text, structured };
  }
  if (engine === 'codex') {
    let text = '';
    try { text = fs.readFileSync(files.out, 'utf8'); } catch { text = ''; }
    return { ok: true, text: text || stdout, structured: null };
  }
  // gemini: {"response", "stats", "error"}
  let obj = null;
  try { obj = JSON.parse(stdout.trim()); } catch { obj = null; }
  if (!obj || typeof obj !== 'object') return { ok: false, bad: true, text: '', message: '' };
  if (obj.error) return { ok: false, text: '', message: typeof obj.error === 'string' ? obj.error : String(obj.error.message || JSON.stringify(obj.error)) };
  return { ok: true, text: typeof obj.response === 'string' ? obj.response : '', structured: null };
}

/** 로그인 확인 명령 (11.4). gemini 는 상태 명령이 없어(확인 필요) 로그인 파일이 있는지로 본다 */
function loginCommand(engine) {
  if (engine === 'claude') return ['auth', 'status'];
  if (engine === 'codex') return ['login', 'status'];
  return null;
}

function geminiLoggedIn(env) {
  const home = env.USERPROFILE || env.HOME || '';
  if (!home) return false;
  return ['oauth_creds.json', 'google_accounts.json'].some((f) => {
    try { return fs.statSync(path.join(home, '.gemini', f)).isFile(); } catch { return false; }
  });
}

module.exports = {
  ENGINES, DEFAULT_SLOTS, DEFAULT_TOTAL, MIN_VERSION, CLAUDE_MODELS, GEMINI_INSTRUCTION,
  USAGE_RE, MODEL_ERR_RE, AUTH_RE,
  versionTuple, versionBelow, modelArg, buildCommand, partialDelta, parseOutput, loginCommand, geminiLoggedIn,
};
