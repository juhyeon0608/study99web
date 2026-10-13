'use strict';
// 폴더 동기화 순수 부분 [Node] (명세 19장): 이름 규칙(AC-681) · 세 갈래 비교 표(6.4 · 6.5) · 서명 주소 검사(AC-655) · 루트 거부(AC-673) ·
// 문구(AC-693) · 코드 검사(AC-659 · 658b) · main 휴지통 보내기 검사 · 저널 · 설정
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../sync/paths');
const R = require('../sync/reconcile');
const { checkUrl } = require('../sync/transfer');
const { rootProblem, checkRoot, within } = require('../sync/rootcheck');
const Look = require('../ui/sync-look');
const journal = require('../sync/journal');
const { trashInRoot } = require('../main/sync-host');
const { normalizeSync } = require('../main/store');
const { tempHome } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const UID = '11111111-2222-3333-4444-555555555555';

test('AC-681 이름 규칙: 예약 이름 · 끝 점/공백 · 금지 문자 · 제어 문자 · 201자 거부, 점으로 시작은 제외 목록', () => {
  for (const bad of ['CON', 'con.pdf', 'NUL.tar.pdf', 'COM¹.pdf', 'LPT9.PDF', 'a.', 'a ', 'a:b', 'a\u0001b', 'x\u2028y', '..', '']) {
    assert.ok(P.nameProblem(bad, { file: /\.pdf$/i.test(bad) }) || P.nameProblem(bad), bad);
  }
  assert.equal(P.nameProblem(`${'가'.repeat(197)}.pdf`, { file: true }), 'too_long');
  assert.equal(P.nameProblem(`${'가'.repeat(196)}.pdf`, { file: true }), '');
  assert.equal(P.nameProblem('논문.PDF', { file: true }), '');
  assert.equal(P.nameProblem('a.txt', { file: true }), 'bad_name');
  assert.equal(P.nameProblem('x'.repeat(101)), 'too_long');
  for (const t of ['.temp.pdf', '~$a.pdf', '.~lock.a.pdf', 'a.pdf.crdownload', 'b.part', 'c.tmp']) assert.ok(P.isTempName(t), t);
  assert.ok(!P.isTempName('a.pdf'));
  assert.equal(P.fold('가'.normalize('NFD') + 'A.pdf'), '가a.pdf');
  assert.equal(P.rebase('A\\b\\c.pdf', 'a\\B', 'X'), 'X\\c.pdf');
  assert.ok(P.isUnder('a\\b', 'A') && !P.isUnder('ab', 'a') && !P.isUnder('a', 'a'));
});

test('AC-654 · 12.4 safeJoin: 서버 이름 조각을 다시 검사해 루트 밖 · 표식 · 드라이브 문자 · 예약 이름을 거부', () => {
  const root = 'C:\\Users\\u\\논문';
  assert.equal(P.safeJoin(root, 'a\\b.pdf', { file: true }), 'C:\\Users\\u\\논문\\a\\b.pdf');
  for (const bad of ['..\\x.pdf', 'a\\..\\..\\x.pdf', 'C:x.pdf', 'CON.pdf', 'a/b.pdf', '.paperlab-sync\\x.pdf', 'a\\x.txt', '\\\\srv\\x.pdf', '']) {
    assert.equal(P.safeJoin(root, bad, { file: true }), null, bad);
  }
  assert.ok(P.isInside('C:\\R', 'c:\\r\\x') && !P.isInside('C:\\R', 'C:\\R2\\x') && !P.isInside('C:\\R', 'C:\\R'));
});

// ---------------------------------------------------------------- 세 갈래 비교 (6.4 · 6.5 표)
const S0 = () => ({ folders: new Map(), papers: new Map(), trashed: new Map(), gonePapers: new Set(), goneFolders: new Set() });
const jf = (rel, sha, extra = {}) => ({ rel, sha256: sha, size: 10, mtime_ms: 1, ino: `1:${rel}`, ...extra });
const lf = (rel, sha, extra = {}) => ({ rel, key: P.fold(rel), size: 10, mtime_ms: 1, ino: `1:${rel}`, sha256: sha, ...extra });
const sp = (id, name, sha, folder = null) => [id, { id, folder_id: folder, file_name: name, sha256: sha, size: 10 }];
const plan = (J, L, S, o) => R.planFiles({ folders: {}, ...J }, { dirs: [], ...L }, S, o).acts.map((a) => a.t + (a.pid != null ? `:${a.pid}` : ''));

