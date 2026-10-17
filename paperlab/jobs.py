"""작업 큐 · 연결된 PC · 엔진 라우팅 (2단계 명세 5 · 6 · 9 · 12장).

모든 함수는 **사용자 권한 트랜잭션**(`Library` — 검증된 JWT 또는 `db.actor_claims`)의 연결로만 읽고 쓴다(RLS + user_id 조건).
예외는 연결 코드 찾기(`find_pair_code`)와 API 실행기 복구 스캔뿐이며, 둘 다 호출하는 쪽이 `system_tx`로 연다(5.6절).
상태 기계(6.1절): queued → running → succeeded | failed | cancelled, running → queued(폴백 · 다른 PC · 리스 만료).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from psycopg.types.json import Jsonb

from . import ai, explain, find, rag, translate, verify
from .config import ENGINES, JOB_KINDS, UserSettings, redact
from .convert import IMAGE_EXTS
from .db import LOCAL_ONLY_CANCELLED, LOCAL_TEXT_EXTS, PAPER_TRASHED, REP_SHA, REP_SIZE, Library, iso, now_dt

log = logging.getLogger("paperlab.jobs")

# ---------------------------------------------------------------- 수치 (가정 — K6 · K17 · U7 · U9)
LEASE_S = 90            # 리스 (하트비트 3번을 놓치면 만료). 테스트는 이 값을 바꿔 짧게 만든다
HEARTBEAT_S = 30
MAX_ATTEMPTS = 3        # CLI 잡기 횟수(재할당 포함)
API_MAX_ATTEMPTS = 2    # 같은 API 칸 다시 실행 한도 (15.2절)
# CLI 대기 기한 (확정 U7 · 3단계 14.2절 · 4단계 K-7). 2026-10-17 제품 책임자: 백그라운드 작업은 창을 닫아도 계속되므로
# 대화 · 글쓰기 · 찾기 · 설명 · 번역도 요약처럼 24시간 — 30분이면 PC를 켜기 전에 조용히 실패했다("30분 켜 놓고 닫으면 사라진다").
# 실행 중 시간 제한(TIMEOUT_S) · 리스는 그대로
DEADLINE_S = {k: 24 * 3600 for k in ("summary", "chat", "write", "find", "verify", "explain", "translate",
                                     "translate_paper", "ms_chat")}
TIMEOUT_S = {"summary": 1200, "chat": 600, "write": 600, "find": 600, "verify": 1200,  # CLI 시간 제한 (11.5절)
             "explain": 600, "translate": 600, "translate_paper": 900,                # 4단계 (전체 번역은 묶음당)
             "ms_chat": 600}                                                          # 원고 AI 대화 (mschat.py)
# index는 서버 안 색인(엔진 local), translate_paper(전체 번역)는 translate 엔진 설정을 씀 — 작업별 엔진 설정에는 없음.
# ms_chat(원고 AI 대화 — mschat.py)은 글쓰기(write) 엔진 순서를 따른다
ALL_KINDS = JOB_KINDS + ("index", "translate_paper", "ms_chat")
ROUTE_KIND = {"translate_paper": "translate", "ms_chat": "write"}
EXPLAIN_KINDS = explain.KINDS
# 전체 번역은 다시 대기 · 잡기 때도 진행(쪽 수)을 남긴다 — 화면이 counts로 번역 보기를 새로 받음 (4단계 6.3절 6번)
_KEEP_PROGRESS = "progress = case when kind = 'translate_paper' then progress else '{}'::jsonb end"
FIND_KEEP_HOURS = 24                 # AI로 찾기 질문 · 결과는 24시간 뒤 비움 (K-11)
ABS_GRACE_S = 300       # 서버 쪽 절대 기한 = 이번 잡기 + 시간 제한 + 5분 (11.5절)
MAX_ACTIVE_JOBS = 30
MAX_DEVICES = 10
PAIR_TTL_S = 600
ONLINE_S = 180          # 3분 안에 접속하면 켜짐 (5.1절)
SEEN_EVERY_S = 50       # last_seen_at 쓰기 간격
POLL_IDLE_S, POLL_ACTIVE_S = 60, 5
ACTIVE_WINDOW_S = 600   # 화면 요청이 최근 10분 안에 있었으면 활동 간격
PROMPT_MAX = 4 * 1024 * 1024
RESULT_TEXT_MAX = 2 * 1024 * 1024
PARTIAL_MAX = 64 * 1024
PARAMS_MAX = 64 * 1024
HISTORY_MAX = 20
ERROR_MAX = 2000
# 글쓰기 결과는 7일 — 작업 화면 "최근 7일"과 원고 화면에서 나중에 열어 넣을 수 있게 (2026-10-16 백그라운드 AI)
KEEP_DONE_DAYS, REVOKED_KEEP_DAYS, WRITE_RESULT_HOURS = 30, 30, 7 * 24
MIN_PROTOCOL = 1
MIN_APP_VERSION = "0.2.0"   # 작업 프로토콜이 깨지는 변경 때만 올림 (8.3절)

PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # 0 · O · 1 · I · L 뺌 (AC-16 정규식과 같은 31자)
TOKEN_RE = re.compile(r"pld1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([1-9][0-9]{0,17})\.([A-Za-z0-9_-]{43})")

# 9.6 · 11.8절 실패 판정
FALLBACK_CODES = {"api_auth", "api_permission", "api_rate_limit", "api_overloaded", "api_server", "api_connection",
                  "api_timeout", "api_bad_request", "api_no_key", "cli_usage_limit", "cli_exit"}
RELOCATE_CODES = {"cli_not_found", "cli_not_logged_in"}   # 이 PC만 빼고 같은 칸에서 다시 대기
# 로컬 항목 AI(selective-sync.md 7.4절): 보관 PC 워커가 로컬 파일을 읽지 못함 — 다시 시도 · 다른 칸 넘김 없음
# (RELOCATE · FALLBACK에 넣지 않음). bad_input · input_too_large: 표지 바꾸기 실패 · 바꾼 프롬프트가 4MB 넘음
LOCAL_CODES = {"local_file", "local_unsupported", "local_unreadable", "local_no_text"}
WORKER_CODES = RELOCATE_CODES | LOCAL_CODES | {"cli_usage_limit", "cli_model", "cli_timeout", "cli_bad_output", "cli_exit",
                                               "output_too_large", "bad_input", "input_too_large"}
KEY_ERROR_CODES = {"api_auth", "api_permission"}          # 설정 "최근 실패"에 남기는 오류 (7.3절)
DEFAULT_ERRORS = {
    "cli_not_found": "이 PC에 실행 파일이 없어요",
    "cli_not_logged_in": "이 PC의 CLI가 로그인돼 있지 않아요",
    "cli_usage_limit": "이 계정의 CLI 사용 한도에 걸렸어요",
    "cli_model": "선택한 CLI 모델을 쓸 수 없어요",
    "cli_timeout": "시간 제한 안에 끝나지 않았어요",
    "cli_bad_output": "CLI 결과를 읽지 못했어요",
    "cli_exit": "CLI가 오류로 끝났어요",
    "output_too_large": "결과가 너무 길어요",
    "lease_exhausted": "PC 연결이 계속 끊겨서 멈췄어요",
    "no_worker_timeout": "켜진 PC가 없어서 작업을 끝내지 못했어요",
    "input_too_large": "논문 본문이 너무 길어서 CLI로 보낼 수 없어요",
    "apply_failed": "결과를 저장하지 못했어요",
    "index_failed": "색인하지 못한 논문이 있어요",
    "search_failed": find.SEARCH_FAILED,
    "pdf_changed": translate.PDF_CHANGED,
    "paper_trashed": PAPER_TRASHED,
    "bad_input": "작업 내용을 만들지 못했어요",
    # 선택 동기화 (selective-sync.md 10.9절)
    "local_file": "이 PC에서 파일을 찾지 못했어요(옮겼거나 고치는 중일 수 있어요). 잠시 뒤 다시 해 주세요.",
    "local_unsupported": "옛 파워포인트(.ppt) · 엑셀(.xls) · RTF 파일은 이 PC에서 내용을 읽지 못해 AI를 쓸 수 없어요. "
                         "[동기화 켜기]로 서버에도 저장하면 AI를 쓸 수 있어요. (.pptx · .xlsx · .docx로 다시 저장해도 돼요.)",
    "local_unreadable": "이 파일의 내용을 읽지 못했어요(손상 · 암호 · 배포용 문서이거나 너무 커요). "
                        "[동기화 켜기]로 서버에 올리면 서버에서 다시 읽어 볼 수 있어요.",
    "local_no_text": "이 파일에서 글자를 읽지 못했어요(사진 · 스캔본).",
    "local_only": LOCAL_ONLY_CANCELLED,
}
LOCAL_UNSUPPORTED_IMAGE = "사진(이미지)은 글자를 읽지 않아요. AI 요약 · 질문은 쓸 수 없어요."
LOCAL_AI_KINDS = ("summary", "chat")  # 로컬 항목은 요약 · 논문 대화만 보관 PC CLI로 (D-13)
LOCAL_ONLY_AI = ("이 PC에만 있는 파일은 선택 설명 · 번역을 쓸 수 없어요. [동기화 켜기]로 서버에 올리면 쓸 수 있어요")
LOCAL_CAP = "local_text"  # 잡기 요청 caps — 로컬 본문을 채울 수 있는 워커(0.4.0)


def local_unsupported_message(file_name: str) -> str:
    """로컬 항목 AI를 만들기 전에 거절할 때의 문구(확장자별 — 10.9절)"""
    ext = (file_name or "").rsplit(".", 1)[-1].lower() if "." in (file_name or "") else ""
    return LOCAL_UNSUPPORTED_IMAGE if f".{ext}" in IMAGE_EXTS else DEFAULT_ERRORS["local_unsupported"]


def no_route_local_message(holder_name: str, gone: bool) -> str:
    if gone:
        return "연결이 해지된 PC에만 있던 파일이라 AI를 쓸 수 없어요"
    return (f"이 파일은 ‘{holder_name or 'PC'}’에만 있어서 그 PC의 AI(Claude · Codex · Gemini CLI)로만 요약할 수 있어요. "
            "그 PC의 PaperLab 앱에서 AI 도구를 연결해 주세요")


_DIGIT_JONG = (1, 8, 0, 1, 0, 0, 1, 8, 1, 0)  # 영 일 이 삼 사 오 육 칠 팔 구 → 0 없음, 1 있음, 8 ㄹ


def josa(word: str, pair: str) -> str:
    """조사: josa("‘노트북’", "이/가") → "‘노트북’이" (static/js/ui.js josa와 같은 규칙). 앞 = 받침 있을 때, 뒤 = 없을 때.
    "으로/로"는 ㄹ 받침도 "로". 끝의 따옴표 · 괄호는 건너뛰고 본다. 모르면 "이(가)"처럼 둘 다"""
    w = str(word or "")
    with_j, no_j = pair.split("/")
    ch = re.sub(r"[\s'\"’”)\]}>」』…·.,!?]+$", "", w)[-1:]
    jong = None  # 0 없음 · 1 있음 · 8 ㄹ
    if "가" <= ch <= "힣":
        j = (ord(ch) - 0xAC00) % 28
        jong = 0 if j == 0 else 8 if j == 8 else 1
    elif ch.isascii() and ch.isdigit():
        jong = _DIGIT_JONG[int(ch)]
    elif ch.isascii() and ch.isalpha():
        tail = re.findall(r"[A-Za-z]+", w)[-1]
        if tail.isupper():  # 약어는 글자 이름(엘 · 엠 · 엔 · 알)
            jong = (8 if tail[-1] in "LR" else 1) if tail[-1] in "LMNR" else 0
        else:
            jong = 1 if re.search(r"(ng|[mnkptbdg])$", tail, re.I) else 8 if tail[-1] in "lL" else 0
    if jong is None:
        return f"{w}{with_j}({no_j})"
    use_no = jong != 1 if with_j == "으로" else jong == 0
    return w + (no_j if use_no else with_j)


# 화면에 붙어 있던(SSE) 작업이 서버 재시작으로 끊김 — 화면을 닫는 것만으로는 멈추지 않는다(2026-10-16 백그라운드 AI)
INTERRUPTED = "서버가 다시 시작돼 작업이 멈췄어요. 다시 시도해 주세요"
# 재시작 없이 리스(660초)가 지남 — 응답이 너무 오래 걸림. 둘 다 error_code는 interrupted
LEASE_TIMEOUT = "응답이 너무 오래 걸려 작업을 멈췄어요. 다시 시도해 주세요"
# 이 서버 프로세스가 시작한 시각: 리스가 지난 화면 작업을 그 전에 잡았으면 재시작으로 끊긴 것 (create_app이 mark_started)
STARTED_AT = datetime.now(timezone.utc)


def mark_started() -> None:
    global STARTED_AT
    STARTED_AT = datetime.now(timezone.utc)


def interrupted_message(leased_at) -> str:
    return INTERRUPTED if leased_at is None or leased_at < STARTED_AT else LEASE_TIMEOUT
# AI는 내 PC(연결된 PC 앱 워커)의 CLI 또는 내가 넣은 API 키로만 실행한다 — 서버 PC의 CLI · 서버 환경의 키는 쓰지 않음
# (2026-10-16 제품 책임자 결정). 두 경로가 모두 없을 때 API 오류 · 화면 안내에 같은 문구
NO_ROUTE = ("AI를 실행할 방법이 없어요. 설정 → 연결된 PC에서 PaperLab 앱을 설치한 내 PC를 연결하거나, "
            "설정 → AI 엔진에서 내 API 키를 넣어 주세요. (서버의 CLI · 키는 쓰지 않아요)")
# 팀장 결정 Q2a-1: 설치 파일이 아직 없으면(2a 동안) 키 등록만 안내
NO_ROUTE_SOON = ("AI를 실행할 방법이 없어요. 설정 → AI 엔진에서 내 API 키를 넣어 주세요. "
                 "(PC 앱 연결은 곧 지원돼요 · 서버의 CLI · 키는 쓰지 않아요)")


def no_route_message(has_release: bool) -> str:
    return NO_ROUTE if has_release else NO_ROUTE_SOON


class JobError(Exception):
    """화면 · 워커에 그대로 보낼 오류 (status, detail, code)"""

    def __init__(self, status: int, detail: str, code: str = ""):
        super().__init__(detail)
        self.status, self.detail, self.code = status, detail, code


class LeaseLost(JobError):
    def __init__(self):
        super().__init__(409, "이 작업은 더 이상 이 PC의 것이 아니에요", "lease_lost")


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def mask_email(email: str) -> str:
    """a***@example.com (화면 dialogs.js의 같은 규칙과 비교 — 디자인 16장 요청 8)"""
    local, at, domain = (email or "").partition("@")
    return f"{local[:1]}***@{domain}" if at and local else ""


def version_tuple(v: str) -> tuple:
    m = re.match(r"(\d{1,6})\.(\d{1,6})\.(\d{1,6})", str(v or ""))
    return tuple(int(x) for x in m.groups()) if m else (0, 0, 0)


def update_required(app_version: str) -> bool:
    return version_tuple(app_version) < version_tuple(MIN_APP_VERSION)


def clean_error(text) -> str:
    return redact(str(text or ""))[:ERROR_MAX]


def _history_entry(job: dict, code: str, device_id=None) -> dict:
    return {"runner": job["runner"], "engine": job["engine"], "device_id": device_id, "error_code": code,
            "at": iso(now_dt())}


def _history(job: dict, entry: dict) -> Jsonb:
    return Jsonb((list(job.get("history") or []) + [entry])[-HISTORY_MAX:])


# ====================================================================== 기기
_DEVICE_SELECT = """
select d.id, d.name, d.engines, d.app_version, d.os, d.paused, d.last_seen_at, d.revoked_at, d.created_at,
       (d.revoked_at is null and d.last_seen_at > now() - make_interval(secs => %(online)s)) as online,
       (select count(*) from paperlab.jobs j where j.user_id = d.user_id and j.device_id = d.id
         and j.status = 'running')::int as running_jobs,
       (select jsonb_build_object('enabled', s.enabled, 'state', s.state, 'root_label', s.root_label,
                                  'last_sync_at', s.last_sync_at, 'counts', s.counts, 'protocol', s.protocol)
          from paperlab.sync_devices s where s.device_id = d.id and s.user_id = d.user_id) as sync,
       (select jsonb_build_object('n', count(*), 'bytes', coalesce(sum(coalesce(""" + REP_SIZE + """, 0)), 0))
          from paperlab.papers p where p.user_id = d.user_id and p.local_device_id = d.id and p.storage = 'local') as local
  from paperlab.devices d where d.user_id = %(uid)s
