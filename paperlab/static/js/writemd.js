// 한글 원고의 굵게 · 기울임 (2026-10-26 사용자 지적: "굵게 · 기울임을 적용해도 미리보기에 안 보임")
// CommonMark의 강조 규칙(왼쪽 · 오른쪽 경계)은 닫는 ** 바로 앞이 문장 부호이고 뒤가 글자면 강조로 보지 않는다 →
// "**연구(2020)**에서" · "**"강조"**는" · "**A.**는" 처럼 한글 조사가 바로 붙는 흔한 경우가 ** 글자 그대로 남는다.
// 그래서 * 강조만 너그럽게 읽는 marked 확장을 먼저 건다: 여는 표시 뒤 · 닫는 표시 앞이 빈칸만 아니면 강조(한 줄 안).
// _ 강조는 그대로(낱말 속 _ 가 많아서). ***굵고 기울임*** 등 확장이 못 읽는 모양은 marked 기본 규칙으로 넘어간다.

const STRONG_RE = /^\*\*(?![\s*])([^\n]*?[^\s\\])\*\*(?!\*)/;
const EM_RE = /^\*(?![\s*])([^*\n]*?[^\s*\\])\*(?!\*)/;

export const lenientEmphasis = {
  name: "lenientEmphasis",
  level: "inline",
  start(src) {
    const i = src.indexOf("*");
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    let m = STRONG_RE.exec(src);
    if (m) return { type: "strong", raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
    m = EM_RE.exec(src);
    if (m) return { type: "em", raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
    return undefined;
  },
};

const installed = new WeakSet();
/** marked 에 한 번만 건다(전역 — 미리보기 · 내보내기 · AI 대화 글 모두 같은 규칙) */
export function useLenientEmphasis(marked) {
  if (!marked || installed.has(marked)) return;
  installed.add(marked);
  marked.use({ extensions: [lenientEmphasis] });
}

/** 굵게 · 기울임 감싸기: 고른 글 앞뒤 빈칸은 표시 밖에 둔다(Windows 두 번 클릭은 낱말 뒤 빈칸까지 골라 "**낱말 **"이 되면 강조가 안 됨) */
export function wrapParts(value, start, end, before, after, fallback = "글자") {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(value[s])) s++;
  while (e > s && /\s/.test(value[e - 1])) e--;
  const sel = value.slice(s, e) || fallback;
  return { start: s, end: e, text: before + sel + after, selStart: s + before.length, selEnd: s + before.length + sel.length };
}

// [확인 필요: 무엇 — 어디서] 표시 (2026-10-26 사용자 요청 — "눈에 띄게 색을 바꿔 나중에 확인하고 자료를 넣게"):
// 편집기(글자 뒤 강조 층 — writing.js checkLayer)와 미리보기에서 같은 규칙으로 찾는다. 제출 전 점검(writecheck.js)의 규칙과 같음
export const CHECK_RE = /\[확인\s*필요[^\]\n]*\]/g;
