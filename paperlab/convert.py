"""문서 · 이미지 → PDF 변환 (서재에 워드 · 한글 · PPT · 엑셀 · 이미지 넣기 — 2026-10-16 사용자 요청).

서재의 읽기 · 형광펜 · AI · 색인은 모두 PDF 쪽 단위로 돌므로, PDF가 아닌 파일은 올릴 때 PDF 변환본을 만들고
원본은 따로 보관한다(server.py — papers.source_key). 변환:
- 문서: LibreOffice `soffice --headless --convert-to pdf` (한글 .hwp · .hwpx는 H2Orestart 확장이 읽음)
- 이미지: PyMuPDF로 한 쪽짜리 PDF (글자 인식은 하지 않음 — 본문 검색 · AI에는 글자가 없음). WebP만 LibreOffice
변환기 프로필은 외부 링크 · 매크로를 막는다(_harden_profile)
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

import pymupdf

log = logging.getLogger("paperlab.convert")

DOC_EXTS = (".doc", ".docx", ".hwp", ".hwpx", ".ppt", ".pptx", ".xls", ".xlsx", ".odt", ".odp", ".ods", ".rtf")
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tif", ".tiff", ".webp")
ACCEPT_EXTS = (".pdf",) + DOC_EXTS + IMAGE_EXTS
TIMEOUT = 180  # 한 파일 변환 제한(초)
A4 = (595.0, 842.0)  # 이미지 쪽 크기 상한(pt, 세로) — 가로 그림은 돌려서
NOT_SUPPORTED = "올릴 수 없는 파일 형식이에요 (PDF · 워드 · 한글 · PPT · 엑셀 · 이미지)"
CONVERT_FAILED = "문서를 PDF로 바꾸지 못했어요. 파일이 손상됐거나 암호가 걸려 있을 수 있어요"
NO_CONVERTER = "서버에 문서 변환기(LibreOffice)가 없어 이 파일은 올릴 수 없어요. PDF나 사진(JPG · PNG)으로 올려 주세요"

_ZIP = b"PK\x03\x04"
_OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_IMAGE_MAGIC = (b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF87a", b"GIF89a", b"BM", b"II*\x00", b"MM\x00*")
_lock = threading.Lock()  # soffice는 프로필 하나에 한 번에 하나만


class ConvertError(Exception):
    """사용자에게 그대로 보여 줄 문구(예외 내용은 넣지 않음)"""


def ext_of(name: str) -> str:
    return os.path.splitext(str(name or ""))[1].lower()


def kind(data: bytes, name: str) -> str:
    """'pdf' | 'doc' | 'image' | '' (못 받음). 내용 첫 바이트로 확인하고, 이름의 확장자와 맞아야 받는다"""
    if data.startswith(b"%PDF"):
        return "pdf"
    ext = ext_of(name)
    if ext in DOC_EXTS:
        if data.startswith((_ZIP, _OLE)) or (ext == ".rtf" and data.startswith(b"{\\rtf")):
            return "doc"
        return ""
    if ext in IMAGE_EXTS:
        if data.startswith(_IMAGE_MAGIC) or (data[:4] == b"RIFF" and data[8:12] == b"WEBP"):
            return "image"
    return ""


_configured = ""  # cloud.env의 PAPERLAB_SOFFICE (serve.py가 configure로 넣음 — cloud.env는 os.environ에 들어가지 않음)


def configure(path: str | None) -> None:
    global _configured
    _configured = (path or "").strip().strip('"')


def soffice_path() -> str:
    """PAPERLAB_SOFFICE(cloud.env → 환경 변수) → PATH → 기본 설치 위치. 없으면 ''"""
    for env in (_configured, os.environ.get("PAPERLAB_SOFFICE", "").strip().strip('"')):
        if env and Path(env).is_file():
            return env
    found = shutil.which("soffice")
    if found:
        return found
    for base in (os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", "")):
        p = Path(base or "") / "LibreOffice" / "program" / "soffice.exe"
        if base and p.is_file():
            return str(p)
    return ""


def available() -> bool:
    return bool(soffice_path())


def to_pdf(data: bytes, name: str) -> bytes:
    """PDF가 아닌 파일 → PDF 바이트. 실패하면 ConvertError(사용자 문구)"""
    k = kind(data, name)
    if k == "pdf":
        return data
    if k == "image" and ext_of(name) != ".webp":  # MuPDF는 WebP를 못 읽음 → LibreOffice(Draw)가 바꿈
        return _image_to_pdf(data, ext_of(name))
    if k == "image":
        return _doc_to_pdf(data, ".webp")
    if k == "doc":
        return _doc_to_pdf(data, ext_of(name))
    raise ConvertError(NOT_SUPPORTED)


def _image_to_pdf(data: bytes, ext: str) -> bytes:
    """이미지 → 쪽마다 그림 하나인 PDF. 휴대폰 사진(4000px 등)은 쪽이 1m 넘게 커지므로 A4 안으로 줄인다(그림 화질은
    그대로 — 쪽 크기만). 사진 방향(EXIF)은 MuPDF가 반영하고, 여러 쪽 TIFF는 쪽마다"""
    try:
        with pymupdf.open(stream=data, filetype=ext.lstrip(".")) as img, \
                pymupdf.open("pdf", img.convert_to_pdf()) as src, pymupdf.open() as doc:
            for i, page in enumerate(src):
                w, h = page.rect.width, page.rect.height
                bw, bh = (A4[1], A4[0]) if w > h else A4
                s = min(bw / w, bh / h, 1.0)
                new = doc.new_page(width=w * s, height=h * s)
                new.show_pdf_page(new.rect, src, i)
            out = doc.tobytes(garbage=3, deflate=True)
    except Exception as e:  # noqa: BLE001 - MuPDF가 내는 여러 예외
        log.warning(f"image convert failed ext={ext} error={type(e).__name__}")
        raise ConvertError(CONVERT_FAILED) from e
    if not out.startswith(b"%PDF"):
        raise ConvertError(CONVERT_FAILED)
    return out


def _kill_tree(proc: subprocess.Popen) -> None:
    """soffice.exe는 soffice.bin을 따로 띄우므로 프로세스 트리째 끝낸다"""
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.kill()


def _harden_profile(profile: Path) -> None:
    """변환 전용 프로필에 보안 설정을 넣는다(이미 있으면 그대로). 올린 문서 속 외부 링크 그림(http://…)을 서버가
    받으러 가지 않게(BlockUntrustedRefererLinks — 내부망 요청 차단, 2026-10-16 시험에서 docx 링크 그림 요청 확인) ·
    매크로는 실행하지 않게. LibreOffice가 끝날 때 이 파일을 다시 쓰지만 사용자 값은 남긴다"""
    xcu = profile / "user" / "registrymodifications.xcu"
    try:
        text = xcu.read_text(encoding="utf-8") if xcu.is_file() else ""
        if "BlockUntrustedRefererLinks" in text and "DisableMacrosExecution" in text:
            return
        if "</oor:items>" not in text:
            text = _XCU_HEAD + "</oor:items>\n"
        text = text.replace("</oor:items>", _XCU_ITEMS + "</oor:items>", 1)
        xcu.parent.mkdir(parents=True, exist_ok=True)
        xcu.write_text(text, encoding="utf-8")
    except OSError as e:
        log.warning(f"soffice profile hardening failed error={type(e).__name__}")


_XCU_HEAD = ('<?xml version="1.0" encoding="UTF-8"?>\n<oor:items xmlns:oor="http://openoffice.org/2001/registry" '
             'xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n')
_XCU_ITEMS = "".join(
    f'<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="{k}" oor:op="fuse">'
    f"<value>{v}</value></prop></item>\n"
    for k, v in (("BlockUntrustedRefererLinks", "true"), ("DisableMacrosExecution", "true"), ("MacroSecurityLevel", "3")))


def _doc_to_pdf(data: bytes, ext: str) -> bytes:
    exe = soffice_path()
    if not exe:
        raise ConvertError(NO_CONVERTER)
    profile = Path(tempfile.gettempdir()) / "paperlab-soffice-profile"  # 첫 변환 때 만들고 다음부터 다시 씀
    with _lock, tempfile.TemporaryDirectory(prefix="paperlab-convert-", ignore_cleanup_errors=True) as work:
        _harden_profile(profile)
        src = Path(work) / f"document{ext}"
        src.write_bytes(data)
        cmd = [exe, "--headless", "--norestore", "--nologo", "--nodefault", "--nolockcheck",
               f"-env:UserInstallation={profile.as_uri()}", "--convert-to", "pdf", "--outdir", work, str(src)]
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=work)
        try:
            proc.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            _kill_tree(proc)
            log.warning(f"soffice timeout ext={ext}")
            raise ConvertError(CONVERT_FAILED) from None
        out = Path(work) / "document.pdf"
        if not out.is_file():
            log.warning(f"soffice produced no pdf ext={ext} code={proc.returncode}")
            raise ConvertError(CONVERT_FAILED)
        pdf = out.read_bytes()
    if not pdf.startswith(b"%PDF"):
        raise ConvertError(CONVERT_FAILED)
    return pdf
