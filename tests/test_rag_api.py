"""3단계 — 색인 · 서재 질문 · 인용 검증 · AI로 찾기 API (docs/specs/phase3-rag-verify-search.md 16장 [db]).

테스트용 Supabase 프로젝트 + 가짜 저장소(FakeStorage) + 가짜 임베딩(HashEmbedder) + 가짜 AI(conftest.FakeAI) +
가짜 검색(Sources + httpx.MockTransport) + Python 가짜 워커. 실제 모델 · API · R2 · CLI는 부르지 않는다.
"""

from __future__ import annotations

import json
import os
import re
import time

import pymupdf
import pytest

from paperlab import rag
from paperlab.sources import Sources

from .conftest import Cloud
from .test_jobs import KEY, Worker, sql
from .test_rag import _transport

pytestmark = pytest.mark.db

STRESS = ("Academic stress was measured with the Perceived Stress Scale in all participating students. "
          "Higher stress predicted shorter sleep duration and lower sleep quality across semesters. ") * 4
TRANSFORMER = ("The transformer architecture relies entirely on multi-head self-attention without recurrence. "
               "Positional encodings inject order information into the token embeddings. ") * 4
KOREAN = ("본 연구는 대학생의 학업 스트레스와 수면의 질 사이의 관계를 설문으로 분석하였다. "
          "스트레스가 높을수록 수면 시간이 짧아지는 경향이 나타났다. ") * 4


def pdf_with(pages: list[str], title: str | None = None) -> bytes:
    """쪽마다 글 상자 하나. 제목(가장 큰 글씨)은 기본으로 매번 다르게 — 같은 제목이면 서재가 중복으로 본다"""
    title = f"Test document {time.monotonic_ns()}" if title is None else title
    doc = pymupdf.open()
    font = pymupdf.Font("cjk")
    for i, text in enumerate(pages):
        page = doc.new_page()
        page.insert_font(fontname="cjk", fontbuffer=font.buffer)
        if i == 0 and title:
            page.insert_text((72, 60), title, fontsize=16, fontname="cjk")
        page.insert_textbox(pymupdf.Rect(72, 90, 540, 760), text, fontsize=9, fontname="cjk")
    data = doc.tobytes()
    doc.close()
    return data


def sse(client, body: dict, url: str = "/api/ask") -> list[dict]:
    with client.stream("POST", url, json=body) as r:
        assert r.status_code == 200, r.read()
        return [json.loads(x[6:]) for x in r.iter_lines() if x.startswith("data: ")]


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
    for t in ("jobs", "device_pair_codes", "devices", "papers", "user_secrets", "collections", "folders",
              "chat_sessions", "manuscripts"):
        sql(project, f"delete from paperlab.{t} where user_id = any(%s::uuid[])", (ids,))
    sql(project, "update paperlab.profiles set settings = '{}'::jsonb where user_id = any(%s::uuid[])", (ids,))
    made = []
    key = os.urandom(32)

    def make(**kw) -> Cloud:
        kw.setdefault("embedder", rag.HashEmbedder())
        c = Cloud(project, session_db, users=None, releases=tmp_path / "rel", encryption_key=key, **kw)
        c.app.state.allowlist.emails = frozenset(u.email.lower() for u in ab)
        c.known_uids |= set(ids)
        c.app.state.runner.start(scan=False)
        made.append(c)
        return c

    c = make()
    c.make = make
    c.a, c.b = a, b
    for u in ab:
        c.client(u).get("/api/me")
    yield c
    for x in made:
        x.app.state.runner.stop()
        x.assert_keys_scoped()


def wait_indexed(client, scope: str = "library", timeout: float = 30.0) -> dict:
    deadline = time.monotonic() + timeout
    while True:
        out = client.get(f"/api/ask?scope={scope}").json()
        job = out.get("job") or {}
        if out["index"]["pending"] == 0 and job.get("status") not in ("queued", "running") and out["index"]["loaded"]:
            return out
        assert time.monotonic() < deadline, out
        time.sleep(0.2)


def papers_rag(project, uid: str) -> dict:
    return {r[0]: (r[1], r[2]) for r in sql(project, "select id, rag_version, rag_key from paperlab.papers where user_id = %s",
                                             (uid,))}


