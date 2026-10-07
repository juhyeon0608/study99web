"""PDF 추출(단위)과 서재 질의(테스트 프로젝트 DB) — 변경 전 SQLite 테스트를 Postgres로 옮김 (AC-23 · 25 · 26 · 27 · 32 · 33 · 34)."""

import jwt
import pytest

from paperlab import pdf
from paperlab.db import make_snippet

from .conftest import make_pdf


def claims_of(user) -> dict:
    return jwt.decode(user.token, options={"verify_signature": False})


def test_pdf_extract():
    info = pdf.extract(make_pdf())
    assert info.title == "Deep Residual Learning for Image Recognition"
    assert info.doi == "10.1109/cvpr.2016.90"
    assert len(info.page_texts) == 2 and "shortcut" in info.page_texts[1]


def test_pdf_arxiv_doi_becomes_arxiv_id():
    info = pdf.extract(make_pdf(doi="10.48550/arXiv.2303.08774"))
    assert info.arxiv_id == "2303.08774" and info.doi == ""


def test_make_snippet():
    snip = make_snippet("intro text then multi-head self-attention mechanism here", ["self-attention"])
    assert "[[self-attention]]" in snip
    long = " ".join(f"w{i}" for i in range(40)) + " Target " + " ".join(f"v{i}" for i in range(40))
    s = make_snippet(long, ["target"])
    assert s.startswith("…") and s.endswith("…") and "[[Target]]" in s and len(s.split()) <= 17
    assert make_snippet("nothing", ["zzz"]) == ""


# ---------------------------------------------------------------- DB (테스트 프로젝트)
@pytest.fixture
def lib_for(session_db, users):
    """lib_for(user) → 그 사용자 트랜잭션 컨텍스트"""
    def make(user):
        return session_db.user_tx(claims_of(user))
    return make


@pytest.mark.db
def test_library_crud_and_search(lib_for, users, sample):
    """AC-32: 기존 검색 단언 전부"""
    a = users()
    with lib_for(a) as db:
        pid = db.add_paper(sample)
        p = db.get_paper(pid)
        assert p["citekey"] == "vaswani2017attention"
        assert p["authors"][0]["family"] == "Vaswani"
        assert "pdf_path" not in p and "pdf_key" not in p and p["has_pdf"] is False
        db.set_pdf(pid, f"users/{a.id}/papers/{pid}.pdf", ["intro text", "multi-head self-attention mechanism"])
    with lib_for(a) as db:
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
        assert db.find_duplicate(title="Attention is") is None  # 11자 이하 정규화 제목은 제목 일치 안 함 (AC-27)


@pytest.mark.db
def test_collections_tags_annotations(lib_for, users, sample):
    a = users()
    with lib_for(a) as db:
        pid = db.add_paper(sample)
        root = db.add_collection("Thesis")
        child = db.add_collection("Chapter 2", root)
        db.set_paper_collections([pid], child, True)
        assert db.list_papers(collection_id=child)["total"] == 1
        assert db.list_papers(filter_="unfiled")["total"] == 0
        with pytest.raises(ValueError):
            db.update_collection(root, parent_id=child)

        db.set_paper_tags(pid, ["NLP", "transformer", "nlp"])  # AC-26
        assert {t["name"] for t in db.get_paper(pid)["tags"]} == {"NLP", "transformer"}
        tag_id = db.list_tags()[0]["id"]
        assert db.list_papers(tag_id=tag_id)["total"] == 1

        aid = db.add_annotation(pid, {"page": 3, "text": "scaled dot-product", "rects": [[0.1, 0.2, 0.3, 0.02]]})
        db.update_annotation(aid, {"comment": "핵심 수식", "color": "green"})
        [ann] = db.list_annotations(pid)
        assert ann["comment"] == "핵심 수식" and ann["rects"] == [[0.1, 0.2, 0.3, 0.02]]
        assert db.list_papers(q="핵심 수식")["total"] == 1

        db.delete_collection(root)
        assert db.list_collections() == []
        db.set_paper_tags(pid, [])
        assert db.list_tags() == []  # 연결 없고 색 없는 태그 자동 삭제
        db.delete_paper(pid)
        assert db.list_papers(q="scaled")["total"] == 0


