"""5단계 국내 DB · 기관 연동 — DB 없는 시험 (docs/specs/phase5-korean-db.md 12 · 13장).

손 픽스처(tests/fixtures/extsources/*.handmade.*)와 가짜 전송(httpx.MockTransport)만 쓴다. 실제 KCI · RISS · Europe PMC ·
OpenCitations · OpenAlex로 나가는 요청은 실패한다(AC-575).
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import httpx
import pytest

from paperlab import extsources as ex
from paperlab import sources
from paperlab.config import redact
from paperlab.graph_build import GraphBuilder, Seed
from paperlab.sources import GraphSources, RateLimiter

from .fixtures.citegraph import FakeClock, FakeUpstream, MemStore, World

ROOT = Path(__file__).resolve().parent.parent
FX = Path(__file__).parent / "fixtures" / "extsources"
KCI_KEY = "kci-secret-KEY-1234567890"
RISS_KEY = "riss-secret-KEY-0987654321"
EXTERNAL = {"open.kci.go.kr", "www.riss.kr", "riss.kr", "www.ebi.ac.uk", "api.opencitations.net", "api.openalex.org",
            "api.unpaywall.org", "api.crossref.org", "api.semanticscholar.org"}
NO_LIMIT = {h: RateLimiter(0) for h in ex.LIMITERS}


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """AC-575: 가짜 전송이 아닌 실제 요청이 외부 학술 API · 학교 프록시로 나가면 실패"""
    real = httpx.HTTPTransport.handle_request

    def guard(self, request):
        host = request.url.host
        assert host not in EXTERNAL and not host.endswith("openlink.inha.ac.kr"), "실제 외부 호출"
        return real(self, request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", guard)


@pytest.fixture
def quiet_httpx():
    """httpx 요청 로그(주소에 키가 섞임)를 끄고, 끝나면 원래 수준으로 (D10)"""
    lg = logging.getLogger("httpx")
    old = lg.level
    lg.setLevel(logging.WARNING)
    yield
    lg.setLevel(old)


def fx(name: str) -> bytes:
    return (FX / name).read_bytes()


class Rec:
    """요청을 기록하고 answer(request) 결과로 답하는 가짜 전송"""

    def __init__(self, answer):
        self.answer = answer
        self.requests: list[httpx.Request] = []

    def __call__(self, request):
        self.requests.append(request)
        out = self.answer(request)
        if isinstance(out, Exception):
            raise out
        return out

    def transport(self):
        return httpx.MockTransport(self)


def ext(answer, kci=KCI_KEY, riss=RISS_KEY):
    rec = Rec(answer)
    sleeps: list[float] = []
    return ex.ExtSources(kci, riss, transport=rec.transport(), sleep=sleeps.append, limiters=NO_LIMIT), rec, sleeps


def fixture_answer(request):
    host = request.url.host
    if host == ex.KCI_HOST:
        return httpx.Response(200, content=fx("kci_search.handmade.xml"))
    if host == ex.RISS_HOST:
        return httpx.Response(200, content=fx("riss_search.handmade.xml"))
    if host == ex.EPMC_HOST:
        return httpx.Response(200, content=fx("epmc_search.handmade.json"))
    return httpx.Response(404)


# ====================================================================== 50x 공통
@pytest.mark.parametrize("source,host,path,qkey", [
    ("kci", "open.kci.go.kr", "/po/openapi/openApiSearch.kci", "title"),
    ("riss", "www.riss.kr", "/openApi", "keyword"),
    ("europepmc", "www.ebi.ac.uk", "/europepmc/webservices/rest/search", "query"),
])
def test_hosts_query_params_and_no_redirect(source, host, path, qkey):
    """AC-501: 호스트 상수 하나 · 검색어는 쿼리 매개변수로만 · https · 302는 따라가지 않고 upstream_unavailable"""
    s, rec, _ = ext(fixture_answer)
    s.search(source, "딥러닝/../x?y#z")
    [r] = rec.requests
    assert r.url.host == host and r.url.scheme == "https" and r.url.path == path
    assert r.url.params[qkey] == "딥러닝/../x?y#z" and "딥러닝" not in r.url.path
    s, rec, _ = ext(lambda r: httpx.Response(302, headers={"Location": "https://evil.example/x"}))
    with pytest.raises(ex.ExtError) as e:
        s.search(source, "deep learning")
    assert e.value.code == "upstream_unavailable" and e.value.status == 502
    assert [r.url.host for r in rec.requests] == [host]


def test_param_mapping():
    """AC-502 (6.4절 표)"""
    s, rec, _ = ext(fixture_answer)
    s.search("kci", "딥러닝", page=2, year_from=2015, year_to=2020, sort="date")
    s.search("riss", "딥러닝", page=2, year_from=2015, year_to=2020, sort="date", oa=True)
    s.search("europepmc", "deep learning", year_from=2015, year_to=2020, sort="cited", oa=True)
    kci, riss, epmc = (r.url.params for r in rec.requests)
    assert (kci["dateFrom"], kci["dateTo"], kci["page"], kci["sortNm"]) == ("201501", "202012", "2", "pubiYr")
    assert (riss["spubdate"], riss["epubdate"], riss["rsnum"], riss["rowcount"], riss["charge"]) == ("2015", "2020", "21", "20", "1")
    assert (riss["sort"], riss["asc"], riss["type"], riss["version"]) == ("Y", "D", "A", "1.0")
    assert epmc["query"] == "(deep learning) AND PUB_YEAR:[2015 TO 2020] AND OPEN_ACCESS:Y"
    assert epmc["sort"] == "CITED desc" and epmc["format"] == "json" and epmc["cursorMark"] == "*"
    s.search("europepmc", "x", sort="date")
    assert rec.requests[-1].url.params["sort"] == "P_PDATE_D desc" and rec.requests[-1].url.params["query"] == "x"
    s.search("kci", "x", page=9999)
    assert rec.requests[-1].url.params["page"] == "500"  # 쪽 상한


@pytest.mark.parametrize("source,sort,oa", [("kci", "cited", False), ("riss", "cited", False), ("kci", "relevance", True),
                                             ("europepmc", "nope", False)])
def test_unsupported_option(source, sort, oa):
    """AC-503: 미지원 정렬 · 필터 → 400 unsupported_option, 외부 호출 0회"""
    s, rec, _ = ext(fixture_answer)
    with pytest.raises(ex.ExtError) as e:
        s.search(source, "x", sort=sort, oa=oa)
    assert (e.value.code, e.value.status) == ("unsupported_option", 400) and rec.requests == []


def test_unconfigured_and_status():
    """AC-504 · 524: 키가 없는 소스만 꺼짐(503 · 외부 0회), 상태에는 키 값이 없음"""
    s, rec, _ = ext(fixture_answer, kci=KCI_KEY, riss="")
    st = s.status()
    assert st == {"kci": {"enabled": True}, "riss": {"enabled": False, "reason": "unconfigured"},
                  "europepmc": {"enabled": True}}
    assert KCI_KEY not in json.dumps(st) and "unpaywall" not in st
    with pytest.raises(ex.ExtError) as e:
        s.search("riss", "x")
    assert (e.value.code, e.value.status) == ("source_unconfigured", 503) and rec.requests == []
    assert s.search("kci", "x")["items"]
    s2, rec2, _ = ext(fixture_answer, kci="", riss="")
    with pytest.raises(ex.ExtError):
        s2.search("kci", "x")
    assert rec2.requests == [] and s2.status()["kci"] == {"enabled": False, "reason": "unconfigured"}
    assert KCI_KEY not in repr(s) and KCI_KEY not in repr(ex.ExtSources(KCI_KEY))  # 기본 repr(키 없음)


def test_retry_rules():
    """AC-505: 429 → Retry-After(≤5초) 뒤 1회, 다시 429면 upstream_limited. 5xx · 연결 오류 → 1회 뒤 502"""
    calls = []

    def once_429(r):
        calls.append(1)
        return httpx.Response(429, headers={"Retry-After": "30"}) if len(calls) == 1 else fixture_answer(r)

    s, rec, sleeps = ext(once_429)
    assert s.search("europepmc", "x")["items"] and len(rec.requests) == 2 and sleeps == [5.0]
    s, rec, sleeps = ext(lambda r: httpx.Response(429, headers={"Retry-After": "2"}))
    with pytest.raises(ex.ExtError) as e:
        s.search("kci", "x")
    assert (e.value.code, e.value.status, len(rec.requests), sleeps) == ("upstream_limited", 429, 2, [2.0])
    for answer in (lambda r: httpx.Response(503), lambda r: httpx.ConnectError("refused", request=r)):
        s, rec, _ = ext(answer)
        with pytest.raises(ex.ExtError) as e:
            s.search("riss", "x")
        assert (e.value.code, len(rec.requests)) == ("upstream_unavailable", 2)
    s, rec, _ = ext(lambda r: httpx.Response(404))
    with pytest.raises(ex.ExtError):
        s.search("kci", "x")
    assert len(rec.requests) == 1


@pytest.mark.parametrize("body", [
    b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x "boom">]><MetaData><record>&x;</record></MetaData>',
    b'<?xml version="1.0"?><!doctype MetaData SYSTEM "file:///etc/passwd"><MetaData/>',
    b"<MetaData><record><unclosed></MetaData>",
    b"",
    '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE r [<!ENTITY x "boom">]><MetaData><record>&x;</record></MetaData>'.encode("utf-16"),
    '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE MetaData SYSTEM "file:///etc/passwd"><MetaData/>'.encode("utf-16"),
    b"<MetaData><record>&undefined;</record></MetaData>",
])
def test_bad_xml_rejected(body):
    """AC-505 · K-2: DOCTYPE · ENTITY 포함 · 깨진 XML → 502 upstream_unavailable"""
    for source in ("kci", "riss"):
        s, _, _ = ext(lambda r: httpx.Response(200, content=body))
        with pytest.raises(ex.ExtError) as e:
            s.search(source, "x")
        assert e.value.code == "upstream_unavailable"


def test_parse_xml_handler_refuses_without_byte_match():
    """D2: 바이트 정규식에 걸리지 않는 UTF-16 문서도 expat 처리기에서 DOCTYPE · ENTITY 거부, 보통 UTF-16 문서는 읽힘"""
    body = '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE r [<!ENTITY x "b">]><r>&x;</r>'.encode("utf-16")
    assert not ex._UNSAFE_XML.search(body)
    with pytest.raises(ex.ExtError):
        ex.parse_xml(body)
    ok = ex.parse_xml('<?xml version="1.0" encoding="UTF-16"?><MetaData><record><doi>10.1/x</doi></record></MetaData>'.encode("utf-16"))
    assert ok.tag == "MetaData" and ok.findtext("record/doi") == "10.1/x"


def test_too_large_and_bad_json():
    big = b"<MetaData>" + b" " * (sources.GRAPH_MAX_BYTES + 10) + b"</MetaData>"
    for answer, source in ((lambda r: httpx.Response(200, content=big), "kci"),
                           (lambda r: httpx.Response(200, content=b"{not json"), "europepmc"),
                           (lambda r: httpx.Response(200, json=[1, 2]), "europepmc")):
        s, rec, _ = ext(answer)
        with pytest.raises(ex.ExtError) as e:
            s.search(source, "x")
        assert e.value.code == "upstream_unavailable" and len(rec.requests) == 1


def test_query_rules():
    s, rec, _ = ext(fixture_answer)
    for q in ("", "   ", "x" * 301, "\x00\x01"):
        with pytest.raises(ex.ExtError) as e:
            s.search("kci", q)
        assert e.value.code == "bad_query"
    s.search("kci", "a\x00b\nc")
    assert rec.requests[-1].url.params["title"] == "a b c"


# ====================================================================== 51x KCI
def test_kci_parse():
    """AC-511: 원어 제목 우선 · 초록 · DOI 소문자 · KCI 피인용 · kci_id 형식 검사 · 원문공개 → is_oa · pdf_url 없음"""
    res = ex.parse_kci(fx("kci_search.handmade.xml"))
    assert res["total"] == 1284 and len(res["items"]) == 2
    a, b = res["items"]
    assert a["source"] == "kci" and a["title"].startswith("합성곱 신경망")
    assert [x["family"] + x["given"] for x in a["authors"]] == ["김민수", "이지은", "박정호"]  # 괄호(소속) 제거
    assert a["abstract"].startswith("본 연구는") and a["doi"] == "10.99999/jksr.2023.0012"
    assert a["cited_by_count"] == 12 and a["kci_id"] == "ART002912345" and a["is_oa"] is True and a["pdf_url"] == ""
    assert (a["year"], a["issued"], a["venue"], a["volume"], a["issue"], a["pages"]) == (2023, "2023-03", "대한가상의료영상학회지", "84", "2", "101-115")
    assert a["url"].startswith("https://www.kci.go.kr/") and a["badges"] == ["KCI등재"]
    assert b["title"] == "A Study on Legal Liability of Medical AI"  # 원어 없으면 영어
    assert b["kci_id"] == "" and b["doi"] == "" and b["url"] == "" and b["is_oa"] is False  # javascript: 주소 버림
    assert b["cited_by_count"] == 0 and b["badges"] == ["KCI등재후보"] and b["pages"] == "1"
    assert set(sources._empty("kci")) <= set(a)


def test_kci_key_errors_hide_key(caplog, quiet_httpx):
    """AC-512 · 571: 키 오류 → 502 source_key_invalid, 응답 · 로그에 키 · 검색어가 없음"""
    caplog.set_level(logging.DEBUG)
    for name in ("kci_error_key.handmade.xml", "kci_error_expired.handmade.xml"):
        s, rec, _ = ext(lambda r, n=name: httpx.Response(200, content=fx(n)))
        with pytest.raises(ex.ExtError) as e:
            s.search("kci", "비밀검색어")
        assert (e.value.code, e.value.status) == ("source_key_invalid", 502)
        assert KCI_KEY not in str(e.value) and "비밀검색어" not in str(e.value)
    s, _, _ = ext(lambda r: httpx.Response(500))
    with pytest.raises(ex.ExtError) as e:
        s.search("kci", "비밀검색어")
    assert KCI_KEY not in caplog.text and "비밀검색어" not in caplog.text
    lines = [json.loads(r.getMessage()) for r in caplog.records if r.name == "paperlab.sources"]
    assert lines and all(set(x) == {"event", "host", "status"} and x["event"] == "upstream_error" for x in lines)


def test_kci_request_uses_shared_key():
    """AC-513: apiCode=articleSearch · title · displayCount=20 · 공용 키"""
    s, rec, _ = ext(fixture_answer)
    s.search("kci", "딥러닝")
    p = rec.requests[0].url.params
    assert (p["apiCode"], p["title"], p["displayCount"], p["key"]) == ("articleSearch", "딥러닝", "20", KCI_KEY)
    assert "sortNm" not in p and "dateFrom" not in p


# ====================================================================== 52x RISS
def test_riss_parse():
    """AC-521 · 523: stitle · stype 모두, 저자 괄호 제거, http→https · riss_id, 다른 호스트 url 빈 값, doi · 초록 없음, 배지"""
    a, b = ex.parse_riss(fx("riss_search.handmade.xml"))["items"]
    assert a["venue"] == "가상교육연구" and a["source"] == "riss"
    assert a["authors"] == [{"given": "정현", "family": "백"}, {"given": "철수", "family": "김"}]
    assert a["url"] == "https://www.riss.kr/link?id=A101700042" and a["riss_id"] == "A101700042"
    assert a["doi"] == "" and a["abstract"] == "" and a["cited_by_count"] is None
    assert a["badges"] == ["KCI등재", "무료 원문"] and a["is_oa"] is False and a["pdf_url"] == ""
    assert (a["year"], a["volume"], a["issue"]) == (2018, "12", "3")
    assert b["url"] == "" and b["riss_id"] == "" and b["badges"] == [] and b["year"] == 2020
    [c] = ex.parse_riss(fx("riss_search_stype.handmade.xml"))["items"]
    assert c["venue"] == "가상학술지" and len(c["authors"]) == 3 and c["badges"] == ["KCI등재후보"]


def test_riss_errors_and_empty():
    """AC-522: Error 004(HTTP 200) → source_key_invalid, Error 0 + metadata 0개 → 빈 결과"""
    s, _, _ = ext(lambda r: httpx.Response(200, content=fx("riss_error_004.handmade.xml")))
    with pytest.raises(ex.ExtError) as e:
        s.search("riss", "x")
    assert (e.value.code, e.value.status) == ("source_key_invalid", 502) and RISS_KEY not in str(e.value)
    s, _, _ = ext(lambda r: httpx.Response(200, content=fx("riss_empty.handmade.xml")))
    assert s.search("riss", "x") == {"items": [], "total": 0}


# ====================================================================== 53x Europe PMC
def test_epmc_parse_and_cursor():
    """AC-531 · 532 · 533"""
    s, rec, _ = ext(fixture_answer)
    res = s.search("europepmc", "deep learning")
    a, b = res["items"]
    assert a["title"] == "Deep learning for retinal imaging & screening"
    assert a["abstract"] == "Background We trained a model on fundus photographs."
    assert a["url"] == "https://europepmc.org/article/MED/40734654" and a["is_oa"] is True
    assert (a["doi"], a["pmid"], a["pmcid"], a["cited_by_count"]) == ("10.99999/epmc.2024.001", "40734654", "PMC9999999", 7)
    assert a["authors"][0] == {"given": "JA", "family": "Smith"} and a["authors"][2]["family"] == "van der Berg"
    assert (a["venue"], a["volume"], a["issue"], a["year"]) == ("Journal of Imaginary Ophthalmology", "12", "4", 2024)
    assert a["pdf_url"] == "" and "oa_open_url" not in a  # U-4: fullTextUrlList · license를 읽지 않음
    assert b["url"] == "" and b["venue"] == "Imaginary Medicine" and b["is_oa"] is False
    assert res["next_cursor"] == "AoJwgK7Bk4wDKDQwNzM0NjU0" and res["total"] == 2
    s.search("europepmc", "deep learning", cursor=res["next_cursor"])
    r = rec.requests[-1]
    assert r.url.params["cursorMark"] == res["next_cursor"] and res["next_cursor"] not in r.url.path
    assert "authorization" not in r.headers and "key" not in r.url.params
    s.search("europepmc", "x", cursor="bad cursor<>")
    assert rec.requests[-1].url.params["cursorMark"] == "*"
    last = json.loads(fx("epmc_search.handmade.json"))
    last["request"]["cursorMark"] = last["nextCursorMark"]
    assert ex.parse_epmc(json.dumps(last).encode())["next_cursor"] is None  # 마지막 쪽


# ====================================================================== 54x 무료 PDF (OpenAlex만)
def test_no_unpaywall_anywhere():
    """AC-541: 코드에 unpaywall · UNPAYWALL_EMAIL 없음"""
    for p in list((ROOT / "paperlab").rglob("*.py")) + list((ROOT / "paperlab" / "static" / "js").glob("*.js")):
        assert not re.search(r"unpaywall", p.read_text(encoding="utf-8"), re.I), p.name


def test_server_fetch_allowed():
    """AC-542"""
    for v in ("cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nd", "cc-by-nc-sa", "cc-by-nc-nd", "cc0", "public-domain", "CC-BY", " cc0 "):
        assert sources.server_fetch_allowed(v), v
    for v in (None, "", "other-oa", "publisher-specific-oa", "foo", "cc", 5):
        assert not sources.server_fetch_allowed(v), v


def test_doi_checks_and_encoding():
    """AC-543: 경로 조작 DOI는 요청 0회, ?·#는 경로 한 조각으로 인코딩. (명세 예의 10.1/…는 등록자 번호 4자리 규칙에 걸려 요청 0회)"""
    seen = []

    def handler(r):
        seen.append(r)
        return httpx.Response(404)

    s = sources.Sources(lambda k: "", transport=httpx.MockTransport(handler))
    for bad in ("10.1234/a/../b", "10.1234/./b", "10.1/x?y#z", "not a doi", ""):
        assert s.oa_locations(bad) == []
    assert seen == []
    assert s.oa_locations("10.1234/x?y#z") == []
    [r] = seen
    raw = r.url.raw_path.decode()
    assert raw == "/works/doi:10.1234/x%3Fy%23z" and "?" not in raw.split("?")[0][len("/works"):]
    assert sources.doi_path("10.1234/x?y#z") == "10.1234/x%3Fy%23z"
    with pytest.raises(ValueError):
        sources.check_doi("10.1234/a/../b")


