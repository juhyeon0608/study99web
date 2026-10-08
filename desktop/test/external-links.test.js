'use strict';
// AC-86 (a) · (a2) — 외부 링크 판정 · 요청한 곳 · 개수 제한 (명세 13.2.1, K21 ①)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isExternalAllowed, decideExternal, createOpenLimiter } = require('../main/links');

const SERVER = new URL(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'deploy', 'server-pc', 'server.json'), 'utf8')).public_url).origin;
const host = new URL(SERVER).host;

test('(a) 허용: 학교 프록시 · 학교 로그인 · Scholar · DOI 프록시 · 목록 밖 출판사(K21 ①) · http', () => {
  for (const u of ['https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/x', 'https://lib.inha.ac.kr/login', 'https://scholar.google.com/scholar?q=a',
    'https://doi-org-ssl.openlink.inha.ac.kr/10.1109/CVPR.2016.90', 'https://www.example-publisher.com/article/1', 'http://ieeexplore.ieee.org/document/7780459/',
    'https://doi.org/10.1/x', 'https://arxiv.org/abs/1706.03762', 'https://acc.r2.cloudflarestorage.com/b/k?X-Amz-Signature=s']) {
    assert.equal(isExternalAllowed(u), new URL(u).href, u);
  }
});

test('(a) 거부: file · javascript · data · blob · mailto · smb · ms-settings · ftp · 빈 값 · 해석 안 됨', () => {
  for (const u of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'data:text/html,x', `blob:https://${host}/x`, 'mailto:a@b.c',
    'smb://host/share', 'ms-settings:', 'ftp://x.org/', '', '   ', 'not a url', 'https://', null, undefined, 'JAVASCRIPT:alert(1)', 'FILE:///c:/x']) {
    assert.equal(isExternalAllowed(u), null, String(u));
  }
});

test('(a2) 요청한 곳: 서버 출처의 최상위 프레임만, 하위 프레임 · 다른 출처는 거부', () => {
  const url = 'https://scholar.google.com/scholar?q=a';
  const lim = createOpenLimiter();
  assert.deepEqual(decideExternal({ url, requester: { origin: SERVER, isMainFrame: true }, serverOrigin: SERVER, limiter: lim, now: 0 }), { open: url });
  assert.deepEqual(decideExternal({ url, requester: { origin: SERVER, isMainFrame: false }, serverOrigin: SERVER, limiter: lim, now: 0 }), { deny: 'frame' });
  assert.deepEqual(decideExternal({ url, requester: { origin: 'https://example.com', isMainFrame: true }, serverOrigin: SERVER, limiter: lim, now: 0 }), { deny: 'origin' });
  assert.deepEqual(decideExternal({ url, requester: null, serverOrigin: SERVER, limiter: lim, now: 0 }), { deny: 'origin' });
  assert.deepEqual(decideExternal({ url: 'file:///c:/x', requester: { origin: SERVER, isMainFrame: true }, serverOrigin: SERVER, limiter: lim, now: 0 }), { deny: 'scheme' });
  // 문자열 앞부분 비교를 쓰지 않음: 서버 주소로 시작하는 다른 호스트는 다른 출처
  assert.deepEqual(decideExternal({ url, requester: { origin: `${SERVER}.evil.example`, isMainFrame: true }, serverOrigin: SERVER, limiter: lim, now: 0 }), { deny: 'origin' });
});

test('(a2) 개수 제한: 10초에 5개 — 6번째 거부, 첫 요청에서 10초 지나면 다시 허용 (시계 주입)', () => {
  const lim = createOpenLimiter();
  const req = { origin: SERVER, isMainFrame: true };
  const at = (now) => decideExternal({ url: 'https://doi.org/x', requester: req, serverOrigin: SERVER, limiter: lim, now });
  for (let i = 0; i < 5; i++) assert.ok(at(i * 1000).open);
  assert.deepEqual(at(9999), { deny: 'rate' });
  assert.ok(at(10000).open); // 첫 요청(0)에서 10초
  assert.deepEqual(at(10001), { deny: 'rate' });
});
