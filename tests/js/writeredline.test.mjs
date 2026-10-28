// 수정 내용 표시 (writeredline.js — 2026-10-27): 줄 · 낱말 비교 → 표시 문자 · 표 줄 · 화면 연결
// 실행: node --test tests/js/writeredline.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const R = await import(pathToFileURL(join(JS, "writeredline.js")).href);
const show = (s) => s.replace(//g, "{+").replace(//g, "+}").replace(//g, "{-").replace(//g, "-}");

test("같은 꼴의 줄은 낱말 단위, 줄 수가 다르면 줄 단위 · 제목 기호는 밖에", () => {
  const a = "## 제1장 서론\n\n목적은 우울을 본다.\n\n지울 문단.";
  const b = "## 제1장 들어가며\n\n목적은 청소년 우울을 살펴본다.\n\n새 문단.\n- 새 항목";
  const r = R.redlineMarkdown(a, b);
  assert.equal(show(r.text), "## 제1장 {-서론-}{+들어가며+}\n\n목적은 {+청소년 +}우울을 {-본다.-}{+살펴본다.+}\n\n{-지울 문단.-}\n{+새 문단.+}\n- {+새 항목+}");
  assert.deepEqual([r.ins, r.del], [4, 3]);
  assert.equal(R.stripMarks(r.text).includes(""), false);
});

test("표 · 그림 줄: 지운 것은 빼고 넣은 것은 표시 없이 · 같으면 바뀐 것 없음", () => {
  const a = "| a | b |\n|---|---|\n| 1 | 2 |";
  const b = "| a | b |\n|---|---|\n| 1 | 3 |\n![그림](fig:x.png)";
  const r = R.redlineMarkdown(a, b);
  assert.equal(r.text, b);
  assert.deepEqual(R.redlineMarkdown("같다", "같다"), { text: "같다", ins: 0, del: 0 });
});

test("화면 연결: 버전 기록 [수정 표시 워드] → 워드 내보내기 redline", () => {
  const h = readFileSync(join(JS, "writehistui.js"), "utf8");
  assert.match(h, /data-redline/);
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /redline: \(old, name\) => exportAs\("docx", view, ta, \{ redline: old, versionName: name \}\)/);
  assert.match(w, /\{ redline: true \}/);
});

test("발표 자료: AI 답(JSON) → 패널 목록 · 읽지 못하면 null · 메뉴 · PPT 단추", async () => {
  const S = await import(pathToFileURL(join(JS, "writeslides.js")).href);
  const esc = (s) => String(s).replace(/</g, "&lt;");
  const h = S.slidesHtml('{"title":"발표","slides":[{"title":"<배경>","bullets":["가"],"notes":"노트"}],"questions":[{"q":"질문","a":"답"}]}', esc);
  assert.match(h, /1\. &lt;배경>/);
  assert.match(h, /예상 질문/);
  assert.equal(S.slidesHtml("그냥 글", esc), null);
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(readFileSync(join(JS, "writeaimenu.js"), "utf8"), /\["slides", "발표 자료",/); // AI 도우미 '자료 만들기…' 묶음
  assert.match(w, /add\("pptx", "PPT 파일 받기"/);
  assert.match(w, /api\.raw\("POST", "\/api\/slides"/);
});

test("공유 페이지: 인용 → 저자 · 연도, 그림 → 링크 그림 주소, 꼬리표 · [참고문헌] 자리 뺌 · 편집기 단추", async () => {
  const S = await import(pathToFileURL(join(JS, "share.js")).href);
  const md = "본문 [@kim2020; @lee2021, p. 3] 끝.\n\n![모형](fig:0123456789abcdef.png){#fig:m}\n\n[참고문헌]";
  const out = S.prepareShare(md, { kim2020: "김철수, 2020" }, "/api/public/share/T");
  assert.match(out, /본문 \(김철수, 2020; lee2021\) 끝\./);
  assert.match(out, /!\[모형\]\(\/api\/public\/share\/T\/figures\/0123456789abcdef\.png\)/);
  assert.doesNotMatch(out, /\{#fig|\[참고문헌\]/);
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /data-share/);
  assert.match(w, /shareTools\(view, ta, m\)/);
});