"""


def device_rows(lib: Library) -> list[dict]:
    return lib._all(_DEVICE_SELECT + " order by d.id", {"uid": lib.uid, "online": ONLINE_S})


def _engine(d: dict, name: str) -> dict | None:
    return next((e for e in d.get("engines") or [] if isinstance(e, dict) and e.get("name") == name), None)


def advertised(devices: list[dict]) -> set[str]:
    """해지 안 된 기기가 광고한 엔진 이름 (로그인 여부와 무관 — 9.2절)"""
    return {e for d in devices if d["revoked_at"] is None for e in ENGINES if _engine(d, e)}


def device_view(d: dict) -> dict:
    return {"id": d["id"], "name": d["name"], "online": bool(d["online"]), "last_seen_at": iso(d["last_seen_at"]),
            "engines": d["engines"] or [], "app_version": d["app_version"], "os": d["os"], "paused": d["paused"],
            "revoked": d["revoked_at"] is not None, "revoked_at": iso(d["revoked_at"]),
            "running_jobs": d["running_jobs"], "update_required": update_required(d["app_version"]),
            "created_at": iso(d["created_at"]),
            # 6단계 SW-3: 폴더 동기화 요약(켠 적 없으면 null)
            "sync": _sync_view(d.get("sync")),
            # 선택 동기화: 이 PC가 보관하는 PC에만 둔 파일 수 · 크기 (selective-sync.md 7.2절)
            "local_count": int((d.get("local") or {}).get("n") or 0),
            "local_bytes": int((d.get("local") or {}).get("bytes") or 0)}


def _sync_view(s) -> dict | None:
    if not isinstance(s, dict):
        return None
    at = s.get("last_sync_at")
    return {"enabled": bool(s.get("enabled")), "state": s.get("state") or "off", "root_label": s.get("root_label") or "",
            "last_sync_at": iso(datetime.fromisoformat(at)) if isinstance(at, str) else None,
            "counts": s.get("counts") if isinstance(s.get("counts"), dict) else {},
            "protocol": int(s.get("protocol") or 1)}  # 1 = 0.3.x 앱(PC에만 두기를 고를 수 없음 — 10.7절)


def new_pair_code(lib: Library) -> dict:
    """연결 코드 발급(12.1절). 이전 유효 코드는 끝낸다. 코드 원문은 응답에만 — DB에는 해시"""
    lib._x("update paperlab.device_pair_codes set expires_at = now() where user_id = %s and used_at is null "
           "and expires_at > now()", (lib.uid,))
    raw = "".join(secrets.choice(PAIR_ALPHABET) for _ in range(8))
    row = lib._one("insert into paperlab.device_pair_codes (user_id, code_hash, expires_at) "
                   "values (%s, %s, now() + make_interval(secs => %s)) returning expires_at",
                   (lib.uid, sha256_hex(raw), PAIR_TTL_S))
    return {"code": f"{raw[:4]}-{raw[4:]}", "expires_at": iso(row["expires_at"])}


def normalize_code(code) -> str:
    return re.sub(r"[\s-]", "", str(code or "")).upper()[:32]


def find_pair_code(conn, code: str) -> dict | None:
    """system_tx("device pairing") 연결로: 안 쓰고 안 지난 코드 한 행 (누구 코드인지 모르는 상태 — 5.6절)"""
    return conn.execute("select id, user_id from paperlab.device_pair_codes where code_hash = %s and used_at is null "
                        "and expires_at > now()", (sha256_hex(normalize_code(code)),)).fetchone()


def create_device(lib: Library, code_id: int, name: str, os_name: str, app_version: str) -> tuple[int, str]:
    """그 사용자 트랜잭션에서 기기 행 + 코드 사용 기록. 같은 코드를 동시에 쓰면 한 쪽만(used_at is null 조건)."""
    n = lib._one("select count(*)::int as n from paperlab.devices where user_id = %s and revoked_at is null",
                 (lib.uid,))["n"]
    if n >= MAX_DEVICES:
        raise JobError(400, "연결된 PC가 너무 많아요. 쓰지 않는 PC를 해지해 주세요", "too_many_devices")
    secret = secrets.token_urlsafe(32)  # 32바이트 → base64url 43자
    dev = lib._one("insert into paperlab.devices (user_id, name, token_hash, os, app_version) values (%s, %s, %s, %s, %s) "
                   "returning id", (lib.uid, name, sha256_hex(secret), os_name, app_version))["id"]
    used = lib._x("update paperlab.device_pair_codes set used_at = now(), device_id = %s where id = %s and user_id = %s "
                  "and used_at is null and expires_at > now()", (dev, code_id, lib.uid)).rowcount
    if not used:
        raise JobError(400, BAD_CODE, "bad_code")
    return dev, f"pld1.{lib.uid}.{dev}.{secret}"


BAD_CODE = "연결 코드가 맞지 않거나 시간이 지났어요"


def parse_token(token: str) -> tuple[str, int, str] | None:
    m = TOKEN_RE.fullmatch(token or "")
    return (m.group(1), int(m.group(2)), m.group(3)) if m else None


def device_name(value, default: str = "") -> str:
    name = re.sub(r"[\x00-\x1f\x7f-\x9f  ]", "", str(value if value is not None else default)).strip()
    return name[:60]


def clean_engines(value) -> list[dict]:
    if not isinstance(value, list) or len(value) > len(ENGINES):
        raise JobError(400, "엔진 정보가 올바르지 않아요", "bad_request")
    out, seen = [], set()
    for e in value:
        if not isinstance(e, dict) or e.get("name") not in ENGINES or e["name"] in seen:
            raise JobError(400, "엔진 정보가 올바르지 않아요", "bad_request")
        seen.add(e["name"])
        try:
            slots = min(4, max(1, int(e.get("slots") or 1)))
        except (TypeError, ValueError):
            raise JobError(400, "엔진 정보가 올바르지 않아요", "bad_request") from None
        out.append({"name": e["name"], "version": device_name(e.get("version"))[:40],
                    "logged_in": e.get("logged_in") is True, "slots": slots})
    return out


def touch_device(lib: Library, device_id: int, **fields) -> None:
    """워커 요청마다: last_seen_at은 50초에 한 번까지만 쓰고, 바뀐 값(paused · engines · 버전)은 그때 같이 쓴다"""
    sets = ["last_seen_at = case when last_seen_at is null or last_seen_at < now() - make_interval(secs => %(every)s) "
            "then now() else last_seen_at end"]
    params = {"id": device_id, "uid": lib.uid, "every": SEEN_EVERY_S}
    for k, v in fields.items():
        sets.append(f"{k} = %({k})s")
        params[k] = Jsonb(v) if k == "engines" else v
    if fields:
        sets.append("updated_at = now()")
    lib._x(f"update paperlab.devices set {', '.join(sets)} where id = %(id)s and user_id = %(uid)s", params)


def revoke_device(lib: Library, device_id: int) -> int:
    """해지(12.4절): 그 기기가 실행 중이던 작업은 바로 대기로 (리스 토큰이 바뀌어 옛 결과는 버려짐)"""
    n = valid_id(device_id) and lib._x("update paperlab.devices set revoked_at = coalesce(revoked_at, now()), updated_at = now() "
               "where id = %s and user_id = %s", (device_id, lib.uid)).rowcount
    if not n:
        raise JobError(404, "PC를 찾을 수 없어요", "not_found")
    lib._x("update paperlab.jobs set status = 'cancelled', lease_token = null, lease_until = null, progress = '{}'::jsonb, "
           "finished_at = now(), updated_at = now() where user_id = %s and device_id = %s and status = 'running' "
           "and cancel_requested", (lib.uid, device_id))
    return lib._x("update paperlab.jobs set status = 'queued', device_id = null, lease_token = null, lease_until = null, "
                  "progress = '{}'::jsonb, updated_at = now() where user_id = %s and device_id = %s and status = 'running'",
                  (lib.uid, device_id)).rowcount


# ====================================================================== 경로 (9.2절)
AI_RUNNERS = ("api", "cli")  # 사용자 AI 작업이 가는 곳은 이 둘뿐 — 서버가 CLI를 직접 실행하는 칸은 없다


def build_route(kind: str, get, devices: list[dict], cli_only: bool = False) -> list[dict]:
    """작업 종류의 엔진 순서 → [{runner, engine}…]. 키가 있으면 API 칸, 그 엔진을 광고한 기기가 있으면 CLI 칸.
    get = 그 사용자의 설정(UserSettings.get — 내가 넣은 키만, 서버 환경 변수 없음), devices = 그 사용자가 연결한 PC
    (워커가 그 PC에서 claude · codex · gemini CLI를 실행). 서버 PC의 CLI · 서버 키로 가는 칸은 만들지 않는다.
    cli_only: 로컬 항목(selective-sync.md 7.4절) — devices에 보관 PC 한 대만 넘기고 API 칸은 모두 뺀다"""
    adv = advertised(devices)
    route = []
    for e in (get("ai_routing") or {}).get(ROUTE_KIND.get(kind, kind)) or ["claude"]:
        if get(ai.ENGINE_KEYS[e]) and not cli_only:
            route.append({"runner": "api", "engine": e})
        if e in adv:
            route.append({"runner": "cli", "engine": e})
    return route


def online_count(devices: list[dict], engine: str) -> int:
    return sum(1 for d in devices if d["online"] and not d["paused"] and (_engine(d, engine) or {}).get("logged_in"))


def ai_status(get, devices: list[dict], has_release: bool) -> dict:
    """GET /api/ai/status (7.3절). ready = 요약 경로가 하나라도 있음(기기는 꺼져 있어도 됨 — 대기)"""
    adv = advertised(devices)
    kinds = {}
    for kind in JOB_KINDS:
        slots = []
        for e in (get("ai_routing") or {}).get(kind) or ["claude"]:
            key = bool(get(ai.ENGINE_KEYS[e]))
            slots.append({"runner": "api", "engine": e, "available": key, "reason": "" if key else "no_key"})
            slots.append({"runner": "cli", "engine": e, "available": e in adv, "reason": "" if e in adv else "no_device"})
        first = next(({"runner": s["runner"], "engine": s["engine"]} for s in slots if s["available"]), None)
        # 경로가 없는 작업은 화면이 시작하기 전에 이 문구를 보여 준다 (설정 → 연결된 PC · API 키 안내)
        kinds[kind] = {"route": slots, "first": first, "message": "" if first else no_route_message(has_release)}
    first = kinds["summary"]["first"]
    if not first:
        msg = no_route_message(has_release)
    elif first["runner"] == "api":
        msg = f"요약은 내 {ai.ENGINE_COMPANY[first['engine']]} API 키로 먼저 실행해요."
    elif online_count(devices, first["engine"]):
        msg = f"요약은 연결된 내 PC의 {first['engine']}로 실행해요."
    else:
        msg = f"요약은 연결된 내 PC의 {first['engine']}로 실행해요. 지금은 켜진 PC가 없어 PC가 켜질 때까지 기다려요."
    return {"ready": first is not None, "kinds": kinds, "message": msg}


def engines_summary(get, devices: list[dict]) -> dict:
    """GET /api/ai/engines (7.3절)"""
    cli = get("cli_models") or {}
    return {e: {"api_key": bool(get(ai.ENGINE_KEYS[e])), "devices_online": online_count(devices, e),
                "devices_total": sum(1 for d in devices if d["revoked_at"] is None and _engine(d, e)),
                "cli_model": cli.get(e, "default")} for e in ENGINES}


# ====================================================================== 작업 만들기 · 보기
def create_job(lib: Library, kind: str, route: list[dict], params: dict, paper_id: int | None = None,
               running_api: bool = False, pinned_device_id: int | None = None) -> tuple[dict, bool]:
    """(행, 새로 만들었는지). 같은 논문 진행 중 요약이 있으면 그 행(7.1절). running_api: 대화 · 글쓰기 API SSE 경로
    (요청 안에서 바로 실행 — interactive 표시. 실행기 · 복구 스캔은 다시 실행하지 않고, 리스가 지나면 취소로 끝냄).
    pinned_device_id: 로컬 항목 작업 — 그 보관 PC만 잡는다(selective-sync.md 7.4절, 경로는 CLI 칸뿐)"""
    if kind not in ALL_KINDS or kind == "index" or not route:
        raise JobError(400, NO_ROUTE, "no_route")
    if any(s.get("runner") not in AI_RUNNERS or s.get("engine") not in ENGINES for s in route):
        raise JobError(400, NO_ROUTE, "no_route")  # 내 PC · 내 키 말고 다른 실행 칸은 받지 않는다
    if pinned_device_id is not None and any(s["runner"] != "cli" for s in route):
        raise JobError(400, NO_ROUTE, "no_route")  # 로컬 항목은 서버 API 키로 실행하지 않는다 (P-6)
    if len(json.dumps(params, ensure_ascii=False).encode("utf-8")) > PARAMS_MAX:
        raise JobError(400, "요청이 너무 커요", "too_large")
    active = lib._one("select count(*)::int as n from paperlab.jobs where user_id = %s and status in ('queued', 'running')",
                      (lib.uid,))["n"]
    if active >= MAX_ACTIVE_JOBS:
        raise JobError(429, "작업이 너무 많아요. 잠시 후 다시 해 주세요", "too_many_jobs")
    first = route[0]
    run = running_api and first["runner"] == "api"
    row = lib._one(
        "insert into paperlab.jobs (user_id, kind, status, runner, engine, route, params, paper_id, max_attempts, "
        " deadline_at, lease_token, lease_until, leased_at, started_at, attempts, interactive, pinned_device_id) "
        "values (%(uid)s, %(kind)s, %(status)s, %(runner)s, %(engine)s, %(route)s, %(params)s, %(pid)s, %(max)s, "
        " now() + make_interval(secs => %(deadline)s), "
        " case when %(run)s then gen_random_uuid() end, case when %(run)s then now() + make_interval(secs => %(lease)s) end, "
        " case when %(run)s then now() end, case when %(run)s then now() end, case when %(run)s then 1 else 0 end, %(run)s, "
        " %(pin)s) "
        "on conflict do nothing returning *",  # 진행 중 하나뿐인 종류: summary · translate_paper (부분 유일 색인)
        {"uid": lib.uid, "kind": kind, "status": "running" if run else "queued", "runner": first["runner"],
         "engine": first["engine"], "route": Jsonb(route), "params": Jsonb(params), "pid": paper_id,
         "max": MAX_ATTEMPTS, "deadline": DEADLINE_S[kind], "run": run, "lease": ai.TEXT_API_TIMEOUT + 60,
         "pin": pinned_device_id})
    if row:
        return row, True
    existing = lib._one("select * from paperlab.jobs where user_id = %s and paper_id = %s and kind = %s "
                        "and status in ('queued', 'running')", (lib.uid, paper_id, kind))
    if not existing:  # 그 사이 끝났으면 (드묾) 다시 만든다
        return create_job(lib, kind, route, params, paper_id, running_api, pinned_device_id)
    return existing, False


_JOB_SELECT = """
select j.*, p.title as paper_title, d.name as device_name, m.title as manuscript_title
  from paperlab.jobs j
  left join paperlab.papers p on p.id = j.paper_id and p.user_id = j.user_id
  left join paperlab.devices d on d.id = j.device_id and d.user_id = j.user_id
  left join paperlab.manuscripts m on j.kind in ('write', 'verify', 'ms_chat') and m.user_id = j.user_id
       and m.id = case when j.params ->> 'manuscript_id' ~ '^[0-9]{1,15}$' then (j.params ->> 'manuscript_id')::bigint end
 where j.user_id = %(uid)s
