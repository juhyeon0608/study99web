"""원고 공유 링크 · 의견 (2026-10-27 사용자 요청 — 지도교수님께 원고를 링크로 보여 주고 문장에 의견 받기).

- 주인(로그인): /api/manuscripts/{mid}/shares (목록 · 만들기) · /api/shares/{id} (끊기) ·
  /api/manuscripts/{mid}/comments (받은 의견) · /api/comments/{id} (해결 · 지우기) — 사용자 트랜잭션(RLS)
- 공개(로그인 없음): /s/{토큰} 페이지 · /api/public/share/{토큰} (원고 · 의견) · …/comments (의견 쓰기) · …/figures/{이름}
  — 토큰 sha256으로 system_tx("share link")에서 그 링크 한 줄만 찾는다(기기 연결 코드와 같은 방식). 원고는 읽기만
"""
from __future__ import annotations

import hashlib
import re
import secrets
import threading
import time
from types import SimpleNamespace

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response

from . import figures
from .storage import NotFound, StorageKeyError, UserStorage

MAX_SHARES = 20          # 원고 하나에 살아 있는 링크
MAX_COMMENTS = 500       # 링크 하나에 받는 의견
RATE_N, RATE_S = 20, 600  # 링크 하나에 10분마다 의견 20개
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
CITE_RE = re.compile(r"\[@([^\]\n]+)\]")
KEY_RE = re.compile(r"@([\w:.#$%&\-+?<>~/가-힣]+)")
GONE = "링크가 없거나 끊겼어요. 원고를 보낸 분께 새 링크를 받아 주세요"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _clean(v, n: int) -> str:
    return re.sub(r"[\x00-\x1f\x7f]", " ", str(v or "")).strip()[:n]


def cite_label(paper: dict) -> str:
    """공개 페이지의 인용 표시 '김철수 외, 2020' (서식 없는 저자-연도)"""
    authors = paper.get("authors") or []
    first = authors[0] if authors and isinstance(authors[0], dict) else {}
    name = first.get("family") or first.get("literal") or first.get("name") or (paper.get("title") or "")[:20]
    ko = bool(re.search(r"[가-힣]", name))
    more = (" 외" if ko else " et al.") if len(authors) > 2 else (f" · {authors[1].get('family', '')}" if len(authors) == 2
                                                                 and isinstance(authors[1], dict) else "")
    return f"{name}{more}, {paper.get('year') or 'n.d.'}"


class Limiter:
    def __init__(self):
        self.hits: dict[str, list[float]] = {}
        self.lock = threading.Lock()

    def ok(self, key: str) -> bool:
        now = time.time()
        with self.lock:
            xs = [t for t in self.hits.get(key, []) if now - t < RATE_S]
            if len(xs) >= RATE_N:
                self.hits[key] = xs
                return False
            xs.append(now)
            self.hits[key] = xs
            return True


def _share_view(r: dict) -> dict:
    return {"id": r["id"], "label": r["label"], "allow_comments": r["allow_comments"],
            "expires_at": r["expires_at"].isoformat() if r.get("expires_at") else None,
            "revoked": r["revoked_at"] is not None, "created_at": r["created_at"].isoformat(),
            "last_viewed_at": r["last_viewed_at"].isoformat() if r.get("last_viewed_at") else None,
            "comments": r.get("comments", 0), "open_comments": r.get("open_comments", 0)}


def _comment_view(r: dict) -> dict:
    return {"id": r["id"], "share_id": r["share_id"], "share_label": r.get("label", ""), "author": r["author"],
            "quote": r["quote"], "body": r["body"], "resolved": r["resolved_at"] is not None,
            "created_at": r["created_at"].isoformat()}


