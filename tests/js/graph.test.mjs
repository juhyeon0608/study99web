// 인용 그래프 화면 순수 함수 · 코드 검사 (docs/specs/citation-graph.md 11장 E — AC-G50 · 51 · 52 · 31)
// 실행: node --test tests/js/graph.test.mjs   (pytest 래퍼: tests/test_graph_js.py)

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATIC = join(ROOT, "paperlab", "static");
const gm = await import(pathToFileURL(join(STATIC, "js", "graphmath.js")).href);

function loadD3() {
  // UMD 4개를 브라우저처럼(전역 d3) 차례로 실행
  const ctx = vm.createContext({ setTimeout, clearTimeout, setInterval, clearInterval, performance, Date });
  for (const f of ["d3-dispatch", "d3-quadtree", "d3-timer", "d3-force"]) {
    vm.runInContext(readFileSync(join(STATIC, "vendor", "d3", `${f}.min.js`), "utf8"), ctx);
  }
  return ctx.d3;
}

const P = (over = {}) => ({ title: "A Paper Title For Tests", authors: [{ given: "Ashish", family: "Vaswani" }],
  year: 2017, cited_by_count: 10, venue: "NeurIPS", ...over });

function sampleGraph(n = 12, size = 40) {
  const nodes = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `W${100 + i}`, is_seed: i === 0, relation: i === 0 ? [] : ["reference"], score: i === 0 ? null : 1 / (i + 1),
      paper: P({ title: `Paper ${i} about graphs`, year: 2010 + (i % 8), cited_by_count: i * 100 }), in_library: i === 3 ? 77 : null });
  }
  const edges = [];
  for (let i = 1; i < n; i++) edges.push({ source: "W100", target: `W${100 + i}`, weight: 0.1 + i / 50, kind: i % 4 ? "coupling" : "related", shared: 3 });
  edges.push({ source: "W101", target: "W102", weight: 0.5, kind: "cocitation", shared: 2 });
  edges.push({ source: "W101", target: "W999", weight: 0.5, kind: "coupling", shared: 2 }); // 노드 밖 → 버림
  return { seed: "W100", size, nodes, edges, prior: [], derivative: [], warnings: [], stats: { candidates: 300, built_on: "2026-10-07" } };
}

// ---------------------------------------------------------------- AC-G50 크기 · 색 · 이름표
test("radius: 로그 척도 0 · 최대 · 중간", () => {
  assert.equal(gm.radius(0, 1000), 6);
  assert.equal(gm.radius(1000, 1000), 28);
  const mid = Math.round(Math.expm1(Math.log1p(1000) / 2));
  assert.ok(Math.abs(gm.radius(mid, 1000) - 17) < 0.05);
  assert.equal(gm.radius(5, 0), 6); // 최대가 0
  assert.equal(gm.radius(0, 10, 80), 5);
  assert.equal(gm.radius(10, 10, 80), 22);
  assert.equal(gm.radius(-3, 10), 6);
  assert.equal(gm.radius(99999, 10), 28); // 범위 밖은 최대
});

test("yearBin: 최소 → 5−bins, 최대 → 4, 연도 없음 → none", () => {
  const sc = gm.yearScale([2008, 2012, 2024, null, 2015]);
  assert.deepEqual(sc, { yMin: 2008, yMax: 2024, span: 17, bins: 5 });
  assert.equal(gm.yearBin(2008, sc), 0);
  assert.equal(gm.yearBin(2024, sc), 4);
  assert.equal(gm.yearBin(null, sc), "none");
  assert.equal(gm.yearBin(undefined, sc), "none");
  const two = gm.yearScale([2020, 2021]);
  assert.equal(two.bins, 2);
  assert.equal(gm.yearBin(2020, two), 3);
  assert.equal(gm.yearBin(2021, two), 4);
  const one = gm.yearScale([2019]);
  assert.equal(gm.yearBin(2019, one), 4);
  assert.equal(gm.yearScale([null, undefined]), null);
  assert.equal(gm.yearBin(2020, null), "none");
});

