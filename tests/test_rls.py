"""사용자 분리 · RLS · 새 기능 (테스트 프로젝트). AC-05 · 06 · 11 · 12 · 12a · 14~22 · 31 · 39 · 41 · 44a · 44b · 45 · 47 ·
48 · 50~52 · 56 · 57 · 72(2·3), 인용 그래프 공용 캐시 AC-G20 · 21 · 23 · 43(자동 부분)."""

import base64
import json
import os
import re
import uuid

import jwt
import psycopg
import pytest

from paperlab.admin import AdminError, find_orphans, refuse_test_project, rotate_keys, sync_allowlist
from paperlab.ai import AIService
from paperlab.crypto import SecretBox, key_id
from paperlab.db import Database
from paperlab.migrate import MigrationError, apply_migrations

from .conftest import SAMPLE, Cloud, make_pdf

pytestmark = pytest.mark.db

PERSONAL = ["profiles", "user_secrets", "folders", "papers", "collections", "paper_collections", "tags", "paper_tags",
            "annotations", "notes", "page_texts", "paper_search", "ai_summaries", "chat_sessions", "chat_messages",
            "manuscripts", "doc_formats", "user_styles"]
SHARED = ("external_works", "citation_edges")  # 인용 그래프 공용 캐시 (citation-graph 명세 8.4 · AC-G20)


def admin(project):
    return psycopg.connect(project.admin_db, autocommit=True, prepare_threshold=None)


@pytest.fixture
def ab(cloud):
    """A · B 각자 데이터 한 벌씩 (명세 16장 공통 준비)"""
    out = {}
    for name in ("A", "B"):
        u = cloud.user()
        c = cloud.client(u)
        c.get("/api/me")
        tok = "uniq" + uuid.uuid4().hex[:8]
        res = cloud.upload(c, make_pdf(title=f"{name} Unique Paper Title {tok}", doi=""), f"{name}.pdf")
        pid = res["id"]
        c.put(f"/api/papers/{pid}/note", json={"content": f"note-only-{name.lower()}zz"})
        aid = c.post(f"/api/papers/{pid}/annotations", json={"page": 1, "text": f"hl-{name}"}).json()["id"]
        cid = c.post("/api/collections", json={"name": f"col-{name}"}).json()["id"]
        fid = c.post("/api/folders", json={"name": f"folder-{name}"}).json()["id"]
        c.patch(f"/api/papers/{pid}", json={"tags": [f"tag-{name}"]})
        tid = c.get("/api/tags").json()[0]["id"]
        mid = c.post("/api/manuscripts", json={"title": f"ms-{name}"}).json()["id"]
        fmt = c.post("/api/doc-formats", json={"name": f"fmt-{name}", "base": "default"}).json()["id"]
        style = (b'<?xml version="1.0" encoding="utf-8"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0">'
                 b'<info><title>S</title><id>http://www.zotero.org/styles/style-' + name.lower().encode() +
                 b'</id></info></style>')
        sid = c.post("/api/styles", files={"file": ("s.csl", style, "application/xml")}).json()["id"]
        with c.stream("POST", f"/api/papers/{pid}/chat", json={"question": "q"}) as r:
            list(r.iter_lines())
        out[name] = dict(user=u, c=c, tok=tok, pid=pid, aid=aid, cid=cid, fid=fid, tid=tid, mid=mid, fmt=fmt, sid=sid)
    return out


def test_other_users_objects_are_404(ab):
    """AC-11"""
    A, B = ab["A"], ab["B"]
    b = B["c"]
    pid = A["pid"]
    checks = [b.get(f"/api/papers/{pid}"), b.patch(f"/api/papers/{pid}", json={"title": "x"}),
              b.get(f"/api/papers/{pid}/annotations"), b.put(f"/api/papers/{pid}/note", json={"content": "x"}),
              b.get(f"/api/papers/{pid}/summary"), b.get(f"/api/papers/{pid}/chat"), b.get(f"/api/papers/{pid}/pdf-url"),
              b.get(f"/api/manuscripts/{A['mid']}"), b.get(f"/api/doc-formats/{A['fmt']}"),
              b.patch(f"/api/annotations/{A['aid']}", json={"comment": "x"}), b.delete(f"/api/collections/{A['cid']}"),
              b.patch(f"/api/tags/{A['tid']}", json={"name": "x"}), b.get(f"/api/styles/{A['sid']}"),
              b.delete(f"/api/papers/{pid}"), b.delete(f"/api/folders/{A['fid']}")]
    assert [r.status_code for r in checks] == [404] * len(checks)
    a = A["c"].get(f"/api/papers/{pid}").json()
    assert a["note"].startswith("note-only-a") and a["title"].startswith("A Unique")
    assert len(A["c"].get(f"/api/papers/{pid}/annotations").json()) == 1


