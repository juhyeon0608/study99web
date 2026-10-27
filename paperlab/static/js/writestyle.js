// 문체 점검 (2026-10-28 사용자 요청) — 순수 함수. 제출 전 점검표(writecheck.js)의 '문체' 묶음 (모두 '확인 권장')
// ① 긴 문장 ② 번역투(~에 있어서 · ~를 가지고 있다 · ~에 의해 ~되다) ③ 이중 피동(되어지다 · 보여지다)
// ④ 겹친 말(과반수 이상 · 미리 예측 · 여러 ~들) ⑤ 같은 끝맺음이 이어지는 문장 ⑥ 한 문단에서 같은 접속어로 여는 문장
// ⑦ '~것이다'로 끝나는 문장이 많음. 인용 · 수식 · 코드 · [확인 필요] 는 writeterms.js maskText로 뺀다
import { maskText } from "./writeterms.js";

export const STYLE_LIMITS = { sentenceKo: 150, sentenceEn: 45, sameEnding: 3, connective: 3, geosida: 4 };

// [정규식, 안내] — 안내의 {0}은 찾은 말
const RULES = [
  [/[가-힣]+에\s?있어서?(?![가-힣])/g, "'~에 있어(서)'는 번역투예요 — '~에서' · '~할 때'로 바꿔 보세요", "translationese"],
  [/(?:을|를)\s?(?:가지고|갖고)\s?있(?=[다는었으])/g, "'~를 가지고 있다'는 번역투예요 — '~이 있다'로 바꿔 보세요", "translationese"],
  [/에\s?의(?:해|하여|한)\s+[가-힣]*(?:되었|된다|되어|되는|된|됨)/g, "'~에 의해 ~되다'는 번역투 피동이에요 — 주어를 살려 능동으로 써 보세요", "translationese"],
  [/[가-힣]*(?:되어지|되어진|되어졌|보여지|보여진|보여졌|잊혀지|불려지|읽혀지|쓰여지|쓰여진|나뉘어지|나뉘어진|짜여진|정해지게)/g,
    "'{0}' — 이중 피동이에요. '~되다' · '~보이다' · '~나뉘다'처럼 한 번만", "double-passive"],
  [/과반수\s?이상|미리\s?(?:예측|예상|예견|준비)|다시\s?재(?:검토|확인|조사|시작|평가|분석|구성|정의|발견|해석|사용)|가장\s?최(?:고|대|소|선|적|초|상|하)|서로\s?상호|새로\s?신설|먼저\s?선결|남은\s?여생|같은\s?동일|함께\s?동참|여러\s?가지\s?다양/g,
    "'{0}' — 뜻이 겹친 말이에요. 한쪽만 써 보세요", "redundant"],
  [/(?:많은|여러|다양한|모든|각각의|수많은)\s+[가-힣]{1,6}들(?=[은는이가을를의에과와도로]|\s|[.,])/g,
    "'{0}' — 복수 표시가 겹쳐요. '들'을 빼도 돼요", "redundant"],
];
const CONNECTIVES = ["또한", "그리고", "따라서", "그러나", "하지만", "즉", "한편", "그러므로", "특히", "이에", "이를 통해"];
const SKIP_LINE_RE = /^\s{0,3}(?:#{1,6}\s|\||!\[|표\s*\d|그림\s*\d|<|\[(?:참고문헌|References|Bibliography|REFERENCES)\])/;
const LIST_PREFIX_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;

// 문단: 빈 줄 · 건너뛸 줄로 나뉜 줄 묶음 → [{ from, text }] (text는 가린 글, from은 원고 위치)
function paragraphs(masked) {
  const out = [];
  let cur = null;
  let pos = 0;
  for (const line of masked.split("\n")) {
    const skip = !line.trim() || SKIP_LINE_RE.test(line);
    const list = LIST_PREFIX_RE.test(line);
    if (skip || list) cur = null;
    if (!skip) {
      if (!cur) { cur = { from: pos, text: line }; out.push(cur); } else cur.text += `\n${line}`;
      if (list) cur = null; // 목록 항목은 한 줄씩
    }
    pos += line.length + 1;
  }
  return out;
}

// 문단 → 문장 [{ from, to, text }] (마침표 · 물음표 · 느낌표 다음 빈칸에서 나눔 — 3.5 · e.g.처럼 빈칸 없는 점은 그대로)
export function sentences(para) {
  const out = [];
  let start = 0;
  const add = (end) => {
    const raw = para.text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) out.push({ from: para.from + start + lead, to: para.from + start + lead + text.length, text });
    start = end;
  };
  for (const m of para.text.matchAll(/[.!?。]+(?=\s|$)/g)) add(m.index + m[0].length);
  add(para.text.length);
  return out;
}

