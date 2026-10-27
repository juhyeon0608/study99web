// 제출 전 점검표 (docs/specs/writing-checklist.md): 원고(마크다운)를 양식 · 번호 · 인용 · 글 다듬기 규칙으로 살펴
// 고칠 곳 목록을 만든다. AI를 부르지 않고, 인용 정보 · 인용 검증 결과는 화면이 이미 받아 둔 값을 받아 쓴다.
// DOM · 네트워크를 쓰지 않는 순수 함수 — Node에서 그대로 시험한다(tests/js/writecheck.test.mjs). 화면은 writecheckui.js
//
// 결과 항목: { sev: "must" | "warn", group: "format" | "number" | "cite" | "text", code, msg, from, to, action? }
// from · to = 원고 글자 위치([이동]이 고를 범위, 양식 전체에 대한 항목은 null). action = 고치기 단추(ACTION_NAMES)

import { CITE_RE, parseCitation } from "./refquote.js";
import { XREF_RE, captionInfo, figureInfo, findFigures, findTables, renumberHeadings } from "./writeedit.js";
import { termIssues } from "./writeterms.js"; // 용어 통일 (2026-10-27)
import { journalIssues } from "./writejournal.js"; // 학술지 투고 규정 (2026-10-27)

export const SEVERITY = [["must", "꼭 고칠 것"], ["warn", "확인 권장"]];
export const GROUP_NAMES = { format: "양식", number: "번호", cite: "인용", text: "글", term: "용어" };
export const ACTION_NAMES = { cover: "표지 정보", renumber: "번호 다시 매기기", spaces: "모두 고치기", verify: "인용 검증",
  glossary: "용어집대로 모두 바꾸기", journal: "투고 규정" };
// 표지가 있는 양식(표지 종류)별 규칙. 분량 · 장 순서는 인하대 대체 보고서 안내(분량 30쪽 이상, 서론 · 본론 · 결론 순)
export const FORMAT_RULES = {
  thesis: { order: true, abstract: true, minPages: 0 },
  report: { order: true, abstract: false, minPages: 30 },
};
export const LIMITS = { paragraph: 1200, paragraphEn: 2000, perCode: 20 };
const BIB_MARKERS = ["[참고문헌]", "[References]", "[Bibliography]", "[REFERENCES]"]; // writing.js와 같게
const PT_PER_MM = 72 / 25.4;
// 기본 (A4) 양식 값 (doc_formats.py _DEFAULT) — 양식 값을 못 받았을 때 분량 추정에 쓴다
const A4 = {
  page: { width_mm: 210, height_mm: 297, margin_mm: { top: 12.7, bottom: 12.7, left: 30, right: 30 }, header_mm: 12.3, footer_mm: 12.3 },
  body: { size_pt: 11, line_spacing_pct: 160, space_after_pt: 6 },
  title: { show: true, size_pt: 18 },
  headings: { 1: { size_pt: 14 }, 2: { size_pt: 12 }, 3: { size_pt: 11 } },
  bibliography: { size_pt: 11, new_page: false },
  page_number: { show: false, start: "document" },
};
// 표지 항목 이름 (formats.js COVER_FIELD_NAMES와 같게)
const COVER_NAMES = { title_ko: "국문 제목", title_en: "영문 제목", name: "이름", department: "학과", graduation: "졸업 연월",
  degree_field: "학위명", advisors: "지도교수" };
// 원고 템플릿(manuscripts.py)의 안내 글 — 남아 있으면 고칠 것
const PLACEHOLDERS = ["제목을 입력하세요", "연구의 목적, 방법, 주요 결과, 시사점을 300~500자로 요약합니다", "키워드1, 키워드2",
  "연구의 배경과 필요성을 쓰고, 선행연구를 인용합니다", "리뷰의 범위와 문헌 선정 기준을 밝힙니다",
  "State the problem, approach, key results", "keyword1, keyword2", "Motivate the problem and summarize prior work"];
