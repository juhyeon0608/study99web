"""5단계 국내 DB · 생명과학 검색 소스 (docs/specs/phase5-korean-db.md 6 · 8 · 14장, K-1).

- KCI(한국연구재단) · RISS(KERIS) · Europe PMC(EMBL-EBI) 검색 → 지금 결과 카드 모양(`sources._empty`).
- 고정 호스트 상수에만 요청하고, 리디렉션을 따라가지 않으며, 응답은 10MB까지(`sources.strict_get` — 1B 규칙 공용).
- KCI · RISS 키는 공용 키 하나씩(U-1, `KCI_API_KEY` · `RISS_API_KEY`). 키가 없으면 그 소스만 꺼짐(외부 호출 0회).
- 오류 문구 · 로그에는 호스트 + 상태 + code만(요청 주소 · 검색어 · 키를 넣지 않음).
- XML은 표준 파서 + `<!DOCTYPE` · `<!ENTITY`가 있으면 파싱 전에 거부(K-2). 새 의존 패키지 없음.
- 검색 결과는 어디에도 저장하지 않는다(U-5). 무료 PDF 판정 순서(8.3절)는 `plan_pdf`.
"""

from __future__ import annotations

import html
import json
import re
import time
import xml.etree.ElementTree as ET
from typing import Callable

import httpx

from xml.parsers import expat

from .sources import (RateLimiter, SourceError, UpstreamError, _empty, get_with_retry, is_arxiv_url, pick_oa_location,
                      server_fetch_allowed, split_name)

# 14장 호스트 상수 (바뀌면 여기 한 곳)
KCI_HOST = "open.kci.go.kr"
KCI_URL = f"https://{KCI_HOST}/po/openapi/openApiSearch.kci"
KCI_ARTICLE = "https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId={}"
RISS_HOST = "www.riss.kr"
RISS_URL = f"https://{RISS_HOST}/openApi"  # https 우선(14장) — http만 되면 팀장 보고
EPMC_HOST = "www.ebi.ac.uk"
EPMC_URL = f"https://{EPMC_HOST}/europepmc/webservices/rest/search"
LIMITERS = {KCI_HOST: RateLimiter(2), RISS_HOST: RateLimiter(2), EPMC_HOST: RateLimiter(2)}
PER_PAGE = 20
MAX_PAGE = 500
MAX_QUERY = 300

# 소스별 지원 정렬 · '무료만' 필터 (6.4절 — static/js/sourcemeta.js의 SOURCE_LIMITS와 같아야 함, 테스트로 비교)
SOURCE_LIMITS = {
    "kci": {"sort": ["relevance", "date"], "oa": False},
    "riss": {"sort": ["relevance", "date"], "oa": True},
    "europepmc": {"sort": ["relevance", "date", "cited"], "oa": True},
}
EXT_SOURCES = tuple(SOURCE_LIMITS)
KEYED = {"kci": "KCI_API_KEY", "riss": "RISS_API_KEY"}

# KCI 키 오류 문구(공식 오류 응답 — 키 발급 뒤 녹화로 다시 확인)
KCI_KEY_ERRORS = ("등록되지 않은", "사용기간", "인증키", "인증 키")
_CTRL_RE = re.compile(r"[\x00-\x1f\x7f-\x9f]")
_UNSAFE_XML = re.compile(rb"<!\s*(doctype|entity)", re.I)
_KCI_ID_RE = re.compile(r"^ART\d{9}$")
_RISS_ID_RE = re.compile(r"^[A-Z]\d{6,12}$")
_EPMC_SRC_RE = re.compile(r"^[A-Z]{3}$")
_EPMC_ID_RE = re.compile(r"^[A-Za-z0-9]{1,20}$")
_CURSOR_RE = re.compile(r"^[A-Za-z0-9+/=*_.\-]{1,500}$")