test('6.4 파일 표: 같음 · 내용 · 위치 · 사라짐 · 휴지통 · 서버에 없음 · 새 파일 · 새 논문', () => {
  const S = () => { const s = S0(); s.papers = new Map([sp(1, 'a.pdf', 'h1')]); return s; };
  const J = { files: { 1: jf('a.pdf', 'h1') } };
  assert.deepEqual(plan(J, { files: [lf('a.pdf', 'h1')] }, S()), []);                                     // 같음 · 같음
  assert.deepEqual(plan(J, { files: [lf('a.pdf', 'h2', { mtime_ms: 2 })] }, S()), ['upload_content:1']); // 내용 바뀜 · 같음
  const s2 = S(); s2.papers.get(1).sha256 = 'h9';
  assert.deepEqual(plan(J, { files: [lf('a.pdf', 'h1')] }, s2), ['download:1']);                         // 같음 · 내용 바뀜(교체)
  assert.deepEqual(plan(J, { files: [lf('a.pdf', 'h2', { mtime_ms: 2 })] }, s2), ['upload_content:1']); // 둘 다 → 서버가 U-1
  assert.deepEqual(plan(J, { files: [lf('b.pdf', 'h1', { ino: '1:a.pdf' })] }, S()), ['srv_move:1']);   // 위치(같은 ID · 같은 해시)
  assert.deepEqual(plan(J, { files: [lf('b.pdf', 'h7', { ino: '1:a.pdf' })] }, S()).sort(), ['srv_delete:1', 'upload_new'].sort()); // ID 같아도 해시가 다르면 이동 아님(K-44)
  const s3 = S(); s3.papers.get(1).file_name = 'c.pdf';
  assert.deepEqual(plan(J, { files: [lf('a.pdf', 'h1')] }, s3), ['local_move:1']);                       // 같음 · 위치 바뀜
  assert.deepEqual(plan(J, { files: [lf('b.pdf', 'h1', { ino: '1:a.pdf' })] }, s3), ['srv_move:1']);    // 위치 vs 위치 → 보냄(도착 순서)
  assert.deepEqual(plan(J, { files: [] }, S()), ['srv_delete:1']);                                       // 사라짐 · 같음
  const t = S(); t.papers.clear(); t.trashed.set(1, { sha256: 'h1', label: '웹' });
  assert.deepEqual(plan(J, { files: [lf('a.pdf', 'h1')] }, t), ['trash_local:1']);                       // 같음 · 휴지통
  assert.deepEqual(plan(J, { files: [] }, s2), ['drop:1', 'download:1']);                                // 사라짐 · 내용 바뀜 → 받기
  assert.deepEqual(plan(J, { files: [lf('a.pdf', 'h2', { mtime_ms: 2 })] }, t), ['upload_content:1']);  // 내용 바뀜 · 휴지통 → 되살리고 교체
  assert.deepEqual(plan(J, { files: [] }, t), ['drop:1']);                                               // 사라짐 · 휴지통
  const g = S0(); g.gonePapers.add(1);
  assert.deepEqual(plan(J, { files: [lf('a.pdf', 'h1')] }, g), ['trash_local:1']);                       // 같음 · 묘비
  assert.deepEqual(plan(J, { files: [lf('a.pdf', 'h1')] }, S0()), ['upload_new']);                       // 서버에 아예 없음 → 다시 올림(K-23)
  assert.deepEqual(plan(J, { files: [lf('a.pdf', 'h1'), lf('copy.pdf', 'h1')] }, S()), []);              // 같은 PC 두 번째 복사본 → 연결 안 함
  assert.deepEqual(plan({ files: {} }, { files: [lf('n.pdf', 'h5')] }, S()).sort(), ['download:1', 'upload_new'].sort()); // 새 파일 · 새 논문
  const tr = S0(); tr.trashed.set(4, { sha256: 'h5' });
  assert.deepEqual(plan({ files: {} }, { files: [lf('n.pdf', 'h5')] }, tr), ['restore:4']);              // 휴지통 해시 → 되살림(11.3)
  assert.deepEqual(plan(J, { files: [lf('a.pdf', null)] }, s2), []);                                     // 아직 안정되지 않음 → 아무것도 안 함
});

