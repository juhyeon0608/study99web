"""CSL 스타일 파일(.csl) 정보 읽기."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET

NS = {"c": "http://purl.org/net/xbiblio/csl"}
# 목록 맨 앞에 보여 줄 스타일
FEATURED = ["apa", "ieee", "chicago-author-date", "chicago-notes-bibliography", "modern-language-association",
            "harvard-cite-them-right", "nlm-citation-sequence", "nature", "american-medical-association",
            "american-chemical-society", "association-for-computing-machinery", "elsevier-harvard",
            "springer-basic-author-date", "american-sociological-association"]
SHORT_NAMES = {
    "apa": "APA 7판", "ieee": "IEEE", "chicago-author-date": "Chicago (저자-연도)",
    "chicago-notes-bibliography": "Chicago (각주)", "modern-language-association": "MLA 9판",
    "harvard-cite-them-right": "Harvard", "nlm-citation-sequence": "Vancouver (NLM)", "nature": "Nature",
    "american-medical-association": "AMA", "american-chemical-society": "ACS",
    "association-for-computing-machinery": "ACM", "elsevier-harvard": "Elsevier Harvard",
    "springer-basic-author-date": "Springer (저자-연도)", "american-sociological-association": "ASA",
}


def slug(text: str) -> str:
    text = re.sub(r"\.csl$", "", (text or "").rsplit("/", 1)[-1], flags=re.I).lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text[:100] or "custom-style"


def read_info(raw: bytes) -> dict | None:
    """스타일 이름·종류를 돌려준다. CSL이 아니면 None."""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return None
    if root.tag != "{http://purl.org/net/xbiblio/csl}style":
        return None
    info = root.find("c:info", NS)
    if info is None:
        return None
    title = (info.findtext("c:title", "", NS) or "").strip()
    source_id = (info.findtext("c:id", "", NS) or "").strip()
    parent = ""
    for link in info.findall("c:link", NS):
        if link.get("rel") == "independent-parent":
            parent = slug(link.get("href", ""))
    fmt = ""
    fields = []
    for cat in info.findall("c:category", NS):
        if cat.get("citation-format"):
            fmt = cat.get("citation-format")
        if cat.get("field"):
            fields.append(cat.get("field"))
    sid = slug(source_id)
    korean = bool(re.search(r"korea", title + source_id, re.I))
    return {
        "title": title or sid,
        "short": SHORT_NAMES.get(sid, title or sid),
        "source_id": source_id,
        "parent": parent,
        "format": fmt,  # author-date | numeric | note | author | label
        "numeric": fmt == "numeric",
        "note": root.get("class") == "note",
        "fields": fields,
        "group": "국내 학술지" if korean else ("주요 스타일" if sid in FEATURED else "분야별 스타일"),
    }
