r"""관리 명령 (명세 6.3 · 8.3 · 7.4 · 13.3 · 10.2). 서버가 아니라 서버 PC(설치 · 업데이트 스크립트 · 작업 스케줄러) ·
관리자 PC에서 돈다.

    python -m paperlab.admin sync-allowlist                 ALLOWED_EMAILS → paperlab.allowed_emails     reason=allowlist sync
    python -m paperlab.admin app-role --write-env [--if-missing]
                                                            앱 역할 비밀번호 회전 → cloud.env의 SUPABASE_APP_DB_URL 줄
                                                                                                         reason=app role password
    python -m paperlab.admin rotate-key                     user_secrets 재암호화(옛 키는 표준 입력)     reason=encryption key rotation
    python -m paperlab.admin orphans [--delete]             DB에 없는 R2 PDF 찾기/지우기                 reason=orphan scan
    python -m paperlab.admin backup [--tmp-dir D:\PaperLab\tmp]
                                                            pg_dump → R2 backups/db/, 14세대 보관        reason=backup
    python -m paperlab.admin pg-dump-check                  pg_dump 주 버전 ≥ DB 서버 주 버전(앱 역할 주소로 버전만)
    python -m paperlab.admin latest-backup [--max-hours 36] R2의 가장 최근 백업 날짜(감시 작업)
    python -m paperlab.admin mark-test-project              테스트 프로젝트 표지 붙이기                  reason=mark test project
    python -m paperlab.admin cache-stats                    인용 그래프 공용 캐시 크기 · 행 수(내용은 출력 안 함)
                                                                                                         reason=citation cache stats
    python -m paperlab.admin cache-prune [--max-mb 150]     공용 캐시를 상한 아래로(오래된 서지부터)       reason=citation cache prune

공통 인자: --env-file(기본 %USERPROFILE%\.paperlab\cloud.env), --log-file(회전 로그, 예: D:\PaperLab\logs\backup.log).
관리자 연결은 cloud.env의 SUPABASE_DB_URL(관리자 postgres 주소), 백업 · 버전 확인은 SUPABASE_APP_DB_URL(앱 역할 주소)이다.
값(주소 · 비밀번호 · 키)은 화면 · 로그에 찍지 않는다.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import logging
import logging.handlers
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from .config import (DEFAULT_ENV_FILE, R2_VARS, ConfigError, db_user, decode_encryption_key, is_app_role_user,
                     load_env_file, parse_allowed_emails, redact)
from .crypto import DecryptError, SecretBox, key_id
from .storage import Storage, backup_key, create_storage

log = logging.getLogger("paperlab.admin")

BACKUP_KEEP = 14  # 매일 백업 · 최근 14개 보관 (사용자 결정 — 명세 13.3의 주 1회 · 8세대에서 바뀜)
APP_ROLE = "paperlab_app"
APP_DB_VAR = "SUPABASE_APP_DB_URL"  # 팀장 결정 S1
KST = timezone(timedelta(hours=9))
_PAPER_KEY_RE = re.compile(r"users/[0-9a-f-]{36}/papers/\d+\.pdf")
_BACKUP_RE = re.compile(r"backups/db/\d{8}\.dump")


class AdminError(Exception):
    pass


def _connect(conninfo: str) -> psycopg.Connection:
    try:
        return psycopg.connect(conninfo, autocommit=True, prepare_threshold=None, connect_timeout=15)
    except psycopg.Error as e:
        raise AdminError("DB에 연결하지 못했어요: " + redact(str(e))) from None


# ---------------------------------------------------------------- 식별 도우미
def project_ref(supabase_url: str) -> str:
    """https://<ref>.supabase.co → <ref>"""
    host = urlsplit((supabase_url or "").strip()).hostname or ""
    return host.split(".")[0] if host.endswith(".supabase.co") else host


def db_identity(conninfo: str) -> tuple[str, str]:
    """(호스트, 사용자). 공유 풀러는 호스트가 같고 사용자 이름에 프로젝트 ref가 들어 있다(postgres.<ref>)."""
    if not conninfo:
        return ("", "")
    try:
        d = conninfo_to_dict(conninfo)
    except psycopg.ProgrammingError:
        return ("", "")
    return (str(d.get("host") or "").lower(), str(d.get("user") or "").lower())


def app_role_user_for(admin_conninfo: str) -> str:
    """관리자 주소(공유 풀러 postgres.<ref>) → 앱 역할 사용자 이름 paperlab_app.<ref>.

    서버 규칙(config.is_app_role_user)과 같게, ref가 없는 직접 연결 주소(postgres) · 다른 계정은 명확한 오류로 거부한다
    (품질팀 M2). 비밀번호를 바꾸기 **전에** 부른다."""
    try:
        user = str(conninfo_to_dict(admin_conninfo).get("user") or "")
    except psycopg.ProgrammingError:
        raise AdminError("SUPABASE_DB_URL 형식을 해석하지 못했어요") from None
    ref = user[len("postgres."):] if user.startswith("postgres.") else ""
    if not ref:
        raise AdminError("SUPABASE_DB_URL 사용자 이름이 postgres.<프로젝트 ref>(Session pooler)가 아니에요 — "
                         "직접 연결 주소는 쓸 수 없어요. 대시보드 Connect → Session pooler 주소로 바꿔 주세요")
    return f"{APP_ROLE}.{ref}"


