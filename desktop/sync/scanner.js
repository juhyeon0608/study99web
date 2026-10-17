'use strict';
// 루트 검사 (명세 8.5 · 9.2 · 9.3 · 12.4): lstat 으로만 걷고 링크 · 정션 · 재분석 지점은 따라가지 않는다.
// 파일 ID(ino)는 bigint 로 읽어 문자열로(K-5 — 이동을 찾는 힌트로만). 해시는 안정(크기 · 수정 시각이 2초 간격으로 같음)된 뒤에만.
// 속성(숨김 · 시스템 · 읽기 전용 · 클라우드 자리 표시자)은 Node 가 주지 않아 PowerShell 로 한 번에 묻는다 — 해시 전에(내려받기를 일으키지 않게).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const P = require('./paths');
const { extOf, isSyncName, HEAD_BYTES } = require('./filekind');

const ATTR = { READONLY: 0x1, HIDDEN: 0x2, SYSTEM: 0x4, REPARSE: 0x400, OFFLINE: 0x1000, RECALL_ON_OPEN: 0x40000, RECALL_ON_DATA: 0x400000 };

/**
 * → {files: [{rel, key, size, mtime_ms, ino}], dirs: [{rel, key, ino}], problems: [{code, rel}], excluded: {files, dirs}, nestedMarker}
 * 읽기만 한다(AC-673a). skip(rel) 이 참인 디렉터리는 들어가지 않음.
 * exts: 맞출 확장자(Set, 소문자 · 점 포함) — 없으면 동기화 확장자 전부(filekind.SYNC_EXTS), 옛 서버(v1 — 선택 동기화 8.6절)는 '.pdf' 만.
 */
