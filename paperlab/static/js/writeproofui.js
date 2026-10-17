// 맞춤법 · 띄어쓰기 점검 패널 + 초록 만들기 시작 (2026-10-17 — docs/specs/writing-proofread.md).
// 패널은 제출 전 점검표와 같은 모양(편집기 위에 겹쳐 뜨지만 입력을 막지 않음 — aria-modal="false")이고, AI 작업이 도는
// 동안에도 계속 쓸 수 있다. [고치기] = 그 한 곳만(지금 원고에서 자리를 다시 확인), [모두 고치기] = 버전 기록에 남긴 뒤
// 편집 한 덩어리(Ctrl+Z 한 번으로 되돌림), [무시] · [이동]. AI 결과 글은 모두 textContent로만 넣는다.
// 규칙(범위 · 조각 · 자리 찾기 · 고치기)은 writeproof.js에 있다.

import { api, qs } from "./api.js";
import { cancelJob, ensureAiRoute, isActive, jobLine, nudgeDesktop, retryJob, trackJob } from "./jobs.js";
import { $, el, errorToast, esc, modalOpen, toast } from "./ui.js";
import { browserStorage, docHash, writeAnchor } from "./writeai.js";
import { diffEdit } from "./writeedit.js";
import { saveVersion } from "./writehistui.js";
import {
  ABSTRACT_MODES, PROOF_SCOPES, abstractPlan, applyAll, continueRange, fixEdit, isProofKey, loadMarks, locateIssue, newRunId,
  planRun, proofCheckText, proofRuns, runItems, runStatus, saveMarks, scopeRange,
} from "./writeproof.js";
import { applyEdit } from "./writetools.js";

const SCOPE_NAME = Object.fromEntries(PROOF_SCOPES);
const SCOPE_PREF = "paperlab.proofScope";
const SHOW = 200; // 패널 목록에 한 번에 보이는 항목

