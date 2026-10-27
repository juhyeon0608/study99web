// 원고 공유 페이지 (/s/토큰 — 2026-10-27): 로그인 없이 원고 읽기 · 문장을 골라 의견 남기기. 서버 paperlab/shares.py
// 인용 [@키]는 서버가 준 '저자 외, 연도'로, 그림 fig:이름은 이 링크의 그림 주소로 바꿔 보여 준다
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const token = typeof location === "undefined" ? "" : location.pathname.split("/").pop();
const API = `/api/public/share/${encodeURIComponent(token)}`;
const NAME_KEY = "paperlab.shareName";
let quote = "";

function toast(msg, bad = false) {
  const t = document.createElement("div");
  t.className = `toast ${bad ? "error" : "success"}`;
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3000);
}

// 원고 마크다운 → 보여 줄 마크다운 (인용 · 그림 · 각주 정의 · [참고문헌] 자리)
export function prepareShare(md, cites, figBase) {
  return String(md || "")
    .replace(/\[@([^\]\n]+)\]/g, (all, inner) => {
      const keys = [...`@${inner}`.matchAll(/@([\w:.#$%&\-+?<>~/가-힣]+)/g)].map((m) => m[1]);
      if (!keys.length) return all;
      return `(${keys.map((k) => cites[k] || k).join("; ")})`;
    })
    .replace(/!\[([^\]]*)\]\(fig:([0-9a-f]{16}\.(?:png|jpg|gif))\)/g, (all, cap, name) => `![${cap}](${figBase}/figures/${name})\n\n*그림. ${cap}*`)
    .replace(/^\[(참고문헌|References|Bibliography|REFERENCES)\]\s*$/gm, "")
    .replace(/\{#(?:fig|tbl|eq):[^}]*\}/g, "");
}

function drawComments(items) {
  const ol = $("[data-comments]");
  ol.innerHTML = items.length ? "" : `<li class="small muted">아직 의견이 없어요</li>`;
  for (const c of items) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="small"><b>${esc(c.author)}</b> <span class="muted">${esc(new Date(c.created_at).toLocaleString("ko-KR"))}</span>
      ${c.resolved ? `<span class="chip" data-tone="ok">반영됨</span>` : ""}</div>
      ${c.quote ? `<blockquote class="share-quote">${esc(c.quote)}</blockquote>` : ""}<p>${esc(c.body).replace(/\n/g, "<br>")}</p>`;
    ol.append(li);
  }
  $("[data-count]").textContent = items.length ? `${items.length}` : "";
}

function setQuote(q) {
  quote = q.slice(0, 500);
  const box = $("[data-quote]");
  box.hidden = !quote;
  box.textContent = quote;
  $("[data-clear-quote]").hidden = !quote;
}

async function main() {
  let d;
  try {
    const r = await fetch(API, { headers: { "x-paperlab": "1" } });
    d = await r.json();
    if (!r.ok) throw new Error(d.detail || "원고를 불러오지 못했어요");
  } catch (e) {
    $("[data-doc]").innerHTML = `<div class="empty"><h3>원고를 열 수 없어요</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  document.title = `${d.title} · PaperLab`;
  $("[data-label]").textContent = d.label ? ` · ${d.label}님께 공유된 원고` : " · 공유된 원고";
  const html = window.DOMPurify.sanitize(window.marked.parse(prepareShare(d.content, d.cites, API)), { FORBID_TAGS: ["style", "form"] });
  $("[data-doc]").innerHTML = html;
  $("[data-side]").hidden = false;
  drawComments(d.comments);
  if (!d.allow_comments) {
    $("[data-form]").hidden = true;
    $("[data-hint]").textContent = "읽기 전용 링크예요";
    return;
  }
  try { $("[name=author]").value = localStorage.getItem(NAME_KEY) || ""; } catch { /* 저장소 없음 */ }
  const pick = $("[data-pick]");
  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
    if (!text || !$("[data-doc]").contains(sel.anchorNode)) { pick.hidden = true; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    pick.style.top = `${Math.max(8, r.top + window.scrollY - 40)}px`;
    pick.style.left = `${Math.max(8, r.left + window.scrollX)}px`;
    pick.hidden = false;
    pick.dataset.text = text;
  });
  pick.addEventListener("mousedown", (e) => e.preventDefault());
  pick.onclick = () => {
    setQuote(pick.dataset.text || "");
    pick.hidden = true;
    $("[name=body]").focus();
  };
  $("[data-clear-quote]").onclick = () => setQuote("");
  $("[data-form]").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const author = String(fd.get("author") || "").trim();
    const body = String(fd.get("body") || "").trim();
    if (!author || !body) return toast("이름과 의견을 적어 주세요", true);
    const btn = e.currentTarget.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const r = await fetch(`${API}/comments`, { method: "POST", headers: { "content-type": "application/json", "x-paperlab": "1" },
        body: JSON.stringify({ author, body, quote }) });
      const c = await r.json();
      if (!r.ok) throw new Error(c.detail || "의견을 보내지 못했어요");
      try { localStorage.setItem(NAME_KEY, author); } catch { /* 저장소 없음 */ }
      d.comments.push(c);
      drawComments(d.comments);
      e.currentTarget.querySelector("[name=body]").value = "";
      setQuote("");
      toast("의견을 남겼어요. 원고를 쓰신 분께 전달돼요");
    } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  };
}

if (typeof document !== "undefined" && document.querySelector("[data-doc]")) {
  if (window.marked) main(); else window.addEventListener("DOMContentLoaded", main);
}
