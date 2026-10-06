"""인용 데이터: CSL-JSON 변환(인용 스타일은 화면의 citeproc-js가 공식 CSL로 만든다),
인용 정보 점검, BibTeX·RIS·CSL-JSON 가져오기/내보내기."""

from __future__ import annotations

import json
import re

from .sources import split_name

HANGUL_CJK = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]")
HANGUL = re.compile(r"[\uac00-\ud7a3]")
PARTICLES = {"van", "von", "de", "der", "den", "da", "di", "del", "della", "la", "le", "du", "dos", "das", "ter", "ten"}


def _is_cjk(a: dict) -> bool:
    return bool(HANGUL_CJK.search((a.get("family") or "") + (a.get("given") or "")))


def _full(a: dict) -> str:
    if a.get("literal"):
        return a["literal"]
    if _is_cjk(a):
        return (a.get("family") or "") + (a.get("given") or "")
    return " ".join(x for x in (a.get("given"), a.get("family")) if x)


# ------------------------------------------------------------- 날짜
def parse_issued(issued: str | None, year=None) -> list[int]:
    """'2017-06-12' / '2017-06' / '2017' → [2017, 6, 12]"""
    parts = [int(x) for x in re.findall(r"\d+", issued or "")[:3]]
    if parts and 1000 <= parts[0] <= 2999:
        parts = [parts[0]] + [x for x in parts[1:] if x]
        if len(parts) > 1 and not 1 <= parts[1] <= 12:
            parts = parts[:1]
        if len(parts) > 2 and not 1 <= parts[2] <= 31:
            parts = parts[:2]
        return parts
    try:
        return [int(year)] if year else []
    except (TypeError, ValueError):
        return []


def format_issued(parts: list) -> str:
    parts = [int(x) for x in parts if x]
    if not parts:
        return ""
    return "-".join([f"{parts[0]:04d}"] + [f"{x:02d}" for x in parts[1:3]])


# ---------------------------------------------------------- CSL-JSON
CSL_TYPES = {"article": "article-journal", "conference": "paper-conference", "book": "book",
             "chapter": "chapter", "thesis": "thesis", "report": "report", "preprint": "article",
             "dataset": "dataset"}
CSL_TYPES_REV = {"article-journal": "article", "article": "article", "article-magazine": "article",
                 "article-newspaper": "article", "paper-conference": "conference", "book": "book",
                 "chapter": "chapter", "thesis": "thesis", "report": "report", "dataset": "dataset",
                 "manuscript": "preprint", "post": "article", "webpage": "article"}


def _csl_name(a: dict) -> dict:
    if a.get("literal"):
        return {"literal": a["literal"]}
    if _is_cjk(a):
        # 한국어·중국어·일본어 이름은 본문 인용에서도 성만 쓰지 않도록 전체 이름 그대로 쓴다 (홍길동)
        return {"literal": _full(a)}
    family, given = (a.get("family") or "").strip(), (a.get("given") or "").strip()
    out: dict = {"family": family, "given": given}
    words = family.split(" ")
    i = 0
    while i < len(words) - 1 and words[i].lower() in PARTICLES:
        i += 1
    if i:
        out["non-dropping-particle"] = " ".join(words[:i])
        out["family"] = " ".join(words[i:])
    return out


def to_csl_item(p: dict) -> dict:
    """서재 항목을 CSL-JSON 한 건으로. citeproc-js와 Zotero가 쓰는 필드 규칙을 따른다."""
    t = p.get("item_type") or "article"
    it: dict = {
        "id": str(p.get("id") or p.get("citekey") or make_citekey(p)),
        "type": CSL_TYPES.get(t, "article"),
        "title": (p.get("title") or "").strip(),
        "author": [_csl_name(a) for a in p.get("authors") or [] if a],
    }
    if p.get("citekey"):
        it["citation-key"] = p["citekey"]
    date = parse_issued(p.get("issued"), p.get("year"))
    if date:
        it["issued"] = {"date-parts": [date]}
    doi = (p.get("doi") or "").strip()
    arxiv = (p.get("arxiv_id") or "").strip()
    if t == "preprint" or (arxiv and not p.get("venue")):
        # Zotero 방식의 프리프린트: 학술지 대신 저장소(arXiv)를 출판처로, 식별자를 번호로
        it["type"] = "article"
        it["genre"] = "Preprint"
        if arxiv:
            it["publisher"] = "arXiv"
            it["number"] = f"arXiv:{arxiv}"
            doi = doi or f"10.48550/arXiv.{arxiv}"
        elif p.get("venue"):
            it["publisher"] = p["venue"]
    elif p.get("venue"):
        it["container-title"] = p["venue"]
    if t == "thesis" and p.get("venue"):
        it.pop("container-title", None)
        it["publisher"] = p["venue"]
    for src, dst in (("volume", "volume"), ("issue", "issue"), ("pages", "page")):
        if p.get(src):
            it[dst] = str(p[src]).replace("--", "-").replace("–", "-")
    if p.get("publisher") and "publisher" not in it:
        it["publisher"] = p["publisher"]
    if doi:
        it["DOI"] = doi
    elif p.get("url"):
        it["URL"] = p["url"]
    if p.get("language"):
        it["language"] = p["language"]
    elif HANGUL.search(it["title"]):
        it["language"] = "ko"
    return it


