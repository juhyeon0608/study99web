// 수정 내용 표시 원고 (2026-10-27 사용자 요청 — 워드 '변경 내용 추적'): 지난 버전 → 지금 원고를 줄 · 낱말 단위로 비교해
// 넣은 글 · 지운 글에 표시 문자를 붙인 마크다운을 만든다. 서버(writer.redline_docx)가 이 표시를 워드의 w:ins · w:del로 바꾼다.
// 표 줄 · 코드 블록 · 그림 줄은 표시하지 않고 지금 원고 그대로(지운 것은 빠짐)
import { wordDiff } from "./writeai.js";
import { lineDiff } from "./writehist.js";

export const INS_A = "";
export const INS_B = "";
export const DEL_A = "";
export const DEL_B = "";
export const MARK_RE = /[-]/g;

const PREFIX_RE = /^(\s{0,3}#{1,6}\s+|\s*(?:[-*+]|\d+[.)])\s+|\s*>\s?|표:\s*|Table:\s*)/;
const STRUCT_RE = /^\s{0,3}(\||```|~~~|!\[|\$\$|---\s*$|\[\^[^\]]+\]:)/;
const split = (line) => {
  const p = (line.match(PREFIX_RE) || [""])[0];
  return [p, line.slice(p.length)];
};
const wrapIns = (t) => (t.trim() ? `${INS_A}${t}${INS_B}` : t);
const wrapDel = (t) => (t.trim() ? `${DEL_A}${t}${DEL_B}` : t);

function markLine(line, ins) {
  if (!line.trim() || STRUCT_RE.test(line)) return ins ? line : null; // 지운 표 · 그림 줄은 뺌
  const [p, body] = split(line);
  return p + (ins ? wrapIns(body) : wrapDel(body));
}

// 같은 꼴의 줄(앞 기호가 같음) 하나를 낱말 단위로
function wordLine(oldLine, newLine) {
  const [p, a] = split(oldLine);
  const [q, b] = split(newLine);
  if (p.trim() !== q.trim() || STRUCT_RE.test(newLine) || STRUCT_RE.test(oldLine)) return null;
  return q + wordDiff(a, b, 400_000).map((o) => (o.op === "same" ? o.text : o.op === "ins" ? wrapIns(o.text) : wrapDel(o.text))).join("");
}

/** → { text: 표시가 든 마크다운, ins, del } (바뀐 낱말 · 줄 덩어리 수) */
export function redlineMarkdown(oldText, newText) {
  const ops = lineDiff(String(oldText ?? ""), String(newText ?? ""));
  const out = [];
  let ins = 0;
  let del = 0;
  for (let i = 0; i < ops.length;) {
    if (ops[i].op === "same") { out.push(ops[i].text); i++; continue; }
    const dels = [];
    const adds = [];
    while (i < ops.length && ops[i].op !== "same") (ops[i].op === "del" ? dels : adds).push(ops[i++].text);
    const pairs = dels.length === adds.length ? dels.map((d, k) => wordLine(d, adds[k])) : null;
    if (pairs && pairs.every((x) => x != null)) {
      out.push(...pairs);
    } else {
      for (const d of dels) { const m = markLine(d, false); if (m != null) out.push(m); }
      for (const a of adds) out.push(markLine(a, true));
    }
    ins += adds.length;
    del += dels.length;
  }
  return { text: out.join("\n"), ins, del };
}

/** 표시 문자를 모두 지운 글 (워드가 아닌 형식으로 내보낼 때) */
export const stripMarks = (s) => String(s ?? "").replace(MARK_RE, "");
