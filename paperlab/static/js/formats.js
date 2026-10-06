// 논문 양식: 양식 관리 창(목록 · 복사해서 만들기 · 이름 바꾸기 · 항목 수정 · 삭제 · 양식 파일 가져오기),
// 표지 정보 창, 편집 화면 미리보기용 --doc-* 변수 계산 (docs/design/doc-formats-ui.md)

import { api } from "./api.js";
import { $, $$, confirmDialog, el, esc, modal, pickFiles, popupMenu, promptDialog, toast } from "./ui.js";

const PT_PER_MM = 72 / 25.4;
const MAX_USER = 50;
const LONG = { duration: 8000 };
const LIMIT_MSG = "내 양식은 50개까지 만들 수 있어요";
const BAD_FILE_MSG = "워드는 .docx나 .dotx로, 한글은 .hwpx로 저장해서 올려 주세요";
const NAME_MSG = "이름은 1~60자로 적어 주세요";
const DEFAULT_SCHOOL = "인하대학교 제조혁신전문대학원";
const FALLBACK_FONTS = ['"바탕"', '"Batang"', '"Noto Serif KR"', "serif"];
// 한컴오피스와 함께 설치되거나 한글 안에만 있는 글꼴 (이름 포함 여부로 판단)
const HANCOM_FONTS = ["휴먼명조", "HY신명조", "신명조", "신명 세명조", "한양신명조", "함초롬바탕", "함초롬돋움"];
const COVER_KIND_NAMES = { none: "표지 없음", thesis: "학위논문", report: "대체 보고서" };
const COVER_FIELD_NAMES = {
  title_ko: "국문 제목", title_en: "영문 제목", name: "이름", department: "학과",
  graduation: "졸업 연월", approval: "인정 연월", advisors: "지도교수", degree_field: "학위명",
};

