"""Postgres(Supabase) 저장소: 연결 풀 · 사용자 권한 트랜잭션 · 서재 질의 (명세 5장).

연결은 이 모듈의 도우미로만 연다(AC-13).
- `Database.user_tx(claims)` — 모든 사용자 요청이 쓰는 유일한 경로.
  BEGIN → SET LOCAL ROLE authenticated(= set_config('role', …, true)) → set_config('request.jwt.claims', …, true)
  → 질의 → COMMIT/ROLLBACK
- `Database.system_tx(reason)` — 사용자와 무관한 시스템 작업 전용(reason 필수, 로그에 남김).
세션 수준 SET(LOCAL 없이)은 쓰지 않는다. 쿼리에도 user_id 조건을 넣는다(RLS와 이중 방어).
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Iterable, Iterator

import psycopg
import psycopg_pool
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .citations import format_issued, make_citekey, parse_issued
from .config import redact

log = logging.getLogger("paperlab.db")

JSON_FIELDS = ("authors", "keywords")
EDITABLE_FIELDS = (
    "title", "authors", "year", "venue", "volume", "issue", "pages", "publisher",
    "doi", "arxiv_id", "openalex_id", "s2_id", "url", "pdf_url", "abstract", "item_type",
    "keywords", "status", "starred", "rating", "cited_by_count", "citekey", "page_count", "issued", "language",
)
# 변경 전 SQLite 정렬과 같은 결과가 나오게 (명세 5.8, AC-25)
SORTS = {
    "added": "p.added_at desc, p.id desc",
    "updated": "p.updated_at desc, p.id desc",
    "opened": "coalesce(p.last_opened_at, '-infinity'::timestamptz) desc, p.id",
    "year": 'coalesce(p.year, 0) desc, p.title collate "C", p.id',
    "title": 'lower(p.title) collate "C", p.id',
    "cited": "coalesce(p.cited_by_count, -1) desc, p.id",
    "first_author": "lower(p.authors -> 0 ->> 'family') collate \"C\" asc nulls first, p.id",
}
# 응답에서 빼는 내부 열
_HIDDEN_PAPER_COLS = ("user_id", "pdf_key", "title_norm")
SEARCH_LIMIT = 1000
# PGroonga 연산자는 extensions 스키마에 있다 (search_path에 기대지 않음)
PGRN_MATCH = "operator(extensions.&@)"
CHECK_AFTER = 30.0  # 이만큼 쉰 연결은 꺼낼 때 살아 있는지 확인
# 폴더 이름: 6단계 PC 폴더 동기화(Windows · macOS)에서도 그대로 쓸 수 있게 (품질팀 F6)
# 제어 문자: C0(\x00-\x1f) · DEL · C1(\x80-\x9f) — DB CHECK의 [:cntrl:]과 같게 (품질팀 N2)
# + 줄 · 문단 구분 문자 U+2028 · U+2029(DB [:cntrl:]이 거부할 수 있음 — 승인자 L1).
# `$`는 끝 줄바꿈 앞에서도 맞으므로 쓰지 않고 fullmatch로 문자열 전체를 본다
FOLDER_NAME_RE = re.compile(r'[^/\\:*?"<>|\x00-\x1f\x7f-\x9f\u2028\u2029]{1,100}')
_WINDOWS_RESERVED = re.compile(r"(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?", re.I | re.S)


def folder_name_problem(name: str) -> str:
    """폴더 이름을 쓸 수 없으면 이유(화면 문구), 괜찮으면 ''"""
    if not FOLDER_NAME_RE.fullmatch(name or ""):
        return '폴더 이름은 1~100자이고 / \\ : * ? " < > | 와 줄바꿈 같은 제어 문자는 쓸 수 없어요'
    if name in (".", "..") or name.endswith((".", " ")):
        return "폴더 이름은 마침표나 공백으로 끝날 수 없어요"
    if _WINDOWS_RESERVED.fullmatch(name):
        return "CON · PRN · AUX · NUL · COM1~9 · LPT1~9는 폴더 이름으로 쓸 수 없어요 (Windows 예약 이름)"
    return ""


class DBUnavailable(Exception):
    """DB 일시정지 · 연결 실패 · 풀 대기 시간 초과 (→ 503 db_unavailable)"""


class NotFoundError(LookupError):
    pass


def now_dt() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def now() -> str:
    return now_dt().isoformat()


def iso(value) -> str | None:
    """timestamptz → 지금 API 모양(UTC, 초 단위 ISO: 2026-10-07T01:02:03+00:00)"""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    return str(value)


def normalize_title(title: str) -> str:
    return re.sub(r"[\W_]+", "", (title or "").lower())


def normalize_doi(doi: str) -> str:
    doi = (doi or "").strip()
    doi = re.sub(r"^(https?://(dx\.)?doi\.org/|doi:\s*)", "", doi, flags=re.I)
    return doi.lower()


def _clean_text(s: str) -> str:
    # Postgres text에는 NUL 문자를 넣을 수 없다 (PDF 추출 글에 섞여 나올 때가 있음)
    return (s or "").replace("\x00", "")


def _like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _row(row: dict | None) -> dict | None:
    if row is None:
        return None
    return {k: (iso(v) if isinstance(v, datetime) else v) for k, v in row.items()}


# ====================================================================== 연결
class Database:
    """연결 풀(지연 연결). 첫 요청 때 풀을 열어 시작을 빠르게 하고 DB가 멈춰 있어도 서버는 뜬다."""

    def __init__(self, conninfo: str, *, min_size: int = 1, max_size: int = 5, timeout: float = 30.0,
                 connect_timeout: int = 10):
        self._conninfo = conninfo
        self.min_size, self.max_size, self.timeout = min_size, max_size, timeout
        self.connect_timeout = connect_timeout
        self._pool: psycopg_pool.ConnectionPool | None = None
        self._lock = threading.Lock()

    @staticmethod
    def _reset(conn: psycopg.Connection) -> None:
        # 반납 때 앞 요청의 상태가 남지 않게 (SET LOCAL만 쓰지만 이중 방어). 왕복 한 번으로
        if conn.info.transaction_status != psycopg.pq.TransactionStatus.IDLE:
            conn.rollback()
        conn.execute("RESET ROLE; RESET ALL")
        conn._paperlab_used = time.monotonic()

    @staticmethod
    def _check(conn: psycopg.Connection) -> None:
        # 방금 쓴 연결은 확인 왕복을 생략하고, 오래 쉰 연결만 살아 있는지 확인한다(풀러가 끊었을 수 있음)
        if time.monotonic() - getattr(conn, "_paperlab_used", 0.0) < CHECK_AFTER:
            return
        psycopg_pool.ConnectionPool.check_connection(conn)

    def _get_pool(self) -> psycopg_pool.ConnectionPool:
        with self._lock:
            if self._pool is None:
                pool = psycopg_pool.ConnectionPool(
                    self._conninfo, min_size=self.min_size, max_size=self.max_size, timeout=self.timeout,
                    open=False, reset=self._reset, check=self._check,
                    reconnect_timeout=60, name="paperlab",
                    kwargs={"autocommit": True, "prepare_threshold": None, "row_factory": dict_row,
                            "connect_timeout": self.connect_timeout, "application_name": "paperlab"})
                pool.open(wait=False)
                self._pool = pool
            return self._pool

    def reconfigure(self, conninfo: str) -> None:
        """연결 주소를 바꾼다(시험용 · 비밀번호 회전 뒤). 다음 요청부터 새 풀로."""
        with self._lock:
            old, self._pool, self._conninfo = self._pool, None, conninfo
        if old is not None:
            old.close(timeout=5)

    def close(self) -> None:
        self.reconfigure(self._conninfo)

    @contextmanager
    def _tx(self, role: str, claims: str | None, timeout: float | None = None) -> Iterator[psycopg.Connection]:
        # BEGIN과 역할 · claims 설정을 왕복 한 번에 보낸다.
        # set_config('role', …, true) = SET LOCAL ROLE, set_config(…, true) = 트랜잭션 안에서만 유효
        start = sql.SQL("BEGIN; SELECT set_config('role', {}, true), set_config('request.jwt.claims', {}, true)").format(
            sql.Literal(role), sql.Literal(claims if claims is not None else ""))
        try:
            with self._get_pool().connection(timeout=timeout) as conn:
                conn.execute(start)
                try:
                    yield conn
                except BaseException:
                    try:
                        conn.execute("ROLLBACK")
                    except psycopg.Error:
                        pass  # 연결이 끊겼으면 풀이 버린다. 원래 예외를 그대로 올린다
                    raise
                conn.execute("COMMIT")
        except (psycopg.OperationalError, psycopg.InterfaceError, psycopg_pool.PoolTimeout,
                psycopg_pool.PoolClosed) as e:
            log.warning("db unavailable: %s", redact(type(e).__name__ + ": " + str(e))[:300])
            raise DBUnavailable() from None

    @contextmanager
    def user_tx(self, claims: dict) -> Iterator["Library"]:
        """검증된 JWT claims로 사용자 권한 트랜잭션을 연다."""
        uid = str(claims["sub"])
        with self._tx("authenticated", json.dumps(claims, ensure_ascii=False, separators=(",", ":"))) as conn:
            yield Library(conn, uid)

    @contextmanager
    def system_tx(self, reason: str, timeout: float | None = None) -> Iterator[psycopg.Connection]:
        """시스템 작업 전용 (service_role). reason은 필수이며 로그에 남긴다 (명세 5.2 · 20장).
        timeout: 풀에서 연결을 기다리는 최대 초(없으면 풀 기본값)."""
        if not reason or not str(reason).strip():
            raise ValueError("system_tx에는 reason이 필요해요")
        log.info("system_tx reason=%s", reason)
        with self._tx("service_role", None, timeout) as conn:
            yield conn


# ====================================================================== 질의
_PAPER_SELECT = """
select p.*,
  coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
                             order by t.name collate "C", t.id)
              from paperlab.paper_tags pt join paperlab.tags t on t.id = pt.tag_id
             where pt.paper_id = p.id), '[]'::jsonb) as tags,
  coalesce((select jsonb_agg(pc.collection_id order by pc.collection_id)
              from paperlab.paper_collections pc where pc.paper_id = p.id), '[]'::jsonb) as collections,
  exists (select 1 from paperlab.ai_summaries s where s.paper_id = p.id) as has_summary,
  (select count(*) from paperlab.annotations a where a.paper_id = p.id)::int as annotation_count
  {detail}
