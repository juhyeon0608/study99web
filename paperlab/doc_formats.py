"""논문 양식(서식 프리셋): 데이터 구조·검증·기본 양식·단위 환산·표지 문구와 배치.

양식 데이터(JSON)는 docs/specs/doc-formats.md 4장 구조를 따른다.
여백은 한글(편집 용지)의 뜻으로 저장한다: 본문은 '위쪽 + 머리말' 아래에서 시작한다.
기본 양식 4개는 DB에 넣지 않고 이 파일에 둔다(읽기 전용).
"""

from __future__ import annotations

import copy
import math
import re
from typing import Any

SCHEMA_VERSION = 1
DEFAULT_ID = "default"

ALIGNS = ("left", "center", "right", "justify")
UNITS = ("ch", "mm", "pt")
PAGE_NUMBER_POSITIONS = ("footer-center", "footer-right", "header-center", "header-right")
PAGE_NUMBER_STARTS = ("document", "first_chapter")
COVER_KINDS = ("none", "thesis", "report")
TEXT_STYLE_KEYS = ("title", "headings.1", "headings.2", "headings.3", "quote", "footnote", "bibliography")

# 표지류에서 비어 있는 칸에 넣는 표시(안내문 표기 그대로)
BLANK_NAME = "○○○"
BLANK_DEPARTMENT = "○○○학과"
BLANK_DATE = "○○○○년 ○월"
BLANK_TITLE = "○○○"
BLANK_DEGREE_FIELD = "○○"  # 학위명(예: 공학)이 비면 "○○석사학위 논문"
FULL_SPACE = "　"
DASH = "–"


class FormatError(ValueError):
    """양식·표지 정보 검증 오류. 메시지는 '항목 경로: 안내 문구' 모양이다."""

    def __init__(self, path: str, message: str):
        super().__init__(f"{path}: {message}")
        self.path = path


# =================================================================== 단위 환산 (4.3)
PT_PER_MM = 72 / 25.4


def mm_to_hwp(mm: float) -> int:
    return round(mm * 7200 / 25.4)


def mm_to_twip(mm: float) -> int:
    return round(mm * 1440 / 25.4)


def pt_to_hwp(pt: float) -> int:
    return round(pt * 100)


def pt_to_twip(pt: float) -> int:
    return round(pt * 20)


def hwp_to_mm(value: float) -> float:
    return value * 25.4 / 7200


def twip_to_mm(value: float) -> float:
    return value * 25.4 / 1440


def length_pt(length: dict | None, size_pt: float) -> float:
    """Length → pt. ch는 그 문단의 글자 크기(pt) × 글자 수."""
    if not length:
        return 0.0
    value = float(length.get("value") or 0)
    if length.get("unit") == "ch":
        return value * size_pt
    if length.get("unit") == "pt":
        return value
    return value * PT_PER_MM


def mm(value: float) -> dict:
    return {"value": value, "unit": "mm"}


def ch(value: float) -> dict:
    return {"value": value, "unit": "ch"}


def pt(value: float) -> dict:
    return {"value": value, "unit": "pt"}


# =================================================================== 기본 양식 (5장)
def _style(size_pt: float, **kw) -> dict:
    """TextStyle 기본값(4.1)을 채운 글자·문단 모양."""
    out = {"fonts": None, "size_pt": size_pt, "bold": False, "italic": False, "align": "left",
           "line_spacing_pct": None, "space_before_pt": 0, "space_after_pt": 0,
           "indent_left": mm(0), "indent_right": mm(0), "first_line_indent": mm(0),
           "page_break_before": False}
    out.update(kw)
    return out


def _preset(*, page, fonts, body, title, headings, quote, footnote, bibliography, page_number, cover) -> dict:
    return {"schema": SCHEMA_VERSION, "page": page, "fonts": fonts, "body": body, "title": title,
            "headings": headings, "quote": quote, "footnote": footnote, "bibliography": bibliography,
            "page_number": page_number, "cover": cover}


def _page(w, h, top, bottom, left, right, header, footer) -> dict:
    return {"width_mm": w, "height_mm": h,
            "margin_mm": {"top": top, "bottom": bottom, "left": left, "right": right},
            "header_mm": header, "footer_mm": footer, "gutter_mm": 0}