# --------------------------------------------------------- 인용 점검
REQUIRED = {
    "article": [("venue", "학술지 이름"), ("volume", "권"), ("pages", "쪽")],
    "conference": [("venue", "학술대회(프로시딩) 이름"), ("pages", "쪽")],
    "chapter": [("venue", "책 제목"), ("publisher", "출판사"), ("pages", "쪽")],
    "book": [("publisher", "출판사")],
    "thesis": [("venue", "학위 수여 기관")],
    "report": [("publisher", "발행 기관")],
}


def citation_issues(p: dict) -> list[str]:
    """인용하기 전에 채워야 할 빈 항목을 알려준다."""
    issues = []
    if not (p.get("title") or "").strip():
        issues.append("제목")
    if not p.get("authors"):
        issues.append("저자")
    if not p.get("year") and not p.get("issued"):
        issues.append("연도")
    t = p.get("item_type") or "article"
    if t == "preprint" or (t == "article" and p.get("arxiv_id") and not p.get("venue")):
        if not p.get("arxiv_id") and not p.get("doi") and not p.get("url"):
            issues.append("arXiv ID 또는 DOI")
        return issues
    for key, label in REQUIRED.get(t, []):
        if not p.get(key):
            issues.append(label)
    return issues


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


# 인용키용 한국 성씨 로마자 표기 (흔히 쓰는 표기)
KOREAN_SURNAMES = {
    "김": "kim", "이": "lee", "박": "park", "최": "choi", "정": "jung", "강": "kang", "조": "cho", "윤": "yoon",
    "장": "jang", "임": "lim", "한": "han", "오": "oh", "서": "seo", "신": "shin", "권": "kwon", "황": "hwang",
    "안": "ahn", "송": "song", "류": "ryu", "유": "yoo", "홍": "hong", "전": "jeon", "고": "ko", "문": "moon",
    "양": "yang", "손": "son", "배": "bae", "백": "baek", "허": "heo", "노": "noh", "남": "nam", "심": "shim",
    "하": "ha", "곽": "kwak", "성": "sung", "차": "cha", "주": "joo", "우": "woo", "구": "koo", "민": "min",
    "진": "jin", "나": "na", "지": "ji", "엄": "eom", "변": "byun", "채": "chae", "원": "won", "천": "cheon",
    "방": "bang", "공": "kong", "현": "hyun", "함": "ham", "염": "yeom", "여": "yeo", "추": "choo", "도": "do",
    "소": "so", "석": "seok", "선": "sun", "설": "seol", "마": "ma", "길": "gil", "연": "yeon", "위": "wi",
    "표": "pyo", "명": "myung", "기": "ki", "반": "ban", "왕": "wang", "금": "keum", "옥": "ok", "육": "yook",
    "인": "in", "맹": "maeng", "제": "je", "모": "mo", "탁": "tak", "국": "kook", "어": "eo", "은": "eun",
    "편": "pyeon", "용": "yong", "예": "ye", "경": "kyung", "봉": "bong", "사": "sa", "부": "boo", "가": "ka",
    "복": "bok", "태": "tae", "목": "mok", "형": "hyung", "피": "pi", "두": "doo", "감": "kam", "빈": "bin",
    "동": "dong", "온": "on", "호": "ho", "범": "bum", "승": "seung", "상": "sang", "시": "si", "라": "ra",
    "제갈": "jegal", "남궁": "namgung", "황보": "hwangbo", "선우": "sunwoo", "독고": "dokgo", "서문": "seomun",
}


def _family_for_key(a: dict) -> str:
    family = (a.get("family") or a.get("literal") or "").strip()
    if HANGUL.search(family):
        two = family[:2] if family[:2] in KOREAN_SURNAMES and len(family) >= 2 else None
        return KOREAN_SURNAMES.get(two or family[:1], "")
    return re.sub(r"[^A-Za-z]", "", family.lower())