test('6.4 첫 연결 위치(K-13): local → 서재 논문을 PC 위치로(J=서버 위치), library → PC 파일을 서재 위치로(J=PC 위치)', () => {
  const S = S0(); S.folders.set(5, { id: 5, name: '서재', parent_id: null }); S.papers = new Map([sp(1, 'x.pdf', 'h1', 5)]);
  const L = { files: [lf('pc\\x.pdf', 'h1')], dirs: [] };
  const local = R.planFiles({ files: {}, folders: {} }, L, S, { place: 'local' }).acts[0];
  const lib = R.planFiles({ files: {}, folders: {} }, L, S, { place: 'library' }).acts[0];
  assert.equal(local.t, 'link'); assert.equal(local.rel, '서재\\x.pdf');
  assert.equal(lib.rel, 'pc\\x.pdf');
});

test('6.5 폴더 표: 새 디렉터리 → folder.create, 새 폴더 → mkdir, 같은 이름 → 연결, PC 이름 변경 → folder.update, 서버 변경 → 옮김, 지움 → 비면 delete', () => {
  const S = S0();
  S.folders.set(1, { id: 1, name: 'A', parent_id: null });
  S.folders.set(2, { id: 2, name: 'srvnew', parent_id: null });
  S.folders.set(3, { id: 3, name: 'Same', parent_id: null });
  const J = { files: {}, folders: { 1: { rel: 'A', ino: 'd:1' } } };
  const L = { files: [], dirs: [{ rel: 'A2', key: 'a2', ino: 'd:1' }, { rel: 'pcnew', key: 'pcnew', ino: 'd:2' }, { rel: 'same', key: 'same', ino: 'd:3' }] };
  const t = R.planFolders(J, L, S).acts.map((a) => `${a.t}:${a.rel || a.to || ''}`);
  assert.deepEqual(t.sort(), ['folder_update:A2', 'link_dir:same', 'mkdir:srvnew', 'folder_create:pcnew'].sort());
  S.folders.get(1).name = 'B';
  const t2 = R.planFolders(J, { files: [], dirs: [{ rel: 'A', key: 'a', ino: 'd:1' }] }, S).acts.filter((a) => a.t === 'move_dir');
  assert.deepEqual(t2.map((a) => [a.from, a.to]), [['A', 'B']]);
  const gone = R.planFiles({ files: {}, folders: { 1: { rel: 'A' } } }, { files: [], dirs: [] }, S).acts.map((a) => a.t);
  assert.deepEqual(gone, ['folder_delete']);
  const tomb = S0(); tomb.goneFolders.add(1);
  assert.deepEqual(R.planFiles({ files: {}, folders: { 1: { rel: 'A' } } }, { files: [], dirs: [{ rel: 'A', key: 'a' }] }, tomb).acts.map((a) => a.t), ['rmdir']);
  // 안에 J 파일이 남아 있으면 폴더를 지우지 않음
  const inside = R.planFiles({ files: { 9: jf('A\\x.pdf', 'h') }, folders: { 1: { rel: 'A' } } }, { files: [], dirs: [] }, (() => { const s = S0(); s.folders.set(1, { id: 1, name: 'A', parent_id: null }); s.papers = new Map([sp(9, 'x.pdf', 'h', 1)]); return s; })());
  assert.deepEqual(inside.acts.map((a) => a.t), ['srv_delete']);
});

