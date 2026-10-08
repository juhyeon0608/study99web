"""DB 없이 도는 1단계 단위 테스트: 암호화 · 설정 · 관리 명령 도우미 · 요약 SSE · AI 키 · 코드 검사."""

import base64
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

from paperlab import ai as ai_mod
from paperlab.config import (ConfigError, ServerConfig, UserSettings, decode_encryption_key, load_env_file,
                             parse_allowed_emails, redact, split_settings_changes)
from paperlab.crypto import DecryptError, SecretBox, key_id

ROOT = Path(__file__).resolve().parent.parent
PKG = ROOT / "paperlab"


# ---------------------------------------------------------------- 암호화 (8.2 · 8.3, AC-45 · 47 일부)
def test_secretbox_roundtrip_and_aad():
    box = SecretBox(os.urandom(32))
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    plain = "sk-ant-test-0123456789abcdef"
    sealed = box.encrypt(a, "anthropic_api_key", plain)
    assert plain.encode() not in sealed.ciphertext and len(sealed.nonce) == 12
    assert sealed.key_id == box.current_id and sealed.hint == "cdef"
    assert box.decrypt(a, "anthropic_api_key", sealed.ciphertext, sealed.nonce, sealed.key_id) == plain
    # 다른 사용자 · 다른 이름 행으로 옮기면 복호화 실패
    with pytest.raises(DecryptError):
        box.decrypt(b, "anthropic_api_key", sealed.ciphertext, sealed.nonce, sealed.key_id)
    with pytest.raises(DecryptError):
        box.decrypt(a, "openalex_api_key", sealed.ciphertext, sealed.nonce, sealed.key_id)
    # 모르는 key_id · 변조
    with pytest.raises(DecryptError):
        box.decrypt(a, "anthropic_api_key", sealed.ciphertext, sealed.nonce, "00000000")
    with pytest.raises(DecryptError):
        box.decrypt(a, "anthropic_api_key", sealed.ciphertext[:-1] + bytes([sealed.ciphertext[-1] ^ 1]), sealed.nonce,
                    sealed.key_id)  # 마지막 바이트를 반드시 바꾼다 (원래 0이면 변조가 안 되던 1/256 흔들림)
    # 같은 값도 nonce가 달라 암호문이 다르다
    assert box.encrypt(a, "anthropic_api_key", plain).ciphertext != sealed.ciphertext


def test_key_rotation_reencrypts_with_new_key_id():
    old, new = os.urandom(32), os.urandom(32)
    uid = str(uuid.uuid4())
    sealed = SecretBox(old).encrypt(uid, "anthropic_api_key", "sk-ant-rotate-me-please")
    box = SecretBox(new, old)
    again = box.reencrypt(uid, "anthropic_api_key", sealed.ciphertext, sealed.nonce, sealed.key_id)
    assert again.key_id == key_id(new) != sealed.key_id
    assert SecretBox(new).decrypt(uid, "anthropic_api_key", again.ciphertext, again.nonce, again.key_id) == \
        "sk-ant-rotate-me-please"
    assert len(key_id(new)) == 8


def test_encryption_key_validation_names_only():
    """AC-46: 키가 없거나 32바이트가 아니면 시작하지 않고, 메시지에는 변수 이름만"""
    good = base64.b64encode(os.urandom(32)).decode()
    assert len(decode_encryption_key(good)) == 32
    for bad in ("", "not base64!!", base64.b64encode(b"short").decode(), base64.b64encode(os.urandom(48)).decode()):
        with pytest.raises(ConfigError) as e:
            decode_encryption_key(bad)
        assert e.value.names == ["APP_ENCRYPTION_KEY"]
        if bad:
            assert bad not in str(e.value)
    env = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_ANON_KEY": "a",
           "SUPABASE_APP_DB_URL": "postgresql://paperlab_app.ref:pw@h/d", "PAPERLAB_PUBLIC_URL": "https://pl.example",
           "ALLOWED_EMAILS": "a@b.c", "R2_ACCOUNT_ID": "a", "R2_BUCKET": "b", "R2_ACCESS_KEY_ID": "c",
           "R2_SECRET_ACCESS_KEY": "d"}
    with pytest.raises(ConfigError) as e:
        ServerConfig.from_env(env)
    assert e.value.names == ["APP_ENCRYPTION_KEY"]


