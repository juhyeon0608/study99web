"""인용 형식(APA·MLA·Chicago·IEEE·Harvard·Vancouver)과 BibTeX·RIS·CSL-JSON 가져오기/내보내기."""

from __future__ import annotations

import html
import json
import re

from .sources import split_name

STYLES = {
    "apa": "APA 7판",
    "mla": "MLA 9판",
    "chicago": "Chicago (저자-연도)",
    "ieee": "IEEE",
    "harvard": "Harvard",
    "vancouver": "Vancouver",
}

HANGUL_CJK = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]")


def _is_cjk(a: dict) -> bool:
    return bool(HANGUL_CJK.search((a.get("family") or "") + (a.get("given") or "")))


def _full(a: dict) -> str:
    if a.get("literal"):
        return a["literal"]
    if _is_cjk(a):
        return (a.get("family") or "") + (a.get("given") or "")
    return " ".join(x for x in (a.get("given"), a.get("family")) if x)


def _initials(given: str, sep: str = ". ", end: str = ".") -> str:
    parts = [p for p in re.split(r"[\s.]+", given or "") if p]
    out = []
    for p in parts:
        if "-" in p:
            out.append("-".join(x[0] + "." for x in p.split("-") if x).rstrip("."))
        else:
            out.append(p[0])
    return (sep.join(out) + end) if out else ""


def _family_initials(a: dict, comma: bool = True, compact: bool = False) -> str:
    """'Vaswani, A.' / 'Vaswani A' (compact=Vancouver)"""
    if a.get("literal") or _is_cjk(a):
        return _full(a)
    fam = a.get("family") or ""
    if compact:
        ini = "".join(p[0] for p in re.split(r"[\s.\-]+", a.get("given") or "") if p)
        return f"{fam} {ini}".strip()
    ini = _initials(a.get("given") or "")
    if not ini:
        return fam
    return f"{fam}, {ini}" if comma else f"{fam} {ini}"


def _join(items: list[str], last_sep: str, sep: str = ", ") -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    return sep.join(items[:-1]) + last_sep + items[-1]


def _e(s) -> str:
    return html.escape(str(s or ""), quote=False)


def _i(s: str) -> str:
    return f"<i>{_e(s)}</i>" if s else ""


def _end(s: str, ch: str = ".") -> str:
    s = (s or "").strip()
    return s if not s or s[-1] in ".?!" else s + ch


def _doi_url(p: dict) -> str:
    if p.get("doi"):
        return f"https://doi.org/{p['doi']}"
    if p.get("arxiv_id"):
        return f"https://arxiv.org/abs/{p['arxiv_id']}"
    return p.get("url") or ""


def _venue(p: dict) -> str:
    v = p.get("venue") or ""
    if not v and p.get("arxiv_id"):
        v = "arXiv"
    return v


def format_citation(p: dict, style: str = "apa") -> dict:
    """{"html": ..., "text": ...} 를 돌려준다. html에는 기울임(<i>)만 쓴다."""
    fn = {"apa": _apa, "mla": _mla, "chicago": _chicago, "ieee": _ieee,
          "harvard": _harvard, "vancouver": _vancouver}.get(style, _apa)
    out = re.sub(r"\s+", " ", fn(p)).strip()
    out = out.replace(" ,", ",").replace(" .", ".").replace("..", ".")
    text = html.unescape(re.sub(r"<[^>]+>", "", out))
    return {"html": out, "text": text}


def _apa(p: dict) -> str:
    authors = p.get("authors") or []
    names = [_family_initials(a) for a in authors]
    if len(names) > 20:
        a = ", ".join(names[:19]) + ", … " + names[-1]
    else:
        a = _join(names, ", & " if len(names) > 2 else " & ")
    year = p.get("year") or "n.d."
    title = _end(p.get("title") or "")
    venue = _venue(p)
    if authors and all(_is_cjk(x) for x in authors):
        # 국문 표기: 홍길동, 김철수 (2023).
        a = ", ".join(_full(x) for x in authors)
        lead = _e(a)
    else:
        lead = _e(_end(a)) if a else ""
    parts = [lead, f"({year}).", ]
    if p.get("item_type") == "book":
        parts.append(_i(title))
        if p.get("publisher"):
            parts.append(_e(_end(p["publisher"])))
    else:
        parts.append(_e(title))
        if venue:
            src = _i(venue)
            if p.get("volume"):
                src += ", " + _i(p["volume"])
                if p.get("issue"):
                    src += f"({_e(p['issue'])})"
            if p.get("pages"):
                src += ", " + _e(p["pages"].replace("--", "–").replace("-", "–"))
            parts.append(src + ".")
    url = _doi_url(p)
    if url:
        parts.append(_e(url))
    return " ".join(x for x in parts if x)


