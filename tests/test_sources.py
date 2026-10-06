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


def test_rate_limit_message():
    s = _mock_sources(lambda r: httpx.Response(429))
    with pytest.raises(sources.SourceError, match="요청 한도"):
        s.search("x")


def test_download_pdf_rejects_html():
    s = _mock_sources(lambda r: httpx.Response(200, content=b"<html>login</html>"))
    with pytest.raises(sources.SourceError, match="PDF가 아니에요"):
        s.download_pdf("https://example.org/paper.pdf")
