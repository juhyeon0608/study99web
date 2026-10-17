'use strict';
// 로컬 문서 본문 추출 [Node] (docs/specs/selective-sync.md 9.5절 · 14장 S4x): ZIP 거부 · 압축 폭탄(AC-S46) · XML(AC-S47) · 형식별(AC-S48) ·
// 코드 검사 · 라이선스(AC-S49) · 추출 Worker 시간 · 메모리 상한(AC-S4A) · 권한 모델(스파이크 SX-1) · 확장자 계약.
// 견본은 시험이 만든 ZIP(fixtures/make-office.js) · 만든 .hwp(fixtures/make-hwp.js — sample.hwp) · Word 로 저장한 sample.doc(fixtures/README.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { fork } = require('node:child_process');
const { readZip } = require('../extract/zip');
const { walkXml, decodeEntities } = require('../extract/xmltext');
const { extractText } = require('../extract/parse');
const { createRunner } = require('../extract/runner');
const K = require('../extract/kinds');
const { SYNC_EXTS } = require('../sync/filekind');
const M = require('./fixtures/make-office');
const H = require('./fixtures/make-hwp');
const { tempHome } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const TEXT = 'PaperLab 시험 문서 가나다 ABC';
const all = () => true;
const unreadable = (fn) => assert.throws(fn, (e) => e.code === 'local_unreadable');
const rejects = async (p, code) => { await assert.rejects(p, (e) => e.code === code); };

// ---------------------------------------------------------------- AC-S46 ZIP
test('AC-S46 ZIP 정상: 고른 항목만 풀고(저장 · deflate) CRC 확인', () => {
  const z = M.zip([{ name: 'a.xml', data: '<a>가</a>' }, { name: 'b.bin', data: 'bb', method: 0 }, { name: 'skip.xml', data: 'x' }]);
  const out = readZip(z, (n) => n !== 'skip.xml');
  assert.deepEqual([...out.keys()], ['a.xml', 'b.bin']);
  assert.equal(out.get('a.xml').toString(), '<a>가</a>');
});

test('AC-S46 ZIP 거부: ZIP64 표지 · 암호 · 압축 방법 12/14 · 항목 5,001개 · 비율 201배 · 선언을 속인 폭탄 · 위치 밖 · 이름 길이 다름 · CRC 다름 · 같은 이름 · 여러 디스크', () => {
  const ok = (e) => M.zip([{ name: 'x.xml', data: 'hello', ...e }]);
  unreadable(() => readZip(M.zip([{ name: 'x', data: 'a' }], { zip64Locator: true }), all));
  unreadable(() => readZip(ok({ declaredSize: 0xffffffff }), all));
  unreadable(() => readZip(M.zip([{ name: 'x', data: 'a' }], { eocdOverride: { entries: 0xffff } }), all));
  unreadable(() => readZip(ok({ flags: 0x1 }), all));
  unreadable(() => readZip(ok({ method: 12, raw: Buffer.from('xx') }), all));
  unreadable(() => readZip(ok({ method: 14, raw: Buffer.from('xx') }), all));
  const many = Array.from({ length: 5001 }, (_v, i) => ({ name: `f${i}`, data: '', method: 0 }));
  unreadable(() => readZip(M.zip(many), () => false));
  // 비율 201배: 0 으로 가득한 큰 항목(실제로도 잘 줄어듦)
  const zeros = Buffer.alloc(2 * 1024 * 1024);
  const deflated = zlib.deflateRawSync(zeros, { level: 9 });
  assert.ok(zeros.length / deflated.length > 201);
  unreadable(() => readZip(M.zip([{ name: 'z', data: zeros }]), all));
  // 선언은 작고 실제로 큰 항목: 선언 1KB · 실제 50MB 를 deflate — maxOutputLength(선언 크기)에서 멈춤
  const big = zlib.deflateRawSync(Buffer.alloc(50 * 1024 * 1024, 0x41), { level: 9 });
  const before = process.memoryUsage().rss;
  unreadable(() => readZip(M.zip([{ name: 'bomb', data: Buffer.alloc(1024, 0x41), raw: big, declaredSize: 1024, declaredCsize: big.length, crc: 0 }]), all));
  assert.ok(process.memoryUsage().rss - before < 600 * 1024 * 1024, '메모리 최고점 < 600MB');
  unreadable(() => readZip(ok({ offset: 10 ** 6 }), all));
  unreadable(() => readZip(ok({ localName: 'xx.xml' }), all));
  unreadable(() => readZip(ok({ crc: 1234 }), all));
  unreadable(() => readZip(M.zip([{ name: 'x', data: 'a' }, { name: 'x', data: 'b' }]), all));
  unreadable(() => readZip(M.zip([{ name: 'x', data: 'a' }], { eocdOverride: { disk: 1 } }), all));
  unreadable(() => readZip(Buffer.from('PK\x03\x04 잘린 파일'), all));
  // 42.zip 꼴: 안의 ZIP 은 풀지 않음(바이트 그대로 돌려줌)
  const inner = M.zip([{ name: 'deep.xml', data: Buffer.alloc(100000) }]);
  const outer = readZip(M.zip([{ name: 'inner.zip', data: inner }]), all);
  assert.equal(outer.get('inner.zip').length, inner.length);
});

