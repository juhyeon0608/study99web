// 원고 AI 대화 · AI 범위 고치기 · 장 · 절 일괄 처리 (docs/specs/manuscript-ai-chat.md):
// writeedit.js 범위 함수(진짜 문단 · 이 절 · 이 장 · 대상 한 줄 · 목차) · writechat.js(답 읽기 · 제안 넣기 · 대화 줄 · 일괄 넣기) · 코드 검사
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { bare, templateExprs } from "./codecheck.mjs";
import {
  BATCH_MAX, BATCH_MODES, CHAT_SHORTCUT, PROPOSAL_STATE_TEXT, applyBatch, applyProposals, autoScope, batchCounts, batchEdit, batchItemState,
  batchItems, batchTitle, droppedCites, isChatKey, parseProposals, proposalEdit, proposalW, scopeChipText, splitReply, threadOrder,
  unanswered, waitingJob,
} from "../../paperlab/static/js/writechat.js";
import { docHash } from "../../paperlab/static/js/writeai.js";
import {
  PARA_KINDS, SCOPE_KINDS, SCOPE_NAMES, SCOPE_WHY, aiScope, blockAt, outlineText, placeLabel, scopeSummary, sectionAt, shortcutHelp,
  textBlocks,
} from "../../paperlab/static/js/writeedit.js";

const JS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "paperlab", "static", "js");
const src = (name) => readFileSync(join(JS, name), "utf8");

const DOC = [
  "# 논문 제목", "",
  "## 제1장 서론", "",
  "서론 첫 문단이다.", "둘째 줄도 같은 문단이다.", "",
  "### 제1절 배경", "",
  "배경 문단 [@kim2020]이다.", "",
  "- 항목 하나", "- 항목 둘", "", "- 느슨한 항목 셋", "",
  "표: 결과 요약", "| a | b |", "| --- | --- |", "| 1 | 2 |", "",
  "![그림 설명](fig:0123456789abcdef.png)", "",
  "```", "코드 줄", "", "코드 둘째", "```", "",
  "[^1]: 각주 내용", "    이어지는 각주", "",
  "> 인용 블록", "",
  "마지막 문단이다.", "",
  "### 제2절 방법", "",
  "방법 문단이다.", "",
  "## 제2장 결과", "",
  "결과 문단이다.", "",
  "[참고문헌]", "",
].join("\n");
const at = (s, k = 0) => DOC.indexOf(s) + k;
const textOf = (sc) => DOC.slice(sc.from, sc.to);

describe("원고 덩어리 (진짜 문단만 — 2026-10-17 'ai 보내는 범위가 이상한')", () => {
  const blocks = textBlocks(DOC);
  const kinds = blocks.map((b) => b.type);
  test("제목 · 문단 · 목록 · 캡션 · 표 · 그림 · 코드 · 각주 정의 · 인용 · [참고문헌]을 나눈다", () => {
    assert.deepEqual(kinds, ["heading", "heading", "para", "heading", "para", "list", "caption", "table", "figure", "code", "footnote",
      "quote", "para", "heading", "para", "heading", "para", "bib"]);
    assert.deepEqual(blocks.filter((b) => b.type === "heading").map((b) => [b.level, b.title]),
      [[1, "논문 제목"], [2, "제1장 서론"], [3, "제1절 배경"], [3, "제2절 방법"], [2, "제2장 결과"]]);
    assert.ok(PARA_KINDS.has("para") && PARA_KINDS.has("list") && !PARA_KINDS.has("table") && !PARA_KINDS.has("heading"));
  });
  test("두 줄 문단은 한 덩어리 · 느슨한 목록(빈 줄 사이)도 한 덩어리 · 코드 안 빈 줄은 코드", () => {
    const p = blocks[2];
    assert.equal(DOC.slice(p.from, p.to), "서론 첫 문단이다.\n둘째 줄도 같은 문단이다.");
    const list = blocks.find((b) => b.type === "list");
    assert.equal(DOC.slice(list.from, list.to), "- 항목 하나\n- 항목 둘\n\n- 느슨한 항목 셋");
    const code = blocks.find((b) => b.type === "code");
    assert.equal(DOC.slice(code.from, code.to), "```\n코드 줄\n\n코드 둘째\n```");
    const fn = blocks.find((b) => b.type === "footnote");
    assert.equal(DOC.slice(fn.from, fn.to), "[^1]: 각주 내용\n    이어지는 각주");
  });
  test("문단 바로 뒤 목록 · 표 · 캡션 · 제목 줄은 문단을 끊는다", () => {
    const v = "글 한 줄\n- 목록\n글 두 줄\n표: 캡션\n| a |\n| - |\n## 장\n끝";
    assert.deepEqual(textBlocks(v).map((b) => [b.type, v.slice(b.from, b.to)]),
      [["para", "글 한 줄"], ["list", "- 목록\n글 두 줄"], ["caption", "표: 캡션"], ["table", "| a |\n| - |"], ["heading", "## 장"], ["para", "끝"]]);
    assert.deepEqual(textBlocks("").map((b) => b.type), []);
    assert.equal(blockAt(textBlocks("가\n\n나"), 2), null); // 빈 줄
  });
});

