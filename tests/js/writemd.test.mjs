// 한글 원고 굵게 · 기울임 (writemd.js — 2026-10-26 "굵게 · 기울임을 적용해도 미리보기에 안 보임") · AI 패널 폭 (writeai.js)
// 실행: node --test tests/js/writemd.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const md = await import(pathToFileURL(join(JS, "writemd.js")).href);
const ai = await import(pathToFileURL(join(JS, "writeai.js")).href);
const { marked } = createRequire(import.meta.url)(join(ROOT, "paperlab", "static", "vendor", "marked.min.js"));

test("기본 marked는 한글 조사 앞 문장 부호 뒤 **를 강조로 안 읽음 → 확장을 걸면 읽음", () => {
  assert.equal(marked.parseInline("**연구(2020)**에서"), "**연구(2020)**에서"); // 고치기 전 모습(사용자 지적)
  md.useLenientEmphasis(marked);
  md.useLenientEmphasis(marked); // 두 번 걸어도 한 번
  const cases = {
    "**연구(2020)**에서": "<strong>연구(2020)</strong>에서",
    "**\"강조\"**는": "<strong>&quot;강조&quot;</strong>는",
    "**A.**는": "<strong>A.</strong>는",
    "*연구(2020)*에서": "<em>연구(2020)</em>에서",
    "이것은 **굵게**이다": "이것은 <strong>굵게</strong>이다",
    "**a *b* c**": "<strong>a <em>b</em> c</strong>",
    "**a** 와 **b**": "<strong>a</strong> 와 <strong>b</strong>",
    "***둘 다***": "<em><strong>둘 다</strong></em>",
  };
  for (const [src, html] of Object.entries(cases)) assert.equal(marked.parseInline(src), html, src);
});

test("강조가 아닌 별표는 그대로: 곱셈 · 짝 없음 · 빈칸 · 코드 · 이스케이프", () => {
  md.useLenientEmphasis(marked);
  assert.equal(marked.parseInline("2 * 3 * 4"), "2 * 3 * 4");
  assert.equal(marked.parseInline("**짝 없음"), "**짝 없음");
  assert.equal(marked.parseInline("**단어 **다음"), "**단어 **다음");
  assert.equal(marked.parseInline("`**코드**`"), "<code>**코드**</code>");
  assert.equal(marked.parseInline(String.raw`\*별\*`), "*별*");
  assert.equal(marked.parseInline(String.raw`p < .05\* 이다`), "p &lt; .05* 이다");
  // 미리보기 · 내보내기가 쓰는 토큰도 strong
  assert.deepEqual(marked.Lexer.lexInline("**연구(2020)**에서").map((t) => t.type), ["strong", "text"]);
});

test("굵게 감싸기: 고른 글 앞뒤 빈칸은 표시 밖 (두 번 클릭이 뒤 빈칸까지 고른 경우)", () => {
  const v = "앞 낱말 뒤";
  const w = md.wrapParts(v, 2, 5, "**", "**"); // "낱말 " (뒤 빈칸 포함)
  assert.deepEqual(w, { start: 2, end: 4, text: "**낱말**", selStart: 4, selEnd: 6 });
  assert.equal(v.slice(0, w.start) + w.text + v.slice(w.end), "앞 **낱말** 뒤");
  assert.equal(md.wrapParts("abc", 1, 1, "*", "*").text, "*글자*"); // 고른 글 없음 → 자리 글자
  assert.equal(md.wrapParts("a   b", 1, 4, "*", "*").text, "*글자*"); // 빈칸만 고름
});

