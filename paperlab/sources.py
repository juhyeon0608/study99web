"""외부 학술 데이터베이스 연동.

Google Scholar는 공식 API가 없고 자동 수집을 금지하므로, 같은 기능
(검색·피인용·참고문헌·관련 논문·오픈 액세스 PDF)을 공개 API로 구현한다.

- OpenAlex: 2억 편 이상의 논문, 피인용 수, 인용 관계, OA PDF 위치
- arXiv: 프리프린트 원문
- Semantic Scholar: 검색, 피인용, TL;DR
- Crossref: DOI 메타데이터 조회
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Callable

import httpx

from . import __version__

OPENALEX = "https://api.openalex.org"
ARXIV = "https://export.arxiv.org/api/query"
S2 = "https://api.semanticscholar.org/graph/v1"
CROSSREF = "https://api.crossref.org"

S2_FIELDS = ("title,authors,year,venue,externalIds,abstract,citationCount,openAccessPdf,url,"
             "publicationTypes,journal,publicationDate")

ATOM = {"a": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom",
        "opensearch": "http://a9.com/-/spec/opensearch/1.1/"}


class SourceError(Exception):
    pass


# ------------------------------------------------------------------ helpers
def split_name(name: str) -> dict:
    name = re.sub(r"\s+", " ", (name or "").strip())
    if not name:
        return {"given": "", "family": ""}
    if "," in name:
        family, given = [x.strip() for x in name.split(",", 1)]
        return {"given": given, "family": family}
    # 한글·한자 이름은 성이 앞에 온다 (예: 홍길동)
    if re.fullmatch(r"[가-힣]{2,4}", name):
        return {"given": name[1:], "family": name[0]}
    parts = name.split(" ")
    if len(parts) == 1:
        return {"given": "", "family": parts[0]}
    particles = {"van", "von", "de", "der", "den", "da", "di", "del", "la", "le", "du"}
    i = len(parts) - 1
    while i > 1 and parts[i - 1].lower() in particles:
        i -= 1
    return {"given": " ".join(parts[:i]), "family": " ".join(parts[i:])}


def detect_identifier(text: str) -> tuple[str, str]:
    """입력 문자열이 DOI / arXiv ID / URL / 일반 검색어 중 무엇인지 판별."""
    t = (text or "").strip()
    m = re.search(r"(10\.\d{4,9}/[^\s\"<>]+)", t)
    if m:
        doi = m.group(1).rstrip(".,;)")
        if doi.lower().startswith("10.48550/arxiv."):
            return "arxiv", doi.split(".", 2)[2]
        return "doi", doi
    m = re.search(r"arxiv\.org/(?:abs|pdf)/([\w.\-/]+?)(?:v\d+)?(?:\.pdf)?$", t, re.I) or \
        re.fullmatch(r"(?:arxiv:)?\s*(\d{4}\.\d{4,5})(?:v\d+)?", t, re.I) or \
        re.fullmatch(r"(?:arxiv:)?\s*([a-z\-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?", t, re.I)
    if m:
        return "arxiv", m.group(1)
    m = re.search(r"openalex\.org/(W\d+)", t, re.I) or re.fullmatch(r"(W\d{4,})", t)
    if m:
        return "openalex", m.group(1).upper()
    if re.match(r"https?://", t):
        return "url", t
    return "query", t


def _empty(source: str) -> dict:
    return {"source": source, "title": "", "authors": [], "year": None, "venue": "", "volume": "",
            "issue": "", "pages": "", "publisher": "", "doi": "", "arxiv_id": "", "openalex_id": "",
            "s2_id": "", "url": "", "pdf_url": "", "abstract": "", "cited_by_count": None,
            "item_type": "article", "keywords": [], "tldr": "", "issued": ""}


def _openalex_abstract(inv: dict | None) -> str:
    if not inv:
        return ""
    words: dict[int, str] = {}
    for word, positions in inv.items():
        for pos in positions:
            words[pos] = word
    return " ".join(words[i] for i in sorted(words))


OPENALEX_TYPES = {"article": "article", "preprint": "preprint", "book": "book",
                  "book-chapter": "chapter", "dissertation": "thesis", "proceedings-article": "conference",
                  "review": "article", "report": "report", "dataset": "dataset"}


def norm_openalex(w: dict) -> dict:
    p = _empty("openalex")
    p["title"] = w.get("display_name") or w.get("title") or ""
    p["authors"] = [split_name((a.get("author") or {}).get("display_name", ""))
                    for a in w.get("authorships") or []]
    p["year"] = w.get("publication_year")
    p["issued"] = w.get("publication_date") or ""
    p["language"] = w.get("language") or ""
    loc = w.get("primary_location") or {}
    src = loc.get("source") or {}
    p["venue"] = src.get("display_name") or ""
    p["publisher"] = src.get("host_organization_name") or ""
    biblio = w.get("biblio") or {}
    p["volume"] = biblio.get("volume") or ""
    p["issue"] = biblio.get("issue") or ""
    if biblio.get("first_page"):
        p["pages"] = biblio["first_page"] + (f"-{biblio['last_page']}" if biblio.get("last_page") and
                                             biblio["last_page"] != biblio["first_page"] else "")
    doi = (w.get("doi") or "").replace("https://doi.org/", "")
    ids = w.get("ids") or {}
    if doi.lower().startswith("10.48550/arxiv."):
        p["arxiv_id"] = doi.split(".", 2)[2]
    else:
        p["doi"] = doi.lower()
    for l in w.get("locations") or []:
        m = re.search(r"arxiv\.org/abs/([\w.\-/]+?)(v\d+)?$", l.get("landing_page_url") or "")
        if m:
            p["arxiv_id"] = p["arxiv_id"] or m.group(1)
    p["openalex_id"] = (w.get("id") or ids.get("openalex") or "").rsplit("/", 1)[-1]
    p["url"] = loc.get("landing_page_url") or (w.get("doi") or "") or w.get("id") or ""
    oa = w.get("best_oa_location") or {}
    p["pdf_url"] = oa.get("pdf_url") or ""
    if not p["pdf_url"] and p["arxiv_id"]:
        p["pdf_url"] = f"https://arxiv.org/pdf/{p['arxiv_id']}"
    p["abstract"] = _openalex_abstract(w.get("abstract_inverted_index"))
    p["cited_by_count"] = w.get("cited_by_count")
    p["item_type"] = OPENALEX_TYPES.get(w.get("type") or "", "article")
    p["keywords"] = [k.get("display_name") for k in (w.get("keywords") or [])[:8] if k.get("display_name")]
    p["is_oa"] = bool((w.get("open_access") or {}).get("is_oa"))
    return p


def norm_arxiv_entry(e: ET.Element) -> dict:
    p = _empty("arxiv")
    text = lambda path: re.sub(r"\s+", " ", (e.findtext(path, "", ATOM) or "")).strip()  # noqa: E731
    p["title"] = text("a:title")
    p["abstract"] = text("a:summary")
    p["authors"] = [split_name(a.findtext("a:name", "", ATOM)) for a in e.findall("a:author", ATOM)]
    published = text("a:published")
    p["year"] = int(published[:4]) if published[:4].isdigit() else None
    p["issued"] = published[:10]
    abs_url = text("a:id")
    m = re.search(r"arxiv\.org/abs/(.+?)(v\d+)?$", abs_url)
    p["arxiv_id"] = m.group(1) if m else ""
    p["url"] = f"https://arxiv.org/abs/{p['arxiv_id']}" if p["arxiv_id"] else abs_url
    p["pdf_url"] = f"https://arxiv.org/pdf/{p['arxiv_id']}" if p["arxiv_id"] else ""
    p["doi"] = text("arxiv:doi").lower()
    journal = text("arxiv:journal_ref")
    p["venue"] = journal or "arXiv"
    p["item_type"] = "article" if journal else "preprint"
    p["keywords"] = [c.get("term") for c in e.findall("a:category", ATOM) if c.get("term")][:6]
    p["is_oa"] = True
    return p


def norm_s2(d: dict) -> dict:
    p = _empty("semanticscholar")
    p["title"] = d.get("title") or ""
    p["authors"] = [split_name(a.get("name", "")) for a in d.get("authors") or []]
    p["year"] = d.get("year")
    p["issued"] = d.get("publicationDate") or ""
    journal = d.get("journal") or {}
    p["venue"] = d.get("venue") or journal.get("name") or ""
    p["volume"] = journal.get("volume") or ""
    p["pages"] = (journal.get("pages") or "").strip()
    ext = d.get("externalIds") or {}
    p["doi"] = (ext.get("DOI") or "").lower()
    p["arxiv_id"] = ext.get("ArXiv") or ""
    p["s2_id"] = d.get("paperId") or ""
    p["url"] = d.get("url") or ""
    p["pdf_url"] = (d.get("openAccessPdf") or {}).get("url") or ""
    p["abstract"] = d.get("abstract") or ""
    p["cited_by_count"] = d.get("citationCount")
    types = d.get("publicationTypes") or []
    p["item_type"] = "conference" if "Conference" in types else ("article" if types else "article")
    p["tldr"] = (d.get("tldr") or {}).get("text") or ""
    p["is_oa"] = bool(p["pdf_url"])
    return p


CROSSREF_TYPES = {"journal-article": "article", "proceedings-article": "conference", "book": "book",
                  "book-chapter": "chapter", "posted-content": "preprint", "dissertation": "thesis",
                  "report": "report", "dataset": "dataset"}


def norm_crossref(m: dict) -> dict:
    p = _empty("crossref")
    p["title"] = " ".join(m.get("title") or [])
    p["authors"] = [{"given": a.get("given", ""), "family": a.get("family", "") or a.get("name", "")}
                    for a in m.get("author") or []]
    for key in ("published-print", "published-online", "issued", "created"):
        parts = (m.get(key) or {}).get("date-parts") or [[None]]
        if parts and parts[0] and parts[0][0]:
            p["year"] = parts[0][0]
            p["issued"] = "-".join([f"{parts[0][0]:04d}"] + [f"{x:02d}" for x in parts[0][1:3] if x])
            break
    if m.get("language"):
        p["language"] = m["language"]
    p["venue"] = " ".join(m.get("container-title") or [])
    if not p["venue"] and m.get("type") == "dissertation":
        p["venue"] = ((m.get("institution") or [{}])[0] or {}).get("name", "")
    p["volume"] = m.get("volume") or ""
    p["issue"] = m.get("issue") or ""
    p["pages"] = (m.get("page") or "").replace("--", "-")
    p["publisher"] = m.get("publisher") or ""
    p["doi"] = (m.get("DOI") or "").lower()
    p["url"] = m.get("URL") or (f"https://doi.org/{p['doi']}" if p["doi"] else "")
    abstract = m.get("abstract") or ""
    p["abstract"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", abstract)).strip()
    p["cited_by_count"] = m.get("is-referenced-by-count")
    p["item_type"] = CROSSREF_TYPES.get(m.get("type") or "", "article")
    for link in m.get("link") or []:
        if link.get("content-type") == "application/pdf":
            p["pdf_url"] = link.get("URL", "")
            break
    return p


# ------------------------------------------------------------------- client
class Sources:
    def __init__(self, get_setting: Callable[[str], str], transport: httpx.BaseTransport | None = None):
        self.get_setting = get_setting
        self._transport = transport

    def _client(self) -> httpx.Client:
        email = self.get_setting("contact_email") or ""
        ua = f"PaperLab/{__version__}" + (f" (mailto:{email})" if email else "")
        return httpx.Client(timeout=httpx.Timeout(20.0, connect=10.0), follow_redirects=True,
                            headers={"User-Agent": ua}, transport=self._transport)

    def _get_json(self, url: str, params: dict | None = None, headers: dict | None = None) -> dict:
        try:
            with self._client() as c:
                r = c.get(url, params=params, headers=headers)
        except httpx.HTTPError as e:
            raise SourceError(f"{url.split('/')[2]}에 연결할 수 없어요: {e}") from e
        if r.status_code == 404:
            raise SourceError("찾을 수 없어요 (404)")
        if r.status_code == 429:
            raise SourceError(f"{url.split('/')[2]} 요청 한도를 넘었어요. 잠시 후 다시 시도하거나 설정에서 API 키를 넣어주세요.")
        if r.status_code >= 400:
            raise SourceError(f"{url.split('/')[2]} 오류 ({r.status_code})")
        return r.json()

    def _openalex_params(self, params: dict) -> dict:
        email = self.get_setting("contact_email")
        key = self.get_setting("openalex_api_key")
        if email:
            params["mailto"] = email
        if key:
            params["api_key"] = key
        return params

    def _s2_headers(self) -> dict:
        key = self.get_setting("semantic_scholar_api_key")
        return {"x-api-key": key} if key else {}

    # ------------------------------------------------------------- search
    def search(self, query: str, source: str = "openalex", page: int = 1, per_page: int = 20,
               year_from: int | None = None, year_to: int | None = None, sort: str = "relevance",
               open_access: bool = False) -> dict:
        query = (query or "").strip()
        if not query:
            return {"items": [], "total": 0}
        if source == "arxiv":
            return self._search_arxiv(query, page, per_page, sort, year_from, year_to)
        if source == "semanticscholar":
            return self._search_s2(query, page, per_page, year_from, year_to, open_access)
        if source == "crossref":
            return self._search_crossref(query, page, per_page, year_from, year_to, sort)
        return self._search_openalex(query, page, per_page, year_from, year_to, sort, open_access)

    def _year_range(self, year_from, year_to) -> str:
        if year_from and year_to:
            return f"{year_from}-{year_to}"
        if year_from:
            return f"{year_from}-"
        if year_to:
            return f"-{year_to}"
        return ""

    def _search_openalex(self, query, page, per_page, year_from, year_to, sort, open_access):
        filters = []
        yr = self._year_range(year_from, year_to)
        if yr:
            filters.append(f"publication_year:{yr}")
        if open_access:
            filters.append("is_oa:true")
        params = {"search": query, "page": page, "per-page": per_page}
        if filters:
            params["filter"] = ",".join(filters)
        if sort == "cited":
            params["sort"] = "cited_by_count:desc"
        elif sort == "date":
            params["sort"] = "publication_date:desc"
        data = self._get_json(f"{OPENALEX}/works", self._openalex_params(params))
        return {"items": [norm_openalex(w) for w in data.get("results") or []],
                "total": (data.get("meta") or {}).get("count", 0)}

    def _search_arxiv(self, query, page, per_page, sort, year_from, year_to):
        q = query if re.search(r"\b(ti|au|abs|cat|all):", query) else \
            " AND ".join(f"all:{w}" for w in query.split())
        if year_from or year_to:
            start = f"{year_from or 1991}01010000"
            end = f"{year_to or 2100}12312359"
            q = f"({q}) AND submittedDate:[{start} TO {end}]"
        params = {"search_query": q, "start": (page - 1) * per_page, "max_results": per_page,
                  "sortBy": {"date": "submittedDate"}.get(sort, "relevance"), "sortOrder": "descending"}
        try:
            with self._client() as c:
                r = c.get(ARXIV, params=params)
        except httpx.HTTPError as e:
            raise SourceError(f"arXiv에 연결할 수 없어요: {e}") from e
        if r.status_code >= 400:
            raise SourceError(f"arXiv 오류 ({r.status_code})")
        return parse_arxiv_feed(r.text)

    def _search_s2(self, query, page, per_page, year_from, year_to, open_access):
        params = {"query": query, "offset": (page - 1) * per_page, "limit": per_page, "fields": S2_FIELDS}
        yr = self._year_range(year_from, year_to)
        if yr:
            params["year"] = yr
        if open_access:
            params["openAccessPdf"] = ""
        data = self._get_json(f"{S2}/paper/search", params, self._s2_headers())
        return {"items": [norm_s2(d) for d in data.get("data") or []], "total": data.get("total", 0)}

    def _search_crossref(self, query, page, per_page, year_from, year_to, sort):
        params = {"query.bibliographic": query, "rows": per_page, "offset": (page - 1) * per_page}
        filters = []
        if year_from:
            filters.append(f"from-pub-date:{year_from}")
        if year_to:
            filters.append(f"until-pub-date:{year_to}")
        if filters:
            params["filter"] = ",".join(filters)
        if sort == "cited":
            params["sort"], params["order"] = "is-referenced-by-count", "desc"
        elif sort == "date":
            params["sort"], params["order"] = "published", "desc"
        email = self.get_setting("contact_email")
        if email:
            params["mailto"] = email
        data = self._get_json(f"{CROSSREF}/works", params)
        msg = data.get("message") or {}
        return {"items": [norm_crossref(m) for m in msg.get("items") or []],
                "total": msg.get("total-results", 0)}

    # ------------------------------------------------------------- lookup
    def lookup_doi(self, doi: str) -> dict:
        try:
            data = self._get_json(f"{CROSSREF}/works/{doi}")
            p = norm_crossref(data.get("message") or {})
        except SourceError:
            p = None
        try:
            w = self._get_json(f"{OPENALEX}/works/doi:{doi}", self._openalex_params({}))
            oa = norm_openalex(w)
        except SourceError:
            oa = None
        if not p and not oa:
            raise SourceError(f"DOI {doi} 정보를 찾지 못했어요")
        return merge(p or _empty("crossref"), oa) if oa else p

    def lookup_arxiv(self, arxiv_id: str) -> dict:
        try:
            with self._client() as c:
                r = c.get(ARXIV, params={"id_list": arxiv_id, "max_results": 1})
        except httpx.HTTPError as e:
            raise SourceError(f"arXiv에 연결할 수 없어요: {e}") from e
        items = parse_arxiv_feed(r.text)["items"] if r.status_code < 400 else []
        if not items or not items[0]["title"]:
            raise SourceError(f"arXiv {arxiv_id} 정보를 찾지 못했어요")
        return items[0]

    def lookup_openalex(self, work_id: str) -> dict:
        return norm_openalex(self._get_json(f"{OPENALEX}/works/{work_id}", self._openalex_params({})))

    def resolve(self, text: str) -> dict:
        kind, value = detect_identifier(text)
        if kind == "doi":
            return self.lookup_doi(value)
        if kind == "arxiv":
            return self.lookup_arxiv(value)
        if kind == "openalex":
            return self.lookup_openalex(value)
        if kind == "url":
            raise SourceError("이 URL에서는 논문 정보를 찾지 못했어요. DOI나 arXiv 주소를 넣어주세요.")
        res = self.search(value, "openalex", per_page=1)
        if not res["items"]:
            raise SourceError("일치하는 논문을 찾지 못했어요")
        return res["items"][0]

    def match_title(self, title: str) -> dict | None:
        """PDF에서 읽은 제목으로 메타데이터를 찾는다 (제목이 충분히 비슷할 때만)."""
        from .db import normalize_title
        try:
            res = self.search(title, "openalex", per_page=3)
        except SourceError:
            return None
        target = normalize_title(title)
        for item in res["items"]:
            cand = normalize_title(item["title"])
            if cand and (cand == target or (len(target) > 20 and (cand in target or target in cand))):
                return item
        return None

    # ---------------------------------------------------- citation graph
    def _openalex_id_for(self, paper: dict) -> str:
        if paper.get("openalex_id"):
            return paper["openalex_id"]
        if paper.get("doi"):
            return self.lookup_openalex(f"doi:{paper['doi']}")["openalex_id"]
        if paper.get("arxiv_id"):
            return self.lookup_openalex(f"doi:10.48550/arxiv.{paper['arxiv_id']}")["openalex_id"]
        match = self.match_title(paper.get("title") or "")
        if match:
            return match["openalex_id"]
        raise SourceError("이 논문을 OpenAlex에서 찾지 못했어요. DOI를 입력하면 정확해져요.")

    def related(self, paper: dict, kind: str, page: int = 1, per_page: int = 20) -> dict:
        """kind: cited_by(이 논문을 인용한 논문) | references(참고문헌) | related(관련 논문)"""
        wid = self._openalex_id_for(paper)
        if kind == "cited_by":
            data = self._get_json(f"{OPENALEX}/works", self._openalex_params(
                {"filter": f"cites:{wid}", "page": page, "per-page": per_page, "sort": "cited_by_count:desc"}))
            return {"items": [norm_openalex(w) for w in data.get("results") or []],
                    "total": (data.get("meta") or {}).get("count", 0), "openalex_id": wid}
        work = self._get_json(f"{OPENALEX}/works/{wid}", self._openalex_params({}))
        key = "referenced_works" if kind == "references" else "related_works"
        ids = [u.rsplit("/", 1)[-1] for u in work.get(key) or []]
        total = len(ids)
        ids = ids[(page - 1) * per_page: page * per_page]
        if not ids:
            return {"items": [], "total": total, "openalex_id": wid}
        data = self._get_json(f"{OPENALEX}/works", self._openalex_params(
            {"filter": "openalex:" + "|".join(ids), "per-page": len(ids)}))
        items = [norm_openalex(w) for w in data.get("results") or []]
        if kind == "references":
            items.sort(key=lambda x: -(x.get("cited_by_count") or 0))
        return {"items": items, "total": total, "openalex_id": wid}

    def download_pdf(self, url: str, max_bytes: int = 100 * 1024 * 1024) -> bytes:
        if not url:
            raise SourceError("PDF 주소가 없어요")
        if re.match(r"https?://arxiv\.org/abs/", url):
            url = url.replace("/abs/", "/pdf/")
        try:
            with self._client() as c, c.stream("GET", url, headers={"Accept": "application/pdf"}) as r:
                if r.status_code >= 400:
                    raise SourceError(f"PDF를 받을 수 없어요 ({r.status_code})")
                chunks, size = [], 0
                for chunk in r.iter_bytes():
                    size += len(chunk)
                    if size > max_bytes:
                        raise SourceError("PDF가 너무 커요 (100MB 초과)")
                    chunks.append(chunk)
        except httpx.HTTPError as e:
            raise SourceError(f"PDF 다운로드 실패: {e}") from e
        data = b"".join(chunks)
        if not data.startswith(b"%PDF"):
            raise SourceError("받은 파일이 PDF가 아니에요 (출판사 로그인 페이지일 수 있어요)")
        return data


def parse_arxiv_feed(xml_text: str) -> dict:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as e:
        raise SourceError("arXiv 응답을 읽을 수 없어요") from e
    entries = [norm_arxiv_entry(e) for e in root.findall("a:entry", ATOM)]
    entries = [e for e in entries if e["title"] and e["title"].lower() != "error"]
    total = root.findtext("opensearch:totalResults", "0", ATOM)
    return {"items": entries, "total": int(total) if total.isdigit() else len(entries)}


def merge(base: dict, extra: dict | None) -> dict:
    """base의 빈 필드를 extra로 채운다."""
    if not extra:
        return base
    out = dict(base)
    for k, v in extra.items():
        if k == "source":
            continue
        if out.get(k) in (None, "", [], 0) and v not in (None, "", []):
            out[k] = v
    if extra.get("cited_by_count") is not None:
        out["cited_by_count"] = max(out.get("cited_by_count") or 0, extra["cited_by_count"])
    return out
