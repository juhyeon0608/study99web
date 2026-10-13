"""5단계 API 시험 — 테스트용 Supabase([db]) + 가짜 외부 서비스 (docs/specs/phase5-korean-db.md 12장).

KCI · RISS · Europe PMC는 손 픽스처, OpenAlex · Crossref · PDF 서버 · OpenCitations는 가짜 전송. 실제 외부 요청은 실패(AC-575).
공용 캐시 행은 고유 대역(OpenAlex 번호 9_0xx… · DOI 10.99999/plt5-…)만 쓰고 끝나면 지운다.
"""

from __future__ import annotations

import json
import logging
import secrets
import threading
from urllib.parse import unquote

import httpx
import psycopg
import pytest

from paperlab import extsources as ex
from paperlab.sources import GraphSources, RateLimiter, Sources

from .conftest import make_pdf
from .fixtures.citegraph import FakeUpstream, World
from .test_extsources import FX, KCI_KEY, NO_LIMIT, RISS_KEY, Rec, fixture_answer, no_real_network, quiet_httpx  # noqa: F401
from .test_graph_api import _band, _cleanup

pytestmark = pytest.mark.db
RUN = secrets.token_hex(3)
PDF = make_pdf(title="Phase Five Downloaded Paper", doi="")
IP = "93.184.215.14"


class FakeWeb:
    """가짜 OpenAlex(/works/doi:) · Crossref(/works/) · PDF 서버. requests = [(호스트, 경로)]"""

    def __init__(self):
        self.works: dict[str, dict] = {}
        self.crossref: dict[str, dict] = {}
        self.requests: list[tuple[str, str]] = []
        self.lock = threading.Lock()

    def __call__(self, r: httpx.Request):
        host = r.headers.get("host", r.url.host).split(":")[0] if r.url.host == IP else r.url.host
        with self.lock:
            self.requests.append((host, r.url.path))
        if host == "api.openalex.org" and r.url.path.startswith("/works/doi:"):
            w = self.works.get(unquote(r.url.path[len("/works/doi:"):]))
            return httpx.Response(200, json=w) if w else httpx.Response(404)
        if host == "api.crossref.org":
            m = self.crossref.get(unquote(r.url.path[len("/works/"):]))
            return httpx.Response(200, json={"message": m}) if m else httpx.Response(404)
        if host.endswith(".example.org") or host in ("arxiv.org", "evil.example"):
            return httpx.Response(200, content=PDF)
        return httpx.Response(404)

    def hosts(self, kind=None):
        return [h for h, _ in self.requests if kind is None or h == kind]


def doi(name: str) -> str:
    return f"10.99999/plt5-{RUN}-{name}"


def oa_work(d: str, best=None, locs=()) -> dict:
    return {"id": "https://openalex.org/W91" + str(abs(hash(d)) % 10**9), "doi": f"https://doi.org/{d}", "display_name": d,
            "open_access": {"is_oa": bool(best or locs)}, "best_oa_location": best, "oa_locations": list(locs)}


def loc(pdf, lic=None, landing=None):
    return {"pdf_url": pdf, "landing_page_url": landing, "license": lic, "version": "publishedVersion"}


@pytest.fixture
def web(cloud):
    w = FakeWeb()
    cloud.app.state.sources_factory = lambda get: Sources(get, transport=httpx.MockTransport(w), resolver=lambda h, p: [IP])
    rec = Rec(fixture_answer)
    cloud.app.state.ext = ex.ExtSources(KCI_KEY, RISS_KEY, transport=rec.transport(), limiters=NO_LIMIT, sleep=lambda s: None)
    w.ext = rec
    return w


def _admin(project):
    return psycopg.connect(project.admin_db, autocommit=True, prepare_threshold=None)