def app_conninfo(admin_conninfo: str, password: str) -> str:
    """관리자 주소에서 사용자 · 비밀번호만 앱 역할로 바꾼 주소 (postgres.<ref> → paperlab_app.<ref>)"""
    d = conninfo_to_dict(admin_conninfo)
    d["user"] = app_role_user_for(admin_conninfo)
    d["password"] = password
    if admin_conninfo.startswith(("postgres://", "postgresql://")):
        parts = urlsplit(admin_conninfo)
        netloc = f"{quote(d['user'], safe='')}:{quote(password, safe='')}@{parts.hostname}"
        if parts.port:
            netloc += f":{parts.port}"
        return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    return make_conninfo(**d)


# ---------------------------------------------------------------- 명령 본체
def sync_allowlist(conninfo: str, emails) -> list[str]:
    """allowed_emails를 목록과 똑같이 맞춘다(소문자 · 공백 제거). 결과 목록을 돌려준다(로그에는 개수만)."""
    wanted = sorted(parse_allowed_emails(",".join(emails) if not isinstance(emails, str) else emails))
    log.info("admin reason=allowlist sync count=%d", len(wanted))
    with _connect(conninfo) as conn, conn.transaction():
        conn.execute("delete from paperlab.allowed_emails where not (email = any(%s))", (wanted,))
        for e in wanted:
            conn.execute("insert into paperlab.allowed_emails (email) values (%s) on conflict do nothing", (e,))
        return [r[0] for r in conn.execute("select email from paperlab.allowed_emails order by email")]


def set_app_role_password(admin_conninfo: str, password: str | None = None) -> str:
    """paperlab_app에 무작위 비밀번호 + LOGIN을 주고 앱 연결 주소를 돌려준다(메모리로만).

    **명시적 회전 전용**(`admin app-role --write-env`). 설치 · 업데이트 · 테스트마다 부르지 않는다(팀장 결정, M3 변경) —
    바꾸는 순간 옛 비밀번호로 붙어 있던 서버는 새 연결을 못 연다. 회전 뒤에는 곧바로 서버를 다시 시작한다.
    """
    app_role_user_for(admin_conninfo)  # 직접 연결 주소면 비밀번호를 바꾸기 전에 거부
    log.info("admin reason=app role password")
    password = password or secrets.token_urlsafe(32)
    with _connect(admin_conninfo) as conn:
        conn.execute(sql.SQL("alter role {} with login noinherit nobypassrls password {}").format(
            sql.Identifier(APP_ROLE), sql.Literal(password)))
    return app_conninfo(admin_conninfo, password)


TEST_ROLE_LOCK = 7_301_002
TEST_SECRET_NAME = "app_role_password"


def _app_login_ok(conninfo: str) -> bool:
    """저장된 비밀번호로 로그인되는지. 비밀번호 오류만 False, 다른 접속 문제는 오류(바꾸지 않음)."""
    try:
        with psycopg.connect(conninfo, autocommit=True, prepare_threshold=None, connect_timeout=15) as c:
            c.execute("select 1")
        return True
    except psycopg.OperationalError as e:
        if "password authentication failed" in str(e):
            return False
        raise AdminError("앱 역할로 접속하지 못했어요: " + redact(str(e))[:300]) from None


