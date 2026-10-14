"""6단계 서재 휴지통 [db] — 웹 API · 누출 · 실행기 (docs/specs/phase6-folder-sync.md 19장 AC-605 · 605b~d · 641~647)."""

from __future__ import annotations

import json
import uuid

import psycopg
import pytest

from paperlab import explain, jobs
from paperlab.db import actor_claims

from .conftest import SAMPLE, make_pdf

pytestmark = pytest.mark.db


def sql(project, q: str, params=None):
    with psycopg.connect(project.admin_db, autocommit=True, prepare_threshold=None) as conn:
        cur = conn.execute(q, params)
        return cur.fetchall() if cur.description else cur.rowcount


def test_trash_restore_purge_and_usage(cloud, project):
    """AC-641 · 642 · 643 · 645 · 646 · 647"""
    u, v = cloud.user(), cloud.user()
    a, b = cloud.client(u), cloud.client(v)
    keep = a.post("/api/folders", json={"name": "남는 폴더"}).json()["id"]
    gone = a.post("/api/folders", json={"name": "지울 폴더"}).json()["id"]
    pdfs = [make_pdf(title=f"Trash Paper Number {i} Title", doi="") for i in range(5)]
    ids = [cloud.upload(a, d, f"p{i}.pdf", folder_id=keep if i < 2 else gone)["id"] for i, d in enumerate(pdfs)]
    sizes = sum(len(d) for d in pdfs)
    a.post(f"/api/papers/{ids[0]}/annotations", json={"page": 1, "text": "hl"})
    a.put(f"/api/papers/{ids[0]}/note", json={"content": "memo"})
    n_before = len([op for op, _ in cloud.storage.log if op == "delete"])
    assert a.delete(f"/api/papers/{ids[0]}").json() == {"ok": True}
    assert a.post("/api/papers/bulk", json={"ids": ids[1:], "action": "delete"}).json() == {"ok": True}
    assert len([op for op, _ in cloud.storage.log if op == "delete"]) == n_before  # R2 삭제 0
    assert a.get("/api/papers").json()["total"] == 0
    assert a.get(f"/api/papers/{ids[0]}").status_code == 404
    st = a.get("/api/stats").json()
    assert st["total"] == 0 and st["trash"] == 5 and st["annotations"] == 0 and st["sync_on"] is False
    us = a.get("/api/storage/usage").json()
    assert us["mine_bytes"] == 0 and us["trash_bytes"] == sizes and us["used_bytes"] >= sizes
    t = a.get("/api/trash").json()
    assert t["total_bytes"] == sizes and len(t["items"]) == 5
    item = next(i for i in t["items"] if i["id"] == ids[0])
    assert item["deleted_folder_path"] == "남는 폴더" and item["deleted_by_label"] == "웹" and item["file_name"] == "p0.pdf"
    assert item["purge_at"][:10] > item["deleted_at"][:10]
    # 남의 휴지통
    assert b.get("/api/trash").json()["items"] == []
    assert b.post("/api/trash/restore", json={"ids": ids}).json()["restored"] == 0
    assert b.post("/api/trash/purge", json={"ids": ids}).json() == {"purged": 0}
    # 폴더 하나를 지우고, 같은 이름 논문을 원래 폴더에 다시 둔 뒤 되살리기
    a.delete(f"/api/folders/{gone}")
    other = cloud.upload(a, make_pdf(title="Other Same Name Paper", doi=""), "p1.pdf", folder_id=keep)["id"]
    r = a.post("/api/trash/restore", json={"ids": ids}).json()
    assert r["restored"] == 5 and r["to_root"] == 3 and r["renamed"] == [{"id": ids[1], "file_name": "p1 (2).pdf"}]
    rows = dict(sql(project, "select id, folder_id from paperlab.papers where id = any(%s)", (ids,)))
    assert [rows[i] for i in ids] == [keep, keep, None, None, None]
    assert a.get(f"/api/papers/{ids[0]}/annotations").json()[0]["text"] == "hl"
    assert a.get(f"/api/papers/{ids[0]}").json()["note"] == "memo"
    # 영구 삭제 · 비우기 → 행 · 하위 행 연쇄 + 커밋 뒤 R2 삭제 + 묘비
    a.post("/api/papers/bulk", json={"ids": ids + [other], "action": "delete"})
    assert a.post("/api/trash/purge", json={"ids": [ids[0]]}).json() == {"purged": 1}
    assert f"users/{u.id}/papers/{ids[0]}.pdf" not in cloud.storage.objects
    assert sql(project, "select count(*) from paperlab.annotations where paper_id = %s", (ids[0],))[0][0] == 0
    assert a.post("/api/trash/empty").json() == {"purged": 5}
    assert sql(project, "select count(*) from paperlab.sync_tombstones where user_id = %s and kind = 'paper'", (u.id,))[0][0] == 6
    assert a.get("/api/stats").json()["trash"] == 0
    assert a.post("/api/trash/restore", json={"ids": []}).status_code == 400


