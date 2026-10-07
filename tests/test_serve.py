"""운영 서버 진입점 `python -m paperlab.serve` (명세 9.1 · 6.5 · 13.5 · 20.1): AC-74 설정 검사 · 바인딩 · 프록시 신뢰,
AC-08(개정 — 공개 출처 · Host 허용 목록), `--check` 출력에 값 없음, 요청 id, health의 커밋, 허용 목록 끄기."""

import base64
import json
import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from paperlab import serve
from paperlab import server as server_mod
from paperlab.config import ConfigError, ServerConfig, env_problems, parse_public_url
from paperlab.server import create_app
from paperlab.storage import FakeStorage

from .conftest import UNREACHABLE_DB, LocalAuth, make_config

ROOT = Path(__file__).resolve().parent.parent
APP_PW, ADMIN_PW, R2_SECRET, ANON = "app-pw-SECRET-1", "admin-pw-SECRET-2", "r2-SECRET-3", "anon-SECRET-4"
ENC_KEY = base64.b64encode(b"k" * 32).decode()


def good_env(**over) -> dict:
    env = {"SUPABASE_URL": "https://fakeref.supabase.co", "SUPABASE_ANON_KEY": ANON,
           "SUPABASE_DB_URL": f"postgresql://postgres.fakeref:{ADMIN_PW}@pooler.example:5432/postgres",
           "SUPABASE_APP_DB_URL": f"postgresql://paperlab_app.fakeref:{APP_PW}@pooler.example:5432/postgres",
           "APP_ENCRYPTION_KEY": ENC_KEY, "PAPERLAB_PUBLIC_URL": "https://pl.example",
           "ALLOWED_EMAILS": "a@x.com", "R2_ACCOUNT_ID": "acct", "R2_BUCKET": "bucket",
           "R2_ACCESS_KEY_ID": "AKIDFAKE", "R2_SECRET_ACCESS_KEY": R2_SECRET}
    env.update(over)
    return {k: v for k, v in env.items() if v is not None}


def write_env(path: Path, env: dict) -> Path:
    path.write_text("".join(f"{k}={v}\n" for k, v in env.items()), encoding="utf-8")
    return path


SECRETS = (APP_PW, ADMIN_PW, R2_SECRET, ANON, ENC_KEY, "fakeref")


@pytest.fixture
def isolated(monkeypatch, keep_root_logging):
    """이 PC의 환경 변수가 cloud.env 값보다 우선하지 않게 비우고, ANTHROPIC_* 지우기는 테스트 프로세스에 하지 않음"""
    for k in list(os.environ):
        if k.startswith(("SUPABASE_", "R2_", "APP_ENCRYPTION", "ALLOWED_EMAILS", "PAPERLAB_", "STORAGE_BACKEND")):
            monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(serve, "scrub_ai_environment", lambda environ=None: [])


# ---------------------------------------------------------------- AC-74 설정 검사
@pytest.mark.parametrize("over,name", [
    ({"SUPABASE_APP_DB_URL": None}, "SUPABASE_APP_DB_URL"),  # 관리자 주소만 있으면 대신 붙지 않고 거부
    ({"SUPABASE_APP_DB_URL": f"postgresql://postgres.fakeref:{ADMIN_PW}@h/d"}, "SUPABASE_APP_DB_URL"),
    ({"SUPABASE_APP_DB_URL": f"postgresql://postgres:{ADMIN_PW}@h/d"}, "SUPABASE_APP_DB_URL"),
    ({"SUPABASE_APP_DB_URL": "host=h dbname=d user=Postgres password=x"}, "SUPABASE_APP_DB_URL"),
    ({"SUPABASE_APP_DB_URL": "postgresql://h/d"}, "SUPABASE_APP_DB_URL"),  # 사용자 이름 없음
    ({"SUPABASE_APP_DB_URL": "postgresql://supabase_admin:x@h/d"}, "SUPABASE_APP_DB_URL"),  # 품질팀 2f
    ({"SUPABASE_APP_DB_URL": "postgresql://authenticator.fakeref:x@h/d"}, "SUPABASE_APP_DB_URL"),
    ({"SUPABASE_APP_DB_URL": "postgresql://paperlab_app:x@h/d"}, "SUPABASE_APP_DB_URL"),  # ref 없음
    ({"SUPABASE_APP_DB_URL": "postgresql://paperlab_app.:x@h/d"}, "SUPABASE_APP_DB_URL"),
    ({"STORAGE_BACKEND": "supabase"}, "STORAGE_BACKEND"),  # 품질팀 2g: 자리만 있는 값
    ({"PAPERLAB_PUBLIC_URL": None}, "PAPERLAB_PUBLIC_URL"),
    ({"PAPERLAB_PUBLIC_URL": "http://pl.example"}, "PAPERLAB_PUBLIC_URL"),
    ({"PAPERLAB_PUBLIC_URL": "https://pl.example/app"}, "PAPERLAB_PUBLIC_URL"),
    ({"PAPERLAB_PUBLIC_URL": "https://user@pl.example"}, "PAPERLAB_PUBLIC_URL"),
    ({"STORAGE_BACKEND": "fake"}, "STORAGE_BACKEND"),  # 승인자 L5
    ({"R2_BUCKET": ""}, "R2_BUCKET"),
])
def test_config_refuses(over, name):
    env = good_env(**over)
    assert name in env_problems(env)
    with pytest.raises(ConfigError) as e:
        ServerConfig.from_env(env)
    assert name in e.value.names
    for secret in SECRETS:
        assert secret not in str(e.value)


