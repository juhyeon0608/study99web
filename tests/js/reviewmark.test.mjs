// 공유 검토본 표시 (reviewmark.js — 2026-10-28): 고른 글 자리 찾기 · 그림 글 바꾸기 · 화면 연결
// 실행: node --test tests/js/reviewmark.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const R = await import(pathToFileURL(join(JS, "reviewmark.js")).href);

test("고른 글 자리: 띄어쓰기 · 줄바꿈 차이 무시, 특수 글자, 없으면 null", () => {
  const t = "첫 문단이다.\n\n둘째 문단 (김철수 외, 2020)이다.";
  assert.deepEqual(R.findSpan(t, "둘째 문단"), [t.indexOf("둘째"), t.indexOf("둘째") + 5]);
  const s = R.findSpan(t, "문단이다. 둘째");
  assert.equal(t.slice(s[0], s[1]), "문단이다.\n\n둘째");
  assert.ok(R.findSpan(t, "(김철수 외, 2020)"));
  assert.equal(R.findSpan(t, "없는 글"), null);
  assert.equal(R.findSpan(t, "  "), null);
});

test("주인 화면(그림 주소 없음)은 그림을 글로, 공개 페이지는 그림 주소로", () => {
  const md = "![흐름도](fig:0123456789abcdef.png)";
  assert.match(R.prepareShare(md, {}, ""), /\*\[그림: 흐름도\]\*/);
  assert.match(R.prepareShare(md, {}, "/api/public/share/T"), /\/api\/public\/share\/T\/figures\/0123456789abcdef\.png/);
  assert.deepEqual(R.STATUS_LABEL, { open: "", done: "수정 완료", rejected: "거부" });
});

test("화면 연결: 공개 페이지 · 검토 보기 · AI 패널 · 원고 목록", () => {
  const share = readFileSync(join(JS, "share.js"), "utf8");
  assert.match(share, /import \{ STATUS_LABEL, markReview, prepareShare \} from "\.\/reviewmark\.js";/);
  assert.match(share, /kind: mode, replacement: mode === "edit" \? replacement : ""/);
  const html = readFileSync(join(ROOT, "paperlab", "static", "share.html"), "utf8");
  assert.match(html, /data-how="comment">의견 달기/);
  assert.match(html, /data-how="edit">고치기/);
  const ui = readFileSync(join(JS, "writereviewui.js"), "utf8");
  assert.match(ui, /api\.patch\(`\/api\/comments\/\$\{c\.id\}`, \{ status \}\)/);
  assert.match(ui, /if \(r\.cleared\) toast\("모든 의견을 처리해서 이 검토본을 지웠어요"/);
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /\["review", "검토",/);
  assert.match(w, /\$\("\[data-comments\]", view\)\.onclick = \(\) => W\.ai && W\.ai\.review\(\);/);
  assert.match(w, /api\.get\("\/api\/reviews"\)/);
});
