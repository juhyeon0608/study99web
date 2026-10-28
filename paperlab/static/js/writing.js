// 논문 쓰기: 원고 목록 · 마크다운 편집기 · 인용 넣기 · 서식 미리보기 · AI 글쓰기 도우미 · 참고 패널(refpane.js) ·
// 워드(.docx)·한글(.hwpx) 내보내기 · 워드·한글 문서의 [@인용키] 변환

import { api, downloadBlob, qs } from "./api.js";
import { sortVerify, vdName, verifyDoneText, verifyMarks, verifySummary } from "./ask.js";
import {
  cancelJob, engineName, ensureAiRoute, fmtClock, handledJob, isActive, notifyOffer, nudgeDesktop, retryJob, setStatusLine,
  statusLineEl, trackJob, watchJob,
} from "./jobs.js";
// AI 글쓰기 결과를 나중에 안전하게 넣기 (2026-10-16 백그라운드 AI) · 결과 패널 (2026-10-17 — 결과를 보면서 글쓰기)
import {
  RESULT_STATE_TEXT, applyPreview, browserStorage, clampPaneWidth, diffHtml, docHash, insertionText, loadPaneOpen, loadPaneWidth,
  origSnippet, paneActions, paneKeyAction, paneList, paneWidthCss, pickResult, planApply, rerunPlan, resultState,
  resultsButtonText, savePaneOpen, savePaneWidth, trimRange, wordDiff, writeAnchor,
} from "./writeai.js";
// 원고 AI 대화 · 장 · 절 일괄 처리 · AI 범위 (docs/specs/manuscript-ai-chat.md)
import { BATCH_MAX, BATCH_MODES, batchItems, isChatKey } from "./writechat.js";
import { batchView, chatView } from "./writechatui.js";
import { htmlToRuns, listStyles, renderClusters, styleOptions } from "./cite.js";
import {
  applyDocFormat, coverDialog, exportWarnings, formatManagerDialog, formatOptions, getFormat, listFormats, listsNotice,
  missingCoverFields, usesHancomFonts, warningText,
} from "./formats.js";
import { ICON_REF, refPane } from "./refpane.js";
import { CITE_RE, parseCitation } from "./refquote.js";
import { state } from "./state.js";
// 그림 · 표 · 캡션 · 목록 편집 · 단축키 도움말 (docs/specs/writing-figures-tables.md)
import {
  applyEditToValue, backspaceEdit, blockInsert, captionInfo, captionLabel, diffEdit, enterEdit, figureInfo, figureMarkdown, findFigures,
  findTables, headingEdit, indentEdit, inFence, isFrontMatter,
  newTable, outlineText, resolveXrefs, splitXrefs, tableAt, tableMarkdown, toggleListEdit,
  SCOPE_KINDS, aiScope, scopeSummary,
} from "./writeedit.js";
import {
  applyEdit, hydrateFigures, imageFiles, revokeFigureUrls, shortcutDialog, tableDialog, tableSizeDialog, uploadFigure,
} from "./writetools.js";
import { equationInfo, equationPng, katexHtml, MATH_MARK_RE, protectInlineMath, texToText } from "./writemath.js"; // 수식
import { CHECK_RE, useLenientEmphasis, wrapParts } from "./writemd.js";
import { claimAt, markerIndex } from "./writesrc.js"; // 출처 확인 (2026-10-26)
import { tableFromCells, tableFromTsv } from "./writepaste.js"; // 표 붙여넣기 (2026-10-27)
import { redlineMarkdown } from "./writeredline.js"; // 수정 표시 워드 (2026-10-27)
import { slidesHtml } from "./writeslides.js"; // 발표 자료 (2026-10-27)
import { openCommentCount, shareDialog } from "./writeshareui.js"; // 공유 링크 · 받은 의견 (2026-10-27)
import { reviewView } from "./writereviewui.js"; // 검토본 · 교수님 의견 빨간색 (2026-10-28)
import { chapterCounts, dayKey, goalSummary, hasGoals, plainBody } from "./writegoals.js"; // 분량 · 일정 목표 (2026-10-27)
import { JOURNAL_LABELS, JOURNAL_NUM_KEYS, cleanJournal, parseJournal } from "./writejournal.js"; // 투고 규정 (2026-10-27)
import { matchDialog } from "./writematchui.js"; // 서재 대조: 인용 빠짐 · 표절 미리 점검 (2026-10-27)
import { statsDialog } from "./writestatsui.js";
import { guardNotes } from "./writeguard.js"; // AI 결과의 숫자 · 인용 대조 (2026-10-28) // 통계 계산 → APA 표 (2026-10-28)
import { registerCommands } from "./palette.js"; // 명령 팔레트 Ctrl+K (2026-10-28)
import { moveSection, sections } from "./writeoutline.js"; // 개요에서 장 · 절 옮기기 (2026-10-28)
import { sourceView } from "./writesrcui.js"; // 한글 조사 옆 굵게 · 기울임
import { historyTools, saveVersion } from "./writehistui.js"; // 버전 기록 (docs/specs/manuscript-history.md)
// 각주 [^1] · "[^1]: 내용" 읽기와 [각주] 넣기 (docs/specs/export-lists-footnotes.md)
import { extractFootnotes, footnoteInsert, splitNotes } from "./writenotes.js";
import { checkPanel } from "./writecheckui.js"; // 제출 전 점검표 (docs/specs/writing-checklist.md)
import { figPane } from "./writefigui.js"; // 그림 만들기 · 자연어로 고치기 (docs/specs/writing-figure-ai.md)
import { AI_GROUPS, ENDING_MODES, SCOPE_MODES, flatChoices } from "./writeaimenu.js"; // AI 도우미 묶음 (2026-10-28 버튼 정리)
import { aiGroupDialog } from "./writeaimenuui.js";
// 맞춤법 · 띄어쓰기 점검 패널 · 영문/국문 초록 만들기 (docs/specs/writing-proofread.md)
import { ABSTRACT_MODES, withAbstractHeading } from "./writeproof.js";
import { proofPanel, startAbstract } from "./writeproofui.js";
import {
  $, $$, ICON_INFO, ICON_WARN, authorsShort, confirmDialog, copyText, debounce, el, errorToast, esc, fmtDate, modal, modalOpen,
  pickFiles, popupMenu, purifyMd, store, toast,
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
async function buildDocument(text, { style, locale, koreanFirst, chapterNumbers = false } = {}) {
  useLenientEmphasis(window.marked); // "**연구(2020)**에서"도 굵게 (writemd.js)
  const { src: prepared, clusters, bibTitle } = prepare(text);
  // 각주: 본문 [^이름] → 자리표시, 정의 줄([^이름]: …)은 뺀다. 인용 자리표시를 먼저 매겨 인용 순번은 원고 글 순서 그대로
  const { text: src, notes } = extractFootnotes(prepared);
  // 문장 안 수식 $…$ → 자리표시 (마크다운이 _ · * 를 서식으로 읽지 않게 — writemath.js)
  const { text: mathSrc, maths } = protectInlineMath(src);
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
  // 각주 런 { footnote: [런…] } — 각주 글 안의 각주(각주식 인용 스타일)는 글로 펼친다
  const noteCache = new Map();
  const noteRun = (n) => {
    if (!noteCache.has(n)) {
      const runs = notes[n] ? inline(window.marked.Lexer.lexInline(notes[n].text)) : [];
      noteCache.set(n, runs.flatMap((r) => (r.footnote ? r.footnote : [r])));
    }
    return { footnote: noteCache.get(n).map((r) => ({ ...r })) };
  };
  const textRuns = (whole, fmt) => {
    const out = [];
    for (const s of splitNotes(whole)) {
      if (typeof s !== "string") { out.push(noteRun(s.note)); continue; }
      s.split(MATH_MARK_RE).forEach((seg, mi) => {
        if (mi % 2) { const tex = maths[Number(seg)] || ""; out.push({ text: texToText(tex), ...fmt, math: tex }); return; }
        seg.split(/(\d+)/).forEach((part) => {
          const m = part.match(/^(\d+)$/);
          if (m) out.push(...clusterRuns(Number(m[1]), fmt));
          else if (part) {
            // @fig:이름 · @tbl:이름 상호 참조는 번호를 다 매긴 뒤 채운다(resolveXrefs)
            for (const x of splitXrefs(part)) out.push(typeof x === "string" ? { text: x, ...fmt } : { text: "", ...fmt, xref: x.xref });
          }
        });
      });
    }
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
      else if (t.type === "html" && /^<br\s*\/?>$/i.test(t.text.trim())) runs.push({ text: "\n", ...fmt }); // 표 칸 안 줄바꿈
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
  const count = { fig: 0, tbl: 0, eq: 0 };
  const captioned = new WeakSet();
  // 장마다 다시 매기기(표지 정보 → 그림 · 표 번호 "장마다"): 그림 2-1 · 표 3-2, 부록은 A-1. 첫 장 앞(국문 초록 등)은 연속 번호
  const chap = { cur: "", seq: 0, app: 0 };
  const onChapter = (raw) => {
    if (!chapterNumbers) return;
    const s = String(raw || "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
    if (isFrontMatter(s) || /^(참고\s*문헌|references|bibliography)$/i.test(s)) return;
    const app = s.match(/^부록\s*([A-Za-z])?(?=\s|$|[.:·])/);
    const m = s.match(/제\s*(\d+)\s*장/);
    if (app) chap.cur = (app[1] || String.fromCharCode(65 + chap.app)).toUpperCase(), chap.app++;
    else chap.seq = m ? Number(m[1]) : chap.seq + 1, chap.cur = String(chap.seq);
    count.fig = 0;
    count.tbl = 0;
    count.eq = 0;
  };
  const order = { fig: 0, tbl: 0, eq: 0 }; // 원고 안 순서(0부터) — 미리보기 클릭 → 편집기 자리 찾기용. 번호(2-1)와 따로
  const numbered = (kind, label, body) => {
    const n = chapterNumbers && chap.cur ? `${chap.cur}-${++count[kind]}` : ++count[kind];
    if (label && !labels.has(label)) labels.set(label, { kind, n });
    const head = { text: captionLabel(kind, n, ko), b: true };
    return { n, index: order[kind]++, caption: body.length ? [head, { text: " " }, ...body] : [head] };
  };
  const capRuns = (s) => inline(window.marked.Lexer.lexInline(s));
  const nextIsTable = (tokens, k) => (tokens.slice(k + 1).find((x) => x.type !== "space") || {}).type === "table";
  let pendingCap = null;
  // 맨 바깥 문단이 그림(![캡션](fig:…))이나 표 캡션 줄(표: …)이면 처리하고 true
  const figureOrCaption = (t, tokens, k, depth) => {
    if (depth) return false;
    const fig = figureInfo(t.text);
    if (fig) {
      const { n, index, caption } = numbered("fig", fig.label, capRuns(fig.alt));
      blocks.push({ type: "figure", src: fig.src, alt: fig.alt, number: n, index, caption });
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
        else {
          if (t.depth === 2 && !depth) onChapter(t.text);
          blocks.push({ type: "heading", level: Math.min(t.depth - 1, 3), runs: inline(t.tokens) });
        }
      } else if (t.type === "paragraph") {
        if (t.text.trim() === "") blocks.push(...bibBlocks());
        else if (!depth && equationInfo(t.text)) {
          const eq = equationInfo(t.text);
          const n = chapterNumbers && chap.cur ? `${chap.cur}-${++count.eq}` : ++count.eq;
          if (eq.label && !labels.has(eq.label)) labels.set(eq.label, { kind: "eq", n });
          blocks.push({ type: "equation", tex: eq.tex, number: n, index: order.eq++ });
        } else if (!figureOrCaption(t, tokens, k, depth)) blocks.push({ type: "paragraph", runs: inline(t.tokens) });
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
        const { n, index, caption } = numbered("tbl", cap ? cap.label : "", cap ? capRuns(cap.text) : []);
        const block = { type: "table", header: true, align: t.align || [], number: n, index, caption,
          rows: [t.header.map((c) => inline(c.tokens)), ...t.rows.map((r) => r.map((c) => inline(c.tokens)))] };
        if (cap) captioned.add(block);
        blocks.push(block);
      } else if (t.type === "html" && t.text.trim()) {
        blocks.push({ type: "paragraph", runs: textRuns(t.text.replace(/<[^>]+>/g, "").trim(), {}) });
      }
    }
  };
  walk(window.marked.lexer(mathSrc));
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
  let h = r.math ? katexHtml(r.math, false) : esc(r.text).replace(/\n/g, "<br>");
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
      case "equation": return `<div class="doc-eq"><div class="doc-eq-math">${katexHtml(b.tex, true)}</div>`
        + `<span class="doc-eq-no">(${esc(String(b.number))})</span></div>`;
      case "figure": return `<figure class="doc-fig" data-fig-i="${Number(b.index)}" role="button" tabindex="0" title="눌러서 편집기에서 보기">`
        + `<img data-fig="${esc(b.src)}" alt="${esc(b.alt || "")}"><figcaption>${runsHtml(b.caption || [], notes)}</figcaption></figure>`;
      case "table": return `<div class="doc-tbl" data-tbl-i="${Number(b.index)}" role="button" tabindex="0" title="눌러서 표 고치기">`
        + `<p class="doc-cap">${runsHtml(b.caption || [], notes)}</p><table>${b.rows.map((row, ri) => `<tr>${row.map((cell, ci) => {
          const tag = ri === 0 ? "th" : "td"; // 머리글은 늘 가운데, 정렬 단추는 내용 칸 (writer.py _cell_align와 같게)
          return `<${tag} style="text-align:${ri === 0 ? "center" : esc(b.align[ci] || "left")}">${runsHtml(cell, notes)}</${tag}>`;
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
  if (W.check) W.check.destroy(); // 제출 전 점검 패널 · Alt+K
  W.check = null;
  if (W.fig) W.fig.destroy(); // 그림 만들기 패널 · Alt+G (그리는 작업은 서버에서 계속)
  W.fig = null;
  if (W.proof) W.proof.destroy(); // 맞춤법 점검 패널 · Alt+P (점검 작업은 서버에서 계속)
  W.proof = null;
  if (W.saver) W.saver.flush();
  W.saver = null;
  if (W.palette) W.palette(); // 명령 팔레트에서 이 원고의 명령 빼기
  W.palette = null;
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
  const [items, reviews] = await Promise.all([api.get("/api/manuscripts").catch((e) => { errorToast(e); return []; }),
    api.get("/api/reviews").catch(() => ({}))]); // 검토본 줄 (2026-10-28)
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
    // 교수님이 링크를 열어 복사된 검토본: 원고 아래 한 줄 — 누르면 원고를 열고 AI 패널 '검토'로
    const rv = reviews[String(m.id)];
    if (rv) {
      const sub = el(`<button type="button" class="ms-review">↳ 검토본${rv.copies > 1 ? ` ${rv.copies}개` : ""}${rv.open ? ` · 남은 의견 ${rv.open}개` : " · 의견 없음"}</button>`);
      sub.onclick = (e) => {
        e.stopPropagation();
        try { sessionStorage.setItem(REVIEW_OPEN_KEY, String(m.id)); } catch { /* 저장소 없음 */ }
        location.hash = `#/write/${m.id}`;
      };
      $(".grow", row).append(sub);
    }
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
      <button type="button" class="btn sm" data-share title="지도교수님 등에게 원고 링크를 보내 의견을 받아요 (로그인 없이 읽기 · 문장에 의견)">공유</button>
      <button type="button" class="btn sm" data-comments title="공유 링크로 받은 의견 · 고친 글 (검토본) — 편집기 옆에 빨간색으로">의견<span class="ck-badge" data-comments-badge hidden></span></button>
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
      <button class="btn sm ghost" data-stats title="통계 계산 — 엑셀 원자료를 붙여 넣으면 서버가 t검정 · 분산분석 · 상관 · 회귀 · 카이제곱 · 신뢰도를 계산해 APA 표와 결과 문장을 넣어요 (AI 아님)">통계</button>
      <button class="btn sm ghost" data-equation title="수식 넣기 — $$ 수식 $$ {#eq:이름}, 오른쪽에 번호 (1)이 붙고 본문에서 @eq:이름 으로 참조해요">수식</button>
      <button class="btn sm ghost" data-footnote title="각주 넣기 (${MAC ? "⌘+⌥" : "Ctrl+Alt"}+F) — 커서 자리에 [^N], 이 장 · 절 끝에 내용 줄 [^N]: 을 넣어요" aria-keyshortcuts="Control+Alt+F">각주</button>
      <span class="sep"></span>
      <button class="btn sm primary" data-cite title="[@ 를 입력해도 열려요">＋ 인용 넣기</button>
      <button class="btn sm ghost" data-bib title="참고문헌이 들어갈 자리">[참고문헌]</button>
      <span class="menu-wrap"><button class="btn sm" data-ai>✦ AI 도우미 ▾</button></span>
      <button type="button" class="btn sm" data-ai-results aria-pressed="false" aria-controls="ai-pane" aria-keyshortcuts="Alt+A"
        title="AI 결과 패널 (Alt+A) — 결과를 옆에 두고 계속 쓸 수 있어요. 결과는 7일 동안 남아요">AI 결과</button>
      <button type="button" class="btn sm" data-ref-toggle aria-pressed="false" aria-controls="ref-pane" aria-keyshortcuts="Alt+R"
        title="참고 패널 (Alt+R)">${ICON_REF}참고</button>
      <button type="button" class="btn sm" data-verify title="${VERIFY_TITLE}">${ICON_VERIFY}<span>인용 검증</span></button>
      <button type="button" class="btn sm" data-check aria-expanded="false" aria-keyshortcuts="Alt+K" title="제출 전 점검 (Alt+K) — 양식 · 번호 · 인용 · 글에서 고칠 곳">점검<span class="ck-badge" data-check-badge hidden></span></button>
      <span class="spacer"></span>
      <button type="button" class="btn sm" data-focus aria-pressed="false" aria-keyshortcuts="Control+Shift+F" title="집중 모드 — 편집기만 남기고, 쓰는 줄을 화면 가운데에 둬요 (${MAC ? "⌘" : "Ctrl"}+Shift+F · 끌 때 Esc)">집중</button>
      <button type="button" class="btn sm" data-history aria-haspopup="dialog" aria-keyshortcuts="Alt+H" title="버전 기록 — 지난 버전과 비교 · 되돌리기 · 지금 버전 저장 (Alt+H)">기록</button>
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
      <aside class="panel ai-pane" id="ai-pane" aria-label="AI 결과 패널"></aside>
    </div>
    <div class="writer-status small muted" data-status style="display:flex;align-items:center;gap:6px"><span data-status-text></span> <span data-verify-sum></span>
      <button type="button" class="btn sm ghost goal-btn" data-goals title="분량 · 마감 목표 — 전체 · 장별 목표 글자 수, 하루 목표, 제출 마감일">목표 정하기</button>
      <span class="spacer"></span><button type="button" class="btn sm ghost" data-shortcuts-hint>단축키 보기 (${MAC ? "⌘" : "Ctrl"}+/)</button></div>
    <div class="sr-only" role="status" data-ref-live></div></section>`);
  main.appendChild(view);
  const ta = $(".writer-ta", view);
  checkLayer(ta); // 편집기에서 [확인 필요: …] 색 표시
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
  // 표(캡션 줄 포함)를 두 번 누르면 표 고치기 창 (2026-10-26 사용자 요청 — 미리보기는 한 번 누르기)
  ta.addEventListener("dblclick", () => { if (tableAt(ta.value, ta.selectionStart)) editTable(ta); });
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
    else if (mod && e.altKey && !e.shiftKey && e.code === "KeyF") { e.preventDefault(); insertFootnote(ta); }
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
    if (pasteTable(ta, e)) return;
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
  $("[data-goals]", view).onclick = () => goalsDialog(view, ta);
  focusMode(view, ta); // 집중 모드 (2026-10-27)
  W.palette = registerCommands("writer", () => (W.ta === ta ? writerCommands(view, ta) : []));
  shareTools(view, ta, m); // 공유 링크 · 받은 의견 (2026-10-27)
  const retractions = watchRetractions(view, ta); // 철회 논문 확인 (2026-10-27)
  ta.addEventListener("input", retractions);
  retractions();
  $("[data-figure]", view).onclick = async () => insertFigures(ta, await pickFiles({ accept: "image/*", multiple: true }));
  $("[data-table]", view).onclick = () => editTable(ta);
  $("[data-stats]", view).onclick = () => statsDialog({ mid: m.id, insert: (md) => applyEdit(ta, blockInsert(ta.value, ta.selectionStart, ta.selectionEnd, md)) });
  // 수식: 커서 자리(문단 사이)에 $$ … $$ {#eq:식N} — 수식 칸을 골라 둔 채로 바로 쓰게
  $("[data-equation]", view).onclick = () => {
    const n = (ta.value.match(/\{#eq:/g) || []).length + 1;
    let label = `식${n}`;
    for (let k = n; ta.value.includes(`{#eq:${label}}`); k++) label = `식${k + 1}`;
    const body = "y = ax + b";
    applyEdit(ta, blockInsert(ta.value, ta.selectionStart, ta.selectionEnd, `$$ ${body} $$ {#eq:${label}}`, [3, 3 + body.length]));
  };
  $("[data-footnote]", view).onclick = () => insertFootnote(ta);
  // 미리보기의 그림 · 표를 누르면 편집기의 그 그림 줄을 고르거나 표 고치기 창
  const docClick = (e) => {
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    const mark = e.target.closest("mark.check-mark");
    if (mark) { // [확인 필요] 표시 → 원고의 그 문장으로 출처 확인 (같은 글의 표시 중 몇 번째인지로 자리를 찾음)
      e.preventDefault();
      const same = $$("mark.check-mark", $("[data-doc]", view)).filter((x) => x.textContent === mark.textContent);
      const at = markerIndex(ta.value, mark.textContent, same.indexOf(mark));
      if (at < 0) return toast("편집기에서 이 표시를 찾지 못했어요. 문장에 커서를 두고 AI 도우미 → 출처 확인을 눌러 주세요");
      const claim = claimAt(ta.value, at);
      if (claim) flashRange(view, ta, claim.from, claim.to);
      if (W.ai) W.ai.source(claim);
      return;
    }
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
  // 제출 전 점검표 (docs/specs/writing-checklist.md): 미리보기가 받아 둔 인용 정보 · 양식 · 표지 · 인용 검증 결과로 점검 (AI 없음)
  W.check = checkPanel(view, { ta, ctx: () => ({ format: W.fmt, coverKind: coverKind(), cover: m.cover, built: W.built, verify: W.vd && W.vd.data,
    style: currentStyle(view), retracted: W.retracted && W.retracted.mid === m.id ? W.retracted.list : null }),
    select: (a, b) => selectRange(view, ta, a, b), openCover: () => openCoverDialog(view, ta), verify: () => runVerify(view, ta),
    rerun: () => renderPreview(view, ta), say: (t) => sayWriter(view, t), extra: () => W.proof && W.proof.checkLine(),
    openGlossary: glossaryDialog, openJournal: () => journalDialog(ta) });
  W.proof = proofPanel(view, { ta, mid: m.id, select: (a, b) => selectRange(view, ta, a, b), say: (t) => sayWriter(view, t),
    changed: () => W.check && W.check.refresh() }); // 맞춤법 · 띄어쓰기 점검 (Alt+P — docs/specs/writing-proofread.md)
  W.fmt = { id: fmtId, entry: null, data: null };
  setFormat(view, fmtId);
  refresh();
  renderPreview(view, ta);
  // 서재 목록이 오면 왼쪽 "이 원고의 인용"을 누를 수 있는 줄로 다시 그림
  libraryPapers(true).then(() => { if (W.m === m && W.built) drawCites(view, W.built); }).catch(() => {});
  ta.focus();
  // AI 글쓰기 결과 (2026-10-16 백그라운드 AI · 2026-10-17 패널): 오른쪽 AI 결과 패널 + 알림 [열기]로 온 주소(#/write/원고/j작업)
  W.ai = aiPane(view, ta, m);
  W.fig = figPane(view, { ta, m, saveVersion: (c) => saveVersion(m.id, c), say: (t) => sayWriter(view, t), closeAi: () => view.dataset.aiPane === "open" && W.ai && W.ai.toggle() });
  paneResizer(view); // AI 결과 · 그림 패널 폭 끌어서 바꾸기
  openAiJobFromHash(m, ta);
  historyTools(view, { mid: m.id, ta, flush: flushWriter, // [기록] · Alt+H (docs/specs/manuscript-history.md)
    redline: (old, name) => exportAs("docx", view, ta, { redline: old, versionName: name }) }); // 수정 표시 워드 (2026-10-27)
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
  if (W.check) W.check.refresh(); // 양식 · 표지 정보가 바뀌면 점검표도
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
    renderPreview(view, ta); // 그림 · 표 번호 방식(장마다 · 이어서)이 바뀌었을 수 있음
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
    const built = await buildDocument(ta.value, { style: currentStyle(view), koreanFirst: state.settings.korean_first !== false,
      chapterNumbers: !!(W.m && W.m.cover && W.m.cover.caption_numbering === "chapter") });
    if (seq !== W.seq || token !== W.previewToken) return;
    W.built = built;
    doc.innerHTML = blocksToHtml(built.blocks) || `<p class="muted">왼쪽에 글을 쓰면 여기에 서식대로 보여요.</p>`;
    markChecks(doc); // [확인 필요: …] 색 표시
    hydrateFigures(doc, W.m.id);
    drawCites(view, built);
    if (W.ref) W.ref.citesChanged();
    if (W.check) W.check.refresh(); // 열어 둔 점검표 · 배지를 지금 원고로
  } catch (e) {
    if (seq === W.seq) doc.innerHTML = `<div class="status-line bad">${esc(e.message)}</div>`;
  }
}

// 개요: 누르면 그 자리로, 장 · 절(## · ###)은 끌어 놓거나 Alt+↑↓로 순서 바꾸기 (2026-10-28 — writeoutline.js)
function drawOutline(view, ta) {
  const box = $("[data-outline]", view);
  const heads = sections(ta.value).map((h) => ({ ...h, pos: h.from }));
  const titleEl = $("[data-title]", view);
  titleEl.textContent = (heads.find((h) => h.level === 1) || {}).text || "제목 없는 원고";
  titleEl.title = titleEl.textContent; // 긴 제목은 말줄임 — 마우스를 올리면 전체
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
    if (h.level >= 2) {
      b.draggable = true;
      b.dataset.i = i;
      b.title = `${h.text}\n끌어 놓아 순서 바꾸기 · Alt+↑↓`;
      b.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/x-paperlab-section", String(i)); e.dataTransfer.effectAllowed = "move"; b.classList.add("dragging"); });
      b.addEventListener("dragend", () => { b.classList.remove("dragging"); clearDrop(box); });
      b.addEventListener("keydown", (e) => {
        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        const same = heads.map((x, k) => [x, k]).filter(([x]) => x.level === h.level);
        const at = same.findIndex(([, k]) => k === i);
        const other = same[at + (e.key === "ArrowUp" ? -1 : 1)];
        // 같은 단계의 앞 · 뒤 장 · 절과 자리 바꾸기 (위: 앞 장 · 절 앞으로, 아래: 뒤 장 · 절 뒤로)
        if (other) moveOutline(view, ta, i, other[1], e.key === "ArrowDown", h.text);
      });
    }
    box.appendChild(b);
  });
  if (!box.dataset.dnd) { // 끌어 놓기 받기 (한 번만 — 버튼은 글을 고칠 때마다 새로 그림)
    box.dataset.dnd = "1";
    box.addEventListener("dragover", (e) => {
      const t = e.target.closest(".outline-item[data-i]");
      if (!t || !e.dataTransfer.types.includes("text/x-paperlab-section")) return;
      e.preventDefault();
      const r = t.getBoundingClientRect();
      clearDrop(box);
      t.classList.add(e.clientY > r.top + r.height / 2 ? "drop-after" : "drop-before");
    });
    box.addEventListener("dragleave", (e) => { if (!box.contains(e.relatedTarget)) clearDrop(box); });
    box.addEventListener("drop", (e) => {
      const t = e.target.closest(".outline-item[data-i]");
      const from = e.dataTransfer.getData("text/x-paperlab-section");
      if (!t || from === "") return;
      e.preventDefault();
      const after = t.classList.contains("drop-after");
      clearDrop(box);
      const i = Number(from);
      const s = sections(ta.value)[i];
      if (s) moveOutline(view, ta, i, Number(t.dataset.i), after, s.text);
    });
  }
}

function clearDrop(box) {
  for (const x of $$(".drop-before, .drop-after", box)) x.classList.remove("drop-before", "drop-after");
}

function moveOutline(view, ta, i, j, after, name) {
  const r = moveSection(ta.value, i, j, after);
  if (!r) return;
  applyEdit(ta, diffEdit(ta.value, r.value, r.from, r.from));
  flashRange(view, ta, r.from, r.from + r.value.slice(r.from).indexOf("\n"));
  toast(`'${name}'을(를) 옮겼어요 — 되돌리려면 Ctrl+Z`);
  // 옮긴 장 · 절의 개요 단추에 초점을 둬 Alt+↑↓를 이어서 누를 수 있게
  setTimeout(() => {
    const k = sections(ta.value).findIndex((x) => x.from === r.from);
    const btn = $(`[data-outline] .outline-item[data-i="${k}"]`, view);
    if (btn) btn.focus();
  }, 60);
}

function drawStatus(view, ta) {
  const text = ta.value;
  const body = plainBody(text); // 그림 줄은 캡션 글만 · 제목 줄 · 인용 표시 뺌 (writegoals.js — 목표와 같은 셈)
  const chars = body.replace(/\n/g, "").length;
  const noSpace = body.replace(/\s/g, "").length;
  const words = (body.match(/\S+/g) || []).length;
  const cites = (text.match(CITE_RE) || []).length;
  $("[data-status-text]", view).textContent =
    `글자 ${chars.toLocaleString("ko-KR")}자 (공백 제외 ${noSpace.toLocaleString("ko-KR")}자) · 단어 ${words.toLocaleString("ko-KR")}개 · 인용 ${cites}곳`;
  drawGoals(view, ta);
}

// ------------------------------------------------------------------ 공유 링크 · 받은 의견 (2026-10-27)
// 검토본 (2026-10-28): [의견]은 편집기 옆 AI 패널의 '검토' 보기(writereviewui.js)를 연다. 원고 목록의 검토본 줄로 오면 바로 엶
const REVIEW_OPEN_KEY = "paperlab.openReview";
function shareTools(view, ta, m) {
  const badge = $("[data-comments-badge]", view);
  const setCount = (n) => {
    badge.hidden = !n;
    badge.textContent = n ? String(n) : "";
    badge.dataset.tone = n ? "warn" : "";
  };
  const poll = async () => {
    if (W.m !== m || !view.isConnected) return;
    setCount(await openCommentCount(m.id));
    setTimeout(poll, 30000);
  };
  poll();
  W.reviewCount = setCount;
  $("[data-share]", view).onclick = () => shareDialog(m.id);
  $("[data-comments]", view).onclick = () => W.ai && W.ai.review();
  let want = "";
  try { want = sessionStorage.getItem(REVIEW_OPEN_KEY) || ""; sessionStorage.removeItem(REVIEW_OPEN_KEY); } catch { /* 저장소 없음 */ }
  if (want === String(m.id)) setTimeout(() => W.ai && W.m === m && W.ai.review(), 0);
}

// ------------------------------------------------------------------ 철회 논문 확인 (2026-10-27)
// 인용키가 바뀌면 5초 뒤 서버에 물어(서버가 DOI별로 하루 기억) 점검표 '인용'에 꼭 고칠 것으로 띄운다
function watchRetractions(view, ta) {
  const m = W.m;
  let last = "";
  let timer = null;
  return () => {
    const keys = [...new Set((ta.value.match(CITE_RE) || []).flatMap((raw) => (parseCitation(raw.slice(1, -1)) || []).map((it) => it.key)))]
      .filter((k) => !/^(fig|tbl|eq):/.test(k)).sort();
    const sig = keys.join("|");
    if (sig === last) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (W.m !== m) return;
      last = sig;
      if (!keys.length) { W.retracted = { mid: m.id, list: [] }; return; }
      let r;
      try { r = await api.post("/api/retractions", { keys }); } catch { last = ""; return; }
      if (W.m !== m) return;
      const fresh = r.retracted.filter((x) => !(W.retracted && W.retracted.mid === m.id && W.retracted.list.some((y) => y.key === x.key)));
      W.retracted = { mid: m.id, list: r.retracted };
      if (W.check) W.check.refresh();
      if (fresh.length) toast(`철회된 논문을 인용했어요 — ${fresh.map((x) => `@${x.key}`).join(", ")}. 제출 전 점검에서 확인해 주세요`, "error", LONG);
    }, 5000);
  };
}

// ------------------------------------------------------------------ 집중 모드 (2026-10-27 — Scrivener · iA Writer)
// 도구 막대 · 개요 · 미리보기 · 패널을 숨기고 편집기를 가운데 좁은 칸으로. 타자기 스크롤: 커서 줄을 화면 가운데에 둔다
// (textarea는 커서 좌표를 주지 않아서, 같은 글꼴 · 폭의 숨은 거울에 커서 앞 글을 넣고 끝 자리를 잰다)
function focusMode(view, ta) {
  const btn = $("[data-focus]", view);
  const edit = $(".writer-edit", view);
  const exit = el(`<button type="button" class="btn sm focus-exit" title="집중 모드 끄기 (Esc)">집중 끝내기</button>`);
  view.appendChild(exit);
  let mirror = null;
  const center = () => {
    if (!view.classList.contains("focus-mode")) return;
    if (!mirror) {
      mirror = el(`<div class="writer-hl writer-mirror" aria-hidden="true"></div>`);
      edit.appendChild(mirror);
    }
    mirror.textContent = ta.value.slice(0, ta.selectionEnd);
    const mark = document.createElement("span");
    mark.textContent = "\u200b";
    mirror.appendChild(mark);
    const y = mark.offsetTop;
    mirror.textContent = "";
    const top = Math.max(0, y - ta.clientHeight / 2 + 16);
    if (Math.abs(ta.scrollTop - top) > 4) ta.scrollTop = top;
  };
  const set = (on) => {
    view.classList.toggle("focus-mode", on);
    btn.setAttribute("aria-pressed", String(on));
    if (on) {
      if (view.classList.contains("view-preview")) setView(view, ta, "split");
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      ta.focus();
      requestAnimationFrame(center);
      sayWriter(view, "집중 모드를 켰어요. Esc로 끌 수 있어요");
    } else {
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      ta.focus();
    }
  };
  W.focus = { toggle: () => set(!view.classList.contains("focus-mode")), off: () => set(false) };
  btn.onclick = W.focus.toggle;
  exit.onclick = W.focus.off;
  ta.addEventListener("input", () => requestAnimationFrame(center));
  ta.addEventListener("keyup", (e) => { if (/^(Arrow|Page|Home|End|Enter)/.test(e.key)) center(); });
  ta.addEventListener("click", () => requestAnimationFrame(center));
  view.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && !e.altKey && e.code === "KeyF") { e.preventDefault(); W.focus.toggle(); }
    else if (e.key === "Escape" && view.classList.contains("focus-mode") && !modalOpen() && !e.defaultPrevented) W.focus.off();
  });
  // 브라우저 전체 화면을 Esc로 먼저 끄면 집중 모드도 함께 끈다
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && view.isConnected && view.classList.contains("focus-mode")) set(false);
  });
}

