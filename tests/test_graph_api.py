"""인용 그래프 API · 캐시 · 외부 호출 (명세 docs/specs/citation-graph.md 11장 B · C · D).

- 앞부분(표시 없음): DB 없이 메모리 저장소(MemStore) + 가짜 OpenAlex/S2(httpx.MockTransport)로 빌더 · 호출 모양 시험.
- `@pytest.mark.db`: 테스트용 Supabase 프로젝트 + 가짜 외부 서버로 POST /api/graph 전체(SSE · RLS · 서재 분리 · 로그).
- 실제 외부 API는 부르지 않는다: 이 모듈 동안 api.openalex.org · api.semanticscholar.org로 가는 실제 전송은 실패시킨다.
"""

from __future__ import annotations

import json
import logging
import random
import re
import threading
import time
from datetime import date, timedelta
from pathlib import Path

import httpx
import psycopg
import pytest

from paperlab import citecache, graph_build
from paperlab.graph_build import BadSeed, Flights, GraphBuilder, GraphError, GraphGate, Seed, parse_request
from paperlab.sources import (GRAPH_MAX_BYTES, GraphSources, RateLimiter, UpstreamError, graph_work, norm_openalex)

from .fixtures.citegraph import FakeClock, FakeUpstream, MemStore, World

ROOT = Path(__file__).resolve().parent.parent
DAY0 = date(2026, 10, 7)
NO_LIMIT = RateLimiter(0)
NORM_KEYS = set(norm_openalex({"id": "https://openalex.org/W1"}))


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """가짜 전송이 아닌 실제 요청이 외부 학술 API로 나가면 실패 (명세 12장)"""
    real = httpx.HTTPTransport.handle_request

    def guard(self, request):
        assert request.url.host not in ("api.openalex.org", "api.semanticscholar.org"), "실제 외부 API 호출"
        return real(self, request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", guard)


class Env:
    """메모리 저장소 + 가짜 외부 서버 + 가짜 시계"""

    def __init__(self, base: int = 9_000_000_000):
        self.world = World(base)
        self.clock = FakeClock()
        self.up = FakeUpstream(self.world, self.clock)
        self.store = MemStore()
        self.events: list[dict] = []

    def sources(self, oa_key="", s2_key="", max_list_calls=12, deadline=45.0, cancel=None):
        return GraphSources(oa_key, s2_key, transport=self.up.transport(), clock=self.clock, sleep=self.clock.sleep,
                            oa_limiter=NO_LIMIT, s2_limiter=NO_LIMIT, max_list_calls=max_list_calls,
                            deadline=self.clock() + deadline, cancel=cancel)

    def build(self, seed, size=40, today=DAY0, clear=True, **kw):
        if clear:
            self.up.clear()
        self.events = []
        src = self.sources(**kw)
        b = GraphBuilder(self.store, src, today, progress=self.events.append)
        no = b.resolve(seed if isinstance(seed, Seed) else Seed(no=seed))
        return b.build(no, size), src


@pytest.fixture
def env():
    return Env()


def ids(g):
    return [n["id"] for n in g["nodes"]]


def codes(g):
    return [w["code"] for w in g["warnings"]]


def sel(r):
    return set((r["params"].get("select") or "").split(","))


def oa_requests(up, kind=None):
    return [r for r in up.requests if r["host"] == "api.openalex.org" and (kind is None or r["kind"] == kind)]


# ====================================================================== 빌더 (DB 없음)
def test_graph_shape_and_progress(env):
    """AC-G10(모양): 씨앗 · 노드 ≤ 40 · 선 · 이전/이후 연구 · stats, paper 키 = norm_openalex 키 + α"""
    g, _ = env.build(env.world.S)
    assert g["seed"] == f"W{env.world.S}" and g["size"] == 40
    assert 3 <= len(g["nodes"]) <= 40 and g["nodes"][0]["is_seed"] and sum(n["is_seed"] for n in g["nodes"]) == 1
    assert g["edges"] and g["prior"] and g["derivative"]
    assert set(g["stats"]) == {"candidates", "list_calls", "cache_hits", "elapsed_ms", "built_on"}
    for n in g["nodes"] + g["prior"] + g["derivative"]:
        assert NORM_KEYS <= set(n["paper"]) and {"author_count", "reference_count"} <= set(n["paper"])
        assert len(n["paper"]["abstract"]) <= graph_build.ABSTRACT_OUT
    steps = [e["step"] for e in env.events]
    assert steps[:1] == ["seed"] and {"references", "citing", "cocitation", "finish", "compute"} <= set(steps)
    assert all(0 < e["progress"] < 1 for e in env.events)
    # 중복 제목은 하나, 제목 빈 작품 · 없는 작품은 노드에 없음
    all_ids = set(ids(g)) | {x["id"] for x in g["prior"] + g["derivative"]}
    assert f"W{env.world.EMPTY_TITLE}" not in all_ids and f"W{env.world.MISSING}" not in all_ids
    assert f"W{env.world.DUP_LOW}" not in all_ids
    seed_node = g["nodes"][0]
    assert seed_node["score"] is None and seed_node["relation"] == []
    others = g["nodes"][1:]
    assert all(set(n["relation"]) <= {"reference", "citing", "related", "cocited"} for n in others)
    assert {"reference", "citing"} <= {r for n in others for r in n["relation"]}
    in_graph = {x["id"]: x["in_graph"] for x in g["prior"]}
    assert all(v == (k in set(ids(g))) for k, v in in_graph.items())


def test_call_budget_and_shapes(env):
    """AC-G11: 목록 · 검색 ≤ 12, 단건 ≤ 2, 단계별 필터 · 정렬 · per_page=100 · 초록은 E에서만"""
    w = env.world
    g, src = env.build(w.S)
    up = env.up
    assert up.count("list") + up.count("search") <= 12 and up.count("single") <= 2
    assert g["stats"]["list_calls"] == up.count("list") + up.count("search")
    lists = oa_requests(up, "list")
    for r in lists:
        assert r["params"]["per_page"] == "100"
    single = oa_requests(up, "single")[0]
    assert single["path"] == f"/works/W{w.S}" and "referenced_works" in sel(single)
    flt = lambda r: r["params"]["filter"]  # noqa: E731
    a = [r for r in lists if flt(r).startswith("openalex:") and "abstract_inverted_index" not in r["params"]["select"]]
    assert a and all("referenced_works" in sel(r) for r in a)
    assert all(len(flt(r)[len("openalex:"):].split("|")) <= 100 for r in a)
    c = [r for r in lists if flt(r) == f"cites:W{w.S}"]
    assert len(c) == 1 and c[0]["params"]["sort"] == "cited_by_count:desc"
    d = [r for r in lists if flt(r).startswith("cites:") and "|" in flt(r)]
    assert len(d) == 2 and {r["params"]["sort"] for r in d} == {"cited_by_count:desc", "publication_date:desc"}
    assert all(len(flt(r)[len("cites:"):].split("|")) <= 50 and f"W{w.S}" in flt(r).split(":")[1].split("|") for r in d)
    e = [r for r in lists if "abstract_inverted_index" in r["params"]["select"]]
    assert e and all(flt(r).startswith("openalex:") and "referenced_works" not in sel(r) for r in e)
    assert len(e) <= 2
    for r in up.requests:  # 이메일 없음 · 고정 호스트 · 리디렉션 없음
        assert r["host"] in ("api.openalex.org", "api.semanticscholar.org")
        assert "mailto" not in r["params"] and "@" not in r["headers"].get("user-agent", "")
        assert r["headers"]["user-agent"].startswith("PaperLab/")


def test_cache_reuse_zero_calls_and_same_result(env):
    """AC-G12(빌더): 두 번째는 외부 호출 0, 노드 · 선이 같음 · AC-G13: 크기만 바꾸면 호출 0"""
    g1, _ = env.build(env.world.S, 40)
    g2, _ = env.build(env.world.S, 40)
    assert env.up.count() == 0
    assert ids(g1) == ids(g2) and g1["edges"] == g2["edges"] and g1["prior"] == g2["prior"]
    assert g1["derivative"] == g2["derivative"]
    assert g2["stats"]["cache_hits"] == g2["stats"]["candidates"]
    for size in (20, 80, 40):
        g, _ = env.build(env.world.S, size)
        assert env.up.count() == 0 and len(g["nodes"]) <= size
        assert all(n["paper"]["abstract"] for n in g["nodes"])  # 초록도 미리 받아 둠
    g80, _ = env.build(env.world.S, 80)
    assert ids(g80)[:40] == ids(g1)  # 크기만 다르고 순서는 같음


def test_ttl_refetches_meta_and_citers_not_references(env):
    """AC-G14: 31일 뒤 → 서지 · 피인용 목록만 다시 받고 참고문헌 목록(180일)은 다시 받지 않음"""
    w = env.world
    env.build(w.S)
    ref_rows = {k: dict(v) for k, v in env.store.e.items() if k[1] == "references"}
    later = DAY0 + timedelta(days=31)
    g, _ = env.build(w.S, today=later)
    up = env.up
    single = oa_requests(up, "single")
    assert len(single) == 1 and "referenced_works" not in sel(single[0])
    a = [r for r in oa_requests(up, "list") if r["params"]["filter"].startswith("openalex:")
         and "abstract_inverted_index" not in r["params"]["select"]]
    assert a and any(f"W{w.R[0]}" in r["params"]["filter"] for r in a)
    for r in a:  # 서지만 (참고문헌을 받는 것은 OpenAlex가 돌려주지 않던 번호의 빈 행뿐)
        assert "referenced_works" not in sel(r) or r["params"]["filter"] == f"openalex:W{w.MISSING}"
    assert any(r["params"]["filter"] == f"cites:W{w.S}" for r in oa_requests(up, "list"))  # 피인용 목록은 다시
    for k, old in ref_rows.items():
        assert env.store.e[k]["fetched_on"] == old["fetched_on"] == DAY0, k
    assert env.store.w[w.S]["meta_on"] == later and env.store.e[(w.S, "cited_by_top")]["fetched_on"] == later
    assert ids(g)
    # 181일 뒤에는 참고문헌도 다시
    env.build(w.S, today=DAY0 + timedelta(days=181))
    assert "referenced_works" in sel(oa_requests(env.up, "single")[0])


def test_partial_failures(env):
    """AC-G15"""
    w = env.world
    # D 단계 500 → cocite_failed, 노드는 있음
    env.up.fail = lambda r: httpx.Response(500) if r["kind"] == "list" and "|" in r["params"].get("filter", "") \
        and r["params"]["filter"].startswith("cites:") else None
    g, _ = env.build(w.S)
    assert "cocite_failed" in codes(g) and len(g["nodes"]) >= 3
    assert (w.S, "cited_by_top") not in env.store.e  # C · D 완료 표시를 남기지 않음 → 다음에 다시 받음
    assert w.C[0] in env.store.w  # 실패 전에 받은 작품은 캐시에 남음
    env.up.fail = None
    g, _ = env.build(w.S)
    assert "cocite_failed" not in codes(g) and env.up.count("list") >= 3  # C · D를 다시 부름

    # A 단계 4번 중 1번 실패 → refs_partial
    e2 = Env()
    marker = f"W{e2.world.BIGR[150]}|"

    def fail_second_batch(r):  # 두 번째 묶음(101~200번째)은 다시 해도 실패
        if r["kind"] == "list" and marker in r["params"].get("filter", ""):
            return httpx.Response(503)
        return None

    e2.up.fail = fail_second_batch
    g, _ = e2.build(e2.world.BIG)
    assert "refs_partial" in codes(g) and "truncated" in codes(g)

    # 씨앗 조회 실패
    e3 = Env()
    e3.up.fail = lambda r: httpx.Response(500) if r["kind"] == "single" else None
    with pytest.raises(GraphError) as ex:
        e3.build(e3.world.S)
    assert ex.value.code == "upstream_unavailable"
    e3.up.fail = None
    with pytest.raises(GraphError) as ex:
        e3.build(e3.world.base + 99_999)  # 없는 번호
    assert ex.value.code == "seed_not_found"


def test_deadline_and_call_timeout(env):
    """AC-G16: 응답이 20초 늦으면 호출 하나는 15초(읽기 제한)에 끊기고, 45초 기한에서 partial과 함께 끝남"""
    w = env.world
    env.build(w.S)  # 씨앗 · 참고문헌은 캐시에 둠
    env.up.delay = {"list": 20.0}
    env.store.e.pop((w.S, "cited_by_top"))  # C · D를 다시 부르게
    for row in env.store.w.values():  # E(초록)도 다시 부르게
        row["abstract"] = None
    start = env.clock()
    g, _ = env.build(w.S)
    lists = oa_requests(env.up, "list")
    assert lists and all(r["timeout"].get("read") == 15.0 and r["timeout"].get("connect") == 5.0 for r in lists)
    assert {"partial", "citing_failed", "cocite_failed"} <= set(codes(g))
    assert not [r for r in lists if "abstract_inverted_index" in sel(r)]  # 45초가 지나 E는 시작하지 않음
    assert env.clock() - start <= 45 + 15 * 2  # 기한을 넘긴 뒤에는 새 호출을 시작하지 않음(동시 2개까지 걸림)
    assert ids(g)  # 캐시로 그림


def test_rate_limit_429(env):
    """AC-G17"""
    w = env.world
    calls = {"n": 0}

    def once_429(r):
        if r["kind"] == "single" and calls["n"] == 0:
            calls["n"] += 1
            return httpx.Response(429, headers={"Retry-After": "2"})
        return None

    env.up.fail = once_429
    g, _ = env.build(w.S)
    assert env.up.count("single") == 2 and 2.0 in env.clock.sleeps and ids(g)
    # 하루 예산 소진(Remaining 0): 재시도 없음, 캐시로 못 그리면 upstream_limited
    e2 = Env()
    e2.up.fail = lambda r: httpx.Response(429, headers={"X-RateLimit-Remaining": "0"})
    with pytest.raises(GraphError) as ex:
        e2.build(e2.world.S)
    assert ex.value.code == "upstream_limited" and e2.up.count() == 1
    assert str(ex.value).startswith("OpenAlex 하루 사용량을 다 썼어요")
    # 캐시로 그릴 수 있으면 done + 경고
    env.up.fail = lambda r: httpx.Response(429, headers={"X-RateLimit-Remaining": "0"})
    g, src = env.build(w.S, today=DAY0 + timedelta(days=40))
    assert {"upstream_limited", "stale_cache"} <= set(codes(g)) and ids(g) and env.up.count() == 1
    assert src.limited and src.remaining == 0


def test_s2_augment(env):
    """AC-G18"""
    w = env.world
    g, _ = env.build(w.S2SEED, s2_key="s2-test-key")
    s2 = [r for r in env.up.requests if r["kind"] == "s2"]
    assert len(s2) == 1 and s2[0]["headers"].get("x-api-key") == "s2-test-key"
    assert s2[0]["raw_path"].startswith(f"/graph/v1/paper/DOI:10.5555/s2seed.{w.base}/references")
    doi_calls = [r for r in oa_requests(env.up, "list") if r["params"]["filter"].startswith("doi:")]
    assert 1 <= len(doi_calls) <= 2
    e = env.store.e[(w.S2SEED, "references")]
    assert e["source"] == "s2" and e["nos"] == w.R[:10] and e["total"] == 11
    assert {f"W{n}" for n in w.R[:10]} & set(ids(g))
    # 키 없음 → 헤더 없음 / S2 429 → 건너뛰고 경고
    e2 = Env()
    e2.up.fail = lambda r: httpx.Response(429) if r["kind"] == "s2" else None
    g, _ = e2.build(e2.world.S2SEED)
    s2 = [r for r in e2.up.requests if r["kind"] == "s2"]
    assert s2 and all("x-api-key" not in r["headers"] for r in s2)
    assert "s2_failed" in codes(g)
    assert not [r for r in oa_requests(e2.up, "list") if r["params"]["filter"].startswith("doi:")]
    # 참고문헌이 있는 씨앗은 S2를 부르지 않음
    e3 = Env()
    e3.build(e3.world.S)
    assert not [r for r in e3.up.requests if r["kind"] == "s2"]


def test_api_key_only_for_its_owner(env):
    """AC-G19(빌더): 키를 준 요청에만 api_key, 이메일은 어디에도 없음"""
    env.build(env.world.S, oa_key="oa-key-A")
    assert env.up.requests and all(r["params"].get("api_key") == "oa-key-A" for r in oa_requests(env.up))
    e2 = Env()
    e2.build(e2.world.K)
    assert all("api_key" not in r["params"] for r in e2.up.requests)
    for r in env.up.requests + e2.up.requests:
        assert "mailto" not in r["params"] and "@" not in r["headers"].get("user-agent", "")


def test_weak_citation_and_truncated(env):
    """AC-G07(전체 흐름) · 6.8절: 인용 정보가 적은 씨앗 → related 점선 + 경고, 참고문헌 350편 → truncated"""
    g, _ = env.build(env.world.K)
    assert "weak_citation_data" in codes(g) and all(e["kind"] == "related" for e in g["edges"])
    g, _ = env.build(env.world.BIG)
    assert "truncated" in codes(g)
    a = [r for r in oa_requests(env.up, "list") if r["params"]["filter"].startswith("openalex:")
         and "abstract_inverted_index" not in r["params"]["select"]]
    assert len(a) == 3  # 300편 = 묶음 3번


def test_missing_works_are_not_refetched(env):
    """OpenAlex가 돌려주지 않은 번호는 빈 행으로 남겨 두 번째 요청에서 다시 부르지 않음"""
    w = env.world
    env.build(w.S)
    assert env.store.w[w.MISSING]["title"] == ""
    env.build(w.S)
    assert env.up.count() == 0


def test_resolve_seed_by_identifiers(env):
    w = env.world
    no = GraphBuilder(env.store, env.sources(), DAY0).resolve(Seed(doi=f"10.5555/seed.{w.base}"))
    assert no == w.S and env.up.count("list") == 1
    assert env.up.requests[0]["params"]["filter"] == f"doi:https://doi.org/10.5555/seed.{w.base}"
    env.up.clear()
    assert GraphBuilder(env.store, env.sources(), DAY0).resolve(Seed(doi=f"10.5555/seed.{w.base}")) == w.S
    assert env.up.count() == 0  # 캐시에서
    no = GraphBuilder(env.store, env.sources(), DAY0).resolve(Seed(title="Seed Paper On Graph Representation Learning"))
    assert no == w.S and env.up.count("search") == 1
    with pytest.raises(GraphError) as ex:
        GraphBuilder(env.store, env.sources(), DAY0).resolve(Seed(doi="10.5555/nothing.here", title="No Such Paper Title"))
    assert ex.value.code == "seed_not_found"


def test_logs_have_no_identifiers_builder(env, caplog):
    caplog.set_level(logging.DEBUG)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    env.up.fail = lambda r: httpx.Response(500) if r["kind"] == "s2" else None
    env.build(env.world.S2SEED)
    text = caplog.text
    assert "upstream_error" in text
    for no in [env.world.S2SEED] + env.world.R[:10]:
        assert str(no) not in text
    assert "10.5555" not in text and "Seed Without" not in text


# ====================================================================== 입력 · 응답 검증 (DB 없음)
@pytest.mark.parametrize("seed", [
    {"openalex_id": "W0"}, {"openalex_id": "W12a"}, {"openalex_id": "https://evil.example/W1"},
    {"openalex_id": "W1234567890123"}, {"openalex_id": 123},
    {"doi": "10.1/a?b#c"}, {"doi": "10.1234/../../x"}, {"doi": "10.1234/a\x01b"}, {"doi": "10.1234/a|b"},
    {"title": "ab"}, {"title": "x" * 301}, {"paper_id": -1}, {"paper_id": "1"}, {"paper_id": 2 ** 63},
    {"paper_id": True}, {"paper_id": 1, "doi": "10.1234/x"}, {}, {"arxiv_id": "not an id"},
])
def test_parse_request_rejects(seed):
    """AC-G35"""
    with pytest.raises(BadSeed):
        parse_request({"seed": seed, "size": 40})


def test_parse_request_accepts():
    assert parse_request({"seed": {"paper_id": 12}}) == (12, None, 40)
    pid, s, size = parse_request({"seed": {"openalex_id": " https://openalex.org/W2963403868 ",
                                           "doi": "https://doi.org/10.48550/ARXIV.1706.03762",
                                           "arxiv_id": "arXiv:1706.03762v5", "title": "Attention\nIs All You Need",
                                           "extra": "무시"}, "size": 80})
    assert pid is None and size == 80
    assert s == Seed(2963403868, "10.48550/arxiv.1706.03762", "1706.03762", "Attention Is All You Need")
    # DOI의 | , 는 다음 식별자로
    _, s, _ = parse_request({"seed": {"doi": "10.1234/a,b", "title": "Some Real Title"}})
    assert s.doi == "" and s.title == "Some Real Title"
    for bad_size in (50, "40", True, None):
        with pytest.raises(BadSeed):
            parse_request({"seed": {"paper_id": 1}, "size": bad_size})
    with pytest.raises(BadSeed):
        parse_request(["x"])


def test_s2_path_is_encoded(env):
    """AC-G35: S2 경로의 DOI는 인코딩 — ? # 가 경로 · 쿼리를 바꾸지 못함"""
    src = env.sources()
    env.world.s2_refs["10.1234/a?b#c"] = []
    src.s2_reference_dois("10.1234/a?b#c")
    r = env.up.requests[-1]
    assert r["host"] == "api.semanticscholar.org" and "%3F" in r["raw_path"] and "%23" in r["raw_path"]
    assert set(r["params"]) == {"fields", "limit"} and ".." not in r["raw_path"]


def test_response_validation():
    """AC-G36: 이상한 id는 버림, javascript: 주소는 빈 값, 제목 1,000자, 음수 피인용 0"""
    evil = {"id": "https://evil.example/W1", "display_name": "x"}
    assert graph_work(evil, ("id",)) is None
    assert graph_work({"id": "https://openalex.org/W0"}, ()) is None
    row = graph_work({"id": "https://openalex.org/W42", "display_name": "T" * 5000, "cited_by_count": -5,
                      "primary_location": {"landing_page_url": "javascript:alert(1)"},
                      "best_oa_location": {"pdf_url": "data:text/html,x"}, "doi": "not-a-doi",
                      "referenced_works": ["https://openalex.org/W7", "https://evil.example/W8", 5, "https://openalex.org/W7"],
                      "related_works": "nope"}, ("referenced_works", "related_works"))
    assert row["no"] == 42 and len(row["title"]) == 1000 and row["cited_by_count"] == 0
    assert row["url"] == "" and row["pdf_url"] == "" and row["doi"] == ""
    assert row["refs"] == [7] and row["related"] == []
    row = graph_work({"id": "https://openalex.org/W43", "primary_location": {"landing_page_url": "javascript:x"}}, ())
    assert row["url"] == ""


def test_large_redirect_and_bad_json_fail():
    """AC-G36: 11MB 응답 · 302 · JSON 아님 → 그 호출 실패(리디렉션은 따라가지 않음)"""
    big = b'{"results": [' + b" " * (GRAPH_MAX_BYTES + 1024) + b"]}"
    seen = []

    def handler(request):
        seen.append(str(request.url))
        if "W1" in request.url.path:
            return httpx.Response(200, content=big)
        if "W2" in request.url.path:
            return httpx.Response(302, headers={"Location": "https://evil.example/x"})
        return httpx.Response(200, content=b"<html>")

    src = GraphSources(transport=httpx.MockTransport(handler), oa_limiter=NO_LIMIT, sleep=lambda s: None)
    for no in (1, 2, 3):
        with pytest.raises(UpstreamError):
            src.work(no, ("id",))
    assert not [u for u in seen if "evil.example" in u]


def test_gate_token_blocks_stale_stream():
    """품질팀 M-1 재현: 시작 못 한 옛 자리가 비워진 뒤 같은 사용자가 새로 들어오면, 늦게 시작된 옛 스트림은
    새 자리를 차지(claim)하거나 비우지(leave) 못함"""
    clock = FakeClock()
    gate = GraphGate(2, 4, clock=clock)
    s1, t1 = gate.enter("u")
    clock.advance(31)
    s2, t2 = gate.enter("u")  # 옛 자리는 비워지고 새 자리
    assert s1 == s2 == "ok" and t1 != t2
    assert gate.claim("u", t1) is False
    gate.leave("u", t1, False)
    assert gate.snapshot() == {"active": 0, "queued": 1, "users": 1}
    assert gate.claim("u", t2) is True and gate.claim("u", t2) is False
    assert gate.try_start()
    gate.leave("u", t1, True)  # 옛 표식으로는 진행 자리도 못 비움
    assert gate.snapshot() == {"active": 1, "queued": 0, "users": 1}
    gate.leave("u", t2, True)
    assert gate.snapshot() == {"active": 0, "queued": 0, "users": 0}


def test_merged_seed_redirect_followed_once(env):
    """품질팀 I-1 재현 ①: 합쳐진 씨앗 번호 → 단건 조회 3xx(같은 상수 호스트의 /works/W새번호) → 새 번호로 1회 다시 조회,
    그래프 씨앗은 새 번호. 다른 호스트 · 형식이 다른 Location · 두 번 연속 3xx는 seed_not_found"""
    w = env.world
    old = w.base + 55_555
    env.up.fail = lambda r: httpx.Response(301, headers={"Location": f"https://api.openalex.org/works/W{w.S}"}) \
        if r["kind"] == "single" and r["path"] == f"/works/W{old}" else None
    g, _ = env.build(old)
    assert g["seed"] == f"W{w.S}" and g["nodes"][0]["id"] == f"W{w.S}" and len(g["nodes"]) >= 3
    assert [r["path"] for r in oa_requests(env.up, "single")] == [f"/works/W{old}", f"/works/W{w.S}"]
    assert w.S in env.store.w and old not in env.store.w
    for loc in ("https://evil.example/works/W1", f"https://api.openalex.org/works/W{w.S}x", "/authors/A1",
                f"http://api.openalex.org/works/W{w.S}", ""):
        e2 = Env(w.base)
        e2.up.fail = lambda r, loc=loc: httpx.Response(302, headers={"Location": loc}) if r["kind"] == "single" else None
        with pytest.raises(GraphError) as ex:
            e2.build(old)
        assert ex.value.code == "seed_not_found", loc
        assert all(r["host"] == "api.openalex.org" for r in e2.up.requests)
        assert e2.up.count("single") == 1, loc  # 따라가지 않음
    e3 = Env(w.base)  # 새 번호도 다시 3xx → 더 따라가지 않음
    e3.up.fail = lambda r: httpx.Response(301, headers={"Location": f"/works/W{w.S + 1 if str(w.S) in r['path'] else w.S}"}) \
        if r["kind"] == "single" else None
    with pytest.raises(GraphError) as ex:
        e3.build(old)
    assert ex.value.code == "seed_not_found" and e3.up.count("single") == 2


def test_merged_seed_response_id_differs(env):
    """품질팀 I-1 재현 ②: 단건 조회가 다른 번호의 작품을 돌려주면(KeyError 대신) 그 번호를 씨앗으로"""
    w = env.world
    old = w.base + 55_556
    env.up.fail = lambda r: httpx.Response(200, json=env.up._select(w.S, r["params"])) \
        if r["kind"] == "single" and r["path"] == f"/works/W{old}" else None
    g, _ = env.build(old)
    assert g["seed"] == f"W{w.S}" and g["nodes"][0]["is_seed"] and g["nodes"][0]["id"] == f"W{w.S}"
    assert all(n["id"] != f"W{old}" for n in g["nodes"])
    g2, _ = env.build(w.S)  # 새 번호로는 캐시에서 같은 그래프
    assert env.up.count() == 0 and ids(g2) == ids(g)


def test_s2_path_rejects_dot_segments(env):
    """품질팀 M-6: '..' · '.' 세그먼트 DOI는 S2 경로에 넣지 않음(요청하지 않음)"""
    src = env.sources()
    for doi in ("10.1234/../x", "10.1234/./x", "10.1234/a/..", ""):
        with pytest.raises(UpstreamError):
            src.s2_reference_dois(doi)
    assert env.up.requests == [] and src.s2_calls == 0


def test_gate_and_flights():
    """AC-G33 · 34(단위): 사용자당 1 · 진행 2 · 대기 4 · 표는 끝나면 비어 있음"""
    gate = GraphGate(2, 4)
    entered = [gate.enter(f"u{i}") for i in range(6)]
    assert [s for s, _ in entered] == ["ok"] * 6 and len({t for _, t in entered}) == 6
    tok = {f"u{i}": t for i, (_, t) in enumerate(entered)}
    assert gate.enter("u0") == ("busy", "") and gate.enter("u6") == ("full", "")
    for i in range(6):
        assert gate.claim(f"u{i}", tok[f"u{i}"])
    assert gate.try_start() and gate.try_start() and not gate.try_start()
    gate.leave("u0", tok["u0"], True)
    assert gate.try_start()
    gate.leave("u1", tok["u1"], True)
    gate.leave("u2", tok["u2"], True)
    for i in range(3, 6):
        gate.leave(f"u{i}", tok[f"u{i}"], False)
    assert gate.snapshot() == {"active": 0, "queued": 0, "users": 0}
    clock = FakeClock()
    g2 = GraphGate(2, 4, clock=clock)
    assert g2.enter("x")[0] == "ok"
    clock.advance(31)
    assert g2.enter("y")[0] == "ok" and g2.snapshot() == {"active": 0, "queued": 1, "users": 1}  # 시작 못 한 자리는 비움

    flights = Flights()
    started = []
    gate_ev = threading.Event()

    def run(f):
        started.append(f)
        gate_ev.wait(5)
        f.emit({"type": "progress"})
        f.result = {"ok": True}
        flights.finish(f)

    a = flights.join(("W1", 40), run)
    b = flights.join(("W1", 40), run)
    assert a is b and len(started) <= 1 and len(flights) == 1
    gate_ev.set()
    a.done.wait(5)
    assert len(started) == 1 and len(flights) == 0 and a.result == {"ok": True}
    flights.leave(a)
    flights.leave(b)
    gate_ev.clear()
    c = flights.join(("W2", 40), run)
    flights.leave(c)  # 아무도 기다리지 않으면 취소
    assert c.cancel.is_set() and len(flights) == 0
    gate_ev.set()


def test_code_checks():
    """AC-G22 · AC-G51 일부: 공용 캐시 쓰기 SQL은 citecache(system_tx 고정 이유) · admin(관리 연결)에만,
    그래프 경로의 외부 호스트는 상수 두 곳뿐"""
    write_re = re.compile(r"(insert\s+into|update|delete\s+from)\s+paperlab\.(external_works|citation_edges)", re.I)
    found = {}
    for p in (ROOT / "paperlab").glob("*.py"):
        text = p.read_text(encoding="utf-8")
        if write_re.search(text):
            found[p.name] = text
    assert set(found) == {"citecache.py", "admin.py"}
    cc = found["citecache.py"]
    assert re.findall(r"\.system_tx\(([^)\n]*)\)", cc) == ['"citation cache write"']
    assert "def write_rows" in cc and cc.count("write_rows(") == 2  # 정의 + PgStore.write 안 한 곳
    for name in ("graph_build.py", "citegraph.py", "citecache.py"):
        text = (ROOT / "paperlab" / name).read_text(encoding="utf-8")
        assert not re.search(r"https?://(?!openalex\.org/|doi\.org/)", text.split('"""', 2)[-1]), name
    src = (ROOT / "paperlab" / "sources.py").read_text(encoding="utf-8")
    graph_part = src[src.index("# ====") :]
    hosts = set(re.findall(r"https?://([a-z0-9.\-]+)", graph_part))
    assert hosts <= {"api.openalex.org", "api.semanticscholar.org", "openalex.org", "openalex", "doi.org"}, hosts
    assert "follow_redirects=False" in graph_part and '"mailto"' not in graph_part and "contact_email" not in graph_part


# ====================================================================== API (테스트 프로젝트)
def _band() -> int:
    return 9_000_000_000 + random.randrange(1, 89_000) * 10_000


def _cleanup(project, base):
    with psycopg.connect(project.admin_db, autocommit=True, prepare_threshold=None) as conn:
        conn.execute("delete from paperlab.citation_edges where work_no between %s and %s", (base, base + 9_999))
        conn.execute("delete from paperlab.external_works where openalex_no between %s and %s", (base, base + 9_999))


class GraphCloud:
    """cloud + 가짜 외부 서버를 넣은 그래프 팩토리"""

    def __init__(self, cloud):
        self.cloud = cloud
        self.base = _band()
        self.world = World(self.base)
        self.up = FakeUpstream(self.world)
        self.keys_seen: list[str] = []
        st = cloud.app.state

        def factory(oa_key, s2_key, **kw):
            self.keys_seen.append(oa_key)
            kw.pop("sleep", None)
            return GraphSources(oa_key, s2_key, transport=self.up.transport(), oa_limiter=NO_LIMIT,
                                s2_limiter=NO_LIMIT, sleep=lambda s: None, **kw)

        st.graph_sources_factory = factory

    def stream(self, client, body):
        """SSE 이벤트 목록(주석 줄 제외)과 상태 코드"""
        events = []
        with client.stream("POST", "/api/graph", json=body) as r:
            if r.status_code != 200:
                r.read()
                return r.status_code, r.json()
            for line in r.iter_lines():
                if line.startswith("data: "):
                    events.append(json.loads(line[6:]))
        return 200, events


@pytest.fixture
def gc(cloud):
    g = GraphCloud(cloud)
    yield g
    _cleanup(cloud.project, g.base)
    st = cloud.app.state
    assert st.graph_gate.snapshot() == {"active": 0, "queued": 0, "users": 0}  # AC-G33
    assert len(st.graph_flights) == 0


def _seed_paper(client, w: World, with_oa=True):
    data = {"title": "Seed Paper On Graph Representation Learning", "doi": f"10.5555/seed.{w.base}",
            "openalex_id": f"W{w.S}" if with_oa else "", "year": 2017}
    return client.post("/api/papers", json=data).json()["paper"]["id"]


def _done(events):
    done = [e for e in events if e["type"] == "done"]
    assert done, events[-3:]
    return done[0]["graph"]


@pytest.mark.db
def test_api_graph_basic(gc, caplog):
    """AC-G10 · 31 · 32 · 33 · 19(이메일): 서재 논문 씨앗 → SSE progress … done, 로그에 식별자 없음"""
    caplog.set_level(logging.DEBUG)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    cloud, w = gc.cloud, gc.world
    a = cloud.user()
    ca = cloud.client(a)
    ca.put("/api/settings", json={"contact_email": "someone@example.com"})
    pid = _seed_paper(ca, w)
    p_title = w.works[w.R[3]]["title"]
    p_id = ca.post("/api/papers", json={"title": p_title, "doi": f"10.5555/r3.{w.base}"}).json()["paper"]["id"]
    status, events = gc.stream(ca, {"seed": {"paper_id": pid}})
    assert status == 200
    assert any(e["type"] == "progress" for e in events)
    g = _done(events)
    assert g["nodes"][0]["is_seed"] and g["nodes"][0]["id"] == f"W{w.S}" and len(g["nodes"]) <= 40
    assert g["nodes"][0]["in_library"] == pid
    assert g["edges"] and g["prior"] and g["derivative"] and g["stats"]["list_calls"] <= 12
    assert all(NORM_KEYS <= set(n["paper"]) for n in g["nodes"])
    node_p = [n for n in g["nodes"] if n["id"] == f"W{w.R[3]}"]
    assert node_p and node_p[0]["in_library"] == p_id
    others = [n for n in g["nodes"] if n["id"] not in (f"W{w.S}", f"W{w.R[3]}")]
    assert all(n["in_library"] is None for n in others)
    for r in gc.up.requests:  # AC-G19: 사용자 연락처 이메일이 있어도 그래프 호출엔 없음
        assert "mailto" not in r["params"] and "@" not in r["headers"].get("user-agent", "")
        assert r["host"] in ("api.openalex.org", "api.semanticscholar.org")
    # 접근 로그는 path만, 그래프 로그는 숫자 · code만, 어디에도 식별자 · 제목 없음 (AC-G31 · 32)
    access = [json.loads(r.getMessage()) for r in caplog.records if r.name == "paperlab.access"]
    assert any(x["path"] == "/api/graph" for x in access)
    assert all("?" not in x["path"] for x in access)
    glog = [json.loads(r.getMessage()) for r in caplog.records if r.name == "paperlab.server"
            and r.getMessage().startswith('{"event": "graph"')]
    assert glog and glog[-1]["result"] == "done"
    assert set(glog[-1]) == {"event", "result", "ms", "list_calls", "cache_hits", "nodes", "warnings", "openalex_remaining"}
    text = caplog.text
    secrets = {str(n) for n in w.works} | {w.works[n]["doi"] for n in w.works if w.works[n]["doi"]} | set(w.titles())
    leaked = [s for s in secrets if s and s in text]
    assert not leaked, leaked[:5]
    assert "system_tx reason=citation cache write" in text
    # 서재 논문에 openalex_id가 비어 있으면 채움
    pid2 = ca.post("/api/papers", json={"title": "Seed Without OpenAlex References Indexed",
                                        "doi": f"10.5555/s2seed.{w.base}"}).json()["paper"]["id"]
    status, events = gc.stream(ca, {"seed": {"paper_id": pid2}, "size": 20})
    assert status == 200 and _done(events)
    assert ca.get(f"/api/papers/{pid2}").json()["openalex_id"] == f"W{w.S2SEED}"


@pytest.mark.db
def test_api_merged_seed_updates_library_openalex_id(gc):
    """품질팀 N-1: 서재 논문의 openalex_id가 합쳐진 옛 번호(W…old)면, 그래프를 만든 뒤 OpenAlex가 돌려준 새 번호로 고침"""
    cloud, w = gc.cloud, gc.world
    c = cloud.client(cloud.user())
    old = w.base + 55_557
    gc.up.fail = lambda r: httpx.Response(301, headers={"Location": f"https://api.openalex.org/works/W{w.S}"}) \
        if r["kind"] == "single" and r["path"] == f"/works/W{old}" else None
    pid = c.post("/api/papers", json={"title": "Seed Paper On Graph Representation Learning",
                                      "openalex_id": f"W{old}"}).json()["paper"]["id"]
    status, events = gc.stream(c, {"seed": {"paper_id": pid}, "size": 20})
    g = _done(events)
    assert status == 200 and g["seed"] == f"W{w.S}" and g["nodes"][0]["in_library"] == pid
    assert c.get(f"/api/papers/{pid}").json()["openalex_id"] == f"W{w.S}"
    # 이미 맞는 번호인 다른 논문은 그대로(쓰지 않음)
    pid2 = c.post("/api/papers", json={"title": "Related Topic Paper 0 on Graph Learning",
                                       "openalex_id": f"W{w.L[0]}"}).json()["paper"]["id"]
    _done(gc.stream(c, {"seed": {"paper_id": pid2}, "size": 20})[1])
    assert c.get(f"/api/papers/{pid2}").json()["openalex_id"] == f"W{w.L[0]}"


@pytest.mark.db
def test_api_shared_cache_and_library_isolation(gc):
    """AC-G12(PLAN 1B 완료 기준) · 13 · 24(순차) · 25"""
    cloud, w = gc.cloud, gc.world
    a, b = cloud.user(), cloud.user()
    ca, cb = cloud.client(a), cloud.client(b)
    pid = _seed_paper(ca, w)
    g_a = _done(gc.stream(ca, {"seed": {"paper_id": pid}})[1])
    assert gc.up.count() > 0
    gc.up.clear()
    seed_ident = {"openalex_id": f"W{w.S}", "doi": f"10.5555/seed.{w.base}",
                  "title": "Seed Paper On Graph Representation Learning"}
    g_b = _done(gc.stream(cb, {"seed": seed_ident})[1])
    assert gc.up.count() == 0  # 다른 사용자도 외부 호출 0
    assert ids(g_a) == ids(g_b) and g_a["edges"] == g_b["edges"]
    assert g_a["nodes"][0]["in_library"] == pid and g_b["nodes"][0]["in_library"] is None
    # 크기만 바꿈 → 외부 호출 0
    for size in (20, 80):
        g = _done(gc.stream(cb, {"seed": seed_ident, "size": size})[1])
        assert gc.up.count() == 0 and len(g["nodes"]) <= size
    # B가 A의 서재 논문 번호로 → 404
    assert gc.stream(cb, {"seed": {"paper_id": pid}})[0] == 404
    # 서재 추가 → 다시 요청하면 in_library가 새 id
    node = g_b["nodes"][2]
    r = cb.post("/api/papers", json=node["paper"])
    assert r.status_code == 200, r.text
    new_id = r.json()["paper"]["id"]
    g = _done(gc.stream(cb, {"seed": seed_ident})[1])
    assert [n["in_library"] for n in g["nodes"] if n["id"] == node["id"]] == [new_id]
    # 다른 키 사용자: A가 키를 저장하면 A의 요청에만 (AC-G19)
    ca.put("/api/settings", json={"openalex_api_key": "oa-test-key-A"})
    gc.up.clear()
    _done(gc.stream(ca, {"seed": {"openalex_id": f"W{w.K}"}})[1])
    assert oa_requests(gc.up) and all(r["params"].get("api_key") == "oa-test-key-A" for r in oa_requests(gc.up))
    gc.up.clear()
    _done(gc.stream(cb, {"seed": {"openalex_id": f"W{w.BIG}"}, "size": 20})[1])
    assert gc.up.requests and all("api_key" not in r["params"] for r in gc.up.requests)


@pytest.mark.db
def test_api_concurrent_same_seed_and_limits(gc):
    """AC-G24(동시 · 합치기) · AC-G34: 같은 사용자 두 번째 → 429, 같은 씨앗 두 사용자 → 외부 호출 한 번분,
    7명 동시 → 2 진행 · 4 대기 · 1 503"""
    cloud, w = gc.cloud, gc.world
    st = cloud.app.state
    a, b = cloud.user(), cloud.user()
    ca, cb = cloud.client(a), cloud.client(b)
    p_title = w.works[w.R[3]]["title"]
    p_id = ca.post("/api/papers", json={"title": p_title, "doi": f"10.5555/r3.{w.base}"}).json()["paper"]["id"]
    block = threading.Event()
    gc.up.block = block
    results = {}

    def go(name, client, body):
        results[name] = gc.stream(client, body)

    body = {"seed": {"openalex_id": f"W{w.S}"}}
    ta = threading.Thread(target=go, args=("A", ca, body))
    ta.start()
    _wait(lambda: gc.up.count() >= 1)
    tb = threading.Thread(target=go, args=("B", cb, body))
    tb.start()
    _wait(lambda: st.graph_gate.snapshot()["users"] == 2)
    status, err = gc.stream(ca, body)  # 같은 사용자의 두 번째
    assert status == 429 and err["code"] == "graph_busy"
    block.set()
    ta.join(60)
    tb.join(60)
    ga, gb = _done(results["A"][1]), _done(results["B"][1])
    assert ids(ga) == ids(gb)
    keyed = [(r["path"], tuple(sorted(r["params"].items()))) for r in gc.up.requests]
    assert len(keyed) == len(set(keyed))  # 같은 호출이 두 번 나가지 않음(한 번분)
    pa = [n["in_library"] for n in ga["nodes"] if n["id"] == f"W{w.R[3]}"]
    pb = [n["in_library"] for n in gb["nodes"] if n["id"] == f"W{w.R[3]}"]
    assert pa == [p_id] and pb == [None]

    # 7명 동시: 2 진행 · 4 대기(wait 이벤트) · 1 503
    gc.up.block = threading.Event()
    seeds = [w.K, w.S2SEED, w.BIG, w.R[0], w.C[0], w.L[0]]
    users = [cloud.user() for _ in range(7)]
    clients = [cloud.client(u) for u in users]
    threads = []
    for i, (c, s) in enumerate(zip(clients[:6], seeds)):
        t = threading.Thread(target=go, args=(f"u{i}", c, {"seed": {"openalex_id": f"W{s}"}, "size": 20}))
        t.start()
        threads.append(t)
        _wait(lambda i=i: st.graph_gate.snapshot()["users"] == i + 1)
    _wait(lambda: st.graph_gate.snapshot()["active"] == 2 and st.graph_gate.snapshot()["queued"] == 4)
    status, err = gc.stream(clients[6], {"seed": {"openalex_id": f"W{w.D[0]}"}})
    assert status == 503 and err["code"] == "graph_queue_full"
    gc.up.block.set()
    for t in threads:
        t.join(90)
    waits = [name for name, (st_, evs) in results.items() if name.startswith("u")
             and any(e.get("step") == "wait" for e in evs)]
    assert len(waits) == 4
    assert all(any(e["type"] == "done" for e in evs) for name, (st_, evs) in results.items() if name.startswith("u"))


def _wait(cond, timeout=30.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return
        time.sleep(0.02)
    raise AssertionError("시간 초과")


@pytest.mark.db
def test_api_errors_via_sse(gc):
    """seed_not_found · upstream_limited 는 SSE error 이벤트로"""
    cloud, w = gc.cloud, gc.world
    c = cloud.client(cloud.user())
    status, events = gc.stream(c, {"seed": {"openalex_id": f"W{w.base + 9_876}"}})
    assert status == 200 and events[-1]["type"] == "error" and events[-1]["code"] == "seed_not_found"
    gc.up.fail = lambda r: httpx.Response(429, headers={"X-RateLimit-Remaining": "0"})
    status, events = gc.stream(c, {"seed": {"openalex_id": f"W{w.C[5]}"}})
    assert events[-1]["code"] == "upstream_limited" and "오전 9시" in events[-1]["error"]
    # 오래 걸리면 SSE 주석 줄(: ping)로 연결 유지 (9.2절 — 간격을 줄여 시험)
    gc.up.fail = None
    cloud.app.state.graph_ping_s = 0.05
    gc.up.delay = {}
    slow = threading.Event()
    gc.up.block = slow
    threading.Timer(0.6, slow.set).start()
    with c.stream("POST", "/api/graph", json={"seed": {"openalex_id": f"W{w.L[1]}"}, "size": 20}) as r:
        lines = list(r.iter_lines())
    assert any(line.startswith(": ping") for line in lines)
    assert any(line.startswith("data: ") and '"type": "done"' in line for line in lines)


def test_api_request_rules_without_db(local_client):
    """AC-G30 · AC-G35(API): 인증 · X-PaperLab · Origin 규칙, 형식 위반 400은 DB · 외부 호출 전에"""
    from fastapi.testclient import TestClient
    app = local_client.app
    seen = []
    app.state.graph_sources_factory = lambda *a, **kw: seen.append(1)
    bare = TestClient(app)
    assert bare.post("/api/graph", json={"seed": {"paper_id": 1}}, headers={"X-PaperLab": "1"}).status_code == 401
    assert local_client.post("/api/graph", json={"seed": {"paper_id": 1}}, headers={"X-PaperLab": ""}).status_code == 403
    r = local_client.post("/api/graph", json={"seed": {"paper_id": 1}}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    bad = [{"seed": {"openalex_id": "W0"}}, {"seed": {"doi": "10.1/a?b#c"}}, {"seed": {"title": "ab"}},
           {"seed": {"paper_id": "1"}}, {"seed": {"paper_id": 2 ** 63}}, {"seed": {"paper_id": 1}, "size": 50},
           {"seed": {"doi": "10.1234/../../x"}}, {"seed": {"openalex_id": "https://evil.example/W1"}}]
    for body in bad:
        r = local_client.post("/api/graph", json=body)
        assert r.status_code == 400 and r.json()["code"] == "bad_seed", body
        assert "evil" not in r.text and "10.1" not in r.text
    big = {"seed": {"title": "Some Title"}, "pad": "x" * 5000}
    assert local_client.post("/api/graph", json=big).status_code == 400
    # 품질팀 M-4: Content-Length가 크면 읽기 전에, 길이 없는 chunked 본문도 4KB 넘게는 읽지 않고 400
    r = local_client.post("/api/graph", content=b"{}", headers={"Content-Length": "999999", "Content-Type": "application/json"})
    assert r.status_code == 400
    chunks = (b'{"seed": {"title": "Some Title"}, "pad": "' + b"x" * 1000 for _ in range(10))
    r = local_client.post("/api/graph", content=chunks, headers={"Content-Type": "application/json"})
    assert r.status_code == 400 and r.json()["code"] == "bad_seed"
    assert local_client.post("/api/graph", content=b"{not json", headers={"Content-Type": "application/json"}).status_code == 400
    assert seen == []
