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
