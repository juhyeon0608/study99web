// 분량 · 일정 목표 (writegoals.js — 2026-10-27): 장별 글자 수 · 마감까지 날 · 상태 줄 한 줄 · 화면 연결
// 실행: node --test tests/js/writegoals.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const G = await import(pathToFileURL(join(JS, "writegoals.js")).href);
const DAY = new Date(2026, 9, 27, 15, 0);

test("장별 글자 수: '## ' 장마다 · 코드 블록 안 제목 · 첫 장 앞 글은 빼고 · 인용 표시 뺌", () => {
  const v = "# 제목\n\n머리말\n\n## 제1장 서론\n\n가나다 [@kim2020] 라.\n```\n## 코드\n```\n## 제2장 이론 ##\n\n마바";
  const c = G.chapterCounts(v);
  assert.deepEqual(c.map((x) => x.title), ["제1장 서론", "제2장 이론"]);
  assert.equal(c[1].chars, 2);
  assert.equal(G.countChars("가 [@a] 나"), 4);
});

test("마감까지 날 · 상태 줄 (전체 % · 오늘 쓴 글자 · D-day · 하루 필요량)", () => {
  assert.equal(G.daysLeft("2026-11-01", DAY), 5);
  assert.equal(G.daysLeft("2026-10-27", DAY), 0);
  assert.equal(G.daysLeft("2026-10-20", DAY), -7);
  assert.equal(G.daysLeft("", DAY), null);
  const v = "## 1장\n\n" + "가".repeat(500);
  const s = G.goalSummary(v, { total: 1000, daily: 300, deadline: "2026-11-01", day: { date: "2026-10-27", start: 400 } }, DAY);
  assert.equal(s.line, "목표 50% (500/1,000자) · 오늘 +100/300자 · 마감 D-5 · 하루 100자씩");
  assert.equal(s.needsDay, false);
  // 어제 시작값이면 오늘 0자, 오늘 시작값을 새로 저장해야 함
  const y = G.goalSummary(v, { daily: 300, day: { date: "2026-10-26", start: 1 } }, DAY);
  assert.equal(y.todayDone, 0);
  assert.equal(y.needsDay, true);
  assert.equal(G.goalSummary(v, {}, DAY).needsDay, false); // 목표가 없으면 저장하지 않음
});

test("화면 연결: 상태 줄 [목표] · 목표 창 · 표지 창이 목표 · 용어집을 지우지 않음", () => {
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /data-goals/);
  assert.match(w, /\$\("\[data-goals\]", view\)\.onclick = \(\) => goalsDialog\(view, ta\);/);
  const f = readFileSync(join(JS, "formats.js"), "utf8");
  assert.match(f, /cover\.goals \? \{ goals: cover\.goals \}/);
  assert.match(f, /cover\.glossary \? \{ glossary: cover\.glossary \}/);
});
