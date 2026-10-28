// 그림 만들기 · 자연어로 고치기 (docs/specs/writing-figure-ai.md): '이 내용으로' 범위 · 넣을 자리 · 원고에 넣기 · 그림 바꾸기 ·
// SVG 크기 → PNG 크기 · 버전 · 경로 안내 · 요청 본문 · 단축키, writefigui.js 코드 검사
// 실행: node --test tests/js/writefig.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bare, templateExprs } from "./codecheck.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const wf = await import(pathToFileURL(join(JS, "writefig.js")).href);
const we = await import(pathToFileURL(join(JS, "writeedit.js")).href);
const { marked } = createRequire(import.meta.url)(join(ROOT, "paperlab", "static", "vendor", "marked.min.js"));
const src = (name) => readFileSync(join(JS, name), "utf8");
const NAME = "0123456789abcdef.png";
const NEW = "fedcba9876543210.png";
const apply = (v, e) => we.applyEditToValue(v, e);

const DOC = "# 제목\n\n## 제1장 서론\n\n첫 문단이다. 설문을 했다.\n\n둘째 문단이다.\n\n### 제1절 배경\n\n배경 문단.\n\n## 제2장 방법\n\n방법 문단.";

test("이 내용으로: 고른 글 · 문단 · 절 범위 (앞뒤 공백 빼고)", () => {
  const i = DOC.indexOf("설문");
  assert.equal(wf.contentRange(DOC, i, i + 2, "selection").text, "설문");
  const p = wf.contentRange(DOC, i, i, "selection"); // 고른 글이 없으면 문단
  assert.equal(p.scope, "paragraph");
  assert.equal(p.text, "첫 문단이다. 설문을 했다.");
  assert.equal(DOC.slice(p.from, p.to), p.text);
  const sec = wf.contentRange(DOC, i, i, "section"); // 장: 다음 장 제목 앞까지 (하위 절 포함)
  assert.ok(sec.text.startsWith("## 제1장 서론") && sec.text.includes("배경 문단.") && !sec.text.includes("제2장"));
  const j = DOC.indexOf("배경 문단");
  const sub = wf.contentRange(DOC, j, j, "section"); // 절: 다음 같은 단계 이상 제목 앞까지
  assert.equal(sub.text, "### 제1절 배경\n\n배경 문단.");
  const top = wf.contentRange("# 제목\n\n앞 글", 6, 6, "section"); // '# 논문 제목' 아래는 문단으로
  assert.equal(top.scope, "paragraph");
  assert.equal(top.text, "앞 글");
  assert.deepEqual(wf.contentRange("", 0, 0, "section"), { from: 0, to: 0, text: "", scope: "paragraph" });
});

test("넣을 자리: 원래 자리 → 한 곳만 있으면 그 끝 → 아니면 null", () => {
  const t = "첫 문단이다. 설문을 했다.";
  const end = DOC.indexOf(t) + t.length;
  assert.equal(wf.contentEnd(DOC, t, end), end);
  assert.equal(wf.contentEnd("앞에 더 씀\n\n" + DOC, t, end), end + "앞에 더 씀\n\n".length);
  assert.equal(wf.contentEnd(DOC + "\n\n" + t, t, 3), null); // 두 곳
  assert.equal(wf.contentEnd(DOC, "없는 글", end), null);
  assert.equal(wf.contentEnd(DOC, "", end), null);
});

test("원고에 넣기: 내용 뒤 그림 문단 + 문장 끝 '(@fig:… 참조)' — 미리보기에서 그림 · 참조 번호가 됨", () => {
  const t = "첫 문단이다. 설문을 했다.";
  const end = DOC.indexOf(t) + t.length;
  const r = wf.insertFigure(DOC, { at: end, name: NAME, caption: "연구 절차", ref: true, refAt: end });
  assert.equal(r.label, "fig:ai-012345");
  assert.ok(r.value.includes("첫 문단이다. 설문을 했다(@fig:ai-012345 참조).\n\n![연구 절차](fig:0123456789abcdef.png){#fig:ai-012345}\n\n둘째 문단이다."), r.value);
  assert.equal(apply(DOC, r.edit), r.value); // 한 번의 편집(실행 취소 한 번)
  assert.equal(r.value.slice(r.edit.selStart, r.edit.selEnd), "연구 절차"); // 캡션을 골라 둠
  const figs = we.findFigures(r.value);
  assert.equal(figs.length, 1);
  assert.ok(marked.lexer(r.value).some((tk) => tk.type === "paragraph" && we.figureInfo(tk.text)));
  assert.deepEqual(we.splitXrefs("했다(@fig:ai-012345 참조).").filter((x) => typeof x === "object"), [{ xref: "fig:ai-012345" }]);
  // 참조 없이 · 커서 자리 · 영어 원고
  const plain = wf.insertFigure("Intro text here", { at: 5, name: NAME, caption: "Model [v2]", ref: false, ko: false });
  assert.equal(plain.value, "Intro text here\n\n![Model \\[v2\\]](fig:0123456789abcdef.png)\n\n"); // 문장 가운데면 그 줄 뒤에
  assert.equal(plain.value.slice(plain.edit.selStart, plain.edit.selEnd), "Model \\[v2\\]");
  const en = wf.insertFigure("We ran it.", { at: 10, name: NAME, caption: "Flow", ref: true, refAt: 10, ko: false });
  assert.ok(en.value.startsWith("We ran it (see @fig:ai-012345).\n\n![Flow](fig:"), en.value);
  const empty = wf.insertFigure("", { at: 0, name: NAME, caption: "", ref: false });
  assert.equal(empty.value, "![그림 설명](fig:0123456789abcdef.png)\n\n");
});