// hooks: { ta, mid, select(a, b), say(text), changed() — 점검표 다시 그리기 }
export function proofPanel(view, hooks) {
  const { ta, mid } = hooks;
  const pane = el(`<aside class="panel check-pane proof-pane" role="dialog" aria-modal="false" aria-labelledby="pf-title" tabindex="-1" hidden>
    <div class="check-head"><b id="pf-title">맞춤법 · 띄어쓰기</b><span class="spacer"></span>
      <button type="button" class="icon-btn" data-pf-close aria-label="맞춤법 점검 닫기" title="닫기 (Alt+P · Esc) — 점검 작업은 계속돼요">✕</button></div>
    <div class="proof-run"><label class="small" for="pf-scope">범위</label>
      <select class="input" id="pf-scope" data-pf-scope>${PROOF_SCOPES.map(([v, n]) => `<option value="${v}">${esc(n)}</option>`).join("")}</select>
      <button type="button" class="btn sm primary" data-pf-start title="고른 범위를 AI로 점검해요 (원고는 바꾸지 않아요)">점검</button></div>
    <div class="check-sum small muted" data-pf-sum aria-live="polite"></div>
    <div class="check-body" data-pf-body></div></aside>`);
  view.appendChild(pane);
  const body = $("[data-pf-body]", pane);
  const scopeSel = $("[data-pf-scope]", pane);
  const S = { open: false, jobs: [], run: null, marks: { hidden: new Set(), fixed: new Set() }, timer: null, busy: false,
    loaded: false, dead: false, inputTimer: null };
  const alive = () => !S.dead && ta.isConnected;
  try { const p = localStorage.getItem(SCOPE_PREF); if (SCOPE_NAME[p]) scopeSel.value = p; } catch { /* 기본값 */ }

  const runs = () => proofRuns(S.jobs);
  const curRun = () => runs().find((r) => r.run === S.run) || runs()[0] || null;
  const status = () => runStatus(curRun());
  const pending = () => {
    const r = curRun();
    if (!r) return [];
    // 고친 항목은 원고에서 다시 보이면(Ctrl+Z로 되돌림) 목록으로 돌려놓는다
    return runItems(r, S.marks.hidden).filter((it) => {
      if (!S.marks.fixed.has(it.key)) return true;
      if (locateIssue(ta.value, it) < 0) return false;
      S.marks.fixed.delete(it.key);
      return true;
    });
  };
  const setRun = (id) => {
    if (S.run === id) return;
    S.run = id;
    S.marks = loadMarks(browserStorage() || { getItem: () => null }, mid, id);
  };
  const persist = () => { const st = browserStorage(); if (st && S.run) saveMarks(st, mid, S.run, S.marks); };

  // ---- 그리기
  const draw = () => {
    if (!S.open || !alive()) return;
    const r = curRun();
    const st = status();
    const items = pending();
    const cur = ta.value;
    // 목록은 SHOW개까지 (자리 다시 찾기는 보이는 항목만 — 긴 원고에서 쓰는 동안 느려지지 않게). [모두 고치기]는 전부
    const located = items.slice(0, SHOW).map((it) => ({ it, at: locateIssue(cur, it) }));
    const ok = located.filter((x) => x.at >= 0);
    const rest = items.length - located.length;
    const keep = document.activeElement && pane.contains(document.activeElement) ? document.activeElement.dataset : null;
    const keepSel = keep && (keep.pfAct ? `[data-pf-act="${keep.pfAct}"][data-pf-i="${keep.pfI}"]` : keep.pfTop ? `[data-pf-top="${keep.pfTop}"]` : null);
    const top = body.scrollTop;
    const sum = !r ? "아직 점검하지 않았어요. 범위를 고르고 [점검]을 누르세요."
      : `${SCOPE_NAME[st.scope] || "점검"} · ${st.active ? `점검 중 (${st.done}/${st.total} 조각)` : `${st.done}/${st.total} 조각 끝남`}`
        + ` · 고칠 곳 ${ok.length + rest}${located.length > ok.length ? ` · 찾지 못함 ${located.length - ok.length}` : ""}`
        + `${S.marks.fixed.size ? ` · 고침 ${S.marks.fixed.size}` : ""}${S.marks.hidden.size ? ` · 무시 ${S.marks.hidden.size}` : ""}`;
    $("[data-pf-sum]", pane).textContent = sum;
    $("[data-pf-start]", pane).disabled = S.busy;
    body.innerHTML = "";
    if (r) {
      // 진행 · 실패한 조각 · 이어서 점검
      if (st.active) {
        const line = el(`<div class="proof-status small"><span class="spinner" aria-hidden="true"></span><span class="grow"></span>
          <button type="button" class="btn sm ghost" data-pf-top="cancel">취소</button></div>`);
        const running = st.jobs.find((j) => isActive(j));
        $(".grow", line).textContent = `${st.total - st.done - st.failed.length}개 조각 점검 중 — ${running ? jobLine(running, "점검", { elapsed: false }) : ""}`;
        body.append(line);
      }
      for (const j of st.failed) {
        const f = el(`<div class="notice proof-failed" data-tone="warn"><div><span></span>
          <div class="notice-actions"><button type="button" class="btn sm" data-pf-top="retry-${Number(j.id)}">다시 시도</button></div></div></div>`);
        $("span", f).textContent = `${j.proof.chunk}번째 조각: ${j.status === "cancelled" ? "취소했어요" : j.error || "점검하지 못했어요"}`;
        body.append(f);
      }
      const more = !st.active && continueRange(cur, st, docHash(cur));
      if (more) {
        const c = el(`<div class="proof-more small"><span class="grow"></span>
          <button type="button" class="btn sm" data-pf-top="continue">이어서 점검</button></div>`);
        $(".grow", c).textContent = `남은 글 약 ${(more.to - more.from).toLocaleString()}자는 아직 점검하지 않았어요.`;
        body.append(c);
      }
      if (ok.length + rest > 1) {
        body.append(el(`<div class="proof-all"><button type="button" class="btn sm primary" data-pf-top="all"
          title="찾은 곳을 한꺼번에 고쳐요 — 고치기 전 원고를 버전 기록에 남기고, Ctrl+Z 한 번으로 되돌려요">모두 고치기 (${ok.length + rest})</button></div>`));
      }
    }
    if (r && !located.length && !st.active) {
      body.append(el(`<div class="check-ok">✓ ${st.done ? "고칠 곳이 더 없어요" : "점검 결과가 아직 없어요"}</div>`));
    }
    if (located.length) {
      const ol = el(`<ol class="check-list proof-list"></ol>`);
      located.forEach(({ it, at }, i) => {
        const li = el(`<li class="check-item proof-item${at < 0 ? " lost" : ""}"><span class="check-tag"></span>
          <span class="check-msg"><span class="proof-diff"><del></del> → <ins></ins></span> <span class="proof-why muted"></span></span>
          <span class="check-acts"></span></li>`);
        $(".check-tag", li).textContent = it.type;
        $("del", li).textContent = it.find;
        $("ins", li).textContent = it.replace;
        $(".proof-why", li).textContent = at < 0 ? "원고에서 찾지 못했어요 (이미 고쳤거나 글이 바뀜)" : it.reason;
        const acts = $(".check-acts", li);
        const btn = (act, label, title) => {
          const b = el(`<button type="button" class="btn sm ghost" data-pf-act="${act}" data-pf-i="${i}">${esc(label)}</button>`);
          if (title) b.title = title;
          acts.append(b);
        };
        if (at >= 0) {
          btn("go", "이동", "편집기에서 이 자리를 골라요");
          btn("fix", "고치기", "이 한 곳만 고쳐요");
        }
        btn("skip", "무시", "이 항목을 목록에서 빼요");
        ol.append(li);
      });
      body.append(ol);
      if (rest > 0) body.append(el(`<p class="small muted">… 아래 ${rest}건은 앞 항목을 고치거나 무시하면 보여요.</p>`));
    }
    body.append(el(`<p class="check-note small muted">AI가 찾은 곳이에요 — 고치기 전에 확인해 주세요. 인용키 · 그림 · 표 줄 · 제목 번호 · 주소는 고치지 않아요. 결과는 7일 동안 남아요.</p>`));
    S.items = located;
    body.scrollTop = top;
    const again = keepSel && $(keepSel, body);
    if (again) again.focus();
    else if (keep) pane.focus();
  };

  const changed = () => { draw(); if (hooks.changed) hooks.changed(); };

  // 이 원고의 점검 작업(7일, 결과까지) — 패널을 열 때 · 시작 · 다시 시도 · 취소 뒤, 그리고 조각이 끝났을 때만.
  // 점검 중에는 poll이 진행 중 작업만(결과 없음 — 가벼움) 2초마다(탭이 숨으면 10초) 본다
  const later = () => { S.timer = setTimeout(poll, document.hidden ? 10000 : 2000); };
  const refresh = async () => {
    clearTimeout(S.timer);
    let data;
    try { data = await api.get(`/api/jobs${qs({ status: "recent", kind: "proofread", manuscript_id: mid, limit: 100 })}`); } catch { return; }
    if (!alive()) return;
    S.jobs = data.jobs || [];
    S.loaded = true;
    const rs = runs();
    if (rs.length && !rs.some((r) => r.run === S.run)) setRun(rs[0].run);
    changed();
    if (status().active) later();
  };
  const poll = async () => {
    clearTimeout(S.timer);
    const was = status().jobs.filter(isActive).map((j) => j.id);
    if (!was.length) return;
    let data;
    try {
      data = await api.get(`/api/jobs${qs({ status: "active", kind: "proofread", manuscript_id: mid, limit: 50 })}`);
    } catch {
      if (alive()) later();
      return;
    }
    if (!alive()) return;
    const now = new Map((data.jobs || []).map((j) => [j.id, j]));
    if (was.some((id) => !now.has(id))) return refresh(); // 끝난 조각이 있음 → 결과까지 한 번 다시
    S.jobs = S.jobs.map((j) => now.get(j.id) || j); // 대기 → 실행 중 같은 상태만 바꿈
    changed();
    later();
  };

  // ---- 동작
  const makeJobs = async (v, from, to, scope, { run = newRunId(), base = 0 } = {}) => {
    const plan = planRun(v, from, to);
    if (!plan.chunks.length) return toast("점검할 글이 없어요");
    const hash = docHash(v);
    S.busy = true;
    draw();
    let made = 0;
    try {
      for (const [i, c] of plan.chunks.entries()) {
        const { job } = await api.post("/api/ai/proofread", {
          text: v.slice(c.from, c.to), offset: c.from, chunk: base + i + 1, chunks: base + plan.chunks.length, scope, run,
          end: plan.next == null ? null : plan.end, doc_len: v.length, doc_hash: hash, manuscript_id: mid,
        });
        if (!made) { nudgeDesktop(job); trackJob(job); }
        made++;
      }
    } catch (err) {
      errorToast(err);
    } finally {
      S.busy = false;
    }
    if (!made) return draw();
    if (S.run !== run) setRun(run);
    if (hooks.say) hooks.say(`맞춤법 점검을 시작했어요 (${made}개 조각). 계속 쓰셔도 돼요`);
    refresh();
  };

  const start = async () => {
    if (S.busy) return;
    const scope = scopeSel.value;
    try { localStorage.setItem(SCOPE_PREF, scope); } catch { /* 이번만 */ }
    const range = () => scopeRange(ta.value, ta.selectionStart, ta.selectionEnd, scope);
    if (!range()) return toast(scope === "sel" ? "점검할 글을 먼저 고르세요" : "점검할 글이 없어요. 문단 안에 커서를 두세요");
    // 글쓰기 도우미 경로를 쓴다 (엔진 순서 · 연결된 PC · 내 API 키 — 서버 PC에서는 실행하지 않음)
    if (!(await ensureAiRoute("write")) || !alive()) return;
    const r = range(); // 경로를 확인하는 사이 원고가 바뀌었을 수 있어 지금 원고로 다시
    if (r) await makeJobs(ta.value, r.from, r.to, scope);
  };

  const cont = async () => {
    const st = status();
    const r = continueRange(ta.value, st, docHash(ta.value));
    if (!r) return toast("남은 범위를 찾지 못했어요. 범위를 고르고 다시 점검해 주세요");
    if (!(await ensureAiRoute("write")) || !alive()) return;
    await makeJobs(ta.value, r.from, r.to, st.scope, { run: S.run, base: st.total });
  };

  const fixOne = (it, i) => {
    const edit = fixEdit(ta.value, it);
    if (!edit) {
      toast("원고에서 그 글을 찾지 못했어요. 이미 고쳤거나 글이 바뀌었을 수 있어요");
      return draw();
    }
    applyEdit(ta, edit); // 실행 취소(Ctrl+Z)에 남음
    S.marks.fixed.add(it.key);
    persist();
    changed();
    // 다음 항목의 [고치기]로 초점 (키보드로 이어서 고치기)
    const next = $(`[data-pf-act="fix"][data-pf-i="${i}"]`, body) || $('[data-pf-act="fix"]', body);
    if (next) next.focus();
  };

  const fixAll = () => {
    const items = pending(); // 보이지 않는 항목까지 — 자리는 applyAll이 지금 원고에서 다시 찾음
    if (!items.length) return;
    const before = ta.value;
    const r = applyAll(before, items);
    if (!r.fixed.length) return toast("원고에서 고칠 곳을 찾지 못했어요");
    saveVersion(mid, before); // 고치기 전 원고를 버전 기록에 ('AI 넣기 전')
    const caret = r.first ?? ta.selectionStart;
    applyEdit(ta, diffEdit(before, r.value, caret, caret)); // 편집 한 덩어리 — Ctrl+Z 한 번
    for (const it of r.fixed) S.marks.fixed.add(it.key);
    persist();
    changed();
    toast(`${r.fixed.length}곳을 고쳤어요. Ctrl+Z로 한 번에 되돌릴 수 있어요${r.lost.length ? ` (찾지 못한 ${r.lost.length}곳은 그대로)` : ""}`, "success");
    pane.focus();
  };

  pane.addEventListener("click", async (e) => {
    if (e.target.closest("[data-pf-close]")) return hide();
    if (e.target.closest("[data-pf-start]")) return start();
    const topB = e.target.closest("[data-pf-top]");
    if (topB) {
      const a = topB.dataset.pfTop;
      if (a === "all") return fixAll();
      if (a === "continue") return cont();
      if (a === "cancel") {
        for (const j of status().jobs.filter(isActive)) await cancelJob(j.id).catch(() => {});
        return refresh();
      }
      if (a.startsWith("retry-")) {
        try { const r = await retryJob(Number(a.slice(6))); trackJob(r && r.job); } catch (err) { errorToast(err); }
        return refresh();
      }
      return;
    }
    const b = e.target.closest("[data-pf-act]");
    const x = b && S.items && S.items[Number(b.dataset.pfI)];
    if (!x) return;
    const act = b.dataset.pfAct;
    if (act === "go") {
      const at = locateIssue(ta.value, x.it);
      if (at < 0) return draw();
      hooks.select(at, at + x.it.find.length);
    } else if (act === "fix") fixOne(x.it, Number(b.dataset.pfI));
    else if (act === "skip") {
      S.marks.hidden.add(x.it.key);
      persist();
      changed();
    }
  });
  pane.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalOpen()) { e.preventDefault(); hide(); }
  });

  // ---- 열기 · 닫기
  const place = () => {
    const anchor = $(".writer-body", view);
    const top = anchor ? Math.max(0, Math.round(anchor.getBoundingClientRect().top)) + 8 : 120;
    pane.style.setProperty("--ck-top", `${top}px`);
  };
  const show = () => {
    S.open = true;
    place();
    pane.hidden = false;
    // 고른 글이 있으면 범위를 '고른 글'로 (없는데 '고른 글'이면 '이 문단')
    if (ta.selectionStart !== ta.selectionEnd) scopeSel.value = "sel";
    else if (scopeSel.value === "sel") scopeSel.value = "para";
    draw();
    refresh();
    pane.focus();
  };
  const hide = () => {
    S.open = false;
    pane.hidden = true;
    if (ta.isConnected) ta.focus();
  };
  const toggle = () => (S.open ? hide() : show());
  const onKey = (e) => {
    if (!isProofKey(e) || modalOpen() || !view.isConnected) return;
    e.preventDefault(); // macOS Option+P의 π 막기
    toggle();
  };
  document.addEventListener("keydown", onKey);
  const onResize = () => { if (S.open) place(); };
  window.addEventListener("resize", onResize);
  // 쓰는 동안 '찾지 못함' 표시를 맞춤 (패널이 열려 있을 때만, 0.5초 뒤)
  const onInput = () => {
    if (!S.open) return;
    clearTimeout(S.inputTimer);
    S.inputTimer = setTimeout(draw, 500);
  };
  ta.addEventListener("input", onInput);
  refresh(); // 점검표 한 줄을 위해 한 번 (AI는 부르지 않음)

  return {
    open: show,
    toggle,
    isOpen: () => S.open,
    // 제출 전 점검표의 한 줄 {text, label, run} — 마지막 점검 결과로만 (AI를 부르지 않음)
    checkLine: () => {
      const r = curRun();
      const st = status();
      const items = r ? pending() : [];
      const open = items.length > SHOW ? items.length : items.filter((it) => locateIssue(ta.value, it) >= 0).length;
      return { text: proofCheckText({ ran: !!r, active: st.active, open, failed: st.failed.length }),
        label: r ? "맞춤법 점검 보기" : "맞춤법 점검 열기", run: show };
    },
    destroy: () => {
      S.dead = true;
      clearTimeout(S.timer);
      clearTimeout(S.inputTimer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      ta.removeEventListener("input", onInput);
      pane.remove();
    },
  };
}