def test_lists_show_only_own(ab):
    """AC-14 · AC-15"""
    A, B = ab["A"], ab["B"]
    b = B["c"]
    assert [p["id"] for p in b.get("/api/papers").json()["items"]] == [B["pid"]]
    assert b.get("/api/stats").json()["total"] == 1
    assert [x["id"] for x in b.get("/api/collections").json()] == [B["cid"]]
    assert [x["id"] for x in b.get("/api/tags").json()] == [B["tid"]]
    assert [x["id"] for x in b.get("/api/folders").json()] == [B["fid"]]
    assert [x["id"] for x in b.get("/api/manuscripts").json()] == [B["mid"]]
    assert [x["id"] for x in b.get("/api/doc-formats").json() if not x["builtin"]] == [B["fmt"]]
    assert [x["id"] for x in b.get("/api/styles").json() if not x["builtin"]] == [B["sid"]]
    for q in (A["tok"], "note-only-azz", "hl-A", "shortcut"):
        if q == "shortcut":  # 둘 다 가진 본문 낱말: 자기 것만
            assert [p["id"] for p in b.get("/api/papers", params={"q": q}).json()["items"]] == [B["pid"]]
        else:
            assert b.get("/api/papers", params={"q": q}).json()["total"] == 0, q


def test_duplicates_and_citekeys_per_user(cloud):
    """AC-16"""
    a, b = cloud.client(cloud.user()), cloud.client(cloud.user())
    a.post("/api/papers", json=SAMPLE)
    r = b.post("/api/papers", json=SAMPLE)
    assert r.status_code == 200 and r.json()["paper"]["citekey"] == "vaswani2017attention"
    assert b.post("/api/citekeys", json={"keys": ["vaswani2017attention"]}).json()["items"]["vaswani2017attention"]
    c = cloud.client(cloud.user())
    assert c.post("/api/citekeys", json={"keys": ["vaswani2017attention"]}).json()["items"] == {"vaswani2017attention": None}


def test_cross_links_rejected(ab, cloud):
    """AC-17 · 18 · 19"""
    A, B = ab["A"], ab["B"]
    b = B["c"]
    r = b.post("/api/papers/bulk", json={"ids": [B["pid"]], "action": "add_collection", "value": A["cid"]})
    assert r.status_code in (400, 404)
    assert b.patch(f"/api/papers/{B['pid']}", json={"folder_id": A["fid"]}).status_code == 400
    with admin(cloud.project) as conn:
        assert conn.execute("select count(*) from paperlab.paper_collections where collection_id = %s",
                            (A["cid"],)).fetchone()[0] == 0
    # 남의 upload_id 완료 금지 (B의 incoming/ 경로에 없음)
    slot = A["c"].post("/api/uploads", json={"files": [{"name": "x.pdf", "size": 10}]}).json()["files"][0]
    cloud.storage.browser_put(slot["upload"]["url"], make_pdf())
    assert b.post(f"/api/uploads/{slot['upload_id']}/complete", json={}).status_code == 404
    # compose 토큰
    import io

    import docx
    d = docx.Document()
    d.add_paragraph("본문 [@vaswani2017attention]")
    buf = io.BytesIO()
    d.save(buf)
    tok = A["c"].post("/api/compose/scan", files={"file": ("a.docx", buf.getvalue(), "application/octet-stream")}).json()["token"]
    assert b.post("/api/compose/apply", json={"token": tok, "rendered": [], "bibliography": []}).status_code == 404
    assert A["c"].post("/api/compose/apply", json={"token": tok, "rendered": [], "bibliography": []}).status_code in (200, 400)


def _claims(uid):
    return json.dumps({"sub": uid, "role": "authenticated"})


def test_rls_direct_and_no_leak(ab, cloud):
    """AC-12: 트랜잭션 안에서 B 권한으로 모든 개인 표 → B 행만, A로 insert → 오류, 끝난 뒤 설정이 남지 않음"""
    A, B = ab["A"], ab["B"]
    with admin(cloud.project) as conn:
        with conn.transaction():
            conn.execute("set local role authenticated")
            conn.execute("select set_config('request.jwt.claims', %s, true)", (_claims(B["user"].id),))
            for t in PERSONAL:
                others = conn.execute(f"select count(*) from paperlab.{t} where user_id <> %s",
                                      (B["user"].id,)).fetchone()[0]
                assert others == 0, t
            assert conn.execute("select count(*) from paperlab.papers").fetchone()[0] == 1
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                with conn.transaction():
                    conn.execute("insert into paperlab.papers (user_id, title) values (%s, 'x')", (A["user"].id,))
        assert conn.execute("select coalesce(current_setting('request.jwt.claims', true), '')").fetchone()[0] == ""
        assert conn.execute("select current_user").fetchone()[0] != "authenticated"


def test_app_role_cannot_read_without_set_role(cloud):
    """AC-12a"""
    with psycopg.connect(cloud.project.app_db, autocommit=True, prepare_threshold=None) as conn:
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select * from paperlab.papers").fetchall()
    with admin(cloud.project) as conn:
        row = conn.execute("select rolbypassrls, rolinherit from pg_roles where rolname = 'paperlab_app'").fetchone()
    assert row == (False, False)


