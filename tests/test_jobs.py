"""2단계 2a — 작업 큐 · 기기 연결 · 워커 API · 라우팅 · API 실행기 (명세 17장 A~E2 · I 중 서버 몫).

워커는 **Python 가짜 워커**(TestClient로 /api/worker/* 계약을 부름), AI는 가짜(conftest.FakeAI)다. 실제 CLI · 실제 API는 부르지 않는다.
사용자 A · B는 모듈에서 한 번만 만들고(테스트 프로젝트 사용자 생성이 느림), 테스트마다 작업 · 기기 · 설정 행을 비운다.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from pathlib import Path

import psycopg
import pytest

from paperlab import jobs
from paperlab.db import actor_claims

from .conftest import SAMPLE, Cloud, make_pdf

pytestmark = pytest.mark.db
KEY = "sk-ant-test-key-000111222"
CODE_RE = re.compile(r"^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$")


def sql(project, q: str, params=None):
    with psycopg.connect(project.admin_db, autocommit=True, prepare_threshold=None) as conn:
        cur = conn.execute(q, params)
        return cur.fetchall() if cur.description else cur.rowcount


@pytest.fixture(scope="module")
def ab(project):
    a, b = project.create_user(), project.create_user()
    yield a, b
    for u in (a, b):
        try:
            project.delete_user(u)
            project.created.remove(u)
        except Exception:  # noqa: BLE001
            pass


@pytest.fixture
def env(project, session_db, ab, tmp_path, monkeypatch):
    a, b = ab
    ids = [a.id, b.id]
    for t in ("jobs", "device_pair_codes", "devices", "papers", "user_secrets"):
        sql(project, f"delete from paperlab.{t} where user_id = any(%s::uuid[])", (ids,))
    sql(project, "update paperlab.profiles set settings = '{}'::jsonb where user_id = any(%s::uuid[])", (ids,))
    made = []
    key = os.urandom(32)  # 앱을 여러 개 만들어도 같은 암호화 키 (서버 재시작 흉내)

    def make(**kw) -> Cloud:
        c = Cloud(project, session_db, users=None, releases=kw.pop("releases", tmp_path / "rel"), encryption_key=key, **kw)
        c.app.state.allowlist.emails = frozenset(u.email.lower() for u in ab)
        c.known_uids |= set(ids)
        made.append(c)
        return c

    c = make()
    c.make = make
    c.a, c.b = a, b
    ca, cb = c.client(a), c.client(b)
    ca.get("/api/me")
    cb.get("/api/me")  # profiles 행 (account_hint · 허용 목록 확인)
    yield c
    for x in made:
        x.app.state.runner.stop()


class Worker:
    """가짜 워커: 연결 코드 교환 → 기기 토큰으로 hello · claim · heartbeat · result"""

    def __init__(self, cloud: Cloud, user, engines=(("claude", True),), name="A1", app_version="0.2.0"):
        code = cloud.client(user).post("/api/devices/pair-codes").json()["code"]
        r = cloud.client().post("/api/worker/pair", json={"code": code, "name": name, "os": "Windows 11 10.0.26200",
                                                           "app_version": app_version, "protocol": 1})
        assert r.status_code == 200, r.text
        self.pair = r.json()
        self.id, self.token = self.pair["device_id"], self.pair["token"]
        self.http = cloud.client(Authorization=f"Bearer {self.token}")
        self.hello(engines, app_version=app_version)

    def hello(self, engines, **kw):
        body = {"app_version": "0.2.0", "protocol": 1, "os": "Windows 11", "paused": False,
                "engines": [{"name": n, "version": "1.0", "logged_in": li, "slots": 2} for n, li in engines]}
        body.update(kw)
        return self.http.post("/api/worker/hello", json=body)

    def claim(self, **free) -> dict:
        r = self.http.post("/api/worker/claim", json={"free": free or {"claude": 2}, "paused": False})
        assert r.status_code == 200, r.text
        return r.json()

    def result(self, task: dict, outcome="succeeded", text="", **kw):
        return self.http.post(f"/api/worker/jobs/{task['id']}/result",
                              json={"lease_token": task["lease_token"], "outcome": outcome, "text": text, **kw})


SUMMARY_TEXT = json.dumps({"tldr": "PC 요약", "keywords": ["pc"]}, ensure_ascii=False)


def paper(client) -> int:
    """새 논문 (DOI 없이 제목만 다르게 — 같은 DOI면 서재가 기존 논문을 돌려준다)"""
    r = client.post("/api/papers", json=dict(SAMPLE, doi="", title=f"Paper {time.monotonic_ns()}"))
    return r.json()["paper"]["id"]


# ====================================================================== A. 표 · RLS · 토큰
def test_rls_and_token_hash(env, project, session_db):
    """AC-02 · AC-03 · AC-04"""
    ca, cb = env.client(env.a), env.client(env.b)
    w = Worker(env, env.a)
    jid = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]["id"]
    ca.post("/api/devices/pair-codes")
    with session_db.user_tx(actor_claims(env.b.id, "test")) as lib:
        for t in ("jobs", "devices", "device_pair_codes"):
            assert lib._one(f"select count(*)::int as n from paperlab.{t}")["n"] == 0, t
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        with session_db.user_tx(actor_claims(env.b.id, "test")) as lib:
            lib._x("insert into paperlab.devices (user_id, name, token_hash) values (%s, 'x', %s)",
                   (env.a.id, "0" * 64))
    for r in (cb.get(f"/api/jobs/{jid}"), cb.post(f"/api/jobs/{jid}/cancel"), cb.post(f"/api/jobs/{jid}/retry"),
              cb.patch(f"/api/devices/{w.id}", json={"name": "x"}), cb.delete(f"/api/devices/{w.id}")):
        assert r.status_code == 404, r.text
    assert cb.get("/api/jobs?status=all").json()["jobs"] == [] and cb.get("/api/devices").json() == []
    assert ca.get(f"/api/jobs/{jid}").json()["status"] == "queued"
    devs = ca.get("/api/devices").text
    assert "token_hash" not in devs and w.token not in devs
    (h,), = sql(project, "select token_hash from paperlab.devices where id = %s", (w.id,))
    assert re.fullmatch(r"[0-9a-f]{64}", h)
    dump = json.dumps(sql(project, "select to_jsonb(d) from paperlab.devices d where id = %s", (w.id,)), default=str)
    assert w.token.split(".")[-1] not in dump


# ====================================================================== C. 연결 · 인증
def test_pair_codes_and_device_auth(env, project):
    """AC-16 · AC-17 · AC-18 · AC-19 · AC-20 · AC-22"""
    ca = env.client(env.a)
    anon = env.client()
    r = ca.post("/api/devices/pair-codes").json()
    assert CODE_RE.match(r["code"]) and r["expires_at"]
    raw = r["code"].replace("-", "").lower()
    ok = anon.post("/api/worker/pair", json={"code": raw, "name": "집 PC"})
    assert ok.status_code == 200 and ok.json()["token"].startswith("pld1.") and "***@" in ok.json()["account_hint"]
    bad_bodies = set()
    bad_bodies.add(anon.post("/api/worker/pair", json={"code": r["code"]}).text)  # 이미 씀
    old = ca.post("/api/devices/pair-codes").json()["code"]
    ca.post("/api/devices/pair-codes")  # 새 코드 → 이전 코드 끝
    bad_bodies.add(anon.post("/api/worker/pair", json={"code": old}).text)
    late = ca.post("/api/devices/pair-codes").json()["code"]
    sql(project, "update paperlab.device_pair_codes set expires_at = now() - interval '1 minute', "
                 "created_at = now() - interval '11 minutes' where user_id = %s and used_at is null", (env.a.id,))
    bad_bodies.add(anon.post("/api/worker/pair", json={"code": late}).text)
    bad_bodies.add(anon.post("/api/worker/pair", json={"code": "ABCD-EFGH"}).text)
    assert len(bad_bodies) == 1 and "연결 코드가 맞지 않거나" in bad_bodies.pop()

    # AC-17 동시 교환 → 하나만
    code = ca.post("/api/devices/pair-codes").json()["code"]
    out = []
    ts = [threading.Thread(target=lambda: out.append(env.client().post("/api/worker/pair", json={"code": code}).status_code))
          for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(out) == [200, 400]

    # AC-19 · AC-20 섞어 쓰기 · 형식 오류
    token = ok.json()["token"]
    assert env.client(env.a).post("/api/worker/claim", json={}).status_code == 401
    assert env.client(Authorization=f"Bearer {token}").get("/api/papers").status_code == 401
    uid, dev, secret = jobs.parse_token(token)
    for t in ("", "pld1", f"pld1.{uid}.{dev}", f"pld1.not-a-uuid.{dev}.{secret}", f"pld1.{uid}.x.{secret}",
              f"pld1.{uid}.{dev}.{secret[:-1]}!", f"pld1.{uid}.{dev}.{secret[:-1]}{'A' if secret[-1] != 'A' else 'B'}",
              f"pld1.{env.b.id}.{dev}.{secret}"):
        r = env.client(Authorization=f"Bearer {t}").post("/api/worker/claim", json={})
        assert r.status_code == 401 and r.json()["code"] == "device_auth_required", t[:20]

    # AC-22 활성 기기 10대 · AC-18 속도 제한
    from paperlab.worker_api import WindowLimit
    env.app.state.workers.pair_ip = WindowLimit(100, 60)
    for _ in range(10 - 2):
        assert anon.post("/api/worker/pair", json={"code": ca.post("/api/devices/pair-codes").json()["code"]}).status_code == 200
    r = anon.post("/api/worker/pair", json={"code": ca.post("/api/devices/pair-codes").json()["code"]})
    assert r.status_code == 400 and "너무 많아요" in r.json()["detail"]
    env.app.state.workers.pair_ip = WindowLimit(10, 60)
    codes = [anon.post("/api/worker/pair", json={"code": "ZZZZ-ZZZZ"}).status_code for _ in range(11)]
    assert codes[:10] == [400] * 10 and codes[10] == 429


def test_allowlist_and_update_required(env):
    """AC-21 · AC-63(서버 쪽 426)"""
    w = Worker(env, env.a)
    al = env.app.state.allowlist
    al.emails = frozenset({env.b.email.lower()})
    r = w.http.post("/api/worker/claim", json={})
    assert r.status_code == 403 and r.json()["code"] == "not_allowed"
    al.enabled = False
    assert w.http.post("/api/worker/claim", json={}).status_code == 200
    al.enabled = True
    al.emails = frozenset({env.a.email.lower()})
    r = w.hello([("claude", True)], app_version="0.1.9")
    assert r.status_code == 426 and r.json()["code"] == "update_required"
    assert w.http.post("/api/worker/claim", json={}).status_code == 426
    dev = env.client(env.a).get("/api/devices").json()[0]
    assert dev["update_required"] is True and dev["app_version"] == "0.1.9"
    ok = w.hello([("claude", True)]).json()
    assert ok["min_app_version"] == jobs.MIN_APP_VERSION and ok["poll"] == {"idle_s": 60, "active_s": 5}


# ====================================================================== B. 잡기 · 리스 · 재할당
def test_claim_lease_reassign_and_results(env, project, monkeypatch):
    """AC-05 · AC-06 · AC-09 · AC-10 · AC-11 · AC-12 · AC-13"""
    ca = env.client(env.a)
    a1, a2 = Worker(env, env.a, name="A1"), Worker(env, env.a, name="A2")
    b1 = Worker(env, env.b, name="B1")
    pid = env.upload(ca, make_pdf(body="Residual body text."), "r.pdf")["id"]
    first = ca.post(f"/api/papers/{pid}/summary")
    assert first.status_code == 202
    job = first.json()["job"]
    assert job["status"] == "queued" and job["runner"] == "cli" and job["deadline_at"]
    again = ca.post(f"/api/papers/{pid}/summary")
    assert again.status_code == 200 and again.json()["job"]["id"] == job["id"]  # AC-13
    assert b1.claim()["job"] is None  # AC-06
    monkeypatch.setattr(jobs, "LEASE_S", 2)
    t1 = a1.claim()["job"]
    assert t1["id"] == job["id"] and "Residual body text" in t1["prompt"] and '<page number="1">' in t1["prompt"]
    assert t1["output"] == "json" and t1["json_schema"] and t1["model"] is None and t1["timeout_s"] == 1200
    v = ca.get(f"/api/jobs/{job['id']}").json()
    assert v["status"] == "running" and v["device"]["id"] == a1.id and v["attempts"] == 1
    # AC-12 하트비트
    hb = a1.http.post("/api/worker/heartbeat", json={"jobs": [
        {"id": t1["id"], "lease_token": t1["lease_token"], "progress": {"message": "claude 실행 중", "partial_text": "가" * 40000}},
        {"id": t1["id"], "lease_token": "00000000-0000-0000-0000-000000000000"}]}).json()["jobs"]
    assert hb[0]["ok"] is True and hb[0]["cancel"] is False and hb[1] == {"id": t1["id"], "ok": False, "code": "lease_lost"}
    p = ca.get(f"/api/jobs/{job['id']}").json()["progress"]
    assert p["message"] == "claude 실행 중" and len(p["partial_text"].encode()) <= 64 * 1024
    # AC-09 재할당
    time.sleep(2.3)
    monkeypatch.setattr(jobs, "LEASE_S", 90)  # 리스 2초는 A1의 잡기 · 하트비트에만
    t2 = a2.claim()["job"]
    assert t2["id"] == t1["id"] and t2["lease_token"] != t1["lease_token"]
    v = ca.get(f"/api/jobs/{job['id']}").json()
    assert v["attempts"] == 2 and v["device"]["id"] == a2.id and v["history"][-1]["error_code"] == "lease_expired"
    # AC-10 한 번만 반영
    r = a1.result(t1, text=SUMMARY_TEXT)
    assert r.status_code == 409 and r.json()["code"] == "lease_lost"
    assert ca.get(f"/api/papers/{pid}/summary").json()["summary"] is None
    assert a2.result(t2, text=SUMMARY_TEXT).json() == {"status": "succeeded"}
    s1 = ca.get(f"/api/papers/{pid}/summary").json()["summary"]
    assert s1["data"]["tldr"] == "PC 요약"
    assert a2.result(t2, text=SUMMARY_TEXT).status_code == 409
    assert ca.get(f"/api/papers/{pid}/summary").json()["summary"]["created_at"] == s1["created_at"]
    # AC-11 리스가 세 번 지나면 lease_exhausted
    j2 = ca.post(f"/api/papers/{pid}/summary").json()["job"]
    monkeypatch.setattr(jobs, "LEASE_S", 2)
    for w in (a1, a2, a1):
        assert w.claim()["job"]["id"] == j2["id"]
        time.sleep(2.3)
    assert a2.claim()["job"] is None
    v = ca.get(f"/api/jobs/{j2['id']}").json()
    assert v["status"] == "failed" and v["error_code"] == "lease_exhausted"


def test_concurrent_claims_one_owner(env):
    """AC-07: 두 PC가 같은 순간 잡아도 한 작업은 한 PC에만. 작업 20건 → 받은 합 20, 겹침 0"""
    ca = env.client(env.a)
    a1, a2 = Worker(env, env.a, name="A1"), Worker(env, env.a, name="A2")
    pid = paper(ca)
    with ca.stream("POST", f"/api/papers/{pid}/chat", json={"question": "하나"}) as r:
        assert json.loads(next(line for line in r.iter_lines() if line.startswith("data: "))[6:])["type"] == "queued"
    got = {a1.id: [], a2.id: []}

    def run(w, n):
        for _ in range(n):
            j = w.claim(claude=8)["job"]
            if j:
                got[w.id].append(j["id"])

    ts = [threading.Thread(target=run, args=(w, 25)) for w in (a1, a2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert len(got[a1.id]) + len(got[a2.id]) == 1
    for i in range(20):
        r = ca.post(f"/api/papers/{pid}/chat", json={"question": f"q{i}"})
        assert r.status_code == 200
    ts = [threading.Thread(target=run, args=(w, 15)) for w in (a1, a2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    both = got[a1.id] + got[a2.id]
    assert len(both) == 21 and len(set(both)) == 21
    assert {r[0] for r in sql(env.project, "select attempts from paperlab.jobs where user_id = %s", (env.a.id,))} == {1}


def test_engines_and_waiting_reasons(env, project):
    """AC-08 (+ 7장 waiting_reason 순서)"""
    ca = env.client(env.a)
    a1 = Worker(env, env.a, engines=(("claude", True), ("codex", True)), name="A1")
    a2 = Worker(env, env.a, engines=(("claude", True),), name="A2")
    ca.put("/api/settings", json={"ai_routing": {"summary": ["codex"]}})
    j = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]
    assert (j["runner"], j["engine"]) == ("cli", "codex")
    assert a2.claim(claude=2, codex=1)["job"] is None
    assert a1.claim(claude=2, codex=1)["job"]["engine"] == "codex"
    a1.hello([("claude", True), ("codex", False)])
    j2 = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]
    assert a1.claim(claude=2, codex=1)["job"] is None
    assert ca.get(f"/api/jobs/{j2['id']}").json()["waiting_reason"] == "no_online_worker", ca.get("/api/devices").json()
    # 자리 없음: A2 꺼짐(4분 전), A1이 claude 자리 0으로 잡기
    ca.put("/api/settings", json={"ai_routing": {"summary": ["claude"]}})
    j3 = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]
    sql(project, "update paperlab.devices set last_seen_at = now() - interval '4 minutes' where id = %s", (a2.id,))
    assert a1.claim(claude=0, codex=0)["job"] is None
    assert ca.get(f"/api/jobs/{j3['id']}").json()["waiting_reason"] == "all_workers_busy"
    assert ca.delete(f"/api/devices/{a1.id}").json()["ok"] is True
    assert ca.get(f"/api/jobs/{j2['id']}").json()["waiting_reason"] == "no_engine_on_worker"
    assert ca.get(f"/api/jobs/{j3['id']}").json()["waiting_reason"] == "no_online_worker"


def test_revoke_requeues_and_limits(env, project):
    """AC-14 · AC-15"""
    ca = env.client(env.a)
    a1, a2 = Worker(env, env.a, name="A1"), Worker(env, env.a, name="A2")
    jid = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]["id"]
    t = a1.claim()["job"]
    r = ca.delete(f"/api/devices/{a1.id}")
    assert r.json() == {"ok": True, "requeued_jobs": 1}
    for resp in (a1.http.post("/api/worker/claim", json={}),
                 a1.http.post("/api/worker/heartbeat", json={"jobs": []}), a1.result(t, text=SUMMARY_TEXT)):
        assert resp.status_code == 401 and resp.json()["code"] == "device_revoked"
    assert a2.claim()["job"]["id"] == jid
    devs = {d["id"]: d for d in ca.get("/api/devices").json()}
    assert devs[a1.id]["revoked"] is True and devs[a2.id]["running_jobs"] == 1
    # AC-14 진행 중 30개
    sql(project, "insert into paperlab.jobs (user_id, kind, status, runner, engine, route) "
                 "select %s, 'chat', 'queued', 'cli', 'claude', '[{\"runner\":\"cli\",\"engine\":\"claude\"}]' "
                 "from generate_series(1, 29)", (env.a.id,))
    r = ca.post(f"/api/papers/{paper(ca)}/summary")
    assert r.status_code == 429 and r.json()["code"] == "too_many_jobs"


# ====================================================================== D. 라우팅 · 폴백
def test_no_route_messages_follow_release(env, tmp_path):
    """AC-28 (경로 없음 400) + 팀장 결정 Q2a-1: 설치 파일이 없으면 키 등록 안내, 있으면 명세 문구"""
    ca = env.client(env.a)
    pid = paper(ca)
    r = ca.post(f"/api/papers/{pid}/summary")
    assert r.status_code == 400 and r.json()["detail"] == jobs.NO_ROUTE_SOON
    st = ca.get("/api/ai/status").json()
    assert st["ready"] is False and st["message"] == jobs.NO_ROUTE_SOON  # AC-32
    rel = tmp_path / "rel2"
    rel.mkdir()
    (rel / "PaperLab-Setup-0.2.0.exe").write_bytes(b"MZ")
    (rel / "release.json").write_text(json.dumps({"version": "0.2.0", "file": "PaperLab-Setup-0.2.0.exe", "size": 2,
                                                  "sha256": "0" * 64, "built_at": "2026-10-08T00:00:00Z"}))
    c2 = env.make(releases=rel)
    r = c2.client(env.a).post(f"/api/papers/{pid}/summary")
    assert r.status_code == 400 and r.json()["detail"] == jobs.NO_ROUTE
    assert c2.client(env.a).post(f"/api/papers/{pid}/chat", json={"question": "q"}).json()["detail"] == jobs.NO_ROUTE


def test_api_fallback_without_devices_fails_with_guide(env):
    """팀장 결정 Q2a-1 (2): API가 실패해 CLI로 가야 하는데 연결된 기기가 없으면 큐에 넣지 않고 API 오류 + 안내"""
    env.app.state.runner.start(scan=False)
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    env.fake_ai.fail = "api_auth"
    job = env.wait_job(ca, ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]["id"])
    assert job["status"] == "failed" and job["error_code"] == "api_auth"
    assert "가짜 AI 오류" in job["error"] and jobs.NO_ROUTE_SOON in job["error"]
    with ca.stream("POST", f"/api/papers/{paper(ca)}/chat", json={"question": "q"}) as r:
        ev = [json.loads(x[6:]) for x in r.iter_lines() if x.startswith("data: ")]
    assert ev[-1]["type"] == "error" and jobs.NO_ROUTE_SOON in ev[-1]["error"]


def test_api_fallback_to_cli(env, project):
    """AC-25(키 · 워커 없음은 test_server) · AC-26 · AC-27 · AC-28 · Q2a-1 (기기는 있지만 꺼짐 → 대기) · AC-93(서버)"""
    env.app.state.runner.start(scan=False)
    ca = env.client(env.a)
    a1 = Worker(env, env.a)
    sql(project, "update paperlab.devices set last_seen_at = now() - interval '1 hour' where id = %s", (a1.id,))
    # AC-28 키 없음 → 첫 칸 CLI, API 호출 0회
    j = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]
    assert j["runner"] == "cli" and env.fake_ai.calls == [] and j["waiting_reason"] == "no_online_worker"
    ca.post(f"/api/jobs/{j['id']}/cancel")
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    st = ca.get("/api/ai/status").json()
    assert st["kinds"]["summary"]["first"] == {"runner": "api", "engine": "claude"}
    for code in ("api_auth", "api_rate_limit", "api_server", "api_connection"):
        env.fake_ai.fail = code
        pid = paper(ca)
        job = env.wait_job(ca, ca.post(f"/api/papers/{pid}/summary").json()["job"]["id"], until=("queued", "failed"),
                           timeout=20)
        for _ in range(100):
            if job["runner"] == "cli" or job["status"] == "failed":
                break
            time.sleep(0.1)
            job = ca.get(f"/api/jobs/{job['id']}").json()
        assert (job["status"], job["runner"]) == ("queued", "cli"), (code, job)
        assert job["history"][0]["error_code"] == code and job["waiting_reason"] == "no_online_worker"
        if code == "api_auth":
            s = ca.get("/api/settings").json()
            assert s["anthropic_api_key_last_error"]["code"] == "api_auth"
            # 켜지면 이어서 실행 (AC-26)
            task = a1.claim()["job"]
            assert task["id"] == job["id"]
            assert a1.result(task, text=SUMMARY_TEXT).json()["status"] == "succeeded"
            assert ca.get(f"/api/papers/{pid}/summary").json()["summary"]["data"]["tldr"] == "PC 요약"
            sql(project, "update paperlab.devices set last_seen_at = now() - interval '1 hour' where id = %s", (a1.id,))
        else:
            ca.post(f"/api/jobs/{job['id']}/cancel")
    # 키를 다시 저장하면 최근 실패를 지움
    assert ca.put("/api/settings", json={"anthropic_api_key": KEY + "x"}).json()["anthropic_api_key_last_error"] is None
    # AC-27 거절 · 결과 깨짐 → 폴백 없이 실패
    for code in (True, "bad_output"):
        env.fake_ai.fail = code
        job = env.wait_job(ca, ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]["id"])
        assert job["status"] == "failed" and job["runner"] == "api", job


def test_route_two_engines_and_worker_failures(env):
    """AC-29 · 11.8절(로그인 안 됨 → 다른 PC)"""
    ca = env.client(env.a)
    a1 = Worker(env, env.a, engines=(("claude", True), ("codex", True)), name="A1")
    a2 = Worker(env, env.a, engines=(("claude", True),), name="A2")
    ca.put("/api/settings", json={"ai_routing": {"summary": ["claude", "codex"]}})
    j = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]
    assert [(s["runner"], s["engine"]) for s in j["route"]] == [("cli", "claude"), ("cli", "codex")]
    t = a2.claim()["job"]
    assert a2.result(t, "failed", error_code="cli_not_logged_in", error="login").json()["status"] == "queued"
    assert a2.claim()["job"] is None  # 이 PC는 빠짐
    t = a1.claim(claude=2, codex=1)["job"]
    assert t["engine"] == "claude"
    assert a1.result(t, "failed", error_code="cli_exit", error="exit 1").json()["status"] == "queued"
    t = a1.claim(claude=2, codex=1)["job"]
    assert t["engine"] == "codex"
    assert a1.result(t, "failed", error_code="cli_exit", error="마지막 사유 sk-ant-abcdefgh123").json()["status"] == "failed"
    v = ca.get(f"/api/jobs/{j['id']}").json()
    assert v["error"].startswith("마지막 사유") and "abcdefgh123" not in v["error"]
    assert [h["error_code"] for h in v["history"]] == ["cli_not_logged_in", "cli_exit", "cli_exit"]
    # 해석 실패는 bad_output (폴백 없음)
    j = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]
    t = a1.claim(claude=2)["job"]
    assert a1.result(t, text="JSON 아님").json()["status"] == "failed"
    assert ca.get(f"/api/jobs/{j['id']}").json()["error_code"] == "bad_output"


def test_chat_and_write_cli_paths(env):
    """AC-30 · write 결과 · manuscript_title · PD-4 취소(대기 · 실행 중)"""
    env.app.state.runner.start(scan=False)
    ca = env.client(env.a)
    a1 = Worker(env, env.a)
    pid = env.upload(ca, make_pdf(pages=3), "c.pdf")["id"]
    with ca.stream("POST", f"/api/papers/{pid}/chat", json={"question": "어디?"}) as r:
        ev = [json.loads(x[6:]) for x in r.iter_lines() if x.startswith("data: ")]
    assert len(ev) == 1 and ev[0]["type"] == "queued" and ev[0]["job"]["question"] == "어디?"
    t = a1.claim()["job"]
    assert t["kind"] == "chat" and t["output"] == "text" and t["stream_partial"] is True and "질문: 어디?" in t["prompt"]
    assert a1.result(t, text="세 번째 쪽 [p.3]").json()["status"] == "succeeded"
    hist = ca.get(f"/api/papers/{pid}/chat").json()
    assert [m["role"] for m in hist] == ["user", "assistant"] and hist[1]["citations"][0]["page"] == 3
    assert ca.get(f"/api/jobs/{ev[0]['job']['id']}").json()["result"] == {"message_id": hist[1]["id"]}
    # 키 401 → SSE fallback
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    env.fake_ai.fail = "api_auth"
    with ca.stream("POST", f"/api/papers/{pid}/chat", json={"question": "다시"}) as r:
        ev = [json.loads(x[6:]) for x in r.iter_lines() if x.startswith("data: ")]
    assert ev[-1]["type"] == "fallback" and ev[-1]["job"]["runner"] == "cli"
    assert ev[-1]["job"]["history"][0]["error_code"] == "api_auth"
    ca.post(f"/api/jobs/{ev[-1]['job']['id']}/cancel")
    # 글쓰기 CLI (키 지움)
    ca.put("/api/settings", json={"anthropic_api_key": None})
    mid = ca.post("/api/manuscripts", json={"title": "석사 논문 2장"}).json()["id"]
    with ca.stream("POST", "/api/ai/write", json={"text": "고칠 글", "mode": "polish", "manuscript_id": mid}) as r:
        ev = [json.loads(x[6:]) for x in r.iter_lines() if x.startswith("data: ")]
    wjob = ev[0]["job"]
    assert ev[0]["type"] == "queued" and wjob["kind"] == "write" and wjob["manuscript_title"] == "석사 논문 2장"
    t = a1.claim()["job"]
    assert "<text>\n고칠 글\n</text>" in t["prompt"]
    assert a1.result(t, text="다듬은 글").json()["status"] == "succeeded"
    assert ca.get(f"/api/jobs/{wjob['id']}").json()["result"] == {"text": "다듬은 글"}
    ca.delete(f"/api/manuscripts/{mid}")
    assert ca.get(f"/api/jobs/{wjob['id']}").json()["manuscript_title"] is None  # 원고 삭제 → null
    # PD-4: 창을 닫으면 대기 · 실행 중 모두 취소
    for running in (False, True):
        with ca.stream("POST", "/api/ai/write", json={"text": "글", "mode": "polish"}) as r:
            jid = json.loads(next(x for x in r.iter_lines() if x.startswith("data: "))[6:])["job"]["id"]
        if running:
            t = a1.claim()["job"]
        out = ca.post(f"/api/jobs/{jid}/cancel").json()
        assert out == ({"status": "running", "cancel_requested": True} if running else
                       {"status": "cancelled", "cancel_requested": False})
        if running:
            hb = a1.http.post("/api/worker/heartbeat", json={"jobs": [{"id": jid, "lease_token": t["lease_token"]}]})
            assert hb.json()["jobs"][0]["cancel"] is True
            assert a1.result(t, "cancelled").json()["status"] == "cancelled"
        assert ca.get(f"/api/jobs/{jid}").json()["status"] == "cancelled"


def test_settings_validation_and_keys(env, project):
    """AC-31 · AC-45(일부 — rotate-key는 기존 회전 코드가 이름과 무관하게 모든 행) · S3 hint"""
    ca, cb = env.client(env.a), env.client(env.b)
    for bad in ({"summary": ["gpt"]}, {"summary": ["claude", "claude"]}, {"summary": []},
                {"summary": ["claude", "codex", "gemini", "claude"]}, {"translate": ["claude"]}, ["claude"]):
        assert ca.put("/api/settings", json={"ai_routing": bad}).status_code == 400, bad
    assert ca.put("/api/settings", json={"cli_models": {"claude": "claude-opus-5-5"}}).status_code == 400
    assert ca.put("/api/settings", json={"api_models": {"codex": "bad model!"}}).status_code == 400
    r = ca.put("/api/settings", json={"ai_engine": "cli", "ai_routing": {"chat": ["gemini", "claude"]},
                                      "cli_models": {"claude": "opus"}, "api_models": {"gemini": "gemini-x"},
                                      "anthropic_api_key_last_error": {"code": "forged"},
                                      "openai_api_key": "sk-test-openai-123456789",
                                      "google_api_key": "AIza-test-google-123456789"})
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["ai_routing"]["chat"] == ["gemini", "claude"] and s["ai_routing"]["summary"] == ["claude"]
    assert s["cli_models"]["claude"] == "opus" and s["api_models"] == {"gemini": "gemini-x"}
    assert s["anthropic_api_key_last_error"] is None and "ai_engine" not in s
    assert s["openai_api_key_set"] and s["google_api_key_set"] and s["openai_api_key_hint"] == "6789"
    assert s["anthropic_api_key_hint"] == "" and "sk-test-openai" not in r.text and "AIza-test" not in r.text
    rows = sql(project, "select name, ciphertext, nonce, key_id, hint from paperlab.user_secrets where user_id = %s",
               (env.a.id,))
    assert {r[0] for r in rows} == {"openai_api_key", "google_api_key"}
    assert all(b"sk-test" not in bytes(r[1]) and b"AIza" not in bytes(r[1]) for r in rows)
    name, ct, nonce, kid, hint = [r for r in rows if r[0] == "openai_api_key"][0]
    cb.get("/api/settings")
    sql(project, "insert into paperlab.user_secrets (user_id, name, ciphertext, nonce, key_id, hint) "
                 "values (%s, %s, %s, %s, %s, %s)", (env.b.id, name, ct, nonce, kid, hint))
    assert cb.get("/api/settings").json()["openai_api_key_status"] == "unreadable"


def test_api_engines_status_and_env_keys(env, monkeypatch):
    """AC-32 · AC-48 · GET /api/ai/engines"""
    for k in ("OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.setenv(k, "sk-server-env-should-not-be-used")
    ca = env.client(env.a)
    ca.put("/api/settings", json={"ai_routing": {"summary": ["codex", "gemini"]}})
    st = ca.get("/api/ai/status").json()
    assert st["ready"] is False and all(not s["available"] for s in st["kinds"]["summary"]["route"])
    a1 = Worker(env, env.a, engines=(("codex", True),))
    st = ca.get("/api/ai/status").json()
    assert st["ready"] is True and st["kinds"]["summary"]["first"] == {"runner": "cli", "engine": "codex"}
    eng = ca.get("/api/ai/engines").json()
    assert eng["codex"] == {"api_key": False, "devices_online": 1, "devices_total": 1, "cli_model": "default"}
    assert eng["gemini"]["devices_total"] == 0


# ====================================================================== E. 취소 · 정리
def test_cancel_retry_and_cleanup(env, project, monkeypatch):
    """AC-33 · AC-34 · AC-35 · AC-36 · AC-37"""
    ca = env.client(env.a)
    a1 = Worker(env, env.a)
    j = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]
    assert ca.post(f"/api/jobs/{j['id']}/cancel").json()["status"] == "cancelled"
    assert a1.claim()["job"] is None
    assert ca.post(f"/api/jobs/{j['id']}/cancel").status_code == 409
    r = ca.post(f"/api/jobs/{j['id']}/retry")
    assert r.status_code == 202 and r.json()["job"]["id"] != j["id"] and r.json()["job"]["status"] == "queued"
    # AC-34 실행 중 취소 + 응답 없음 → 리스 만료 때 cancelled
    monkeypatch.setattr(jobs, "LEASE_S", 1)
    t = a1.claim()["job"]
    ca.post(f"/api/jobs/{t['id']}/cancel")
    time.sleep(1.3)
    assert ca.get(f"/api/jobs/{t['id']}").json()["status"] == "cancelled"
    monkeypatch.setattr(jobs, "LEASE_S", 90)
    # AC-35 succeeded는 다시 시도 불가
    pid = paper(ca)
    j = ca.post(f"/api/papers/{pid}/summary").json()["job"]
    t = a1.claim()["job"]
    a1.result(t, text=SUMMARY_TEXT)
    assert ca.post(f"/api/jobs/{j['id']}/retry").status_code == 409
    # AC-37 논문을 지우면 작업도 사라지고 결과는 404
    pid2 = paper(ca)
    j = ca.post(f"/api/papers/{pid2}/summary").json()["job"]
    t = a1.claim()["job"]
    ca.delete(f"/api/papers/{pid2}")
    assert ca.get(f"/api/jobs/{j['id']}").status_code == 404
    assert a1.result(t, text=SUMMARY_TEXT).status_code == 404
    # AC-36 대기 기한 (U7) · 정리
    s = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]
    with ca.stream("POST", f"/api/papers/{pid}/chat", json={"question": "q"}) as r:
        lines = list(r.iter_lines())
        assert r.status_code == 200, lines
        c = json.loads(next(x for x in lines if x.startswith("data: "))[6:])["job"]
    rows = dict(sql(project, "select kind, extract(epoch from deadline_at - created_at)::int from paperlab.jobs "
                             "where id = any(%s)", ([s["id"], c["id"]],)))
    assert rows == {"summary": 24 * 3600, "chat": 30 * 60}
    sql(project, "update paperlab.jobs set created_at = created_at - interval '31 minutes', "
                 "deadline_at = deadline_at - interval '31 minutes' where id = %s", (c["id"],))
    sql(project, "update paperlab.jobs set created_at = created_at - interval '23 hours', "
                 "deadline_at = deadline_at - interval '23 hours' where id = %s", (s["id"],))
    assert ca.get(f"/api/jobs/{c['id']}").json()["error_code"] == "no_worker_timeout"
    assert ca.get(f"/api/jobs/{s['id']}").json()["status"] == "queued"
    ca.post(f"/api/jobs/{s['id']}/cancel")
    with ca.stream("POST", "/api/ai/write", json={"text": "글"}) as r:
        w = json.loads(next(x for x in r.iter_lines() if x.startswith("data: "))[6:])["job"]
    t = a1.claim()["job"]
    a1.result(t, text="결과 글")
    sql(project, "update paperlab.jobs set finished_at = now() - interval '25 hours' where id = %s", (w["id"],))
    old = sql(project, "select id from paperlab.jobs where user_id = %s and status = 'cancelled' order by id limit 1",
              (env.a.id,))[0][0]
    sql(project, "update paperlab.jobs set finished_at = now() - interval '31 days' where id = %s", (old,))
    env.app.state.workers.swept.clear()
    ca.get("/api/jobs")
    assert ca.get(f"/api/jobs/{w['id']}").json()["result"] is None
    assert ca.get(f"/api/jobs/{old}").status_code == 404


# ====================================================================== E2. API 실행기
def test_api_runner_concurrency_progress_and_cancel(env, project, monkeypatch):
    """AC-41 · AC-43"""
    writes = []
    real = jobs.touch_lease

    def counting(lib, job_id, token, **kw):
        if kw.get("progress") is not None:
            writes.append((job_id, time.monotonic()))
        return real(lib, job_id, token, **kw)

    monkeypatch.setattr(jobs, "touch_lease", counting)
    env.fake_ai.gate = threading.Event()
    env.app.state.runner.start(scan=False)
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    ids = [ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]["id"] for _ in range(6)]
    peak = 0
    t0 = time.monotonic()
    while time.monotonic() - t0 < 3:
        n = sql(project, "select count(*) from paperlab.jobs where user_id = %s and status = 'running'", (env.a.id,))[0][0]
        peak = max(peak, n)
        time.sleep(0.2)
    assert peak == 2
    per_job = {}
    for jid, ts in writes:
        per_job.setdefault(jid, []).append(ts)
    for ts in per_job.values():
        # 실행기는 1초 간격으로 쓰기를 정하지만, 여기 시각은 DB 트랜잭션을 연 뒤라 연결 지연만큼 흔들린다 → 개수로 확인
        assert len(ts) <= (ts[-1] - ts[0]) + 2 and all(b - a >= 0.5 for a, b in zip(ts, ts[1:])), ts
    running = [r[0] for r in sql(project, "select id from paperlab.jobs where user_id = %s and status = 'running'",
                                 (env.a.id,))]
    ca.post(f"/api/jobs/{running[0]}/cancel")
    assert env.wait_job(ca, running[0], timeout=5)["status"] == "cancelled"
    env.fake_ai.gate.set()
    for jid in ids:
        assert env.wait_job(ca, jid)["status"] in ("succeeded", "cancelled")
    cancelled = ca.get(f"/api/jobs/{running[0]}").json()
    assert cancelled["status"] == "cancelled"
    assert sum(1 for jid in ids if ca.get(f"/api/jobs/{jid}").json()["status"] == "succeeded") == 5


def test_api_runner_recovery_scan(env, project):
    """AC-42: 서버 재시작 흉내 — 새 앱의 복구 스캔이 리스가 지난 작업 · 메모리에 없는 queued 작업을 잡는다"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    stuck = env.make()
    stuck.fake_ai.gate = threading.Event()
    stuck.app.state.runner.start(scan=False)
    r = stuck.client(env.a).post(f"/api/papers/{paper(ca)}/summary")
    assert r.status_code == 202, r.text
    jid = r.json()["job"]["id"]
    for _ in range(100):
        if sql(project, "select status from paperlab.jobs where id = %s", (jid,))[0][0] == "running":
            break
        time.sleep(0.1)
    stuck.app.state.runner._stop.set()  # 리스 연장도 멈춤 (강제 종료 흉내)
    sql(project, "update paperlab.jobs set lease_until = now() - interval '1 second' where id = %s", (jid,))
    queued = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]["id"]  # 이 앱의 실행기는 안 돎 → 메모리 대기열에만
    fresh = env.make(runner_opts={"scan_s": 0.3})
    fresh.app.state.runner.start()
    c2 = fresh.client(env.a)
    assert fresh.wait_job(c2, jid)["status"] == "succeeded" and c2.get(f"/api/jobs/{jid}").json()["attempts"] == 2
    assert fresh.wait_job(c2, queued)["status"] == "succeeded"
    stuck.fake_ai.gate.set()  # 옛 실행이 늦게 끝나도 리스를 잃어 반영하지 않음
    time.sleep(0.5)
    # 리스 만료가 세 번째(API 2회 한도) → 다음 칸이 없고 기기도 없음 → lease_exhausted
    def stale(route):
        return sql(project, "insert into paperlab.jobs (user_id, kind, status, runner, engine, route, paper_id, attempts, "
                            "lease_token, lease_until) values (%s, 'summary', 'running', 'api', 'claude', %s::jsonb, %s, 2, "
                            "gen_random_uuid(), now() - interval '1 second') returning id",
                   (env.a.id, json.dumps(route), paper(ca)))[0][0]

    j3 = stale([{"runner": "api", "engine": "claude"}])
    job = fresh.wait_job(c2, j3)
    assert job["status"] == "failed" and job["error_code"] == "lease_exhausted"
    # 다음 칸이 CLI면 그쪽으로
    Worker(fresh, env.a)
    j4 = stale([{"runner": "api", "engine": "claude"}, {"runner": "cli", "engine": "claude"}])
    job = fresh.wait_job(c2, j4, until=("queued", "failed"))
    for _ in range(50):
        if job["runner"] == "cli":
            break
        time.sleep(0.1)
        job = c2.get(f"/api/jobs/{j4}").json()
    assert (job["status"], job["runner"]) == ("queued", "cli")


