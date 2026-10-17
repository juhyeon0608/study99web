'use strict';
// 선택 동기화 PC 엔진 [Node] (docs/specs/selective-sync.md 14장 S3x · S71 · S72): 파일 종류(AC-S31) · 세 갈래 비교 새 줄(AC-S32) ·
// 다른 PC에만 두기 사본(AC-S33) · 표현 바뀜(AC-S34) · 저널 v1 → v2(AC-S35) · v1 모드(AC-S36) · 받기 접두어(AC-S37) · add_local(AC-S38) ·
// 0.3.1 + 새 서버 = 426(AC-S71). 가짜 서버(fixtures/fake-sync-api.js — 계약 C-1) · 임시 루트 · 가짜 휴지통만 쓴다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../sync/filekind');
const R = require('../sync/reconcile');
const P = require('../sync/paths');
const journal = require('../sync/journal');
const { checkUrl } = require('../sync/transfer');
const { createApi } = require('../worker/api-client');
const { setup, sha, pdf, UID } = require('./sync-harness');
const M = require('./fixtures/make-office');

const API = '/api/worker/sync';
const docx = (t) => M.docx([t]);
const sample = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n));

// ---------------------------------------------------------------- AC-S31 파일 종류
test('AC-S31 filekind: 동기화 확장자 = 서버 ACCEPT_EXTS 순서, kindOf 는 convert.kind 와 같은 판정(첫 바이트 %PDF · 확장자 + 매직)', () => {
  assert.deepEqual([...K.SYNC_EXTS], ['.pdf', '.doc', '.docx', '.hwp', '.hwpx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods', '.rtf',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp']);
  const ZIP = Buffer.from('PK\x03\x04rest', 'latin1');
  const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
  const cases = [
    [pdf('x'), 'a.pdf', 'pdf'], [pdf('x'), 'a.docx', 'pdf'], [pdf('x'), 'a.jpg', 'pdf'], [ZIP, 'a.pdf', ''], [ZIP, 'a.docx', 'doc'], [ZIP, 'a.hwpx', 'doc'],
    [OLE, 'a.hwp', 'doc'], [OLE, 'a.doc', 'doc'], [OLE, 'a.xls', 'doc'], [Buffer.from('{\\rtf1'), 'a.rtf', 'doc'], [Buffer.from('{\\rtf1'), 'a.doc', ''],
    [ZIP, 'a.rtf', 'doc'], [Buffer.from('hello'), 'a.docx', ''], [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'a.jpg', 'image'], [Buffer.from([0xff, 0xd8, 0xff]), 'a.png', 'image'],
    [Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), 'a.png', 'image'], [Buffer.from('GIF89a'), 'a.gif', 'image'], [Buffer.from('BM..'), 'a.bmp', 'image'],
    [Buffer.from('II*\x00', 'latin1'), 'a.tif', 'image'], [Buffer.from('MM\x00*', 'latin1'), 'a.tiff', 'image'], [Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'), 'a.webp', 'image'],
    [Buffer.from('RIFF\x00\x00\x00\x00WAVE', 'latin1'), 'a.webp', ''], [ZIP, 'a.jpg', ''], [OLE, 'a.exe', ''], [Buffer.from('GIF89a'), 'a', ''],
  ];
  for (const [head, name, want] of cases) assert.equal(K.kindOf(head, name), want, `${name}`);
  assert.equal(K.extOf('보고서.HWP'), '.hwp');
  assert.equal(K.extOf('.pdf'), '');
  assert.equal(K.isSyncName('발표.PPTX'), true);
  assert.equal(K.isSyncName('a.exe'), false);
  assert.equal(P.nameProblem('보고서.docx', { file: true }), '');
  assert.equal(P.nameProblem('바로가기.lnk', { file: true }), 'bad_name');
  assert.equal(P.nameProblem('CON.docx', { file: true }), 'bad_name');
  assert.equal(P.nameProblem('a', { file: true }), 'bad_name');
});

test('AC-S37 받기 주소: users/{내 uid}/papers/ 또는 sources/ 만, 남의 uid · 다른 접두어는 요청 0', () => {
  const o = { serverOrigin: 'http://127.0.0.1:9', dev: true, uid: UID };
  assert.ok(checkUrl(`/_dev_storage/users/${UID}/sources/5.docx?X=1`, 'get', o));
  assert.ok(checkUrl(`/_dev_storage/users/${UID}/papers/5.pdf?X=1`, 'get', o));
  assert.throws(() => checkUrl(`/_dev_storage/users/${UID}/rag/5.bin`, 'get', o), /bad_url/);
  assert.throws(() => checkUrl(`/_dev_storage/users/00000000-0000-0000-0000-000000000000/sources/5.docx`, 'get', o), /bad_url/);
  assert.throws(() => checkUrl(`/_dev_storage/users/${UID}/sources/5.docx`, 'put', o), /bad_url/, '올리기는 incoming/ 만');
  const prod = { serverOrigin: 'https://paperlab.example', dev: false, uid: UID };
  assert.ok(checkUrl(`https://b.r2.cloudflarestorage.com/bucket/users/${UID}/sources/5.hwp?X-Amz-Signature=1`, 'get', prod));
});

test('API 머리글: 동기화 클라이언트는 모든 요청에 X-PaperLab-Sync: 2, 기본 머리글 · 인증은 덮어쓰지 못함 · 요청마다 시간 제한', async () => {
  const seen = [];
  const fetchImpl = async (url, o) => { seen.push(o); return { ok: true, json: async () => ({ ok: true }) }; };
  const api = createApi({ baseUrl: 'http://x', getToken: () => 'T', fetchImpl, headers: { 'X-PaperLab-Sync': '2', 'X-PaperLab': '9', Authorization: 'evil' } });
  await api.post('/a', {});
  assert.equal(seen[0].headers['X-PaperLab-Sync'], '2');
  assert.equal(seen[0].headers['X-PaperLab'], '1');
  assert.equal(seen[0].headers.Authorization, 'Bearer T');
  const plain = createApi({ baseUrl: 'http://x', getToken: () => 'T', fetchImpl });
  await plain.post('/b', {});
  assert.equal(seen[1].headers['X-PaperLab-Sync'], undefined, '워커 클라이언트에는 없음');
});

// ---------------------------------------------------------------- AC-S32 세 갈래 비교 새 줄 (8.3절 표)
function S(papers = [], folders = []) {
  return { folders: new Map(folders.map((f) => [f.id, { sync_mode: 'inherit', parent_id: null, ...f }])),
    papers: new Map(papers.map((p) => [p.id, { folder_id: null, size: 1, kind: 'pdf', storage: 'cloud', holder: null, holderGone: false, pending: '', ...p }])),
    trashed: new Map(), gonePapers: new Set(), goneFolders: new Set() };
}
const J = (files = {}, extra = {}) => ({ files, folders: {}, kept: [], swapping: {}, modeFails: {}, ...extra });
const Lf = (files) => ({ files: files.map((f) => ({ key: P.fold(f.rel), size: 1, mtime_ms: 1, ino: '', ...f })), dirs: [], excluded: { files: [], dirs: [] } });
const jf = (rel, sha256) => ({ rel, sha256, size: 1, mtime_ms: 1, ino: '', kind: 'pdf' });
const plan = (j, l, s, o = {}) => R.planFiles(j, l, s, { me: 7, proto: 2, ...o });
const ts = (r) => r.acts.map((a) => a.t);

test('AC-S32 로컬 항목 · 보관 = 나: 내용 바뀜 → upload_content(local), 사라짐 → srv_delete, 없음 → local_missing, 같은 해시 → link, 켜기 대기 → promote', () => {
  const sp = { id: 1, file_name: 'a.pdf', sha256: 'h1', storage: 'local', holder: 7, kind: 'local' };
  let r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([{ rel: 'a.pdf', sha256: 'h2' }]), S([sp]));
  assert.deepEqual(r.acts.map((a) => [a.t, a.local]), [['upload_content', true]]);
  r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([]), S([sp]));
  assert.deepEqual(ts(r), ['srv_delete']);
  r = plan(J(), Lf([]), S([sp]));
  assert.deepEqual(ts(r), []);
  assert.deepEqual(r.problems.map((p) => p.code), ['local_missing']);
  r = plan(J(), Lf([{ rel: 'a.pdf', sha256: 'h1' }]), S([sp]));
  assert.deepEqual(ts(r), ['link']);
  r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([{ rel: 'a.pdf', sha256: 'h1' }]), S([{ ...sp, pending: 'to_cloud' }]));
  assert.deepEqual(ts(r), ['promote']);
  r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([{ rel: 'a.pdf', sha256: 'h2' }]), S([{ ...sp, pending: 'to_cloud' }]));
  assert.deepEqual(ts(r), ['upload_content'], '바뀐 내용 먼저 → 다음 바퀴 promote');
});

