"""양식 파일(.docx · .dotx · .hwpx)에서 서식을 읽어 양식 데이터로 만든다 (명세 8장).

결과는 저장하지 않은 양식이다. 못 읽은 항목은 base 기본 양식 값으로 채우고 missing에 적는다.
반올림: mm 0.1, pt 0.5, % 정수.
"""

from __future__ import annotations

import copy
import io
import zipfile
import xml.etree.ElementTree as ET
from pathlib import PurePath

from . import doc_formats as df

MAX_BYTES = 20 * 1024 * 1024
MAX_PART_BYTES = 50 * 1024 * 1024    # 압축을 푼 한 부분의 최대 크기(압축 폭탄 방지)
MAX_UNPACKED_BYTES = 200 * 1024 * 1024  # 압축을 푼 전체 크기
WRONG_KIND = "워드는 .docx나 .dotx로, 한글은 .hwpx로 저장해서 올려 주세요"

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
HH = "{http://www.hancom.co.kr/hwpml/2011/head}"
HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"
HC = "{http://www.hancom.co.kr/hwpml/2011/core}"

SECTIONS = ("title", "headings.1", "headings.2", "headings.3", "quote", "footnote", "bibliography")
DOCX_STYLE_NAMES = {"body": "normal", "title": "title", "headings.1": "heading 1", "headings.2": "heading 2",
                    "headings.3": "heading 3", "quote": "quote", "footnote": "footnote text",
                    "bibliography": "bibliography"}
HWPX_STYLE_NAMES = {"body": ("Normal", "바탕글"), "headings.1": ("Outline 1", "개요 1"),
                    "headings.2": ("Outline 2", "개요 2"), "headings.3": ("Outline 3", "개요 3"),
                    "footnote": ("Footnote", "각주")}
# 각주는 크기·줄간격만 쓴다(4.2)
FOOTNOTE_FIELDS = ("size_pt", "line_spacing_pct")


class FormatImportError(ValueError):
    pass


def r_mm(v: float) -> float:
    return round(v, 1)


def r_pt(v: float) -> float:
    return round(v * 2) / 2


def _num(text) -> float | None:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _length_from(mm_value: float, size_pt: float) -> dict:
    """mm 길이가 글자 크기의 정수배면 글자 수(ch)로, 아니면 mm로."""
    if size_pt:
        chars = mm_value * df.PT_PER_MM / size_pt
        if abs(chars - round(chars)) < 0.02 and round(chars) != 0:
            return df.ch(round(chars))
    return df.mm(r_mm(mm_value))


class _Result:
    def __init__(self, base: str):
        self.base = base
        self.data = df.builtin_data(base)
        self.found: list[str] = []
        self.missing: list[str] = []
        self.warnings: list[str] = []
        self.approx: dict[str, list[str]] = {}  # 줄간격 근사: 종류 → 스타일 이름

    def put(self, path: str, value) -> None:
        cur = self.data
        parts = path.split(".")
        for p in parts[:-1]:
            cur = cur[p]
        cur[parts[-1]] = value
        if path not in self.found:
            self.found.append(path)

    def miss(self, path: str) -> None:
        if path not in self.missing:
            self.missing.append(path)

    def finish(self) -> dict:
        for kind, labels in self.approx.items():
            self.warnings.insert(0, f"{'·'.join(labels)} 스타일 줄간격이 '{kind}'라 %로 바꿔 근사했어요")
        # 범위를 벗어난 값은 base 값으로 되돌리고 경고한다
        base = df.builtin_data(self.base)
        for _ in range(100):
            try:
                self.data = df.normalize(self.data, self.base)
                break
            except df.FormatError as e:
                path = _owning_path(self.data, e.path)
                cur, ref = self.data, base
                parts = path.split(".")
                for p in parts[:-1]:
                    cur, ref = cur[p], ref[p]
                cur[parts[-1]] = copy.deepcopy(ref[parts[-1]])
                self.found = [f for f in self.found if not (f == path or f.startswith(path + "."))]
                self.miss(path)
                self.warnings.append(f"{e} — 기본값을 썼어요")
        else:  # pragma: no cover - 방어용
            self.data = df.builtin_data(self.base)
        return {"base": self.base, "data": self.data, "found": self.found, "missing": self.missing,
                "warnings": self.warnings}