// ------------------------------------------------------------------ 분량 · 일정 목표 (2026-10-27)
function drawGoals(view, ta) {
  const btn = $("[data-goals]", view);
  const m = W.m;
  if (!btn || !m) return;
  const goals = (m.cover && m.cover.goals) || null;
  if (!hasGoals(goals)) {
    btn.textContent = "목표 정하기";
    btn.dataset.tone = "";
    return;
  }
  const s = goalSummary(ta.value, goals);
  btn.textContent = s.line || "목표";
  btn.dataset.tone = s.left != null && s.left < 0 ? "bad" : goals.daily && s.todayDone >= goals.daily ? "ok" : "";
  if (s.needsDay && W.dayFor !== `${m.id}|${dayKey()}`) {
    // 오늘 처음 — 지금 글자 수를 오늘 시작값으로 (하루 한 번 저장)
    W.dayFor = `${m.id}|${dayKey()}`;
    const cover = { ...(m.cover || {}), goals: { ...goals, day: { date: dayKey(), start: s.now } } };
    api.patch(`/api/manuscripts/${m.id}`, { cover }).then(() => { if (W.m === m) m.cover = cover; }).catch(() => { W.dayFor = null; });
  }
}

function goalsDialog(view, ta) {
  const m = W.m;
  if (!m) return;
  const g = (m.cover && m.cover.goals) || {};
  const chapters = chapterCounts(ta.value);
  const s = goalSummary(ta.value, g);
  const num = (n) => (n ? String(n) : "");
  const rows = chapters.map((c, i) => `<tr><td>${esc(c.title)}</td><td class="num">${c.chars.toLocaleString("ko-KR")}</td>
    <td><input class="input" type="number" min="0" step="500" data-ch="${i}" value="${num(g.chapters && g.chapters[c.title])}" placeholder="목표"></td>
    <td class="num" data-pct="${i}"></td></tr>`).join("");
  const body = el(`<form class="goals-form">
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <div class="field"><label>제출 마감일</label><input class="input" type="date" name="deadline" value="${esc(g.deadline || "")}"></div>
      <div class="field"><label>전체 목표 (글자)</label><input class="input" type="number" min="0" step="1000" name="total" value="${num(g.total)}" placeholder="예: 60000"></div>
      <div class="field"><label>하루 목표 (글자)</label><input class="input" type="number" min="0" step="100" name="daily" value="${num(g.daily)}" placeholder="예: 1500"></div>
    </div>
    <p class="small muted" style="margin:4px 0 10px">지금 ${s.now.toLocaleString("ko-KR")}자 · 오늘 쓴 글자 ${s.todayDone.toLocaleString("ko-KR")}자
      — 글자 수는 아래 상태 줄과 같은 셈(공백 포함, 제목 · 인용 표시 뺌)이에요. 학위논문은 보통 A4 1쪽에 1,000~1,300자예요.</p>
    ${chapters.length ? `<table class="goals-table"><thead><tr><th>장</th><th>지금</th><th>목표</th><th>진행</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<p class="small muted">'## ' 장 제목을 쓰면 장마다 목표를 정할 수 있어요.</p>`}
  </form>`);
  const drawPct = () => {
    for (const inp of $$("[data-ch]", body)) {
      const c = chapters[Number(inp.dataset.ch)];
      const t = Number(inp.value) || 0;
      $(`[data-pct="${inp.dataset.ch}"]`, body).textContent = t ? `${Math.min(100, Math.floor((c.chars / t) * 100))}%` : "";
    }
  };
  body.addEventListener("input", drawPct);
  drawPct();
  const foot = el(`<div style="display:contents"><button type="button" class="btn" data-clear>목표 지우기</button><span class="spacer"></span>
    <button type="button" class="btn" data-no>취소</button><button type="button" class="btn primary" data-ok>저장</button></div>`);
  const md = modal({ title: "분량 · 일정 목표", body, foot });
  const save = async (goals) => {
    const cover = { ...(m.cover || {}), goals };
    try { await api.patch(`/api/manuscripts/${m.id}`, { cover }); } catch (e) { return errorToast(e); }
    m.cover = cover;
    drawGoals(view, ta);
    md.close();
  };
  $("[data-no]", foot).onclick = () => md.close();
  $("[data-clear]", foot).onclick = () => save({});
  $("[data-ok]", foot).onclick = () => {
    const fd = new FormData(body);
    const int = (v) => Math.max(0, Math.min(2000000, Math.round(Number(v) || 0)));
    const ch = {};
    for (const inp of $$("[data-ch]", body)) {
      const n = int(inp.value);
      if (n) ch[chapters[Number(inp.dataset.ch)].title] = n;
    }
    const goals = { deadline: String(fd.get("deadline") || ""), total: int(fd.get("total")), daily: int(fd.get("daily")), chapters: ch };
    if (g.day) goals.day = g.day;
    save(goals);
  };
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
  const w = wrapParts(ta.value, ta.selectionStart, ta.selectionEnd, before, after); // 고른 글 앞뒤 빈칸은 표시 밖으로
  ta.setRangeText(w.text, w.start, w.end, "select");
  ta.setSelectionRange(w.selStart, w.selEnd);
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

// 각주 넣기: 커서 자리 [^N] + 장 · 절 끝 정의 줄 "[^N]: " (커서는 정의 줄로 — 바로 내용을 쓰게)
function insertFootnote(ta) {
  const edit = footnoteInsert(ta.value, ta.selectionStart, ta.selectionEnd);
  if (!edit) return toast("코드 블록이나 각주 내용 줄 안에는 각주를 넣을 수 없어요");
  applyEdit(ta, edit);
  ta.blur(); // 정의 줄이 화면 밖이면 그쪽으로 스크롤되게 (selectRange와 같은 방법)
  ta.focus();
}

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
// 그림 · 표 번호를 장마다(표 2-1)로 — 표 창의 [장마다 번호로] (표지 정보의 같은 설정)
// 내 용어집 (2026-10-27): 한 줄에 '쓸 말 ← 피할 말, 피할 말' — 원고 설정(cover.glossary)에 저장, 점검표가 찾아 줌
export function parseGlossary(text) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const m = line.match(/^\s*([^←<=]+?)\s*(?:←|<-|<=|=)\s*(.+)$/);
    if (!m) continue;
    const avoid = m[2].split(/[,，]/).map((s) => s.trim()).filter((s) => s && s !== m[1].trim()).slice(0, 10);
    if (avoid.length && m[1].trim().length <= 40 && avoid.every((a) => a.length <= 40)) out.push({ use: m[1].trim(), avoid });
  }
  return out.slice(0, 100);
}

