'use strict';
// 이름 · 경로 규칙 (명세 8장 · 12.4절) — 순수 함수. 서버 규칙(db.folder_name_problem)과 같은 규칙을 PC에서 다시 검사한다(서버를 믿지 않음).
// rel = 루트 기준 상대 경로('\\' 구분). 비교 키는 NFC + 소문자(Windows처럼 대소문자 무시).

const path = require('node:path').win32;
const { isSyncName, extOf } = require('./filekind');

const MAX_FOLDER = 100;
const MAX_FILE = 200;
const MAX_PATH = 250;
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 동기화 파일 하나 상한(서버 limits.max_file_bytes 와 같음)
const SYNC_DIR = '.paperlab-sync';

const FORBIDDEN = /[/\\:*?"<>|]/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(\..*)?$/i;
const TEMP_START = /^(\.|~\$|\.~lock)/i;
const TEMP_END = /\.(tmp|part|partial|crdownload|download)$/i;
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information']);

const nfc = (s) => String(s).normalize('NFC');
const fold = (s) => nfc(s).toLowerCase();

/** '' = 괜찮음, 'bad_name' · 'too_long' */
function nameProblem(name, { file = false } = {}) {
  const s = String(name == null ? '' : name);
  if (!s || s === '.' || s === '..') return 'bad_name';
  if (FORBIDDEN.test(s) || CONTROL.test(s) || /[. ]$/.test(s) || RESERVED.test(s)) return 'bad_name';
  if (file && !isSyncName(s)) return 'bad_name'; // 동기화 확장자 목록(filekind.SYNC_EXTS — 선택 동기화 8.1절)
  if (file && RESERVED.test(s.slice(0, s.length - extOf(s).length))) return 'bad_name';
  if (s.length > (file ? MAX_FILE : MAX_FOLDER)) return 'too_long';
  return '';
}

/** 동기화하지 않는 파일 이름(임시 · 잠금 · 점으로 시작) */
const isTempName = (name) => TEMP_START.test(name) || TEMP_END.test(name);
/** 조용히 건너뛰는 디렉터리(표식 · 보관함 · 휴지통 · 점으로 시작) */
const isSkippedDir = (name) => name.startsWith('.') || SKIP_DIRS.has(String(name).toLowerCase());

const segments = (rel) => String(rel).split('\\').filter(Boolean);
const joinRel = (...parts) => parts.filter((p) => p !== '' && p != null).join('\\');
const parentRel = (rel) => { const s = segments(rel); s.pop(); return s.join('\\'); };
const baseName = (rel) => { const s = segments(rel); return s[s.length - 1] || ''; };
const depth = (rel) => segments(rel).length;
/** rel 이 dir 안(같지 않음)인가 — 대소문자 무시 */
const isUnder = (rel, dir) => (dir === '' ? rel !== '' : fold(rel).startsWith(fold(dir) + '\\'));
/** prefix 를 바꿈(대소문자 무시로 찾음) */
const rebase = (rel, from, to) => (fold(rel) === fold(from) ? to : isUnder(rel, from) ? joinRel(to, rel.slice(from.length + 1)) : rel);

/** p 가 root 안(같지 않음)인가 — resolve 뒤 소문자 · '\' 경계로 비교 */
function isInside(root, p) {
  const r = fold(path.resolve(root)).replace(/\\+$/, '');
  const q = fold(path.resolve(p));
  return q.startsWith(r + '\\') && q.length > r.length + 1;
}

/** 서버 · 상대 경로 조각으로 루트 안 절대 경로를 만든다. 조각마다 다시 검사 → 안 되면 null (12.4) */
function safeJoin(root, rel, { file = false } = {}) {
  const segs = segments(rel);
  if (!segs.length || String(rel).includes('/') || String(rel).startsWith('\\')) return null;
  for (let i = 0; i < segs.length; i++) {
    const last = i === segs.length - 1;
    if (nameProblem(segs[i], { file: file && last })) return null;
    if (!last || !file) { if (segs[i].length > MAX_FOLDER) return null; }
    if (i === 0 && fold(segs[0]) === SYNC_DIR) return null;
  }
  const abs = path.join(root, ...segs);
  return isInside(root, abs) ? abs : null;
}

const fullLength = (root, rel) => path.join(root, rel).length;

module.exports = {
  MAX_FOLDER, MAX_FILE, MAX_PATH, MAX_FILE_BYTES, SYNC_DIR,
  nfc, fold, nameProblem, isSyncName, isTempName, isSkippedDir, segments, joinRel, parentRel, baseName, depth,
  isUnder, rebase, isInside, safeJoin, fullLength,
};
