'use strict';
// main 프로세스의 순수 부분: 로그인 콜백 · 인증 주소 검사(13.4) · IPC 보낸 곳 검사(13.2) · 토큰 저장(12.3 · AC-61 · AC-80) ·
// 서버 주소(U6) · electron-builder 설정(AC-88 h) · preload 노출 함수(13.3 · AC-74)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isAuthorizeUrl, parseCallback, findDeepLink, launchSwitches, registerProtocol } = require('../main/auth-bridge');
const { isCloudSender, isLocalSender } = require('../main/ipc');
const { Store } = require('../main/store');
const { serverOrigin, cleanOrigin } = require('../main/config');
const { redact } = require('../lib/redact');
const { tempHome } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const SERVER_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'deploy', 'server-pc', 'server.json'), 'utf8'));
const SERVER = new URL(SERVER_JSON.public_url).origin;
const SUPA = 'https://abcd.supabase.co';

test('구글 로그인 주소: Supabase 출처의 /auth/v1/authorize 만', () => {
  assert.ok(isAuthorizeUrl(`${SUPA}/auth/v1/authorize?provider=google&redirect_to=paperlab%3A%2F%2Fauth-callback&code_challenge=x`, SUPA));
  for (const bad of [`${SUPA}/auth/v1/token`, 'https://abcd.supabase.co.evil.example/auth/v1/authorize', 'https://evil.example/auth/v1/authorize',
    `http://abcd.supabase.co/auth/v1/authorize`, 'javascript:alert(1)', `https://user:pw@abcd.supabase.co/auth/v1/authorize`, '']) {
    assert.equal(isAuthorizeUrl(bad, SUPA), false, bad);
  }
});

test('딥 링크: paperlab://auth-callback?code= 만, 코드 모양 검사, 오류는 error', () => {
  assert.deepEqual(parseCallback('paperlab://auth-callback?code=3b0f1c2e-aaaa-bbbb-cccc-1234567890ab'), { code: '3b0f1c2e-aaaa-bbbb-cccc-1234567890ab', error: '' });
  assert.deepEqual(parseCallback('paperlab://auth-callback?error=access_denied&error_description=x'), { code: '', error: 'access_denied' });
  assert.deepEqual(parseCallback('paperlab://auth-callback?code=<script>'), { code: '', error: 'invalid_callback' });
  assert.equal(parseCallback('paperlab://other?code=abcdefgh'), null);
  assert.equal(parseCallback('https://auth-callback/?code=abcdefgh'), null);
  assert.equal(findDeepLink(['C:\\PaperLab.exe', '--hidden']), null);
  assert.equal(findDeepLink(['C:\\PaperLab.exe', 'PAPERLAB://auth-callback?code=abcdefgh']), 'PAPERLAB://auth-callback?code=abcdefgh');
});

test('F1 paperlab:// 등록: 배포본만 "exe" -- "%1" 로(가짜 app — 이 PC 레지스트리는 건드리지 않음), 개발 실행은 건너뜀, 제거 때 지움', () => {
  const calls = [];
  const fake = (isPackaged) => ({ isPackaged, setAsDefaultProtocolClient: (...a) => { calls.push(a); return true; } });
  const exe = 'C:\\Users\\홍 길동\\AppData\\Local\\Programs\\PaperLab\\PaperLab.exe';
  assert.equal(registerProtocol(fake(true), exe), true);
  assert.deepEqual(calls, [['paperlab', exe, ['--']]]);
  assert.equal(registerProtocol(fake(false), 'C:\\x\\electron.exe'), false);
  assert.equal(calls.length, 1, '개발 실행은 등록하지 않음');
  assert.equal(registerProtocol({ isPackaged: true, setAsDefaultProtocolClient: () => false }, exe), false);
  const nsh = fs.readFileSync(path.join(ROOT, 'build', 'installer.nsh'), 'utf8');
  const un = nsh.slice(nsh.indexOf('${ifNot} ${isUpdated}'), nsh.indexOf('${endIf}'));
  assert.ok(un.includes('DeleteRegKey HKCU "Software\\Classes\\paperlab"'), '제거(업데이트 아님) 때 등록을 지움');
});

test('F1 실행 인자: paperlab:// 인자는 꼭 하나만, 그 뒤 · "--" 뒤의 스위치는 무시', () => {
  const exe = 'C:\\PaperLab.exe';
  const link = 'paperlab://auth-callback?code=abcdefgh';
  assert.equal(findDeepLink([exe, '--', link]), link);
  assert.equal(findDeepLink([exe, link, 'paperlab://auth-callback?code=zzzzzzzz']), null, '둘 이상이면 받지 않음');
  assert.equal(findDeepLink([exe, `paperlab://auth-callback?code=${'a'.repeat(5000)}`]), null);
  assert.deepEqual(launchSwitches([exe, '--hidden']), ['--hidden']);
  assert.deepEqual(launchSwitches([exe, link, '--hidden', '--inspect=9229']), [], '딥 링크 뒤 스위치는 무시');
  assert.deepEqual(launchSwitches([exe, '--', link, '--hidden']), [], '"--" 뒤는 무시');
  assert.deepEqual(launchSwitches([exe, '--hidden', '--', link]), ['--hidden']);
});

