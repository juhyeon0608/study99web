"""외부 학술 데이터베이스 연동.

Google Scholar는 공식 API가 없고 자동 수집을 금지하므로, 같은 기능
(검색·피인용·참고문헌·관련 논문·오픈 액세스 PDF)을 공개 API로 구현한다.

- OpenAlex: 2억 편 이상의 논문, 피인용 수, 인용 관계, OA PDF 위치
- arXiv: 프리프린트 원문
- Semantic Scholar: 검색, 피인용, TL;DR
- Crossref: DOI 메타데이터 조회
"""

from __future__ import annotations

import ipaddress
import json
import logging
import re
import socket
import threading
import time
import xml.etree.ElementTree as ET
from typing import Callable
from urllib.parse import quote

import httpx

from . import __version__

log = logging.getLogger("paperlab.sources")

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
    def __init__(self, get_setting: Callable[[str], str], transport: httpx.BaseTransport | None = None,
                 resolver: Callable[[str, int], list[str]] | None = None):
        self.get_setting = get_setting
        self._transport = transport
        # 사용자 주소로 PDF를 받을 때 쓰는 DNS 해석 (테스트에서 바꿔 넣음)
        self._resolver = resolver or _resolve_host

    def _client(self, email: bool = False) -> httpx.Client:
        # 사용자 연락처 이메일은 Crossref(polite pool)에만 보낸다. OpenAlex · arXiv · Semantic Scholar · PDF 받기(임의 서버)에는
        # 보내지 않는다(인용 그래프 명세 K-6, 팀장 결정 2026-10-07)
        email_addr = (self.get_setting("contact_email") or "") if email else ""
        ua = f"PaperLab/{__version__}" + (f" (mailto:{email_addr})" if email_addr else "")
        return httpx.Client(timeout=httpx.Timeout(20.0, connect=10.0), follow_redirects=True,
                            headers={"User-Agent": ua}, transport=self._transport)

    def _get_json(self, url: str, params: dict | None = None, headers: dict | None = None) -> dict:
        host = url.split("/")[2]

        def same_host_only(request: httpx.Request) -> None:
            # 리디렉션은 같은 호스트 안에서만 따라간다 — 다른 호스트로 이메일(Crossref) · 키가 넘어가지 않게 (품질팀 M-8)
            if request.url.host != host:
                raise SourceError(f"{host} 오류 (다른 주소로 이동)")

        try:
            with self._client(email=url.startswith(CROSSREF)) as c:
                c.event_hooks["request"] = [same_host_only]
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
        # mailto는 보내지 않는다(OpenAlex가 무시 — 사용자 이메일만 밖으로 나감. 인용 그래프 명세 K-6)
        key = self.get_setting("openalex_api_key")
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

    def _public_ip(self, host: str, port: int) -> str:
        """호스트를 해석해 모든 주소가 공인 주소일 때만 첫 주소를 돌려준다 (SSRF 방지)"""
        name = host.strip("[]").lower().rstrip(".")
        if not name or name in BLOCKED_HOSTS or name.endswith(BLOCKED_SUFFIXES):
            raise SourceError(PDF_FETCH_FAILED)
        try:
            ips = self._resolver(name, port)
        except (OSError, UnicodeError):
            raise SourceError(PDF_FETCH_FAILED) from None
        if not ips or not all(_ip_is_public(ip) for ip in ips):
            raise SourceError(PDF_FETCH_FAILED)
        return ips[0]

    def download_pdf(self, url: str, max_bytes: int = 100 * 1024 * 1024) -> bytes:
        """사용자가 준 주소에서 PDF를 받는다.

        SSRF 방지: http/https만, 계정 정보 든 주소 거부, DNS를 해석해 사설 · 루프백 · 링크로컬(메타데이터 169.254.169.254) ·
        예약 주소면 거부, 검사한 IP로 직접 연결(이름 재해석 방지, https는 SNI · 인증서는 원래 이름으로),
        리디렉션은 직접 따라가며 단계마다 같은 검사. 실패 문구는 하나로(내부 탐색 단서를 주지 않음).
        """
        if not url:
            raise SourceError("PDF 주소가 없어요")
        if re.match(r"https?://arxiv\.org/abs/", url):
            url = url.replace("/abs/", "/pdf/")
        try:
            current = httpx.URL(url)
        except (httpx.InvalidURL, TypeError, ValueError):
            raise SourceError(PDF_FETCH_FAILED) from None
        chunks: list[bytes] = []
        try:
            with self._client() as c:
                for _ in range(MAX_REDIRECTS + 1):
                    if current.scheme not in ("http", "https") or not current.host or current.userinfo:
                        raise SourceError(PDF_FETCH_FAILED)
                    port = current.port or (443 if current.scheme == "https" else 80)
                    ip = self._public_ip(current.host, port)
                    target = current.copy_with(host=ip)
                    headers = {"Accept": "application/pdf", "Host": current.netloc.decode("ascii")}
                    ext = {"sni_hostname": current.host} if current.scheme == "https" else {}
                    with c.stream("GET", target, headers=headers, extensions=ext, follow_redirects=False) as r:
                        if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                            current = current.join(r.headers["location"])
                            continue
                        if r.status_code >= 400:
                            raise SourceError(PDF_FETCH_FAILED)
                        size = 0
                        for chunk in r.iter_bytes():
                            size += len(chunk)
                            if size > max_bytes:
                                raise SourceError("PDF가 너무 커요 (100MB 초과)")
                            chunks.append(chunk)
                        break
                else:
                    raise SourceError(PDF_FETCH_FAILED)  # 리디렉션이 너무 많음
        except (httpx.HTTPError, httpx.InvalidURL, ValueError, UnicodeError):
            raise SourceError(PDF_FETCH_FAILED) from None
        data = b"".join(chunks)
        if not data.startswith(b"%PDF"):
            raise SourceError("받은 파일이 PDF가 아니에요 (출판사 로그인 페이지일 수 있어요)")
        return data


