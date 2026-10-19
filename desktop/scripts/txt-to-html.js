'use strict';
// 설치본에 .txt 파일을 넣지 않는다(2026-10-19): 회사 백신(엑소스피어 랜섬웨어 방어)이 서명 없는 설치 프로그램이 .txt(문서 확장자)를
// 쓰는 걸 "파일 변조 시도"로 보고 차단 알림을 계속 띄움. .html 은 감시 대상이 아니라서(LICENSES.chromium.html 은 기록 없음)
// 고지 · 라이선스 텍스트를 <pre> 로 감싼 .html 로 바꿔 넣는다 — 내용은 그대로라 라이선스 고지 의무도 그대로.

const fs = require('node:fs');
const path = require('node:path');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toHtml(text, title) {
  return `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>`
    + '<style>body{margin:24px;font:13px/1.5 Consolas,"D2Coding",monospace}pre{white-space:pre-wrap;word-break:break-word}</style>'
    + `</head><body><pre>${esc(text)}</pre></body></html>\n`;
}

/** src(.txt)를 dest(.html)로 변환해 쓴다 */
function writeHtml(src, dest, title) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, toHtml(fs.readFileSync(src, 'utf8').replace(/^﻿/, ''), title));
  return dest;
}

const NOTICES_SRC = path.join(__dirname, '..', 'build', 'THIRD_PARTY_NOTICES.txt');
const NOTICES_HTML = path.join(__dirname, '..', 'build', 'gen', 'THIRD_PARTY_NOTICES.html');

/** 빌드마다 오픈 소스 고지 .html 을 새로 만든다(build/gen/ 은 .gitignore — 생성물) */
function buildNoticesHtml() {
  return writeHtml(NOTICES_SRC, NOTICES_HTML, 'PaperLab 오픈 소스 고지');
}

/** electron-builder afterPack: Electron 이 넣는 LICENSE.electron.txt 를 LICENSE.electron.html 로 바꾼다(설치 폴더에 .txt 0개) */
async function afterPack(context) {
  const src = path.join(context.appOutDir, 'LICENSE.electron.txt');
  if (!fs.existsSync(src)) return;
  writeHtml(src, path.join(context.appOutDir, 'LICENSE.electron.html'), 'Electron License');
  fs.unlinkSync(src);
}

if (require.main === module) buildNoticesHtml();

module.exports = { toHtml, writeHtml, buildNoticesHtml, afterPack, NOTICES_SRC, NOTICES_HTML };
