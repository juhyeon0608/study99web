"""테스트 환경 (명세 10.2).

- DB가 필요한 테스트는 `@pytest.mark.db` + `project`/`cloud` 픽스처. **테스트용 Supabase 프로젝트**(SUPABASE_TEST_*)만 쓴다.
  값은 환경 변수, 없으면 cloud.env(PAPERLAB_ENV_FILE 또는 ~/.paperlab/cloud.env)에서 SUPABASE_TEST_* 줄만 읽는다.
- 운영 보호 장치(하나라도 걸리면 pytest.exit로 전체 중단):
  1. 테스트 프로젝트 ref · DB(호스트+사용자)가 운영과 같으면 중단 (_guard_against_production — 운영 변수를 읽는 유일한 곳)
  2. 테스트 DB에 public.paperlab_test_project 표지가 없으면 중단
  3. (운영 쪽) paperlab.migrate / admin 운영 명령은 표지가 있는 DB를 거부
  4. 테스트 코드는 운영 변수로 접속하지 않는다
- 접속 자체가 안 되면(비밀번호 오류 · 일시정지 · 네트워크) DB 테스트는 이유를 적고 건너뛴다.
- 저장소는 항상 가짜(FakeStorage). 실제 R2는 PAPERLAB_R2_CONTRACT=1 일 때만(test_storage.py).
"""

from __future__ import annotations

import os
import secrets
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import pymupdf
import pytest

from paperlab.config import DEFAULT_ENV_FILE, load_env_file, redact

SAMPLE = {
    "title": "Attention Is All You Need",
    "authors": [{"given": "Ashish", "family": "Vaswani"}, {"given": "Noam", "family": "Shazeer"},
                {"given": "Niki", "family": "Parmar"}],
    "year": 2017,
    "venue": "Advances in Neural Information Processing Systems",
    "volume": "30",
    "pages": "5998-6008",
    "doi": "10.48550/arxiv.1706.03762",
    "item_type": "conference",
    "abstract": "The dominant sequence transduction models are based on complex recurrent networks.",
}
TEST_VARS = ("SUPABASE_TEST_URL", "SUPABASE_TEST_ANON_KEY", "SUPABASE_TEST_SERVICE_ROLE_KEY", "SUPABASE_TEST_DB_URL")
RUN_ID = time.strftime("%Y%m%d%H%M%S") + secrets.token_hex(2)


def make_pdf(title: str = "Deep Residual Learning for Image Recognition",
             body: str = "We present a residual learning framework.", doi: str = "10.1109/cvpr.2016.90",
             pages: int = 2) -> bytes:
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page()
        if i == 0:
            page.insert_text((72, 90), title, fontsize=20)
            page.insert_text((72, 130), "Kaiming He, Xiangyu Zhang", fontsize=11)
            if doi:
                page.insert_text((72, 150), f"DOI: {doi}", fontsize=9)
            page.insert_text((72, 200), body, fontsize=10)
        else:
            page.insert_text((72, 90), f"Page {i + 1}: shortcut connections ease optimization.", fontsize=10)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def sample():
    return dict(SAMPLE)


# ====================================================================== 환경 · 보호 장치
def _env_file() -> Path:
    return Path(os.environ.get("PAPERLAB_ENV_FILE") or DEFAULT_ENV_FILE)


def test_env() -> dict:
    """SUPABASE_TEST_* 값만 (환경 변수 우선, 없으면 cloud.env)"""
    file_vals = load_env_file(_env_file(), environ={}) if _env_file().exists() else {}
    return {k: (os.environ.get(k) or file_vals.get(k) or "").strip() for k in TEST_VARS}


test_env.__test__ = False  # pytest가 테스트 함수로 모으지 않게


