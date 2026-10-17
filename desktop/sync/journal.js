'use strict';
// PC 로컬 저널 sync_state (명세 6.3 · K-3): %APPDATA%\PaperLab\sync\state.json. "마지막으로 서버와 같다고 확인한 상태(J)".
// 쓰기는 임시 파일 → 이름 바꾸기(원자적). 비밀값 없음. 깨졌거나 버전이 다르면 null → 엔진이 전체 다시 맞추기(삭제를 추론하지 않음).
// 저널은 캐시처럼 다룬다 — 쓰기를 잃어도 다음 비교가 연결 · 같은 위치 옮기기로 끝나도록 엔진이 순서를 정함(engine.js 머리 주석).
// v2(선택 동기화 8.5절): 파일 항목에 kind('pdf' · 'source' · 'local' — 없으면 'pdf')만 더함. v1 저널은 읽을 때 v2로 올리고
// migrated = true 를 붙임 → 엔진이 전체 다시 맞추기(삭제를 추론하지 않음 — 표현이 바뀐 항목은 swap_rep, 끈 항목은 그 줄대로).
// swapping: 표현 바꾸기(swap_rep) 중 휴지통으로 보낼 옛 파일 {접는 키: {rel, sha256}} — 중간에 죽어도 새 파일로 읽지 않게.
// modeFails: 보관 PC가 끄기를 확인하지 못해 서버에 알린 이유 {pid: reason} — 같은 이유를 되풀이해 보내지 않음.

const fs = require('node:fs');
const { writeAtomic } = require('../lib/write-atomic');

const VERSION = 2;
const KINDS = new Set(['pdf', 'source', 'local']);

function fresh(head = {}) {
  return {
    version: VERSION, user_id: head.user_id || '', device_id: head.device_id || null, root: head.root || '', root_id: head.root_id || '',
    cursor: null, last_full_at: null, files: {}, folders: {}, kept: [], opIds: {}, swapping: {}, modeFails: {},
  };
}

function load(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!j || typeof j !== 'object' || (j.version !== VERSION && j.version !== 1) || typeof j.files !== 'object' || typeof j.folders !== 'object' || !j.files || !j.folders) return null;
  for (const [k, v] of Object.entries(j.files)) {
    if (!v || typeof v.rel !== 'string' || typeof v.sha256 !== 'string') return null;
    if (!/^\d+$/.test(k)) return null;
    if (!KINDS.has(v.kind)) v.kind = 'pdf';
  }
  if (j.version === 1) { j.version = VERSION; j.migrated = true; } // 0.3.x 저널 → v2 (엔진이 전체 다시 맞춤)
  for (const [k, v] of Object.entries(j.folders)) if (!/^\d+$/.test(k) || !v || typeof v.rel !== 'string') return null;
  if (!Array.isArray(j.kept)) j.kept = [];
  if (!j.opIds || typeof j.opIds !== 'object') j.opIds = {};
  if (!j.swapping || typeof j.swapping !== 'object' || Array.isArray(j.swapping)) j.swapping = {};
  if (!j.modeFails || typeof j.modeFails !== 'object' || Array.isArray(j.modeFails)) j.modeFails = {};
  return j;
}

function save(file, j) {
  const { migrated, ...rest } = j; // 이전 표시는 메모리에만
  writeAtomic(file, JSON.stringify(rest));
}

module.exports = { VERSION, fresh, load, save };
