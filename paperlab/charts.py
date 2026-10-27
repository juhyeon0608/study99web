"""수치 그래프를 코드로 그리기 (2026-10-28 사용자 요청 — "아쉬운 점을 개선 … codex 연결한 경우도 있을 거잖아").

AI가 막대 높이 · 점 위치를 눈대중으로 SVG 좌표에 적으면 엔진(claude · codex · gemini)마다 정확도가 다르다. 그래서 수치 그래프는
AI가 **차트 명세(JSON)** 만 내고 이 모듈이 정확한 비율로 SVG를 그린다. 통계 계산(stats.py)도 같은 명세로 AI 없이 그린다.

명세: {"type": "bar" | "line" | "scatter", "x_label", "y_label", "y_min", "y_max", "value_labels", "trend",
       "categories": [...],                                   (bar · line)
       "series": [{"name", "values": [수 | null], "errors": [수 | null]}]   (bar · line — errors = 오차 막대 ±값)
       "series": [{"name", "xy": [[x, y], ...]}]              (scatter)}
값을 모르면 null → 그림에 [확인 필요: 수치]. 그린 SVG의 <desc id="paperlab-chart">에 명세를 넣어 두어 고칠 때 명세만 보낸다.
"""

from __future__ import annotations

import json
import math
import re

TYPES = ("bar", "line", "scatter")
MAX_CATEGORIES, MAX_SERIES, MAX_POINTS = 40, 8, 2000
LABEL_MAX = 80
DESC_ID = "paperlab-chart"
FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Nanum Gothic',sans-serif"
W = 1000
PLOT_H = 440
TICK, LABEL, VALUE = 20, 22, 18
FILLS = ["#222", "#999", "#fff", "url(#pl-hatch)", "#ccc", "#555", "url(#pl-dots)", "#eee"]  # 흑백 인쇄에서 갈리게
DASHES = ["", "10 6", "3 5", "14 5 3 5", "6 4", "2 3", "18 6", "8 3 2 3"]
MARKERS = ["circle-open", "circle", "square", "triangle", "square-open", "triangle-open", "diamond", "diamond-open"]
CHECK = "[확인 필요: 수치]"


class ChartError(ValueError):
    """쓸 수 없는 차트 명세 (화면 문구)"""


# ---------------------------------------------------------------- 명세 검사
def _label(v, what: str = "") -> str:
    if v is None:
        return ""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = f"{v:g}"
    if not isinstance(v, str):
        raise ChartError(f"{what or '이름'}은 글이어야 해요")
    return re.sub(r"\s+", " ", v).strip()[:LABEL_MAX]


def _number(v, nullable: bool = True):
    if v is None and nullable:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        if isinstance(v, str):
            try:
                v = float(v.replace(",", ""))
            except ValueError:
                raise ChartError(f"'{v[:20]}'은(는) 숫자가 아니에요") from None
        else:
            raise ChartError("값은 숫자(모르면 null)여야 해요")
    v = float(v)
    if not math.isfinite(v) or abs(v) > 1e12:
        raise ChartError("값이 너무 크거나 숫자가 아니에요")
    return v