def _guard_against_production(tenv: dict) -> None:
    """운영 보호 장치 1번. 운영 변수(SUPABASE_URL · SUPABASE_DB_URL · SUPABASE_APP_DB_URL)는 **이 비교에만** 쓰고
    접속하지 않는다."""
    from paperlab.admin import db_identity, project_ref

    file_vals = load_env_file(_env_file(), environ={}) if _env_file().exists() else {}
    prod_url = os.environ.get("SUPABASE_URL") or file_vals.get("SUPABASE_URL") or ""
    prod_db = os.environ.get("SUPABASE_DB_URL") or file_vals.get("SUPABASE_DB_URL") or ""
    prod_app_db = os.environ.get("SUPABASE_APP_DB_URL") or file_vals.get("SUPABASE_APP_DB_URL") or ""
    if prod_app_db and tenv.get("SUPABASE_TEST_DB_URL"):
        # 앱 역할 주소는 사용자 이름이 paperlab_app.<ref>라 (호스트, 사용자)가 아니라 (호스트, 프로젝트 ref)로 비교
        (ph, pu), (th, tu) = db_identity(prod_app_db), db_identity(tenv["SUPABASE_TEST_DB_URL"])
        if ph and ph == th and pu.partition(".")[2] and pu.partition(".")[2] == tu.partition(".")[2]:
            pytest.exit("SUPABASE_TEST_DB_URL이 운영 프로젝트 DB(SUPABASE_APP_DB_URL)와 같아요. 운영 프로젝트 보호를 위해 "
                        "테스트를 중단합니다.", returncode=3)
    if prod_url and tenv.get("SUPABASE_TEST_URL") and project_ref(prod_url) == project_ref(tenv["SUPABASE_TEST_URL"]):
        pytest.exit("SUPABASE_TEST_URL이 운영 프로젝트(SUPABASE_URL)와 같아요. 운영 프로젝트 보호를 위해 테스트를 중단합니다.",
                    returncode=3)
    if prod_db and tenv.get("SUPABASE_TEST_DB_URL") and db_identity(prod_db) == db_identity(tenv["SUPABASE_TEST_DB_URL"]):
        pytest.exit("SUPABASE_TEST_DB_URL이 운영 프로젝트 DB(SUPABASE_DB_URL)와 같아요. 운영 프로젝트 보호를 위해 테스트를 중단합니다.",
                    returncode=3)


def pytest_configure(config):
    tenv = test_env()
    if any(tenv.values()):
        _guard_against_production(tenv)


# ====================================================================== 테스트 프로젝트
@dataclass
class TestUser:
    id: str
    email: str
    password: str
    token: str = ""

    __test__ = False


@dataclass
class TestProject:
    url: str
    anon_key: str
    service_key: str
    admin_db: str
    app_db: str
    created: list = field(default_factory=list)

    __test__ = False

    def _admin_headers(self) -> dict:
        h = {"apikey": self.service_key}
        if self.service_key.startswith("eyJ"):  # 레거시 JWT 형식 키만 Bearer로도 보낸다
            h["Authorization"] = f"Bearer {self.service_key}"
        return h

    def allow(self, email: str) -> None:
        import psycopg
        with psycopg.connect(self.admin_db, autocommit=True, prepare_threshold=None) as conn:
            conn.execute("insert into paperlab.allowed_emails (email) values (%s) on conflict do nothing", (email.lower(),))

    def disallow(self, email: str) -> None:
        import psycopg
        with psycopg.connect(self.admin_db, autocommit=True, prepare_threshold=None) as conn:
            conn.execute("delete from paperlab.allowed_emails where email = %s", (email.lower(),))

    def create_user(self, allowed: bool = True) -> TestUser:
        email = f"t-{RUN_ID}-{len(self.created) + 1}-{secrets.token_hex(3)}@paperlab.test"
        password = secrets.token_urlsafe(18)
        # Auth Hook이 admin 생성에도 걸릴 수 있으므로 먼저 허용 목록에 넣는다 (명세 10.2)
        self.allow(email)
        r = httpx.post(f"{self.url}/auth/v1/admin/users", headers=self._admin_headers(), timeout=30,
                       json={"email": email, "password": password, "email_confirm": True})
        r.raise_for_status()
        user = TestUser(id=r.json()["id"], email=email, password=password)
        self.created.append(user)
        r = httpx.post(f"{self.url}/auth/v1/token", params={"grant_type": "password"}, timeout=30,
                       headers={"apikey": self.anon_key}, json={"email": email, "password": password})
        r.raise_for_status()
        user.token = r.json()["access_token"]
        if not allowed:
            self.disallow(email)
        return user

    def delete_user(self, user: TestUser) -> None:
        httpx.delete(f"{self.url}/auth/v1/admin/users/{user.id}", headers=self._admin_headers(), timeout=30)
        self.disallow(user.email)

    def cleanup_stale(self) -> None:
        """지난 실행이 남긴 것 정리 (품질팀 F8):
        - 하루 넘은 테스트 사용자(t-…@paperlab.test) — 개인 행은 on delete cascade
        - 허용 목록의 t- 행 중 하루 넘은 것, 또는 1시간 넘었는데 그 이메일의 Auth 사용자가 없는 고아 행
          (DB가 끊겨 사용자 삭제 뒤 행 삭제를 못 한 경우 · 동시에 도는 다른 실행의 방금 넣은 행은 건드리지 않음)
        """
        import psycopg
        try:
            r = httpx.get(f"{self.url}/auth/v1/admin/users", params={"page": 1, "per_page": 1000},
                          headers=self._admin_headers(), timeout=30)
            users = r.json().get("users", []) if r.status_code == 200 else []
        except (httpx.HTTPError, ValueError):
            users = []
        cutoff = time.time() - 86400
        for u in users:
            email = u.get("email") or ""
            if not (email.startswith("t-") and email.endswith("@paperlab.test")):
                continue
            created = u.get("created_at") or ""
            try:
                ts = time.mktime(time.strptime(created[:19], "%Y-%m-%dT%H:%M:%S"))
            except ValueError:
                ts = 0
            if ts < cutoff:
                httpx.delete(f"{self.url}/auth/v1/admin/users/{u['id']}", headers=self._admin_headers(), timeout=30)
                self.disallow(email)
        with psycopg.connect(self.admin_db, autocommit=True, prepare_threshold=None) as conn:
            conn.execute(
                "delete from paperlab.allowed_emails a where a.email like 't-%%@paperlab.test' and ("
                "  a.added_at < now() - interval '1 day' or (a.added_at < now() - interval '1 hour' and not exists "
                "  (select 1 from auth.users u where lower(u.email) = a.email)))")


