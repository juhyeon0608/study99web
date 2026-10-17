"""서버 API — 변경 전 시나리오를 테스트 프로젝트 + 가짜 저장소 + 테스트 사용자 토큰으로 (AC-23 · 30 · 36 · 37 · 42 · 53)."""

import json

import pytest

from .conftest import SAMPLE, make_pdf

pytestmark = pytest.mark.db


@pytest.fixture
def client(cloud):
    return cloud.client(cloud.user())


def test_index_and_static(cloud):
    c = cloud.client()
    r = c.get("/")
    assert r.status_code == 200 and "PaperLab" in r.text
    assert c.get("/static/js/app.js").headers["content-type"].startswith("text/javascript")
    assert c.get("/static/vendor/pdfjs/pdf.min.mjs").headers["content-type"].startswith("text/javascript")


def test_me_creates_profile(cloud):
    u = cloud.user()
    c = cloud.client(u)
    me = c.get("/api/me").json()
    assert me["user_id"] == u.id and me["email"] == u.email
    assert c.get("/api/me").json() == me


def test_upload_lookup_and_duplicate(cloud, client):
    """AC-36 · 37: 서명 주소 업로드 → complete"""
    pdf_bytes = make_pdf()
    res = cloud.upload(client, pdf_bytes, "resnet.pdf")
    assert res["matched_by"] == "DOI 10.1109/cvpr.2016.90" and res["title"]
    pid = res["id"]
    p = client.get(f"/api/papers/{pid}").json()
    assert p["has_pdf"] and p["page_count"] == 2 and p["venue"] == "CVPR" and "pdf_path" not in p
    uid = client.get("/api/me").json()["user_id"]
    assert cloud.storage.objects[f"users/{uid}/papers/{pid}.pdf"] == pdf_bytes
    assert not [k for k in cloud.storage.objects if k.startswith(f"incoming/{uid}/")]  # 임시 파일 삭제
    url = client.get(f"/api/papers/{pid}/pdf-url").json()
    assert url["url"].startswith("https://") and url["expires_at"].endswith("+00:00")

    again = cloud.upload(client, pdf_bytes, "copy.pdf")
    assert again["duplicate"] is True
    bad = cloud.upload(client, b"hello", "x.pdf")
    assert bad["error"] == "PDF 파일이 아니에요"
    assert not [k for k in cloud.storage.objects if k.startswith(f"incoming/{uid}/")]

    hits = client.get("/api/papers", params={"q": "shortcut connections"}).json()
    assert hits["total"] == 1


def test_upload_attaches_pdf_to_existing_paper(cloud, client):
    """AC-37: PDF 없는 기존 논문과 일치하면 붙임"""
    pid = client.post("/api/papers", json={"title": "Deep Residual Learning for Image Recognition",
                                           "doi": "10.1109/cvpr.2016.90"}).json()["paper"]["id"]
    res = cloud.upload(client, make_pdf(), "r.pdf")
    assert res["id"] == pid and res["note"] == "이미 있는 항목에 파일을 붙였어요"
    assert client.get(f"/api/papers/{pid}").json()["has_pdf"]


def test_upload_size_limits(cloud, client):
    """AC-40"""
    big = 100 * 1024 * 1024 + 1
    files = client.post("/api/uploads", json={"files": [{"name": "big.pdf", "size": big},
                                                       {"name": "ok.pdf", "size": 10}]}).json()["files"]
    assert files[0]["error"] == "파일이 너무 커요 (100MB 초과)" and "upload_id" in files[1]
    assert client.post("/api/uploads", json={"files": [{"name": "a", "size": 1}] * 21}).status_code == 400
    # 신고는 작게, 실제로는 100MB 초과 → complete에서 오류 + 임시 파일 삭제
    slot = files[1]
    cloud.storage.objects[slot["upload"]["url"].split("/fake-bucket/")[1].split("?")[0]] = b"%PDF" + b"0" * big
    r = client.post(f"/api/uploads/{slot['upload_id']}/complete", json={"name": "ok.pdf"}).json()
    assert r["error"] == "파일이 너무 커요 (100MB 초과)"
    assert not [k for k in cloud.storage.objects if k.startswith("incoming/")]
    assert client.post("/api/uploads/not-a-uuid/complete", json={}).status_code == 404


