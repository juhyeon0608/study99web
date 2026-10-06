import json
import time

import pytest
from fastapi.testclient import TestClient

from paperlab import ai as ai_mod
from paperlab.server import create_app
from paperlab.sources import SourceError

from .conftest import SAMPLE, make_pdf


class FakeSources:
    def lookup_doi(self, doi):
        if doi == "10.1109/cvpr.2016.90":
            return {"title": "Deep Residual Learning for Image Recognition", "doi": doi, "year": 2016,
                    "authors": [{"given": "Kaiming", "family": "He"}], "venue": "CVPR", "item_type": "conference"}
        raise SourceError("없음")

    def lookup_arxiv(self, arxiv_id):
        raise SourceError("없음")

    def match_title(self, title):
        return None

    def resolve(self, text):
        return dict(SAMPLE, source="openalex")

    def search(self, *a, **kw):
        return {"items": [dict(SAMPLE, source="openalex")], "total": 1}

    def download_pdf(self, url):
        return make_pdf(title="Downloaded Paper Title Here", doi="")


class FakeAI:
    def status(self):
        return {"engine": "api", "ready": True, "message": ""}

    def summarize(self, ctx, progress):
        progress("작성 중", 0.5)
        return ai_mod.normalize_summary({"tldr": f"{ctx.title} 요약", "keywords": ["resnet"]})

    def chat(self, ctx, history, question):
        yield {"type": "delta", "text": "답"}
        yield {"type": "done", "text": f"{len(ctx.page_texts)}쪽 논문입니다[1]",
               "citations": [{"n": 1, "page": 1, "end_page": 1, "text": "residual"}]}


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path, sources=FakeSources(), ai=FakeAI())
    return TestClient(app, headers={"X-PaperLab": "1"})


def test_rejects_foreign_host_and_origin(client):
    assert client.get("/api/health", headers={"host": "evil.example"}).status_code == 403
    assert client.post("/api/collections", json={"name": "x"},
                       headers={"origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/collections", json={"name": "x"},
                       headers={"origin": "http://127.0.0.1:8765"}).status_code == 200
    # 샌드박스 iframe의 Origin: null, 사용자 정의 헤더 없는 폼 전송은 막는다
    assert client.post("/api/upload", files=[("files", ("a.pdf", make_pdf(), "application/pdf"))],
                       headers={"origin": "null"}).status_code == 403
    assert client.post("/api/collections", json={"name": "x"}, headers={"X-PaperLab": ""}).status_code == 403
    assert client.get("/api/health", headers={"X-PaperLab": ""}).status_code == 200


def test_index_served(client):
    r = client.get("/")
    assert r.status_code == 200 and "PaperLab" in r.text


def test_upload_lookup_and_duplicate(client):
    pdf_bytes = make_pdf()
    r = client.post("/api/upload", files=[("files", ("resnet.pdf", pdf_bytes, "application/pdf"))])
    [res] = r.json()["results"]
    assert res["matched_by"] == "DOI 10.1109/cvpr.2016.90"
    p = client.get(f"/api/papers/{res['id']}").json()
    assert p["has_pdf"] and p["page_count"] == 2 and p["venue"] == "CVPR"
    assert client.get(f"/api/papers/{res['id']}/pdf").content == pdf_bytes

    again = client.post("/api/upload", files=[("files", ("copy.pdf", pdf_bytes, "application/pdf"))]).json()
    assert again["results"][0]["duplicate"] is True
    bad = client.post("/api/upload", files=[("files", ("x.pdf", b"hello", "application/pdf"))]).json()
    assert "PDF 파일이 아니에요" in bad["results"][0]["error"]

    hits = client.get("/api/papers", params={"q": "shortcut connections"}).json()
    assert hits["total"] == 1


def test_add_from_search_with_pdf_download(client):
    item = client.get("/api/search", params={"q": "attention"}).json()["items"][0]
    assert item["in_library"] is None
    r = client.post("/api/papers", json={**item, "download_pdf": True, "pdf_url": "https://x/y.pdf"})
    assert r.status_code == 200 and r.json()["paper"]["has_pdf"]
    assert client.get("/api/search", params={"q": "attention"}).json()["items"][0]["in_library"] == r.json()["paper"]["id"]
    assert client.post("/api/papers", json=item).status_code == 409


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


def test_summary_job_and_chat(client):
    pid = client.post("/api/upload", files=[("files", ("r.pdf", make_pdf(), "application/pdf"))]).json()["results"][0]["id"]
    job = client.post(f"/api/papers/{pid}/summary").json()
    for _ in range(50):
        j = client.get(f"/api/jobs/{job['id']}").json()
        if j["status"] != "running":
            break
        time.sleep(0.05)
    assert j["status"] == "done", j
    s = client.get(f"/api/papers/{pid}/summary").json()["summary"]
    assert s["data"]["tldr"].endswith("요약")
    assert client.get(f"/api/papers/{pid}").json()["keywords"] == ["resnet"]

    with client.stream("POST", f"/api/papers/{pid}/chat", json={"question": "몇 쪽?"}) as r:
        events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    assert events[0] == {"type": "delta", "text": "답"}
    assert events[-1]["text"] == "2쪽 논문입니다[1]"
    hist = client.get(f"/api/papers/{pid}/chat").json()
    assert [m["role"] for m in hist] == ["user", "assistant"] and hist[1]["citations"][0]["page"] == 1


def test_static_mime_types(client):
    assert client.get("/static/js/app.js").headers["content-type"].startswith("text/javascript")
    assert client.get("/static/vendor/pdfjs/pdf.min.mjs").headers["content-type"].startswith("text/javascript")


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
    assert "APA" in client.get("/api/styles/my-journal").text  # 부모(APA) 서식을 보낸다
    assert client.post("/api/styles", files={"file": ("x.csl", b"<html/>", "text/xml")}).status_code == 400
    orphan = dependent.replace(b"styles/apa", b"styles/unknown-parent").replace(b"my-journal", b"orphan")
    assert client.post("/api/styles", files={"file": ("o.csl", orphan, "text/xml")}).status_code == 400
    assert client.delete("/api/styles/apa").status_code == 400
    assert client.delete("/api/styles/my-journal").json() == {"ok": True}


def test_review_regressions(client):
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
    assert client.patch(f"/api/tags/{tid}", json={"name": "other"}).status_code == 400
    # 잘못된 입력은 500이 아니라 400
    assert client.post("/api/papers/bulk", json={"ids": [a], "action": "add_collection", "value": None}).status_code == 400
    assert client.post(f"/api/papers/{a}/pdf", files={"file": ("x.pdf", b"%PDF-1.4 broken", "application/pdf")}).status_code == 400
    # PDF 교체 후에도 파일이 남아 있다
    client.post(f"/api/papers/{a}/pdf", files={"file": ("x.pdf", make_pdf(), "application/pdf")})
    client.post(f"/api/papers/{a}/pdf", files={"file": ("y.pdf", make_pdf(title="Another Title For Test"), "application/pdf")})
    assert client.get(f"/api/papers/{a}/pdf").status_code == 200
