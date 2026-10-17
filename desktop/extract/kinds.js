'use strict';
// 로컬 AI 본문 추출 형식 (명세 selective-sync.md 7.4 · 9.4 · 9.5.1절, D-14) — 순수 함수.
// LOCAL_TEXT_EXTS 는 서버 db.LOCAL_TEXT_EXTS 와 같아야 한다(tests/test_selective_sync_contract.py 가 이 배열을 읽어 맞춰 봄 — 한 줄 그대로 둘 것).
// 옛 .ppt · .xls · .rtf 는 지원하지 않음(동기화를 켜라는 안내), 사진은 글자를 읽지 않음.

const LOCAL_TEXT_EXTS = Object.freeze(['.pdf', '.docx', '.hwpx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.hwp', '.doc']);
const ZIP_EXTS = Object.freeze(['.docx', '.hwpx', '.pptx', '.xlsx', '.odt', '.odp', '.ods']); // 직접 ZIP · XML 읽기(9.5.2)
const OLE_EXTS = Object.freeze(['.hwp', '.doc']); // hwp.js · word-extractor (9.5.4)
const UNSUPPORTED_EXTS = Object.freeze(['.ppt', '.xls', '.rtf']);
const IMAGE_EXTS = Object.freeze(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp']);

/** 확장자 → 'pdf' | 'zip' | 'ole' | 'unsupported' | 'image' | '' (모름) */
function methodOf(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.pdf') return 'pdf';
  if (ZIP_EXTS.includes(e)) return 'zip';
  if (OLE_EXTS.includes(e)) return 'ole';
  if (UNSUPPORTED_EXTS.includes(e)) return 'unsupported';
  if (IMAGE_EXTS.includes(e)) return 'image';
  return '';
}

// 상한(9.5.1 · 9.5.3 · 11장 5a) — 여기 한 곳
const LIMITS = Object.freeze({
  chunkChars: 3000, // 문단을 이어 약 3,000자마다(문단 경계에서) 자름
  maxChunks: 2000, // 조각(쪽) 상한
  maxTextBytes: 8 * 1024 * 1024, // 글 합계 8MB(넘으면 그 자리에서 멈춤 — 프롬프트 4MB 상한에서 input_too_large)
  maxCellsPerSheet: 20000,
  zipMaxEntries: 5000,
  zipMaxEntryBytes: 64 * 1024 * 1024,
  zipMaxRatio: 200,
  zipMaxTotalBytes: 256 * 1024 * 1024,
  xmlMaxDepth: 256,
  xmlMaxTagBytes: 64 * 1024,
  xmlMaxDocBytes: 64 * 1024 * 1024,
  inputMaxBytes: 100 * 1024 * 1024, // 동기화 파일 상한과 같음
  workerTimeoutMs: 30000,
  workerOldMb: 512,
  workerYoungMb: 64,
  workerStackMb: 4,
  queue: 2,
});

class ExtractError extends Error {
  /** code: local_unreadable · local_unsupported · local_no_text */
  constructor(code, why = '') { super(why || code); this.code = code; this.why = why; }
}

module.exports = { LOCAL_TEXT_EXTS, ZIP_EXTS, OLE_EXTS, UNSUPPORTED_EXTS, IMAGE_EXTS, methodOf, LIMITS, ExtractError };
