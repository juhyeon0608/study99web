"""서버 설정(환경 변수)과 사용자 설정(profiles.settings + user_secrets)을 다룬다 (명세 8장).

- 서버 설정: 환경 변수만 읽는다. 값은 로그·예외 메시지에 넣지 않고, 빠진 변수는 **이름만** 알린다.
- 사용자 설정: 요청마다 DB의 설정 JSON과 복호화한 비밀값으로 `UserSettings`를 만든다(전역 설정 없음).
"""

from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

ENGINES = ("claude", "codex", "gemini")
JOB_KINDS = ("summary", "chat", "write")
# 2단계 엔진 라우팅 (명세 9.4, 확정 U1: 기본은 모두 claude). ai_engine은 더 이상 쓰지 않는다(읽지도 저장하지도 않음 — AC-31)
DEFAULT_ROUTING = {k: ["claude"] for k in JOB_KINDS}
CLI_MODEL_CHOICES = {"claude": ("default", "opus", "sonnet", "haiku"), "codex": ("default",), "gemini": ("default",)}
AI_KEY_NAMES = ("anthropic_api_key", "openai_api_key", "google_api_key")
LAST_ERROR_KEYS = tuple(f"{k}_last_error" for k in AI_KEY_NAMES)  # 서버만 씀 (PUT으로 못 바꿈 — 7.3절)
_MODEL_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,100}")

DEFAULT_SETTINGS: dict = {
    "ai_routing": DEFAULT_ROUTING,
    "cli_models": {e: "default" for e in ENGINES},
    "api_models": {},  # {"codex": "<OpenAI 모델 id>", "gemini": "<Gemini 모델 id>"} — 비면 ai.API_MODEL_DEFAULTS
    **{k: None for k in LAST_ERROR_KEYS},
    "anthropic_api_key": "",
    "openai_api_key": "",
    "google_api_key": "",
    "model": "claude-opus-5-5",
    "effort": "medium",
    "summary_language": "한국어",
    # OpenAlex/Crossref의 polite pool에 들어가기 위한 연락처 (선택, 비밀 아님)
    "contact_email": "",
    "openalex_api_key": "",
    "semantic_scholar_api_key": "",
    "citation_style": "apa",
    # 인용 문구의 연결어 언어 (en-US: et al., and / ko-KR: 외, 및)
    "citation_locale": "en-US",
    # 참고문헌 목록에서 국문 문헌을 영문 문헌보다 앞에 놓기
    "korean_first": True,
    # 새 원고의 기본 논문 양식 (기본 양식 id 또는 내 양식 'user-{번호}')
    "doc_format_default": "default",
}

SECRET_KEYS = AI_KEY_NAMES + ("openalex_api_key", "semantic_scholar_api_key")
PLAIN_KEYS = tuple(k for k in DEFAULT_SETTINGS if k not in SECRET_KEYS)

DEFAULT_ENV_FILE = Path.home() / ".paperlab" / "cloud.env"
STORAGE_LIMIT_DEFAULT = 10 * 1024 ** 3  # R2 무료 10GB (명세 7.6, 가정)
STORAGE_BACKENDS = ("r2", "supabase", "fake")
R2_VARS = ("R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")


class ConfigError(Exception):
    """설정 오류. 메시지에는 변수 이름만 넣는다(값 없음)."""

    def __init__(self, message: str, names: list[str] | None = None):
        super().__init__(message)
        self.names = names or []


# ------------------------------------------------------------------ 비밀 가리기
_URL_CRED_RE = re.compile(r"(postgres(?:ql)?://)[^@/\s]+@", re.I)
_KV_PASSWORD_RE = re.compile(r"(password\s*=\s*)(\S+)", re.I)
_SIG_RE = re.compile(r"(X-Amz-(?:Signature|Credential|Security-Token)=)[^&\s]+", re.I)
# API 키(Anthropic · OpenAI · Google) · 기기 토큰 (2단계 9.5 · 13.8절). sk-는 실제 키 모양(단어 경계 + 20자 이상)만
_KEY_RES = (re.compile(r"\b(sk-ant-)[A-Za-z0-9_\-]{6,}"), re.compile(r"\b(sk-)[A-Za-z0-9_\-]{20,}"),
            re.compile(r"\b(AIza)[A-Za-z0-9_\-]{6,}"), re.compile(r"\b(pld1\.)[A-Za-z0-9_.\-]{6,}"))