function glossaryDialog() {
  const m = W.m;
  if (!m) return Promise.resolve(false);
  const text = ((m.cover && m.cover.glossary) || []).map((g) => `${g.use} ← ${g.avoid.join(", ")}`).join("\n");
  return new Promise((resolve) => {
    const body = el(`<div><p class="small muted" style="margin:0 0 8px">한 줄에 <b>쓸 말 ← 피할 말</b>을 적어요. 피할 말은 쉼표로 여러 개.
      제출 전 점검이 피할 말을 찾아 주고, [용어집대로 모두 바꾸기]로 한 번에 고칠 수 있어요.</p>
      <textarea class="input" rows="10" style="width:100%;font-family:inherit" placeholder="연구 참여자 ← 참가자, 피험자&#10;사회관계망서비스 ← 소셜 미디어"></textarea></div>`);
    $("textarea", body).value = text;
    const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button><button class="btn primary" data-ok>저장</button></div>`);
    let saved = false;
    const md = modal({ title: "내 용어집", body, foot, onClose: () => resolve(saved) });
    $("[data-no]", foot).onclick = () => md.close();
    $("[data-ok]", foot).onclick = async () => {
      const glossary = parseGlossary($("textarea", body).value);
      const cover = { ...(m.cover || {}), glossary };
      try { await api.patch(`/api/manuscripts/${m.id}`, { cover }); } catch (e) { return errorToast(e); }
      m.cover = cover;
      saved = true;
      toast(`용어 ${glossary.length}개를 저장했어요`, "success");
      md.close();
    };
    setTimeout(() => $("textarea", body).focus(), 40);
  });
}

// 학술지 투고 규정 (2026-10-27): 값을 직접 넣거나, 규정 글을 붙여 넣으면 AI(글쓰기 작업 mode=journal)가 채움.
// 원고 설정 cover.journal — 제출 전 점검표가 분량 · 초록 · 주제어 · 참고문헌 수 · 인용 양식을 본다
function journalDialog(ta) {
  const m = W.m;
  if (!m) return Promise.resolve(false);
  const j = (m.cover && m.cover.journal) || {};
  return new Promise((resolve) => {
    const nums = JOURNAL_NUM_KEYS.map((k) => `<div class="field"><label>${esc(JOURNAL_LABELS[k])}</label>
      <input class="input" type="number" min="0" name="${k}" value="${j[k] ? Number(j[k]) : ""}"></div>`).join("");
    const body = el(`<form class="journal-form">
      <div class="field"><label>학술지 이름</label><input class="input" name="name" value="${esc(j.name || "")}" placeholder="예: 한국교육학연구"></div>
      <div class="journal-grid">${nums}</div>
      <div class="field"><label>인용 양식</label><input class="input" name="style" value="${esc(j.style || "")}" placeholder="예: APA 7판"></div>
      <div class="field"><label>그 밖의 규정 (한 줄에 하나 — 점검표에는 안 나오고 여기서만 봐요)</label>
        <textarea class="input" name="notes" rows="3">${esc((j.notes || []).join("\n"))}</textarea></div>
      <details class="journal-ai"><summary>투고 규정 글로 채우기 (AI)</summary>
        <textarea class="input" rows="6" data-rules placeholder="학술지 홈페이지의 투고 규정 · 원고 작성 요령을 복사해 붙여 넣으세요"></textarea>
        <div class="row" style="gap:8px;align-items:center;margin-top:6px"><button type="button" class="btn sm" data-extract>AI로 규정 뽑기</button>
          <span class="small muted" data-extract-st aria-live="polite"></span></div></details>
    </form>`);
    const foot = el(`<div style="display:contents"><button type="button" class="btn" data-clear>규정 지우기</button><span class="spacer"></span>
      <button type="button" class="btn" data-no>취소</button><button type="button" class="btn primary" data-ok>저장</button></div>`);
    let saved = false;
    let stop = null;
    const md = modal({ title: "학술지 투고 규정", body, foot, onClose: () => { if (stop) stop(); resolve(saved); } });
    const fill = (r) => {
      const f = (n) => body.querySelector(`[name="${n}"]`);
      if (r.name) f("name").value = r.name;
      for (const k of JOURNAL_NUM_KEYS) if (r[k]) f(k).value = String(r[k]);
      if (r.style) f("style").value = r.style;
      if (r.notes && r.notes.length) f("notes").value = r.notes.join("\n");
    };
    const st = $("[data-extract-st]", body);
    $("[data-extract]", body).onclick = async () => {
      const text = $("[data-rules]", body).value.trim();
      if (text.length < 20) return toast("투고 규정 글을 붙여 넣어 주세요", "error");
      if (!(await ensureAiRoute("write"))) return;
      let job;
      try {
        job = (await api.post("/api/ai/write", { mode: "journal", text: text.slice(0, 30000), manuscript_id: m.id,
          ...writeAnchor(ta.value, ta.selectionEnd, ta.selectionEnd, true) })).job;
      } catch (err) { return errorToast(err); }
      st.innerHTML = `<span class="spinner" aria-hidden="true"></span> AI가 규정을 읽는 중… (창을 닫으면 결과는 AI 결과 패널에 남아요)`;
      if (stop) stop();
      stop = watchJob(job.id, (n) => {
        if (!n || isActive(n)) return;
        stop && stop();
        stop = null;
        if (n.status !== "succeeded") { st.textContent = "규정을 뽑지 못했어요 — 값을 직접 넣어 주세요"; return; }
        const r = parseJournal(n.result && n.result.text);
        if (!r) { st.textContent = "AI 답을 읽지 못했어요 — 값을 직접 넣어 주세요"; return; }
        fill(r);
        handledJob(n.id);
        api.post(`/api/jobs/${n.id}/handled`, { state: "applied" }).catch(() => {});
        st.textContent = "AI가 뽑은 값을 넣었어요. 확인하고 저장해 주세요";
      }, { first: job });
    };
    const save = async (journal) => {
      const cover = { ...(m.cover || {}) };
      if (journal) cover.journal = journal; else delete cover.journal;
      try { await api.patch(`/api/manuscripts/${m.id}`, { cover }); } catch (err) { return errorToast(err); }
      m.cover = cover;
      saved = true;
      toast(journal ? "투고 규정을 저장했어요 — 제출 전 점검에 반영돼요" : "투고 규정을 지웠어요", "success");
      md.close();
    };
    $("[data-no]", foot).onclick = () => md.close();
    $("[data-clear]", foot).onclick = () => save(null);
    $("[data-ok]", foot).onclick = () => {
      const fd = new FormData(body);
      const raw = Object.fromEntries(JOURNAL_NUM_KEYS.map((k) => [k, Number(fd.get(k)) || null]));
      const r = cleanJournal({ ...raw, name: fd.get("name"), style: fd.get("style"), notes: String(fd.get("notes") || "").split("\n") });
      save(r && Object.keys(r).length ? r : null);
    };
  });
}

async function setChapterNumbering() {
  const m = W.m;
  if (!m) return false;
  const cover = { ...(m.cover || {}), caption_numbering: "chapter" };
  try { await api.patch(`/api/manuscripts/${m.id}`, { cover }); } catch (e) { errorToast(e); return false; }
  m.cover = cover;
  if (W.ta && W.m === m) renderPreview(W.ta.closest(".writer"), W.ta);
  toast("그림 · 표 번호를 장마다 새로 매겨요 — 표지 정보에서 바꿀 수 있어요", "success");
  return true;
}

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
  const chapter = !!(W.m && W.m.cover && W.m.cover.caption_numbering === "chapter");
  const res = await tableDialog(table, { existing: !!found, ko, chapter, setChapter: setChapterNumbering });
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

// 엑셀 · 한글 · 워드 표 붙여넣기 → 마크다운 표 (2026-10-27). 탭 글(엑셀) 먼저, 없으면 HTML 표 하나만 든 경우.
// 표 · 코드 안에 붙일 때와 Ctrl+Shift+V(글만 붙여넣기)는 그대로. 되돌리기(Ctrl+Z)로 표 넣기 전으로
function pasteTable(ta, e) {
  const cd = e.clipboardData;
  if (!cd || tableAt(ta.value, ta.selectionStart) || inFence(ta.value, ta.selectionStart)) return false;
  let table = tableFromTsv(cd.getData("text/plain"));
  const html = cd.getData("text/html");
  if (!table && /<table/i.test(html)) table = htmlTable(html);
  if (!table) return false;
  e.preventDefault();
  const ko = koDoc(ta);
  applyEdit(ta, blockInsert(ta.value, ta.selectionStart, ta.selectionEnd, tableMarkdown(table, ko), [0, 0]));
  toast(`표(${table.rows.length}줄 × ${table.rows[0].length}칸)로 넣었어요. 표를 두 번 눌러 캡션을 넣고 고칠 수 있어요 (Ctrl+Z: 되돌리기)`);
  return true;
}

function htmlTable(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = doc.querySelectorAll("table");
  if (tables.length !== 1) return null;
  const t = tables[0];
  // 표 밖의 글이 있으면(문단 + 표를 함께 복사) 글 그대로 붙인다
  const outside = (doc.body.textContent || "").replace(t.textContent || "", "").trim();
  if (outside.length > 2) return null;
  const cells = [...t.querySelectorAll("tr")].filter((tr) => tr.closest("table") === t).map((tr) => {
    const row = [];
    for (const c of tr.querySelectorAll(":scope > td, :scope > th")) {
      c.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
      const ps = [...c.querySelectorAll("p")];
      const text = ps.length > 1 ? ps.map((p) => p.textContent.trim()).filter(Boolean).join("\n") : c.textContent;
      row.push(text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n"));
      for (let k = 1; k < (Number(c.getAttribute("colspan")) || 1); k++) row.push("");
    }
    return row;
  });
  return tableFromCells(cells);
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
const endingKey = () => `paperlab.ending.${W.m ? W.m.id : 0}`;
function getEnding() {
  try { const v = localStorage.getItem(endingKey()); return ENDING_RULES[v] ? v : "keep"; } catch { return "keep"; }
}
function setEnding(v) {
  try { localStorage.setItem(endingKey(), v); } catch { /* 저장소 없음 — 이번만 */ }
}

// AI에 보낼 범위 (2026-10-17 사용자 지적 "ai 보내는 범위가 좀 이상한"): 선택(없으면 커서 문단) · 문단 · 이 절 · 이 장.
// 원고마다 이 브라우저에 기억. 문단은 진짜 문단만(제목 · 표 · 그림 · 캡션 · 코드 · 각주 정의 줄 없이 — writeedit.js aiScope)
const SCOPE_MENU = { sel: "선택 (없으면 문단)", para: "문단", section: "이 절 (문단마다)", chapter: "이 장 (문단마다)" };
const scopeKey = () => `paperlab.aiScope.${W.m ? W.m.id : 0}`;
function getScope() {
  try { const v = localStorage.getItem(scopeKey()); return SCOPE_KINDS.includes(v) ? v : "sel"; } catch { return "sel"; }
}
function setScope(v) {
  try { localStorage.setItem(scopeKey(), v); } catch { /* 저장소 없음 — 이번만 */ }
}

function aiMenu(anchor, ta) {
  popupMenu(anchor, aiItems(ta), { left: true, className: "ai-menu" }); // 이름 한 줄 · 설명은 아래 줄 (2026-10-28 글씨 잘림)
}

// AI 도우미 메뉴 (2026-10-28 사용자 요청 "버튼 정리 — 합치고 안에서 옵션을 선택"): 묶음 7개만 두고, 묶음을 누르면 창에서
// 방식 · 범위 · 끝맺음을 고른다 (writeaimenu.js). 묶음마다 지난번 고른 방식을 이 브라우저에 기억
const GROUP_BREAK = new Set(["chat", "check"]); // 이 묶음 앞에 구분선
function aiItems(ta) {
  const out = [];
  for (const g of AI_GROUPS) {
    if (g.needs && !W[g.needs]) continue;
    if (GROUP_BREAK.has(g.id) && out.length) out.push("-");
    out.push({ label: g.label, sub: g.sub || "", action: () => openAiGroup(g, ta) });
  }
  return out;
}
// 명령 팔레트: 방식마다 한 줄 ("글 고치기: 간결하게") — 찾아서 바로 실행
function aiPaletteItems(ta) {
  return flatChoices({ fig: !!W.fig }).map((c) => ({ label: c.label, sub: c.sub, action: () => runAiChoice(c.key, ta) }));
}
const lastChoiceKey = (g) => `paperlab.aiLast.${g}`;
async function openAiGroup(g, ta) {
  if (!g.choices) return runAiChoice(g.id, ta);
  let last = "";
  try { last = localStorage.getItem(lastChoiceKey(g.id)) || ""; } catch { /* 저장소 없음 */ }
  const r = await aiGroupDialog(g, { last, scope: getScope(), scopes: SCOPE_MENU, ending: getEnding(), endings: ENDINGS });
  if (!r || W.ta !== ta) return;
  try { localStorage.setItem(lastChoiceKey(g.id), r.key); } catch { /* 저장소 없음 */ }
  if (SCOPE_MODES.has(r.key) && SCOPE_KINDS.includes(r.scope)) setScope(r.scope);
  if (ENDING_MODES.has(r.key) && ENDING_RULES[r.ending]) setEnding(r.ending);
  runAiChoice(r.key, ta);
}
const TOOL_KEYS = new Set(["matrix", "stats", "memo", "review", "response", "slides", "align"]);
function runAiChoice(key, ta) {
  if (key === "chat") return W.ai && W.ai.chat();
  if (key === "proof") return W.proof && W.proof.open();
  if (key === "source") return W.ai && W.ai.source(claimAt(ta.value, ta.selectionStart, ta.selectionEnd));
  if (key === "cite" || key === "similar") return libraryMatch(ta, key);
  if (key.startsWith("fig_")) { // 그림 만들기 · 이 내용으로 · 커서의 그림 고치기 (writefigui.js)
    const it = W.fig && W.fig.menuItems().find((x) => x.key === key);
    return it && it.action();
  }
  return TOOL_KEYS.has(key) ? runTool(key, ta) : runAi(key, ta);
}

// 명령 팔레트 (palette.js): 위 막대 · 도구 막대 · 상태 줄 단추 + AI 도우미 메뉴 + 내보내기 + 개요(장 · 절로 가기)
function ownText(b) {
  const c = b.cloneNode(true);
  for (const x of c.querySelectorAll(".ck-badge, .count, svg")) x.remove();
  return c.textContent.replace(/\s+/g, " ").trim();
}
function writerCommands(view, ta) {
  const out = [];
  for (const b of $$(".writer-bar button, .writer-tools button, .writer-status button", view)) {
    if (b.matches("[data-ai], [data-export], [disabled]") || b.closest(".hidden")) continue;
    const text = ownText(b);
    if (!text) continue;
    const title = b.title || "";
    const head = title.split(/\s[—(]|\n/)[0].trim();
    const seg = b.closest("[data-view]");
    const label = seg ? `보기: ${text}` : text.length <= 2 && head && head.length <= 24 ? head : text;
    const keys = ((title.match(/\(([^()]*(?:Ctrl|⌘|Alt|Shift)[^()]*)\)/) || [])[1] || "").split(" · ")[0];
    out.push({ label, sub: label === head ? "" : head.slice(0, 40), keys, group: seg ? "보기" : "원고", action: () => b.click() });
  }
  for (const it of aiPaletteItems(ta)) out.push({ ...it, group: "AI" });
  for (const it of exportItems(view, ta)) if (it !== "-") out.push({ ...it, label: `내보내기: ${it.label}`, group: "내보내기" });
  const items = $$("[data-outline] .outline-item", view);
  sections(ta.value).forEach((h, i) => {
    if (items[i]) out.push({ label: `${"  ".repeat(Math.max(0, h.level - 2))}${h.text}`.trim(), sub: "이 장 · 절로 가기", group: "개요", action: () => items[i].click() });
  });
  return out;
}

// 보낼 글을 편집기에서 잠깐 골라 보여 준다 — 1.2초 뒤 그 사이 아무것도 안 했으면 원래 커서 · 선택으로 되돌림
// [확인 필요: …] 색 표시 (2026-10-26 사용자 요청): textarea 는 글자색을 못 바꾸므로 뒤에 같은 글자 · 같은 줄바꿈의 층을 깔고
// 표시 자리에만 색 상자를 놓는다(글자는 textarea 것이 그대로 보임).
// - 층의 글은 원고 전체를 글 조각 하나로 둔다: 표시를 <mark>로 나누면 글자 모양 잇기(커닝)가 끊겨 뒤 글자가 조금씩 밀리고
//   줄 끝에서 줄바꿈 자리까지 달라짐(2026-10-26 사용자 지적 "위치가 안 맞아"). 상자 자리는 Range 로 잰다
// - 층은 편집 칸에 꽉 차게(inset 0 — 폭을 px로 재면 화면 배율에서 소수점이 잘림), 스크롤 막대 자리는 둘 다 늘 잡아 둠
function checkLayer(ta) {
  const hl = el(`<div class="writer-hl" aria-hidden="true"></div>`);
  ta.before(hl);
  let last = null;
  let hits = [];
  const sync = () => { hl.scrollTop = ta.scrollTop; };
  const paint = () => {
    for (const b of [...hl.children]) b.remove();
    const node = hl.firstChild;
    if (!node || !hits.length) return;
    const base = hl.getBoundingClientRect();
    const frag = document.createDocumentFragment();
    const r = document.createRange();
    for (const m of hits) {
      r.setStart(node, m.index);
      r.setEnd(node, m.index + m[0].length);
      for (const q of r.getClientRects()) {
        if (q.width < 1) continue;
        const b = document.createElement("span");
        b.className = "hl-box";
        Object.assign(b.style, { left: `${q.left - base.left + hl.scrollLeft}px`, top: `${q.top - base.top + hl.scrollTop}px`,
          width: `${q.width}px`, height: `${q.height}px` });
        frag.append(b);
      }
    }
    hl.append(frag);
    sync();
  };
  const draw = () => {
    if (ta.value === last) return;
    last = ta.value;
    hits = last.includes("[확인") ? [...last.matchAll(CHECK_RE)] : [];
    ta.classList.toggle("has-hl", hits.length > 0);
    hl.textContent = hits.length ? `${last}\n ` : "";
    paint();
  };
  ta.addEventListener("input", draw);
  ta.addEventListener("scroll", sync);
  new ResizeObserver(() => { if (hits.length) paint(); }).observe(ta); // 폭이 바뀌면 줄바꿈이 바뀜 — 다시 잼
  if (document.fonts) document.fonts.ready.then(() => { if (hits.length) paint(); });
  // AI 결과 넣기 · 되돌리기처럼 input 없이 글이 바뀌는 경우: 잠깐씩 비교(같으면 아무것도 안 함)
  const timer = setInterval(() => (ta.isConnected ? draw() : clearInterval(timer)), 700);
  draw();
}

// 미리보기: 글 조각(text node) 안의 [확인 필요: …] 를 <mark class="check-mark"> 로
function markChecks(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue.includes("[확인")) hits.push(n);
  for (const n of hits) {
    const v = n.nodeValue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of v.matchAll(CHECK_RE)) {
      frag.append(v.slice(last, m.index), Object.assign(document.createElement("mark"), { className: "check-mark", textContent: m[0],
        title: "확인이 필요한 곳 — 자료를 확인해 고친 뒤 표시를 지우세요" }));
      last = m.index + m[0].length;
    }
    if (last) n.replaceWith(frag, v.slice(last));
  }
}

function flashRange(view, ta, a, b) {
  if (!ta.offsetParent) return;
  const keep = [ta.selectionStart, ta.selectionEnd, ta.value];
  selectRange(view, ta, a, b);
  setTimeout(() => {
    if (W.ta === ta && ta.value === keep[2] && ta.selectionStart === a && ta.selectionEnd === b) ta.setSelectionRange(keep[0], keep[1]);
  }, 1200);
}

function currentHeading(ta) {
  const before = ta.value.slice(0, ta.selectionStart).split("\n").reverse();
  const h = before.find((l) => /^#{2,4}\s/.test(l));
  return h ? h.replace(/^#+\s*/, "") : "";
}

// 글쓰기 도우미 = 서버 작업 (2026-10-16 백그라운드 AI): 창 · 탭 · 앱을 닫아도 내 API 키(서버) · 연결된 내 PC(CLI)에서 끝까지
// 실행하고 결과는 7일 동안 남는다. 끝나면 알림(jobs.js), 결과는 원고 오른쪽 AI 결과 패널(aiPane — 편집기를 가리지 않음) ·
// 작업 화면에서 열어 넣는다. 넣을 때 그 사이 원고가 바뀌었으면 바뀌는 부분을 패널 안에서 보여 주고 물어본 뒤에만 바꾼다
// (writeai.js — 새 글을 몰래 덮어쓰지 않음)
// 논문 검토 · 정리 도구 (2026-10-27 사용자 요청): 고른 논문 · 붙여 넣은 글 · 원고 전체로 만드는 결과 (writeai.js TOOL_MODES).
// 메뉴 묶음은 writeaimenu.js — 작업 이름도 거기 방식 이름을 쓴다
const MODE_LABEL = Object.fromEntries([...AI_GROUPS.flatMap((g) => g.choices || []).map(([k, l]) => [k, l]),
  ["paraphrase", "표절 피해 바꿔 쓰기"], ["journal", "투고 규정 읽기"]]);
// 원고 전체를 보내는 도구 — 확인 창 문구
const WHOLE = {
  review: { title: "AI 모의 심사", ok: "모의 심사 시작", what: "AI 심사위원이 읽고 총평 · 주요 지적 · 세부 지적 · 예상 질문을 써요" },
  slides: { title: "발표 자료 만들기", ok: "발표 자료 만들기",
    what: "AI가 심사 발표용 슬라이드 12~18장(발표자 노트 포함)과 예상 질문을 만들어요. 결과에서 [PPT 파일 받기]를 누르면 PowerPoint로 받아요" },
  align: { title: "연구문제 ↔ 결론 대응 검사", ok: "검사 시작",
    what: "AI가 연구 문제 · 가설을 모두 찾아 결과 · 결론에서 답했는지 대응표(충분 · 부분 · 빠짐 · 어긋남)와 고칠 점을 써요" },
};
const REVIEW_MAX = 150000; // 모의 심사로 보내는 원고 글자 수 (긴 원고는 앞부분만)
const PASTE = {
  stats: { title: "통계 결과 → 표 · 문장", label: "분석 결과를 붙여 넣으세요 (SPSS · jamovi · R 출력, 엑셀 표 — 표를 복사해 그대로)",
    hint: "AI가 APA 형식 표와 결과 문단을 만들어 커서 자리에 넣어요. 결과에 없는 수치는 만들지 않아요.",
    placeholder: "예)\n집단통계량\n집단  N  평균  표준편차\n실험  25  4.12  0.61\n통제  25  3.71  0.70\n독립표본 검정 t=2.21 자유도 48 유의확률 .032", ok: "표 · 문장 만들기" },
  memo: { title: "메모 · 받아쓰기 → 논문 문단", label: "메모나 받아쓴 글을 붙여 넣거나, 🎤 받아쓰기로 말해 보세요",
    hint: "AI가 뜻은 그대로 두고 논문 문단으로 정리해 커서 자리에 넣어요. 근거가 필요한 곳엔 [확인 필요]를 붙여요. Windows는 Win+H로도 받아쓸 수 있어요.",
    placeholder: "예) 음 그러니까 설문 결과를 보면 남학생보다 여학생이 스트레스가 좀 더 높게 나왔고 이건 아마 학업 부담 때문인 것 같은데…", ok: "문단으로 정리", mic: true },
  response: { title: "심사 의견 대응표", label: "심사 의견을 붙여 넣으세요 (여러 개면 번호 · 줄로 나눠서)",
    hint: "AI가 의견마다 수정 내용(답변) · 수정 위치 표를 만들어요. 실제로 고친 내용은 꼭 확인해서 채우세요. 원고는 바뀌지 않아요.",
    placeholder: "예)\n1. 연구 대상의 선정 기준이 불분명함.\n2. 표 3의 효과크기를 보고할 것.", ok: "대응표 만들기" },
};

// 붙여 넣을 글 창 (통계 결과 · 메모 · 심사 의견). 메모는 브라우저 받아쓰기(Web Speech — 크롬 · 엣지)
function pasteDialog(cfg) {
  return new Promise((resolve) => {
    const body = el(`<div><label class="small" style="display:block;margin-bottom:6px">${esc(cfg.label)}</label>
      <textarea class="input paste-ta" rows="12" style="width:100%;font-family:inherit"></textarea>
      <p class="small muted" style="margin:6px 0 0">${esc(cfg.hint)}</p></div>`);
    const ta = $("textarea", body);
    ta.placeholder = cfg.placeholder;
    const foot = el(`<div style="display:contents">${cfg.mic ? `<button type="button" class="btn" data-mic aria-pressed="false">🎤 받아쓰기</button><span class="spacer"></span>` : ""}
      <button type="button" class="btn" data-no>취소</button><button type="button" class="btn primary" data-ok>${esc(cfg.ok)}</button></div>`);
    let result = null;
    let rec = null;
    const md = modal({ title: cfg.title, body, foot, onClose: () => { if (rec) rec.stop(); resolve(result); } });
    $("[data-no]", foot).onclick = () => md.close();
    $("[data-ok]", foot).onclick = () => {
      const t = ta.value.trim();
      if (t.length < 5) return toast("내용을 붙여 넣어 주세요", "error");
      result = t.slice(0, 30000);
      md.close();
    };
    const mic = $("[data-mic]", foot);
    if (mic) {
      mic.onclick = () => {
        if (rec) { rec.stop(); return; }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return toast("이 브라우저는 받아쓰기를 못 해요. 크롬 · 엣지에서 쓰거나 Windows 받아쓰기(Win+H)를 써 주세요", "error", LONG);
        rec = new SR();
        Object.assign(rec, { lang: "ko-KR", continuous: true, interimResults: false });
        rec.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) ta.value += (ta.value && !/\s$/.test(ta.value) ? " " : "") + e.results[i][0].transcript.trim();
          }
        };
        rec.onerror = (e) => toast(e.error === "not-allowed" ? "마이크 권한을 허용해 주세요" : "받아쓰기가 멈췄어요 — Windows 받아쓰기(Win+H)도 쓸 수 있어요", "error");
        rec.onend = () => { rec = null; mic.textContent = "🎤 받아쓰기"; mic.setAttribute("aria-pressed", "false"); };
        try { rec.start(); } catch { rec = null; return; }
        mic.textContent = "■ 받아쓰기 멈추기";
        mic.setAttribute("aria-pressed", "true");
      };
    }
    setTimeout(() => ta.focus(), 40);
  });
}

// 선행연구 비교표: 논문 고르기 + 열 이름
function matrixDialog(ta) {
  return new Promise((resolve) => {
    const chosen = new Set();
    const body = el(`<form><div class="field"><label>비교할 논문 (초록 · AI 요약 · 내 메모를 근거로 써요)</label>
        <div class="chips" data-keys></div><button type="button" class="btn sm" data-pick style="margin-top:6px;align-self:flex-start">＋ 논문 고르기</button></div>
      <div class="field"><label>표의 열</label><input class="input" name="cols" value="연구 대상, 연구 방법, 주요 결과, 한계"></div>
      <p class="small muted" style="margin:0">자료에 없는 칸은 '확인 필요'로 남겨요. 표와 정리 문단을 커서 자리에 넣어요.</p></form>`);
    const foot = el(`<div style="display:contents"><button type="button" class="btn" data-no>취소</button><button type="button" class="btn primary" data-ok>비교표 만들기</button></div>`);
    let result = null;
    const md = modal({ title: "선행연구 비교표", body, foot, onClose: () => resolve(result) });
    const drawKeys = () => {
      $("[data-keys]", body).innerHTML = chosen.size ? [...chosen].map((k) => `<span class="chip">@${esc(k)}</span>`).join("")
        : `<span class="small muted">아직 고른 논문이 없어요 (2~30편)</span>`;
    };
    drawKeys();
    $("[data-pick]", body).onclick = () => citePicker(ta, null, {
      preselected: [...chosen], onPick: (picked) => { picked.forEach((k) => chosen.add(k)); drawKeys(); },
    });
    $("[data-no]", foot).onclick = () => md.close();
    $("[data-ok]", foot).onclick = () => {
      if (chosen.size < 2) return toast("비교할 논문을 두 편 이상 골라 주세요", "error");
      const cols = String(new FormData(body).get("cols") || "").trim();
      result = { keys: [...chosen].slice(0, 30), instruction: cols ? `표의 열: ${cols}` : "" };
      md.close();
    };
  });
}

// 서재 대조 (writematchui.js): 고른 논문 넣기 · 바꿔 쓰기는 이 원고 편집기에서
function libraryMatch(ta, mode) {
  const view = ta.closest(".writer");
  matchDialog(ta, mode, {
    select: (a, b) => selectRange(view, ta, a, b),
    apply: (edit) => applyEdit(ta, { ...edit, selStart: edit.from + edit.text.length, selEnd: edit.from + edit.text.length }),
    paraphrase: (s, hit) => paraphrase(ta, s, hit),
  });
}

async function paraphrase(ta, s, hit) {
  if (!(await ensureAiRoute("write"))) return;
  const view = ta.closest(".writer");
  if (view) flashRange(view, ta, s.from, s.to);
  let job;
  try {
    job = (await api.post("/api/ai/write", { mode: "paraphrase", text: s.text, context: String(hit.text || "").slice(0, 6000),
      instruction: hit.citekey ? `출처 인용 표시: [@${hit.citekey}]` : "", manuscript_id: W.m ? W.m.id : null,
      ...writeAnchor(ta.value, s.from, s.to, false) })).job;
  } catch (err) { return errorToast(err); }
  trackJob(job);
  if (W.ai && W.ta === ta) W.ai.show(job, { fresh: true });
}

async function runTool(mode, ta) {
  if (mode === "memo" && ta.selectionEnd > ta.selectionStart) return runAi("memo", ta); // 고른 메모 글을 문단으로 바꿈
  if (!(await ensureAiRoute("write"))) return;
  const pos = ta.selectionEnd;
  let text = "";
  let keys = [];
  let instruction = "";
  let context = "";
  if (mode === "matrix") {
    const r = await matrixDialog(ta);
    if (!r) return;
    ({ keys, instruction } = r);
  } else if (WHOLE[mode]) {
    const w = WHOLE[mode];
    text = ta.value.trim();
    if (text.length < 300) return toast(`${w.title}을(를) 하기엔 원고가 너무 짧아요`);
    const cut = text.length > REVIEW_MAX;
    if (!(await confirmDialog(`원고 전체(${text.length.toLocaleString("ko-KR")}자)를 ${w.what}.`
      + `${cut ? ` 원고가 길어 앞 ${REVIEW_MAX.toLocaleString("ko-KR")}자만 보내요.` : ""} 원고는 바뀌지 않아요.`,
    { ok: w.ok, title: w.title }))) return;
    text = text.slice(0, REVIEW_MAX);
  } else {
    const r = await pasteDialog(PASTE[mode]);
    if (!r) return;
    text = r;
    if (mode === "response") context = outlineText(ta.value);
    if (mode === "memo") instruction = ENDING_RULES[getEnding()];
  }
  if (W.ta !== ta) return;
  let job;
  try {
    job = (await api.post("/api/ai/write", { mode, text, keys, instruction, context, manuscript_id: W.m ? W.m.id : null,
      ...writeAnchor(ta.value, pos, pos, true) })).job;
  } catch (err) { return errorToast(err); }
  trackJob(job);
  if (W.ai && W.ta === ta) {
    W.ai.target(job.id, WHOLE[mode] ? "대상: 원고 전체" : mode === "matrix" ? `논문 ${keys.length}편` : "");
    W.ai.show(job, { fresh: true });
  }
  if (W.ta === ta && ta.offsetParent && (!document.activeElement || document.activeElement === document.body)) ta.focus();
}

// at = {from, to}: 패널의 [다시 실행] — 지금 원고에서 다시 찾은 원래 글(넣을 자리)로. 없으면 고른 글 · 커서 문단
async function runAi(mode, ta, at = null) {
  // 글쓰기 도우미 경로 기준 (요약 경로 기준인 ready가 아니라 kinds.write — 품질팀 M2). 없으면 연결된 PC · API 키 안내
  if (!(await ensureAiRoute("write"))) return;
  // 영문 · 국문 초록: 보낼 글(초록 절 · 고른 글)과 넣을 자리(Abstract 제목 아래)를 따로 정함 (writeproof.js abstractPlan)
  if (ABSTRACT_MODES[mode]) {
    return startAbstract(mode, ta, { mid: W.m ? W.m.id : null, show: (job) => W.ai && W.ta === ta && W.ai.show(job, { fresh: true }) });
  }
  const insert = mode === "continue" || mode === "draft";
  // 범위: [다시 실행]은 다시 찾은 원래 글, 이어 쓰기 · 초안은 커서 자리, 나머지는 고른 범위(선택 · 문단 · 이 절 · 이 장)
  const sc = at || insert ? null : aiScope(ta.value, ta.selectionStart, ta.selectionEnd, getScope());
  if (sc && !sc.ok) return toast(sc.message);
  // 이 절 · 이 장 + 문단 모드 = 일괄 처리(문단마다 작업 하나). 문단이 하나뿐이면 그 문단만 보통 작업으로
  if (sc && (sc.kind === "section" || sc.kind === "chapter") && BATCH_MODES.has(mode) && sc.paras.length > 1) return runBatch(mode, ta, sc);
  if (sc && (sc.kind === "section" || sc.kind === "chapter") && !sc.paras.length) return toast(`${sc.label}에는 문단이 없어요`);
  const one = sc && (sc.kind === "section" || sc.kind === "chapter") ? { ...sc, ...sc.paras[0] } : sc;
  let { s, e } = at ? { s: at.from, e: at.to } : one ? { s: one.from, e: one.to } : { s: ta.selectionStart, e: ta.selectionEnd };
  let text = ta.value.slice(s, e);
  let keys = [...new Set((text.match(CITE_RE) || []).flatMap((raw) => (parseCitation(raw.slice(1, -1)) || []).map((it) => it.key)))];
  let instruction = "";
  const pos = at ? at.to : ta.selectionEnd;
  if (mode === "continue") {
    text = ta.value.slice(Math.max(0, pos - 4000), pos);
    s = e = pos;
  }
  if (mode === "draft") {
    const opts = await draftDialog(ta, keys);
    if (!opts) return;
    ({ keys, instruction } = opts);
    text = "";
    s = e = pos;
  } else if (!text.trim()) {
    return toast("다듬을 글을 선택하거나 문단 안에 커서를 두세요");
  }
  if (ENDING_MODES.has(mode)) instruction = [ENDING_RULES[getEnding()], instruction].filter(Boolean).join("\n");
  if (!insert) ({ s, e } = trimRange(ta.value, s, e)); // 서버는 글을 trim해서 저장 — 범위도 같은 글을 가리키게
  const context = mode === "draft" ? ta.value.slice(0, 3000) : "";
  // 보내기 전에 보낼 글을 편집기에서 잠깐 골라 보여 주고, 패널에 "대상: 제2장 제1절 (문단 1개 · 230자)"
  const view = ta.closest(".writer");
  if (!insert && view) flashRange(view, ta, s, e);
  const target = one ? scopeSummary({ ...one, chars: e - s, paras: one.kind === "sel" ? one.paras : [{ from: s, to: e }] }) : "";
  let job;
  try {
    job = (await api.post("/api/ai/write", { mode, text, keys, instruction, context, manuscript_id: W.m ? W.m.id : null,
      ...writeAnchor(ta.value, s, e, insert) })).job;
  } catch (err) {
    return errorToast(err);
  }
  trackJob(job);
  if (W.ai && W.ta === ta) W.ai.target(job.id, target);
  // 결과는 창(모달)이 아니라 오른쪽 AI 결과 패널에 — 편집기를 가리지 않아 기다리는 동안에도 계속 쓸 수 있음 (2026-10-17)
  if (W.ai && W.ta === ta) W.ai.show(job, { fresh: true });
  // 메뉴 · 초안 창이 닫히며 초점이 빠졌으면 편집기로 (고른 범위 · 커서는 그대로) — 기다리지 않고 바로 이어 쓰기
  if (W.ta === ta && ta.offsetParent && (!document.activeElement || document.activeElement === document.body)) ta.focus();
}

// 장 · 절 일괄 처리 (docs/specs/manuscript-ai-chat.md): 문단마다 글쓰기 작업 하나 — 시작 전에 몇 개인지 보여 주고 묻는다.
// 결과는 AI 패널 '일괄' 보기에서 문단마다 바뀐 부분 · [적용] · [건너뛰기] · [모두 적용]
async function runBatch(mode, ta, sc) {
  const items = batchItems(ta.value, sc);
  const more = sc.paras.length - items.length;
  const view = ta.closest(".writer");
  if (view) flashRange(view, ta, sc.from, sc.to);
  const ok = await confirmDialog(`${scopeSummary(sc)} — 문단 ${items.length}개를 하나씩 '${MODE_LABEL[mode]}' 할게요. `
    + `AI 작업 ${items.length}개가 만들어지고, 결과는 AI 패널 '일괄'에서 문단마다 확인하고 넣어요.`
    + `${more > 0 ? ` 한 번에 ${BATCH_MAX}개까지라 뒤 문단 ${more}개는 빠져요.` : ""}`,
  { ok: `문단 ${items.length}개 시작`, title: "장 · 절 일괄 처리" });
  if (!ok || W.ta !== ta) return;
  const instruction = ENDING_MODES.has(mode) ? ENDING_RULES[getEnding()] : "";
  let r;
  try {
    r = await api.post(`/api/manuscripts/${W.m.id}/ai-batch`, { mode, instruction, label: sc.label, doc_hash: docHash(ta.value), items });
  } catch (err) {
    return errorToast(err);
  }
  r.jobs.forEach((j) => trackJob(j));
  toast(`문단 ${r.jobs.length}개를 고치기 시작했어요. 창을 닫아도 계속돼요`, "success");
  if (W.ai && W.ta === ta) W.ai.batch(r.batch.id);
}

// AI 결과 · 그림 패널 폭 (2026-10-26 사용자 요청): 패널 왼쪽 가장자리를 끌면 넓어지고 좁아진다. ← → 키로 20px씩,
// 두 번 누르면 기본 폭. 두 패널이 같은 칸(--ai-w)이라 폭도 같이 쓰고 이 브라우저에 기억한다(writeai.js)
function paneResizer(view) {
  const st = browserStorage();
  const apply = (w) => (w == null ? view.style.removeProperty("--ai-w") : view.style.setProperty("--ai-w", paneWidthCss(w)));
  apply(st && loadPaneWidth(st));
  const cur = (aside) => Math.round(aside.getBoundingClientRect().width);
  const commit = (w) => { const c = w == null ? null : clampPaneWidth(w); apply(c); if (st) savePaneWidth(st, c); };
  for (const aside of $$("#ai-pane, #fig-pane", view)) {
    const h = el(`<div class="pane-resize" role="separator" aria-orientation="vertical" tabindex="0"
      aria-label="패널 폭 조절" title="끌어서 패널 폭 바꾸기 · 두 번 누르면 기본 폭 (← → 키도 됨)"></div>`);
    aside.prepend(h);
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const right = aside.getBoundingClientRect().right;
      h.setPointerCapture(e.pointerId);
      view.classList.add("pane-resizing");
      const move = (ev) => apply(clampPaneWidth(right - ev.clientX));
      const up = () => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
        view.classList.remove("pane-resizing");
        commit(cur(aside)); // 창 폭 때문에 줄어든 만큼이 아니라 실제로 보이는 폭을 기억
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
    h.addEventListener("dblclick", () => commit(null));
    h.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: 20, ArrowRight: -20 }[e.key];
      if (!d) return;
      e.preventDefault();
      commit(cur(aside) + d);
    });
  }
}

// ------------------------------------------------------------------ AI 결과 패널 (2026-10-17 사용자 요청)
// "AI 결과를 보면서 글을 쓸 수 있게": 결과는 편집기를 가리는 창(모달)이 아니라 편집 화면 오른쪽에 붙는 패널에 보인다.
// 참고 패널 옆 칸(.writer-body의 다섯째 칸 — 둘 다 열 수 있음, 좁으면 개요 · 미리보기 칸을 먼저 숨김). 작업이 도는 동안에도
// 편집기 · 도구 막대를 그대로 쓴다. 넣을 때 그 사이 원고가 바뀌었으면 바뀌는 부분을 패널 안에서 보여 주고 확인을 받은
// 뒤에만 바꾼다(새 글을 몰래 덮어쓰지 않음). 순수 함수(목록 · 상태 · 단추 · 넣을 모양 · 단축키)는 writeai.js
function aiPane(view, ta, m) {
  const aside = $("#ai-pane", view);
  const btn = $("[data-ai-results]", view);
  const S = {
    open: false, jobs: [], extra: null, sel: null, detail: new Map(), stop: null, watching: null, timer: null,
    confirm: null, tab: "result", key: "", offer: null, offerFor: null, notice: "", dead: false,
    view: "result", targets: new Map(), // 보기: 결과 · 일괄(장 · 절) · 대화 (docs/specs/manuscript-ai-chat.md), targets: 작업 → "대상: …"
  };
  const alive = () => !S.dead && W.m === m && W.ta === ta;
  aside.setAttribute("aria-labelledby", "ai-pane-h");
  aside.innerHTML = `<div class="ai-pane-head">
      <h2 class="ai-pane-title" id="ai-pane-h">AI 결과</h2>
      <select class="input ai-pick" data-ai-pick aria-label="볼 AI 결과 (새것이 위)"></select>
      <button type="button" class="btn sm ghost" data-ai-close title="AI 결과 패널 닫기 (Alt+A) — 만드는 중인 작업은 계속돼요">닫기</button>
    </div>
    <div class="seg ai-views" role="group" aria-label="AI 패널 보기">${[["result", "결과", "글쓰기 도우미 결과"], ["batch", "일괄", "장 · 절 일괄 처리 결과"],
      ["chat", "대화", "AI와 대화하며 원고 고치기 (Alt+C)"], ["source", "출처", "[확인 필요] 문장의 근거를 서재 · 외부 논문에서 AI가 확인"],
      ["review", "검토", "공유 링크로 받은 교수님 의견 · 고친 글 (검토본)"]].map(([v, label, title]) => `<button type="button" data-ai-view="${v}" title="${title}">${label}</button>`).join("")}</div>
    <div class="panel-body ai-pane-body" data-ai-body></div>
    <div class="panel-body ai-pane-body hidden" data-ai-batch></div>
    <div class="ai-pane-chat hidden" data-ai-chat></div>
    <div class="panel-body ai-pane-body hidden" data-ai-src></div>
    <div class="panel-body ai-pane-body hidden" data-ai-review></div>`;
  const pick = $("[data-ai-pick]", aside);
  const body = $("[data-ai-body]", aside);
  // 대화 · 일괄 보기 (writechatui.js) — 편집기 · 넣기 도우미를 넘겨줌
  const helpers = { mid: m.id, ta, alive, select: (a, b) => selectRange(view, ta, a, b), flash: (a, b) => flashRange(view, ta, a, b),
    say: (t) => sayWriter(view, t), ending: () => getEnding(), modeName: (md) => MODE_LABEL[md] || "AI 글쓰기" };
  const chatV = chatView($("[data-ai-chat]", aside), helpers);
  const batchV = batchView($("[data-ai-batch]", aside), helpers);
  // 출처 확인 (writesrcui.js): 고친 문장 넣기 전 원고를 버전 기록에
  const srcV = sourceView($("[data-ai-src]", aside), { ...helpers, replace: (from, to, text) => {
    if (W.m) saveVersion(W.m.id, ta.value);
    ta.focus();
    ta.setSelectionRange(from, to);
    insertText(ta, text);
    flashRange(view, ta, from, from + text.length);
    toast("고친 문장으로 바꿨어요 — Ctrl+Z로 되돌릴 수 있어요", "success");
  } });
  // 검토본 (writereviewui.js): 교수님이 고친 글로 바꾸기 전 원고를 버전 기록에
  const reviewV = reviewView($("[data-ai-review]", aside), { ...helpers, onCount: (n) => W.reviewCount && W.reviewCount(n),
    replace: (from, to, text) => {
      if (W.m) saveVersion(W.m.id, ta.value);
      ta.focus();
      ta.setSelectionRange(from, to);
      insertText(ta, text);
      flashRange(view, ta, from, from + text.length);
      toast("교수님이 고친 글로 바꿨어요 — Ctrl+Z로 되돌릴 수 있어요", "success");
    } });

  const merged = (j) => S.detail.get(j.id) || j;
  const list = () => {
    const all = [...S.jobs];
    if (S.extra && !all.some((j) => j.id === S.extra.id)) all.push(S.extra);
    return paneList(all.map(merged).filter((j) => !(j.write && j.write.batch))); // 일괄 처리 문단은 '일괄' 보기에서
  };
  const cur = () => list().items.find((j) => j.id === S.sel) || null;
  const here = (j) => !!j && Number(j.manuscript_id) === m.id;
  const detailed = (j) => !!(j && j.write && "text" in j.write);
  // 초록 만들기 결과는 대상 초록 표지가 원고에 없으면 표지째('**Abstract**' 등) 넣음 (writeproof.js)
  const resultText = (j) => withAbstractHeading(((j && j.write) || {}).mode, ta.value, (j && j.result && j.result.text) || "");
  const modeName = (j) => MODE_LABEL[(j.write || {}).mode] || "AI 글쓰기";
  const optionText = (j) => `${modeName(j)} · ${fmtClock(j.created_at)} · ${RESULT_STATE_TEXT[resultState(j)]}`;
  const focusEditor = () => { if (ta.offsetParent) ta.focus(); else btn.focus(); };

  const drawButton = () => {
    const l = list();
    btn.textContent = resultsButtonText(l);
    btn.classList.toggle("primary", l.ready > 0);
  };

  const stopWatch = () => {
    if (S.stop) S.stop();
    S.stop = null;
    S.watching = null;
  };
  // 고른 결과 하나를 따라감: 원래 글 · 넣을 자리(한 작업 보기에만 있음)를 받고, 만드는 중이면 중간 글 · 진행을 1.5초마다
  const watch = (j) => {
    if (!j || S.watching === j.id) return;
    stopWatch();
    if (detailed(j) && !isActive(j)) return;
    const id = j.id;
    S.watching = id;
    S.stop = watchJob(id, (x) => {
      if (!alive() || S.watching !== id) return;
      if (!x) { // 7일이 지나 지워짐
        S.jobs = S.jobs.filter((y) => y.id !== id);
        if (S.extra && S.extra.id === id) S.extra = null;
        S.detail.delete(id);
        Object.assign(S, { sel: null, notice: "그 AI 결과를 찾을 수 없어요. 7일이 지나 지워졌을 수 있어요.", watching: null, stop: null });
        draw();
        drawButton();
        return;
      }
      const prev = list().items.find((y) => y.id === id);
      S.detail.set(id, x);
      if (S.extra && S.extra.id === id) S.extra = x;
      if (!isActive(x)) {
        if (S.open && x.status === "succeeded") handledJob(x.id); // 패널에서 결과를 봤음 — 끝남 토스트는 생략
        if (prev && isActive(prev)) refresh(); // 막 끝남: 단추 숫자 · 목록을 맞춤
      }
      draw();
    });
  };

  // ---- 그리기
  const draw = () => {
    if (!S.open) return;
    const l = list().items;
    S.sel = pickResult(l, S.sel);
    const opts = l.map((j) => `<option value="${Number(j.id)}">${esc(optionText(j))}</option>`).join("");
    if (pick.dataset.opts !== opts) {
      pick.innerHTML = opts || `<option value="">아직 결과가 없어요</option>`;
      pick.dataset.opts = opts;
    }
    pick.value = S.sel == null ? "" : String(S.sel);
    pick.disabled = !l.length;
    const j = cur();
    if (j) pick.title = optionText(j); else pick.removeAttribute("title");
    watch(j);
    drawBody(j);
  };

  const drawBody = (j) => {
    const st = resultState(j);
    const c = S.confirm && j && S.confirm.id === j.id ? S.confirm : null;
    const key = [j ? j.id : "", st, detailed(j), S.tab, c ? `${c.kind}:${c.pv.from}:${c.pv.to}:${c.cur.length}` : "",
      S.offerFor === (j && j.id) ? 1 : 0, S.notice].join("|");
    if (key !== S.key) {
      S.key = key;
      build(j, st, c);
    }
    if (st === "running") live(j);
  };

  const build = (j, st, c) => {
    const focused = body.contains(document.activeElement) ? document.activeElement.dataset.act || "" : "";
    body.innerHTML = "";
    if (S.notice) body.append(el(`<div class="notice" data-tone="warn">${ICON_WARN}<div>${esc(S.notice)}</div></div>`));
    if (!j) {
      body.append(el(`<div class="ai-empty"><p>아직 이 원고의 AI 결과가 없어요.</p>
        <p class="small muted">글을 고르거나 문단에 커서를 두고 <b>✦ AI 도우미</b>에서 고르면 결과가 여기에 나와요. 결과를 옆에 둔 채 계속 쓸 수 있고, 7일 동안 남아요.</p></div>`));
      return;
    }
    const w = j.write || {};
    const insert = !!w.insert;
    const act = paneActions(j, { here: here(j) });
    const result = resultText(j);
    const ready = detailed(j);
    body.append(el(`<div class="ai-meta"><b class="ai-mode">${esc(modeName(j))}</b>
      <span class="chip ai-st" data-st="${esc(st)}">${esc(RESULT_STATE_TEXT[st] || "")}</span>
      <span class="small muted">${esc(fmtClock(j.created_at))} 시작</span></div>`));
    if (S.targets.get(j.id)) body.append(el(`<p class="small muted ai-target">${esc(S.targets.get(j.id))}</p>`)); // "대상: 제2장 제1절 (문단 1개 · 230자)"
    if (!here(j)) body.append(el(`<div class="notice" data-tone="info">${ICON_INFO}<div>다른 원고의 결과예요. 그 원고를 열어 넣거나 복사해 주세요.</div></div>`));
    if (S.offerFor === j.id && S.offer) body.append(S.offer);

    // 원래 글 (바꿀 글 · 이어 쓸 자리 앞 글) — 누르면 편집기에서 그 자리를 골라 보여 줌
    const snip = origSnippet(w, insert ? 110 : 240); // 넣기는 넣을 자리 바로 앞 글만 (4줄 안)
    if (snip) {
      const o = el(`<div class="ai-sec"><div class="ai-sec-h">${insert ? "넣을 자리 (앞 글)" : "원래 글"}</div>
        <button type="button" class="ai-orig" data-act="locate" title="눌러서 원고에서 이 자리 보기"></button></div>`);
      $(".ai-orig", o).textContent = snip;
      body.append(o);
    } else if (!ready && j.status === "succeeded") {
      body.append(el(`<div class="small muted ai-sec"><span class="spinner" aria-hidden="true"></span> 원래 글을 불러오는 중…</div>`));
    }

    // 결과 (만드는 중이면 진행 · 중간 글)
    const sec = el(`<div class="ai-sec"><div class="ai-sec-row"><span class="ai-sec-h">${st === "running" ? "만드는 중인 글" : "AI 결과"}</span></div></div>`);
    if (st === "running") {
      const line = statusLineEl(async () => { try { await cancelJob(j.id); } catch (err) { errorToast(err); } });
      $("[data-job-cancel]", line).title = "이 작업 취소 — 원고는 바뀌지 않아요";
      sec.append(line, el(`<div class="ai-out" data-ai-out></div>`));
    } else if (st === "failed" || st === "cancelled") {
      sec.append(el(`<div class="msg error">${esc(st === "failed" ? j.error || "글을 만들지 못했어요" : "작업을 취소했어요")}</div>`));
    } else if (st === "expired") {
      sec.append(el(`<div class="msg error">결과 글이 지워졌어요 (7일 보관).</div>`));
    } else if (result) {
      const canDiff = !insert && !!w.text;
      if (canDiff) {
        $(".ai-sec-row", sec).append(el(`<div class="seg ai-tabs" role="group" aria-label="결과 보기 방식">
          <button type="button" data-act="tab-result" aria-pressed="${S.tab !== "diff"}" class="${S.tab !== "diff" ? "active" : ""}">결과</button>
          <button type="button" data-act="tab-diff" aria-pressed="${S.tab === "diff"}" class="${S.tab === "diff" ? "active" : ""}">바뀐 부분</button></div>`));
      }
      const out = el(`<div data-ai-out></div>`);
      if (canDiff && S.tab === "diff") {
        out.className = "ai-diff";
        out.setAttribute("aria-label", "원래 글과 바뀐 부분");
        out.innerHTML = diffHtml(wordDiff(w.text, result.trim()));
        sec.append(out, el(`<p class="small muted ai-diff-legend"><del>지우는 글</del> · <ins>넣는 글</ins></p>`));
      } else {
        out.className = "ai-out prose";
        const deck = w.mode === "slides" ? slidesPreview(result) : null; // 발표 자료: JSON → 슬라이드 목록
        out.innerHTML = deck ?? purifyMd(window.marked.parse(result)) ?? esc(result);
        sec.append(out);
      }
    }
    body.append(sec);

    // 숫자 · 인용 대조 — AI가 다시 쓰며 바꾼 숫자 · 빠진 [@인용키] · 출력에 없는 통계 값 · 서재와 다른 연도 (엔진과 상관없이 코드로)
    if (st !== "running" && result && ready && w.mode === "matrix" && !W.papers) { // 서재 목록을 받은 뒤 다시 그림
      libraryPapers().then(() => { S.key = ""; draw(); }).catch(() => {});
    } else if (st !== "running" && result && ready) {
      for (const n of guardNotes(w, result, W.papers || [])) {
        const box = el(`<div class="notice ai-guard" data-tone="${n.tone === "info" ? "info" : "warn"}">${n.tone === "info" ? ICON_INFO : ICON_WARN}<div></div></div>`);
        box.lastElementChild.textContent = n.text;
        body.append(box);
      }
    }

    // 넣기 확인 (원고가 바뀌었음 · 자리를 못 찾음) — 창을 띄우지 않고 패널 안에서
    if (c && c.kind === "moved") {
      body.append(el(`<div class="notice ai-confirm" data-tone="warn" role="group" aria-label="원고가 바뀌었어요">${ICON_WARN}<div>
        <b>작업을 시작한 뒤 원고가 바뀌었어요.</b> ${insert ? "아래 자리에 결과를 넣을까요?" : "아래처럼 바꿀까요?"} 넣기 전에 확인해 주세요.
        <div class="ai-diff" aria-label="바뀌는 부분"><span class="muted">${c.pv.before ? `…${esc(c.pv.before)}` : ""}</span>${diffHtml(c.pv.seg)}<span class="muted">${c.pv.after ? `${esc(c.pv.after)}…` : ""}</span></div>
        <p class="small muted ai-diff-legend"><del>지우는 글</del> · <ins>넣는 글</ins></p>
        <div class="notice-actions"><button type="button" class="btn sm primary" data-act="confirm">${insert ? "이대로 넣기" : "이대로 바꾸기"}</button>
          <button type="button" class="btn sm" data-act="unconfirm">그만두기</button></div></div></div>`));
    } else if (c && c.kind === "lost") {
      body.append(el(`<div class="notice ai-confirm" data-tone="warn" role="group" aria-label="원래 자리를 찾지 못했어요">${ICON_WARN}<div>
        <b>원래 자리를 찾지 못했어요.</b> 작업을 시작한 뒤 원고가 바뀌어 ${insert ? "넣을 자리를" : "바꿀 글을"} 찾지 못했어요.
        원고를 덮어쓰지 않도록 자동으로 바꾸지 않았어요. 커서 위치에 새로 넣거나 복사해서 붙여 넣어 주세요.
        <div class="notice-actions"><button type="button" class="btn sm primary" data-act="cursor">커서 위치에 넣기</button>
          <button type="button" class="btn sm" data-act="copy">복사</button><button type="button" class="btn sm" data-act="unconfirm">그만두기</button></div></div></div>`));
    }

    // 동작 단추 (좁은 칸에서 잘리지 않게 줄바꿈)
    const acts = el(`<div class="ai-actions" role="group" aria-label="결과 동작"></div>`);
    const add = (name, label, cls, on, title = "") => {
      const b = el(`<button type="button" class="btn sm ${cls}" data-act="${name}">${esc(label)}</button>`);
      b.disabled = !on;
      if (title) b.title = title;
      acts.append(b);
    };
    const waitDetail = !ready && !!result;
    add("apply", act.applyLabel, "primary", act.apply && !waitDetail && !c,
      insert ? "원래 자리에 넣어요 — 그 사이 원고가 바뀌었으면 먼저 보여 드려요" : "원래 글을 결과로 바꿔요 — 그 사이 원고가 바뀌었으면 먼저 보여 드려요");
    add("cursor", "커서 위치에 넣기", "", act.cursor && !c, "편집기 커서 뒤에 새 문단으로 넣어요 (고른 글은 지우지 않아요)");
    add("copy", "복사", "", act.copy);
    if (w.mode === "slides" && result) add("pptx", "PPT 파일 받기", "primary", true, "PowerPoint 파일(16:9, 발표자 노트 · 예상 질문 포함)로 받아요");
    add("rerun", "다시 실행", "", act.rerun && (ready || st === "failed" || st === "cancelled"),
      st === "failed" || st === "cancelled" ? "같은 글로 새 작업을 만들어요" : "지금 원고의 같은 자리로 새 작업을 만들어요");
    if (act.dismiss) add("dismiss", "넣지 않기", "ghost", true, "결과를 원고에 넣지 않아요. 작업 화면에서 7일 동안 다시 열 수 있어요");
    body.append(acts);
    body.append(el(`<p class="small muted ai-foot">패널을 닫아도 작업은 계속돼요. 결과는 7일 동안 남고 작업 화면에서도 열 수 있어요.</p>`));
    if (focused) {
      const again = $(`[data-act="${focused}"]`, body);
      if (again && !again.disabled) again.focus();
    }
  };

  // 만드는 중: 진행 줄 · 중간 글만 바꿈(단추 · 초점은 그대로)
  const live = (j) => {
    const line = $("[data-job-line]", body);
    if (line) {
      setStatusLine(line, j, "글을 작성"); // "…API로 글을 작성하는 중"
      if (j.status === "running" && j.runner === "cli") $(".grow", line).textContent = `${j.device ? `‘${j.device.name}’` : "내 PC"}에서 글을 만드는 중 (${j.engine})`;
    }
    const out = $("[data-ai-out]", body);
    if (!out) return;
    const partial = (j.progress || {}).partial_text || "";
    if (partial && out.textContent !== partial) {
      const atEnd = out.scrollHeight - out.scrollTop - out.clientHeight < 24;
      out.textContent = partial;
      if (atEnd) out.scrollTop = out.scrollHeight;
    } else if (!partial && !out.firstChild) out.innerHTML = `<span class="typing" aria-hidden="true"><span></span><span></span><span></span></span>`;
  };

  // ---- 동작
  const markApplied = (j) => {
    const d = S.detail.get(j.id);
    if (d) S.detail.set(j.id, { ...d, write: { ...d.write, handled: "applied" } });
    S.confirm = null;
    draw();
    drawButton();
    api.post(`/api/jobs/${j.id}/handled`, { state: "applied" }).catch(() => {}).then(() => alive() && refresh());
  };
  const commit = (j, pv) => {
    if (W.m) saveVersion(W.m.id, ta.value); // 넣기 전 원고를 버전 기록에 ('AI 넣기 전')
    ta.focus();
    ta.setSelectionRange(pv.from, pv.to);
    insertText(ta, pv.next);
    toast((j.write || {}).insert ? "AI 결과를 넣었어요" : "AI 결과로 바꿨어요", "success");
    markApplied(j);
  };
  const doApply = (j) => {
    if (!alive() || !here(j)) return toast("이 원고가 열려 있을 때만 넣을 수 있어요", "error");
    const pv = applyPreview(ta.value, j.write, resultText(j));
    if (pv.state === "same") return commit(j, pv);
    S.confirm = { id: j.id, kind: pv.state, pv, cur: ta.value };
    draw();
    const first = $(pv.state === "moved" ? '[data-act="confirm"]' : '.ai-confirm [data-act="cursor"]', body);
    if (first) { first.focus(); first.scrollIntoView({ block: "nearest" }); }
    sayWriter(view, pv.state === "moved" ? "원고가 바뀌었어요. 패널에서 바뀌는 부분을 확인해 주세요" : "원래 자리를 찾지 못했어요. 커서 위치에 넣거나 복사해 주세요");
  };
  const confirmApply = (j) => {
    const c = S.confirm;
    if (!c || c.id !== j.id || c.kind !== "moved") return;
    if (ta.value !== c.cur) { // 확인하는 동안 또 바뀜 — 지금 원고로 처음부터 다시 확인
      S.confirm = null;
      toast("그 사이 원고가 또 바뀌었어요. 다시 확인해 주세요");
      return doApply(j);
    }
    commit(j, c.pv);
  };
  const atCursor = (j) => {
    if (!alive() || !here(j)) return toast("이 원고가 열려 있을 때만 넣을 수 있어요", "error");
    const at = ta.selectionEnd; // 고른 글을 덮어쓰지 않게 커서 뒤에
    if (W.m) saveVersion(W.m.id, ta.value); // 넣기 전 원고를 버전 기록에 ('AI 넣기 전')
    ta.focus();
    ta.setSelectionRange(at, at);
    insertText(ta, insertionText(ta.value, at, resultText(j), true));
    toast("커서 위치에 넣었어요", "success");
    markApplied(j);
  };
  const rerun = async (j) => {
    const plan = rerunPlan(j, ta.value);
    if (plan.how === "retry") {
      try {
        const r = await retryJob(j.id);
        trackJob(r.job);
        if (alive()) show(r.job);
      } catch (err) { errorToast(err); }
      return;
    }
    if (plan.how === "lost") return toast("원고에서 원래 글을 찾지 못했어요. 글을 고르고 ✦ AI 도우미에서 다시 실행해 주세요", "error");
    if (plan.how === "new") runAi(plan.mode, ta, { from: plan.from, to: plan.to });
  };
  const dismiss = async (j) => {
    try { await api.post(`/api/jobs/${j.id}/handled`, { state: "dismissed" }); } catch (err) { return errorToast(err); }
    toast("넣지 않았어요. 작업 화면에서 7일 동안 다시 열 수 있어요");
    const d = S.detail.get(j.id);
    if (d) S.detail.set(j.id, { ...d, write: { ...d.write, handled: "dismissed" } });
    if (alive()) refresh();
  };
  // 원래 글을 누르면 편집기에서 그 자리를 골라 보여 줌 (사용자가 누른 때만 — 쓰는 중에 커서를 옮기지 않음)
  const locate = (j) => {
    const p = planApply(ta.value, j.write || {});
    if (p.state === "lost") return toast("원고에서 원래 글을 찾지 못했어요. 그 사이 고쳐졌을 수 있어요");
    selectRange(view, ta, p.from, p.to);
  };

  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    const j = cur();
    if (!b || b.disabled || !j) return;
    const a = b.dataset.act;
    if (a === "tab-result" || a === "tab-diff") { S.tab = a === "tab-diff" ? "diff" : "result"; return draw(); }
    if (a === "unconfirm") { S.confirm = null; draw(); return $('[data-act="apply"]', body)?.focus(); }
    ({ locate, apply: doApply, confirm: confirmApply, cursor: atCursor, copy: (x) => copyText(resultText(x)), rerun, dismiss,
      pptx: (x) => downloadSlides(resultText(x), `${docTitle(ta) || "원고"}_발표`) })[a]?.(j);
  });
  pick.onchange = () => {
    const id = Number(pick.value);
    if (!id) return;
    Object.assign(S, { sel: id, tab: "result", confirm: null, notice: "" });
    draw();
  };

  // ---- 보기: 결과(글쓰기 도우미) · 일괄(장 · 절) · 대화 — 대화 · 일괄은 writechatui.js
  const setView = (v, bid = null) => {
    S.view = v;
    aside.querySelectorAll("[data-ai-view]").forEach((b) => {
      b.classList.toggle("active", b.dataset.aiView === v);
      b.setAttribute("aria-pressed", String(b.dataset.aiView === v));
    });
    body.classList.toggle("hidden", v !== "result");
    pick.classList.toggle("hidden", v !== "result");
    $("[data-ai-batch]", aside).classList.toggle("hidden", v !== "batch");
    $("[data-ai-chat]", aside).classList.toggle("hidden", v !== "chat");
    $("[data-ai-src]", aside).classList.toggle("hidden", v !== "source");
    $("[data-ai-review]", aside).classList.toggle("hidden", v !== "review");
    $("#ai-pane-h", aside).textContent = v === "review" ? "검토본" : "AI 결과";
    if (v === "review" && S.open) reviewV.show(); else reviewV.hide();
    if (v === "chat" && S.open) chatV.show(); else chatV.hide();
    if (v === "source" && S.open) srcV.show(); else srcV.hide();
    if (v === "batch" && S.open) batchV.show(bid); else batchV.hide();
  };
  $(".ai-views", aside).addEventListener("click", (e) => {
    const b = e.target.closest("[data-ai-view]");
    if (b) setView(b.dataset.aiView);
  });

  // ---- 열기 · 닫기
  const setOpen = (open, { save = true, bid = null } = {}) => {
    if (!open && aside.contains(document.activeElement)) focusEditor(); // 숨기기 전에 초점을 편집기로
    S.open = open;
    if (open) view.dataset.aiPane = "open"; else delete view.dataset.aiPane;
    btn.setAttribute("aria-pressed", String(open));
    if (save) savePaneOpen(browserStorage(), open);
    if (open) {
      S.key = "";
      draw();
      refresh();
      setView(S.view, bid);
    } else {
      stopWatch();
      setView(S.view); // 대화 · 일괄 따라가기도 멈춤 (작업은 서버에서 계속)
      Object.assign(S, { confirm: null, offer: null, offerFor: null, notice: "" });
    }
  };
  // 대화 열기 (✦ AI 도우미 메뉴 · Alt+C · 대화 끝남 알림) — 입력 칸으로
  const openChat = () => {
    if (!alive()) return;
    S.view = "chat";
    if (!S.open) setOpen(true); else setView("chat");
    chatV.focus();
  };
  // 일괄 처리 보기 (방금 만든 묶음 bid)
  const openBatch = (bid) => {
    if (!alive()) return;
    S.view = "batch";
    if (!S.open) setOpen(true, { bid }); else setView("batch", bid);
    sayWriter(view, "AI 패널 '일괄'에서 문단마다 진행을 보여 드려요. 계속 쓰셔도 돼요");
  };
  // 검토 보기 ([의견] · 원고 목록의 검토본 줄)
  const openReview = () => {
    if (!alive()) return;
    S.view = "review";
    if (!S.open) setOpen(true); else setView("review");
  };
  // 출처 확인 보기: claim(문장)이면 새로 확인, job이면 그 결과
  const openSource = (claim, job = null) => {
    if (!alive()) return;
    S.view = "source";
    if (!S.open) setOpen(true); else setView("source");
    if (job) srcV.open(job);
    else if (claim !== undefined) srcV.start(claim);
  };
  const show = (job, { fresh = false } = {}) => {
    if (!alive() || !job) return;
    if (job.kind === "ms_chat") return openChat(); // 원고 AI 대화 답 (끝남 알림 [열기])
    if (job.kind === "find") return openSource(undefined, job); // 출처 확인 결과
    if (job.write && job.write.batch) return openBatch(job.write.batch.id); // 일괄 처리의 문단 하나
    if (S.view !== "result") setView("result");
    if (!S.jobs.some((x) => x.id === job.id)) S.extra = job; // 목록을 다시 받기 전 · 다른 원고의 결과
    Object.assign(S, { sel: job.id, tab: "result", confirm: null, notice: "", key: "" });
    S.offer = fresh ? notifyOffer() : null;
    S.offerFor = S.offer ? job.id : null;
    // 알림 안내의 [알림 켜기] · [괜찮아요]를 누르면 다시 그릴 때 또 붙이지 않게 비운다 (품질팀 지적)
    if (S.offer) S.offer.addEventListener("click", (e) => {
      if (e.target.closest("[data-notify-yes], [data-notify-no]")) { S.offer = null; S.offerFor = null; }
    });
    if (fresh) nudgeDesktop(job);
    if (S.watching === job.id) stopWatch();
    if (!S.open) setOpen(true);
    else { draw(); refresh(); }
    sayWriter(view, fresh ? "AI 결과 패널에서 진행을 보여 드려요. 계속 쓰셔도 돼요" : "AI 결과 패널에서 열었어요");
  };

  // 이 원고의 결과 목록(7일): 만드는 중이 있으면 5초마다(탭이 숨으면 15초) 다시 받음
  const refresh = async () => {
    clearTimeout(S.timer);
    let data;
    // 일괄 처리 문단(최대 30개)이 섞여도 보통 결과가 밀려나지 않게 넉넉히 받고 목록에서 뺀다(list)
    try { data = await api.get(`/api/jobs${qs({ status: "recent", kind: "write", manuscript_id: m.id, limit: 80 })}`); } catch { return; }
    if (!alive()) return;
    S.jobs = data.jobs;
    for (const j of data.jobs) { // 한 작업 보기(원래 글 · 넣을 자리)는 두고 상태 · 결과 · 넣었는지만 새로
      const d = S.detail.get(j.id);
      if (d && S.watching !== j.id) S.detail.set(j.id, { ...d, ...j, write: { ...d.write, ...j.write } });
    }
    drawButton();
    draw();
    if (list().active) S.timer = setTimeout(refresh, document.hidden ? 15000 : 5000);
  };

  btn.onclick = (e) => {
    e.stopPropagation();
    setOpen(!S.open);
  };
  $("[data-ai-close]", aside).onclick = () => setOpen(false);
  // Alt+A: 열기 · 닫기 (열 때 초점은 그대로 — 쓰던 글을 끊지 않음). Esc: 초점이 패널 안일 때만 닫기
  const onKey = (e) => {
    if (isChatKey(e) && !modalOpen() && alive()) { e.preventDefault(); return openChat(); } // Alt+C: AI 대화 (macOS ç 막기)
    const a = paneKeyAction(e, { open: S.open, inside: aside.contains(document.activeElement), modal: modalOpen() });
    if (!a || !alive()) return;
    e.preventDefault(); // macOS Option+A의 å 막기
    if (a === "toggle") setOpen(!S.open);
    else setOpen(false);
  };
  document.addEventListener("keydown", onKey);
  const onOpenJob = (e) => { // 끝남 알림 [열기] · 작업 화면 [원고에 넣기] — 같은 원고면 다시 불러오지 않고 이 패널에서
    const j = e.detail;
    if (!j || (j.kind !== "write" && j.kind !== "ms_chat" && !(j.kind === "find" && j.find_mode === "claim")) || !alive()
      || Number(j.manuscript_id) !== m.id) return;
    e.preventDefault();
    show(j);
  };
  window.addEventListener("paperlab:open-job", onOpenJob);

  drawButton();
  setView("result");
  if (loadPaneOpen(browserStorage())) setOpen(true, { save: false });
  else refresh();
  return {
    refresh, show,
    toggle: () => setOpen(!S.open),
    chat: openChat, batch: openBatch, source: (claim) => openSource(claim ?? null), review: openReview,
    target: (id, text) => { if (text) S.targets.set(id, text); }, // 보낸 범위 한 줄 (이 화면에서 만든 결과만)
    destroy: () => {
      S.dead = true;
      clearTimeout(S.timer);
      stopWatch();
      chatV.destroy();
      batchV.destroy();
      srcV.hide();
      reviewV.destroy();
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("paperlab:open-job", onOpenJob);
    },
  };
}

// #/write/원고/j작업 (끝남 알림 · 작업 화면 [원고에 넣기]에서 옴): AI 결과 패널에서 그 결과를 열고 주소는 원고 주소로 되돌림
async function openAiJobFromHash(m, ta) {
  const hit = location.hash.match(/^#\/write\/\d+\/j(\d+)$/);
  if (!hit) return;
  history.replaceState(history.state, "", `#/write/${m.id}`);
  let job;
  try { job = await api.get(`/api/jobs/${Number(hit[1])}`); } catch (err) { return errorToast(err); }
  if (W.m !== m || W.ta !== ta || (job.kind !== "write" && job.kind !== "ms_chat" && job.kind !== "find")) return; // ms_chat: 원고 AI 대화 답 · find: 출처 확인
  if (W.ai) W.ai.show(job);
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
  popupMenu(anchor, exportItems(view, ta)).classList.add("export-menu");
}

function exportItems(view, ta) {
  const fmtName = `양식: ${(W.fmt && W.fmt.entry && W.fmt.entry.name) || "기본 (A4)"}`;
  return [
    { label: "워드 (.docx)", sub: fmtName, action: () => exportAs("docx", view, ta) },
    { label: "한글 (.hwpx)", sub: fmtName, action: () => exportAs("hwpx", view, ta) },
    { label: "PDF (.pdf)", sub: `${fmtName} · 워드 파일을 서버에서 PDF로`, action: () => exportAs("pdf", view, ta) },
    { label: "마크다운 (.md)", sub: "각주 포함 · 양식과 무관", action: () => exportAs("md", view, ta) },
    "-",
    { label: "서식 그대로 복사", sub: "붙여넣기용", action: () => copyFormatted(view) },
  ];
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

// 발표 자료 (2026-10-27): 패널 미리보기 · PPT 파일 받기(서버 /api/slides)
const slidesPreview = (text) => slidesHtml(text, esc);
async function downloadSlides(text, name) {
  try {
    const res = await api.raw("POST", "/api/slides", { data: text, filename: name });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "PPT 파일을 만들지 못했어요");
    downloadBlob(await res.blob(), `${name.replace(/[\\/:*?"<>|]+/g, "_")}.pptx`);
    toast("PPT 파일로 저장했어요 — 발표자 노트와 예상 질문이 들어 있어요", "success");
  } catch (e) { errorToast(e); }
}

// opts.redline = 비교할 지난 버전 글 → 바뀐 곳을 워드 변경 내용 추적으로 (writeredline.js · 서버 writer.redline_docx)
async function exportAs(format, view, ta, opts = {}) {
  if (W.saver) await W.saver.flush();
  const office = format === "docx" || format === "hwpx" || format === "pdf";
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
    let source = ta.value;
    if (opts.redline != null) {
      const r = redlineMarkdown(opts.redline, ta.value);
      if (!r.ins && !r.del) return toast("이 버전과 지금 원고가 같아요");
      source = r.text;
    }
    const built = await buildDocument(source, { style: currentStyle(view), koreanFirst: state.settings.korean_first !== false,
      chapterNumbers: !!(W.m && W.m.cover && W.m.cover.caption_numbering === "chapter") });
    if (built.missingKeys.length && !(await confirmDialog(
      `서재에 없는 인용 키가 있어요: ${built.missingKeys.join(", ")}\n그대로 표시해서 내보낼까요?`, { ok: "그대로 내보내기" }))) return;
    const title = $("[data-title]", view).textContent.trim() || "원고";
    // manuscript_id: 서버가 이 원고의 그림 폴더에서 그림을 읽어 넣는다(그림 바이트는 보내지 않음)
    const blocks = office ? await equationFigures(built.blocks, W.m.id) : built.blocks;
    const payload = { format, blocks: stripWarn(blocks), meta: { title }, filename: opts.redline != null ? `${title}_수정표시` : title,
      manuscript_id: W.m.id, ...(opts.redline != null ? { redline: true } : {}) };
    if (office && fmtId !== "default") {
      // 표지의 국문 제목 기본값은 원고의 # 제목 (없으면 빈 칸으로 두어 ○○○로 들어가게)
      Object.assign(payload, { doc_format: fmtId, cover: W.m.cover || {}, meta: { title: docTitle(ta) } });
    }
    if (format === "pdf") toast("PDF로 바꾸는 중이에요 (몇 초 걸려요)…");
    const res = await api.raw("POST", "/api/export-document", payload);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "내보내지 못했어요");
    downloadBlob(await res.blob(), `${payload.filename.replace(/[\\/:*?"<>|]+/g, "_")}.${format}`);
    if (opts.redline != null) {
      toast(`수정 표시 워드로 저장했어요 (${opts.versionName} → 지금). 워드의 [검토] 탭에서 변경 내용을 보거나 적용할 수 있어요`, "success", LONG);
      return;
    }
    const label = { hwpx: "한글", docx: "워드", pdf: "PDF" }[format] || "마크다운";
    if (office && kind !== "none" && fmtId !== "default") {
      toast(`${label} 파일로 저장했어요 · ${listsNotice(format, W.m.cover)}`, "success", LONG); // 목차 안내 (formats.js)
    } else toast(`${label} 파일로 저장했어요`, "success");
    const warnings = exportWarnings(res);
    if (warnings.length) toast(warningText(warnings, kind), "", LONG);
    if ((format === "docx" || format === "pdf") && fmtId !== "default" && !hancomNoticeShown.has(fmtId) && usesHancomFonts(W.fmt && W.fmt.data)) {
      hancomNoticeShown.add(fmtId);
      toast(format === "pdf" ? "PDF는 서버에 있는 글꼴로 만들어요. 휴먼명조 같은 한컴 글꼴은 비슷한 글꼴로 바뀔 수 있으니 제출 전에 확인하세요"
        : "휴먼명조 같은 한컴 글꼴이 없는 PC의 워드에서는 비슷한 다른 글꼴로 보여요. 제출 파일은 한컴오피스가 설치된 PC에서 확인하세요", "", LONG);
    }
  } catch (e) { errorToast(e); }
}

