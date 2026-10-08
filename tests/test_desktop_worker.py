"""2b — 실제 Node 워커(desktop/worker) ↔ 로컬 서버(테스트 프로젝트) 왕복 1회.

연결 코드 교환 → hello(가짜 claude 광고) → 요약 작업(키 없음 → CLI) → claim → 가짜 CLI 실행 → heartbeat · result → 요약 저장.
서버는 이 프로세스 안 uvicorn(127.0.0.1 임의 포트), CLI는 desktop/test/fixtures/fake-cli.js — 운영 서버 · 실제 CLI에는 닿지 않는다.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path

import pytest

from .conftest import Cloud
from .test_jobs import paper

pytestmark = pytest.mark.db
ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "desktop" / "test" / "fixtures" / "roundtrip-worker.js"


def test_node_worker_round_trip(project, session_db, users, tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("node 가 없어 Node 워커 왕복 시험을 건너뜀")
    import uvicorn

    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    c = Cloud(project, session_db, users, local_port=port)
    server = uvicorn.Server(uvicorn.Config(c.app, log_level="warning", lifespan="off"))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    proc = None
    try:
        a = c.user()
        ca = c.client(a)
        ca.get("/api/me")
        pid = paper(ca)
        code = ca.post("/api/devices/pair-codes").json()["code"]
        thread.start()
        deadline = time.monotonic() + 15
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        assert server.started
        summary = {"tldr": "Node 워커가 만든 요약", "keywords": ["node"]}
        env = dict(os.environ, FAKE_TEXT=json.dumps(summary, ensure_ascii=False), FAKE_LOG=str(tmp_path / "fake.log"))
        proc = subprocess.Popen([node, str(SCRIPT), f"http://127.0.0.1:{port}", code, str(tmp_path / "pc")], env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8")
        # 기기가 claude 를 광고할 때까지 (경로에 {cli, claude} 칸이 생기게 — 9.2절)
        deadline = time.monotonic() + 30
        dev = None
        while time.monotonic() < deadline:
            devs = ca.get("/api/devices").json()
            dev = next((d for d in devs if any(e["name"] == "claude" and e["logged_in"] for e in d["engines"])), None)
            if dev or proc.poll() is not None:
                break
            time.sleep(0.2)
        assert dev, proc.stderr.read() if proc.poll() is not None else "기기 광고 없음"
        assert dev["name"] == "Node 시험 PC" and dev["app_version"] == "0.2.0" and dev["online"]
        job = ca.post(f"/api/papers/{pid}/summary").json()["job"]
        assert job["runner"] == "cli" and job["engine"] == "claude"
        done = c.wait_job(ca, job["id"], timeout=60)
        assert done["status"] == "succeeded", done
        assert done["device"]["name"] == "Node 시험 PC"
        assert ca.get(f"/api/papers/{pid}/summary").json()["summary"]["data"]["tldr"] == "Node 워커가 만든 요약"
        out, err = proc.communicate(timeout=30)
        events = [json.loads(x) for x in out.splitlines() if x.startswith("{")]
        assert [e["event"] for e in events][:2] == ["paired", "hello"]
        fin = events[-1]
        assert fin["event"] == "finished" and fin["outcome"] == "succeeded" and fin["status"] == "succeeded", (out, err)
        log = (tmp_path / "pc" / "worker.log").read_text(encoding="utf-8")
        assert "작업 시작" in log and "작업 결과" in log and "pld1." not in log and "Node 워커가 만든 요약" not in log
    finally:
        if proc and proc.poll() is None:
            proc.kill()
        server.should_exit = True
        thread.join(10)
        c.app.state.runner.stop()
