// extlinks.js 단위 테스트 — docs/specs/inha-proxy.md 13.1절 AC-1 ~ AC-6 (실행: node --test tests/js)

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, test } from "node:test";

import {
  INHA, SCHOLAR_BASE, inhaDoiUrl, inhaSearchTakesQuery, inhaSearchUrl, normalizeQuery, paperProxyTarget, scholarUrl,
  toInhaProxy,
} from "../../paperlab/static/js/extlinks.js";

const P = "https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr";
const DOI = "https://doi-org-ssl.openlink.inha.ac.kr/";
const SCHOLAR_Q = "https://scholar.google.com/scholar?q=";

// AC-2에서 다시 검사할 null이 아닌 출력
const outputs = [];
const keep = (v) => { if (v !== null) outputs.push(v); return v; };

// ------------------------------------------------------------------ AC-1 프록시 변환표
const AC1 = [
  [1, "https://www.dbpia.co.kr/", `${P}/`],
  [2, "https://kiss.kstudy.com/", "https://kiss-kstudy-com-ssl.openlink.inha.ac.kr/"],
  [3, "https://www.riss.kr/index.do", "https://www-riss-kr-ssl.openlink.inha.ac.kr/index.do"],
  [4, "https://www.riss.kr/search/Search.do?query=%EB%94%A5%EB%9F%AC%EB%8B%9D&isDetailSearch=N",
    "https://www-riss-kr-ssl.openlink.inha.ac.kr/search/Search.do?query=%EB%94%A5%EB%9F%AC%EB%8B%9D&isDetailSearch=N"],
  [5, "http://www.riss.kr/", "https://www-riss-kr.openlink.inha.ac.kr/"],
  [6, "http://ieeexplore.ieee.org/document/7780459/", "https://ieeexplore-ieee-org.openlink.inha.ac.kr/document/7780459/"],
  [7, "https://www.thieme-connect.com/products/", "https://www-thieme--connect-com-ssl.openlink.inha.ac.kr/products/"],
  [8, "https://doi.org/10.1109/CVPR.2016.90", "https://doi-org-ssl.openlink.inha.ac.kr/10.1109/CVPR.2016.90"],
  [9, "https://WWW.DBPIA.CO.KR/Journal/ArticleDetail/NODE1", `${P}/Journal/ArticleDetail/NODE1`],
  [10, "https://www.dbpia.co.kr:443/x", `${P}/x`],
  [11, "http://www.riss.kr:80/x", "https://www-riss-kr.openlink.inha.ac.kr/x"],
  [12, "https://www.nature.com/articles/abc#sec1", "https://www-nature-com-ssl.openlink.inha.ac.kr/articles/abc#sec1"],
  [13, "https://www.dbpia.co.kr.", `${P}/`],
  [14, `${P}/x?y=1`, `${P}/x?y=1`],
  [15, "http://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/x", `${P}/x`],
  [16, "https://한국.kr/a", null], // 첫 라벨이 IDN → 결과가 "xn--"로 시작 — 함수가 직접 거름(Chrome은 URL이 거부하지 않음)
  ["16a", "https://www.한국.kr/a", "https://www-xn----3e0b707e-kr-ssl.openlink.inha.ac.kr/a"],
  ["16b", "https://openlink.inha.ac.kr/", null],
  ["16b", "http://openlink.inha.ac.kr/x", null],
  [17, "https://example.com:8443/x", null],
  [18, "https://user:pw@www.dbpia.co.kr/", null],
  [19, "https://127.0.0.1/", null],
  [19, "http://[::1]/", null],
  [19, "http://localhost/", null],
  [19, "http://intranet/", null],
  [20, "javascript:alert(1)", null],
  [20, "data:text/html,x", null],
  [20, "ftp://x.org/", null],
  [20, "file:///C:/a.pdf", null],
  [21, "", null],
  [21, null, null],
  [21, undefined, null],
  [21, "not a url", null],
  [21, "/relative/path", null],
  [21, "www.dbpia.co.kr", null],
  [22, `https://${"a".repeat(30)}.${"b".repeat(30)}.com/`, null],
  [23, "https://evil.com.openlink.inha.ac.kr.attacker.net/",
    "https://evil-com-openlink-inha-ac-kr-attacker-net-ssl.openlink.inha.ac.kr/"],
  [24, "https://foo.ssl/", null],
];

