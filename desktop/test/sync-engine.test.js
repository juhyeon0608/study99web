'use strict';
// 폴더 동기화 엔진 [Node] (명세 19장 65x · 66x · 67x · 68x): 실제 파일 시스템(임시 폴더) + 기록하는 가짜 API + 가짜 Windows 휴지통 + 주입 시계.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, sha, pdf } = require('./sync-harness');
const journal = require('../sync/journal');

const mutating = (api) => api.calls.filter((c) => !/\/(snapshot|changes|status|start|download|upload-slots)$/.test(c.path));

test('AC-673a 루트가 저장되지 않았으면 off — 아무 폴더도 읽거나 만들지 않고 서버 요청 0', async () => {
  const env = setup();
  const e = env.make({ settings: {} });
  await e.start();
  assert.equal(e.snapshot().state, 'off');
  assert.equal(env.api.calls.length, 0);
  assert.ok(!fs.existsSync(path.join(env.root, '.paperlab-sync')));
});

test('AC-673b 설치 ID 가 다르면 off + 전에 쓰던 폴더 안내, 옛 저널 · 루트 · 서버 0회 / 같은 설치 ID 면 이어서', async () => {
  const env = setup();
  const a = env.write('a.pdf', 'A');
  const e1 = await env.connect(env.make());
  assert.equal(Object.keys(e1.J.files).length, 1);
  e1.stop();
  fs.unlinkSync(a); // 저널에 있던 파일이 PC 에서 사라짐 — 옛 저널을 읽으면 삭제로 보일 상황
  env.api.calls.length = 0;
  const settings = { enabled: true, root: env.root, installId: 'I1' };
  const e2 = env.make({ installId: 'I2', settings });
  await e2.start();
  const s = e2.snapshot();
  assert.equal(s.state, 'off');
  assert.equal(s.previousRoot, env.root);
  assert.equal(env.api.calls.length, 0, '서버 sync/start · file.delete 0회');
  // 같은 설치 ID(자동 업데이트 모의) → 켜짐 · 저널 그대로 이어짐
  env.write('a.pdf', 'A');
  const e3 = env.make({ installId: 'I1', settings });
  await e3.start();
  await e3.cycle();
  assert.equal(e3.snapshot().state, 'idle');
  assert.equal(env.api.opCount('file.delete'), 0);
  assert.equal(Object.keys(e3.J.files).length, 1);
});

test('AC-671 첫 연결 미리보기: 연결 3 · 올리기 2 · 받기 4, [취소]는 변화 0, [시작] 뒤 서재 +2 · PC +4(중복 0)', async () => {
  const env = setup();
  for (const n of ['s1', 's2', 's3']) { env.write(`${n}.pdf`, n); env.api.add(`${n}.pdf`, pdf(n)); }
  env.write('new1.pdf', 'n1'); env.write('sub\\new2.pdf', 'n2');
  for (const n of ['r1', 'r2', 'r3', 'r4']) env.api.add(`${n}.pdf`, pdf(n));
  const before = env.tree();
  const e = env.make();
  await e.probe(env.root);
  const plan = e.snapshot().preview.plan;
  assert.deepEqual([plan.link, plan.upload, plan.download], [3, 2, 4]);
  assert.equal(plan.foldersLibrary, 1);
  assert.ok(!fs.existsSync(path.join(env.root, '.paperlab-sync')), '살펴보기는 읽기만');
  e.cancelPreview();
  assert.equal(e.snapshot().state, 'off');
  assert.deepEqual(env.tree(), before);
  assert.equal(mutating(env.api).length, 0);
  assert.ok(!env.emitted.some((m) => m.type === 'started'));
  await env.connect(e);
  await env.spin(e, 2);
  assert.equal(env.api.live().length, 9);
  assert.equal(new Set(env.api.live().map((p) => p.sha256)).size, 9, '중복 논문 0');
  assert.equal(env.tree().length, 9);
  assert.ok(env.emitted.some((m) => m.type === 'started'));
  assert.ok(env.emitted.some((m) => m.type === 'notify' && m.kind === 'first_done'));
});

test('AC-672 같은 해시 · 다른 위치: 다른 동기화 PC 없으면 서재 논문이 PC 위치로(file.move), 있으면 PC 파일이 서재 위치로', async () => {
  for (const other of [0, 1]) {
    const env = setup();
    const f = env.api.folder('서재폴더');
    env.api.add('x.pdf', pdf('x'), f);
    env.write('pc폴더\\x.pdf', 'x');
    env.api.otherDevices = other;
    const e = env.make();
    await e.probe(env.root);
    assert.equal(e.preview.place, other ? 'library' : 'local');
    assert.equal(e.snapshot().preview.plan.movedCount, 1);
    await env.connect(e, e.preview.place);
    await env.spin(e, 3);
    const p = env.api.live()[0];
    if (other) { assert.ok(env.exists('서재폴더\\x.pdf')); assert.equal(env.api.opCount('file.move'), 0); } else {
      assert.equal(env.api.folders.get(p.folder_id).name, 'pc폴더');
      assert.ok(env.exists('pc폴더\\x.pdf'));
      assert.equal(env.api.opCount('file.move'), 1);
    }
    assert.equal(env.api.count('/api/worker/sync/upload-slots'), 0);
  }
});