def test_text_api_engines_through_runner(env, project):
    """AC-46 · AC-47 (서버 경로): codex · gemini 엔진 + 키 → 가짜 OpenAI · Google 서버로 실행, 401은 CLI로 폴백"""
    import httpx

    from paperlab.ai import AIService
    seen = []
    mode = {"status": 200}

    def handler(request):
        seen.append(request)
        if mode["status"] != 200:
            return httpx.Response(mode["status"], json={"error": "x"})
        if "openai" in request.url.host:
            return httpx.Response(200, json={"output": [{"type": "message", "content": [
                {"type": "output_text", "text": '{"tldr": "OpenAI 요약"}'}]}]})
        return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [
            {"text": '{"tldr": "Gemini 요약"}'}]}}]})

    client = httpx.Client(transport=httpx.MockTransport(handler))
    c = env.make(ai_factory=lambda get: AIService(get, http_client=client))
    c.app.state.runner.start(scan=False)
    ca = c.client(env.a)
    ca.put("/api/settings", json={"openai_api_key": "sk-test-openai-123456789", "google_api_key": "AIza-test-google-1234"})
    for engine, word in (("codex", "OpenAI"), ("gemini", "Gemini")):
        ca.put("/api/settings", json={"ai_routing": {"summary": [engine]}})
        pid = c.upload(ca, make_pdf(body="Body words here."), f"{engine}.pdf")["id"]
        job = c.wait_job(ca, ca.post(f"/api/papers/{pid}/summary").json()["job"]["id"])
        assert (job["status"], job["runner"], job["engine"]) == ("succeeded", "api", engine), job
        assert ca.get(f"/api/papers/{pid}/summary").json()["summary"]["data"]["tldr"] == f"{word} 요약"
        body = seen[-1].content.decode()
        assert "Body words here." in body and "application/pdf" not in body and "key" not in seen[-1].url.query.decode()
    Worker(c, env.a, engines=(("codex", True), ("gemini", True)))
    mode["status"] = 401
    ca.put("/api/settings", json={"ai_routing": {"summary": ["gemini"]}})
    job = c.wait_job(ca, ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]["id"], until=("queued", "failed"))
    for _ in range(50):
        if job["runner"] == "cli":
            break
        time.sleep(0.1)
        job = ca.get(f"/api/jobs/{job['id']}").json()
    assert (job["status"], job["runner"], job["engine"]) == ("queued", "cli", "gemini")
    assert job["history"][0]["error_code"] == "api_auth"
    assert ca.get("/api/settings").json()["google_api_key_last_error"]["code"] == "api_auth"


