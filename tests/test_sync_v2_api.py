"""선택 동기화 — 워커 동기화 API v2 [db] (docs/specs/selective-sync.md 7.1절 · 14장 S1x).

가짜 PC(test_sync_api.PC — 머리글 X-PaperLab-Sync: 2) · FakeStorage · 테스트용 Supabase만. 문서는 사진(PNG — LibreOffice 없이
PyMuPDF로 변환)으로 시험한다(워드 · 한글은 test_source_files.py의 needs_soffice 시험).
"""

from __future__ import annotations

import time
import uuid

import pytest

from paperlab import convert

from .conftest import make_pdf
from .test_convert import make_png
from .test_sync_api import PC, ab, env, pdfdoc, sha, sql  # noqa: F401 - 픽스처(env · ab)를 이 모듈에서도 씀

pytestmark = pytest.mark.db


def pc_on(env, user, name="A1", **kw) -> PC:
    pc = PC(env, user, name=name, **kw)
    pc.post("start", {"enabled": True, "root_label": "PaperLab"})
    return pc


def local_folder(env, client, name="개인") -> int:
    fid = client.post("/api/folders", json={"name": name}).json()["id"]
    r = client.post(f"/api/folders/{fid}/sync-mode", json={"mode": "local"})
    assert r.status_code == 200, r.text
    return fid


def add_local(pc: PC, data: bytes, name: str, folder_id, status: int = 200, **kw) -> dict:
    return pc.add(data, name, folder_id=folder_id, upload=False, storage="local", status=status, **kw)


def user_keys(env, uid: str) -> set[str]:
    return {k for k in env.storage.objects if k.startswith(f"users/{uid}/")}


def snapshot_papers(pc: PC) -> dict[int, dict]:
    return {p["id"]: p for p in pc.post("snapshot", {})["papers"]}


# ====================================================================== S11 프로토콜 문
def test_protocol_gate_and_start(env, project):
    """AC-S11: 머리글 없음 · 1 → 426(min_app_version 0.4.0 · min_sync_protocol 2), 2 → start에 protocol · exts · device_id"""
    pc = PC(env, env.a)
    r = pc.post("start", {"enabled": True, "root_label": "L"})
    assert r["protocol"] == 2 and r["device_id"] == pc.id and r["exts"] == list(convert.ACCEPT_EXTS)
    assert r["limits"]["max_file_bytes"] == 100 * 1024 * 1024
    assert sql(project, "select protocol from paperlab.sync_devices where device_id = %s", (pc.id,))[0][0] == 2
    for proto in (None, 1):
        old = PC(env, env.a, name=f"old{proto}", app_version="0.3.1", protocol=proto)
        r = old.post("snapshot", {}, status=426)
        assert r["code"] == "update_required" and r["min_app_version"] == "0.4.0" and r["min_sync_protocol"] == 2
        assert "0.4.0" in r["detail"]
    # 업데이트 직후(워커 hello가 app_version을 고치기 전)에도 머리글이 2면 막히지 않는다 (D-7)
    fresh = PC(env, env.a, name="fresh", app_version="0.3.1")
    assert fresh.post("start", {"enabled": True})["protocol"] == 2
    # 웹 연결된 PC: sync.protocol · 이 PC에만 둔 파일 수
    devs = {d["id"]: d for d in env.ca.get("/api/devices").json()}
    assert devs[pc.id]["sync"]["protocol"] == 2 and devs[pc.id]["local_count"] == 0 and devs[pc.id]["local_bytes"] == 0