test("원고의 그림 바꾸기: 같은 자리 · 캡션 · 참조 이름 그대로 (캡션을 고쳤으면 캡션만)", () => {
  const v = `앞 글\n\n![연구 절차](fig:${NAME}){#fig:proc}\n\n뒤 글 @fig:proc`;
  const r = wf.replaceFigure(v, NAME, NEW);
  assert.equal(r.value, `앞 글\n\n![연구 절차](fig:${NEW}){#fig:proc}\n\n뒤 글 @fig:proc`);
  assert.equal(apply(v, r.edit), r.value);
  assert.equal(r.count, 1);
  const c = wf.replaceFigure(v, NAME, NEW, "새 [캡션]");
  assert.ok(c.value.includes(`![새 \\[캡션\\]](fig:${NEW}){#fig:proc}`));
  assert.equal(wf.replaceFigure(v, "aaaaaaaaaaaaaaaa.png", NEW), null);
  const two = `![a](fig:${NAME})\n\n글\n\n![b](fig:${NAME})`;
  assert.equal(wf.replaceFigure(two, NAME, NEW).count, 2);
  assert.ok(!wf.replaceFigure(two, NAME, NEW).value.includes(NAME));
  // 코드 블록 안의 그림 줄은 그림이 아님
  assert.equal(wf.replaceFigure("```\n![a](fig:" + NAME + ")\n```", NAME, NEW), null);
});

test("커서의 그림 줄 찾기", () => {
  const v = `글\n\n![연구 \\[1\\] 절차](fig:${NAME})\n\n뒤`;
  const f = wf.figureAt(v, v.indexOf("연구"));
  assert.equal(f.src, NAME);
  assert.equal(f.alt, "연구 [1] 절차");
  assert.equal(wf.figureAt(v, 0), null);
});

test("SVG viewBox → PNG 크기 (가로 16cm 300dpi = 1890px, 세로 상한)", () => {
  assert.deepEqual(wf.svgViewBox('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" width="1000">'), { x: 0, y: 0, w: 1000, h: 600 });
  assert.equal(wf.svgViewBox("<svg viewBox='0 0 1 1'>"), null);
  assert.equal(wf.svgViewBox('<svg viewBox="0 0 0 5">'), null);
  assert.deepEqual(wf.rasterSize(1000, 600), { width: 1890, height: 1134 });
  assert.deepEqual(wf.rasterSize(500, 2000), { width: 1000, height: 4000 }); // 세로가 길면 세로 4000에 맞춤
  assert.equal(wf.rasterSize(0, 10), null);
  assert.equal(wf.RASTER_WIDTH, Math.round(16 / 2.54 * 300));
});

