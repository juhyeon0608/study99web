"""수정 내용 표시 워드 (2026-10-27): 표시 문자(U+E000~E003) → w:ins · w:del, 다른 형식은 표시 문자 지움"""
import io
import zipfile

from paperlab import doc_formats as df
from paperlab import writer

I, i, D, d = "", "", "", ""
BLOCKS = [{"type": "title", "runs": [{"text": "제목"}]},
          {"type": "heading", "level": 2, "runs": [{"text": f"제1장 {D}서론{d}{I}들어가며{i}"}]},
          {"type": "paragraph", "runs": [{"text": f"연구의 목적은 {I}청소년 "}, {"text": "우울", "b": True}, {"text": f"{i}을 본다."}]},
          {"type": "paragraph", "runs": [{"text": f"{D}지운 문단.{d}"}]}]


def _xml(data: bytes) -> str:
    return zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode("utf-8")


def test_redline_docx_marks_insertions_and_deletions():
    xml = _xml(writer.redline_docx(writer.to_docx(BLOCKS, {"title": "t"}), when="2026-10-27T00:00:00Z"))
    assert not any(c in xml for c in (I, i, D, d))
    assert xml.count("<w:ins ") == 3 and xml.count("<w:del ") == 2
    assert "<w:delText xml:space=\"preserve\">서론</w:delText>" in xml and "<w:delText xml:space=\"preserve\">지운 문단.</w:delText>" in xml
    assert 'w:author="PaperLab"' in xml
    # 굵은 런도 넣은 글 안이면 w:ins로 (표시가 런을 넘어감)
    seg = xml[xml.index("청소년"):xml.index("을 본다")]
    assert seg.count("<w:ins ") == 1 and "<w:b/>" in seg


def test_redline_with_doc_format_and_strip():
    fmt = df.builtin_data("inha-mie-thesis")
    xml = _xml(writer.redline_docx(writer.to_docx(BLOCKS, {"title": "t"}, fmt)))
    assert "<w:del " in xml and "<w:ins " in xml and "" not in xml
    clean = writer.strip_redline(BLOCKS)
    assert clean[1]["runs"][0]["text"] == "제1장 서론들어가며"
    assert writer.to_hwpx(clean, {"title": "t"})


def test_export_api_redline_flag(local_client):
    r = local_client.post("/api/export-document", json={"format": "docx", "blocks": BLOCKS, "meta": {"title": "t"}, "redline": True})
    assert r.status_code == 200 and "<w:del " in _xml(r.content)
    r = local_client.post("/api/export-document", json={"format": "docx", "blocks": BLOCKS, "meta": {"title": "t"}})
    xml = _xml(r.content)
    assert "<w:del " not in xml and "" not in xml and "서론들어가며" in xml
