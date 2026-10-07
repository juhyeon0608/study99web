"""인용 그래프 알고리즘 (명세 docs/specs/citation-graph.md 11장 A — AC-G01~G08). DB · 네트워크 없음."""

from __future__ import annotations

import math
import random
import time

import pytest

from paperlab import citegraph as cg


def W(no, title=None, cited=0, refs=None, related=None, year=2020):
    return {"no": no, "title": title if title is not None else f"Work number {no} about graphs",
            "cited_by_count": cited, "refs": refs, "related": related, "year": year}


def make_pool(seed_work, others, origin="reference"):
    p = cg.Pool(seed_work["no"])
    p.add(seed_work, "seed")
    for w in others:
        p.add(w, origin)
    return p


# ---------------------------------------------------------------- AC-G01
def test_jaccard_basics():
    assert cg.jaccard(set(), {1}) == 0 and cg.jaccard({1}, set()) == 0 and cg.jaccard(set(), set()) == 0
    assert cg.jaccard({1, 2}, {3}) == 0
    assert cg.jaccard({1, 2, 3}, {2, 3, 4}) == pytest.approx(2 / 4)


def test_min_shared_coupling_and_cocitation():
    """AC-G01: 겹침 1편이면 그 성분 0, 2편이면 자카드 값"""
    one = make_pool(W(1, refs=[10, 11, 12]), [W(2, refs=[10, 20, 21])])
    s = cg.similarity(cg.index(one), 1, 2)
    assert s.coupling == 0 and s.weight == 0
    two = make_pool(W(1, refs=[10, 11, 12]), [W(2, refs=[10, 11, 21])])
    s = cg.similarity(cg.index(two), 1, 2)
    assert s.coupling == pytest.approx(2 / 4) and s.weight == pytest.approx(0.6 * 0.5)
    assert s.kind == "coupling" and s.shared == 2
    # 공동 인용: 풀 안 작품 3·4가 1과 2를 함께 인용(2편) / 하나만(1편)
    co2 = make_pool(W(1, refs=[]), [W(2, refs=[]), W(3, refs=[1, 2]), W(4, refs=[1, 2, 99])])
    s = cg.similarity(cg.index(co2), 1, 2)
    assert s.cocitation == pytest.approx(1.0) and s.kind == "cocitation" and s.shared == 2
    assert s.weight == pytest.approx(0.4)
    co1 = make_pool(W(1, refs=[]), [W(2, refs=[]), W(3, refs=[1, 2]), W(4, refs=[1])])
    assert cg.similarity(cg.index(co1), 1, 2).cocitation == 0
    # 빈 집합
    empty = make_pool(W(1, refs=None), [W(2, refs=None)])
    assert cg.similarity(cg.index(empty), 1, 2) == cg.Sim(0.0, "coupling", 0, 0.0, 0.0, 0.0)


# ---------------------------------------------------------------- AC-G02
def test_related_is_fallback_only():
    """AC-G02: 인용 근거가 있으면 related 성분 0 · kind는 인용 쪽, 없고 서로 관련 지목이면 0.25 · related"""
    p = make_pool(W(1, refs=[10, 11], related=[2]), [W(2, refs=[10, 11, 12], related=[1])])
    s = cg.similarity(cg.index(p), 1, 2)
    assert s.coupling > 0 and s.related == 0 and s.kind == "coupling"
    p = make_pool(W(1, refs=[10], related=[2]), [W(2, refs=[20], related=[])])
    s = cg.similarity(cg.index(p), 1, 2)
    assert s.weight == pytest.approx(0.25) and s.kind == "related" and s.related == 1.0 and s.shared == 1
    # 지목은 없지만 관련 목록이 풀 안에서 겹침 → 자카드 × 0.25
    p = make_pool(W(1, related=[3, 4]), [W(2, related=[3, 4, 5]), W(3), W(4), W(5)])
    s = cg.similarity(cg.index(p), 1, 2)
    assert s.kind == "related" and s.weight == pytest.approx(0.25 * 2 / 3)
    # 풀 밖 관련 논문은 세지 않음
    p = make_pool(W(1, related=[300, 400]), [W(2, related=[300, 400])])
    assert cg.similarity(cg.index(p), 1, 2).weight == 0


