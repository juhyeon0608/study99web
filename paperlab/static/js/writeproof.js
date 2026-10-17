// 맞춤법 · 띄어쓰기 점검 + 초록 만들기 (2026-10-17 제품 책임자 요청 — docs/specs/writing-proofread.md).
// 순수 함수만 (tests/js/writeproof.test.mjs). 화면은 writeproofui.js, 서버 검사 · 프롬프트는 paperlab/proofread.py.
//
// 점검: 고른 범위(고른 글 · 이 문단 · 이 절 · 이 장 · 전체)를 4000자 안쪽 조각으로 나눠 조각마다 'proofread' 작업을 만든다.
// 작업 결과는 고칠 곳 목록 [{find, replace, type, reason, at, before, after}] — 원고는 바꾸지 않는다. 고칠 때마다 지금
// 원고에서 그 자리를 다시 찾고(at 자리 글이 find와 같은지 → 아니면 앞뒤 글로 한 곳만 찾기) 못 찾으면 고치지 않는다.

export const PROOF_SCOPES = [["sel", "고른 글"], ["para", "이 문단"], ["sec", "이 절"], ["chap", "이 장"], ["all", "전체"]];
export const CHUNK_MAX = 4000; // 서버 proofread.CHUNK_MAX와 같게
export const RUN_CHUNKS = 8; // 한 번에 만드는 작업 수 (사용자당 진행 중 작업 30개 한도) — 남으면 [이어서 점검]
export const PROOF_TYPES = ["맞춤법", "띄어쓰기", "문법", "표현"];
export const PROOF_SHORTCUT = "Alt+P";
export const PROOF_KEY = "paperlab.proof"; // + .원고번호 — 이 브라우저에 무시 · 고침 표시 {run, hidden, fixed}

