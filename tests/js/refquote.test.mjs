// 참고 패널의 넣기 형식 · 쪽 번호 · 이스케이프 · 띄어쓰기 · 씨앗 · 코드 검사
// (docs/specs/writing-reference-pane.md 12장 D — AC-R30~R35, AC-R21 코드 검사)
// 실행: node --test tests/js/refquote.test.mjs   (pytest 래퍼: tests/test_refquote_js.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bare, templateExprs } from "./codecheck.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JS = join(ROOT, "paperlab", "static", "js");
const rq = await import(pathToFileURL(join(JS, "refquote.js")).href);
const src = (name) => readFileSync(join(JS, name), "utf8");
const words = (n, w = "word") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");
const NO_PRINT = { pages: "", page_count: 15 };
const P345 = { pages: "345-360", page_count: 16 };

// ---------------------------------------------------------------- AC-R30 (U-1 확정값)
test("QUOTE_STYLE = APA + 둥근 따옴표 + 40단어, 짧은 인용 · 블록 경계", () => {
  assert.deepEqual({ ...rq.QUOTE_STYLE }, { open: "\u201c", close: "\u201d", blockWords: 40 });
  assert.ok(Object.isFrozen(rq.QUOTE_STYLE));
  const q = rq.directQuote("Attention is all you need.", "key", "p. 12");
  assert.deepEqual(q, { text: "“Attention is all you need.” [@key, p. 12]", block: false });
  assert.ok(!q.text.includes('"'));
  assert.equal(rq.directQuote(words(39), "k", "p. 1").block, false);
  const b = rq.directQuote(words(40), "k", "p. 12");
  assert.equal(b.block, true);
  assert.equal(b.text, `> ${words(40)} [@k, p. 12]`);
  assert.ok(!/[“”"]/.test(b.text));
  assert.equal(rq.directQuote(words(40, "어절"), "k", "p. 3").block, true); // 한국어 40어절
  assert.equal(rq.directQuote(words(39, "어절"), "k", "p. 3").block, false);
  // 공백 · 줄바꿈은 한 칸으로(단어 수도 그 기준)
  assert.equal(rq.directQuote("  a\n b \t c ", "k", "").text, "“a b c” [@k]");
  assert.equal(rq.wordCount("연구는  순환\n구조 없이"), 4);
  // 화면 문구(툴팁)도 이 값에서
  assert.equal(rq.quoteRuleText(), "원고 커서 자리에 직접 인용으로 넣어요. 짧으면 “…”로 본문에, 40단어 이상이면 인용 블록으로 넣어요.");
});

test("따옴표 모양 · 40단어 값은 refquote.js 밖에 적지 않음 (AC-R30 코드 검사)", () => {
  for (const name of ["refpane.js", "writing.js", "reader.js"]) {
    const s = src(name);
    assert.ok(!/blockWords|40\s*단어|\b40\b.*어절/.test(s), `${name}에 40단어 값`);
    assert.ok(!/QUOTE_STYLE\s*=/.test(s), `${name}에 QUOTE_STYLE 정의`);
  }
  for (const name of ["refpane.js", "writing.js"]) assert.ok(!/[“”]/.test(src(name)), `${name}에 둥근 따옴표`);
  // 읽기 화면 · 참고 패널의 [인용으로 넣기] · [넣기] 툴팁은 설정값에서 만든 글자(quoteRuleText)
  assert.match(src("reader.js"), /data-quote title="\$\{esc\(quoteRuleText\(\)\)\}"/);
  assert.match(src("reader.js"), /data-insert title="\$\{esc\(quoteRuleText\(\)\)\}"/);
});

// ---------------------------------------------------------------- AC-R31 쪽 번호
test("인쇄 쪽: pages 범위 길이 = PDF 쪽 수일 때만, 아니면 PDF 쪽", () => {
  assert.deepEqual(rq.pageLocator(P345, [3]), { loc: "p. 347", printed: true });
  assert.deepEqual(rq.pageLocator(P345, [3, 4]), { loc: "pp. 347–348", printed: true });
  assert.deepEqual(rq.pageLocator(P345, [4, 3, 4]), { loc: "pp. 347–348", printed: true });
  assert.deepEqual(rq.pageLocator({ pages: "345–360", page_count: 16 }, [3]), { loc: "p. 347", printed: true });
  assert.deepEqual(rq.pageLocator({ pages: " 345 - 360 ", page_count: "16" }, [1]), { loc: "p. 345", printed: true });
  for (const p of [{ pages: "345-360", page_count: 17 }, { pages: "", page_count: 16 }, { pages: "e1234", page_count: 1 },
    { pages: "xii-xx", page_count: 9 }, { pages: "360-345", page_count: 16 }, { pages: "345-360" }, null]) {
    assert.deepEqual(rq.pageLocator(p, [3]), { loc: "p. 3", printed: false }, JSON.stringify(p));
    assert.deepEqual(rq.pageLocator(p, [3, 4]), { loc: "pp. 3–4", printed: false });
    assert.equal(rq.basisText(p).text, "인용 쪽: PDF 쪽");
  }
  assert.deepEqual(rq.basisText(P345), { text: "인용 쪽: 인쇄 쪽(345–360)",
    title: "논문의 쪽 범위(345–360)가 PDF 쪽 수와 같아 인쇄된 쪽 번호로 넣어요" });
  assert.deepEqual(rq.pageLocator(P345, []), { loc: "", printed: false });
  assert.equal(rq.citeMark("k", ""), "[@k]");
  assert.equal(rq.citeMark("k", "pp. 3–4"), "[@k, pp. 3–4]");
});

// ---------------------------------------------------------------- AC-R32 이스케이프
test("PDF 문장 · 하이라이트는 마크다운 특수 문자 이스케이프, 메모 · 노트는 그대로", () => {
  assert.equal(rq.escapeMd("see [12] and p < .05* _x_ \\y"), "see \\[12\\] and p \\< .05\\* \\_x\\_ \\\\y");
  assert.equal(rq.escapeMd("a `code`"), "a \\`code\\`");
  assert.equal(rq.directQuote("see [12] and p < .05*", "k", "p. 2").text, "“see \\[12\\] and p \\< .05\\*” [@k, p. 2]");
  assert.equal(rq.ownWords("  셀프 *어텐션* [12]  ", "k", "p. 3"), "셀프 *어텐션* [12] [@k, p. 3]");
  assert.equal(rq.ownWords("## 핵심\n- 순환 없이", "k"), "## 핵심\n- 순환 없이 [@k]"); // 여러 줄 그대로
});

// ---------------------------------------------------------------- AC-R33 띄어쓰기
test("본문 안 넣기 앞 공백 · 블록은 앞뒤를 빈 줄로 나눔(이미 빈 줄이면 더 넣지 않음 — 품질팀 F6)", () => {
  assert.equal(rq.spaced("연구는", "[@k]"), " [@k]");
  for (const before of ["연구는 ", "(", "첫 줄\n", "", "탭\t"]) assert.equal(rq.spaced(before, "[@k]"), "[@k]", JSON.stringify(before));
  assert.equal(rq.spaced("앞 문단", "> q [@k]", true), "\n\n> q [@k]\n\n");
  assert.equal(rq.spaced("앞 문단\n", "> q [@k]", true), "\n> q [@k]\n\n");
  assert.equal(rq.spaced("앞 문단\n\n", "> q [@k]", true), "> q [@k]\n\n");
  assert.equal(rq.spaced("", "> q [@k]", true), "> q [@k]\n\n");
  assert.equal(rq.spaced("앞\n\n", "> q [@k]", true, "\n\n다음 문단"), "> q [@k]");
  assert.equal(rq.spaced("앞\n\n", "> q [@k]", true, "\n다음"), "> q [@k]\n");
  assert.equal(rq.spaced("앞 문단", "> q [@k]", true, "이어지는 글"), "\n\n> q [@k]\n\n");
  assert.equal(rq.spaced("연구는", "[@k]", false, "\n\n"), " [@k]"); // 본문 안 넣기는 뒤를 보지 않음
});

// ---------------------------------------------------------------- AC-R34 인용 표시 해석과 일치
test("만든 인용 글을 parseCitation(writing.js와 같은 정규식)으로 읽으면 키 · 쪽이 그대로", () => {
  const read = (text) => [...text.matchAll(rq.CITE_RE)].map((m) => rq.parseCitation(m[1]));
  const cases = [
    [rq.directQuote("A sentence.", "vaswani2017attention", rq.pageLocator(P345, [3]).loc).text, "vaswani2017attention", "347"],
    [rq.directQuote("A sentence.", "kim2023study", rq.pageLocator(P345, [3, 4]).loc).text, "kim2023study", "347–348"],
    [rq.directQuote(words(45), "vaswani2017attention", "p. 2").text, "vaswani2017attention", "2"],
    [rq.ownWords("메모", "k:1.a", "p. 12"), "k:1.a", "12"],
    [rq.directQuote("see [12] and p < .05*", "k", "p. 12").text, "k", "12"], // 이스케이프한 [12]는 인용으로 읽히지 않음
    // 품질팀 F2: PDF 글 속 [@evil]은 이스케이프되어 인용으로 읽히지 않음(키 주입 방지)
    [rq.directQuote("as in [@evil, p. 9] and [@evil2]", "k", "p. 3").text, "k", "3"],
    [rq.directQuote(`${words(41)} [@evil]`, "k", "p. 4").text, "k", "4"],
  ];
  for (const [text, key, locator] of cases) {
    const found = read(text);
    assert.equal(found.length, 1, text);
    assert.deepEqual(found[0], [{ key, suppress_author: false, locator, label: "page" }], text);
  }
  assert.deepEqual(read(rq.ownWords("노트", "k")), [[{ key: "k", suppress_author: false }]]);
  assert.deepEqual(read(rq.citeMark("a")), [[{ key: "a", suppress_author: false }]]);
  assert.deepEqual(read("\\[@x\\] [@y]").length, 1); // 앞에 \가 붙은 [는 인용이 아님
  // writing.js는 정규식 · parseCitation을 refquote.js에서 가져다 씀(한 곳에서만 정의)
  const w = src("writing.js");
  assert.match(w, /import \{ CITE_RE, parseCitation \} from "\.\/refquote\.js";/);
  assert.ok(!/const (CITE_RE|KEY_RE|LOCATOR_RE)\s*=|function parseCitation/.test(w));
});

// ---------------------------------------------------------------- 씨앗 (9.1 · 9.9절)
test("원고 인용 → 씨앗: 처음 나온 순서 · 중복 제거 · 서재에 없는 키 뺌 · 번호 없는 수", () => {
  const papers = [{ id: 7, citekey: "a", openalex_id: "W1" }, { id: 3, citekey: "b", openalex_id: "" },
    { id: 9, citekey: "c", openalex_id: "https://openalex.org/W22" }, { id: 4, citekey: "d", openalex_id: "W0" }];
  const clusters = [{ items: [{ key: "c" }, { key: "zz" }] }, { items: [{ key: "a" }, { key: "c" }] }, { items: [{ key: "b" }, { key: "d" }] }];
  assert.deepEqual(rq.manuscriptSeeds(clusters, papers), { ids: [9, 7, 3, 4], cited: 4, numbered: 2, missing: 2 });
  assert.deepEqual(rq.manuscriptSeeds(clusters, papers, 2).ids, [9, 7]);
  assert.deepEqual(rq.manuscriptSeeds([], papers), { ids: [], cited: 0, numbered: 0, missing: 0 });
  assert.equal(rq.seedSignature([9, 7, 30]), "7,9,30");
  assert.equal(rq.seedSignature([30, 9, 7]), rq.seedSignature([7, 9, 30]));
});

// ---------------------------------------------------------------- AC-R35 · AC-R21 코드 검사
test("refpane.js: 제목 · 저자 · 초록 · 하이라이트 · 노트 글은 esc() · textContent로만 (AC-R35)", () => {
  const s = src("refpane.js");
  const risky = /\b(title|abstract|authors|venue|message|doi|sub|url|text|note|comment|citekey)\b/;
  const exprs = templateExprs(s);
  assert.ok(exprs.length > 60);
  const bad = exprs.filter((e) => risky.test(bare(e)));
  assert.deepEqual(bad, []);
  assert.ok(!/\.innerHTML\s*=\s*[^`"'\n;]*\b(p|it|paper|a)\.(title|abstract|note|comment|text)/.test(s));
  assert.ok(!/insertAdjacentHTML|outerHTML\s*=|document\.write/.test(s));
  assert.match(s, /abs\.textContent = text/);
  assert.match(s, /ta\.value = note/);
});

test("추천 결과는 메모리에만 — localStorage · sessionStorage에 쓰지 않음, 로그아웃 때 비움 (AC-R35 · 9.8절)", () => {
  const s = src("refpane.js");
  assert.ok(!/sessionStorage|indexedDB/.test(s));
  const sets = [...s.matchAll(/localStorage\.setItem\(([^,]+),\s*(JSON\.stringify\(.*?\))\);/g)].map((m) => [m[1].trim(), m[2].trim()]);
  assert.equal(sets.length, (s.match(/setItem\(/g) || []).length);
  assert.deepEqual(sets, [["PREF_KEY", "JSON.stringify({ ...prefs(), ...patch })"], ["`${PREF_KEY}.recent.${P.mid}`", "JSON.stringify(P.recent)"]]);
  const prefCalls = [...s.matchAll(/\bsavePrefs\(\{([^}]*)\}\)/g)].map((m) => m[1].split(":")[0].trim());
  assert.ok(prefCalls.length >= 3 && prefCalls.every((k) => k === "open" || k === "tab"), prefCalls.join());
  assert.match(s, /const recMemory = new Map\(\);/);
  assert.match(s, /export function resetRefMemory\(\) \{[\s\S]*?recMemory\.clear\(\);/);
  const app = src("app.js");
  const body = (name) => app.slice(app.indexOf(name), app.indexOf("\n}\n", app.indexOf(name)));
  assert.match(body("function clearApp()"), /resetRefMemory\(\)/);
  assert.match(body("async function enterApp(me)"), /resetRefMemory\(\)/);
});

test("추천 씨앗은 본문으로만 — 주소 쿼리 없음 (AC-R21)", () => {
  const s = src("refpane.js");
  assert.match(s, /streamEvents\("\/api\/graph\/recommend", \{ paper_ids: st\.ids \}/);
  assert.ok(!/\/api\/graph\/recommend\?|qs\(|URLSearchParams|fetch\(/.test(s));
});