def test_thirty_day_purge_by_user_request(cloud, project, monkeypatch):
    """AC-644: 31일 지난 것만 사용자 요청(maintain)에서 영구 삭제, system_tx 0회"""
    u = cloud.user()
    a = cloud.client(u)
    old = cloud.upload(a, make_pdf(title="Old Trash Paper Title", doi=""))["id"]
    new = cloud.upload(a, make_pdf(title="New Trash Paper Title", doi=""))["id"]
    a.post("/api/papers/bulk", json={"ids": [old, new], "action": "delete"})
    sql(project, "update paperlab.papers set deleted_at = now() - interval '31 days' where id = %s", (old,))
    sql(project, "update paperlab.papers set deleted_at = now() - interval '29 days' where id = %s", (new,))
    calls = []
    real = cloud.app.state.db.system_tx
    monkeypatch.setattr(cloud.app.state.db, "system_tx", lambda reason, **kw: calls.append(reason) or real(reason, **kw))
    cloud.app.state.workers.swept.clear()
    a.get("/api/jobs")
    assert [i["id"] for i in a.get("/api/trash").json()["items"]] == [new]
    assert f"users/{u.id}/papers/{old}.pdf" not in cloud.storage.objects
    assert calls == []


def test_trashed_paper_does_not_leak(cloud, project):
    """AC-605 · 605b: 목록 · 검색 · 컬렉션 · 태그 · 폴더 개수 · 통계 · 중복 · 하이라이트(aid) · 작업 · 범위 대화 출처"""
    u = cloud.user()
    a = cloud.client(u)
    word = "zyxq" + uuid.uuid4().hex[:6]
    pid = cloud.upload(a, make_pdf(title="Leak Check Paper Title", body=f"secret {word} text", doi=""))["id"]
    a.patch(f"/api/papers/{pid}", json=dict(SAMPLE, tags=["leak-tag"]))
    fid = a.post("/api/folders", json={"name": "LF"}).json()["id"]
    cid = a.post("/api/collections", json={"name": "LC"}).json()["id"]
    a.post("/api/papers/bulk", json={"ids": [pid], "action": "add_collection", "value": str(cid)})
    a.post("/api/papers/bulk", json={"ids": [pid], "action": "move_folder", "value": fid})
    aid = a.post(f"/api/papers/{pid}/annotations", json={"page": 1, "text": "hl secret"}).json()["id"]
    sql(project, "insert into paperlab.jobs (user_id, kind, status, runner, engine, route, paper_id, error_code) values "
                 "(%s, 'summary', 'failed', 'api', 'claude', '[{\"runner\": \"api\", \"engine\": \"claude\"}]', %s, 'x')",
        (u.id, pid))
    sid = sql(project, "insert into paperlab.chat_sessions (user_id, scope) values (%s, 'library') returning id", (u.id,))[0][0]
    sql(project, "insert into paperlab.chat_messages (user_id, session_id, role, content, citations) values "
                 "(%s, %s, 'assistant', 'a [1]', %s)", (u.id, sid, json.dumps([{"n": 1, "paper_id": pid, "title": "Leak"}])))
    assert a.get("/api/papers", params={"q": word}).json()["total"] == 1
    a.delete(f"/api/papers/{pid}")
    assert a.get("/api/papers", params={"q": word}).json()["total"] == 0
    assert a.get("/api/papers").json()["total"] == 0
    assert next(c for c in a.get("/api/collections").json() if c["id"] == cid)["count"] == 0
    assert next(t for t in a.get("/api/tags").json() if t["name"] == "leak-tag")["count"] == 0
    assert next(f for f in a.get("/api/folders").json() if f["id"] == fid)["count"] == 0
    assert a.get("/api/stats").json()["annotations"] == 0
    assert a.patch(f"/api/annotations/{aid}", json={"comment": "x"}).status_code == 404
    assert a.delete(f"/api/annotations/{aid}").status_code == 404
    assert [j for j in a.get("/api/jobs", params={"status": "all"}).json()["jobs"] if j["paper_id"] == pid] == []
    assert a.post("/api/resolve", json={"identifier": SAMPLE["doi"]}).json()["in_library"] is None
    assert a.get("/api/ask").json()["messages"][0]["citations"] == []
    with cloud.app.state.db.user_tx(actor_claims(u.id, "test")) as lib:
        assert lib.find_duplicate(SAMPLE["doi"]) is None
        assert lib.page_texts(pid) == [] and lib._all("select * from paperlab.paper_search where paper_id = %s", (pid,)) == []
        with lib.trash_tx():
            assert lib.page_texts(pid) and lib.get_paper(pid)["deleted_at"]
        assert lib.get_paper(pid) is None  # trash_tx를 나오면 다시 숨김
    # 되살리면 모두 돌아옴
    a.post("/api/trash/restore", json={"ids": [pid]})
    assert a.get("/api/papers", params={"q": word}).json()["total"] == 1
    assert a.get("/api/stats").json()["annotations"] == 1


