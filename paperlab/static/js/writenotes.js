// 논문 쓰기 각주 (docs/specs/export-lists-footnotes.md): 마크다운 각주 본문[^1] + 정의 줄 "[^1]: 내용" 읽기,
// [각주] 버튼 · Ctrl+Alt+F가 넣는 다음 번호 · 정의 줄 자리 고르기.
// DOM · 네트워크를 쓰지 않는 순수 함수 — Node에서 그대로 시험한다(tests/js/writenotes.test.mjs).
//
// 규칙 (Pandoc · GitHub 각주와 같게)
// - 정의 줄: 줄 맨 앞(공백 3칸까지) "[^이름]: 내용". 바로 아래 2칸 이상 들여쓴 줄은 같은 각주의 이어지는 글
// - 본문의 [^이름]마다 각주 하나(같은 이름을 두 번 쓰면 같은 내용의 각주가 두 번). 번호는 본문에 나온 순서대로
//   (정의 줄의 이름 · 순서와 상관없음 — 워드 · 한글도 각주 번호를 순서대로 매긴다)
// - 정의가 없는 [^이름]은 글자 그대로 둔다(missing). 코드 블록(``` · ~~~) · `코드` 안은 각주가 아니다
// - 각주 안의 각주는 만들지 않는다(정의 글의 [^이름]은 글자 그대로)

import { diffEdit, inFence } from "./writeedit.js";

export const FN_OPEN = ""; // 본문 안 각주 자리표시: FN_OPEN + 순번 + FN_CLOSE (인용 자리표시  · 과 따로)
export const FN_CLOSE = "";
const DEF_RE = /^ {0,3}\[\^([^\]\s]+)\]:[ \t]?(.*)$/;
const CONT_RE = /^(?: {2,}|\t)\S/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
// `코드` 덩어리는 그대로 두고 그 밖의 [^이름]만 (앞에 \가 있으면 글자)
const REF_OR_CODE_RE = /(`+)[\s\S]*?\1|(?<!\\)\[\^([^\]\s]+)\]/g;
const BIB_MARKERS = ["[참고문헌]", "[References]", "[Bibliography]", "[REFERENCES]"];

// 원고 → { text: 정의 줄을 빼고 [^이름]을 자리표시로 바꾼 글, notes: [{ id, text }] (자리표시 순번 = 배열 번호),
//          missing: 정의 없는 이름들, unused: 본문에서 안 쓴 정의 이름들 }
export function extractFootnotes(value) {
  const lines = String(value ?? "").split("\n");
  const defs = new Map();
  const body = [];
  let fence = null;
  let cur = null; // 이어지는 글을 붙일 정의 이름 (같은 이름 두 번째 정의는 "" — 이어지는 글도 버림)
  for (const line of lines) {
    const f = FENCE_RE.exec(line);
    if (fence) {
      body.push(line);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !/\S/.test(line.slice(line.indexOf(f[1]) + f[1].length))) fence = null;
      continue;
    }
    if (f) { fence = f[1]; cur = null; body.push(line); continue; }
    const d = DEF_RE.exec(line);
    if (d) {
      if (defs.has(d[1])) cur = "";
      else { defs.set(d[1], d[2].trim()); cur = d[1]; }
      continue;
    }
    if (cur !== null && CONT_RE.test(line)) {
      if (cur) defs.set(cur, `${defs.get(cur)} ${line.trim()}`.trim());
      continue;
    }
    cur = null;
    body.push(line);
  }
  const notes = [];
  const missing = new Set();
  const used = new Set();
  fence = null;
  const text = body.map((line) => {
    const f = FENCE_RE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      return line;
    }
    if (f) { fence = f[1]; return line; }
    return line.replace(REF_OR_CODE_RE, (raw, code, id) => {
      if (code || !id) return raw;
      if (!defs.has(id)) { missing.add(id); return raw; }
      used.add(id);
      notes.push({ id, text: defs.get(id) });
      return `${FN_OPEN}${notes.length - 1}${FN_CLOSE}`;
    });
  }).join("\n");
  return { text, notes, missing: [...missing], unused: [...defs.keys()].filter((k) => !used.has(k)) };
}

// 자리표시가 든 글 → ["글", { note: 순번 }, "글", …]
export function splitNotes(s) {
  const out = [];
  const re = new RegExp(`${FN_OPEN}(\\d+)${FN_CLOSE}`, "g");
  let last = 0;
  for (const m of String(s).matchAll(re)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    out.push({ note: Number(m[1]) });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

// 다음 각주 번호: 원고에 쓴 숫자 이름([^3] · [^3]:) 중 가장 큰 것 + 1
export function nextFootnoteId(value) {
  let max = 0;
  for (const m of String(value ?? "").matchAll(/\[\^(\d{1,6})\]/g)) max = Math.max(max, Number(m[1]));
  return max + 1;
}

const lineStartAt = (value, pos) => value.lastIndexOf("\n", pos - 1) + 1;
const isBlank = (l) => !/\S/.test(l);
// i번째 줄이 정의 줄이거나 정의 줄에 이어지는 들여쓴 줄인지
function inDefinition(lines, i) {
  let k = i;
  while (k > 0 && CONT_RE.test(lines[k])) k--;
  return DEF_RE.test(lines[k]);
}

// [각주] 버튼 · Ctrl+Alt+F: 선택 끝(커서)에 "[^N]"을 넣고, 지금 장 · 절(다음 # 제목 줄 앞)의 마지막 글 뒤에
// 정의 줄 "[^N]: "을 넣은 뒤 그 뒤로 커서를 옮긴다(바로 내용을 쓰게). 이미 정의 줄들이 모여 있으면 그 아래 줄에 잇는다.
// 장 · 절 끝이 [참고문헌] 자리면 그 앞에 둔다. 코드 블록 · 정의 줄 안에서는 null(넣지 않음)
export function footnoteInsert(value, start, end) {
  const v = String(value ?? "");
  const at = Math.max(start, end);
  if (inFence(v, at)) return null;
  const lines = v.split("\n");
  const starts = [];
  let pos = 0;
  for (const l of lines) { starts.push(pos); pos += l.length + 1; }
  const row = v.slice(0, lineStartAt(v, at)).split("\n").length - 1;
  if (inDefinition(lines, row)) return null;
  let stop = lines.length;
  let fence = false;
  for (let i = row + 1; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) fence = !fence;
    else if (!fence && /^#{1,6}\s/.test(lines[i])) { stop = i; break; }
  }
  let last = stop - 1;
  while (last > row && isBlank(lines[last])) last--;
  if (BIB_MARKERS.includes(lines[last].trim()) && last > row) {
    let k = last - 1;
    while (k > row && isBlank(lines[k])) k--;
    last = k;
  }
  const id = nextFootnoteId(v);
  const ref = `[^${id}]`;
  const defAt = starts[last] + lines[last].length;
  const def = `${inDefinition(lines, last) ? "\n" : "\n\n"}[^${id}]: `;
  const after = v.slice(0, at) + ref + v.slice(at, defAt) + def + v.slice(defAt);
  const caret = defAt + ref.length + def.length;
  return diffEdit(v, after, caret, caret);
}
