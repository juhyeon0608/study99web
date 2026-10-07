"""SQL 마이그레이션 적용 도구 (명세 5.3, 팀장 결정 T5).

실행: `python -m paperlab.migrate` — 관리자 연결(`SUPABASE_DB_URL`, cloud.env)로 아직 적용 안 된
`supabase/migrations/*.sql` 파일을 이름 순으로 한 트랜잭션씩 실행하고 `paperlab.schema_migrations`에 기록한다.
운영용 실행은 테스트 프로젝트 표지(`public.paperlab_test_project`)가 있는 DB를 거부한다(운영 보호 장치 3번).
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from pathlib import Path

import psycopg

from .config import load_env_file, redact

log = logging.getLogger("paperlab.migrate")

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "supabase" / "migrations"
FILE_RE = re.compile(r"^(\d{14})_[a-z0-9_]+\.sql$")
# 동시 실행 방지용 advisory lock 번호 (트랜잭션 범위)
LOCK_KEY = 7_301_001

BOOTSTRAP = """
create schema if not exists paperlab;
create table if not exists paperlab.schema_migrations (
    version    text primary key,
    applied_at timestamptz not null default now()
);
alter table paperlab.schema_migrations enable row level security;
alter table paperlab.schema_migrations force row level security;
"""


class MigrationError(Exception):
    pass


def migration_files(directory: Path = MIGRATIONS_DIR) -> list[Path]:
    """이름 규칙(<14자리 시각>_<이름>.sql)을 따르는 파일을 이름 순으로. 규칙을 어긴 .sql이 있으면 오류."""
    files = sorted(directory.glob("*.sql"))
    bad = [f.name for f in files if not FILE_RE.match(f.name)]
    if bad:
        raise MigrationError(f"마이그레이션 파일 이름 규칙 위반: {', '.join(bad)}")
    return files


def is_test_project(conn: psycopg.Connection) -> bool:
    """테스트 프로젝트 표지 표가 있는지"""
    row = conn.execute("select to_regclass('public.paperlab_test_project') is not null").fetchone()
    return bool(row[0])


def apply_migrations(conninfo: str, *, target: str = "production", directory: Path = MIGRATIONS_DIR) -> list[str]:
    """아직 적용 안 된 파일을 적용하고, 적용한 version 목록을 돌려준다.

    target="production": 테스트 표지가 있으면 거부. target="test": 표지가 없으면 거부.
    """
    if target not in ("production", "test"):
        raise MigrationError("target은 production 또는 test")
    files = migration_files(directory)
    log.info("migrate start reason=migrate target=%s files=%d", target, len(files))
    applied: list[str] = []
    try:
        conn = psycopg.connect(conninfo, autocommit=True, prepare_threshold=None, connect_timeout=15)
    except psycopg.Error as e:
        raise MigrationError("DB에 연결하지 못했어요: " + redact(str(e))) from None
    with conn:
        marked = is_test_project(conn)
        if target == "production" and marked:
            raise MigrationError("이 DB에는 테스트 프로젝트 표지가 있어요. 운영 마이그레이션을 거부합니다.")
        if target == "test" and not marked:
            raise MigrationError("테스트 프로젝트 표지(public.paperlab_test_project)가 없는 DB예요. 거부합니다.")
        with conn.transaction():
            conn.execute("select pg_advisory_xact_lock(%s)", (LOCK_KEY,))
            conn.execute(BOOTSTRAP)
        for path in files:
            version = path.name[:-4]
            with conn.transaction():
                # 여러 곳에서 동시에 돌려도 한 번만 적용되게 같은 잠금 안에서 기록을 다시 본다
                conn.execute("select pg_advisory_xact_lock(%s)", (LOCK_KEY,))
                done = conn.execute("select 1 from paperlab.schema_migrations where version = %s",
                                    (version,)).fetchone()
                if done:
                    continue
                log.info("migrate apply %s", path.name)
                try:
                    conn.execute(path.read_text(encoding="utf-8"))
                except psycopg.Error as e:
                    raise MigrationError(f"{path.name} 적용 실패: {redact(str(e))}") from None
                conn.execute("insert into paperlab.schema_migrations (version) values (%s)", (version,))
                applied.append(version)
    log.info("migrate done applied=%d", len(applied))
    return applied


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m paperlab.migrate",
                                 description="supabase/migrations/*.sql 을 관리자 연결로 적용")
    ap.add_argument("--env-file", default=None, help="환경 변수 파일 (기본: ~/.paperlab/cloud.env, 이미 있는 환경 변수가 우선)")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    env = load_env_file(args.env_file)
    conninfo = env.get("SUPABASE_DB_URL", "")
    if not conninfo:
        print("SUPABASE_DB_URL 이 비어 있어요", file=sys.stderr)
        return 2
    try:
        applied = apply_migrations(conninfo, target="production")
    except MigrationError as e:
        print(f"마이그레이션 실패: {e}", file=sys.stderr)
        return 1
    print(f"적용한 파일 {len(applied)}개" + (": " + ", ".join(applied) if applied else " (모두 적용돼 있음)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
