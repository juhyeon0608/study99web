// AI 도우미 메뉴 묶음 (writeaimenu.js — 2026-10-28 버튼 정리): 묶음 수 · 빠진 방식 없음 · 범위 · 끝맺음 · 지난 선택 · 팔레트 · 화면 연결
// 실행: node --test tests/js/writeaimenu.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const M = await import(pathToFileURL(join(JS, "writeaimenu.js")).href);

const UI_ACTIONS = ["chat", "proof", "source", "cite", "similar", "fig_describe", "fig_content", "fig_edit"];

test("메뉴는 묶음 7개, 예전 메뉴의 방식이 하나도 빠지지 않음", () => {
  assert.equal(M.AI_GROUPS.length, 7);
  const keys = M.AI_GROUPS.flatMap((g) => (g.choices ? g.choices.map((c) => c[0]) : [g.id]));
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ["polish", "academic", "concise", "expand", "to_en", "to_ko", "continue", "draft", "abstract_en", "abstract_ko",
    "matrix", "stats", "memo", "review", "response", "slides", "align", ...UI_ACTIONS]) assert.ok(keys.includes(k), k);
  // 서버 글쓰기 모드에 없는 키는 화면 동작뿐 (paraphrase · journal은 다른 화면에서 부름)
  const py = readFileSync(join(ROOT, "paperlab", "ai.py"), "utf8");
  for (const k of keys) assert.ok(UI_ACTIONS.includes(k) || new RegExp(`"${k}": \\(?"`).test(py) || py.includes(`WRITE_MODES["${k}"]`), k);
});

test("범위는 그 자리에서 바꾸는 방식만, 끝맺음은 한국어로 새로 쓰는 방식만", () => {
  assert.ok(M.SCOPE_MODES.has("concise") && M.SCOPE_MODES.has("to_en"));
  assert.ok(!M.SCOPE_MODES.has("continue") && !M.SCOPE_MODES.has("abstract_en") && !M.SCOPE_MODES.has("matrix"));
  assert.ok(M.ENDING_MODES.has("memo") && M.ENDING_MODES.has("to_ko") && !M.ENDING_MODES.has("to_en"));
});

test("지난번 고른 방식 · 팔레트 한 줄씩 · 그림 패널 없으면 그림 빼기", () => {
  const fix = M.groupById("fix");
  assert.equal(M.initialChoice(fix, "concise"), "concise");
  assert.equal(M.initialChoice(fix, "to_en"), "polish"); // 다른 묶음 것 → 첫 방식
  const all = M.flatChoices({ fig: true });
  assert.ok(all.some((c) => c.label === "글 고치기: 간결하게" && c.key === "concise"));
  assert.ok(all.some((c) => c.key === "chat"));
  assert.ok(!M.flatChoices({}).some((c) => c.group === "figure"));
});

test("화면 연결: 메뉴는 묶음 창, 팔레트는 방식별, 예전 긴 목록 없음", () => {
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.ok(w.includes("aiGroupDialog(g, {") && w.includes("aiPaletteItems(ta)") && w.includes("runAiChoice(r.key, ta)"));
  assert.ok(!w.includes("const AI_MODES") && !w.includes("const TOOL_MENU") && !w.includes("`범위: ${SCOPE_MENU[v]}`"));
  const f = readFileSync(join(JS, "writefigui.js"), "utf8");
  for (const k of ["fig_describe", "fig_content", "fig_edit"]) assert.ok(f.includes(`key: "${k}"`), k);
});