def test_attach_pdf_flow_and_replace(cloud, client):
    pid = client.post("/api/papers", json=SAMPLE).json()["paper"]["id"]
    slot = client.post(f"/api/papers/{pid}/pdf/upload").json()
    assert cloud.storage.browser_put(slot["upload"]["url"], b"%PDF-1.4 broken") == 200
    assert client.post(f"/api/papers/{pid}/pdf/complete", json={"upload_id": slot["upload_id"]}).status_code == 400
    for title in ("First Title For Test", "Another Title For Test"):
        slot = client.post(f"/api/papers/{pid}/pdf/upload").json()
        data = make_pdf(title=title)
        cloud.storage.browser_put(slot["upload"]["url"], data)
        r = client.post(f"/api/papers/{pid}/pdf/complete", json={"upload_id": slot["upload_id"]})
        assert r.status_code == 200 and r.json()["paper"]["has_pdf"]
    uid = client.get("/api/me").json()["user_id"]
    assert cloud.storage.objects[f"users/{uid}/papers/{pid}.pdf"] == data  # 같은 키에 덮어씀
    assert client.get(f"/api/papers/{pid}/pdf-url").status_code == 200


def test_add_from_search_with_pdf_download(cloud, client):
    """AC-42: URL에서 받은 PDF는 최종 키에 바로"""
    item = client.get("/api/search", params={"q": "attention"}).json()["items"][0]
    assert item["in_library"] is None
    # 5단계 D1: 서버가 받는 주소는 arXiv · 허용 라이선스 OpenAlex 위치뿐 — 여기서는 arXiv 주소로
    r = client.post("/api/papers", json={**item, "download_pdf": True, "pdf_url": "https://arxiv.org/pdf/1706.03762"})
    assert r.status_code == 200 and r.json()["paper"]["has_pdf"]
    pid = r.json()["paper"]["id"]
    uid = client.get("/api/me").json()["user_id"]
    assert ("copy", f"users/{uid}/papers/{pid}.pdf") in cloud.storage.log  # 6단계: 임시 키에 올린 뒤 최종 키로 복사(QA D9b)
    assert client.get("/api/search", params={"q": "attention"}).json()["items"][0]["in_library"] == pid
    assert client.post("/api/papers", json=item).status_code == 409
    p2 = client.post("/api/papers", json={"title": "No pdf yet paper", "pdf_url": "https://arxiv.org/pdf/2101.00001"}).json()["paper"]
    assert client.post(f"/api/papers/{p2['id']}/fetch-pdf").json()["paper"]["has_pdf"]
    p3 = client.post("/api/papers", json={"title": "User typed pdf url", "pdf_url": "https://x.example/z.pdf"}).json()["paper"]
    r = client.post(f"/api/papers/{p3['id']}/fetch-pdf").json()  # 그 밖 주소는 새 탭(D1)
    assert r == {"open_url": "https://x.example/z.pdf", "open_kind": "pdf", "reason": "license_unknown"}


def test_cite_export_import(client):
    pid = client.post("/api/papers", json=SAMPLE).json()["paper"]["id"]
    cite = client.get(f"/api/papers/{pid}/cite").json()
    assert cite["csl"]["type"] == "paper-conference" and cite["issues"] == []
    client.patch(f"/api/papers/{pid}", json={"doi": "", "pages": ""})
    assert client.get(f"/api/papers/{pid}").json()["cite_issues"] == ["쪽"]
    bib = client.post("/api/export", json={"ids": [pid], "format": "bibtex"}).text
    assert "@inproceedings{vaswani2017attention" in bib
    client.delete(f"/api/papers/{pid}")
    client.post("/api/trash/empty")  # 6단계: 휴지통에 있으면 가져오기가 건너뜀(K-40)
    r = client.post("/api/import", files={"file": ("lib.bib", bib.encode(), "text/plain")}).json()
    assert r == {"added": 1, "skipped": 0, "total": 1}
    again = client.post("/api/import", files={"file": ("lib.bib", bib.encode(), "text/plain")}).json()
    assert again["skipped"] == 1
    csl = client.post("/api/csl", json={}).json()
    assert csl["items"][0]["title"] == "Attention Is All You Need"


