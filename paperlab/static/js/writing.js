// 논문 쓰기: 원고 목록 · 마크다운 편집기 · 인용 넣기 · 서식 미리보기 · AI 글쓰기 도우미 ·
// 워드(.docx)·한글(.hwpx) 내보내기 · 워드·한글 문서의 [@인용키] 변환

import { api, downloadBlob, streamEvents } from "./api.js";
import { htmlToRuns, listStyles, renderClusters, styleOptions } from "./cite.js";
import { settingsDialog } from "./dialogs.js";
import {
  applyDocFormat, coverDialog, exportWarnings, formatManagerDialog, formatOptions, getFormat, listFormats,
  missingCoverFields, usesHancomFonts, warningText,
} from "./formats.js";
import { state } from "./state.js";
import {
  $, $$, authorsShort, confirmDialog, copyText, debounce, el, errorToast, esc, fmtDate, modal, pickFiles, popupMenu, toast,
} from "./ui.js";

const W = { m: null, saver: null, previewTimer: null, papers: null, view: "split", seq: 0, formats: null, fmt: null };
const LONG = { duration: 8000 };
const hancomNoticeShown = new Set(); // 한컴 글꼴 안내: 세션마다 양식별 한 번
const BIB_MARKERS = ["[참고문헌]", "[References]", "[Bibliography]", "[REFERENCES]"];
const CITE_RE = /\[(?=[^\[\]]*@)([^\[\]]{1,400})\]/g;
const KEY_RE = /(-?)@([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&\-+?<>~/]*)/u;
const LOCATOR_RE = /^\s*,?\s*(?:(p|pp|page|pages|쪽|면)\.?\s*)?([\divxlcIVXLC][\w\-–,\s]*?)\s*(쪽|면)?\s*$/;

// ------------------------------------------------------------- 인용 표시 해석 (compose.py와 같은 규칙)
export function parseCitation(inner) {
  const items = [];
  for (const part of inner.split(";")) {
    const m = part.match(KEY_RE);
    if (!m) return null;
    const item = { key: m[2].replace(/[.,]+$/, ""), suppress_author: m[1] === "-" };
    const prefix = part.slice(0, m.index).trim();
    if (prefix) item.prefix = prefix;
    const rest = part.slice(m.index + m[0].length).trim();
    if (rest) {
      const lm = rest.match(LOCATOR_RE);
      if (lm && (lm[1] || lm[3] || /^\s*,?\s*\d/.test(rest))) {
        item.locator = lm[2].trim();
        item.label = "page";
      } else item.suffix = rest.replace(/^[,\s]+/, "");
    }
    items.push(item);
  }
  return items.length ? items : null;
}

// 원고 → 자리표시가 들어간 마크다운 + 인용 묶음 목록
function prepare(text) {
  const clusters = [];
  let bibTitle = null;
  const src = text.split("\n").map((line) => {
    const t = line.trim();
    if (BIB_MARKERS.includes(t)) {
      bibTitle = bibTitle || t.slice(1, -1);
      return "";
    }
    return line.replace(CITE_RE, (raw, inner) => {
      const items = parseCitation(inner);
      if (!items) return raw;
      clusters.push({ raw, items });
      return `${clusters.length - 1}`;
    });
  }).join("\n");
  return { src, clusters, bibTitle };
}

// 마크다운 → 문서 블록 (미리보기와 워드·한글 내보내기가 함께 쓴다)
async function buildDocument(text, { style, locale, koreanFirst } = {}) {
  const { src, clusters, bibTitle } = prepare(text);
  const keys = [...new Set(clusters.flatMap((c) => c.items.map((it) => it.key)))];
  const lookup = keys.length ? await api.post("/api/citekeys", { keys }) : { items: {}, issues: {} };
  const rendered = await renderClusters(lookup.items, clusters, { style, locale, koreanFirst });
  const missingKeys = keys.filter((k) => !lookup.items[k]);

  const clusterRuns = (n, fmt) => {
    const c = clusters[n];
    const r = rendered.clusters[n];
    if (!r || !r.html) return [{ text: c.raw, ...fmt, warn: true }];
    const runs = htmlToRuns(r.html, fmt);
    if (r.missing && r.missing.length) runs.push({ text: ` [@${r.missing.join("; @")}?]`, warn: true });
    return rendered.note ? [{ footnote: htmlToRuns(r.html) }] : runs;
  };
  const textRuns = (s, fmt) => {
    const out = [];
    s.split(/(\d+)/).forEach((part) => {
      const m = part.match(/^(\d+)$/);
      if (m) out.push(...clusterRuns(Number(m[1]), fmt));
      else if (part) out.push({ text: part, ...fmt });
    });
    return out;
  };
  const inline = (tokens, fmt = {}) => {
    const runs = [];
    for (const t of tokens || []) {
      if (t.type === "strong") runs.push(...inline(t.tokens, { ...fmt, b: true }));
      else if (t.type === "em") runs.push(...inline(t.tokens, { ...fmt, i: true }));
      else if (t.type === "codespan") runs.push({ text: unescapeHtml(t.text), ...fmt, code: true });
      else if (t.type === "br") runs.push({ text: " ", ...fmt });
      else if (t.type === "link") {
        runs.push(...inline(t.tokens, fmt));
        if (t.href && t.text !== t.href) runs.push({ text: ` (${t.href})`, ...fmt });
      } else if (t.type === "image") runs.push({ text: t.text || "", ...fmt });
      else if (t.type === "html") runs.push(...textRuns(t.text.replace(/<[^>]+>/g, ""), fmt));
      else if (t.tokens && t.tokens.length) runs.push(...inline(t.tokens, fmt));
      else runs.push(...textRuns(unescapeHtml(t.text ?? t.raw ?? ""), fmt));
    }
    return runs;
  };

  const blocks = [];
  let bibPlaced = false;
  const bibBlocks = () => {
    bibPlaced = true;
    if (!rendered.entries.length) return [];
    const title = bibTitle || (/[가-힣]/.test(text) ? "참고문헌" : "References");
    return [{ type: "bib_heading", text: title },
      ...rendered.entries.map((e) => ({ type: "bib_entry", hanging: rendered.hangingIndent || !rendered.numeric, runs: htmlToRuns(e.html) }))];
  };
  const walk = (tokens, depth = 0) => {
    for (const t of tokens) {
      if (t.type === "heading") {
        if (t.depth === 1) blocks.push({ type: "title", runs: inline(t.tokens) });
        else blocks.push({ type: "heading", level: Math.min(t.depth - 1, 3), runs: inline(t.tokens) });
      } else if (t.type === "paragraph") {
        if (t.text.trim() === "") blocks.push(...bibBlocks());
        else blocks.push({ type: "paragraph", runs: inline(t.tokens) });
      } else if (t.type === "list") {
        t.items.forEach((item, i) => {
          const runs = [];
          const nested = [];
          for (const sub of item.tokens) {
            if (sub.type === "list") nested.push(sub);
            else runs.push(...inline(sub.tokens || [{ type: "text", text: sub.text || "" }]));
          }
          blocks.push({ type: "list_item", ordered: t.ordered, number: (Number(t.start) || 1) + i, depth, runs });
          nested.forEach((n) => walk([n], depth + 1));
        });
      } else if (t.type === "blockquote") {
        for (const sub of t.tokens) if (sub.tokens) blocks.push({ type: "quote", runs: inline(sub.tokens) });
      } else if (t.type === "code") {
        blocks.push({ type: "code", text: t.text });
      } else if (t.type === "hr") {
        blocks.push({ type: "page_break" });
      } else if (t.type === "table") {
        const row = (cells) => cells.flatMap((c, i) => [...(i ? [{ text: " | " }] : []), ...inline(c.tokens)]);
        blocks.push({ type: "paragraph", runs: row(t.header) });
        t.rows.forEach((r) => blocks.push({ type: "paragraph", runs: row(r) }));
      } else if (t.type === "html" && t.text.trim()) {
        blocks.push({ type: "paragraph", runs: textRuns(t.text.replace(/<[^>]+>/g, "").trim(), {}) });
      }
    }
  };
  walk(window.marked.lexer(src));
  if (!bibPlaced && rendered.entries.length) blocks.push(...bibBlocks());
  return { blocks, clusters, rendered, missingKeys, issues: lookup.issues, items: lookup.items };
}

