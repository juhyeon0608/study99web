"""서버 프로세스 안 API 실행기 (2단계 명세 15.2절 — 팀장 결정 K2').

- 실행 스레드 N개(기본 4) + 메모리 대기열 `(job_id, user_id)` + 리스 연장 스레드 + 복구 스캔(시작 때 · 60초마다).
- 잡기 · 진행 · 반영은 모두 그 사용자의 `actor_claims(uid, "api-runner")` 트랜잭션. 관리 권한은 복구 스캔의
  `system_tx("api job recovery")` 한 곳 — jobs의 id · user_id만 읽는다(5.6절, AC-23).
- 바깥에서 부를 수 있는 HTTP 경로가 없다(AC-40). 서버가 재시작되면 리스가 지난 작업을 복구 스캔이 다시 잡는다.
"""

from __future__ import annotations

import logging
import queue
import threading
import time
from typing import Callable

from . import jobs
from .ai import AIError, PaperContext
from .db import Database, DBUnavailable, actor_claims
from .storage import NotFound, UserStorage

log = logging.getLogger("paperlab.api_runner")

RECOVERY_SQL = ("select id, user_id from paperlab.jobs where runner = 'api' and ((status = 'queued' and not_before <= now()) "
                "or (status = 'running' and lease_until < now())) order by id limit 100")


class _Cancelled(Exception):
    pass


