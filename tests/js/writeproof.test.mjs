// 맞춤법 · 띄어쓰기 점검 + 초록 만들기 (docs/specs/writing-proofread.md — writeproof.js): 범위 · 조각 · 자리 다시 찾기 ·
// 고치기 · 모두 고치기 · 묶음 상태 · 이어서 점검 · 무시 기억 · 점검표 한 줄 · 초록 계획 · 코드 검사
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ABSTRACT_MODES, CHUNK_MAX, PROOF_SCOPES, RUN_CHUNKS, abstractPlan, applyAll, chunkRanges, continueRange, findSection, fixEdit,
  headingLines, isProofKey, issueKey, loadMarks, locateIssue, newRunId, planRun, proofCheckText, proofRuns, runItems, runStatus,
  saveMarks, scopeRange, withAbstractHeading,
} from "../../paperlab/static/js/writeproof.js";
import { insertionText } from "../../paperlab/static/js/writeai.js";
import { shortcutHelp } from "../../paperlab/static/js/writeedit.js";
import { bare, templateExprs } from "./codecheck.mjs";

const DOC = [
  "# 논문 제목", "",
  "## 국문 초록", "", "본 연구는 학습 동기를 분석 하였다.", "", "주제어: 동기, 학습", "",
  "## 제1장 서론", "", "첫 문단 글이다.", "둘째 줄이다.", "", "둘째 문단 글이다.", "",
  "### 제1절 배경", "", "배경 글이다.", "",
  "### 제2절 목적", "", "목적 글이다.", "",
  "## 제2장 방법", "", "방법 글이다.", "",
].join("\n");
const at = (s, from = 0) => DOC.indexOf(s, from);
const slice = (r) => (r ? DOC.slice(r.from, r.to) : null);

describe("범위", () => {
  test("제목 줄: 단계 · 번호 뺀 제목 · 코드 블록 안은 아님", () => {
    const h = headingLines("## 제1장 서론\n```\n## 코드\n```\n### 1.2. 배경 ##\n");
    assert.deepEqual(h.map((x) => [x.level, x.text]), [[2, "서론"], [3, "배경"]]);
  });
  test("고른 글 · 문단 · 절 · 장 · 전체", () => {
    const p = at("둘째 줄");
    assert.equal(scopeRange(DOC, p, p, "sel"), null);
    assert.equal(slice(scopeRange(DOC, p, p + 6, "sel")), "둘째 줄이다.".slice(0, 6));
    assert.equal(slice(scopeRange(DOC, p, p, "para")), "첫 문단 글이다.\n둘째 줄이다.");
    assert.equal(slice(scopeRange(DOC, at("서론") + 1, at("서론") + 1, "para")), "## 제1장 서론");
    assert.equal(slice(scopeRange(DOC, at("둘째 줄") - 1, at("둘째 줄") - 1, "para")), "첫 문단 글이다.\n둘째 줄이다."); // 줄 끝
    // 빈 줄에 커서 → 문단 없음
    const blank = at("\n\n둘째 문단") + 1;
    assert.equal(scopeRange(DOC, blank, blank, "para"), null);
    // 절: 장 머리말(첫 ### 앞)이면 장 제목부터 첫 절 앞까지, 절 안이면 그 절만
    assert.equal(slice(scopeRange(DOC, p, p, "sec")), "## 제1장 서론\n\n첫 문단 글이다.\n둘째 줄이다.\n\n둘째 문단 글이다.");
    assert.equal(slice(scopeRange(DOC, at("배경 글"), at("배경 글"), "sec")), "### 제1절 배경\n\n배경 글이다.");
    // 장: 다음 ## 앞까지 (절 포함)
    const ch = slice(scopeRange(DOC, at("배경 글"), at("배경 글"), "chap"));
    assert.ok(ch.startsWith("## 제1장 서론") && ch.endsWith("목적 글이다.") && !ch.includes("제2장"));
    assert.equal(slice(scopeRange(DOC, at("방법 글"), at("방법 글"), "chap")), "## 제2장 방법\n\n방법 글이다.");
    // 제목 앞(문서 맨 앞) — 첫 제목(# 논문 제목)부터
    assert.ok(slice(scopeRange(DOC, 0, 0, "chap")).startsWith("# 논문 제목"));
    assert.equal(slice(scopeRange(DOC, 5, 5, "all")), DOC.trim());
    assert.equal(scopeRange(DOC, 0, 0, "nope"), null);
    assert.deepEqual(PROOF_SCOPES.map((x) => x[0]), ["sel", "para", "sec", "chap", "all"]);
  });
});

