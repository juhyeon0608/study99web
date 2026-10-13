"""6단계 폴더 동기화 — 서버 규칙 [db] (docs/specs/phase6-folder-sync.md 19장 60x · 61x · 62x · 63x · 67x 서버 몫).

PC는 **Python 가짜 PC**(TestClient로 /api/worker/sync/* 계약을 부름), 저장소는 FakeStorage(서명 PUT 흉내), 테스트용 Supabase만.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from paperlab.db import copy_name, kst_day

from .conftest import Cloud, make_pdf

pytestmark = pytest.mark.db


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
def env(project, session_db, ab, tmp_path):
    a, b = ab
    ids = [a.id, b.id]
    for t in ("jobs", "sync_ops", "sync_devices", "device_pair_codes", "devices", "papers", "folders", "tags",
              "sync_tombstones"):
        sql(project, f"delete from paperlab.{t} where user_id = any(%s::uuid[])", (ids,))
    c = Cloud(project, session_db, users=None, releases=tmp_path / "rel")
    c.app.state.allowlist.emails = frozenset(u.email.lower() for u in ab)
    c.known_uids |= set(ids)
    c.a, c.b = a, b
    c.ca, c.cb = c.client(a), c.client(b)
    c.ca.get("/api/me")
    c.cb.get("/api/me")
    yield c
    c.app.state.runner.stop()


class PC:
    """가짜 PC: 연결 코드 → 기기 토큰으로 sync API"""

    def __init__(self, cloud: Cloud, user, name="A1", app_version="0.3.0"):
        code = cloud.client(user).post("/api/devices/pair-codes").json()["code"]
        r = cloud.client().post("/api/worker/pair", json={"code": code, "name": name, "app_version": app_version})
        assert r.status_code == 200, r.text
        self.cloud, self.id, self.token = cloud, r.json()["device_id"], r.json()["token"]
        self.http = cloud.client(Authorization=f"Bearer {self.token}")

    def post(self, path: str, body: dict | None = None, status: int = 200) -> dict:
        r = self.http.post(f"/api/worker/sync/{path}", json=body if body is not None else {})
        assert r.status_code == status, (path, r.status_code, r.text)
        return r.json()

    def upload(self, data: bytes) -> str:
        slot = self.post("upload-slots", {"files": [{"size": len(data)}]})["slots"][0]
        assert self.cloud.storage.browser_put(slot["upload"]["url"], data) == 200
        return slot["upload_id"]

    def add(self, data: bytes, name: str = "a.pdf", folder_id=None, status: int = 200, upload: bool = True, **kw) -> dict:
        body = {"op_id": str(uuid.uuid4()), "sha256": hashlib.sha256(data).hexdigest(), "size": len(data),
                "mtime_ms": int(time.time() * 1000), "clock_offset_ms": 0, "folder_id": folder_id, "file_name": name,
                **kw}
        if upload and "upload_id" not in kw:
            body["upload_id"] = self.upload(data)
        return self.post("files/add", body, status)

    def content(self, pid: int, data: bytes, base: str, status: int = 200, **kw) -> dict:
        body = {"op_id": str(uuid.uuid4()), "upload_id": self.upload(data), "base_sha256": base,
                "sha256": hashlib.sha256(data).hexdigest(), "mtime_ms": int(time.time() * 1000), "clock_offset_ms": 0, **kw}
        return self.post(f"files/{pid}/content", body, status)

    def ops(self, *items) -> list[dict]:
        return self.post("ops", {"ops": [{"op_id": str(uuid.uuid4()), **it} for it in items]})["results"]

    def changes(self, cursor: str, limit: int = 500) -> dict:
        return self.post("changes", {"cursor": cursor, "limit": limit})

    def all_changes(self, cursor: str, limit: int = 500) -> tuple[list[dict], str]:
        out = []
        while True:
            r = self.changes(cursor, limit)
            out += r["changes"]
            cursor = r["cursor"]
            if not r["more"]:
                return out, cursor


def pdfdoc(tag: str) -> bytes:
    return make_pdf(title=f"Sync Paper {tag} {uuid.uuid4().hex[:6]}", body=f"body {tag}", doi="")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def nots(r: dict) -> dict:
    """응답에서 server_time(매 응답 지금 시각)을 뺀 것 — 멱등 비교용"""
    return {k: v for k, v in r.items() if k != "server_time"}


# ====================================================================== 60x 마이그레이션 · RLS · 트리거
def test_migration_policies_and_role(env, project):
    """AC-601 · 605a(정책 목록) · 6D1"""
    with psycopg.connect(project.admin_db, autocommit=True, prepare_threshold=None) as conn:
        tables = {r[0] for r in conn.execute(
            "select table_name from information_schema.columns where table_schema = 'paperlab' and column_name = 'paper_id' "
            "and table_name in (select tablename from pg_tables where schemaname = 'paperlab')")}
        pols = {r[0]: (r[1], r[2]) for r in conn.execute(
            "select tablename, permissive, qual from pg_policies where schemaname = 'paperlab' "
            "and policyname = 'hide_trashed_children'")}
        hide = conn.execute("select permissive, cmd from pg_policies where schemaname = 'paperlab' and tablename = 'papers' "
                            "and policyname = 'hide_trashed'").fetchone()
        news = conn.execute("select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = "
                            "'paperlab'::regnamespace and relname in ('sync_tombstones', 'sync_devices', 'sync_ops')").fetchall()
        privs = conn.execute("select has_table_privilege('authenticated', 'paperlab.sync_tombstones', 'insert'), "
                             "has_table_privilege('anon', 'paperlab.sync_ops', 'select')").fetchone()
    # manuscript_citations는 일부러 뺌: 인용 검증 upsert가 숨은 행과 겹치면 42501 — verify.py가 거름 (개발 보고)
    assert tables - {"manuscript_citations"} == set(pols), (tables, set(pols))
    assert all(p == "RESTRICTIVE" and "EXISTS" in q.upper() for p, q in pols.values())
    assert "paper_id IS NULL" in pols["jobs"][1] and "paper_id IS NULL" in pols["chat_sessions"][1]
    assert hide == ("RESTRICTIVE", "SELECT")
    assert sorted(news) == [("sync_devices", True, True), ("sync_ops", True, True), ("sync_tombstones", True, True)]
    assert privs == (False, False)
    with psycopg.connect(project.app_db, autocommit=True, prepare_threshold=None) as conn:
        assert conn.execute("show idle_in_transaction_session_timeout").fetchone()[0] == "1min"


def test_triggers_tombstones_and_account_delete(env, project, users):
    """AC-604: 동기화 열만 sync_rev를 올리고, 폴더 삭제 · 영구 삭제는 묘비, 계정 삭제 연쇄는 트리거 때문에 막히지 않음"""
    ca, a = env.ca, env.a
    fid = ca.post("/api/folders", json={"name": "Trig"}).json()["id"]
    pid = ca.post("/api/papers", json={"title": "Trigger Paper Title One", "doi": ""}).json()["paper"]["id"]

    def rev(table, i):
        return sql(project, f"select sync_rev, sync_xid::text from paperlab.{table} where id = %s", (i,))[0]

    r0 = rev("papers", pid)
    ca.patch(f"/api/papers/{pid}", json={"title": "Changed Title Only", "status": "done"})
    ca.post(f"/api/papers/{pid}/open")
    assert rev("papers", pid) == r0
    for q, args in (("update paperlab.papers set folder_id = %s where id = %s", (fid, pid)),
                    ("update paperlab.papers set file_name = 'x.pdf' where id = %s", (pid,)),
                    ("update paperlab.papers set pdf_sha256 = 'ab' where id = %s", (pid,)),
                    ("update paperlab.papers set pdf_key = 'k' where id = %s", (pid,)),
                    ("update paperlab.papers set deleted_at = now() where id = %s", (pid,))):
        sql(project, q, args)
        r1 = rev("papers", pid)
        assert r1[0] > r0[0] and r1[1] != r0[1], q
        r0 = r1
    f0 = rev("folders", fid)
    ca.patch(f"/api/folders/{fid}", json={"name": "Trig2"})
    assert rev("folders", fid)[0] > f0[0]
    ca.delete(f"/api/folders/{fid}")
    sql(project, "update paperlab.papers set pdf_key = '' where id = %s", (pid,))
    assert ca.post("/api/trash/purge", json={"ids": [pid]}).json() == {"purged": 1}
    tombs = sql(project, "select kind, entity_id from paperlab.sync_tombstones where user_id = %s order by id", (a.id,))
    assert tombs == [("folder", fid), ("paper", pid)]
    # 계정 삭제(연쇄) — 폴더 · 논문 · 묘비 · 동기화 기록이 있어도 실패하지 않음
    u = users()
    cu = env.client(u)
    env.app.state.allowlist.emails = env.app.state.allowlist.emails | {u.email.lower()}
    f2 = cu.post("/api/folders", json={"name": "P"}).json()["id"]
    cu.post("/api/folders", json={"name": "C", "parent_id": f2})
    cu.post("/api/papers", json={"title": "Account Delete Paper Title", "doi": "", "folder_id": f2})
    cu.delete(f"/api/folders/{f2}")
    PC(env, u, name="del").post("start", {"root_label": "x", "enabled": True})
    env.project.delete_user(u)
    assert sql(project, "select count(*) from auth.users where id = %s", (u.id,))[0][0] == 0
    for t in ("papers", "folders", "sync_tombstones", "sync_devices"):
        assert sql(project, f"select count(*) from paperlab.{t} where user_id = %s", (u.id,))[0][0] == 0, t


# ====================================================================== 61x 피드
def test_feed_commit_order_paging_and_bad_cursor(env, project):
    """AC-611 · 612 · 613 · 611a(경고)"""
    pc = PC(env, env.a)
    f1 = env.ca.post("/api/folders", json={"name": "F1"}).json()["id"]
    snap = pc.post("snapshot", {})
    cursor = snap["cursor"]
    x = pc.add(pdfdoc("x"), "x.pdf")["paper"]["id"]
    y = pc.add(pdfdoc("y"), "y.pdf")["paper"]["id"]
    _, cursor = pc.all_changes(cursor)
    claims = json.dumps({"sub": env.a.id, "role": "authenticated"})
    t1 = psycopg.connect(project.app_db, prepare_threshold=None)
    t2 = psycopg.connect(project.app_db, prepare_threshold=None)
    try:
        for c in (t1, t2):
            c.execute("select set_config('role', 'authenticated', true), set_config('request.jwt.claims', %s, true)",
                      (claims,))
        base_rev = sql(project, "select max(sync_rev) from paperlab.papers where user_id = %s", (env.a.id,))[0][0]
        t1.execute("update paperlab.papers set folder_id = %s where id = %s", (f1, x))   # T1이 먼저 번호를 받음
        t2.execute("update paperlab.papers set folder_id = %s where id = %s", (f1, y))
        t2.commit()
        # 음성 대조(AC-611 · K-38): sync_rev만으로 만든 커서는 지금 Y를 받아 Y 번호로 넘어가므로, T1이 늦게 커밋하면 X를 놓친다
        rev_only = sql(project, "select id, sync_rev from paperlab.papers where user_id = %s and sync_rev > %s "
                                "order by sync_rev", (env.a.id, base_rev))
        assert [r[0] for r in rev_only] == [y]
        r = pc.changes(cursor)
        assert r["changes"] == [] and r["cursor"] == cursor   # Y는 T1이 끝날 때까지 기다림 — 커서도 넘기지 않음
        t1.commit()
        assert sql(project, "select id from paperlab.papers where user_id = %s and sync_rev > %s",
                   (env.a.id, rev_only[-1][1])) == []   # rev 커서: X(더 작은 번호)를 영영 놓침
    finally:
        t1.close()
        t2.close()
    got, cursor2 = pc.all_changes(cursor, limit=1)          # 한 개씩 넘겨도 빠짐없이
    assert [(c["id"], c["data"]["folder_id"]) for c in got] == [(x, f1), (y, f1)]
    assert pc.changes(cursor2)["changes"] == []
    # 같은 트랜잭션의 여러 변경도 limit 1로 빠짐없이
    env.ca.post("/api/papers/bulk", json={"ids": [x, y], "action": "move_folder", "value": None})
    got, _ = pc.all_changes(cursor2, limit=1)
    assert sorted(c["id"] for c in got) == [x, y]
    for bad in ("abc", "1:", "-1:0", "99999999999999:0", f"0:{10 ** 17}"):
        r = pc.post("changes", {"cursor": bad}, status=409)
        assert r["code"] == "resync_required"


def test_feed_xmin_stall_warning(env, project, caplog):
    """AC-611a: 다른 연결이 트랜잭션을 연 채 쉬면 피드는 오류 없이 빈 응답, 같은 xmin이 오래가면 WARN 1줄"""
    pc = PC(env, env.a)
    cursor = pc.post("snapshot", {})["cursor"]
    pid = pc.add(pdfdoc("s"), "s.pdf")["paper"]["id"]
    _, cursor = pc.all_changes(cursor)
    st = env.app.state.sync
    st.stall_s = 0
    hold = psycopg.connect(project.app_db, prepare_threshold=None)
    try:
        hold.execute("select pg_current_xact_id()")   # xid를 쥔 채 쉼
        env.ca.patch(f"/api/papers/{pid}", json={"folder_id": env.ca.post("/api/folders", json={"name": "S"}).json()["id"]})
        with caplog.at_level(logging.WARNING, logger="paperlab.sync"):
            for _ in range(2):
                r = pc.changes(cursor)
                assert r["changes"] == [] and r["next_poll_s"] in (10, 60)
        warns = [x for x in caplog.records if "xmin stalled" in x.getMessage()]
        assert len(warns) == 1 and "held=" in warns[0].getMessage()
    finally:
        hold.rollback()
        hold.close()
    assert pid in [c["id"] for c in pc.changes(cursor)["changes"] if c["kind"] == "paper"]


# ====================================================================== snapshot · 이름 · 예산
def test_snapshot_names_budget_and_isolation(env, project):
    """AC-614 · 676 · 679(서버 몫)"""
    a, ca = env.a, env.ca
    p1 = env.upload(ca, make_pdf(title="Snapshot Name Paper One", doi=""), "")["id"]
    sql(project, "update paperlab.papers set file_name = '' where id = %s", (p1,))  # 6단계 전부터 있던 논문처럼
    p2 = ca.post("/api/papers", json={"title": "Snapshot Name Paper One", "doi": "", "allow_duplicate": True,
                                      "authors": [{"family": "Kim"}], "year": 2020}).json()["paper"]["id"]
    env.storage.objects[f"users/{a.id}/papers/{p2}.pdf"] = make_pdf(title="Snapshot second", doi="")
    sql(project, "update paperlab.papers set pdf_key = %s, pdf_sha256 = 'cd', pdf_size = 10 where id = %s",
        (f"users/{a.id}/papers/{p2}.pdf", p2))
    env.upload(env.cb, make_pdf(title="B Snapshot Paper", doi=""))
    pc = PC(env, a)
    s1 = pc.post("snapshot", {"limit": 1})
    assert s1["more"] and s1["next"]["kind"] == "paper" and set(s1["db"]) == {
        "size_bytes", "limit_bytes", "budget_bytes", "per_paper_bytes", "first_alloc_bytes"}
    assert s1["user_cap_bytes"] == 2 * 1024 ** 3 and s1["trash_bytes"] == 0
    names = dict(sql(project, "select id, file_name from paperlab.papers where id = any(%s)", ([p1, p2],)))
    assert names[p1] == "Snapshot Name Paper One.pdf" and names[p2] == "Kim 2020 - Snapshot Name Paper One.pdf"
    s2 = pc.post("snapshot", {"page_after": s1["next"], "limit": 2000})
    assert "db" not in s2 and "user_cap_bytes" not in s2 and s2["cursor"] == s1["cursor"]
    ids = {p["id"] for s in (s1, s2) for p in s["papers"]}
    assert ids == {p1, p2}
    pc.post("snapshot", {})
    assert dict(sql(project, "select id, file_name from paperlab.papers where id = any(%s)", ([p1, p2],))) == names
    # 예산: 주입한 한도 · 상한이 바로 반영
    env.app.state.config.sync_user_cap_bytes = 5000
    s = pc.post("snapshot", {})
    mine = env.ca.get("/api/storage/usage").json()["mine_bytes"]
    assert s["upload_budget_bytes"] == max(0, 5000 - mine) and s["upload_budget_limit"] == "user"
    env.app.state.config.db_limit_bytes = 1
    assert pc.post("snapshot", {})["db"]["budget_bytes"] == 0 and s1["other_sync_devices"] == 0
    env.app.state.config.db_limit_bytes = 500 * 1024 ** 2


# ====================================================================== 62x 동기화 작업
def test_add_lookup_link_restore_idempotent(env, project):
    """AC-621 · 622 · 623 · 624 · Q-4"""
    a = env.a
    pc = PC(env, a)
    fid = env.ca.post("/api/folders", json={"name": "인공지능"}).json()["id"]
    data = pdfdoc("add")
    r = pc.add(data, "논문.PDF", folder_id=fid)
    assert r["result"] == "created" and r["paper"]["file_name"] == "논문.PDF" and r["paper"]["folder_id"] == fid
    pid = r["paper"]["id"]
    assert sql(project, "select content_device_id from paperlab.papers where id = %s", (pid,))[0][0] == pc.id
    # 같은 해시 → linked(새 논문 0, 위치는 나중 것)
    r2 = pc.add(data, "다른.pdf", upload=False)
    assert r2["result"] == "linked" and r2["paper"]["id"] == pid and r2["paper"]["folder_id"] is None
    # sha 불일치 → 400 + 임시 파일 삭제
    other = pdfdoc("other")
    up = pc.upload(other)
    r = pc.add(data[:-1] + b" ", "x.pdf", upload_id=up, status=400)
    assert r["code"] == "sha_mismatch" and f"incoming/{a.id}/{up}.pdf" not in env.storage.objects
    up = pc.upload(b"not a pdf")
    assert pc.add(b"not a pdf", "x.pdf", upload_id=up, status=400)["code"] == "bad_pdf"
    # lookup: 살아 있음 · 휴지통 · B 것
    bdata = pdfdoc("b")
    PC(env, env.b, name="B1").add(bdata, "b.pdf")
    env.ca.delete(f"/api/papers/{pid}")
    found = pc.post("lookup", {"sha256": [sha(data), sha(bdata)]})["found"]
    assert found == {sha(data): {"id": pid, "folder_id": None, "file_name": "다른.pdf", "trashed": True}}
    # 휴지통 논문과 같은 해시 → restored (업로드 0, 하이라이트 그대로)
    env.ca.post(f"/api/papers/{pid}/annotations", json={"page": 1, "text": "hl"})  # 휴지통 논문 — 404
    sql(project, "insert into paperlab.annotations (user_id, paper_id, page, text) values (%s, %s, 1, 'kept')", (a.id, pid))
    before = len([op for op, _ in env.storage.log if op == "sign_put"])
    body = {"op_id": str(uuid.uuid4()), "sha256": sha(data), "size": len(data), "folder_id": fid, "file_name": "논문.pdf"}
    r = pc.post("files/add", body)
    assert r["result"] == "restored" and r["paper"] == {**r["paper"], "id": pid, "folder_id": fid, "file_name": "논문.pdf"}
    assert len([op for op, _ in env.storage.log if op == "sign_put"]) == before
    assert nots(pc.post("files/add", body)) == nots(r)          # 같은 op_id → 같은 응답, 논문 1편
    assert sql(project, "select count(*) from paperlab.papers where user_id = %s and pdf_sha256 = %s", (a.id, sha(data)))[0][0] == 1
    assert sql(project, "select count(*) from paperlab.annotations where paper_id = %s", (pid,))[0][0] == 1
    # Q-4: 휴지통에 같은 DOI · 다른 PDF → 새 논문 + trashed_duplicate_id
    d1 = make_pdf(title="Deep Residual Learning for Image Recognition", doi="10.1109/cvpr.2016.90")
    p1 = pc.add(d1, "res1.pdf")["paper"]["id"]
    env.ca.delete(f"/api/papers/{p1}")
    d2 = make_pdf(title="Deep Residual Learning for Image Recognition", body="other version", doi="10.1109/cvpr.2016.90")
    r = pc.add(d2, "res2.pdf")
    assert r["result"] == "created" and r["trashed_duplicate_id"] == p1 and r["paper"]["id"] != p1
    # 기기 토큰이 아닌 JWT · 토큰 없음 · 헤더 없음
    assert env.ca.post("/api/worker/sync/lookup", json={"sha256": []}).status_code == 401
    assert env.client().post("/api/worker/sync/lookup", json={"sha256": []}).status_code == 401
    assert env.client(Authorization=f"Bearer {pc.token}", **{"X-PaperLab": ""}).post(
        "/api/worker/sync/lookup", json={"sha256": []}).status_code == 403


def test_versions_revoked_busy_and_quota(env, project):
    """AC-629 · 677(서버) · 678 · 679 db_full"""
    old = PC(env, env.a, name="old", app_version="0.2.9")
    r = old.post("start", {}, status=426)
    assert r["code"] == "update_required" and r["min_app_version"] == "0.3.0"
    pc = PC(env, env.a)
    assert pc.post("start", {"root_label": "PaperLab 논문", "enabled": True})["limits"]["max_ops"] == 20
    feats = sql(project, "select features from paperlab.devices where id = %s", (pc.id,))[0][0]
    assert "sync" in feats
    # 사용자당 상한(동기화 올리기에만)
    env.app.state.config.sync_user_cap_bytes = 10
    data = pdfdoc("q")
    r = pc.post("upload-slots", {"files": [{"size": len(data)}]}, status=400)
    assert r["code"] == "sync_quota" and r["reason"] == "sync_quota"
    assert env.ca.post("/api/uploads", json={"files": [{"name": "x.pdf", "size": len(data)}]}).status_code == 200
    env.app.state.config.sync_user_cap_bytes = 2 * 1024 ** 3
    up = pc.upload(data)
    env.app.state.config.sync_user_cap_bytes = 10
    r = pc.add(data, "q.pdf", upload_id=up, status=400)
    assert r["code"] == "sync_quota"
    assert sql(project, "select count(*) from paperlab.papers where user_id = %s", (env.a.id,))[0][0] == 0
    env.app.state.config.sync_user_cap_bytes = 2 * 1024 ** 3
    # R2 95%
    env.app.state.config.storage_limit_bytes = 1
    assert pc.post("upload-slots", {"files": [{"size": 100}]}, status=400)["code"] == "storage_full"
    env.app.state.config.storage_limit_bytes = 10 * 1024 ** 3
    # DB 90% — created만 막힘
    env.app.state.config.db_limit_bytes = 1
    r = pc.add(data, "q.pdf", status=400)
    assert r["code"] == "db_full" and r["reason"] == "db"
    env.app.state.config.db_limit_bytes = 500 * 1024 ** 2
    # 상태 보고 · storage_full 이유
    pc.post("status", {"state": "storage_full", "counts": {"pending_up": 3, "reason": "sync_quota"}, "root_label": "r"})
    dev = next(d for d in env.ca.get("/api/devices").json() if d["id"] == pc.id)
    assert dev["sync"]["state"] == "storage_full" and dev["sync"]["counts"] == {"pending_up": 3, "reason": "sync_quota"}
    assert env.ca.get("/api/stats").json()["sync_on"] is True
    # 해지 → 401 device_revoked
    env.ca.delete(f"/api/devices/{pc.id}")
    assert pc.post("lookup", {"sha256": []}, status=401)["code"] == "device_revoked"
    assert env.ca.get("/api/stats").json()["sync_on"] is False


def test_device_check(env):
    """Q-2: 표식의 device_id가 누구 것인지 — 다른 사용자 것은 있음/없음만"""
    pc = PC(env, env.a)
    other = PC(env, env.a, name="A2")
    gone = PC(env, env.a, name="A3")
    env.ca.delete(f"/api/devices/{gone.id}")
    bpc = PC(env, env.b, name="B1")
    chk = lambda i: pc.post("device-check", {"device_id": i})["status"]  # noqa: E731
    assert [chk(pc.id), chk(other.id), chk(gone.id), chk(bpc.id), chk(2 ** 62)] == \
        ["self", "active_other", "same_user_revoked", "other_user", "unknown"]
    assert pc.post("device-check", {"device_id": "1"}, status=400)["code"] == "bad_request"


def test_ops_moves_deletes_and_feed_labels(env, project):
    """AC-625 · 626 · 627 · 629(항목 실패) · 6M3(컬렉션 · 태그는 sync_rev 그대로)"""
    a = env.a
    pc = PC(env, a, name="집 PC")
    cursor = pc.post("snapshot", {})["cursor"]
    d1, d2 = pdfdoc("o1"), pdfdoc("o2")
    p1 = pc.add(d1, "same.pdf")["paper"]["id"]
    fid = env.ca.post("/api/folders", json={"name": "X"}).json()["id"]
    p2 = pc.add(d2, "same.pdf", folder_id=fid)["paper"]["id"]
    rev = sql(project, "select sync_rev from paperlab.papers where id = %s", (p1,))[0][0]
    cid = env.ca.post("/api/collections", json={"name": "c"}).json()["id"]
    env.ca.post("/api/papers/bulk", json={"ids": [p1], "action": "add_collection", "value": str(cid)})
    env.ca.patch(f"/api/papers/{p1}", json={"tags": ["t1"]})
    assert sql(project, "select sync_rev from paperlab.papers where id = %s", (p1,))[0][0] == rev
    res = pc.ops({"type": "file.move", "id": p2, "folder_id": None, "file_name": "SAME.pdf"},
                 {"type": "file.move", "id": 999999999, "folder_id": None, "file_name": "z.pdf"},
                 {"type": "bogus"},
                 {"type": "folder.create", "parent_id": None, "name": "x"},
                 {"type": "folder.create", "parent_id": None, "name": "Y"},
                 {"type": "folder.update", "id": fid, "parent_id": fid},
                 {"type": "file.delete", "id": p1, "base_sha256": "0" * 64})
    assert res[0]["result"] == "applied" and res[0]["paper"]["file_name"] == copy_name("SAME.pdf", "집 PC", kst_day())
    assert [r["result"] for r in res[1:]] == ["gone", "error", "linked", "created", "rejected", "changed"]
    assert res[3]["folder"]["id"] == fid and res[2]["code"] == "bad_request"
    y = res[4]["folder"]["id"]
    res = pc.ops({"type": "folder.update", "id": y, "name": "X"}, {"type": "folder.delete", "id": fid})
    assert res[0]["folder"]["name"] == "X (2)" and res[1]["result"] == "deleted"
    env.ca.post(f"/api/papers/{p1}/summary")  # 대기 작업 (경로가 없으면 400 — 행을 직접)
    sql(project, "insert into paperlab.jobs (user_id, kind, status, runner, engine, route, paper_id) values "
                 "(%s, 'summary', 'queued', 'api', 'claude', '[{\"runner\": \"api\", \"engine\": \"claude\"}]', %s)",
        (a.id, p1))
    res = pc.ops({"type": "file.delete", "id": p1, "base_sha256": sha(d1)})
    assert res[0]["result"] == "trashed"
    assert sql(project, "select deleted_by from paperlab.papers where id = %s", (p1,))[0][0] == f"device:{pc.id}"
    assert sql(project, "select status, error_code from paperlab.jobs where paper_id = %s", (p1,)) == [("cancelled",
                                                                                                    "paper_trashed")]
    assert pc.ops({"type": "file.delete", "id": p1, "base_sha256": sha(d1)})[0]["result"] == "trashed"
    env.ca.delete(f"/api/papers/{p2}")
    got, _ = pc.all_changes(cursor)
    trash = {c["id"]: c["data"]["deleted_by_label"] for c in got if c["op"] == "trash"}
    assert trash == {p1: "집 PC", p2: "웹"}
    assert ("folder", fid, "delete") in {(c["kind"], c["id"], c["op"]) for c in got}
    # folder.delete: 안에 PDF 논문이 남으면 not_empty
    f2 = pc.ops({"type": "folder.create", "parent_id": None, "name": "Full"})[0]["folder"]["id"]
    pc.add(pdfdoc("full"), "f.pdf", folder_id=f2)
    assert pc.ops({"type": "folder.delete", "id": f2})[0]["result"] == "not_empty"


def test_download_scoped(env, project):
    """AC-628"""
    pc = PC(env, env.a)
    data = pdfdoc("dl")
    pid = pc.add(data, "d.pdf")["paper"]["id"]
    bp = PC(env, env.b, name="B1").add(pdfdoc("bd"), "b.pdf")["paper"]["id"]
    tp = pc.add(pdfdoc("tr"), "t.pdf")["paper"]["id"]
    env.ca.delete(f"/api/papers/{tp}")
    items = {i["id"]: i for i in pc.post("download", {"ids": [pid, bp, tp]})["items"]}
    assert items[pid]["sha256"] == sha(data) and items[pid]["size"] == len(data)
    assert items[bp]["status"] == 404 and items[tp]["status"] == 404
    assert f"/users/{env.a.id}/papers/{pid}.pdf" in items[pid]["url"]


# ====================================================================== 63x 충돌 · K-28
def _translation(env, project, pid: int) -> str:
    key = f"users/{env.a.id}/translations/{pid}.0123abcd.json"
    sql(project, "insert into paperlab.translations (user_id, paper_id, lang, tr_key, page_state) values (%s, %s, 'ko', %s, 'd')",
        (env.a.id, pid, key))
    env.storage.objects[key] = b"{}"
    return key


def test_content_replace_conflict_and_translation(env, project):
    """AC-631 · 632 · 633 · 634 · 636 · 638"""
    a = env.a
    pc1, pc2 = PC(env, a, name="집 PC"), PC(env, a, name="회사")
    v1 = pdfdoc("v1")
    pid = pc1.add(v1, "paper.pdf")["paper"]["id"]
    sql(project, "insert into paperlab.explanations (user_id, paper_id, kind, lang, sel_hash, page, source_text, result) "
                 "values (%s, %s, 'translate', 'ko', %s, 1, 's', '{}')", (a.id, pid, "e" * 64))
    key = _translation(env, project, pid)
    # base = 지금 → 교체 · 번역 지움 · 안내 기록 · 자동 재번역 없음
    v2 = pdfdoc("v2")
    r = pc2.content(pid, v2, sha(v1))
    assert r["result"] == "replaced" and r["translation_cleared"] is True and r["paper"]["sha256"] == sha(v2)
    assert key not in env.storage.objects
    row = sql(project, "select content_device_id, translation_cleared_at is not null from paperlab.papers where id = %s",
              (pid,))[0]
    assert row == (pc2.id, True)
    assert sql(project, "select count(*) from paperlab.explanations where paper_id = %s", (pid,))[0][0] == 1
    assert sql(project, "select count(*) from paperlab.jobs where paper_id = %s and kind = 'translate_paper'", (pid,))[0][0] == 0
    detail = env.ca.get(f"/api/papers/{pid}").json()
    assert detail["file_name"] == "paper.pdf" and detail["translation_cleared_at"]
    # 다시 교체 — 번역이 없었으면 false
    v3 = pdfdoc("v3")
    assert pc1.content(pid, v3, sha(v2))["translation_cleared"] is False
    # 충돌: 들어온 쪽이 더 나중(보정 시각) → 원래 = 들어온 내용, 사본 = 옛 서버 내용(복사가 덮어쓰기보다 먼저)
    old_at = datetime.now(timezone.utc) - timedelta(hours=3)
    sql(project, "update paperlab.papers set content_at = %s where id = %s", (old_at, pid))
    sql(project, "insert into paperlab.annotations (user_id, paper_id, page, text) values (%s, %s, 1, 'mine')", (a.id, pid))
    env.storage.log.clear()
    v4 = pdfdoc("v4")
    r = pc2.content(pid, v4, sha(v1))   # base가 옛 판 → 충돌
    assert r["result"] == "conflict" and r["winner"] == "incoming"
    assert r["paper"]["sha256"] == sha(v4) and r["copy"]["sha256"] == sha(v3)
    assert r["copy"]["file_name"] == copy_name("paper.pdf", "집 PC", kst_day(old_at))
    ops = [(op, k) for op, k in env.storage.log if op == "copy"]
    assert ops[0] == ("copy", f"users/{a.id}/papers/{r['copy']['id']}.pdf") and ops[1][1].endswith(f"/{pid}.pdf")
    cp = r["copy"]["id"]
    tags = [t["name"] for t in env.ca.get(f"/api/papers/{cp}").json()["tags"]]
    assert tags == ["충돌 사본"]
    assert sql(project, "select count(*) from paperlab.annotations where paper_id = %s", (cp,))[0][0] == 0
    assert sql(project, "select count(*) from paperlab.annotations where paper_id = %s", (pid,))[0][0] == 1
    # 서버 쪽이 더 나중 → 원래 그대로, 사본 = 들어온 내용(들어온 기기 이름)
    sql(project, "update paperlab.papers set content_at = now() + interval '1 minute' where id = %s", (pid,))
    v5 = pdfdoc("v5")
    past = int((time.time() - 3600) * 1000)
    r = pc1.content(pid, v5, sha(v1), mtime_ms=past)
    assert r["winner"] == "server" and r["paper"]["sha256"] == sha(v4) and r["copy"]["sha256"] == sha(v5)
    assert "(충돌 사본 집 PC " in r["copy"]["file_name"]
    # 2초 이하 · 시계 차이 모름 · 미래 → 들어온 쪽(도착 순서)
    for kw in ({"clock_offset_ms": None}, {"mtime_ms": int((time.time() + 3600) * 1000)}):
        cur = sql(project, "select pdf_sha256 from paperlab.papers where id = %s", (pid,))[0][0]
        v = pdfdoc("t")
        r = pc2.content(pid, v, sha(v1), **kw)
        assert r["winner"] == "incoming" and r["paper"]["sha256"] == sha(v) and r["copy"]["sha256"] == cur
    # 휴지통 논문에 내용 → 되살리고 교체
    env.ca.delete(f"/api/papers/{pid}")
    v6 = pdfdoc("v6")
    r = pc1.content(pid, v6, sha(v1))
    assert r["result"] == "restored" and r["paper"]["sha256"] == sha(v6)
    assert env.ca.get(f"/api/papers/{pid}").status_code == 200
    # 웹 [PDF 바꾸기]도 같은 값(K-34)
    _translation(env, project, pid)
    slot = env.ca.post(f"/api/papers/{pid}/pdf/upload").json()
    env.storage.browser_put(slot["upload"]["url"], pdfdoc("web"))
    r = env.ca.post(f"/api/papers/{pid}/pdf/complete", json={"upload_id": slot["upload_id"], "name": "w.pdf"})
    assert r.json()["translation_cleared"] is True
    assert sql(project, "select content_device_id from paperlab.papers where id = %s", (pid,))[0][0] is None
    # [전체 번역]을 새로 시작하면 안내가 사라짐(행을 만들 때 비움)
    from paperlab import translate
    with env.app.state.db.user_tx({"sub": a.id, "role": "authenticated"}) as lib:
        translate.create_row(lib, pid, "ko", "-", None, False, "")
    assert env.ca.get(f"/api/papers/{pid}").json()["translation_cleared_at"] is None
    env.assert_keys_scoped()


def test_logs_have_no_names_hashes_or_tokens(env, caplog):
    """AC-6X3(서버 몫): 동기화 요청 동안 로그에 파일 이름 · 해시 · 서명 주소 · 기기 토큰이 없다"""
    with caplog.at_level(logging.DEBUG):
        pc = PC(env, env.a)
        data = pdfdoc("log")
        name = f"비밀이름-{uuid.uuid4().hex[:6]}.pdf"
        pid = pc.add(data, name)["paper"]["id"]
        pc.ops({"type": "file.move", "id": pid, "folder_id": None, "file_name": "x" + name},
               {"type": "folder.create", "parent_id": None, "name": "비밀폴더"})
        pc.post("changes", {"cursor": "0:0"})
        pc.post("download", {"ids": [pid]})
    text = "\n".join(r.getMessage() for r in caplog.records)
    for secret in (name, "비밀폴더", sha(data), pc.token, "X-Amz-Signature"):
        assert secret not in text, secret


def test_body_limit_counts_real_bytes_and_size_must_match(env, project):
    """QA D5: chunked(길이 헤더 없음)여도 실제로 읽은 256KB에서 413. QA D4: 보낸 size와 실제 크기가 다르면 거부 · 임시 파일 삭제"""
    pc = PC(env, env.a)
    big = json.dumps({"sha256": ["0" * 64] * 5000}).encode()
    assert len(big) > 256 * 1024
    r = pc.http.post("/api/worker/sync/lookup", content=iter([big[i:i + 4096] for i in range(0, len(big), 4096)]),
                     headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json()["code"] == "too_large"
    assert pc.http.post("/api/worker/sync/lookup", content=b"[1]").json()["code"] == "bad_request"
    data = pdfdoc("size")
    up = pc.upload(data)
    r = pc.add(data, "s.pdf", upload_id=up, size=10, status=400)
    assert r["code"] == "sha_mismatch" and f"incoming/{env.a.id}/{up}.pdf" not in env.storage.objects
    assert sql(project, "select count(*) from paperlab.papers where user_id = %s", (env.a.id,))[0][0] == 0


def test_admin_db_maintain(project):
    """AC-679a: 관리 함수가 pgroonga_vacuum()을 부르고 전 · 후 DB 크기를 돌려준다(테스트 DB 관리자 주소 — CLI는 테스트 DB를 거부)"""
    from paperlab.admin import db_maintain
    r = db_maintain(project.admin_db)
    assert set(r) == {"before_bytes", "after_bytes"} and r["before_bytes"] > 0 and r["after_bytes"] > 0
