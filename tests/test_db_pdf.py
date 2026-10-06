from paperlab import pdf
from paperlab.db import Database

from .conftest import make_pdf


def test_pdf_extract():
    info = pdf.extract(make_pdf())
    assert info.title == "Deep Residual Learning for Image Recognition"
    assert info.doi == "10.1109/cvpr.2016.90"
    assert len(info.page_texts) == 2 and "shortcut" in info.page_texts[1]


def test_pdf_arxiv_doi_becomes_arxiv_id():
    info = pdf.extract(make_pdf(doi="10.48550/arXiv.2303.08774"))
    assert info.arxiv_id == "2303.08774" and info.doi == ""


def test_library_crud_and_search(tmp_path, sample):
    db = Database(tmp_path / "t.db")
    pid = db.add_paper(sample)
    p = db.get_paper(pid)
    assert p["citekey"] == "vaswani2017attention"
    assert p["authors"][0]["family"] == "Vaswani"

    db.set_pdf(pid, "pdfs/x.pdf", ["intro text", "multi-head self-attention mechanism"])
    res = db.list_papers(q="self-attention")
    assert res["total"] == 1 and "[[self-attention]]" in res["items"][0]["snippet"]
    assert db.list_papers(q="vaswani transduction")["total"] == 1
    assert db.list_papers(q="nonexistentword")["total"] == 0

    kid = db.add_paper({"title": "그래프 신경망을 이용한 추천 시스템 연구", "authors": [{"family": "홍", "given": "길동"}]})
    assert [i["id"] for i in db.list_papers(q="신경망")["items"]] == [kid]
    assert [i["id"] for i in db.list_papers(q="추천")["items"]] == [kid]  # 2글자 검색

    db.save_note(kid, "메모: 콜드 스타트 문제")
    assert db.list_papers(q="콜드 스타트")["total"] == 1

    assert db.find_duplicate(doi="https://doi.org/10.48550/ARXIV.1706.03762")["id"] == pid
    assert db.find_duplicate(title="attention is all you need!")["id"] == pid


def test_collections_tags_annotations(tmp_path, sample):
    db = Database(tmp_path / "t.db")
    pid = db.add_paper(sample)
    root = db.add_collection("Thesis")
    child = db.add_collection("Chapter 2", root)
    db.set_paper_collections([pid], child, True)
    assert db.list_papers(collection_id=child)["total"] == 1
    assert db.list_papers(filter_="unfiled")["total"] == 0
    try:
        db.update_collection(root, parent_id=child)
        raise AssertionError("cycle allowed")
    except ValueError:
        pass

    db.set_paper_tags(pid, ["NLP", "transformer", "nlp"])
    assert {t["name"] for t in db.get_paper(pid)["tags"]} == {"NLP", "transformer"}
    tag_id = db.list_tags()[0]["id"]
    assert db.list_papers(tag_id=tag_id)["total"] == 1

    aid = db.add_annotation(pid, {"page": 3, "text": "scaled dot-product", "rects": [[0.1, 0.2, 0.3, 0.02]]})
    db.update_annotation(aid, {"comment": "핵심 수식", "color": "green"})
    [a] = db.list_annotations(pid)
    assert a["comment"] == "핵심 수식" and a["rects"] == [[0.1, 0.2, 0.3, 0.02]]
    assert db.list_papers(q="핵심 수식")["total"] == 1

    db.delete_collection(root)
    assert db.list_collections() == []
    db.delete_paper(pid)
    assert db.list_papers(q="scaled")["total"] == 0