def validate(spec) -> dict:
    """AI · 통계가 준 명세 → 깨끗한 명세 (모르는 키는 버림). 틀리면 ChartError"""
    if not isinstance(spec, dict):
        raise ChartError("차트 명세는 JSON 객체여야 해요")
    kind = spec.get("type")
    if kind not in TYPES:
        raise ChartError("차트 종류(type)는 bar · line · scatter 중 하나여야 해요")
    out = {"type": kind, "x_label": _label(spec.get("x_label"), "축 이름"), "y_label": _label(spec.get("y_label"), "축 이름")}
    for k in ("y_min", "y_max", "x_min", "x_max"):
        if spec.get(k) is not None:
            out[k] = _number(spec[k], nullable=False)
    out["value_labels"] = bool(spec.get("value_labels", kind == "bar"))
    out["trend"] = bool(spec.get("trend", False))
    series = spec.get("series")
    if not isinstance(series, list) or not 1 <= len(series) <= MAX_SERIES:
        raise ChartError(f"계열(series)은 1~{MAX_SERIES}개여야 해요")
    clean = []
    if kind == "scatter":
        total = 0
        for s in series:
            if not isinstance(s, dict) or not isinstance(s.get("xy"), list):
                raise ChartError("산점도 계열에는 점 목록(xy: [[x, y], …])이 있어야 해요")
            pts = []
            for p in s["xy"]:
                if not isinstance(p, (list, tuple)) or len(p) != 2:
                    raise ChartError("점은 [x, y] 모양이어야 해요")
                x, y = _number(p[0]), _number(p[1])
                if x is not None and y is not None:
                    pts.append([x, y])
            total += len(pts)
            clean.append({"name": _label(s.get("name"), "계열 이름"), "xy": pts})
        if total > MAX_POINTS:
            raise ChartError(f"점은 {MAX_POINTS:,}개까지 그려요")
    else:
        cats = spec.get("categories")
        if not isinstance(cats, list) or not 1 <= len(cats) <= MAX_CATEGORIES:
            raise ChartError(f"항목(categories)은 1~{MAX_CATEGORIES}개여야 해요")
        out["categories"] = [_label(c, "항목 이름") for c in cats]
        n = len(cats)
        for s in series:
            if not isinstance(s, dict) or not isinstance(s.get("values"), list):
                raise ChartError("계열마다 값 목록(values)이 있어야 해요")
            vals = [_number(v) for v in s["values"][:n]] + [None] * max(0, n - len(s["values"]))
            errs = s.get("errors")
            item = {"name": _label(s.get("name"), "계열 이름"), "values": vals}
            if isinstance(errs, list):
                e = [_number(v) for v in errs[:n]] + [None] * max(0, n - len(errs))
                item["errors"] = [abs(v) if v is not None else None for v in e]
            clean.append(item)
    out["series"] = clean
    return out


# ---------------------------------------------------------------- 눈금 · 글자 폭
def nice_ticks(lo: float, hi: float, n: int = 5) -> list[float]:
    if hi < lo:
        lo, hi = hi, lo
    if hi == lo:
        hi = lo + (abs(lo) or 1)
    raw = (hi - lo) / n
    mag = 10 ** math.floor(math.log10(raw))
    step = next(m * mag for m in (1, 2, 2.5, 5, 10) if m * mag >= raw)
    start = math.floor(lo / step + 1e-9) * step
    end = math.ceil(hi / step - 1e-9) * step
    k = int(round((end - start) / step))
    return [round(start + i * step, 10) for i in range(k + 1)]


def _decimals(step: float) -> int:
    for d in range(0, 6):
        if abs(step * 10 ** d - round(step * 10 ** d)) < 1e-6:
            return d
    return 6


def fmt_num(v: float, d: int) -> str:
    s = f"{v:.{d}f}"
    return "0" if re.fullmatch(r"-?0(\.0*)?", s) else s.replace("-", "−")


def text_width(s: str, size: float) -> float:
    """대략의 글자 폭 (한글 · 한자 1em, 나머지 0.56em)"""
    return sum(size if ord(c) > 0x2E7F else size * 0.56 for c in str(s))


def _esc(s: str) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _f(x: float) -> str:
    return f"{x:.1f}".rstrip("0").rstrip(".")


def _text(x, y, s, size=TICK, anchor="middle", extra="") -> str:
    return (f'<text x="{_f(x)}" y="{_f(y)}" font-family="{FONT}" font-size="{size}" text-anchor="{anchor}" fill="#000"{extra}>'
            f"{_esc(s)}</text>")


def wrap(s: str, width: float, size: float = TICK, lines: int = 3) -> list[str] | None:
    """띄어쓰기에서 나눠 width 안에 들어가는 줄들 (lines줄을 넘거나 한 낱말이 넘치면 None)"""
    out, cur = [], ""
    for w in str(s).split(" "):
        t = f"{cur} {w}" if cur else w
        if text_width(t, size) <= width:
            cur = t
            continue
        if not cur or text_width(w, size) > width:
            return None
        out.append(cur)
        cur = w
    out.append(cur)
    return out if len(out) <= lines else None