def test_app_role_conninfo(test_admin_conninfo: str) -> str:
    """**테스트 프로젝트 전용**: 앱 역할 주소를 돌려준다. 비밀번호는 매번 바꾸지 않고 재사용한다(품질팀 F1).

    보관: 테스트 프로젝트 DB의 `public.paperlab_test_secrets`(RLS 켜고 정책 없음, anon · authenticated · service_role
    권한 회수 → 관리자 postgres 연결만 읽음). 테스트 프로젝트에만 있고 운영 비밀과 무관하다.
    처음이거나 저장된 비밀번호로 로그인이 안 될 때만(누가 바꿈) 새로 만들어 저장한다 — advisory lock으로
    동시에 여러 pytest가 시작해도 한 곳만 바꾸고 나머지는 같은 값을 읽는다. 표지가 없는 DB(운영)는 거부.
    """
    with _connect(test_admin_conninfo) as conn:
        marked = conn.execute("select to_regclass('public.paperlab_test_project') is not null").fetchone()[0]
        if not marked:
            raise AdminError("테스트 프로젝트 표지가 없는 DB예요. 앱 역할 비밀번호를 다루지 않습니다.")
        with conn.transaction():
            conn.execute("select pg_advisory_xact_lock(%s)", (TEST_ROLE_LOCK,))
            conn.execute("create table if not exists public.paperlab_test_secrets ("
                         "name text primary key, value text not null, updated_at timestamptz not null default now())")
            conn.execute("alter table public.paperlab_test_secrets enable row level security")
            conn.execute("revoke all on public.paperlab_test_secrets from anon, authenticated, service_role")
            row = conn.execute("select value from public.paperlab_test_secrets where name = %s",
                               (TEST_SECRET_NAME,)).fetchone()
            if row:
                url = app_conninfo(test_admin_conninfo, row[0])
                if _app_login_ok(url):
                    return url
            log.info("admin reason=app role password (test project)")
            password = secrets.token_urlsafe(32)
            conn.execute(sql.SQL("alter role {} with login noinherit nobypassrls password {}").format(
                sql.Identifier(APP_ROLE), sql.Literal(password)))
            conn.execute("insert into public.paperlab_test_secrets (name, value) values (%s, %s) "
                         "on conflict (name) do update set value = excluded.value, updated_at = now()",
                         (TEST_SECRET_NAME, password))
            return app_conninfo(test_admin_conninfo, password)


test_app_role_conninfo.__test__ = False  # pytest가 테스트로 모으지 않게


def rotate_keys(conninfo: str, new_key: bytes, old_keys: list[bytes]) -> int:
    """모든 user_secrets 행을 새 키로 다시 암호화한다. 바꾼 행 수."""
    log.info("admin reason=encryption key rotation")
    box = SecretBox(new_key, *old_keys)
    n = 0
    with _connect(conninfo) as conn, conn.transaction():
        rows = conn.execute("select user_id, name, ciphertext, nonce, key_id from paperlab.user_secrets "
                            "for update").fetchall()
        skipped = 0
        for uid, name, ct, nonce, kid in rows:
            if kid == box.current_id:
                continue
            try:
                sealed = box.reencrypt(str(uid), name, ct, nonce, kid)
            except DecryptError:
                # 옛 키로도 풀리지 않는 행(손상 · 다른 행에서 복사): 그대로 두고 개수만 알린다 → 사용자가 다시 입력
                skipped += 1
                continue
            conn.execute("update paperlab.user_secrets set ciphertext = %s, nonce = %s, key_id = %s, updated_at = now() "
                         "where user_id = %s and name = %s", (sealed.ciphertext, sealed.nonce, sealed.key_id, uid, name))
            n += 1
    if skipped:
        log.warning("rotate-key skipped %d undecryptable rows", skipped)
    return n


def find_orphans(conninfo: str, storage: Storage, delete: bool = False) -> dict:
    """DB 행이 없는 users/*/papers/*.pdf (incoming/은 수명 주기 규칙이 처리, backups/는 건드리지 않음)."""
    log.info("admin reason=orphan scan delete=%s", delete)
    with _connect(conninfo) as conn:
        known = {r[0] for r in conn.execute("select pdf_key from paperlab.papers where pdf_key <> ''")}
        db_total = conn.execute("select coalesce(sum(pdf_size), 0) from paperlab.papers where pdf_key <> ''").fetchone()[0]
    objects = storage.list_prefix("users/")
    orphans = [(k, s) for k, s in objects if _PAPER_KEY_RE.fullmatch(k) and k not in known]
    if delete:
        for k, _ in orphans:
            storage.delete(k)
    incoming = storage.list_prefix("incoming/")
    return {"orphans": [k for k, _ in orphans], "orphan_bytes": sum(s for _, s in orphans),
            "storage_bytes": sum(s for _, s in objects), "db_bytes": int(db_total),
            "incoming_count": len(incoming), "deleted": len(orphans) if delete else 0}


def find_pg_dump(env: dict) -> str:
    """pg_dump 실행 파일: PAPERLAB_PG_DUMP(선택) → 없으면 PATH (팀장 결정 S9 — 경로를 코드에 박지 않음)"""
    configured = (env.get("PAPERLAB_PG_DUMP") or "").strip().strip('"')
    if configured:
        if Path(configured).is_file():
            return configured
        raise AdminError("pg_dump를 찾지 못했어요 (PAPERLAB_PG_DUMP 경로에 파일이 없어요)")
    found = shutil.which("pg_dump")
    if not found:
        raise AdminError("pg_dump를 찾지 못했어요 (PATH에 PostgreSQL 클라이언트를 넣거나 cloud.env에 PAPERLAB_PG_DUMP)")
    return found


