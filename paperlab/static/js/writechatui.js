// 원고 AI 대화 · 장 · 절 일괄 처리 화면 (docs/specs/manuscript-ai-chat.md): AI 패널(aside#ai-pane)의 '대화' · '일괄' 보기.
// 규칙(답 읽기 · 넣을 자리 · 일괄 넣기)은 writechat.js(순수 함수), 서버는 /api/manuscripts/{id}/chat · ai-batch.
// AI 글은 믿지 않는 글: 답은 purifyMd(marked), 바뀌는 부분은 diffHtml(이스케이프), 만드는 중인 글 · 사용자 글은 textContent로만.
// 원고에 넣을 때는 넣기 직전 원고를 버전 기록에 남기고(saveVersion) planApply로 자리를 다시 찾아 그 자리만 바꾼다.

import { api } from "./api.js";
import { cancelJob, ensureAiRoute, fmtClock, handledJob, isActive, retryJob, setStatusLine, statusLineEl, trackJob, watchJob } from "./jobs.js";
import { $, confirmDialog, copyText, el, errorToast, esc, purifyMd, toast } from "./ui.js";
import { diffHtml, docHash, wordDiff } from "./writeai.js";
import {
  BATCH_STATE_TEXT, PROPOSAL_STATE_TEXT, applyBatch, applyProposals, autoScope, batchCounts, batchEdit, batchItemState, batchTitle,
  droppedCites, proposalEdit, scopeChipText, splitReply, threadOrder, unanswered, waitingJob,
} from "./writechat.js";
import { SCOPE_KINDS, SCOPE_NAMES, aiScope, diffEdit, outlineText, scopeSummary } from "./writeedit.js";
import { saveVersion } from "./writehistui.js";
import { applyEdit } from "./writetools.js";

const SCOPE_TEXT_MAX = 16000; // 서버 mschat.SCOPE_TEXT_MAX와 같게
const md = (text) => purifyMd(window.marked.parse(String(text ?? ""))) ?? esc(text);

