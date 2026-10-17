// 원고 AI 대화 · 장 · 절 일괄 처리 — 순수 함수만 (docs/specs/manuscript-ai-chat.md · tests/js/writechat.test.mjs).
// 화면은 writechatui.js. 제안 · 결과를 원고에 넣을 때는 writeai.js의 planApply로 지금 원고에서 자리를 다시 찾는다
// (원고가 바뀌었으면 원래 글이 그대로 한 곳에 있을 때만 — 새 글을 몰래 덮어쓰지 않음).

import { insertionText, planApply } from "./writeai.js";

// ------------------------------------------------------------------ 답 읽기 (서버 mschat.split_reply와 같은 규칙)
const FENCE_RE = /```[ \t]*(?:json|JSON)?[ \t]*\r?\n?([\s\S]*?)```/g;
const BARE_RE = /\{\s*"(?:edits|replace_all)"\s*:/g;
const isProposal = (o) => !!o && typeof o === "object" && !Array.isArray(o) && ("edits" in o || "replace_all" in o);

function tryJson(s) {
  try { return JSON.parse(s); } catch { return undefined; }
}

// 처음 { 부터 짝이 맞는 } 까지 (문자열 안 괄호는 셈하지 않음) → 끝 위치(다음 글자) | -1
function jsonEnd(text, at) {
  let depth = 0;
  let str = false;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (str) {
      if (c === "\\") i++;
      else if (c === "\"") str = false;
    } else if (c === "\"") str = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

// AI 답 → { answer(보일 글), json(제안 객체 | null), pending(만드는 중이라 ```json 블록이 아직 안 닫힘), broken(형식이 깨짐) }
export function splitReply(text) {
  text = String(text ?? "");
  let broken = false;
  const fences = [...text.matchAll(FENCE_RE)];
  for (let k = fences.length - 1; k >= 0; k--) {
    const m = fences[k];
    const body = m[1].trim();
    if (!body.startsWith("{")) continue;
    const obj = tryJson(body);
    if (isProposal(obj)) return { answer: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim(), json: obj, pending: false, broken: false };
    if (/^\{\s*"(?:edits|replace_all)"/.test(body)) broken = true;
  }
  const bare = [...text.matchAll(BARE_RE)];
  for (let k = bare.length - 1; k >= 0; k--) {
    const at = bare[k].index;
    const end = jsonEnd(text, at);
    const obj = end > 0 ? tryJson(text.slice(at, end)) : undefined;
    if (isProposal(obj)) return { answer: (text.slice(0, at) + text.slice(end)).trim(), json: obj, pending: false, broken: false };
    broken = true;
  }
  const open = /```[ \t]*(?:json|JSON)[ \t]*\r?\n/.exec(text);
  if (open && (text.match(/```/g) || []).length % 2 === 1) {
    return { answer: text.slice(0, open.index).trim(), json: null, pending: true, broken: false };
  }
  return { answer: text.trim(), json: null, pending: false, broken };
}

// 제안 객체 → [{ find, replace }] (모양이 틀린 항목 · 바뀌는 것 없는 항목은 뺌). replace_all은 범위 글(scopeText)을 통째로
export function parseProposals(text, scopeText = "") {
  const r = splitReply(text);
  const edits = [];
  const o = r.json || {};
  if (typeof o.replace_all === "string" && String(scopeText).trim() && o.replace_all.trim() !== String(scopeText).trim()) {
    edits.push({ find: String(scopeText).trim(), replace: o.replace_all.trim() });
  }
  for (const e of Array.isArray(o.edits) ? o.edits.slice(0, 20) : []) {
    if (!e || typeof e.find !== "string" || typeof e.replace !== "string" || !e.find.trim() || e.find === e.replace) continue;
    edits.push({ find: e.find, replace: e.replace });
  }
  return { answer: r.answer, edits, note: typeof o.note === "string" ? o.note : "", pending: r.pending, broken: r.broken && !edits.length };
}

// ------------------------------------------------------------------ 제안 넣기
// 제안 하나 → planApply가 받는 넣을 자리 정보. at = 질문을 보낼 때 원고 위치(서버가 범위 글에서 찾은 곳 — 모르면 null),
// scope.fingerprint = 그때 원고 전체 지문(docHash). 지문이 같으면 그 자리 그대로, 다르면 원래 글이 한 곳에 있을 때만
export function proposalW(p, scope) {
  p = p || {};
  const at = Number.isInteger(p.at) ? p.at : null;
  const find = String(p.find ?? "");
  return { text: find, sel_start: at, sel_end: at == null ? null : at + find.length, insert: false,
    doc_hash: (scope && scope.fingerprint) || "", before: "" };
}

// 지금 원고(cur)에 제안을 넣을 편집 → { state: same | moved | lost, from, to, text(바꿀 글 그대로) }
export function proposalEdit(cur, p, scope) {
  const plan = planApply(cur, proposalW(p, scope));
  if (plan.state === "lost") return { state: "lost", from: null, to: null, text: "" };
  return { state: plan.state, from: plan.from, to: plan.to, text: String((p && p.replace) ?? "") };
}