def test_catalog_rls_everywhere(project):
    """AC-20 → 인용 그래프 AC-G20 개정: 공용 캐시 표 2개는 user_id 요구에서 빼고 따로 검사"""
    with admin(project) as conn:
        rows = conn.execute(
            "select c.relname, c.relrowsecurity, c.relforcerowsecurity, "
            "(select count(*) from pg_policy p where p.polrelid = c.oid and "
            "  'authenticated'::regrole = any(p.polroles)) as auth_policies, "
            "exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped) "
            "from pg_class c join pg_namespace n on n.oid = c.relnamespace "
            "where n.nspname = 'paperlab' and c.relkind = 'r'").fetchall()
        anon_usage = conn.execute("select has_schema_privilege('anon', 'paperlab', 'usage')").fetchone()[0]
        shared = {}
        for t in SHARED:
            pols = conn.execute("select polcmd, pg_get_expr(polqual, polrelid), polroles::regrole[]::text[], "
                                "pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid = %s::regclass",
                                (f"paperlab.{t}",)).fetchall()
            privs = conn.execute("select has_table_privilege('authenticated', %(t)s, 'select'), "
                                 "has_table_privilege('authenticated', %(t)s, 'insert'), "
                                 "has_table_privilege('authenticated', %(t)s, 'update'), "
                                 "has_table_privilege('authenticated', %(t)s, 'delete'), "
                                 "has_table_privilege('authenticated', %(t)s, 'truncate'), "
                                 "has_table_privilege('anon', %(t)s, 'select'), "
                                 "has_table_privilege('service_role', %(t)s, 'insert')", {"t": f"paperlab.{t}"}).fetchone()
            cols = conn.execute("select a.attname, format_type(a.atttypid, a.atttypmod) from pg_attribute a "
                                "where a.attrelid = %s::regclass and a.attnum > 0 and not a.attisdropped",
                                (f"paperlab.{t}",)).fetchall()
            shared[t] = (pols, privs, cols)
    assert {r[0] for r in rows} >= set(PERSONAL) | {"allowed_emails", "schema_migrations"} | set(SHARED)
    for name, rls, force, policies, has_uid in rows:
        assert rls and force, name
        if name not in ("allowed_emails", "schema_migrations") + SHARED:
            assert policies >= 1 and has_uid, name
    assert anon_usage is False
    # 공용 캐시: ① 정책은 authenticated select using(true) 하나 ② authenticated 표 권한은 SELECT뿐
    # ③ 사용자 · 요청을 담는 열 이름 없음(user · ip · session · email, …_by — cited_by_count는 공개 서지라 예외)
    # ④ 시각 열은 모두 date
    for t, (pols, privs, cols) in shared.items():
        assert pols == [("r", "true", ["authenticated"], None)], (t, pols)
        assert privs == (True, False, False, False, False, False, True), (t, privs)
        for name, typ in cols:
            assert not re.search(r"(^|_)(user|users|ip|session|email)(_|$)|_by$", name), (t, name)
            assert "time" not in typ, (t, name, typ)
        assert {typ for name, typ in cols if name.endswith("_on")} == {"date"}


def test_shared_cache_rls_direct(project):
    """AC-G21: authenticated(B claims)는 두 표 select만, insert · update · delete는 권한 오류. service_role은 쓰기 됨"""
    no = 9_990_000_000 + uuid.uuid4().int % 9_000_000
    try:
        # 서버와 같은 앱 역할 연결로: system_tx = SET LOCAL ROLE service_role, 사용자 = authenticated
        with psycopg.connect(project.app_db, autocommit=True, prepare_threshold=None) as conn:
            with conn.transaction():
                conn.execute("set local role service_role")
                conn.execute("insert into paperlab.external_works (openalex_no, title, meta_on) values (%s, 'x', current_date)",
                             (no,))
                conn.execute("insert into paperlab.citation_edges (work_no, relation, nos, total, fetched_on) "
                             "values (%s, 'references', '{1,2}', 2, current_date)", (no,))
            with conn.transaction():
                conn.execute("set local role authenticated")
                conn.execute("select set_config('request.jwt.claims', %s, true)", (_claims(str(uuid.uuid4())),))
                assert conn.execute("select count(*) from paperlab.external_works where openalex_no = %s",
                                    (no,)).fetchone()[0] == 1
                assert conn.execute("select nos from paperlab.citation_edges where work_no = %s", (no,)).fetchone()[0] == [1, 2]
                for sql in ("insert into paperlab.external_works (openalex_no, title, meta_on) values (%s + 1, 'y', current_date)",
                            "update paperlab.external_works set title = 'z' where openalex_no = %s",
                            "delete from paperlab.external_works where openalex_no = %s",
                            "insert into paperlab.citation_edges (work_no, relation, nos, total, fetched_on) "
                            "values (%s, 'related', '{}', 0, current_date)",
                            "update paperlab.citation_edges set total = 9 where work_no = %s",
                            "delete from paperlab.citation_edges where work_no = %s"):
                    with pytest.raises(psycopg.errors.InsufficientPrivilege):
                        with conn.transaction():
                            conn.execute(sql, (no,))
    finally:
        with admin(project) as conn:
            conn.execute("delete from paperlab.citation_edges where work_no = %s", (no,))
            conn.execute("delete from paperlab.external_works where openalex_no = %s", (no,))