// ---------------------------------------------------------------- 서명 주소 (AC-655)
test('AC-655 서명 주소: 운영은 https + R2 호스트 + 키 접두어(내 uid), 개발은 서버 출처 /_dev_storage/ 만', () => {
  const prod = { serverOrigin: 'https://pl.example', dev: false, uid: UID };
  const ok = `https://acct.r2.cloudflarestorage.com/bucket/incoming/${UID}/x.pdf?X-Amz-Signature=s`;
  assert.ok(checkUrl(ok, 'put', prod));
  assert.ok(checkUrl(`https://bucket.acct.r2.cloudflarestorage.com/users/${UID}/papers/3.pdf?X-Amz-Signature=s`, 'get', prod));
  const bad = [
    `http://acct.r2.cloudflarestorage.com/bucket/incoming/${UID}/x.pdf`, `https://evil.example/bucket/incoming/${UID}/x.pdf`,
    `https://u:p@acct.r2.cloudflarestorage.com/bucket/incoming/${UID}/x.pdf`, 'https://acct.r2.cloudflarestorage.com/bucket/incoming/99999999-2222-3333-4444-555555555555/x.pdf',
    `https://acct.r2.cloudflarestorage.com/bucket/users/${UID}/papers/x.pdf`, `https://acct.r2.cloudflarestorage.com/bucket/incoming/${UID}/../x.pdf`,
    `https://acct.r2.cloudflarestorage.com/bucket/incoming/${UID}/%2e%2e/x.pdf`, `https://acct.r2.cloudflarestorage.com.evil.example/bucket/incoming/${UID}/x.pdf`,
    `https://acct.r2.cloudflarestorage.com:8443/bucket/incoming/${UID}/x.pdf`, `/_dev_storage/incoming/${UID}/x.pdf`, '',
  ];
  for (const u of bad) assert.throws(() => checkUrl(u, 'put', prod), { code: 'bad_url' }, u);
  assert.throws(() => checkUrl(`https://acct.r2.cloudflarestorage.com/bucket/incoming/${UID}/x.pdf`, 'get', prod), { code: 'bad_url' });
  const dev = { serverOrigin: 'http://127.0.0.1:8765', dev: true, uid: UID };
  assert.ok(checkUrl(`/_dev_storage/incoming/${UID}/x.pdf?X-Amz-Signature=s`, 'put', dev).startsWith('http://127.0.0.1:8765/_dev_storage/'));
  for (const u of [`http://other.example/_dev_storage/incoming/${UID}/x.pdf`, `/other/incoming/${UID}/x.pdf`, `https://acct.r2.cloudflarestorage.com/b/incoming/${UID}/x.pdf`]) {
    assert.throws(() => checkUrl(u, 'put', dev), { code: 'bad_url' }, u);
  }
});

