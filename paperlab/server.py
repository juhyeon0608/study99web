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
from types import SimpleNamespace
from typing import Callable
from urllib.parse import quote

import psycopg
from fastapi import Body, Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from psycopg.types.json import Jsonb
from contextlib import asynccontextmanager

from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import __version__, citations, compose, convert, csl_style, doc_formats, downloads, explain, find, format_import, jobs, \
    pdf, rag, sync, translate, verify, versions, worker_api, writer
from .ai import MAX_PDF_BYTES as AI_MAX_PDF_BYTES
from .ai import MODELS, WRITE_MODES, WRITE_NO_TEXT_MODES, AIError, AIService, PaperContext
from .api_runner import ApiRunner
from .auth import Allowlist, AuthError, JWKSCache, NotAllowed, TokenVerifier, bearer_token
from . import extsources
from . import figures
from . import mschat
from . import figgen  # 그림 만들기 · 자연어로 고치기 (docs/specs/writing-figure-ai.md)
from . import proofread  # 맞춤법 · 띄어쓰기 점검 작업 (2026-10-17)
from .citecache import TTL_REFERENCES, PgStore, fresh as cache_fresh, read_oa
from .config import ServerConfig, UserSettings, split_settings_changes
from .crypto import DecryptError, SecretBox
from .db import (PAPER_TRASHED, SYNC_MODES, SYNC_OPS_DAYS, TOMBSTONE_DAYS, TRASH_DAYS, Database, DBUnavailable, Library,
                 NotFoundError, folder_name_problem, iso, normalize_doi)
from .db import local_ai_state as _local_ai_state
from . import citegraph as cg
from .graph_build import (DEADLINE_S, ERRORS as GRAPH_ERRORS, FIELDS_META, WARNINGS as GRAPH_WARNINGS, BadSeed, Flights,
                          GraphBuilder, GraphError, GraphGate, lookup_dois, paper_view, parse_openalex_id, parse_recommend_request,
                          parse_request as parse_graph_request, seed_from_paper)
from .manuscripts import TEMPLATES
from .sources import (GraphCancelled, GraphSources, SourceError, Sources, UpstreamError, check_doi, detect_identifier,
                      merge)
from .storage import (MAX_PDF_BYTES, BackupSizeCache, FakeStorage, FigureSizeCache, NotFound, Storage, StorageError,
                      StorageKeyError, UserStorage, create_storage, is_upload_id, new_upload_id)

log = logging.getLogger("paperlab.server")
access_log = logging.getLogger("paperlab.access")

STATIC_DIR = Path(__file__).parent / "static"
BUILTIN_STYLES = STATIC_DIR / "vendor" / "csl" / "styles"
# Windows 레지스트리에 .js가 text/plain으로 잘못 등록된 경우 모듈 스크립트가 막히므로 직접 지정한다
for _ext, _type in ((".js", "text/javascript"), (".mjs", "text/javascript"), (".css", "text/css"),
                    (".woff2", "font/woff2"), (".svg", "image/svg+xml")):
    mimetypes.add_type(_type, _ext)
ITEM_TYPES = {"article": "학술지 논문", "conference": "학회 발표", "preprint": "프리프린트", "book": "단행본",
              "chapter": "책의 장", "thesis": "학위논문", "report": "보고서", "dataset": "데이터셋",
              "document": "문서"}
DOC_ONLY = "문서 (논문 정보 없음)"
STATUSES = {"unread": "읽을 예정", "reading": "읽는 중", "done": "다 읽음"}
PUBLIC_API = {("GET", "/api/health"), ("HEAD", "/api/health"), ("GET", "/api/public-config")}
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")
MAX_UPLOAD_FILES = 20
COMPOSE_MAX = 30 * 1024 * 1024  # 30MB 유지 (명세 7.5, 팀장 결정 S8 — Funnel 대역폭 제한 · 변경 최소)
STYLE_MAX = 2 * 1024 * 1024
WARN_LEVEL, FULL_LEVEL = 0.80, 0.95
# 6단계 K-46 DB 예산: 무료 한도의 90%, 편당 증가 추정 · 첫 PGroonga 할당 (스파이크 S-5 (e) 실측 — 가정값)
DB_LEVEL, DB_PER_PAPER, DB_FIRST_ALLOC = 0.90, int(0.26 * 1024 ** 2), 55 * 1024 ** 2
SYSTEM_TTL = 30.0  # 사용자 트랜잭션 안에서 저장 공간 · DB 크기 합계를 다시 쓰는 시간(초 — QA D7)
HEALTH_DB_TIMEOUT = 4.0  # /api/health?deep=1 의 DB 연결 대기 · 문 실행 제한(초)
SSE_HEADERS = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}
DETACH_CHECK_S = 5.0  # 화면이 떠나 백그라운드로 넘긴 SSE 작업: [취소] 읽기 · 리스 연장 간격(초 — 리스 90초 안)
CSP = "img-src 'self' data: blob: https://*.googleusercontent.com; font-src 'self' data:; form-action 'self'"
KST = timezone(timedelta(hours=9))
TAG_COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}")  # 빈 값('') = 색 없음
GRAPH_BODY_MAX = 4096  # 인용 그래프 요청 본문 (명세 9.1)
BAD_SEED = {"detail": "이 논문으로는 그래프를 만들 수 없어요. DOI · arXiv 번호 · 제목 형식을 확인해 주세요.", "code": "bad_seed"}
BAD_REC = {"detail": "추천 요청이 올바르지 않아요.", "code": "bad_request"}  # 1C 명세 9.4절
NO_SEEDS = {"detail": "인용한 논문에 OpenAlex 번호가 없어 찾을 수 없어요.", "code": "no_seeds"}

# 요청 id: 들어온 X-Request-Id가 이 모양이면 그대로, 아니면 새로 (로그 줄 끼워 넣기 방지)
_REQUEST_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,64}")
BAD_HOST = {"detail": "허용되지 않은 호스트", "code": "bad_host"}
AUTH_REQUIRED = {"detail": "로그인이 필요해요", "code": "auth_required"}
NOT_ALLOWED = {"detail": "허용되지 않은 계정이에요", "code": "not_allowed"}
TRASHED_DUP = "휴지통에 같은 논문이 있어요"
DB_UNAVAILABLE = {"detail": "데이터베이스에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.", "code": "db_unavailable"}


class BadPdf(Exception):
    """PDF를 열 수 없음 (손상 · 암호 등 — 화면 문구는 고정)"""


BAD_PDF = "PDF를 열 수 없어요. 손상되었거나 암호가 걸린 파일인지 확인해 주세요"
IMAGE_NO_TEXT = "사진(이미지)은 글자를 읽지 않아요. 본문 검색과 AI 기능은 쓸 수 없어요."


class ApiError(Exception):
    """화면에 {"detail", "code", …추가 필드}로 보낼 오류 (선택 동기화 7.2절 — local_only · holder_required 등)"""

    def __init__(self, status: int, code: str, detail: str, **extra):
        super().__init__(code)
        self.status, self.code, self.detail, self.extra = status, code, detail, extra


# 선택 동기화 (docs/specs/selective-sync.md 7.2 · 10.9절)
NO_SYNC_PC = ("폴더 동기화를 켠 PC(0.4.0 이상)가 없어 ‘PC에만’으로 바꿀 수 없어요. "
              "PC 앱에서 폴더 동기화를 먼저 켜 주세요.")
HOLDER_REQUIRED = "어느 PC에 둘지 골라 주세요"
HOLDER_NOT_ELIGIBLE = "고른 PC는 폴더 동기화를 켠 0.4.0 이상의 연결된 PC가 아니에요"
DB_PER_LOCAL = 8 * 1024  # 로컬 항목 한 편의 DB 증가 추정(가정 — 본문 · PGroonga 색인 없음, 6장)


def db_local_ai_state(loc: dict) -> str:
    """로컬 항목 행(Library.local_info) → "ok" | "unsupported" (확장자가 보관 PC 추출 목록 밖)"""
    return _local_ai_state(loc.get("file_name") or loc.get("source_name") or "")


def local_only_detail(holder_name: str, gone: bool, change: bool = False) -> str:
    """로컬 항목을 서버에서 열거나 바꿀 수 없을 때 (7.2절 문구)"""
    if gone:
        return "연결이 해지된 PC에만 있던 파일이라 열 수 없어요. 파일이 있으면 [파일 다시 올리기]로 올려 주세요"
    name = holder_name or "PC"
    if change:
        return f"이 파일은 ‘{name}’에만 있어요. 바꾸려면 그 PC의 동기화 폴더에서 파일을 바꿔 주세요"
    return f"이 파일은 ‘{name}’에만 있어요. 그 PC의 PaperLab 앱에서 열 수 있어요"


def _md_title(content: str) -> str:
    m = re.search(r"^#\s+(.+)$", content or "", re.M)
    return m.group(1).strip()[:200] if m else ""


def _sse(ev: dict) -> str:
    return f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"


