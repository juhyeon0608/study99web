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


# ---------------------------------------------------------------- 웹 자료 (2026-10-31)
PAGE = ("<html><head><title>2023년 출생 통계</title><script>var s='합계출산율은 9.99명';</script></head><body>"
        "<h1>보도자료</h1><p>2023년 출생아 수는 23만 명으로 전년보다 7.7% 감소했습니다.</p>"
        "<p>합계출산율은 0.72명으로&nbsp;전년의 0.78명에 비해 0.06명 감소했습니다.</p></body></html>").encode()
WEB_JSON = {"queries": ["출생아 수 2023", "Korea births 2023"], "web": [
    {"url": "https://kostat.go.kr/a", "title": "", "publisher": "통계청", "date": "2024-02-28", "kind": "뉴스",
     "quote": "2023년 출생아 수는 23만 명으로 전년보다 7.7% 감소했습니다."},
    {"url": "https://news.example.com/b", "title": "기사", "publisher": "○○일보", "date": "", "kind": "뉴스",
     "quote": "합계출산율은 0.81명으로 전년의 0.78명에 비해 감소했습니다."},  # 수치가 페이지와 다름 → 버림
    {"url": "https://news.example.com/404", "title": "없는 기사", "publisher": "", "date": "", "kind": "뉴스",
     "quote": "출생아 수는 23만 명으로 역대 최저였다."},  # 페이지를 못 받음 → 버림
    {"url": "https://blog.naver.com/x/1", "title": "블로그", "publisher": "", "date": "", "kind": "웹",
     "quote": "출생아 수는 23만 명으로 역대 최저였다."},  # 블로그 → 받지 않음
    {"url": "file:///C:/Windows/win.ini", "title": "", "publisher": "", "date": "", "kind": "웹", "quote": "for 16-bit app"},
]}


class FakePages:
    def __init__(self):
        self.urls = []

    def fetch_page(self, url):
        self.urls.append(url)
        if url.endswith("/404"):
            raise find.SourceError("x")
        return PAGE, "text/html; charset=utf-8"


def test_web_candidates_parse_and_server_verification():
    raw = find.parse_web("", WEB_JSON)
    assert [w["url"] for w in raw] == ["https://kostat.go.kr/a", "https://news.example.com/b", "https://news.example.com/404"]
    pages = FakePages()
    web, unver = find.verify_web(pages, raw)
    assert [(u["url"], u["reason"]) for u in unver] == [("https://news.example.com/b", "quote"), ("https://news.example.com/404", "open")]
    assert "quote" not in unver[0] and len(web) == 1 and sorted(pages.urls) == sorted(w["url"] for w in raw)
    w = web[0]
    assert (w["n"], w["kind"], w["title"], w["site"]) == ("W1", "통계", "2023년 출생 통계", "kostat.go.kr")
    assert "23만 명" in w["excerpt"] and "9.99" not in w["excerpt"] and "<p>" not in w["excerpt"]
    # 조금 바꿔 옮긴 인용(수치는 모두 있음)은 받고, 수치가 하나라도 없으면 버림
    text, title = find.page_text(PAGE, "text/html")
    assert title == "2023년 출생 통계" and "var s" not in text
    assert find.quote_found("합계출산율은 0.72명으로 전년의 0.78명보다 0.06명 줄었습니다", text) >= 0
    assert find.quote_found("합계출산율은 0.70명으로 전년의 0.78명보다 0.06명 줄었습니다", text) == -1
    assert find.page_text(b"\x89PNG....", "image/png") == ("", "")


def test_web_stage_prompt_judgement_and_jobs():
    s, p = find.query_for({"question": CLAIM, "mode": "claim"}, web=True)
    assert s == find.WEB_SYSTEM and "<claim>" in p and "블로그" in p and "그대로 옮기세요" in p
    assert find.query_for({"question": "질문"}, web=True) == find.query_request("질문")  # 찾기에는 웹 없음
    q = {"kind": "find", "params": {"question": CLAIM, "mode": "claim"}}
    parsed = jobs.parse_result(q, "", WEB_JSON)
    assert parsed["queries"] == WEB_JSON["queries"] and len(parsed["web_raw"]) == 3
    web, _ = find.verify_web(FakePages(), parsed["web_raw"])
    params = dict(PARAMS, web=web)
    _, p = find.summary_for(params)
    assert '<web n="W1" kind="통계" publisher="통계청"' in p and "23만 명으로 전년보다" in p and "학술 근거가 아니라고" in p
    text = "판정: 근거 있음\n근거: 통계청 자료에 따르면 23만 명이다 [W1][W2][L1].\n고친 문장: 없음\n확인할 곳: 없음"
    assert "[W1][L1]" in find.check_for(params, text) and "[W2]" not in find.check_for(params, text)
    assert find.needs_summary(dict(PARAMS, candidates=[], library=[], web=web))
