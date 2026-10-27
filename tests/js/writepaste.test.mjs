// 표 붙여넣기 (writepaste.js — 2026-10-27): 엑셀 탭 글 · 따옴표 칸 · 표가 아닌 글 · HTML 칸 배열
// 실행: node --test tests/js/writepaste.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const P = await import(pathToFileURL(join(JS, "writepaste.js")).href);

test("엑셀 탭 글 → 표 (뒤쪽 빈 열 · 빈 줄 버림, 모자란 칸 채움)", () => {
  const t = P.tableFromTsv("구분\t평균\t표준편차\t\r\n남\t3.2\t0.8\t\r\n여\t3.5\r\n\r\n");
  assert.deepEqual(t.rows, [["구분", "평균", "표준편차"], ["남", "3.2", "0.8"], ["여", "3.5", ""]]);
  assert.deepEqual(t.align, [null, null, null]);
});

test("엑셀 따옴표 칸: 칸 안 줄바꿈 · 탭 · \"\" ", () => {
  assert.deepEqual(P.splitTsv('a\t"첫 줄\n둘째 줄"\nb\t"말 ""인용"" \t탭"'),
    [["a", "첫 줄\n둘째 줄"], ["b", '말 "인용" \t탭']]);
  // 짝 없는 따옴표는 글자 그대로
  assert.deepEqual(P.splitTsv('"a\tb\nc\td'), [['"a', "b"], ["c", "d"]]);
});

test("표가 아닌 글은 그대로: 탭 없음 · 한 줄 · 칸 수 들쭉날쭉", () => {
  assert.equal(P.tableFromTsv("그냥 문단\n둘째 줄"), null);
  assert.equal(P.tableFromTsv("a\tb"), null);
  assert.equal(P.tableFromTsv("\t들여쓴 줄\n일반 줄\n또 일반 줄\n또또"), null);
});

test("HTML 칸 배열(colspan 채움 포함) → 표 · 화면 연결", () => {
  const t = P.tableFromCells([["변수", "값", ""], [" 나이 ", "25", "명"]]);
  assert.deepEqual(t.rows, [["변수", "값", ""], ["나이", "25", "명"]]);
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /if \(pasteTable\(ta, e\)\) return;/);
  assert.match(w, /tableFromTsv\(cd\.getData\("text\/plain"\)\)/);
});
