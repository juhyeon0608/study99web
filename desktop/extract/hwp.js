'use strict';
// 옛 한글(.hwp — HWP 5.0) 글 뽑기 어댑터 (명세 selective-sync.md 9.5.1 · 9.5.4절): hwp.js@0.0.3(Apache-2.0)의 parse 만 쓴다.
// 패키지 파일은 고치지 않고 이 얇은 진입 파일에서만 부름(R-8 — 고정 버전 · 어댑터로 감쌈). 이 파일은 추출 Worker 안에서만 require 된다(AC-S49).
// 스파이크 SX-2(2026-10-17 실측, Node 24): build/cjs.js 는 DOM 없는 worker_threads Worker 에서 require · parse 가 됨(Viewer 는 쓰지 않음).
// 판정: HWP 3.x(OLE 가 아닌 'HWP Document File V3' 머리) · 버전 5 미만 → local_unsupported, 배포용 · 암호 · 손상 · 그 밖 예외 → local_unreadable.

const { ExtractError } = require('./kinds');

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const HWP3 = Buffer.from('HWP Document File V', 'latin1');
const MAX_DEPTH = 8; // 표 칸 안의 문단 등 컨트롤 안쪽을 따라가는 깊이

/** 문단의 글자(CharType.Char = 0)만 이어 붙임 — 숫자 값(0 · 10 · 13 줄 끝)은 건너뜀 */
function paragraphText(p) {
  let s = '';
  for (const ch of (p && p.content) || []) {
    if (ch && ch.type === 0 && typeof ch.value === 'string') s += ch.value;
  }
  return s;
}

/** 문단 + 안쪽 컨트롤(표 칸 · 글상자)의 문단 — 문서 순서대로 */
function collectParas(list, out, depth = 0) {
  for (const p of list || []) {
    out.push(paragraphText(p));
    if (depth >= MAX_DEPTH) continue;
    for (const c of (p && p.controls) || []) {
      for (const block of (c && c.content) || []) {
        if (block && Array.isArray(block.items)) collectParas(block.items, out, depth + 1);
      }
    }
  }
  return out;
}

/** bytes(Buffer) → 문단 배열 */
function hwpParagraphs(bytes) {
  if (bytes.subarray(0, HWP3.length).equals(HWP3)) throw new ExtractError('local_unsupported', 'hwp3'); // 아주 옛 한글(HWP 3.0 이하)
  if (!bytes.subarray(0, 8).equals(OLE)) throw new ExtractError('local_unreadable', 'not ole');
  const { parse } = require('hwp.js'); // eslint-disable-line global-require — 추출 Worker 안에서만
  let doc;
  try { doc = parse(bytes, { type: 'buffer' }); } catch (e) {
    const msg = String((e && e.message) || '');
    if (/only support/i.test(msg) && /Received version: [0-4]\./.test(msg)) throw new ExtractError('local_unsupported', 'hwp version');
    throw new ExtractError('local_unreadable', 'hwp parse'); // 배포용(ViewText) · 암호 · 손상
  }
  const v = doc && doc.header && doc.header.version;
  if (!v || Number(v.major) < 5) throw new ExtractError('local_unsupported', 'hwp version');
  const out = [];
  for (const sec of doc.sections || []) collectParas(sec && sec.content, out);
  return out;
}

module.exports = { hwpParagraphs, paragraphText };
