"""6단계 폴더 양방향 동기화 — 워커 API `/api/worker/sync/*` (docs/specs/phase6-folder-sync.md 6 · 10 · 11 · 14장).

- 인증은 2단계 기기 토큰(`pld1.…`) 그대로: 그 사용자 `actor_claims` 트랜잭션(RLS force — service role 없음). JWT는 받지 않는다.
- 변경 피드(K-38): `papers` · `folders` · `sync_tombstones`의 `(sync_xid, sync_rev)`를 트리거가 쓰고, 피드는
  **같은 SQL 문 안에서** `sync_xid < pg_snapshot_xmin(pg_current_snapshot())`인 행만(앞선 트랜잭션이 모두 끝난 것) 그 순서로.
  커서 = 불투명 문자열 "<xid>:<rev>".
- 휴지통 · 해시 읽기는 `Library.trash_tx()` 안에서만(K-39). PDF 바이트는 R2 서명 주소로만 오간다(K-11 — 서버는 주소 발급만).
- 로그에는 id · 종류 · 결과 코드 · 개수만(파일 이름 · 경로 · 해시 · 서명 주소 · 토큰 없음 — 12.6절).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import threading
import time
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb
from starlette.concurrency import run_in_threadpool

from . import jobs, pdf
from .auth import NotAllowed, bearer_token
from .db import (DBUnavailable, actor_claims, copy_name, deleted_by_label, file_name_problem, folder_name_problem, iso,
                 kst_day, now_dt)
from .storage import MAX_PDF_BYTES, is_upload_id
from .worker_api import DEVICE_AUTH, DEVICE_REVOKED

log = logging.getLogger("paperlab.sync")

MIN_SYNC_VERSION = "0.3.0"   # K-29 — 동기화 전용 최소 앱 버전(워커 hello · claim 기준은 그대로)
BODY_MAX = 256 * 1024
MAX_OPS, LOOKUP_MAX, DOWNLOAD_MAX, SLOTS_MAX = 20, 200, 20, 10
SNAPSHOT_MAX, CHANGES_MAX = 2000, 500
POLL_IDLE_S, POLL_ACTIVE_S, RECENT_CHANGE_S = 60, 10, 120   # K-19
STATUS_EVERY_S = 50
XMIN_STALL_S, XMIN_WARN_EVERY_S = 300, 3600   # K-38 정체 감지 (가정 5분 · 반복 WARN 1시간에 한 번)
FUTURE_SLACK, TIE = timedelta(minutes=5), timedelta(seconds=2)   # 10.1절 "나중" 판단
EPOCH_FLOOR = datetime(2000, 1, 1, tzinfo=timezone.utc)
CONFLICT_TAG = "충돌 사본"
STATES = ("off", "scanning", "preview", "syncing", "idle", "paused", "waiting_confirm", "root_missing", "offline",
          "storage_full", "update_required", "account_mismatch", "revoked")
COUNT_KEYS = ("files", "pending_up", "pending_down", "waiting_confirm", "problems")
REASONS = ("storage", "sync_quota", "db")
SHA_RE = re.compile(r"[0-9a-f]{64}")
CURSOR_RE = re.compile(r"(0|[1-9][0-9]{0,19}):(0|[1-9][0-9]{0,18})")
KINDS = ("folder", "paper", "trashed", "tombstone")


class SyncError(Exception):
    def __init__(self, status: int, code: str, detail: str, **extra):
        super().__init__(code)
        self.status, self.code, self.detail, self.extra = status, code, detail, extra


class SyncState:
    """서버 프로세스 메모리: 사용자당 files/add 동시 1(K-24), 최근 변경 시각(폴링 간격), 피드 xmin 정체 감지(K-38)"""

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.adding: set[str] = set()
        self.changed: dict[str, float] = {}
        self.xmin: tuple[str, float] | None = None
        self.warned_at = -1e18
        self.stall_s = XMIN_STALL_S
        self._lock = threading.Lock()

    def try_add(self, uid: str) -> bool:
        with self._lock:
            if uid in self.adding:
                return False
            self.adding.add(uid)
            return True

    def done_add(self, uid: str) -> None:
        with self._lock:
            self.adding.discard(uid)

    def watch_xmin(self, xmin: str, held: int) -> None:
        """같은 xmin이 stall_s 넘게 이어지고 그 뒤에 밀린 변경이 있으면 WARN(숫자만 — 1시간에 한 번까지)"""
        now = self.clock()
        with self._lock:
            if self.xmin is None or self.xmin[0] != xmin:
                self.xmin = (xmin, now)
                return
            age = now - self.xmin[1]
            if held and age >= self.stall_s and now - self.warned_at >= XMIN_WARN_EVERY_S:
                self.warned_at = now
                log.warning("sync feed xmin stalled xmin=%s age_s=%d held=%d", xmin, int(age), held)


# ====================================================================== 작은 도우미
def _int(v, lo: int = 0) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) and lo <= v < 2 ** 63 else None


def _sha(v) -> str:
    v = str(v or "").lower()
    if not SHA_RE.fullmatch(v):
        raise SyncError(400, "bad_request", "sha256 형식이 올바르지 않아요")
    return v


def _op_id(body: dict) -> str:
    try:
        return str(uuid.UUID(str(body.get("op_id") or "")))
    except ValueError:
        raise SyncError(400, "bad_request", "op_id(uuid)가 필요해요") from None


def _file_name(v) -> str:
    name = unicodedata.normalize("NFC", str(v or ""))
    if file_name_problem(name):
        raise SyncError(400, "bad_name", file_name_problem(name))
    return name


def _ms_time(mtime_ms, offset_ms) -> datetime | None:
    """PC 수정 시각 + 시계 차이 → 서버 시계 기준 시각. 믿을 수 없으면 None(→ 도착 순서, 10.1절)"""
    m, o = mtime_ms, offset_ms
    if isinstance(m, bool) or isinstance(o, bool) or not isinstance(m, (int, float)) or not isinstance(o, (int, float)):
        return None
    try:
        at = datetime.fromtimestamp((m + o) / 1000, timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    if at < EPOCH_FLOOR or at > datetime.now(timezone.utc) + FUTURE_SLACK:
        return None
    return at


def paper_out(r: dict) -> dict:
    return {"id": r["id"], "folder_id": r["folder_id"], "file_name": r["file_name"], "sha256": r["pdf_sha256"],
            "size": r["pdf_size"], "content_at": iso(r.get("content_at"))}


_PAPER_COLS = ("p.id, p.folder_id, p.file_name, p.pdf_sha256, p.pdf_size, p.pdf_key, p.content_at, p.content_device_id, "
               "p.deleted_at, p.title")


def _paper(lib, pid: int, lock: bool = False) -> dict | None:
    """휴지통 포함 그 논문(동기화 판정용) — trash_tx 안에서 부른다"""
    return lib._one(f"select {_PAPER_COLS}, d.name as device_name from paperlab.papers p left join paperlab.devices d "
                    "on d.id = p.content_device_id and d.user_id = p.user_id where p.id = %s and p.user_id = %s"
                    + (" for update of p" if lock else ""), (pid, lib.uid))


def _by_sha(lib, sha: str) -> dict | None:
    """그 해시의 논문 — 살아 있는 것 먼저, 같으면 가장 작은 id (7.2절 4번)"""
    with lib.trash_tx():
        return lib._one(f"select {_PAPER_COLS} from paperlab.papers p where p.user_id = %s and p.pdf_sha256 = %s "
                        "and p.pdf_key <> '' order by (p.deleted_at is not null), p.id limit 1", (lib.uid, sha))


def _view(lib, pid: int) -> dict:
    with lib.trash_tx():
        return paper_out(_paper(lib, pid))


# ====================================================================== 피드 (6.2절 · K-38)
_FEED = """
select * from (
  (select 'folder' as kind, f.id, f.sync_xid::text as x, f.sync_rev as r, f.name, f.parent_id,
          null::bigint as folder_id, null::text as file_name, null::text as sha, null::bigint as size,
          null::timestamptz as content_at, null::timestamptz as deleted_at, null::text as deleted_by,
          null::text as device_name, null::text as tomb_kind
     from paperlab.folders f
    where f.user_id = %(u)s and (f.sync_xid, f.sync_rev) > (%(cx)s::xid8, %(cr)s::bigint)
      and f.sync_xid < pg_snapshot_xmin(pg_current_snapshot())
    order by f.sync_xid, f.sync_rev limit %(lim)s)
  union all
  (select 'paper', p.id, p.sync_xid::text, p.sync_rev, null, null, p.folder_id, p.file_name, p.pdf_sha256, p.pdf_size,
          p.content_at, p.deleted_at, p.deleted_by, d.name, null
     from paperlab.papers p
     left join paperlab.devices d on p.deleted_by = 'device:' || d.id::text and d.user_id = p.user_id
    where p.user_id = %(u)s and (p.sync_xid, p.sync_rev) > (%(cx)s::xid8, %(cr)s::bigint)
      and p.sync_xid < pg_snapshot_xmin(pg_current_snapshot()) and p.pdf_key <> ''
    order by p.sync_xid, p.sync_rev limit %(lim)s)
  union all
  (select 'tombstone', t.entity_id, t.sync_xid::text, t.sync_rev, null, null, null, null, null, null, null, null, null,
          null, t.kind
     from paperlab.sync_tombstones t
    where t.user_id = %(u)s and (t.sync_xid, t.sync_rev) > (%(cx)s::xid8, %(cr)s::bigint)
      and t.sync_xid < pg_snapshot_xmin(pg_current_snapshot())
    order by t.sync_xid, t.sync_rev limit %(lim)s)
) c order by x::xid8, r limit %(lim)s
"""
_HELD = """
with s as (select pg_snapshot_xmin(pg_current_snapshot()) as xmin)
select s.xmin::text as xmin,
  (select count(*) from paperlab.papers p where p.user_id = %(u)s and p.sync_xid >= s.xmin)
  + (select count(*) from paperlab.folders f where f.user_id = %(u)s and f.sync_xid >= s.xmin)
  + (select count(*) from paperlab.sync_tombstones t where t.user_id = %(u)s and t.sync_xid >= s.xmin) as held
