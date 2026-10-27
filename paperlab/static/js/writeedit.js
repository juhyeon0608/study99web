// 논문 쓰기 편집 도우미 (docs/specs/writing-figures-tables.md): 글머리 · 번호 목록(Enter · Backspace · Tab),
// 표 마크다운 읽기 · 쓰기, 그림 · 표 캡션과 자동 번호, 상호 참조(@fig:이름 · @tbl:이름), 단축키 도움말 자료.
// DOM · 네트워크를 쓰지 않는 순수 함수 — Node에서 그대로 시험한다(tests/js/writeedit.test.mjs).
//
// 편집 함수는 바꿀 범위 하나를 돌려준다: { from, to, text, selStart, selEnd } (원래 값 기준 from~to를 text로 바꾸고
// 바뀐 값 기준 selStart~selEnd를 선택). 바꿀 게 없으면 null — 부른 쪽이 브라우저 기본 동작을 그대로 둔다.

// ------------------------------------------------------------- 목록
// 들여쓰기 · 기호(- * + 또는 1. 1)) · 띄움 · 내용. "---"(쪽 나눔) · "**굵게**"는 목록이 아님(기호 뒤 공백 필수)
const LIST_RE = /^( *)([-*+]|\d{1,9}[.)])( +)(.*)$/;
const BLANK_RE = /^\s*$/;

export function parseListLine(line) {
  const m = LIST_RE.exec(line);
  if (!m) return null;
  const ordered = /\d/.test(m[2]);
  return {
    indent: m[1].length, marker: m[2], gap: m[3], content: m[4], ordered,
    num: ordered ? Number.parseInt(m[2], 10) : 0, delim: ordered ? m[2].slice(-1) : "",
    contentCol: m[1].length + m[2].length + m[3].length,
  };
}

const lineStartAt = (value, pos) => value.lastIndexOf("\n", pos - 1) + 1;
const lineEndAt = (value, pos) => { const e = value.indexOf("\n", pos); return e === -1 ? value.length : e; };