# 변경 전 SQLite 코드로 뽑은 기대값 (scratch capture_sqlite.py — AC-25 · 33)
SORT_DATA = [
    dict(title="beta Networks", authors=[{"family": "Kim"}], year=2019, cited_by_count=10),
    dict(title="Alpha study", authors=[{"family": "lee"}], year=None, cited_by_count=None),
    dict(title="gamma Results", authors=[], year=2021, cited_by_count=5),
    dict(title="Delta analysis", authors=[{"family": "Park"}], year=2019, cited_by_count=50),
    dict(title="alpha Beta", authors=[{"family": "choi"}], year=2015, cited_by_count=0),
]
_T = ["2026-01-0%dT00:00:00+00:00" % i for i in range(1, 6)]
SORT_TIMES = [(_T[0], _T[2], _T[1]), (_T[1], _T[0], None), (_T[2], _T[4], _T[3]), (_T[3], _T[1], _T[0]),
              (_T[4], _T[3], None)]  # (added, updated, opened)
SQLITE_SORTS = {"added": [4, 3, 2, 1, 0], "updated": [2, 4, 0, 3, 1], "opened": [2, 0, 3, 1, 4],
                "year": [2, 3, 0, 4, 1], "title": [4, 1, 0, 3, 2], "cited": [3, 0, 2, 4, 1],
                "first_author": [2, 4, 0, 1, 3]}
SQLITE_SEARCH = {"망": [1], "x": [0, 2], "X": [0, 2], "transduc": [0], "ATTENTION": [0], "self-attention": [0],
                 "추천": [1], "OR": [0], "-attention": [0], "(": [], '"': [], "%": [], "_": [], "\\": [], "a": [0, 2],
                 "드 스": [1]}


@pytest.mark.db
def test_sort_orders_match_sqlite(lib_for, users):
    """AC-25"""
    a = users()
    with lib_for(a) as db:
        ids = []
        for data, (added, updated, opened) in zip(SORT_DATA, SORT_TIMES):
            pid = db.add_paper(data)
            db.conn.execute("update paperlab.papers set added_at = %s, updated_at = %s, last_opened_at = %s "
                            "where id = %s", (added, updated, opened, pid))
            ids.append(pid)
        for sort, expected in SQLITE_SORTS.items():
            got = [ids.index(i["id"]) for i in db.list_papers(sort=sort)["items"]]
            assert got == expected, sort


@pytest.mark.db
def test_search_matches_sqlite(lib_for, users):
    """AC-33 · AC-34: 1글자 · 부분 낱말 · 대소문자 · 특수 문자가 변경 전 결과와 같고 500이 아님"""
    a = users()
    with lib_for(a) as db:
        s0 = db.add_paper({"title": "Attention Is All You Need", "authors": [{"given": "Ashish", "family": "Vaswani"}],
                           "abstract": "The dominant sequence transduction models are based on complex recurrent networks."})
        db.set_pdf(s0, f"users/{a.id}/papers/{s0}.pdf", ["intro text", "multi-head self-attention mechanism"])
        s1 = db.add_paper({"title": "그래프 신경망을 이용한 추천 시스템 연구", "authors": [{"family": "홍", "given": "길동"}]})
        db.save_note(s1, "메모: 콜드 스타트 문제")
        s2 = db.add_paper({"title": "Xylophone acoustics", "abstract": "sound of wood"})
        sids = [s0, s1, s2]
        for q, expected in SQLITE_SEARCH.items():
            got = sorted(sids.index(i["id"]) for i in db.list_papers(q=q)["items"])
            assert got == expected, q