def _oa_fixture():
    return json.loads(fx("openalex_oa.handmade.json"))


def test_pick_oa_location():
    """8.1절: 허용 라이선스 위치 우선(oa_locations 안이어도), 아니면 best PDF를 새 탭, PDF 없으면 원문 페이지"""
    w = _oa_fixture()
    pick = lambda k: sources.pick_oa_location(sources.oa_locations_of(w[k]))  # noqa: E731
    assert pick("cc_by")["server_fetch"] and pick("cc_by")["pdf_url"] == "https://files.example.org/ccby.pdf"
    m = pick("other_then_cc")
    assert m["server_fetch"] and m["pdf_url"] == "https://repo.example.org/mixed-accepted.pdf" and m["license"] == "CC-BY-NC"
    for k in ("no_license", "other_oa"):
        p = pick(k)
        assert not p["server_fetch"] and p["open_kind"] == "pdf" and p["open_url"].endswith(".pdf"), k
    lp = pick("landing_only")
    assert not lp["server_fetch"] and lp["open_kind"] == "landing" and lp["open_url"] == "https://publisher.example.org/landing"
    assert pick("closed") is None
    arx = sources.pick_oa_location([{"pdf_url": "https://arxiv.org/pdf/2101.00001", "landing_url": "", "license": "", "version": ""}])
    assert arx["server_fetch"]  # 경계 ② arXiv
    locs = sources.oa_locations_of({"best_oa_location": {"pdf_url": "https://www-x-com-ssl.openlink.inha.ac.kr/a.pdf",
                                                         "license": "cc-by"}})
    assert locs == []  # openlink 주소는 버림 (AC-546)