test('AC-675 · 677 · 679 미리보기 막힘: 디스크 · 저장 공간 · 내 한도 · 데이터베이스 — [시작] 거절, 변화 0', async () => {
  const env = setup();
  env.api.add('r.pdf', pdf('r'.repeat(1000)));
  env.write('u.pdf', 'u'.repeat(5000));
  env.free = 1024 ** 3; // 받을 것 + 1GB 보다 적음
  env.api.budget = { upload_budget_bytes: 10, upload_budget_limit: 'user', user_cap_bytes: 2 * 1024 ** 3, trash_bytes: 5 };
  env.api.db = { size_bytes: 400e6, limit_bytes: 500e6, budget_bytes: 1000, per_paper_bytes: 262144, first_alloc_bytes: 55e6 };
  const e = env.make();
  await e.probe(env.root);
  const kinds = e.snapshot().preview.plan.blocks.map((b) => b.kind);
  assert.deepEqual(kinds, ['disk', 'user', 'db']);
  const r = await e.confirmStart('local');
  assert.equal(r.ok, false);
  assert.equal(mutating(env.api).length, 0);
  assert.ok(!fs.existsSync(path.join(env.root, '.paperlab-sync')));
});

test('AC-662 이동 판별: 파일 옮김 → file.move 1 · 올리기 0, 폴더 이름 바꿈(안에 5개) → folder.update 1 · file.move 0, 복사 후 원본 삭제 → file.move 1', async () => {
  const env = setup();
  for (let i = 0; i < 5; i++) env.write(`A\\f${i}.pdf`, `f${i}`);
  env.write('x.pdf', 'x');
  env.write('y.pdf', 'y');
  fs.mkdirSync(path.join(env.root, 'B'));
  const e = await env.connect(env.make());
  await env.spin(e, 2);
  const slots0 = env.api.count('/api/worker/sync/upload-slots');
  fs.renameSync(path.join(env.root, 'x.pdf'), path.join(env.root, 'B', 'x.pdf'));
  await env.spin(e, 2);
  assert.equal(env.api.opCount('file.move'), 1);
  fs.renameSync(path.join(env.root, 'A'), path.join(env.root, 'A2'));
  await env.spin(e, 3);
  assert.equal(env.api.opCount('folder.update'), 1);
  assert.equal(env.api.opCount('file.move'), 1);
  assert.equal([...env.api.folders.values()].find((f) => f.name === 'A2') != null, true);
  fs.copyFileSync(path.join(env.root, 'y.pdf'), path.join(env.root, 'B', 'y.pdf'));
  fs.unlinkSync(path.join(env.root, 'y.pdf'));
  await env.spin(e, 3);
  assert.equal(env.api.opCount('file.move'), 2);
  assert.equal(env.api.opCount('file.delete'), 0);
  assert.equal(env.api.count('/api/worker/sync/upload-slots'), slots0, '올리기 0');
});

test('AC-651 대량 삭제(PC → 서재): 30개 중 10개 → file.delete 0 · waiting_confirm, 나중에 → 0 · 1시간 뒤 다시 알림, 계속 → 10회', async () => {
  const env = setup();
  for (let i = 0; i < 30; i++) env.write(`p${i}.pdf`, `p${i}`);
  const e = await env.connect(env.make());
  await env.spin(e, 2);
  for (let i = 0; i < 10; i++) fs.unlinkSync(path.join(env.root, `p${i}.pdf`));
  await env.spin(e, 2);
  assert.equal(env.api.opCount('file.delete'), 0);
  const s = e.snapshot();
  assert.equal(s.state, 'waiting_confirm');
  assert.equal(s.confirm.kind, 'local_delete');
  assert.equal(s.confirm.count, 10);
  const asked = env.emitted.filter((m) => m.type === 'notify' && m.kind === 'local_delete').length;
  await e.confirm(s.confirm.batch_id, 'later');
  await env.spin(e, 2);
  assert.equal(env.api.opCount('file.delete'), 0);
  assert.equal(e.snapshot().state, 'waiting_confirm');
  env.clock.t += 3600e3 + 1;
  await e.cycle();
  assert.equal(env.emitted.filter((m) => m.type === 'notify' && m.kind === 'local_delete').length, asked + 1);
  await e.confirm(e.snapshot().confirm.batch_id, 'continue');
  await env.spin(e, 2);
  assert.equal(env.api.opCount('file.delete'), 10);
  assert.equal(env.api.live().length, 20);
  assert.equal(e.snapshot().state, 'idle');
});