describe("AC-1 toInhaProxy 변환표", () => {
  for (const [n, input, want] of AC1) {
    test(`#${n} ${JSON.stringify(input)}`, () => {
      assert.equal(keep(toInhaProxy(input)), want);
    });
  }

  test("1~24행(16a · 16b 포함)이 모두 표에 있음", () => {
    assert.deepEqual([...new Set(AC1.map((r) => r[0]))],
      [...Array.from({ length: 16 }, (_, i) => i + 1), "16a", "16b", ...Array.from({ length: 8 }, (_, i) => i + 17)]);
  });

  test("추가: 이미 프록시인 주소는 두 번 감싸지 않음(루트 · 하위 · 대문자 · 끝 점)", () => {
    // 프록시 루트 호스트 자체는 8단계 검사(호스트가 ".openlink.inha.ac.kr"로 끝남)에 걸려 null
    assert.equal(toInhaProxy("https://openlink.inha.ac.kr/a"), null);
    assert.equal(keep(toInhaProxy("https://WWW-DBPIA-CO-KR-SSL.OPENLINK.INHA.AC.KR./x")), `${P}/x`);
    assert.equal(keep(toInhaProxy(toInhaProxy("https://www.dbpia.co.kr/x"))), `${P}/x`);
  });

  test("추가: 이미 프록시인 주소도 포트 · 계정 정보가 있으면 null", () => {
    assert.equal(toInhaProxy("https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr:8443/x"), null);
    assert.equal(toInhaProxy("https://u:p@www-dbpia-co-kr-ssl.openlink.inha.ac.kr/x"), null);
  });

  test("추가: 문자열이 아닌 입력 · 그 밖의 스킴 · IP 꼴 · 63자 경계", () => {
    for (const x of [123, {}, [], new URL("https://www.dbpia.co.kr/"), "mailto:a@b.com", "vbscript:x", "blob:https://a.com/x",
      "https://0x7f.1/", "http://10.0.0.1:80/", "https://[2001:db8::1]/", "https://user@www.dbpia.co.kr/"]) {
      assert.equal(toInhaProxy(x), null, String(x));
    }
    // 라벨 59자 + "-ssl" = 63자는 통과, 64자는 null
    const host63 = `${"a".repeat(55)}.com`; // 59자
    assert.equal(keep(toInhaProxy(`https://${host63}/`)), `https://${"a".repeat(55)}-com-ssl.openlink.inha.ac.kr/`);
    assert.equal(toInhaProxy(`https://a${host63}/`), null);
    assert.equal(keep(toInhaProxy(`http://a${host63}/`)), `https://a${"a".repeat(55)}-com.openlink.inha.ac.kr/`);
  });

  test("I-1: 첫 라벨이 xn--(IDN)이면 null — 퓨니코드로 직접 쓴 주소 · http도 같음, 첫 라벨이 아니면 변환", () => {
    for (const u of ["https://xn--3e0b707e.kr/a", "http://xn--3e0b707e.kr/a", "https://XN--3E0B707E.KR/", "https://한국.한국/"]) {
      assert.equal(toInhaProxy(u), null, u);
    }
    assert.equal(keep(toInhaProxy("https://www.xn--3e0b707e.kr/a")), "https://www-xn----3e0b707e-kr-ssl.openlink.inha.ac.kr/a");
    assert.equal(keep(toInhaProxy("http://www.한국.kr/")), "https://www-xn----3e0b707e-kr.openlink.inha.ac.kr/");
    // "xn"으로 시작하지만 IDN이 아닌 라벨은 그대로 변환
    assert.equal(keep(toInhaProxy("https://xna.com/")), "https://xna-com-ssl.openlink.inha.ac.kr/");
    // "xn-"로 시작하면 하이픈이 두 배가 돼 결과가 "xn--"로 시작 → 역시 null (만든 라벨 기준)
    assert.equal(toInhaProxy("https://xn-a.com/"), null);
  });

  test("m-1: 호스트 라벨은 [a-z0-9-]만 — 따옴표 · 백틱 · 중괄호 · % · & · _ 등은 null", () => {
    for (const h of ['a"b.com', "a`b.com", "a{b}.com", "a%20b.com", "a&b.com", "a_b.com", "a!b.com", "a$b.com",
      "a'b.com", "a(b).com", "a*b.com", "a+b.com", "a,b.com", "a;b.com", "a=b.com", "a~b.com"]) {
      assert.equal(toInhaProxy(`https://${h}/`), null, h);
    }
    // 하이픈 · 숫자는 허용
    assert.equal(keep(toInhaProxy("https://a-1.b2.com/")), "https://a--1-b2-com-ssl.openlink.inha.ac.kr/");
  });

  test("추가: 경로 · 쿼리의 퍼센트 인코딩은 다시 인코딩하지 않음", () => {
    assert.equal(keep(toInhaProxy("https://www.dbpia.co.kr/a%20b?q=%25&x=%2F")), `${P}/a%20b?q=%25&x=%2F`);
  });
});

