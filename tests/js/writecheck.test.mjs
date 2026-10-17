// 논문 쓰기 제출 전 점검표: 양식(표지 · 분량 · 장 순서 · 초록) · 번호(장 · 절 · 그림 · 표 · 참조) · 인용 · 글 다듬기
// (docs/specs/writing-checklist.md)
// 실행: node --test tests/js/writecheck.test.mjs   (pytest 래퍼: tests/test_js_node.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bare, templateExprs } from "./codecheck.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const ck = await import(pathToFileURL(join(JS, "writecheck.js")).href);
const we = await import(pathToFileURL(join(JS, "writeedit.js")).href);
const { marked } = createRequire(import.meta.url)(join(ROOT, "paperlab", "static", "vendor", "marked.min.js"));
const src = (name) => readFileSync(join(JS, name), "utf8");

const FIG = "0123456789abcdef.png";
// 대체 보고서 양식 값 (doc_formats.py _REPORT 중 분량 추정에 쓰는 것)
const REPORT = {
  page: { width_mm: 210, height_mm: 297, margin_mm: { top: 40, bottom: 40, left: 30, right: 30 }, header_mm: 15, footer_mm: 15, gutter_mm: 0 },
  body: { size_pt: 11, line_spacing_pct: 180 }, title: { show: false, size_pt: 16 },
  headings: { 1: { size_pt: 16, page_break_before: true, space_after_pt: 12 }, 2: { size_pt: 14, space_before_pt: 12, space_after_pt: 6 }, 3: { size_pt: 11 } },
  bibliography: { size_pt: 11, line_spacing_pct: 180, new_page: true }, page_number: { show: true, start: "first_chapter" },
};
const FULL_COVER = { title_en: "A Study", name: "김인하", department: "제조혁신학과", graduation: "2027-02", degree_field: "공학",
  advisors: ["이교수"], committee: ["가", "나", "다"] };
const codes = (r) => r.items.map((x) => x.code);
const find = (r, code) => r.items.find((x) => x.code === code);
const run = (text, opts = {}) => ck.checkManuscript(text, { lexer: marked.lexer, ...opts });
// 장 다섯 개 · 문단마다 500자 → 약 30쪽(대체 보고서 양식)
function longDoc(paras = 12) {
  let t = "# 연구\n\n";
  const names = ["서론", "이론적 배경", "연구 방법", "연구 결과", "결론"];
  names.forEach((n, i) => {
    t += `## 제${i + 1}장 ${n}\n\n`;
    for (let p = 0; p < paras; p++) t += `${"가".repeat(250)} 이다 [@kim2020]. ${"나".repeat(240)}\n\n`;
  });
  return `${t}[참고문헌]\n`;
}

test("양식: 표지 빈 칸(○○○로 들어감)은 꼭 고칠 것 + [표지 정보], 심사위원 빈 칸은 확인 권장", () => {
  const t = longDoc();
  let r = run(t, { coverKind: "thesis", cover: { name: "김인하" }, format: REPORT });
  const c = find(r, "cover-missing");
  assert.equal(c.sev, "must");
  assert.equal(c.action, "cover");
  for (const w of ["영문 제목", "학과", "졸업 연월", "학위명", "지도교수"]) assert.ok(c.msg.includes(w), w);
  assert.ok(!c.msg.includes("국문 제목"), "# 제목이 있으면 국문 제목은 그것으로 채워짐");
  assert.equal(find(r, "cover-committee").sev, "warn");
  // 대체 보고서는 학위명이 없음 · 박사 학위논문은 심사위원 5명
  r = run(t, { coverKind: "report", cover: { ...FULL_COVER, degree_field: "" }, format: REPORT });
  assert.ok(!codes(r).includes("cover-missing"));
  r = run(t, { coverKind: "thesis", cover: { ...FULL_COVER, degree: "doctor" }, format: REPORT });
  assert.match(find(r, "cover-committee").msg, /2칸/);
  // 속표지를 빼면 지도교수는 묻지 않음, 인정서를 빼면 심사위원도
  r = run(t, { coverKind: "thesis", cover: { ...FULL_COVER, advisors: [], committee: [], include: { inner: false, approval: false } }, format: REPORT });
  assert.ok(!codes(r).includes("cover-missing"));
  assert.ok(!codes(r).includes("cover-committee"));
  // 표지 없는 양식은 표지 점검 없음
  r = run("# 제목\n\n본문", { coverKind: "none" });
  assert.ok(!codes(r).some((x) => x.startsWith("cover")));
});