def redact(text: str) -> str:
    """예외 메시지 등에서 접속 문자열의 계정·비밀번호, 서명 주소 서명을 가린다."""
    text = _URL_CRED_RE.sub(r"\1***@", str(text))
    text = _KV_PASSWORD_RE.sub(r"\1***", text)
    text = _SIG_RE.sub(r"\1***", text)
    for rx in _KEY_RES:
        text = rx.sub(r"\1***", text)
    return text


def load_env_file(path: str | Path | None = None, environ: dict | None = None) -> dict:
    """KEY=VALUE 파일을 읽어 환경 변수와 합친 사전을 돌려준다(이미 있는 환경 변수가 우선). 값은 출력하지 않는다."""
    env = dict(os.environ if environ is None else environ)
    p = Path(path) if path else DEFAULT_ENV_FILE
    if not p.exists():
        return env
    for line in p.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[7:].strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        if key and not env.get(key):
            env[key] = value
    return env


def parse_allowed_emails(raw: str) -> frozenset[str]:
    """쉼표 구분 이메일 목록 → 소문자·공백 제거 집합"""
    return frozenset(e.strip().lower() for e in (raw or "").split(",") if e.strip())


def decode_encryption_key(raw: str) -> bytes:
    """APP_ENCRYPTION_KEY(base64) → 32바이트. 틀리면 ConfigError(이름만)."""
    try:
        key = base64.b64decode((raw or "").strip(), validate=True)
    except (ValueError, TypeError):
        raise ConfigError("APP_ENCRYPTION_KEY 형식이 틀렸어요 (32바이트 base64)", ["APP_ENCRYPTION_KEY"]) from None
    if len(key) != 32:
        raise ConfigError("APP_ENCRYPTION_KEY 길이가 틀렸어요 (32바이트 base64)", ["APP_ENCRYPTION_KEY"])
    return key


# 서버 PC cloud.env에 남아 있으면 안 되는 변수 (명세 13.1-2 — 서버 PC에 필요 없음, 최소 권한). 이름만 경고한다
LEFTOVER_VARS = ("SUPABASE_SERVICE_ROLE_KEY", "GCP_PROJECT_ID", "GCP_REGION")
DEFAULT_PORT = 8080


def db_user(conninfo: str) -> str | None:
    """접속 문자열의 사용자 이름. 해석할 수 없으면 None (값은 돌려주지 않는다 — 사용자 이름만)"""
    from psycopg import ProgrammingError
    from psycopg.conninfo import conninfo_to_dict
    try:
        return str(conninfo_to_dict(conninfo).get("user") or "")
    except (ProgrammingError, ValueError, TypeError):
        return None


APP_ROLE_USER_PREFIX = "paperlab_app."  # 공유 풀러의 앱 역할 사용자 이름 paperlab_app.<프로젝트 ref>


def is_app_role_user(user: str | None) -> bool:
    """앱 역할 계정인지. paperlab_app.<ref> 만 받는다 — postgres · supabase_admin 등 다른 계정은 모두 아님 (품질팀 2f)"""
    return bool(user) and user.startswith(APP_ROLE_USER_PREFIX) and len(user) > len(APP_ROLE_USER_PREFIX)


def parse_public_url(raw: str) -> str:
    """PAPERLAB_PUBLIC_URL → 출처(https://호스트[:포트]). https가 아니거나 경로 · 쿼리 · 계정이 있으면 ValueError."""
    from urllib.parse import urlsplit
    raw = (raw or "").strip()
    try:
        u = urlsplit(raw)
        port = u.port
    except ValueError:
        raise ValueError("형식") from None
    if (u.scheme != "https" or not u.hostname or u.username or u.password or u.query or u.fragment
            or u.path not in ("", "/") or u.hostname.endswith(".")):
        raise ValueError("형식")
    return f"https://{u.hostname.lower()}" + (f":{port}" if port and port != 443 else "")


