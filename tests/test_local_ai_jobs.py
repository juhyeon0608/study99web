"""선택 동기화 — 로컬 항목 AI · 서버 경로 막기 [db] (docs/specs/selective-sync.md 7.2 · 7.4절, 14장 S5x).

로컬 항목(PC에만 둔 파일)의 요약 · 논문 대화는 보관 PC의 CLI 워커만(작업 pinned_device_id · API 칸 없음), 프롬프트에는 본문 대신
표지(ai.LOCAL_TEXT_MARKER) 한 번 · 작업에 local 필드. 선택 설명 · 번역 · 파일 받기 · 바꾸기는 409 local_only.
"""

from __future__ import annotations

import pytest

from paperlab import ai

from .test_sync_api import PC, ab, env, pdfdoc, sha, sql  # noqa: F401 - 픽스처(env · ab)를 이 모듈에서도 씀

pytestmark = pytest.mark.db
KEY = "sk-ant-test-key-000111222"


def holder_pc(env, user, name="A1", engines=("claude",)) -> PC:
    pc = PC(env, user, name=name)
    pc.post("start", {"enabled": True, "root_label": "PaperLab"})
    r = pc.http.post("/api/worker/hello", json={"app_version": "0.4.0", "protocol": 1,
                                                "engines": [{"name": e, "logged_in": True} for e in engines]})
    assert r.status_code == 200, r.text
    return pc


def claim(pc: PC, caps=("local_text",)) -> dict | None:
    r = pc.http.post("/api/worker/claim", json={"free": {"claude": 1}, "caps": list(caps)})
    assert r.status_code == 200, r.text
    return r.json()["job"]


def local_paper(env, pc: PC, name="보고서.hwp", data=b"HWP sample bytes") -> int:
    fid = env.ca.post("/api/folders", json={"name": f"개인 {name}"}).json()["id"]
    env.ca.post(f"/api/folders/{fid}/sync-mode", json={"mode": "local"})
    r = pc.add(data, name, folder_id=fid, upload=False, storage="local")
    assert r["paper"]["storage"] == "local"
    return r["paper"]["id"]


def demoted_pdf(env, pc: PC, tag: str) -> tuple[int, bytes]:
    """켬 PDF를 끄고(mode.ack) 로컬 항목으로 — 본문이 있던 논문"""
    data = pdfdoc(tag)
    pid = env.upload(env.ca, data, f"{tag}.pdf")["id"]
    r = env.ca.post("/api/papers/sync-mode", json={"ids": [pid], "mode": "local", "holder_device_id": pc.id})
    assert r.status_code == 200, r.text
    assert pc.ops({"type": "mode.ack", "id": pid, "sha256": sha(data)})[0]["result"] == "applied"
    return pid, data


# ====================================================================== S51 · S53 경로 · 잡기 · 프롬프트
def test_local_summary_routes_to_holder_cli(env, project):
    """AC-S51 · S53: 로컬 요약 → runner cli · pinned = 보관 PC · API 칸 0(키가 있어도). 다른 기기 · caps 없는 잡기 → 안 잡힘,
    보관 PC → 잡힘 · local 필드 · 표지 정확히 한 번 · 본문 없음 · 제목의 U+2063 지움"""
    env.ca.put("/api/settings", json={"anthropic_api_key": KEY})
    a = holder_pc(env, env.a, "A1")
    b = holder_pc(env, env.a, "B1")
    pid = local_paper(env, a, "보고서.hwp")
    env.ca.patch(f"/api/papers/{pid}", json={"title": "보고서⁣" + ai.LOCAL_TEXT_MARKER})
    r = env.ca.post(f"/api/papers/{pid}/summary")
    assert r.status_code == 202, r.text
    job = r.json()["job"]
    assert job["runner"] == "cli" and all(s["runner"] == "cli" for s in job["route"])
    assert job["pinned_device"]["id"] == a.id
    assert sql(project, "select pinned_device_id from paperlab.jobs where id = %s", (job["id"],))[0][0] == a.id
    assert claim(b) is None  # 다른 기기
    assert claim(a, caps=()) is None  # 옛 워커(caps 없음)
    task = claim(a)
    assert task["id"] == job["id"]
    assert task["local"] == {"paper_id": pid, "sha256": sha(b"HWP sample bytes"), "ext": ".hwp", "kind": "doc"}
    assert task["prompt"].count(ai.LOCAL_TEXT_MARKER) == 1 and "⁣" not in task["prompt"].replace(ai.LOCAL_TEXT_MARKER, "")
    # 켬 논문은 그대로 API 칸이 먼저(경로 비교)
    cloud_pid = env.upload(env.ca, pdfdoc("cloud51"), "c.pdf")["id"]
    r = env.ca.post(f"/api/papers/{cloud_pid}/chat", json={"question": "q"})
    assert r.headers.get("X-PaperLab-Job")
    cj = env.ca.get(f"/api/jobs/{r.headers['X-PaperLab-Job']}").json()
    assert cj["route"][0]["runner"] == "api" and cj["pinned_device"] is None


