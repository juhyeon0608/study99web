"""앱 아이콘 · 트레이 아이콘 만들기 (디자인 11.5 · 11.9, PD-6) — 표준 라이브러리만.

- build/icon.ico: deploy/make_icon.py와 같은 모양(U3), 16 · 24 · 32 · 48 · 64 · 128 · 256px
- build/tray-{idle,running,paused,error}.ico: 16 · 20 · 24 · 32px. 오른쪽 아래 배지 **모양**으로 구분(색만으로 구분하지 않음)
  idle = 배지 없음 · running = 초록 원 + 흰 ▶ · paused = 회색 바탕 + 짙은 회색 원 + 흰 ❙❙ · error = 주황 ▲ + 흰 !
  배지는 아이콘 폭의 50%(16px에서 8px)

실행: python desktop/scripts/make_icons.py   (디자인팀 확인 전 임시 그림 — 디자인팀이 바꾸면 이 스크립트를 고치거나 파일을 바꿈)
"""

from __future__ import annotations

import importlib.util
import math
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
spec = importlib.util.spec_from_file_location("make_icon", ROOT / "deploy" / "make_icon.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

GRAY = (0x6B, 0x72, 0x80)
GREEN = (0x16, 0xA3, 0x4A)
DARK = (0x37, 0x41, 0x51)
ORANGE = (0xEA, 0x58, 0x0C)
WHITE = (0xFF, 0xFF, 0xFF)
# 배지: 32 단위 좌표에서 중심 (24, 24), 반지름 8 (= 폭의 50%), 흰 테두리 1.5
CX, CY, R, RING = 24.0, 24.0, 8.0, 1.5


def _in_triangle(x, y, a, b, c) -> bool:
    def s(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    d1, d2, d3 = s((x, y), a, b), s((x, y), b, c), s((x, y), c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def badge(state, x, y):
    """배지 위의 색(없으면 None). 원/삼각형 + 흰 테두리 + 흰 기호"""
    d = math.hypot(x - CX, y - CY)
    if state in ("running", "paused"):
        if d > R:
            return None
        if d > R - RING:
            return WHITE
        fill = GREEN if state == "running" else DARK
        if state == "running" and _in_triangle(x, y, (21.5, 20.0), (21.5, 28.0), (28.0, 24.0)):
            return WHITE
        if state == "paused" and (20.8 <= x <= 22.8 or 25.2 <= x <= 27.2) and 20.5 <= y <= 27.5:
            return WHITE
        return fill
    if state == "error":
        outer = ((CX, 15.0), (32.0, 31.5), (16.0, 31.5))
        inner = ((CX, 17.6), (30.0, 30.2), (18.0, 30.2))
        if not _in_triangle(x, y, *outer):
            return None
        if not _in_triangle(x, y, *inner):
            return WHITE
        if 23.1 <= x <= 24.9 and (20.5 <= y <= 26.0 or 27.2 <= y <= 29.0):
            return WHITE
        return ORANGE
    return None


def sample(state):
    def f(x, y):
        b = badge(state, x, y)
        if b:
            return b
        c = base._sample(x, y)
        if c and state == "paused" and c == base.NAVY:
            return GRAY
        return c
    return f


def render(size, fn, samples=8):
    out = bytearray()
    scale = 32 / size
    for py in range(size):
        for px in range(size):
            r = g = b = a = 0
            for sy in range(samples):
                for sx in range(samples):
                    c = fn((px + (sx + 0.5) / samples) * scale, (py + (sy + 0.5) / samples) * scale)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 1  # noqa: E702
            n = samples * samples
            out += bytes((round(r / a), round(g / a), round(b / a), round(255 * a / n))) if a else b"\0\0\0\0"
    return bytes(out)


def ico(sizes, fn) -> bytes:
    images = [base.png(s, render(s, fn)) for s in sizes]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = b""
    for s, data in zip(sizes, images):
        entries += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    return header + entries + b"".join(images)


def main() -> int:
    out = HERE.parent / "build"
    out.mkdir(exist_ok=True)
    (out / "icon.ico").write_bytes(ico((16, 24, 32, 48, 64, 128, 256), base._sample))
    for state in ("idle", "running", "paused", "error"):
        (out / f"tray-{state}.ico").write_bytes(ico((16, 20, 24, 32), sample(state)))
    for f in sorted(out.glob("*.ico")):
        print(f"{f.relative_to(ROOT)} {f.stat().st_size} 바이트")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