def test_config_uses_app_url_only():
    cfg = ServerConfig.from_env(good_env(PAPERLAB_PUBLIC_URL="https://PL.example/"), port=8099)
    assert cfg.db_url.startswith("postgresql://paperlab_app.") and ADMIN_PW not in cfg.db_url
    assert cfg.public_origin == "https://pl.example" and cfg.local_port == 8099
    assert cfg.allowed_hosts() == {"pl.example", "pl.example:443", "127.0.0.1:8099", "localhost:8099"}
    assert parse_public_url("https://pl.example:8443") == "https://pl.example:8443"
    assert env_problems(good_env(SUPABASE_APP_DB_URL=None), before_app_role=True) == {}
    # 서버 코드는 관리자 주소 변수를 읽지 않음 (AC-12a 개정 — 코드 검사)
    for f in ("serve.py", "server.py", "config.py", "db.py", "auth.py", "storage.py"):
        text = (ROOT / "paperlab" / f).read_text(encoding="utf-8")
        assert '"SUPABASE_DB_URL"' not in text and "'SUPABASE_DB_URL'" not in text, f


def test_serve_exits_with_names_only(tmp_path):
    """AC-74 · 46: 진입점이 빠지거나 틀린 변수 이름만 남기고 종료 (값 없음, 종료 코드 ≠ 0)"""
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("SUPABASE", "R2_", "APP_ENCRYPTION", "ALLOWED", "PAPERLAB_", "STORAGE_"))}
    env["PYTHONIOENCODING"] = "utf-8"
    f = write_env(tmp_path / "cloud.env", good_env(SUPABASE_APP_DB_URL=f"postgresql://postgres.fakeref:{ADMIN_PW}@h/d",
                                                   APP_ENCRYPTION_KEY=base64.b64encode(b"x" * 10).decode(),
                                                   R2_BUCKET=""))
    p = subprocess.run([sys.executable, "-m", "paperlab.serve", "--env-file", str(f), "--port", "8799"], env=env,
                       capture_output=True, text=True, encoding="utf-8", cwd=ROOT, timeout=120)
    out = p.stdout + p.stderr
    assert p.returncode != 0
    for name in ("SUPABASE_APP_DB_URL", "APP_ENCRYPTION_KEY", "R2_BUCKET"):
        assert name in out
    for secret in SECRETS:
        assert secret not in out


def test_serve_runs_uvicorn_on_loopback_with_trusted_proxy(tmp_path, monkeypatch, isolated):
    """AC-74: uvicorn 실행 인자 가로채기 — host 127.0.0.1, 프록시 헤더는 127.0.0.1에서 온 것만, 회전 로그에 값 없음"""
    import uvicorn
    seen = {}
    monkeypatch.setattr(uvicorn, "run", lambda app, **kw: seen.update(kw, app=app))
    f = write_env(tmp_path / "cloud.env", good_env())
    logs = tmp_path / "logs"
    assert serve.main(["--env-file", str(f), "--log-dir", str(logs), "--port", "8099"],
                      acl_check=lambda p: "") == 0
    app = seen.pop("app")
    try:
        assert seen["host"] == "127.0.0.1" and seen["port"] == 8099
        assert seen["proxy_headers"] is True and seen["forwarded_allow_ips"] == "127.0.0.1"
        assert seen["access_log"] is False and seen["log_config"] is None
        assert app.state.config.local_port == 8099
    finally:
        app.state.db.close()
    logging.getLogger("paperlab.access").info(json.dumps({"request_id": "x", "path": "/api/health"}))
    for h in logging.getLogger().handlers:
        h.flush()
    text = (logs / "server.log").read_text(encoding="utf-8")
    first = json.loads(text.splitlines()[0])
    assert first["message"] == "서버 시작" and first["host"] == "127.0.0.1" and first["level"] == "INFO"
    assert '"path": "/api/health"' in text
    for secret in SECRETS:
        assert secret not in text
    # 코드 검사: 바인딩 · 프록시 신뢰 값이 고정돼 있고, 모든 주소 · 모든 프록시를 믿는 설정이 없음
    assert serve.HOST == "127.0.0.1" and serve.FORWARDED_ALLOW_IPS == "127.0.0.1"
    code = (ROOT / "paperlab" / "serve.py").read_text(encoding="utf-8")
    assert 'host="0.0.0.0"' not in code and "'*'" not in code and '"*"' not in code


