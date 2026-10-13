'use strict';
// 폴더 감시 (명세 9.1 · K-1): Node 내장 fs.watch(recursive)는 "이 근처가 바뀌었다"는 힌트로만 쓴다 — 판정은 늘 검사 결과로.
// 스파이크 t4: 이벤트가 많으면 filename == null 한 번(넘침) → 전체 검사. 루트를 지우면 절대 경로(\\?\…) 이벤트 → 감시를 닫고 루트 확인.
// 루트 이름 변경은 이벤트가 없음 → 엔진의 30초 루트 확인이 잡는다.

const fs = require('node:fs');
const path = require('node:path');

/** onHint(kind) kind = 'change' | 'overflow' | 'root' — 2초 묶기는 엔진이 한다 */
function watchRoot(root, onHint) {
  let w = null;
  let closed = false;
  const close = () => { if (closed) return; closed = true; try { if (w) w.close(); } catch { /* 이미 닫힘 */ } };
  try {
    w = fs.watch(root, { recursive: true }, (_ev, name) => {
      if (closed) return;
      if (name == null) return onHint('overflow');
      const n = String(name);
      if (n.startsWith('\\\\?\\') || path.isAbsolute(n)) { close(); return onHint('root'); }
      const head = n.split('\\')[0].toLowerCase();
      if (head === '.paperlab-sync') return; // 엔진 자기 임시 파일 · 보관함(.paperlab-sync\보관함)
      onHint('change');
    });
    w.on('error', () => { close(); onHint('root'); });
  } catch {
    closed = true;
    setImmediate(() => onHint('root'));
  }
  return { close, get closed() { return closed; } };
}

module.exports = { watchRoot };