def _marker(kind: str, x: float, y: float, r: float = 7) -> str:
    open_ = kind.endswith("-open") or kind == "circle-open"
    fill = "#fff" if open_ else "#000"
    base = kind.replace("-open", "")
    style = f'fill="{fill}" stroke="#000" stroke-width="2"'
    if base == "circle":
        return f'<circle cx="{_f(x)}" cy="{_f(y)}" r="{_f(r)}" {style}/>'
    if base == "square":
        return f'<rect x="{_f(x - r)}" y="{_f(y - r)}" width="{_f(2 * r)}" height="{_f(2 * r)}" {style}/>'
    if base == "triangle":
        return f'<polygon points="{_f(x)},{_f(y - r * 1.15)} {_f(x - r * 1.1)},{_f(y + r * 0.85)} {_f(x + r * 1.1)},{_f(y + r * 0.85)}" {style}/>'
    return f'<polygon points="{_f(x)},{_f(y - r * 1.25)} {_f(x + r * 1.1)},{_f(y)} {_f(x)},{_f(y + r * 1.25)} {_f(x - r * 1.1)},{_f(y)}" {style}/>'


# ---------------------------------------------------------------- 그리기
def spec_has_trend(spec: dict) -> bool:
    return spec.get("type") == "scatter" and bool(spec.get("trend"))


