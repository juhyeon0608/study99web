// 학술지 투고 규정 (writejournal.js — 2026-10-27): AI 답 읽기 · 분량 · 초록 · 주제어 · 참고문헌 · 인용 양식 · 점검표 연결
// 실행: node --test tests/js/writejournal.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const J = await import(pathToFileURL(join(JS, "writejournal.js")).href);
const C = await import(pathToFileURL(join(JS, "writecheck.js")).href);
const A = await import(pathToFileURL(join(JS, "writeai.js")).href);

test("AI 답 읽기: 코드 블록 · 앞뒤 글 · 글자 숫자 · null · 모르는 키", () => {
  const r = J.parseJournal('규정입니다\n```json\n{"name":"교육학연구","max_pages":"25쪽","abstract_en_max":250,"keywords_min":3,'
    + '"keywords_max":null,"style":"APA 7판","notes":["글꼴 신명조 10pt", ""],"zzz":1}\n```');
  assert.deepEqual(r, { name: "교육학연구", max_pages: 25, abstract_en_max: 250, keywords_min: 3, style: "APA 7판", notes: ["글꼴 신명조 10pt"] });
  assert.equal(J.parseJournal("JSON이 아님"), null);
});

test("규정 점검: 분량 · 초록 · 주제어 · 참고문헌 · 인용 양식", () => {
  const v = "# 제목\n\n## 국문 초록\n\n" + "가".repeat(120) + "\n\n주제어: 가, 나\n\n## Abstract\n\n" + "word ".repeat(30)
    + "\n\nKeywords: a, b, c, d, e, f\n\n## 제1장 서론\n\n본문";
  const j = { name: "학회지", max_pages: 20, abstract_ko_max: 100, abstract_en_max: 20, keywords_min: 3, keywords_max: 5, refs_max: 10, style: "APA 7판" };
  const codes = J.journalIssues(v, j, { pages: 22, chars: 1000, refs: 12, style: "chicago-author-date" }).map((x) => x.code);
  assert.deepEqual(codes, ["journal-pages", "journal-abstract-ko", "journal-abstract-en", "journal-keywords", "journal-keywords",
    "journal-refs", "journal-style"]);
  assert.deepEqual(J.journalIssues(v, { abstract_ko_max: 500, keywords_min: 2, style: "APA" }, { style: "apa" }), []);
  assert.equal(J.styleMatches("한국심리학회 양식", "apa"), true); // 모르는 이름은 같다고 봄
});

test("점검표 연결 · 화면: '양식' 묶음 · [투고 규정] 단추 · 결과는 넣기 없는 보고서", () => {
  const r = C.checkManuscript("# 제목\n\n## 제1장\n\n본문 [@a] [@b]", { cover: { journal: { refs_max: 1 } } });
  const it = r.items.find((x) => x.code === "journal-refs");
  assert.equal(it.group, "format");
  assert.equal(it.action, "journal");
  assert.equal(C.ACTION_NAMES.journal, "투고 규정");
  const ui = readFileSync(join(JS, "writecheckui.js"), "utf8");
  assert.match(ui, /data-ck-journal/);
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /openJournal: \(\) => journalDialog\(ta\)/);
  assert.match(w, /mode: "journal"/);
  const job = (mode, insert = true) => ({ status: "succeeded", result: { text: "x" }, write: { mode, insert } });
  assert.equal(A.paneActions(job("review")).apply, false);
  assert.equal(A.paneActions(job("journal")).apply, false);
  assert.equal(A.paneActions(job("stats")).apply, true);
  assert.equal(A.paneActions(job("stats")).rerun, false);
  assert.equal(A.paneActions(job("memo", false)).rerun, true); // 고른 글 메모 정리는 보통 다시 실행
  assert.equal(A.paneActions({ ...job("matrix"), status: "failed" }).rerun, true);
});