// ------------------------------------------------------------------ 초록 만들기
// 영문 초록 · 국문 초록 = 글쓰기 도우미 작업(mode abstract_en · abstract_ko)으로 넣기(insert) — 결과는 AI 결과 패널에서
// 원래 자리에 넣는다(원고가 바뀌었으면 확인). 대상 초록이 없으면 패널이 넣을 때 원문 초록과 같은 모양의 표지째
// ('**Abstract**' 굵은 줄 · 제목 — withAbstractHeading)
// opts: { mid, show(job) — AI 결과 패널에 보이기 }
export async function startAbstract(mode, ta, { mid = null, show = null } = {}) {
  const plan = abstractPlan(ta.value, ta.selectionStart, ta.selectionEnd, mode);
  if (plan.error) return toast(plan.error, "error");
  if (plan.append) toast(`이미 ${ABSTRACT_MODES[mode].heading}에 글이 있어요. 새 결과는 그 끝에 덧붙여요`);
  let job;
  try {
    job = (await api.post("/api/ai/write", { mode, text: plan.text, keys: [], instruction: "", context: "", manuscript_id: mid,
      ...writeAnchor(ta.value, plan.at, plan.at, true) })).job;
  } catch (err) {
    return errorToast(err);
  }
  trackJob(job);
  if (show) show(job);
  if (ta.offsetParent && (!document.activeElement || document.activeElement === document.body)) ta.focus();
}