def pg_dump_to_file(conninfo: str, path: Path, pg_dump: str = "pg_dump") -> None:
    """pg_dump --format=custom --schema=paperlab --role=service_role. 비밀번호는 명령줄이 아니라 환경 변수로."""
    d = conninfo_to_dict(conninfo)
    env = dict(os.environ)
    for key, var in (("host", "PGHOST"), ("port", "PGPORT"), ("user", "PGUSER"), ("password", "PGPASSWORD"),
                     ("dbname", "PGDATABASE"), ("sslmode", "PGSSLMODE")):
        if d.get(key):
            env[var] = str(d[key])
    env.setdefault("PGSSLMODE", "require")
    cmd = [pg_dump, "--format=custom", "--schema=paperlab", "--role=service_role", "--no-owner",
           "--no-privileges", f"--file={path}"]
    try:
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
                              timeout=1800, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except FileNotFoundError:
        raise AdminError("pg_dump를 찾지 못했어요 (PATH 또는 PAPERLAB_PG_DUMP)") from None
    except subprocess.TimeoutExpired:
        raise AdminError("pg_dump가 30분 안에 끝나지 않았어요") from None
    if proc.returncode != 0:
        raise AdminError("pg_dump 실패: " + redact(proc.stderr.strip())[:500])


def run_backup(conninfo: str, storage: Storage, keep: int = BACKUP_KEEP, today: str | None = None,
               dump: Callable[[str, Path], None] | None = None, tmp_dir: str | Path | None = None,
               pg_dump: str = "pg_dump") -> dict:
    """덤프를 R2 backups/db/{YYYYMMDD}.dump에 올리고 오래된 것부터 지워 keep개만 남긴다.

    덤프 파일은 tmp_dir(서버 PC: 권한을 제한한 D:\\PaperLab\\tmp) 아래 임시 폴더에 만들고, 올린 뒤 **성공 · 실패 모두**
    지운다 — 로컬 사본을 남기지 않는다(명세 13.3, AC-71). tmp_dir이 없으면 시스템 임시 폴더.
    """
    log.info("admin reason=backup")
    # 파일 이름 날짜는 한국 시간 (매일 04:00 KST 실행 — UTC로 쓰면 전날 날짜가 됨). 같은 날 다시 돌리면 그날 파일을 덮어쓴다
    day = today or datetime.now(KST).strftime("%Y%m%d")
    key = backup_key(day)
    if dump is None:
        def dump(c: str, p: Path) -> None:
            pg_dump_to_file(c, p, pg_dump)
    if tmp_dir is not None:
        Path(tmp_dir).mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="paperlab-backup-", dir=tmp_dir) as tmp:
        path = Path(tmp) / f"{day}.dump"
        dump(conninfo, path)
        data = path.read_bytes() if path.exists() else b""
    if not data:
        raise AdminError("덤프 파일이 비어 있어요")
    storage.put(key, data, "application/octet-stream")
    existing = sorted(k for k, _ in storage.list_prefix("backups/db/") if _BACKUP_RE.fullmatch(k))
    removed = existing[:max(0, len(existing) - keep)]
    for k in removed:
        storage.delete(k)
    return {"key": key, "bytes": len(data), "removed": removed, "kept": len(existing) - len(removed)}


def latest_backup(storage: Storage, now: datetime | None = None) -> tuple[str, float | None]:
    """(가장 최근 백업 날짜 YYYYMMDD, 그 파일을 올린 뒤 지난 시간). 없으면 ('', None). 감시 작업이 쓴다(13.5절)."""
    days = sorted(k[len("backups/db/"):-len(".dump")] for k, _ in storage.list_prefix("backups/db/")
                  if _BACKUP_RE.fullmatch(k))
    if not days:
        return "", None
    day = days[-1]
    # 실제로 올린 시각(R2 LastModified) 기준. 파일 이름 날짜의 04:00 KST로 세면 낮에 손으로 만든 백업이
    # "12시간 전"처럼 보인다. 목록과 조회 사이에 지워졌으면 예전처럼 04:00 KST로 센다
    made = storage.modified(backup_key(day)) or datetime.strptime(day, "%Y%m%d").replace(hour=4, tzinfo=KST)
    hours = max(0.0, ((now or datetime.now(KST)) - made).total_seconds() / 3600)
    return day, hours


def pg_major(text: str) -> int | None:
    """'pg_dump (PostgreSQL) 17.10' → 17"""
    m = re.search(r"(\d+)(?:\.\d+)?", text or "")
    return int(m.group(1)) if m else None


def pg_dump_version_check(conninfo: str, pg_dump: str) -> tuple[int | None, int]:
    """(pg_dump 주 버전, DB 서버 주 버전). 앱 역할 주소로 서버 버전만 읽는다(표를 읽지 않음)."""
    try:
        p = subprocess.run([pg_dump, "--version"], capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=60, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.TimeoutExpired):
        raise AdminError("pg_dump를 실행하지 못했어요") from None
    with _connect(conninfo) as conn:
        server = int(conn.execute("select current_setting('server_version_num')::int / 10000").fetchone()[0])
    return pg_major(p.stdout), server


