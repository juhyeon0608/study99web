// 그림 만들기 · 자연어로 고치기 화면 (2026-10-17 사용자 요청 — docs/specs/writing-figure-ai.md)
// 편집기 오른쪽 칸(AI 결과 패널과 같은 자리 · 같은 모양)에 붙는 패널 — 그리는 동안에도 계속 쓸 수 있다(모달 아님).
// ① 설명으로 · 이 내용으로(고른 글 · 문단 · 절) 그리기 → ② 미리보기(정화한 SVG를 <img src="blob:">로만 — 앱 DOM에 넣지 않음)
// → ③ [원고에 넣기](브라우저에서 PNG로 그려 그림 API로 올리고 ![캡션](fig:이름) 문단, '(그림 N 참조)' 선택) ·
// [고쳐 달라고 하기](자연어 → 새 작업, 버전 목록으로 되돌아가기) · [다시 만들기]. 미리보기의 AI 그림을 누르면 [이 그림 고치기].
// 순수 함수(범위 · 넣기 · 바꾸기 · 크기 · 버전)는 writefig.js

import { api } from "./api.js";
import { cancelJob, handledJob, isActive, nudgeDesktop, retryJob, setStatusLine, statusLineEl, trackJob, watchJob } from "./jobs.js";
import { $, ICON_INFO, ICON_WARN, SVG_PURIFY, confirmDialog, el, errorToast, esc, modalOpen, store, svgUrlOk, toast } from "./ui.js";
import {
  FIG_JOB_KEY, FIG_STATE_TEXT, contentEnd, contentRange, figState, figureAt, figureRequest, insertFigure, isFigPaneKey,
  rasterSize, replaceFigure, routeNote, svgViewBox, versionIds,
} from "./writefig.js";
import { applyEdit } from "./writetools.js";

const SVG_NS = "http://www.w3.org/2000/svg";
// 서버가 정화한 SVG를 화면에서 한 번 더 (DOMPurify SVG 프로필 + 개념 그림과 같은 금지 목록, style 속성 · class는 둠)
const FIG_PURIFY = { USE_PROFILES: { svg: true }, FORBID_TAGS: SVG_PURIFY.FORBID_TAGS, FORBID_ATTR: ["href", "xlink:href"] };
const SCOPES = [["selection", "고른 글"], ["paragraph", "이 문단"], ["section", "이 절 · 장"]];

// 정화한 SVG 글 (그릴 수 없으면 null — DOMPurify가 없으면 그리지 않음)
export function cleanSvgText(svg) {
  const P = window.DOMPurify;
  if (!P || !svg) return null;
  const frag = P.sanitize(String(svg), { ...FIG_PURIFY, RETURN_DOM_FRAGMENT: true });
  const root = frag.firstElementChild;
  if (frag.children.length !== 1 || !root || root.namespaceURI !== SVG_NS || root.localName !== "svg") return null;
  for (const node of [root, ...root.querySelectorAll("*")]) {
    for (const a of [...node.attributes]) if (!svgUrlOk(a.value)) node.removeAttribute(a.name);
  }
  return new XMLSerializer().serializeToString(root);
}

// SVG → <img src="blob:"> (불러오거나 실패하면 blob 주소를 바로 푼다)
function svgImg(svg, alt) {
  const clean = cleanSvgText(svg);
  if (!clean) return null;
  const url = URL.createObjectURL(new Blob([clean], { type: "image/svg+xml" }));
  const img = document.createElement("img");
  img.alt = alt || "";
  img.decoding = "async";
  const revoke = () => URL.revokeObjectURL(url);
  img.addEventListener("load", revoke, { once: true });
  img.addEventListener("error", revoke, { once: true });
  img.src = url;
  return img;
}