# ====================================================================== 색인 · 질문 (I01 · I04 · I06 · Q01 · Q03 · Q04 · S09)
def test_index_then_ask_collection_scope(env, project):
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    p1 = env.upload(ca, pdf_with([STRESS, TRANSFORMER], "Stress and sleep"), "s.pdf")["id"]
    p2 = env.upload(ca, pdf_with([KOREAN], "대학생 스트레스"), "k.pdf")["id"]
    p3 = env.upload(ca, pdf_with([TRANSFORMER], "Attention model"), "t.pdf")["id"]
    blank = env.upload(ca, pdf_with([""], ""), "blank scan.pdf")["id"]  # 본문 없는 PDF(스캔본 흉내)
    out = wait_indexed(ca)
    st = papers_rag(project, env.a.id)
    for pid in (p1, p2, p3):
        assert st[pid][0] == rag.RAG_VERSION and st[pid][1] in env.storage.objects  # AC-I01
    assert st[blank] == (rag.RAG_VERSION, "")  # AC-I06: 파일 없이 판만 — 다시 시도하지 않음
    assert out["index"] == {"papers": 4, "with_pdf": 4, "indexed": 3, "no_text": 1, "pending": 0, "embed": True,
                            "loaded": out["index"]["loaded"]}
    assert out["job"]["kind"] == "index" and out["job"]["engine"] == "local" and out["job"]["status"] == "succeeded"
    # 컬렉션 범위: p1 · p2만
    cid = ca.post("/api/collections", json={"name": "선행연구"}).json()["id"]
    ca.post("/api/papers/bulk", json={"ids": [p1, p2], "action": "add_collection", "value": str(cid)})
    env.fake_ai.reply = "스트레스가 수면을 줄였어요 [1][2]. 없는 번호 [9]."
    ev = sse(ca, {"scope": f"c{cid}", "question": "academic stress and sleep quality 수면의"})
    done = ev[-1]
    assert done["type"] == "done", ev
    assert done["text"] == "스트레스가 수면을 줄였어요 [1][2]. 없는 번호 ."  # AC-Q04
    assert [c["n"] for c in done["citations"]] == [1, 2]
    assert {c["paper_id"] for c in done["citations"]} <= {p1, p2}  # AC-Q01
    for c in done["citations"]:
        assert c["page"] >= 1 and c["char_end"] > c["char_start"] and c["title"] and c["text"]
    system, prompt = env.fake_ai.prompts[-1]
    assert prompt.count("<source n=") <= 8 and "질문: academic stress" in prompt and "[번호]" in system
    job = ca.get(f"/api/jobs/{done['job_id']}").json()
    assert job["scope"] == {"type": "collection", "id": cid} and job["paper_id"] is None
    # 대화 저장 · 다시 열기 · 지우기
    got = ca.get(f"/api/ask?scope=c{cid}").json()
    assert [m["role"] for m in got["messages"]] == ["user", "assistant"]
    assert got["messages"][1]["citations"][0]["paper_id"] in (p1, p2) and got["scope"]["name"] == "선행연구"
    assert ca.get("/api/ask?scope=library").json()["messages"] == []  # 범위마다 따로
    ev2 = sse(ca, {"scope": f"c{cid}", "question": "두 번째 질문"})
    assert "<conversation>" in env.fake_ai.prompts[-1][1] and ev2[-1]["type"] == "done"
    assert ca.delete(f"/api/ask?scope=c{cid}").json() == {"ok": True}
    assert ca.get(f"/api/ask?scope=c{cid}").json()["messages"] == []
    # 혼합 검색(AC-Q03): 낱말이 같은 조각(한국어)과 의미가 가까운 조각이 모두 출처에
    sources = rag.Rag(env.storage, rag.HashEmbedder(), env.app.state.rag.cache)
    tx = lambda: env.app.state.db.user_tx({"sub": env.a.id, "role": "authenticated"})  # noqa: E731
    with tx() as lib:
        rows = rag.scope_rows(lib, "library", None)
    hits = sources.search(tx, env.a.id, rows, "트랜스포머의 multi-head self-attention 수면의")
    assert len(hits) <= 8 and {h["paper_id"] for h in hits} >= {p1, p3}
    assert max(sum(1 for h in hits if h["paper_id"] == p) for p in (p1, p2, p3)) <= 3
    ko = sources.search(tx, env.a.id, rows, "수면의 질은 어떤가")  # 조사 떼기 → '수면' 낱말 검색
    assert ko and ko[0]["paper_id"] == p2