class ExtError(SourceError):
    """검색 실패. code = 화면이 문구를 고르는 값, status = HTTP 상태. 문구에 주소 · 검색어 · 키 없음"""

    CODES = {  # code → (HTTP 상태, 문구)
        "source_unconfigured": (503, "이 데이터베이스는 아직 쓸 수 없어요(키 등록 전)."),
        "source_key_invalid": (502, "검색 키가 맞지 않거나 사용기간이 끝났어요. 관리자에게 알려 주세요."),
        "upstream_limited": (429, "요청이 많아 잠시 막혔어요. 잠시 후 다시 시도해 주세요."),
        "upstream_unavailable": (502, "데이터베이스에 연결할 수 없어요. 잠시 후 다시 시도해 주세요."),
        "unsupported_option": (400, "이 데이터베이스는 이 정렬 · 필터를 지원하지 않아요."),
        "bad_query": (400, "검색어는 1~300자로 넣어 주세요."),
    }

    def __init__(self, code: str):
        self.code = code
        self.status, message = self.CODES[code]
        super().__init__(message)


# ------------------------------------------------------------------ 작은 도우미
def _t(v, n: int = 1000) -> str:
    """요소 글 → 공백 정리 · 자름"""
    s = v if isinstance(v, str) else ""
    return re.sub(r"\s+", " ", s.replace("\x00", "")).strip()[:n]


def _strip_html(v, n: int) -> str:
    s = v if isinstance(v, str) else ""
    s = re.sub(r"<[^>]+>", " ", html.unescape(s))
    return _t(html.unescape(s), n)


def _year(v) -> int | None:
    m = re.search(r"(1[5-9]\d{2}|20\d{2})", v if isinstance(v, str) else str(v or ""))
    return int(m.group(1)) if m else None


def _int(v) -> int | None:
    s = v.strip() if isinstance(v, str) else str(v) if isinstance(v, int) and not isinstance(v, bool) else ""
    return int(s) if s.isdigit() and len(s) <= 10 else None


def _doi(v) -> str:
    from .db import normalize_doi
    d = normalize_doi(v if isinstance(v, str) else "")
    return d if d.startswith("10.") and len(d) <= 300 and not re.search(r"\s", d) else ""


def _https(v) -> str:
    s = v.strip() if isinstance(v, str) else ""
    return s[:2000] if re.match(r"https?://[^\s]+$", s, re.I) else ""


def _no_parens(s: str) -> str:
    return re.sub(r"\s*[(（][^)）]*[)）]\s*", " ", s or "")  # 괄호 안 영문 이름 · 소속 제거


def _authors(names, split=split_name) -> list[dict]:
    out = []
    for n in names:
        n = _no_parens(n).strip()
        if n:
            out.append(split(n))
        if len(out) >= 50:
            break
    return out


def _epmc_name(n: str) -> dict:
    """Europe PMC authorString의 'Smith JA' 꼴(성 + 이니셜)"""
    parts = n.split()
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]{1,4}", parts[-1]):
        return {"given": parts[-1], "family": " ".join(parts[:-1])}
    return split_name(n)


def clean_query(q) -> str:
    q = _CTRL_RE.sub(" ", q if isinstance(q, str) else "").strip()
    if not 1 <= len(q) <= MAX_QUERY:
        raise ExtError("bad_query")
    return q


def check_options(source: str, sort: str, oa: bool) -> None:
    lim = SOURCE_LIMITS[source]
    if (sort or "relevance") not in lim["sort"] or (oa and not lim["oa"]):
        raise ExtError("unsupported_option")


def _refuse(*_a) -> None:
    raise ExtError("upstream_unavailable")