"""


def waiting_reason(job: dict, devices: list[dict], free: dict) -> str | None:
    """7장 판정 순서: 엔진 가진 기기 없음 → 켜진(로그인 · 일시 중지 아님) 기기 없음 → 자리 없음 → null"""
    if job["status"] != "queued" or job["runner"] != "cli":
        return None
    eng = job["engine"]
    excluded = set(job.get("excluded_devices") or [])
    if job.get("pinned_device_id") is not None:  # 로컬 항목: 보관 PC만 (selective-sync.md 7.4절)
        devices = [d for d in devices if d["id"] == job["pinned_device_id"]]
        if not any(d["online"] and not d["paused"] for d in devices):
            return "holder_offline"
    adv = [d for d in devices if d["revoked_at"] is None and _engine(d, eng)]
    if not adv:
        return "no_engine_on_worker"
    ok = [d for d in adv if d["online"] and not d["paused"] and _engine(d, eng).get("logged_in")
          and d["id"] not in excluded]
    if not ok:
        return "no_online_worker"
    if all((free.get(d["id"]) or {}).get(eng, 1) <= 0 for d in ok):
        return "all_workers_busy"
    return None


def _pinned_view(job: dict, devices: list[dict]) -> dict | None:
    pin = job.get("pinned_device_id")
    if pin is None:
        return None
    d = next((d for d in devices if d["id"] == pin), None)
    name = d["name"] if d else "PC"
    online = bool(d and d["online"] and not d["paused"])
    return {"id": pin, "name": name, "online": online,
            "note": "" if online or job["status"] != "queued" else f"{josa(f'‘{name}’', '이/가')} 켜지면 실행돼요"}


WRITE_HANDLED = ("applied", "dismissed")  # 글쓰기 결과를 원고에 넣었음 · 넣지 않기로 함 (result.handled)


def write_view(params: dict, result, detail: bool) -> dict:
    """글쓰기 작업의 넣기 정보 (2026-10-16 백그라운드 AI): 원고 화면 · 작업 화면이 결과를 나중에 열어 안전하게 넣을 때 쓴다.
    원래 글(text)은 한 작업을 볼 때만(목록에는 넣지 않음 — 크기)"""
    out = {"mode": params.get("mode") or "polish", "insert": bool(params.get("insert")),
           "handled": (result or {}).get("handled") if isinstance(result, dict) else None,
           # 장 · 절 일괄 처리의 문단 작업이면 묶음 {id, n, mode, label}과 순번 (mschat.py)
           "batch": params.get("batch"), "batch_i": params.get("batch_i")}
    if detail:
        out.update(text=params.get("text") or "", sel_start=params.get("sel_start"), sel_end=params.get("sel_end"),
                   doc_hash=params.get("doc_hash") or "", before=params.get("before") or "")
    return out


def job_view(r: dict, devices: list[dict], free: dict, detail: bool = False) -> dict:
    params = r.get("params") or {}
    return {
        "id": r["id"], "kind": r["kind"], "status": r["status"], "runner": r["runner"], "engine": r["engine"],
        "route": r["route"], "route_index": r["route_index"],
        "paper_id": r["paper_id"], "paper_title": r.get("paper_title"),
        "manuscript_title": r.get("manuscript_title") if r["kind"] in ("write", "verify", "ms_chat") else None,
        "manuscript_id": params.get("manuscript_id") if r["kind"] in ("write", "verify", "ms_chat") else None,
        "scope": params.get("scope") if r["kind"] == "chat" else None,
        "device": {"id": r["device_id"], "name": r["device_name"]} if r.get("device_id") and r.get("device_name") else None,
        "waiting_reason": waiting_reason(r, devices, free),
        # 로컬 항목 작업은 보관 PC만 — 대기 안내 "‘집 PC’가 켜지면 실행돼요" (selective-sync.md 7.4절)
        "pinned_device": _pinned_view(r, devices),
        "progress": r["progress"] or {}, "attempts": r["attempts"], "error_code": r["error_code"], "error": r["error"],
        "cancel_requested": r["cancel_requested"], "history": r["history"] or [], "interactive": bool(r.get("interactive")),
        "deadline_at": iso(r["deadline_at"]) if r["status"] == "queued" else None,
        # 화면용 덧붙임: 대화 탭을 다시 열 때 질문 말풍선 · 작업 목록 [결과 복사] (디자인 7 · 9장)
        "question": params.get("question") if r["kind"] in ("chat", "find") else None,
        # 4단계 선택 설명 · 번역: 진행 카드를 다시 그릴 때 (원문 앞부분 · 쪽 — 시안 3.1절)
        "source_text": (params.get("text") or "")[:200] if r["kind"] in EXPLAIN_KINDS else None,
        "page": params.get("page") if r["kind"] in EXPLAIN_KINDS else None,
        "write": write_view(params, r["result"], detail) if r["kind"] == "write" else None,
        "result": r["result"],
        "created_at": iso(r["created_at"]), "started_at": iso(r["started_at"]), "finished_at": iso(r["finished_at"]),
    }


def valid_id(n) -> bool:
    return isinstance(n, int) and not isinstance(n, bool) and 0 < n < 2 ** 63


def get_job(lib: Library, job_id: int, free: dict) -> dict:
    if not valid_id(job_id):
        raise JobError(404, "작업을 찾을 수 없어요", "not_found")
    r = lib._one(_JOB_SELECT + " and j.id = %(id)s", {"uid": lib.uid, "id": job_id})
    if not r:
        raise JobError(404, "작업을 찾을 수 없어요", "not_found")
    return job_view(r, device_rows(lib), free, detail=True)


def list_jobs(lib: Library, free: dict, status: str = "active", paper_id: int | None = None, kind: str = "",
              limit: int = 50, since: str = "", manuscript_id: int | None = None) -> dict:
    """status: active · recent(7일) · all · finished(since 뒤에 끝난 작업 — 화면의 끝남 알림, 2026-10-16).
    manuscript_id: 그 원고의 글쓰기 · 인용 검증 작업만. now = 서버 시각(다음 finished 조회의 since)"""
    cond = {"active": " and j.status in ('queued', 'running')",
            "recent": " and j.created_at > now() - interval '7 days'", "all": "",
            "finished": " and j.status in ('succeeded', 'failed', 'cancelled') and j.finished_at > %(since)s"}.get(status)
    if cond is None or (kind and kind not in ALL_KINDS):
        raise JobError(400, "조건이 올바르지 않아요", "bad_request")
    since_dt = None
    if status == "finished":
        try:
            since_dt = datetime.fromisoformat(str(since or "").replace("Z", "+00:00"))
        except ValueError:
            raise JobError(400, "조건이 올바르지 않아요", "bad_request") from None
        if since_dt.tzinfo is None:
            raise JobError(400, "조건이 올바르지 않아요", "bad_request")
        since_dt = max(since_dt, now_dt() - timedelta(days=7))  # 오래된 기준은 7일로 줄임
    params = {"uid": lib.uid, "pid": paper_id, "kind": kind, "limit": max(1, min(int(limit), 200)), "since": since_dt,
              "mid": str(manuscript_id) if manuscript_id is not None else None}
    if paper_id is not None:
        cond += " and j.paper_id = %(pid)s"
    if kind:
        cond += " and j.kind = %(kind)s"
    if manuscript_id is not None:
        if not valid_id(manuscript_id):
            raise JobError(400, "조건이 올바르지 않아요", "bad_request")
        cond += " and j.kind in ('write', 'verify') and j.params ->> 'manuscript_id' = %(mid)s"
    rows = lib._all(_JOB_SELECT + cond + " order by j.created_at desc, j.id desc limit %(limit)s", params)
    total = lib._one("select count(*)::int as n from paperlab.jobs j where j.user_id = %(uid)s" + cond, params)["n"]
    devices = device_rows(lib)
    return {"jobs": [job_view(r, devices, free) for r in rows], "total": total, "now": iso(now_dt())}


def mark_write_handled(lib: Library, job_id: int, state: str) -> dict:
    """글쓰기 결과를 원고에 넣었음(applied) · 넣지 않기로 함(dismissed) — 원고 화면의 'AI 결과' 줄에서 뺀다.
    결과 글은 그대로 두어 작업 화면에서 다시 열 수 있다(7일 뒤 정리)"""
    if state not in WRITE_HANDLED:
        raise JobError(400, "상태가 올바르지 않아요", "bad_request")
    n = valid_id(job_id) and lib._x(
        "update paperlab.jobs set result = result || jsonb_build_object('handled', %s::text), updated_at = now() "
        "where id = %s and user_id = %s and kind = 'write' and status = 'succeeded' and jsonb_typeof(result) = 'object'",
        (state, job_id, lib.uid)).rowcount
    if not n:
        raise JobError(404, "결과를 찾을 수 없어요. 7일이 지나 지워졌을 수 있어요", "not_found")
    return {"ok": True, "handled": state}


def latest_job(lib: Library, free: dict, cond: str, params: dict | None = None) -> dict | None:
    """조건에 맞는 작업 중 진행 중인 것 먼저, 없으면 가장 최근 것 (3단계: index · verify)"""
    r = lib._one(_JOB_SELECT + cond + " order by (j.status in ('queued', 'running')) desc, j.created_at desc, j.id desc "
                 "limit 1", {"uid": lib.uid, **(params or {})})
    return job_view(r, device_rows(lib), free) if r else None


def latest_summary_job(lib: Library, paper_id: int, free: dict) -> dict | None:
    r = lib._one(_JOB_SELECT + " and j.paper_id = %(pid)s and j.kind = 'summary' "
                 "order by (j.status in ('queued', 'running')) desc, j.created_at desc, j.id desc limit 1",
                 {"uid": lib.uid, "pid": paper_id})
    return job_view(r, device_rows(lib), free) if r else None


# ====================================================================== 정리 (6.3 · 6.8절)
def expire(lib: Library) -> None:
    """사용자 범위 가벼운 정리 — 잡기 · 조회 · 목록 때마다: CLI 리스 만료 → 다시 대기(또는 취소 · lease_exhausted),
    대기 기한이 지난 CLI 작업 → no_worker_timeout"""
    rows = lib._all("select * from paperlab.jobs where user_id = %s and runner = 'cli' and status = 'running' "
                    "and lease_until < now() for update skip locked", (lib.uid,))
    for j in rows:
        entry = _history_entry(j, "lease_expired", j["device_id"])
        if j["cancel_requested"]:
            _end(lib, j, "cancelled")
        elif j["attempts"] >= j["max_attempts"]:
            _end(lib, j, "failed", "lease_exhausted", DEFAULT_ERRORS["lease_exhausted"], entry)
        else:
            lib._x("update paperlab.jobs set status = 'queued', lease_token = null, lease_until = null, " + _KEEP_PROGRESS
                   + ", history = %s, updated_at = now() where id = %s and user_id = %s", (_history(j, entry), j["id"], lib.uid))
    lib._x("update paperlab.jobs set status = 'cancelled', error_code = 'interrupted', "
           "error = case when leased_at is null or leased_at < %s then %s else %s end, lease_token = null, "
           "lease_until = null, progress = '{}'::jsonb, finished_at = now(), updated_at = now() "
           "where user_id = %s and interactive and status = 'running' and lease_until < now()",
           (STARTED_AT, INTERRUPTED, LEASE_TIMEOUT, lib.uid))
    lib._x("update paperlab.jobs set status = 'failed', error_code = 'no_worker_timeout', error = %s, finished_at = now(), "
           "updated_at = now() where user_id = %s and runner = 'cli' and status = 'queued' and deadline_at < now()",
           (DEFAULT_ERRORS["no_worker_timeout"], lib.uid))


def sweep(lib: Library) -> None:
    """요청당 최대 10분에 한 번(호출하는 쪽이 정함): 오래된 행 지우기 · 글쓰기 결과 비우기"""
    lib._x("delete from paperlab.jobs where user_id = %s and status in ('succeeded', 'failed', 'cancelled') "
           "and coalesce(finished_at, updated_at) < now() - make_interval(days => %s)", (lib.uid, KEEP_DONE_DAYS))
    lib._x("update paperlab.jobs set result = null where user_id = %s and kind = 'write' and result is not null "
           "and finished_at < now() - make_interval(hours => %s)", (lib.uid, WRITE_RESULT_HOURS))
    lib._x("update paperlab.jobs set params = '{}'::jsonb, result = null where user_id = %s and kind = 'find' "
           "and (params <> '{}'::jsonb or result is not null) and finished_at < now() - make_interval(hours => %s)",
           (lib.uid, FIND_KEEP_HOURS))
    lib._x("delete from paperlab.device_pair_codes where user_id = %s and (used_at is not null or expires_at < now())",
           (lib.uid,))
    lib._x("delete from paperlab.devices where user_id = %s and revoked_at < now() - make_interval(days => %s)",
           (lib.uid, REVOKED_KEEP_DAYS))


# ====================================================================== 상태 바꾸기
def _end(lib: Library, job: dict, status: str, code: str = "", message: str = "", entry: dict | None = None,
         result=None) -> None:
    lib._x("update paperlab.jobs set status = %s, error_code = %s, error = %s, history = %s, result = %s, "
           "lease_token = null, lease_until = null, progress = '{}'::jsonb, finished_at = now(), updated_at = now() "
           "where id = %s and user_id = %s",
           (status, code, clean_error(message), _history(job, entry) if entry else Jsonb(job.get("history") or []),
            Jsonb(result) if result is not None else None, job["id"], lib.uid))


def cancel_job(lib: Library, job_id: int) -> dict:
    j = None if not valid_id(job_id) else lib._one("select * from paperlab.jobs where id = %s and user_id = %s for update", (job_id, lib.uid))
    if not j:
        raise JobError(404, "작업을 찾을 수 없어요", "not_found")
    if j["status"] == "queued":
        _end(lib, j, "cancelled")
        return {"status": "cancelled", "cancel_requested": False}
    if j["status"] == "running":
        lib._x("update paperlab.jobs set cancel_requested = true, updated_at = now() where id = %s and user_id = %s",
               (job_id, lib.uid))
        return {"status": "running", "cancel_requested": True}
    raise JobError(409, "이미 끝난 작업이에요", "finished")


def retry_source(lib: Library, job_id: int) -> dict:
    j = None if not valid_id(job_id) else lib._one("select kind, paper_id, params, status from paperlab.jobs where id = %s and user_id = %s",
                 (job_id, lib.uid))
    if not j:
        raise JobError(404, "작업을 찾을 수 없어요", "not_found")
    if j["status"] not in ("failed", "cancelled"):
        raise JobError(409, "실패하거나 취소한 작업만 다시 시도할 수 있어요", "not_retryable")
    if j["kind"] == "find" and not (j["params"] or {}).get("question"):  # 24시간 정리로 질문이 지워짐 (품질팀 L4)
        raise JobError(409, "24시간이 지나 지워진 작업이에요. 질문을 다시 입력해 주세요", "expired")
    return j


def record_key_error(lib: Library, engine: str, code: str) -> None:
    """API 키 오류(api_auth · api_permission)를 설정의 '최근 실패'에 남긴다 (7.3절 — 그 밖 오류는 남기지 않음)"""
    if code in KEY_ERROR_CODES:
        lib.update_settings({f"{ai.ENGINE_KEYS[engine]}_last_error": {"code": code, "at": iso(now_dt())}})


def fail_or_fallback(lib: Library, job: dict, code: str, message: str, *, device_id=None, guide: str = "",
                     force_fallback: bool = False) -> str:
    """실패 판정(9.6 · 11.8절) → 새 상태. 폴백이면 다음 경로 칸으로 대기.
    팀장 결정 Q2a-1: 다음 칸이 CLI인데 그 엔진을 가진(해지 안 된) 기기가 하나도 없으면 그 칸은 건너뛰고,
    남은 칸이 없으면 API 오류 문구 + 안내(guide)로 실패. 기기가 있지만 꺼져 있으면 대기 기한까지 대기."""
    entry = _history_entry(job, code, device_id)
    message = clean_error(message or DEFAULT_ERRORS.get(code, "작업이 실패했어요"))
    if job["cancel_requested"]:
        _end(lib, job, "cancelled", entry=entry)
        return "cancelled"
    if code in RELOCATE_CODES and job.get("pinned_device_id") is not None:
        force_fallback = True  # 로컬 항목은 보관 PC만 잡을 수 있음 — 이 PC를 빼면 아무도 못 잡으므로 다음 칸(같은 PC의 다른 CLI)
    elif code in RELOCATE_CODES and job["runner"] == "cli" and device_id is not None:
        excluded = sorted(set(job.get("excluded_devices") or []) | {device_id})
        lib._x("update paperlab.jobs set status = 'queued', device_id = null, lease_token = null, lease_until = null, "
               + _KEEP_PROGRESS + ", excluded_devices = %s, history = %s, updated_at = now() where id = %s and user_id = %s",
               (Jsonb(excluded), _history(job, entry), job["id"], lib.uid))
        return "queued"
    if code in FALLBACK_CODES or force_fallback:
        devs = device_rows(lib)
        if job.get("pinned_device_id") is not None:  # 로컬 항목: 보관 PC의 엔진만 (경로에 API 칸은 없음 — AC-S52)
            devs = [d for d in devs if d["id"] == job["pinned_device_id"]]
        adv = advertised(devs)
        route = job["route"] or []
        skipped = False
        for i in range(job["route_index"] + 1, len(route)):
            slot = route[i]
            if slot["runner"] == "cli" and slot["engine"] not in adv:
                skipped = True
                continue
            lib._x("update paperlab.jobs set status = 'queued', runner = %s, engine = %s, route_index = %s, attempts = 0, "
                   "excluded_devices = '[]'::jsonb, device_id = null, lease_token = null, lease_until = null, "
                   + _KEEP_PROGRESS + ", history = %s, not_before = now(), interactive = false, "
                   "deadline_at = case when %s = 'cli' then now() + make_interval(secs => %s) else deadline_at end, "
                   "updated_at = now() where id = %s and user_id = %s",
                   (slot["runner"], slot["engine"], i, _history(job, entry), slot["runner"], DEADLINE_S[job["kind"]],
                    job["id"], lib.uid))
            return "queued"
        if (skipped or job["runner"] == "api") and not adv and guide:
            message = clean_error(f"{message} {guide}")
    _end(lib, job, "failed", code, message, entry)
    return "failed"


def finish_success(lib: Library, job: dict, parsed: dict, model: str = "") -> tuple[str, dict | None]:
    """결과 반영(6.4절) + succeeded를 한 트랜잭션에서 → (새 상태, 작업 result). 반영이 실패하면 반영만 되돌리고 apply_failed."""
    if job["cancel_requested"]:
        _end(lib, job, "cancelled")
        return "cancelled", None
    if paper_trashed(lib, job):
        return "cancelled", None
    try:
        with lib.conn.transaction():  # 저장점 — 반영이 깨져도 작업 상태는 바꿀 수 있게
            result = _apply(lib, job, parsed, model)
    except Exception as e:  # noqa: BLE001 - 반영 실패는 작업 실패로 기록 (원인은 로그 — 내용 없이 형식만)
        log.warning("apply failed job=%s: %s", job["id"], type(e).__name__)
        _end(lib, job, "failed", "apply_failed", DEFAULT_ERRORS["apply_failed"])
        return "failed", None
    _end(lib, job, "succeeded", result=result)
    return "succeeded", result


def paper_trashed(lib: Library, job: dict) -> bool:
    """논문 작업인데 그 논문이 휴지통(또는 없음)이면 작업을 cancelled(paper_trashed)로 끝내고 True — 결과는 쓰지 않는다 (6단계 K-39).
    작업 행이 RLS(hide_trashed_children)로 숨으면 여기 오기 전에 이미 404 · lease_lost"""
    if job.get("paper_id") is None or lib.paper_ids([job["paper_id"]]):
        return False
    with lib.trash_tx():  # 휴지통 논문의 작업 행은 hide_trashed_children로 숨으므로 끝낼 때만 보이게
        _end(lib, job, "cancelled", "paper_trashed", PAPER_TRASHED)
    return True


def _apply(lib: Library, job: dict, parsed: dict, model: str):
    kind, pid = job["kind"], job["paper_id"]
    if kind == "summary":
        p = lib.get_paper(pid, detail=False)
        if not p:
            raise LookupError("paper gone")
        data = parsed["summary"]
        lib.save_summary(pid, data, model)
        if data.get("keywords") and not p.get("keywords"):
            lib.update_paper(pid, {"keywords": data["keywords"][:10]})
        return None
    params = job["params"] or {}
    if kind == "chat" and pid is None:  # 범위 대화(3단계 11.3절): 출처 번호표는 params.sources
        scope = params.get("scope") or {}
        text, cites = rag.cite_sources(parsed["text"], params.get("sources") or [])
        lib.add_scope_message(scope.get("type"), scope.get("id"), "user", params.get("question", ""))
        mid = lib.add_scope_message(scope.get("type"), scope.get("id"), "assistant", text, cites)
        return {"message_id": mid}
    if kind == "chat":
        lib.add_chat_message(pid, "user", params.get("question", ""))
        mid = lib.add_chat_message(pid, "assistant", parsed["text"], parsed.get("citations") or [])
        return {"message_id": mid}
    if kind == "find":
        cands = params.get("candidates") or []
        sources = [dict(c, in_library=x) for c, x in zip(cands, lib.match_library(cands))]
        return {"answer": parsed.get("answer") or "", "sources": sources, "queries": params.get("queries") or [],
                "warnings": params.get("warnings") or []}
    if kind == "verify":
        return verify.apply_results(lib, job, parsed["results"])
    if kind in EXPLAIN_KINDS:
        return {"explanation_id": explain.save(lib, job, parsed["result"], model)}
    if kind == "ms_chat":  # 원고 AI 대화: 답 메시지(수정 제안 포함)를 남긴다 (mschat.py)
        from . import mschat
        return mschat.apply_result(lib, job, parsed)
    text = parsed["text"]
    if len(text.encode("utf-8")) > RESULT_TEXT_MAX:
        raise ValueError("too large")
    return {"text": text}


def lock_leased(lib: Library, job_id: int, lease_token: str, device_id: int | None = None) -> dict:
    """아직 내 리스인 running 작업을 잠근다 — 아니면 409 lease_lost(작업은 있음) · 404(작업 없음)"""
    if not valid_id(job_id):
        raise JobError(404, "작업을 찾을 수 없어요", "not_found")
    if not re.fullmatch(r"[0-9a-f-]{36}", str(lease_token or "")):
        raise LeaseLost()
    sql = ("select * from paperlab.jobs where id = %(id)s and user_id = %(uid)s and lease_token = %(tok)s::uuid "
           "and status = 'running'" + (" and device_id = %(dev)s" if device_id is not None else "") + " for update")
    j = lib._one(sql, {"id": job_id, "uid": lib.uid, "tok": lease_token, "dev": device_id})
    if j:
        return j
    if lib._one("select 1 from paperlab.jobs where id = %s and user_id = %s", (job_id, lib.uid)):
        raise LeaseLost()
    raise JobError(404, "작업을 찾을 수 없어요", "not_found")


def touch_lease(lib: Library, job_id: int, lease_token: str, *, progress: dict | None = None, renew: bool = False,
                timeout_s: int | None = None) -> dict | None:
    """하트비트 · 실행기 진행: 같은 리스면 연장 · 진행 저장 → {lease_until, cancel}. 리스를 잃었으면 None.
    timeout_s가 있으면 이번 잡기 + 시간 제한 + 5분이 지난 뒤로는 연장하지 않는다(서버 쪽 절대 기한 — 11.5절)."""
    sets = ["updated_at = now()"]
    params = {"id": job_id, "uid": lib.uid, "tok": lease_token, "lease": LEASE_S,
              "abs": (timeout_s or 0) + ABS_GRACE_S}
    if renew:
        sets.append("lease_until = now() + make_interval(secs => %(lease)s)")
    if progress is not None:
        sets.append("progress = %(progress)s")
        params["progress"] = Jsonb(progress)
    cond = " and leased_at + make_interval(secs => %(abs)s) > now()" if (renew and timeout_s) else ""
    r = lib._one(f"update paperlab.jobs set {', '.join(sets)} where id = %(id)s and user_id = %(uid)s "
                 f"and lease_token = %(tok)s::uuid and status = 'running'{cond} returning lease_until, cancel_requested",
                 params)
    return {"lease_until": iso(r["lease_until"]), "cancel": r["cancel_requested"]} if r else None


def clean_progress(value) -> dict:
    """{"message", "fraction", "partial_text"} — partial_text는 64KB를 넘으면 뒤만 남김 (AC-12)"""
    value = value if isinstance(value, dict) else {}
    out = {"message": device_name(value.get("message"))[:200]}
    frac = value.get("fraction")
    if isinstance(frac, (int, float)) and not isinstance(frac, bool) and 0 <= frac <= 1:
        out["fraction"] = float(frac)
    if value.get("step") in ("queries", "search", "pick", "summary"):  # AI로 찾기 단계 (시안 5.1절)
        out["step"] = value["step"]
    counts = value.get("counts")
    if isinstance(counts, dict):
        out["counts"] = {k: int(v) for k, v in counts.items() if k in ("queries", "candidates", "picked", "pages_done", "pages_total")
                         and isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 100000}
    text = value.get("partial_text")
    if isinstance(text, str) and text:
        out["partial_text"] = text.encode("utf-8")[-PARTIAL_MAX:].decode("utf-8", "ignore")
    return out


# ====================================================================== CLI 잡기 (6.2 · 8.4절)
def claim_cli(lib: Library, device_id: int, engines: list[str], caps=()) -> dict | None:
    """caps: 워커가 할 수 있는 일(잡기 요청 본문 — 0.4.0은 ["local_text"]). 로컬 항목 작업(pinned_device_id)은
    보관 PC이면서 local_text를 하는 워커만 잡는다 — 옛 워커는 고정 작업을 받지 않음 (selective-sync.md 7.4절)"""
    if not engines:
        return None
    return lib._one(
        "with c as (select id from paperlab.jobs where user_id = %(uid)s and runner = 'cli' and status = 'queued' "
        "  and engine = any(%(eng)s) and not (excluded_devices @> to_jsonb(%(dev)s::bigint)) and not_before <= now() "
        "  and (pinned_device_id is null or (pinned_device_id = %(dev)s and %(local)s)) "
        "  order by created_at, id for update skip locked limit 1) "
        "update paperlab.jobs j set status = 'running', device_id = %(dev)s, lease_token = gen_random_uuid(), "
        "  lease_until = now() + make_interval(secs => %(lease)s), leased_at = now(), attempts = j.attempts + 1, "
        "  started_at = coalesce(j.started_at, now()), progress = case when j.kind = 'translate_paper' then j.progress "
        "  else '{}'::jsonb end, updated_at = now() "
        "from c where j.id = c.id returning j.*",
        {"uid": lib.uid, "eng": list(engines), "dev": device_id, "lease": LEASE_S, "local": LOCAL_CAP in (caps or ())})


def has_active_cli(lib: Library) -> bool:
    return bool(lib._one("select 1 from paperlab.jobs where user_id = %s and runner = 'cli' "
                         "and status in ('queued', 'running') limit 1", (lib.uid,)))


def paper_source(lib: Library, paper_id: int) -> dict | None:
    p = lib.get_paper(paper_id, detail=False)
    if not p:
        return None
    info = lib.pdf_info(paper_id) or {}
    loc = lib.local_info(paper_id) or {}
    local = loc.get("storage") == "local"
    return {"title": p["title"], "abstract": p.get("abstract") or "",
            "page_texts": [] if local else lib.page_texts(paper_id),
            "pdf_key": info.get("pdf_key") or "", "pdf_size": info.get("pdf_size") or 0,
            # 로컬 항목(PC에만 둔 파일 — selective-sync.md 7.4절): 본문은 보관 PC 워커가 로컬 파일에서
            "local": {"paper_id": paper_id, "sha256": loc.get("rep_sha") or "", "file_name": loc.get("file_name") or "",
                      "holder": loc.get("local_device_id")} if local else None}


def local_task(src: dict) -> dict:
    """작업 응답의 local 필드 (C-4): 워커가 main에 로컬 본문을 청할 때 쓴다. ext = 소문자 확장자,
    kind = "pdf" | "image" | "doc"(보관 PC 추출 방법 — 7.4절 · 15.4절 C-4 모두 맞춤)"""
    name = src["local"]["file_name"]
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    kind = "pdf" if ext == ".pdf" else "image" if ext in IMAGE_EXTS else "doc"
    return {"paper_id": src["local"]["paper_id"], "sha256": src["local"]["sha256"], "ext": ext, "kind": kind}


def write_sources(lib: Library, keys) -> list[dict]:
    """글쓰기 도우미가 참고할 내 논문 (인용키 → 제목 · 초록 · 요약 · 메모)"""
    sources = []
    for key, p in lib.papers_by_citekeys([str(k) for k in keys or []][:30]).items():
        summary = lib.get_summary(p["id"])
        highlights = [a["text"] + (f" — {a['comment']}" if a["comment"] else "")
                      for a in lib.list_annotations(p["id"])[:15] if a["text"]]
        note = "\n".join(filter(None, [p.get("note") or ""] + [f"하이라이트: {h}" for h in highlights]))
        sources.append({
            "key": key, "title": p["title"], "year": p.get("year"),
            "authors": ", ".join(" ".join(x for x in (a.get("given"), a.get("family"), a.get("literal")) if x)
                                 for a in (p.get("authors") or [])[:6]),
            "abstract": (p.get("abstract") or "")[:2500],
            "summary": (summary["data"].get("tldr", "") + " " + summary["data"].get("results", "")).strip() if summary else "",
            "note": note[:3000],
        })
    return sources


def text_request(lib: Library, job: dict, lang: str) -> tuple[str, str]:
    """(시스템, 프롬프트) — CLI 워커 · OpenAI · Google 공용. 프롬프트는 DB에 저장하지 않는다(K16)"""
    params = job["params"] or {}
    if job["kind"] == "write":
        return ai.write_request(params.get("mode") or "polish", params.get("text") or "",
                                instruction=params.get("instruction") or "", context=params.get("context") or "",
                                sources=write_sources(lib, params.get("keys")))
    if job["kind"] == "ms_chat":  # 원고 AI 대화 (mschat.py — 순환 가져오기를 피해 여기서)
        from . import mschat
        return mschat.build_request(lib, job)
    if job["kind"] == "chat" and job["paper_id"] is None:  # 범위 대화 — 출처는 params.sources로 고정(11.3절)
        scope = params.get("scope") or {}
        return rag.ask_request(lib, params, lib.scope_history(scope.get("type"), scope.get("id")), lang)
    if job["kind"] == "find":  # CLI 두 단계(13.2절): ① 검색어 ② 요약
        if not params.get("queries"):
            return find.query_request(params.get("question") or "")
        return find.summary_request(params.get("question") or "", params.get("candidates") or [])
    if job["kind"] in EXPLAIN_KINDS:  # 4단계: 쪽 문맥은 지금 page_texts에서
        return explain.build_request(lib, job["paper_id"], params)[:2]
    src = paper_source(lib, job["paper_id"])
    if not src:
        raise LookupError("paper gone")
    # 로컬 항목: 본문 대신 표지 하나 — 보관 PC 워커가 로컬 파일에서 뽑은 글로 바꾼다 (selective-sync.md 7.4절 · D-6)
    ctx = ai.PaperContext(title=src["title"], pdf_bytes=None, page_texts=src["page_texts"], abstract=src["abstract"],
                          local_text=src["local"] is not None)
    if job["kind"] == "summary":
        return ai.summary_request(ctx, lang)
    history = [{"role": m["role"], "content": m["content"]} for m in lib.chat_history(job["paper_id"])]
    return ai.chat_request(ctx, history, params.get("question") or "", lang)


def cli_task(lib: Library, job: dict) -> dict | None:
    """잡은 작업의 실행 내용(8.4절). 만들 수 없으면 작업을 실패로 바꾸고 None"""
    if paper_trashed(lib, job):
        return None
    settings = UserSettings(lib.get_settings())
    lang = settings.get("summary_language") or "한국어"
    params = job["params"] or {}
    schema = ai.SUMMARY_SCHEMA if job["kind"] == "summary" else None
    local = None
    loc = lib.local_info(job["paper_id"]) if job["paper_id"] is not None else None
    if loc and loc["storage"] == "local":
        # 로컬 항목(PC에만 둔 파일): 요약 · 논문 대화만, 보관 PC만 (서버가 막지만 이중 방어 — 7.4절)
        if job["kind"] not in LOCAL_AI_KINDS or job.get("pinned_device_id") != loc["local_device_id"]:
            # 요약 · 대화가 보관 PC에 묶이지 않았으면(서버에 있을 때 만든 작업) "선택 설명 · 번역" 안내 대신 멈춘 이유를
            _end(lib, job, "failed", "local_only", LOCAL_ONLY_CANCELLED if job["kind"] in LOCAL_AI_KINDS else LOCAL_ONLY_AI)
            return None
        local = local_task({"local": {"paper_id": job["paper_id"], "sha256": loc["rep_sha"] or "",
                                      "file_name": loc["file_name"] or "", "holder": loc["local_device_id"]}})
    try:
        if job["kind"] == "find" and params.get("queries") and not params.get("candidates"):
            find_hold(lib, job, params)  # 서버 검색이 아직 — 검색이 끝나면 다시 잡힘
            return None
        if job["kind"] == "verify":
            system, prompt, ids, remaining = verify.build_request(lib, job, lang)
            set_params(lib, job, {**params, "claim_ids": ids, "remaining": remaining})
            schema = verify.VERIFY_SCHEMA
        elif job["kind"] == "translate_paper":  # 잡기 한 번 = 묶음 하나 (4단계 K-6)
            prep = translate.prepare_chunk(lib, job)
            if prep is None:
                return None
            _, system, prompt = prep
            schema = translate.TRANSLATE_SCHEMA
        else:
            system, prompt = text_request(lib, job, lang)
            if job["kind"] == "find" and not params.get("queries"):
                schema = find.QUERY_SCHEMA
            elif job["kind"] == "explain":
                schema = explain.EXPLAIN_SCHEMA
    except ai.AIError as e:
        _end(lib, job, "failed", "input_too_large" if e.code == "input_too_large" else "bad_input", str(e))
        return None
    if len(prompt.encode("utf-8")) > PROMPT_MAX:
        _end(lib, job, "failed", "input_too_large", DEFAULT_ERRORS["input_too_large"])
        return None
    model = (settings.get("cli_models") or {}).get(job["engine"], "default")
    task = {"id": job["id"], "lease_token": str(job["lease_token"]), "lease_s": LEASE_S, "heartbeat_s": HEARTBEAT_S,
            "kind": job["kind"], "engine": job["engine"], "model": None if model == "default" else model,
            "output": "json" if schema else "text", "json_schema": schema,
            "stream_partial": not schema, "system": system, "prompt": prompt, "timeout_s": TIMEOUT_S[job["kind"]]}
    if local is not None:  # 프롬프트에 ai.LOCAL_TEXT_MARKER가 정확히 한 번 — 워커가 로컬 본문으로 바꿈 (C-4)
        task["local"] = local
    return task


def set_params(lib: Library, job: dict, params: dict) -> None:
    if len(json.dumps(params, ensure_ascii=False).encode("utf-8")) > PARAMS_MAX:
        raise ai.AIError("요청이 너무 커요", "input_too_large")
    lib._x("update paperlab.jobs set params = %s, updated_at = now() where id = %s and user_id = %s",
           (Jsonb(params), job["id"], lib.uid))
    job["params"] = params


def find_hold(lib: Library, job: dict, params: dict) -> str:
    """AI로 찾기 CLI ①단계 결과(검색어)를 적고 같은 칸으로 다시 대기 — 서버가 검색을 마칠 때까지 잡히지 않게 미뤄 둔다
    (attempts = 0, 대기 기한 그대로 — 13.2절). 검색은 ApiRunner.prepare_find가 하고 not_before를 지금으로 당긴다"""
    if job["cancel_requested"]:
        _end(lib, job, "cancelled")
        return "cancelled"
    lib._x("update paperlab.jobs set status = 'queued', params = %s, device_id = null, lease_token = null, "
           "lease_until = null, attempts = 0, progress = %s, not_before = now() + interval '1 day', updated_at = now() "
           "where id = %s and user_id = %s",
           (Jsonb(params), Jsonb({"message": "논문을 검색하는 중", "step": "search",
                                  "counts": {"queries": len(params.get("queries") or [])}}), job["id"], lib.uid))
    return "queued"


def parse_result(job: dict, text: str, structured=None) -> dict:
    """CLI · API 원문 → 반영할 결과 (종류별). 틀리면 AIError(bad_output)"""
    params = job["params"] or {}
    if job["kind"] == "find":
        if not params.get("queries"):
            return {"queries": find.parse_queries(text, structured, params.get("question") or "")}
        return {"answer": find.check_answer(text, len(params.get("candidates") or []))}
    if job["kind"] == "verify":
        return {"results": verify.parse_results(text, structured)}
    if job["kind"] in EXPLAIN_KINDS:
        return explain.parse(job["kind"], text, structured)
    return ai.parse_text_result(job["kind"], text, structured)


def worker_result(lib: Library, device_id: int, job_id: int, body: dict, guide: str = "") -> str:
    """POST /api/worker/jobs/{id}/result (8.6절) → 새 상태"""
    outcome = body.get("outcome")
    text = body.get("text") or ""
    if outcome not in ("succeeded", "failed", "cancelled") or not isinstance(text, str):
        raise JobError(400, "결과 형식이 올바르지 않아요", "bad_request")
    if len(text.encode("utf-8")) > RESULT_TEXT_MAX:
        raise JobError(400, "결과가 너무 길어요", "output_too_large")
    job = lock_leased(lib, job_id, body.get("lease_token"), device_id)
    if outcome == "cancelled":
        _end(lib, job, "cancelled")
        return "cancelled"
    if outcome == "failed":
        code = body.get("error_code") if body.get("error_code") in WORKER_CODES else "cli_exit"
        return fail_or_fallback(lib, job, code, body.get("error") or "", device_id=device_id, guide=guide)
    structured = body.get("structured") if isinstance(body.get("structured"), dict) else None
    try:
        parsed = parse_result(job, text, structured)
    except ai.AIError as e:
        _end(lib, job, "failed", "bad_output", str(e), _history_entry(job, "bad_output", device_id))
        return "failed"
    if "queries" in parsed:
        return find_hold(lib, job, {**(job["params"] or {}), "queries": parsed["queries"]})
    return finish_success(lib, job, parsed, f"cli:{job['engine']}")[0]


def heartbeat(lib: Library, device_id: int, items) -> list[dict]:
    if not isinstance(items, list) or len(items) > 16:
        raise JobError(400, "하트비트 형식이 올바르지 않아요", "bad_request")
    out = []
    for it in items:
        if not isinstance(it, dict) or not valid_id(it.get("id")):
            raise JobError(400, "하트비트 형식이 올바르지 않아요", "bad_request")
        tok = str(it.get("lease_token") or "")
        r = None
        if re.fullmatch(r"[0-9a-f-]{36}", tok):
            kind = lib._one("select kind from paperlab.jobs where id = %s and user_id = %s and device_id = %s",
                            (it["id"], lib.uid, device_id))
            if kind:  # 전체 번역은 서버가 적은 쪽 수 진행을 남긴다 (JSON 출력이라 중간 글도 없음)
                r = touch_lease(lib, it["id"], tok, renew=True, timeout_s=TIMEOUT_S[kind["kind"]],
                                progress=None if kind["kind"] == "translate_paper" else clean_progress(it.get("progress")))
        out.append({"id": it["id"], "ok": True, **r} if r else {"id": it["id"], "ok": False, "code": "lease_lost"})
    return out


# ====================================================================== API 실행기 잡기 (15.2절)
def claim_api(lib: Library, job_id: int, guide: str = "") -> dict | None:
    """API 실행기가 작업 하나를 잡는다. 리스가 지난 running은 다시 실행(최대 2회) — 넘으면 다음 칸 · lease_exhausted"""
    j = lib._one("select *, (lease_until < now()) as expired, (not_before <= now()) as ready from paperlab.jobs "
                 "where id = %s and user_id = %s and runner = 'api' for update skip locked", (job_id, lib.uid))
    if not j or j["status"] not in ("queued", "running"):
        return None
    if j["status"] == "running":
        if not j["expired"]:
            return None
        if j["interactive"]:
            _end(lib, j, "cancelled", "interrupted", interrupted_message(j["leased_at"]))
            return None
        if j["cancel_requested"]:
            _end(lib, j, "cancelled")
            return None
        if j["attempts"] >= API_MAX_ATTEMPTS:
            fail_or_fallback(lib, j, "lease_exhausted", DEFAULT_ERRORS["lease_exhausted"], guide=guide,
                             force_fallback=True)
            return None
    elif not j["ready"]:
        return None
    return lib._one("update paperlab.jobs set status = 'running', lease_token = gen_random_uuid(), "
                    "lease_until = now() + make_interval(secs => %s), leased_at = now(), attempts = attempts + 1, "
                    "started_at = coalesce(started_at, now()), " + _KEEP_PROGRESS + ", updated_at = now() "
                    "where id = %s and user_id = %s returning *", (LEASE_S, job_id, lib.uid))


def translate_next(lib: Library, job: dict, progress: dict) -> None:
    """전체 번역 묶음 하나를 반영한 뒤 같은 작업을 다시 대기로 (find_hold와 같은 모양 — 4단계 6.3절 4번 ③):
    attempts = 0, 바로 잡을 수 있게, CLI 대기 기한은 지금부터 다시 24시간, 진행(쪽 수)은 남김.
    API 실행기는 이 작업을 대기열 뒤로 다시 넣는다 — 다른 사용자 작업이 사이에 끼어든다(AC-P12)"""
    lib._x("update paperlab.jobs set status = 'queued', device_id = null, lease_token = null, lease_until = null, "
           "attempts = 0, progress = %s, not_before = now(), deadline_at = now() + make_interval(secs => %s), "
           "updated_at = now() where id = %s and user_id = %s",
           (Jsonb(clean_progress(progress)), DEADLINE_S["translate_paper"], job["id"], lib.uid))