def _owning_path(data: dict, path: str) -> str:
    """오류 경로(예: body.first_line_indent.value)에서 되돌릴 항목 경로를 찾는다."""
    parts = path.split(".")
    while parts:
        cur = data
        try:
            for p in parts:
                cur = cur[p]
        except (KeyError, TypeError):
            parts = parts[:-1]
            continue
        if parts[-1] in ("value", "unit") and len(parts) > 1:
            return ".".join(parts[:-1])
        return ".".join(parts)
    return path.split(".")[0]


def import_format(filename: str, raw: bytes, base: str = df.DEFAULT_ID) -> dict:
    """양식 파일 → {"source", "suggested_name", "base", "data", "found", "missing", "warnings"}."""
    if base not in df.BUILTINS:
        raise FormatImportError("base는 기본 양식 id여야 해요")
    name = filename or "양식"
    ext = PurePath(name).suffix.lower()
    if ext not in (".docx", ".dotx", ".hwpx"):
        raise FormatImportError(WRONG_KIND)
    if len(raw) > MAX_BYTES:
        raise FormatImportError("파일이 너무 커요 (20MB 초과)")
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except (zipfile.BadZipFile, EOFError, ValueError, OSError) as e:
        raise FormatImportError(f"파일을 열 수 없어요. 손상되었거나 {WRONG_KIND}") from e
    # 압축을 풀기(testzip) 전에 목록의 크기로 압축 폭탄을 거른다
    infos = zf.infolist()
    if any(i.file_size > MAX_PART_BYTES for i in infos) or sum(i.file_size for i in infos) > MAX_UNPACKED_BYTES:
        zf.close()
        raise FormatImportError("파일 안의 내용이 너무 커요")
    try:
        if zf.testzip() is not None:
            raise zipfile.BadZipFile("CRC")
    except (zipfile.BadZipFile, EOFError, ValueError, OSError) as e:
        zf.close()
        raise FormatImportError(f"파일을 열 수 없어요. 손상되었거나 {WRONG_KIND}") from e
    kind = "hwpx" if ext == ".hwpx" else "docx"
    try:
        with zf:
            result = _read_hwpx(zf, base) if kind == "hwpx" else _read_docx(zf, base)
    except FormatImportError:
        raise
    except (KeyError, ET.ParseError, ValueError) as e:
        raise FormatImportError(f"양식 파일을 읽지 못했어요. {WRONG_KIND}") from e
    stem = PurePath(name).stem.strip()[:60] or "가져온 양식"
    out = {"source": {"kind": kind, "filename": name}, "suggested_name": stem}
    out.update(result.finish())
    return out


def _xml(zf: zipfile.ZipFile, name: str) -> ET.Element | None:
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > MAX_PART_BYTES:
        raise FormatImportError("파일 안의 내용이 너무 커요")
    return ET.fromstring(zf.read(info))


# =================================================================== DOCX / DOTX
def _on(el: ET.Element | None) -> bool | None:
    if el is None:
        return None
    return el.get(f"{W}val", "true").lower() not in ("0", "false", "off")


