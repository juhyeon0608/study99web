// 3단계 AI 질문 · 인용 검증 화면의 순수 함수 (docs/design/phase3-ask-ui.md 3 · 5 · 6장, 명세 17장)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ask.js → api.js · jobs.js가 불러올 때 document · window에 처리기를 거는 것만 흉내
globalThis.document = { addEventListener() {}, hidden: false };
globalThis.window = { addEventListener() {} };
const A = await import("../../paperlab/static/js/ask.js");

describe("주소 (#/ask)", () => {
  test("범위 · 탭 · 작업 번호", () => {
    assert.deepEqual(A.parseAskHash("#/ask"), { tab: "library", scope: "library", job: null });
    assert.deepEqual(A.parseAskHash("#/ask/c12"), { tab: "library", scope: "c12", job: null });
    assert.deepEqual(A.parseAskHash("#/ask/f3"), { tab: "library", scope: "f3", job: null });
    assert.deepEqual(A.parseAskHash("#/ask/find"), { tab: "find", scope: null, job: null });
    assert.deepEqual(A.parseAskHash("#/ask/find/j55"), { tab: "find", scope: null, job: 55 });
    for (const bad of ["#/ask/c0", "#/ask/x1", "#/ask/c12?q=질문", "#/ask/find/j0", "#/askc1"]) {
      assert.deepEqual(A.parseAskHash(bad), { tab: "library", scope: "library", job: null }, bad);
    }
    assert.equal(A.scopeHash("library"), "#/ask");
    assert.equal(A.scopeHash("c7"), "#/ask/c7");
    assert.equal(A.scopeFromFilter({ kind: "collection", id: 4 }), "c4");
    assert.equal(A.scopeFromFilter({ kind: "folder", id: 9 }), "f9");
    assert.equal(A.scopeFromFilter({ kind: "starred", id: null }), "library");
  });
});

describe("색인 상태 (3.2절)", () => {
  const ix = { papers: 32, with_pdf: 32, indexed: 30, no_text: 0, pending: 2, embed: true, loaded: true };
  test("색인 중 · 대기 · 실패 · 끝", () => {
    const running = { status: "running", progress: { message: "색인 중 1/2편" } };
    assert.deepEqual(A.indexState(ix, running), { state: "indexing", text: "32편 중 30편 색인됨 · 2편 색인 중 (1/2)" });
    assert.equal(A.indexState(ix, null).state, "pending");
    assert.equal(A.indexState(ix, { status: "cancelled" }).text, "2편이 아직 색인되지 않았어요");
    assert.equal(A.indexState(ix, { status: "failed", error_code: "index_failed" }).text, "색인하지 못한 논문이 있어요 (색인하지 못함)");
    const done = { ...ix, indexed: 30, pending: 0, no_text: 2 };
    assert.equal(A.indexState(done, { status: "succeeded" }).text, "이 범위 30편 모두 색인됨 · 2편은 본문이 없어 빠져요(스캔본)");
  });
});

describe("AI로 찾기 단계 (5.1절)", () => {
  test("지금 단계 · 끝난 단계 옆 글", () => {
    const s = A.findSteps({ status: "running", progress: { step: "pick", counts: { queries: 3, candidates: 112 } } });
    assert.deepEqual(s.map((x) => x.state), ["done", "done", "now", ""]);
    assert.equal(s[0].note, "3개");
    assert.equal(s[1].note, "OpenAlex · Semantic Scholar 112편");
    const fin = A.findSteps({ status: "succeeded", progress: {} });
    assert.ok(fin.every((x) => x.state === "done"));
    assert.equal(A.findSteps({ status: "queued", progress: {} })[0].state, "now");
    assert.ok(A.FIND_WARN.s2_failed && A.FIND_FAIL.bad_output);
  });
});

describe("인용 검증 표시 (6장)", () => {
  const items = [
    { marker_index: 0, verdict: "supported", method: "ai" },
    { marker_index: 1, verdict: "weak", method: "quote", reason: "원문은 p.4에 있어요" },
    { marker_index: 1, verdict: "unsupported", method: "ai", reason: "없음" },
    { marker_index: 2, verdict: "unchecked", method: "none" },
    { marker_index: 3, verdict: "pending", method: "ai" },
    { marker_index: 4, verdict: "weak", method: "ai" },
  ];
  test("이름 · 순서", () => {
    assert.equal(A.vdName(items[1]), "직접 인용 다름");
    assert.equal(A.vdName(items[2]), "근거 없음");
    assert.equal(A.vdName({ verdict: "zzz" }), "확인 못 함");
    assert.deepEqual(A.sortVerify(items).map((x) => x.i), [2, 1, 5, 3, 4, 0]);
  });
  test("미리보기 표시는 약함 · 근거 없음만, 한 인용 표시에 가장 나쁜 판정", () => {
    const m = A.verifyMarks(items);
    assert.deepEqual([...m.keys()], [1, 4]);
    assert.equal(m.get(1).verdict, "unsupported");
    assert.equal(m.get(1).i, 2);
  });
  test("요약 · 끝 알림", () => {
    assert.equal(A.verifySummary({ unsupported: 1, weak: 2 }), "인용 검증: ✕ 1 · ◐ 2 — 미리보기에 표시했어요");
    assert.equal(A.verifySummary({ supported: 3 }), "");
    assert.equal(A.verifyDoneText({ unsupported: 1, weak: 2 }), "인용 검증을 마쳤어요. 근거 없음 1개, 약함 2개");
  });
});

describe("코드 검사", () => {
  const src = readFileSync(new URL("../../paperlab/static/js/ask.js", import.meta.url), "utf8");
  test("질문은 주소에 넣지 않음 (AC-L03) · innerHTML에 들어가는 서버 글은 esc", () => {
    assert.ok(!/location\.hash\s*=.*question/.test(src));
    assert.ok(!/replaceState\([^)]*question/.test(src));
    assert.match(src, /api\.post\("\/api\/find", \{ question \}\)/);
    assert.match(src, /streamEvents\("\/api\/ask", \{ scope, question \}/);
  });
  test("출처 위치는 화면 메모리로만", () => {
    assert.match(src, /state\.askSpot = \{/);
  });
});
