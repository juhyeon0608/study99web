"""서버 프로세스 안 API 실행기 (2단계 명세 15.2절 — 팀장 결정 K2').

- 실행 스레드 N개(기본 4) + 메모리 대기열 `(job_id, user_id)` + 리스 연장 스레드 + 복구 스캔(시작 때 · 60초마다).
- 잡기 · 진행 · 반영은 모두 그 사용자의 `actor_claims(uid, "api-runner")` 트랜잭션. 관리 권한은 복구 스캔의
  `system_tx("api job recovery")` 한 곳 — jobs의 id · user_id만 읽는다(5.6절, AC-23).
- 바깥에서 부를 수 있는 HTTP 경로가 없다(AC-40). 서버가 재시작되면 리스가 지난 작업을 복구 스캔이 다시 잡는다.
- 3단계: index(서버 안 색인 — 서버 전체 동시 1개, K-2) · find(AI로 찾기) · verify(인용 검증) · 범위 대화(chat, paper_id 없음).
  AI로 찾기 CLI 경로의 서버 검색(13.2절 ②)도 여기서(`prepare_find`) — 워커 잡기 요청이 DB 연결을 오래 잡지 않게.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from typing import Callable

from psycopg.types.json import Jsonb

from . import find, jobs, rag, verify
from .ai import AIError, PaperContext
from .db import Database, DBUnavailable, actor_claims
from .storage import NotFound, UserStorage

log = logging.getLogger("paperlab.api_runner")

RECOVERY_SQL = ("select id, user_id from paperlab.jobs where runner = 'api' and ((status = 'queued' and not_before <= now()) "
                "or (status = 'running' and lease_until < now())) order by id limit 100")
# AI로 찾기 CLI ①단계 뒤 서버 검색을 기다리는 작업 (재시작으로 검색이 끊겼을 때 — 13.2절)
FIND_HELD_SQL = ("select id, user_id from paperlab.jobs where kind = 'find' and runner = 'cli' and status = 'queued' "
                 "and params ? 'queries' and not params ? 'candidates' order by id limit 100")
_HELD_COND = "kind = 'find' and status = 'queued' and params ? 'queries' and not params ? 'candidates'"


class _Cancelled(Exception):
    pass


class ApiRunner:
    def __init__(self, db: Database, storage, settings_loader: Callable, ai_factory: Callable, guide: Callable[[], str],
                 *, threads: int = 4, per_user: int = 2, scan_s: float = 60.0, renew_s: float = jobs.HEARTBEAT_S,
                 max_pdf_bytes: int = 0, rag: "rag.Rag | None" = None, sources_factory: Callable | None = None):
        """settings_loader(lib, uid) → UserSettings(복호화한 키 포함), ai_factory(get) → AIService,
        rag = 3단계 색인 · 검색(서버 하나에 하나), sources_factory(get) → Sources(AI로 찾기)"""
        self.db, self.storage = db, storage
        self.rag, self.sources_factory = rag, sources_factory
        self.iq: queue.Queue = queue.Queue()  # 색인 전용 대기열 — 전용 스레드 1개가 서버 전체 동시 1개로 실행 (K-2)
        self._preparing: set[int] = set()
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
        self._spawn(self._index_work, "api-runner-index")
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
                held = conn.execute(FIND_HELD_SQL).fetchall()
        except DBUnavailable:
            return 0
        for r in rows:
            self.enqueue(r["id"], str(r["user_id"]))
        for r in held:
            self.prepare_find(r["id"], str(r["user_id"]))
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

    def _index_work(self) -> None:
        """색인 전용 스레드: index만 잡는다. 일반 실행 스레드는 색인을 기다리지 않는다 (품질팀 재확인 — 여러 명 동시 색인)"""
        while not self._stop.is_set():
            try:
                job_id, uid = self.iq.get(timeout=0.2)
            except queue.Empty:
                continue
            with self._lock:
                self.queued.discard(job_id)
                self.claiming[job_id] = uid
            try:
                self._run_index(job_id, uid, self.guide())
            except DBUnavailable:
                log.warning("index job db unavailable job=%s", job_id)
            except Exception as e:  # noqa: BLE001 - 색인 스레드는 죽지 않는다 (리스가 지나면 복구 스캔이 다시)
                log.warning("index job crashed job=%s: %s", job_id, type(e).__name__)
            finally:
                with self._lock:
                    self.claiming.pop(job_id, None)
                    self.running.pop(job_id, None)

    def _tx(self, uid: str):
        return self.db.user_tx(actor_claims(uid, "api-runner"))

    def _run(self, job_id: int, uid: str) -> None:
        guide = self.guide()
        with self._tx(uid) as lib:
            peek = lib._one("select kind from paperlab.jobs where id = %s and user_id = %s", (job_id, uid))
        if peek and peek["kind"] == "index":  # 잡지 않고 색인 전용 대기열로 넘김 (대기 표시는 유지 — 중복 넣기 방지)
            with self._lock:
                self.queued.add(job_id)
            self.iq.put((job_id, uid))
            return
        with self._tx(uid) as lib:
            job = jobs.claim_api(lib, job_id, guide)
            if not job:
                return
            settings = self.settings_loader(lib, uid)
            lang = settings.get("summary_language") or "한국어"
            params = job["params"] or {}
            scoped = job["kind"] == "chat" and job["paper_id"] is None
            src = jobs.paper_source(lib, job["paper_id"]) if job["kind"] in ("summary", "chat") and not scoped else None
            try:
                if scoped:  # 범위 대화 — 출처는 params.sources (11.3절)
                    scope = params.get("scope") or {}
                    request = rag.ask_request(lib, params, lib.scope_history(scope.get("type"), scope.get("id")), lang)
                elif job["kind"] == "chat":
                    history = [{"role": m["role"], "content": m["content"]} for m in lib.chat_history(job["paper_id"])]
                elif job["kind"] == "verify":
                    system, prompt, ids, remaining = verify.build_request(lib, job, lang)
                    jobs.set_params(lib, job, {**params, "claim_ids": ids, "remaining": remaining})
                    request = (system, prompt)
            except AIError as e:
                jobs._end(lib, job, "failed", "bad_input", str(e))
                return
            if job["kind"] == "write":
                sources = jobs.write_sources(lib, params.get("keys"))
        token = str(job["lease_token"])
        state = {"uid": uid, "token": token, "cancel": threading.Event()}
        with self._lock:
            self.claiming.pop(job_id, None)
            self.running[job_id] = state
        log.info(f"api job start job={job_id} kind={job['kind']} engine={job['engine']}")
        ai = self.ai_factory(settings.get)
        last = {"t": 0.0, "msg": None}

        def progress(message: str, frac: float | None, **extra) -> None:
            """1초에 한 번까지 진행을 쓰고, 그때 취소 요청을 읽는다(6.5절 — 스트림 이벤트 사이마다)"""
            if state["cancel"].is_set():
                raise _Cancelled()
            now = time.monotonic()
            if now - last["t"] < 1.0 and message == last["msg"]:
                return
            last.update(t=now, msg=message)
            with self._tx(uid) as lib2:
                res = jobs.touch_lease(lib2, job_id, token, progress=jobs.clean_progress(
                    {"message": message, "fraction": frac, **extra}))
            if res is None or res["cancel"]:
                state["cancel"].set()
                raise _Cancelled()

        engine = job["engine"]
        try:
            if scoped or job["kind"] == "verify":
                schema = (verify.VERIFY_SCHEMA, "verify_results") if job["kind"] == "verify" else (None, "result")
                parsed = _collect(ai.complete(*request, engine=engine, schema=schema[0], schema_name=schema[1]), progress)
                if job["kind"] == "verify":
                    parsed = {"results": verify.parse_results(parsed["text"])}
            elif job["kind"] == "find":
                parsed = self._find(ai, engine, uid, job, settings, progress)
            elif job["kind"] == "summary":
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
        except find.FindError as e:  # 검색이 모두 실패 — 폴백 없이 실패(13.1절 3)
            with self._tx(uid) as lib:
                try:
                    j = jobs.lock_leased(lib, job_id, token)
                except jobs.JobError:
                    return
                jobs._end(lib, j, "failed", "search_failed", str(e))
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

    # ---------------------------------------------------------------- 3단계
    def _find(self, ai, engine: str, uid: str, job: dict, settings, progress) -> dict:
        """AI로 찾기 API 경로(13.2절): 검색어 → 검색 · 고르기 → 요약을 한 번에. 후보는 params에 적어 반영 · 24시간 정리에 씀"""
        params = dict(job["params"] or {})
        question = params.get("question") or ""
        progress("검색어를 만드는 중", 0.05, step="queries")
        if not params.get("queries"):
            system, prompt = find.query_request(question)
            params["queries"] = find.parse_queries(ai.complete_text(system, prompt, engine, find.QUERY_SCHEMA, "queries"),
                                                   None, question)
        if "candidates" not in params:
            counts = {"queries": len(params["queries"])}
            progress("논문을 검색하는 중", 0.2, step="search", counts=counts)
            params["candidates"], params["warnings"], params["counts"] = find.prepare(
                self.sources_factory(settings.get), self.rag.embedder if self.rag else None, question, params["queries"])
            with self._tx(uid) as lib:
                jobs.set_params(lib, job, params)
        counts = params.get("counts") or {}
        if not params["candidates"]:
            return {"answer": ""}
        progress("한국어 요약을 쓰는 중", 0.6, step="summary", counts=counts)
        system, prompt = find.summary_request(question, params["candidates"])
        return {"answer": find.check_answer(ai.complete_text(system, prompt, engine), len(params["candidates"]))}

    def _run_index(self, job_id: int, uid: str, guide: str) -> None:
        """색인 작업(10.1절): 그 사용자의 대기 논문을 한 편씩(편마다 짧은 트랜잭션). 끝내기 직전 같은 트랜잭션에서
        한 번 더 세고 0일 때만 succeeded — 그 사이 새로 들어온 논문도 빠지지 않는다(AC-I03)"""
        with self._tx(uid) as lib:
            job = jobs.claim_api(lib, job_id, guide)
        if not job or self.rag is None:
            return
        token = str(job["lease_token"])
        state = {"uid": uid, "token": token, "cancel": threading.Event()}
        with self._lock:
            self.claiming.pop(job_id, None)
            self.running[job_id] = state
        done = chunks = 0
        skip: set[int] = set()
        started = time.monotonic()
        while True:
            if self._stop.is_set():  # 서버 멈춤: 작업은 그대로 두고 나감 (리스가 지나면 다음 시작의 복구 스캔이 이어받음)
                return
            if state["cancel"].is_set():
                with self._tx(uid) as lib:
                    try:
                        jobs._end(lib, jobs.lock_leased(lib, job_id, token), "cancelled")
                    except jobs.JobError:
                        pass
                return
            res = self.rag.index_next(lambda: self._tx(uid), uid, skip)
            with self._tx(uid) as lib:
                if res is None:
                    try:
                        j = jobs.lock_leased(lib, job_id, token)
                    except jobs.JobError:
                        return
                    if self.rag.pending_count(lib) == 0:
                        jobs._end(lib, j, "succeeded", result={"papers": done})
                        break
                    if self.rag.pending_count(lib, skip) == 0:
                        jobs._end(lib, j, "failed", "index_failed", jobs.DEFAULT_ERRORS["index_failed"])
                        break
                    continue
                if "error" in res:
                    skip.add(res["paper_id"])
                else:
                    done += 1
                    chunks += res["chunks"]
                total = done + len(skip) + self.rag.pending_count(lib, skip)
                r = jobs.touch_lease(lib, job_id, token, progress=jobs.clean_progress(
                    {"message": f"색인 중 {done}/{total}편", "fraction": done / total if total else 1.0}))
            if r is None or r["cancel"]:
                state["cancel"].set()
        log.info(json.dumps({"event": "index", "papers": done, "chunks": chunks, "failed": len(skip),
                             "ms": int((time.monotonic() - started) * 1000), "embed": self.rag.embedder is not None}))

    def prepare_find(self, job_id: int, uid: str) -> None:
        """AI로 찾기 CLI ②단계 전 서버 검색을 백그라운드로(같은 작업은 한 번만)"""
        with self._lock:
            if job_id in self._preparing:
                return
            self._preparing.add(job_id)

        def run():
            try:
                self._prepare_find(job_id, uid)
            except Exception as e:  # noqa: BLE001 - 다음 복구 스캔이 다시
                log.warning("find prepare failed job=%s: %s", job_id, type(e).__name__)
            finally:
                with self._lock:
                    self._preparing.discard(job_id)
        threading.Thread(target=run, name=f"find-prepare-{job_id}", daemon=True).start()

    def _prepare_find(self, job_id: int, uid: str) -> None:
        sql = f"select * from paperlab.jobs where id = %s and user_id = %s and {_HELD_COND}"
        with self._tx(uid) as lib:
            j = lib._one(sql, (job_id, uid))
            if not j:
                return
            settings = self.settings_loader(lib, uid)
        params = dict(j["params"])
        error = ""
        try:  # 검색하는 동안 DB 연결을 잡지 않는다
            params["candidates"], params["warnings"], params["counts"] = find.prepare(
                self.sources_factory(settings.get), self.rag.embedder if self.rag else None, params.get("question") or "",
                params["queries"])
        except find.FindError as e:
            error = str(e)
        with self._tx(uid) as lib:
            cur = lib._one(sql + " for update", (job_id, uid))
            if not cur:
                return
            if error:
                jobs._end(lib, cur, "failed", "search_failed", error)
                return
            jobs.set_params(lib, cur, params)
            if not params["candidates"]:  # 0편이면 요약 없이 성공 (13.1절 5)
                jobs.finish_success(lib, cur, {"answer": ""})
                return
            lib._x("update paperlab.jobs set not_before = now(), progress = %s, updated_at = now() where id = %s "
                   "and user_id = %s", (Jsonb({"message": "PC에서 요약을 기다리는 중", "step": "summary",
                                                     "counts": params["counts"]}), job_id, uid))

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