test("양식: 대체 보고서 30쪽 미만은 꼭 고칠 것(추정이라고 말함), 30쪽 넘으면 없음", () => {
  const short = run(longDoc(4), { coverKind: "report", cover: FULL_COVER, format: REPORT });
  const p = find(short, "min-pages");
  assert.equal(p.sev, "must");
  assert.match(p.msg, /30쪽 이상/);
  assert.match(p.msg, /어림/);
  assert.equal(p.from, null);
  const long = run(longDoc(14), { coverKind: "report", cover: FULL_COVER, format: REPORT });
  assert.ok(!codes(long).includes("min-pages"), `pages=${long.stats.pages}`);
  assert.ok(long.stats.pages >= 30);
  // 학위논문은 분량 규칙 없음
  assert.ok(!codes(run(longDoc(4), { coverKind: "thesis", cover: FULL_COVER, format: REPORT })).includes("min-pages"));
});

test("분량 추정: 글이 늘면 쪽도 늘고, 장 새 쪽 · 그림이 쪽을 더함, 양식 값이 없으면 A4 기본", () => {
  const a = ck.estimatePages("가".repeat(1000), REPORT).pages;
  const b = ck.estimatePages("가".repeat(20000), REPORT).pages;
  assert.ok(a >= 1 && b > a);
  const one = ck.estimatePages("## 제1장 가\n\n본문\n\n## 제2장 나\n\n본문", REPORT).pages;
  assert.equal(one, 2, "장마다 새 쪽");
  const figs = ck.estimatePages(Array.from({ length: 5 }, () => `![x](fig:${FIG})`).join("\n\n"), REPORT).pages;
  assert.equal(figs, 2, "그림 = 쪽의 1/3");
  assert.ok(ck.estimatePages("가".repeat(5000), null).pages >= 1);
  assert.equal(ck.estimateLines("", 11, 400), 0);
  assert.equal(ck.estimateLines("가".repeat(10), 10, 100), 1);
  assert.equal(ck.estimateLines("가".repeat(11), 10, 100), 2);
});

test("양식: 장 순서(서론 … 결론) · 장 없음 · 참고문헌 뒤 본문 장 · 인용 없음", () => {
  const base = { coverKind: "report", cover: FULL_COVER, format: REPORT };
  let r = run("# 제목\n\n## 제1장 배경\n\n글 [@a]\n\n## 제2장 결과\n\n글\n\n[참고문헌]\n", base);
  assert.equal(find(r, "order-intro").sev, "warn");
  assert.equal(find(r, "order-conclusion").sev, "warn");
  r = run("# 제목\n\n## 국문초록\n\n요약\n\n## 제1장 서론\n\n글 [@a]\n\n## 제2장 결론\n\n글\n\n[참고문헌]\n\n## 부록\n\n표\n", base);
  assert.ok(!codes(r).some((c) => c.startsWith("order")), codes(r).join());
  r = run("# 제목\n\n## 제1장 서론\n\n글 [@a]\n\n[참고문헌]\n\n## 제2장 결론\n\n글\n", base);
  assert.ok(find(r, "order-bib"));
  r = run("# 제목\n\n본문만", base);
  assert.equal(find(r, "no-chapters").sev, "must");
  assert.equal(find(r, "no-references").sev, "must");
  // 기본 양식은 장 순서를 보지 않음
  assert.ok(!codes(run("## 배경\n\n글\n\n## 결과\n\n글")).some((c) => c.startsWith("order") || c === "no-references"));
});

