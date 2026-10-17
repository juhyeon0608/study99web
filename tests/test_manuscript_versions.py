"""원고 버전 기록 · 비교 · 되돌리기 (docs/specs/manuscript-history.md).

- 순수 함수: 보관 정리(thin_ids) · 이름 검사 · 10분 간격
- DB(@pytest.mark.db — 테스트 프로젝트): 자동 기록 간격 · 같은 글 건너뛰기 · 직접 저장 · AI 넣기 전 · 되돌리기 · 지우기 ·
  보관 정리 · DB 한도 · RLS(다른 사용자 0행 · 남의 원고를 가리키는 행 못 만듦) · 원고 삭제 cascade
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import psycopg
import pytest

from paperlab import versions as V

from .conftest import Cloud

T0 = datetime(2026, 10, 17, 3, 0, tzinfo=timezone.utc)  # 한국 12:00


def rows_at(hours: list[float], size: int = 10) -> list[dict]:
    return [{"id": i + 1, "created_at": T0 - timedelta(hours=h), "size": size} for i, h in enumerate(hours)]


# ====================================================================== 순수 함수
def test_thin_keeps_recent_then_one_per_day_for_30_days():
    # 최근 30개는 모두 · 그 뒤는 한국 날짜마다 가장 최근 하나 · 30일 넘으면 지움
    hours = [i * 0.2 for i in range(V.KEEP_RECENT)]                 # 6시간 안 30개 (모두 남김)
    hours += [24 * 2 + 1, 24 * 2 + 2, 24 * 3 + 1, 24 * 31, 24 * 45]  # 이틀 전 2개 · 사흘 전 1개 · 31일 · 45일
    rows = rows_at(hours)
    drop = V.thin_ids(rows, T0)
    assert drop == [rows[V.KEEP_RECENT + 1]["id"], rows[-2]["id"], rows[-1]["id"]]
    assert V.thin_ids(rows[:V.KEEP_RECENT], T0) == []


def test_thin_same_day_as_recent_rows_is_dropped():
    hours = [i * 0.1 for i in range(V.KEEP_RECENT)] + [3.5, 4.0]  # 오늘 이미 최근 기록이 있음
    assert V.thin_ids(rows_at(hours), T0) == [V.KEEP_RECENT + 1, V.KEEP_RECENT + 2]


def test_thin_byte_cap_drops_oldest_but_keeps_newest():
    # 합계는 최신 → 오래된 순으로 더한다: 첫째(한도의 절반+1)는 남고, 둘째를 더하면 한도를 넘으므로 둘째부터 지움
    big = V.AUTO_MAX_BYTES // 2 + 1
    assert V.thin_ids(rows_at([0, 1, 2, 3], size=big), T0) == [2, 3, 4]
    assert V.thin_ids(rows_at([0, 1, 2], size=V.AUTO_MAX_BYTES // 3), T0) == []
    huge = rows_at([0, 1], size=V.AUTO_MAX_BYTES * 3)
    assert V.thin_ids(huge, T0) == [2]  # 가장 최근 하나는 한도를 넘어도 남김


def test_due_and_digest_and_meta():
    assert V.due(None, T0)
    assert not V.due({"created_at": T0 - timedelta(minutes=9, seconds=59)}, T0)
    assert V.due({"created_at": T0 - V.SNAPSHOT_EVERY}, T0)
    assert V.digest("가") == V.digest("가") != V.digest("나") and len(V.digest("")) == 64
    m = V.meta({"id": 1, "reason": "auto", "label": "", "size": 3, "chars": 1, "created_at": T0})
    assert m == {"id": 1, "reason": "auto", "label": "", "size": 3, "chars": 1, "created_at": "2026-10-17T03:00:00+00:00",
                 "pinned": False}
    assert V.meta({"id": 2, "reason": "auto", "label": "x", "size": 0, "chars": 0, "created_at": T0})["pinned"]


@pytest.mark.parametrize("value, ok", [(None, ""), ("  초고 ", "초고"), ("a" * 60, "a" * 60), ("a" * 61, None),
                                       ("줄\n바꿈", None), ("a b", None), (" ", ""), (3, None)])
def test_clean_label(value, ok):
    if ok is None:
        with pytest.raises(V.VersionError):
            V.clean_label(value)
    else:
        assert V.clean_label(value) == ok


# ====================================================================== DB
def admin_sql(project, q: str, params=None):
    with psycopg.connect(project.admin_db, autocommit=True, prepare_threshold=None) as conn:
        cur = conn.execute(q, params)
        return cur.fetchall() if cur.description else None


def backdate(project, mid: int, minutes: float) -> None:
    admin_sql(project, "update paperlab.manuscript_versions set created_at = created_at - make_interval(secs => %s) "
                       "where manuscript_id = %s", (minutes * 60, mid))


def listing(c, mid: int) -> list[dict]:
    r = c.get(f"/api/manuscripts/{mid}/versions")
    assert r.status_code == 200, r.text
    return r.json()["items"]


@pytest.mark.db
def test_autosave_snapshots_previous_content_every_10_minutes(cloud, project):
    c = cloud.client(cloud.user())
    mid = c.post("/api/manuscripts", json={"content": "# 원고\n\n첫 글"}).json()["id"]
    assert listing(c, mid) == []
    # 첫 PATCH: 기록이 없으므로 바뀌기 전 글(첫 글)을 남김
    assert c.patch(f"/api/manuscripts/{mid}", json={"content": "# 원고\n\n둘째 글"}).json()["ok"]
    items = listing(c, mid)
    assert [(v["reason"], v["pinned"]) for v in items] == [("auto", False)]
    assert c.get(f"/api/manuscripts/{mid}/versions/{items[0]['id']}").json()["content"] == "# 원고\n\n첫 글"
    # 10분 안: 더 남기지 않음 · 같은 글 PATCH도 남기지 않음 · 제목만 바꿔도 남기지 않음
    c.patch(f"/api/manuscripts/{mid}", json={"content": "# 원고\n\n셋째 글"})
    c.patch(f"/api/manuscripts/{mid}", json={"content": "# 원고\n\n셋째 글"})
    c.patch(f"/api/manuscripts/{mid}", json={"style": "ieee"})
    assert len(listing(c, mid)) == 1
    # 10분이 지나면 바뀌기 전 글(셋째)을 남김
    backdate(project, mid, 10.5)
    c.patch(f"/api/manuscripts/{mid}", json={"content": "# 원고\n\n넷째 글"})
    items = listing(c, mid)
    assert len(items) == 2 and items[0]["reason"] == "auto"
    v = c.get(f"/api/manuscripts/{mid}/versions/{items[0]['id']}").json()
    assert v["content"] == "# 원고\n\n셋째 글" and v["chars"] == len("# 원고\n\n셋째 글")
    assert v["size"] == len("# 원고\n\n셋째 글".encode())
    # 10분 지났어도 바뀌기 전 글이 마지막 기록과 같으면(되돌린 직후 등) 남기지 않음
    backdate(project, mid, 11)
    last = c.post(f"/api/manuscripts/{mid}/versions", json={"label": "중간"}).json()  # 넷째 글을 직접 저장
    assert last["created"] and last["reason"] == "manual" and last["label"] == "중간" and last["pinned"]
    backdate(project, mid, 11)
    c.patch(f"/api/manuscripts/{mid}", json={"content": "# 원고\n\n다섯째 글"})
    assert len(listing(c, mid)) == 3


@pytest.mark.db
def test_manual_ai_apply_label_restore_delete(cloud, project):
    c = cloud.client(cloud.user())
    mid = c.post("/api/manuscripts", json={"content": "# 제목 A\n\n본문 A"}).json()["id"]
    v1 = c.post(f"/api/manuscripts/{mid}/versions", json={}).json()
    assert v1["created"] and v1["reason"] == "manual" and v1["label"] == ""
    # 같은 글을 또 직접 저장 → 새로 만들지 않음 (이름을 주면 그 기록에 붙임)
    again = c.post(f"/api/manuscripts/{mid}/versions", json={"label": "초고"}).json()
    assert not again["created"] and again["id"] == v1["id"] and again["label"] == "초고"
    # AI 넣기 전: 화면이 보낸 편집기 글(아직 저장 안 된 글)을 남김
    ai = c.post(f"/api/manuscripts/{mid}/versions", json={"reason": "ai_apply", "content": "# 제목 A\n\n편집 중 글"}).json()
    assert ai["created"] and ai["reason"] == "ai_apply" and not ai["pinned"]
    dup = c.post(f"/api/manuscripts/{mid}/versions", json={"reason": "ai_apply", "content": "# 제목 A\n\n편집 중 글"}).json()
    assert not dup["created"] and dup["id"] == ai["id"]
    for bad in ({"reason": "auto"}, {"reason": "restore"}, {"label": "x\ny"}, {"label": "a" * 61}, {"content": 3}):
        assert c.post(f"/api/manuscripts/{mid}/versions", json=bad).status_code == 400, bad
    # 이름 붙이기 · 빼기
    r = c.patch(f"/api/manuscripts/{mid}/versions/{ai['id']}", json={"label": "AI 전"}).json()
    assert r["label"] == "AI 전" and r["pinned"]
    assert c.patch(f"/api/manuscripts/{mid}/versions/{ai['id']}", json={"label": ""}).json()["pinned"] is False
    # 되돌리기: 지금 글을 restore로 남기고 원고를 바꿈(제목도 원고 # 줄에서)
    c.patch(f"/api/manuscripts/{mid}", json={"content": "# 제목 B\n\n본문 B"})
    r = c.post(f"/api/manuscripts/{mid}/versions/{v1['id']}/restore").json()
    assert r["ok"] and r["changed"] and r["content"] == "# 제목 A\n\n본문 A" and r["title"] == "제목 A"
    assert r["backup"]["reason"] == "restore" and r["restored"]["id"] == v1["id"]
    got = c.get(f"/api/manuscripts/{mid}").json()
    assert got["content"] == "# 제목 A\n\n본문 A" and got["title"] == "제목 A"
    assert c.get(f"/api/manuscripts/{mid}/versions/{r['backup']['id']}").json()["content"] == "# 제목 B\n\n본문 B"
    # 같은 글로 되돌리기는 그대로(기록 없음)
    n = len(listing(c, mid))
    r2 = c.post(f"/api/manuscripts/{mid}/versions/{v1['id']}/restore").json()
    assert r2["changed"] is False and r2["backup"] is None and len(listing(c, mid)) == n
    # 지우기
    assert c.delete(f"/api/manuscripts/{mid}/versions/{ai['id']}").json() == {"ok": True}
    assert c.get(f"/api/manuscripts/{mid}/versions/{ai['id']}").status_code == 404
    assert c.delete(f"/api/manuscripts/{mid}/versions/{ai['id']}").status_code == 404
    assert c.get(f"/api/manuscripts/{mid}/versions/0").status_code == 404
    assert c.get(f"/api/manuscripts/{mid}/versions/{2 ** 63}").status_code in (404, 422)
    # 목록은 최신순 · 본문 없음
    items = listing(c, mid)
    assert all("content" not in v for v in items)
    assert [v["created_at"] for v in items] == sorted((v["created_at"] for v in items), reverse=True)
    # 원고를 지우면 기록도 (cascade)
    assert c.delete(f"/api/manuscripts/{mid}").json() == {"ok": True}
    assert admin_sql(project, "select count(*) from paperlab.manuscript_versions where manuscript_id = %s", (mid,)) == [(0,)]


@pytest.mark.db
def test_pinned_limit(cloud, project, monkeypatch):
    monkeypatch.setattr(V, "PINNED_MAX", 2)
    c = cloud.client(cloud.user())
    mid = c.post("/api/manuscripts", json={"content": "# a\n\n1"}).json()["id"]
    assert c.post(f"/api/manuscripts/{mid}/versions", json={"content": "1"}).json()["created"]
    assert c.post(f"/api/manuscripts/{mid}/versions", json={"content": "2"}).json()["created"]
    r = c.post(f"/api/manuscripts/{mid}/versions", json={"content": "3"})
    assert r.status_code == 400 and "까지" in r.json()["detail"]
    ai = c.post(f"/api/manuscripts/{mid}/versions", json={"reason": "ai_apply", "content": "4"}).json()
    assert ai["created"]  # 자동 기록은 상한과 무관
    assert c.patch(f"/api/manuscripts/{mid}/versions/{ai['id']}", json={"label": "x"}).status_code == 400


@pytest.mark.db
def test_pinned_byte_cap(cloud, project, monkeypatch):
    monkeypatch.setattr(V, "PINNED_MAX_BYTES", 10)
    c = cloud.client(cloud.user())
    mid = c.post("/api/manuscripts", json={"content": "# a"}).json()["id"]
    assert c.post(f"/api/manuscripts/{mid}/versions", json={"content": "123456"}).json()["created"]   # 6바이트
    r = c.post(f"/api/manuscripts/{mid}/versions", json={"content": "abcde"})                       # 6 + 5 > 10
    assert r.status_code == 400 and "10MB" in r.json()["detail"]
    ai = c.post(f"/api/manuscripts/{mid}/versions", json={"reason": "ai_apply", "content": "abcde"}).json()
    assert ai["created"]  # 자동 기록은 상한과 무관
    assert c.patch(f"/api/manuscripts/{mid}/versions/{ai['id']}", json={"label": "x"}).status_code == 400
    assert c.post(f"/api/manuscripts/{mid}/versions", json={"content": "abcd"}).json()["created"]  # 6 + 4 = 10


@pytest.mark.db
def test_same_text_new_label_keeps_old_label(cloud, project):
    # 같은 글이라도 이미 다른 이름이 붙은 기록이면 이름을 바꾸지 않고 새로 남긴다(이전 이름이 몰래 사라지지 않게)
    c = cloud.client(cloud.user())
    mid = c.post("/api/manuscripts", json={"content": "# 같은 글"}).json()["id"]
    a = c.post(f"/api/manuscripts/{mid}/versions", json={"label": "첫 이름"}).json()
    same = c.post(f"/api/manuscripts/{mid}/versions", json={"label": "첫 이름"}).json()
    assert a["created"] and not same["created"] and same["id"] == a["id"]
    plain = c.post(f"/api/manuscripts/{mid}/versions", json={}).json()   # 이름 없이 다시 저장 → 그대로
    assert not plain["created"] and plain["id"] == a["id"] and plain["label"] == "첫 이름"
    b = c.post(f"/api/manuscripts/{mid}/versions", json={"label": "둘째 이름"}).json()
    assert b["created"] and b["id"] != a["id"] and b["label"] == "둘째 이름"
    assert c.get(f"/api/manuscripts/{mid}/versions/{a['id']}").json()["label"] == "첫 이름"


@pytest.mark.db
def test_restore_keeps_unsaved_editor_text(cloud, project):
    # 자동 저장이 실패해 서버에 없는 화면 글(current)도 ‘되돌리기 전’ 버전에 남는다 — 저장된 글도 함께
    c = cloud.client(cloud.user())
    mid = c.post("/api/manuscripts", json={"content": "# r\n\n처음"}).json()["id"]
    v = c.post(f"/api/manuscripts/{mid}/versions", json={}).json()
    c.patch(f"/api/manuscripts/{mid}", json={"content": "# r\n\n저장된 글"})
    r = c.post(f"/api/manuscripts/{mid}/versions/{v['id']}/restore", json={"current": "# r\n\n저장 못 한 글"}).json()
    assert r["changed"] and r["content"] == "# r\n\n처음"
    assert c.get(f"/api/manuscripts/{mid}/versions/{r['backup']['id']}").json()["content"] == "# r\n\n저장 못 한 글"
    texts = [c.get(f"/api/manuscripts/{mid}/versions/{x['id']}").json()["content"]
             for x in listing(c, mid) if x["reason"] == "restore"]
    assert texts == ["# r\n\n저장 못 한 글", "# r\n\n저장된 글"]
    # 화면 글이 그 버전과 같아도 서버에 저장된 글이 다르면: 저장된 글을 남기고 원고를 바꿈
    c.patch(f"/api/manuscripts/{mid}", json={"content": "# r\n\n다른 기기 글"})
    r = c.post(f"/api/manuscripts/{mid}/versions/{v['id']}/restore", json={"current": "# r\n\n처음"}).json()
    assert r["changed"] is False and r["content"] == "# r\n\n처음"
    assert c.get(f"/api/manuscripts/{mid}/versions/{r['backup']['id']}").json()["content"] == "# r\n\n다른 기기 글"
    assert c.post(f"/api/manuscripts/{mid}/versions/{v['id']}/restore", json={"current": 3}).status_code == 400


@pytest.mark.db
def test_retention_thins_automatic_rows_only(cloud, project, monkeypatch):
    u = cloud.user()
    c = cloud.client(u)
    mid = c.post("/api/manuscripts", json={"content": "# r\n\n0"}).json()["id"]

    def put(reason, label, minutes_ago, text):
        admin_sql(project, "insert into paperlab.manuscript_versions (user_id, manuscript_id, reason, label, content, size, "
                           "chars, sha256, created_at) values (%s, %s, %s, %s, %s, octet_length(%s), char_length(%s), %s, "
                           "now() - make_interval(secs => %s))",
                  (u.id, mid, reason, label, text, text, text, V.digest(text), minutes_ago * 60))

    for i in range(V.KEEP_RECENT + 5):               # 자동 35개: 1~35분 전 → 최근 30개 + 같은 날 나머지(지움)
        put("auto", "", i + 1, f"a{i}")
    for d in (40, 41):                               # 30일 넘은 자동(지움)
        put("ai_apply", "", d * 24 * 60, f"old{d}")
    put("auto", "이름", 60 * 24 * 60, "named")       # 이름 붙인 자동(남김)
    put("manual", "", 90 * 24 * 60, "manual")        # 직접 저장(남김)
    # 자동 기록 하나를 더 만들면 정리가 돈다
    assert c.post(f"/api/manuscripts/{mid}/versions", json={"reason": "ai_apply", "content": "new"}).json()["created"]
    items = listing(c, mid)
    auto = [v for v in items if not v["pinned"]]
    # 최근 30개(새 기록 + 1~29분 전). 한국 자정 직후에 돌면 어제 날짜의 가장 최근 하나가 더 남을 수 있음
    assert V.KEEP_RECENT <= len(auto) <= V.KEEP_RECENT + 1
    assert admin_sql(project, "select count(*) from paperlab.manuscript_versions where manuscript_id = %s "
                              "and content like 'old%%'", (mid,)) == [(0,)]
    assert {v["label"] or v["reason"] for v in items if v["pinned"]} == {"이름", "manual"}
    # 바이트 상한: 작게 하면 오래된 자동 기록부터 지움(가장 최근 하나는 남김)
    monkeypatch.setattr(V, "AUTO_MAX_BYTES", 5)
    c.post(f"/api/manuscripts/{mid}/versions", json={"reason": "ai_apply", "content": "newer"})
    auto = [v for v in listing(c, mid) if not v["pinned"]]
    assert len(auto) == 1 and auto[0]["size"] == 5


@pytest.mark.db
def test_db_full_skips_auto_and_refuses_manual_but_restore_works(project, session_db, users):
    full = Cloud(project, session_db, users, db_limit_bytes=1)
    try:
        c = full.client(full.user())
        mid = c.post("/api/manuscripts", json={"content": "# f\n\n하나"}).json()["id"]
        assert c.patch(f"/api/manuscripts/{mid}", json={"content": "# f\n\n둘"}).json()["ok"]  # 저장은 그대로
        assert listing(c, mid) == []
        r = c.post(f"/api/manuscripts/{mid}/versions", json={"label": "x"})
        assert r.status_code == 400 and "저장 공간" in r.json()["detail"]
        # 되돌리기 전 기록은 공간과 상관없이 (기록이 하나 있어야 되돌릴 수 있으므로 관리자 연결로 하나 넣음)
        one = "# f\n\n하나"
        vid = admin_sql(project, "insert into paperlab.manuscript_versions (user_id, manuscript_id, reason, content, size, "
                                 "chars, sha256) select user_id, id, 'manual', %s, octet_length(%s), char_length(%s), %s "
                                 "from paperlab.manuscripts where id = %s returning id",
                        (one, one, one, V.digest(one), mid))[0][0]
        r = c.post(f"/api/manuscripts/{mid}/versions/{vid}/restore").json()
        assert r["changed"] and r["backup"]["reason"] == "restore"
    finally:
        full.app.state.runner.stop()


@pytest.mark.db
def test_rls_other_user_sees_nothing_and_cannot_attach(cloud, project):
    a, b = cloud.user(), cloud.user()
    ca, cb = cloud.client(a), cloud.client(b)
    mid = ca.post("/api/manuscripts", json={"content": "# 비밀\n\n원고"}).json()["id"]
    vid = ca.post(f"/api/manuscripts/{mid}/versions", json={"label": "A"}).json()["id"]
    mid_b = cb.post("/api/manuscripts", json={"content": "# b"}).json()["id"]
    for r in (cb.get(f"/api/manuscripts/{mid}/versions"), cb.get(f"/api/manuscripts/{mid}/versions/{vid}"),
              cb.get(f"/api/manuscripts/{mid_b}/versions/{vid}"), cb.post(f"/api/manuscripts/{mid}/versions", json={}),
              cb.post(f"/api/manuscripts/{mid_b}/versions/{vid}/restore"),
              cb.patch(f"/api/manuscripts/{mid_b}/versions/{vid}", json={"label": "x"}),
              cb.delete(f"/api/manuscripts/{mid_b}/versions/{vid}")):
        assert r.status_code == 404, r.text
    assert c_count(project, mid) == 1
    with cloud.app.state.db.user_tx({"sub": b.id, "role": "authenticated"}) as lib:
        assert lib._all("select id from paperlab.manuscript_versions") == []
        assert lib._x("update paperlab.manuscript_versions set label = 'hack' where id = %s", (vid,)).rowcount == 0
        assert lib._x("delete from paperlab.manuscript_versions where id = %s", (vid,)).rowcount == 0
    # B가 A의 원고를 가리키는 기록을 만들 수 없음(복합 외래 키 · RLS with check)
    for owner in (b.id, a.id):
        with pytest.raises(psycopg.Error):
            with cloud.app.state.db.user_tx({"sub": b.id, "role": "authenticated"}) as lib:
                lib._x("insert into paperlab.manuscript_versions (user_id, manuscript_id, reason, content, size, chars, sha256) "
                       "values (%s, %s, 'manual', 'x', 1, 1, %s)", (owner, mid, V.digest("x")))
    assert admin_sql(project, "select label from paperlab.manuscript_versions where id = %s", (vid,)) == [("A",)]


def c_count(project, mid: int) -> int:
    return admin_sql(project, "select count(*) from paperlab.manuscript_versions where manuscript_id = %s", (mid,))[0][0]


@pytest.mark.db
def test_catalog_rls_and_checks(project):
    rows = admin_sql(project, "select relrowsecurity, relforcerowsecurity from pg_class where oid = "
                              "'paperlab.manuscript_versions'::regclass")
    assert rows == [(True, True)]
    pols = admin_sql(project, "select polname, polroles::regrole[]::text[] from pg_policy where polrelid = "
                              "'paperlab.manuscript_versions'::regclass")
    assert pols == [("own_rows", ["authenticated"])]
    privs = admin_sql(project, "select has_table_privilege('anon', 'paperlab.manuscript_versions', 'select'), "
                               "has_table_privilege('service_role', 'paperlab.manuscript_versions', 'select')")
    assert privs == [(False, True)]
    # size · chars는 본문과 맞아야 함 · 이상한 reason · 줄바꿈 이름 거절
    uid = str(uuid.uuid4())
    for q in ("insert into paperlab.manuscript_versions (user_id, manuscript_id, reason, content, size, chars, sha256) "
              "values (%s, 1, 'manual', 'abc', 99, 3, repeat('0', 64))",
              "insert into paperlab.manuscript_versions (user_id, manuscript_id, reason, content, size, chars, sha256) "
              "values (%s, 1, 'other', 'abc', 3, 3, repeat('0', 64))",
              "insert into paperlab.manuscript_versions (user_id, manuscript_id, reason, label, content, size, chars, sha256) "
              "values (%s, 1, 'manual', E'a\\nb', 'abc', 3, 3, repeat('0', 64))"):
        with pytest.raises(psycopg.errors.CheckViolation):
            admin_sql(project, q, (uid,))