def test_norm_openalex_u3():
    """AC-549: cc-by → pdf_url, 라이선스 없음 → pdf_url 빈 값 + oa_open_url, arXiv 대체 채움은 그대로"""
    w = _oa_fixture()
    p = sources.norm_openalex(w["cc_by"])
    assert p["pdf_url"] == "https://files.example.org/ccby.pdf" and p["oa_open_url"] == "" and p["oa_license"] == "cc-by"
    p = sources.norm_openalex(w["no_license"])
    assert p["pdf_url"] == "" and p["oa_open_url"] == "https://publisher.example.org/nolic.pdf" and p["oa_license"] == ""
    p = sources.norm_openalex(dict(w["no_license"], locations=[{"landing_page_url": "https://arxiv.org/abs/2101.00001v2"}]))
    assert p["pdf_url"] == "https://arxiv.org/pdf/2101.00001" and p["oa_open_url"] == "https://publisher.example.org/nolic.pdf"


def test_s2_and_crossref_cards_open_only():
    """K-22(팀장 결정 2): Semantic Scholar openAccessPdf · Crossref link는 pdf_url이 아니라 새 탭용 oa_open_url"""
    s2 = sources.norm_s2({"title": "T", "openAccessPdf": {"url": "https://x.example/a.pdf"}})
    assert s2["pdf_url"] == "" and s2["oa_open_url"] == "https://x.example/a.pdf" and s2["is_oa"] is True
    assert sources.norm_s2({"title": "T", "openAccessPdf": {"url": "javascript:x"}})["oa_open_url"] == ""
    cr = sources.norm_crossref({"title": ["T"], "link": [{"content-type": "application/pdf", "URL": "https://pub.example/a.pdf"}]})
    assert cr["pdf_url"] == "" and cr["oa_open_url"] == "https://pub.example/a.pdf"


