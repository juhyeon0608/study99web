"""저장소 (AC-39a · 45a · R2 서명 로직). 가짜 저장소는 자동, 실제 R2는 PAPERLAB_R2_CONTRACT=1 일 때만."""

import os
import re
import time
import uuid
from urllib.parse import parse_qs, urlsplit

import pytest

from paperlab import storage as st
from paperlab.config import ConfigError, ServerConfig

UID = str(uuid.uuid4())
OTHER = str(uuid.uuid4())


# ---------------------------------------------------------------- 키 규칙 (AC-39a)
def test_key_builders_validate_inputs():
    assert st.paper_key(UID, 12) == f"users/{UID}/papers/12.pdf"
    up = str(uuid.uuid4())
    assert st.incoming_key(UID, up) == f"incoming/{UID}/{up}.pdf"
    for bad_uid in ("", "x", UID.upper(), "../" + UID, UID + "/..", None):
        with pytest.raises(st.StorageKeyError):
            st.paper_key(bad_uid, 1)
    for bad_id in (0, -1, "1", 1.5, True, None):
        with pytest.raises(st.StorageKeyError):
            st.paper_key(UID, bad_id)
    for bad_up in ("", "../x", "not-a-uuid", UID.upper()):
        with pytest.raises(st.StorageKeyError):
            st.incoming_key(UID, bad_up)
    assert st.backup_key("20261007") == "backups/db/20261007.dump"
    with pytest.raises(st.StorageKeyError):
        st.backup_key("2026-10-07")


def test_prefix_check_rejects_everything_else():
    good = [st.paper_key(UID, 3), st.incoming_key(UID, str(uuid.uuid4()))]
    for key in good:
        assert st.check_user_key(UID, key) == key
    bad = [st.paper_key(OTHER, 3), st.incoming_key(OTHER, str(uuid.uuid4())), "backups/db/20261007.dump", "",
           f"users/{UID}/../x", f"users/{UID}/papers/../../{OTHER}/papers/1.pdf", f"users/{UID}/papers/1.pdf/../2.pdf",
           f"users/{UID}/other.pdf", f"users/{UID}/papers/01.pdf", f"/users/{UID}/papers/1.pdf",
           f"users/{UID}/papers/1.pdf ", f"incoming/{UID}/x.pdf", f"users/{UID}/papers/1.PDF", None]
    for key in bad:
        with pytest.raises(st.StorageKeyError):
            st.check_user_key(UID, key)


def test_user_storage_rechecks_every_operation():
    fake = st.FakeStorage()
    mine = st.UserStorage(fake, UID)
    theirs = st.paper_key(OTHER, 1)
    fake.put(theirs, b"%PDF other")
    for op in (lambda: mine.get(theirs), lambda: mine.head(theirs), lambda: mine.sign_get(theirs),
               lambda: mine.create_upload(theirs), lambda: mine.delete(theirs), lambda: mine.put(theirs, b"x"),
               lambda: mine.move(theirs, mine.paper_key(1)), lambda: mine.get("backups/db/20261007.dump")):
        with pytest.raises(st.StorageKeyError):
            op()
    assert fake.objects[theirs] == b"%PDF other"
    assert all(k.startswith(f"users/{OTHER}/") for _, k in fake.log)  # 위의 직접 put 한 건만