from s
"""


def parse_cursor(lib, cursor) -> tuple[int, int]:
    """"<xid>:<rev>" → (xid, rev). 형식이 틀리거나 서버보다 앞서면(DB를 백업에서 되살림) 409 resync_required (K-23)"""
    m = CURSOR_RE.fullmatch(str(cursor if cursor is not None else ""))
    if not m:
        raise SyncError(409, "resync_required", "처음부터 다시 맞춰야 해요")
    x, r = int(m.group(1)), int(m.group(2))
    top = lib._one("select pg_snapshot_xmax(pg_current_snapshot())::text::numeric as xmax, "
                   "(select last_value from paperlab.sync_rev_seq) as last")
    if x > top["xmax"] or r > top["last"]:
        raise SyncError(409, "resync_required", "처음부터 다시 맞춰야 해요")
    return x, r


def feed(lib, cursor: tuple[int, int], limit: int) -> tuple[list[dict], tuple[int, int]]:
    """커서 뒤 변경(끝난 트랜잭션 것만) → (changes, 새 커서). 휴지통 변경을 보려고 trash_tx 안에서"""
    with lib.trash_tx():
        rows = lib._all(_FEED, {"u": lib.uid, "cx": str(cursor[0]), "cr": cursor[1], "lim": limit})
    out = []
    for r in rows:
        if r["kind"] == "folder":
            out.append({"kind": "folder", "id": r["id"], "op": "upsert",
                        "data": {"id": r["id"], "name": r["name"], "parent_id": r["parent_id"]}})
        elif r["kind"] == "tombstone":
            out.append({"kind": r["tomb_kind"], "id": r["id"], "op": "delete", "data": {}})
        elif r["deleted_at"] is not None:
            out.append({"kind": "paper", "id": r["id"], "op": "trash",
                        "data": {"sha256": r["sha"], "deleted_at": iso(r["deleted_at"]),
                                 "deleted_by_label": deleted_by_label(r["deleted_by"], r["device_name"])}})
        else:
            out.append({"kind": "paper", "id": r["id"], "op": "upsert",
                        "data": {"id": r["id"], "folder_id": r["folder_id"], "file_name": r["file_name"], "sha256": r["sha"],
                                 "size": r["size"], "content_at": iso(r["content_at"])}})
    new = (int(rows[-1]["x"]), rows[-1]["r"]) if rows else cursor
    return out, new


def snapshot_cursor(lib) -> str:
    """지금 이후(아직 안 끝났을 수 있는 트랜잭션 포함)의 변경을 피드가 주는 커서 — (xmin, 0)"""
    return f"{lib._one('select pg_snapshot_xmin(pg_current_snapshot())::text as x')['x']}:0"


def snapshot_page(lib, after: tuple[str, int] | None, limit: int) -> dict:
    """폴더 → PDF 논문 → 휴지통 논문 → 180일 안 묘비 순서로 limit개씩 (6.6절)"""
    kind, last = after or ("folder", 0)
    out = {"folders": [], "papers": [], "trashed": [], "tombstones": []}
    left = limit
    nxt = None
    with lib.trash_tx():
        for k in KINDS[KINDS.index(kind):]:
            start = last if k == kind else 0
            if k == "folder":
                rows = lib._all("select id, name, parent_id from paperlab.folders where user_id = %s and id > %s "
                                "order by id limit %s", (lib.uid, start, left))
                out["folders"] += [dict(r) for r in rows]
            elif k == "paper":
                rows = lib._all("select id, folder_id, file_name, pdf_sha256, pdf_size, content_at from paperlab.papers "
                                "where user_id = %s and id > %s and pdf_key <> '' and deleted_at is null order by id limit %s",
                                (lib.uid, start, left))
                out["papers"] += [paper_out(r) for r in rows]
            elif k == "trashed":
                rows = lib._all("select id, pdf_sha256, deleted_at from paperlab.papers where user_id = %s and id > %s "
                                "and pdf_key <> '' and deleted_at is not null order by id limit %s", (lib.uid, start, left))
                out["trashed"] += [{"id": r["id"], "sha256": r["pdf_sha256"], "deleted_at": iso(r["deleted_at"])}
                                   for r in rows]
            else:
                rows = lib._all("select id, kind, entity_id from paperlab.sync_tombstones where user_id = %s and id > %s "
                                "and created_at > now() - interval '180 days' order by id limit %s", (lib.uid, start, left))
                out["tombstones"] += [{"kind": r["kind"], "id": r["entity_id"]} for r in rows]
            left -= len(rows)
            if rows:
                nxt = {"kind": k, "id": rows[-1]["id"]}
            if left <= 0:
                break
    out["more"] = left <= 0
    out["next"] = nxt if out["more"] else None
    return out


# ====================================================================== 충돌 · 사본 (10장)
def _copy_slot(lib, folder_id, base_name: str, device: str, day: str) -> str:
    """사본 이름(늘 사본 형식) — 같은 이름이 있으면 괄호 안 끝에 ` 2`, ` 3` … (10.3절)"""
    taken = lib.names_in(folder_id)
    n = 1
    while True:
        cand = copy_name(base_name, device, day, n)
        if cand.lower() not in taken:
            return cand
        n += 1


def _new_copy_paper(lib, orig: dict, device: str, day: str) -> int:
    """충돌 사본 논문(K-6): 서지 복사(인용 키는 새로) · 같은 폴더 · 태그 `충돌 사본`. 하이라이트 · 노트 · 컬렉션 등은 복사 안 함"""
    meta = lib._one("select title, authors, year, venue, volume, issue, pages, publisher, doi, arxiv_id, openalex_id, "
                    "s2_id, url, pdf_url, abstract, item_type, keywords, issued, language from paperlab.papers "
                    "where id = %s and user_id = %s", (orig["id"], lib.uid))
    cid = lib.add_paper(dict(meta))
    name = _copy_slot(lib, orig["folder_id"], orig["file_name"] or f"paper-{orig['id']}.pdf", device, day)
    lib._x("update paperlab.papers set folder_id = %s, file_name = %s where id = %s and user_id = %s",
           (orig["folder_id"], name, cid, lib.uid))
    lib.add_tag_to_papers([cid], CONFLICT_TAG)
    return cid


def winner(incoming_at: datetime | None, server_at: datetime | None) -> str:
    """내용 충돌의 "나중"(K-5): 보정 시각이 둘 다 믿을 만하고 2초 넘게 차이 나면 더 나중 쪽, 아니면 도착 순서(들어온 쪽)"""
    if incoming_at is None or server_at is None or abs(incoming_at - server_at) <= TIE:
        return "incoming"
    return "incoming" if incoming_at > server_at else "server"


# ====================================================================== 등록
def register(app: FastAPI, st, H: SimpleNamespace) -> None:
    """H: 서버 도우미 — ctx(claims) · maintain · read_incoming · attach_from_incoming · pdf_changed · metadata_from_pdf ·
    sync_budget · db_budget · ensure_index · storage(앱 저장소) · allowlist · ws(WorkerState)"""
    S = st.sync = SyncState()
    db = st.db

    def device_ctx(request: Request):
        parsed = jobs.parse_token(bearer_token(request.headers.get("authorization")) or "")
        if not parsed:
            raise SyncError(401, **DEVICE_AUTH)
        uid, dev_id, secret = parsed
        ctx = H.ctx(actor_claims(uid, f"device:{dev_id}"))
        try:
            d = ctx.lib._one("select d.*, p.email from paperlab.devices d left join paperlab.profiles p "
                             "on p.user_id = d.user_id where d.id = %s and d.user_id = %s", (dev_id, uid))
            if not d or not hmac.compare_digest(d["token_hash"], jobs.sha256_hex(secret)):
                raise SyncError(401, **DEVICE_AUTH)
            if d["revoked_at"] is not None:
                raise SyncError(401, **DEVICE_REVOKED)
            try:
                H.allowlist.check({"email": d["email"] or ""})
            except NotAllowed:
                raise SyncError(403, "not_allowed", "허용되지 않은 계정이에요") from None
            if jobs.version_tuple(d["app_version"]) < jobs.version_tuple(MIN_SYNC_VERSION):
                raise SyncError(426, "update_required", "폴더 동기화는 PaperLab 앱 0.3.0 이상에서 쓸 수 있어요. "
                                "앱을 업데이트해 주세요", min_app_version=MIN_SYNC_VERSION)
        except BaseException as e:
            ctx.finish(e)
            raise
        request.state.device_id = dev_id
        jobs.touch_device(ctx.lib, dev_id)
        return ctx, d

    def err(e: SyncError) -> JSONResponse:
        return JSONResponse({"detail": e.detail, "code": e.code, **e.extra}, status_code=e.status)

    def run(request: Request, fn):
        try:
            ctx, d = device_ctx(request)
        except SyncError as e:
            return err(e)
        try:
            H.maintain(ctx)
            out = fn(ctx, d)
        except BaseException as e:
            ctx.finish(e)
            if isinstance(e, SyncError):
                return err(e)
            if isinstance(e, HTTPException):
                return JSONResponse({"detail": e.detail, "code": "not_found" if e.status_code == 404 else "bad_request"},
                                    status_code=e.status_code)
            if isinstance(e, jobs.JobError):
                return JSONResponse({"detail": e.detail, "code": e.code}, status_code=e.status)
            raise
        ctx.finish(None)
        if isinstance(out, dict):
            out["server_time"] = iso(now_dt())
        return out

    def stored(lib, d: dict, op: str) -> dict | None:
        r = lib._one("select response from paperlab.sync_ops where device_id = %s and op_id = %s and user_id = %s",
                     (d["id"], op, lib.uid))
        return dict(r["response"]) if r else None

    def remember(lib, d: dict, op: str, response: dict) -> dict:
        lib._x("insert into paperlab.sync_ops (user_id, device_id, op_id, response) values (%s, %s, %s, %s) "
               "on conflict do nothing", (lib.uid, d["id"], op, Jsonb(response)))
        return response

    def check_room(ctx, add_bytes: int, *, papers: int = 0) -> None:
        """K-30 · K-46: R2 남은 용량(95%) · 사용자당 올리기 상한 · DB 예산(새 논문만) 검사"""
        if add_bytes > 0:
            b = H.sync_budget(ctx)
            if add_bytes > b["storage_left"]:
                raise SyncError(400, "storage_full", "서재 저장 공간이 모자라요. 관리자에게 알려 주세요", reason="storage")
            if add_bytes > b["user_left"]:
                raise SyncError(400, "sync_quota", "올리기 한도를 넘어요", reason="sync_quota",
                                user_cap_bytes=b["user_cap_bytes"])
        if papers:
            budget = H.db_budget()
            if papers * budget["per_paper_bytes"] > budget["budget_bytes"]:
                raise SyncError(400, "db_full", "서재 데이터베이스 공간이 모자라요. 관리자에게 알려 주세요", reason="db")

    async def read_body(request: Request) -> dict:
        """본문 JSON 객체 — 실제로 읽은 바이트로 256KB 상한(chunked도 그 이상 읽지 않음, 5단계 small_json과 같은 방식)"""
        buf = bytearray()
        async for chunk in request.stream():
            buf.extend(chunk)
            if len(buf) > BODY_MAX:
                raise SyncError(413, "too_large", "요청이 너무 커요")
        try:
            data = json.loads(bytes(buf) or b"{}")
        except (ValueError, RecursionError):
            data = None
        if not isinstance(data, dict):
            raise SyncError(400, "bad_request", "요청 형식이 올바르지 않아요")
        return data

    def route(path: str):
        """POST /api/worker/sync/{path} — fn(ctx, d, body, **경로 숫자)을 기기 토큰 사용자 트랜잭션에서"""
        def deco(fn):
            async def endpoint(request: Request):
                try:
                    body = await read_body(request)
                except SyncError as e:
                    return err(e)
                params = {k: int(v) if v.isdigit() and len(v) < 19 else 0 for k, v in request.path_params.items()}
                return await run_in_threadpool(run, request, lambda ctx, d: fn(ctx, d, body, **params))
            app.post(f"/api/worker/sync/{path}", name=f"sync_{fn.__name__}")(endpoint)
            return fn
        return deco

    def folder_arg(lib, v) -> int | None:
        if v is None:
            return None
        if _int(v, 1) is None:
            raise SyncError(400, "bad_request", "folder_id가 올바르지 않아요")
        if not lib.has_folder(v):
            raise SyncError(404, "gone", "폴더가 없어요")
        return v

    # ------------------------------------------------------------ 시작 · 상태
    @route("start")
    def start(ctx, d, b):
        label = jobs.device_name(b.get("root_label"))[:60]
        enabled = b.get("enabled") is True
        ctx.lib._x("insert into paperlab.sync_devices (device_id, user_id, enabled, root_label, state) "
                   "values (%(d)s, %(u)s, %(e)s, %(l)s, case when %(e)s then 'scanning' else 'off' end) "
                   "on conflict (device_id) do update set enabled = excluded.enabled, root_label = excluded.root_label, "
                   "state = excluded.state, updated_at = now()", {"d": d["id"], "u": ctx.uid, "e": enabled, "l": label})
        ctx.lib._x("update paperlab.devices set features = (features - 'sync') || case when %s then '[\"sync\"]'::jsonb "
                   "else '[]'::jsonb end, updated_at = now() where id = %s and user_id = %s", (enabled, d["id"], ctx.uid))
        log.info("sync start device_id=%s enabled=%s", d["id"], enabled)
        return {"poll": {"idle_s": POLL_IDLE_S, "active_s": POLL_ACTIVE_S},
                "limits": {"max_file_bytes": MAX_PDF_BYTES, "max_ops": MAX_OPS, "max_add_parallel": 1}}

    @route("status")
    def status(ctx, d, b):
        state = b.get("state")
        if state not in STATES:
            raise SyncError(400, "bad_request", "state가 올바르지 않아요")
        raw = b.get("counts") if isinstance(b.get("counts"), dict) else {}
        counts = {k: raw[k] for k in COUNT_KEYS if _int(raw.get(k)) is not None and raw[k] < 10 ** 9}
        if state == "storage_full":
            counts["reason"] = raw.get("reason") if raw.get("reason") in REASONS else "storage"
        label = jobs.device_name(b.get("root_label"))[:60]
        ctx.lib._x("insert into paperlab.sync_devices (device_id, user_id, root_label) values (%s, %s, %s) "
                   "on conflict (device_id) do nothing", (d["id"], ctx.uid, label))
        n = ctx.lib._x(
            "update paperlab.sync_devices set state = %(s)s, counts = %(c)s, root_label = %(l)s, updated_at = now(), "
            "last_sync_at = case when %(s)s = 'idle' then now() else last_sync_at end, "
            "last_full_at = case when %(f)s then now() else last_full_at end "
            "where device_id = %(d)s and user_id = %(u)s and (state <> %(s)s or root_label <> %(l)s or %(f)s "
            "or updated_at < now() - make_interval(secs => %(every)s))",
            {"s": state, "c": Jsonb(counts), "l": label, "f": b.get("full") is True, "d": d["id"], "u": ctx.uid,
             "every": STATUS_EVERY_S}).rowcount
        return {"ok": True, "written": bool(n)}

    @route("device-check")
    def device_check(ctx, d, body):
        """루트 표식의 device_id가 누구 것인지 (Q-2 — 재설치 뒤 [다시 연결…]). 다른 사용자의 기기는 있음/없음만 구분"""
        dev = _int(body.get("device_id"), 1)
        if dev is None:
            raise SyncError(400, "bad_request", "device_id가 올바르지 않아요")
        if dev == d["id"]:
            return {"status": "self"}
        mine = ctx.lib._one("select revoked_at from paperlab.devices where id = %s and user_id = %s", (dev, ctx.uid))
        if mine:
            return {"status": "same_user_revoked" if mine["revoked_at"] is not None else "active_other"}
        with db.system_tx("sync device check") as conn:  # 다른 사용자 것인지 있음/없음만 (이름 · 상태는 읽지 않음)
            other = conn.execute("select 1 as x from paperlab.devices where id = %s", (dev,)).fetchone()
        return {"status": "other_user" if other else "unknown"}

    # ------------------------------------------------------------ 피드 · 스냅숏
    @route("changes")
    def changes(ctx, d, b):
        limit = _int(b.get("limit"), 1) or CHANGES_MAX
        cur = parse_cursor(ctx.lib, b.get("cursor"))
        items, new = feed(ctx.lib, cur, min(limit, CHANGES_MAX))
        held = ctx.lib._one(_HELD, {"u": ctx.uid})
        S.watch_xmin(held["xmin"], int(held["held"]))
        now = S.clock()
        if items:
            S.changed[ctx.uid] = now
        active = H.ws.recently_active(ctx.uid) or now - S.changed.get(ctx.uid, -1e18) < RECENT_CHANGE_S
        return {"changes": items, "cursor": f"{new[0]}:{new[1]}", "more": len(items) >= min(limit, CHANGES_MAX),
                "next_poll_s": POLL_ACTIVE_S if active else POLL_IDLE_S}

    @route("snapshot")
    def snapshot(ctx, d, b):
        limit = min(_int(b.get("limit"), 1) or SNAPSHOT_MAX, SNAPSHOT_MAX)
        pa = b.get("page_after")
        out: dict = {}
        if pa is None:
            cursor = snapshot_cursor(ctx.lib)  # 첫 쪽을 읽기 전에 잡음 (6.6절)
            named = ctx.lib.name_all_files()   # 이름이 빈 PDF 논문에 이름을 (8.2절)
            if named:
                log.info("sync named files n=%d", named)
            bud = H.sync_budget(ctx)
            out.update({k: bud[k] for k in ("upload_budget_bytes", "upload_budget_limit", "user_cap_bytes",
                                             "trash_bytes")}, db=H.db_budget())
            # K-13 기본값: 이 사용자의 다른 기기 중 동기화를 켠 수 (앱 요청)
            out["other_sync_devices"] = ctx.lib._one(
                "select count(*)::int as n from paperlab.sync_devices s join paperlab.devices v on v.id = s.device_id "
                "and v.user_id = s.user_id where s.user_id = %s and s.enabled and v.revoked_at is null "
                "and s.device_id <> %s", (ctx.uid, d["id"]))["n"]
            after = None
        else:
            if not isinstance(pa, dict) or pa.get("kind") not in KINDS or _int(pa.get("id")) is None:
                raise SyncError(400, "bad_request", "page_after가 올바르지 않아요")
            cursor = pa.get("cursor") if CURSOR_RE.fullmatch(str(pa.get("cursor") or "")) else snapshot_cursor(ctx.lib)
            after = (pa["kind"], pa["id"])
        page = snapshot_page(ctx.lib, after, limit)
        if page["next"]:
            page["next"]["cursor"] = cursor  # 다음 쪽도 첫 쪽 커서를 그대로 돌려주게
        return {"cursor": cursor, **out, **page}

    @route("lookup")
    def lookup(ctx, d, body):
        shas = body.get("sha256")
        if not isinstance(shas, list) or len(shas) > LOOKUP_MAX:
            raise SyncError(400, "bad_request", f"sha256 목록은 {LOOKUP_MAX}개까지예요")
        shas = list(dict.fromkeys(_sha(s) for s in shas))
        with ctx.lib.trash_tx():
            rows = ctx.lib._all("select distinct on (pdf_sha256) id, folder_id, file_name, pdf_sha256, "
                                "deleted_at is not null as trashed from paperlab.papers where user_id = %s "
                                "and pdf_sha256 = any(%s) and pdf_key <> '' "
                                "order by pdf_sha256, (deleted_at is not null), id", (ctx.uid, shas))
        return {"found": {r["pdf_sha256"]: {"id": r["id"], "folder_id": r["folder_id"], "file_name": r["file_name"],
                                            "trashed": r["trashed"]} for r in rows}}

    # ------------------------------------------------------------ 전송 (K-11 — 서명 주소만)
    @route("upload-slots")
    def upload_slots(ctx, d, body):
        files = body.get("files")
        if not isinstance(files, list) or not 1 <= len(files) <= SLOTS_MAX:
            raise SyncError(400, "bad_request", f"files는 1~{SLOTS_MAX}개예요")
        sizes = [_int(f.get("size"), 1) if isinstance(f, dict) else None for f in files]
        if any(s is None for s in sizes):
            raise SyncError(400, "bad_request", "size가 올바르지 않아요")
        check_room(ctx, sum(s for s in sizes if s <= MAX_PDF_BYTES))
        out = []
        for s in sizes:
            if s > MAX_PDF_BYTES:
                out.append({"code": "too_large", "error": "파일이 너무 커요 (100MB 초과)"})
                continue
            upload_id = str(uuid.uuid4())
            up = ctx.storage.create_upload(ctx.storage.incoming_key(upload_id))
            out.append({"upload_id": upload_id, "upload": {"method": up["method"], "url": up["url"],
                                                           "headers": up["headers"]}, "expires_at": up["expires_at"]})
        return {"slots": out}  # 요청 files 순서 그대로

    @route("download")
    def download(ctx, d, body):
        ids = body.get("ids")
        if not isinstance(ids, list) or not 1 <= len(ids) <= DOWNLOAD_MAX or any(_int(i, 1) is None for i in ids):
            raise SyncError(400, "bad_request", f"ids는 1~{DOWNLOAD_MAX}개예요")
        out = []
        for pid in ids:
            info = ctx.lib.pdf_info(pid)  # 휴지통 · 남의 논문은 RLS로 안 보임
            if not info or not info["pdf_key"]:
                out.append({"id": pid, "status": 404, "code": "not_found"})
                continue
            signed = ctx.storage.sign_get(info["pdf_key"])
            out.append({"id": pid, "url": signed["url"], "expires_at": signed["expires_at"],
                        "sha256": info["pdf_sha256"], "size": info["pdf_size"]})
        return {"items": out}

    def read_upload(ctx, upload_id, sha: str):
        """임시 파일 읽기 · 해시 확인 · 추출 → (임시 키, 내용, PdfInfo). 실패하면 임시 파일을 지우고 SyncError"""
        if not is_upload_id(str(upload_id or "")):
            raise SyncError(400, "bad_request", "upload_id가 필요해요")
        incoming, raw, error = H.read_incoming(ctx, upload_id)
        if error:
            raise SyncError(400, "bad_pdf", error)
        if hashlib.sha256(raw).hexdigest() != sha:
            ctx.storage.delete_quietly(incoming)
            raise SyncError(400, "sha_mismatch", "올린 파일의 해시가 달라요")
        try:
            info = pdf.extract(raw)
        except Exception:  # noqa: BLE001 - 손상된 PDF
            ctx.storage.delete_quietly(incoming)
            raise SyncError(400, "bad_pdf", "PDF를 열 수 없어요") from None
        return incoming, raw, info

    # ------------------------------------------------------------ 새 파일 (9장 · K-16 · K-32)
    @route("files/add")
    def files_add(ctx, d, b):
        op = _op_id(b)
        prev = stored(ctx.lib, d, op)
        if prev:
            return prev
        sha, name = _sha(b.get("sha256")), _file_name(b.get("file_name"))
        folder = folder_arg(ctx.lib, b.get("folder_id"))
        at = _ms_time(b.get("mtime_ms"), b.get("clock_offset_ms"))
        copy_of = (d["name"], kst_day(at))
        if not S.try_add(ctx.uid):
            raise SyncError(429, "sync_busy", "다른 파일을 올리는 중이에요. 잠시 후 다시 보내 주세요")
        try:
            return add_file(ctx, d, b, op, sha, name, folder, at, copy_of)
        finally:
            S.done_add(ctx.uid)

    def add_file(ctx, d, b, op, sha, name, folder, at, copy_of):
        hit = _by_sha(ctx.lib, sha)
        if hit:  # 같은 해시 — 전송 0, 새 논문 0
            return link_or_restore(ctx, d, op, hit, folder, name, copy_of, b.get("upload_id"))
        check_room(ctx, _int(b.get("size"), 0) or 0, papers=1)
        ctx.sources  # noqa: B018 - 사용자 설정(연락처 · API 키)을 먼저 읽어 둔다
        ctx.release()  # R2 받기 · 추출 · 메타데이터 조회 동안 DB 연결을 잡지 않는다 (F9)
        incoming, raw, info = read_upload(ctx, b.get("upload_id"), sha)
        if len(raw) != (_int(b.get("size"), 0) or 0):  # 보낸 크기로 검사를 통과하고 더 큰 파일을 올리지 못하게 (QA D4)
            ctx.storage.delete_quietly(incoming)
            raise SyncError(400, "sha_mismatch", "올린 파일의 크기가 보낸 값과 달라요")
        meta_, _ = H.metadata_from_pdf(ctx, info)
        if not meta_.get("title"):
            meta_["title"] = name[:-4]
        lib = ctx.lib  # 새 트랜잭션: 그 사이 같은 해시가 생겼거나 폴더가 지워졌을 수 있음
        prev = stored(lib, d, op)
        if prev:
            ctx.after_commit.append(lambda: ctx.storage.delete_quietly(incoming))
            return prev
        hit = _by_sha(lib, sha)
        if hit:
            ctx.after_commit.append(lambda: ctx.storage.delete_quietly(incoming))
            return link_or_restore(ctx, d, op, hit, folder, name, copy_of, None)
        try:
            check_room(ctx, len(raw), papers=1)  # 실제 크기로 다시 (그 사이 다른 올리기로 줄었을 수도)
        except SyncError:
            ctx.storage.delete_quietly(incoming)
            raise
        if folder is not None and not lib.has_folder(folder):
            folder = None
        out: dict = {"result": "created"}
        dup = lib.find_duplicate(meta_.get("doi", ""), meta_.get("arxiv_id", ""), meta_.get("title", ""))
        if dup and not dup["has_pdf"]:
            pid = dup["id"]  # K-16: 같은 논문인데 PDF가 없으면 거기에 붙임
        else:
            if not dup:  # Q-4: 휴지통에 같은 논문(다른 PDF)이 있으면 새로 만들고 알려 줌
                tdup = lib.find_duplicate(meta_.get("doi", ""), meta_.get("arxiv_id", ""), meta_.get("title", ""),
                                          include_trash=True)
                if tdup and tdup.get("trashed"):
                    out["trashed_duplicate_id"] = tdup["id"]
            elif dup["has_pdf"]:
                out["duplicate_id"] = dup["id"]  # 같은 논문 · 다른 PDF → 새 논문(화면에 "서재에 같은 논문이 있어요")
            pid = lib.add_paper(meta_)
        lib.place_paper(pid, folder, name, copy_of)
        H.attach_from_incoming(ctx, pid, incoming, raw, info, device_id=d["id"], content_at=at)
        out["paper"] = _view(lib, pid)
        log.info("sync add device_id=%s paper=%s result=created", d["id"], pid)
        return remember(lib, d, op, out)


    def link_or_restore(ctx, d, op, hit, folder, name, copy_of, upload_id) -> dict:
        lib = ctx.lib
        if upload_id and is_upload_id(str(upload_id)):  # 올려 둔 임시 파일은 쓰지 않으므로 지움
            key = ctx.storage.incoming_key(str(upload_id))
            ctx.after_commit.append(lambda: ctx.storage.delete_quietly(key))
        if hit["deleted_at"] is not None:  # K-32: 휴지통 논문을 보낸 자리로 되살림(하이라이트 · 노트 · 번역 그대로)
            lib.restore_papers([hit["id"]], places={hit["id"]: (folder, name, copy_of)})
            ctx.after_commit.append(lambda: H.ensure_index(ctx.claims))
            result = "restored"
        else:
            if (hit["folder_id"], hit["file_name"]) != (folder, name):
                lib.place_paper(hit["id"], folder, name, copy_of)  # 위치가 다르면 나중 것(이번 것) 위치로
            result = "linked"
        out = {"result": result, "paper": _view(lib, hit["id"])}
        log.info("sync add device_id=%s paper=%s result=%s", d["id"], hit["id"], result)
        return remember(lib, d, op, out)

    # ------------------------------------------------------------ 내용 바뀜 (10장 U-1 · K-28)
    @route("files/{pid}/content")
    def content(ctx, d, b, pid):
        op = _op_id(b)
        prev = stored(ctx.lib, d, op)
        if prev:
            return prev
        sha, base = _sha(b.get("sha256")), _sha(b.get("base_sha256"))
        at = _ms_time(b.get("mtime_ms"), b.get("clock_offset_ms"))
        with ctx.lib.trash_tx():
            p = _paper(ctx.lib, pid) if _int(pid, 1) else None
        if not p or not p["pdf_key"]:
            raise SyncError(404, "gone", "논문을 찾을 수 없어요")
        if p["pdf_sha256"] == sha and p["deleted_at"] is None:  # 이미 같은 내용 — 올려 둔 임시 파일은 지움
            if is_upload_id(str(b.get("upload_id") or "")):
                key = ctx.storage.incoming_key(str(b["upload_id"]))
                ctx.after_commit.append(lambda: ctx.storage.delete_quietly(key))
            return remember(ctx.lib, d, op, {"result": "replaced", "paper": paper_out(p), "translation_cleared": False})
        ctx.release()  # R2 받기 · 추출 동안 DB 연결을 잡지 않는다 (F9)
        incoming, raw, info = read_upload(ctx, b.get("upload_id"), sha)
        lib = ctx.lib
        prev = stored(lib, d, op)
        if prev:
            ctx.after_commit.append(lambda: ctx.storage.delete_quietly(incoming))
            return prev
        with lib.trash_tx():  # K-39: 휴지통 논문의 되살리기 · PDF 교체는 trash_tx 안에서
            p = _paper(lib, pid, lock=True)
            if not p or not p["pdf_key"]:
                ctx.storage.delete_quietly(incoming)
                raise SyncError(404, "gone", "논문을 찾을 수 없어요")
            if p["deleted_at"] is not None:
                check_room(ctx, len(raw) - (p["pdf_size"] or 0))
                lib.restore_papers([pid])
                cleared = H.attach_from_incoming(ctx, pid, incoming, raw, info, device_id=d["id"], content_at=at)
                out = {"result": "restored", "paper": _view(lib, pid), "translation_cleared": cleared}
            elif p["pdf_sha256"] == base or p["pdf_sha256"] == sha:
                check_room(ctx, len(raw) - (p["pdf_size"] or 0))
                cleared = H.attach_from_incoming(ctx, pid, incoming, raw, info, device_id=d["id"], content_at=at)
                out = {"result": "replaced", "paper": _view(lib, pid), "translation_cleared": cleared}
            else:
                out = conflict(ctx, d, p, incoming, raw, info, at)
        log.info("sync content device_id=%s paper=%s result=%s", d["id"], pid, out["result"])
        return remember(lib, d, op, out)

    def conflict(ctx, d, p, incoming, raw, info, at) -> dict:
        """10.2절 첫 줄: 나중 쪽이 원래 논문 · 원래 이름, 진 쪽 내용은 같은 폴더의 새 논문(충돌 사본)"""
        lib = ctx.lib
        win = winner(at, p["content_at"])
        if win == "incoming":
            check_room(ctx, len(raw))  # 사본 = 옛 내용 크기, 원래 논문 = 새 내용 − 옛 내용 → 합계 +새 내용
            loser_dev = p["device_name"] or ("웹" if p["content_device_id"] is None else "PC")
            cid = _new_copy_paper(lib, p, loser_dev, kst_day(p["content_at"]))
            # 진 쪽 = 서버의 지금 내용: 덮어쓰기 **전에** 사본 키로 복사(12.1절 6번 · AC-632)
            key = ctx.storage.paper_key(cid)
            ctx.storage.storage.copy(ctx.storage.check(p["pdf_key"]), ctx.storage.check(key))
            texts = lib.page_texts(p["id"])
            H.pdf_changed(ctx, cid, lib.set_pdf(cid, key, texts, p["pdf_sha256"], p["pdf_size"], p["content_device_id"],
                                                p["content_at"]))
            cleared = H.attach_from_incoming(ctx, p["id"], incoming, raw, info, device_id=d["id"], content_at=at)
        else:
            check_room(ctx, len(raw))
            cid = _new_copy_paper(lib, p, d["name"], kst_day(at))
            H.attach_from_incoming(ctx, cid, incoming, raw, info, device_id=d["id"], content_at=at)
            cleared = False
        return {"result": "conflict", "winner": win, "paper": _view(lib, p["id"]), "copy": _view(lib, cid),
                "translation_cleared": cleared}

    # ------------------------------------------------------------ 묶음 작업 (14.1절 ops)
    @route("ops")
    def ops(ctx, d, body):
        items = body.get("ops")
        if not isinstance(items, list) or not 1 <= len(items) <= MAX_OPS:
            raise SyncError(400, "bad_request", f"ops는 1~{MAX_OPS}개예요")
        out = []
        for it in items:
            out.append(one_op(ctx, d, it if isinstance(it, dict) else {}))
        return {"results": out}

    def one_op(ctx, d, it: dict) -> dict:
        lib = ctx.lib
        try:
            op = _op_id(it)
        except SyncError as e:
            return {"op_id": it.get("op_id"), "ok": False, "result": "error", "code": e.code}
        prev = stored(lib, d, op)
        if prev:
            return prev
        try:
            with lib.conn.transaction():  # 항목마다 저장점 — 한 항목 실패가 다른 항목을 막지 않음
                res = OPS.get(it.get("type"), op_unknown)(ctx, d, it)
                res = {"op_id": op, "ok": res.get("ok", True), **res}
                return remember(lib, d, op, res)
        except SyncError as e:
            return {"op_id": op, "ok": False, "result": "error", "code": e.code}
        except DBUnavailable:
            raise
        except Exception as e:  # noqa: BLE001 - 이름 겹침 경합 · CHECK 위반 등. 내용 없이 종류만
            log.warning("sync op failed type=%s: %s", it.get("type"), type(e).__name__)
            return {"op_id": op, "ok": False, "result": "error", "code": "retry"}

    def op_unknown(ctx, d, it):
        raise SyncError(400, "bad_request", "알 수 없는 작업")

    def folder_out(lib, fid: int) -> dict:
        r = lib._one("select id, name, parent_id from paperlab.folders where id = %s and user_id = %s", (fid, lib.uid))
        return dict(r)

    def folder_name_arg(v) -> str:
        name = unicodedata.normalize("NFC", str(v or ""))
        if folder_name_problem(name):
            raise SyncError(400, "bad_name", folder_name_problem(name))
        return name

    def op_folder_create(ctx, d, it):
        lib = ctx.lib
        name = folder_name_arg(it.get("name"))
        parent = it.get("parent_id")
        if parent is not None and (_int(parent, 1) is None or not lib.has_folder(parent)):
            return {"ok": False, "result": "gone"}
        same = lib._one("select id from paperlab.folders where user_id = %s and coalesce(parent_id, 0) = coalesce(%s, 0) "
                        "and lower(name) = lower(%s)", (lib.uid, parent, name))
        if same:  # 겹침 = 그 폴더로 연결(합침 — K-8)
            return {"result": "linked", "folder": folder_out(lib, same["id"])}
        return {"result": "created", "folder": folder_out(lib, lib.add_folder(name, parent))}

    def op_folder_update(ctx, d, it):
        lib = ctx.lib
        fid = _int(it.get("id"), 1)
        row = lib._one("select id, name, parent_id from paperlab.folders where id = %s and user_id = %s",
                       (fid, lib.uid)) if fid else None
        if not row:
            return {"ok": False, "result": "gone"}
        name = folder_name_arg(it["name"]) if "name" in it else row["name"]
        parent = it["parent_id"] if "parent_id" in it else row["parent_id"]
        if parent is not None:
            if _int(parent, 1) is None or not lib.has_folder(parent):
                return {"ok": False, "result": "gone"}
            if lib._is_descendant("folders", parent, fid):
                return {"ok": False, "result": "rejected"}
        final, n = name, 1
        while lib._folder_name_taken(final, parent, exclude=fid):  # 겹치면 바꾸는 쪽을 ` (2)` (K-8)
            n += 1
            final = name[:100 - len(f" ({n})")] + f" ({n})"
        lib._x("update paperlab.folders set name = %s, parent_id = %s, updated_at = now() where id = %s and user_id = %s",
               (final, parent, fid, lib.uid))
        return {"result": "applied", "folder": folder_out(lib, fid)}

    def op_folder_delete(ctx, d, it):
        lib = ctx.lib
        fid = _int(it.get("id"), 1)
        if not fid or not lib.has_folder(fid):
            return {"result": "deleted"}  # 이미 없음 — 멱등
        busy = lib._one("select exists (select 1 from paperlab.papers where user_id = %(u)s and folder_id = %(f)s "
                        "and pdf_key <> '') or exists (select 1 from paperlab.folders where user_id = %(u)s "
                        "and parent_id = %(f)s) as busy", {"u": lib.uid, "f": fid})["busy"]
        if busy:
            return {"ok": False, "result": "not_empty"}
        lib.delete_folder(fid)  # PDF 없는 논문은 부모로(웹 폴더 삭제와 같음) · 휴지통 논문은 외래 키가 폴더를 비움 · 묘비
        return {"result": "deleted"}

    def op_file_move(ctx, d, it):
        lib = ctx.lib
        pid = _int(it.get("id"), 1)
        p = lib._one("select id, folder_id, file_name from paperlab.papers where id = %s and user_id = %s and pdf_key <> ''",
                     (pid, lib.uid)) if pid else None
        if not p:
            return {"ok": False, "result": "gone"}  # 휴지통 · 없음
        name = _file_name(it.get("file_name"))
        folder = it.get("folder_id")
        if folder is not None and (_int(folder, 1) is None or not lib.has_folder(folder)):
            return {"ok": False, "result": "gone", "code": "folder_gone"}
        lib.place_paper(pid, folder, name, (d["name"], kst_day()))  # 나중 것 적용 · 겹치면 들어오는 쪽이 사본 이름(K-8)
        with lib.trash_tx():
            return {"result": "applied", "paper": paper_out(_paper(lib, pid))}

    def op_file_delete(ctx, d, it):
        lib = ctx.lib
        pid = _int(it.get("id"), 1)
        base = _sha(it.get("base_sha256"))
        with lib.trash_tx():
            p = _paper(lib, pid) if pid else None
        if not p:
            return {"ok": False, "result": "gone"}
        if p["deleted_at"] is not None:
            return {"result": "trashed"}
        if p["pdf_sha256"] != base:  # 바뀐 쪽이 삭제를 이김 (12.1절 4번)
            return {"ok": False, "result": "changed", "paper": paper_out(p)}
        H.trash_papers(ctx, [pid], f"device:{d['id']}")
        return {"result": "trashed"}

    OPS = {"folder.create": op_folder_create, "folder.update": op_folder_update, "folder.delete": op_folder_delete,
           "file.move": op_file_move, "file.delete": op_file_delete}