def env_problems(env: dict, *, before_app_role: bool = False) -> dict[str, str]:
    """운영 서버 설정 검사 → {변수 이름: 이유}. 이유 문구에는 값을 넣지 않는다 (명세 8.4 · 9.1, AC-74).

    before_app_role: 설치 중 `admin app-role --write-env` 전이라 SUPABASE_APP_DB_URL이 비어 있는 것은 문제로 보지 않음.
    """
    problems: dict[str, str] = {}

    def val(k: str) -> str:
        return (env.get(k) or "").strip()

    for k in ("SUPABASE_URL", "SUPABASE_ANON_KEY", "APP_ENCRYPTION_KEY", "PAPERLAB_PUBLIC_URL"):
        if not val(k):
            problems[k] = "비어 있음"
    # 서버는 앱 역할 주소만 읽는다. SUPABASE_DB_URL(관리자 주소)로 대신 붙지 않는다 (S1)
    if not val("SUPABASE_APP_DB_URL"):
        if not before_app_role:
            problems["SUPABASE_APP_DB_URL"] = "비어 있음 (admin app-role --write-env 필요)"
    elif not is_app_role_user(db_user(val("SUPABASE_APP_DB_URL"))):
        problems["SUPABASE_APP_DB_URL"] = "사용자 이름이 paperlab_app.<ref>가 아님 — 앱 역할 주소만 쓸 수 있어요"
    if val("APP_ENCRYPTION_KEY"):
        try:
            decode_encryption_key(val("APP_ENCRYPTION_KEY"))
        except ConfigError:
            problems["APP_ENCRYPTION_KEY"] = "32바이트 base64가 아님"
    if val("PAPERLAB_PUBLIC_URL"):
        try:
            parse_public_url(val("PAPERLAB_PUBLIC_URL"))
        except ValueError:
            problems["PAPERLAB_PUBLIC_URL"] = "https://호스트 형식이 아님 (경로 · 쿼리 없이)"
    if val("PAPERLAB_ALLOWLIST").lower() not in ("", "on", "off"):
        problems["PAPERLAB_ALLOWLIST"] = "허용 목록 값 틀림(on/off만)"
    backend = (val("STORAGE_BACKEND") or "r2").lower()
    if backend == "fake":
        # 가짜 저장소는 테스트 · 개발 서버 전용 (승인자 L5)
        problems["STORAGE_BACKEND"] = "fake는 테스트 전용 — 운영에서 쓸 수 없어요"
    elif backend == "supabase":
        # 대안 자리만 있고 1단계에 구현하지 않음 (명세 7.8) — 운영에서 쓸 수 없음 (품질팀 2g)
        problems["STORAGE_BACKEND"] = "supabase는 1단계에 구현하지 않음 — r2만"
    elif backend not in STORAGE_BACKENDS:
        problems["STORAGE_BACKEND"] = "알 수 없는 값 (r2만)"
    elif backend == "r2":
        for k in R2_VARS:
            if not val(k):
                problems[k] = "비어 있음"
    return problems