const ending = (s) => s.replace(/[.!?。"'”’)\]\s]+$/u, "").replace(/\s/g, "").slice(-4);
const isKo = (s) => /[가-힣]/.test(s);

/** → [{ sev, code, msg, from, to }] (writecheck item 모양, group은 부르는 쪽이 붙임) */
export function styleIssues(value) {
  const text = maskText(value);
  const out = [];
  const push = (code, msg, from, to) => out.push({ sev: "warn", code, msg, from, to });
  const paras = paragraphs(text);
  for (const p of paras) {
    for (const [re, msg, code] of RULES) {
      for (const m of p.text.matchAll(re)) {
        const word = m[0].trim();
        push(`style-${code}`, msg.replace("{0}", word), p.from + m.index, p.from + m.index + m[0].length);
      }
    }
  }
  const all = paras.map((p) => sentences(p));
  // 긴 문장
  for (const s of all.flat()) {
    const ko = isKo(s.text);
    const n = ko ? s.text.replace(/\s+/g, " ").length : s.text.split(/\s+/).length;
    if (n > (ko ? STYLE_LIMITS.sentenceKo : STYLE_LIMITS.sentenceEn)) {
      push("style-long-sentence", ko ? `문장이 길어요 (${n}자) — 두 문장으로 나눠 보세요` : `Long sentence (${n} words) — consider splitting`, s.from, s.to);
    }
  }
  for (const list of all) {
    // 같은 끝맺음이 이어짐 (한국어 문장, 끝 네 글자가 같음 — '나타났다' · '할수있다')
    let run = 1;
    for (let i = 1; i <= list.length; i++) {
      const same = i < list.length && isKo(list[i].text) && ending(list[i].text).length >= 3 && ending(list[i].text) === ending(list[i - 1].text);
      if (same) { run++; continue; }
      if (run >= STYLE_LIMITS.sameEnding) {
        const first = list[i - run];
        push("style-same-ending", `'~${ending(first.text)}'로 끝나는 문장이 ${run}번 이어져요 — 끝맺음을 바꿔 보세요`, first.from, list[i - 1].to);
      }
      run = 1;
    }
    // 같은 접속어로 여는 문장 (한 문단 안)
    const byWord = new Map();
    for (const s of list) {
      const w = CONNECTIVES.find((c) => s.text.startsWith(c) && !/[가-힣]/.test(s.text[c.length] || ""));
      if (w) byWord.set(w, [...(byWord.get(w) || []), s]);
    }
    for (const [w, ss] of byWord) {
      if (ss.length >= STYLE_LIMITS.connective) push("style-connective", `이 문단에서 '${w}'로 여는 문장이 ${ss.length}번이에요 — 몇 곳은 빼거나 바꿔 보세요`, ss[0].from, ss[0].from + w.length);
    }
  }
  // '~것이다'로 끝나는 문장이 많음
  const geos = all.flat().filter((s) => /것이다[.!?]?$/.test(s.text));
  if (geos.length >= STYLE_LIMITS.geosida) {
    for (const s of geos) push("style-geosida", `'~것이다'로 끝나는 문장이 ${geos.length}개예요 — '~이다' · '~한다'로 줄여 보세요`, s.to - 4, s.to);
  }
  return out;
}