# ====================================================================== 코드 검사 · 로그
SRC = Path(__file__).resolve().parent.parent / "paperlab"


def test_code_checks_claims_system_tx_and_no_internal(env):
    """AC-23 · AC-24 · AC-40"""
    for f in SRC.glob("*.py"):
        text = f.read_text(encoding="utf-8")
        if '"role": "authenticated"' in text:
            assert f.name == "db.py", f.name
        if f.name in ("worker_api.py", "api_runner.py"):
            for m in re.finditer(r"user_tx\(([^)]*)\)", text):
                assert m.group(1).startswith("actor_claims(") or m.group(1) == "claims: dict", (f.name, m.group(0))
        for bad in ("SERVICE_URL", "TASKS_QUEUE", "TASKS_INVOKER_SA", "TASKS_BACKEND", "cloudtasks"):
            assert bad not in text, (f.name, bad)
    reasons = set()
    for f in SRC.glob("*.py"):
        reasons |= set(re.findall(r'system_tx\("([^"]+)"', f.read_text(encoding="utf-8")))
    assert {"device pairing", "api job recovery"} <= reasons and "device auth" not in reasons
    from paperlab.api_runner import RECOVERY_SQL
    assert RECOVERY_SQL.startswith("select id, user_id from paperlab.jobs ")
    assert not [r.path for r in env.app.routes if getattr(r, "path", "").startswith("/internal")]