test('AC-S32 로컬 항목 · 보관 = 남: 사본 → trash_local(moved_local), 여기서 고침 → 새 항목, 새 같은 파일 → local_elsewhere, 보관 PC 없어짐 → add_local(넘겨받기), 없음 → 받지 않음', () => {
  const sp = { id: 1, file_name: 'a.pdf', sha256: 'h1', storage: 'local', holder: 9, kind: 'local' };
  let r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([{ rel: 'a.pdf', sha256: 'h1' }]), S([sp]));
  assert.deepEqual(r.acts.map((a) => [a.t, a.reason]), [['trash_local', 'moved_local']]);
  r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([{ rel: 'a.pdf', sha256: 'h2' }]), S([sp]));
  assert.deepEqual(r.acts.map((a) => [a.t, a.dropPid, a.note]), [['upload_new', 1, 'local_kept_new']]);
  r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([]), S([sp]));
  assert.deepEqual(ts(r), ['drop'], '이 PC 사본이 사라져도 서재 항목은 지우지 않음');
  r = plan(J(), Lf([{ rel: 'b.pdf', sha256: 'h1' }]), S([sp]));
  assert.deepEqual(ts(r), []);
  assert.deepEqual(r.problems.map((p) => p.code), ['local_elsewhere']);
  r = plan(J(), Lf([{ rel: 'b.pdf', sha256: 'h1' }]), S([{ ...sp, holderGone: true }]));
  assert.deepEqual(ts(r), ['add_local']);
  r = plan(J(), Lf([]), S([sp]));
  assert.deepEqual([ts(r), r.problems], [[], []]);
});

test('AC-S32 끄기 대기(cloud + to_local): 보관 = 나 · 같은 해시 → mode_ack, 받을 수 없음 → mode_fail(한 번만), 보관 = 남 → 켬 규칙 그대로', () => {
  const sp = { id: 1, file_name: 'a.pdf', sha256: 'h1', pending: 'to_local', holder: 7 };
  let r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([{ rel: 'a.pdf', sha256: 'h1' }]), S([sp]));
  assert.deepEqual(r.acts.map((a) => [a.t, a.sha256]), [['mode_ack', 'h1']]);
  r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([{ rel: 'a.pdf', sha256: 'h2' }]), S([sp]));
  assert.deepEqual(ts(r), ['upload_content'], '여기서 고침 — 지금 흐름 먼저, 다음 바퀴에 확인');
  const bad = { ...sp, file_name: 'CON.pdf' };
  r = plan(J(), Lf([]), S([bad]));
  assert.deepEqual(r.acts.map((a) => [a.t, a.reason]), [['mode_fail', 'missing']]);
  r = plan(J({}, { modeFails: { 1: 'missing' } }), Lf([]), S([bad]));
  assert.deepEqual(ts(r), [], '같은 이유는 다시 보내지 않음');
  r = plan(J(), Lf([]), S([sp]), { root: `C:\\${'긴'.repeat(250)}` });
  assert.deepEqual(r.acts.map((a) => [a.t, a.reason]), [['mode_fail', 'too_long']]);
  r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([{ rel: 'a.pdf', sha256: 'h1' }]), S([{ ...sp, holder: 9 }]));
  assert.deepEqual(ts(r), [], '보관 = 남 — 아직 켬');
  r = plan(J(), Lf([]), S([sp]));
  assert.deepEqual(ts(r), ['download'], '보관 = 나 · 아직 없음 — 받은 뒤 확인');
});

