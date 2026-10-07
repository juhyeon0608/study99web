"""`admin app-role --write-env` (명세 13.1-5-5 · 20.1, 팀장 결정 S1): cloud.env의 SUPABASE_APP_DB_URL 줄만 바꿔 쓴다.

DB는 건드리지 않는다 — 비밀번호를 바꾸는 함수(set_app_role_password)는 가짜로 바꿔 넣는다.
"""

import pytest

from paperlab import admin
from paperlab.admin import AdminError, app_role_write_env, replace_env_line, write_env_var
from paperlab.config import load_env_file

ADMIN_URL = "postgresql://postgres.fakeref:admin-secret-pw@pooler.example:5432/postgres"
ORIGINAL = ("# PaperLab 서버 PC 설정 — 값은 출력하지 않음\n"
            "SUPABASE_URL=https://fakeref.supabase.co\n"
            "SUPABASE_DB_URL=" + ADMIN_URL + "\n"
            "\n"
            "# 앱 역할 주소 (설치 스크립트가 채움)\n"
            "SUPABASE_APP_DB_URL=\n"
            "PAPERLAB_PUBLIC_URL=https://pl.example\n"
            "ALLOWED_EMAILS=a@x.com\n")


class FakeRole:
    """가짜 DB 함수: 받은 비밀번호로 앱 주소를 만들어 돌려주고, 부른 횟수 · 마지막 주소를 기억"""

    def __init__(self):
        self.calls, self.url = 0, ""

    def __call__(self, admin_conninfo, password):
        assert admin_conninfo == ADMIN_URL and len(password) >= 32
        self.calls += 1
        self.url = admin.app_conninfo(admin_conninfo, password)
        return self.url


@pytest.fixture
def env_file(tmp_path, monkeypatch, keep_root_logging):
    for k in ("SUPABASE_APP_DB_URL", "SUPABASE_DB_URL"):
        monkeypatch.delenv(k, raising=False)
    f = tmp_path / ".paperlab" / "cloud.env"
    f.parent.mkdir()
    f.write_text(ORIGINAL, encoding="utf-8")
    return f


def _lines_except_app(text):
    return [ln for ln in text.splitlines() if not ln.startswith("SUPABASE_APP_DB_URL=")]


def test_only_that_line_changes(env_file):
    fake = FakeRole()
    assert app_role_write_env(ADMIN_URL, env_file, set_password=fake) == "written"
    text = env_file.read_text(encoding="utf-8")
    assert _lines_except_app(text) == _lines_except_app(ORIGINAL)  # 다른 줄 · 주석 · 빈 줄 · 순서 그대로
    assert text.splitlines().index(f"SUPABASE_APP_DB_URL={fake.url}") == 5  # 같은 자리
    assert load_env_file(env_file, environ={})["SUPABASE_APP_DB_URL"].startswith("postgresql://paperlab_app.fakeref:")
    assert not list(env_file.parent.glob(".cloud.env.*"))  # 임시 파일이 남지 않음


def test_if_missing_skips_when_set_and_rotation_replaces(env_file):
    fake = FakeRole()
    app_role_write_env(ADMIN_URL, env_file, set_password=fake)
    first = fake.url
    assert app_role_write_env(ADMIN_URL, env_file, if_missing=True, set_password=fake) == "skipped"
    assert fake.calls == 1 and f"SUPABASE_APP_DB_URL={first}" in env_file.read_text(encoding="utf-8")
    # --if-missing 없이 = 명시적 회전: 새 비밀번호, 줄은 하나뿐
    app_role_write_env(ADMIN_URL, env_file, set_password=fake)
    text = env_file.read_text(encoding="utf-8")
    assert fake.calls == 2 and fake.url != first and text.count("SUPABASE_APP_DB_URL=") == 1


def test_missing_file_is_error_and_db_untouched(tmp_path):
    fake = FakeRole()
    with pytest.raises(AdminError, match="설정 파일이 없어요"):
        app_role_write_env(ADMIN_URL, tmp_path / "none.env", set_password=fake)
    assert fake.calls == 0  # 파일이 없으면 비밀번호도 바꾸지 않음
    with pytest.raises(AdminError):
        write_env_var(tmp_path / "none.env", "SUPABASE_APP_DB_URL", "x")