// ------------------------------------------------------------------ AC-3 DOI
const NEUNET = `${DOI}10.1016/j.neunet.2014.09.003`;
const AC3 = [
  [1, "10.1109/CVPR.2016.90", `${DOI}10.1109/CVPR.2016.90`],
  [2, "https://doi.org/10.1016/j.neunet.2014.09.003", NEUNET],
  [3, "doi:10.1016/j.neunet.2014.09.003", NEUNET],
  [3, "  DOI:10.1016/j.neunet.2014.09.003 ", NEUNET],
  [3, "http://dx.doi.org/10.1016/j.neunet.2014.09.003", NEUNET],
  [4, "10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0",
    `${DOI}10.1002/(SICI)1097-4571(199806)49%3A8%3C693%3A%3AAID-ASI4%3E3.0.CO%3B2-0`],
  [5, "10.1234/ab#c?d=1", `${DOI}10.1234/ab%23c%3Fd%3D1`],
  [6, "", null],
  [6, "abc", null],
  [6, "11.1234/x", null],
  [6, "10.12/x", null],
  [6, "10.1234/", null],
  [6, "https://doi.org/", null],
  [7, "https://doi.org/10.1002/(SICI)1097-4571(199806)49%3A8%3C693%3A%3AAID-ASI4%3E3.0.CO%3B2-0",
    `${DOI}10.1002/(SICI)1097-4571(199806)49%3A8%3C693%3A%3AAID-ASI4%3E3.0.CO%3B2-0`],
];

describe("AC-3 inhaDoiUrl", () => {
  for (const [n, input, want] of AC3) {
    test(`#${n} ${JSON.stringify(input)}`, () => {
      assert.equal(keep(inhaDoiUrl(input)), want);
    });
  }

  test("추가: null · undefined · 공백 든 DOI · 짝 잃은 서로게이트는 null", () => {
    for (const x of [null, undefined, "10.1234/a b", "10.1234/\uD800x", "10.1234567890/x"]) assert.equal(inhaDoiUrl(x), null, String(x));
  });

  test("추가: 대문자 그대로 · 주소 꼴의 퍼센트 인코딩은 한 번만", () => {
    assert.equal(keep(inhaDoiUrl("HTTPS://DOI.ORG/10.1109/CVPR.2016.90")), `${DOI}10.1109/CVPR.2016.90`);
    assert.equal(keep(inhaDoiUrl("https://doi.org/10.1234/a%3Cb")), `${DOI}10.1234/a%3Cb`);
  });
});

