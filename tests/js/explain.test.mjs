// 4단계 쉬운 설명 · 번역 화면의 순수 함수 · 코드 검사 (docs/specs/phase4-explain-translate.md 7.3절 · 13장, 시안 5장)
// DOMPurify 동작 자체는 Node에 DOM이 없어 브라우저 수동 확인(AC-G04)으로.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.document = { addEventListener() {}, hidden: false };
globalThis.window = { addEventListener() {} };
const U = await import("../../paperlab/static/js/ui.js");
const X = await import("../../paperlab/static/js/explain.js");

const read = (p) => readFileSync(new URL(`../../paperlab/static/js/${p}`, import.meta.url), "utf8");

describe("SVG 순수 함수 (AC-G03)", () => {
  const colors = { text: "#e7e9ee", accent: "#9db5f5" };
  test("currentColor · var(--x, y) → 테마 계산값", () => {
    assert.equal(U.svgColor("currentColor", colors), "#e7e9ee");
    assert.equal(U.svgColor("CurrentColor", colors), "#e7e9ee");
    assert.equal(U.svgColor("var(--accent)", colors), "#9db5f5");
    assert.equal(U.svgColor("var( --accent-text , #2563eb)", colors), "#9db5f5");
    assert.equal(U.svgColor("url(#arrow)", colors), "url(#arrow)");
    assert.equal(U.svgColor("2", colors), "2");
  });
  test("url(#이름)만 남김", () => {
    assert.ok(U.svgUrlOk("url(#arrow)"));
    assert.ok(U.svgUrlOk("none"));
    for (const bad of ["url(https://evil.example/a.svg#g)", "url( #a )", "URL(data:image/png;base64,AA)", "url(#a) url(//x)",
      "url('#a')", "url(javascript:alert(1))", String.raw`u\72l(https://e/x)`, String.raw`u\72 l(https://e/x)`, String.raw`\75 rl(//e/x)`, String.raw`\u\r\l(//e)`]) {
      assert.equal(U.svgUrlOk(bad), false, bad);
    }
    assert.equal(U.cssUnescape(String.raw`u\72l`), "url"); // L-1: CSS 이스케이프를 푼 뒤 검사
  });
  test("요소 수 · viewBox 상한 (K-3)", () => {
    assert.ok(U.svgCountOk(1500));
    assert.equal(U.svgCountOk(1501), false);
    assert.ok(U.svgViewBoxOk("0 0 400 600"));
    assert.ok(U.svgViewBoxOk("0,0,4000,4000"));
    for (const bad of ["0 0 0 600", "0 0 400 0", "0 0 4001 10", "0 0 -1 5", "0 0 400", "", null, "a b c d"]) {
      assert.equal(U.svgViewBoxOk(bad), false, String(bad));
    }
  });
  test("renderSvg는 DOMPurify가 없으면 그리지 않음", () => {
    assert.equal(U.renderSvg("<svg viewBox='0 0 1 1'></svg>"), null);
  });
});

describe("마크다운 정화 (품질팀 H-1 · L-2)", () => {
  test("class · id 금지, HTML 프로필 + svg · math 금지", () => {
    for (const a of ["class", "id", "style", "popover"]) assert.ok(U.MD_PURIFY.FORBID_ATTR.includes(a), a);
    for (const t of ["svg", "math", "dialog", "style", "img", "form", "button"]) assert.ok(U.MD_PURIFY.FORBID_TAGS.includes(t), t);
    assert.deepEqual(U.MD_PURIFY.USE_PROFILES, { html: true });
  });
  test("수식 · 인용 단추는 정화가 끝난 뒤 끼워 넣음 (class를 잃지 않음)", () => {
    const ui = read("ui.js");
    const fn = ui.slice(ui.indexOf("export function renderMarkdown"), ui.indexOf("export function safeUrl"));
    const san = fn.indexOf("purifyMd(html)");
    assert.ok(san > 0 && fn.indexOf('b.className = "cite-ref"') > san && fn.indexOf("span.innerHTML = store[") > san);
    const pm = ui.slice(ui.indexOf("export function purifyMd"), ui.indexOf("export function renderMarkdown"));
    assert.match(pm, /P\.sanitize\(html, MD_PURIFY\)/);
    assert.match(pm, /mdLinks && node\.tagName === "A"/); // 새 탭 링크는 MD 정화 때만 (L-5)
  });
});