def test_line_endings_bom_and_append(tmp_path):
    assert replace_env_line("A=1\r\nSUPABASE_APP_DB_URL=old\r\nB=2", "SUPABASE_APP_DB_URL", "new") == \
        "A=1\r\nSUPABASE_APP_DB_URL=new\r\nB=2"
    assert replace_env_line("A=1\nexport SUPABASE_APP_DB_URL = 'old'\n", "SUPABASE_APP_DB_URL", "n") == \
        "A=1\nSUPABASE_APP_DB_URL=n\n"
    assert replace_env_line("A=1", "SUPABASE_APP_DB_URL", "n") == "A=1\nSUPABASE_APP_DB_URL=n\n"
    assert replace_env_line("# SUPABASE_APP_DB_URL=주석\n", "SUPABASE_APP_DB_URL", "n") == \
        "# SUPABASE_APP_DB_URL=주석\nSUPABASE_APP_DB_URL=n\n"  # 주석 줄은 건드리지 않음
    with pytest.raises(AdminError):
        replace_env_line("", "SUPABASE_APP_DB_URL", "a\nB=injected")
    f = tmp_path / "bom.env"
    f.write_bytes(b"\xef\xbb\xbfA=1\r\nSUPABASE_APP_DB_URL=\r\n")
    write_env_var(f, "SUPABASE_APP_DB_URL", "postgresql://paperlab_app.r:p@h/d")
    assert f.read_bytes() == b"\xef\xbb\xbfA=1\r\nSUPABASE_APP_DB_URL=postgresql://paperlab_app.r:p@h/d\r\n"


def test_cli_prints_no_values(env_file, capsys, caplog, monkeypatch):
    """표준 출력 · 로그에 앱 주소 · 비밀번호 · 관리자 주소가 나오지 않음"""
    fake = FakeRole()
    monkeypatch.setattr(admin, "set_app_role_password", fake)
    monkeypatch.setattr(admin, "refuse_test_project", lambda conninfo: None)
    log_file = env_file.parent / "admin.log"
    code = admin.main(["--env-file", str(env_file), "--log-file", str(log_file), "app-role", "--write-env"])
    out = capsys.readouterr()
    assert code == 0, out.err
    written = load_env_file(env_file, environ={})["SUPABASE_APP_DB_URL"]
    password = written.split(":")[2].split("@")[0]
    everything = out.out + out.err + log_file.read_text(encoding="utf-8") + caplog.text
    for secret in (written, password, "admin-secret-pw"):
        assert secret not in everything
    assert "SUPABASE_APP_DB_URL" in out.out and "SUPABASE_APP_DB_URL" in log_file.read_text(encoding="utf-8")
    # --if-missing: 이미 있으므로 그대로
    assert admin.main(["--env-file", str(env_file), "app-role", "--write-env", "--if-missing"]) == 0
    assert fake.calls == 1


@pytest.mark.parametrize("bad", [
    "postgresql://postgres:pw@db.fakeref.supabase.co:5432/postgres",  # 직접 연결 (ref 없음)
    "postgresql://supabase_admin.fakeref:pw@pooler.example:5432/postgres",
    "host=pooler.example user=postgres password=pw dbname=postgres",
])
def test_direct_connection_admin_url_refused_before_db(env_file, bad):
    """품질팀 M2: 앱 역할 이름은 서버 규칙(paperlab_app.<ref>)과 같게. 직접 연결 주소는 비밀번호를 바꾸기 전에 오류"""
    fake = FakeRole()
    with pytest.raises(AdminError, match="Session pooler"):
        app_role_write_env(bad, env_file, set_password=fake)
    assert fake.calls == 0 and env_file.read_text(encoding="utf-8") == ORIGINAL
    with pytest.raises(AdminError, match="Session pooler"):
        admin.app_conninfo(bad, "pw")
    with pytest.raises(AdminError, match="Session pooler"):
        admin.set_app_role_password(bad, "pw")  # DB 접속 전에 거부


def test_app_conninfo_matches_server_rule():
    from paperlab.config import db_user, is_app_role_user
    for admin_url in (ADMIN_URL, "host=pooler.example port=5432 user=postgres.fakeref password=x dbname=postgres"):
        url = admin.app_conninfo(admin_url, "new-pw")
        assert db_user(url) == "paperlab_app.fakeref" and is_app_role_user(db_user(url))


def test_cli_requires_write_env(env_file, capsys, monkeypatch):
    fake = FakeRole()
    monkeypatch.setattr(admin, "set_app_role_password", fake)
    monkeypatch.setattr(admin, "refuse_test_project", lambda conninfo: None)
    assert admin.main(["--env-file", str(env_file), "app-role"]) == 1
    assert "--write-env" in capsys.readouterr().err and fake.calls == 0