def test_logs_have_no_tokens_codes_or_keys(env, caplog):
    """AC-96: 워커 흐름 전체 로그에 기기 토큰 · 연결 코드 · 키가 없음"""
    caplog.set_level(logging.DEBUG)
    ca = env.client(env.a)
    ca.put("/api/settings", json={"openai_api_key": "sk-test-openai-LOGCHECK1"})
    code = ca.post("/api/devices/pair-codes").json()["code"]
    tok = env.client().post("/api/worker/pair", json={"code": code, "name": "로그 PC"}).json()["token"]
    w = env.client(Authorization=f"Bearer {tok}")
    w.post("/api/worker/hello", json={"app_version": "0.2.0", "engines": [{"name": "claude", "logged_in": True}]})
    ca.post(f"/api/papers/{paper(ca)}/summary")
    t = w.post("/api/worker/claim", json={"free": {"claude": 1}}).json()["job"]
    w.post(f"/api/worker/jobs/{t['id']}/result", json={"lease_token": t["lease_token"], "outcome": "failed",
                                                     "error_code": "cli_exit", "error": f"boom {tok}"})
    text = caplog.text
    for secret in (tok, tok.split(".")[-1], code, code.replace("-", ""), "LOGCHECK1", t["lease_token"]):
        assert secret not in text
    assert "device_id" in text


