// 원고 공유 페이지 (/s/토큰 — 2026-10-27): 로그인 없이 원고 읽기 · 문장을 골라 의견 남기기. 서버 paperlab/shares.py
// 인용 [@키]는 서버가 준 '저자 외, 연도'로, 그림 fig:이름은 이 링크의 그림 주소로 바꿔 보여 준다.
// 검토본 (2026-10-28): 의견 받는 링크는 처음 연 때의 원고(검토본)를 보여 주고, 글을 골라 [의견 달기] 또는 [고치기]를 한다.
// 남긴 의견 · 고친 글은 본문에 빨간색으로(reviewmark.js), 원고를 쓴 분이 수정 완료 · 거부하면 흐리게. 30초마다 새로 받음
import { STATUS_LABEL, markReview, prepareShare } from "./reviewmark.js";

export { prepareShare };

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const token = typeof location === "undefined" ? "" : location.pathname.split("/").pop();
const API = `/api/public/share/${encodeURIComponent(token)}`;
const NAME_KEY = "paperlab.shareName";
const POLL_MS = 30000;
let quote = "";
let mode = "comment"; // comment | edit

function toast(msg, bad = false) {
  const t = document.createElement("div");
  t.className = `toast ${bad ? "error" : "success"}`;
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3000);
}

function drawDoc(d) {
  const doc = $("[data-doc]");
  doc.innerHTML = window.DOMPurify.sanitize(window.marked.parse(prepareShare(d.content, d.cites, API)), { FORBID_TAGS: ["style", "form"] });
  markReview(doc, d.comments);
}

function drawComments(items) {
  const ol = $("[data-comments]");
  ol.innerHTML = items.length ? "" : `<li class="small muted">아직 의견이 없어요</li>`;
  for (const c of items) {
    const li = document.createElement("li");
    li.className = c.status && c.status !== "open" ? "rv-closed" : "";
    const st = STATUS_LABEL[c.status] || "";
    const what = c.kind === "edit"
      ? `<div class="rv-edit"><del class="rv-del">${esc(c.quote)}</del> → <ins class="rv-ins">${esc(c.replacement)}</ins></div>`
      : c.quote ? `<blockquote class="share-quote">${esc(c.quote)}</blockquote>` : "";
    li.innerHTML = `<div class="small"><b>${esc(c.author)}</b> <span class="muted">${esc(new Date(c.created_at).toLocaleString("ko-KR"))}</span>
      ${st ? `<span class="chip ${c.status === "done" ? "success" : ""}">${esc(st)}</span>` : ""}</div>
      ${what}${c.body ? `<p class="rv-note">${esc(c.body).replace(/\n/g, "<br>")}</p>` : ""}`;
    li.onclick = () => {
      const m = document.querySelector(`[data-doc] [data-cid="${c.id}"]`);
      if (m) m.scrollIntoView({ block: "center", behavior: "smooth" });
    };
    ol.append(li);
  }
  $("[data-count]").textContent = items.length ? `${items.length}` : "";
}

function setQuote(q, how = "comment") {
  quote = q.slice(0, 2000);
  mode = quote && how === "edit" ? "edit" : "comment";
  const box = $("[data-quote]");
  box.hidden = !quote;
  box.textContent = quote;
  $("[data-clear-quote]").hidden = !quote;
  $("[data-edit]").hidden = mode !== "edit";
  const rep = $("[name=replacement]");
  if (mode === "edit") rep.value = quote;
  const body = $("[name=body]");
  body.required = mode !== "edit";
  body.placeholder = mode === "edit" ? "고친 이유 (선택)" : "의견을 적어 주세요. 본문에서 문장을 고르면 그 문장에 달려요.";
  $("[data-submit]").textContent = mode === "edit" ? "고친 글 보내기" : "의견 남기기";
}

async function load() {
  const r = await fetch(API, { headers: { "x-paperlab": "1" } });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "원고를 불러오지 못했어요");
  return d;
}