# ---------------------------------------------------------------- 설정 (8.1)
def test_user_settings_public_shape():
    s = UserSettings({"ai_engine": "cli", "model": "claude-sonnet-5-5", "unknown": 1},
                     {"anthropic_api_key": "sk-ant-x"}, broken_secrets={"openalex_api_key"})
    pub = s.public()
    assert "ai_engine" not in pub  # 2단계: ai_engine은 읽지도 쓰지도 않음 (AC-31 대체)
    assert pub["ai_routing"] == {"summary": ["claude"], "chat": ["claude"], "write": ["claude"],
                                 "find": ["claude"], "verify": ["claude"]}  # 확정 U1 · 3단계 K-15
    assert pub["anthropic_api_key_set"] is True and pub["anthropic_api_key_status"] == "set"
    assert pub["openalex_api_key_set"] is False and pub["openalex_api_key_status"] == "unreadable"
    assert pub["semantic_scholar_api_key_status"] == "none"
    assert pub["env_api_key_set"] is False and "anthropic_api_key" not in pub and "unknown" not in pub
    assert pub["model"] == "claude-sonnet-5-5"


def test_split_settings_changes():
    plain, secrets = split_settings_changes({"model": "m", "anthropic_api_key": "sk-ant-1 ", "openalex_api_key": "",
                                             "semantic_scholar_api_key": None, "bogus": 1})
    assert plain == {"model": "m", "anthropic_api_key_last_error": None}  # 키를 다시 저장하면 최근 실패를 지움 (7.3절)
    assert secrets == {"anthropic_api_key": "sk-ant-1", "semantic_scholar_api_key": None}
    # 2단계 AC-31: ai_engine은 어떤 값이든 400이 아니고 무시
    assert split_settings_changes({"ai_engine": "cli"}) == ({}, {})


def test_allowed_emails_normalized():
    """AC-06 (정규화 부분)"""
    assert parse_allowed_emails("A@Test.example, b@test.example ,,") == {"a@test.example", "b@test.example"}


def test_redact_hides_credentials():
    s = redact('connection to "postgresql://postgres.ref:pa55word@host:5432/db" failed password=abc123 '
               "https://x/y?X-Amz-Signature=deadbeef&X-Amz-Credential=AKID/x")
    assert "pa55word" not in s and "abc123" not in s and "deadbeef" not in s and "AKID" not in s
    assert "host:5432" in s


def test_load_env_file(tmp_path):
    f = tmp_path / "x.env"
    f.write_text("# 주석\nA=1\nexport B='two'\nC=\"3\"\nD=from-file\n", encoding="utf-8")
    env = load_env_file(f, environ={"D": "from-env"})
    assert env["A"] == "1" and env["B"] == "two" and env["C"] == "3" and env["D"] == "from-env"


# ---------------------------------------------------------------- AI 키 (AC-48)
def test_server_env_api_key_is_never_used(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-server-env-key")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "server-token")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://evil.example")
    svc = ai_mod.AIService(UserSettings({}, {}).get)
    with pytest.raises(ai_mod.AIError) as e:
        svc._client()
    assert e.value.code == "api_no_key"
    user = ai_mod.AIService(UserSettings({}, {"anthropic_api_key": "sk-ant-user"}).get)
    # 승인자 L3: 사용자 키만 쓰고(환경의 토큰 · 키를 보지 않음), 주소는 환경 변수로 바뀌지 않음
    client = user._client()
    assert client.api_key == "sk-ant-user" and client.auth_token is None
    assert str(client.base_url).rstrip("/") == "https://api.anthropic.com"
    assert "Authorization" not in client.auth_headers and client.auth_headers.get("X-Api-Key") == "sk-ant-user"