function unescapeHtml(s) {
  return String(s).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[e]));
}

function runsHtml(runs, notes) {
  return runs.map((r) => {
    if (r.footnote) {
      notes.push(r.footnote);
      return `<sup class="fn-ref">${notes.length}</sup>`;
    }
    let h = esc(r.text);
    if (r.code) h = `<code>${h}</code>`;
    if (r.b) h = `<b>${h}</b>`;
    if (r.i) h = `<i>${h}</i>`;
    if (r.sup) h = `<sup>${h}</sup>`;
    if (r.sub) h = `<sub>${h}</sub>`;
    if (r.warn) h = `<span class="cite-warn" title="서재에 없는 인용키예요">${h}</span>`;
    return h;
  }).join("");
}

function blocksToHtml(blocks) {
  const notes = [];
  let headingIndex = 0;
  const html = blocks.map((b) => {
    const r = () => runsHtml(b.runs || [], notes);
    switch (b.type) {
      case "title": return `<h1 class="doc-title" data-h="${headingIndex++}">${r()}</h1>`;
      case "heading": return `<h${b.level + 1} data-h="${headingIndex++}">${r()}</h${b.level + 1}>`;
      case "list_item": return `<p class="doc-li" style="padding-left:${1.4 + b.depth * 1.2}em;text-indent:-1em">${b.ordered ? `${b.number}.` : "•"} ${r()}</p>`;
      case "quote": return `<blockquote>${r()}</blockquote>`;
      case "code": return `<pre>${esc(b.text)}</pre>`;
      case "page_break": return `<div class="doc-pb">쪽 나눔</div>`;
      case "bib_heading": return `<h2 class="doc-bib-h">${esc(b.text)}</h2>`;
      case "bib_entry": return `<p class="doc-bib ${b.hanging ? "hanging" : ""}">${r()}</p>`;
      default: return `<p>${r()}</p>`;
    }
  }).join("");
  const fn = notes.length ? `<div class="doc-notes"><ol>${notes.map((n) => `<li>${runsHtml(n, [])}</li>`).join("")}</ol></div>` : "";
  return html + fn;
}

// ------------------------------------------------------------------ 목록 화면
export function closeWriter() {
  if (W.saver) W.saver.flush();
  W.saver = null;
  W.m = null;
  W.ta = null;
  clearTimeout(W.previewTimer);
  W.seq++;
  $$(".cite-picker").forEach((p) => p.remove());
  hideSuggest();
}

export async function renderWriteList(main) {
  closeWriter();
  main.innerHTML = "";
  const view = el(`<section class="view">
    <div class="discover-head">
      <h1>논문 쓰기</h1>
      <div class="sub">PaperLab에서 바로 쓰거나, 워드·한글로 쓰면서 인용만 PaperLab으로 정리할 수 있어요.</div>
      <div class="write-cards">
        <div class="write-card">
          <div class="wc-title">원고 쓰기</div>
          <div class="wc-desc">서재의 논문을 [@인용키]로 넣으면 고른 스타일로 인용·참고문헌이 자동으로 만들어져요. 워드(.docx)·한글(.hwpx)로 내보내요.</div>
          <div class="row"><select class="input" data-tpl style="width:auto"></select><button class="btn primary" data-new>새 원고</button></div>
        </div>
        <div class="write-card">
          <div class="wc-title">워드·한글 문서에 인용 넣기</div>
          <div class="wc-desc">워드나 한글에서 쓰다가 인용할 자리에 <code>[@인용키]</code>, 참고문헌 자리에 <code>[참고문헌]</code>을 적어 저장한 뒤 올리면, 서식은 그대로 두고 인용과 참고문헌만 채워 돌려줘요.</div>
          <div class="row"><button class="btn" data-compose>.docx · .hwpx 올리기</button><button class="btn ghost" data-help>사용법</button></div>
        </div>
      </div>
    </div>
    <div class="discover-results"><div class="ms-list"></div></div></section>`);
  main.appendChild(view);
  const tpls = await api.get("/api/manuscript-templates").catch(() => []);
  $("[data-tpl]", view).innerHTML = tpls.map((t) => `<option value="${esc(t.id)}" title="${esc(t.description)}">${esc(t.name)}</option>`).join("");
  $("[data-tpl]", view).value = "kr_journal";
  $("[data-new]", view).onclick = async () => {
    try {
      const m = await api.post("/api/manuscripts", { template: $("[data-tpl]", view).value });
      location.hash = `#/write/${m.id}`;
    } catch (e) { errorToast(e); }
  };
  $("[data-compose]", view).onclick = () => composeDialog();
  $("[data-help]", view).onclick = helpDialog;
  const list = $(".ms-list", view);
  const items = await api.get("/api/manuscripts").catch((e) => { errorToast(e); return []; });
  if (!items.length) {
    list.innerHTML = `<div class="empty"><div class="big">✍</div><h3>아직 원고가 없어요</h3><p>템플릿을 골라 새 원고를 시작해 보세요.</p></div>`;
    return;
  }
  list.innerHTML = `<div class="result-info">원고 ${items.length}개</div>`;
  for (const m of items) {
    const row = el(`<div class="ms-row"><div class="grow" style="min-width:0"><div class="paper-title">${esc(m.title || "제목 없는 원고")}</div>
      <div class="paper-sub">${fmtDate(m.updated_at)} 수정 · ${(m.length || 0).toLocaleString("ko-KR")}자</div></div>
      <span class="menu-wrap"><button class="btn sm ghost" data-del>삭제</button></span></div>`);
    row.onclick = () => { location.hash = `#/write/${m.id}`; };
    $("[data-del]", row).onclick = async (e) => {
      e.stopPropagation();
      if (!(await confirmDialog(`'${m.title}' 원고를 삭제할까요? 되돌릴 수 없어요.`, { ok: "삭제", danger: true }))) return;
      await api.del(`/api/manuscripts/${m.id}`);
      renderWriteList(main);
    };
    list.appendChild(row);
  }
}

