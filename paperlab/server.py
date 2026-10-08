"""클라우드 웹 서버(FastAPI). 화면(static/)과 JSON API를 함께 제공한다 (명세 1단계).

요청마다: Bearer JWT 검증 → 허용 목록 → 사용자 권한 DB 트랜잭션(user_tx) · 사용자 설정 · Sources · AIService를 만든다.
전역(앱 전체) 상태는 연결 풀 · 저장소 · 검증기뿐이다.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import mimetypes
import os
import queue
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import quote

import psycopg
from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from contextlib import asynccontextmanager

from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import __version__, citations, compose, csl_style, doc_formats, downloads, format_import, jobs, pdf, \
    worker_api, writer
from .ai import MAX_PDF_BYTES as AI_MAX_PDF_BYTES
from .ai import MODELS, AIError, AIService, PaperContext
from .api_runner import ApiRunner
from .auth import Allowlist, AuthError, JWKSCache, NotAllowed, TokenVerifier, bearer_token
from .citecache import PgStore
from .config import ServerConfig, UserSettings, split_settings_changes
from .crypto import DecryptError, SecretBox
from .db import Database, DBUnavailable, Library, NotFoundError, folder_name_problem
from . import citegraph as cg
from .graph_build import (DEADLINE_S, ERRORS as GRAPH_ERRORS, WARNINGS as GRAPH_WARNINGS, BadSeed, Flights, GraphBuilder,
                          GraphError, GraphGate, parse_openalex_id, parse_recommend_request,
                          parse_request as parse_graph_request, seed_from_paper)
from .manuscripts import TEMPLATES
from .sources import GraphCancelled, GraphSources, SourceError, Sources, detect_identifier, merge
from .storage import (MAX_PDF_BYTES, BackupSizeCache, FakeStorage, NotFound, Storage, StorageError, StorageKeyError,
                      UserStorage, create_storage, is_upload_id, new_upload_id)

log = logging.getLogger("paperlab.server")
access_log = logging.getLogger("paperlab.access")

STATIC_DIR = Path(__file__).parent / "static"
BUILTIN_STYLES = STATIC_DIR / "vendor" / "csl" / "styles"
# Windows 레지스트리에 .js가 text/plain으로 잘못 등록된 경우 모듈 스크립트가 막히므로 직접 지정한다
for _ext, _type in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css"),
                    (".woff2", "font/woff2"), (".svg", "image/svg+xml")):
    mimetypes.add_type(_type, _ext)
ITEM_TYPES = {"article": "학술지 논문", "conference": "학회 발표", "preprint": "프리프린트", "book": "단행본",
              "chapter": "책의 장", "thesis": "학위논문", "report": "보고서", "dataset": "데이터셋"}
STATUSES = {"unread": "읽을 예정", "reading": "읽는 중", "done": "다 읽음"}
PUBLIC_API = {("GET", "/api/health"), ("HEAD", "/api/health"), ("GET", "/api/public-config")}
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
MAX_UPLOAD_FILES = 20
COMPOSE_MAX = 30 * 1024 * 1024  # 30MB 유지 (명세 7.5, 팀장 결정 S8 — Funnel 대역폭 제한 · 변경 최소)
STYLE_MAX = 2 * 1024 * 1024
WARN_LEVEL, FULL_LEVEL = 0.80, 0.95
HEALTH_DB_TIMEOUT = 4.0  # /api/health?deep=1 의 DB 연결 대기 · 문 실행 제한(초)
SSE_HEADERS = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}
KST = timezone(timedelta(hours=9))
GRAPH_BODY_MAX = 4096  # 인용 그래프 요청 본문 (명세 9.1)
BAD_SEED = {"detail": "이 논문으로는 그래프를 만들 수 없어요. DOI · arXiv 번호 · 제목 형식을 확인해 주세요.", "code": "bad_seed"}
BAD_REC = {"detail": "추천 요청이 올바르지 않아요.", "code": "bad_request"}  # 1C 명세 9.4절
NO_SEEDS = {"detail": "인용한 논문에 OpenAlex 번호가 없어 찾을 수 없어요.", "code": "no_seeds"}

# 요청 id: 들어온 X-Request-Id가 이 모양이면 그대로, 아니면 새로 (로그 줄 끼워 넣기 방지)
_REQUEST_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")
BAD_HOST = {"detail": "허용되지 않은 호스트", "code": "bad_host"}
AUTH_REQUIRED = {"detail": "로그인이 필요해요", "code": "auth_required"}
NOT_ALLOWED = {"detail": "허용되지 않은 계정이에요", "code": "not_allowed"}
DB_UNAVAILABLE = {"detail": "데이터베이스에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.", "code": "db_unavailable"}


def _md_title(content: str) -> str:
    m = re.search(r"^#\s+(.+)$", content or "", re.M)
    return m.group(1).strip()[:200] if m else ""


def _sse(ev: dict) -> str:
    return f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"


DEV_ONLY_STATIC = (STATIC_DIR / "js" / "dev-login.js",)


class AppStaticFiles(StaticFiles):
    """정적 파일. `hidden` 파일은 어떤 경로 표기로 와도 404 (품질팀 N1).

    경로 문자열을 비교하지 않고, 실제로 찾은 파일이 숨길 파일과 **같은 파일인지**(os.path.samefile) 본다 —
    대소문자(Windows) · 중복 슬래시 · 끝 슬래시 · 끝 마침표 같은 다른 표기도 같은 파일이면 막힌다.
    """

    def __init__(self, *args, hidden=(), **kw):
        super().__init__(*args, **kw)
        self._hidden = [Path(h) for h in hidden if Path(h).exists()]

    def lookup_path(self, path: str):
        full, stat = super().lookup_path(path)
        if stat is not None and full and self._hidden:
            for h in self._hidden:
                try:
                    if os.path.samefile(full, h):
                        return "", None
                except OSError:
                    continue
        return full, stat


class RequestCtx:
    """한 요청의 사용자 범위 상태. DB 트랜잭션은 처음 쓸 때 연다(lib)."""

    def __init__(self, app_state, claims: dict):
        self.state = app_state
        self.claims = claims
        self.uid: str = claims["sub"]
        self.email: str = str(claims.get("email") or "").lower()
        self.storage = UserStorage(app_state.storage, self.uid)
        self._tx = None
        self._lib: Library | None = None
        self._settings: UserSettings | None = None
        self._sources = None
        self._ai = None
        self.after_commit: list[Callable[[], None]] = []

    @property
    def lib(self) -> Library:
        if self._lib is None:
            tx = self.state.db.user_tx(self.claims)
            lib = tx.__enter__()  # 연결 실패면 DBUnavailable (→ 503)
            self._tx, self._lib = tx, lib
        return self._lib

    def release(self) -> None:
        """지금 트랜잭션을 커밋하고 연결을 풀에 돌려준다(품질팀 F9).

        외부 HTTP(검색 · 메타데이터 조회 · PDF 받기 · R2 받기) 전에 불러, 느린 외부 호출 동안 DB 연결을 잡지 않는다.
        다음에 `lib`을 쓰면 새 트랜잭션이 열린다. 그 사이 다른 요청이 바꿨을 수 있으므로 뒤에서 다시 확인한다.
        """
        if self._tx is not None:
            tx, self._tx, self._lib = self._tx, None, None
            tx.__exit__(None, None, None)

    def finish(self, exc: BaseException | None) -> None:
        """트랜잭션을 끝낸다(오류면 ROLLBACK). 커밋이 끝난 뒤에만 after_commit을 실행한다."""
        if self._tx is not None:
            tx, self._tx, self._lib = self._tx, None, None
            if exc is None:
                tx.__exit__(None, None, None)
            else:
                tx.__exit__(type(exc), exc, exc.__traceback__)
                return
        if exc is None:
            for fn in self.after_commit:
                try:
                    fn()
                except Exception as e:  # noqa: BLE001 - 커밋 뒤 정리는 실패해도 응답은 성공(DB가 기준)
                    log.warning("after_commit failed user=%s: %s", self.uid, type(e).__name__)

    # ------------------------------------------------------- 사용자 설정
    @property
    def settings(self) -> UserSettings:
        if self._settings is None:
            self._settings = load_user_settings(self.lib, self.state.box, self.uid)
        return self._settings

    def reload_settings(self) -> UserSettings:
        self._settings = None
        return self.settings

    @property
    def sources(self):
        if self._sources is None:
            self._sources = self.state.sources_factory(self.settings.get)
        return self._sources

    @property
    def ai(self):
        if self._ai is None:
            self._ai = self.state.ai_factory(self.settings.get)
        return self._ai


def load_user_settings(lib: Library, box: SecretBox, uid: str) -> UserSettings:
    secrets, broken, hints = {}, set(), {}
    for row in lib.list_secrets():
        try:
            secrets[row["name"]] = box.decrypt(uid, row["name"], row["ciphertext"], row["nonce"], row["key_id"])
            hints[row["name"]] = row["hint"] or ""
        except DecryptError:
            # 키를 잃었거나 다른 행에서 복사된 값 → 설정 안 된 것으로 보고 다시 입력 안내 (AC-45)
            broken.add(row["name"])
    return UserSettings(lib.get_settings(), secrets, broken, hints)


def create_app(config: ServerConfig, *, database: Database | None = None, storage: Storage | None = None,
               verifier: TokenVerifier | None = None, jwks: JWKSCache | None = None,
               sources_factory: Callable | None = None, ai_factory: Callable | None = None,
               dev: bool = False, commit: str = "", diag_hang: Callable[[], bool] | None = None,
               releases: Path | None = None, runner_opts: dict | None = None) -> FastAPI:
    """앱을 만든다. commit = 배포한 git 커밋 앞 7자리(/api/health의 version에 붙음 — update.ps1 확인용).
    diag_hang: 감시 작업 검사용 진단 스위치(AC-77) — 참이면 /api/health가 응답하지 않는 것처럼 오래 멈춘다.
    releases: 설치 파일 폴더(없으면 PAPERLAB_RELEASES_DIR · D:\\PaperLab\\releases), runner_opts: API 실행기 수치(테스트 주입).
    API 실행기는 앱 수명(lifespan) 시작 때 돈다 — uvicorn 실행 · `with TestClient(app)`. 테스트는 app.state.runner.start()."""
    db = database or Database(config.db_url, timeout=config.db_pool_timeout)
    store = storage or create_storage(config.storage_backend, config.r2)
    verifier = verifier or TokenVerifier(config.supabase_url, config.jwt_secret, jwks=jwks)
    # 개발 서버에서 개발용 허용 목록이 비어 있으면 테스트 프로젝트 사용자를 모두 허용 (운영은 항상 목록대로)
    allowlist = Allowlist(config.allowed_emails, allow_all=dev and not config.allowed_emails,
                          enabled=config.allowlist_enabled)
    if not config.allowlist_enabled:
        log.warning("허용 목록 꺼짐 — Google OAuth 테스트 사용자로 제한 (PAPERLAB_ALLOWLIST=off)")
    elif not config.allowed_emails and not dev:
        log.warning("허용 목록이 비어 있어 모든 사용자 요청이 403이 됩니다 (ALLOWED_EMAILS · PAPERLAB_ALLOWLIST 확인)")
    app_version = f"{__version__}+{commit}" if commit else __version__

    @asynccontextmanager
    async def lifespan(_app):
        _app.state.runner.start()
        try:
            yield
        finally:
            _app.state.runner.stop()

    app = FastAPI(title="PaperLab", version=__version__, docs_url=None, redoc_url=None, openapi_url=None,
                  lifespan=lifespan)
    st = app.state
    st.config, st.db, st.storage, st.verifier, st.allowlist = config, db, store, verifier, allowlist
    st.box = SecretBox(config.encryption_key)
    st.sources_factory = sources_factory or (lambda get: Sources(get))
    st.ai_factory = ai_factory or (lambda get: AIService(get))
    st.backup_sizes = BackupSizeCache(store)
    st.compose_store = {}
    st.compose_lock = threading.Lock()
    # 2단계: 작업 큐 · 연결된 PC · 설치 파일 (명세 2단계 7 · 8 · 13.7.1 · 15장)
    st.workers = ws = worker_api.WorkerState()
    downloads.register(app, Path(releases) if releases else downloads.releases_dir())

    def guide() -> str:
        """경로가 없을 때 안내 — 설치 파일이 있는지에 따라 (팀장 결정 Q2a-1)"""
        return jobs.no_route_message(bool(st.release_info()))

    st.guide = guide
    st.runner = runner = ApiRunner(db, store, lambda lib, uid: load_user_settings(lib, st.box, uid),
                                   lambda get: st.ai_factory(get), guide, max_pdf_bytes=AI_MAX_PDF_BYTES,
                                   **(runner_opts or {}))

    # ------------------------------------------------------------ security
    # 같은 출처 판단 (명세 6.5, 팀장 결정 S2): 운영은 설정 PAPERLAB_PUBLIC_URL의 출처 하나만 — Host에서 출처를 만들지 않는다
    # (프록시가 Host를 바꿔도 안전). 개발 서버는 지금 규칙(https · http://{Host})
    public_origin = config.public_origin
    allowed_hosts = config.allowed_hosts()

    def origin_ok(request: Request, origin: str) -> bool:
        if dev:
            host = request.headers.get("host") or ""
            return origin in (f"https://{host}", f"http://{host}")
        return bool(public_origin) and origin == public_origin

    def host_ok(request: Request) -> bool:
        # DNS 리바인딩 방어: 공개 호스트 또는 서버 PC 안 상태 확인용 127.0.0.1:포트 · localhost:포트만
        return dev or (request.headers.get("host") or "").lower() in allowed_hosts

    @app.middleware("http")
    async def security(request: Request, call_next):
        started = time.monotonic()
        incoming_id = request.headers.get("x-request-id") or ""
        request_id = incoming_id if _REQUEST_ID_RE.fullmatch(incoming_id) else uuid.uuid4().hex[:16]
        path = request.url.path
        user_id = ""

        def finish(response: Response) -> Response:
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Referrer-Policy"] = "same-origin"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["X-Request-Id"] = request_id
            # 공개 주소는 HTTPS(Funnel)뿐. ts.net 공유 도메인이라 includeSubDomains는 붙이지 않는다 (http 개발 서버에선 브라우저가 무시)
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
            if path.startswith("/api/"):
                response.headers["Cache-Control"] = "no-store"
            elif path.startswith("/static/"):
                # 매번 ETag · Last-Modified로 재검증(바뀌지 않았으면 304) — 업데이트 뒤 옛 JS 모듈이 섞이지 않게
                response.headers["Cache-Control"] = "no-cache"
            # JSON 한 줄 로그: 토큰 · 키 · 서명 주소 · 본문 · 이메일은 남기지 않는다 (명세 13.5)
            entry = {"request_id": request_id, "method": request.method, "path": path,
                     "status": response.status_code, "ms": int((time.monotonic() - started) * 1000), "user_id": user_id}
            device_id = getattr(request.state, "device_id", None)
            if device_id:
                entry["device_id"] = device_id  # 워커 요청: 기기 번호만 (토큰 · 이메일 없음 — 13.8절)
            if path.startswith("/downloads/"):
                entry["bytes"] = response.headers.get("content-length")  # 설치 파일 접근 로그 크기 (13.7.1절)
            access_log.info(json.dumps(entry))
            return response

        if not host_ok(request):
            return finish(JSONResponse(BAD_HOST, status_code=400))
        # 다른 출처에서 보내는 요청 막기: Origin이 있으면 공개 주소의 출처와 정확히 같아야 한다 (null도 거부)
        origin = request.headers.get("origin")
        if origin is not None and not origin_ok(request, origin):
            return finish(JSONResponse({"detail": "허용되지 않은 출처", "code": "bad_origin"}, status_code=403))
        if path.startswith("/api/worker/"):
            # 워커 API: 기기 토큰 인증은 경로 처리기가 한다(Supabase JWT는 받지 않음 — AC-19). 쓰기 헤더는 같은 규칙
            if request.method not in SAFE_METHODS and request.headers.get("x-paperlab") != "1":
                return finish(JSONResponse({"detail": "허용되지 않은 요청", "code": "bad_request_header"},
                                           status_code=403))
        elif path.startswith("/api/") and (request.method, path) not in PUBLIC_API:
            token = bearer_token(request.headers.get("authorization"))
            if not token:
                return finish(JSONResponse(AUTH_REQUIRED, status_code=401))
            try:
                claims = await run_in_threadpool(verifier.verify, token)
            except AuthError:
                return finish(JSONResponse(AUTH_REQUIRED, status_code=401))
            try:
                allowlist.check(claims)
            except NotAllowed:
                return finish(JSONResponse(NOT_ALLOWED, status_code=403))
            user_id = claims["sub"]
            request.state.claims = claims
            ws.seen_user(user_id)  # 워커 적응형 폴링 — 최근 화면 활동 (10.2절)
            # 쓰기 요청은 화면(api.js)이 붙이는 헤더가 있어야 한다 (CSRF 이중 방어)
            if request.method not in SAFE_METHODS and request.headers.get("x-paperlab") != "1":
                return finish(JSONResponse({"detail": "허용되지 않은 요청", "code": "bad_request_header"},
                                           status_code=403))
        try:
            response = await call_next(request)
        except DBUnavailable:
            response = JSONResponse(DB_UNAVAILABLE, status_code=503)
        return finish(response)

    @app.exception_handler(DBUnavailable)
    async def db_unavailable(request: Request, exc: DBUnavailable):
        return JSONResponse(DB_UNAVAILABLE, status_code=503)

    @app.exception_handler(NotFoundError)
    async def not_found(request: Request, exc: NotFoundError):
        return JSONResponse({"detail": str(exc) or "찾을 수 없어요"}, status_code=404)

    @app.exception_handler(jobs.JobError)
    async def job_error(request: Request, exc: jobs.JobError):
        return JSONResponse({"detail": exc.detail, "code": exc.code}, status_code=exc.status)

    @app.exception_handler(StorageKeyError)
    async def bad_key(request: Request, exc: StorageKeyError):
        # 남의 경로 · backups/ · 경로 조작: 존재 여부도 알리지 않는다
        return JSONResponse({"detail": "파일을 찾을 수 없어요"}, status_code=404)

    def get_ctx(request: Request):
        claims = getattr(request.state, "claims", None)
        if not claims:
            raise HTTPException(401, AUTH_REQUIRED["detail"])
        ctx = RequestCtx(st, claims)
        try:
            yield ctx
        except BaseException as e:
            ctx.finish(e)
            raise
        ctx.finish(None)

    # 요청 하나 = 트랜잭션 하나: 경로 함수가 끝나면(응답을 보내기 전에) 커밋한다
    Ctx = Depends(get_ctx, scope="function")

    # ------------------------------------------------------------ helpers
    def need_paper(ctx: RequestCtx, pid: int) -> dict:
        p = ctx.lib.get_paper(pid)
        if not p:
            raise HTTPException(404, "논문을 찾을 수 없어요")
        return p

    def store_pdf(ctx: RequestCtx, pid: int, data: bytes) -> pdf.PdfInfo:
        """서버가 받은 PDF(URL에서 받기)를 최종 키에 바로 올리고 본문을 저장한다."""
        info = pdf.extract(data)
        key = ctx.storage.paper_key(pid)
        ctx.storage.put(key, data)
        ctx.lib.set_pdf(pid, key, info.page_texts, hashlib.sha256(data).hexdigest(), len(data))
        return info

    def attach_from_incoming(ctx: RequestCtx, pid: int, incoming: str, data: bytes, info: pdf.PdfInfo) -> None:
        """임시 파일을 최종 키로 복사하고 DB에 기록. 임시 파일은 커밋 뒤에 지운다."""
        key = ctx.storage.paper_key(pid)
        ctx.storage.storage.copy(ctx.storage.check(incoming), ctx.storage.check(key))
        ctx.lib.set_pdf(pid, key, info.page_texts, hashlib.sha256(data).hexdigest(), len(data))
        ctx.after_commit.append(lambda: ctx.storage.delete_quietly(incoming))

    def mark_library(ctx: RequestCtx, items: list[dict]) -> list[dict]:
        for it in items:
            dup = ctx.lib.find_duplicate(it.get("doi", ""), it.get("arxiv_id", ""), it.get("title", ""))
            it["in_library"] = dup["id"] if dup else None
        return items

    def metadata_from_pdf(ctx: RequestCtx, info: pdf.PdfInfo) -> tuple[dict, str]:
        """PDF에서 찾은 식별자로 메타데이터를 채운다. (메타데이터, 출처 설명)"""
        sources = ctx.sources
        if info.doi:
            try:
                return sources.lookup_doi(info.doi), f"DOI {info.doi}"
            except SourceError:
                pass
        if info.arxiv_id:
            try:
                return sources.lookup_arxiv(info.arxiv_id), f"arXiv {info.arxiv_id}"
            except SourceError:
                pass
        if info.title:
            match = sources.match_title(info.title)
            if match:
                return match, "제목 검색"
        meta = {"title": info.title, "doi": info.doi, "arxiv_id": info.arxiv_id, "year": info.year,
                "authors": [], "item_type": "article"}
        if info.meta_author:
            from .sources import split_name
            meta["authors"] = [split_name(a) for a in re.split(r"\s*(?:;|,| and )\s*", info.meta_author) if a]
        return meta, "PDF 정보만 사용"

    def usage(ctx: RequestCtx) -> dict:
        with db.system_tx("storage usage") as conn:
            # 사용자 구분 없는 합계만
            total = conn.execute("select coalesce(sum(pdf_size), 0)::bigint as n from paperlab.papers "
                                 "where pdf_key <> ''").fetchone()["n"]
        used = int(total) + st.backup_sizes.get()
        limit = int(config.storage_limit_bytes)
        frac = used / limit if limit else 1.0
        level = "full" if frac >= FULL_LEVEL else "warn" if frac >= WARN_LEVEL else "ok"
        return {"backend": ctx.storage.backend, "used_bytes": used, "limit_bytes": limit,
                "mine_bytes": int(ctx.lib.mine_pdf_bytes()), "level": level}

    def ensure_space(ctx: RequestCtx) -> None:
        if usage(ctx)["level"] == "full":
            raise HTTPException(400, "저장 공간이 거의 찼어요. 관리자에게 알려 주세요")

    def own_collection(ctx: RequestCtx, value) -> int | None:
        if value in (None, "", 0, "0"):
            return None
        if not ctx.lib.has_collection(value):
            raise HTTPException(400, "컬렉션을 찾을 수 없어요")
        return int(value)

    def own_folder(ctx: RequestCtx, value) -> int | None:
        if value in (None, ""):
            return None
        if not ctx.lib.has_folder(value):
            raise HTTPException(400, "폴더를 찾을 수 없어요")
        return int(value)

    # ------------------------------------------------------------- general
    # deep 확인: 한 번에 하나만(진행 중이면 직전 결과 재사용), DB는 연결 대기 · 문 실행 모두 짧게 (품질팀 N2).
    # 인증 없이 열린 주소라 바깥에서 반복 호출해도 스레드 · DB 연결이 묶이지 않게
    deep_lock = threading.Lock()
    deep_last: dict = {}

    def deep_check() -> dict:
        if not deep_lock.acquire(blocking=False):
            # 다른 요청이 확인 중: 직전 결과, 없으면(재시작 직후 첫 확인 중) pending — 호출 쪽이 다시 묻게 (품질팀 M1)
            return dict(deep_last) or {"db": "pending", "storage": "pending", "pending": True}
        try:
            out = {}
            try:
                with db.system_tx("health check", timeout=HEALTH_DB_TIMEOUT) as conn:
                    conn.execute(f"set local statement_timeout = '{int(HEALTH_DB_TIMEOUT * 1000)}ms'")
                    conn.execute("select 1")
                out["db"] = "ok"
            except Exception:  # noqa: BLE001 - 오류 내용은 숨긴다
                out["db"] = "error"
            out["storage"] = "ok" if store.health() else "error"
            deep_last.clear()
            deep_last.update(out)
            return out
        finally:
            deep_lock.release()

    @app.api_route("/api/health", methods=["GET", "HEAD"])
    def health(deep: int = 0):
        if diag_hang is not None and diag_hang():
            time.sleep(60)  # 진단 스위치: 프로세스는 살아 있는데 응답이 없는 상태 흉내 (AC-77)
        out = {"ok": True, "version": app_version, "commit": commit}
        if deep:
            out.update(deep_check())
            out["ok"] = out["db"] == "ok" and out["storage"] == "ok"
        return out

    @app.get("/api/public-config")
    def public_config():
        # 화면에 공개되는 값만 (anon 키는 공개용). 개발 서버에서만 테스트 프로젝트 이메일 · 비밀번호 로그인을 켠다
        out = {"supabase_url": config.supabase_url, "supabase_anon_key": config.supabase_anon_key}
        if dev:
            out["dev_email_login"] = True
        return out

    @app.get("/api/me")
    def me(ctx: RequestCtx = Ctx):
        meta = ctx.claims.get("user_metadata") or {}
        name = str(meta.get("full_name") or meta.get("name") or "")[:200]
        prof = ctx.lib.ensure_profile(ctx.email, name)
        return {"user_id": ctx.uid, "email": prof["email"] or ctx.email, "display_name": prof["display_name"]}

    @app.get("/api/meta")
    def meta():
        return {"version": __version__, "models": MODELS, "item_types": ITEM_TYPES, "statuses": STATUSES}

    @app.get("/api/stats")
    def stats(ctx: RequestCtx = Ctx):
        return ctx.lib.stats()

    @app.get("/api/storage/usage")
    def storage_usage(ctx: RequestCtx = Ctx):
        return usage(ctx)

    def public_settings(ctx: RequestCtx) -> dict:
        out = ctx.settings.public()
        # 지워진 양식을 가리키면 기본 양식으로 돌려준다
        if not format_exists(ctx, out.get("doc_format_default")):
            out["doc_format_default"] = doc_formats.DEFAULT_ID
        return out

    @app.get("/api/settings")
    def get_settings(ctx: RequestCtx = Ctx):
        return public_settings(ctx)

    @app.put("/api/settings")
    def put_settings(changes: dict = Body(...), ctx: RequestCtx = Ctx):
        try:
            plain, secret_changes = split_settings_changes(changes)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        if "doc_format_default" in plain and not format_exists(ctx, plain["doc_format_default"]):
            raise HTTPException(400, "양식을 찾을 수 없어요")
        ctx.lib.update_settings(plain, ctx.email)
        for name, value in secret_changes.items():
            if value is None:
                ctx.lib.delete_secret(name)
            else:
                sealed = st.box.encrypt(ctx.uid, name, value)
                ctx.lib.set_secret(name, sealed.ciphertext, sealed.nonce, sealed.key_id, sealed.hint)
        ctx.reload_settings()
        return public_settings(ctx)

    @app.get("/api/ai/status")
    def ai_status(ctx: RequestCtx = Ctx):
        return jobs.ai_status(ctx.settings.get, jobs.device_rows(ctx.lib), bool(st.release_info()))

    @app.get("/api/ai/engines")
    def ai_engines(ctx: RequestCtx = Ctx):
        return jobs.engines_summary(ctx.settings.get, jobs.device_rows(ctx.lib))

    # ------------------------------------------------------------- 작업 (2단계 7.1절)
    def maintain(ctx: RequestCtx) -> None:
        """사용자 범위 정리: 리스 만료 · 대기 기한(매번), 오래된 행 지우기(10분에 한 번 — 6.8절)"""
        jobs.expire(ctx.lib)
        if ws.should_sweep(ctx.uid):
            jobs.sweep(ctx.lib)

    def route_for(ctx: RequestCtx, kind: str) -> list[dict]:
        route = jobs.build_route(kind, ctx.settings.get, jobs.device_rows(ctx.lib))
        if not route:
            raise jobs.JobError(400, guide(), "no_route")
        return route

    def new_job(ctx: RequestCtx, kind: str, params: dict, paper_id: int | None) -> tuple[dict, bool]:
        row, created = jobs.create_job(ctx.lib, kind, route_for(ctx, kind), params, paper_id)
        if created:
            log.info(f"job created job={row['id']} kind={kind} runner={row['runner']} engine={row['engine']}")
            if row["runner"] == "api":
                job_id, uid = row["id"], ctx.uid
                ctx.after_commit.append(lambda: runner.enqueue(job_id, uid))
        return jobs.get_job(ctx.lib, row["id"], ws.free), created

    @app.get("/api/jobs")
    def list_jobs(status: str = "active", paper_id: int | None = None, kind: str = "", limit: int = 50,
                  ctx: RequestCtx = Ctx):
        maintain(ctx)
        return jobs.list_jobs(ctx.lib, ws.free, status, paper_id, kind, limit)

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: int, ctx: RequestCtx = Ctx):
        maintain(ctx)
        return jobs.get_job(ctx.lib, job_id, ws.free)

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: int, ctx: RequestCtx = Ctx):
        out = jobs.cancel_job(ctx.lib, job_id)
        log.info(f"job cancel job={job_id} status={out['status']}")
        return out

    @app.post("/api/jobs/{job_id}/retry")
    def retry_job(job_id: int, ctx: RequestCtx = Ctx):
        src = jobs.retry_source(ctx.lib, job_id)
        view, created = new_job(ctx, src["kind"], src["params"] or {}, src["paper_id"])
        return JSONResponse({"job": view}, status_code=202 if created else 200)

    # ------------------------------------------------------------- 연결된 PC (2단계 7.2절)
    @app.get("/api/devices")
    def list_devices(ctx: RequestCtx = Ctx):
        maintain(ctx)
        return [jobs.device_view(d) for d in jobs.device_rows(ctx.lib)]

    @app.post("/api/devices/pair-codes")
    def pair_code(ctx: RequestCtx = Ctx):
        ctx.lib.ensure_profile(ctx.email)  # 워커 쪽 account_hint · 허용 목록 확인이 profiles.email을 읽는다
        return jobs.new_pair_code(ctx.lib)

    @app.patch("/api/devices/{device_id}")
    def rename_device(device_id: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        name = jobs.device_name(data.get("name"))
        if not name or name != str(data.get("name") or "").strip():
            raise HTTPException(400, "PC 이름은 1~60자로, 줄바꿈 같은 제어 문자 없이 써 주세요")
        n = jobs.valid_id(device_id) and ctx.lib._x(
            "update paperlab.devices set name = %s, updated_at = now() where id = %s and user_id = %s",
            (name, device_id, ctx.uid)).rowcount
        if not n:
            raise HTTPException(404, "PC를 찾을 수 없어요")
        return {"ok": True, "name": name}

    @app.delete("/api/devices/{device_id}")
    def revoke_device(device_id: int, ctx: RequestCtx = Ctx):
        n = jobs.revoke_device(ctx.lib, device_id)
        ws.free.pop(device_id, None)
        log.info(f"device revoked device_id={device_id} requeued={n}")
        return {"ok": True, "requeued_jobs": n}

    # -------------------------------------------------------------- papers
    @app.get("/api/papers")
    def list_papers(q: str = "", collection: int | None = None, tag: int | None = None, status: str = "",
                    starred: bool = False, sort: str = "added", filter: str = "", folder: int | None = None,
                    limit: int = Query(500, ge=0, le=2000), offset: int = Query(0, ge=0), ctx: RequestCtx = Ctx):
        return ctx.lib.list_papers(q, collection, tag, status, starred, sort, filter, limit, offset, folder)

    @app.post("/api/papers")
    def add_paper(data: dict = Body(...), ctx: RequestCtx = Ctx):
        if not (data.get("title") or "").strip():
            raise HTTPException(400, "제목이 필요해요")
        lib = ctx.lib
        if not data.get("allow_duplicate"):
            dup = lib.find_duplicate(data.get("doi", ""), data.get("arxiv_id", ""), data.get("title", ""))
            if dup:
                return JSONResponse({"duplicate": True, "paper": dup}, status_code=409)
        cid = own_collection(ctx, data.get("collection_id"))
        fid = own_folder(ctx, data.get("folder_id"))
        pid = lib.add_paper(data)
        if cid:
            lib.set_paper_collections([pid], cid, True)
        if fid:
            lib.move_papers_to_folder([pid], fid)
        if data.get("tags"):
            lib.set_paper_tags(pid, data["tags"])
        warning = ""
        if data.get("download_pdf") and data.get("pdf_url"):
            sources = ctx.sources
            ctx.release()  # 논문을 먼저 커밋하고, PDF를 받는 동안 DB 연결을 잡지 않는다 (F9)
            try:
                raw = sources.download_pdf(data["pdf_url"])
                if ctx.lib.pdf_info(pid) is None:  # 그 사이 지워짐
                    raise HTTPException(404, "논문을 찾을 수 없어요")
                store_pdf(ctx, pid, raw)
            except SourceError as e:
                warning = f"논문은 추가했지만 PDF는 받지 못했어요: {e}"
            except HTTPException:
                raise
            except DBUnavailable:
                raise
            except Exception as e:  # noqa: BLE001 - 손상된 PDF · 저장소 오류
                warning = f"논문은 추가했지만 PDF는 저장하지 못했어요: {type(e).__name__}"
        return {"paper": ctx.lib.get_paper(pid), "warning": warning}

    @app.post("/api/resolve")
    def resolve(data: dict = Body(...), ctx: RequestCtx = Ctx):
        sources = ctx.sources
        ctx.release()  # 외부 조회 동안 DB 연결을 잡지 않는다 (F9)
        try:
            item = sources.resolve(data.get("identifier", ""))
        except SourceError as e:
            raise HTTPException(404, str(e)) from e
        return mark_library(ctx, [item])[0]

    # ------------------------------------------------- uploads (명세 7.2)
    def upload_slot(ctx: RequestCtx) -> dict:
        upload_id = new_upload_id()
        upload = ctx.storage.create_upload(ctx.storage.incoming_key(upload_id))
        return {"upload_id": upload_id, "backend": ctx.storage.backend,
                "upload": {"method": upload["method"], "url": upload["url"], "headers": upload["headers"]},
                "expires_at": upload["expires_at"]}

    def read_incoming(ctx: RequestCtx, upload_id: str) -> tuple[str, bytes | None, str]:
        """(임시 키, 내용, 오류). 내 incoming/ 경로에 없으면 404"""
        if not is_upload_id(upload_id):
            raise HTTPException(404, "올린 파일을 찾을 수 없어요")
        key = ctx.storage.incoming_key(upload_id)
        size = ctx.storage.head(key)
        if size is None:
            raise HTTPException(404, "올린 파일을 찾을 수 없어요")
        if size > MAX_PDF_BYTES:
            ctx.storage.delete_quietly(key)
            return key, None, "파일이 너무 커요 (100MB 초과)"
        try:
            data = ctx.storage.get(key)
        except NotFound:
            raise HTTPException(404, "올린 파일을 찾을 수 없어요") from None
        if len(data) > MAX_PDF_BYTES:
            ctx.storage.delete_quietly(key)
            return key, None, "파일이 너무 커요 (100MB 초과)"
        if not data.startswith(b"%PDF"):
            ctx.storage.delete_quietly(key)
            return key, None, "PDF 파일이 아니에요"
        return key, data, ""

    @app.post("/api/uploads")
    def create_uploads(data: dict = Body(...), ctx: RequestCtx = Ctx):
        files = data.get("files")
        if not isinstance(files, list) or not files:
            raise HTTPException(400, "올릴 파일 목록(files)이 필요해요")
        if len(files) > MAX_UPLOAD_FILES:
            raise HTTPException(400, f"한 번에 {MAX_UPLOAD_FILES}개까지 올릴 수 있어요")
        ensure_space(ctx)
        out = []
        for f in files:
            f = f if isinstance(f, dict) else {}
            name = str(f.get("name") or "document.pdf")[:255]
            try:
                size = int(f.get("size") or 0)
            except (TypeError, ValueError):
                size = 0
            if size > MAX_PDF_BYTES:
                out.append({"name": name, "error": "파일이 너무 커요 (100MB 초과)"})
                continue
            out.append({"name": name, **upload_slot(ctx)})
        return {"files": out}

    @app.post("/api/uploads/{upload_id}/complete")
    def complete_upload(upload_id: str, data: dict = Body(default={}), ctx: RequestCtx = Ctx):
        name = str(data.get("name") or "document.pdf")[:255]
        if not is_upload_id(upload_id):
            raise HTTPException(404, "올린 파일을 찾을 수 없어요")
        try:
            collection_id = own_collection(ctx, data.get("collection_id"))
            folder_id = own_folder(ctx, data.get("folder_id"))
        except HTTPException:
            # 검증에 실패해도 올린 임시 파일은 남기지 않는다 (F11 — 내 incoming/ 경로만)
            ctx.storage.delete_quietly(ctx.storage.incoming_key(upload_id))
            raise
        lookup = data.get("lookup", True)
        if lookup:
            ctx.sources  # noqa: B018 - 사용자 설정(연락처 · API 키)을 먼저 읽어 둔다
        # R2 받기 · PDF 추출 · 외부 메타데이터 조회 동안 DB 연결을 잡지 않는다 (F9)
        ctx.release()
        incoming, raw, error = read_incoming(ctx, upload_id)
        if error:
            return {"file": name, "error": error}
        try:
            info = pdf.extract(raw)
        except Exception as e:  # noqa: BLE001 - 손상된 PDF
            ctx.storage.delete_quietly(incoming)
            return {"file": name, "error": f"PDF를 열 수 없어요: {e}"}
        if lookup:
            meta_, matched_by = metadata_from_pdf(ctx, info)
        else:
            meta_, matched_by = {"title": info.title, "doi": info.doi, "arxiv_id": info.arxiv_id}, "PDF 정보만 사용"
        if not meta_.get("title"):
            meta_["title"] = re.sub(r"\.pdf$", "", name, flags=re.I)
        lib = ctx.lib  # 새 트랜잭션: 그 사이 컬렉션 · 폴더가 지워졌으면 넣지 않는다
        if collection_id and not lib.has_collection(collection_id):
            collection_id = None
        if folder_id and not lib.has_folder(folder_id):
            folder_id = None
        dup = lib.find_duplicate(meta_.get("doi", ""), meta_.get("arxiv_id", ""), meta_.get("title", ""))
        if dup:
            if not dup["has_pdf"]:
                attach_from_incoming(ctx, dup["id"], incoming, raw, info)
                result = {"file": name, "id": dup["id"], "title": dup["title"], "matched_by": matched_by,
                          "note": "이미 있는 논문에 PDF를 붙였어요"}
            else:
                ctx.after_commit.append(lambda: ctx.storage.delete_quietly(incoming))
                result = {"file": name, "id": dup["id"], "title": dup["title"], "duplicate": True,
                          "note": "이미 서재에 있어요"}
            if collection_id:
                lib.set_paper_collections([dup["id"]], collection_id, True)
            return result
        pid = lib.add_paper(meta_)
        attach_from_incoming(ctx, pid, incoming, raw, info)
        if collection_id:
            lib.set_paper_collections([pid], collection_id, True)
        if folder_id:
            lib.move_papers_to_folder([pid], folder_id)
        return {"file": name, "id": pid, "title": meta_["title"], "matched_by": matched_by, "warnings": info.warnings}

    @app.get("/api/papers/{pid}")
    def get_paper(pid: int, ctx: RequestCtx = Ctx):
        p = need_paper(ctx, pid)
        p["cite_issues"] = citations.citation_issues(p)
        return p

    @app.patch("/api/papers/{pid}")
    def patch_paper(pid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        need_paper(ctx, pid)
        if "folder_id" in data:
            ctx.lib.move_papers_to_folder([pid], own_folder(ctx, data["folder_id"]))
        ctx.lib.update_paper(pid, data)
        if "tags" in data:
            ctx.lib.set_paper_tags(pid, data["tags"] or [])
        return ctx.lib.get_paper(pid)

    def delete_papers(ctx: RequestCtx, ids: list[int]) -> int:
        """DB에서 지우고, 커밋이 끝난 뒤 저장소 PDF를 지운다(실패해도 응답은 성공 — 로그만)."""
        keys, n = [], 0
        for pid in ids:
            info = ctx.lib.pdf_info(pid)
            if not info:
                continue
            if info["pdf_key"]:
                ctx.storage.check(info["pdf_key"])  # 남의 경로면 StorageKeyError → 404
            key = ctx.lib.delete_paper(pid)
            n += 1
            if key:
                keys.append(key)
        for key in keys:
            ctx.after_commit.append(lambda k=key: ctx.storage.delete_quietly(k))
        return n

    @app.delete("/api/papers/{pid}")
    def delete_paper(pid: int, ctx: RequestCtx = Ctx):
        if not delete_papers(ctx, [pid]):
            raise HTTPException(404, "논문을 찾을 수 없어요")
        return {"ok": True}

    @app.post("/api/papers/bulk")
    def bulk(data: dict = Body(...), ctx: RequestCtx = Ctx):
        try:
            ids = [int(i) for i in data.get("ids") or []]
        except (TypeError, ValueError):
            raise HTTPException(400, "ids가 틀렸어요") from None
        lib = ctx.lib
        ids = lib.paper_ids(ids)
        action, value = data.get("action"), data.get("value")
        if action == "delete":
            delete_papers(ctx, ids)
        elif action in ("add_collection", "remove_collection"):
            if not str(value or "").isdigit():
                raise HTTPException(400, "컬렉션을 골라 주세요")
            if not lib.has_collection(int(value)):
                raise HTTPException(400, "컬렉션을 찾을 수 없어요")
            lib.set_paper_collections(ids, int(value), action == "add_collection")
        elif action == "move_folder":
            lib.move_papers_to_folder(ids, own_folder(ctx, value))
        elif action == "add_tag":
            if not str(value or "").strip():
                raise HTTPException(400, "태그 이름이 필요해요")
            lib.add_tag_to_papers(ids, str(value))
        elif action == "status":
            for pid in ids:
                lib.update_paper(pid, {"status": value})
        elif action == "star":
            for pid in ids:
                lib.update_paper(pid, {"starred": bool(value)})
        else:
            raise HTTPException(400, "알 수 없는 작업")
        return {"ok": True}

    @app.post("/api/papers/{pid}/open")
    def opened(pid: int, ctx: RequestCtx = Ctx):
        p = need_paper(ctx, pid)
        ctx.lib.touch_opened(pid)
        if p["status"] == "unread":
            ctx.lib.update_paper(pid, {"status": "reading"})
        return {"ok": True}

    # ----------------------------------------------------------------- PDF
    @app.get("/api/papers/{pid}/pdf-url")
    def pdf_url(pid: int, ctx: RequestCtx = Ctx):
        info = ctx.lib.pdf_info(pid)
        if not info:
            raise HTTPException(404, "논문을 찾을 수 없어요")
        if not info["pdf_key"]:
            raise HTTPException(404, "PDF가 없어요")
        signed = ctx.storage.sign_get(info["pdf_key"], filename=info["title"])
        return {"url": signed["url"], "expires_at": signed["expires_at"]}

    @app.post("/api/papers/{pid}/pdf/upload")
    def pdf_upload_slot(pid: int, ctx: RequestCtx = Ctx):
        need_paper(ctx, pid)
        ensure_space(ctx)
        return upload_slot(ctx)

    @app.post("/api/papers/{pid}/pdf/complete")
    def pdf_complete(pid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        need_paper(ctx, pid)
        ctx.release()  # R2 받기 · 추출 동안 DB 연결을 잡지 않는다 (F9)
        incoming, raw, error = read_incoming(ctx, str(data.get("upload_id") or ""))
        if error:
            raise HTTPException(400, error)
        try:
            info = pdf.extract(raw)
        except Exception as e:  # noqa: BLE001 - 손상된 PDF
            ctx.storage.delete_quietly(incoming)
            raise HTTPException(400, f"PDF를 열 수 없어요: {e}") from e
        need_paper(ctx, pid)  # 그 사이 지워졌으면 404 (임시 파일은 수명 주기 규칙이 정리)
        attach_from_incoming(ctx, pid, incoming, raw, info)
        return {"paper": ctx.lib.get_paper(pid), "warnings": info.warnings}

    @app.post("/api/papers/{pid}/fetch-pdf")
    def fetch_pdf(pid: int, ctx: RequestCtx = Ctx):
        p = need_paper(ctx, pid)
        sources = ctx.sources
        ctx.release()  # 외부 조회 · PDF 받기 동안 DB 연결을 잡지 않는다 (F9)
        url = p.get("pdf_url")
        if not url and p.get("arxiv_id"):
            url = f"https://arxiv.org/pdf/{p['arxiv_id']}"
        if not url and p.get("doi"):
            try:
                url = sources.lookup_doi(p["doi"]).get("pdf_url")
            except SourceError:
                url = ""
        if not url:
            raise HTTPException(404, "무료로 받을 수 있는 PDF를 찾지 못했어요. 직접 파일을 첨부해 주세요.")
        try:
            data = sources.download_pdf(url)
        except SourceError as e:
            raise HTTPException(502, str(e)) from e
        need_paper(ctx, pid)  # 새 트랜잭션: 그 사이 지워졌으면 404
        try:
            info = store_pdf(ctx, pid, data)
        except StorageError as e:
            raise HTTPException(502, "PDF를 저장하지 못했어요") from e
        except Exception as e:  # noqa: BLE001 - 손상된 PDF
            raise HTTPException(400, f"PDF를 열 수 없어요: {e}") from e
        ctx.lib.update_paper(pid, {"pdf_url": url})
        return {"paper": ctx.lib.get_paper(pid), "warnings": info.warnings}

    @app.post("/api/papers/{pid}/refresh")
    def refresh_metadata(pid: int, data: dict = Body(default={}), ctx: RequestCtx = Ctx):
        p = need_paper(ctx, pid)
        sources = ctx.sources
        ctx.release()  # 외부 조회 동안 DB 연결을 잡지 않는다 (F9)
        try:
            if p.get("doi"):
                fresh = sources.lookup_doi(p["doi"])
            elif p.get("arxiv_id"):
                fresh = sources.lookup_arxiv(p["arxiv_id"])
            elif data.get("identifier"):
                fresh = sources.resolve(data["identifier"])
            else:
                fresh = sources.match_title(p["title"])
                if not fresh:
                    raise SourceError("제목으로 일치하는 논문을 찾지 못했어요. DOI를 입력해 주세요.")
        except SourceError as e:
            raise HTTPException(404, str(e)) from e
        if data.get("overwrite"):
            update = {k: v for k, v in fresh.items() if v not in (None, "", [])}
        else:
            merged = merge(p, fresh)
            update = {k: merged[k] for k in fresh if k in merged and merged[k] != p.get(k)}
            if fresh.get("cited_by_count") is not None:
                update["cited_by_count"] = fresh["cited_by_count"]
        update.pop("source", None)
        need_paper(ctx, pid)  # 새 트랜잭션: 그 사이 지워졌으면 404
        ctx.lib.update_paper(pid, update)
        out = ctx.lib.get_paper(pid)
        out["cite_issues"] = citations.citation_issues(out)
        return out

    @app.get("/api/papers/{pid}/related")
    def related(pid: int, kind: str = "cited_by", page: int = 1, ctx: RequestCtx = Ctx):
        p = need_paper(ctx, pid)
        if kind not in ("cited_by", "references", "related"):
            raise HTTPException(400, "kind는 cited_by, references, related 중 하나예요")
        sources = ctx.sources
        ctx.release()  # 외부 조회 동안 DB 연결을 잡지 않는다 (F9)
        try:
            res = sources.related(p, kind, page)
        except SourceError as e:
            raise HTTPException(404, str(e)) from e
        if res.get("openalex_id") and not p.get("openalex_id"):
            ctx.lib.update_paper(pid, {"openalex_id": res["openalex_id"]})
        res["items"] = mark_library(ctx, res["items"])
        return res

    @app.post("/api/related")
    def related_external(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """서재에 없는 검색 결과의 피인용·참고문헌·관련 논문"""
        kind = data.get("kind", "cited_by")
        if kind not in ("cited_by", "references", "related"):
            raise HTTPException(400, "kind는 cited_by, references, related 중 하나예요")
        sources = ctx.sources
        ctx.release()  # 외부 조회 동안 DB 연결을 잡지 않는다 (F9)
        try:
            res = sources.related(data.get("paper") or {}, kind, int(data.get("page") or 1))
        except SourceError as e:
            raise HTTPException(404, str(e)) from e
        res["items"] = mark_library(ctx, res["items"])
        return res

    # ---------------------------------------- 인용 그래프 (docs/specs/citation-graph.md 9장 — SSE)
    # 진행 중 표(사용자 잠금 · 같은 씨앗 합치기)는 메모리에만 두고 끝나면 지운다(AC-G33). 씨앗은 본문으로만 받는다.
    st.graph_gate = GraphGate(running=2, waiting=4)
    st.graph_flights = Flights()
    st.graph_sources_factory = lambda oa_key, s2_key, **kw: GraphSources(oa_key, s2_key, **kw)
    st.graph_today = lambda: datetime.now(KST).date()
    st.graph_clock = time.monotonic
    st.graph_wait_s = 20.0  # 대기 최대(초) — 넘으면 graph_queue_full
    st.graph_ping_s = 15.0  # SSE 주석 줄 간격(Funnel 긴 연결 유지)

    def run_flight(f, claims: dict, oa_key: str, s2_key: str, work) -> None:
        """그래프 · 추천 하나를 스레드에서 만든다(같은 키 요청은 이 결과를 함께 받음). work(builder, flight) → 결과.
        오류는 code만 남긴다."""
        builder = None
        try:
            clock = st.graph_clock
            src = st.graph_sources_factory(oa_key, s2_key, clock=clock, deadline=clock() + DEADLINE_S, cancel=f.cancel)
            builder = GraphBuilder(PgStore(db, claims), src, st.graph_today(), progress=f.emit)
            f.result = work(builder, f)
        except GraphCancelled:
            f.error = "cancelled"
        except GraphError as e:
            f.error = e.code
        except Exception as e:  # noqa: BLE001 - 내용(주소 · 식별자가 섞일 수 있음)은 남기지 않고 종류만
            log.warning(json.dumps({"event": "graph_internal", "type": type(e).__name__}))
            f.error = "internal"
        finally:
            if builder is not None:
                f.info = dict(builder.info(), cache_hits=(f.result or {}).get("stats", {}).get("cache_hits", 0))
            st.graph_flights.finish(f)

    def graph_work(seed, size: int):
        def work(builder, f):
            f.seed_no = builder.resolve(seed)
            graph = builder.build(f.seed_no, size)
            f.seed_no = int(graph["seed"][1:])  # 합쳐진 번호면 바뀐 번호(서재 논문 openalex_id 채우기에 씀)
            return graph
        return work

    def graph_for_user(claims: dict, graph: dict, paper: dict | None, seed, seed_no: int | None) -> None:
        """요청한 사용자 권한으로 서재 일치(in_library) · 서재 논문의 openalex_id 채우기/고치기.
        고치기는 비어 있었거나, 그 논문의 openalex_id로 씨앗을 정했는데 OpenAlex가 다른 번호(합쳐짐)를 돌려준 경우만(품질팀 N-1)"""
        with db.user_tx(claims) as lib:
            groups = [graph["nodes"], graph["prior"], graph["derivative"]]
            ids = lib.match_library([x["paper"] for g in groups for x in g])
            i = 0
            for g in groups:
                for x in g:
                    x["in_library"] = ids[i]
                    i += 1
            if paper and seed_no:
                # seed.no는 서재 논문의 openalex_id(형식이 맞을 때)에서 온 값 — 그 값으로 정한 씨앗이 바뀌었을 때만 고친다
                merged = bool(seed is not None and seed.no and seed.no != seed_no)
                if not paper.get("openalex_id") or merged:
                    lib.update_paper(paper["id"], {"openalex_id": f"W{seed_no}"})

    async def gate_events(request: Request, claims: dict, token: str, key, work, oa_key: str, s2_key: str, finish,
                          event: str, counts: dict):
        """그래프 · 추천 공용 SSE (1C 명세 9.4절): 게이트 대기(wait) · 같은 키 합치기(Flights) · 15초 ping · 끊김 감지 ·
        게이트 반납 · 완료 로그. finish(결과, flight) = 요청한 사용자 권한 마무리 → (done 이벤트, 로그 숫자)"""
        uid = claims["sub"]
        gate, flights = st.graph_gate, st.graph_flights
        started, flight, outcome = False, None, "error"
        t0 = time.monotonic()
        warn_codes: list[str] = []
        claimed = gate.claim(uid, token)
        try:
            if not claimed:  # 자리가 오래 비어 있어 정리됨(거의 없음)
                yield _sse({"type": "error", "code": "internal", "error": GRAPH_ERRORS["internal"]})
                return
            waited_from, announced = time.monotonic(), False
            while not gate.try_start():
                if not announced:
                    announced = True
                    yield _sse({"type": "progress", "step": "wait", "message": "다른 그래프가 끝나기를 기다리는 중",
                                "progress": 0.05})
                if await request.is_disconnected():
                    outcome = "cancelled"
                    return
                if time.monotonic() - waited_from > st.graph_wait_s:
                    outcome = "graph_queue_full"
                    yield _sse({"type": "error", "code": "graph_queue_full", "error": GRAPH_ERRORS["graph_queue_full"]})
                    return
                await asyncio.sleep(0.05)
            started = True
            flight = flights.join(key, lambda f: run_flight(f, claims, oa_key, s2_key, work))
            idx, last_ping = 0, time.monotonic()
            while True:
                evs, done = flight.read(idx)
                idx += len(evs)
                for ev in evs:
                    yield _sse(ev)
                if done:
                    break
                if await request.is_disconnected():
                    outcome = "cancelled"
                    return
                if time.monotonic() - last_ping >= st.graph_ping_s:
                    last_ping = time.monotonic()
                    yield ": ping\n\n"
                await asyncio.sleep(0.05)
            if flight.error or flight.result is None:
                outcome = flight.error or "internal"
                code = outcome if outcome in GRAPH_ERRORS else "internal"
                yield _sse({"type": "error", "code": code, "error": GRAPH_ERRORS[code]})
                return
            result = copy.deepcopy(flight.result)
            done_ev, counts = await run_in_threadpool(finish, result, flight)
            warn_codes = [w["code"] for w in result["warnings"]]
            outcome = "done"
            yield _sse(done_ev)
        except DBUnavailable:
            outcome = "db_unavailable"
            yield _sse({"type": "error", "code": "internal", "error": DB_UNAVAILABLE["detail"]})
        except (asyncio.CancelledError, GeneratorExit):
            outcome = "cancelled"
            raise
        finally:
            if flight is not None:
                flights.leave(flight)
            if claimed:
                gate.leave(uid, token, started)
            info = flight.info if flight is not None else {}
            # 숫자 · code만 (씨앗 · 번호 · 제목 · 사용자 id 없음 — 1B 9.6절 · 1C 9.8절)
            log.info(json.dumps({"event": event, "result": outcome, "ms": int((time.monotonic() - t0) * 1000),
                                 "list_calls": info.get("list_calls", 0), "cache_hits": info.get("cache_hits", 0),
                                 **counts, "warnings": warn_codes, "openalex_remaining": info.get("openalex_remaining")}))

    async def small_json(request: Request):
        """본문 JSON — Content-Length가 4KB를 넘으면 읽지 않고, 없거나 chunked여도 4KB 넘게는 읽지 않음(품질팀 M-4).
        크거나 JSON이 아니면 ValueError"""
        length = request.headers.get("content-length")
        if length is not None and (not length.strip().isdigit() or int(length) > GRAPH_BODY_MAX):
            raise ValueError("too large")
        buf = bytearray()
        async for chunk in request.stream():
            buf.extend(chunk)
            if len(buf) > GRAPH_BODY_MAX:
                raise ValueError("too large")
        try:
            return json.loads(bytes(buf) or b"null")
        except RecursionError:  # 4KB 안에서도 [[[… 처럼 깊게 겹친 본문(품질팀 F3)
            raise ValueError("too deep") from None

    def user_keys(lib, uid: str) -> tuple[str, str]:
        s = load_user_settings(lib, st.box, uid)
        return s.get("openalex_api_key") or "", s.get("semantic_scholar_api_key") or ""

    @app.post("/api/graph")
    async def graph(request: Request):
        claims = getattr(request.state, "claims", None)
        if not claims:
            raise HTTPException(401, AUTH_REQUIRED["detail"])
        try:
            paper_id, seed, size = parse_graph_request(await small_json(request))
        except (ValueError, BadSeed):
            return JSONResponse(BAD_SEED, status_code=400)
        uid = claims["sub"]

        def prepare():
            with db.user_tx(claims) as lib:
                paper = lib.get_paper(paper_id, detail=False) if paper_id else None
                return (paper, *user_keys(lib, uid))

        paper, oa_key, s2_key = await run_in_threadpool(prepare)
        if paper_id:
            if not paper:
                return JSONResponse({"detail": "논문을 찾을 수 없어요"}, status_code=404)
            seed = seed_from_paper(paper)
            if seed.empty():
                return JSONResponse(BAD_SEED, status_code=400)
        state, token = st.graph_gate.enter(uid)
        if state == "busy":
            return JSONResponse({"detail": "그래프를 만드는 중이에요. 끝난 뒤 다시 눌러 주세요.", "code": "graph_busy"},
                                status_code=429)
        if state == "full":
            return JSONResponse({"detail": GRAPH_ERRORS["graph_queue_full"], "code": "graph_queue_full"}, status_code=503)

        def finish(g: dict, flight) -> tuple[dict, dict]:
            graph_for_user(claims, g, paper, seed, flight.seed_no)
            return {"type": "done", "graph": g}, {"nodes": len(g["nodes"])}

        return StreamingResponse(gate_events(request, claims, token, (seed.key(), size), graph_work(seed, size), oa_key,
                                             s2_key, finish, "graph", {"nodes": 0}),
                                 media_type="text/event-stream", headers=SSE_HEADERS)

    # ---------------------------------------- 1C 원고 인용 기반 추천 (docs/specs/writing-reference-pane.md 9장 — SSE)
    # 씨앗은 본문의 서재 논문 id로만(경로 · 쿼리에 없음). 결과 · 씨앗은 어디에도 저장하지 않는다(9.8절).
    @app.post("/api/graph/recommend")
    async def graph_recommend(request: Request):
        claims = getattr(request.state, "claims", None)
        if not claims:
            raise HTTPException(401, AUTH_REQUIRED["detail"])
        try:
            ids = parse_recommend_request(await small_json(request))
        except (ValueError, BadSeed):
            return JSONResponse(BAD_REC, status_code=400)
        uid = claims["sub"]

        def prepare():
            with db.user_tx(claims) as lib:  # 내 서재(RLS)에 없는 id는 조용히 빠짐 — 있는지 알리지 않음
                return (lib.openalex_ids(ids), *user_keys(lib, uid))

        values, oa_key, s2_key = await run_in_threadpool(prepare)
        nos: list[int] = []
        for v in values:
            try:
                nos.append(parse_openalex_id(v))
            except BadSeed:
                continue
        nos = list(dict.fromkeys(nos))
        if not nos:
            return JSONResponse(NO_SEEDS, status_code=400)
        capped = len(nos) > cg.REC_MAX_SEEDS
        nos = nos[:cg.REC_MAX_SEEDS]
        state, token = st.graph_gate.enter(uid)
        if state == "busy":
            return JSONResponse({"detail": "다른 탭에서 그래프나 추천을 만드는 중이에요. 끝난 뒤 다시 눌러 주세요.",
                                 "code": "graph_busy"}, status_code=429)
        if state == "full":
            return JSONResponse({"detail": GRAPH_ERRORS["graph_queue_full"], "code": "graph_queue_full"}, status_code=503)

        def finish(rec: dict, flight) -> tuple[dict, dict]:
            with db.user_tx(claims) as lib:  # 서재 일치는 요청한 사용자마다(합치기 경로에서도 따로)
                for x, lid in zip(rec["items"], lib.match_library([x["paper"] for x in rec["items"]])):
                    x["in_library"] = lid
            if capped:
                rec["warnings"].append({"code": "seeds_capped", "message": GRAPH_WARNINGS["seeds_capped"]})
            return {"type": "done", "recommend": rec}, {"seeds": rec["seeds_total"], "items": len(rec["items"])}

        return StreamingResponse(gate_events(request, claims, token, ("rec", tuple(sorted(nos))),
                                             lambda b, f: b.recommend(nos), oa_key, s2_key, finish, "recommend",
                                             {"seeds": len(nos), "items": 0}),
                                 media_type="text/event-stream", headers=SSE_HEADERS)

    @app.post("/api/cite-preview")
    def cite_preview(data: dict = Body(...)):
        """서재에 없는 논문(검색 결과)의 인용 데이터"""
        return cite_payload(data.get("paper") or {})

    # ------------------------------------------------------ notes/annotations
    @app.put("/api/papers/{pid}/note")
    def save_note(pid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        need_paper(ctx, pid)
        ctx.lib.save_note(pid, str(data.get("content", "") or ""))
        return {"ok": True}

    @app.get("/api/papers/{pid}/annotations")
    def annotations(pid: int, ctx: RequestCtx = Ctx):
        need_paper(ctx, pid)
        return ctx.lib.list_annotations(pid)

    @app.post("/api/papers/{pid}/annotations")
    def add_annotation(pid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        need_paper(ctx, pid)
        aid = ctx.lib.add_annotation(pid, data)
        return ctx.lib.get_annotation(aid)

    @app.patch("/api/annotations/{aid}")
    def patch_annotation(aid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        a = ctx.lib.update_annotation(aid, data)
        if not a:
            raise HTTPException(404, "하이라이트를 찾을 수 없어요")
        return a

    @app.delete("/api/annotations/{aid}")
    def delete_annotation(aid: int, ctx: RequestCtx = Ctx):
        if not ctx.lib.delete_annotation(aid):
            raise HTTPException(404, "하이라이트를 찾을 수 없어요")
        return {"ok": True}

    @app.get("/api/annotations/export/{pid}")
    def export_annotations(pid: int, ctx: RequestCtx = Ctx):
        p = need_paper(ctx, pid)
        who = ", ".join(" ".join(x for x in (a.get("given"), a.get("family"), a.get("literal")) if x)
                        for a in p.get("authors") or [])
        source = " · ".join(str(x) for x in (who, p.get("year"), p.get("venue")) if x)
        link = f"https://doi.org/{p['doi']}" if p.get("doi") else p.get("url") or ""
        lines = [f"# {p['title']}", "", source + (f"  \n{link}" if link else ""), ""]
        for a in ctx.lib.list_annotations(pid):
            lines.append(f"> {a['text']}" if a["text"] else "> (메모)")
            lines.append(f"> — p.{a['page']}")
            if a["comment"]:
                lines += ["", a["comment"]]
            lines.append("")
        if p.get("note"):
            lines += ["## 노트", "", p["note"]]
        return Response("\n".join(lines), media_type="text/markdown; charset=utf-8")

    # -------------------------------------------------------- collections
    @app.get("/api/collections")
    def collections(ctx: RequestCtx = Ctx):
        return ctx.lib.list_collections()

    @app.post("/api/collections")
    def add_collection(data: dict = Body(...), ctx: RequestCtx = Ctx):
        name = (data.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "이름이 필요해요")
        try:
            return {"id": ctx.lib.add_collection(name, own_collection(ctx, data.get("parent_id")))}
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @app.patch("/api/collections/{cid}")
    def patch_collection(cid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        try:
            ctx.lib.update_collection(cid, data.get("name"), data["parent_id"] if "parent_id" in data else ...)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return {"ok": True}

    @app.delete("/api/collections/{cid}")
    def delete_collection(cid: int, ctx: RequestCtx = Ctx):
        if not ctx.lib.delete_collection(cid):
            raise HTTPException(404, "컬렉션을 찾을 수 없어요")
        return {"ok": True}

    # ------------------------------------------------------------ folders
    FOLDER_NAME_BAD = "이 폴더 이름은 쓸 수 없어요"

    def folder_name(value) -> str:
        name = str(value or "").strip()
        problem = folder_name_problem(name)
        if problem:
            raise HTTPException(400, problem)
        return name

    @app.get("/api/folders")
    def folders(ctx: RequestCtx = Ctx):
        return ctx.lib.list_folders()

    @app.post("/api/folders")
    def add_folder(data: dict = Body(...), ctx: RequestCtx = Ctx):
        name = folder_name(data.get("name"))
        try:
            return {"id": ctx.lib.add_folder(name, own_folder(ctx, data.get("parent_id")))}
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        except psycopg.errors.CheckViolation as e:
            # 서버 검사를 통과했지만 DB CHECK(제어 문자 등)에 걸린 이름 → 500이 아니라 400 (승인자 L1)
            raise HTTPException(400, FOLDER_NAME_BAD) from e

    @app.patch("/api/folders/{fid}")
    def patch_folder(fid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        name = folder_name(data["name"]) if "name" in data else None
        parent = data["parent_id"] if "parent_id" in data else ...
        try:
            ctx.lib.update_folder(fid, name, parent)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        except psycopg.errors.CheckViolation as e:
            raise HTTPException(400, FOLDER_NAME_BAD) from e
        return {"ok": True}

    @app.delete("/api/folders/{fid}")
    def delete_folder(fid: int, ctx: RequestCtx = Ctx):
        return {"ok": True, **ctx.lib.delete_folder(fid)}

    # --------------------------------------------------------------- tags
    @app.get("/api/tags")
    def tags(ctx: RequestCtx = Ctx):
        return ctx.lib.list_tags()

    @app.patch("/api/tags/{tid}")
    def patch_tag(tid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        try:
            ctx.lib.update_tag(tid, data.get("name"), data.get("color"))
        except psycopg.errors.UniqueViolation as e:
            raise HTTPException(400, "같은 이름의 태그가 이미 있어요") from e
        return {"ok": True}

    @app.delete("/api/tags/{tid}")
    def delete_tag(tid: int, ctx: RequestCtx = Ctx):
        if not ctx.lib.delete_tag(tid):
            raise HTTPException(404, "태그를 찾을 수 없어요")
        return {"ok": True}

    # ---------------------------------------------------------- citations
    def cite_payload(p: dict) -> dict:
        return {"csl": citations.to_csl_item(p), "issues": citations.citation_issues(p),
                "bibtex": citations.to_bibtex([p]), "ris": citations.to_ris([p])}

    @app.get("/api/papers/{pid}/cite")
    def cite(pid: int, ctx: RequestCtx = Ctx):
        return cite_payload(need_paper(ctx, pid))

    def papers_for(ctx: RequestCtx, data: dict) -> list[dict]:
        lib = ctx.lib
        if data.get("ids"):
            return [p for p in (lib.get_paper(int(i)) for i in data["ids"]) if p]
        if data.get("collection_id"):
            return lib.list_papers(collection_id=int(data["collection_id"]), limit=100000)["items"]
        return lib.list_papers(limit=100000)["items"]

    @app.post("/api/csl")
    def csl_items(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """화면의 citeproc-js가 인용·참고문헌을 만들 때 쓰는 CSL-JSON (요청한 순서 유지)"""
        papers = papers_for(ctx, data)
        return {"items": [citations.to_csl_item(p) for p in papers],
                "issues": {str(p["id"]): citations.citation_issues(p) for p in papers}}

    # 인용 스타일: 기본 = 공식 CSL 저장소의 .csl 파일, 내 스타일 = DB user_styles (명세 7.7)
    builtin_cache: dict[str, dict] = {}

    def builtin_styles() -> dict[str, dict]:
        if not builtin_cache:
            for path in sorted(BUILTIN_STYLES.glob("*.csl")):
                info = csl_style.read_info(path.read_bytes())
                if info:
                    builtin_cache[path.stem] = dict(info, id=path.stem, builtin=True)
        return builtin_cache

    def valid_style_id(style_id: str) -> bool:
        return bool(re.fullmatch(r"[a-z0-9][a-z0-9\-]{0,120}", style_id or ""))

    def style_xml(ctx: RequestCtx, style_id: str) -> bytes | None:
        """내 스타일이 기본 스타일과 같은 id면 내 것 우선"""
        if not valid_style_id(style_id):
            return None
        mine = ctx.lib.get_user_style(style_id)
        if mine:
            return mine["xml"].encode("utf-8")
        if style_id in builtin_styles():
            return (BUILTIN_STYLES / f"{style_id}.csl").read_bytes()
        return None

    @app.get("/api/styles")
    def list_styles(ctx: RequestCtx = Ctx):
        out = {k: dict(v) for k, v in builtin_styles().items()}
        for row in ctx.lib.list_user_styles():
            info = row["info"] if isinstance(row["info"], dict) else {}
            out[row["style_id"]] = dict(info, id=row["style_id"], builtin=False)
        order = {k: i for i, k in enumerate(csl_style.FEATURED)}
        return sorted(out.values(), key=lambda x: (not x["builtin"], x.get("group") != "주요 스타일",
                                                   order.get(x["id"], 999), str(x.get("title", "")).lower()))

    @app.get("/api/styles/{style_id}")
    def get_style(style_id: str, ctx: RequestCtx = Ctx):
        raw = style_xml(ctx, style_id)
        if raw is None:
            raise HTTPException(404, "인용 스타일을 찾을 수 없어요")
        info = csl_style.read_info(raw) or {}
        # 종속 스타일은 서식이 없고 부모 스타일을 가리키기만 하므로 부모 서식을 보낸다
        if info.get("parent"):
            parent = style_xml(ctx, info["parent"])
            if parent is None:
                raise HTTPException(404, f"이 스타일이 기반으로 하는 '{info['parent']}' 스타일이 없어요. 그 스타일도 추가해 주세요.")
            raw = parent
        return Response(raw, media_type="application/xml; charset=utf-8")

    @app.post("/api/styles")
    def upload_style(file: UploadFile = File(...), ctx: RequestCtx = Ctx):
        raw = file.file.read(STYLE_MAX + 1)
        if len(raw) > STYLE_MAX:
            raise HTTPException(400, "스타일 파일이 너무 커요")
        info = csl_style.read_info(raw)
        if not info:
            raise HTTPException(400, "CSL 스타일(.csl) 파일이 아니에요")
        try:
            xml = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise HTTPException(400, "스타일 파일은 UTF-8이어야 해요") from None
        if info.get("parent") and style_xml(ctx, info["parent"]) is None:
            raise HTTPException(400, f"이 스타일은 '{info['parent']}' 스타일을 기반으로 해요. 그 스타일 파일을 먼저 추가해 주세요.")
        style_id = csl_style.slug(info["source_id"] or file.filename or info["title"])
        ctx.lib.save_user_style(style_id, info["title"], info, xml)
        return {**info, "id": style_id, "builtin": False}

    @app.delete("/api/styles/{style_id}")
    def delete_style(style_id: str, ctx: RequestCtx = Ctx):
        if not valid_style_id(style_id) or not ctx.lib.delete_user_style(style_id):
            raise HTTPException(400, "직접 추가한 스타일만 지울 수 있어요")
        return {"ok": True}

    @app.post("/api/export")
    def export(data: dict = Body(...), ctx: RequestCtx = Ctx):
        fmt = data.get("format", "bibtex")
        papers = papers_for(ctx, data)
        if fmt == "ris":
            body, mt, ext = citations.to_ris(papers), "application/x-research-info-systems", "ris"
        elif fmt == "csljson":
            body, mt, ext = citations.to_csl_json(papers), "application/json", "json"
        else:
            body, mt, ext = citations.to_bibtex(papers), "application/x-bibtex", "bib"
        return Response(body, media_type=f"{mt}; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="paperlab-export.{ext}"'})

    @app.post("/api/import")
    def import_file(file: UploadFile = File(...), collection_id: int | None = Form(None), ctx: RequestCtx = Ctx):
        raw = file.file.read(20 * 1024 * 1024 + 1)
        if len(raw) > 20 * 1024 * 1024:
            raise HTTPException(400, "파일이 너무 커요 (20MB 초과)")
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw.decode("cp949", errors="replace")
        try:
            items = citations.parse_any(text)
        except (ValueError, json.JSONDecodeError) as e:
            raise HTTPException(400, str(e)) from e
        cid = own_collection(ctx, collection_id)
        added = skipped = 0
        lib = ctx.lib
        for it in items:
            if not it.get("title"):
                skipped += 1
                continue
            if lib.find_duplicate(it.get("doi", ""), it.get("arxiv_id", ""), it["title"]):
                skipped += 1
                continue
            pid = lib.add_paper(it)
            if cid:
                lib.set_paper_collections([pid], cid, True)
            added += 1
        return {"added": added, "skipped": skipped, "total": len(items)}

    # ------------------------------------------------------------- search
    @app.get("/api/search")
    def search(q: str, source: str = "openalex", page: int = 1, year_from: int | None = None,
               year_to: int | None = None, sort: str = "relevance", oa: bool = False, ctx: RequestCtx = Ctx):
        kind, value = detect_identifier(q)
        sources = ctx.sources
        ctx.release()  # 외부 검색 동안 DB 연결을 잡지 않는다 (F9)
        try:
            if kind in ("doi", "arxiv", "openalex"):
                res = {"items": [sources.resolve(q)], "total": 1}
            else:
                res = sources.search(q, source, page, 20, year_from, year_to, sort, oa)
        except SourceError as e:
            raise HTTPException(502, str(e)) from e
        res["items"] = mark_library(ctx, res["items"])
        return res

    # ------------------------------------------------------------------ AI
    def context_for(ctx: RequestCtx, p: dict, with_pdf: bool = True) -> PaperContext:
        """PDF는 서버가 저장소에서 직접 읽는다. 22MB 넘으면 텍스트로 대체(받지도 않음).
        with_pdf=False: OpenAI · Google API는 본문 글만 보내므로 PDF를 받지 않는다(2단계 9.5절)."""
        info = ctx.lib.pdf_info(p["id"]) or {}
        page_texts = ctx.lib.page_texts(p["id"])
        if info.get("pdf_key"):
            ctx.storage.check(info["pdf_key"])  # 남의 경로면 StorageKeyError → 404
        ctx.release()  # R2에서 PDF를 받는 동안 DB 연결을 잡지 않는다 (F9)
        data = None
        if with_pdf and info.get("pdf_key") and (info.get("pdf_size") or 0) <= AI_MAX_PDF_BYTES:
            try:
                data = ctx.storage.get(info["pdf_key"])
            except NotFound:
                data = None
        return PaperContext(title=p["title"], pdf_bytes=data, page_texts=page_texts, abstract=p.get("abstract") or "")

    @app.get("/api/papers/{pid}/summary")
    def get_summary(pid: int, ctx: RequestCtx = Ctx):
        need_paper(ctx, pid)
        maintain(ctx)
        # job = 진행 중이거나 마지막 요약 작업 (2단계 7.1절 — 탭을 닫았다 열어도 이어서 보임)
        return {"summary": ctx.lib.get_summary(pid), "job": jobs.latest_summary_job(ctx.lib, pid, ws.free)}

    @app.post("/api/papers/{pid}/summary")
    def make_summary(pid: int, ctx: RequestCtx = Ctx):
        """요약 = 작업 (2단계 15장). 202 {job}, 같은 논문 진행 중 요약이 있으면 200 {job}"""
        need_paper(ctx, pid)
        view, created = new_job(ctx, "summary", {}, pid)
        return JSONResponse({"job": view}, status_code=202 if created else 200)

    @app.get("/api/papers/{pid}/chat")
    def chat_history(pid: int, ctx: RequestCtx = Ctx):
        need_paper(ctx, pid)
        return ctx.lib.chat_history(pid)

    @app.delete("/api/papers/{pid}/chat")
    def clear_chat(pid: int, ctx: RequestCtx = Ctx):
        need_paper(ctx, pid)
        ctx.lib.clear_chat(pid)
        return {"ok": True}

    def stream_job(ctx: RequestCtx, request: Request, kind: str, params: dict, paper_id: int | None,
                   run) -> StreamingResponse:
        """대화 · 글쓰기 (9.3절): 첫 칸이 API면 요청 안 SSE 그대로, CLI면 {"type":"queued","job"} 하나 보내고 끝.
        API가 폴백 대상 오류로 실패하면 작업을 다음 칸으로 넘기고 {"type":"fallback","job"}.
        run(engine) → 이벤트 반복자 (done 이벤트 → 결과 반영).

        화면 연결이 끊기면(탭 · 창 닫음) 곧바로 작업을 취소하고 그 뒤에 온 결과는 저장하지 않는다(품질팀 H1).
        AI 호출은 별도 스레드가 돌리고, 이 비동기 생성기는 0.05초마다 끊김을 확인한다 — 한 번에 응답이 오는
        OpenAI · Google 경로도 기다리는 동안 끊김을 본다. 가비지 수집에 기대지 않는다."""
        row, _ = jobs.create_job(ctx.lib, kind, route_for(ctx, kind), params, paper_id, running_api=True)
        job_id, uid, claims, engine = row["id"], ctx.uid, ctx.claims, row["engine"]
        log.info(f"job created job={job_id} kind={kind} runner={row['runner']} engine={engine}")
        if row["runner"] == "cli":
            view = jobs.get_job(ctx.lib, job_id, ws.free)
            return StreamingResponse(iter([_sse({"type": "queued", "job": view})]), media_type="text/event-stream",
                                     headers=SSE_HEADERS)
        token = str(row["lease_token"])
        events_src = run(engine)  # 여기서 PDF · 본문을 준비(트랜잭션은 커밋 — F9)
        ctx.release()
        q: queue.Queue = queue.Queue()
        stop = threading.Event()

        def produce() -> None:
            try:
                for ev in events_src:
                    if stop.is_set():
                        break
                    q.put(("ev", ev))
            except AIError as e:
                q.put(("err", e))
            except Exception as e:  # noqa: BLE001 - 아래에서 실패로 기록
                q.put(("exc", e))
            finally:
                q.put(("end", None))
                close = getattr(events_src, "close", None)
                if stop.is_set() and close:
                    try:
                        close()  # 스트림을 닫아 회사 API 연결도 끊는다
                    except Exception:  # noqa: BLE001
                        pass

        def save_done(ev: dict) -> list[str]:
            with db.user_tx(claims) as lib:
                try:
                    j = jobs.lock_leased(lib, job_id, token)
                except jobs.JobError:
                    return []
                status, res = jobs.finish_success(lib, j, {"text": ev["text"], "citations": ev.get("citations") or []},
                                                  engine)
            res = res or {}
            if status != "succeeded":
                return [_sse({"type": "error", "error": "작업을 취소했어요" if status == "cancelled"
                              else jobs.DEFAULT_ERRORS["apply_failed"]})]
            if "message_id" in res:
                ev["id"] = res["message_id"]
            ev["job_id"] = job_id
            return [_sse(ev)]

        def fail(code: str, message: str) -> list[str]:
            with db.user_tx(claims) as lib:
                try:
                    j = jobs.lock_leased(lib, job_id, token)
                except jobs.JobError:
                    return []
                jobs.record_key_error(lib, engine, code)
                status = jobs.fail_or_fallback(lib, j, code, message, guide=guide())
                view = jobs.get_job(lib, job_id, ws.free)
            log.info(f"job failed job={job_id} code={code} status={status}")
            if status == "queued":
                if view["runner"] == "api":
                    runner.enqueue(job_id, uid)
                return [_sse({"type": "fallback", "job": view})]
            return [_sse({"type": "error", "error": view["error"], "job": view})]

        def cancel_now() -> None:
            try:
                with db.user_tx(claims) as lib:
                    jobs._end(lib, jobs.lock_leased(lib, job_id, token), "cancelled", "interrupted", jobs.INTERRUPTED)
                log.info(f"job cancelled job={job_id} (화면 연결 끊김)")
            except (jobs.JobError, DBUnavailable):
                pass

        async def events():
            ended = False
            threading.Thread(target=produce, name=f"sse-job-{job_id}", daemon=True).start()
            try:
                while True:
                    try:
                        kind_, item = q.get_nowait()
                    except queue.Empty:
                        if await request.is_disconnected():
                            return
                        await asyncio.sleep(0.05)
                        continue
                    if kind_ == "ev" and item["type"] != "done":
                        yield _sse(item)
                        continue
                    if await request.is_disconnected():
                        return  # 끊긴 뒤에 온 결과는 저장하지 않는다
                    ended = True
                    if kind_ == "ev":
                        out = await run_in_threadpool(save_done, item)
                    elif kind_ == "err":
                        out = await run_in_threadpool(fail, item.code or "api_server", str(item))
                    elif kind_ == "exc":
                        log.warning("sse job crashed job=%s: %s", job_id, type(item).__name__)
                        out = await run_in_threadpool(fail, "api_server", "AI 응답을 처리하지 못했어요")
                    else:
                        out = await run_in_threadpool(fail, "bad_output", "AI 응답이 끝나기 전에 멈췄어요")
                    for x in out:
                        yield x
                    return
            except DBUnavailable:
                yield _sse({"type": "error", "error": DB_UNAVAILABLE["detail"]})
            finally:
                stop.set()
                if not ended:
                    # 끊김 · 취소된 스트림: 곧바로 취소로 (취소 영역 안에서는 await할 수 없으므로 스레드로)
                    threading.Thread(target=cancel_now, name=f"sse-cancel-{job_id}", daemon=True).start()

        return StreamingResponse(events(), media_type="text/event-stream", headers=SSE_HEADERS)

    @app.post("/api/papers/{pid}/chat")
    def chat(pid: int, request: Request, data: dict = Body(...), ctx: RequestCtx = Ctx):
        p = need_paper(ctx, pid)
        question = str(data.get("question") or "").strip()
        if not question:
            raise HTTPException(400, "질문을 입력해 주세요")
        if len(question) > 8000:
            raise HTTPException(400, "질문이 너무 길어요")

        def run(engine: str):
            history = [{"role": m["role"], "content": m["content"]} for m in ctx.lib.chat_history(pid)]
            paper_ctx = context_for(ctx, p, with_pdf=engine == "claude")
            return ctx.ai.chat(paper_ctx, history, question, engine=engine)

        return stream_job(ctx, request, "chat", {"question": question}, pid, run)

    @app.post("/api/ai/write")
    def ai_write(request: Request, data: dict = Body(...), ctx: RequestCtx = Ctx):
        """원고 글쓰기 도우미 (스트리밍 · CLI면 작업)"""
        text = str(data.get("text") or "").strip()
        mode = data.get("mode") or "polish"
        if not text and mode != "draft":
            raise HTTPException(400, "다듬을 글을 선택해 주세요")
        mid = data.get("manuscript_id")
        if mid is not None and (isinstance(mid, bool) or not isinstance(mid, int) or not 0 < mid < 10 ** 15):
            raise HTTPException(400, "원고 번호가 올바르지 않아요")
        keys = [str(k)[:200] for k in data.get("keys") or []][:30]
        params = {"mode": str(mode)[:20], "text": text, "instruction": str(data.get("instruction") or "")[:2000],
                  "context": str(data.get("context") or "")[:6000], "keys": keys, "manuscript_id": mid}

        def run(engine: str):
            sources = jobs.write_sources(ctx.lib, keys)
            return ctx.ai.write(params["mode"], text, instruction=params["instruction"], context=params["context"],
                                sources=sources, engine=engine)

        return stream_job(ctx, request, "write", params, None, run)

    # ------------------------------------------------------- doc formats
    def user_format_id(format_id) -> int | None:
        if not isinstance(format_id, str):
            return None
        m = re.fullmatch(r"user-(\d{1,9})", str(format_id or ""))
        return int(m.group(1)) if m else None

    def format_exists(ctx: RequestCtx, format_id) -> bool:
        if doc_formats.is_builtin(format_id):
            return True
        fid = user_format_id(format_id)
        return fid is not None and ctx.lib.get_doc_format(fid) is not None

    def user_format_view(row: dict) -> dict:
        base = row["base"] if doc_formats.is_builtin(row["base"]) else doc_formats.DEFAULT_ID
        try:
            data = doc_formats.normalize(row["data"], base)
        except doc_formats.FormatError:
            data = doc_formats.builtin_data(base)
        return {"id": f"user-{row['id']}", "name": row["name"], "builtin": False, "base": row["base"],
                "cover_kind": data["cover"]["kind"], "description": "", "updated_at": row["updated_at"],
                "data": data, "created_at": row["created_at"]}

    def load_format(ctx: RequestCtx, format_id) -> dict | None:
        """양식 id → 조회 응답 모양(data 포함). 없으면 None"""
        if doc_formats.is_builtin(format_id):
            return dict(doc_formats.builtin_entry(format_id), data=doc_formats.builtin_data(format_id),
                        created_at=None)
        fid = user_format_id(format_id)
        row = ctx.lib.get_doc_format(fid) if fid is not None else None
        return user_format_view(row) if row else None

    def usage_counts(ctx: RequestCtx) -> dict[str, int]:
        """양식 id → 쓰는 원고 수. 지워진 양식을 가리키는 원고는 기본 양식으로 센다"""
        out: dict[str, int] = {}
        for key, n in ctx.lib.doc_format_usage().items():
            key = key if format_exists(ctx, key) else doc_formats.DEFAULT_ID
            out[key] = out.get(key, 0) + n
        return out

    def format_detail(ctx: RequestCtx, format_id) -> dict | None:
        """조회 응답: 목록 항목(used_by 포함) + data, created_at"""
        found = load_format(ctx, format_id)
        if found:
            found["used_by"] = usage_counts(ctx).get(found["id"], 0)
        return found

    def need_user_format(ctx: RequestCtx, format_id) -> dict:
        if doc_formats.is_builtin(format_id):
            raise HTTPException(403, "기본 양식은 바꿀 수 없어요. 복사해서 내 양식으로 만들어 쓰세요")
        fid = user_format_id(format_id)
        row = ctx.lib.get_doc_format(fid) if fid is not None else None
        if not row:
            raise HTTPException(404, "양식을 찾을 수 없어요")
        return row

    def format_name(data: dict) -> str:
        name = data.get("name")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 60:
            raise HTTPException(400, "name: 이름은 1~60자로 입력해 주세요")
        return name.strip()

    @app.get("/api/doc-formats")
    def list_doc_formats(ctx: RequestCtx = Ctx):
        usage_map = usage_counts(ctx)
        out = [doc_formats.builtin_entry(k) for k in doc_formats.BUILTINS]
        for r in ctx.lib.list_doc_formats():
            item = user_format_view(r)
            item.pop("data")
            item.pop("created_at")
            out.append(item)
        for item in out:
            item["used_by"] = usage_map.get(item["id"], 0)
        return out

    @app.get("/api/doc-formats/{format_id}")
    def get_doc_format(format_id: str, ctx: RequestCtx = Ctx):
        found = format_detail(ctx, format_id)
        if not found:
            raise HTTPException(404, "양식을 찾을 수 없어요")
        return found

    @app.post("/api/doc-formats/import")
    async def import_doc_format(request: Request):
        """양식 파일에서 서식을 읽어 저장하지 않은 양식으로 돌려준다(DB를 쓰지 않음).

        20MB 제한은 업로드를 끝까지 받기 전에 적용한다(Content-Length, 받는 중 누적 크기).
        """
        too_big = HTTPException(400, "파일이 너무 커요 (20MB 초과)")
        limit = format_import.MAX_BYTES + 256 * 1024  # 파일 + multipart 머리글 여유
        try:
            declared = int(request.headers.get("content-length") or 0)
        except ValueError:
            declared = 0
        if declared > limit:
            raise too_big
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > limit:
                raise too_big
        sent = False

        async def replay():
            nonlocal sent
            if sent:
                return {"type": "http.request", "body": b"", "more_body": False}
            sent = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        try:
            form = await Request(request.scope, replay).form()
        except Exception as e:  # noqa: BLE001 - 깨진 multipart
            raise HTTPException(400, f"올린 파일을 읽지 못했어요: {e}") from e
        file = form.get("file")
        if file is None or isinstance(file, str):
            raise HTTPException(400, "양식 파일(file)을 올려 주세요")
        raw = await file.read(format_import.MAX_BYTES + 1)
        base = form.get("base") if isinstance(form.get("base"), str) else ""
        try:
            return await run_in_threadpool(format_import.import_format, file.filename or "", raw,
                                           base or doc_formats.DEFAULT_ID)
        except format_import.FormatImportError as e:
            raise HTTPException(400, str(e)) from e

    @app.post("/api/doc-formats")
    def add_doc_format(data: dict = Body(...), ctx: RequestCtx = Ctx):
        base = data.get("base")
        if not doc_formats.is_builtin(base):
            raise HTTPException(400, "base: 기본 양식 id(" + ", ".join(doc_formats.BUILTINS) + ") 중 하나를 골라 주세요")
        name = format_name(data)
        if ctx.lib.count_doc_formats() >= 50:
            raise HTTPException(400, "내 양식은 50개까지 만들 수 있어요. 안 쓰는 양식을 지워 주세요")
        try:
            fmt_data = doc_formats.normalize(data.get("data"), base)
        except doc_formats.FormatError as e:
            raise HTTPException(400, str(e)) from e
        return format_detail(ctx, f"user-{ctx.lib.add_doc_format(name, base, fmt_data)}")

    @app.patch("/api/doc-formats/{format_id}")
    def patch_doc_format(format_id: str, data: dict = Body(...), ctx: RequestCtx = Ctx):
        row = need_user_format(ctx, format_id)
        name = format_name(data) if "name" in data else None
        fmt_data = None
        if "data" in data:
            try:
                # data는 통째로 바꾼다(빠진 항목은 base 값)
                fmt_data = doc_formats.normalize(data["data"], row["base"])
            except doc_formats.FormatError as e:
                raise HTTPException(400, str(e)) from e
        ctx.lib.update_doc_format(row["id"], name, fmt_data)
        return format_detail(ctx, format_id)

    @app.delete("/api/doc-formats/{format_id}")
    def delete_doc_format(format_id: str, ctx: RequestCtx = Ctx):
        row = need_user_format(ctx, format_id)
        key = f"user-{row['id']}"
        reset = ctx.lib.delete_doc_format(row["id"], key)
        if ctx.settings.get("doc_format_default") == key:
            ctx.lib.update_settings({"doc_format_default": doc_formats.DEFAULT_ID}, ctx.email)
        return {"ok": True, "reset_manuscripts": reset}

    # -------------------------------------------------------- manuscripts
    @app.get("/api/manuscript-templates")
    def manuscript_templates():
        return [{"id": k, "name": v["name"], "description": v["description"]} for k, v in TEMPLATES.items()]

    def with_format(ctx: RequestCtx, m: dict) -> dict:
        # 지워진 양식을 가리키면 기본 양식으로 돌려준다
        if not format_exists(ctx, m.get("doc_format")):
            m["doc_format"] = doc_formats.DEFAULT_ID
        return m

    @app.get("/api/manuscripts")
    def list_manuscripts(ctx: RequestCtx = Ctx):
        return [with_format(ctx, m) for m in ctx.lib.list_manuscripts()]

    @app.post("/api/manuscripts")
    def add_manuscript(data: dict = Body(default={}), ctx: RequestCtx = Ctx):
        tpl = TEMPLATES.get(data.get("template") or "blank", TEMPLATES["blank"])
        content = data.get("content") if data.get("content") is not None else tpl["content"]
        title = (data.get("title") or "").strip() or _md_title(content) or "제목 없는 원고"
        fmt_id = data.get("doc_format")
        if fmt_id is not None and not format_exists(ctx, fmt_id):
            raise HTTPException(400, "양식을 찾을 수 없어요")
        if fmt_id is None:
            fmt_id = ctx.settings.get("doc_format_default")
            if not format_exists(ctx, fmt_id):
                fmt_id = doc_formats.DEFAULT_ID
        mid = ctx.lib.add_manuscript(title, content, data.get("template") or "blank", fmt_id)
        return with_format(ctx, ctx.lib.get_manuscript(mid))

    @app.get("/api/manuscripts/{mid}")
    def get_manuscript(mid: int, ctx: RequestCtx = Ctx):
        m = ctx.lib.get_manuscript(mid)
        if not m:
            raise HTTPException(404, "원고를 찾을 수 없어요")
        return with_format(ctx, m)

    @app.patch("/api/manuscripts/{mid}")
    def patch_manuscript(mid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        if not ctx.lib.get_manuscript(mid):
            raise HTTPException(404, "원고를 찾을 수 없어요")
        if "content" in data and "title" not in data:
            data["title"] = _md_title(data["content"] or "") or None
        if "doc_format" in data and not format_exists(ctx, data["doc_format"]):
            raise HTTPException(400, "양식을 찾을 수 없어요")
        if "cover" in data:
            try:
                data["cover"] = doc_formats.validate_cover(data["cover"])
            except doc_formats.FormatError as e:
                raise HTTPException(400, str(e)) from e
        ctx.lib.update_manuscript(mid, data)
        return {"ok": True, "updated_at": ctx.lib.get_manuscript(mid)["updated_at"]}

    @app.delete("/api/manuscripts/{mid}")
    def delete_manuscript(mid: int, ctx: RequestCtx = Ctx):
        if not ctx.lib.delete_manuscript(mid):
            raise HTTPException(404, "원고를 찾을 수 없어요")
        return {"ok": True}

    @app.post("/api/citekeys")
    def lookup_citekeys(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """인용키 → CSL-JSON (내 서재에 없는 키는 null)"""
        keys = [str(k) for k in data.get("keys") or []][:2000]
        found = ctx.lib.papers_by_citekeys(keys)
        return {"items": {k: (citations.to_csl_item(found[k]) if k in found else None) for k in keys},
                "issues": {k: citations.citation_issues(found[k]) for k in found}}

    def _file_response(body: bytes, filename: str, fmt: str, stream: bool = False) -> Response:
        types = {"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 "hwpx": "application/hwp+zip", "md": "text/markdown; charset=utf-8"}
        safe = re.sub(r'[\\/:*?"<>|\r\n]+', "_", filename or "document").strip() or "document"
        headers = {"Content-Disposition": f"attachment; filename=\"document.{fmt}\"; filename*=UTF-8''{quote(safe + '.' + fmt)}"}
        if stream:
            # 큰 응답은 1MB씩 나눠 보낸다 (명세 7.5)
            def chunks():
                for i in range(0, len(body), 1024 * 1024):
                    yield body[i:i + 1024 * 1024]
            return StreamingResponse(chunks(), media_type=types[fmt], headers=headers)
        return Response(body, media_type=types[fmt], headers=headers)

    @app.post("/api/export-document")
    def export_document(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """화면이 서식을 입힌 원고(블록 목록)를 워드·한글·마크다운 파일로 만든다."""
        fmt = data.get("format")
        blocks = data.get("blocks") or []
        if fmt not in ("docx", "hwpx", "md") or not isinstance(blocks, list):
            raise HTTPException(400, "format은 docx, hwpx, md 중 하나예요")
        # 양식: 없거나 'default'면 지금 서식 그대로. 마크다운은 양식과 무관
        fmt_data, cover = None, None
        fmt_id = data.get("doc_format")
        if fmt != "md" and fmt_id not in (None, "", doc_formats.DEFAULT_ID):
            found = load_format(ctx, fmt_id)
            if not found:
                raise HTTPException(400, "양식을 찾을 수 없어요")
            fmt_data = found["data"]
            if fmt_data["cover"]["kind"] != "none" and data.get("cover") is not None:
                try:
                    cover = doc_formats.validate_cover(data["cover"])
                except doc_formats.FormatError as e:
                    raise HTTPException(400, str(e)) from e
        warnings: list[str] = []
        try:
            if fmt == "docx":
                body = writer.to_docx(blocks, data.get("meta") or {}, fmt_data, cover, warnings)
            elif fmt == "hwpx":
                body = writer.to_hwpx(blocks, data.get("meta") or {}, fmt_data, cover, warnings)
            else:
                body = writer.to_markdown(blocks).encode("utf-8")
        except (ValueError, KeyError, TypeError) as e:
            raise HTTPException(400, f"문서를 만들지 못했어요: {e}") from e
        response = _file_response(body, data.get("filename") or "원고", fmt)
        if warnings:
            # 화면이 토스트로 보여 준다 (예: ["cover-missing:name,department"])
            response.headers["X-PaperLab-Warnings"] = quote(json.dumps(warnings, ensure_ascii=False))
        return response

    # 워드·한글 문서의 [@인용키] → 서식 있는 인용 (원래 서식 유지). 토큰은 사용자별(토큰 + user_id)
    compose_store: dict[str, dict] = st.compose_store

    @app.post("/api/compose/scan")
    def compose_scan(file: UploadFile = File(...), ctx: RequestCtx = Ctx):
        data = file.file.read(COMPOSE_MAX + 1)
        if len(data) > COMPOSE_MAX:
            raise HTTPException(400, "파일이 너무 커요 (30MB 초과)")
        try:
            kind = compose.detect_kind(file.filename or "", data)
            scan = compose.docx_scan(data) if kind == "docx" else compose.hwpx_scan(data)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        except Exception as e:  # noqa: BLE001 - 손상된 문서
            raise HTTPException(400, f"문서를 읽지 못했어요: {e}") from e
        token = uuid.uuid4().hex
        with st.compose_lock:
            # 메모리 보호: 전체 10개, 사용자당 3개까지 (오래된 것부터 버림)
            mine = [k for k, v in compose_store.items() if v["uid"] == ctx.uid]
            for k in mine[:max(0, len(mine) - 2)]:
                compose_store.pop(k, None)
            while len(compose_store) >= 10:
                compose_store.pop(next(iter(compose_store)))
            compose_store[token] = {"uid": ctx.uid, "data": data, "kind": kind,
                                    "filename": file.filename or f"document.{kind}"}
        keys = [it["key"] for c in scan["citations"] for it in c.items]
        found = ctx.lib.papers_by_citekeys(keys)
        return {
            "token": token, "kind": kind, "filename": file.filename,
            "has_bib_marker": scan["has_bib_marker"],
            "citations": [{"raw": c.raw, "items": c.items} for c in scan["citations"]],
            "items": {k: (citations.to_csl_item(found[k]) if k in found else None) for k in dict.fromkeys(keys)},
        }

    @app.post("/api/compose/apply")
    def compose_apply(data: dict = Body(...), ctx: RequestCtx = Ctx):
        with st.compose_lock:
            entry = compose_store.get(str(data.get("token") or ""))
        if not entry or entry["uid"] != ctx.uid:
            raise HTTPException(404, "올린 문서를 찾을 수 없어요. 다시 올려 주세요.")
        rendered = data.get("rendered") or []
        bibliography = data.get("bibliography") or []
        bib_title = data.get("bib_title") or "참고문헌"
        # 형식 검사 (품질팀 F7): rendered = [{"runs": [...]}, …], bibliography = [[run, …], …]
        if (not isinstance(rendered, list) or not all(isinstance(x, dict) for x in rendered)
                or not isinstance(bibliography, list) or not all(isinstance(x, list) for x in bibliography)
                or not isinstance(bib_title, str)):
            raise HTTPException(400, "인용 데이터 형식이 틀렸어요")
        try:
            if entry["kind"] == "docx":
                body = compose.docx_apply(entry["data"], rendered, bibliography, bib_title, bool(data.get("note_style")))
            else:
                body = compose.hwpx_apply(entry["data"], rendered, bibliography, bib_title)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        except (TypeError, KeyError, AttributeError, IndexError) as e:
            raise HTTPException(400, "인용 데이터 형식이 틀렸어요") from e
        stem = re.sub(r"\.(docx|hwpx)$", "", entry["filename"], flags=re.I)
        return _file_response(body, f"{stem}_인용완료", entry["kind"], stream=True)

    # ------------------------------------------------- 개발 서버 전용 가짜 저장소
    if dev and isinstance(store, FakeStorage):
        # 같은 출처 경로로 가짜 저장소를 열어, 브라우저가 서명 주소로 실제로 올리고(PUT) 받게(GET) 한다 (품질팀 F10).
        # 운영(serve.py)은 dev=False라 이 경로가 없다. 인증 대신 서명 · 만료를 검사한다(R2 서명 주소와 같은 성격).
        @app.put("/_dev_storage/{key:path}")
        async def dev_storage_put(key: str, request: Request):
            q = request.query_params
            if not store.check_signed("PUT", key, q.get("X-Amz-Expires"), q.get("X-Amz-Signature")):
                return Response(status_code=403)
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > MAX_PDF_BYTES + 1024:
                    return Response(status_code=413)
            store.objects[key] = bytes(body)
            return Response(status_code=200)

        @app.get("/_dev_storage/{key:path}")
        def dev_storage_get(key: str, request: Request):
            q = request.query_params
            if not store.check_signed("GET", key, q.get("X-Amz-Expires"), q.get("X-Amz-Signature")):
                return Response(status_code=403)
            data = store.objects.get(key)
            if data is None:
                return Response(status_code=404)
            return Response(data, media_type="application/pdf", headers={"Cache-Control": "no-store"})

    worker_api.register(app, db, allowlist, ws, guide, runner)

    # -------------------------------------------------------------- static
    @app.get("/")
    def index():
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"})

    # 운영에서는 개발 전용 파일(이메일 로그인 모듈)을 내보내지 않는다 (1단계 운영은 구글 로그인만)
    app.mount("/static", AppStaticFiles(directory=STATIC_DIR, hidden=() if dev else DEV_ONLY_STATIC), name="static")
    return app