# ====================================================================== S12 · S13 · S14 · S18 PC 표현 · 로컬 항목
def test_original_representation(env, project):
    """AC-S12 · S13: 원본 항목은 kind source · 원래 이름 · 원본 해시, download는 원본 서명 주소. 해시 모르는 옛 원본은 pdf"""
    pc = pc_on(env, env.a)
    png = make_png(300, 200)
    web = env.upload(env.ca, png, "회의 사진.png")["id"]
    item = snapshot_papers(pc)[web]
    assert item["kind"] == "source" and item["file_name"] == "회의 사진.png" and item["sha256"] == sha(png)
    assert item["size"] == len(png) and item["storage"] == "cloud" and item["holder"] is None and item["pending"] == ""
    d = pc.post("download", {"ids": [web]})["items"][0]
    assert d["kind"] == "source" and f"/users/{env.a.id}/sources/" in d["url"] and d["sha256"] == sha(png)
    # PC가 새 사진을 올림 → 원본 보관 · 변환본 · 이름 그대로 · 해시 = 원본
    png2 = make_png(260, 180)
    r = pc.add(png2, "칠판.png")
    pid = r["paper"]["id"]
    assert r["result"] == "created" and r["paper"]["file_name"] == "칠판.png" and r["paper"]["sha256"] == sha(png2)
    assert r["paper"]["kind"] == "source"
    p = env.ca.get(f"/api/papers/{pid}").json()
    assert p["has_pdf"] and p["has_source"] and p["source_name"] == "칠판.png" and p["title"] == "칠판"
    assert env.storage.objects[f"users/{env.a.id}/papers/{pid}.pdf"].startswith(b"%PDF")
    assert png2 in env.storage.objects.values()
    assert not [k for k in env.storage.objects if k.startswith(f"incoming/{env.a.id}/")]
    # 같은 원본을 다시 넣으면 연결(해시 = 원본)
    assert pc.add(png2, "칠판 복사.png")["result"] == "linked"
    # lookup도 원본 해시로
    found = pc.post("lookup", {"sha256": [sha(png), sha(png2)]})["found"]
    assert found[sha(png)]["id"] == web and found[sha(png2)]["storage"] == "cloud"
    # 서재 문서 기능이 먼저 나가 원본 해시를 모르는 행 → 변환본(pdf) 표현 그대로
    sql(project, "update paperlab.papers set source_sha256 = '', file_name = '회의 사진.pdf' where id = %s", (web,))
    item = snapshot_papers(pc)[web]
    pdf_sha = sql(project, "select pdf_sha256 from paperlab.papers where id = %s", (web,))[0][0]
    assert item["kind"] == "pdf" and item["sha256"] == pdf_sha and item["file_name"] == "회의 사진.pdf"
    assert pc.post("download", {"ids": [web]})["items"][0]["kind"] == "pdf"
    # .pdf 이름인데 PDF가 아님 · 확장자와 내용이 다름 → 올리지 않음
    assert pc.add(make_png(), "사진.pdf", status=400)["code"] == "bad_pdf"
    assert pc.add(b"PK\x03\x04 not really", "사진.png", status=400)["code"] == "bad_format"
    env.assert_keys_scoped()


def test_local_items(env, project):
    """AC-S14 · S18: storage=local → R2 0 · page_texts 0 · 제목 = 확장자 뗀 이름 · 보관 PC. 실효 켬 위치면 409
    upload_required, 올렸는데 실효 끔이면 로컬로(임시 파일 삭제). 스냅숏 · 피드 · lookup 포함, download는 409 local_only"""
    pc = pc_on(env, env.a)
    cur = pc.post("snapshot", {})["cursor"]
    fid = local_folder(env, env.ca)
    before = user_keys(env, env.a.id)
    data = make_png(120, 90)
    r = add_local(pc, data, "개인 사진.png", fid)
    pid = r["paper"]["id"]
    assert r["result"] == "created" and r["paper"]["storage"] == "local" and r["paper"]["kind"] == "local"
    assert r["paper"]["holder"] == pc.id and r["paper"]["sha256"] == sha(data) and r["paper"]["size"] == len(data)
    assert user_keys(env, env.a.id) == before
    assert sql(project, "select count(*) from paperlab.page_texts where paper_id = %s", (pid,))[0][0] == 0
    p = env.ca.get(f"/api/papers/{pid}").json()
    assert p["title"] == "개인 사진" and p["item_type"] == "document" and not p["has_pdf"] and not p["has_source"]
    assert p["sync"]["storage"] == "local" and p["sync"]["holder"]["id"] == pc.id and p["sync"]["local_ai"] == "unsupported"
    assert p["file_name"] == "개인 사진.png"
    # 로컬 PDF도 (pdf_* 에 PC 파일 값)
    doc = pdfdoc("local")
    lp = add_local(pc, doc, "내 메모.pdf", fid)["paper"]
    assert lp["sha256"] == sha(doc) and lp["kind"] == "local"
    # 루트(켬)에 local → 409, 올려서 다시
    r = add_local(pc, make_png(50, 50), "루트.png", None, status=409)
    assert r["code"] == "upload_required" and r["paper_folder_mode"] == "cloud"
    # 끔 폴더에 올림(cloud) → 서버가 로컬로 만들고 임시 파일 삭제
    up = make_png(70, 70)
    r = pc.add(up, "올림.png", folder_id=fid)
    assert r["paper"]["storage"] == "local" and not [k for k in env.storage.objects if k.startswith(f"incoming/{env.a.id}/")]
    # 스냅숏 · 피드 · lookup · download
    snap = snapshot_papers(pc)
    assert snap[pid]["kind"] == "local" and snap[pid]["storage"] == "local" and snap[pid]["holder_gone"] is False
    changes, _ = pc.all_changes(cur)
    ups = {c["id"]: c for c in changes if c["kind"] == "paper" and c["op"] == "upsert"}
    assert ups[pid]["data"]["storage"] == "local" and ups[pid]["data"]["sha256"] == sha(data)
    folders = [c for c in changes if c["kind"] == "folder" and c["id"] == fid]
    assert folders[-1]["data"]["sync_mode"] == "local"
    assert pc.post("lookup", {"sha256": [sha(data)]})["found"][sha(data)]["holder"] == pc.id
    items = pc.post("download", {"ids": [pid]})["items"]
    assert items == [{"id": pid, "status": 409, "code": "local_only", "holder_name": "A1"}]
    # 웹: 열기 · 바꾸기 409 local_only (보관 PC 이름)
    r = env.ca.get(f"/api/papers/{pid}/pdf-url")
    assert r.status_code == 409 and r.json()["code"] == "local_only" and r.json()["holder_name"] == "A1"
    assert env.ca.post(f"/api/papers/{pid}/pdf/upload").status_code == 409
    # 통계 · 폴더 · 연결된 PC
    st = env.ca.get("/api/stats").json()
    assert st["local_only"] == 3 and st["mode_pending"] == 0
    fo = {f["id"]: f for f in env.ca.get("/api/folders").json()}
    assert fo[fid]["sync_mode"] == "local" and fo[fid]["effective_mode"] == "local" and fo[fid]["local_count"] == 3
    dev = {d["id"]: d for d in env.ca.get("/api/devices").json()}[pc.id]
    assert dev["local_count"] == 3 and dev["local_bytes"] == len(data) + len(doc) + len(up)
    assert env.ca.get("/api/storage/usage").json()["local_bytes"] == len(data) + len(doc) + len(up)
    env.assert_keys_scoped()