describe("AI 범위 aiScope (선택 · 문단 · 이 절 · 이 장)", () => {
  test("커서 문단 = 그 문단만 (제목 · 앞뒤 문단 없이), 줄 끝 · 첫 글자 앞도 그 문단", () => {
    for (const pos of [at("배경 문단"), at("배경 문단") + 3, at("이다.\n\n- 항목") + 3]) {
      const sc = aiScope(DOC, pos, pos, "para");
      assert.ok(sc.ok, JSON.stringify(sc));
      assert.equal(sc.text, "배경 문단 [@kim2020]이다.");
      assert.equal(sc.label, "제1장 제1절 · 문단");
    }
    assert.equal(aiScope(DOC, at("항목 둘"), at("항목 둘"), "para").text, "- 항목 하나\n- 항목 둘\n\n- 느슨한 항목 셋"); // 목록 통째로
    assert.equal(aiScope(DOC, at("항목 둘"), at("항목 둘"), "para").label, "제1장 제1절 · 목록");
    assert.equal(aiScope(DOC, at("인용 블록"), at("인용 블록"), "para").text, "> 인용 블록");
  });
  test("빈 줄 · 제목 · 표 · 그림 · 캡션 · 코드 · 각주 정의 · [참고문헌] 줄은 문단 모드에서 고르지 않고 이유를 말한다", () => {
    const cases = [["\n\n### 제1절", 1, "blank"], ["### 제1절 배경", 2, "heading"], ["| 1 | 2 |", 2, "table"],
      ["![그림", 3, "figure"], ["표: 결과", 1, "caption"], ["코드 줄", 1, "code"], ["[^1]:", 2, "footnote"], ["[참고문헌]", 2, "bib"]];
    for (const [s, k, reason] of cases) {
      const sc = aiScope(DOC, at(s, k), at(s, k), "para");
      assert.equal(sc.ok, false, s);
      assert.equal(sc.reason, reason, s);
      assert.equal(sc.message, SCOPE_WHY[reason]);
    }
    assert.match(SCOPE_WHY.heading, /제목 줄은 AI로 보내지 않아요/);
  });
  test("선택: 고른 글(앞뒤 공백 뺌), 고른 게 없으면 커서 문단(fallback), 공백만 고르면 문단", () => {
    const s = at("서론 첫");
    const sc = aiScope(DOC, s - 1, s + 7, "sel"); // 앞 줄바꿈까지 고름 → 뺌
    assert.equal(sc.kind, "sel");
    assert.equal(sc.text, "서론 첫 문단");
    assert.equal(sc.label, "제1장 · 고른 글");
    assert.equal(sc.paras.length, 1);
    const fb = aiScope(DOC, at("방법 문단"), at("방법 문단"), "sel");
    assert.ok(fb.ok && fb.fallback && fb.kind === "para" && fb.text === "방법 문단이다.");
    assert.equal(aiScope(DOC, at("\n\n### 제1절", 1), at("\n\n### 제1절", 2), "sel").reason, "blank");
    // 여러 문단에 걸친 선택은 문단 수를 센다 (제목 · 표는 빼고)
    const wide = aiScope(DOC, at("배경 문단"), at("마지막 문단이다.") + 3, "sel");
    assert.equal(wide.paras.length, 4); // 배경 문단 · 목록 · 인용 · 마지막 문단(일부)
  });
  test("이 절 = 지금 ### 제목 다음 줄부터 다음 ###(이하) 제목 전까지 · 이 장 = 지금 ## 덩어리 (제목 줄 없이)", () => {
    const sec = aiScope(DOC, at("배경 문단"), at("배경 문단"), "section");
    assert.ok(sec.ok);
    assert.ok(textOf(sec).startsWith("배경 문단") && textOf(sec).endsWith("마지막 문단이다."));
    assert.ok(!/^#/m.test(sec.text) && sec.label === "제1장 제1절");
    assert.deepEqual(sec.paras.map((p) => DOC.slice(p.from, p.to).slice(0, 6)), ["배경 문단 ", "- 항목 하", "> 인용 블", "마지막 문단"]);
    // 절 제목 줄 위에 커서가 있어도 그 절
    assert.equal(aiScope(DOC, at("### 제2절"), at("### 제2절"), "section").text, "방법 문단이다.");
    const ch = aiScope(DOC, at("배경 문단"), at("배경 문단"), "chapter");
    assert.ok(textOf(ch).startsWith("서론 첫 문단") && textOf(ch).endsWith("방법 문단이다.") && ch.label === "제1장");
    assert.equal(ch.paras.length, 6); // 서론 · 배경 · 목록 · 인용 · 마지막 · 방법 (제목 · 표 · 그림 · 캡션 · 코드 · 각주 정의 빼고)
    assert.ok(ch.text.includes("### 제2절 방법")); // 장 안의 절 제목은 맥락으로 남지만 문단에는 들지 않음
    // 장 앞 서론 부분(### 전)은 절이 아님 · 원고 제목 위는 장이 아님
    assert.equal(aiScope(DOC, at("서론 첫"), at("서론 첫"), "section").reason, "no-section");
    assert.equal(aiScope(DOC, 0, 0, "chapter").reason, "no-chapter");
    // 다음 장의 결과 문단: 제2장 (절 없음)
    assert.equal(aiScope(DOC, at("결과 문단"), at("결과 문단"), "chapter").text, "결과 문단이다.\n\n[참고문헌]");
    assert.equal(aiScope("## 제1장 빈 장\n\n## 제2장", 3, 3, "chapter").reason, "empty");
  });
  test("자리 이름 · 번호 없는 제목 · 대상 한 줄(쉼표) · 목차", () => {
    assert.equal(placeLabel(DOC, at("방법 문단")), "제1장 제2절");
    assert.equal(placeLabel(DOC, at("논문 제목")), "원고 앞부분");
    assert.equal(placeLabel("## 국문초록\n\n### 연구의 필요성과 목적에 관하여 길게\n\n글", 40), "국문초록 연구의 필요성과 목적에…");
    const sc = aiScope(DOC, at("배경 문단"), at("배경 문단"), "section");
    assert.equal(scopeSummary(sc), `대상: 제1장 제1절 (문단 4개 · ${sc.chars.toLocaleString("en-US")}자)`);
    assert.equal(scopeSummary({ ok: true, label: "제2장", paras: [1, 2], chars: 1230 }), "대상: 제2장 (문단 2개 · 1,230자)");
    assert.equal(scopeSummary({ ok: false }), "");
    assert.equal(outlineText(DOC), "# 논문 제목\n## 제1장 서론\n### 제1절 배경\n### 제2절 방법\n## 제2장 결과");
    assert.equal(outlineText(DOC, 15), "# 논문 제목");
    assert.deepEqual(SCOPE_KINDS, ["sel", "para", "section", "chapter"]);
    assert.deepEqual(Object.values(SCOPE_NAMES), ["선택", "문단", "이 절", "이 장"]);
    assert.equal(sectionAt(DOC, at("결과 문단"), 3), null);
  });
});

describe("AI 답 읽기 (수정 제안 JSON)", () => {
  const reply = (obj, before = "고쳐 봤어요.") => `${before}\n\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;
  test("```json 블록 · 끝의 맨 JSON · 없음 · 깨짐 · 만드는 중(안 닫힌 블록)", () => {
    const r = splitReply(reply({ edits: [{ find: "a", replace: "b" }], note: "n" }));
    assert.equal(r.answer, "고쳐 봤어요.");
    assert.deepEqual(r.json.edits, [{ find: "a", replace: "b" }]);
    assert.equal(splitReply('답 {"edits": [{"find": "x}", "replace": "y"}]} 끝').answer, "답  끝");
    assert.deepEqual(splitReply('답 {"edits": [{"find": "x}", "replace": "y"}]}').json.edits[0], { find: "x}", replace: "y" });
    assert.deepEqual(splitReply("그냥 답\n```python\nx = {1}\n```"), { answer: "그냥 답\n```python\nx = {1}\n```", json: null, pending: false, broken: false });
    assert.equal(splitReply('답\n```json\n{"edits": [oops]}\n```').broken, true);
    const live = splitReply('답을 쓰는 중\n```json\n{"edits": [{"find": "가');
    assert.deepEqual([live.answer, live.pending, live.json], ["답을 쓰는 중", true, null]);
    assert.equal(splitReply("").answer, "");
  });
  test("parseProposals: 모양이 틀린 항목 · 바뀌는 것 없는 항목은 빼고 replace_all은 범위 전체", () => {
    const p = parseProposals(reply({ edits: [{ find: "a", replace: "b" }, { find: "c", replace: "c" }, { find: " ", replace: "x" }, { find: 1, replace: "x" }, "x"] }));
    assert.deepEqual(p.edits, [{ find: "a", replace: "b" }]);
    const w = parseProposals(reply({ replace_all: "새 글", note: "다시 씀" }, ""), "  옛 글  ");
    assert.deepEqual([w.edits, w.note, w.answer], [[{ find: "옛 글", replace: "새 글" }], "다시 씀", ""]);
    assert.equal(parseProposals('x\n```json\n{"edits": [nope]}\n```').broken, true);
  });
});

