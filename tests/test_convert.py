"""서재에 문서 · 이미지 넣기 — 변환(paperlab/convert.py) 단위 테스트 (DB 없이).

워드 · 한글 · PPT 변환은 서버 PC처럼 LibreOffice(+ H2Orestart)가 있을 때만 돈다(없으면 skip).
이미지는 PyMuPDF만 쓰므로 늘 돈다. 서버 흐름(업로드 → 원본 보관 → [원본 받기])은 test_source_files.py(DB).
"""

from __future__ import annotations

import http.server
import io
import re
import struct
import subprocess
import tempfile
import threading
import zipfile
from pathlib import Path

import pymupdf
import pytest

from paperlab import convert, writer

ROOT = Path(__file__).resolve().parent.parent
needs_soffice = pytest.mark.skipif(not convert.available(), reason="LibreOffice(soffice)가 없어 문서 변환 테스트를 건너뜀")

BLOCKS = [{"type": "title", "runs": [{"text": "변환 시험 문서 Conversion Test"}]},
          {"type": "paragraph", "runs": [{"text": "본문 첫 문단입니다. Residual learning body text."}]}]
_FODP = """<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
 office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation">
 <office:body><office:presentation><draw:page draw:name="p1">
  <draw:frame svg:x="2cm" svg:y="2cm" svg:width="20cm" svg:height="3cm"><draw:text-box><text:p>발표 슬라이드 Slide Test</text:p></draw:text-box></draw:frame>
 </draw:page></office:presentation></office:body></office:document>"""


def make_docx() -> bytes:
    return writer.to_docx(BLOCKS)


def make_hwpx() -> bytes:
    return writer.to_hwpx(BLOCKS)


def make_pptx() -> bytes:
    """작은 .pptx — 만들 도구가 없어 LibreOffice로 평문 ODP(.fodp)를 바꿔 만든다(따로 임시 프로필)"""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
        src = Path(d) / "deck.fodp"
        src.write_text(_FODP, encoding="utf-8")
        profile = (Path(d) / "profile").as_uri()
        subprocess.run([convert.soffice_path(), "--headless", "--norestore", f"-env:UserInstallation={profile}",
                        "--convert-to", "pptx", "--outdir", d, str(src)], capture_output=True, timeout=180)
        return (Path(d) / "deck.pptx").read_bytes()


def make_png(w: int = 400, h: int = 200) -> bytes:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, w, h), False)
    pix.clear_with(200)
    return pix.tobytes("png")


def jpeg_with_orientation(orient: int) -> bytes:
    """400×200 JPEG(왼쪽 절반 빨강)에 EXIF 방향 태그를 붙인다 — 휴대폰 세로 사진 흉내"""
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 400, 200), False)
    for x in range(400):
        for y in range(200):
            pix.set_pixel(x, y, (255, 0, 0) if x < 200 else (0, 0, 255))
    jpg = pix.tobytes("jpg")
    tiff = (b"MM\x00*" + struct.pack(">IH", 8, 1) + struct.pack(">HHI", 0x0112, 3, 1)
            + struct.pack(">HH", orient, 0) + struct.pack(">I", 0))
    payload = b"Exif\x00\x00" + tiff
    return jpg[:2] + b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload + jpg[2:]


def pdf_text(data: bytes) -> str:
    with pymupdf.open("pdf", data) as doc:
        return "".join(p.get_text() for p in doc)


