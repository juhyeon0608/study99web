'use strict';
// PDF.js 사본 (명세 selective-sync.md 9.4절 — copy-css.js 와 같은 방식): 빌드 · 개발 실행 때 서버의 paperlab/static/vendor/pdfjs 에서
// pdf.min.mjs · pdf.worker.min.mjs 두 파일을 desktop/ui/vendor/ 로 그대로 복사한다(로컬 PDF 본문 추출 창이 씀 — app://ui/vendor/…).
// 손으로 고른 사본을 두지 않는다 — ui/vendor/ 는 .gitignore(생성물). 앱 window.uiFile 은 정확히 이 두 경로만 내준다.

const fs = require('node:fs');
const path = require('node:path');

const SRC_DIR = path.join(__dirname, '..', '..', 'paperlab', 'static', 'vendor', 'pdfjs');
const DEST_DIR = path.join(__dirname, '..', 'ui', 'vendor');
const FILES = ['pdf.min.mjs', 'pdf.worker.min.mjs'];

function copyVendor() {
  fs.mkdirSync(DEST_DIR, { recursive: true });
  return FILES.map((f) => {
    const dest = path.join(DEST_DIR, f);
    fs.copyFileSync(path.join(SRC_DIR, f), dest);
    return dest;
  });
}

if (require.main === module) copyVendor();

module.exports = { copyVendor, SRC_DIR, DEST_DIR, FILES };
