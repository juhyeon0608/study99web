"""DB 백업 (AC-70 · 71).

- 복원 검사(`test_backup_dump_restore_and_rotation`): 테스트 프로젝트 + 가짜 저장소 + 실제 pg_dump/pg_restore
  (PostgreSQL 17 클라이언트 — `PAPERLAB_PG_DUMP` 또는 PATH. 없으면 이유를 적고 건너뜀. 서버 PC에서는 PATH에 있음).
- 나머지는 DB 없이: pg_dump 찾기(PAPERLAB_PG_DUMP → PATH), 앱 역할 주소로만 접속, 임시 파일 정리, 최근 백업 날짜.
"""

import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime
from pathlib import Path

import psycopg
import pytest

from paperlab import admin
from paperlab.admin import AdminError, find_pg_dump, latest_backup, run_backup
from paperlab.storage import FakeStorage

from .conftest import make_pdf

APP_URL = "postgresql://paperlab_app.fakeref:app-secret-pw@127.0.0.1:9/postgres"
ADMIN_URL = "postgresql://postgres.fakeref:admin-secret-pw@127.0.0.1:9/postgres"


@pytest.mark.db
@pytest.mark.skipif(not (shutil.which("pg_dump") and shutil.which("pg_restore")),
                    reason="pg_dump · pg_restore가 없어 백업 복원 테스트를 건너뜀 (PostgreSQL 17 클라이언트 필요)")