function helpDialog() {
  modal({ title: "워드·한글에서 인용하는 방법", wide: true, body: `<div class="prose">
    <ol>
      <li>서재에서 논문을 고르고 상세 패널의 <b>인용 키 복사</b>를 누르면 <code>[@vaswani2017attention]</code> 같은 표시가 복사돼요.</li>
      <li>워드나 한글 본문의 인용할 자리에 붙여넣으세요. 여러 편은 <code>[@a; @b]</code>, 쪽은 <code>[@a, p. 12]</code>처럼 써요. 저자 이름을 빼려면 <code>[-@a]</code>.</li>
      <li>참고문헌이 들어갈 자리에 <code>[참고문헌]</code>(영문은 <code>[References]</code>)만 한 줄로 적어요. 없으면 문서 끝에 붙여요.</li>
      <li>워드는 <b>.docx</b>, 한글은 <b>.hwpx</b>(다른 이름으로 저장 → 한글 문서(*.hwpx))로 저장해 올리세요.</li>
      <li>스타일을 고르면 원래 글꼴·문단 서식은 그대로 두고 인용과 참고문헌만 채운 새 파일을 받아요. 원본 파일은 바뀌지 않아요.</li>
    </ol>
    <p class="small muted">각주 스타일(Chicago 각주 등)은 워드 문서에서 진짜 각주로 들어가요. 한글 문서에서는 저자-연도나 번호 스타일을 써 주세요.</p></div>` });
}

// 쓰던 원고를 지금 저장한다 (로그아웃 전 — 시안 6.1). 저장할 게 없으면 바로 끝남
export async function flushWriter() {
  if (W.saver) await W.saver.flush();
}

// 저장하지 못한 원고 {id, title, content} (로그인 만료 때 브라우저에 임시 보관 — 시안 6.1). 없으면 null
export function unsavedDraft() {
  if (!W.m || !W.ta || W.ta.value === W.m.content) return null;
  return { id: W.m.id, title: W.m.title || "", content: W.ta.value };
}

// ------------------------------------------------------------------ 편집 화면
export async function openManuscript(main, id) {
  closeWriter();
  const seq = W.seq;
  main.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
  let m;
  try { m = await api.get(`/api/manuscripts/${id}`); } catch (e) {
    main.innerHTML = `<div class="empty"><h3>원고를 열 수 없어요</h3><p>${esc(e.message)}</p><a class="btn" href="#/write">원고 목록</a></div>`;
    return;
  }
  if (seq !== W.seq) return;
  const [styles, formats] = await Promise.all([listStyles().catch(() => []), listFormats(true).catch(() => null)]);
  if (seq !== W.seq) return;
  W.m = m;
  W.formats = formats;
  m.cover = m.cover && typeof m.cover === "object" ? m.cover : {};
  const fmtId = formats && formats.some((f) => f.id === m.doc_format) ? m.doc_format : "default";
  let viewMode = "split";
  try { viewMode = localStorage.getItem("paperlab.writeView") || "split"; } catch { /* 무시 */ }
  main.innerHTML = "";
  const view = el(`<section class="writer view-${viewMode}">
    <div class="writer-bar">
      <a class="btn ghost sm" href="#/write">← 원고</a>
      <div class="title" data-title>${esc(m.title)}</div>
      <span class="small muted" data-save></span>
      <select class="input" data-style title="인용 스타일" style="width:auto;max-width:190px">${styleOptions(styles, m.style || state.settings.citation_style || "apa")}</select>
      <select class="input fmt-select ${formats ? "" : "hidden"}" data-format title="내보낼 때 쓸 논문 양식" aria-label="논문 양식">${formats ? formatOptions(formats, fmtId, { manage: true }) : ""}</select>
      <button type="button" class="btn sm cover-btn hidden" data-cover title="표지 · 속표지 · 인정서에 들어갈 정보" aria-label="표지 정보">표지 정보</button>
      <span class="menu-wrap"><button class="btn sm" data-export>내보내기 ▾</button></span>
    </div>
    <div class="writer-tools">
      <button class="icon-btn" data-md="bold" title="굵게 (Ctrl+B)"><b>B</b></button>
      <button class="icon-btn" data-md="italic" title="기울임 (Ctrl+I)"><i>I</i></button>
      <button class="btn sm ghost" data-md="h2" title="장 제목 (##)">장</button>
      <button class="btn sm ghost" data-md="h3" title="절 제목 (###)">절</button>
      <button class="btn sm ghost" data-md="list" title="글머리 목록">• 목록</button>
      <button class="btn sm ghost" data-md="quote" title="인용문 블록">❝</button>
      <span class="sep"></span>
      <button class="btn sm primary" data-cite title="[@ 를 입력해도 열려요">＋ 인용 넣기</button>
      <button class="btn sm ghost" data-bib title="참고문헌이 들어갈 자리">[참고문헌]</button>
      <span class="menu-wrap"><button class="btn sm" data-ai>✦ AI 도우미 ▾</button></span>
      <span class="spacer"></span>
      <div class="seg" data-view><button data-v="edit">편집</button><button data-v="split">나란히</button><button data-v="preview">미리보기</button></div>
    </div>
    <div class="writer-body">
      <aside class="writer-side"><div class="section-title" style="margin-top:0">개요</div><div data-outline></div>
        <div class="section-title">이 원고의 인용</div><div data-cites class="small"></div></aside>
      <div class="writer-edit"><textarea class="writer-ta" spellcheck="false" placeholder="# 제목\n\n## 1. 서론\n\n본문에 [@인용키] 로 인용을 넣으세요."></textarea></div>
      <div class="writer-preview"><div class="doc" data-doc></div></div>
    </div>
    <div class="writer-status small muted" data-status></div></section>`);
  main.appendChild(view);
  const ta = $(".writer-ta", view);
  ta.value = m.content;
  W.ta = ta;

  // 저장
  const saveState = $("[data-save]", view);
  const save = debounce(async () => {
    const content = ta.value;
    try {
      await api.patch(`/api/manuscripts/${m.id}`, { content });
      m.content = content;
      saveState.textContent = "저장됨";
    } catch (e) { saveState.textContent = "저장 실패"; errorToast(e); }
  }, 800);
  W.saver = { flush: () => (ta.value !== m.content ? save.flush() : null) };

  const refresh = () => {
    clearTimeout(W.previewTimer);
    W.previewTimer = setTimeout(() => renderPreview(view, ta), 350);
    drawOutline(view, ta);
    drawStatus(view, ta);
  };
  ta.addEventListener("input", (e) => {
    saveState.textContent = "입력 중…";
    save();
    refresh();
    autocomplete(ta);
  });
  ta.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== ta) hideSuggest(); }, 150));
  ta.addEventListener("keydown", (e) => {
    if (suggestKey(e, ta)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "b") { e.preventDefault(); wrap(ta, "**", "**"); }
    else if (mod && e.key === "i") { e.preventDefault(); wrap(ta, "*", "*"); }
    else if (mod && e.key === "s") { e.preventDefault(); save.flush(); }
    else if (e.key === "Tab" && !e.shiftKey && !mod) { e.preventDefault(); insertText(ta, "  "); }
  });

  $("[data-style]", view).onchange = async () => {
    const style = $("[data-style]", view).value;
    try { await api.patch(`/api/manuscripts/${m.id}`, { style }); m.style = style; } catch (e) { errorToast(e); }
    renderPreview(view, ta);
  };
  // 논문 양식: 바꾸면 바로 저장하고 미리보기·표지 정보 버튼을 맞춘다
  const fmtSel = $("[data-format]", view);
  fmtSel.onchange = async () => {
    const id = fmtSel.value;
    const prev = W.fmt ? W.fmt.id : "default";
    if (id === "__manage") {
      fmtSel.value = prev;
      await formatManagerDialog({ selected: prev });
      if (W.m === m) await refreshFormats(view);
      return;
    }
    try {
      await api.patch(`/api/manuscripts/${m.id}`, { doc_format: id });
      m.doc_format = id;
      saveState.textContent = "저장됨";
    } catch (e) {
      fmtSel.value = prev;
      return errorToast(e);
    }
    await setFormat(view, id);
  };
  $("[data-cover]", view).onclick = () => openCoverDialog(view, ta);
  $$("[data-md]", view).forEach((b) => (b.onclick = () => {
    const k = b.dataset.md;
    if (k === "bold") wrap(ta, "**", "**");
    else if (k === "italic") wrap(ta, "*", "*");
    else if (k === "h2") linePrefix(ta, "## ");
    else if (k === "h3") linePrefix(ta, "### ");
    else if (k === "list") linePrefix(ta, "- ");
    else if (k === "quote") linePrefix(ta, "> ");
  }));
  $("[data-cite]", view).onclick = () => citePicker(ta, null);
  $("[data-bib]", view).onclick = () => {
    if (BIB_MARKERS.some((mk) => ta.value.split("\n").some((l) => l.trim() === mk))) return toast("이미 [참고문헌] 자리가 있어요");
    insertText(ta, `\n\n${/[가-힣]/.test(ta.value) ? "[참고문헌]" : "[References]"}\n`);
  };
  $("[data-ai]", view).onclick = (e) => { e.stopPropagation(); aiMenu(e.currentTarget, ta); };
  $("[data-export]", view).onclick = (e) => { e.stopPropagation(); exportMenu(e.currentTarget, view, ta); };
  $$("[data-view] button", view).forEach((b) => (b.onclick = () => {
    view.className = `writer view-${b.dataset.v}`;
    $$("[data-view] button", view).forEach((x) => x.classList.toggle("active", x === b));
    try { localStorage.setItem("paperlab.writeView", b.dataset.v); } catch { /* 무시 */ }
  }));
  $$("[data-view] button", view).forEach((x) => x.classList.toggle("active", x.dataset.v === viewMode));
  W.fmt = { id: fmtId, entry: null, data: null };
  setFormat(view, fmtId);
  refresh();
  renderPreview(view, ta);
  libraryPapers(true).catch(() => {});
  ta.focus();
}

