// 문체 점검 (writestyle.js — 2026-10-28): 번역투 · 이중 피동 · 겹친 말 · 긴 문장 · 같은 끝맺음 · 접속어 · 것이다 · 점검표 연결
// 실행: node --test tests/js/writestyle.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const S = await import(pathToFileURL(join(JS, "writestyle.js")).href);
const C = await import(pathToFileURL(join(JS, "writecheck.js")).href);
const find = (v, code) => S.styleIssues(v).filter((x) => x.code === code);

test("번역투 · 이중 피동 · 겹친 말 — 자리가 원고의 그 말", () => {
  const v = "## 서론\n\n교육에 있어서 중요한 것은 동기이다. 학생들은 높은 관심을 가지고 있다. 결과는 표로 보여진다. 과반수 이상이 찬성했다. 많은 학생들이 응답했다.";
  const tr = find(v, "style-translationese");
  assert.equal(tr.length, 2);
  assert.equal(v.slice(tr[0].from, tr[0].to), "교육에 있어서");
  const dp = find(v, "style-double-passive")[0];
  assert.equal(v.slice(dp.from, dp.to), "보여진");
  const rd = find(v, "style-redundant").map((x) => v.slice(x.from, x.to));
  assert.deepEqual(rd, ["과반수 이상", "많은 학생들"]);
  assert.ok(S.styleIssues(v).every((x) => x.sev === "warn"));
});

test("인용 · [확인 필요] · 제목 · 표 줄은 보지 않음, 문장 나누기는 3.5 같은 점에서 안 나눔", () => {
  const v = "# 연구에 있어서\n\n| 보여진 | 값 |\n|---|---|\n\n평균은 3.5였다 [@kim2020]. [확인 필요: 과반수 이상 — 원자료]";
  assert.equal(S.styleIssues(v).length, 0);
  const ss = S.sentences({ from: 0, text: "평균은 3.5였다. 다음 문장이다." });
  assert.deepEqual(ss.map((s) => s.text), ["평균은 3.5였다.", "다음 문장이다."]);
});

test("긴 문장 · 같은 끝맺음 세 번 · 같은 접속어 세 번 · '것이다' 네 번", () => {
  const long = `${"가".repeat(160)}이다.`;
  assert.equal(find(long, "style-long-sentence").length, 1);
  const same = "점수가 높게 나타났다. 불안은 낮게 나타났다. 효능감도 높게 나타났다. 끝이다.";
  const it = find(same, "style-same-ending")[0];
  assert.match(it.msg, /'~나타났다'로 끝나는 문장이 3번/);
  const conn = "또한 A이다. 또한 B이다. 또한 C이다.";
  assert.match(find(conn, "style-connective")[0].msg, /'또한'/);
  const geo = "A인 것이다. B인 것이다. C인 것이다. D인 것이다.";
  assert.equal(find(geo, "style-geosida").length, 4);
  assert.equal(find("A인 것이다. B이다.", "style-geosida").length, 0);
});

test("점검표: '문체' 묶음으로 들어가고 style_check:false면 뺌", () => {
  const v = "## 서론\n\n결과는 표로 보여진다.";
  const r = C.checkManuscript(v);
  assert.equal(C.GROUP_NAMES.style, "문체");
  assert.ok(r.items.some((x) => x.group === "style" && x.code === "style-double-passive"));
  assert.ok(!C.checkManuscript(v, { style_check: false }).items.some((x) => x.group === "style"));
});