test('AC-651 [되돌리기] → 다시 받아짐(해시 같음) · [동기화 끄기] → 서재 그대로 · off · 9개는 바로 / 20개 중 2개 바로 · 3개 멈춤', async () => {
  const env = setup();
  for (let i = 0; i < 30; i++) env.write(`d\\p${i}.pdf`, `p${i}`);
  const e = await env.connect(env.make());
  await env.spin(e, 2);
  for (let i = 0; i < 12; i++) fs.unlinkSync(path.join(env.root, 'd', `p${i}.pdf`));
  await env.spin(e, 2);
  await e.confirm(e.snapshot().confirm.batch_id, 'revert');
  await env.spin(e, 3);
  assert.equal(env.tree().length, 30);
  assert.equal(env.read('d\\p3.pdf').toString(), pdf('p3').toString());
  assert.equal(env.api.opCount('file.delete'), 0);
  for (let i = 0; i < 12; i++) fs.unlinkSync(path.join(env.root, 'd', `p${i}.pdf`));
  await env.spin(e, 2);
  await e.confirm(e.snapshot().confirm.batch_id, 'off');
  assert.equal(e.snapshot().state, 'off');
  assert.equal(env.api.opCount('file.delete'), 0);
  assert.equal(env.api.live().length, 30);
  assert.ok(env.emitted.some((m) => m.type === 'turned-off'));

  const env2 = setup();
  for (let i = 0; i < 100; i++) env2.write(`p${i}.pdf`, `q${i}`);
  const e2 = await env2.connect(env2.make());
  await env2.spin(e2, 1);
  for (let i = 0; i < 9; i++) fs.unlinkSync(path.join(env2.root, `p${i}.pdf`));
  await env2.spin(e2, 1);
  assert.equal(env2.api.opCount('file.delete'), 9);

  const env3 = setup();
  for (let i = 0; i < 20; i++) env3.write(`p${i}.pdf`, `r${i}`);
  const e3 = await env3.connect(env3.make());
  await env3.spin(e3, 1);
  fs.unlinkSync(path.join(env3.root, 'p0.pdf')); fs.unlinkSync(path.join(env3.root, 'p1.pdf'));
  await env3.spin(e3, 1);
  assert.equal(env3.api.opCount('file.delete'), 2);
  env3.clock.t += 60e3; // 30초 창 밖
  for (let i = 2; i < 5; i++) fs.unlinkSync(path.join(env3.root, `p${i}.pdf`));
  await env3.spin(e3, 1);
  assert.equal(env3.api.opCount('file.delete'), 2);
  assert.equal(e3.snapshot().state, 'waiting_confirm');
});

test('AC-652 대량 삭제(서재 → PC): 휴지통 10개 → 이동 0 · 지운 곳 표시, 계속 → 가짜 휴지통 10, 서재에 되살리기 → files/add restored · PC 그대로', async () => {
  for (const choice of ['continue', 'revert', 'later']) {
    const env = setup();
    for (let i = 0; i < 12; i++) env.write(`p${i}.pdf`, `p${i}`);
    const e = await env.connect(env.make());
    await env.spin(e, 2);
    const ids = env.api.live().slice(0, 10).map((p) => p.id);
    for (const id of ids) env.api.webTrash(id, '연구실 PC');
    await env.spin(e, 2);
    assert.equal(env.trashed.length, 0);
    const s = e.snapshot();
    assert.equal(s.confirm.kind, 'remote_delete');
    assert.deepEqual(s.confirm.labels, ['연구실 PC']);
    await e.confirm(s.confirm.batch_id, choice);
    await env.spin(e, 2);
    if (choice === 'continue') { assert.equal(env.trashed.length, 10); assert.equal(env.tree().length, 2); }
    if (choice === 'revert') {
      assert.equal(env.trashed.length, 0);
      assert.equal(env.api.count('/api/worker/sync/files/add') - 12 >= 10, true);
      assert.equal(env.api.live().length, 12);
      assert.equal(env.tree().length, 12);
    }
    if (choice === 'later') { assert.equal(env.trashed.length, 0); assert.equal(e.snapshot().state, 'waiting_confirm'); }
  }
});

test('AC-653 루트 이름 바꾸기 · 표식 삭제 → root_missing, 서버 삭제 0 / 되돌리면 다시 idle', async () => {
  const env = setup();
  for (let i = 0; i < 4; i++) env.write(`p${i}.pdf`, `p${i}`);
  const e = await env.connect(env.make());
  await env.spin(e, 1);
  fs.renameSync(env.root, `${env.root}-옮김`);
  env.clock.t += 31e3;
  await e.cycle();
  assert.equal(e.snapshot().state, 'root_missing');
  assert.ok(env.emitted.some((m) => m.type === 'notify' && m.kind === 'root_missing'));
  fs.renameSync(`${env.root}-옮김`, env.root);
  env.clock.t += 31e3;
  await e.cycle();
  await env.spin(e, 1);
  assert.equal(e.snapshot().state, 'idle');
  const marker = path.join(env.root, '.paperlab-sync', 'root.json');
  const saved = fs.readFileSync(marker);
  fs.writeFileSync(marker, JSON.stringify({ root_id: 'other', device_id: 7 }));
  env.clock.t += 31e3;
  await e.cycle();
  assert.equal(e.snapshot().state, 'root_missing');
  assert.equal(e.snapshot().rootIssue, 'marker');
  fs.writeFileSync(marker, saved);
  assert.equal(env.api.opCount('file.delete'), 0);
});