def test_shared_cache_constraints(project):
    """AC-G23(검사 제약): doi가 10.으로 시작하지 않음 · relation 목록 밖 · references 501개 · url이 http(s) 아님 → 거부.
    1C: relation 'cited_by_top_c'(C 단계만 끝난 피인용 목록)는 100개까지 됨"""
    no = 9_990_000_000 + uuid.uuid4().int % 9_000_000
    bad = [
        ("insert into paperlab.external_works (openalex_no, title, doi, meta_on) values (%s, 't', 'x10.1/a', current_date)", (no,)),
        ("insert into paperlab.external_works (openalex_no, title, url, meta_on) values (%s, 't', 'javascript:x', current_date)", (no,)),
        ("insert into paperlab.external_works (openalex_no, title, meta_on) values (0, 't', current_date)", None),
        ("insert into paperlab.citation_edges (work_no, relation, nos, total, fetched_on) "
         "values (%s, 'cites', '{}', 0, current_date)", (no,)),
        ("insert into paperlab.citation_edges (work_no, relation, nos, total, fetched_on) "
         "values (%s, 'references', array(select generate_series(1, 501))::bigint[], 501, current_date)", (no,)),
        ("insert into paperlab.citation_edges (work_no, relation, nos, total, fetched_on) "
         "values (%s, 'related', array(select generate_series(1, 21))::bigint[], 21, current_date)", (no,)),
        ("insert into paperlab.citation_edges (work_no, relation, nos, total, source, fetched_on) "
         "values (%s, 'references', '{}', 0, 'kci', current_date)", (no,)),
        ("insert into paperlab.citation_edges (work_no, relation, nos, total, fetched_on) "
         "values (%s, 'cited_by_top_c', array(select generate_series(1, 101))::bigint[], 101, current_date)", (no,)),
    ]
    with admin(project) as conn:
        for sql, params in bad:
            with pytest.raises(psycopg.errors.CheckViolation):
                with conn.transaction():
                    conn.execute(sql, params)
        with conn.transaction():  # 경계값은 됨 (되돌림)
            conn.execute("insert into paperlab.citation_edges (work_no, relation, nos, total, fetched_on) "
                         "values (%s, 'references', array(select generate_series(1, 500))::bigint[], 812, current_date)", (no,))
            # 1C 추천의 C만 끝난 피인용 목록(마이그레이션 20261008000003) — 100개까지
            conn.execute("insert into paperlab.citation_edges (work_no, relation, nos, total, fetched_on) "
                         "values (%s, 'cited_by_top_c', array(select generate_series(1, 100))::bigint[], 340, current_date)", (no,))
            conn.execute("insert into paperlab.external_works (openalex_no, title, doi, meta_on) "
                         "values (%s, 't', '10.1234/x', current_date)", (no,))
            raise psycopg.Rollback()


def test_shared_cache_admin_commands(project):
    """AC-G43(자동 부분): cache-stats는 숫자 · 날짜만, cache-prune은 서지를 받은 날이 오래된 것부터 지움"""
    from paperlab.admin import cache_prune, cache_stats
    base = 9_995_000_000 + (uuid.uuid4().int % 4_000) * 1_000
    nos = [base + i for i in range(3)]
    try:
        with admin(project) as conn:
            for i, no in enumerate(nos):
                conn.execute("insert into paperlab.external_works (openalex_no, title, meta_on) values (%s, %s, %s)",
                             (no, f"prune test {i}", f"1999-01-0{i + 1}"))
                conn.execute("insert into paperlab.citation_edges (work_no, relation, nos, total, fetched_on) "
                             "values (%s, 'references', '{1,2,3}', 3, '1999-01-01')", (no,))
            oldest = conn.execute("select openalex_no from paperlab.external_works order by meta_on, openalex_no "
                                  "limit 1").fetchone()[0]
        s = cache_stats(project.admin_db)
        assert set(s) == {"works", "edges", "works_bytes", "edges_bytes", "disk_bytes", "live_bytes", "oldest_meta_on",
                          "oldest_fetched_on"}
        assert s["works"] >= 3 and s["live_bytes"] > 0 and s["oldest_meta_on"] <= "1999-01-01"
        assert all(isinstance(v, (int, str)) for v in s.values())
        r = cache_prune(project.admin_db, (s["live_bytes"] - 1) / (1024 * 1024))
        assert r["deleted_works"] == 1 and r["deleted_edges"] == 1 and r["live_after"] < r["live_before"]
        with admin(project) as conn:
            assert conn.execute("select count(*) from paperlab.external_works where openalex_no = %s",
                                (oldest,)).fetchone()[0] == 0
        assert cache_prune(project.admin_db, 10_000)["deleted_works"] == 0
    finally:
        with admin(project) as conn:
            conn.execute("delete from paperlab.citation_edges where work_no = any(%s)", (nos,))
            conn.execute("delete from paperlab.external_works where openalex_no = any(%s)", (nos,))