def _fonts(hangul, latin=None, hanja=None) -> dict:
    return {"hangul": hangul, "latin": latin or hangul, "hanja": hanja or hangul}


def _bib(size_pt, hanging, new_page, **kw) -> dict:
    out = _style(size_pt, **kw)
    out.update(hanging_indent=hanging, new_page=new_page)
    return out


def _title(show, size_pt, **kw) -> dict:
    out = _style(size_pt, **kw)
    out["show"] = show
    return out


# ① 기본 (A4): 화면에 보여 주는 값 = 지금 워드 결과를 양식 구조로 옮긴 것.
#    실제 내보내기는 writer의 지금 코드 경로를 그대로 쓴다(5.1).
_DEFAULT = _preset(
    page=_page(210, 297, 12.7, 12.7, 30, 30, 12.3, 12.3),
    fonts=_fonts("바탕", "Times New Roman", "바탕"),
    body=_style(11, line_spacing_pct=160, space_after_pt=6),
    title=_title(True, 18, bold=True, align="center", space_after_pt=18),
    headings={"1": _style(14, bold=True, space_before_pt=14, space_after_pt=6),
              "2": _style(12, bold=True, space_before_pt=10, space_after_pt=6),
              "3": _style(11, bold=True, space_before_pt=10, space_after_pt=6)},
    quote=_style(11, indent_left=mm(10), indent_right=mm(10)),
    footnote=_style(9, line_spacing_pct=100),
    bibliography=_bib(11, mm(10), False),
    page_number={"show": False, "position": "footer-center", "start": "document", "dashes": False,
                 "distance_mm": None},
    cover={"kind": "none", "fonts": None, "bold": False},
)

# ② 영문 원고 (APA 7 학생 논문)
_APA = _preset(
    page=_page(210, 297, 12.7, 12.7, 25.4, 25.4, 12.7, 12.7),
    fonts=_fonts("바탕", "Times New Roman", "바탕"),
    body=_style(12, line_spacing_pct=200, first_line_indent=mm(12.7)),
    title=_title(True, 12, bold=True, align="center"),
    headings={"1": _style(12, bold=True, align="center"),
              "2": _style(12, bold=True),
              "3": _style(12, bold=True, italic=True)},
    quote=_style(12, line_spacing_pct=200, indent_left=mm(12.7)),
    footnote=_style(10, line_spacing_pct=100),
    bibliography=_bib(12, mm(12.7), True, line_spacing_pct=200),
    page_number={"show": True, "position": "header-right", "start": "document", "dashes": False,
                 "distance_mm": None},
    cover={"kind": "none", "fonts": None, "bold": False},
)

# ③ 인하대 제조혁신전문대학원 학위논문 (석사·박사)
#    인용문 '한 탭' = 한글 기본 탭 40pt ≈ 14.1mm (사용자 답변, 한글 4000 · 워드 800twip)
_THESIS = _preset(
    page=_page(188, 257, 15, 21, 24, 21, 5, 8),
    fonts=_fonts("휴먼명조"),
    body=_style(11, line_spacing_pct=180, align="justify", first_line_indent=ch(3)),
    title=_title(False, 16, bold=True, align="center", space_after_pt=12),
    headings={"1": _style(16, bold=True, align="center", space_after_pt=12, page_break_before=True),
              "2": _style(13, bold=True, space_before_pt=12, space_after_pt=6),
              "3": _style(11, bold=True, space_before_pt=6)},
    quote=_style(11, line_spacing_pct=160, align="justify", indent_left=pt(40)),
    footnote=_style(10, line_spacing_pct=140),
    bibliography=_bib(11, mm(10), True, line_spacing_pct=180, align="justify"),
    page_number={"show": True, "position": "footer-center", "start": "first_chapter", "dashes": False,
                 "distance_mm": None},
    cover={"kind": "thesis", "fonts": _fonts("HY신명조"), "bold": True},
)