def test_reindex_on_pdf_change_and_delete(env, project):
    """AC-I04 · S06 · S09: PDF를 바꾸면 포인터를 비우고(새 키 → 포인터 → 옛 키 삭제 순) 다시 색인, 제목만 바꾸면 그대로,
    지우면 파일 삭제 · 그 직후 질문에 안 나옴(캐시에 있어도)"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = env.upload(ca, pdf_with([STRESS]), "a.pdf")["id"]
    other = env.upload(ca, pdf_with([TRANSFORMER]), "b.pdf")["id"]
    wait_indexed(ca)
    old_key = papers_rag(project, env.a.id)[pid][1]
    ca.patch(f"/api/papers/{pid}", json={"title": "바뀐 제목"})
    assert papers_rag(project, env.a.id)[pid] == (rag.RAG_VERSION, old_key)  # 제목만 → 재색인 없음
    sse(ca, {"scope": "library", "question": "stress sleep"})  # 캐시에 올림
    slot = ca.post(f"/api/papers/{pid}/pdf/upload").json()
    assert env.storage.browser_put(slot["upload"]["url"], pdf_with([KOREAN])) == 200
    env.storage.log.clear()
    assert ca.post(f"/api/papers/{pid}/pdf/complete", json={"upload_id": slot["upload_id"]}).status_code == 200
    assert old_key not in env.storage.objects  # 커밋 뒤 옛 파일 삭제
    wait_indexed(ca)
    new_key = papers_rag(project, env.a.id)[pid][1]
    assert new_key and new_key != old_key and new_key in env.storage.objects
    ops = [(op, k) for op, k in env.storage.log if "/rag/" in k and op in ("put", "delete")]
    assert ops.index(("delete", old_key)) < ops.index(("put", new_key))
    # 교체 순서: 다음 재색인에서 새 키 put → (포인터) → 옛 키 delete
    sql(project, "update paperlab.papers set rag_version = '' where id = %s", (pid,))
    env.storage.log.clear()
    wait_indexed(ca)
    newer = papers_rag(project, env.a.id)[pid][1]
    ops = [(op, k) for op, k in env.storage.log if "/rag/" in k and op in ("put", "delete")]
    assert ops == [("put", newer), ("delete", new_key)]
    # 삭제 → 파일 · 캐시 · 질문에서 빠짐
    ca.delete(f"/api/papers/{pid}")
    assert newer not in env.storage.objects
    ev = sse(ca, {"scope": "library", "question": "학업 스트레스 수면 stress"})
    assert all(c["paper_id"] == other for c in ev[-1]["citations"])


def test_pointer_not_swapped_when_pdf_changes_midway(env, project, monkeypatch):
    """AC-S09: 색인하는 사이 PDF가 바뀌면 포인터를 바꾸지 않고 새 키는 지운다. 쓰기 실패면 옛 파일 · 포인터 그대로"""
    ca = env.client(env.a)
    pid = env.upload(ca, pdf_with([STRESS]), "a.pdf")["id"]
    wait_indexed(ca)
    keep = papers_rag(project, env.a.id)[pid][1]
    r = env.app.state.rag
    tx = lambda: env.app.state.db.user_tx({"sub": env.a.id, "role": "authenticated"})  # noqa: E731
    sql(project, "update paperlab.papers set rag_version = '' where id = %s", (pid,))
    real_put = env.storage.put

    def put_then_change(key, data, content_type="application/pdf"):
        real_put(key, data, content_type)
        sql(project, "update paperlab.papers set pdf_sha256 = %s where id = %s", ("f" * 64, pid))
    monkeypatch.setattr(env.storage, "put", put_then_change)
    res = r.index_next(tx, env.a.id, set())
    assert res["replaced"] is False and papers_rag(project, env.a.id)[pid] == ("", keep)
    assert [k for k in env.storage.objects if f"/rag/{pid}." in k] == [keep]  # 새 키는 지워짐

    def fail_put(key, data, content_type="application/pdf"):
        from paperlab.storage import StorageError
        raise StorageError("down")
    monkeypatch.setattr(env.storage, "put", fail_put)
    assert r.index_next(tx, env.a.id, set())["error"] == "storage"
    assert papers_rag(project, env.a.id)[pid] == ("", keep) and keep in env.storage.objects


def test_bad_vector_file_returns_to_pending(env, project):
    """AC-S05: 파일 머리가 DB와 다르면 검색에서 빼고 rag_version = ''로 되돌린다"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = env.upload(ca, pdf_with([STRESS]), "a.pdf")["id"]
    other = env.upload(ca, pdf_with([TRANSFORMER]), "b.pdf")["id"]
    wait_indexed(ca)
    key = papers_rag(project, env.a.id)[pid][1]
    env.storage.objects[key] = env.storage.objects[papers_rag(project, env.a.id)[other][1]]  # 다른 논문 파일로 바꿔치기
    env.app.state.rag.cache.drop_paper(env.a.id, pid)  # 서버 재시작 흉내 — 다음 질문 때 R2에서 다시 읽음
    ev = sse(ca, {"scope": "library", "question": "stress sleep transformer"})
    assert all(c["paper_id"] == other for c in ev[-1]["citations"])
    assert papers_rag(project, env.a.id)[pid][0] == ""


