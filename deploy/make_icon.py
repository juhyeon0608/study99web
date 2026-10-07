"""바로가기 아이콘 deploy/paperlab.ico 만들기 (디자인 시안 15장 · 명세 D13).

파비콘 SVG(viewBox 0 0 32 32)를 그대로 옮긴 단순한 도형이라 외부 의존성 없이 표준 라이브러리로 그린다
(픽셀마다 8×8 표본으로 가장자리를 부드럽게). 16 · 32 · 48 · 256px PNG 네 장을 한 .ico에 담는다.

    <svg viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#1e3a8a"/>
      <path d="M10 8h9l5 5v11a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" fill="#fff"/>
      <path d="M12 17h8M12 21h6" stroke="#1e3a8a" stroke-width="2" stroke-linecap="round"/>
    </svg>

실행: python deploy/make_icon.py  (결과: deploy/paperlab.ico)
"""

from __future__ import annotations

import math
import struct
import sys
import zlib
from pathlib import Path

NAVY = (0x1E, 0x3A, 0x8A)
WHITE = (0xFF, 0xFF, 0xFF)
SIZES = (16, 32, 48, 256)
SAMPLES = 8


def _in_round_rect(x, y, x0, y0, x1, y1, r) -> bool:
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def _in_doc(x, y) -> bool:
    """흰 문서: (8,8)-(24,26), 오른쪽 위 모서리를 (19,8)-(24,13)으로 자르고 나머지 모서리는 반지름 2"""
    if not (8 <= x <= 24 and 8 <= y <= 26):
        return False
    if x - 19 > y - 8:  # 접힌 모서리 자르기
        return False
    for cx, cy, inside in ((10, 10, x < 10 and y < 10), (10, 24, x < 10 and y > 24), (22, 24, x > 22 and y > 24)):
        if inside and (x - cx) ** 2 + (y - cy) ** 2 > 4:
            return False
    return True


def _near_segment(x, y, ax, ay, bx, by, half) -> bool:
    t = max(0.0, min(1.0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
    return math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) <= half


def _sample(x, y):
    """(색, 불투명) — SVG 그리는 순서대로 위에 덮는다"""
    if not _in_round_rect(x, y, 0, 0, 32, 32, 8):
        return None
    color = NAVY
    if _in_doc(x, y):
        color = WHITE
        if _near_segment(x, y, 12, 17, 20, 17, 1) or _near_segment(x, y, 12, 21, 18, 21, 1):
            color = NAVY
    return color


def render(size: int) -> bytes:
    """RGBA 픽셀 (위에서 아래로)"""
    out = bytearray()
    scale = 32 / size
    for py in range(size):
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    c = _sample((px + (sx + 0.5) / SAMPLES) * scale, (py + (sy + 0.5) / SAMPLES) * scale)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1  # noqa: E702
            n = SAMPLES * SAMPLES
            if a:
                out += bytes((round(r / a), round(g / a), round(b / a), round(255 * a / n)))
            else:
                out += b"\0\0\0\0"
    return bytes(out)


def png(size: int, rgba: bytes) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\0" + rgba[y * size * 4:(y + 1) * size * 4] for y in range(size))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def make_ico(sizes=SIZES) -> bytes:
    images = [png(s, render(s)) for s in sizes]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b""
    for s, data in zip(sizes, images):
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return header + entries + b"".join(images)


def main() -> int:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name("paperlab.ico")
    target.write_bytes(make_ico())
    print(f"{target} ({target.stat().st_size} 바이트, {', '.join(map(str, SIZES))}px)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
