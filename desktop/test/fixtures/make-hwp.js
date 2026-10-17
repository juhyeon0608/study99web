'use strict';
// HWP 5.0 견본 만들기 (명세 selective-sync.md 9.5.5절 — fixtures/README.md 참고). 개발 PC에 한컴오피스(저장 가능한 한글)가 없어
// 한글 문서 형식 공개 문서(HWP 5.0 — FileHeader · DocInfo · BodyText/SectionN, 레코드 = tag 10비트 · level 10비트 · size 12비트)대로
// 가장 작은 문서를 직접 짠다. OLE 컨테이너는 cfb(hwp.js 의 의존성 — Apache-2.0)로 쓴다. 시험 · 견본 만들기 전용(앱은 부르지 않음).
//   node test/fixtures/make-hwp.js            → test/fixtures/sample.hwp 다시 만들기
// 변형: {password: true}(암호 — 본문이 deflate 가 아님) · {distribution: true}(배포용 — ViewText 만 있음) · hwp3()(HWP 3.x 머리)

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const CFB = require('cfb');

const TEXT = 'PaperLab 시험 문서 가나다 ABC';

function record(tag, level, payload) {
  const big = payload.length >= 0xfff; // 4095 바이트 이상은 size = 0xFFF + 뒤 4바이트
  const h = Buffer.alloc(big ? 8 : 4);
  h.writeUInt32LE(((tag & 0x3ff) | ((level & 0x3ff) << 10) | ((big ? 0xfff : payload.length) << 20)) >>> 0, 0);
  if (big) h.writeUInt32LE(payload.length, 4);
  return Buffer.concat([h, payload]);
}

function fileHeader({ password = false, distribution = false, major = 5 } = {}) {
  const b = Buffer.alloc(256);
  b.write('HWP Document File', 0, 'latin1');
  b.writeUInt32LE(((major & 0xff) << 24) | (0 << 16) | (3 << 8) | 0, 32); // 5.0.3.0
  b.writeUInt32LE(0x1 | (password ? 0x2 : 0) | (distribution ? 0x4 : 0), 36); // bit0 압축 · bit1 암호 · bit2 배포용
  return b;
}

function docInfo(sections) {
  const p = Buffer.alloc(26);
  p.writeUInt16LE(sections, 0); // 구역 수 · 시작 번호들 · 캐럿 위치
  for (let i = 1; i <= 6; i++) p.writeUInt16LE(1, i * 2);
  return zlib.deflateRawSync(record(16, 0, p)); // HWPTAG_DOCUMENT_PROPERTIES
}

function section(paras) {
  const recs = [];
  for (const t of paras) {
    const head = Buffer.alloc(24);
    head.writeUInt32LE(t.length + 1, 0);
    recs.push(record(66, 0, head)); // HWPTAG_PARA_HEADER
    const text = Buffer.alloc((t.length + 1) * 2);
    for (let i = 0; i < t.length; i++) text.writeUInt16LE(t.charCodeAt(i), i * 2);
    text.writeUInt16LE(13, t.length * 2); // 문단 끝
    recs.push(record(67, 1, text)); // HWPTAG_PARA_TEXT
  }
  return zlib.deflateRawSync(Buffer.concat(recs));
}

/** opts = {paras, password, distribution, major} → Buffer(.hwp) */
function hwp(opts = {}) {
  const paras = opts.paras || [TEXT];
  const c = CFB.utils.cfb_new();
  CFB.utils.cfb_add(c, '/FileHeader', fileHeader(opts));
  CFB.utils.cfb_add(c, '/DocInfo', docInfo(1));
  const body = opts.password ? Buffer.from('암호로 잠긴 본문 — deflate 아님'.repeat(8)) : section(paras);
  CFB.utils.cfb_add(c, opts.distribution ? '/ViewText/Section0' : '/BodyText/Section0', body);
  return Buffer.from(CFB.write(c, { type: 'buffer' }));
}

/** HWP 3.x 머리(OLE 아님) */
const hwp3 = () => Buffer.concat([Buffer.from('HWP Document File V3.00 \x1a\x01\x02\x03\x04\x05', 'latin1'), Buffer.alloc(200)]);

if (require.main === module) {
  const out = path.join(__dirname, 'sample.hwp');
  fs.writeFileSync(out, hwp());
  console.log(`${out} (${fs.statSync(out).size} bytes)`);
}

module.exports = { hwp, hwp3, TEXT };