# ====================================================================== 검색 · 서재 (50x)
def test_search_add_duplicate_and_nothing_cached(cloud, web, caplog, quiet_httpx):
    """AC-507 · 564 · 571: 세 소스 카드를 서재에 넣고, 다시 검색하면 in_library, 다시 넣으면 409.
    검색 뒤 공용 캐시 행 수가 늘지 않고 어떤 표에도 검색어가 없음, 로그에 키 · 검색어 없음"""
    caplog.set_level(logging.DEBUG)
    c = cloud.client(cloud.user())
    q = f"plt5검색어{RUN}"
    with _admin(cloud.project) as conn:
        before = conn.execute("select count(*) from paperlab.external_works").fetchone()[0]
    for source in ("kci", "riss", "europepmc"):
        r = c.get("/api/search", params={"q": q, "source": source})
        assert r.status_code == 200, r.text
        item = r.json()["items"][0]
        assert item["source"] == source and item["in_library"] is None
        added = c.post("/api/papers", json=item)
        assert added.status_code == 200, added.text
        pid = added.json()["paper"]["id"]
        again = c.get("/api/search", params={"q": q, "source": source}).json()["items"][0]
        assert again["in_library"] == pid
        assert c.post("/api/papers", json=item).status_code == 409
    assert c.get(f"/api/papers/{pid}").json()["url"].startswith("https://europepmc.org/article/MED/")
    with _admin(cloud.project) as conn:
        assert conn.execute("select count(*) from paperlab.external_works").fetchone()[0] == before
        assert conn.execute("select count(*) from paperlab.external_works where source <> 'openalex'").fetchone()[0] == 0
        for sql in ("select count(*) from paperlab.external_works where title like %s",
                    "select count(*) from paperlab.papers where title like %s or abstract like %s"):
            assert conn.execute(sql, (f"%{q}%",) * sql.count("%s")).fetchone()[0] == 0
    assert KCI_KEY not in caplog.text and RISS_KEY not in caplog.text and q not in caplog.text


def test_search_errors_and_status(cloud, web):
    """AC-503 · 504 · 506 · 11장: 키 없음 503 · 미지원 400 · 동시 2개 넘으면 429 · DOI는 resolve 경로 · /api/sources"""
    u = cloud.user()
    c = cloud.client(u)
    assert c.get("/api/sources").json() == {"kci": {"enabled": True}, "riss": {"enabled": True}, "europepmc": {"enabled": True}}
    r = c.get("/api/search", params={"q": "x", "source": "kci", "sort": "cited"})
    assert (r.status_code, r.json()["code"]) == (400, "unsupported_option")
    web.works["10.1234/plt5"] = oa_work("10.1234/plt5")
    r = c.get("/api/search", params={"q": "10.1234/plt5", "source": "kci"})
    assert r.status_code == 200 and r.json()["items"][0]["doi"] == "10.1234/plt5"
    assert web.ext.requests == []  # AC-506 · 503 — KCI 가짜 전송 호출 0회
    cloud.app.state.ext = ex.ExtSources(KCI_KEY, "", transport=web.ext.transport(), limiters=NO_LIMIT)
    r = c.get("/api/search", params={"q": "x", "source": "riss"})
    assert (r.status_code, r.json()["code"]) == (503, "source_unconfigured") and web.ext.requests == []
    st = c.get("/api/sources")
    assert st.json()["riss"] == {"enabled": False, "reason": "unconfigured"} and KCI_KEY not in st.text
    assert c.get("/api/search", params={"q": "x", "source": "kci"}).status_code == 200
    cloud.app.state.ext_busy[u.id] = 2
    r = c.get("/api/search", params={"q": "x", "source": "kci"})
    assert (r.status_code, r.json()["code"]) == (429, "search_busy")
    cloud.app.state.ext_busy.pop(u.id)


# ====================================================================== 무료 PDF (54x)
def _paper(c, **kw):
    return c.post("/api/papers", json={"title": f"Phase five paper {secrets.token_hex(4)}", "allow_duplicate": True, **kw}).json()["paper"]["id"]