// ------------------------------------------------------------------ 작은 도우미
const getPath = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
function setPath(o, path, v) {
  const keys = path.split(".");
  let cur = o;
  for (const k of keys.slice(0, -1)) {
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = v;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const round = (n, d = 2) => Math.round(Number(n) * 10 ** d) / 10 ** d;
const pad2 = (n) => String(n).padStart(2, "0");

// Length({value, unit}) → mm. ch는 그 문단 글자 크기(pt) × 글자 수
export function lengthMm(len, sizePt) {
  if (!len) return 0;
  const v = Number(len.value) || 0;
  if (len.unit === "ch") return (v * sizePt) / PT_PER_MM;
  if (len.unit === "pt") return v / PT_PER_MM;
  return v;
}

// CSS font-family 목록: 영문 글꼴 → 한글 글꼴 → 대체 목록 (영문 글꼴에 없는 한글은 다음 글꼴로 넘어간다)
function fontFamily(fonts) {
  const quote = (name) => `"${String(name).replace(/["\\]/g, (c) => `\\${c}`)}"`;
  const names = [...new Set([fonts && fonts.latin, fonts && fonts.hangul].filter(Boolean))].map(quote);
  return [...names, ...FALLBACK_FONTS.filter((f) => !names.includes(f))].join(", ");
}

// ------------------------------------------------------------------ 목록 API
let listCache = null;

export async function listFormats(force = false) {
  if (!listCache || force) listCache = await api.get("/api/doc-formats");
  return listCache;
}

export function forgetFormats() {
  listCache = null;
}

export function getFormat(id) {
  return api.get(`/api/doc-formats/${encodeURIComponent(id)}`);
}

// 양식 선택 <select>의 선택지 (기본 양식 · 내 양식 묶음)
export function formatOptions(list, value, { manage = false } = {}) {
  const opt = (f) => `<option value="${esc(f.id)}" title="${esc(f.description || "")}" ${f.id === value ? "selected" : ""}>${esc(f.name)}</option>`;
  const mine = list.filter((f) => !f.builtin);
  return `<optgroup label="기본 양식">${list.filter((f) => f.builtin).map(opt).join("")}</optgroup>
    <optgroup label="내 양식">${mine.length ? mine.map(opt).join("") : "<option disabled>아직 없어요</option>"}</optgroup>
    ${manage ? `<hr><option value="__manage">양식 관리…</option>` : ""}`;
}

// ------------------------------------------------------------------ 미리보기 변수 (명세 11.5 · 시안 6.1)
// 값은 단위 없는 숫자(mm · pt · 배수). CSS가 화면 폭에 맞춰 환산한다
export function docVars(data) {
  const p = data.page;
  const m = p.margin_mm;
  const b = data.body;
  const lh = (st) => round((st.line_spacing_pct ?? b.line_spacing_pct) / 100, 3);
  const weight = (st) => (st.bold ? 700 : 400);
  const vars = {
    "--doc-paper-w": p.width_mm,
    "--doc-pad-t": round(m.top + p.header_mm),
    "--doc-pad-r": m.right,
    "--doc-pad-b": round(m.bottom + p.footer_mm),
    "--doc-pad-l": m.left,
    "--doc-font": fontFamily(b.fonts || data.fonts),
    "--doc-size": b.size_pt,
    "--doc-lh": lh(b),
    "--doc-indent": round(lengthMm(b.first_line_indent, b.size_pt)),
    "--doc-align": b.align,
    "--doc-para-before": b.space_before_pt || 0,
    "--doc-para-after": b.space_after_pt || 0,
    "--doc-title-size": data.title.size_pt,
    "--doc-title-align": data.title.align,
    "--doc-title-weight": weight(data.title),
    "--doc-quote-size": data.quote.size_pt,
    "--doc-quote-lh": lh(data.quote),
    "--doc-quote-indent": round(lengthMm(data.quote.indent_left, data.quote.size_pt)),
    "--doc-fn-size": data.footnote.size_pt,
    "--doc-bib-size": data.bibliography.size_pt,
    "--doc-bib-lh": lh(data.bibliography),
    "--doc-bib-hang": round(lengthMm(data.bibliography.hanging_indent, data.bibliography.size_pt)),
  };
  for (const n of ["1", "2", "3"]) {
    const h = data.headings[n];
    vars[`--doc-h${n}-size`] = h.size_pt;
    vars[`--doc-h${n}-align`] = h.align;
    vars[`--doc-h${n}-weight`] = weight(h);
    vars[`--doc-h${n}-style`] = h.italic ? "italic" : "normal";
  }
  const classes = ["doc-formatted"];
  if (!data.title.show) classes.push("doc-title-off");
  for (const n of ["1", "2", "3"]) if (data.headings[n].page_break_before) classes.push(`doc-pb-h${n}`);
  if (data.bibliography.new_page) classes.push("doc-pb-bib");
  return { vars, classes };
}

// 기본 (A4)이거나 양식 값이 없으면 미리보기를 지금 모양 그대로 둔다
export function applyDocFormat(doc, id, data) {
  if (!doc) return;
  doc.className = "doc";
  doc.removeAttribute("style");
  if (!data || !id || id === "default") return;
  const { vars, classes } = docVars(data);
  doc.classList.add(...classes);
  for (const [k, v] of Object.entries(vars)) doc.style.setProperty(k, String(v));
}

// ------------------------------------------------------------------ 표지 · 경고 · 글꼴 판단
// 필수 표지 항목(이름 · 학과 · 졸업 연월) 중 빈 것의 이름 (표지 정보 버튼의 점).
// full이면 내보내기 확인 창용으로 서버 경고(cover-missing)와 같은 기준: + 영문 제목, 학위명(학위논문 양식만),
// 국문 제목(원고 제목도 없을 때)
export function missingCoverFields(cover, { full = false, kind = "thesis", titleFallback = "" } = {}) {
  const c = cover || {};
  const blank = (k) => !String(c[k] || "").trim();
  const out = [];
  if (full && blank("title_ko") && !String(titleFallback || "").trim()) out.push("국문 제목");
  const keys = ["name", "department", "graduation"];
  if (full) keys.push("title_en", ...(kind === "thesis" ? ["degree_field"] : []));
  for (const k of keys) if (blank(k)) out.push(COVER_FIELD_NAMES[k]);
  return out;
}

// 응답 헤더 X-PaperLab-Warnings (URL 인코딩한 JSON 배열) → 경고 코드 목록
export function exportWarnings(res) {
  const raw = res.headers.get("X-PaperLab-Warnings");
  if (!raw) return [];
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// 경고 코드 → 한국어 문구 (여러 개면 ' · '로 이어 붙인다)
export function warningText(codes, coverKind = "thesis") {
  const report = coverKind === "report";
  const pageName = { front: report ? "앞표지" : "표지", inner: "속표지", approval: report ? "인준서" : "인정서" };
  return codes.map((code) => {
    const i = code.indexOf(":");
    const head = i < 0 ? code : code.slice(0, i);
    const args = i < 0 ? [] : code.slice(i + 1).split(",").map((s) => s.trim()).filter(Boolean);
    if (head === "cover-missing") return `표지에 빈 칸이 있어 ○○○로 넣었어요: ${args.map((a) => COVER_FIELD_NAMES[a] || a).join(", ")}`;
    if (head === "cover-overflow") return `표지 내용이 한 쪽을 넘을 수 있어요 (${args.map((a) => pageName[a] || a).join(", ")})`;
    return `내보내기 경고: ${code}`;
  }).join(" · ");
}

// 양식 글꼴(본문 · 글자 모양 · 표지)에 한컴 글꼴이 있는지
export function usesHancomFonts(data) {
  if (!data) return false;
  const sets = [data.fonts];
  for (const key of ["body", "title", "quote", "footnote", "bibliography"]) if (data[key]) sets.push(data[key].fonts);
  for (const n of ["1", "2", "3"]) if (data.headings && data.headings[n]) sets.push(data.headings[n].fonts);
  if (data.cover && data.cover.kind !== "none") sets.push(data.cover.fonts);
  const names = sets.filter(Boolean).flatMap((f) => [f.hangul, f.latin, f.hanja]).filter(Boolean);
  return names.some((n) => HANCOM_FONTS.some((h) => n.includes(h)));
}

// ================================================================== 양식 관리 창
const PAPERS = [["210x297", "A4 (210×297)", 210, 297], ["188x257", "4×6배판 (188×257)", 188, 257], ["215.9x279.4", "Letter (216×279)", 215.9, 279.4]];
const ALIGN_OPTS = [["justify", "양쪽 정렬"], ["left", "왼쪽"], ["center", "가운데"], ["right", "오른쪽"]];
const SPACE_MAX_PT = round(100 * PT_PER_MM, 2); // 문단 간격 0~100mm 환산
const FONT_LIST = ["휴먼명조", "HY신명조", "한양신명조", "바탕", "함초롬바탕", "Times New Roman", "맑은 고딕"];
const SECTIONS = [["page", "용지·여백"], ["fonts", "글꼴"], ["body", "본문"], ["title", "논문 제목"], ["headings", "제목 수준"],
  ["quote", "인용문"], ["footnote", "각주"], ["bibliography", "참고문헌"], ["page_number", "쪽 번호"], ["cover", "표지"]];
const MISSING_NAMES = {
  page: "용지·여백", fonts: "글꼴", body: "본문", title: "논문 제목", headings: "제목 수준", "headings.1": "제목 1수준",
  "headings.2": "제목 2수준", "headings.3": "제목 3수준", quote: "인용문", footnote: "각주", bibliography: "참고문헌",
  page_number: "쪽 번호", cover: "표지",
};
const FONT_HELP = "휴먼명조·HY신명조는 한컴오피스와 함께 설치되는 글꼴이고, 한양신명조(안내문의 신명조·신명 세명조)는 한글 프로그램 안에만 있는 글꼴이에요. 워드 파일에도 규정 글꼴 이름을 그대로 넣기 때문에, 이 글꼴이 없는 PC의 워드에서 열면 비슷한 다른 글꼴로 보여요. 제출할 파일은 한컴오피스가 설치된 PC에서 확인하세요.";

// 기본 양식 근거 설명 (시안 4.4)
const NOTES = {
  default: ["지금까지의 내보내기 서식이에요.", ["한글 파일은 지금처럼 한글 기본 서식(10pt 등)으로 나가요. 이 값을 한글에도 그대로 쓰려면 복사해서 내 양식으로 쓰세요.",
    "복사본은 워드 줄간격이 고정값으로 들어가요."]],
  "apa7-student": ["APA 7판 학생 논문 규칙 중 확인할 수 있는 것만 넣었어요.", [
    "용지는 A4로 두었어요(APA는 미국 Letter 기준이지만 용지 크기를 규칙으로 정하지 않아요).",
    "한글·한자 글꼴 ‘바탕’은 APA에 규정이 없어 임시로 정한 값이에요.",
    "제목 쪽(표지)과 4·5수준 제목은 넣지 않아요."]],
  "inha-mie-thesis": ["‘학위청구 논문 작성 안내’ 기준이에요.", [
    "안내문에 \"내용 편집과 관련한 대학원규정은 없으므로 학과내규 또는 전공학회 편집규정을 참조\"라고 되어 있어 본문 서식은 권장값이에요. 복사해서 고칠 수 있어요.",
    "인쇄: 4×6배판 188×257mm, 모조지 70g 이상, 소프트커버 회색 레자크, 무선제본.",
    "본문 글꼴은 안내에 명시가 없어 휴먼명조로 통일했어요.",
    "인용문은 한 탭(40pt) 들여쓰기예요.",
    "쪽 번호(꼬리말 가운데, 첫 장부터 1쪽)는 학과 확인 중이에요. 양식 설정에서 바꿀 수 있어요.",
    "안내문에 없어 임시로 정한 값: 문단 위·아래 간격, 장 제목 가운데·새 쪽, 제목 3수준, 참고문헌 내어쓰기·새 쪽."]],
  "inha-mie-report": ["‘석사학위논문 대체 보고서(산학공동연구결과보고서)’ 안내 기준이에요.", [
    "순서: 앞표지 → 속표지 → 인준서 → 목차 → 본문 → 참고문헌 → 부록(선택). 목차는 워드(참조 → 목차) · 한글(도구 → 차례/색인)로 넣어 주세요.",
    "분량 30쪽 이상, 서론 · 본론 · 결론 순이에요(PaperLab이 검사하지는 않아요).",
    "본문 11pt · 180%는 안내 범위(10~12pt · 175~185%) 중 기본값이에요.",
    "쪽 번호 위치(꼬리여백 11mm)는 학과 확인 중이에요. 양식 설정에서 바꿀 수 있어요.",
    "안내문에 없어 임시로 정한 값: 첫 줄 들여쓰기·정렬, 제목 굵게, 인용문, 참고문헌, 표지 글꼴."]],
};

// 폼 HTML을 만들면서 칸마다 검사 규칙을 rules에 적어 둔다
function buildFormHtml(rules) {
  const fid = (path) => `f-${path.replace(/\./g, "-")}`;
  const field = (path, label, inner, cls = "") => `<div class="field fmt-field ${cls}" data-field="${path}">
      <label for="${fid(path)}">${label}</label>${inner}<div class="fmt-err" hidden></div></div>`;
  const num = (path, label, unit, min, max, step, { nullable = false, placeholder = "", cls = "" } = {}) => {
    rules.set(path, { kind: "num", min, max, nullable, label, unit });
    return field(path, label, `<div class="fmt-num"><input class="input" id="${fid(path)}" type="number" data-path="${path}"
      min="${min}" max="${max}" step="${step}" inputmode="decimal" ${placeholder ? `placeholder="${esc(placeholder)}"` : ""}><span class="fmt-unit">${unit}</span></div>`, cls);
  };
  const size = (prefix) => num(`${prefix}.size_pt`, "글자 크기", "pt", 5, 72, 0.5);
  const line = (prefix, nullable = true) => num(`${prefix}.line_spacing_pct`, "줄간격", "%", 50, 500, 1,
    { nullable, placeholder: nullable ? "본문과 같게" : "" });
  const space = (path, label) => {
    rules.set(path, { kind: "space", label });
    return field(path, label, `<div class="fmt-num"><input class="input" id="${fid(path)}" type="number" data-path="${path}"
      min="0" max="${SPACE_MAX_PT}" step="0.5" inputmode="decimal"><span class="fmt-unit">pt</span></div>`);
  };
  const len = (path, label, sizePath) => {
    rules.set(path, { kind: "len", sizePath, label });
    return field(path, label, `<div class="fmt-len">
      <input class="input" id="${fid(path)}" type="number" data-path="${path}.value" step="0.1" inputmode="decimal">
      <select class="input" data-path="${path}.unit" aria-label="${esc(label)} 단위"><option value="ch">글자</option><option value="mm">mm</option></select></div>`);
  };
  const select = (path, label, options) => field(path, label, `<select class="input" id="${fid(path)}" data-path="${path}">
      ${options.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("")}</select>`);
  const align = (prefix) => select(`${prefix}.align`, "정렬", ALIGN_OPTS);
  const font = (path, label) => {
    rules.set(path, { kind: "font", label });
    return field(path, label, `<input class="input" id="${fid(path)}" data-path="${path}" list="fmt-font-list" maxlength="60" autocomplete="off">`);
  };
  const checks = (items, cls = "") => `<div class="fmt-checks ${cls}">${items.map(([path, label, attr = ""]) =>
    `<label class="check"><input type="checkbox" ${path ? `data-path="${path}"` : ""} ${attr}> ${label}</label>`).join("")}</div>`;
  const style3 = (prefix) => [[`${prefix}.bold`, "굵게"], [`${prefix}.italic`, "기울임"]];
  const sec = (key, title, help, inner, extra = "") => `<fieldset class="fmt-sec" data-sec="${key}" id="fmt-sec-${key}">
      <legend class="fmt-sec-title">${title}${extra}</legend>${help ? `<p class="fmt-sec-help">${help}</p>` : ""}${inner}</fieldset>`;
  const grid = (inner, cls = "") => `<div class="fmt-grid ${cls}">${inner}</div>`;

  const page = sec("page", "용지·여백", "한글 ‘편집 용지’와 같은 뜻이에요. 워드에서는 위 여백 = 위쪽 + 머리말로 바뀌어 들어가요.",
    grid(`<div class="field fmt-field"><label for="f-paper-preset">용지</label><select class="input" id="f-paper-preset" data-paper-preset>
        ${PAPERS.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}<option value="">직접 입력</option></select></div>
      ${num("page.width_mm", "폭", "mm", 50, 500, 0.1)}${num("page.height_mm", "높이", "mm", 50, 500, 0.1)}`)
    + grid(["page.margin_mm.top:위쪽", "page.header_mm:머리말", "page.margin_mm.bottom:아래쪽", "page.footer_mm:꼬리말",
      "page.margin_mm.left:왼쪽", "page.margin_mm.right:오른쪽"].map((s) => { const [p, l] = s.split(":"); return num(p, l, "mm", 0, 100, 0.1); }).join(""), "cols-2")
    + `<div class="hint" data-word-hint></div>`);
  const fonts = sec("fonts", "글꼴", "", `<div class="fmt-help">${esc(FONT_HELP)}</div>`
    + grid(font("fonts.hangul", "한글") + font("fonts.latin", "영문") + font("fonts.hanja", "한자")), `<span data-fonts-chip></span>`);
  const body = sec("body", "본문", "목록·표도 본문 글꼴·크기·줄간격을 따라요.",
    grid(size("body") + line("body", false) + align("body") + len("body.first_line_indent", "첫 줄 들여쓰기", "body.size_pt")
      + space("body.space_before_pt", "문단 위") + space("body.space_after_pt", "문단 아래")));
  const title = sec("title", "논문 제목", "# 으로 쓴 제목이에요. 끄면 본문에는 넣지 않고 표지의 국문 제목으로만 써요.",
    grid(checks([["title.show", "본문 첫머리에 넣기"]], "span-all") + size("title") + align("title") + checks(style3("title"))
      + space("title.space_before_pt", "문단 위") + space("title.space_after_pt", "문단 아래")));
  const sub = (n, name) => `<div class="fmt-sub" data-level="${n}"><div class="fmt-sub-title">${name}</div>`
    + grid(size(`headings.${n}`) + align(`headings.${n}`) + checks([...style3(`headings.${n}`), [`headings.${n}.page_break_before`, "새 쪽에서 시작"]])
      + space(`headings.${n}.space_before_pt`, "문단 위") + space(`headings.${n}.space_after_pt`, "문단 아래")) + "</div>";
  const headings = sec("headings", "제목 수준", "#### 이하는 모두 3수준 모양을 써요.",
    sub("1", "제목 1수준 · 장 (##)") + sub("2", "제목 2수준 · 절 (###)") + sub("3", "제목 3수준 · 항 (####)"));
  const quote = sec("quote", "인용문", "&gt; 로 쓴 인용문 블록이에요.",
    grid(size("quote") + line("quote") + align("quote") + len("quote.indent_left", "왼쪽 들여쓰기", "quote.size_pt")
      + len("quote.indent_right", "오른쪽 들여쓰기", "quote.size_pt")));
  const footnote = sec("footnote", "각주", "각주는 크기와 줄간격만 써요.", grid(size("footnote") + line("footnote")));
  const bib = sec("bibliography", "참고문헌", "참고문헌 제목은 제목 1수준 모양을 써요. 번호식 인용 스타일은 내어쓰기를 하지 않아요.",
    grid(size("bibliography") + line("bibliography") + align("bibliography")
      + len("bibliography.hanging_indent", "내어쓰기 폭", "bibliography.size_pt") + checks([["bibliography.new_page", "새 쪽에서 시작"]])));
  const pn = sec("page_number", "쪽 번호", "표지·속표지·인정서에는 쪽 번호가 없고 쪽 수에도 세지 않아요. 글자 모양은 본문과 같아요.",
    grid(checks([["page_number.show", "쪽 번호 넣기"]], "span-all")
      + select("page_number.position", "위치", [["footer-center", "꼬리말 가운데"], ["footer-right", "꼬리말 오른쪽"], ["header-center", "머리말 가운데"], ["header-right", "머리말 오른쪽"]])
      + select("page_number.start", "시작", [["document", "본문 첫 쪽부터"], ["first_chapter", "첫 장(##)부터 1쪽"]])
      + num("page_number.distance_mm", "용지 끝에서 거리", "mm", 0, 100, 0.1, { nullable: true, placeholder: "기본 위치" })
      + checks([["page_number.dashes", "번호 양옆에 줄표 (- 1 -)"]])));
  const cover = sec("cover", "표지", "줄 위치와 크기는 표지 종류에 맞춰 정해져 있어요. 학위·이름 같은 내용은 원고 편집 화면의 [표지 정보]에서 넣어요.",
    grid(select("cover.kind", "종류", [["none", "표지 없음"], ["thesis", "학위논문 (표지 · 속표지 · 인정서)"], ["report", "대체 보고서 (앞표지 · 속표지 · 인준서)"]])
      + checks([[null, "본문 글꼴과 같게", "data-cover-same"], ["cover.bold", "굵게"]])
      + font("cover.fonts.hangul", "표지 한글") + font("cover.fonts.latin", "표지 영문") + font("cover.fonts.hanja", "표지 한자")));
  return `<datalist id="fmt-font-list">${FONT_LIST.map((f) => `<option value="${esc(f)}">`).join("")}</datalist>`
    + page + fonts + body + title + headings + quote + footnote + bib + pn + cover;
}

const md = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

// 서버 400 문구 "경로: 안내" → [경로, 안내]
function fieldError(message) {
  const m = /^([A-Za-z_][\w.]*): ([\s\S]+)$/.exec(String(message || ""));
  return m ? [m[1], m[2]] : null;
}
// 칸에 붙일 수 없는 서버 오류는 경로를 떼고 안내 문구만 보인다
const plainMessage = (e) => { const fe = fieldError(e && e.message); return fe ? fe[1] : (e && e.message) || String(e); };
const failToast = (e) => toast(plainMessage(e), "error");

export function formatManagerDialog({ selected = "default" } = {}) {
  return new Promise((resolve) => {
    // id: 오른쪽에 보이는 양식(가져온 양식은 "__draft"), cur: {entry, data, builtin}, draft: 가져온 양식(저장 전)
    const S = { list: [], id: null, cur: null, dirty: false, draft: null, busy: false, saving: false, seq: 0 };
    const rules = new Map();
    const body = el(`<div class="fmt-layout" data-fmt>
      <div class="fmt-side">
        <div class="fmt-side-actions">
          <span class="menu-wrap"><button type="button" class="btn sm" data-fmt-new>＋ 새 양식 ▾</button></span>
          <button type="button" class="btn sm" data-fmt-import>양식 파일 가져오기</button>
        </div>
        <div class="fmt-list" data-fmt-list role="list" aria-label="양식 목록"><div class="fmt-loading"><span class="spinner"></span> 불러오는 중…</div></div>
        <div class="fmt-drop" data-fmt-drop>
          양식 파일을 여기에 끌어다 놓거나 <button type="button" class="btn sm" data-fmt-pick>파일 고르기</button>
          <div class="small">.docx · .dotx · .hwpx (20MB 이하)</div>
        </div>
      </div>
      <div class="fmt-main" data-fmt-main></div>
    </div>`);
    const foot = el(`<div style="display:contents">
      <div class="left"><span class="fmt-foot-status" data-fmt-status aria-live="polite"></span></div>
      <button class="btn" data-no>닫기</button>
      <button class="btn primary hidden" data-fmt-save disabled>저장</button></div>`);
    const listBox = $("[data-fmt-list]", body);
    const main = $("[data-fmt-main]", body);
    const drop = $("[data-fmt-drop]", body);
    const saveBtn = $("[data-fmt-save]", foot);
    const noBtn = $("[data-no]", foot);
    let form = null;

    const m = modal({ title: "논문 양식", body, foot, wide: true, onClose: () => { document.removeEventListener("keydown", onKey, true); resolve(); } });
    $(".modal", m.el).classList.add("fmt-modal");

    const builtins = () => S.list.filter((f) => f.builtin);
    const mine = () => S.list.filter((f) => !f.builtin);
    const atLimit = () => mine().length >= MAX_USER;
    const nameOf = (id) => (S.list.find((f) => f.id === id) || {}).name || id;
    const unsaved = () => S.dirty || !!S.draft;

    // ---------------------------------------------------------- 닫기 · 저장 안 한 변경 확인
    const guardLeave = async () => !unsaved()
      || confirmDialog("저장하지 않은 변경이 있어요. 버리고 계속할까요?", { ok: "버리기", danger: true });
    const tryClose = async () => { if (await guardLeave()) m.close(); };
    $("[data-close]", m.el).onclick = tryClose;
    // 바깥 클릭: modal()의 닫기보다 먼저 받아 변경이 있으면 확인
    m.el.addEventListener("mousedown", (e) => {
      if (e.target === m.el && unsaved()) { e.stopImmediatePropagation(); tryClose(); }
    }, true);
    const isTop = () => m.el === [...document.querySelectorAll(".modal-backdrop")].pop();
    function onKey(e) {
      if (!isTop()) return;
      if (e.key === "Escape" && unsaved()) {
        e.preventDefault();
        e.stopPropagation();
        tryClose();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        e.stopPropagation();
        if (!saveBtn.classList.contains("hidden") && !saveBtn.disabled) save();
      }
    }
    document.addEventListener("keydown", onKey, true);
    noBtn.onclick = () => (S.draft ? cancelDraft() : tryClose());
    saveBtn.onclick = () => save();

    // 끌어 놓기: 창 전체 끌어 놓기(app.js)로 넘기지 않는다
    for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
      m.el.addEventListener(type, (e) => {
        e.stopPropagation();
        if (type === "dragover" || type === "drop") e.preventDefault();
        if (type === "dragover" && e.dataTransfer) e.dataTransfer.dropEffect = drop.contains(e.target) && canImport() ? "copy" : "none";
      });
    }
    const canImport = () => !S.busy && !atLimit();
    drop.addEventListener("dragenter", () => { if (canImport()) drop.classList.add("is-over"); });
    drop.addEventListener("dragover", () => { if (canImport()) drop.classList.add("is-over"); });
    drop.addEventListener("dragleave", (e) => { if (!drop.contains(e.relatedTarget)) drop.classList.remove("is-over"); });
    drop.addEventListener("drop", (e) => {
      drop.classList.remove("is-over");
      const file = e.dataTransfer && e.dataTransfer.files[0];
      if (file && canImport()) startImport(file);
    });

    // ---------------------------------------------------------- 목록
    async function reloadList() {
      S.list = await listFormats(true);
    }

    function drawList() {
      const item = (f) => `<button type="button" class="fmt-item ${S.id === f.id && S.dirty ? "is-dirty" : ""}" role="listitem" data-id="${esc(f.id)}" aria-current="${S.id === f.id}">
        <span class="fmt-item-name"><span>${esc(f.name)}</span>${f.builtin ? `<span class="chip">기본</span>` : ""}</span>
        <span class="fmt-item-sub">${esc(f.builtin ? f.description || "" : `${nameOf(f.base || "default")}에서 복사${f.updated_at ? ` · ${md(f.updated_at)} 수정` : ""}`)}</span></button>`;
      const draft = S.draft ? `<button type="button" class="fmt-item is-draft" role="listitem" data-id="__draft" aria-current="${S.id === "__draft"}">
        <span class="fmt-item-name"><span data-draft-name>${esc(S.draft.name)}</span><span class="chip warn">저장 전</span></span>
        <span class="fmt-item-sub">${esc(S.draft.file.name)}에서 가져옴</span></button>` : "";
      const my = mine();
      listBox.innerHTML = `<div class="fmt-group-title">기본 양식</div>${builtins().map(item).join("")}
        <div class="fmt-group-title">내 양식 <span data-fmt-count>${my.length}/${MAX_USER}</span></div>${draft}${my.map(item).join("")}
        ${my.length || S.draft ? "" : `<div class="fmt-empty">아직 내 양식이 없어요. 기본 양식을 고르고 [복사해서 내 양식 만들기]를 누르거나, 학과 양식 파일을 가져오세요.</div>`}`;
      $$(".fmt-item", listBox).forEach((b) => (b.onclick = () => select(b.dataset.id)));
      syncSide();
    }

    // 목록 안 ↑/↓ · Home/End = 항목 사이 포커스 이동
    listBox.addEventListener("keydown", (e) => {
      const items = $$(".fmt-item", listBox).filter((b) => !b.disabled);
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, to))].focus();
    });

    function syncSide() {
      const limit = atLimit();
      for (const sel of ["[data-fmt-new]", "[data-fmt-import]", "[data-fmt-pick]"]) {
        const b = $(sel, body);
        b.disabled = S.busy || limit;
        b.title = limit ? LIMIT_MSG : "";
      }
      $$(".fmt-item", listBox).forEach((b) => (b.disabled = S.busy));
      const copy = $("[data-fmt-copy]", main);
      if (copy) { copy.disabled = limit; copy.title = limit ? LIMIT_MSG : ""; }
    }

    function setStatus(text, cls = "") {
      const s = $("[data-fmt-status]", foot);
      s.textContent = text;
      s.className = `fmt-foot-status ${cls}`;
    }

    // ---------------------------------------------------------- 양식 고르기 · 보여 주기
    async function select(id, { force = false } = {}) {
      if (!force && id === S.id) return;
      if (!force && !(await guardLeave())) return;
      if (id !== "__draft") S.draft = null;
      S.dirty = false;
      S.id = id;
      drawList();
      await loadAndShow(id);
    }

    async function loadAndShow(id) {
      const seq = ++S.seq;
      main.innerHTML = `<div class="fmt-loading"><span class="spinner"></span> 불러오는 중…</div>`;
      setFoot();
      try {
        const f = await getFormat(id);
        if (seq !== S.seq) return;
        S.cur = { entry: f, data: clone(f.data), builtin: !!f.builtin };
        showForm();
      } catch (e) {
        if (seq !== S.seq) return;
        S.cur = null;
        main.innerHTML = `<div class="fmt-content"><div class="status-line bad">양식을 불러오지 못했어요: ${esc(e.message)}</div>
          <button type="button" class="btn sm" data-fmt-retry style="margin-top:8px">다시 시도</button></div>`;
        $("[data-fmt-retry]", main).onclick = () => loadAndShow(id);
        setFoot();
      }
    }

    // 바닥 버튼: 기본 양식 = 닫기만, 내 양식 = 닫기 + 저장(변경 있을 때), 가져온 양식 = 취소 + 저장
    function setFoot() {
      const editable = S.cur && !S.cur.builtin;
      noBtn.textContent = S.draft ? "취소" : "닫기";
      saveBtn.classList.toggle("hidden", !editable);
      saveBtn.disabled = !(S.draft || S.dirty) || S.saving;
      if (S.dirty) setStatus("저장 안 한 변경이 있어요", "is-dirty");
      else if (!S.saving) setStatus("");
    }

    function markDirty() {
      if (!S.cur || S.cur.builtin) return;
      if (!S.dirty) {
        S.dirty = true;
        const item = $(`.fmt-item[aria-current="true"]`, listBox);
        if (item && !S.draft) item.classList.add("is-dirty");
      }
      setFoot();
    }

    function showForm() {
      const { entry, data, builtin } = S.cur;
      const draft = !!S.draft;
      const kind = (data.cover && data.cover.kind) || "none";
      const note = builtin && NOTES[entry.id];
      main.innerHTML = `<div class="fmt-head">
          ${draft ? `<input class="input fmt-name-input" data-fmt-name maxlength="60" aria-label="양식 이름" value="${esc(S.draft.name)}">`
            : `<h4 class="fmt-title" data-fmt-title>${esc(entry.name)}</h4>`}
          ${builtin ? `<span class="chip">기본</span>` : ""}${draft ? `<span class="chip warn">가져온 양식 (저장 전)</span>` : ""}
          <span class="chip accent ${kind === "none" ? "hidden" : ""}" data-fmt-kind>표지: ${esc(COVER_KIND_NAMES[kind] || kind)}</span>
          <div class="fmt-head-actions">${builtin ? `<button type="button" class="btn sm primary" data-fmt-copy>복사해서 내 양식 만들기</button>`
            : draft ? "" : `<button type="button" class="btn sm" data-fmt-rename>이름 바꾸기</button>
              <button type="button" class="btn sm ghost danger" data-fmt-delete>삭제</button>`}</div>
          <nav class="fmt-nav" aria-label="항목 묶음으로 이동">${SECTIONS.map(([k, t]) => `<button type="button" data-jump="${k}">${t}</button>`).join("")}</nav>
        </div>
        <div class="fmt-content">
          ${builtin ? `<div class="status-line fmt-lock">기본 양식은 바꿀 수 없어요. [복사해서 내 양식 만들기]로 내 양식을 만든 뒤 고쳐 쓰세요.</div>` : ""}
          ${note ? `<div class="fmt-note" data-fmt-note><b>${esc(note[0])}</b><ul>${note[1].map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>` : ""}
          ${draft ? importInfoHtml() : ""}
          <form class="fmt-form ${builtin ? "is-readonly" : ""}" data-fmt-form autocomplete="off" novalidate>
            <fieldset class="fmt-fields" ${builtin ? "disabled" : ""}>${buildFormHtml(rules)}</fieldset>
          </form>
        </div>`;
      form = $("[data-fmt-form]", main);
      if (builtin && entry.id === "inha-mie-thesis") $("[data-fonts-chip]", form).outerHTML = `<span class="chip">안내에 명시 없음, 휴먼명조로 통일</span>`;
      fillForm(data);
      if (draft) markOrigins();
      wireForm();
      setFoot();
      syncSide();
      main.scrollTop = 0;
    }

    function wireForm() {
      const copy = $("[data-fmt-copy]", main);
      if (copy) copy.onclick = () => createFrom(S.cur.entry.id);
      const ren = $("[data-fmt-rename]", main);
      if (ren) ren.onclick = rename;
      const del = $("[data-fmt-delete]", main);
      if (del) del.onclick = remove;
      const nameInput = $("[data-fmt-name]", main);
      if (nameInput) nameInput.oninput = () => {
        S.draft.name = nameInput.value;
        const n = $("[data-draft-name]", listBox);
        if (n) n.textContent = nameInput.value || "이름 없는 양식";
      };
      const baseSel = $("[data-import-base]", main);
      if (baseSel) baseSel.onchange = async () => {
        const base = baseSel.value;
        if (S.dirty && !(await confirmDialog("고친 칸이 다시 바뀌어요. 계속할까요?"))) { baseSel.value = S.draft.base; return; }
        startImport(S.draft.file, { base, reimport: true });
      };
      $$("[data-jump]", main).forEach((b) => (b.onclick = () => {
        const sec = $(`#fmt-sec-${b.dataset.jump}`, main);
        if (!sec) return;
        sec.scrollIntoView({ block: "start", behavior: "smooth" });
        const first = $("input:not(:disabled), select:not(:disabled)", sec);
        if (first) first.focus({ preventScroll: true });
        setNav(b.dataset.jump);
      }));
      main.onscroll = () => {
        const top = main.scrollTop + 140;
        let cur = SECTIONS[0][0];
        for (const s of $$(".fmt-sec", main)) if (s.offsetTop <= top) cur = s.dataset.sec;
        setNav(cur);
      };
      if (S.cur.builtin) return;
      const onEdit = (e) => {
        const f = e.target.closest(".fmt-field");
        if (f && f.classList.contains("is-invalid")) clearError(f);
        if (e.target.matches("[data-paper-preset]")) {
          const p = PAPERS.find((x) => x[0] === e.target.value);
          if (p) { $('[data-path="page.width_mm"]', form).value = p[2]; $('[data-path="page.height_mm"]', form).value = p[3]; }
        }
        if (e.target.matches('[data-path="page.width_mm"], [data-path="page.height_mm"]')) syncPaper();
        if (e.target.matches("[data-cover-same]") && e.target.checked) {
          for (const k of ["hangul", "latin", "hanja"]) $(`[data-path="cover.fonts.${k}"]`, form).value = $(`[data-path="fonts.${k}"]`, form).value;
        }
        if (e.target.matches('[data-path^="fonts."]') && $("[data-cover-same]", form).checked) {
          const k = e.target.dataset.path.split(".")[1];
          $(`[data-path="cover.fonts.${k}"]`, form).value = e.target.value;
        }
        if (e.target.matches('[data-path="cover.kind"]')) {
          const chip = $("[data-fmt-kind]", main);
          chip.textContent = `표지: ${COVER_KIND_NAMES[e.target.value]}`;
          chip.classList.toggle("hidden", e.target.value === "none");
        }
        syncDisabled();
        wordHint();
        markDirty();
      };
      form.addEventListener("input", onEdit);
      form.addEventListener("change", onEdit);
      form.onsubmit = (e) => { e.preventDefault(); save(); };
    }

    function setNav(key) {
      $$("[data-jump]", main).forEach((b) => b.setAttribute("aria-current", String(b.dataset.jump === key)));
    }

    // ---------------------------------------------------------- 폼 ↔ 양식 데이터
    function fillForm(data) {
      for (const inp of $$("[data-path]", form)) {
        const path = inp.dataset.path;
        let v = getPath(data, path);
        if (path.startsWith("cover.fonts.")) v = ((data.cover && data.cover.fonts) || data.fonts || {})[path.split(".")[2]];
        if (inp.type === "checkbox") inp.checked = !!v;
        else if (inp.tagName === "SELECT") {
          if (v != null && ![...inp.options].some((o) => o.value === v)) inp.add(new Option(v, v));
          inp.value = v == null ? "" : v;
        } else inp.value = v == null ? "" : String(v);
      }
      $("[data-cover-same]", form).checked = !(data.cover && data.cover.fonts);
      syncPaper();
      syncDisabled();
      wordHint();
    }

    function syncPaper() {
      const w = Number($('[data-path="page.width_mm"]', form).value);
      const h = Number($('[data-path="page.height_mm"]', form).value);
      const p = PAPERS.find((x) => Math.abs(x[2] - w) < 0.05 && Math.abs(x[3] - h) < 0.05);
      $("[data-paper-preset]", form).value = p ? p[0] : "";
    }

    // 쪽 번호를 끄면 나머지 칸, 표지 없음이면 표지 칸을 잠근다 (기본 양식은 fieldset 전체가 잠겨 있음)
    function syncDisabled() {
      const pnOn = $('[data-path="page_number.show"]', form).checked;
      $$('[data-path^="page_number."]:not([data-path="page_number.show"])', form).forEach((x) => (x.disabled = !pnOn));
      const coverOn = $('[data-path="cover.kind"]', form).value !== "none";
      const same = $("[data-cover-same]", form);
      same.disabled = !coverOn;
      $('[data-path="cover.bold"]', form).disabled = !coverOn;
      $$('[data-path^="cover.fonts."]', form).forEach((x) => (x.disabled = !coverOn || same.checked));
    }

    function wordHint() {
      const v = (p) => Number($(`[data-path="${p}"]`, form).value) || 0;
      const n = (x) => String(round(x, 1));
      const top = v("page.margin_mm.top");
      const bottom = v("page.margin_mm.bottom");
      $("[data-word-hint]", form).textContent = `워드에서는 위 여백 ${n(top + v("page.header_mm"))}mm · 머리글 거리 ${n(top)}mm, `
        + `아래 여백 ${n(bottom + v("page.footer_mm"))}mm · 바닥글 거리 ${n(bottom)}mm로 들어가요.`;
    }

    // 불러온 data에 폼 값을 덮어쓴다(화면에 없는 값은 그대로 보존). 범위도 함께 검사
    function collect() {
      const data = clone(S.cur.data);
      const errors = [];
      for (const inp of $$("[data-path]", form)) {
        const path = inp.dataset.path;
        if (path.startsWith("cover.fonts.")) continue;
        let v;
        if (inp.type === "checkbox") v = inp.checked;
        else if (inp.type === "number") {
          const raw = inp.value.trim();
          const rule = rules.get(path) || {};
          if (inp.validity.badInput) { errors.push([path, "숫자를 입력해 주세요"]); continue; }
          if (raw === "") {
            if (rule.nullable) v = null;
            else { errors.push([path, "숫자를 입력해 주세요"]); continue; }
          } else v = Number(raw);
        } else if (inp.tagName === "SELECT") v = inp.value;
        else v = inp.value.trim();
        setPath(data, path, v);
      }
      if (!data.cover) data.cover = {};
      data.cover.fonts = $("[data-cover-same]", form).checked ? null : Object.fromEntries(["hangul", "latin", "hanja"]
        .map((k) => [k, $(`[data-path="cover.fonts.${k}"]`, form).value.trim()]));
      for (const [path, rule] of rules) {
        if (errors.some(([p]) => p === path || p === `${path}.value`)) continue;
        if (rule.kind === "num") {
          const v = getPath(data, path);
          if (v != null && (v < rule.min || v > rule.max)) errors.push([path, `${rule.min}~${rule.max}${rule.unit} 사이로 입력해 주세요`]);
        } else if (rule.kind === "space") {
          const v = getPath(data, path);
          if (v < 0 || v / PT_PER_MM > 100 + 1e-9) errors.push([path, "0~100mm(약 283pt) 사이로 입력해 주세요"]);
        } else if (rule.kind === "len") {
          const len = getPath(data, path);
          const mm = lengthMm(len, Number(getPath(data, rule.sizePath)) || 0);
          if (mm < -50 - 1e-9 || mm > 100 + 1e-9) {
            errors.push([path, len && len.unit !== "mm" ? `-50~100mm 사이가 되도록 입력해 주세요 (지금 ${mm.toFixed(1)}mm)` : "-50~100mm 사이로 입력해 주세요"]);
          }
        } else if (rule.kind === "font") {
          if (path.startsWith("cover.fonts.") && !data.cover.fonts) continue;
          const v = path.startsWith("cover.fonts.") ? data.cover.fonts[path.split(".")[2]] : getPath(data, path);
          if (!v) errors.push([path, "글꼴 이름을 입력해 주세요"]);
          else if (v.length > 60) errors.push([path, "글꼴 이름은 60자 이하로 입력해 주세요"]);
        }
      }
      const p = data.page;
      if (!errors.some(([x]) => x.startsWith("page."))) {
        if (p.width_mm - p.margin_mm.left - p.margin_mm.right < 20) errors.push(["page.margin_mm.left", "왼쪽·오른쪽 여백이 너무 커서 본문 폭이 20mm보다 좁아요"]);
        else if (p.height_mm - p.margin_mm.top - p.margin_mm.bottom - p.header_mm - p.footer_mm < 20) {
          errors.push(["page.margin_mm.top", "위·아래 여백이 너무 커서 본문 높이가 20mm보다 낮아요"]);
        }
      }
      return { data, errors };
    }

    // ---------------------------------------------------------- 오류 표시
    function fieldFor(path) {
      return $(`.fmt-field[data-field="${path}"]`, form)
        || ($(`[data-path="${path}"]`, form) || { closest: () => null }).closest(".fmt-field")
        || $(`.fmt-field[data-field^="${path}."]`, form)
        || (/\.(value|unit)$/.test(path) ? fieldFor(path.replace(/\.(value|unit)$/, "")) : null);
    }

    function clearError(f) {
      f.classList.remove("is-invalid");
      const er = $(".fmt-err", f);
      er.hidden = true;
      er.textContent = "";
      $$("[aria-invalid]", f).forEach((i) => { i.removeAttribute("aria-invalid"); i.removeAttribute("aria-describedby"); });
    }

    function showErrors(errors) {
      let first = null;
      for (const [path, msg] of errors) {
        const f = fieldFor(path);
        if (!f) continue;
        f.classList.add("is-invalid");
        const er = $(".fmt-err", f);
        er.id = `${(f.dataset.field || path).replace(/\./g, "-")}-err`;
        er.textContent = msg;
        er.hidden = false;
        $$("input, select", f).forEach((i) => { i.setAttribute("aria-invalid", "true"); i.setAttribute("aria-describedby", er.id); });
        first = first || f;
      }
      setStatus("고칠 칸이 있어요", "is-dirty");
      if (first) {
        first.scrollIntoView({ block: "center" });
        const inp = $("input:not(:disabled), select:not(:disabled)", first);
        if (inp) inp.focus({ preventScroll: true });
      }
      return !!first;
    }

    // ---------------------------------------------------------- 저장
    async function save() {
      if (S.saving || !S.cur || S.cur.builtin || !form) return;
      $$(".fmt-field.is-invalid", form).forEach(clearError);
      let name = null;
      if (S.draft) {
        name = ($("[data-fmt-name]", main).value || "").trim();
        if (!name || name.length > 60) return toast(NAME_MSG, "error");
      }
      const { data, errors } = collect();
      if (errors.length) return showErrors(errors);
      S.saving = true;
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span class="spinner"></span> 저장 중`;
      let ok = false;
      try {
        if (S.draft) {
          const f = await api.post("/api/doc-formats", { base: S.draft.base, name, data });
          S.draft = null;
          S.dirty = false;
          await reloadList().catch(() => {});
          S.id = f.id;
          S.cur = { entry: f, data: clone(f.data), builtin: false };
          drawList();
          showForm();
          toast("가져온 양식을 저장했어요", "success");
        } else {
          const f = await api.patch(`/api/doc-formats/${encodeURIComponent(S.id)}`, { data });
          S.cur = { entry: f, data: clone(f.data), builtin: false };
          S.dirty = false;
          fillForm(f.data);
          await reloadList().catch(() => {});
          drawList();
        }
        ok = true;
      } catch (e) {
        const fe = fieldError(e.message);
        if (!(fe && showErrors([fe]))) failToast(e);
      }
      S.saving = false;
      saveBtn.textContent = "저장";
      saveBtn.disabled = !(S.draft || S.dirty);
      if (ok) setStatus("저장했어요");
    }

    // ---------------------------------------------------------- 만들기 · 이름 바꾸기 · 삭제
    function newMenu(anchor) {
      const sub = { none: "표지 없음", thesis: "학위논문 표지", report: "보고서 표지" };
      popupMenu(anchor, builtins().map((f) => ({ label: f.name, sub: sub[f.cover_kind] || "", action: () => createFrom(f.id) })), { left: true });
    }
    $("[data-fmt-new]", body).onclick = (e) => { e.stopPropagation(); if (!atLimit()) newMenu(e.currentTarget); };

    async function createFrom(baseId) {
      if (atLimit()) return toast(LIMIT_MSG, "error");
      if (!(await guardLeave())) return;
      const name = await promptDialog("새 양식 이름", { value: `${nameOf(baseId)} 복사본`, ok: "만들기" });
      if (name == null) return;
      if (name.length > 60) return toast(NAME_MSG, "error");
      try {
        const f = await api.post("/api/doc-formats", { base: baseId, name });
        S.draft = null;
        S.dirty = false;
        await reloadList();
        await select(f.id, { force: true });
        toast(`‘${f.name}’ 양식을 만들었어요`, "success");
      } catch (e) { failToast(e); }
    }

    async function rename() {
      const name = await promptDialog("양식 이름 바꾸기", { value: S.cur.entry.name, ok: "바꾸기" });
      if (name == null) return;
      if (name.length > 60) return toast(NAME_MSG, "error");
      try {
        const f = await api.patch(`/api/doc-formats/${encodeURIComponent(S.id)}`, { name });
        S.cur.entry.name = f.name;
        $("[data-fmt-title]", main).textContent = f.name;
        await reloadList().catch(() => {});
        drawList();
        toast("이름을 바꿨어요");
      } catch (e) { failToast(e); }
    }

    async function remove() {
      const id = S.id;
      await reloadList().catch(() => {}); // 쓰는 원고 수(used_by)는 최신 값으로
      const entry = S.list.find((f) => f.id === id) || S.cur.entry;
      const n = Number(entry.used_by) || 0;
      const msg = n ? `'${entry.name}' 양식을 지울까요? 이 양식을 쓰는 원고 ${n}개는 기본 (A4)로 바뀌어요.`
        : `'${entry.name}' 양식을 지울까요? 되돌릴 수 없어요.`;
      if (!(await confirmDialog(msg, { ok: "삭제", danger: true }))) return;
      try {
        const r = await api.del(`/api/doc-formats/${encodeURIComponent(id)}`);
        S.dirty = false;
        await reloadList();
        await select("default", { force: true });
        const k = Number(r && r.reset_manuscripts) || 0;
        if (k) toast(`양식을 지웠어요 · 원고 ${k}개를 기본 (A4)로 바꿨어요`, "", LONG);
        else toast("양식을 지웠어요");
      } catch (e) { failToast(e); }
    }

    // ---------------------------------------------------------- 양식 파일 가져오기
    async function pickImport() {
      if (!canImport()) return;
      const [file] = await pickFiles({ accept: ".docx,.dotx,.hwpx" });
      if (file) startImport(file);
    }
    $("[data-fmt-import]", body).onclick = pickImport;
    $("[data-fmt-pick]", body).onclick = pickImport;

    async function startImport(file, { base = "default", reimport = false } = {}) {
      if (!/\.(docx|dotx|hwpx)$/i.test(file.name)) return toast(BAD_FILE_MSG, "error");
      if (atLimit()) return toast(LIMIT_MSG, "error");
      if (!reimport && !(await guardLeave())) return;
      const prevId = S.draft ? S.draft.prevId : S.id;
      const keepName = reimport && S.draft ? S.draft.name : null;
      const seq = ++S.seq;
      S.busy = true;
      S.dirty = false;
      syncSide();
      main.innerHTML = `<div class="fmt-loading"><span class="spinner"></span> ‘${esc(file.name)}’에서 서식을 읽는 중…</div>`;
      saveBtn.classList.add("hidden");
      const fd = new FormData();
      fd.append("file", file);
      fd.append("base", base);
      try {
        const r = await api.post("/api/doc-formats/import", fd);
        if (seq !== S.seq) return;
        S.draft = { file, result: r, base: r.base || base, prevId, name: keepName ?? (r.suggested_name || file.name.replace(/\.[^.]+$/, "")) };
        S.id = "__draft";
        S.cur = { entry: { id: "__draft", name: S.draft.name, builtin: false }, data: clone(r.data), builtin: false };
        S.busy = false;
        drawList();
        showForm();
      } catch (e) {
        if (seq !== S.seq) return;
        S.busy = false;
        S.draft = null;
        S.cur = null;
        S.id = null;
        drawList();
        main.innerHTML = `<div class="fmt-content"><div class="status-line bad">${esc(e.message)}</div>
          <button type="button" class="btn sm" data-fmt-pick style="margin-top:8px">다른 파일 고르기</button></div>`;
        $("[data-fmt-pick]", main).onclick = pickImport;
        setFoot();
      }
    }

    function importInfoHtml() {
      const { result, file, base } = S.draft;
      const found = result.found || [];
      const missing = result.missing || [];
      const warnings = result.warnings || [];
      const baseName = nameOf(base);
      const first = found.length
        ? `<div class="status-line ok">‘${esc(file.name)}’에서 ${found.length}개 항목을 읽었어요. 읽지 못한 항목은 ‘${esc(baseName)}’ 값으로 채웠어요.</div>`
        : `<div class="status-line bad">‘${esc(file.name)}’에서 읽을 수 있는 서식을 찾지 못했어요. 모든 칸을 ‘${esc(baseName)}’ 값으로 채웠어요.</div>`;
      return `<div class="fmt-import" data-fmt-import-info>${first}
        <div class="fmt-import-row"><label for="fmt-import-base" class="small">빈 칸을 채울 기본 양식</label>
          <select class="input" id="fmt-import-base" data-import-base>${builtins().map((f) => `<option value="${esc(f.id)}" ${f.id === base ? "selected" : ""}>${esc(f.name)}</option>`).join("")}</select></div>
        ${missing.length ? `<div class="small muted">기본값으로 채운 묶음: <span class="chips" data-import-missing>${missing.map((p) => `<span class="chip" data-missing="${esc(p)}">${esc(MISSING_NAMES[p] || p)}</span>`).join("")}</span></div>` : ""}
        <div class="status-line bad fmt-warnings ${warnings.length ? "" : "hidden"}" data-import-warnings><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>
        <div class="small muted">학과 양식 파일의 사용자 정의 스타일(예: ‘장제목’)은 읽지 않아요. 필요한 값은 아래에서 직접 고쳐 주세요.</div></div>`;
    }

    // 칸마다 "파일에서 읽음" / "기본값" 꼬리표, 더 깊은 missing 경로는 칸 라벨 글자로
    function markOrigins() {
      const found = S.draft.result.found || [];
      for (const f of $$(".fmt-field[data-field]", form)) {
        const path = f.dataset.field;
        const fromFile = found.some((p) => p === path || p.startsWith(`${path}.`));
        const label = $("label", f);
        label.insertAdjacentHTML("beforeend", ` <span class="fmt-origin" data-origin="${fromFile ? "file" : "default"}">${fromFile ? "파일에서 읽음" : "기본값"}</span>`);
      }
      for (const chip of $$("[data-missing]", main)) {
        const p = chip.dataset.missing;
        if (MISSING_NAMES[p]) continue;
        const f = fieldFor(p);
        const label = f && $("label", f);
        if (!label) continue;
        const sec = f.closest(".fmt-sub") ? $(".fmt-sub-title", f.closest(".fmt-sub")).textContent.split(" · ")[0]
          : (SECTIONS.find(([k]) => k === p.split(".")[0]) || [, ""])[1];
        chip.textContent = `${sec ? `${sec} ` : ""}${label.firstChild.textContent.trim()}`;
      }
    }

    function cancelDraft() {
      const prev = S.draft && S.draft.prevId;
      S.draft = null;
      S.dirty = false;
      select(prev && S.list.some((f) => f.id === prev) ? prev : "default", { force: true });
    }

    // ---------------------------------------------------------- 시작
    async function start() {
      listBox.innerHTML = `<div class="fmt-loading"><span class="spinner"></span> 불러오는 중…</div>`;
      try {
        await reloadList();
      } catch (e) {
        listBox.innerHTML = `<div class="status-line bad">양식을 불러오지 못했어요: ${esc(e.message)}</div>
          <button type="button" class="btn sm" data-fmt-retry style="margin:8px 6px">다시 시도</button>`;
        $("[data-fmt-retry]", listBox).onclick = start;
        return;
      }
      await select(S.list.some((f) => f.id === selected) ? selected : "default", { force: true });
    }
    start();
  });
}

// ================================================================== 표지 정보 창
const COVER_DEFAULTS = {
  degree: "master", degree_field: "", title_ko: "", title_en: "", subtitle: "", graduation: "", approval: "",
  school: DEFAULT_SCHOOL, department: "", name: "", spaced_name: true, advisors: [], committee: [],
  include: { front: true, inner: true, approval: true },
};

export function coverWithDefaults(cover) {
  const out = clone(COVER_DEFAULTS);
  for (const [k, v] of Object.entries(cover || {})) {
    if (k === "include" && v && typeof v === "object") Object.assign(out.include, v);
    else if (k in out && v != null) out[k] = v;
  }
  return out;
}

const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const spacedName = (name, on) => (on && /^[가-힣]{2,5}$/.test(name) ? [...name].join(" ") : name);
const ymText = (v) => { const m = YM_RE.exec(v || ""); return m ? `${m[1]}년 ${Number(m[2])}월` : ""; };

function approvalYm(c) {
  if (c.approval) return c.approval;
  const m = YM_RE.exec(c.graduation || "");
  if (!m) return "";
  const y = Number(m[1]);
  if (m[2] === "02") return `${y - 1}-12`;
  if (m[2] === "08") return `${y}-06`;
  return "";
}

// 표지류 줄 목록 (doc_formats.cover_pages와 같은 규칙). 줄 = {parts: [[글자, 빈칸표시?]], size, pos}
function coverPages(kind, c, titleFallback) {
  const P = (t, ph = false) => [t, ph];
  const L = (parts, size, ...pos) => ({ parts, size, pos });
  const name = c.name.trim();
  const nameSpaced = name ? [P(spacedName(name, c.spaced_name))] : [P("○○○", true)];
  const namePlain = name ? P(name) : P("○○○", true);
  const dept = c.department.trim() ? [P(c.department.trim())] : [P("○○○학과", true)];
  const school = [P(c.school.trim() || DEFAULT_SCHOOL)];
  const tko = c.title_ko.trim() || String(titleFallback || "").trim();
  const titleKo = tko ? [P(tko)] : [P("○○○", true)];
  const titleEn = c.title_en.trim() ? [P(c.title_en.trim())] : [P("○○○", true)];
  const subtitle = c.subtitle.trim();
  const ym = (v) => (ymText(v) ? [P(ymText(v))] : [P("○○○○년 ○월", true)]);
  const grad = ym(c.graduation);
  const appr = ym(approvalYm(c));
  const committee = (count, size, firstGap, gap) => ["주심", "부심", ...Array(count - 2).fill("위원")].map((t, i) => {
    const n = String(c.committee[i] || "").trim();
    return L([P(`${t}　　${n ? spacedName(n, c.spaced_name) : "　".repeat(6)}　　(인)`)], size, "gap", i ? gap : firstGap);
  });
  const advisors = (size, spaceNames) => {
    const list = c.advisors.map((a) => String(a || "").trim()).filter(Boolean);
    const show = (n) => (spaceNames ? spacedName(n, c.spaced_name) : n);
    if (list.length >= 2) return [L([P(`공동지도교수 ${show(list[0])}`)], size, "fill"), L([P(`공동지도교수 ${show(list[1])}`)], size, "gap", 0)];
    return [L(list.length ? [P(`지도교수 ${show(list[0])}`)] : [P("지도교수 "), P("○○○", true)], size, "fill")];
  };
  const pages = [];
  if (kind === "thesis") {
    const doctor = c.degree === "doctor";
    const degree = `${c.degree_field.trim()}${doctor ? "박사" : "석사"}`;
    const head = [L([P(`${degree}학위 논문`)], 14, "top", 40), L(titleKo, 16, "gap", 20)];
    if (subtitle) head.push(L([P(`– ${subtitle} –`)], 14, "gap", 3));
    head.push(L(titleEn, 16, "gap", 10), L(grad, 14, "gap", 25));
    const tail = [L(school, 14, "fill"), L(dept, 14, "gap", 10), L(nameSpaced, 14, "gap", 10)];
    pages.push({ key: "front", bottom: 40, lines: [...head, ...tail] });
    pages.push({ key: "inner", bottom: 40, lines: [...head, ...advisors(16, true), L([P(`이 논문을 ${degree}학위 논문으로 제출함`)], 14, "gap", 10), ...tail] });
    pages.push({ key: "approval", bottom: null, lines: [L([P("이 논문을 "), namePlain, P(`의 ${degree}학위논문으로 인정함.`)], 14, "top", 50),
      L(appr, 14, "gap", 15), ...committee(doctor ? 5 : 3, 14, 25, 15)] });
    pages.forEach((p) => (p.margin = 25));
    return pages;
  }
  const head = [L([P("석사학위 연구보고서")], 16, "top", 55), L(titleKo, 22, "gap", 20)];
  if (subtitle) head.push(L([P(`– ${subtitle} –`)], 14, "gap", 3));
  head.push(L(titleEn, 16, "fill"));
  const tail = [L(dept, 16, "gap", 10), L(nameSpaced, 16, "gap", 10)];
  pages.push({ key: "front", bottom: 55, lines: [...head, L(grad, 16, "fill"), L(school, 16, "gap", 40), ...tail] });
  pages.push({ key: "inner", bottom: 55, lines: [...head, ...advisors(16, false), L([P("이 보고서를 석사학위 연구보고서로 제출함")], 16, "gap", 20),
    L(grad, 16, "gap", 10), L(school, 16, "gap", 20), ...tail] });
  pages.push({ key: "approval", bottom: null, lines: [L([P("이 보고서를 "), namePlain, P("의 석사학위 연구보고서로 인정함")], 22, "top", 70),
    L(appr, 16, "gap", 30), ...committee(3, 16, 30, 30)] });
  pages.forEach((p) => (p.margin = 30));
  return pages;
}

// 한 쪽을 넘는지 추정 (doc_formats.layout_cover_page와 같은 계산)
function coverOverflow(page, widthMm, heightMm) {
  const usable = Math.max(widthMm - page.margin * 2, 1) * PT_PER_MM;
  const lines = (text, size) => {
    let total = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0);
      total += ch === " " ? 0.3 : code >= 0x1100 && !(code >= 0x2000 && code <= 0x206f) ? 1 : 0.55;
    }
    return Math.max(1, Math.ceil((total * size) / usable - 1e-9));
  };
  let fixed = 0;
  page.lines.forEach((ln, i) => {
    fixed += (lines(ln.parts.map((p) => p[0]).join(""), ln.size) * ln.size * 1.2) / PT_PER_MM;
    if (ln.pos[0] === "top" || (i && ln.pos[0] === "gap")) fixed += ln.pos[1];
  });
  return page.bottom == null ? fixed > heightMm : heightMm - page.bottom - fixed < 0;
}

// cover: 원고의 표지 정보, format: {name, kind, data}. 저장하면 저장한 표지 정보로, 아니면 null로 끝난다
export function coverDialog({ manuscriptId, cover, format, titleFallback = "" }) {
  return new Promise((resolve) => {
    const c = coverWithDefaults(cover);
    const kind = format.kind === "report" ? "report" : "thesis";
    const report = kind === "report";
    const pageNames = report ? { front: "앞표지", inner: "속표지", approval: "인준서" } : { front: "표지", inner: "속표지", approval: "인정서" };
    const data = format.data || {};
    const paper = data.page || { width_mm: report ? 210 : 188, height_mm: report ? 297 : 257 };
    const coverFonts = (data.cover && data.cover.fonts) || data.fonts;
    const months = (skip = []) => Array.from({ length: 12 }, (_, i) => i + 1).filter((x) => !skip.includes(x))
      .map((x) => `<option value="${x}">${x}월</option>`).join("");
    const grad = YM_RE.exec(c.graduation || "");
    const gradMonth = grad ? Number(grad[2]) : null;
    const appr = YM_RE.exec(c.approval || "");
    const members = [...c.committee];
    const advisors = c.advisors.map((a) => String(a || ""));
    const body = el(`<form class="cover-layout" data-cover-form autocomplete="off" novalidate>
      <div class="cover-form">
        <div class="status-line bad hidden" data-cover-error role="alert"></div>
        <p class="small muted" style="margin:0 0 10px"><span class="req-dot" aria-hidden="true"></span> 표시 칸이 비어 있으면 표지에 ○○○로 들어가요.</p>
        <div class="grid-2 ${report ? "hidden" : ""}" data-only="thesis">
          <div class="field">
            <label id="cv-degree-l">학위</label>
            <div class="seg seg-radio" role="radiogroup" aria-labelledby="cv-degree-l" data-degree>
              <label><input type="radio" name="degree" value="master" ${c.degree !== "doctor" ? "checked" : ""}><span>석사</span></label>
              <label><input type="radio" name="degree" value="doctor" ${c.degree === "doctor" ? "checked" : ""}><span>박사</span></label>
            </div>
          </div>
          <div class="field">
            <label for="cv-degree-field">학위명</label>
            <input class="input" id="cv-degree-field" name="degree_field" placeholder="공학" value="${esc(c.degree_field)}">
            <div class="hint" data-degree-hint></div>
          </div>
        </div>
        <div class="field">
          <label for="cv-title-ko">국문 제목</label>
          <input class="input" id="cv-title-ko" name="title_ko" placeholder="${esc(titleFallback || "○○○")}" value="${esc(c.title_ko)}">
          <div class="hint">비우면 원고 제목을 써요.</div>
        </div>
        <div class="grid-2">
          <div class="field"><label for="cv-title-en">영문 제목</label><input class="input" id="cv-title-en" name="title_en" placeholder="A Study on …" value="${esc(c.title_en)}"></div>
          <div class="field"><label for="cv-subtitle">부제 (선택)</label><input class="input" id="cv-subtitle" name="subtitle" value="${esc(c.subtitle)}"><div class="hint">국문 제목 밑에 – 부제 – 로 들어가요.</div></div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label id="cv-grad-l">졸업 연월<span class="req-dot" aria-hidden="true"></span></label>
            <div class="cover-ym" role="group" aria-labelledby="cv-grad-l">
              <input class="input cover-year" type="number" name="grad_year" min="2000" max="2100" inputmode="numeric" placeholder="2027" aria-label="졸업 연도" value="${grad ? grad[1] : ""}"><span>년</span>
              <div class="seg seg-radio" role="radiogroup" aria-label="졸업 월" data-grad-month>
                <label><input type="radio" name="grad_month" value="2" ${gradMonth === 2 ? "checked" : ""}><span>2월</span></label>
                <label><input type="radio" name="grad_month" value="8" ${gradMonth === 8 ? "checked" : ""}><span>8월</span></label>
                <label><input type="radio" name="grad_month" value="other" ${gradMonth && gradMonth !== 2 && gradMonth !== 8 ? "checked" : ""}><span>기타</span></label>
              </div>
              <select class="input hidden" name="grad_month_other" aria-label="졸업 월 (기타)">${months([2, 8])}</select>
            </div>
            <div class="hint hidden" data-grad-warn style="color:var(--warn)">2월·8월 졸업이 아니에요. 저장은 되지만 졸업 연월을 다시 확인해 주세요.</div>
          </div>
          <div class="field">
            <label id="cv-appr-l">인정 연월</label>
            <div class="cover-auto" data-approval-auto></div>
            <div class="cover-ym hidden" role="group" aria-labelledby="cv-appr-l" data-approval-manual>
              <input class="input cover-year" type="number" name="approval_year" min="2000" max="2100" inputmode="numeric" aria-label="인정 연도" value="${appr ? appr[1] : ""}"><span>년</span>
              <select class="input" name="approval_month" aria-label="인정 월">${months()}</select>
            </div>
            <div class="fmt-checks" style="margin:0"><label class="check"><input type="checkbox" name="approval_manual" ${appr ? "checked" : ""}> 직접 입력</label></div>
          </div>
        </div>
        <div class="field"><label for="cv-school">대학원</label><input class="input" id="cv-school" name="school" value="${esc(c.school)}"></div>
        <div class="grid-2">
          <div class="field"><label for="cv-dept">학과<span class="req-dot" aria-hidden="true"></span></label><input class="input" id="cv-dept" name="department" placeholder="스마트제조공학과" value="${esc(c.department)}"></div>
          <div class="field">
            <label for="cv-name">이름<span class="req-dot" aria-hidden="true"></span></label>
            <input class="input" id="cv-name" name="name" placeholder="김인하" value="${esc(c.name)}">
            <div class="fmt-checks" style="margin:0"><label class="check"><input type="checkbox" name="spaced_name" ${c.spaced_name ? "checked" : ""}> 글자 사이 띄우기 <span class="name-preview" data-name-preview></span></label></div>
          </div>
        </div>
        <div class="field">
          <label for="cv-adv1" data-adv-label>지도교수</label>
          <div class="row">
            <input class="input grow" id="cv-adv1" name="advisor_1" placeholder="홍길동" value="${esc(advisors[0] || "")}">
            <label class="check"><input type="checkbox" name="co_advised" ${advisors.filter((a) => a.trim()).length >= 2 ? "checked" : ""}> 공동지도</label>
          </div>
          <input class="input hidden" name="advisor_2" placeholder="두 번째 지도교수" aria-label="공동지도교수 2" style="margin-top:6px" value="${esc(advisors[1] || "")}">
          <div class="hint hidden" data-adv-hint>두 줄 모두 ‘공동지도교수 ○○○’로 들어가요.</div>
        </div>
        <fieldset class="cover-committee" data-committee>
          <legend>심사위원</legend>
          <div class="cover-members"></div>
          <div class="hint">비워 두면 직함만 들어가요.</div>
        </fieldset>
        <fieldset class="cover-include">
          <legend>넣을 쪽</legend>
          <div class="fmt-checks">
            <label class="check"><input type="checkbox" name="include_front" ${c.include.front ? "checked" : ""}> ${pageNames.front}</label>
            <label class="check"><input type="checkbox" name="include_inner" ${c.include.inner ? "checked" : ""}> ${pageNames.inner}</label>
            <label class="check"><input type="checkbox" name="include_approval" ${c.include.approval ? "checked" : ""}> ${pageNames.approval}</label>
          </div>
        </fieldset>
      </div>
      <aside class="cover-preview" aria-label="문구 미리보기">
        <div class="cover-preview-head">
          <span class="cover-preview-title">문구 미리보기</span>
          <div class="seg" data-cover-tabs>${["front", "inner", "approval"].map((k, i) =>
            `<button type="button" data-page="${k}" aria-pressed="${!i}" class="${i ? "" : "active"}">${pageNames[k]}</button>`).join("")}</div>
        </div>
        <div class="cover-sheet ${data.cover && data.cover.bold === false ? "" : "is-bold"}" data-cover-sheet></div>
        <div class="small muted">줄 순서와 글자 크기 비율만 보여 줘요. 실제 위치는 내보낸 파일에서 확인하세요.</div>
      </aside>
    </form>`);
    const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button><button class="btn primary" data-save>저장</button></div>`);
    let result = null;
    const m = modal({ title: `표지 정보 — ${format.name}`, body, foot, wide: true, onClose: () => resolve(result) });
    $(".modal", m.el).classList.add("cover-modal");
    if (report) setTimeout(() => $("[name=title_ko]", body).focus(), 50);

    const q = (name) => $(`[name="${name}"]`, body);
    const sheet = $("[data-cover-sheet]", body);
    sheet.style.setProperty("--ar", `${paper.width_mm} / ${paper.height_mm}`);
    sheet.style.setProperty("--cover-font", fontFamily(coverFonts));
    if (gradMonth && gradMonth !== 2 && gradMonth !== 8) q("grad_month_other").value = String(gradMonth);
    if (appr) q("approval_month").value = String(Number(appr[2]));
    let tab = "front";
    let autoManual = false; // [직접 입력]을 화면이 대신 켰는지 (자동 계산이 되면 다시 끈다)

    const degree = () => (report ? "master" : ($("[name=degree]:checked", body) || {}).value || "master");
    const memberCount = () => (degree() === "doctor" ? 5 : 3);
    function drawMembers() {
      const box = $(".cover-members", body);
      const roles = ["주심", "부심", "위원", "위원", "위원"].slice(0, memberCount());
      box.innerHTML = roles.map((r, i) => `<div class="cover-member"><label class="cover-role" for="cv-cm-${i}">${r}</label>
        <input class="input" id="cv-cm-${i}" name="committee" data-i="${i}" value="${esc(members[i] || "")}"></div>`).join("");
    }

    const gradMonthValue = () => {
      const r = ($("[name=grad_month]:checked", body) || {}).value;
      if (!r) return null;
      return r === "other" ? Number(q("grad_month_other").value) : Number(r);
    };
    // 졸업 연월 → 자동 인정 연월 문구 (계산할 수 없으면 null)
    function autoApproval() {
      const y = Number(q("grad_year").value);
      const mo = gradMonthValue();
      if (!/^\d{4}$/.test(q("grad_year").value.trim())) return null;
      if (mo === 2) return [`${y - 1}년 12월`, "2월 졸업 → 전년 12월", `${y - 1}`, 12];
      if (mo === 8) return [`${y}년 6월`, "8월 졸업 → 6월", `${y}`, 6];
      return null;
    }

    // 폼 → 표지 정보. strict면 연월 형식을 검사해 오류 문구도 돌려준다
    function collect(strict = false) {
      let error = "";
      const ym = (yearName, month, label) => {
        const y = q(yearName).value.trim();
        if (!y) return "";
        if (!/^\d{4}$/.test(y)) { error = error || `${label} 연도를 네 자리 숫자로 적어 주세요`; return ""; }
        if (!month) { error = error || `${label} 월을 골라 주세요`; return ""; }
        return `${y}-${pad2(month)}`;
      };
      const manual = q("approval_manual").checked;
      const co = q("co_advised").checked;
      const a1 = q("advisor_1").value.trim();
      const a2 = q("advisor_2").value.trim();
      const out = {
        degree: report ? c.degree : degree(),
        degree_field: q("degree_field").value.trim(),
        title_ko: q("title_ko").value.trim(),
        title_en: q("title_en").value.trim(),
        subtitle: q("subtitle").value.trim(),
        graduation: ym("grad_year", gradMonthValue(), "졸업"),
        approval: manual ? ym("approval_year", Number(q("approval_month").value), "인정") : "",
        school: q("school").value.trim() || DEFAULT_SCHOOL,
        department: q("department").value.trim(),
        name: q("name").value.trim(),
        spaced_name: q("spaced_name").checked,
        advisors: co ? [a1, a2].filter(Boolean) : a1 ? [a1] : [],
        committee: Array.from({ length: memberCount() }, (_, i) => String(members[i] || "").trim()),
        include: { front: q("include_front").checked, inner: q("include_inner").checked, approval: q("include_approval").checked },
      };
      return strict ? { cover: out, error } : out;
    }

    function sync() {
      const field = q("degree_field").value.trim();
      $("[data-degree-hint]", body).textContent = `${field}${degree() === "doctor" ? "박사" : "석사"}학위 논문`;
      const other = ($("[name=grad_month]:checked", body) || {}).value === "other";
      q("grad_month_other").classList.toggle("hidden", !other);
      $("[data-grad-warn]", body).classList.toggle("hidden", !other);
      // 인정 연월: 자동 표시 / 직접 입력
      const auto = autoApproval();
      const manualBox = q("approval_manual");
      if (!auto && !manualBox.checked) { manualBox.checked = true; autoManual = true; }
      else if (auto && manualBox.checked && autoManual) { manualBox.checked = false; autoManual = false; }
      const autoEl = $("[data-approval-auto]", body);
      autoEl.innerHTML = auto ? `${esc(auto[0])} <span class="muted">· ${esc(auto[1])}</span>` : "자동으로 정할 수 없어요. 직접 입력해 주세요.";
      autoEl.classList.toggle("is-warn", !auto);
      autoEl.classList.toggle("hidden", manualBox.checked && !autoManual); // 화면이 대신 켰으면 이유를 계속 보인다
      $("[data-approval-manual]", body).classList.toggle("hidden", !manualBox.checked);
      // 이름 띄우기 미리 보기
      const name = q("name").value.trim();
      $("[data-name-preview]", body).textContent = !q("spaced_name").checked || !name ? ""
        : /^[가-힣]{2,5}$/.test(name) ? spacedName(name, true) : "그대로 들어가요";
      // 공동지도
      const co = q("co_advised").checked;
      q("advisor_2").classList.toggle("hidden", !co);
      $("[data-adv-hint]", body).classList.toggle("hidden", !co);
      $("[data-adv-label]", body).textContent = co ? "공동지도교수" : "지도교수";
      drawSheet();
    }

    function drawSheet() {
      const cv = collect();
      const page = coverPages(kind, cv, titleFallback).find((p) => p.key === tab);
      const gap = (pos) => (pos[0] === "fill" ? `<div class="cover-fill"></div>`
        : pos[0] === "gap" && pos[1] > 0 ? `<div class="cover-gap ${pos[1] >= 15 ? "lg" : ""}"></div>` : "");
      sheet.innerHTML = page.lines.map((ln, i) => (i ? gap(ln.pos) : "")
        + `<p class="cover-line" style="--pt:${ln.size}">${ln.parts.map(([t, ph]) => (ph ? `<span class="ph">${esc(t)}</span>` : esc(t))).join("")}</p>`).join("");
      sheet.classList.toggle("is-off", !cv.include[tab]);
      sheet.classList.toggle("is-overflow", coverOverflow(page, paper.width_mm, paper.height_mm));
    }

    function setTab(k) {
      tab = k;
      $$("[data-cover-tabs] button", body).forEach((b) => {
        b.classList.toggle("active", b.dataset.page === k);
        b.setAttribute("aria-pressed", String(b.dataset.page === k));
      });
      drawSheet();
    }
    $$("[data-cover-tabs] button", body).forEach((b) => (b.onclick = () => setTab(b.dataset.page)));

    // 입력 칸에 포커스가 가면 관련 쪽으로 탭을 옮긴다
    body.addEventListener("focusin", (e) => {
      const n = e.target.name || "";
      if (/^(advisor_1|advisor_2|co_advised)$/.test(n)) setTab("inner");
      else if (/^(committee|approval_manual|approval_year|approval_month)$/.test(n)) setTab("approval");
    });
    body.addEventListener("input", (e) => {
      if (e.target.name === "committee") members[Number(e.target.dataset.i)] = e.target.value;
      sync();
    });
    body.addEventListener("change", (e) => {
      if (e.target.name === "degree") drawMembers();
      if (e.target.name === "approval_manual") {
        autoManual = false;
        const auto = autoApproval();
        if (e.target.checked && !q("approval_year").value) {
          q("approval_year").value = auto ? auto[2] : q("grad_year").value;
          if (auto) q("approval_month").value = String(auto[3]);
        }
      }
      sync();
    });

    const showError = (msg) => {
      const box = $("[data-cover-error]", body);
      box.textContent = msg;
      box.classList.toggle("hidden", !msg);
      if (msg) box.scrollIntoView({ block: "nearest" });
    };
    const saveBtn = $("[data-save]", foot);
    async function save() {
      const { cover: out, error } = collect(true);
      if (error) return showError(error);
      showError("");
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<span class="spinner"></span> 저장 중`;
      try {
        await api.patch(`/api/manuscripts/${manuscriptId}`, { cover: out });
        result = out;
        m.close();
        toast("표지 정보를 저장했어요", "success");
      } catch (e) {
        showError(plainMessage(e));
        saveBtn.disabled = false;
        saveBtn.textContent = "저장";
      }
    }
    saveBtn.onclick = save;
    $("[data-no]", foot).onclick = () => m.close();
    body.onsubmit = (e) => { e.preventDefault(); save(); };
    body.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing && e.target.matches("input:not([type=checkbox]):not([type=radio])")) {
        e.preventDefault();
        save();
      }
    });

    drawMembers();
    sync();
  });
}
