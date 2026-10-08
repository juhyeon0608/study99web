'use strict';
// 로그 · 서버로 보내는 오류 문구에서 비밀값 모양을 지운다 (명세 13.8 · 8.6 · AC-62).
// 기기 토큰(pld1.…) · API 키(sk-ant- · sk- · AIza) · Bearer 값 · JWT · 주소 속 code/token/서명 값 · 연결 코드.

const PATTERNS = [
  [/pld1\.[A-Za-z0-9._~-]+/g, 'pld1.[지움]'],
  [/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-[지움]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, 'sk-[지움]'],
  [/AIza[0-9A-Za-z_-]{20,}/g, 'AIza[지움]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [지움]'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[JWT 지움]'],
  [/([?&#](?:code|token|access_token|refresh_token|key|X-Amz-Signature|X-Amz-Credential)=)[^&\s"']+/gi, '$1[지움]'],
  [/\b[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}\b/g, '[연결 코드]'],
];

function redact(value, max) {
  let s = String(value == null ? '' : value);
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  if (max && s.length > max) s = s.slice(0, max);
  return s;
}

module.exports = { redact };
