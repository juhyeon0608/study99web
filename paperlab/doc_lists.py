"""목차 · 그림 목차 · 표 목차 (docs/specs/export-lists-footnotes.md)

표지류 양식(학위논문 · 대체 보고서)으로 워드 · 한글을 내보낼 때 표지 → 속표지 → 인정서(인준서) 바로 뒤,
본문(첫 장 앞 부분 포함) 앞에 '목 차' · '그림 목차' · '표 목차' 쪽을 넣는다. 각 목록은 새 쪽에서 시작한다.

- 목차 항목: 제목 블록 heading 1(## 장) · 2(### 절), '항까지'를 켜면 3(#### 항)까지 + 참고문헌 제목
- 그림 · 표 목차 항목: 그림 · 표 캡션 글("그림 1. 설명", "표 1. 제목") — 캡션이 없는 그림 · 표는 빠진다
- 쪽 번호: estimate_pages가 양식 값(용지 · 여백 · 글자 크기 · 줄간격 · 쪽 나눔)으로 어림한다.
  워드는 진짜 TOC 필드라 열 때 '필드 업데이트'(updateFields)로 워드가 다시 계산하고, 그 전에는 이 어림값이 보인다.
  한글은 정적 목록(점선 + 쪽 번호)이라 이 어림값이 그대로 남는다(명세 3장 — 한컴 '차례 새로 고침'은
  개요 문단 · 바탕글 스타일 문단을 모으므로 이 내보내기의 문단과 맞지 않아 쓰지 않음).

설정: 원고 표지 정보(cover)의 include.toc · include.lof · include.lot(기본 켬) · include.toc_h4(기본 끔).
표지 없는 양식(기본 · APA · 표지 '없음')에는 넣지 않는다.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

from . import doc_formats as df
from . import figures as fig

Block = dict[str, Any]
KINDS = ("toc", "lof", "lot")
TITLES = {"toc": "목 차", "lof": "그림 목차", "lot": "표 목차"}
MAX_ENTRIES = 2000  # 목록 하나의 항목 수 상한(비정상 입력 방어)


def _plain(runs: Any) -> str:
    """런 목록 → 글자 (각주는 빼고, 줄바꿈 · 연속 공백은 한 칸)"""
    if not isinstance(runs, list):
        return ""
    text = "".join(str(r.get("text") or "") for r in runs if isinstance(r, dict) and "footnote" not in r)
    return " ".join(text.split())


def wanted(fmt: dict, cover: dict | None) -> dict:
    """넣을 목록 {toc, lof, lot: bool, depth: 2|3}. 표지 없는 양식은 모두 False"""
    if (fmt.get("cover") or {}).get("kind", "none") == "none":
        return {"toc": False, "lof": False, "lot": False, "depth": 2}
    inc = df.cover_with_defaults(cover)["include"]
    return {"toc": bool(inc.get("toc", True)), "lof": bool(inc.get("lof", True)), "lot": bool(inc.get("lot", True)),
            "depth": 3 if inc.get("toc_h4") else 2}


def entries(blocks: Iterable[Block], kind: str, depth: int = 2) -> list[dict]:
    """목록 항목 [{"level": 1~3, "text", "block": 가리키는 블록, "page": None}]"""
    out: list[dict] = []
    for b in blocks:
        if not isinstance(b, dict):
            continue
        t = b.get("type")
        level, text = None, ""
        if kind == "toc" and t == "heading":
            try:
                level = max(1, min(3, int(b.get("level") or 1)))
            except (TypeError, ValueError):
                level = 1
            text = _plain(b.get("runs"))
            if level > depth:
                continue
        elif kind == "toc" and t == "bib_heading":
            level, text = 1, " ".join(str(b.get("text") or "참고문헌").split())
        elif (kind == "lof" and t == "figure") or (kind == "lot" and t == "table"):
            level, text = 1, _plain(b.get("caption"))
        if level is None or not text:
            continue
        out.append({"level": level, "text": text, "block": b, "page": None})
        if len(out) >= MAX_ENTRIES:
            break
    return out


def build(blocks: list[Block], fmt: dict, cover: dict | None) -> list[Block]:
    """넣을 목록 블록들 [{"type": "contents", "kind", "title", "depth", "entries"}, {"type": "page_break"}, …].
    항목이 하나도 없는 목록은 넣지 않는다. 마지막 목록 뒤에도 쪽 나눔(뒤 본문이 새 쪽에서 시작)"""
    want = wanted(fmt, cover)
    out: list[Block] = []
    for kind in KINDS:
        if not want[kind]:
            continue
        items = entries(blocks, kind, want["depth"])
        if items:
            out += [{"type": "contents", "kind": kind, "title": TITLES[kind], "depth": want["depth"],
                     "entries": items}, {"type": "page_break"}]
    return out


# ------------------------------------------------------------------ 쪽 번호 어림
def _runs_text(runs: Any) -> tuple[str, list[str]]:
    """(본문 글자, [각주 글자…])"""
    notes = []
    if isinstance(runs, list):
        for r in runs:
            if isinstance(r, dict) and "footnote" in r:
                notes.append(_plain(r["footnote"]))
    return _plain(runs), notes


def _char_em(c: str) -> float:
    """글자 폭(글자 크기 배) — doc_formats.estimate_lines와 같은 규칙: 한글 · 한자 · 전각 1.0, 영문 · 숫자 0.55, 공백 0.3"""
    if c == " ":
        return 0.3
    return 1.0 if ord(c) >= 0x1100 and not (0x2000 <= ord(c) <= 0x206F) else 0.55


_UNIT_RE = re.compile(r"[^\sᄀ-￿]+|\S")  # 영문 · 숫자 단어 하나 또는 (한글 · 한자 등) 글자 하나


def wrap_lines(text: str, size_pt: float, width_pt: float, first_pt: float = 0.0) -> int:
    """줄 수 어림: 영문 · 숫자 단어는 줄 끝에서 가르지 않고(다음 줄로), 한글 · 한자는 글자 단위로 채운다
    (내보내는 한글 문단 모양 = 영문 '단어' · 한글 '글자' 단위 줄 나눔, LibreOffice도 같음).
    줄 끝 공백은 폭에 넣지 않는다. first_pt = 첫 줄 들여쓰기"""
    text = str(text or "").replace("\n", " ")
    width = max(width_pt, size_pt)
    lines, x = 1, first_pt
    for m in _UNIT_RE.finditer(text):
        w = sum(_char_em(c) for c in m.group()) * size_pt
        space = 0.3 * size_pt if m.start() > 0 and text[m.start() - 1] == " " else 0.0
        if x + space + w <= width:
            x += space + w
            continue
        lines, x = lines + 1, 0.0
        while w > width:  # 한 줄보다 긴 단어
            lines, w = lines + 1, w - width
        x = w
    return lines


class _Measure:
    """양식 값으로 블록 높이(pt)를 어림한다 — 한 줄 높이 = 글자 크기 × 줄간격 %"""

    def __init__(self, fmt: dict):
        self.fmt = fmt
        self.S = {k: df.resolve_style(fmt, k) for k in
                  ("body", "title", "headings.1", "headings.2", "headings.3", "quote", "footnote", "bibliography")}
        page, m = fmt["page"], fmt["page"]["margin_mm"]
        self.width_mm = max(20.0, page["width_mm"] - m["left"] - m["right"])
        height_mm = page["height_mm"] - m["top"] - m["bottom"] - page["header_mm"] - page["footer_mm"]
        self.height_pt = max(20.0, height_mm) * df.PT_PER_MM
        self.fig_max = (self.width_mm, max(20.0, height_mm) * 0.8)

    def line(self, st: dict) -> float:
        return float(st["size_pt"]) * float(st["line_spacing_pct"]) / 100

    def text_height(self, st: dict, text: str, indent_pt: float = 0.0, first_pt: float = 0.0) -> float:
        width = max(10.0, self.width_mm - indent_pt / df.PT_PER_MM) * df.PT_PER_MM
        return wrap_lines(text, float(st["size_pt"]), width, first_pt) * self.line(st)

    def para(self, st: dict, text: str) -> float:
        size = float(st["size_pt"])
        indent = df.length_pt(st["indent_left"], size) + df.length_pt(st["indent_right"], size)
        first = max(0.0, df.length_pt(st["first_line_indent"], size))
        return float(st["space_before_pt"]) + self.text_height(st, text, indent, first) + float(st["space_after_pt"])

    def notes(self, notes: list[str]) -> list[float]:
        st = self.S["footnote"]
        return [self.text_height(st, n or " ") for n in notes]

    def block(self, b: Block) -> dict:
        """{"h": 본문 높이 pt, "notes": [각주 높이…], "split": 쪽을 넘겨 나눠도 되는지,
        "brk": 새 쪽에서 시작하는 모양인지, "head": 다음과 함께 두는 제목인지}"""
        S, t = self.S, b.get("type")
        body_line = self.line(S["body"])
        out = {"notes": [], "split": True, "brk": False, "head": False, "before": 0.0}
        if t == "contents":
            title = S["headings.1"]
            h = self.para(dict(title, first_line_indent=df.mm(0)), b.get("title") or "")
            return dict(out, h=h + len(b.get("entries") or []) * body_line)
        if t == "figure":  # 그림 문단(앞 6pt) + 캡션(뒤 6pt) — 함께 둔다
            image = b.get("image")
            h = body_line
            if isinstance(image, dict) and image.get("width") and image.get("height"):
                h = fig.fit_mm(image["width"], image["height"], *self.fig_max)[1] * df.PT_PER_MM
            cap = _plain(b.get("caption"))
            return dict(out, h=h + 6 + (self.text_height(S["body"], cap) + 6 if cap else 0), split=False, before=6.0)
        if t == "table":  # 칸 = 본문 글자 · 줄간격 130%까지, 칸 안 좌우 여백 약 2mm씩
            rows = [r for r in (b.get("rows") or []) if isinstance(r, list)][:500]
            cols = max((len(r) for r in rows), default=1) or 1
            col_mm = self.width_mm / cols
            cell = dict(S["body"], line_spacing_pct=min(float(S["body"]["line_spacing_pct"]), 130.0))
            h = 0.0
            for r in rows:
                lines = max((wrap_lines(_plain(c), float(cell["size_pt"]), max(5.0, col_mm - 4) * df.PT_PER_MM)
                             for c in r), default=1)
                h += lines * self.line(cell) + 1.5  # 칸 위아래 테두리 · 여유
            cap = _plain(b.get("caption"))
            return dict(out, h=h + (self.text_height(S["body"], cap) + 6 if cap else 0))
        if t == "code":
            lines = str(b.get("text") or "").count("\n") + 1
            return dict(out, h=lines * 9.5 * float(S["body"]["line_spacing_pct"]) / 100)
        st = S["body"]
        if t == "title":
            st = S["title"]
        elif t == "heading":
            try:
                level = max(1, min(3, int(b.get("level") or 1)))
            except (TypeError, ValueError):
                level = 1
            st = S[f"headings.{level}"]
        elif t == "bib_heading":
            st = dict(S["headings.1"], page_break_before=bool(self.fmt["bibliography"]["new_page"]))
        elif t == "quote":
            st = S["quote"]
        elif t == "bib_entry":
            st = S["bibliography"]
        elif t == "list_item":  # 목록: 왼쪽 8mm + 단계마다 6mm, 첫 줄 내어쓰기(기호)
            try:
                depth = max(0, int(b.get("depth") or 0))
            except (TypeError, ValueError):
                depth = 0
            st = dict(st, indent_left=df.mm(8 + 6 * depth), indent_right=df.mm(0), first_line_indent=df.mm(0))
        if t == "bib_heading":
            text, notes = " ".join(str(b.get("text") or "참고문헌").split()), []
        else:
            text, notes = _runs_text(b.get("runs"))
            if t == "list_item":
                text = "• " + text  # 기호(번호)도 글 폭을 차지한다
        head = t in ("title", "heading", "bib_heading")
        return dict(out, h=self.para(st, text), notes=self.notes(notes), split=not head,
                    brk=bool(st.get("page_break_before")), head=head, before=float(st["space_before_pt"]))


FOOTNOTE_SEPARATOR_PT = 16.0  # 쪽마다 첫 각주 위 구분선 문단(한 줄 · 글자 크기 기본값)


def estimate_pages(parts: list[tuple[list[Block], bool]], fmt: dict) -> dict[int, int]:
    """[(블록들, 쪽 번호 있음)] → {id(블록): 쪽 번호}. 쪽 번호 있는 구역은 1쪽부터, 없는 구역의 블록은 빠진다.

    한 쪽에 블록을 위에서부터 쌓는다: 구역 · page_break · '새 쪽에서 시작' 모양은 쪽을 넘기고, 나눌 수 없는 것
    (그림 + 캡션)은 남은 자리가 모자라면 다음 쪽으로, 글은 첫 줄이 들어가면 이어서 다음 쪽으로 넘친다.
    제목은 '다음과 함께 두기'라 다음 것(글이면 첫 줄, 그림이면 통째)과 같이 들어가야 한다.
    각주는 그 쪽 아래를 차지한다(쪽마다 구분선 한 줄). 저절로 넘어간 쪽의 첫 문단은 '문단 위' 간격이 없다.
    워드 · LibreOffice 배치와 견준 어림값이다(tests/test_export_lists.py — LibreOffice로 그린 쪽과 비교)"""
    meas = _Measure(fmt)
    H = meas.height_pt
    out: dict[int, int] = {}
    one = meas.line(meas.S["body"])
    for blocks, numbered in parts:
        items = [b for b in blocks if isinstance(b, dict)]
        sizes = [None if b.get("type") == "page_break" else meas.block(b) for b in items]

        def need(i: int, depth: int = 0) -> float:
            """i번째 블록이 지금 쪽에서 시작하려면 필요한 높이 (제목은 다음 것과 함께)"""
            m = sizes[i]
            first = m["h"] if not m["split"] else min(m["h"], one)
            if not m["head"] or depth > 3:
                return first
            j = next((k for k in range(i + 1, len(items)) if sizes[k] is not None), None)
            if j is None or sizes[j]["brk"]:
                return first
            return m["h"] + need(j, depth + 1)

        page, y, pending, noted, natural = 1, 0.0, False, False, False
        for i, b in enumerate(items):
            m = sizes[i]
            if m is None:
                pending = True
                continue
            if (m["brk"] or pending) and y > 0:
                page, y, noted, natural = page + 1, 0.0, False, False
            pending = False
            notes = sum(m["notes"]) + (FOOTNOTE_SEPARATOR_PT if m["notes"] and not noted else 0.0)
            if y > 0 and y + need(i) + notes > H:
                page, y, noted, natural = page + 1, 0.0, False, True
                notes = sum(m["notes"]) + (FOOTNOTE_SEPARATOR_PT if m["notes"] else 0.0)
            if numbered:
                out[id(b)] = page
            noted = noted or bool(m["notes"])
            y += m["h"] + notes - (m["before"] if y == 0 and natural else 0.0)
            natural = False
            while y > H:
                y -= H
                page += 1
                noted, natural = False, True
    return out


def fill_pages(parts: list[tuple[list[Block], bool]], fmt: dict) -> None:
    """parts 안의 목록 블록(type=contents) 항목에 쪽 번호(어림값)를 채운다 — 번호 없는 구역의 항목은 None"""
    pages = estimate_pages(parts, fmt)
    for blocks, _ in parts:
        for b in blocks:
            if isinstance(b, dict) and b.get("type") == "contents":
                for e in b["entries"]:
                    e["page"] = pages.get(id(e["block"]))