// ------------------------------------------------------------------ AC-4 논문 대상
const AC4 = [
  [1, { doi: "10.1109/cvpr.2016.90", url: "https://ieeexplore.ieee.org/document/7780459" }, `${DOI}10.1109/cvpr.2016.90`],
  [2, { doi: "", url: "https://doi.org/10.1109/CVPR.2016.90" }, `${DOI}10.1109/CVPR.2016.90`],
  [3, { doi: "", url: "https://www.dbpia.co.kr/journal/articleDetail?nodeId=NODE1" }, `${P}/journal/articleDetail?nodeId=NODE1`],
  [4, { doi: "", url: "https://arxiv.org/abs/1706.03762" }, null],
  [4, { url: "https://openalex.org/W1" }, null],
  [4, { url: "https://www.semanticscholar.org/paper/x" }, null],
  [4, { url: "https://www.kci.go.kr/kciportal/x" }, null],
  [5, { doi: "", url: "" }, null],
  [5, {}, null],
  [6, { doi: "not-a-doi", url: "https://link.springer.com/article/x" }, "https://link-springer-com-ssl.openlink.inha.ac.kr/article/x"],
  [7, { doi: "", url: "https://doi.org/" }, null],
  [7, { url: "https://dx.doi.org/" }, null],
];

describe("AC-4 paperProxyTarget", () => {
  for (const [n, p, want] of AC4) {
    test(`#${n} ${JSON.stringify(p)}`, () => {
      assert.equal(keep(paperProxyTarget(p)), want);
    });
  }

  test("추가: 제외 목록(하위 도메인 · KCI 두 이름 · Scholar)", () => {
    for (const url of ["https://export.arxiv.org/abs/1", "https://api.openalex.org/W1", "https://api.semanticscholar.org/x",
      "https://kci.go.kr/x", "https://scholar.google.com/scholar?q=x", "https://ARXIV.ORG/abs/1"]) {
      assert.equal(paperProxyTarget({ url }), null, url);
    }
    // 이름만 비슷한 호스트는 제외되지 않음
    assert.equal(keep(paperProxyTarget({ url: "https://notarxiv.org/x" })), "https://notarxiv-org-ssl.openlink.inha.ac.kr/x");
  });

  test("추가: dx.doi.org 주소 · 인코딩된 DOI 주소 · DOI 아닌 doi.org 주소", () => {
    assert.equal(keep(paperProxyTarget({ url: "http://dx.doi.org/10.1016/j.neunet.2014.09.003" })), NEUNET);
    assert.equal(keep(paperProxyTarget({ url: "https://doi.org/10.1002/abc%3C1%3E" })), `${DOI}10.1002/abc%3C1%3E`);
    assert.equal(paperProxyTarget({ url: "https://doi.org/" }), null);
  });

  test("추가: null · 문자열 아닌 값 · pdf_url만 있는 논문", () => {
    for (const p of [null, undefined, "https://www.dbpia.co.kr/", { url: 5 }, { pdf_url: "https://www.dbpia.co.kr/a.pdf" }]) {
      assert.equal(paperProxyTarget(p), null, JSON.stringify(p));
    }
  });
});

// ------------------------------------------------------------------ AC-2 출력 불변식 (AC-1 · AC-3 · AC-4 뒤에 실행)
describe("AC-2 출력 불변식", () => {
  test("null이 아닌 모든 프록시 출력은 https · *.openlink.inha.ac.kr · 계정 정보와 포트 없음", () => {
    for (const s of [...AC1, ...AC3, ...AC4].map((r) => r[2]).filter((x) => x !== null)) outputs.push(s);
    for (const db of Object.keys(INHA.searchTemplates)) outputs.push(inhaSearchUrl(db, "딥러닝"));
    assert.ok(outputs.length >= 40, `검사한 출력 ${outputs.length}개`);
    for (const s of outputs) {
      const u = new URL(s);
      assert.equal(u.protocol, "https:", s);
      assert.ok(u.hostname.endsWith(".openlink.inha.ac.kr"), s);
      assert.equal(u.username, "", s);
      assert.equal(u.password, "", s);
      assert.equal(u.port, "", s);
    }
  });
});