test('AC-654 서버가 위험한 이름을 주면 루트 밖에 아무것도 안 생기고 문제 목록에', async () => {
  const env = setup();
  env.api.add('..\\x.pdf', pdf('a'));
  env.api.add('a\\b.pdf', pdf('b'));
  env.api.add('C:x.pdf', pdf('c'));
  env.api.add('CON.pdf', pdf('d'));
  const bad = env.api.folder('..');
  env.api.add('ok.pdf', pdf('e'), bad);
  env.api.folder('a/b');
  const e = await env.connect(env.make());
  await env.spin(e, 2);
  assert.deepEqual(env.tree(), []);
  assert.deepEqual(fs.readdirSync(path.dirname(env.root)).filter((n) => n !== 'AppData'), ['논문 폴더']);
  assert.ok(e.snapshot().problems.filter((p) => p.code === 'bad_name_server').length >= 4);
});

test('AC-658 휴지통 실패(그 밖 오류) → 보관함으로 옮김 + 알림, 영구 삭제 0 / AC-658a 잠김 → 그대로 · 재시도 · 문제 목록, 해석 실패 → 문제 목록', async () => {
  const env = setup();
  for (let i = 0; i < 40; i++) env.write(`p${i}.pdf`, `p${i}`);
  const e = await env.connect(env.make());
  await env.spin(e, 1);
  const [a, b, c] = env.api.live();
  env.trashOverride = async (abs) => (/p0\.pdf$/.test(abs) ? { ok: false, reason: 'other' } : /p1\.pdf$/.test(abs) ? { ok: false, reason: 'locked' } : { ok: false, reason: 'parse_failed' });
  for (const p of [a, b, c]) env.api.webTrash(p.id);
  await env.spin(e, 1);
  const names = Object.fromEntries([a, b, c].map((p) => [p.file_name, env.exists(p.file_name)]));
  const archived = Object.entries(names).filter(([, there]) => !there).map(([n]) => n);
  assert.equal(archived.length, 1);
  const day = fs.readdirSync(path.join(env.root, '.paperlab-sync', '보관함'));
  assert.ok(fs.existsSync(path.join(env.root, '.paperlab-sync', '보관함', day[0], archived[0])));
  assert.ok(env.emitted.some((m) => m.type === 'notify' && m.kind === 'archived'));
  const codes = e.snapshot().problems.map((p) => p.code);
  assert.ok(codes.includes('trash_locked') && codes.includes('trash_parse_failed'));
  env.trashOverride = null; // 풀림 → 다음 시도(1분 뒤)에서 휴지통으로
  env.clock.t += 61e3;
  await e.cycle();
  assert.equal(env.trashed.length, 1);
  assert.ok(e.snapshot().archiveBytes > 0);
});

test('AC-664 · 667 · 668 받기: 메아리 0, 해시가 다르면 넣지 않음, 내용 교체 때 옛 파일이 휴지통 먼저', async () => {
  const env = setup();
  const id = env.api.add('a.pdf', pdf('v1'));
  const id2 = env.api.add('b.pdf', pdf('b1'));
  env.api.corrupt = new Set([`users/${env.api.uid}/papers/${id2}.pdf`]);
  const e = await env.connect(env.make());
  await env.spin(e, 2);
  assert.ok(env.exists('a.pdf'));
  assert.ok(!env.exists('b.pdf'), '해시 불일치 파일은 루트에 없음');
  assert.deepEqual(fs.readdirSync(path.join(env.root, '.paperlab-sync', 'tmp')), [], '반쪽 파일 없음');
  env.api.corrupt = null;
  env.clock.t += 5e3;
  await env.spin(e, 2);
  assert.ok(env.exists('b.pdf'));
  const slots = env.api.count('/api/worker/sync/upload-slots');
  await env.spin(e, 3);
  assert.equal(env.api.count('/api/worker/sync/upload-slots'), slots, '메아리 0');
  assert.equal(env.api.opCount('file.move'), 0);
  env.api.webReplace(id, pdf('v2'));
  await env.spin(e, 2);
  assert.equal(env.read('a.pdf').toString(), pdf('v2').toString());
  assert.equal(env.trashed.length, 1);
  assert.equal(fs.readFileSync(env.trashed[0].dest).toString(), pdf('v1').toString());
});