test("양식: 학위논문 초록(국문 · 영문), 초록을 ## 장으로 쓰면 쪽 번호 안내", () => {
  const base = { coverKind: "thesis", cover: FULL_COVER, format: REPORT };
  let r = run("# 제목\n\n## 제1장 서론\n\n글 [@a]\n\n## 제2장 결론\n\n글\n\n[참고문헌]\n", base);
  assert.ok(find(r, "abstract-ko") && find(r, "abstract-en"));
  r = run("# 제목\n\n**국문초록**\n\n요약\n\n**Abstract**\n\nSummary\n\n## 제1장 서론\n\n글 [@a]\n\n### 제1절 연구 결과 요약\n\n글\n\n## 제2장 결론\n\n글\n\n[참고문헌]\n", base);
  assert.ok(!codes(r).some((c) => c.startsWith("abstract")), codes(r).join());
  r = run("# 제목\n\n### 제1절 연구 결과 요약\n\n글", base);
  assert.ok(find(r, "abstract-ko"), "'연구 결과 요약' 절은 초록이 아님");
  r = run("# 제목\n\n## 국문초록\n\n요약\n\n## Abstract\n\nx\n\n## 제1장 서론\n\n글 [@a]\n\n## 제2장 결론\n\n글\n\n[참고문헌]\n", base);
  assert.equal(find(r, "abstract-chapter").sev, "warn");
  assert.ok(!find(r, "abstract-ko"));
});

test("번호: 제N장 · 제N절 차례가 틀리면 꼭 고칠 것 + [번호 다시 매기기] — 고친 뒤에는 없음", () => {
  const t = "# 논문\n\n## 제1장 서론\n\n### 제1절 가\n\n글\n\n### 제3절 나\n\n글\n\n## 제3장 본론\n\n### 제2절 다\n\n글\n\n## 제3장 결론\n\n글";
  const r = run(t);
  const ch = r.items.filter((x) => x.code === "chapter-number");
  const sec = r.items.filter((x) => x.code === "section-number");
  assert.equal(ch.length, 1);
  assert.equal(sec.length, 2);
  assert.ok([...ch, ...sec].every((x) => x.sev === "must" && x.action === "renumber"));
  assert.equal(t.slice(ch[0].from, ch[0].to), "## 제3장 본론");
  const fixed = ck.renumberHeadings(t);
  assert.ok(!codes(run(fixed)).some((c) => c.endsWith("-number")));
  // "1. 서론" · "1.1" 꼴도 차례를 봄 (자동 고치기 없음)
  const n = run("## 1. 서론\n\n글\n\n### 1.1 배경\n\n글\n\n### 1.3 목적\n\n글\n\n## 3. 결론\n\n글");
  assert.equal(n.items.filter((x) => x.code === "section-number").length, 1);
  assert.equal(find(n, "chapter-number").action, undefined);
  // 장 없이 시작한 절
  assert.ok(find(run("### 제1절 가\n\n글"), "section-orphan"));
  // 코드 블록 안의 # 줄은 제목이 아님
  assert.ok(!codes(run("## 제1장 서론\n\n```\n## 제5장 x\n```\n")).includes("chapter-number"));
});

test("번호 · 글: 빈 제목은 꼭 고칠 것, 내용 없는 장 · 절은 확인 권장(하위 절이 있으면 아님)", () => {
  const r = run("# 논문\n\n## 제1장\n\n글\n\n## 제2장 본론\n\n### 제1절 가\n\n글\n\n### 제2절 빈 절\n\n## 제3장 결론\n\n[참고문헌]\n");
  assert.equal(find(r, "empty-heading").sev, "must");
  const empty = r.items.filter((x) => x.code === "empty-section").map((x) => x.msg);
  assert.equal(empty.length, 2, empty.join(" / "));
  assert.ok(empty.some((m) => m.includes("빈 절")) && empty.some((m) => m.includes("결론")));
});

