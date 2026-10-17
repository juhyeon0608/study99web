"""서재에 문서 · 이미지 넣기 [db] — 업로드 → PDF 변환본 + 원본 보관 → [원본 받기] · 교체 · 휴지통 · 동기화.

저장소는 FakeStorage. 워드 · 한글 · PPT는 LibreOffice가 있을 때만(서버 PC 조건), 사진(PNG)은 늘 돈다.
변환 단위 테스트는 test_convert.py.
"""

from __future__ import annotations

import pytest

from paperlab import convert
from paperlab.server import DOC_ONLY, IMAGE_NO_TEXT

from .conftest import SAMPLE, make_pdf
from .test_convert import make_docx, make_hwpx, make_png, make_pptx, needs_soffice
from .test_sync_api import PC, ab, env, sha  # noqa: F401 - 픽스처(env · ab)를 이 모듈에서도 씀

pytestmark = pytest.mark.db


@pytest.fixture
def client(cloud):
    return cloud.client(cloud.user())


def uid_of(client) -> str:
    return client.get("/api/me").json()["user_id"]


def source_keys(cloud, uid: str) -> list[str]:
    return [k for k in cloud.storage.objects if k.startswith(f"users/{uid}/sources/")]


def put_attach(cloud, client, pid: int, data: bytes, name: str | None):
    slot = client.post(f"/api/papers/{pid}/pdf/upload").json()
    assert cloud.storage.browser_put(slot["upload"]["url"], data) == 200
    body = {"upload_id": slot["upload_id"]}
    if name is not None:
        body["name"] = name
    return client.post(f"/api/papers/{pid}/pdf/complete", json=body)


def test_image_upload_keeps_original(cloud, client):
    png = make_png()
    res = cloud.upload(client, png, "칠판 사진.png")
    assert res["matched_by"] == DOC_ONLY and res["title"] == "칠판 사진" and res["warnings"] == [IMAGE_NO_TEXT]
    pid, uid = res["id"], uid_of(client)
    p = client.get(f"/api/papers/{pid}").json()
    assert p["has_pdf"] and p["has_source"] and p["item_type"] == "document" and p["cite_issues"] == []
    assert p["source_name"] == "칠판 사진.png" and p["source_size"] == len(png) and "source_key" not in p
    assert p["file_name"] == "칠판 사진.png"  # PC 동기화 이름 = 원본 그대로 (선택 동기화 D-8)
    [skey] = source_keys(cloud, uid)
    assert cloud.storage.objects[skey] == png
    assert cloud.storage.objects[f"users/{uid}/papers/{pid}.pdf"].startswith(b"%PDF")
    assert not [k for k in cloud.storage.objects if k.startswith(f"incoming/{uid}/")]  # 원본 · 변환본 임시 파일 모두
    r = client.get(f"/api/papers/{pid}/source-url").json()
    assert r["url"].startswith("https://") and r["name"] == "칠판 사진.png" and ("sign_get", skey) in cloud.storage.log
    assert client.get(f"/api/papers/{pid}/pdf-url").status_code == 200  # 읽기 화면은 변환본
    # 같은 이름의 다른 문서를 또 올려도 다른 문서(문서는 제목으로 중복을 보지 않음)
    again = cloud.upload(client, make_png(410, 200), "칠판 사진.png")
    assert again["id"] != pid and not again.get("duplicate")
    assert len(source_keys(cloud, uid)) == 2
    # 같은 원본 파일(해시)은 중복 — 원본 해시 = PC 표현 해시 (선택 동기화 5.5절)
    assert cloud.upload(client, png, "다른 이름.png")["duplicate"] is True