def test_account_delete_cascades(ab, cloud):
    """AC-22"""
    A, B = ab["A"], ab["B"]
    cloud.project.delete_user(A["user"])
    with admin(cloud.project) as conn:
        for t in PERSONAL:
            assert conn.execute(f"select count(*) from paperlab.{t} where user_id = %s", (A["user"].id,)).fetchone()[0] == 0, t
        assert conn.execute("select count(*) from paperlab.papers where user_id = %s", (B["user"].id,)).fetchone()[0] == 1


def test_storage_keys_ignore_injected_paths(ab, cloud):
    """AC-39: 본문 · 쿼리의 다른 경로는 키에 반영되지 않고, DB pdf_key를 남의 경로로 바꾸면 404"""
    A, B = ab["A"], ab["B"]
    a = A["c"]
    r = a.post("/api/uploads", json={"files": [{"name": "../x.pdf", "size": 5, "key": f"users/{B['user'].id}/papers/1.pdf",
                                                "user_id": B["user"].id}]}).json()["files"][0]
    assert f"incoming/{A['user'].id}/" in r["upload"]["url"]
    assert a.post(f"/api/uploads/..%2F{B['user'].id}/complete", json={}).status_code == 404
    with admin(cloud.project) as conn:
        conn.execute("update paperlab.papers set pdf_key = %s where id = %s", (f"users/{B['user'].id}/papers/{B['pid']}.pdf",
                                                                               A["pid"]))
    before = len(cloud.storage.log)
    assert a.get(f"/api/papers/{A['pid']}/pdf-url").status_code == 404
    with a.stream("POST", f"/api/papers/{A['pid']}/chat", json={"question": "q"}) as r:
        assert r.status_code == 404
    assert a.delete(f"/api/papers/{A['pid']}").status_code == 404
    assert all(not k.startswith(f"users/{B['user'].id}/") for _, k in cloud.storage.log[before:])


def test_delete_removes_pdf_even_if_storage_fails(cloud):
    """AC-41"""
    u = cloud.user()
    c = cloud.client(u)
    p1 = cloud.upload(c, make_pdf(title="One Paper Title For Delete", doi=""))["id"]
    p2 = cloud.upload(c, make_pdf(title="Two Paper Title For Delete", doi=""))["id"]
    assert c.delete(f"/api/papers/{p1}").status_code == 200
    assert f"users/{u.id}/papers/{p1}.pdf" not in cloud.storage.objects
    cloud.storage.fail_delete = True
    assert c.post("/api/papers/bulk", json={"ids": [p2], "action": "delete"}).status_code == 200
    assert c.get(f"/api/papers/{p2}").status_code == 404


def test_storage_usage_levels(cloud):
    """AC-44a"""
    u, v = cloud.user(), cloud.user()
    a, b = cloud.client(u), cloud.client(v)
    # 올린 그 PDF로 크기를 잰다 (make_pdf는 만든 시각에 따라 1~6바이트 달라질 수 있음 — 전체 실행에서 가끔 실패하던 원인)
    pdfs = [make_pdf(title="Usage Paper One Title", doi=""), make_pdf(title="Usage Paper Two Title", doi="")]
    sizes = [len(x) for x in pdfs]
    for data in pdfs:
        cloud.upload(a, data)
    cloud.storage.objects["backups/db/20261001.dump"] = b"x" * 1000  # 백업 Job이 올린 것처럼 (요청 기록 밖)
    cloud.app.state.backup_sizes.ttl = -1  # 5분 캐시 무시 (업로드 때 계산해 둔 값)
    us = a.get("/api/storage/usage").json()
    assert us["backend"] == "r2" and us["limit_bytes"] == 10 * 1024 ** 3 and us["level"] == "ok"
    assert us["mine_bytes"] == sum(sizes) and us["used_bytes"] >= sum(sizes) + 1000
    assert b.get("/api/storage/usage").json()["mine_bytes"] == 0
    used = us["used_bytes"]
    cloud.app.state.config.storage_limit_bytes = int(used / 0.85)
    assert a.get("/api/storage/usage").json()["level"] == "warn"
    cloud.app.state.config.storage_limit_bytes = int(used / 0.96)
    assert a.get("/api/storage/usage").json()["level"] == "full"
    r = a.post("/api/uploads", json={"files": [{"name": "x.pdf", "size": 10}]})
    assert r.status_code == 400 and "저장 공간이 거의 찼어요" in r.json()["detail"]


def test_orphans(cloud):
    """AC-44b"""
    u = cloud.user()
    c = cloud.client(u)
    pid = cloud.upload(c, make_pdf(title="Orphan Scan Real Paper", doi=""))["id"]
    orphan = f"users/{u.id}/papers/999999999.pdf"
    cloud.storage.objects[orphan] = b"%PDF orphan"  # 관리 명령 · 테스트 준비는 사용자 요청 기록(AC-39) 밖
    cloud.storage.objects["backups/db/20261001.dump"] = b"x"
    n = len(cloud.storage.log)
    res = find_orphans(cloud.project.admin_db, cloud.storage)
    assert orphan in res["orphans"] and f"users/{u.id}/papers/{pid}.pdf" not in res["orphans"]
    find_orphans(cloud.project.admin_db, cloud.storage, delete=True)
    del cloud.storage.log[n:]
    assert orphan not in cloud.storage.objects and f"users/{u.id}/papers/{pid}.pdf" in cloud.storage.objects
    assert "backups/db/20261001.dump" in cloud.storage.objects