test('AC-655 3xx 는 따르지 않고 실패, 검사에 걸리면 요청 0회', async () => {
  const { createTransfer } = require('../sync/transfer');
  const calls = [];
  const t = createTransfer({ serverOrigin: 'https://pl.example', dev: false, getUid: () => UID, fetchImpl: async (u, o) => { calls.push([u, o.redirect]); return { status: 302 }; } });
  await assert.rejects(t.get(`https://a.r2.cloudflarestorage.com/b/users/${UID}/papers/1.pdf`, path.join(tempHome('pl-tr-'), 'x.part')), { code: 'redirect' });
  assert.equal(calls[0][1], 'manual');
  await assert.rejects(t.get('https://evil.example/x', 'unused'), { code: 'bad_url' });
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------- 루트 거부 (AC-673 · U-4 · K-36)
test('AC-673 루트 거부: 드라이브 루트 · 시스템 · 앱 데이터 · 사용자 폴더 · OneDrive(접두어 함정 제외) · 겹침 · 링크 · 드라이브 종류 · 쓸 수 없음', () => {
  const env = { USERPROFILE: 'C:\\Users\\홍길동', SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files', APPDATA: 'C:\\Users\\홍길동\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\홍길동\\AppData\\Local' };
  const f = (p, extra = {}) => rootProblem({ p, env, oneDrive: ['C:\\Users\\홍길동\\OneDrive', 'C:\\Users\\홍길동\\OneDrive - Contoso'], otherRoots: [], link: false, drive: 'Fixed', writable: true, isDir: true, ...extra });
  assert.equal(f('C:\\'), 'drive_root');
  assert.equal(f('\\\\srv\\share\\p'), 'network');
  assert.equal(f('C:\\Users\\홍길동'), 'user_home');
  assert.equal(f('C:\\Users'), 'system');
  assert.equal(f('C:\\Windows\\x'), 'system');
  assert.equal(f('C:\\Program Files\\x'), 'system');
  assert.equal(f('C:\\Users\\홍길동\\AppData\\Roaming\\PaperLab'), 'app_data');
  assert.equal(f('c:/users/홍길동/onedrive/Documents/'), 'onedrive');
  assert.equal(f('C:\\Users\\홍길동\\OneDrive - Contoso\\Papers'), 'onedrive');
  assert.equal(f('C:\\Users\\홍길동\\OneDriveBackup\\x'), '');
  assert.equal(f('C:\\Users\\홍길동\\OneDrive\\..\\PaperLab 논문'), '');
  assert.equal(f('C:\\Users\\홍길동\\PaperLab 논문'), '');
  assert.equal(f('D:\\논문\\sub', { otherRoots: ['D:\\논문'] }), 'overlap');
  assert.equal(f('D:\\', {}), 'drive_root');
  assert.equal(f('D:\\논문', { otherRoots: ['D:\\논문\\sub'] }), 'overlap');
  assert.equal(f('D:\\논문', { ancestorMarker: true }), 'overlap');
  assert.equal(f('D:\\논문', { link: true }), 'link');
  assert.equal(f('D:\\논문', { drive: 'Network' }), 'network');
  assert.equal(f('D:\\논문', { drive: 'Removable' }), 'removable');
  assert.equal(f('D:\\논문', { drive: 'Unknown' }), 'unknown_drive');
  assert.equal(f('D:\\논문', { writable: false }), 'not_writable');
  assert.ok(within('C:\\A\\b', 'c:\\a') && !within('C:\\AB', 'C:\\A'));
});

test('AC-673 고르는 단계의 검사는 폴더 안에 아무것도 만들지 않음(쓰기 0회) · 정션 거부', async () => {
  const home = tempHome('pl-root-');
  const p = path.join(home, '논문');
  fs.mkdirSync(p);
  const deps = { oneDriveRoots: async () => [], driveType: async () => 'Fixed' };
  const r = await checkRoot(p, { env: {}, deps });
  assert.equal(r.code, '');
  assert.deepEqual(fs.readdirSync(p), []);
  const j = path.join(home, '정션');
  let junction = true;
  try { fs.symlinkSync(p, j, 'junction'); } catch { junction = false; }
  if (junction) assert.equal((await checkRoot(j, { env: {}, deps })).code, 'link');
  fs.writeFileSync(path.join(p, 'ro.txt'), 'x');
  assert.equal((await checkRoot(p, { env: {}, deps: { ...deps, driveType: async () => 'Removable' } })).code, 'removable');
});

// ---------------------------------------------------------------- 문구 (AC-693)
test('AC-693 상태 값마다 문구 · 트레이 줄이 있고, 문제 이유 · 거부 · 막힘 · 확인 창 문구가 비지 않음', () => {
  for (const st of Look.STATES) {
    for (const reason of st === 'storage_full' ? ['storage', 'sync_quota', 'db'] : ['']) {
      const s = { state: st, reason, counts: { pending_up: 2 }, progress: { done: 1, total: 30 }, userCap: 2 * 1024 ** 3, confirm: { count: 3, kind: 'local_delete' } };
      const l = Look.syncLook(s);
      assert.ok(l.chip && l.line, `${st} ${reason}`);
      assert.ok(Look.syncTrayLine(s).startsWith('폴더 동기화 · ') && !Look.syncTrayLine(s).includes('undefined'), st);
    }
  }
  assert.match(Look.syncLook({ state: 'storage_full', reason: 'sync_quota', userCap: 2 * 1024 ** 3 }).line, /2GB/);
  for (const c of ['too_long_down', 'busy', 'cloud_only', 'trash_locked', 'trash_parse_failed', 'folder_kept', 'duplicate_copy']) assert.ok(Look.PROBLEM_TEXT[c], c);
  assert.match(Look.problemText('없는코드'), /로그 폴더/);
  for (const code of ['onedrive', 'drive_root', 'not_writable', 'other_device', 'recycle_off', 'check_failed']) assert.ok(Look.pickError(code, { suggested: 'C:\\Users\\a\\PaperLab 논문' }).title, code);
  for (const kind of ['disk', 'storage', 'user', 'db']) assert.ok(!/undefined|NaN/.test(Look.previewBlock({ kind, need: 1e9, left: 1e8, free: 5e8, cap: 2e9, n: 3 }).body), kind);
  const remote = Look.confirmLook({ kind: 'remote_delete', count: 12, labels: ['웹'] });
  assert.equal(remote.cont, '이 PC에서도 지우기(Windows 휴지통으로)');
  assert.equal(remote.revert, '서재에 되살리기');
  const local = Look.confirmLook({ kind: 'local_delete', count: 12, base: 300 });
  assert.equal(local.cont, '서재에서도 지우기(휴지통으로)');
  assert.equal(local.revert, '되돌리기');
  assert.ok(Look.confirmLook({ kind: 'root_anomaly', count: 180, base: 312 }).title.includes('312개 중 180개'));
  const one = Look.syncBalloon({ kind: 'translation_cleared', n: 1, names: ['a.pdf'] });
  assert.equal(one.content.startsWith('PDF가 바뀌어 번역을 지웠어요: a.pdf'), true);
  assert.equal(Look.syncBalloon({ kind: 'translation_cleared', n: 3, names: ['a', 'b'] }).title, '번역 3편을 지웠어요');
  assert.equal(Look.syncBalloon({ kind: 'local_delete', n: 10 }).always, true);
  const g = Look.groupProblems(Array.from({ length: 7 }, (_, i) => ({ code: 'busy', rel: `f${i}.pdf` })).concat([{ code: 'too_long_down', rel: 'x.pdf' }]));
  assert.equal(g[0].code, 'too_long_down');
  assert.equal(g[0].files[0].local, false);
  assert.equal(g[1].files.length, 5);
  assert.equal(g[1].more, 2);
});

test('AC-693 이 PC 상태 화면은 경로 · 파일 이름을 esc() 로만 넣는다(코드 검사)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'ui', 'status-sync.js'), 'utf8');
  for (const v of ['f.rel', 'pv.root', 'sy.root', 'prev', 'm.local', 'm.library']) {
    const name = v.replace('.', '\\.');
    const raw = new RegExp(`>'\\s*\\+\\s*${name}\\b|\\b${name}\\s*\\+\\s*'<`); // 마크업 바로 옆에 날 값으로 붙임
    assert.ok(!raw.test(src), `${v} 를 esc() 없이 넣음`);
  }
  const html = fs.readFileSync(path.join(ROOT, 'ui', 'status.html'), 'utf8');
  assert.ok(html.indexOf('sync-look.js') < html.indexOf('status-sync.js') && html.indexOf('status-sync.js') < html.indexOf('status.js"'));
});

// ---------------------------------------------------------------- 코드 검사 (AC-659 · 658b)
test('AC-659 · 658b 코드 검사: desktop/sync 의 unlink · rm · rmdir 는 safe-remove.js 한 곳, shell.trashItem 은 main 한 곳(루트 안 · 링크 검사 뒤)', () => {
  const dir = path.join(ROOT, 'sync');
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hits = src.match(/\b(unlink|unlinkSync|rmSync|rmdir|rmdirSync|rm)\s*\(/g) || [];
    if (f === 'safe-remove.js') assert.deepEqual(hits.sort(), ['rmdirSync(', 'unlinkSync('].sort(), f);
    else assert.deepEqual(hits, [], f);
    assert.ok(!/trashItem|DeleteFile|Remove-Item/.test(src), `${f} 는 휴지통 · 삭제를 직접 하지 않음`);
  }
  const mainFiles = ['main.js', 'sync-host.js', 'ipc.js', 'store.js', 'window.js'].map((f) => [f, fs.readFileSync(path.join(ROOT, 'main', f), 'utf8')]);
  const users = mainFiles.filter(([, s]) => /\.trashItem\(/.test(s));
  assert.deepEqual(users.map(([f]) => f), ['sync-host.js']);
  const host = users[0][1];
  assert.ok(host.indexOf('isInside(root, p)') < host.indexOf('.trashItem('));
  assert.ok(host.indexOf('isSymbolicLink') < host.indexOf('.trashItem('));
});

test('main 휴지통 보내기: 루트 밖 · \\\\?\\ · 링크 안쪽 · 없는 파일은 trashItem 0회, 오류 모양을 이유로 나눔', async () => {
  const home = tempHome('pl-trash-');
  const root = path.join(home, 'root');
  fs.mkdirSync(root);
  const f = path.join(root, 'a.pdf');
  fs.writeFileSync(f, 'x');
  const outside = path.join(home, 'out.pdf');
  fs.writeFileSync(outside, 'x');
  const calls = [];
  const shell = (err) => ({ trashItem: async (p) => { calls.push(p); if (err) throw new Error(err); } });
  for (const p of [outside, `\\\\?\\${f}`, path.join(root, 'none.pdf'), 'relative.pdf']) assert.equal((await trashInRoot(p, root, shell())).ok, false, p);
  let junction = true;
  try { fs.symlinkSync(home, path.join(root, 'j'), 'junction'); } catch { junction = false; }
  if (junction) assert.equal((await trashInRoot(path.join(root, 'j', 'out.pdf'), root, shell())).ok, false);
  assert.equal(calls.length, 0);
  assert.deepEqual(await trashInRoot(f, root, shell('Operation was aborted')), { ok: false, reason: 'locked' });
  assert.deepEqual(await trashInRoot(f, root, shell('Failed to parse path')), { ok: false, reason: 'parse_failed' });
  assert.deepEqual(await trashInRoot(f, root, shell('boom')), { ok: false, reason: 'other' });
  assert.deepEqual(await trashInRoot(f, root, shell()), { ok: true, reason: '' });
});

// ---------------------------------------------------------------- 저널 · 설정
test('저널: 원자적 쓰기(임시 → 이름 바꾸기) · 깨지면 null(전체 다시 맞추기) · 설정 정규화', () => {
  const dir = tempHome('pl-j-');
  const file = path.join(dir, 'sync', 'state.json');
  const j = journal.fresh({ root: 'C:\\x', user_id: UID });
  j.files[3] = { rel: 'a.pdf', sha256: 'h', size: 1, mtime_ms: 1, ino: '' };
  journal.save(file, j);
  assert.deepEqual(journal.load(file).files, j.files);
  assert.ok(!fs.existsSync(`${file}.tmp`));
  fs.writeFileSync(file, '{"version":1,"files":{"x":{}}');
  assert.equal(journal.load(file), null);
  fs.writeFileSync(file, JSON.stringify({ version: 1, files: { 3: { rel: 1 } }, folders: {} }));
  assert.equal(journal.load(file), null);
  assert.deepEqual(normalizeSync({ enabled: true, root: '' }), { enabled: false, root: '', installId: '', previousRoot: '', paused: false, notify: true });
  assert.equal(normalizeSync({ enabled: true, root: 'D:\\p', installId: 'abc' }).enabled, true);
});

test('preload: 클라우드 화면(paperlabDesktop)에 동기화용 새 함수가 없다(15.2)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'preload', 'preload.js'), 'utf8');
  assert.ok(!/sync/i.test(src));
});