describe("조각", () => {
  test("빈 줄 → 줄 → 문장 끝 순서로 자르고 글자 없는 조각은 뺌", () => {
    const paras = Array.from({ length: 12 }, (_, i) => `${i}번 문단 ${"가나다 ".repeat(90)}끝.`); // 문단당 약 370자
    const v = `${paras.join("\n\n")}\n\n   \n`;
    const ch = chunkRanges(v, 0, v.length, 1000);
    assert.deepEqual(chunkRanges("---\n\n| --- |\n\n  ", 0, 16), []); // 글자 없는 조각은 AI에 보내지 않음
    assert.ok(ch.length >= 5);
    for (const c of ch) {
      assert.ok(c.to - c.from <= 1000);
      assert.ok(/^\d+번 문단/.test(v.slice(c.from, c.to)), "문단 머리에서 시작");
      assert.ok(v.slice(c.from, c.to).endsWith("끝."), "문단 끝에서 끝남");
    }
    // 이어 붙이면 문단이 하나도 빠지지 않음
    assert.equal(ch.map((c) => v.slice(c.from, c.to)).join("\n\n"), paras.join("\n\n"));
    // 빈 줄 없는 긴 한 문단 → 문장 끝에서
    const long = "이것은 문장이다. ".repeat(600);
    const lc = chunkRanges(long, 0, long.length, CHUNK_MAX);
    assert.ok(lc.length >= 2 && lc.every((c) => long.slice(c.from, c.to).endsWith(".")));
    // 띄어쓰기도 없으면 그대로 자름 (그림 문자 반쪽은 자르지 않음)
    const emoji = `가${"😀".repeat(30)}`;
    for (const c of chunkRanges(emoji, 0, emoji.length, 10)) assert.ok(emoji.slice(c.from, c.to).isWellFormed());
  });
  test("한 번에 RUN_CHUNKS개까지 · 남은 시작", () => {
    const v = Array.from({ length: 20 }, (_, i) => `문단 ${i} ${"글".repeat(50)}`).join("\n\n");
    const p = planRun(v, 0, v.length, { max: 60, limit: 8 }); // 조각 하나 = 문단 하나
    assert.equal(p.chunks.length, 8);
    assert.equal(v.slice(p.next, p.next + 5), "문단 8 ");
    assert.equal(p.end, v.length);
    assert.equal(planRun("짧은 글", 0, 4).next, null);
    assert.equal(RUN_CHUNKS, 8);
    assert.match(newRunId(1700000000000, 0.5), /^[0-9a-z]{1,32}$/);
  });
});

