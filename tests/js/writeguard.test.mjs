// AI 결과의 숫자 · 인용 대조 (writeguard.js — 2026-10-28): 숫자 · 인용 키 읽기 · 다듬기 · 번역 · 통계 출력 · 비교표 · 화면 연결
// 실행: node --test tests/js/writeguard.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const G = await import(pathToFileURL(join(JS, "writeguard.js")).href);

test("숫자 · 인용 키 읽기: 쉼표 · 앞 0 · 음수 기호 · 범위 · 한글 뒤 · 영문 붙은 것 · 인용 안 숫자", () => {
  const ns = G.numbersIn("약35%, 312명, H1, p = .025, −0.63, 1-5점, 1,234원, 3.50 [@kim2020, p. 12] 2020년");
  assert.deepEqual(ns.map((n) => n.value), ["35", "312", "0.025", "-0.63", "1", "5", "1234", "3.5", "2020"]);
  assert.deepEqual(G.citeKeys("가[@kim2020; @lee_2019a, p. 3]. 나 [see @park2021]. 메일 a@b.c"), ["kim2020", "lee_2019a", "park2021"]);
});

test("다듬기 · 번역 · 늘려 쓰기: 바뀐 숫자 · 빠진 인용 · 새 숫자 · 새 인용", () => {
  const n = G.compareRewrite("polish", "응답자 312명 중 34.5%가 찬성했다[@kim2020].", "응답자 300여 명 중 약 35%가 찬성했다.");
  assert.equal(n.length, 3);
  assert.match(n[0].text, /빠지거나 바뀌었어요: 312, 34\.5/);
  assert.match(n[1].text, /없던 숫자.*300, 35/);
  assert.match(n[2].text, /인용 표시가 빠졌어요: \[@kim2020\]/);
  assert.deepEqual(G.compareRewrite("academic", "평균 3.50, n = 1,200 [@a; @b]", "평균은 3.5, n = 1200이다[@a; @b]."), []);
  assert.deepEqual(G.compareRewrite("to_en", "세 집단(3개)의 평균은 3.45였다[@kim2020].", "The mean of three groups was 3.45 [@kim2020]."), []); // 번역: 0~10 정수는 낱말로 풀 수 있음
  const ex = G.compareRewrite("expand", "효과가 있었다.", "효과가 있었다. 선행연구에서도 효과크기가 0.8이었다[@new2020].");
  assert.equal(ex.length, 2);
  assert.match(ex[0].text, /0\.8/);
  assert.deepEqual(G.compareRewrite("continue", "가", "나 12.3"), []); // 이어 쓰기 · 초안 등은 대조하지 않음
});

test("통계 출력: 반올림 · |t| · 앞 0 · < .001 · 작은 정수는 통과, 출력에 없는 값은 알림", () => {
  const src = "t -2.314 df 48 Sig. .0251 Mean 4.1234 SD .523 Sig .000";
  assert.deepEqual(G.compareStats(src, "표 1. 결과\n| 2.31 | 48 | .025 |\n*p* < .001, *M* = 4.12, *SD* = 0.52, 열 1 2 3"), []);
  const n = G.compareStats(src, "*t*(48) = 2.13, *d* = 0.63");
  assert.equal(n.length, 1);
  assert.match(n[0].text, /2\.13, 0\.63/);
});

test("비교표: 서재에 없는 키 · 고르지 않은 논문 · 연도 · 첫 저자, 화면 연결", () => {
  const papers = [{ citekey: "kim2020", year: "2020", authors: [{ family: "김", given: "철수" }] },
    { citekey: "lee2019", year: 2019, authors: [{ family: "Lee", given: "J" }] }, { citekey: "park2021", year: 2021, authors: [{ family: "Park" }] }];
  const out = "| 저자 | 결과 |\n| :-- | :-- |\n| 김철수(2019) [@kim2020] | x |\n| Lee(2019) [@lee2019] | y |\n| Choi(2021) [@park2021] | z |\n| Ghost(2020) [@ghost2020] | w |";
  const n = G.compareMatrix(out, papers, ["kim2020", "lee2019"]);
  assert.deepEqual(n.map((x) => x.text.split(":")[0]), ["서재에 없는 인용 키예요", "고르지 않은 논문이 표에 들어갔어요", "연도가 서재 정보와 달라요", "저자 이름이 서재 정보와 다를 수 있어요"]);
  assert.match(n[2].text, /\[@kim2020\] 2019 → 서재 2020/);
  assert.match(n[3].text, /\[@park2021\] 첫 저자 Park/);
  assert.deepEqual(G.guardNotes({ mode: "matrix", keys: [] }, "| Lee(2019) [@lee2019] |", papers), []);
  assert.deepEqual(G.guardNotes({ mode: "polish" }, "x 1"), []); // 원래 글을 아직 못 받았으면 대조하지 않음
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /guardNotes\(w, result, W\.papers \|\| \[\]\)/);
  assert.match(w, /box\.lastElementChild\.textContent = n\.text/); // AI 결과 글은 textContent로만
});
