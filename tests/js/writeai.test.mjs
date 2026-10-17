// AI 글쓰기 결과 넣기 (2026-10-16 백그라운드 AI — writeai.js): 원고 지문 · 넣을 자리 다시 찾기 · 바뀌는 부분 — 순수 함수만 ·
// AI 결과 패널(2026-10-17 — 모달 대신 편집기 옆에 붙는 패널) 상태 · 단추 · 단축키 · 코드 검사
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AI_PANE_KEY, RESULT_STATE_TEXT, applyPreview, browserStorage, diffHtml, docHash, insertionText, isAiPaneKey, loadPaneOpen, origSnippet,
  paneActions, paneKeyAction, paneList, pickResult, planApply, rerunPlan, resultState, resultsButtonText, savePaneOpen, trimRange, wordDiff,
  writeAnchor,
} from "../../paperlab/static/js/writeai.js";
import { shortcutHelp } from "../../paperlab/static/js/writeedit.js";

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


// ------------------------------------------------------------------ AI 결과 패널 (2026-10-17 사용자 요청: 결과를 보면서 글쓰기)
const T = (min) => `2026-10-17T0${min}:00:00Z`;
const wj = (o = {}) => ({ id: 1, kind: "write", status: "succeeded", manuscript_id: 7, created_at: T(1), result: { text: "결과 글" },
  write: { mode: "polish", insert: false, handled: null }, ...o });

describe("패널 상태 · 목록", () => {
  test("결과 하나의 상태: 만드는 중 · 넣기 전 · 넣음 · 넣지 않음 · 실패 · 취소 · 지워짐", () => {
    assert.equal(resultState(wj({ status: "queued" })), "running");
    assert.equal(resultState(wj({ status: "running" })), "running");
    assert.equal(resultState(wj()), "ready");
    assert.equal(resultState(wj({ write: { handled: "applied" } })), "applied");
    assert.equal(resultState(wj({ write: { handled: "dismissed" } })), "dismissed");
    assert.equal(resultState(wj({ status: "failed" })), "failed");
    assert.equal(resultState(wj({ status: "cancelled" })), "cancelled");
    assert.equal(resultState(wj({ result: null })), "expired"); // 7일이 지나 결과 글이 지워짐
    assert.equal(resultState(null), "missing");
    for (const st of ["running", "ready", "applied", "dismissed", "failed", "cancelled", "expired", "missing"]) assert.ok(RESULT_STATE_TEXT[st], st);
  });
  test("목록은 새것이 위 · 글쓰기 작업만 · 넣기 전 / 만드는 중 수", () => {
    const l = paneList([
      wj({ id: 1, created_at: T(1) }), wj({ id: 3, created_at: T(3), status: "running" }), wj({ id: 2, created_at: T(2), write: { handled: "applied" } }),
      { id: 9, kind: "verify", status: "running", created_at: T(9) }, null,
    ]);
    assert.deepEqual(l.items.map((j) => j.id), [3, 2, 1]);
    assert.deepEqual([l.ready, l.active], [1, 1]);
    assert.deepEqual(paneList(undefined), { items: [], ready: 0, active: 0 });
  });
  test("도구 막대 단추 글 (누르면 모달이 아니라 패널)", () => {
    assert.equal(resultsButtonText(), "AI 결과");
    assert.equal(resultsButtonText({ ready: 2 }), "AI 결과 2");
    assert.equal(resultsButtonText({ ready: 2, active: 1 }), "AI 결과 2 · 만드는 중 1");
    assert.equal(resultsButtonText({ active: 1 }), "AI 결과 · 만드는 중 1");
  });
  test("패널이 보여 줄 결과: 고른 것 유지, 없으면 만드는 중 → 넣기 전 → 가장 새것", () => {
    const items = paneList([wj({ id: 1, created_at: T(1) }), wj({ id: 2, created_at: T(2), write: { handled: "applied" } }),
      wj({ id: 3, created_at: T(3), status: "failed" })]).items;
    assert.equal(pickResult(items, 2), 2);
    assert.equal(pickResult(items, 99), 1); // 고른 것이 없어짐 → 넣기 전
    assert.equal(pickResult([...items, wj({ id: 4, status: "running" })], null), 4);
    assert.equal(pickResult(items.filter((j) => j.id !== 1), null), 3); // 가장 새것
    assert.equal(pickResult([], 5), null);
  });
  test("단추: 만드는 중엔 [취소]만, 결과가 있으면 넣기 · 커서 · 복사 · 다시 실행, 다른 원고면 넣지 못함", () => {
    const run = paneActions(wj({ status: "running" }));
    assert.deepEqual([run.apply, run.cursor, run.copy, run.rerun, run.cancel], [false, false, false, false, true]);
    const ok = paneActions(wj());
    assert.deepEqual([ok.apply, ok.cursor, ok.copy, ok.rerun, ok.cancel, ok.dismiss, ok.applyLabel], [true, true, true, true, false, true, "바꾸기"]);
    assert.equal(paneActions(wj({ write: { insert: true } })).applyLabel, "넣기");
    const done = paneActions(wj({ write: { handled: "applied" } }));
    assert.deepEqual([done.apply, done.dismiss], [true, false]); // 넣은 결과도 다시 넣을 수 있음(자리를 다시 찾음)
    const other = paneActions(wj(), { here: false });
    assert.deepEqual([other.apply, other.cursor, other.copy, other.rerun], [false, false, true, false]);
    const failed = paneActions(wj({ status: "failed" }));
    assert.deepEqual([failed.apply, failed.copy, failed.rerun], [false, false, true]);
  });
  test("원래 글 짧은 모양: 공백 정리 · 길면 자름 · 넣기는 앞 글 끝", () => {
    assert.equal(origSnippet({ text: "  가  나\n\n다 " }), "가 나 다");
    assert.equal(origSnippet({ text: "가".repeat(300) }, 10), `${"가".repeat(9)}…`);
    assert.equal(origSnippet({ insert: true, before: "앞 문단\n끝 글" }), "…앞 문단 끝 글");
    assert.equal(origSnippet({ insert: true, before: "" }), "");
    assert.equal(origSnippet(null), "");
  });
  test("[다시 실행]: 실패 · 취소는 서버 다시 시도, 끝난 결과는 지금 원고의 같은 자리로 새 작업, 못 찾으면 lost", () => {
    assert.deepEqual(rerunPlan(wj({ status: "failed" }), DOC), { how: "retry" });
    assert.deepEqual(rerunPlan(wj({ status: "cancelled" }), DOC), { how: "retry" });
    assert.deepEqual(rerunPlan(wj({ status: "running" }), DOC), { how: "none" });
    const w = { ...job(), mode: "academic" };
    const cur = "앞에 새 문단\n\n" + DOC;
    const p = rerunPlan(wj({ write: w }), cur);
    assert.equal(p.how, "new");
    assert.equal(p.mode, "academic");
    assert.equal(cur.slice(p.from, p.to), SEL);
    assert.deepEqual(rerunPlan(wj({ write: w }), DOC.replace(SEL, "")), { how: "lost" });
  });
});

