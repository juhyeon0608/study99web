// AI 글쓰기 결과 넣기 (2026-10-16 백그라운드 AI): 원고 지문 · 넣을 자리 찾기 · 바뀌는 부분 — 순수 함수만 (tests/js/writeai.test.mjs)
// 글쓰기 도우미는 서버 작업이라 창 · 탭을 닫아도 계속되고, 결과는 나중에 원고에 넣는다. 그 사이 원고가 바뀌었을 수 있으므로
// 넣기 전에 지금 원고에서 자리를 다시 찾고, 원고가 바뀌었으면 바뀌는 부분을 보여 주고 물어본다(새 글을 몰래 덮어쓰지 않음).

// 원고 전체 글의 짧은 지문 (FNV-1a 32비트 + 길이 — 보안용이 아니라 '그 사이 바뀌었는지'만). 서버는 [0-9a-z]{1,64}만 받음
export function docHash(text) {
  const s = String(text ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0") + s.length.toString(36);
}

// 고른 범위의 앞뒤 공백을 뺀다 — 서버가 글을 trim해서 저장하므로 범위도 같은 글을 가리키게
export function trimRange(value, s, e) {
  while (s < e && /\s/.test(value[s])) s++;
  while (e > s && /\s/.test(value[e - 1])) e--;
  return { s, e };
}

// 작업을 시작할 때 함께 보내는 넣을 자리 정보 (POST /api/ai/write)
export function writeAnchor(value, s, e, insert) {
  return { sel_start: s, sel_end: e, insert: !!insert, doc_hash: docHash(value), before: value.slice(Math.max(0, s - 200), s) };
}

function occurrences(hay, needle, max = 3) {
  const out = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i >= 0 && out.length < max) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

// 지금 원고(cur)에 결과를 넣을 계획. w = 작업의 write {text, sel_start, sel_end, insert, doc_hash, before}
// → { state, from, to, old }
//   same  — 원고가 작업을 시작할 때 그대로: 원래 자리에 바로 넣어도 됨
//   moved — 원고는 바뀌었지만 바꿀 글(또는 넣을 자리)을 한 곳에서 찾음: 바뀌는 부분을 보여 주고 물어봐야 함
//   lost  — 바꿀 글이 없어졌거나 여러 곳: 자동으로 넣지 않음 (커서 위치에 넣기 · 복사만)
export function planApply(cur, w) {
  cur = String(cur ?? "");
  w = w || {};
  const s = w.sel_start;
  const e = w.sel_end;
  const okRange = Number.isInteger(s) && Number.isInteger(e) && s >= 0 && s <= e && e <= cur.length;
  if (okRange && w.doc_hash && docHash(cur) === w.doc_hash) return { state: "same", from: s, to: e, old: cur.slice(s, e) };
  if (!w.insert) {
    const text = String(w.text || "");
    if (!text) return { state: "lost", from: null, to: null, old: "" };
    if (okRange && cur.slice(s, e) === text) return { state: "moved", from: s, to: e, old: text };
    const at = occurrences(cur, text);
    if (at.length === 1) return { state: "moved", from: at[0], to: at[0] + text.length, old: text };
    return { state: "lost", from: null, to: null, old: text };
  }
  const before = String(w.before || "");
  if (okRange && before && s >= before.length && cur.slice(s - before.length, s) === before) return { state: "moved", from: s, to: s, old: "" };
  if (before.length >= 20) {
    const at = occurrences(cur, before);
    if (at.length === 1) {
      const p = at[0] + before.length;
      return { state: "moved", from: p, to: p, old: "" };
    }
  }
  if (okRange && !before && s === 0) return { state: "moved", from: 0, to: 0, old: "" }; // 원고 맨 앞
  return { state: "lost", from: null, to: null, old: "" };
}

// 실제로 넣을 글: 바꾸기는 결과 그대로, 커서 뒤에 넣기는 앞 문단과 띄우고 끝에 줄바꿈 (예전 창의 [커서 위치에 넣기]와 같음)
export function insertionText(cur, at, result, insert) {
  const t = String(result ?? "").trim();
  if (!insert) return t;
  return (at > 0 && String(cur ?? "")[at - 1] !== "\n" ? "\n\n" : "") + t + "\n";
}

// 바뀌는 부분 보기: 낱말 단위 차이 [{op: "same" | "del" | "ins", text}]. 너무 길면 통째로 지움 · 넣음
export function wordDiff(a, b, maxCells = 2_000_000) {
  const A = String(a ?? "").split(/(\s+)/).filter((x) => x !== "");
  const B = String(b ?? "").split(/(\s+)/).filter((x) => x !== "");
  if (!A.length && !B.length) return [];
  if ((A.length + 1) * (B.length + 1) > maxCells) {
    return [...(A.length ? [{ op: "del", text: A.join("") }] : []), ...(B.length ? [{ op: "ins", text: B.join("") }] : [])];
  }
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const out = [];
  const push = (op, text) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text; else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("same", A[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) push("del", A[i++]);
    else push("ins", B[j++]);
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("ins", B[j++]);
  return out;
}

const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// 바뀌는 부분 HTML: 같은 글은 그대로, 지우는 글 <del> · 넣는 글 <ins> (글은 모두 이스케이프)
export function diffHtml(seg) {
  return (seg || []).map((x) => (x.op === "same" ? escHtml(x.text) : `<${x.op === "del" ? "del" : "ins"}>${escHtml(x.text)}</${x.op === "del" ? "del" : "ins"}>`)).join("");
}

// ------------------------------------------------------------------ AI 결과 패널 (2026-10-17 사용자 요청)
// "AI 결과를 보면서 글을 쓸 수 있게" — 결과는 원고를 가리는 창(모달)이 아니라 편집 화면 오른쪽에 붙는 패널에 보인다.
// 아래는 패널이 쓰는 순수 함수만 (화면은 writing.js aiPane)

export const AI_PANE_KEY = "paperlab.writeAi"; // 이 브라우저에 패널 열림 · 닫힘 기억 {open}

// 저장소가 없거나(사생활 보호 창 · 막힌 저장소) 값이 깨져 있어도 오류 없이 닫힘
export function loadPaneOpen(storage) {
  try {
    const v = JSON.parse(storage.getItem(AI_PANE_KEY) || "null");
    return !!(v && typeof v === "object" && v.open === true);
  } catch {
    return false;
  }
}
export function savePaneOpen(storage, open) {
  try { storage.setItem(AI_PANE_KEY, JSON.stringify({ open: !!open })); } catch { /* 저장 못 함 — 이번만 */ }
}
// 패널 폭(2026-10-26 사용자 요청 — 왼쪽 가장자리를 끌어 넓히기 · 좁히기). 이 브라우저에 px 로 기억, 없거나 깨졌으면 기본 폭(CSS)
export const AI_PANE_W_KEY = "paperlab.writeAiWidth";
export const PANE_MIN_W = 280;
export const PANE_MAX_W = 1600;
export function clampPaneWidth(w) {
  const n = Math.round(Number(w));
  return Number.isFinite(n) ? Math.min(Math.max(n, PANE_MIN_W), PANE_MAX_W) : null;
}
export function loadPaneWidth(storage) {
  try {
    const raw = storage.getItem(AI_PANE_W_KEY);
    return raw ? clampPaneWidth(raw) : null;
  } catch {
    return null;
  }
}
export function savePaneWidth(storage, w) {
  try {
    if (w == null) storage.removeItem(AI_PANE_W_KEY);
    else storage.setItem(AI_PANE_W_KEY, String(clampPaneWidth(w)));
  } catch { /* 저장 못 함 — 이번만 */ }
}
// CSS 폭: 고른 폭이되 창이 좁아지면 편집기 자리(560px)를 남기고 줄어듦(최소 280px)
export function paneWidthCss(w) {
  return `clamp(${PANE_MIN_W}px, ${clampPaneWidth(w)}px, max(${PANE_MIN_W}px, 100vw - 560px))`;
}
// 이 브라우저의 localStorage (사생활 보호 창 · 막힌 저장소에서는 읽기만 해도 오류 → null)
export function browserStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// 패널 열기 · 닫기 단축키 Alt+A (macOS Option+A). Ctrl · ⌘ · Shift가 같이 눌렸거나 누르고 있는 반복이면 아님
export const AI_PANE_SHORTCUT = "Alt+A";
export function isAiPaneKey(e) {
  return !!e && e.code === "KeyA" && !!e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.repeat;
}

// 결과 하나의 상태 (작업 상태 + 넣었는지)
export function resultState(j) {
  if (!j) return "missing";
  if (j.status === "failed") return "failed";
  if (j.status === "cancelled") return "cancelled";
  if (j.status !== "succeeded") return "running";
  if (!(j.result && j.result.text)) return "expired"; // 7일이 지나 결과 글이 지워짐
  const h = j.write && j.write.handled;
  return h === "applied" ? "applied" : h === "dismissed" ? "dismissed" : "ready";
}
export const RESULT_STATE_TEXT = {
  running: "만드는 중", ready: "넣기 전", applied: "넣음", dismissed: "넣지 않음", failed: "실패", cancelled: "취소함",
  expired: "지워짐", missing: "찾을 수 없음",
};

// 이 원고의 결과 목록(7일 — 서버 status=recent): 새것이 위. ready = 아직 넣지 않은 결과, active = 만드는 중
export function paneList(jobs) {
  const time = (j) => Date.parse(j.created_at || "") || 0;
  const items = (jobs || []).filter((j) => j && (!j.kind || j.kind === "write"))
    .sort((a, b) => time(b) - time(a) || Number(b.id) - Number(a.id));
  return {
    items,
    ready: items.filter((j) => resultState(j) === "ready").length,
    active: items.filter((j) => resultState(j) === "running").length,
  };
}

// 도구 막대 단추 글: "AI 결과" · "AI 결과 2" · "AI 결과 2 · 만드는 중 1"
export function resultsButtonText({ ready = 0, active = 0 } = {}) {
  return `AI 결과${ready ? ` ${ready}` : ""}${active ? ` · 만드는 중 ${active}` : ""}`;
}

// 결과를 원고에 넣는 단추들을 쓸 수 있는지. here = 지금 연 원고의 결과인지
export function paneActions(j, { here = true } = {}) {
  const st = resultState(j);
  const has = st === "ready" || st === "applied" || st === "dismissed";
  return {
    apply: has && here, cursor: has && here, copy: has,
    rerun: here && st !== "running" && st !== "missing",
    cancel: st === "running",
    dismiss: st === "ready",
    applyLabel: j && j.write && j.write.insert ? "넣기" : "바꾸기",
  };
}

// 패널에 보이는 원래 글(바꿀 글 · 이어 쓸 자리 앞 글)의 짧은 모양 — 공백을 줄이고 길면 자름
export function origSnippet(w, max = 240) {
  w = w || {};
  if (w.insert) {
    const b = String(w.before || "").replace(/\s+/g, " ").trim();
    return b ? `…${b.slice(-max)}` : "";
  }
  const t = String(w.text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// [다시 실행]: 실패 · 취소 → 서버의 다시 시도(같은 글로 새 작업). 끝난 결과 → 지금 원고에서 원래 글(넣을 자리)을 다시 찾아
// 그 범위로 새 작업(new). 못 찾으면 lost (아무것도 하지 않고 글을 골라 다시 실행하게 안내)
export function rerunPlan(j, cur) {
  const st = resultState(j);
  if (st === "failed" || st === "cancelled") return { how: "retry" };
  if (st === "running" || st === "missing") return { how: "none" };
  const w = (j && j.write) || {};
  const p = planApply(cur, w);
  if (p.state === "lost") return { how: "lost" };
  return { how: "new", mode: w.mode || "polish", from: p.from, to: p.to };
}

// 패널에서 [바꾸기] · [넣기]를 눌렀을 때 넣을 모양: planApply + 실제로 넣을 글(next) + 낱말 차이(seg) + 앞뒤 문맥.
// same이면 바로 넣고, moved면 패널 안에서 바뀌는 부분을 보여 주고 확인을 받고, lost면 자동으로 넣지 않음
export function applyPreview(cur, w, result, ctx = 120) {
  cur = String(cur ?? "");
  w = w || {};
  const plan = planApply(cur, w);
  if (plan.state === "lost") return { ...plan, next: "", seg: [], before: "", after: "" };
  const next = insertionText(cur, plan.from, result, !!w.insert);
  return {
    ...plan, next,
    seg: w.insert ? [{ op: "ins", text: next }] : wordDiff(plan.old, next),
    before: cur.slice(Math.max(0, plan.from - ctx), plan.from), after: cur.slice(plan.to, plan.to + ctx),
  };
}

// 패널이 보여 줄 결과: 고른 것이 목록에 있으면 그대로, 없으면 만드는 중 → 넣기 전 → 가장 새것 (items는 새것이 위)
export function pickResult(items, sel) {
  items = items || [];
  if (sel != null && items.some((j) => j.id === sel)) return sel;
  const by = (st) => items.find((j) => resultState(j) === st);
  const j = by("running") || by("ready") || items[0];
  return j ? j.id : null;
}

// 패널 단축키: Alt+A = 열기 · 닫기(열 때 초점은 그대로 — 쓰던 글을 끊지 않음), Esc = 초점이 패널 안일 때만 닫기.
// 창(모달)이 떠 있으면 아무것도 하지 않음 → "toggle" | "close" | null
export function paneKeyAction(e, { open = false, inside = false, modal = false } = {}) {
  if (!e || modal) return null;
  if (isAiPaneKey(e)) return "toggle";
  if (e.key === "Escape" && open && inside && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) return "close";
  return null;
}