// ---------------------------------------------------------------- AC-S47 XML
test('AC-S47 XML: DOCTYPE · ENTITY 거부, 깊이 257 · 태그 64KB 넘음 거부, 5개 엔터티 · 숫자 참조 해독, 잘못된 코드 포인트는 지움', () => {
  const h = { open() {}, close() {}, text() {} };
  unreadable(() => walkXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>', h));
  unreadable(() => walkXml('<a><!ENTITY lol "lol"></a>', h));
  const bomb = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><lolz>&lol2;</lolz>';
  unreadable(() => walkXml(bomb, h));
  walkXml(`${'<a>'.repeat(256)}${'</a>'.repeat(256)}`, h);
  unreadable(() => walkXml(`${'<a>'.repeat(257)}${'</a>'.repeat(257)}`, h));
  unreadable(() => walkXml(`<a b="${'x'.repeat(70 * 1024)}"></a>`, h));
  unreadable(() => walkXml('<a><b></a></b>', h));
  unreadable(() => walkXml('<a>', h));
  assert.equal(decodeEntities('&lt;&gt;&amp;&quot;&apos;&#44032;&#xAC00;&nbsp;&#0;&#xD800;&#x110000;'), '<>&"\'가가&nbsp;');
  let text = '';
  walkXml('<r><t>a&amp;b<![CDATA[<c>]]></t><!-- 주석 --><?pi x?></r>', { open() {}, close() {}, text(s) { text += s; } });
  assert.equal(text, 'a&b<c>');
});

// ---------------------------------------------------------------- AC-S48 형식별
test('AC-S48 형식별 추출: docx · hwpx · pptx · xlsx(공유 문자열 · inlineStr · 숫자) · odt · odp · ods · hwp · doc 에서 견본 글이 나옴 · 조각 단위', async () => {
  const docxPages = await extractText('.docx', M.docx([TEXT, '두 번째 문단']));
  assert.deepEqual(docxPages, [`${TEXT}\n두 번째 문단`]);
  assert.deepEqual(await extractText('.hwpx', M.hwpx([TEXT, '둘', '셋'])), [`${TEXT}\n둘\n셋`], 'spine 순서(section0 → section1)');
  assert.deepEqual(await extractText('.pptx', M.pptx([[TEXT, '부제'], ['둘째 슬라이드']])), [`${TEXT}\n부제`, '둘째 슬라이드'], '슬라이드 = 조각, N 숫자 순');
  assert.deepEqual(await extractText('.xlsx', M.xlsx([[[TEXT, 3.5, { inline: '인라인' }], ['아래 행']], [['시트2']]])), [`${TEXT}\t3.5\t인라인\n아래 행`, '시트2']);
  assert.deepEqual(await extractText('.odt', M.odf('odt', [TEXT, '두  칸'])), [`${TEXT}\n두  칸`], '각주는 읽지 않음 · text:s 는 공백');
  assert.deepEqual(await extractText('.odp', M.odf('odp', [[TEXT], ['p2']])), [TEXT, 'p2']);
  assert.deepEqual(await extractText('.ods', M.odf('ods', [[[TEXT, 'c2'], ['r2']], [['t2']]])), [`${TEXT}\tc2\nr2`, 't2']);
  assert.deepEqual(await extractText('.hwp', fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.hwp'))), [TEXT]);
  assert.deepEqual(await extractText('.doc', fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.doc'))), [TEXT]);
});

test('AC-S48 조각 · 상한: 문서는 약 3,000자마다 문단 경계, 2,000조각 · 8MB 에서 멈춤', async () => {
  let seed = 7;
  const words = (n) => { let s = ''; for (let i = 0; i < n; i++) { seed = (seed * 1103515245 + 12345) % 2147483648; s += String.fromCharCode(0xac00 + (seed % 11172)); } return s; }; // 잘 줄지 않는 글(비율 상한에 걸리지 않게)
  const paras = Array.from({ length: 10 }, () => words(1000));
  const pages = await extractText('.docx', M.docx(paras));
  assert.ok(pages.every((p) => p.length <= 3000));
  assert.equal(pages.join('\n').replace(/\n/g, ''), paras.join(''));
  const many = await extractText('.pptx', M.pptx(Array.from({ length: 2100 }, (_v, i) => [`s${i}`])));
  assert.equal(many.length, 2000);
  const huge = await extractText('.docx', M.docx(Array.from({ length: 6 }, () => words(600000))));
  const bytes = Buffer.byteLength(huge.join(''), 'utf8');
  assert.ok(bytes <= 8 * 1024 * 1024 && bytes > 7 * 1024 * 1024, `${bytes}`);
  await assert.rejects(extractText('.docx', M.docx(['가'.repeat(600000)])), (e) => e.code === 'local_unreadable', '너무 잘 줄어드는 항목(비율 200배 넘음)은 거부');
});

test('AC-S48 판정: HWP 3.x · 옛 .ppt/.xls/.rtf → local_unsupported, 배포용 · 암호 .hwp · 확장자와 판정 불일치 → local_unreadable, 사진 · 빈 글 → local_no_text', async () => {
  await rejects(extractText('.hwp', H.hwp3()), 'local_unsupported');
  await rejects(extractText('.hwp', H.hwp({ major: 4 })), 'local_unsupported');
  await rejects(extractText('.hwp', H.hwp({ distribution: true })), 'local_unreadable');
  await rejects(extractText('.hwp', H.hwp({ password: true })), 'local_unreadable');
  for (const e of ['.ppt', '.xls', '.rtf']) await rejects(extractText(e, Buffer.from('x')), 'local_unsupported');
  await rejects(extractText('.docx', fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.doc'))), 'local_unreadable');
  await rejects(extractText('.doc', M.docx([TEXT])), 'local_unreadable');
  await rejects(extractText('.hwpx', M.docx([TEXT])), 'local_unreadable');
  await rejects(extractText('.jpg', Buffer.from([0xff, 0xd8, 0xff])), 'local_no_text');
  await rejects(extractText('.docx', M.docx(['   '])), 'local_no_text');
});

test('확장자 계약: LOCAL_TEXT_EXTS(서버 db.LOCAL_TEXT_EXTS 와 같음) ⊂ 동기화 확장자, 방법 표', () => {
  assert.deepEqual([...K.LOCAL_TEXT_EXTS], ['.pdf', '.docx', '.hwpx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.hwp', '.doc']);
  for (const e of K.LOCAL_TEXT_EXTS) assert.ok(SYNC_EXTS.includes(e));
  assert.deepEqual(['.pdf', '.docx', '.hwp', '.ppt', '.png', '.exe'].map(K.methodOf), ['pdf', 'zip', 'ole', 'unsupported', 'image', '']);
});

// ---------------------------------------------------------------- AC-S4A 추출 Worker
test('AC-S4A 추출 Worker: 무한 반복 → 시간 상한에서 끝나 local_unreadable, 메모리 폭주 → ERR_WORKER_OUT_OF_MEMORY → local_unreadable, 다음 작업은 정상 · 대기 넘침은 busy', async () => {
  const dir = tempHome('pl-extract-');
  const loop = path.join(dir, 'loop.js');
  fs.writeFileSync(loop, "require('node:worker_threads').parentPort.once('message', () => { for (;;) {} });\n");
  const hog = path.join(dir, 'hog.js');
  fs.writeFileSync(hog, "require('node:worker_threads').parentPort.once('message', () => { const a = []; for (;;) a.push(new Array(1e6).fill(Math.random())); });\n");
  const t0 = Date.now();
  assert.deepEqual(await createRunner({ workerFile: loop, timeoutMs: 1500 }).run('.docx', Buffer.from('x')), { ok: false, code: 'local_unreadable', why: 'timeout' });
  assert.ok(Date.now() - t0 < 10000);
  const r = await createRunner({ workerFile: hog, timeoutMs: 60000, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } }).run('.docx', Buffer.from('x'));
  assert.deepEqual([r.ok, r.code], [false, 'local_unreadable']);
  const runner = createRunner();
  const jobs = [runner.run('.hwp', fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.hwp'))), runner.run('.docx', M.docx([TEXT])), runner.run('.pptx', M.pptx([[TEXT]])), runner.run('.odt', M.odf('odt', [TEXT]))];
  const res = await Promise.all(jobs);
  assert.deepEqual(res.slice(0, 3).map((x) => x.pages), [[TEXT], [TEXT], [TEXT]]);
  assert.deepEqual(res[3], { ok: false, code: 'busy' }, '한 번에 하나 + 대기 2 — 넘으면 busy');
});

test('스파이크 SX-1: 추출 프로세스를 Node 권한 모델(--permission)로 띄워도 hwp.js · word-extractor 추출이 되고, 파일 쓰기 · 자식 프로세스는 막힘', async () => {
  const child = fork(path.join(ROOT, 'extract', 'entry.js'), [], {
    execArgv: ['--permission', `--allow-fs-read=${path.join(ROOT, '..')}`, '--allow-worker'], serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const msgs = [];
  const next = () => new Promise((resolve) => { const t = setInterval(() => { if (msgs.length) { clearInterval(t); resolve(msgs.shift()); } }, 20); });
  child.on('message', (m) => msgs.push(m));
  const ready = await next();
  assert.deepEqual(ready, { type: 'ready', permission: true });
  child.send({ type: 'extract', id: 1, ext: '.hwp', bytes: fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.hwp')) });
  child.send({ type: 'extract', id: 2, ext: '.doc', bytes: fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.doc')) });
  child.send({ type: 'extract', id: 3, ext: '.exe', bytes: Buffer.from('MZ') });
  const got = [await next(), await next(), await next()].sort((a, b) => a.id - b.id);
  assert.deepEqual(got.map((m) => [m.id, m.ok, m.pages, m.code]), [[1, true, [TEXT], ''], [2, true, [TEXT], ''], [3, false, [], 'local_unsupported']]);
  child.kill();
});

// ---------------------------------------------------------------- AC-S49 코드 검사 · 라이선스
function jsFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...jsFiles(p)); else if (/\.(js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('AC-S49 코드 검사: hwp.js · word-extractor 를 require 하는 파일은 desktop/extract/ 안뿐, 추출 코드에 디스크 쓰기 · 자식 프로세스 · 네트워크 없음', () => {
  const app = jsFiles(ROOT).filter((f) => !f.includes(`${path.sep}test${path.sep}`));
  for (const f of app) {
    const src = fs.readFileSync(f, 'utf8');
    if (/require\(\s*['"](hwp\.js|word-extractor)['"]\s*\)/.test(src)) assert.ok(f.startsWith(path.join(ROOT, 'extract') + path.sep), `${path.relative(ROOT, f)} 가 파서를 불러옴`);
  }
  for (const f of jsFiles(path.join(ROOT, 'extract'))) {
    const src = fs.readFileSync(f, 'utf8');
    assert.ok(!/\bfs(\.promises)?\.(write|append|mkdir|rm|unlink|rename|copy)\w*\s*\(|require\(['"](node:)?(fs|child_process|net|http|https|dgram|tls)['"]\)|\bfetch\(/.test(src), `${path.relative(ROOT, f)}`);
  }
});

test('AC-S49 라이선스: 정확한 버전 · 허용 라이선스 · 고지 파일에 운영 의존성 전부(+ PDF.js)', () => {
  const { check } = require('../scripts/check-licenses');
  assert.deepEqual(check(), []);
  const notices = fs.readFileSync(path.join(ROOT, 'build', 'THIRD_PARTY_NOTICES.txt'), 'utf8');
  for (const n of ['hwp.js@0.0.3 — Apache-2.0', 'word-extractor@1.0.4 — MIT', 'cfb@1.2.2', 'pako@1.0.11', 'yauzl@2.10.0', 'saxes@5.0.1', 'PDF.js']) assert.ok(notices.includes(n), n);
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  assert.match(lock.packages['node_modules/hwp.js'].integrity, /^sha512-/);
  assert.match(lock.packages['node_modules/word-extractor'].integrity, /^sha512-/);
});