describe("제안 넣기 (planApply — 원래 글이 그대로 한 곳에 있을 때만)", () => {
  const V = "앞 문장. 바꿀 문장이다. 뒤 문장.";
  const P = { find: "바꿀 문장이다.", replace: "바꾼 문장이다.", at: V.indexOf("바꿀") };
  const scope = { fingerprint: docHash(V) };
  test("지문이 같으면 그 자리 그대로(same), 바뀌었으면 원래 글을 다시 찾음(moved), 없거나 여러 곳이면 넣지 않음(lost)", () => {
    assert.deepEqual(proposalW(P, scope), { text: P.find, sel_start: P.at, sel_end: P.at + P.find.length, insert: false, doc_hash: docHash(V), before: "" });
    assert.deepEqual(proposalEdit(V, P, scope), { state: "same", from: P.at, to: P.at + P.find.length, text: "바꾼 문장이다." });
    const moved = proposalEdit(`새 글. ${V}`, P, scope);
    assert.deepEqual([moved.state, moved.from], ["moved", P.at + 5]);
    assert.equal(proposalEdit(V.replace("바꿀", "고친"), P, scope).state, "lost");
    // 원래 자리에 원래 글이 그대로면 그 자리 (같은 글이 뒤에 또 생겨도) · 위치를 모르고 두 곳이면 넣지 않음
    assert.deepEqual(Object.values(proposalEdit(`${V} ${P.find}`, P, scope)).slice(0, 2), ["moved", P.at]);
    assert.equal(proposalEdit(`${V} ${P.find}`, { ...P, at: null }, scope).state, "lost");
    assert.equal(proposalEdit(V, { ...P, at: null }, {}).state, "moved"); // 위치를 몰라도 한 곳이면
    assert.equal(proposalEdit(V, { find: "뒤 ", replace: "" }, {}).text, ""); // 지우기 제안
  });
  test("모두 적용: 뒤쪽부터 넣고, 못 찾은 것은 남김", () => {
    const props = [{ find: "앞 문장.", replace: "첫 문장.", at: 0 }, P, { find: "없는 글", replace: "x", at: null }];
    const r = applyProposals(V, props, scope, [0, 1, 2]);
    assert.equal(r.value, "첫 문장. 바꾼 문장이다. 뒤 문장.");
    assert.deepEqual([r.applied, r.lost], [[0, 1], [2]]);
    assert.deepEqual(applyProposals(V, props, scope, []).applied, []);
  });
  test("[@인용키]를 빠뜨린 제안 알림", () => {
    assert.deepEqual(droppedCites("근거 [@kim2020; @lee, p. 3]가 있다.", "근거가 있다 [@lee]."), ["kim2020"]);
    assert.deepEqual(droppedCites("[@a]", "[@a] 그대로"), []);
    assert.deepEqual(droppedCites("메일 a@b.com", "x"), []);
  });
});