def test_fetch_pdf_license_rules(cloud, web):
    """AC-544 · 547 · 548 · 팀장 결정 3(open_kind · license)"""
    u = cloud.user()
    c = cloud.client(u)
    key = lambda pid: f"users/{u.id}/papers/{pid}.pdf"  # noqa: E731
    puts = lambda: [k for op, k in cloud.storage.log if op == "put"]  # noqa: E731
    D = {n: doi(n) for n in ("ccby", "nolic", "other", "pubspec", "mixed", "crossref", "landing", "none")}
    web.works[D["ccby"]] = oa_work(D["ccby"], loc("https://files.example.org/ccby.pdf", "cc-by"))
    web.works[D["nolic"]] = oa_work(D["nolic"], loc("https://pub.example.org/nolic.pdf"))
    web.works[D["other"]] = oa_work(D["other"], loc("https://pub.example.org/other.pdf", "other-oa"))
    web.works[D["pubspec"]] = oa_work(D["pubspec"], loc("https://pub.example.org/ps.pdf", "publisher-specific-oa"))
    web.works[D["mixed"]] = oa_work(D["mixed"], loc("https://pub.example.org/m.pdf", "publisher-specific-oa"),
                                    [loc("https://pub.example.org/m.pdf", "publisher-specific-oa"),
                                     loc("https://repo.example.org/m-accepted.pdf", "cc-by")])
    web.works[D["landing"]] = oa_work(D["landing"], loc(None, None, "https://pub.example.org/landing"))
    web.crossref[D["crossref"]] = {"title": ["x"], "link": [{"content-type": "application/pdf", "URL": "https://pub.example.org/cr.pdf"}]}

    pid = _paper(c, doi=D["ccby"])
    r = c.post(f"/api/papers/{pid}/fetch-pdf").json()
    assert r["paper"]["has_pdf"] and r["license"] == "cc-by" and key(pid) in puts()
    assert "files.example.org" in web.hosts()
    for name, url in (("nolic", "https://pub.example.org/nolic.pdf"), ("other", "https://pub.example.org/other.pdf"),
                      ("pubspec", "https://pub.example.org/ps.pdf")):
        pid = _paper(c, doi=D[name])
        r = c.post(f"/api/papers/{pid}/fetch-pdf")
        assert r.status_code == 200 and r.json() == {"open_url": url, "open_kind": "pdf", "reason": "license_unknown"}, name
        assert key(pid) not in puts() and "openlink" not in r.text
    pid = _paper(c, doi=D["mixed"])
    assert c.post(f"/api/papers/{pid}/fetch-pdf").json()["paper"]["has_pdf"] and "repo.example.org" in web.hosts()
    pid = _paper(c, doi=D["landing"])
    assert c.post(f"/api/papers/{pid}/fetch-pdf").json() == {"open_url": "https://pub.example.org/landing",
                                                              "open_kind": "landing", "reason": "license_unknown"}
    pid = _paper(c, doi=D["crossref"])  # K-12 · K-22: Crossref link만 → 새 탭
    assert c.post(f"/api/papers/{pid}/fetch-pdf").json()["open_url"] == "https://pub.example.org/cr.pdf" and key(pid) not in puts()
    # D1: 서재 pdf_url은 허용 라이선스 OpenAlex 위치와 글자 그대로 같을 때만 받음 — 그 밖(라이선스 없는 위치 · 사용자가 넣은
    # 주소 · S2 · Crossref 주소 · ? 붙인 변형 · http 변형)은 모두 새 탭, 그 주소로 요청 0회
    pid = _paper(c, doi=D["ccby"], pdf_url="https://files.example.org/ccby.pdf")
    assert c.post(f"/api/papers/{pid}/fetch-pdf").json()["license"] == "cc-by" and key(pid) in puts()
    for d, url in ((D["nolic"], "https://pub.example.org/nolic.pdf"), (D["nolic"], "https://mine.example.org/own.pdf"),
                   (D["ccby"], "https://pdfs.semanticscholar.org/aa/bb.pdf"), (D["crossref"], "https://pub.example.org/cr.pdf"),
                   (D["ccby"], "https://files.example.org/ccby.pdf?dl=1"), (D["ccby"], "http://files.example.org/ccby.pdf"),
                   ("", "https://mine.example.org/nodoi.pdf")):
        pid = _paper(c, doi=d, pdf_url=url)
        r = c.post(f"/api/papers/{pid}/fetch-pdf").json()
        assert r == {"open_url": url, "open_kind": "pdf", "reason": "license_unknown"} and key(pid) not in puts(), url
    assert not [h for h in web.hosts() if h in ("mine.example.org", "pdfs.semanticscholar.org")]
    # arXiv(경계 ② — U-3 예외): pdf_url이 arxiv.org · arXiv 번호
    pid = _paper(c, doi=D["nolic"], pdf_url="https://arxiv.org/pdf/2101.00001")
    assert c.post(f"/api/papers/{pid}/fetch-pdf").json()["paper"]["has_pdf"]
    pid = _paper(c, arxiv_id="2101.00002")
    assert c.post(f"/api/papers/{pid}/fetch-pdf").json()["paper"]["has_pdf"] and web.hosts("arxiv.org")
    # AC-547: 본문의 주소는 쓰지 않음
    pid = _paper(c, doi=D["none"])
    r = c.post(f"/api/papers/{pid}/fetch-pdf", json={"pdf_url": "https://evil.example/x.pdf"})
    assert r.status_code == 404 and "evil.example" not in web.hosts()
    assert not [h for h in web.hosts() if h.endswith("openlink.inha.ac.kr") or h == "api.unpaywall.org"]


