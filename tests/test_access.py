"""관리자 승인 가입 (2026-10-29 — PAPERLAB_ALLOWLIST=approval, paperlab/access.py)"""
import pytest


@pytest.fixture
def approval_cloud(project, session_db, users):
    from .conftest import Cloud
    c = Cloud(project, session_db, users, access_approval=True, allowlist_enabled=False)
    yield c
    c.app.state.runner.stop()


@pytest.mark.db
def test_approval_flow(approval_cloud):
    cloud = approval_cloud
    admin = cloud.user()
    gate = cloud.app.state.access_gate
    gate.admins = frozenset({admin.email.lower()})
    a = cloud.client(admin)
    me = a.get("/api/me")
    assert me.status_code == 200 and me.json()["is_admin"] and me.json()["access_approval"]

    u = cloud.user()
    c = cloud.client(u)
    r = c.get("/api/me")
    assert r.status_code == 403 and r.json()["code"] == "pending_approval"
    lst = a.get("/api/admin/access").json()
    row = next(x for x in lst["items"] if x["user_id"] == u.id)
    assert row["status"] == "pending" and lst["pending"] >= 1 and lst["enabled"]

    assert a.post(f"/api/admin/access/{u.id}", json={"status": "bogus"}).status_code == 400
    assert a.post(f"/api/admin/access/{admin.id}", json={"status": "rejected"}).status_code == 400  # 내 계정은 못 막음
    assert a.post(f"/api/admin/access/{u.id}", json={"status": "approved"}).json()["status"] == "approved"
    assert c.get("/api/me").status_code == 200  # 승인 즉시 (캐시 잊음)
    assert c.get("/api/admin/access").status_code == 403  # 관리자 아님

    assert a.post(f"/api/admin/access/{u.id}", json={"status": "rejected"}).status_code == 200
    r = c.get("/api/me")
    assert r.status_code == 403 and r.json()["code"] == "access_rejected"