def test_collections_tags_bulk(client):
    pid = client.post("/api/papers", json=SAMPLE).json()["paper"]["id"]
    cid = client.post("/api/collections", json={"name": "졸업논문"}).json()["id"]
    client.post("/api/papers/bulk", json={"ids": [pid], "action": "add_collection", "value": cid})
    client.post("/api/papers/bulk", json={"ids": [pid], "action": "add_tag", "value": "NLP"})
    client.post("/api/papers/bulk", json={"ids": [pid], "action": "star", "value": True})
    p = client.get(f"/api/papers/{pid}").json()
    assert p["collections"] == [cid] and p["tags"][0]["name"] == "NLP" and p["starred"]
    assert client.get("/api/collections").json()[0]["count"] == 1
    p = client.patch(f"/api/papers/{pid}", json={"tags": ["A", "B"], "status": "done", "rating": 4}).json()
    assert [t["name"] for t in p["tags"]] == ["A", "B"] and p["status"] == "done" and p["rating"] == 4
    assert client.get("/api/stats").json()["done"] == 1


def test_annotations_and_note(client):
    pid = client.post("/api/papers", json=SAMPLE).json()["paper"]["id"]
    a = client.post(f"/api/papers/{pid}/annotations",
                    json={"page": 2, "text": "multi-head", "color": "blue", "rects": [[0.1, 0.1, 0.2, 0.02]]}).json()
    client.patch(f"/api/annotations/{a['id']}", json={"comment": "중요"})
    client.put(f"/api/papers/{pid}/note", json={"content": "## 정리"})
    md = client.get(f"/api/annotations/export/{pid}").text
    assert "> multi-head" in md and "중요" in md and "## 정리" in md


def _events(resp) -> list[dict]:
    return [json.loads(line[6:]) for line in resp.iter_lines() if line.startswith("data: ")]


def test_summary_job_and_chat(cloud, client):
    """2단계: 요약 = 작업(AC-25 — 1단계 AC-53 대체) · 대화 SSE(API 칸, AC-29)"""
    cloud.app.state.runner.start(scan=False)
    assert client.put("/api/settings", json={"anthropic_api_key": "sk-ant-test-key-0001"}).status_code == 200
    pid = cloud.upload(client, make_pdf(), "r.pdf")["id"]
    r = client.post(f"/api/papers/{pid}/summary")
    assert r.status_code == 202 and r.json()["job"]["runner"] == "api"
    job = cloud.wait_job(client, r.json()["job"]["id"])
    assert job["status"] == "succeeded"
    s = client.get(f"/api/papers/{pid}/summary").json()
    assert s["summary"]["data"]["tldr"].endswith("요약") and s["job"]["id"] == job["id"]
    assert client.get(f"/api/papers/{pid}").json()["keywords"] == ["resnet"]

    with client.stream("POST", f"/api/papers/{pid}/chat", json={"question": "몇 쪽?"}) as r:
        events = _events(r)
    assert events[0] == {"type": "delta", "text": "답"}
    assert events[-1]["text"] == "2쪽 논문입니다[1]"
    hist = client.get(f"/api/papers/{pid}/chat").json()
    assert [m["role"] for m in hist] == ["user", "assistant"] and hist[1]["citations"][0]["page"] == 1
    assert events[-1]["id"] == hist[1]["id"]
    assert client.delete(f"/api/papers/{pid}/chat").json() == {"ok": True}
    assert client.get(f"/api/papers/{pid}/chat").json() == []
    import psycopg
    with psycopg.connect(cloud.project.admin_db, autocommit=True) as conn:
        n = conn.execute("select count(*) from paperlab.chat_sessions where paper_id = %s", (pid,)).fetchone()[0]
    assert n == 1