// ------------------------------------------------------------------ AC-5 학교 DB 검색
const ENC = "%EB%94%A5%EB%9F%AC%EB%8B%9D"; // 딥러닝

describe("AC-5 inhaSearchUrl", () => {
  test("#1 riss", () => {
    assert.equal(inhaSearchUrl("riss", "딥러닝"),
      `https://www-riss-kr-ssl.openlink.inha.ac.kr/search/Search.do?isDetailSearch=N&searchGubun=true&viewYn=OP&query=${ENC}`);
  });
  test("#2 dbpia", () => {
    assert.equal(inhaSearchUrl("dbpia", "딥러닝"), `${P}/search/topSearch?searchOption=all&query=${ENC}`);
  });
  test("#3 kiss (임시안 — 첫 페이지)", () => {
    assert.equal(inhaSearchUrl("kiss", "딥러닝"), "https://kiss-kstudy-com-ssl.openlink.inha.ac.kr/");
  });
  test("#4 매개변수 주입 안 됨", () => {
    const s = inhaSearchUrl("riss", "a&query=b");
    assert.ok(s.endsWith("&query=a%26query%3Db"), s);
    const params = new URL(s).searchParams;
    assert.deepEqual(params.getAll("query"), ["a&query=b"]);
    assert.deepEqual([...params.keys()], ["isDetailSearch", "searchGubun", "viewYn", "query"]);
  });
  test("#5 빈 질의는 null", () => {
    assert.equal(inhaSearchUrl("riss", "  \n\t "), null);
    assert.equal(inhaSearchUrl("dbpia", ""), null);
    assert.equal(inhaSearchUrl("kiss", null), null);
  });
  test("#6 모르는 db는 null", () => {
    assert.equal(inhaSearchUrl("unknown", "x"), null);
    for (const db of ["toString", "__proto__", "constructor", "RISS", null, undefined, 1]) assert.equal(inhaSearchUrl(db, "x"), null, String(db));
  });
  test("inhaSearchTakesQuery: RISS · DBpia는 질의가 들어가고 KISS(임시안) · 모르는 db는 아님", () => {
    assert.equal(inhaSearchTakesQuery("riss"), true);
    assert.equal(inhaSearchTakesQuery("dbpia"), true);
    assert.equal(inhaSearchTakesQuery("kiss"), false);
    for (const db of ["unknown", "toString", "__proto__", "", null, undefined, 1]) assert.equal(inhaSearchTakesQuery(db), false, String(db));
    // 질의가 들어가는 DB는 결과 주소에 인코딩한 질의가 있고, 아니면 없음
    for (const db of Object.keys(INHA.searchTemplates)) {
      assert.equal(inhaSearchUrl(db, "딥러닝").includes(ENC), inhaSearchTakesQuery(db), db);
    }
  });
  test("추가: 질의는 정규화 뒤 인코딩, '$' 같은 치환 패턴도 그대로", () => {
    assert.equal(inhaSearchUrl("dbpia", "  딥러닝\n"), `${P}/search/topSearch?searchOption=all&query=${ENC}`);
    assert.equal(inhaSearchUrl("dbpia", "$& $1"), `${P}/search/topSearch?searchOption=all&query=%24%26%20%241`);
  });
});

// ------------------------------------------------------------------ AC-6 Scholar · 질의 정규화
const qOf = (url) => new URL(url).searchParams.get("q");
const scholarOutputs = [];
const sk = (q) => { const v = scholarUrl(q); if (v !== null) scholarOutputs.push(v); return v; };

