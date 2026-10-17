// 논문 쓰기 편집 도우미: 목록 Enter · Backspace · Tab · 켜고 끄기, 번호 다시 매기기, 표 읽기 · 쓰기,
// 그림 · 표 캡션 · 상호 참조, 단축키 도움말 (docs/specs/writing-figures-tables.md)
// 실행: node --test tests/js/writeedit.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bare, templateExprs } from "./codecheck.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const we = await import(pathToFileURL(join(JS, "writeedit.js")).href);
const { marked } = createRequire(import.meta.url)(join(ROOT, "paperlab", "static", "vendor", "marked.min.js"));
const src = (name) => readFileSync(join(JS, name), "utf8");

// "|" 자리에 커서 (선택은 "[" ~ "]")를 둔 글 → { value, start, end }
function at(s) {
  const a = s.indexOf("[");
  if (a >= 0) {
    const b = s.indexOf("]");
    return { value: s.slice(0, a) + s.slice(a + 1, b) + s.slice(b + 1), start: a, end: b - 1 };
  }
  const i = s.indexOf("|");
  return { value: s.slice(0, i) + s.slice(i + 1), start: i, end: i };
}
// 편집 결과를 다시 "|" 표기로
function run(fn, s, ...args) {
  const { value, start, end } = at(s);
  const e = fn(value, start, end, ...args);
  if (!e) return null;
  const v = we.applyEditToValue(value, e);
  return e.selStart === e.selEnd ? v.slice(0, e.selStart) + "|" + v.slice(e.selStart)
    : v.slice(0, e.selStart) + "[" + v.slice(e.selStart, e.selEnd) + "]" + v.slice(e.selEnd);
}

test("목록 줄 읽기: 기호 · 번호 · 내용 위치, 쪽 나눔 · 굵게는 목록 아님", () => {
  assert.deepEqual(we.parseListLine("  - 항목"), { indent: 2, marker: "-", gap: " ", content: "항목", ordered: false, num: 0, delim: "", contentCol: 4 });
  const o = we.parseListLine("12) 열둘");
  assert.equal(o.ordered, true);
  assert.equal(o.num, 12);
  assert.equal(o.delim, ")");
  assert.equal(o.contentCol, 4);
  assert.equal(we.parseListLine("---"), null);
  assert.equal(we.parseListLine("**굵게**"), null);
  assert.equal(we.parseListLine("2026.10.16 날짜"), null);
});

test("Enter: 다음 항목 기호 · 번호 이어 붙이기 · 뒤 번호 다시 매기기", () => {
  assert.equal(run(we.enterEdit, "- 사과|"), "- 사과\n- |");
  assert.equal(run(we.enterEdit, "  * 하위|"), "  * 하위\n  * |");
  assert.equal(run(we.enterEdit, "1. 하나|\n2. 둘"), "1. 하나\n2. |\n3. 둘");
  assert.equal(run(we.enterEdit, "9. 아홉|"), "9. 아홉\n10. |");
  // 항목 가운데에서 누르면 뒷부분이 새 항목으로
  assert.equal(run(we.enterEdit, "- 앞|뒤"), "- 앞\n- |뒤");
  // 기호 안 · 목록 아닌 줄 · 선택이 있으면 기본 동작
  assert.equal(run(we.enterEdit, "-| 사과"), null);
  assert.equal(run(we.enterEdit, "그냥 문장|"), null);
  assert.equal(run(we.enterEdit, "- [사과]"), null);
});

test("Enter: 빈 항목에서 누르면 목록 끝(맨 바깥) · 내어쓰기(하위)", () => {
  assert.equal(run(we.enterEdit, "- 사과\n- |"), "- 사과\n|");
  assert.equal(run(we.enterEdit, "1. 하나\n2. |"), "1. 하나\n|");
  assert.equal(run(we.enterEdit, "- 사과\n  - |"), "- 사과\n- |");
});