def test_settings_secrets_and_isolation(ab, cloud):
    """AC-31 · AC-45 · AC-47"""
    A, B = ab["A"], ab["B"]
    a, b = A["c"], B["c"]
    key = "sk-ant-test-" + uuid.uuid4().hex
    s = a.put("/api/settings", json={"anthropic_api_key": key, "model": "claude-sonnet-5-5"}).json()
    assert s["anthropic_api_key_set"] is True and s["anthropic_api_key_status"] == "set" and key not in json.dumps(s)
    assert a.put("/api/settings", json={"anthropic_api_key": ""}).json()["anthropic_api_key_set"] is True
    assert b.get("/api/settings").json()["anthropic_api_key_set"] is False
    assert b.get("/api/settings").json()["model"] == "claude-opus-5-5"
    assert a.put("/api/settings", json={"ai_engine": "cli"}).status_code == 400
    with admin(cloud.project) as conn:
        ct = conn.execute("select ciphertext from paperlab.user_secrets where user_id = %s", (A["user"].id,)).fetchone()[0]
        assert key.encode() not in bytes(ct)
        # A의 암호문을 B 행으로 복사 → B는 복호화 실패(500 아님)
        conn.execute("insert into paperlab.user_secrets (user_id, name, ciphertext, nonce, key_id, hint) "
                     "select %s, name, ciphertext, nonce, key_id, hint from paperlab.user_secrets where user_id = %s",
                     (B["user"].id, A["user"].id))
    r = b.get("/api/settings")
    assert r.status_code == 200 and r.json()["anthropic_api_key_set"] is False
    assert r.json()["anthropic_api_key_status"] == "unreadable"
    # 회전: 모든 행의 key_id가 새 키 지문, 복호화 결과 같음
    old = cloud.app.state.box.current
    new = os.urandom(32)
    n = rotate_keys(cloud.project.admin_db, new, [old])
    assert n >= 1
    cloud.app.state.box = SecretBox(new)
    with admin(cloud.project) as conn:
        kids = {r[0] for r in conn.execute("select key_id from paperlab.user_secrets where user_id = %s",
                                           (A["user"].id,))}
    assert kids == {key_id(new)}
    assert a.get("/api/settings").json()["anthropic_api_key_set"] is True
    assert a.put("/api/settings", json={"anthropic_api_key": None}).json()["anthropic_api_key_set"] is False


def test_env_key_not_used_for_user_without_key(project, session_db, users, monkeypatch):
    """AC-48"""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-server-env")
    cloud = Cloud(project, session_db, users, ai_factory=lambda get: AIService(get))
    c = cloud.client(cloud.user())
    assert c.get("/api/ai/status").json()["ready"] is False
    pid = c.post("/api/papers", json=SAMPLE).json()["paper"]["id"]
    assert c.post(f"/api/papers/{pid}/summary").status_code == 400


def test_folders(cloud):
    """AC-50 · 51 · 52"""
    u = cloud.user()
    c = cloud.client(u)
    root = c.post("/api/folders", json={"name": "졸업논문"}).json()["id"]
    child = c.post("/api/folders", json={"name": "2장", "parent_id": root}).json()["id"]
    assert c.post("/api/folders", json={"name": "2장", "parent_id": root}).status_code == 400
    c.post("/api/folders", json={"name": "Data", "parent_id": root})
    assert c.post("/api/folders", json={"name": "data", "parent_id": root}).status_code == 400
    for bad in ("a/b", "x:y", "", "q?", "x" * 101, "줄\n바꿈", "탭\t중간", "CON", "lpt1.txt", "끝.", "a\u0085b", "c1\u009f"):
        assert c.post("/api/folders", json={"name": bad}).status_code == 400, bad
    assert c.patch(f"/api/folders/{root}", json={"parent_id": child}).status_code == 400
    assert c.patch(f"/api/folders/{child}", json={"name": "a\u0085b"}).status_code == 400  # N2: 이름 바꾸기도
    assert c.patch(f"/api/folders/{child}", json={"name": "2장 선행연구"}).json() == {"ok": True}

    p1 = cloud.upload(c, make_pdf(title="Folder Paper One Title", doi=""))["id"]
    p2 = c.post("/api/papers", json={"title": "Folder Paper Two Title"}).json()["paper"]["id"]
    cid = c.post("/api/collections", json={"name": "c"}).json()["id"]
    c.post("/api/papers/bulk", json={"ids": [p1], "action": "add_collection", "value": cid})
    c.patch(f"/api/papers/{p1}", json={"folder_id": root})
    assert [p["id"] for p in c.get("/api/papers", params={"folder": root}).json()["items"]] == [p1]
    c.post("/api/papers/bulk", json={"ids": [p1, p2], "action": "move_folder", "value": child})
    assert c.get("/api/papers", params={"folder": root}).json()["total"] == 0
    assert {p["id"] for p in c.get("/api/papers", params={"folder": child}).json()["items"]} == {p1, p2}
    p = c.get(f"/api/papers/{p1}").json()
    assert p["folder_id"] == child and p["collections"] == [cid]
    assert ("copy", f"users/{u.id}/papers/{p1}.pdf") in cloud.storage.log  # 키는 그대로 (폴더와 무관)
    grand = c.post("/api/folders", json={"name": "하위", "parent_id": child}).json()["id"]
    r = c.delete(f"/api/folders/{child}").json()
    assert r == {"ok": True, "moved_papers": 2, "moved_folders": 1}
    assert {p["id"] for p in c.get("/api/papers", params={"folder": root}).json()["items"]} == {p1, p2}
    assert [f["parent_id"] for f in c.get("/api/folders").json() if f["id"] == grand] == [root]
    assert c.get(f"/api/papers/{p1}").json()["has_pdf"]
    c.delete(f"/api/folders/{root}")
    assert c.get("/api/papers", params={"filter": "no_folder"}).json()["total"] == 2


