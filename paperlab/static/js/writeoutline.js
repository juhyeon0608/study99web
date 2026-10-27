// 개요에서 장 · 절 옮기기 (2026-10-28 사용자 요청) — 순수 함수. 화면은 writing.js drawOutline (끌어 놓기 · Alt+↑↓)
// 한 장 · 절 = 제목 줄부터 같거나 높은 단계의 다음 제목 앞까지(아래 절 · 각주 정의 · 그림 줄 포함).
// 코드 블록 안 # 줄은 제목이 아님. 옮긴 뒤 '제N장' · '제N절' 번호는 새 순서대로 다시 매김(renumberHeadings)
import { renumberHeadings } from "./writeedit.js";

/** → [{ level, text, from, to }] — from = 제목 줄 시작, to = 이 장 · 절이 끝나는 자리(다음 같은 · 높은 제목 앞 또는 [참고문헌] 앞 · 글 끝) */
export function sections(value) {
  const v = String(value ?? "");
  const heads = [];
  let pos = 0;
  let fence = false;
  let bib = v.length;
  for (const line of v.split("\n")) {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    else if (!fence) {
      const m = line.match(/^(#{1,4})\s+(.+)/);
      if (m) heads.push({ level: m[1].length, text: m[2].trim(), from: pos });
      else if (bib === v.length && /^\[(참고문헌|References|Bibliography|REFERENCES)\]\s*$/.test(line)) bib = pos;
    }
    pos += line.length + 1;
  }
  heads.forEach((h, i) => {
    const next = heads.slice(i + 1).find((x) => x.level <= h.level);
    const end = next ? next.from : v.length;
    h.to = h.from < bib && bib < end ? bib : end;
  });
  return heads;
}

/**
 * i번째 제목의 장 · 절을 j번째 제목 앞(after=false) 또는 j번째 장 · 절 뒤(after=true)로 옮긴 글 → { value, from, to } | null
 * (from · to = 옮긴 장 · 절의 새 자리). 자기 안(아래 절)으로 옮기거나 자리가 그대로면 null. 1단계(# 논문 제목)는 옮기지 않음
 */
export function moveSection(value, i, j, after = false) {
  const v = String(value ?? "");
  const hs = sections(v);
  const s = hs[i];
  let t = hs[j];
  if (!s || !t || s.level < 2) return null;
  // 더 낮은 단계(장을 다른 장의 절)에 놓으면 그 절을 품은 같은 · 높은 단계 장 · 절 기준 — 다른 장을 가르지 않게
  if (t.level > s.level) t = hs.slice(0, j + 1).reverse().find((x) => x.level <= s.level && x.to >= t.to) || t;
  const at = after ? t.to : t.from;
  if (at >= s.from && at <= s.to) return null; // 자기 자신 · 아래 절 안 · 제자리
  const piece = v.slice(s.from, s.to).replace(/\n*$/, "\n");
  const rest = v.slice(0, s.from) + v.slice(s.to);
  const k = at > s.to ? at - (s.to - s.from) : at;
  let before = rest.slice(0, k).replace(/\n*$/, "");
  if (before) before += "\n\n";
  const tail = rest.slice(k).replace(/^\n*/, "");
  // '제N장' · '제N절' 번호를 새 순서대로 다시 매긴다(번호 글자 수가 바뀔 수 있어 옮긴 장 · 절 자리는 몇 번째 제목인지로 다시 찾음)
  const moved = before + piece + (tail ? `\n${tail}` : "");
  const idx = sections(moved).findIndex((h) => h.from === before.length);
  const value2 = renumberHeadings(moved);
  const h = sections(value2)[idx];
  return { value: value2, from: h.from, to: h.to };
}