def parse_xml(body: bytes) -> ET.Element:
    """DOCTYPE · ENTITY 거부(K-2): ① 바이트에 <!DOCTYPE · <!ENTITY가 보이면 파싱 전에 ② 그 밖 인코딩(UTF-16 등)이라도
    expat의 StartDoctypeDecl · EntityDecl 처리기에서. 크기 상한은 strict_get(10MB).
    (ET.XMLParser의 C 구현은 안쪽 expat 파서를 내주지 않아 expat 파서 + TreeBuilder로 직접 만든다)"""
    if _UNSAFE_XML.search(body or b""):
        raise ExtError("upstream_unavailable")
    tb = ET.TreeBuilder()
    px = expat.ParserCreate()
    px.StartDoctypeDeclHandler = px.EntityDeclHandler = _refuse
    px.StartElementHandler = tb.start
    px.EndElementHandler = tb.end
    px.CharacterDataHandler = tb.data
    try:
        px.Parse(body or b"", True)
        return tb.close()
    except (expat.ExpatError, AssertionError, ValueError):
        raise ExtError("upstream_unavailable") from None


def _find(e: ET.Element, tag: str) -> ET.Element | None:
    return next(e.iter(tag), None)


def _pick_lang(rec: ET.Element, tag: str, n: int) -> str:
    """lang 속성이 있는 같은 이름 요소들 중 원어(original) → 영어가 아닌 것 → 영어 → 아무거나 순"""
    vals = [((x.get("lang") or "").lower(), _t("".join(x.itertext()), n)) for x in rec.iter(tag)]
    vals = [(k, v) for k, v in vals if v]
    for ok in (lambda k: k == "original", lambda k: k != "english", lambda k: True):
        hit = next((v for k, v in vals if ok(k)), "")
        if hit:
            return hit
    return ""


def _ftext(e: ET.Element, tag: str, n: int = 1000) -> str:
    x = _find(e, tag)
    return _t("".join(x.itertext()), n) if x is not None else ""


# ------------------------------------------------------------------ KCI (6.1절)
def norm_kci(rec: ET.Element) -> dict:
    p = _empty("kci")
    p["title"] = _pick_lang(rec, "article-title", 1000)
    p["authors"] = _authors(_t("".join(a.itertext()), 300) for a in rec.iter("author"))
    p["year"] = _year(_ftext(rec, "pub-year"))
    mon = _ftext(rec, "pub-mon")
    p["issued"] = f"{p['year']}-{int(mon):02d}" if p["year"] and mon.isdigit() and 1 <= int(mon) <= 12 else \
        (str(p["year"]) if p["year"] else "")
    p["venue"] = _ftext(rec, "journal-name", 300)
    p["publisher"] = _ftext(rec, "publisher-name", 300)
    p["volume"], p["issue"] = _ftext(rec, "volume", 300), _ftext(rec, "issue", 300)
    fp, lp = _ftext(rec, "fpage", 50), _ftext(rec, "lpage", 50)
    p["pages"] = f"{fp}-{lp}" if fp and lp and lp != fp else fp
    p["doi"] = _doi(_ftext(rec, "doi", 300))
    info = _find(rec, "articleInfo")
    kid = (info.get("article-id") if info is not None else "") or _ftext(rec, "article-id", 20)
    p["kci_id"] = kid if _KCI_ID_RE.match(kid or "") else ""
    p["url"] = _https(_ftext(rec, "url", 2000)) or (KCI_ARTICLE.format(p["kci_id"]) if p["kci_id"] else "")
    p["abstract"] = _pick_lang(rec, "abstract", 5000)
    cc = _find(rec, "citation-count")
    p["cited_by_count"] = (_int(cc.get("kci")) if cc is not None and cc.get("kci") is not None
                           else _int("".join(cc.itertext())) if cc is not None else None)
    p["is_oa"] = _ftext(rec, "orte-open-yn", 5).upper() == "Y"
    p["pdf_url"] = ""  # KCI API는 PDF 주소를 주지 않음
    reg = _ftext(rec, "kci-registration", 50) or _ftext(rec, "journal-registration", 50)
    p["badges"] = [reg] if reg and "등재" in reg else []
    return p


def parse_kci(body: bytes) -> dict:
    root = parse_xml(body)
    records = list(root.iter("record"))
    if not records:
        texts = " ".join(t for el in root.iter() if el.tag != "inputData" for t in [el.text or ""])
        if any(k in texts for k in KCI_KEY_ERRORS):
            raise ExtError("source_key_invalid")
    total = _int(_ftext(root, "total", 12)) or 0
    items = [p for p in (norm_kci(r) for r in records) if p["title"]]
    return {"items": items, "total": max(total, len(items))}