test("Backspace: 내용 맨 앞이면 하위 항목은 내어쓰기, 맨 바깥은 기호만 지우기", () => {
  assert.equal(run(we.backspaceEdit, "- |사과"), "|사과");
  assert.equal(run(we.backspaceEdit, "1. 하나\n2. |둘\n3. 셋"), "1. 하나\n|둘\n2. 셋"); // 둘은 앞 항목에 이어지는 글
  assert.equal(run(we.backspaceEdit, "- 사과\n  - |배"), "- 사과\n- |배");
  assert.equal(run(we.backspaceEdit, "- 사|과"), null);
  assert.equal(run(we.backspaceEdit, "문장|"), null);
});

test("Tab · Shift+Tab: 위 형제의 내용 위치까지 들여쓰기 (번호 목록은 3칸), 첫 항목은 그대로", () => {
  assert.equal(run(we.indentEdit, "- 사과\n- |배", false), "- 사과\n  - |배");
  assert.equal(run(we.indentEdit, "1. 하나\n2. 둘|", false), "1. 하나\n   1. 둘|");
  assert.equal(run(we.indentEdit, "- |사과", false), null);
  assert.equal(run(we.indentEdit, "- 사과\n  - 배|", true), "- 사과\n- 배|");
  assert.equal(run(we.indentEdit, "- 사과|", true), null);
  // 하위 항목도 함께 옮김
  assert.equal(run(we.indentEdit, "- a\n- b|\n  - c\n- d", false), "- a\n  - b|\n    - c\n- d");
  // 목록 아닌 줄: Tab은 기본(공백 2칸), Shift+Tab은 앞 공백 2칸 지우기
  assert.equal(run(we.indentEdit, "문장|", false), null);
  assert.equal(run(we.indentEdit, "    문장|", true), "  문장|");
  // 여러 줄 선택
  assert.equal(run(we.indentEdit, "- a\n[- b\n- c]", false), "- a\n[  - b\n  - c]");
});

test("들여쓰기 · 내어쓰기 뒤 번호를 단계마다 다시 매김", () => {
  assert.equal(run(we.indentEdit, "1. 하나\n2. 둘|\n3. 셋", false), "1. 하나\n   1. 둘|\n2. 셋");
  assert.equal(run(we.indentEdit, "1. 하나\n   1. 둘|\n2. 셋", true), "1. 하나\n2. 둘|\n3. 셋");
  assert.equal(we.renumberAround("3. a\n3. b\n- x\n1. c", 0), "3. a\n4. b\n- x\n1. c");
  assert.equal(we.renumberAround("문단\n\n1. a\n1. b", 0), "문단\n\n1. a\n1. b"); // 목록 밖이면 그대로
  // 가운데 항목을 끄거나 글머리로 바꾸면 뒤 번호도 마크다운이 보여 주는 번호와 같게
  assert.equal(run(we.toggleListEdit, "1. 하나\n2. 둘|\n3. 셋", true), "1. 하나\n둘|\n2. 셋");
  assert.equal(run(we.toggleListEdit, "1. 하나\n2. 둘|\n3. 셋", false), "1. 하나\n- 둘|\n1. 셋");
  const lex = (s) => marked.lexer(s).filter((t) => t.type === "list").map((t) => [t.ordered, Number(t.start) || 1, t.items.length]);
  assert.deepEqual(lex("1. 하나\n둘\n2. 셋"), [[true, 1, 2]]);
  assert.deepEqual(lex("1. 하나\n- 둘\n1. 셋"), [[true, 1, 1], [false, 1, 1], [true, 1, 1]]);
});

test("목록 켜기 · 끄기: 고른 줄 모두에, 번호는 1부터, 이미 그 목록이면 끄기", () => {
  assert.equal(run(we.toggleListEdit, "사|과", false), "- 사|과");
  assert.equal(run(we.toggleListEdit, "|", false), "- |");
  assert.equal(run(we.toggleListEdit, "[사과\n배]", true), "[1. 사과\n2. 배]");
  assert.equal(run(we.toggleListEdit, "[- 사과\n- 배]", false), "[사과\n배]");
  assert.equal(run(we.toggleListEdit, "[- 사과\n- 배]", true), "[1. 사과\n2. 배]");
  assert.equal(run(we.toggleListEdit, "## 제|목", false), "- 제|목");
});