test('AC-S32 표현 바뀜(D-8): 확장자 · 해시가 다르면 swap_rep, 옛 변환본을 고쳤으면 새 항목 + 원본 받기, 같은 해시면 이름만(옮기기)', () => {
  const sp = { id: 1, file_name: 'X.docx', sha256: 'src', kind: 'source' };
  let r = plan(J({ 1: jf('X.pdf', 'conv') }), Lf([{ rel: 'X.pdf', sha256: 'conv' }]), S([sp]));
  assert.deepEqual(r.acts.map((a) => [a.t, a.from, a.to, a.oldSha]), [['swap_rep', 'X.pdf', 'X.docx', 'conv']]);
  r = plan(J({ 1: jf('X.pdf', 'conv') }), Lf([{ rel: 'X.pdf', sha256: 'edited' }]), S([sp]));
  assert.deepEqual(r.acts.map((a) => [a.t, a.rel, a.dropPid]), [['upload_new', 'X.pdf', 1], ['download', 'X.docx', undefined]]);
  r = plan(J({ 1: jf('X.pdf', 'src') }), Lf([{ rel: 'X.pdf', sha256: 'src' }]), S([sp]));
  assert.deepEqual(ts(r), ['local_move']);
  r = plan(J({ 1: jf('X.pdf', 'conv') }), Lf([{ rel: 'X.pdf', sha256: 'conv' }]), S([sp]), { proto: 1 });
  assert.notDeepEqual(ts(r), ['swap_rep'], 'v1 은 swap_rep 를 만들지 않음');
  r = plan(J({ 1: jf('X.docx', 'src') }, { swapping: { 'x.pdf': { rel: 'X.pdf', sha256: 'conv' } } }),
    Lf([{ rel: 'X.docx', sha256: 'src' }, { rel: 'X.pdf', sha256: 'conv' }]), S([sp]));
  assert.deepEqual(ts(r), [], '바꾸는 중인 옛 파일은 새 파일로 읽지 않음');
});

test('AC-S32 PC 새 파일: 끔 폴더(상속 포함)면 add_local, 켬이면 upload_new, upload_required 받은 파일은 올림 · effectiveMode 상속', () => {
  const folders = [{ id: 10, name: '개인', sync_mode: 'local' }, { id: 11, name: '하위', parent_id: 10 }, { id: 12, name: '공개', parent_id: 10, sync_mode: 'cloud' }];
  const j = J({}, { folders: { 10: { rel: '개인' }, 11: { rel: '개인\\하위' }, 12: { rel: '개인\\공개' } } });
  assert.equal(R.effectiveMode(S([], folders), 11), 'local');
  assert.equal(R.effectiveMode(S([], folders), 12), 'cloud');
  assert.equal(R.effectiveMode(S([], folders), null), 'cloud');
  const cyc = S([], [{ id: 1, name: 'a', parent_id: 2 }, { id: 2, name: 'b', parent_id: 1 }]);
  assert.equal(R.effectiveMode(cyc, 1), 'cloud', '순환은 방문 집합으로 막음');
  const files = (r) => r.acts.filter((a) => !/^folder_/.test(a.t)); // 시험 L 에 디렉터리가 없어 생기는 폴더 줄은 뺌
  const r = plan(j, Lf([{ rel: '개인\\하위\\a.docx', sha256: 'a' }, { rel: '개인\\공개\\b.docx', sha256: 'b' }, { rel: 'c.docx', sha256: 'c' }]), S([], folders));
  assert.deepEqual(files(r).map((a) => [a.t, a.rel]), [['add_local', '개인\\하위\\a.docx'], ['upload_new', '개인\\공개\\b.docx'], ['upload_new', 'c.docx']]);
  const forced = plan(j, Lf([{ rel: '개인\\하위\\a.docx', sha256: 'a' }]), S([], folders), { forceCloud: new Set([`${P.fold('개인\\하위\\a.docx')}\na`]) });
  assert.deepEqual(files(forced).map((a) => a.t), ['upload_new']);
  assert.deepEqual(files(plan(j, Lf([{ rel: '개인\\하위\\a.pdf', sha256: 'a' }]), S([], folders), { proto: 1 })).map((a) => a.t), ['upload_new'], 'v1 은 add_local 을 만들지 않음');
});

// ---------------------------------------------------------------- 엔진 · 가짜 서버 v2
test('v2 문서 동기화: PC .docx → 원본 그대로 올림(kind source), 서재 .pptx 원본 → sources/ 서명 주소로 원래 이름 그대로 받음', async () => {
  const env = setup({ protocol: 2 });
  env.writeBytes('보고서.docx', docx('PaperLab 시험 문서 가나다 ABC'));
  const pid = env.api.add('발표.pptx', M.pptx([['슬라이드']]));
  const e = await env.connect(env.make());
  assert.equal(e.proto, 2);
  const added = env.api.calls.find((c) => c.path === `${API}/files/add`);
  assert.deepEqual([added.body.file_name, added.body.storage], ['보고서.docx', 'cloud']);
  const doc = env.api.live().find((p) => p.file_name === '보고서.docx');
  assert.equal(doc.kind, 'source');
  assert.ok(env.api.storage.has(`users/${UID}/sources/${doc.id}.docx`));
  assert.ok(env.exists('발표.pptx'));
  assert.equal(sha(env.read('발표.pptx')), env.api.papers.get(pid).sha256);
  assert.ok(env.urls.some((u) => u.method === 'GET' && u.url.includes(`/users/${UID}/sources/`)));
  assert.equal(e.J.files[pid].kind, 'source');
  assert.equal(e.J.files[doc.id].kind, 'source');
});

test('v2 형식 판정: 확장자와 내용이 맞지 않으면 bad_format(올리지 않음), .pdf 이름이면 not_pdf', async () => {
  const env = setup({ protocol: 2 });
  env.writeBytes('가짜.docx', Buffer.from('그냥 글자'));
  env.writeBytes('가짜.pdf', docx('x'));
  const e = await env.connect(env.make());
  assert.equal(env.api.count(`${API}/files/add`), 0);
  const codes = e.problems.map((p) => [p.code, p.rel]);
  assert.ok(codes.some(([c, r]) => c === 'bad_format' && r === '가짜.docx'));
  assert.ok(codes.some(([c, r]) => c === 'not_pdf' && r === '가짜.pdf'));
});

test('AC-S38 끔 폴더의 새 파일 → add_local(업로드 0 · R2 0), 서버가 upload_required 면 그 파일만 다음 바퀴에 올림', async () => {
  const env = setup({ protocol: 2 });
  const fid = env.api.folder('개인', null, 'local');
  env.writeBytes('개인\\메모.hwp', sample('sample.hwp'));
  const e = await env.connect(env.make());
  const local = env.api.live().find((p) => p.file_name === '메모.hwp');
  assert.ok(local && local.storage === 'local' && local.holder === 7);
  assert.equal(env.api.count(`${API}/upload-slots`), 0);
  assert.equal(env.urls.filter((u) => u.method === 'PUT').length, 0);
  assert.equal([...env.api.storage.keys()].filter((k) => k.startsWith('users/')).length, 0, 'R2 객체 0');
  assert.equal(e.J.files[local.id].kind, 'local');
  assert.equal(e.snapshot().counts.local, 1);
  // 서버 폴더가 켬으로 바뀌었는데 엔진은 아직 모름 → add_local 이 409 upload_required → 다음 바퀴 upload_new
  env.api.folders.get(fid).sync_mode = 'cloud';
  env.writeBytes('개인\\새 메모.docx', docx('둘째'));
  await env.spin(e, 2);
  const adds = env.api.calls.filter((c) => c.path === `${API}/files/add` && c.body.file_name === '새 메모.docx');
  assert.deepEqual(adds.map((c) => c.body.storage), ['local', 'cloud']);
  const up = env.api.live().find((p) => p.file_name === '새 메모.docx');
  assert.equal(up.storage, 'cloud');
});

