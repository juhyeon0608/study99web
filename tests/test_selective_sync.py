"""선택 동기화 — 데이터 · 전환 · 사용자 API [db] (docs/specs/selective-sync.md 6 · 7.2 · 7.3장, 14장 S0x · S2x · S73).

가짜 PC(test_sync_api.PC — 머리글 X-PaperLab-Sync: 2) · FakeStorage · 테스트용 Supabase만.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import uuid
from pathlib import Path

import psycopg
import pytest

from paperlab import admin

from .test_convert import make_png
from .test_sync_api import PC, ab, env, pdfdoc, sha, sql  # noqa: F401 - 픽스처(env · ab)를 이 모듈에서도 씀

pytestmark = pytest.mark.db
ROOT = Path(__file__).resolve().parent.parent
MIGRATION = ROOT / "supabase" / "migrations" / "20261017000001_selective_sync.sql"


def pc_on(env, user, name="A1", **kw) -> PC:
    pc = PC(env, user, name=name, **kw)
    pc.post("start", {"enabled": True, "root_label": "PaperLab"})
    return pc


def web_pdf(env, client, tag: str) -> tuple[int, bytes]:
    data = pdfdoc(tag)
    return env.upload(client, data, f"{tag}.pdf")["id"], data


def set_mode(client, ids, mode, status=200, **kw) -> dict:
    r = client.post("/api/papers/sync-mode", json={"ids": ids, "mode": mode, **kw})
    assert r.status_code == status, r.text
    return r.json()


def row(project, pid: int, cols: str = "*") -> dict:
    with psycopg.connect(project.admin_db, autocommit=True, prepare_threshold=None) as conn:
        cur = conn.execute(f"select {cols} from paperlab.papers where id = %s", (pid,))
        names = [c.name for c in cur.description]
        r = cur.fetchone()
        return dict(zip(names, r)) if r else {}


def ack(pc: PC, pid: int, digest: str) -> dict:
    return pc.ops({"type": "mode.ack", "id": pid, "sha256": digest})[0]


# ====================================================================== S0x 데이터
def test_migration_rerun_defaults_and_files(env, project):
    """AC-S01: 다시 돌려도 오류 · 변화 없음, 기존 마이그레이션 파일 diff 0, 기존 행 기본값"""
    pid, _ = web_pdf(env, env.ca, "s01")
    for attempt in range(3):  # 다른 시험이 같은 테스트 DB를 쓰는 중이면 잠금 교착이 날 수 있어 다시
        try:
            with psycopg.connect(project.admin_db, autocommit=True, prepare_threshold=None) as conn:
                conn.execute(MIGRATION.read_text(encoding="utf-8"))
            break
        except psycopg.errors.DeadlockDetected:
            if attempt == 2:
                raise
    r = row(project, pid, "sync_mode, storage, local_device_id, mode_pending, mode_requested_by, mode_error, source_sha256")
    assert r == {"sync_mode": "inherit", "storage": "cloud", "local_device_id": None, "mode_pending": "",
                 "mode_requested_by": "", "mode_error": "", "source_sha256": ""}
    try:
        out = subprocess.run(["git", "status", "--porcelain", "--", "supabase/migrations"], cwd=ROOT, capture_output=True,
                             text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        pytest.skip("git 없음")
    changed = [ln for ln in out.splitlines() if not ln.endswith("20261017000001_selective_sync.sql")]
    assert changed == [], changed


def test_constraints_and_triggers(env, project):
    """AC-S02 · S03 · S04 · S05 · S06: 로컬 키 금지 · 대기 일관 · 파일 이름 확장자 · 트리거 관계 열 · page_texts 방어 · FK set null"""
    pc = pc_on(env, env.a)
    pid, _ = web_pdf(env, env.ca, "s02")

    def fails(q, params=()):
        with pytest.raises(psycopg.errors.CheckViolation):
            sql(project, q, params)

    fails("update paperlab.papers set storage = 'local' where id = %s", (pid,))  # pdf_key가 있음
    fails("update paperlab.papers set mode_pending = 'to_cloud' where id = %s", (pid,))  # cloud에 to_cloud
    fails("update paperlab.papers set mode_requested_by = 'device:x' where id = %s", (pid,))
    fails("update paperlab.papers set source_sha256 = 'abc' where id = %s", (pid,))
    for ok in ("보고서.docx", "SLIDES.PPTX", "사진.jpeg", "a.pdf"):
        sql(project, "update paperlab.papers set file_name = %s where id = %s", (ok, pid))
    for bad in ("setup.exe", "바로가기.lnk", "noext", "a.txt"):
        fails("update paperlab.papers set file_name = %s where id = %s", (bad, pid))
    sql(project, "update paperlab.papers set file_name = 's02.pdf' where id = %s", (pid,))

    def rev():
        return row(project, pid, "sync_rev")["sync_rev"]

    r0 = rev()
    sql(project, "update paperlab.papers set sync_mode = 'local' where id = %s", (pid,))
    assert rev() == r0  # 논문 설정만 — 피드에 올리지 않음
    for q in ("update paperlab.papers set mode_pending = 'to_local', local_device_id = %s where id = %s",):
        sql(project, q, (pc.id, pid))
    r1 = rev()
    assert r1 > r0
    sql(project, "update paperlab.papers set source_sha256 = %s where id = %s", ("a" * 64, pid))
    assert rev() > r1
    fid = env.ca.post("/api/folders", json={"name": "F"}).json()["id"]
    f0 = sql(project, "select sync_rev from paperlab.folders where id = %s", (fid,))[0][0]
    sql(project, "update paperlab.folders set sync_mode = 'local' where id = %s", (fid,))
    assert sql(project, "select sync_rev from paperlab.folders where id = %s", (fid,))[0][0] > f0
    # 로컬 항목에 page_texts → 23514
    fid2 = env.ca.post("/api/folders", json={"name": "개인"}).json()["id"]
    env.ca.post(f"/api/folders/{fid2}/sync-mode", json={"mode": "local"})
    lid = pc.add(make_png(40, 40), "l.png", folder_id=fid2, upload=False, storage="local")["paper"]["id"]
    with pytest.raises(psycopg.errors.CheckViolation):
        sql(project, "insert into paperlab.page_texts (user_id, paper_id, page, text) values (%s, %s, 1, 'x')",
            (env.a.id, lid))
    # 기기 행 삭제 → 보관 PC · 고정 작업 열은 null
    jid = sql(project, "insert into paperlab.jobs (user_id, kind, status, runner, engine, route, paper_id, pinned_device_id) "
                       "values (%s, 'summary', 'failed', 'cli', 'claude', '[{\"runner\":\"cli\",\"engine\":\"claude\"}]', "
                       "%s, %s) returning id", (env.a.id, lid, pc.id))[0][0]
    sql(project, "delete from paperlab.devices where id = %s", (pc.id,))
    assert row(project, lid, "local_device_id")["local_device_id"] is None
    assert sql(project, "select pinned_device_id from paperlab.jobs where id = %s", (jid,))[0][0] is None
    p = env.ca.get(f"/api/papers/{lid}").json()
    assert p["sync"]["holder"]["gone"] is True


# ====================================================================== S2x 전환
def test_turn_off_then_ack(env, project):
    """AC-S21 · S22 · S59: 끄기 요청은 대기만, 보관 PC의 mode.ack(해시 일치) 뒤에 R2 · 본문 · 번역 삭제, 정보 · 주석 · AI 기록은 남음"""
    a, b = pc_on(env, env.a, "A1"), pc_on(env, env.a, "B1")
    uid = env.a.id
    pid, data = web_pdf(env, env.ca, "s21")
    key = f"users/{uid}/papers/{pid}.pdf"
    # 정보 · 주석 · AI 기록
    env.ca.put(f"/api/papers/{pid}/note", json={"content": "내 메모 노트"})
    env.ca.post(f"/api/papers/{pid}/annotations", json={"page": 1, "text": "하이라이트한 글", "rects": []})
    env.ca.patch(f"/api/papers/{pid}", json={"tags": ["보관"]})
    sql(project, "insert into paperlab.ai_summaries (paper_id, user_id, data, model, created_at) values (%s, %s, %s, 'm', now())",
        (pid, uid, json.dumps({"tldr": "요약"})))
    tr_key = f"users/{uid}/translations/{pid}.0123abcd.json"
    env.storage.objects[tr_key] = b"{}"
    sql(project, "insert into paperlab.translations (user_id, paper_id, lang, tr_key, page_state) values (%s, %s, 'ko', %s, 'd')",
        (uid, pid, tr_key))
    jid = sql(project, "insert into paperlab.jobs (user_id, kind, status, runner, engine, route, paper_id) values "
                       "(%s, 'explain', 'queued', 'api', 'claude', '[{\"runner\":\"api\",\"engine\":\"claude\"}]', %s) "
                       "returning id", (uid, pid))[0][0]
    # 서버에 있을 때 만든 CLI 요약(보관 PC에 묶이지 않음) — 끄면 함께 멈춤(아무 PC나 잡아 엉뚱한 안내로 실패하지 않게)
    sid = sql(project, "insert into paperlab.jobs (user_id, kind, status, runner, engine, route, paper_id) values "
                       "(%s, 'summary', 'queued', 'cli', 'claude', '[{\"runner\":\"cli\",\"engine\":\"claude\"}]', %s) "
                       "returning id", (uid, pid))[0][0]
    # 보관 PC가 둘 → 골라야 함
    r = set_mode(env.ca, [pid], "local", status=400)
    assert r["code"] == "holder_required" and {c["id"] for c in r["choices"]} == {a.id, b.id}
    dry = set_mode(env.ca, [pid], "local", holder_device_id=a.id, dry_run=True)
    assert dry["dry_run"] and dry["to_local"] == 1 and dry["holder"] == {"id": a.id, "name": "A1"}
    assert dry["freed_bytes"] == len(data) and dry["other_pcs"] == [{"id": b.id, "name": "B1", "files": 1}]
    assert row(project, pid, "mode_pending")["mode_pending"] == ""  # dry_run은 바꾸지 않음
    out = set_mode(env.ca, [pid], "local", holder_device_id=a.id)
    assert {k: out[k] for k in ("to_local", "to_cloud", "cancelled", "unchanged", "no_file")} == \
        {"to_local": 1, "to_cloud": 0, "cancelled": 0, "unchanged": 0, "no_file": 0}
    r = row(project, pid, "storage, mode_pending, local_device_id, mode_requested_by, pdf_key")
    assert r == {"storage": "cloud", "mode_pending": "to_local", "local_device_id": a.id, "mode_requested_by": "web",
                 "pdf_key": key}
    assert key in env.storage.objects and sql(project, "select count(*) from paperlab.page_texts where paper_id = %s", (pid,))[0][0]
    p = env.ca.get(f"/api/papers/{pid}").json()
    assert p["sync"]["pending"] == "to_local" and p["sync"]["effective"] == "local" and not p["sync"]["mismatch"]
    snap = {x["id"]: x for x in a.post("snapshot", {})["papers"]}
    assert snap[pid]["pending"] == "to_local" and snap[pid]["holder"] == a.id and snap[pid]["storage"] == "cloud"
    # 보관 PC가 아닌 기기 · 해시 다름 · 확인 못 함 → 아무것도 안 지움
    assert ack(b, pid, sha(data))["result"] == "not_pending"
    bad = ack(a, pid, "f" * 64)
    assert bad["result"] == "changed" and bad["paper"]["sha256"] == sha(data)
    assert a.ops({"type": "mode.fail", "id": pid, "reason": "missing"})[0]["result"] == "recorded"
    assert env.ca.get(f"/api/papers/{pid}").json()["sync"]["pending_error"] == "missing"
    assert key in env.storage.objects
    # 확인 → 지움
    res = ack(a, pid, sha(data))
    assert res["result"] == "applied" and res["paper"]["storage"] == "local" and res["paper"]["kind"] == "local"
    assert res["paper"]["sha256"] == sha(data)  # PC 파일 기술값은 남음
    assert key not in env.storage.objects and tr_key not in env.storage.objects
    r = row(project, pid, "storage, pdf_key, rag_key, mode_pending, mode_error, pdf_sha256")
    assert r == {"storage": "local", "pdf_key": "", "rag_key": "", "mode_pending": "", "mode_error": "", "pdf_sha256": sha(data)}
    assert sql(project, "select count(*) from paperlab.page_texts where paper_id = %s", (pid,))[0][0] == 0
    assert not sql(project, "select 1 from paperlab.translations where paper_id = %s", (pid,))
    assert sql(project, "select status, error_code from paperlab.jobs where id = %s", (jid,))[0] == ("cancelled", "local_only")
    assert sql(project, "select status, error_code from paperlab.jobs where id = %s", (sid,))[0] == ("cancelled", "local_only")
    p = env.ca.get(f"/api/papers/{pid}").json()
    assert p["note"] == "내 메모 노트" and p["tags"][0]["name"] == "보관" and p["has_summary"] and p["annotation_count"] == 1
    assert env.ca.get(f"/api/papers/{pid}/annotations").json()[0]["text"] == "하이라이트한 글"  # Q-2
    assert env.ca.get("/api/papers", params={"q": "메모"}).json()["total"] == 1  # 메타데이터 검색은 됨
    # 다시 ack — 이제 대기가 아님
    assert ack(a, pid, sha(data))["result"] == "not_pending"
    env.assert_keys_scoped()


def test_turn_on_promote(env, project):
    """AC-S23 · S24: 켜기 요청 → promote(업로드 · 추출) → storage cloud · page_texts · 다른 PC는 받음. 반대 방향은 취소"""
    a = pc_on(env, env.a)
    uid = env.a.id
    pid, data = web_pdf(env, env.ca, "s23")
    set_mode(env.ca, [pid], "local")
    # 반대 방향 요청 = 대기 취소 (지운 것 없음), 같은 방향 반복은 그대로
    out = set_mode(env.ca, [pid], "cloud")
    assert out["cancelled"] == 1 and row(project, pid, "mode_pending, local_device_id") == \
        {"mode_pending": "", "local_device_id": None}
    set_mode(env.ca, [pid], "local")
    assert set_mode(env.ca, [pid], "local")["unchanged"] == 1
    ack(a, pid, sha(data))
    assert row(project, pid, "storage")["storage"] == "local"
    out = set_mode(env.ca, [pid], "cloud")
    assert out["to_cloud"] == 1 and row(project, pid, "mode_pending")["mode_pending"] == "to_cloud"
    out = set_mode(env.ca, [pid], "local")  # 켜는 중 끄기 = 취소
    assert out["cancelled"] == 1 and row(project, pid, "mode_pending")["mode_pending"] == ""
    set_mode(env.ca, [pid], "cloud")

    def promote(pc, body_sha, status=200, **kw):
        body = {"op_id": str(uuid.uuid4()), "upload_id": pc.upload(data), "sha256": body_sha, "size": len(data),
                "mtime_ms": 0, "clock_offset_ms": 0, **kw}
        return pc.post(f"files/{pid}/promote", body, status)

    b = pc_on(env, env.a, "B1")
    assert promote(b, sha(data), status=409)["code"] == "not_holder"
    r = promote(a, "e" * 64, status=409)
    assert r["code"] == "changed" and r["paper"]["sha256"] == sha(data)
    limit = env.app.state.config.db_limit_bytes
    env.app.state.config.db_limit_bytes = 1  # 본문이 늘어나므로 새 논문과 같은 DB 기준
    assert promote(a, sha(data), status=400)["code"] == "db_full"
    env.app.state.config.db_limit_bytes = limit
    r = promote(a, sha(data))
    assert r["result"] == "promoted" and r["paper"]["storage"] == "cloud" and r["paper"]["kind"] == "pdf"
    assert f"users/{uid}/papers/{pid}.pdf" in env.storage.objects
    assert sql(project, "select count(*) from paperlab.page_texts where paper_id = %s", (pid,))[0][0] >= 1
    assert row(project, pid, "storage, local_device_id, mode_pending") == \
        {"storage": "cloud", "local_device_id": None, "mode_pending": ""}
    assert not [k for k in env.storage.objects if k.startswith(f"incoming/{uid}/")]
    assert promote(a, sha(data), status=409)["code"] == "not_pending"
    assert b.post("download", {"ids": [pid]})["items"][0]["sha256"] == sha(data)


def test_folder_mode_plan(env, project):
    """AC-S25: 폴더 끄기 — inherit 논문만 대기, 따로 정한 것은 그대로, reset_children이면 아래 설정을 먼저 초기화.
    dry_run 숫자(freed_bytes · other_pcs · overrides)가 실제와 같음"""
    a = pc_on(env, env.a)
    f = env.ca.post("/api/folders", json={"name": "자료"}).json()["id"]
    g = env.ca.post("/api/folders", json={"name": "하위", "parent_id": f}).json()["id"]
    p1, d1 = web_pdf(env, env.ca, "f1")
    p2, d2 = web_pdf(env, env.ca, "f2")
    p3, d3 = web_pdf(env, env.ca, "f3")
    nofile = env.ca.post("/api/papers", json={"title": "No File Paper For Folder Test"}).json()["paper"]["id"]
    env.ca.post("/api/papers/bulk", json={"ids": [p1, p2, nofile], "action": "move_folder", "value": f})
    env.ca.post("/api/papers/bulk", json={"ids": [p3], "action": "move_folder", "value": g})
    set_mode(env.ca, [p2], "cloud")  # 파일마다 따로 정함
    env.ca.post(f"/api/folders/{g}/sync-mode", json={"mode": "cloud"})  # 하위 폴더도 따로
    dry = env.ca.post(f"/api/folders/{f}/sync-mode", json={"mode": "local", "dry_run": True}).json()
    assert dry["to_local"] == 1 and dry["no_file"] == 1 and dry["overrides"] == 2 and dry["freed_bytes"] == len(d1)
    real = env.ca.post(f"/api/folders/{f}/sync-mode", json={"mode": "local"}).json()
    assert {k: v for k, v in real.items() if k != "dry_run"} == {k: v for k, v in dry.items() if k != "dry_run"}
    assert row(project, p1, "mode_pending")["mode_pending"] == "to_local"
    assert row(project, p2, "mode_pending")["mode_pending"] == "" and row(project, p3, "mode_pending")["mode_pending"] == ""
    fo = {x["id"]: x for x in env.ca.get("/api/folders").json()}
    assert fo[f]["effective_mode"] == "local" and fo[g]["effective_mode"] == "cloud"
    # 하위 설정 초기화 → 아래 모두 이 설정
    real = env.ca.post(f"/api/folders/{f}/sync-mode", json={"mode": "local", "reset_children": True}).json()
    assert real["to_local"] == 2 and real["unchanged"] == 1 and real["freed_bytes"] == len(d2) + len(d3)
    assert sql(project, "select sync_mode from paperlab.folders where id = %s", (g,))[0][0] == "inherit"
    assert row(project, p2, "sync_mode")["sync_mode"] == "inherit"
    # 위 폴더 설정 따르기(inherit) → 루트 = 켬 → 대기 취소
    out = env.ca.post(f"/api/folders/{f}/sync-mode", json={"mode": "inherit"}).json()
    assert out["cancelled"] == 3
    assert env.ca.post("/api/folders/999999999/sync-mode", json={"mode": "local"}).status_code == 404
    assert env.ca.post(f"/api/folders/{f}/sync-mode", json={"mode": "off"}).json()["code"] == "bad_mode"


def test_holder_rules_and_isolation(env, project):
    """AC-S26 · S28: no_sync_pc · holder_required · holder_not_eligible(프로토콜 1 · 해지 · 동기화 꺼짐 · 남의 기기),
    남의 논문 · 휴지통 id는 blocked, 남의 폴더는 404"""
    pid, _ = web_pdf(env, env.ca, "s26")
    assert set_mode(env.ca, [pid], "local", status=400)["code"] == "no_sync_pc"
    old = PC(env, env.a, name="old")  # 프로토콜 1로 남은 기기
    old.post("start", {"enabled": True})
    sql(project, "update paperlab.sync_devices set protocol = 1 where device_id = %s", (old.id,))
    off = PC(env, env.a, name="off")
    off.post("start", {"enabled": False})
    gone = pc_on(env, env.a, "gone")
    env.ca.delete(f"/api/devices/{gone.id}")
    other = pc_on(env, env.b, "B-PC")
    for dev in (old.id, off.id, gone.id, other.id):
        assert set_mode(env.ca, [pid], "local", status=400, holder_device_id=dev)["code"] == "holder_not_eligible"
    assert set_mode(env.ca, [pid], "local", status=400)["code"] == "no_sync_pc"
    good = pc_on(env, env.a, "good")
    holders = env.ca.get("/api/sync/holders").json()["holders"]
    assert [h["id"] for h in holders] == [good.id] and holders[0]["this_device"] is False
    # 남의 논문 · 휴지통
    bid, _ = web_pdf(env, env.cb, "bpaper")
    tid, _ = web_pdf(env, env.ca, "trashed")
    env.ca.delete(f"/api/papers/{tid}")
    out = set_mode(env.ca, [pid, bid, tid], "local")
    assert out["to_local"] == 1 and out["holder"]["id"] == good.id
    assert sorted(out["blocked"], key=lambda x: x["id"]) == sorted([{"id": bid, "code": "not_found"},
                                                                    {"id": tid, "code": "trashed"}], key=lambda x: x["id"])
    assert row(project, bid, "mode_pending")["mode_pending"] == ""
    bf = env.cb.post("/api/folders", json={"name": "B 폴더"}).json()["id"]
    assert env.ca.post(f"/api/folders/{bf}/sync-mode", json={"mode": "local"}).status_code == 404


def test_pick_other_holder_after_revoke(env, project):
    """12장 [다른 PC 고르기]: 끄는 중 보관 PC가 해지되면 웹에서도(PC를 미리 보내지 않음) holder_required로 다시 고르게 하고,
    고른 PC로 대기를 넘긴다. 남은 PC가 하나면 그 PC로 자동"""
    a, b, c = pc_on(env, env.a, "A1"), pc_on(env, env.a, "B1"), pc_on(env, env.a, "C1")
    pid, _ = web_pdf(env, env.ca, "pick")
    set_mode(env.ca, [pid], "local", holder_device_id=a.id)
    assert set_mode(env.ca, [pid], "local", holder_device_id=None)["unchanged"] == 1  # 보관 PC가 멀쩡하면 그대로
    env.ca.delete(f"/api/devices/{a.id}")
    r = set_mode(env.ca, [pid], "local", status=400, dry_run=True)
    assert r["code"] == "holder_required" and {x["id"] for x in r["choices"]} == {b.id, c.id}
    dry = set_mode(env.ca, [pid], "local", holder_device_id=b.id, dry_run=True)
    assert dry["to_local"] == 1 and dry["holder"]["id"] == b.id
    assert row(project, pid, "local_device_id")["local_device_id"] == a.id  # dry_run은 바꾸지 않음
    set_mode(env.ca, [pid], "local", holder_device_id=b.id)
    assert row(project, pid, "mode_pending, local_device_id") == {"mode_pending": "to_local", "local_device_id": b.id}
    # 남은 PC가 하나뿐이면 그 PC로 자동
    env.ca.delete(f"/api/devices/{b.id}")
    out = set_mode(env.ca, [pid], "local")
    assert out["to_local"] == 1 and out["holder"]["id"] == c.id
    assert row(project, pid, "local_device_id")["local_device_id"] == c.id
    # 고를 PC가 없으면 no_sync_pc
    env.ca.delete(f"/api/devices/{c.id}")
    assert set_mode(env.ca, [pid], "local", status=400)["code"] == "no_sync_pc"


def test_legacy_source_rows_keep_original(env, project):
    """원본 해시를 모르는 옛 문서 행(sync-originals 전): 끄기는 needs_originals로 막고(논문 · 폴더 설정 모두), 대기가 있어도
    mode.ack가 지우지 않으며, PC가 변환본(.pdf)을 고쳐 올려도 원본을 지우지 않는다 — 유일한 사본을 잃지 않음"""
    a = pc_on(env, env.a)
    uid = env.a.id
    pid = env.upload(env.ca, make_png(180, 120), "옛 보고서.png")["id"]
    sql(project, "update paperlab.papers set source_sha256 = '', file_name = '옛 보고서.pdf' where id = %s", (pid,))
    keys = row(project, pid, "source_key, pdf_key, pdf_sha256")
    assert keys["source_key"] and keys["source_key"] in env.storage.objects
    # 논문 설정: 막고 숫자에서 뺌 · 설정도 그대로
    out = set_mode(env.ca, [pid], "local")
    assert out["to_local"] == 0 and out["blocked"] == [{"id": pid, "code": "needs_originals"}] and out["freed_bytes"] == 0
    assert row(project, pid, "sync_mode, mode_pending") == {"sync_mode": "inherit", "mode_pending": ""}
    # 폴더 설정: 폴더는 바뀌지만 이 행은 대기가 생기지 않음
    f = env.ca.post("/api/folders", json={"name": "옛 문서"}).json()["id"]
    env.ca.patch(f"/api/papers/{pid}", json={"folder_id": f})
    out = env.ca.post(f"/api/folders/{f}/sync-mode", json={"mode": "local"}).json()
    assert out["to_local"] == 0 and out["blocked"] == [{"id": pid, "code": "needs_originals"}]
    assert row(project, pid, "mode_pending")["mode_pending"] == ""
    # 이중 방어: 대기가 이미 있어도(이 수정 전에 생긴 대기) ack는 지우지 않음
    sql(project, "update paperlab.papers set mode_pending = 'to_local', local_device_id = %s, mode_requested_at = now(), "
                 "mode_requested_by = 'web' where id = %s", (a.id, pid))
    assert ack(a, pid, keys["pdf_sha256"])["result"] == "not_pending"
    assert keys["source_key"] in env.storage.objects and keys["pdf_key"] in env.storage.objects
    assert row(project, pid, "storage")["storage"] == "cloud"
    sql(project, "update paperlab.papers set mode_pending = '', local_device_id = null, mode_requested_at = null, "
                 "mode_requested_by = '' where id = %s", (pid,))
    # PC가 변환본(.pdf)을 고쳐 올림 → 변환본만 바뀌고 원본은 그대로
    new_pdf = pdfdoc("legacy-edit")
    r = a.content(pid, new_pdf, keys["pdf_sha256"])
    assert r["result"] == "replaced"
    after = row(project, pid, "source_key, source_sha256, pdf_sha256, file_name")
    assert after == {"source_key": keys["source_key"], "source_sha256": "", "pdf_sha256": sha(new_pdf),
                     "file_name": "옛 보고서.pdf"}
    assert keys["source_key"] in env.storage.objects
    item = {x["id"]: x for x in a.post("snapshot", {})["papers"]}[pid]
    assert item["kind"] == "pdf" and item["sha256"] == sha(new_pdf)
    # sync-originals 뒤에는 끌 수 있음
    admin.sync_originals(project.admin_db, env.storage)
    out = set_mode(env.ca, [pid], "local")
    assert out["blocked"] == [] and out["to_local"] == 1
    assert not [k for k in env.storage.objects if k.startswith(f"incoming/{uid}/")]


def test_pdf_named_oddly_is_plain_pdf(env, project):
    """받는 문서 확장자가 아닌 이름(x.download)의 PDF 내용은 원본으로 두 번 저장하지 않고 그냥 PDF"""
    data = pdfdoc("odd-name")
    pid = env.upload(env.ca, data, "받은 파일.download")["id"]
    p = env.ca.get(f"/api/papers/{pid}").json()
    assert p["has_pdf"] and not p["has_source"]
    assert row(project, pid, "source_key, pdf_sha256") == {"source_key": "", "pdf_sha256": sha(data)}
    assert not [k for k in env.storage.objects if k.startswith(f"users/{env.a.id}/sources/{pid}.")]


def test_move_upload_restore_keep_storage(env, project):
    """AC-S27: 옮기기 · 웹 업로드 · 되살리기는 저장 위치를 바꾸지 않고 '폴더 설정과 다름'"""
    pc_on(env, env.a)
    f = env.ca.post("/api/folders", json={"name": "개인"}).json()["id"]
    env.ca.post(f"/api/folders/{f}/sync-mode", json={"mode": "local"})
    pid, _ = web_pdf(env, env.ca, "s27")
    env.ca.patch(f"/api/papers/{pid}", json={"folder_id": f})
    p = env.ca.get(f"/api/papers/{pid}").json()
    assert p["sync"]["storage"] == "cloud" and p["sync"]["effective"] == "local" and p["sync"]["mismatch"] is True
    up = env.upload(env.ca, pdfdoc("s27b"), "s27b.pdf", folder_id=f)
    assert up["note_local_folder"] is True
    assert env.ca.get(f"/api/papers/{up['id']}").json()["sync"]["mismatch"] is True
    env.ca.delete(f"/api/papers/{pid}")
    env.ca.post("/api/trash/restore", json={"ids": [pid]})
    p = env.ca.get(f"/api/papers/{pid}").json()
    assert p["sync"]["storage"] == "cloud" and p["sync"]["mismatch"] is True
    lst = {x["id"]: x for x in env.ca.get("/api/papers").json()["items"]}
    assert lst[pid]["sync"]["mismatch"] is True and "storage" not in lst[pid] and "local_device_id" not in lst[pid]


# ====================================================================== S73 관리 명령
def test_admin_sync_originals(env, project):
    """AC-S73: 원본 해시를 모르는 행 → --dry-run은 숫자만, 실행 뒤 원본 표현(해시 · 원래 확장자 이름), 두 번째는 할 일 0"""
    pc = pc_on(env, env.a)
    png = make_png(150, 150)
    pid = env.upload(env.ca, png, "옛 문서.png")["id"]
    sql(project, "update paperlab.papers set source_sha256 = '', file_name = '옛 문서.pdf' where id = %s", (pid,))
    other = env.upload(env.ca, make_pdf_named(), "옛 문서 겹침.pdf")["id"]  # 같은 폴더에 겹칠 이름을 하나 만듦
    sql(project, "update paperlab.papers set file_name = '옛 문서.png' where id = %s", (other,))
    assert {x["id"]: x for x in pc.post("snapshot", {})["papers"]}[pid]["kind"] == "pdf"
    dry = admin.sync_originals(project.admin_db, env.storage, dry_run=True)
    assert dry["found"] >= 1 and dry["updated"] == 0
    assert row(project, pid, "source_sha256")["source_sha256"] == ""
    res = admin.sync_originals(project.admin_db, env.storage)
    assert res["updated"] >= 1 and res["renamed"] >= 1
    r = row(project, pid, "source_sha256, file_name")
    assert r == {"source_sha256": hashlib.sha256(png).hexdigest(), "file_name": "옛 문서 (2).png"}
    item = {x["id"]: x for x in pc.post("snapshot", {})["papers"]}[pid]
    assert item["kind"] == "source" and item["sha256"] == sha(png)
    admin.sync_originals(project.admin_db, env.storage)  # 두 번째: 이 행은 할 일 없음
    assert row(project, pid, "source_sha256, file_name") == r


def test_admin_sync_originals_pc_replaced_pdf(env, project):
    """원본을 적은 뒤 PC가 변환본(.pdf)을 고쳐 올린 옛 문서 행: sync-originals가 옛 원본을 PC 표현으로 되돌리지 않는다 —
    해시를 채우지 않고 원본을 떼어 냄(PC 표현 = PC가 올린 PDF 그대로, 이름 .pdf 그대로). 웹에서만 바뀐 옆 행은 그대로 원본 표현"""
    a = pc_on(env, env.a)
    png = make_png(170, 110)
    pid = env.upload(env.ca, png, "고친 보고서.png")["id"]
    web_only = env.upload(env.ca, make_png(90, 160), "안 고친 보고서.png")["id"]
    for p, name in ((pid, "고친 보고서.pdf"), (web_only, "안 고친 보고서.pdf")):
        sql(project, "update paperlab.papers set source_sha256 = '', file_name = %s where id = %s", (name, p))
    keys = row(project, pid, "source_key, pdf_sha256, content_device_id")
    assert keys["content_device_id"] is None  # 웹 업로드는 원본 · PDF를 함께 적음(기기 없음)
    # PC가 변환본을 고쳐 올림 (옛 문서 분기 — 원본은 그대로, 올린 기기가 남음)
    edited = pdfdoc("legacy-pc-edit")
    assert a.content(pid, edited, keys["pdf_sha256"])["result"] == "replaced"
    assert row(project, pid, "source_key, content_device_id") == {"source_key": keys["source_key"], "content_device_id": a.id}
    dry = admin.sync_originals(project.admin_db, env.storage, dry_run=True)
    assert dry["stale"] >= 1 and dry["detached"] == 0
    assert row(project, pid, "source_key")["source_key"] == keys["source_key"]  # dry-run은 바꾸지 않음
    res = admin.sync_originals(project.admin_db, env.storage)
    assert res["detached"] >= 1 and res["updated"] >= 1
    # PC가 고친 행: 원본을 떼어 냄 — 옛 원본이 PC 표현으로 돌아오지 않음
    assert row(project, pid, "source_key, source_sha256, source_name, pdf_sha256, file_name") == {
        "source_key": "", "source_sha256": "", "source_name": "", "pdf_sha256": sha(edited), "file_name": "고친 보고서.pdf"}
    assert keys["source_key"] not in env.storage.objects
    snap = {x["id"]: x for x in a.post("snapshot", {})["papers"]}
    assert snap[pid]["kind"] == "pdf" and snap[pid]["sha256"] == sha(edited)
    # 웹에서만 바뀐 행은 원본 표현으로 (기존 동작)
    assert snap[web_only]["kind"] == "source" and row(project, web_only, "file_name")["file_name"] == "안 고친 보고서.png"
    # 이제 옛 문서 행이 아님: 끌 수 있음 · 두 번째 실행은 이 행에 할 일 없음
    out = set_mode(env.ca, [pid], "local")
    assert out["blocked"] == [] and out["to_local"] == 1
    set_mode(env.ca, [pid], "cloud")  # 대기 취소
    with psycopg.connect(project.admin_db, autocommit=True, prepare_threshold=None) as conn:
        left = conn.execute("select count(*) from paperlab.papers where id = any(%s) and source_key <> '' "
                            "and source_sha256 = ''", ([pid, web_only],)).fetchone()[0]
    assert left == 0


def make_pdf_named() -> bytes:
    return pdfdoc("other")
