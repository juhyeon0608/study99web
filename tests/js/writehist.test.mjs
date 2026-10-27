// 원고 버전 기록 (docs/specs/manuscript-history.md): 줄 비교 · 화면 줄(접기 · 낱말 차이) · 목록 문구 · 코드 검사
// 실행: node --test tests/js/writehist.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bare, templateExprs } from "./codecheck.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const H = await import(pathToFileURL(join(JS, "writehist.js")).href);
const src = (name) => readFileSync(join(JS, name), "utf8");
const ops = (d) => d.map((o) => `${o.op === "same" ? " " : o.op === "del" ? "-" : "+"}${o.text}`);

test("lineDiff: 같은 글 · 바뀐 줄 · 넣은 줄 · 지운 줄", () => {
  assert.deepEqual(ops(H.lineDiff("a\nb", "a\nb")), [" a", " b"]);
  assert.deepEqual(ops(H.lineDiff("a\nb\nc", "a\nB\nc")), [" a", "-b", "+B", " c"]);
  assert.deepEqual(ops(H.lineDiff("a\nc", "a\nb\nc")), [" a", "+b", " c"]);
  assert.deepEqual(ops(H.lineDiff("a\nb\nc", "a\nc")), [" a", "-b", " c"]);
  assert.deepEqual(ops(H.lineDiff("", "x")), ["-", "+x"]);
  assert.deepEqual(ops(H.lineDiff("a\r\nb", "a\nb")), [" a", " b"]); // 줄바꿈 종류는 같게 봄
});

test("lineDiff: 다시 합칠 수 있음 (그 버전 = same+del, 지금 = same+ins)", () => {
  const a = "# 제목\n\n## 제1장 서론\n문장 하나.\n문장 둘.\n\n## 제2장 방법\n표: 결과\n| a | b |";
  const b = "# 새 제목\n\n## 제1장 서론\n문장 하나.\n새 문장.\n문장 둘.\n\n## 제2장 방법";
  const d = H.lineDiff(a, b);
  assert.equal(d.filter((o) => o.op !== "ins").map((o) => o.text).join("\n"), a);
  assert.equal(d.filter((o) => o.op !== "del").map((o) => o.text).join("\n"), b);
  assert.deepEqual(H.diffStats(d), { removed: 3, added: 2 });
});

test("lineDiff: 가운데가 너무 크면 통째로 지움 · 넣음 (앞뒤 같은 줄은 그대로)", () => {
  const d = H.lineDiff("h\nx1\nx2\nt", "h\ny1\ny2\nt", 4);
  assert.deepEqual(ops(d), [" h", "-x1", "-x2", "+y1", "+y2", " t"]);
});

test("diffRows: 바뀐 곳 앞뒤 2줄만 · 나머지는 접기 · 같은 수의 지움+넣음은 낱말 차이", () => {
  const a = Array.from({ length: 20 }, (_, i) => `줄 ${i}`).join("\n");
  const b = a.replace("줄 10", "줄 열");
  const rows = H.diffRows(H.lineDiff(a, b));
  assert.deepEqual(rows.map((r) => r.op), ["skip", "same", "same", "mod", "same", "same", "skip"]);
  assert.equal(rows[0].n, 8);
  assert.equal(rows[6].n, 7);
  assert.deepEqual(rows[3].parts, [{ op: "same", text: "줄 " }, { op: "del", text: "10" }, { op: "ins", text: "열" }]);
  assert.deepEqual(H.diffRows(H.lineDiff(a, a)), []); // 같으면 없음
  // 지운 줄 수와 넣은 줄 수가 다르면 줄 그대로
  const r2 = H.diffRows(H.lineDiff("a\nb\nc", "a\nX\nY\nc"));
  assert.deepEqual(r2.map((r) => r.op), ["same", "del", "ins", "ins", "same"]);
  // 접는 줄이 없으면 skip 없음 · context 0
  assert.deepEqual(H.diffRows(H.lineDiff("a\nb\nc", "a\nb\nC"), 0).map((r) => r.op), ["skip", "mod"]);
});