def test_summary_error_saves_nothing(cloud, client):
    """AI 거절(폴백 안 함) → 작업 failed, 저장 없음"""
    cloud.app.state.runner.start(scan=False)
    client.put("/api/settings", json={"anthropic_api_key": "sk-ant-test-key-0001"})
    pid = client.post("/api/papers", json=SAMPLE).json()["paper"]["id"]
    cloud.fake_ai.fail = True
    job = cloud.wait_job(client, client.post(f"/api/papers/{pid}/summary").json()["job"]["id"])
    assert job["status"] == "failed" and job["error_code"] == "api_refusal"
    assert client.get(f"/api/papers/{pid}/summary").json()["summary"] is None


def test_styles_builtin_custom_dependent(client):
    styles = client.get("/api/styles").json()
    ids = [x["id"] for x in styles]
    assert ids[0] == "apa" and "ieee" in ids and "korean-journal-of-radiology" in ids
    assert client.get("/api/styles/apa").text.lstrip().startswith("<?xml")
    assert client.get("/api/styles/..%2Fsecret").status_code == 404

    dependent = (b'<?xml version="1.0" encoding="utf-8"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" '
                 b'default-locale="ko-KR"><info><title>My Journal</title><id>http://www.zotero.org/styles/my-journal</id>'
                 b'<link href="http://www.zotero.org/styles/apa" rel="independent-parent"/></info></style>')
    r = client.post("/api/styles", files={"file": ("my-journal.csl", dependent, "application/xml")}).json()
    assert r["id"] == "my-journal" and r["parent"] == "apa" and r["builtin"] is False
    assert "my-journal" in [x["id"] for x in client.get("/api/styles").json()]
    assert "APA" in client.get("/api/styles/my-journal").text  # 부모(APA) 서식을 보낸다
    assert client.post("/api/styles", files={"file": ("x.csl", b"<html/>", "text/xml")}).status_code == 400
    orphan = dependent.replace(b"styles/apa", b"styles/unknown-parent").replace(b"my-journal", b"orphan")
    assert client.post("/api/styles", files={"file": ("o.csl", orphan, "text/xml")}).status_code == 400
    assert client.delete("/api/styles/apa").status_code == 400
    assert client.delete("/api/styles/my-journal").json() == {"ok": True}


def test_review_regressions(cloud, client):
    a = client.post("/api/papers", json=SAMPLE).json()["paper"]["id"]
    b = client.post("/api/papers", json={"title": "Second paper title here"}).json()["paper"]["id"]
    client.post(f"/api/papers/{a}/open")
    # '최근 연 순' 정렬이 열어 보지 않은 논문을 숨기지 않는다
    assert client.get("/api/papers", params={"sort": "opened"}).json()["total"] == 2
    # 태그 이름을 바꾸면 검색 색인도 바뀐다
    client.patch(f"/api/papers/{a}", json={"tags": ["oldname"]})
    tid = client.get("/api/tags").json()[0]["id"]
    client.patch(f"/api/tags/{tid}", json={"name": "renamedtag"})
    assert client.get("/api/papers", params={"q": "renamedtag"}).json()["total"] == 1
    client.patch(f"/api/papers/{b}", json={"tags": ["Other"]})
    r = client.patch(f"/api/tags/{tid}", json={"name": "other"})  # AC-26
    assert r.status_code == 400 and r.json()["detail"] == "같은 이름의 태그가 이미 있어요"
    # 잘못된 입력은 500이 아니라 400
    assert client.post("/api/papers/bulk", json={"ids": [a], "action": "add_collection", "value": None}).status_code == 400