test('AC-S21(엔진) 끄기 대기 → mode.ack(해시 일치) → 로컬 항목 · R2 지움 · 파일 그대로, 고치면 메타데이터만 · 켜기 대기 → promote 로 올림', async () => {
  const env = setup({ protocol: 2 });
  env.write('a.pdf', 'A');
  const e = await env.connect(env.make());
  const pid = Object.keys(e.J.files).map(Number)[0];
  const key = `users/${UID}/papers/${pid}.pdf`;
  assert.ok(env.api.storage.has(key));
  env.api.webMode(pid, 'local', 7);
  await env.spin(e, 2);
  assert.equal(env.api.opCount('mode.ack'), 1);
  assert.equal(env.api.papers.get(pid).storage, 'local');
  assert.ok(!env.api.storage.has(key), 'R2 객체 지움');
  assert.ok(env.exists('a.pdf'), 'PC 파일은 그대로');
  assert.equal(e.J.files[pid].kind, 'local');
  // 로컬 항목 내용 바꿈 → content(업로드 자리 없이 해시 · 크기만)
  const slots0 = env.api.count(`${API}/upload-slots`);
  env.write('a.pdf', 'A2');
  await env.spin(e, 2);
  const content = env.api.calls.find((c) => c.path === `${API}/files/${pid}/content`);
  assert.ok(content && !content.body.upload_id && content.body.size > 0);
  assert.equal(env.api.count(`${API}/upload-slots`), slots0);
  assert.equal(env.api.papers.get(pid).sha256, sha(env.read('a.pdf')));
  // 켜기 → promote(업로드 자리 → PUT → files/{id}/promote)
  env.api.webMode(pid, 'cloud');
  await env.spin(e, 2);
  assert.equal(env.api.count(`${API}/files/${pid}/promote`), 1);
  assert.equal(env.api.papers.get(pid).storage, 'cloud');
  assert.ok(env.api.storage.has(key));
  assert.equal(e.J.files[pid].kind, 'pdf');
  assert.equal(env.api.opCount('file.delete'), 0);
});

test('AC-S33 다른 PC에만 두기로 바뀐 사본: 기준 아래면 바로 Windows 휴지통(가짜), 서재 항목 그대로 · file.delete 0', async () => {
  const env = setup({ protocol: 2 });
  env.api.device(9, '연구실 PC');
  env.write('b.pdf', 'B');
  const e = await env.connect(env.make());
  const pid = Object.keys(e.J.files).map(Number)[0];
  Object.assign(env.api.papers.get(pid), { storage: 'local', holder: 9, kind: 'local' });
  env.api.storage.delete(`users/${UID}/papers/${pid}.pdf`);
  env.api.bump('paper', pid);
  await env.spin(e, 2);
  assert.ok(!env.exists('b.pdf'));
  assert.equal(env.trashed.length, 1);
  assert.ok(env.api.papers.get(pid) && !env.api.papers.get(pid).deleted_at, '서재 항목은 그대로');
  assert.equal(env.api.opCount('file.delete'), 0);
  assert.equal(e.J.files[pid], undefined);
});

test('AC-S33 많으면 moved_local 확인 창(되돌리기 없음) · [나중에] · [이 PC에서 지우기] → 가짜 휴지통', async () => {
  const env = setup({ protocol: 2 });
  env.api.device(9, '연구실 PC');
  for (let i = 0; i < 12; i++) env.write(`f${i}.pdf`, `F${i}`);
  const e = await env.connect(env.make());
  for (const pid of Object.keys(e.J.files).map(Number)) { Object.assign(env.api.papers.get(pid), { storage: 'local', holder: 9, kind: 'local' }); env.api.bump('paper', pid); }
  await env.spin(e, 2);
  assert.equal(e.snapshot().state, 'waiting_confirm');
  assert.equal(e.held.kind, 'moved_local');
  assert.ok(env.emitted.some((m) => m.type === 'notify' && m.kind === 'moved_local'));
  assert.equal(env.trashed.length, 0);
  assert.equal(await e.confirm(e.held.batch_id, 'revert'), false, '되돌리기 없음');
  await e.confirm(e.held.batch_id, 'later');
  await env.spin(e, 1);
  assert.equal(env.trashed.length, 0);
  await e.confirm(e.held.batch_id, 'continue');
  await env.spin(e, 2);
  assert.equal(env.trashed.length, 12);
  assert.equal(env.api.live().length, 12, '서재는 그대로');
});

test('다른 PC 보관 항목을 여기서 고침 → 새 항목으로 올리고 알림, 같은 파일 새로 넣음 → local_elsewhere(연결 안 함), 보관 PC 해지 → adopted', async () => {
  const env = setup({ protocol: 2 });
  env.api.device(9, '연구실 PC');
  const bytes = pdf('C');
  const lid = env.api.addLocal('c.pdf', bytes, null, 9);
  env.writeBytes('여기\\c.pdf', bytes);
  const e = await env.connect(env.make());
  assert.equal(env.api.count(`${API}/files/add`), 0, '연결 · 올리기 없음');
  assert.ok(e.problems.some((p) => p.code === 'local_elsewhere'));
  assert.equal(Object.keys(e.J.files).length, 0);
  env.api.revoke(9);
  await env.spin(e, 2);
  const add = env.api.calls.find((c) => c.path === `${API}/files/add`);
  assert.equal(add.body.storage, 'local');
  assert.equal(env.api.papers.get(lid).holder, 7, '넘겨받음(adopted)');
  assert.equal(e.J.files[lid].kind, 'local');

  const env2 = setup({ protocol: 2 });
  env2.api.device(9, '연구실 PC');
  env2.write('d.pdf', 'D');
  const e2 = await env2.connect(env2.make());
  const pid = Object.keys(e2.J.files).map(Number)[0];
  Object.assign(env2.api.papers.get(pid), { storage: 'local', holder: 9, kind: 'local' });
  env2.api.bump('paper', pid);
  env2.write('d.pdf', 'D 고침');
  await env2.spin(e2, 2);
  const fresh = env2.api.live().find((p) => p.id !== pid && p.file_name.startsWith('d'));
  assert.ok(fresh && fresh.storage === 'cloud', '고친 사본은 새 항목(서재 이름이 겹치면 서버가 바꿈 — K-8)');
  assert.ok(env2.exists(fresh.file_name), '고친 파일은 이 PC에 남음');
  assert.equal(env2.trashed.length, 0);
  assert.ok(env2.emitted.some((m) => m.type === 'notify' && m.kind === 'local_kept_new'));
});

