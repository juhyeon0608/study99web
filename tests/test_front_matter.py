"""앞부분 제목(국문 초록 · ABSTRACT · 감사의 글 …)은 쪽 번호의 '첫 장'으로 세지 않는다 · 학위논문 틀 (2026-10-17)"""

from paperlab.manuscripts import TEMPLATES
from paperlab.writer import is_front_matter


def heading(text):
    return {"type": "heading", "level": 1, "runs": [{"text": text}]}


def test_front_matter_titles():
    for t in ("국문 초록", "국문초록", "요 약", "ABSTRACT", "Abstract", "감사의 글", "Acknowledgements", "목 차", "<국문 초록>"):
        assert is_front_matter(heading(t)), t
    for t in ("제1장 서론", "1. 서론", "Introduction", "부록", "참고문헌"):
        assert not is_front_matter(heading(t)), t


def test_thesis_template_has_front_and_back_matter():
    c = TEMPLATES["thesis"]["content"] if "thesis" in TEMPLATES else next(
        t["content"] for t in TEMPLATES.values() if t["name"] == "학위논문")
    order = [c.index(s) for s in ("## 국문 초록", "주제어:", "## 제1장 서론", "[참고문헌]", "## ABSTRACT", "Keywords:", "## 부록")]
    assert order == sorted(order)