def test_ai_error_messages_scrub_keys():
    svc = ai_mod.AIService({"anthropic_api_key": "sk-ant-user-secret-123456"}.get)
    assert "sk-ant-user-secret-123456" not in svc._scrub("bad key sk-ant-user-secret-123456 and sk-ant-another-999999")
    assert "another-999999" not in svc._scrub("sk-ant-another-999999")


# ---------------------------------------------------------------- 관리 명령 도우미
def test_app_conninfo_swaps_user_and_password_only():
    from paperlab.admin import app_conninfo, db_identity, project_ref
    admin = "postgresql://postgres.abcdref:adminpw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require"
    url = app_conninfo(admin, "n3w/pw")
    assert url == ("postgresql://paperlab_app.abcdref:n3w%2Fpw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"
                   "?sslmode=require")
    assert "adminpw" not in url
    assert project_ref("https://abcdref.supabase.co") == "abcdref"
    assert db_identity(admin) == ("aws-0-ap-northeast-2.pooler.supabase.com", "postgres.abcdref")


def test_mark_test_project_refuses_production():
    from paperlab.admin import AdminError, mark_test_project
    db = "postgresql://postgres.prodref:pw@pooler.example:5432/postgres"
    with pytest.raises(AdminError, match="운영"):
        mark_test_project(db, "https://prodref.supabase.co", "https://prodref.supabase.co", "", confirm=lambda _: "x")
    with pytest.raises(AdminError, match="운영"):
        mark_test_project(db, "https://testref.supabase.co", "https://prodref.supabase.co", db, confirm=lambda _: "x")
    with pytest.raises(AdminError, match="ref"):  # 사람이 친 ref가 틀리면 아무것도 안 함(DB 접속 전)
        mark_test_project("postgresql://postgres.testref:pw@pooler.example:5432/postgres",
                          "https://testref.supabase.co", "https://prodref.supabase.co", db, confirm=lambda _: "wrong")


def test_backup_rotation_keeps_14(tmp_path):
    """AC-70 (세대 정리 부분): 매일 백업 · 최근 14개 보관 — 15개가 되면 가장 오래된 것부터 지워 14개만.
    같은 날 다시 돌리면 그날 파일을 덮어쓴다(개수는 늘지 않음)."""
    from paperlab.admin import run_backup
    from paperlab.storage import FakeStorage
    fake = FakeStorage()
    for d in range(1, 16):
        fake.put(f"backups/db/202609{d:02d}.dump", b"old", "application/octet-stream")
    fake.put("users/" + str(uuid.uuid4()) + "/papers/1.pdf", b"%PDF")

    def dump(conninfo, path):
        path.write_bytes(b"PGDMP fake")

    res = run_backup("postgresql://unused/db", fake, today="20261007", dump=dump)
    keys = sorted(k for k in fake.objects if k.startswith("backups/"))
    assert res["key"] == "backups/db/20261007.dump" and fake.objects[res["key"]] == b"PGDMP fake"
    assert len(keys) == 14 and keys[0] == "backups/db/20260903.dump"
    assert res["removed"] == ["backups/db/20260901.dump", "backups/db/20260902.dump"]
    assert any(k.startswith("users/") for k in fake.objects)  # PDF는 건드리지 않음
    # 같은 날 두 번째 실행: 그날 파일을 덮어쓰고 개수는 그대로 14개
    def dump2(conninfo, path):
        path.write_bytes(b"PGDMP second")
    again = run_backup("postgresql://unused/db", fake, today="20261007", dump=dump2)
    keys2 = sorted(k for k in fake.objects if k.startswith("backups/"))
    assert again["key"] == res["key"] and fake.objects[res["key"]] == b"PGDMP second"
    assert keys2 == keys and again["removed"] == []


def test_migration_files_follow_naming():
    """AC-57 (이름 규칙)"""
    from paperlab.migrate import migration_files
    files = migration_files()
    assert files and all(re.match(r"^\d{14}_[a-z0-9_]+\.sql$", f.name) for f in files)
    assert [f.name for f in files] == sorted(f.name for f in files)