test("마크다운으로 읽었을 때 하위 목록이 실제로 하위가 됨 (marked)", () => {
  const nested = (s) => marked.lexer(s)[0].items[0].tokens.some((t) => t.type === "list");
  const tabbed = (s) => { const { value, start, end } = at(s); return we.applyEditToValue(value, we.indentEdit(value, start, end, false)); };
  assert.ok(nested(tabbed("1. 하나\n2. 둘|")));
  assert.ok(nested(tabbed("- 하나\n- 둘|")));
  assert.ok(nested(tabbed("10. 열\n11. 열하나|")));
});

test("그림 문단 · 표 캡션 · 상호 참조 읽기", () => {
  assert.deepEqual(we.figureInfo("![실험 \\] 장치](fig:0123456789abcdef.png){#fig:setup}"),
    { alt: "실험 ] 장치", src: "0123456789abcdef.png", label: "fig:setup" });
  assert.equal(we.figureInfo("![x](https://evil.example/a.png)"), null);
  assert.equal(we.figureInfo("앞 ![x](fig:0123456789abcdef.png)"), null);
  assert.equal(we.figureInfo("![x](fig:0123456789abcdef.svg)"), null);
  assert.deepEqual(we.captionInfo("표: 실험 결과 {#tbl:res}"), { text: "실험 결과", label: "tbl:res" });
  assert.deepEqual(we.captionInfo("Table: Results"), { text: "Results", label: "" });
  assert.equal(we.captionInfo("표는 다음과 같다"), null);
  assert.deepEqual(we.splitXrefs("그림은 @fig:setup 과 @tbl:res. 메일 a@fig:x"),
    ["그림은 ", { xref: "fig:setup" }, " 과 ", { xref: "tbl:res" }, ". 메일 a@fig:x"]);
  assert.equal(we.captionLabel("fig", 2), "그림 2.");
  assert.equal(we.captionLabel("tbl", 1, false), "Table 1.");
  assert.equal(we.xrefText("tbl", 3), "표 3");
  const blocks = [{ runs: [{ xref: "fig:a", text: "" }, { xref: "tbl:zz", text: "" }] },
    { type: "table", rows: [[[{ xref: "fig:a" }]]], caption: [{ footnote: [{ xref: "fig:a" }] }] }];
  we.resolveXrefs(blocks, new Map([["fig:a", { kind: "fig", n: 4 }]]));
  assert.equal(blocks[0].runs[0].text, "그림 4");
  assert.deepEqual([blocks[0].runs[1].text, blocks[0].runs[1].warn], ["@tbl:zz?", true]);
  assert.equal(blocks[1].rows[0][0][0].text, "그림 4");
  assert.equal(blocks[1].caption[0].footnote[0].text, "그림 4");
  // marked가 캡션 줄과 표를 따로 읽는지 (캡션 줄 바로 아래 표)
  const toks = marked.lexer("표: 결과\n| a | b |\n| --- | --- |\n| 1 | 2 |").filter((t) => t.type !== "space");
  assert.deepEqual(toks.map((t) => t.type), ["paragraph", "table"]);
  assert.ok(we.captionInfo(toks[0].text));
});

test("표 마크다운 읽기 · 쓰기 왕복 (| 글자 · 정렬 · 캡션)", () => {
  const md = "앞 문단\n\n표: 결과 {#tbl:r}\n| 항목 | 값 \\| 단위 |\n| :-- | --: |\n| 정확도 | 0.9 |\n| 재현율 |\n\n뒤";
  const [t] = we.findTables(md);
  assert.deepEqual(t.rows, [["항목", "값 | 단위"], ["정확도", "0.9"], ["재현율", ""]]);
  assert.deepEqual(t.align, ["left", "right"]);
  assert.deepEqual([t.caption, t.label], ["결과", "tbl:r"]);
  assert.equal(md.slice(t.captionFrom, t.to).split("\n")[0], "표: 결과 {#tbl:r}");
  const out = we.tableMarkdown(t);
  assert.equal(out, "표: 결과 {#tbl:r}\n| 항목 | 값 \\| 단위 |\n| :-- | --: |\n| 정확도 | 0.9 |\n| 재현율 |   |");
  const again = we.findTables(out)[0];
  assert.deepEqual(again.rows, [["항목", "값 | 단위"], ["정확도", "0.9"], ["재현율", ""]]);
  const tok = marked.lexer(out).find((x) => x.type === "table");
  assert.deepEqual(tok.header.map((c) => c.text), ["항목", "값 | 단위"]);
  assert.equal(we.tableAt(md, md.indexOf("정확도")).from, t.from);
  assert.equal(we.tableAt(md, md.indexOf("결과")).from, t.from); // 캡션 줄에서도
  assert.equal(we.tableAt(md, 0), null);
  // 코드 블록 안의 표는 표가 아님
  assert.equal(we.findTables("```\n| a |\n| --- |\n```").length, 0);
  const nt = we.newTable(3, 2);
  assert.deepEqual(nt.rows, [["제목1", "제목2"], ["", ""], ["", ""]]);
  assert.equal(we.newTable(500, 99).rows.length, 50);
});

