// 통계 계산 (2026-10-28 사용자 요청) — 순수 함수. 엑셀 원자료 읽기 · 열 종류 · 분석 목록 · 결과 → 원고 마크다운.
// 계산은 서버(paperlab/stats.py — scipy)가 한다. 화면은 writestatsui.js
import { splitTsv } from "./writepaste.js";
import { figureMarkdown, tableMarkdown } from "./writeedit.js";

export const MAX_ROWS = 5000;
const MISSING = new Set(["", ".", "na", "n/a", "nan", "-", "null", "없음", "무응답", "#n/a"]);

// 분석 종류: key, 이름, 설명, 고를 칸 [{ name, label, kind: "num" | "cat" | "any", many?, min?, max? }]
export const ANALYSES = [
  { key: "describe", name: "기술통계", hint: "평균 · 표준편차 · 최솟값 · 최댓값 · 왜도 · 첨도", fields: [{ name: "vars", label: "변인", kind: "num", many: true, min: 1 }] },
  { key: "ttest_ind", name: "독립표본 t검정", hint: "두 집단의 평균 비교 (Levene · Welch · Cohen's d)",
    fields: [{ name: "group", label: "집단 변인", kind: "any" }, { name: "value", label: "비교할 변인", kind: "num" }] },
  { key: "ttest_rel", name: "대응표본 t검정", hint: "같은 사람의 두 측정 비교 (사전 · 사후)",
    fields: [{ name: "a", label: "측정 1 (예: 사후)", kind: "num" }, { name: "b", label: "측정 2 (예: 사전)", kind: "num" }] },
  { key: "anova", name: "일원분산분석", hint: "세 집단 이상의 평균 비교 (η² · Tukey 사후 검정)",
    fields: [{ name: "group", label: "집단 변인", kind: "any" }, { name: "value", label: "비교할 변인", kind: "num" }] },
  { key: "corr", name: "상관분석", hint: "Pearson 상관 행렬 (평균 · 표준편차 · 유의 별표)", fields: [{ name: "vars", label: "변인", kind: "num", many: true, min: 2 }] },
  { key: "regression", name: "회귀분석", hint: "단순 · 다중 회귀 (B · SE · β · R² · VIF)",
    fields: [{ name: "y", label: "종속변인", kind: "num" }, { name: "xs", label: "독립(예측)변인", kind: "num", many: true, min: 1 }] },
  { key: "chisq", name: "카이제곱 검정", hint: "두 범주형 변인의 관련성 (교차표 · Cramér's V)",
    fields: [{ name: "a", label: "행 변인", kind: "cat" }, { name: "b", label: "열 변인", kind: "cat" }] },
  { key: "alpha", name: "신뢰도 (Cronbach's α)", hint: "설문 문항의 내적 일관성 · 항목 삭제 시 α", fields: [{ name: "vars", label: "문항", kind: "num", many: true, min: 2 }] },
];

const isMissing = (c) => MISSING.has(String(c ?? "").trim().toLowerCase());
const isNum = (c) => /^[-+−]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(String(c).trim()) && /\d/.test(String(c));

// 쉼표로 나뉜 글(CSV) → 칸 배열 ("…" 안 쉼표 · 줄바꿈 · "" 처리)
export function splitCsv(text) {
  const s = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** 붙여 넣은 글 · CSV 파일 → { columns, rows } (첫 줄 = 변인 이름) | { error } */
export function parseData(text) {
  const s = String(text || "").trim();
  if (!s) return { error: "자료를 붙여 넣어 주세요" };
  const first = s.split("\n")[0];
  const cells = first.includes("\t") ? splitTsv(s) : first.includes(",") ? splitCsv(s) : s.split("\n").map((l) => l.trim().split(/\s{2,}|\s*;\s*/));
  const lines = cells.map((r) => r.map((c) => String(c ?? "").trim())).filter((r) => r.some(Boolean));
  if (lines.length < 3) return { error: "첫 줄(변인 이름)과 자료 두 줄 이상이 필요해요" };
  let cols = Math.max(...lines.map((r) => r.length));
  while (cols > 1 && lines.every((r) => !r[cols - 1])) cols--;
  const head = lines[0].slice(0, cols);
  if (head.filter(Boolean).every(isNum)) return { error: "첫 줄에 변인 이름(예: 집단, 사전, 사후)을 넣어 주세요" };
  const seen = new Map();
  const columns = Array.from({ length: cols }, (_, k) => {
    let name = head[k] || `열${k + 1}`;
    const n = seen.get(name) || 0;
    seen.set(name, n + 1);
    if (n) name = `${name}_${n + 1}`;
    return name;
  });
  const rows = lines.slice(1, MAX_ROWS + 1).map((r) => Array.from({ length: cols }, (_, k) => r[k] || ""));
  return { columns, rows, cut: lines.length - 1 > MAX_ROWS };
}

/** 열마다 "num"(값의 90% 이상이 숫자) | "cat" — 범주 수도 함께: [{ kind, levels }] */
export function columnKinds(data) {
  return data.columns.map((_, k) => {
    const vals = data.rows.map((r) => r[k]).filter((c) => !isMissing(c));
    const nums = vals.filter(isNum).length;
    const levels = new Set(vals).size;
    return { kind: vals.length && nums / vals.length >= 0.9 ? "num" : "cat", levels };
  });
}

/** 칸에 넣을 수 있는 열 이름 (숫자 칸은 숫자 열만, 집단 · 범주 칸은 범주가 2~12개인 열 — 글자 열 먼저, 1 · 2로 적은 숫자 열도) */
export function fieldOptions(data, kinds, field) {
  const ok = data.columns.map((c, k) => [c, kinds[k]]).filter(([, t]) => (field.kind === "num" ? t.kind === "num" : t.levels >= 2 && t.levels <= 12));
  if (field.kind !== "num") ok.sort((a, b) => (a[1].kind === "cat" ? 0 : 1) - (b[1].kind === "cat" ? 0 : 1));
  return ok.map(([c]) => c);
}

/** 서버 결과 → 원고에 넣을 마크다운 (표마다 캡션 · 표 · '주.' 줄, 그래프 그림 줄(figName — 올린 그림 이름), 마지막에 결과 문단) */
export function statsMarkdown(result, ko = true, figName = "") {
  const parts = (result.tables || []).map((t) => {
    const md = tableMarkdown({ rows: t.rows, align: t.align || [], caption: t.caption, label: "" }, ko);
    return t.note ? `${md}\n\n*주.* ${t.note}` : md;
  });
  if (figName && result.chart) parts.push(figureMarkdown(figName, result.chart.caption));
  if (result.text) parts.push(result.text);
  return parts.join("\n\n");
}
