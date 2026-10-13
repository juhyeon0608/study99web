// 5단계 국내 DB 화면 순수 함수 (docs/design/phase5-korean-db-ui.md 2 · 4 · 5 · 6장, 명세 AC-581 · 582)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as S from "../../paperlab/static/js/sourcemeta.js";
import * as GM from "../../paperlab/static/js/graphmath.js";

const read = (p) => readFileSync(new URL(`../../paperlab/static/js/${p}`, import.meta.url), "utf-8");

describe("소스 표 (6.4절 · AC-581)", () => {
  test("새 소스 3개와 묶음", () => {
    assert.deepEqual(Object.keys(S.SOURCE_LIMITS), ["kci", "riss", "europepmc"]);
    assert.deepEqual(Object.keys(S.SOURCE_META).map((k) => S.SOURCE_META[k].group), ["전 분야", "전 분야", "전 분야", "전 분야", "국내", "국내", "생명과학 · 의학"]);
    for (const k of Object.keys(S.SOURCE_META)) assert.ok(S.GROUPS.includes(S.SOURCE_META[k].group), k);
    assert.equal(S.SOURCE_META.kci.desc, "국내 학술지 논문 · 제목으로 찾아요");
    assert.ok(S.isNewSource("riss") && !S.isNewSource("openalex") && !S.isNewSource("__proto__"));
  });

  test("정렬 · 필터 제한과 이유 줄", () => {
    const k = S.sourceLimits("kci");
    assert.deepEqual(k.sortOff, ["cited"]);
    assert.equal(k.oaOff, true);
    assert.equal(k.note, "KCI는 피인용순 정렬과 ‘무료 PDF 있는 논문만’을 지원하지 않아요.");
    const r = S.sourceLimits("riss");
    assert.deepEqual([r.sortOff, r.oaOff, r.oaLabel, r.note], [["cited"], false, "무료 원문 있는 논문만", "RISS는 피인용순 정렬을 지원하지 않아요."]);
    const e = S.sourceLimits("europepmc");
    assert.deepEqual([e.sortOff, e.oaOff, e.oaLabel, e.note], [[], false, "오픈 액세스 논문만", ""]);
    assert.deepEqual(S.sourceLimits("openalex"), { sortOff: [], oaOff: false, oaLabel: "무료 PDF 있는 논문만", note: "" });
  });

  test("소스를 바꾸면 미지원 값을 기본값으로", () => {
    assert.deepEqual(S.adjustOptions("kci", { sort: "cited", oa: true }),
      { sort: "relevance", oa: false, said: "지원하지 않아 관련도순으로 검색했어요 · ‘무료 PDF 있는 논문만’을 껐어요." });
    assert.deepEqual(S.adjustOptions("riss", { sort: "date", oa: true }), { sort: "date", oa: true, said: "" });
    assert.deepEqual(S.adjustOptions("europepmc", { sort: "cited", oa: false }), { sort: "cited", oa: false, said: "" });
  });

  test("쓸 수 없는 이유 (2.2절)", () => {
    assert.equal(S.offReason("kci", "unconfigured"), "KCI는 관리자가 키를 등록하면 쓸 수 있어요.");
    assert.match(S.offReason("riss", "unconfigured"), /^RISS는 키를 받으면 쓸 수 있어요\. 지금은 아래 ‘학교 DB에서 찾기’의 \[RISS\]/);
    assert.equal(S.offReason("kci", "other"), "KCI은 지금 쓸 수 없어요.");
  });
});

describe("검색 오류 (6.1절)", () => {
  test("code별 문구 · 버튼", () => {
    assert.deepEqual(S.searchErrorView("source_unconfigured", "kci").actions, ["openalex"]);
    assert.equal(S.searchErrorView("source_unconfigured", "riss").head, "RISS 검색을 아직 쓸 수 없어요.");
    assert.deepEqual(S.searchErrorView("source_unconfigured", "riss").actions, ["riss"]);
    assert.deepEqual(S.searchErrorView("source_key_invalid", "riss").actions, ["openalex", "riss"]);
    assert.equal(S.searchErrorView("source_key_invalid", "kci").head, "KCI 키가 맞지 않거나 사용기간이 끝났어요.");
    assert.match(S.searchErrorView("upstream_limited", "kci").body, /공용 키/);
    assert.equal(S.searchErrorView("upstream_limited", "europepmc").body, "잠시 후 다시 시도해 주세요.");
    assert.deepEqual(S.searchErrorView("upstream_unavailable", "europepmc").actions, ["retry", "openalex"]);
    assert.deepEqual(S.searchErrorView("search_busy", "kci").actions, ["retry"]);
    assert.deepEqual(S.searchErrorView("unsupported_option", "kci").actions, ["relevance"]);
    assert.equal(S.searchErrorView("server_error", "kci"), null);
    assert.equal(S.searchErrorView(undefined, "kci"), null);
  });
});