def test_trashed_paper_jobs_cancelled_not_written(cloud, project):
    """AC-605c: 휴지통 논문 작업은 cancelled(paper_trashed) · 결과 쓰기 0 · 다시 시도 404 · 카드 삭제 404"""
    u = cloud.user()
    a = cloud.client(u)
    pid = cloud.upload(a, make_pdf(title="Job Trash Paper Title", doi=""))["id"]
    jid = sql(project, "insert into paperlab.jobs (user_id, kind, status, runner, engine, route, paper_id, lease_token, "
                       "lease_until) values (%s, 'summary', 'running', 'api', 'claude', "
                       "'[{\"runner\": \"api\", \"engine\": \"claude\"}]', %s, gen_random_uuid(), now() + interval '1 hour') "
                       "returning id", (u.id, pid))[0][0]
    eid = sql(project, "insert into paperlab.explanations (user_id, paper_id, kind, lang, sel_hash, page, source_text, result) "
                       "values (%s, %s, 'explain', 'ko', %s, 1, 's', '{}') returning id", (u.id, pid, "f" * 64))[0][0]
    claims = actor_claims(u.id, "test")
    with cloud.app.state.db.user_tx(claims) as lib:
        job = lib._one("select * from paperlab.jobs where id = %s", (jid,))
    a.delete(f"/api/papers/{pid}")
    assert sql(project, "select status, error_code from paperlab.jobs where id = %s", (jid,)) == [("cancelled", "paper_trashed")]
    # 경합 흉내: 휴지통으로 간 뒤에 결과가 도착(앞서 읽어 둔 작업 행으로 반영 시도)
    sql(project, "update paperlab.jobs set status = 'running' where id = %s", (jid,))
    with cloud.app.state.db.user_tx(claims) as lib:
        assert jobs.finish_success(lib, dict(job, cancel_requested=False), {"summary": {"tldr": "x"}}) == ("cancelled", None)
        assert explain.delete(lib, eid) is False
    assert sql(project, "select status, error_code from paperlab.jobs where id = %s", (jid,)) == [("cancelled", "paper_trashed")]
    assert sql(project, "select count(*) from paperlab.ai_summaries where paper_id = %s", (pid,))[0][0] == 0
    assert a.post(f"/api/jobs/{jid}/retry").status_code == 404
    assert a.delete(f"/api/explanations/{eid}").status_code == 404
    assert a.post(f"/api/papers/{pid}/summary").status_code == 404
    a.post("/api/trash/restore", json={"ids": [pid]})
    assert a.get(f"/api/jobs/{jid}").json()["status"] == "cancelled"  # 되살려도 다시 돌지 않음


