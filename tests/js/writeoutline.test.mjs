// 개요에서 장 · 절 옮기기 (writeoutline.js — 2026-10-28): 범위 · 앞/뒤로 옮기기 · 다른 장 안 놓기 · 참고문헌 앞 · 화면 연결
// 실행: node --test tests/js/writeoutline.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const O = await import(pathToFileURL(join(JS, "writeoutline.js")).href);
const DOC = "# 제목\n\n## 서론\n\n가[^1].\n\n[^1]: 각주\n\n## 방법\n\n나.\n\n### 대상\n\n다.\n\n```\n## 코드 안\n```\n\n## 결론\n\n라.\n\n[참고문헌]\n";
const heads = (v) => O.sections(v).map((h) => h.text);

test("장 · 절 범위: 아래 절 · 각주 포함, 코드 블록 # 줄은 제목 아님, 마지막 장은 [참고문헌] 앞까지", () => {
  const hs = O.sections(DOC);
  assert.deepEqual(hs.map((h) => h.text), ["제목", "서론", "방법", "대상", "결론"]);
  assert.match(DOC.slice(hs[1].from, hs[1].to), /\[\^1\]: 각주/);
  assert.match(DOC.slice(hs[2].from, hs[2].to), /### 대상[\s\S]*코드 안/);
  assert.equal(DOC.slice(hs[4].to), "[참고문헌]\n");
});

test("장 옮기기: 뒤로 · 앞으로 — 빈 줄 하나로 잇고 새 자리를 돌려줌", () => {
  const r = O.moveSection(DOC, 1, 4, true); // 서론 → 결론 뒤
  assert.deepEqual(heads(r.value), ["제목", "방법", "대상", "결론", "서론"]);
  assert.ok(r.value.slice(r.from).startsWith("## 서론"));
  assert.match(r.value, /라\.\n\n## 서론\n\n가\[\^1\]\.\n\n\[\^1\]: 각주\n\n\[참고문헌\]\n$/);
  assert.ok(!/\n{3,}/.test(r.value));
  const n = O.moveSection("# T\n\n## 제1장 서론\n\n가.\n\n### 제1절 배경\n\n나.\n\n## 제2장 방법\n\n다.\n", 3, 1); // 번호 다시 매김
  assert.deepEqual(heads(n.value), ["T", "제1장 방법", "제2장 서론", "제1절 배경"]);
  assert.ok(n.value.slice(n.from).startsWith("## 제1장 방법"));
  const u = O.moveSection(DOC, 4, 1); // 결론 → 서론 앞
  assert.deepEqual(heads(u.value), ["제목", "결론", "서론", "방법", "대상"]);
  assert.ok(!/\n{3,}/.test(u.value));
});

test("다른 장의 절 위에 놓으면 그 장 기준 · 제자리 · 자기 안 · 1단계는 null", () => {
  const r = O.moveSection(DOC, 4, 3); // 결론(##)을 대상(###) 앞에 → 방법 장 앞으로
  assert.deepEqual(heads(r.value), ["제목", "서론", "결론", "방법", "대상"]);
  const s = O.moveSection(DOC, 3, 1); // 절(###)은 다른 장 앞에 그대로 → 서론 앞 (첫 장 앞 = 제목 장 끝)
  assert.deepEqual(heads(s.value), ["제목", "대상", "서론", "방법", "결론"]);
  assert.equal(O.moveSection(DOC, 1, 2), null); // 서론을 방법 앞 = 제자리
  assert.equal(O.moveSection(DOC, 2, 3, true), null); // 방법을 자기 절 뒤
  assert.equal(O.moveSection(DOC, 0, 4, true), null);
});

test("화면: 개요는 sections로 그리고 끌어 놓기 · Alt+↑↓가 moveSection을 부름", () => {
  const src = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(src, /const heads = sections\(ta\.value\)/);
  assert.match(src, /moveSection\(ta\.value, i, j, after\)/);
  assert.match(src, /text\/x-paperlab-section/);
  assert.match(src, /e\.key === "ArrowUp"/);
});