test("그림 · 표를 문단으로 넣기: 앞뒤 빈 줄, 캡션 고르기", () => {
  const md = we.figureMarkdown("0123456789abcdef.png", "그림 설명");
  assert.equal(md, "![그림 설명](fig:0123456789abcdef.png)");
  assert.equal(we.figureMarkdown("0123456789abcdef.png", "a]b"), "![a\\]b](fig:0123456789abcdef.png)");
  const e = we.blockInsert("문장 끝", 4, 4, md, [2, 7]);
  const v = we.applyEditToValue("문장 끝", e);
  assert.equal(v, `문장 끝\n\n${md}\n\n`);
  assert.equal(v.slice(e.selStart, e.selEnd), "그림 설명");
  assert.equal(we.applyEditToValue("a\n\nb", we.blockInsert("a\n\nb", 3, 3, "X")), "a\n\nX\n\nb");
  // 문장 가운데 커서: 문장을 가르지 않고 그 줄 뒤에
  assert.equal(we.applyEditToValue("앞문장 뒷문장\n다음", we.blockInsert("앞문장 뒷문장\n다음", 3, 3, "X")), "앞문장 뒷문장\n\nX\n\n다음");
});

test("그림 문단 찾기: 앞뒤 빈 줄인 그림 줄만 순서대로, 캡션 글 위치", () => {
  const v = "# 제목\n![첫 그림](fig:0123456789abcdef.png)\n\n문장 ![안](fig:0123456789abcdee.png)\n\n```\n![코드](fig:0123456789abcded.png)\n```\n\n![둘째](fig:0123456789abcdec.jpg){#fig:b}";
  const f = we.findFigures(v);
  assert.deepEqual(f.map((x) => x.src), ["0123456789abcdef.png", "0123456789abcdec.jpg"]);
  assert.deepEqual(f.map((x) => v.slice(x.altFrom, x.altTo)), ["첫 그림", "둘째"]);
  // 미리보기 번호와 같은 순서 (marked가 그림 문단으로 읽는 것과 일치)
  const paras = marked.lexer(v).filter((t) => t.type === "paragraph" && we.figureInfo(t.text));
  assert.equal(paras.length, f.length);
});

test("단축키 도움말에 기존 · 새 단축키와 자동 서식이 모두 있음", () => {
  const h = we.shortcutHelp(false);
  const keys = h.keys.map((k) => k[1]).join(" ");
  for (const k of ["Ctrl+S", "Ctrl+B", "Ctrl+I", "Ctrl+Shift+8", "Ctrl+Shift+7", "Tab", "Shift+Tab", "Enter", "Backspace", "Alt+R", "Ctrl+Enter", "Ctrl+/", "[@", "Esc"]) {
    assert.ok(keys.includes(k), k);
  }
  const syn = h.syntax.map((s) => s[0]).join(" ");
  for (const s of ["- 항목", "1. 항목", "![", "표:", "@fig:", "{#fig:", "[@인용키]", "[참고문헌]", "---"]) assert.ok(syn.includes(s), s);
  assert.ok(we.shortcutHelp(true).keys.some((k) => k[1] === "⌘+S"));
});