# ------------------------------------------------------------------ RISS (6.2절)
def norm_riss(md: ET.Element) -> dict:
    p = _empty("riss")
    p["title"] = _ftext(md, "riss.title")
    p["authors"] = _authors(re.split(r"[;,/]", _no_parens(_ftext(md, "riss.author", 2000))))
    p["year"] = _year(_ftext(md, "riss.pubdate", 50))
    p["issued"] = str(p["year"]) if p["year"] else ""
    p["venue"] = _ftext(md, "riss.stype", 300) or _ftext(md, "riss.stitle", 300)
    p["publisher"] = _ftext(md, "riss.publisher", 300)
    p["volume"], p["issue"] = _ftext(md, "riss.vol", 300), _ftext(md, "riss.no", 300)
    raw = _ftext(md, "url", 2000)
    p["url"], p["riss_id"] = "", ""
    try:
        u = httpx.URL(raw)
        if u.host == RISS_HOST and u.scheme in ("http", "https") and not u.userinfo and u.port in (None, 80, 443):
            p["url"] = str(u.copy_with(scheme="https", port=None))  # K-15: https로 바꿔 내보냄
            rid = u.params.get("id") or ""
            p["riss_id"] = rid if _RISS_ID_RE.match(rid) else ""
    except (httpx.InvalidURL, TypeError, ValueError):
        pass
    reg = _ftext(md, "riss.reg", 50)
    p["badges"] = ([reg] if reg else []) + (["무료 원문"] if _ftext(md, "riss.charge", 5) == "1" else [])
    p["is_oa"], p["pdf_url"] = False, ""
    return p


def parse_riss(body: bytes) -> dict:
    root = parse_xml(body)
    err = _ftext(root, "Error", 20)
    if err and err != "0":
        raise ExtError("source_key_invalid")
    items = [p for p in (norm_riss(m) for m in root.iter("metadata")) if p["title"]]
    total = _int(_ftext(root, "totalcount", 12)) or 0
    return {"items": items, "total": max(total, len(items))}


# ------------------------------------------------------------------ Europe PMC (6.3절)
def norm_epmc(r: dict) -> dict:
    p = _empty("europepmc")
    p["title"] = _strip_html(r.get("title"), 1000)
    p["abstract"] = _strip_html(r.get("abstractText"), 5000)
    names = r.get("authorString") if isinstance(r.get("authorString"), str) else ""
    p["authors"] = _authors(names.rstrip(".").split(","), _epmc_name)
    p["year"] = _year(r.get("pubYear"))
    p["issued"] = str(p["year"]) if p["year"] else ""
    ji = r.get("journalInfo") if isinstance(r.get("journalInfo"), dict) else {}
    jj = ji.get("journal") if isinstance(ji.get("journal"), dict) else {}
    p["venue"] = _t(r.get("journalTitle") or jj.get("title"), 300)
    p["volume"] = _t(r.get("journalVolume") or ji.get("volume"), 300)
    p["issue"] = _t(r.get("issue") or ji.get("issue"), 300)
    p["pages"] = _t(r.get("pageInfo"), 300)
    p["doi"] = _doi(r.get("doi"))
    p["pmid"] = r["pmid"] if isinstance(r.get("pmid"), str) and r["pmid"].isdigit() else ""
    p["pmcid"] = r["pmcid"] if isinstance(r.get("pmcid"), str) and re.fullmatch(r"PMC\d{1,12}", r["pmcid"]) else ""
    src, rid = r.get("source"), r.get("id")
    ok = isinstance(src, str) and isinstance(rid, str) and _EPMC_SRC_RE.match(src) and _EPMC_ID_RE.match(rid)
    p["url"] = f"https://europepmc.org/article/{src}/{rid}" if ok else ""
    p["cited_by_count"] = _int(r.get("citedByCount"))
    p["is_oa"] = r.get("isOpenAccess") == "Y"
    p["pdf_url"] = ""  # U-4: fullTextUrlList · license는 읽지 않음(무료 PDF 정보는 OpenAlex 것만)
    return p


