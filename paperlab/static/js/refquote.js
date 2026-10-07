// 원고에 넣는 인용 글 · 인용 표시 해석 (docs/specs/writing-reference-pane.md 8장 · 9.1 · 9.9절)
// DOM · 네트워크를 쓰지 않는다 — Node에서 그대로 시험한다(tests/js/refquote.test.mjs).
// 인용 표시 정규식 · parseCitation은 이 파일 한 곳에만 두고 writing.js가 가져다 쓴다(compose.py와 같은 규칙).

// U-1 사용자 결정(2026-10-08): APA 방식 — 짧으면 둥근 따옴표로 본문 안, blockWords 이상이면 인용 블록.
// 직접 인용 모양은 이 값 하나에서만 정한다(설정 창 없음 — RD-5)
export const QUOTE_STYLE = Object.freeze({ open: "\u201c", close: "\u201d", blockWords: 40 });

// 앞에 \가 붙은 [는 인용 표시가 아님(PDF 글 속 [@…]를 이스케이프해 넣은 것 — compose.py와 같은 규칙)
export const CITE_RE = /(?<!\\)\[(?=[^\[\]]*@)([^\[\]]{1,400})\]/g;
export const KEY_RE = /(-?)@([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&\-+?<>~/]*)/u;
export const LOCATOR_RE = /^\s*,?\s*(?:(p|pp|page|pages|쪽|면)\.?\s*)?([\divxlcIVXLC][\w\-–,\s]*?)\s*(쪽|면)?\s*$/;
const OA_RE = /^(?:https:\/\/openalex\.org\/)?W[1-9]\d{0,11}$/;

// ------------------------------------------------------------- 인용 표시 해석 (compose.py와 같은 규칙)
export function parseCitation(inner) {
  const items = [];
  for (const part of inner.split(";")) {
    const m = part.match(KEY_RE);
    if (!m) return null;
    const item = { key: m[2].replace(/[.,]+$/, ""), suppress_author: m[1] === "-" };
    const prefix = part.slice(0, m.index).trim();
    if (prefix) item.prefix = prefix;
    const rest = part.slice(m.index + m[0].length).trim();
    if (rest) {
      const lm = rest.match(LOCATOR_RE);
      if (lm && (lm[1] || lm[3] || /^\s*,?\s*\d/.test(rest))) {
        item.locator = lm[2].trim();
        item.label = "page";
      } else item.suffix = rest.replace(/^[,\s]+/, "");
    }
    items.push(item);
  }
  return items.length ? items : null;
}

// ------------------------------------------------------------- 넣는 글 (8장)
// 단어 수 = 공백으로 나눈 조각 수(상태 줄의 단어 수와 같은 셈 — 한국어는 어절)
export const wordCount = (s) => (String(s || "").match(/\S+/g) || []).length;

// 버튼 툴팁 {직접 인용 설명} (시안 10.1절) — 화면 문구는 이 값에서만 만든다
export const quoteRuleText = () => "원고 커서 자리에 직접 인용으로 넣어요. "
  + `짧으면 ${QUOTE_STYLE.open}…${QUOTE_STYLE.close}로 본문에, ${QUOTE_STYLE.blockWords}단어 이상이면 인용 블록으로 넣어요.`;