# ---------------------------------------------------------------- 정적 검사
SYSTEM_TABLES = {"allowed_emails", "schema_migrations"}
SHARED_TABLES = {"external_works", "citation_edges"}  # 인용 그래프 공용 캐시 (citation-graph 명세 8.4 · AC-G20)


def test_every_table_has_rls_and_policy_in_same_file():
    """AC-20 (정적): paperlab 표를 만드는 파일 안에 enable + force RLS, 개인 표는 authenticated 정책 · user_id 열.
    공용 캐시 표(AC-G20)는 user_id 대신 select 정책 하나 · authenticated 쓰기 권한 없음"""
    from paperlab.migrate import BOOTSTRAP, MIGRATIONS_DIR
    sources = {p.name: p.read_text(encoding="utf-8") for p in MIGRATIONS_DIR.glob("*.sql")}
    sources["migrate.py BOOTSTRAP"] = BOOTSTRAP
    tables = 0
    for name, text in sources.items():
        for m in re.finditer(r"create table (?:if not exists )?paperlab\.(\w+) \((.*?)\n\);", text, re.S):
            table, body = m.group(1), m.group(2)
            tables += 1
            assert f"alter table paperlab.{table} enable row level security;" in text, (name, table)
            assert f"alter table paperlab.{table} force row level security;" in text, (name, table)
            if table in SHARED_TABLES:
                assert f"create policy shared_read on paperlab.{table} for select to authenticated using (true);" in text
                assert len(re.findall(rf"create policy \w+ on paperlab\.{table}\b", text)) == 1, (name, table)
                assert not re.search(r"^\s+(user_id|\w*_by|ip|session\w*|\w*email\w*)\s", body, re.M), (name, table)
                assert not re.search(rf"grant [^;]*(insert|update|delete)[^;]*paperlab\.{table}[^;]* to authenticated", text)
                continue
            if table not in SYSTEM_TABLES:
                assert re.search(rf"create policy own_rows on paperlab\.{table} for all to authenticated\s+"
                                 r"using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\);",
                                 text), (name, table)
                assert re.search(r"^\s+user_id\s+uuid", body, re.M), (name, table)
                assert f"grant select, insert, update, delete on paperlab.{table} to authenticated;" in text
    assert tables >= 20


def _py_files():
    return [p for p in PKG.rglob("*.py")]


def test_db_connections_only_in_helpers():
    """AC-13: (1) 연결은 도우미 모듈(db.py)과 관리자 도구(migrate.py · admin.py) 밖에서 열지 않음,
    (2) LOCAL 없는 SET 문 · set_config(…, false) 없음, (3) system_tx( 호출은 모두 reason 인자"""
    allowed = {"db.py", "migrate.py", "admin.py"}
    for p in _py_files():
        text = p.read_text(encoding="utf-8")
        if p.name not in allowed:
            assert not re.search(r"psycopg\.connect\(|ConnectionPool\(|\.connection\(\)", text), p.name
        for m in re.finditer(r"""["']\s*(SET\s+(?!LOCAL\b)\w+)""", text, re.I):
            raise AssertionError(f"{p.name}: 세션 수준 SET 금지: {m.group(1)}")
        assert not re.search(r"set_config\([^)]*,\s*false\s*\)", text, re.I), p.name
        # 호출 지점(문서 문자열의 `Database.system_tx(reason)` 같은 설명은 제외)
        for m in re.finditer(r"(?<![`\w.])\w+\.system_tx\(([^)]*)\)", text):
            assert re.match(r"""\s*["'][^"']+["']""", m.group(1)), f"{p.name}: system_tx 에 reason 필요"


def test_boto3_only_in_storage():
    """AC-39a (코드 검사): boto3 호출은 storage.py 밖에 없음"""
    for p in _py_files():
        if p.name != "storage.py":
            assert not re.search(r"import boto3|from boto3|boto3\.|import botocore|from botocore", p.read_text(encoding="utf-8")), p.name