# ---------------------------------------------------------------- cloud.env 한 줄 바꿔 쓰기 (S1)
_UTF8_BOM = b"\xef\xbb\xbf"


def replace_env_line(text: str, name: str, value: str) -> str:
    """`NAME=…` 줄(들)만 `NAME=value`로 바꾼다. 다른 줄 · 주석 · 순서 · 줄 끝 모양은 그대로. 없으면 끝에 한 줄 붙인다."""
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", name) or "\n" in value or "\r" in value:
        raise AdminError("변수 이름이나 값 형식이 틀렸어요")
    pattern = re.compile(rf"^\s*(?:export\s+)?{re.escape(name)}\s*=")
    newline = "\r\n" if "\r\n" in text else "\n"
    lines = text.splitlines(keepends=True)
    found = False
    for i, line in enumerate(lines):
        if pattern.match(line):
            body = line.rstrip("\r\n")
            lines[i] = f"{name}={value}" + line[len(body):]
            found = True
    if not found:
        if lines and not lines[-1].endswith(("\n", "\r")):
            lines[-1] += newline
        lines.append(f"{name}={value}{newline}")
    return "".join(lines)


def _replace_file(tmp: Path, target: Path) -> None:
    """tmp로 target을 바꿔치기. Windows는 ReplaceFileW(원래 파일의 권한(ACL) · 속성 유지), 그 밖은 권한 비트를 복사 후 교체."""
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes
        fn = ctypes.WinDLL("kernel32", use_last_error=True).ReplaceFileW
        fn.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, wintypes.LPVOID,
                       wintypes.LPVOID]
        fn.restype = wintypes.BOOL
        if not fn(str(target), str(tmp), None, 0, None, None):
            raise OSError(ctypes.get_last_error() or "ReplaceFileW failed")
        return
    shutil.copymode(target, tmp)
    os.replace(tmp, target)


def write_env_var(path: str | Path, name: str, value: str) -> None:
    """cloud.env의 한 변수만 바꿔 쓴다: 같은 폴더 임시 파일에 쓰고 바꿔치기(권한 유지). 값은 출력하지 않는다."""
    target = Path(path)
    if not target.is_file():
        raise AdminError(f"설정 파일이 없어요: {target}")
    raw = target.read_bytes()
    bom = raw.startswith(_UTF8_BOM)
    text = raw[len(_UTF8_BOM):].decode("utf-8") if bom else raw.decode("utf-8")
    data = (_UTF8_BOM if bom else b"") + replace_env_line(text, name, value).encode("utf-8")
    fd, tmp_name = tempfile.mkstemp(prefix=".cloud.env.", suffix=".tmp", dir=target.parent)
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        _replace_file(tmp, target)
    finally:
        if tmp.exists():
            tmp.unlink()


def app_role_write_env(admin_conninfo: str, env_file: str | Path, *, if_missing: bool = False,
                       set_password: Callable[[str, str], str] | None = None) -> str:
    """앱 역할 비밀번호를 새로 만들고 `SUPABASE_APP_DB_URL` 줄에 앱 주소를 쓴다 (명세 13.1-5-5, 팀장 결정 S1).

    - if_missing: 파일에 그 값이 이미 있으면 아무것도 하지 않음("skipped") — 설치 스크립트용(M3: 명시적일 때만 회전).
    - 순서: 파일 확인 → DB 비밀번호 변경 → 파일 바꿔치기. 값(주소 · 비밀번호)은 돌려주지도 출력하지도 않는다.
    - set_password: 테스트에서 가짜 DB 함수를 넣을 때 (admin_conninfo, password) → 앱 주소.
    """
    target = Path(env_file)
    if not target.is_file():
        raise AdminError(f"설정 파일이 없어요: {target}")
    if if_missing and (load_env_file(target, environ={}).get(APP_DB_VAR) or "").strip():
        return "skipped"
    app_role_user_for(admin_conninfo)  # 직접 연결 주소면 DB를 건드리기 전에 거부 (품질팀 M2)
    password = secrets.token_urlsafe(32)
    url = (set_password or set_app_role_password)(admin_conninfo, password)
    try:
        write_env_var(target, APP_DB_VAR, url)
    except (OSError, AdminError) as e:
        raise AdminError("앱 역할 비밀번호는 바뀌었지만 설정 파일에 쓰지 못했어요. 이 명령을 다시 실행해 주세요 "
                         f"({type(e).__name__})") from None
    return "written"