test('AC-S34 표현 바뀜: 옛 변환본 X.pdf → 원본 X.docx 받기 → 옛 파일 휴지통 · 알림, 휴지통이 중단돼도 옛 파일을 새 파일로 올리지 않음', async () => {
  const env = setup({ protocol: 2 });
  const pid = env.api.add('X.pdf', pdf('변환본'));
  const e = await env.connect(env.make());
  assert.ok(env.exists('X.pdf'));
  let abort = true;
  env.trashOverride = (abs) => (abort ? { ok: false, reason: 'aborted' } : env.trashImpl(abs));
  env.api.webToSource(pid, 'X.docx', docx('원본'));
  await env.spin(e, 2);
  assert.ok(env.exists('X.docx'));
  assert.equal(sha(env.read('X.docx')), env.api.papers.get(pid).sha256);
  assert.equal(e.J.files[pid].rel, 'X.docx');
  assert.equal(e.J.files[pid].kind, 'source');
  assert.ok(env.exists('X.pdf'), '휴지통 중단 — 제자리');
  assert.ok(Object.keys(e.J.swapping).length === 1);
  const adds = env.api.count(`${API}/files/add`);
  await env.spin(e, 2);
  assert.equal(env.api.count(`${API}/files/add`), adds, '옛 변환본을 새 항목으로 올리지 않음');
  abort = false;
  e.retries.clear();
  await env.spin(e, 2);
  assert.ok(!env.exists('X.pdf'));
  assert.deepEqual(e.J.swapping, {});
  assert.ok(env.emitted.some((m) => m.type === 'notify' && m.kind === 'swap_rep'));
  assert.equal(env.api.opCount('file.delete'), 0);
});

test('AC-S35 저널 v1 → v2: 0.3.x 저널을 읽으면 v2 로 쓰고 전체 다시 맞추기, 삭제 추론 0', async () => {
  const env = setup({ protocol: 1 });
  env.write('a.pdf', 'A');
  env.write('폴더\\b.pdf', 'B');
  const e1 = await env.connect(env.make());
  e1.stop();
  const j = JSON.parse(fs.readFileSync(env.journalFile, 'utf8'));
  j.version = 1;
  for (const f of Object.values(j.files)) delete f.kind;
  delete j.swapping; delete j.modeFails;
  fs.writeFileSync(env.journalFile, JSON.stringify(j));
  env.api.protocol = 2; // 서버도 새로 배포됨
  const before = env.api.calls.length;
  const e2 = env.make({ settings: { enabled: true, root: env.root, installId: 'I1' } });
  await e2.start();
  await e2.cycle();
  await env.spin(e2, 2);
  assert.equal(e2.proto, 2);
  assert.equal(JSON.parse(fs.readFileSync(env.journalFile, 'utf8')).version, 2);
  const after = env.api.calls.slice(before);
  assert.equal(after.filter((c) => c.path.endsWith('/ops') && c.body.ops.some((o) => o.type === 'file.delete')).length, 0);
  assert.equal(env.trashed.length, 0);
  assert.deepEqual(env.tree(), ['a.pdf', '폴더\\b.pdf']);
});

test('AC-S36 v1 모드(옛 서버 — protocol 없음): .pdf 만 · 문서는 건드리지 않음 · 새 동작 0 · resolve 는 unsupported', async () => {
  const env = setup({ protocol: 1 });
  env.write('a.pdf', 'A');
  env.writeBytes('보고서.docx', docx('x'));
  const e = await env.connect(env.make());
  assert.equal(e.proto, 1);
  assert.deepEqual(env.api.calls.filter((c) => c.path === `${API}/files/add`).map((c) => [c.body.file_name, c.body.storage]), [['a.pdf', undefined]]);
  assert.ok(!e.problems.some((p) => p.rel === '보고서.docx'), '문서는 문제 목록에도 없음(보지 않음)');
  assert.equal(e.resolveLocal(Object.keys(e.J.files)[0]).code, 'unsupported');
  assert.deepEqual(e.localHas([1, 2]), {});
  assert.equal(env.api.calls.filter((c) => /promote|mode\./.test(c.path) || (c.body.ops || []).some((o) => /^mode\./.test(o.type))).length, 0);
});

test('AC-S72 서버 배포(프로토콜 1 → 2): 다음 전체 맞추기 때 v2 로 바뀌고 문서를 맞추기 시작', async () => {
  const env = setup({ protocol: 1 });
  env.writeBytes('보고서.docx', docx('x'));
  const e = await env.connect(env.make());
  assert.equal(env.api.count(`${API}/files/add`), 0);
  env.api.protocol = 2;
  e.syncNow();
  await env.spin(e, 2);
  assert.equal(e.proto, 2);
  assert.ok(env.api.live().some((p) => p.file_name === '보고서.docx'));
});

test('AC-S71 머리글 없는 옛 앱(0.3.1) + 새 서버 = 426: update_required, 파일 · 저널 변화 0', async () => {
  const env = setup({ protocol: 2 });
  env.write('a.pdf', 'A');
  const e = await env.connect(env.make());
  const journalBefore = fs.readFileSync(env.journalFile);
  const treeBefore = env.tree();
  env.api.v1Client = true;
  env.write('b.pdf', 'B');
  await env.spin(e, 2);
  assert.equal(e.snapshot().state, 'update_required');
  assert.ok(env.emitted.some((m) => m.type === 'update-required'));
  assert.deepEqual(env.tree(), [...treeBefore, 'b.pdf'].sort());
  assert.equal(env.trashed.length, 0);
  assert.equal(env.api.live().length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(env.journalFile)).files, JSON.parse(journalBefore).files);
});

