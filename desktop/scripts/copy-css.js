'use strict';
// 로컬 화면 CSS (디자인 PD-5): 빌드 · 개발 실행 때 paperlab/static/css/app.css를 desktop/ui/app.css로 그대로 복사한다.
// 손으로 고른 사본을 두지 않는다 — ui/app.css는 .gitignore(생성물). 로컬 전용 몇 줄은 ui/local.css.

const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'paperlab', 'static', 'css', 'app.css');
const DEST = path.join(__dirname, '..', 'ui', 'app.css');

function copyAppCss() {
  fs.copyFileSync(SRC, DEST);
  return DEST;
}

if (require.main === module) copyAppCss();

module.exports = { copyAppCss, SRC, DEST };
