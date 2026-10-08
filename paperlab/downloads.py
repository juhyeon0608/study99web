"""PC 앱 설치 파일 내려주기 `/downloads/` · 처음 설치 정보 `GET /api/desktop/release` (2단계 명세 13.7.1절, K22~K24).

- 로그인 없이 공개(K22 ①). 허용 이름 정규식 + 폴더 기준 재확인(경로 순회 · 심볼릭 링크 밖 · 대체 데이터 스트림 차단), 목록 없음.
- Cache-Control: latest.yml = no-cache(ETag · Last-Modified로 304), 버전 파일 = public, max-age=31536000, immutable.
- 남용 방지: .exe 동시 전송 서버 전체 3개(넘으면 503 + Retry-After), 같은 IP .exe 시간당 10회(넘으면 429).
- 파일 위치: 환경 변수 PAPERLAB_RELEASES_DIR, 기본 D:\\PaperLab\\releases (팀장 지시). 서버는 이 폴더를 읽기만 한다.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from .worker_api import LOCAL_IPS, WindowLimit, client_ip

DEFAULT_RELEASES_DIR = r"D:\PaperLab\releases"
NAME_RE = re.compile(r"latest\.yml|PaperLab-Setup-\d{1,4}\.\d{1,4}\.\d{1,4}\.exe(\.blockmap)?")
EXE_CONCURRENT = 3
EXE_PER_IP_HOUR = 10
EXE_LOCAL_HOUR = 60  # 주소가 127.0.0.1(X-Forwarded-For 없음)이면 IP별로 나눌 수 없어 전체 시간당 60회
NOT_FOUND = {"detail": "찾을 수 없어요"}


def releases_dir(environ: dict | None = None) -> Path:
    env = os.environ if environ is None else environ
    return Path((env.get("PAPERLAB_RELEASES_DIR") or "").strip() or DEFAULT_RELEASES_DIR)


def safe_file(root: Path, name: str) -> Path | None:
    """허용 이름이고, 실제 경로(심볼릭 링크를 푼 뒤)의 부모가 releases 폴더 자체인 일반 파일만"""
    if not NAME_RE.fullmatch(name or ""):
        return None
    try:
        base = root.resolve(strict=True)
        path = (base / name).resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    if path.parent != base or path.name != name or not path.is_file():
        return None
    return path


def release_info(root: Path) -> dict | None:
    """release.json(update.ps1이 씀) → 화면용 {version, url, size, sha256, built_at}. 없거나 설치 파일이 없으면 None"""
    try:
        data = json.loads((root / "release.json").read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    name = str(data.get("file") or "")
    if not name.endswith(".exe") or not safe_file(root, name):
        return None
    sha = str(data.get("sha256") or "").lower()
    return {"version": str(data.get("version") or "")[:40], "url": f"/downloads/{name}",
            "size": int(data.get("size") or 0) if str(data.get("size") or "0").isdigit() else 0,
            "sha256": sha if re.fullmatch(r"[0-9a-f]{64}", sha) else "", "built_at": str(data.get("built_at") or "")[:40]}


class _Counted(FileResponse):
    """전송이 끝나거나 끊기면 동시 전송 자리를 돌려준다"""

    def __init__(self, *a, release=None, **kw):
        super().__init__(*a, **kw)
        self._release = release

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._release()


def register(app: FastAPI, root: Path, clock=time.monotonic) -> None:
    lock = threading.Lock()
    state = {"exe": 0}
    per_ip = WindowLimit(EXE_PER_IP_HOUR, 3600, clock)
    local_all = WindowLimit(EXE_LOCAL_HOUR, 3600, clock)
    app.state.downloads_limit = per_ip
    app.state.downloads_local_limit = local_all

    def release() -> None:
        with lock:
            state["exe"] -= 1

    @app.api_route("/downloads/{name}", methods=["GET", "HEAD"])
    def download(name: str, request: Request):
        path = safe_file(root, name)
        if path is None:
            return JSONResponse(NOT_FOUND, status_code=404)
        if name == "latest.yml":
            resp = FileResponse(path, media_type="text/yaml; charset=utf-8", headers={"Cache-Control": "no-cache"},
                                stat_result=os.stat(path))
            if request.headers.get("if-none-match") == resp.headers.get("etag"):  # 바뀌지 않았으면 304 (K24)
                return Response(status_code=304, headers={"ETag": resp.headers["etag"], "Cache-Control": "no-cache"})
            return resp
        headers = {"Cache-Control": "public, max-age=31536000, immutable"}
        if not name.endswith(".exe"):
            return FileResponse(path, media_type="application/octet-stream", headers=headers)
        if request.method == "HEAD":
            return FileResponse(path, media_type="application/octet-stream", filename=name, headers=headers)
        # 횟수는 전체 파일 GET만 센다. Range(차등 받기 · 이어 받기)는 동시 전송 제한만 (품질팀 M3)
        ip = client_ip(request)
        allowed = "range" in request.headers or (local_all.hit("all") if ip in LOCAL_IPS else per_ip.hit(ip))
        if not allowed:
            return JSONResponse({"detail": "잠시 후 다시 받아 주세요", "code": "rate_limited"}, status_code=429,
                                headers={"Retry-After": "600"})
        with lock:
            if state["exe"] >= EXE_CONCURRENT:
                return JSONResponse({"detail": "지금 받는 사람이 많아요. 1분 뒤 다시 받아 주세요", "code": "busy"},
                                    status_code=503, headers={"Retry-After": "60"})
            state["exe"] += 1
        return _Counted(path, media_type="application/octet-stream", filename=name, headers=headers, release=release)

    @app.get("/api/desktop/release")
    def desktop_release():
        info = release_info(root)
        if not info:
            return JSONResponse({"detail": "PC 앱을 준비 중이에요", "code": "not_ready"}, status_code=404)
        return info

    app.state.release_info = lambda: release_info(root)
    app.state.exe_state = state