// 마크다운 특수 문자 \ * _ ` [ ] < 앞에 \ (PDF 글의 [12] · p < .05* 가 링크 · 굵게 · HTML로 바뀌지 않게 — 8.6절)
export const escapeMd = (s) => String(s).replace(/[\\*_`[\]<]/g, "\\$&");

// 인쇄 쪽 범위: pages가 "첫-끝"(하이픈 · en dash)이고 끝 − 첫 + 1 = PDF 쪽 수일 때만 (8.5절 · K-2). 아니면 null
export function printedRange(paper) {
  const m = String((paper && paper.pages) || "").trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!m) return null;
  const first = Number(m[1]);
  const last = Number(m[2]);
  return last >= first && last - first + 1 === Number(paper.page_count) ? { first, last } : null;
}

// PDF 쪽(1부터) 목록 → {loc: "p. 12" | "pp. 12–13", printed: 인쇄 쪽으로 바꿨는지}
export function pageLocator(paper, pdfPages) {
  const ps = [...pdfPages].map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ps.length) return { loc: "", printed: false };
  const r = printedRange(paper);
  const a = Math.min(...ps) + (r ? r.first - 1 : 0);
  const b = Math.max(...ps) + (r ? r.first - 1 : 0);
  return { loc: a === b ? `p. ${a}` : `pp. ${a}–${b}`, printed: !!r };
}

// PDF 막대 끝 "인용 쪽" 기준 (8.5절 3번 · 시안 5.1절)
export function basisText(paper) {
  const r = printedRange(paper);
  return r
    ? { text: `인용 쪽: 인쇄 쪽(${r.first}–${r.last})`, title: `논문의 쪽 범위(${r.first}–${r.last})가 PDF 쪽 수와 같아 인쇄된 쪽 번호로 넣어요` }
    : { text: "인용 쪽: PDF 쪽", title: "논문의 쪽 범위를 모르거나 PDF 쪽 수와 달라 PDF 쪽 번호로 넣어요" };
}

export const citeMark = (key, loc = "") => `[@${key}${loc ? `, ${loc}` : ""}]`;

// 직접 인용(PDF 문장 · 하이라이트 — 8.1 · 8.2절). 공백 · 줄바꿈은 한 칸으로. → {text, block}
export function directQuote(text, key, loc) {
  const body = escapeMd(String(text || "").replace(/\s+/g, " ").trim());
  if (wordCount(body) >= QUOTE_STYLE.blockWords) return { text: `> ${body} ${citeMark(key, loc)}`, block: true };
  return { text: `${QUOTE_STYLE.open}${body}${QUOTE_STYLE.close} ${citeMark(key, loc)}`, block: false };
}

// 내 글(하이라이트 메모 · 노트에서 고른 부분 — 8.3절): 따옴표 · 이스케이프 없이, 여러 줄이면 그대로
export const ownWords = (text, key, loc = "") => `${String(text || "").trim()} ${citeMark(key, loc)}`;

// 커서 앞 글(before) · 뒤 글(after)에 맞춘 띄어쓰기 · 문단 나누기 (8.6절)
// 본문 안: 앞 글자가 공백 · 줄바꿈 · ( · 문서 처음이 아니면 공백 한 칸.
// 블록: 앞 · 뒤와 빈 줄 하나로 나눔(이미 빈 줄이면 더 넣지 않음, 문서 끝이면 뒤에 빈 줄)
export function spaced(before, text, block = false, after = "") {
  if (block) {
    const pre = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const post = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    return `${pre}${text}${post}`;
  }
  return before && !/[\s(]$/.test(before) ? ` ${text}` : text;
}

// ------------------------------------------------------------- 추천 씨앗 (9.1 · 9.9절)
// 원고 인용 묶음(처음 나온 순서) → 서재 논문 id(중복 제거, 최대 max) · 인용한 서재 논문 수 · OpenAlex 번호 없는 수
export function manuscriptSeeds(clusters, papers, max = 200) {
  const byKey = new Map((papers || []).map((p) => [p.citekey, p]));
  const seen = new Set();
  const cited = [];
  for (const c of clusters || []) {
    for (const it of c.items || []) {
      const p = byKey.get(it.key);
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        cited.push(p);
      }
    }
  }
  const numbered = cited.filter((p) => OA_RE.test(String(p.openalex_id || "").trim()));
  return { ids: cited.slice(0, max).map((p) => p.id), cited: cited.length, numbered: numbered.length,
    missing: cited.length - numbered.length };
}

// 씨앗 목록 문자열(정렬한 논문 id) — 원고 인용이 바뀌었는지 비교
export const seedSignature = (ids) => [...ids].map(Number).sort((a, b) => a - b).join(",");