def _mla(p: dict) -> str:
    authors = p.get("authors") or []
    if not authors:
        a = ""
    else:
        first = authors[0]
        lead = _full(first) if _is_cjk(first) or first.get("literal") else \
            ", ".join(x for x in (first.get("family"), first.get("given")) if x)
        if len(authors) == 1:
            a = lead
        elif len(authors) == 2:
            a = f"{lead}, {_full(authors[1])}" if _is_cjk(authors[1]) else f"{lead}, and {_full(authors[1])}"
        else:
            a = f"{lead}, et al"
    parts = [_e(_end(a)) if a else "", f"“{_e(_end(p.get('title') or ''))}”"]
    src = []
    if _venue(p):
        src.append(_i(_venue(p)))
    if p.get("volume"):
        src.append(f"vol. {_e(p['volume'])}")
    if p.get("issue"):
        src.append(f"no. {_e(p['issue'])}")
    if p.get("year"):
        src.append(str(p["year"]))
    if p.get("pages"):
        src.append(f"pp. {_e(p['pages'].replace('--', '-'))}")
    if src:
        parts.append(", ".join(src) + ".")
    if p.get("doi"):
        parts.append(_e(f"https://doi.org/{p['doi']}."))
    elif _doi_url(p):
        parts.append(_e(_doi_url(p) + "."))
    return " ".join(x for x in parts if x)


def _chicago(p: dict) -> str:
    authors = p.get("authors") or []
    names = []
    for i, au in enumerate(authors[:10]):
        if i == 0 and not (_is_cjk(au) or au.get("literal")):
            names.append(", ".join(x for x in (au.get("family"), au.get("given")) if x))
        else:
            names.append(_full(au))
    if len(authors) > 10:
        names = names[:7] + ["et al"]
        a = ", ".join(names)
    else:
        a = _join(names, ", and " if len(names) > 2 else " and ")
    parts = [_e(_end(a)) if a else "", f"{p.get('year') or 'n.d.'}.", f"“{_e(_end(p.get('title') or ''))}”"]
    src = _i(_venue(p))
    if p.get("volume"):
        src += f" {_e(p['volume'])}"
        if p.get("issue"):
            src += f" ({_e(p['issue'])})"
    if p.get("pages"):
        src += f": {_e(p['pages'].replace('--', '–').replace('-', '–'))}"
    if src:
        parts.append(src + ".")
    if _doi_url(p):
        parts.append(_e(_doi_url(p) + "."))
    return " ".join(x for x in parts if x)


def _ieee(p: dict) -> str:
    authors = p.get("authors") or []
    names = []
    for au in authors:
        if _is_cjk(au) or au.get("literal"):
            names.append(_full(au))
        else:
            ini = _initials(au.get("given") or "")
            names.append(f"{ini} {au.get('family') or ''}".strip())
    if len(names) > 6:
        a = names[0] + " et al."
    else:
        a = _join(names, ", and " if len(names) > 2 else " and ")
    parts = [_e(a + ",") if a else "", f"“{_e(p.get('title') or '')},”"]
    src = []
    if _venue(p):
        src.append(_i(_venue(p)))
    if p.get("volume"):
        src.append(f"vol. {_e(p['volume'])}")
    if p.get("issue"):
        src.append(f"no. {_e(p['issue'])}")
    if p.get("pages"):
        src.append(f"pp. {_e(p['pages'].replace('--', '–').replace('-', '–'))}")
    if p.get("year"):
        src.append(str(p["year"]))
    if p.get("doi"):
        src.append(f"doi: {_e(p['doi'])}")
    elif p.get("arxiv_id"):
        src.append(f"arXiv:{_e(p['arxiv_id'])}")
    parts.append(", ".join(src) + ".")
    return " ".join(x for x in parts if x)