describe("자리 찾기 · 고치기", () => {
  const src = "학생이 공부 하였다. 그리고 선생님도 공부 하였다.";
  const i2 = src.lastIndexOf("공부 하였다");
  const it = { find: "공부 하였다", replace: "공부하였다", at: i2, before: "그리고 선생님도 ", after: "." };
  test("원래 자리 그대로면 그 자리", () => {
    assert.equal(locateIssue(src, it), i2);
  });
  test("앞에 글이 늘어 자리가 밀리면 앞뒤 글로 한 곳만", () => {
    const cur = `새 문장. ${src}`;
    assert.equal(locateIssue(cur, it), i2 + 6);
    const e = fixEdit(cur, it);
    assert.deepEqual([e.from, e.to, e.text], [i2 + 6, i2 + 12, "공부하였다"]);
  });
  test("이미 고쳤거나 · 여러 곳이면 · 문맥이 짧으면 못 찾음 (-1 · null)", () => {
    const fixed = src.slice(0, i2) + "공부하였다" + src.slice(i2 + 6);
    assert.equal(locateIssue(fixed, it), -1);
    assert.equal(fixEdit(fixed, it), null);
    assert.equal(locateIssue("공부 하였다 공부 하였다", { ...it, at: 99, before: "", after: "" }), -1);
    assert.equal(locateIssue("x공부 하였다", { ...it, at: 50, before: "x", after: "" }), -1); // 앞뒤 글 4자 미만
    assert.equal(locateIssue(src, { ...it, find: "" }), -1);
  });
  test("원래 자리에 같은 글이 있어도 앞뒤 글이 다르면 그 자리가 아님 (밀려온 다른 곳)", () => {
    const orig = "서론 글. 연구자는 이를 분석할수 있다. 다음";
    const p0 = orig.indexOf("할수");
    const one = { find: "할수", replace: "할 수", at: p0, before: orig.slice(0, p0), after: orig.slice(p0 + 2) };
    assert.equal(locateIssue(orig, one), p0);
    // 앞 글을 고쳐 원래 자리에 사용자가 새로 쓴 '할수'가 왔음 — 앞뒤 글이 달라 고치지 않음
    const shifted = `${"가".repeat(p0 - 3)}이걸 할수 없지. 분석했다.`;
    assert.equal(shifted.slice(p0, p0 + 2), "할수");
    assert.equal(locateIssue(shifted, one), -1);
    assert.equal(fixEdit(shifted, one), null);
    // 앞 글이 바뀌었어도 뒤 글(8자)이 같으면 원래 자리
    assert.equal(locateIssue(`${"나".repeat(p0)}할수 있다. 다음`, one), p0);
    // 원고 맨 앞(앞 글 없음): 뒤 글로
    assert.equal(locateIssue("할수 있다.", { find: "할수", at: 0, before: "", after: " 있다." }), 0);
    assert.equal(locateIssue("할수 없다.", { find: "할수", at: 0, before: "", after: " 있다." }), -1);
  });
  test("모두 고치기: 찾은 곳만 · 겹치면 앞의 것 · 처음 바뀐 위치", () => {
    const items = [
      { find: "공부 하였다", replace: "공부하였다", at: 4, before: "학생이 ", after: ". 그리고" },
      it,
      { find: "하였다. 그리고", replace: "했다. 그리고", at: 7, before: "", after: "" }, // 첫 항목과 겹침
      { find: "없는 글", replace: "x", at: 0, before: "", after: "" },
    ];
    const r = applyAll(src, items);
    assert.equal(r.value, "학생이 공부하였다. 그리고 선생님도 공부하였다.");
    assert.equal(r.fixed.length, 2);
    assert.equal(r.lost.length, 2);
    assert.equal(r.first, 4);
    assert.equal(applyAll(src, []).value, src);
  });
});

