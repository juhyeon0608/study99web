// 통계 계산 화면의 순수 함수 (writestats.js — 2026-10-28): 엑셀 · CSV 읽기 · 열 종류 · 고를 칸 · 결과 마크다운 · 화면 연결
// 실행: node --test tests/js/writestats.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const S = await import(pathToFileURL(join(JS, "writestats.js")).href);

test("엑셀 붙여넣기(탭) · CSV(따옴표 · BOM) · 이름 없는 첫 줄 · 같은 이름", () => {
  const d = S.parseData("집단\t사전\t사후\t\n실험\t3.2\t4.1\t\n통제\t3,400\t\t\n");
  assert.deepEqual(d.columns, ["집단", "사전", "사후"]);
  assert.deepEqual(d.rows[1], ["통제", "3,400", ""]);
  const c = S.parseData('﻿이름,점수,점수\n"김, 철수",1\n이영희,2,3');
  assert.deepEqual(c.columns, ["이름", "점수", "점수_2"]);
  assert.equal(c.rows[0][0], "김, 철수");
  assert.match(S.parseData("1\t2\n3\t4\n5\t6").error, /변인 이름/);
  assert.match(S.parseData("a\tb\n1\t2").error, /두 줄 이상/);
});

test("열 종류 · 고를 칸: 숫자 칸은 숫자 열, 집단 칸은 범주 2~12개", () => {
  const d = S.parseData("집단\t점수\tid\n가\t1\t1\n나\t2\t2\n가\tNA\t3\n나\t4\t4");
  const k = S.columnKinds(d);
  assert.deepEqual(k.map((x) => x.kind), ["cat", "num", "num"]);
  const t = S.ANALYSES.find((a) => a.key === "ttest_ind");
  assert.deepEqual(S.fieldOptions(d, k, t.fields[0]), ["집단", "점수", "id"]); // 글자 열 먼저, 1 · 2로 적은 숫자 집단도 고를 수 있게
  assert.deepEqual(S.fieldOptions(d, k, t.fields[1]), ["점수", "id"]);
  assert.equal(S.ANALYSES.length, 8);
});

test("결과 → 마크다운: 표: 캡션 · 표 · *주.* · 결과 문단", () => {
  const md = S.statsMarkdown({ tables: [{ caption: "기술통계", rows: [["변인", "*M*"], ["점수", "3.00"]], align: ["left", "right"], note: "*N* = 3." }],
    text: "평균은 3.00이었다." });
  const withFig = S.statsMarkdown({ tables: [], text: "끝.", chart: { caption: "집단별 평균 [±1 SD]", svg: "<svg/>" } }, true, "abc");
  assert.equal(withFig, "![집단별 평균 \\[±1 SD\\]](fig:abc)\n\n끝."); // 그래프 그림 줄은 올린 그림 이름이 있을 때만
  assert.equal(S.statsMarkdown({ tables: [], text: "끝.", chart: { caption: "x" } }), "끝.");
  assert.equal(md, "표: 기술통계\n| 변인 | *M* |\n| :-- | --: |\n| 점수 | 3.00 |\n\n*주.* *N* = 3.\n\n평균은 3.00이었다.");
});

test("화면 연결: 도구 막대 [통계] · /api/stats · 원고에 넣기", () => {
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /data-stats title="통계 계산/);
  assert.match(w, /insert: \(md\) => applyEdit\(ta, blockInsert\(/);
  const ui = readFileSync(join(JS, "writestatsui.js"), "utf8");
  assert.match(ui, /api\.post\("\/api\/stats"/);
  assert.match(ui, /insert\(statsMarkdown\(result, true, fig\)\)/);
  assert.match(ui, /uploadSvgFigure\(mid, result\.chart\.svg\)/);
  assert.match(w, /statsDialog\(\{ mid: m\.id,/);
});