class _DocxStyles:
    def __init__(self, styles: ET.Element, theme: ET.Element | None):
        self.by_id = {}
        self.by_name = {}
        for st in styles.findall(f"{W}style"):
            if st.get(f"{W}type") != "paragraph":
                continue
            sid = st.get(f"{W}styleId")
            self.by_id[sid] = st
            name_el = st.find(f"{W}name")
            if name_el is not None:
                self.by_name[name_el.get(f"{W}val", "").lower()] = sid
            if st.get(f"{W}default") in ("1", "true") and "normal" not in self.by_name:
                self.by_name["normal"] = sid
        defaults = styles.find(f"{W}docDefaults")
        self.default_rpr = defaults.find(f"{W}rPrDefault/{W}rPr") if defaults is not None else None
        self.default_ppr = defaults.find(f"{W}pPrDefault/{W}pPr") if defaults is not None else None
        self.theme = theme

    def chain(self, sid: str) -> list[ET.Element]:
        out, seen = [], set()
        while sid and sid in self.by_id and sid not in seen:
            seen.add(sid)
            st = self.by_id[sid]
            out.append(st)
            based = st.find(f"{W}basedOn")
            sid = based.get(f"{W}val") if based is not None else None
        return list(reversed(out))

    def props(self, sid: str) -> dict:
        """docDefaults → basedOn 사슬 → 스타일 순서로 덮어쓴 실제 값."""
        p: dict = {}
        pprs = [self.default_ppr] + [st.find(f"{W}pPr") for st in self.chain(sid)]
        rprs = [self.default_rpr] + [st.find(f"{W}rPr") for st in self.chain(sid)]
        for ppr in pprs:
            if ppr is None:
                continue
            for tag in ("spacing", "ind"):
                el = ppr.find(f"{W}{tag}")
                if el is not None:
                    if tag == "ind":
                        # 들여쓰기는 한 덩어리로 덮어쓴다(firstLine과 hanging이 섞이지 않게)
                        p = {k: v for k, v in p.items() if not k.startswith("ind.")}
                    for k, v in el.attrib.items():
                        p[f"{tag}.{k.split('}')[-1]}"] = v
            jc = ppr.find(f"{W}jc")
            if jc is not None:
                p["jc"] = jc.get(f"{W}val")
            pb = _on(ppr.find(f"{W}pageBreakBefore"))
            if pb is not None:
                p["pageBreakBefore"] = pb
        for rpr in rprs:
            if rpr is None:
                continue
            rf = rpr.find(f"{W}rFonts")
            if rf is not None:
                for k, v in rf.attrib.items():
                    p[f"rFonts.{k.split('}')[-1]}"] = v
            sz = rpr.find(f"{W}sz")
            if sz is not None:
                p["sz"] = sz.get(f"{W}val")
            for tag in ("b", "i"):
                v = _on(rpr.find(f"{W}{tag}"))
                if v is not None:
                    p[tag] = v
        return p

    def theme_font(self, theme_name: str | None, east_asia: bool) -> str | None:
        if not theme_name or self.theme is None:
            return None
        which = "majorFont" if theme_name.startswith("major") else "minorFont"
        group = self.theme.find(f".//{A}{which}")
        if group is None:
            return None
        if east_asia:
            for f in group.findall(f"{A}font"):
                if f.get("script") == "Hang" and f.get("typeface"):
                    return f.get("typeface")
            ea = group.find(f"{A}ea")
            return ea.get("typeface") if ea is not None and ea.get("typeface") else None
        latin = group.find(f"{A}latin")
        return latin.get("typeface") if latin is not None and latin.get("typeface") else None


def _docx_fonts(st: _DocxStyles, p: dict) -> dict:
    hangul = p.get("rFonts.eastAsia") or st.theme_font(p.get("rFonts.eastAsiaTheme"), True)
    latin = p.get("rFonts.ascii") or st.theme_font(p.get("rFonts.asciiTheme"), False)
    return {"hangul": hangul, "latin": latin, "hanja": hangul}