def _harvard(p: dict) -> str:
    authors = p.get("authors") or []
    names = [_family_initials(a) for a in authors]
    if len(names) > 3:
        a = names[0] + " et al."
    else:
        a = _join(names, " and ")
    parts = [_e(a) if a else "", f"({p.get('year') or 'n.d.'})", f"‘{_e(p.get('title') or '')}’,"]
    src = _i(_venue(p))
    if p.get("volume"):
        src += f", {_e(p['volume'])}"
        if p.get("issue"):
            src += f"({_e(p['issue'])})"
    if p.get("pages"):
        src += f", pp. {_e(p['pages'].replace('--', '–').replace('-', '–'))}"
    parts.append((src + ".") if src else "")
    if p.get("doi"):
        parts.append(f"doi:{_e(p['doi'])}.")
    elif _doi_url(p):
        parts.append(f"Available at: {_e(_doi_url(p))}.")
    return " ".join(x for x in parts if x)


def _vancouver(p: dict) -> str:
    authors = p.get("authors") or []
    names = [_family_initials(a, compact=True) for a in authors]
    if len(names) > 6:
        names = names[:6] + ["et al"]
    a = ", ".join(names)
    parts = [_e(_end(a)) if a else "", _e(_end(p.get("title") or ""))]
    src = _e(_venue(p))
    if src:
        src += ". "
    src += str(p.get("year") or "")
    if p.get("volume"):
        src += f";{_e(p['volume'])}"
        if p.get("issue"):
            src += f"({_e(p['issue'])})"
    if p.get("pages"):
        src += f":{_e(p['pages'].replace('--', '-'))}"
    parts.append(src + ".")
    if p.get("doi"):
        parts.append(f"doi:{_e(p['doi'])}")
    return " ".join(x for x in parts if x)


def in_text(p: dict, style: str = "apa") -> str:
    """본문 내 인용 표기 (예: (Vaswani et al., 2017))"""
    authors = p.get("authors") or []
    year = p.get("year") or "n.d."
    fam = lambda a: _full(a) if _is_cjk(a) or a.get("literal") else (a.get("family") or "")  # noqa: E731
    if style in ("ieee", "vancouver"):
        return "[1]"
    if not authors:
        who = (p.get("title") or "")[:30]
    elif len(authors) == 1:
        who = fam(authors[0])
    elif len(authors) == 2:
        joiner = " & " if style == "apa" else " and "
        who = fam(authors[0]) + joiner + fam(authors[1])
    else:
        who = fam(authors[0]) + " et al."
    if style == "mla":
        return f"({who})"
    if style == "chicago":
        return f"({who} {year})"
    return f"({who}, {year})"


# --------------------------------------------------------------- BibTeX
BIB_TYPES = {"article": "article", "conference": "inproceedings", "book": "book", "chapter": "incollection",
             "thesis": "phdthesis", "report": "techreport", "preprint": "misc", "dataset": "misc"}
BIB_TYPES_REV = {"article": "article", "inproceedings": "conference", "conference": "conference",
                 "book": "book", "incollection": "chapter", "inbook": "chapter", "phdthesis": "thesis",
                 "mastersthesis": "thesis", "techreport": "report", "misc": "article",
                 "unpublished": "preprint", "online": "article"}


def _bib_escape(s: str) -> str:
    return re.sub(r"([&%#_$])", r"\\\1", str(s or ""))


def _bib_name(a: dict) -> str:
    if a.get("literal"):
        return "{" + a["literal"] + "}"
    if _is_cjk(a):
        return "{" + _full(a) + "}"
    if a.get("given"):
        return f"{a.get('family') or ''}, {a['given']}"
    return a.get("family") or ""


STOPWORDS = {"a", "an", "the", "on", "of", "for", "and", "in", "to", "with", "at", "by", "from"}


def make_citekey(p: dict) -> str:
    """vaswani2017attention 형태의 인용 키"""
    authors = p.get("authors") or []
    family = ""
    if authors and isinstance(authors[0], dict):
        family = authors[0].get("family") or authors[0].get("literal") or ""
    family = re.sub(r"[^A-Za-z]", "", family.lower()) or "paper"
    word = next((w.lower() for w in re.findall(r"[A-Za-z]+", p.get("title") or "")
                 if w.lower() not in STOPWORDS), "")
    return f"{family}{p.get('year') or 'nd'}{word}"