def test_manuscript_last_write(cloud):
    """AC-28"""
    u = cloud.user()
    c1, c2 = cloud.client(u), cloud.client(u)
    mid = c1.post("/api/manuscripts", json={"title": "원고"}).json()["id"]
    r = c1.patch(f"/api/manuscripts/{mid}", json={"content": "# 새 제목\n본문"}).json()
    assert r["ok"] and r["updated_at"].endswith("+00:00")
    got = c2.get(f"/api/manuscripts/{mid}").json()
    assert got["title"] == "새 제목" and got["content"].endswith("본문")
    assert c2.delete(f"/api/manuscripts/{mid}").json() == {"ok": True}
    assert c1.get(f"/api/manuscripts/{mid}").status_code == 404


def test_db_recovers_after_bad_address(project, users):
    """AC-56: 닿지 않는 주소 → 503, 올바른 주소로 되돌리면 재시작 없이 회복"""
    db = Database("postgresql://nobody:x@127.0.0.1:9/none?connect_timeout=1", timeout=1.5)
    cloud = Cloud(project, db, users)
    c = cloud.client(cloud.user())
    assert c.get("/api/papers").status_code == 503
    assert c.get("/api/health", params={"deep": 1}).json()["db"] == "error"
    db.reconfigure(project.app_db)
    assert c.get("/api/papers").status_code == 200
    assert c.get("/api/health", params={"deep": 1}).json()["db"] == "ok"
    db.close()


def test_auth_hook_function(project):
    """AC-05. postgres 역할은 supabase_auth_admin으로 SET ROLE 할 수 없어(Supabase 권한) 함수 판단은 관리자 연결로,
    Auth 쪽 권한은 카탈로그로 확인한다."""
    email = f"t-hook-{uuid.uuid4().hex[:8]}@paperlab.test"
    project.allow(email)
    try:
        with admin(project) as conn:
            ok = conn.execute("select paperlab.before_user_created(%s::jsonb)",
                              (json.dumps({"user": {"email": email.upper()}}),)).fetchone()[0]
            no = conn.execute("select paperlab.before_user_created(%s::jsonb)",
                              (json.dumps({"user": {"email": "c@test.example"}}),)).fetchone()[0]
            assert ok == {} and no["error"]["http_code"] == 403 and "not_allowed" in no["error"]["message"]
            assert conn.execute("select paperlab.before_user_created('{}'::jsonb)").fetchone()[0]["error"]["http_code"] == 403
            privs = conn.execute(
                "select has_function_privilege('supabase_auth_admin', 'paperlab.before_user_created(jsonb)', 'execute'), "
                "has_table_privilege('supabase_auth_admin', 'paperlab.allowed_emails', 'select'), "
                "has_schema_privilege('supabase_auth_admin', 'paperlab', 'usage'), "
                "exists (select 1 from pg_policy where polrelid = 'paperlab.allowed_emails'::regclass "
                "        and 'supabase_auth_admin'::regrole = any(polroles)), "
                "has_function_privilege('authenticated', 'paperlab.before_user_created(jsonb)', 'execute'), "
                "has_function_privilege('anon', 'paperlab.before_user_created(jsonb)', 'execute')").fetchone()
            assert privs == (True, True, True, True, False, False)
            for sql in ("select paperlab.before_user_created('{}'::jsonb)", "select * from paperlab.allowed_emails"):
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    with conn.transaction():
                        conn.execute("set local role authenticated")
                        conn.execute(sql)
    finally:
        project.disallow(email)


def test_sync_allowlist(project):
    """AC-06 — 테스트 프로젝트의 허용 목록을 바꾸므로 끝나면 원래대로 돌린다"""
    with admin(project) as conn:
        before = [r[0] for r in conn.execute("select email from paperlab.allowed_emails")]
    try:
        assert sync_allowlist(project.admin_db, "A@Test.example, b@test.example") == ["a@test.example", "b@test.example"]
        assert sync_allowlist(project.admin_db, "A@Test.example, b@test.example") == ["a@test.example", "b@test.example"]
    finally:
        sync_allowlist(project.admin_db, before)


