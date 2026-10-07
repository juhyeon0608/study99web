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
    assert res["id"] == pid and res["note"] == "이미 있는 논문에 PDF를 붙였어요"
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
    r = client.post("/api/papers", json={**item, "download_pdf": True, "pdf_url": "https://x/y.pdf"})
    assert r.status_code == 200 and r.json()["paper"]["has_pdf"]
    pid = r.json()["paper"]["id"]
    uid = client.get("/api/me").json()["user_id"]
    assert ("put", f"users/{uid}/papers/{pid}.pdf") in cloud.storage.log
    assert client.get("/api/search", params={"q": "attention"}).json()["items"][0]["in_library"] == pid
    assert client.post("/api/papers", json=item).status_code == 409
    p2 = client.post("/api/papers", json={"title": "No pdf yet paper", "pdf_url": "https://x/z.pdf"}).json()["paper"]
    assert client.post(f"/api/papers/{p2['id']}/fetch-pdf").json()["paper"]["has_pdf"]


def test_cite_export_import(client):
    pid = client.post("/api/papers", json=SAMPLE).json()["paper"]["id"]
    cite = client.get(f"/api/papers/{pid}/cite").json()
    assert cite["csl"]["type"] == "paper-conference" and cite["issues"] == []
    client.patch(f"/api/papers/{pid}", json={"doi": "", "pages": ""})
    assert client.get(f"/api/papers/{pid}").json()["cite_issues"] == ["쪽"]
    bib = client.post("/api/export", json={"ids": [pid], "format": "bibtex"}).text
    assert "@inproceedings{vaswani2017attention" in bib
    client.delete(f"/api/papers/{pid}")
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


def test_summary_stream_and_chat(cloud, client):
    """AC-53 · AC-29"""
    pid = cloud.upload(client, make_pdf(), "r.pdf")["id"]
    with client.stream("POST", f"/api/papers/{pid}/summary") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        events = _events(r)
    assert events[0]["type"] == "progress" and events[-1]["type"] == "done"
    assert events[-1]["summary"]["data"]["tldr"].endswith("요약")
    s = client.get(f"/api/papers/{pid}/summary").json()
    assert s["summary"]["data"]["tldr"].endswith("요약") and s["job"] is None
    assert client.get(f"/api/papers/{pid}").json()["keywords"] == ["resnet"]

    with client.stream("POST", f"/api/papers/{pid}/chat", json={"question": "몇 쪽?"}) as r:
        events = _events(r)
    assert events[0] == {"type": "delta", "text": "답"}
    assert events[-1]["text"] == "2쪽 논문입니다[1]"
    hist = client.get(f"/api/papers/{pid}/chat").json()
    assert [m["role"] for m in hist] == ["user", "assistant"] and hist[1]["citations"][0]["page"] == 1
    assert client.delete(f"/api/papers/{pid}/chat").json() == {"ok": True}
    assert client.get(f"/api/papers/{pid}/chat").json() == []
    import psycopg
    with psycopg.connect(cloud.project.admin_db, autocommit=True) as conn:
        n = conn.execute("select count(*) from paperlab.chat_sessions where paper_id = %s", (pid,)).fetchone()[0]
    assert n == 1


def test_summary_error_saves_nothing(cloud, client):
    """AC-53: 가짜 AI 오류 → error 이벤트, 저장 없음"""
    pid = client.post("/api/papers", json=SAMPLE).json()["paper"]["id"]
    cloud.fake_ai.fail = True
    with client.stream("POST", f"/api/papers/{pid}/summary") as r:
        events = _events(r)
    assert events[-1]["type"] == "error"
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