describe("묶음 · 이어서 점검 · 무시 기억", () => {
  const job = (id, chunk, status, extra = {}) => ({
    id, kind: "proofread", status, created_at: `2026-10-17T10:00:0${id % 10}Z`,
    proof: { run: "r1", chunk, chunks: 2, scope: "all", offset: chunk === 1 ? 0 : 100, length: 90, end: 500, doc_len: 600,
      doc_hash: "h1", tail: `조각${chunk} 끝 글 열 글자 이상` },
    result: status === "succeeded" ? { issues: [{ find: `틀린${chunk}`, replace: `맞은${chunk}`, type: "엉뚱", reason: "r", at: chunk * 10 }] } : null,
    ...extra,
  });
  test("묶음별 · 새것 앞 · 다시 시도한 조각은 마지막 것", () => {
    const old = { ...job(1, 1, "succeeded"), proof: { ...job(1, 1, "succeeded").proof, run: "r0" }, created_at: "2026-10-16T00:00:00Z" };
    const runs = proofRuns([job(2, 1, "succeeded"), job(3, 2, "failed"), job(4, 2, "running"), old, { kind: "write", id: 9 }]);
    assert.deepEqual(runs.map((r) => r.run), ["r1", "r0"]);
    const st = runStatus(runs[0]);
    assert.deepEqual([st.total, st.done, st.active, st.failed.length], [2, 1, 1, 0]);
    assert.deepEqual([st.last, st.end, st.docLen, st.hash, st.scope], [190, 500, 600, "h1", "all"]);
    const items = runItems(runs[0]);
    assert.deepEqual(items.map((x) => [x.find, x.type]), [["틀린1", "표현"]]);
    assert.equal(runItems(runs[0], new Set([issueKey(items[0])])).length, 0);
  });
  test("이어서 점검: 원고가 그대로면 그 자리, 바뀌었으면 끝 글로 찾고 끝을 옮김", () => {
    const st = { last: 190, end: 500, docLen: 600, hash: "h1", tail: "조각2 끝 글 열 글자 이상" };
    assert.deepEqual(continueRange("x".repeat(600), st, "h1"), { from: 190, to: 500 });
    const cur = `머리말 열 글자 추가함${"y".repeat(150)}${st.tail}${"z".repeat(470)}`;
    const r = continueRange(cur, st, "other");
    assert.equal(r.from, cur.indexOf(st.tail) + st.tail.length);
    assert.equal(r.to, 500 + (cur.length - 600));
    assert.equal(continueRange("끝 글이 없음", st, "other"), null);
    assert.equal(continueRange("x".repeat(600), { ...st, end: null }, "h1"), null);
    assert.equal(continueRange("x".repeat(600), { ...st, last: 500 }, "h1"), null);
  });
  test("무시 · 고침 표시는 원고 · 묶음마다, 저장소가 막혀도 오류 없음", () => {
    const mem = new Map();
    const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    saveMarks(st, 7, "r1", { hidden: new Set(["a"]), fixed: new Set(["b"]) });
    assert.deepEqual([...loadMarks(st, 7, "r1").hidden], ["a"]);
    assert.deepEqual([...loadMarks(st, 7, "r1").fixed], ["b"]);
    assert.equal(loadMarks(st, 7, "r2").hidden.size, 0); // 새 묶음이면 비움
    mem.set("paperlab.proof.8", "{깨진");
    assert.equal(loadMarks(st, 8, "r1").hidden.size, 0);
    const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    assert.equal(loadMarks(broken, 7, "r1").fixed.size, 0);
    assert.doesNotThrow(() => saveMarks(broken, 7, "r1", { hidden: new Set(), fixed: new Set() }));
  });
  test("점검표 한 줄 (AI를 부르지 않음)", () => {
    assert.equal(proofCheckText(), "AI 맞춤법 점검: 아직 안 했어요");
    assert.equal(proofCheckText({ ran: true, open: 3 }), "AI 맞춤법 점검: 고칠 곳 3건");
    assert.equal(proofCheckText({ ran: true, open: 0, failed: 1 }), "AI 맞춤법 점검: 고칠 곳 없음 · 실패한 조각 1개");
    assert.match(proofCheckText({ ran: true, active: 2, open: 1 }), /점검 중 · 지금까지 고칠 곳 1건/);
  });
  test("Alt+P (Ctrl · ⌘ · Shift · 반복은 아님) · 단축키 도움말", () => {
    assert.ok(isProofKey({ code: "KeyP", altKey: true }));
    for (const x of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { repeat: true }, { altKey: false }]) {
      assert.ok(!isProofKey({ code: "KeyP", altKey: true, ...x }));
    }
    assert.ok(shortcutHelp(false).keys.some((r) => r[0].includes("맞춤법") && r[1].endsWith("Alt+P")));
    assert.ok(shortcutHelp(true).keys.some((r) => r[0].includes("맞춤법") && r[1].endsWith("⌥+P")));
  });
});

