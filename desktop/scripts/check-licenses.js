'use strict';
// 운영 의존성 라이선스 검사 (명세 selective-sync.md 9.5.4절 · AC-S49) — npm test 앞에 돈다.
// - package.json 의 dependencies · devDependencies 는 정확한 버전(범위 기호 없음)
// - package-lock.json 의 운영 의존성(dev 아님)마다 라이선스가 허용 목록 안(SPDX 식이면 모든 id 가). node_modules 가 있으면 설치본의
//   package.json 라이선스 · 버전도 잠금 파일과 같아야 함
// - build/THIRD_PARTY_NOTICES.txt 에 운영 의존성이 모두(이름@버전) 있음
// 허용 목록 = MIT · ISC · Apache-2.0 · Zlib · BSD-2/3-Clause(명세) + 0.3.x 부터 함께 배포하던 electron-updater 의 전이 의존성 두 개
// (argparse — Python-2.0, sax — BlueOak-1.0.0: 둘 다 허용형 — 팀장 확인 사항으로 보고).
//   node scripts/check-licenses.js          검사
//   node scripts/check-licenses.js --write  고지 파일 다시 만들기(설치된 node_modules 의 라이선스 전문)

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const NOTICES = path.join(ROOT, 'build', 'THIRD_PARTY_NOTICES.txt');
const PDFJS_LICENSE = path.join(ROOT, '..', 'paperlab', 'static', 'vendor', 'pdfjs', 'LICENSE');
const ALLOWED = new Set(['MIT', 'ISC', 'Apache-2.0', 'Zlib', 'BSD-2-Clause', 'BSD-3-Clause', 'Python-2.0', 'BlueOak-1.0.0']);
const EXACT = /^\d+\.\d+\.\d+$/;

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const ids = (expr) => String(expr || '').replace(/[()]/g, ' ').split(/\s+(?:AND|OR|WITH)\s+|\s+/).filter(Boolean);

function prodPackages(lock) {
  const out = [];
  for (const [k, v] of Object.entries(lock.packages || {})) {
    if (!k || v.dev) continue;
    out.push({ key: k, name: k.replace(/^.*node_modules\//, ''), version: v.version, license: v.license || '' });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

function check() {
  const problems = [];
  const pkg = read(path.join(ROOT, 'package.json'));
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [n, v] of Object.entries(pkg[field] || {})) if (!EXACT.test(v)) problems.push(`${field}.${n}: 버전이 고정되지 않음 (${v})`);
  }
  const lock = read(path.join(ROOT, 'package-lock.json'));
  const notices = fs.existsSync(NOTICES) ? fs.readFileSync(NOTICES, 'utf8') : '';
  if (!notices) problems.push('build/THIRD_PARTY_NOTICES.txt 가 없음');
  for (const p of prodPackages(lock)) {
    const bad = ids(p.license).filter((id) => !ALLOWED.has(id));
    if (!p.license || bad.length) problems.push(`${p.name}@${p.version}: 허용하지 않는 라이선스 (${p.license || '없음'})`);
    const installed = path.join(ROOT, p.key, 'package.json');
    if (fs.existsSync(installed)) {
      const ip = read(installed);
      if (ip.version !== p.version) problems.push(`${p.name}: 설치본 버전(${ip.version})이 잠금 파일(${p.version})과 다름`);
      const il = typeof ip.license === 'string' ? ip.license : '';
      if (il && il !== p.license) problems.push(`${p.name}: 설치본 라이선스(${il})가 잠금 파일(${p.license})과 다름`);
    }
    if (notices && !notices.includes(`${p.name}@${p.version}`)) problems.push(`${p.name}@${p.version}: 고지 파일에 없음`);
  }
  return problems;
}

const TEMPLATES = {
  MIT: (who) => `Copyright (c) ${who}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  ISC: (who) => `Copyright (c) ${who}\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
};

function licenseText(dir, license, author) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { names = []; }
  const f = names.find((n) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n));
  if (f) return fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim();
  const who = typeof author === 'string' ? author : (author && author.name) || '';
  const t = TEMPLATES[license];
  return t ? `(패키지에 라이선스 파일이 없어 package.json 의 "license": "${license}" 표준 문구를 적음)\n\n${t(who)}` : `(라이선스 파일 없음 — "license": "${license}")`;
}

function write() {
  const lock = read(path.join(ROOT, 'package-lock.json'));
  const parts = [
    'PaperLab PC 앱 — 오픈 소스 고지 (THIRD PARTY NOTICES)',
    '이 앱에 함께 들어 있는 오픈 소스 패키지와 라이선스 전문입니다. (desktop/scripts/check-licenses.js --write 가 만듦)',
    '',
  ];
  for (const p of prodPackages(lock)) {
    const dir = path.join(ROOT, p.key);
    let author = '';
    try { author = read(path.join(dir, 'package.json')).author || ''; } catch { author = ''; }
    parts.push('='.repeat(78), `${p.name}@${p.version} — ${p.license}`, '-'.repeat(78), licenseText(dir, p.license, author), '');
  }
  if (fs.existsSync(PDFJS_LICENSE)) {
    parts.push('='.repeat(78), 'PDF.js (pdf.min.mjs · pdf.worker.min.mjs — 서버 static/vendor/pdfjs 사본) — Apache-2.0', '-'.repeat(78),
      fs.readFileSync(PDFJS_LICENSE, 'utf8').replace(/\r\n/g, '\n').trim(), '');
  }
  fs.writeFileSync(NOTICES, parts.join('\n'), 'utf8');
  return NOTICES;
}

if (require.main === module) {
  if (process.argv.includes('--write')) { console.log(`고지 파일: ${write()}`); }
  const problems = check();
  if (problems.length) {
    for (const p of problems) console.error(`라이선스 검사 실패: ${p}`);
    process.exit(1);
  }
  console.log('라이선스 검사 통과');
}

module.exports = { check, write, prodPackages, ALLOWED };