PDF_FETCH_FAILED = "PDF를 받지 못했어요. 주소를 확인하거나 직접 파일을 첨부해 주세요."
MAX_REDIRECTS = 5
BLOCKED_HOSTS = {"localhost", "metadata", "metadata.google.internal", "instance-data"}
BLOCKED_SUFFIXES = (".localhost", ".internal", ".local", ".localdomain", ".home.arpa")


def _resolve_host(host: str, port: int) -> list[str]:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]).split("%")[0] for info in infos))


def _ip_is_public(value: str) -> bool:
    """공인(전역) 유니캐스트 주소만 True. IPv4 매핑 · 6to4 · Teredo 안의 IPv4도 검사한다."""
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    inner = []
    if ip.version == 6:
        if ip.ipv4_mapped:
            inner.append(ip.ipv4_mapped)
        if ip.sixtofour:
            inner.append(ip.sixtofour)
        if ip.teredo:
            inner.extend(ip.teredo)
    for x in [ip, *inner]:
        if not x.is_global or x.is_multicast or x.is_reserved or x.is_unspecified:
            return False
    return True


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


# =========================================================== 인용 그래프용 호출 (docs/specs/citation-graph.md 7 · 9.5장)
# 고정 주소 두 곳(OPENALEX · S2)에만 요청한다. 사용자 이메일(mailto · User-Agent)은 보내지 않는다.
# 리디렉션은 따라가지 않고(3xx = 실패), 응답은 10MB까지, 오류 문구 · 로그는 호스트 + 상태 코드만(주소 · 식별자 없음).
OPENALEX_HOST = "api.openalex.org"
S2_HOST = "api.semanticscholar.org"
GRAPH_UA = f"PaperLab/{__version__}"
GRAPH_MAX_BYTES = 10 * 1024 * 1024
GRAPH_TIMEOUT = httpx.Timeout(15.0, connect=5.0)
RETRY_AFTER_MAX = 5.0
OA_NO_MAX = 10 ** 12 - 1  # W 뒤 최대 12자리 (명세 9.5)
_OA_WORK_RE = re.compile(r"^https://openalex\.org/W([0-9]+)$")
# select 필드: 서지(norm_openalex가 쓰는 것) / + 참고문헌 · 관련 논문 / + 초록
GRAPH_META_FIELDS = ("id", "doi", "display_name", "authorships", "publication_year", "publication_date", "language",
                     "primary_location", "biblio", "locations", "best_oa_location", "cited_by_count", "type",
                     "open_access", "referenced_works_count")