// [모두 적용]: 제안 여러 개를 차례로 원고 글에 넣어 본다(뒤쪽 자리부터 — 앞쪽 위치가 그대로 남게) → { value, applied, lost }
// (indices = 넣을 제안 번호, 이미 적용 · 버린 것은 부른 쪽이 뺌). 화면은 value를 한 번에 넣어 실행 취소 한 번으로 되돌아가게
export function applyProposals(value, proposals, scope, indices) {
  let v = String(value ?? "");
  const applied = [];
  const lost = [];
  const order = (indices || []).filter((i) => proposals && proposals[i])
    .sort((a, b) => (proposals[b].at ?? -1) - (proposals[a].at ?? -1) || b - a);
  let first = true;
  for (const i of order) {
    // 첫 넣기 뒤로는 지문이 달라지므로 원래 글을 다시 찾는다(같은 자리 · 한 곳뿐일 때만)
    const e = proposalEdit(v, proposals[i], first ? scope : { ...scope, fingerprint: "" });
    if (e.state === "lost") { lost.push(i); continue; }
    v = v.slice(0, e.from) + e.text + v.slice(e.to);
    applied.push(i);
    first = false;
  }
  return { value: v, applied: applied.sort((a, b) => a - b), lost: lost.sort((a, b) => a - b) };
}

// 제안이 원래 글의 [@인용키]를 빠뜨렸는지 (AI 규칙 위반 — 넣기 전에 알려 줌) → 빠진 키 목록
const KEY_IN_RE = /@([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&\-+?<>~/]*)/gu;
const citeKeysIn = (s) => new Set([...String(s ?? "").matchAll(/\[[^\[\]]*@[^\[\]]*\]/g)]
  .flatMap((m) => [...m[0].matchAll(KEY_IN_RE)].map((k) => k[1].replace(/[.,]+$/, ""))));
export function droppedCites(find, replace) {
  const after = citeKeysIn(replace);
  return [...citeKeysIn(find)].filter((k) => !after.has(k));
}

// ------------------------------------------------------------------ 대화 줄
// 메시지 목록(id 순) → 보일 순서: 질문 다음에 그 질문의 답(scope.reply_to). 답이 늦게 와도 질문 바로 아래
export function threadOrder(messages) {
  const list = (messages || []).slice().sort((a, b) => a.id - b.id);
  const replies = new Map();
  const users = new Set(list.filter((m) => m.role === "user").map((m) => m.id));
  for (const m of list) {
    const to = m.role === "assistant" && m.scope && m.scope.reply_to;
    if (to && users.has(to)) replies.set(to, [...(replies.get(to) || []), m]);
  }
  const out = [];
  for (const m of list) {
    if (m.role === "assistant" && m.scope && users.has(m.scope.reply_to)) continue;
    out.push(m);
    if (m.role === "user") out.push(...(replies.get(m.id) || []));
  }
  return out;
}

// 답을 아직 못 받은 질문 → [{ message, job }] (job = 그 질문의 가장 최근 작업 — 서버 GET …/chat의 jobs)
export function unanswered(messages, jobs = {}) {
  const answered = new Set((messages || []).filter((m) => m.role === "assistant" && m.scope).map((m) => m.scope.reply_to));
  return (messages || []).filter((m) => m.role === "user" && !answered.has(m.id))
    .map((m) => ({ message: m, job: jobs[String(m.id)] || null }));
}

// 지금 답을 기다리는 작업 (없으면 null) — 하나만 (서버도 원고마다 하나만 받음)
export function waitingJob(messages, jobs = {}) {
  const hit = unanswered(messages, jobs).find((x) => x.job && (x.job.status === "queued" || x.job.status === "running"));
  return hit ? hit.job : null;
}

// Alt+C (macOS Option+C): AI 대화 열기 · 입력 칸으로. Ctrl · ⌘ · Shift가 같이 눌렸거나 누르고 있는 반복이면 아님
export const CHAT_SHORTCUT = "Alt+C";
export function isChatKey(e) {
  return !!e && e.code === "KeyC" && !!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat;
}

export const PROPOSAL_STATE_TEXT ={ applied: "적용함", discarded: "버림", lost: "자리를 못 찾음" };

// 대화 범위 칩 문구: "문단 · 제2장 제1절 (230자)"
export function scopeChipText(scope) {
  if (!scope || !scope.kind || scope.kind === "none") return "범위 없음";
  const name = { sel: "고른 글", para: "문단", section: "절", chapter: "장" }[scope.kind] || "범위";
  const label = String(scope.label || "").replace(/ · (고른 글|문단|목록)$/, "");
  return `${name}${label ? ` · ${label}` : ""}${scope.chars ? ` (${String(scope.chars).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}자)` : ""}`;
}

