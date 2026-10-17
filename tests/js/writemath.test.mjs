// 논문 쓰기 수식 (writemath.js — 2026-10-17): 줄 수식 읽기 · 문장 안 수식 자리표시 · 내보내기 글자 바꾸기 · 식 참조
// 실행: node --test tests/js/writemath.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const JS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "paperlab", "static", "js");
const wm = await import(pathToFileURL(join(JS, "writemath.js")).href);
const we = await import(pathToFileURL(join(JS, "writeedit.js")).href);

test("줄 수식: 한 문단 전체 $$ … $$ (여러 줄) + 꼬리표 {#eq:이름}", () => {
  assert.deepEqual(wm.equationInfo("$$ E = mc^2 $$ {#eq:energy}"), { tex: "E = mc^2", label: "eq:energy" });
  assert.deepEqual(wm.equationInfo("$$\n\\frac{a}{b}\n$$"), { tex: "\\frac{a}{b}", label: "" });
  assert.equal(wm.equationInfo("문장 $$x$$ 안"), null);
  assert.equal(wm.equationInfo("$$  $$"), null);
});

test("문장 안 수식 $…$ 자리표시 · 금액($5)과 줄 수식 · 코드 블록은 그대로", () => {
  const { text, maths } = wm.protectInlineMath("값 $x_1$ 과 $\\alpha$, 금액 $5 와 $10.\n$$ y $$\n```\necho $HOME $PATH\n```");
  assert.deepEqual(maths, ["x_1", "\\alpha"]);
  assert.match(text, /금액 \$5 와 \$10\./);
  assert.match(text, /\$\$ y \$\$/);
  assert.match(text, /echo \$HOME \$PATH/);
  assert.equal(text.split(wm.MATH_MARK_RE).filter((_, i) => i % 2).length, 2);
});

test("내보내기용 글자: 아래 · 위 첨자 · 그리스 문자 · 기호 · 분수", () => {
  assert.equal(wm.texToText("x_1 + \\alpha \\leq y^2"), "x₁ + α ≤ y²");
  assert.equal(wm.texToText("\\frac{a}{b} \\times 10^{-3}"), "(a)/(b) × 10⁻³");
  assert.equal(wm.texToText("x_{max}"), "x_(max)");
});

test("식 참조 @eq:이름 → '식 (1)' · '식 (2-1)'", () => {
  assert.deepEqual(we.splitXrefs("보면 @eq:energy 처럼"), ["보면 ", { xref: "eq:energy" }, " 처럼"]);
  assert.equal(we.xrefText("eq", 1, true), "식 (1)");
  assert.equal(we.xrefText("eq", "2-1", false), "Eq. (2-1)");
});