test('로컬 파일 위치(resolve): 이 PC 보관 로컬 항목 · 켬 항목 구분, 쓰는 중(크기 · 시각 다름) → changed, 없음 → missing · localHas', async () => {
  const env = setup({ protocol: 2 });
  env.api.folder('개인', null, 'local');
  env.writeBytes('개인\\메모.docx', docx('x'));
  env.write('공개.pdf', 'P');
  const e = await env.connect(env.make());
  const local = env.api.live().find((p) => p.file_name === '메모.docx');
  const cloud = env.api.live().find((p) => p.file_name === '공개.pdf');
  const r = e.resolveLocal(local.id);
  assert.deepEqual([r.ok, r.storage, r.mine, r.ext, r.rel], [true, 'local', true, '.docx', '개인\\메모.docx']);
  assert.equal(r.abs, path.join(env.root, '개인', '메모.docx'));
  const c = e.resolveLocal(cloud.id);
  assert.deepEqual([c.ok, c.storage, c.mine], [true, 'cloud', false]);
  assert.equal(e.resolveLocal(999999).code, 'not_local');
  assert.deepEqual(e.localHas([local.id, cloud.id, 999999]), { [local.id]: 'here' });
  fs.appendFileSync(path.join(env.root, '개인', '메모.docx'), 'x');
  assert.equal(e.resolveLocal(local.id).code, 'changed');
  fs.unlinkSync(path.join(env.root, '개인', '메모.docx'));
  assert.equal(e.resolveLocal(local.id).code, 'missing');
  assert.deepEqual(e.localHas([local.id]), { [local.id]: 'missing' });
  e.rootIssue = 'missing';
  assert.equal(e.resolveLocal(local.id).code, 'sync_off');
});

test('받기 local_only: 그 사이 PC에만 두기로 바뀐 파일은 건너뜀(전체 다시 받기 · 재시도 없음)', async () => {
  const env = setup({ protocol: 2 });
  const e = await env.connect(env.make());
  const pid = env.api.add('늦게.pdf', pdf('L'));
  await e.pollFeed();
  Object.assign(env.api.papers.get(pid), { storage: 'local', holder: 9, kind: 'local' }); // 피드에 아직 안 올라옴
  e.needFull = false;
  const problems = [];
  const done = await e.downloads([{ t: 'download', pid, rel: '늦게.pdf', replace: false, sha256: env.api.papers.get(pid).sha256, size: 10 }], problems, () => {});
  assert.equal(done, 0);
  assert.equal(e.needFull, false);
  assert.equal(e.retries.size, 0);
  assert.ok(!env.exists('늦게.pdf'));
});

test('journal v2: swapping · modeFails 를 보존하고 v1 저널은 migrated 표시(파일에는 쓰지 않음)', () => {
  const env = setup();
  const file = path.join(env.home, 'j.json');
  const j = journal.fresh({ root: 'C:\\r' });
  j.swapping['x.pdf'] = { rel: 'X.pdf', sha256: 'a' };
  j.modeFails[5] = 'missing';
  journal.save(file, j);
  const back = journal.load(file);
  assert.deepEqual([back.swapping, back.modeFails, back.migrated], [j.swapping, { 5: 'missing' }, undefined]);
  fs.writeFileSync(file, JSON.stringify({ version: 1, files: { 3: { rel: 'a.pdf', sha256: 'h' } }, folders: {} }));
  const old = journal.load(file);
  assert.deepEqual([old.version, old.migrated, old.files[3].kind], [2, true, 'pdf']);
  journal.save(file, old);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).migrated, undefined);
});

test('10.8 · 10.9 문구: 새 문제 이유 · 알림 · 확인 창(moved_local — 되돌리기 없음) · 개수 줄에 문구가 있음', () => {
  const Look = require('../ui/sync-look');
  for (const code of ['bad_format', 'local_elsewhere', 'local_missing', 'mode_fail', 'convert_failed', 'no_converter']) assert.ok(Look.PROBLEM_TEXT[code], code);
  for (const kind of ['moved_local', 'swap_rep', 'local_kept_new']) assert.ok(Look.syncBalloon({ kind, n: 1, names: ['a.docx'] }), kind);
  assert.equal(Look.syncBalloon({ kind: 'moved_local', n: 3 }).always, true);
  const c = Look.confirmLook({ kind: 'moved_local', count: 3, labels: ['연구실 PC'] });
  assert.equal(c.revert, '');
  assert.match(c.title, /다른 PC에만 두기로 한 파일 3개/);
  assert.match(c.body, /‘연구실 PC’에만/);
  assert.match(Look.syncBanner({ state: 'waiting_confirm', confirm: { kind: 'moved_local', count: 2 } }).title, /2개가 이 PC에 있어요/);
  assert.equal(Look.modeLine({ local: 3, pending_mode: 1 }), '이 PC에만: 3개 · 바꾸는 중: 1개');
  assert.equal(Look.modeLine({}), '');
  assert.ok(!/PDF 올리기/.test(JSON.stringify([Look.syncLook({ state: 'storage_full', reason: 'db' }), Look.syncBalloon({ kind: 'storage_full' })])));
});

// ---------------------------------------------------------------- 품질 검토 2차 (거절 이유 보존 · 서버 오류 결과 · mode.fail 다시 알림)
const jpg = (t) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(String(t))]);

test('서버 거절 400(convert_failed · no_converter · bad_format): 이유 그대로 문제 목록 · 약 24시간 대기, 6시간 동안 다시 올리지 않음 · 전체 다시 맞추기 0', async () => {
  for (const code of ['convert_failed', 'no_converter', 'bad_format']) {
    const env = setup({ protocol: 2 });
    env.api.fail[`${API}/files/add`] = { status: 400, code };
    env.writeBytes('보고서.docx', docx('본문'));
    const e = await env.connect(env.make());
    const adds = () => env.api.count(`${API}/files/add`);
    const snaps = env.api.count(`${API}/snapshot`);
    assert.equal(adds(), 1, code);
    const p = e.problems.find((x) => x.rel === '보고서.docx');
    assert.equal(p && p.code, code, '재시도(retrying)로 덮이지 않음');
    assert.ok(p.at - env.clock.t >= 23 * 3600e3, `${code}: 대기 ${(p.at - env.clock.t) / 3600e3}시간`);
    assert.equal(e.needFull, false, '형식 거절은 서버 상태 어긋남이 아님');
    await env.spin(e, 6, 3600e3);
    assert.equal(adds(), 1, `${code}: 6시간 동안 files/add 다시 0`);
    assert.ok(env.api.count(`${API}/snapshot`) - snaps <= 1, '시간마다 전체 다시 맞추지 않음(6시간 주기 한 번까지)');
    assert.ok(e.problems.some((x) => x.code === code && x.rel === '보고서.docx'));
    // 파일을 고치면(해시가 바뀜) 옛 이유는 사라지고 바로 다시 올림 · 지우면 문제 목록에서도 빠짐
    delete env.api.fail[`${API}/files/add`];
    env.writeBytes('보고서.docx', docx('고친 본문'));
    await env.spin(e, 2);
    assert.equal(adds(), 2);
    assert.ok(!e.problems.some((x) => x.rel === '보고서.docx'), JSON.stringify(e.problems));
  }
});