def mark_test_project(test_conninfo: str, test_url: str, prod_url: str = "", prod_conninfo: str = "",
                      confirm: Callable[[str], str] = input) -> str:
    """테스트 프로젝트 표지(public.paperlab_test_project)를 만든다. 운영과 같으면 거부, 사람이 ref를 직접 입력해 확인."""
    ref = project_ref(test_url)
    if not ref:
        raise AdminError("SUPABASE_TEST_URL에서 프로젝트 ref를 찾지 못했어요")
    if prod_url and project_ref(prod_url) == ref:
        raise AdminError("대상이 운영 프로젝트(SUPABASE_URL)와 같아요. 거부합니다.")
    if prod_conninfo and db_identity(prod_conninfo) == db_identity(test_conninfo):
        raise AdminError("대상 DB가 운영 DB(SUPABASE_DB_URL)와 같아요. 거부합니다.")
    if ref not in db_identity(test_conninfo)[1] and ref not in db_identity(test_conninfo)[0]:
        raise AdminError("SUPABASE_TEST_DB_URL이 SUPABASE_TEST_URL의 프로젝트를 가리키지 않아요")
    typed = confirm(f"테스트 프로젝트 ref를 직접 입력해 확인해 주세요 ({ref[:4]}…): ").strip()
    if typed != ref:
        raise AdminError("입력한 ref가 맞지 않아요. 아무것도 바꾸지 않았어요.")
    log.info("admin reason=mark test project")
    with _connect(test_conninfo) as conn, conn.transaction():
        conn.execute("create table if not exists public.paperlab_test_project (ref text primary key)")
        conn.execute("alter table public.paperlab_test_project enable row level security")
        conn.execute("revoke all on public.paperlab_test_project from anon, authenticated")
        conn.execute("insert into public.paperlab_test_project (ref) values (%s) on conflict do nothing", (ref,))
    return ref


# ---------------------------------------------------------------- 인용 그래프 공용 캐시 (citation-graph 명세 8.5절)
_CACHE_LIVE = ("select (select coalesce(sum(pg_column_size(w.*)), 0) from paperlab.external_works w)"
               " + (select coalesce(sum(pg_column_size(e.*)), 0) from paperlab.citation_edges e)")


def cache_stats(conninfo: str) -> dict:
    """두 표의 크기 · 행 수 · 가장 오래된 날짜만 (번호 · 제목 등 내용은 돌려주지 않음)"""
    log.info("admin reason=citation cache stats")
    with _connect(conninfo) as conn:
        r = conn.execute(
            "select (select count(*) from paperlab.external_works), (select count(*) from paperlab.citation_edges), "
            "pg_total_relation_size('paperlab.external_works'), pg_total_relation_size('paperlab.citation_edges'), "
            "(select min(meta_on) from paperlab.external_works), (select min(fetched_on) from paperlab.citation_edges), "
            f"({_CACHE_LIVE})").fetchone()
    return {"works": int(r[0]), "edges": int(r[1]), "works_bytes": int(r[2]), "edges_bytes": int(r[3]),
            "disk_bytes": int(r[2]) + int(r[3]), "live_bytes": int(r[6]),
            "oldest_meta_on": r[4].isoformat() if r[4] else "", "oldest_fetched_on": r[5].isoformat() if r[5] else ""}


def cache_prune(conninfo: str, max_mb: float) -> dict:
    """살아 있는 행 크기(pg_column_size 합)가 max_mb 아래가 될 때까지 서지를 받은 날(meta_on)이 오래된 작품부터,
    그 작품의 citation_edges 행과 함께 지운다. 지운 공간은 자동 정리(autovacuum)가 다시 쓴다.
    지워도 다음에 필요하면 다시 받으므로 데이터 손실은 아니다."""
    if max_mb < 0:
        raise AdminError("--max-mb 는 0 이상이어야 해요")
    limit = int(max_mb * 1024 * 1024)
    log.info("admin reason=citation cache prune")
    with _connect(conninfo) as conn, conn.transaction():
        live = int(conn.execute(_CACHE_LIVE).fetchone()[0])
        if live <= limit:
            return {"deleted_works": 0, "deleted_edges": 0, "live_before": live, "live_after": live}
        rows = conn.execute(
            "select w.openalex_no, pg_column_size(w.*) + coalesce((select sum(pg_column_size(e.*)) "
            "from paperlab.citation_edges e where e.work_no = w.openalex_no), 0) "
            "from paperlab.external_works w order by w.meta_on, w.openalex_no").fetchall()
        excess, picked = live - limit, []
        for no, size in rows:
            if excess <= 0:
                break
            picked.append(no)
            excess -= int(size)
        n_edges = conn.execute("delete from paperlab.citation_edges where work_no = any(%s)", (picked,)).rowcount
        n_works = conn.execute("delete from paperlab.external_works where openalex_no = any(%s)", (picked,)).rowcount
        after = int(conn.execute(_CACHE_LIVE).fetchone()[0])
    return {"deleted_works": n_works, "deleted_edges": n_edges, "live_before": live, "live_after": after}


