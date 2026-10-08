"""AC-87: `/downloads/` 설치 파일 내려주기 · `GET /api/desktop/release` (2단계 13.7.1절) — DB 없이 임시 releases 폴더."""

from __future__ import annotations

import hashlib
import json
import os
import threading

import pytest
from fastapi.testclient import TestClient

from paperlab import downloads

from .conftest import UNREACHABLE_DB, LocalAuth, make_config

EXE = b"MZ" + bytes(range(256)) * 40
YML = b"version: 0.2.0\nfiles:\n  - url: PaperLab-Setup-0.2.0.exe\n"


@pytest.fixture
def rel(tmp_path):
    root = tmp_path / "releases"
    root.mkdir()
    (root / "latest.yml").write_bytes(YML)
    (root / "PaperLab-Setup-0.2.0.exe").write_bytes(EXE)
    (root / "PaperLab-Setup-0.2.0.exe.blockmap").write_bytes(b"blockmap")
    (root / "release.json").write_text(json.dumps({
        "version": "0.2.0", "file": "PaperLab-Setup-0.2.0.exe", "size": len(EXE),
        "sha256": hashlib.sha256(EXE).hexdigest(), "built_at": "2026-10-08T05:00:00Z", "commit": "abc1234"}))
    (root / ".staging").mkdir()
    (root / ".staging" / "latest.yml").write_bytes(b"staging")
    (tmp_path / "cloud.env").write_text("SECRET=outside")
    return root


def make_client(root, **headers):
    from paperlab.auth import JWKSCache, TokenVerifier
    from paperlab.server import create_app
    from paperlab.storage import FakeStorage

    auth = LocalAuth()
    config = make_config(UNREACHABLE_DB, supabase_url=auth.URL, allowed_emails=frozenset({auth.email}),
                         db_pool_timeout=1.0)
    verifier = TokenVerifier(auth.URL, jwks=JWKSCache(auth.URL + "/auth/v1/.well-known/jwks.json", fetch=auth.jwks))
    app = create_app(config, storage=FakeStorage(), verifier=verifier, releases=root)
    c = TestClient(app, headers=headers)
    c.token = auth.token()
    return c


def test_public_files_headers_and_head(rel):
    c = make_client(rel)
    r = c.get("/downloads/latest.yml")
    assert r.status_code == 200 and r.content == YML and r.headers["cache-control"] == "no-cache"
    assert r.headers["content-type"].startswith("text/yaml") and r.headers["x-content-type-options"] == "nosniff"
    assert r.headers.get("etag") and r.headers.get("last-modified")
    assert c.get("/downloads/latest.yml", headers={"If-None-Match": r.headers["etag"]}).status_code == 304
    for name, body in (("PaperLab-Setup-0.2.0.exe", EXE), ("PaperLab-Setup-0.2.0.exe.blockmap", b"blockmap")):
        r = c.get(f"/downloads/{name}")
        assert r.status_code == 200 and r.content == body
        assert r.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert r.headers["content-type"] == "application/octet-stream"
        h = c.head(f"/downloads/{name}")
        assert h.status_code == 200 and h.headers["content-length"] == str(len(body))
    assert "attachment" in c.get("/downloads/PaperLab-Setup-0.2.0.exe").headers["content-disposition"]


def test_listing_traversal_and_methods(rel, tmp_path):
    c = make_client(rel)
    assert c.get("/downloads/").status_code == 404 and c.get("/downloads").status_code == 404
    bad = ["release.json", ".staging/latest.yml", "../cloud.env", "..%2f..%2fcloud.env", "%2e%2e/x", "..%5c..%5ccloud.env",
           "C:%5cWindows%5cwin.ini", "latest.yml::$DATA", "latest.yml:x", "PaperLab-Setup-0.2.0.exe.bak",
           "PaperLab-Setup-1.exe", "LATEST.YML", "latest.yml%00", "latest.yml.", "latest.yml%20"]
    try:
        os.symlink(tmp_path / "cloud.env", rel / "PaperLab-Setup-9.9.9.exe")
        bad.append("PaperLab-Setup-9.9.9.exe")
    except (OSError, NotImplementedError):
        pass  # Windows에서 심볼릭 링크 권한이 없으면 건너뜀
    for name in bad:
        r = c.get(f"/downloads/{name}")
        assert r.status_code == 404, name
        assert b"outside" not in r.content and b"staging" not in r.content and b"sha256" not in r.content, name
    for m in ("POST", "PUT", "DELETE", "PATCH"):
        assert c.request(m, "/downloads/latest.yml").status_code == 405, m


def test_range_requests(rel):
    c = make_client(rel)
    r = c.get("/downloads/PaperLab-Setup-0.2.0.exe", headers={"Range": "bytes=0-99"})
    assert r.status_code == 206 and r.content == EXE[:100] and r.headers["content-range"].startswith("bytes 0-99/")
    r = c.get("/downloads/PaperLab-Setup-0.2.0.exe", headers={"Range": "bytes=0-9,20-29"})
    assert r.status_code == 206 and r.headers["content-type"].startswith("multipart/byteranges")
    assert EXE[:10] in r.content and EXE[20:30] in r.content


