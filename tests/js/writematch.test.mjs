// 서재 대조 (writematch.js — 2026-10-27): 본문 문장 · 인용이 필요한 문장 · 표절 점검 문장 · [@키] 넣기 · 겹침 고르기
// 실행: node --test tests/js/writematch.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const M = await import(pathToFileURL(join(JS, "writematch.js")).href);

const DOC = `# 제목

## 제1장 서론

선행연구에 따르면 사회적 지지는 우울을 낮춘다. 2023년 기준 청소년 우울 경험률은 26.7%이다. 김 외(2020)는 이를 확인했다 [@kim2020].
본 연구는 이 관계를 다시 살펴본다. 학업 스트레스가 클수록 우울이 높다고 보고되었다 [확인 필요: 출처 — KCI].

| 표 | 선행연구에 따르면 칸 |
|---|---|

- 많은 연구에서 같은 결과가 보고되었다.`;

test("본문 문장: 제목 · 표는 빼고, 목록 기호는 떼고, 자리는 원고 그대로", () => {
  const s = M.bodySentences(DOC);
  assert.ok(s.every((x) => DOC.slice(x.from, x.to) === x.text));
  assert.ok(!s.some((x) => x.text.includes("| 표")));
  assert.equal(s.at(-1).text, "많은 연구에서 같은 결과가 보고되었다.");
});

test("인용이 필요한 문장: 다른 연구 · 통계 말투, 인용 · [확인 필요] · 내 연구 문장은 뺌", () => {
  const u = M.uncitedClaims(DOC);
  assert.deepEqual(u.map((x) => x.text), ["선행연구에 따르면 사회적 지지는 우울을 낮춘다.", "2023년 기준 청소년 우울 경험률은 26.7%이다.",
    "많은 연구에서 같은 결과가 보고되었다."]);
  assert.equal(u[1].reason, "통계 · 수치가 있는 문장");
});

test("[@키] 넣기: 마침표 앞 · 문장이 바뀌었으면 null · 겹침 기준", () => {
  const s = M.uncitedClaims(DOC)[0];
  const e = M.citeEdit(DOC, s, "lee2019");
  const after = DOC.slice(0, e.from) + e.text + DOC.slice(e.to);
  assert.ok(after.includes("우울을 낮춘다 [@lee2019]. 2023년"));
  assert.equal(M.citeEdit("다른 글", s, "x"), null);
  const c = [{ text: "가" }, { text: "나" }, { text: "다" }];
  const hits = M.similarHits(c, [[{ overlap: 0.2 }], [{ overlap: 0.4 }, { overlap: 0.7 }], []]);
  assert.deepEqual(hits.map((x) => [x.text, x.hit.overlap]), [["나", 0.7]]);
  assert.equal(M.queryText("가 [@k] *나* [확인 필요: x] 다"), "가 나 다");
});

test("화면 연결: AI 도우미 메뉴 · 서버 주소 · 바꿔 쓰기 모드", () => {
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /if \(key === "cite" \|\| key === "similar"\) return libraryMatch\(ta, key\);/);
  assert.match(w, /mode: "paraphrase"/);
  assert.match(readFileSync(join(JS, "writematchui.js"), "utf8"), /api\.post\("\/api\/library-match"/);
});