def refuse_test_project(conninfo: str) -> None:
    """운영용 관리 명령: 테스트 표지가 있는 DB면 거부 (운영 보호 장치 3번)"""
    with _connect(conninfo) as conn:
        marked = conn.execute("select to_regclass('public.paperlab_test_project') is not null").fetchone()[0]
    if marked:
        raise AdminError("이 DB에는 테스트 프로젝트 표지가 있어요. 운영 명령을 거부합니다.")




# ---------------------------------------------------------------- CLI
def _setup_logging(log_file: str | None) -> None:
    """--log-file: 회전 파일(1MB × 5개 — 명세 13.3 가정). 작업 스케줄러에서 돌 때 backup.log로."""
    root = logging.getLogger()
    if log_file:
        Path(log_file).parent.mkdir(parents=True, exist_ok=True)
        handler: logging.Handler = logging.handlers.RotatingFileHandler(log_file, maxBytes=1024 * 1024,
                                                                         backupCount=5, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    else:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s %(message)s"))
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    for name in ("httpx", "httpcore", "botocore", "boto3", "urllib3", "psycopg"):
        logging.getLogger(name).setLevel(logging.WARNING)


def _storage_from_env(env: dict) -> Storage:
    backend = (env.get("STORAGE_BACKEND") or "r2").strip().lower()
    if backend == "fake":
        # 가짜 저장소는 테스트 전용 — 운영 명령에서 쓰면 백업이 메모리로 사라진다 (승인자 L5)
        raise AdminError("STORAGE_BACKEND=fake 는 테스트 전용이라 운영 명령에서 쓸 수 없어요")
    return create_storage(backend, {k: env.get(k, "") for k in R2_VARS})


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m paperlab.admin")
    ap.add_argument("--env-file", default=None, help="환경 변수 파일 (기본 ~/.paperlab/cloud.env, 환경 변수가 우선)")
    ap.add_argument("--log-file", default=None, help="회전 로그 파일 (예: D:\\PaperLab\\logs\\backup.log)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync-allowlist")
    p = sub.add_parser("app-role", help="앱 역할 비밀번호 명시적 회전 → cloud.env의 SUPABASE_APP_DB_URL")
    p.add_argument("--write-env", action="store_true", help="결과 주소를 --env-file(기본 cloud.env)에 씀 (필수)")
    p.add_argument("--if-missing", action="store_true", help="이미 값이 있으면 아무것도 하지 않음 (설치 스크립트용)")
    sub.add_parser("rotate-key")
    p = sub.add_parser("orphans")
    p.add_argument("--delete", action="store_true")
    p = sub.add_parser("backup")
    p.add_argument("--tmp-dir", default=None, help="덤프 임시 폴더 (서버 PC: D:\\PaperLab\\tmp). 끝나면 지움")
    sub.add_parser("pg-dump-check", help="pg_dump 주 버전이 DB 서버 주 버전 이상인지 (앱 역할 주소)")
    p = sub.add_parser("latest-backup", help="R2의 가장 최근 백업 날짜 (감시 작업용)")
    p.add_argument("--max-hours", type=float, default=36.0)
    sub.add_parser("mark-test-project")
    sub.add_parser("cache-stats", help="인용 그래프 공용 캐시 크기 · 행 수 · 가장 오래된 날짜")
    p = sub.add_parser("cache-prune", help="공용 캐시를 상한 아래로 (오래된 서지부터)")
    p.add_argument("--max-mb", type=float, default=150.0)
    args = ap.parse_args(argv)
    for stream in (sys.stdout, sys.stderr):  # 작업 스케줄러 · 파이프(cp949 등)에서 글자 때문에 죽지 않게
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    _setup_logging(args.log_file)
    env_file = Path(args.env_file) if args.env_file else DEFAULT_ENV_FILE
    env = load_env_file(env_file)
    admin_db = (env.get("SUPABASE_DB_URL") or "").strip()
    app_db = (env.get(APP_DB_VAR) or "").strip()

    def say(msg: str) -> None:
        print(msg)
        log.info("%s", msg)

    try:
        if args.cmd == "mark-test-project":
            ref = mark_test_project(env.get("SUPABASE_TEST_DB_URL", ""), env.get("SUPABASE_TEST_URL", ""),
                                    env.get("SUPABASE_URL", ""), admin_db)
            say(f"테스트 프로젝트 표지를 붙였어요 ({ref[:4]}…)")
            return 0
        if args.cmd == "latest-backup":
            day, hours = latest_backup(_storage_from_env(env))
            if not day:
                say("최근 백업: 없음")
                return 2
            say(f"최근 백업: {day} ({hours:.0f}시간 전)")
            return 2 if hours > args.max_hours else 0
        if args.cmd in ("backup", "pg-dump-check"):
            # 백업은 앱 역할 주소로만 접속한다(--role=service_role). 관리자 주소로 대신 붙지 않는다 (명세 13.3, AC-71)
            if not app_db:
                raise AdminError(f"{APP_DB_VAR} 이 비어 있어요 (admin app-role --write-env 먼저)")
            if not is_app_role_user(db_user(app_db)):
                raise AdminError(f"{APP_DB_VAR} 사용자 이름이 paperlab_app.<ref>가 아니에요 (관리자 등 다른 계정). "
                                 "앱 역할 주소만 쓸 수 있어요")
            pg = find_pg_dump(env)
            if args.cmd == "pg-dump-check":
                mine, server = pg_dump_version_check(app_db, pg)
                say(f"pg_dump 주 버전 {mine}, DB 서버 주 버전 {server}")
                if mine is None or mine < server:
                    raise AdminError("pg_dump 주 버전이 DB 서버보다 낮아요 — PostgreSQL 클라이언트를 올려 주세요")
                return 0
            storage = _storage_from_env(env)
            refuse_test_project(app_db)
            res = run_backup(app_db, storage, tmp_dir=args.tmp_dir, pg_dump=pg)
            say(f"백업 {res['key']} ({res['bytes']} 바이트), 지운 옛 백업 {len(res['removed'])}개")
            return 0
        if not admin_db:
            raise AdminError("SUPABASE_DB_URL 이 비어 있어요")
        refuse_test_project(admin_db)
        if args.cmd == "sync-allowlist":
            if not parse_allowed_emails(env.get("ALLOWED_EMAILS", "")):
                # 빈 변수로 표를 통째로 비우지 않는다 (허용 목록을 끈 운영 — PAPERLAB_ALLOWLIST=off — 에서도 안전)
                say("ALLOWED_EMAILS 가 비어 있어 허용 목록 표를 바꾸지 않았어요")
                return 0
            emails = sync_allowlist(admin_db, env.get("ALLOWED_EMAILS", ""))
            say(f"허용 목록을 맞췄어요: {len(emails)}개")
        elif args.cmd == "app-role":
            if not args.write_env:
                raise AdminError("결과 주소를 쓸 곳이 없어요 — --write-env 를 붙여 주세요 (화면에는 출력하지 않아요)")
            if (os.environ.get(APP_DB_VAR) or "").strip():
                say(f"주의: 환경 변수 {APP_DB_VAR} 가 있어 파일 값보다 우선해요 (서버 계정 환경 변수에서 지워 주세요)")
            result = app_role_write_env(admin_db, env_file, if_missing=args.if_missing)
            if result == "skipped":
                say(f"{APP_DB_VAR} 가 이미 있어 그대로 뒀어요 (회전하려면 --if-missing 없이)")
            else:
                say(f"앱 역할 비밀번호를 바꾸고 {env_file} 의 {APP_DB_VAR} 줄에 썼어요 — 서버를 다시 시작해 주세요")
        elif args.cmd == "rotate-key":
            new_key = decode_encryption_key(env.get("APP_ENCRYPTION_KEY", ""))
            old = getpass.getpass("옛 APP_ENCRYPTION_KEY (화면에 보이지 않아요): ")
            old_key = base64.b64decode(old.strip(), validate=True)
            if len(old_key) != 32:
                raise AdminError("옛 키 길이가 틀렸어요")
            n = rotate_keys(admin_db, new_key, [old_key])
            say(f"다시 암호화한 행: {n}개 (새 key_id {key_id(new_key)})")
        elif args.cmd == "orphans":
            storage = create_storage("r2", {k: env.get(k, "") for k in R2_VARS})
            res = find_orphans(admin_db, storage, delete=args.delete)
            say(f"고아 PDF {len(res['orphans'])}개 ({res['orphan_bytes']} 바이트), 삭제 {res['deleted']}개")
            say(f"R2 users/ 합계 {res['storage_bytes']} 바이트, DB 합계 {res['db_bytes']} 바이트, "
                f"incoming/ {res['incoming_count']}개")
        elif args.cmd == "cache-stats":
            s = cache_stats(admin_db)
            say(f"공용 캐시: 서지 {s['works']}행 · 관계 {s['edges']}행, 디스크 {s['disk_bytes'] / 1048576:.1f}MB "
                f"(살아 있는 행 {s['live_bytes'] / 1048576:.1f}MB), 가장 오래된 서지 {s['oldest_meta_on'] or '-'}, "
                f"가장 오래된 관계 {s['oldest_fetched_on'] or '-'}")
        elif args.cmd == "cache-prune":
            r = cache_prune(admin_db, args.max_mb)
            say(f"공용 캐시 정리: 서지 {r['deleted_works']}행 · 관계 {r['deleted_edges']}행 지움, "
                f"살아 있는 행 {r['live_before'] / 1048576:.1f}MB → {r['live_after'] / 1048576:.1f}MB "
                f"(상한 {args.max_mb:g}MB)")
    except (AdminError, ConfigError) as e:
        print(f"실패: {e}", file=sys.stderr)
        log.error("실패: %s", redact(str(e)))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