# ---------------------------------------------------------------- 계약 테스트 (AC-45a)
def contract(backend: st.Storage, uid: str) -> None:
    """올리기 · 서명 · 받기 · 이동 · 삭제 · 없는 키 · 남의 접두어 거부. 끝나면 만든 것을 지운다."""
    us = st.UserStorage(backend, uid)
    up = st.new_upload_id()
    inc, final = us.incoming_key(up), us.paper_key(987654)
    try:
        slot = us.create_upload(inc)
        assert slot["method"] == "PUT" and slot["headers"] == {"Content-Type": "application/pdf"}
        assert slot["expires_at"].endswith("+00:00")
        us.put(inc, b"%PDF-1.4 contract")
        assert us.head(inc) == len(b"%PDF-1.4 contract")
        assert us.get(inc) == b"%PDF-1.4 contract"
        us.move(inc, final)
        assert us.head(inc) is None and us.get(final) == b"%PDF-1.4 contract"
        signed = us.sign_get(final, filename="제목: 테스트")
        assert signed["url"].startswith("https://") and "X-Amz-Signature=" in signed["url"]
        with pytest.raises(st.NotFound):
            us.get(us.paper_key(987655))
        assert us.head(us.paper_key(987655)) is None
        with pytest.raises(st.StorageKeyError):
            us.get(st.paper_key(str(uuid.uuid4()), 1))
        us.delete(final)
        assert us.head(final) is None
    finally:
        for k in (inc, final):
            try:
                backend.delete(k)
            except st.StorageError:
                pass


def test_fake_storage_contract():
    contract(st.FakeStorage(), UID)


def test_fake_signed_put_checks_signature_and_expiry():
    fake = st.FakeStorage()
    key = st.incoming_key(UID, st.new_upload_id())
    url = fake.create_upload(key)["url"]
    assert fake.browser_put(url, b"%PDF ok") == 200 and fake.objects[key] == b"%PDF ok"
    tampered = url.replace(UID, OTHER)
    assert fake.browser_put(tampered, b"x") == 403
    expired = fake.create_upload(key, ttl=-5)["url"]
    assert fake.browser_put(expired, b"x") == 403


@pytest.mark.r2
@pytest.mark.skipif(os.environ.get("PAPERLAB_R2_CONTRACT") != "1", reason="실환경 R2 계약 테스트는 PAPERLAB_R2_CONTRACT=1 일 때만")
def test_r2_contract_live():
    """[실환경] AC-45a: 존재하지 않는 임의 uuid 사용자 경로에서 실행 후 삭제. R2_* 를 읽는 유일한 곳."""
    from paperlab.config import load_env_file
    env = load_env_file()
    backend = st.create_storage("r2", {k: env.get(k, "") for k in ("R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID",
                                                                     "R2_SECRET_ACCESS_KEY")})
    contract(backend, str(uuid.uuid4()))


# ---------------------------------------------------------------- R2 서명 로직 (오프라인)
def _r2(client=None):
    return st.R2Storage("acct123", "papers-bucket", "AKIDEXAMPLE", "secretEXAMPLEsecretEXAMPLE", client=client)