# ---------------------------------------------------------------- AC-G03
def test_dedupe_by_title():
    """AC-G03"""
    seed = W(1, title="Seed Paper On Citation Graphs", refs=[2, 3, 50])
    pre = W(2, title="Graph Neural Networks: A Review", cited=10, refs=[60, 61])
    pub = W(3, title="Graph neural networks — a review", cited=100, refs=[61, 62])
    other = W(4, title="Something Else Entirely Here", refs=[2, 70])  # 지운 쪽(2)을 인용
    empty = W(5, title="   ", refs=[1])
    twin = W(6, title="SEED PAPER on citation-graphs", cited=999, refs=[80])
    p = make_pool(seed, [pre, pub, other, empty, twin])
    assert set(p.works) == {1, 3, 4}  # 2 → 3, 5(빈 제목) 없음, 6 → 씨앗
    assert p.alias == {2: 3, 6: 1} and p.seed == 1
    assert set(p.works[3]["refs"]) == {60, 61, 62}  # 합집합
    assert set(p.works[1]["refs"]) == {2, 3, 50, 80}
    ix = cg.index(p)
    assert ix.refs[4] == frozenset({3, 70})  # 지운 번호를 인용해도 같은 노드로 셈
    assert ix.refs[1] == frozenset({3, 50, 80})  # 씨앗이 2·3을 둘 다 인용 → 3 하나
    assert ix.citers[3] == frozenset({1, 4})
    # 순서가 반대여도(작은 쪽이 나중) 큰 쪽이 남음
    p2 = make_pool(seed, [pub, pre])
    assert set(p2.works) == {1, 3} and p2.alias == {2: 3}
    # 짧은 흔한 제목은 합치지 않음
    p3 = make_pool(seed, [W(7, title="Editorial", cited=1), W(8, title="Editorial", cited=2)])
    assert set(p3.works) == {1, 7, 8}


def test_same_number_merges_refs():
    p = make_pool(W(1, refs=[5]), [W(2, refs=[7])])
    p.add(W(2, refs=[8]), "citing")
    assert set(p.works[2]["refs"]) == {7, 8} and p.origin[2] == {"reference", "citing"}


# ---------------------------------------------------------------- AC-G04
def _ranking_pool():
    seed_refs = list(range(100, 110))
    seed = W(1, refs=seed_refs)
    others = []
    for i in range(100):  # 씨앗과 무관(유사도 0), 피인용 0 · 10 · 20 …
        others.append(W(1000 + i, refs=[5000 + i], cited=i * 10))
    # 동률: 같은 피인용 · 같은 유사도 → 번호 오름차순
    others.append(W(1200, refs=[5200], cited=995))
    others.append(W(1199, refs=[5199], cited=995))
    # 씨앗과 참고문헌이 같음(유사도 0.6), 피인용 적음
    others.append(W(2000, refs=seed_refs, cited=3))
    others.append(W(2001, refs=seed_refs[:5], cited=3))  # 자카드 0.5 → 0.3
    return make_pool(seed, others)


@pytest.mark.parametrize("size", [20, 40, 80])
def test_select_nodes_matches_expected(size):
    """AC-G04: rank = 5·sim + ln(1+피인용), 동률은 번호 오름차순, 씨앗 항상 포함"""
    p = _ranking_pool()
    ix = cg.index(p)
    sims = {2000: 0.6, 2001: 0.6 * 0.5}
    expected_rank = {no: cg.W_RANK_SIM * sims.get(no, 0.0) + math.log1p(w["cited_by_count"])
                     for no, w in p.works.items() if no != 1}
    expected = [1] + sorted(expected_rank, key=lambda n: (-expected_rank[n], n))[:size - 1]
    got = cg.select_nodes(ix, size)
    assert got == expected and got[0] == 1 and len(got) == size
    i, j = got.index(1199), got.index(1200)
    assert i < j  # 동률은 번호 오름차순


def test_select_nodes_small_pool():
    assert cg.select_nodes(cg.index(make_pool(W(1), [W(2)])), 40) == []
    assert cg.select_nodes(cg.index(make_pool(W(1), [W(2), W(3)])), 40) == [1, 2, 3]