describe("대화 줄 · 기다리는 작업 · 범위 칩", () => {
  const msgs = [
    { id: 1, role: "user", content: "q1", scope: { kind: "para" } },
    { id: 2, role: "user", content: "q2", scope: { kind: "none" } },
    { id: 3, role: "assistant", content: "a2", scope: { reply_to: 2 } },
    { id: 4, role: "assistant", content: "a1", scope: { reply_to: 1 } },
    { id: 5, role: "assistant", content: "orphan", scope: { reply_to: 99 } },
  ];
  test("답은 질문 바로 아래 (늦게 와도), 질문이 없어진 답은 순서대로", () => {
    assert.deepEqual(threadOrder(msgs).map((m) => m.id), [1, 4, 2, 3, 5]);
    assert.deepEqual(threadOrder([]), []);
  });
  test("답을 못 받은 질문 · 기다리는 작업", () => {
    const m2 = [...msgs.slice(0, 2), msgs[3], { id: 6, role: "user", content: "q3", scope: {} }];
    const jobs = { 2: { id: 20, status: "failed" }, 6: { id: 60, status: "running" } };
    assert.deepEqual(unanswered(m2, jobs).map((x) => [x.message.id, x.job && x.job.id]), [[2, 20], [6, 60]]);
    assert.equal(waitingJob(m2, jobs).id, 60);
    assert.equal(waitingJob(m2, { 2: { id: 20, status: "failed" } }), null);
  });
  test("범위 칩 · 자동 범위(고른 글 → 문단 → 절)", () => {
    assert.equal(scopeChipText({ kind: "para", label: "제1장 제1절 · 문단", chars: 1230 }), "문단 · 제1장 제1절 (1,230자)");
    assert.equal(scopeChipText({ kind: "section", label: "제2장 제1절", chars: 5 }), "절 · 제2장 제1절 (5자)");
    assert.equal(scopeChipText({ kind: "none" }), "범위 없음");
    assert.equal(scopeChipText(null), "범위 없음");
    const fn = (s, e) => (k) => aiScope(DOC, s, e, k);
    assert.equal(autoScope(fn(at("배경 문단"), at("배경 문단") + 2)).kind, "sel");
    assert.equal(autoScope(fn(at("배경 문단"), at("배경 문단"))).kind, "para");
    assert.equal(autoScope(fn(at("### 제1절"), at("### 제1절"))).kind, "section"); // 제목 줄 → 절
    assert.equal(autoScope(fn(0, 0)), null);
    assert.equal(PROPOSAL_STATE_TEXT.applied, "적용함");
  });
  test("Alt+C = 대화 열기 (Ctrl · ⌘ · Shift · 반복이면 아님) · 단축키 도움말", () => {
    assert.equal(CHAT_SHORTCUT, "Alt+C");
    assert.ok(isChatKey({ code: "KeyC", altKey: true }));
    for (const e of [{ code: "KeyC", altKey: true, ctrlKey: true }, { code: "KeyC", altKey: true, metaKey: true }, { code: "KeyC", altKey: true, shiftKey: true },
      { code: "KeyC", altKey: true, repeat: true }, { code: "KeyC" }, { code: "KeyA", altKey: true }, null]) assert.ok(!isChatKey(e), JSON.stringify(e));
    assert.ok(shortcutHelp(false).keys.some((r) => r[0].includes("AI 대화 열기") && r[1] === "Alt+C"));
    assert.ok(shortcutHelp(true).keys.some((r) => r[0].includes("AI 대화 열기") && r[1] === "⌥+C"));
  });
});