// ------------------------------------------------------------------ 논문 양식 · 표지 정보
// 원고의 # 제목 (없으면 빈 글자)
function docTitle(ta) {
  const m = ta.value.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}

function coverKind() {
  const f = W.fmt;
  if (!f) return "none";
  if (f.data && f.data.cover) return f.data.cover.kind || "none";
  return (f.entry && f.entry.cover_kind) || "none";
}

// 양식을 바꾸면 양식 값을 받아 미리보기 변수(--doc-*)와 표지 정보 버튼을 맞춘다
async function setFormat(view, id) {
  const m = W.m;
  const entry = (W.formats || []).find((f) => f.id === id) || null;
  W.fmt = { id, entry, data: null };
  updateCoverBtn(view);
  let data = null;
  if (W.formats) {
    try { data = (await getFormat(id)).data; } catch { /* 양식 값을 못 받으면 미리보기는 지금 모양 그대로 */ }
  }
  if (W.m !== m || !W.fmt || W.fmt.id !== id) return;
  W.fmt.data = data;
  applyDocFormat($("[data-doc]", view), id, data);
  updateCoverBtn(view);
}

// 양식 관리 창을 닫은 뒤: 선택지를 새로 그리고, 지금 양식이 지워졌으면 기본 (A4)로
async function refreshFormats(view) {
  const m = W.m;
  let list;
  try { list = await listFormats(true); } catch (e) { return errorToast(e); }
  if (W.m !== m) return;
  W.formats = list;
  let id = W.fmt ? W.fmt.id : "default";
  if (!list.some((f) => f.id === id)) {
    id = "default";
    m.doc_format = "default";
  }
  const sel = $("[data-format]", view);
  sel.innerHTML = formatOptions(list, id, { manage: true });
  sel.value = id;
  await setFormat(view, id);
}

function updateCoverBtn(view) {
  const btn = $("[data-cover]", view);
  if (!btn || !W.m) return;
  btn.classList.toggle("hidden", coverKind() === "none");
  const missing = missingCoverFields(W.m.cover);
  btn.toggleAttribute("data-incomplete", missing.length > 0);
  btn.title = missing.length ? `표지 정보 — 비어 있는 칸: ${missing.join(", ")}` : "표지 · 속표지 · 인정서에 들어갈 정보";
  btn.setAttribute("aria-label", missing.length ? "표지 정보 (빈 칸 있음)" : "표지 정보");
}

async function openCoverDialog(view, ta) {
  const m = W.m;
  if (!m || !W.fmt) return false;
  const saved = await coverDialog({
    manuscriptId: m.id,
    cover: m.cover,
    titleFallback: docTitle(ta),
    format: { name: (W.fmt.entry && W.fmt.entry.name) || "", kind: coverKind(), data: W.fmt.data },
  });
  if (saved && W.m === m) {
    m.cover = saved;
    updateCoverBtn(view);
  }
  return !!saved;
}

// ------------------------------------------------------------------ [@ 자동완성 (입력 초점은 편집기에 그대로)
const SG = { box: null, items: [], active: 0, start: 0 };

function hideSuggest() {
  if (SG.box) SG.box.remove();
  SG.box = null;
}