def test_abuse_limits(rel):
    c = make_client(rel)
    app = c.app
    for _ in range(10):
        assert c.get("/downloads/PaperLab-Setup-0.2.0.exe").status_code == 200
    r = c.get("/downloads/PaperLab-Setup-0.2.0.exe")
    assert r.status_code == 429
    assert c.get("/downloads/latest.yml").status_code == 200  # 작은 파일은 제한 없음
    # 시계 주입: 한 시간 뒤엔 다시
    clock = {"t": 0.0}
    from paperlab.worker_api import WindowLimit
    lim = WindowLimit(10, 3600, clock=lambda: clock["t"])
    for _ in range(10):
        assert lim.hit("1.2.3.4")
    assert not lim.hit("1.2.3.4") and lim.hit("5.6.7.8")
    clock["t"] = 3600.0
    assert lim.hit("1.2.3.4")
    # 동시 전송 3개 — 4번째는 503 + Retry-After
    app.state.downloads_limit._hits.clear()
    app.state.exe_state["exe"] = 3
    r = c.get("/downloads/PaperLab-Setup-0.2.0.exe")
    assert r.status_code == 503 and r.headers["retry-after"] == "60"
    app.state.exe_state["exe"] = 0
    assert c.get("/downloads/PaperLab-Setup-0.2.0.exe").status_code == 200
    assert app.state.exe_state["exe"] == 0  # 전송이 끝나면 자리를 돌려줌


def test_desktop_release_api(rel, tmp_path):
    c = make_client(rel)
    assert c.get("/api/desktop/release").status_code == 401
    info = c.get("/api/desktop/release", headers={"Authorization": f"Bearer {c.token}"}).json()
    assert info == {"version": "0.2.0", "url": "/downloads/PaperLab-Setup-0.2.0.exe", "size": len(EXE),
                    "sha256": hashlib.sha256(EXE).hexdigest(), "built_at": "2026-10-08T05:00:00Z"}
    empty = tmp_path / "empty"
    empty.mkdir()
    c2 = make_client(empty)
    r = c2.get("/api/desktop/release", headers={"Authorization": f"Bearer {c2.token}"})
    assert r.status_code == 404 and r.json()["code"] == "not_ready"
    assert c2.get("/downloads/latest.yml").status_code == 404


def test_only_downloads_are_public(rel):
    """1단계 AC-01 공개 예외에 /downloads/*만 더해짐 — 다른 경로는 여전히 401"""
    c = make_client(rel)
    for path in ("/api/jobs", "/api/devices", "/api/ai/status", "/api/desktop/release"):
        assert c.get(path).status_code == 401, path
    assert c.post("/api/worker/claim", json={}, headers={"X-PaperLab": "1"}).status_code == 401


def test_releases_dir_env_default():
    assert str(downloads.releases_dir({})) == r"D:\PaperLab\releases"
    assert str(downloads.releases_dir({"PAPERLAB_RELEASES_DIR": r"E:\rel"})) == r"E:\rel"


def test_concurrent_downloads_release_slots(rel):
    c = make_client(rel)
    out = []
    ts = [threading.Thread(target=lambda: out.append(c.get("/downloads/PaperLab-Setup-0.2.0.exe").status_code))
          for _ in range(3)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert out == [200, 200, 200] and c.app.state.exe_state["exe"] == 0


def test_range_not_counted_and_local_bucket(rel, monkeypatch):
    """품질팀 M3: Range 요청은 시간당 횟수에 넣지 않음(동시 3개만), 주소가 127.0.0.1(XFF 없음)이면 전체 시간당 60회"""
    c = make_client(rel)
    for _ in range(10):
        assert c.get("/downloads/PaperLab-Setup-0.2.0.exe").status_code == 200
    assert c.get("/downloads/PaperLab-Setup-0.2.0.exe").status_code == 429
    for _ in range(15):
        assert c.get("/downloads/PaperLab-Setup-0.2.0.exe", headers={"Range": "bytes=0-9"}).status_code == 206
    c.app.state.exe_state["exe"] = 3
    assert c.get("/downloads/PaperLab-Setup-0.2.0.exe", headers={"Range": "bytes=0-9"}).status_code == 503
    c.app.state.exe_state["exe"] = 0
    monkeypatch.setattr(downloads, "client_ip", lambda request: "127.0.0.1")
    c2 = make_client(rel)
    codes = [c2.get("/downloads/PaperLab-Setup-0.2.0.exe").status_code for _ in range(61)]
    assert codes[:60] == [200] * 60 and codes[60] == 429


def test_redact_sk_only_real_key_shapes():
    """품질팀 L6: sk-는 단어 경계 + 20자 이상만 가린다"""
    from paperlab.config import redact
    out = redact("task-abcdefghijklmnopqrstuvwxyz desk-x sk-short1 sk-proj-abcdefghijklmnopqrstuv sk-ant-abc123def")
    assert "task-abcdefghijklmnopqrstuvwxyz" in out and "sk-short1" in out
    assert "abcdefghijklmnopqrstuv" not in out.replace("task-abcdefghijklmnopqrstuvwxyz", "") and "abc123def" not in out
