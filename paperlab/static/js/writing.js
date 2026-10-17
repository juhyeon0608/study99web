// 논문 쓰기: 원고 목록 · 마크다운 편집기 · 인용 넣기 · 서식 미리보기 · AI 글쓰기 도우미 · 참고 패널(refpane.js) ·
// 워드(.docx)·한글(.hwpx) 내보내기 · 워드·한글 문서의 [@인용키] 변환

import { api, downloadBlob, qs } from "./api.js";
import { sortVerify, vdName, verifyDoneText, verifyMarks, verifySummary } from "./ask.js";
import {
  cancelJob, engineName, ensureAiRoute, fmtClock, handledJob, isActive, notifyOffer, retryJob, setStatusLine, statusLineEl, trackJob, watchJob,
} from "./jobs.js";
// AI 글쓰기 결과를 나중에 안전하게 넣기 (2026-10-16 백그라운드 AI)
import { insertionText, planApply, trimRange, wordDiff, writeAnchor } from "./writeai.js";
import { htmlToRuns, listStyles, renderClusters, styleOptions } from "./cite.js";
import {
  applyDocFormat, coverDialog, exportWarnings, formatManagerDialog, formatOptions, getFormat, listFormats,
  missingCoverFields, usesHancomFonts, warningText,
} from "./formats.js";
import { ICON_REF, refPane } from "./refpane.js";
import { CITE_RE, parseCitation } from "./refquote.js";
import { state } from "./state.js";
// 그림 · 표 · 캡션 · 목록 편집 · 단축키 도움말 (docs/specs/writing-figures-tables.md)
import {
  applyEditToValue, backspaceEdit, blockInsert, captionInfo, captionLabel, diffEdit, enterEdit, figureInfo, figureMarkdown, findFigures,
  findTables, headingEdit, indentEdit,
  newTable, resolveXrefs, splitXrefs, tableAt, tableMarkdown, toggleListEdit,
} from "./writeedit.js";
import {
  applyEdit, hydrateFigures, imageFiles, revokeFigureUrls, shortcutDialog, tableDialog, tableSizeDialog, uploadFigure,
} from "./writetools.js";
import {
  $, $$, ICON_INFO, ICON_WARN, authorsShort, confirmDialog, copyText, debounce, el, errorToast, esc, fmtDate, modal, pickFiles,
  popupMenu, purifyMd, store, toast,
} from "./ui.js";

const W = { m: null, saver: null, previewTimer: null, papers: null, view: "split", seq: 0, formats: null, fmt: null, ref: null,
  vd: null }; // vd: 3단계 인용 검증 { data, marks, stop, running }
