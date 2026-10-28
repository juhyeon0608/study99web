// 원고 공유 페이지 (/s/토큰 — 2026-10-27): 로그인 없이 원고 읽기 · 문장을 골라 의견 남기기. 서버 paperlab/shares.py
// 인용 [@키]는 서버가 준 '저자 외, 연도'로, 그림 fig:이름은 이 링크의 그림 주소로 바꿔 보여 준다.
// 검토본 (2026-10-28): 의견 받는 링크는 처음 연 때의 원고(검토본)를 보여 준다. 남긴 의견 · 고친 글은 본문에 빨간색으로
// (reviewmark.js), 원고를 쓴 분이 수정 완료 · 거부하면 흐리게. 30초마다 새로 받음.
// 쉽게 (2026-10-28 사용자 "교수님이 쓰기 너무 어려울 것 같다"): 문단마다 [✏ 고치기] [💬 의견] — 고치기는 문단이 글상자로
// 바뀌어 그냥 고치고 [보내기](바뀐 부분은 editSpan이 찾음), 의견은 문단 아래 칸. 이름은 위 안내 줄에서 한 번만.
// 글을 드래그해 고르는 방법(작은 단추 → 오른쪽 칸)도 그대로 둔다
import { STATUS_LABEL, editSpan, markReview, prepareShare } from "./reviewmark.js";

export { prepareShare };

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const token = typeof location === "undefined" ? "" : location.pathname.split("/").pop();
const API = `/api/public/share/${encodeURIComponent(token)}`;
const NAME_KEY = "paperlab.shareName";
const POLL_MS = 30000;
const BLOCKS = ":scope > p, :scope > h2, :scope > h3, :scope > h4, :scope > blockquote, :scope > ul > li, :scope > ol > li";
let quote = "";
let mode = "comment"; // 오른쪽 칸: comment | edit
let D = null; // 받은 원고 · 의견
let canWrite = false;

function toast(msg, bad = false) {
  const t = document.createElement("div");
  t.className = `toast ${bad ? "error" : "success"}`;
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3000);
}

// 문단의 글 (빨간 새 글 · 단추 빼고)
function plain(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll(".rv-ins, .blk-tools, ul, ol").forEach((x) => x.remove());
  return c.textContent.replace(/\s+/g, " ").trim();
}

function drawDoc() {
  const doc = $("[data-doc]");
  doc.innerHTML = window.DOMPurify.sanitize(window.marked.parse(prepareShare(D.content, D.cites, API)), { FORBID_TAGS: ["style", "form"] });
  markReview(doc, D.comments);
  if (!canWrite) return;
  for (const b of doc.querySelectorAll(BLOCKS)) {
    if (!plain(b)) continue;
    b.classList.add("blk");
    const t = document.createElement("span");
    t.className = "blk-tools";
    t.innerHTML = `<button type="button" class="btn sm" data-act="edit" title="이 문단을 직접 고쳐요">✏ 고치기</button>`
      + `<button type="button" class="btn sm" data-act="comment" title="이 문단에 의견을 남겨요">💬 의견</button>`;
    b.append(t);
  }
}

function drawComments() {
  const items = D.comments;
  const ol = $("[data-comments]");
  ol.innerHTML = items.length ? "" : `<li class="small muted">아직 남긴 의견이 없어요</li>`;
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

function author() {
  const v = $("[data-name]").value.trim();
  if (!v) {
    $("[data-name]").focus();
    $("[data-name]").classList.add("need");
    toast("맨 위에 이름을 먼저 적어 주세요", true);
    return "";
  }
  try { localStorage.setItem(NAME_KEY, v); } catch { /* 저장소 없음 */ }
  return v;
}

async function send(payload) {
  const who = author();
  if (!who) return false;
  try {
    const r = await fetch(`${API}/comments`, { method: "POST", headers: { "content-type": "application/json", "x-paperlab": "1" },
      body: JSON.stringify({ author: who, ...payload }) });
    const c = await r.json();
    if (!r.ok) throw new Error(c.detail || "보내지 못했어요");
    D.comments.push(c);
    drawDoc();
    drawComments();
    toast(payload.kind === "edit" ? "고친 글을 보냈어요. 원고를 쓴 분께 빨간색으로 보여요" : "의견을 보냈어요. 원고를 쓴 분께 빨간색으로 보여요");
    return true;
  } catch (err) { toast(err.message, true); return false; }
}

// 문단 아래(고치기는 문단 자리) 칸
function openBox(block, act) {
  document.querySelectorAll(".blk-box").forEach((x) => x.cancel());
  const orig = plain(block);
  const box = document.createElement("div");
  box.className = `blk-box${act === "edit" ? " is-edit" : ""}`;
  box.innerHTML = act === "edit"
    ? `<div class="small blk-box-h">✏ 문단을 직접 고친 뒤 [보내기]를 눌러 주세요</div>
       <textarea class="input" rows="4" data-text></textarea>
       <input class="input" data-why maxlength="4000" placeholder="고친 이유 (적지 않아도 돼요)">`
    : `<div class="small blk-box-h">💬 이 문단에 대한 의견</div>
       <textarea class="input" rows="3" data-text maxlength="4000" placeholder="의견을 적어 주세요"></textarea>`;
  box.insertAdjacentHTML("beforeend", `<div class="row" style="gap:6px"><button type="button" class="btn sm primary" data-send>보내기</button>
    <button type="button" class="btn sm" data-cancel>취소</button></div>`);
  const ta = $("[data-text]", box);
  if (act === "edit") { ta.value = orig; block.hidden = true; }
  block.after(box);
  const fit = () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; };
  ta.addEventListener("input", fit);
  fit();
  ta.focus();
  box.cancel = () => { box.remove(); block.hidden = false; };
  $("[data-cancel]", box).onclick = box.cancel;
  $("[data-send]", box).onclick = async (e) => {
    const btn = e.currentTarget;
    let payload;
    if (act === "edit") {
      const span = editSpan(orig, ta.value);
      if (!span) return toast("바뀐 글이 없어요. 글을 고친 뒤 보내 주세요", true);
      payload = { kind: "edit", quote: span.quote.slice(0, 2000), replacement: span.replacement, body: $("[data-why]", box).value.trim() };
    } else {
      if (!ta.value.trim()) return toast("의견을 적어 주세요", true);
      payload = { kind: "comment", quote: orig.slice(0, 2000), body: ta.value.trim() };
    }
    btn.disabled = true;
    if (!(await send(payload))) btn.disabled = false;
  };
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
  body.placeholder = mode === "edit" ? "고친 이유 (선택)" : "원고 전체에 대한 의견도 여기에 적을 수 있어요";
  $("[data-submit]").textContent = mode === "edit" ? "고친 글 보내기" : "의견 보내기";
}