def test_add_paper_rejudges_pdf_url(cloud, web):
    """팀장 결정 1(K-11 보강): [PDF 포함 추가]가 보낸 pdf_url을 믿지 않고 8.3절 판정 — 통과 못하면 PDF 없이 추가 + 새 탭 안내"""
    u = cloud.user()
    c = cloud.client(u)
    d1, d2 = doi("add-nolic"), doi("add-cc")
    web.works[d1] = oa_work(d1, loc("https://pub.example.org/add-nolic.pdf"))
    web.works[d2] = oa_work(d2, loc("https://files.example.org/add-cc.pdf", "cc-by"))
    r = c.post("/api/papers", json={"title": "Rejudge nolicense", "doi": d1, "pdf_url": "https://pub.example.org/add-nolic.pdf",
                                    "download_pdf": True}).json()
    assert r["paper"]["has_pdf"] is False and r["open_url"] == "https://pub.example.org/add-nolic.pdf"
    assert r["open_kind"] == "pdf" and r["reason"] == "license_unknown" and "라이선스" in r["warning"]
    assert "pub.example.org" not in web.hosts()
    r = c.post("/api/papers", json={"title": "Rejudge cc by", "doi": d2, "pdf_url": "https://files.example.org/add-cc.pdf",
                                    "download_pdf": True}).json()
    assert r["paper"]["has_pdf"] is True and "open_url" not in r
    r = c.post("/api/papers", json={"title": "Openlink attempt", "pdf_url": "https://www-x-com-ssl.openlink.inha.ac.kr/a.pdf",
                                    "download_pdf": True}).json()
    assert r["paper"]["has_pdf"] is False and r["warning"]
    for url in ("https://pdfs.semanticscholar.org/x.pdf", "https://files.example.org/add-cc.pdf?x=1"):  # D1: 그 밖 주소
        r = c.post("/api/papers", json={"title": f"Rejudge {url}", "doi": d2, "pdf_url": url, "download_pdf": True,
                                        "allow_duplicate": True}).json()
        assert r["paper"]["has_pdf"] is False and r["open_url"] == url, url
    r = c.post("/api/papers", json={"title": "Rejudge ftp", "pdf_url": "ftp://files.example.org/a.pdf",
                                    "download_pdf": True}).json()  # plan_pdf None → TypeError 아님
    assert r["paper"]["has_pdf"] is False and "찾지 못했어요" in r["warning"] and "open_url" not in r
    assert not [h for h in web.hosts() if "openlink" in h]


