"""원고를 워드(.docx)·한글(.hwpx) 파일로 쓴다.

화면이 인용·참고문헌을 citeproc-js로 서식화한 뒤 아래 '블록' 목록을 보낸다.

블록: {"type": "title" | "heading" | "paragraph" | "list_item" | "quote" | "code" |
         "bib_heading" | "bib_entry" | "page_break",
       "level": 1~4 (heading), "ordered": bool, "number": int, "depth": int (list_item),
       "hanging": bool (bib_entry), "text": str (code·bib_heading), "runs": [런…]}
런:   {"text": str, "b": bool, "i": bool, "sup": bool, "sub": bool, "code": bool}
      또는 {"footnote": [런…]}  ← 그 자리에 각주 번호가 들어가고 쪽 아래에 내용이 붙는다
"""

from __future__ import annotations

import copy
import io
import re
from typing import Any, Iterable

Block = dict[str, Any]
Run = dict[str, Any]

BODY_FONT_LATIN = "Times New Roman"
BODY_FONT_KO = "바탕"
HEADING_SIZES = {1: 14, 2: 12, 3: 11, 4: 11}


def _clean_text(text: str) -> str:
    # XML에 쓸 수 없는 제어 문자를 지운다
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text or "")


def _list_prefix(block: Block) -> str:
    return f"{block.get('number') or 1}. " if block.get("ordered") else "• "


def plain_text(runs: Iterable[Run]) -> str:
    return "".join(r.get("text", "") for r in runs if "footnote" not in r)


# =================================================================== DOCX
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
FOOTNOTES_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"
FOOTNOTES_RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"


class _DocxFootnotes:
    """python-docx에 없는 각주를 OOXML 수준에서 추가한다."""

    def __init__(self, document):
        from docx.opc.packuri import PackURI
        from docx.opc.part import XmlPart
        from docx.oxml import parse_xml

        xml = (
            f'<w:footnotes xmlns:w="{W_NS}">'
            '<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" '
            'w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>'
            '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" '
            'w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
            "</w:footnotes>"
        )
        self.part = XmlPart(PackURI("/word/footnotes.xml"), FOOTNOTES_CT, parse_xml(xml), document.part.package)
        document.part.relate_to(self.part, FOOTNOTES_RT)
        self.next_id = 1

    def add(self, paragraph, runs: list[Run]) -> None:
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn

        nid = self.next_id
        self.next_id += 1
        # 본문 쪽 각주 번호
        ref_run = OxmlElement("w:r")
        rpr = OxmlElement("w:rPr")
        va = OxmlElement("w:vertAlign")
        va.set(qn("w:val"), "superscript")
        rpr.append(va)
        ref_run.append(rpr)
        ref = OxmlElement("w:footnoteReference")
        ref.set(qn("w:id"), str(nid))
        ref_run.append(ref)
        paragraph._p.append(ref_run)
        # 쪽 아래 각주 내용
        note = OxmlElement("w:footnote")
        note.set(qn("w:id"), str(nid))
        p = OxmlElement("w:p")
        ppr = OxmlElement("w:pPr")
        spacing = OxmlElement("w:spacing")
        spacing.set(qn("w:after"), "0")
        spacing.set(qn("w:line"), "240")
        spacing.set(qn("w:lineRule"), "auto")
        ppr.append(spacing)
        p.append(ppr)
        mark = OxmlElement("w:r")
        mark.append(copy.deepcopy(rpr))
        mark.append(OxmlElement("w:footnoteRef"))
        p.append(mark)
        for r in [{"text": " "}] + list(runs):
            if "footnote" in r:
                continue
            p.append(_docx_run_element(r, size_half_points=18))
        note.append(p)
        self.part.element.append(note)


def _docx_run_element(r: Run, size_half_points: int | None = None):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    run = OxmlElement("w:r")
    rpr = OxmlElement("w:rPr")
    if r.get("b"):
        rpr.append(OxmlElement("w:b"))
    if r.get("i"):
        rpr.append(OxmlElement("w:i"))
    if r.get("sup") or r.get("sub"):
        va = OxmlElement("w:vertAlign")
        va.set(qn("w:val"), "superscript" if r.get("sup") else "subscript")
        rpr.append(va)
    if size_half_points:
        sz = OxmlElement("w:sz")
        sz.set(qn("w:val"), str(size_half_points))
        rpr.append(sz)
    if len(rpr):
        run.append(rpr)
    t = OxmlElement("w:t")
    t.set(qn("xml:space"), "preserve")
    t.text = _clean_text(r.get("text", ""))
    run.append(t)
    return run