def test_cloud_run_files_removed():
    """AC-55 (개정 — 서버 PC): 옛 클라우드 배포 파일이 없고, 코드 · 스크립트 · 테스트에 그 배포 도구 흔적이 없음"""
    for name in ("Dockerfile", ".dockerignore", "deploy/deploy.ps1", "paperlab/cloud.py"):
        assert not (ROOT / name).exists(), name
    assert "*.env" in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    # 검색어는 이 파일 자체에 걸리지 않게 조각으로 만든다
    words = ["g" + "cloud", "Secret " + "Manager", "secret" + "manager", "Cloud " + "Scheduler", "Artifact " + "Registry",
             "asia-" + "northeast3", "x-cloud-" + "trace", "paperlab" + ".cloud", "Cloud " + "Run"]
    pattern = re.compile("|".join(re.escape(w) for w in words))
    roots = [ROOT / "paperlab", ROOT / "deploy", ROOT / "tests", ROOT / "supabase", ROOT / "pyproject.toml"]
    hits = []
    for base in roots:
        files = [base] if base.is_file() else [f for f in base.rglob("*") if f.is_file()]
        for f in files:
            if f.suffix.lower() not in (".py", ".ps1", ".json", ".toml", ".sql", ".js", ".html", ".css", ".md", ".txt"):
                continue
            if "vendor" in f.parts or "__pycache__" in f.parts:
                continue
            if f.name == "README.md" and f.parent.name == "server-pc":
                continue  # 서버 PC 안내서는 기획팀 문서(설명 속 '개정 전' 언급 — 명세 AC-55 검색 범위 밖)
            for n, line in enumerate(f.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if pattern.search(line):
                    hits.append(f"{f.relative_to(ROOT)}:{n}")
    assert hits == []


def test_launchers_removed():
    """11장: 설치형 실행기 삭제"""
    for name in ("PaperLab.bat", "PaperLab.command", "paperlab.sh"):
        assert not (ROOT / name).exists()


PROD_VARS = ("SUPABASE_URL", "SUPABASE_DB_URL", "SUPABASE_APP_DB_URL", "SUPABASE_SERVICE_ROLE_KEY",
             "SUPABASE_ANON_KEY")


def test_tests_read_production_vars_only_in_guard():
    """AC-72 (4): tests/ 안에서 운영 변수를 읽는 곳은 보호 장치의 비교 함수 하나뿐, R2_* 는 실환경 계약 테스트뿐"""
    read_re = re.compile(r"""(?:environ|getenv|env|file_vals|vals)\s*(?:\.get\(|\[|\()\s*["'](%s)["']""" % "|".join(PROD_VARS))
    for p in (ROOT / "tests").glob("*.py"):
        text = p.read_text(encoding="utf-8")
        for m in read_re.finditer(text):
            func = re.findall(r"^def (\w+)", text[:m.start()], re.M)
            assert p.name == "conftest.py" and func and func[-1] == "_guard_against_production", (p.name, m.group(0))
        for m in re.finditer(r"""(?:environ|getenv)\s*(?:\.get\(|\[|\()\s*["']R2_""", text):
            raise AssertionError(f"{p.name}: R2_* 직접 읽기")
        for m in re.finditer(r"^\s+\w+ = load_env_file\(\)", text, re.M):
            func = re.findall(r"^def (\w+)", text[:m.start()], re.M)
            assert p.name == "test_storage.py" and func[-1] == "test_r2_contract_live", p.name


def test_guard_stops_when_test_url_is_production(tmp_path):
    """AC-72 (1): SUPABASE_TEST_URL = SUPABASE_URL 이면 테스트가 하나도 돌지 않고 중단(종료 코드 ≠ 0, '운영 프로젝트')"""
    probe = tmp_path / "test_probe.py"
    probe.write_text("def test_should_not_run():\n    raise AssertionError('ran')\n", encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if not k.startswith("SUPABASE")}
    env.update({"SUPABASE_URL": "https://sameref.supabase.co", "SUPABASE_TEST_URL": "https://sameref.supabase.co",
                "PAPERLAB_ENV_FILE": str(tmp_path / "none.env"), "PYTHONIOENCODING": "utf-8"})
    p = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "tests.conftest", "--rootdir", str(ROOT),
                        "--confcutdir", str(tmp_path), str(probe)],
                       env=env, capture_output=True, text=True, encoding="utf-8", cwd=ROOT, timeout=300)
    out = p.stdout + p.stderr
    assert p.returncode != 0 and "운영 프로젝트" in out and "passed" not in out and "failed" not in out