@pytest.fixture(scope="session")
def project():
    """테스트용 Supabase 프로젝트 준비: 보호 장치 → 마이그레이션 → 앱 역할 비밀번호(메모리) → 지난 실행 청소."""
    import psycopg

    from paperlab.admin import test_app_role_conninfo
    from paperlab.migrate import MigrationError, apply_migrations, is_test_project

    tenv = test_env()
    missing = [k for k in TEST_VARS if not tenv[k]]
    if missing:
        pytest.skip("테스트용 Supabase 값이 없어 DB 테스트를 건너뜀: " + ", ".join(missing))
    _guard_against_production(tenv)
    try:
        conn = psycopg.connect(tenv["SUPABASE_TEST_DB_URL"], autocommit=True, prepare_threshold=None, connect_timeout=15)
    except psycopg.Error as e:
        pytest.skip("테스트 DB에 접속하지 못해 DB 테스트를 건너뜀 (비밀번호 · 일시정지 · 네트워크 확인 — 일시정지면 "
                    "Supabase 대시보드에서 Restore): " + redact(str(e))[:300])
    with conn:
        if not is_test_project(conn):
            pytest.exit("테스트 프로젝트 표지(public.paperlab_test_project)가 없어요. "
                        "`python -m paperlab.admin mark-test-project`로 먼저 표지를 붙여 주세요. 테스트를 중단합니다.",
                        returncode=3)
    try:
        apply_migrations(tenv["SUPABASE_TEST_DB_URL"], target="test")
    except MigrationError as e:
        pytest.exit(f"테스트 프로젝트 마이그레이션 실패: {e}", returncode=3)
    if os.environ.get("PAPERLAB_TEST_DB_AS_ADMIN") == "1":
        app_db = tenv["SUPABASE_TEST_DB_URL"]  # 풀러가 앱 역할을 받지 않을 때 임시 대안 (AC-12a 실패 보고용)
    else:
        # 비밀번호를 바꾸지 않고 재사용 (동시 실행 · 풀러 차단 방지 — 품질팀 F1)
        app_db = test_app_role_conninfo(tenv["SUPABASE_TEST_DB_URL"])
    proj = TestProject(url=tenv["SUPABASE_TEST_URL"].rstrip("/"), anon_key=tenv["SUPABASE_TEST_ANON_KEY"],
                       service_key=tenv["SUPABASE_TEST_SERVICE_ROLE_KEY"], admin_db=tenv["SUPABASE_TEST_DB_URL"],
                       app_db=app_db)
    try:
        proj.cleanup_stale()
    except (httpx.HTTPError, psycopg.Error):
        pass
    yield proj
    for u in list(proj.created):
        try:
            proj.delete_user(u)
        except Exception:  # noqa: BLE001 - 정리 실패는 다음 세션 시작 때 청소
            pass