async function load() {
  const r = await fetch(API, { headers: { "x-paperlab": "1" } });
  const d = await r.json();
  if (!r.ok) throw new Error(d.detail || "원고를 불러오지 못했어요");
  return d;
}

async function main() {
  try { D = await load(); } catch (e) {
    $("[data-doc]").innerHTML = `<div class="empty"><h3>원고를 열 수 없어요</h3><p>${esc(e.message)}</p></div>`;
    return;
  }
  canWrite = !!D.allow_comments;
  document.title = `${D.title} · PaperLab`;
  const when = D.copied_at ? ` · ${new Date(D.copied_at).toLocaleString("ko-KR")} 원고` : "";
  $("[data-label]").textContent = `${D.label ? ` · ${D.label}님께 공유된 원고` : " · 공유된 원고"}${when}`;
  drawDoc();
  $("[data-side]").hidden = false;
  drawComments();
  if (!canWrite) {
    $("[data-form]").hidden = true;
    $("[data-hint]").textContent = "읽기 전용 링크예요";
    return;
  }
  $("[data-guide]").hidden = false;
  try { $("[data-name]").value = localStorage.getItem(NAME_KEY) || ""; } catch { /* 저장소 없음 */ }
  $("[data-name]").addEventListener("input", (e) => e.target.classList.remove("need"));

  // 30초마다: 원고를 쓴 분이 수정 완료 · 거부한 것 · 다른 분의 의견. 쓰는 중(칸이 열림 · 글을 고르는 중)이면 본문은 다음 차례에
  const poll = async () => {
    try {
      const n = await load();
      if (JSON.stringify(n.comments) !== JSON.stringify(D.comments)) {
        const sel = document.getSelection();
        const busy = (sel && !sel.isCollapsed && $("[data-doc]").contains(sel.anchorNode)) || document.querySelector(".blk-box");
        D = { ...D, comments: n.comments };
        if (!busy) drawDoc();
        drawComments();
      }
    } catch { /* 다음 차례에 */ }
    setTimeout(poll, POLL_MS);
  };
  setTimeout(poll, POLL_MS);

  // 문단의 [✏ 고치기] · [💬 의견]
  $("[data-doc]").addEventListener("click", (e) => {
    const b = e.target.closest(".blk-tools [data-act]");
    if (b) openBox(b.closest(".blk"), b.dataset.act);
  });

  // 글을 드래그해 고른 경우: 작은 단추 → 오른쪽 칸
  const pick = $("[data-pick]");
  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
    if (!text || !$("[data-doc]").contains(sel.anchorNode) || document.activeElement?.closest?.(".blk-box")) { pick.hidden = true; return; }
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
    const body = String(new FormData(form).get("body") || "").trim();
    const replacement = String(new FormData(form).get("replacement") || "").trim();
    if (mode === "comment" && !body) return toast("의견을 적어 주세요", true);
    if (mode === "edit" && replacement === quote) return toast("고친 글이 원래 글과 같아요", true);
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    if (await send({ kind: mode, quote, replacement: mode === "edit" ? replacement : "", body })) {
      form.querySelector("[name=body]").value = "";
      setQuote("");
    }
    btn.disabled = false;
  };
}

if (typeof document !== "undefined" && document.querySelector("[data-doc]")) {
  if (window.marked) main(); else window.addEventListener("DOMContentLoaded", main);
}