def test_compose_limit(client):
    """AC-30: compose 30MB 초과 → 400"""
    big = b"PK" + b"0" * (30 * 1024 * 1024)
    r = client.post("/api/compose/scan", files={"file": ("a.docx", big, "application/octet-stream")})
    assert r.status_code == 400 and r.json()["detail"] == "파일이 너무 커요 (30MB 초과)"


def test_folder_db_check_violation_is_400(cloud, monkeypatch):
    """승인자 L1: 서버 검사를 지나도(여기서는 일부러 끔) DB CHECK에 걸리는 이름은 500이 아니라 400, 다음 요청은 정상.
    (U+2028 · U+2029는 DB 로캘에 따라 [:cntrl:] 판정이 달라 서버 검사 단위 테스트에서 확인 — test_folder_name_rules)"""
    name = "ctrl\x01x"
    from paperlab import server as server_mod
    monkeypatch.setattr(server_mod, "folder_name_problem", lambda n: "")
    c = cloud.client(cloud.user())
    r = c.post("/api/folders", json={"name": name})
    assert r.status_code == 400, r.text
    fid = c.post("/api/folders", json={"name": "정상 폴더"}).json()["id"]
    r = c.patch(f"/api/folders/{fid}", json={"name": name})
    assert r.status_code == 400, r.text
    assert [f["name"] for f in c.get("/api/folders").json()] == ["정상 폴더"]


# ====================================================================== 전체 오류 점검 (QA1) 회귀 시험
def test_file_name_race_retries_then_409(cloud, monkeypatch):
    """QA D3: 이름 겹침 경합(유일 색인 23505)은 저장점에서 한 번 더 → 성공, 두 번 다 겹치면 500이 아니라 409"""
    from paperlab.db import Library
    c = cloud.client(cloud.user())
    fid = c.post("/api/folders", json={"name": "Race"}).json()["id"]
    a = cloud.upload(c, make_pdf(title="Race Name Paper One Title", doi=""), "same.pdf", folder_id=fid)["id"]
    b = cloud.upload(c, make_pdf(title="Race Name Paper Two Title", doi=""), "same.pdf")["id"]
    real = Library.free_name
    calls = {"n": 0, "stale": 1}

    def stale_free_name(self, folder_id, name, *args, **kw):
        calls["n"] += 1
        if calls["n"] <= calls["stale"]:
            return "same.pdf"  # 다른 요청이 같은 이름을 먼저 쓴 것처럼 (검사 뒤 · 쓰기 전)
        return real(self, folder_id, name, *args, **kw)

    monkeypatch.setattr(Library, "free_name", stale_free_name)
    r = c.post("/api/papers/bulk", json={"ids": [b], "action": "move_folder", "value": fid})
    assert r.status_code == 200, r.text
    names = {p["id"]: p["file_name"] for p in c.get("/api/papers", params={"folder": fid}).json()["items"]}
    assert names == {a: "same.pdf", b: "same (2).pdf"}
    c.post("/api/papers/bulk", json={"ids": [b], "action": "move_folder", "value": None})
    calls.update(n=0, stale=99)
    r = c.post("/api/papers/bulk", json={"ids": [b], "action": "move_folder", "value": fid})
    assert r.status_code == 409 and "같은 이름" in r.json()["detail"]
    assert c.get(f"/api/papers/{b}").json()["folder_id"] is None  # 롤백