def test_backup_dump_restore_and_rotation(cloud):
    a, b = cloud.user(), cloud.user()
    for u in (a, b):
        c = cloud.client(u)
        pid = cloud.upload(c, make_pdf(title=f"Backup Paper {uuid.uuid4().hex[:6]} Title", doi=""))["id"]
        c.post(f"/api/papers/{pid}/annotations", json={"page": 1, "text": "hl"})
        c.post("/api/manuscripts", json={"title": "ms"})
    store = FakeStorage()
    for d in range(1, 15):
        store.put(f"backups/db/202609{d:02d}.dump", b"old", "application/octet-stream")
    # 앱 역할 주소 + --role=service_role (서버 PC 작업 스케줄러 PaperLab Backup과 같은 방식)
    with tempfile.TemporaryDirectory() as work:
        res = run_backup(cloud.project.app_db, store, today="20261007", tmp_dir=work, pg_dump=shutil.which("pg_dump"))
        assert list(Path(work).iterdir()) == []  # 로컬 사본을 남기지 않음 (AC-71)
    assert res["key"] == "backups/db/20261007.dump"
    assert len([k for k in store.objects if k.startswith("backups/")]) == 14  # 15개 중 가장 오래된 1개 삭제
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "x.dump"
        path.write_bytes(store.objects[res["key"]])
        listing = subprocess.run(["pg_restore", "--list", str(path)], capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
        for t in ("papers", "annotations", "manuscripts", "folders", "user_secrets", "page_texts"):
            assert f"TABLE DATA paperlab {t} " in listing, t
        # 별도 스키마로 복원해 개수 비교 (끝나면 스키마 삭제)
        sql = subprocess.run(["pg_restore", "--schema=paperlab", "--data-only", "--no-owner", "-f", "-", str(path)],
                             capture_output=True, text=True, encoding="utf-8", errors="replace").stdout
    with psycopg.connect(cloud.project.admin_db, autocommit=True) as conn:
        conn.execute("drop schema if exists paperlab_restore_check cascade")
        try:
            conn.execute("create schema paperlab_restore_check")
            for t in ("papers", "annotations", "manuscripts"):
                conn.execute(f"create table paperlab_restore_check.{t} (like paperlab.{t})")
            restored = sql.replace("paperlab.", "paperlab_restore_check.")
            keep = [blk for blk in restored.split("\n\n") if any(f"paperlab_restore_check.{t} " in blk
                                                                for t in ("papers", "annotations", "manuscripts"))]
            with conn.transaction():
                conn.execute("set local session_replication_role = replica")
                for blk in keep:
                    if blk.startswith("COPY "):
                        head, _, body = blk.partition("\n")
                        with conn.cursor().copy(head) as cp:
                            cp.write(body.rsplit("\\.", 1)[0])
            for u in (a, b):
                for t in ("papers", "annotations", "manuscripts"):
                    orig = conn.execute(f"select count(*) from paperlab.{t} where user_id = %s", (u.id,)).fetchone()[0]
                    got = conn.execute(f"select count(*) from paperlab_restore_check.{t} where user_id = %s",
                                       (u.id,)).fetchone()[0]
                    assert got == orig, t
        finally:
            conn.execute("drop schema if exists paperlab_restore_check cascade")


# ---------------------------------------------------------------- DB 없이 (AC-71 자동 부분)
def _fake_pg_dump(tmp_path: Path) -> Path:
    """받은 PGUSER · 인자를 덤프 파일에 적는 가짜 pg_dump (비밀번호는 적지 않음)"""
    script = tmp_path / "fake_pg_dump.py"
    script.write_text(
        "import os, sys\n"
        "out = [a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--file=')][0]\n"
        "assert not any('app-secret-pw' in a for a in sys.argv)\n"
        "open(out, 'w', encoding='utf-8').write('PGDMP user=' + os.environ.get('PGUSER', '') + ' args=' + ' '.join(sys.argv[1:-1]))\n",
        encoding="utf-8")
    if sys.platform == "win32":
        exe = tmp_path / "pg_dump.cmd"
        # cmd는 배치 파일을 OEM 코드 페이지로 읽는다 (저장소 경로에 한글이 있을 수 있음)
        exe.write_text(f'@echo off\r\n"{sys.executable}" "{script}" %*\r\n', encoding="oem")
    else:
        exe = tmp_path / "pg_dump"
        exe.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n', encoding="utf-8")
        exe.chmod(0o755)
    return exe


def _env_file(tmp_path: Path, **values) -> Path:
    f = tmp_path / "cloud.env"
    f.write_text("".join(f"{k}={v}\n" for k, v in values.items()), encoding="utf-8")
    return f


@pytest.fixture
def clean_env(monkeypatch, keep_root_logging):
    """cloud.env 값보다 우선하는 환경 변수를 비운다"""
    for k in ("SUPABASE_APP_DB_URL", "SUPABASE_DB_URL", "PAPERLAB_PG_DUMP", "STORAGE_BACKEND"):
        monkeypatch.delenv(k, raising=False)


def test_find_pg_dump_setting_then_path(tmp_path, monkeypatch):
    exe = _fake_pg_dump(tmp_path)
    assert find_pg_dump({"PAPERLAB_PG_DUMP": str(exe)}) == str(exe)
    with pytest.raises(AdminError, match="pg_dump를 찾지 못했어요"):
        find_pg_dump({"PAPERLAB_PG_DUMP": str(tmp_path / "nope" / "pg_dump.exe")})
    monkeypatch.setattr(admin.shutil, "which", lambda name: None)
    with pytest.raises(AdminError, match="pg_dump를 찾지 못했어요"):
        find_pg_dump({})
    monkeypatch.setattr(admin.shutil, "which", lambda name: "C:/x/pg_dump.exe" if name == "pg_dump" else None)
    assert find_pg_dump({"PAPERLAB_PG_DUMP": ""}) == "C:/x/pg_dump.exe"


def test_backup_missing_pg_dump_fails_without_leftovers(tmp_path, capsys, clean_env):
    """AC-71: pg_dump를 못 찾으면 종료 코드 ≠ 0, 'pg_dump를 찾지 못했어요', 임시 파일이 남지 않음"""
    work = tmp_path / "work"
    work.mkdir()
    env = _env_file(tmp_path, SUPABASE_APP_DB_URL=APP_URL, PAPERLAB_PG_DUMP=str(tmp_path / "missing.exe"))
    code = admin.main(["--env-file", str(env), "backup", "--tmp-dir", str(work)])
    err = capsys.readouterr().err
    assert code != 0 and "pg_dump를 찾지 못했어요" in err
    assert list(work.iterdir()) == []
    assert "app-secret-pw" not in err


def test_backup_uses_app_role_url_and_cleans_up(tmp_path, capsys, monkeypatch, clean_env):
    """AC-71: 백업은 앱 역할 주소(SUPABASE_APP_DB_URL)로 접속(가짜 pg_dump가 받은 PGUSER 검사), --role=service_role,
    --tmp-dir 아래 임시 파일은 끝나면 지움, 로그 파일 · 화면에 비밀번호 없음"""
    store = FakeStorage()
    monkeypatch.setattr(admin, "_storage_from_env", lambda env: store)
    monkeypatch.setattr(admin, "refuse_test_project", lambda conninfo: None)
    work, logs = tmp_path / "tmp", tmp_path / "logs"
    env = _env_file(tmp_path, SUPABASE_APP_DB_URL=APP_URL, SUPABASE_DB_URL=ADMIN_URL,
                    PAPERLAB_PG_DUMP=str(_fake_pg_dump(tmp_path)))
    code = admin.main(["--env-file", str(env), "--log-file", str(logs / "backup.log"), "backup", "--tmp-dir", str(work)])
    out = capsys.readouterr()
    assert code == 0, out.err
    [key] = [k for k in store.objects if k.startswith("backups/db/")]
    dumped = store.objects[key].decode()
    assert "user=paperlab_app.fakeref" in dumped and "--role=service_role" in dumped and "--schema=paperlab" in dumped
    assert work.exists() and list(work.iterdir()) == []
    log_text = (logs / "backup.log").read_text(encoding="utf-8")
    assert "reason=backup" in log_text and key in log_text
    for secret in ("app-secret-pw", "admin-secret-pw"):
        assert secret not in out.out + out.err + log_text


@pytest.mark.parametrize("values,needle", [
    ({"SUPABASE_DB_URL": ADMIN_URL}, "SUPABASE_APP_DB_URL"),             # 관리자 주소로 대신 붙지 않음
    ({"SUPABASE_APP_DB_URL": ADMIN_URL}, "관리자"),                       # 앱 주소 자리에 postgres 계정
    ({"SUPABASE_APP_DB_URL": APP_URL, "STORAGE_BACKEND": "fake"}, "fake"),  # 가짜 저장소 거부 (승인자 L5)
])
def test_backup_refuses_wrong_settings(tmp_path, capsys, clean_env, values, needle):
    exe = _fake_pg_dump(tmp_path)
    env = _env_file(tmp_path, PAPERLAB_PG_DUMP=str(exe), **values)
    assert admin.main(["--env-file", str(env), "backup", "--tmp-dir", str(tmp_path / "w")]) == 1
    err = capsys.readouterr().err
    assert needle in err and "secret-pw" not in err


def test_run_backup_cleans_temp_on_failure(tmp_path):
    def broken(conninfo, path):
        path.write_bytes(b"partial dump")
        raise AdminError("pg_dump 실패: 가짜")

    with pytest.raises(AdminError):
        run_backup(APP_URL, FakeStorage(), today="20261007", dump=broken, tmp_dir=tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_latest_backup_age():
    from paperlab.admin import KST
    store = FakeStorage()
    assert latest_backup(store) == ("", None)
    for d in ("20261005", "20261006"):
        store.put(f"backups/db/{d}.dump", b"x", "application/octet-stream")
    store.put("backups/db/notes.txt", b"x", "text/plain")
    day, hours = latest_backup(store, now=datetime(2026, 10, 7, 16, 0, tzinfo=KST))
    assert day == "20261006" and hours == pytest.approx(36.0)