test('AC-669 제외: .docx · 숨김 · ~$ · .tmp · %PDF 아님 · 0바이트 → 올리지 않고(비PDF 는 손대지 않음) PDF 는 문제 목록에', async () => {
  const env = setup();
  fs.writeFileSync(path.join(env.root, 'note.docx'), 'x');
  env.write('~$a.pdf', 'x'); env.write('a.tmp', 'x'); env.write('hid.pdf', 'h');
  fs.writeFileSync(path.join(env.root, 'fake.pdf'), 'not a pdf');
  fs.writeFileSync(path.join(env.root, 'zero.pdf'), '');
  env.write('ok.pdf', 'ok');
  env.attrs = (p) => (/hid\.pdf$/.test(p) ? 34 : 32);
  const e = await env.connect(env.make());
  await env.spin(e, 2);
  assert.equal(env.api.live().length, 1);
  const codes = new Set(e.snapshot().problems.map((p) => p.code));
  for (const c of ['temp_name', 'hidden', 'not_pdf', 'empty_file']) assert.ok(codes.has(c), c);
  assert.ok(fs.existsSync(path.join(env.root, 'note.docx')));
});

test('AC-669a 클라우드 전용 자리 표시자(0x400000 · 0x1000)는 해시 · 열기 없이 건너뜀', async () => {
  const env = setup();
  env.write('cloud.pdf', 'c'); env.write('off.pdf', 'o');
  env.attrs = (p) => (/cloud\.pdf$/.test(p) ? 0x400000 | 32 : /off\.pdf$/.test(p) ? 0x1000 : 32);
  const e = await env.connect(env.make());
  await env.spin(e, 1);
  assert.equal(env.api.live().length, 0);
  assert.equal(e.snapshot().problems.filter((p) => p.code === 'cloud_only').length, 2);
});

test('AC-661 쓰는 중 대기: 크기가 바뀌는 동안 올리지 않고 2초 간격 두 번 같으면 1회', async () => {
  const env = setup({ timing: { stableChecks: 2, stableMs: 2000 } });
  const e = await env.connect(env.make());
  const p = path.join(env.root, 'big.pdf');
  fs.writeFileSync(p, pdf('start'));
  for (let i = 0; i < 5; i++) { fs.appendFileSync(p, `more ${i}\n`); env.clock.t += 500; e.dirty = true; await e.cycle(); }
  assert.equal(env.api.count('/api/worker/sync/files/add'), 0);
  for (let i = 0; i < 4; i++) { env.clock.t += 2100; e.dirty = true; await e.cycle(); }
  assert.equal(env.api.count('/api/worker/sync/files/add'), 1);
  fs.writeFileSync(path.join(env.root, 'x.pdf.crdownload'), pdf('x'));
  await env.spin(e, 3, 2100);
  fs.renameSync(path.join(env.root, 'x.pdf.crdownload'), path.join(env.root, 'x.pdf'));
  await env.spin(e, 4, 2100);
  assert.equal(env.api.count('/api/worker/sync/files/add'), 2);
});

test('AC-663 꺼져 있던 동안의 변경: 추가 2 · 수정 1 · 이동 1 · 이름 1 · 삭제 1 → 다시 시작 후 각각 한 번', async () => {
  const env = setup();
  for (const n of ['m', 'r', 'd', 'c']) env.write(`${n}.pdf`, n);
  fs.mkdirSync(path.join(env.root, 'sub'));
  const settings = { enabled: true, installId: 'I1', root: env.root };
  const e = await env.connect(env.make());
  await env.spin(e, 1);
  e.stop();
  env.write('n1.pdf', 'n1'); env.write('n2.pdf', 'n2');
  fs.writeFileSync(path.join(env.root, 'c.pdf'), pdf('c-changed'));
  fs.renameSync(path.join(env.root, 'm.pdf'), path.join(env.root, 'sub', 'm.pdf'));
  fs.renameSync(path.join(env.root, 'r.pdf'), path.join(env.root, 'r2.pdf'));
  fs.unlinkSync(path.join(env.root, 'd.pdf'));
  env.api.calls.length = 0;
  const e2 = env.make({ settings });
  await e2.start();
  await env.spin(e2, 3);
  assert.equal(env.api.count('/api/worker/sync/files/add'), 2);
  assert.equal(env.api.calls.filter((c) => /\/content$/.test(c.path)).length, 1);
  assert.equal(env.api.opCount('file.move'), 2);
  assert.equal(env.api.opCount('file.delete'), 1);
});

test('AC-682 대소문자만 바꾼 이름: PC → file.move 1, 서버에서 바뀌면 PC 실제 이름이 바뀜', async () => {
  const env = setup();
  env.write('a.pdf', 'a');
  env.write('b.pdf', 'b');
  const e = await env.connect(env.make());
  await env.spin(e, 1);
  fs.renameSync(path.join(env.root, 'a.pdf'), path.join(env.root, 'A.pdf'));
  await env.spin(e, 2);
  assert.equal(env.api.opCount('file.move'), 1);
  assert.equal(env.api.live().find((p) => p.file_name.toLowerCase() === 'a.pdf').file_name, 'A.pdf');
  const b = env.api.live().find((p) => p.file_name === 'b.pdf');
  env.api.webMove(b.id, null, 'B.pdf');
  await env.spin(e, 2);
  assert.ok(fs.readdirSync(env.root).includes('B.pdf'));
  assert.equal(env.api.opCount('file.move'), 1);
});

