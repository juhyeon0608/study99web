"""user_secrets 암호화 (명세 8.2 · 8.3). 표준 모듈 `secrets`와 이름이 겹치지 않게 crypto.py.

- AES-256-GCM, 행마다 무작위 12바이트 nonce
- 추가 인증 데이터(AAD) = "{user_id}:{name}" → 암호문을 다른 사용자·다른 이름 행에 옮기면 복호화 실패
- key_id = sha256(키) 앞 8자(16진). 복호화 때 행의 key_id로 키를 고른다(회전 중 옛 키·새 키 공존)
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class DecryptError(Exception):
    """복호화 실패 (키 없음 · 변조 · 다른 행에서 복사). 메시지에 값은 넣지 않는다."""


def key_id(key: bytes) -> str:
    return hashlib.sha256(key).hexdigest()[:8]


def hint(value: str) -> str:
    """화면 표시용 끝 4자리 (가정). 짧은 값은 표시하지 않는다."""
    value = value or ""
    return value[-4:] if len(value) >= 12 else ""


def _aad(user_id: str, name: str) -> bytes:
    return f"{user_id}:{name}".encode("utf-8")


@dataclass
class Sealed:
    ciphertext: bytes
    nonce: bytes
    key_id: str
    hint: str


class SecretBox:
    """현재 키로 암호화하고, key_id에 맞는 키로 복호화한다."""

    def __init__(self, current: bytes, *older: bytes):
        for k in (current, *older):
            if len(k) != 32:
                raise ValueError("암호화 키는 32바이트여야 해요")
        self.current = current
        self.current_id = key_id(current)
        self._keys = {key_id(k): k for k in (*older, current)}

    def encrypt(self, user_id: str, name: str, plaintext: str) -> Sealed:
        nonce = os.urandom(12)
        ct = AESGCM(self.current).encrypt(nonce, plaintext.encode("utf-8"), _aad(user_id, name))
        return Sealed(ct, nonce, self.current_id, hint(plaintext))

    def decrypt(self, user_id: str, name: str, ciphertext: bytes, nonce: bytes, kid: str) -> str:
        key = self._keys.get(kid)
        if key is None:
            raise DecryptError("이 값을 암호화한 키가 없어요")
        try:
            return AESGCM(key).decrypt(bytes(nonce), bytes(ciphertext), _aad(user_id, name)).decode("utf-8")
        except (InvalidTag, ValueError):
            raise DecryptError("복호화에 실패했어요") from None

    def reencrypt(self, user_id: str, name: str, ciphertext: bytes, nonce: bytes, kid: str) -> Sealed:
        """회전: 옛 키로 풀어 현재 키로 다시 암호화 (명세 8.3)"""
        return self.encrypt(user_id, name, self.decrypt(user_id, name, ciphertext, nonce, kid))