def _docx_style_values(p: dict, res: _Result, label: str) -> dict:
    """스타일 속성 → TextStyle 값."""
    size = (_num(p.get("sz")) or 20) / 2  # 워드 기본 10pt
    out = {"size_pt": r_pt(size), "bold": bool(p.get("b")), "italic": bool(p.get("i")),
           "page_break_before": bool(p.get("pageBreakBefore"))}
    jc = (p.get("jc") or "left").lower()
    out["align"] = {"both": "justify", "distribute": "justify", "center": "center", "right": "right",
                    "end": "right"}.get(jc, "left")
    line, rule = _num(p.get("spacing.line")), (p.get("spacing.lineRule") or "auto")
    if line is None:
        out["line_spacing_pct"] = 100
    elif rule == "auto":
        # 배수: 워드 1배는 한글 %와 뜻이 달라 근사값 + 경고
        out["line_spacing_pct"] = round(line / 240 * 100)
        res.approx.setdefault("배수", []).append(label)
    else:
        # 고정값 = 글자 크기 × % (4.3 역변환), 최소는 같은 계산 + 경고
        out["line_spacing_pct"] = round(line / 20 / size * 100)
        if rule == "atLeast":
            res.approx.setdefault("최소", []).append(label)
    out["space_before_pt"] = r_pt((_num(p.get("spacing.before")) or 0) / 20)
    out["space_after_pt"] = r_pt((_num(p.get("spacing.after")) or 0) / 20)
    if _num(p.get("ind.firstLineChars")):
        out["first_line_indent"] = df.ch(round(_num(p["ind.firstLineChars"]) / 100, 2))
    elif _num(p.get("ind.hangingChars")):
        out["first_line_indent"] = df.ch(-round(_num(p["ind.hangingChars"]) / 100, 2))
    elif _num(p.get("ind.hanging")):
        out["first_line_indent"] = _length_from(-df.twip_to_mm(_num(p["ind.hanging"])), size)
    else:
        out["first_line_indent"] = _length_from(df.twip_to_mm(_num(p.get("ind.firstLine")) or 0), size)
    left = _num(p.get("ind.left")) if p.get("ind.left") is not None else _num(p.get("ind.start"))
    right = _num(p.get("ind.right")) if p.get("ind.right") is not None else _num(p.get("ind.end"))
    out["indent_left"] = df.mm(r_mm(df.twip_to_mm(left or 0)))
    out["indent_right"] = df.mm(r_mm(df.twip_to_mm(right or 0)))
    return out


def _put_style(res: _Result, key: str, values: dict, fields=None, fonts: dict | None = None) -> None:
    for field, value in values.items():
        if fields is None or field in fields:
            res.put(f"{key}.{field}", value)
    if fonts is not None and fields is None:
        res.put(f"{key}.fonts", fonts)


def _read_docx(zf: zipfile.ZipFile, base: str) -> _Result:
    res = _Result(base)
    styles_xml = _xml(zf, "word/styles.xml")
    doc_xml = _xml(zf, "word/document.xml")
    if doc_xml is None:
        raise FormatImportError(f"워드 문서가 아니에요. {WRONG_KIND}")
    theme = _xml(zf, "word/theme/theme1.xml")

    # 용지·여백: 마지막 구역(문서 끝 sectPr). 한글 뜻으로 역변환한다
    body = doc_xml.find(f"{W}body")
    sect = body.find(f"{W}sectPr") if body is not None else None
    if sect is None:
        all_sects = doc_xml.findall(f".//{W}sectPr")
        sect = all_sects[-1] if all_sects else None
    pg_sz = sect.find(f"{W}pgSz") if sect is not None else None
    pg_mar = sect.find(f"{W}pgMar") if sect is not None else None
    if pg_sz is not None and _num(pg_sz.get(f"{W}w")) and _num(pg_sz.get(f"{W}h")):
        res.put("page.width_mm", r_mm(df.twip_to_mm(_num(pg_sz.get(f"{W}w")))))
        res.put("page.height_mm", r_mm(df.twip_to_mm(_num(pg_sz.get(f"{W}h")))))
    else:
        res.miss("page.width_mm")
        res.miss("page.height_mm")
    if pg_mar is not None:
        def mar(attr):
            return abs(_num(pg_mar.get(f"{W}{attr}")) or 0)

        for side, dist, key in (("top", "header", "header_mm"), ("bottom", "footer", "footer_mm")):
            margin, distance = df.twip_to_mm(mar(side)), df.twip_to_mm(mar(dist))
            edge, band = (distance, margin - distance) if margin - distance >= 0 else (margin, 0)
            res.put(f"page.margin_mm.{side}", r_mm(edge))
            res.put(f"page.{key}", r_mm(band))
        for side in ("left", "right"):
            res.put(f"page.margin_mm.{side}", r_mm(df.twip_to_mm(mar(side))))
    else:
        for path in ("page.margin_mm", "page.header_mm", "page.footer_mm"):
            res.miss(path)

    if styles_xml is None:
        res.miss("fonts")
        res.miss("body")
        for key in SECTIONS:
            res.miss(key)
        return res
    st = _DocxStyles(styles_xml, theme)

    # 본문(Normal + docDefaults)
    normal_id = st.by_name.get("normal")
    body_p = st.props(normal_id) if normal_id else st.props("")
    body_fonts = _docx_fonts(st, body_p)
    for lang in ("hangul", "latin", "hanja"):
        if body_fonts[lang]:
            res.put(f"fonts.{lang}", body_fonts[lang])
        else:
            res.miss(f"fonts.{lang}")
    body_values = _docx_style_values(body_p, res, "Normal")
    _put_style(res, "body", body_values)

    for key in SECTIONS:
        sid = st.by_name.get(DOCX_STYLE_NAMES[key])
        if not sid:
            res.miss(key)
            continue
        p = st.props(sid)
        values = _docx_style_values(p, res, DOCX_STYLE_NAMES[key])
        fonts = _docx_fonts(st, p)
        own = None
        if all(fonts.values()) and fonts != {k: res.data["fonts"][k] for k in fonts}:
            own = fonts
        if key == "footnote":
            _put_style(res, key, values, FOOTNOTE_FIELDS)
        elif key == "bibliography":
            first = values.pop("first_line_indent")
            if float(first["value"]) < 0:
                hang = df.mm(r_mm(-df.length_pt(first, values["size_pt"]) / df.PT_PER_MM))
                res.put("bibliography.hanging_indent", hang)
                left = df.length_pt(values["indent_left"], 0) / df.PT_PER_MM - hang["value"]
                values["indent_left"] = df.mm(r_mm(max(left, 0)))
            _put_style(res, key, values, fonts=own)
        else:
            _put_style(res, key, values, fonts=own)
    return res


