"""운영 서버 진입점 (서버 PC — 명세 9.1 · 13.5):

    python -m paperlab.serve [--port 8080] [--env-file …] [--log-dir D:\\PaperLab\\logs] [--check]

- `cloud.env`(기본 %USERPROFILE%\\.paperlab\\cloud.env)를 읽어 설정을 검사한다. 빠지거나 틀린 변수는 **이름만** 남기고
  종료 코드 ≠ 0 (AC-74). 값은 화면 · 로그에 쓰지 않는다. 읽은 값은 이 프로세스의 os.environ에 넣지 않는다
  (하위 프로세스로 새지 않게).
- uvicorn을 **127.0.0.1**에만 연다(0.0.0.0 금지 — 바깥은 Tailscale Funnel로만). 프록시 헤더는 127.0.0.1(그 PC의
  tailscaled)에서 온 것만 믿는다(`forwarded_allow_ips="127.0.0.1"`, `*` 금지).
- 로그: `--log-dir`이 있으면 회전 파일 `server.log`(JSON 한 줄, 10MB × 5개), 없으면 표준 오류.
- `--check`: 서버를 띄우지 않고 빠진 · 틀린 · 지워야 할 변수 **이름**, 앱 역할 주소의 사용자 이름 앞부분, cloud.env 권한만
  출력한다(설치 스크립트 · 안내서 확인용). 문제가 있으면 종료 코드 2.
- DB 연결 풀은 첫 요청 때 연다(지연 연결) — DB가 일시정지여도 /api/health는 응답한다. 마이그레이션은 하지 않는다
  (업데이트 스크립트가 재시작 전에 실행).
"""

from __future__ import annotations

import argparse
import json
import logging
import logging.handlers
import os
import subprocess
import sys
from pathlib import Path

from . import __version__
from .config import (DEFAULT_ENV_FILE, DEFAULT_PORT, LEFTOVER_VARS, ConfigError, ServerConfig, db_user, env_problems,
                     load_env_file, parse_allowed_emails)

HOST = "127.0.0.1"
FORWARDED_ALLOW_IPS = "127.0.0.1"
LOG_MAX_BYTES = 10 * 1024 * 1024  # 명세 9.1 (가정): 10MB × 5개
LOG_BACKUPS = 5
REPO_ROOT = Path(__file__).resolve().parent.parent
# 라이브러리 디버그 로그(요청 주소 · 헤더가 섞일 수 있음)는 끈다
QUIET_LOGGERS = ("httpx", "httpcore", "botocore", "boto3", "urllib3", "psycopg", "anthropic")

log = logging.getLogger("paperlab.serve")


class JsonFormatter(logging.Formatter):
    """JSON 한 줄 로그 (명세 13.5). 메시지가 JSON이면 그 필드를 그대로 쓴다(접근 로그)."""

    def format(self, record: logging.LogRecord) -> str:
        msg = record.getMessage()
        try:
            payload = json.loads(msg) if msg.startswith("{") else {"message": msg}
        except ValueError:
            payload = {"message": msg}
        if not isinstance(payload, dict):
            payload = {"message": msg}
        payload = {"time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"), "level": record.levelname,
                   "logger": record.name, **payload}
        if record.exc_info:
            payload["error"] = record.exc_info[0].__name__ if record.exc_info[0] else "error"
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(log_dir: str | Path | None) -> logging.Handler:
    if log_dir:
        Path(log_dir).mkdir(parents=True, exist_ok=True)
        handler: logging.Handler = logging.handlers.RotatingFileHandler(
            Path(log_dir) / "server.log", maxBytes=LOG_MAX_BYTES, backupCount=LOG_BACKUPS, encoding="utf-8")
    else:
        handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    for name in QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
    return handler


def scrub_ai_environment(environ: dict | None = None) -> list[str]:
    """ANTHROPIC_* 환경 변수를 지운다(서버 계정 환경에 있어도 사용자 요청에 쓰이지 않게 — 승인자 L3). 지운 이름 목록."""
    environ = os.environ if environ is None else environ
    names = [k for k in list(environ) if k.upper().startswith("ANTHROPIC_")]
    for k in names:
        environ.pop(k, None)
    return names