# ====================================================================== 사용자 경계 (S03 · S04 · Q07 · D02 · D03)
def test_scope_boundaries_between_users(env, project):
    ca, cb = env.client(env.a), env.client(env.b)
    for c in (ca, cb):
        c.put("/api/settings", json={"anthropic_api_key": KEY})
    pa = env.upload(ca, pdf_with([STRESS]), "a.pdf")["id"]
    pb = env.upload(cb, pdf_with([STRESS]), "b.pdf")["id"]
    wait_indexed(ca)
    wait_indexed(cb)
    cid = ca.post("/api/collections", json={"name": "A 컬렉션"}).json()["id"]
    fid = ca.post("/api/folders", json={"name": "A 폴더"}).json()["id"]
    ca.post("/api/papers/bulk", json={"ids": [pa], "action": "add_collection", "value": str(cid)})
    env.storage.log.clear()
    for scope in (f"c{cid}", f"f{fid}"):  # AC-S03: 남의 컬렉션 · 폴더 → 400, A 파일을 읽지 않음
        assert cb.post("/api/ask", json={"scope": scope, "question": "stress"}).status_code == 400
        assert cb.get(f"/api/ask?scope={scope}").status_code == 400
    assert not any(env.a.id in k for _, k in env.storage.log)
    assert cb.post("/api/ask", json={"scope": "zzz", "question": "q"}).status_code == 400
    # AC-Q07: 색인된 논문이 없는 범위
    empty = ca.post("/api/collections", json={"name": "빈"}).json()["id"]
    r = ca.post("/api/ask", json={"scope": f"c{empty}", "question": "q"})
    assert r.status_code == 400 and r.json()["detail"] == "이 범위에 색인된 논문이 없어요"
    # AC-S04: 번갈아 물어도(캐시에 둘 다) 자기 논문만
    for _ in range(2):
        assert {c["paper_id"] for c in sse(ca, {"scope": "library", "question": "stress sleep"})[-1]["citations"]} == {pa}
        assert {c["paper_id"] for c in sse(cb, {"scope": "library", "question": "stress sleep"})[-1]["citations"]} == {pb}
    assert set(env.app.state.rag.cache.users()) == {env.a.id, env.b.id}
    # AC-D02: B 권한으로 A의 범위 대화 · 검증 결과 · 새 작업 종류 0행
    sse(ca, {"scope": f"c{cid}", "question": "stress"})
    mid = ca.post("/api/manuscripts", json={"title": "m", "content": "주장이다 [@nobody]."}).json()["id"]
    ca.post(f"/api/manuscripts/{mid}/verify")
    with env.app.state.db.user_tx({"sub": env.b.id, "role": "authenticated"}) as lib:
        for q in ("select * from paperlab.chat_sessions where scope <> 'paper'", "select * from paperlab.manuscript_citations",
                  "select * from paperlab.jobs where kind in ('index', 'find', 'verify')", "select * from paperlab.chat_messages"):
            rows = lib._all(q)
            assert all(str(r["user_id"]) == env.b.id for r in rows), q
        assert lib._all("select * from paperlab.chat_sessions where collection_id = %s", (cid,)) == []
    # AC-D03: 컬렉션을 지우면 범위 대화가, 논문을 지우면 검증 결과의 paper_id가 null
    mid2 = ca.post("/api/manuscripts", json={"title": "m2", "content": "주장 [@key]."}).json()["id"]
    sql(project, "update paperlab.papers set citekey = 'key' where id = %s", (pa,))
    ca.post(f"/api/manuscripts/{mid2}/verify")
    assert sql(project, "select count(*) from paperlab.manuscript_citations where manuscript_id = %s and paper_id = %s",
               (mid2, pa))[0][0] == 1
    ca.delete(f"/api/collections/{cid}")
    assert sql(project, "select count(*) from paperlab.chat_sessions where collection_id = %s", (cid,))[0][0] == 0
    ca.delete(f"/api/papers/{pa}")
    assert sql(project, "select paper_id from paperlab.manuscript_citations where manuscript_id = %s", (mid2,)) == [(None,)]


