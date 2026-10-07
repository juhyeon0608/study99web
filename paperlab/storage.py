"""파일 저장소 (명세 7장). R2에는 RLS가 없으므로 사용자 분리는 **이 모듈의 키 규칙**에만 달려 있다.

키 규칙 (7.1절)
- 논문 PDF: users/{user_id}/papers/{paper_id}.pdf      ← paper_key()
- 올리는 중: incoming/{user_id}/{upload_id}.pdf        ← incoming_key()
- DB 백업:  backups/db/{YYYYMMDD}.dump                ← backup_key() (관리 명령 전용)

사용자 요청 경로는 `UserStorage`만 쓴다. 모든 동작이 키가 users/{uid}/ 또는 incoming/{uid}/로 시작하는지
다시 검사하고, 아니면 StorageKeyError(→ 404). boto3 호출은 이 파일 밖에 두지 않는다(AC-39a).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

log = logging.getLogger("paperlab.storage")

SIGN_TTL = 600  # 서명 주소 유효 10분 (가정)
HEALTH_TIMEOUT = 3  # 상태 확인(head_bucket)의 연결 · 읽기 제한(초)
MAX_PDF_BYTES = 100 * 1024 * 1024
PDF_TYPE = "application/pdf"
# 키 · id 검사는 항상 fullmatch (re.match + `$`는 끝 줄바꿈 앞에서도 맞음 — 승인자 L2)
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_PAPER_KEY_RE = re.compile(r"^users/([0-9a-f-]{36})/papers/([1-9][0-9]{0,18})\.pdf$")
_INCOMING_KEY_RE = re.compile(r"^incoming/([0-9a-f-]{36})/([0-9a-f-]{36})\.pdf$")
_BACKUP_KEY_RE = re.compile(r"^backups/db/\d{8}\.dump$")


class StorageError(Exception):
    pass


class StorageKeyError(StorageError):
    """규칙에 맞지 않는 키 (남의 경로 · backups/ · 경로 조작). 서버는 404로 응답한다."""


class NotFound(StorageError):
    pass


# ------------------------------------------------------------------ 키 규칙
def _check_uuid(value: str, what: str) -> str:
    if not isinstance(value, str) or not _UUID_RE.fullmatch(value):
        raise StorageKeyError(f"{what} 형식이 틀렸어요")
    return value


def paper_key(uid: str, paper_id: int) -> str:
    _check_uuid(uid, "사용자 id")
    if isinstance(paper_id, bool) or not isinstance(paper_id, int) or paper_id <= 0:
        raise StorageKeyError("논문 id 형식이 틀렸어요")
    return f"users/{uid}/papers/{paper_id}.pdf"


def incoming_key(uid: str, upload_id: str) -> str:
    _check_uuid(uid, "사용자 id")
    _check_uuid(upload_id, "업로드 id")
    return f"incoming/{uid}/{upload_id}.pdf"


def backup_key(day: str) -> str:
    key = f"backups/db/{day}.dump"
    if not _BACKUP_KEY_RE.fullmatch(key):
        raise StorageKeyError("백업 날짜 형식이 틀렸어요")
    return key


def check_user_key(uid: str, key: str) -> str:
    """키가 그 사용자의 users/{uid}/papers/{id}.pdf 또는 incoming/{uid}/{uuid}.pdf 인지 확인한다."""
    _check_uuid(uid, "사용자 id")
    if not isinstance(key, str) or not key:
        raise StorageKeyError("빈 키")
    m = _PAPER_KEY_RE.fullmatch(key) or _INCOMING_KEY_RE.fullmatch(key)
    if not m or m.group(1) != uid:
        raise StorageKeyError("이 사용자의 저장소 키가 아니에요")
    return key


def is_upload_id(value: str) -> bool:
    return isinstance(value, str) and bool(_UUID_RE.fullmatch(value))


def new_upload_id() -> str:
    return str(uuid.uuid4())


def _expires_at(ttl: int) -> str:
    return (datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=ttl)).isoformat()


def content_disposition(filename: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|\r\n]+', "_", filename or "paper").strip()[:150] or "paper"
    return f"inline; filename*=UTF-8''{quote(safe + '.pdf')}"


# ------------------------------------------------------------------ 백엔드
class Storage:
    """저장소 인터페이스. 키 검사는 UserStorage가 하고, 백엔드는 받은 키 그대로 동작한다."""

    backend = ""

    def create_upload(self, key: str, content_type: str = PDF_TYPE, ttl: int = SIGN_TTL) -> dict:
        raise NotImplementedError

    def sign_get(self, key: str, ttl: int = SIGN_TTL, filename: str = "") -> dict:
        raise NotImplementedError

    def get(self, key: str) -> bytes:
        raise NotImplementedError

    def head(self, key: str) -> int | None:
        """크기(바이트). 없으면 None"""
        raise NotImplementedError

    def modified(self, key: str) -> datetime | None:
        """마지막으로 올린 시각(UTC, 시간대 포함). 없으면 None"""
        raise NotImplementedError

    def put(self, key: str, data: bytes, content_type: str = PDF_TYPE) -> None:
        raise NotImplementedError

    def copy(self, src: str, dst: str) -> None:
        raise NotImplementedError

    def move(self, src: str, dst: str) -> None:
        self.copy(src, dst)
        self.delete(src)

    def delete(self, key: str) -> None:
        raise NotImplementedError

    def list_prefix(self, prefix: str) -> list[tuple[str, int]]:
        raise NotImplementedError

    def list_prefix_size(self, prefix: str) -> int:
        return sum(size for _, size in self.list_prefix(prefix))

    def health(self) -> bool:
        raise NotImplementedError


class FakeStorage(Storage):
    """테스트 전용 메모리 저장소. 모든 요청을 (동작, 키)로 기록한다(AC-39 검사용)."""

    backend = "fake"

    def __init__(self, bucket: str = "fake-bucket", url_base: str | None = None):
        self.bucket = bucket
        # 서명 주소 앞부분. 개발 서버는 같은 출처 경로("/_dev_storage")로 바꿔 브라우저가 실제로 올리고 받게 한다
        self.url_base = (url_base or f"https://fake-storage.test/{bucket}").rstrip("/")
        self.objects: dict[str, bytes] = {}
        self.mtimes: dict[str, datetime] = {}
        self.log: list[tuple[str, str]] = []
        self.fail_delete = False
        self._secret = uuid.uuid4().bytes
        self._lock = threading.Lock()

    def _record(self, op: str, key: str) -> None:
        with self._lock:
            self.log.append((op, key))

    def _signature(self, method: str, key: str, expires: int) -> str:
        return hmac.new(self._secret, f"{method}\n{key}\n{expires}".encode(), hashlib.sha256).hexdigest()

    def _sign(self, method: str, key: str, expires: int) -> str:
        sig = self._signature(method, key, expires)
        return f"{self.url_base}/{quote(key)}?X-Amz-Expires={expires}&X-Amz-Signature={sig}"

    def create_upload(self, key, content_type=PDF_TYPE, ttl=SIGN_TTL):
        self._record("sign_put", key)
        url = self._sign("PUT", key, int(time.time()) + ttl)
        return {"method": "PUT", "url": url, "headers": {"Content-Type": content_type}, "expires_at": _expires_at(ttl)}

    def sign_get(self, key, ttl=SIGN_TTL, filename=""):
        self._record("sign_get", key)
        return {"url": self._sign("GET", key, int(time.time()) + ttl), "expires_at": _expires_at(ttl)}

    def check_signed(self, method: str, key: str, expires: str, sig: str) -> bool:
        """서명 주소 검사 (서명 · 만료)"""
        try:
            exp = int(expires)
        except (TypeError, ValueError):
            return False
        good = self._signature(method, key, exp)
        return hmac.compare_digest(good, str(sig or "")) and exp >= time.time()

    def browser_put(self, url: str, data: bytes) -> int:
        """브라우저가 서명 주소로 PUT 하는 것을 흉내낸다(서명·만료 검사). 상태 코드를 돌려준다."""
        from urllib.parse import parse_qs, unquote, urlsplit
        if not url.startswith(self.url_base + "/"):
            return 400
        rest = urlsplit(url[len(self.url_base) + 1:])
        q = parse_qs(rest.query)
        key = unquote(rest.path)
        if not self.check_signed("PUT", key, (q.get("X-Amz-Expires") or [""])[0], (q.get("X-Amz-Signature") or [""])[0]):
            return 403
        with self._lock:
            self.objects[key] = bytes(data)
            self.mtimes[key] = datetime.now(timezone.utc)
        return 200

    def get(self, key):
        self._record("get", key)
        try:
            return self.objects[key]
        except KeyError:
            raise NotFound(key) from None

    def head(self, key):
        self._record("head", key)
        data = self.objects.get(key)
        return None if data is None else len(data)

    def modified(self, key):
        self._record("head", key)
        return self.mtimes.get(key) if key in self.objects else None

    def put(self, key, data, content_type=PDF_TYPE):
        self._record("put", key)
        with self._lock:
            self.objects[key] = bytes(data)
            self.mtimes[key] = datetime.now(timezone.utc)

    def copy(self, src, dst):
        self._record("copy", dst)
        with self._lock:
            if src not in self.objects:
                raise NotFound(src)
            self.objects[dst] = self.objects[src]
            self.mtimes[dst] = datetime.now(timezone.utc)

    def delete(self, key):
        self._record("delete", key)
        if self.fail_delete:
            raise StorageError("가짜 삭제 실패")
        with self._lock:
            self.objects.pop(key, None)

    def list_prefix(self, prefix):
        self._record("list", prefix)
        return sorted((k, len(v)) for k, v in self.objects.items() if k.startswith(prefix))

    def health(self):
        return True


class R2Storage(Storage):
    """Cloudflare R2 (S3 호환 API, boto3)."""

    backend = "r2"

    def __init__(self, account_id: str, bucket: str, access_key_id: str, secret_access_key: str, client=None,
                 health_client=None):
        self.bucket = bucket
        if client is None or health_client is None:
            import boto3
            from botocore.config import Config

            def make(config):
                return boto3.client(
                    "s3", endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
                    aws_access_key_id=access_key_id, aws_secret_access_key=secret_access_key,
                    region_name="auto", config=config)

            if client is None:
                client = make(Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"},
                                     connect_timeout=10, read_timeout=60))
                if health_client is None:
                    # /api/health?deep=1 전용: 짧게 (연결 · 읽기 각 3초, 재시도 1회 — 품질팀 M1)
                    health_client = make(Config(signature_version="s3v4", connect_timeout=HEALTH_TIMEOUT,
                                                read_timeout=HEALTH_TIMEOUT,
                                                retries={"total_max_attempts": 2, "mode": "standard"}))
        self.client = client
        self.health_client = health_client or client

    @staticmethod
    def _missing(e) -> bool:
        code = str(getattr(e, "response", {}).get("Error", {}).get("Code", ""))
        return code in ("404", "NoSuchKey", "NotFound")

    def create_upload(self, key, content_type=PDF_TYPE, ttl=SIGN_TTL):
        # Content-Type을 서명에 넣으면 다른 형식으로 올릴 때 R2가 403 (공식 문서)
        url = self.client.generate_presigned_url(
            "put_object", Params={"Bucket": self.bucket, "Key": key, "ContentType": content_type}, ExpiresIn=ttl)
        return {"method": "PUT", "url": url, "headers": {"Content-Type": content_type}, "expires_at": _expires_at(ttl)}

    def sign_get(self, key, ttl=SIGN_TTL, filename=""):
        params = {"Bucket": self.bucket, "Key": key, "ResponseContentType": PDF_TYPE}
        if filename:
            params["ResponseContentDisposition"] = content_disposition(filename)
        url = self.client.generate_presigned_url("get_object", Params=params, ExpiresIn=ttl)
        return {"url": url, "expires_at": _expires_at(ttl)}

    def get(self, key):
        from botocore.exceptions import ClientError
        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except ClientError as e:
            if self._missing(e):
                raise NotFound(key) from None
            raise StorageError("저장소에서 파일을 받지 못했어요") from None

    def _head(self, key) -> dict | None:
        from botocore.exceptions import ClientError
        try:
            return self.client.head_object(Bucket=self.bucket, Key=key)
        except ClientError as e:
            if self._missing(e):
                return None
            raise StorageError("저장소 파일 정보를 받지 못했어요") from None

    def head(self, key):
        h = self._head(key)
        return None if h is None else int(h["ContentLength"])

    def modified(self, key):
        h = self._head(key)
        return None if h is None else h["LastModified"]

    def put(self, key, data, content_type=PDF_TYPE):
        from botocore.exceptions import ClientError
        try:
            self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        except ClientError:
            raise StorageError("저장소에 파일을 올리지 못했어요") from None

    def copy(self, src, dst):
        from botocore.exceptions import ClientError
        try:
            self.client.copy_object(Bucket=self.bucket, Key=dst, CopySource={"Bucket": self.bucket, "Key": src})
        except ClientError as e:
            if self._missing(e):
                raise NotFound(src) from None
            raise StorageError("저장소에서 파일을 옮기지 못했어요") from None

    def delete(self, key):
        from botocore.exceptions import ClientError
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except ClientError:
            raise StorageError("저장소에서 파일을 지우지 못했어요") from None

    def list_prefix(self, prefix):
        out = []
        for page in self.client.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix):
            out += [(o["Key"], int(o["Size"])) for o in page.get("Contents", [])]
        return out

    def health(self):
        try:
            self.health_client.head_bucket(Bucket=self.bucket)
            return True
        except Exception:  # noqa: BLE001 - 상태 확인은 내용 없이 실패만 알린다
            return False


def create_storage(backend: str, r2: dict | None = None) -> Storage:
    """STORAGE_BACKEND → 구현. supabase는 자리만(1단계 구현 안 함)."""
    if backend == "r2":
        r2 = r2 or {}
        missing = [k for k in ("R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
                   if not r2.get(k)]
        if missing:
            from .config import ConfigError
            raise ConfigError("필요한 환경 변수가 비어 있어요: " + ", ".join(missing), missing)
        return R2Storage(r2["R2_ACCOUNT_ID"], r2["R2_BUCKET"], r2["R2_ACCESS_KEY_ID"], r2["R2_SECRET_ACCESS_KEY"])
    if backend == "fake":
        return FakeStorage()
    from .config import ConfigError
    if backend == "supabase":
        raise ConfigError("STORAGE_BACKEND=supabase 는 1단계에 구현하지 않았어요 (대안 자리만)", ["STORAGE_BACKEND"])
    raise ConfigError("STORAGE_BACKEND 값을 알 수 없어요", ["STORAGE_BACKEND"])


# ------------------------------------------------------------------ 사용자 범위
class UserStorage:
    """한 사용자(검증된 JWT의 sub) 범위의 저장소. 서버의 사용자 요청은 이것만 쓴다."""

    def __init__(self, storage: Storage, uid: str):
        self.storage = storage
        self.uid = _check_uuid(uid, "사용자 id")

    @property
    def backend(self) -> str:
        # 화면 어댑터가 보는 값. 가짜 저장소도 R2와 같은 방식(서명 PUT)이라 r2로 알린다
        return "r2" if self.storage.backend in ("r2", "fake") else self.storage.backend

    def paper_key(self, paper_id: int) -> str:
        return paper_key(self.uid, paper_id)

    def incoming_key(self, upload_id: str) -> str:
        return incoming_key(self.uid, upload_id)

    def check(self, key: str) -> str:
        return check_user_key(self.uid, key)

    def create_upload(self, key: str) -> dict:
        return self.storage.create_upload(self.check(key), PDF_TYPE)

    def sign_get(self, key: str, filename: str = "") -> dict:
        return self.storage.sign_get(self.check(key), filename=filename)

    def get(self, key: str) -> bytes:
        return self.storage.get(self.check(key))

    def head(self, key: str) -> int | None:
        return self.storage.head(self.check(key))

    def put(self, key: str, data: bytes) -> None:
        self.storage.put(self.check(key), data, PDF_TYPE)

    def move(self, src: str, dst: str) -> None:
        self.storage.move(self.check(src), self.check(dst))

    def delete(self, key: str) -> None:
        self.storage.delete(self.check(key))

    def delete_quietly(self, key: str) -> bool:
        """DB 커밋 뒤 정리용: 실패해도 로그(키는 남기지 않음)만 남기고 넘어간다."""
        try:
            self.delete(key)
            return True
        except StorageError as e:
            log.warning("storage delete failed user=%s: %s", self.uid, type(e).__name__)
            return False


class BackupSizeCache:
    """backups/ 객체 크기 합계 (5분 캐시, 명세 7.6)"""

    def __init__(self, storage: Storage, ttl: float = 300):
        self.storage = storage
        self.ttl = ttl
        self._value: int | None = None
        self._at = 0.0

    def get(self) -> int:
        if self._value is None or time.monotonic() - self._at > self.ttl:
            try:
                self._value = self.storage.list_prefix_size("backups/")
            except Exception:  # noqa: BLE001 - 사용량 표시는 실패해도 0으로
                self._value = self._value or 0
            self._at = time.monotonic()
        return self._value