async function scanTree(root, { skip = () => false, exts = null } = {}) {
  const wanted = (name) => (exts ? exts.has(extOf(name)) : isSyncName(name));
  // excluded: 있지만 맞추지 않는 것(제외 · 건너뜀). 저널에 있던 파일이 여기로 바뀌면 "사라짐"이 아니라 보류(12.1-3 — 삭제는 명시적 신호로만)
  const out = { files: [], dirs: [], problems: [], excluded: { files: [], dirs: [] }, nestedMarker: false };
  const fileKeys = new Set();
  const dirKeys = new Set();
  const inoAt = async (rel) => { try { return inoOf(await fs.promises.lstat(path.join(root, rel), { bigint: true })); } catch { return ''; } };
  const exclude = async (kind, code, rel, ino) => {
    out.problems.push({ code, rel });
    out.excluded[kind].push({ rel, key: P.fold(rel), ino: ino === undefined ? await inoAt(rel) : ino });
  };
  async function walk(relDir) {
    let entries;
    try { entries = await fs.promises.readdir(relDir ? path.join(root, relDir) : root, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const name = e.name;
      const rel = P.joinRel(relDir, name);
      if (e.isSymbolicLink()) { // 심볼릭 링크 · 정션(Node 는 정션도 링크로 보임 — 스파이크 t8)
        if (!P.isSkippedDir(name) && (wanted(name) || !e.isFile())) await exclude(wanted(name) ? 'files' : 'dirs', 'link', rel, '');
        continue;
      }
      if (e.isDirectory()) {
        if (relDir && name.toLowerCase() === P.SYNC_DIR) { out.nestedMarker = true; continue; }
        if (P.isSkippedDir(name) || skip(rel)) continue;
        const bad = P.nameProblem(name);
        if (bad) { await exclude('dirs', bad === 'too_long' ? 'folder_name_too_long' : 'bad_name_local', rel); continue; }
        const key = P.fold(rel);
        if (dirKeys.has(key)) { await exclude('dirs', 'case_conflict', rel); continue; }
        let st;
        try { st = await fs.promises.lstat(path.join(root, rel), { bigint: true }); } catch { continue; }
        dirKeys.add(key);
        out.dirs.push({ rel, key, ino: inoOf(st) });
        await walk(rel);
        continue;
      }
      if (!e.isFile() || !wanted(name)) continue; // 동기화 확장자가 아니면 읽지도 옮기지도 지우지도 않음 (K-20 · 선택 동기화 8.1)
      if (P.isTempName(name)) { await exclude('files', 'temp_name', rel); continue; }
      const bad = P.nameProblem(name, { file: true });
      if (bad) { await exclude('files', bad === 'too_long' ? 'file_name_too_long' : 'bad_name_local', rel); continue; }
      let st;
      try { st = await fs.promises.lstat(path.join(root, rel), { bigint: true }); } catch { continue; }
      const size = Number(st.size);
      if (size === 0) { await exclude('files', 'empty_file', rel, inoOf(st)); continue; }
      if (size > P.MAX_FILE_BYTES) { await exclude('files', 'too_big', rel, inoOf(st)); continue; }
      const key = P.fold(rel);
      if (fileKeys.has(key)) { await exclude('files', 'case_conflict', rel, inoOf(st)); continue; }
      fileKeys.add(key);
      out.files.push({ rel, key, size, mtime_ms: Number(st.mtimeNs / 1000000n), ino: inoOf(st) });
    }
  }
  await walk('');
  return out;
}

function inoOf(st) {
  const ino = st.ino.toString();
  return ino === '0' ? '' : `${st.dev.toString()}:${ino}`;
}

/** SHA-256 + 첫 바이트(head — filekind.kindOf 판정용). 해시 전후 크기 · 수정 시각이 다르면 null(쓰는 중 — 버리고 다시 대기) */
async function hashFile(abs) {
  const before = await fs.promises.lstat(abs, { bigint: true });
  const h = crypto.createHash('sha256');
  let head = Buffer.alloc(0);
  await new Promise((resolve, reject) => {
    const s = fs.createReadStream(abs);
    s.on('data', (c) => { if (head.length < HEAD_BYTES) head = Buffer.concat([head, c.subarray(0, HEAD_BYTES - head.length)]); h.update(c); });
    s.on('error', reject);
    s.on('end', resolve);
  });
  const after = await fs.promises.lstat(abs, { bigint: true });
  if (after.size !== before.size || after.mtimeNs !== before.mtimeNs) return null;
  return { sha256: h.digest('hex'), head };
}

/** 읽기로 열 수 있나(다른 프로그램이 쓰기 잠금 중이면 false) */
async function canRead(abs) {
  try { const fh = await fs.promises.open(abs, 'r'); await fh.close(); return true; } catch { return false; }
}

const PS_ATTRS = "$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);" +
  "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$a=([Console]::In.ReadToEnd()|ConvertFrom-Json);" +
  '$o=foreach($p in $a){try{[int][IO.File]::GetAttributes($p)}catch{-1}};ConvertTo-Json -Compress -InputObject @($o)';

/** 파일 속성 한 번에(PowerShell 한 번 — 경로는 표준 입력 JSON 으로, 명령 줄에 넣지 않음). → Map(abs → int, 못 읽으면 -1) */
function readAttrs(paths) {
  if (!paths.length) return Promise.resolve(new Map());
  return new Promise((resolve) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_ATTRS], { windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        const m = new Map();
        let arr = null;
        try { arr = JSON.parse(String(stdout).trim()); } catch { arr = null; }
        paths.forEach((p, i) => m.set(p, !err && Array.isArray(arr) && Number.isInteger(arr[i]) ? arr[i] : -1));
        resolve(m);
      });
    child.stdin.end(JSON.stringify(paths));
  });
}

/** 속성 → 건너뜀 이유('' = 괜찮음). 못 읽음(-1)은 건너뜀 — 자리 표시자일 수 있어 내려받기를 일으키지 않게 */
function attrProblem(a) {
  if (a < 0) return 'attr_unknown';
  if (a & (ATTR.RECALL_ON_DATA | ATTR.OFFLINE | ATTR.RECALL_ON_OPEN)) return 'cloud_only';
  if (a & ATTR.REPARSE) return 'link';
  if (a & (ATTR.HIDDEN | ATTR.SYSTEM)) return 'hidden';
  return '';
}

module.exports = { ATTR, scanTree, hashFile, canRead, readAttrs, attrProblem };
