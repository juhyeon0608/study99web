// 출처 확인 (writesrc.js — 2026-10-26): 확인할 문장 고르기 · 미리보기 표시 자리 · 판정 글 읽기 · 고친 문장 넣을 자리 · 근거 번호
// 실행: node --test tests/js/writesrc.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const W = await import(pathToFileURL(join(JS, "writesrc.js")).href);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const DOC = "# 제목\n\n첫 문장이다. 출생아 수는 23만 명이다 [확인 필요: 출처 — KOSIS 2023.]. 셋째 문장이다.\n\n다음 문단.";

test("확인할 문장: 커서 문장 · 같은 문단의 표시 문장 · 고른 글 · 제목 줄은 아님", () => {
  const at = DOC.indexOf("출생아");
  const c = W.claimAt(DOC, at + 2);
  assert.equal(c.text, "출생아 수는 23만 명이다 [확인 필요: 출처 — KOSIS 2023.].");  // 괄호 안 마침표에서 자르지 않음
  assert.equal(DOC.slice(c.from, c.to), c.text);
  // 커서가 표시 없는 문장(첫 문장)에 있으면 같은 문단의 표시 문장
  assert.equal(W.claimAt(DOC, DOC.indexOf("첫 문장") + 1).text, c.text);
  // 문단에 표시가 없으면 커서 문장 그대로
  assert.equal(W.claimAt(DOC, DOC.indexOf("다음 문단") + 1).text, "다음 문단.");
  // 고른 글(앞뒤 빈칸 뺌)
  const s = DOC.indexOf("셋째");
  assert.deepEqual(W.claimAt(DOC, s - 1, s + 8), { from: s, to: s + 8, text: "셋째 문장이다." });
  assert.equal(W.claimAt(DOC, 2), null); // 제목 줄
  assert.equal(W.claimAt("짧다", 1), null); // 5자 미만
});

test("미리보기 표시 → 원고 자리 (같은 글의 표시 중 k번째)", () => {
  const v = "a [확인 필요: 출처] b [확인 필요: 수치] c [확인 필요: 출처]";
  assert.equal(W.markerIndex(v, "[확인 필요: 출처]", 0), 2);
  assert.equal(W.markerIndex(v, "[확인 필요: 출처]", 1), v.lastIndexOf("[확인 필요: 출처]"));
  assert.equal(W.markerIndex(v, "[확인 필요: 수치]", 0), v.indexOf("[확인 필요: 수치]"));
  assert.equal(W.markerIndex(v, "[확인 필요: 없음]", 0), -1);
});

test("원고의 [확인 필요] 목록: 같은 문장은 한 번 · 확인할 것 · 표 안은 문장 없음 · 작업 짝 키", () => {
  const v = "가 문장이다 [확인 필요: 수치]. 나 문장 [확인 필요: 연도] 그리고 [확인 필요]. 다.\n\n| 표 | [확인 필요: 칸] |\n|---|---|";
  const list = W.checkList(v);
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((x) => x.need), ["수치", "연도", "칸"]);
  assert.equal(list[0].claim.text, "가 문장이다 [확인 필요: 수치].");
  assert.equal(list[1].claim.text, "나 문장 [확인 필요: 연도] 그리고 [확인 필요].");
  assert.equal(list[2].claim, null);
  assert.equal(v.slice(list[2].at, list[2].at + list[2].mark.length), "[확인 필요: 칸]");
  assert.equal(W.claimKey(" a \n b  "), "a b");
});

test("판정 글 읽기: 판정 · 근거 · 고친 문장 · 확인할 곳 (굵게 · 목록 기호 · 여러 줄 · '없음')", () => {
  const a = W.parseClaim("**판정:** 일부 있음\n- 근거: 첫째 [L1].\n둘째 [2].\n고친 문장: \"새 문장 [@kim2024].\"\n확인할 곳: 없음");
  assert.deepEqual(a, { verdict: "일부 있음", tone: "warn", basis: "첫째 [L1].\n둘째 [2].", revised: "새 문장 [@kim2024].", where: "" });
  assert.equal(W.parseClaim("판정: 근거 있음").tone, "ok");
  assert.equal(W.parseClaim("판정: 찾지 못함\n고친 문장: 없음").revised, "");
});

test("고친 문장 넣을 자리: 원래 자리 → 같은 문장 하나 → 없으면 null", () => {
  const v = "앞. 주장 문장이다. 뒤.";
  const claim = { from: 3, text: "주장 문장이다." };
  assert.deepEqual(W.claimRange(v, claim), { from: 3, to: 3 + claim.text.length });
  assert.deepEqual(W.claimRange("새 글 " + v, claim), { from: 7, to: 7 + claim.text.length }); // 앞에 글이 늘어도 찾음
  assert.equal(W.claimRange(v + " 주장 문장이다.", { text: "주장 문장이다." }), null); // 두 곳이면 고르지 않음
  assert.equal(W.claimRange(v, { text: "없는 문장" }), null);
});

test("근거 번호 → 단추 (목록 밖 번호는 지움, 글은 이스케이프)", () => {
  const h = W.refsHtml("<b>근거</b> [L1][2][L5][9]", esc, { lib: 2, ext: 3 });
  assert.match(h, /^&lt;b&gt;근거&lt;\/b&gt; /);
  assert.match(h, /data-src-ref="L1"/);
  assert.match(h, /data-src-ref="2"/);
  assert.doesNotMatch(h, /L5|"9"/);
});

test("화면 연결: AI 패널 '출처' 보기 · 미리보기 표시 누르기 · 메뉴 · 작업 이름/주소", () => {
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /\["source", "출처",/);
  assert.match(w, /const srcV = sourceView\(\$\("\[data-ai-src\]", aside\)/);
  assert.match(w, /mark\.check-mark/);
  assert.match(w, /출처 확인 \(AI\)…/);
  const ui = readFileSync(join(JS, "writesrcui.js"), "utf8");
  assert.match(ui, /api\.post\("\/api\/source-check", \{ claim: claim\.text, manuscript_id: h\.mid \}\)/);
  assert.match(ui, /j\.find_mode === "claim"/);
  const jobs = readFileSync(join(JS, "jobs.js"), "utf8");
  assert.match(jobs, /if \(j\.kind === "find" && j\.find_mode === "claim"\) return "출처 확인";/);
});