# ④ 인하대 제조혁신전문대학원 석사학위논문 대체 보고서
#    "신명조"·"신명 세명조" = 한양신명조 (사용자 답변)
_REPORT = _preset(
    page=_page(210, 297, 40, 40, 30, 30, 15, 15),
    fonts=_fonts("휴먼명조", "한양신명조", "한양신명조"),
    body=_style(11, line_spacing_pct=180, align="justify", first_line_indent=ch(3)),
    title=_title(False, 16, bold=True, align="center", space_after_pt=12),
    headings={"1": _style(16, bold=True, align="center", space_after_pt=12, page_break_before=True),
              "2": _style(14, bold=True, space_before_pt=12, space_after_pt=6),
              "3": _style(11, bold=True, space_before_pt=6)},
    quote=_style(11, line_spacing_pct=180, align="justify", indent_left=pt(40)),
    footnote=_style(9, line_spacing_pct=140),
    bibliography=_bib(11, mm(10), True, line_spacing_pct=180, align="justify"),
    page_number={"show": True, "position": "footer-center", "start": "first_chapter", "dashes": False,
                 "distance_mm": None},
    cover={"kind": "report", "fonts": _fonts("휴먼명조"), "bold": True},
)

BUILTINS: dict[str, dict] = {
    "default": {"name": "기본 (A4)", "data": _DEFAULT,
                "description": "지금까지의 내보내기 서식 (A4, 바탕/Times New Roman 11pt)"},
    "apa7-student": {"name": "영문 원고 (APA 7 학생 논문)", "data": _APA,
                     "description": "A4, Times New Roman 12pt, 줄간격 200%, 오른쪽 위 쪽 번호"},
    "inha-mie-thesis": {"name": "인하대 제조혁신전문대학원 학위논문 (석사·박사)", "data": _THESIS,
                        "description": "188×257mm, 휴먼명조 11pt, 줄간격 180%"},
    "inha-mie-report": {"name": "인하대 제조혁신전문대학원 석사학위논문 대체 보고서", "data": _REPORT,
                        "description": "A4, 휴먼명조 11pt, 줄간격 180%, 앞표지·속표지·인준서"},
}


def is_builtin(format_id) -> bool:
    # 문자열이 아닌 값(객체·목록)은 dict 키 검사에서 TypeError가 나므로 먼저 거른다
    return isinstance(format_id, str) and format_id in BUILTINS


def builtin_data(format_id: str) -> dict:
    return copy.deepcopy(BUILTINS[format_id]["data"])


def builtin_entry(format_id: str) -> dict:
    b = BUILTINS[format_id]
    return {"id": format_id, "name": b["name"], "builtin": True, "base": None,
            "cover_kind": b["data"]["cover"]["kind"], "description": b["description"], "updated_at": None}


# =================================================================== 병합·검증
def merge(base: dict, data: dict) -> dict:
    """빠진 항목을 base 값으로 채운다. base에 없는 키(알 수 없는 항목)는 버린다."""
    out = copy.deepcopy(base)
    if not isinstance(data, dict):
        return out
    for key, value in data.items():
        if key not in out:
            continue
        if isinstance(out[key], dict) and isinstance(value, dict):
            out[key] = merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    # base가 null인 자리(TextStyle.fonts 등)에 객체가 오면 그대로 받는다
    return out