test('AC-684 NFD 이름: 서버 file_name 은 NFC, PC 이름 그대로, 다시 검사해도 반복 0', async () => {
  const env = setup();
  const nfd = '한글논문.pdf'.normalize('NFD');
  fs.writeFileSync(path.join(env.root, nfd), pdf('k'));
  const e = await env.connect(env.make());
  await env.spin(e, 3);
  const p = env.api.live()[0];
  assert.equal(p.file_name, '한글논문.pdf'.normalize('NFC'));
  assert.ok(fs.readdirSync(env.root).includes(nfd));
  const n = env.api.calls.length;
  await env.spin(e, 3);
  assert.equal(mutating(env.api).length, env.api.calls.filter((c) => !/\/(snapshot|changes|status|start|download|upload-slots)$/.test(c.path)).length);
  assert.equal(env.api.opCount('file.move'), 0);
  assert.equal(env.api.calls.slice(n).filter((c) => !/\/(changes|status)$/.test(c.path)).length, 0);
});

test('AC-685 전체 경로 250자를 넘을 서버 파일은 만들지 않고 문제 목록, 서재에는 남음', async () => {
  const env = setup();
  const long = `${'가'.repeat(190)}.pdf`;
  env.api.add(long, pdf('L'), env.api.folder('나'.repeat(90)));
  const e = await env.connect(env.make());
  await env.spin(e, 2);
  assert.deepEqual(env.tree(), []);
  assert.ok(e.snapshot().problems.some((p) => p.code === 'too_long_down'));
  assert.equal(env.api.live().length, 1);
});

test('AC-639 translation_cleared → 알림 1회(파일 이름), false 면 0회, 로그에 파일 이름 없음', async () => {
  const env = setup();
  env.write('번역된 논문.pdf', 'v1');
  env.write('번역없음.pdf', 'w1');
  const { Logger } = require('../lib/log');
  const logFile = path.join(env.home, 'sync.log');
  const e = await env.connect(env.make({ log: new Logger(logFile) }));
  await env.spin(e, 1);
  const p = env.api.live().find((x) => x.file_name === '번역된 논문.pdf');
  env.api.translated.add(p.id);
  env.clock.t += 5000;
  fs.writeFileSync(path.join(env.root, '번역된 논문.pdf'), pdf('v2'));
  fs.writeFileSync(path.join(env.root, '번역없음.pdf'), pdf('w2'));
  await env.spin(e, 2);
  const notes = env.emitted.filter((m) => m.type === 'notify' && m.kind === 'translation_cleared');
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0].names, ['번역된 논문.pdf']);
  const log = fs.readFileSync(logFile, 'utf8');
  assert.ok(!/번역|\.pdf|논문 폴더/.test(log), log);
  assert.ok(!log.includes(sha(pdf('v2'))));
});

test('충돌(U-1) 서버가 이김 → PC 파일은 사본 이름으로, 원래 이름에는 서버 내용을 받음 · 알림', async () => {
  const env = setup();
  env.write('p.pdf', 'base');
  const e = await env.connect(env.make());
  await env.spin(e, 1);
  const id = env.api.live()[0].id;
  env.api.webReplace(id, pdf('web'));
  fs.writeFileSync(path.join(env.root, 'p.pdf'), pdf('local'));
  env.api.winner = 'server';
  env.clock.t += 5000;
  await e.cycle(); // 피드보다 PC 검사가 먼저 오도록 같은 바퀴에서 둘 다 바뀐 상황
  await env.spin(e, 3);
  const files = env.tree();
  assert.equal(files.length, 2);
  assert.equal(env.read('p.pdf').toString(), pdf('web').toString());
  const copy = files.find((f) => f.includes('충돌 사본'));
  assert.equal(env.read(copy).toString(), pdf('local').toString());
  assert.ok(env.emitted.some((m) => m.type === 'notify' && m.kind === 'conflict'));
});

test('AC-677 올리기 한도(sync_quota) → storage_full + 이유, 받기는 계속', async () => {
  const env = setup();
  const e = await env.connect(env.make());
  env.api.quota = 'sync_quota';
  env.write('new.pdf', 'n');
  env.api.add('srv.pdf', pdf('s'));
  await env.spin(e, 2);
  const s = e.snapshot();
  assert.equal(s.state, 'storage_full');
  assert.equal(s.reason, 'sync_quota');
  assert.ok(env.exists('srv.pdf'));
  const st = env.api.calls.filter((c) => c.path.endsWith('/status')).pop();
  assert.equal(st.body.counts.reason, 'sync_quota');
});