GRAPH_LINK_FIELDS = ("referenced_works", "related_works")
GRAPH_ABSTRACT_FIELDS = ("abstract_inverted_index",)
MAX_AUTHORS_STORED = 20
MAX_REFS_STORED = 500
MAX_RELATED_STORED = 20


class UpstreamError(SourceError):
    """외부 호출 실패. 문구에는 호스트 · 상태만 (요청 주소 · 식별자를 넣지 않음)"""

    def __init__(self, host: str, status: int | None = None, limited: bool = False, location: str = ""):
        self.host, self.status, self.limited = host, status, limited
        self.location = location  # 3xx의 Location (합쳐진 작품 번호 따라가기에만 씀 — 로그 · 문구에는 넣지 않음)
        super().__init__(f"{host} 오류" + (f" ({status})" if status else ""))


class GraphCancelled(Exception):
    """그래프 요청이 끊김(탭 닫기 등)"""


class GraphDeadline(Exception):
    """그래프 하나 전체 기한(45초)을 넘김"""


class GraphBudget(Exception):
    """그래프 1회 목록 · 검색 호출 상한(12회)을 넘김"""


class _TooLarge(Exception):
    pass


class RateLimiter:
    """서버 전체 속도 제한: 요청 시작 간격을 1/rate초 이상으로 (스레드 안전)"""

    def __init__(self, rate: float, clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep):
        self.interval = 1.0 / rate if rate > 0 else 0.0
        self.clock, self.sleep = clock, sleep
        self._next = 0.0
        self._lock = threading.Lock()

    def acquire(self) -> None:
        if not self.interval:
            return
        with self._lock:
            now = self.clock()
            at = max(now, self._next)
            self._next = at + self.interval
        if at > now:
            self.sleep(at - now)


OPENALEX_LIMITER = RateLimiter(10)  # 공식 초당 100보다 훨씬 낮게 (7.5절)
S2_LIMITER = RateLimiter(1)


