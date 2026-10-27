"""외부 HTTPS 접속의 인증서 묶음(certifi)을 프로세스에서 한 번만 읽기 (2026-10-28 — 검색이 늘 5초 넘게 걸리던 원인).

httpx는 Client를 만들 때마다 certifi CA 파일을 새로 읽어 SSL 문맥을 만든다. 서버 PC에서 실측하니 한 번에 1.7초라
(OpenAlex 응답 자체는 1~2초) 외부 검색 · PDF 받기 · API 키 AI 호출이 매번 그만큼 늦었다. 같은 문맥을 나눠 쓴다
(ssl.SSLContext는 여러 스레드가 함께 써도 된다). 검증 방식은 httpx 기본과 같다(certifi 묶음 · 호스트 이름 확인).
"""

from __future__ import annotations

import functools
import ssl

import certifi


@functools.cache
def context() -> ssl.SSLContext:
    return ssl.create_default_context(cafile=certifi.where())