def _docx_set_fonts(style, latin: str, east_asia: str, size_pt: float | None = None, bold=None, color_black=False):
    from docx.oxml.ns import qn
    from docx.shared import Pt, RGBColor

    style.font.name = latin
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        from docx.oxml import OxmlElement
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs"):
        rfonts.set(qn(attr), latin)
    rfonts.set(qn("w:eastAsia"), east_asia)
    for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:eastAsiaTheme", "w:cstheme"):
        rfonts.attrib.pop(qn(attr), None)
    if size_pt:
        style.font.size = Pt(size_pt)
    if bold is not None:
        style.font.bold = bold
    if color_black:
        style.font.color.rgb = RGBColor(0, 0, 0)


def to_docx(blocks: list[Block], meta: dict | None = None) -> bytes:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
    from docx.shared import Mm, Pt

    meta = meta or {}
    document = Document()
    section = document.sections[0]
    section.page_width, section.page_height = Mm(210), Mm(297)  # A4
    for side in ("left_margin", "right_margin"):
        setattr(section, side, Mm(30))
    section.top_margin = section.bottom_margin = Mm(25)

    styles = document.styles
    normal = styles["Normal"]
    _docx_set_fonts(normal, BODY_FONT_LATIN, BODY_FONT_KO, 11)
    normal.paragraph_format.line_spacing = 1.6
    normal.paragraph_format.space_after = Pt(6)
    for level in range(1, 5):
        st = styles[f"Heading {level}"]
        _docx_set_fonts(st, BODY_FONT_LATIN, BODY_FONT_KO, HEADING_SIZES[level], bold=True, color_black=True)
        st.font.italic = False
        st.paragraph_format.space_before = Pt(14 if level == 1 else 10)
        st.paragraph_format.space_after = Pt(6)
    document.core_properties.title = meta.get("title") or ""
    document.core_properties.author = meta.get("author") or ""

    notes: _DocxFootnotes | None = None

    def add_runs(paragraph, runs: list[Run]):
        nonlocal notes
        for r in runs:
            if "footnote" in r:
                if notes is None:
                    notes = _DocxFootnotes(document)
                notes.add(paragraph, r["footnote"])
                continue
            run = paragraph.add_run(_clean_text(r.get("text", "")))
            run.bold = bool(r.get("b")) or None
            run.italic = bool(r.get("i")) or None
            if r.get("sup"):
                run.font.superscript = True
            if r.get("sub"):
                run.font.subscript = True
            if r.get("code"):
                run.font.name = "Consolas"

    for block in blocks:
        kind = block.get("type")
        runs = block.get("runs") or []
        if kind == "title":
            # 워드 기본 '제목' 스타일은 파란 밑줄이 있어 논문에 맞지 않으므로 직접 꾸민다
            p = document.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            p.paragraph_format.space_after = Pt(18)
            add_runs(p, [dict(r, b=True) if "footnote" not in r else r for r in runs])
            for run in p.runs:
                run.font.size = Pt(18)
        elif kind == "heading":
            level = max(1, min(4, int(block.get("level") or 1)))
            add_runs(document.add_paragraph(style=f"Heading {level}"), runs)
        elif kind == "list_item":
            p = document.add_paragraph()
            depth = int(block.get("depth") or 0)
            p.paragraph_format.left_indent = Mm(8 + 6 * depth)
            p.paragraph_format.first_line_indent = Mm(-5)
            add_runs(p, [{"text": _list_prefix(block)}] + runs)
        elif kind == "quote":
            p = document.add_paragraph()
            p.paragraph_format.left_indent = Mm(10)
            p.paragraph_format.right_indent = Mm(10)
            add_runs(p, runs)
        elif kind == "code":
            p = document.add_paragraph()
            run = p.add_run(_clean_text(block.get("text", "")))
            run.font.name = "Consolas"
            run.font.size = Pt(9.5)
        elif kind == "bib_heading":
            document.add_paragraph(block.get("text") or "참고문헌", style="Heading 1")
        elif kind == "bib_entry":
            p = document.add_paragraph()
            if block.get("hanging", True):
                p.paragraph_format.left_indent = Mm(10)
                p.paragraph_format.first_line_indent = Mm(-10)
            add_runs(p, runs)
        elif kind == "page_break":
            document.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
        else:
            p = document.add_paragraph()
            p.paragraph_format.first_line_indent = Mm(meta.get("first_line_indent_mm", 0) or 0) or None
            add_runs(p, runs)

    buf = io.BytesIO()
    document.save(buf)
    return buf.getvalue()