def _num(value, path: str, lo: float, hi: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or math.isnan(value):
        raise FormatError(path, "숫자를 입력해 주세요")
    if not lo <= value <= hi:
        raise FormatError(path, f"{lo:g}~{hi:g} 사이로 입력해 주세요")
    return value


def _bool(value, path: str) -> bool:
    if not isinstance(value, bool):
        raise FormatError(path, "true 또는 false로 입력해 주세요")
    return value


def _choice(value, path: str, choices: tuple) -> str:
    if value not in choices:
        raise FormatError(path, f"{', '.join(choices)} 중 하나로 입력해 주세요")
    return value


# 길이 범위(팀장 결정): 여백·머리말·꼬리말·문단 간격 0~100mm, 들여쓰기·내어쓰기 -50~100mm.
# pt·ch 값은 mm로 환산한 뒤 같은 범위로 검사한다(ch = 그 문단 글자 크기 × 글자 수).
INDENT_MM_RANGE = (-50, 100)
SPACE_MM_RANGE = (0, 100)


def _length(value, path: str, size_pt: float) -> dict:
    if not isinstance(value, dict):
        raise FormatError(path, '{"value": 숫자, "unit": "ch"·"mm"·"pt"} 모양으로 입력해 주세요')
    unit = _choice(value.get("unit"), f"{path}.unit", UNITS)
    v = _num(value.get("value"), f"{path}.value", -1e6, 1e6)
    as_mm = length_pt({"value": v, "unit": unit}, size_pt) / PT_PER_MM
    lo, hi = INDENT_MM_RANGE
    if not lo - 1e-9 <= as_mm <= hi + 1e-9:
        extra = f" (지금 {as_mm:.1f}mm)" if unit != "mm" else ""
        raise FormatError(path, f"{lo}~{hi}mm 사이로 입력해 주세요{extra}")
    return {"value": v, "unit": unit}


def _space_pt(value, path: str) -> float:
    """문단 위·아래 간격(pt): mm로 환산해 0~100mm."""
    v = _num(value, path, -1e6, 1e6)
    lo, hi = SPACE_MM_RANGE
    if not lo <= v / PT_PER_MM <= hi + 1e-9:
        raise FormatError(path, f"{lo}~{hi}mm({hi * PT_PER_MM:.0f}pt) 사이로 입력해 주세요")
    return v


def _font_set(value, path: str) -> dict:
    if not isinstance(value, dict):
        raise FormatError(path, "한글·영문·한자 글꼴을 입력해 주세요")
    out = {}
    for lang in ("hangul", "latin", "hanja"):
        name = value.get(lang)
        if not isinstance(name, str) or not name.strip():
            raise FormatError(f"{path}.{lang}", "글꼴 이름을 입력해 주세요")
        if len(name.strip()) > 60:
            raise FormatError(f"{path}.{lang}", "글꼴 이름은 60자 이하로 입력해 주세요")
        out[lang] = name.strip()
    return out


def _text_style(value, path: str, *, need_line: bool = False) -> dict:
    if not isinstance(value, dict):
        raise FormatError(path, "객체여야 해요")
    out = dict(value)
    out["fonts"] = None if value.get("fonts") is None else _font_set(value.get("fonts"), f"{path}.fonts")
    out["size_pt"] = _num(value.get("size_pt"), f"{path}.size_pt", 5, 72)
    for key in ("bold", "italic", "page_break_before"):
        out[key] = _bool(value.get(key), f"{path}.{key}")
    out["align"] = _choice(value.get("align"), f"{path}.align", ALIGNS)
    line = value.get("line_spacing_pct")
    if line is None and need_line:
        raise FormatError(f"{path}.line_spacing_pct", "줄간격(%)을 입력해 주세요")
    out["line_spacing_pct"] = None if line is None else _num(line, f"{path}.line_spacing_pct", 50, 500)
    for key in ("space_before_pt", "space_after_pt"):
        out[key] = _space_pt(value.get(key), f"{path}.{key}")
    for key in ("indent_left", "indent_right", "first_line_indent"):
        out[key] = _length(value.get(key), f"{path}.{key}", out["size_pt"])
    return out


def validate(data: dict) -> dict:
    """완전한 양식 데이터(병합 뒤)를 검증하고 정리해서 돌려준다. 틀리면 FormatError."""
    if not isinstance(data, dict):
        raise FormatError("data", "객체여야 해요")
    out: dict[str, Any] = {"schema": SCHEMA_VERSION}

    page = data.get("page")
    if not isinstance(page, dict) or not isinstance(page.get("margin_mm"), dict):
        raise FormatError("page", "용지·여백을 입력해 주세요")
    p = {"width_mm": _num(page.get("width_mm"), "page.width_mm", 50, 500),
         "height_mm": _num(page.get("height_mm"), "page.height_mm", 50, 500),
         "margin_mm": {side: _num(page["margin_mm"].get(side), f"page.margin_mm.{side}", 0, 100)
                       for side in ("top", "bottom", "left", "right")},
         "header_mm": _num(page.get("header_mm"), "page.header_mm", 0, 100),
         "footer_mm": _num(page.get("footer_mm"), "page.footer_mm", 0, 100),
         "gutter_mm": 0}  # 제본 여백은 범위 밖: 항상 0
    m = p["margin_mm"]
    if p["width_mm"] - m["left"] - m["right"] < 20:
        raise FormatError("page.margin_mm", "왼쪽·오른쪽 여백이 너무 커서 본문 폭이 20mm보다 좁아요")
    if p["height_mm"] - m["top"] - m["bottom"] - p["header_mm"] - p["footer_mm"] < 20:
        raise FormatError("page.margin_mm", "위·아래 여백이 너무 커서 본문 높이가 20mm보다 낮아요")
    out["page"] = p

    out["fonts"] = _font_set(data.get("fonts"), "fonts")
    out["body"] = _text_style(data.get("body"), "body", need_line=True)
    out["title"] = _text_style(data.get("title"), "title")
    out["title"]["show"] = _bool((data.get("title") or {}).get("show"), "title.show")
    headings = data.get("headings")
    if not isinstance(headings, dict):
        raise FormatError("headings", "제목 1~3수준을 입력해 주세요")
    out["headings"] = {lv: _text_style(headings.get(lv), f"headings.{lv}") for lv in ("1", "2", "3")}
    out["quote"] = _text_style(data.get("quote"), "quote")
    out["footnote"] = _text_style(data.get("footnote"), "footnote")
    bib = data.get("bibliography")
    out["bibliography"] = _text_style(bib, "bibliography")
    out["bibliography"]["hanging_indent"] = _length(bib.get("hanging_indent"), "bibliography.hanging_indent",
                                                    out["bibliography"]["size_pt"])
    out["bibliography"]["new_page"] = _bool(bib.get("new_page"), "bibliography.new_page")

    pn = data.get("page_number")
    if not isinstance(pn, dict):
        raise FormatError("page_number", "객체여야 해요")
    out["page_number"] = {
        "show": _bool(pn.get("show"), "page_number.show"),
        "position": _choice(pn.get("position"), "page_number.position", PAGE_NUMBER_POSITIONS),
        "start": _choice(pn.get("start"), "page_number.start", PAGE_NUMBER_STARTS),
        "dashes": _bool(pn.get("dashes"), "page_number.dashes"),
        # null = 꼬리말(머리말) 영역 안 기본 위치, 숫자 = 용지 아래(위) 끝에서 쪽 번호 줄까지 거리
        "distance_mm": None if pn.get("distance_mm") is None else _num(
            pn.get("distance_mm"), "page_number.distance_mm", 0, 100),
    }
    cover = data.get("cover")
    if not isinstance(cover, dict):
        raise FormatError("cover", "객체여야 해요")
    out["cover"] = {
        "kind": _choice(cover.get("kind"), "cover.kind", COVER_KINDS),
        "fonts": None if cover.get("fonts") is None else _font_set(cover.get("fonts"), "cover.fonts"),
        "bold": _bool(cover.get("bold"), "cover.bold"),
    }
    # TextStyle에 섞여 온 알 수 없는 키는 버린다
    allowed = set(_style(10)) | {"show", "hanging_indent", "new_page"}
    for key in ("body", "title", "quote", "footnote", "bibliography"):
        out[key] = {k: v for k, v in out[key].items() if k in allowed}
    out["headings"] = {lv: {k: v for k, v in st.items() if k in allowed} for lv, st in out["headings"].items()}
    return out


def normalize(data: dict | None, base: str = DEFAULT_ID) -> dict:
    """base 기본 양식 값으로 빈 항목을 채우고 검증한다."""
    if base not in BUILTINS:
        raise FormatError("base", "기본 양식 id가 아니에요")
    if data is not None and not isinstance(data, dict):
        raise FormatError("data", "객체여야 해요")
    return validate(merge(BUILTINS[base]["data"], data or {}))


def get_path(data: dict, path: str):
    cur: Any = data
    for part in path.split("."):
        cur = cur[part]
    return cur


def resolve_style(data: dict, key: str) -> dict:
    """양식의 글자·문단 모양 하나를 실제 적용값으로 푼다(글꼴·줄간격 null → 양식·본문 값)."""
    st = copy.deepcopy(get_path(data, key))
    st["fonts"] = st.get("fonts") or copy.deepcopy(data["fonts"])
    if st.get("line_spacing_pct") is None:
        st["line_spacing_pct"] = data["body"]["line_spacing_pct"]
    return st


# =================================================================== 표지 정보 (6.1)
COVER_DEFAULTS: dict[str, Any] = {
    "degree": "master", "degree_field": "", "title_ko": "", "title_en": "", "subtitle": "",
    "graduation": "", "approval": "", "school": "인하대학교 제조혁신전문대학원", "department": "",
    "name": "", "spaced_name": True, "advisors": [], "committee": [],
    "include": {"front": True, "inner": True, "approval": True},
}
_COVER_TEXT_KEYS = ("degree_field", "title_ko", "title_en", "subtitle", "school", "department", "name")
_YM = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def validate_cover(cover: Any) -> dict:
    """표지 정보 검증. 보낸 항목만 정리해서 돌려준다(알 수 없는 키는 버림)."""
    if not isinstance(cover, dict):
        raise FormatError("cover", "객체여야 해요")
    out: dict[str, Any] = {}
    for key, value in cover.items():
        path = f"cover.{key}"
        if key == "degree":
            out[key] = _choice(value, path, ("master", "doctor"))
        elif key in _COVER_TEXT_KEYS:
            if not isinstance(value, str):
                raise FormatError(path, "글자로 입력해 주세요")
            if len(value) > 300:
                raise FormatError(path, "300자 이하로 입력해 주세요")
            out[key] = value
        elif key in ("graduation", "approval"):
            if not isinstance(value, str) or (value and not _YM.match(value)):
                raise FormatError(path, "YYYY-MM 모양(월 01~12)으로 입력해 주세요")
            out[key] = value
        elif key == "spaced_name":
            out[key] = _bool(value, path)
        elif key in ("advisors", "committee"):
            if not isinstance(value, list) or not all(isinstance(v, str) and len(v) <= 100 for v in value):
                raise FormatError(path, "이름 목록으로 입력해 주세요")
            out[key] = list(value)
        elif key == "include":
            if not isinstance(value, dict):
                raise FormatError(path, "객체여야 해요")
            out[key] = {k: _bool(value[k], f"{path}.{k}") for k in ("front", "inner", "approval") if k in value}
    if len(out.get("advisors", [])) > 2:
        raise FormatError("cover.advisors", "지도교수는 1명 또는 2명(공동지도)이에요")
    limit = 5 if out.get("degree", "master") == "doctor" else 3
    if len(out.get("committee", [])) > limit:
        raise FormatError("cover.committee", f"심사위원은 석사 3명, 박사 5명이에요 (지금 {len(out['committee'])}명)")
    return out


def cover_with_defaults(cover: dict | None) -> dict:
    out = copy.deepcopy(COVER_DEFAULTS)
    for key, value in (cover or {}).items():
        if key == "include" and isinstance(value, dict):
            out["include"].update(value)
        elif key in out:
            out[key] = value
    return out


def spaced(name: str, enabled: bool = True) -> str:
    """'김인하' → '김 인 하'. 공백 없는 한글 2~5글자일 때만."""
    if enabled and re.fullmatch(r"[가-힣]{2,5}", name or ""):
        return " ".join(name)
    return name


def ym_text(value: str) -> str:
    """'2027-02' → '2027년 2월'. 비면 '○○○○년 ○월'."""
    if value and _YM.match(value):
        y, m = value.split("-")
        return f"{y}년 {int(m)}월"
    return BLANK_DATE


def approval_ym(cover: dict) -> str:
    """인정(인준) 연월. 비우면 2월 졸업 → 전년 12월, 8월 졸업 → 같은 해 6월."""
    if cover.get("approval"):
        return cover["approval"]
    grad = cover.get("graduation") or ""
    if _YM.match(grad):
        y, m = int(grad[:4]), int(grad[5:])
        if m == 2:
            return f"{y - 1}-12"
        if m == 8:
            return f"{y}-06"
    return ""


def missing_cover_fields(cover: dict, kind: str = "thesis") -> list[str]:
    """표지 필수 항목(이름·학과·졸업 연월·영문 제목, 학위논문은 학위명) 중 빈 것. 빈 칸은 ○ 표시로 들어간다."""
    keys = ("name", "department", "graduation", "title_en") + (("degree_field",) if kind == "thesis" else ())
    return [k for k in keys if not str(cover.get(k) or "").strip()]


# =================================================================== 표지 문구·배치 (6.2~6.4)
# 표지 한 줄: (문구, 글자 크기 pt, 위치). 위치 = ("top", mm) · ("gap", mm) · ("fill",)
COVER_MARGIN_LR_MM = {"thesis": 25, "report": 30}
COVER_LINE_HEIGHT = 1.2  # 줄 높이 = 글자 크기 × 1.2


def _committee_lines(cover: dict, count: int, size: float) -> list[tuple[str, float]]:
    titles = ["주심", "부심"] + ["위원"] * (count - 2)
    names = list(cover.get("committee") or [])
    out = []
    for i, title in enumerate(titles):
        name = (names[i] if i < len(names) else "").strip()
        shown = spaced(name, cover.get("spaced_name", True)) if name else FULL_SPACE * 6
        out.append((f"{title}{FULL_SPACE * 2}{shown}{FULL_SPACE * 2}(인)", size))
    return out


def _advisor_lines(cover: dict, size: float, space_names: bool) -> list[tuple[str, float]]:
    advisors = [a.strip() for a in cover.get("advisors") or [] if a.strip()]
    show = (lambda n: spaced(n, cover.get("spaced_name", True))) if space_names else (lambda n: n)
    if len(advisors) >= 2:
        return [(f"공동지도교수 {show(advisors[0])}", size), (f"공동지도교수 {show(advisors[1])}", size)]
    return [(f"지도교수 {show(advisors[0]) if advisors else BLANK_NAME}", size)]


def cover_pages(kind: str, cover: dict | None, title_fallback: str = "") -> list[dict]:
    """표지류 쪽 목록. 각 쪽 = {"key", "margin_lr_mm", "bottom_mm", "lines": [{"text","size","pos"}]}.

    pos: ("top", mm) 용지 위 끝 → 첫 줄 위, ("gap", mm) 앞 줄 아래 → 이 줄 위, ("fill",) 남는 높이 나눔.
    bottom_mm: 마지막 줄 아래 → 용지 아래 끝 (모두 고정 간격인 쪽은 None).
    """
    if kind not in ("thesis", "report"):
        return []
    c = cover_with_defaults(cover)
    name = c["name"].strip()
    name_spaced = spaced(name, c["spaced_name"]) if name else BLANK_NAME
    name_plain = name or BLANK_NAME
    dept = c["department"].strip() or BLANK_DEPARTMENT
    school = c["school"].strip() or COVER_DEFAULTS["school"]
    title_ko = c["title_ko"].strip() or (title_fallback or "").strip() or BLANK_TITLE
    title_en = c["title_en"].strip() or BLANK_TITLE
    subtitle = c["subtitle"].strip()
    grad = ym_text(c["graduation"])
    approval = ym_text(approval_ym(c))
    include = c["include"]
    pages: list[dict] = []

    def line(text, size, *pos):
        return {"text": text, "size": size, "pos": pos}

    if kind == "thesis":
        doctor = c["degree"] == "doctor"
        degree = f"{c['degree_field'].strip() or BLANK_DEGREE_FIELD}{'박사' if doctor else '석사'}"
        head = [line(f"{degree}학위 논문", 14, "top", 40), line(title_ko, 16, "gap", 20)]
        if subtitle:
            head.append(line(f"{DASH} {subtitle} {DASH}", 14, "gap", 3))
        head += [line(title_en, 16, "gap", 10), line(grad, 14, "gap", 25)]
        tail = [line(school, 14, "fill"), line(dept, 14, "gap", 10), line(name_spaced, 14, "gap", 10)]
        if include.get("front", True):
            pages.append({"key": "front", "lines": head + tail})
        if include.get("inner", True):
            adv = _advisor_lines(c, 16, True)
            mid = [line(adv[0][0], 16, "fill")] + [line(t, s, "gap", 0) for t, s in adv[1:]]
            mid.append(line(f"이 논문을 {degree}학위 논문으로 제출함", 14, "gap", 10))
            pages.append({"key": "inner", "lines": head + mid + tail})
        if include.get("approval", True):
            lines = [line(f"이 논문을 {name_plain}의 {degree}학위논문으로 인정함.", 14, "top", 50),
                     line(approval, 14, "gap", 15)]
            for i, (text, size) in enumerate(_committee_lines(c, 5 if doctor else 3, 14)):
                lines.append(line(text, size, "gap", 25 if i == 0 else 15))
            pages.append({"key": "approval", "lines": lines})
        for p in pages:
            p["margin_lr_mm"] = COVER_MARGIN_LR_MM["thesis"]
            p["bottom_mm"] = None if p["key"] == "approval" else 40
        return pages

    # 대체 보고서: 학위는 항상 석사
    head = [line("석사학위 연구보고서", 16, "top", 55), line(title_ko, 22, "gap", 20)]
    if subtitle:
        head.append(line(f"{DASH} {subtitle} {DASH}", 14, "gap", 3))
    head.append(line(title_en, 16, "fill"))
    tail = [line(dept, 16, "gap", 10), line(name_spaced, 16, "gap", 10)]
    if include.get("front", True):
        pages.append({"key": "front", "lines": head + [line(grad, 16, "fill"), line(school, 16, "gap", 40)] + tail})
    if include.get("inner", True):
        adv = _advisor_lines(c, 16, False)
        mid = [line(adv[0][0], 16, "fill")] + [line(t, s, "gap", 0) for t, s in adv[1:]]
        mid += [line("이 보고서를 석사학위 연구보고서로 제출함", 16, "gap", 20), line(grad, 16, "gap", 10),
                line(school, 16, "gap", 20)]
        pages.append({"key": "inner", "lines": head + mid + tail})
    if include.get("approval", True):
        lines = [line(f"이 보고서를 {name_plain}의 석사학위 연구보고서로 인정함", 22, "top", 70),
                 line(approval, 16, "gap", 30)]
        lines += [line(text, size, "gap", 30) for text, size in _committee_lines(c, 3, 16)]
        pages.append({"key": "approval", "lines": lines})
    for p in pages:
        p["margin_lr_mm"] = COVER_MARGIN_LR_MM["report"]
        p["bottom_mm"] = None if p["key"] == "approval" else 55
    return pages


def estimate_lines(text: str, size_pt: float, width_mm: float) -> int:
    """줄 수 추정: 한글·한자·전각 = 크기 × 1.0, 영문·숫자·기호 = × 0.55, 공백 = × 0.3."""
    total = 0.0
    for chr_ in text or "":
        if chr_ == " ":
            total += 0.3
        elif ord(chr_) >= 0x1100 and not (0x2000 <= ord(chr_) <= 0x206F):
            total += 1.0
        else:
            total += 0.55
    width_pt = max(width_mm, 1) * PT_PER_MM
    return max(1, math.ceil(total * size_pt / width_pt - 1e-9))


def layout_cover_page(page: dict, width_mm: float, height_mm: float) -> dict:
    """쪽 안의 줄 위치를 계산한다(6.2). 결과 줄마다 space_before_mm(첫 줄은 0)와 줄 수.

    반환: {"top_mm": 첫 줄 위 위치, "lines": [...], "overflow": bool}
    """
    usable_w = width_mm - page["margin_lr_mm"] * 2
    lines = []
    for ln in page["lines"]:
        n = estimate_lines(ln["text"], ln["size"], usable_w)
        lines.append(dict(ln, n_lines=n, height_mm=n * ln["size"] * COVER_LINE_HEIGHT / PT_PER_MM))
    top = float(lines[0]["pos"][1]) if lines and lines[0]["pos"][0] == "top" else 0.0
    fixed = top + sum(ln["height_mm"] for ln in lines) + sum(
        float(ln["pos"][1]) for ln in lines[1:] if ln["pos"][0] == "gap")
    fills = [ln for ln in lines[1:] if ln["pos"][0] == "fill"]
    overflow = False
    fill_each = 0.0
    if page.get("bottom_mm") is not None:
        room = height_mm - page["bottom_mm"] - fixed
        if fills:
            fill_each = room / len(fills)
        if room < 0:
            overflow, fill_each = True, 0.0
    elif fixed > height_mm:
        overflow = True
    for i, ln in enumerate(lines):
        kind = ln["pos"][0]
        ln["space_before_mm"] = 0.0 if i == 0 else (fill_each if kind == "fill" else float(ln["pos"][1]))
    return {"top_mm": top, "lines": lines, "overflow": overflow}