describe("무료 PDF · OpenCitations (4 · 5장)", () => {
  test("라이선스 이름표는 허용 목록 값만", () => {
    assert.equal(S.licenseLabel("cc-by"), "CC BY");
    assert.equal(S.licenseLabel("CC-BY-NC-ND"), "CC BY-NC-ND");
    assert.equal(S.licenseLabel("public-domain"), "퍼블릭 도메인");
    for (const v of ["other-oa", "publisher-specific-oa", "", null, undefined, 5, "__proto__"]) assert.equal(S.licenseLabel(v), null, String(v));
    assert.equal(S.oaOpenLabel("pdf"), "무료 PDF 열기");
    assert.equal(S.oaOpenLabel("landing"), "무료 원문 페이지 열기");
  });

  test("OpenCitations 기준 줄", () => {
    assert.equal(S.viaLine({ total: 3 }), null);
    assert.equal(S.viaHtml(null), "");
    const v = S.viaLine({ via: "opencitations", total: 1234, unresolved: 4 });
    assert.equal(v.count, "참고문헌 1,234편");
    assert.equal(v.note, "OpenAlex에 참고문헌 정보가 없어 OpenCitations 자료로 채웠어요. 서지를 찾지 못한 4편은 목록에 없어요.");
    assert.ok(!S.viaLine({ via: "opencitations", total: 2, unresolved: 0 }).note.includes("찾지 못한"));
    const h = S.viaHtml({ via: "opencitations", total: 2, unresolved: 0 });
    assert.match(h, /data-via="opencitations"/);
    assert.match(h, />OpenCitations 기준</);
  });

  test("그래프 경고 묶기 (AD-8)", () => {
    const only = GM.groupNotices([{ code: "oc_failed" }]);
    assert.deepEqual(only.map((x) => [x.tone, x.code]), [["info", "oc_failed"]]);
    const both = GM.groupNotices([{ code: "oc_failed" }, { code: "s2_failed" }, { code: "stale_cache" }]);
    assert.deepEqual(both.map((x) => x.tone), ["warn"]);
    assert.deepEqual(both[0].items, ["OpenCitations와 Semantic Scholar가 응답하지 않아 참고문헌을 보강하지 못했어요.", "일부 정보가 오래됐을 수 있어요."]);
    assert.deepEqual(GM.groupNotices([{ code: "s2_failed" }])[0].items, ["Semantic Scholar가 응답하지 않아 참고문헌을 보강하지 못했어요."]);
    assert.equal(GM.toModel({ seed: "W1", nodes: [], edges: [], refs_via: "opencitations" }).refsVia, "opencitations");
  });
});

describe("코드 검사 (AC-582 · K-11)", () => {
  test("결과 글은 esc()로만, 새 탭 링크는 프록시로 감싸지 않음", () => {
    const d = read("discover.js");
    for (const f of ["it.title", "it.venue", "it.abstract", "it.tldr", "it.badges", "b", "m.chip", "v.head", "v.body"]) {
      assert.ok(!d.includes("${" + f + "}"), f);
    }
    assert.ok(!/toInhaProxy|inhaDoiUrl/.test(d.slice(d.indexOf("function oaTabLink"))), "무료 PDF 링크에 프록시 변환 없음");
    const lib = read("library.js");
    assert.ok(lib.includes("data-oa-open") && !/oa_open_url[^;\n]*toInhaProxy/.test(lib));
    assert.ok(!read("sourcemeta.js").includes("document."));
  });

  test("서버 표와 같은 JSON 꼴", () => {
    const src = read("sourcemeta.js");
    const m = src.match(/export const SOURCE_LIMITS = (\{.*?\});/s);
    assert.deepEqual(JSON.parse(m[1]), S.SOURCE_LIMITS);
  });
});