# =================================================================== HWPX
def _hwpx_case(para_pr: ET.Element, tag: str) -> tuple[ET.Element | None, float]:
    """paraPr의 margin·lineSpacing. hp:switch가 있으면 hp:case 값을, 없으면 hp:default 값(÷2)을 쓴다."""
    el = para_pr.find(f"{HH}{tag}")
    if el is not None:
        return el, 1
    switch = para_pr.find(f"{HP}switch")
    if switch is not None:
        case = switch.find(f"{HP}case/{HH}{tag}")
        if case is not None:
            return case, 1
        default = switch.find(f"{HP}default/{HH}{tag}")
        if default is not None:
            return default, 0.5
    return None, 1


def _read_hwpx(zf: zipfile.ZipFile, base: str) -> _Result:
    res = _Result(base)
    header = _xml(zf, "Contents/header.xml")
    section = _xml(zf, "Contents/section0.xml")
    if header is None or section is None:
        raise FormatImportError(f"한글 문서가 아니에요. {WRONG_KIND}")

    # 용지·여백: 첫 구역 pagePr (HWPUNIT → mm) 그대로
    page_pr = section.find(f".//{HP}pagePr")
    margin = page_pr.find(f"{HP}margin") if page_pr is not None else None
    if page_pr is not None:
        w, h = _num(page_pr.get("width")), _num(page_pr.get("height"))
        if w and h:
            if page_pr.get("landscape") == "NARROWLY":
                w, h = h, w
            res.put("page.width_mm", r_mm(df.hwp_to_mm(w)))
            res.put("page.height_mm", r_mm(df.hwp_to_mm(h)))
    else:
        res.miss("page.width_mm")
        res.miss("page.height_mm")
    if margin is not None:
        for attr, path in (("top", "page.margin_mm.top"), ("bottom", "page.margin_mm.bottom"),
                           ("left", "page.margin_mm.left"), ("right", "page.margin_mm.right"),
                           ("header", "page.header_mm"), ("footer", "page.footer_mm")):
            v = _num(margin.get(attr))
            if v is not None:
                res.put(path, r_mm(df.hwp_to_mm(v)))
            else:
                res.miss(path)
    else:
        for path in ("page.margin_mm", "page.header_mm", "page.footer_mm"):
            res.miss(path)

    faces: dict[str, dict[str, str]] = {}
    for ff in header.iter(f"{HH}fontface"):
        faces[ff.get("lang", "")] = {f.get("id"): f.get("face") for f in ff.findall(f"{HH}font")}
    char_prs = {c.get("id"): c for c in header.iter(f"{HH}charPr")}
    para_prs = {c.get("id"): c for c in header.iter(f"{HH}paraPr")}
    styles = list(header.iter(f"{HH}style"))

    def find_style(names):
        for s in styles:
            if s.get("engName") == names[0] or s.get("name") == names[1]:
                return s
        return None

    def read_style(style: ET.Element, label: str) -> tuple[dict, dict]:
        values: dict = {}
        fonts = {}
        cp = char_prs.get(style.get("charPrIDRef"))
        size = 10.0
        if cp is not None:
            size = (_num(cp.get("height")) or 1000) / 100
            values["size_pt"] = r_pt(size)
            values["bold"] = cp.find(f"{HH}bold") is not None
            values["italic"] = cp.find(f"{HH}italic") is not None
            ref = cp.find(f"{HH}fontRef")
            if ref is not None:
                for lang, key in (("HANGUL", "hangul"), ("LATIN", "latin"), ("HANJA", "hanja")):
                    face = faces.get(lang, {}).get(ref.get(key))
                    if face:
                        fonts[key] = face
        pp = para_prs.get(style.get("paraPrIDRef"))
        if pp is not None:
            align = pp.find(f"{HH}align")
            horizontal = (align.get("horizontal") if align is not None else "JUSTIFY") or "JUSTIFY"
            values["align"] = {"JUSTIFY": "justify", "DISTRIBUTE": "justify", "DISTRIBUTE_SPACE": "justify",
                               "CENTER": "center", "RIGHT": "right"}.get(horizontal.upper(), "left")
            ls, _ = _hwpx_case(pp, "lineSpacing")
            if ls is not None:
                kind, value = (ls.get("type") or "PERCENT").upper(), _num(ls.get("value")) or 160
                if kind == "PERCENT":
                    values["line_spacing_pct"] = round(value)
                else:
                    # 고정값·최소·여백만 지정: 글자 크기 기준 %로 근사
                    pts = value / 100 + (size if kind == "BETWEEN_LINES" else 0)
                    values["line_spacing_pct"] = round(pts / size * 100)
                    res.warnings.append(f"{label} 스타일 줄간격이 %가 아니라 글자 크기 기준 %로 바꿔 근사했어요")
            mg, scale = _hwpx_case(pp, "margin")
            if mg is not None:
                def part(name):
                    el = mg.find(f"{HC}{name}")
                    return (_num(el.get("value")) or 0) * scale if el is not None else 0

                values["first_line_indent"] = _length_from(df.hwp_to_mm(part("intent")), size)
                values["indent_left"] = df.mm(r_mm(df.hwp_to_mm(part("left"))))
                values["indent_right"] = df.mm(r_mm(df.hwp_to_mm(part("right"))))
                values["space_before_pt"] = r_pt(part("prev") / 100)
                values["space_after_pt"] = r_pt(part("next") / 100)
            brk = pp.find(f"{HH}breakSetting")
            if brk is not None:
                values["page_break_before"] = brk.get("pageBreakBefore") in ("1", "true")
        return values, fonts

    body = find_style(HWPX_STYLE_NAMES["body"])
    if body is None:
        res.miss("fonts")
        res.miss("body")
    else:
        values, fonts = read_style(body, "바탕글")
        for lang in ("hangul", "latin", "hanja"):
            if fonts.get(lang):
                res.put(f"fonts.{lang}", fonts[lang])
            else:
                res.miss(f"fonts.{lang}")
        _put_style(res, "body", values)
    for key in SECTIONS:
        names = HWPX_STYLE_NAMES.get(key)
        style = find_style(names) if names else None
        if style is None:
            res.miss(key)
            continue
        values, fonts = read_style(style, names[1])
        own = None
        if len(fonts) == 3 and fonts != {k: res.data["fonts"][k] for k in fonts}:
            own = fonts
        if key == "footnote":
            _put_style(res, key, values, FOOTNOTE_FIELDS)
        else:
            _put_style(res, key, values, fonts=own)
    return res