test("그림 · 표: 빈 캡션 · 기본 글 '그림 설명' · 캡션 없는 표, 표 아래 캡션 줄도 인정", () => {
  const t = [`![그림 설명](fig:${FIG})`, `![](fig:${FIG})`, `![공정 흐름](fig:${FIG}){#fig:flow}`,
    "| a | b |\n| --- | --- |\n| 1 | 2 |", "| c | d |\n| --- | --- |\n| 3 | 4 |\n\n표: 아래 캡션 {#tbl:below}",
    "표: 위 캡션\n| e | f |\n| --- | --- |\n| 5 | 6 |", "@fig:flow 와 @tbl:below, 그림 1 · 그림 2 · 표 1 · 표 3을 보세요."].join("\n\n");
  const r = run(t);
  const caps = r.items.filter((x) => x.code === "figure-caption");
  assert.equal(caps.length, 2);
  assert.equal(t.slice(caps[0].from, caps[0].to), "그림 설명");
  const tc = r.items.filter((x) => x.code === "table-caption");
  assert.equal(tc.length, 1, tc.map((x) => x.msg).join());
  assert.match(tc[0].msg, /표 1/);
  assert.ok(!codes(r).includes("figure-unref") && !codes(r).includes("table-unref"), codes(r).join());
  // 표 1(캡션 없음)은 "표 3" 언급과 상관없이 언급 안 됨 아님 — 언급이 없는 표만
  const r2 = run(`![공정](fig:${FIG})\n\n표: 결과\n| a |\n| --- |\n| 1 |\n\n본문`);
  assert.ok(find(r2, "figure-unref") && find(r2, "table-unref"));
  assert.equal(find(r2, "figure-unref").sev, "warn");
});

test("참조: 없는 이름 · 같은 이름 두 번 · 원고에 없는 '그림 5' · [@fig:x]는 인용으로 읽힘", () => {
  const t = `![가](fig:${FIG}){#fig:a}\n\n![나](fig:${FIG}){#fig:a}\n\n@fig:a 와 @fig:zz, @tbl:none 그리고 그림 5. 메일 me@fig:a 는 참조 아님. [@fig:a] 도.`;
  const r = run(t);
  const miss = r.items.filter((x) => x.code === "xref-missing");
  assert.deepEqual(miss.map((x) => t.slice(x.from, x.to)), ["@fig:zz", "@tbl:none"]);
  assert.ok(miss.every((x) => x.sev === "must"));
  assert.equal(find(r, "label-duplicate").sev, "must");
  assert.match(find(r, "mention-missing").msg, /그림 5/);
  assert.equal(find(r, "cite-xref").sev, "must");
  // 문단 안에 끼인 그림
  assert.ok(find(run(`글 ![가](fig:${FIG}) 글`), "figure-inline"));
});

test("인용: 서재에 없는 키 · 빈 서지 항목(제목 · 저자 · 연도는 꼭, 나머지는 권장) · 모르는 키는 건너뜀", () => {
  const t = "가 [@miss]. 나 [@miss; @half]. 다 [@weak, p. 3]. 라 [@later].\n\n[참고문헌]";
  const r = run(t, { items: { miss: null, half: {}, weak: {} }, issues: { half: ["저자", "쪽"], weak: ["쪽"] } });
  const m = find(r, "cite-missing");
  assert.equal(m.sev, "must");
  assert.match(m.msg, /@miss \(2곳\)/);
  assert.equal(t.slice(m.from, m.to), "[@miss]");
  const f = r.items.filter((x) => x.code === "cite-fields");
  assert.deepEqual(f.map((x) => x.sev), ["must", "warn"]);
  assert.ok(!r.items.some((x) => x.msg.includes("@later")), "미리보기가 아직 못 받은 키는 건너뜀");
  // 인용 정보를 아직 못 받았으면(items 없음) 키 점검 없음
  assert.ok(!codes(run(t)).includes("cite-missing"));
});