const PLACEHOLDER_TITLES = ["논문 제목", "학위논문 제목", "문헌 리뷰 제목", "Paper Title", "제목을 입력하세요"];
const FIG_PLACEHOLDERS = ["그림 설명", "Figure caption"]; // 그림 넣기가 골라 두는 글 (writing.js insertFigures)
const FRONT_BACK_RE = /(초\s*록|요\s*약|abstract|목\s*차|차\s*례|contents|참고\s*문헌|references|bibliography|부\s*록|appendix|감사의\s*글|acknowledg)/i;
const INTRO_RE = /(서\s*론|들어가며|머리말|도입|introduction)/i;
const CONCL_RE = /(결\s*론|맺음말|마치며|나가며|conclusion)/i;
const ABS_KO_RE = /^(?:국문\s*)?(?:초\s*록|요\s*약)(?:\s*[(（].*)?$/;
const ABS_EN_RE = /^abstract\b/i;
const CH_RE = /^제\s*(\d+)\s*장(?=\s|$)/;
const SEC_RE = /^제\s*(\d+)\s*절(?=\s|$)/;
const BLANK_RE = /^\s*$/;
const FENCE_RE = /^\s{0,3}(```|~~~)/;
const LIST_RE = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;
const HEAD_RE = /^(#{1,6})(?:[ \t]+(.*))?$/;
const isTableLine = (l) => /^\s*\|/.test(l);

// ------------------------------------------------------------- 원고 읽기
// 줄 · 줄 시작 위치 · 코드 블록(``` 줄 포함) 여부
function scan(text) {
  const lines = text.split("\n");
  const starts = [];
  const fence = [];
  let pos = 0;
  let inFence = false;
  for (const l of lines) {
    starts.push(pos);
    pos += l.length + 1;
    if (FENCE_RE.test(l)) { fence.push(true); inFence = !inFence; } else fence.push(inFence);
  }
  return { text, lines, starts, fence };
}

// 제목 줄 → [{ level, text, line, from, to }] (끝의 닫는 # 은 뺌)
function headings(sc) {
  const out = [];
  sc.lines.forEach((l, i) => {
    if (sc.fence[i]) return;
    const m = HEAD_RE.exec(l);
    if (!m) return;
    const text = (m[2] || "").replace(/[ \t]+#+[ \t]*$/, "").trim();
    out.push({ level: m[1].length, text, line: i, from: sc.starts[i], to: sc.starts[i] + l.length });
  });
  return out;
}

// 번호(제N장 · 1. · 1.1)를 뗀 제목 글
const bareTitle = (t) => t.replace(/^제\s*\d+\s*[장절]\s*/, "").replace(/^\d+(?:\.\d+)*\.?\s+/, "").trim();
const isBib = (l) => BIB_MARKERS.includes(l.trim());

// 인용 표시 → [{ raw, items | null, from, to }] (코드 블록 밖)
function citations(sc) {
  const out = [];
  sc.lines.forEach((l, i) => {
    if (sc.fence[i]) return;
    for (const m of l.matchAll(CITE_RE)) {
      out.push({ raw: m[0], items: parseCitation(m[1]), from: sc.starts[i] + m.index, to: sc.starts[i] + m.index + m[0].length });
    }
  });
  return out;
}

// 줄 번호 찾기 (위치 → 줄)
function lineOf(sc, pos) {
  let lo = 0;
  let hi = sc.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sc.starts[mid] <= pos) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// 빈 줄로 나뉜 덩어리(코드 블록 밖) → [{ first, last }] 줄 번호
function blocks(sc) {
  const out = [];
  let cur = null;
  sc.lines.forEach((l, i) => {
    if (sc.fence[i] || BLANK_RE.test(l)) { cur = null; return; }
    if (!cur) { cur = { first: i, last: i }; out.push(cur); } else cur.last = i;
  });
  return out;
}

// ------------------------------------------------------------- 분량 추정
// 줄 수 추정 (doc_formats.estimate_lines와 같은 셈): 한글 · 한자 · 전각 = 글자 크기 × 1.0, 영문 · 숫자 · 기호 × 0.55, 공백 × 0.3
export function estimateLines(text, sizePt, widthPt) {
  let total = 0;
  for (const ch of String(text || "")) {
    const c = ch.codePointAt(0);
    if (ch === " ") total += 0.3;
    else if (c >= 0x1100 && !(c >= 0x2000 && c <= 0x206f)) total += 1;
    else total += 0.55;
  }
  if (!total) return 0;
  return Math.max(1, Math.ceil((total * sizePt) / Math.max(widthPt, 1) - 1e-9));
}

// 화면에 보이는 글만 (인용 표시 → 짧은 자리 글, 상호 참조 → "그림 1", 마크다운 기호 빼기)
function plain(s) {
  return String(s)
    .replace(CITE_RE, "(Kim, 2020)")
    .replace(XREF_RE, "그림 1")
    .replace(/!\[((?:\\.|[^\]\\])*)\]\([^)]*\)(?:\{#[^}]*\})?/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\{#(?:fig|tbl):[^}]*\}/g, "")
    .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d{1,9}[.)]\s+)/, "")
    .replace(/[*_`]/g, "");
}

// 본문 쪽 수 추정 (표지류 제외). 양식의 용지 · 여백 · 글자 크기 · 줄간격 · 장 새 쪽 · 참고문헌 새 쪽을 반영한 대략값.
// 그림 = 쓸 수 있는 높이의 1/3, 표 = 줄마다 본문 한 줄, 참고문헌 = 인용 문헌마다 두 줄
export function estimatePages(text, data, { refs = null } = {}) {
  const d = data && data.page && data.body ? data : A4;
  const p = d.page;
  const mg = p.margin_mm || {};
  const usableW = p.width_mm - (mg.left || 0) - (mg.right || 0) - (p.gutter_mm || 0);
  const usableH = Math.max(20, p.height_mm - (mg.top || 0) - (mg.bottom || 0) - (p.header_mm || 0) - (p.footer_mm || 0));
  const widthPt = usableW * PT_PER_MM;
  const bodySize = d.body.size_pt || 11;
  const bodyPct = d.body.line_spacing_pct || 160;
  const pitch = (size, pct) => (size * (pct || bodyPct)) / 100 / PT_PER_MM;
  const bodyPitch = pitch(bodySize, bodyPct);
  const after = (st) => ((st && (st.space_before_pt || 0)) + (st && (st.space_after_pt || 0))) / PT_PER_MM;
  let pages = 0;
  let used = 0;
  const add = (mm) => { used += mm; };
  const brk = () => { if (used > 0.01) pages += Math.ceil(used / usableH - 1e-9); used = 0; };
  const sc = scan(text);
  const cites = citations(sc);
  const nRefs = refs != null ? refs : new Set(cites.flatMap((c) => (c.items || []).map((it) => it.key))).size;
  const bib = d.bibliography || {};
  const addBib = () => {
    if (!nRefs) return;
    if (bib.new_page) brk();
    add(pitch(bib.size_pt || bodySize, bib.line_spacing_pct) * 2 * nRefs + bodyPitch * 2);
  };
  let bibDone = false;
  let para = "";
  const flush = () => {
    if (!para.trim()) { para = ""; return; }
    add(estimateLines(plain(para), bodySize, widthPt) * bodyPitch + after(d.body));
    para = "";
  };
  let chars = 0;
  sc.lines.forEach((l, i) => {
    if (sc.fence[i]) {
      flush();
      if (!FENCE_RE.test(l)) add(bodyPitch);
      return;
    }
    if (BLANK_RE.test(l)) return flush();
    const t = l.trim();
    if (isBib(t)) { flush(); addBib(); bibDone = true; return; }
    const h = HEAD_RE.exec(l);
    if (h) {
      flush();
      const level = h[1].length;
      if (level === 1) {
        if (!d.title || d.title.show === false) return; // 표지 양식: # 제목은 본문에 넣지 않음
        add(pitch(d.title.size_pt || 18, 120) + after(d.title));
        return;
      }
      const st = (d.headings || {})[String(Math.min(level - 1, 3))] || {};
      if (st.page_break_before) brk();
      add(estimateLines(plain(h[2] || ""), st.size_pt || bodySize, widthPt) * pitch(st.size_pt || bodySize, st.line_spacing_pct) + after(st));
      chars += (h[2] || "").replace(/\s/g, "").length;
      return;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); brk(); return; } // --- 쪽 나눔
    if (figureInfo(t)) { flush(); add(usableH / 3 + bodyPitch); return; }
    if (isTableLine(l)) {
      flush();
      if (!/^[\s|:-]+$/.test(l)) add(bodyPitch);
      return;
    }
    if (captionInfo(t)) { flush(); add(bodyPitch); return; }
    if (LIST_RE.test(l)) flush();
    para += ` ${l}`;
    chars += plain(l).replace(/\s/g, "").length;
  });
  flush();
  if (!bibDone) addBib();
  brk();
  return { pages, chars };
}

// ------------------------------------------------------------- 고치기 (순수)
// 낱말 사이 두 칸 이상 띄어쓰기 → 한 칸 (줄 앞 들여쓰기 · 줄 끝 · 코드 블록 · 표 줄은 그대로)
const DOUBLE_SPACE_RE = /(?<=\S) {2,}(?=\S)/g;
export function fixDoubleSpaces(text) {
  const sc = scan(text);
  return sc.lines.map((l, i) => (sc.fence[i] || isTableLine(l) ? l : l.replace(DOUBLE_SPACE_RE, " "))).join("\n");
}
export { renumberHeadings };

// ------------------------------------------------------------- 괄호 · 따옴표 짝
const OPEN = { "(": ")", "[": "]", "{": "}", "“": "”", "‘": "’", "「": "」", "『": "』", "《": "》", "〈": "〉", "【": "】" };
const CLOSE = Object.fromEntries(Object.entries(OPEN).map(([o, c]) => [c, o]));
// "1)" · "가)" · "a)" · "ii)" 같은 항목 번호의 닫는 괄호는 짝을 찾지 않는다
const ENUM_BEFORE_RE = /(?:^|[\s~,·(])(?:\d{1,3}|[가-힣]|[a-zA-Z]|[ivxIVX]{1,4})$/;

// 글 한 덩어리의 첫 번째 짝 문제 → { at, msg } | null. 인라인 코드(`…`) 안과 \ 로 이스케이프한 글자는 건너뛴다
export function bracketProblem(s) {
  const stack = [];
  let quote = -1;
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "`") { code = !code; continue; }
    if (code) continue;
    if (ch === '"') { quote = quote < 0 ? i : -1; continue; }
    if (OPEN[ch]) { stack.push({ ch, at: i }); continue; }
    const want = CLOSE[ch];
    if (!want) continue;
    if (stack.length && stack[stack.length - 1].ch === want) { stack.pop(); continue; }
    const k = stack.map((x) => x.ch).lastIndexOf(want);
    if (k >= 0) { // 안쪽에 닫히지 않은 괄호가 있음
      const inner = stack[k + 1];
      return { at: inner.at, msg: `여는 '${inner.ch}'의 짝이 없어요` };
    }
    if (ch === ")" && ENUM_BEFORE_RE.test(s.slice(Math.max(0, i - 6), i))) continue;
    if (ch === "’") continue; // 영어 아포스트로피 (don’t)
    return { at: i, msg: `닫는 '${ch}'의 짝이 없어요` };
  }
  if (stack.length) return { at: stack[0].at, msg: `여는 '${stack[0].ch}'의 짝이 없어요` };
  if (quote >= 0) return { at: quote, msg: `큰따옴표(")의 짝이 맞지 않아요` };
  return null;
}

// ------------------------------------------------------------- 점검
const item = (sev, group, code, msg, from = null, to = null, action = undefined) => {
  const it = { sev, group, code, msg, from, to };
  if (action) it.action = action;
  return it;
};

// opts: { coverKind, cover, format(양식 값 — 없으면 A4), items(인용키 → CSL | null, 모르는 키는 없음), issues(인용키 → 빈 항목),
//         verify(GET …/verify 결과), lexer(marked.lexer — 없으면 줄 규칙) }
export function checkManuscript(text, opts = {}) {
  const value = String(text || "");
  const sc = scan(value);
  const heads = headings(sc);
  const cites = citations(sc);
  const out = [];
  const push = (...a) => out.push(item(...a));
  const kind = opts.coverKind || "none";
  const rules = FORMAT_RULES[kind] || null;
  const data = opts.format && opts.format.page ? opts.format : null;
  const keys = [...new Set(cites.flatMap((c) => (c.items || []).map((it) => it.key)))];
  const bibLines = sc.lines.map((l, i) => (!sc.fence[i] && isBib(l) ? i : -1)).filter((i) => i >= 0);
  const est = estimatePages(value, data, { refs: keys.length });

  checkFormat();
  checkHeadings();
  checkFigures();
  checkCitations();
  checkText();
  for (const t of termIssues(value, (opts.cover && opts.cover.glossary) || [])) push(t.sev, "term", t.code, t.msg, t.from, t.to, t.action);
  if (opts.cover && opts.cover.journal) {
    for (const t of journalIssues(value, opts.cover.journal, { pages: est.pages, chars: est.chars, refs: keys.length, style: opts.style })) {
      const at = t.at == null || t.at < 0 ? null : t.at;
      push(t.sev, "format", t.code, t.msg, at, at, "journal");
    }
  }
  return finish(out, { pages: est.pages, chars: est.chars, minPages: (rules && rules.minPages) || 0, cites: cites.length, refs: keys.length });

  // ----- 양식: 표지 · 분량 · 장 순서 · 초록
  function checkFormat() {
    const title = heads.find((h) => h.level === 1);
    if (title && PLACEHOLDER_TITLES.includes(title.text)) {
      push("must", "text", "placeholder-title", "논문 제목이 템플릿 글 그대로예요", title.from, title.to);
    }
    if (kind === "thesis" || kind === "report") {
      const c = opts.cover || {};
      const inc = { front: true, inner: true, approval: true, ...(c.include || {}) };
      const blank = (k) => !String(c[k] || "").trim();
      const missing = [];
      if (inc.front || inc.inner) {
        if (blank("title_ko") && !(title && title.text)) missing.push("title_ko");
        for (const k of ["title_en", "name", "department", "graduation"]) if (blank(k)) missing.push(k);
        if (kind === "thesis" && blank("degree_field")) missing.push("degree_field");
      } else if (inc.approval && blank("name")) missing.push("name");
      if (inc.inner && !(c.advisors || []).some((a) => String(a || "").trim())) missing.push("advisors");
      if (missing.length) {
        push("must", "format", "cover-missing", `표지에 ○○○로 들어가요 — ${missing.map((k) => COVER_NAMES[k]).join(" · ")}`, null, null, "cover");
      }
      const need = c.degree === "doctor" && kind === "thesis" ? 5 : 3;
      const named = (c.committee || []).filter((n) => String(n || "").trim()).length;
      if (inc.approval && named < need) {
        push("warn", "format", "cover-committee", `${kind === "report" ? "인준서" : "인정서"}의 심사위원 이름이 ${need - named}칸 비어 있어요`, null, null, "cover");
      }
    }
    if (rules && rules.minPages && est.pages < rules.minPages) {
      push("must", "format", "min-pages", `본문이 약 ${est.pages}쪽이에요 — 이 양식은 ${rules.minPages}쪽 이상이에요 (글자 수 · 양식 설정으로 어림한 값이라 워드 · 한글에서 확인해 주세요)`);
    }
    if (!rules) return;
    const chapters = heads.filter((h) => h.level === 2);
    const body = chapters.filter((h) => !FRONT_BACK_RE.test(bareTitle(h.text)));
    if (!body.length) {
      push("must", "format", "no-chapters", "장 제목(## 제1장 서론)이 하나도 없어요");
    } else if (rules.order) {
      const first = body[0];
      const last = body[body.length - 1];
      if (!INTRO_RE.test(first.text)) push("warn", "format", "order-intro", `첫 장이 서론이 아니에요 — '${first.text}'`, first.from, first.to);
      if (body.length > 1 && !CONCL_RE.test(last.text)) push("warn", "format", "order-conclusion", `마지막 장이 결론이 아니에요 — '${last.text}'`, last.from, last.to);
      if (bibLines.length) {
        const after = body.find((h) => h.line > bibLines[0]);
        if (after) push("warn", "format", "order-bib", `참고문헌 뒤에 본문 장이 있어요 — 참고문헌은 본문 뒤, 부록 앞에 둬요`, after.from, after.to);
      }
    }
    if (!cites.length) push("must", "cite", "no-references", "인용이 하나도 없어 참고문헌이 비어요");
    if (rules.abstract) {
      const titled = [...heads.map((h) => ({ t: bareTitle(h.text), h })),
        ...sc.lines.map((l, i) => ({ l, i })).filter(({ l, i }) => !sc.fence[i] && /^\s*\*\*[^*]+\*\*/.test(l))
          .map(({ l, i }) => ({ t: l.trim().replace(/^\*\*([^*]+)\*\*.*$/, "$1").trim(), h: null, i }))];
      if (!titled.some((x) => ABS_KO_RE.test(x.t) || /^국문\s*(초\s*록|요\s*약)/.test(x.t))) {
        push("warn", "format", "abstract-ko", "국문 초록이 보이지 않아요 — 서론 앞에 **국문초록** 줄과 요약을 넣어요");
      }
      if (!titled.some((x) => ABS_EN_RE.test(x.t))) push("warn", "format", "abstract-en", "영문 초록(Abstract)이 보이지 않아요");
    }
    const pn = (data && data.page_number) || {};
    if (pn.show && pn.start === "first_chapter" && chapters.length) {
      const c0 = chapters[0];
      if (/(초\s*록|요\s*약|abstract|목\s*차|차\s*례|contents)/i.test(bareTitle(c0.text))) {
        push("warn", "format", "abstract-chapter", `'${c0.text}'을(를) ## 장 제목으로 쓰면 쪽 번호 1이 여기부터 붙어요 — 굵은 줄(**…**)로 써요`, c0.from, c0.to);
      }
    }
  }

  // ----- 번호: 장 · 절 차례, 빈 제목, 빈 장 · 절
  function checkHeadings() {
    let chN = 0; // 제N장 차례
    let secN = 0;
    let numN = 0; // "1. 서론" 꼴 차례
    let numCur = null;
    let numSec = 0;
    let seenChapter = false;
    for (const h of heads) {
      if (h.level === 2) {
        seenChapter = true;
        secN = 0;
        numSec = 0;
        const m = CH_RE.exec(h.text);
        if (m) {
          const want = ++chN;
          if (Number(m[1]) !== want) push("must", "number", "chapter-number", `장 번호가 차례와 달라요 — 제${m[1]}장 자리는 제${want}장이에요`, h.from, h.to, "renumber");
        } else {
          const n = /^(\d+)\.?\s/.exec(h.text);
          if (n) {
            const want = ++numN;
            numCur = Number(n[1]);
            if (numCur !== want) push("must", "number", "chapter-number", `장 번호가 차례와 달라요 — ${n[1]} 자리는 ${want}이에요`, h.from, h.to);
          } else numCur = null;
        }
      } else if (h.level === 3) {
        const m = SEC_RE.exec(h.text);
        if (m && !seenChapter) push("warn", "number", "section-orphan", "장(##) 없이 시작한 절이에요", h.from, h.to);
        if (m) {
          const want = ++secN;
          if (Number(m[1]) !== want) push("must", "number", "section-number", `절 번호가 차례와 달라요 — 제${m[1]}절 자리는 제${want}절이에요`, h.from, h.to, "renumber");
        } else {
          const n = /^(\d+)\.(\d+)\.?(?:\s|$)/.exec(h.text);
          if (n && numCur != null) {
            const want = ++numSec;
            if (Number(n[1]) !== numCur || Number(n[2]) !== want) {
              push("must", "number", "section-number", `절 번호가 차례와 달라요 — ${n[1]}.${n[2]} 자리는 ${numCur}.${want}이에요`, h.from, h.to);
            }
          }
        }
      }
      const name = bareTitle(h.text);
      if (!name) push("must", "text", "empty-heading", "제목 글이 비어 있어요", h.from, h.to);
    }
    // 내용이 없는 장 · 절: 다음 제목(같거나 높은 단계)까지 글이 없음
    heads.forEach((h, k) => {
      if (h.level < 2 || !bareTitle(h.text)) return;
      const next = heads[k + 1];
      if (next && next.level > h.level) return;
      const end = next ? next.line : sc.lines.length;
      const hasBody = sc.lines.slice(h.line + 1, end).some((l) => !BLANK_RE.test(l) && !isBib(l));
      if (!hasBody) push("warn", "text", "empty-section", `내용이 없는 ${h.level === 2 ? "장" : h.level === 3 ? "절" : "항"}이에요 — '${h.text}'`, h.from, h.to);
    });
  }

  // ----- 번호: 그림 · 표 캡션, 참조 이름, 본문 언급
  function checkFigures() {
    const figs = findFigures(value).map((f, n) => ({ ...f, n: n + 1, info: figureInfo(sc.lines[lineOf(sc, f.from)]) }));
    const figLines = new Set(figs.map((f) => lineOf(sc, f.from)));
    const tables = findTables(value, opts.lexer).map((t, n) => ({ ...t, n: n + 1 }));
    const capLines = new Set();
    const labels = new Map(); // 이름 → [{ kind, n, from, to }]
    const define = (label, kind, n, from, to) => {
      if (!label) return;
      if (!labels.has(label)) labels.set(label, []);
      labels.get(label).push({ kind, n, from, to });
    };
    for (const f of figs) {
      const alt = (f.info && f.info.alt || "").trim();
      if (!alt || FIG_PLACEHOLDERS.includes(alt)) push("must", "number", "figure-caption", `그림 ${f.n}의 캡션(설명)이 비어 있어요`, f.altFrom, f.altTo);
      define(f.info && f.info.label, "fig", f.n, f.from, f.to);
    }
    sc.lines.forEach((l, i) => {
      if (sc.fence[i] || figLines.has(i) || !/!\[[^\]]*\]\(fig:/.test(l)) return;
      push("warn", "number", "figure-inline", "문단 안에 들어간 그림은 번호 · 캡션이 붙지 않아요 — 그림 줄 앞뒤를 빈 줄로 띄워요", sc.starts[i], sc.starts[i] + l.length);
    });
    const captionLineOf = new Map();
    for (const t of tables) if (t.captionFrom != null) capLines.add(lineOf(sc, t.captionFrom));
    for (const t of tables) {
      let cap = t.captionFrom != null ? { text: t.caption, label: t.label, from: t.captionFrom, to: t.captionTo } : null;
      if (!cap) { // 표 바로 아래 캡션 줄 (Pandoc 방식 — buildDocument와 같게 빈 줄은 건너뜀)
        let j = lineOf(sc, t.to) + 1;
        while (j < sc.lines.length && BLANK_RE.test(sc.lines[j])) j++;
        const ci = j < sc.lines.length && !capLines.has(j) && !sc.fence[j] ? captionInfo(sc.lines[j]) : null;
        if (ci) {
          cap = { ...ci, from: sc.starts[j], to: sc.starts[j] + sc.lines[j].length };
          capLines.add(j);
        }
      }
      captionLineOf.set(t, cap);
      if (!cap || !cap.text.trim()) {
        push("must", "number", "table-caption", `표 ${t.n}에 제목(캡션)이 없어요 — 표 바로 위 줄에 '표: 제목'`, t.from, Math.min(t.to, t.from + sc.lines[lineOf(sc, t.from)].length));
      }
      if (cap) define(cap.label, "tbl", t.n, cap.from, cap.to);
    }
    for (const [label, defs] of labels) {
      for (const d of defs.slice(1)) push("must", "number", "label-duplicate", `참조 이름 '${label}'이(가) 두 번 쓰였어요`, d.from, d.to);
    }
    // 참조: 인용 표시 안의 @…는 인용이므로 뺀다
    const inCite = (pos) => cites.some((c) => pos >= c.from && pos < c.to);
    const refs = new Set();
    const mentioned = { fig: new Set(), tbl: new Set() };
    sc.lines.forEach((l, i) => {
      if (sc.fence[i]) return;
      for (const m of l.matchAll(XREF_RE)) {
        const at = sc.starts[i] + m.index;
        if (inCite(at)) continue;
        refs.add(m[1]);
        if (!labels.has(m[1])) {
          const what = m[1].startsWith("fig:") ? "그림" : "표";
          push("must", "number", "xref-missing", `@${m[1]}이(가) 가리키는 ${what}이 없어요 — 그림 줄 끝 · 표 캡션 끝에 {#${m[1]}}를 붙여요`, at, at + m[0].length);
        }
      }
      if (figLines.has(i) || capLines.has(i) || captionInfo(l)) return;
      for (const m of l.matchAll(/(?<![\p{L}\p{N}])(그림|표|Figure|Fig\.|Table)\s*(\d{1,3})(?![\d.]\d)/gu)) {
        const k = m[1] === "표" || m[1] === "Table" ? "tbl" : "fig";
        const n = Number(m[2]);
        mentioned[k].add(n);
        const count = k === "fig" ? figs.length : tables.length;
        if (n > count) {
          const at = sc.starts[i] + m.index;
          push("warn", "number", "mention-missing", `${m[1]} ${n}은(는) 원고에 없어요 (${k === "fig" ? "그림" : "표"} ${count}개) — @${k}:이름 참조를 쓰면 번호가 저절로 맞아요`, at, at + m[0].length);
        }
      }
    });
    for (const f of figs) {
      const lab = f.info && f.info.label;
      if (!(lab && refs.has(lab)) && !mentioned.fig.has(f.n)) push("warn", "number", "figure-unref", `그림 ${f.n}을(를) 본문에서 언급하지 않아요`, f.from, f.to);
    }
    for (const t of tables) {
      const cap = captionLineOf.get(t);
      if (!(cap && cap.label && refs.has(cap.label)) && !mentioned.tbl.has(t.n)) {
        const a = cap && cap.from < t.from ? cap.from : t.from;
        push("warn", "number", "table-unref", `표 ${t.n}을(를) 본문에서 언급하지 않아요`, a, a + sc.lines[lineOf(sc, a)].length);
      }
    }
  }

  // ----- 인용: 서재에 없는 키 · 빈 서지 항목 · [참고문헌] 자리 · 인용 검증 결과
  function checkCitations() {
    const lib = opts.items || null;
    const issues = opts.issues || {};
    const first = new Map();
    const count = new Map();
    for (const c of cites) {
      if (!c.items) {
        push("warn", "cite", "cite-unreadable", `인용 표시를 읽지 못했어요 — ${c.raw.slice(0, 40)}`, c.from, c.to);
        continue;
      }
      for (const it of c.items) {
        if (!first.has(it.key)) first.set(it.key, c);
        count.set(it.key, (count.get(it.key) || 0) + 1);
      }
    }
    // 철회된 논문 (2026-10-27 — 화면이 /api/retractions로 받아 둔 값: [{ key, title }])
    for (const r of opts.retracted || []) {
      const c = first.get(r.key);
      if (c) push("must", "cite", "cite-retracted", `철회된 논문을 인용했어요 — @${r.key}${r.title ? `: ${r.title.slice(0, 50)}` : ""}`, c.from, c.to);
    }
    for (const [k, c] of first) {
      const n = count.get(k);
      const where = n > 1 ? ` (${n}곳)` : "";
      if (/^(fig|tbl):/.test(k)) {
        push("must", "cite", "cite-xref", `[@${k}]는 인용으로 읽혀요 — 그림 · 표 참조는 대괄호 없이 @${k}로 써요`, c.from, c.to);
      } else if (lib && k in lib && lib[k] == null) {
        push("must", "cite", "cite-missing", `서재에 없는 인용키예요 — @${k}${where}`, c.from, c.to);
      } else if ((issues[k] || []).length) {
        const f = issues[k];
        const core = f.some((x) => ["제목", "저자", "연도"].includes(x));
        push(core ? "must" : "warn", "cite", "cite-fields", `@${k}의 인용 정보에 빈 항목이 있어요 — ${f.join(", ")} (서재에서 채워요)`, c.from, c.to);
      }
    }
    if (bibLines.length > 1) {
      const i = bibLines[1];
      push("warn", "cite", "bib-duplicate", "[참고문헌] 자리가 두 곳이에요 — 첫 자리에만 목록이 들어가요", sc.starts[i], sc.starts[i] + sc.lines[i].length);
    }
    if (cites.length && !bibLines.length) {
      push("warn", "cite", "bib-marker", "[참고문헌] 자리가 없어 참고문헌이 문서 맨 끝에 붙어요 — 본문 뒤(부록 앞)에 [참고문헌] 한 줄을 넣어요",
        value.length, value.length);
    }
    const vd = opts.verify;
    if (!vd) return;
    const clamp = (x) => Math.max(0, Math.min(value.length, Number(x) || 0));
    for (const it of vd.items || []) {
      if (it.verdict === "unsupported") {
        push("must", "cite", "verify-unsupported", `근거 없음 — @${it.citekey}: ${(it.sentence || "").slice(0, 60)}`, clamp(it.start), clamp(it.end));
      } else if (it.verdict === "weak") {
        push("warn", "cite", "verify-weak", `근거 약함 — @${it.citekey}: ${(it.sentence || "").slice(0, 60)}`, clamp(it.start), clamp(it.end));
      }
    }
    if (vd.unverified) push("warn", "cite", "verify-pending", `인용 문장 ${vd.unverified}개는 아직 인용 검증 전이에요`, null, null, "verify");
  }

  // ----- 글 다듬기: [확인 필요] · TODO · 템플릿 글 · 긴 문단 · 두 칸 띄어쓰기 · 괄호 · 따옴표 짝
  function checkText() {
    const ko = /[가-힣]/.test(value);
    const limit = ko ? LIMITS.paragraph : LIMITS.paragraphEn;
    sc.lines.forEach((l, i) => {
      if (sc.fence[i]) return;
      const s = sc.starts[i];
      for (const m of l.matchAll(/\[확인\s*필요[^\]\n]*\]/g)) push("must", "text", "check-marker", "AI가 남긴 [확인 필요] 표시가 있어요", s + m.index, s + m.index + m[0].length);
      for (const m of l.matchAll(/(?<![\p{L}\p{N}_])(?:TODO|FIXME|TBD|XXX)(?![\p{L}\p{N}_])|추후\s*(?:작성|보완|수정|추가)|작성\s*예정/gu)) {
        push("must", "text", "todo", `할 일 표시가 남아 있어요 — ${m[0]}`, s + m.index, s + m.index + m[0].length);
      }
      for (const ph of PLACEHOLDERS) {
        const k = l.indexOf(ph);
        if (k >= 0) push("must", "text", "placeholder", "템플릿 안내 글이 그대로 남아 있어요", s + k, s + l.length);
      }
      if (!isTableLine(l)) {
        for (const m of l.matchAll(DOUBLE_SPACE_RE)) push("warn", "text", "double-space", "띄어쓰기가 두 칸이에요", s + m.index, s + m.index + m[0].length, "spaces");
      }
    });
    for (const b of blocks(sc)) {
      // 덩어리 안 문단: 목록 항목 · 제목 · 표 줄 · 그림 줄은 따로
      let start = null;
      let textLen = 0;
      const end = (lastLine) => {
        if (start == null) return;
        if (textLen > limit) {
          push("warn", "text", "long-paragraph", `문단이 길어요 (${textLen.toLocaleString("ko-KR")}자) — 나눠 보세요`, sc.starts[start], sc.starts[lastLine] + sc.lines[lastLine].length);
        }
        start = null;
        textLen = 0;
      };
      for (let i = b.first; i <= b.last; i++) {
        const l = sc.lines[i];
        const alone = HEAD_RE.test(l) || isTableLine(l) || figureInfo(l.trim()) || captionInfo(l) || isBib(l);
        if (alone || LIST_RE.test(l)) end(i - 1);
        if (alone) continue;
        if (start == null) start = i;
        textLen += plain(l).trim().length;
      }
      end(b.last);
      // 괄호 · 따옴표: 표 줄은 줄마다, 나머지는 덩어리 하나로 (그림 줄 · 꼬리표 {#…} 제외)
      const units = [];
      let cur = null;
      for (let i = b.first; i <= b.last; i++) {
        const l = sc.lines[i];
        if (isTableLine(l)) { cur = null; units.push({ s: sc.starts[i], t: l }); continue; }
        if (figureInfo(l.trim())) { cur = null; continue; }
        if (!cur) { cur = { s: sc.starts[i], t: l }; units.push(cur); } else cur.t += `\n${l}`;
      }
      for (const u of units) {
        const t = u.t.replace(/\{#(?:fig|tbl):[^}]*\}/g, (x) => " ".repeat(x.length));
        const p = bracketProblem(t);
        if (p) push("warn", "text", "bracket", p.msg, u.s + p.at, u.s + p.at + 1);
      }
    }
  }
}

// 코드마다 LIMITS.perCode개까지 (넘으면 "같은 문제가 N곳 더") → 꼭 고칠 것 먼저, 원고 순서대로
function finish(items, stats) {
  const byCode = new Map();
  for (const it of items) {
    if (!byCode.has(it.code)) byCode.set(it.code, []);
    byCode.get(it.code).push(it);
  }
  const pos = (it) => (it.from == null ? -1 : it.from);
  const out = [];
  for (const list of byCode.values()) {
    list.sort((a, b) => pos(a) - pos(b));
    out.push(...list.slice(0, LIMITS.perCode));
    if (list.length > LIMITS.perCode) {
      const rest = list[LIMITS.perCode];
      out.push({ ...rest, msg: `${rest.msg} — 같은 문제가 ${list.length - LIMITS.perCode}곳 더 있어요`, more: list.length - LIMITS.perCode });
    }
  }
  const rank = { must: 0, warn: 1 };
  out.sort((a, b) => rank[a.sev] - rank[b.sev] || pos(a) - pos(b));
  const counts = { must: out.filter((x) => x.sev === "must").length, warn: out.filter((x) => x.sev === "warn").length };
  return { items: out, counts, stats };
}

// 도구 막대 배지 · 요약 문구
export function badgeOf(result) {
  if (!result) return null;
  const { must, warn } = result.counts;
  if (must) return { text: String(must), tone: "must", label: `꼭 고칠 것 ${must}개${warn ? ` · 확인 권장 ${warn}개` : ""}` };
  if (warn) return { text: String(warn), tone: "warn", label: `확인 권장 ${warn}개` };
  return { text: "", tone: "ok", label: "고칠 곳 없음" };
}

export function summaryText(result) {
  if (!result) return "";
  const { must, warn } = result.counts;
  const parts = [];
  if (result.stats.pages) parts.push(`본문 약 ${result.stats.pages}쪽(추정)`);
  parts.push(must || warn ? `꼭 고칠 것 ${must} · 확인 권장 ${warn}` : "고칠 곳을 찾지 못했어요");
  return parts.join(" · ");
}
