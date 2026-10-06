"""SQLite 저장소: 논문, 컬렉션, 태그, 하이라이트, 노트, AI 결과, 대화 기록, 전문 검색 색인."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .citations import format_issued, make_citekey, parse_issued

SCHEMA = """
CREATE TABLE IF NOT EXISTS papers (
    id              INTEGER PRIMARY KEY,
    title           TEXT NOT NULL DEFAULT '',
    authors         TEXT NOT NULL DEFAULT '[]',
    year            INTEGER,
    venue           TEXT NOT NULL DEFAULT '',
    volume          TEXT NOT NULL DEFAULT '',
    issue           TEXT NOT NULL DEFAULT '',
    pages           TEXT NOT NULL DEFAULT '',
    publisher       TEXT NOT NULL DEFAULT '',
    doi             TEXT NOT NULL DEFAULT '',
    arxiv_id        TEXT NOT NULL DEFAULT '',
    openalex_id     TEXT NOT NULL DEFAULT '',
    s2_id           TEXT NOT NULL DEFAULT '',
    url             TEXT NOT NULL DEFAULT '',
    pdf_url         TEXT NOT NULL DEFAULT '',
    abstract        TEXT NOT NULL DEFAULT '',
    item_type       TEXT NOT NULL DEFAULT 'article',
    keywords        TEXT NOT NULL DEFAULT '[]',
    pdf_path        TEXT NOT NULL DEFAULT '',
    page_count      INTEGER,
    status          TEXT NOT NULL DEFAULT 'unread',
    starred         INTEGER NOT NULL DEFAULT 0,
    rating          INTEGER NOT NULL DEFAULT 0,
    cited_by_count  INTEGER,
    citekey         TEXT NOT NULL DEFAULT '',
    added_at        TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    last_opened_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_papers_arxiv ON papers(arxiv_id);

CREATE TABLE IF NOT EXISTS collections (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    parent_id  INTEGER REFERENCES collections(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_collections (
    paper_id      INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    PRIMARY KEY (paper_id, collection_id)
);

CREATE TABLE IF NOT EXISTS tags (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS paper_tags (
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (paper_id, tag_id)
);

CREATE TABLE IF NOT EXISTS annotations (
    id         INTEGER PRIMARY KEY,
    paper_id   INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    page       INTEGER NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'highlight',
    color      TEXT NOT NULL DEFAULT 'yellow',
    text       TEXT NOT NULL DEFAULT '',
    comment    TEXT NOT NULL DEFAULT '',
    rects      TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_paper ON annotations(paper_id, page);

CREATE TABLE IF NOT EXISTS notes (
    paper_id   INTEGER PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
    content    TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_summaries (
    paper_id   INTEGER PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
    data       TEXT NOT NULL,
    model      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY,
    paper_id   INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    citations  TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_paper ON chat_messages(paper_id, id);

CREATE TABLE IF NOT EXISTS page_texts (
    paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    page     INTEGER NOT NULL,
    text     TEXT NOT NULL,
    PRIMARY KEY (paper_id, page)
);
"""

# 한국어처럼 띄어쓰기 단위가 길거나 부분 일치가 필요한 언어를 위해 trigram 토크나이저를 쓴다.
FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
    title, authors, abstract, keywords, notes, fulltext,
    tokenize = 'trigram'
);
"""

JSON_FIELDS = ("authors", "keywords")
EDITABLE_FIELDS = (
    "title", "authors", "year", "venue", "volume", "issue", "pages", "publisher",
    "doi", "arxiv_id", "openalex_id", "s2_id", "url", "pdf_url", "abstract", "item_type",
    "keywords", "status", "starred", "rating", "cited_by_count", "citekey", "page_count", "issued", "language",
)
# 처음 버전 뒤에 추가된 열: 기존 서재 파일에는 시작할 때 덧붙인다
MIGRATIONS = {
    "papers": [("issued", "TEXT NOT NULL DEFAULT ''"), ("language", "TEXT NOT NULL DEFAULT ''")],
}
SORTS = {
    "added": "p.added_at DESC",
    "updated": "p.updated_at DESC",
    "opened": "COALESCE(p.last_opened_at, '') DESC",
    "year": "COALESCE(p.year, 0) DESC, p.title",
    "title": "p.title COLLATE NOCASE",
    "cited": "COALESCE(p.cited_by_count, -1) DESC",
    "first_author": "json_extract(p.authors, '$[0].family') COLLATE NOCASE",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def normalize_title(title: str) -> str:
    return re.sub(r"[\W_]+", "", (title or "").lower())


def normalize_doi(doi: str) -> str:
    doi = (doi or "").strip()
    doi = re.sub(r"^(https?://(dx\.)?doi\.org/|doi:\s*)", "", doi, flags=re.I)
    return doi.lower()


class Database:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._write_lock = threading.RLock()
        with self.connect() as conn:
            conn.executescript(SCHEMA)
            conn.executescript(FTS_SCHEMA)
            for table, cols in MIGRATIONS.items():
                have = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
                for name, decl in cols:
                    if name not in have:
                        conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ------------------------------------------------------------------ papers
    def _row_to_paper(self, conn, row: sqlite3.Row, detail: bool = False) -> dict:
        p = dict(row)
        for f in JSON_FIELDS:
            try:
                p[f] = json.loads(p[f] or "[]")
            except json.JSONDecodeError:
                p[f] = []
        p["starred"] = bool(p["starred"])
        p["has_pdf"] = bool(p["pdf_path"])
        pid = p["id"]
        p["tags"] = [dict(r) for r in conn.execute(
            "SELECT t.id, t.name, t.color FROM tags t JOIN paper_tags pt ON pt.tag_id = t.id "
            "WHERE pt.paper_id = ? ORDER BY t.name", (pid,))]
        p["collections"] = [r[0] for r in conn.execute(
            "SELECT collection_id FROM paper_collections WHERE paper_id = ?", (pid,))]
        p["has_summary"] = conn.execute(
            "SELECT 1 FROM ai_summaries WHERE paper_id = ?", (pid,)).fetchone() is not None
        p["annotation_count"] = conn.execute(
            "SELECT COUNT(*) FROM annotations WHERE paper_id = ?", (pid,)).fetchone()[0]
        if detail:
            note = conn.execute("SELECT content FROM notes WHERE paper_id = ?", (pid,)).fetchone()
            p["note"] = note[0] if note else ""
        return p

    def get_paper(self, paper_id: int, detail: bool = True) -> dict | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
            return self._row_to_paper(conn, row, detail) if row else None

    def find_duplicate(self, doi: str = "", arxiv_id: str = "", title: str = "",
                       exclude_id: int | None = None) -> dict | None:
        doi = normalize_doi(doi)
        arxiv_id = (arxiv_id or "").strip()
        norm = normalize_title(title)
        with self.connect() as conn:
            row = None
            if doi:
                row = conn.execute("SELECT * FROM papers WHERE doi = ? AND id IS NOT ?",
                                   (doi, exclude_id)).fetchone()
            if not row and arxiv_id:
                row = conn.execute("SELECT * FROM papers WHERE arxiv_id = ? AND id IS NOT ?",
                                   (arxiv_id, exclude_id)).fetchone()
            if not row and len(norm) >= 12:
                for cand in conn.execute("SELECT * FROM papers WHERE id IS NOT ?", (exclude_id,)):
                    if normalize_title(cand["title"]) == norm:
                        row = cand
                        break
            return self._row_to_paper(conn, row) if row else None

    def _clean(self, data: dict) -> dict:
        out = {}
        for key in EDITABLE_FIELDS:
            if key not in data:
                continue
            value = data[key]
            if key in JSON_FIELDS:
                value = json.dumps(value or [], ensure_ascii=False)
            elif key == "doi":
                value = normalize_doi(value)
            elif key in ("starred",):
                value = 1 if value else 0
            elif key in ("year", "rating", "cited_by_count", "page_count"):
                try:
                    value = int(value) if value not in (None, "") else None
                except (TypeError, ValueError):
                    value = None
                if key == "rating" and value is None:
                    value = 0
            elif key == "issued":
                value = format_issued(parse_issued(str(value or "")))
            elif value is None:
                value = ""
            out[key] = value
        # 날짜만 들어오면 연도도 채운다
        if out.get("issued") and not out.get("year") and "year" not in data:
            out["year"] = int(out["issued"][:4])
        return out

    def add_paper(self, data: dict) -> int:
        fields = self._clean(data)
        fields.setdefault("title", "")
        ts = now()
        fields["added_at"] = ts
        fields["updated_at"] = ts
        cols = ", ".join(fields)
        marks = ", ".join("?" for _ in fields)
        with self._write_lock, self.connect() as conn:
            cur = conn.execute(f"INSERT INTO papers ({cols}) VALUES ({marks})", list(fields.values()))
            pid = cur.lastrowid
            if not fields.get("citekey"):
                conn.execute("UPDATE papers SET citekey = ? WHERE id = ?",
                             (self._make_citekey(conn, data, pid), pid))
            self._reindex(conn, pid)
            return pid

    def _make_citekey(self, conn, data: dict, pid: int) -> str:
        base = make_citekey(data)
        key, n = base, 0
        while conn.execute("SELECT 1 FROM papers WHERE citekey = ? AND id != ?", (key, pid)).fetchone():
            n += 1
            key = base + chr(ord("a") + (n - 1) % 26) * ((n - 1) // 26 + 1)
        return key

    def update_paper(self, paper_id: int, data: dict) -> None:
        fields = self._clean(data)
        if not fields:
            return
        fields["updated_at"] = now()
        sets = ", ".join(f"{k} = ?" for k in fields)
        with self._write_lock, self.connect() as conn:
            conn.execute(f"UPDATE papers SET {sets} WHERE id = ?", [*fields.values(), paper_id])
            self._reindex(conn, paper_id)

    def set_pdf(self, paper_id: int, rel_path: str, page_texts: list[str]) -> None:
        with self._write_lock, self.connect() as conn:
            conn.execute("UPDATE papers SET pdf_path = ?, page_count = ?, updated_at = ? WHERE id = ?",
                         (rel_path, len(page_texts) or None, now(), paper_id))
            conn.execute("DELETE FROM page_texts WHERE paper_id = ?", (paper_id,))
            conn.executemany("INSERT INTO page_texts (paper_id, page, text) VALUES (?, ?, ?)",
                             [(paper_id, i + 1, t) for i, t in enumerate(page_texts)])
            self._reindex(conn, paper_id)

    def page_texts(self, paper_id: int) -> list[str]:
        with self.connect() as conn:
            return [r[0] for r in conn.execute(
                "SELECT text FROM page_texts WHERE paper_id = ? ORDER BY page", (paper_id,))]

    def touch_opened(self, paper_id: int) -> None:
        with self._write_lock, self.connect() as conn:
            conn.execute("UPDATE papers SET last_opened_at = ? WHERE id = ?", (now(), paper_id))

    def delete_paper(self, paper_id: int) -> str:
        with self._write_lock, self.connect() as conn:
            row = conn.execute("SELECT pdf_path FROM papers WHERE id = ?", (paper_id,)).fetchone()
            conn.execute("DELETE FROM papers WHERE id = ?", (paper_id,))
            conn.execute("DELETE FROM papers_fts WHERE rowid = ?", (paper_id,))
            return row[0] if row else ""

    def _reindex(self, conn, paper_id: int) -> None:
        row = conn.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
        if not row:
            return
        authors = " ".join(
            " ".join(filter(None, [a.get("given"), a.get("family"), a.get("literal")]))
            for a in json.loads(row["authors"] or "[]") if isinstance(a, dict)
        )
        keywords = " ".join(json.loads(row["keywords"] or "[]"))
        tags = " ".join(r[0] for r in conn.execute(
            "SELECT t.name FROM tags t JOIN paper_tags pt ON pt.tag_id = t.id WHERE pt.paper_id = ?",
            (paper_id,)))
        note = conn.execute("SELECT content FROM notes WHERE paper_id = ?", (paper_id,)).fetchone()
        comments = " ".join(r[0] + " " + r[1] for r in conn.execute(
            "SELECT text, comment FROM annotations WHERE paper_id = ?", (paper_id,)))
        fulltext = "\n".join(r[0] for r in conn.execute(
            "SELECT text FROM page_texts WHERE paper_id = ? ORDER BY page", (paper_id,)))
        conn.execute("DELETE FROM papers_fts WHERE rowid = ?", (paper_id,))
        conn.execute(
            "INSERT INTO papers_fts (rowid, title, authors, abstract, keywords, notes, fulltext) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (paper_id, row["title"], authors, row["abstract"], keywords + " " + tags,
             ((note[0] if note else "") + " " + comments).strip(), fulltext))

    def reindex(self, paper_id: int) -> None:
        with self._write_lock, self.connect() as conn:
            self._reindex(conn, paper_id)

    def list_papers(self, q: str = "", collection_id: int | None = None, tag_id: int | None = None,
                    status: str = "", starred: bool = False, sort: str = "added",
                    filter_: str = "", limit: int = 500, offset: int = 0) -> dict:
        where, params = [], []
        snippets: dict[int, str] = {}
        if collection_id is not None:
            where.append("p.id IN (SELECT paper_id FROM paper_collections WHERE collection_id = ?)")
            params.append(collection_id)
        if tag_id is not None:
            where.append("p.id IN (SELECT paper_id FROM paper_tags WHERE tag_id = ?)")
            params.append(tag_id)
        if status:
            where.append("p.status = ?")
            params.append(status)
        if starred:
            where.append("p.starred = 1")
        if filter_ == "unfiled":
            where.append("p.id NOT IN (SELECT paper_id FROM paper_collections)")
        elif filter_ == "no_pdf":
            where.append("p.pdf_path = ''")
        elif filter_ == "recent":
            where.append("p.last_opened_at IS NOT NULL")
        with self.connect() as conn:
            if q.strip():
                ids = self._search_ids(conn, q, snippets)
                if not ids:
                    return {"items": [], "total": 0}
                where.append(f"p.id IN ({','.join('?' * len(ids))})")
                params.extend(ids)
            clause = ("WHERE " + " AND ".join(where)) if where else ""
            order = SORTS.get(sort, SORTS["added"])
            total = conn.execute(f"SELECT COUNT(*) FROM papers p {clause}", params).fetchone()[0]
            rows = conn.execute(f"SELECT p.* FROM papers p {clause} ORDER BY {order} LIMIT ? OFFSET ?",
                                [*params, limit, offset]).fetchall()
            items = [self._row_to_paper(conn, r) for r in rows]
        for it in items:
            if it["id"] in snippets:
                it["snippet"] = snippets[it["id"]]
        return {"items": items, "total": total}

    def _search_ids(self, conn, q: str, snippets: dict) -> list[int]:
        terms = [t for t in re.split(r"\s+", q.strip()) if t]
        long_terms = [t for t in terms if len(t) >= 3]
        short_terms = [t for t in terms if len(t) < 3]
        ids: set[int] | None = None
        if long_terms:
            match = " AND ".join('"' + t.replace('"', '""') + '"' for t in long_terms)
            rows = conn.execute(
                "SELECT rowid, snippet(papers_fts, 5, '[[', ']]', '…', 16) FROM papers_fts "
                "WHERE papers_fts MATCH ? ORDER BY rank LIMIT 1000", (match,)).fetchall()
            ids = set()
            for rid, snip in rows:
                ids.add(rid)
                if snip and "[[" in snip:
                    snippets[rid] = snip
        for t in short_terms:
            # trigram 색인은 3글자 이상만 쓰므로 짧은 검색어(예: 한국어 2글자)는 LIKE로 찾는다
            like = "%" + t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            found = {r[0] for r in conn.execute(
                "SELECT rowid FROM papers_fts WHERE title LIKE ?1 ESCAPE '\\' OR authors LIKE ?1 ESCAPE '\\' "
                "OR abstract LIKE ?1 ESCAPE '\\' OR keywords LIKE ?1 ESCAPE '\\' OR notes LIKE ?1 ESCAPE '\\' "
                "OR fulltext LIKE ?1 ESCAPE '\\'", (like,))}
            ids = found if ids is None else ids & found
        return sorted(ids or [])

    def stats(self) -> dict:
        with self.connect() as conn:
            one = lambda sql: conn.execute(sql).fetchone()[0]  # noqa: E731
            return {
                "total": one("SELECT COUNT(*) FROM papers"),
                "unread": one("SELECT COUNT(*) FROM papers WHERE status = 'unread'"),
                "reading": one("SELECT COUNT(*) FROM papers WHERE status = 'reading'"),
                "done": one("SELECT COUNT(*) FROM papers WHERE status = 'done'"),
                "starred": one("SELECT COUNT(*) FROM papers WHERE starred = 1"),
                "with_pdf": one("SELECT COUNT(*) FROM papers WHERE pdf_path != ''"),
                "unfiled": one("SELECT COUNT(*) FROM papers WHERE id NOT IN "
                               "(SELECT paper_id FROM paper_collections)"),
                "annotations": one("SELECT COUNT(*) FROM annotations"),
                "summaries": one("SELECT COUNT(*) FROM ai_summaries"),
            }

    # ------------------------------------------------------------- collections
    def list_collections(self) -> list[dict]:
        with self.connect() as conn:
            return [dict(r) for r in conn.execute(
                "SELECT c.id, c.name, c.parent_id, "
                "(SELECT COUNT(*) FROM paper_collections pc WHERE pc.collection_id = c.id) AS count "
                "FROM collections c ORDER BY c.name COLLATE NOCASE")]

    def add_collection(self, name: str, parent_id: int | None = None) -> int:
        with self._write_lock, self.connect() as conn:
            return conn.execute("INSERT INTO collections (name, parent_id, created_at) VALUES (?, ?, ?)",
                                (name, parent_id, now())).lastrowid

    def update_collection(self, cid: int, name: str | None = None, parent_id=...) -> None:
        with self._write_lock, self.connect() as conn:
            if name is not None:
                conn.execute("UPDATE collections SET name = ? WHERE id = ?", (name, cid))
            if parent_id is not ...:
                if parent_id is not None and self._is_descendant(conn, parent_id, cid):
                    raise ValueError("컬렉션을 자기 하위로 옮길 수 없어요")
                conn.execute("UPDATE collections SET parent_id = ? WHERE id = ?", (parent_id, cid))

    def _is_descendant(self, conn, node: int, ancestor: int) -> bool:
        while node is not None:
            if node == ancestor:
                return True
            row = conn.execute("SELECT parent_id FROM collections WHERE id = ?", (node,)).fetchone()
            node = row[0] if row else None
        return False

    def delete_collection(self, cid: int) -> None:
        with self._write_lock, self.connect() as conn:
            conn.execute("DELETE FROM collections WHERE id = ?", (cid,))

    def set_paper_collections(self, paper_ids: Iterable[int], collection_id: int, add: bool) -> None:
        with self._write_lock, self.connect() as conn:
            for pid in paper_ids:
                if add:
                    conn.execute("INSERT OR IGNORE INTO paper_collections VALUES (?, ?)", (pid, collection_id))
                else:
                    conn.execute("DELETE FROM paper_collections WHERE paper_id = ? AND collection_id = ?",
                                 (pid, collection_id))

    # -------------------------------------------------------------------- tags
    def list_tags(self) -> list[dict]:
        with self.connect() as conn:
            return [dict(r) for r in conn.execute(
                "SELECT t.id, t.name, t.color, "
                "(SELECT COUNT(*) FROM paper_tags pt WHERE pt.tag_id = t.id) AS count "
                "FROM tags t ORDER BY t.name COLLATE NOCASE")]

    def ensure_tag(self, conn, name: str) -> int:
        row = conn.execute("SELECT id FROM tags WHERE name = ?", (name,)).fetchone()
        if row:
            return row[0]
        return conn.execute("INSERT INTO tags (name) VALUES (?)", (name,)).lastrowid

    def set_paper_tags(self, paper_id: int, names: list[str]) -> None:
        names = list(dict.fromkeys(n.strip() for n in names if n and n.strip()))
        with self._write_lock, self.connect() as conn:
            conn.execute("DELETE FROM paper_tags WHERE paper_id = ?", (paper_id,))
            for name in names:
                conn.execute("INSERT OR IGNORE INTO paper_tags VALUES (?, ?)",
                             (paper_id, self.ensure_tag(conn, name)))
            conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM paper_tags) AND color = ''")
            self._reindex(conn, paper_id)

    def add_tag_to_papers(self, paper_ids: Iterable[int], name: str) -> None:
        with self._write_lock, self.connect() as conn:
            tid = self.ensure_tag(conn, name.strip())
            for pid in paper_ids:
                conn.execute("INSERT OR IGNORE INTO paper_tags VALUES (?, ?)", (pid, tid))
                self._reindex(conn, pid)

    def update_tag(self, tag_id: int, name: str | None = None, color: str | None = None) -> None:
        with self._write_lock, self.connect() as conn:
            if name and name.strip():
                conn.execute("UPDATE tags SET name = ? WHERE id = ?", (name.strip(), tag_id))
                for (pid,) in conn.execute("SELECT paper_id FROM paper_tags WHERE tag_id = ?", (tag_id,)).fetchall():
                    self._reindex(conn, pid)
            if color is not None:
                conn.execute("UPDATE tags SET color = ? WHERE id = ?", (color, tag_id))

    def delete_tag(self, tag_id: int) -> None:
        with self._write_lock, self.connect() as conn:
            pids = [r[0] for r in conn.execute("SELECT paper_id FROM paper_tags WHERE tag_id = ?", (tag_id,))]
            conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
            for pid in pids:
                self._reindex(conn, pid)

    # ------------------------------------------------------- annotations/notes
    def list_annotations(self, paper_id: int) -> list[dict]:
        with self.connect() as conn:
            out = []
            for r in conn.execute("SELECT * FROM annotations WHERE paper_id = ? ORDER BY page, id", (paper_id,)):
                a = dict(r)
                a["rects"] = json.loads(a["rects"] or "[]")
                out.append(a)
            return out

    def add_annotation(self, paper_id: int, data: dict) -> int:
        ts = now()
        with self._write_lock, self.connect() as conn:
            aid = conn.execute(
                "INSERT INTO annotations (paper_id, page, kind, color, text, comment, rects, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (paper_id, int(data.get("page") or 1), data.get("kind") or "highlight",
                 data.get("color") or "yellow", data.get("text") or "", data.get("comment") or "",
                 json.dumps(data.get("rects") or []), ts, ts)).lastrowid
            self._reindex(conn, paper_id)
            return aid

    def update_annotation(self, annotation_id: int, data: dict) -> dict | None:
        with self._write_lock, self.connect() as conn:
            row = conn.execute("SELECT paper_id FROM annotations WHERE id = ?", (annotation_id,)).fetchone()
            if not row:
                return None
            for key in ("color", "comment", "kind"):
                if key in data and data[key] is not None:
                    conn.execute(f"UPDATE annotations SET {key} = ?, updated_at = ? WHERE id = ?",
                                 (data[key], now(), annotation_id))
            self._reindex(conn, row[0])
            r = conn.execute("SELECT * FROM annotations WHERE id = ?", (annotation_id,)).fetchone()
            a = dict(r)
            a["rects"] = json.loads(a["rects"])
            return a

    def delete_annotation(self, annotation_id: int) -> None:
        with self._write_lock, self.connect() as conn:
            row = conn.execute("SELECT paper_id FROM annotations WHERE id = ?", (annotation_id,)).fetchone()
            conn.execute("DELETE FROM annotations WHERE id = ?", (annotation_id,))
            if row:
                self._reindex(conn, row[0])

    def save_note(self, paper_id: int, content: str) -> None:
        with self._write_lock, self.connect() as conn:
            conn.execute("INSERT INTO notes (paper_id, content, updated_at) VALUES (?, ?, ?) "
                         "ON CONFLICT(paper_id) DO UPDATE SET content = excluded.content, "
                         "updated_at = excluded.updated_at", (paper_id, content, now()))
            self._reindex(conn, paper_id)

    # --------------------------------------------------------------------- AI
    def get_summary(self, paper_id: int) -> dict | None:
        with self.connect() as conn:
            row = conn.execute("SELECT data, model, created_at FROM ai_summaries WHERE paper_id = ?",
                               (paper_id,)).fetchone()
            if not row:
                return None
            return {"data": json.loads(row[0]), "model": row[1], "created_at": row[2]}

    def save_summary(self, paper_id: int, data: dict, model: str) -> None:
        with self._write_lock, self.connect() as conn:
            conn.execute("INSERT OR REPLACE INTO ai_summaries (paper_id, data, model, created_at) "
                         "VALUES (?, ?, ?, ?)", (paper_id, json.dumps(data, ensure_ascii=False), model, now()))

    def chat_history(self, paper_id: int) -> list[dict]:
        with self.connect() as conn:
            out = []
            for r in conn.execute("SELECT * FROM chat_messages WHERE paper_id = ? ORDER BY id", (paper_id,)):
                m = dict(r)
                m["citations"] = json.loads(m["citations"] or "[]")
                out.append(m)
            return out

    def add_chat_message(self, paper_id: int, role: str, content: str, citations: list | None = None) -> int:
        with self._write_lock, self.connect() as conn:
            return conn.execute(
                "INSERT INTO chat_messages (paper_id, role, content, citations, created_at) VALUES (?, ?, ?, ?, ?)",
                (paper_id, role, content, json.dumps(citations or [], ensure_ascii=False), now())).lastrowid

    def clear_chat(self, paper_id: int) -> None:
        with self._write_lock, self.connect() as conn:
            conn.execute("DELETE FROM chat_messages WHERE paper_id = ?", (paper_id,))