def test_prelim_targets_order():
    seed_refs = [100, 101, 102, 103]
    p = make_pool(W(1, refs=seed_refs), [W(5, refs=seed_refs), W(4, refs=seed_refs), W(3, refs=seed_refs[:2]),
                                         W(2, refs=[999])])
    assert cg.prelim_targets(cg.index(p), 49) == [4, 5, 3]  # 같은 점수는 번호 순, 0점은 뺌
    assert cg.prelim_targets(cg.index(p), 2) == [4, 5]


# ---------------------------------------------------------------- AC-G05
def _random_pool(n=120, seed=7):
    rnd = random.Random(seed)
    universe = list(range(10_000, 10_400))
    works = [W(1, refs=rnd.sample(universe, 30), related=[])]
    for i in range(2, n + 1):
        refs = rnd.sample(universe, rnd.randint(5, 40)) + rnd.sample(range(1, n + 1), rnd.randint(0, 4))
        works.append(W(i, refs=refs, related=rnd.sample(range(1, n + 1), 3), cited=rnd.randint(0, 5000)))
    return make_pool(works[0], works[1:])


def test_edges_rules():
    """AC-G05: MIN_SCORE 미만 없음, 노드당 상위 6 규칙, 같은 쌍 두 번 없음, 자기 자신 없음"""
    ix = cg.index(_random_pool())
    nodes = cg.select_nodes(ix, 40)
    edges = cg.build_edges(ix, nodes)
    assert edges
    pairs = [(e["source"], e["target"]) for e in edges]
    assert len(pairs) == len(set(pairs)) and all(a < b for a, b in pairs)
    assert all(e["weight"] >= cg.MIN_SCORE for e in edges)
    assert all(e["source"] in nodes and e["target"] in nodes for e in edges)
    # 모든 후보 선을 다시 계산해 상위 6 규칙을 확인
    full = cg.build_edges(ix, nodes, max_per_node=0)
    kept = set(pairs)
    for node in nodes:
        mine = sorted((e for e in full if node in (e["source"], e["target"])),
                      key=lambda e: (-e["weight"], e["target"] if e["source"] == node else e["source"]))
        for e in mine[:cg.MAX_EDGES_PER_NODE]:
            assert (e["source"], e["target"]) in kept
    for e in edges:  # 남은 선은 양끝 중 한쪽의 상위 6 안
        a, b = e["source"], e["target"]
        ok = False
        for node in (a, b):
            mine = sorted((x for x in full if node in (x["source"], x["target"])),
                          key=lambda x: (-x["weight"], x["target"] if x["source"] == node else x["source"]))
            ok = ok or (a, b) in {(x["source"], x["target"]) for x in mine[:cg.MAX_EDGES_PER_NODE]}
        assert ok
    for e in edges:
        assert set(e) == {"source", "target", "weight", "kind", "shared", "coupling", "cocitation", "related"}


# ---------------------------------------------------------------- AC-G06
def test_prior_and_derivative():
    """AC-G06: count · 순서 · count ≥ 2 · 그래프 안 논문도 이전 연구가 될 수 있음"""
    seed = W(1, refs=[901, 902])
    a = W(2, refs=[901, 902, 903], cited=10)
    b = W(3, refs=[901, 903, 2], cited=1)
    c = W(4, refs=[902, 2, 3])
    d1 = W(11, refs=[2, 3, 4], year=2020)
    d2 = W(12, refs=[2, 3], year=2022)
    d3 = W(13, refs=[3, 4], year=2021)
    d4 = W(14, refs=[2], year=2024)
    d5 = W(15, refs=[1, 2], year=2025)  # 씨앗 + 노드 하나 = 2
    p = make_pool(seed, [a, b, c, d1, d2, d3, d4, d5])
    ix = cg.index(p)
    nodes = [1, 2, 3, 4]
    cands = cg.prior_candidates(ix, nodes)
    assert cands == [(901, 3), (902, 3), (2, 2), (903, 2)]
    meta = {901: {"cited_by_count": 50}, 902: {"cited_by_count": 70}, 903: {"cited_by_count": 5},
            2: {"cited_by_count": 10}}
    assert cg.finalize_prior(cands, meta) == [(902, 3), (901, 3), (2, 2), (903, 2)]
    assert cg.finalize_prior(cands, {k: v for k, v in meta.items() if k != 903}) == [(902, 3), (901, 3), (2, 2)]
    assert cg.derivative_works(ix, nodes) == [(11, 3), (15, 2), (12, 2), (13, 2), (4, 2)]  # 노드(4)도 이후 연구가 될 수 있음