test('IPC 보낸 곳: 클라우드 채널은 서버 출처 최상위 프레임만, 로컬 채널은 app://ui 최상위만', () => {
  const top = { url: `${SERVER}/#/library`, parent: null };
  assert.equal(isCloudSender(top, SERVER), true);
  assert.equal(isCloudSender({ url: `${SERVER}/x`, parent: top }, SERVER), false);
  assert.equal(isCloudSender({ url: 'https://example.com/', parent: null }, SERVER), false);
  assert.equal(isCloudSender({ url: 'app://ui/status.html', parent: null }, SERVER), false);
  assert.equal(isCloudSender(null, SERVER), false);
  assert.equal(isLocalSender({ url: 'app://ui/status.html', parent: null }), true);
  assert.equal(isLocalSender({ url: 'app://other/status.html', parent: null }), false);
  assert.equal(isLocalSender({ url: `${SERVER}/`, parent: null }), false);
  assert.equal(isLocalSender({ url: 'app://ui/x.html', parent: {} }), false);
});

test('AC-61 · 80 토큰 저장: 한글 · 공백 경로, 암호문만 파일에(평문 pld1. 없음), 암호화 불가면 메모리에만', () => {
  const dir = path.join(tempHome('pl-store-'), 'AppData', 'Roaming', 'PaperLab');
  const fake = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s, 'utf8').map((b) => b ^ 0x5a), decryptString: (b) => Buffer.from(b).map((x) => x ^ 0x5a).toString('utf8') };
  const token = `pld1.12345678-1234-1234-1234-123456789abc.3.${'B'.repeat(43)}`;
  const s = new Store(dir, fake);
  assert.equal(s.readToken(), null);
  assert.equal(s.saveToken(token), true);
  const raw = fs.readFileSync(path.join(dir, 'device.bin'));
  assert.ok(!raw.toString('latin1').includes('pld1.'));
  assert.equal(new Store(dir, fake).readToken(), token);
  s.set({ deviceId: 3, deviceName: '집 PC', accountHint: 'a***@example.com' });
  const settings = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!settings.includes('pld1.') && settings.includes('집 PC'));
  assert.deepEqual(new Store(dir, fake).get('worker').engines.claude, { enabled: true, slots: 2, path: '' }); // U9 기본값
  assert.equal(new Store(dir, fake).get('worker').totalSlots, 2);
  s.clearToken();
  assert.ok(!fs.existsSync(path.join(dir, 'device.bin')));
  const noCrypto = new Store(path.join(dir, 'x'), { isEncryptionAvailable: () => false });
  assert.equal(noCrypto.saveToken(token), false);
  assert.equal(noCrypto.readToken(), token);
  assert.ok(!fs.existsSync(path.join(dir, 'x', 'device.bin')));
});

test('서버 주소(U6 · F9): 배포본은 빌드가 넣은 값만 · https 만, 개발 실행은 로컬 PAPERLAB_SERVER_URL 필수', () => {
  assert.equal(serverOrigin({ isPackaged: true, env: { PAPERLAB_SERVER_URL: 'http://127.0.0.1:8000' }, pkg: { paperlabServer: SERVER } }), SERVER);
  assert.equal(serverOrigin({ isPackaged: true, pkg: { paperlabServer: 'http://plain.example' } }), null);
  assert.equal(serverOrigin({ isPackaged: false, env: { PAPERLAB_SERVER_URL: 'http://127.0.0.1:8000/x' } }), 'http://127.0.0.1:8000');
  assert.equal(serverOrigin({ isPackaged: false, env: { PAPERLAB_SERVER_URL: 'http://evil.example' } }), null);
  // F9: 개발 실행은 로컬 주소가 꼭 있어야 함 — 없거나 운영(https) 주소면 null(시작하지 않음)
  assert.equal(serverOrigin({ isPackaged: false, env: {} }), null);
  assert.equal(serverOrigin({ isPackaged: false, env: { PAPERLAB_SERVER_URL: SERVER } }), null);
  assert.equal(serverOrigin({ isPackaged: false, env: { PAPERLAB_SERVER_URL: 'https://localhost:8443' } }), 'https://localhost:8443');
  assert.equal(cleanOrigin('https://a.example/path?q', { allowLocalHttp: false }), 'https://a.example');
});

