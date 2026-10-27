// 서재 대조 (2026-10-27 사용자 요청) — 순수 함수. ① 인용이 필요한데 없는 문장 ② 내 서재 원문과 표현이 거의 같은 문장(표절 미리 점검)
// 서버 POST /api/library-match(문장 여러 개 → 서재 본문 조각 · overlap)를 화면(writematchui.js)이 부른다

const SKIP_LINE_RE = /^\s{0,3}(#{1,6}\s|\||```|~~~|!\[|>|\[\^|표:|Table:|\[참고문헌\]|\[References\]|\[Bibliography\])/;
// 인용이 있어야 할 말투 (남의 연구 · 통계 · 이론을 말함)
const CLAIM_RE = new RegExp([
  "연구에\\s*(?:따르면|의하면)", "선행\\s*연구", "연구들[은이]", "연구에서는", "보고(?:되었|하였|했|된\\s*바)", "밝혀(?:졌|진|냈)",
  "알려져\\s*있", "제시(?:하였|했|되었|된\\s*바)", "주장(?:하였|했|한\\s*바)", "지적(?:하였|했|되어)", "에\\s*(?:따르면|의하면)",
  "학자들", "이론에\\s*(?:따르면|의하면)", "로\\s*정의(?:하였|했|된다|한다)", "일반적으로", "많은\\s*연구",
  "according to", "studies (?:have|show|suggest|found)", "research (?:has|have|shows)", "(?:was|were|has been) reported",
  "previous (?:studies|research)", "it is (?:well )?known",
].join("|"), "i");
const STAT_RE = /\d[\d,.]*\s*(?:%|퍼센트|명|만\s*명|억|조\s*원|배|건|개국|percent)|(?:19|20)\d{2}\s*년\s*(?:기준|현재|조사|통계)/;
// 내 연구 이야기는 인용 대상이 아님
const OWN_RE = /본\s*연구|이\s*연구(?:는|에서|의\s*결과)|본\s*논문|연구자는|분석\s*결과|본\s*조사|이번\s*조사|(?:연구\s*)?(?:참여자|참가자|대상자|응답자|피험자)(?:[는은가이]|\s*\d)|표본[은이]|this study|our (?:study|results|findings)|we found|participants/i;

// 문장 끝: . ? ! 。 (괄호 안은 아님) — writesrc.js와 같은 규칙
function sentences(par) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < par.length; i++) {
    const ch = par[i];
    if (ch === "[" || ch === "(") depth++;
    else if ((ch === "]" || ch === ")") && depth) depth--;
    else if (!depth && /[.?!。]/.test(ch) && (i + 1 === par.length || /\s/.test(par[i + 1]))) {
      out.push([start, i + 1]);
      start = i + 1;
    }
  }
  if (start < par.length) out.push([start, par.length]);
  return out.map(([a, b]) => {
    while (a < b && /\s/.test(par[a])) a++;
    return [a, b];
  }).filter(([a, b]) => b > a);
}

/** 본문 문장 { from, to, text } — 제목 · 표 · 그림 · 인용 블록 · 코드 · 각주 정의 · 캡션 줄은 뺌. 목록 기호는 문장에서 뺌 */
export function bodySentences(value) {
  const v = String(value ?? "");
  const out = [];
  let fence = false;
  let pos = 0;
  for (const line of v.split("\n")) {
    const start = pos;
    pos += line.length + 1;
    if (/^\s{0,3}(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence || !line.trim() || SKIP_LINE_RE.test(line)) continue;
    const lead = (line.match(/^\s*(?:[-*+]|\d+[.)])\s+/) || [""])[0].length;
    for (const [a, b] of sentences(line.slice(lead))) {
      const text = line.slice(lead + a, lead + b).trim();
      if (text.length >= 10) out.push({ from: start + lead + a, to: start + lead + a + text.length, text });
    }
  }
  return out;
}

const plainQuery = (t) => t.replace(/\[@[^\]\n]*\]|\[확인\s*필요[^\]\n]*\]|\[\^[^\]\n]*\]|[*_`]/g, "").replace(/\s+/g, " ").trim();
export const queryText = plainQuery;

/** 인용이 필요한데 없는 문장 (남의 연구 · 통계 · 이론을 말하는데 [@…]가 없음) → [{ from, to, text, reason }] */
export function uncitedClaims(value, max = 150) {
  const out = [];
  for (const s of bodySentences(value)) {
    if (/\[@[^\]\n]+\]/.test(s.text) || /\[확인\s*필요/.test(s.text)) continue; // 인용 있음 · 이미 확인 표시
    if (OWN_RE.test(s.text)) continue;
    const reason = CLAIM_RE.test(s.text) ? "다른 연구 · 이론을 말하는 문장" : STAT_RE.test(s.text) ? "통계 · 수치가 있는 문장" : "";
    if (reason) out.push({ ...s, reason });
    if (out.length >= max) break;
  }
  return out;
}

/** 표절 점검할 문장 (20자 이상, 인용 블록 · 직접 인용 "…" 따옴표 문장은 뺌) */
export function similarityCandidates(value) {
  return bodySentences(value).filter((s) => plainQuery(s.text).length >= 20 && !/^["“'‘].*["”'’][.?!]?$/.test(s.text));
}

/** 문장 끝 마침표 앞에 [@key] 넣기 → { from, to, text } (문장 글이 원고에서 그대로일 때만, 아니면 null) */
export function citeEdit(value, s, key) {
  const v = String(value ?? "");
  if (v.slice(s.from, s.to) !== s.text) return null;
  const m = s.text.match(/([.?!。])$/);
  const at = m ? s.to - 1 : s.to;
  const before = v.slice(s.from, at).replace(/\s+$/, "");
  const cut = s.from + before.length;
  return { from: cut, to: at, text: ` [@${key}]` };
}

/** 표절 점검 결과 고르기: overlap이 기준 이상인 것만, 높은 순 */
export function similarHits(cands, results, min = 0.35) {
  const out = [];
  cands.forEach((s, i) => {
    const best = (results[i] || []).reduce((a, h) => (!a || h.overlap > a.overlap ? h : a), null);
    if (best && best.overlap >= min) out.push({ ...s, hit: best });
  });
  return out.sort((a, b) => b.hit.overlap - a.hit.overlap);
}