test("인용: [참고문헌] 자리 없음 · 두 곳, 인용 검증 결과(근거 없음 = 꼭, 약함 = 권장, 검증 전 = [인용 검증])", () => {
  let r = run("가 [@a].");
  assert.equal(find(r, "bib-marker").sev, "warn");
  r = run("가 [@a].\n\n[참고문헌]\n\n[References]\n");
  assert.ok(find(r, "bib-duplicate") && !find(r, "bib-marker"));
  assert.ok(!find(run("인용 없음"), "bib-marker"));
  const t = "가 [@a]. 나 [@b]. 다 [@c].\n\n[참고문헌]";
  r = run(t, { verify: { items: [
    { start: 0, end: 7, citekey: "a", verdict: "unsupported", sentence: "가 [@a]." },
    { start: 8, end: 15, citekey: "b", verdict: "weak", sentence: "나 [@b]." },
    { start: 16, end: 23, citekey: "c", verdict: "supported", sentence: "다" },
    { start: 999, end: 1200, citekey: "c", verdict: "weak", sentence: "옛 위치" },
  ], counts: {}, unverified: 2 } });
  assert.equal(find(r, "verify-unsupported").sev, "must");
  const weak = r.items.filter((x) => x.code === "verify-weak");
  assert.equal(weak.length, 2);
  assert.ok(weak.every((x) => x.to <= t.length), "원고 밖 위치는 끝으로");
  const p = find(r, "verify-pending");
  assert.equal(p.action, "verify");
  assert.match(p.msg, /2개/);
});

test("글: [확인 필요] · TODO · 템플릿 글은 꼭 고칠 것, 코드 블록 안은 건너뜀", () => {
  const t = "# 논문 제목\n\n본문 [확인 필요: 수치] 이다. TODO 표 넣기. 추후 보완.\n\n연구의 배경과 필요성을 쓰고, 선행연구를 인용합니다.\n\n```\nTODO in code [확인 필요]\n```\n\nTODOS 와 XXXL 은 아님.";
  const r = run(t);
  assert.equal(r.items.filter((x) => x.code === "check-marker").length, 1);
  assert.equal(r.items.filter((x) => x.code === "todo").length, 2);
  assert.ok(find(r, "placeholder") && find(r, "placeholder-title"));
  assert.ok(r.items.filter((x) => ["check-marker", "todo", "placeholder"].includes(x.code)).every((x) => x.sev === "must"));
});

test("글: 긴 문단 · 두 칸 띄어쓰기(+모두 고치기) — 표 · 코드 · 들여쓰기는 그대로", () => {
  const long = "가".repeat(ck.LIMITS.paragraph + 1);
  let r = run(`${long}\n\n${"가".repeat(100)}\n\n- ${long}`);
  assert.equal(r.items.filter((x) => x.code === "long-paragraph").length, 2);
  const t = "가  나 다\n  들여쓰기 줄\n| a  | b |\n|---|---|\n\n```\nx  y\n```\n끝 줄  ";
  r = run(t);
  const ds = r.items.filter((x) => x.code === "double-space");
  assert.equal(ds.length, 1);
  assert.equal(ds[0].action, "spaces");
  assert.equal(ck.fixDoubleSpaces(t), "가 나 다\n  들여쓰기 줄\n| a  | b |\n|---|---|\n\n```\nx  y\n```\n끝 줄  ");
});

