// 용어 통일 (writeterms.js — 2026-10-27): 여러 표기 · 띄어쓰기 섞임 · 약어 첫 등장 · 내 용어집 · 점검표 연결
// 실행: node --test tests/js/writeterms.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const T = await import(pathToFileURL(join(JS, "writeterms.js")).href);
const C = await import(pathToFileURL(join(JS, "writecheck.js")).href);
const codes = (v, g) => T.termIssues(v, g).map((x) => x.code);

test("여러 표기: 참여자/참가자 — 적게 쓴 쪽 자리 · 긴 표기 먼저(웹 사이트)", () => {
  const v = "연구 참여자는 10명이다. 참여자들은 응답했다. 참가자 1명은 빠졌다.";
  const it = T.termIssues(v).find((x) => x.code === "term-variant");
  assert.match(it.msg, /'참여자' 2곳 · '참가자' 1곳/);
  assert.equal(v.slice(it.from, it.to), "참가자");
  assert.deepEqual(codes("웹 사이트를 봤다. 웹 사이트가 좋다."), []);
});

test("띄어쓰기 섞임: 연구 대상 ↔ 연구대상(조사 떼고) · 한 글자 낱말은 보지 않음", () => {
  const v = "연구 대상은 대학생이다. 연구대상의 특성은 다음과 같다. 할 수 있다. 할수 없다.";
  const it = T.termIssues(v).find((x) => x.code === "term-spacing");
  assert.match(it.msg, /'연구 대상' 1곳 · '연구대상' 1곳/);
  assert.equal(T.termIssues(v).filter((x) => x.code === "term-spacing").length, 1);
});

test("약어 첫 등장: 풀어 쓴 꼴은 통과 · 흔한 약어 · 제목 줄 · 인용 키는 빼고", () => {
  assert.deepEqual(codes("사회관계망서비스(SNS)를 쓴다. SNS는 많다."), []);
  assert.deepEqual(codes("SNS(Social Networking Service)를 쓴다."), []);
  assert.deepEqual(codes("(Technology Acceptance Model, TAM)으로 본다."), []);
  assert.deepEqual(codes("COVID-19(코로나바이러스감염증-19) 이후 PDF와 AI."), []);
  assert.deepEqual(codes("## TAM 이론\n\n본문 [@TAM2020] 인용."), []);
  const it = T.termIssues("본 연구는 TAM을 쓴다. 이후 TAM(기술수용모형)은").find((x) => x.code === "term-abbr");
  assert.match(it.msg, /'TAM'/);
  assert.equal(it.from, 6);
});

test("내 용어집: 피할 말마다 꼭 고칠 것 · 모두 바꾸기(코드 · 인용 키는 그대로)", () => {
  const g = [{ use: "연구 참여자", avoid: ["피험자"] }];
  const v = "피험자는 20명. [@피험자2020] 피험자들\n```\n피험자\n```";
  const items = T.termIssues(v, g).filter((x) => x.code === "term-glossary");
  assert.equal(items.length, 2);
  assert.equal(items[0].action, "glossary");
  assert.equal(T.applyGlossary(v, g), "연구 참여자는 20명. [@피험자2020] 연구 참여자들\n```\n피험자\n```");
});

test("점검표 연결: '용어' 묶음 · 용어집은 cover.glossary · 화면 단추", () => {
  const r = C.checkManuscript("# 제목\n\n피험자는 많다.", { cover: { glossary: [{ use: "참여자", avoid: ["피험자"] }] } });
  const it = r.items.find((x) => x.code === "term-glossary");
  assert.equal(it.group, "term");
  assert.equal(C.GROUP_NAMES.term, "용어");
  const ui = readFileSync(join(JS, "writecheckui.js"), "utf8");
  assert.match(ui, /data-ck-terms/);
  assert.match(ui, /applyGlossary\(ta\.value/);
  assert.match(readFileSync(join(JS, "writing.js"), "utf8"), /openGlossary: glossaryDialog/);
});