def register(app: FastAPI, Ctx, H: SimpleNamespace) -> None:
    """H: need_manuscript(ctx, mid) · db(Database) · storage(원본 저장소) · page(공개 페이지 파일 경로)"""
    limiter = Limiter()

    # ------------------------------------------------------------ 주인
    @app.get("/api/manuscripts/{mid}/shares")
    def shares_list(mid: int, ctx=Ctx):
        H.need_manuscript(ctx, mid)
        rows = ctx.lib._all(
            "select s.*, (select count(*) from paperlab.share_comments c where c.share_id = s.id)::int as comments, "
            "(select count(*) from paperlab.share_comments c where c.share_id = s.id and c.resolved_at is null)::int as open_comments "
            "from paperlab.manuscript_shares s where s.user_id = %s and s.manuscript_id = %s order by s.created_at desc",
            (ctx.uid, mid))
        return {"items": [_share_view(r) for r in rows]}

    @app.post("/api/manuscripts/{mid}/shares")
    def shares_add(mid: int, data: dict = Body(default={}), ctx=Ctx):
        """{label?, allow_comments?: true, days?: 7 | 30 | 90 | null(끊을 때까지)} → {share, token} (토큰은 이때만)"""
        H.need_manuscript(ctx, mid)
        days = data.get("days")
        if days not in (None, 7, 30, 90):
            raise HTTPException(400, "기간은 7 · 30 · 90일 또는 끊을 때까지예요")
        live = ctx.lib._one("select count(*)::int as n from paperlab.manuscript_shares where user_id = %s and manuscript_id = %s "
                            "and revoked_at is null and (expires_at is null or expires_at > now())", (ctx.uid, mid))["n"]
        if live >= MAX_SHARES:
            raise HTTPException(400, f"살아 있는 링크는 {MAX_SHARES}개까지예요. 쓰지 않는 링크를 끊어 주세요")
        token = secrets.token_urlsafe(24)
        row = ctx.lib._one(
            "insert into paperlab.manuscript_shares (user_id, manuscript_id, token_hash, label, allow_comments, expires_at) "
            "values (%s, %s, %s, %s, %s, case when %s::int is null then null else now() + make_interval(days => %s::int) end) "
            "returning *", (ctx.uid, mid, token_hash(token), _clean(data.get("label"), 60), data.get("allow_comments") is not False,
                            days, days))
        return JSONResponse({"share": _share_view(row), "token": token}, status_code=201)

    @app.delete("/api/shares/{sid}")
    def shares_revoke(sid: int, ctx=Ctx):
        n = ctx.lib._x("update paperlab.manuscript_shares set revoked_at = now() where id = %s and user_id = %s "
                       "and revoked_at is null", (sid, ctx.uid)).rowcount
        if not n:
            raise HTTPException(404, "링크를 찾을 수 없어요")
        return {"ok": True}

    @app.get("/api/manuscripts/{mid}/comments")
    def comments_list(mid: int, ctx=Ctx):
        H.need_manuscript(ctx, mid)
        rows = ctx.lib._all("select c.*, s.label from paperlab.share_comments c join paperlab.manuscript_shares s on s.id = c.share_id "
                            "where c.user_id = %s and c.manuscript_id = %s order by c.created_at desc limit 1000", (ctx.uid, mid))
        return {"items": [_comment_view(r) for r in rows], "open": sum(1 for r in rows if r["resolved_at"] is None)}

    @app.patch("/api/comments/{cid}")
    def comments_patch(cid: int, data: dict = Body(...), ctx=Ctx):
        if not isinstance(data.get("resolved"), bool):
            raise HTTPException(400, "resolved는 참 · 거짓이에요")
        n = ctx.lib._x("update paperlab.share_comments set resolved_at = case when %s then now() else null end "
                       "where id = %s and user_id = %s", (data["resolved"], cid, ctx.uid)).rowcount
        if not n:
            raise HTTPException(404, "의견을 찾을 수 없어요")
        return {"ok": True}

    @app.delete("/api/comments/{cid}")
    def comments_delete(cid: int, ctx=Ctx):
        n = ctx.lib._x("delete from paperlab.share_comments where id = %s and user_id = %s", (cid, ctx.uid)).rowcount
        if not n:
            raise HTTPException(404, "의견을 찾을 수 없어요")
        return {"ok": True}

    # ------------------------------------------------------------ 공개 (로그인 없음)
    def check(token: str) -> None:  # 토큰 모양은 DB 연결 전에
        if not TOKEN_RE.fullmatch(token or ""):
            raise HTTPException(404, GONE)

    def find(conn, token: str) -> dict:
        r = conn.execute("select * from paperlab.manuscript_shares where token_hash = %s and revoked_at is null "
                         "and (expires_at is null or expires_at > now())", (token_hash(token),)).fetchone()
        if not r:
            raise HTTPException(404, GONE)
        return r

    no_store = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer"}

    @app.get("/s/{token}")
    def share_page(token: str):
        return FileResponse(H.page, headers=no_store)

    @app.get("/api/public/share/{token}")
    def public_share(token: str):
        check(token)
        with H.db.system_tx("share link read") as conn:
            s = find(conn, token)
            m = conn.execute("select title, content from paperlab.manuscripts where id = %s and user_id = %s",
                             (s["manuscript_id"], s["user_id"])).fetchone()
            if not m:
                raise HTTPException(404, GONE)
            content = m["content"] or ""
            keys = sorted({k for raw in CITE_RE.findall(content) for k in KEY_RE.findall("@" + raw)})[:2000]
            papers = conn.execute("select citekey, title, authors, year from paperlab.papers where user_id = %s and citekey = any(%s)",
                                  (s["user_id"], keys)).fetchall() if keys else []
            comments = conn.execute("select * from paperlab.share_comments where share_id = %s order by created_at",
                                    (s["id"],)).fetchall()
            conn.execute("update paperlab.manuscript_shares set last_viewed_at = now() where id = %s", (s["id"],))
        body = {"title": m["title"] or "원고", "content": content, "cites": {p["citekey"]: cite_label(p) for p in papers},
                "allow_comments": s["allow_comments"], "label": s["label"],
                "comments": [{k: v for k, v in _comment_view(c).items() if k not in ("share_id", "share_label")} for c in comments]}
        return JSONResponse(body, headers=no_store)

    @app.post("/api/public/share/{token}/comments")
    def public_comment(token: str, data: dict = Body(...)):
        check(token)
        author = _clean(data.get("author"), 40)
        body = str(data.get("body") or "").replace("\x00", "").strip()[:4000]
        quote = _clean(data.get("quote"), 500)
        if not author or not body:
            raise HTTPException(400, "이름과 의견을 적어 주세요")
        if not limiter.ok(token_hash(token or "")):
            raise HTTPException(429, "의견을 너무 빨리 보내고 있어요. 잠시 뒤 다시 보내 주세요")
        with H.db.system_tx("share comment") as conn:
            s = find(conn, token)
            if not s["allow_comments"]:
                raise HTTPException(403, "이 링크는 읽기만 할 수 있어요")
            n = conn.execute("select count(*)::int as n from paperlab.share_comments where share_id = %s", (s["id"],)).fetchone()["n"]
            if n >= MAX_COMMENTS:
                raise HTTPException(400, "이 링크에 남길 수 있는 의견 수를 넘었어요")
            r = conn.execute("insert into paperlab.share_comments (user_id, share_id, manuscript_id, author, quote, body) "
                             "values (%s, %s, %s, %s, %s, %s) returning *",
                             (s["user_id"], s["id"], s["manuscript_id"], author, quote, body)).fetchone()
        v = _comment_view(r)
        return JSONResponse({k: x for k, x in v.items() if k not in ("share_id", "share_label")}, status_code=201, headers=no_store)

    @app.get("/api/public/share/{token}/figures/{name}")
    def public_figure(token: str, name: str):
        check(token)
        if not figures.NAME_RE.fullmatch(name or ""):
            raise HTTPException(404, "그림을 찾을 수 없어요")
        with H.db.system_tx("share figure") as conn:
            s = find(conn, token)
        us = UserStorage(H.storage, str(s["user_id"]))
        try:
            data = us.get(us.figure_key(s["manuscript_id"], name))
        except (NotFound, StorageKeyError):
            raise HTTPException(404, "그림을 찾을 수 없어요") from None
        kind = figures.sniff(data)
        if kind is None:
            raise HTTPException(404, "그림을 찾을 수 없어요")
        return Response(data, media_type=figures.CONTENT_TYPES[kind], headers={**no_store, "Content-Disposition": "inline"})

