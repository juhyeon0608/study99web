"""워커 API `/api/worker/*` — 기기 토큰 인증 · 연결 · 인사 · 잡기 · 하트비트 · 결과 (2단계 명세 8장).

- 기기 토큰 `pld1.<uid>.<device_id>.<비밀>`: uid · device_id로 **그 사용자 트랜잭션**(`actor_claims`)을 열고 비밀의 SHA-256을
  `devices.token_hash`와 상수 시간 비교(K5 ① — service role 없음). Supabase JWT는 여기서 받지 않는다(AC-19).
- 토큰 · 연결 코드는 로그에 남기지 않는다 — 접근 로그는 미들웨어가 경로 · 상태만, 이 모듈은 device_id만.
"""

from __future__ import annotations

import hmac
import logging
import threading
import time
from collections import deque
from contextlib import contextmanager

from fastapi import Body, FastAPI, Request
from fastapi.responses import JSONResponse

from . import jobs
from .auth import NotAllowed, bearer_token
from .db import Database, actor_claims, iso, now_dt

log = logging.getLogger("paperlab.worker")

DEVICE_AUTH = {"detail": "PC 연결이 필요해요", "code": "device_auth_required"}
DEVICE_REVOKED = {"detail": "이 PC 연결이 해지됐어요", "code": "device_revoked"}
PROTOCOL = 1
LOCAL_IPS = ("127.0.0.1", "::1")  # Funnel이 X-Forwarded-For를 붙이지 않으면 모든 요청이 이 주소 → IP별로 나눌 수 없음


class WindowLimit:
    """창 안 횟수 제한 (메모리, 서버 프로세스 하나 — 가정). clock은 테스트가 주입"""

    def __init__(self, limit: int, window_s: float, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window_s, clock
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> bool:
        """이번 요청을 세고, 한도 안이면 True"""
        with self._lock:
            now = self.clock()
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] >= self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            if len(self._hits) > 10000:  # 오래된 키 정리 (메모리 상한)
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] >= self.window]:
                    del self._hits[k]
            return True


def client_ip(request: Request) -> str:
    """uvicorn이 127.0.0.1(Funnel · tailscaled)의 X-Forwarded-For만 믿고 풀어 준 주소 (serve.py)"""
    return request.client.host if request.client else ""


class WorkerState:
    """워커 관련 메모리 상태: 기기별 마지막 빈 자리(waiting_reason), 사용자 최근 화면 활동(적응형 폴링)"""

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.free: dict[int, dict] = {}
        self.activity: dict[str, float] = {}
        self.swept: dict[str, float] = {}
        self.pair_ip = WindowLimit(10, 60, clock)   # IP당 분당 10
        self.pair_all = WindowLimit(60, 60, clock)  # 전체 분당 60 (X-Forwarded-For가 없어 주소가 127.0.0.1이면 이것만)

    def seen_user(self, uid: str) -> None:
        self.activity[uid] = self.clock()

    def recently_active(self, uid: str) -> bool:
        return self.clock() - self.activity.get(uid, -1e9) < jobs.ACTIVE_WINDOW_S

    def should_sweep(self, uid: str) -> bool:
        now = self.clock()
        if now - self.swept.get(uid, -1e9) < 600:
            return False
        self.swept[uid] = now
        return True


