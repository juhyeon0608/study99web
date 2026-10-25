"""출처 확인 (2026-10-26): find 작업의 claim 모드 — 검색어 · 판정 프롬프트 · 판정 글 검사 · 작업 경로(CLI · API)."""

import pytest

from paperlab import ai, find, jobs

CLAIM = "우리나라 출생아 수는 2023년 23만 명으로 역대 최저였다 [확인 필요: 2023년 출생아 수 — 통계청 KOSIS]."
LIB = [{"n": 1, "paper_id": 7, "citekey": "kim2024", "title": "저출산 연구", "year": 2024, "page": 3,
        "text": "2023년 출생아 수는 23만 명으로 집계되었다."}]
CANDS = [{"n": 1, "title": "Fertility decline in Korea", "authors": [{"family": "Lee"}], "year": 2024,
          "venue": "Demography", "abstract": "Births fell to 230,000 in 2023."}]
PARAMS = {"question": CLAIM, "mode": "claim", "library": LIB, "queries": ["출생아 수 2023", "Korea births 2023"],
          "candidates": CANDS}


def test_query_and_summary_dispatch():
    s, p = find.query_for({"question": CLAIM, "mode": "claim"})
    assert s == find.QUERY_SYSTEM and "<claim>" in p and "[확인 필요" in p and '"queries"' in p
    assert find.query_for({"question": "질문"}) == find.query_request("질문")  # 찾기는 그대로
    s, p = find.summary_for(PARAMS)
    assert s == find.CLAIM_SYSTEM
    assert '<source n="L1" key="kim2024"' in p and "23만 명으로 집계" in p  # 서재 조각 + 인용키
    assert '<source n="1">' in p and "Fertility decline" in p  # 외부 후보
    for rule in ("판정:", "근거:", "고친 문장:", "확인할 곳:", "[@인용키]", "지어내지"):
        assert rule in p, rule
    assert find.summary_for({"question": "q", "candidates": CANDS}) == find.summary_request("q", CANDS)


def test_summary_without_external_candidates():
    s, p = find.summary_for(dict(PARAMS, candidates=[]))
    assert "(외부 검색 결과 없음)" in p and 'n="L1"' in p
    assert find.needs_summary(dict(PARAMS, candidates=[]))  # 서재 조각만 있어도 판정
    assert not find.needs_summary(dict(PARAMS, candidates=[], library=[]))
    assert not find.needs_summary({"question": "q", "candidates": []})  # 찾기: 0편이면 요약 없음


def test_check_claim_keeps_valid_numbers_and_needs_verdict():
    text = ("판정: 근거 있음\n근거: 2023년 출생아 수는 23만 명이다 [L1][1]. 없는 번호 [9][L4]는 지운다.\n"
            "고친 문장: 우리나라 출생아 수는 2023년 23만 명으로 역대 최저였다 [@kim2024].\n확인할 곳: 통계청 KOSIS 인구동향조사")
    out = find.check_claim(text, 1, 1)
    assert out.startswith("판정: 근거 있음") and "[L1][1]" in out and "[9]" not in out and "[L4]" not in out
    assert find.check_for(PARAMS, text) == out
    assert find.check_claim("머리말\n**판정:** 일부 있음\n근거: 일부만 맞다 [L1].", 0, 1).startswith("**판정:** 일부 있음")
    with pytest.raises(ai.AIError):
        find.check_claim("근거: 판정 줄이 없다 [L1].", 1, 1)
    with pytest.raises(ai.AIError):
        find.check_claim("판정: 아마도\n근거: 모르겠다.", 1, 1)
    with pytest.raises(ai.AIError):
        find.check_claim("판정: 근거 있음\nEvidence: the number is 230k [1] according to the source data.", 1, 0)


def test_jobs_paths_use_claim_mode():
    job = {"kind": "find", "params": dict(PARAMS)}
    assert jobs.parse_result(job, "판정: 찾지 못함\n근거: 자료에 해당 수치가 없다 [L1].")["answer"].startswith("판정: 찾지 못함")
    q = {"kind": "find", "params": {"question": CLAIM, "mode": "claim"}}
    assert jobs.parse_result(q, '{"queries": ["출생아 수", "Korea births"]}')["queries"] == ["출생아 수", "Korea births"]