function caretCoords(ta) {
  // 글자 위치를 재기 위해 같은 모양의 보이지 않는 복제본을 만든다
  const div = document.createElement("div");
  const cs = getComputedStyle(ta);
  for (const prop of ["fontFamily", "fontSize", "lineHeight", "padding", "border", "width", "letterSpacing", "wordBreak", "tabSize"]) div.style[prop] = cs[prop];
  Object.assign(div.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", top: "0", left: "-9999px" });
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const mark = document.createElement("span");
  mark.textContent = "\u200b";
  div.appendChild(mark);
  document.body.appendChild(div);
  const r = ta.getBoundingClientRect();
  const x = r.left + mark.offsetLeft - ta.scrollLeft;
  const y = r.top + mark.offsetTop - ta.scrollTop + parseFloat(cs.lineHeight || "24");
  div.remove();
  return { x, y };
}

function autocomplete(ta) {
  const before = ta.value.slice(0, ta.selectionStart);
  const open = before.lastIndexOf("[");
  const m = open >= 0 && !before.slice(open).includes("]") && before.slice(open).match(/(?:^\[|;)\s*-?@([\p{L}\p{N}_:.\-]*)$/u);
  if (!m || !W.papers) return hideSuggest();
  const q = m[1].toLowerCase();
  SG.start = ta.selectionStart - m[1].length;
  SG.items = W.papers.filter((p) => !q || p.citekey.toLowerCase().startsWith(q)
    || [p.title, authorsShort(p.authors, 10), p.year].join(" ").toLowerCase().includes(q)).slice(0, 8);
  if (!SG.items.length) return hideSuggest();
  SG.active = Math.min(SG.active, SG.items.length - 1);
  if (!SG.box) {
    SG.box = el(`<div class="cite-suggest"></div>`);
    document.body.appendChild(SG.box);
  }
  SG.box.innerHTML = SG.items.map((p, i) => `<div class="cs-item ${i === SG.active ? "active" : ""}" data-i="${i}">
    <code>@${esc(p.citekey)}</code><span>${esc((p.title || "").slice(0, 70))}</span><span class="muted">${esc(p.year || "")}</span></div>`).join("")
    + `<div class="cs-hint">↑↓ 고르기 · Enter/Tab 넣기 · Esc 닫기</div>`;
  $$(".cs-item", SG.box).forEach((row) => row.addEventListener("mousedown", (e) => {
    e.preventDefault();
    SG.active = Number(row.dataset.i);
    acceptSuggest(ta);
  }));
  const { x, y } = caretCoords(ta);
  const w = Math.min(520, window.innerWidth - 24);
  SG.box.style.left = `${Math.max(12, Math.min(x, window.innerWidth - w - 12))}px`;
  SG.box.style.top = `${Math.min(y + 4, window.innerHeight - 260)}px`;
}

function acceptSuggest(ta) {
  const p = SG.items[SG.active];
  if (!p) return;
  const end = ta.selectionStart;
  ta.setSelectionRange(SG.start, end);
  const after = ta.value.slice(end);
  const closes = /^[^\[\n]*\]/.test(after);
  hideSuggest();
  insertText(ta, p.citekey + (closes ? "" : "]"));
}

function suggestKey(e, ta) {
  if (!SG.box) return false;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    SG.active = (SG.active + (e.key === "ArrowDown" ? 1 : -1) + SG.items.length) % SG.items.length;
    autocomplete(ta);
    return true;
  }
  if ((e.key === "Enter" || e.key === "Tab") && !e.isComposing) {
    e.preventDefault();
    acceptSuggest(ta);
    return true;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    hideSuggest();
    return true;
  }
  return false;
}

function currentStyle(view) {
  return $("[data-style]", view).value;
}

async function renderPreview(view, ta) {
  const doc = $("[data-doc]", view);
  if (!doc || !W.m) return;
  const seq = W.seq;
  const token = (W.previewToken = (W.previewToken || 0) + 1);
  try {
    const built = await buildDocument(ta.value, { style: currentStyle(view), koreanFirst: state.settings.korean_first !== false });
    if (seq !== W.seq || token !== W.previewToken) return;
    W.built = built;
    doc.innerHTML = blocksToHtml(built.blocks) || `<p class="muted">왼쪽에 글을 쓰면 여기에 서식대로 보여요.</p>`;
    drawCites(view, built);
  } catch (e) {
    if (seq === W.seq) doc.innerHTML = `<div class="status-line bad">${esc(e.message)}</div>`;
  }
}

function drawOutline(view, ta) {
  const box = $("[data-outline]", view);
  const lines = ta.value.split("\n");
  const heads = [];
  let pos = 0;
  lines.forEach((line) => {
    const m = line.match(/^(#{1,4})\s+(.+)/);
    if (m) heads.push({ level: m[1].length, text: m[2], pos });
    pos += line.length + 1;
  });
  $("[data-title]", view).textContent = (heads.find((h) => h.level === 1) || {}).text || "제목 없는 원고";
  box.innerHTML = heads.length ? "" : `<div class="small muted">## 로 장 제목을 쓰면 여기에 보여요</div>`;
  heads.forEach((h, i) => {
    const b = el(`<button class="outline-item" style="padding-left:${(h.level - 1) * 12 + 6}px">${esc(h.text)}</button>`);
    b.onclick = () => {
      ta.focus();
      ta.setSelectionRange(h.pos, h.pos);
      ta.blur();
      ta.focus();
      const target = $(`[data-doc] [data-h="${i}"]`, view);
      if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    box.appendChild(b);
  });
}

function drawStatus(view, ta) {
  const text = ta.value;
  const body = text.replace(CITE_RE, "").replace(/^#+\s.*$/gm, "").replace(/[*_>`#-]/g, "");
  const chars = body.replace(/\n/g, "").length;
  const noSpace = body.replace(/\s/g, "").length;
  const words = (body.match(/\S+/g) || []).length;
  const cites = (text.match(CITE_RE) || []).length;
  $("[data-status]", view).textContent =
    `글자 ${chars.toLocaleString("ko-KR")}자 (공백 제외 ${noSpace.toLocaleString("ko-KR")}자) · 단어 ${words.toLocaleString("ko-KR")}개 · 인용 ${cites}곳`;
}

function drawCites(view, built) {
  const box = $("[data-cites]", view);
  const keys = [...new Set(built.clusters.flatMap((c) => c.items.map((it) => it.key)))];
  if (!keys.length) {
    box.innerHTML = `<div class="muted">＋ 인용 넣기나 [@ 로 서재의 논문을 인용하세요</div>`;
    return;
  }
  box.innerHTML = "";
  for (const k of keys) {
    const it = built.items[k];
    const issues = (built.issues || {})[k] || [];
    box.appendChild(el(`<div class="cite-row ${it ? "" : "missing"}" title="${esc(it ? it.title : "서재에 이 인용키를 가진 논문이 없어요")}">
      <code>@${esc(k)}</code><div class="muted">${it ? esc((it.title || "").slice(0, 60)) : "⚠ 서재에 없는 키"}</div>
      ${issues.length ? `<div class="warn-text">빈 항목: ${esc(issues.join(", "))}</div>` : ""}</div>`));
  }
}

// ------------------------------------------------------------------ 편집 도우미
function insertText(ta, text, selectFrom = null) {
  const s = ta.selectionStart;
  ta.setRangeText(text, s, ta.selectionEnd, "end");
  if (selectFrom != null) ta.setSelectionRange(s + selectFrom, s + text.length);
  ta.dispatchEvent(new Event("input"));
  ta.focus();
}

function wrap(ta, before, after) {
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || "글자";
  ta.setRangeText(before + sel + after, s, e, "select");
  ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  ta.dispatchEvent(new Event("input"));
  ta.focus();
}

function linePrefix(ta, prefix) {
  const s = ta.value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
  const line = ta.value.slice(s, ta.value.indexOf("\n", s) === -1 ? undefined : ta.value.indexOf("\n", s));
  const stripped = line.replace(/^(#{1,4}\s|-\s|>\s)/, "");
  ta.setRangeText(line.startsWith(prefix) ? stripped : prefix + stripped, s, s + line.length, "end");
  ta.dispatchEvent(new Event("input"));
  ta.focus();
}

async function libraryPapers(force = false) {
  if (!W.papers || force) W.papers = (await api.get("/api/papers?limit=2000&sort=added")).items;
  return W.papers;
}

// 인용 고르기: 서재에서 검색해 [@키] 를 넣는다. 여러 편 고르기·쪽 번호 지원
export async function citePicker(ta, replaceFrom, { multi = true, onPick = null, preselected = [] } = {}) {
  $$(".cite-picker").forEach((p) => p.remove());
  let papers;
  try { papers = await libraryPapers(true); } catch (e) { return errorToast(e); }
  const chosen = new Set(preselected);
  const box = el(`<div class="cite-picker">
    <div class="row"><input class="input grow" placeholder="제목·저자·연도·인용키로 찾기"><button class="icon-btn" data-x>✕</button></div>
    <div class="cp-list"></div>
    <div class="row cp-foot"><input class="input" data-loc placeholder="쪽 (선택)" style="width:90px">
      <span class="small muted" data-n></span><span class="spacer"></span><button class="btn sm primary" data-ok>넣기</button></div></div>`);
  document.body.appendChild(box);
  const rect = ta.getBoundingClientRect();
  box.style.left = `${Math.max(12, rect.left + 24)}px`;
  box.style.top = `${Math.max(12, rect.top + 30)}px`;
  const input = $("input", box);
  const list = $(".cp-list", box);
  let active = 0;
  let shown = [];
  const close = () => {
    box.remove();
    document.removeEventListener("mousedown", outside, true);
    if (!document.querySelector(".modal-backdrop")) ta.focus();
  };
  const outside = (e) => { if (!box.contains(e.target)) close(); };
  document.addEventListener("mousedown", outside, true);
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = papers.filter((p) => !q || [p.title, p.citekey, p.year, authorsShort(p.authors, 10), p.venue]
      .join(" ").toLowerCase().includes(q)).slice(0, 60);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length ? "" : `<div class="small muted" style="padding:12px">서재에 맞는 논문이 없어요. ‘논문 찾기’에서 먼저 추가하세요.</div>`;
    shown.forEach((p, i) => {
      const row = el(`<div class="cp-item ${i === active ? "active" : ""}">
        <input type="checkbox" ${chosen.has(p.citekey) ? "checked" : ""}>
        <div style="min-width:0"><div class="t">${esc(p.title)}</div><div class="s">${esc(authorsShort(p.authors, 2))} · ${esc(p.year || "n.d.")} · <code>@${esc(p.citekey)}</code></div></div></div>`);
      $("input", row).onclick = (e) => { e.stopPropagation(); e.target.checked ? chosen.add(p.citekey) : chosen.delete(p.citekey); count(); };
      row.onclick = () => {
        if (multi && chosen.size) { chosen.has(p.citekey) ? chosen.delete(p.citekey) : chosen.add(p.citekey); draw(); count(); }
        else { chosen.clear(); chosen.add(p.citekey); done(); }
      };
      list.appendChild(row);
    });
  };
  const count = () => { $("[data-n]", box).textContent = chosen.size ? `${chosen.size}편 선택` : "Enter로 넣기 · 체크해서 여러 편"; };
  const done = () => {
    if (!chosen.size && shown[active]) chosen.add(shown[active].citekey);
    if (!chosen.size) return;
    const keys = [...chosen];
    const loc = $("[data-loc]", box).value.trim();
    box.remove();
    document.removeEventListener("mousedown", outside, true);
    if (onPick) return onPick(keys, loc);
    const text = `[${keys.map((k, i) => `@${k}${loc && i === keys.length - 1 ? `, p. ${loc}` : ""}`).join("; ")}]`;
    ta.focus();
    if (replaceFrom != null && ta.value.slice(replaceFrom, replaceFrom + 2) === "[@") ta.setSelectionRange(replaceFrom, replaceFrom + 2);
    insertText(ta, text);
  };
  input.oninput = () => { active = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); draw(); list.children[active]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); draw(); list.children[active]?.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter") { e.preventDefault(); done(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === " " && e.ctrlKey && shown[active]) {
      e.preventDefault();
      const k = shown[active].citekey;
      chosen.has(k) ? chosen.delete(k) : chosen.add(k);
      draw(); count();
    }
  };
  $("[data-x]", box).onclick = close;
  $("[data-ok]", box).onclick = done;
  count();
  draw();
  input.focus();
}

// ------------------------------------------------------------------ AI 도우미
const AI_MODES = [
  ["polish", "문장 다듬기"], ["academic", "학술 문체로"], ["concise", "간결하게"], ["expand", "자세히 풀어 쓰기"],
  "-", ["to_en", "영어로 번역"], ["to_ko", "한국어로 번역"], "-", ["continue", "이어 쓰기"], ["draft", "논문을 골라 초안 쓰기…"],
];

function aiMenu(anchor, ta) {
  popupMenu(anchor, AI_MODES.map((m) => (m === "-" ? "-" : { label: m[1], action: () => runAi(m[0], ta) })), { left: true });
}

function selectionOrParagraph(ta) {
  let s = ta.selectionStart;
  let e = ta.selectionEnd;
  if (s === e) {
    const v = ta.value;
    s = v.lastIndexOf("\n\n", s - 1);
    s = s === -1 ? 0 : s + 2;
    e = v.indexOf("\n\n", e);
    e = e === -1 ? v.length : e;
  }
  return { s, e, text: ta.value.slice(s, e) };
}

function currentHeading(ta) {
  const before = ta.value.slice(0, ta.selectionStart).split("\n").reverse();
  const h = before.find((l) => /^#{2,4}\s/.test(l));
  return h ? h.replace(/^#+\s*/, "") : "";
}

async function runAi(mode, ta) {
  const st = await api.get("/api/ai/status").catch(() => ({ ready: false, message: "" }));
  if (!st.ready) {
    toast(st.message || "AI 설정이 필요해요", "error");
    return settingsDialog();
  }
  let { s, e, text } = selectionOrParagraph(ta);
  let keys = [...new Set((text.match(CITE_RE) || []).flatMap((raw) => (parseCitation(raw.slice(1, -1)) || []).map((it) => it.key)))];
  let instruction = "";
  const insertAfter = mode === "continue" || mode === "draft";
  if (mode === "continue") {
    text = ta.value.slice(Math.max(0, ta.selectionEnd - 4000), ta.selectionEnd);
    s = e = ta.selectionEnd;
  }
  if (mode === "draft") {
    const opts = await draftDialog(ta, keys);
    if (!opts) return;
    ({ keys, instruction } = opts);
    text = "";
    s = e = ta.selectionEnd;
  } else if (!text.trim()) {
    return toast("다듬을 글을 선택하거나 문단 안에 커서를 두세요");
  }
  const context = mode === "draft" ? ta.value.slice(0, 3000) : "";
  const body = el(`<div><div class="small muted" style="margin-bottom:8px">${esc(AI_MODES.find((m) => m[0] === mode)[1])}${keys.length ? ` · 참고 논문 ${keys.length}편` : ""}</div>
    <div class="ai-out prose"><span class="typing"><span></span><span></span><span></span></span></div>
    <textarea class="input hidden" style="width:100%;min-height:240px"></textarea></div>`);
  const foot = el(`<div style="display:contents"><div class="left"><button class="btn" data-edit>고쳐서 넣기</button><button class="btn" data-copy>복사</button></div>
    <button class="btn" data-no>취소</button><button class="btn primary" data-ok disabled>${insertAfter ? "커서 위치에 넣기" : "바꾸기"}</button></div>`);
  const m = modal({ title: "AI 글쓰기 도우미", body, foot, wide: true, onClose: () => abort.abort() });
  const abort = new AbortController();
  let result = "";
  const out = $(".ai-out", body);
  try {
    await streamEvents("/api/ai/write", { mode, text, keys, instruction, context }, (ev) => {
      if (ev.type === "delta") { result += ev.text; out.textContent = result; }
      else if (ev.type === "done") {
        result = ev.text;
        out.style.whiteSpace = "normal";
        out.innerHTML = window.DOMPurify.sanitize(window.marked.parse(result));
      }
      else if (ev.type === "error") throw new Error(ev.error);
    }, abort.signal);
    $("[data-ok]", foot).disabled = false;
  } catch (err) {
    if (err.name !== "AbortError") out.innerHTML = `<div class="msg error">${esc(err.message)}</div>`;
    return;
  }
  const edit = $("textarea", body);
  $("[data-edit]", foot).onclick = () => { edit.value = result; edit.classList.remove("hidden"); out.classList.add("hidden"); edit.focus(); };
  $("[data-copy]", foot).onclick = () => copyText(edit.classList.contains("hidden") ? result : edit.value);
  $("[data-no]", foot).onclick = () => m.close();
  $("[data-ok]", foot).onclick = () => {
    const finalText = edit.classList.contains("hidden") ? result : edit.value;
    ta.focus();
    if (insertAfter) {
      ta.setSelectionRange(s, s);
      insertText(ta, (s > 0 && ta.value[s - 1] !== "\n" ? "\n\n" : "") + finalText.trim() + "\n");
    } else {
      ta.setSelectionRange(s, e);
      insertText(ta, finalText.trim());
    }
    m.close();
  };
}

function draftDialog(ta, keys) {
  return new Promise((resolve) => {
    const chosen = new Set(keys);
    const body = el(`<form><div class="field"><label>쓸 절</label><input class="input" name="section" value="${esc(currentHeading(ta))}" placeholder="예: 2.2 선행연구 검토"></div>
      <div class="field"><label>요청 사항 (선택)</label><textarea class="input" name="req" rows="3" placeholder="예: 세 논문의 방법론 차이를 비교하고 한계를 짚어 줘. 3문단 정도."></textarea></div>
      <div class="field"><label>참고할 논문 (초록·AI 요약·내 메모·하이라이트를 근거로 써요)</label>
        <div class="chips" data-keys></div><button type="button" class="btn sm" data-pick style="margin-top:6px;align-self:flex-start">＋ 논문 고르기</button></div></form>`);
    const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button><button class="btn primary" data-ok>초안 쓰기</button></div>`);
    let result = null;
    const m = modal({ title: "논문을 근거로 초안 쓰기", body, foot, onClose: () => resolve(result) });
    const drawKeys = () => {
      $("[data-keys]", body).innerHTML = chosen.size ? [...chosen].map((k) => `<span class="chip">@${esc(k)}</span>`).join("")
        : `<span class="small muted">아직 고른 논문이 없어요</span>`;
    };
    drawKeys();
    $("[data-pick]", body).onclick = () => citePicker(ta, null, {
      preselected: [...chosen],
      onPick: (picked) => { picked.forEach((k) => chosen.add(k)); drawKeys(); },
    });
    $("[data-no]", foot).onclick = () => m.close();
    $("[data-ok]", foot).onclick = () => {
      if (!chosen.size) return toast("근거로 쓸 논문을 한 편 이상 골라 주세요", "error");
      const fd = new FormData(body);
      result = { keys: [...chosen], instruction: `절 제목: ${fd.get("section") || "(지정 안 함)"}\n${fd.get("req") || ""}` };
      m.close();
    };
  });
}

// ------------------------------------------------------------------ 내보내기
function exportMenu(anchor, view, ta) {
  const fmtName = `양식: ${(W.fmt && W.fmt.entry && W.fmt.entry.name) || "기본 (A4)"}`;
  popupMenu(anchor, [
    { label: "워드 (.docx)", sub: fmtName, action: () => exportAs("docx", view, ta) },
    { label: "한글 (.hwpx)", sub: fmtName, action: () => exportAs("hwpx", view, ta) },
    { label: "마크다운 (.md)", sub: "각주 포함 · 양식과 무관", action: () => exportAs("md", view, ta) },
    "-",
    { label: "서식 그대로 복사", sub: "붙여넣기용", action: () => copyFormatted(view) },
  ]).classList.add("export-menu");
}

// 표지 필수 항목이 빈 채로 내보낼 때: "go" = 그대로, "cover" = 표지 정보 입력, null = 취소
function coverMissingDialog(missing) {
  return new Promise((resolve) => {
    const body = el(`<div><p style="margin:4px 0 8px">${esc(`표지 정보가 비어 있어요: ${missing.join(", ")}. 빈 칸은 ○○○로 들어가요.`)}</p></div>`);
    const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button>
      <button class="btn" data-go>그대로 내보내기</button><button class="btn primary" data-cover>표지 정보 입력</button></div>`);
    let result = null;
    const m = modal({ title: "확인", body, foot, onClose: () => resolve(result) });
    $("[data-no]", foot).onclick = () => m.close();
    $("[data-go]", foot).onclick = () => { result = "go"; m.close(); };
    $("[data-cover]", foot).onclick = () => { result = "cover"; m.close(); };
    setTimeout(() => $("[data-cover]", foot).focus(), 40);
  });
}

async function exportAs(format, view, ta) {
  if (W.saver) await W.saver.flush();
  const office = format === "docx" || format === "hwpx";
  const fmtId = (W.fmt && W.fmt.id) || "default";
  const kind = coverKind();
  try {
    if (office && kind !== "none") {
      const missing = missingCoverFields(W.m.cover, { full: true, kind, titleFallback: docTitle(ta) });
      if (missing.length) {
        const choice = await coverMissingDialog(missing);
        if (choice === "cover") return openCoverDialog(view, ta);
        if (choice !== "go") return;
      }
    }
    const built = await buildDocument(ta.value, { style: currentStyle(view), koreanFirst: state.settings.korean_first !== false });
    if (built.missingKeys.length && !(await confirmDialog(
      `서재에 없는 인용키가 있어요: ${built.missingKeys.join(", ")}\n그대로 표시해서 내보낼까요?`, { ok: "그대로 내보내기" }))) return;
    const title = $("[data-title]", view).textContent.trim() || "원고";
    const payload = { format, blocks: stripWarn(built.blocks), meta: { title }, filename: title };
    if (office && fmtId !== "default") {
      // 표지의 국문 제목 기본값은 원고의 # 제목 (없으면 빈 칸으로 두어 ○○○로 들어가게)
      Object.assign(payload, { doc_format: fmtId, cover: W.m.cover || {}, meta: { title: docTitle(ta) } });
    }
    const res = await api.raw("POST", "/api/export-document", payload);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "내보내기 실패");
    downloadBlob(await res.blob(), `${title.replace(/[\\/:*?"<>|]+/g, "_")}.${format}`);
    const label = format === "hwpx" ? "한글" : format === "docx" ? "워드" : "마크다운";
    if (office && kind !== "none" && fmtId !== "default") {
      toast(`${label} 파일로 저장했어요 · 목차는 워드(참조 → 목차) · 한글(도구 → 차례/색인)로 넣어 주세요`, "success", LONG);
    } else toast(`${label} 파일로 저장했어요`, "success");
    const warnings = exportWarnings(res);
    if (warnings.length) toast(warningText(warnings, kind), "", LONG);
    if (format === "docx" && fmtId !== "default" && !hancomNoticeShown.has(fmtId) && usesHancomFonts(W.fmt && W.fmt.data)) {
      hancomNoticeShown.add(fmtId);
      toast("휴먼명조 같은 한컴 글꼴이 없는 PC의 워드에서는 비슷한 다른 글꼴로 보여요. 제출 파일은 한컴오피스가 설치된 PC에서 확인하세요", "", LONG);
    }
  } catch (e) { errorToast(e); }
}

function stripWarn(blocks) {
  return blocks.map((b) => (b.runs ? { ...b, runs: b.runs.map(({ warn, ...r }) => r) } : b));
}

function copyFormatted(view) {
  const doc = $("[data-doc]", view);
  copyText(doc.innerText, doc.innerHTML);
}

// ------------------------------------------------------------------ 워드·한글 문서 변환
export async function composeDialog(initialFile = null) {
  const styles = await listStyles().catch(() => []);
  const body = el(`<div>
    <div class="status-line" style="display:block;line-height:1.7" data-step1>워드(.docx)나 한글(.hwpx) 문서를 올리세요. 인용할 자리에 <code>[@인용키]</code>, 참고문헌 자리에 <code>[참고문헌]</code>을 적어 두면 돼요.
      원본 파일은 바뀌지 않고, 인용을 채운 새 파일을 받아요.</div>
    <div data-result style="margin-top:12px"></div></div>`);
  const foot = el(`<div style="display:contents"><div class="left"><button class="btn" data-pick>문서 고르기</button></div>
    <button class="btn" data-no>닫기</button><button class="btn primary" data-ok disabled>인용 넣은 파일 받기</button></div>`);
  const m = modal({ title: "워드·한글 문서에 인용 넣기", body, foot, wide: true });
  let scan = null;
  const result = $("[data-result]", body);
  const draw = () => {
    const keys = Object.keys(scan.items);
    const missing = keys.filter((k) => !scan.items[k]);
    result.innerHTML = `
      <div class="preview-card" style="margin-top:0">
        <div style="font-weight:650">${esc(scan.filename)} <span class="chip">${scan.kind === "hwpx" ? "한글" : "워드"}</span></div>
        <div class="small" style="margin-top:4px">인용 표시 <b>${scan.citations.length}</b>곳 · 논문 <b>${keys.length - missing.length}</b>편
          · 참고문헌 자리 ${scan.has_bib_marker ? "<b>있음</b>" : "없음 (문서 끝에 붙여요)"}</div>
        ${missing.length ? `<div class="status-line bad" style="margin-top:8px">서재에 없는 인용키: ${missing.map((k) => `<code>${esc(k)}</code>`).join(", ")} — 표시를 그대로 남겨요</div>` : ""}
        ${!scan.citations.length ? `<div class="status-line bad" style="margin-top:8px">[@인용키] 표시를 찾지 못했어요. 사용법을 확인해 주세요.</div>` : ""}
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="field"><label>인용 스타일</label><select class="input" data-style>${styleOptions(styles, state.settings.citation_style || "apa")}</select></div>
        <div class="field"><label>참고문헌 제목</label><input class="input" data-bibtitle value="참고문헌"></div>
      </div>
      <div class="small muted" data-note></div>`;
    $("[data-ok]", foot).disabled = !scan.citations.length;
    const noteCheck = async () => {
      const style = $("[data-style]", result).value;
      const xml = await api.raw("GET", `/api/styles/${encodeURIComponent(style)}`).then((r) => r.text()).catch(() => "");
      const note = /class="note"/.test(xml);
      $("[data-note]", result).textContent = note
        ? (scan.kind === "hwpx" ? "각주 스타일은 한글 문서에서 지원하지 않아요. 저자-연도나 번호 스타일을 골라 주세요." : "각주 스타일: 인용 표시 자리에 워드 각주가 들어가요.")
        : "";
      $("[data-ok]", foot).disabled = !scan.citations.length || (note && scan.kind === "hwpx");
    };
    $("[data-style]", result).onchange = noteCheck;
    noteCheck();
  };
  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    result.innerHTML = `<div class="status-line"><span class="spinner"></span> 문서를 읽는 중…</div>`;
    try {
      scan = await api.post("/api/compose/scan", fd);
      draw();
    } catch (e) {
      result.innerHTML = `<div class="status-line bad">${esc(e.message)}</div>`;
    }
  };
  $("[data-pick]", foot).onclick = async () => upload((await pickFiles({ accept: ".docx,.hwpx" }))[0]);
  $("[data-no]", foot).onclick = () => m.close();
  $("[data-ok]", foot).onclick = async () => {
    const btn = $("[data-ok]", foot);
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> 만드는 중`;
    try {
      const style = $("[data-style]", result).value;
      const r = await renderClusters(scan.items, scan.citations, { style, koreanFirst: state.settings.korean_first !== false });
      const rendered = scan.citations.map((c, i) => {
        const x = r.clusters[i];
        if (!x || !x.html) return { runs: [{ text: c.raw }] };
        const runs = htmlToRuns(x.html);
        if (x.missing && x.missing.length) runs.push({ text: ` [@${x.missing.join("; @")}?]` });
        return { runs };
      });
      const res = await api.raw("POST", "/api/compose/apply", {
        token: scan.token, rendered, note_style: r.note,
        bibliography: r.entries.map((e) => htmlToRuns(e.html)),
        bib_title: $("[data-bibtitle]", result).value || "참고문헌",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "변환 실패");
      const cd = res.headers.get("content-disposition") || "";
      const name = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/) || [])[1] || `document.${scan.kind}`);
      downloadBlob(await res.blob(), name);
      toast("인용과 참고문헌을 넣은 파일을 저장했어요", "success");
    } catch (e) { errorToast(e); }
    btn.disabled = false;
    btn.textContent = "인용 넣은 파일 받기";
  };
  if (initialFile) upload(initialFile);
}