class FakeOA:
    """plan_pdf용 가짜 조회: locs(OpenAlex 위치) · link(Crossref) · 호출 기록"""

    def __init__(self, locs=(), link="", fail=False):
        self.locs, self.link, self.fail = list(locs), link, fail
        self.calls: list[str] = []

    def oa_locations(self, doi):
        self.calls.append("oa")
        if self.fail:
            raise sources.SourceError("x")
        return self.locs

    def crossref_pdf_link(self, doi):
        self.calls.append("crossref")
        return self.link


def loc(pdf, lic=None, landing=""):
    return {"pdf_url": pdf, "landing_url": landing, "license": lic or "", "version": ""}


def test_plan_pdf_order():
    """8.3절 순서 · D1(팀장 결정 — 서버가 받는 것은 arXiv · 허용 라이선스 OpenAlex 위치와 같은 주소뿐) · K-12 · K-22"""
    D = "10.99999/plt5-x"
    cc, nolic = loc("https://f.example/cc.pdf", "cc-by"), loc("https://p.example/n.pdf")
    # 1. 서재 pdf_url: arXiv → 받음(조회 0회)
    f = FakeOA()
    assert ex.plan_pdf(f, "https://arxiv.org/abs/1706.03762", "", D, None)["fetch"].startswith("https://arxiv.org/")
    assert f.calls == []
    # 허용 라이선스 위치와 글자 그대로 같을 때만 받음
    assert ex.plan_pdf(FakeOA([cc]), cc["pdf_url"], "", D, None) == {"fetch": cc["pdf_url"], "license": "cc-by"}
    assert ex.plan_pdf(FakeOA([nolic]), nolic["pdf_url"], "", D, None) == {"open_url": nolic["pdf_url"], "open_kind": "pdf"}
    # 그 밖 주소(S2 · Crossref · 사용자가 넣은 주소 · ? 변형 · http 변형)는 받지 않음 — 같은 논문의 무료 공개본이 있으면
    # 그것을 대신 받고(사용자 결정 "대신 받기"), 없으면 원래 주소를 새 탭으로
    others = ("https://pdfs.semanticscholar.org/ab/cd.pdf", "https://pub.example.org/cr.pdf", "https://mine.example/x.pdf",
              cc["pdf_url"] + "?download=1", cc["pdf_url"].replace("https://", "http://"))
    for url in others:
        assert ex.plan_pdf(FakeOA([nolic, cc]), url, "", D, None) == \
            {"fetch": cc["pdf_url"], "license": "cc-by", "via": "substitute"}, url
        assert ex.plan_pdf(FakeOA([nolic]), url, "", D, None) == {"open_url": url, "open_kind": "pdf"}, url
    f = FakeOA([cc])
    assert ex.plan_pdf(f, cc["pdf_url"], "", "", None) == {"open_url": cc["pdf_url"], "open_kind": "pdf"} and f.calls == []
    # 캐시: 허용 위치와 같은 주소면 캐시로(조회 0회), 아니면 OpenAlex 위치 전부를 봄
    f = FakeOA([nolic])
    assert ex.plan_pdf(f, cc["pdf_url"], "", D, [cc])["fetch"] == cc["pdf_url"] and f.calls == []
    f = FakeOA([cc])
    assert ex.plan_pdf(f, cc["pdf_url"], "", D, [nolic])["fetch"] == cc["pdf_url"] and f.calls == ["oa"]
    # 2. arXiv 번호
    assert ex.plan_pdf(FakeOA(), "", "2101.00001", D, None) == {"fetch": "https://arxiv.org/pdf/2101.00001", "license": ""}
    assert ex.plan_pdf(FakeOA(), "", "hep-th/9901001v2", D, None)["fetch"] == "https://arxiv.org/pdf/hep-th/9901001v2"
    for bad in ("@evil.com/x", "//evil.com", "2101.00001#@evil.com", "../x", "2101.00001x", "2101.00001/../x", "1234"):  # 승인자 L-1: 형식 밖이면 번호 없음
        assert ex.plan_pdf(FakeOA(), "", bad, "", None) is None, bad
        assert ex.plan_pdf(FakeOA([nolic]), nolic["pdf_url"], bad, D, None) == {"open_url": nolic["pdf_url"], "open_kind": "pdf"}, bad
    # 3. DOI: 캐시 → OpenAlex → 판정, Crossref link는 새 탭만, 모두 없으면 None
    f = FakeOA([nolic, cc])
    assert ex.plan_pdf(f, "", "", D, None) == {"fetch": cc["pdf_url"], "license": "cc-by"}
    f = FakeOA([cc])
    assert ex.plan_pdf(f, "", "", D, [nolic]) == {"open_url": nolic["pdf_url"], "open_kind": "pdf"} and f.calls == []
    f = FakeOA([], link="https://pub.example/l.pdf")
    assert ex.plan_pdf(f, "", "", D, None) == {"open_url": "https://pub.example/l.pdf", "open_kind": "pdf"}
    assert f.calls == ["oa", "crossref"]
    assert ex.plan_pdf(FakeOA([]), "", "", D, []) is None
    assert ex.plan_pdf(FakeOA(), "", "", "", None) is None
    with pytest.raises(sources.SourceError):
        ex.plan_pdf(FakeOA(fail=True), "", "", D, None)