test('켜기(promote)가 400 no_converter 로 거절되면 같은 이유 · 24시간 대기(다시 올리지 않음)', async () => {
  const env = setup({ protocol: 2 });
  env.write('a.pdf', 'A');
  const e = await env.connect(env.make());
  const pid = Object.keys(e.J.files).map(Number)[0];
  env.api.webMode(pid, 'local', 7);
  await env.spin(e, 2);
  assert.equal(env.api.papers.get(pid).storage, 'local');
  env.api.fail[`${API}/files/${pid}/promote`] = { status: 400, code: 'no_converter' };
  env.api.webMode(pid, 'cloud');
  await env.spin(e, 2);
  const n = env.api.count(`${API}/files/${pid}/promote`);
  assert.equal(n, 1);
  assert.ok(e.problems.some((x) => x.code === 'no_converter' && x.rel === 'a.pdf'));
  await env.spin(e, 6, 3600e3);
  assert.equal(env.api.count(`${API}/files/${pid}/promote`), 1);
});

test('file.move 가 확장자 바꾸기로 bad_name → ext_change 문제 한 번(끝없는 재시도 없음), 원래 이름으로 되돌리면 사라짐', async () => {
  const env = setup({ protocol: 2 });
  env.writeBytes('사진.jpg', jpg('그림'));
  const e = await env.connect(env.make());
  const pid = Object.keys(e.J.files).map(Number)[0];
  fs.renameSync(path.join(env.root, '사진.jpg'), path.join(env.root, '사진.jpeg'));
  await env.spin(e, 2);
  assert.equal(env.api.opCount('file.move'), 1);
  assert.equal(env.api.papers.get(pid).file_name, '사진.jpg', '서버 이름 그대로');
  assert.ok(e.problems.some((x) => x.code === 'ext_change' && x.rel === '사진.jpeg'));
  assert.ok(!e.problems.some((x) => x.code === 'retrying'));
  await env.spin(e, 6, 3600e3);
  assert.equal(env.api.opCount('file.move'), 1, '같은 이름이면 다시 보내지 않음');
  fs.renameSync(path.join(env.root, '사진.jpeg'), path.join(env.root, '사진.jpg'));
  await env.spin(e, 2);
  assert.ok(!e.problems.some((x) => x.code === 'ext_change'));
  assert.equal(env.api.opCount('file.delete'), 0);
});

test('file.delete 가 not_holder(그 사이 다른 PC에만 두기로 바뀜 — 피드 전) → 저널만 지우고 다시 맞춤, 서재 항목 그대로 · 재시도 0', async () => {
  const env = setup({ protocol: 2 });
  env.api.device(9, '연구실 PC');
  env.write('b.pdf', 'B');
  const e = await env.connect(env.make());
  const pid = Object.keys(e.J.files).map(Number)[0];
  await e.pollFeed();
  Object.assign(env.api.papers.get(pid), { storage: 'local', holder: 9, kind: 'local' }); // 피드에 아직 안 올라옴
  assert.equal(e.S.papers.get(pid).storage, 'cloud');
  fs.unlinkSync(path.join(env.root, 'b.pdf'));
  await env.spin(e, 3);
  assert.equal(env.api.opCount('file.delete'), 1);
  assert.ok(!env.api.papers.get(pid).deleted_at, '서재 항목은 휴지통에 가지 않음');
  assert.equal(e.J.files[pid], undefined);
  assert.ok(!e.problems.some((x) => x.code === 'retrying'));
  assert.ok(!env.exists('b.pdf'), '로컬 항목은 받지 않음');
});

test('local_elsewhere: 서버가 준 보관 PC 이름(holder_name)을 문제 목록에 넣고 화면 문구에 보임', async () => {
  const env = setup({ protocol: 2 });
  env.api.device(9, '연구실 PC');
  const e = await env.connect(env.make());
  const bytes = pdf('E');
  const id = env.api.nextId++;
  env.api.papers.set(id, { id, folder_id: null, file_name: 'e.pdf', sha256: sha(bytes), size: bytes.length, deleted_at: null, kind: 'local', storage: 'local', holder: 9, pending: '' }); // 피드 전
  env.writeBytes('여기\e.pdf', bytes);
  await env.spin(e, 2);
  const p = e.problems.find((x) => x.code === 'local_elsewhere');
  assert.equal(p && p.label, '연구실 PC');
  const Look = require('../ui/sync-look');
  const g = Look.groupProblems(e.problems).find((x) => x.code === 'local_elsewhere');
  assert.match(g.text, /^‘연구실 PC’에만 두기로 한 파일/);
  assert.match(Look.groupProblems([{ code: 'local_elsewhere', rel: 'x.pdf' }])[0].text, /^다른 PC에만/);
});

test('mode.fail 기록: 취소하면 지우고, 취소 뒤 다시 요청(같은 이유)하면 서버에 다시 알림', async () => {
  const env = setup({ protocol: 2 });
  const e = await env.connect(env.make());
  const pid = env.api.add('CON.pdf', pdf('N')); // 이 PC에서 쓸 수 없는 이름 → 받을 수 없음(missing)
  env.api.webMode(pid, 'local', 7);
  await env.spin(e, 2);
  assert.equal(env.api.opCount('mode.fail'), 1);
  assert.equal(e.J.modeFails[pid], 'missing');
  assert.ok(e.problems.some((x) => x.code === 'mode_fail'));
  await env.spin(e, 2);
  assert.equal(env.api.opCount('mode.fail'), 1, '같은 이유는 한 번만');
  env.api.webMode(pid, 'cloud'); // 취소
  env.api.webMode(pid, 'local', 7); // 다시 요청 — 서버 mode_error 는 비었음
  await env.spin(e, 2);
  assert.equal(env.api.opCount('mode.fail'), 2, '다시 알림');
  assert.equal(env.api.papers.get(pid).mode_error, 'missing');
  env.api.webMode(pid, 'cloud');
  await env.spin(e, 2);
  assert.deepEqual(e.J.modeFails, {}, '대기가 끝나면 기록을 지움');
  assert.ok(!e.problems.some((x) => x.code === 'mode_fail'));
});