def parse_epmc(body: bytes) -> dict:
    try:
        data = json.loads(body)
    except (ValueError, RecursionError):
        raise ExtError("upstream_unavailable") from None
    if not isinstance(data, dict):
        raise ExtError("upstream_unavailable")
    rl = data.get("resultList") if isinstance(data.get("resultList"), dict) else {}
    raw = rl.get("result") if isinstance(rl.get("result"), list) else []
    items = [p for p in (norm_epmc(r) for r in raw if isinstance(r, dict)) if p["title"]]
    out = {"items": items, "total": _int(data.get("hitCount")) or len(items)}
    nxt = data.get("nextCursorMark")
    # 마지막 쪽은 같은 커서를 되돌려 줌 → 다음 없음
    out["next_cursor"] = nxt if isinstance(nxt, str) and _CURSOR_RE.match(nxt) and items and \
        nxt != (data.get("request") or {}).get("cursorMark") else None
    return out


# ------------------------------------------------------------------ 호출
class ExtSources:
    """서버 하나에 하나(공용 키). transport · sleep은 테스트가 바꿔 넣는다."""

    def __init__(self, kci_key: str = "", riss_key: str = "", *, transport: httpx.BaseTransport | None = None,
                 sleep: Callable[[float], None] = time.sleep, limiters: dict | None = None):
        self._keys = {"kci": (kci_key or "").strip(), "riss": (riss_key or "").strip()}
        self._transport = transport
        self._sleep = sleep
        self._limiters = limiters if limiters is not None else LIMITERS

    def enabled(self, source: str) -> bool:
        return source not in KEYED or bool(self._keys.get(source))

    def status(self) -> dict:
        """GET /api/sources — 쓸 수 있는지만(키 값은 돌려주지 않음)"""
        return {s: ({"enabled": True} if self.enabled(s) else {"enabled": False, "reason": "unconfigured"})
                for s in EXT_SOURCES}

    def _get(self, host: str, url: str, params: dict) -> bytes:
        """sources.get_with_retry(1B와 같은 재시도 · 로그 규칙). 429 두 번 → upstream_limited, 그 밖 실패 → upstream_unavailable"""
        limiter = self._limiters.get(host)
        try:
            return get_with_retry(host, url, params, {}, self._transport, self._sleep,
                                  before=limiter.acquire if limiter else None)[1]
        except UpstreamError as e:
            raise ExtError("upstream_limited" if e.status == 429 else "upstream_unavailable") from None

    def search(self, source: str, query: str, page: int = 1, year_from: int | None = None,
               year_to: int | None = None, sort: str = "relevance", oa: bool = False, cursor: str = "") -> dict:
        if source not in EXT_SOURCES:
            raise ValueError(source)
        q = clean_query(query)
        check_options(source, sort, oa)
        if not self.enabled(source):
            raise ExtError("source_unconfigured")  # 외부 호출 0회
        page = max(1, min(int(page or 1), MAX_PAGE))
        if source == "kci":
            params = {"key": self._keys["kci"], "apiCode": "articleSearch", "title": q, "page": page,
                      "displayCount": PER_PAGE}
            if year_from:
                params["dateFrom"] = f"{int(year_from):04d}01"
            if year_to:
                params["dateTo"] = f"{int(year_to):04d}12"
            if sort == "date":
                params["sortNm"] = "pubiYr"
            return parse_kci(self._get(KCI_HOST, KCI_URL, params))
        if source == "riss":
            params = {"key": self._keys["riss"], "version": "1.0", "type": "A", "keyword": q,
                      "rsnum": (page - 1) * PER_PAGE + 1, "rowcount": PER_PAGE}
            if year_from:
                params["spubdate"] = int(year_from)
            if year_to:
                params["epubdate"] = int(year_to)
            if sort == "date":
                params["sort"], params["asc"] = "Y", "D"
            if oa:
                params["charge"] = 1
            return parse_riss(self._get(RISS_HOST, RISS_URL, params))
        full = f"({q})" if (year_from or year_to or oa) else q
        if year_from or year_to:
            full += f" AND PUB_YEAR:[{int(year_from or 1000)} TO {int(year_to or 3000)}]"
        if oa:
            full += " AND OPEN_ACCESS:Y"
        params = {"query": full, "format": "json", "resultType": "core", "pageSize": PER_PAGE,
                  "cursorMark": cursor if cursor and _CURSOR_RE.match(cursor) else "*"}
        if sort == "date":
            params["sort"] = "P_PDATE_D desc"
        elif sort == "cited":
            params["sort"] = "CITED desc"
        return parse_epmc(self._get(EPMC_HOST, EPMC_URL, params))


