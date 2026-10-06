from paperlab import citations


def test_apa(sample):
    out = citations.format_citation(sample, "apa")
    assert out["text"].startswith("Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention Is All You Need.")
    assert "<i>Advances in Neural Information Processing Systems</i>" in out["html"]
    assert "https://doi.org/10.48550/arxiv.1706.03762" in out["text"]


def test_other_styles(sample):
    assert citations.format_citation(sample, "mla")["text"].startswith("Vaswani, Ashish, et al. “Attention Is All You Need.”")
    assert citations.format_citation(sample, "ieee")["text"].startswith(
        "A. Vaswani, N. Shazeer, and N. Parmar, “Attention Is All You Need,”")
    assert citations.format_citation(sample, "chicago")["text"].startswith(
        "Vaswani, Ashish, Noam Shazeer, and Niki Parmar. 2017.")
    assert citations.format_citation(sample, "vancouver")["text"].startswith("Vaswani A, Shazeer N, Parmar N.")
    assert citations.in_text(sample, "apa") == "(Vaswani et al., 2017)"


def test_korean_names():
    p = {"title": "한국어 논문", "authors": [{"family": "홍", "given": "길동"}, {"family": "김", "given": "철수"}],
         "year": 2023, "venue": "정보과학회논문지"}
    assert citations.format_citation(p, "apa")["html"].startswith("홍길동, 김철수 (2023). 한국어 논문. <i>")


def test_bibtex_roundtrip(sample):
    sample["citekey"] = "vaswani2017attention"
    bib = citations.to_bibtex([sample])
    assert "@inproceedings{vaswani2017attention," in bib
    assert "pages = {5998--6008}" in bib
    back = citations.parse_bibtex(bib)[0]
    assert back["title"] == sample["title"]
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
    assert back["pages"] == "5998-6008"
    assert back["authors"][1] == {"given": "Noam", "family": "Shazeer"}


def test_parse_any_csl(sample):
    out = citations.parse_any(citations.to_csl_json([sample]))
    assert out[0]["title"] == sample["title"] and out[0]["year"] == 2017


def test_bibtex_key_without_library_id(sample):
    assert citations.to_bibtex([sample]).startswith("@inproceedings{vaswani2017attention,")
