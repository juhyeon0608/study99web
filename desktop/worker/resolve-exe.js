'use strict';
// CLI 실행 파일 찾기 (명세 11.2). 셸을 거치지 않는 방법을 먼저 고른다:
//   1. 앱 설정의 사용자 지정 경로
//   2. PATH(+ %USERPROFILE%\.local\bin · %APPDATA%\npm)의 <이름>.exe
//   3. npm 셸 스크립트 <이름>.cmd → 안에 적힌 진입 파일을 읽어 .exe 는 그대로, .js 는 node.exe <진입 js> 로
//   4. 그래도 안 되면 cmd.exe /d /s /c "<경로>" <고정 플래그> — 이때 인자는 미리 정한 안전한 값만 (shellCommandLine)
// Node 는 .cmd/.bat 를 shell 없이 spawn 하면 EINVAL (CVE-2024-27980) — 그래서 .cmd 를 직접 실행하지 않는다.

const fs = require('node:fs');
const path = require('node:path');

const ENGINES = ['claude', 'codex', 'gemini'];

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function searchDirs(name, env) {
  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const extra = [];
  if (name === 'claude' && env.USERPROFILE) extra.push(path.join(env.USERPROFILE, '.local', 'bin'));
  if (env.APPDATA) extra.push(path.join(env.APPDATA, 'npm'));
  const seen = new Set();
  return [...dirs, ...extra].filter((d) => {
    const k = d.toLowerCase().replace(/[\\/]+$/, '');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function findNode(dir, env) {
  const local = path.join(dir, 'node.exe');
  if (isFile(local)) return local;
  for (const d of searchDirs('node', env)) {
    const p = path.join(d, 'node.exe');
    if (isFile(p)) return p;
  }
  return null;
}

// npm(cmd-shim)이 만든 .cmd 의 진입 파일: "%dp0%\node_modules\…\bin\claude.exe" 또는 "…\bin\codex.js"
const SHIM_TARGET = /"%dp0%\\([^"%]+?\.(?:exe|js|cjs|mjs))"/i;

function fromShim(cmdPath, env) {
  let text = '';
  try { text = fs.readFileSync(cmdPath, 'utf8'); } catch { return null; }
  const m = SHIM_TARGET.exec(text);
  if (!m) return null;
  const dir = path.dirname(cmdPath);
  const target = path.join(dir, m[1]);
  if (!isFile(target)) return null;
  if (/\.exe$/i.test(target)) return { command: target, prefixArgs: [], via: 'exe', display: cmdPath };
  const node = findNode(dir, env);
  if (!node) return null;
  return { command: node, prefixArgs: [target], via: 'node', display: cmdPath };
}

function shellFallback(cmdPath, env) {
  return { command: env.ComSpec || env.COMSPEC || 'cmd.exe', prefixArgs: [], via: 'shell', shellTarget: cmdPath, display: cmdPath };
}

function fromPath(p, env) {
  if (!isFile(p)) return null;
  if (/\.exe$/i.test(p)) return { command: p, prefixArgs: [], via: 'exe', display: p };
  if (/\.(?:js|cjs|mjs)$/i.test(p)) {
    const node = findNode(path.dirname(p), env);
    return node ? { command: node, prefixArgs: [p], via: 'node', display: p } : null;
  }
  if (/\.(?:cmd|bat)$/i.test(p)) return fromShim(p, env) || shellFallback(p, env);
  return null;
}

/**
 * @returns {{ok:true, command:string, prefixArgs:string[], via:'exe'|'node'|'shell', display:string, source:'custom'|'auto', shellTarget?:string}
 *          | {ok:false, reason:string, source:'custom'|'auto'}}
 */
function resolveEngine(name, { customPath = '', env = process.env } = {}) {
  if (!ENGINES.includes(name)) return { ok: false, reason: 'unknown_engine', source: 'auto' };
  if (customPath) {
    const r = path.isAbsolute(customPath) ? fromPath(customPath, env) : null;
    return r ? { ok: true, ...r, source: 'custom' } : { ok: false, reason: 'custom_path_invalid', source: 'custom' };
  }
  const dirs = searchDirs(name, env);
  for (const d of dirs) {
    const p = path.join(d, `${name}.exe`);
    if (isFile(p)) return { ok: true, command: p, prefixArgs: [], via: 'exe', display: p, source: 'auto' };
  }
  for (const d of dirs) {
    for (const ext of ['.cmd', '.bat']) {
      const r = fromPath(path.join(d, name + ext), env);
      if (r) return { ok: true, ...r, source: 'auto' };
    }
  }
  return { ok: false, reason: 'not_found', source: 'auto' };
}

// cmd.exe 를 거칠 때만: 인자에 cmd 메타 문자가 하나라도 있으면 실행하지 않는다(프롬프트 · 스키마는 원래 인자로 가지 않음).
const SHELL_SAFE = /^[A-Za-z0-9 _\-.:\\/=,+@가-힣]*$/;

function isShellSafe(arg) {
  return typeof arg === 'string' && SHELL_SAFE.test(arg);
}

/** cmd.exe /d /s /c ""<target>" a b" — windowsVerbatimArguments 로 그대로 넘긴다. 안전하지 않으면 null */
function shellCommandLine(target, args) {
  if (!isShellSafe(target) || !args.every(isShellSafe)) return null;
  const quoted = [target, ...args].map((a) => `"${a}"`).join(' ');
  return ['/d', '/s', '/c', `"${quoted}"`];
}

module.exports = { resolveEngine, shellCommandLine, isShellSafe, ENGINES, searchDirs };