# ====================================================================== 모델 없음 · 경로 (I05 · Q05 · Q06 · I03)
def test_without_model_word_search_only(env, project):
    """AC-I05: 모델이 없으면 dim 0 파일 · '…n' 판, 질문은 전문 검색만, embed false. 모델이 생기면 대기로 보인다"""
    c = env.make(embedder=None)
    ca = c.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = c.upload(ca, pdf_with([STRESS]), "a.pdf")["id"]
    out = wait_indexed(ca)
    ver, key = papers_rag(project, env.a.id)[pid]
    assert ver == rag.NO_MODEL_VERSION and out["index"]["embed"] is False and out["index"]["indexed"] == 1
    assert rag.unpack(c.storage.objects[key], pid, sql(project, "select pdf_sha256 from paperlab.papers where id = %s",
                                                        (pid,))[0][0], ver)[1].shape[1] == 0
    ev = sse(ca, {"scope": "library", "question": "Perceived Stress Scale"})
    assert ev[-1]["type"] == "done" and ev[-1]["citations"][0]["paper_id"] == pid
    with c.app.state.db.user_tx({"sub": env.a.id, "role": "authenticated"}) as lib:
        assert rag.Rag(c.storage, rag.HashEmbedder()).pending_count(lib) == 1  # 모델이 생기면 대기
        assert c.app.state.rag.pending_count(lib) == 0


def test_cli_route_fixes_sources_and_no_route(env, project):
    """AC-Q05 · Q06: 키가 없고 PC가 있으면 CLI 대기열 — 잡을 때 params.sources로 프롬프트, 반영 때 같은 번호표. 경로 없으면 400"""
    ca = env.client(env.a)
    pid = env.upload(ca, pdf_with([STRESS]), "a.pdf")["id"]
    wait_indexed(ca)
    r = ca.post("/api/ask", json={"scope": "library", "question": "stress"})
    assert r.status_code == 400 and r.json()["code"] == "no_route"
    w = Worker(env, env.a)
    ev = sse(ca, {"scope": "library", "question": "stress sleep"})
    assert ev[0]["type"] == "queued" and ev[0]["job"]["question"] == "stress sleep"
    t = w.claim()["job"]
    assert t["kind"] == "chat" and t["output"] == "text" and '<source n="1"' in t["prompt"] and "질문: stress sleep" in t["prompt"]
    assert w.result(t, text="수면이 짧아요 [1][5].").json()["status"] == "succeeded"
    msgs = ca.get("/api/ask?scope=library").json()["messages"]
    assert msgs[1]["content"] == "수면이 짧아요 [1]." and msgs[1]["citations"][0]["paper_id"] == pid
    # 키가 틀리면 같은 작업이 CLI 대기열로(폴백)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    env.fake_ai.fail = "api_auth"
    ev = sse(ca, {"scope": "library", "question": "again"})
    assert ev[-1]["type"] == "fallback" and ev[-1]["job"]["runner"] == "cli"


def test_many_uploads_one_index_job(env, project):
    """AC-I03(축소): 한꺼번에 올려도 진행 중 index는 1개이고 모두 색인된다"""
    ca = env.client(env.a)
    ids = [env.upload(ca, pdf_with([STRESS + f" paper {i}"]), f"{i}.pdf")["id"] for i in range(6)]
    active = sql(project, "select count(*) from paperlab.jobs where user_id = %s and kind = 'index' "
                          "and status in ('queued', 'running')", (env.a.id,))[0][0]
    assert active <= 1
    wait_indexed(ca)
    st = papers_rag(project, env.a.id)
    assert all(st[i][0] == rag.RAG_VERSION for i in ids)


