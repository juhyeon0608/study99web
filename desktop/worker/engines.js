'use strict';
// 엔진별 명령 · 결과 읽기 · 실패 문구 (명세 11.4 · 11.6 · 11.8).
// 프롬프트는 늘 stdin. 시스템 프롬프트 · 스키마는 파일(claude --system-prompt-file, codex --output-schema).
// 인자에는 미리 정한 플래그 · 우리가 만든 임시 파일 경로 · 허용 목록의 모델 별칭만 들어간다.
// codex · gemini · agy에는 시스템 프롬프트 플래그가 없어 stdin 앞에 붙인다.
// agy(Google Antigravity CLI 1.4.0, 2026-10-17 사용자 PC 실측): 프롬프트는 stdin stream-json 한 줄, 출력은 NDJSON 이벤트.
//   늘 --sandbox --mode plan --disable-slash-commands. --add-dir · --dangerously-skip-permissions · 사용자 경로는 절대 넣지 않음.
//   도구 허락 · 사용자 질문 같은 이벤트가 오면 실패로 보고 프로세스를 끈다(자동 승인 없음).

const fs = require('node:fs');
const path = require('node:path');

const ENGINES = ['claude', 'codex', 'gemini', 'agy'];
const LABELS = { claude: 'claude', codex: 'codex', gemini: 'gemini', agy: 'Antigravity' }; // 화면 · 오류 문구용 이름
const DEFAULT_SLOTS = { claude: 2, codex: 1, gemini: 1, agy: 1 }; // 확정 U9 (agy 1 — 2026-10-17)
const DEFAULT_TOTAL = 2;
// 엔진별 최소 버전 (명세 19장 "CLI 버전 · 플래그 변화"): claude --permission-prompts 는 2.1.259 이상 (22장)
const MIN_VERSION = { claude: '2.1.259' };
// CLI에는 API 모델 id를 넘기지 않는다 (11.6 · AC-55): claude는 별칭만, 나머지는 모양 검사 + claude- 거부
const CLAUDE_MODELS = new Set(['opus', 'sonnet', 'haiku', 'fable']);
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// codex: --sandbox read-only 는 '쓰기 · 네트워크'만 막고 셸 읽기 명령(Get-Content 등)은 실행한다 (2026-10-28 이 PC 실측 —
// codex-cli 0.157.0 이 C:\Windows\win.ini 첫 줄을 읽어 답함). 논문 본문의 숨은 지시가 PC 파일을 읽어 결과에 섞지 못하게
// 명령 · 브라우저 · 화면 조작 · 플러그인 · MCP 도구를 모두 끈다(-c 는 옛 버전도 받고, 모르는 기능 이름은 무시됨). 끄면 '실패로 닫힘'(실측)
const CODEX_TOOLS_OFF = ['shell_tool', 'unified_exec', 'code_mode_host', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser',
  'apps', 'plugins', 'remote_plugin', 'multi_agent', 'image_generation', 'view_image', 'tool_suggest', 'skill_search', 'hooks',
  'workspace_dependencies', 'goals', 'in_app_local_automation'];
// 웹 검색(출처 확인 ①단계 — 서버가 task.web_search=true 로 줌, 0.4.5 · 2026-10-31): 검색 도구 하나만 연다.
// claude: --tools WebSearch + --allowedTools WebSearch (WebFetch · 셸 · 파일 도구는 그대로 없음 — 페이지 확인은 서버가 직접).
// codex 0.157: 웹 검색이 code-mode 호스트를 거쳐서 code_mode_host 는 켜되, 그 안의 node_repl(MCP — Node fs · process)은 끈다
//   (2026-10-31 이 PC 실측: node_repl 이 켜져 있으면 win.ini 를 읽음, 끄면 process · require · import('node:fs') 모두 없고
//   웹 검색만 됨). --search 는 exec 앞(최상위 플래그).
const WEB_ENGINES = new Set(['claude', 'codex']);
const CODEX_WEB_MCP = 'mcp_servers={node_repl={enabled=false}}';
const GEMINI_INSTRUCTION = '표준 입력으로 받은 지시와 자료를 따라 답만 출력하세요.';
// agy: 'agy models' 한 줄 = "<id><공백><표시 이름>". id 는 소문자 · 숫자 · . _ - (하이픈 하나 이상 — 머리글 줄 · "error:" 줄을 거름)
const AGY_MODEL_RE = /^[a-z0-9][a-z0-9._]*-[a-z0-9._-]*[a-z0-9]$/;
const AGY_MODELS_MAX = 40;
const AGY_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
// 도구 허락 요청 · 사용자에게 묻기로 보이는 이벤트 이름 · 단계 종류 · 상태 (init 의 permission_mode 칸은 보지 않음)
const AGY_BLOCK_RE = /permission|approv|question|ask_?user|user_?input_?request|elicit|confirm/i;
// 단계 상태(실측: ACTIVE · DONE) — 'WAITING' 하나만으로는 막지 않음(모델 응답 대기일 수 있음), 사용자 · 검토 · 승인 대기만
const AGY_BLOCK_STATE_RE = /user|review|approv|permission|block|confirm/i;