test('AC-674 저널 user_id 와 토큰 uid 가 다르면 account_mismatch, 파일 변화 0', async () => {
  const env = setup();
  env.write('a.pdf', 'a');
  const e = await env.connect(env.make());
  e.stop();
  const j = journal.load(env.journalFile);
  j.user_id = '99999999-2222-3333-4444-555555555555';
  journal.save(env.journalFile, j);
  fs.unlinkSync(path.join(env.root, 'a.pdf'));
  env.api.calls.length = 0;
  const e2 = env.make({ settings: { enabled: true, installId: 'I1', root: env.root } });
  await e2.start();
  await e2.cycle();
  assert.equal(e2.snapshot().state, 'account_mismatch');
  assert.equal(mutating(env.api).length, 0);
});

test('AC-658b 루트 드라이브가 고정 디스크가 아니면 시작하지 않음(살펴보기 거부 · 켜진 루트는 멈춤)', async () => {
  const env = setup();
  env.drive = 'Removable';
  const e = env.make();
  await e.probe(env.root);
  assert.equal(e.snapshot().state, 'off');
  assert.equal(e.pickError, 'not_fixed');
  env.drive = 'Fixed';
  await env.connect(e);
  e.stop();
  env.drive = 'Network';
  const e2 = env.make({ settings: { enabled: true, installId: 'I1', root: env.root } });
  await e2.start();
  await e2.cycle();
  assert.equal(e2.snapshot().state, 'root_missing');
  assert.equal(e2.snapshot().rootIssue, 'drive');
});

test('웹에서 폴더 이름 바꾸기 → 디렉터리 이름이 바뀌고 file.move 0, 웹 폴더 삭제 → 파일이 부모로 · 빈 디렉터리만 지움 (AC-6M4)', async () => {
  const env = setup();
  const f = env.api.folder('인공지능');
  env.api.add('a.pdf', pdf('a'), f);
  env.api.add('b.pdf', pdf('b'), f);
  const e = await env.connect(env.make());
  await env.spin(e, 2);
  assert.deepEqual(env.tree(), ['인공지능\\a.pdf', '인공지능\\b.pdf']);
  env.api.webRenameFolder(f, 'AI');
  await env.spin(e, 2);
  assert.deepEqual(env.tree(), ['AI\\a.pdf', 'AI\\b.pdf']);
  assert.equal(env.api.opCount('file.move'), 0);
  assert.equal(env.api.opCount('folder.update'), 0);
  fs.writeFileSync(path.join(env.root, 'AI', 'memo.txt'), 'x');
  env.api.webDeleteFolder(f);
  await env.spin(e, 3);
  assert.deepEqual(env.tree(), ['AI\\memo.txt', 'a.pdf', 'b.pdf']);
  assert.ok(e.snapshot().problems.some((p) => p.code === 'folder_kept'));
  assert.equal(env.api.opCount('folder.create'), 0, '남긴 디렉터리를 다시 서재 폴더로 만들지 않음');
});

test('AC-665 한꺼번에 30개 → 동시 올리기 2 이하 · 모두 반영 · ops 요청 하나에 20개 이하', async () => {
  const env = setup();
  const e = await env.connect(env.make());
  let inflight = 0;
  let peak = 0;
  const base = e.transfer.put;
  e.transfer.put = async (...a) => { inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, 5)); try { return await base(...a); } finally { inflight--; } };
  for (let i = 0; i < 30; i++) env.write(`batch\\f${i}.pdf`, `b${i}`);
  await env.spin(e, 3);
  assert.equal(env.api.live().length, 30);
  assert.ok(peak <= 2 && peak >= 1, `peak ${peak}`);
  fs.mkdirSync(path.join(env.root, 'moved'));
  await env.spin(e, 1);
  for (let i = 0; i < 25; i++) fs.renameSync(path.join(env.root, 'batch', `f${i}.pdf`), path.join(env.root, 'moved', `f${i}.pdf`));
  await env.spin(e, 2);
  assert.equal(env.api.opCount('file.move'), 25);
  for (const c of env.api.calls.filter((x) => x.path.endsWith('/ops'))) assert.ok(c.body.ops.length <= 20);
});

test('루트 이상(12.3): 연결 파일 절반 이상이 한 번에 사라지면 root_anomaly 확인 창 · 서버 삭제 0', async () => {
  const env = setup();
  for (let i = 0; i < 12; i++) env.write(`p${i}.pdf`, `p${i}`);
  const e = await env.connect(env.make());
  await env.spin(e, 1);
  for (let i = 0; i < 7; i++) fs.unlinkSync(path.join(env.root, `p${i}.pdf`));
  await env.spin(e, 1);
  assert.equal(e.snapshot().confirm.kind, 'root_anomaly');
  assert.equal(env.api.opCount('file.delete'), 0);
});