test('8.3 moved_local 은 L = J = S 일 때만: 보관 PC가 그 뒤 고친 판이면 이 PC 옛 사본은 지우지 않고 elsewhere_old 문제', async () => {
  const sp = { id: 1, file_name: 'a.pdf', sha256: 'h9', storage: 'local', holder: 9, kind: 'local' };
  const r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([{ rel: 'a.pdf', sha256: 'h1' }]), S([sp]));
  assert.deepEqual(ts(r), []);
  assert.deepEqual(r.problems.map((p) => p.code), ['elsewhere_old']);
  const env = setup({ protocol: 2 });
  env.api.device(9, '연구실 PC');
  env.write('b.pdf', 'B');
  const e = await env.connect(env.make());
  const pid = Object.keys(e.J.files).map(Number)[0];
  Object.assign(env.api.papers.get(pid), { storage: 'local', holder: 9, kind: 'local', sha256: sha(pdf('B 고침')) });
  env.api.bump('paper', pid);
  await env.spin(e, 3);
  assert.ok(env.exists('b.pdf'));
  assert.equal(env.trashed.length, 0);
  assert.ok(e.problems.some((x) => x.code === 'elsewhere_old' && x.rel === 'b.pdf'));
  const Look = require('../ui/sync-look');
  for (const code of ['elsewhere_old', 'ext_change']) assert.ok(Look.PROBLEM_TEXT[code], code);
});

test('보관 PC 이름(holder_name): moved_local 확인 창 · 알림 · elsewhere_old · local_* 문제에 ‘연구실 PC’, normPaper 가 보존, 모르면 "다른 PC"', async () => {
  // 순수 계획: label = sp.holder_name (모르면 trash_local 은 '' · 문제 항목은 label 없음)
  const sp = { id: 1, file_name: 'a.pdf', sha256: 'h1', storage: 'local', holder: 9, holder_name: '연구실 PC', kind: 'local' };
  let r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([{ rel: 'a.pdf', sha256: 'h1' }]), S([sp]));
  assert.deepEqual(r.acts.map((a) => [a.t, a.reason, a.label]), [['trash_local', 'moved_local', '연구실 PC']]);
  r = plan(J({ 1: jf('a.pdf', 'h1') }), Lf([{ rel: 'a.pdf', sha256: 'h1' }]), S([{ ...sp, holder_name: '' }]));
  assert.equal(r.acts[0].label, '');
  r = plan(J({ 1: jf('a.pdf', 'h0') }), Lf([{ rel: 'a.pdf', sha256: 'h0' }]), S([sp]));
  assert.deepEqual(r.problems, [{ code: 'elsewhere_old', rel: 'a.pdf', label: '연구실 PC' }]);
  r = plan(J(), Lf([{ rel: 'b.pdf', sha256: 'h1' }]), S([sp]));
  assert.deepEqual(r.problems, [{ code: 'local_elsewhere', rel: 'b.pdf', label: '연구실 PC' }]);
  r = plan(J(), Lf([]), S([{ ...sp, holder: 7, holder_name: '집 PC' }]));
  assert.deepEqual(r.problems, [{ code: 'local_missing', rel: 'a.pdf', label: '집 PC' }]);
  r = plan(J(), Lf([{ rel: 'b.pdf', sha256: 'h1' }]), S([{ ...sp, holder_name: '' }]));
  assert.deepEqual(r.problems, [{ code: 'local_elsewhere', rel: 'b.pdf' }]);

  // 화면 문구
  const Look = require('../ui/sync-look');
  assert.match(Look.groupProblems([{ code: 'elsewhere_old', rel: 'a.pdf', label: '연구실 PC' }])[0].text, /^‘연구실 PC’에만 두기로 한 파일의 옛 판/);
  assert.match(Look.groupProblems([{ code: 'elsewhere_old', rel: 'a.pdf' }])[0].text, /^다른 PC에만 두기로 한 파일의 옛 판/);
  assert.equal(Look.groupProblems([{ code: 'elsewhere_old', rel: 'a.pdf', label: '연구실 PC' }, { code: 'elsewhere_old', rel: 'b.pdf', label: '집 PC' }]).length, 2, '보관 PC가 다르면 따로 묶음');
  assert.match(Look.syncBalloon({ kind: 'moved_local', n: 3, label: '연구실 PC' }).title, /^‘연구실 PC’에만 두기로 한 파일 3개/);
  assert.match(Look.syncBalloon({ kind: 'moved_local', n: 3 }).title, /^다른 PC에만/);
  assert.match(Look.confirmLook({ kind: 'moved_local', count: 3, labels: ['연구실 PC', '집 PC'] }).body, /^다른 PC에만/, '보관 PC가 여럿이면 이름 없이');
  assert.match(Look.syncBanner({ state: 'waiting_confirm', confirm: { kind: 'moved_local', count: 2, labels: ['연구실 PC'] } }).title, /^‘연구실 PC’에만 두기로 한 파일 2개/);

  // 엔진: 가짜 서버(paperJson holder_name) → normPaper 보존 → 확인 창 labels · 알림 label
  const env = setup({ protocol: 2 });
  env.api.device(9, '연구실 PC');
  for (let i = 0; i < 12; i++) env.write(`g${i}.pdf`, `G${i}`);
  const e = await env.connect(env.make());
  for (const pid of Object.keys(e.J.files).map(Number)) { Object.assign(env.api.papers.get(pid), { storage: 'local', holder: 9, kind: 'local' }); env.api.bump('paper', pid); }
  await env.spin(e, 2);
  const pid0 = Object.keys(e.J.files).map(Number)[0];
  assert.equal(env.api.paperJson(env.api.papers.get(pid0)).holder_name, '연구실 PC');
  assert.equal(e.S.papers.get(pid0).holder_name, '연구실 PC');
  const snap = e.snapshot();
  assert.equal(snap.confirm.kind, 'moved_local');
  assert.deepEqual(snap.confirm.labels, ['연구실 PC']);
  assert.match(Look.confirmLook(snap.confirm).body, /^‘연구실 PC’에만 두기로 바꿔서/);
  const note = env.emitted.find((m) => m.type === 'notify' && m.kind === 'moved_local');
  assert.equal(note && note.label, '연구실 PC');
  assert.match(Look.syncBalloon(note).content, /^‘연구실 PC’에만 두기로 바꿔서/);
});
