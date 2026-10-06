from paperlab import citations


def test_csl_item_conference(sample):
    sample.update(doi="10.5555/3295222.3295349", issued="2017-12-04", citekey="vaswani2017attention", id=7)
    it = citations.to_csl_item(sample)
    assert it["id"] == "7" and it["citation-key"] == "vaswani2017attention"
    assert it["type"] == "paper-conference"
    assert it["container-title"] == "Advances in Neural Information Processing Systems"
    assert it["issued"] == {"date-parts": [[2017, 12, 4]]}
    assert it["page"] == "5998-6008" and it["DOI"] == "10.5555/3295222.3295349"
    assert it["author"][0] == {"family": "Vaswani", "given": "Ashish"}


def test_csl_item_arxiv_preprint():
    p = {"title": "GPT-4 Technical Report", "authors": [{"literal": "OpenAI"}], "year": 2023,
         "arxiv_id": "2303.08774", "item_type": "preprint", "venue": "arXiv"}
    it = citations.to_csl_item(p)
    assert it["type"] == "article" and it["genre"] == "Preprint" and it["publisher"] == "arXiv"
    assert it["number"] == "arXiv:2303.08774" and it["DOI"] == "10.48550/arXiv.2303.08774"
    assert "container-title" not in it and it["author"] == [{"literal": "OpenAI"}]


def test_csl_names_korean_and_particles():
    p = {"title": "그래프 신경망 연구", "year": 2023, "venue": "정보과학회논문지",
         "authors": [{"family": "홍", "given": "길동"}, {"family": "van Beethoven", "given": "Ludwig"}]}
    it = citations.to_csl_item(p)
    assert it["author"][0] == {"literal": "홍길동"}
    assert it["author"][1] == {"family": "Beethoven", "given": "Ludwig", "non-dropping-particle": "van"}
    assert it["language"] == "ko"


def test_citation_issues(sample):
    assert citations.citation_issues(sample) == []
    assert citations.citation_issues(dict(sample, pages="")) == ["쪽"]
    assert citations.citation_issues({"title": "x", "item_type": "book"}) == ["저자", "연도", "출판사"]
    pre = {"title": "x", "authors": [{"family": "a"}], "year": 2020, "item_type": "preprint", "arxiv_id": "2001.00001"}
    assert citations.citation_issues(pre) == []
    art = {"title": "x", "authors": [{"family": "a"}], "year": 2020, "item_type": "article"}
    assert citations.citation_issues(art) == ["학술지 이름", "권", "쪽"]


def test_csl_import_tolerates_arrays():
    out = citations.parse_any('[{"type": "article-journal", "title": ["Deep", "Learning"], "container-title": ["Nature"],'
                              ' "volume": 521, "author": [{"family": "LeCun", "given": "Yann"}]}]')
    assert out[0]["title"] == "Deep Learning" and out[0]["venue"] == "Nature" and out[0]["volume"] == "521"


def test_issued_parsing():
    assert citations.parse_issued("2017-06-12") == [2017, 6, 12]
    assert citations.parse_issued("2017/13/40") == [2017]
    assert citations.parse_issued("", 2015) == [2015]
    assert citations.format_issued([2017, 6]) == "2017-06"


def test_bibtex_roundtrip(sample):
    sample["citekey"] = "vaswani2017attention"
    bib = citations.to_bibtex([sample])
    assert "@inproceedings{vaswani2017attention," in bib
    assert "pages = {5998--6008}" in bib
    back = citations.parse_bibtex(bib)[0]
    assert back["title"] == sample["title"]
    assert "month = {dec}" in citations.to_bibtex([dict(sample, issued="2017-12-04")])
    assert citations.parse_bibtex(citations.to_bibtex([dict(sample, issued="2017-12-04")]))[0]["issued"] == "2017-12"
    assert back["authors"][0] == {"given": "Ashish", "family": "Vaswani"}
    assert back["year"] == 2017 and back["pages"] == "5998-6008"
    assert back["item_type"] == "conference"


def test_parse_bibtex_variants():
    text = r"""
    @comment{ignore me}
    @article{knuth84,
      author = "Donald E. Knuth and M{\"u}ller, J{\"o}rg and {Google Research}",
      title = {Literate {P}rogramming},
      journal = {The Computer Journal},
      year = 1984, volume = {27}, number = {2}, pages = {97--111},
      doi = {10.1093/comjnl/27.2.97}
    }
    """
    [p] = citations.parse_bibtex(text)
    assert p["title"] == "Literate Programming"
    assert p["authors"][0] == {"given": "Donald E.", "family": "Knuth"}
    assert p["authors"][1] == {"given": "Jörg", "family": "Müller"}
    assert p["authors"][2] == {"literal": "Google Research"}
    assert p["year"] == 1984 and p["issue"] == "2" and p["venue"] == "The Computer Journal"


def test_ris_roundtrip(sample):
    ris = citations.to_ris([sample])
    assert "TY  - CONF" in ris and "SP  - 5998" in ris and "EP  - 6008" in ris
    [back] = citations.parse_ris(ris)
    assert back["title"] == sample["title"]
    assert citations.parse_ris(citations.to_ris([dict(sample, issued="2017-12-04")]))[0]["issued"] == "2017-12-04"
    assert back["pages"] == "5998-6008"
    assert back["authors"][1] == {"given": "Noam", "family": "Shazeer"}


def test_parse_any_csl(sample):
    out = citations.parse_any(citations.to_csl_json([dict(sample, issued="2017-12-04")]))
    assert out[0]["title"] == sample["title"] and out[0]["year"] == 2017 and out[0]["issued"] == "2017-12-04"
    assert out[0]["item_type"] == "conference"
    pre = citations.parse_any(citations.to_csl_json([{"title": "P", "arxiv_id": "2303.08774", "item_type": "preprint",
                                                     "authors": [{"family": "홍", "given": "길동"}]}]))[0]
    assert pre["arxiv_id"] == "2303.08774" and pre["item_type"] == "preprint" and pre["doi"] == ""
    assert pre["authors"] == [{"family": "홍", "given": "길동"}]


def test_bibtex_key_without_library_id(sample):
    assert citations.to_bibtex([sample]).startswith("@inproceedings{vaswani2017attention,")
