"""서재 대조 (2026-10-27): 문장 여러 개 일괄 검색(rag.Rag.batch_search) · 표현 겹침(rag.overlap) · /api/library-match 입력 검사"""
import contextlib

import numpy as np

from paperlab import rag


def test_overlap_counts_copied_wording():
    src = "사회적 지지는 청소년의 우울을 낮추는 중요한 보호 요인으로 작용한다는 것이 여러 연구에서 확인되었다."
    assert rag.overlap("사회적 지지는 청소년의 우울을 낮추는 중요한 보호 요인으로 작용한다.", src) >= 0.9
    assert rag.overlap("친구와 가족의 도움은 십대가 덜 우울하게 지내도록 돕는 것으로 알려져 있다.", src) < 0.2
    assert rag.overlap("짧은 문장.", src) == 0.0  # 20자 미만은 보지 않음


def test_batch_search_one_embed_per_call(monkeypatch):
    texts = {1: "청소년 우울과 사회적 지지의 관계", 2: "기계 학습 모델의 과적합 방지 기법"}
    emb = rag.HashEmbedder()
    calls = []

    class Spy:
        def embed(self, xs):
            calls.append(len(xs))
            return emb.embed(xs)

    papers = {}
    for pid, t in texts.items():
        meta = np.zeros(1, rag.META)
        meta[0] = (1, 0, len(t), (np.nan,) * 4, 0)
        papers[pid] = (meta, emb.embed([rag.doc_text("", t)]))
    r = rag.Rag(storage=None, embedder=Spy())
    monkeypatch.setattr(r, "papers", lambda tx, uid, rows: papers)
    monkeypatch.setattr(rag, "page_slices", lambda lib, items: {(pid, 1): t for pid, t in texts.items()})
    out = r.batch_search(lambda: contextlib.nullcontext(None), "u", [], ["청소년 우울 사회적 지지", "과적합 방지 기법"], k=1)
    assert calls == [2]  # 문장 둘을 한 번에 임베딩
    assert [o[0]["paper_id"] for o in out] == [1, 2]
    assert out[0][0]["text"] == texts[1]
    assert r.batch_search(lambda: contextlib.nullcontext(None), "u", [], [], k=1) == []


def test_library_match_input_checks(local_client):
    assert local_client.post("/api/library-match", json={"queries": []}).status_code == 400
    assert local_client.post("/api/library-match", json={"queries": ["a"] * 151}).status_code == 400
    assert local_client.post("/api/library-match", json={"queries": [1, 2]}).status_code == 400


def test_retracted_dois_batches_and_normalizes(monkeypatch):
    """철회 논문 (2026-10-27): DOI 50개씩 OpenAlex is_retracted 필터, 결과 DOI는 소문자 · 주소 없이"""
    from paperlab.sources import Sources
    calls = []

    def fake(self, url, params=None, headers=None):
        calls.append(params["filter"])
        return {"results": [{"doi": "https://doi.org/10.1000/BAD.1"}] if "10.1000/bad.1" in params["filter"] else []}

    monkeypatch.setattr(Sources, "_get_json", fake)
    s = Sources(lambda k: None)
    dois = ["10.1000/bad.1"] + [f"10.1000/ok.{i}" for i in range(60)] + ["not a doi", "10.1000/bad.1"]
    assert s.retracted_dois(dois) == {"10.1000/bad.1"}
    assert len(calls) == 2 and all(c.startswith("is_retracted:true,doi:") for c in calls)