test("글: 괄호 · 따옴표 짝 — 항목 번호 1) · 가) · 아포스트로피 · 인라인 코드 · 이스케이프는 건너뜀", () => {
  assert.equal(ck.bracketProblem("정상 (괄호) [대괄호] “따옴표” ‘작은’ 「낫표」"), null);
  assert.equal(ck.bracketProblem("1) 첫째 2) 둘째, 가) 셋째 ~3) 넷째 a) b)"), null);
  assert.equal(ck.bracketProblem("don’t `(code` \\( 이스케이프"), null);
  assert.match(ck.bracketProblem("열기 (만").msg, /여는 '\('의 짝이 없어요/);
  assert.match(ck.bracketProblem("닫기만 ] 끝").msg, /닫는 '\]'의 짝이 없어요/);
  assert.match(ck.bracketProblem("엇갈림 ( [ ) ]").msg, /여는 '\['/);
  assert.match(ck.bracketProblem('큰 "따옴표 하나').msg, /큰따옴표/);
  const t = "문단 하나 (열고\n줄을 바꿔 닫음) 끝.\n\n“닫지 않은 따옴표\n\n| 칸 ( | 칸 |\n| --- | --- |";
  const r = run(t);
  const b = r.items.filter((x) => x.code === "bracket");
  assert.equal(b.length, 2, b.map((x) => x.msg).join(" / "));
  assert.equal(t[b[0].from], "“");
  assert.equal(t[b[1].from], "(");
});

test("결과: 꼭 고칠 것 먼저 · 원고 순서, 같은 문제는 20개까지 + '더 있어요', 배지 · 요약 문구", () => {
  const t = Array.from({ length: 30 }, (_, i) => `줄${i}  두 칸 TODO`).join("\n\n");
  const r = run(t);
  const ds = r.items.filter((x) => x.code === "double-space");
  assert.equal(ds.length, ck.LIMITS.perCode + 1);
  assert.match(ds[ds.length - 1].msg, /10곳 더/);
  const firstWarn = r.items.findIndex((x) => x.sev === "warn");
  assert.ok(r.items.slice(0, firstWarn).every((x) => x.sev === "must"));
  const todo = r.items.filter((x) => x.code === "todo").map((x) => x.from);
  assert.deepEqual(todo, [...todo].sort((a, b) => a - b));
  assert.deepEqual(r.counts, { must: r.items.filter((x) => x.sev === "must").length, warn: r.items.filter((x) => x.sev === "warn").length });
  assert.equal(ck.badgeOf(r).tone, "must");
  assert.equal(ck.badgeOf(r).text, String(r.counts.must));
  const clean = run("## 제1장 서론\n\n깨끗한 글이에요.");
  assert.deepEqual(clean.counts, { must: 0, warn: 0 });
  assert.equal(ck.badgeOf(clean).text, "");
  assert.match(ck.summaryText(clean), /고칠 곳을 찾지 못했어요/);
  assert.match(ck.summaryText(r), /꼭 고칠 것 \d+ · 확인 권장 \d+/);
  assert.equal(ck.badgeOf(null), null);
});

test("단축키 도움말에 제출 전 점검(Alt+K)", () => {
  assert.ok(we.shortcutHelp(false).keys.some((k) => k[1].includes("Alt+K")));
  assert.ok(we.shortcutHelp(true).keys.some((k) => k[1].includes("⌥+K")));
});

test("코드 검사: writecheckui.js의 템플릿 값은 esc() · 숫자 · 고정 글만, writing.js 연결은 작게", () => {
  const allowed = new Set(["E", "list.length", "i", "b.label", "keep.ckGo", "keep.ckActI", "top", "summaryText(S.result)"]);
  for (const expr of templateExprs(src("writecheckui.js"))) {
    assert.ok(allowed.has(bare(expr).trim()), `writecheckui.js: \${${expr}}`);
  }
  const ui = src("writecheckui.js");
  assert.match(ui, /aria-modal="false"/, "입력을 막지 않는 패널");
  assert.match(ui, /\.textContent = it\.msg/, "점검 문구는 글자로만");
  assert.ok(!/\bapi\b/.test(src("writecheck.js").replace(/\/\/.*$/gm, "")), "점검 규칙은 네트워크를 쓰지 않음");
  const w = src("writing.js");
  assert.match(w, /import \{ checkPanel \} from "\.\/writecheckui\.js";/);
  assert.equal((w.match(/data-check(?![-\w])/g) || []).length, 1, "도구 막대 단추 한 줄");
  assert.match(w, /W\.check\.destroy\(\)/);
});