# ====================================================================== 인용 검증 (V03 · V04 · V05 · V06)
def verify_reply(results_for):
    def reply(system, prompt, schema):
        ids = [int(x) for x in re.findall(r'<claim id="(\d+)"', prompt)]
        return json.dumps({"results": [results_for(i) for i in ids]})
    return reply


def test_verify_flow(env, project):
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = env.upload(ca, pdf_with([STRESS, KOREAN]), "a.pdf")["id"]
    nopdf = ca.post("/api/papers", json={"title": "No PDF paper about things", "doi": ""}).json()["paper"]["id"]
    sql(project, "update paperlab.papers set citekey = 'lee2022' where id = %s", (pid,))
    sql(project, "update paperlab.papers set citekey = 'nopdf2020' where id = %s", (nopdf,))
    wait_indexed(ca)
    content = ("# 원고\n"
               "학업 스트레스는 수면 시간을 줄인다 [@lee2022, p. 1].\n"
               "그들은 “Higher stress predicted shorter sleep duration” [@lee2022, p. 1]라고 했다.\n"
               "틀린 쪽 인용 “스트레스가 높을수록 수면 시간이 짧아지는” [@lee2022, p. 1].\n"
               "없는 키 [@ghost2000]. PDF 없음 [@nopdf2020].\n")
    mid = ca.post("/api/manuscripts", json={"title": "검증 원고", "content": content}).json()["id"]
    env.fake_ai.reply = verify_reply(lambda i: {"id": i, "verdict": "unsupported", "evidence": 2, "reason": "근거 후보에 없어요"})
    out = ca.post(f"/api/manuscripts/{mid}/verify").json()
    by_key = {}
    for it in out["items"]:
        by_key.setdefault(it["citekey"], []).append(it)
    assert [i["verdict"] for i in by_key["lee2022"]][1:] == ["supported", "weak"]  # 직접 인용: 일치 · 다른 쪽
    assert by_key["lee2022"][2]["reason"] == "원문은 p.2에 있어요"
    assert by_key["ghost2000"][0]["verdict"] == "unchecked" and by_key["ghost2000"][0]["reason"] == "서재에 없는 인용키예요"
    assert by_key["nopdf2020"][0]["reason"] == "원문(PDF)이 없어요"
    assert by_key["lee2022"][0]["verdict"] == "pending" and 1 <= len(by_key["lee2022"][0]["evidence"]) <= 3
    job = out["job"]
    assert job["kind"] == "verify" and job["manuscript_title"] == "검증 원고" and job["manuscript_id"] == mid
    done = env.wait_job(ca, job["id"])
    assert done["status"] == "succeeded" and done["result"] == {"applied": 1, "remaining": 0}
    got = ca.get(f"/api/manuscripts/{mid}/verify").json()
    first = got["items"][0]
    assert first["verdict"] == "unsupported" and first["method"] == "ai" and first["reason"] == "근거 후보에 없어요"
    assert first["evidence"][0]["page"] >= 1 and first["evidence"][0]["text"]
    assert got["counts"] == {"unsupported": 1, "supported": 1, "weak": 1, "unchecked": 2} and got["unverified"] == 0
    # AC-V04: 다시 누르면 안 바뀐 문장은 AI에 안 보냄
    calls = len(env.fake_ai.calls)
    again = ca.post(f"/api/manuscripts/{mid}/verify").json()
    assert len(env.fake_ai.calls) == calls and again["job"]["id"] == job["id"]
    ca.patch(f"/api/manuscripts/{mid}", json={"content": content.replace("줄인다", "크게 줄인다")})
    assert ca.get(f"/api/manuscripts/{mid}/verify").json()["unverified"] == 1  # 원고가 바뀜
    env.fake_ai.reply = verify_reply(lambda i: {"id": i, "verdict": "supported", "evidence": 1, "reason": "맞아요"})
    j2 = ca.post(f"/api/manuscripts/{mid}/verify").json()["job"]
    env.wait_job(ca, j2["id"])
    assert env.fake_ai.prompts[-1][1].count("<claim id=") == 1
    assert ca.get(f"/api/manuscripts/{mid}/verify").json()["items"][0]["verdict"] == "supported"