from paperlab.papers p
"""
_NOTE_COL = ", coalesce((select n.content from paperlab.notes n where n.paper_id = p.id), '') as note"


class Library:
    """한 사용자 트랜잭션 안의 서재 질의. uid는 검증된 JWT의 sub."""

    def __init__(self, conn: psycopg.Connection, uid: str):
        self.conn = conn
        self.uid = uid

    # ---------------------------------------------------------------- helpers
    def _x(self, sql: str, params=None) -> psycopg.Cursor:
        return self.conn.execute(sql, params)

    def _one(self, sql: str, params=None) -> dict | None:
        return self._x(sql, params).fetchone()

    def _all(self, sql: str, params=None) -> list[dict]:
        return self._x(sql, params).fetchall()

    def _paper_view(self, row: dict, detail: bool = False) -> dict:
        p = _row(row)
        p["has_pdf"] = bool(p.get("pdf_key"))
        for k in _HIDDEN_PAPER_COLS:
            p.pop(k, None)
        p.pop("_total", None)
        p["starred"] = bool(p["starred"])
        for f in JSON_FIELDS:
            if not isinstance(p.get(f), list):
                p[f] = []
        if detail:
            p["note"] = p.get("note") or ""
        else:
            p.pop("note", None)
        return p

    # ------------------------------------------------------------------ papers
    def get_paper(self, paper_id: int, detail: bool = True) -> dict | None:
        row = self._one(_PAPER_SELECT.format(detail=_NOTE_COL if detail else "")
                        + " where p.id = %s and p.user_id = %s", (paper_id, self.uid))
        return self._paper_view(row, detail) if row else None

    def paper_ids(self, ids: Iterable[int]) -> list[int]:
        """내 논문인 id만 (요청 순서 유지)"""
        ids = [int(i) for i in ids]
        if not ids:
            return []
        mine = {r["id"] for r in self._all("select id from paperlab.papers where user_id = %s and id = any(%s)",
                                           (self.uid, ids))}
        return [i for i in dict.fromkeys(ids) if i in mine]

    def pdf_info(self, paper_id: int) -> dict | None:
        """저장소 키 등 내부 PDF 정보. 내 논문이 아니면 None"""
        return self._one("select id, pdf_key, pdf_sha256, pdf_size, title from paperlab.papers "
                         "where id = %s and user_id = %s", (paper_id, self.uid))

    def find_duplicate(self, doi: str = "", arxiv_id: str = "", title: str = "",
                       exclude_id: int | None = None) -> dict | None:
        """내 서재 안에서만: DOI 정규화 일치 → arXiv 일치 → 정규화 제목(12자 이상) 일치"""
        doi = normalize_doi(doi)
        arxiv_id = (arxiv_id or "").strip()
        norm = normalize_title(title)
        base = _PAPER_SELECT.format(detail="") + " where p.user_id = %s and p.id is distinct from %s and "
        row = None
        if doi:
            row = self._one(base + "p.doi = %s order by p.id limit 1", (self.uid, exclude_id, doi))
        if not row and arxiv_id:
            row = self._one(base + "p.arxiv_id = %s order by p.id limit 1", (self.uid, exclude_id, arxiv_id))
        if not row and len(norm) >= 12:
            row = self._one(base + "p.title_norm = %s order by p.id limit 1", (self.uid, exclude_id, norm))
        return self._paper_view(row) if row else None

    def _clean(self, data: dict) -> dict:
        out = {}
        for key in EDITABLE_FIELDS:
            if key not in data:
                continue
            value = data[key]
            if key in JSON_FIELDS:
                value = Jsonb(value if isinstance(value, list) else [])
            elif key == "doi":
                value = normalize_doi(value)
            elif key == "starred":
                value = bool(value)
            elif key in ("year", "rating", "cited_by_count", "page_count"):
                try:
                    value = int(value) if value not in (None, "") else None
                except (TypeError, ValueError):
                    value = None
                if value is not None and not -2**31 < value < 2**31:
                    value = None
                if key == "rating" and value is None:
                    value = 0
            elif key == "issued":
                value = format_issued(parse_issued(str(value or "")))
            elif value is None:
                value = ""
            else:
                value = _clean_text(str(value))
            out[key] = value
        if "title" in out:
            out["title_norm"] = normalize_title(out["title"])
        # 날짜만 들어오면 연도도 채운다
        if out.get("issued") and not out.get("year") and "year" not in data:
            out["year"] = int(out["issued"][:4])
        return out

    def add_paper(self, data: dict) -> int:
        fields = self._clean(data)
        fields.setdefault("title", "")
        fields.setdefault("title_norm", normalize_title(fields["title"]))
        ts = now_dt()
        fields.update(user_id=self.uid, added_at=ts, updated_at=ts)
        cols = ", ".join(fields)
        marks = ", ".join(f"%({k})s" for k in fields)
        pid = self._one(f"insert into paperlab.papers ({cols}) values ({marks}) returning id", fields)["id"]
        if not fields.get("citekey"):
            self._x("update paperlab.papers set citekey = %s where id = %s and user_id = %s",
                    (self._make_citekey(data, pid), pid, self.uid))
        self._reindex(pid)
        return pid

    def _make_citekey(self, data: dict, pid: int) -> str:
        """같은 키가 **내 서재에** 있으면 a, b, …, z, aa… 를 덧붙인다"""
        base = make_citekey(data)
        key, n = base, 0
        while self._one("select 1 as x from paperlab.papers where user_id = %s and citekey = %s and id <> %s",
                        (self.uid, key, pid)):
            n += 1
            key = base + chr(ord("a") + (n - 1) % 26) * ((n - 1) // 26 + 1)
        return key

    def update_paper(self, paper_id: int, data: dict) -> None:
        fields = self._clean(data)
        if not fields:
            return
        fields["updated_at"] = now_dt()
        sets = ", ".join(f"{k} = %({k})s" for k in fields)
        self._x(f"update paperlab.papers set {sets} where id = %(_id)s and user_id = %(_uid)s",
                {**fields, "_id": paper_id, "_uid": self.uid})
        self._reindex(paper_id)

    def set_pdf(self, paper_id: int, key: str, page_texts: list[str], sha256: str = "", size: int | None = None) -> None:
        self._x("update paperlab.papers set pdf_key = %s, pdf_sha256 = %s, pdf_size = %s, page_count = %s, "
                "updated_at = %s where id = %s and user_id = %s",
                (key, sha256, size, len(page_texts) or None, now_dt(), paper_id, self.uid))
        self._x("delete from paperlab.page_texts where paper_id = %s and user_id = %s", (paper_id, self.uid))
        if page_texts:
            with self.conn.cursor() as cur:
                cur.executemany("insert into paperlab.page_texts (user_id, paper_id, page, text) values (%s, %s, %s, %s)",
                                [(self.uid, paper_id, i + 1, _clean_text(t)) for i, t in enumerate(page_texts)])
        self._reindex(paper_id)

    def page_texts(self, paper_id: int) -> list[str]:
        return [r["text"] for r in self._all(
            "select text from paperlab.page_texts where paper_id = %s and user_id = %s order by page",
            (paper_id, self.uid))]

    def touch_opened(self, paper_id: int) -> None:
        self._x("update paperlab.papers set last_opened_at = %s where id = %s and user_id = %s",
                (now_dt(), paper_id, self.uid))

    def delete_paper(self, paper_id: int) -> str | None:
        """지운 논문의 저장소 키('' = PDF 없음). 내 논문이 아니면 None"""
        row = self._one("delete from paperlab.papers where id = %s and user_id = %s returning pdf_key",
                        (paper_id, self.uid))
        return row["pdf_key"] if row else None

    def _reindex(self, paper_id: int) -> None:
        """검색 메타(paper_search.meta)만 다시 쓴다. 본문은 page_texts에 쓰는 순간 색인된다."""
        row = self._one("select title, authors, abstract, keywords from paperlab.papers "
                        "where id = %s and user_id = %s", (paper_id, self.uid))
        if not row:
            return
        authors = " ".join(
            " ".join(filter(None, [a.get("given"), a.get("family"), a.get("literal")]))
            for a in (row["authors"] or []) if isinstance(a, dict))
        keywords = " ".join(str(k) for k in (row["keywords"] or []))
        tags = " ".join(r["name"] for r in self._all(
            "select t.name from paperlab.tags t join paperlab.paper_tags pt on pt.tag_id = t.id "
            "where pt.paper_id = %s", (paper_id,)))
        note = self._one("select content from paperlab.notes where paper_id = %s", (paper_id,))
        comments = " ".join(r["text"] + " " + r["comment"] for r in self._all(
            "select text, comment from paperlab.annotations where paper_id = %s order by id", (paper_id,)))
        meta = "\n".join([row["title"], authors, row["abstract"], (keywords + " " + tags).strip(),
                          ((note["content"] if note else "") + " " + comments).strip()])
        self._x("insert into paperlab.paper_search (paper_id, user_id, meta) values (%s, %s, %s) "
                "on conflict (paper_id) do update set meta = excluded.meta",
                (paper_id, self.uid, _clean_text(meta)))

    def reindex(self, paper_id: int) -> None:
        self._reindex(paper_id)

    def list_papers(self, q: str = "", collection_id: int | None = None, tag_id: int | None = None,
                    status: str = "", starred: bool = False, sort: str = "added",
                    filter_: str = "", limit: int = 500, offset: int = 0, folder_id: int | None = None) -> dict:
        where, params = ["p.user_id = %(uid)s"], {"uid": self.uid}
        if collection_id is not None:
            where.append("p.id in (select paper_id from paperlab.paper_collections where collection_id = %(cid)s)")
            params["cid"] = collection_id
        if tag_id is not None:
            where.append("p.id in (select paper_id from paperlab.paper_tags where tag_id = %(tid)s)")
            params["tid"] = tag_id
        if folder_id is not None:
            where.append("p.folder_id = %(fid)s")
            params["fid"] = folder_id
        if status:
            where.append("p.status = %(status)s")
            params["status"] = status
        if starred:
            where.append("p.starred")
        if filter_ == "unfiled":
            where.append("not exists (select 1 from paperlab.paper_collections pc where pc.paper_id = p.id)")
        elif filter_ == "no_pdf":
            where.append("p.pdf_key = ''")
        elif filter_ == "recent":
            where.append("p.last_opened_at is not null")
        elif filter_ == "no_folder":
            where.append("p.folder_id is null")
        terms: list[str] = []
        if q.strip():
            terms = [t for t in re.split(r"\s+", q.strip()) if t]
            ids = self._search_ids(terms)
            if not ids:
                return {"items": [], "total": 0}
            where.append("p.id = any(%(ids)s)")
            params["ids"] = ids
        clause = " and ".join(where)
        order = SORTS.get(sort, SORTS["added"])
        # 개수와 목록을 왕복 한 번에 (원격 DB 왕복 줄이기)
        rows = self._all(_PAPER_SELECT.format(detail=", count(*) over ()::int as _total") + f" where {clause} "
                         f"order by {order} limit %(limit)s offset %(offset)s", {**params, "limit": limit, "offset": offset})
        if rows:
            total = rows[0]["_total"]
        else:
            total = self._one(f"select count(*)::int as n from paperlab.papers p where {clause}", params)["n"]
        items = [self._paper_view(r) for r in rows]
        if terms and items:
            snippets = self._snippets([it["id"] for it in items], terms)
            for it in items:
                if it["id"] in snippets:
                    it["snippet"] = snippets[it["id"]]
        return {"items": items, "total": total}

    def _search_ids(self, terms: list[str]) -> list[int]:
        """모든 낱말이 (메타 또는 본문의 어느 쪽에) 있는 논문 id (AND). 1글자는 ILIKE, 나머지는 PGroonga &@
        (&@~ 질의 문법을 쓰지 않으므로 OR · - · 괄호가 문법으로 해석되지 않는다)."""
        conds, params = [], {"uid": self.uid, "lim": SEARCH_LIMIT}
        for i, t in enumerate(terms):
            k = f"t{i}"
            if len(t) == 1:
                params[k] = _like(t)
                op = f"ilike %({k})s escape '\\'"
            else:
                params[k] = t
                op = f"{PGRN_MATCH} %({k})s"
            conds.append(
                f"ps.paper_id in (select s.paper_id from paperlab.paper_search s where s.user_id = %(uid)s and s.meta {op} "
                f"union select pt.paper_id from paperlab.page_texts pt where pt.user_id = %(uid)s and pt.text {op})")
        # PGroonga 3.2.5 실측: 순차 검색에서도 색인의 토크나이저(TokenNgram)로 판단해 결과가 같다
        rows = self._all("select ps.paper_id from paperlab.paper_search ps where ps.user_id = %(uid)s and "
                         + " and ".join(conds) + " order by ps.paper_id limit %(lim)s", params)
        return [r["paper_id"] for r in rows]

    def _snippets(self, ids: list[int], terms: list[str]) -> dict[int, str]:
        """본문에서 찾은 논문: 첫 번째로 맞는 쪽에서 첫 3글자 이상 낱말 주변 약 16단어, [[낱말]] 표시"""
        long_terms = [t for t in terms if len(t) >= 3]
        if not long_terms:
            return {}
        rows = self._all(
            "select distinct on (paper_id) paper_id, text from paperlab.page_texts "
            "where user_id = %s and paper_id = any(%s) and text ilike any(%s) order by paper_id, page",
            (self.uid, ids, [_like(t) for t in long_terms]))
        out = {}
        for r in rows:
            snip = make_snippet(r["text"], long_terms)
            if snip:
                out[r["paper_id"]] = snip
        return out

    def stats(self) -> dict:
        row = self._one(
            "select count(*)::int as total, "
            "count(*) filter (where status = 'unread')::int as unread, "
            "count(*) filter (where status = 'reading')::int as reading, "
            "count(*) filter (where status = 'done')::int as done, "
            "count(*) filter (where starred)::int as starred, "
            "count(*) filter (where pdf_key <> '')::int as with_pdf, "
            "count(*) filter (where not exists (select 1 from paperlab.paper_collections pc "
            "  where pc.paper_id = p.id))::int as unfiled "
            "from paperlab.papers p where p.user_id = %s", (self.uid,))
        row["annotations"] = self._one("select count(*)::int as n from paperlab.annotations where user_id = %s",
                                       (self.uid,))["n"]
        row["summaries"] = self._one("select count(*)::int as n from paperlab.ai_summaries where user_id = %s",
                                     (self.uid,))["n"]
        return dict(row)

    def mine_pdf_bytes(self) -> int:
        return self._one("select coalesce(sum(pdf_size), 0)::bigint as n from paperlab.papers "
                         "where user_id = %s and pdf_key <> ''", (self.uid,))["n"]

    # ------------------------------------------------------------- collections
    def list_collections(self) -> list[dict]:
        return self._all(
            "select c.id, c.name, c.parent_id, "
            "(select count(*) from paperlab.paper_collections pc where pc.collection_id = c.id)::int as count "
            'from paperlab.collections c where c.user_id = %s order by lower(c.name) collate "C", c.id', (self.uid,))

    def has_collection(self, cid) -> bool:
        try:
            cid = int(cid)
        except (TypeError, ValueError):
            return False
        return bool(self._one("select 1 as x from paperlab.collections where id = %s and user_id = %s",
                              (cid, self.uid)))

    def add_collection(self, name: str, parent_id: int | None = None) -> int:
        if parent_id is not None and not self.has_collection(parent_id):
            raise ValueError("상위 컬렉션을 찾을 수 없어요")
        return self._one("insert into paperlab.collections (user_id, name, parent_id, created_at) "
                         "values (%s, %s, %s, %s) returning id", (self.uid, name, parent_id, now_dt()))["id"]

    def update_collection(self, cid: int, name: str | None = None, parent_id=...) -> None:
        if not self.has_collection(cid):
            raise NotFoundError("컬렉션을 찾을 수 없어요")
        if name is not None:
            self._x("update paperlab.collections set name = %s where id = %s and user_id = %s", (name, cid, self.uid))
        if parent_id is not ...:
            if parent_id is not None:
                if not self.has_collection(parent_id):
                    raise ValueError("상위 컬렉션을 찾을 수 없어요")
                if self._is_descendant("collections", int(parent_id), cid):
                    raise ValueError("컬렉션을 자기 하위로 옮길 수 없어요")
            self._x("update paperlab.collections set parent_id = %s where id = %s and user_id = %s",
                    (parent_id, cid, self.uid))

    def _is_descendant(self, table: str, node: int | None, ancestor: int) -> bool:
        seen = set()
        while node is not None and node not in seen:
            if node == ancestor:
                return True
            seen.add(node)
            row = self._one(f"select parent_id from paperlab.{table} where id = %s and user_id = %s", (node, self.uid))
            node = row["parent_id"] if row else None
        return False

    def delete_collection(self, cid: int) -> bool:
        return self._x("delete from paperlab.collections where id = %s and user_id = %s",
                       (cid, self.uid)).rowcount > 0

    def set_paper_collections(self, paper_ids: Iterable[int], collection_id: int, add: bool) -> None:
        if not self.has_collection(collection_id):
            raise ValueError("컬렉션을 찾을 수 없어요")
        ids = self.paper_ids(paper_ids)
        if add:
            self._x("insert into paperlab.paper_collections (user_id, paper_id, collection_id) "
                    "select %s::uuid, unnest(%s::bigint[]), %s::bigint on conflict do nothing", (self.uid, ids, collection_id))
        else:
            self._x("delete from paperlab.paper_collections where user_id = %s and collection_id = %s "
                    "and paper_id = any(%s)", (self.uid, collection_id, ids))

    # ----------------------------------------------------------------- folders
    def list_folders(self) -> list[dict]:
        return self._all(
            "select f.id, f.name, f.parent_id, "
            "(select count(*) from paperlab.papers p where p.folder_id = f.id)::int as count "
            'from paperlab.folders f where f.user_id = %s order by lower(f.name) collate "C", f.id', (self.uid,))

    def has_folder(self, fid) -> bool:
        try:
            fid = int(fid)
        except (TypeError, ValueError):
            return False
        return bool(self._one("select 1 as x from paperlab.folders where id = %s and user_id = %s", (fid, self.uid)))

    def _folder_name_taken(self, name: str, parent_id: int | None, exclude: int | None = None) -> bool:
        return bool(self._one(
            "select 1 as x from paperlab.folders where user_id = %s and coalesce(parent_id, 0) = coalesce(%s, 0) "
            "and lower(name) = lower(%s) and id is distinct from %s", (self.uid, parent_id, name, exclude)))

    def add_folder(self, name: str, parent_id: int | None = None) -> int:
        if parent_id is not None and not self.has_folder(parent_id):
            raise ValueError("상위 폴더를 찾을 수 없어요")
        if self._folder_name_taken(name, parent_id):
            raise ValueError("같은 이름의 폴더가 이미 있어요")
        ts = now_dt()
        return self._one("insert into paperlab.folders (user_id, name, parent_id, created_at, updated_at) "
                         "values (%s, %s, %s, %s, %s) returning id", (self.uid, name, parent_id, ts, ts))["id"]

    def update_folder(self, fid: int, name: str | None = None, parent_id=...) -> None:
        row = self._one("select id, name, parent_id from paperlab.folders where id = %s and user_id = %s",
                        (fid, self.uid))
        if not row:
            raise NotFoundError("폴더를 찾을 수 없어요")
        new_name = row["name"] if name is None else name
        new_parent = row["parent_id"] if parent_id is ... else parent_id
        if new_parent is not None:
            new_parent = int(new_parent)
            if not self.has_folder(new_parent):
                raise ValueError("상위 폴더를 찾을 수 없어요")
            if self._is_descendant("folders", new_parent, fid):
                raise ValueError("폴더를 자기 하위로 옮길 수 없어요")
        if self._folder_name_taken(new_name, new_parent, exclude=fid):
            raise ValueError("같은 이름의 폴더가 이미 있어요")
        self._x("update paperlab.folders set name = %s, parent_id = %s, updated_at = %s where id = %s and user_id = %s",
                (new_name, new_parent, now_dt(), fid, self.uid))

    def delete_folder(self, fid: int) -> dict:
        """안의 논문과 하위 폴더를 지운 폴더의 부모로 올리고 지운다(확정 Q5). 논문·PDF는 지우지 않는다."""
        row = self._one("select parent_id from paperlab.folders where id = %s and user_id = %s", (fid, self.uid))
        if not row:
            raise NotFoundError("폴더를 찾을 수 없어요")
        parent = row["parent_id"]
        moved_papers = self._x("update paperlab.papers set folder_id = %s where folder_id = %s and user_id = %s",
                               (parent, fid, self.uid)).rowcount
        children = self._all("select id, name from paperlab.folders where parent_id = %s and user_id = %s order by id",
                             (fid, self.uid))
        taken = {r["name"].lower() for r in self._all(
            "select name from paperlab.folders where user_id = %s and coalesce(parent_id, 0) = coalesce(%s, 0) "
            "and id <> %s", (self.uid, parent, fid))}
        for child in children:
            # 부모에 같은 이름이 있으면 " (2)", " (3)" … 을 붙여 옮긴다 (가정)
            name, n = child["name"], 1
            while name.lower() in taken:
                n += 1
                suffix = f" ({n})"
                name = child["name"][:100 - len(suffix)] + suffix
            taken.add(name.lower())
            self._x("update paperlab.folders set parent_id = %s, name = %s, updated_at = %s where id = %s and user_id = %s",
                    (parent, name, now_dt(), child["id"], self.uid))
        self._x("delete from paperlab.folders where id = %s and user_id = %s", (fid, self.uid))
        return {"moved_papers": moved_papers, "moved_folders": len(children)}

    def move_papers_to_folder(self, paper_ids: Iterable[int], folder_id: int | None) -> int:
        if folder_id is not None and not self.has_folder(folder_id):
            raise ValueError("폴더를 찾을 수 없어요")
        ids = self.paper_ids(paper_ids)
        return self._x("update paperlab.papers set folder_id = %s, updated_at = %s where user_id = %s and id = any(%s)",
                       (folder_id, now_dt(), self.uid, ids)).rowcount

    # -------------------------------------------------------------------- tags
    def list_tags(self) -> list[dict]:
        return self._all(
            "select t.id, t.name, t.color, "
            "(select count(*) from paperlab.paper_tags pt where pt.tag_id = t.id)::int as count "
            'from paperlab.tags t where t.user_id = %s order by lower(t.name) collate "C", t.id', (self.uid,))

    def ensure_tag(self, name: str) -> int:
        row = self._one("select id from paperlab.tags where user_id = %s and lower(name) = lower(%s)", (self.uid, name))
        if row:
            return row["id"]
        return self._one("insert into paperlab.tags (user_id, name) values (%s, %s) returning id",
                         (self.uid, name))["id"]

    def _drop_unused_tags(self) -> None:
        self._x("delete from paperlab.tags t where t.user_id = %s and t.color = '' and not exists "
                "(select 1 from paperlab.paper_tags pt where pt.tag_id = t.id)", (self.uid,))

    def set_paper_tags(self, paper_id: int, names: list[str]) -> None:
        names = list(dict.fromkeys(n.strip() for n in names if isinstance(n, str) and n.strip()))
        self._x("delete from paperlab.paper_tags where paper_id = %s and user_id = %s", (paper_id, self.uid))
        for name in names:
            self._x("insert into paperlab.paper_tags (user_id, paper_id, tag_id) values (%s, %s, %s) "
                    "on conflict do nothing", (self.uid, paper_id, self.ensure_tag(name)))
        self._drop_unused_tags()
        self._reindex(paper_id)

    def add_tag_to_papers(self, paper_ids: Iterable[int], name: str) -> None:
        tid = self.ensure_tag(name.strip())
        for pid in self.paper_ids(paper_ids):
            self._x("insert into paperlab.paper_tags (user_id, paper_id, tag_id) values (%s, %s, %s) "
                    "on conflict do nothing", (self.uid, pid, tid))
            self._reindex(pid)

    def _tag_paper_ids(self, tag_id: int) -> list[int]:
        return [r["paper_id"] for r in self._all(
            "select paper_id from paperlab.paper_tags where tag_id = %s and user_id = %s", (tag_id, self.uid))]

    def update_tag(self, tag_id: int, name: str | None = None, color: str | None = None) -> None:
        """같은 이름(대소문자 무시)이 있으면 psycopg.errors.UniqueViolation"""
        if not self._one("select 1 as x from paperlab.tags where id = %s and user_id = %s", (tag_id, self.uid)):
            raise NotFoundError("태그를 찾을 수 없어요")
        if name and name.strip():
            self._x("update paperlab.tags set name = %s where id = %s and user_id = %s", (name.strip(), tag_id, self.uid))
            for pid in self._tag_paper_ids(tag_id):
                self._reindex(pid)
        if color is not None:
            self._x("update paperlab.tags set color = %s where id = %s and user_id = %s", (color, tag_id, self.uid))

    def delete_tag(self, tag_id: int) -> bool:
        pids = self._tag_paper_ids(tag_id)
        n = self._x("delete from paperlab.tags where id = %s and user_id = %s", (tag_id, self.uid)).rowcount
        for pid in pids:
            self._reindex(pid)
        return n > 0

    # ------------------------------------------------------- annotations/notes
    def list_annotations(self, paper_id: int) -> list[dict]:
        return [_row(r) for r in self._all(
            "select id, paper_id, page, kind, color, text, comment, rects, created_at, updated_at "
            "from paperlab.annotations where paper_id = %s and user_id = %s order by page, id", (paper_id, self.uid))]

    def add_annotation(self, paper_id: int, data: dict) -> int:
        ts = now_dt()
        try:
            page = int(data.get("page") or 1)
        except (TypeError, ValueError):
            page = 1
        rects = data.get("rects") if isinstance(data.get("rects"), list) else []
        aid = self._one(
            "insert into paperlab.annotations (user_id, paper_id, page, kind, color, text, comment, rects, created_at, "
            "updated_at) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning id",
            (self.uid, paper_id, page, data.get("kind") or "highlight", data.get("color") or "yellow",
             _clean_text(data.get("text") or ""), _clean_text(data.get("comment") or ""), Jsonb(rects), ts, ts))["id"]
        self._reindex(paper_id)
        return aid

    def get_annotation(self, annotation_id: int) -> dict | None:
        return _row(self._one(
            "select id, paper_id, page, kind, color, text, comment, rects, created_at, updated_at "
            "from paperlab.annotations where id = %s and user_id = %s", (annotation_id, self.uid)))

    def update_annotation(self, annotation_id: int, data: dict) -> dict | None:
        row = self._one("select paper_id from paperlab.annotations where id = %s and user_id = %s",
                        (annotation_id, self.uid))
        if not row:
            return None
        for key in ("color", "comment", "kind"):
            if key in data and data[key] is not None:
                self._x(f"update paperlab.annotations set {key} = %s, updated_at = %s where id = %s and user_id = %s",
                        (_clean_text(str(data[key])), now_dt(), annotation_id, self.uid))
        self._reindex(row["paper_id"])
        return self.get_annotation(annotation_id)

    def delete_annotation(self, annotation_id: int) -> bool:
        row = self._one("delete from paperlab.annotations where id = %s and user_id = %s returning paper_id",
                        (annotation_id, self.uid))
        if row:
            self._reindex(row["paper_id"])
        return row is not None

    def save_note(self, paper_id: int, content: str) -> None:
        self._x("insert into paperlab.notes (paper_id, user_id, content, updated_at) values (%s, %s, %s, %s) "
                "on conflict (paper_id) do update set content = excluded.content, updated_at = excluded.updated_at",
                (paper_id, self.uid, _clean_text(content), now_dt()))
        self._reindex(paper_id)

    # --------------------------------------------------------------------- AI
    def get_summary(self, paper_id: int) -> dict | None:
        row = self._one("select data, model, created_at from paperlab.ai_summaries where paper_id = %s and user_id = %s",
                        (paper_id, self.uid))
        return _row(row) if row else None

    def save_summary(self, paper_id: int, data: dict, model: str) -> None:
        self._x("insert into paperlab.ai_summaries (paper_id, user_id, data, model, created_at) "
                "values (%s, %s, %s, %s, %s) on conflict (paper_id) do update set data = excluded.data, "
                "model = excluded.model, created_at = excluded.created_at",
                (paper_id, self.uid, Jsonb(data), model, now_dt()))

    def _session_id(self, paper_id: int, create: bool) -> int | None:
        row = self._one("select id from paperlab.chat_sessions where user_id = %s and paper_id = %s and scope = 'paper'",
                        (self.uid, paper_id))
        if row or not create:
            return row["id"] if row else None
        self._x("insert into paperlab.chat_sessions (user_id, scope, paper_id) values (%s, 'paper', %s) "
                "on conflict (user_id, paper_id) where scope = 'paper' do nothing", (self.uid, paper_id))
        return self._session_id(paper_id, create=False)

    def chat_history(self, paper_id: int) -> list[dict]:
        return [_row(r) for r in self._all(
            "select m.id, s.paper_id, m.role, m.content, m.citations, m.created_at from paperlab.chat_messages m "
            "join paperlab.chat_sessions s on s.id = m.session_id "
            "where s.user_id = %s and s.paper_id = %s and s.scope = 'paper' order by m.id", (self.uid, paper_id))]

    def add_chat_message(self, paper_id: int, role: str, content: str, citations: list | None = None) -> int:
        sid = self._session_id(paper_id, create=True)
        return self._one("insert into paperlab.chat_messages (user_id, session_id, role, content, citations, created_at) "
                         "values (%s, %s, %s, %s, %s, %s) returning id",
                         (self.uid, sid, role, _clean_text(content), Jsonb(citations or []), now_dt()))["id"]

    def clear_chat(self, paper_id: int) -> None:
        sid = self._session_id(paper_id, create=False)
        if sid is not None:
            self._x("delete from paperlab.chat_messages where session_id = %s and user_id = %s", (sid, self.uid))

    # ------------------------------------------------------------ manuscripts
    def list_manuscripts(self) -> list[dict]:
        return [_row(r) for r in self._all(
            "select id, title, template, style, doc_format, created_at, updated_at, char_length(content) as length "
            "from paperlab.manuscripts where user_id = %s order by updated_at desc, id desc", (self.uid,))]

    def get_manuscript(self, mid: int) -> dict | None:
        row = self._one("select id, title, content, template, style, doc_format, cover, created_at, updated_at "
                        "from paperlab.manuscripts where id = %s and user_id = %s", (mid, self.uid))
        if not row:
            return None
        m = _row(row)
        if not isinstance(m.get("cover"), dict):
            m["cover"] = {}
        return m

    def add_manuscript(self, title: str, content: str, template: str = "", doc_format: str = "default") -> int:
        ts = now_dt()
        return self._one("insert into paperlab.manuscripts (user_id, title, content, template, doc_format, created_at, "
                         "updated_at) values (%s, %s, %s, %s, %s, %s, %s) returning id",
                         (self.uid, title, _clean_text(content), template, doc_format, ts, ts))["id"]

    def update_manuscript(self, mid: int, data: dict) -> None:
        fields = {k: _clean_text(str(data[k])) for k in ("title", "content", "style", "doc_format")
                  if k in data and data[k] is not None}
        if isinstance(data.get("cover"), dict):
            fields["cover"] = Jsonb(data["cover"])
        if not fields:
            return
        fields["updated_at"] = now_dt()
        sets = ", ".join(f"{k} = %({k})s" for k in fields)
        self._x(f"update paperlab.manuscripts set {sets} where id = %(_id)s and user_id = %(_uid)s",
                {**fields, "_id": mid, "_uid": self.uid})

    def delete_manuscript(self, mid: int) -> bool:
        return self._x("delete from paperlab.manuscripts where id = %s and user_id = %s", (mid, self.uid)).rowcount > 0

    # ------------------------------------------------------------ doc formats
    def list_doc_formats(self) -> list[dict]:
        return [_row(r) for r in self._all(
            "select id, name, base, data, created_at, updated_at from paperlab.doc_formats where user_id = %s "
            "order by updated_at desc, id desc", (self.uid,))]

    def get_doc_format(self, fid: int) -> dict | None:
        row = self._one("select id, name, base, data, created_at, updated_at from paperlab.doc_formats "
                        "where id = %s and user_id = %s", (fid, self.uid))
        if not row:
            return None
        f = _row(row)
        if not isinstance(f.get("data"), dict):
            f["data"] = {}
        return f

    def count_doc_formats(self) -> int:
        return self._one("select count(*)::int as n from paperlab.doc_formats where user_id = %s", (self.uid,))["n"]

    def add_doc_format(self, name: str, base: str, data: dict) -> int:
        ts = now_dt()
        return self._one("insert into paperlab.doc_formats (user_id, name, base, data, created_at, updated_at) "
                         "values (%s, %s, %s, %s, %s, %s) returning id", (self.uid, name, base, Jsonb(data), ts, ts))["id"]

    def update_doc_format(self, fid: int, name: str | None = None, data: dict | None = None) -> None:
        fields: dict = {}
        if name is not None:
            fields["name"] = name
        if data is not None:
            fields["data"] = Jsonb(data)
        if not fields:
            return
        ts = now_dt()
        # 같은 초에 두 번 바꿔도 updated_at이 바뀌도록 한다 (0단계 AC-08)
        old = self._one("select updated_at from paperlab.doc_formats where id = %s and user_id = %s", (fid, self.uid))
        if old and old["updated_at"] >= ts:
            ts = old["updated_at"].astimezone(timezone.utc).replace(microsecond=0) + timedelta(seconds=1)
        fields["updated_at"] = ts
        sets = ", ".join(f"{k} = %({k})s" for k in fields)
        self._x(f"update paperlab.doc_formats set {sets} where id = %(_id)s and user_id = %(_uid)s",
                {**fields, "_id": fid, "_uid": self.uid})

    def delete_doc_format(self, fid: int, format_key: str) -> int:
        """양식을 지우고 그 양식을 쓰던 내 원고를 'default'로 돌린다. 돌린 원고 수를 돌려준다."""
        n = self._x("update paperlab.manuscripts set doc_format = 'default' where user_id = %s and doc_format = %s",
                    (self.uid, format_key)).rowcount
        self._x("delete from paperlab.doc_formats where id = %s and user_id = %s", (fid, self.uid))
        return n

    def doc_format_usage(self) -> dict[str, int]:
        """양식 id → 그 양식을 쓰는 내 원고 수"""
        return {r["doc_format"]: r["n"] for r in self._all(
            "select doc_format, count(*)::int as n from paperlab.manuscripts where user_id = %s group by doc_format",
            (self.uid,))}

    def papers_by_citekeys(self, keys: list[str]) -> dict[str, dict]:
        keys = [k for k in dict.fromkeys(keys) if k]
        if not keys:
            return {}
        rows = self._all(_PAPER_SELECT.format(detail=_NOTE_COL) + " where p.user_id = %s and p.citekey = any(%s) "
                         "order by p.id", (self.uid, keys))
        return {r["citekey"]: self._paper_view(r, detail=True) for r in rows}

    # ------------------------------------------------------------ user styles
    def list_user_styles(self) -> list[dict]:
        return [_row(r) for r in self._all(
            "select style_id, title, info from paperlab.user_styles where user_id = %s order by style_id", (self.uid,))]

    def get_user_style(self, style_id: str) -> dict | None:
        return _row(self._one("select style_id, title, info, xml from paperlab.user_styles "
                              "where user_id = %s and style_id = %s", (self.uid, style_id)))

    def save_user_style(self, style_id: str, title: str, info: dict, xml: str) -> None:
        ts = now_dt()
        self._x("insert into paperlab.user_styles (user_id, style_id, title, info, xml, created_at, updated_at) "
                "values (%s, %s, %s, %s, %s, %s, %s) on conflict (user_id, style_id) do update set "
                "title = excluded.title, info = excluded.info, xml = excluded.xml, updated_at = excluded.updated_at",
                (self.uid, style_id, title, Jsonb(info), _clean_text(xml), ts, ts))

    def delete_user_style(self, style_id: str) -> bool:
        return self._x("delete from paperlab.user_styles where user_id = %s and style_id = %s",
                       (self.uid, style_id)).rowcount > 0

    # ---------------------------------------------------- profile · settings
    def ensure_profile(self, email: str, display_name: str = "") -> dict:
        """첫 요청 때 profiles 행을 만든다(트리거로 auth 스키마를 건드리지 않음)."""
        ts = now_dt()
        self._x("insert into paperlab.profiles (user_id, email, display_name, created_at, updated_at) "
                "values (%s, %s, %s, %s, %s) on conflict (user_id) do nothing",
                (self.uid, email or "", display_name or "", ts, ts))
        return _row(self._one("select user_id, email, display_name from paperlab.profiles where user_id = %s",
                              (self.uid,)))

    def get_settings(self) -> dict:
        row = self._one("select settings from paperlab.profiles where user_id = %s", (self.uid,))
        return dict(row["settings"]) if row and isinstance(row["settings"], dict) else {}

    def update_settings(self, changes: dict, email: str = "") -> None:
        if not changes:
            return
        ts = now_dt()
        self._x("insert into paperlab.profiles (user_id, email, settings, created_at, updated_at) "
                "values (%s, %s, %s, %s, %s) on conflict (user_id) do update set "
                "settings = paperlab.profiles.settings || excluded.settings, updated_at = excluded.updated_at",
                (self.uid, email or "", Jsonb(changes), ts, ts))

    def list_secrets(self) -> list[dict]:
        return self._all("select name, ciphertext, nonce, key_id, hint from paperlab.user_secrets where user_id = %s",
                         (self.uid,))

    def set_secret(self, name: str, ciphertext: bytes, nonce: bytes, key_id: str, hint: str) -> None:
        self._x("insert into paperlab.user_secrets (user_id, name, ciphertext, nonce, key_id, hint, updated_at) "
                "values (%s, %s, %s, %s, %s, %s, %s) on conflict (user_id, name) do update set "
                "ciphertext = excluded.ciphertext, nonce = excluded.nonce, key_id = excluded.key_id, "
                "hint = excluded.hint, updated_at = excluded.updated_at",
                (self.uid, name, ciphertext, nonce, key_id, hint, now_dt()))

    def delete_secret(self, name: str) -> None:
        self._x("delete from paperlab.user_secrets where user_id = %s and name = %s", (self.uid, name))


# ====================================================================== 스니펫
def make_snippet(text: str, long_terms: list[str], width: int = 16) -> str:
    """text에서 첫 낱말(3글자 이상)이 처음 나오는 곳 주변 약 width 단어를 자르고 낱말을 [[ ]]로 감싼다."""
    low = text.lower()
    first = None
    for t in long_terms:
        i = low.find(t.lower())
        if i >= 0 and (first is None or i < first[0]):
            first = (i, t)
    if first is None:
        return ""
    words = [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]
    if not words:
        return ""
    idx = next((k for k, (s, e) in enumerate(words) if e > first[0]), len(words) - 1)
    start = max(0, idx - width // 2)
    end = min(len(words), start + width)
    start = max(0, end - width)
    seg = text[words[start][0]:words[end - 1][1]]
    seg = re.sub(r"\s+", " ", seg)
    pattern = re.compile("|".join(re.escape(t) for t in sorted(long_terms, key=len, reverse=True)), re.I)
    seg = pattern.sub(lambda m: f"[[{m.group(0)}]]", seg)
    return ("…" if start > 0 else "") + seg + ("…" if end < len(words) else "")