# =================================================================== HWPX
class _HwpxWriter:
    def __init__(self):
        from hwpx import HwpxDocument

        self.doc = HwpxDocument.new()
        self._char_cache: dict[tuple, str] = {}
        self._first_paragraph = self.doc.paragraphs[0] if self.doc.paragraphs else None

    def char(self, b=False, i=False, script=None, size=None) -> str | None:
        key = (bool(b), bool(i), script, size)
        if key == (False, False, None, None):
            return None
        if key not in self._char_cache:
            self._char_cache[key] = self.doc.oxml.ensure_run_style(
                bold=bool(b), italic=bool(i), script=script, size=size)
        return self._char_cache[key]

    def paragraph(self):
        # 빈 문서의 첫 문단(구역 설정을 담고 있음)을 먼저 쓴다
        if self._first_paragraph is not None:
            p, self._first_paragraph = self._first_paragraph, None
            return p
        return self.doc.add_paragraph("", include_run=False, inherit_style=False)

    def runs(self, paragraph, runs: list[Run], size=None, bold=False):
        for r in runs:
            if "footnote" in r:
                text = plain_text(r["footnote"]).strip()
                paragraph.add_footnote(_clean_text(text) or " ")
                continue
            text = _clean_text(r.get("text", ""))
            if not text:
                continue
            script = "sup" if r.get("sup") else ("sub" if r.get("sub") else None)
            cid = self.char(b=bold or r.get("b"), i=r.get("i"), script=script, size=size)
            if cid is None:
                paragraph.add_run(text)
            else:
                paragraph.add_run(text, char_pr_id_ref=cid)

    def fmt(self, paragraph, **kw):
        from hwpx._document import layout

        layout.set_paragraph_format(self.doc, paragraphs=[paragraph], **kw)


def to_hwpx(blocks: list[Block], meta: dict | None = None) -> bytes:
    meta = meta or {}
    w = _HwpxWriter()
    for block in blocks:
        kind = block.get("type")
        runs = block.get("runs") or []
        if kind == "title":
            p = w.paragraph()
            w.runs(p, runs, size=16, bold=True)
            w.fmt(p, alignment="CENTER", spacing_after_pt=12)
        elif kind == "heading":
            level = max(1, min(4, int(block.get("level") or 1)))
            p = w.paragraph()
            w.runs(p, runs, size=HEADING_SIZES[level], bold=True)
            w.fmt(p, spacing_before_pt=12 if level == 1 else 8, spacing_after_pt=4, keep_with_next=True)
        elif kind == "list_item":
            p = w.paragraph()
            w.runs(p, [{"text": _list_prefix(block)}] + runs)
            depth = int(block.get("depth") or 0)
            w.fmt(p, indent_left_mm=8 + 6 * depth, first_line_indent_mm=-5)
        elif kind == "quote":
            p = w.paragraph()
            w.runs(p, runs)
            w.fmt(p, indent_left_mm=10, indent_right_mm=10)
        elif kind == "code":
            p = w.paragraph()
            w.runs(p, [{"text": block.get("text", "")}])
        elif kind == "bib_heading":
            p = w.paragraph()
            w.runs(p, [{"text": block.get("text") or "참고문헌"}], size=HEADING_SIZES[1], bold=True)
            w.fmt(p, spacing_before_pt=12, spacing_after_pt=4, keep_with_next=True)
        elif kind == "bib_entry":
            p = w.paragraph()
            w.runs(p, runs)
            if block.get("hanging", True):
                w.fmt(p, indent_left_mm=10, first_line_indent_mm=-10)
        elif kind == "page_break":
            p = w.paragraph()
            w.fmt(p, page_break_before=True)
        else:
            p = w.paragraph()
            w.runs(p, runs)
    report = w.doc.validate()
    if getattr(report, "issues", ()):
        raise ValueError(f"한글 문서 검증 실패: {report.issues[:3]}")
    return w.doc.to_bytes()


def to_markdown(blocks: list[Block]) -> str:
    out, notes = [], []

    def md(runs):
        s = ""
        for r in runs:
            if "footnote" in r:
                notes.append(md(r["footnote"]))
                s += f"[^{len(notes)}]"
                continue
            t = r.get("text", "")
            if r.get("b"):
                t = f"**{t}**"
            if r.get("i"):
                t = f"*{t}*"
            if r.get("sup"):
                t = f"<sup>{t}</sup>"
            s += t
        return s

    for b in blocks:
        kind = b.get("type")
        if kind == "title":
            out.append("# " + md(b.get("runs") or []))
        elif kind == "heading":
            out.append("#" * (int(b.get("level") or 1) + 1) + " " + md(b.get("runs") or []))
        elif kind == "list_item":
            out.append("  " * int(b.get("depth") or 0) + _list_prefix(b).replace("•", "-") + md(b.get("runs") or []))
        elif kind == "quote":
            out.append("> " + md(b.get("runs") or []))
        elif kind == "code":
            out.append("```\n" + b.get("text", "") + "\n```")
        elif kind == "bib_heading":
            out.append("## " + (b.get("text") or "참고문헌"))
        elif kind == "page_break":
            out.append("\n---\n")
        else:
            out.append(md(b.get("runs") or []))
    text = "\n\n".join(out)
    if notes:
        text += "\n\n" + "\n".join(f"[^{i}]: {n}" for i, n in enumerate(notes, 1))
    return text + "\n"