// ------------------------------------------------------------------ 대화
// ctx: { mid, ta, ending() → keep|bullet|plain, select(a, b), flash(a, b), say(text), alive() }
export function chatView(root, ctx) {
  const { mid, ta } = ctx;
  const S = { messages: [], jobs: {}, kind: null, stop: null, watching: null, loaded: false, sending: false, lost: new Set(),
    timer: null, visible: false };
  root.innerHTML = `<div class="mc">
    <div class="mc-scope" role="group" aria-label="AI에게 보낼 범위">
      <span class="mc-scope-h">범위</span>${SCOPE_KINDS.map((k) => `<button type="button" class="chip mc-chip" data-sc="${k}" aria-pressed="false">${esc(SCOPE_NAMES[k])}</button>`).join("")}
    </div>
    <p class="small muted mc-target" data-target></p>
    <div class="mc-log" data-log></div>
    <form class="mc-form" data-form>
      <textarea class="input mc-input" rows="3" maxlength="4000" aria-label="AI에게 할 말 (Enter 보내기 · Shift+Enter 줄바꿈)"
        placeholder="예: 이 문단을 더 간결하게 고쳐 줘 · 이 절의 논리 흐름이 자연스러워?"></textarea>
      <div class="mc-form-row"><button type="button" class="btn sm ghost" data-clear title="이 원고의 AI 대화를 모두 지워요 (원고는 그대로)">대화 지우기</button>
        <span class="spacer"></span><button type="submit" class="btn sm primary" data-send>보내기</button></div>
    </form></div>`;
  const log = $("[data-log]", root);
  const input = $(".mc-input", root);
  const target = $("[data-target]", root);
  const alive = () => ctx.alive() && root.isConnected;

  // ---- 범위
  const scopeOf = (k) => aiScope(ta.value, ta.selectionStart, ta.selectionEnd, k);
  const current = () => (S.kind ? scopeOf(S.kind) : autoScope(scopeOf));
  const drawTarget = () => {
    if (!S.visible) return;
    const sc = current();
    const eff = sc && sc.ok ? sc.kind : S.kind;
    root.querySelectorAll("[data-sc]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sc === eff)));
    target.textContent = sc && sc.ok
      ? `${scopeSummary(sc)}${S.kind ? "" : " · 자동"}${sc.chars > SCOPE_TEXT_MAX ? " — 너무 길어요(16,000자까지)" : ""}`
      : sc ? sc.message : "범위 없이 물어봐요 (글을 고르거나 문단에 커서를 두면 그 글을 함께 보내요)";
    target.dataset.tone = sc && (!sc.ok || sc.chars > SCOPE_TEXT_MAX) ? "warn" : "";
  };
  let tTimer = null;
  const onCaret = () => { clearTimeout(tTimer); tTimer = setTimeout(() => alive() && drawTarget(), 150); };
  for (const ev of ["keyup", "mouseup", "input", "select", "focus"]) ta.addEventListener(ev, onCaret);
  root.querySelector(".mc-scope").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sc]");
    if (!b) return;
    const k = b.dataset.sc;
    S.kind = S.kind === k ? null : k; // 다시 누르면 자동(고른 글 → 문단 → 절)
    drawTarget();
    const sc = current();
    if (sc && sc.ok) ctx.flash(sc.from, sc.to); // 보낼 글을 편집기에서 잠깐 골라 보여 줌
    else if (sc) toast(sc.message);
  });

  // ---- 그리기
  const draw = () => {
    if (!S.visible) return;
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const focused = log.contains(document.activeElement) ? document.activeElement.dataset.key || "" : "";
    log.innerHTML = "";
    const list = threadOrder(S.messages);
    if (!list.length) {
      log.append(el(`<div class="ai-empty"><p>원고를 말로 고쳐 보세요.</p>
        <p class="small muted">위에서 범위(선택 · 문단 · 이 절 · 이 장)를 고르고 “이 문단을 더 간결하게”, “이 절에 근거가 약한 주장이 있어?”처럼 물어보세요.
        고칠 곳은 바뀌는 부분으로 보여 드리고, [적용]을 누를 때만 원고에 넣어요. 대화는 이 원고에 남아요.</p></div>`));
    }
    const waiting = new Map(unanswered(S.messages, S.jobs).map((x) => [x.message.id, x.job]));
    for (const m of list) {
      if (m.role === "user") {
        const node = el(`<div class="mc-msg mc-user"><div class="mc-bubble"></div>
          <div class="mc-meta"><span class="chip mc-scope-chip"></span><span>${esc(fmtClock(m.created_at))}</span></div></div>`);
        $(".mc-bubble", node).textContent = m.content;
        $(".mc-scope-chip", node).textContent = scopeChipText(m.scope);
        log.append(node);
        if (waiting.has(m.id)) log.append(pendingNode(m, waiting.get(m.id)));
      } else log.append(answerNode(m));
    }
    if (focused) log.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
    if (atEnd) log.scrollTop = log.scrollHeight;
    const busy = !!waitingJob(S.messages, S.jobs) || S.sending;
    $("[data-send]", root).disabled = busy;
    $("[data-send]", root).title = busy ? "앞 질문의 답을 기다리는 중이에요" : "보내기 (Enter)";
  };

  const pendingNode = (m, j) => {
    const box = el(`<div class="mc-msg mc-ai mc-pending" data-pending="${Number(m.id)}"></div>`);
    if (!j) {
      box.append(el(`<div class="msg error">답을 받지 못했어요. 다시 물어봐 주세요.</div>`));
      return box;
    }
    if (isActive(j)) {
      const line = statusLineEl(async () => { try { await cancelJob(j.id); } catch (err) { errorToast(err); } });
      $("[data-job-cancel]", line).dataset.key = `cancel-${j.id}`;
      setStatusLine(line, j, "답을 작성");
      box.append(line, el(`<div class="mc-bubble mc-partial" data-partial></div>`));
      livePartial(box, j);
    } else if (j.status === "failed" || j.status === "cancelled") {
      box.append(el(`<div class="msg error">${esc(j.status === "failed" ? j.error || "답을 만들지 못했어요" : "작업을 취소했어요")}</div>`));
      const acts = el(`<div class="ai-actions"><button type="button" class="btn sm" data-act="retry" data-job="${Number(j.id)}" data-key="retry-${Number(j.id)}">다시 시도</button></div>`);
      box.append(acts);
    } else box.append(el(`<div class="small muted"><span class="spinner" aria-hidden="true"></span> 답을 불러오는 중…</div>`));
    return box;
  };
  const livePartial = (box, j) => {
    const out = $("[data-partial]", box);
    if (!out) return;
    const r = splitReply((j.progress || {}).partial_text || "");
    if (r.answer) out.textContent = r.answer;
    else out.innerHTML = `<span class="typing" aria-hidden="true"><span></span><span></span><span></span></span>`;
    if (r.pending) out.append(el(`<div class="small muted mc-writing">수정 제안을 쓰는 중…</div>`));
  };

  const answerNode = (m) => {
    const node = el(`<div class="mc-msg mc-ai" data-msg="${Number(m.id)}"><div class="mc-bubble prose"></div></div>`);
    $(".mc-bubble", node).innerHTML = md(m.content);
    const props = Array.isArray(m.proposals) ? m.proposals : [];
    if (props.length) {
      const sec = el(`<div class="mc-props" role="group" aria-label="수정 제안 ${props.length}개"></div>`);
      props.forEach((p, i) => sec.append(proposalNode(m, p, i)));
      const open = props.map((p, i) => i).filter((i) => !props[i].state && !S.lost.has(`${m.id}:${i}`));
      if (open.length > 1) {
        sec.append(el(`<div class="ai-actions"><button type="button" class="btn sm primary" data-act="apply-all" data-msg="${Number(m.id)}" data-key="all-${Number(m.id)}">모두 적용 (${open.length})</button></div>`));
      }
      node.append(sec);
    }
    node.append(el(`<div class="mc-meta"><span>${esc(fmtClock(m.created_at))}</span></div>`));
    return node;
  };
  const proposalNode = (m, p, i) => {
    const key = `${m.id}:${i}`;
    const st = p.state || (S.lost.has(key) ? "lost" : "");
    const node = el(`<div class="mc-prop" data-state="${esc(st)}"><div class="mc-prop-h"><b>제안 ${i + 1}</b>
      ${st ? `<span class="chip ai-st" data-st="${st === "applied" ? "applied" : "failed"}">${esc(PROPOSAL_STATE_TEXT[st] || "")}</span>` : ""}</div>
      <div class="ai-diff" aria-label="바뀌는 부분"></div></div>`);
    $(".ai-diff", node).innerHTML = diffHtml(wordDiff(p.find, p.replace));
    const miss = droppedCites(p.find, p.replace);
    if (miss.length) node.append(el(`<p class="small mc-warn">이 제안은 인용 ${esc(miss.map((k) => `@${k}`).join(" · "))}을(를) 빠뜨려요. 확인하고 적용해 주세요.</p>`));
    const acts = el(`<div class="ai-actions"></div>`);
    const btn = (act, label, cls = "", title = "") => {
      const b = el(`<button type="button" class="btn sm ${cls}" data-act="${act}" data-msg="${Number(m.id)}" data-i="${i}" data-key="${act}-${esc(key)}">${esc(label)}</button>`);
      if (title) b.title = title;
      acts.append(b);
    };
    if (!st || st === "lost") {
      if (!st) btn("apply", "적용", "primary", "바뀌는 부분만 원고에 넣어요 — 그 사이 원고가 바뀌었으면 원래 글을 다시 찾아요");
      btn("again", "다시", "", "이 부분을 다르게 다시 고쳐 달라고 물어봐요");
      btn("discard", "버리기", "ghost");
      if (st === "lost") btn("copy", "복사");
    } else if (st === "discarded") btn("undo", "되살리기", "ghost");
    btn("locate", "원고에서 보기", "ghost");
    node.append(acts);
    return node;
  };

  // ---- 서버
  const load = async () => {
    let data;
    try { data = await api.get(`/api/manuscripts/${mid}/chat`); } catch (err) { if (alive()) errorToast(err); return; }
    if (!alive()) return;
    S.messages = data.messages || [];
    S.jobs = data.jobs || {};
    S.loaded = true;
    for (const x of unanswered(S.messages, S.jobs)) if (x.job && !isActive(x.job)) handledJob(x.job.id);
    draw();
    follow();
  };
  // 답을 기다리는 작업 하나를 따라감 (중간 글 · 진행) — 끝나면 대화를 다시 받음
  const follow = () => {
    const j = waitingJob(S.messages, S.jobs);
    if (!j) { stopFollow(); return; }
    if (S.watching === j.id) return;
    stopFollow();
    S.watching = j.id;
    const umid = unanswered(S.messages, S.jobs).find((x) => x.job && x.job.id === j.id).message.id;
    S.stop = watchJob(j.id, (x) => {
      if (!alive() || S.watching !== j.id) return;
      if (!x) { stopFollow(); return load(); }
      const prev = S.jobs[String(umid)];
      S.jobs[String(umid)] = x;
      if (!isActive(x)) {
        handledJob(x.id); // 대화 탭에서 답을 봄 — 끝남 알림 생략
        stopFollow();
        if (x.status === "succeeded") { ctx.say("AI 답이 왔어요"); load(); } else draw();
        return;
      }
      const box = log.querySelector(`[data-pending="${Number(umid)}"]`);
      if (!box || !prev || prev.status !== x.status) return draw();
      const line = $("[data-job-line]", box);
      if (line) setStatusLine(line, x, "답을 작성");
      livePartial(box, x);
    });
  };
  const stopFollow = () => { if (S.stop) S.stop(); S.stop = null; S.watching = null; };

  const ask = async (content, scope) => {
    if (S.sending) return false;
    if (waitingJob(S.messages, S.jobs)) { toast("앞 질문의 답을 기다리는 중이에요"); return false; }
    if (!(await ensureAiRoute("write"))) return false; // 대화는 글쓰기와 같은 엔진 순서 (내 PC · 내 API 키)
    S.sending = true;
    draw();
    try {
      const r = await api.post(`/api/manuscripts/${mid}/chat`, { content, scope, outline: outlineText(ta.value), ending: ctx.ending() });
      if (!alive()) return true;
      S.messages.push(r.message);
      S.jobs[String(r.message.id)] = r.job;
      trackJob(r.job);
      return true;
    } catch (err) {
      errorToast(err);
      return false;
    } finally {
      S.sending = false;
      if (alive()) { draw(); follow(); }
    }
  };
  const send = async () => {
    const content = input.value.trim();
    if (!content) { input.focus(); return; }
    const sc = current();
    if (S.kind && sc && !sc.ok) return toast(sc.message, "error");
    if (sc && sc.ok && sc.chars > SCOPE_TEXT_MAX) return toast("보낼 범위가 너무 길어요 (16,000자까지). 절이나 문단으로 줄여 주세요", "error");
    const scope = sc && sc.ok ? { kind: sc.kind, label: sc.label, from: sc.from, to: sc.to, fingerprint: docHash(ta.value), text: sc.text } : { kind: "none" };
    if (sc && sc.ok) ctx.flash(sc.from, sc.to);
    if (await ask(content, scope)) input.value = "";
  };

  // ---- 제안 넣기
  const msgOf = (id) => S.messages.find((m) => m.id === Number(id));
  const setState = async (m, i, state) => {
    m.proposals[i] = { ...m.proposals[i], state: state || undefined };
    if (!state) delete m.proposals[i].state;
    draw();
    try { await api.patch(`/api/manuscripts/${mid}/chat/${m.id}/proposals/${i}`, { state }); } catch { /* 표시만 — 다음에 다시 받음 */ }
  };
  const editorOk = () => {
    if (!ctx.alive()) { toast("이 원고가 열려 있을 때만 넣을 수 있어요", "error"); return false; }
    return true;
  };
  const applyOne = (m, i) => {
    if (!editorOk()) return;
    const e = proposalEdit(ta.value, m.proposals[i], m.scope);
    if (e.state === "lost") {
      S.lost.add(`${m.id}:${i}`);
      draw();
      return toast("원고에서 바꿀 자리를 찾지 못했어요. 그 사이 고쳐졌거나 같은 글이 여러 곳에 있어요. 복사해서 직접 넣어 주세요", "error");
    }
    saveVersion(mid, ta.value); // 넣기 전 원고를 버전 기록에 ('AI 넣기 전')
    applyEdit(ta, { from: e.from, to: e.to, text: e.text, selStart: e.from, selEnd: e.from + e.text.length });
    toast(e.state === "same" ? "제안을 적용했어요" : "원고가 바뀌어 있어 원래 글을 다시 찾아 적용했어요", "success");
    setState(m, i, "applied");
  };
  const applyAll = (m) => {
    if (!editorOk()) return;
    const idx = m.proposals.map((p, i) => i).filter((i) => !m.proposals[i].state && !S.lost.has(`${m.id}:${i}`));
    const r = applyProposals(ta.value, m.proposals, m.scope, idx);
    r.lost.forEach((i) => S.lost.add(`${m.id}:${i}`));
    if (r.applied.length) {
      saveVersion(mid, ta.value); // 한 번만
      const s = ta.selectionStart;
      applyEdit(ta, diffEdit(ta.value, r.value, s, s)); // 한 덩어리 — 실행 취소 한 번으로 모두 되돌아감
      r.applied.forEach((i) => setState(m, i, "applied"));
    }
    draw();
    toast(`제안 ${r.applied.length}개를 적용했어요${r.lost.length ? ` · ${r.lost.length}개는 자리를 찾지 못했어요` : ""}`, r.lost.length ? "error" : "success");
  };
  const again = (m, i) => {
    const p = m.proposals[i];
    const e = proposalEdit(ta.value, p, m.scope);
    if (e.state === "lost") return toast("원고에서 이 부분을 찾지 못했어요. 글을 골라 다시 물어봐 주세요", "error");
    const label = `${String(m.scope && m.scope.label || "").replace(/ · (고른 글|문단|목록)$/, "")} · 제안 ${i + 1}`.replace(/^ · /, "");
    const scope = { kind: "sel", label, from: e.from, to: e.to, fingerprint: docHash(ta.value), text: ta.value.slice(e.from, e.to) };
    ask(`이 부분을 다른 방식으로 다시 고쳐 주세요. 앞 제안: “${String(p.replace).slice(0, 300)}”`, scope);
  };
  const locate = (m, i) => {
    const e = proposalEdit(ta.value, m.proposals[i], m.scope);
    if (e.state === "lost") return toast("원고에서 이 부분을 찾지 못했어요. 그 사이 고쳐졌을 수 있어요");
    ctx.select(e.from, e.to);
  };

  log.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === "retry") {
      try { const r = await retryJob(Number(b.dataset.job)); trackJob(r.job); } catch (err) { return errorToast(err); }
      return load();
    }
    const m = msgOf(b.dataset.msg);
    if (!m) return;
    if (a === "apply-all") return applyAll(m);
    const i = Number(b.dataset.i);
    if (!m.proposals || !m.proposals[i]) return;
    if (a === "apply") applyOne(m, i);
    else if (a === "again") again(m, i);
    else if (a === "discard") setState(m, i, "discarded");
    else if (a === "undo") { S.lost.delete(`${m.id}:${i}`); setState(m, i, ""); }
    else if (a === "copy") copyText(m.proposals[i].replace);
    else if (a === "locate") locate(m, i);
  });
  $("[data-form]", root).addEventListener("submit", (e) => { e.preventDefault(); send(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); }
  });
  $("[data-clear]", root).onclick = async () => {
    if (!S.messages.length) return toast("지울 대화가 없어요");
    if (!(await confirmDialog("이 원고의 AI 대화를 모두 지울까요? 답을 기다리는 질문은 취소돼요. 원고는 바뀌지 않아요.", { ok: "대화 지우기", danger: true }))) return;
    try { await api.del(`/api/manuscripts/${mid}/chat`); } catch (err) { return errorToast(err); }
    stopFollow();
    Object.assign(S, { messages: [], jobs: {} });
    S.lost.clear();
    draw();
    toast("대화를 지웠어요");
  };

  return {
    show: () => {
      S.visible = true;
      drawTarget();
      if (!S.loaded) load(); else { draw(); load(); }
    },
    hide: () => { S.visible = false; stopFollow(); },
    focus: () => input.focus(),
    refresh: load,
    destroy: () => {
      stopFollow();
      clearTimeout(tTimer);
      for (const ev of ["keyup", "mouseup", "input", "select", "focus"]) ta.removeEventListener(ev, onCaret);
    },
  };
}

