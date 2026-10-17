// 원고 버전 기록 (docs/specs/manuscript-history.md): 줄 단위 비교 · 목록 문구 — 순수 함수만 (tests/js/writehist.test.mjs)
// 비교 방향은 늘 "그 버전 → 지금 원고": del = 그 버전에만 있는 글(되돌리면 돌아옴), ins = 지금 원고에만 있는 글(되돌리면 사라짐)

import { wordDiff } from "./writeai.js";

export const REASON_NAMES = { auto: "자동 저장", ai_apply: "AI 넣기 전", restore: "되돌리기 전", manual: "직접 저장" };

export function reasonName(reason) {
  return REASON_NAMES[reason] || "기록";
}

// 버전 이름: 붙인 이름, 없으면 종류
export function versionTitle(v) {
  return (v && v.label) || reasonName(v && v.reason);
}

// 1234 → "1.2KB" (1024 단위 — 목록의 크기 표시)
export function sizeText(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

const pad = (n) => String(n).padStart(2, "0");
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// 기록 시각 (브라우저 시간대): 오늘 14:05 · 어제 09:12 · 10월 3일 14:05 · 2025년 10월 3일 14:05
export function timeText(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, now)) return `오늘 ${hm}`;
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, y)) return `어제 ${hm}`;
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}년 ${md}`;
}

// 목록 한 줄의 보조 글: "1,234자 · 3.6KB"
export function versionSub(v) {
  return `${Number(v.chars || 0).toLocaleString("ko-KR")}자 · ${sizeText(v.size)}`;
}

const lines = (s) => String(s ?? "").replace(/\r\n?/g, "\n").split("\n");

// 줄 단위 차이 [{op: "same" | "del" | "ins", text}] (한 줄에 하나). 앞뒤 같은 줄을 먼저 떼고 가운데만 LCS,
// 가운데가 너무 크면(maxCells) 통째로 지움 · 넣음
export function lineDiff(a, b, maxCells = 2_000_000) {
  const A = lines(a);
  const B = lines(b);
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let s = 0;
  while (s < A.length - p && s < B.length - p && A[A.length - 1 - s] === B[B.length - 1 - s]) s++;
  const out = A.slice(0, p).map((text) => ({ op: "same", text }));
  const a2 = A.slice(p, A.length - s);
  const b2 = B.slice(p, B.length - s);
  const n = a2.length;
  const m = b2.length;
  if ((n + 1) * (m + 1) > maxCells) {
    out.push(...a2.map((text) => ({ op: "del", text })), ...b2.map((text) => ({ op: "ins", text })));
  } else {
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) { out.push({ op: "same", text: a2[i] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: "del", text: a2[i++] });
      else out.push({ op: "ins", text: b2[j++] });
    }
    while (i < n) out.push({ op: "del", text: a2[i++] });
    while (j < m) out.push({ op: "ins", text: b2[j++] });
  }
  out.push(...A.slice(A.length - s).map((text) => ({ op: "same", text })));
  return out;
}

// 바뀐 줄 수 { removed: 그 버전에만 있는 줄, added: 지금 원고에만 있는 줄 }
export function diffStats(ops) {
  let removed = 0;
  let added = 0;
  for (const o of ops) {
    if (o.op === "del") removed++;
    else if (o.op === "ins") added++;
  }
  return { removed, added };
}

// 화면에 그릴 줄: 바뀐 곳 앞뒤 context줄만 남기고 나머지 같은 줄은 {op: "skip", n}.
// 지운 줄 묶음 바로 뒤에 같은 수의 넣은 줄이 오면(MOD_MAX줄까지) 줄마다 낱말 차이 {op: "mod", parts: wordDiff}로 합친다.
// 바뀐 곳이 없으면 []
export const MOD_MAX = 40;
export function diffRows(ops, context = 2) {
  if (!ops.some((o) => o.op !== "same")) return [];
  const merged = [];
  for (let k = 0; k < ops.length;) {
    if (ops[k].op !== "del") { merged.push(ops[k++]); continue; }
    let d = k;
    while (d < ops.length && ops[d].op === "del") d++;
    let e = d;
    while (e < ops.length && ops[e].op === "ins") e++;
    const nd = d - k;
    if (nd === e - d && nd <= MOD_MAX) {
      for (let x = 0; x < nd; x++) merged.push({ op: "mod", parts: wordDiff(ops[k + x].text, ops[d + x].text) });
    } else merged.push(...ops.slice(k, e));
    k = e;
  }
  const near = new Uint8Array(merged.length);
  merged.forEach((o, i) => {
    if (o.op === "same") return;
    for (let x = Math.max(0, i - context); x <= Math.min(merged.length - 1, i + context); x++) near[x] = 1;
  });
  const rows = [];
  for (let i = 0; i < merged.length;) {
    if (near[i]) { rows.push(merged[i++]); continue; }
    let j = i;
    while (j < merged.length && !near[j]) j++;
    rows.push({ op: "skip", n: j - i });
    i = j;
  }
  return rows;
}