def to_bibtex(papers: list[dict]) -> str:
    out = []
    for p in papers:
        t = BIB_TYPES.get(p.get("item_type") or "article", "misc")
        fields = [("title", "{" + _bib_escape(p.get("title")) + "}"),
                  ("author", " and ".join(_bib_name(a) for a in p.get("authors") or []))]
        venue_key = {"article": "journal", "inproceedings": "booktitle", "incollection": "booktitle",
                     "phdthesis": "school", "techreport": "institution"}.get(t, "howpublished")
        if p.get("venue"):
            fields.append((venue_key, _bib_escape(p["venue"])))
        for k in ("year", "volume", "pages", "publisher", "doi", "url"):
            v = p.get(k)
            if v:
                if k == "pages":
                    v = str(v).replace("–", "--")
                    v = re.sub(r"(?<!-)-(?!-)", "--", v)
                fields.append((k, str(v) if k in ("doi", "url") else _bib_escape(v)))
        if p.get("issue"):
            fields.append(("number", _bib_escape(p["issue"])))
        if p.get("arxiv_id"):
            fields += [("eprint", p["arxiv_id"]), ("archivePrefix", "arXiv")]
        if p.get("abstract"):
            fields.append(("abstract", _bib_escape(p["abstract"])))
        if p.get("keywords"):
            fields.append(("keywords", _bib_escape(", ".join(p["keywords"]))))
        body = ",\n".join(f"  {k} = {{{v}}}" for k, v in fields if v)
        out.append(f"@{t}{{{p.get('citekey') or make_citekey(p)},\n{body}\n}}")
    return "\n\n".join(out) + "\n"


LATEX_ACCENTS = {
    r"\"a": "ä", r"\"o": "ö", r"\"u": "ü", r"\"A": "Ä", r"\"O": "Ö", r"\"U": "Ü", r"\ss": "ß",
    r"\'e": "é", r"\'a": "á", r"\'i": "í", r"\'o": "ó", r"\'u": "ú", r"\`e": "è", r"\`a": "à",
    r"\^e": "ê", r"\^o": "ô", r"\~n": "ñ", r"\c c": "ç", r"\c{c}": "ç", r"\o": "ø", r"\aa": "å",
}


def _delatex(s: str) -> str:
    s = re.sub(r"\{\\([\"'`^~])\{?(\w)\}?\}", lambda m: LATEX_ACCENTS.get("\\" + m.group(1) + m.group(2), m.group(2)), s)
    s = re.sub(r"\\([\"'`^~])\{?(\w)\}?", lambda m: LATEX_ACCENTS.get("\\" + m.group(1) + m.group(2), m.group(2)), s)
    s = re.sub(r"\\([&%#_$])", r"\1", s)
    s = s.replace("--", "–").replace("~", " ")
    s = re.sub(r"\\(textit|textbf|emph|mathrm|text)\{([^{}]*)\}", r"\2", s)
    s = s.replace("{", "").replace("}", "")
    return re.sub(r"\s+", " ", s).strip()


def _read_bib_value(text: str, i: int) -> tuple[str, int]:
    while i < len(text) and text[i].isspace():
        i += 1
    if i >= len(text):
        return "", i
    if text[i] == "{":
        depth, j = 1, i + 1
        while j < len(text) and depth:
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        return text[i + 1:j - 1], j
    if text[i] == '"':
        j, depth = i + 1, 0
        while j < len(text):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            elif text[j] == '"' and depth == 0:
                break
            j += 1
        return text[i + 1:j], j + 1
    m = re.match(r"[^,}\s]+", text[i:])
    return (m.group(0), i + m.end()) if m else ("", i)