describe("초록 만들기", () => {
  test("국문 초록 절 → 영문 초록: 제목이 없으면 국문 초록 끝에 제목째", () => {
    const p = abstractPlan(DOC, 0, 0, "abstract_en");
    assert.equal(p.text, "본 연구는 학습 동기를 분석 하였다.\n\n주제어: 동기, 학습");
    assert.equal(p.at, at("주제어: 동기, 학습") + "주제어: 동기, 학습".length);
    assert.equal(p.append, false);
    assert.equal(withAbstractHeading("abstract_en", DOC, " English abstract.\n\nKeywords: a "), "## Abstract\n\nEnglish abstract.\n\nKeywords: a");
    assert.equal(withAbstractHeading("abstract_en", DOC, "## Abstract\n\nx"), "## Abstract\n\nx"); // 이미 제목으로 시작
    assert.equal(withAbstractHeading("polish", DOC, "그대로"), "그대로");
  });
  test("'## Abstract'가 비어 있으면 그 제목 아래, 글이 있으면 그 끝에 덧붙임", () => {
    const empty = DOC.replace("## 제1장 서론", "## Abstract\n\n## 제1장 서론");
    const p = abstractPlan(empty, 0, 0, "abstract_en");
    assert.equal(p.at, empty.indexOf("## Abstract") + "## Abstract".length);
    assert.equal(withAbstractHeading("abstract_en", empty, "Body"), "Body"); // 제목이 있으니 붙이지 않음
    const full = DOC.replace("## 제1장 서론", "## Abstract\n\nOld text.\n\n## 제1장 서론");
    const q = abstractPlan(full, 0, 0, "abstract_en");
    assert.deepEqual([q.at, q.append], [full.indexOf("Old text.") + "Old text.".length, true]);
  });
  test("고른 글이 먼저 · 초록이 없으면 안내 · 너무 길면 안내 · 반대 방향(국문 초록)", () => {
    const s = at("본 연구는");
    const p = abstractPlan(DOC, s, s + 5, "abstract_en");
    // 보낼 글은 고른 글, 넣을 자리는 국문 초록 묶음 끝 (초록 가운데가 아님)
    assert.deepEqual([p.text, p.at], ["본 연구는", at("주제어: 동기, 학습") + "주제어: 동기, 학습".length]);
    const plain = "# 제목\n\n본문 한 문단.\n\n## 제1장 서론\n";
    assert.equal(abstractPlan(plain, 6, 10, "abstract_en").at, 10); // 초록이 없으면 고른 글 끝
    assert.equal(withAbstractHeading("abstract_en", plain, "Text.\n\nKeywords: a"), "**Abstract**\n\nText.\n\n**Keywords**: a");
    assert.match(abstractPlan("# 제목\n\n본문", 0, 0, "abstract_en").error, /국문 초록을 찾지 못했어요/);
    assert.match(abstractPlan("# 제목\n\n본문", 0, 0, "abstract_en").error, /\*\*국문초록\*\* 줄/); // '## 국문 초록' 장을 권하지 않음
    assert.match(abstractPlan(`## 초록\n\n${"가".repeat(7000)}`, 0, 0, "abstract_en").error, /너무 길어요/);
    const en = "## Abstract\n\nThis study analyzes motivation.\n\n## 제1장 서론\n";
    const k = abstractPlan(en, 0, 0, "abstract_ko");
    assert.equal(k.text, "This study analyzes motivation.");
    // 원문이 제목 모양이면 같은 단계 제목으로
    assert.equal(withAbstractHeading("abstract_ko", en, "국문 초록 글\n\n주제어: 가, 나"), "## 국문초록\n\n국문 초록 글\n\n주제어: 가, 나");
    assert.equal(findSection("## 요약 (Summary)\n\n글\n", ABSTRACT_MODES.abstract_en.src).head.level, 2);
    assert.match(abstractPlan(DOC, 0, 0, "nope").error, /알 수 없는/);
  });
});