test("writing.js · ui.js 가 확장을 걸고 wrap 이 wrapParts 를 씀", () => {
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /async function buildDocument[^\n]*\n\s*useLenientEmphasis\(window\.marked\)/);
  assert.match(w, /function wrap\(ta, before, after\) \{\s*const w = wrapParts\(/);
  assert.match(readFileSync(join(JS, "ui.js"), "utf8"), /useLenientEmphasis\(window\.marked\);[^\n]*\n\s*let html = window\.marked/);
});

test("AI 패널 폭: 범위 · 저장 · 깨진 값 · CSS (2026-10-26 끌어서 폭 바꾸기)", () => {
  assert.equal(ai.clampPaneWidth(100), ai.PANE_MIN_W);
  assert.equal(ai.clampPaneWidth(99999), ai.PANE_MAX_W);
  assert.equal(ai.clampPaneWidth(520.4), 520);
  assert.equal(ai.clampPaneWidth("x"), null);
  const mem = new Map();
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  assert.equal(ai.loadPaneWidth(st), null);
  ai.savePaneWidth(st, 640);
  assert.equal(ai.loadPaneWidth(st), 640);
  ai.savePaneWidth(st, null); // 두 번 눌러 기본 폭
  assert.equal(ai.loadPaneWidth(st), null);
  mem.set(ai.AI_PANE_W_KEY, "garbage");
  assert.equal(ai.loadPaneWidth(st), null);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(ai.loadPaneWidth(broken), null);
  ai.savePaneWidth(broken, 500); // 오류 없이
  assert.equal(ai.paneWidthCss(600), "clamp(280px, 600px, max(280px, 100vw - 560px))");
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /paneResizer\(view\);/);
  assert.match(w, /\$\$\("#ai-pane, #fig-pane", view\)/);
  assert.match(readFileSync(join(ROOT, "paperlab", "static", "css", "app.css"), "utf8"), /\.pane-resize \{[^}]*cursor: col-resize/);
});

test("[확인 필요: …] 색 표시: 편집기 강조 층 HTML · 미리보기 · 편집기 연결", () => {
  assert.equal(md.checkMarkHtml("표시 없음"), "");
  assert.equal(md.checkMarkHtml("[확인 대상]"), "");
  assert.equal(md.checkMarkHtml("a <b> [확인 필요: 수치 — 통계청 KOSIS] 끝\n[확인필요]"),
    "a &lt;b&gt; <mark>[확인 필요: 수치 — 통계청 KOSIS]</mark> 끝\n<mark>[확인필요]</mark>\n ");
  assert.equal([..."[확인 필요: 출처\n]".matchAll(md.CHECK_RE)].length, 0); // 줄을 넘지 않음
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /checkLayer\(ta\);/);
  assert.match(w, /doc\.innerHTML = blocksToHtml\(built\.blocks\)[^\n]*\n\s*markChecks\(doc\);/);
  const css = readFileSync(join(ROOT, "paperlab", "static", "css", "app.css"), "utf8");
  assert.match(css, /\.writer-ta, \.writer-hl \{ padding: 16px 16px 48px; \}/); // 좁은 화면 여백도 같게
  assert.match(css, /\.doc mark\.check-mark \{/);
});

test("표: 칸 안 줄바꿈 <br> 왕복 · 머리글 가운데 · 표 창 (2026-10-26)", async () => {
  const we = await import(pathToFileURL(join(JS, "writeedit.js")).href);
  const md2 = we.tableMarkdown({ rows: [["구분", "AS-IS"], ["보안", "1) 개인 PC\n2) 공유 폴더"]], align: [null, null], caption: "시험" });
  assert.match(md2, /\| 보안 \| 1\) 개인 PC<br>2\) 공유 폴더 \|/);
  const t = we.findTables(md2, marked.lexer)[0];
  assert.deepEqual(t.rows[1], ["보안", "1) 개인 PC\n2) 공유 폴더"]);
  assert.deepEqual(we.findTables("| a |\n| --- |\n| x<br/>y |", null)[0].rows[1], ["x\ny"]);
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /<br\\s\*\\\/\?>\$\/i\.test\(t\.text\.trim\(\)\)\) runs\.push\(\{ text: "\\n"/);
  assert.match(w, /text-align:\$\{ri === 0 \? "center"/);
  assert.match(w, /addEventListener\("dblclick", \(\) => \{ if \(tableAt\(ta\.value, ta\.selectionStart\)\) editTable\(ta\); \}\)/);
  const tools = readFileSync(join(JS, "writetools.js"), "utf8");
  assert.match(tools, /floating: true/);
  assert.match(tools, /e\.shiftKey \|\| e\.isComposing/);
  const ui = readFileSync(join(JS, "ui.js"), "utf8");
  assert.match(ui, /dragModal\(box\);/);
  assert.match(ui, /!top\.classList\.contains\("floating"\)/);
});