test('AC-686 읽기 전용 파일: 서버에서 옮기면 옮겨지고, 교체 · 휴지통 보내기는 건너뛰어 문제 목록', async () => {
  const env = setup();
  env.write('ro.pdf', 'r1');
  const e = await env.connect(env.make());
  await env.spin(e, 1);
  env.attrs = () => 33; // 읽기 전용 + 보관
  const id = env.api.live()[0].id;
  const f = env.api.folder('다른곳');
  env.api.webMove(id, f);
  await env.spin(e, 2);
  assert.ok(env.exists('다른곳\\ro.pdf'));
  env.api.webReplace(id, pdf('r2'));
  await env.spin(e, 2);
  assert.equal(env.read('다른곳\\ro.pdf').toString(), pdf('r1').toString());
  assert.equal(env.trashed.length, 0);
  assert.ok(e.snapshot().problems.some((p) => p.code === 'read_only'));
});

test('충돌(U-1) 들어온 쪽이 이김 → PC 파일 그대로 원래 이름, 옛 서버 내용은 사본으로 받음', async () => {
  const env = setup();
  env.write('p.pdf', 'base');
  const e = await env.connect(env.make());
  await env.spin(e, 1);
  env.api.webReplace(env.api.live()[0].id, pdf('web'));
  fs.writeFileSync(path.join(env.root, 'p.pdf'), pdf('local'));
  env.clock.t += 5000;
  e.dirty = true;
  await e.cycle();
  await env.spin(e, 3);
  assert.equal(env.read('p.pdf').toString(), pdf('local').toString());
  const copy = env.tree().find((x) => x.includes('충돌 사본'));
  assert.equal(env.read(copy).toString(), pdf('web').toString());
  assert.equal(env.api.live().length, 2);
});

test('실제 루프 + fs.watch: 감시 힌트 → 묶기 → 올리기, 서버 변경 → 받기, stop 으로 끝남', async () => {
  const { watchRoot } = require('../sync/watcher');
  const { waitFor } = require('./helpers');
  const env = setup({ timing: { debounceMs: 100, stableChecks: 1, stableMs: 150, pollMs: 200 } });
  const e = env.make({ autoLoop: true, watch: watchRoot, now: Date.now });
  await e.probe(env.root);
  await e.confirmStart('local');
  env.write('live.pdf', 'live');
  assert.ok(await waitFor(() => env.api.live().length === 1, 8000), '올리기');
  env.api.add('from-web.pdf', pdf('w'));
  e.nudge();
  assert.ok(await waitFor(() => env.exists('from-web.pdf'), 8000), '받기');
  e.stop();
  assert.ok(await waitFor(() => !e.loopRunning, 3000));
});

// C2(승인 조건): 저널에 있던 파일이 PC 에 남았는데 "제외 · 건너뜀"으로 바뀌면 사라짐이 아니라 보류 — file.delete 0 (12.1-3)
for (const [label, change] of [
  ['0바이트로 잘림', (env) => fs.writeFileSync(path.join(env.root, 'a.pdf'), '')],
  ['이름 200자 초과로 바꿈', (env) => fs.renameSync(path.join(env.root, 'a.pdf'), path.join(env.root, `${'x'.repeat(201)}.pdf`))],
  ['폴더 이름 100자 초과로 바꿈', (env) => fs.renameSync(path.join(env.root, 'D'), path.join(env.root, 'y'.repeat(101)))],
  ['임시 이름으로 바꿈', (env) => fs.renameSync(path.join(env.root, 'a.pdf'), path.join(env.root, '~$a.pdf'))],
  ['폴더를 정션으로 바꿔치기', (env) => { fs.renameSync(path.join(env.root, 'D'), path.join(env.home, 'D-밖')); fs.symlinkSync(path.join(env.home, 'D-밖'), path.join(env.root, 'D'), 'junction'); }],
  ['클라우드 전용 자리 표시자로 바뀜', (env) => { fs.writeFileSync(path.join(env.root, 'a.pdf'), pdf('A2')); env.attrs = (p) => (/a\.pdf$/.test(p) ? 0x400000 : 32); }],
  ['다른 프로그램이 잠금(속성 못 읽음)', (env) => { fs.writeFileSync(path.join(env.root, 'a.pdf'), pdf('A3')); env.attrs = (p) => (/a\.pdf$/.test(p) ? -1 : 32); }],
]) {
  test(`C2 제외로 바뀐 저널 파일은 보류: ${label} → file.delete 0 · 서재 그대로`, async () => {
    const env = setup();
    env.write('a.pdf', 'A');
    env.write(path.join('D', 'b.pdf'), 'B');
    const e = await env.connect(env.make());
    await env.spin(e, 2);
    assert.equal(env.api.live().length, 2);
    change(env);
    await env.spin(e, 3);
    assert.equal(env.api.opCount('file.delete'), 0);
    assert.equal(env.api.opCount('folder.delete'), 0);
    assert.equal(env.api.live().length, 2);
    assert.ok(e.snapshot().problems.length >= 1);
    assert.notEqual(e.snapshot().state, 'waiting_confirm');
  });
}
