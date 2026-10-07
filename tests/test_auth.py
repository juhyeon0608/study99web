"""인증 · 요청 규칙 (AC-01 · 02 · 04 · 07 · 08 · 09 · 10 · 56 일부). DB 없이 도는 단위 · 앱 테스트.

토큰은 테스트 안에서 만든 키로 서명한다(검증기에 JWKS 가져오기를 주입하는 시험 경로 — 명세 10.2).
"""

import base64
import json
import time
import uuid

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from paperlab.auth import Allowlist, AuthError, JWKSCache, NotAllowed, TokenVerifier, bearer_token
from paperlab.server import create_app
from paperlab.storage import FakeStorage

from .conftest import make_config

URL = "https://test-ref.supabase.co"
ISS = URL + "/auth/v1"
UNREACHABLE_DB = "postgresql://nobody:nopass@127.0.0.1:9/none?connect_timeout=1"


class Keys:
    """ES256 키 쌍 + 가짜 JWKS 서버"""

    def __init__(self):
        self.keys = {}
        self.fetches = 0
        self.add("kid-1")

    def add(self, kid):
        priv = ec.generate_private_key(ec.SECP256R1())
        self.keys[kid] = priv
        return priv

    def jwks(self):
        self.fetches += 1
        out = []
        for kid, priv in self.keys.items():
            jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(priv.public_key()))
            jwk.update(kid=kid, alg="ES256", use="sig")
            out.append(jwk)
        return {"keys": out}

    def token(self, kid="kid-1", **over):
        now = int(time.time())
        claims = {"sub": str(uuid.uuid4()), "email": "a@test.example", "aud": "authenticated", "iss": ISS,
                  "role": "authenticated", "exp": now + 3600, "iat": now}
        claims.update(over)
        claims = {k: v for k, v in claims.items() if v is not None}
        return jwt.encode(claims, self.keys[kid], algorithm="ES256", headers={"kid": kid})


@pytest.fixture
def keys():
    return Keys()


@pytest.fixture
def verifier(keys):
    return TokenVerifier(URL, jwks=JWKSCache(ISS + "/.well-known/jwks.json", fetch=keys.jwks))


