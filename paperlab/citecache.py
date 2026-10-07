"""인용 그래프 공용 캐시 (명세 docs/specs/citation-graph.md 7.6 · 8장).

- 표: `paperlab.external_works`(공개 서지, 작품 하나 = 행 하나) · `paperlab.citation_edges`(작품 × 관계 = 행 하나, 번호 배열).
- 읽기는 **요청한 사용자의 트랜잭션(user_tx)** 안에서(RLS: 로그인 사용자 누구나 select), 쓰기는 **system_tx("citation cache
  write")** 로만(authenticated에는 쓰기 권한이 없음). 이유 문자열은 고정 — 씨앗 · 번호 · 제목을 넣지 않는다(8.6절).
- 시각은 날짜(date)만. 유효 기간(TTL)은 날짜 단위로, 오늘 날짜는 호출 쪽이 넣는다(테스트에서 바꿈).
- 사용자 · 요청 · 세션 정보는 어디에도 남기지 않는다.
"""

from __future__ import annotations

from datetime import date, timedelta

from psycopg.types.json import Jsonb

from .db import normalize_title

# 7.6절 유효 기간(일) — 가정
TTL_META = 30
TTL_REFERENCES = 180
TTL_RELATED = 90
TTL_CITED = 30
TTL_ABSTRACT = 180
TTL = {"references": TTL_REFERENCES, "related": TTL_RELATED, "cited_by_top": TTL_CITED, "cited_by_recent": TTL_CITED}
RELATIONS = ("references", "related", "cited_by_top", "cited_by_recent")
EDGE_CAP = {"references": 500, "related": 20, "cited_by_top": 100, "cited_by_recent": 100}

WORK_COLS = ("openalex_no", "doi", "arxiv_id", "title", "title_norm", "authors", "author_count", "year", "issued", "venue",
             "publisher", "volume", "issue", "pages", "item_type", "language", "url", "pdf_url", "is_oa",
             "cited_by_count", "reference_count", "abstract", "meta_on", "abstract_on")
META_KEYS = ("doi", "arxiv_id", "title", "authors", "author_count", "year", "issued", "venue", "publisher", "volume",
             "issue", "pages", "item_type", "language", "url", "pdf_url", "is_oa", "cited_by_count", "reference_count")


def fresh(day: date | None, days: int, today: date) -> bool:
    """day에 받은 것이 오늘 기준 days일 안이면 참 (날짜 단위)"""
    return day is not None and (today - day).days < days


def cutoff(days: int, today: date) -> date:
    """fresh(d) ⇔ d > cutoff"""
    return today - timedelta(days=days)


def _work_from_db(r: dict) -> dict:
    w = {k: r[k] for k in META_KEYS}
    w["no"] = int(r["openalex_no"])
    w["authors"] = r["authors"] if isinstance(r["authors"], list) else []
    w["title_norm"] = r["title_norm"]
    w["abstract"] = r["abstract"]
    w["meta_on"] = r["meta_on"]
    w["abstract_on"] = r["abstract_on"]
    return w


def _edge_from_db(r: dict) -> dict:
    return {"work_no": int(r["work_no"]), "relation": r["relation"], "nos": [int(x) for x in r["nos"]],
            "total": int(r["total"]), "truncated": bool(r["truncated"]), "source": r["source"],
            "fetched_on": r["fetched_on"]}


# ------------------------------------------------------------------ 읽기 (사용자 트랜잭션 연결)
def read_works(conn, nos) -> dict[int, dict]:
    nos = sorted({int(n) for n in nos})
    if not nos:
        return {}
    rows = conn.execute(f"select {', '.join(WORK_COLS)} from paperlab.external_works where openalex_no = any(%s)",
                        (nos,)).fetchall()
    return {int(r["openalex_no"]): _work_from_db(r) for r in rows}


def read_edges(conn, nos, relations) -> dict[tuple[int, str], dict]:
    nos = sorted({int(n) for n in nos})
    if not nos:
        return {}
    rows = conn.execute("select work_no, relation, nos, total, truncated, source, fetched_on from paperlab.citation_edges "
                        "where work_no = any(%s) and relation = any(%s)", (nos, list(relations))).fetchall()
    return {(int(r["work_no"]), r["relation"]): _edge_from_db(r) for r in rows}


def read_by_doi(conn, dois) -> dict[str, int]:
    """DOI → 번호(같은 DOI 작품이 여럿이면 피인용이 큰 것)"""
    dois = sorted({d for d in dois if d})
    if not dois:
        return {}
    rows = conn.execute("select doi, openalex_no from paperlab.external_works where doi = any(%s) "
                        "order by doi, cited_by_count desc, openalex_no", (dois,)).fetchall()
    out: dict[str, int] = {}
    for r in rows:
        out.setdefault(r["doi"], int(r["openalex_no"]))
    return out