def test_check_prints_names_only(tmp_path, capsys, isolated):
    """`--check`: 빠진 · 지울 변수 이름, 앱 역할 사용자 이름 앞부분만. 값 없음."""
    f = write_env(tmp_path / "cloud.env", good_env(SUPABASE_SERVICE_ROLE_KEY="service-SECRET-5",
                                                   GCP_PROJECT_ID="proj-SECRET-6"))
    assert serve.main(["--check", "--env-file", str(f)], acl_check=lambda p: "") == 0
    out = capsys.readouterr().out
    assert "빠졌거나 틀린 변수: 없음" in out and "paperlab_app.*" in out
    assert "SUPABASE_SERVICE_ROLE_KEY" in out and "GCP_PROJECT_ID" in out
    for secret in SECRETS + ("service-SECRET-5", "proj-SECRET-6"):
        assert secret not in out
    # 앱 역할 주소가 아직 없을 때: 설치 중(--before-app-role)이면 통과, 아니면 2
    f2 = write_env(tmp_path / "pre.env", good_env(SUPABASE_APP_DB_URL=None))
    assert serve.main(["--check", "--env-file", str(f2)], acl_check=lambda p: "") == 2
    assert serve.main(["--check", "--before-app-role", "--env-file", str(f2)], acl_check=lambda p: "") == 0
    assert serve.main(["--check", "--env-file", str(tmp_path / "missing.env")], acl_check=lambda p: "") == 2
    out = capsys.readouterr().out
    assert "SUPABASE_APP_DB_URL" in out and "(비어 있음)" in out and "없음" in out


def test_env_file_acl_warning_parsing(tmp_path, monkeypatch):
    f = tmp_path / "cloud.env"
    f.write_text("A=1\n", encoding="utf-8")
    monkeypatch.setattr(serve.sys, "platform", "win32")

    def runner(out, code=0):
        return lambda *a, **kw: subprocess.CompletedProcess(a, code, stdout=out, stderr="")

    assert serve.env_file_acl_warning(f, runner("protected\n\n")) == ""
    warn = serve.env_file_acl_warning(f, runner("inherited\nBUILTIN\\Users;NT AUTHORITY\\Authenticated Users\n"))
    assert "상속" in warn and "BUILTIN\\Users" in warn
    assert serve.env_file_acl_warning(f, runner("", code=1)) == ""
    monkeypatch.setattr(serve.sys, "platform", "linux")
    assert serve.env_file_acl_warning(f, runner("inherited\nX\n")) == ""


def test_scrub_ai_environment():
    env = {"ANTHROPIC_API_KEY": "k", "ANTHROPIC_BASE_URL": "u", "anthropic_auth_token": "t", "PATH": "p"}
    assert sorted(serve.scrub_ai_environment(env)) == ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "anthropic_auth_token"]
    assert env == {"PATH": "p"}


