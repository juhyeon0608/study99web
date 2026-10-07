"""Supabase access token(JWT) 검증과 허용 목록 확인 (명세 6.3 ③ · 6.4).

- SUPABASE_JWT_SECRET이 비어 있으면 비대칭 키(JWKS, ES256·RS256만), 있으면 레거시 HS256
- JWKS는 10분 이하로 캐시하고, 모르는 kid가 오면 한 번 다시 받아 본다
- 검사: 서명, exp(시계 오차 30초), aud == "authenticated", iss == SUPABASE_URL/auth/v1,
  role == "authenticated", sub가 uuid. 하나라도 틀리면 AuthError(→ 401)
- 토큰 원문은 로그·예외 메시지에 넣지 않는다
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from typing import Callable

import httpx
import jwt
from jwt import PyJWK

ASYMMETRIC_ALGS = ("ES256", "RS256")
JWKS_TTL = 600  # 공식 문서: 엔드포인트가 10분 캐시되므로 더 길게 캐시하지 않는다
LEEWAY = 30  # exp 시계 오차 (가정)
JWKS_MIN_REFRESH = 30.0  # 모르는 kid로 다시 받는 최소 간격(초)


class AuthError(Exception):
    """인증 실패. 메시지는 화면에 보여도 되는 짧은 이유만."""


class NotAllowed(Exception):
    """허용 목록 밖 계정"""


def bearer_token(header: str | None) -> str | None:
    if not header:
        return None
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


class JWKSCache:
    """JWKS를 받아 kid → 키로 보관한다. fetch는 테스트에서 가짜 JWKS 서버로 바꿔 넣는다.

    공격자가 모르는 kid 토큰을 계속 보내 인증을 느리게 만들지 못하게(품질팀 F2):
    - 다시 받기는 최소 간격(min_refresh, 기본 30초)마다 한 번 — 실패한 시도도 간격에 포함
    - 받는 동안 전역 잠금을 잡지 않는다. 한 번에 한 요청만 받고, 다른 요청은 기다리지 않고 지금 키로 판단
      (키가 하나도 없을 때만 받는 요청을 기다림)
    - 다시 받기에 실패하면 옛 키를 그대로 쓴다(만료 지나도)
    """

    def __init__(self, url: str, fetch: Callable[[], dict] | None = None, ttl: float = JWKS_TTL,
                 min_refresh: float = JWKS_MIN_REFRESH, clock: Callable[[], float] = time.monotonic):
        self.url = url
        self.ttl = min(ttl, JWKS_TTL)
        self.min_refresh = min_refresh
        self._clock = clock
        self._fetch = fetch or self._http_fetch
        self._keys: dict[str, PyJWK] = {}
        self._loaded_at = float("-inf")
        self._attempt_at = float("-inf")
        self._state_lock = threading.Lock()   # 짧은 상태 읽기 · 쓰기만
        self._fetch_lock = threading.Lock()   # 동시에 한 번만 받기
        self.fetch_count = 0

    def _http_fetch(self) -> dict:
        r = httpx.get(self.url, timeout=5)
        r.raise_for_status()
        return r.json()

    def _parse(self, data: dict) -> dict[str, PyJWK]:
        keys: dict[str, PyJWK] = {}
        for jwk in (data or {}).get("keys", []):
            kid = jwk.get("kid")
            if not kid or jwk.get("alg") not in (None, *ASYMMETRIC_ALGS):
                continue
            try:
                keys[kid] = PyJWK.from_dict(jwk)
            except jwt.PyJWTError:
                continue
        return keys

    def _maybe_refresh(self, wait: bool) -> None:
        with self._state_lock:
            if self._clock() - self._attempt_at < self.min_refresh and self._keys:
                return
        if not self._fetch_lock.acquire(blocking=wait):
            return  # 다른 요청이 받는 중: 기다리지 않는다
        try:
            with self._state_lock:
                if self._clock() - self._attempt_at < self.min_refresh and self._keys:
                    return
                self._attempt_at = self._clock()
            try:
                data = self._fetch()  # 네트워크: 잠금(_state_lock) 밖
            except Exception:  # noqa: BLE001 - 못 받으면 옛 키로 계속
                return
            keys = self._parse(data)
            with self._state_lock:
                self.fetch_count += 1
                if keys:
                    self._keys = keys
                    self._loaded_at = self._clock()
        finally:
            self._fetch_lock.release()

    def get(self, kid: str) -> PyJWK:
        with self._state_lock:
            key = self._keys.get(kid)
            fresh = self._clock() - self._loaded_at <= self.ttl
            empty = not self._keys
        if key is None or not fresh:
            # 키가 하나도 없으면 받을 때까지 기다리고, 아니면 받는 중인 요청이 있어도 기다리지 않는다
            self._maybe_refresh(wait=empty)
            with self._state_lock:
                key = self._keys.get(kid)
        if key is None:
            raise AuthError("알 수 없는 서명 키예요")
        return key


class TokenVerifier:
    def __init__(self, supabase_url: str, jwt_secret: str = "", jwks: JWKSCache | None = None,
                 leeway: int = LEEWAY):
        self.issuer = supabase_url.rstrip("/") + "/auth/v1"
        self.jwt_secret = jwt_secret or ""
        self.leeway = leeway
        self.jwks = None if self.jwt_secret else (jwks or JWKSCache(self.issuer + "/.well-known/jwks.json"))

    def verify(self, token: str) -> dict:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            raise AuthError("토큰 형식이 틀렸어요") from None
        alg = header.get("alg")
        if self.jwt_secret:
            algorithms, key = ["HS256"], self.jwt_secret
            if alg != "HS256":
                raise AuthError("허용되지 않은 서명 방식이에요")
        else:
            if alg not in ASYMMETRIC_ALGS:
                raise AuthError("허용되지 않은 서명 방식이에요")
            kid = header.get("kid")
            if not kid:
                raise AuthError("서명 키 id가 없어요")
            jwk = self.jwks.get(kid)
            if jwk.algorithm_name and jwk.algorithm_name != alg:
                raise AuthError("서명 방식이 키와 맞지 않아요")
            algorithms, key = [alg], jwk.key
        try:
            claims = jwt.decode(token, key, algorithms=algorithms, audience="authenticated", issuer=self.issuer,
                                leeway=self.leeway, options={"require": ["exp", "sub", "aud", "iss"]})
        except jwt.ExpiredSignatureError:
            raise AuthError("로그인이 만료됐어요") from None
        except jwt.PyJWTError:
            raise AuthError("토큰을 확인하지 못했어요") from None
        if claims.get("role") != "authenticated":
            raise AuthError("로그인한 사용자 토큰이 아니에요")
        try:
            sub = str(uuid.UUID(str(claims["sub"])))
        except ValueError:
            raise AuthError("사용자 id가 틀렸어요") from None
        if claims.get("is_anonymous") is True:
            # 익명 로그인 토큰은 받지 않는다 (심층 방어 — 품질팀 N3)
            raise AuthError("익명 로그인 토큰은 쓸 수 없어요")
        if sub != claims["sub"]:
            raise AuthError("사용자 id가 틀렸어요")
        return claims


class Allowlist:
    """서버 쪽 허용 목록 확인 (명세 6.3 ③).

    - enabled=False: 운영 설정 `PAPERLAB_ALLOWLIST=off`일 때만(사용자 결정 — 관문은 Google OAuth 동의 화면 "테스트" 상태의
      테스트 사용자 목록). JWT 검증 · RLS · Origin 검사는 그대로다. **빈 목록을 "모두 허용"으로 보지 않는다** — 켜져 있는데
      목록이 비면 모든 요청이 403.
    - allow_all: 개발 서버 전용(개발용 허용 목록이 비면 테스트 프로젝트의 로그인 사용자 모두 — 127.0.0.1에서만 뜸).
    """

    def __init__(self, emails, allow_all: bool = False, enabled: bool = True):
        self.emails = frozenset(e.strip().lower() for e in emails if e and e.strip())
        self.allow_all = allow_all
        self.enabled = enabled

    def check(self, claims: dict) -> None:
        if not self.enabled:
            return
        email = str(claims.get("email") or "").strip().lower()
        if self.allow_all and email:
            return
        if not email or email not in self.emails:
            raise NotAllowed()


def claims_json(claims: dict) -> str:
    """DB request.jwt.claims 로 넘길 JSON"""
    return json.dumps(claims, ensure_ascii=False, separators=(",", ":"))