def render(spec) -> str:
    """명세 → SVG 글 (흰 배경 · 흑백 학술 양식 · 가로 1000). 명세를 <desc id="paperlab-chart">에 넣어 둔다"""
    s = validate(spec)
    kind, series = s["type"], s["series"]
    defs = ('<defs><pattern id="pl-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
            '<rect width="10" height="10" fill="#fff"/><line x1="0" y1="0" x2="0" y2="10" stroke="#000" stroke-width="3"/></pattern>'
            '<pattern id="pl-dots" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#fff"/>'
            '<circle cx="4" cy="4" r="1.8" fill="#000"/></pattern></defs>')
    body: list[str] = []
    missing = False

    # 범례 (계열이 둘 이상일 때 위에 한 줄씩)
    legend_items = [x["name"] or f"계열 {i + 1}" for i, x in enumerate(series)] if len(series) > 1 else []
    rows, row, roww = [], [], 0.0
    for i, name in enumerate(legend_items):
        w = 40 + text_width(name, TICK) + 28
        if row and roww + w > W - 60:
            rows.append(row)
            row, roww = [], 0.0
        row.append((i, name, w))
        roww += w
    if row:
        rows.append(row)
    top = 30 + len(rows) * 36
    if spec_has_trend(s):
        top += 30  # R² 줄 (그림 칸 위)

    # y 범위
    if kind == "scatter":
        ys = [p[1] for x in series for p in x["xy"]]
        xs = [p[0] for x in series for p in x["xy"]]
    else:
        ys = []
        for x in series:
            for v, e in zip(x["values"], x.get("errors") or [None] * len(x["values"])):
                if v is None:
                    missing = True
                    continue
                ys += [v, v + (e or 0), v - (e or 0)]
        xs = []
    lo = min(ys) if ys else 0.0
    hi = max(ys) if ys else 1.0
    if kind == "bar":
        lo, hi = min(lo, 0.0), max(hi, 0.0)
    elif ys and lo == hi:
        lo, hi = lo - 1, hi + 1
    lo = s.get("y_min", lo)
    hi = s.get("y_max", hi)
    yt = nice_ticks(lo, hi)
    if "y_min" in s:
        yt = [t for t in yt if t >= s["y_min"] - 1e-9] or yt
    if "y_max" in s:
        yt = [t for t in yt if t <= s["y_max"] + 1e-9] or yt
    y0, y1 = yt[0], yt[-1]
    if "y_min" in s:
        y0 = s["y_min"]
    if "y_max" in s:
        y1 = s["y_max"]
    if y1 <= y0:
        y1 = y0 + 1
    yd = _decimals(yt[1] - yt[0] if len(yt) > 1 else 1)
    ytl = [fmt_num(t, yd) for t in yt]

    left = 24 + (40 if s["y_label"] else 0) + max(text_width(t, TICK) for t in ytl) + 14
    right = W - 30

    # x 눈금 글
    if kind == "scatter":
        xlo = s.get("x_min", min(xs) if xs else 0.0)
        xhi = s.get("x_max", max(xs) if xs else 1.0)
        xt = nice_ticks(xlo, xhi)
        x0, x1 = s.get("x_min", xt[0]), s.get("x_max", xt[-1])
        if x1 <= x0:
            x1 = x0 + 1
        xd = _decimals(xt[1] - xt[0] if len(xt) > 1 else 1)
        cats = []
        bottom = 44
        rot = False
    else:
        cats = s["categories"]
        slot = (right - left) / len(cats)
        widest = max(text_width(c, TICK) for c in cats)
        wrapped = [wrap(c, slot * 0.92) for c in cats]
        rot = any(w is None for w in wrapped)  # 띄어쓰기로 나눠도 안 들어가면 비스듬히
        nlines = 1 if rot else max(len(w) for w in wrapped)
        if rot:  # 비스듬한 첫 항목 글이 왼쪽 밖으로 나가지 않게
            need = 0.77 * text_width(cats[0], TICK) + 4 - slot / 2
            if need > left:
                left = min(need, W * 0.35)
                slot = (right - left) / len(cats)
        bottom = (min(widest, 300) * 0.64 + 34) if rot else 18 + 26 * nlines
    bottom += 44 if s["x_label"] else 0
    plot_top, plot_bot = top, top + PLOT_H
    H = int(math.ceil(plot_bot + bottom + 16))

    def Y(v: float) -> float:
        return plot_bot - (v - y0) / (y1 - y0) * PLOT_H

    # 축 · 눈금 · 가로 보조선
    for t, lab in zip(yt, ytl):
        if t < y0 - 1e-9 or t > y1 + 1e-9:
            continue
        y = Y(t)
        if abs(t - y0) > 1e-9:
            body.append(f'<line x1="{_f(left)}" y1="{_f(y)}" x2="{_f(right)}" y2="{_f(y)}" stroke="#ddd" stroke-width="1"/>')
        body.append(f'<line x1="{_f(left - 8)}" y1="{_f(y)}" x2="{_f(left)}" y2="{_f(y)}" stroke="#000" stroke-width="2"/>')
        body.append(_text(left - 14, y + 7, lab, anchor="end"))
    if s["y_label"]:
        cy = (plot_top + plot_bot) / 2
        body.append(_text(30, cy, s["y_label"], LABEL, extra=f' transform="rotate(-90 30 {_f(cy)})" dominant-baseline="middle"'))

    if kind == "scatter":
        def X(v: float) -> float:
            return left + (v - x0) / (x1 - x0) * (right - left)
        for t in xt:
            if t < x0 - 1e-9 or t > x1 + 1e-9:
                continue
            body.append(f'<line x1="{_f(X(t))}" y1="{_f(plot_bot)}" x2="{_f(X(t))}" y2="{_f(plot_bot + 8)}" stroke="#000" stroke-width="2"/>')
            body.append(_text(X(t), plot_bot + 32, fmt_num(t, xd)))
        r = 6 if sum(len(x["xy"]) for x in series) < 300 else 4
        notes = []
        for i, x in enumerate(series):
            mk = MARKERS[i % len(MARKERS)]
            body += [_marker(mk, X(px), Y(py), r) for px, py in x["xy"] if x0 <= px <= x1 and y0 <= py <= y1]
            if s["trend"] and len(x["xy"]) >= 3:
                n = len(x["xy"])
                mx = sum(p[0] for p in x["xy"]) / n
                my = sum(p[1] for p in x["xy"]) / n
                sxx = sum((p[0] - mx) ** 2 for p in x["xy"])
                if sxx > 0:
                    b = sum((p[0] - mx) * (p[1] - my) for p in x["xy"]) / sxx
                    a = my - b * mx
                    syy = sum((p[1] - my) ** 2 for p in x["xy"])
                    r2 = (b * b * sxx / syy) if syy else 0.0
                    ax0, ax1 = min(p[0] for p in x["xy"]), max(p[0] for p in x["xy"])
                    pts = []
                    for xv in (ax0, ax1):  # 그림 칸 밖으로 나가지 않게 y를 잘라 x를 다시 구함
                        yv = min(max(a + b * xv, y0), y1)
                        pts.append((((yv - a) / b) if b and yv != a + b * xv else xv, yv))
                    dash = DASHES[i % len(DASHES)] or ""
                    body.append(f'<line x1="{_f(X(pts[0][0]))}" y1="{_f(Y(pts[0][1]))}" x2="{_f(X(pts[1][0]))}" y2="{_f(Y(pts[1][1]))}" '
                                f'stroke="#000" stroke-width="3"' + (f' stroke-dasharray="{dash}"' if dash else "") + "/>")
                    r2s = f"{r2:.2f}".lstrip("0") if r2 < 1 else "1.00"
                    notes.append((x["name"] + ": " if len(series) > 1 else "") + f"R² = {r2s}")
        if notes:
            body.append(_text(right, plot_top - 14, ", ".join(notes), TICK, "end"))
    else:
        n = len(cats)
        slot = (right - left) / n
        for j, c in enumerate(cats):
            cx = left + slot * (j + 0.5)
            if rot:
                body.append(_text(cx + 6, plot_bot + 24, c, extra=f' transform="rotate(-40 {_f(cx + 6)} {_f(plot_bot + 24)})"', anchor="end"))
            else:
                for li, part in enumerate(wrapped[j]):
                    body.append(_text(cx, plot_bot + 32 + 26 * li, part))
        vd = max([_decimals(v) for x in series for v in x["values"] if v is not None] or [0])
        vd = min(vd, 2)
        if kind == "bar":
            k = len(series)
            gw = slot * (0.7 if k > 1 else 0.56)
            bw = gw / k
            base = Y(min(max(0.0, y0), y1))
            show = s["value_labels"] and n * k <= 24
            for i, x in enumerate(series):
                fill = FILLS[i % len(FILLS)]
                errs = x.get("errors") or [None] * n
                for j, (v, e) in enumerate(zip(x["values"], errs)):
                    bx = left + slot * j + (slot - gw) / 2 + bw * i
                    if v is None:  # 모르는 값: 그 자리에 ? (그림 위 [확인 필요: 수치])
                        body.append(_text(bx + bw / 2, base - 10, "?", LABEL))
                        continue
                    yv = Y(min(max(v, y0), y1))
                    body.append(f'<rect x="{_f(bx + 2)}" y="{_f(min(yv, base))}" width="{_f(max(bw - 4, 1))}" height="{_f(abs(base - yv))}" '
                                f'fill="{fill}" stroke="#000" stroke-width="2"/>')
                    cxm = bx + bw / 2
                    lab_y = yv - 10 if v >= 0 else yv + 26
                    if e:
                        ya, yb = Y(min(max(v + e, y0), y1)), Y(min(max(v - e, y0), y1))
                        cap = min(16, bw * 0.4)
                        body.append(f'<path d="M{_f(cxm)} {_f(ya)}V{_f(yb)}M{_f(cxm - cap / 2)} {_f(ya)}H{_f(cxm + cap / 2)}'
                                    f'M{_f(cxm - cap / 2)} {_f(yb)}H{_f(cxm + cap / 2)}" stroke="#000" stroke-width="2" fill="none"/>')
                        lab_y = (ya - 10) if v >= 0 else (yb + 26)
                    if show:
                        body.append(_text(cxm, lab_y, fmt_num(v, vd), VALUE))
        else:  # line
            for i, x in enumerate(series):
                dash = DASHES[i % len(DASHES)]
                pts = []
                errs = x.get("errors") or [None] * n
                segs: list[list[tuple[float, float]]] = [[]]
                for j, (v, e) in enumerate(zip(x["values"], errs)):
                    cx = left + slot * (j + 0.5)
                    if v is None:
                        segs.append([])
                        continue
                    segs[-1].append((cx, Y(v)))
                    pts.append((cx, Y(v)))
                    if e:
                        ya, yb = Y(min(v + e, y1)), Y(max(v - e, y0))
                        body.append(f'<path d="M{_f(cx)} {_f(ya)}V{_f(yb)}M{_f(cx - 7)} {_f(ya)}H{_f(cx + 7)}M{_f(cx - 7)} {_f(yb)}H{_f(cx + 7)}" '
                                    'stroke="#000" stroke-width="2" fill="none"/>')
                for seg in segs:
                    if len(seg) > 1:
                        body.append(f'<polyline points="{" ".join(f"{_f(a)},{_f(b)}" for a, b in seg)}" fill="none" stroke="#000" stroke-width="3"'
                                    + (f' stroke-dasharray="{dash}"' if dash else "") + "/>")
                body += [_marker(MARKERS[i % len(MARKERS)], a, b) for a, b in pts]
                if s["value_labels"] and n * len(series) <= 24:
                    body += [_text(a, b - 16, fmt_num(v, vd), VALUE) for (a, b), v in zip(pts, [v for v in x["values"] if v is not None])]

    # 축선 (막대 위에 그림)
    body.append(f'<path d="M{_f(left)} {_f(plot_top)}V{_f(plot_bot)}H{_f(right)}" stroke="#000" stroke-width="2" fill="none"/>')
    if kind == "bar" and y0 < 0 < y1:
        body.append(f'<line x1="{_f(left)}" y1="{_f(Y(0))}" x2="{_f(right)}" y2="{_f(Y(0))}" stroke="#000" stroke-width="2"/>')
    if s["x_label"]:
        body.append(_text((left + right) / 2, H - 22, s["x_label"], LABEL))
    if not ys:  # 값이 하나도 없으면 가운데, 일부만 없으면 그림 칸 왼쪽 위
        body.append(_text((left + right) / 2, (plot_top + plot_bot) / 2, CHECK, LABEL))
    elif missing:
        body.append(_text(left + 14, plot_top + 26, CHECK, TICK, "start"))

    # 범례
    for r_i, row in enumerate(rows):
        total = sum(w for _, _, w in row)
        x = (W - total) / 2
        y = 30 + r_i * 36
        for i, name, w in row:
            if kind == "bar":
                body.append(f'<rect x="{_f(x)}" y="{_f(y - 9)}" width="28" height="20" fill="{FILLS[i % len(FILLS)]}" stroke="#000" stroke-width="2"/>')
            elif kind == "line":
                dash = DASHES[i % len(DASHES)]
                body.append(f'<line x1="{_f(x - 4)}" y1="{_f(y + 1)}" x2="{_f(x + 32)}" y2="{_f(y + 1)}" stroke="#000" stroke-width="3"'
                            + (f' stroke-dasharray="{dash}"' if dash else "") + "/>")
                body.append(_marker(MARKERS[i % len(MARKERS)], x + 14, y + 1, 6))
            else:
                body.append(_marker(MARKERS[i % len(MARKERS)], x + 14, y + 1, 7))
            body.append(_text(x + 40, y + 8, name, TICK, "start"))
            x += w

    desc = f'<desc id="{DESC_ID}">{_esc(json.dumps(s, ensure_ascii=False, separators=(",", ":")))}</desc>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}">{desc}{defs}'
            f'<rect width="100%" height="100%" fill="#fff"/>' + "".join(body) + "</svg>")


_DESC_RE = re.compile(r'<desc id="' + DESC_ID + r'">(.*?)</desc>', re.S)


def spec_from_svg(svg) -> dict | None:
    """우리가 그린 차트 SVG면 그 명세 (아니면 None)"""
    m = _DESC_RE.search(str(svg or ""))
    if not m:
        return None
    raw = m.group(1).replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&amp;", "&")
    try:
        return validate(json.loads(raw))
    except (ValueError, ChartError):
        return None


def parse_spec(text) -> dict:
    """AI가 <chart> 안에 쓴 JSON 글 (``` 울타리 · 앞뒤 말 허용) → 명세. 틀리면 ChartError"""
    t = str(text or "").strip()
    t = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", t).strip()
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b < a:
        raise ChartError("차트 명세(JSON)를 찾지 못했어요")
    try:
        spec = json.loads(t[a:b + 1])
    except ValueError:
        raise ChartError("차트 명세(JSON)를 읽지 못했어요") from None
    return validate(spec)
