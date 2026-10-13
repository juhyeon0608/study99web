'use strict';
// 동기화 폴더(루트) 거부 검사 (명세 7.1 · K-21 · U-4 · K-36 · K-43 · Q-2 · Q-5). main 이 고를 때, 엔진이 시작할 때마다 부른다.
// 읽기만 한다 — 폴더 안에 아무것도 만들지 않음(AC-673). 레지스트리는 읽기만(reg query).
// 판정 순서: 드라이브 루트 → 네트워크(UNC) → 사용자 폴더 자체 → 시스템 → 앱 데이터 → OneDrive 안 → 다른 루트와 겹침 → 링크 · 정션 →
// 드라이브 종류(고정 디스크만) → 쓸 수 없음 → 표식(다른 사용자 · 다른 기기).

const fs = require('node:fs');
const path = require('node:path').win32;
const { execFile } = require('node:child_process');
const { fold, SYNC_DIR } = require('./paths');

const norm = (p) => fold(path.resolve(String(p))).replace(/\\+$/, '');
/** a 가 b 와 같거나 b 안인가('\' 경계 — OneDriveBackup 같은 접두어 함정을 거름) */
const within = (a, b) => { const x = norm(a); const y = norm(b); return !!y && (x === y || x.startsWith(y + '\\')); };

function run(cmd, args, timeout = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, encoding: 'utf8' }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

/** reg query 한 값 → 문자열 · null */
async function regValue(key, name) {
  const out = await run('reg.exe', ['query', key, '/v', name]);
  if (!out) return null;
  const m = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l.toLowerCase().startsWith(name.toLowerCase() + ' '));
  if (!m) return null;
  const parts = m.split(/\s{2,}|\t/);
  return parts.length >= 3 ? parts.slice(2).join(' ') : null;
}

const PS_ONEDRIVE = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$o=@{a=@();k=@()};" +
  String.raw`Get-ChildItem 'HKCU:\Software\Microsoft\OneDrive\Accounts' -ErrorAction SilentlyContinue|ForEach-Object{$v=(Get-ItemProperty $_.PSPath -Name UserFolder -ErrorAction SilentlyContinue).UserFolder;if($v){$o.a+=$v}};` +
  String.raw`$u=Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction SilentlyContinue;` +
  "if($u){$u.PSObject.Properties|Where-Object{$_.Name -notlike 'PS*'}|ForEach-Object{$o.k+=[Environment]::ExpandEnvironmentVariables([string]$_.Value)}};" +
  "ConvertTo-Json -Compress -InputObject $o";

/** OneDrive 루트들: 환경 변수 OneDrive · OneDriveConsumer · OneDriveCommercial + 계정 레지스트리 UserFolder + 알려진 폴더 이동(KFM, 읽기만).
 *  레지스트리는 PowerShell 로 읽음(reg.exe 출력은 OEM 코드 페이지라 한글 경로가 깨짐). */