def make_citekey(p: dict) -> str:
    """vaswani2017attention · hong2023 형태의 인용 키"""
    authors = p.get("authors") or []
    family = ""
    if authors and isinstance(authors[0], dict):
        family = _family_for_key(authors[0])
    family = family or "paper"
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
        date = parse_issued(p.get("issued"), p.get("year"))
        if len(date) > 1:
            fields.append(("month", MONTHS[date[1] - 1]))
        if p.get("arxiv_id"):
            fields += [("eprint", p["arxiv_id"]), ("archivePrefix", "arXiv")]
        if p.get("abstract"):
            fields.append(("abstract", _bib_escape(p["abstract"])))
        if p.get("keywords"):
            fields.append(("keywords", _bib_escape(", ".join(p["keywords"]))))
        body = ",\n".join(f"  {k} = {{{v}}}" for k, v in fields if v)
        out.append(f"@{t}{{{p.get('citekey') or make_citekey(p)},\n{body}\n}}")
    return "\n\n".join(out) + "\n"


MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

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
        if fields.get("date"):
            p["issued"] = format_issued(parse_issued(fields["date"]))
        elif p["year"] and fields.get("month"):
            mon = fields["month"].strip().lower()[:3]
            num = MONTHS.index(mon) + 1 if mon in MONTHS else (int(mon) if mon.isdigit() and 1 <= int(mon) <= 12 else 0)
            p["issued"] = format_issued([p["year"], num])
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
        date = parse_issued(p.get("issued"), p.get("year"))
        if len(date) > 1:
            lines.append("DA  - " + "/".join(f"{x:02d}" if i else str(x) for i, x in enumerate(date)) + "/")
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
        elif tag in ("PY", "Y1", "DA"):
            date = parse_issued(val.replace("/", "-"))
            if date and not cur.get("year"):
                cur["year"] = date[0]
            if len(date) > len(parse_issued(cur.get("issued"))):
                cur["issued"] = format_issued(date)
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
def to_csl_json(papers: list[dict]) -> str:
    return json.dumps([to_csl_item(p) for p in papers], ensure_ascii=False, indent=2)


def _from_csl_name(a: dict) -> dict:
    if a.get("literal"):
        return split_name(a["literal"]) if HANGUL_CJK.search(a["literal"]) else {"literal": a["literal"]}
    family = " ".join(x for x in (a.get("non-dropping-particle"), a.get("family")) if x)
    given = " ".join(x for x in (a.get("given"), a.get("dropping-particle")) if x)
    return {"family": family, "given": given}


def parse_any(text: str) -> list[dict]:
    t = text.lstrip("\ufeff").strip()
    if t.startswith("@") or re.search(r"^\s*@\w+\s*\{", t, re.M):
        return parse_bibtex(t)
    if re.search(r"^TY  - ", t, re.M):
        return parse_ris(t)
    if t.startswith("["):
        items = json.loads(t)
        out = []
        if isinstance(items, dict):
            items = [items]
        def text(v) -> str:
            if isinstance(v, list):
                return " ".join(str(x) for x in v if x is not None)
            return "" if v is None else str(v)

        for it in items:
            if not isinstance(it, dict):
                continue
            it = {k: (v if k in ("author", "issued") else text(v)) for k, v in it.items()}
            date = ((it.get("issued") or {}).get("date-parts") or [[]])[0] or []
            number = str(it.get("number") or "")
            arxiv = re.sub(r"^arxiv:\s*", "", number, flags=re.I) if number.lower().startswith("arxiv") else ""
            doi = it.get("DOI", "") or ""
            if doi.lower().startswith("10.48550/arxiv."):
                # arXiv DOI는 서재에서 arXiv ID로 관리한다
                arxiv, doi = arxiv or doi.split(".", 2)[2], ""
            is_preprint = (it.get("genre") or "").lower() == "preprint" or number.lower().startswith("arxiv")
            out.append({
                "title": it.get("title", ""), "year": date[0] if date else None, "issued": format_issued(date),
                "authors": [_from_csl_name(a) for a in it.get("author") or [] if isinstance(a, dict)],
                "venue": it.get("container-title", "") or ("" if is_preprint else ""),
                "volume": str(it.get("volume", "") or ""), "issue": str(it.get("issue", "") or ""),
                "pages": str(it.get("page", "") or ""), "doi": doi, "url": it.get("URL", ""), "arxiv_id": arxiv,
                "publisher": "" if arxiv else it.get("publisher", ""), "abstract": it.get("abstract", ""),
                "citekey": it.get("citation-key", ""),
                "item_type": "preprint" if is_preprint else CSL_TYPES_REV.get(it.get("type"), "article"),
            })
        return out
    raise ValueError("BibTeX(.bib), RIS(.ris), CSL-JSON(.json) 형식만 가져올 수 있어요")