const USAGE_RE = /usage limit|rate[ _-]?limit|quota|too many requests|limit reached|limit exceeded|\b429\b|credit balance|resource[_ ]?exhausted/i;
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

/** models = agy 탐지 때 받은 목록([{id, label}]) — 있으면 그 안의 id 만 */
function modelArg(engine, model, models) {
  if (!model || model === 'default') return null;
  if (engine === 'claude') return CLAUDE_MODELS.has(model) ? model : null;
  if (engine === 'agy') {
    if (typeof model !== 'string' || model.length > 64 || !AGY_MODEL_RE.test(model)) return null;
    return !Array.isArray(models) || !models.length || models.some((m) => m && m.id === model) ? model : null;
  }
  return MODEL_RE.test(model) && !/^claude-/i.test(model) ? model : null;
}

function effortArg(engine, effort) {
  return engine === 'agy' && AGY_EFFORTS.has(effort) ? effort : null;
}

/** 실행할 인자 · stdin. files = {system, schema, out} (워커 임시 폴더 안 경로), timeoutS = agy --print-timeout(초) */
function buildCommand(task, { files, model, schemaArg = true, effort = null, timeoutS = 0 }) {
  const engine = task.engine;
  const schema = task.json_schema && typeof task.json_schema === 'object' ? task.json_schema : null;
  const system = String(task.system || '');
  const prompt = String(task.prompt || '');
  const withSystem = system ? `<instructions>\n${system}\n</instructions>\n\n${prompt}` : prompt;
  const web = task.web_search === true && WEB_ENGINES.has(engine);
  if (engine === 'claude') {
    const stream = !!task.stream_partial;
    const args = ['-p', '--output-format', stream ? 'stream-json' : 'json'];
    if (stream) args.push('--verbose', '--include-partial-messages');
    args.push('--no-session-persistence', '--tools', web ? 'WebSearch' : '');
    if (web) args.push('--allowedTools', 'WebSearch');
    args.push('--setting-sources', '', '--strict-mcp-config',
      '--permission-prompts', 'none', '--system-prompt-file', files.system);
    if (model) args.push('--model', model);
    // 스키마 JSON 은 셸(cmd.exe)을 거치지 않을 때만 인자로 (AC-50) — 셸 경로에서는 프롬프트 안 스키마 글로 충분
    if (schema && schemaArg) args.push('--json-schema', JSON.stringify(schema));
    return { args, stdin: prompt, writeSystem: true, writeSchema: false, stream };
  }
  if (engine === 'codex') {
    const args = [...(web ? ['--search'] : []), 'exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '--color', 'never', '-o', files.out];
    for (const name of CODEX_TOOLS_OFF) if (!(web && name === 'code_mode_host')) args.push('-c', `features.${name}=false`);
    args.push('-c', web ? CODEX_WEB_MCP : 'mcp_servers={}');
    if (schema) args.push('--output-schema', files.schema);
    if (model) args.push('-m', model);
    args.push('-');
    return { args, stdin: withSystem, writeSystem: false, writeSchema: !!schema, stream: false };
  }
  if (engine === 'agy') {
    // -p= : Go flag 는 -p 에 값이 꼭 필요 — 빈 값을 주고 프롬프트는 stdin stream-json 으로. 스키마 플래그는 쓰지 않음(프롬프트 안 스키마 글)
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '-p=', '--sandbox', '--mode', 'plan', '--disable-slash-commands'];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    if (Number.isSafeInteger(timeoutS) && timeoutS > 0) args.push('--print-timeout', `${timeoutS}s`);
    const stdin = `${JSON.stringify({ event: 'user', message: { role: 'user', content: withSystem } })}\n`;
    return { args, stdin, writeSystem: false, writeSchema: false, stream: !!task.stream_partial, ndjson: true };
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

function agyEvent(line) {
  let ev;
  try { ev = JSON.parse(line); } catch { return null; }
  return ev && typeof ev === 'object' && typeof ev.event === 'string' ? ev : null;
}

const safeName = (v) => String(v || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40);

/**
 * agy NDJSON 한 줄 → {delta}(답 조각) | {blocked: 이름}(허락 · 질문 — 끄고 실패) | {unknown: 이벤트 이름} | {}.
 * 이벤트 이름만 돌려준다(본문은 로그에 남기지 않음)
 */
function agyLine(line) {
  const ev = agyEvent(String(line || '').trim());
  if (!ev) return {};
  const name = safeName(ev.event);
  if (name === 'init' || name === 'result') return {};
  if (name === 'step_update') {
    const st = ev.step_update && typeof ev.step_update === 'object' ? ev.step_update : {};
    const type = String(st.step_type || '');
    if (AGY_BLOCK_RE.test(type) || AGY_BLOCK_STATE_RE.test(String(st.state || ''))) return { blocked: `step_update:${safeName(type)}` };
    return { delta: type === 'agent_response' && typeof st.text_delta === 'string' ? st.text_delta : '' };
  }
  if (AGY_BLOCK_RE.test(name)) return { blocked: name };
  return { unknown: name };
}

const USAGE_KEYS = ['input_tokens', 'output_tokens', 'thinking_tokens', 'cache_read_tokens', 'total_tokens'];
function agyUsage(u) {
  const out = {};
  if (u && typeof u === 'object') for (const k of USAGE_KEYS) if (Number.isSafeInteger(u[k]) && u[k] >= 0) out[k] = u[k];
  return out;
}

/** 'agy models' 출력 → [{id, label}] (색 코드 · 따옴표 · 제어 문자 지움, 최대 40개) */
function parseAgyModels(stdout) {
  const out = [];
  const seen = new Set();
  for (const raw of String(stdout || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n/)) {
    const m = /^\s*(\S+)(?:\s+(.*?))?\s*$/.exec(raw);
    if (!m || m[1].length > 64 || !AGY_MODEL_RE.test(m[1]) || seen.has(m[1])) continue;
    const label = String(m[2] || '').replace(/[\x00-\x1f\x7f]/g, '').replace(/^(["'])(.*)\1$/, '$2').trim().slice(0, 80) || m[1];
    seen.add(m[1]);
    out.push({ id: m[1], label });
    if (out.length >= AGY_MODELS_MAX) break;
  }
  return out;
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
  if (engine === 'agy') {
    // 마지막 result 이벤트: {status: SUCCESS | ERROR, response, error, usage}. 없으면 "error: …" 줄
    let res = null;
    let errLine = '';
    for (const line of stdout.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const ev = agyEvent(t);
      if (ev && ev.event === 'result' && ev.result && typeof ev.result === 'object') res = ev.result;
      else if (!ev && /^error:/i.test(t)) errLine = t;
    }
    if (!res) return errLine ? { ok: false, text: '', message: errLine } : { ok: false, bad: true, text: '', message: '' };
    const usage = agyUsage(res.usage);
    if (String(res.status || '').toUpperCase() !== 'SUCCESS') {
      return { ok: false, text: '', message: String(res.error || errLine || res.status || 'ERROR'), usage };
    }
    return { ok: true, text: typeof res.response === 'string' ? res.response : '', structured: null, usage };
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
  if (engine === 'agy') return ['models']; // 종료 코드 0 + 모델 줄이 하나 이상이어야 로그인됨
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
  CODEX_TOOLS_OFF, CODEX_WEB_MCP,
  ENGINES, LABELS, DEFAULT_SLOTS, DEFAULT_TOTAL, MIN_VERSION, CLAUDE_MODELS, GEMINI_INSTRUCTION, AGY_EFFORTS,
  USAGE_RE, MODEL_ERR_RE, AUTH_RE,
  versionTuple, versionBelow, modelArg, effortArg, buildCommand, partialDelta, parseOutput, loginCommand, geminiLoggedIn,
  agyLine, parseAgyModels,
};