def test_document_never_title_matches_papers(cloud, client):
    """문서는 제목(= 파일 이름)으로 논문과 짝짓지 않는다 — 양쪽 다"""
    # ① 문서를 먼저 넣고 같은 제목의 논문 PDF를 올림 → 새 논문(문서를 중복으로 보지 않음)
    title = "Deep Residual Learning for Image Recognition"
    doc = cloud.upload(client, make_png(), f"{title}.png")
    assert doc["title"] == title
    pdf = cloud.upload(client, make_pdf(title=title, doi=""), "resnet.pdf")
    assert pdf["id"] != doc["id"] and not pdf.get("duplicate")
    # ② PDF 없는 논문이 있어도 같은 이름의 문서가 거기에 붙지 않음
    other = "Identity Mappings in Deep Residual Networks"
    paper = client.post("/api/papers", json={"title": other}).json()["paper"]["id"]
    doc2 = cloud.upload(client, make_png(401, 200), f"{other}.png")  # 다른 사진(같은 사진이면 해시로 중복 — 5.5절)
    assert doc2["id"] != paper and "note" not in doc2
    assert not client.get(f"/api/papers/{paper}").json()["has_pdf"]
    # ③ 문서는 제목으로 논문 정보를 찾지 않는다(온라인 정보로 채우기 — DOI · arXiv만). 찾으면 덮어씀
    r = client.post(f"/api/papers/{doc['id']}/refresh", json={})
    assert r.status_code == 404 and "DOI나 arXiv" in r.json()["detail"]
    r = client.post(f"/api/papers/{doc['id']}/refresh", json={"identifier": "1706.03762"})
    assert r.status_code == 200 and r.json()["item_type"] == SAMPLE["item_type"] and r.json()["title"] == SAMPLE["title"]
    assert r.json()["has_source"]  # 원본은 그대로


def test_unsupported_files_and_source_404(cloud, client):
    for data, name in ((b"MZ\x90\x00" * 10, "setup.exe"), (b"hello", "보고서.docx"), (b"<html></html>", "a.png")):
        assert cloud.upload(client, data, name)["error"] == convert.NOT_SUPPORTED
    assert cloud.upload(client, b"hello", "x.pdf")["error"] == "PDF 파일이 아니에요"
    pid = client.post("/api/papers", json=SAMPLE).json()["paper"]["id"]
    # 이름 없이(옛 화면 · 다른 도구) 사진을 붙이면 예전처럼 PDF만
    r = put_attach(cloud, client, pid, make_png(), None)
    assert r.status_code == 400 and r.json()["detail"] == "PDF 파일이 아니에요"
    r = put_attach(cloud, client, pid, b"hello", "메모.hwp")
    assert r.status_code == 400 and r.json()["detail"] == convert.NOT_SUPPORTED
    uid = uid_of(client)
    assert not [k for k in cloud.storage.objects if k.startswith(f"incoming/{uid}/")]
    r = client.get(f"/api/papers/{pid}/source-url")
    assert r.status_code == 404 and r.json()["detail"] == "원본 파일이 없어요"
    assert client.get("/api/papers/999999999/source-url").status_code == 404
    other = cloud.client(cloud.user())
    assert other.get(f"/api/papers/{pid}/source-url").status_code == 404


def test_replace_trash_usage_and_purge(cloud, client):
    uid = uid_of(client)
    png = make_png(300, 300)
    pid = cloud.upload(client, png, "스캔.png")["id"]
    [first] = source_keys(cloud, uid)
    # 다른 사진으로 바꾸기 → 새 원본, 옛 원본은 커밋 뒤 삭제
    png2 = make_png(320, 200)
    r = put_attach(cloud, client, pid, png2, "다시 찍음.png")
    assert r.status_code == 200 and r.json()["paper"]["has_source"] and r.json()["paper"]["source_name"] == "다시 찍음.png"
    [second] = source_keys(cloud, uid)
    assert second != first and cloud.storage.objects[second] == png2
    # 사용량 = 변환본 + 원본
    pdf_size = len(cloud.storage.objects[f"users/{uid}/papers/{pid}.pdf"])
    assert client.get("/api/storage/usage").json()["mine_bytes"] == pdf_size + len(png2)
    # 휴지통: 원본은 그대로, 크기는 함께
    client.delete(f"/api/papers/{pid}")
    assert second in cloud.storage.objects
    us = client.get("/api/storage/usage").json()
    assert us["mine_bytes"] == 0 and us["trash_bytes"] == pdf_size + len(png2)
    t = client.get("/api/trash").json()
    assert t["total_bytes"] == pdf_size + len(png2) and t["items"][0]["pdf_size"] == pdf_size + len(png2)
    client.post("/api/trash/restore", json={"ids": [pid]})
    # PDF를 바로 붙이면(웹) 옛 원본은 지운다 — 이제 PDF가 원본
    r = put_attach(cloud, client, pid, make_pdf(title="Plain PDF Replacement Title", doi=""), "논문.pdf")
    assert r.status_code == 200 and not r.json()["paper"]["has_source"]
    assert source_keys(cloud, uid) == [] and client.get(f"/api/papers/{pid}/source-url").status_code == 404
    # 다시 사진 → 영구 삭제하면 원본도 저장소에서
    put_attach(cloud, client, pid, png, "스캔.png")
    assert len(source_keys(cloud, uid)) == 1
    client.delete(f"/api/papers/{pid}")
    assert client.post("/api/trash/purge", json={"ids": [pid]}).json() == {"purged": 1}
    assert source_keys(cloud, uid) == [] and f"users/{uid}/papers/{pid}.pdf" not in cloud.storage.objects