def test_verify_limits_and_no_route(env, project):
    """AC-V05(경로 없음 → 작업 없이 unchecked) · AC-V06(41개 이상이면 40개만)"""
    ca = env.client(env.a)
    pid = env.upload(ca, pdf_with([STRESS]), "a.pdf")["id"]
    sql(project, "update paperlab.papers set citekey = 'k1' where id = %s", (pid,))
    wait_indexed(ca)
    content = "\n".join(f"주장 번호 {i}는 스트레스와 관련이 있다 [@k1]." for i in range(42))
    mid = ca.post("/api/manuscripts", json={"title": "많음", "content": content}).json()["id"]
    out = ca.post(f"/api/manuscripts/{mid}/verify").json()
    assert out["job"] is None and {i["verdict"] for i in out["items"]} == {"unchecked"}
    assert out["items"][0]["reason"] == "AI를 쓸 수 없어 근거 후보만 보여요" and out["items"][0]["evidence"]
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    env.fake_ai.reply = verify_reply(lambda i: {"id": i, "verdict": "weak", "evidence": None, "reason": "약해요"})
    job = ca.post(f"/api/manuscripts/{mid}/verify").json()["job"]
    done = env.wait_job(ca, job["id"])
    assert done["result"] == {"applied": 40, "remaining": 2}
    assert env.fake_ai.prompts[-1][1].count("<claim id=") == 40
    assert ca.get(f"/api/manuscripts/{mid}/verify").json()["counts"] == {"weak": 40, "pending": 2}


# ====================================================================== AI로 찾기 (F01 · F07 · F08 · F10 · L02 · L03)
FIND_SUMMARY = "학업 스트레스는 수면의 질을 낮췄어요 [1][2]. 소진과도 관련이 있었어요 [3]."


def find_reply(system, prompt, schema):
    if schema and "queries" in schema.get("properties", {}):
        return json.dumps({"queries": ["sleep quality", "academic stress", "학업 스트레스"]})
    return FIND_SUMMARY


def test_find_api_path(env, project):
    calls = []
    c = env.make(sources_factory=lambda get: Sources(get, transport=_transport(calls)))
    c.fake_ai.reply = find_reply
    ca = c.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    before = sql(project, "select (select count(*) from paperlab.external_works), (select count(*) from paperlab.citation_edges)")
    assert ca.post("/api/find", json={"question": "x"}).status_code == 400
    r = ca.post("/api/find", json={"question": "대학생 학업 스트레스와 수면"})
    assert r.status_code == 202 and r.json()["job"]["kind"] == "find"
    done = c.wait_job(ca, r.json()["job"]["id"])
    assert done["status"] == "succeeded", done
    res = done["result"]
    assert res["answer"] == FIND_SUMMARY and res["queries"][0] == "sleep quality" and res["warnings"] == []
    assert [s["n"] for s in res["sources"]] == list(range(1, len(res["sources"]) + 1)) and len(res["sources"]) == 8
    assert sorted(h for h, _ in calls).count("api.openalex.org") == 3  # AC-F01
    assert "한국어" in c.fake_ai.prompts[-1][0] and done["question"] == "대학생 학업 스트레스와 수면"
    # AC-F07: 결과 카드 → 서재 추가
    card = {k: v for k, v in res["sources"][0].items() if k not in ("n", "in_library")}
    added = ca.post("/api/papers", json=card).json()["paper"]
    again = c.wait_job(ca, ca.post("/api/find", json={"question": "대학생 학업 스트레스와 수면"}).json()["job"]["id"])
    assert any(s["in_library"] == added["id"] for s in again["result"]["sources"])
    # AC-L02: 공용 캐시 행 수 그대로
    assert sql(project, "select (select count(*) from paperlab.external_works), "
                        "(select count(*) from paperlab.citation_edges)") == before
    # AC-F10: 24시간 뒤 정리에서 params · result 비움
    sql(project, "update paperlab.jobs set finished_at = now() - interval '25 hours' where id = %s", (done["id"],))
    from paperlab import jobs
    with c.app.state.db.user_tx({"sub": env.a.id, "role": "authenticated"}) as lib:
        jobs.sweep(lib)
    row = sql(project, "select params, result from paperlab.jobs where id = %s", (done["id"],))[0]
    assert row == ({}, None)
    assert ca.get(f"/api/jobs/{done['id']}").json()["question"] is None
    # 품질팀 L4: 질문이 지워진 찾기는 다시 시도할 수 없음
    sql(project, "update paperlab.jobs set status = 'failed' where id = %s", (done["id"],))
    r = ca.post(f"/api/jobs/{done['id']}/retry")
    assert r.status_code == 409 and r.json()["code"] == "expired"
    # 검색이 모두 실패 → 작업 실패, 폴백 없음
    c2 = env.make(sources_factory=lambda get: Sources(get, transport=_transport([], s2_status=500, oa_status=500)))
    c2.fake_ai.reply = find_reply
    fail = c2.wait_job(c2.client(env.a), c2.client(env.a).post("/api/find", json={"question": "검색 실패"}).json()["job"]["id"])
    assert fail["status"] == "failed" and fail["error_code"] == "search_failed" and fail["route_index"] == 0