# ------------------------------------------------------------------ 무료 PDF 판정 순서 (8.3절 · K-11 · K-12)
def match_location(locs, url: str) -> dict | None:
    url = (url or "").strip()
    return next((x for x in locs or [] if x.get("pdf_url") and x["pdf_url"].strip() == url), None)


def cache_locations(row) -> list[dict] | None:
    """1B 캐시 행(read_oa) → 위치 목록. oa_license가 null(아직 모름) · ''(best 위치에 라이선스 없음 — oa_locations에 허용
    위치가 있을 수 있음, D5)이면 None — OpenAlex를 한 번 불러 검색 카드와 같은 판정을 함"""
    if not row or not row.get("oa_license"):
        return None
    pdf = row.get("pdf_url") or ""
    landing = (row.get("url") or "") if row.get("is_oa") else ""
    if not (pdf or landing):
        return []
    return [{"pdf_url": pdf, "landing_url": landing, "license": row["oa_license"], "version": ""}]


def plan_pdf(sources, url: str, arxiv_id: str, doi: str, cached: list[dict] | None) -> dict | None:
    """받을 PDF를 서버가 정한다(8.3절 · 팀장 결정 D1). → {"fetch": 주소, "license"} | {"open_url", "open_kind"} | None(없음).
    url = 서재 pdf_url 또는 [PDF 포함 추가]가 보낸 주소. 서버가 받는 것은 둘뿐: (a) arXiv 주소 (b) 그 DOI의 OpenAlex 위치 중
    허용 라이선스 위치와 글자 그대로 같은 주소. 그 밖 주소(S2 · Crossref · 사용자가 넣은 주소 · 변형)는 모두 새 탭.
    sources.oa_locations · crossref_pdf_link는 외부 호출(SourceError면 호출 쪽이 실패 처리)."""
    url = (url or "").strip()
    if not re.match(r"https?://", url, re.I):
        url = ""  # http/https가 아닌 주소는 받지도 새 탭으로 내주지도 않음
    if url:
        if is_arxiv_url(url):  # 경계 ② — arXiv는 지금처럼 받음(U-3 예외)
            return {"fetch": url, "license": ""}
        if doi:
            hit = match_location(cached, url) if cached else None
            loc = hit if hit and server_fetch_allowed(hit.get("license")) else match_location(sources.oa_locations(doi), url)
            if loc and server_fetch_allowed(loc.get("license")):
                return {"fetch": url, "license": loc["license"]}
        return {"open_url": url, "open_kind": "pdf"}
    if arxiv_id:
        return {"fetch": f"https://arxiv.org/pdf/{arxiv_id}", "license": ""}
    if doi:
        pick = pick_oa_location(cached if cached is not None else sources.oa_locations(doi))
        if pick and pick["server_fetch"]:
            return {"fetch": pick["pdf_url"], "license": pick.get("license") or ""}
        if pick:
            return {"open_url": pick["open_url"], "open_kind": pick["open_kind"]}
        link = sources.crossref_pdf_link(doi)  # K-22: Crossref link는 새 탭으로만
        if link:
            return {"open_url": link, "open_kind": "pdf"}
    return None