describe("선택 · 위치 (시안 2장)", () => {
  test("보내기 전 검사", () => {
    assert.deepEqual(X.selCheck(" a "), { ok: false, msg: "" });
    assert.equal(X.selCheck("가".repeat(4001)).msg, "4,000자까지 설명할 수 있어요. 조금 줄여서 골라 주세요");
    assert.deepEqual(X.selCheck(" a \n b "), { ok: true, text: "a b" });
  });
  test("rects → 경계 상자 [x0, y0, x1, y1]", () => {
    assert.deepEqual(X.rectBox([[0.1, 0.2, 0.3, 0.02], [0.1, 0.23, 0.5, 0.02]]), [0.1, 0.2, 0.6, 0.25]);
    assert.equal(X.rectBox([]), null);
  });
});

describe("쪽 상태 → 문구 (시안 5.4절 · AD-4)", () => {
  test("글자마다 모양 · 버튼", () => {
    assert.equal(X.pageView("d").mode, "text");
    assert.equal(X.pageView("-", { active: true }).text, "아직 번역 전이에요. 차례가 오면 바로 보여 드려요.");
    assert.deepEqual(X.pageView("-").action, { label: "이어서 번역", pages: "pending" });
    const f = X.pageView("f", { code: "api_refusal" });
    assert.equal(f.tone, "warn");
    assert.equal(f.text, "AI가 답하기를 거절함");
    assert.equal(f.action.label, "이 쪽 다시");
    assert.equal(X.pageView("s", { lang: "ko" }).text, "글자가 거의 없거나 이미 한국어인 쪽이라 건너뛰었어요.");
    assert.equal(X.pageView("s", { lang: "en" }).text, "글자가 거의 없거나 이미 English인 쪽이라 건너뛰었어요.");
    assert.deepEqual(X.pageView("r").action, { label: "포함해 번역", includeRefs: true });
    assert.equal(X.pageView(".", { range: [3, 5] }).text, "번역 범위 밖이에요 (p.3~5만 번역했어요).");
  });
  test("개수 · 범위", () => {
    assert.deepEqual(X.trCounts("dd-fs.r"), { done: 2, failed: 1, pending: 1, skipped: 1, refs: 1, outside: 1, total: 4 });
    assert.deepEqual(X.trRange("..---...."), [3, 5]);
    assert.equal(X.trRange("...."), null);
  });
});

describe("시작 창 예상 다시 셈 (AD-3)", () => {
  const k = { chars_per_token: 3.25, out_ratio: 1.6, chunk_overhead: 1800, tokens_per_s: 110, chunk_wait_s: 5, chunk_pages: 3, chunk_chars: 9000 };
  const est = { n: 20, refs_from: 18, refs_cut: 0, page_chars: Array(20).fill(3500), page_ko: Array(20).fill(false), k };
  test("서버 translate.estimate와 같은 수 (tests/test_explain.py와 같은 예)", () => {
    const e = X.estimateFor(est);
    assert.equal(e.state, "-".repeat(17) + "srr");
    assert.equal(e.pages, 17);
    assert.equal(e.chunks, 9);
    assert.ok(e.input >= 33000 && e.input <= 36000, String(e.input));
    assert.ok(e.output >= 28000 && e.output <= 31000, String(e.output));
    assert.ok(e.minutes >= 5 && e.minutes <= 7);
  });
  test("범위 · 참고문헌 포함 · 언어", () => {
    assert.equal(X.estimateFor(est, { from: 3, to: 5 }).state, "..---" + ".".repeat(15));
    assert.equal(X.estimateFor(est, { includeRefs: true }).pages, 20);
    const ko = { ...est, page_ko: est.page_ko.map((_, i) => i < 2) };
    assert.equal(X.estimateFor(ko, { lang: "ko" }).skipped, 3);
    assert.equal(X.estimateFor(ko, { lang: "en" }).skipped, 1);
    assert.equal(X.estimateFor(est, { from: 19, to: 20 }).pages, 0);
    assert.equal(X.estimateFor(est, { from: 19, to: 20 }).minutes, 0);
  });
  test("토큰 표기", () => {
    assert.equal(X.fmtTok(19500), "약 2만");
    assert.equal(X.fmtTok(22900), "약 2.3만");
    assert.equal(X.fmtTok(5200), "약 5천");
  });
});