test("코드 검사: writetools.js의 템플릿 값은 esc()를 거치거나 숫자 · 고정 글 · 주소용 값만", () => {
  // 사용자 글(표 칸 · 캡션 · 도움말 글)이 esc() 없이 HTML에 들어가면 실패. 새 식은 검토 뒤 여기에 더한다
  const allowed = new Set(["E", "`` : \"\"", "\"\" : \"\"", "\"\" : ``", "r", "c", "c + 1", "op", "cur.r", "cur.c", "label",
    "MAX_COLS", "mid", "name", "ext", "encodeURIComponent(name)", "rows(h.keys)", "syntax(h.syntax)", "row.map((_, c) => ``).join(\"\")",
    "(file.name || \"\").replace(/\\.[^.]+$/, \"\")"]);
  for (const expr of templateExprs(src("writetools.js"))) {
    assert.ok(allowed.has(bare(expr).trim()), `writetools.js: \${${expr}}`);
  }
  // 미리보기의 그림 · 표 HTML(writing.js)도 이름 · 캡션 · 칸을 esc · runsHtml로만 넣는다
  const w = src("writing.js");
  assert.match(w, /<img data-fig="\$\{esc\(b\.src\)\}"/);
  assert.match(w, /alt="\$\{esc\(b\.alt \|\| ""\)\}"/);
});

test("표 찾기가 미리보기(marked의 표 순서)와 같은 표를 가리킴: 앞 | 없는 표 · 칸 수 안 맞는 구분선 · 목록 안 표", () => {
  const v = [
    "a | b", "--|--", "1 | 2", "",                       // 앞 | 없는 GFM 표 (marked: 표)
    "| x | y |", "| --- |", "| 1 | 2 |", "",             // 구분선 칸 수가 다름 (marked: 표 아님)
    "- 항목", "", "  | in | list |", "  | -- | -- |", "", // 목록 안 표 (미리보기 번호에 안 들어감)
    "표: 셋째 {#tbl:c}", "| c1 | c2 |", "| :-: | --: |", "| 가 | 나 |", "뒷줄 | 이어짐", "",
    "```", "| no | table |", "| -- | -- |", "```",
  ].join("\n");
  const top = marked.lexer(v).filter((t) => t.type === "table");
  for (const lexer of [marked.lexer, undefined]) {
    const ts = we.findTables(v, lexer);
    if (lexer) assert.equal(ts.length, top.length);
    assert.deepEqual(ts[0].rows, [["a", "b"], ["1", "2"]]);
    assert.ok(!ts.some((t) => t.rows[0][0] === "x"), "칸 수가 다른 구분선은 표가 아님");
    const third = ts.find((t) => t.label === "tbl:c");
    assert.deepEqual(third.rows, [["c1", "c2"], ["가", "나"], ["뒷줄", "이어짐"]]);
    assert.deepEqual(third.align, ["center", "right"]);
    assert.equal(v.slice(third.from, third.to).split("\n").at(-1), "뒷줄 | 이어짐");
  }
  // marked가 있으면 n번째 = 미리보기의 n번째 (목록 안 표는 빠짐)
  const ts = we.findTables(v, marked.lexer);
  assert.deepEqual(ts.map((t) => t.rows[0]), top.map((t) => t.header.map((c) => c.text)));
  // 브라우저처럼 전역 marked가 있으면 기본으로 그것을 쓴다
  globalThis.marked = marked;
  try { assert.equal(we.findTables(v).length, top.length); } finally { delete globalThis.marked; }
});

test("코드 블록(``` · ~~~) 안에서는 목록 Enter · Backspace · Tab 규칙을 쓰지 않음", () => {
  assert.equal(we.inFence("```\n- x", 7), true);
  assert.equal(we.inFence("```\n- x\n```\n- y", 15), false);
  assert.equal(we.inFence("~~~~\n```\n- x", 12), true); // 다른 울타리 글자로는 닫히지 않음
  assert.equal(run(we.enterEdit, "```\n- x|\n```"), null);
  assert.equal(run(we.enterEdit, "```js\n1. 하나|"), null);
  assert.equal(run(we.backspaceEdit, "```\n- |x\n```"), null);
  assert.equal(run(we.indentEdit, "```\n- a\n- b|\n```", false), null); // 부른 쪽이 공백 2칸
  // 울타리를 닫은 뒤에는 다시 목록 규칙
  assert.equal(run(we.enterEdit, "```\n- x\n```\n- y|"), "```\n- x\n```\n- y\n- |");
});

