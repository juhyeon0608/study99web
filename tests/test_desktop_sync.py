"""6단계 [다중] 여러 PC 기본 흐름 — 로컬 서버(테스트 DB + /_dev_storage 가짜 저장소) + Node 동기화 엔진 2대
(desktop/test/fixtures/sync-sim.js). AC-6M1 · 6M5 축소판: A1 폴더에 넣은 PDF가 서재 · A2에 생기고, A1에서 지우면 서재 휴지통 ·
A2 가짜 Windows 휴지통, 웹에서 되살리면 두 PC에 다시 생긴다. 실제 휴지통 · 사용자 폴더 · 운영 서버는 쓰지 않는다.
Node(20.10 이상)가 없으면 건너뛴다."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path

import httpx
import psycopg
import pytest

from .conftest import FakeAI, FakeSources, make_config, make_pdf

pytestmark = pytest.mark.db
ROOT = Path(__file__).resolve().parent.parent
SIM = ROOT / "desktop" / "test" / "fixtures" / "sync-sim.js"
WAIT_S = 150


def _node():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js가 없어 [다중] 동기화 시험을 건너뜀")
    out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
    major, minor = (int(x) for x in out.lstrip("v").split(".")[:2])
    if (major, minor) < (20, 10):
        pytest.skip(f"Node.js 20.10 이상이 필요함 (지금 {out})")
    return node


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def _sha(p: Path) -> str | None:
    try:
        return hashlib.sha256(p.read_bytes()).hexdigest()
    except OSError:
        return None


def _until(cond, what: str, timeout: float = WAIT_S):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        got = cond()
        if got:
            return got
        time.sleep(0.5)
    raise AssertionError(f"시간 안에 되지 않음: {what}")


class Sim:
    """Node 엔진 하나 — 표준 출력 JSON 줄을 모은다"""

    def __init__(self, node: str, url: str, code: str, root: Path, state: Path, name: str, appdata: Path):
        root.mkdir(parents=True, exist_ok=True)
        # 루트 거부 검사(앱 데이터 폴더 아래 금지)가 pytest 임시 폴더를 막지 않게 앱 데이터 위치만 따로 둔다(시험 전용)
        env = dict(os.environ, SIM_NAME=name, APPDATA=str(appdata / "roaming"), LOCALAPPDATA=str(appdata / "local"))
        self.root, self.state, self.events, self.lock = root, state, [], threading.Lock()
        self.proc = subprocess.Popen([node, str(SIM), url, code, str(root), str(state)], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env, encoding="utf-8",
                                     errors="replace", bufsize=1, cwd=str(ROOT / "desktop"))
        threading.Thread(target=self._read, daemon=True).start()
        _until(lambda: self.seen("started") or self._failed(), f"{name} 시작", 120)
        assert not self._failed(), self.events[-5:]

    def _read(self):
        for line in self.proc.stdout:
            try:
                ev = json.loads(line)
            except ValueError:
                ev = {"event": "raw", "line": line.strip()[:300]}
            with self.lock:
                self.events.append(ev)

    def seen(self, event: str) -> bool:
        with self.lock:
            return any(e.get("event") == event for e in self.events)

    def _failed(self) -> bool:
        return self.seen("error") or self.proc.poll() is not None

    def now(self):
        try:
            self.proc.stdin.write(json.dumps({"cmd": "now"}) + "\n")
            self.proc.stdin.flush()
        except (OSError, ValueError):
            pass

    def stop(self):
        if self.proc.poll() is None:
            try:
                self.proc.stdin.write(json.dumps({"cmd": "stop"}) + "\n")
                self.proc.stdin.flush()
                self.proc.wait(10)
            except (OSError, ValueError, subprocess.TimeoutExpired):
                self.proc.kill()


@pytest.fixture
def live(project, session_db, users, tmp_path):
    """uvicorn으로 띄운 개발 모드 서버(가짜 저장소를 같은 출처 /_dev_storage로) + 테스트 사용자 한 명"""
    import uvicorn

    from paperlab.server import create_app
    from paperlab.storage import FakeStorage

    node = _node()
    port = _free_port()
    url = f"http://127.0.0.1:{port}"
    config = make_config(project.app_db, supabase_url=project.url, supabase_anon_key=project.anon_key, public_url=url)
    app = create_app(config, database=session_db, storage=FakeStorage(url_base="/_dev_storage"),
                     sources_factory=lambda get: FakeSources(), ai_factory=lambda get: FakeAI(),
                     releases=ROOT / "tests" / "_no_releases", dev=True)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    _until(lambda: server.started, "서버 시작", 30)
    u = users()
    web = httpx.Client(base_url=url, headers={"Authorization": f"Bearer {u.token}", "X-PaperLab": "1"}, timeout=60)
    web.get("/api/me")
    sims: list[Sim] = []

    def sim(name: str) -> Sim:
        code = web.post("/api/devices/pair-codes").json()["code"]  # 새 코드는 이전 코드를 끝내므로 PC마다 차례로
        s = Sim(node, url, code, tmp_path / name / "root", tmp_path / name / "state", name, tmp_path / "appdata")
        sims.append(s)
        return s

    yield type("Live", (), {"web": web, "sim": staticmethod(sim), "uid": u.id, "admin_db": project.admin_db})
    for s in sims:
        s.stop()
    web.close()
    server.should_exit = True


def _papers(admin_db: str, uid: str) -> list[tuple]:
    with psycopg.connect(admin_db, autocommit=True, prepare_threshold=None) as c:
        return c.execute("select p.id, p.pdf_sha256, p.deleted_at is not null, f.name from paperlab.papers p "
                         "left join paperlab.folders f on f.id = p.folder_id where p.user_id = %s and p.pdf_key <> ''",
                         (uid,)).fetchall()


def test_two_pcs_add_delete_restore(live):
    """AC-6M1 · 6M5 축소판"""
    a1, a2 = live.sim("A1"), live.sim("A2")
    data = make_pdf(title="Multi PC Sync Paper Title", doi="")
    want = hashlib.sha256(data).hexdigest()
    src = a1.root / "인공지능" / "x.pdf"
    src.parent.mkdir()
    src.write_bytes(data)
    a1.now()
    # A1 → 서재 '인공지능' 폴더 → A2 같은 자리 · 같은 해시
    rows = _until(lambda: [r for r in _papers(live.admin_db, live.uid) if r[1] == want and not r[2]], "서재에 생김")
    assert rows[0][3] == "인공지능"
    dst = a2.root / "인공지능" / "x.pdf"
    _until(lambda: (a2.now(), _sha(dst) == want)[1], "A2에 생김")
    # A1에서 지움 → 서재 휴지통 · A2는 가짜 Windows 휴지통(지우지 않고 옮김)
    src.unlink()
    a1.now()
    _until(lambda: [r for r in _papers(live.admin_db, live.uid) if r[1] == want and r[2]], "서재 휴지통")
    _until(lambda: (a2.now(), not dst.exists())[1], "A2에서 사라짐")
    recycled = list((a2.state / "fake-recycle").glob("*.pdf"))
    assert [_sha(p) for p in recycled] == [want]
    # 웹에서 되살리기 → 두 PC 모두 원래 폴더에 다시
    assert live.web.post("/api/trash/restore", json={"ids": [rows[0][0]]}).json()["restored"] == 1
    _until(lambda: (a1.now(), a2.now(), _sha(src) == want and _sha(dst) == want)[2], "두 PC에 다시 생김")