const ICON_VERIFY = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6zM9 12l2 2 4-4"/></svg>`;
const VERIFY_TITLE = "원고의 인용 문장이 원문에 근거가 있는지 확인해요. 직접 인용은 글자를 대조하고, 나머지는 AI가 판정해요.";
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || "");
const PEEK_KEY = MAC ? "⌘+Enter" : "Ctrl+Enter";
const LONG = { duration: 8000 };
const hancomNoticeShown = new Set(); // 한컴 글꼴 안내: 세션마다 양식별 한 번
const BIB_MARKERS = ["[참고문헌]", "[References]", "[Bibliography]", "[REFERENCES]"];
// 인용 표시 정규식 · parseCitation은 refquote.js 한 곳에(참고 패널이 만든 인용 글과 같은 규칙으로 읽음 — AC-R34)

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
    if (!r || !r.html) return [{ text: c.raw, ...fmt, warn: true, cite: n }];
    const runs = htmlToRuns(r.html, fmt).map((x) => ({ ...x, cite: n })); // cite = 인용 순번(인용 검증 표시 — AD-2)
    if (r.missing && r.missing.length) runs.push({ text: ` [@${r.missing.join("; @")}?]`, warn: true, cite: n });
    return rendered.note ? [{ footnote: htmlToRuns(r.html) }] : runs;
  };
  const textRuns = (s, fmt) => {
    const out = [];
    s.split(/(\d+)/).forEach((part) => {
      const m = part.match(/^(\d+)$/);
      if (m) out.push(...clusterRuns(Number(m[1]), fmt));
      else if (part) {
        // @fig:이름 · @tbl:이름 상호 참조는 번호를 다 매긴 뒤 채운다(resolveXrefs)
        for (const x of splitXrefs(part)) out.push(typeof x === "string" ? { text: x, ...fmt } : { text: "", ...fmt, xref: x.xref });
      }
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
  // 그림 · 표: 원고에 나온 순서대로 번호(옮기거나 지우면 다시 매겨짐). 꼬리표 {#fig:이름} · {#tbl:이름} → 번호(@fig:이름 참조)
  const ko = /[가-힣]/.test(text);
  const labels = new Map();
  const count = { fig: 0, tbl: 0 };
  const captioned = new WeakSet();
  const numbered = (kind, label, body) => {
    const n = ++count[kind];
    if (label && !labels.has(label)) labels.set(label, { kind, n });
    const head = { text: captionLabel(kind, n, ko), b: true };
    return { n, caption: body.length ? [head, { text: " " }, ...body] : [head] };
  };
  const capRuns = (s) => inline(window.marked.Lexer.lexInline(s));
  const nextIsTable = (tokens, k) => (tokens.slice(k + 1).find((x) => x.type !== "space") || {}).type === "table";
  let pendingCap = null;
  // 맨 바깥 문단이 그림(![캡션](fig:…))이나 표 캡션 줄(표: …)이면 처리하고 true
  const figureOrCaption = (t, tokens, k, depth) => {
    if (depth) return false;
    const fig = figureInfo(t.text);
    if (fig) {
      const { n, caption } = numbered("fig", fig.label, capRuns(fig.alt));
      blocks.push({ type: "figure", src: fig.src, alt: fig.alt, number: n, caption });
      return true;
    }
    const cap = captionInfo(t.text);
    if (!cap) return false;
    if (nextIsTable(tokens, k)) { pendingCap = cap; return true; } // 표 위 캡션 줄
    const last = blocks[blocks.length - 1];
    if (!last || last.type !== "table" || captioned.has(last)) return false;
    captioned.add(last); // 표 바로 아래 캡션 줄 (Pandoc 방식)
    if (cap.label && !labels.has(cap.label)) labels.set(cap.label, { kind: "tbl", n: last.number });
    const body = capRuns(cap.text);
    last.caption = [last.caption[0], ...(body.length ? [{ text: " " }, ...body] : [])];
    return true;
  };
  const walk = (tokens, depth = 0) => {
    for (const [k, t] of tokens.entries()) {
      if (t.type === "heading") {
        if (t.depth === 1) blocks.push({ type: "title", runs: inline(t.tokens) });
        else blocks.push({ type: "heading", level: Math.min(t.depth - 1, 3), runs: inline(t.tokens) });
      } else if (t.type === "paragraph") {
        if (t.text.trim() === "") blocks.push(...bibBlocks());
        else if (!figureOrCaption(t, tokens, k, depth)) blocks.push({ type: "paragraph", runs: inline(t.tokens) });
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
        const cap = pendingCap;
        pendingCap = null;
        const { n, caption } = numbered("tbl", cap ? cap.label : "", cap ? capRuns(cap.text) : []);
        const block = { type: "table", header: true, align: t.align || [], number: n, caption,
          rows: [t.header.map((c) => inline(c.tokens)), ...t.rows.map((r) => r.map((c) => inline(c.tokens)))] };
        if (cap) captioned.add(block);
        blocks.push(block);
      } else if (t.type === "html" && t.text.trim()) {
        blocks.push({ type: "paragraph", runs: textRuns(t.text.replace(/<[^>]+>/g, "").trim(), {}) });
      }
    }
  };
  walk(window.marked.lexer(src));
  if (!bibPlaced && rendered.entries.length) blocks.push(...bibBlocks());
  resolveXrefs(blocks, labels, ko);
  return { blocks, clusters, rendered, missingKeys, issues: lookup.issues, items: lookup.items };
}

function unescapeHtml(s) {
  return String(s).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" }[e]));
}

// 인용 검증에서 약함 · 근거 없음인 인용 런을 감싼다 (시안 6.3절). 그 밖은 runHtml 그대로
function runsHtml(runs, notes) {
  const marks = (W.vd && W.vd.marks) || new Map();
  let out = "";
  let group = null;
  let buf = "";
  const flush = () => {
    if (group === null) return;
    const mk = marks.get(group);
    out += `<span class="cite-vd" data-verdict="${mk.verdict}" data-vd-claim="${mk.i}" role="button" tabindex="0" title="${esc(`${mk.name}${mk.reason ? ` — ${mk.reason}` : ""}`)}">${buf}</span><span class="sr-only">(인용 검증: ${esc(mk.name)})</span>`;
    group = null;
    buf = "";
  };
  for (const r of runs) {
    const h = runHtml(r, notes);
    if (r.cite != null && marks.has(r.cite)) {
      if (group !== r.cite) { flush(); group = r.cite; }
      buf += h;
    } else { flush(); out += h; }
  }
  flush();
  return out;
}

function runHtml(r, notes) {
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
  if (r.warn) h = `<span class="cite-warn" title="서재에 없는 인용 키예요">${h}</span>`;
  return h;
}

function blocksToHtml(blocks) {
  const notes = [];
  let headingIndex = 0;
  const html = blocks.map((b) => {
    const r = () => runsHtml(b.runs || [], notes);
    switch (b.type) {
      case "title": return `<h1 class="doc-title" data-h="${headingIndex++}">${r()}</h1>`;
      case "heading": return `<h${b.level + 1} data-h="${headingIndex++}">${r()}</h${b.level + 1}>`;
      case "list_item": return `<p class="doc-li" style="padding-left:${1.4 + b.depth * 1.2}em;text-indent:-1em">${b.ordered ? `${Number(b.number)}.` : ["•", "◦", "▪"][b.depth % 3]} ${r()}</p>`;
      // 그림: 아래 캡션 · 표: 위 캡션 (누르면 편집기에서 그 그림 줄 · 표 고치기 창)
      case "figure": return `<figure class="doc-fig" data-fig-i="${Number(b.number) - 1}" role="button" tabindex="0" title="눌러서 편집기에서 보기">`
        + `<img data-fig="${esc(b.src)}" alt="${esc(b.alt || "")}"><figcaption>${runsHtml(b.caption || [], notes)}</figcaption></figure>`;
      case "table": return `<div class="doc-tbl" data-tbl-i="${Number(b.number) - 1}" role="button" tabindex="0" title="눌러서 표 고치기">`
        + `<p class="doc-cap">${runsHtml(b.caption || [], notes)}</p><table>${b.rows.map((row, ri) => `<tr>${row.map((cell, ci) => {
          const tag = ri === 0 ? "th" : "td";
          return `<${tag} style="text-align:${esc(b.align[ci] || "left")}">${runsHtml(cell, notes)}</${tag}>`;
        }).join("")}</tr>`).join("")}</table></div>`;
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
  if (W.ref) W.ref.destroy(); // 패널 닫기 · PDF 메모리 풀기 · 진행 중인 추천 멈춤
  W.ref = null;
  if (W.vd && W.vd.stop) W.vd.stop();
  W.vd = null;
  if (W.ai) W.ai.destroy(); // AI 결과 단추의 폴링 · 열기 이벤트 (작업 자체는 서버에서 계속)
  W.ai = null;
  if (W.saver) W.saver.flush();
  W.saver = null;
  W.m = null;
  W.ta = null;
  clearTimeout(W.previewTimer);
  W.seq++;
  revokeFigureUrls(); // 미리보기 그림의 blob 주소 풀기
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
      if (!(await confirmDialog(`‘${m.title || "제목 없는 원고"}’ 원고를 삭제할까요? 되돌릴 수 없어요.`, { ok: "삭제", danger: true }))) return;
      try { await api.del(`/api/manuscripts/${m.id}`); } catch (err) { if (err.status !== 404) return errorToast(err); }
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
  const [styles, formats] = await Promise.all([listStyles().catch(() => []), listFormats().catch(() => null)]);
  if (seq !== W.seq) return;
  W.m = m;
  W.formats = formats;
  m.cover = m.cover && typeof m.cover === "object" ? m.cover : {};
  const fmtId = formats && formats.some((f) => f.id === m.doc_format) ? m.doc_format : "default";
  const saved = store.get("paperlab.writeView"); // 저장된 값은 class 이름에 들어가므로 아는 값만
  const viewMode = ["edit", "split", "preview"].includes(saved) ? saved : "split";
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
      <button class="btn sm ghost" data-md="h2" title="장 제목 — '제N장' 번호가 자동으로 붙고 뒤 번호도 이어져요 (${MAC ? "⌘+⌥" : "Ctrl+Alt"}+2)" aria-keyshortcuts="Control+Alt+2">장</button>
      <button class="btn sm ghost" data-md="h3" title="절 제목 — '제N절' 번호가 장마다 1부터 붙어요 (${MAC ? "⌘+⌥" : "Ctrl+Alt"}+3)" aria-keyshortcuts="Control+Alt+3">절</button>
      <button class="btn sm ghost" data-md="list" title="글머리 목록 켜기 · 끄기 (${MAC ? "⌘" : "Ctrl"}+Shift+8 · 줄 앞에 - 와 띄어쓰기)" aria-keyshortcuts="Control+Shift+8">• 글머리</button>
      <button class="btn sm ghost" data-md="olist" title="번호 목록 켜기 · 끄기 (${MAC ? "⌘" : "Ctrl"}+Shift+7 · 줄 앞에 1. 과 띄어쓰기)" aria-keyshortcuts="Control+Shift+7">1. 번호</button>
      <button class="btn sm ghost" data-md="quote" title="인용문 블록">❝</button>
      <button class="btn sm ghost" data-figure title="그림 넣기 — 붙여넣기 · 끌어 놓기도 돼요. 아래에 '그림 1. 설명' 캡션이 붙어요">그림</button>
      <button class="btn sm ghost" data-table title="표 넣기 · 고치기 (${MAC ? "⌘+⌥" : "Ctrl+Alt"}+T) — 커서가 표 안에 있으면 그 표를 고쳐요">표</button>
      <span class="sep"></span>
      <button class="btn sm primary" data-cite title="[@ 를 입력해도 열려요">＋ 인용 넣기</button>
      <button class="btn sm ghost" data-bib title="참고문헌이 들어갈 자리">[참고문헌]</button>
      <span class="menu-wrap"><button class="btn sm" data-ai>✦ AI 도우미 ▾</button></span>
      <button type="button" class="btn sm" data-ref-toggle aria-pressed="false" aria-controls="ref-pane" aria-keyshortcuts="Alt+R"
        title="참고 패널 (Alt+R)">${ICON_REF}참고</button>
      <button type="button" class="btn sm" data-verify title="${VERIFY_TITLE}">${ICON_VERIFY}<span>인용 검증</span></button>
      <span class="spacer"></span>
      <!-- '?'만으로는 단축키 도움말인 줄 몰라서(2026-10-17 사용자 지적) 글자로 보이게 -->
      <button type="button" class="btn sm" data-shortcuts title="단축키 · 서식 도움말 (${MAC ? "⌘" : "Ctrl"}+/)" aria-keyshortcuts="Control+/">⌨ 단축키</button>
      <div class="seg" data-view><button data-v="edit">편집</button><button data-v="split">나란히</button><button data-v="preview">미리보기</button></div>
    </div>
    <div class="writer-body">
      <aside class="writer-side"><div class="section-title" style="margin-top:0">개요</div><div data-outline></div>
        <div class="section-title">이 원고의 인용</div><div data-cites class="small"></div>
        <div class="section-title hidden" id="vd-h">인용 검증</div><div class="small hidden" data-verify-box></div></aside>
      <div class="writer-edit"><textarea class="writer-ta" spellcheck="false" placeholder="# 제목\n\n## 1. 서론\n\n본문에 [@인용키] 로 인용을 넣으세요."></textarea></div>
      <div class="writer-preview"><div class="doc" data-doc></div></div>
      <aside class="panel ref-pane" id="ref-pane" aria-label="참고 패널"></aside>
    </div>
    <div class="writer-status small muted" data-status style="display:flex;align-items:center;gap:6px"><span data-status-text></span> <span data-verify-sum></span>
      <span class="spacer"></span><button type="button" class="btn sm ghost" data-shortcuts-hint>단축키 보기 (${MAC ? "⌘" : "Ctrl"}+/)</button></div>
    <div class="sr-only" role="status" data-ref-live></div></section>`);
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
      if (W.vd && W.vd.data && W.m === m) loadVerify(view, ta); // 저장 뒤 인용 검증을 지금 원고에 다시 맞춤(AI 없음 — 6.4절)
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
  let softBreak = false; // Shift+Enter: 목록을 잇지 않는 줄바꿈 (아래 input 보정에서 뺌)
  ta.addEventListener("keydown", (e) => {
    softBreak = e.key === "Enter" && e.shiftKey;
    if (suggestKey(e, ta)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "b") { e.preventDefault(); wrap(ta, "**", "**"); }
    else if (mod && e.key === "i") { e.preventDefault(); wrap(ta, "*", "*"); }
    else if (mod && e.key === "s") { e.preventDefault(); save.flush(); }
    // 목록 (docs/specs/writing-figures-tables.md): Ctrl+Shift+8 글머리 · 7 번호, Enter 다음 항목, Backspace 기호 지우기, Tab 들여쓰기
    else if (mod && e.shiftKey && !e.altKey && (e.code === "Digit8" || e.code === "Digit7")) {
      e.preventDefault();
      applyEdit(ta, toggleListEdit(ta.value, ta.selectionStart, ta.selectionEnd, e.code === "Digit7"));
    } else if (mod && e.altKey && e.code === "KeyT") { e.preventDefault(); editTable(ta); }
    // 장 · 절 제목 (번호 '제N장' · '제N절' 자동): Ctrl+Alt+2 · 3
    else if (mod && e.altKey && !e.shiftKey && (e.code === "Digit2" || e.code === "Digit3")) {
      e.preventDefault();
      applyEdit(ta, headingEdit(ta.value, ta.selectionStart, e.code === "Digit2" ? 2 : 3));
    } else if (e.isComposing || e.keyCode === 229 || mod || e.altKey) return; // 한글 조합 중 Enter 등은 브라우저에 맡김
    else if (e.key === "Enter" && !e.shiftKey) {
      const edit = enterEdit(ta.value, ta.selectionStart, ta.selectionEnd);
      if (edit) { e.preventDefault(); applyEdit(ta, edit); }
    } else if (e.key === "Backspace" && !e.shiftKey) {
      const edit = backspaceEdit(ta.value, ta.selectionStart, ta.selectionEnd);
      if (edit) { e.preventDefault(); applyEdit(ta, edit); }
    } else if (e.key === "Tab") {
      const edit = indentEdit(ta.value, ta.selectionStart, ta.selectionEnd, e.shiftKey);
      if (edit) { e.preventDefault(); applyEdit(ta, edit); }
      else if (!e.shiftKey) { e.preventDefault(); insertText(ta, "  "); } // Shift+Tab은 그대로 초점 이동
    }
  });
  // 한글 조합 중 Enter처럼 keydown에서 못 잡고 브라우저가 줄을 바꾼 경우: 바꾸기 전 글에 Enter 규칙을 적용해 맞춘다
  ta.addEventListener("input", (e) => {
    const pos = ta.selectionStart;
    if (e.inputType !== "insertLineBreak" || e.isComposing || softBreak || pos !== ta.selectionEnd || ta.value[pos - 1] !== "\n") return;
    const before = ta.value.slice(0, pos - 1) + ta.value.slice(pos);
    const edit = enterEdit(before, pos - 1, pos - 1);
    if (edit) applyEdit(ta, diffEdit(ta.value, applyEditToValue(before, edit), edit.selStart, edit.selEnd));
  });
  // 그림: 붙여넣기(글 없이 그림만 있을 때 — 워드에서 복사한 글은 그대로) · 끌어 놓기
  ta.addEventListener("paste", (e) => {
    const files = imageFiles(e.clipboardData && e.clipboardData.files);
    if (!files.length || (e.clipboardData.getData("text/plain") || "").trim()) return;
    e.preventDefault();
    insertFigures(ta, files);
  });
  view.addEventListener("dragover", (e) => {
    if (e.dataTransfer && [...e.dataTransfer.items || []].some((it) => it.kind === "file" && /^image\//.test(it.type))) e.preventDefault();
  });
  view.addEventListener("drop", (e) => {
    const files = imageFiles(e.dataTransfer && e.dataTransfer.files);
    if (!files.length) return; // 워드 · 한글 문서는 앱 전체 처리(인용 넣기)로
    e.preventDefault();
    e.stopPropagation();
    insertFigures(ta, files);
  });
  view.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "/" || e.code === "Slash")) { e.preventDefault(); shortcutDialog(); }
  });
  $("[data-shortcuts]", view).onclick = () => shortcutDialog();
  $("[data-shortcuts-hint]", view).onclick = () => shortcutDialog();
  $("[data-figure]", view).onclick = async () => insertFigures(ta, await pickFiles({ accept: "image/*", multiple: true }));
  $("[data-table]", view).onclick = () => editTable(ta);
  // 미리보기의 그림 · 표를 누르면 편집기의 그 그림 줄을 고르거나 표 고치기 창
  const docClick = (e) => {
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    const tbl = e.target.closest(".doc-tbl[data-tbl-i]");
    const fig = !tbl && e.target.closest(".doc-fig[data-fig-i]");
    if (!tbl && !fig) return;
    e.preventDefault();
    if (tbl) {
      const t = findTables(ta.value)[Number(tbl.dataset.tblI)];
      if (!t) return toast("편집기에서 이 표를 찾지 못했어요. 표 안에 커서를 두고 [표]를 눌러 주세요");
      ta.setSelectionRange(t.from, t.from);
      return editTable(ta);
    }
    const at = findFigures(ta.value)[Number(fig.dataset.figI)];
    if (at) selectRange(view, ta, at.altFrom, at.altTo);
  };
  $("[data-doc]", view).addEventListener("click", docClick);
  $("[data-doc]", view).addEventListener("keydown", docClick);

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
    else if (k === "h2" || k === "h3") applyEdit(ta, headingEdit(ta.value, ta.selectionStart, k === "h2" ? 2 : 3));
    else if (k === "list" || k === "olist") applyEdit(ta, toggleListEdit(ta.value, ta.selectionStart, ta.selectionEnd, k === "olist"));
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
    store.set("paperlab.writeView", b.dataset.v);
  }));
  $$("[data-view] button", view).forEach((x) => x.classList.toggle("active", x.dataset.v === viewMode));
  // 참고 패널 (docs/specs/writing-reference-pane.md): 넣기는 insertText 하나로, 서재 추가 뒤에는 목록 · 미리보기를 새로
  W.ref = refPane(view, $("#ref-pane", view), {
    mid: m.id, ta,
    insert: (text) => insertText(ta, text),
    pick: (onPick) => citePicker(ta, null, { multi: false, onPick }),
    papers: () => W.papers,
    built: () => W.built,
    libraryChanged: async () => {
      await libraryPapers(true).catch(() => {});
      if (W.m === m) await renderPreview(view, ta);
    },
  });
  $("[data-ref-toggle]", view).onclick = () => W.ref && W.ref.toggle();
  // 3단계 인용 검증 (시안 6장)
  W.vd = { data: null, marks: new Map(), stop: null, running: false };
  $("[data-verify]", view).onclick = () => runVerify(view, ta);
  $("[data-verify-box]", view).addEventListener("click", (e) => {
    const claim = e.target.closest("[data-vd-claim]");
    if (claim) return selectClaim(view, ta, Number(claim.dataset.vdClaim));
    const ev = e.target.closest("[data-vd-ev]");
    if (ev && W.ref) W.ref.open(Number(ev.dataset.paper), { page: Number(ev.dataset.page), peek: true });
    if (e.target.closest("[data-verify-again]")) runVerify(view, ta);
  });
  const docEl = $("[data-doc]", view);
  const fromPreview = (e) => {
    const mk = e.target.closest(".cite-vd[data-vd-claim]");
    if (!mk || (e.type === "keydown" && e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    selectClaim(view, ta, Number(mk.dataset.vdClaim));
  };
  docEl.addEventListener("click", fromPreview);
  docEl.addEventListener("keydown", fromPreview);
  loadVerify(view, ta);
  $("[data-cites]", view).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ref-open]");
    if (b && W.ref) W.ref.open(Number(b.dataset.refOpen));
  });
  W.fmt = { id: fmtId, entry: null, data: null };
  setFormat(view, fmtId);
  refresh();
  renderPreview(view, ta);
  // 서재 목록이 오면 왼쪽 "이 원고의 인용"을 누를 수 있는 줄로 다시 그림
  libraryPapers(true).then(() => { if (W.m === m && W.built) drawCites(view, W.built); }).catch(() => {});
  ta.focus();
  // AI 글쓰기 결과 (2026-10-16 백그라운드 AI): 진행 중 · 넣지 않은 결과 단추 + 알림 [열기]로 온 주소(#/write/원고/j작업)
  W.ai = aiResultsBar(view, ta, m);
  openAiJobFromHash(m, ta);
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
  try { list = await listFormats(); } catch (e) { return errorToast(e); }
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
    <code>@${esc(p.citekey)}</code><span>${esc((p.title || "").slice(0, 70))}</span><span class="muted">${esc(p.year || "")}</span>
    <button type="button" class="btn sm cs-peek" data-ref-peek tabindex="-1" title="참고 패널에서 보기 (${PEEK_KEY})">보기</button></div>`).join("")
    + `<div class="cs-hint">↑↓ 고르기 · Enter/Tab 넣기 · ${PEEK_KEY} 옆에 보기 · Esc 닫기</div>`;
  $$(".cs-item", SG.box).forEach((row) => row.addEventListener("mousedown", (e) => {
    e.preventDefault();
    SG.active = Number(row.dataset.i);
    acceptSuggest(ta);
  }));
  // [보기]: 넣지 않고 참고 패널에서 보기 — 줄의 넣기가 같이 일어나지 않게, 원고 초점도 그대로
  $$("[data-ref-peek]", SG.box).forEach((b) => b.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    SG.active = Number(b.closest(".cs-item").dataset.i);
    peekSuggest(ta);
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

// 자동완성에서 고른 논문을 참고 패널에서 보기(넣지 않음 — 목록 · 원고 입력 초점 그대로)
function peekSuggest(ta) {
  const p = SG.items[SG.active];
  if (!p || !W.ref) return;
  W.ref.open(p.id, { peek: true, title: p.title || "" });
  autocomplete(ta);
}

function suggestKey(e, ta) {
  if (!SG.box) return false;
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
    e.preventDefault();
    peekSuggest(ta);
    return true;
  }
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
    hydrateFigures(doc, W.m.id);
    drawCites(view, built);
    if (W.ref) W.ref.citesChanged();
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
    // 긴 제목은 말줄임으로 잘리므로 마우스를 올리면 전체 제목이 보이게
    const b = el(`<button class="outline-item" style="padding-left:${(h.level - 1) * 12 + 6}px" title="${esc(h.text)}">${esc(h.text)}</button>`);
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
  const body = text.replace(CITE_RE, "").replace(/!\[((?:\\.|[^\]\\])*)\]\(fig:[^)\s]*\)(?:\{#[^}]*\})?/g, "$1") // 그림 줄은 캡션 글만
    .replace(/^#+\s.*$/gm, "").replace(/[*_>`#|-]/g, "");
  const chars = body.replace(/\n/g, "").length;
  const noSpace = body.replace(/\s/g, "").length;
  const words = (body.match(/\S+/g) || []).length;
  const cites = (text.match(CITE_RE) || []).length;
  $("[data-status-text]", view).textContent =
    `글자 ${chars.toLocaleString("ko-KR")}자 (공백 제외 ${noSpace.toLocaleString("ko-KR")}자) · 단어 ${words.toLocaleString("ko-KR")}개 · 인용 ${cites}곳`;
}

// ------------------------------------------------------------------ 인용 검증 (3단계 12장 · 시안 6장)
async function loadVerify(view, ta) {
  const m = W.m;
  let data;
  try { data = await api.get(`/api/manuscripts/${m.id}/verify`); } catch { return; }
  if (W.m !== m) return;
  showVerify(view, ta, data);
}

async function runVerify(view, ta) {
  const m = W.m;
  const btn = $("[data-verify]", view);
  if (W.vd.running) return;
  W.vd.running = true;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>검증 중…</span>`;
  try {
    if (W.saver) await W.saver.flush(); // 저장되지 않은 글은 먼저 저장
    const data = await api.post(`/api/manuscripts/${m.id}/verify`, {});
    if (W.m !== m) return;
    showVerify(view, ta, data, { announce: !(data.job && ["queued", "running"].includes(data.job.status)) });
  } catch (e) {
    errorToast(e);
  } finally {
    if (W.m === m) {
      W.vd.running = false;
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
      btn.innerHTML = `${ICON_VERIFY}<span>인용 검증</span>`;
    }
  }
}

function showVerify(view, ta, data, { announce = false } = {}) {
  const vd = W.vd;
  if (!vd) return;
  vd.data = data;
  vd.marks = verifyMarks(data.items);
  drawVerify(view, ta);
  renderPreview(view, ta);
  if (announce) sayWriter(view, verifyDoneText(data.counts));
  const job = data.job;
  if (vd.stop) { vd.stop(); vd.stop = null; }
  if (isActive(job)) {
    const me = vd;
    vd.stop = watchJob(job.id, (j) => {
      if (W.vd !== me || !j) return;
      me.data.job = j;
      if (["queued", "running"].includes(j.status)) return drawVerify(view, ta);
      me.stop = null;
      handledJob(j.id); // 이 원고 화면이 결과를 그리고 알림 — 끝남 토스트 · 브라우저 알림을 겹치지 않음
      api.get(`/api/manuscripts/${W.m.id}/verify`).then((d) => {
        if (W.vd !== me) return;
        showVerify(view, ta, d, { announce: j.status === "succeeded" });
      }).catch(() => {});
    }, { first: job });
  }
}

function sayWriter(view, text) {
  const live = $("[data-ref-live]", view);
  if (!live) return;
  live.textContent = "";
  setTimeout(() => { if (live.isConnected) live.textContent = text; }, 60);
}

function drawVerify(view, ta) {
  const box = $("[data-verify-box]", view);
  const head = $("#vd-h", view);
  const sum = $("[data-verify-sum]", view);
  const data = W.vd && W.vd.data;
  const job = data && data.job;
  const has = data && (data.items.length || job);
  box.classList.toggle("hidden", !has);
  head.classList.toggle("hidden", !has);
  const sumText = has && window.matchMedia("(max-width: 1100px)").matches ? verifySummary(data.counts) : ""; // 왼쪽 칸이 숨는 폭만 (AD-4)
  sum.textContent = sumText ? `· ${sumText}` : "";
  if (!has) { box.innerHTML = ""; return; }
  box.innerHTML = "";
  if (data.unverified) {
    const n = el(`<div class="notice" data-tone="warn" data-verify-stale>${ICON_WARN}<div>원고가 바뀌었어요 — 새로 쓴 인용 ${data.unverified}개는 아직 검증 전이에요. <button type="button" class="link" data-verify-again>다시 검증</button></div></div>`);
    box.appendChild(n);
  }
  if (isActive(job)) {
    const line = statusLineEl(async () => { try { await cancelJob(job.id); } catch (e) { errorToast(e); } });
    line.dataset.verifyJob = "";
    setStatusLine(line, job, "확인");
    const pending = (data.counts || {}).pending || 0;
    if (pending) $(".grow", line).textContent = `문장 ${pending}개를 AI가 확인하고 있어요 · ${$(".grow", line).textContent}`;
    box.appendChild(line);
  } else if (job && job.status === "succeeded" && job.result && job.result.remaining) {
    box.appendChild(el(`<div class="notice" data-tone="info">${ICON_INFO}<div>남은 ${job.result.remaining}개는 [인용 검증]을 다시 누르면 확인해요.</div></div>`));
  } else if (job && job.status === "failed" && (data.counts || {}).pending) {
    box.appendChild(el(`<div class="status-line bad">${ICON_WARN}<span class="grow">${esc(job.error || "AI 판정을 하지 못했어요")}</span></div>`));
  }
  const counts = data.counts || {};
  const chips = el(`<div class="chips" aria-label="검증 결과 요약" style="margin:6px 0"></div>`);
  for (const [v, label] of [["unsupported", "근거 없음"], ["weak", "약함"], ["unchecked", "확인 못 함"], ["pending", "확인 중"], ["supported", "근거 있음"]]) {
    if (counts[v]) chips.appendChild(el(`<span class="chip" data-verdict="${v}"><span class="vd">${label} ${counts[v]}</span></span>`));
  }
  box.appendChild(chips);
  const sorted = sortVerify(data.items);
  const row = (it) => {
    const li = el(`<li class="cite-row" data-verdict="${esc(it.verdict)}" data-method="${esc(it.method)}"><span class="vd">${esc(vdName(it))}</span>
      <button type="button" class="graph-row-btn" data-vd-claim="${it.i}" title="편집기에서 이 문장 선택"></button></li>`);
    const b = $("button", li);
    b.textContent = `${it.sentence || ""} `;
    b.appendChild(el(`<code>@${esc(it.citekey)}</code>`));
    if (it.reason) { const r = el(`<span class="muted"></span>`); r.textContent = it.reason; li.appendChild(r); }
    const ev = (it.evidence || []).filter((e) => e.page);
    if (ev.length && it.paper_id) {
      const span = el(`<span class="muted">근거 후보 </span>`);
      for (const e of ev) {
        const p = el(`<button type="button" class="page-link" data-vd-ev data-paper="${Number(it.paper_id)}" data-page="${Number(e.page)}" title="참고 패널에서 p.${Number(e.page)} 열기">p.${Number(e.page)}</button>`);
        if (e.text) p.title += ` — ${e.text}`;
        span.append(p, " ");
      }
      li.appendChild(span);
    }
    return li;
  };
  const problems = sorted.filter((it) => it.verdict !== "supported");
  if (problems.length) {
    const ol = el(`<ol class="graph-items" aria-labelledby="vd-h"></ol>`);
    problems.forEach((it) => ol.appendChild(row(it)));
    box.appendChild(ol);
  }
  const good = sorted.filter((it) => it.verdict === "supported");
  if (good.length) {
    const det = el(`<details><summary class="small">근거 있음 ${good.length}개 보기</summary><ol class="graph-items"></ol></details>`);
    good.forEach((it) => $("ol", det).appendChild(row(it)));
    box.appendChild(det);
  }
}

// 편집기에서 그 문장 선택 · 스크롤 · 초점 (편집 보기가 숨어 있으면 나란히 보기로 — 6.2절)
function selectClaim(view, ta, i) {
  const it = W.vd && W.vd.data && W.vd.data.items[i];
  if (!it) return;
  if (view.classList.contains("view-preview")) {
    const split = $('[data-view] button[data-v="split"]', view);
    if (split) split.click();
  }
  ta.focus();
  ta.setSelectionRange(it.start, it.end);
  ta.blur(); // 커서 위치로 스크롤 (drawOutline과 같은 방법)
  ta.focus();
  ta.setSelectionRange(it.start, it.end);
}

function drawCites(view, built) {
  const box = $("[data-cites]", view);
  const keys = [...new Set(built.clusters.flatMap((c) => c.items.map((it) => it.key)))];
  if (!keys.length) {
    box.innerHTML = `<div class="muted">＋ 인용 넣기나 [@ 로 서재의 논문을 인용하세요</div>`;
    return;
  }
  box.innerHTML = "";
  const byKey = new Map((W.papers || []).map((p) => [p.citekey, p]));
  const cur = W.ref ? W.ref.currentId() : null;
  for (const k of keys) {
    const it = built.items[k];
    const issues = (built.issues || {})[k] || [];
    const warn = issues.length ? `<span class="warn-text">빈 항목: ${esc(issues.join(", "))}</span>` : "";
    const p = it && byKey.get(k);
    if (p) { // 서재에 있는 키: 누르면 참고 패널에서 그 논문
      box.appendChild(el(`<button type="button" class="cite-row" data-ref-open="${p.id}" ${p.id === cur ? `aria-current="true"` : ""}
        title="${esc(`참고 패널에서 보기 · ${it.title || ""}`)}"><code>@${esc(k)}</code><span class="muted">${esc((it.title || "").slice(0, 60))}</span>${warn}</button>`));
    } else {
      box.appendChild(el(`<div class="cite-row ${it ? "" : "missing"}" title="${esc(it ? it.title : "서재에 이 인용 키를 가진 논문이 없어요")}">
        <code>@${esc(k)}</code><div class="muted">${it ? esc((it.title || "").slice(0, 60)) : "⚠ 서재에 없는 키"}</div>${warn}</div>`));
    }
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

// ------------------------------------------------------------------ 그림 · 표 (docs/specs/writing-figures-tables.md)
const koDoc = (ta) => /[가-힣]/.test(ta.value) || !ta.value.trim();

// 편집기에서 a~b를 고르고 그 자리로 스크롤 (미리보기만 보이면 나란히 보기로)
function selectRange(view, ta, a, b) {
  if (view.classList.contains("view-preview")) $('[data-view] button[data-v="split"]', view)?.click();
  ta.focus();
  ta.setSelectionRange(a, a);
  ta.blur();
  ta.focus();
  ta.setSelectionRange(a, b);
}

// 그림 올리기 → 커서 자리에 ![그림 설명](fig:이름) 문단. 마지막 그림의 '그림 설명'을 골라 바로 고쳐 쓰게
async function insertFigures(ta, files) {
  const m = W.m;
  const list = imageFiles(files).slice(0, 10);
  if (!m || !list.length) return;
  const desc = koDoc(ta) ? "그림 설명" : "Figure caption";
  let at = null;
  for (const f of list) {
    toast(`그림을 올리는 중이에요${f.name ? ` — ${f.name}` : ""}`);
    let r;
    try { r = await uploadFigure(m.id, f); } catch (e) { errorToast(e); continue; }
    if (W.m !== m || !ta.isConnected) return;
    const s = at ?? ta.selectionStart;
    const e = at ?? ta.selectionEnd;
    const edit = blockInsert(ta.value, s, e, figureMarkdown(r.name, desc), [2, 2 + desc.length]);
    applyEdit(ta, edit);
    at = edit.from + edit.text.length;
  }
}

// 표 넣기 · 고치기: 커서가 표(또는 바로 위 캡션 줄) 안이면 그 표를 고치고, 아니면 크기를 골라 새 표
async function editTable(ta) {
  const ko = koDoc(ta);
  const tables = findTables(ta.value);
  const found = tableAt(ta.value, ta.selectionStart);
  const idx = found ? tables.findIndex((t) => t.from === found.from) : -1;
  const [s, e] = [ta.selectionStart, ta.selectionEnd];
  let table = found;
  if (!found) {
    const size = await tableSizeDialog();
    if (!size) return;
    table = newTable(size.rows, size.cols, ko);
  }
  const res = await tableDialog(table, { existing: !!found });
  if (!res || W.ta !== ta) return;
  if (!found) {
    applyEdit(ta, blockInsert(ta.value, s, e, tableMarkdown(res.table, ko), [0, 0]));
    return;
  }
  const t = findTables(ta.value)[idx]; // 창을 연 동안 원고가 바뀌었을 수 있어 다시 찾는다
  if (!t) return toast("원고에서 이 표를 찾지 못했어요", "error");
  const from = t.captionFrom ?? t.from;
  if (res.action === "delete") {
    const v = ta.value;
    // 표 앞뒤의 빈 줄이 겹치지 않게 뒤쪽 줄바꿈도 함께 지운다
    const lead = from === 0 || v[from - 1] === "\n";
    const to = lead && v.startsWith("\n\n", t.to) && (from < 2 || v.startsWith("\n\n", from - 2)) ? t.to + 2
      : lead && v[t.to] === "\n" ? t.to + 1 : t.to;
    applyEdit(ta, { from, to, text: "", selStart: from, selEnd: from });
    return toast("표를 지웠어요 — Ctrl+Z로 되돌릴 수 있어요");
  }
  applyEdit(ta, { from, to: t.to, text: tableMarkdown(res.table, ko), selStart: from, selEnd: from });
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
  const box = el(`<div class="cite-picker" role="dialog" aria-label="인용 고르기">
    <div class="row"><input class="input grow" placeholder="제목·저자·연도·인용 키로 찾기" aria-label="인용할 논문 찾기"><button class="icon-btn" data-x aria-label="닫기">✕</button></div>
    <div class="cp-list"></div>
    <div class="row cp-foot"><input class="input" data-loc placeholder="쪽 (선택)" aria-label="쪽 (선택)" style="width:90px">
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
        <input type="checkbox" aria-label="${esc(p.title || p.citekey)} 고르기" ${chosen.has(p.citekey) ? "checked" : ""}>
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
    else if (e.key === " " && e.ctrlKey && shown[active]) {
      e.preventDefault();
      const k = shown[active].citekey;
      chosen.has(k) ? chosen.delete(k) : chosen.add(k);
      draw(); count();
    }
  };
  // Esc: 이 상자만 닫음 (뒤의 창 · 편집 화면의 Esc로 넘기지 않음)
  box.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } });
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

// 문장 끝맺음 (2026-10-17 사용자 지적: '학술 문체로 · 다듬기'가 개조식 '~함 · ~했음'을 '~이다'로 바꿈).
// 원고마다 이 브라우저에 기억하고, 글을 새로 쓰는 모드의 추가 요청 맨 앞에 규칙을 붙인다(서버 2000자 자르기에도 남게)
const ENDINGS = [["keep", "원문 유지"], ["bullet", "개조식 (~함 · ~임 · ~했음)"], ["plain", "서술체 (~이다 · ~한다)"]];
const ENDING_RULES = {
  keep: "문장 끝맺음은 원문을 따르세요. 원문이 개조식('~함', '~임', '~했음', '~됨')이면 개조식으로, 서술체('~이다', '~한다')면 "
    + "서술체로 쓰고 끝맺음 방식을 바꾸지 마세요.",
  bullet: "모든 문장을 개조식으로 끝맺으세요. '~함', '~임', '~했음', '~됨', '~필요함'처럼 명사형으로 끝내고 '~이다', '~한다', "
    + "'~합니다'로 끝내지 마세요.",
  plain: "모든 문장을 서술체로 끝맺으세요. '~이다', '~한다'로 끝내고 '~합니다', '~함', '~임'으로 끝내지 마세요.",
};
const ENDING_MODES = new Set(["polish", "academic", "concise", "expand", "to_ko", "continue", "draft"]);
const endingKey = () => `paperlab.ending.${W.m ? W.m.id : 0}`;
function getEnding() {
  try { const v = localStorage.getItem(endingKey()); return ENDING_RULES[v] ? v : "keep"; } catch { return "keep"; }
}
function setEnding(v) {
  try { localStorage.setItem(endingKey(), v); } catch { /* 저장소 없음 — 이번만 */ }
  toast(`AI 끝맺음: ${ENDINGS.find((x) => x[0] === v)[1]}`);
}

function aiMenu(anchor, ta) {
  const cur = getEnding();
  popupMenu(anchor, [
    ...AI_MODES.map((m) => (m === "-" ? "-" : { label: m[1], action: () => runAi(m[0], ta) })),
    "-",
    ...ENDINGS.map(([v, label]) => ({ label: `끝맺음: ${label}`, sub: v === cur ? "✓ 사용 중" : "", action: () => setEnding(v) })),
  ], { left: true });
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

// 글쓰기 도우미 = 서버 작업 (2026-10-16 백그라운드 AI): 창 · 탭 · 앱을 닫아도 내 API 키(서버) · 연결된 내 PC(CLI)에서 끝까지
// 실행하고 결과는 7일 동안 남는다. 끝나면 알림(jobs.js), 결과는 이 창 · 원고의 "AI 결과" 줄 · 작업 화면에서 열어 넣는다.
// 넣을 때 그 사이 원고가 바뀌었으면 바뀌는 부분을 보여 주고 물어본 뒤에만 바꾼다 (writeai.js — 새 글을 몰래 덮어쓰지 않음)
const MODE_LABEL = Object.fromEntries(AI_MODES.filter((x) => x !== "-"));

async function runAi(mode, ta) {
  // 글쓰기 도우미 경로 기준 (요약 경로 기준인 ready가 아니라 kinds.write — 품질팀 M2). 없으면 연결된 PC · API 키 안내
  if (!(await ensureAiRoute("write"))) return;
  let { s, e, text } = selectionOrParagraph(ta);
  let keys = [...new Set((text.match(CITE_RE) || []).flatMap((raw) => (parseCitation(raw.slice(1, -1)) || []).map((it) => it.key)))];
  let instruction = "";
  const insert = mode === "continue" || mode === "draft";
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
  if (ENDING_MODES.has(mode)) instruction = [ENDING_RULES[getEnding()], instruction].filter(Boolean).join("\n");
  if (!insert) ({ s, e } = trimRange(ta.value, s, e)); // 서버는 글을 trim해서 저장 — 범위도 같은 글을 가리키게
  const context = mode === "draft" ? ta.value.slice(0, 3000) : "";
  let job;
  try {
    job = (await api.post("/api/ai/write", { mode, text, keys, instruction, context, manuscript_id: W.m ? W.m.id : null,
      ...writeAnchor(ta.value, s, e, insert) })).job;
  } catch (err) {
    return errorToast(err);
  }
  trackJob(job);
  aiJobDialog(job, ta, { fresh: true });
  if (W.ai) W.ai.refresh();
}

// 작업 하나를 따라가는 창: 진행 · 중간 글 · [취소] → 결과 · [바꾸기] · [고쳐서 넣기] · [넣지 않기]. 창을 닫아도 작업은 계속
function aiJobDialog(first, ta, { fresh = false } = {}) {
  const m = W.m;
  const w = first.write || {};
  const here = !!m && Number(first.manuscript_id) === m.id;
  const body = el(`<div><div class="small muted" style="margin-bottom:8px" data-ai-head></div>
    <div class="notice" data-tone="info" data-ai-bg>${ICON_INFO}<div data-ai-bg-text>창을 닫아도 작업은 계속돼요. 끝나면 알려 드리고, 결과는 이 원고의 <b>AI 결과</b>와 작업 화면에서 다시 열 수 있어요.</div></div>
    <div data-ai-line style="margin-top:8px"></div>
    <div class="ai-out prose" style="margin-top:8px"></div>
    <textarea class="input hidden" style="width:100%;min-height:240px;margin-top:8px" aria-label="넣을 글 고치기"></textarea></div>`);
  $("[data-ai-head]", body).textContent = `${MODE_LABEL[w.mode] || "AI 글쓰기"} · ${fmtClock(first.created_at)} 시작`;
  const offer = fresh ? notifyOffer() : null;
  if (offer) $("[data-ai-bg]", body).after(offer);
  const foot = el(`<div style="display:contents"><div class="left"><button class="btn" data-edit disabled>고쳐서 넣기</button><button class="btn" data-copy disabled>복사</button></div>
    <button class="btn" data-dismiss disabled title="결과를 원고에 넣지 않아요. 작업 화면에서 7일 동안 다시 열 수 있어요">넣지 않기</button>
    <button class="btn" data-no>닫기</button><button class="btn primary" data-ok disabled>${w.insert ? "넣기" : "바꾸기"}</button></div>`);
  let stop = null;
  const dlg = modal({ title: "AI 글쓰기 도우미", body, foot, wide: true, onClose: () => stop && stop() });
  const out = $(".ai-out", body);
  const edit = $("textarea", body);
  const bgText = $("[data-ai-bg-text]", body);
  let job = first;
  let result = "";
  const line = statusLineEl(async () => {
    try { await cancelJob(job.id); } catch (err) { errorToast(err); }
  });
  $("[data-ai-line]", body).appendChild(line);
  const showResult = () => {
    out.style.whiteSpace = "normal";
    out.innerHTML = purifyMd(window.marked.parse(result)) ?? esc(result);
  };
  // 목록에서 온 작업(원래 글 · 자리 정보가 없음)은 한 작업 보기를 먼저 받는다 — 넣을 자리를 찾는 데 필요
  const follow = (start) => {
    const detailed = !!(start.write && "text" in start.write);
    stop = watchJob(start.id, (j) => {
      if (!j) {
        line.remove();
        out.innerHTML = `<div class="msg error">작업을 찾을 수 없어요. 7일이 지나 지워졌을 수 있어요.</div>`;
        return;
      }
      job = j;
      if (j.status === "succeeded") {
        line.remove();
        result = (j.result && j.result.text) || "";
        if (!result) { out.innerHTML = `<div class="msg error">결과 글이 지워졌어요 (7일 보관).</div>`; return; }
        handledJob(j.id); // 이 창에서 결과를 봤음 — 끝남 토스트는 생략
        showResult();
        const done = j.write && j.write.handled;
        bgText.textContent = done === "applied" ? "이미 원고에 넣은 결과예요. 다시 넣으면 지금 원고에서 자리를 다시 찾아요."
          : here ? "결과가 준비됐어요. 넣기 전에 확인해 주세요 — 그 사이 원고가 바뀌었으면 바뀌는 부분을 먼저 보여 드려요."
            : "다른 원고의 결과예요. 그 원고를 열어 넣거나 복사해 주세요.";
        for (const b of ["[data-edit]", "[data-copy]", "[data-dismiss]"]) $(b, foot).disabled = false;
        $("[data-ok]", foot).disabled = !here;
        $("[data-dismiss]", foot).disabled = !!done;
        return;
      }
      if (j.status === "failed" || j.status === "cancelled") {
        line.remove();
        out.innerHTML = `<div class="msg error">${esc(j.status === "failed" ? j.error || "글을 만들지 못했어요" : "작업을 취소했어요")}</div>`;
        bgText.textContent = j.status === "failed" ? "실패한 작업이에요. 다시 시도하면 같은 글로 새 작업을 만들어요." : "취소한 작업이에요.";
        if (!$("[data-job-retry]", foot)) {
          const again = el(`<button type="button" class="btn" data-job-retry>다시 시도</button>`);
          again.onclick = async () => {
            again.remove();
            try {
              const r = await retryJob(j.id);
              trackJob(r.job);
              out.innerHTML = "";
              $("[data-ai-line]", body).appendChild(line);
              follow(r.job);
              if (W.ai) W.ai.refresh();
            } catch (err) { errorToast(err); }
          };
          $(".left", foot).appendChild(again);
        }
        return;
      }
      const partial = (j.progress || {}).partial_text || "";
      if (partial) out.textContent = partial;
      else if (!out.textContent) out.innerHTML = `<span class="typing"><span></span><span></span><span></span></span>`;
      setStatusLine(line, j, "글을 만드는");
      if (j.status === "running" && j.runner === "cli") $(".grow", line).textContent = `${j.device ? `‘${j.device.name}’` : "내 PC"}에서 글을 만드는 중 (${engineName(j.engine)})`;
    }, detailed ? { first: start } : {});
  };
  follow(first);
  $("[data-edit]", foot).onclick = () => { edit.value = result; edit.classList.remove("hidden"); out.classList.add("hidden"); edit.focus(); };
  $("[data-copy]", foot).onclick = () => copyText(edit.classList.contains("hidden") ? result : edit.value);
  $("[data-no]", foot).onclick = () => dlg.close();
  $("[data-dismiss]", foot).onclick = async () => {
    try { await api.post(`/api/jobs/${job.id}/handled`, { state: "dismissed" }); } catch (err) { return errorToast(err); }
    dlg.close();
    toast("넣지 않았어요. 작업 화면에서 7일 동안 다시 열 수 있어요");
    if (W.ai) W.ai.refresh();
  };
  $("[data-ok]", foot).onclick = async () => {
    if (!here || W.m !== m || W.ta !== ta) return toast("이 원고가 열려 있을 때만 넣을 수 있어요", "error");
    const finalText = edit.classList.contains("hidden") ? result : edit.value;
    if (!(await applyAiResult(job, finalText, ta))) return;
    dlg.close();
    api.post(`/api/jobs/${job.id}/handled`, { state: "applied" }).catch(() => {}).then(() => W.ai && W.ai.refresh());
  };
  return dlg;
}

// 결과를 원고에 넣기. 원고가 그대로면 바로, 바뀌었으면 바뀌는 부분을 보여 주고 물어봄, 자리를 못 찾으면 커서 위치에 넣기 · 복사만
async function applyAiResult(job, text, ta) {
  const w = job.write || {};
  const cur = ta.value;
  const plan = planApply(cur, w);
  if (plan.state === "lost") return aiLostDialog(text, ta, !!w.insert);
  const next = insertionText(cur, plan.from, text, w.insert);
  if (plan.state === "moved") {
    const ok = await aiDiffDialog(cur, plan, next, !!w.insert);
    if (!ok) return false;
    if (ta.value !== cur) { // 물어보는 동안 또 바뀜 — 처음부터 다시 확인
      toast("그 사이 원고가 또 바뀌었어요. 다시 확인해 주세요");
      return applyAiResult(job, text, ta);
    }
  }
  ta.focus();
  ta.setSelectionRange(plan.from, plan.to);
  insertText(ta, next);
  toast(w.insert ? "AI 결과를 넣었어요" : "AI 결과로 바꿨어요", "success");
  return true;
}

// 원고가 바뀐 뒤: 바뀌는 부분(지운 글 · 넣는 글)과 앞뒤 문맥을 보여 주고 물어봄
function aiDiffDialog(cur, plan, next, insert) {
  return new Promise((resolve) => {
    const seg = insert ? [{ op: "ins", text: next }] : wordDiff(plan.old, next);
    const before = cur.slice(Math.max(0, plan.from - 120), plan.from);
    const after = cur.slice(plan.to, plan.to + 120);
    const html = seg.map((x) => (x.op === "same" ? esc(x.text) : `<${x.op}>${esc(x.text)}</${x.op}>`)).join("");
    const body = el(`<div><p style="margin:4px 0 10px">작업을 시작한 뒤 원고가 바뀌었어요. ${insert ? "아래 자리에 결과를 넣을까요?" : "아래처럼 바꿀까요?"}
      바꾸기 전에 확인해 주세요.</p>
      <div class="ai-diff" aria-label="바뀌는 부분"><span class="muted">${before ? `…${esc(before)}` : ""}</span>${html}<span class="muted">${after ? `${esc(after)}…` : ""}</span></div>
      <p class="small muted ai-diff-legend" style="margin:8px 0 0"><del>지우는 글</del> · <ins>넣는 글</ins></p></div>`);
    const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button><button class="btn primary" data-yes>${insert ? "넣기" : "바꾸기"}</button></div>`);
    let ok = false;
    const m = modal({ title: "원고가 바뀌었어요", body, foot, wide: true, onClose: () => resolve(ok) });
    $("[data-no]", foot).onclick = () => m.close();
    $("[data-yes]", foot).onclick = () => { ok = true; m.close(); };
  });
}

// 원래 글(넣을 자리)을 지금 원고에서 찾지 못함 — 자동으로 바꾸지 않고 [커서 위치에 넣기](덮어쓰지 않음) · [복사]만
function aiLostDialog(text, ta, insert) {
  return new Promise((resolve) => {
    const body = el(`<div><p style="margin:4px 0 8px">작업을 시작한 뒤 원고가 바뀌어 ${insert ? "넣을 자리를" : "바꿀 글을"} 찾지 못했어요.
      원고를 덮어쓰지 않도록 자동으로 바꾸지 않았어요.</p><p class="small muted" style="margin:0">커서 위치에 새로 넣거나, 복사해서 직접 붙여 넣어 주세요.</p></div>`);
    const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button><button class="btn" data-copy>복사</button>
      <button class="btn primary" data-cursor>커서 위치에 넣기</button></div>`);
    let ok = false;
    const m = modal({ title: "원래 자리를 찾지 못했어요", body, foot, onClose: () => resolve(ok) });
    $("[data-no]", foot).onclick = () => m.close();
    $("[data-copy]", foot).onclick = () => { copyText(text); m.close(); };
    $("[data-cursor]", foot).onclick = () => {
      const at = ta.selectionEnd; // 고른 글을 덮어쓰지 않게 커서 뒤에
      ta.focus();
      ta.setSelectionRange(at, at);
      insertText(ta, insertionText(ta.value, at, text, true));
      ok = true;
      m.close();
    };
  });
}

// 원고 화면의 [AI 결과] 단추(도구 줄 — 편집 화면 격자를 바꾸지 않음): 이 원고의 진행 중 · 넣지 않은 글쓰기 결과(7일).
// 누르면 결과 창(여럿이면 목록)
function aiResultsBar(view, ta, m) {
  const btn = el(`<button type="button" class="btn sm hidden" data-ai-results aria-haspopup="dialog"
    title="창을 닫아도 AI 글쓰기는 계속되고, 결과는 7일 동안 남아요. 눌러서 확인하고 원고에 넣어요"></button>`);
  $("[data-ai]", view).closest(".menu-wrap").after(btn);
  let list = [];
  let timer = null;
  const refresh = async () => {
    clearTimeout(timer);
    let data;
    try { data = await api.get(`/api/jobs${qs({ status: "recent", kind: "write", manuscript_id: m.id, limit: 20 })}`); } catch { return; }
    if (W.m !== m) return;
    const active = data.jobs.filter((j) => isActive(j));
    const ready = data.jobs.filter((j) => j.status === "succeeded" && j.result && j.result.text && !(j.write && j.write.handled));
    list = [...active, ...ready];
    const parts = [ready.length ? `AI 결과 ${ready.length}` : "", active.length ? `만드는 중 ${active.length}` : ""].filter(Boolean);
    btn.classList.toggle("hidden", !parts.length);
    btn.textContent = parts.join(" · ");
    btn.classList.toggle("primary", ready.length > 0);
    if (active.length) timer = setTimeout(refresh, document.hidden ? 15000 : 5000);
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    if (list.length === 1) return aiJobDialog(list[0], ta);
    popupMenu(e.currentTarget, list.map((j) => ({
      label: `${MODE_LABEL[(j.write || {}).mode] || "AI 글쓰기"} · ${isActive(j) ? "만드는 중" : `${fmtClock(j.finished_at)} 끝남`}`,
      action: () => aiJobDialog(j, ta),
    })));
  };
  const onOpenJob = (e) => { // 끝남 알림 [열기] · 작업 화면 — 같은 원고면 다시 불러오지 않고 이 화면에서 연다
    const j = e.detail;
    if (!j || j.kind !== "write" || W.m !== m || Number(j.manuscript_id) !== m.id) return;
    e.preventDefault();
    aiJobDialog(j, ta);
  };
  window.addEventListener("paperlab:open-job", onOpenJob);
  refresh();
  return { refresh, destroy: () => { clearTimeout(timer); window.removeEventListener("paperlab:open-job", onOpenJob); } };
}

// #/write/원고/j작업 (끝남 알림 · 작업 화면에서 옴): 그 작업의 결과 창을 열고 주소는 원고 주소로 되돌림
async function openAiJobFromHash(m, ta) {
  const hit = location.hash.match(/^#\/write\/\d+\/j(\d+)$/);
  if (!hit) return;
  history.replaceState(history.state, "", `#/write/${m.id}`);
  let job;
  try { job = await api.get(`/api/jobs/${Number(hit[1])}`); } catch (err) { return errorToast(err); }
  if (W.m !== m) return;
  if (job.kind !== "write") return;
  aiJobDialog(job, ta);
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
      `서재에 없는 인용 키가 있어요: ${built.missingKeys.join(", ")}\n그대로 표시해서 내보낼까요?`, { ok: "그대로 내보내기" }))) return;
    const title = $("[data-title]", view).textContent.trim() || "원고";
    // manuscript_id: 서버가 이 원고의 그림 폴더에서 그림을 읽어 넣는다(그림 바이트는 보내지 않음)
    const payload = { format, blocks: stripWarn(built.blocks), meta: { title }, filename: title, manuscript_id: W.m.id };
    if (office && fmtId !== "default") {
      // 표지의 국문 제목 기본값은 원고의 # 제목 (없으면 빈 칸으로 두어 ○○○로 들어가게)
      Object.assign(payload, { doc_format: fmtId, cover: W.m.cover || {}, meta: { title: docTitle(ta) } });
    }
    const res = await api.raw("POST", "/api/export-document", payload);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "내보내지 못했어요");
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
  const clean = (runs) => runs.map(({ warn, cite, xref, ...r }) => r);
  return blocks.map((b) => {
    const out = b.runs ? { ...b, runs: clean(b.runs) } : { ...b };
    if (b.caption) out.caption = clean(b.caption); // 그림 · 표 캡션
    if (b.rows) out.rows = b.rows.map((row) => row.map(clean)); // 표 칸
    return out;
  });
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
        ${missing.length ? `<div class="status-line bad" style="margin-top:8px">서재에 없는 인용 키: ${missing.map((k) => `<code>${esc(k)}</code>`).join(", ")} — 표시를 그대로 남겨요</div>` : ""}
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
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "파일을 변환하지 못했어요");
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