test("워드가 못 읽는 JPEG 머리글 알아보기 (XMP · APP14 · DQT로 시작) → 올리기 전에 다시 저장", () => {
  const jpeg = (seg) => new Uint8Array([0xff, 0xd8, 0xff, seg, 0x00, 0x10, ...[..."JFIF"].map((c) => c.charCodeAt(0)), 0, 1]);
  assert.equal(we.jpegNeedsReencode(jpeg(0xe0)), false);
  const exif = jpeg(0xe1);
  exif.set([..."Exif"].map((c) => c.charCodeAt(0)), 6);
  assert.equal(we.jpegNeedsReencode(exif), false);
  const xmp = jpeg(0xe1);
  xmp.set([..."http"].map((c) => c.charCodeAt(0)), 6);
  assert.equal(we.jpegNeedsReencode(xmp), true);
  const app14 = jpeg(0xee);
  app14.set([..."Adob"].map((c) => c.charCodeAt(0)), 6);
  assert.equal(we.jpegNeedsReencode(app14), true);
  assert.equal(we.jpegNeedsReencode(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 0x43, 0, 1, 2, 3])), true);
  assert.equal(we.jpegNeedsReencode(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0])), false); // PNG는 해당 없음
  // 화면은 JPEG면 머리글을 보고 다시 저장한다
  assert.match(src("writetools.js"), /jpegNeedsReencode\(head\) \? reencode\(file, "image\/jpeg"/);
});

// ------------------------------------------------------------- 장 · 절 번호 (2026-10-17)
test("장 · 절 버튼: 다음 번호 '제N장' · '제N절'(장마다 1부터)을 붙이고 커서는 줄 끝", () => {
  const v = "# 제목\n\n## 국문초록\n\n## 제1장 서론\n\n### 제1절 배경\n\n### 제2절 목적\n\n새 절";
  const e = we.headingEdit(v, v.length, 3);
  const out = we.applyEditToValue(v, e);
  assert.ok(out.endsWith("### 제3절 새 절"));
  assert.equal(e.selStart, out.length);
  const v2 = out + "\n\n둘째 장";
  const out2 = we.applyEditToValue(v2, we.headingEdit(v2, v2.length, 2));
  assert.ok(out2.endsWith("## 제2장 둘째 장"));
  assert.ok(out2.includes("## 국문초록"), "번호 없는 장 제목은 그대로");
});

test("장 · 절 버튼: 중간에 끼워 넣으면 뒤 번호가 밀리고, 장이 바뀌면 절은 1부터", () => {
  const v = "## 제1장 서론\n\n### 제1절 배경\n\n끼울 절\n\n### 제2절 목적\n\n## 제2장 이론\n\n### 제1절 PLM";
  const pos = v.indexOf("끼울 절");
  const out = we.applyEditToValue(v, we.headingEdit(v, pos, 3));
  assert.equal(out, "## 제1장 서론\n\n### 제1절 배경\n\n### 제2절 끼울 절\n\n### 제3절 목적\n\n## 제2장 이론\n\n### 제1절 PLM");
});

test("장 · 절 버튼: 이미 그 단계 제목이면 제목과 번호를 떼고 뒤 번호를 당김 · 다른 단계 · 목록 기호는 바꿈", () => {
  const v = "## 제1장 서론\n\n## 제2장 이론\n\n## 제3장 방법";
  const off = we.applyEditToValue(v, we.headingEdit(v, v.indexOf("이론"), 2));
  assert.equal(off, "## 제1장 서론\n\n이론\n\n## 제2장 방법");
  const v2 = "## 제1장 서론\n\n### 제1절 배경\n\n- 목록 줄";
  assert.ok(we.applyEditToValue(v2, we.headingEdit(v2, v2.indexOf("배경"), 2)).includes("## 제2장 배경"));
  assert.ok(we.applyEditToValue(v2, we.headingEdit(v2, v2.length, 3)).endsWith("### 제2절 목록 줄"));
});

test("번호 다시 매기기: 코드 블록 안 줄 · '###'와 '##' 구분", () => {
  const v = "## 제5장 가\n```\n## 제9장 코드\n```\n### 제7절 나\n## 제3장 다";
  assert.equal(we.renumberHeadings(v), "## 제1장 가\n```\n## 제9장 코드\n```\n### 제1절 나\n## 제2장 다");
});