def test_plan_pdf_substitute():
    """대신 받기 순서: ② arXiv(번호 · OpenAlex의 arXiv 위치) → ③ 허용 라이선스 위치, openlink 위치는 후보에서 뺌, 없으면 새 탭"""
    D, s2 = "10.99999/plt5-sub", "https://pdfs.semanticscholar.org/aa/bb.pdf"
    cc = loc("https://repo.example.org/cc.pdf", "cc-by-nc")
    arx = loc("https://arxiv.org/pdf/2101.00009v2")
    sub = lambda u, lic: {"fetch": u, "license": lic, "via": "substitute"}  # noqa: E731
    assert ex.plan_pdf(FakeOA([cc]), s2, "", D, None) == sub(cc["pdf_url"], "cc-by-nc")  # S2 + 허용 위치
    assert ex.plan_pdf(FakeOA([cc]), s2, "2101.00001", D, None) == sub("https://arxiv.org/pdf/2101.00001", "")  # S2 + arXiv 번호
    assert ex.plan_pdf(FakeOA([cc, arx]), s2, "", D, None) == sub(arx["pdf_url"], "")  # arXiv 위치가 허용 위치보다 먼저
    assert ex.plan_pdf(FakeOA([]), s2, "2101.00001", "", None) == sub("https://arxiv.org/pdf/2101.00001", "")  # DOI 없어도
    assert ex.plan_pdf(FakeOA([loc("https://p.example/n.pdf")]), s2, "", D, None) == {"open_url": s2, "open_kind": "pdf"}
    bad = loc("https://www-x-com-ssl.openlink.inha.ac.kr/a.pdf", "cc-by")
    assert ex.plan_pdf(FakeOA([bad]), s2, "", D, None) == {"open_url": s2, "open_kind": "pdf"}  # openlink 위치 제외
    assert ex.substitute("", [bad, loc("https://www.openlink.inha.ac.kr.evil/x.pdf", "cc0")])["fetch"].endswith("evil/x.pdf")