// 줄 수식 블록 → 그림 블록(수식 + 오른쪽 번호를 그린 PNG를 이 원고 그림 폴더에 올림, 캡션 없음 — 그림 목차에 안 들어감).
// 같은 수식 · 번호는 이 창에서 한 번만 올린다. 마크다운 내보내기는 수식 그대로($$ … $$)
const eqUploads = new Map();
async function equationFigures(blocks, mid) {
  const out = [];
  for (const b of blocks) {
    if (b.type !== "equation") { out.push(b); continue; }
    const key = `${mid}|${b.number}|${b.tex}`;
    if (!eqUploads.has(key)) eqUploads.set(key, uploadFigure(mid, await equationPng(b.tex, String(b.number))).then((r) => r.name));
    try { out.push({ type: "figure", src: await eqUploads.get(key), alt: b.tex.slice(0, 200), caption: [] }); } catch (e) {
      eqUploads.delete(key);
      throw e;
    }
  }
  return out;
}

function stripWarn(blocks) {
  const clean = (runs) => runs.map(({ warn, cite, xref, math, ...r }) => (r.footnote ? { ...r, footnote: clean(r.footnote) } : r));
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
      const r = await renderClusters(scan.items, scan.citations, { style, koreanFirst: state.settings.korean_first !== false,
      chapterNumbers: !!(W.m && W.m.cover && W.m.cover.caption_numbering === "chapter") });
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
