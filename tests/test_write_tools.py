"""논문 검토 · 정리 도구 (2026-10-27): 글쓰기 작업의 새 모드 — 선행연구 비교표 · 통계 결과 · 메모 정리 · 모의 심사 ·
심사 의견 대응표 · 투고 규정 뽑기 — 와 원고 설정(cover.journal) 검증"""
import pytest

from paperlab import ai
from paperlab import doc_formats as df


def test_tool_modes_and_prompts():
    for mode in ("matrix", "stats", "memo", "review", "response", "journal"):
        assert mode in ai.WRITE_MODES
    assert ai.WRITE_NO_TEXT_MODES == {"draft", "matrix"}
    system, prompt = ai.write_request("matrix", "", instruction="표의 열: 대상, 방법",
                                      sources=[{"key": "kim2024", "title": "제목", "authors": "김", "year": 2024, "abstract": "초록"}])
    assert "[확인 필요" in system and "선행연구 비교표" in prompt and 'key="kim2024"' in prompt and "표의 열: 대상, 방법" in prompt
    _, p = ai.write_request("stats", "t=2.21 df=48 p=.032")
    assert "APA" in p and "<text>\nt=2.21 df=48 p=.032\n</text>" in p
    _, p = ai.write_request("response", "1. 표본이 작음", context="## 제1장 서론")
    assert "대응표" in p and "<context>\n## 제1장 서론\n</context>" in p
    assert "JSON" in ai.WRITE_MODES["journal"] and "예상 질문" in ai.WRITE_MODES["review"]


def test_matrix_needs_papers_before_any_job(local_client):
    r = local_client.post("/api/ai/write", json={"mode": "matrix", "text": "", "keys": []})
    assert r.status_code == 400 and "논문" in r.json()["detail"]
    assert local_client.post("/api/ai/write", json={"mode": "stats", "text": ""}).status_code == 400


def test_validate_cover_journal():
    out = df.validate_cover({"journal": {"name": " 교육학연구 ", "max_pages": 25, "abstract_en_max": 250, "keywords_min": None,
                                         "style": "APA 7판", "notes": ["글꼴 10pt"], "zzz": 1}})
    assert out == {"journal": {"name": "교육학연구", "max_pages": 25, "abstract_en_max": 250, "style": "APA 7판", "notes": ["글꼴 10pt"]}}
    for bad in ({"journal": []}, {"journal": {"max_pages": 0}}, {"journal": {"refs_max": "10"}}, {"journal": {"name": "x" * 101}},
                {"journal": {"notes": ["x"] * 13}}):
        with pytest.raises(df.FormatError):
            df.validate_cover(bad)