def test_failed_upload_leaves_no_r2_objects(cloud, monkeypatch):
    """QA D8 · D9b: 새 논문에 붙인 뒤 요청이 실패(롤백)하면 최종 PDF · 임시 파일을 지운다. 메타데이터 조회 예외도 같음"""
    from paperlab.db import Library
    u = cloud.user()
    c = cloud.client(u)
    cid = c.post("/api/collections", json={"name": "C"}).json()["id"]

    def boom(*a, **kw):
        raise RuntimeError("boom")

    monkeypatch.setattr(Library, "set_paper_collections", boom)  # attach 뒤에 실패
    data = make_pdf(title="Rollback Upload Paper Title", doi="")
    slot = c.post("/api/uploads", json={"files": [{"name": "x.pdf", "size": len(data)}]}).json()["files"][0]
    assert cloud.storage.browser_put(slot["upload"]["url"], data) == 200
    from fastapi.testclient import TestClient
    quiet = TestClient(cloud.app, headers=dict(c.headers), raise_server_exceptions=False)
    r = quiet.post(f"/api/uploads/{slot['upload_id']}/complete", json={"name": "x.pdf", "collection_id": cid})
    assert r.status_code == 500
    assert [k for k in cloud.storage.objects if k.startswith((f"users/{u.id}/", f"incoming/{u.id}/"))] == []
    assert c.get("/api/papers").json()["total"] == 0
    monkeypatch.undo()
    # 메타데이터 조회가 예외로 끝나도 임시 파일을 남기지 않음 (QA D9b)
    cloud.app.state.sources_factory = lambda get: type("S", (), {"lookup_doi": boom, "lookup_arxiv": boom,
                                                                   "match_title": boom})()
    slot = c.post("/api/uploads", json={"files": [{"name": "y.pdf", "size": len(data)}]}).json()["files"][0]
    assert cloud.storage.browser_put(slot["upload"]["url"], data) == 200
    r = quiet.post(f"/api/uploads/{slot['upload_id']}/complete", json={"name": "y.pdf"})
    assert r.status_code == 500
    assert [k for k in cloud.storage.objects if k.startswith(f"incoming/{u.id}/")] == []


def test_bad_pdf_message_has_no_exception_text(cloud, client):
    """QA D5: 손상된 PDF는 고정 문구(예외 내용 없음) · 임시 파일 지움"""
    pid = cloud.upload(client, make_pdf(title="Bad Replace Paper Title", doi=""), "r.pdf")["id"]
    bad = b"%PDF-1.4 garbage that is not a pdf"
    slot = client.post(f"/api/papers/{pid}/pdf/upload").json()
    assert cloud.storage.browser_put(slot["upload"]["url"], bad) == 200
    r = client.post(f"/api/papers/{pid}/pdf/complete", json={"upload_id": slot["upload_id"]})
    assert r.status_code == 400 and r.json()["detail"] == "PDF를 열 수 없어요. 손상되었거나 암호가 걸린 파일인지 확인해 주세요"
    assert not any(k.endswith(slot["upload_id"] + ".pdf") for k in cloud.storage.objects)
    slot = client.post("/api/uploads", json={"files": [{"name": "b.pdf", "size": len(bad)}]}).json()["files"][0]
    assert cloud.storage.browser_put(slot["upload"]["url"], bad) == 200
    out = client.post(f"/api/uploads/{slot['upload_id']}/complete", json={"name": "b.pdf"}).json()
    assert out["error"] == "PDF를 열 수 없어요. 손상되었거나 암호가 걸린 파일인지 확인해 주세요"


def test_add_paper_db_error_is_not_swallowed(cloud, monkeypatch):
    """QA D5: PDF 받아 붙이기 중 DB 오류를 경고로 삼키고 깨진 트랜잭션에서 get_paper를 부르지 않는다(→ 500).
    저장소 오류는 지금처럼 경고"""
    from fastapi.testclient import TestClient

    from paperlab.db import Library
    from paperlab.storage import StorageError
    c = cloud.client(cloud.user())
    body = dict(SAMPLE, title="Db Error Download Paper", doi="", download_pdf=True, pdf_url="https://arxiv.org/pdf/1706.03762")
    real_copy = cloud.storage.copy

    def broken_copy(src, dst):
        raise StorageError("x")

    cloud.storage.copy = broken_copy
    try:
        r = c.post("/api/papers", json=body)
    finally:
        cloud.storage.copy = real_copy
    assert r.status_code == 200 and r.json()["warning"].endswith("저장소 오류") and not r.json()["paper"]["has_pdf"]
    assert not any(k.startswith("incoming/") for k in cloud.storage.objects)  # 임시 파일도 지움

    def db_error(self, *a, **kw):
        self._x("select 1/0")

    monkeypatch.setattr(Library, "set_pdf", db_error)
    quiet = TestClient(cloud.app, headers=dict(c.headers), raise_server_exceptions=False)
    r = quiet.post("/api/papers", json=dict(body, title="Db Error Download Paper Two"))
    assert r.status_code == 500 and "division" not in r.text