describe("장 · 절 일괄 처리", () => {
  const sc = aiScope(DOC, at("배경 문단"), at("배경 문단"), "section");
  const items = batchItems(DOC, sc);
  test("문단마다 넣을 자리 · 앞 글 · 상한", () => {
    assert.deepEqual(items.map((x) => x.text), ["배경 문단 [@kim2020]이다.", "- 항목 하나\n- 항목 둘\n\n- 느슨한 항목 셋", "> 인용 블록", "마지막 문단이다."]);
    assert.ok(items.every((x) => DOC.slice(x.sel_start, x.sel_end) === x.text && DOC.slice(0, x.sel_start).endsWith(x.before)));
    assert.equal(batchItems(DOC, sc, 2).length, 2);
    assert.deepEqual(batchItems(DOC, { ok: false }), []);
    assert.equal(BATCH_MAX, 30);
    assert.ok(BATCH_MODES.has("academic") && BATCH_MODES.has("polish") && !BATCH_MODES.has("continue") && !BATCH_MODES.has("draft"));
  });
  const job = (it, i, o = {}) => ({ id: 100 + i, status: "succeeded", result: { text: `${it.text} (고침)` },
    write: { text: it.text, sel_start: it.sel_start, sel_end: it.sel_end, doc_hash: docHash(DOC), insert: false, batch: { id: "b" }, batch_i: i }, ...o });
  const jobs = items.map((it, i) => job(it, i));
  test("상태 · 숫자 · 머리줄", () => {
    const mixed = [jobs[0], { ...jobs[1], status: "running" }, { ...jobs[2], write: { ...jobs[2].write, handled: "applied" } },
      { ...jobs[3], write: { ...jobs[3].write, handled: "dismissed" } }, { id: 9, status: "failed" }, { id: 10, status: "succeeded", result: null }];
    assert.deepEqual(mixed.map(batchItemState), ["ready", "running", "applied", "skipped", "failed", "expired"]);
    const c = batchCounts(mixed);
    assert.deepEqual(c, { total: 6, running: 1, ready: 1, applied: 1, skipped: 1, failed: 2 });
    assert.equal(batchTitle({ label: "제1장 제1절" }, c, "학술 문체로"), "제1장 제1절 · 학술 문체로 · 문단 6개 (넣기 전 1 · 만드는 중 1 · 넣음 1 · 건너뜀 1 · 실패 2)");
  });
  test("문단 하나 넣기: 원고 그대로면 그 자리, 앞이 바뀌었으면 원래 문단을 다시 찾고, 없으면 넣지 않음", () => {
    const e = batchEdit(DOC, jobs[0]);
    assert.deepEqual([e.state, e.from, e.text], ["same", items[0].sel_start, "배경 문단 [@kim2020]이다. (고침)"]);
    assert.equal(batchEdit(`추가\n${DOC}`, jobs[0]).state, "moved");
    assert.equal(batchEdit(DOC.replace("배경 문단", "바뀐 문단"), jobs[0]).state, "lost");
  });
  test("모두 넣기: 넣기 전 결과만, 뒤 문단부터 · 원래 문단이 없어진 것은 건너뜀", () => {
    const edited = DOC.replace("> 인용 블록", "> 고친 인용");
    const r = applyBatch(edited, [...jobs, { ...jobs[0], id: 999, write: { ...jobs[0].write, handled: "applied" } }]);
    assert.deepEqual([r.applied, r.lost], [[103, 101, 100], [102]]);
    assert.ok(r.value.includes("배경 문단 [@kim2020]이다. (고침)") && r.value.includes("마지막 문단이다. (고침)"));
    assert.ok(r.value.includes("> 고친 인용") && !r.value.includes("> 고친 인용 (고침)"));
    assert.ok(r.value.includes("### 제1절 배경\n\n배경 문단")); // 제목 · 빈 줄은 그대로
    assert.deepEqual(applyBatch(DOC, []), { value: DOC, applied: [], lost: [] });
  });
});