describe("AC-6 scholarUrl · normalizeQuery", () => {
  test("#1 영문", () => {
    assert.equal(sk("deep residual learning"), `${SCHOLAR_Q}deep%20residual%20learning`);
  });
  test("#2 줄바꿈 · 탭 · 연속 공백", () => {
    assert.equal(sk("딥러닝  기반\n결함\t검출"), SCHOLAR_Q + encodeURIComponent("딥러닝 기반 결함 검출"));
  });
  test("#3 매개변수 q 하나뿐", () => {
    const s = sk("a&b=c#d");
    assert.equal(s, `${SCHOLAR_Q}a%26b%3Dc%23d`);
    assert.deepEqual([...new URL(s).searchParams.keys()], ["q"]);
  });
  test("#4 형식 문자 · NUL 제거", () => {
    assert.equal(normalizeQuery("\u200B딥\uFEFF러닝\u0000"), "딥러닝");
    assert.equal(qOf(sk("\u200B딥\uFEFF러닝\u0000")), "딥러닝");
  });
  test("#5 빈 질의는 null", () => {
    for (const x of ["", "   ", "\n\t\r", "\u200B", null, undefined]) {
      assert.equal(scholarUrl(x), null, JSON.stringify(x));
      assert.equal(normalizeQuery(x), "");
    }
  });
  test("#6 300자 → 정확히 256자", () => {
    assert.equal(Array.from(qOf(sk("a".repeat(300)))).length, 256);
    assert.equal(normalizeQuery("a".repeat(300)), "a".repeat(256));
  });
  test("#7 단어 중간에서 자르지 않음", () => {
    const q = qOf(sk("word ".repeat(80)));
    assert.ok(Array.from(q).length <= 256);
    assert.notEqual(q.at(-1), " ");
    assert.ok(q.endsWith("word"), q.slice(-10));
  });
  test("#8 이모지가 255~256자 경계에 걸쳐도 올바른 UTF-16", () => {
    for (const pre of [254, 255, 256]) {
      const input = "a".repeat(pre) + "😀".repeat(5);
      const q = normalizeQuery(input);
      assert.ok(q.isWellFormed(), `pre=${pre}`);
      assert.ok(Array.from(q).length <= 256);
      assert.doesNotThrow(() => encodeURIComponent(q));
      assert.equal(qOf(sk(input)), q);
    }
    assert.equal(normalizeQuery("a".repeat(255) + "😀😀"), "a".repeat(255) + "😀");
  });
  test("#9a 짝 잃은 서로게이트(상위 0xD800 · 하위 0xDC00)는 지움", () => {
    const input = "딥" + String.fromCharCode(0xD800) + "러닝" + String.fromCharCode(0xDC00);
    assert.equal(normalizeQuery(input), "딥러닝");
    assert.doesNotThrow(() => scholarUrl(input));
    assert.equal(qOf(sk(input)), "딥러닝");
  });
  test("#9 \\u3000 · \\u00A0 공백", () => {
    assert.equal(normalizeQuery("\u3000딥러닝\u00A0모델 "), "딥러닝 모델");
    assert.equal(qOf(sk("\u3000딥러닝\u00A0모델 ")), "딥러닝 모델");
  });
  test("추가: NFC 정규화 · 짝 잃은 서로게이트 · 제어 문자(\\u007F~\\u009F)", () => {
    assert.equal(normalizeQuery("\u1100\u1161"), "가"); // 자모 → 완성형
    assert.equal(normalizeQuery("a\uD800b"), "ab");
    assert.equal(normalizeQuery("a\u007Fb\u0085c\u009Fd"), "a b c d");
    assert.notEqual(sk("a\uDC00"), null);
    assert.equal(normalizeQuery(42), "42");
  });
  test("추가: 40자 안에 공백이 없으면 256자에서 그대로 자름", () => {
    const input = "x ".repeat(100) + "y".repeat(100); // 공백은 199번째 글자까지
    assert.equal(Array.from(normalizeQuery(input)).length, 256);
  });
  test("#10 모든 결과: 고정 접두 · 호스트 scholar.google.com · 키는 q 하나", () => {
    assert.equal(SCHOLAR_BASE, "https://scholar.google.com/scholar");
    for (const q of ["x", "?q=1&hl=ko", "https://evil.com/", "#frag", "a+b", "'\"<>"]) sk(q);
    assert.ok(scholarOutputs.length >= 15, `검사한 출력 ${scholarOutputs.length}개`);
    for (const s of scholarOutputs) {
      assert.ok(s.startsWith(SCHOLAR_Q), s);
      const u = new URL(s);
      assert.equal(u.hostname, "scholar.google.com");
      assert.deepEqual([...u.searchParams.keys()], ["q"], s);
      assert.equal(u.hash, "");
    }
  });
});