@pytest.fixture(scope="session")
def session_db(project):
    from paperlab.db import Database

    db = Database(project.app_db, timeout=20)
    yield db
    db.close()


@pytest.fixture
def users(project):
    """users() → 새 테스트 사용자. 테스트가 끝나면 지운다(개인 행은 on delete cascade)."""
    made = []

    def make(allowed: bool = True) -> TestUser:
        u = project.create_user(allowed)
        made.append(u)
        return u

    yield make
    for u in made:
        try:
            project.delete_user(u)
            project.created.remove(u)
        except Exception:  # noqa: BLE001
            pass


# ====================================================================== 가짜 외부 서비스
class FakeSources:
    def lookup_doi(self, doi):
        from paperlab.sources import SourceError
        if doi == "10.1109/cvpr.2016.90":
            return {"title": "Deep Residual Learning for Image Recognition", "doi": doi, "year": 2016,
                    "authors": [{"given": "Kaiming", "family": "He"}], "venue": "CVPR", "item_type": "conference"}
        raise SourceError("없음")

    def lookup_arxiv(self, arxiv_id):
        from paperlab.sources import SourceError
        raise SourceError("없음")

    def match_title(self, title):
        return None

    def resolve(self, text):
        return dict(SAMPLE, source="openalex")

    def search(self, *a, **kw):
        return {"items": [dict(SAMPLE, source="openalex")], "total": 1}

    def related(self, p, kind, page):
        return {"items": [], "total": 0}

    def download_pdf(self, url):
        return make_pdf(title="Downloaded Paper Title Here", doi="")


class FakeAI:
    fail = False

    def status(self):
        return {"engine": "api", "ready": True, "message": ""}

    def summarize(self, ctx, progress):
        from paperlab import ai as ai_mod
        progress("작성 중", 0.5)
        if self.fail:
            raise ai_mod.AIError("가짜 AI 오류")
        return ai_mod.normalize_summary({"tldr": f"{ctx.title} 요약", "keywords": ["resnet"]})

    def chat(self, ctx, history, question):
        yield {"type": "delta", "text": "답"}
        yield {"type": "done", "text": f"{len(ctx.page_texts)}쪽 논문입니다[1]",
               "citations": [{"n": 1, "page": 1, "end_page": 1, "text": "residual"}]}

    def write(self, mode, text, **kw):
        yield {"type": "done", "text": text}


def make_config(db_url: str, supabase_url: str = "https://test-ref.supabase.co", **kw):
    from paperlab.config import ServerConfig
    # 공개 주소: TestClient의 기본 Host(testserver)를 공개 호스트로 둔다 (명세 6.5 — Host 허용 목록 · Origin 기준)
    defaults = dict(supabase_url=supabase_url, supabase_anon_key="anon-public", db_url=db_url,
                    encryption_key=os.urandom(32), allowed_emails=frozenset(), storage_backend="fake",
                    public_url=TEST_PUBLIC_URL)
    defaults.update(kw)
    return ServerConfig(**defaults)


class Cloud:
    """테스트 프로젝트 + 가짜 저장소 + 실제 JWT로 만든 앱"""

    __test__ = False

    def __init__(self, project, session_db, users, ai=None, ai_factory=None, **cfg):
        from paperlab.server import create_app
        from paperlab.storage import FakeStorage

        self.project, self.users = project, users
        self.storage = FakeStorage()
        self.fake_ai = ai or FakeAI()
        config = make_config(project.app_db, supabase_url=project.url, supabase_anon_key=project.anon_key, **cfg)
        self.app = create_app(config, database=session_db, storage=self.storage,
                              sources_factory=lambda get: FakeSources(),
                              ai_factory=ai_factory or (lambda get: self.fake_ai))
        self.known_uids: set[str] = set()

    def user(self, allowed: bool = True) -> TestUser:
        u = self.users(allowed)
        if allowed:
            self.app.state.allowlist.emails = self.app.state.allowlist.emails | {u.email.lower()}
        self.known_uids.add(u.id)
        return u

    def client(self, user: TestUser | None = None, **headers):
        from fastapi.testclient import TestClient
        h = {"X-PaperLab": "1"}
        if user:
            h["Authorization"] = f"Bearer {user.token}"
        h.update(headers)
        return TestClient(self.app, headers=h)

    def upload(self, client, data: bytes, name: str = "paper.pdf", **complete) -> dict:
        """서명 주소 업로드 전체 흐름: uploads → (브라우저) PUT → complete"""
        slot = client.post("/api/uploads", json={"files": [{"name": name, "size": len(data)}]}).json()["files"][0]
        assert slot["backend"] == "r2" and slot["upload"]["method"] == "PUT"
        assert self.storage.browser_put(slot["upload"]["url"], data) == 200
        r = client.post(f"/api/uploads/{slot['upload_id']}/complete", json={"name": name, **complete})
        assert r.status_code == 200, r.text
        return r.json()

    def assert_keys_scoped(self) -> None:
        """AC-39: 사용자 요청이 만든 모든 저장소 키가 users/{uid}/ 또는 incoming/{uid}/ 로 시작"""
        for op, key in self.storage.log:
            if op == "list" and key == "backups/":
                continue
            assert any(key.startswith(f"users/{u}/") or key.startswith(f"incoming/{u}/") for u in self.known_uids), \
                (op, key)


