'use strict';
// 외부 링크 열기 판정 (명세 13.2.1, K21 ①) — 순수 함수(단위 테스트: AC-86 (a) · (a2)).
// 1) URL API 로 해석 2) 스킴은 http: · https: 만 3) 호스트 비교는 정규화된 hostname(문자열 앞부분 비교 안 함)
// 5) 목록 밖 http(s)도 연다(K21 ①) 7) 서버 출처의 최상위 프레임에서 온 요청만 8) 10초에 5개까지.

const OPEN_LIMIT = 5;
const OPEN_WINDOW_MS = 10000;

// 반드시 열려야 하는 대표 호스트(AC-86 확인 대상 — K21 ①이라 판정에는 영향 없음, 기록용):
//   *.openlink.inha.ac.kr · lib.inha.ac.kr · scholar.google.com · doi.org · arxiv.org · *.r2.cloudflarestorage.com

function parse(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try { return new URL(url); } catch { return null; }
}

/** 주소만 보는 판정 → 정규화한 href 또는 null */
function isExternalAllowed(url) {
  const u = parse(url);
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return null;
  return u.href;
}

function originOf(url) {
  const u = parse(url);
  return u && (u.protocol === 'http:' || u.protocol === 'https:') ? u.origin : '';
}

/** 짧은 시간 안 개수 제한. now 를 주입받는다 */
function createOpenLimiter({ limit = OPEN_LIMIT, windowMs = OPEN_WINDOW_MS } = {}) {
  const hits = [];
  return (now) => {
    while (hits.length && now - hits[0] >= windowMs) hits.shift();
    if (hits.length >= limit) return false;
    hits.push(now);
    return true;
  };
}

/**
 * 외부 열기 요청 판정 → {open: href} | {deny: 'scheme'|'origin'|'frame'|'rate'}
 * requester = {origin, isMainFrame} — 요청한 문서(프레임)
 */
function decideExternal({ url, requester, serverOrigin, limiter, now }) {
  const href = isExternalAllowed(url);
  if (!href) return { deny: 'scheme' };
  if (!requester || requester.origin !== serverOrigin) return { deny: 'origin' };
  if (!requester.isMainFrame) return { deny: 'frame' };
  if (limiter && !limiter(now)) return { deny: 'rate' };
  return { open: href };
}

/** 로그에는 이유와 스킴만 (주소 · 질의는 남기지 않음 — 13.2.1 6번) */
function schemeOf(url) {
  const u = parse(url);
  return u ? u.protocol : '(해석 안 됨)';
}

module.exports = { isExternalAllowed, createOpenLimiter, decideExternal, originOf, schemeOf };