def test_cache_locations():
    """D5: oa_license가 null · ''이면 캐시로 판정하지 않음(None — OpenAlex 1회)"""
    assert ex.cache_locations(None) is None
    assert ex.cache_locations({"pdf_url": "https://a/x.pdf", "url": "", "is_oa": True, "oa_license": None}) is None
    assert ex.cache_locations({"pdf_url": "https://a/x.pdf", "url": "https://a/", "is_oa": True, "oa_license": ""}) is None
    assert ex.cache_locations({"pdf_url": "", "url": "https://a/", "is_oa": False, "oa_license": "other-oa"}) == []
    [x] = ex.cache_locations({"pdf_url": "https://a/x.pdf", "url": "https://a/", "is_oa": True, "oa_license": "cc-by"})
    assert sources.pick_oa_location([x])["server_fetch"]


@pytest.mark.parametrize("url", ["https://www-riss-kr-ssl.openlink.inha.ac.kr/x.pdf", "https://openlink.inha.ac.kr/a.pdf",
                                 "http://OPENLINK.INHA.AC.KR./a.pdf"])
def test_download_pdf_refuses_openlink(url):
    """AC-546: 학교 프록시 주소는 요청 0회 · 실패 (리디렉션으로 가도 같음)"""
    seen = []
    s = sources.Sources(lambda k: "", transport=httpx.MockTransport(lambda r: seen.append(r) or httpx.Response(200, content=b"%PDF")),
                        resolver=lambda h, p: ["93.184.215.14"])
    with pytest.raises(sources.SourceError) as e:
        s.download_pdf(url)
    assert str(e.value) == sources.PDF_FETCH_FAILED and seen == []
    hop = sources.Sources(lambda k: "", transport=httpx.MockTransport(
        lambda r: seen.append(r) or httpx.Response(302, headers={"Location": url})), resolver=lambda h, p: ["93.184.215.14"])
    with pytest.raises(sources.SourceError):
        hop.download_pdf("https://example.org/a.pdf")
    assert len(seen) == 1