def test_oa_lookup_cache(cloud, web):
    """AC-545: 1B 캐시 행(oa_license 있음) → OpenAlex 0회 · cached(다른 사용자도). null · 행 없음 → 1회 · cached false,
    조회 결과는 external_works에 쓰지 않음"""
    base = _band()
    d_cached, d_null, d_none, d_empty = doi("lk-cached"), doi("lk-null"), doi("lk-none"), doi("lk-empty")
    try:
        with _admin(cloud.project) as conn:
            conn.execute("insert into paperlab.external_works (openalex_no, title, doi, pdf_url, is_oa, oa_license, meta_on) "
                         "values (%s, 't', %s, 'https://files.example.org/c.pdf', true, 'cc-by', current_date), "
                         "(%s, 't', %s, 'https://pub.example.org/n.pdf', true, null, current_date), "
                         "(%s, 't', %s, 'https://pub.example.org/e.pdf', true, '', current_date)",
                         (base + 1, d_cached, base + 2, d_null, base + 3, d_empty))
            n0 = conn.execute("select count(*) from paperlab.external_works").fetchone()[0]
        web.works[d_null] = oa_work(d_null, loc("https://pub.example.org/n.pdf", "cc-by-nc"))
        a, b = cloud.client(cloud.user()), cloud.client(cloud.user())
        for c in (a, b):
            r = c.post("/api/oa/lookup", json={"doi": d_cached}).json()
            assert r["cached"] is True and r["oa"]["server_fetch"] and r["oa"]["license"] == "cc-by"
        assert web.hosts("api.openalex.org") == []
        r = a.post("/api/oa/lookup", json={"doi": d_null}).json()
        assert r["cached"] is False and r["oa"]["pdf_url"] == "https://pub.example.org/n.pdf" and r["oa"]["license"] == "cc-by-nc"
        r = a.post("/api/oa/lookup", json={"doi": d_none}).json()
        assert r == {"oa": None, "cached": False}
        # D5: 캐시 oa_license '' → OpenAlex 1회, oa_locations에서 허용 위치를 고름(검색 카드와 같은 결과)
        web.works[d_empty] = oa_work(d_empty, loc("https://pub.example.org/e.pdf"),
                                     [loc("https://pub.example.org/e.pdf"), loc("https://repo.example.org/e-cc.pdf", "cc-by")])
        r = a.post("/api/oa/lookup", json={"doi": d_empty}).json()
        assert r["cached"] is False and r["oa"]["server_fetch"] and r["oa"]["pdf_url"] == "https://repo.example.org/e-cc.pdf"
        assert len(web.hosts("api.openalex.org")) == 3
        with _admin(cloud.project) as conn:
            assert conn.execute("select count(*) from paperlab.external_works").fetchone()[0] == n0
            assert conn.execute("select oa_license from paperlab.external_works where openalex_no = %s",
                                (base + 2,)).fetchone()[0] is None
    finally:
        _cleanup(cloud.project, base)


# ====================================================================== OpenCitations (55x)
@pytest.fixture
def oc(cloud):
    base = _band()
    w = World(base)
    up = FakeUpstream(w)
    st = cloud.app.state
    st.sources_factory = lambda get: Sources(get, transport=up.transport())
    st.graph_sources_factory = lambda oa_key, s2_key, **kw: GraphSources(
        oa_key, s2_key, transport=up.transport(), oa_limiter=RateLimiter(0), s2_limiter=RateLimiter(0),
        oc_limiter=RateLimiter(0), sleep=lambda s: None, **kw)
    yield w, up
    _cleanup(cloud.project, base)