@pytest.fixture
def cloud(project, session_db, users):
    c = Cloud(project, session_db, users)
    yield c
    c.assert_keys_scoped()


# ====================================================================== DB 없이 도는 앱 (변환 · 가져오기 API)
UNREACHABLE_DB = "postgresql://nobody:nopass@127.0.0.1:9/none?connect_timeout=1"
TEST_PUBLIC_URL = "https://testserver"


class LocalAuth:
    """테스트 안에서 만든 ES256 키로 서명한 토큰 + 그 키만 담은 가짜 JWKS (명세 10.2 시험 전용 경로)"""

    __test__ = False
    URL = "https://local-test.supabase.co"

    def __init__(self):
        from cryptography.hazmat.primitives.asymmetric import ec
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.uid = str(uuid.uuid4())
        self.email = "local@test.example"

    def jwks(self) -> dict:
        import json as _json

        import jwt
        jwk = _json.loads(jwt.algorithms.ECAlgorithm.to_jwk(self.key.public_key()))
        jwk.update(kid="local", alg="ES256")
        return {"keys": [jwk]}

    def token(self) -> str:
        import jwt
        now = int(time.time())
        return jwt.encode({"sub": self.uid, "email": self.email, "aud": "authenticated", "iss": self.URL + "/auth/v1",
                           "role": "authenticated", "exp": now + 3600}, self.key, algorithm="ES256",
                          headers={"kid": "local"})


@pytest.fixture
def local_client():
    """DB에 닿지 않는 앱 + 유효한 토큰. DB를 쓰는 경로는 503이 되므로 변환 · 가져오기처럼 DB가 필요 없는 API만."""
    from fastapi.testclient import TestClient

    from paperlab.auth import JWKSCache, TokenVerifier
    from paperlab.server import create_app
    from paperlab.storage import FakeStorage

    auth = LocalAuth()
    config = make_config(UNREACHABLE_DB, supabase_url=auth.URL, allowed_emails=frozenset({auth.email}),
                         db_pool_timeout=1.0)
    verifier = TokenVerifier(auth.URL, jwks=JWKSCache(auth.URL + "/auth/v1/.well-known/jwks.json", fetch=auth.jwks))
    app = create_app(config, storage=FakeStorage(), verifier=verifier)
    client = TestClient(app, headers={"Authorization": f"Bearer {auth.token()}", "X-PaperLab": "1"})
    client.auth_token = auth.token()
    client.uid = auth.uid
    yield client
    app.state.db.close()


@pytest.fixture
def client(cloud):
    """DB(테스트 프로젝트)를 쓰는 API 클라이언트 — 이 픽스처를 쓰는 테스트는 @pytest.mark.db"""
    return cloud.client(cloud.user())


@pytest.fixture
def keep_root_logging():
    """관리 명령 · 서버 진입점(main)이 루트 로거 처리기를 바꾸므로, 테스트가 끝나면 원래대로 돌리고 새 처리기는 닫는다"""
    import logging
    root = logging.getLogger()
    saved, level = list(root.handlers), root.level
    yield
    for h in root.handlers:
        if h not in saved:
            h.close()
    root.handlers[:] = saved
    root.setLevel(level)