# ---------------------------------------------------------------- 품질팀 결함 수정 (DB 없이)
def test_folder_name_rules():
    """F6: 제어 문자 · Windows 금지 문자 · 예약 이름 · 끝 마침표/공백"""
    from paperlab.db import folder_name_problem
    for ok in ("졸업논문", "2장 선행연구", "Data", "console", "a.b", "논문 (2)"):
        assert folder_name_problem(ok) == "", ok
    for bad in ("", "a/b", "a\b", "x:y", "q?", "*", '"', "<", ">", "|", "x\ny", "tab\there", "nul\x00", "del\x7f",
                "CON", "con.txt", "Com1", "LPT9", "aux", "a.", "a ", ".", "..", "x" * 101,
                # 승인자 L1: 줄 · 문단 구분 문자, 끝 줄바꿈(re `$`가 끝 줄바꿈 앞에서 맞던 문제)
                "a\u2028b", "a\u2029", "논문\n", "CON\n", "x" * 100 + "\n"):
        assert folder_name_problem(bad), repr(bad)


def test_compose_apply_bad_shape_is_400(local_client):
    """F7: rendered에 문자열 등 잘못된 형식 → 500이 아니라 400"""
    import io
    import docx
    d = docx.Document()
    d.add_paragraph("본문 [@k1] 그리고 [@k2]")
    buf = io.BytesIO()
    d.save(buf)
    store = local_client.app.state.compose_store
    store["tok1"] = {"uid": local_client.uid, "data": buf.getvalue(), "kind": "docx", "filename": "a.docx"}
    for body in ({"rendered": ["문자열"]}, {"rendered": [{"runs": "x"}]}, {"rendered": [{"runs": [3]}]},
                 {"rendered": [], "bibliography": ["x"]}, {"rendered": [], "bibliography": [[{"text": 1}]], "bib_title": 3},
                 {"rendered": {"a": 1}}):
        r = local_client.post("/api/compose/apply", json={"token": "tok1", **body})
        assert r.status_code == 400, (body, r.status_code, r.text[:200])
    ok = local_client.post("/api/compose/apply", json={"token": "tok1", "rendered": [{"runs": [{"text": "(A)"}]}],
                                                      "bibliography": []})
    assert ok.status_code == 200


def test_dev_storage_same_origin(tmp_path):
    """F10: 개발 서버는 같은 출처 가짜 저장소 경로로 올리고 받는다(서명 · 만료 검사). 운영(dev=False)에는 경로가 없다."""
    from fastapi.testclient import TestClient

    from paperlab.server import create_app
    from paperlab.storage import FakeStorage, incoming_key, new_upload_id, paper_key

    from .conftest import UNREACHABLE_DB, make_config
    store = FakeStorage(url_base="/_dev_storage")
    app = create_app(make_config(UNREACHABLE_DB), storage=store, dev=True)
    c = TestClient(app)
    uid = str(uuid.uuid4())
    key = incoming_key(uid, new_upload_id())
    url = store.create_upload(key)["url"]
    assert url.startswith("/_dev_storage/incoming/")
    assert c.put(url, content=b"%PDF dev").status_code == 200 and store.objects[key] == b"%PDF dev"
    assert c.put(url.replace("Signature=", "Signature=0"), content=b"x").status_code == 403
    assert store.browser_put(url, b"%PDF again") == 200
    pk = paper_key(uid, 3)
    store.objects[pk] = b"%PDF view"
    got = c.get(store.sign_get(pk)["url"])
    assert got.status_code == 200 and got.content == b"%PDF view" and got.headers["content-type"] == "application/pdf"
    assert c.get(f"/_dev_storage/{pk}?X-Amz-Expires=1&X-Amz-Signature=00").status_code == 403
    app.state.db.close()
    prod = create_app(make_config(UNREACHABLE_DB), storage=FakeStorage(url_base="/_dev_storage"), dev=False)
    assert TestClient(prod).put(url, content=b"x").status_code in (404, 405)
    prod.state.db.close()


