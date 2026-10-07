import httpx
import pytest

from paperlab import sources

OPENALEX_WORK = {
    "id": "https://openalex.org/W2963403868",
    "display_name": "Attention Is All You Need",
    "doi": "https://doi.org/10.48550/arxiv.1706.03762",
    "publication_year": 2017,
    "type": "preprint",
    "cited_by_count": 100000,
    "authorships": [{"author": {"display_name": "Ashish Vaswani"}}, {"author": {"display_name": "Noam Shazeer"}}],
    "primary_location": {"source": {"display_name": "arXiv"}, "landing_page_url": "https://arxiv.org/abs/1706.03762"},
    "best_oa_location": {"pdf_url": "https://arxiv.org/pdf/1706.03762"},
    "open_access": {"is_oa": True},
    "abstract_inverted_index": {"The": [0], "dominant": [1], "models": [2]},
    "biblio": {"first_page": "1", "last_page": "11"},
    "referenced_works": ["https://openalex.org/W1", "https://openalex.org/W2"],
}

ARXIV_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom">
  <opensearch:totalResults>1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All
      You Need</title>
    <summary>The dominant sequence transduction models.</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Ludwig van Beethoven</name></author>
    <category term="cs.CL"/>
  </entry>
</feed>"""


def test_detect_identifier():
    assert sources.detect_identifier("https://doi.org/10.1038/nature14539") == ("doi", "10.1038/nature14539")
    assert sources.detect_identifier("arXiv:1706.03762v5") == ("arxiv", "1706.03762")
    assert sources.detect_identifier("https://arxiv.org/pdf/2303.08774v2.pdf") == ("arxiv", "2303.08774")
    assert sources.detect_identifier("10.48550/arXiv.1706.03762") == ("arxiv", "1706.03762")
    assert sources.detect_identifier("hep-th/9901001") == ("arxiv", "hep-th/9901001")
    assert sources.detect_identifier("W2963403868") == ("openalex", "W2963403868")
    assert sources.detect_identifier("graph neural networks")[0] == "query"


def test_split_name():
    assert sources.split_name("Ludwig van Beethoven") == {"given": "Ludwig", "family": "van Beethoven"}
    assert sources.split_name("Knuth, Donald E.") == {"given": "Donald E.", "family": "Knuth"}
    assert sources.split_name("홍길동") == {"given": "길동", "family": "홍"}


def test_norm_openalex():
    p = sources.norm_openalex(OPENALEX_WORK)
    assert p["arxiv_id"] == "1706.03762" and p["doi"] == ""
    assert p["openalex_id"] == "W2963403868"
    assert p["abstract"] == "The dominant models"
    assert p["pages"] == "1-11" and p["item_type"] == "preprint"
    assert p["pdf_url"] == "https://arxiv.org/pdf/1706.03762"


def test_parse_arxiv_feed():
    res = sources.parse_arxiv_feed(ARXIV_FEED)
    [p] = res["items"]
    assert res["total"] == 1
    assert p["title"] == "Attention Is All You Need"
    assert p["arxiv_id"] == "1706.03762" and p["year"] == 2017
    assert p["authors"][1]["family"] == "van Beethoven"


def _mock_sources(handler):
    return sources.Sources(lambda k: "", transport=httpx.MockTransport(handler))


def test_search_and_related_with_mock():
    seen = []

    def handler(request: httpx.Request):
        seen.append(request.url)
        if request.url.path == "/works" and "search" in request.url.params:
            return httpx.Response(200, json={"meta": {"count": 1}, "results": [OPENALEX_WORK]})
        if request.url.path == "/works/W2963403868":
            return httpx.Response(200, json=OPENALEX_WORK)
        if request.url.path == "/works" and request.url.params.get("filter", "").startswith("openalex:"):
            return httpx.Response(200, json={"results": [dict(OPENALEX_WORK, id="https://openalex.org/W1")]})
        return httpx.Response(404)

    s = _mock_sources(handler)
    res = s.search("transformer", year_from=2015, sort="cited", open_access=True)
    assert res["total"] == 1 and res["items"][0]["title"] == "Attention Is All You Need"
    assert seen[0].params["filter"] == "publication_year:2015-,is_oa:true"
    assert seen[0].params["sort"] == "cited_by_count:desc"
    refs = s.related({"openalex_id": "W2963403868"}, "references")
    assert refs["total"] == 2 and refs["items"][0]["openalex_id"] == "W1"


def test_no_email_to_openalex_but_crossref_keeps_it():
    """인용 그래프 명세 K-6: 기존 검색 · 조회의 OpenAlex 요청에도 사용자 이메일(mailto · User-Agent)을 보내지 않음.
    Crossref는 그대로(mailto · User-Agent)."""
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        if request.url.host == "api.crossref.org":
            return httpx.Response(200, json={"message": {"items": [], "total-results": 0, "title": ["T"]}})
        return httpx.Response(200, json={"meta": {"count": 1}, "results": [OPENALEX_WORK], **OPENALEX_WORK})

    settings = {"contact_email": "me@example.com", "openalex_api_key": "k"}
    s = sources.Sources(lambda k: settings.get(k, ""), transport=httpx.MockTransport(handler))
    s.search("transformer")
    s.related({"openalex_id": "W2963403868"}, "references")
    s.lookup_doi("10.1/xyz")
    oa = [r for r in seen if r.url.host == "api.openalex.org"]
    cr = [r for r in seen if r.url.host == "api.crossref.org"]
    assert oa and cr
    for r in oa:
        assert "mailto" not in r.url.params and "@" not in r.headers["user-agent"]
        assert r.url.params.get("api_key") == "k"
    assert all("me@example.com" in r.headers["user-agent"] for r in cr)
    s.search("transformer", source="crossref")
    assert seen[-1].url.params.get("mailto") == "me@example.com"


def test_email_only_to_crossref_every_path():
    """팀장 결정(K-6 확대): 연락처 이메일은 Crossref에만. arXiv · Semantic Scholar · PDF 받기 · OpenAlex의
    User-Agent · 쿼리 어디에도 없고, User-Agent는 'PaperLab/<버전>'"""
    from paperlab import __version__
    email = "me@example.com"
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        host = request.url.host
        if host == "api.crossref.org":
            return httpx.Response(200, json={"message": {"items": [], "total-results": 0, "title": ["T"]}})
        if host == "export.arxiv.org":
            return httpx.Response(200, text=ARXIV_FEED)
        if host == "api.semanticscholar.org":
            return httpx.Response(200, json={"data": [], "total": 0})
        if host == "api.openalex.org":
            return httpx.Response(200, json={"meta": {"count": 1}, "results": [OPENALEX_WORK], **OPENALEX_WORK})
        return httpx.Response(200, content=b"%PDF-1.4 ok")

    settings = {"contact_email": email}
    s = sources.Sources(lambda k: settings.get(k, ""), transport=httpx.MockTransport(handler), resolver=_resolver)
    s.search("graphs", source="arxiv")
    s.lookup_arxiv("1706.03762")
    s.search("graphs", source="semanticscholar")
    s.search("graphs", source="openalex")
    s.lookup_openalex("W2963403868")
    assert s.download_pdf("https://example.org/a.pdf") == b"%PDF-1.4 ok"
    s.search("graphs", source="crossref")
    s.lookup_doi("10.1/xyz")
    by_host: dict[str, list] = {}
    for r in seen:
        by_host.setdefault(r.headers.get("host", r.url.host).split(":")[0], []).append(r)
    assert {"export.arxiv.org", "api.semanticscholar.org", "api.openalex.org", "example.org", "api.crossref.org"} <= set(by_host)
    for host, reqs in by_host.items():
        for r in reqs:
            if host == "api.crossref.org":
                assert email in r.headers["user-agent"], host
            else:
                assert r.headers["user-agent"] == f"PaperLab/{__version__}", host
                assert email not in str(r.url) and "mailto" not in r.url.params, host
    crossref_search = [r for r in by_host["api.crossref.org"] if r.url.path == "/works"]
    assert crossref_search and crossref_search[0].url.params.get("mailto") == email


def test_redirects_only_within_same_host():
    """품질팀 M-8: Crossref(이메일이 붙는 요청) 등 조회는 다른 호스트로 가는 리디렉션을 따라가지 않음, 같은 호스트는 따라감"""
    seen = []

    def handler(request: httpx.Request):
        seen.append(str(request.url))
        if request.url.host == "api.crossref.org" and request.url.path == "/works/10.1/away":
            return httpx.Response(302, headers={"Location": "https://evil.example/steal"})
        if request.url.host == "api.crossref.org" and request.url.path == "/works/10.1/moved":
            return httpx.Response(301, headers={"Location": "/works/10.1/here"})
        if request.url.host == "api.crossref.org":
            return httpx.Response(200, json={"message": {"title": ["Here"], "DOI": "10.1/here"}})
        return httpx.Response(404)

    s = sources.Sources(lambda k: {"contact_email": "me@example.com"}.get(k, ""), transport=httpx.MockTransport(handler))
    with pytest.raises(sources.SourceError):
        s._get_json(f"{sources.CROSSREF}/works/10.1/away")
    assert not [u for u in seen if "evil.example" in u]
    assert s._get_json(f"{sources.CROSSREF}/works/10.1/moved")["message"]["title"] == ["Here"]
    assert seen[-1].endswith("/works/10.1/here")


def test_rate_limit_message():
    s = _mock_sources(lambda r: httpx.Response(429))
    with pytest.raises(sources.SourceError, match="요청 한도"):
        s.search("x")


PUBLIC = {"example.org": ["93.184.215.14"], "files.example.org": ["93.184.215.15"],
          "evil.example": ["127.0.0.1"], "mixed.example": ["93.184.215.16", "10.0.0.5"],
          "v6.example": ["2606:2800:21f:cb07:6820:80da:af6b:8b2c"], "mapped.example": ["::ffff:169.254.169.254"]}


def _resolver(host, port):
    if host not in PUBLIC:
        raise OSError("no such host")
    return PUBLIC[host]


def _pdf_sources(handler):
    return sources.Sources(lambda k: "", transport=httpx.MockTransport(handler), resolver=_resolver)


def test_download_pdf_rejects_html():
    s = _pdf_sources(lambda r: httpx.Response(200, content=b"<html>login</html>"))
    with pytest.raises(sources.SourceError, match="PDF가 아니에요"):
        s.download_pdf("https://example.org/paper.pdf")


def test_download_pdf_pins_checked_ip_and_keeps_host():
    seen = []

    def handler(r):
        seen.append(r)
        return httpx.Response(200, content=b"%PDF-1.4 ok")

    assert _pdf_sources(handler).download_pdf("https://example.org/a.pdf") == b"%PDF-1.4 ok"
    assert seen[0].url.host == "93.184.215.14" and seen[0].headers["host"] == "example.org"
    assert seen[0].extensions.get("sni_hostname") == "example.org"


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/x.pdf", "http://localhost:8080/x.pdf", "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/", "http://10.1.2.3/x.pdf", "http://192.168.0.1/x.pdf",
    "http://[::1]/x.pdf", "http://2130706433/x.pdf", "http://0x7f000001/x.pdf", "http://100.64.0.1/x.pdf",
    "http://evil.example/x.pdf", "http://mixed.example/x.pdf", "http://mapped.example/x.pdf",
    "file:///etc/passwd", "ftp://example.org/x.pdf", "gopher://example.org/", "http://user:pw@example.org/x.pdf",
    "http://nosuchhost.example/x.pdf", "not a url", "http:///x.pdf",
])
def test_download_pdf_blocks_internal_targets(url):
    """품질팀 F3: SSRF — 사설 · 루프백 · 링크로컬 · 메타데이터 · 이상한 스킴은 연결 전에 같은 문구로 거부"""
    called = []
    s = _pdf_sources(lambda r: called.append(r) or httpx.Response(200, content=b"%PDF"))
    with pytest.raises(sources.SourceError) as e:
        s.download_pdf(url)
    assert str(e.value) == sources.PDF_FETCH_FAILED and called == []


def test_download_pdf_checks_every_redirect():
    hops = []

    def handler(r):
        hops.append(str(r.url))
        if r.headers["host"] == "example.org":
            return httpx.Response(302, headers={"Location": "http://files.example.org/real.pdf"})
        if r.headers["host"] == "files.example.org":
            return httpx.Response(301, headers={"Location": "http://169.254.169.254/latest/"})
        return httpx.Response(200, content=b"%PDF")

    with pytest.raises(sources.SourceError) as e:
        _pdf_sources(handler).download_pdf("https://example.org/a.pdf")
    assert str(e.value) == sources.PDF_FETCH_FAILED and len(hops) == 2  # 메타데이터 주소로는 연결하지 않음

    ok = _pdf_sources(lambda r: httpx.Response(302, headers={"Location": "/b.pdf"}) if r.url.path == "/a.pdf"
                      else httpx.Response(200, content=b"%PDF-ok"))
    assert ok.download_pdf("https://v6.example/a.pdf") == b"%PDF-ok"
    loop = _pdf_sources(lambda r: httpx.Response(302, headers={"Location": "/again"}))
    with pytest.raises(sources.SourceError):
        loop.download_pdf("https://example.org/a.pdf")


def test_download_pdf_hides_upstream_errors():
    s = _pdf_sources(lambda r: httpx.Response(404))
    with pytest.raises(sources.SourceError) as e:
        s.download_pdf("https://example.org/a.pdf")
    assert str(e.value) == sources.PDF_FETCH_FAILED

    def boom(r):
        raise httpx.ConnectError("connection refused to 10.0.0.1:22")
    with pytest.raises(sources.SourceError) as e:
        _pdf_sources(boom).download_pdf("https://example.org/a.pdf")
    assert str(e.value) == sources.PDF_FETCH_FAILED