def test_duplicates_and_citekeys_include_trash(cloud, project):
    """AC-605d · K-40"""
    u = cloud.user()
    a = cloud.client(u)
    pid = a.post("/api/papers", json=SAMPLE).json()["paper"]["id"]
    key = a.get(f"/api/papers/{pid}").json()["citekey"]
    a.delete(f"/api/papers/{pid}")
    r = a.post("/api/papers", json=SAMPLE)
    assert r.status_code == 409 and r.json()["trashed"] is True and r.json()["paper"]["id"] == pid
    bib = a.post("/api/export", json={"ids": [], "format": "bibtex"}).text
    imp = a.post("/api/import", files={"file": ("x.bib", ("@article{k, title={%s}, doi={%s}}" % (
        SAMPLE["title"], SAMPLE["doi"])).encode(), "text/plain")}).json()
    assert imp["added"] == 0 and imp["skipped"] == 1 and bib.strip() == ""
    pdf = make_pdf(title="Deep Residual Learning for Image Recognition", doi="10.1109/cvpr.2016.90")
    first = cloud.upload(a, pdf)["id"]
    a.delete(f"/api/papers/{first}")
    res = cloud.upload(a, make_pdf(title="Deep Residual Learning for Image Recognition", body="v2", doi="10.1109/cvpr.2016.90"))
    assert res["trashed"] is True and res["id"] == first and res["note"] == "휴지통에 같은 논문이 있어요"
    new = a.post("/api/papers", json=dict(SAMPLE, allow_duplicate=True)).json()["paper"]
    assert new["citekey"] == key + "a"
    a.post("/api/trash/restore", json={"ids": [pid]})
    assert a.get(f"/api/papers/{pid}").json()["citekey"] == key


# ====================================================================== 전체 오류 점검 (QA1) 회귀 시험
def test_tag_of_trashed_paper_survives_other_tag_edit(cloud, project):
    """QA D1: 휴지통 논문에만 붙은 (색 없는) 태그가, 다른 논문의 태그를 고칠 때(_drop_unused_tags) 지워지지 않는다.
    태그 이름을 바꾸면 휴지통 논문의 검색 메타도 새 이름으로"""
    u = cloud.user()
    a = cloud.client(u)
    pa = cloud.upload(a, make_pdf(title="Tag Keeper Paper Alpha Title", doi=""), "a.pdf")["id"]
    pb = cloud.upload(a, make_pdf(title="Tag Editor Paper Beta Title", doi=""), "b.pdf")["id"]
    a.patch(f"/api/papers/{pa}", json={"tags": ["solo-tag"]})
    assert a.delete(f"/api/papers/{pa}").json() == {"ok": True}
    a.patch(f"/api/papers/{pb}", json={"tags": ["other-tag"]})       # set_paper_tags → _drop_unused_tags
    tid = next(t["id"] for t in a.get("/api/tags").json() if t["name"] == "solo-tag")
    word = "renamedtag" + uuid.uuid4().hex[:6]
    assert a.patch(f"/api/tags/{tid}", json={"name": word}).status_code == 200
    a.post("/api/trash/restore", json={"ids": [pa]})
    assert [t["name"] for t in a.get(f"/api/papers/{pa}").json()["tags"]] == [word]
    assert [p["id"] for p in a.get("/api/papers", params={"q": word}).json()["items"]] == [pa]


def _replace_slot(cloud, a, pid, data):
    slot = a.post(f"/api/papers/{pid}/pdf/upload").json()
    assert cloud.storage.browser_put(slot["upload"]["url"], data) == 200
    return slot


def _db_sha(project, pid):
    return sql(project, "select pdf_sha256 from paperlab.papers where id = %s", (pid,))[0][0]


