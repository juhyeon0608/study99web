// 그림 만들기 · 자연어로 고치기 (2026-10-17 사용자 요청 — docs/specs/writing-figure-ai.md): 순수 함수만 (tests/js/writefig.test.mjs)
// "claude cli 사용해서 svg로 이미지 만드는 기능", "이 내용 기반으로 그림 만들어줘", "바로 붙여 넣거나 자연어를 통한 수정".
// 화면(패널 · 그리기 · 올리기)은 writefigui.js. 원고에는 PNG 그림 줄 ![캡션](fig:이름)만 들어가고, SVG 원본은 서버가 PNG 옆에 둔다.

import { blockInsert, diffEdit, figureMarkdown, findFigures } from "./writeedit.js";

export const FIG_PANE_SHORTCUT = "Alt+G";
export const FIG_JOB_KEY = (mid) => `paperlab.figJob.${Number(mid) || 0}`; // 이 브라우저에 원고별 마지막 그림 작업 id
export const RASTER_WIDTH = 1890; // 16cm × 300dpi (원고 · 워드 · 한글에 들어가는 PNG 가로 픽셀)
export const RASTER_MAX_SIDE = 4000;
export const DESC_MAX = 2000;
export const CONTENT_MAX = 12000;

// 패널 열기 · 닫기 Alt+G (macOS Option+G). Ctrl · ⌘ · Shift가 같이 눌렸거나 누르고 있는 반복이면 아님
export function isFigPaneKey(e) {
  return !!e && e.code === "KeyG" && !!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat;
}

// ------------------------------------------------------------------ '이 내용으로' 범위
// scope: "selection"(고른 글 — 없으면 문단) | "paragraph"(커서 문단) | "section"(커서가 있는 절 · 장 — 제목 줄부터 다음 같은 단계 이상 제목 앞까지)
// → { from, to, text, scope } (text는 앞뒤 공백을 뺀 글, from · to도 그 글을 가리킴)
const HEADING_RE = /^(#{1,6})\s/;
export function contentRange(value, s, e, scope = "selection") {
  value = String(value ?? "");
  s = Math.max(0, Math.min(Number(s) || 0, value.length));
  e = Math.max(s, Math.min(Number(e) || 0, value.length));
  let from = s;
  let to = e;
  let used = scope;
  if (scope === "section") {
    const lines = value.split("\n");
    const starts = [];
    let pos = 0;
    for (const l of lines) { starts.push(pos); pos += l.length + 1; }
    let li = 0;
    while (li + 1 < lines.length && starts[li + 1] <= s) li++;
    let h = li;
    while (h >= 0 && !HEADING_RE.test(lines[h])) h--;
    if (h < 0 || HEADING_RE.exec(lines[h])[1].length < 2) { // 제목이 없거나 '# 논문 제목'이면 문단으로
      used = "paragraph";
    } else {
      const level = HEADING_RE.exec(lines[h])[1].length;
      let end = h + 1;
      while (end < lines.length && !(HEADING_RE.test(lines[end]) && HEADING_RE.exec(lines[end])[1].length <= level)) end++;
      from = starts[h];
      to = end < lines.length ? starts[end] : value.length;
    }
  }
  if (used === "selection" && s === e) used = "paragraph";
  if (used === "paragraph") {
    from = value.lastIndexOf("\n\n", s - 1);
    from = from === -1 ? 0 : from + 2;
    to = value.indexOf("\n\n", e);
    to = to === -1 ? value.length : to;
  }
  while (from < to && /\s/.test(value[from])) from++;
  while (to > from && /\s/.test(value[to - 1])) to--;
  return { from, to, text: value.slice(from, to), scope: used };
}

// 그림을 만든 원고 글이 지금 원고 어디에 있는지 (그 뒤에 그림을 넣음): 원래 자리 그대로 → 그 끝, 아니면 한 곳에서만 찾으면 그 끝, 아니면 null
export function contentEnd(value, text, hintEnd = null) {
  value = String(value ?? "");
  text = String(text ?? "");
  if (!text) return null;
  if (Number.isInteger(hintEnd) && hintEnd >= text.length && value.slice(hintEnd - text.length, hintEnd) === text) return hintEnd;
  const i = value.indexOf(text);
  if (i < 0 || value.indexOf(text, i + 1) >= 0) return null;
  return i + text.length;
}

// ------------------------------------------------------------------ 원고에 넣기 · 바꾸기
// 상호 참조 이름: 그림 이름(16진수)의 앞 6자리 → fig:ai-xxxxxx (같은 원고 안에서 겹치지 않게 그림마다 다름)
export const figLabel = (name) => `fig:ai-${String(name || "").replace(/[^0-9a-f]/g, "").slice(0, 6) || "fig"}`;
export const refText = (label, ko = true) => (ko ? `(@${label} 참조)` : `(see @${label})`);

// 참조 글을 넣을 자리: 글 끝의 마침표 · 물음표 · 느낌표 · 닫는 따옴표 앞 (예: "…이다(그림 1 참조).")
export function refPos(value, end) {
  let p = end;
  while (p > 0 && /[.。!?！？"'”’)\]]/.test(value[p - 1]) && end - p < 3) p--;
  return p;
}

// ![캡션](fig:이름){#fig:꼬리표} 문단을 at(커서 · 내용 끝)에 넣고, ref면 refAt에 "(@fig:꼬리표 참조)"를 넣는다 → { value, edit }
// edit은 writetools.applyEdit 한 번(실행 취소 한 번)으로 넣는 최소 바꾸기. 넣은 그림의 캡션을 고른 상태로
export function insertFigure(value, { at, name, caption, ref = false, refAt = null, ko = true }) {
  value = String(value ?? "");
  at = Math.max(0, Math.min(Number.isInteger(at) ? at : value.length, value.length));
  const label = figLabel(name);
  const md = figureMarkdown(name, caption || (ko ? "그림 설명" : "Figure caption")) + (ref ? `{#${label}}` : "");
  const cap = String(caption || (ko ? "그림 설명" : "Figure caption")).replace(/[\\\]\[]/g, "\\$&");
  const block = blockInsert(value, at, at, md, [2, 2 + cap.length]);
  let next = value.slice(0, block.from) + block.text + value.slice(block.to);
  let selStart = block.selStart;
  let selEnd = block.selEnd;
  if (ref) {
    const r = Number.isInteger(refAt) ? Math.max(0, Math.min(refAt, value.length)) : null;
    if (r != null && r <= block.from) {
      const p = refPos(value, r);
      const t = (p > 0 && !/\s|\(/.test(value[p - 1]) && /[A-Za-z0-9]/.test(value[p - 1]) ? " " : "") + refText(label, ko);
      next = next.slice(0, p) + t + next.slice(p);
      selStart += t.length;
      selEnd += t.length;
    }
  }
  return { value: next, label, edit: diffEdit(value, next, selStart, selEnd) };
}

// 원고의 그림 old를 new로 바꾼다 (캡션 · 참조 이름 {#fig:…}은 그대로, caption이 있으면 캡션만 바꿈) → { value, edit, count } | null(못 찾음)
export function replaceFigure(value, oldName, newName, caption = null) {
  value = String(value ?? "");
  const hits = findFigures(value).filter((f) => f.src === oldName);
  if (!hits.length) return null;
  let next = value;
  for (const f of [...hits].reverse()) { // 뒤에서부터 (앞 위치가 밀리지 않게)
    const line = next.slice(f.from, f.to);
    let fixed = line.replace(`](fig:${oldName})`, `](fig:${newName})`);
    if (caption != null) {
      const alt = String(caption).replace(/[\\\]\[]/g, "\\$&");
      const a = f.altFrom - f.from;
      const b = f.altTo - f.from;
      fixed = fixed.slice(0, a) + alt + fixed.slice(b);
    }
    next = next.slice(0, f.from) + fixed + next.slice(f.to);
  }
  const first = findFigures(next).find((f) => f.src === newName);
  return { value: next, count: hits.length, edit: diffEdit(value, next, first ? first.altFrom : 0, first ? first.altTo : 0) };
}

// 커서(pos)가 있는 그림 줄 { src, alt, from, to } (없으면 null)
export function figureAt(value, pos) {
  const f = findFigures(String(value ?? "")).find((x) => pos >= x.from && pos <= x.to);
  return f ? { ...f, alt: String(value).slice(f.altFrom, f.altTo).replace(/\\([\\\]\[])/g, "$1") } : null;
}

// ------------------------------------------------------------------ SVG 크기 · PNG 크기
export function svgViewBox(svg) {
  const m = /<svg\b[^>]*\sviewBox="([^"]*)"/.exec(String(svg || ""));
  if (!m) return null;
  const n = m[1].trim().split(/[\s,]+/).map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite) || n[2] <= 0 || n[3] <= 0) return null;
  return { x: n[0], y: n[1], w: n[2], h: n[3] };
}

