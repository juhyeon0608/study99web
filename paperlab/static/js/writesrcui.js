// 출처 확인 화면 (2026-10-26 사용자 요청): AI 결과 패널의 '출처' 보기.
// 원고 문장 하나([확인 필요: …]가 든 문장 · 고른 글) → POST /api/source-check → 백그라운드 작업(find, mode=claim).
// 결과: 판정 · 근거(번호 [L1] 서재 조각 · [1] 외부 논문) · 고친 문장([원고에 넣기]) · 확인할 곳 · 서재 조각 · 외부 논문 카드.
// 순수 함수는 writesrc.js
import { api, qs } from "./api.js";
import { FIND_FAIL, FIND_WARN } from "./ask.js";
import { cancelJob, fmtClock, handledJob, isActive, jobLine, watchJob } from "./jobs.js";
import { $, $$, copyText, el, errorToast, esc, toast } from "./ui.js";
import { CHECK_RE } from "./writemd.js";
import { claimAt, claimRange, parseClaim, refsHtml } from "./writesrc.js";

const STEPS = [["queries", "검색어 만들기"], ["search", "서재 · 외부 논문 검색"], ["summary", "근거 판정"]];
const STATE_TEXT = { queued: "기다리는 중", running: "확인하는 중", succeeded: "끝남", failed: "실패", cancelled: "취소됨" };
const LIB_WARN = { library_busy: "서재 색인을 불러오는 데 오래 걸려 이번에는 서재 논문을 빼고 확인했어요." };