test("yearRamp: 구간 시작 연도, 마지막 칸만 시작–끝", () => {
  const ramp = gm.yearRamp(gm.yearScale([2008, 2024]));
  assert.deepEqual(ramp.map((r) => r.yb), [0, 1, 2, 3, 4]);
  assert.deepEqual(ramp.map((r) => r.start), [2008, 2012, 2015, 2019, 2022]);
  assert.equal(ramp[4].label, "2022–24");
  assert.equal(ramp[0].title, "2008–2011");
  assert.deepEqual(gm.yearRamp(gm.yearScale([2020, 2021])).map((r) => r.label), ["2020", "2021"]);
});

test("nodeLabel: 성, 연도 / 연도 없음 / 저자 없으면 제목 앞 20자", () => {
  assert.equal(gm.nodeLabel(P()), "Vaswani, 2017");
  assert.equal(gm.nodeLabel(P({ year: null })), "Vaswani, 연도 없음");
  assert.equal(gm.nodeLabel(P({ authors: [], title: "Attention Is All You Need Indeed" })), "Attention Is All You…");
  assert.equal(gm.nodeLabel(P({ authors: [{ literal: "WHO" }] })), "WHO, 2017");
  assert.equal(gm.nodeAriaLabel({ paper: P({ cited_by_count: 12345 }), isSeed: true, inLibrary: 3 }),
    "A Paper Title For Tests, 2017년, 피인용 12,345회, 씨앗 논문, 서재에 있음");
});

// ---------------------------------------------------------------- 이웃 · 정렬 · 모델
test("neighbors · closest · edgeBetween", () => {
  const edges = [{ source: "a", target: "b", weight: 0.2 }, { source: "c", target: "a", weight: 0.9 }, { source: "b", target: "c", weight: 0.4 }];
  const nb = gm.neighbors(edges);
  assert.deepEqual([...nb.get("a")].sort(), ["b", "c"]);
  assert.deepEqual(gm.closest("a", edges).map((x) => x.id), ["c", "b"]);
  assert.equal(gm.edgeBetween("b", "a", edges).weight, 0.2);
  assert.equal(gm.edgeBetween("a", "z", edges), null);
});

test("sortRows: 기본은 유사도 내림차순 · 씨앗 맨 위, 다른 칸 정렬", () => {
  const m = gm.toModel(sampleGraph(6));
  const ids = (rows) => rows.map((r) => r.id);
  assert.deepEqual(ids(gm.sortRows(m.nodes)), ["W100", "W101", "W102", "W103", "W104", "W105"]);
  assert.deepEqual(ids(gm.sortRows(m.nodes, "score", "asc")), ["W100", "W105", "W104", "W103", "W102", "W101"]);
  assert.deepEqual(ids(gm.sortRows(m.nodes, "cited", "desc")).slice(0, 2), ["W105", "W104"]);
  assert.deepEqual(ids(gm.sortRows(m.nodes, "year", "asc")).slice(0, 1), ["W100"]);
  const t = gm.sortRows([{ id: "1", paper: { title: "나" } }, { id: "2", paper: { title: "가" } }, { id: "3", paper: { title: "B" } }], "title", "asc");
  assert.deepEqual(ids(t), ["2", "1", "3"]); // 한국어 정렬(가 · 나 · B)
  assert.equal(gm.sortCaption("score", "desc", 40), "그래프 논문 40편 · 씨앗과 비슷한 순");
  assert.equal(gm.sortCaption("cited", "asc", 20), "그래프 논문 20편 · 피인용 적은 순");
});