// ------------------------------------------------------------------ 상수 · 모듈 규칙 (14장 · AC-7 일부)
describe("상수와 모듈 규칙", () => {
  test("INHA 상수: 값 · 얼려 둠", () => {
    assert.equal(INHA.suffix, ".openlink.inha.ac.kr");
    assert.equal(INHA.sslTag, "-ssl");
    assert.equal(INHA.label, "인하대");
    assert.ok(Object.isFrozen(INHA) && Object.isFrozen(INHA.searchTemplates) && Object.isFrozen(INHA.noProxyHosts)
      && Object.isFrozen(INHA.buttons));
    assert.deepEqual(Object.keys(INHA.searchTemplates).sort(), ["dbpia", "kiss", "riss"]);
  });
  test("학교 로그인 주소는 도서관 로그인 화면으로 고정(IU-1) — 쿼리 · 조각 없음, 프록시로 감싸지 않음", () => {
    assert.equal(INHA.loginUrl, "https://lib.inha.ac.kr/login");
    const u = new URL(INHA.loginUrl);
    assert.equal(u.protocol, "https:");
    assert.equal(u.search, "");
    assert.equal(u.hash, "");
    assert.equal(u.username + u.password + u.port, "");
  });
  test("버튼 이름(IU-5 확정)", () => {
    assert.deepEqual({ ...INHA.buttons }, {
      view: "인하대에서 보기", searchDb: "학교 DB에서 찾기", login: "학교 로그인", scholar: "Google Scholar에서 보기",
    });
  });
  test("extlinks.js에 fetch · XMLHttpRequest · import · DOM 접근이 없음", () => {
    const src = readFileSync(new URL("../../paperlab/static/js/extlinks.js", import.meta.url), "utf8");
    const code = src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n"); // 주석 제외
    for (const word of [/\bfetch\b/, /XMLHttpRequest/, /^\s*import\b/m, /\bimport\s*\(/, /\bdocument\b/, /\bwindow\b/, /localStorage/]) {
      assert.doesNotMatch(code, word);
    }
  });
});

// ------------------------------------------------------------------ AC-7 화면 파일 (검색으로 확인하는 항목)
describe("AC-7 화면 파일", () => {
  const dir = new URL("../../paperlab/static/js/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "extlinks.js");
  const read = (f) => readFileSync(new URL(f, dir), "utf8");

  test("openlink · scholar.google 주소는 extlinks.js에만 (화면 파일 하드코딩 없음)", () => {
    for (const f of files) assert.doesNotMatch(read(f), /openlink|scholar\.google/i, f);
  });
  test("새 학교 · Scholar 링크는 모두 rel=\"noopener noreferrer\", 스크립트로 여는 곳은 noopener,noreferrer", () => {
    let n = 0;
    for (const f of files) {
      for (const tag of read(f).match(/<a [^>]*data-(?:inha-open|inha-login|scholar-open)[^>]*>/g) || []) {
        n++;
        assert.match(tag, /target="_blank"/, `${f}: ${tag}`);
        assert.match(tag, /rel="noopener noreferrer"/, `${f}: ${tag}`);
      }
    }
    assert.ok(n >= 5, `검사한 링크 ${n}개`);
    assert.match(read("dialogs.js"), /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
  });
  test("학교 계정 입력 칸 없음 (inha · 학교 구역에 type=password 없음)", () => {
    const d = read("dialogs.js");
    const school = d.slice(d.indexOf('id="set-school-title"'), d.indexOf('<div class="section-title">계정</div>'));
    assert.ok(school.length > 0);
    assert.doesNotMatch(school, /type="password"|<input/);
  });
});