async function main() {
  let d;
  try { d = await load(); } catch (e) {
    $("[data-doc]").innerHTML = `<div class="empty"><h3>원고를 열 수 없어요</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  document.title = `${d.title} · PaperLab`;
  const when = d.copied_at ? ` · ${new Date(d.copied_at).toLocaleString("ko-KR")} 원고` : "";
  $("[data-label]").textContent = `${d.label ? ` · ${d.label}님께 공유된 원고` : " · 공유된 원고"}${when}`;
  drawDoc(d);
  $("[data-side]").hidden = false;
  drawComments(d.comments);
  if (!d.allow_comments) {
    $("[data-form]").hidden = true;
    $("[data-hint]").textContent = "읽기 전용 링크예요";
    return;
  }
  // 30초마다: 원고를 쓴 분이 수정 완료 · 거부한 것 · 다른 분의 의견. 글을 고르는 중이면 본문은 다음 차례에
  const poll = async () => {
    try {
      const n = await load();
      if (JSON.stringify(n.comments) !== JSON.stringify(d.comments)) {
        const sel = document.getSelection();
        const busy = sel && !sel.isCollapsed && $("[data-doc]").contains(sel.anchorNode);
        d = { ...d, comments: n.comments };
        if (!busy) drawDoc(d);
        drawComments(d.comments);
      }
    } catch { /* 다음 차례에 */ }
    setTimeout(poll, POLL_MS);
  };
  setTimeout(poll, POLL_MS);

  try { $("[name=author]").value = localStorage.getItem(NAME_KEY) || ""; } catch { /* 저장소 없음 */ }
  const pick = $("[data-pick]");
  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
    if (!text || !$("[data-doc]").contains(sel.anchorNode)) { pick.hidden = true; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    pick.style.top = `${Math.max(8, r.top + window.scrollY - 44)}px`;
    pick.style.left = `${Math.max(8, r.left + window.scrollX)}px`;
    pick.hidden = false;
    pick.dataset.text = text;
  });
  pick.addEventListener("mousedown", (e) => e.preventDefault());
  pick.onclick = (e) => {
    const b = e.target.closest("[data-how]");
    if (!b) return;
    setQuote(pick.dataset.text || "", b.dataset.how);
    pick.hidden = true;
    (mode === "edit" ? $("[name=replacement]") : $("[name=body]")).focus();
  };
  $("[data-clear-quote]").onclick = () => setQuote("");
  $("[data-form]").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const author = String(fd.get("author") || "").trim();
    const body = String(fd.get("body") || "").trim();
    const replacement = String(fd.get("replacement") || "").trim();
    if (!author) return toast("이름을 적어 주세요", true);
    if (mode === "comment" && !body) return toast("의견을 적어 주세요", true);
    if (mode === "edit" && replacement === quote) return toast("고친 글이 원래 글과 같아요", true);
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      const r = await fetch(`${API}/comments`, { method: "POST", headers: { "content-type": "application/json", "x-paperlab": "1" },
        body: JSON.stringify({ author, body, quote, kind: mode, replacement: mode === "edit" ? replacement : "" }) });
      const c = await r.json();
      if (!r.ok) throw new Error(c.detail || "의견을 보내지 못했어요");
      try { localStorage.setItem(NAME_KEY, author); } catch { /* 저장소 없음 */ }
      d.comments.push(c);
      drawDoc(d);
      drawComments(d.comments);
      form.querySelector("[name=body]").value = "";
      const was = mode;
      setQuote("");
      toast(was === "edit" ? "고친 글을 보냈어요. 원고를 쓰신 분께 빨간색으로 보여요" : "의견을 남겼어요. 원고를 쓰신 분께 전달돼요");
    } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  };
}

if (typeof document !== "undefined" && document.querySelector("[data-doc]")) {
  if (window.marked) main(); else window.addEventListener("DOMContentLoaded", main);
}