def test_r2_presigned_put_signs_content_type():
    r2 = _r2()
    key = st.incoming_key(UID, st.new_upload_id())
    slot = r2.create_upload(key)
    u = urlsplit(slot["url"])
    q = parse_qs(u.query)
    assert u.scheme == "https" and u.hostname in ("acct123.r2.cloudflarestorage.com",
                                                   "papers-bucket.acct123.r2.cloudflarestorage.com")
    assert key in u.path
    assert q["X-Amz-Expires"] == ["600"] and q["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
    assert "content-type" in q["X-Amz-SignedHeaders"][0]
    assert "/auto/s3/aws4_request" in q["X-Amz-Credential"][0]
    assert slot["headers"] == {"Content-Type": "application/pdf"}


def test_r2_presigned_get_inline_pdf():
    r2 = _r2()
    signed = r2.sign_get(st.paper_key(UID, 5), filename="Attention Is All You Need")
    q = parse_qs(urlsplit(signed["url"]).query)
    assert q["response-content-type"] == ["application/pdf"]
    assert q["response-content-disposition"][0].startswith("inline; filename*=UTF-8''Attention")
    assert q["X-Amz-Expires"] == ["600"]


def test_r2_operations_with_stubbed_client():
    import io

    import boto3
    from botocore.response import StreamingBody
    from botocore.stub import Stubber

    client = boto3.client("s3", endpoint_url="https://acct123.r2.cloudflarestorage.com", region_name="auto",
                          aws_access_key_id="AKID", aws_secret_access_key="SECRET")
    r2 = _r2(client)
    key = st.paper_key(UID, 7)
    with Stubber(client) as stub:
        stub.add_response("head_object", {"ContentLength": 42}, {"Bucket": "papers-bucket", "Key": key})
        stub.add_client_error("head_object", "404", http_status_code=404,
                              expected_params={"Bucket": "papers-bucket", "Key": key})
        stub.add_response("get_object", {"Body": StreamingBody(io.BytesIO(b"%PDF"), 4)},
                          {"Bucket": "papers-bucket", "Key": key})
        stub.add_client_error("get_object", "NoSuchKey", http_status_code=404)
        stub.add_response("copy_object", {}, {"Bucket": "papers-bucket", "Key": key,
                                              "CopySource": {"Bucket": "papers-bucket", "Key": "incoming/x"}})
        stub.add_response("delete_object", {}, {"Bucket": "papers-bucket", "Key": key})
        stub.add_response("list_objects_v2", {"Contents": [{"Key": "backups/db/20261001.dump", "Size": 10},
                                                           {"Key": "backups/db/20261008.dump", "Size": 5}],
                                              "IsTruncated": False}, {"Bucket": "papers-bucket", "Prefix": "backups/"})
        stub.add_response("head_bucket", {}, {"Bucket": "papers-bucket"})
        assert r2.head(key) == 42
        assert r2.head(key) is None
        assert r2.get(key) == b"%PDF"
        with pytest.raises(st.NotFound):
            r2.get(key)
        r2.copy("incoming/x", key)
        r2.delete(key)
        assert r2.list_prefix_size("backups/") == 15
        assert r2.health() is True
        stub.assert_no_pending_responses()


# ---------------------------------------------------------------- STORAGE_BACKEND (AC-45a)
BASE_ENV = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_ANON_KEY": "anon",
            "SUPABASE_APP_DB_URL": "postgresql://paperlab_app.x:pw@h/db", "PAPERLAB_PUBLIC_URL": "https://pl.example",
            "APP_ENCRYPTION_KEY": "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=", "ALLOWED_EMAILS": "a@test.example",
            "R2_ACCOUNT_ID": "acct-value-1", "R2_BUCKET": "bucket-value-2", "R2_ACCESS_KEY_ID": "akid-value-3",
            "R2_SECRET_ACCESS_KEY": "secret-value-4"}


def test_storage_backend_default_and_validation():
    cfg = ServerConfig.from_env(dict(BASE_ENV))
    assert cfg.storage_backend == "r2"
    assert isinstance(st.create_storage(cfg.storage_backend, cfg.r2), st.R2Storage)
    for missing in ("R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"):
        env = dict(BASE_ENV)
        env[missing] = ""
        with pytest.raises(ConfigError) as e:
            ServerConfig.from_env(env)
        assert e.value.names == [missing]
        assert "value" not in str(e.value)  # 값은 메시지에 없음
    with pytest.raises(ConfigError) as e:
        ServerConfig.from_env(dict(BASE_ENV, STORAGE_BACKEND="s3"))
    assert e.value.names == ["STORAGE_BACKEND"]
    # 가짜 저장소는 테스트 · 개발 서버 전용 — 운영 설정(from_env)은 거부 (승인자 L5)
    fake_env = {k: v for k, v in BASE_ENV.items() if not k.startswith("R2_")}
    with pytest.raises(ConfigError) as e:
        ServerConfig.from_env(dict(fake_env, STORAGE_BACKEND="fake"))
    assert e.value.names == ["STORAGE_BACKEND"]
    with pytest.raises(ConfigError):
        st.create_storage("supabase")


def test_backup_size_cache():
    fake = st.FakeStorage()
    fake.put("backups/db/20261001.dump", b"x" * 10, "application/octet-stream")
    cache = st.BackupSizeCache(fake, ttl=300)
    assert cache.get() == 10
    fake.put("backups/db/20261008.dump", b"x" * 5, "application/octet-stream")
    assert cache.get() == 10  # 5분 캐시
    cache.ttl = -1
    assert cache.get() == 15