def parse_bibtex(text: str) -> list[dict]:
    papers = []
    for m in re.finditer(r"@(\w+)\s*\{\s*([^,\s]*)\s*,", text):
        etype = m.group(1).lower()
        if etype in ("comment", "preamble", "string"):
            continue
        i = m.end()
        fields: dict[str, str] = {}
        while i < len(text):
            fm = re.match(r"\s*,?\s*([\w\-:]+)\s*=", text[i:])
            if not fm:
                break
            key = fm.group(1).lower()
            i += fm.end()
            value, i = _read_bib_value(text, i)
            # 문자열 연결(#)은 단순히 이어 붙인다
            while True:
                hm = re.match(r"\s*#\s*", text[i:])
                if not hm:
                    break
                more, i = _read_bib_value(text, i + hm.end())
                value += more
            fields[key] = value
            end = re.match(r"\s*,?\s*\}", text[i:])
            if end:
                i += end.end()
                break
        if not fields:
            continue
        p = {"citekey": m.group(2), "item_type": BIB_TYPES_REV.get(etype, "article")}
        p["title"] = _delatex(fields.get("title", ""))
        authors = []
        for name in re.split(r"\s+and\s+", fields.get("author", ""), flags=re.I):
            name = name.strip()
            if not name:
                continue
            if name.startswith("{") and name.endswith("}") and "," not in name:
                authors.append({"literal": _delatex(name)} if not HANGUL_CJK.search(name)
                               else split_name(_delatex(name)))
            else:
                authors.append(split_name(_delatex(name)))
        p["authors"] = authors
        year = re.search(r"\d{4}", fields.get("year", "") or fields.get("date", ""))
        p["year"] = int(year.group(0)) if year else None
        p["venue"] = _delatex(fields.get("journal") or fields.get("journaltitle") or fields.get("booktitle")
                              or fields.get("school") or fields.get("institution") or "")
        for k in ("volume", "publisher", "abstract"):
            p[k] = _delatex(fields.get(k, ""))
        p["issue"] = _delatex(fields.get("number", "") or fields.get("issue", ""))
        p["pages"] = fields.get("pages", "").replace("--", "-").replace("{", "").replace("}", "").strip()
        p["doi"] = fields.get("doi", "").strip()
        p["url"] = fields.get("url", "").strip()
        if fields.get("eprint") and "arxiv" in (fields.get("archiveprefix", "") + fields.get("eprinttype", "")).lower():
            p["arxiv_id"] = fields["eprint"].strip()
        kw = fields.get("keywords", "")
        p["keywords"] = [k.strip() for k in re.split(r"[;,]", _delatex(kw)) if k.strip()]
        papers.append(p)
    return papers


# ------------------------------------------------------------------- RIS
RIS_TYPES = {"article": "JOUR", "conference": "CONF", "book": "BOOK", "chapter": "CHAP", "thesis": "THES",
             "report": "RPRT", "preprint": "UNPB", "dataset": "DATA"}
RIS_TYPES_REV = {"JOUR": "article", "JFULL": "article", "MGZN": "article", "CONF": "conference",
                 "CPAPER": "conference", "BOOK": "book", "CHAP": "chapter", "THES": "thesis",
                 "RPRT": "report", "UNPB": "preprint", "DATA": "dataset", "ELEC": "article", "GEN": "article"}


def to_ris(papers: list[dict]) -> str:
    out = []
    for p in papers:
        lines = [f"TY  - {RIS_TYPES.get(p.get('item_type') or 'article', 'GEN')}"]
        for a in p.get("authors") or []:
            name = _full(a) if _is_cjk(a) or a.get("literal") else \
                ", ".join(x for x in (a.get("family"), a.get("given")) if x)
            lines.append(f"AU  - {name}")
        lines.append(f"TI  - {p.get('title') or ''}")
        if p.get("venue"):
            lines.append(f"{'T2' if p.get('item_type') == 'conference' else 'JO'}  - {p['venue']}")
        if p.get("year"):
            lines.append(f"PY  - {p['year']}")
        for tag, key in (("VL", "volume"), ("IS", "issue"), ("PB", "publisher"), ("DO", "doi"),
                         ("UR", "url"), ("AB", "abstract")):
            if p.get(key):
                lines.append(f"{tag}  - {p[key]}")
        if p.get("pages"):
            sp, _, ep = str(p["pages"]).replace("–", "-").replace("--", "-").partition("-")
            lines.append(f"SP  - {sp}")
            if ep:
                lines.append(f"EP  - {ep}")
        for kw in p.get("keywords") or []:
            lines.append(f"KW  - {kw}")
        if p.get("arxiv_id"):
            lines.append(f"N1  - arXiv:{p['arxiv_id']}")
        lines.append("ER  - ")
        out.append("\n".join(lines))
    return "\n\n".join(out) + "\n"