def register(app: FastAPI, db: Database, allowlist, ws: WorkerState, guide, runner) -> None:
    """guide() → 경로가 없을 때 안내 문구, runner = ApiRunner(폴백으로 API 칸이 되면 넣음)"""

    def err(status: int, body: dict) -> JSONResponse:
        return JSONResponse(body, status_code=status)

    @contextmanager
    def device_tx(request: Request):
        """기기 토큰 확인 → (lib, 기기 행) 그 사용자 트랜잭션. 실패는 _Deny"""
        parsed = jobs.parse_token(bearer_token(request.headers.get("authorization")) or "")
        if not parsed:
            raise _Deny(401, DEVICE_AUTH)
        uid, dev_id, secret = parsed
        with db.user_tx(actor_claims(uid, f"device:{dev_id}")) as lib:
            d = lib._one("select d.*, p.email from paperlab.devices d left join paperlab.profiles p on p.user_id = d.user_id "
                         "where d.id = %s and d.user_id = %s", (dev_id, uid))
            if not d or not hmac.compare_digest(d["token_hash"], jobs.sha256_hex(secret)):
                raise _Deny(401, DEVICE_AUTH)
            if d["revoked_at"] is not None:
                raise _Deny(401, DEVICE_REVOKED)
            try:
                allowlist.check({"email": d["email"] or ""})
            except NotAllowed:
                raise _Deny(403, {"detail": "허용되지 않은 계정이에요", "code": "not_allowed"}) from None
            request.state.device_id = dev_id
            yield lib, d

    def handle(request: Request, fn):
        try:
            with device_tx(request) as (lib, d):
                out = fn(lib, d)
        except _Deny as e:
            return err(e.status, e.body)
        except jobs.JobError as e:
            return err(e.status, {"detail": e.detail, "code": e.code})
        if isinstance(out, tuple):  # (본문, 커밋 뒤 할 일)
            out, after = out
            after()
        return out

    def enqueue_if_api(lib, job_id: int) -> None:
        r = lib._one("select user_id from paperlab.jobs where id = %s and user_id = %s and runner = 'api' "
                     "and status = 'queued'", (job_id, lib.uid))
        return (lambda: runner.enqueue(job_id, str(r["user_id"]))) if r else (lambda: None)

    def version_gate(body: dict, d: dict) -> JSONResponse | None:
        try:
            protocol = int(body.get("protocol", PROTOCOL))
        except (TypeError, ValueError):
            protocol = 0
        if protocol < jobs.MIN_PROTOCOL or jobs.update_required(d["app_version"]):
            return err(426, {"detail": "PaperLab 앱을 업데이트해 주세요", "code": "update_required",
                             "min_app_version": jobs.MIN_APP_VERSION, "min_protocol": jobs.MIN_PROTOCOL})
        return None

    @app.post("/api/worker/pair")
    def pair(request: Request, body: dict = Body(...)):
        ip = client_ip(request)
        if (ip not in LOCAL_IPS and not ws.pair_ip.hit(ip)) or not ws.pair_all.hit("all"):
            return err(429, {"detail": "잠시 후 다시 시도해 주세요", "code": "rate_limited"})
        bad = err(400, {"detail": jobs.BAD_CODE, "code": "bad_code"})
        code = jobs.normalize_code(body.get("code"))
        name = jobs.device_name(body.get("name"), "내 PC") or "내 PC"
        if len(code) != 8:
            return bad
        with db.system_tx("device pairing") as conn:
            row = jobs.find_pair_code(conn, code)
        if not row:
            return bad
        uid = str(row["user_id"])
        try:
            with db.user_tx(actor_claims(uid, "device:pairing")) as lib:
                prof = lib._one("select email from paperlab.profiles where user_id = %s", (uid,))
                allowlist.check({"email": (prof or {}).get("email") or ""})
                dev, token = jobs.create_device(lib, row["id"], name, jobs.device_name(body.get("os"))[:120],
                                                jobs.device_name(body.get("app_version"))[:40])
        except NotAllowed:
            return err(403, {"detail": "허용되지 않은 계정이에요", "code": "not_allowed"})
        except jobs.JobError as e:
            return err(e.status, {"detail": e.detail, "code": e.code})
        log.info("device paired device_id=%s", dev)
        # 토큰 원문은 이 응답에서 한 번만 나간다 (8.2절)
        return {"device_id": dev, "token": token, "name": name, "account_hint": jobs.mask_email((prof or {}).get("email"))}

    @app.post("/api/worker/hello")
    def hello(request: Request, body: dict = Body(...)):
        def work(lib, d):
            engines = jobs.clean_engines(body.get("engines", d["engines"] or []))
            version = jobs.device_name(body.get("app_version", d["app_version"]))[:40]
            jobs.touch_device(lib, d["id"], engines=engines, app_version=version, paused=body.get("paused") is True,
                              os=jobs.device_name(body.get("os", d["os"]))[:120])
            d = {**d, "app_version": version}
            gate = version_gate(body, d)
            if gate:
                return gate
            return {"device_id": d["id"], "name": d["name"], "account_hint": jobs.mask_email(d["email"]),
                    "min_protocol": jobs.MIN_PROTOCOL, "min_app_version": jobs.MIN_APP_VERSION,
                    "poll": {"idle_s": jobs.POLL_IDLE_S, "active_s": jobs.POLL_ACTIVE_S}, "server_time": iso(now_dt())}
        return handle(request, work)

    @app.post("/api/worker/claim")
    def claim(request: Request, body: dict = Body(default={})):
        def work(lib, d):
            gate = version_gate({}, d)
            if gate:
                return gate
            free = body.get("free") or {}
            if not isinstance(free, dict) or any(k not in jobs.ENGINES or not isinstance(v, int) or isinstance(v, bool)
                                                 or not 0 <= v <= 8 for k, v in free.items()):
                raise jobs.JobError(400, "빈 자리 형식이 올바르지 않아요", "bad_request")
            paused = body.get("paused") is True
            jobs.touch_device(lib, d["id"], paused=paused)
            ws.free[d["id"]] = dict(free)
            jobs.expire(lib)
            if paused:
                return {"job": None, "next_poll_s": jobs.POLL_IDLE_S}
            ready = [e for e, n in free.items() if n > 0 and (jobs._engine(d, e) or {}).get("logged_in")]
            job = jobs.claim_cli(lib, d["id"], ready)
            if not job:
                active = jobs.has_active_cli(lib) or ws.recently_active(lib.uid)
                return {"job": None, "next_poll_s": jobs.POLL_ACTIVE_S if active else jobs.POLL_IDLE_S}
            log.info(f"job claimed job={job['id']} kind={job['kind']} engine={job['engine']} device_id={d['id']}")
            task = jobs.cli_task(lib, job)
            # 하나 잡은 직후는 0초 — 빈 자리가 남았으면 곧바로 다시 (10.2절)
            return {"job": task, "next_poll_s": 0}
        return handle(request, work)

    @app.post("/api/worker/heartbeat")
    def heartbeat(request: Request, body: dict = Body(...)):
        def work(lib, d):
            jobs.touch_device(lib, d["id"])
            return {"jobs": jobs.heartbeat(lib, d["id"], body.get("jobs"))}
        return handle(request, work)

    @app.post("/api/worker/jobs/{job_id}/result")
    def result(job_id: int, request: Request, body: dict = Body(...)):
        def work(lib, d):
            jobs.touch_device(lib, d["id"])
            status = jobs.worker_result(lib, d["id"], job_id, body, guide())
            log.info(f"job result job={job_id} outcome={body.get('outcome')} status={status} device_id={d['id']}")
            return {"status": status}, enqueue_if_api(lib, job_id)
        return handle(request, work)

    @app.post("/api/worker/bye")
    def bye(request: Request, body: dict = Body(default={})):
        def work(lib, d):
            lib._x("update paperlab.devices set last_seen_at = null, paused = %s, updated_at = now() "
                   "where id = %s and user_id = %s", (body.get("paused") is True, d["id"], lib.uid))
            ws.free.pop(d["id"], None)
            return {"ok": True}
        return handle(request, work)


class _Deny(Exception):
    def __init__(self, status: int, body: dict):
        super().__init__(body.get("code"))
        self.status, self.body = status, body
