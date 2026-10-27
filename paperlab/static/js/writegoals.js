// 분량 · 일정 목표 (2026-10-27 사용자 요청) — 순수 함수. 원고 설정 cover.goals:
// { deadline: "YYYY-MM-DD", total: 전체 목표 글자 수, daily: 하루 목표, chapters: { 장 제목: 목표 }, day: { date, start } }
// day = 오늘 처음 연 때의 글자 수(하루 한 번 저장) → 오늘 쓴 글자 = 지금 − start. 화면은 writing.js(상태 줄 · 목표 창)
import { CITE_RE } from "./refquote.js";

// 상태 줄 '글자' 수와 같은 셈: 인용 표시 · 제목 줄 · 마크다운 기호를 빼고, 그림 줄은 캡션 글만
export function plainBody(text) {
  return String(text ?? "").replace(CITE_RE, "").replace(/!\[((?:\\.|[^\]\\])*)\]\(fig:[^)\s]*\)(?:\{#[^}]*\})?/g, "$1")
    .replace(/^#+\s.*$/gm, "").replace(/[*_>`#|-]/g, "");
}
export const countChars = (text) => plainBody(text).replace(/\n/g, "").length;

/** '## ' 장마다 { title, chars } (코드 블록 안 제목은 빼고, 첫 장 앞 글은 세지 않음) */
export function chapterCounts(value) {
  const out = [];
  let fence = false;
  let cur = null;
  for (const line of String(value ?? "").split("\n")) {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (m) {
      cur = { title: m[1].trim().slice(0, 100), lines: [] };
      out.push(cur);
    } else if (cur && !/^#\s/.test(line)) cur.lines.push(line);
  }
  return out.map((c) => ({ title: c.title, chars: countChars(c.lines.join("\n")) }));
}

export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 마감까지 남은 날 (오늘이 마감이면 0, 지났으면 음수) */
export function daysLeft(deadline, today = new Date()) {
  const m = String(deadline || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end - start) / 86400000);
}

export const hasGoals = (g) => !!(g && (g.deadline || g.total || g.daily || (g.chapters && Object.keys(g.chapters).length)));

/** 상태 줄 한 줄 · 자세한 표 데이터 */
export function goalSummary(value, goals, today = new Date()) {
  const g = goals || {};
  const now = countChars(value);
  const key = dayKey(today);
  const todayDone = g.day && g.day.date === key ? Math.max(0, now - (Number(g.day.start) || 0)) : 0;
  const left = daysLeft(g.deadline, today);
  const remain = g.total ? Math.max(0, g.total - now) : 0;
  const perDay = g.total && left != null && left > 0 ? Math.ceil(remain / left) : null;
  const chapters = chapterCounts(value).map((c) => ({ ...c, target: (g.chapters && g.chapters[c.title]) || 0 }));
  const parts = [];
  if (g.total) parts.push(`목표 ${Math.min(100, Math.floor((now / g.total) * 100))}% (${now.toLocaleString("ko-KR")}/${g.total.toLocaleString("ko-KR")}자)`);
  if (g.daily) parts.push(`오늘 +${todayDone.toLocaleString("ko-KR")}/${g.daily.toLocaleString("ko-KR")}자`);
  else if (g.day && g.day.date === key) parts.push(`오늘 +${todayDone.toLocaleString("ko-KR")}자`);
  if (left != null) parts.push(left > 0 ? `마감 D-${left}` : left === 0 ? "오늘 마감" : `마감 ${-left}일 지남`);
  if (perDay) parts.push(`하루 ${perDay.toLocaleString("ko-KR")}자씩`);
  return { now, todayDone, left, remain, perDay, chapters, line: parts.join(" · "), needsDay: hasGoals(g) && (!g.day || g.day.date !== key) };
}