# ====================================================================== S15 해시 일치 표
def test_hash_match_table(env, project):
    """AC-S15: 켬 linked · 로컬(보관 = 이 기기) linked · local_elsewhere(기록 안 함) · 보관 PC 해지 → adopted · 휴지통 restored"""
    a, b = pc_on(env, env.a, "A1"), pc_on(env, env.a, "B1")
    fid = local_folder(env, env.ca)
    x = make_png(90, 60)
    pid = add_local(a, x, "x.png", fid)["paper"]["id"]
    assert add_local(a, x, "x 다시.png", fid)["result"] == "linked"
    op = str(uuid.uuid4())
    r = add_local(b, x, "x.png", fid, op_id=op)
    assert r["result"] == "local_elsewhere" and r["holder_name"] == "A1" and r["paper"]["id"] == pid
    assert not sql(project, "select 1 from paperlab.sync_ops where op_id = %s", (op,))  # 멱등 기록 안 함
    # 켬 폴더에 같은 파일(B가 올리려 함) → 역시 local_elsewhere(B 파일 그대로)
    assert b.add(x, "x.png")["result"] == "local_elsewhere"
    # A 해지 → B가 넘겨받음(같은 op_id로 다시 보내도 이번에는 adopted)
    r = env.ca.delete(f"/api/devices/{a.id}").json()
    assert r["local_orphaned"] == 1
    p = env.ca.get(f"/api/papers/{pid}").json()
    assert p["sync"]["holder"]["gone"] is True
    r = add_local(b, x, "x.png", fid, op_id=op)
    assert r["result"] == "adopted" and r["paper"]["holder"] == b.id and r["paper"]["holder_gone"] is False
    # 휴지통 → 같은 파일을 다른 기기가 넣으면 restored + 보관 PC = 그 기기
    c = pc_on(env, env.a, "C1")
    env.ca.delete(f"/api/papers/{pid}")
    r = add_local(c, x, "x.png", fid)
    assert r["result"] == "restored" and r["paper"]["holder"] == c.id and r["paper"]["storage"] == "local"
    # 켬 논문은 지금 그대로 linked
    y = pdfdoc("y")
    wid = env.upload(env.ca, y, "y.pdf")["id"]
    assert c.add(y, "y.pdf")["result"] == "linked" and c.add(y, "y2.pdf")["paper"]["id"] == wid