describe("패널에서 넣기 (몰래 덮어쓰지 않음 — 확인은 패널 안에서)", () => {
  test("원고 그대로: same — 바로 넣음", () => {
    const pv = applyPreview(DOC, job(), "  고친 글  ");
    assert.equal(pv.state, "same");
    assert.equal(pv.next, "고친 글");
    assert.equal(DOC.slice(0, pv.from) + pv.next + DOC.slice(pv.to), DOC.replace(SEL, "고친 글"));
  });
  test("원고가 바뀜: moved — 바뀌는 부분(낱말 차이) · 앞뒤 문맥을 보여 줌", () => {
    const cur = "머리말\n\n" + DOC;
    const pv = applyPreview(cur, job(), "이 연구는 매우 중요하다.");
    assert.equal(pv.state, "moved");
    assert.equal(pv.seg.filter((x) => x.op !== "ins").map((x) => x.text).join(""), SEL);
    assert.equal(pv.seg.filter((x) => x.op !== "del").map((x) => x.text).join(""), "이 연구는 매우 중요하다.");
    assert.ok(cur.slice(0, pv.from).endsWith(pv.before) && pv.before.length > 0 && pv.before.length <= 120);
    assert.ok(cur.slice(pv.to).startsWith(pv.after));
  });
  test("넣기(이어 쓰기 · 초안): 넣는 글 전체가 ins", () => {
    const pos = DOC.indexOf("## 2.");
    const w = job({ insert: true, text: "", sel_start: pos, sel_end: pos, before: DOC.slice(pos - 30, pos) });
    const pv = applyPreview("앞\n" + DOC, w, "이어 쓴 글");
    assert.equal(pv.state, "moved");
    assert.deepEqual(pv.seg, [{ op: "ins", text: pv.next }]);
    assert.ok(pv.next.includes("이어 쓴 글"));
  });
  test("자리를 못 찾음: lost — 넣을 글 없음(자동으로 넣지 않음)", () => {
    const pv = applyPreview(DOC.replace(SEL, "완전히 새 글"), job(), "결과");
    assert.deepEqual([pv.state, pv.next, pv.seg], ["lost", "", []]);
  });
  test("바뀌는 부분 HTML은 글을 모두 이스케이프", () => {
    const h = diffHtml([{ op: "same", text: "<b>a</b> " }, { op: "del", text: "\"x\" & y" }, { op: "ins", text: "<script>" }]);
    assert.equal(h, "&lt;b&gt;a&lt;/b&gt; <del>&quot;x&quot; &amp; y</del><ins>&lt;script&gt;</ins>");
    assert.equal(diffHtml(null), "");
  });
});