def test_status_and_tag_color_validation(client):
    """웹 점검 L-1 · L-3: 읽기 상태는 STATUSES만, 태그 색은 #RRGGBB 또는 빈 값"""
    pid = client.post("/api/papers", json=dict(SAMPLE, title="Validation Paper Title")).json()["paper"]["id"]
    assert client.patch(f"/api/papers/{pid}", json={"status": "bogus"}).status_code == 400
    assert client.patch(f"/api/papers/{pid}", json={"status": "done"}).json()["status"] == "done"
    assert client.post("/api/papers/bulk", json={"ids": [pid], "action": "status", "value": "x"}).status_code == 400
    for bad in (["done"], {"a": 1}):  # 해시 불가 값도 500이 아니라 400 (승인자 남은 위험 1)
        assert client.patch(f"/api/papers/{pid}", json={"status": bad}).status_code == 400
        assert client.post("/api/papers/bulk", json={"ids": [pid], "action": "status", "value": bad}).status_code == 400
    client.patch(f"/api/papers/{pid}", json={"tags": ["colored"]})
    tid = client.get("/api/tags").json()[0]["id"]
    for bad in ("red", "#12345", "#1234567", "#GGGGGG", 5, "#123456\n"):
        assert client.patch(f"/api/tags/{tid}", json={"color": bad}).status_code == 400, bad
    assert client.patch(f"/api/tags/{tid}", json={"color": "#A0b1C2"}).status_code == 200
    assert client.get("/api/tags").json()[0]["color"] == "#A0b1C2"
    assert client.patch(f"/api/tags/{tid}", json={"color": ""}).status_code == 200


def test_system_sizes_never_opened_inside_user_tx(cloud, monkeypatch):
    """QA D7: 저장 공간 합계(system_tx)를 사용자 트랜잭션을 연 채로 열지 않는다(연결 두 개 — 풀 고갈 교착).
    순서대로 보내는 요청이므로, 동시에 열린 트랜잭션이 둘 이상이면 같은 요청이 두 개를 잡은 것"""
    from contextlib import contextmanager

    db = cloud.app.state.db
    real_tx = type(db)._tx
    state = {"open": 0, "max": 0}

    @contextmanager
    def counting_tx(self, *a, **kw):
        state["open"] += 1
        state["max"] = max(state["max"], state["open"])
        try:
            with real_tx(self, *a, **kw) as conn:
                yield conn
        finally:
            state["open"] -= 1

    c = cloud.client(cloud.user())
    pid = cloud.upload(c, make_pdf(title="Two Connections Paper Title", doi=""), "t.pdf")["id"]
    monkeypatch.setattr(type(db), "_tx", counting_tx)
    assert c.get("/api/storage/usage").status_code == 200
    assert c.post("/api/uploads", json={"files": [{"name": "x.pdf", "size": 10}]}).status_code == 200
    assert c.post(f"/api/papers/{pid}/pdf/upload").status_code == 200
    assert state["max"] == 1


def test_delete_folder_with_same_name_child(client):
    """ponytail 4 (폴더 " (n)" 도우미): 지울 폴더와 이름이 같은 하위 폴더를 부모로 올려도 유일 색인 위반(500)이 아니라 ` (2)`"""
    top = client.post("/api/folders", json={"name": "Dup"}).json()["id"]
    client.post("/api/folders", json={"name": "Dup", "parent_id": top})
    client.post("/api/folders", json={"name": "Other", "parent_id": top})
    r = client.delete(f"/api/folders/{top}")
    assert r.status_code == 200, r.text
    assert sorted(f["name"] for f in client.get("/api/folders").json()) == ["Dup (2)", "Other"]