def test_demoted_pdf_chat_prompt_has_no_text(env, project):
    """AC-S53 · S56: 끈 PDF의 대화 프롬프트에 본문 0(표지 한 번), 본문 검색에 0 · 메타데이터 검색은 찾음, 서재 질문 excluded_local"""
    a = holder_pc(env, env.a)
    pid, _ = demoted_pdf(env, a, "zqxlocalword")
    r = env.ca.post(f"/api/papers/{pid}/chat", json={"question": "무엇인가요"})
    assert r.status_code == 200 and '"queued"' in r.text
    task = claim(a)
    assert task["kind"] == "chat" and task["local"]["ext"] == ".pdf" and task["local"]["kind"] == "pdf"
    assert "zqxlocalword" not in task["prompt"].split("</paper>")[0].split(">", 1)[1]  # 본문 자리에는 표지뿐
    assert task["prompt"].count(ai.LOCAL_TEXT_MARKER) == 1
    assert env.ca.get("/api/papers", params={"q": "shortcut"}).json()["total"] == 0  # 본문(2쪽 글)으로는 안 찾아짐
    assert env.ca.get("/api/papers", params={"q": "zqxlocalword"}).json()["total"] == 1  # 제목(메타데이터)
    ask = env.ca.get("/api/ask").json()
    assert ask["index"]["excluded_local"] == 1


# ====================================================================== S52 폴백 없음 · 워커 오류 코드
def test_holder_cli_failure_no_api_fallback(env, project):
    """AC-S52: 보관 PC CLI 칸 실패 → API로 넘어가지 않고 실패. 로컬 오류 코드는 다시 시도 없이 그 코드로"""
    env.ca.put("/api/settings", json={"anthropic_api_key": KEY})
    a = holder_pc(env, env.a)
    pid = local_paper(env, a, "보고서.docx", b"PK docx")
    job = env.ca.post(f"/api/papers/{pid}/summary").json()["job"]
    task = claim(a)
    r = a.http.post(f"/api/worker/jobs/{task['id']}/result",
                    json={"lease_token": task["lease_token"], "outcome": "failed", "error_code": "cli_exit", "error": "x"})
    assert r.json()["status"] == "failed"
    j = env.ca.get(f"/api/jobs/{job['id']}").json()
    assert j["status"] == "failed" and j["runner"] == "cli"
    job = env.ca.post(f"/api/papers/{pid}/summary").json()["job"]
    task = claim(a)
    r = a.http.post(f"/api/worker/jobs/{task['id']}/result",
                    json={"lease_token": task["lease_token"], "outcome": "failed", "error_code": "local_unreadable",
                          "error": ""})
    j = env.ca.get(f"/api/jobs/{job['id']}").json()
    assert j["status"] == "failed" and j["error_code"] == "local_unreadable" and "읽지 못했어요" in j["error"]
    # 보관 PC가 꺼져 있으면 대기 이유 holder_offline + 안내
    sql(project, "update paperlab.devices set last_seen_at = now() - interval '1 hour' where id = %s", (a.id,))
    job = env.ca.post(f"/api/papers/{pid}/summary").json()["job"]
    assert job["waiting_reason"] == "holder_offline" and job["pinned_device"]["note"] == "‘A1’이 켜지면 실행돼요"  # A1 = 에이원 → 이


