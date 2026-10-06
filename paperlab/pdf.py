"""PDF 텍스트 추출과 메타데이터 추정 (DOI/arXiv ID/제목)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

import pymupdf

DOI_RE = re.compile(r"\b(10\.\d{4,9}/[^\s\"<>]+)", re.I)
ARXIV_RE = re.compile(r"arXiv:\s*(\d{4}\.\d{4,5})(v\d+)?", re.I)
ARXIV_NEW_RE = re.compile(r"\b(\d{4}\.\d{4,5})(v\d+)?\b")


@dataclass
class PdfInfo:
    page_texts: list[str]
    title: str = ""
    doi: str = ""
    arxiv_id: str = ""
    meta_author: str = ""
    meta_title: str = ""
    year: int | None = None
    warnings: list[str] = field(default_factory=list)


def clean_doi(doi: str) -> str:
    doi = doi.rstrip(".,;:)]}>'\"")
    # 각주 번호처럼 붙어 나오는 꼬리를 자른다 (예: 10.1000/xyz123.Abstract)
    doi = re.sub(r"(\.?(Abstract|Introduction|Keywords|pdf))$", "", doi, flags=re.I)
    return doi.lower()


def _guess_title(doc: pymupdf.Document) -> str:
    """첫 페이지에서 가장 큰 글씨로 된 줄(들)을 제목으로 본다."""
    if doc.page_count == 0:
        return ""
    page = doc[0]
    spans = []
    for block in page.get_text("dict").get("blocks", []):
        for line in block.get("lines", []):
            text = "".join(s["text"] for s in line.get("spans", [])).strip()
            if not text or not line.get("spans"):
                continue
            size = max(s["size"] for s in line["spans"])
            spans.append((size, line["bbox"][1], text))
    if not spans:
        return ""
    # 상단 60% 영역, 너무 짧거나 arXiv 워터마크 같은 줄은 제외
    height = page.rect.height
    cands = [s for s in spans if s[1] < height * 0.6 and len(s[2]) > 3
             and not re.match(r"^(arxiv|preprint|journal|vol\.|proceedings)", s[2], re.I)]
    if not cands:
        return ""
    max_size = max(s[0] for s in cands)
    lines = [s for s in cands if abs(s[0] - max_size) < 0.6]
    lines.sort(key=lambda s: s[1])
    # 제목은 연속된 몇 줄로 이루어진다
    title_lines = [lines[0][2]]
    for prev, cur in zip(lines, lines[1:]):
        if cur[1] - prev[1] > max_size * 2.2 or len(title_lines) >= 4:
            break
        title_lines.append(cur[2])
    title = re.sub(r"\s+", " ", " ".join(title_lines)).strip()
    return title if 8 <= len(title) <= 300 else ""


def extract(data: bytes) -> PdfInfo:
    doc = pymupdf.open(stream=data, filetype="pdf")
    try:
        texts = [page.get_text("text") for page in doc]
        info = PdfInfo(page_texts=texts)
        meta = doc.metadata or {}
        info.meta_title = (meta.get("title") or "").strip()
        info.meta_author = (meta.get("author") or "").strip()
        m = re.match(r"D:(\d{4})", meta.get("creationDate") or "")
        if m:
            info.year = int(m.group(1))

        head = "\n".join(texts[:2])
        m = ARXIV_RE.search(head)
        if m:
            info.arxiv_id = m.group(1)
        dois = [clean_doi(d) for d in DOI_RE.findall(head)]
        # arXiv 자체 DOI(10.48550)는 arXiv ID로 처리
        for d in dois:
            if d.startswith("10.48550/arxiv."):
                info.arxiv_id = info.arxiv_id or d.split("arxiv.", 1)[1]
            elif not info.doi:
                info.doi = d
        if not info.arxiv_id and not info.doi:
            # 파일 이름이 아니라 본문 머리말에서만 새 형식 ID를 찾는다
            first = texts[0][:600] if texts else ""
            m = ARXIV_NEW_RE.search(first)
            if m and "arxiv" in first.lower():
                info.arxiv_id = m.group(1)

        info.title = _guess_title(doc)
        if (not info.title and info.meta_title and len(info.meta_title) > 8
                and not re.search(r"\.(docx?|pdf|tex)$|^untitled|^microsoft", info.meta_title, re.I)):
            info.title = info.meta_title
        if not any(t.strip() for t in texts):
            info.warnings.append("텍스트가 없는 PDF예요 (스캔본일 수 있어요). 검색과 AI 기능이 제한돼요.")
        return info
    finally:
        doc.close()


def page_count(data: bytes) -> int:
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        return doc.page_count
