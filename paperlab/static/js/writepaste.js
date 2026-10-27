// 엑셀 · 한글 · 워드에서 복사한 표 붙여넣기 → 마크다운 표 (2026-10-27 사용자 요청)
// 순수 함수만 — 화면(붙여넣기 처리 · HTML 읽기)은 writing.js

const MAX_COLS = 30;
const MAX_ROWS = 500;

// 탭으로 나뉜 글(엑셀은 줄바꿈 · 탭이 든 칸을 "…"로 감싸고 " 는 ""로) → 칸 2차원 배열
export function splitTsv(text) {
  const s = String(text || "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let start = true;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      continue;
    }
    if (start && c === '"') { quoted = true; start = false; continue; }
    start = false;
    if (c === "\t") { row.push(cell); cell = ""; start = true; } else if (c === "\n") {
      row.push(cell); rows.push(row); row = []; cell = ""; start = true;
    } else cell += c;
  }
  if (quoted) return s.split("\n").map((l) => l.split("\t")); // 짝이 안 맞는 따옴표 — 따옴표를 글로 본다
  row.push(cell);
  rows.push(row);
  return rows;
}

// 칸 배열 → { rows, align, caption, label } 또는 null(표로 보기 어려움: 2줄 · 2칸 미만, 칸 수가 들쭉날쭉)
export function tableFromCells(cells) {
  let rows = (cells || []).map((r) => r.map((c) => String(c ?? "").replace(/ /g, " ").trim()));
  rows = rows.filter((r) => r.some(Boolean));
  if (rows.length < 2 || rows.length > MAX_ROWS) return null;
  let cols = Math.max(...rows.map((r) => r.length));
  // 뒤쪽 빈 열은 버린다 (엑셀에서 넓게 고른 경우)
  while (cols > 1 && rows.every((r) => !r[cols - 1])) cols--;
  if (cols < 2 || cols > MAX_COLS) return null;
  const full = rows.filter((r) => r.length >= cols || r.slice(0, cols).filter(Boolean).length > 1).length;
  if (full / rows.length < 0.8) return null;
  rows = rows.map((r) => Array.from({ length: cols }, (_, k) => r[k] || ""));
  return { rows, align: Array(cols).fill(null), caption: "", label: "" };
}

export const tableFromTsv = (text) => (String(text || "").includes("\t") ? tableFromCells(splitTsv(text)) : null);