def git_commit(repo: Path = REPO_ROOT) -> str:
    """배포한 커밋 앞 7자리 (git 실행 파일 없이 .git을 읽음). 모르면 ''"""
    try:
        git = repo / ".git"
        if git.is_file():  # 작업 트리: "gitdir: <경로>"
            text = git.read_text(encoding="utf-8").strip()
            if text.startswith("gitdir:"):
                git = (repo / text[7:].strip()).resolve()
        head = (git / "HEAD").read_text(encoding="utf-8").strip()
        if not head.startswith("ref:"):
            return head[:7] if len(head) >= 7 else ""
        ref = head[4:].strip()
        loose = git / ref
        if loose.exists():
            return loose.read_text(encoding="utf-8").strip()[:7]
        packed = git / "packed-refs"
        if packed.exists():
            for line in packed.read_text(encoding="utf-8").splitlines():
                parts = line.split()
                if len(parts) == 2 and parts[1] == ref:
                    return parts[0][:7]
    except OSError:
        pass
    return ""


_ACL_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$ok = @($me, 'S-1-5-18', 'S-1-5-32-544')
$acl = Get-Acl -LiteralPath $env:PAPERLAB_ACL_PATH
$bad = @()
foreach ($a in $acl.Access) {
  try { $sid = $a.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $sid = $a.IdentityReference.Value }
  if ($a.AccessControlType -eq 'Allow' -and $ok -notcontains $sid) { $bad += $a.IdentityReference.Value }
}
if ($acl.AreAccessRulesProtected) { 'protected' } else { 'inherited' }
($bad | Sort-Object -Unique) -join ';'
"""


def env_file_acl_warning(path: Path, runner=subprocess.run) -> str:
    """cloud.env 권한이 서버 사용자 · SYSTEM · Administrators 밖에 열려 있거나 상속 중이면 경고 문구(값 없음). 괜찮으면 ''.

    Windows가 아니거나 확인할 수 없으면 ''(시작은 막지 않음 — 명세 9.1 가정).
    """
    if sys.platform != "win32" or not Path(path).exists():
        return ""
    env = dict(os.environ, PAPERLAB_ACL_PATH=str(path))
    try:
        p = runner(["powershell", "-NoProfile", "-NonInteractive", "-Command", _ACL_SCRIPT], env=env,
                   capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
                   creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if p.returncode != 0:
        return ""
    lines = [ln.strip() for ln in (p.stdout or "").splitlines() if ln.strip()]
    if not lines:
        return ""
    problems = []
    if lines[0] != "protected":
        problems.append("상속이 끊기지 않음")
    if len(lines) > 1 and lines[1]:
        problems.append("다른 계정에 열려 있음: " + lines[1].replace(";", ", "))
    return " · ".join(problems)


def _app_role_user_prefix(env: dict) -> str:
    """SUPABASE_APP_DB_URL 사용자 이름의 앞부분만 (예: 'paperlab_app.*'). 비밀번호 · 호스트 · 프로젝트 ref는 내보내지 않음."""
    raw = (env.get("SUPABASE_APP_DB_URL") or "").strip()
    if not raw:
        return "(비어 있음)"
    user = db_user(raw)
    if user is None:
        return "(해석할 수 없음)"
    if not user:
        return "(사용자 이름 없음)"
    head, dot, _ = user.partition(".")
    return head + (".*" if dot else "")


def _safe_stdio() -> None:
    """작업 스케줄러 · 파이프로 실행될 때 표준 출력 인코딩(cp949 등)에 없는 글자 때문에 죽지 않게"""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass


def check(env: dict, env_file: Path, *, before_app_role: bool = False, out=print,
          acl_check=env_file_acl_warning) -> int:
    """`--check`: 이름 · 상태만 출력. 문제가 있으면 2, 없으면 0 (지울 변수 · 권한은 경고만)."""
    exists = env_file.exists()
    out(f"설정 파일: {env_file} ({'있음' if exists else '없음'})")
    problems = env_problems(env, before_app_role=before_app_role)
    if problems:
        out("빠졌거나 틀린 변수: " + ", ".join(f"{k}({why})" for k, why in problems.items()))
    else:
        out("빠졌거나 틀린 변수: 없음")
    leftovers = [k for k in LEFTOVER_VARS if (env.get(k) or "").strip()]
    out("지워야 할 변수(서버 PC에 필요 없음): " + (", ".join(leftovers) if leftovers else "없음"))
    out(f"SUPABASE_APP_DB_URL 사용자: {_app_role_user_prefix(env)}")
    allow_mode = (env.get("PAPERLAB_ALLOWLIST") or "on").strip().lower()
    allowed = len(parse_allowed_emails(env.get("ALLOWED_EMAILS", "")))
    if allow_mode == "off":
        out("허용 목록: off (Google OAuth 테스트 사용자로 제한)")
    elif allow_mode != "on":
        out("허용 목록: 값 틀림(on/off만) — PAPERLAB_ALLOWLIST")
    elif allowed == 0:
        # 팀장 결정: 시작은 하지만 모든 /api 요청이 403 — 점검에서 분명히 알린다 (품질팀 F1, 종료 코드는 그대로)
        out("경고: 허용 목록: on, 목록 비어 있음 → 모든 로그인 거부 (ALLOWED_EMAILS를 채우거나 PAPERLAB_ALLOWLIST=off)")
    else:
        out(f"허용 목록: on ({allowed}개)")
    out(f"저장소: {(env.get('STORAGE_BACKEND') or 'r2').strip().lower()}")
    out(f"공개 주소: {(env.get('PAPERLAB_PUBLIC_URL') or '').strip() or '(비어 있음)'}")
    warn = acl_check(env_file) if exists else ""
    out("cloud.env 권한: " + (f"경고: {warn}" if warn else "확인함 (또는 확인할 수 없음)"))
    if not exists:
        return 2
    return 2 if problems else 0


def run_server(app, port: int) -> None:
    """uvicorn 실행 (테스트가 인자를 가로챌 수 있게 분리 — AC-74)"""
    import uvicorn
    uvicorn.run(app, host=HOST, port=port, proxy_headers=True, forwarded_allow_ips=FORWARDED_ALLOW_IPS,
                access_log=False, log_config=None, server_header=False)


def main(argv: list[str] | None = None, *, runner=run_server, acl_check=env_file_acl_warning) -> int:
    ap = argparse.ArgumentParser(prog="python -m paperlab.serve", description="PaperLab 운영 서버 (서버 PC)")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--env-file", default=None, help="환경 변수 파일 (기본 %%USERPROFILE%%\\.paperlab\\cloud.env)")
    ap.add_argument("--log-dir", default=None, help="회전 로그 폴더 (예: D:\\PaperLab\\logs). 없으면 표준 오류")
    ap.add_argument("--check", action="store_true", help="서버를 띄우지 않고 설정 점검(변수 이름만 출력)")
    ap.add_argument("--before-app-role", action="store_true",
                    help="--check와 함께: SUPABASE_APP_DB_URL이 아직 없는 것은 문제로 보지 않음(설치 중)")
    ap.add_argument("--diag-hang-file", default=None,
                    help="진단용: 이 파일이 있으면 /api/health가 응답하지 않는 것처럼 멈춤 (감시 작업 검사 — AC-77)")
    ap.add_argument("--version", action="version", version=f"PaperLab {__version__}")
    args = ap.parse_args(argv)
    if not 1 <= args.port <= 65535:
        ap.error("--port 범위")

    _safe_stdio()
    scrubbed = scrub_ai_environment()
    env_file = Path(args.env_file) if args.env_file else DEFAULT_ENV_FILE
    env = load_env_file(env_file)
    if args.check:
        return check(env, env_file, before_app_role=args.before_app_role, acl_check=acl_check)

    setup_logging(args.log_dir)
    if scrubbed:
        log.warning(json.dumps({"message": "서버 환경의 ANTHROPIC_* 변수를 지웠어요 (사용자 키만 씀)",
                                "variables": scrubbed}, ensure_ascii=False))
    if not env_file.exists():
        log.error(json.dumps({"message": "설정 파일이 없어 시작하지 않아요", "path": str(env_file)}, ensure_ascii=False))
        return 1
    try:
        config = ServerConfig.from_env(env, port=args.port)
    except ConfigError as e:
        log.error(json.dumps({"message": "환경 변수 설정 오류로 시작하지 않아요", "variables": e.names},
                             ensure_ascii=False))
        return 1
    warn = acl_check(env_file)
    if warn:
        log.warning(json.dumps({"message": "cloud.env 권한 경고", "detail": warn}, ensure_ascii=False))

    from .server import create_app
    from .storage import StorageError
    commit = git_commit()
    hang_file = Path(args.diag_hang_file) if args.diag_hang_file else None
    try:
        app = create_app(config, commit=commit,
                         diag_hang=(lambda: hang_file.exists()) if hang_file else None)
    except (ConfigError, StorageError) as e:
        log.error(json.dumps({"message": "서버를 만들지 못했어요", "variables": getattr(e, "names", [])},
                             ensure_ascii=False))
        return 1
    log.info(json.dumps({"message": "서버 시작", "version": __version__, "commit": commit, "host": HOST,
                         "port": args.port, "storage": config.storage_backend,
                         "allowlist": "on" if config.allowlist_enabled else "off"}, ensure_ascii=False))
    runner(app, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
