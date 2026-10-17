"""원고 버전 기록 · 비교 · 되돌리기 (docs/specs/manuscript-history.md).

원고 자동 저장(PATCH /api/manuscripts/{id})은 content를 덮어쓴다. 덮어쓰기 전 글을 `manuscript_versions`(RLS)에 남긴다.
- auto     : 내용이 바뀌는 PATCH에서 마지막 기록이 10분보다 오래됐으면(또는 없으면) 바뀌기 **전** 글
- ai_apply : AI 글쓰기 결과를 넣기 직전 글 (화면이 넣기 직전 편집기 글을 보냄)
- restore  : 되돌리기 직전 지금 글
- manual   : [지금 버전 저장] (이름은 골라서)
마지막 기록과 같은 글(sha256)이면 새 행을 만들지 않는다.

보관(DB 500MB 무료 한도 — 4장 계산): 직접 저장(manual) · 이름 붙인 기록은 지우지 않는다
(원고마다 PINNED_MAX개 · 합계 PINNED_MAX_BYTES까지 — 넘으면 저장 · 이름 붙이기를 거절).
나머지(자동 · AI 넣기 전 · 되돌리기 전)는 최근 KEEP_RECENT개 + 그보다 오래된 것은 DAILY_DAYS일 동안 하루(한국 날짜)에 하나,
그리고 원고마다 그 합계가 AUTO_MAX_BYTES 안 (넘으면 오래된 것부터 — 가장 최근 하나는 늘 남김).
DB가 한도의 90%(server.DB_LEVEL)를 넘으면 자동 기록은 건너뛰고 직접 저장은 거절한다(되돌리기 전 기록은 늘 남김).
"""

from __future__ import annotations

import hashlib
import logging
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import Body, FastAPI, HTTPException

from . import jobs
from .db import Library, _clean_text, _row, now_dt

log = logging.getLogger("paperlab.versions")

REASONS = ("auto", "ai_apply", "restore", "manual")
CLIENT_REASONS = ("manual", "ai_apply")          # 화면이 직접 만들 수 있는 기록
SNAPSHOT_EVERY = timedelta(minutes=10)           # 자동 기록 간격 (편집하는 동안)
KEEP_RECENT = 30                                 # 자동 기록: 최근 이만큼은 모두
DAILY_DAYS = 30                                  # 그보다 오래된 자동 기록: 이 기간 하루에 하나
AUTO_MAX_BYTES = 5 * 1024 ** 2                   # 원고 하나의 자동 기록 합계 상한 (UTF-8 바이트, 압축 전)
PINNED_MAX = 50                                  # 원고 하나의 직접 저장 · 이름 붙인 기록 수
PINNED_MAX_BYTES = 10 * 1024 ** 2                # 원고 하나의 직접 저장 · 이름 붙인 기록 합계 (UTF-8 바이트)
CONTENT_MAX_BYTES = 4 * 1024 ** 2                # 기록 하나의 상한 (화면이 보내는 글 · 자동 기록)
LABEL_MAX = 60
LIST_MAX = 200
KST = timezone(timedelta(hours=9))
_LABEL_BAD = re.compile(r"[\x00-\x1f\x7f-\x9f  ]")
META_COLS = "id, manuscript_id, reason, label, size, chars, created_at"

PINNED_FULL = (f"직접 저장하거나 이름 붙인 버전은 원고마다 {PINNED_MAX}개까지예요. "
               "안 쓰는 버전을 지운 뒤 다시 저장해 주세요")
PINNED_BIG = ("직접 저장하거나 이름 붙인 버전이 원고마다 10MB를 넘을 수 없어요. "
              "안 쓰는 버전을 지우거나 이름을 뺀 뒤 다시 저장해 주세요")
DB_FULL ="저장 공간이 거의 차서 버전을 저장할 수 없어요. 관리자에게 알려 주세요"
TOO_BIG = "원고가 너무 커서 버전으로 저장할 수 없어요 (4MB까지)"
NOT_FOUND = "버전을 찾을 수 없어요"


class VersionError(Exception):
    """화면에 400으로 보낼 오류 (문구 그대로)"""


