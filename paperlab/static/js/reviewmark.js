// 공유 검토본 표시 (2026-10-28 사용자 요청 "교수님이 코멘트한 게 빨간색으로 보이게"): 공개 페이지(share.js)와 원고 주인의
// 검토 보기(writereviewui.js)가 같이 쓴다. 원고 마크다운 → 보여 줄 마크다운, 그린 글 안에서 의견 · 고친 글 자리를 빨간색으로

// 원고 마크다운 → 보여 줄 마크다운 (인용 · 그림 · 각주 정의 · [참고문헌] 자리). figBase가 없으면 그림은 '[그림: 설명]' 글로
export function prepareShare(md, cites, figBase) {
  return String(md || "")
    .replace(/\[@([^\]\n]+)\]/g, (all, inner) => {
      const keys = [...`@${inner}`.matchAll(/@([\w:.#$%&\-+?<>~/가-힣]+)/g)].map((m) => m[1]);
      if (!keys.length) return all;
      return `(${keys.map((k) => cites[k] || k).join("; ")})`;
    })
    .replace(/!\[([^\]]*)\]\(fig:([0-9a-f]{16}\.(?:png|jpg|gif))\)/g, (all, cap, name) => (figBase
      ? `![${cap}](${figBase}/figures/${name})\n\n*그림. ${cap}*` : `*[그림: ${cap}]*`))
    .replace(/^\[(참고문헌|References|Bibliography|REFERENCES)\]\s*$/gm, "")
    .replace(/\{#(?:fig|tbl|eq):[^}]*\}/g, "");
}

// 글 안에서 고른 글(quote)의 자리 [시작, 끝) — 띄어쓰기 · 줄바꿈 차이는 무시(문단을 넘겨 고른 글은 줄바꿈이 다름). 없으면 null
export function findSpan(text, quote) {
  const words = String(quote || "").split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*"), "u");
  const m = re.exec(String(text || ""));
  return m ? [m.index, m.index + m[0].length] : null;
}

export const STATUS_LABEL = { open: "", done: "수정 완료", rejected: "거부" };

// 그린 글(root) 안에 의견을 표시: 의견 = 빨간 밑줄 글(mark), 고친 글 = 빨간 취소선(del) + 빨간 새 글(ins).
// 처리한 의견(수정 완료 · 거부)은 흐리게. 찾지 못한 의견 id 목록을 돌려준다
export function markReview(root, comments) {
  const missing = [];
  for (const c of comments || []) {
    if (!c.quote) continue;
    if (!wrapQuote(root, c)) missing.push(c.id);
  }
  return missing;
}

function textNodes(root) {
  const out = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.parentElement || !n.parentElement.closest(".rv-ins")) out.push(n);
  }
  return out;
}

function wrapQuote(root, c) {
  const nodes = textNodes(root);
  const starts = [];
  let all = "";
  for (const n of nodes) { starts.push(all.length); all += n.nodeValue; }
  const span = findSpan(all, c.quote);
  if (!span) return false;
  const doc = root.ownerDocument;
  const tone = c.status && c.status !== "open" ? " rv-closed" : "";
  let last = null;
  nodes.forEach((n, i) => {
    const a = Math.max(span[0], starts[i]);
    const b = Math.min(span[1], starts[i] + n.nodeValue.length);
    if (a >= b || !n.nodeValue.slice(a - starts[i], b - starts[i]).trim()) return; // 목록 · 표 사이 빈 글 조각은 감싸지 않음
    const mid = n.splitText(a - starts[i]);
    mid.splitText(b - a);
    const w = doc.createElement(c.kind === "edit" ? "del" : "mark");
    w.className = `${c.kind === "edit" ? "rv-del" : "rv-mark"}${tone}`;
    w.dataset.cid = String(c.id);
    mid.replaceWith(w);
    w.append(mid);
    last = w;
  });
  if (!last) return false;
  if (c.kind === "edit") {
    const ins = doc.createElement("ins");
    ins.className = `rv-ins${tone}`;
    ins.dataset.cid = String(c.id);
    ins.textContent = c.replacement || "";
    last.after(ins);
  }
  return true;
}