// ------------------------------------------------------------------ 장 · 절 일괄 처리
// ctx: { mid, ta, select(a, b), say(text), alive(), modeName(mode) }
export function batchView(root, ctx) {
  const { mid, ta } = ctx;
  const S = { batches: [], sel: null, jobs: [], timer: null, visible: false, snapped: new Set(), lost: new Set(), key: "" };
  root.innerHTML = `<div class="mb"><div class="mb-head"><select class="input mb-pick" data-pick aria-label="일괄 처리 고르기 (새것이 위)"></select></div>
    <div class="mb-body" data-body></div></div>`;
  const pick = $("[data-pick]", root);
  const body = $("[data-body]", root);
  const alive = () => ctx.alive() && root.isConnected;

  const listBatches = async () => {
    let data;
    try { data = await api.get(`/api/manuscripts/${mid}/ai-batch`); } catch { return; }
    if (!alive()) return;
    S.batches = data.batches || [];
    if (!S.sel || !S.batches.some((b) => b.id === S.sel)) S.sel = S.batches.length ? S.batches[0].id : null;
    drawPick();
    await loadDetail();
  };
  const loadDetail = async () => {
    clearTimeout(S.timer);
    if (!S.sel) { S.jobs = []; return draw(); }
    const id = S.sel;
    let data;
    try { data = await api.get(`/api/manuscripts/${mid}/ai-batch/${id}`); } catch (err) {
      if (err.status === 404) { S.batches = S.batches.filter((b) => b.id !== id); S.sel = null; drawPick(); return draw(); }
      return;
    }
    if (!alive() || S.sel !== id) return;
    S.jobs = data.jobs || [];
    S.jobs.forEach((j) => { if (!isActive(j)) handledJob(j.id); }); // 일괄 보기에서 봄 — 문단마다 끝남 알림을 띄우지 않음
    draw();
    if (S.visible && S.jobs.some(isActive)) S.timer = setTimeout(loadDetail, document.hidden ? 10000 : 2500);
    else if (S.batches.some((b) => b.id === id && b.active)) listBatches(); // 막 끝남 — 목록 숫자를 맞춤
  };
  const drawPick = () => {
    pick.innerHTML = S.batches.length
      ? S.batches.map((b) => `<option value="${esc(b.id)}">${esc(`${b.label || "일괄 처리"} · ${ctx.modeName(b.mode)} · ${b.jobs}개 · ${fmtClock(b.created_at)}`)}</option>`).join("")
      : `<option value="">아직 일괄 처리가 없어요</option>`;
    pick.disabled = !S.batches.length;
    pick.value = S.sel || "";
  };

  const draw = () => {
    if (!S.visible) return;
    const key = JSON.stringify([S.sel, S.jobs.map((j) => [j.id, j.status, batchItemState(j), (j.progress || {}).partial_text || ""]), [...S.lost]]);
    if (key === S.key) return;
    S.key = key;
    const focused = body.contains(document.activeElement) ? document.activeElement.dataset.key || "" : "";
    body.innerHTML = "";
    if (!S.sel || !S.jobs.length) {
      body.append(el(`<div class="ai-empty"><p>장 · 절을 한 번에 다듬어 보세요.</p>
        <p class="small muted"><b>✦ AI 도우미</b>에서 범위를 <b>이 절</b>이나 <b>이 장</b>으로 고르고 다듬기 · 학술 문체 · 간결하게 같은 문단 모드를 고르면
        문단마다 따로 고친 결과가 여기 모여요. 문단마다 바뀐 부분을 보고 [적용] · [건너뛰기] 하거나 [모두 적용]할 수 있어요.</p></div>`));
      return;
    }
    const batch = (S.jobs[0].write || {}).batch || {};
    const c = batchCounts(S.jobs);
    const head = el(`<div class="mb-sum"><div class="mb-title"></div><div class="ai-actions"></div></div>`);
    $(".mb-title", head).textContent = batchTitle(batch, c, ctx.modeName(batch.mode));
    const ha = $(".ai-actions", head);
    const hb = (act, label, cls, on, title) => {
      const b = el(`<button type="button" class="btn sm ${cls}" data-act="${act}" data-key="${act}">${esc(label)}</button>`);
      b.disabled = !on;
      b.title = title;
      ha.append(b);
    };
    hb("all", `모두 적용${c.ready ? ` (${c.ready})` : ""}`, "primary", c.ready > 0, "넣기 전 결과를 모두 넣어요 — 원래 문단이 그대로인 곳만 바꾸고, 실행 취소 한 번으로 되돌릴 수 있어요");
    hb("skip-all", "남은 것 건너뛰기", "ghost", c.ready > 0, "넣기 전 결과를 모두 건너뛰어요 (원고는 그대로)");
    body.append(head);
    S.jobs.forEach((j, i) => body.append(itemNode(j, i)));
    if (focused) body.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
  };
  const itemNode = (j, i) => {
    const st = S.lost.has(j.id) && batchItemState(j) === "ready" ? "lost" : batchItemState(j);
    const w = j.write || {};
    const node = el(`<div class="mb-item" data-state="${esc(st)}"><div class="mc-prop-h"><b>문단 ${i + 1}</b>
      <span class="chip ai-st" data-st="${st === "ready" || st === "running" ? st : st === "applied" ? "applied" : "failed"}">${esc(BATCH_STATE_TEXT[st] || "")}</span></div></div>`);
    if (st === "running") {
      const out = el(`<div class="ai-out mc-partial"></div>`);
      const partial = (j.progress || {}).partial_text || "";
      if (partial) out.textContent = partial;
      else out.textContent = j.status === "queued" ? "차례를 기다리는 중…" : "고치는 중…";
      node.append(out);
    } else if (st === "failed" || st === "cancelled") {
      node.append(el(`<div class="msg error">${esc(j.error || "결과를 만들지 못했어요")}</div>`));
    } else if (st === "expired") {
      node.append(el(`<div class="msg error">결과 글이 지워졌어요 (7일 보관).</div>`));
    } else {
      const d = el(`<div class="ai-diff" aria-label="원래 문단과 바뀐 부분"></div>`);
      d.innerHTML = diffHtml(wordDiff(w.text || "", ((j.result && j.result.text) || "").trim()));
      node.append(d);
    }
    const acts = el(`<div class="ai-actions"></div>`);
    const b = (act, label, cls, title = "") => {
      const x = el(`<button type="button" class="btn sm ${cls}" data-act="${act}" data-job="${Number(j.id)}" data-key="${act}-${Number(j.id)}">${esc(label)}</button>`);
      if (title) x.title = title;
      acts.append(x);
    };
    if (st === "ready") {
      b("apply", "적용", "primary", "이 문단만 바꿔요 — 원래 문단이 그대로 있을 때만");
      b("skip", "건너뛰기", "ghost");
    }
    if (st === "lost") b("copy", "복사");
    if (st === "failed" || st === "cancelled") b("retry", "다시 시도", "");
    b("locate", "원고에서 보기", "ghost");
    node.append(acts);
    return node;
  };

  // ---- 넣기
  const snap = () => {
    if (S.snapped.has(S.sel)) return;
    S.snapped.add(S.sel);
    saveVersion(mid, ta.value); // 이 일괄 처리의 첫 넣기 전에 한 번만 ('AI 넣기 전')
  };
  const handled = (j, state) => {
    j.write = { ...(j.write || {}), handled: state };
    return api.post(`/api/jobs/${j.id}/handled`, { state }).catch(() => {});
  };
  const applyOne = (j) => {
    if (!ctx.alive()) return toast("이 원고가 열려 있을 때만 넣을 수 있어요", "error");
    const e = batchEdit(ta.value, j);
    if (e.state === "lost") {
      S.lost.add(j.id);
      draw();
      return toast("원고에서 원래 문단을 찾지 못했어요. 그 사이 고쳐졌을 수 있어요. 복사해서 직접 넣어 주세요", "error");
    }
    snap();
    applyEdit(ta, { from: e.from, to: e.to, text: e.text, selStart: e.from, selEnd: e.from + e.text.length });
    handled(j, "applied");
    draw();
  };
  const applyAll = () => {
    if (!ctx.alive()) return toast("이 원고가 열려 있을 때만 넣을 수 있어요", "error");
    const r = applyBatch(ta.value, S.jobs);
    r.lost.forEach((id) => S.lost.add(id));
    if (r.applied.length) {
      snap();
      const s = ta.selectionStart;
      applyEdit(ta, diffEdit(ta.value, r.value, s, s)); // 한 덩어리 — 실행 취소 한 번으로 모두 되돌아감
      S.jobs.filter((j) => r.applied.includes(j.id)).forEach((j) => handled(j, "applied"));
    }
    draw();
    ctx.say(`문단 ${r.applied.length}개를 넣었어요`);
    toast(`문단 ${r.applied.length}개를 넣었어요${r.lost.length ? ` · ${r.lost.length}개는 원래 문단을 찾지 못해 건너뛰었어요` : ""}`, r.lost.length ? "error" : "success");
  };
  const jobOf = (id) => S.jobs.find((j) => j.id === Number(id));
  body.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === "all") return applyAll();
    if (a === "skip-all") {
      await Promise.all(S.jobs.filter((j) => batchItemState(j) === "ready").map((j) => handled(j, "dismissed")));
      return draw();
    }
    const j = jobOf(b.dataset.job);
    if (!j) return;
    if (a === "apply") applyOne(j);
    else if (a === "skip") { await handled(j, "dismissed"); draw(); }
    else if (a === "copy") copyText((j.result && j.result.text) || "");
    else if (a === "retry") {
      try { const r = await retryJob(j.id); trackJob(r.job); toast("이 문단을 다시 시작했어요. 새 결과는 AI 결과 탭에 나와요", "success"); } catch (err) { errorToast(err); }
    } else if (a === "locate") {
      const ed = batchEdit(ta.value, j);
      if (ed.state === "lost") return toast("원고에서 원래 문단을 찾지 못했어요");
      ctx.select(ed.from, ed.to);
    }
  });
  pick.onchange = () => { S.sel = pick.value || null; S.lost.clear(); S.key = ""; loadDetail(); };

  return {
    show: (bid = null) => {
      S.visible = true;
      S.key = "";
      if (bid) S.sel = bid;
      listBatches();
    },
    hide: () => { S.visible = false; clearTimeout(S.timer); },
    destroy: () => { S.visible = false; clearTimeout(S.timer); },
  };
}