def test_related_opencitations_cache(cloud, oc):
    """AC-551 · 552: 참고문헌 0편 + DOI → OpenCitations 1회 + doi 필터 ≤ 2회, via · unresolved. B가 열면 OpenCitations 0회.
    OpenAlex 번호가 없는 논문은 매번 호출 · 캐시 행 없음"""
    w, up = oc
    seed_doi = f"10.5555/s2seed.{w.base}"
    w.oc_refs[seed_doi] = [f"10.5555/r{i}.{w.base}" for i in range(25)] + ["10.9999/unknown.doi"]
    a, b = cloud.client(cloud.user()), cloud.client(cloud.user())
    paper = {"title": "Seed Without OpenAlex References Indexed", "doi": seed_doi, "openalex_id": f"W{w.S2SEED}"}
    pa = a.post("/api/papers", json=paper).json()["paper"]["id"]
    up.clear()
    r = a.get(f"/api/papers/{pa}/related", params={"kind": "references"}).json()
    assert r["via"] == "opencitations" and r["total"] == 25 and r["unresolved"] == 1 and len(r["items"]) == 20
    assert r["warnings"] == [] and all(x["openalex_id"] for x in r["items"])
    ocs = [x for x in up.requests if x["kind"] == "oc"]
    assert len(ocs) == 1 and "authorization" not in ocs[0]["headers"]
    assert len([x for x in up.requests if x["kind"] == "list" and x["params"]["filter"].startswith("doi:")]) <= 2
    assert a.get(f"/api/papers/{pa}/related", params={"kind": "references", "page": 2}).json()["items"]
    with _admin(cloud.project) as conn:
        row = conn.execute("select source, cardinality(nos), total from paperlab.citation_edges where work_no = %s "
                           "and relation = 'references'", (w.S2SEED,)).fetchone()
    assert row == ("opencitations", 25, 26)
    with _admin(cloud.project) as conn:  # AC-556: 찾은 OpenAlex 작품 행도 캐시에
        assert conn.execute("select count(*) from paperlab.external_works where openalex_no = any(%s)",
                            (w.R[:25],)).fetchone()[0] == 25
    pb = b.post("/api/papers", json=paper).json()["paper"]["id"]
    up.clear()
    rb = b.get(f"/api/papers/{pb}/related", params={"kind": "references"}).json()
    assert rb["via"] == "opencitations" and rb["total"] == 25 and not [x for x in up.requests if x["kind"] == "oc"]
    assert not [x for x in up.requests if x["kind"] == "list" and x["params"].get("filter", "").startswith("doi:")]  # AC-556
    # 찾기 화면(POST /api/related)도 같은 보강
    rr = b.post("/api/related", json={"paper": paper, "kind": "references"}).json()
    assert rr["via"] == "opencitations"
    # OpenAlex 번호가 없는 논문(OpenAlex가 모르는 DOI) — 매번 호출, 캐시 행 없음
    lone = f"10.5555/lone.{w.base}"
    w.oc_refs[lone] = [f"10.5555/r{i}.{w.base}" for i in range(3)]
    pl = a.post("/api/papers", json={"title": "Paper OpenAlex does not know", "doi": lone}).json()["paper"]["id"]
    up.clear()
    for _ in range(2):
        r = a.get(f"/api/papers/{pl}/related", params={"kind": "references"}).json()
        assert r["via"] == "opencitations" and r["total"] == 3
    assert len([x for x in up.requests if x["kind"] == "oc"]) == 2


def test_related_opencitations_keeps_openalex_rows_and_failure(cloud, oc):
    """AC-554: OpenAlex references 행(편수 있음)이 있으면 OpenCitations 결과를 쓰지 않음. 실패는 warnings oc_failed"""
    w, up = oc
    kdoi = f"10.5555/k.{w.base}"
    w.oc_refs[kdoi] = [f"10.5555/r{i}.{w.base}" for i in range(4)]
    with _admin(cloud.project) as conn:
        conn.execute("insert into paperlab.citation_edges (work_no, relation, nos, total, source, fetched_on) "
                     "values (%s, 'references', %s, 2, 'openalex', current_date)", (w.K, [w.R[0], w.R[1]]))
    a = cloud.client(cloud.user())
    pk = a.post("/api/papers", json={"title": "국내 논문", "doi": kdoi, "openalex_id": f"W{w.K}"}).json()["paper"]["id"]
    r = a.get(f"/api/papers/{pk}/related", params={"kind": "references"}).json()
    assert r["via"] == "opencitations" and r["total"] == 4
    with _admin(cloud.project) as conn:
        assert conn.execute("select source, nos from paperlab.citation_edges where work_no = %s and relation = 'references'",
                            (w.K,)).fetchone() == ("openalex", [w.R[0], w.R[1]])
    up.fail = lambda info: httpx.Response(500) if info["kind"] == "oc" else None
    fdoi = f"10.5555/fail.{w.base}"
    pf = a.post("/api/papers", json={"title": "OC fails here", "doi": fdoi, "openalex_id": f"W{w.KR[0]}"}).json()["paper"]["id"]
    r = a.get(f"/api/papers/{pf}/related", params={"kind": "references"})
    assert r.status_code == 200 and r.json()["warnings"] == [{"code": "oc_failed"}] and r.json()["items"] == []