test("toModel: 응답 → 화면 모델", () => {
  const m = gm.toModel(sampleGraph(12));
  assert.equal(m.seedId, "W100");
  assert.equal(m.nodes.length, 12);
  assert.equal(m.edges.length, 12); // 노드 밖 선은 버림
  assert.ok(m.hasRelated);
  assert.equal(m.cMax, 1100);
  const byId = m.byId;
  assert.equal(byId.get("W111").r, 28);
  assert.equal(byId.get("W100").r, 6);
  assert.equal(byId.get("W103").inLibrary, 77);
  assert.equal(byId.get("W100").label, "Vaswani, 2010");
  // 늘 보이는 이름표 = 씨앗 + 피인용 상위 min(15, ⌈12 × 0.4⌉ = 5)편
  const shown = m.nodes.filter((n) => n.showLabel).map((n) => n.id).sort();
  assert.deepEqual(shown, ["W100", "W107", "W108", "W109", "W110", "W111"]);
  assert.ok(m.nodes.every((n) => n.yb === "none" || (n.yb >= 0 && n.yb <= 4)));
  assert.equal(gm.toModel({ nodes: [], edges: [] }).nodes.length, 0);
});

test("seedFromResult · scholarQuery · relation 문구", () => {
  assert.deepEqual(gm.seedFromResult({ openalex_id: "W123", doi: "10.1/x", arxiv_id: "", title: "  Some   Title " }),
    { openalex_id: "W123", doi: "10.1/x", title: "Some Title" });
  assert.deepEqual(gm.seedFromResult({ openalex_id: "https://evil/W1", title: "ab" }), {});
  assert.equal(gm.scholarQuery({ title: "", doi: "10.1/x" }), "10.1/x");
  assert.equal(gm.relationText(["reference", "citing", "bogus"]), "씨앗이 인용함, 씨앗을 인용함");
  assert.equal(gm.seedRelationText({ kind: "coupling", shared: 9 }), "같은 참고문헌 9편");
  assert.equal(gm.seedRelationText({ kind: "cocitation", shared: 3 }), "함께 인용한 논문 3편");
  assert.equal(gm.seedRelationText({ kind: "related", shared: 1 }), "주제가 비슷함(인용 근거 없음)");
  assert.equal(gm.seedRelationText(null), "직접 이어진 선은 없어요");
});

test("진행 단계 · 숫자 · 경고 묶기", () => {
  assert.deepEqual(gm.stepStates("citing"), { seed: "done", references: "done", citing: "now", cocitation: "todo", finish: "todo", compute: "todo" });
  assert.equal(gm.stepStates("wait").seed, "now");
  assert.equal(gm.countFromMessage("참고문헌 · 관련 논문 1,320편"), "1,320편");
  assert.equal(gm.countFromMessage("유사도 계산"), "");
  const groups = gm.groupNotices([{ code: "cocite_failed" }, { code: "weak_citation_data" }, { code: "stale_cache" },
    { code: "upstream_limited" }, { code: "new_code", message: "서버 문구" }, { code: "truncated" }]);
  assert.deepEqual(groups.map((x) => [x.tone, x.code]), [["warn", "partial"], ["info", "weak_citation_data truncated"], ["warn", "upstream_limited"]]);
  assert.deepEqual(groups[0].items, ["함께 인용된 논문을 받지 못했어요.", "일부 정보가 오래됐을 수 있어요.", "서버 문구"]);
  assert.equal(groups[2].settings, true);
  assert.deepEqual(gm.groupNotices([]), []);
});

test("선 굵기 · 진하기", () => {
  assert.equal(gm.edgeWidth(0), 1);
  assert.equal(gm.edgeWidth(1), 4);
  assert.equal(gm.edgeOpacity(0), 0.3);
  assert.ok(Math.abs(gm.edgeOpacity(1) - 0.85) < 1e-9);
});

// ---------------------------------------------------------------- 배치 (d3-force UMD를 Node에서)
test("layoutGraph: 같은 입력 두 번 → 같은 좌표, 씨앗은 가운데", () => {
  const d3 = loadD3();
  assert.equal(typeof d3.forceSimulation, "function");
  const m = gm.toModel(sampleGraph(30, 40));
  const a = gm.layoutGraph(m, d3);
  const b = gm.layoutGraph(gm.toModel(sampleGraph(30, 40)), d3);
  assert.deepEqual([...a.entries()], [...b.entries()]);
  assert.deepEqual(a.get("W100"), { x: 0, y: 0 });
  assert.equal(a.size, 30);
  for (const p of a.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  // 겹침이 거의 없음(반지름 + 여백)
  const nodes = m.nodes;
  let overlaps = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const p = a.get(nodes[i].id);
      const q = a.get(nodes[j].id);
      if (Math.hypot(p.x - q.x, p.y - q.y) < nodes[i].r + nodes[j].r) overlaps++;
    }
  }
  assert.ok(overlaps <= 2, `겹침 ${overlaps}`);
});