@needs_soffice
@pytest.mark.parametrize("name,make,text", [("보고서 v1.2.docx", make_docx, "Conversion Test"),
                                            ("한글 문서.hwpx", make_hwpx, "Conversion Test"),
                                            ("발표.pptx", make_pptx, "Slide Test")])
def test_office_upload(cloud, client, name, make, text):
    data = make()
    res = cloud.upload(client, data, name)
    assert "error" not in res, res
    p = client.get(f"/api/papers/{res['id']}").json()
    assert p["has_source"] and p["item_type"] == "document" and p["source_name"] == name
    assert p["title"] == name.rsplit(".", 1)[0] and p["file_name"] == name  # PC 파일 = 원본 (선택 동기화 D-8)
    assert client.get("/api/papers", params={"q": text}).json()["total"] == 1  # 변환본 본문으로 검색


@needs_soffice
def test_document_with_doi_gets_paper_metadata(cloud, client):
    """문서 안에 DOI가 있으면 그 논문 정보로(제목 검색은 하지 않음)"""
    from paperlab import writer
    data = writer.to_docx([{"type": "paragraph", "runs": [{"text": "My notes. DOI: 10.1109/cvpr.2016.90"}]}])
    res = cloud.upload(client, data, "내 메모.docx")
    assert res["matched_by"] == "DOI 10.1109/cvpr.2016.90"
    p = client.get(f"/api/papers/{res['id']}").json()
    assert p["has_source"] and p["item_type"] != "document" and p["source_name"] == "내 메모.docx"


def test_sync_downloads_original(env, project):
    """선택 동기화 D-8 · 7.1절: PC 폴더 동기화는 원본을 원래 이름 · 확장자로 받고(kind source), PC에서 원본을 고쳐 올리면
    서버가 다시 변환해 원본 · 변환본을 함께 바꾼다(옛 원본은 지움)"""
    pc = PC(env, env.a)
    png = make_png()
    pid = env.upload(env.ca, png, "회의 사진.png")["id"]
    p = env.ca.get(f"/api/papers/{pid}").json()
    assert p["file_name"] == "회의 사진.png"
    item = pc.post("download", {"ids": [pid]})["items"][0]
    assert f"/users/{env.a.id}/sources/" in item["url"] and item["kind"] == "source" and item["sha256"] == sha(png)
    [skey] = [k for k in env.storage.objects if k.startswith(f"users/{env.a.id}/sources/")]
    v2 = make_png(300, 300)
    r = pc.content(pid, v2, item["sha256"])
    assert r["result"] == "replaced" and r["paper"]["sha256"] == sha(v2) and r["paper"]["kind"] == "source"
    [skey2] = [k for k in env.storage.objects if k.startswith(f"users/{env.a.id}/sources/")]
    assert skey2 != skey and env.storage.objects[skey2] == v2
    assert env.ca.get(f"/api/papers/{pid}").json()["source_size"] == len(v2)
    # PC가 PDF가 아닌 파일을 보내면(이름이 .pdf여도) 예전처럼 거절
    r = pc.add(make_png(500, 100), "사진.pdf", status=400)
    assert r["code"] == "bad_pdf"
    env.assert_keys_scoped()