# ====================================================================== 55x OpenCitations (그래프 — 메모리 저장소)
def test_parse_oc_references():
    dois = sources.parse_oc_references(json.loads(fx("oc_references.handmade.json")))
    assert dois == ["10.99999/ref.a", "10.99999/ref.b", "10.99999/ref.c"]
    assert sources.parse_oc_references({"x": 1}) == [] and sources.parse_oc_references(None) == []


def _graph_env():
    w = World(9_100_000_000)
    clock = FakeClock()
    up = FakeUpstream(w, clock)
    store = MemStore()

    def build(no):
        up.clear()
        src = GraphSources(transport=up.transport(), clock=clock, sleep=clock.sleep, oa_limiter=RateLimiter(0),
                           s2_limiter=RateLimiter(0), oc_limiter=RateLimiter(0), deadline=clock() + 45)
        b = GraphBuilder(store, src, sources_today(), progress=lambda e: None)
        return b.build(b.resolve(Seed(no=no)), 40), src

    return w, up, store, build


def sources_today():
    from datetime import date
    return date(2026, 10, 14)


def test_graph_opencitations_first():
    """AC-553: 씨앗 OpenAlex 참고문헌 0편 + DOI → OpenCitations 1회로 채우면 S2 0회 · refs_via, 목록 호출 ≤ 12"""
    w, up, store, build = _graph_env()
    doi = f"10.5555/s2seed.{w.base}"
    w.oc_refs[doi] = [f"10.5555/r{i}.{w.base}" for i in range(12)] + ["10.9999/unknown.doi"]
    g, src = build(w.S2SEED)
    oc = [r for r in up.requests if r["kind"] == "oc"]
    assert len(oc) == 1 and oc[0]["raw_path"] == f"/index/v2/references/doi:{doi}"
    assert "authorization" not in oc[0]["headers"] and oc[0]["params"] == {}
    assert not [r for r in up.requests if r["kind"] == "s2"]
    e = store.e[(w.S2SEED, "references")]
    assert e["source"] == "opencitations" and e["nos"] == w.R[:12] and e["total"] == 13
    assert g["refs_via"] == "opencitations" and not [x for x in g["warnings"] if x["code"] in ("oc_failed", "s2_failed")]
    assert src.list_calls <= 12 and len([r for r in up.requests if r["kind"] == "list"
                                         and r["params"]["filter"].startswith("doi:")]) <= 2
    # 다시 그리면 캐시 — OpenCitations · S2 0회
    g, _ = build(w.S2SEED)
    assert not [r for r in up.requests if r["kind"] in ("oc", "s2")]


def test_graph_oc_failed_then_s2():
    """AC-553: OpenCitations 실패 → S2 1회(지금 그대로), 경고 oc_failed. 둘 다 실패 → oc_failed + s2_failed"""
    w, up, store, build = _graph_env()
    up.fail = lambda r: httpx.Response(500) if r["kind"] == "oc" else None
    g, _ = build(w.S2SEED)
    codes = [x["code"] for x in g["warnings"]]
    assert "oc_failed" in codes and "s2_failed" not in codes and g["refs_via"] == "s2"
    assert len([r for r in up.requests if r["kind"] == "s2"]) == 1
    assert store.e[(w.S2SEED, "references")]["source"] == "s2"
    w, up, store, build = _graph_env()
    up.fail = lambda r: httpx.Response(500) if r["kind"] in ("oc", "s2") else None
    g, _ = build(w.S2SEED)
    assert {"oc_failed", "s2_failed"} <= {x["code"] for x in g["warnings"]}
    # OpenCitations 0편(404) → S2, 경고 없음
    w, up, store, build = _graph_env()
    g, _ = build(w.S2SEED)
    assert len([r for r in up.requests if r["kind"] == "oc"]) == 1
    assert "oc_failed" not in [x["code"] for x in g["warnings"]]
    assert store.e[(w.S2SEED, "references")]["source"] == "s2"


def test_graph_paper_view_u3():
    """그래프 카드도 U-3 규칙: 라이선스 없는 PDF는 pdf_url 빈 값 + oa_open_url, oa_license 캐시에 기록(K-21)"""
    w, up, store, build = _graph_env()
    g, _ = build(w.S)
    seed = next(n for n in g["nodes"] if n["is_seed"])["paper"]
    assert seed["pdf_url"] == "" and seed["oa_open_url"] == f"https://example.org/w/{w.S}.pdf"
    assert store.w[w.S]["oa_license"] == "" and store.w[w.S]["pdf_url"].endswith(".pdf")


# ====================================================================== 57x 보안 · 로그 · 코드 검사
def test_redact_query_secrets():
    """AC-572"""
    text = redact("GET https://open.kci.go.kr/po?apiCode=a&key=abc123SECRET&title=x ?api_key=zzz9 &email=x@y.z")
    assert "abc123SECRET" not in text and "zzz9" not in text and "x@y.z" not in text
    assert "key=***" in text and "title=x" in text
    err = httpx.ConnectError(f"failed https://www.riss.kr/openApi?key={RISS_KEY}&keyword=q")
    assert RISS_KEY not in redact(str(err))


