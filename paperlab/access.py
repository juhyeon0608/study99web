"""관리자 승인 가입 (2026-10-29 사용자 요청): `PAPERLAB_ALLOWLIST=approval`.

- 누구나 Google로 로그인할 수 있다(Google OAuth 앱은 '프로덕션' 게시). 처음 API를 부른 계정은 access_requests에 'pending'.
- 승인되지 않은 계정의 API 요청은 403 — code `pending_approval`(승인 대기) · `access_rejected`(거절). 화면은 대기 · 거절 화면.
- 관리자 = `PAPERLAB_ADMIN_EMAILS`(쉼표 구분). 관리자는 처음 로그인할 때 바로 승인. 앱의 계정 메뉴 [가입 신청]에서
  /api/admin/access 목록을 보고 승인 · 거절 · 되돌리기.
- 상태는 서버 메모리에 잠깐(승인 60초 · 그 밖 5초) 기억 — 요청마다 DB를 부르지 않게. 관리자가 바꾸면 바로 잊는다.
"""
from __future__ import annotations

import threading
import time
from types import SimpleNamespace

from fastapi import Body, FastAPI, HTTPException

STATUSES = ("pending", "approved", "rejected")
PENDING = {"detail": "가입 신청을 받았어요. 관리자가 승인하면 쓸 수 있어요.", "code": "pending_approval"}
REJECTED = {"detail": "이 계정은 PaperLab을 쓸 수 없어요. 관리자에게 문의해 주세요.", "code": "access_rejected"}
TTL_OK, TTL_WAIT = 60.0, 5.0


def _name(claims: dict) -> str:
    meta = claims.get("user_metadata") or {}
    return str(meta.get("full_name") or meta.get("name") or "")[:200]


class AccessGate:
    def __init__(self, db, admins, clock=time.monotonic):
        self.db = db
        self.admins = frozenset(e.strip().lower() for e in admins if e and e.strip())
        self.clock = clock
        self._cache: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    def is_admin(self, claims: dict) -> bool:
        return str(claims.get("email") or "").strip().lower() in self.admins

    def forget(self, user_id: str) -> None:
        with self._lock:
            self._cache.pop(str(user_id), None)

    def status(self, claims: dict) -> str:
        """이 계정의 상태 (없으면 'pending'으로 신청을 남김, 관리자는 바로 승인)"""
        uid = str(claims["sub"])
        now = self.clock()
        with self._lock:
            hit = self._cache.get(uid)
        if hit and now - hit[1] < (TTL_OK if hit[0] == "approved" else TTL_WAIT):
            return hit[0]
        email = str(claims.get("email") or "").strip().lower()[:320]
        admin = email in self.admins
        with self.db.system_tx("access check") as conn:
            r = conn.execute("select status from paperlab.access_requests where user_id = %s", (uid,)).fetchone()
            if r is None:
                r = conn.execute(
                    "insert into paperlab.access_requests (user_id, email, name, status, decided_at, decided_by) "
                    "values (%s, %s, %s, %s, case when %s then now() end, case when %s then 'admin' else '' end) "
                    "on conflict (user_id) do update set email = excluded.email returning status",
                    (uid, email, _name(claims), "approved" if admin else "pending", admin, admin)).fetchone()
            elif admin and r["status"] != "approved":  # 관리자 목록에 넣은 계정은 늘 승인
                r = conn.execute("update paperlab.access_requests set status = 'approved', decided_at = now(), decided_by = 'admin' "
                                 "where user_id = %s returning status", (uid,)).fetchone()
        st = r["status"]
        with self._lock:
            self._cache[uid] = (st, now)
        return st


def _view(r: dict) -> dict:
    return {"user_id": str(r["user_id"]), "email": r["email"], "name": r["name"], "status": r["status"],
            "requested_at": r["requested_at"].isoformat(),
            "decided_at": r["decided_at"].isoformat() if r.get("decided_at") else None, "decided_by": r["decided_by"]}


def register(app: FastAPI, Ctx, H: SimpleNamespace) -> None:
    """H: gate(AccessGate) · db(Database) · enabled(승인 방식을 쓰는지)"""

    def need_admin(ctx) -> str:
        if not H.gate.is_admin(ctx.claims):
            raise HTTPException(403, "관리자만 볼 수 있어요")
        return str(ctx.claims.get("email") or "").strip().lower()

    @app.get("/api/admin/access")
    def access_list(ctx=Ctx):
        need_admin(ctx)
        with H.db.system_tx("access list") as conn:
            rows = conn.execute("select * from paperlab.access_requests order by case status when 'pending' then 0 "
                                "when 'approved' then 1 else 2 end, requested_at desc limit 1000").fetchall()
        items = [_view(r) for r in rows]
        return {"enabled": H.enabled, "items": items, "pending": sum(1 for x in items if x["status"] == "pending")}

    @app.post("/api/admin/access/{user_id}")
    def access_set(user_id: str, data: dict = Body(...), ctx=Ctx):
        me = need_admin(ctx)
        status = data.get("status")
        if status not in STATUSES:
            raise HTTPException(400, "상태는 승인 대기 · 승인 · 거절 중 하나예요")
        if user_id == str(ctx.claims.get("sub")) and status != "approved":
            raise HTTPException(400, "내 계정은 거절할 수 없어요")
        with H.db.system_tx("access decide") as conn:
            r = conn.execute("update paperlab.access_requests set status = %s, decided_at = now(), decided_by = %s "
                             "where user_id::text = %s returning *", (status, me, user_id)).fetchone()
        if not r:
            raise HTTPException(404, "신청을 찾을 수 없어요")
        H.gate.forget(user_id)
        return _view(r)