def _text(v, n: int) -> str:
    if not isinstance(v, str):
        v = str(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else ""
    return v.replace("\x00", "").strip()[:n]


def _nonneg(v) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return 0
    try:
        n = int(v)
    except (OverflowError, ValueError):
        return 0
    return n if 0 <= n <= 2_000_000_000 else 0


def _http_url(v) -> str:
    s = v.strip() if isinstance(v, str) else ""
    return s[:2000] if re.match(r"https?://", s, re.I) else ""


def oa_work_no(value) -> int | None:
    """'https://openalex.org/W123' → 123. 다른 모양 · 범위 밖은 None"""
    if not isinstance(value, str):
        return None
    m = _OA_WORK_RE.match(value)
    if not m or len(m.group(1)) > 12:
        return None
    n = int(m.group(1))
    return n if 0 < n <= OA_NO_MAX else None


_MERGED_PATH_RE = re.compile(r"/works/W([1-9][0-9]{0,11})")


def merged_work_no(location: str) -> int | None:
    """3xx Location → 새 작품 번호. 같은 상수 호스트(https://api.openalex.org)의 /works/W<번호>만, 그 밖은 None"""
    if not isinstance(location, str) or not location:
        return None
    try:
        u = httpx.URL(OPENALEX).join(location.strip())
    except (httpx.InvalidURL, ValueError, TypeError):
        return None
    if u.scheme != "https" or u.host != OPENALEX_HOST or u.port not in (None, 443) or u.userinfo:
        return None
    m = _MERGED_PATH_RE.fullmatch(u.path)
    return int(m.group(1)) if m else None


def _no_list(values, cap: int) -> list[int]:
    if not isinstance(values, list):
        return []
    out: dict[int, None] = {}
    for v in values:
        n = oa_work_no(v)
        if n:
            out[n] = None
    return list(out)[:cap]


def graph_work(w, fields) -> dict | None:
    """OpenAlex 작품 하나를 검사 · 정리해 캐시 행 모양으로 (명세 8.2 · 9.5). 이상한 작품은 None.

    refs · related는 select에 넣었을 때만 목록(아니면 None — 받지 않음), abstract도 같음.
    """
    if not isinstance(w, dict):
        return None
    no = oa_work_no(w.get("id"))
    if not no:
        return None
    try:
        p = norm_openalex(w)
    except (AttributeError, TypeError, ValueError, KeyError):
        p = _empty("openalex")
        p["title"] = w.get("display_name") if isinstance(w.get("display_name"), str) else ""
    raw_doi = w.get("doi") if isinstance(w.get("doi"), str) else ""
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", raw_doi.strip(), flags=re.I).lower()[:300]
    if not doi.startswith("10."):
        doi = ""
    authors = []
    for a in (p.get("authors") or [])[:MAX_AUTHORS_STORED]:
        if isinstance(a, dict):
            authors.append({"given": _text(a.get("given"), 200), "family": _text(a.get("family"), 200)})
    year = p.get("year")
    year = year if isinstance(year, int) and not isinstance(year, bool) and 0 < year < 3000 else None
    ships = w.get("authorships")
    row = {
        "no": no, "doi": doi, "arxiv_id": _text(p.get("arxiv_id"), 300), "title": _text(p.get("title"), 1000),
        "authors": authors, "author_count": len(ships) if isinstance(ships, list) else len(authors), "year": year,
        "issued": _text(p.get("issued"), 300), "venue": _text(p.get("venue"), 300),
        "publisher": _text(p.get("publisher"), 300), "volume": _text(p.get("volume"), 300),
        "issue": _text(p.get("issue"), 300), "pages": _text(p.get("pages"), 300),
        "item_type": _text(p.get("item_type"), 300) or "article", "language": _text(p.get("language"), 300),
        "url": _http_url(p.get("url")), "pdf_url": _http_url(p.get("pdf_url")), "is_oa": bool(p.get("is_oa")),
        "cited_by_count": _nonneg(w.get("cited_by_count")), "reference_count": _nonneg(w.get("referenced_works_count")),
        "refs": None, "refs_total": 0, "related": None, "abstract": None,
    }
    fields = set(fields)
    if "referenced_works" in fields:
        raw = w.get("referenced_works")
        all_refs = _no_list(raw, 100_000)
        row["refs"] = all_refs[:MAX_REFS_STORED]
        row["refs_total"] = max(row["reference_count"], len(all_refs))
        if not row["reference_count"]:
            row["reference_count"] = len(all_refs)
    if "related_works" in fields:
        row["related"] = _no_list(w.get("related_works"), MAX_RELATED_STORED)
    if "abstract_inverted_index" in fields:
        inv = w.get("abstract_inverted_index")
        try:
            text = _openalex_abstract(inv) if isinstance(inv, dict) else ""
        except (TypeError, AttributeError, ValueError):
            text = ""
        row["abstract"] = _text(text, 5000)
    return row


def _retry_after(headers) -> float:
    v = (headers.get("retry-after") or "").strip()
    try:
        return max(0.0, min(RETRY_AFTER_MAX, float(v)))
    except ValueError:
        return 1.0


class GraphSources:
    """그래프 1회분 외부 호출. 호출 수 · 남은 예산 · 하루 한도 소진 상태를 기억한다.

    openalex_key: 요청한 사용자의 OpenAlex 키(없으면 키 없이 — K-5), s2_key: 사용자의 S2 키.
    clock · sleep · transport는 테스트에서 바꿔 넣는다. deadline = clock() 기준 기한(전체 45초), cancel = threading.Event.
    """

    def __init__(self, openalex_key: str = "", s2_key: str = "", *, transport: httpx.BaseTransport | None = None,
                 clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep,
                 oa_limiter: RateLimiter | None = None, s2_limiter: RateLimiter | None = None,
                 max_list_calls: int = 12, deadline: float | None = None, cancel: threading.Event | None = None):
        self.openalex_key = openalex_key or ""
        self.s2_key = s2_key or ""
        self._transport = transport
        self.clock, self._sleep = clock, sleep
        self.oa_limiter = oa_limiter or OPENALEX_LIMITER
        self.s2_limiter = s2_limiter or S2_LIMITER
        self.max_list_calls = max_list_calls
        self.deadline = deadline
        self.cancel = cancel
        self.list_calls = 0
        self.single_calls = 0
        self.s2_calls = 0
        self.limited = False  # OpenAlex 하루 한도 소진(429 + X-RateLimit-Remaining: 0)
        self.remaining: int | None = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------ 공통
    def check_cancel(self) -> None:
        if self.cancel is not None and self.cancel.is_set():
            raise GraphCancelled()

    def check(self) -> None:
        self.check_cancel()
        if self.deadline is not None and self.clock() >= self.deadline:
            raise GraphDeadline()

    def budget_left(self) -> int:
        with self._lock:
            return max(0, self.max_list_calls - self.list_calls)

    def _log(self, host: str, status: int | None) -> None:
        log.warning(json.dumps({"event": "upstream_error", "host": host, "status": status}))

    def _fetch(self, url: str, params: dict, headers: dict) -> tuple[int, httpx.Headers, bytes]:
        with httpx.Client(timeout=GRAPH_TIMEOUT, follow_redirects=False, headers={"User-Agent": GRAPH_UA},
                          transport=self._transport) as c:
            with c.stream("GET", url, params=params, headers=headers) as r:
                if not 200 <= r.status_code < 300:
                    return r.status_code, r.headers, b""
                length = r.headers.get("content-length") or ""
                if length.isdigit() and int(length) > GRAPH_MAX_BYTES:
                    raise _TooLarge()
                buf = bytearray()
                for chunk in r.iter_bytes():
                    buf.extend(chunk)
                    if len(buf) > GRAPH_MAX_BYTES:
                        raise _TooLarge()
                return r.status_code, r.headers, bytes(buf)

    def _send(self, base: str, host: str, path: str, params: dict, headers: dict, kind: str) -> dict:
        limiter = self.s2_limiter if host == S2_HOST else self.oa_limiter
        retried = False
        while True:
            self.check()
            if host == OPENALEX_HOST and self.limited:
                raise UpstreamError(host, 429, limited=True)
            with self._lock:
                if kind == "list":
                    if self.list_calls >= self.max_list_calls:
                        raise GraphBudget()
                    self.list_calls += 1
                elif kind == "single":
                    self.single_calls += 1
                else:
                    self.s2_calls += 1
            limiter.acquire()
            self.check()
            try:
                status, hdrs, body = self._fetch(base + path, params, headers)
            except (httpx.ConnectError, httpx.ConnectTimeout):  # 연결 오류만 한 번 더
                self._log(host, None)
                if not retried:
                    retried = True
                    self._sleep(1.0)
                    continue
                raise UpstreamError(host) from None
            except (httpx.HTTPError, _TooLarge, httpx.InvalidURL):  # 읽기 시간 초과 · 크기 초과 등: 재시도 없음
                self._log(host, None)
                raise UpstreamError(host) from None
            rem = (hdrs.get("x-ratelimit-remaining") or "").strip()
            if host == OPENALEX_HOST and rem.isdigit():
                self.remaining = int(rem)
            if status == 429:
                self._log(host, 429)
                if rem == "0":  # 하루 예산 소진: 재시도하지 않음
                    if host == OPENALEX_HOST:
                        self.limited = True
                    raise UpstreamError(host, 429, limited=host == OPENALEX_HOST)
                if not retried:
                    retried = True
                    self._sleep(_retry_after(hdrs))
                    continue
                raise UpstreamError(host, 429)
            if status >= 500:
                self._log(host, status)
                if not retried:
                    retried = True
                    self._sleep(1.0)
                    continue
                raise UpstreamError(host, status)
            if not 200 <= status < 300:  # 3xx(리디렉션 따라가지 않음) · 4xx
                self._log(host, status)
                raise UpstreamError(host, status, location=hdrs.get("location") or "" if 300 <= status < 400 else "")
            try:
                data = json.loads(body)
            except ValueError:
                self._log(host, status)
                raise UpstreamError(host, status) from None
            if not isinstance(data, dict):
                self._log(host, status)
                raise UpstreamError(host, status)
            return data

    def _oa(self, path: str, params: dict, kind: str) -> dict:
        params = dict(params)
        if self.openalex_key:
            params["api_key"] = self.openalex_key
        return self._send(OPENALEX, OPENALEX_HOST, path, params, {}, kind)

    @staticmethod
    def _results(data: dict, fields) -> list[dict]:
        raw = data.get("results")
        out = []
        for w in raw if isinstance(raw, list) else []:
            row = graph_work(w, fields)
            if row:
                out.append(row)
        return out

    # ------------------------------------------------------------ OpenAlex
    def work(self, no: int, fields) -> dict:
        """단건 조회(무료). 없으면 UpstreamError(status=404).

        OpenAlex에서 합쳐진 작품은 3xx로 새 번호를 알려 준다: Location이 같은 상수 호스트(api.openalex.org)의
        /works/W<번호>일 때만 그 번호로 한 번 더 조회한다. 또 3xx이거나 모양이 다르면 404로 본다(품질팀 I-1).
        돌려준 작품의 번호가 요청과 다를 수 있으므로 호출 쪽은 row["no"]를 씨앗으로 쓴다."""
        no = int(no)
        for attempt in range(2):
            try:
                data = self._oa(f"/works/W{no}", {"select": ",".join(fields)}, "single")
            except UpstreamError as e:
                if e.status and 300 <= e.status < 400:
                    new = merged_work_no(e.location)
                    if attempt == 0 and new and new != no:
                        no = new
                        continue
                    raise UpstreamError(OPENALEX_HOST, 404) from None
                raise
            row = graph_work(data, fields)
            if not row:
                raise UpstreamError(OPENALEX_HOST, 404)
            return row
        raise UpstreamError(OPENALEX_HOST, 404)

    def works(self, nos: list[int], fields) -> list[dict]:
        """번호 묶음 조회(≤100, 목록 호출 1회)"""
        nos = [int(n) for n in nos][:100]
        if not nos:
            return []
        data = self._oa("/works", {"filter": "openalex:" + "|".join(f"W{n}" for n in nos), "per_page": 100,
                                   "select": ",".join(fields)}, "list")
        return self._results(data, fields)

    def works_by_doi(self, dois: list[str], fields) -> list[dict]:
        """DOI 묶음 조회(≤100, 목록 호출 1회). DOI는 이미 검사한 값만(| , 없음)"""
        dois = [d for d in dois if d and "|" not in d and "," not in d][:100]
        if not dois:
            return []
        data = self._oa("/works", {"filter": "doi:" + "|".join(f"https://doi.org/{d}" for d in dois), "per_page": 100,
                                   "select": ",".join(fields)}, "list")
        return self._results(data, fields)

    def citing(self, nos: list[int], sort: str, fields) -> tuple[list[dict], int]:
        """nos 중 하나라도 인용한 작품(cites: OR, ≤50값), 정렬 · 100편. (작품들, 전체 수)"""
        nos = [int(n) for n in nos][:50]
        data = self._oa("/works", {"filter": "cites:" + "|".join(f"W{n}" for n in nos), "sort": sort,
                                   "per_page": 100, "select": ",".join(fields)}, "list")
        meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
        return self._results(data, fields), _nonneg(meta.get("count"))

    def search_title(self, title: str, fields) -> list[dict]:
        """제목 검색(비용이 큼 — 씨앗에 식별자가 없을 때만)"""
        data = self._oa("/works", {"search": title, "per_page": 3, "select": ",".join(fields)}, "list")
        return self._results(data, fields)

    # ------------------------------------------------------------ Semantic Scholar
    def s2_reference_dois(self, doi: str) -> list[str]:
        """씨앗 DOI의 참고문헌 DOI 목록(S2 1회). 경로의 DOI는 인코딩('?' · '#' 무력화)"""
        headers = {"x-api-key": self.s2_key} if self.s2_key else {}
        if not doi or any(seg in (".", "..") for seg in doi.split("/")):  # 경로 조작 세그먼트는 보내지 않음(품질팀 M-6)
            raise UpstreamError(S2_HOST, 400)
        path = f"/paper/DOI:{quote(doi, safe='/')}/references"
        data = self._send(S2, S2_HOST, path, {"fields": "externalIds", "limit": 1000}, headers, "s2")
        out: dict[str, None] = {}
        for item in data.get("data") if isinstance(data.get("data"), list) else []:
            cited = item.get("citedPaper") if isinstance(item, dict) else None
            ext = cited.get("externalIds") if isinstance(cited, dict) else None
            d = ext.get("DOI") if isinstance(ext, dict) else None
            if isinstance(d, str) and d.strip().lower().startswith("10."):
                out[d.strip().lower()[:300]] = None
        return list(out)