describe("초록 만들기 — 굵은 줄 양식 (국내 학술지 · IMRaD 양식, 점검표가 권하는 모양)", () => {
  // 양식 글은 paperlab/manuscripts.py에서 그대로 읽음 (양식이 바뀌면 이 시험도 따라감)
  const py = readFileSync(new URL("../../paperlab/manuscripts.py", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const tpl = (k) => py.match(new RegExp(`"${k}": \\{[\\s\\S]*?"content": """([\\s\\S]*?)"""`))[1];
  const KR = tpl("kr_journal");
  const IM = tpl("imrad");
  const put = (v, mode, result) => {
    const p = abstractPlan(v, 0, 0, mode);
    assert.equal(p.error, undefined);
    const ins = withAbstractHeading(mode, v, result);
    // AI 결과 패널의 넣기와 같게 (빈 줄 여러 개는 하나로 보고 비교)
    const out = v.slice(0, p.at) + insertionText(v, p.at, ins, true) + v.slice(p.at);
    return { p, out, flat: out.replace(/\n{3,}/g, "\n\n") };
  };
  test("국내 학술지 양식: **국문초록** 아래 글 → 영문 초록은 **주제어** 줄 뒤에 **Abstract** 굵은 줄로 (장 제목 아님)", () => {
    assert.ok(KR.includes("**국문초록**") && KR.includes("**주제어**"));
    const { p, out, flat } = put(KR, "abstract_en", "This study summarizes.\n\nKeywords: a, b, c, d, e");
    assert.equal(p.text, "연구의 목적, 방법, 주요 결과, 시사점을 300~500자로 요약합니다.");
    assert.equal(p.at, KR.indexOf("키워드3") + "키워드3".length);
    assert.equal(p.append, false);
    assert.ok(flat.includes("**주제어**: 키워드1, 키워드2, 키워드3\n\n**Abstract**\n\nThis study summarizes.\n\n**Keywords**: a, b, c, d, e\n\n## 1. 서론"));
    assert.ok(!/^#{1,6}\s+Abstract/m.test(out)); // '## Abstract' 장을 만들지 않음 (쪽 번호 · 점검표 abstract-chapter)
    // 넣은 뒤에는 대상이 있으니: 다시 만들면 그 끝에 덧붙이고 표지는 다시 붙이지 않음
    const again = abstractPlan(out, 0, 0, "abstract_en");
    assert.deepEqual([again.at, again.append], [out.indexOf("This study summarizes.") + "This study summarizes.".length, true]);
    assert.equal(withAbstractHeading("abstract_en", out, "New.\n\nKeywords: x"), "New.\n\n**Keywords**: x");
    // 영문 초록이 없으니 국문 초록 만들기는 안내 (IMRaD 쪽과 반대)
    assert.match(abstractPlan(KR, 0, 0, "abstract_ko").error, /영문 초록을 찾지 못했어요/);
  });
  test("IMRaD 양식: '**Abstract** — 글' 한 줄 → 국문 초록은 **Keywords** 줄 뒤에 **국문초록**", () => {
    const { p, flat } = put(IM, "abstract_ko", "국문 초록 글.\n\n주제어: 가, 나");
    assert.equal(p.text, "State the problem, approach, key results and implications in 150–250 words.");
    assert.equal(p.at, IM.indexOf("keyword3") + "keyword3".length);
    assert.ok(flat.includes("**Keywords**: keyword1, keyword2, keyword3\n\n**국문초록**\n\n국문 초록 글.\n\n**주제어**: 가, 나\n\n## 1 Introduction"));
    assert.match(abstractPlan(IM, 0, 0, "abstract_en").error, /국문 초록을 찾지 못했어요/);
  });
  test("이미 있는 굵은 줄 대상: 비었으면 그 줄 아래, 본문 강조 · 구조 초록 굵은 글은 표지로 끊지 않음", () => {
    const v = "# 제목\n\n**국문초록**\n\n**목적**: 동기를 본다. **중요한** 점은 이것이다.\n\n**주제어**: 가\n\n**Abstract**\n\n**Keywords**: k\n\n## 1. 서론\n";
    const p = abstractPlan(v, 0, 0, "abstract_en");
    assert.equal(p.text, "**목적**: 동기를 본다. **중요한** 점은 이것이다.");
    assert.deepEqual([p.at, p.append], [v.indexOf("**Abstract**") + "**Abstract**".length, false]);
    assert.equal(withAbstractHeading("abstract_en", v, "Body."), "Body."); // 대상 표지가 있으니 표지를 더 만들지 않음
    assert.equal(findSection(v, ABSTRACT_MODES.abstract_en.dst).kind, "label");
    // 코드 블록 안 굵은 줄은 표지가 아님 · '**Abstract.** 글' (점 붙은 표지) 받음
    assert.equal(findSection("```\n**Abstract**\n\nx\n```\n", ABSTRACT_MODES.abstract_en.dst), null);
    assert.equal(abstractPlan("**Abstract.** We study x.\n\n## 1\n", 0, 0, "abstract_ko").text, "We study x.");
  });
});

describe("코드 검사", () => {
  const src = (f) => readFileSync(new URL(`../../paperlab/static/js/${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  test("패널: AI 글(find · replace · reason · 오류)은 textContent로만 · 모두 고치기 전 버전 기록 · 한 덩어리 편집", () => {
    const ui = src("writeproofui.js");
    assert.match(ui, /\$\("del", li\)\.textContent = it\.find/);
    assert.match(ui, /\$\("ins", li\)\.textContent = it\.replace/);
    assert.match(ui, /\.textContent = at < 0 \? "[^"]+" : it\.reason/);
    assert.match(ui, /\$\("span", f\)\.textContent = `/);
    assert.doesNotMatch(ui, /innerHTML = [^"`]*(it\.|j\.error|reason)/);
    const fixAll = ui.slice(ui.indexOf("const fixAll"), ui.indexOf("pane.addEventListener"));
    assert.ok(fixAll.indexOf("saveVersion(mid, before)") < fixAll.indexOf("applyEdit(ta, diffEdit(before, r.value"));
    assert.match(ui, /const edit = fixEdit\(ta\.value, it\)/); // 고치기 직전에 지금 원고에서 다시 찾음
    // 템플릿 HTML에 esc() 없이 들어가는 값은 숫자 · 단추 이름(고정 글)뿐
    const risky = /\b(find|replace|reason|error|text|label|it|j\.proof|scope|sum)\b/;
    // (textContent에 넣는 템플릿 — 요약 줄 · 실패 줄 · 진행 줄 — 은 HTML이 아니므로 빼고 검사)
    const htmlOnly = ui.slice(0, ui.indexOf("const sum =")) + ui.slice(ui.indexOf('$("[data-pf-sum]"'))
      .split("\n").filter((l) => !/\.textContent = `/.test(l)).join("\n");
    const exprs = templateExprs(htmlOnly);
    assert.ok(exprs.length > 10);
    assert.deepEqual(exprs.filter((e) => risky.test(bare(e))), []);
    assert.ok(!/insertAdjacentHTML|outerHTML\s*=|document\.write/.test(ui));
    assert.match(ui, /api\.post\("\/api\/ai\/proofread"/);
    assert.match(ui, /ensureAiRoute\("write"\)/);
    assert.match(ui, /aria-modal="false"/);
  });
  test("원고 화면 연결: 패널 · 메뉴 · 초록 모드 · 결과 패널 넣기 · 점검표 한 줄", () => {
    const w = src("writing.js");
    assert.match(w, /W\.proof = proofPanel\(view, \{ ta, mid: m\.id/);
    assert.match(w, /if \(W\.proof\) W\.proof\.destroy\(\)/);
    const menu = src("writeaimenu.js"); // AI 도우미 묶음 (2026-10-28 버튼 정리)
    assert.match(menu, /\["abstract_en", "영문 초록 만들기",/);
    assert.match(menu, /\["abstract_ko", "국문 초록 만들기",/);
    assert.match(menu, /\["proof", "맞춤법 · 띄어쓰기", "Alt\+P"\]/);
    assert.match(w, /if \(key === "proof"\) return W\.proof && W\.proof\.open\(\);/);
    assert.match(w, /if \(ABSTRACT_MODES\[mode\]\) \{\n\s+return startAbstract\(mode, ta/);
    assert.match(w, /const resultText = \(j\) => withAbstractHeading\(/);
    assert.match(w, /applyPreview\(ta\.value, j\.write, resultText\(j\)\)/); // 넣기는 원래 패널 경로 그대로
    assert.match(w, /extra: \(\) => W\.proof && W\.proof\.checkLine\(\)/);
    const ck = src("writecheckui.js");
    assert.match(ck, /\$\("\.check-msg", row\)\.textContent = ex\.text/);
    assert.match(ck, /\[data-ck-extra\]/);
    const ab = src("writeproofui.js");
    const start = ab.slice(ab.indexOf("export async function startAbstract"));
    assert.match(start, /api\.post\("\/api\/ai\/write", \{ mode, text: plan\.text/);
    assert.match(start, /writeAnchor\(ta\.value, plan\.at, plan\.at, true\)/);
  });
});