def test_pdf_replace_after_trash_is_404_and_keeps_pdf(cloud, project):
    """QA D2: PDF 교체 중(R2 받기 · 추출 사이) 다른 요청이 휴지통으로 보냄 → 행을 먼저 잠그는 attach가 404,
    R2 PDF는 그대로(DB sha와 같음) · 임시 파일은 지움(D8)"""
    import hashlib
    u = cloud.user()
    a = cloud.client(u)
    pid = cloud.upload(a, make_pdf(title="Race Paper Original Title", doi=""), "r.pdf")["id"]
    key = f"users/{u.id}/papers/{pid}.pdf"
    slot = _replace_slot(cloud, a, pid, make_pdf(title="Race Paper Replacement Title", body="new body", doi=""))
    incoming = f"incoming/{u.id}/{slot['upload_id']}.pdf"
    real_get = cloud.storage.get

    def get(k):
        if k == incoming:  # 웹이 R2에서 받는 동안 다른 요청이 휴지통으로 (커밋)
            with cloud.app.state.db.user_tx(actor_claims(u.id, "qa")) as lib:
                assert lib.trash_papers([pid], "web")
        return real_get(k)

    cloud.storage.get = get
    try:
        r = a.post(f"/api/papers/{pid}/pdf/complete", json={"upload_id": slot["upload_id"], "name": "r.pdf"})
    finally:
        cloud.storage.get = real_get
    assert r.status_code == 404, r.text
    assert hashlib.sha256(cloud.storage.objects[key]).hexdigest() == _db_sha(project, pid)
    assert incoming not in cloud.storage.objects


def test_trash_waits_for_pdf_replace_lock(cloud, project):
    """QA D2: R2 복사 중에 온 휴지통 보내기는 행 잠금을 기다렸다가 교체가 커밋된 뒤에 진행 → R2 = DB = 새 PDF, 휴지통에 있음"""
    import hashlib
    import threading
    u = cloud.user()
    a = cloud.client(u)
    pid = cloud.upload(a, make_pdf(title="Lock Paper Original Title", doi=""), "r.pdf")["id"]
    key = f"users/{u.id}/papers/{pid}.pdf"
    new_pdf = make_pdf(title="Lock Paper Replacement Title", body="replacement body text", doi="")
    slot = _replace_slot(cloud, a, pid, new_pdf)
    real_copy = cloud.storage.copy
    seen = {}

    def trash():
        with cloud.app.state.db.user_tx(actor_claims(u.id, "qa")) as lib:
            seen["moved"] = lib.trash_papers([pid], "web")

    def copy(src, dst):
        if dst == key and "thread" not in seen:
            seen["thread"] = t = threading.Thread(target=trash, daemon=True)
            t.start()
            t.join(1.5)
            seen["blocked"] = t.is_alive()  # attach가 잡은 행 잠금을 기다리는 중
        return real_copy(src, dst)

    cloud.storage.copy = copy
    try:
        r = a.post(f"/api/papers/{pid}/pdf/complete", json={"upload_id": slot["upload_id"], "name": "r.pdf"})
    finally:
        cloud.storage.copy = real_copy
    seen["thread"].join(30)
    assert r.status_code == 200, r.text
    assert seen["blocked"] is True and [m["id"] for m in seen["moved"]] == [pid]
    assert hashlib.sha256(cloud.storage.objects[key]).hexdigest() == _db_sha(project, pid) == \
        hashlib.sha256(new_pdf).hexdigest()
    assert sql(project, "select deleted_at is not null from paperlab.papers where id = %s", (pid,)) == [(True,)]


def test_chat_result_after_trash_ends_with_error_event(cloud, project):
    """QA D6: 대화 답이 끝나기 전에 논문이 휴지통으로 가면(작업이 RLS로 숨음 → JobError) 빈 스트림이 아니라
    {"type": "error"} 이벤트로 끝난다"""
    u = cloud.user()
    a = cloud.client(u)
    assert a.put("/api/settings", json={"anthropic_api_key": "sk-ant-test-key-0001"}).status_code == 200
    pid = cloud.upload(a, make_pdf(title="Chat Trash Paper Title", doi=""))["id"]

    def chat(ctx, history, question, engine="claude"):
        yield {"type": "delta", "text": "답"}
        with cloud.app.state.db.user_tx(actor_claims(u.id, "qa")) as lib:
            lib.trash_papers([pid], "web")
        yield {"type": "done", "text": "끝[1]", "citations": []}

    cloud.fake_ai.chat = chat
    with a.stream("POST", f"/api/papers/{pid}/chat", json={"question": "몇 쪽?"}) as r:
        events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    assert events[0] == {"type": "delta", "text": "답"}
    assert events[-1]["type"] == "error" and events[-1]["error"] == "논문을 휴지통으로 옮겨 작업을 멈췄어요", events
    assert sql(project, "select count(*) from paperlab.chat_messages m join paperlab.chat_sessions s on s.id = m.session_id "
                        "where s.paper_id = %s", (pid,))[0][0] == 0