def test_dev_config_uses_dev_values():
    """F10: 개발 서버는 앱 역할 주소 · 개발용 키 · 개발용 허용 목록 (운영 APP_ENCRYPTION_KEY · ALLOWED_EMAILS 안 씀)"""
    from paperlab.__main__ import dev_config
    env = {"SUPABASE_TEST_URL": "https://t.supabase.co", "SUPABASE_TEST_ANON_KEY": "anon", "SUPABASE_TEST_DB_URL": "x",
           "APP_ENCRYPTION_KEY": base64.b64encode(b"p" * 32).decode(), "ALLOWED_EMAILS": "prod@x.com",
           "PAPERLAB_DEV_ALLOWED_EMAILS": "Dev@x.com"}
    cfg = dev_config(env, app_db_url="postgresql://paperlab_app.ref:pw@h/db")
    assert cfg.db_url.startswith("postgresql://paperlab_app.") and cfg.allowed_emails == {"dev@x.com"}
    assert cfg.encryption_key != b"p" * 32 and cfg.storage_backend == "fake"


def test_dev_only_email_login_and_allowlist():
    """개발 서버만 이메일 로그인 플래그 · 모듈을 내보내고, 개발용 허용 목록이 비면 모두 허용. 운영은 둘 다 없음."""
    from fastapi.testclient import TestClient

    from paperlab.auth import Allowlist, NotAllowed
    from paperlab.server import create_app
    from paperlab.storage import FakeStorage

    from .conftest import UNREACHABLE_DB, make_config
    dev = create_app(make_config(UNREACHABLE_DB), storage=FakeStorage(url_base="/_dev_storage"), dev=True)
    prod = create_app(make_config(UNREACHABLE_DB, allowed_emails=frozenset()), storage=FakeStorage())
    try:
        assert TestClient(dev).get("/api/public-config").json()["dev_email_login"] is True
        assert TestClient(dev).get("/static/js/dev-login.js").status_code == 200
        assert "dev_email_login" not in TestClient(prod).get("/api/public-config").json()
        assert TestClient(prod).get("/static/js/dev-login.js").status_code == 404
        dev.state.allowlist.check({"email": "anyone@paperlab.test"})
        with pytest.raises(NotAllowed):
            prod.state.allowlist.check({"email": "anyone@paperlab.test"})  # 운영: 빈 목록이면 아무도 못 씀
        with pytest.raises(NotAllowed):
            Allowlist(["a@x.com"]).check({"email": "b@x.com"})
    finally:
        dev.state.db.close()
        prod.state.db.close()


@pytest.mark.parametrize("path", [
    "/static/js/dev-login.js", "/static/js//dev-login.js", "/static//js/dev-login.js", "/static/js/dev-login.js/",
    "/static/js/DEV-LOGIN.JS", "/static/JS/Dev-Login.js", "/static/js/./dev-login.js", "/static/js/dev-login.js.",
    "/static/js/dev-login.js%20", "/static/js/../js/dev-login.js", "/static/js/dev-login.js::$DATA",
])
def test_dev_login_module_hidden_in_production(path):
    """품질팀 N1: 운영 모드에서는 어떤 경로 표기로도 개발 전용 모듈을 내보내지 않는다 (개발 모드는 200)"""
    from fastapi.testclient import TestClient

    from paperlab.server import create_app
    from paperlab.storage import FakeStorage

    from .conftest import UNREACHABLE_DB, make_config
    prod = create_app(make_config(UNREACHABLE_DB), storage=FakeStorage())
    try:
        r = TestClient(prod).get(path)
        assert r.status_code == 404 or "signInWithPassword" not in r.text, (path, r.status_code)
        assert "mountDevLogin" not in r.text
        assert TestClient(prod).get("/static/js/app.js").status_code == 200  # 다른 정적 파일은 그대로
    finally:
        prod.state.db.close()