test("fitTransform · zoomAt · nearestInDirection", () => {
  const pts = [{ x: -100, y: -50, r: 10 }, { x: 100, y: 50, r: 10 }];
  const t = gm.fitTransform(pts, 500, 300, 24);
  for (const p of pts) {
    const sx = p.x * t.k + t.x;
    const sy = p.y * t.k + t.y;
    assert.ok(sx - p.r * t.k >= 23.9 && sx + p.r * t.k <= 476.1 && sy - p.r * t.k >= 23.9 && sy + p.r * t.k <= 276.1);
  }
  const z = gm.zoomAt({ k: 1, x: 0, y: 0 }, 2, 100, 100, 0.5, 4);
  assert.deepEqual(z, { k: 2, x: -100, y: -100 }); // (100,100)은 그대로
  assert.equal(gm.zoomAt({ k: 3.9, x: 0, y: 0 }, 2, 0, 0, 0.5, 4).k, 4);
  const pos = new Map([["c", { x: 0, y: 0 }], ["r", { x: 50, y: 5 }], ["far", { x: 200, y: 0 }], ["up", { x: 3, y: -40 }], ["diag", { x: 30, y: 30 }]]);
  assert.equal(gm.nearestInDirection(pos, "c", "ArrowRight"), "r");
  assert.equal(gm.nearestInDirection(pos, "c", "ArrowUp"), "up");
  assert.equal(gm.nearestInDirection(pos, "c", "ArrowDown"), "diag");
  assert.equal(gm.nearestInDirection(pos, "far", "ArrowRight"), null);
});

// ---------------------------------------------------------------- AC-G51 · 31 코드 검사
// 템플릿 문자열의 ${…} 식을 (안쪽 템플릿까지) 모두 뽑는다
function templateExprs(src) {
  const out = [];
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] === "$" && src[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < src.length && depth) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      out.push(src.slice(i + 2, j - 1).trim());
    }
  }
  return out;
}