def read_citers(conn, targets, today: date, per_sort: int) -> list[int]:
    """캐시 안에서 targets 중 하나라도 참고문헌에 가진 작품(참고문헌 · 서지가 유효한 것)
    — 피인용 많은 순 per_sort편 ∪ 최신순 per_sort편 (D 단계를 캐시에서 다시 만들기 — graph_build 참고)"""
    targets = sorted({int(t) for t in targets})
    if not targets:
        return []
    params = {"t": targets, "rc": cutoff(TTL_REFERENCES, today), "mc": cutoff(TTL_META, today), "n": per_sort}
    base = ("select w.openalex_no, w.cited_by_count, w.issued, w.year from paperlab.external_works w "
            "join paperlab.citation_edges e on e.work_no = w.openalex_no and e.relation = 'references' "
            "where e.nos && %(t)s::bigint[] and e.fetched_on > %(rc)s and w.meta_on > %(mc)s")
    top = conn.execute(base + " order by w.cited_by_count desc, w.openalex_no limit %(n)s", params).fetchall()
    recent = conn.execute(base + ' order by w.issued collate "C" desc, coalesce(w.year, 0) desc, w.openalex_no '
                          "limit %(n)s", params).fetchall()
    return list(dict.fromkeys([int(r["openalex_no"]) for r in top] + [int(r["openalex_no"]) for r in recent]))


# ------------------------------------------------------------------ 쓰기 (system_tx 연결)
_UPSERT_WORK = f"""
insert into paperlab.external_works ({', '.join(WORK_COLS)})
values ({', '.join(['%s'] * len(WORK_COLS))})
on conflict (openalex_no) do update set
  doi = excluded.doi, arxiv_id = excluded.arxiv_id, title = excluded.title, title_norm = excluded.title_norm,
  authors = excluded.authors, author_count = excluded.author_count, year = excluded.year, issued = excluded.issued,
  venue = excluded.venue, publisher = excluded.publisher, volume = excluded.volume, issue = excluded.issue,
  pages = excluded.pages, item_type = excluded.item_type, language = excluded.language, url = excluded.url,
  pdf_url = excluded.pdf_url, is_oa = excluded.is_oa, cited_by_count = excluded.cited_by_count,
  reference_count = excluded.reference_count, meta_on = excluded.meta_on,
  abstract = coalesce(excluded.abstract, paperlab.external_works.abstract),
  abstract_on = case when excluded.abstract is null then paperlab.external_works.abstract_on else excluded.abstract_on end
"""

_UPSERT_EDGE = """
insert into paperlab.citation_edges (work_no, relation, nos, total, truncated, source, fetched_on)
values (%s, %s, %s, %s, %s, %s, %s)
on conflict (work_no, relation) do update set
  nos = excluded.nos, total = excluded.total, truncated = excluded.truncated, source = excluded.source,
  fetched_on = excluded.fetched_on
"""


def work_params(w: dict, today: date) -> tuple:
    title = (w.get("title") or "")[:1000]
    abstract = w.get("abstract")
    return (int(w["no"]), w.get("doi") or "", w.get("arxiv_id") or "", title, normalize_title(title),
            Jsonb(list(w.get("authors") or [])[:20]), int(w.get("author_count") or 0), w.get("year"),
            w.get("issued") or "", w.get("venue") or "", w.get("publisher") or "", w.get("volume") or "",
            w.get("issue") or "", w.get("pages") or "", w.get("item_type") or "article", w.get("language") or "",
            w.get("url") or "", w.get("pdf_url") or "", bool(w.get("is_oa")), int(w.get("cited_by_count") or 0),
            int(w.get("reference_count") or 0), None if abstract is None else abstract[:5000], today,
            None if abstract is None else today)


def edge_params(e: dict, today: date) -> tuple:
    cap = EDGE_CAP[e["relation"]]
    nos = [int(x) for x in e["nos"]]
    truncated = bool(e.get("truncated")) or len(nos) > cap
    return (int(e["work_no"]), e["relation"], nos[:cap], max(int(e.get("total") or 0), len(nos)), truncated,
            e.get("source") or "openalex", today)


def write_rows(conn, works: list[dict], edges: list[dict], today: date) -> None:
    with conn.cursor() as cur:
        if works:
            cur.executemany(_UPSERT_WORK, [work_params(w, today) for w in works])
        if edges:
            cur.executemany(_UPSERT_EDGE, [edge_params(e, today) for e in edges])


class PgStore:
    """그래프 계산이 쓰는 캐시 접근. 읽기마다 짧은 사용자 트랜잭션, 쓰기마다 짧은 system_tx(외부 호출 사이에 연결을 잡지 않음)."""

    def __init__(self, db, claims: dict):
        self.db = db
        self.claims = claims

    def _read(self, fn):
        with self.db.user_tx(self.claims) as lib:
            return fn(lib.conn)

    def works(self, nos) -> dict[int, dict]:
        return self._read(lambda c: read_works(c, nos))

    def edges(self, nos, relations) -> dict[tuple[int, str], dict]:
        return self._read(lambda c: read_edges(c, nos, relations))

    def by_doi(self, dois) -> dict[str, int]:
        return self._read(lambda c: read_by_doi(c, dois))

    def citers(self, targets, today: date, per_sort: int) -> list[int]:
        return self._read(lambda c: read_citers(c, targets, today, per_sort))

    def write(self, works: list[dict], edges: list[dict], today: date) -> None:
        if not works and not edges:
            return
        with self.db.system_tx("citation cache write") as conn:
            write_rows(conn, works, edges, today)