test('AC-88 (h) electron-builder: publish generic · url = server.json public_url + /downloads/ (https) · NSIS 사용자별 · 파일 이름 · fuses', () => {
  const cfg = require('../electron-builder.config.js');
  assert.deepEqual(cfg.publish, [{ provider: 'generic', url: `${SERVER_JSON.public_url.replace(/\/+$/, '')}/downloads/` }]);
  assert.ok(cfg.publish[0].url.startsWith('https://'));
  assert.equal(cfg.extraMetadata.paperlabServer, SERVER);
  assert.equal(cfg.nsis.perMachine, false);
  assert.equal(cfg.nsis.oneClick, false); // 설치 위치 고르기 (2026-10-19)
  assert.equal(cfg.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(cfg.nsis.deleteAppDataOnUninstall, false);
  assert.equal(cfg.win.artifactName, 'PaperLab-Setup-${version}.${ext}');
  assert.deepEqual(cfg.protocols, [{ name: 'PaperLab', schemes: ['paperlab'] }]);
  assert.equal(cfg.electronFuses.runAsNode, false);
  assert.equal(cfg.electronFuses.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(cfg.electronFuses.enableNodeCliInspectArguments, false);
  assert.ok(fs.existsSync(path.join(ROOT, 'ui', 'app.css'))); // PD-5 — 빌드 설정이 app.css 를 복사
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  // 선택 동기화 9.5.4 — 로컬 문서 본문 추출용 둘만 더함(정확한 버전, 추출 Worker 안에서만 require — AC-S49)
  assert.deepEqual(pkg.dependencies, { 'electron-updater': '6.8.9', 'hwp.js': '0.0.3', 'word-extractor': '1.0.4' });
  assert.ok(cfg.files.includes('extract/**/*'));
  assert.ok(cfg.asarUnpack.includes('extract/**/*') && cfg.asarUnpack.includes('node_modules/hwp.js/**/*') && cfg.asarUnpack.includes('node_modules/word-extractor/**/*'));
  assert.ok(cfg.extraResources.some((r) => r.from === 'build/gen/THIRD_PARTY_NOTICES.html' && r.to === 'THIRD_PARTY_NOTICES.html'));
  // 설치본에 .txt 없음(엑소스피어 랜섬웨어 방어가 서명 없는 설치 프로그램의 .txt 쓰기를 차단 — 2026-10-19)
  assert.ok(!cfg.extraResources.some((r) => /\.txt$/i.test(r.to)));
  assert.equal(cfg.afterPack, require('../scripts/txt-to-html').afterPack);
  assert.ok(fs.readFileSync(path.join(ROOT, 'build', 'gen', 'THIRD_PARTY_NOTICES.html'), 'utf8').startsWith('<!doctype html>'));
  assert.ok(fs.existsSync(path.join(ROOT, 'ui', 'vendor', 'pdf.min.mjs')) && fs.existsSync(path.join(ROOT, 'ui', 'vendor', 'pdf.worker.min.mjs'))); // copy-vendor
});

test('AC-74 preload: 클라우드 화면에는 13.3 표의 함수 6개 + 로그인 대기 취소만, 토큰 · Electron API 를 내주지 않음', () => {
  const src = fs.readFileSync(path.join(ROOT, 'preload', 'preload.js'), 'utf8');
  const block = src.slice(src.indexOf("exposeInMainWorld('paperlabDesktop'"));
  const names = [...block.matchAll(/^\s{4}([A-Za-z]+):/gm)].map((m) => m[1]);
  assert.deepEqual(names, ['info', 'pair', 'nudge', 'startGoogleLogin', 'cancelGoogleLogin', 'onAuthCallback', 'openStatusWindow',
    'localFile', 'openLocal', 'localHas']); // + 선택 동기화 9.1(계약 C-3) — 논문 id 만
  assert.ok(!/:\s*ipcRenderer\b|\(ipcRenderer\)|exposeInMainWorld\('ipcRenderer'|require\('(fs|child_process|node:)/.test(src));
});

test('로그 지우기: 기기 토큰 · 키 · Bearer · 연결 코드 · 주소의 code', () => {
  const s = redact(`pld1.12345678-1234-1234-1234-123456789abc.3.${'B'.repeat(43)} sk-ant-api03-abc Bearer eyJabc K7QF-2M9X paperlab://auth-callback?code=secretcode AIzaSyA1234567890123456789012`);
  for (const bad of ['BBBB', 'api03-abc', 'eyJabc', 'K7QF-2M9X', 'secretcode', 'AIzaSyA1234567890123456789012']) assert.ok(!s.includes(bad), bad);
});