def test_find_cli_two_stages(env, project):
    """AC-F08: 키가 없으면 CLI 두 단계 — 같은 작업 행을 두 번 잡음, 사이 검색은 서버. 다시 잡아도 다시 검색하지 않음"""
    calls = []
    c = env.make(sources_factory=lambda get: Sources(get, transport=_transport(calls)))
    ca = c.client(env.a)
    w = Worker(c, env.a)
    job = ca.post("/api/find", json={"question": "student burnout and sleep"}).json()["job"]
    assert job["runner"] == "cli" and job["status"] == "queued"
    t = w.claim()["job"]
    assert t["kind"] == "find" and t["output"] == "json" and t["json_schema"]["required"] == ["queries"]
    assert w.result(t, text=json.dumps({"queries": ["student burnout", "sleep loss"]})).json()["status"] == "queued"
    deadline = time.monotonic() + 15
    while not sql(project, "select params ? 'candidates' from paperlab.jobs where id = %s", (job["id"],))[0][0]:
        assert time.monotonic() < deadline
        time.sleep(0.1)
    searched = len(calls)
    assert searched == 4
    t2 = w.claim()["job"]
    assert t2["id"] == job["id"] and t2["output"] == "text" and '<source n="1">' in t2["prompt"]
    # 리스를 잃고 다른 PC가 다시 잡아도 다시 검색하지 않음
    sql(project, "update paperlab.jobs set lease_until = now() - interval '1 second' where id = %s", (job["id"],))
    w2 = Worker(c, env.a, name="A2")
    t3 = w2.claim()["job"]
    assert t3["id"] == job["id"] and len(calls) == searched
    assert w2.result(t3, text="번아웃은 수면을 줄였어요 [1]. 학생에게서 그랬어요 [2].").json()["status"] == "succeeded"
    res = ca.get(f"/api/jobs/{job['id']}").json()["result"]
    assert res["answer"].startswith("번아웃은") and res["sources"][0]["n"] == 1
    # 영어 검색어가 없으면 bad_output (자동 재시도 없음)
    j2 = ca.post("/api/find", json={"question": "한국어만"}).json()["job"]
    t4 = w.claim()["job"]
    assert w.result(t4, text=json.dumps({"queries": ["학업", "수면"]})).json()["status"] == "failed"
    assert ca.get(f"/api/jobs/{j2['id']}").json()["error_code"] == "bad_output"


def test_ask_logs_hold_no_content(env, caplog):
    """AC-L01 · L03: 질문 · 제목 · 키가 앱 로그에 없고, 질문은 주소가 아니라 본문에만"""
    import logging
    caplog.set_level(logging.INFO)
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    env.upload(ca, pdf_with([STRESS], "PLANTEDTITLE Stress"), "a.pdf")
    wait_indexed(ca)
    sse(ca, {"scope": "library", "question": "SECRETQUESTION stress"})
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("paperlab"))
    assert '"event": "index"' in text and '"event": "ask"' in text
    for planted in ("SECRETQUESTION", "PLANTEDTITLE", "/rag/"):
        assert planted not in text
    assert all("SECRETQUESTION" not in r.getMessage() for r in caplog.records if r.name == "paperlab.access")