describe("코드 검사 (AC-G02 · 시안 0장)", () => {
  const ui = read("ui.js");
  const xt = read("explain.js");
  const reader = read("reader.js");
  test("SVG_PURIFY 목록 · svgFilters 없음", () => {
    for (const t of ["style", "image", "a", "use", "foreignObject", "script", "feImage", "animate", "set", "animateMotion",
      "animateTransform", "textPath", "mpath"]) assert.ok(U.SVG_PURIFY.FORBID_TAGS.includes(t), t);
    for (const a of ["style", "href", "xlink:href", "class"]) assert.ok(U.SVG_PURIFY.FORBID_ATTR.includes(a), a);
    assert.deepEqual(U.SVG_PURIFY.USE_PROFILES, { svg: true });
    assert.ok(!/svgFilters/.test(ui) && !/svgFilters/.test(xt));
    assert.ok(!U.SVG_PURIFY.FORBID_ATTR.includes("id")); // 마커 url(#arrow)용 — img 격리로 앱 DOM과 섞이지 않음
  });
  test("renderSvg = <img> + blob:, SVG 문자열을 innerHTML로 넣지 않음", () => {
    const fn = ui.slice(ui.indexOf("export function renderSvg"));
    assert.match(fn, /createElement\("img"\)/);
    assert.match(fn, /URL\.createObjectURL\(new Blob\(/);
    assert.match(fn, /type: "image\/svg\+xml"/);
    assert.match(fn, /revokeObjectURL/);
    assert.ok(!/innerHTML/.test(fn));
    assert.ok(!/innerHTML[^;\n]*\bsvg\b/i.test(xt), "explain.js: SVG를 innerHTML로");
    assert.ok(!/MD_PURIFY/.test(xt) && !/renderMarkdown\([^)]*svg/i.test(xt));
    assert.match(xt, /renderSvg\(it\.svg/);
  });
  test("상자 버튼 · 탭 · data 속성", () => {
    assert.match(reader, /data-tab="chat">질문하기<\/button><button data-tab="explain">설명·번역<\/button>/); // AD-7
    assert.match(reader, /data-explain\$\{busy\}>쉽게 설명<\/button><button class="btn sm ghost" data-translate\$\{busy\}>번역/);
    assert.match(reader, /R\.embed \? "" : `<button class="btn sm ghost" data-ask>AI에게 묻기<\/button>\$\{xtButtons\(\)\}`/); // 1C에는 없음
    assert.match(reader, /data-ai-row/); // AD-6
    assert.match(reader, /panel-sheet/); // AD-1
    for (const a of ["data-xt-view", "data-xt-live", "data-xt-id", "data-xt-goto", "data-xt-memo", "data-xt-copy", "data-xt-more",
      "data-xt-start", "data-page-state", "data-xt-prev", "data-xt-next", "data-xt-follow", "data-xt-page", "data-xt-retry",
      "data-xt-continue", "data-xt-manuscript", "data-xt-delete", "xt-start-form", "data-xt-est", "data-xt-start-error", "xt-range", "xt-head", "xt-figure"]) {
      assert.ok(xt.includes(a), a);
    }
  });
  test("선택 글은 본문으로만 (주소에 없음)", () => {
    assert.match(xt, /streamEvents\(`\/api\/papers\/\$\{s\.pid\}\/explain`, \{ kind, text: run\.text/);
    assert.ok(!/location\.hash\s*=.*text/.test(xt));
  });
});