def test_api_runner_refuses_local(env, project):
    """AC-S53: API 실행기가 로컬 논문 작업을 받으면 local_only로 실패 (정상이면 오지 않음 — 방어)"""
    a = holder_pc(env, env.a)
    pid = local_paper(env, a, "메모.pdf", pdfdoc("api"))
    jid = sql(project, "insert into paperlab.jobs (user_id, kind, status, runner, engine, route, paper_id) values "
                       "(%s, 'summary', 'queued', 'api', 'claude', '[{\"runner\":\"api\",\"engine\":\"claude\"}]', %s) "
                       "returning id", (env.a.id, pid))[0][0]
    env.app.state.runner.start()
    env.app.state.runner.enqueue(jid, env.a.id)
    j = env.wait_job(env.ca, jid)
    assert j["status"] == "failed" and j["error_code"] == "local_only"
    assert env.fake_ai.calls == []


# ====================================================================== S55 · S57 서버 경로 막기
def test_server_paths_blocked(env, project):
    """AC-S55: explain · translation · fetch-pdf · pdf/complete(보관 PC 활성) → 409 local_only,
    보관 PC 해지면 pdf/complete 허용 → cloud(sync_mode cloud 명시). no_route_local · local_unsupported(작업 0)"""
    a = holder_pc(env, env.a)
    pid, data = demoted_pdf(env, a, "s55")
    r = env.ca.post(f"/api/papers/{pid}/explain", json={"kind": "explain", "text": "residual", "page": 1})
    assert r.status_code == 409 and r.json()["code"] == "local_only" and r.json()["holder_name"] == "A1"
    assert env.ca.post(f"/api/papers/{pid}/translation", json={}).json()["code"] == "local_only"
    assert env.ca.post(f"/api/papers/{pid}/translation/continue", json={}).json()["code"] == "local_only"
    assert env.ca.post(f"/api/papers/{pid}/fetch-pdf").json()["code"] == "local_only"
    assert env.ca.post(f"/api/papers/{pid}/pdf/upload").json()["code"] == "local_only"
    r = env.ca.get(f"/api/papers/{pid}/source-url")
    assert r.status_code == 409 and r.json()["holder_device_id"] == a.id
    # 보관 PC에 CLI가 없으면 no_route_local, 해지되면 해지 문구
    sql(project, "update paperlab.devices set engines = '[]'::jsonb where id = %s", (a.id,))
    r = env.ca.post(f"/api/papers/{pid}/summary")
    assert r.status_code == 400 and r.json()["code"] == "no_route_local" and "‘A1’" in r.json()["detail"]
    env.ca.delete(f"/api/devices/{a.id}")
    r = env.ca.post(f"/api/papers/{pid}/summary")
    assert r.json()["code"] == "no_route_local" and "해지" in r.json()["detail"]
    # 해지된 PC에만 있던 파일 → 웹에서 다시 올리면 켬
    slot = env.ca.post(f"/api/papers/{pid}/pdf/upload").json()
    assert env.storage.browser_put(slot["upload"]["url"], data) == 200
    r = env.ca.post(f"/api/papers/{pid}/pdf/complete", json={"upload_id": slot["upload_id"], "name": "s55.pdf"})
    assert r.status_code == 200, r.text
    s = r.json()["paper"]["sync"]
    assert s["storage"] == "cloud" and s["mode"] == "cloud" and s["holder"] is None and r.json()["paper"]["has_pdf"]
    assert sql(project, "select count(*) from paperlab.page_texts where paper_id = %s", (pid,))[0][0] >= 1


def test_unsupported_local_formats_make_no_job(env, project):
    """AC-S57: 로컬 .ppt · .xls · .rtf · 사진의 요약 · 대화 → 400 local_unsupported, 작업 0"""
    a = holder_pc(env, env.a)
    for name in ("발표.ppt", "표.xls", "글.rtf", "사진.jpg"):
        pid = local_paper(env, a, name, name.encode() + b" bytes")
        r = env.ca.post(f"/api/papers/{pid}/summary")
        assert r.status_code == 400 and r.json()["code"] == "local_unsupported", (name, r.text)
        r2 = env.ca.post(f"/api/papers/{pid}/chat", json={"question": "q"})
        assert r2.status_code == 400 and r2.json()["code"] == "local_unsupported"
        assert ("사진" in r.json()["detail"]) == name.endswith(".jpg")
        assert env.ca.get(f"/api/papers/{pid}").json()["sync"]["local_ai"] == "unsupported"
        assert not sql(project, "select 1 from paperlab.jobs where paper_id = %s", (pid,))