const FENCE_RE = /^\s{0,3}(```|~~~)/;
const HEAD_RE = /^(#{1,6})[ \t]+(.*)$/;
// 제목 글에서 닫는 # · 장 · 절 번호 · 1.2. 번호를 뺀 이름
const headText = (s) => s.replace(/\s+#+\s*$/, "").replace(/^제\s*\d+\s*[장절]\s*/, "").replace(/^\d+(?:\.\d+)*\.?\s+/, "").trim();

// 원고의 제목 줄 [{from, to(줄 끝), level, text(기호 · 번호 뺀 제목)}] — 코드 블록 안은 제목이 아님
export function headingLines(value) {
  const v = String(value ?? "");
  const out = [];
  let pos = 0;
  let fence = false;
  for (const line of v.split("\n")) {
    if (FENCE_RE.test(line)) fence = !fence;
    else if (!fence) {
      const m = line.match(HEAD_RE);
      if (m) out.push({ from: pos, to: pos + line.length, level: m[1].length, text: headText(m[2]) });
    }
    pos += line.length + 1;
  }
  return out;
}

// 앞뒤 공백을 뺀 범위 (빈 범위면 null)
function trimmed(v, s, e) {
  while (s < e && /\s/.test(v[s])) s++;
  while (e > s && /\s/.test(v[e - 1])) e--;
  return s < e ? { from: s, to: e } : null;
}

// 점검 범위 → {from, to} | null. sel = 고른 글, para = 커서 문단(빈 줄로 나뉨), sec = 커서가 있는 절(### 까지의 제목부터
// 다음 같은 · 윗 단계 제목 앞까지), chap = 커서가 있는 장(## 까지), all = 전체. 제목 줄도 범위에 들어감(번호는 서버가 지킴)
export function scopeRange(value, start, end, scope) {
  const v = String(value ?? "");
  const s0 = Math.max(0, Math.min(start | 0, v.length));
  const e0 = Math.max(s0, Math.min(end | 0, v.length));
  if (scope === "sel") return s0 < e0 ? trimmed(v, s0, e0) : null;
  if (scope === "all") return trimmed(v, 0, v.length);
  if (scope === "para") {
    const lines = v.split("\n");
    let pos = 0;
    let row = 0;
    for (; row < lines.length - 1 && pos + lines[row].length < s0; row++) pos += lines[row].length + 1;
    if (!lines[row].trim()) return null;
    let a = row;
    while (a > 0 && lines[a - 1].trim()) a--;
    let b = row;
    while (b < lines.length - 1 && lines[b + 1].trim()) b++;
    const from = lines.slice(0, a).reduce((n, l) => n + l.length + 1, 0);
    const to = lines.slice(0, b + 1).reduce((n, l) => n + l.length + 1, 0) - 1;
    return trimmed(v, from, to);
  }
  const level = scope === "sec" ? 3 : scope === "chap" ? 2 : 0;
  if (!level) return null;
  const heads = headingLines(v).filter((h) => h.level <= level);
  const own = heads.filter((h) => h.from <= s0).pop();
  const from = own ? own.from : 0;
  const next = heads.find((h) => h.from > from);
  return trimmed(v, from, next ? next.from : v.length);
}

// 범위를 max자 안쪽 조각으로: 빈 줄 → 줄바꿈 → 문장 끝 → 띄어쓰기 순서로 자르고, 글자(한글 · 영문)가 없는 조각은 뺌
export function chunkRanges(value, from, to, max = CHUNK_MAX) {
  const v = String(value ?? "");
  const out = [];
  let s = Math.max(0, from | 0);
  to = Math.min(v.length, to | 0);
  while (s < to) {
    while (s < to && /\s/.test(v[s])) s++;
    if (s >= to) break;
    let e = Math.min(to, s + max);
    if (e < to) {
      const win = v.slice(s, e);
      const min = Math.floor(max * 0.3);
      let cut = win.lastIndexOf("\n\n");
      if (cut < min) cut = win.lastIndexOf("\n");
      if (cut < min) {
        const ends = [...win.matchAll(/[.!?。…](?=\s)/g)];
        cut = ends.length ? ends[ends.length - 1].index + 1 : -1;
      }
      if (cut < min) cut = win.lastIndexOf(" ");
      if (cut >= min) e = s + cut;
      else if (/[\uD800-\uDBFF]/.test(v[e - 1])) e--; // 그림 문자 반쪽을 자르지 않게
    }
    const r = trimmed(v, s, e);
    if (r && /[가-힣A-Za-z]/.test(v.slice(r.from, r.to))) out.push(r);
    s = e;
  }
  return out;
}

// 한 번에 만들 조각 (RUN_CHUNKS개까지) + 남은 범위 시작(next — 없으면 null)
export function planRun(value, from, to, { max = CHUNK_MAX, limit = RUN_CHUNKS } = {}) {
  const all = chunkRanges(value, from, to, max);
  return { chunks: all.slice(0, limit), next: all.length > limit ? all[limit].from : null, end: to };
}

// 점검 묶음 이름 (작업 params.run — 서버는 [0-9a-z]{1,32}만 받음)
export function newRunId(now = Date.now(), rnd = Math.random()) {
  return `${now.toString(36)}${Math.floor(rnd * 36 ** 4).toString(36).padStart(4, "0")}`.slice(0, 32);
}

function occurrences(hay, needle, max = 2) {
  const out = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i >= 0 && out.length < max) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

// 지금 원고에서 고칠 곳의 자리 → 위치 | -1. 원래 자리(at) 글이 find와 같고 그 앞이나 뒤 글(8자까지)도 같으면 그 자리
// (앞에서 글이 늘고 줄어 같은 짧은 글자열의 다른 곳이 원래 자리로 밀려온 경우를 막음), 아니면 앞 글+find+뒤 글 →
// 앞 글+find → find+뒤 글 순서로 원고에 딱 한 곳만 있을 때 그 자리. 못 찾으면(이미 고쳤거나 글이 바뀜) -1 — 고치지 않음
export const CTX_CHECK = 8;
export function locateIssue(cur, it) {
  cur = String(cur ?? "");
  const f = String((it && it.find) || "");
  if (!f) return -1;
  const at = it.at;
  const pre = String(it.before || "");
  const post = String(it.after || "");
  if (Number.isInteger(at) && at >= 0 && cur.slice(at, at + f.length) === f) {
    const a = pre.slice(-CTX_CHECK);
    const b = post.slice(0, CTX_CHECK);
    const end = at + f.length;
    // 앞뒤 글이 아예 없던 항목(조각 전체가 find)은 자리만으로
    if ((!a && !b) || (a && at >= a.length && cur.slice(at - a.length, at) === a) || (b && cur.slice(end, end + b.length) === b)) return at;
  }
  for (const [a, b] of [[pre, post], [pre, ""], ["", post]]) {
    if (!a && !b) continue;
    if ((a ? a.length : 0) + (b ? b.length : 0) < 4) continue; // 앞뒤 글이 너무 짧으면 엉뚱한 곳일 수 있음
    const hits = occurrences(cur, a + f + b);
    if (hits.length === 1) return hits[0] + a.length;
  }
  return -1;
}

// [고치기] 한 곳 → 편집 {from, to, text, selStart, selEnd} | null (자리를 못 찾으면 null)
export function fixEdit(cur, it) {
  const at = locateIssue(cur, it);
  if (at < 0) return null;
  const rep = String(it.replace ?? "");
  return { from: at, to: at + String(it.find).length, text: rep, selStart: at, selEnd: at + rep.length };
}

// [모두 고치기]: 찾은 곳만 한꺼번에 바꾼 새 원고 → {value, fixed: [항목], lost: [항목], first(처음 바뀐 위치)}.
// 서로 겹치는 자리는 앞의 것만 (뒤 것은 lost)
export function applyAll(cur, items) {
  cur = String(cur ?? "");
  const lost = [];
  const found = [];
  for (const it of items || []) {
    const at = locateIssue(cur, it);
    if (at < 0) lost.push(it); else found.push({ it, at });
  }
  found.sort((a, b) => a.at - b.at);
  let out = "";
  let p = 0;
  const fixed = [];
  for (const { it, at } of found) {
    if (at < p) { lost.push(it); continue; }
    out += cur.slice(p, at) + String(it.replace ?? "");
    p = at + String(it.find).length;
    fixed.push(it);
  }
  out += cur.slice(p);
  return { value: out, fixed, lost, first: fixed.length ? found.find((x) => x.it === fixed[0]).at : null };
}

// 항목 열쇠 (무시 · 고침 표시): 작업이 정한 원래 자리 + 글 — 원고가 바뀌어도 같은 항목이면 같음
export const issueKey = (it) => `${it.at}\u0001${it.find}\u0001${it.replace}`;

// 이 원고의 점검 작업들(GET /api/jobs?kind=proofread) → 묶음(run)별 {run, jobs(조각 순), created} — 새것이 앞
export function proofRuns(jobs) {
  const by = new Map();
  for (const j of jobs || []) {
    if (!j || j.kind !== "proofread" || !j.proof) continue;
    const id = j.proof.run || `j${j.id}`;
    if (!by.has(id)) by.set(id, { run: id, jobs: [], created: 0 });
    const r = by.get(id);
    r.jobs.push(j);
    r.created = Math.max(r.created, Date.parse(j.created_at || "") || 0);
  }
  const runs = [...by.values()];
  for (const r of runs) r.jobs.sort((a, b) => (a.proof.chunk - b.proof.chunk) || (Number(a.id) - Number(b.id)));
  return runs.sort((a, b) => b.created - a.created);
}

// 묶음 하나의 상태: 조각 수 · 끝남 · 진행 중 · 실패, 점검한 끝 위치(last) · 남은 범위 끝(end — 없으면 null)
export function runStatus(run) {
  const jobs = (run && run.jobs) || [];
  // 다시 시도하면 같은 조각 작업이 둘 — 조각마다 마지막 것만
  const byChunk = new Map();
  for (const j of jobs) byChunk.set(j.proof.chunk, j);
  const cur = [...byChunk.values()];
  const active = cur.filter((j) => j.status === "queued" || j.status === "running").length;
  const failed = cur.filter((j) => j.status === "failed" || j.status === "cancelled");
  const done = cur.filter((j) => j.status === "succeeded").length;
  const total = cur.reduce((m, j) => Math.max(m, j.proof.chunks || 1), 0);
  // [이어서 점검]의 기준 = 마지막 조각 (그 조각을 만들 때의 원고 지문 · 길이 · 끝 글 · 남은 범위 끝)
  const back = (cur[cur.length - 1] || { proof: {} }).proof;
  const last = (back.offset || 0) + (back.length || 0);
  const end = Number.isInteger(back.end) ? back.end : null;
  return { jobs: cur, active, failed, done, total: Math.max(total, cur.length), last, end,
    docLen: Number.isInteger(back.doc_len) ? back.doc_len : null, tail: back.tail || "", hash: back.doc_hash || "",
    scope: (cur[0] && cur[0].proof.scope) || "" };
}

// 묶음의 고칠 곳 (끝난 조각만, 원고 순) — hidden(무시 · 고침 열쇠)은 뺌
export function runItems(run, hidden = new Set()) {
  const out = [];
  for (const j of runStatus(run).jobs) {
    if (j.status !== "succeeded" || !j.result || !Array.isArray(j.result.issues)) continue;
    for (const it of j.result.issues) {
      if (!it || typeof it.find !== "string" || typeof it.replace !== "string" || !Number.isInteger(it.at)) continue;
      const key = issueKey(it);
      if (!hidden.has(key)) out.push({ ...it, key, type: PROOF_TYPES.includes(it.type) ? it.type : "표현" });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// [이어서 점검]: 남은 범위를 지금 원고 위치로 → {from, to} | null. 원고가 그대로면(지문 같음) 그 위치,
// 바뀌었으면 마지막 조각 끝 글(tail)을 한 곳에서 찾아 그 뒤부터, 끝은 원고 길이 차이만큼 옮김. 못 찾으면 null
export function continueRange(cur, st, hash) {
  cur = String(cur ?? "");
  if (!st || st.end == null || st.last >= st.end) return null;
  let from = st.last;
  let to = st.end;
  if (!(st.hash && hash === st.hash)) {
    const hits = st.tail && st.tail.length >= 8 ? occurrences(cur, st.tail) : [];
    if (hits.length !== 1) return null;
    from = hits[0] + st.tail.length;
    to = Number.isInteger(st.docLen) ? st.end + (cur.length - st.docLen) : cur.length;
  }
  to = Math.min(cur.length, Math.max(from, to));
  return from < to ? { from, to } : null;
}

// 저장해 둔 무시 · 고침 표시 (사생활 보호 창 · 막힌 저장소 · 깨진 값이면 빈 것)
export function loadMarks(storage, mid, run) {
  try {
    const v = JSON.parse(storage.getItem(`${PROOF_KEY}.${mid}`) || "null");
    if (!v || typeof v !== "object" || v.run !== run) return { hidden: new Set(), fixed: new Set() };
    const list = (x) => new Set((Array.isArray(x) ? x : []).filter((k) => typeof k === "string").slice(-3000));
    return { hidden: list(v.hidden), fixed: list(v.fixed) };
  } catch {
    return { hidden: new Set(), fixed: new Set() };
  }
}
export function saveMarks(storage, mid, run, marks) {
  try {
    storage.setItem(`${PROOF_KEY}.${mid}`, JSON.stringify({ run, hidden: [...marks.hidden].slice(-3000), fixed: [...marks.fixed].slice(-3000) }));
  } catch { /* 저장 못 함 — 이번만 */ }
}

// 제출 전 점검표의 한 줄 (AI를 부르지 않음 — 마지막 점검 결과로만)
export function proofCheckText({ ran = false, active = 0, open = 0, failed = 0 } = {}) {
  if (!ran) return "AI 맞춤법 점검: 아직 안 했어요";
  if (active) return `AI 맞춤법 점검: 점검 중${open ? ` · 지금까지 고칠 곳 ${open}건` : ""}`;
  const tail = failed ? ` · 실패한 조각 ${failed}개` : "";
  return open ? `AI 맞춤법 점검: 고칠 곳 ${open}건${tail}` : `AI 맞춤법 점검: 고칠 곳 없음${tail}`;
}

// 점검 패널 열기 · 닫기 단축키 Alt+P (macOS Option+P). Ctrl · ⌘ · Shift가 같이 눌렸거나 반복이면 아님
export function isProofKey(e) {
  return !!e && e.code === "KeyP" && !!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat;
}

// ------------------------------------------------------------------ 초록 만들기 (영문 초록 · 국문 초록)
// 영문 초록(abstract_en): 국문 초록(또는 고른 글)을 AI에 보내고 결과를 영문 초록 자리에 넣는다. 국문 초록(abstract_ko)은 반대.
// 초록 표지는 두 모양을 다 받는다 — 굵은 줄('**국문초록**' · '**Abstract** — 글', 국내 학술지 · IMRaD 양식과 제출 전
// 점검표가 권하는 모양)과 제목('## 국문 초록'). 굵은 줄 초록은 다음 제목이나 다음 앞뒤 표지 굵은 줄(**주제어** ·
// **Keywords** · 다른 초록 · 목차) 앞까지, 제목 초록은 다음 같은 · 윗 단계 제목(또는 그 표지 굵은 줄) 앞까지.
// 대상 초록이 없으면 원문 초록 뒤(뒤따르는 **주제어** 줄까지 지나서)에 원문과 같은 모양으로 새로 만든다 — 굵은 줄 원고에
// '## Abstract' 장을 만들면 첫 장이 되어 쪽 번호가 거기서 시작하므로(점검표 abstract-chapter) 굵은 줄('**Abstract**')로.
// 넣기는 AI 결과 패널의 넣기(writeai.js planApply · 원고가 바뀌었으면 확인)를 그대로 쓴다 — 여기서는 보낼 글과 넣을 자리만
const ABS_KO_RE = /^(?:국문\s*)?(?:초\s*록|요\s*약)(?:\s*[(（].*)?$/; // writecheck.js와 같게
const ABS_EN_RE = /^abstract\b/i;
const KEYWORD_RE = /^(?:(?:국문\s*|영문\s*)?(?:주\s*제\s*어|핵\s*심\s*어|키\s*워\s*드|검\s*색\s*어|색\s*인\s*어)|key\s*-?\s*words?|index\s+terms)(?:\s*[(（].*)?$/i;
const FRONT_RE = /^(?:목\s*차|차\s*례|(?:table\s+of\s+)?contents|감사의\s*글|acknowledg)/i;
const LABEL_RE = /^(\s*)\*\*([^*\n]+?)\*\*(.*)$/;
const isStop = (t) => ABS_KO_RE.test(t) || ABS_EN_RE.test(t) || KEYWORD_RE.test(t) || FRONT_RE.test(t);
export const ABSTRACT_MODES = {
  abstract_en: { src: ABS_KO_RE, dst: ABS_EN_RE, heading: "Abstract", keywords: "Keywords", kw: /^key\s*-?\s*words?\s*[:：]\s*/im,
    none: "국문 초록을 찾지 못했어요. 서론 앞에 **국문초록** 줄과 초록을 쓰거나 초록 글을 골라 주세요" },
  abstract_ko: { src: ABS_EN_RE, dst: ABS_KO_RE, heading: "국문초록", keywords: "주제어", kw: /^주\s*제\s*어\s*[:：]\s*/m,
    none: "영문 초록을 찾지 못했어요. 서론 앞에 **Abstract** 줄과 초록을 쓰거나 초록 글을 골라 주세요" },
};
export const ABSTRACT_MAX = 6000;

// 초록을 찾을 때 보는 표지 줄: 제목 줄 {kind: "head", level} + 줄 머리 굵은 글 {kind: "label", strict}. 코드 블록 안은 아님.
// text = 표지 이름(제목은 기호 · 번호 뺌, 굵은 줄은 끝 ':' · '.' 뺌), bodyAt = 본문 시작(굵은 줄 뒤에 글이 이어지면 그 글 첫 자리).
// strict = 굵은 글 뒤가 비었거나 ':' · '—' 등으로 이어짐 — 본문 안 '**중요한** 점은…' 같은 강조는 표지가 아님
export function abstractMarks(value) {
  const v = String(value ?? "");
  const out = [];
  let pos = 0;
  let fence = false;
  for (const line of v.split("\n")) {
    const end = pos + line.length;
    if (FENCE_RE.test(line)) fence = !fence;
    else if (!fence) {
      const h = line.match(HEAD_RE);
      const b = !h && line.match(LABEL_RE);
      if (h) out.push({ kind: "head", from: pos, to: end, level: h[1].length, text: headText(h[2]), strict: true, bodyAt: end + 1 });
      else if (b) {
        const raw = b[2].trim();
        const rest = b[3];
        const sep = rest.match(/^\s*(?:[:：—–-]\s*)?/)[0];
        const restAt = pos + b[1].length + 2 + b[2].length + 2;
        out.push({ kind: "label", from: pos, to: end, level: 0, text: raw.replace(/[\s:：.]+$/, ""),
          strict: !rest.trim() || /^\s*[:：—–-]/.test(rest) || /[:：.]$/.test(raw),
          bodyAt: rest.slice(sep.length).trim() ? restAt + sep.length : end + 1 });
      }
    }
    pos = end + 1;
  }
  return out;
}

// i번째 표지의 절이 끝나는 다음 표지 번호 (없으면 marks.length)
function stopAfter(marks, i) {
  const head = marks[i];
  for (let j = i + 1; j < marks.length; j++) {
    const k = marks[j];
    if (k.kind === "head" ? head.kind === "label" || k.level <= head.level : k.strict && isStop(k.text)) return j;
  }
  return marks.length;
}

function trimEnd(v, from, to) {
  while (to > from && /\s/.test(v[to - 1])) to--;
  return Math.max(from, to);
}

// 표지(re)가 붙은 초록 → {kind, head, bodyFrom, bodyTo(뒤 공백 뺀 끝), blockTo(뒤따르는 주제어 · Keywords 줄까지)} | null.
// needBody = 본문이 빈 표지는 건너뜀 (원문 초록 찾기)
export function findSection(value, re, { needBody = false } = {}) {
  const v = String(value ?? "");
  const marks = abstractMarks(v);
  for (let i = 0; i < marks.length; i++) {
    const head = marks[i];
    if (!re.test(head.text)) continue;
    let j = stopAfter(marks, i);
    const bodyFrom = Math.min(v.length, head.bodyAt);
    const bodyTo = trimEnd(v, bodyFrom, j < marks.length ? marks[j].from : v.length);
    let blockTo = bodyTo;
    while (j < marks.length && marks[j].kind === "label" && KEYWORD_RE.test(marks[j].text)) {
      const k = stopAfter(marks, j);
      blockTo = trimEnd(v, bodyFrom, k < marks.length ? marks[k].from : v.length);
      j = k;
    }
    if (!needBody || v.slice(bodyFrom, bodyTo).trim()) return { kind: head.kind, head, bodyFrom, bodyTo, blockTo };
  }
  return null;
}

// 초록 만들기 계획 → {error} | {text, at, append}. text = 보낼 초록(고른 글 또는 원문 초록),
// at = 넣을 자리(빈 대상 표지 줄 끝 · 대상 초록 끝 · 원문 초록 묶음 끝 · 원문 초록이 없으면 고른 글 끝),
// append = 대상 초록에 이미 글이 있어 그 끝에 덧붙임
export function abstractPlan(value, selStart, selEnd, mode) {
  const v = String(value ?? "");
  const m = ABSTRACT_MODES[mode];
  if (!m) return { error: "알 수 없는 초록 모드예요" };
  const sec = findSection(v, m.src, { needBody: true });
  let src = selStart < selEnd ? trimmed(v, selStart, selEnd) : null;
  if (!src && sec) src = trimmed(v, sec.bodyFrom, sec.bodyTo);
  if (!src) return { error: m.none };
  const text = v.slice(src.from, src.to);
  if (text.length > ABSTRACT_MAX) return { error: `초록이 너무 길어요. ${ABSTRACT_MAX.toLocaleString()}자 안쪽으로 골라 주세요` };
  const dst = findSection(v, m.dst);
  if (!dst) return { text, at: sec ? sec.blockTo : src.to, append: false };
  if (!v.slice(dst.bodyFrom, dst.bodyTo).trim()) return { text, at: dst.head.to, append: false };
  return { text, at: dst.bodyTo, append: true };
}

// 넣을 글: 대상 초록 표지가 지금 원고에 없으면 표지째 — 원문 초록과 같은 모양(굵은 줄이면 '**Abstract**' + '**Keywords**:'
// 줄, 제목이면 같은 단계 제목), 원문 초록도 없으면 굵은 줄. AI 결과가 이미 제목 · 굵은 줄로 시작하면 그대로
export function withAbstractHeading(mode, cur, result) {
  const m = ABSTRACT_MODES[mode];
  const r = String(result ?? "");
  if (!m || !r.trim() || /^\s*(?:#|\*\*)/.test(r)) return r;
  const dst = findSection(cur, m.dst);
  const src = dst ? null : findSection(cur, m.src, { needBody: true });
  const style = dst ? dst.kind : src ? src.kind : "label";
  let body = r.trim();
  if (style === "label") body = body.replace(m.kw, `**${m.keywords}**: `);
  if (dst) return body;
  const head = style === "label" ? `**${m.heading}**` : `${"#".repeat(src.head.level)} ${m.heading}`;
  return `${head}\n\n${body}`;
}