# ====================================================================== S16 로컬 항목 내용
def test_local_content(env, project):
    """AC-S16: 보관 PC만(다른 기기 409 not_holder), 업로드 없이 해시 · 크기 · 시각만, R2 0"""
    a, b = pc_on(env, env.a, "A1"), pc_on(env, env.a, "B1")
    fid = local_folder(env, env.ca)
    v1 = make_png(80, 80)
    pid = add_local(a, v1, "도면.png", fid)["paper"]["id"]
    r = b.content(pid, make_png(81, 81), sha(v1), status=409)
    assert r["code"] == "not_holder"
    before = user_keys(env, env.a.id)
    v2 = make_png(82, 82)
    body = {"op_id": str(uuid.uuid4()), "base_sha256": sha(v1), "sha256": sha(v2), "size": len(v2),
            "mtime_ms": int(time.time() * 1000), "clock_offset_ms": 0}
    r = a.post(f"files/{pid}/content", body)
    assert r["result"] == "replaced" and r["paper"]["sha256"] == sha(v2) and r["paper"]["size"] == len(v2)
    again = a.post(f"files/{pid}/content", body)  # 같은 op_id — 멱등
    assert again["result"] == "replaced" and again["paper"] == r["paper"]
    assert user_keys(env, env.a.id) == before
    # 휴지통에 있던 로컬 항목을 보관 PC가 고쳐 올리면 되살림
    env.ca.delete(f"/api/papers/{pid}")
    v3 = make_png(83, 83)
    r = a.post(f"files/{pid}/content", {**body, "op_id": str(uuid.uuid4()), "base_sha256": sha(v2), "sha256": sha(v3),
                                        "size": len(v3)})
    assert r["result"] == "restored" and r["paper"]["sha256"] == sha(v3)
    # 다른 PC의 file.delete는 로컬 항목을 휴지통에 넣지 않음
    assert b.ops({"type": "file.delete", "id": pid, "base_sha256": sha(v3)})[0]["result"] == "not_holder"
    assert a.ops({"type": "file.delete", "id": pid, "base_sha256": sha(v3)})[0]["result"] == "trashed"


# ====================================================================== S17 원본 항목 충돌
def test_source_conflict_copies_original(env, project):
    """AC-S17: 원본 항목 내용 충돌 — 사본 논문이 원본 · 변환본 · 본문을 모두 가짐, 사본 이름 확장자 유지,
    원래 논문의 옛 원본은 커밋 뒤 삭제"""
    pc = pc_on(env, env.a)
    uid = env.a.id
    p1 = make_png(200, 100)
    pid = env.upload(env.ca, p1, "도면.png")["id"]
    old_key = sql(project, "select source_key from paperlab.papers where id = %s", (pid,))[0][0]
    # 서버가 이김(PC 시각이 1시간 전) → 들어온 내용이 사본
    p2 = make_png(210, 100)
    r = pc.content(pid, p2, sha(b"other base"), mtime_ms=int(time.time() * 1000) - 3600 * 1000)
    assert r["result"] == "conflict" and r["winner"] == "server" and r["paper"]["sha256"] == sha(p1)
    assert r["copy"]["sha256"] == sha(p2) and r["copy"]["file_name"].endswith(".png") and "충돌 사본" in r["copy"]["file_name"]
    # 들어온 쪽이 이김 → 서버의 옛 원본이 사본으로 복사되고 원래 논문은 새 원본, 옛 원본 키는 지움
    p3 = make_png(220, 100)
    r = pc.content(pid, p3, sha(b"other base 2"), mtime_ms=int(time.time() * 1000) + 60 * 1000)
    assert r["result"] == "conflict" and r["winner"] == "incoming" and r["paper"]["sha256"] == sha(p3)
    cid = r["copy"]["id"]
    assert r["copy"]["sha256"] == sha(p1) and r["copy"]["kind"] == "source" and r["copy"]["file_name"].endswith(".png")
    ckey = sql(project, "select source_key from paperlab.papers where id = %s", (cid,))[0][0]
    assert env.storage.objects[ckey] == p1 and old_key not in env.storage.objects
    assert env.storage.objects[f"users/{uid}/papers/{cid}.pdf"].startswith(b"%PDF")
    copy = env.ca.get(f"/api/papers/{cid}").json()
    assert copy["has_source"] and copy["source_name"] == "도면.png"
    # PC가 .pdf로 같은 원본 항목의 내용을 보내지는 않지만, 웹에서 PDF로 바꾸면 PC 표현도 PDF로(이름 확장자도)
    slot = env.ca.post(f"/api/papers/{pid}/pdf/upload").json()
    env.storage.browser_put(slot["upload"]["url"], pdfdoc("swap"))
    env.ca.post(f"/api/papers/{pid}/pdf/complete", json={"upload_id": slot["upload_id"], "name": "도면.pdf"})
    item = snapshot_papers(pc)[pid]
    assert item["kind"] == "pdf" and item["file_name"].endswith(".pdf")
    env.assert_keys_scoped()
