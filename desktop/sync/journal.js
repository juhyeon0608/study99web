'use strict';
// PC 로컬 저널 sync_state (명세 6.3 · K-3): %APPDATA%\PaperLab\sync\state.json. "마지막으로 서버와 같다고 확인한 상태(J)".
// 쓰기는 임시 파일 → 이름 바꾸기(원자적). 비밀값 없음. 깨졌거나 버전이 다르면 null → 엔진이 전체 다시 맞추기(삭제를 추론하지 않음).
// 저널은 캐시처럼 다룬다 — 쓰기를 잃어도 다음 비교가 연결 · 같은 위치 옮기기로 끝나도록 엔진이 순서를 정함(engine.js 머리 주석).

const fs = require('node:fs');
const { writeAtomic } = require('../lib/write-atomic');

const VERSION = 1;

function fresh(head = {}) {
  return {
    version: VERSION, user_id: head.user_id || '', device_id: head.device_id || null, root: head.root || '', root_id: head.root_id || '',
    cursor: null, last_full_at: null, files: {}, folders: {}, kept: [], opIds: {},
  };
}

function load(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (!j || typeof j !== 'object' || j.version !== VERSION || typeof j.files !== 'object' || typeof j.folders !== 'object' || !j.files || !j.folders) return null;
  for (const [k, v] of Object.entries(j.files)) {
    if (!v || typeof v.rel !== 'string' || typeof v.sha256 !== 'string') return null;
    if (!/^\d+$/.test(k)) return null;
  }
  for (const [k, v] of Object.entries(j.folders)) if (!/^\d+$/.test(k) || !v || typeof v.rel !== 'string') return null;
  if (!Array.isArray(j.kept)) j.kept = [];
  if (!j.opIds || typeof j.opIds !== 'object') j.opIds = {};
  return j;
}

function save(file, j) { writeAtomic(file, JSON.stringify(j)); }

module.exports = { VERSION, fresh, load, save };