# ====================================================================== 순수 함수
def digest(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def clean_label(value) -> str:
    """버전 이름: 문자열 · NFC · 앞뒤 공백 제거 · 제어 문자 없음 · 60자 이하. 아니면 VersionError"""
    if value is None:
        return ""
    if not isinstance(value, str):
        raise VersionError("버전 이름은 글자로 적어 주세요")
    s = unicodedata.normalize("NFC", value).strip()
    if _LABEL_BAD.search(s):
        raise VersionError("버전 이름에 줄바꿈 같은 제어 문자는 쓸 수 없어요")
    if len(s) > LABEL_MAX:
        raise VersionError(f"버전 이름은 {LABEL_MAX}자까지 쓸 수 있어요")
    return s


def thin_ids(rows: list[dict], now: datetime) -> list[int]:
    """자동 기록(직접 저장 · 이름 붙인 것 제외) [{id, created_at, size}] 최신순 → 지울 id 목록.
    최근 KEEP_RECENT개는 모두 · 그보다 오래된 것은 DAILY_DAYS일 안에서 한국 날짜마다 가장 최근 하나 ·
    남긴 것의 합계가 AUTO_MAX_BYTES를 넘으면 그 뒤(더 오래된 것)는 모두 지운다(가장 최근 하나는 늘 남김)"""
    keep: list[dict] = []
    drop: list[int] = []
    days: set = set()
    for i, r in enumerate(rows):
        day = r["created_at"].astimezone(KST).date()
        if i < KEEP_RECENT or (now - r["created_at"] <= timedelta(days=DAILY_DAYS) and day not in days):
            keep.append(r)
            days.add(day)
        else:
            drop.append(r["id"])
    total = 0
    for i, r in enumerate(keep):
        total += int(r["size"] or 0)
        if i and total > AUTO_MAX_BYTES:
            drop.append(r["id"])
    return drop


def due(last: dict | None, now: datetime) -> bool:
    """자동 기록을 남길 때인가 (마지막 기록이 없거나 SNAPSHOT_EVERY보다 오래됨)"""
    return last is None or now - last["created_at"] >= SNAPSHOT_EVERY


def meta(row: dict) -> dict:
    m = _row({k: row[k] for k in ("id", "reason", "label", "size", "chars", "created_at")})
    m["pinned"] = row["reason"] == "manual" or bool(row["label"])
    return m


# ====================================================================== DB (사용자 트랜잭션 — RLS + user_id 조건)
def latest(lib: Library, mid: int) -> dict | None:
    return lib._one("select id, sha256, created_at, reason, label from paperlab.manuscript_versions "
                    "where user_id = %s and manuscript_id = %s order by created_at desc, id desc limit 1", (lib.uid, mid))


def list_versions(lib: Library, mid: int) -> list[dict]:
    return [meta(r) for r in lib._all(
        f"select {META_COLS} from paperlab.manuscript_versions where user_id = %s and manuscript_id = %s "
        "order by created_at desc, id desc limit %s", (lib.uid, mid, LIST_MAX))]


def get_version(lib: Library, mid: int, vid: int) -> dict | None:
    if not jobs.valid_id(vid):
        return None
    row = lib._one(f"select {META_COLS}, content from paperlab.manuscript_versions "
                   "where id = %s and user_id = %s and manuscript_id = %s", (vid, lib.uid, mid))
    return row and {**meta(row), "content": row["content"]}


def pinned_usage(lib: Library, mid: int) -> tuple[int, int]:
    """원고의 직접 저장 · 이름 붙인 기록 (개수, 바이트 합계)"""
    r = lib._one("select count(*)::int as n, coalesce(sum(size), 0)::bigint as b from paperlab.manuscript_versions "
                 "where user_id = %s and manuscript_id = %s and (reason = 'manual' or label <> '')", (lib.uid, mid))
    return r["n"], int(r["b"])


def check_pinned_room(lib: Library, mid: int, size: int) -> None:
    """직접 저장 · 이름 붙인 기록을 하나(size 바이트) 더 둘 자리가 없으면 VersionError"""
    n, used = pinned_usage(lib, mid)
    if n >= PINNED_MAX:
        raise VersionError(PINNED_FULL)
    if used + size > PINNED_MAX_BYTES:
        raise VersionError(PINNED_BIG)


def thin(lib: Library, mid: int, now: datetime | None = None) -> int:
    rows = lib._all("select id, created_at, size from paperlab.manuscript_versions where user_id = %s and manuscript_id = %s "
                    "and reason <> 'manual' and label = '' order by created_at desc, id desc", (lib.uid, mid))
    drop = thin_ids(rows, now or now_dt())
    if drop:
        lib._x("delete from paperlab.manuscript_versions where user_id = %s and id = any(%s)", (lib.uid, drop))
    return len(drop)


def snapshot(lib: Library, mid: int, content: str, reason: str, label: str = "") -> tuple[dict, bool]:
    """기록 하나 → (meta, 새로 만들었는지). 마지막 기록과 같은 글이면 그 기록을 돌려준다
    (직접 저장은 마지막 기록이 직접 저장 · 이름 붙인 것일 때만 — 자동 기록 위에 [지금 버전 저장]은 따로 남김)"""
    assert reason in REASONS
    content = _clean_text(content)
    if len(content.encode("utf-8")) > CONTENT_MAX_BYTES:
        raise VersionError(TOO_BIG)
    size = len(content.encode("utf-8"))
    sha = digest(content)
    last = latest(lib, mid)
    pin = reason == "manual" or bool(label)
    # 같은 글: 이름이 없거나 같은 이름이면 그 기록을 돌려준다(이름 없는 기록에만 새 이름을 붙임).
    # 이미 다른 이름이 붙은 기록이면 그 이름을 지우지 않고 아래에서 새 기록을 만든다
    if last and last["sha256"] == sha and (not pin or last["reason"] == "manual" or last["label"]) \
            and (not label or last["label"] in ("", label)):
        if label and not last["label"]:  # 여기 오는 건 이름 없는 직접 저장뿐 (이미 직접 저장 수에 들어 있음)
            lib._x("update paperlab.manuscript_versions set label = %s where id = %s and user_id = %s",
                   (label, last["id"], lib.uid))
        return get_meta(lib, last["id"]), False
    if pin:
        check_pinned_room(lib, mid, size)
    # size · chars는 DB CHECK가 octet_length · char_length와 같은지 확인한다
    row = lib._one(f"insert into paperlab.manuscript_versions (user_id, manuscript_id, reason, label, content, size, chars, "
                   f"sha256, created_at) values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning {META_COLS}",
                   (lib.uid, mid, reason, label, content, size, len(content), sha, now_dt()))
    if not pin:
        thin(lib, mid)
    return meta(row), True


def get_meta(lib: Library, vid: int) -> dict:
    return meta(lib._one(f"select {META_COLS} from paperlab.manuscript_versions where id = %s and user_id = %s",
                         (vid, lib.uid)))


def on_patch(lib: Library, m: dict, new_content, room) -> bool:
    """PATCH content 직전: 글이 바뀌고 마지막 기록이 10분보다 오래됐으면 바뀌기 전 글(m["content"])을 auto로 남긴다.
    room(): DB에 자리가 있는지 (기록할 때만 부름). 남겼으면 True"""
    if new_content is None:
        return False
    old = m.get("content") or ""
    if _clean_text(str(new_content)) == old or not old.strip():
        return False
    last = latest(lib, m["id"])
    if not due(last, now_dt()) or (last and last["sha256"] == digest(old)):
        return False
    if len(old.encode("utf-8")) > CONTENT_MAX_BYTES:
        return False
    if not room():
        log.warning("version skipped: db nearly full user=%s", lib.uid)
        return False
    snapshot(lib, m["id"], old, "auto")
    return True


# ====================================================================== API
def register(app: FastAPI, Ctx, H: SimpleNamespace) -> None:
    """H: need_manuscript(ctx, mid) · db_room(ctx) → bool · md_title(content) → str"""

    def need_version(ctx, mid: int, vid: int) -> dict:
        v = get_version(ctx.lib, mid, vid)
        if not v:
            raise HTTPException(404, NOT_FOUND)
        return v

    @app.get("/api/manuscripts/{mid}/versions")
    def versions_list(mid: int, ctx=Ctx):
        H.need_manuscript(ctx, mid)
        return {"items": list_versions(ctx.lib, mid), "pinned_max": PINNED_MAX,
                "every_minutes": int(SNAPSHOT_EVERY.total_seconds() // 60)}

    @app.get("/api/manuscripts/{mid}/versions/{vid}")
    def versions_get(mid: int, vid: int, ctx=Ctx):
        H.need_manuscript(ctx, mid)
        return need_version(ctx, mid, vid)

    @app.post("/api/manuscripts/{mid}/versions")
    def versions_add(mid: int, data: dict = Body(default={}), ctx=Ctx):
        """{label?, reason?: manual(기본) | ai_apply, content?: 이 글을 남김(없으면 저장된 원고)}"""
        m = H.need_manuscript(ctx, mid)
        reason = data.get("reason") or "manual"
        if reason not in CLIENT_REASONS:
            raise HTTPException(400, "알 수 없는 버전 종류예요")
        content = data.get("content")
        if content is None:
            content = m["content"] or ""
        elif not isinstance(content, str):
            raise HTTPException(400, "원고 글이 올바르지 않아요")
        if len(content.encode("utf-8")) > CONTENT_MAX_BYTES:
            raise HTTPException(400, TOO_BIG)
        try:
            label = clean_label(data.get("label"))
            if not H.db_room(ctx):
                raise VersionError(DB_FULL)
            v, created = snapshot(ctx.lib, mid, content, reason, label)
        except VersionError as e:
            raise HTTPException(400, str(e)) from None
        return {**v, "created": created}

    @app.patch("/api/manuscripts/{mid}/versions/{vid}")
    def versions_label(mid: int, vid: int, data: dict = Body(...), ctx=Ctx):
        """{label}: 이름 붙이기(붙인 기록은 자동 정리에서 빠짐) · '' 이면 이름 빼기"""
        H.need_manuscript(ctx, mid)
        v = need_version(ctx, mid, vid)
        try:
            label = clean_label(data.get("label"))
            if label and not v["pinned"]:
                check_pinned_room(ctx.lib, mid, int(v["size"] or 0))
        except VersionError as e:
            raise HTTPException(400, str(e)) from None
        ctx.lib._x("update paperlab.manuscript_versions set label = %s where id = %s and user_id = %s",
                   (label, vid, ctx.uid))
        return get_meta(ctx.lib, vid)

    @app.delete("/api/manuscripts/{mid}/versions/{vid}")
    def versions_delete(mid: int, vid: int, ctx=Ctx):
        H.need_manuscript(ctx, mid)
        need_version(ctx, mid, vid)
        ctx.lib._x("delete from paperlab.manuscript_versions where id = %s and user_id = %s and manuscript_id = %s",
                   (vid, ctx.uid, mid))
        return {"ok": True}

    @app.post("/api/manuscripts/{mid}/versions/{vid}/restore")
    def versions_restore(mid: int, vid: int, data: dict = Body(default={}), ctx=Ctx):
        """{current?: 화면 편집기 글} 지금 글을 restore 기록으로 남긴 뒤 원고를 그 버전 글로 바꾼다 (같은 글이면 그대로).
        current: 자동 저장이 실패했어도 화면에만 있던 글이 기록에 남도록 화면이 보낸다 (저장된 글과 다르면 둘 다 남김)"""
        m = H.need_manuscript(ctx, mid)
        v = need_version(ctx, mid, vid)
        stored = m["content"] or ""
        current = data.get("current")
        if current is not None and not isinstance(current, str):
            raise HTTPException(400, "원고 글이 올바르지 않아요")
        cur = stored if current is None else _clean_text(current)
        backup = None
        if v["content"] != cur or v["content"] != stored:
            # 되돌리기 전 글은 DB 공간 · 개수 상한과 상관없이 남긴다(되돌리기를 되돌릴 수 있게). 못 남기면 되돌리지 않음.
            # 저장된 글 먼저, 화면 글을 나중에(가장 최근 기록 = 화면 글) — 같은 글은 snapshot이 한 번만 남김
            try:
                for text in dict.fromkeys((stored, cur)):
                    if text.strip() and text != v["content"]:
                        backup, _ = snapshot(ctx.lib, mid, text, "restore")
            except VersionError as e:
                raise HTTPException(400, str(e)) from None
            if v["content"] != stored:
                ctx.lib.update_manuscript(mid, {"content": v["content"], "title": H.md_title(v["content"]) or None})
        after = ctx.lib.get_manuscript(mid)
        return {"ok": True, "changed": v["content"] != cur, "content": after["content"], "title": after["title"],
                "updated_at": after["updated_at"], "backup": backup, "restored": {k: v[k] for k in v if k != "content"}}