test("목록 문구: 종류 · 이름 · 크기 · 시각", () => {
  assert.equal(H.reasonName("auto"), "자동 저장");
  assert.equal(H.reasonName("ai_apply"), "AI 넣기 전");
  assert.equal(H.reasonName("restore"), "되돌리기 전");
  assert.equal(H.reasonName("manual"), "직접 저장");
  assert.equal(H.reasonName("x"), "기록");
  assert.equal(H.versionTitle({ reason: "manual", label: "초고" }), "초고");
  assert.equal(H.versionTitle({ reason: "auto", label: "" }), "자동 저장");
  assert.equal(H.sizeText(0), "0B");
  assert.equal(H.sizeText(1536), "1.5KB");
  assert.equal(H.sizeText(200 * 1024), "200KB");
  assert.equal(H.sizeText(3.5 * 1024 * 1024), "3.5MB");
  assert.equal(H.versionSub({ chars: 12345, size: 30000 }), "12,345자 · 29KB");
  const now = new Date(2026, 9, 17, 15, 0);
  assert.equal(H.timeText(new Date(2026, 9, 17, 14, 5).toISOString(), now), "오늘 14:05");
  assert.equal(H.timeText(new Date(2026, 9, 16, 9, 2).toISOString(), now), "어제 09:02");
  assert.equal(H.timeText(new Date(2026, 9, 3, 23, 59).toISOString(), now), "10월 3일 23:59");
  assert.equal(H.timeText(new Date(2025, 0, 1, 0, 0).toISOString(), now), "2025년 1월 1일 00:00");
  assert.equal(H.timeText("x", now), "");
  // 1월 1일의 '어제'는 지난해 12월 31일
  assert.equal(H.timeText(new Date(2025, 11, 31, 8, 0).toISOString(), new Date(2026, 0, 1, 9, 0)), "어제 08:00");
});

test("코드 검사: writehistui.js의 템플릿 값은 esc()를 거치거나 숫자 · 고정 글만", () => {
  // 원고 글 · 버전 이름 · 오류 문구가 esc() 없이 HTML에 들어가면 실패. 새 식은 검토 뒤 여기에 더한다
  // timeText · versionTitle · reasonName · versionSub · st.*는 textContent · confirmDialog(안에서 esc) 문구에만 쓰임 — 아래 검사
  const allowed = new Set(["E", "`` : \"\"", "\"\" : \"\"", "cls", "inner || \"\"", "Number(r.n).toLocaleString(\"\")",
    "MAX_ROWS.toLocaleString(\"\")", "Number(v.id)", "base", "v.id", "Number(data.every_minutes) || 10", "x.op === \"\" ? \"\" : \"\"",
    "mid", "timeText(v.created_at)", "versionTitle(v)", "reasonName(v.reason)", "versionSub(v)", "st.added", "st.removed"]);
  const w = src("writehistui.js");
  for (const expr of templateExprs(w)) assert.ok(allowed.has(bare(expr).trim()), `writehistui.js: \${${expr}}`);
  // textContent로만 넣는 값(제목 · 보조 줄)과 confirmDialog 문구(esc 처리됨)는 innerHTML에 쓰지 않음
  assert.doesNotMatch(w, /innerHTML\s*=\s*`[^`]*\$\{(timeText|versionTitle|versionSub|reasonName)/);
  assert.match(w, /esc\(r\.text\)/);
  assert.match(w, /esc\(text\)/); // 이 버전 전체
});

test("연결: writing.js는 단추 한 줄 · historyTools · AI 넣기 전 saveVersion, 단축키 도움말에 Alt+H", async () => {
  const w = src("writing.js");
  assert.match(w, /data-history[^\n]*aria-keyshortcuts="Alt\+H"/);
  assert.match(w, /historyTools\(view, \{ mid: m\.id, ta, flush: flushWriter[ ,]/);
  // AI 결과 패널(2026-10-17): [바꾸기](commit) · [커서 위치에 넣기](atCursor) 모두 넣기 전에 버전을 남김
  const commit = w.slice(w.indexOf("const commit = (j, pv) =>"));
  assert.ok(commit.indexOf("saveVersion(") >= 0 && commit.indexOf("saveVersion(") < commit.indexOf("insertText(ta, pv.next)"));
  const atCursor = w.slice(w.indexOf("const atCursor = (j) =>"));
  assert.ok(atCursor.indexOf("saveVersion(") >= 0 && atCursor.indexOf("saveVersion(") < atCursor.indexOf("insertText("));
  const we = await import(pathToFileURL(join(JS, "writeedit.js")).href);
  assert.ok(we.shortcutHelp(false).keys.some((k) => k[1].includes("Alt+H")));
  assert.ok(we.shortcutHelp(true).keys.some((k) => k[1].includes("⌥+H")));
});

test("되돌리기: 화면 글을 current로 보내고(자동 저장 실패 대비) · 창을 닫은 뒤 applyEdit로 바꿈(Ctrl+Z)", () => {
  const h = src("writehistui.js");
  const r = h.slice(h.indexOf('$("[data-restore]", foot).onclick'));
  assert.match(r, /api\.post\(`\$\{base\}\/\$\{v\.id\}\/restore`, \{ current: ta\.value \}\)/);
  assert.ok(r.indexOf("dlg.close()") > 0 && r.indexOf("dlg.close()") < r.indexOf("applyEdit(ta,"));
  assert.doesNotMatch(r, /ta\.value = /);
});