describe("패널 열림 기억 · 단축키", () => {
  const mem = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
  };
  test("열림 · 닫힘을 이 브라우저에 기억 (값이 깨졌거나 저장소가 막혀도 오류 없이 닫힘)", () => {
    const s = mem();
    assert.equal(loadPaneOpen(s), false);
    savePaneOpen(s, true);
    assert.equal(s.m.get(AI_PANE_KEY), JSON.stringify({ open: true }));
    assert.equal(loadPaneOpen(s), true);
    savePaneOpen(s, false);
    assert.equal(loadPaneOpen(s), false);
    s.setItem(AI_PANE_KEY, "{깨진");
    assert.equal(loadPaneOpen(s), false);
    s.setItem(AI_PANE_KEY, "true");
    assert.equal(loadPaneOpen(s), false);
    const blocked = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceeded"); } };
    assert.equal(loadPaneOpen(blocked), false);
    assert.doesNotThrow(() => savePaneOpen(blocked, true));
    assert.equal(loadPaneOpen(null), false);
    assert.doesNotThrow(() => savePaneOpen(undefined, true));
  });
  test("localStorage를 읽기만 해도 오류인 환경 → null", () => {
    const d = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
    try { assert.equal(browserStorage(), null); } finally {
      if (d) Object.defineProperty(globalThis, "localStorage", d); else delete globalThis.localStorage;
    }
  });
  test("Alt+A = 열기 · 닫기, Esc = 패널 안에 초점이 있을 때만 닫기, 창이 떠 있으면 아무것도 안 함", () => {
    const k = (o) => ({ code: "", key: "", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, repeat: false, ...o });
    assert.equal(isAiPaneKey(k({ code: "KeyA", key: "å", altKey: true })), true); // macOS Option+A
    assert.equal(isAiPaneKey(k({ code: "KeyA", altKey: true, ctrlKey: true })), false);
    assert.equal(isAiPaneKey(k({ code: "KeyA", altKey: true, repeat: true })), false);
    assert.equal(isAiPaneKey(k({ code: "KeyA" })), false);
    assert.equal(paneKeyAction(k({ code: "KeyA", altKey: true })), "toggle");
    assert.equal(paneKeyAction(k({ code: "KeyA", altKey: true }), { open: true, inside: true }), "toggle");
    assert.equal(paneKeyAction(k({ code: "KeyA", altKey: true }), { modal: true }), null);
    assert.equal(paneKeyAction(k({ key: "Escape" }), { open: true, inside: true }), "close");
    assert.equal(paneKeyAction(k({ key: "Escape" }), { open: true, inside: false }), null); // 편집기에서 Esc는 패널을 닫지 않음
    assert.equal(paneKeyAction(k({ key: "Escape" }), { open: false, inside: true }), null);
    assert.equal(paneKeyAction(k({ key: "Escape" }), { open: true, inside: true, modal: true }), null);
    assert.equal(paneKeyAction(null), null);
  });
  test("단축키 도움말에 AI 결과 패널 (Alt+A · Esc)", () => {
    const row = shortcutHelp(false).keys.find((r) => r[0].includes("AI 결과 패널 열기"));
    assert.ok(row, "AI 결과 패널 줄");
    assert.equal(row[1], "Alt+A");
    assert.ok(shortcutHelp(false).keys.some((r) => r[0].includes("AI 결과 패널 닫기") && r[1] === "Esc"));
    assert.ok(shortcutHelp(true).keys.some((r) => r[0].includes("AI 결과 패널 열기") && r[1] === "⌥+A"));
  });
});