def test_dev_login_module_served_in_dev():
    from fastapi.testclient import TestClient

    from paperlab.server import create_app
    from paperlab.storage import FakeStorage

    from .conftest import UNREACHABLE_DB, make_config
    dev = create_app(make_config(UNREACHABLE_DB), storage=FakeStorage(url_base="/_dev_storage"), dev=True)
    try:
        assert "mountDevLogin" in TestClient(dev).get("/static/js/dev-login.js").text
    finally:
        dev.state.db.close()


@pytest.mark.parametrize("name", ["a\u0085b", "a\u0080", "\u009fx", "x\u008ay"])
def test_folder_name_rejects_c1_controls(name):
    """품질팀 N2: C1 제어 문자(U+0080~U+009F)도 거부 — DB [:cntrl:]과 같게"""
    from paperlab.db import folder_name_problem
    assert folder_name_problem(name)


# ---------------------------------------------------------------- 승인자 L2 · 허용 목록 끄기(사용자 결정)
@pytest.mark.parametrize("suffix", ["\n", "\r\n", "\n\n"])
def test_storage_keys_reject_trailing_newline(suffix):
    """L2: 키 · id 검사는 fullmatch — 끝 줄바꿈이 붙은 키 · id는 거부"""
    from paperlab.storage import StorageKeyError, check_user_key, incoming_key, is_upload_id, paper_key
    uid, up = str(uuid.uuid4()), str(uuid.uuid4())
    assert check_user_key(uid, paper_key(uid, 1)) and is_upload_id(up)
    for key in (paper_key(uid, 1) + suffix, incoming_key(uid, up) + suffix):
        with pytest.raises(StorageKeyError):
            check_user_key(uid, key)
    with pytest.raises(StorageKeyError):
        check_user_key(uid + suffix, paper_key(uid, 1))
    assert not is_upload_id(up + suffix)
    with pytest.raises(StorageKeyError):
        incoming_key(uid, up + suffix)


def test_allowlist_switch():
    """허용 목록: 기본 on, off일 때만 검사 안 함, on인데 빈 목록이면 모두 거부(빈 목록 = 전부 허용이 아님)"""
    from paperlab.auth import Allowlist, NotAllowed
    with pytest.raises(NotAllowed):
        Allowlist([]).check({"email": "anyone@x.com"})
    Allowlist([], enabled=False).check({"email": "anyone@x.com"})
    Allowlist(["a@x.com"], enabled=False).check({"email": "other@x.com"})
    env = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_ANON_KEY": "a",
           "SUPABASE_APP_DB_URL": "postgresql://paperlab_app.ref:pw@h/d", "PAPERLAB_PUBLIC_URL": "https://pl.example",
           "APP_ENCRYPTION_KEY": base64.b64encode(os.urandom(32)).decode(), "R2_ACCOUNT_ID": "a", "R2_BUCKET": "b",
           "R2_ACCESS_KEY_ID": "c", "R2_SECRET_ACCESS_KEY": "d"}
    cfg = ServerConfig.from_env(env)  # ALLOWED_EMAILS가 없어도 시작은 함 (켜져 있으면 모두 403 + 시작 로그 경고)
    assert cfg.allowlist_enabled is True and cfg.allowed_emails == frozenset()
    assert ServerConfig.from_env({**env, "PAPERLAB_ALLOWLIST": "on"}).allowlist_enabled is True
    assert ServerConfig.from_env({**env, "PAPERLAB_ALLOWLIST": "OFF"}).allowlist_enabled is False
    with pytest.raises(ConfigError) as e:
        ServerConfig.from_env({**env, "PAPERLAB_ALLOWLIST": "false"})  # on · off 말고는 거부(오타로 꺼지지 않게)
    assert e.value.names == ["PAPERLAB_ALLOWLIST"]