// PNG 크기: 가로를 16cm 300dpi(1890px)에 맞추고, 세로가 너무 길면 줄임 (비율 유지, 1px 이상)
export function rasterSize(w, h, width = RASTER_WIDTH, maxSide = RASTER_MAX_SIDE) {
  if (!(w > 0 && h > 0)) return null;
  let scale = width / w;
  if (h * scale > maxSide) scale = maxSide / h;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// ------------------------------------------------------------------ 작업 · 버전 · 안내
export function figState(j) {
  if (!j) return "missing";
  if (j.status === "failed") return "failed";
  if (j.status === "cancelled") return "cancelled";
  if (j.status !== "succeeded") return "running";
  return j.result && j.result.svg ? "ready" : "missing";
}
export const FIG_STATE_TEXT = { running: "그리는 중", ready: "완성", failed: "실패", cancelled: "취소함", missing: "찾을 수 없음" };

// 버전 목록: 고치기 사슬(오래된 것부터) + 이 작업 — 같은 id는 한 번
export function versionIds(j) {
  const chain = ((j && j.figure && j.figure.chain) || []).filter((x) => Number.isInteger(x) && x > 0);
  const ids = j && Number.isInteger(j.id) ? [...chain, j.id] : chain;
  return [...new Set(ids)];
}

// claude가 아닌 엔진으로 그릴 때 안내 (서버 figgen.route_note와 같은 뜻)
export function routeNote(j) {
  const first = j && Array.isArray(j.route) && j.route[0];
  if (!first || first.engine === "claude") return "";
  const where = first.runner === "cli" ? `내 PC의 ${first.engine}` : `내 ${first.engine === "codex" ? "OpenAI" : "Google"} API 키`;
  return `Claude를 쓸 수 없어 ${where}로 그려요. 그림 품질이 다를 수 있어요.`;
}

// 서버에 보낼 요청 본문 (POST /api/ai/figure). base = { jobId } | { figure: 이름, caption } (고치기)
export function figureRequest({ mid, mode, description = "", content = "", instruction = "", base = null, caption = null, ko = true }) {
  const body = { manuscript_id: mid, mode, description: String(description).slice(0, DESC_MAX), lang: ko ? "ko" : "en" };
  if (mode === "content") body.content = String(content).slice(0, CONTENT_MAX);
  if (mode === "edit") {
    body.instruction = String(instruction).slice(0, DESC_MAX);
    if (base && base.jobId) body.parent_job_id = base.jobId;
    else if (base && base.figure) body.base_figure = base.figure;
    if (caption != null) body.caption = String(caption);
  }
  return body;
}
