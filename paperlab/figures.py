"""원고 그림 (논문 쓰기의 그림 넣기 — docs/specs/writing-figures-tables.md).

저장: R2 users/{uid}/figures/{manuscript_id}/{16진수 16자리}.{png|jpg|gif} (storage.figure_key).
원고 본문에는 `![캡션](fig:{이름})` 으로만 적고, 그림 바이트는 원고 행에 넣지 않는다(원고 저장 · 자동 저장이
가벼워야 하고, PDF · 원본 파일처럼 큰 바이너리는 R2에 두는 지금 설계와 같게).
서명 주소를 만들지 않고 서버가 직접 내려준다(같은 출처 · CSP img-src 'self' blob: 안에서 화면이 blob으로 보여 줌).

- 형식은 파일 앞 바이트(매직 바이트)로만 판정한다 — 이름 · Content-Type은 믿지 않는다.
- 워드(python-docx) · 한글 모두 읽는 PNG · JPEG · GIF만 받는다. WebP 등은 화면이 PNG로 바꿔 올린다.
"""

from __future__ import annotations

import re
import struct
from typing import Any, Callable

MAX_FIGURE_BYTES = 10 * 1024 * 1024       # 그림 한 장
MAX_FIGURES_PER_MANUSCRIPT = 200          # 원고 하나에 올린 그림 수
MAX_FIGURE_BYTES_PER_MANUSCRIPT = 300 * 1024 * 1024  # 원고 하나의 그림 합계
MAX_EXPORT_FIGURES = 200                  # 내보내기 한 번에 넣는 그림 수
MAX_SIDE_PX = 20000                       # 이보다 큰 가로 · 세로는 깨진 머리글로 본다

CONTENT_TYPES = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif"}
NAME_RE = re.compile(r"^[0-9a-f]{16}\.(png|jpg|gif)$")
# 그림 만들기(figgen.py)가 PNG 옆에 두는 SVG 원본 — 같은 16진수 이름 + .svg (원고 · 내보내기는 PNG만 쓴다)
SVG_NAME_RE = re.compile(r"^[0-9a-f]{16}\.svg$")
DPI = 96  # 픽셀 → mm (화면 그림의 기본 해상도로 본다)


class FigureError(ValueError):
    """올린 그림이 규칙에 맞지 않음 (서버는 400)"""


def svg_name(name: str) -> str:
    """그림 이름(…png) → 그 옆 SVG 원본 이름(….svg)"""
    return name.rsplit(".", 1)[0] + ".svg"


def sniff(data: bytes) -> str | None:
    """매직 바이트 → 'png' | 'jpg' | 'gif' (모르면 None)"""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    return None


def image_size(data: bytes, kind: str) -> tuple[int, int] | None:
    """머리글에서 (가로, 세로) 픽셀. 못 읽으면 None"""
    try:
        if kind == "png":
            if data[12:16] != b"IHDR":
                return None
            w, h = struct.unpack(">II", data[16:24])
        elif kind == "gif":
            w, h = struct.unpack("<HH", data[6:10])
        elif kind == "jpg":
            w = h = 0
            i = 2
            while i + 9 < len(data):
                if data[i] != 0xFF:
                    return None
                marker = data[i + 1]
                if marker == 0xFF:  # 채움 바이트
                    i += 1
                    continue
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                length = struct.unpack(">H", data[i + 2:i + 4])[0]
                # SOF0~SOF15 (DHT C4 · JPG C8 · DAC CC 제외)
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    h, w = struct.unpack(">HH", data[i + 5:i + 9])
                    break
                i += 2 + length
        else:
            return None
    except struct.error:
        return None
    if not (0 < w <= MAX_SIDE_PX and 0 < h <= MAX_SIDE_PX):
        return None
    return int(w), int(h)