@dataclass
class ServerConfig:
    """운영 서버 설정 (명세 8.4 — 서버 PC의 cloud.env). 테스트는 SUPABASE_TEST_* 값으로 직접 만들어 주입한다."""

    supabase_url: str
    supabase_anon_key: str
    db_url: str
    encryption_key: bytes
    allowed_emails: frozenset[str]
    jwt_secret: str = ""
    storage_backend: str = "r2"
    r2: dict = field(default_factory=dict)
    storage_limit_bytes: int = STORAGE_LIMIT_DEFAULT
    db_pool_timeout: float = 30.0
    # 공개 주소의 출처 (https://호스트) — Origin · Host 검사 기준 (명세 6.5, 팀장 결정 S2). 비면 다른 출처 요청은 모두 거부
    public_url: str = ""
    # 허용 목록 검사(요청마다 403 not_allowed). PAPERLAB_ALLOWLIST=off일 때만 끈다 — 빈 목록을 "모두 허용"으로 보지 않음
    allowlist_enabled: bool = True
    # 서버가 여는 127.0.0.1 포트 (Host 허용 목록의 127.0.0.1:포트 · localhost:포트)
    local_port: int = DEFAULT_PORT

    @property
    def issuer(self) -> str:
        return self.supabase_url.rstrip("/") + "/auth/v1"

    @property
    def jwks_url(self) -> str:
        return self.issuer + "/.well-known/jwks.json"

    @property
    def public_origin(self) -> str:
        try:
            return parse_public_url(self.public_url) if self.public_url else ""
        except ValueError:
            return ""

    def allowed_hosts(self) -> frozenset[str]:
        """Host 헤더 허용 목록: 공개 호스트(기본 포트 생략 · :443) + 서버 PC 안 상태 확인용 127.0.0.1 · localhost"""
        hosts = {f"127.0.0.1:{self.local_port}", f"localhost:{self.local_port}"}
        origin = self.public_origin
        if origin:
            netloc = origin[len("https://"):]
            hosts.add(netloc)
            if ":" not in netloc:
                hosts.add(netloc + ":443")
        return frozenset(hosts)

    @classmethod
    def from_env(cls, environ: dict | None = None, *, port: int = DEFAULT_PORT) -> "ServerConfig":
        env = dict(os.environ if environ is None else environ)
        problems = env_problems(env)
        if problems:
            names = list(problems)
            raise ConfigError("필요한 환경 변수가 비었거나 형식이 틀렸어요: " + ", ".join(names), names)
        return cls(
            supabase_url=env["SUPABASE_URL"].strip().rstrip("/"),
            supabase_anon_key=env["SUPABASE_ANON_KEY"].strip(),
            db_url=env["SUPABASE_APP_DB_URL"].strip(),
            encryption_key=decode_encryption_key(env["APP_ENCRYPTION_KEY"]),
            allowed_emails=parse_allowed_emails(env.get("ALLOWED_EMAILS", "")),
            jwt_secret=(env.get("SUPABASE_JWT_SECRET") or "").strip(),
            storage_backend=(env.get("STORAGE_BACKEND") or "r2").strip().lower(),
            r2={k: env[k].strip() for k in R2_VARS if env.get(k)},
            public_url=parse_public_url(env["PAPERLAB_PUBLIC_URL"]),
            allowlist_enabled=(env.get("PAPERLAB_ALLOWLIST") or "on").strip().lower() != "off",
            local_port=port,
        )


# ------------------------------------------------------------------ 사용자 설정
class UserSettings:
    """한 사용자의 설정: profiles.settings(평문 키) + 복호화한 비밀값.

    `get(key)`는 지금 `Sources` · `AIService`가 쓰는 콜러블 인터페이스 그대로다.
    """

    def __init__(self, stored: dict | None = None, secrets: dict | None = None,
                 broken_secrets: set | None = None, hints: dict | None = None):
        self._values = dict(DEFAULT_SETTINGS)
        for k, v in (stored or {}).items():
            if k in PLAIN_KEYS:
                self._values[k] = v
        # 저장 형식이 틀린 값(옛 버전 · 손으로 고친 값)은 기본값으로 읽는다
        for k, check in (("ai_routing", normalize_routing), ("cli_models", normalize_cli_models),
                         ("api_models", normalize_api_models)):
            try:
                self._values[k] = check(self._values[k])
            except ValueError:
                self._values[k] = check(DEFAULT_SETTINGS[k])
        for k in SECRET_KEYS:
            self._values[k] = (secrets or {}).get(k) or ""
        self.broken_secrets = set(broken_secrets or ())
        self.hints = dict(hints or {})

    def get(self, key: str):
        return self._values.get(key, DEFAULT_SETTINGS.get(key))

    def all(self) -> dict:
        return dict(self._values)

    def public(self) -> dict:
        """비밀 값은 설정 여부만. 서버 환경 변수 키는 쓰지 않으므로 env_api_key_set은 항상 false.

        `<키>_status`: "set"(저장됨) | "none"(없음) | "unreadable"(저장돼 있지만 복호화 실패 — 키를 잃었거나
        다른 행에서 복사됨 → 화면 "저장된 키를 읽지 못했어요. 키를 다시 입력해 주세요.")
        """
        out = self.all()
        for key in SECRET_KEYS:
            has = bool(out.pop(key))
            out[key + "_set"] = has
            out[key + "_status"] = "set" if has else ("unreadable" if key in self.broken_secrets else "none")
            if key in AI_KEY_NAMES:
                # 끝 4자리 (키 원문은 보내지 않음 — 7.3절, crypto.hint는 12자 미만이면 빈 값)
                out[key + "_hint"] = self.hints.get(key, "") if has else ""
        out["env_api_key_set"] = False
        return out