def test_migrations_idempotent_and_guarded(project):
    """AC-57 · AC-72 (3): 두 번째 실행은 아무것도 안 함, 표지가 있는 DB에 운영 마이그레이션은 거부"""
    assert apply_migrations(project.admin_db, target="test") == []
    with pytest.raises(MigrationError, match="테스트 프로젝트 표지"):
        apply_migrations(project.admin_db, target="production")
    with pytest.raises(AdminError):
        refuse_test_project(project.admin_db)


def test_search_performance(cloud):
    """AC-35: 논문 500편 · 쪽 1만 개(쪽당 2,000자)에서 검색 1초 안 (결과는 출력 — 보고서에 기록)"""
    import time
    u = cloud.user()
    c = cloud.client(u)
    filler = ("lorem ipsum dolor sit amet 연구 방법 결과 " * 60)[:2000]
    with psycopg.connect(cloud.project.admin_db, autocommit=True) as conn, conn.transaction():
        ids = [r[0] for r in conn.execute(
            "insert into paperlab.papers (user_id, title) select %s, 'perf paper ' || g from generate_series(1, 500) g "
            "returning id", (u.id,))]
        conn.execute("insert into paperlab.paper_search (paper_id, user_id, meta) select id, %s, title "
                     "from paperlab.papers where user_id = %s", (u.id, u.id))
        with conn.cursor() as cur:
            cur.executemany("insert into paperlab.page_texts (user_id, paper_id, page, text) values (%s, %s, %s, %s)",
                            [(u.id, pid, page, filler + (" 추천 self-attention" if page == 1 and pid == ids[7] else ""))
                             for pid in ids for page in range(1, 21)])
    c.get("/api/stats")  # 데움: JWKS 받기 · 풀 연결 (운영 인스턴스의 평소 상태)
    for q in ("추천", "self-attention"):
        times = []
        for _ in range(3):
            t = time.perf_counter()
            r = c.get("/api/papers", params={"q": q, "limit": 50}).json()
            times.append(time.perf_counter() - t)
        took = sorted(times)[1]  # 중앙값
        print(f"AC-35 q={q} total={r['total']} median={took:.3f}s all={[round(x, 3) for x in times]}")
        assert r["total"] == 1 and took < 1.0


def test_logs_have_no_secrets(cloud, caplog):
    """AC-49: 로그에 시험용 API 키 · JWT · 서명 주소 서명이 나오지 않음"""
    import logging
    import re as _re
    caplog.set_level(logging.DEBUG)
    u = cloud.user()
    c = cloud.client(u)
    key = "sk-ant-logcheck-" + uuid.uuid4().hex
    c.put("/api/settings", json={"anthropic_api_key": key})
    pid = cloud.upload(c, make_pdf(title="Log Check Paper Title", doi=""))["id"]
    signed = c.get(f"/api/papers/{pid}/pdf-url").json()["url"]
    sig = _re.search(r"X-Amz-Signature=([0-9a-f]+)", signed).group(1)
    c.get("/api/papers", params={"q": "log"})
    text = caplog.text
    assert key not in text and u.token not in text and sig not in text



def test_ssrf_blocked_via_api(cloud):
    """품질팀 F3: 사용자 pdf_url이 내부 주소면 연결하지 않고 같은 문구"""
    from paperlab.sources import PDF_FETCH_FAILED, Sources
    cloud.app.state.sources_factory = lambda get: Sources(get, resolver=lambda h, p: ["10.0.0.7"])
    c = cloud.client(cloud.user())
    r = c.post("/api/papers", json={"title": "SSRF probe paper", "pdf_url": "http://169.254.169.254/latest/meta-data/",
                                    "download_pdf": True}).json()
    assert PDF_FETCH_FAILED in r["warning"] and r["paper"]["has_pdf"] is False
    pid = r["paper"]["id"]
    for url in ("http://127.0.0.1:5432/", "http://internal.example/x.pdf", "file:///etc/passwd"):
        c.patch(f"/api/papers/{pid}", json={"pdf_url": url})
        res = c.post(f"/api/papers/{pid}/fetch-pdf")
        assert res.status_code == 502 and res.json()["detail"] == PDF_FETCH_FAILED, url


def test_complete_cleans_incoming_when_validation_fails(cloud):
    """품질팀 F11: 폴더 · 컬렉션 검증 실패(400) 때도 임시 파일을 지운다"""
    u = cloud.user()
    c = cloud.client(u)
    for field in ("folder_id", "collection_id"):
        slot = c.post("/api/uploads", json={"files": [{"name": "x.pdf", "size": 10}]}).json()["files"][0]
        assert cloud.storage.browser_put(slot["upload"]["url"], make_pdf()) == 200
        key = f"incoming/{u.id}/{slot['upload_id']}.pdf"
        assert key in cloud.storage.objects
        r = c.post(f"/api/uploads/{slot['upload_id']}/complete", json={field: 999999999})
        assert r.status_code == 400 and key not in cloud.storage.objects, field
