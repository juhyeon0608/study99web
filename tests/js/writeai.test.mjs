// AI 글쓰기 결과 넣기 (2026-10-16 백그라운드 AI — writeai.js): 원고 지문 · 넣을 자리 다시 찾기 · 바뀌는 부분 — 순수 함수만
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { docHash, insertionText, planApply, trimRange, wordDiff, writeAnchor } from "../../paperlab/static/js/writeai.js";

const DOC = "# 제목\n\n## 1. 서론\n\n이 연구는 정말 엄청 중요한 거 같아요.\n\n## 2. 방법\n\n설문을 했다.\n";
const SEL = "이 연구는 정말 엄청 중요한 거 같아요.";
const at = DOC.indexOf(SEL);
const job = (o = {}) => ({ text: SEL, sel_start: at, sel_end: at + SEL.length, insert: false, doc_hash: docHash(DOC), before: "", ...o });

describe("원고 지문 · 넣을 자리 정보", () => {
  test("지문은 서버 형식([0-9a-z]{1,64})이고 글이 바뀌면 달라진다", () => {
    assert.match(docHash(DOC), /^[0-9a-z]{1,64}$/);
    assert.equal(docHash(DOC), docHash(String(DOC)));
    assert.notEqual(docHash(DOC), docHash(DOC + " "));
    assert.notEqual(docHash("ab"), docHash("ba"));
    assert.match(docHash(""), /^[0-9a-z]+$/);
  });
  test("고른 범위의 앞뒤 공백을 뺌 (서버가 글을 trim해서 저장)", () => {
    const v = "앞\n\n  가나다  \n\n뒤";
    const { s, e } = trimRange(v, 1, v.length - 1);
    assert.equal(v.slice(s, e), "가나다");
    assert.deepEqual(trimRange("   ", 0, 3), { s: 3, e: 3 });
  });
  test("writeAnchor: 범위 · 넣기 여부 · 지문 · 앞 글 200자", () => {
    const long = "가".repeat(500);
    const a = writeAnchor(long, 300, 300, true);
    assert.deepEqual([a.sel_start, a.sel_end, a.insert, a.before.length, a.doc_hash], [300, 300, true, 200, docHash(long)]);
  });
});

describe("넣을 계획 (원고가 바뀌었으면 묻고, 못 찾으면 자동으로 넣지 않음)", () => {
  test("원고가 그대로면 same — 원래 자리", () => {
    assert.deepEqual(planApply(DOC, job()), { state: "same", from: at, to: at + SEL.length, old: SEL });
  });
  test("다른 곳만 바뀌어도 moved — 물어봐야 함, 같은 자리", () => {
    const cur = DOC + "\n## 3. 결과\n";
    const p = planApply(cur, job());
    assert.equal(p.state, "moved");
    assert.equal(cur.slice(p.from, p.to), SEL);
  });
  test("앞에 글이 늘어 자리가 밀리면 한 곳을 다시 찾음", () => {
    const cur = "머리말을 새로 썼어요.\n\n" + DOC;
    const p = planApply(cur, job());
    assert.equal(p.state, "moved");
    assert.equal(cur.slice(p.from, p.to), SEL);
  });
  test("바꿀 글을 고쳤거나 지웠으면 lost (새 글을 덮어쓰지 않음)", () => {
    assert.equal(planApply(DOC.replace("엄청", "매우"), job()).state, "lost");
    assert.equal(planApply(DOC.replace(SEL, ""), job()).state, "lost");
  });
  test("같은 글이 여러 곳이면 원래 자리가 맞을 때만 moved, 아니면 lost", () => {
    const twice = DOC + "\n" + SEL + "\n";
    assert.equal(planApply(twice, job()).state, "moved");
    assert.equal(planApply("x" + twice, job()).state, "lost");
  });
  test("넣기(이어 쓰기 · 초안): 앞 글로 자리를 찾음", () => {
    const pos = DOC.indexOf("## 2.");
    const w = job({ insert: true, text: "", sel_start: pos, sel_end: pos, before: DOC.slice(pos - 30, pos) });
    assert.deepEqual(planApply(DOC, w), { state: "same", from: pos, to: pos, old: "" });
    const cur = "새 머리말\n" + DOC;
    const p = planApply(cur, w);
    assert.equal(p.state, "moved");
    assert.equal(cur.slice(p.from).startsWith("## 2."), true);
    assert.equal(planApply(cur.replace(DOC.slice(pos - 30, pos), "전부 고침"), w).state, "lost");
  });
  test("자리 정보가 없거나 틀려도 오류 없이 판단", () => {
    assert.equal(planApply(DOC, { text: SEL }).state, "moved");
    assert.equal(planApply(DOC, {}).state, "lost");
    assert.equal(planApply("", job()).state, "lost");
    assert.equal(planApply(DOC, job({ sel_start: 999999, sel_end: 9999999, doc_hash: "" })).state, "moved");
  });
});

describe("넣을 글 · 바뀌는 부분", () => {
  test("바꾸기는 결과 그대로(trim), 넣기는 앞 문단과 띄우고 끝에 줄바꿈", () => {
    assert.equal(insertionText("가나", 2, "  결과  ", false), "결과");
    assert.equal(insertionText("가나", 2, "결과", true), "\n\n결과\n");
    assert.equal(insertionText("가나\n", 3, "결과", true), "결과\n");
    assert.equal(insertionText("", 0, "결과", true), "결과\n");
  });
  test("낱말 단위 차이 — 이어 붙이면 원래 글 · 새 글이 됨", () => {
    const a = "이 연구는 정말 엄청 중요한 거 같아요.";
    const b = "본 연구는 매우 중요한 의의를 지닌다.";
    const d = wordDiff(a, b);
    assert.equal(d.filter((x) => x.op !== "ins").map((x) => x.text).join(""), a);
    assert.equal(d.filter((x) => x.op !== "del").map((x) => x.text).join(""), b);
    assert.ok(d.some((x) => x.op === "same" && x.text.includes("중요한")));
    assert.deepEqual(wordDiff("", ""), []);
    assert.deepEqual(wordDiff("가 나", "가 나"), [{ op: "same", text: "가 나" }]);
  });
  test("너무 길면 통째로 지움 · 넣음", () => {
    assert.deepEqual(wordDiff("a b c", "x y", 4), [{ op: "del", text: "a b c" }, { op: "ins", text: "x y" }]);
  });
});

describe("코드 검사", () => {
  const src = (f) => readFileSync(new URL(`../../paperlab/static/js/${f}`, import.meta.url), "utf8");
  test("글쓰기 도우미는 SSE가 아니라 작업 — 창을 닫아도 취소하지 않음", () => {
    const w = src("writing.js");
    assert.doesNotMatch(w, /streamEvents\("\/api\/ai\/write"/);
    assert.match(w, /api\.post\("\/api\/ai\/write"/);
    const dlg = w.slice(w.indexOf("function aiJobDialog"), w.indexOf("async function applyAiResult"));
    assert.match(dlg, /onClose: \(\) => stop && stop\(\)/); // 창을 닫으면 따라가기만 멈춤
    assert.doesNotMatch(dlg.match(/onClose:[^\n]*/)[0], /cancelJob/);
  });
  test("바뀌는 부분은 esc로 감쌈", () => {
    const w = src("writing.js");
    const diff = w.slice(w.indexOf("function aiDiffDialog"), w.indexOf("function aiLostDialog"));
    assert.match(diff, /esc\(x\.text\)/);
    assert.match(diff, /esc\(before\)/);
    assert.match(diff, /esc\(after\)/);
  });
});