// 식에서 안쪽 템플릿 문자열 · 따옴표 문자열 · esc(…) 호출을 지우고 남은 부분(= HTML에 그대로 들어가는 값)
function bare(expr) {
  let s = "";
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] !== "`") { s += expr[i]; continue; }
    let depth = 0;
    i++;
    for (; i < expr.length; i++) {
      if (expr[i] === "\\") { i++; continue; }
      if (expr[i] === "$" && expr[i + 1] === "{") { depth++; i++; continue; }
      if (depth && expr[i] === "}") { depth--; continue; }
      if (!depth && expr[i] === "`") break;
    }
    s += "``";
  }
  s = s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  let prev;
  do { prev = s; s = s.replace(/esc\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "E"); } while (s !== prev);
  return s.replace(/^[^?:`"]*\?/, ""); // 조건식 cond ? A : B 의 cond는 화면에 나가지 않음
}

test("graph.js: 제목 · 저자 · 초록 · 학술지는 esc()로만 HTML에 (AC-G51)", () => {
  const src = readFileSync(join(STATIC, "js", "graph.js"), "utf8");
  const risky = /\b(title|abstract|authors|venue|label|message|doi|sub|caption|url|text)\b/;
  // 검사기 자체 확인: 날것은 잡고 esc()는 통과
  const probe = (s) => templateExprs(s).filter((e) => risky.test(bare(e)));
  assert.equal(probe("el(`<b>${p.title}</b>`)").length, 1);
  assert.equal(probe("el(`<i>${x ? `<b>${p.abstract}</b>` : \"\"}</i>`)").length, 1);
  assert.equal(probe("el(`<b>${esc(p.title)}</b>${n ? `<i>${esc(n.label)}</i>` : \"\"}`)").length, 0);
  const exprs = templateExprs(src);
  assert.ok(exprs.length > 50);
  const bad = exprs.filter((e) => risky.test(bare(e)));
  assert.deepEqual(bad, []);
  assert.ok(!/\.innerHTML\s*=\s*[^`"']*\bp\.(title|abstract)/.test(src));
  assert.match(src, /label\.textContent = n\.label/); // SVG <text>는 textContent
  assert.ok(!/insertAdjacentHTML|outerHTML\s*=|document\.write/.test(src));
});

test("graph.js: 씨앗을 주소 쿼리로 보내지 않음 (AC-G31)", () => {
  const src = readFileSync(join(STATIC, "js", "graph.js"), "utf8");
  assert.match(src, /streamEvents\("\/api\/graph", \{ seed, size \}/);
  assert.ok(!/\/api\/graph\?|qs\(|URLSearchParams|fetch\(/.test(src));
});

test("로그아웃 · 계정 바뀜 때 그래프 메모리를 비움 (품질팀 M-5)", () => {
  const graphSrc = readFileSync(join(STATIC, "js", "graph.js"), "utf8");
  const app = readFileSync(join(STATIC, "js", "app.js"), "utf8");
  assert.match(graphSrc, /export function resetGraphMemory\(\) \{\s*closeGraph\(\);\s*memory\.clear\(\);\s*pending = null;/);
  const body = (name) => app.slice(app.indexOf(name), app.indexOf("\n}\n", app.indexOf(name)));
  assert.match(body("function clearApp()"), /resetGraphMemory\(\)/);
  assert.match(body("async function enterApp(me)"), /resetGraphMemory\(\)/);
});

// ---------------------------------------------------------------- AC-G52 벤더
test("vendor d3: THIRD_PARTY.md 해시 = 파일 해시 = graph.js SRI, 외부 CDN 주소 없음", () => {
  const md = readFileSync(join(STATIC, "vendor", "THIRD_PARTY.md"), "utf8");
  const graphSrc = readFileSync(join(STATIC, "js", "graph.js"), "utf8");
  const files = { "d3-force": "3.0.0", "d3-dispatch": "3.0.1", "d3-quadtree": "3.0.1", "d3-timer": "3.0.1" };
  for (const [name, version] of Object.entries(files)) {
    const buf = readFileSync(join(STATIC, "vendor", "d3", `${name}.min.js`));
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const sri = `sha384-${createHash("sha384").update(buf).digest("base64")}`;
    const row = md.split("\n").find((l) => l.includes(`d3/${name}.min.js\` |`));
    assert.ok(row, `THIRD_PARTY.md에 ${name} 해시 줄이 없음`);
    assert.ok(row.includes(sha256), `${name} SHA-256 불일치`);
    assert.ok(row.includes(sri), `${name} SRI 불일치`);
    assert.ok(row.includes(`| ${buf.length} |`), `${name} 크기 불일치`);
    assert.ok(md.includes(`[${name}](https://github.com/d3/${name}) | ${version} | ISC |`), `${name} 버전 · 라이선스 줄`);
    assert.ok(graphSrc.includes(`["${name}.min.js", "${sri}"]`), `graph.js SRI(${name})`);
    const lic = readFileSync(join(STATIC, "vendor", "d3", `${name}.LICENSE`), "utf8");
    assert.match(lic, /Copyright/);
    assert.match(buf.toString("utf8", 0, 200), new RegExp(`v${version.replace(/\./g, "\\.")}`));
  }
  for (const f of readdirSync(join(STATIC, "js"))) {
    const src = readFileSync(join(STATIC, "js", f), "utf8");
    assert.ok(!/https:\/\/cdn|unpkg|jsdelivr/i.test(src), `${f}가 외부 CDN을 부름`);
  }
});