class ApiRunner:
    def __init__(self, db: Database, storage, settings_loader: Callable, ai_factory: Callable, guide: Callable[[], str],
                 *, threads: int = 4, per_user: int = 2, scan_s: float = 60.0, renew_s: float = jobs.HEARTBEAT_S,
                 max_pdf_bytes: int = 0):
        """settings_loader(lib, uid) → UserSettings(복호화한 키 포함), ai_factory(get) → AIService"""
        self.db, self.storage = db, storage
        self.settings_loader, self.ai_factory, self.guide = settings_loader, ai_factory, guide
        self.threads, self.per_user, self.scan_s, self.renew_s = threads, per_user, scan_s, renew_s
        self.max_pdf_bytes = max_pdf_bytes
        self.q: queue.Queue = queue.Queue()
        self._lock = threading.Lock()
        self.queued: set[int] = set()
        self.claiming: dict[int, str] = {}   # job_id → uid (잡는 중 — 사용자당 동시 수에 셈)
        self.running: dict[int, dict] = {}   # job_id → {"uid", "token", "cancel": Event} (리스를 잡은 뒤에만)
        self._stop = threading.Event()
        self._started = False
        self._workers: list[threading.Thread] = []

    # ---------------------------------------------------------------- 수명
    def start(self, scan: bool = True) -> None:
        with self._lock:
            if self._started:
                return
            self._started = True
        self._stop.clear()
        for i in range(self.threads):
            self._spawn(self._work, f"api-runner-{i}")
        self._spawn(self._renew_loop, "api-runner-lease")
        if scan:
            self._spawn(self._scan_loop, "api-runner-scan")

    def _spawn(self, fn, name: str) -> None:
        t = threading.Thread(target=fn, name=name, daemon=True)
        t.start()
        self._workers.append(t)

    def stop(self, timeout: float = 5.0) -> None:
        """새 작업을 꺼내지 않는다. 실행 중 작업은 그대로(리스가 지나면 다음 시작의 복구 스캔이 이어받음)"""
        self._stop.set()
        for t in self._workers:
            t.join(timeout)
        self._workers.clear()
        with self._lock:
            self._started = False

    def enqueue(self, job_id: int, uid: str) -> None:
        with self._lock:
            if job_id in self.queued or job_id in self.running or job_id in self.claiming:
                return
            self.queued.add(job_id)
        self.q.put((job_id, uid))

    def scan_once(self) -> int:
        try:
            with self.db.system_tx("api job recovery") as conn:
                rows = conn.execute(RECOVERY_SQL).fetchall()
        except DBUnavailable:
            return 0
        for r in rows:
            self.enqueue(r["id"], str(r["user_id"]))
        return len(rows)

    def _scan_loop(self) -> None:
        while not self._stop.is_set():
            self.scan_once()
            self._stop.wait(self.scan_s)

    def _renew_loop(self) -> None:
        """실행 중 작업의 리스를 30초마다 연장하고 취소 요청을 읽는다(스트림이 없는 OpenAI · Google 호출 중에도)"""
        while not self._stop.wait(self.renew_s):
            for job_id, r in list(self.running.items()):
                try:
                    with self.db.user_tx(actor_claims(r["uid"], "api-runner")) as lib:
                        res = jobs.touch_lease(lib, job_id, r["token"], renew=True)
                    if res is None or res["cancel"]:
                        r["cancel"].set()
                except Exception as e:  # noqa: BLE001 - 연장 스레드는 어떤 오류에도 죽지 않는다 (다음 주기에 다시)
                    log.warning("api lease renew failed job=%s: %s", job_id, type(e).__name__)

    # ---------------------------------------------------------------- 실행
    def _work(self) -> None:
        while not self._stop.is_set():
            try:
                job_id, uid = self.q.get(timeout=0.2)
            except queue.Empty:
                continue
            with self._lock:
                busy = (sum(1 for r in self.running.values() if r["uid"] == uid)
                        + sum(1 for u in self.claiming.values() if u == uid)) >= self.per_user
                if not busy:
                    self.queued.discard(job_id)
                    self.claiming[job_id] = uid  # 잡는 중 — 리스 토큰이 생기면 running에 등록 (연장 스레드는 running만 봄)
            if busy:  # 사용자당 동시 2개 — 대기열 뒤로 (6.7절)
                self.q.put((job_id, uid))
                time.sleep(0.05)
                continue
            try:
                self._run(job_id, uid)
            except DBUnavailable:
                log.warning("api job db unavailable job=%s", job_id)
            except Exception as e:  # noqa: BLE001 - 실행기 스레드는 죽지 않는다 (리스가 지나면 복구 스캔이 다시)
                log.warning("api job crashed job=%s: %s", job_id, type(e).__name__)
            finally:
                with self._lock:
                    self.claiming.pop(job_id, None)
                    self.running.pop(job_id, None)

    def _tx(self, uid: str):
        return self.db.user_tx(actor_claims(uid, "api-runner"))

    def _run(self, job_id: int, uid: str) -> None:
        guide = self.guide()
        with self._tx(uid) as lib:
            job = jobs.claim_api(lib, job_id, guide)
            if not job:
                return
            settings = self.settings_loader(lib, uid)
            src = jobs.paper_source(lib, job["paper_id"]) if job["kind"] != "write" else None
            if job["kind"] == "chat":
                history = [{"role": m["role"], "content": m["content"]} for m in lib.chat_history(job["paper_id"])]
            if job["kind"] == "write":
                sources = jobs.write_sources(lib, (job["params"] or {}).get("keys"))
        token = str(job["lease_token"])
        state = {"uid": uid, "token": token, "cancel": threading.Event()}
        with self._lock:
            self.claiming.pop(job_id, None)
            self.running[job_id] = state
        log.info(f"api job start job={job_id} kind={job['kind']} engine={job['engine']}")
        ai = self.ai_factory(settings.get)
        last = {"t": 0.0, "msg": None}

        def progress(message: str, frac: float | None) -> None:
            """1초에 한 번까지 진행을 쓰고, 그때 취소 요청을 읽는다(6.5절 — 스트림 이벤트 사이마다)"""
            if state["cancel"].is_set():
                raise _Cancelled()
            now = time.monotonic()
            if now - last["t"] < 1.0 and message == last["msg"]:
                return
            last.update(t=now, msg=message)
            with self._tx(uid) as lib2:
                res = jobs.touch_lease(lib2, job_id, token, progress=jobs.clean_progress(
                    {"message": message, "fraction": frac}))
            if res is None or res["cancel"]:
                state["cancel"].set()
                raise _Cancelled()

        params = job["params"] or {}
        engine = job["engine"]
        try:
            if job["kind"] == "summary":
                if src is None:
                    return
                parsed = {"summary": ai.summarize(self._context(uid, src, engine), progress, engine=engine)}
            elif job["kind"] == "chat":
                if src is None:
                    return
                parsed = _collect(ai.chat(self._context(uid, src, engine), history, params.get("question") or "",
                                          engine=engine), progress)
            else:
                parsed = _collect(ai.write(params.get("mode") or "polish", params.get("text") or "",
                                           instruction=params.get("instruction") or "",
                                           context=params.get("context") or "", sources=sources, engine=engine), progress)
            if state["cancel"].is_set():
                raise _Cancelled()
        except _Cancelled:
            with self._tx(uid) as lib:
                try:
                    j = jobs.lock_leased(lib, job_id, token)
                except jobs.JobError:
                    return
                jobs._end(lib, j, "cancelled")
            log.info(f"api job cancelled job={job_id}")
            return
        except AIError as e:
            code = e.code if e.code else "api_server"
            with self._tx(uid) as lib:
                try:
                    j = jobs.lock_leased(lib, job_id, token)
                except jobs.JobError:
                    return
                jobs.record_key_error(lib, engine, code)
                status = jobs.fail_or_fallback(lib, j, code, str(e), guide=guide)
                again = status == "queued" and lib._one(
                    "select 1 from paperlab.jobs where id = %s and user_id = %s and runner = 'api'", (job_id, uid))
            log.info(f"api job failed job={job_id} code={code} status={status}")
            if again:
                with self._lock:
                    self.running.pop(job_id, None)
                self.enqueue(job_id, uid)
            return
        with self._tx(uid) as lib:
            try:
                j = jobs.lock_leased(lib, job_id, token)
            except jobs.JobError:
                return  # 리스를 잃음 — 다른 실행이 맡았거나 지워짐: 결과는 버린다 (한 번만 반영)
            status, _ = jobs.finish_success(lib, j, parsed, ai.model_name(engine))
        log.info(f"api job done job={job_id} status={status}")

    def _context(self, uid: str, src: dict, engine: str) -> PaperContext:
        """PDF는 Anthropic(claude)일 때만 받는다 — OpenAI · Google은 본문 글만(9.5절)"""
        data = None
        if engine == "claude" and src["pdf_key"] and src["pdf_size"] <= self.max_pdf_bytes:
            try:
                us = UserStorage(self.storage, uid)
                data = us.get(us.check(src["pdf_key"]))
            except NotFound:
                data = None
        return PaperContext(title=src["title"], pdf_bytes=data, page_texts=src["page_texts"], abstract=src["abstract"])


def _collect(events, progress) -> dict:
    """대화 · 글쓰기 이벤트 → 마지막 done. 중간 글은 진행(partial)으로는 남기지 않는다(실행기는 화면과 연결이 없음)"""
    done = None
    for ev in events:
        progress("답을 만드는 중", None)
        if ev.get("type") == "done":
            done = ev
    if not done:
        raise AIError("AI 응답이 비어 있어요", "bad_output")
    return {"text": done.get("text") or "", "citations": done.get("citations") or []}