// 표시 부분만 칠한 문장 HTML
function claimHtml(text) {
  let out = "";
  let last = 0;
  for (const m of String(text).matchAll(CHECK_RE)) {
    out += esc(text.slice(last, m.index)) + `<mark class="check-mark">${esc(m[0])}</mark>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

/** box: 패널 칸, h: { mid, ta, alive, flash(a, b), say(t), replace(from, to, text) } */
export function sourceView(box, h) {
  const S = { jobs: [], sel: null, claims: new Map(), stop: null, visible: false, loaded: false };
  box.innerHTML = `<div class="src-head">
      <p class="small muted" style="margin:0">문장의 주장 · 수치를 <b>내 서재 논문 본문</b>과 <b>OpenAlex · Semantic Scholar</b>에서 찾아
        AI가 근거가 있는지 판정해요. 미리보기의 노란 <b>[확인 필요]</b> 표시를 누르거나, 문장에 커서를 두고(또는 글을 골라) 아래 단추를 눌러요.</p>
      <div class="row src-actions"><button type="button" class="btn sm primary" data-src-run>커서 문장 출처 확인</button>
        <select class="input src-pick" data-src-pick aria-label="지난 출처 확인 (새것이 위)"></select></div>
    </div>
    <div class="src-out" data-src-out aria-live="polite"></div>`;
  const pick = $("[data-src-pick]", box);
  const out = $("[data-src-out]", box);

  const claimOf = (j) => S.claims.get(j.id) || { text: j.question || "" };
  const label = (j) => {
    const q = (j.question || "").replace(CHECK_RE, "").replace(/\s+/g, " ").trim();
    return `${fmtClock(j.created_at)} · ${STATE_TEXT[j.status] || j.status} · ${q.length > 30 ? `${q.slice(0, 30)}…` : q || "(지워진 결과)"}`;
  };
  const drawPick = () => {
    pick.innerHTML = S.jobs.length ? S.jobs.map((j) => `<option value="${Number(j.id)}">${esc(label(j))}</option>`).join("")
      : `<option value="">아직 확인한 문장이 없어요</option>`;
    pick.disabled = !S.jobs.length;
    if (S.sel) pick.value = String(S.sel);
  };
  const cur = () => S.jobs.find((j) => j.id === S.sel) || null;

  // ---- 결과 그리기
  const draw = () => {
    const j = cur();
    out.innerHTML = "";
    if (!j) {
      out.append(el(`<div class="empty" style="padding:28px 8px"><p class="small muted">확인한 문장이 여기에 나와요. 결과는 24시간 동안 남아요.</p></div>`));
      return;
    }
    const claim = claimOf(j);
    const head = el(`<div class="src-claim"><div class="small muted">확인한 문장</div><blockquote>${claimHtml(claim.text)}</blockquote>
      <button type="button" class="link small" data-src-locate>원고에서 보기</button></div>`);
    $("[data-src-locate]", head).onclick = () => {
      const r = claimRange(h.ta.value, claim);
      if (!r) return toast("원고에서 이 문장을 찾지 못했어요 — 그 사이 고쳤을 수 있어요", "error");
      h.flash(r.from, r.to);
    };
    out.append(head);
    if (isActive(j)) return out.append(progress(j));
    if (j.status === "failed") {
      const f = el(`<div class="notice" data-tone="warn" role="alert"><div><b>확인하지 못했어요.</b> <span></span>
        <div style="margin-top:6px"><button type="button" class="btn sm" data-src-retry>다시 확인</button></div></div></div>`);
      $("span", f).textContent = FIND_FAIL[j.error_code] || j.error || "";
      $("[data-src-retry]", f).onclick = () => start(claim);
      return out.append(f);
    }
    if (j.status === "cancelled") return out.append(el(`<p class="small muted">취소한 확인이에요.</p>`));
    const res = j.result;
    if (!res) return out.append(el(`<p class="small muted">이 결과는 24시간이 지나 지워졌어요. 문장에 커서를 두고 다시 확인해 주세요.</p>`));
    drawResult(res, claim);
  };

  const progress = (j) => {
    const p = j.progress || {};
    let at = STEPS.findIndex(([k]) => k === p.step);
    if (p.step === "pick") at = 1;
    if (at < 0) at = 0;
    const card = el(`<div class="graph-progress-card job-card" style="width:100%">
      <div class="graph-progress-head"><span class="spinner" aria-hidden="true"></span><span>출처를 확인하는 중</span></div>
      <ol class="graph-steps">${STEPS.map(([k, name], i) => `<li data-step="${k}"${i < at ? ' data-state="done"' : i === at ? ' data-state="now"' : ""}>${esc(name)}</li>`).join("")}</ol>
      <p class="graph-progress-msg"></p>
      <div class="graph-progress-foot"><span class="small muted">보통 1분쯤 — 계속 쓰셔도 돼요</span><button type="button" class="btn sm" data-src-cancel>취소</button></div></div>`);
    $(".graph-progress-msg", card).textContent = jobLine(j, "실행", { elapsed: false });
    $("[data-src-cancel]", card).onclick = async () => { try { await cancelJob(j.id); } catch (e) { errorToast(e); } };
    return card;
  };

  const drawResult = (res, claim) => {
    const lib = res.library || [];
    const ext = res.sources || [];
    for (const w of res.warnings || []) {
      const t = FIND_WARN[w] || LIB_WARN[w];
      if (t) out.append(el(`<div class="notice" data-tone="warn"><div>${esc(t)}</div></div>`));
    }
    if (!res.answer) {
      out.append(el(`<div class="notice" data-tone="warn"><div><b>근거가 될 자료를 찾지 못했어요.</b> 서재에 관련 논문을 넣거나(본문 색인이 끝나야 해요)
        문장을 더 구체적으로 써서 다시 확인해 보세요.</div></div>`));
      return;
    }
    const a = parseClaim(res.answer);
    const sec = el(`<div class="src-result">
      <div class="src-verdict"><span class="chip src-v" data-tone="${esc(a.tone)}">${esc(a.verdict || "판정")}</span>
        <span class="small muted">서재 조각 ${lib.length} · 외부 논문 ${ext.length}편으로 판정</span></div>
      ${a.basis ? `<div class="src-sec"><div class="src-h">근거</div><p>${refsHtml(a.basis, esc, { lib: lib.length, ext: ext.length })}</p></div>` : ""}
      ${a.revised ? `<div class="src-sec"><div class="src-h">고친 문장</div><p class="src-revised"></p>
        <div class="row" style="gap:6px"><button type="button" class="btn sm primary" data-src-apply>원고에 넣기</button>
        <button type="button" class="btn sm" data-src-copy>복사</button></div></div>` : ""}
      ${a.where ? `<div class="src-sec"><div class="src-h">직접 확인할 곳</div><p>${esc(a.where)}</p></div>` : ""}
      <p class="small muted" style="margin:0">AI가 초록 · 본문 조각만 보고 판정한 결과예요. 넣기 전에 원문을 꼭 확인하세요.</p>
    </div>`);
    if (a.revised) {
      $(".src-revised", sec).textContent = a.revised;
      $("[data-src-copy]", sec).onclick = () => copyText(a.revised).then(() => toast("복사했어요"));
      $("[data-src-apply]", sec).onclick = () => {
        const r = claimRange(h.ta.value, claim);
        if (!r) return toast("원고에서 원래 문장을 찾지 못했어요 — [복사]해서 직접 넣어 주세요", "error");
        h.replace(r.from, r.to, a.revised);
        claim.text = a.revised; // 다시 누르면 같은 문장을 또 바꾸지 않게
        claim.from = r.from;
      };
    }
    out.append(sec);
    if (lib.length) {
      const list = el(`<div class="src-sec"><div class="src-h">내 서재 논문 조각</div><ol class="src-lib"></ol></div>`);
      for (const it of lib) {
        const li = el(`<li id="src-L${Number(it.n)}"><div class="src-lib-t"><span class="cite-ref">L${Number(it.n)}</span>
          <b></b> <span class="small muted"></span></div><p class="small src-lib-x"></p>
          ${it.citekey ? `<button type="button" class="link small" data-src-key>[@${esc(it.citekey)}] 복사</button>` : ""}</li>`);
        $("b", li).textContent = it.title || "제목 없음";
        $(".small.muted", li).textContent = `${it.year || "n.d."} · p.${Number(it.page) || 1}`;
        $(".src-lib-x", li).textContent = it.text || "";
        const k = $("[data-src-key]", li);
        if (k) k.onclick = () => copyText(`[@${it.citekey}]`).then(() => toast("인용 표시를 복사했어요 — 문장 끝에 붙여 넣으세요"));
        $("ol", list).append(li);
      }
      out.append(list);
    }
    if (ext.length) {
      const list = el(`<div class="src-sec"><div class="src-h">외부 논문 (OpenAlex · Semantic Scholar)</div><ol class="ask-sources src-ext"></ol></div>`);
      out.append(list);
      import("./discover.js").then(({ resultCard }) => {
        for (const it of ext) {
          const li = el(`<li id="src-E${Number(it.n)}"></li>`);
          li.append(resultCard(it, { n: it.n, lite: true }));
          $("ol", list).append(li);
        }
      });
    }
    // 근거 글의 [L1] · [3] → 그 항목으로
    for (const b of $$("[data-src-ref]", sec)) {
      b.onclick = () => {
        const ref = b.dataset.srcRef;
        const target = $(ref.startsWith("L") ? `#src-${ref}` : `#src-E${ref}`, out);
        if (!target) return;
        target.scrollIntoView({ block: "nearest", behavior: "smooth" });
        target.classList.add("is-flash");
        setTimeout(() => target.classList.remove("is-flash"), 1500);
      };
    }
  };

  // ---- 작업 따라가기
  const follow = (j) => {
    if (S.stop) S.stop();
    S.stop = null;
    if (!isActive(j)) return;
    S.stop = watchJob(j.id, (n) => {
      if (!n || !h.alive()) return;
      const i = S.jobs.findIndex((x) => x.id === n.id);
      if (i >= 0) S.jobs[i] = n;
      if (!isActive(n) && S.visible && S.sel === n.id) handledJob(n.id); // 보고 있으면 끝남 알림 생략
      drawPick();
      if (S.sel === n.id) draw();
      if (!isActive(n) && n.status === "succeeded" && S.visible) h.say("출처 확인이 끝났어요");
    }, { first: j });
  };

  const load = async () => {
    let data;
    try {
      data = await api.get(`/api/jobs${qs({ status: "recent", kind: "find", manuscript_id: h.mid, limit: 30 })}`);
    } catch { return; }
    if (!h.alive()) return;
    const mine = (data.jobs || []).filter((j) => j.find_mode === "claim");
    const known = new Map(S.jobs.map((j) => [j.id, j]));
    S.jobs = mine.map((j) => known.get(j.id) && isActive(j) ? known.get(j.id) : j);
    if (!S.sel && S.jobs.length) S.sel = S.jobs[0].id;
    S.loaded = true;
    drawPick();
    draw();
    const c = cur();
    if (c && isActive(c)) follow(c);
  };

  pick.onchange = () => {
    S.sel = Number(pick.value) || null;
    draw();
    const c = cur();
    if (c) follow(c);
  };

  async function start(claim) {
    if (!claim) return toast("확인할 문장을 찾지 못했어요. 문장에 커서를 두거나 글을 골라 주세요", "error");
    let job;
    try {
      job = (await api.post("/api/source-check", { claim: claim.text, manuscript_id: h.mid })).job;
    } catch (e) { return errorToast(e); }
    if (!h.alive()) return;
    S.claims.set(job.id, { ...claim });
    S.jobs = [job, ...S.jobs.filter((x) => x.id !== job.id)];
    S.sel = job.id;
    drawPick();
    draw();
    follow(job);
    h.say("출처 확인을 시작했어요. 보통 1분쯤 걸려요 — 계속 쓰셔도 돼요");
  }
  $("[data-src-run]", box).onclick = () => start(claimAt(h.ta.value, h.ta.selectionStart, h.ta.selectionEnd));

  return {
    show() { S.visible = true; if (!S.loaded) load(); else { draw(); const c = cur(); if (c) follow(c); } },
    hide() { S.visible = false; if (S.stop) S.stop(); S.stop = null; },
    start,
    open(j) { // 끝남 알림 [열기] · 작업 화면에서 연 결과
      if (!S.jobs.some((x) => x.id === j.id)) S.jobs.unshift(j);
      S.sel = j.id;
      drawPick();
      draw();
      follow(j);
    },
  };
}