// 두 값의 다른 부분 하나 → 바꿀 범위 (실행 취소 한 번에 되돌아가게 한 덩어리로)
export function diffEdit(before, after, selStart, selEnd) {
  if (before === after) return null;
  let a = 0;
  const max = Math.min(before.length, after.length);
  while (a < max && before[a] === after[a]) a++;
  let b = 0;
  while (b < max - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
  return { from: a, to: before.length - b, text: after.slice(a, after.length - b), selStart, selEnd };
}

export function applyEditToValue(value, edit) {
  return value.slice(0, edit.from) + edit.text + value.slice(edit.to);
}

// 번호 목록 다시 매기기: pos가 있는 목록 덩어리(빈 줄로 끊긴 연속 줄)에서 같은 단계 번호를 1씩 늘린다.
// 덩어리 첫 항목의 번호(예: 3.)는 그대로 시작 번호로 둔다
export function renumberAround(value, pos) {
  const lines = value.split("\n");
  let idx = value.slice(0, pos).split("\n").length - 1;
  // 빈 줄 없이 이어진 줄은 한 덩어리 (목록 뒤 들여쓰지 않은 글은 마크다운에서 앞 항목에 이어지는 글). 제목 · 표 · 인용 · 코드는 끊음
  const inBlock = (l) => !BLANK_RE.test(l) && !/^\s{0,3}(#{1,6}\s|```|~~~|\||>)/.test(l);
  if (!inBlock(lines[idx] ?? "") || !lines.some((l) => parseListLine(l))) return value;
  let a = idx;
  while (a > 0 && inBlock(lines[a - 1])) a--;
  let b = idx;
  while (b < lines.length - 1 && inBlock(lines[b + 1])) b++;
  const levels = new Map(); // 들여쓰기 → { ordered, n }
  let changed = false;
  for (let i = a; i <= b; i++) {
    const it = parseListLine(lines[i]);
    if (!it) continue;
    for (const k of [...levels.keys()]) if (k > it.indent) levels.delete(k);
    const prev = levels.get(it.indent);
    if (!it.ordered) { levels.set(it.indent, { ordered: false }); continue; }
    // 같은 단계 앞 항목 + 1. 하위 목록의 첫 항목 · 글머리 뒤 새 번호 목록은 1, 덩어리 맨 바깥 첫 항목은 적힌 번호(예: 3.)부터
    const nested = [...levels.keys()].some((k) => k < it.indent);
    const n = prev && prev.ordered ? prev.n + 1 : nested || prev ? 1 : it.num;
    levels.set(it.indent, { ordered: true, n });
    if (n !== it.num) {
      lines[i] = " ".repeat(it.indent) + n + it.delim + it.gap + it.content;
      changed = true;
    }
  }
  return changed ? lines.join("\n") : value;
}

// 줄 수가 같은 두 값 사이에서 위치 옮기기: 같은 줄, 그 줄에서 처음 달라진 곳 뒤면 길이 차이만큼
export function mapLinewise(before, after, pos) {
  const L = before.slice(0, pos).split("\n").length - 1;
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const o = oldLines[L] ?? "";
  const n = newLines[L] ?? "";
  const col = pos - lineStartAt(before, pos);
  let k = 0;
  while (k < o.length && k < n.length && o[k] === n[k]) k++;
  const c = col <= k ? col : Math.max(k, col + n.length - o.length);
  const start = newLines.slice(0, L).reduce((s, l) => s + l.length + 1, 0);
  return start + Math.max(0, Math.min(c, n.length));
}

function finish(value, after, selStart, selEnd) {
  if (inFence(after, selStart)) return diffEdit(value, after, selStart, selEnd); // 코드 안 번호는 고치지 않는다
  let renum = renumberAround(after, selStart);
  const next = lineEndAt(renum, mapLinewise(after, renum, selEnd)) + 1; // 바꾼 줄 다음 덩어리도 (목록을 끈 줄 뒤 번호)
  if (next < renum.length) renum = renumberAround(renum, next);
  if (renum !== after) return diffEdit(value, renum, mapLinewise(after, renum, selStart), mapLinewise(after, renum, selEnd));
  return diffEdit(value, after, selStart, selEnd);
}

// pos가 코드 블록(``` · ~~~ 울타리) 안인지 — 그 안의 "- x" 같은 줄은 목록이 아니라 코드 글자다
export function inFence(value, pos) {
  let fence = null;
  for (const l of value.slice(0, lineStartAt(value, pos)).split("\n")) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (!m) continue;
    if (!fence) fence = m[1];
    else if (m[1][0] === fence[0] && m[1].length >= fence.length && !/\S/.test(l.slice(l.indexOf(m[1]) + m[1].length))) fence = null;
  }
  return fence !== null;
}

// Enter: 목록 항목이면 다음 항목 기호를 붙인다. 빈 항목에서 누르면 한 단계 내어쓰기, 맨 바깥이면 목록 끝내기
export function enterEdit(value, start, end) {
  if (start !== end || inFence(value, start)) return null;
  const ls = lineStartAt(value, start);
  const le = lineEndAt(value, start);
  const it = parseListLine(value.slice(ls, le));
  if (!it || start < ls + it.contentCol) return null;
  if (!it.content.trim()) {
    if (it.indent > 0) return indentEdit(value, start, end, true);
    const after = value.slice(0, ls) + value.slice(le);
    return finish(value, after, ls, ls);
  }
  const marker = it.ordered ? `${it.num + 1}${it.delim}` : it.marker;
  const ins = `\n${" ".repeat(it.indent)}${marker} `;
  const after = value.slice(0, start) + ins + value.slice(start);
  return finish(value, after, start + ins.length, start + ins.length);
}

// Backspace: 기호 바로 뒤(내용 맨 앞)에서 누르면 들여쓴 항목은 내어쓰고, 맨 바깥 항목은 기호만 지운다
export function backspaceEdit(value, start, end) {
  if (start !== end || inFence(value, start)) return null;
  const ls = lineStartAt(value, start);
  const it = parseListLine(value.slice(ls, lineEndAt(value, start)));
  if (!it || start !== ls + it.contentCol) return null;
  if (it.indent > 0) return indentEdit(value, start, end, true);
  const after = value.slice(0, ls) + value.slice(ls + it.contentCol);
  return finish(value, after, ls, ls);
}

// Tab · Shift+Tab: 선택한 줄(과 마지막 줄의 하위 항목)을 함께 들여쓰기 · 내어쓰기.
// 목록 항목은 위 형제 항목의 내용 위치까지 들여써서 마크다운에서 실제로 하위 목록이 되게 한다(첫 항목은 하위가 될 수 없음).
// 목록이 아닌 한 줄에서 Tab은 null(부른 쪽이 공백 2칸), Shift+Tab은 앞 공백을 2칸까지 지운다
export function indentEdit(value, start, end, outdent) {
  const lines = value.split("\n");
  const first = value.slice(0, start).split("\n").length - 1;
  let last = value.slice(0, end).split("\n").length - 1;
  if (last > first && end === lineStartAt(value, end)) last--; // 다음 줄 맨 앞까지 고른 선택은 그 줄을 빼고
  const items = [];
  // 코드 블록 안에서는 목록 규칙 없이 공백만 넣고 뺀다
  if (!inFence(value, start)) for (let i = first; i <= last; i++) if (parseListLine(lines[i])) items.push(i);
  let delta;
  if (items.length) {
    const i0 = items[0];
    const cur = parseListLine(lines[i0]);
    if (!outdent) {
      let sib = null;
      for (let j = i0 - 1; j >= 0; j--) {
        if (BLANK_RE.test(lines[j])) continue;
        const p = parseListLine(lines[j]);
        if (!p) { if (/^ +\S/.test(lines[j])) continue; break; }
        if (p.indent < cur.indent) break;
        if (p.indent === cur.indent) { sib = p; break; }
      }
      if (!sib) return null;
      delta = sib.contentCol - cur.indent;
    } else {
      let parent = null;
      for (let j = i0 - 1; j >= 0; j--) {
        if (BLANK_RE.test(lines[j])) continue;
        const p = parseListLine(lines[j]);
        if (!p) { if (/^ +\S/.test(lines[j])) continue; break; }
        if (p.indent < cur.indent) { parent = p; break; }
      }
      delta = (parent ? parent.indent : 0) - cur.indent;
      if (!delta) return null;
    }
  } else {
    if (!outdent && first === last) return null;
    delta = outdent ? -2 : 2;
  }
  // 마지막으로 고른 목록 줄의 하위 줄(더 들여쓴 연속 줄)도 같이 옮긴다
  let stop = last;
  const lastItem = items.length ? parseListLine(lines[items[items.length - 1]]) : null;
  if (lastItem) {
    while (stop + 1 < lines.length && !BLANK_RE.test(lines[stop + 1])
      && (lines[stop + 1].match(/^ */)[0].length > lastItem.indent)) stop++;
  }
  for (let i = first; i <= stop; i++) {
    const lead = lines[i].match(/^ */)[0].length;
    const d = BLANK_RE.test(lines[i]) ? 0 : Math.max(-lead, delta);
    lines[i] = d >= 0 ? " ".repeat(d) + lines[i] : lines[i].slice(-d);
  }
  const after = lines.join("\n");
  const selStart = mapLinewise(value, after, start);
  return finish(value, after, selStart, start === end ? selStart : mapLinewise(value, after, end));
}

// 글머리(ordered=false) · 번호(true) 목록 켜고 끄기: 고른 줄이 모두 그 목록이면 기호를 지우고, 아니면 붙인다
export function toggleListEdit(value, start, end, ordered) {
  const ls = lineStartAt(value, start);
  let le = lineEndAt(value, end > start && end === lineStartAt(value, end) ? end - 1 : end);
  if (le < ls) le = lineEndAt(value, ls);
  const lines = value.slice(ls, le).split("\n");
  const used = lines.filter((l) => !BLANK_RE.test(l));
  const all = used.length > 0 && used.every((l) => { const p = parseListLine(l); return p && p.ordered === ordered; });
  let n = 0;
  const out = lines.map((l) => {
    const p = parseListLine(l);
    if (all) return p ? p.content : l;
    if (BLANK_RE.test(l) && lines.length > 1) return l;
    const indent = p ? " ".repeat(p.indent) : l.match(/^ */)[0].length >= 4 ? "" : l.match(/^ */)[0];
    const body = p ? p.content : l.replace(/^ +/, "").replace(/^(#{1,6}\s|>\s?)/, "");
    n++;
    return `${indent}${ordered ? `${n}.` : "-"} ${body}`;
  });
  const text = out.join("\n");
  const after = value.slice(0, ls) + text + value.slice(le);
  if (start === end) {
    // 빈 줄에서 켜면 기호 뒤로, 내용이 있으면 같은 글자 앞에 커서를 둔다
    const caret = BLANK_RE.test(lines[0]) && lines.length === 1 ? ls + text.length : mapLinewise(value, after, start);
    return finish(value, after, caret, caret);
  }
  return finish(value, after, ls, ls + text.length);
}

// ------------------------------------------------------------- 그림 · 표 마크다운
// 워드(python-docx)가 읽는 JPEG인지: 6번째 바이트부터 "JFIF" 또는 "Exif" 머리글이 있어야 한다.
// 어도비 프로그램이 만든 XMP 먼저 · CMYK(APP14) · ICC 먼저인 JPEG는 아니어서 브라우저에서 JPEG로 다시 저장해 올린다
export function jpegNeedsReencode(head) {
  const b = head instanceof Uint8Array ? head : new Uint8Array(head || []);
  if (b.length < 10 || b[0] !== 0xff || b[1] !== 0xd8) return false;
  const tag = String.fromCharCode(...b.slice(6, 10));
  return tag !== "JFIF" && tag !== "Exif";
}

export const FIG_NAME_RE = /^[0-9a-f]{16}\.(?:png|jpg|gif)$/;
const LABEL = "[\\p{L}\\p{N}_-]+";
// 그림 문단: ![캡션](fig:이름){#fig:꼬리표} — 한 문단에 이것만 있을 때 그림으로 본다
const FIG_LINE_RE = new RegExp(`^!\\[((?:\\\\.|[^\\]\\\\])*)\\]\\(fig:([0-9a-f]{16}\\.(?:png|jpg|gif))\\)\\s*(?:\\{#(fig:${LABEL})\\})?\\s*$`, "u");
// 표 캡션: 표 바로 위(또는 아래) 한 줄 "표: 캡션 {#tbl:꼬리표}" (영문 "Table: …")
const CAPTION_RE = new RegExp(`^(?:표|Table)\\s*[:：]\\s*(.*?)\\s*(?:\\{#(tbl:${LABEL})\\})?\\s*$`, "u");
export const XREF_RE = new RegExp(`(?<![\\p{L}\\p{N}_@])@((?:fig|tbl|eq):${LABEL})`, "gu");

export function figureInfo(text) {
  const m = FIG_LINE_RE.exec(String(text || "").trim());
  return m ? { alt: m[1].replace(/\\([\\\]\[])/g, "$1"), src: m[2], label: m[3] || "" } : null;
}

export function captionInfo(text) {
  const t = String(text || "").trim();
  if (t.includes("\n")) return null;
  const m = CAPTION_RE.exec(t);
  return m ? { text: m[1], label: m[2] || "" } : null;
}

export const figureMarkdown = (name, caption) => `![${String(caption || "").replace(/[\\\]\[]/g, "\\$&")}](fig:${name})`;

// 번호 붙은 캡션 머리말 · 상호 참조 글자 (한글 원고면 "그림 1." · "표 1.", 아니면 "Figure 1." · "Table 1.")
export function captionLabel(kind, n, ko = true) {
  const name = kind === "fig" ? (ko ? "그림" : "Figure") : (ko ? "표" : "Table");
  return `${name} ${n}.`;
}
export const xrefText = (kind, n, ko = true) => (kind === "eq" ? `${ko ? "식" : "Eq."} (${n})` : captionLabel(kind, n, ko).slice(0, -1));

// 글 → [글자 | {xref: "fig:이름"}] (상호 참조 자리를 따로 떼어 둔다)
export function splitXrefs(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(XREF_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ xref: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// 블록들의 상호 참조 런({xref})을 "그림 2" · "표 1"로 채운다. 없는 꼬리표는 "@fig:x?"(warn)
export function resolveXrefs(blocks, labels, ko = true) {
  const fix = (runs) => {
    for (const r of runs || []) {
      if (r && r.footnote) fix(r.footnote);
      if (!r || !r.xref) continue;
      const hit = labels.get(r.xref);
      if (hit) r.text = xrefText(hit.kind, hit.n, ko);
      else { r.text = `@${r.xref}?`; r.warn = true; }
    }
  };
  for (const b of blocks) {
    fix(b.runs);
    fix(b.caption);
    for (const row of b.rows || []) for (const cell of row) fix(cell);
  }
  return blocks;
}

// 표 한 줄 "| a | b \| c |" → ["a", "b | c"] (\| 는 칸 안의 | 글자)
export function splitRow(line) {
  let s = String(line).trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (s[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const SEP_CELL_RE = /^:?-{1,}:?$/;
const hasPipe = (l) => /(^|[^\\])\|/.test(l);
// GFM: 머리글 줄은 | 가 있으면 되고(앞 | 없어도 됨), 구분선 칸 수가 머리글 칸 수와 같아야 표 (marked와 같은 규칙)
const isSepLine = (l, cols) => /^\s{0,3}\S/.test(l) && /-/.test(l) && /^[\s|:-]+$/.test(l) && (hasPipe(l) || cols === 1)
  && splitRow(l).every((c) => SEP_CELL_RE.test(c.replace(/\s+/g, ""))) && splitRow(l).length === cols;
// 표 몸통은 빈 줄이나 다른 블록(제목 · 인용 · 코드 울타리 · 목록 · 가로줄)이 나올 때까지
const endsTable = (l) => BLANK_RE.test(l) || /^\s{0,3}(#{1,6}(\s|$)|>|```|~~~|[*+-] |1[.)] |([-*_])(\s*\3){2,}\s*$)/.test(l);
const alignOf = (c) => { const s = c.replace(/\s+/g, ""); return s.startsWith(":") && s.endsWith(":") ? "center" : s.endsWith(":") ? "right" : s.startsWith(":") ? "left" : null; };

// 줄 i(머리글)~j-1(마지막 줄)을 표 하나로 → { from, to, rows, align, caption … }. 바로 위(빈 줄 하나까지)의 캡션 줄을 붙인다
function tableFromLines(lines, starts, i, j) {
  const header = splitRow(lines[i]);
  const cols = header.length;
  const rows = [header, ...lines.slice(i + 2, j).map((l) => splitRow(l))]
    .map((r) => Array.from({ length: Math.max(cols, 1) }, (_, k) => (r[k] ?? "").replace(BR_RE, "\n")));
  const t = { from: starts[i], to: starts[j - 1] + lines[j - 1].length, rows, align: splitRow(lines[i + 1]).map(alignOf), caption: "", label: "",
    captionFrom: null, captionTo: null };
  for (const k of [i - 1, i - 2]) {
    if (k < 0) break;
    const cap = captionInfo(lines[k]);
    if (cap) { Object.assign(t, { caption: cap.text, label: cap.label, captionFrom: starts[k], captionTo: starts[k] + lines[k].length }); break; }
    if (!BLANK_RE.test(lines[k])) break;
  }
  return t;
}

// 줄로 찾기 (marked가 없을 때): 코드 블록(```) 안은 빼고 GFM 규칙대로
function findTablesByLines(lines, starts) {
  const out = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{0,3}(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
    if (fence || !hasPipe(lines[i]) || BLANK_RE.test(lines[i]) || /^\s{4}/.test(lines[i])) continue;
    if (!isSepLine(lines[i + 1] ?? "", splitRow(lines[i]).length)) continue;
    let j = i + 2;
    while (j < lines.length && !endsTable(lines[j])) j++;
    out.push(tableFromLines(lines, starts, i, j));
    i = j - 1;
  }
  return out;
}

// 원고 안의 표를 순서대로. 미리보기(marked의 맨 바깥 표 토큰 순서로 번호)와 n번째가 같은 표가 되도록
// lexer(marked.lexer)가 있으면 그 표 토큰 위치를 쓰고, 없거나 위치를 못 맞추면 줄 규칙으로 찾는다
export function findTables(value, lexer = globalThis.marked && globalThis.marked.lexer) {
  const lines = value.split("\n");
  const starts = [];
  let pos = 0;
  for (const l of lines) { starts.push(pos); pos += l.length + 1; }
  if (typeof lexer !== "function") return findTablesByLines(lines, starts);
  let toks;
  try { toks = lexer(value); } catch { return findTablesByLines(lines, starts); }
  const out = [];
  let cursor = 0;
  for (const t of toks) {
    const raw = String(t.raw || "");
    if (!raw) continue;
    const at = value.indexOf(raw, cursor);
    if (at < 0) {
      if (t.type === "table") return findTablesByLines(lines, starts);
      continue;
    }
    cursor = at + raw.length;
    if (t.type !== "table") continue;
    const i = value.slice(0, at).split("\n").length - 1;
    const j = value.slice(0, at + raw.replace(/\n+$/, "").length).split("\n").length; // 마지막 줄 다음
    if (starts[i] !== at || j - i < 2) return findTablesByLines(lines, starts);
    out.push(tableFromLines(lines, starts, i, j));
  }
  return out;
}

// 원고 안의 그림 문단(앞뒤가 빈 줄인 ![캡션](fig:…) 한 줄)을 순서대로 → [{ from, to, altFrom, altTo, src }]
// (미리보기의 n번째 그림을 누르면 편집기에서 그 캡션 글을 고른다)
export function findFigures(value) {
  const lines = value.split("\n");
  const out = [];
  let pos = 0;
  let fence = false;
  lines.forEach((l, i) => {
    const start = pos;
    pos += l.length + 1;
    if (/^\s{0,3}(```|~~~)/.test(l)) { fence = !fence; return; }
    const prevOk = i === 0 || BLANK_RE.test(lines[i - 1]) || /^#{1,6}\s/.test(lines[i - 1]);
    const nextOk = i === lines.length - 1 || BLANK_RE.test(lines[i + 1]);
    const f = !fence && prevOk && nextOk ? figureInfo(l) : null;
    if (!f) return;
    const lead = l.length - l.trimStart().length;
    const close = l.indexOf("](fig:");
    out.push({ from: start, to: start + l.length, altFrom: start + lead + 2, altTo: start + close, src: f.src });
  });
  return out;
}

export function tableAt(value, pos) {
  return findTables(value).find((t) => (pos >= t.from && pos <= t.to) || (t.captionFrom != null && pos >= t.captionFrom && pos <= t.to)) || null;
}

// 칸 안 줄바꿈(표 창 Shift+Enter)은 <br>로 — 마크다운 표 칸은 한 줄 (2026-10-26 사용자 요청)
const cellText = (s) => String(s ?? "").trim().replace(/[ \t]*\r?\n[ \t]*/g, "<br>").replace(/\|/g, "\\|");
export const BR_RE = /<br\s*\/?>/gi;

// { rows: [[칸…]…](첫 줄 = 머리글), align, caption, label } → 마크다운 (캡션 줄 + 빈 줄 없이 표)
export function tableMarkdown({ rows, align = [], caption = "", label = "" }, ko = true) {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const row = (r) => `| ${Array.from({ length: cols }, (_, k) => cellText(r[k]) || " ").join(" | ")} |`;
  const sep = Array.from({ length: cols }, (_, k) => ({ left: ":--", center: ":-:", right: "--:" }[align[k]] || "---"));
  const head = caption || label ? `${ko ? "표" : "Table"}: ${String(caption).replace(/\n/g, " ").trim()}${label ? ` {#${label}}` : ""}\n` : "";
  return head + [row(rows[0] || []), `| ${sep.join(" | ")} |`, ...rows.slice(1).map(row)].join("\n");
}

export function newTable(nRows, nCols, ko = true) {
  const r = Math.min(50, Math.max(1, nRows | 0));
  const c = Math.min(12, Math.max(1, nCols | 0));
  const head = Array.from({ length: c }, (_, k) => (ko ? `제목${k + 1}` : `Header ${k + 1}`));
  return { rows: [head, ...Array.from({ length: r - 1 }, () => Array(c).fill(""))], align: Array(c).fill(null), caption: "", label: "" };
}

// 커서 자리에 문단 하나(그림 · 표)를 넣을 때 앞뒤를 빈 줄로 띄운다. select = 넣는 글 안에서 고를 [시작, 끝]
// 커서가 줄 가운데에 있으면(선택 없음) 문장을 가르지 않게 그 줄 끝 뒤에 넣는다
export function blockInsert(value, start, end, text, select = null) {
  if (start === end && start !== lineStartAt(value, start)) start = end = lineEndAt(value, start);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const pre = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const post = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const base = start + pre.length;
  const [s, e] = select || [text.length, text.length];
  return { from: start, to: end, text: pre + text + post, selStart: base + s, selEnd: base + e };
}

// ------------------------------------------------------------- 장 · 절 번호
// 장 · 절 버튼이 '## 제4장 ' · '### 제2절 '처럼 다음 번호를 붙이고, 그 뒤 번호를 다시 매긴다 (2026-10-17 사용자 요청).
// '## 제N장 …' · '### 제N절 …' 꼴의 제목만 센다 — '## 국문초록' 같은 번호 없는 제목은 그대로. 절은 장(## 제목)마다 1부터.
// 코드 블록(``` · ~~~) 안의 줄은 제목이 아니다
const CH_NUM_RE = /^##\s+제\s*\d+\s*장(?=\s|$)/;
const SEC_NUM_RE = /^###\s+제\s*\d+\s*절(?=\s|$)/;

export function renumberHeadings(value) {
  const lines = value.split("\n");
  let ch = 0;
  let sec = 0;
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    if (/^##\s/.test(l)) {
      sec = 0;
      if (CH_NUM_RE.test(l)) lines[i] = l.replace(CH_NUM_RE, `## 제${++ch}장`);
    } else if (SEC_NUM_RE.test(l)) {
      lines[i] = l.replace(SEC_NUM_RE, `### 제${++sec}절`);
    }
  }
  return lines.join("\n");
}

// 장(level 2) · 절(level 3) 버튼: 커서 줄을 번호 붙은 제목으로(이미 그 단계 제목이면 제목 끄기) → 번호 다시 매기기 → 편집 한 덩어리
export function headingEdit(value, start, level) {
  const ls = lineStartAt(value, start);
  const le = lineEndAt(value, ls);
  const line = value.slice(ls, le);
  const hashes = level === 2 ? "##" : "###";
  const word = level === 2 ? "장" : "절";
  const own = new RegExp(`^${hashes}(?:\\s+제\\s*\\d+\\s*${word})?(?:\\s+|$)`);
  const on = line.startsWith(hashes + " ") || line === hashes;
  const body = on ? line.replace(own, "")
    : line.replace(/^(?:#{1,6}\s+(?:제\s*\d+\s*[장절](?:\s+|$))?|[-*+]\s+|\d+[.)]\s+|>\s?)/, "");
  const next = on ? body : `${hashes} 제0${word} ${body}`; // 번호(0)는 다시 매기기가 채움
  const after = renumberHeadings(value.slice(0, ls) + next + value.slice(le));
  const row = value.slice(0, ls).split("\n").length - 1; // 앞 줄 번호가 바뀌어도 같은 줄을 찾게 줄 번호로
  const nls = after.split("\n").slice(0, row).reduce((n, l) => n + l.length + 1, 0);
  const caret = lineEndAt(after, nls);
  return diffEdit(value, after, caret, caret) || { from: caret, to: caret, text: "", selStart: caret, selEnd: caret };
}

// ------------------------------------------------------------- AI에 보낼 범위 (docs/specs/manuscript-ai-chat.md)
// 2026-10-17 사용자 지적 "ai 보내는 범위가 좀 이상한": 예전에는 빈 줄 사이 글을 통째로 보내 제목 · 표 · 그림 줄이 섞였다.
// 원고를 덩어리(블록)로 나눠 진짜 문단만 보낸다. 제목(#) · 표(|) · 그림(![…](fig:…)) · 표 캡션(표: …) · 코드 블록 ·
// 각주 정의([^1]: …) · 가로줄 · [참고문헌] 줄은 문단이 아니고, 목록은 통째로 한 덩어리(빈 줄로 띄운 느슨한 목록도).
// 절 = 지금 '### ' 제목 다음 줄부터 다음 ###(이하 단계) 제목 전까지, 장 = 지금 '## ' 제목 다음 줄부터 다음 ## 제목 전까지
const HEAD_RE = /^ {0,3}(#{1,6})(?=\s|$)(.*)$/;
const FOOTDEF_RE = /^ {0,3}\[\^[^\]\s]+\]:/;
const BIB_LINE_RE = /^\s*\[(?:참고문헌|References|Bibliography|REFERENCES)\]\s*$/;
const HR_RE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const fenceOf = (l) => { const m = /^ {0,3}(`{3,}|~{3,})/.exec(l); return m ? m[1] : null; };
export const PARA_KINDS = new Set(["para", "list", "quote"]); // 문단 모드(다듬기 · 학술 문체 …)로 보낼 수 있는 덩어리

function lineKind(l, next) {
  if (BLANK_RE.test(l)) return "blank";
  if (fenceOf(l)) return "code";
  if (HEAD_RE.test(l)) return "heading";
  if (BIB_LINE_RE.test(l)) return "bib";
  if (FOOTDEF_RE.test(l)) return "footnote";
  if (figureInfo(l)) return "figure";
  if (captionInfo(l)) return "caption";
  if (/^ {0,3}\|/.test(l) || (hasPipe(l) && isSepLine(next ?? "", splitRow(l).length))) return "table";
  if (HR_RE.test(l)) return "hr";
  if (parseListLine(l)) return "list";
  if (/^ {0,3}>/.test(l)) return "quote";
  return "para";
}

// 원고 → 덩어리 [{ type, from, to, line, level?, title? }] (from~to = 첫 줄 시작 ~ 마지막 줄 끝, 빈 줄은 덩어리가 아님)
export function textBlocks(value) {
  const lines = String(value ?? "").split("\n");
  const n = lines.length;
  const starts = [];
  let p = 0;
  for (const l of lines) { starts.push(p); p += l.length + 1; }
  const out = [];
  const push = (type, i, j, extra = {}) => out.push({ type, from: starts[i], to: starts[j] + lines[j].length, line: i, ...extra });
  let i = 0;
  while (i < n) {
    const l = lines[i];
    const k = lineKind(l, lines[i + 1]);
    let j = i;
    if (k === "blank") { i++; continue; }
    if (k === "code") { // 닫는 울타리까지 (없으면 끝까지)
      const f = fenceOf(l);
      j = i + 1;
      while (j < n) {
        const g = fenceOf(lines[j]);
        if (g && g[0] === f[0] && g.length >= f.length && !/\S/.test(lines[j].trim().slice(g.length))) break;
        j++;
      }
      j = Math.min(j, n - 1);
    } else if (k === "heading") {
      const m = HEAD_RE.exec(l);
      push("heading", i, i, { level: m[1].length, title: m[2].replace(/\s+#+\s*$/, "").trim() });
      i++;
      continue;
    } else if (k === "table") {
      while (j + 1 < n && !endsTable(lines[j + 1]) && !captionInfo(lines[j + 1]) && !figureInfo(lines[j + 1])) j++;
    } else if (k === "footnote") {
      while (j + 1 < n && /^(?: {2,}|\t)\S/.test(lines[j + 1])) j++;
    } else if (k === "list") {
      for (;;) {
        const nx = lines[j + 1];
        if (nx === undefined) break;
        if (!BLANK_RE.test(nx)) {
          const nk = lineKind(nx, lines[j + 2]);
          if (nk === "list" || nk === "para" || /^\s+\S/.test(nx)) { j++; continue; } // 항목 · 들여쓴 줄 · 앞 항목에 이어지는 줄
          break;
        }
        let b = j + 1; // 빈 줄 뒤가 목록 항목 · 들여쓴 줄이면 같은 목록 (느슨한 목록)
        while (b < n && BLANK_RE.test(lines[b])) b++;
        if (b < n && (parseListLine(lines[b]) || /^\s{2,}\S/.test(lines[b]))) { j = b; continue; }
        break;
      }
    } else if (k === "quote") {
      while (j + 1 < n && (/^ {0,3}>/.test(lines[j + 1]) || lineKind(lines[j + 1], lines[j + 2]) === "para")) j++;
    } else if (k === "para") {
      while (j + 1 < n && lineKind(lines[j + 1], lines[j + 2]) === "para") j++;
    } // bib · figure · caption · hr: 한 줄
    push(k, i, j);
    i = j + 1;
  }
  return out;
}

// pos가 든 덩어리 (줄 끝 · 첫 글자 앞도 그 덩어리). 빈 줄이면 null
export function blockAt(blocks, pos) {
  return blocks.find((b) => pos >= b.from && pos <= b.to) || null;
}

export const SCOPE_KINDS = ["sel", "para", "section", "chapter"];
export const SCOPE_NAMES = { sel: "선택", para: "문단", section: "이 절", chapter: "이 장" };
export const SCOPE_WHY = {
  blank: "커서가 빈 줄에 있어요. 문단 안에 커서를 두거나 글을 골라 주세요",
  heading: "제목 줄은 AI로 보내지 않아요. 문단 안에 커서를 두거나 글을 골라 주세요",
  table: "표는 문단이 아니에요. 표 안의 글을 고르면 그 글만 보내요",
  figure: "그림 줄은 문단이 아니에요. 캡션 글을 고르면 그 글만 보내요",
  caption: "캡션 줄은 문단이 아니에요. 캡션 글을 고르면 그 글만 보내요",
  code: "코드 블록은 보내지 않아요. 글을 골라 주세요",
  footnote: "각주 정의 줄이에요. 각주 글을 고르면 그 글만 보내요",
  hr: "쪽 나눔(---) 줄이에요. 문단 안에 커서를 두세요",
  bib: "[참고문헌] 자리 줄이에요. 문단 안에 커서를 두세요",
  "no-section": "커서가 절(### 제목) 안에 있지 않아요. 절 안에 커서를 두세요",
  "no-chapter": "커서가 장(## 제목) 안에 있지 않아요. 장 안에 커서를 두세요",
  empty: "보낼 글이 없어요",
};

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
// 제목의 짧은 이름: '## 제2장 이론적 배경' → '제2장', 번호 없는 제목은 앞 14자
function headName(h, word) {
  const m = new RegExp(`^제\\s*(\\d+)\\s*${word}`).exec(h.title || "");
  return m ? `제${m[1]}${word}` : clip(h.title || "(제목 없음)", 14);
}

// pos가 든 절(level 3) · 장(level 2)의 제목 → { head, from, to } (제목 줄은 빼고 본문만, 앞뒤 빈 줄 뺌). 없으면 null
export function sectionAt(value, pos, level = 3, blocks = textBlocks(value)) {
  const heads = blocks.filter((b) => b.type === "heading");
  let h = null;
  for (const x of heads) {
    if (x.from > pos) break;
    if (x.level < level) h = null;
    if (x.level === level) h = x;
  }
  if (!h) return null;
  const next = heads.find((x) => x.from > h.from && x.level <= level);
  let from = Math.min(String(value).length, h.to + 1);
  let to = next ? next.from : String(value).length;
  while (from < to && /\s/.test(value[from])) from++;
  while (to > from && /\s/.test(value[to - 1])) to--;
  return { head: h, from, to };
}

// 커서 자리 이름: "제2장 제1절" · "제2장" · "원고 앞부분"
export function placeLabel(value, pos, blocks = textBlocks(value)) {
  const ch = sectionAt(value, pos, 2, blocks);
  const sec = sectionAt(value, pos, 3, blocks);
  const parts = [ch && headName(ch.head, "장"), sec && headName(sec.head, "절")].filter(Boolean);
  return parts.join(" ") || "원고 앞부분";
}

// AI에 보낼 범위 → { ok, kind, from, to, text, label, paras: [{from, to}], chars, fallback? } | { ok: false, kind, reason, message }
// kind: sel(고른 글 — 없으면 커서 문단, fallback) · para(커서 문단) · section(이 절) · chapter(이 장).
// paras = 범위 안 문단 덩어리(장 · 절 일괄 처리 단위 — 제목 · 표 · 그림 · 캡션 · 코드 · 각주 정의는 빠짐)
export function aiScope(value, start, end, kind = "sel") {
  const v = String(value ?? "");
  const blocks = textBlocks(v);
  const place = placeLabel(v, start, blocks);
  const fail = (k, reason) => ({ ok: false, kind: k, reason, message: SCOPE_WHY[reason] || SCOPE_WHY.empty });
  const done = (k, from, to, label, extra = {}) => {
    while (from < to && /\s/.test(v[from])) from++;
    while (to > from && /\s/.test(v[to - 1])) to--;
    if (from >= to) return fail(k, "empty");
    const paras = blocks.filter((b) => PARA_KINDS.has(b.type) && b.to > from && b.from < to)
      .map((b) => ({ from: Math.max(b.from, from), to: Math.min(b.to, to) }));
    return { ok: true, kind: k, from, to, text: v.slice(from, to), label, paras, chars: to - from, ...extra };
  };
  if (kind === "sel") {
    if (start !== end && v.slice(Math.min(start, end), Math.max(start, end)).trim()) {
      return done("sel", Math.min(start, end), Math.max(start, end), `${place} · 고른 글`);
    }
    const p = aiScope(v, start, start, "para");
    return p.ok ? { ...p, fallback: true } : p;
  }
  if (kind === "para") {
    const b = blockAt(blocks, start);
    if (!b) return fail("para", "blank");
    if (!PARA_KINDS.has(b.type)) return fail("para", b.type);
    return done("para", b.from, b.to, `${place} · ${b.type === "list" ? "목록" : "문단"}`);
  }
  const level = kind === "chapter" ? 2 : 3;
  const s = sectionAt(v, start, level, blocks);
  if (!s) return fail(kind, kind === "chapter" ? "no-chapter" : "no-section");
  const ch = kind === "chapter" ? s : sectionAt(v, start, 2, blocks);
  const label = kind === "chapter" ? headName(s.head, "장") : [ch && headName(ch.head, "장"), headName(s.head, "절")].filter(Boolean).join(" ");
  return done(kind, s.from, s.to, label);
}

const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
// 패널 · 확인 창 한 줄: "대상: 제2장 제1절 (문단 4개 · 1,230자)"
export function scopeSummary(sc) {
  if (!sc || !sc.ok) return "";
  return `대상: ${sc.label} (문단 ${sc.paras.length}개 · ${comma(sc.chars)}자)`;
}

// 원고 목차(제목 줄만) — AI 대화에 원고 구조로 함께 보낸다 (max자까지)
export function outlineText(value, max = 4000) {
  let out = "";
  for (const b of textBlocks(value)) {
    if (b.type !== "heading") continue;
    const line = `${"#".repeat(b.level)} ${b.title}\n`;
    if (out.length + line.length > max) break;
    out += line;
  }
  return out.trimEnd();
}

// 앞부분 제목(국문 초록 · ABSTRACT · 감사의 글 · 머리말 · 목차) — 장별 그림 · 표 번호에서 장으로 세지 않음.
// 서버 writer.FRONT_MATTER_TITLES(쪽 번호의 '첫 장')와 같은 목록
const FRONT_MATTER = new Set(["국문초록", "초록", "국문요약", "요약", "요지", "abstract", "감사의글", "감사의말씀", "사사",
  "머리말", "서문", "preface", "acknowledgements", "acknowledgments", "목차", "차례"]);
export function isFrontMatter(title) {
  return FRONT_MATTER.has(String(title || "").replace(/[\s<>〈〉()[\]·.:]+/g, "").toLowerCase());
}

// ------------------------------------------------------------- 단축키 · 서식 도움말 (논문 쓰기 화면의 ? 버튼 · Ctrl+/)
export function shortcutHelp(mac = false) {
  const M = mac ? "⌘" : "Ctrl";
  const A = mac ? "⌥" : "Alt";
  return {
    keys: [
      ["저장", `${M}+S`], ["굵게", `${M}+B`], ["기울임", `${M}+I`],
      ["장 제목 (제N장 번호 자동)", `장 버튼 · ${M}+${A}+2`], ["절 제목 (제N절 번호 자동)", `절 버튼 · ${M}+${A}+3`],
      ["글머리 목록 켜기 · 끄기", `${M}+Shift+8`], ["번호 목록 켜기 · 끄기", `${M}+Shift+7`],
      ["목록 다음 항목 (빈 항목에서 누르면 목록 끝)", "Enter"], ["목록 들여쓰기 · 내어쓰기", "Tab · Shift+Tab"],
      ["목록 기호 지우기 (내용 맨 앞에서)", "Backspace"],
      ["인용 넣기 창", "＋ 인용 넣기"], ["인용 자동완성 열기", "[@ 입력"], ["자동완성 고르기 · 넣기 · 닫기", "↑↓ · Enter/Tab · Esc"],
      ["자동완성에서 참고 패널로 보기", `${M}+Enter`], ["참고 패널 열기 · 닫기", `${A}+R`],
      ["AI 결과 패널 열기 · 닫기 (결과를 보면서 계속 쓰기)", `${A}+A`], ["AI 결과 패널 닫기 (패널 안에서)", "Esc"],
      ["AI 대화 열기 (원고를 말로 고치기 · 입력 칸으로)", `${A}+C`], ["AI 대화 보내기 · 줄바꿈", "Enter · Shift+Enter"],
      ["그림 만들기 패널 열기 · 닫기 (AI가 SVG로 그리고 말로 고치기)", `✦ AI 도우미 · ${A}+G`],
      ["그림 넣기", "그림 버튼 · 붙여넣기 · 끌어 놓기"], ["표 넣기 · 고치기", `표 버튼 · ${M}+${A}+T`],
      ["버전 기록 (비교 · 되돌리기 · 지금 버전 저장)", `기록 버튼 · ${A}+H`],
      ["각주 넣기 (커서에 [^N] · 장 · 절 끝에 내용 줄)", `각주 버튼 · ${M}+${A}+F`],
      ["제출 전 점검 열기 · 닫기", `점검 버튼 · ${A}+K`],
      ["집중 모드 (편집기만 · 커서 줄을 화면 가운데에) 켜기 · 끄기", `집중 버튼 · ${M}+Shift+F · 끌 때 Esc`],
      ["맞춤법 · 띄어쓰기 점검 열기 · 닫기 (AI)", `AI 도우미 메뉴 · ${A}+P`],
      ["명령 팔레트 (기능 이름 · 초성으로 찾아 바로 실행, 장 · 절로 가기)", `${M}+K`],
      ["개요에서 장 · 절 순서 바꾸기", "개요 항목 끌어 놓기 · 항목에서 Alt+↑↓"],
      ["이 도움말", `${M}+/`],
    ],
    syntax: [
      ["# 제목", "논문 제목"], ["## 제1장 서론", "장 제목 — 장 버튼을 누르면 '제N장' 번호가 자동으로 붙고 뒤 번호도 이어져요"],
      ["### 제1절 배경", "절 제목 — 절 버튼을 누르면 '제N절' 번호가 장마다 1부터 붙어요"], ["#### 1. 세부", "항 제목"],
      ["**굵게** · *기울임*", "굵게 · 기울임"],
      ["- 항목 (줄 앞에 - 와 띄어쓰기)", "글머리 목록"], ["1. 항목 (숫자 . 띄어쓰기)", "번호 목록 — 번호는 자동으로 이어져요"],
      ["  - 하위 항목 (Tab)", "하위 목록"], ["> 인용문", "들여쓴 인용 블록"], ["---", "쪽 나눔"],
      ["![설명](fig:…)", "그림 — 아래에 \"그림 1. 설명\"이 붙어요"],
      ["표: 제목 (표 바로 위 줄)", "표 캡션 — 위에 \"표 1. 제목\"이 붙어요"],
      ["| 칸 | 칸 |", "표 (둘째 줄은 | --- | --- |)"],
      ["{#fig:이름} · {#tbl:이름}", "그림 · 표에 이름 붙이기 (그림 줄 끝 · 표 캡션 끝)"],
      ["@fig:이름 · @tbl:이름", "본문에서 \"그림 1\" · \"표 2\"로 바뀌는 참조"],
      ["$$ E = mc^2 $$ {#eq:이름}", "줄 수식 — 가운데 수식 · 오른쪽 번호 (1). 수식 버튼으로 넣어요"],
      ["$x_1 + \\alpha$", "문장 안 수식 (워드 · 한글에는 x₁ + α 처럼 글자로)"], ["@eq:이름", "본문에서 \"식 (1)\"로 바뀌는 참조"],
      ["[@인용키] · [@a; @b] · [@a, p. 12]", "인용 · 여러 편 · 쪽"], ["[참고문헌]", "참고문헌이 들어갈 자리"],
      ["본문[^1] … [^1]: 내용", "각주 — 번호는 본문 순서대로, 워드 · 한글에서는 쪽 아래에 들어가요"],
    ],
  };
}