describe("코드 검사", () => {
  test("writechatui.js: 템플릿 값은 esc() · 숫자 · 고정 글만, AI · 사용자 글은 textContent · purifyMd · diffHtml로", () => {
    // HTML 안: esc() · 숫자 · 고정 값(act · cls · data-st). 나머지는 HTML이 아닌 곳(주소 · 선택자 · textContent · 토스트 · 질문 글)
    // 이거나 esc(`…`) 안쪽 값
    const allowed = new Set(["E", "k", "Number(m.id)", "Number(j.id)", "i", "i + 1", "props.length", "open.length", "act", "cls",
      "\"\" : \"\"", "`` : \"\"", "SCOPE_KINDS.map((k) => ``).join(\"\")", "st === \"\" ? \"\" : \"\"",
      "st === \"\" || st === \"\" ? st : st === \"\" ? \"\" : \"\"", "esc(miss.map((k) => ``).join(\"\"))",
      "scopeSummary(sc)", "CSS.escape(focused)", "j.id", "m.id", "mid", "id", "Number(umid)", "r.applied.length", "r.lost.length",
      "c.ready", "String(m.scope && m.scope.label || \"\").replace(/ · (고른 글|문단|목록)$/, \"\")", "String(p.replace).slice(0, 300)",
      "b.label || \"\"", "ctx.modeName(b.mode)", "b.jobs", "fmtClock(b.created_at)"]);
    const ui = src("writechatui.js");
    for (const expr of templateExprs(ui)) assert.ok(allowed.has(bare(expr).trim()), `writechatui.js: \${${expr}}`);
    assert.match(ui, /\$\("\.mc-bubble", node\)\.textContent = m\.content/);
    assert.match(ui, /out\.textContent = r\.answer/);
    assert.match(ui, /purifyMd\(window\.marked\.parse/);
    assert.match(ui, /\$\("\.ai-diff", node\)\.innerHTML = diffHtml\(wordDiff\(p\.find, p\.replace\)\)/);
    assert.doesNotMatch(ui, /innerHTML = (partial|m\.content|r\.answer|p\.replace)/);
    assert.ok(!/insertAdjacentHTML|outerHTML\s*=|document\.write/.test(ui));
    // 넣기: 버전 기록 먼저 · planApply 기반(proposalEdit · batchEdit · applyBatch) · 일괄은 한 번만 저장
    assert.match(ui, /saveVersion\(mid, ta\.value\); \/\/ 넣기 전 원고를 버전 기록에/);
    assert.match(ui, /if \(S\.snapped\.has\(S\.sel\)\) return;/);
    assert.match(ui, /api\.post\(`\/api\/manuscripts\/\$\{mid\}\/chat`, \{ content, scope, outline: outlineText\(ta\.value\), ending: ctx\.ending\(\) \}\)/);
    assert.match(ui, /ensureAiRoute\("write"\)/);
  });
  test("writing.js: 범위 고르기 · 일괄 처리 · 대화 보기 연결", () => {
    const w = src("writing.js");
    assert.ok(!w.includes("function selectionOrParagraph"), "빈 줄 사이 글을 통째로 보내던 함수는 없앰");
    assert.match(w, /aiScope\(ta\.value, ta\.selectionStart, ta\.selectionEnd, getScope\(\)\)/);
    assert.match(w, /BATCH_MODES\.has\(mode\) && sc\.paras\.length > 1\) return runBatch\(mode, ta, sc\)/);
    assert.match(w, /api\.post\(`\/api\/manuscripts\/\$\{W\.m\.id\}\/ai-batch`/);
    assert.match(w, /flashRange\(view, ta, s, e\)/);
    assert.match(w, /\.\.\.SCOPE_KINDS\.map\(\(v\) => \(\{ label: `범위: \$\{SCOPE_MENU\[v\]\}`/);
    const pane = w.slice(w.indexOf("function aiPane("), w.indexOf("async function openAiJobFromHash"));
    assert.match(pane, /data-ai-view="\$\{v\}"/);
    assert.match(pane, /chatView\(\$\("\[data-ai-chat\]", aside\), helpers\)/);
    assert.match(pane, /batchView\(\$\("\[data-ai-batch\]", aside\), helpers\)/);
    assert.match(pane, /if \(isChatKey\(e\) && !modalOpen\(\) && alive\(\)\)/);
    assert.match(pane, /filter\(\(j\) => !\(j\.write && j\.write\.batch\)\)/);
    assert.match(pane, /if \(job\.kind === "ms_chat"\) return openChat\(\)/);
    assert.match(pane, /esc\(S\.targets\.get\(j\.id\)\)/);
    // 일괄 확인 창은 패널 밖(runBatch)에서 — 패널은 모달을 띄우지 않음
    assert.doesNotMatch(pane, /\bmodal\(|confirmDialog\(|popupMenu\(/);
  });
  test("jobs.js: 원고 대화 이름 · 알림 · 주소, 일괄 처리는 묶음마다 한 번 알림", () => {
    const j = src("jobs.js");
    assert.match(j, /ms_chat: "원고 대화"/);
    assert.match(j, /"translate_paper", "ms_chat"\]\)/);
    assert.match(j, /if \(bid && N\.batches\.has\(bid\)\) return;/);
  });
  test("CSS: 대화 칸은 패널 안 격자(겹쳐 뜨지 않음)", () => {
    const css = readFileSync(join(JS, "..", "css", "app.css"), "utf8");
    // 대화 구역만 (다음 "/* ----------------" 구역 머리 — 예: 그림 만들기 패널 — 앞까지)
    const from = css.indexOf("원고 AI 대화 · 장 · 절 일괄 처리");
    const next = css.indexOf("/* ----------------", from);
    const part = css.slice(from, next === -1 ? undefined : next);
    assert.ok(part.length > 100);
    assert.doesNotMatch(part, /position: (fixed|absolute)/);
    assert.match(part, /\.mc-log \{ flex: 1; min-height: 0; overflow-y: auto;/);
  });
});