async function oneDriveRoots(env = process.env, { ps = (script) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]) } = {}) {
  const roots = new Set();
  for (const k of ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial']) if (env[k]) roots.add(path.resolve(env[k]));
  let o = null;
  try { o = JSON.parse(String((await ps(PS_ONEDRIVE)) || '').trim()); } catch { o = null; }
  for (const a of [].concat((o && o.a) || [])) if (typeof a === 'string' && a) roots.add(path.resolve(a));
  // KFM: 바탕 화면 · 문서 등이 OneDrive 로 옮겨졌으면 그 값의 "OneDrive…" 조각까지를 OneDrive 루트로
  for (const v of [].concat((o && o.k) || [])) {
    if (typeof v !== 'string' || !/^[A-Za-z]:\\/.test(v)) continue;
    const segs = path.resolve(v).split('\\');
    const i = segs.findIndex((s, n) => n > 0 && /^onedrive/i.test(s));
    if (i > 0) roots.add(segs.slice(0, i + 1).join('\\'));
  }
  return [...roots];
}

/** PowerShell [IO.DriveInfo] → 'Fixed' | 'Removable' | 'Network' | … | 'Unknown' */
async function driveType(p) {
  const root = path.parse(path.resolve(p)).root;
  if (!/^[A-Za-z]:\\$/.test(root)) return 'Network';
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[IO.DriveInfo]::new('${root[0]}:\\').DriveType.ToString()`]);
  return out ? out.trim() || 'Unknown' : 'Unknown';
}

/** Q-5: 드라이브 휴지통 "바로 삭제"(NukeOnDelete) · 정책 NoRecycleFiles → 'on' | 'off' | 'unknown' (읽기만) */
async function recycleNuke(p) {
  const root = path.parse(path.resolve(p)).root;
  for (const hive of ['HKCU', 'HKLM']) {
    const v = await regValue(`${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer`, 'NoRecycleFiles');
    if (v && parseInt(v, 16) === 1) return 'on';
  }
  const mv = await run('mountvol.exe', [root, '/L']);
  const guid = mv && mv.match(/Volume(\{[0-9a-fA-F-]+\})/);
  if (!guid) return 'unknown';
  const v = await regValue(`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\BitBucket\\Volume\\${guid[1]}`, 'NukeOnDelete');
  if (v == null) return 'unknown';
  return parseInt(v, 16) === 1 ? 'on' : 'off';
}

function readMarker(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, SYNC_DIR, 'root.json'), 'utf8'));
    return m && typeof m === 'object' ? m : null;
  } catch { return null; }
}

/** 루트 자신 · 위 경로 중 링크 · 정션(재분석 지점)이 있나 */
function linkInChain(p) {
  let cur = path.resolve(p);
  for (;;) {
    try { if (fs.lstatSync(cur).isSymbolicLink()) return true; } catch { return null; }
    const up = path.dirname(cur);
    if (up === cur) return false;
    cur = up;
  }
}

/**
 * 순수 판정. f = 사실 묶음 → 거부 코드('' = 통과)
 * f = {p, env, oneDrive: [], otherRoots: [], ancestorMarker: bool, link: bool|null, drive: 'Fixed'|…, writable: bool, isDir: bool}
 */
function rootProblem(f) {
  const p = path.resolve(f.p);
  const env = f.env || {};
  if (p.startsWith('\\\\')) return 'network';
  if (/^[A-Za-z]:\\?$/.test(p)) return 'drive_root';
  if (!f.isDir) return 'missing';
  const home = env.USERPROFILE;
  if (home && norm(p) === norm(home)) return 'user_home';
  const sys = [env.SystemRoot || env.WINDIR, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.ProgramData, home && path.dirname(home)];
  if (sys.some((s, i) => s && (i === sys.length - 1 ? norm(p) === norm(s) : within(p, s)))) return 'system';
  if ([env.APPDATA, env.LOCALAPPDATA].some((s) => s && within(p, s))) return 'app_data';
  if ((f.oneDrive || []).some((r) => within(p, r))) return 'onedrive';
  if ((f.otherRoots || []).some((r) => r && (within(p, r) || within(r, p))) || f.ancestorMarker) return 'overlap';
  if (f.link !== false) return 'link';
  if (f.drive !== 'Fixed') return f.drive === 'Network' ? 'network' : f.drive === 'Removable' ? 'removable' : 'unknown_drive';
  if (!f.writable) return 'not_writable';
  return '';
}

/** 사실을 모아 판정. deps 로 바꿔 끼움(시험). → {code, real(실제 경로), marker} */
async function checkRoot(p, { env = process.env, otherRoots = [], deps = {} } = {}) {
  const d = { oneDriveRoots, driveType, linkInChain, readMarker, ...deps };
  const abs = path.resolve(String(p || ''));
  let isDir = false;
  let real = abs;
  try { isDir = fs.lstatSync(abs).isDirectory() || fs.statSync(abs).isDirectory(); real = fs.realpathSync.native(abs); } catch { isDir = false; }
  let ancestorMarker = false;
  for (let cur = path.dirname(abs); cur !== path.dirname(cur); cur = path.dirname(cur)) if (d.readMarker(cur)) { ancestorMarker = true; break; }
  let writable = false;
  try { fs.accessSync(abs, fs.constants.W_OK); writable = true; } catch { writable = false; } // 읽기 전용 속성만 봄 — 권한 부족은 [시작]의 표식 만들기 실패로(K-36)
  const linked = d.linkInChain(abs);
  const link = linked === null ? null : linked || norm(real) !== norm(abs);
  const facts = { p: abs, env, oneDrive: await d.oneDriveRoots(env), otherRoots, ancestorMarker, link, isDir, writable, drive: '' };
  let code = rootProblem({ ...facts, link: false, drive: 'Fixed', writable: true });
  if (!code) code = rootProblem({ ...facts, drive: 'Fixed', writable: true });
  if (!code) code = rootProblem({ ...facts, drive: await d.driveType(abs), writable: true });
  if (!code) code = rootProblem({ ...facts, drive: 'Fixed' });
  return { code, real, marker: code ? null : d.readMarker(abs) };
}

module.exports = { within, oneDriveRoots, driveType, recycleNuke, readMarker, linkInChain, rootProblem, checkRoot };