test("작업 상태 · 버전 · 경로 안내 · 요청 본문", () => {
  assert.equal(wf.figState(null), "missing");
  assert.equal(wf.figState({ status: "queued" }), "running");
  assert.equal(wf.figState({ status: "succeeded", result: { svg: "<svg/>" } }), "ready");
  assert.equal(wf.figState({ status: "succeeded", result: null }), "missing");
  assert.equal(wf.figState({ status: "failed" }), "failed");
  assert.deepEqual(wf.versionIds({ id: 9, figure: { chain: [3, 5, 3, "x", -1] } }), [3, 5, 9]);
  assert.deepEqual(wf.versionIds({ id: 4, figure: null }), [4]);
  assert.equal(wf.routeNote({ route: [{ runner: "cli", engine: "claude" }] }), "");
  assert.match(wf.routeNote({ route: [{ runner: "cli", engine: "codex" }] }), /Claude를 쓸 수 없어 내 PC의 codex/);
  assert.match(wf.routeNote({ route: [{ runner: "api", engine: "gemini" }] }), /Google API 키/);
  assert.deepEqual(wf.figureRequest({ mid: 3, mode: "describe", description: "흐름도" }),
    { manuscript_id: 3, mode: "describe", description: "흐름도", lang: "ko" });
  const c = wf.figureRequest({ mid: 3, mode: "content", content: "x".repeat(20000), ko: false });
  assert.equal(c.content.length, wf.CONTENT_MAX);
  assert.equal(c.lang, "en");
  assert.deepEqual(wf.figureRequest({ mid: 3, mode: "edit", instruction: "굵게", base: { jobId: 7 } }),
    { manuscript_id: 3, mode: "edit", description: "", lang: "ko", instruction: "굵게", parent_job_id: 7 });
  const b = wf.figureRequest({ mid: 3, mode: "edit", instruction: "굵게", base: { figure: NAME }, caption: "캡션" });
  assert.equal(b.base_figure, NAME);
  assert.equal(b.caption, "캡션");
  assert.equal(wf.FIG_JOB_KEY(12), "paperlab.figJob.12");
});

test("단축키 Alt+G (Ctrl · ⌘ · Shift · 반복이면 아님) · 도움말에 있음", () => {
  assert.ok(wf.isFigPaneKey({ code: "KeyG", altKey: true }));
  for (const e of [{ code: "KeyG" }, { code: "KeyG", altKey: true, ctrlKey: true }, { code: "KeyG", altKey: true, metaKey: true },
    { code: "KeyG", altKey: true, shiftKey: true }, { code: "KeyG", altKey: true, repeat: true }, { code: "KeyA", altKey: true }, null]) {
    assert.ok(!wf.isFigPaneKey(e), JSON.stringify(e));
  }
  assert.ok(we.shortcutHelp(false).keys.some((k) => k[1].includes("Alt+G")));
  assert.ok(we.shortcutHelp(true).keys.some((k) => k[1].includes("⌥+G")));
});

test("코드 검사: writefigui.js — 템플릿 값은 esc() · 숫자 · 고정 글만, SVG는 blob <img>로만 (innerHTML · 인라인 SVG 없음)", () => {
  const code = src("writefigui.js");
  // 주소(mid · m.id · encodeURIComponent(name) · 그림 이름 찾기 글) · 고정 글(act · cls) · 숫자 · 참거짓 · 아이콘 상수,
  // textContent로만 넣는 값(r.text · res.kind_note · j.device.name · j.engine), 우리 단추의 data-act 선택자(focused)
  const allowed = new Set(["mid", "ICON_INFO", "ICON_WARN", "E", "S.mode === \"\"", "S.mode === \"\" ? \"\" : \"\"",
    "SCOPES.map(([v, l]) => ``).join(\"\")", "r.text.slice(0, 299)", "\"\" : \"\"", "Number(id)", "id === S.sel", "i + 1",
    "res.kind_note", "cls", "act", "focused", "`` : \"\"", "j.device.name", "j.engine", "m.id", "encodeURIComponent(name)", "name"]);
  for (const expr of templateExprs(code)) assert.ok(allowed.has(bare(expr).trim()), `writefigui.js: \${${expr}}`);
  // 결과 SVG는 cleanSvgText(DOMPurify) → Blob → <img>. innerHTML에 넣는 곳은 비우기("")뿐
  assert.ok(!/innerHTML\s*=(?!\s*"";)/.test(code), "innerHTML은 비우기만");
  assert.ok(!/insertAdjacentHTML|outerHTML\s*=|document\.write/.test(code));
  assert.match(code, /new Blob\(\[clean\], \{ type: "image\/svg\+xml" \}\)/);
  assert.match(code, /FORBID_TAGS: SVG_PURIFY\.FORBID_TAGS/);
  // 캡션 · 그림 종류 · 원고 범위 글은 textContent · value로만
  assert.match(code, /textContent: `그림 종류: \$\{res\.kind_note\}`/);
  assert.match(code, /snip\.textContent = /);
});

test("writing.js 연결은 한 줄씩 (import · 열기 · 닫기 · AI 도우미 메뉴)", () => {
  const w = src("writing.js");
  assert.match(w, /import \{ figPane \} from "\.\/writefigui\.js";/);
  assert.match(w, /W\.fig = figPane\(view, \{ ta, m, saveVersion: \(c\) => saveVersion\(m\.id, c\)/);
  assert.match(w, /if \(W\.fig\) W\.fig\.destroy\(\);/);
  assert.match(w, /W\.fig && W\.fig\.menuItems\(\)\.find\(\(x\) => x\.key === key\)/); // AI 도우미 '그림…' 묶음 (writeaimenu.js)
});