def test_code_checks():
    """AC-563 · 573 · 582 일부: 공용 캐시 쓰기는 citecache의 system_tx("citation cache write")뿐, 1B 업서트가 oa_license를 씀,
    5단계 외부 호스트는 14장 상수뿐, discover.js는 결과 글을 esc()로만"""
    cc = (ROOT / "paperlab" / "citecache.py").read_text(encoding="utf-8")
    assert re.findall(r"\.system_tx\(([^)\n]*)\)", cc) == ['"citation cache write"']
    assert "oa_license = coalesce(excluded.oa_license" in cc and '"oa_license"' in cc
    for name in ("server.py", "extsources.py", "sources.py"):
        assert "oa cache write" not in (ROOT / "paperlab" / name).read_text(encoding="utf-8")
    src = (ROOT / "paperlab" / "extsources.py").read_text(encoding="utf-8")
    body = src.split('"""', 2)[-1]
    hosts = set(re.findall(r"https?://([A-Za-z0-9.\-{}_]+)", body))
    assert hosts <= {"{KCI_HOST}", "{RISS_HOST}", "{EPMC_HOST}", "www.kci.go.kr", "europepmc.org", "arxiv.org"}, hosts
    assert "follow_redirects" not in src and "riss.kr/link" not in body.split("def norm_riss")[0]
    disc = (ROOT / "paperlab" / "static" / "js" / "discover.js").read_text(encoding="utf-8")
    for field in ("it.title", "it.venue", "it.abstract", "it.tldr", "b", "it.badges"):
        for m in re.finditer(r"\$\{" + re.escape(field) + r"\}", disc):
            raise AssertionError(f"이스케이프 없는 삽입: {m.group(0)}")
    assert "innerHTML = it." not in disc


def test_source_limits_same_as_screen():
    """AC-581: 서버 SOURCE_LIMITS == 화면 sourcemeta.js SOURCE_LIMITS"""
    js = (ROOT / "paperlab" / "static" / "js" / "sourcemeta.js").read_text(encoding="utf-8")
    m = re.search(r"export const SOURCE_LIMITS = (\{.*?\});", js, re.S)
    assert m and json.loads(m.group(1)) == ex.SOURCE_LIMITS


def test_record_tool_is_manual_only():
    """13장: 녹화 도구는 관리자가 손으로 — 테스트 · 앱 코드가 부르지 않음, 키 · 이메일이 든 본문은 저장하지 않음"""
    tool = (ROOT / "tools" / "record_extsources.py").read_text(encoding="utf-8")
    assert "def contains_secret" in tool and "__main__" in tool
    for p in list((ROOT / "paperlab").rglob("*.py")) + list((ROOT / "tests").glob("test_*.py")):
        if p.name != "test_extsources.py":
            assert "record_extsources" not in p.read_text(encoding="utf-8"), p.name
    import importlib.util
    spec = importlib.util.spec_from_file_location("record_extsources", ROOT / "tools" / "record_extsources.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.contains_secret(b"...key=abc...", ["abc"]) and not mod.contains_secret(b"mail me@x.org", ["abc"])
    assert not mod.contains_secret(b'{"title": "ok"}', ["abc", ""])
    assert mod.scrub_emails(b'{"email": "kim.min@univ.ac.kr", "x": "a@b.co"}') == \
        b'{"email": "redacted@example.invalid", "x": "redacted@example.invalid"}'  # D9


def test_request_rules_without_db(local_client):
    """AC-574: 새 경로 — 토큰 없음 401, X-PaperLab 없음 403, 남의 Origin 403, oa/lookup 본문 5KB → 400"""
    from fastapi.testclient import TestClient
    app = local_client.app
    bare = TestClient(app)
    assert bare.get("/api/sources").status_code == 401
    assert bare.post("/api/oa/lookup", json={"doi": "10.1234/x"}, headers={"X-PaperLab": "1"}).status_code == 401
    tok = {"Authorization": f"Bearer {local_client.auth_token}"}
    assert bare.post("/api/oa/lookup", json={"doi": "10.1234/x"}, headers=tok).status_code == 403
    r = bare.post("/api/oa/lookup", json={"doi": "10.1234/x"},
                  headers={**tok, "X-PaperLab": "1", "Origin": "https://evil.example"})
    assert r.status_code == 403
    r = local_client.post("/api/oa/lookup", json={"doi": "10.1234/x", "pad": "x" * 5000})
    assert r.status_code == 400

    def chunks():  # D3: Content-Length 없이 chunked 6KB
        yield b'{"doi": "10.1234/x", "pad": "'
        for _ in range(6):
            yield b"x" * 1024
        yield b'"}'

    r = local_client.post("/api/oa/lookup", content=chunks(), headers={"Content-Type": "application/json"})
    assert r.status_code == 400 and r.json()["code"] == "bad_request"
    assert local_client.post("/api/oa/lookup", content=b"[1]").status_code == 400
    r = local_client.post("/api/oa/lookup", json={"doi": "10.1234/a/../b"})
    assert r.status_code == 400 and r.json()["code"] == "bad_doi"
    st = local_client.get("/api/sources")
    assert st.status_code == 200 and st.json()["kci"]["enabled"] is False and "unpaywall" not in st.json()