def test_git_commit_reads_refs(tmp_path):
    sha = "0123456789abcdef0123456789abcdef01234567"
    git = tmp_path / ".git"
    (git / "refs" / "heads").mkdir(parents=True)
    (git / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
    (git / "refs" / "heads" / "main").write_text(sha + "\n", encoding="utf-8")
    assert serve.git_commit(tmp_path) == "0123456"
    (git / "refs" / "heads" / "main").unlink()
    (git / "packed-refs").write_text(f"# pack-refs\n{sha} refs/heads/main\n", encoding="utf-8")
    assert serve.git_commit(tmp_path) == "0123456"
    (git / "HEAD").write_text("fedcba9876543210fedcba9876543210fedcba98\n", encoding="utf-8")  # 분리된 HEAD
    assert serve.git_commit(tmp_path) == "fedcba9"
    assert serve.git_commit(tmp_path / "nope") == ""


# ---------------------------------------------------------------- AC-08 (개정) 공개 출처 · Host 허용 목록
@pytest.fixture
def prod_app():
    app = create_app(make_config(UNREACHABLE_DB, public_url="https://pl.example", local_port=8080),
                     storage=FakeStorage(), commit="abc1234")
    yield app
    app.state.db.close()


def test_host_allowlist(prod_app):
    for host in ("pl.example", "PL.example", "pl.example:443", "127.0.0.1:8080", "localhost:8080"):
        r = TestClient(prod_app, base_url=f"http://{host}").get("/api/health")
        assert r.status_code == 200, host
    for host in ("evil.example", "127.0.0.1:8081", "127.0.0.1", "pl.example.", "pl.example:8443", "testserver"):
        r = TestClient(prod_app, base_url=f"http://{host}").get("/api/health")
        assert r.status_code == 400 and r.json()["code"] == "bad_host", host
    # 정적 파일도 같은 검사 (DNS 리바인딩)
    assert TestClient(prod_app, base_url="http://evil.example").get("/").status_code == 400


def test_origin_is_public_url_only(prod_app):
    c = TestClient(prod_app, base_url="http://pl.example")
    assert c.get("/api/health", headers={"Origin": "https://pl.example"}).status_code == 200
    for origin in ("https://evil.example", "null", "http://pl.example", "https://pl.example:8443"):
        assert c.get("/api/health", headers={"Origin": origin}).status_code == 403, origin
    # Host에서 출처를 만들지 않음: 허용된 Host(127.0.0.1:8080)여도 Origin이 그 Host 기준이면 거부
    local = TestClient(prod_app, base_url="http://127.0.0.1:8080")
    for origin in ("http://127.0.0.1:8080", "https://127.0.0.1:8080"):
        assert local.get("/api/health", headers={"Origin": origin}).status_code == 403, origin
    # Host를 바꾸고 Origin도 맞춰 보내도 막힘
    evil = TestClient(prod_app, base_url="http://evil.example")
    assert evil.get("/api/health", headers={"Origin": "https://evil.example"}).status_code in (400, 403)
    r = c.get("/api/health", headers={"Origin": "https://pl.example"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


def test_no_public_url_means_no_cross_origin():
    app = create_app(make_config(UNREACHABLE_DB, public_url=""), storage=FakeStorage())
    try:
        c = TestClient(app, base_url="http://127.0.0.1:8080")
        assert c.get("/api/health").status_code == 200
        assert c.get("/api/health", headers={"Origin": "https://testserver"}).status_code == 403
    finally:
        app.state.db.close()


def test_dev_mode_keeps_host_origin_rule():
    app = create_app(make_config(UNREACHABLE_DB, public_url=""), storage=FakeStorage(url_base="/_dev_storage"),
                     dev=True)
    try:
        c = TestClient(app, base_url="http://127.0.0.1:8765")
        assert c.get("/api/health", headers={"Origin": "http://127.0.0.1:8765"}).status_code == 200
        assert c.get("/api/health", headers={"Origin": "https://evil.example"}).status_code == 403
    finally:
        app.state.db.close()


def test_request_id_and_health_commit(prod_app, caplog):
    c = TestClient(prod_app, base_url="http://127.0.0.1:8080")
    with caplog.at_level(logging.INFO, logger="paperlab.access"):
        r = c.get("/api/health", headers={"X-Request-Id": "req-123_ab.C"})
        bad = c.get("/api/health", headers={"X-Request-Id": 'x" injected\nline'})
    assert r.headers["x-request-id"] == "req-123_ab.C"
    assert bad.headers["x-request-id"] != 'x" injected\nline' and len(bad.headers["x-request-id"]) == 16
    assert '"request_id": "req-123_ab.C"' in caplog.text and "injected" not in caplog.text
    body = r.json()
    assert body["ok"] is True and body["commit"] == "abc1234" and body["version"].endswith("+abc1234")


def test_diag_hang_switch(monkeypatch):
    """AC-77 진단 스위치: 켜져 있으면 /api/health가 오래 멈춤(감시 작업이 응답 없음으로 판단)"""
    slept = []
    monkeypatch.setattr(server_mod.time, "sleep", lambda s: slept.append(s))
    flag = {"on": False}
    app = create_app(make_config(UNREACHABLE_DB), storage=FakeStorage(), diag_hang=lambda: flag["on"])
    try:
        c = TestClient(app)
        c.get("/api/health")
        assert slept == []
        flag["on"] = True
        c.get("/api/health")
        assert slept and slept[0] >= 30
    finally:
        app.state.db.close()


# ---------------------------------------------------------------- 허용 목록 끄기 (사용자 결정 · 팀장 결정)
def _auth_app(**cfg):
    from paperlab.auth import JWKSCache, TokenVerifier
    auth = LocalAuth()
    config = make_config(UNREACHABLE_DB, supabase_url=auth.URL, **cfg)
    verifier = TokenVerifier(auth.URL, jwks=JWKSCache(auth.URL + "/auth/v1/.well-known/jwks.json", fetch=auth.jwks))
    return create_app(config, storage=FakeStorage(), verifier=verifier), auth


@pytest.mark.parametrize("cfg,expect", [
    ({"allowlist_enabled": False, "allowed_emails": frozenset()}, 200),             # off: 목록 밖도 통과
    ({"allowlist_enabled": False, "allowed_emails": frozenset({"a@x.com"})}, 200),
    ({"allowlist_enabled": True, "allowed_emails": frozenset()}, 403),              # on + 빈 목록: 모두 403
    ({"allowed_emails": frozenset()}, 403),                                          # 기본값 on
    ({"allowed_emails": frozenset({"local@test.example"})}, 200),
])
def test_allowlist_on_off(cfg, expect, caplog):
    with caplog.at_level(logging.WARNING, logger="paperlab.server"):
        app, auth = _auth_app(**cfg)
    try:
        c = TestClient(app, headers={"Authorization": f"Bearer {auth.token()}"})
        r = c.get("/api/meta")
        assert r.status_code == expect, r.text
        if expect == 403:
            assert r.json()["code"] == "not_allowed"
            assert "허용 목록이 비어" in caplog.text
        if cfg.get("allowlist_enabled") is False:
            assert "허용 목록 꺼짐" in caplog.text
        # off여도 인증은 그대로: 토큰 없으면 401
        assert TestClient(app).get("/api/meta").status_code == 401
    finally:
        app.state.db.close()


def test_second_server_on_same_port_exits(tmp_path):
    """명세 9.1 단일 실행: 같은 포트를 이미 쓰고 있으면 두 번째 서버는 곧바로 종료 코드 ≠ 0 (작업 스케줄러 IgnoreNew와 이중)"""
    import socket
    f = write_env(tmp_path / "cloud.env", good_env(SUPABASE_APP_DB_URL="postgresql://paperlab_app.x:pw@127.0.0.1:9/d"))
    env = {k: v for k, v in os.environ.items()
           if not k.startswith(("SUPABASE", "R2_", "APP_ENCRYPTION", "ALLOWED", "PAPERLAB_", "STORAGE_"))}
    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        port = busy.getsockname()[1]
        p = subprocess.run([sys.executable, "-m", "paperlab.serve", "--env-file", str(f), "--port", str(port)],
                           env=env, capture_output=True, timeout=90, cwd=ROOT)
    assert p.returncode != 0


# ---------------------------------------------------------------- 품질팀 F1 · 2g · N2
def test_check_shows_allowlist_state(tmp_path, capsys, isolated):
    """F1: on + 빈 목록은 경고 줄(종료 코드 0 유지), 틀린 값은 '값 틀림'(on(0개)로 보이지 않음)"""
    f = write_env(tmp_path / "a.env", good_env(ALLOWED_EMAILS=None))
    assert serve.main(["--check", "--env-file", str(f)], acl_check=lambda p: "") == 0
    out = capsys.readouterr().out
    assert "허용 목록: on, 목록 비어 있음 → 모든 로그인 거부" in out and "on (0개)" not in out
    f = write_env(tmp_path / "b.env", good_env(PAPERLAB_ALLOWLIST="yes"))
    assert serve.main(["--check", "--env-file", str(f)], acl_check=lambda p: "") == 2
    out = capsys.readouterr().out
    assert "허용 목록 값 틀림(on/off만)" in out and "on (" not in out
    f = write_env(tmp_path / "c.env", good_env(PAPERLAB_ALLOWLIST="off", ALLOWED_EMAILS=None))
    assert serve.main(["--check", "--env-file", str(f)], acl_check=lambda p: "") == 0
    out = capsys.readouterr().out
    assert "허용 목록: off" in out and "모든 로그인 거부" not in out


@pytest.mark.parametrize("backend", ["supabase", "fake", "s3"])
def test_check_flags_unusable_storage_backend(tmp_path, capsys, isolated, backend):
    """2g: --check도 운영에서 쓸 수 없는 STORAGE_BACKEND를 문제로 표시"""
    f = write_env(tmp_path / "cloud.env", good_env(STORAGE_BACKEND=backend))
    assert serve.main(["--check", "--env-file", str(f)], acl_check=lambda p: "") == 2
    assert "STORAGE_BACKEND(" in capsys.readouterr().out


def test_deep_health_single_flight_and_short_timeout(monkeypatch):
    """N2: deep 확인은 한 번에 하나(진행 중이면 직전 결과 재사용), DB 연결 대기 · 문 실행에 짧은 제한"""
    import threading
    from contextlib import contextmanager

    seen = {"timeouts": [], "sql": [], "calls": 0}
    gate, entered = threading.Event(), threading.Event()

    class Conn:
        def execute(self, q, *a):
            seen["sql"].append(q)

    class FakeDB:
        @contextmanager
        def system_tx(self, reason, timeout=None):
            seen["calls"] += 1
            seen["timeouts"].append(timeout)
            entered.set()
            gate.wait(5)
            yield Conn()

        def close(self):
            pass

    app = create_app(make_config(UNREACHABLE_DB), database=FakeDB(), storage=FakeStorage())
    c = TestClient(app)
    gate.set()
    first = c.get("/api/health", params={"deep": 1}).json()
    assert first["db"] == "ok" and first["storage"] == "ok" and first["ok"] is True
    assert seen["timeouts"] == [server_mod.HEALTH_DB_TIMEOUT] and server_mod.HEALTH_DB_TIMEOUT <= 5
    assert any("set local statement_timeout" in q for q in seen["sql"])
    # 첫 확인이 진행 중일 때 들어온 요청은 기다리지 않고 직전 결과를 돌려줌
    gate.clear()
    entered.clear()
    t = threading.Thread(target=lambda: c.get("/api/health", params={"deep": 1}))
    t.start()
    assert entered.wait(5)
    during = c.get("/api/health", params={"deep": 1}).json()
    gate.set()
    t.join(10)
    assert during["db"] == "ok" and seen["calls"] == 2  # 세 번 불렀지만 DB 확인은 두 번
    app.state.db.close()


def test_deep_health_pending_before_first_result():
    """품질팀 M1: 재시작 직후 첫 확인이 진행 중이면 다른 요청은 error가 아니라 pending (ok=false — update.ps1이 다시 물음)"""
    import threading
    from contextlib import contextmanager

    gate, entered = threading.Event(), threading.Event()

    class Conn:
        def execute(self, q, *a):
            pass

    class SlowDB:
        @contextmanager
        def system_tx(self, reason, timeout=None):
            entered.set()
            gate.wait(5)
            yield Conn()

        def close(self):
            pass

    app = create_app(make_config(UNREACHABLE_DB), database=SlowDB(), storage=FakeStorage())
    c = TestClient(app)
    t = threading.Thread(target=lambda: c.get("/api/health", params={"deep": 1}))
    t.start()
    assert entered.wait(5)
    during = c.get("/api/health", params={"deep": 1}).json()
    gate.set()
    t.join(10)
    assert during == {**during, "ok": False, "db": "pending", "storage": "pending", "pending": True}
    after = c.get("/api/health", params={"deep": 1}).json()
    assert after["ok"] is True and "pending" not in after


def test_r2_health_uses_short_client():
    """품질팀 M1: R2 상태 확인은 짧은 설정의 전용 클라이언트(연결 · 읽기 3초, 재시도 1회)"""
    from paperlab.storage import HEALTH_TIMEOUT, R2Storage
    r2 = R2Storage("acct", "bucket", "AKIDFAKE", "secret-fake")
    cfg = r2.health_client.meta.config
    assert r2.health_client is not r2.client
    assert cfg.connect_timeout == HEALTH_TIMEOUT == 3 and cfg.read_timeout == 3
    assert cfg.retries["total_max_attempts"] == 2
    assert r2.client.meta.config.read_timeout == 60  # 일반 요청은 그대로

    calls = []

    class Fake:
        def head_bucket(self, Bucket):
            calls.append(Bucket)

    assert R2Storage("a", "b", "c", "d", client=Fake()).health() is True and calls == ["b"]