def _done_only(events):
    """쉬운 설명: 중간 글(JSON 조각)은 화면에 흘리지 않고 끝(done)만 (4단계 6.2절)"""
    try:
        for ev in events:
            if ev.get("type") == "done":
                yield ev
    finally:
        close = getattr(events, "close", None)
        if close:
            close()


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
        # 지금 트랜잭션이 롤백(요청 실패)으로 끝날 때 할 정리 — 그 트랜잭션이 가리키게 하려던 R2 파일 · 임시 파일 지우기 (QA D8)
        self.on_rollback: list[Callable[[], None]] = []

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
            self.on_rollback.clear()  # 커밋됐으니 이제 DB가 가리키는 파일

    def finish(self, exc: BaseException | None) -> None:
        """트랜잭션을 끝낸다(오류면 ROLLBACK). 커밋이 끝난 뒤에만 after_commit, 롤백(커밋 실패 포함)이면 on_rollback."""
        committed = False
        try:
            if self._tx is not None:
                tx, self._tx, self._lib = self._tx, None, None
                if exc is None:
                    tx.__exit__(None, None, None)
                else:
                    tx.__exit__(type(exc), exc, exc.__traceback__)
            committed = exc is None
        finally:
            self._run(self.after_commit if committed else self.on_rollback)

    def _run(self, fns: list[Callable[[], None]]) -> None:
        for fn in fns:
            try:
                fn()
            except Exception as e:  # noqa: BLE001 - 정리는 실패해도 응답은 그대로(DB가 기준)
                log.warning("cleanup failed user=%s: %s", self.uid, type(e).__name__)

    def retry_names(self, fn: Callable[[], object]) -> object:
        """PC 파일 이름 겹침 경합(유일 색인 위반 23505 — 다른 요청이 같은 이름을 먼저 씀): 저장점 안에서 fn을 부르고
        걸리면 한 번 더, 그래도 걸리면 409 (QA D3). 실패한 시도가 더한 after_commit은 버리고 on_rollback은 바로 실행"""
        for attempt in (1, 2):
            n_after, n_back = len(self.after_commit), len(self.on_rollback)
            try:
                with self.lib.conn.transaction():
                    return fn()
            except psycopg.errors.UniqueViolation:
                undo = self.on_rollback[n_back:]
                del self.after_commit[n_after:], self.on_rollback[n_back:]
                self._run(undo)
                if attempt == 2:
                    log.info("file name race user=%s", self.uid)
                    raise HTTPException(409, "같은 이름의 파일이 방금 생겼어요. 다시 시도해 주세요") from None

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
               releases: Path | None = None, runner_opts: dict | None = None, embedder=...,
               rag_cache: "rag.VectorCache | None" = None) -> FastAPI:
    """앱을 만든다. commit = 배포한 git 커밋 앞 7자리(/api/health의 version에 붙음 — update.ps1 확인용).
    diag_hang: 감시 작업 검사용 진단 스위치(AC-77) — 참이면 /api/health가 응답하지 않는 것처럼 오래 멈춘다.
    releases: 설치 파일 폴더(없으면 PAPERLAB_RELEASES_DIR · D:\\PaperLab\\releases), runner_opts: API 실행기 수치(테스트 주입).
    embedder: 3단계 임베딩(기본 = 서버 PC에 모델 파일이 있으면 ONNX, 없으면 None — 낱말 검색만. 테스트는 rag.HashEmbedder()),
    rag_cache: 벡터 캐시(테스트가 상한 · 유휴 시간을 작게 주입).
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
    st.figure_sizes = FigureSizeCache(store)  # 원고 그림 합계 (사용량 · 95% 규칙에 더함)
    # 5단계 KCI · RISS · Europe PMC 검색(공용 키 — U-1). 테스트는 transport를 넣은 것으로 바꿈
    st.ext = extsources.ExtSources(config.kci_api_key, config.riss_api_key)
    st.ext_busy = {}  # 사용자당 외부 검색 동시 수(메모리만 — 11장)
    st.ext_lock = threading.Lock()
    st.compose_store = {}
    st.compose_lock = threading.Lock()
    # 2단계: 작업 큐 · 연결된 PC · 설치 파일 (명세 2단계 7 · 8 · 13.7.1 · 15장)
    st.workers = ws = worker_api.WorkerState()
    jobs.mark_started()  # 이 시각 전에 잡힌 화면 작업의 리스가 지나면 "서버가 다시 시작돼" (뒤면 "너무 오래 걸려")
    downloads.register(app, Path(releases) if releases else downloads.releases_dir())

    def guide() -> str:
        """경로가 없을 때 안내 — 설치 파일이 있는지에 따라 (팀장 결정 Q2a-1)"""
        return jobs.no_route_message(bool(st.release_info()))

    st.guide = guide
    # 3단계 RAG: 임베딩 · 벡터 캐시는 서버 프로세스 하나에 하나 (K-2 · K-21)
    st.rag = rg = rag.Rag(store, rag.load_embedder() if embedder is ... else embedder, rag_cache)
    st.runner = runner = ApiRunner(db, store, lambda lib, uid: load_user_settings(lib, st.box, uid),
                                   lambda get: st.ai_factory(get), guide, max_pdf_bytes=AI_MAX_PDF_BYTES,
                                   rag=rg, sources_factory=lambda get: st.sources_factory(get), **(runner_opts or {}))

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
            # 그림은 이 서버 · data: · blob:(PDF.js) · 구글 프로필 사진만 — AI 답에 섞인 바깥 그림 주소가 불리지 않게 (3단계 품질팀 M1)
            response.headers["Content-Security-Policy"] = CSP
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
        except Exception as e:  # noqa: BLE001 - 처리되지 않은 예외도 보안 헤더가 붙은 500으로 (품질팀 N5). 내용은 숨김
            log.error("unhandled %s %s: %s", request.method, path, type(e).__name__)
            response = JSONResponse({"detail": "서버 오류가 났어요. 잠시 후 다시 시도해 주세요.", "code": "server_error"},
                                    status_code=500)
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

    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError):
        return JSONResponse({"detail": exc.detail, "code": exc.code, **exc.extra}, status_code=exc.status)

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

    def ensure_index(claims: dict) -> None:
        """커밋 뒤: 색인 대기 논문이 있으면 index 작업(사용자당 진행 중 하나 — 3단계 10.1절)을 만들어 실행기에 넣는다"""
        with db.user_tx(claims) as lib:
            job_id = rg.ensure_index_job(lib)
        if job_id:
            runner.enqueue(job_id, str(claims["sub"]))

    def pdf_changed(ctx: RequestCtx, pid: int, old_rag: str) -> bool:
        """PDF를 붙이거나 바꾼 커밋 뒤: 옛 벡터 파일 지우기 · 캐시에서 빼기 → 다시 색인 (8.4절).
        4단계 K-11: 같은 트랜잭션에서 전체 번역 행을 지우고(선택 기록은 남김) 대기 중 번역 작업은 취소 — 파일은 커밋 뒤.
        실행 중인 번역 작업은 다음 반영 때 행이 없어 cancelled(6.3절 9번).
        6단계 K-28: 전체 번역을 지웠으면 papers.translation_cleared_at을 적고 True(웹 안내 · 응답 translation_cleared)"""
        ctx.after_commit.append(lambda: rg.forget(ctx.uid, pid, old_rag))
        ctx.after_commit.append(lambda: ensure_index(ctx.claims))
        old_tr = translate.delete_row(ctx.lib, pid)
        ctx.lib._x("update paperlab.jobs set status = 'cancelled', error_code = 'pdf_changed', error = %s, lease_token = null, "
                   "lease_until = null, progress = '{}'::jsonb, finished_at = now(), updated_at = now() where user_id = %s "
                   "and paper_id = %s and kind = 'translate_paper' and status = 'queued'", (translate.PDF_CHANGED, ctx.uid, pid))
        if old_tr:
            ctx.lib._x("update paperlab.papers set translation_cleared_at = now() where id = %s and user_id = %s",
                       (pid, ctx.uid))
            ctx.after_commit.append(lambda: ctx.storage.delete_quietly(old_tr))
        return bool(old_tr)

    def extract_pdf(data: bytes) -> pdf.PdfInfo:
        """PDF 본문 추출만 감싼다 — 손상된 PDF는 BadPdf(문구 고정 · 예외 내용은 응답에 넣지 않음), DB · 저장소 오류는
        그대로 올라간다 (QA D5)"""
        try:
            return pdf.extract(data)
        except Exception as e:  # noqa: BLE001 - PyMuPDF가 내는 여러 예외
            raise BadPdf(type(e).__name__) from e

    def store_pdf(ctx: RequestCtx, pid: int, data: bytes) -> pdf.PdfInfo:
        """서버가 받은 PDF(URL에서 받기)를 임시 키를 거쳐 최종 키에 올리고 본문을 저장한다.
        추출 · R2 올리기 동안 DB 트랜잭션을 잡지 않는다(F9 — 6단계 앱 역할 idle_in_transaction 60초). 그 사이 지워졌으면 404.
        임시 키에 먼저 올리고(트랜잭션 밖), 논문 행을 잠근 트랜잭션 안에서 최종 키로 복사한다(attach_from_incoming — QA D9b)"""
        ctx.release()
        info = extract_pdf(data)
        incoming = ctx.storage.incoming_key(new_upload_id())
        ctx.storage.put(incoming, data)
        ctx.on_rollback.append(lambda: ctx.storage.delete_quietly(incoming))
        attach_from_incoming(ctx, pid, incoming, data, info)  # 파일 이름은 `{저자} {연도} - {제목}.pdf`(8.2절)
        return info

    def prepare_upload(ctx: RequestCtx, incoming: str, raw: bytes, name: str) -> tuple[str, bytes, pdf.PdfInfo, dict | None]:
        """올린 파일 → (PDF 임시 키, PDF 내용, 본문, 원본). PDF는 그대로. 워드 · 한글 · PPT · 이미지는 PDF 변환본을 새 임시 키에
        올리고, 원본은 {"incoming", "name", "size", "sha256"}로 넘긴다(attach_from_incoming이 sources/로 복사).
        이름이 받는 문서 · 사진 확장자(.docx 등)인데 내용이 PDF면 원본으로 보관한다 — PC에는 원본이 똑같은 바이트로 내려간다
        (선택 동기화 5.5절 · D-8). .pdf · 확장자 없음 · 모르는 확장자(x.download 등)의 PDF 내용은 그냥 PDF(두 번 저장하지 않음).
        변환 동안 DB 연결을 잡지 않게 ctx.release() 뒤에 부른다. 실패하면 BadPdf · convert.ConvertError"""
        ext = convert.ext_of(name)
        if raw.startswith(b"%PDF") and (ext == ".pdf" or ext not in convert.ACCEPT_EXTS):
            return incoming, raw, extract_pdf(raw), None
        data = convert.to_pdf(raw, name)
        info = extract_pdf(data)
        if convert.kind(raw, name) == "image" and info.warnings:  # "텍스트가 없는 PDF예요(스캔본…)" 대신 사진에 맞게
            info.warnings = [IMAGE_NO_TEXT if "텍스트가 없는" in w else w for w in info.warnings]
        pdf_incoming = ctx.storage.incoming_key(new_upload_id())
        ctx.storage.put(pdf_incoming, data)
        for k in (incoming, pdf_incoming):  # 붙이든(attach) 중복이라 버리든 임시 파일 둘 다 지운다
            ctx.on_rollback.append(lambda k=k: ctx.storage.delete_quietly(k))
            ctx.after_commit.append(lambda k=k: ctx.storage.delete_quietly(k))
        source_name = re.sub(r"[\x00-\x1f\x7f-\x9f/\\]", "_", re.split(r"[/\\]", name)[-1]).strip()[:255]
        return pdf_incoming, data, info, {"incoming": incoming, "name": source_name, "size": len(raw),
                                          "sha256": hashlib.sha256(raw).hexdigest()}

    def attach_from_incoming(ctx: RequestCtx, pid: int, incoming: str, data: bytes, info: pdf.PdfInfo, *,
                             name: str = "", device_id: int | None = None, content_at=None,
                             source: dict | None = None) -> bool:
        """임시 파일을 최종 키로 복사하고 DB에 기록. 임시 파일은 커밋 뒤에 지운다. → 전체 번역을 지웠는지(K-28).
        name: 올린 파일 이름(PC 파일 이름이 비었을 때만 씀 — 원래 이름 · 확장자 그대로, 선택 동기화 D-8),
        device_id · content_at: 동기화 올리기(10.1절).
        source: 문서 원본(prepare_upload) — sources/로 복사해 [원본 받기] · PC 표현. 없으면(PDF를 붙임 — 웹이든 PC의 .pdf
        파일이든) 옛 원본을 지운다(선택 동기화 7.3절: PC에서 온 내용은 언제나 PC 표현대로). PC 파일 이름의 확장자는 표현에 맞춘다.
        로컬 항목(PC에만 둔 파일): 보관 PC가 활성이면 409 local_only, 해지됐거나 없어졌으면 붙이면서 켬(storage = 'cloud',
        sync_mode = 'cloud' 명시 — 7.2절).
        논문 행을 **먼저** 잠그고(없거나 휴지통이면 404 — RLS가 숨김) R2에 복사한다: 그 사이 휴지통으로 간 논문의 PDF를
        덮어쓰지 않게(QA D2 — 휴지통 보내기도 같은 행을 for update로 잠금). 휴지통 논문을 되살리는 동기화는 trash_tx 안에서 부름"""
        row = ctx.lib._one("select pdf_key, storage, source_key, source_sha256 from paperlab.papers "
                           "where id = %s and user_id = %s for update", (pid, ctx.uid))
        if not row:
            raise HTTPException(404, "논문을 찾을 수 없어요")
        if row["storage"] == "local":
            loc = ctx.lib.local_info(pid) or {}
            if not loc.get("holder_gone"):
                raise ApiError(409, "local_only", local_only_detail(loc.get("holder_name") or "", False, change=True),
                               holder_device_id=loc.get("local_device_id"), holder_name=loc.get("holder_name") or "")
            ctx.lib.promote_to_cloud(pid, explicit=True)  # 해지된 PC에만 있던 파일을 다시 올림 → 켬
        key = ctx.storage.paper_key(pid)
        ctx.after_commit.append(lambda: ctx.storage.delete_quietly(incoming))  # 복사가 실패하고 커밋돼도 지우게 먼저
        ctx.storage.storage.copy(ctx.storage.check(incoming), ctx.storage.check(key))
        if not row["pdf_key"]:  # PDF가 없던 논문(새 논문 포함): 롤백되면 DB가 가리키지 않는 파일이 남음 (QA D8)
            ctx.on_rollback.append(lambda: ctx.storage.delete_quietly(key))
        cleared = pdf_changed(ctx, pid, ctx.lib.set_pdf(pid, key, info.page_texts, hashlib.sha256(data).hexdigest(),
                                                        len(data), device_id, content_at))
        if source:  # PC 파일 = 원본(원래 이름 · 확장자 그대로), 해시 = 원본 해시 (선택 동기화 D-8 · 5.5절)
            skey = ctx.storage.source_key(pid)
            ctx.storage.storage.copy(ctx.storage.check(source["incoming"]), ctx.storage.check(skey))
            ctx.on_rollback.append(lambda: ctx.storage.delete_quietly(skey))
            old_source = ctx.lib.set_source(pid, skey, source["name"], source["size"], source.get("sha256") or "")
        elif device_id is not None and row["source_key"] and not row["source_sha256"]:
            # 원본 해시를 모르는 옛 문서 행(sync-originals 전): PC의 .pdf는 원본이 아니라 변환본이다 → 변환본만 바꾸고
            # 원본(.docx 등)은 그대로 둔다(옛 동작 — 원본을 가진 곳이 서버뿐이라 지우면 잃음).
            # 표시: 위 set_pdf가 content_device_id = 이 PC로 적는다(해시 없는 원본을 PDF와 함께 적은 길은 옛 웹 업로드뿐 — null).
            # admin sync-originals는 이 표시가 있는 행의 원본을 PC 표현으로 되돌리지 않고 떼어 낸다(PC가 고친 PDF가 최신)
            old_source = None
        else:  # PDF를 붙이거나 바꿈(웹 · PC의 .pdf 파일) → 옛 원본은 이제 이 PDF와 다르므로 지운다
            old_source = ctx.lib.set_source(pid)
        if old_source:
            ctx.after_commit.append(lambda: ctx.storage.delete_quietly(old_source))
        ctx.lib.ensure_file_name(pid, name)  # 이름이 없으면 정하고, 있으면 확장자를 PC 표현에 맞춘다
        return cleared

    def trash_papers(ctx: RequestCtx, ids: list[int], by: str = "web") -> int:
        """휴지통으로 (6단계 11장 — 웹 [삭제] · 여러 개 삭제 · 기기 file.delete). 저장소 파일은 그대로, 커밋 뒤 캐시에서만 뺀다"""
        for pid in ids:
            info = ctx.lib.pdf_info(pid)
            if info and info["pdf_key"]:
                ctx.storage.check(info["pdf_key"])  # 남의 경로면 StorageKeyError → 404 (지금 삭제와 같은 검사)
        moved = ctx.lib.trash_papers(ids, by)
        for m in moved:
            ctx.after_commit.append(lambda p=m["id"]: rg.forget(ctx.uid, p, ""))
        if moved:
            log.info(f"papers trashed n={len(moved)} by={by.split(':')[0]}")
        return len(moved)

    def purge_papers(ctx: RequestCtx, ids: list[int]) -> int:
        """영구 삭제(휴지통 논문만): 행 삭제(하위 표 연쇄 · 묘비 트리거) → 커밋 뒤 R2 PDF · 벡터 · 번역 파일 삭제 · 캐시에서 빼기"""
        n = 0
        for pid in ids:
            gone = ctx.lib.purge_paper(pid)
            if not gone:
                continue
            n += 1
            for k in (gone["pdf_key"], gone["source_key"], gone["tr_key"]):
                if k:
                    ctx.storage.check(k)
                    ctx.after_commit.append(lambda k=k: ctx.storage.delete_quietly(k))
            ctx.after_commit.append(lambda p=pid, k=gone["rag_key"]: rg.forget(ctx.uid, p, k))
        if n:
            log.info(f"papers purged n={n}")
        return n

    def demote_paper(ctx: RequestCtx, pid: int) -> None:
        """끄기 실행(선택 동기화 7.1절 — mode.ack가 부름, 한 트랜잭션): 행 잠금 → storage = 'local' · 키 · 본문 · 벡터 비움 ·
        번역 행 삭제 · 대기 중 번역 · 설명 · API 작업 취소. 정보 · 노트 · 하이라이트 · 태그 · 컬렉션 · AI 요약 · 대화 ·
        설명 기록은 그대로(D-12). 커밋 뒤: R2 PDF · 원본 · 번역 파일 삭제, 벡터 캐시에서 빼기"""
        old = ctx.lib.demote_to_local(pid)
        tr_key = translate.delete_row(ctx.lib, pid)
        for k in (old["pdf_key"], old["source_key"], tr_key):
            if k:
                ctx.storage.check(k)  # 남의 경로면 StorageKeyError — 트랜잭션째 실패
                ctx.after_commit.append(lambda k=k: ctx.storage.delete_quietly(k))
        ctx.after_commit.append(lambda: rg.forget(ctx.uid, pid, old["rag_key"]))
        log.info(f"paper demoted to local paper={pid}")

    def need_cloud_file(ctx: RequestCtx, pid: int, change: bool = False) -> None:
        """로컬 항목이면 409 local_only (7.2절): 열기(pdf-url · source-url)는 언제나, 바꾸기(change — pdf/upload ·
        pdf/complete · fetch-pdf)는 보관 PC가 활성일 때만(해지됐으면 붙이면서 켬 — attach_from_incoming)"""
        loc = ctx.lib.local_info(pid)
        if not loc:
            raise HTTPException(404, "논문을 찾을 수 없어요")
        if loc["storage"] == "local" and not (change and loc["holder_gone"]):
            raise ApiError(409, "local_only", local_only_detail(loc["holder_name"] or "", bool(loc["holder_gone"]), change),
                           holder_device_id=loc["local_device_id"], holder_name=loc["holder_name"] or "")

    def no_local_ai(ctx: RequestCtx, pid: int) -> None:
        """선택 설명 · 번역은 로컬 항목에서 쓸 수 없음 (D-13 — 409 local_only)"""
        loc = ctx.lib.local_info(pid)
        if loc and loc["storage"] == "local":
            raise ApiError(409, "local_only", jobs.LOCAL_ONLY_AI, holder_device_id=loc["local_device_id"],
                           holder_name=loc["holder_name"] or "")

    def dup_reply(dup: dict) -> dict:
        """중복 응답. 휴지통에 있는 논문이면 trashed: true + 안내(SW-8 — 화면이 [되살리기])"""
        if dup.get("trashed"):
            return {"duplicate": True, "trashed": True, "detail": TRASHED_DUP,
                    "paper": {"id": dup["id"], "title": dup["title"]}}
        return {"duplicate": True, "paper": dup}

    def mark_library(ctx: RequestCtx, items: list[dict]) -> list[dict]:
        for it in items:
            dup = ctx.lib.find_duplicate(it.get("doi", ""), it.get("arxiv_id", ""), it.get("title", ""))
            it["in_library"] = dup["id"] if dup else None
        return items

    def safe_doi(value) -> str:
        try:
            return check_doi(value) if value else ""
        except ValueError:
            return ""

    def oa_cached(ctx: RequestCtx, doi: str) -> list[dict] | None:
        """1B 공용 캐시의 그 DOI 작품 행으로 만든 무료 PDF 위치(oa_license가 null이면 None — 8.1절). 외부 호출 전에(DB 연결 안)"""
        return extsources.cache_locations(read_oa(ctx.lib.conn, doi)) if doi else None

    def open_reply(plan: dict) -> dict:
        return {"open_url": plan["open_url"], "open_kind": plan["open_kind"], "reason": "license_unknown"}

    def metadata_from_pdf(ctx: RequestCtx, info: pdf.PdfInfo, document: bool = False) -> tuple[dict, str]:
        """PDF에서 찾은 식별자로 메타데이터를 채운다. (메타데이터, 출처 설명).
        document: 워드 · 한글 · PPT · 이미지에서 바꾼 PDF — 논문이 아닐 수 있으므로(내가 쓰던 문서 등) DOI · arXiv가 있을 때만
        논문 정보를 찾고 제목 검색은 하지 않는다. 못 찾으면 유형 '문서', 제목은 파일 이름(부르는 쪽)"""
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
        if info.title and not document:
            match = sources.match_title(info.title)
            if match:
                return match, "제목 검색"
        # 논문 정보를 못 찾은 PDF도 유형은 '문서' — 내가 쓰던 원고 같은 것에 학술지 이름 · 권 · 쪽 경고를 띄우지 않는다.
        # 논문이면 사용자가 [정보 수정]에서 유형을 바꾼다 (2026-10-16 사용자 지적). 중복은 save_upload가 파일 해시로 본다
        meta = {"title": "" if document else info.title, "doi": info.doi, "arxiv_id": info.arxiv_id, "year": info.year,
                "authors": [], "item_type": "document"}
        if info.meta_author:
            from .sources import split_name
            meta["authors"] = [split_name(a) for a in re.split(r"\s*(?:;|,| and )\s*", info.meta_author) if a]
        return meta, DOC_ONLY if document else "PDF 정보만 사용"

    sys_sizes: dict = {}

    def system_sizes(ctx: RequestCtx) -> dict:
        """사용자 구분 없는 합계(system_tx 하나): PDF 합계(휴지통 포함 — R2에 있음) · DB 크기 · PGroonga 할당 여부.
        사용자 트랜잭션이 열려 있으면(ctx.lib 사용 중) SYSTEM_TTL초 안의 값을 그대로 쓰고 연결을 하나 더 잡지 않는다
        (QA D7 — 요청마다 연결 두 개를 잡으면 풀이 바닥날 때 서로 기다림). 트랜잭션이 없을 때는 늘 새로 잰다"""
        if sys_sizes and ctx._tx is not None and time.monotonic() - sys_sizes["at"] < SYSTEM_TTL:
            return sys_sizes
        with db.system_tx("storage usage") as conn:
            r = conn.execute("select (select coalesce(sum(coalesce(pdf_size, 0) + coalesce(source_size, 0)), 0) "
                             "from paperlab.papers where pdf_key <> '')::bigint as pdf, "
                             "pg_database_size(current_database())::bigint as size, "
                             "exists (select 1 from paperlab.page_texts) as allocated").fetchone()
        sys_sizes.update(at=time.monotonic(), pdf=int(r["pdf"]), size=int(r["size"]), allocated=bool(r["allocated"]))
        return sys_sizes

    def storage_used(ctx: RequestCtx) -> int:
        return system_sizes(ctx)["pdf"] + st.backup_sizes.get() + st.figure_sizes.get()

    def usage(ctx: RequestCtx) -> dict:
        used = storage_used(ctx)
        limit = int(config.storage_limit_bytes)
        frac = used / limit if limit else 1.0
        level = "full" if frac >= FULL_LEVEL else "warn" if frac >= WARN_LEVEL else "ok"
        return {"backend": ctx.storage.backend, "used_bytes": used, "limit_bytes": limit,
                "mine_bytes": int(ctx.lib.mine_pdf_bytes()), "trash_bytes": int(ctx.lib.trash_bytes()), "level": level,
                "local_bytes": int(ctx.lib.local_bytes())}  # PC에만 둔 파일 크기(참고 — 합계에는 안 들어감)

    def sync_budget(ctx: RequestCtx) -> dict:
        """6단계 K-30 동기화 올리기 예산 = max(0, min(R2 한도 95% − 서버 측 합계, 사용자 상한 − 내 PDF 총량(휴지통 포함)))"""
        storage_left = int(config.storage_limit_bytes * FULL_LEVEL) - storage_used(ctx)
        trash = int(ctx.lib.trash_bytes())
        cap = int(config.sync_user_cap_bytes)
        user_left = cap - int(ctx.lib.mine_pdf_bytes()) - trash
        return {"upload_budget_bytes": max(0, min(storage_left, user_left)),
                "upload_budget_limit": "storage" if storage_left <= user_left else "user",
                "user_cap_bytes": cap, "trash_bytes": trash, "storage_left": storage_left, "user_left": user_left}

    def db_budget(ctx: RequestCtx) -> dict:
        """6단계 K-46 DB 예산(snapshot 첫 쪽 db · files/add db_full). 크기는 system_sizes(트랜잭션 안이면 짧은 캐시)"""
        sizes = system_sizes(ctx)
        limit = int(config.db_limit_bytes)
        size = sizes["size"]
        first = 0 if sizes["allocated"] else DB_FIRST_ALLOC
        return {"size_bytes": size, "limit_bytes": limit, "per_paper_bytes": DB_PER_PAPER,
                "per_local_bytes": DB_PER_LOCAL,  # 선택 동기화: 로컬 항목은 본문 · 색인이 없어 편당 수 KB (6장)
                "first_alloc_bytes": DB_FIRST_ALLOC, "budget_bytes": max(0, int(limit * DB_LEVEL) - size - first)}

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
            # 6단계 K-10: 휴지통 30일 정리(한 번에 200편 — 사용자 권한, service role 없음) · 묘비 180일 · 멱등 기록 7일
            purge_papers(ctx, ctx.lib.trashed_ids(older_than_days=TRASH_DAYS, limit=200))
            ctx.lib._x("delete from paperlab.sync_tombstones where user_id = %s and created_at < now() - "
                       "make_interval(days => %s)", (ctx.uid, TOMBSTONE_DAYS))
            ctx.lib._x("delete from paperlab.sync_ops where user_id = %s and created_at < now() - make_interval(days => %s)",
                       (ctx.uid, SYNC_OPS_DAYS))
            ctx.after_commit.append(lambda: ensure_index(ctx.claims))  # 3단계 10.1절 — 놓친 색인을 이어서

    def route_for(ctx: RequestCtx, kind: str, paper_id: int | None = None) -> list[dict]:
        return job_route(ctx, kind, paper_id)[0]

    def job_route(ctx: RequestCtx, kind: str, paper_id: int | None = None) -> tuple[list[dict], int | None]:
        """(경로, 고정 기기). 로컬 항목(PC에만 둔 파일 — 선택 동기화 7.4절)이면 보관 PC 한 대의 CLI 칸만 · 그 PC에 고정:
        요약 · 논문 대화만(그 밖은 409 local_only), 보관 PC가 읽지 못하는 형식은 작업을 만들기 전에 400 local_unsupported,
        보관 PC가 해지됐거나 CLI가 없으면 400 no_route_local. 서버 API 키 · 다른 PC는 쓰지 않는다(P-6)"""
        loc = ctx.lib.local_info(paper_id) if paper_id is not None else None
        if not loc or loc["storage"] != "local":
            route = jobs.build_route(kind, ctx.settings.get, jobs.device_rows(ctx.lib))
            if not route:
                raise jobs.JobError(400, guide(), "no_route")
            return route, None
        if kind not in jobs.LOCAL_AI_KINDS:
            raise ApiError(409, "local_only", jobs.LOCAL_ONLY_AI, holder_device_id=loc["local_device_id"],
                           holder_name=loc["holder_name"] or "")
        if db_local_ai_state(loc) != "ok":
            raise jobs.JobError(400, jobs.local_unsupported_message(loc["file_name"] or ""), "local_unsupported")
        holder = [d for d in jobs.device_rows(ctx.lib) if d["id"] == loc["local_device_id"] and d["revoked_at"] is None]
        route = jobs.build_route(kind, ctx.settings.get, holder, cli_only=True) if holder else []
        if not route:
            raise jobs.JobError(400, jobs.no_route_local_message(loc["holder_name"] or "", not holder), "no_route_local")
        return route, loc["local_device_id"]

    def new_job(ctx: RequestCtx, kind: str, params: dict, paper_id: int | None) -> tuple[dict, bool]:
        route, pinned = job_route(ctx, kind, paper_id)
        row, created = jobs.create_job(ctx.lib, kind, route, params, paper_id, pinned_device_id=pinned)
        if created:
            log.info(f"job created job={row['id']} kind={kind} runner={row['runner']} engine={row['engine']}")
            if row["runner"] == "api":
                job_id, uid = row["id"], ctx.uid
                ctx.after_commit.append(lambda: runner.enqueue(job_id, uid))
        return jobs.get_job(ctx.lib, row["id"], ws.free), created

    @app.get("/api/jobs")
    def list_jobs(status: str = "active", paper_id: int | None = None, kind: str = "", limit: int = 50,
                  since: str = "", manuscript_id: int | None = None, ctx: RequestCtx = Ctx):
        maintain(ctx)
        return jobs.list_jobs(ctx.lib, ws.free, status, paper_id, kind, limit, since, manuscript_id)

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: int, ctx: RequestCtx = Ctx):
        maintain(ctx)
        return jobs.get_job(ctx.lib, job_id, ws.free)

    @app.post("/api/jobs/{job_id}/cancel")
    def cancel_job(job_id: int, ctx: RequestCtx = Ctx):
        out = jobs.cancel_job(ctx.lib, job_id)
        log.info(f"job cancel job={job_id} status={out['status']}")
        return out

    @app.post("/api/jobs/{job_id}/handled")
    def job_handled(job_id: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        """글쓰기 결과를 원고에 넣었음 · 넣지 않기로 함 (2026-10-16 백그라운드 AI — 원고 화면 'AI 결과' 줄에서 뺌)"""
        return jobs.mark_write_handled(ctx.lib, job_id, str(data.get("state") or ""))

    @app.post("/api/jobs/{job_id}/retry")
    def retry_job(job_id: int, ctx: RequestCtx = Ctx):
        src = jobs.retry_source(ctx.lib, job_id)
        if src["paper_id"] is not None:
            need_paper(ctx, src["paper_id"])  # 6단계 K-39: 휴지통 논문 작업은 다시 시도하지 않음(404)
        if src["kind"] == "index":  # 색인은 엔진 경로가 없음 — 대기 논문이 있으면 새 색인 작업 (3단계 10.1절)
            new_id = rg.ensure_index_job(ctx.lib)
            if new_id:
                ctx.after_commit.append(lambda: runner.enqueue(new_id, ctx.uid))
            r = jobs.latest_job(ctx.lib, ws.free, " and j.kind = 'index'")
            return JSONResponse({"job": r}, status_code=202 if new_id else 200)
        if src["kind"] == "translate_paper":  # 전체 번역은 끝난 쪽을 두고 남은 쪽부터 (4단계 6.3절 2번)
            need_paper(ctx, src["paper_id"])
            return tr_continue(ctx, src["paper_id"], "pending", False)
        view, created = new_job(ctx, src["kind"], src["params"] or {}, src["paper_id"])
        return JSONResponse({"job": view}, status_code=202 if created else 200)

    # ------------------------------------------------------------- 연결된 PC (2단계 7.2절)
    @app.get("/api/devices")
    def list_devices(ctx: RequestCtx = Ctx):
        maintain(ctx)
        return [jobs.device_view(d) for d in jobs.device_rows(ctx.lib)]

    # ------------------------------------------------------------- 휴지통 (6단계 11장 · 14.2절)
    def trash_ids(data: dict) -> list[int]:
        ids = data.get("ids")
        if not isinstance(ids, list) or not 1 <= len(ids) <= 200 or not all(jobs.valid_id(i) for i in ids):
            raise HTTPException(400, "ids는 논문 번호 1~200개예요")
        return ids

    @app.get("/api/trash")
    def trash_list(ctx: RequestCtx = Ctx):
        maintain(ctx)
        items = ctx.lib.list_trash()
        return {"items": items, "total_bytes": sum(i["pdf_size"] or 0 for i in items)}

    @app.post("/api/trash/restore")
    def trash_restore(data: dict = Body(...), ctx: RequestCtx = Ctx):
        ids = trash_ids(data)
        out = ctx.retry_names(lambda: ctx.lib.restore_papers(ids))  # 이름 겹침 경합은 한 번 더 → 409 (QA D3)
        if out["restored"]:
            ctx.after_commit.append(lambda: ensure_index(ctx.claims))
        return {"restored": out["restored"], "renamed": out["renamed"], "to_root": out["to_root"]}

    @app.post("/api/trash/purge")
    def trash_purge(data: dict = Body(...), ctx: RequestCtx = Ctx):
        return {"purged": purge_papers(ctx, ctx.lib.trashed_ids(trash_ids(data)))}

    @app.post("/api/trash/empty")
    def trash_empty(ctx: RequestCtx = Ctx):
        return {"purged": purge_papers(ctx, ctx.lib.trashed_ids())}

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
        # 선택 동기화: 이 해지로 보관 PC가 없어진 PC에만 둔 파일 수(정보 · 노트는 남음 — 10.5절 해지 확인 문구)
        orphaned = ctx.lib._one("select count(*)::int as n from paperlab.papers where user_id = %s and storage = 'local' "
                                "and local_device_id = %s", (ctx.uid, device_id))["n"]
        log.info(f"device revoked device_id={device_id} requeued={n} local_orphaned={orphaned}")
        return {"ok": True, "requeued_jobs": n, "local_orphaned": orphaned}

    # ------------------------------------------------------------- 선택 동기화 켜고 끄기 (selective-sync.md 7.2절)
    def sync_holder(ctx: RequestCtx, plan: dict, want) -> dict | None:
        """끄기에 쓸 보관 PC: 고른 PC가 있으면 그것(자격 없으면 400), 끄기 대상이 있으면 하나뿐일 때 자동 · 없으면
        no_sync_pc · 여럿이면 holder_required. 끄기 대상이 없으면 None.
        끄는 중인데 고른 보관 PC가 이제 자격이 없는 항목(해지 · 동기화 끔 — 12장 [다른 PC 고르기])도 끄기 대상으로 본다:
        PC를 고르지 않으면 그대로 두는 대신 holder_required · no_sync_pc로 고르게 한다"""
        eligible = ctx.lib.holders()
        ok_ids = {h["id"] for h in eligible}
        need = any(it["action"] == "to_local" or (it["action"] == "holder" and it["cur_holder"] not in ok_ids)
                   for it in plan["items"])
        if want is not None:
            if not jobs.valid_id(want):
                raise ApiError(400, "holder_not_eligible", HOLDER_NOT_ELIGIBLE)
            found = next((h for h in eligible if h["id"] == want), None)
            if not found:
                raise ApiError(400, "holder_not_eligible", HOLDER_NOT_ELIGIBLE)
            return found
        if not need:
            return None
        if not eligible:
            raise ApiError(400, "no_sync_pc", NO_SYNC_PC)
        if len(eligible) > 1:
            raise ApiError(400, "holder_required", HOLDER_REQUIRED,
                           choices=[{"id": h["id"], "name": h["name"], "online": bool(h["online"])} for h in eligible])
        return eligible[0]

    def sync_mode_reply(ctx: RequestCtx, plan: dict, holder: dict | None, dry_run: bool) -> dict:
        items = plan["items"]
        hid = holder["id"] if holder else None
        count = {a: 0 for a in ("to_local", "to_cloud", "cancelled", "unchanged", "no_file")}
        freed = 0
        for it in items:
            a = it["action"]
            if a == "holder":  # 끄는 중인 것: 다른 PC를 골랐으면 보관 PC를 바꿈(to_local), 아니면 그대로
                a = "to_local" if hid is not None and it["cur_holder"] != hid else "unchanged"
            elif a == "cancel":
                a = "cancelled"
            count[a] += 1
            if it["action"] == "to_local":
                freed += it["bytes"]
        moving = count["to_local"]
        other = []
        if moving:  # 끄면 사본이 Windows 휴지통으로 갈 다른 PC (동기화를 켠 해지 안 된 PC — D-4)
            other = [{"id": r["id"], "name": r["name"], "files": moving} for r in ctx.lib._all(
                "select d.id, d.name from paperlab.devices d join paperlab.sync_devices s on s.device_id = d.id "
                "and s.user_id = d.user_id where d.user_id = %s and d.revoked_at is null and s.enabled "
                "and d.id is distinct from %s order by d.id", (ctx.uid, hid))]
        return {"dry_run": dry_run, **count, "freed_bytes": freed,
                "holder": {"id": holder["id"], "name": holder["name"]} if holder else None,
                "other_pcs": other, "blocked": plan["blocked"], "overrides": plan["overrides"]}

    def sync_mode_change(ctx: RequestCtx, data: dict, ids=None, folder=None) -> dict:
        mode = data.get("mode")
        if not isinstance(mode, str) or mode not in SYNC_MODES:
            raise ApiError(400, "bad_mode", "mode는 cloud · local · inherit 중 하나예요")
        dry_run = data.get("dry_run") is True
        plan = ctx.lib.sync_mode_plan(mode, ids=ids, folder=folder, reset_children=data.get("reset_children") is True)
        holder = sync_holder(ctx, plan, data.get("holder_device_id"))
        out = sync_mode_reply(ctx, plan, holder, dry_run)
        if not dry_run:  # 대기만 쓴다 — R2 · 본문 삭제는 보관 PC의 mode.ack 때 (5.3절)
            ctx.lib.apply_sync_mode(plan, mode, ids=ids, folder=folder, holder=holder["id"] if holder else None)
            log.info(f"sync mode set target={'folder' if folder is not None else 'papers'} mode={mode} "
                     f"to_local={out['to_local']} to_cloud={out['to_cloud']} cancelled={out['cancelled']}")
        return out

    @app.post("/api/papers/sync-mode")
    def papers_sync_mode(data: dict = Body(...), ctx: RequestCtx = Ctx):
        ids = data.get("ids")
        if not isinstance(ids, list) or not 1 <= len(ids) <= 200 or not all(jobs.valid_id(i) for i in ids):
            raise ApiError(400, "bad_request", "ids는 논문 번호 1~200개예요")
        return sync_mode_change(ctx, data, ids=ids)

    @app.post("/api/folders/{fid}/sync-mode")
    def folder_sync_mode(fid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        if not jobs.valid_id(fid) or not ctx.lib.has_folder(fid):
            raise HTTPException(404, "폴더를 찾을 수 없어요")
        return sync_mode_change(ctx, data, folder=fid)

    @app.get("/api/sync/holders")
    def sync_holders(ctx: RequestCtx = Ctx):
        return {"holders": [{"id": h["id"], "name": h["name"], "online": bool(h["online"]),
                             "last_seen_at": iso(h["last_seen_at"]), "this_device": False}
                            for h in ctx.lib.holders()]}

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
            dup = lib.find_duplicate(data.get("doi", ""), data.get("arxiv_id", ""), data.get("title", ""), include_trash=True)
            if dup:
                return JSONResponse(dup_reply(dup), status_code=409)
        cid = own_collection(ctx, data.get("collection_id"))
        fid = own_folder(ctx, data.get("folder_id"))
        pid = lib.add_paper(data)
        if cid:
            lib.set_paper_collections([pid], cid, True)
        if fid:
            lib.move_papers_to_folder([pid], fid)
        if data.get("tags"):
            lib.set_paper_tags(pid, data["tags"])
        warning, extra = "", {}
        if data.get("download_pdf") and isinstance(data.get("pdf_url"), str) and data["pdf_url"].strip():
            # 5단계 K-11 보강(팀장 결정 1): 보낸 pdf_url을 그대로 받지 않고 서버가 8.3절 판정을 다시 함
            doi = safe_doi(data.get("doi"))
            cached = oa_cached(ctx, doi)
            sources = ctx.sources
            ctx.release()  # 논문을 먼저 커밋하고, PDF를 받는 동안 DB 연결을 잡지 않는다 (F9)
            try:
                arxiv_id = data.get("arxiv_id") if isinstance(data.get("arxiv_id"), str) else ""
                plan = extsources.plan_pdf(sources, data["pdf_url"], arxiv_id.strip(), doi, cached)
                if plan is None:  # http(s) 아닌 주소 · 위치 없음
                    raise SourceError("무료 PDF를 찾지 못했어요")
                if "open_url" in plan:
                    extra = open_reply(plan)
                    raise SourceError("라이선스를 확인하지 못해 PaperLab이 대신 받지 않았어요. 상세 패널의 "
                                      "[무료 PDF 찾기]로 직접 받은 뒤 [PDF 첨부]로 올려 주세요.")
                raw = sources.download_pdf(plan["fetch"])
                store_pdf(ctx, pid, raw)  # 그 사이 지워졌으면 404
                if plan.get("via"):  # 대신 받음 — 실제로 받은 주소 · 라이선스 (사용자 결정 2026-10-13)
                    ctx.lib.update_paper(pid, {"pdf_url": plan["fetch"]})
                    extra = {"via": plan["via"], "license": plan["license"]}
            except SourceError as e:
                warning = f"논문은 추가했지만 PDF는 받지 못했어요: {e}"
            except BadPdf:
                warning = "논문은 추가했지만 PDF는 저장하지 못했어요: PDF를 열 수 없어요"
            except StorageError:
                # 저장소 오류는 DB 문보다 앞(복사 · 올리기 실패)이라 트랜잭션은 멀쩡. DB 오류는 잡지 않고 올린다 —
                # 깨진 트랜잭션에서 get_paper를 부르지 않게 (QA D5)
                warning = "논문은 추가했지만 PDF는 저장하지 못했어요: 저장소 오류"
        return {"paper": ctx.lib.get_paper(pid), "warning": warning, **extra}

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

    def read_incoming(ctx: RequestCtx, upload_id: str, name: str = "") -> tuple[str, bytes | None, str]:
        """(임시 키, 내용, 오류). 내 incoming/ 경로에 없으면 404.
        name: 웹에서 올린 파일 이름 — 주면 워드 · 한글 · PPT · 이미지도 받는다(convert.kind). 없으면(동기화) PDF만"""
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
        if not data.startswith(b"%PDF") and not (name and convert.kind(data, name)):
            ctx.storage.delete_quietly(key)
            pdf_named = convert.ext_of(name) in (".pdf", "")  # 이름이 .pdf(또는 없음 — 동기화)면 예전 문구 그대로
            return key, None, "PDF 파일이 아니에요" if pdf_named else convert.NOT_SUPPORTED
        ctx.on_rollback.append(lambda: ctx.storage.delete_quietly(key))  # 요청이 실패로 끝나면 임시 파일도 (QA D8 · D9b)
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
        incoming, raw, error = read_incoming(ctx, upload_id, name)
        if error:
            return {"file": name, "error": error}
        try:
            incoming, raw, info, source = prepare_upload(ctx, incoming, raw, name)
        except BadPdf:
            ctx.storage.delete_quietly(incoming)
            return {"file": name, "error": BAD_PDF}
        except convert.ConvertError as e:
            ctx.storage.delete_quietly(incoming)
            return {"file": name, "error": str(e)}
        if lookup:
            meta_, matched_by = metadata_from_pdf(ctx, info, document=bool(source))
        elif source:
            meta_, matched_by = {"title": "", "doi": info.doi, "arxiv_id": info.arxiv_id, "item_type": "document"}, DOC_ONLY
        else:
            meta_, matched_by = {"title": info.title, "doi": info.doi, "arxiv_id": info.arxiv_id}, "PDF 정보만 사용"
        if not meta_.get("title"):  # 파일 이름에서 아는 확장자만 뗀다("보고서 v1.2.docx" → "보고서 v1.2")
            stem, ext = os.path.splitext(name)
            meta_["title"] = (stem if ext.lower() in convert.ACCEPT_EXTS else name).strip() or name
        lib = ctx.lib  # 새 트랜잭션: 그 사이 컬렉션 · 폴더가 지워졌으면 넣지 않는다
        if collection_id and not lib.has_collection(collection_id):
            collection_id = None
        if folder_id and not lib.has_folder(folder_id):
            folder_id = None
        # PC 파일 이름 겹침 경합(23505)은 저장점에서 한 번 더, 그래도 겹치면 409 (QA D3)
        out = ctx.retry_names(lambda: save_upload(ctx, name, incoming, raw, info, meta_, matched_by, collection_id,
                                                  folder_id, source))
        if folder_id and lib.folder_effective(folder_id) == "local":
            # 선택 동기화 5.4절: 웹 업로드는 언제나 서버에 저장 — 'PC에만' 폴더면 화면이 토스트로 알림 · [PC에만 두기…]
            out["note_local_folder"] = True
        return out

    def save_upload(ctx: RequestCtx, name: str, incoming: str, raw: bytes, info, meta_: dict, matched_by: str,
                    collection_id: int | None, folder_id: int | None, source: dict | None = None) -> dict:
        lib = ctx.lib
        # 문서(제목 = 파일 이름)는 제목으로 같은 항목을 찾지 않는다 — "초안.docx"가 둘이어도 다른 문서 (DOI · arXiv만)
        dup_title = "" if meta_.get("item_type") == "document" else meta_.get("title", "")
        # 같은 파일(해시)도 중복 — 정보를 못 찾아 '문서'가 된 PDF를 두 번 올려도 하나만 남게. 문서 · 이미지는 변환본이 아니라
        # 원본 해시로 본다(변환할 때마다 바이트가 다름 — 원본 해시는 PC 표현 해시, 선택 동기화 5.5절 · PC에만 둔 파일도 짝지어짐)
        sha = source["sha256"] if source else hashlib.sha256(raw).hexdigest()
        dup = lib.find_duplicate(meta_.get("doi", ""), meta_.get("arxiv_id", ""), dup_title, include_trash=True,
                                 sha256=sha)
        if dup and dup.get("trashed"):  # 6단계 K-40: 휴지통에 같은 논문 — 새로 만들지 않고 [되살리기] 안내 (SW-8)
            ctx.after_commit.append(lambda: ctx.storage.delete_quietly(incoming))
            return {"file": name, "id": dup["id"], "title": dup["title"], "duplicate": True, "trashed": True,
                    "note": TRASHED_DUP}
        if dup:
            if not dup["has_pdf"] and dup["sync"]["storage"] == "cloud":  # PC에만 둔 항목에는 붙이지 않음(D-3 — 중복으로)
                attach_from_incoming(ctx, dup["id"], incoming, raw, info, name=name, source=source)
                result = {"file": name, "id": dup["id"], "title": dup["title"], "matched_by": matched_by,
                          "note": "이미 있는 항목에 파일을 붙였어요"}
            else:
                ctx.after_commit.append(lambda: ctx.storage.delete_quietly(incoming))
                result = {"file": name, "id": dup["id"], "title": dup["title"], "duplicate": True,
                          "note": "이미 서재에 있어요"}
            if collection_id:
                lib.set_paper_collections([dup["id"]], collection_id, True)
            return result
        pid = lib.add_paper(meta_)
        if folder_id:
            lib.move_papers_to_folder([pid], folder_id)
        attach_from_incoming(ctx, pid, incoming, raw, info, name=name, source=source)
        if collection_id:
            lib.set_paper_collections([pid], collection_id, True)
        return {"file": name, "id": pid, "title": meta_["title"], "matched_by": matched_by, "warnings": info.warnings}

    @app.get("/api/papers/{pid}")
    def get_paper(pid: int, ctx: RequestCtx = Ctx):
        p = need_paper(ctx, pid)
        p["cite_issues"] = citations.citation_issues(p)
        return p

    @app.patch("/api/papers/{pid}")
    def patch_paper(pid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        if "status" in data and not (isinstance(data["status"], str) and data["status"] in STATUSES):
            raise HTTPException(400, "읽기 상태가 올바르지 않아요")
        need_paper(ctx, pid)
        if "folder_id" in data:
            ctx.lib.move_papers_to_folder([pid], own_folder(ctx, data["folder_id"]))
        ctx.lib.update_paper(pid, data)
        if "tags" in data:
            ctx.lib.set_paper_tags(pid, data["tags"] or [])
        return ctx.lib.get_paper(pid)

    @app.delete("/api/papers/{pid}")
    def delete_paper(pid: int, ctx: RequestCtx = Ctx):
        """6단계 U-2: 웹 [삭제]는 휴지통으로(30일 — 영구 삭제는 /api/trash/purge · 30일 정리). 응답 모양 그대로"""
        if not trash_papers(ctx, [pid]):
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
            trash_papers(ctx, ids)
        elif action in ("add_collection", "remove_collection"):
            if not str(value or "").isdigit():
                raise HTTPException(400, "컬렉션을 골라 주세요")
            if not lib.has_collection(int(value)):
                raise HTTPException(400, "컬렉션을 찾을 수 없어요")
            lib.set_paper_collections(ids, int(value), action == "add_collection")
        elif action == "move_folder":
            folder = own_folder(ctx, value)
            ctx.retry_names(lambda: lib.move_papers_to_folder(ids, folder))  # 이름 겹침 경합 (QA D3)
        elif action == "add_tag":
            if not str(value or "").strip():
                raise HTTPException(400, "태그 이름이 필요해요")
            lib.add_tag_to_papers(ids, str(value))
        elif action == "status":
            if not (isinstance(value, str) and value in STATUSES):  # 리스트 · dict는 TypeError(500) 대신 400
                raise HTTPException(400, "읽기 상태가 올바르지 않아요")
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
        need_cloud_file(ctx, pid)  # PC에만 둔 파일은 409 local_only (선택 동기화 7.2절)
        if not info["pdf_key"]:
            raise HTTPException(404, "PDF가 없어요")
        signed = ctx.storage.sign_get(info["pdf_key"], filename=info["title"])
        return {"url": signed["url"], "expires_at": signed["expires_at"]}

    @app.get("/api/papers/{pid}/source-url")
    def source_url(pid: int, ctx: RequestCtx = Ctx):
        """문서 원본(워드 · 한글 · PPT · 이미지) 내려받기 주소 — 올린 이름 그대로(attachment)"""
        row = ctx.lib._one("select source_key, source_name from paperlab.papers where id = %s and user_id = %s",
                           (pid, ctx.uid))
        if not row:
            raise HTTPException(404, "논문을 찾을 수 없어요")
        need_cloud_file(ctx, pid)  # PC에만 둔 파일은 409 local_only (선택 동기화 7.2절)
        if not row["source_key"]:
            raise HTTPException(404, "원본 파일이 없어요")
        signed = ctx.storage.sign_get(row["source_key"], filename=row["source_name"] or "document")
        return {"url": signed["url"], "expires_at": signed["expires_at"], "name": row["source_name"]}

    @app.post("/api/papers/{pid}/pdf/upload")
    def pdf_upload_slot(pid: int, ctx: RequestCtx = Ctx):
        system_sizes(ctx)  # 사용자 트랜잭션을 열기 전에 (QA D7)
        need_paper(ctx, pid)
        need_cloud_file(ctx, pid, change=True)  # 보관 PC가 활성인 로컬 항목은 409 (해지됐으면 붙이면서 켬)
        ensure_space(ctx)
        return upload_slot(ctx)

    @app.post("/api/papers/{pid}/pdf/complete")
    def pdf_complete(pid: int, data: dict = Body(...), ctx: RequestCtx = Ctx):
        need_paper(ctx, pid)
        try:
            need_cloud_file(ctx, pid, change=True)
        except ApiError:
            if is_upload_id(str(data.get("upload_id") or "")):  # 올린 임시 파일은 남기지 않는다
                ctx.storage.delete_quietly(ctx.storage.incoming_key(str(data["upload_id"])))
            raise
        ctx.release()  # R2 받기 · 추출 동안 DB 연결을 잡지 않는다 (F9)
        name = str(data.get("name") or "")[:255]
        incoming, raw, error = read_incoming(ctx, str(data.get("upload_id") or ""), name)
        if error:
            raise HTTPException(400, error)
        try:
            incoming, raw, info, source = prepare_upload(ctx, incoming, raw, name)
        except BadPdf:
            raise HTTPException(400, BAD_PDF) from None  # 임시 파일은 on_rollback이 지움
        except convert.ConvertError as e:
            raise HTTPException(400, str(e)) from None
        # 그 사이 지워졌거나 휴지통으로 갔으면 404 — attach가 행을 먼저 잠그고 확인한다 (QA D2)
        cleared = attach_from_incoming(ctx, pid, incoming, raw, info, name=name, source=source)
        # 6단계 K-34: 이 교체로 전체 번역을 지웠는지 (웹 토스트 "PDF가 바뀌어 번역을 지웠어요")
        return {"paper": ctx.lib.get_paper(pid), "warnings": info.warnings, "translation_cleared": cleared}

    @app.post("/api/papers/{pid}/fetch-pdf")
    def fetch_pdf(pid: int, ctx: RequestCtx = Ctx):
        """5단계 8.3절 순서: 서재 pdf_url(arXiv · OpenAlex 위치 라이선스 · 경계 ①) → arXiv 번호 → DOI(캐시 → OpenAlex) 판정.
        라이선스가 확인된 것만 서버가 받고(U-3), 그 밖은 새 탭 주소를 돌려준다(200). 클라이언트가 보낸 주소는 쓰지 않음(K-11)"""
        p = need_paper(ctx, pid)
        need_cloud_file(ctx, pid, change=True)  # 선택 동기화: 보관 PC가 활성인 로컬 항목은 409 local_only
        doi = safe_doi(p.get("doi"))
        cached = oa_cached(ctx, doi)
        sources = ctx.sources
        ctx.release()  # 외부 조회 · PDF 받기 동안 DB 연결을 잡지 않는다 (F9)
        try:
            plan = extsources.plan_pdf(sources, p.get("pdf_url") or "", p.get("arxiv_id") or "", doi, cached)
        except SourceError as e:
            raise HTTPException(502, "무료 PDF 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.") from e
        if not plan:
            raise HTTPException(404, "무료로 받을 수 있는 PDF를 찾지 못했어요. 직접 파일을 첨부해 주세요.")
        if "open_url" in plan:
            return open_reply(plan)
        url = plan["fetch"]
        try:
            data = sources.download_pdf(url)
        except SourceError as e:
            raise HTTPException(502, str(e)) from e
        try:
            info = store_pdf(ctx, pid, data)  # 그 사이 지워졌으면 404
        except StorageError as e:
            raise HTTPException(502, "PDF를 저장하지 못했어요") from e
        except BadPdf:
            raise HTTPException(400, BAD_PDF) from None
        ctx.lib.update_paper(pid, {"pdf_url": url})
        out = {"paper": ctx.lib.get_paper(pid), "warnings": info.warnings, "license": plan.get("license") or ""}
        if plan.get("via"):
            out["via"] = plan["via"]  # 서재 주소 대신 같은 논문의 무료 공개본을 받음
        return out

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
            elif p.get("item_type") == "document":  # 문서는 제목이 파일 이름이라 제목으로 찾지 않는다
                raise SourceError("문서는 제목으로 논문 정보를 찾지 않아요. DOI나 arXiv 번호를 입력해 주세요.")
            else:
                fresh = sources.match_title(p["title"])
                if not fresh:
                    raise SourceError("제목으로 일치하는 논문을 찾지 못했어요. DOI를 입력해 주세요.")
        except SourceError as e:
            raise HTTPException(404, str(e)) from e
        # 문서(제목 = 파일 이름 · 유형 '문서')에 논문 정보를 찾았으면 빈칸 채우기가 아니라 덮어쓴다
        if data.get("overwrite") or p.get("item_type") == "document":
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

    def oc_references(ctx: RequestCtx, doi: str, res: dict, page: int) -> dict:
        """OpenAlex 참고문헌이 0편이고 DOI가 있을 때 OpenCitations로 보강 (5단계 9.2절 · K-7 · K-8).
        씨앗에 OpenAlex 번호가 있으면 결과를 1B 공용 캐시(citation_edges, source 'opencitations')에 두고 다음엔 다시 부르지 않음.
        OpenAlex references 행(편수 있음)이 이미 있으면 쓰지 않음. OpenCitations 실패는 warnings oc_failed(0편과 구분)"""
        try:
            no = parse_openalex_id(res.get("openalex_id")) if res.get("openalex_id") else None
        except BadSeed:
            no = None
        keys = ctx.settings
        src = st.graph_sources_factory(keys.get("openalex_api_key") or "", keys.get("semantic_scholar_api_key") or "")
        store, today = PgStore(db, ctx.claims), st.graph_today()
        edge = store.edges([no], ["references"]).get((no, "references")) if no else None
        try:
            if edge and edge["source"] == "opencitations" and cache_fresh(edge["fetched_on"], TTL_REFERENCES, today):
                nos, total = list(edge["nos"]), int(edge["total"])
                rows = {n: r for n, r in store.works(nos).items() if r.get("title")}
                missing = [n for n in nos if n not in rows][:200]
                for i in range(0, len(missing), 100):  # OpenAlex 묶음 ≤ 2회
                    rows.update({r["no"]: r for r in src.works(missing[i:i + 100], FIELDS_META)})
            else:
                try:
                    dois = src.oc_reference_dois(doi)
                except UpstreamError as e:
                    if e.status != 404:
                        return dict(res, warnings=[{"code": "oc_failed"}])
                    dois = []
                valid, found = lookup_dois(src, dois, FIELDS_META)  # OpenAlex doi: 필터 ≤ 2회 (그래프와 같은 함수)
                rows = {r["no"]: r for r in found.values() if r["no"] != no}
                nos, total = list(dict.fromkeys(found[d]["no"] for d in valid if d in found and found[d]["no"] != no)), \
                    len(valid)
                if no and not (edge and edge["source"] == "openalex" and edge["nos"]):
                    store.write(list(rows.values()), [{"work_no": no, "relation": "references", "nos": nos,
                                                       "total": total, "source": "opencitations"}], today)
        except UpstreamError:
            return dict(res, warnings=[{"code": "refs_partial"}])
        order = sorted((n for n in nos if n in rows), key=lambda n: -(rows[n].get("cited_by_count") or 0))
        if not order:
            return res
        items = [paper_view(rows[n]) for n in order[(page - 1) * 20: page * 20]]
        return {"items": items, "total": len(order), "openalex_id": res.get("openalex_id") or "",
                "via": "opencitations", "unresolved": max(0, total - len(order)), "warnings": []}

    def related_for(ctx: RequestCtx, paper: dict, kind: str, page: int) -> dict:
        sources = ctx.sources
        ctx.release()  # 외부 조회 동안 DB 연결을 잡지 않는다 (F9)
        doi = safe_doi(paper.get("doi")) if kind == "references" else ""
        err = None
        try:
            res = sources.related(paper, kind, page)
        except SourceError as e:
            if not doi:
                raise HTTPException(404, str(e)) from e
            res, err = {"items": [], "total": 0, "openalex_id": ""}, e  # OpenAlex가 모르는 논문도 OpenCitations는 알 수 있음
        if doi and not res["items"] and not res.get("total"):
            res = oc_references(ctx, doi, res, page)
            if err and not res.get("via") and not res.get("warnings"):
                raise HTTPException(404, str(err)) from err
        res.setdefault("warnings", [])
        return res

    @app.get("/api/papers/{pid}/related")
    def related(pid: int, kind: str = "cited_by", page: int = 1, ctx: RequestCtx = Ctx):
        p = need_paper(ctx, pid)
        if kind not in ("cited_by", "references", "related"):
            raise HTTPException(400, "kind는 cited_by, references, related 중 하나예요")
        res = related_for(ctx, p, kind, max(1, page))
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
        paper = data.get("paper") if isinstance(data.get("paper"), dict) else {}
        res = related_for(ctx, paper, kind, max(1, int(data.get("page") or 1)))
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
        color = data.get("color")
        if color is not None and (not isinstance(color, str) or color and not TAG_COLOR_RE.fullmatch(color)):
            raise HTTPException(400, "태그 색은 #RRGGBB 모양이어야 해요")
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
            if lib.find_duplicate(it.get("doi", ""), it.get("arxiv_id", ""), it["title"], include_trash=True):
                skipped += 1  # 휴지통에 같은 논문이 있어도 새로 만들지 않음 (6단계 K-40)
                continue
            pid = lib.add_paper(it)
            if cid:
                lib.set_paper_collections([pid], cid, True)
            added += 1
        return {"added": added, "skipped": skipped, "total": len(items)}

    # ------------------------------------------------------------- search
    @app.get("/api/search")
    def search(q: str, source: str = "openalex", page: int = 1, year_from: int | None = None,
               year_to: int | None = None, sort: str = "relevance", oa: bool = False, cursor: str = "",
               ctx: RequestCtx = Ctx):
        kind, value = detect_identifier(q)
        if kind not in ("doi", "arxiv", "openalex") and source in extsources.EXT_SOURCES:
            return ext_search(ctx, q, source, page, year_from, year_to, sort, oa, cursor)
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

    def ext_search(ctx: RequestCtx, q, source, page, year_from, year_to, sort, oa, cursor):
        """5단계 KCI · RISS · Europe PMC (6장). 결과 · 검색어는 저장하지 않음(U-5). 오류는 code로(문구에 주소 · 키 없음)"""
        uid = ctx.uid
        with st.ext_lock:
            if st.ext_busy.get(uid, 0) >= 2:  # 사용자당 동시 2개(11장 — 가정)
                return JSONResponse({"detail": "앞의 검색이 아직 끝나지 않았어요.", "code": "search_busy"}, status_code=429)
            st.ext_busy[uid] = st.ext_busy.get(uid, 0) + 1
        ctx.release()
        try:
            res = st.ext.search(source, q, page, year_from, year_to, sort, oa, cursor)
        except extsources.ExtError as e:
            return JSONResponse({"detail": str(e), "code": e.code}, status_code=e.status)
        finally:
            with st.ext_lock:
                st.ext_busy[uid] -= 1
                if not st.ext_busy[uid]:
                    del st.ext_busy[uid]
        res["items"] = mark_library(ctx, res["items"])
        return res

    @app.get("/api/sources")
    def ext_sources_status(ctx: RequestCtx = Ctx):
        """소스별 쓸 수 있는지만 (키 값은 돌려주지 않음 — AC-504)"""
        return st.ext.status()

    @app.post("/api/oa/lookup")
    async def oa_lookup(request: Request, ctx: RequestCtx = Ctx):
        """OpenAlex 무료 PDF 정보(8.1절 — 1B 캐시 행 → 없으면 OpenAlex 1회, 결과는 캐시에 쓰지 않음). DOI는 본문으로만.
        본문은 small_json(4KB — chunked도 그 이상 읽지 않음)"""
        try:
            data = await small_json(request)
        except ValueError:
            data = None
        if not isinstance(data, dict):
            return JSONResponse({"detail": "요청이 올바르지 않아요.", "code": "bad_request"}, status_code=400)
        return await run_in_threadpool(oa_lookup_work, ctx, data)

    def oa_lookup_work(ctx: RequestCtx, data: dict):
        doi = safe_doi(data.get("doi"))
        if not doi:
            return JSONResponse({"detail": "DOI 형식이 올바르지 않아요.", "code": "bad_doi"}, status_code=400)
        cached = oa_cached(ctx, doi)
        sources = ctx.sources
        ctx.release()  # 외부 조회 동안 DB 연결을 잡지 않는다 (F9)
        if cached is None:
            try:
                locs = sources.oa_locations(doi)
            except SourceError:
                return JSONResponse({"detail": "OpenAlex에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.",
                                     "code": "upstream_unavailable"}, status_code=502)
        pick = extsources.pick_oa_location(cached if cached is not None else locs)
        oa = None if not pick else {"pdf_url": pick["pdf_url"] if pick["server_fetch"] else "",
                                    "landing_url": pick["landing_url"], "license": pick["license"],
                                    "version": pick["version"], "server_fetch": pick["server_fetch"],
                                    "open_url": pick["open_url"], "open_kind": pick["open_kind"]}
        return {"oa": oa, "cached": cached is not None}

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
        """대화 · 서재 질문 · 선택 설명 · 번역 (9.3절): 첫 칸이 API면 요청 안 SSE 그대로, CLI면 {"type":"queued","job"}
        하나 보내고 끝. API가 폴백 대상 오류로 실패하면 작업을 다음 칸으로 넘기고 {"type":"fallback","job"}.
        run(engine) → 이벤트 반복자 (done 이벤트 → 결과 반영). 응답 머리글 X-PaperLab-Job = 작업 번호(화면의 [취소]).

        화면 연결이 끊겨도(창 · 탭을 닫음 · 다른 화면으로 감) 작업은 멈추지 않는다 — 백그라운드로 넘겨 끝까지 받아 저장하고
        (drain), 화면은 작업 목록 · 끝남 알림으로 결과를 다시 연다 (2026-10-16 제품 책임자 결정, 품질팀 H1의 '끊기면 취소'를 바꿈).
        취소는 [취소](POST /api/jobs/{id}/cancel)로만. AI 호출은 별도 스레드가 돌리고, 이 비동기 생성기는 0.05초마다 끊김을
        확인한다 — 한 번에 응답이 오는 OpenAI · Google 경로도 기다리는 동안 끊김을 본다. 가비지 수집에 기대지 않는다."""
        route, pinned = job_route(ctx, kind, paper_id)  # 로컬 항목이면 보관 PC CLI 칸만 → 아래 queued (선택 동기화 7.4절)
        row, _ = jobs.create_job(ctx.lib, kind, route, params, paper_id, running_api=True, pinned_device_id=pinned)
        job_id, uid, claims, engine = row["id"], ctx.uid, ctx.claims, row["engine"]
        model = ctx.ai.model_name(engine) if kind in jobs.EXPLAIN_KINDS else engine
        log.info(f"job created job={job_id} kind={kind} runner={row['runner']} engine={engine}")
        headers = {**SSE_HEADERS, "X-PaperLab-Job": str(job_id)}
        if row["runner"] == "cli":
            view = jobs.get_job(ctx.lib, job_id, ws.free)
            return StreamingResponse(iter([_sse({"type": "queued", "job": view})]), media_type="text/event-stream",
                                     headers=headers)
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

        def gone(e: jobs.JobError) -> list[str]:
            """작업을 반영할 수 없음 — 논문이 휴지통으로 가 작업이 숨음(RLS → 404) · 취소돼 리스를 잃음. 화면이 끝을
            알 수 있게 오류 이벤트로 끝낸다 (QA D6)"""
            log.info(f"job gone job={job_id} code={e.code}")
            return [_sse({"type": "error", "error": PAPER_TRASHED if paper_id is not None and e.code == "not_found"
                          else e.detail, "code": e.code})]

        def save_done(ev: dict) -> list[str]:
            try:
                return _save_done(ev)
            except jobs.JobError as e:
                return gone(e)

        def _save_done(ev: dict) -> list[str]:
            with db.user_tx(claims) as lib:
                j = jobs.lock_leased(lib, job_id, token)
                parsed = {"text": ev["text"], "citations": ev.get("citations") or []}
                if kind in jobs.EXPLAIN_KINDS:  # 4단계: 결과 검사 — 틀리면 bad_output(폴백 없음, 6.2절 5번)
                    try:
                        parsed = jobs.parse_result(j, ev["text"])
                    except AIError as e:
                        jobs._end(lib, j, "failed", "bad_output", str(e), jobs._history_entry(j, "bad_output"))
                        view = jobs.get_job(lib, job_id, ws.free)
                        return [_sse({"type": "error", "error": view["error"], "job": view})]
                status, res = jobs.finish_success(lib, j, parsed, model)
                found = explain.get_row(lib, res["explanation_id"]) if res and "explanation_id" in res else None
            res = res or {}
            if status != "succeeded":
                return [_sse({"type": "error", "error": "작업을 취소했어요" if status == "cancelled"
                              else jobs.DEFAULT_ERRORS["apply_failed"]})]
            if found:
                return [_sse({"type": "done", "item": explain.item(found), "cached": False, "job_id": job_id})]
            if "message_id" in res:
                ev["id"] = res["message_id"]
            ev["job_id"] = job_id
            return [_sse(ev)]

        def fail(code: str, message: str) -> list[str]:
            with db.user_tx(claims) as lib:
                try:
                    j = jobs.lock_leased(lib, job_id, token)
                except jobs.JobError as e:
                    return gone(e)
                jobs.record_key_error(lib, engine, code)
                status = jobs.fail_or_fallback(lib, j, code, message, guide=guide())
                view = jobs.get_job(lib, job_id, ws.free)
            log.info(f"job failed job={job_id} code={code} status={status}")
            if status == "queued":
                if view["runner"] == "api":
                    runner.enqueue(job_id, uid)
                return [_sse({"type": "fallback", "job": view})]
            return [_sse({"type": "error", "error": view["error"], "job": view})]

        def outcome(kind_: str, item) -> list[str]:
            """마지막 이벤트(done · 오류 · 끝) → 반영 · 실패 판정 → 화면에 보낼 SSE 줄"""
            if kind_ == "ev":
                return save_done(item)
            if kind_ == "err":
                return fail(item.code or "api_server", str(item))
            if kind_ == "exc":
                log.warning("sse job crashed job=%s: %s", job_id, type(item).__name__)
                return fail("api_server", "AI 응답을 처리하지 못했어요")
            return fail("bad_output", "AI 응답이 끝나기 전에 멈췄어요")

        def drain(pending=None) -> None:
            """화면 연결이 끊긴 뒤: 작업을 멈추지 않고 이 스레드가 끝까지 받아 저장한다 (2026-10-16 백그라운드 AI).
            interactive를 끄고 리스를 이어 가므로, 그 사이 서버가 죽으면 복구 스캔이 API 실행기로 다시 실행한다(결과를 잃지 않음).
            중간 글은 1초에 한 번 진행(partial_text)으로 남기고 — 다시 연 화면 · 작업 목록이 보여 줌 — 그때 [취소]를 읽는다."""
            try:
                with db.user_tx(claims) as lib:
                    ok = lib._x("update paperlab.jobs set interactive = false, lease_until = greatest(lease_until, now() "
                                "+ make_interval(secs => %s)), updated_at = now() where id = %s and user_id = %s "
                                "and lease_token = %s::uuid and status = 'running'",
                                (jobs.LEASE_S, job_id, uid, token)).rowcount
            except DBUnavailable:
                ok = 1  # 지금은 못 썼어도 결과는 받아 둔다 (반영 때 다시 시도)
            if not ok:
                stop.set()
                return
            log.info(f"job detached job={job_id} (화면 연결 끊김 — 백그라운드로 계속)")
            text, last, changed = acc["text"], time.monotonic(), True  # 끊기기 전에 화면에 보낸 글부터 이어서
            while True:
                if pending is not None:
                    kind_, item = pending
                    pending = None
                else:
                    try:
                        kind_, item = q.get(timeout=1.0)
                    except queue.Empty:
                        kind_, item = "", None
                if kind_ in ("err", "exc", "end") or (kind_ == "ev" and item.get("type") == "done"):
                    try:
                        outcome(kind_, item)
                    except DBUnavailable:
                        log.warning("detached job save failed job=%s: db unavailable", job_id)
                    return
                if kind_ == "ev" and item.get("type") == "delta":
                    text += str(item.get("text") or "")
                    changed = True
                now = time.monotonic()
                if not ((changed and now - last >= 1.0) or now - last >= DETACH_CHECK_S):
                    continue
                last, changed = now, False
                try:
                    with db.user_tx(claims) as lib:
                        res = jobs.touch_lease(lib, job_id, token, renew=True, progress=jobs.clean_progress(
                            {"message": "백그라운드에서 만드는 중", "partial_text": text}))
                        if res is not None and res["cancel"]:
                            jobs._end(lib, jobs.lock_leased(lib, job_id, token), "cancelled")
                except jobs.JobError:
                    res = None
                except DBUnavailable:
                    continue  # 다음 주기에 다시 (리스는 90초)
                if res is None or res["cancel"]:
                    stop.set()  # 리스를 잃음 · [취소] — 스트림을 닫아 회사 API 연결도 끊는다
                    log.info(f"job detached stopped job={job_id} cancel={bool(res and res['cancel'])}")
                    return

        acc = {"text": ""}  # 화면에 보낸 중간 글 (끊긴 뒤 진행 partial_text의 앞부분)

        async def events():
            ended = False
            pending = None
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
                        if item["type"] == "delta":
                            acc["text"] += str(item.get("text") or "")
                        yield _sse(item)
                        continue
                    if await request.is_disconnected():
                        pending = (kind_, item)  # 끊긴 뒤에 온 결과도 백그라운드에서 저장한다
                        return
                    ended = True
                    for x in await run_in_threadpool(outcome, kind_, item):
                        yield x
                    return
            except DBUnavailable:
                yield _sse({"type": "error", "error": DB_UNAVAILABLE["detail"]})
            finally:
                if ended:
                    stop.set()
                else:
                    # 끊김: 취소하지 않고 백그라운드로 (취소 영역 안에서는 await할 수 없으므로 스레드로)
                    threading.Thread(target=drain, args=(pending,), name=f"sse-drain-{job_id}", daemon=True).start()

        return StreamingResponse(events(), media_type="text/event-stream", headers=headers)

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
    def ai_write(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """원고 글쓰기 도우미 = 백그라운드 작업 (2026-10-16 제품 책임자 결정): 202 {job}. 창 · 탭 · 앱을 닫아도 서버(API 키) ·
        내 PC(CLI)가 끝까지 실행하고 결과(result.text)를 7일 동안 남긴다 — 작업 화면 · 원고 화면에서 열어 넣는다.
        넣기 정보(sel_start · sel_end · insert · doc_hash · before)는 그 사이 원고가 바뀌었는지 화면이 확인하는 데 쓴다"""
        text = str(data.get("text") or "").strip()
        mode = data.get("mode") or "polish"
        if not isinstance(mode, str) or mode not in WRITE_MODES:  # 목록 · 객체면 in 검사가 500이 되므로 먼저 거름
            raise HTTPException(400, "알 수 없는 글쓰기 모드예요")
        if not text and mode not in WRITE_NO_TEXT_MODES:
            raise HTTPException(400, "다듬을 글을 선택해 주세요")
        if mode in WRITE_NO_TEXT_MODES and mode != "draft" and not data.get("keys"):
            raise HTTPException(400, "비교할 논문을 골라 주세요")
        mid = data.get("manuscript_id")
        if mid is not None and (isinstance(mid, bool) or not isinstance(mid, int) or not 0 < mid < 10 ** 15):
            raise HTTPException(400, "원고 번호가 올바르지 않아요")
        keys = [str(k)[:200] for k in data.get("keys") or []][:30]
        params = {"mode": str(mode)[:20], "text": text, "instruction": str(data.get("instruction") or "")[:2000],
                  "context": str(data.get("context") or "")[:6000], "keys": keys, "manuscript_id": mid,
                  **write_anchor(data)}
        view, _ = new_job(ctx, "write", params, None)
        return JSONResponse({"job": view}, status_code=202)

    @app.post("/api/ai/proofread")
    def ai_proofread(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """맞춤법 · 띄어쓰기 점검 한 조각 = 백그라운드 작업 202 {job} (2026-10-17 — proofread.py · writing-proofread.md).
        화면이 범위를 4000자 안쪽 조각으로 나눠 조각마다 부르고, 결과(고칠 곳 목록)는 원고에 넣지 않고 점검 패널이 보여 준다"""
        try:
            params = proofread.clean_params(data)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        view, _ = new_job(ctx, "proofread", params, None)
        return JSONResponse({"job": view}, status_code=202)

    def write_anchor(data: dict) -> dict:
        """넣을 자리 (화면이 보냄 — 틀린 값은 버림): 원래 고른 범위 · 커서 뒤에 넣기 · 원고 전체 해시 · 자리 앞 글(다시 찾기)"""
        s, e = data.get("sel_start"), data.get("sel_end")
        ok = all(isinstance(x, int) and not isinstance(x, bool) and 0 <= x < 10 ** 8 for x in (s, e)) and s <= e
        doc_hash = str(data.get("doc_hash") or "")
        return {"sel_start": s if ok else None, "sel_end": e if ok else None, "insert": data.get("insert") is True,
                "doc_hash": doc_hash if re.fullmatch(r"[0-9a-z]{1,64}", doc_hash) else "",
                "before": str(data.get("before") or "")[-300:]}

    # ------------------------------------------- 4단계: 쉬운 설명 · 선택 번역 · 전체 번역 (docs/specs/phase4-explain-translate.md 10장)
    @app.post("/api/papers/{pid}/explain")
    def explain_selection(pid: int, request: Request, data: dict = Body(...), ctx: RequestCtx = Ctx):
        """선택 설명 · 번역(SSE). 같은 (논문, 종류, 언어, 글)이 저장돼 있으면 작업 없이 done 하나(K-4). 글은 본문으로만"""
        need_paper(ctx, pid)
        no_local_ai(ctx, pid)  # 선택 동기화 D-13: PC에만 둔 파일은 409 local_only
        try:
            req = explain.clean_request(data)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        kind, text = req["kind"], req["text"]
        lang = explain.lang_for(kind, ctx.settings.get)
        if kind == "translate" and lang == "ko" and translate.hangul_ratio(text) >= translate.KO_RATIO:
            raise HTTPException(400, "이미 한국어예요")
        if not req["force"]:
            row = explain.cached(ctx.lib, pid, kind, lang, explain.sel_hash(kind, lang, text))
            if row:
                res = row["result"] or {}
                log.info(json.dumps({"event": "explain", "kind": kind, "cached": True, "ms": 0, "svg": bool(res.get("svg")),
                                     "svg_note": res.get("svg_note") or ""}))
                return StreamingResponse(iter([_sse({"type": "done", "cached": True, "item": explain.item(row, cached=True)})]),
                                         media_type="text/event-stream", headers=SSE_HEADERS)
        params = {**req, "lang": lang}

        def run(engine: str):
            system, prompt, schema = explain.build_request(ctx.lib, pid, params)
            events = ctx.ai.complete(system, prompt, engine, schema=schema, schema_name="explanation")
            return events if kind == "translate" else _done_only(events)

        return stream_job(ctx, request, kind, params, pid, run)

    @app.get("/api/papers/{pid}/explanations")
    def explanations(pid: int, ctx: RequestCtx = Ctx):
        """이 논문의 카드(최신 100개) + 진행 중인 PC · 백그라운드 작업(화면에 붙은 SSE 작업은 빼고 — 화면을 떠나
        백그라운드로 넘어간 작업은 interactive가 꺼져 여기 들어온다)"""
        need_paper(ctx, pid)
        maintain(ctx)
        running = [j for k in jobs.EXPLAIN_KINDS for j in jobs.list_jobs(ctx.lib, ws.free, "active", pid, k, 20)["jobs"]
                   if not j["interactive"]]
        return {"items": [explain.item(r) for r in explain.list_rows(ctx.lib, pid)], "jobs": running,
                "keep": explain.MAX_ROWS}

    @app.delete("/api/explanations/{eid}")
    def delete_explanation(eid: int, ctx: RequestCtx = Ctx):
        if not jobs.valid_id(eid) or not explain.delete(ctx.lib, eid):
            raise HTTPException(404, "찾을 수 없어요")
        return {"ok": True}

    TR_NO_TEXT = "글자를 읽을 수 없는 항목이에요(스캔본 · 사진)."
    TR_NONE = "번역이 없어요"

    def tr_job(ctx: RequestCtx, pid: int, active: bool = False) -> dict | None:
        cond = " and j.paper_id = %(pid)s and j.kind = 'translate_paper'"
        return jobs.latest_job(ctx.lib, ws.free, cond + (" and j.status in ('queued', 'running')" if active else ""),
                               {"pid": pid})

    def tr_texts(ctx: RequestCtx, pid: int) -> list[str]:
        texts = ctx.lib.page_texts(pid)
        if not any(t.strip() for t in texts):
            raise HTTPException(400, TR_NO_TEXT)
        return texts

    def tr_run(ctx: RequestCtx, pid: int, row: dict, state: str, errors: dict, include_refs: bool,
               retry: bool) -> JSONResponse:
        """시작 · 이어서 공용: 대기 쪽 검사 → 경로 · 저장 공간 → 행 갱신 → translate_paper 작업 202 (6.3절 1 · 2번)"""
        pending = state.count("-")
        if not pending:
            raise HTTPException(400, "번역할 쪽이 없어요")
        if pending > translate.MAX_PAGES:
            raise HTTPException(400, f"{translate.MAX_PAGES}쪽까지 한 번에 번역할 수 있어요. 쪽 범위를 정해 주세요")
        route_for(ctx, "translate_paper")
        ensure_space(ctx)
        translate.update_row(ctx.lib, row, page_state=state, page_errors=errors, include_refs=include_refs)
        view, created = new_job(ctx, "translate_paper", {"translation_id": row["id"], "retry": retry}, pid)
        if created:
            view["progress"] = jobs.clean_progress(translate.progress(state))
            ctx.lib._x("update paperlab.jobs set progress = %s where id = %s and user_id = %s",
                       (Jsonb(view["progress"]), view["id"], ctx.uid))
        return JSONResponse({"job": view}, status_code=202 if created else 200)

    def tr_continue(ctx: RequestCtx, pid: int, pages, include_refs: bool) -> JSONResponse:
        no_local_ai(ctx, pid)  # 선택 동기화 D-13 (다시 시도 · 이어서 모두)
        row = translate.row_for(ctx.lib, pid, lock=True)
        if not row:
            raise HTTPException(404, TR_NONE)
        active = tr_job(ctx, pid, active=True)
        if active:
            return JSONResponse({"job": active}, status_code=200)
        refs_from = translate.refs_start(tr_texts(ctx, pid))[0]   # 다시 셈 (품질팀 L-6)
        if refs_from != row["refs_from"]:
            translate.update_row(ctx.lib, row, refs_from=refs_from)
            row["refs_from"] = refs_from
        state, retry, inc = list(row["page_state"]), False, row["include_refs"]
        if include_refs and not inc:  # 참고문헌 이후도 — 참고문헌 첫 쪽은 제목 아래까지 다시
            inc = True
            state = ["-" if c == "r" else c for c in state]
            if row["refs_from"] and state[row["refs_from"] - 1] in "ds":
                state[row["refs_from"] - 1] = "-"
        if pages == "failed":
            state, retry = ["-" if c == "f" else c for c in state], True
        elif isinstance(pages, list):
            if not pages or len(pages) > translate.MAX_PAGES or any(
                    isinstance(p, bool) or not isinstance(p, int) or not 1 <= p <= len(state) for p in pages):
                raise HTTPException(400, "쪽 번호가 올바르지 않아요")
            for p in pages:
                state[p - 1] = "-"
            retry = True
        elif pages != "pending":
            raise HTTPException(400, "pages는 pending · failed · 쪽 번호 목록 중 하나예요")
        state = "".join(state)
        errors = {k: v for k, v in (row["page_errors"] or {}).items() if k.isdigit() and 0 < int(k) <= len(state)
                  and state[int(k) - 1] == "f"}
        return tr_run(ctx, pid, row, state, errors, inc, retry)

    @app.get("/api/papers/{pid}/translation")
    def translation_get(pid: int, ctx: RequestCtx = Ctx):
        """번역 메타 + 끝난(d) 쪽 글 + 진행 중이거나 마지막 작업 + 시작 창 예상. 파일 키는 RLS 행의 tr_key뿐(8.2절).
        6단계 SW-7: PDF가 바뀌어 전체 번역을 지운 시각(translation_cleared_at — 번역 행이 없을 때 안내)"""
        p = need_paper(ctx, pid)
        maintain(ctx)
        row = translate.row_for(ctx.lib, pid)
        texts = ctx.lib.page_texts(pid)
        lang = row["lang"] if row else ctx.settings.get("translate_language")
        out = {"translation": translate.view(row) if row else None, "job": tr_job(ctx, pid),
               "estimate": translate.estimate(texts, lang) if any(t.strip() for t in texts) else None,
               "translation_cleared_at": p.get("translation_cleared_at")}
        if row:
            ctx.release()  # R2 읽기 동안 DB 연결을 잡지 않는다 (F9)
            try:
                pages = translate.read_pages(ctx.storage, row)
                st = row["page_state"]
                out["translation"]["pages"] = {k: v for k, v in pages.items()
                                               if k.isdigit() and 0 < int(k) <= len(st) and st[int(k) - 1] == "d"}
            except translate.TranslationFileError as e:
                out["translation"]["error"] = str(e)
        return out

    @app.post("/api/papers/{pid}/translation")
    def translation_start(pid: int, data: dict = Body(default={}), ctx: RequestCtx = Ctx):
        """전체 번역 시작 (6.3절 1번) → 202 {job}, 진행 중이면 200 {job}, 다른 언어 번역이 있으면 409(replace로 교체)"""
        need_paper(ctx, pid)
        no_local_ai(ctx, pid)  # 선택 동기화 D-13: 번역 결과 파일은 R2에 저장되므로 PC에만 둔 파일은 409
        maintain(ctx)
        lang = data.get("lang") or ctx.settings.get("translate_language")
        if lang not in translate.LANGS:
            raise HTTPException(400, "번역 언어가 올바르지 않아요")
        active = tr_job(ctx, pid, active=True)
        if active:
            return JSONResponse({"job": active}, status_code=200)
        texts = tr_texts(ctx, pid)
        n = len(texts)
        frm = data.get("from") if data.get("from") is not None else 1
        to = data.get("to") if data.get("to") is not None else n
        if any(isinstance(x, bool) or not isinstance(x, int) for x in (frm, to)) or not 1 <= frm <= to <= n:
            raise HTTPException(400, "쪽 범위가 올바르지 않아요")
        include_refs = data.get("include_refs") is True
        state, refs_from = translate.plan(texts, lang, frm, to, include_refs)
        row = translate.row_for(ctx.lib, pid, lock=True)
        if row and (row["lang"] != lang or len(row["page_state"]) != n):
            if row["lang"] != lang and data.get("replace") is not True:
                old, new = translate.LANGS[row["lang"]], translate.LANGS[lang]
                return JSONResponse({"detail": f"기존 {old} 번역을 지우고 {new}로 새로 번역할까요?", "code": "other_lang",
                                     "lang": row["lang"]}, status_code=409)
            old_key = translate.delete_row(ctx.lib, pid)
            ctx.after_commit.append(lambda: ctx.storage.delete_quietly(old_key))
            row = None
        if row:
            state = translate.merge(row["page_state"], state, frm, to)
            if refs_from != row["refs_from"]:  # 다시 시작할 때 참고문헌 위치를 다시 셈 (품질팀 L-6)
                translate.update_row(ctx.lib, row, refs_from=refs_from)
            errors = {k: v for k, v in (row["page_errors"] or {}).items() if k.isdigit() and 0 < int(k) <= n
                      and state[int(k) - 1] == "f"}
        else:
            row = translate.create_row(ctx.lib, pid, lang, state, refs_from, include_refs,
                                       (ctx.lib.pdf_info(pid) or {}).get("pdf_sha256") or "")
            errors = {}
        return tr_run(ctx, pid, row, state, errors, include_refs, False)

    @app.post("/api/papers/{pid}/translation/continue")
    def translation_continue(pid: int, data: dict = Body(default={}), ctx: RequestCtx = Ctx):
        """이어서(pending) · 실패한 쪽 다시(failed) · 쪽 목록 · 참고문헌 포함 (6.3절 2번)"""
        need_paper(ctx, pid)
        maintain(ctx)
        return tr_continue(ctx, pid, data.get("pages", "pending"), data.get("include_refs") is True)

    @app.delete("/api/papers/{pid}/translation")
    def translation_delete(pid: int, ctx: RequestCtx = Ctx):
        """진행 중 작업 취소 + 행 삭제 → 커밋 뒤 파일 삭제 (8.2절)"""
        need_paper(ctx, pid)
        active = tr_job(ctx, pid, active=True)
        if active:
            jobs.cancel_job(ctx.lib, active["id"])
        key = translate.delete_row(ctx.lib, pid)
        if not key:
            raise HTTPException(404, TR_NONE)
        ctx.after_commit.append(lambda: ctx.storage.delete_quietly(key))
        return {"ok": True}

    @app.post("/api/papers/{pid}/translation/manuscript")
    def translation_manuscript(pid: int, ctx: RequestCtx = Ctx):
        """[원고로 만들기] (K-12): 서버가 번역 파일로 본문을 만든다 — 새 원고 기본 양식"""
        p = need_paper(ctx, pid)
        row = translate.row_for(ctx.lib, pid)
        if not row:
            raise HTTPException(404, TR_NONE)
        fmt = ctx.settings.get("doc_format_default")
        if not format_exists(ctx, fmt):
            fmt = doc_formats.DEFAULT_ID
        ctx.release()  # R2 읽기 동안 DB 연결을 잡지 않는다 (F9)
        try:
            pages = translate.read_pages(ctx.storage, row)
        except translate.TranslationFileError as e:
            raise HTTPException(400, str(e)) from None
        title, content = translate.manuscript(p["title"], row, pages)
        return {"id": ctx.lib.add_manuscript(title, content, "blank", fmt), "title": title}

    # ------------------------------------------- 3단계: AI 질문(서재) · AI로 찾기 · 인용 검증 (명세 11 · 12 · 13 · 14.3절)
    ASK_EMPTY = "이 범위에 색인된 논문이 없어요"

    def user_tx(ctx: RequestCtx) -> Callable:
        """그 사용자 권한의 짧은 트랜잭션을 여는 함수 (요청 트랜잭션과 별개)"""
        return lambda: db.user_tx(ctx.claims)
    RAG_BUSY = "색인을 불러오는 데 시간이 오래 걸려요. 잠시 후 다시 물어봐 주세요."

    def ask_scope(ctx: RequestCtx, value) -> tuple[str, int | None, str]:
        """주소의 범위(library · c{id} · f{id}) → (종류, id, 이름). 남의 컬렉션 · 폴더면 400 — 파일은 읽지 않음(AC-S03)"""
        try:
            stype, sid = rag.parse_scope(value)
        except ValueError:
            raise HTTPException(400, "범위가 올바르지 않아요") from None
        if stype == "library":
            return stype, sid, ""
        row = ctx.lib._one(f"select name from paperlab.{'collections' if stype == 'collection' else 'folders'} "
                           "where id = %s and user_id = %s", (sid, ctx.uid))
        if not row:
            raise HTTPException(400, "범위를 찾을 수 없어요")
        return stype, sid, row["name"]

    def excluded_local(ctx: RequestCtx, rows: list[dict]) -> int:
        """범위 안의 PC에만 둔 편수 — 서재 질문 · 본문 검색에서 빠짐(색인 · 본문이 없음, 선택 동기화 7.2절)"""
        ids = [r["id"] for r in rows if not r["has_pdf"]]
        if not ids:
            return 0
        return ctx.lib._one("select count(*)::int as n from paperlab.papers where user_id = %s and id = any(%s) "
                            "and storage = 'local'", (ctx.uid, ids))["n"]

    def index_status(ctx: RequestCtx, rows: list[dict]) -> dict:
        done = set(rg.done_versions)
        with_pdf = [r for r in rows if r["has_pdf"]]
        no_text = sum(1 for r in with_pdf if r["rag_version"] in done and not r["rag_key"])
        return {"papers": len(rows), "with_pdf": len(with_pdf), "indexed": len(rag.searchable(rows)), "no_text": no_text,
                "pending": sum(1 for r in with_pdf if r["rag_version"] not in done),
                "embed": rg.embedder is not None, "loaded": rg.loaded(ctx.uid, rows),
                "excluded_local": excluded_local(ctx, rows)}

    @app.get("/api/ask")
    def ask_get(scope: str = "library", ctx: RequestCtx = Ctx):
        """범위 대화 + 색인 상태. 부를 때 색인 작업 보장 + 벡터 미리 불러오기(9.4 · 10.1절)"""
        stype, sid, name = ask_scope(ctx, scope)
        maintain(ctx)
        rows = rag.scope_rows(ctx.lib, stype, sid)
        job_id = rg.ensure_index_job(ctx.lib)
        if job_id:
            ctx.after_commit.append(lambda: runner.enqueue(job_id, ctx.uid))
        rg.prefetch(user_tx(ctx), ctx.uid, rows if stype == "library" else rag.scope_rows(ctx.lib, "library", None))
        return {"scope": {"type": stype, "id": sid, "name": name}, "messages": ctx.lib.scope_history(stype, sid),
                "index": index_status(ctx, rows),
                "job": jobs.latest_job(ctx.lib, ws.free, " and j.kind = 'index'")}

    @app.delete("/api/ask")
    def ask_clear(scope: str = "library", ctx: RequestCtx = Ctx):
        stype, sid, _ = ask_scope(ctx, scope)
        ctx.lib.clear_scope(stype, sid)
        return {"ok": True}

    @app.post("/api/ask")
    def ask(request: Request, data: dict = Body(...), ctx: RequestCtx = Ctx):
        """범위 질문(SSE — 읽기 화면 대화와 같은 이벤트). 출처 8개는 여기서 한 번 골라 params.sources에 고정(11.3절)"""
        stype, sid, _ = ask_scope(ctx, data.get("scope") or "library")
        question = str(data.get("question") or "").strip()
        if not question:
            raise HTTPException(400, "질문을 입력해 주세요")
        if len(question) > 8000:
            raise HTTPException(400, "질문이 너무 길어요")
        route_for(ctx, "chat")  # 경로가 없으면 검색 전에 400
        rows = rag.scope_rows(ctx.lib, stype, sid)
        if not rag.searchable(rows):
            raise HTTPException(400, ASK_EMPTY)
        lang = ctx.settings.get("summary_language") or "한국어"
        n_local = excluded_local(ctx, rows)  # PC에만 둔 편수 — 화면 "이 PC에만 있는 n편은 빠졌어요" (선택 동기화 7.2절)
        ctx.release()  # 범위 행 · 키는 RLS로 읽었음 — R2 로드 · 임베딩 동안 DB 연결을 잡지 않는다 (품질팀 M2)
        try:
            sources = rg.sources_for(user_tx(ctx), ctx.uid, rows, question)
        except rag.RagBusy:
            raise HTTPException(503, RAG_BUSY) from None
        params = {"question": question, "scope": {"type": stype, "id": sid}, "sources": sources}

        def run(engine: str):
            system, prompt = rag.ask_request(ctx.lib, params, ctx.lib.scope_history(stype, sid), lang)
            return with_excluded(rag.with_citations(ctx.ai.complete(system, prompt, engine), sources))

        def with_excluded(events):
            try:
                for ev in events:
                    if ev.get("type") == "done":
                        ev = {**ev, "excluded_local": n_local}
                    yield ev
            finally:
                close = getattr(events, "close", None)
                if close:
                    close()  # 끊김 · 취소 때 회사 API 스트림도 닫히게 (_done_only와 같음)

        resp = stream_job(ctx, request, "chat", params, None, run)
        resp.headers["X-PaperLab-Excluded-Local"] = str(n_local)  # CLI(queued) 경로도 화면이 알 수 있게
        return resp

    @app.post("/api/find")
    def find_start(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """AI로 찾기(13장) — 백그라운드 작업 + 폴링. 질문은 본문으로만(AC-L03)"""
        question = str(data.get("question") or "").strip()
        if not 2 <= len(question) <= 1000:
            raise HTTPException(400, "질문은 2~1,000자로 써 주세요")
        view, _ = new_job(ctx, "find", {"question": question}, None)
        return JSONResponse({"job": view}, status_code=202)

    @app.post("/api/library-match")
    def library_match(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """원고 문장 여러 개 → 내 서재 본문에서 가까운 조각 (2026-10-27 — 인용 빠짐 점검 · 표절 미리 점검).
        AI 글 생성 없음(임베딩 검색만). overlap = 문장 글자 5-gram 중 조각에도 있는 비율(표현을 그대로 옮겼는지)"""
        raw = data.get("queries")
        if not isinstance(raw, list) or not 0 < len(raw) <= 150 or not all(isinstance(q, str) for q in raw):
            raise HTTPException(400, "문장을 1~150개 보내 주세요")
        queries = [re.sub(r"\s+", " ", q).strip()[:600] for q in raw]
        k = data.get("k") if data.get("k") in (1, 2, 3, 5) else 3
        rows = rag.searchable(rag.scope_rows(ctx.lib, "library", None))
        if not rows:
            return {"results": [[] for _ in queries], "indexed": 0}
        info = {r["id"]: r for r in rows}
        keys = {r["id"]: r["citekey"] or "" for r in ctx.lib._all(
            "select id, citekey from paperlab.papers where user_id = %s and id = any(%s)", (ctx.uid, list(info)))}
        ctx.release()  # R2 로드 · 임베딩 동안 DB 연결을 잡지 않는다
        try:
            found = rg.batch_search(user_tx(ctx), ctx.uid, rows, queries, k=k)
        except rag.RagBusy:
            raise HTTPException(503, "서재 색인을 불러오는 중이에요. 잠시 뒤 다시 해 주세요") from None
        results = [[{"paper_id": h["paper_id"], "citekey": keys.get(h["paper_id"], ""), "title": info[h["paper_id"]]["title"],
                     "year": info[h["paper_id"]]["year"], "page": h["page"], "score": h["score"],
                     "overlap": rag.overlap(q, h["text"]), "text": h["text"].strip()[:500]}
                    for h in hits if h["paper_id"] in info] for q, hits in zip(queries, found)]
        return {"results": results, "indexed": len(rows)}

    @app.post("/api/source-check")
    def source_check(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """출처 확인 (2026-10-26 사용자 요청): 원고 문장 하나 → 내 서재 본문 조각(혼합 검색, 지금) + 외부 논문 검색 →
        AI 판정 · 고친 문장 · 확인할 곳. 작업 종류는 find(params.mode = "claim") — 백그라운드 · 끝남 알림 · 24시간 정리 그대로"""
        claim = re.sub(r"\s+", " ", str(data.get("claim") or "")).strip()
        if not 5 <= len(claim) <= find.CLAIM_MAX:
            raise HTTPException(400, "확인할 문장은 5~1,500자로 골라 주세요")
        mid = data.get("manuscript_id")
        if mid is not None:
            if not jobs.valid_id(mid):
                raise HTTPException(400, "원고 번호가 올바르지 않아요")
            need_manuscript(ctx, mid)
        route_for(ctx, "find")  # 경로가 없으면 검색 전에 400
        rows = rag.searchable(rag.scope_rows(ctx.lib, "library", None))
        library, lib_warn = [], []
        if rows:
            ctx.release()  # R2 로드 · 임베딩 동안 DB 연결을 잡지 않는다 (서재 질문과 같음)
            try:
                hits = rg.search(user_tx(ctx), ctx.uid, rows, claim, k=find.LIB_N, per_paper=2)
            except rag.RagBusy:
                hits, lib_warn = [], ["library_busy"]
            info = {r["id"]: r for r in rows}
            pids = sorted({h["paper_id"] for h in hits})
            keys = {r["id"]: r["citekey"] or "" for r in ctx.lib._all(
                "select id, citekey from paperlab.papers where user_id = %s and id = any(%s)", (ctx.uid, pids))} if pids else {}
            library = [{"n": i + 1, "paper_id": h["paper_id"], "citekey": keys.get(h["paper_id"], ""),
                        "title": info[h["paper_id"]]["title"], "year": info[h["paper_id"]]["year"], "page": h["page"],
                        "text": (h.get("text") or "").strip()[:find.LIB_TEXT_MAX]}
                       for i, h in enumerate(hits) if h["paper_id"] in keys]
        params = {"question": claim, "mode": "claim", "library": library, "lib_warnings": lib_warn}
        if mid is not None:
            params["manuscript_id"] = mid
        view, _ = new_job(ctx, "find", params, None)
        return JSONResponse({"job": view}, status_code=202)

    def verify_job(ctx: RequestCtx, mid: int, active: bool = False) -> dict | None:
        cond = " and j.kind = 'verify' and j.params ->> 'manuscript_id' = %(mid)s"
        if active:
            cond += " and j.status in ('queued', 'running')"
        return jobs.latest_job(ctx.lib, ws.free, cond, {"mid": str(mid)})

    def need_manuscript(ctx: RequestCtx, mid: int) -> dict:
        m = ctx.lib.get_manuscript(mid) if jobs.valid_id(mid) else None
        if not m:
            raise HTTPException(404, "원고를 찾을 수 없어요")
        return m

    @app.post("/api/manuscripts/{mid}/verify")
    def verify_run(mid: int, ctx: RequestCtx = Ctx):
        """인용 검증(12.1절): 직접 인용 대조 · 근거 후보는 지금, AI 판정은 verify 작업(원고당 진행 중 하나)"""
        m = need_manuscript(ctx, mid)
        maintain(ctx)
        has_route = bool(jobs.build_route("verify", ctx.settings.get, jobs.device_rows(ctx.lib)))
        ctx.release()  # 대조 · 근거 검색(R2 · 임베딩)은 트랜잭션 밖 — run_check가 짧은 트랜잭션을 따로 연다 (품질팀 M2)
        try:
            stats = verify.run_check(user_tx(ctx), rg, ctx.uid, mid, m["content"], has_route)
        except rag.RagBusy:
            raise HTTPException(503, RAG_BUSY) from None
        job = verify_job(ctx, mid, active=True)
        if stats["pending"] and has_route and not job:
            job, _ = new_job(ctx, "verify", {"manuscript_id": mid}, None)
        out = verify.view(ctx.lib, mid, m["content"])
        out["job"] = job or verify_job(ctx, mid)
        return out

    @app.get("/api/manuscripts/{mid}/verify")
    def verify_get(mid: int, ctx: RequestCtx = Ctx):
        m = need_manuscript(ctx, mid)
        maintain(ctx)
        out = verify.view(ctx.lib, mid, m["content"])
        out["job"] = verify_job(ctx, mid)
        return out

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
        m = ctx.lib.get_manuscript(mid)
        if not m:
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
        if "content" in data:  # 버전 기록: 10분마다 덮어쓰기 전 글 (docs/specs/manuscript-history.md)
            versions.on_patch(ctx.lib, m, data["content"], lambda: db_room(ctx))
        ctx.lib.update_manuscript(mid, data)
        return {"ok": True, "updated_at": ctx.lib.get_manuscript(mid)["updated_at"]}

    @app.delete("/api/manuscripts/{mid}")
    def delete_manuscript(mid: int, ctx: RequestCtx = Ctx):
        if not ctx.lib.delete_manuscript(mid):
            raise HTTPException(404, "원고를 찾을 수 없어요")
        # 원고 그림은 커밋 뒤에 지운다(목록을 못 읽으면 남겨 둠 — 원고 삭제는 그대로 성공)
        try:
            keys = [k for k, _ in ctx.storage.list_figures(mid)] if jobs.valid_id(mid) else []
        except StorageError:
            keys = []
        for k in keys:
            ctx.after_commit.append(lambda k=k: ctx.storage.delete_quietly(k))
        return {"ok": True}

    # 원고 버전 기록 /api/manuscripts/{mid}/versions… (docs/specs/manuscript-history.md)
    def db_room(ctx: RequestCtx) -> bool:
        return system_sizes(ctx)["size"] < int(config.db_limit_bytes * DB_LEVEL)

    versions.register(app, Ctx, SimpleNamespace(need_manuscript=need_manuscript, db_room=db_room, md_title=_md_title))
    # 원고 AI 대화 · 장 · 절 일괄 처리 /api/manuscripts/{mid}/chat · ai-batch (docs/specs/manuscript-ai-chat.md)
    mschat.register(app, Ctx, SimpleNamespace(need_manuscript=need_manuscript, new_job=new_job, maintain=maintain,
                                              free=lambda: ws.free))
    figgen.register(app, Ctx, SimpleNamespace(need_manuscript=need_manuscript, new_job=new_job))  # POST /api/ai/figure

    # -------------------------------------------------------- 원고 그림 (docs/specs/writing-figures-tables.md)
    @app.post("/api/manuscripts/{mid}/figures")
    def upload_figure(mid: int, file: UploadFile = File(...), svg: str | None = Form(None), ctx: RequestCtx = Ctx):
        """그림 한 장을 올린다 → {name, ref: "fig:{name}", width, height, size, svg}. 본문에는 화면이 ![캡션](fig:이름)으로 넣는다.
        svg(그림 만들기 — 선택): 화면이 PNG로 그린 원래 SVG. 정화해서 같은 이름 .svg로 둔다(나중에 '이 그림 고치기'의 원본 —
        원고 · 내보내기는 PNG만 씀)"""
        need_manuscript(ctx, mid)
        ensure_space(ctx)  # R2 95% 규칙 (PDF · 원본 올리기와 같게)
        data = file.file.read(figures.MAX_FIGURE_BYTES + 1)
        try:
            info = figures.validate(data)
            source = figgen.sanitize_svg(svg).encode("utf-8") if svg is not None else b""
        except figures.FigureError as e:
            raise HTTPException(400, str(e)) from e
        except figgen.SvgError as e:
            raise HTTPException(400, f"그림 원본(SVG)을 쓸 수 없어요: {e}") from None
        existing = ctx.storage.list_figures(mid)
        if sum(1 for k, _ in existing if not k.endswith(".svg")) >= figures.MAX_FIGURES_PER_MANUSCRIPT:
            raise HTTPException(400, f"원고 하나에 그림은 {figures.MAX_FIGURES_PER_MANUSCRIPT}장까지 넣을 수 있어요")
        if sum(s for _, s in existing) + info["size"] + len(source) > figures.MAX_FIGURE_BYTES_PER_MANUSCRIPT:
            raise HTTPException(400, "이 원고의 그림 용량이 가득 찼어요 (300MB)")
        name = f"{uuid.uuid4().hex[:16]}.{info['ext']}"
        key = ctx.storage.figure_key(mid, name)
        ctx.storage.put(key, data, info["content_type"])
        ctx.on_rollback.append(lambda: ctx.storage.delete_quietly(key))
        if source:
            skey = ctx.storage.figure_svg_key(mid, figures.svg_name(name))
            ctx.storage.put(skey, source, "image/svg+xml")
            ctx.on_rollback.append(lambda: ctx.storage.delete_quietly(skey))
        st.figure_sizes.add(info["size"] + len(source))
        return {"name": name, "ref": f"fig:{name}", "width": info["width"], "height": info["height"],
                "size": info["size"], "svg": bool(source)}

    @app.get("/api/manuscripts/{mid}/figures/{name}/source")
    def get_figure_source(mid: int, name: str, ctx: RequestCtx = Ctx):
        """그림 만들기로 넣은 그림의 SVG 원본 → {"name", "svg"} (JSON 글로만 — SVG 파일로 내려주지 않음). 없으면 404"""
        need_manuscript(ctx, mid)
        if not figures.NAME_RE.fullmatch(name):
            raise HTTPException(404, "그림 원본을 찾을 수 없어요")
        try:
            raw = ctx.storage.get(ctx.storage.figure_svg_key(mid, figures.svg_name(name)))
            svg = figgen.sanitize_svg(raw.decode("utf-8", "replace"))  # 저장할 때 정화했지만 내려줄 때도 한 번 더
        except (NotFound, StorageKeyError, figgen.SvgError):
            raise HTTPException(404, "그림 원본을 찾을 수 없어요") from None
        return JSONResponse({"name": name, "svg": svg}, headers={"Cache-Control": "private, no-store"})

    @app.get("/api/manuscripts/{mid}/figures/{name}")
    def get_figure(mid: int, name: str, ctx: RequestCtx = Ctx):
        need_manuscript(ctx, mid)
        if not figures.NAME_RE.fullmatch(name):
            raise HTTPException(404, "그림을 찾을 수 없어요")
        try:
            data = ctx.storage.get(ctx.storage.figure_key(mid, name))
        except (NotFound, StorageKeyError):
            raise HTTPException(404, "그림을 찾을 수 없어요") from None
        kind = figures.sniff(data)
        if kind is None:  # 올릴 때 검사했지만 내려줄 때도 그림 형식만 (다른 형식으로 해석되지 않게)
            raise HTTPException(404, "그림을 찾을 수 없어요")
        return Response(data, media_type=figures.CONTENT_TYPES[kind],
                        headers={"Content-Disposition": "inline", "Cache-Control": "private, no-store"})

    @app.post("/api/citekeys")
    def lookup_citekeys(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """인용키 → CSL-JSON (내 서재에 없는 키는 null)"""
        keys = [str(k) for k in data.get("keys") or []][:2000]
        found = ctx.lib.papers_by_citekeys(keys)
        return {"items": {k: (citations.to_csl_item(found[k]) if k in found else None) for k in keys},
                "issues": {k: citations.citation_issues(found[k]) for k in found}}

    @app.post("/api/alerts/check")
    def check_alerts(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """새 논문 알림 (2026-10-27): 저장한 관심 검색어 · 저자마다 since 이후 새 논문 (서재에 있는 논문은 뺌).
        since가 없으면 마지막 확인 날짜, 그것도 없으면 30일 전. mark=true면 오늘을 마지막 확인 날짜로 저장"""
        alerts = ctx.settings.get("paper_alerts") or {}
        queries = alerts.get("queries") or []
        since = data.get("since")
        if not (isinstance(since, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", since)):
            since = alerts.get("checked") or (datetime.now().date() - timedelta(days=30)).isoformat()
        if data.get("mark") is True:
            ctx.lib.update_settings({"paper_alerts": {"queries": queries, "checked": datetime.now().date().isoformat()}}, ctx.email)
        ctx.release()
        groups, errors = [], 0
        for q in queries:
            try:
                items = ctx.sources.new_works(q["q"], q["kind"], since)
            except SourceError:
                errors += 1
                items = []
            groups.append({"q": q["q"], "kind": q["kind"], "items": items})
        with db.user_tx(ctx.claims) as lib:  # 서재에 이미 있는 논문은 빼고
            ids = lib.match_library([it for g in groups for it in g["items"]])
        i = 0
        for g in groups:
            keep = []
            for it in g["items"]:
                if not ids[i]:
                    keep.append(it)
                i += 1
            g["items"] = keep
        return {"since": since, "groups": groups, "total": sum(len(g["items"]) for g in groups), "errors": errors}

    # 철회 논문 확인 (2026-10-27): DOI별 결과를 하루 동안 기억 — 점검표를 열 때마다 OpenAlex를 다시 묻지 않게
    retract_cache: dict[str, tuple[bool, float]] = {}
    RETRACT_TTL = 24 * 3600

    @app.post("/api/retractions")
    def check_retractions(data: dict = Body(...), ctx: RequestCtx = Ctx):
        """원고의 인용키 → 철회된 논문 (OpenAlex is_retracted). DOI가 없는 논문은 확인하지 못함(checked에 안 셈)"""
        keys = [str(k)[:200] for k in data.get("keys") or [] if isinstance(k, str)][:500]
        found = ctx.lib.papers_by_citekeys(keys)
        by_doi: dict[str, list[str]] = {}
        for k, p in found.items():
            d = normalize_doi(p.get("doi") or "")
            if d:
                by_doi.setdefault(d, []).append(k)
        ctx.release()  # 외부 조회 동안 DB 연결을 잡지 않는다
        now = time.time()
        ask = [d for d in by_doi if not (d in retract_cache and now - retract_cache[d][1] < RETRACT_TTL)]
        if ask:
            try:
                bad = ctx.sources.retracted_dois(ask)
            except SourceError as e:
                raise HTTPException(502, f"철회 여부를 확인하지 못했어요: {e}") from e
            for d in ask:
                retract_cache[d] = (d in bad, now)
        retracted = [{"key": k, "title": found[k].get("title") or "", "doi": d}
                     for d, ks in by_doi.items() if retract_cache.get(d, (False, 0))[0] for k in ks]
        return {"checked": len(by_doi), "no_doi": len(found) - sum(len(v) for v in by_doi.values()), "retracted": retracted}

    def _file_response(body: bytes, filename: str, fmt: str, stream: bool = False) -> Response:
        types = {"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                 "hwpx": "application/hwp+zip", "md": "text/markdown; charset=utf-8", "pdf": "application/pdf"}
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
        """화면이 서식을 입힌 원고(블록 목록)를 워드·한글·마크다운·PDF 파일로 만든다.
        PDF는 워드 파일을 만든 뒤 서버의 LibreOffice로 바꾼다 (2026-10-27)."""
        fmt = data.get("format")
        blocks = data.get("blocks") or []
        if fmt not in ("docx", "hwpx", "md", "pdf") or not isinstance(blocks, list):
            raise HTTPException(400, "format은 docx, hwpx, md, pdf 중 하나예요")
        if fmt == "pdf" and not convert.available():
            raise HTTPException(503, "서버에 PDF 변환 프로그램(LibreOffice)이 없어요. 워드로 내보낸 뒤 PDF로 저장해 주세요")
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
        if fmt != "md" and any(isinstance(b, dict) and b.get("type") == "figure" for b in blocks):
            # 그림 바이트는 화면이 보내지 않는다 — 이 사용자의 그 원고 그림 폴더에서만 읽는다
            mid = data.get("manuscript_id")
            fig_mid = mid if isinstance(mid, int) and jobs.valid_id(mid) and ctx.lib.get_manuscript(mid) else None

            def load_figure(name: str) -> bytes | None:
                if fig_mid is None:
                    return None
                try:
                    return ctx.storage.get(ctx.storage.figure_key(fig_mid, name))
                except (NotFound, StorageKeyError):
                    return None

            blocks = figures.attach_images(blocks, load_figure)
        # 수정 내용 표시 (2026-10-27): 워드만 변경 내용 추적으로, 그 밖의 형식은 표시 문자를 지움
        redline = fmt == "docx" and data.get("redline") is True
        if not redline:
            blocks = writer.strip_redline(blocks)
        try:
            if fmt in ("docx", "pdf"):
                body = writer.to_docx(blocks, data.get("meta") or {}, fmt_data, cover, warnings)
                if redline:
                    body = writer.redline_docx(body)
            elif fmt == "hwpx":
                body = writer.to_hwpx(blocks, data.get("meta") or {}, fmt_data, cover, warnings)
            else:
                body = writer.to_markdown(blocks).encode("utf-8")
        except (ValueError, KeyError, TypeError) as e:
            raise HTTPException(400, f"문서를 만들지 못했어요: {e}") from e
        if fmt == "pdf":
            try:
                body = convert.to_pdf(body, "manuscript.docx")
            except convert.ConvertError as e:
                raise HTTPException(502, f"PDF로 바꾸지 못했어요: {e}") from e
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
    # 6단계 폴더 동기화 /api/worker/sync/* (기기 토큰 — 요청 하나 = RequestCtx 하나, 같은 업로드 · 첨부 도우미를 씀)
    sync.register(app, st, SimpleNamespace(
        ctx=lambda claims: RequestCtx(st, claims), maintain=maintain, read_incoming=read_incoming,
        attach_from_incoming=attach_from_incoming, pdf_changed=pdf_changed, metadata_from_pdf=metadata_from_pdf,
        sync_budget=sync_budget, db_budget=db_budget, system_sizes=system_sizes, ensure_index=ensure_index,
        allowlist=allowlist, ws=ws,
        trash_papers=trash_papers,
        # 선택 동기화 v2 (selective-sync.md 7.1절): 원본 변환(웹 업로드와 같은 경로) · 끄기 실행
        prepare_upload=prepare_upload, BadPdf=BadPdf, demote_paper=demote_paper))

    # -------------------------------------------------------------- static
    @app.get("/")
    def index():
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-store"})

    # 운영에서는 개발 전용 파일(이메일 로그인 모듈)을 내보내지 않는다 (1단계 운영은 구글 로그인만)
    app.mount("/static", AppStaticFiles(directory=STATIC_DIR, hidden=() if dev else DEV_ONLY_STATIC), name="static")
    return app