def normalize_routing(value) -> dict:
    """ai_routing 검사 (9.4절): 알려진 작업 · 엔진만, 중복 없음, 1~3개. 빠진 작업은 기본값. 틀리면 ValueError(→ 400)"""
    if not isinstance(value, dict) or any(k not in JOB_KINDS for k in value):
        raise ValueError("작업별 엔진 설정이 올바르지 않아요")
    out = {}
    for kind in JOB_KINDS:
        order = value.get(kind, DEFAULT_ROUTING[kind])
        if (not isinstance(order, list) or not 1 <= len(order) <= 3 or any(e not in ENGINES for e in order)
                or len(set(order)) != len(order)):
            raise ValueError("작업별 엔진은 claude · codex · gemini 중 1~3개를 겹치지 않게 골라 주세요")
        out[kind] = list(order)
    return out


def normalize_cli_models(value) -> dict:
    if not isinstance(value, dict) or any(k not in ENGINES for k in value):
        raise ValueError("PC 모델 설정이 올바르지 않아요")
    out = {e: str(value.get(e) or "default") for e in ENGINES}
    for e, v in out.items():
        if v not in CLI_MODEL_CHOICES[e]:
            raise ValueError(f"PC의 {e} 모델은 {' · '.join(CLI_MODEL_CHOICES[e])} 중에서 골라 주세요")
    return out


def normalize_api_models(value) -> dict:
    if not isinstance(value, dict) or any(k not in ("codex", "gemini") for k in value):
        raise ValueError("API 모델 설정이 올바르지 않아요")
    out = {}
    for e, v in value.items():
        v = str(v or "").strip()
        if v and not _MODEL_ID_RE.fullmatch(v):
            raise ValueError("API 모델 이름은 영문 · 숫자 · - . _ 만 1~100자로 써 주세요")
        if v:
            out[e] = v
    return out


def split_settings_changes(changes: dict) -> tuple[dict, dict]:
    """PUT /api/settings 본문 → (평문 설정 변경, 비밀 변경 {이름: 값 | None(지우기)}).

    비밀은 빈 문자열이면 "변경 없음", null이면 지우기. ai_engine은 무시(2단계 — 어떤 값이든 400 아님, AC-31).
    *_last_error는 서버만 쓰므로 무시하고, AI 키를 바꾸거나 지우면 그 키의 최근 실패를 지운다(7.3절).
    """
    plain, secrets = {}, {}
    for key, value in (changes or {}).items():
        if key in SECRET_KEYS:
            if value is None:
                secrets[key] = None
            elif value == "":
                continue
            else:
                secrets[key] = str(value).strip()
            if key in AI_KEY_NAMES:
                plain[key + "_last_error"] = None
        elif key in PLAIN_KEYS and key not in LAST_ERROR_KEYS:
            if key == "ai_routing":
                value = normalize_routing(value)
            elif key == "cli_models":
                value = normalize_cli_models(value)
            elif key == "api_models":
                value = normalize_api_models(value)
            plain[key] = value
    return plain, secrets