// SVG → PNG (가로 16cm 300dpi = 1890px, 흰 배경). 정화한 SVG를 blob <img>로 불러 canvas에 그린다(바깥 자원 없음 → canvas 오염 없음)
export async function rasterize(svg) {
  const clean = cleanSvgText(svg);
  const vb = clean && svgViewBox(clean);
  const size = vb && rasterSize(vb.w, vb.h);
  if (!size) throw new Error("그림을 그리지 못했어요");
  const url = URL.createObjectURL(new Blob([clean], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, size.width, size.height);
    g.drawImage(img, 0, 0, size.width, size.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("그림을 PNG로 바꾸지 못했어요");
    return blob;
  } catch (e) {
    throw e instanceof Error && /그림/.test(e.message) ? e : new Error("이 브라우저에서 그림을 PNG로 바꾸지 못했어요");
  } finally {
    URL.revokeObjectURL(url);
  }
}

// PNG + SVG 원본을 원고 그림으로 올린다 → { name, … } (서버가 SVG를 다시 정화해 PNG 옆에 둠)
async function uploadSvgFigure(mid, svg) {
  const png = await rasterize(svg);
  const fd = new FormData();
  fd.append("file", new File([png], "figure.png", { type: "image/png" }));
  fd.append("svg", svg);
  return api.post(`/api/manuscripts/${mid}/figures`, fd);
}

// hooks: { ta, m, saveVersion(content), say(text), closeAi() }
export function figPane(view, hooks) {
  const { ta, m } = hooks;
  const ko = () => /[가-힣]/.test(ta.value) || !ta.value.trim();
  const aside = el(`<aside class="panel ai-pane fig-pane" id="fig-pane" aria-labelledby="fig-pane-h">
    <div class="ai-pane-head"><h2 class="ai-pane-title" id="fig-pane-h">그림 만들기</h2><span class="spacer"></span>
      <button type="button" class="btn sm ghost" data-fig-close title="그림 패널 닫기 (Alt+G) — 그리는 중인 작업은 계속돼요">닫기</button></div>
    <div class="panel-body ai-pane-body fig-body">
      <div class="ai-sec" data-fig-form></div>
      <div class="ai-sec" data-fig-result></div>
    </div></aside>`);
  $(".writer-body", view).appendChild(aside);
  const form = $("[data-fig-form]", aside);
  const out = $("[data-fig-result]", aside);
  const S = {
    open: false, mode: "describe", scope: "selection", desc: "", extra: "", instr: "", ref: true, base: null, sel: null,
    jobs: new Map(), versions: [], srcOf: new Map(), reqOf: new Map(), caption: new Map(), stop: null, watching: null,
    key: "", busy: false, note: "", dead: false, sources: new Map(),
  };
  const alive = () => !S.dead && ta.isConnected;
  const cur = () => (S.sel != null ? S.jobs.get(S.sel) || null : null);

  // ---- 요청 칸 (설명 · 이 내용으로 · 고칠 그림)
  const drawForm = () => {
    form.innerHTML = "";
    if (S.base) {
      const b = el(`<div class="notice" data-tone="info">${ICON_INFO}<div><b>원고의 그림을 고쳐요</b> — ${esc(S.base.caption || "그림")}
        <div class="small muted">아래 '고쳐 달라고 하기'에 바꿀 점을 적어 주세요. 바꾼 그림은 같은 자리 · 같은 캡션으로 들어가요.</div>
        <div class="notice-actions"><button type="button" class="btn sm" data-act="unbase">새 그림 만들기로</button></div></div></div>`);
      form.append(b);
      return;
    }
    form.append(el(`<div class="seg ai-tabs" role="group" aria-label="그림 만들 방법">
      <button type="button" data-act="mode-describe" aria-pressed="${S.mode === "describe"}" class="${S.mode === "describe" ? "active" : ""}">설명으로</button>
      <button type="button" data-act="mode-content" aria-pressed="${S.mode === "content"}" class="${S.mode === "content" ? "active" : ""}">이 내용으로</button></div>`));
    if (S.mode === "describe") {
      const t = el(`<textarea class="input fig-desc" rows="4" maxlength="2000" aria-label="어떤 그림인가요"
        placeholder="어떤 그림인가요? 예: 연구 절차 흐름도 — 문헌 조사 → 설문(n=320) → 심층 면담 → 주제 분석"></textarea>`);
      t.value = S.desc;
      t.oninput = () => { S.desc = t.value; };
      form.append(t);
    } else {
      const r = range();
      const sel = el(`<label class="small fig-scope">범위 <select class="input" aria-label="그림으로 만들 원고 범위">${SCOPES.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></label>`);
      $("select", sel).value = S.scope;
      $("select", sel).onchange = (e) => { S.scope = e.target.value; drawForm(); };
      const snip = el(`<button type="button" class="ai-orig" data-act="locate" data-fig-snip title="눌러서 원고에서 이 범위 보기"></button>`);
      snip.textContent = snipText(r);
      const t = el(`<textarea class="input fig-desc" rows="2" maxlength="2000" aria-label="추가 요청 (선택)"
        placeholder="추가 요청 (선택) — 예: 흑백 흐름도로, 단계마다 짧은 설명"></textarea>`);
      t.value = S.extra;
      t.oninput = () => { S.extra = t.value; };
      form.append(sel, snip, t, el(`<p class="small muted fig-hint">원고 내용에 있는 것만 그려요. 모르는 값은 그림에 [확인 필요: 무엇]으로 표시돼요.</p>`));
    }
    form.append(el(`<div class="ai-actions"><button type="button" class="btn sm primary" data-act="make">그림 만들기</button>
      <span class="small muted">내 PC의 Claude로 그려요 · 창을 닫아도 계속돼요</span></div>`));
  };
  const range = () => contentRange(ta.value, ta.selectionStart, ta.selectionEnd, S.scope);
  const snipText = (r) => (r.text ? (r.text.length > 300 ? `${r.text.slice(0, 299)}…` : r.text) : "원고에서 글을 고르거나 문단에 커서를 두세요");
  // 편집기에서 커서 · 고른 글이 바뀌면 '이 내용으로' 범위 글도 바로 맞춘다 (글자만 바꿈 — 입력 칸 초점은 그대로)
  const onCaret = () => {
    const sn = S.open && S.mode === "content" && !S.base && $("[data-fig-snip]", form);
    if (sn) sn.textContent = snipText(range());
  };
  for (const ev of ["keyup", "mouseup", "input", "select"]) ta.addEventListener(ev, onCaret);

  // ---- 결과 칸
  const draw = () => {
    if (!S.open) return;
    const j = cur();
    const st = figState(j);
    const key = [S.sel, st, S.base ? S.base.figure : "", S.versions.join(","), S.note, S.busy].join("|");
    if (key !== S.key) { S.key = key; build(j, st); }
    if (st === "running") live(j);
  };

  const build = (j, st) => {
    const focused = out.contains(document.activeElement) ? document.activeElement.dataset.act || "" : "";
    out.innerHTML = "";
    if (S.note) out.append(el(`<div class="notice" data-tone="warn">${ICON_WARN}<div>${esc(S.note)}</div></div>`));
    if (!j && S.base && S.base.svg) { // 고칠 원래 그림
      const prev = el(`<div class="fig-preview"></div>`);
      prev.append(svgImg(S.base.svg, S.base.caption) || el(`<div class="msg error">그림을 보여 줄 수 없어요</div>`));
      out.append(el(`<div class="ai-sec-h">지금 그림</div>`), prev, editBox(false));
      return;
    }
    if (!j) {
      out.append(el(`<p class="small muted">설명을 적거나 원고 범위를 고르고 [그림 만들기]를 누르면 여기에 그림이 나와요.
        원고 오른쪽 미리보기에서 AI로 만든 그림을 누르면 그 그림을 고칠 수 있어요.</p>`));
      return;
    }
    // 버전 (고치기 사슬 — 누르면 그 버전을 보고 거기서 다시 고침)
    if (S.versions.length > 1) {
      const v = el(`<div class="fig-vers" role="group" aria-label="버전"><span class="ai-sec-h">버전</span></div>`);
      S.versions.forEach((id, i) => {
        const b = el(`<button type="button" class="btn sm ${id === S.sel ? "primary" : ""}" data-ver="${Number(id)}" aria-pressed="${id === S.sel}">${i + 1}</button>`);
        v.append(b);
      });
      out.append(v);
    }
    const meta = el(`<div class="ai-meta"><b class="ai-mode">${esc(j.figure && j.figure.mode === "edit" ? "고친 그림" : "AI 그림")}</b>
      <span class="chip ai-st" data-st="${esc(st === "ready" ? "ready" : st)}">${esc(FIG_STATE_TEXT[st] || "")}</span></div>`);
    out.append(meta);
    const note = routeNote(j);
    if (note) out.append(el(`<div class="notice" data-tone="info">${ICON_INFO}<div>${esc(note)}</div></div>`));
    if (st === "running") {
      const line = statusLineEl(async () => { try { await cancelJob(j.id); } catch (err) { errorToast(err); } });
      $("[data-job-cancel]", line).title = "그리기 취소 — 원고는 바뀌지 않아요";
      out.append(line, el(`<div class="fig-preview fig-wait"><span class="typing" aria-hidden="true"><span></span><span></span><span></span></span></div>`));
      return;
    }
    if (st === "failed" || st === "cancelled" || st === "missing") {
      out.append(el(`<div class="msg error">${esc(st === "failed" ? j.error || "그림을 만들지 못했어요" : st === "cancelled" ? "그리기를 취소했어요" : "그림 결과가 없어요")}</div>`));
      const acts = el(`<div class="ai-actions"><button type="button" class="btn sm" data-act="again">다시 만들기</button></div>`);
      out.append(acts);
      return;
    }
    const res = j.result || {};
    const prev = el(`<div class="fig-preview"></div>`);
    prev.append(svgImg(res.svg, res.caption) || el(`<div class="msg error">그림을 보여 줄 수 없어요</div>`));
    out.append(prev);
    if (res.kind_note) out.append(Object.assign(el(`<p class="small muted fig-kind"></p>`), { textContent: `그림 종류: ${res.kind_note}` }));
    if (res.check_needed) out.append(el(`<div class="notice" data-tone="warn">${ICON_WARN}<div>그림에 <b>[확인 필요: …]</b> 표시가 있어요. 원고 내용에 없던 값이에요 — 확인해서 고쳐 주세요.</div></div>`));
    const capRow = el(`<label class="field fig-cap"><span class="ai-sec-h">캡션</span><input class="input" data-fig-cap maxlength="300"></label>`);
    const cap = $("input", capRow);
    cap.value = S.caption.has(j.id) ? S.caption.get(j.id) : (S.base && S.base.caption) || res.caption || "";
    cap.oninput = () => S.caption.set(j.id, cap.value);
    out.append(capRow);
    if (!S.base) {
      const refRow = el(`<label class="small fig-ref"><input type="checkbox" data-fig-ref> 본문에 '(그림 N 참조)' 넣기</label>`);
      $("input", refRow).checked = S.ref;
      $("input", refRow).onchange = (e) => { S.ref = e.target.checked; };
      out.append(refRow);
    }
    const acts = el(`<div class="ai-actions" role="group" aria-label="그림 동작"></div>`);
    const add = (act, label, cls, title) => {
      const b = el(`<button type="button" class="btn sm ${cls}" data-act="${act}">${esc(label)}</button>`);
      b.title = title;
      b.disabled = S.busy;
      acts.append(b);
    };
    if (S.base) add("insert", "이 그림 바꾸기", "primary", "원고의 그 그림을 이 그림으로 바꿔요 — 캡션 · 참조 이름은 그대로, 바꾸기 전 원고는 버전 기록에 남아요");
    else add("insert", "원고에 넣기", "primary", "커서 자리(이 내용으로 만들었으면 그 내용 뒤)에 그림 문단을 넣어요");
    add("again", "다시 만들기", "", "같은 요청으로 새로 그려요");
    out.append(acts, editBox(true));
    if (focused) $(`[data-act="${focused}"]`, out)?.focus();
  };

  const editBox = (fromJob) => {
    const box = el(`<div class="ai-sec fig-edit"><span class="ai-sec-h">고쳐 달라고 하기</span>
      <textarea class="input" rows="2" maxlength="2000" aria-label="어떻게 고칠까요"
        placeholder="예: 화살표를 더 굵게, 글자를 크게, 3단계를 둘로 나눠 줘"></textarea>
      <div class="ai-actions"><button type="button" class="btn sm" data-act="${fromJob ? "edit" : "edit-base"}">고쳐 달라고 하기</button></div></div>`);
    const t = $("textarea", box);
    t.value = S.instr;
    t.oninput = () => { S.instr = t.value; };
    t.onkeydown = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); $("button", box).click(); } };
    return box;
  };

  const live = (j) => {
    const line = $("[data-job-line]", out);
    if (!line) return;
    setStatusLine(line, j, "그림 작업");
    if (j.status === "running" && j.runner === "cli") $(".grow", line).textContent = `${j.device ? `‘${j.device.name}’` : "내 PC"}에서 그리는 중 (${j.engine})`;
  };

  // ---- 작업 따라가기
  const stopWatch = () => { if (S.stop) S.stop(); S.stop = null; S.watching = null; };
  const remember = (j) => {
    S.jobs.set(j.id, j);
    for (const id of versionIds(j)) if (!S.versions.includes(id)) S.versions.push(id);
    S.versions.sort((a, b) => a - b);
  };
  const watch = (j) => {
    if (!j || S.watching === j.id || !isActive(j)) return;
    stopWatch();
    const id = j.id;
    S.watching = id;
    S.stop = watchJob(id, (x) => {
      if (!alive() || S.watching !== id) return;
      if (!x) { S.jobs.delete(id); S.versions = S.versions.filter((v) => v !== id); if (S.sel === id) S.sel = null; stopWatch(); draw(); return; }
      remember(x);
      if (!isActive(x)) { S.watching = null; if (x.status === "succeeded") handledJob(x.id); }
      draw();
    }, { first: j });
  };
  const select = async (id) => {
    S.sel = id;
    S.note = "";
    if (!S.jobs.has(id) || isActive(S.jobs.get(id))) {
      try { remember(await api.get(`/api/jobs/${Number(id)}`)); } catch (err) { if (err.status !== 404) errorToast(err); }
    }
    if (!alive()) return;
    store.set(FIG_JOB_KEY(m.id), String(id));
    watch(S.jobs.get(id));
    draw();
  };

  // ---- 동작
  const start = async (body, srcInfo = null) => {
    if (S.busy) return;
    S.busy = true;
    draw();
    let r;
    try { r = await api.post("/api/ai/figure", body); } catch (err) { S.busy = false; draw(); return errorToast(err); }
    S.busy = false;
    if (!alive()) return;
    const job = r.job;
    if (body.mode !== "edit" || body.base_figure) S.versions = []; // 새 그림 · 원고 그림 고치기는 새 버전 목록
    S.reqOf.set(job.id, body);
    if (srcInfo) S.srcOf.set(job.id, srcInfo);
    else if (body.parent_job_id && S.srcOf.has(body.parent_job_id)) S.srcOf.set(job.id, S.srcOf.get(body.parent_job_id));
    remember(job);
    trackJob(job);
    nudgeDesktop(job);
    await select(job.id);
    S.note = r.note || ""; // claude가 아닌 엔진으로 그릴 때 (서버 figgen.route_note)
    draw();
    hooks.say("그림을 그리기 시작했어요. 계속 쓰셔도 돼요");
  };
  const make = () => {
    const mid = m.id;
    if (S.mode === "describe") {
      if (!S.desc.trim()) return toast("어떤 그림인지 적어 주세요");
      return start(figureRequest({ mid, mode: "describe", description: S.desc, ko: ko() }));
    }
    const r = range();
    if (r.text.trim().length < 10) return toast("그림으로 만들 원고 글을 고르거나 문단에 커서를 두세요");
    return start(figureRequest({ mid, mode: "content", content: r.text, description: S.extra, ko: ko() }), { text: r.text, end: r.to });
  };
  const edit = (j) => {
    if (!S.instr.trim()) return toast("어떻게 고칠지 적어 주세요");
    const cap = S.caption.has(j.id) ? S.caption.get(j.id) : null;
    const body = figureRequest({ mid: m.id, mode: "edit", instruction: S.instr, base: { jobId: j.id }, caption: cap, ko: ko() });
    S.instr = "";
    return start(body);
  };
  const editBase = () => {
    if (!S.base) return;
    if (!S.instr.trim()) return toast("어떻게 고칠지 적어 주세요");
    const body = figureRequest({ mid: m.id, mode: "edit", instruction: S.instr, base: { figure: S.base.figure }, caption: S.base.caption, ko: ko() });
    S.instr = "";
    return start(body);
  };
  const again = async (j) => {
    if (j && (j.status === "failed" || j.status === "cancelled")) {
      try {
        const r = await retryJob(j.id);
        remember(r.job);
        trackJob(r.job);
        return select(r.job.id);
      } catch (err) { return errorToast(err); }
    }
    const body = j && S.reqOf.get(j.id);
    if (body) return start(body, S.srcOf.get(j.id) || null);
    return make();
  };

  // 원고에 넣기 · 원고의 그림 바꾸기: PNG로 그려 올린 뒤(실패하면 원고는 그대로) 넣기 전 원고를 버전 기록에 남기고 한 번에 바꾼다
  const insert = async (j) => {
    const res = (j && j.result) || {};
    if (!res.svg || S.busy) return;
    const caption = (S.caption.has(j.id) ? S.caption.get(j.id) : (S.base && S.base.caption) || res.caption || "").trim();
    if (S.base && !(await confirmDialog("원고의 그림을 이 그림으로 바꿀까요? 캡션 · 참조 이름은 그대로예요. 바꾸기 전 원고는 버전 기록에 남아요.",
      { ok: "바꾸기", title: "그림 바꾸기" }))) return;
    S.busy = true;
    draw();
    toast("그림을 넣는 중이에요");
    let up;
    try { up = await uploadSvgFigure(m.id, res.svg); } catch (err) { S.busy = false; draw(); return errorToast(err); }
    S.busy = false;
    if (!alive()) return;
    hooks.saveVersion(ta.value); // 넣기 전 원고 ('AI 넣기 전')
    if (S.base) {
      const plan = replaceFigure(ta.value, S.base.figure, up.name, caption && caption !== S.base.caption ? caption : null);
      if (plan) {
        applyEdit(ta, plan.edit);
        S.base = { ...S.base, figure: up.name, caption: caption || S.base.caption, svg: res.svg };
        toast("원고의 그림을 바꿨어요", "success");
        return draw();
      }
      toast("원고에서 그 그림을 찾지 못해 커서 자리에 넣었어요");
    }
    const src = S.srcOf.get(j.id);
    const end = src ? contentEnd(ta.value, src.text, src.end) : null;
    const at = end ?? ta.selectionEnd;
    const plan = insertFigure(ta.value, { at, name: up.name, caption, ref: !S.base && S.ref, refAt: end ?? ta.selectionEnd, ko: ko() });
    applyEdit(ta, plan.edit);
    toast("원고에 그림을 넣었어요", "success");
    draw();
  };

  // 원고의 그림 고치기 (미리보기에서 AI 그림 누르기 · AI 도우미 메뉴 '이 그림 고치기')
  const source = (name) => {
    if (!S.sources.has(name)) {
      S.sources.set(name, api.get(`/api/manuscripts/${m.id}/figures/${encodeURIComponent(name)}/source`)
        .then((r) => r.svg || null).catch((err) => { if (err.status !== 404) S.sources.delete(name); return null; }));
    }
    return S.sources.get(name);
  };
  const openEdit = async (name) => {
    const svg = await source(name);
    if (!alive()) return;
    if (!svg) return toast("이 그림은 AI로 만든 그림이 아니라 고칠 원본이 없어요. [그림 만들기]로 새로 그려 주세요");
    const f = (ta.value && figureAt(ta.value, findPos(name))) || null;
    stopWatch();
    Object.assign(S, { base: { figure: name, caption: f ? f.alt : "", svg }, sel: null, note: "", instr: "", versions: [] });
    setOpen(true);
    drawForm();
    draw();
    $(".fig-edit textarea", out)?.focus();
  };
  const findPos = (name) => {
    const i = ta.value.indexOf(`](fig:${name})`);
    return i < 0 ? -1 : i;
  };
  const editAtCursor = () => {
    const f = figureAt(ta.value, ta.selectionStart);
    if (!f) return toast("커서를 AI로 만든 그림 줄(![캡션](fig:…))에 두고 다시 골라 주세요");
    openEdit(f.src);
  };

  out.addEventListener("click", (e) => {
    const v = e.target.closest("[data-ver]");
    if (v) return select(Number(v.dataset.ver));
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const j = cur();
    ({ insert: () => insert(j), again: () => again(j), edit: () => j && edit(j), "edit-base": editBase })[b.dataset.act]?.();
  });
  form.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act;
    if (a === "mode-describe" || a === "mode-content") { S.mode = a.slice(5); drawForm(); return; }
    if (a === "make") return make();
    if (a === "unbase") { S.base = null; drawForm(); return draw(); }
    if (a === "locate") {
      const r = range();
      if (r.text) { ta.focus(); ta.setSelectionRange(r.from, r.to); }
    }
  });

  // 미리보기: AI로 만든 그림(SVG 원본이 있음)을 누르면 그 그림 위에 [이 그림 고치기]
  const docEl = $("[data-doc]", view);
  const onDoc = async (e) => {
    const btn = e.target.closest("[data-fig-edit]");
    if (btn) { e.preventDefault(); return openEdit(btn.dataset.figEdit); }
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    const fig = e.target.closest(".doc-fig");
    const name = fig && $("img[data-fig]", fig)?.dataset.fig;
    if (!name || $("[data-fig-edit]", fig)) return;
    if (!(await source(name)) || !fig.isConnected) return;
    const b = el(`<button type="button" class="btn sm fig-edit-btn" data-fig-edit="${esc(name)}">이 그림 고치기</button>`);
    fig.append(b);
  };
  if (docEl) { docEl.addEventListener("click", onDoc); docEl.addEventListener("keydown", onDoc); }

  // ---- 열기 · 닫기
  const setOpen = (open) => {
    if (!open && aside.contains(document.activeElement)) ta.focus();
    S.open = open;
    if (open) {
      hooks.closeAi(); // 같은 오른쪽 칸 — AI 결과 패널은 닫는다
      view.dataset.figPane = "open";
      S.key = "";
      if (S.sel == null && !S.base) {
        const last = Number(store.get(FIG_JOB_KEY(m.id)));
        if (Number.isInteger(last) && last > 0) {
          select(last).then(() => { // 원고 그림을 고치던 작업이면 [이 그림 바꾸기]가 그 그림을 바꾸게
            const j = cur();
            const name = j && j.figure && j.figure.base_figure;
            if (!name || S.base || !alive()) return;
            S.base = { figure: name, caption: (figureAt(ta.value, findPos(name)) || {}).alt || "", svg: null };
            drawForm();
            draw();
          });
        }
      }
      drawForm();
      draw();
    } else {
      delete view.dataset.figPane;
      stopWatch();
    }
  };
  const open = ({ mode = null } = {}) => {
    if (mode === "describe" || mode === "content") { S.mode = mode; S.base = null; }
    if (mode === "content" && ta.selectionStart === ta.selectionEnd) S.scope = "paragraph";
    if (!S.open) setOpen(true); else { drawForm(); draw(); }
    $(S.mode === "describe" ? ".fig-desc" : "[data-act=make]", form)?.focus();
  };
  $("[data-fig-close]", aside).onclick = () => setOpen(false);
  const onKey = (e) => {
    if (!alive() || modalOpen()) return;
    if (isFigPaneKey(e)) { e.preventDefault(); return S.open ? setOpen(false) : open(); } // macOS Option+G의 © 막기
    if (S.open && e.key === "Escape" && aside.contains(document.activeElement) && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setOpen(false);
    }
  };
  document.addEventListener("keydown", onKey);
  // 끝남 알림 [열기] · 작업 화면: 같은 원고의 그림 작업이면 다시 불러오지 않고 이 패널에서
  const onOpenJob = (e) => {
    const j = e.detail;
    if (!j || j.kind !== "figure" || !alive() || Number(j.figure && j.figure.manuscript_id) !== m.id) return;
    e.preventDefault();
    if (!S.open) setOpen(true);
    select(j.id);
  };
  window.addEventListener("paperlab:open-job", onOpenJob);
  // AI 결과 패널(같은 오른쪽 칸)이 열리면(Alt+A · [AI 결과]) 그림 패널을 닫는다 — 둘 중 하나만
  const mo = new MutationObserver(() => { if (S.open && view.dataset.aiPane === "open") setOpen(false); });
  mo.observe(view, { attributes: true, attributeFilter: ["data-ai-pane"] });

  return {
    open,
    toggle: () => (S.open ? setOpen(false) : open()),
    menuItems: () => [
      { label: "그림 만들기…", sub: "Alt+G", action: () => open({ mode: "describe" }) },
      { label: "이 내용으로 그림 만들기", action: () => open({ mode: "content" }) },
      { label: "커서의 그림 고치기", action: editAtCursor },
    ],
    destroy: () => {
      S.dead = true;
      stopWatch();
      mo.disconnect();
      window.removeEventListener("paperlab:open-job", onOpenJob);
      document.removeEventListener("keydown", onKey);
      if (docEl) { docEl.removeEventListener("click", onDoc); docEl.removeEventListener("keydown", onDoc); }
    },
  };
}