def parse_ris(text: str) -> list[dict]:
    papers, cur = [], None
    sp = ep = ""
    for raw in text.splitlines():
        m = re.match(r"^([A-Z][A-Z0-9])  -\s?(.*)$", raw.rstrip())
        if not m:
            if cur is not None and raw.strip() and cur.get("_last") in ("abstract", "title"):
                cur[cur["_last"]] += " " + raw.strip()
            continue
        tag, val = m.group(1), m.group(2).strip()
        if tag == "TY":
            cur = {"item_type": RIS_TYPES_REV.get(val, "article"), "authors": [], "keywords": [], "title": "",
                   "abstract": ""}
            sp = ep = ""
            continue
        if cur is None:
            continue
        cur["_last"] = None
        if tag == "ER":
            if sp:
                cur["pages"] = sp + (f"-{ep}" if ep else "")
            cur.pop("_last", None)
            papers.append(cur)
            cur = None
        elif tag in ("AU", "A1"):
            cur["authors"].append(split_name(val))
        elif tag in ("TI", "T1"):
            cur["title"] = val
            cur["_last"] = "title"
        elif tag in ("JO", "JF", "T2", "J2", "JA", "BT") and not cur.get("venue"):
            cur["venue"] = val
        elif tag in ("PY", "Y1", "DA") and not cur.get("year"):
            y = re.search(r"\d{4}", val)
            cur["year"] = int(y.group(0)) if y else None
        elif tag == "VL":
            cur["volume"] = val
        elif tag in ("IS", "CP"):
            cur["issue"] = val
        elif tag == "SP":
            sp = val
            if "-" in val:
                sp, _, ep = val.partition("-")
        elif tag == "EP":
            ep = val
        elif tag == "PB":
            cur["publisher"] = val
        elif tag == "DO":
            cur["doi"] = val
        elif tag in ("UR", "L2") and not cur.get("url"):
            cur["url"] = val
        elif tag in ("AB", "N2"):
            cur["abstract"] = (cur["abstract"] + " " + val).strip()
            cur["_last"] = "abstract"
        elif tag == "KW":
            cur["keywords"].append(val)
        elif tag == "N1":
            am = re.search(r"arXiv:\s*([\w./\-]+)", val)
            if am:
                cur["arxiv_id"] = am.group(1)
    return papers


# -------------------------------------------------------------- CSL-JSON
CSL_TYPES = {"article": "article-journal", "conference": "paper-conference", "book": "book",
             "chapter": "chapter", "thesis": "thesis", "report": "report", "preprint": "article",
             "dataset": "dataset"}


def to_csl_json(papers: list[dict]) -> str:
    items = []
    for p in papers:
        it = {"id": p.get("citekey") or str(p.get("id")), "type": CSL_TYPES.get(p.get("item_type"), "article"),
              "title": p.get("title") or "",
              "author": [({"literal": a["literal"]} if a.get("literal") else
                          {"family": a.get("family", ""), "given": a.get("given", "")})
                         for a in p.get("authors") or []]}
        if p.get("year"):
            it["issued"] = {"date-parts": [[p["year"]]]}
        for src, dst in (("venue", "container-title"), ("volume", "volume"), ("issue", "issue"),
                         ("pages", "page"), ("publisher", "publisher"), ("doi", "DOI"), ("url", "URL"),
                         ("abstract", "abstract")):
            if p.get(src):
                it[dst] = p[src]
        items.append(it)
    return json.dumps(items, ensure_ascii=False, indent=2)


def parse_any(text: str) -> list[dict]:
    t = text.lstrip("\ufeff").strip()
    if t.startswith("@") or re.search(r"^\s*@\w+\s*\{", t, re.M):
        return parse_bibtex(t)
    if re.search(r"^TY  - ", t, re.M):
        return parse_ris(t)
    if t.startswith("["):
        items = json.loads(t)
        out = []
        for it in items:
            year = ((it.get("issued") or {}).get("date-parts") or [[None]])[0][0]
            out.append({
                "title": it.get("title", ""), "year": year,
                "authors": [{"family": a.get("family", ""), "given": a.get("given", "")} if not a.get("literal")
                            else {"literal": a["literal"]} for a in it.get("author") or []],
                "venue": it.get("container-title", ""), "volume": str(it.get("volume", "") or ""),
                "issue": str(it.get("issue", "") or ""), "pages": it.get("page", ""),
                "publisher": it.get("publisher", ""), "doi": it.get("DOI", ""), "url": it.get("URL", ""),
                "abstract": it.get("abstract", ""),
                "item_type": {v: k for k, v in CSL_TYPES.items()}.get(it.get("type"), "article"),
            })
        return out
    raise ValueError("BibTeX(.bib), RIS(.ris), CSL-JSON(.json) 형식만 가져올 수 있어요")