def validate(data: bytes) -> dict:
    """올린 그림 검사 → {"ext", "content_type", "width", "height", "size"}. 틀리면 FigureError"""
    if not data:
        raise FigureError("빈 파일이에요")
    if len(data) > MAX_FIGURE_BYTES:
        raise FigureError(f"그림이 너무 커요 ({MAX_FIGURE_BYTES // (1024 * 1024)}MB 초과)")
    kind = sniff(data)
    if kind is None:
        raise FigureError("PNG · JPEG · GIF 그림만 넣을 수 있어요")
    size = image_size(data, kind)
    if size is None:
        raise FigureError("그림 파일을 읽지 못했어요 (손상된 파일일 수 있어요)")
    if not word_readable(data):
        # 예: 어도비 프로그램의 XMP 먼저 · CMYK(APP14) JPEG — 화면은 올리기 전에 JPEG로 다시 저장해 보낸다
        raise FigureError("워드에서 읽을 수 없는 그림 형식이에요. 그림 프로그램에서 PNG나 JPEG로 다시 저장해 주세요")
    return {"ext": kind, "content_type": CONTENT_TYPES[kind], "width": size[0], "height": size[1], "size": len(data)}


def word_readable(data: bytes) -> bool:
    """워드 내보내기(python-docx)가 이 그림을 읽는지. JPEG는 6번째 바이트부터 JFIF · Exif 머리글이 있어야 한다
    (없으면 add_picture가 UnrecognizedImageError — ValueError가 아니라 내보내기 전체가 실패한다)"""
    try:
        from docx.image.image import Image

        Image.from_blob(data)
    except Exception:  # noqa: BLE001 - UnrecognizedImageError · 머리글 해석 오류 모두 '못 읽음'
        return False
    return True


def fit_mm(width_px: int, height_px: int, max_w_mm: float, max_h_mm: float) -> tuple[float, float]:
    """96dpi로 본 크기를 본문 폭 · 높이 안에 맞춘 (가로, 세로) mm. 작은 그림은 키우지 않는다"""
    w = width_px * 25.4 / DPI
    h = height_px * 25.4 / DPI
    scale = min(1.0, max_w_mm / w if w else 1.0, max_h_mm / h if h else 1.0)
    return max(1.0, w * scale), max(1.0, h * scale)


def attach_images(blocks: list[dict], load: Callable[[str], bytes | None]) -> list[dict]:
    """figure 블록의 src(그림 이름)로 그림 바이트를 읽어 block["image"]에 넣은 새 목록.

    화면이 보낸 블록의 image 값은 믿지 않고 지운다(서버가 사용자 저장소에서 읽은 것만 쓴다).
    이름이 틀리거나 못 읽은 그림은 image 없이 두어 쓰는 쪽이 '[그림을 찾을 수 없어요]'로 적는다.
    같은 이름은 한 번만 읽고(load 한 번), 읽은 합계는 MAX_FIGURE_BYTES_PER_MANUSCRIPT까지."""
    out: list[dict] = []
    count = 0
    total = 0  # 읽은 그림 바이트 합계 (원고 하나의 그림 상한과 같게 — 넘으면 나머지는 '찾을 수 없어요')
    cache: dict[str, dict | None] = {}  # 같은 그림을 여러 번 적어도 한 번만 읽고 같은 image를 쓴다
    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "figure":
            out.append(block)
            continue
        b: dict[str, Any] = {k: v for k, v in block.items() if k != "image"}
        src = b.get("src")
        if isinstance(src, str) and NAME_RE.fullmatch(src) and count < MAX_EXPORT_FIGURES:
            count += 1
            if src not in cache:
                cache[src] = None
                data = load(src) if total < MAX_FIGURE_BYTES_PER_MANUSCRIPT else None
                if data and total + len(data) <= MAX_FIGURE_BYTES_PER_MANUSCRIPT:
                    kind = sniff(data)
                    size = image_size(data, kind) if kind else None
                    if kind and size:
                        total += len(data)
                        cache[src] = {"data": data, "format": kind, "width": size[0], "height": size[1]}
            if cache[src]:
                b["image"] = cache[src]
        out.append(b)
    return out
