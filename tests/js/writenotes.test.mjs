// 논문 쓰기 각주: [^이름] · "[^이름]: 내용" 읽기, [각주] 넣기 (docs/specs/export-lists-footnotes.md 4장)
// 실행: node --test tests/js/writenotes.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const wn = await import(pathToFileURL(join(JS, "writenotes.js")).href);
const we = await import(pathToFileURL(join(JS, "writeedit.js")).href);
const { marked } = createRequire(import.meta.url)(join(ROOT, "paperlab", "static", "vendor", "marked.min.js"));
const src = (name) => readFileSync(join(JS, name), "utf8");
const P = (n) => `${wn.FN_OPEN}${n}${wn.FN_CLOSE}`;

// "|" 자리에 커서를 둔 글로 footnoteInsert → 바뀐 글(커서 자리에 "|")
function insert(s) {
  const at = s.indexOf("|");
  const value = s.slice(0, at) + s.slice(at + 1);
  const edit = wn.footnoteInsert(value, at, at);
  if (!edit) return null;
  const out = we.applyEditToValue(value, edit);
  assert.equal(edit.selStart, edit.selEnd);
  return out.slice(0, edit.selStart) + "|" + out.slice(edit.selStart);
}

test("정의 줄은 빠지고 본문 [^이름]은 순서대로 자리표시가 됨 (이름 · 정의 순서와 무관)", () => {
  const r = wn.extractFootnotes("가[^b] 나[^a].\n\n[^a]: 에이 *기울임*\n[^b]: 비\n\n다.");
  assert.equal(r.text, `가${P(0)} 나${P(1)}.\n\n\n다.`);
  assert.deepEqual(r.notes, [{ id: "b", text: "비" }, { id: "a", text: "에이 *기울임*" }]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.unused, []);
});

test("들여쓴 다음 줄은 같은 각주 · 같은 이름을 두 번 쓰면 각주 두 개 · 없는 이름은 글자 그대로", () => {
  const r = wn.extractFootnotes("x[^1] y[^1] z[^없음]\n\n[^1]: 첫 줄\n    둘째 줄\n[^1]: 두 번째 정의는 버림\n  이것도 버림\n[^2]: 안 씀");
  assert.equal(r.text, `x${P(0)} y${P(1)} z[^없음]\n`);
  assert.deepEqual(r.notes.map((n) => n.text), ["첫 줄 둘째 줄", "첫 줄 둘째 줄"]);
  assert.deepEqual(r.missing, ["없음"]);
  assert.deepEqual(r.unused, ["2"]);
});

test("코드 블록 · `코드` · \\[^1] 안은 각주가 아님", () => {
  const v = "```\n[^1]: 코드 안 정의\nx[^1]\n```\n`a[^1]` \\[^1] b[^1]\n\n[^1]: 진짜";
  const r = wn.extractFootnotes(v);
  assert.equal(r.text, `\`\`\`\n[^1]: 코드 안 정의\nx[^1]\n\`\`\`\n\`a[^1]\` \\[^1] b${P(0)}\n`);
  assert.deepEqual(r.notes, [{ id: "1", text: "진짜" }]);
  // marked가 자리표시 글자를 그대로 둔다(미리보기 · 내보내기 런으로 바뀜)
  const toks = marked.lexer(r.text);
  assert.ok(JSON.stringify(toks).includes(wn.FN_OPEN));
  assert.ok(!marked.lexer(r.text).some((t) => t.type === "def")); // 정의 줄이 링크 정의로 읽히지 않음
});

test("splitNotes · nextFootnoteId", () => {
  assert.deepEqual(wn.splitNotes(`앞${P(0)}가운데${P(12)}`), ["앞", { note: 0 }, "가운데", { note: 12 }]);
  assert.deepEqual(wn.splitNotes("각주 없음"), ["각주 없음"]);
  assert.equal(wn.nextFootnoteId("없음"), 1);
  assert.equal(wn.nextFootnoteId("a[^2] b[^note]\n\n[^7]: x"), 8);
});

test("각주 넣기: 커서에 [^N], 지금 장 · 절 끝(다음 제목 앞)에 정의 줄, 커서는 정의 줄로", () => {
  assert.equal(insert("## 제1장 서론\n\n첫 문장|입니다.\n\n둘째 문단.\n\n### 제1절 배경\n\n본문"),
    "## 제1장 서론\n\n첫 문장[^1]입니다.\n\n둘째 문단.\n\n[^1]: |\n\n### 제1절 배경\n\n본문");
  // 이미 정의 줄이 모여 있으면 그 아래 줄에 잇고, 번호는 가장 큰 숫자 + 1
  assert.equal(insert("가[^1] 나|.\n\n[^1]: 하나\n  이어짐\n\n## 다음"),
    "가[^1] 나[^2].\n\n[^1]: 하나\n  이어짐\n[^2]: |\n\n## 다음");
  // 문서 끝
  assert.equal(insert("끝 문장|"), "끝 문장[^1]\n\n[^1]: |");
  // [참고문헌] 자리 앞에
  assert.equal(insert("결론|.\n\n[참고문헌]\n"), "결론[^1].\n\n[^1]: |\n\n[참고문헌]\n");
  // 코드 블록 안의 # 줄은 제목이 아님
  assert.equal(insert("a|\n\n```\n# 코드\n```\n\n## 다음"), "a[^1]\n\n```\n# 코드\n```\n\n[^1]: |\n\n## 다음");
});

test("각주 넣기: 선택이 있으면 선택 끝 뒤에, 코드 블록 · 정의 줄 안에서는 넣지 않음(null)", () => {
  const v = "단어 고르기\n\n## 다음";
  const e = wn.footnoteInsert(v, 0, 2);
  assert.equal(we.applyEditToValue(v, e), "단어[^1] 고르기\n\n[^1]: \n\n## 다음");
  assert.equal(insert("```\nx|\n```"), null);
  assert.equal(insert("본문[^1]\n\n[^1]: 내용|"), null);
  assert.equal(insert("본문[^1]\n\n[^1]: 내용\n  이어|짐"), null);
});

test("넣은 결과를 다시 읽으면 각주 하나 (넣기 ↔ 읽기 규칙이 맞음)", () => {
  let v = "## 제1장\n\n가|나\n\n## 제2장\n\n다";
  v = insert(v).replace("|", "첫 각주");
  const r = wn.extractFootnotes(v);
  assert.deepEqual(r.notes, [{ id: "1", text: "첫 각주" }]);
  assert.equal(r.text, `## 제1장\n\n가${P(0)}나\n\n\n## 제2장\n\n다`);
});

test("단축키 도움말 · 도구 막대: [각주] 버튼 한 줄 · Ctrl+Alt+F · 문법 줄", () => {
  const h = we.shortcutHelp(false);
  assert.ok(h.keys.some((k) => k[1].includes("Ctrl+Alt+F")));
  assert.ok(we.shortcutHelp(true).keys.some((k) => k[1].includes("⌘+⌥+F")));
  assert.ok(h.syntax.some((s) => s[0].includes("[^1]")));
  const w = src("writing.js");
  assert.equal((w.match(/data-footnote title=/g) || []).length, 1);
  assert.match(w, /import \{ extractFootnotes, footnoteInsert, splitNotes \} from "\.\/writenotes\.js"/);
  assert.match(w, /e\.code === "KeyF"\) \{ e\.preventDefault\(\); insertFootnote\(ta\); \}/);
});
