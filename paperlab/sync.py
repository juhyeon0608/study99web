"""6단계 폴더 양방향 동기화 — 워커 API `/api/worker/sync/*` (docs/specs/phase6-folder-sync.md 6 · 10 · 11 · 14장)
+ 선택 동기화 v2 (docs/specs/selective-sync.md 7.1절): 프로토콜 문(머리글 `X-PaperLab-Sync: 2`), PC 표현(원본이 있으면 원본 —
5.5절), 로컬 항목(PC에만 둔 파일 — 정보만 서버), 전환 실행(`mode.ack` · `mode.fail` · `files/{id}/promote`).

- 인증은 2단계 기기 토큰(`pld1.…`) 그대로: 그 사용자 `actor_claims` 트랜잭션(RLS force — service role 없음). JWT는 받지 않는다.
- 변경 피드(K-38): `papers` · `folders` · `sync_tombstones`의 `(sync_xid, sync_rev)`를 트리거가 쓰고, 피드는
  **같은 SQL 문 안에서** `sync_xid < pg_snapshot_xmin(pg_current_snapshot())`인 행만(앞선 트랜잭션이 모두 끝난 것) 그 순서로.
  커서 = 불투명 문자열 "<xid>:<rev>".
- 휴지통 · 해시 읽기는 `Library.trash_tx()` 안에서만(K-39). PDF 바이트는 R2 서명 주소로만 오간다(K-11 — 서버는 주소 발급만).
- 로그에는 id · 종류 · 결과 코드 · 개수만(파일 이름 · 경로 · 해시 · 서명 주소 · 토큰 없음 — 12.6절).
"""

from __future__ import annotations

import hashlib
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

from . import convert, jobs
from .db import (REP_KIND, REP_SHA, REP_SIZE, SYNC_TARGET, DBUnavailable, actor_claims, deleted_by_label,
                 file_name_problem, folder_name_problem, iso, kst_day, now_dt, split_ext)
from .storage import MAX_PDF_BYTES, is_upload_id
from .worker_api import _Deny, check_device, device_token

log = logging.getLogger("paperlab.sync")

# 선택 동기화 D-7: 동기화 API는 머리글 X-PaperLab-Sync ≥ 2(0.4.0 앱)만 받는다 — 0.3.1은 426으로 멈추고 자동 업데이트.
# 0.3.1이 새 서버와 맞추면 로컬 항목(pdf_key = '')이 스냅숏에서 빠져 K-23 다시 올리기로 중복 논문을 만들기 때문
MIN_SYNC_VERSION = "0.4.0"
SYNC_PROTOCOL = 2
SYNC_HEADER = "x-paperlab-sync"
# 머리글 없이 devices.app_version만 낮을 때의 바닥(6단계 K-29) — 0.4.0 판정은 머리글로 한다: 업데이트 직후 워커 hello가
# app_version을 고치기 전에 동기화가 먼저 시작해도 막히지 않게 (D-7 "머리글 문은 app_version을 기다리지 않음")
MIN_APP_FLOOR = "0.3.0"
UPDATE_REQUIRED = "폴더 동기화를 쓰려면 PaperLab 앱을 0.4.0 이상으로 업데이트해 주세요"
MODE_FAIL_REASONS = ("missing", "changed_here", "too_long", "unreadable")
STORAGES = ("cloud", "local")
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
COUNT_KEYS = ("files", "pending_up", "pending_down", "waiting_confirm", "problems",
              "local", "pending_mode")  # 선택 동기화: 이 PC에만 · 바꾸는 중 (10.8절)
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
    """스냅숏 · 피드 · 응답의 논문 항목 (selective-sync.md 7.1절): 해시 · 크기 = PC 표현(5.5절), kind · storage · holder ·
    holder_name · holder_gone · pending = 선택 동기화 (holder_name — D-4 확인 창 · 알림의 ‘연구실 PC’, 10.9절)"""
    return {"id": r["id"], "folder_id": r["folder_id"], "file_name": r["file_name"], "sha256": r["rep_sha"],
            "size": r["rep_size"], "content_at": iso(r.get("content_at")), "kind": r["rep_kind"], "storage": r["storage"],
            "holder": r["local_device_id"], "holder_name": r.get("holder_name") or "",
            "holder_gone": bool(r["holder_gone"]), "pending": r["mode_pending"]}


# PC 표현 · 보관 PC 열 (hd = 보관 PC 기기 행 — _HOLDER_JOIN). 보관 PC가 해지됐거나 행이 없어졌으면 holder_gone
_REP_COLS = (f"{REP_SHA} as rep_sha, {REP_SIZE} as rep_size, {REP_KIND} as rep_kind, p.storage, p.local_device_id, "
             "p.mode_pending, p.mode_error, p.source_key, p.source_name, p.source_sha256, p.source_size, "
             "((p.storage = 'local' or p.mode_pending <> '') and (hd.id is null or hd.revoked_at is not null)) as holder_gone, "
             "hd.name as holder_name")
_HOLDER_JOIN = " left join paperlab.devices hd on hd.id = p.local_device_id and hd.user_id = p.user_id"
# REP_SHA = 값 — 해시 색인 두 개(papers_user_source_sha · papers_user_sha)를 쓰게 풀어 쓴 같은 조건 (매개변수 2개)
_REP_EQ = "(p.source_sha256 = %s or (p.source_sha256 = '' and p.pdf_sha256 = %s))"
_PAPER_COLS = ("p.id, p.folder_id, p.file_name, p.pdf_sha256, p.pdf_size, p.pdf_key, p.content_at, p.content_device_id, "
               "p.deleted_at, p.title, " + _REP_COLS)


def _paper(lib, pid: int, lock: bool = False) -> dict | None:
    """휴지통 포함 그 논문(동기화 판정용) — trash_tx 안에서 부른다"""
    return lib._one(f"select {_PAPER_COLS}, d.name as device_name from paperlab.papers p left join paperlab.devices d "
                    "on d.id = p.content_device_id and d.user_id = p.user_id" + _HOLDER_JOIN
                    + " where p.id = %s and p.user_id = %s" + (" for update of p" if lock else ""), (pid, lib.uid))