// 다음 질문의 기본 범위: 고른 글 → 커서 문단 → 이 절 (aiScope(value, s, e, kind) 결과 중 처음으로 되는 것)
export function autoScope(scopeFn) {
  for (const k of ["sel", "para", "section"]) {
    const r = scopeFn(k);
    if (r && r.ok && (k !== "sel" || !r.fallback)) return r;
  }
  return null;
}

// ------------------------------------------------------------------ 장 · 절 일괄 처리
export const BATCH_MAX = 30; // 서버 mschat.BATCH_MAX와 같게 (진행 중 작업 상한 30 안)
export const BATCH_MODES = new Set(["polish", "academic", "concise", "expand", "to_en", "to_ko"]);

// 범위(aiScope 결과)의 문단 → 일괄 요청 items (앞뒤 공백 뺀 글 · 넣을 자리 · 앞 글 200자)
export function batchItems(value, sc, max = BATCH_MAX) {
  const v = String(value ?? "");
  return (sc && sc.ok ? sc.paras : []).slice(0, max).map((p) => {
    let { from, to } = p;
    while (from < to && /\s/.test(v[from])) from++;
    while (to > from && /\s/.test(v[to - 1])) to--;
    return { text: v.slice(from, to), sel_start: from, sel_end: to, before: v.slice(Math.max(0, from - 200), from) };
  }).filter((it) => it.text);
}

// 일괄 처리 문단 하나의 상태 (작업 상태 + 넣었는지 · 건너뛰었는지)
export function batchItemState(j) {
  if (!j) return "missing";
  if (j.status === "failed") return "failed";
  if (j.status === "cancelled") return "cancelled";
  if (j.status !== "succeeded") return "running";
  if (!(j.result && j.result.text)) return "expired";
  const h = j.write && j.write.handled;
  return h === "applied" ? "applied" : h === "dismissed" ? "skipped" : "ready";
}
export const BATCH_STATE_TEXT = {
  running: "만드는 중", ready: "넣기 전", applied: "넣음", skipped: "건너뜀", failed: "실패", cancelled: "취소함", expired: "지워짐",
  missing: "없음", lost: "자리를 못 찾음",
};

export function batchCounts(jobs) {
  const c = { total: 0, running: 0, ready: 0, applied: 0, skipped: 0, failed: 0 };
  for (const j of jobs || []) {
    c.total++;
    const st = batchItemState(j);
    if (st === "running") c.running++;
    else if (st === "ready") c.ready++;
    else if (st === "applied") c.applied++;
    else if (st === "skipped") c.skipped++;
    else c.failed++;
  }
  return c;
}

// 일괄 처리 머리줄: "제2장 제1절 · 학술 문체로 · 문단 12개 (넣기 전 8 · 만드는 중 4)"
export function batchTitle(batch, counts, modeName = "") {
  const b = batch || {};
  const parts = [["넣기 전", counts.ready], ["만드는 중", counts.running], ["넣음", counts.applied], ["건너뜀", counts.skipped],
    ["실패", counts.failed]].filter((x) => x[1]).map((x) => `${x[0]} ${x[1]}`);
  return `${[b.label, modeName].filter(Boolean).join(" · ")} · 문단 ${counts.total}개${parts.length ? ` (${parts.join(" · ")})` : ""}`;
}

// 문단 결과 하나를 지금 원고에 넣을 편집 (planApply — 원래 문단이 그대로 한 곳에 있을 때만) → { state, from, to, text }
export function batchEdit(cur, j) {
  const w = (j && j.write) || {};
  const plan = planApply(cur, w);
  if (plan.state === "lost") return { state: "lost", from: null, to: null, text: "" };
  return { state: plan.state, from: plan.from, to: plan.to, text: insertionText(cur, plan.from, (j.result && j.result.text) || "", false) };
}

// [모두 적용]: 넣기 전 결과를 차례로 원고 글에 넣어 본다(문단마다 planApply — 앞 문단을 바꾸면 뒤 문단은 원래 글로 다시 찾음).
// → { value(넣은 뒤 글), applied: [작업 id], lost: [작업 id] }. 화면은 value를 한 번에 넣어 실행 취소 한 번으로 되돌아가게
export function applyBatch(value, jobs) {
  let v = String(value ?? "");
  const applied = [];
  const lost = [];
  // 뒤 문단부터: 지문이 같은 첫 넣기는 그 자리 그대로, 나머지는 앞쪽 위치가 그대로라 원래 글로 다시 찾기 쉬움
  const ready = (jobs || []).filter((j) => batchItemState(j) === "ready")
    .sort((a, b) => (Number((b.write || {}).sel_start) || 0) - (Number((a.write || {}).sel_start) || 0));
  for (const j of ready) {
    const e = batchEdit(v, j);
    if (e.state === "lost") { lost.push(j.id); continue; }
    v = v.slice(0, e.from) + e.text + v.slice(e.to);
    applied.push(j.id);
  }
  return { value: v, applied, lost };
}
