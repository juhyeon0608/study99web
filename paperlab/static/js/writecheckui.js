// 제출 전 점검표 화면 (docs/specs/writing-checklist.md): 편집기 위에 겹쳐 뜨는 패널 — 입력을 막지 않는다(aria-modal="false").
// 도구 막대 [점검] 배지 · Alt+K · [이동](편집기에서 그 자리 고르기) · 고치기 단추 · [다시 점검].
// 점검 규칙(순수 함수)은 writecheck.js에 있다.

import { ACTION_NAMES, GROUP_NAMES, SEVERITY, badgeOf, checkManuscript, fixDoubleSpaces, renumberHeadings, summaryText } from "./writecheck.js";
import { applyGlossary } from "./writeterms.js";
import { diffEdit } from "./writeedit.js";
import { applyEdit } from "./writetools.js";
import { $, el, esc, modalOpen } from "./ui.js";

// hooks: { ta, ctx() → { format: W.fmt, coverKind, cover, built, verify }, select(a, b), openCover(), verify(), rerun(), say(text),
//          extra() → { text, label, run } | null (AI 맞춤법 점검 한 줄 — 선택) }
export function checkPanel(view, hooks) {
  const ta = hooks.ta;
  const btn = $("[data-check]", view);
  const badge = $("[data-check-badge]", view);
  const pane = el(`<aside class="panel check-pane" role="dialog" aria-modal="false" aria-labelledby="ck-title" tabindex="-1" hidden>
    <div class="check-head"><b id="ck-title">제출 전 점검</b><span class="spacer"></span>
      <button type="button" class="btn sm" data-ck-journal title="투고할 학술지의 분량 · 초록 · 주제어 · 참고문헌 · 인용 양식 규정으로 점검해요">투고 규정</button>
      <button type="button" class="btn sm" data-ck-terms title="이 원고에서 쓸 말 · 피할 말을 정해 두면 점검표가 찾아 줘요">용어집</button>
      <button type="button" class="btn sm" data-ck-run title="지금 원고로 다시 점검해요">다시 점검</button>
      <button type="button" class="icon-btn" data-ck-close aria-label="점검 닫기" title="닫기 (Alt+K · Esc)">✕</button></div>
    <div class="check-sum small muted" data-ck-sum aria-live="polite"></div>
    <div class="check-body" data-ck-body></div></aside>`);
  view.appendChild(pane);
  const body = $("[data-ck-body]", pane);
  const S = { open: false, ran: false, result: null };

  const run = () => {
    const c = hooks.ctx() || {};
    const f = c.format || {};
    const built = c.built || {};
    return checkManuscript(ta.value, {
      coverKind: c.coverKind, cover: c.cover, format: f.data || null, style: c.style || null,
      items: built.items || null, issues: built.issues || null, verify: c.verify || null, retracted: c.retracted || null,
    });
  };

  const drawBadge = () => {
    const b = badgeOf(S.result);
    if (!badge || !btn) return;
    badge.hidden = !b || !b.text;
    badge.textContent = b ? b.text : "";
    badge.dataset.tone = b ? b.tone : "";
    btn.setAttribute("aria-label", b ? `제출 전 점검 — ${b.label}` : "제출 전 점검");
  };

  const draw = () => {
    const r = S.result;
    const keep = document.activeElement && pane.contains(document.activeElement) ? document.activeElement.dataset : null;
    const key = keep && (keep.ckGo != null ? `[data-ck-go="${keep.ckGo}"]` : keep.ckAct != null ? `[data-ck-act-i="${keep.ckActI}"]` : null);
    const top = body.scrollTop;
    $("[data-ck-sum]", pane).textContent = summaryText(r);
    body.innerHTML = "";
    if (!r.items.length) {
      body.appendChild(el(`<div class="check-ok">✓ 양식 · 번호 · 인용 · 글에서 고칠 곳을 찾지 못했어요</div>`));
    }
    for (const [sev, name] of SEVERITY) {
      const list = r.items.map((it, i) => [it, i]).filter(([it]) => it.sev === sev);
      if (!list.length) continue;
      const sec = el(`<section class="check-sec" data-sev="${esc(sev)}"><h3 class="check-sev">${esc(name)} <span class="check-n">${list.length}</span></h3><ol class="check-list"></ol></section>`);
      const ol = $("ol", sec);
      for (const [it, i] of list) {
        const li = el(`<li class="check-item"><span class="check-tag" data-group="${esc(it.group)}">${esc(GROUP_NAMES[it.group] || "")}</span>
          <span class="check-msg"></span><span class="check-acts"></span></li>`);
        $(".check-msg", li).textContent = it.msg;
        const acts = $(".check-acts", li);
        if (it.from != null) acts.appendChild(el(`<button type="button" class="btn sm ghost" data-ck-go="${i}" title="편집기에서 이 자리를 골라요">이동</button>`));
        if (it.action && ACTION_NAMES[it.action]) {
          acts.appendChild(el(`<button type="button" class="btn sm ghost" data-ck-act="${esc(it.action)}" data-ck-act-i="${i}">${esc(ACTION_NAMES[it.action])}</button>`));
        }
        ol.appendChild(li);
      }
      body.appendChild(sec);
    }
    const ex = hooks.extra && hooks.extra(); // 다른 점검의 한 줄 {text, label, run} — AI 맞춤법 점검(writeproofui.js, AI는 부르지 않음)
    if (ex && ex.text) {
      const row = el(`<div class="check-extra small"><span class="check-msg"></span><button type="button" class="btn sm ghost" data-ck-extra>${esc(ex.label || "열기")}</button></div>`);
      $(".check-msg", row).textContent = ex.text;
      body.appendChild(row);
    }
    body.appendChild(el(`<p class="check-note small muted">분량은 글자 수와 양식 설정으로 어림한 값이에요. 인용은 미리보기가 받아 둔 서재 정보, 근거는 마지막 인용 검증 결과를 써요 (AI를 부르지 않아요).</p>`));
    body.scrollTop = top;
    const again = key && $(key, body);
    if (again) again.focus();
    else if (keep) pane.focus();
  };

  const refresh = () => {
    if (!S.ran || !ta.isConnected) return;
    S.result = run();
    drawBadge();
    if (S.open) draw();
  };

  const place = () => {
    const anchor = $(".writer-body", view);
    const top = anchor ? Math.max(0, Math.round(anchor.getBoundingClientRect().top)) + 8 : 120;
    pane.style.setProperty("--ck-top", `${top}px`);
  };

  const show = () => {
    S.open = true;
    S.ran = true;
    place();
    pane.hidden = false;
    if (btn) btn.setAttribute("aria-expanded", "true");
    refresh();
    pane.focus();
    if (hooks.say) hooks.say(`제출 전 점검: ${summaryText(S.result)}`);
  };
  const hide = ({ focus = true } = {}) => {
    S.open = false;
    pane.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (focus) ta.focus();
  };
  const toggle = () => (S.open ? hide() : show());

  // 순수 함수로 만든 새 원고 글을 편집 한 덩어리로 넣기 (Ctrl+Z로 되돌림)
  const replaceAll = (next) => {
    const caret = Math.min(ta.selectionStart, next.length);
    if (!applyEdit(ta, diffEdit(ta.value, next, caret, caret))) return;
    refresh();
  };

  pane.addEventListener("click", async (e) => {
    if (e.target.closest("[data-ck-close]")) return hide();
    if (e.target.closest("[data-ck-run]")) {
      refresh();
      if (hooks.rerun) await hooks.rerun(); // 미리보기를 새로 그리면 인용 정보도 새로 받고 다시 점검
      if (hooks.say && S.result) hooks.say(`다시 점검했어요: ${summaryText(S.result)}`);
      return;
    }
    if (e.target.closest("[data-ck-journal]")) {
      if (hooks.openJournal && (await hooks.openJournal())) refresh();
      return;
    }
    if (e.target.closest("[data-ck-terms]")) {
      if (hooks.openGlossary && (await hooks.openGlossary())) refresh();
      return;
    }
    if (e.target.closest("[data-ck-extra]")) {
      const ex = hooks.extra && hooks.extra();
      if (ex && ex.run) ex.run();
      return;
    }
    const go = e.target.closest("[data-ck-go]");
    if (go) {
      const it = S.result && S.result.items[Number(go.dataset.ckGo)];
      if (!it) return;
      const n = ta.value.length;
      hooks.select(Math.min(it.from, n), Math.min(it.to ?? it.from, n));
      return;
    }
    const act = e.target.closest("[data-ck-act]");
    if (!act) return;
    const a = act.dataset.ckAct;
    if (a === "cover") { if (await hooks.openCover()) refresh(); }
    else if (a === "journal") { if (hooks.openJournal && (await hooks.openJournal())) refresh(); }
    else if (a === "verify") hooks.verify();
    else if (a === "renumber") replaceAll(renumberHeadings(ta.value));
    else if (a === "glossary") replaceAll(applyGlossary(ta.value, ((hooks.ctx() || {}).cover || {}).glossary || []));
    else if (a === "spaces") replaceAll(fixDoubleSpaces(ta.value));
  });
  pane.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalOpen()) { e.preventDefault(); hide(); }
  });
  if (btn) btn.onclick = toggle;
  const onKey = (e) => { // Alt+K: 점검 열기 · 닫기 (참고 패널 Alt+R과 같은 방식)
    if (e.code !== "KeyK" || !e.altKey || e.ctrlKey || e.metaKey || e.repeat || modalOpen() || !view.isConnected) return;
    e.preventDefault(); // macOS Option+K의 ˚ 막기
    toggle();
  };
  document.addEventListener("keydown", onKey);
  const onResize = () => { if (S.open) place(); };
  window.addEventListener("resize", onResize);

  return {
    refresh,
    toggle,
    isOpen: () => S.open,
    destroy: () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      pane.remove();
    },
  };
}