describe("코드 검사", () => {
  const src = (f) => readFileSync(new URL(`../../paperlab/static/js/${f}`, import.meta.url), "utf8");
  const fn = (s, name, next) => {
    const a = s.indexOf(name);
    assert.ok(a >= 0, name);
    return s.slice(a, next ? s.indexOf(next, a) : undefined);
  };
  test("글쓰기 도우미는 SSE가 아니라 작업 — 패널을 닫아도 취소하지 않음", () => {
    const w = src("writing.js");
    assert.doesNotMatch(w, /streamEvents\("\/api\/ai\/write"/);
    assert.match(w, /api\.post\("\/api\/ai\/write"/);
    const pane = fn(w, "function aiPane(", "async function openAiJobFromHash");
    const setOpen = fn(pane, "const setOpen =", "const show =");
    assert.doesNotMatch(setOpen, /cancelJob/); // 닫기는 따라가기만 멈춤
    assert.match(setOpen, /stopWatch\(\)/);
  });
  test("AI 결과는 모달이 아니라 패널: 결과 창 · 확인 창 함수가 없고 패널 · 실행 · 알림 열기에서 modal을 쓰지 않음", () => {
    const w = src("writing.js");
    for (const gone of ["function aiJobDialog", "function aiDiffDialog", "function aiLostDialog", "function aiResultsBar"]) {
      assert.ok(!w.includes(gone), gone);
    }
    const pane = fn(w, "function aiPane(", "function draftDialog");
    assert.doesNotMatch(pane, /\bmodal\(|confirmDialog\(|popupMenu\(/);
    const run = fn(w, "async function runAi(", "// ------------------------------------------------------------------ AI 결과 패널");
    assert.match(run, /W\.ai\.show\(job, \{ fresh: true \}\)/);
    assert.doesNotMatch(run.slice(run.indexOf("trackJob(job)")), /modal\(/);
    assert.match(fn(w, "async function openAiJobFromHash", "function draftDialog"), /W\.ai\.show\(job\)/);
    // 원고 화면 틀: 오른쪽 칸(aside#ai-pane)과 도구 막대 단추(Alt+A 표시)
    assert.match(w, /<aside class="panel ai-pane" id="ai-pane" aria-label="AI 결과 패널"><\/aside>/);
    assert.match(w, /data-ai-results aria-pressed="false" aria-controls="ai-pane" aria-keyshortcuts="Alt\+A"\s+title="AI 결과 패널 \(Alt\+A\)/);
    assert.match(pane, /data-ai-close title="[^"]*\(Alt\+A\)/);
    // 알림 [열기] · 작업 화면 [원고에 넣기]: 같은 원고면 이 패널에서
    assert.match(pane, /addEventListener\("paperlab:open-job", onOpenJob\)/);
    assert.match(fn(pane, "const onOpenJob", "window.addEventListener"), /show\(j\)/);
  });
  test("패널 넣기: 원고가 바뀌었으면 패널 안에서 확인, 확인하는 동안 또 바뀌면 다시 확인 · 넣은 뒤 handled", () => {
    const pane = fn(src("writing.js"), "function aiPane(", "async function openAiJobFromHash");
    const apply = fn(pane, "const doApply =", "const atCursor =");
    assert.match(apply, /applyPreview\(ta\.value, j\.write, resultText\(j\)\)/);
    assert.match(apply, /if \(pv\.state === "same"\) return commit\(j, pv\)/);
    assert.match(apply, /if \(ta\.value !== c\.cur\)/);
    assert.match(pane, /api\.post\(`\/api\/jobs\/\$\{j\.id\}\/handled`, \{ state: "applied" \}\)/);
    assert.match(pane, /api\.post\(`\/api\/jobs\/\$\{j\.id\}\/handled`, \{ state: "dismissed" \}\)/);
    assert.match(pane, /savePaneOpen\(browserStorage\(\), open\)/);
    assert.match(pane, /loadPaneOpen\(browserStorage\(\)\)/);
    assert.match(pane, /paneKeyAction\(e, \{ open: S\.open, inside: aside\.contains\(document\.activeElement\), modal: modalOpen\(\) \}\)/);
  });
  test("패널 HTML: 사용자 · AI 글은 esc · textContent · diffHtml(이스케이프) · purifyMd로만", () => {
    const pane = fn(src("writing.js"), "function aiPane(", "async function openAiJobFromHash");
    assert.match(pane, /\$\("\.ai-orig", o\)\.textContent = snip/);
    assert.match(pane, /esc\(c\.pv\.before\)/);
    assert.match(pane, /esc\(c\.pv\.after\)/);
    assert.match(pane, /diffHtml\(c\.pv\.seg\)/);
    assert.match(pane, /purifyMd\(window\.marked\.parse\(result\)\)/);
    assert.match(pane, /out\.textContent = partial/);
    assert.doesNotMatch(pane, /innerHTML = partial|innerHTML = result\b/);
  });
  test("CSS: 패널은 격자 칸(겹쳐 뜨는 창이 아님) · 좁은 폭 규칙 · 단추 줄바꿈", () => {
    const css = readFileSync(new URL("../../paperlab/static/css/app.css", import.meta.url), "utf8");
    const part = css.slice(css.indexOf("논문 쓰기 AI 결과 패널"));
    assert.match(part, /\.writer\[data-ai-pane="open"\] \.ai-pane \{ display: flex; \}/);
    assert.doesNotMatch(part.slice(0, part.indexOf(".writer-tools [data-ai-results]")), /position: (fixed|absolute)/);
    assert.match(part, /@media \(max-width: 1500px\)/);
    assert.match(part, /\.ai-actions \{ display: flex; flex-wrap: wrap;/);
  });
});
