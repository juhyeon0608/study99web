'use strict';
// 직접 만든 XML 토큰 읽기 (명세 selective-sync.md 9.5.2절 — DOM · 외부 파서 없음). 글만 모으는 데 필요한 만큼만 읽는다.
// - <!DOCTYPE · <!ENTITY 가 나오면 거부(외부 엔터티 · 엔터티 폭증 공격 원천 차단 — OOXML · OWPML · ODF 본문에는 DTD 가 없음).
// - 미리 정한 5개 엔터티(&lt; &gt; &amp; &quot; &apos;)와 숫자 참조(&#…; · &#x…; — 유효 코드 포인트만)만 풂, 그 밖 &이름; 은 그대로.
// - 태그 중첩 깊이 ≤ 256, 한 태그 길이 ≤ 64KB, 문서 하나 ≤ 64MB.
// 이름 비교는 접두어를 뗀 로컬 이름(w:t → t)으로 — 형식별 규칙은 office.js.

const { LIMITS, ExtractError } = require('./kinds');

const bad = (why) => new ExtractError('local_unreadable', `xml: ${why}`);
const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** 엔터티 풀기 — 5개 이름 · 숫자 참조만. 잘못된 코드 포인트(서로게이트 · 0 · 범위 밖 · XML 금지 제어 문자)는 지움 */
function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,8}|#[0-9]{1,10}|[A-Za-z][A-Za-z0-9]{0,31});/g, (m, ref) => {
    if (ref[0] !== '#') return Object.prototype.hasOwnProperty.call(NAMED, ref) ? NAMED[ref] : m;
    const cp = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    const ok = cp === 0x9 || cp === 0xa || cp === 0xd || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
    return ok ? String.fromCodePoint(cp) : '';
  });
}

const localName = (q) => { const i = q.indexOf(':'); return i < 0 ? q : q.slice(i + 1); };

function parseAttrs(s) {
  const out = {};
  const re = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[localName(m[1])] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
  return out;
}

/**
 * 토큰 읽기: h = {open(name, attrs, self), close(name), text(str)} — name 은 로컬 이름. 주석 · 처리 명령은 건너뜀, CDATA 는 글.
 * 잘못된 모양 · 상한 넘음 · DTD → ExtractError(local_unreadable)
 */
function walkXml(input, h, limits = LIMITS) {
  const xml = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  if (xml.length > limits.xmlMaxDocBytes) throw bad('document too big');
  const stack = [];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { if (stack.length) h.text(decodeEntities(xml.slice(i))); break; }
    if (lt > i && stack.length) h.text(decodeEntities(xml.slice(i, lt)));
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw bad('comment');
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw bad('cdata');
      if (stack.length) h.text(xml.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) throw bad('pi');
      i = end + 2;
      continue;
    }
    if (xml[lt + 1] === '!') throw bad('dtd'); // <!DOCTYPE · <!ENTITY · 그 밖 선언 — 받지 않음
    // 태그 끝 '>' (따옴표 안의 '>' 는 건너뜀)
    let j = lt + 1;
    let q = '';
    for (; j < n; j++) {
      const c = xml[j];
      if (q) { if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '>') break;
      if (j - lt > limits.xmlMaxTagBytes) throw bad('tag too long');
    }
    if (j >= n) throw bad('unterminated tag');
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === '/') {
      const name = body.slice(1).trim();
      const top = stack.pop();
      if (top === undefined || top !== name) throw bad('mismatched close');
      h.close(localName(name));
      continue;
    }
    const self = body.endsWith('/');
    const inner = self ? body.slice(0, -1) : body;
    const m = /^([^\s/>]+)/.exec(inner);
    if (!m) throw bad('bad tag');
    const qname = m[1];
    const attrs = parseAttrs(inner.slice(qname.length));
    if (!self) {
      stack.push(qname);
      if (stack.length > limits.xmlMaxDepth) throw bad('too deep');
    }
    h.open(localName(qname), attrs, self);
    if (self) h.close(localName(qname));
  }
  if (stack.length) throw bad('unclosed');
}

module.exports = { walkXml, decodeEntities, localName };