def _b64(d: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()


def test_valid_token_returns_claims(keys, verifier):
    claims = verifier.verify(keys.token(email="A@Test.example"))
    assert claims["role"] == "authenticated" and claims["aud"] == "authenticated"


@pytest.mark.parametrize("over", [
    {"exp": int(time.time()) - 120},          # 만료
    {"aud": "anon"},                           # aud 다름
    {"iss": "https://other.supabase.co/auth/v1"},  # iss 다름
    {"role": "anon"},                          # role: anon
    {"sub": "not-a-uuid"},                     # sub가 uuid 아님
    {"exp": None},                             # exp 없음
])
def test_bad_claims_rejected(keys, verifier, over):
    with pytest.raises(AuthError):
        verifier.verify(keys.token(**over))


def test_expiry_leeway_30s(keys, verifier):
    verifier.verify(keys.token(exp=int(time.time()) - 10))  # 시계 오차 30초 허용
    with pytest.raises(AuthError):
        verifier.verify(keys.token(exp=int(time.time()) - 60))


def test_bad_signature_and_alg_none(keys, verifier):
    other = Keys()
    with pytest.raises(AuthError):
        verifier.verify(other.token())  # 같은 kid, 다른 키로 서명
    good = keys.token()
    head, body, _ = good.split(".")
    none_tok = _b64({"alg": "none", "typ": "JWT", "kid": "kid-1"}) + "." + body + "."
    with pytest.raises(AuthError):
        verifier.verify(none_tok)
    unsigned = head + "." + body + "."
    with pytest.raises(AuthError):
        verifier.verify(unsigned)
    with pytest.raises(AuthError):
        verifier.verify("garbage")


def test_hs256_rejected_in_jwks_mode(keys, verifier):
    claims = jwt.decode(keys.token(), options={"verify_signature": False})
    tok = jwt.encode(claims, "x" * 32, algorithm="HS256", headers={"kid": "kid-1"})
    with pytest.raises(AuthError):
        verifier.verify(tok)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_jwks_refetch_on_unknown_kid(keys):
    """AC-10: 키 교체 — 모르는 kid가 오면 JWKS를 다시 받아 검증 (최소 간격 30초가 지난 뒤)"""
    clock = Clock()
    v = TokenVerifier(URL, jwks=JWKSCache("x", fetch=keys.jwks, clock=clock))
    v.verify(keys.token())
    assert keys.fetches == 1
    keys.add("kid-2")
    clock.t += 31
    v.verify(keys.token(kid="kid-2"))
    assert keys.fetches == 2


def test_jwks_unknown_kid_is_rate_limited(keys):
    """품질팀 F2: 모르는 kid 토큰을 계속 보내도 30초에 한 번만 다시 받는다"""
    clock = Clock()
    cache = JWKSCache("x", fetch=keys.jwks, clock=clock)
    v = TokenVerifier(URL, jwks=cache)
    v.verify(keys.token())
    bogus = Keys()
    bogus.keys = {"kid-unknown": bogus.keys["kid-1"]}
    for _ in range(50):
        with pytest.raises(AuthError):
            v.verify(bogus.token(kid="kid-unknown"))
    assert keys.fetches == 1
    clock.t += 31
    with pytest.raises(AuthError):
        v.verify(bogus.token(kid="kid-unknown"))
    assert keys.fetches == 2
    v.verify(keys.token())  # 원래 키는 계속 됨


def test_jwks_fetch_failure_keeps_old_keys_and_does_not_block(keys):
    import threading
    clock = Clock()
    state = {"fail": False}
    gate = threading.Event()

    def fetch():
        if state["fail"]:
            gate.wait(5)
            raise RuntimeError("down")
        return keys.jwks()

    cache = JWKSCache("x", fetch=fetch, clock=clock)
    v = TokenVerifier(URL, jwks=cache)
    v.verify(keys.token())
    state["fail"] = True
    clock.t += 700  # ttl(10분) 지남 → 다시 받기 시도 (느리게 실패)
    t = threading.Thread(target=lambda: cache.get("kid-1"))
    t.start()
    import time as _t
    _t.sleep(0.2)
    started = _t.perf_counter()
    v.verify(keys.token())  # 받는 중인 요청을 기다리지 않고 옛 키로 통과
    assert _t.perf_counter() - started < 1.0
    gate.set()
    t.join()
    v.verify(keys.token())  # 실패 뒤에도 옛 키 사용


def test_jwks_cache_ttl_at_most_10_minutes(keys):
    cache = JWKSCache("x", fetch=keys.jwks, ttl=3600)
    assert cache.ttl <= 600


def test_hs256_secret_mode():
    """AC-10: SUPABASE_JWT_SECRET이 있으면 HS256 토큰이 통과하고 ES256 경로는 쓰지 않음"""
    secret = "s" * 40
    fetched = []
    v = TokenVerifier(URL, jwt_secret=secret, jwks=JWKSCache("x", fetch=lambda: fetched.append(1) or {"keys": []}))
    now = int(time.time())
    claims = {"sub": str(uuid.uuid4()), "aud": "authenticated", "iss": ISS, "role": "authenticated", "exp": now + 60}
    assert v.verify(jwt.encode(claims, secret, algorithm="HS256"))["sub"] == claims["sub"]
    with pytest.raises(AuthError):
        v.verify(jwt.encode(claims, "wrong" * 10, algorithm="HS256"))
    with pytest.raises(AuthError):
        v.verify(Keys().token())  # ES256 토큰은 거부
    assert v.jwks is None and fetched == []


def test_allowlist_and_bearer():
    al = Allowlist(["A@Test.example ", "b@test.example"])
    al.check({"email": "a@test.example"})
    al.check({"email": "B@TEST.EXAMPLE"})
    for claims in ({"email": "c@test.example"}, {}, {"email": ""}):
        with pytest.raises(NotAllowed):
            al.check(claims)
    assert bearer_token("Bearer abc") == "abc"
    assert bearer_token("bearer  abc ") == "abc"
    assert bearer_token("Basic abc") is None and bearer_token("") is None and bearer_token("Bearer ") is None


# ---------------------------------------------------------------- 앱 수준 (DB 없이)
@pytest.fixture
def app_env(keys, verifier):
    config = make_config(UNREACHABLE_DB, supabase_url=URL, allowed_emails=frozenset({"a@test.example"}),
                         db_pool_timeout=1.5)
    app = create_app(config, storage=FakeStorage(), verifier=verifier)
    yield app, keys
    app.state.db.close()


def test_public_endpoints_without_token(app_env):
    """AC-01"""
    app, _ = app_env
    c = TestClient(app)
    r = c.get("/api/papers")
    assert r.status_code == 401 and r.json()["code"] == "auth_required"
    assert c.get("/api/health").status_code == 200
    pc = c.get("/api/public-config").json()
    assert pc == {"supabase_url": URL, "supabase_anon_key": "anon-public"}
    assert c.get("/").status_code == 200
    assert c.get("/static/js/app.js").status_code == 200
    assert c.get("/static/js/app.js").headers["content-type"].startswith("text/javascript")


def test_bad_tokens_get_401(app_env):
    """AC-02 (앱 경로)"""
    app, keys = app_env
    c = TestClient(app)
    for tok in (keys.token(exp=int(time.time()) - 120), keys.token(aud="x"), keys.token(role="anon"), "abc.def.ghi"):
        r = c.get("/api/papers", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401 and r.json()["code"] == "auth_required"


def test_not_allowed_email_gets_403(app_env):
    """AC-04: 유효한 토큰이어도 허용 목록 밖이면 403 not_allowed"""
    app, keys = app_env
    c = TestClient(app)
    r = c.get("/api/papers", headers={"Authorization": f"Bearer {keys.token(email='c@test.example')}"})
    assert r.status_code == 403 and r.json()["code"] == "not_allowed"


def test_write_requires_x_paperlab(app_env):
    """AC-07: X-PaperLab 없는 쓰기 요청 → 403 (DB에 닿기 전)"""
    app, keys = app_env
    c = TestClient(app, headers={"Authorization": f"Bearer {keys.token()}"})
    assert c.post("/api/papers", json={"title": "x"}).status_code == 403
    assert c.patch("/api/manuscripts/1", json={}).status_code == 403
    assert c.delete("/api/doc-formats/user-1").status_code == 403
    assert c.get("/api/meta").status_code == 200  # GET은 헤더 없이도 됨


def test_origin_rules_and_headers(app_env):
    """AC-08 · AC-09"""
    app, keys = app_env
    c = TestClient(app, headers={"Authorization": f"Bearer {keys.token()}", "X-PaperLab": "1"})
    for origin in ("https://evil.example", "null", "http://testserver"):
        r = c.get("/api/meta", headers={"Origin": origin})
        assert r.status_code == 403, origin
    r = c.get("/api/meta", headers={"Origin": "https://testserver"})
    assert r.status_code == 200
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}
    assert r.headers["cache-control"] == "no-store" and r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "same-origin" and r.headers["x-frame-options"] == "DENY"
    assert c.get("/").headers["x-content-type-options"] == "nosniff"
    assert r.headers["strict-transport-security"] == "max-age=31536000"  # includeSubDomains 없음 (ts.net 공유)
    meta = r.json()
    assert "data_dir" not in meta and "models" in meta


def test_static_revalidates_with_304(app_env):
    """정적 파일: no-cache(매번 재검증) + ETag가 같으면 304. index.html은 no-store 그대로"""
    app, _ = app_env
    c = TestClient(app)
    assert c.get("/").headers["cache-control"] == "no-store"
    for path in ("/static/js/app.js", "/static/css/app.css", "/static/vendor/d3/d3-force.min.js"):
        r = c.get(path)
        assert r.status_code == 200 and r.headers["cache-control"] == "no-cache", path
        assert r.headers["strict-transport-security"] == "max-age=31536000"
        again = c.get(path, headers={"If-None-Match": r.headers["etag"]})
        assert again.status_code == 304 and again.headers["cache-control"] == "no-cache" and not again.content, path


def test_db_unavailable_returns_503(app_env):
    """AC-56 (일부): DB에 닿지 않아도 health는 200, deep은 db error, 데이터 요청은 503 db_unavailable"""
    app, keys = app_env
    c = TestClient(app, headers={"Authorization": f"Bearer {keys.token()}", "X-PaperLab": "1"})
    assert c.get("/api/health").json()["ok"] is True
    deep = c.get("/api/health", params={"deep": 1}).json()
    assert deep["db"] == "error" and deep["storage"] == "ok" and deep["ok"] is False
    r = c.get("/api/papers")
    assert r.status_code == 503 and r.json()["code"] == "db_unavailable"


def test_removed_endpoints_are_gone(app_env):
    """15장: /api/upload · /api/papers/{id}/pdf · /api/jobs/{id} 삭제"""
    app, keys = app_env
    c = TestClient(app, headers={"Authorization": f"Bearer {keys.token()}", "X-PaperLab": "1"})
    assert c.post("/api/upload").status_code in (404, 405)
    assert c.get("/api/papers/1/pdf").status_code in (404, 405)
    assert c.get("/api/jobs/abc").status_code in (404, 405)


def test_head_health_allowed(app_env):
    """품질팀 F5"""
    app, _ = app_env
    c = TestClient(app)
    assert c.head("/api/health").status_code == 200
    assert c.get("/api/health").json()["ok"] is True


def test_anonymous_token_rejected(keys, verifier):
    """품질팀 N3: is_anonymous=true 토큰은 401 (role이 authenticated여도)"""
    with pytest.raises(AuthError):
        verifier.verify(keys.token(is_anonymous=True))
    assert verifier.verify(keys.token(is_anonymous=False))["sub"]