def _by_sha(lib, sha: str) -> dict | None:
    """그 PC 표현 해시의 동기화 대상 논문 — 살아 있는 것 먼저, 같으면 가장 작은 id (6단계 7.2절 4번)"""
    with lib.trash_tx():
        return lib._one(f"select {_PAPER_COLS} from paperlab.papers p{_HOLDER_JOIN} where p.user_id = %s "
                        f"and {_REP_EQ} and {SYNC_TARGET} order by (p.deleted_at is not null), p.id limit 1",
                        (lib.uid, sha, sha))


def _view(lib, pid: int) -> dict:
    with lib.trash_tx():
        return paper_out(_paper(lib, pid))


# ====================================================================== 피드 (6.2절 · K-38)
_FEED = """
select * from (
  (select 'folder' as kind, f.id, f.sync_xid::text as x, f.sync_rev as r, f.name, f.parent_id, f.sync_mode,
          null::bigint as folder_id, null::text as file_name, null::text as rep_sha, null::bigint as rep_size,
          null::timestamptz as content_at, null::timestamptz as deleted_at, null::text as deleted_by,
          null::text as device_name, null::text as tomb_kind, null::text as rep_kind, null::text as storage,
          null::bigint as local_device_id, null::boolean as holder_gone, null::text as mode_pending,
          null::text as holder_name
     from paperlab.folders f
    where f.user_id = %(u)s and (f.sync_xid, f.sync_rev) > (%(cx)s::xid8, %(cr)s::bigint)
      and f.sync_xid < pg_snapshot_xmin(pg_current_snapshot())
    order by f.sync_xid, f.sync_rev limit %(lim)s)
  union all
  (select 'paper', p.id, p.sync_xid::text, p.sync_rev, null, null, null, p.folder_id, p.file_name,
          {rep_sha}, {rep_size}, p.content_at, p.deleted_at, p.deleted_by, d.name, null, {rep_kind}, p.storage,
          p.local_device_id, ((p.storage = 'local' or p.mode_pending <> '') and (hd.id is null or hd.revoked_at is not null)),
          p.mode_pending, hd.name
     from paperlab.papers p
     left join paperlab.devices d on p.deleted_by = 'device:' || d.id::text and d.user_id = p.user_id
     {holder_join}
    where p.user_id = %(u)s and (p.sync_xid, p.sync_rev) > (%(cx)s::xid8, %(cr)s::bigint)
      and p.sync_xid < pg_snapshot_xmin(pg_current_snapshot()) and {target}
    order by p.sync_xid, p.sync_rev limit %(lim)s)
  union all
  (select 'tombstone', t.entity_id, t.sync_xid::text, t.sync_rev, null, null, null, null, null, null, null, null, null,
          null, null, t.kind, null, null, null, null, null, null
     from paperlab.sync_tombstones t
    where t.user_id = %(u)s and (t.sync_xid, t.sync_rev) > (%(cx)s::xid8, %(cr)s::bigint)
      and t.sync_xid < pg_snapshot_xmin(pg_current_snapshot())
    order by t.sync_xid, t.sync_rev limit %(lim)s)
) c order by x::xid8, r limit %(lim)s
""".replace("{rep_sha}", REP_SHA).replace("{rep_size}", REP_SIZE).replace("{rep_kind}", REP_KIND) \
   .replace("{holder_join}", _HOLDER_JOIN).replace("{target}", SYNC_TARGET)
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
                        "data": {"id": r["id"], "name": r["name"], "parent_id": r["parent_id"], "sync_mode": r["sync_mode"]}})
        elif r["kind"] == "tombstone":
            out.append({"kind": r["tomb_kind"], "id": r["id"], "op": "delete", "data": {}})
        elif r["deleted_at"] is not None:
            out.append({"kind": "paper", "id": r["id"], "op": "trash",
                        "data": {"sha256": r["rep_sha"], "deleted_at": iso(r["deleted_at"]),
                                 "deleted_by_label": deleted_by_label(r["deleted_by"], r["device_name"])}})
        else:
            out.append({"kind": "paper", "id": r["id"], "op": "upsert", "data": paper_out(r)})
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
                rows = lib._all("select id, name, parent_id, sync_mode from paperlab.folders where user_id = %s and id > %s "
                                "order by id limit %s", (lib.uid, start, left))
                out["folders"] += [dict(r) for r in rows]
            elif k == "paper":  # PC 표현이 있는 살아 있는 논문 전부 — 로컬 항목 포함 (선택 동기화 7.1절)
                rows = lib._all(f"select {_PAPER_COLS} from paperlab.papers p{_HOLDER_JOIN} where p.user_id = %s "
                                f"and p.id > %s and {SYNC_TARGET} and p.deleted_at is null order by p.id limit %s",
                                (lib.uid, start, left))
                out["papers"] += [paper_out(r) for r in rows]
            elif k == "trashed":
                rows = lib._all(f"select p.id, {REP_SHA} as rep_sha, p.deleted_at from paperlab.papers p "
                                f"where p.user_id = %s and p.id > %s and {SYNC_TARGET} and p.deleted_at is not null "
                                "order by p.id limit %s", (lib.uid, start, left))
                out["trashed"] += [{"id": r["id"], "sha256": r["rep_sha"], "deleted_at": iso(r["deleted_at"])}
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
def _new_copy_paper(lib, orig: dict, device: str, day: str) -> int:
    """충돌 사본 논문(K-6): 서지 복사(인용 키는 새로) · 같은 폴더 · 태그 `충돌 사본`. 하이라이트 · 노트 · 컬렉션 등은 복사 안 함"""
    meta = lib._one("select title, authors, year, venue, volume, issue, pages, publisher, doi, arxiv_id, openalex_id, "
                    "s2_id, url, pdf_url, abstract, item_type, keywords, issued, language from paperlab.papers "
                    "where id = %s and user_id = %s", (orig["id"], lib.uid))
    cid = lib.add_paper(dict(meta))
    name = lib.free_name(orig["folder_id"], orig["file_name"] or f"paper-{orig['id']}.pdf", copy_of=(device, day),
                         always_copy=True)
    lib._x("update paperlab.papers set folder_id = %s, file_name = %s where id = %s and user_id = %s",
           (orig["folder_id"], name, cid, lib.uid))
    lib.add_tag_to_papers([cid], CONFLICT_TAG)
    return cid


def sync_protocol(request: Request) -> int:
    """머리글 X-PaperLab-Sync의 정수(없거나 틀리면 0) — 0.4.0 앱은 2 (D-7)"""
    v = (request.headers.get(SYNC_HEADER) or "").strip()
    return int(v) if v.isdigit() and len(v) <= 2 else 0


def winner(incoming_at: datetime | None, server_at: datetime | None) -> str:
    """내용 충돌의 "나중"(K-5): 보정 시각이 둘 다 믿을 만하고 2초 넘게 차이 나면 더 나중 쪽, 아니면 도착 순서(들어온 쪽)"""
    if incoming_at is None or server_at is None or abs(incoming_at - server_at) <= TIE:
        return "incoming"
    return "incoming" if incoming_at > server_at else "server"


# ====================================================================== 등록
def register(app: FastAPI, st, H: SimpleNamespace) -> None:
    """H: 서버 도우미 — ctx(claims) · maintain · read_incoming · prepare_upload · BadPdf · attach_from_incoming ·
    pdf_changed · metadata_from_pdf · sync_budget · db_budget · ensure_index · demote_paper · storage(앱 저장소) ·
    allowlist · ws(WorkerState)"""
    S = st.sync = SyncState()
    db = st.db

    def device_ctx(request: Request):
        try:
            uid, dev_id, secret = device_token(request)
        except _Deny as e:
            raise SyncError(e.status, **e.body) from None
        ctx = H.ctx(actor_claims(uid, f"device:{dev_id}"))
        try:
            try:
                d = check_device(ctx.lib, request, dev_id, secret, H.allowlist)  # 워커 API와 같은 확인
            except _Deny as e:
                raise SyncError(e.status, **e.body) from None
            proto = sync_protocol(request)
            known_old = d["app_version"] and jobs.version_tuple(d["app_version"]) < jobs.version_tuple(MIN_APP_FLOOR)
            if proto < SYNC_PROTOCOL or known_old:  # D-7 — 0.3.1은 머리글이 없다
                raise SyncError(426, "update_required", UPDATE_REQUIRED, min_app_version=MIN_SYNC_VERSION,
                                min_sync_protocol=SYNC_PROTOCOL)
        except BaseException as e:
            ctx.finish(e)
            raise
        jobs.touch_device(ctx.lib, dev_id)
        return ctx, {**d, "sync_protocol": proto}

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

    def check_room(ctx, add_bytes: int, *, papers: int = 0, local: int = 0) -> None:
        """K-30 · K-46: R2 남은 용량(95%) · 사용자당 올리기 상한 · DB 예산(새 논문만) 검사.
        local: 새 로컬 항목 편수 — R2 · 사용자 상한은 쓰지 않고 DB 예산만 편당 로컬 추정치로 (선택 동기화 7.1절)"""
        if local:
            budget = H.db_budget(ctx)
            if local * budget["per_local_bytes"] > budget["budget_bytes"]:
                raise SyncError(400, "db_full", "서재 데이터베이스 공간이 모자라요. 관리자에게 알려 주세요", reason="db")
        if add_bytes > 0:
            b = H.sync_budget(ctx)
            if add_bytes > b["storage_left"]:
                raise SyncError(400, "storage_full", "서재 저장 공간이 모자라요. 관리자에게 알려 주세요", reason="storage")
            if add_bytes > b["user_left"]:
                raise SyncError(400, "sync_quota", "올리기 한도를 넘어요", reason="sync_quota",
                                user_cap_bytes=b["user_cap_bytes"])
        if papers:
            budget = H.db_budget(ctx)
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
        proto = min(d["sync_protocol"], 99)
        ctx.lib._x("insert into paperlab.sync_devices (device_id, user_id, enabled, root_label, state, protocol) "
                   "values (%(d)s, %(u)s, %(e)s, %(l)s, case when %(e)s then 'scanning' else 'off' end, %(p)s) "
                   "on conflict (device_id) do update set enabled = excluded.enabled, root_label = excluded.root_label, "
                   "state = excluded.state, protocol = excluded.protocol, updated_at = now()",
                   {"d": d["id"], "u": ctx.uid, "e": enabled, "l": label, "p": proto})
        ctx.lib._x("update paperlab.devices set features = (features - 'sync') || case when %s then '[\"sync\"]'::jsonb "
                   "else '[]'::jsonb end, updated_at = now() where id = %s and user_id = %s", (enabled, d["id"], ctx.uid))
        log.info("sync start device_id=%s enabled=%s protocol=%s", d["id"], enabled, proto)
        # protocol 2: 0.4.0 앱은 이 값이 없으면(옛 서버) v1 모드(PDF만)로 동작 (8.6절). exts = 동기화 확장자(convert.ACCEPT_EXTS)
        return {"protocol": SYNC_PROTOCOL, "device_id": d["id"], "exts": list(convert.ACCEPT_EXTS),
                "poll": {"idle_s": POLL_IDLE_S, "active_s": POLL_ACTIVE_S},
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
            "update paperlab.sync_devices set state = %(s)s, counts = %(c)s, root_label = %(l)s, protocol = %(p)s, "
            "updated_at = now(), last_sync_at = case when %(s)s = 'idle' then now() else last_sync_at end, "
            "last_full_at = case when %(f)s then now() else last_full_at end "
            "where device_id = %(d)s and user_id = %(u)s and (state <> %(s)s or root_label <> %(l)s or %(f)s "
            "or protocol <> %(p)s or updated_at < now() - make_interval(secs => %(every)s))",
            {"s": state, "c": Jsonb(counts), "l": label, "f": b.get("full") is True, "d": d["id"], "u": ctx.uid,
             "every": STATUS_EVERY_S, "p": min(d["sync_protocol"], 99)}).rowcount
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
                                             "trash_bytes")}, db=H.db_budget(ctx))
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
        with ctx.lib.trash_tx():  # PC 표현 해시 기준 (선택 동기화 7.1절) — 로컬 항목도
            rows = ctx.lib._all(
                f"select distinct on (rep_sha) * from (select p.id, p.folder_id, p.file_name, {REP_SHA} as rep_sha, "
                "p.deleted_at, p.storage, p.local_device_id, p.mode_pending, "
                "((p.storage = 'local' or p.mode_pending <> '') and (hd.id is null or hd.revoked_at is not null)) "
                f"as holder_gone from paperlab.papers p{_HOLDER_JOIN} where p.user_id = %s "
                f"and (p.source_sha256 = any(%s) or (p.source_sha256 = '' and p.pdf_sha256 = any(%s))) and {SYNC_TARGET}) x "
                "order by rep_sha, (deleted_at is not null), id", (ctx.uid, shas, shas))
        return {"found": {r["rep_sha"]: {"id": r["id"], "folder_id": r["folder_id"], "file_name": r["file_name"],
                                         "trashed": r["deleted_at"] is not None, "storage": r["storage"],
                                         "holder": r["local_device_id"], "holder_gone": bool(r["holder_gone"])}
                          for r in rows}}

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
            # 휴지통 · 남의 논문은 RLS로 안 보임
            info = ctx.lib._one(f"select {_PAPER_COLS} from paperlab.papers p{_HOLDER_JOIN} where p.id = %s "
                                "and p.user_id = %s", (pid, ctx.uid))
            if info and info["storage"] == "local":  # 로컬 항목은 받을 수 없음 — 그 항목만 실패 (선택 동기화 7.1절)
                out.append({"id": pid, "status": 409, "code": "local_only", "holder_name": info["holder_name"] or ""})
                continue
            if not info or not info["pdf_key"]:
                out.append({"id": pid, "status": 404, "code": "not_found"})
                continue
            kind = info["rep_kind"]  # source = 원본(원래 이름 · 확장자 그대로 — D-8), pdf = PDF
            signed = ctx.storage.sign_get(info["source_key"] if kind == "source" else info["pdf_key"])
            out.append({"id": pid, "url": signed["url"], "expires_at": signed["expires_at"],
                        "sha256": info["rep_sha"], "size": info["rep_size"], "kind": kind})
        return {"items": out}

    def read_upload(ctx, upload_id, sha: str, name: str) -> SimpleNamespace:
        """임시 파일 읽기 · 해시 확인(변환 전 원본) · 변환(워드 · 한글 · PPT · 엑셀 · 사진 → PDF, 웹 업로드와 같은 prepare_upload)
        · 추출 → (incoming = PDF 임시 키, data = PDF 내용, info, source = 원본 | None, raw_size, stored = R2에 늘 크기).
        name: PC 파일 이름 — .pdf가 아니면 내용이 PDF여도 원본으로 보관(선택 동기화 5.5절). 실패하면 SyncError — 임시
        파일은 요청이 실패로 끝날 때 지운다(read_incoming · prepare_upload가 ctx.on_rollback에 등록 — QA D8)"""
        if not is_upload_id(str(upload_id or "")):
            raise SyncError(400, "bad_request", "upload_id가 필요해요")
        incoming, raw, error = H.read_incoming(ctx, upload_id, name)
        if error:
            pdf_named = split_ext(name)[1].lower() == ".pdf"
            raise SyncError(400, "bad_pdf" if pdf_named or "100MB" in error else "bad_format",
                            error if pdf_named or "100MB" in error else "확장자와 파일 내용이 맞지 않아요")
        if hashlib.sha256(raw).hexdigest() != sha:
            raise SyncError(400, "sha_mismatch", "올린 파일의 해시가 달라요")
        try:
            pdf_incoming, data, info, source = H.prepare_upload(ctx, incoming, raw, name)
        except H.BadPdf:
            raise SyncError(400, "bad_pdf", "PDF를 열 수 없어요") from None
        except convert.ConvertError as e:
            msg = str(e)
            code = "no_converter" if msg == convert.NO_CONVERTER else "bad_format" if msg == convert.NOT_SUPPORTED \
                else "convert_failed"
            raise SyncError(400, code, msg) from None
        return SimpleNamespace(incoming=pdf_incoming, data=data, info=info, source=source, raw_size=len(raw),
                               stored=len(data) + (len(raw) if source else 0))

    # ------------------------------------------------------------ 새 파일 (9장 · K-16 · K-32 · 선택 동기화 7.1절)
    @route("files/add")
    def files_add(ctx, d, b):
        op = _op_id(b)
        prev = stored(ctx.lib, d, op)
        if prev:
            return prev
        sha, name = _sha(b.get("sha256")), _file_name(b.get("file_name"))
        storage = b.get("storage", "cloud")
        if storage not in STORAGES:
            raise SyncError(400, "bad_request", "storage는 cloud 또는 local이에요")
        if storage == "local" and b.get("upload_id") is not None:
            raise SyncError(400, "bad_request", "PC에만 두는 파일은 올리지 않아요(upload_id 없이)")
        folder = folder_arg(ctx.lib, b.get("folder_id"))
        at = _ms_time(b.get("mtime_ms"), b.get("clock_offset_ms"))
        copy_of = (d["name"], kst_day(at))
        if not S.try_add(ctx.uid):
            raise SyncError(429, "sync_busy", "다른 파일을 올리는 중이에요. 잠시 후 다시 보내 주세요")
        try:
            return add_file(ctx, d, b, op, sha, name, folder, at, copy_of, storage)
        finally:
            S.done_add(ctx.uid)

    def discard_on_fail(ctx, upload_id) -> None:
        """이 요청이 실패(롤백)로 끝나면 올려 둔 임시 파일을 지운다 — 저장 공간 검사 등 읽기 전 실패도 (QA D8).
        PC는 다시 보낼 때 새 업로드 자리를 받는다"""
        if is_upload_id(str(upload_id or "")):
            key = ctx.storage.incoming_key(str(upload_id))
            ctx.on_rollback.append(lambda: ctx.storage.delete_quietly(key))

    def drop_upload(ctx, upload_id) -> None:
        """올려 둔 임시 파일을 쓰지 않음 — 커밋 뒤 지운다(실패로 끝나면 discard_on_fail이 지움)"""
        if upload_id and is_upload_id(str(upload_id)):
            key = ctx.storage.incoming_key(str(upload_id))
            ctx.after_commit.append(lambda: ctx.storage.delete_quietly(key))

    def add_file(ctx, d, b, op, sha, name, folder, at, copy_of, storage):
        discard_on_fail(ctx, b.get("upload_id"))
        hit = _by_sha(ctx.lib, sha)
        if hit:  # 같은 해시 — 전송 0, 새 논문 0 (선택 동기화 "해시 일치 표")
            return link_or_restore(ctx, d, op, hit, folder, name, copy_of, b.get("upload_id"))
        size = _int(b.get("size"), 0) or 0
        # 그 자리의 실효 모드를 서버가 다시 판정 (5.4절 — 새 파일은 들어 있는 폴더의 설정을 따름, 루트는 켬)
        eff = ctx.lib.folder_effective(folder)
        if storage == "local" and eff == "cloud":
            raise SyncError(409, "upload_required", "이 폴더는 서버에도 저장하는 폴더예요. 파일을 올려 주세요",
                            paper_folder_mode="cloud")
        if eff == "local":  # 끔 폴더: 올렸어도 임시 파일을 지우고 로컬 항목으로
            drop_upload(ctx, b.get("upload_id"))
            return add_local(ctx, d, op, sha, name, folder, at, copy_of, size)
        check_room(ctx, size, papers=1)
        ctx.sources  # noqa: B018 - 사용자 설정(연락처 · API 키)을 먼저 읽어 둔다
        ctx.release()  # R2 받기 · 변환 · 추출 · 메타데이터 조회 동안 DB 연결을 잡지 않는다 (F9)
        H.system_sizes(ctx)  # 트랜잭션이 없는 지금 저장 공간 합계를 새로 (QA D7 — 아래 check_room은 이 값을 씀)
        up = read_upload(ctx, b.get("upload_id"), sha, name)
        if up.raw_size != size:  # 보낸 크기로 검사를 통과하고 더 큰 파일을 올리지 못하게 (QA D4)
            raise SyncError(400, "sha_mismatch", "올린 파일의 크기가 보낸 값과 달라요")
        # 예외로 끝나도 임시 파일은 on_rollback이 지움 (QA D9b). 문서 · 사진은 DOI · arXiv가 있을 때만 논문 정보를 찾음
        meta_, _ = H.metadata_from_pdf(ctx, up.info, document=bool(up.source))
        if not meta_.get("title"):
            meta_["title"] = split_ext(name)[0]
        lib = ctx.lib  # 새 트랜잭션: 그 사이 같은 해시가 생겼거나 폴더가 지워졌을 수 있음
        prev = stored(lib, d, op)
        if prev:
            return prev  # 임시 파일은 prepare_upload가 커밋 뒤 지우게 등록함
        hit = _by_sha(lib, sha)
        if hit:
            ctx.after_commit.append(lambda: ctx.storage.delete_quietly(up.incoming))
            return link_or_restore(ctx, d, op, hit, folder, name, copy_of, None)
        check_room(ctx, up.stored, papers=1)  # 실제 크기로 다시 (그 사이 다른 올리기로 줄었을 수도)
        if folder is not None and not lib.has_folder(folder):
            folder = None
        out: dict = {"result": "created"}
        dup = lib.find_duplicate(meta_.get("doi", ""), meta_.get("arxiv_id", ""), meta_.get("title", ""))
        if dup and not dup["has_pdf"] and dup["sync"]["storage"] == "cloud":
            pid = dup["id"]  # K-16: 같은 논문인데 PDF가 없으면 거기에 붙임 (로컬 항목에는 붙이지 않음 — D-3)
        else:
            if not dup:  # Q-4: 휴지통에 같은 논문(다른 PDF)이 있으면 새로 만들고 알려 줌
                tdup = lib.find_duplicate(meta_.get("doi", ""), meta_.get("arxiv_id", ""), meta_.get("title", ""),
                                          include_trash=True)
                if tdup and tdup.get("trashed"):
                    out["trashed_duplicate_id"] = tdup["id"]
            else:
                out["duplicate_id"] = dup["id"]  # 같은 논문 · 다른 파일 → 새 논문(화면에 "서재에 같은 논문이 있어요")
            pid = lib.add_paper(meta_)
        lib.place_paper(pid, folder, name, copy_of)
        H.attach_from_incoming(ctx, pid, up.incoming, up.data, up.info, device_id=d["id"], content_at=at, source=up.source)
        out["paper"] = _view(lib, pid)
        log.info("sync add device_id=%s paper=%s result=created", d["id"], pid)
        return remember(lib, d, op, out)

    def add_local(ctx, d, op, sha, name, folder, at, copy_of, size) -> dict:
        """끔 폴더의 새 파일 = 로컬 항목 (선택 동기화 7.1절 ④): 정보만 서버 — R2 쓰기 0 · 본문 0, 보관 PC = 이 기기.
        저장 공간 검사 없음, DB 검사는 편당 로컬 추정치로"""
        if size > MAX_PDF_BYTES:
            raise SyncError(400, "too_large", "파일이 너무 커요 (100MB 초과)")
        check_room(ctx, 0, local=1)
        lib = ctx.lib
        pid = lib.add_paper({"title": split_ext(name)[0], "item_type": "document"})
        lib.place_paper(pid, folder, name, copy_of)
        lib.set_local_file(pid, d["id"], sha, size, name, at)
        out = {"result": "created", "paper": _view(lib, pid)}
        log.info("sync add device_id=%s paper=%s result=created storage=local", d["id"], pid)
        return remember(lib, d, op, out)

    def link_or_restore(ctx, d, op, hit, folder, name, copy_of, upload_id) -> dict:
        """같은 PC 표현 해시의 논문이 있음 (선택 동기화 "해시 일치 표"): 켬 → linked, 로컬(보관 = 이 기기) → linked,
        로컬(보관 PC 해지 · 없음) → adopted, 로컬(보관 = 다른 활성 기기) → local_elsewhere(기록 안 함), 휴지통 → restored"""
        lib = ctx.lib
        drop_upload(ctx, upload_id)  # 올려 둔 임시 파일은 쓰지 않으므로 지움
        if hit["deleted_at"] is not None:  # K-32: 휴지통 논문을 보낸 자리로 되살림(하이라이트 · 노트 · 번역 그대로)
            lib.restore_papers([hit["id"]], places={hit["id"]: (folder, name, copy_of)})
            if hit["storage"] == "local":  # 로컬 항목이면 보관 PC = 이 기기
                lib._x("update paperlab.papers set local_device_id = %s where id = %s and user_id = %s",
                       (d["id"], hit["id"], lib.uid))
            ctx.after_commit.append(lambda: H.ensure_index(ctx.claims))
            result = "restored"
        elif hit["storage"] == "local" and hit["local_device_id"] != d["id"] and not hit["holder_gone"]:
            # D-9: 다른 PC에만 두기로 한 파일과 같음 — 연결하지 않음. 멱등 기록 안 함(나중에는 다른 결과일 수 있음)
            log.info("sync add device_id=%s paper=%s result=local_elsewhere", d["id"], hit["id"])
            return {"result": "local_elsewhere", "paper": _view(lib, hit["id"]), "holder_name": hit["holder_name"] or ""}
        else:
            if (hit["folder_id"], hit["file_name"]) != (folder, name):
                lib.place_paper(hit["id"], folder, name, copy_of)  # 위치가 다르면 나중 것(이번 것) 위치로 — 저장 위치는 그대로
            result = "linked"
            if hit["storage"] == "local" and hit["local_device_id"] != d["id"]:  # 보관 PC가 해지됐거나 없어짐 → 넘겨받음
                lib._x("update paperlab.papers set local_device_id = %s, mode_error = '' where id = %s and user_id = %s",
                       (d["id"], hit["id"], lib.uid))
                result = "adopted"
        out = {"result": result, "paper": _view(lib, hit["id"])}
        log.info("sync add device_id=%s paper=%s result=%s", d["id"], hit["id"], result)
        return remember(lib, d, op, out)

    # ------------------------------------------------------------ 내용 바뀜 (10장 U-1 · K-28 · 선택 동기화 7.1절)
    @route("files/{pid}/content")
    def content(ctx, d, b, pid):
        op = _op_id(b)
        prev = stored(ctx.lib, d, op)
        if prev:
            return prev
        sha, base = _sha(b.get("sha256")), _sha(b.get("base_sha256"))
        at = _ms_time(b.get("mtime_ms"), b.get("clock_offset_ms"))
        discard_on_fail(ctx, b.get("upload_id"))
        with ctx.lib.trash_tx():
            p = _paper(ctx.lib, pid) if _int(pid, 1) else None
        if not p or not (p["pdf_key"] or p["storage"] == "local"):
            raise SyncError(404, "gone", "논문을 찾을 수 없어요")
        if p["storage"] == "local":  # 로컬 항목: 보관 PC만, 업로드 없이 해시 · 크기 · 시각만 (충돌 없음 — 보관 PC 하나)
            return local_content(ctx, d, b, op, pid, sha, at)
        if p["rep_sha"] == sha and p["deleted_at"] is None:  # 이미 같은 내용 — 올려 둔 임시 파일은 지움
            drop_upload(ctx, b.get("upload_id"))
            return remember(ctx.lib, d, op, {"result": "replaced", "paper": paper_out(p), "translation_cleared": False})
        name = p["file_name"] or f"paper-{p['id']}.pdf"
        ctx.release()  # R2 받기 · 변환 · 추출 동안 DB 연결을 잡지 않는다 (F9)
        H.system_sizes(ctx)  # 트랜잭션이 없는 지금 저장 공간 합계를 새로 (QA D7)
        up = read_upload(ctx, b.get("upload_id"), sha, name)
        lib = ctx.lib
        prev = stored(lib, d, op)
        if prev:
            return prev  # 임시 파일은 prepare_upload가 커밋 뒤 지우게 등록함
        with lib.trash_tx():  # K-39: 휴지통 논문의 되살리기 · PDF 교체는 trash_tx 안에서
            p = _paper(lib, pid, lock=True)
            if not p or not p["pdf_key"]:
                raise SyncError(404, "gone", "논문을 찾을 수 없어요")  # 임시 파일은 on_rollback이 지움
            had = (p["pdf_size"] or 0) + (p["source_size"] or 0 if p["source_key"] else 0)
            if p["deleted_at"] is not None:
                check_room(ctx, up.stored - had)
                lib.restore_papers([pid])
                cleared = H.attach_from_incoming(ctx, pid, up.incoming, up.data, up.info, device_id=d["id"], content_at=at,
                                                 source=up.source)
                out = {"result": "restored", "paper": _view(lib, pid), "translation_cleared": cleared}
            elif p["rep_sha"] == base or p["rep_sha"] == sha:
                check_room(ctx, up.stored - had)
                cleared = H.attach_from_incoming(ctx, pid, up.incoming, up.data, up.info, device_id=d["id"], content_at=at,
                                                 source=up.source)
                out = {"result": "replaced", "paper": _view(lib, pid), "translation_cleared": cleared}
            else:
                out = conflict(ctx, d, p, up, at)
        log.info("sync content device_id=%s paper=%s result=%s", d["id"], pid, out["result"])
        return remember(lib, d, op, out)

    def local_content(ctx, d, b, op, pid, sha, at) -> dict:
        """로컬 항목의 내용 바뀜 (선택 동기화 7.1절): 보관 PC가 아니면 409 not_holder. 휴지통이면 되살림"""
        lib = ctx.lib
        with lib.trash_tx():
            p = _paper(lib, pid, lock=True)
            if not p or p["storage"] != "local":
                raise SyncError(409, "changed", "논문 상태가 바뀌었어요", paper=paper_out(p) if p else None)
            if p["local_device_id"] != d["id"]:
                raise SyncError(409, "not_holder", "이 파일을 가진 PC가 아니에요")
            size = _int(b.get("size"), 0)
            if size is None or size > MAX_PDF_BYTES:
                raise SyncError(400, "bad_request", "size가 올바르지 않아요")
            drop_upload(ctx, b.get("upload_id"))  # 로컬 항목은 올리지 않는다 — 보냈으면 쓰지 않고 지움
            result = "replaced"
            if p["deleted_at"] is not None:
                lib.restore_papers([pid])
                result = "restored"
            lib.set_local_file(pid, d["id"], sha, size, p["file_name"], at)
            out = {"result": result, "paper": _view(lib, pid), "translation_cleared": False}
        log.info("sync content device_id=%s paper=%s result=%s storage=local", d["id"], pid, result)
        return remember(lib, d, op, out)

    def conflict(ctx, d, p, up, at) -> dict:
        """10.2절 첫 줄: 나중 쪽이 원래 논문 · 원래 이름, 진 쪽 내용은 같은 폴더의 새 논문(충돌 사본).
        원본 표현(워드 · 한글 …)이면 사본에 원본도 복사하고 사본 이름은 원래 확장자 (선택 동기화 12장)"""
        lib = ctx.lib
        win = winner(at, p["content_at"])
        if win == "incoming":
            check_room(ctx, up.stored)  # 사본 = 옛 내용 크기, 원래 논문 = 새 내용 − 옛 내용 → 합계 +새 내용
            loser_dev = p["device_name"] or ("웹" if p["content_device_id"] is None else "PC")
            cid = _new_copy_paper(lib, p, loser_dev, kst_day(p["content_at"]))
            # 진 쪽 = 서버의 지금 내용: 덮어쓰기 **전에** 사본 키로 복사(12.1절 6번 · AC-632)
            key = ctx.storage.paper_key(cid)
            ctx.storage.storage.copy(ctx.storage.check(p["pdf_key"]), ctx.storage.check(key))
            ctx.on_rollback.append(lambda: ctx.storage.delete_quietly(key))  # 사본 논문이 롤백되면 고아 (QA D8)
            texts = lib.page_texts(p["id"])
            H.pdf_changed(ctx, cid, lib.set_pdf(cid, key, texts, p["pdf_sha256"], p["pdf_size"], p["content_device_id"],
                                                p["content_at"]))
            if p["source_key"]:  # 원본도 사본 키로 (원래 논문의 옛 원본은 attach가 커밋 뒤 지움)
                skey = ctx.storage.source_key(cid)
                ctx.storage.storage.copy(ctx.storage.check(p["source_key"]), ctx.storage.check(skey))
                ctx.on_rollback.append(lambda: ctx.storage.delete_quietly(skey))
                lib.set_source(cid, skey, p["source_name"], p["source_size"], p["source_sha256"])
            cleared = H.attach_from_incoming(ctx, p["id"], up.incoming, up.data, up.info, device_id=d["id"], content_at=at,
                                             source=up.source)
        else:
            check_room(ctx, up.stored)
            cid = _new_copy_paper(lib, p, d["name"], kst_day(at))
            H.attach_from_incoming(ctx, cid, up.incoming, up.data, up.info, device_id=d["id"], content_at=at,
                                   source=up.source)
            cleared = False
        return {"result": "conflict", "winner": win, "paper": _view(lib, p["id"]), "copy": _view(lib, cid),
                "translation_cleared": cleared}

    # ------------------------------------------------------------ 켜기 실행 (선택 동기화 5.3 · 7.1절)
    @route("files/{pid}/promote")
    def promote(ctx, d, b, pid):
        """보관 PC가 로컬 항목을 올림: to_cloud 대기 · 보관 PC = 이 기기 · 해시 = 서버 표현. 웹 업로드와 같은 처리
        (변환 · 추출 · page_texts · 색인 작업) → storage = 'cloud'. 사용자당 동시 1(files/add와 같은 자물쇠)"""
        op = _op_id(b)
        prev = stored(ctx.lib, d, op)
        if prev:
            return prev
        sha = _sha(b.get("sha256"))
        discard_on_fail(ctx, b.get("upload_id"))
        if not S.try_add(ctx.uid):
            raise SyncError(429, "sync_busy", "다른 파일을 올리는 중이에요. 잠시 후 다시 보내 주세요")
        try:
            def check(p):
                if not p or p["deleted_at"] is not None or p["storage"] != "local" or p["mode_pending"] != "to_cloud":
                    raise SyncError(409, "not_pending", "서버에 올리기로 한 파일이 아니에요")
                if p["local_device_id"] != d["id"]:
                    raise SyncError(409, "not_holder", "이 파일을 가진 PC가 아니에요")
                if p["rep_sha"] != sha:
                    raise SyncError(409, "changed", "파일 내용이 서버 기록과 달라요", paper=paper_out(p))

            with ctx.lib.trash_tx():
                p = _paper(ctx.lib, pid) if _int(pid, 1) else None
            check(p)
            name = p["file_name"]
            check_room(ctx, _int(b.get("size"), 0) or 0, papers=1)
            ctx.release()  # R2 받기 · 변환 · 추출 동안 DB 연결을 잡지 않는다 (F9)
            H.system_sizes(ctx)
            up = read_upload(ctx, b.get("upload_id"), sha, name)
            lib = ctx.lib
            prev = stored(lib, d, op)
            if prev:
                return prev
            with lib.trash_tx():
                p = _paper(lib, pid, lock=True)
            check(p)  # 그 사이 취소 · 넘겨받기 · 내용 바뀜
            check_room(ctx, up.stored, papers=1)  # 본문이 늘어나므로 새 논문과 같은 DB 기준 (db_full)
            lib.promote_to_cloud(pid)
            H.attach_from_incoming(ctx, pid, up.incoming, up.data, up.info, device_id=d["id"], content_at=p["content_at"],
                                   source=up.source)
            out = {"result": "promoted", "paper": _view(lib, pid)}
            log.info("sync promote device_id=%s paper=%s", d["id"], pid)
            return remember(lib, d, op, out)
        finally:
            S.done_add(ctx.uid)

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
        # 저장점이 되돌려지면 그 항목이 더한 커밋 뒤 할 일(예: mode.ack의 R2 삭제)도 버린다 — DB가 되돌려졌는데 파일만
        # 지워지는 일이 없게 (선택 동기화 D-2)
        n_after, n_back = len(ctx.after_commit), len(ctx.on_rollback)
        try:
            with lib.conn.transaction():  # 항목마다 저장점 — 한 항목 실패가 다른 항목을 막지 않음
                res = OPS.get(it.get("type"), op_unknown)(ctx, d, it)
                res = {"op_id": op, "ok": res.get("ok", True), **res}
                return remember(lib, d, op, res)
        except BaseException as e:
            undo = ctx.on_rollback[n_back:]
            del ctx.after_commit[n_after:], ctx.on_rollback[n_back:]
            ctx._run(undo)
            if isinstance(e, SyncError):
                return {"op_id": op, "ok": False, "result": "error", "code": e.code}
            if isinstance(e, DBUnavailable) or not isinstance(e, Exception):
                raise
            log.warning("sync op failed type=%s: %s", it.get("type"), type(e).__name__)  # 이름 겹침 경합 · CHECK 위반 등
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
        final = lib.free_folder_name(name, parent, exclude=fid)  # 겹치면 바꾸는 쪽을 ` (2)` (K-8)
        lib._x("update paperlab.folders set name = %s, parent_id = %s, updated_at = now() where id = %s and user_id = %s",
               (final, parent, fid, lib.uid))
        return {"result": "applied", "folder": folder_out(lib, fid)}

    def op_folder_delete(ctx, d, it):
        lib = ctx.lib
        fid = _int(it.get("id"), 1)
        if not fid or not lib.has_folder(fid):
            return {"result": "deleted"}  # 이미 없음 — 멱등
        busy = lib._one("select exists (select 1 from paperlab.papers p where p.user_id = %(u)s and p.folder_id = %(f)s "
                        f"and {SYNC_TARGET}) or exists (select 1 from paperlab.folders where user_id = %(u)s "
                        "and parent_id = %(f)s) as busy", {"u": lib.uid, "f": fid})["busy"]
        if busy:
            return {"ok": False, "result": "not_empty"}
        lib.delete_folder(fid)  # PDF 없는 논문은 부모로(웹 폴더 삭제와 같음) · 휴지통 논문은 외래 키가 폴더를 비움 · 묘비
        return {"result": "deleted"}

    def op_file_move(ctx, d, it):
        lib = ctx.lib
        pid = _int(it.get("id"), 1)
        p = lib._one(f"select p.id, p.folder_id, p.file_name from paperlab.papers p where p.id = %s and p.user_id = %s "
                     f"and {SYNC_TARGET}", (pid, lib.uid)) if pid else None
        if not p:
            return {"ok": False, "result": "gone"}  # 휴지통 · 없음
        name = _file_name(it.get("file_name"))
        if p["file_name"] and split_ext(name)[1].lower() != split_ext(p["file_name"])[1].lower():
            # PC 파일 이름의 확장자 = PC 표현(5.5절) — 확장자를 바꾸는 이동은 받지 않는다(bad_name)
            raise SyncError(400, "bad_name", "파일 확장자는 바꿀 수 없어요")
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
        if p["storage"] == "local" and p["local_device_id"] != d["id"]:
            # 로컬 항목은 보관 PC의 파일 — 다른 PC에 남은 옛 사본을 지운 것으로 서재 항목을 휴지통에 넣지 않는다 (D-4)
            return {"ok": False, "result": "not_holder"}
        if p["rep_sha"] != base:  # 바뀐 쪽이 삭제를 이김 (12.1절 4번) — PC 표현 해시로 비교
            return {"ok": False, "result": "changed", "paper": paper_out(p)}
        H.trash_papers(ctx, [pid], f"device:{d['id']}")
        return {"result": "trashed"}

    # ------------------------------------------------------------ 끄기 실행 · 확인 못 함 (선택 동기화 5.3 · 7.1절)
    def op_mode_ack(ctx, d, it):
        """보관 PC가 같은 해시의 파일을 가졌음을 확인 → 그때 서버가 R2 · 본문을 지운다 (D-2 — 서버가 먼저 지우지 않음)"""
        lib = ctx.lib
        pid = _int(it.get("id"), 1)
        sha = _sha(it.get("sha256"))
        with lib.trash_tx():
            p = _paper(lib, pid, lock=True) if pid else None
        if not p or p["deleted_at"] is not None or p["mode_pending"] != "to_local" or p["local_device_id"] != d["id"]:
            return {"ok": False, "result": "not_pending"}
        if p["source_key"] and not p["source_sha256"]:
            # 원본 해시를 모르는 옛 문서 행: PC에는 PDF 변환본뿐이라 지우면 원본이 어디에도 없다 → 지우지 않음
            # (sync_mode_plan이 대기를 만들지 않지만 이중 방어 — 유일한 사본을 지우지 않음)
            return {"ok": False, "result": "not_pending"}
        if p["rep_sha"] != sha:  # 그 사이 다른 PC가 내용을 바꿈 — 보관 PC는 받기로 맞춘 뒤 다시 확인
            return {"ok": False, "result": "changed", "paper": paper_out(p)}
        H.demote_paper(ctx, pid)
        log.info("sync mode ack device_id=%s paper=%s", d["id"], pid)
        return {"result": "applied", "paper": _view(lib, pid)}

    def op_mode_fail(ctx, d, it):
        """보관 PC가 끄기를 확인할 수 없음 → 이유만 남김(대기 유지 — 화면이 이유와 [취소]를 보임)"""
        lib = ctx.lib
        pid = _int(it.get("id"), 1)
        reason = it.get("reason")
        if reason not in MODE_FAIL_REASONS:
            raise SyncError(400, "bad_request", "reason이 올바르지 않아요")
        n = lib._x("update paperlab.papers set mode_error = %s where id = %s and user_id = %s and mode_pending = 'to_local' "
                   "and local_device_id = %s and deleted_at is null", (reason, pid, lib.uid, d["id"])).rowcount if pid else 0
        if not n:
            return {"ok": False, "result": "not_pending"}
        log.info("sync mode fail device_id=%s paper=%s reason=%s", d["id"], pid, reason)
        return {"result": "recorded"}

    OPS = {"folder.create": op_folder_create, "folder.update": op_folder_update, "folder.delete": op_folder_delete,
           "file.move": op_file_move, "file.delete": op_file_delete, "mode.ack": op_mode_ack, "mode.fail": op_mode_fail}