def test_prior_cap_and_ties():
    refs = list(range(500, 530))
    nodes_w = [W(i, refs=refs) for i in range(2, 5)]
    p = make_pool(W(1, refs=refs), nodes_w)
    ix = cg.index(p)
    cands = cg.prior_candidates(ix, [1, 2, 3, 4])
    assert len(cands) == 30 and all(c == 4 for _, c in cands)  # 20번째와 같은 count는 모두(동률)
    meta = {x: {"cited_by_count": x} for x in refs}
    out = cg.finalize_prior(cands, meta)
    assert len(out) == 20 and [x for x, _ in out] == list(range(529, 509, -1))
    many = list(range(600, 700))
    p = make_pool(W(1, refs=many), [W(2, refs=many)])
    assert len(cg.prior_candidates(cg.index(p), [1, 2])) == cg.PRIOR_FETCH_CAP


# ---------------------------------------------------------------- AC-G07
def test_weak_citation_warning():
    rel = {"kind": "related"}
    cou = {"kind": "coupling"}
    assert cg.weak_citation([rel, rel, cou]) is True
    assert cg.weak_citation([rel, cou]) is False  # 절반은 넘지 않음
    assert cg.weak_citation([]) is False
    # 인용 정보가 없는 작은 세계 → 모든 선이 related
    p = make_pool(W(1, related=[2, 3]), [W(2, related=[1, 3]), W(3, related=[1, 2])])
    lay = cg.compute(cg.index(p), 20, {})
    assert lay.weak and lay.edges and all(e["kind"] == "related" for e in lay.edges)


def test_relations_and_compute():
    seed = W(1, refs=[2, 900, 901], related=[4])
    p = cg.Pool(1)
    p.add(seed, "seed")
    p.add(W(2, refs=[900, 901], cited=5), "reference")
    p.add(W(3, refs=[1, 900, 901], cited=9), "citing")
    p.add(W(4, refs=[], cited=1), "related")
    p.add(W(5, refs=[2, 3, 900, 901], cited=2), "cocited")
    ix = cg.index(p)
    assert cg.relations(ix, 2) == ["reference"] and cg.relations(ix, 3) == ["citing"]
    assert cg.relations(ix, 4) == ["related"] and cg.relations(ix, 5) == ["cocited"] and cg.relations(ix, 1) == []
    lay = cg.compute(ix, 20, {})
    assert lay.nodes[0] == 1 and set(lay.nodes) == {1, 2, 3, 4, 5}
    assert set(lay.scores) == {2, 3, 4, 5}


# ---------------------------------------------------------------- AC-G08
def test_performance_620_pool_size_80():
    """AC-G08: 풀 620편 · 크기 80 계산이 1초 안 (기준값을 출력 — 보고서에 기록)"""
    rnd = random.Random(42)
    universe = list(range(100_000, 104_000))
    n = 620
    seed = W(1, refs=rnd.sample(universe, 300), related=rnd.sample(range(2, n + 1), 20))
    works = []
    for i in range(2, n + 1):
        refs = rnd.sample(universe, rnd.randint(10, 80)) + rnd.sample(range(1, n + 1), rnd.randint(0, 6))
        works.append(W(i, refs=refs, related=rnd.sample(range(1, n + 1), 20), cited=rnd.randint(0, 100_000)))
    t = time.perf_counter()
    p = make_pool(seed, works)
    ix = cg.index(p)
    cg.prelim_targets(ix)
    lay = cg.compute(ix, 80, {x: {"cited_by_count": 1} for x in universe})
    took = time.perf_counter() - t
    print(f"AC-G08 pool={len(p.works)} size=80 nodes={len(lay.nodes)} edges={len(lay.edges)} took={took:.3f}s")
    assert len(lay.nodes) == 80 and took < 1.0
