// 명령 팔레트 (palette.js — 2026-10-28): 초성 · 이름 · 설명 찾기 · 순서 · 최근 · 명령 내놓기 · 화면 연결
// 실행: node --test tests/js/palette.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const P = await import(pathToFileURL(join(JS, "palette.js")).href);
const CMDS = [
  { label: "맞춤법 · 띄어쓰기 점검…", sub: "Alt+P" }, { label: "점검", sub: "제출 전 점검" }, { label: "내보내기: 워드 (.docx)", group: "내보내기" },
  { label: "AI 모의 심사…", sub: "원고 전체 · 예상 질문" }, { label: "표 넣기 · 고치기" }, { label: "집중", sub: "집중 모드" },
];
const labels = (q, recent) => P.rankCommands(q, CMDS, recent).map((c) => c.label);

test("초성 · 이름 · 띄어쓰기 무시 · 흩어진 글자", () => {
  assert.equal(P.chosung("맞춤법 A"), "ㅁㅊㅂ A");
  assert.equal(labels("ㅁㅊㅂ")[0], "맞춤법 · 띄어쓰기 점검…");
  assert.equal(labels("워드")[0], "내보내기: 워드 (.docx)");
  assert.equal(labels("모의심사")[0], "AI 모의 심사…");
  assert.deepEqual(labels("표넣"), ["표 넣기 · 고치기"]);
  assert.deepEqual(labels("없는기능"), []);
});

test("앞에서 맞는 이름 먼저 · 설명으로도 찾음 · 같은 점수면 최근 쓴 것", () => {
  assert.deepEqual(labels("점검").slice(0, 2), ["점검", "맞춤법 · 띄어쓰기 점검…"]);
  assert.ok(labels("예상 질문").includes("AI 모의 심사…"));
  const a = labels("ㅈ");
  const b = labels("ㅈ", ["집중"]);
  assert.ok(b.indexOf("집중") <= a.indexOf("집중"));
  assert.equal(P.matchScore("", CMDS[0]), 0);
});

test("명령 내놓기 · 빼기 (다른 함수로 바뀌었으면 그대로)", () => {
  const off = P.registerCommands("t", () => []);
  const off2 = P.registerCommands("t", () => [1]);
  off(); // 이미 바뀜 — 지우지 않음
  off2();
  assert.equal(typeof P.openPalette, "function");
});

test("화면 연결: Ctrl+K · 사이드바 버튼 · 원고 명령(도구 막대 · AI · 내보내기 · 개요) · 닫을 때 빼기 · 단축키 도움말", () => {
  const app = readFileSync(join(JS, "app.js"), "utf8");
  assert.match(app, /e\.code === "KeyK"\)\) \{\n\s+e\.preventDefault\(\);\n\s+openPalette\(\);/);
  assert.match(app, /\$\("#open-palette"\)\.onclick = \(\) => openPalette\(\)/);
  const w = readFileSync(join(JS, "writing.js"), "utf8");
  assert.match(w, /registerCommands\("writer"/);
  assert.match(w, /for \(const it of aiPaletteItems\(ta\)\)/); // AI는 방식마다 한 줄 (writeaimenu.js flatChoices)
  assert.match(w, /for \(const it of exportItems\(view, ta\)\)/);
  assert.match(w, /if \(W\.palette\) W\.palette\(\);/);
  assert.match(readFileSync(join(JS, "writeedit.js"), "utf8"), /명령 팔레트/);
  assert.match(readFileSync(join(ROOT, "paperlab", "static", "index.html"), "utf8"), /id="open-palette"/);
});