# ------------------------------------------------------------------ 형식 판정
def test_kind_checks_content_and_extension():
    assert convert.kind(b"%PDF-1.7 ...", "아무거나.docx") == "pdf"  # 내용이 PDF면 이름과 상관없이
    assert convert.kind(b"PK\x03\x04rest", "보고서.DOCX") == "doc"
    assert convert.kind(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1rest", "옛 문서.hwp") == "doc"
    assert convert.kind(b"{\\rtf1 hi}", "a.rtf") == "doc"
    assert convert.kind(make_png(), "사진.png") == "image"
    assert convert.kind(b"RIFF\x00\x00\x00\x00WEBPVP8 ", "a.webp") == "image"
    # 확장자는 맞는데 내용이 다르거나, 받지 않는 확장자
    assert convert.kind(b"hello", "a.docx") == ""
    assert convert.kind(b"PK\x03\x04", "압축.zip") == ""
    assert convert.kind(b"MZ\x90\x00", "setup.exe") == ""
    assert convert.kind(b"<html>", "a.png") == ""
    with pytest.raises(convert.ConvertError) as e:
        convert.to_pdf(b"hello", "a.docx")
    assert str(e.value) == convert.NOT_SUPPORTED


def test_web_accept_list_matches_server():
    """화면(filetypes.js)이 받는 확장자 = 서버(convert.ACCEPT_EXTS)"""
    js = (ROOT / "paperlab" / "static" / "js" / "filetypes.js").read_text(encoding="utf-8")

    def arr(name):
        m = re.search(rf"export const {name} = \[([^\]]*)\]", js)
        return tuple(re.findall(r'"(\.[a-z]+)"', m.group(1)))

    assert arr("DOC_EXTS") == convert.DOC_EXTS
    assert arr("IMAGE_EXTS") == convert.IMAGE_EXTS


# ------------------------------------------------------------------ 이미지 (LibreOffice 없이)
def test_image_to_pdf_fits_a4_and_keeps_orientation():
    big = convert.to_pdf(make_png(4000, 3000), "phone.png")
    with pymupdf.open("pdf", big) as doc:
        r = doc[0].rect
        assert doc.page_count == 1 and round(r.height) == 595 and r.width <= 842  # 가로 사진 → 가로 A4 안
    small = convert.to_pdf(make_png(100, 50), "icon.png")
    with pymupdf.open("pdf", small) as doc:
        assert round(doc[0].rect.width) <= 100  # 작은 그림은 키우지 않음
    # EXIF 6(시계 방향 90도): 세로 쪽이 되고 빨강(왼쪽 절반)이 위로
    with pymupdf.open("pdf", convert.to_pdf(jpeg_with_orientation(6), "세로.jpg")) as doc:
        page = doc[0]
        assert page.rect.height > page.rect.width
        pix = page.get_pixmap()
        red, _, blue = pix.pixel(pix.width // 2, 3)
        assert red > 200 and blue < 60


def test_bad_image_is_convert_error():
    with pytest.raises(convert.ConvertError) as e:
        convert.to_pdf(b"\x89PNG\r\n\x1a\n" + b"\x00" * 40, "깨짐.png")
    assert str(e.value) == convert.CONVERT_FAILED


def test_soffice_path_from_cloud_env(monkeypatch, tmp_path):
    """cloud.env의 PAPERLAB_SOFFICE(serve.py → configure)가 먼저, 없는 파일이면 무시"""
    fake = tmp_path / "soffice.exe"
    fake.write_bytes(b"")
    monkeypatch.setattr(convert, "_configured", "")
    convert.configure(f'"{fake}"')
    assert convert.soffice_path() == str(fake)
    convert.configure(str(tmp_path / "없음.exe"))
    assert convert.soffice_path() != str(tmp_path / "없음.exe")
    convert.configure(None)


def test_no_soffice_message(monkeypatch):
    monkeypatch.setattr(convert, "soffice_path", lambda: "")
    with pytest.raises(convert.ConvertError) as e:
        convert.to_pdf(b"PK\x03\x04" + b"\x00" * 20, "a.docx")
    assert str(e.value) == convert.NO_CONVERTER


# ------------------------------------------------------------------ 문서 (LibreOffice)
@needs_soffice
@pytest.mark.parametrize("name,make", [("보고서.docx", make_docx), ("한글 문서.hwpx", make_hwpx)])
def test_doc_to_pdf(name, make):
    out = convert.to_pdf(make(), name)
    assert out.startswith(b"%PDF") and "Conversion Test" in pdf_text(out)


@needs_soffice
def test_pptx_to_pdf():
    out = convert.to_pdf(make_pptx(), "발표.pptx")
    assert "Slide Test" in pdf_text(out)


@needs_soffice
def test_broken_doc_is_convert_error():
    with pytest.raises(convert.ConvertError) as e:
        convert.to_pdf(b"PK\x03\x04" + b"\x00" * 200, "깨진.docx")
    assert str(e.value) == convert.CONVERT_FAILED


@needs_soffice
def test_soffice_does_not_fetch_linked_images():
    """문서 속 외부 링크 그림(http://내부망…)을 서버가 받으러 가지 않는다(BlockUntrustedRefererLinks)"""
    hits = []

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            hits.append(self.path)
            self.send_response(404)
            self.end_headers()

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        port = srv.server_address[1]
        src = zipfile.ZipFile(io.BytesIO(make_docx()))
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w") as z:
            for item in src.infolist():
                data = src.read(item.filename)
                if item.filename == "word/_rels/document.xml.rels":
                    data = data.replace(b"</Relationships>", (
                        '<Relationship Id="rIdX" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
                        f'relationships/image" Target="http://127.0.0.1:{port}/leak.png" TargetMode="External"/>'
                        "</Relationships>").encode())
                if item.filename == "word/document.xml":
                    pic = ('<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/'
                           'wordprocessingDrawing"><wp:extent cx="914400" cy="914400"/><wp:docPr id="99" name="p"/>'
                           '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData '
                           'uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://'
                           'schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="99" name="p"/>'
                           '<pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/'
                           'officeDocument/2006/relationships" r:link="rIdX"/><a:stretch><a:fillRect/></a:stretch>'
                           '</pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/>'
                           '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
                           "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>")
                    data = data.replace(b"<w:sectPr", pic.encode() + b"<w:sectPr", 1)
                z.writestr(item, data)
        convert.to_pdf(out.getvalue(), "링크.docx")
        assert hits == []
    finally:
        srv.shutdown()


def test_harden_profile_adds_settings_once(tmp_path):
    convert._harden_profile(tmp_path)
    xcu = tmp_path / "user" / "registrymodifications.xcu"
    text = xcu.read_text(encoding="utf-8")
    assert text.count("BlockUntrustedRefererLinks") == 1 and "DisableMacrosExecution" in text
    convert._harden_profile(tmp_path)  # 두 번째는 그대로
    assert xcu.read_text(encoding="utf-8") == text
    # LibreOffice가 만든 파일(설정 없음)에는 끝에 덧붙인다
    xcu.write_text(convert._XCU_HEAD + '<item oor:path="/x"><prop oor:name="y"><value>1</value></prop></item>\n'
                   "</oor:items>\n", encoding="utf-8")
    convert._harden_profile(tmp_path)
    text = xcu.read_text(encoding="utf-8")
    assert 'oor:path="/x"' in text and text.count("BlockUntrustedRefererLinks") == 1