# ====================================================================== 품질팀 보류 항목 (H1 · M1 · L1 · L2 · L7)
def _wait_status(project, jid, want, timeout=10.0):
    t0 = time.monotonic()
    st = None
    while time.monotonic() - t0 < timeout:
        st = sql(project, "select status from paperlab.jobs where id = %s", (jid,))[0][0]
        if st in want:
            return st
        time.sleep(0.1)
    return st


def test_sse_job_not_rerun_after_server_crash(env, project):
    """H1 (품질팀 P1): 대화 SSE 중 서버가 죽어 running(api) 작업이 남고 리스가 지나도, 복구 스캔은 다시 실행하지 않고
    취소(interrupted)로 끝낸다 — 요금 이중 · 대화 중복 저장 없음"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = paper(ca)
    gate = threading.Event()

    def slow_chat(ctx, history, question, engine="claude"):
        yield {"type": "delta", "text": "부분"}
        gate.wait(30)
        yield {"type": "done", "text": "늦은 답", "citations": []}

    env.fake_ai.chat = slow_chat

    def run():
        with ca.stream("POST", f"/api/papers/{pid}/chat", json={"question": "죽기 전 질문"}) as r:
            for _ in r.iter_lines():
                pass

    t = threading.Thread(target=run, daemon=True)
    t.start()
    for _ in range(100):
        rows = sql(project, "select id, status, interactive from paperlab.jobs where user_id = %s and kind = 'chat'",
                   (env.a.id,))
        if rows:
            break
        time.sleep(0.1)
    jid, status, interactive = rows[0]
    assert status == "running" and interactive is True
    # 서버 강제 종료 흉내: 이 앱은 더 이상 반영하지 못하게 리스 토큰을 바꾸고 리스를 지난 것으로
    sql(project, "update paperlab.jobs set lease_token = gen_random_uuid(), lease_until = now() - interval '1 second' "
                 "where id = %s", (jid,))
    fresh = env.make(runner_opts={"scan_s": 0.3})
    fresh.app.state.runner.start()
    assert _wait_status(project, jid, ("succeeded", "failed", "cancelled"), 10) == "cancelled"
    assert fresh.fake_ai.calls == []
    gate.set()
    t.join(5)
    assert ca.get(f"/api/papers/{pid}/chat").json() == []
    v = ca.get(f"/api/jobs/{jid}").json()
    assert v["error_code"] == "interrupted"


def _serve(app):
    import socket

    import uvicorn
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="off"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    return server, th, port


@pytest.mark.parametrize("mode", ["streaming", "nonstreaming"])
def test_sse_disconnect_cancels_and_discards(env, project, mode):
    """H1 (품질팀 P2): 실제 uvicorn에서 첫 이벤트 뒤 연결을 끊으면 곧바로 cancelled, 그 뒤 온 답은 저장하지 않음.
    streaming = Anthropic처럼 글이 계속 옴 / nonstreaming = OpenAI · Google처럼 응답 전체를 기다림"""
    import httpx
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = paper(ca)
    gate = threading.Event()

    def chat(ctx, history, question, engine="claude"):
        yield {"type": "delta", "text": "a"}
        if mode == "streaming":
            for _ in range(60):
                if gate.wait(0.2):
                    break
                yield {"type": "delta", "text": "b"}
        else:
            gate.wait(30)
        yield {"type": "done", "text": "끊긴 뒤의 답", "citations": []}

    env.fake_ai.chat = chat
    server, th, port = _serve(env.app)
    try:
        headers = {"Authorization": f"Bearer {env.a.token}", "X-PaperLab": "1", "Host": "testserver"}
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", headers=headers, timeout=20) as c:
            with c.stream("POST", f"/api/papers/{pid}/chat", json={"question": "끊을 질문"}) as r:
                assert r.status_code == 200
                for line in r.iter_lines():
                    if line.startswith("data: "):
                        break
        jid = sql(project, "select id from paperlab.jobs where user_id = %s and kind = 'chat' order by id desc limit 1",
                  (env.a.id,))[0][0]
        assert _wait_status(project, jid, ("cancelled", "succeeded", "failed"), 3) == "cancelled"  # GC에 기대지 않음
        gate.set()
        time.sleep(1)
        assert sql(project, "select status from paperlab.jobs where id = %s", (jid,))[0][0] == "cancelled"
        assert ca.get(f"/api/papers/{pid}/chat").json() == []
        # 리스가 지난 뒤 복구 스캔도 다시 실행하지 않음
        env.app.state.runner.start(scan=False)
        env.app.state.runner.scan_once()
        time.sleep(1)
        assert sql(project, "select status from paperlab.jobs where id = %s", (jid,))[0][0] == "cancelled"
    finally:
        server.should_exit = True
        th.join(5)


def test_runner_registers_after_claim_and_renew_survives_errors(env, project, monkeypatch):
    """M1 (품질팀 P7): 실행기는 리스를 잡은 뒤에만 running에 등록(빈 토큰 없음), 연장 스레드는 어떤 오류에도 살아 있음"""
    monkeypatch.setattr(jobs, "LEASE_S", 3)
    c = env.make(runner_opts={"renew_s": 0.5})
    runner = c.app.state.runner
    seen = []
    real_claim = jobs.claim_api

    def slow_claim(lib, job_id, guide=""):
        seen.append(dict(runner.running))  # 잡는 동안 running에 이 작업이 없어야 함
        time.sleep(0.8)
        return real_claim(lib, job_id, guide)

    monkeypatch.setattr(jobs, "claim_api", slow_claim)
    real_touch = jobs.touch_lease
    boom = {"n": 0}

    def flaky(lib, job_id, token, **kw):
        if kw.get("renew") and boom["n"] < 2:
            boom["n"] += 1
            raise RuntimeError("일시 오류")
        return real_touch(lib, job_id, token, **kw)

    monkeypatch.setattr(jobs, "touch_lease", flaky)
    ca = c.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    c.fake_ai.gate = threading.Event()
    runner.start(scan=False)
    jid = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]["id"]
    time.sleep(7)  # 리스 3초보다 길게 — 연장이 계속돼야 다시 잡히지 않음
    lease_threads = [t for t in runner._workers if t.name == "api-runner-lease"]
    assert lease_threads and all(t.is_alive() for t in lease_threads) and boom["n"] == 2
    assert all(jid not in r for r in seen)
    assert all(r["token"] for r in runner.running.values())
    assert sql(project, "select attempts, status from paperlab.jobs where id = %s", (jid,))[0] == (1, "running")
    c.fake_ai.gate.set()
    assert c.wait_job(ca, jid)["status"] == "succeeded"


def test_worker_edges_cancel_requested_and_retry_status(env, project):
    """L1 · L2 · L7"""
    ca = env.client(env.a)
    a1, a2 = Worker(env, env.a, name="A1"), Worker(env, env.a, name="A2")
    tok = "12345678-1234-1234-1234-123456789012"
    assert a1.http.post("/api/worker/heartbeat", json={"jobs": [{"id": True, "lease_token": tok}]}).status_code == 400
    assert a1.http.post("/api/worker/heartbeat", json={"jobs": [{"id": 10 ** 20, "lease_token": tok}]}).status_code == 400
    assert a1.http.post(f"/api/worker/jobs/{10 ** 20}/result", json={"lease_token": tok, "outcome": "failed"}).status_code == 404
    assert ca.get(f"/api/jobs/{10 ** 20}").status_code == 404
    # L2: 취소 요청된 작업은 해지 · 다른 PC 재대기로 다시 실행되지 않음
    jid = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]["id"]
    a1.claim()
    ca.post(f"/api/jobs/{jid}/cancel")
    assert ca.delete(f"/api/devices/{a1.id}").json()["requeued_jobs"] == 0
    assert ca.get(f"/api/jobs/{jid}").json()["status"] == "cancelled" and a2.claim()["job"] is None
    jid = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]["id"]
    t = a2.claim()["job"]
    ca.post(f"/api/jobs/{jid}/cancel")
    assert a2.result(t, "failed", error_code="cli_not_logged_in", error="x").json()["status"] == "cancelled"
    # L7: 다시 시도가 진행 중 작업을 돌려주면 200
    pid = paper(ca)
    old = ca.post(f"/api/papers/{pid}/summary").json()["job"]["id"]
    ca.post(f"/api/jobs/{old}/cancel")
    active = ca.post(f"/api/papers/{pid}/summary").json()["job"]["id"]
    r = ca.post(f"/api/jobs/{old}/retry")
    assert r.status_code == 200 and r.json()["job"]["id"] == active
