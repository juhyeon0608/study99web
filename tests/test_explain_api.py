"""4단계 — 쉬운 설명 · 선택 번역 · 전체 번역 API (docs/specs/phase4-explain-translate.md 12장 [db]).

테스트용 Supabase 프로젝트 + 가짜 저장소(FakeStorage) + 가짜 AI(conftest.FakeAI) + Python 가짜 워커.
실제 AI · CLI · R2는 부르지 않는다. 쪽 글은 page_texts에 직접 넣는다(가짜 PDF — 13장).
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time

import pytest

from paperlab import ai, explain, jobs, translate
from paperlab.admin import find_orphans

from .test_jobs import KEY, Worker, _serve, _wait_status, ab, env, paper, sql  # noqa: F401 - 픽스처 재사용
from .test_rag_api import pdf_with

pytestmark = pytest.mark.db

SEL = "The attention function maps a query and a set of key-value pairs to an output."
EN = "Transformers replace recurrence with attention over all tokens in the sequence. " * 30   # 약 2,500자
SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120"><text x="10" y="20" font-size="13" '
       'fill="currentColor">쿼리 → 키</text></svg>')


def sse(client, url: str, body: dict) -> list[dict]:
    with client.stream("POST", url, json=body) as r:
        assert r.status_code == 200, r.read()
        return [json.loads(x[6:]) for x in r.iter_lines() if x.startswith("data: ")]


def add_paper(env, project, user, pages: list[str], sha: str = "sha-1") -> int:
    """논문 + 쪽 글(가짜 PDF)"""
    pid = paper(env.client(user))
    sql(project, "update paperlab.papers set pdf_sha256 = %s where id = %s", (sha, pid))
    sql(project, "insert into paperlab.page_texts (user_id, paper_id, page, text) select %s, %s, g.i, g.t "
                 "from unnest(%s::text[]) with ordinality as g(t, i)", (user.id, pid, pages))
    return pid


def paper_pages(n: int = 20, refs_at: int | None = 18) -> list[str]:
    pages = [f"Section {i}. " + EN for i in range(1, n + 1)]
    if refs_at:
        pages[refs_at - 1] = "We conclude that attention suffices for translation quality. " * 3 + "\nReferences\n[1] A. B. 2017."
    return pages


def reply(system, prompt, schema):
    """설명 JSON · 선택 번역 글 · 전체 번역 JSON(프롬프트의 쪽 번호마다)"""
    if schema and "one_line" in schema.get("properties", {}):
        return json.dumps({"one_line": "어텐션은 관련도 재기", "easy": "도서관 사서 비유", "detail": "$QK^T$ 자세히",
                           "diagram_svg": SVG}, ensure_ascii=False)
    if schema and "pages" in schema.get("properties", {}):
        nums = [int(n) for n in re.findall(r'<page number="(\d+)">', prompt)]
        return json.dumps({"pages": [{"page": n, "text": f"번역 {n}쪽"} for n in nums]}, ensure_ascii=False)
    return "어텐션 함수는 쿼리와 키-값 쌍을 출력으로 대응시켜요."


def explain_body(**kw):
    return {"kind": "explain", "text": SEL, "page": 1, "rects": [[0.1, 0.2, 0.5, 0.02]], **kw}


def pages_in(prompt: str) -> list[int]:
    return [int(n) for n in re.findall(r'<page number="(\d+)">', prompt)]


# ====================================================================== E. 선택 설명 · 번역
def test_explain_api_cache_force_and_language(env, project):
    """AC-E01 · E02 · E06(서버)"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = add_paper(env, project, env.a, [EN])
    env.fake_ai.reply = reply
    url = f"/api/papers/{pid}/explain"
    ev = sse(ca, url, explain_body())
    assert [e["type"] for e in ev] == ["done"]  # 설명 JSON 조각은 화면에 흘리지 않음
    it = ev[0]["item"]
    assert ev[0]["cached"] is False and it["one_line"] == "어텐션은 관련도 재기" and it["easy"] and it["detail"]
    assert it["svg"] == SVG and it["svg_note"] == "" and it["page"] == 1 and it["rect"] == [0.1, 0.2, 0.6, 0.22]
    job = sql(project, "select status, result, kind from paperlab.jobs where user_id = %s and kind = 'explain'", (env.a.id,))
    assert job == [("succeeded", {"explanation_id": it["id"]}, "explain")]
    prompt = env.fake_ai.prompts[-1][1]
    assert SEL in prompt and "Transformers replace recurrence" in prompt and "한국어" in env.fake_ai.prompts[-1][0]
    assert '{"one_line", "easy", "detail", "diagram_svg"}' in prompt
    # 캐시: AI 0회 · 작업 0개 · cached 한 이벤트
    calls = len(env.fake_ai.calls)
    ev = sse(ca, url, explain_body(text="  " + SEL.replace(" ", "  ")))
    assert len(ev) == 1 and ev[0]["cached"] is True and ev[0]["item"]["id"] == it["id"] and len(env.fake_ai.calls) == calls
    assert sql(project, "select count(*) from paperlab.jobs where user_id = %s", (env.a.id,))[0][0] == 1
    # force: 다시 부르고 같은 행 갱신
    env.fake_ai.reply = lambda s, p, sc: json.dumps({"one_line": "새 한 줄", "easy": "e", "detail": "d", "diagram_svg": ""})
    ev = sse(ca, url, explain_body(force=True))
    assert ev[-1]["item"]["id"] == it["id"] and ev[-1]["item"]["one_line"] == "새 한 줄" and len(env.fake_ai.calls) == calls + 1
    # 언어를 바꾸면 새로
    ca.put("/api/settings", json={"summary_language": "English"})
    ev = sse(ca, url, explain_body())
    assert ev[-1]["item"]["id"] != it["id"] and ev[-1]["item"]["lang"] == "English"
    listed = ca.get(f"/api/papers/{pid}/explanations").json()
    assert [x["lang"] for x in listed["items"]] == ["English", "한국어"] and listed["jobs"] == [] and listed["keep"] == 300
    # 이미 한국어인 글의 한국어 번역 → 400, 지우기 · 남의 것 404
    r = ca.post(url, json={"kind": "translate", "text": "어텐션 함수는 쿼리와 키를 대응시킨다", "page": 1, "rects": []})
    assert r.status_code == 400 and r.json()["detail"] == "이미 한국어예요"
    assert ca.post(url, json=explain_body(text="x")).status_code == 400
    assert env.client(env.b).delete(f"/api/explanations/{it['id']}").status_code == 404
    assert ca.delete(f"/api/explanations/{it['id']}").status_code == 200
    assert ca.delete(f"/api/explanations/{it['id']}").status_code == 404


def test_translate_selection_streams(env, project):
    """AC-E07: 선택 번역은 delta가 둘 이상 오고 done 뒤 카드 text가 저장된다"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY, "translate_language": "ko"})
    pid = add_paper(env, project, env.a, [EN])

    def complete(system, prompt, engine="claude", schema=None, schema_name="result"):
        env.fake_ai.prompts.append((system, prompt))
        for part in ("어텐션 함수는 ", "쿼리와 ", "키-값 쌍을 대응시켜요."):
            yield {"type": "delta", "text": part}
        yield {"type": "done", "text": "어텐션 함수는 쿼리와 키-값 쌍을 대응시켜요."}

    env.fake_ai.complete = complete
    ev = sse(ca, f"/api/papers/{pid}/explain", {"kind": "translate", "text": SEL, "page": 1, "rects": []})
    assert [e["type"] for e in ev].count("delta") >= 2 and ev[-1]["type"] == "done"
    assert ev[-1]["item"]["text"] == "어텐션 함수는 쿼리와 키-값 쌍을 대응시켜요." and ev[-1]["item"]["rect"] is None
    assert "한국어로" in env.fake_ai.prompts[-1][0] and "<abstract>" not in env.fake_ai.prompts[-1][1]
    assert ca.get(f"/api/papers/{pid}/explanations").json()["items"][0]["kind"] == "translate"


def test_explain_cli_fallback_and_no_route(env, project):
    """AC-E03 · P13(설명 json · 번역 text): 키 · 기기 없음 400 → 기기 있음 queued → 워커 결과 저장. 키가 틀리면 fallback"""
    ca = env.client(env.a)
    pid = add_paper(env, project, env.a, [EN])
    r = ca.post(f"/api/papers/{pid}/explain", json=explain_body())
    assert r.status_code == 400 and r.json()["code"] == "no_route"
    w = Worker(env, env.a)
    ev = sse(ca, f"/api/papers/{pid}/explain", explain_body())
    assert ev[0]["type"] == "queued" and ev[0]["job"]["kind"] == "explain" and ev[0]["job"]["source_text"] == SEL
    listed = ca.get(f"/api/papers/{pid}/explanations").json()
    assert [j["id"] for j in listed["jobs"]] == [ev[0]["job"]["id"]] and listed["jobs"][0]["page"] == 1
    t = w.claim()["job"]
    assert t["kind"] == "explain" and t["output"] == "json" and t["json_schema"] == explain.EXPLAIN_SCHEMA
    assert SEL in t["prompt"] and t["timeout_s"] == 600
    structured = {"one_line": "PC 한 줄", "easy": "쉬움", "detail": "자세히", "diagram_svg": "<svg onload=x></svg>"}
    assert w.result(t, text=json.dumps(structured), structured=structured).json()["status"] == "succeeded"
    items = ca.get(f"/api/papers/{pid}/explanations").json()["items"]
    assert items[0]["one_line"] == "PC 한 줄" and items[0]["svg"] == "" and items[0]["svg_note"] == "unsafe"
    assert items[0]["engine"] == "claude"
    # 선택 번역은 글 + 중간 글
    ev = sse(ca, f"/api/papers/{pid}/explain", {"kind": "translate", "text": SEL, "page": 1, "rects": []})
    t = w.claim()["job"]
    assert t["kind"] == "translate" and t["output"] == "text" and t["stream_partial"] is True and t["json_schema"] is None
    assert w.result(t, text="PC 번역문").json()["status"] == "succeeded"
    assert ca.get(f"/api/papers/{pid}/explanations").json()["items"][0]["text"] == "PC 번역문"
    # 키가 틀리면 같은 작업이 PC로 (fallback)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    env.fake_ai.fail = "api_auth"
    ev = sse(ca, f"/api/papers/{pid}/explain", explain_body(force=True))
    assert ev[-1]["type"] == "fallback" and ev[-1]["job"]["runner"] == "cli"


def test_explain_bad_output_is_not_saved(env, project):
    """AC-E05(서버 경로): JSON 못 읽음 → error 이벤트 · 작업 failed(bad_output, 폴백 없음) · 행 없음"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    Worker(env, env.a)  # 폴백할 PC가 있어도 bad_output은 넘기지 않음
    pid = add_paper(env, project, env.a, [EN])
    env.fake_ai.reply = "JSON이 아니에요"
    ev = sse(ca, f"/api/papers/{pid}/explain", explain_body())
    assert ev[-1]["type"] == "error" and ev[-1]["job"]["error_code"] == "bad_output" and ev[-1]["job"]["runner"] == "api"
    assert sql(project, "select count(*) from paperlab.explanations where user_id = %s", (env.a.id,))[0][0] == 0


def test_explain_sse_disconnect_continues(env, project):
    """AC-E08 (2026-10-16 백그라운드 AI로 바뀜): SSE를 중간에 끊어도 작업은 계속되고(설명 목록의 진행 작업에 보임),
    끝나면 카드가 저장된다"""
    import httpx

    from .test_jobs import _wait_detached
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = add_paper(env, project, env.a, [EN])
    gate = threading.Event()

    def complete(system, prompt, engine="claude", schema=None, schema_name="result"):
        yield {"type": "delta", "text": "어텐션"}
        for _ in range(60):
            if gate.wait(0.2):
                break
            yield {"type": "delta", "text": "…"}
        yield {"type": "done", "text": "끊긴 뒤의 번역"}

    env.fake_ai.complete = complete
    server, th, port = _serve(env.app)
    try:
        headers = {"Authorization": f"Bearer {env.a.token}", "X-PaperLab": "1", "Host": "testserver"}
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", headers=headers, timeout=20) as c:
            with c.stream("POST", f"/api/papers/{pid}/explain", json={"kind": "translate", "text": SEL, "page": 1}) as r:
                assert r.status_code == 200
                for line in r.iter_lines():
                    if line.startswith("data: "):
                        break
        jid = sql(project, "select id from paperlab.jobs where user_id = %s and kind = 'translate' order by id desc limit 1",
                  (env.a.id,))[0][0]
        assert _wait_detached(project, jid) == ("running", False)
        assert [j["id"] for j in ca.get(f"/api/papers/{pid}/explanations").json()["jobs"]] == [jid]  # 다시 연 화면의 진행 카드
        gate.set()
        assert _wait_status(project, jid, ("cancelled", "succeeded", "failed"), 10) == "succeeded"
        items = ca.get(f"/api/papers/{pid}/explanations").json()["items"]
        assert len(items) == 1 and items[0]["text"] == "끊긴 뒤의 번역"
    finally:
        server.should_exit = True
        th.join(5)


def test_explanations_cap(env, project, monkeypatch):
    """AC-D06: 상한 3으로 주입 → 4개 저장하면 가장 오래된 1개가 지워짐"""
    monkeypatch.setattr(explain, "MAX_ROWS", 3)
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = add_paper(env, project, env.a, [EN])
    env.fake_ai.reply = reply
    ids = [sse(ca, f"/api/papers/{pid}/explain", explain_body(text=f"{SEL} {i}"))[-1]["item"]["id"] for i in range(4)]
    left = [r[0] for r in sql(project, "select id from paperlab.explanations where user_id = %s order by id", (env.a.id,))]
    assert left == ids[1:]


# ====================================================================== P. 전체 번역
def wait_job(env, client, jid, timeout=30.0):
    return env.wait_job(client, jid, timeout=timeout)


def test_translation_full_flow_and_manuscript(env, project):
    """AC-P03 · P11 · L01(일부): 202 → 묶음마다 같은 작업이 다시 잡힘 → succeeded. d/s/r만, 파일 = d 쪽, 원고"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pages = paper_pages()
    pages[4] = "7"   # 빈 쪽
    pid = add_paper(env, project, env.a, pages)
    env.fake_ai.reply = reply
    got = ca.get(f"/api/papers/{pid}/translation").json()
    assert got["translation"] is None and got["job"] is None
    est = got["estimate"]
    assert est["refs_from"] == 18 and est["refs_pages"] == 2 and est["pages"] == 17 and len(est["page_chars"]) == 20
    r = ca.post(f"/api/papers/{pid}/translation", json={})
    assert r.status_code == 202, r.text
    job = r.json()["job"]
    assert job["kind"] == "translate_paper" and job["progress"]["counts"] == {"pages_done": 0, "pages_total": 17}
    env.app.state.runner.start(scan=False)
    done = wait_job(env, ca, job["id"])
    assert done["status"] == "succeeded", done
    assert done["result"]["done"] == 17 and done["result"]["failed"] == 0
    calls = [p for _, p in env.fake_ai.prompts]
    # 묶음마다 AI 한 번: [1-3] [4] (5쪽 빈 쪽이라 끊김) [6-8] [9-11] [12-14] [15-17] [18]
    assert [pages_in(p) for p in calls] == [[1, 2, 3], [4], [6, 7, 8], [9, 10, 11], [12, 13, 14], [15, 16, 17], [18]]
    assert sorted(n for p in calls for n in pages_in(p)) == [n for n in range(1, 19) if n != 5]
    assert sql(project, "select count(*) from paperlab.jobs where user_id = %s and kind = 'translate_paper'", (env.a.id,))[0][0] == 1
    out = ca.get(f"/api/papers/{pid}/translation").json()
    tr = out["translation"]
    assert set(tr["page_state"]) <= set("dsr") and tr["page_state"][4] == "s" and tr["page_state"][18:] == "rr"
    key = sql(project, "select tr_key from paperlab.translations where paper_id = %s", (pid,))[0][0]
    assert re.fullmatch(rf"users/{env.a.id}/translations/{pid}\.[0-9a-f]{{8}}\.json", key)
    data = json.loads(env.storage.objects[key])
    assert [k for k in env.storage.objects if "/translations/" in k] == [key]   # 옛 세대 키는 교체 뒤 지워짐
    assert sorted(map(int, data["pages"])) == [i + 1 for i, c in enumerate(tr["page_state"]) if c == "d"] == sorted(map(int, tr["pages"]))
    assert tr["pages"]["1"] == "번역 1쪽" and data["pdf_sha256"] == "sha-1"
    assert "References" not in calls[-1]   # 참고문헌 첫 쪽은 제목 앞까지만
    m = ca.post(f"/api/papers/{pid}/translation/manuscript").json()
    body = ca.get(f"/api/manuscripts/{m['id']}").json()
    assert body["title"].startswith("[번역] ") and body["content"].startswith("> AI 번역")
    assert re.findall(r"^## p\.(\d+)$", body["content"], re.M) == [str(i) for i in range(1, 21)]
    assert "번역 1쪽" in body["content"] and "(참고문헌 이후 쪽이라 번역하지 않았어요)" in body["content"]


def test_translation_chunk_failure_then_retry_failed(env, project):
    """AC-P04 · P10: 한 묶음이 api_refusal(또는 결과에서 쪽 빠짐)이면 그 쪽만 f, 나머지 계속 → succeeded.
    continue failed → 그 쪽만 1쪽씩"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = add_paper(env, project, env.a, paper_pages(9, refs_at=None))
    real = env.fake_ai.complete

    def complete(system, prompt, engine="claude", schema=None, schema_name="result"):
        nums = pages_in(prompt)
        if 4 in nums and len(nums) > 1:
            env.fake_ai.prompts.append((system, prompt))
            raise ai.AIError("거절", "api_refusal")
        if 7 in nums and len(nums) > 1:  # 7쪽을 빼먹은 결과
            env.fake_ai.prompts.append((system, prompt))
            text = json.dumps({"pages": [{"page": n, "text": f"번역 {n}"} for n in nums if n != 7] + [{"page": 99, "text": "밖"}]})
            yield {"type": "done", "text": text}
            return
        yield from real(system, prompt, engine, schema, schema_name)

    env.fake_ai.reply = reply
    env.fake_ai.complete = complete
    env.app.state.runner.start(scan=False)
    job = ca.post(f"/api/papers/{pid}/translation", json={}).json()["job"]
    assert wait_job(env, ca, job["id"])["status"] == "succeeded"
    tr = ca.get(f"/api/papers/{pid}/translation").json()["translation"]
    assert tr["page_state"] == "dddffffdd", tr
    assert tr["page_errors"]["4"] == "api_refusal" and tr["page_errors"]["7"] == "bad_output" and "99" not in tr["pages"]
    failed = [i + 1 for i, c in enumerate(tr["page_state"]) if c == "f"]
    n0 = len(env.fake_ai.prompts)
    r = ca.post(f"/api/papers/{pid}/translation/continue", json={"pages": "failed"})
    assert r.status_code == 202
    assert wait_job(env, ca, r.json()["job"]["id"])["status"] == "succeeded"
    retried = [pages_in(p) for _, p in env.fake_ai.prompts[n0:]]
    assert retried == [[p] for p in failed]   # 1쪽씩
    tr = ca.get(f"/api/papers/{pid}/translation").json()["translation"]
    assert tr["page_state"] == "d" * 9 and tr["page_errors"] == {}


def test_translation_fallback_to_cli_and_deadline(env, project):
    """AC-P05 · P07 · P13(translate_paper json): 묶음 도중 api_auth → 같은 작업이 CLI 칸으로, PC 프롬프트에 끝난 쪽 없음.
    대기 기한은 24시간, 묶음이 끝날 때마다 다시 셈, 기한이 지나면 no_worker_timeout이고 끝난 쪽은 남음"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = add_paper(env, project, env.a, paper_pages(9, refs_at=None))
    w = Worker(env, env.a)
    real = env.fake_ai.complete

    def complete(system, prompt, engine="claude", schema=None, schema_name="result"):
        if 4 in pages_in(prompt):
            raise ai.AIError("키가 틀려요", "api_auth")
        yield from real(system, prompt, engine, schema, schema_name)

    env.fake_ai.reply = reply
    env.fake_ai.complete = complete
    env.app.state.runner.start(scan=False)
    job = ca.post(f"/api/papers/{pid}/translation", json={}).json()["job"]
    deadline = time.monotonic() + 20
    while (j := ca.get(f"/api/jobs/{job['id']}").json())["runner"] != "cli":
        assert time.monotonic() < deadline, j
        time.sleep(0.1)
    assert j["status"] == "queued" and j["progress"]["counts"]["pages_done"] == 3
    left = sql(project, "select extract(epoch from deadline_at - now()) from paperlab.jobs where id = %s", (job["id"],))[0][0]
    assert 23.9 * 3600 < float(left) <= 24 * 3600
    t = w.claim()["job"]
    assert t["kind"] == "translate_paper" and t["output"] == "json" and t["json_schema"] == translate.TRANSLATE_SCHEMA
    assert pages_in(t["prompt"]) == [4, 5, 6] and t["timeout_s"] == 900
    hb = w.http.post("/api/worker/heartbeat", json={"jobs": [{"id": t["id"], "lease_token": t["lease_token"],
                                                             "progress": {"message": "PC 실행 중"}}]})
    assert hb.status_code == 200
    assert ca.get(f"/api/jobs/{job['id']}").json()["progress"]["counts"]["pages_done"] == 3   # 쪽 수 진행은 남음
    sql(project, "update paperlab.jobs set deadline_at = now() + interval '1 hour' where id = %s", (job["id"],))
    structured = {"pages": [{"page": n, "text": f"PC {n}"} for n in (4, 5, 6)]}
    assert w.result(t, text=json.dumps(structured), structured=structured).json()["status"] == "queued"
    left = sql(project, "select extract(epoch from deadline_at - now()) from paperlab.jobs where id = %s", (job["id"],))[0][0]
    assert float(left) > 23.9 * 3600   # 묶음마다 다시 셈
    tr = ca.get(f"/api/papers/{pid}/translation").json()["translation"]
    assert tr["page_state"] == "dddddd---" and tr["pages"]["5"] == "PC 5"
    # PC가 꺼진 채 기한이 지남 → no_worker_timeout, 끝난 쪽은 남음
    sql(project, "update paperlab.jobs set deadline_at = now() - interval '1 second' where id = %s", (job["id"],))
    j = ca.get(f"/api/jobs/{job['id']}").json()
    assert j["status"] == "failed" and j["error_code"] == "no_worker_timeout"
    assert ca.get(f"/api/papers/{pid}/translation").json()["translation"]["page_state"] == "dddddd---"
    # 이어서 → 남은 쪽만 (같은 PC로)
    r = ca.post(f"/api/papers/{pid}/translation/continue", json={"pages": "pending"})
    assert r.status_code == 202


def test_translation_cancel_continue_and_restart(env, project):
    """AC-P06: 실행 중 취소 → 이번 묶음 뒤 cancelled, d 쪽 유지 → continue pending은 남은 쪽만.
    실행기를 멈췄다 다시 만들면 복구 스캔으로 남은 묶음부터 끝남"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = add_paper(env, project, env.a, paper_pages(9, refs_at=None))
    gate, entered = threading.Event(), threading.Event()
    real = env.fake_ai.complete

    def complete(system, prompt, engine="claude", schema=None, schema_name="result"):
        if 4 in pages_in(prompt):
            entered.set()
            gate.wait(10)
        yield from real(system, prompt, engine, schema, schema_name)

    env.fake_ai.reply = reply
    env.fake_ai.complete = complete
    env.app.state.runner.start(scan=False)
    job = ca.post(f"/api/papers/{pid}/translation", json={}).json()["job"]
    assert entered.wait(15)
    assert ca.post(f"/api/jobs/{job['id']}/cancel").json() == {"status": "running", "cancel_requested": True}
    gate.set()
    assert wait_job(env, ca, job["id"])["status"] == "cancelled"
    assert ca.get(f"/api/papers/{pid}/translation").json()["translation"]["page_state"] == "dddddd---"  # 이번 묶음까지
    env.app.state.runner.stop()
    # 이어서: 실행기가 멈춘 사이 만들고, 잡힌 채 서버가 죽은 것처럼(리스 지남) → 새 서버의 복구 스캔이 이어받음
    n0 = len(env.fake_ai.prompts)
    r = ca.post(f"/api/papers/{pid}/translation/continue", json={"pages": "pending"})
    j2 = r.json()["job"]
    assert r.status_code == 202 and j2["id"] != job["id"]
    sql(project, "update paperlab.jobs set status = 'running', lease_token = gen_random_uuid(), attempts = 1, "
                 "lease_until = now() - interval '1 second' where id = %s", (j2["id"],))
    c2 = env.make()
    c2.fake_ai.reply = reply
    c2.app.state.runner.start(scan=False)
    c2.app.state.runner.scan_once()
    assert c2.wait_job(c2.client(env.a), j2["id"], timeout=30)["status"] == "succeeded"
    assert [pages_in(p) for _, p in c2.fake_ai.prompts] == [[7, 8, 9]] and len(env.fake_ai.prompts) == n0
    assert ca.get(f"/api/papers/{pid}/translation").json()["translation"]["page_state"] == "d" * 9


def test_translation_start_rules(env, project):
    """AC-P08 · P09: 두 번 시작 → 200 같은 작업, 다른 언어 → 409 · replace로 교체(옛 파일 삭제), 101쪽 → 400,
    from 3 to 5 → 3~5쪽만, R2 95% 이상 → 400, 경로 없음 → 400"""
    ca = env.client(env.a)
    pid = add_paper(env, project, env.a, paper_pages(9, refs_at=None))
    r = ca.post(f"/api/papers/{pid}/translation", json={})
    assert r.status_code == 400 and r.json()["code"] == "no_route"
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    r = ca.post(f"/api/papers/{pid}/translation", json={"from": 3, "to": 5})
    assert r.status_code == 202
    j1 = r.json()["job"]
    r2 = ca.post(f"/api/papers/{pid}/translation", json={})
    assert r2.status_code == 200 and r2.json()["job"]["id"] == j1["id"]
    assert ca.get(f"/api/papers/{pid}/translation").json()["translation"]["page_state"] == "..---...."
    for bad in ({"from": 0}, {"from": 5, "to": 3}, {"to": 10}, {"lang": "fr"}):
        ca.post(f"/api/jobs/{j1['id']}/cancel")
        assert ca.post(f"/api/papers/{pid}/translation", json=bad).status_code == 400, bad
    # 같은 언어로 다시: 범위를 넓히면 끝난 쪽은 두고 이어서
    sql(project, "update paperlab.translations set page_state = '..dd-....', refs_from = 3 where paper_id = %s", (pid,))
    r = ca.post(f"/api/papers/{pid}/translation", json={})
    assert r.status_code == 202 and ca.get(f"/api/papers/{pid}/translation").json()["translation"]["page_state"] == "--dd-----"
    assert ca.get(f"/api/papers/{pid}/translation").json()["translation"]["refs_from"] is None   # L-6: 다시 셈
    ca.post(f"/api/jobs/{r.json()['job']['id']}/cancel")
    key = sql(project, "select tr_key from paperlab.translations where paper_id = %s", (pid,))[0][0]
    env.storage.objects[key] = json.dumps({"v": 1, "paper_id": pid, "pdf_sha256": "sha-1", "lang": "ko", "pages": {}}).encode()
    r = ca.post(f"/api/papers/{pid}/translation", json={"lang": "en"})
    assert r.status_code == 409 and r.json()["code"] == "other_lang" and "한국어" in r.json()["detail"]
    r = ca.post(f"/api/papers/{pid}/translation", json={"lang": "en", "replace": True})
    assert r.status_code == 202
    assert key not in env.storage.objects
    row = sql(project, "select lang, tr_key, page_state from paperlab.translations where paper_id = %s", (pid,))[0]
    assert row[0] == "en" and row[1] != key and row[2] == "-" * 9
    ca.post(f"/api/jobs/{r.json()['job']['id']}/cancel")
    # 101쪽 → 400 (범위를 정하면 됨)
    big = add_paper(env, project, env.a, [EN[:200]] * 101)
    r = ca.post(f"/api/papers/{big}/translation", json={})
    assert r.status_code == 400 and "100쪽까지" in r.json()["detail"]
    assert ca.post(f"/api/papers/{big}/translation", json={"from": 1, "to": 100}).status_code == 202
    # 저장 공간 95% 이상
    full = env.make(storage_limit_bytes=0)
    fc = full.client(env.a)
    other = add_paper(env, project, env.a, [EN])
    r = fc.post(f"/api/papers/{other}/translation", json={})
    assert r.status_code == 400 and "저장 공간" in r.json()["detail"]
    # 글자 없는 논문
    blank = add_paper(env, project, env.a, ["", " "])
    assert ca.post(f"/api/papers/{blank}/translation", json={}).json()["detail"] == "글자를 읽을 수 없는 항목이에요(스캔본 · 사진)."


def test_translation_fairness_one_thread(env, project):
    """AC-P12: 실행 스레드 1개 — 번역(묶음 5개)과 다른 사용자 요약을 함께 넣으면 요약이 번역보다 먼저 끝남"""
    c = env.make(runner_opts={"threads": 1})
    c.fake_ai.reply = reply
    ca, cb = c.client(env.a), c.client(env.b)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    cb.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = add_paper(env, project, env.a, ["x " * 2000] * 10)   # 쪽당 4,000자 → 2쪽씩 5묶음
    tj = ca.post(f"/api/papers/{pid}/translation", json={}).json()["job"]
    sj = cb.post(f"/api/papers/{paper(cb)}/summary").json()["job"]
    c.app.state.runner.start(scan=False)
    assert c.wait_job(ca, tj["id"], timeout=30)["status"] == "succeeded"
    assert c.wait_job(cb, sj["id"])["status"] == "succeeded"
    t_end, s_end = (sql(project, "select finished_at from paperlab.jobs where id = %s", (i,))[0][0] for i in (tj["id"], sj["id"]))
    assert s_end < t_end
    assert len([p for _, p in c.fake_ai.prompts if "<page number=" in p]) == 5


# ====================================================================== D. 경계 · 정리
def test_boundaries_between_users(env, project):
    """AC-D02 · D03: B 권한으로 A의 행 0개, B가 A의 pid로 10장 경로 → 404, A의 번역 파일은 읽지 않음"""
    ca, cb = env.client(env.a), env.client(env.b)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = add_paper(env, project, env.a, paper_pages(4, refs_at=None))
    env.fake_ai.reply = reply
    eid = sse(ca, f"/api/papers/{pid}/explain", explain_body())[-1]["item"]["id"]
    env.app.state.runner.start(scan=False)
    jid = ca.post(f"/api/papers/{pid}/translation", json={}).json()["job"]["id"]
    assert wait_job(env, ca, jid)["status"] == "succeeded"
    key = sql(project, "select tr_key from paperlab.translations where paper_id = %s", (pid,))[0][0]
    with env.app.state.db.user_tx({"sub": env.b.id, "role": "authenticated"}) as lib:
        assert lib._one("select (select count(*) from paperlab.explanations) + (select count(*) from paperlab.translations) "
                        "+ (select count(*) from paperlab.jobs where kind in ('explain', 'translate', 'translate_paper')) "
                        "as n")["n"] == 0
    env.storage.log.clear()
    cb.put("/api/settings", json={"anthropic_api_key": KEY})
    for method, url, body in (("post", f"/api/papers/{pid}/explain", explain_body()),
                              ("get", f"/api/papers/{pid}/explanations", None), ("get", f"/api/papers/{pid}/translation", None),
                              ("post", f"/api/papers/{pid}/translation", {}),
                              ("post", f"/api/papers/{pid}/translation/continue", {}),
                              ("delete", f"/api/papers/{pid}/translation", None),
                              ("post", f"/api/papers/{pid}/translation/manuscript", None),
                              ("delete", f"/api/explanations/{eid}", None)):
        r = getattr(cb, method)(url, **({"json": body} if body is not None else {}))
        assert r.status_code == 404, (method, url, r.status_code)
    assert all(k != key for _, k in env.storage.log)
    assert ca.get(f"/api/papers/{pid}/translation").json()["translation"]["pages"]


def test_delete_paper_and_pdf_change_cleanup(env, project):
    """AC-D04: 논문 삭제 → 두 표 행 · 번역 파일 삭제. PDF 교체 → 번역 행 · 파일 삭제 · 대기 번역 작업 cancelled, 설명은 남음"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    env.fake_ai.reply = reply
    env.app.state.runner.start(scan=False)
    pid = env.upload(ca, pdf_with([EN, EN, EN]), "a.pdf")["id"]
    sse(ca, f"/api/papers/{pid}/explain", explain_body())
    jid = ca.post(f"/api/papers/{pid}/translation", json={}).json()["job"]["id"]
    assert wait_job(env, ca, jid)["status"] == "succeeded"
    key = sql(project, "select tr_key from paperlab.translations where paper_id = %s", (pid,))[0][0]
    assert key in env.storage.objects
    # PDF 교체: 실행기를 멈추고 대기 작업을 하나 둔 채로
    env.app.state.runner.stop()
    sql(project, "update paperlab.translations set page_state = '---' where paper_id = %s", (pid,))
    j2 = ca.post(f"/api/papers/{pid}/translation/continue", json={}).json()["job"]
    slot = ca.post(f"/api/papers/{pid}/pdf/upload").json()
    assert env.storage.browser_put(slot["upload"]["url"], pdf_with([EN, EN])) == 200
    assert ca.post(f"/api/papers/{pid}/pdf/complete", json={"upload_id": slot["upload_id"]}).status_code == 200
    assert sql(project, "select count(*) from paperlab.translations where paper_id = %s", (pid,))[0][0] == 0
    assert key not in env.storage.objects
    j = ca.get(f"/api/jobs/{j2['id']}").json()
    assert j["status"] == "cancelled" and j["error"] == "PDF가 바뀌어 번역을 멈췄어요"
    assert sql(project, "select count(*) from paperlab.explanations where paper_id = %s", (pid,))[0][0] == 1
    # 논문 삭제 → 행 · 파일
    env.app.state.runner.start(scan=False)
    jid = ca.post(f"/api/papers/{pid}/translation", json={}).json()["job"]["id"]
    assert wait_job(env, ca, jid)["status"] == "succeeded"
    key = sql(project, "select tr_key from paperlab.translations where paper_id = %s", (pid,))[0][0]
    assert ca.delete(f"/api/papers/{pid}").status_code == 200
    assert ca.post("/api/trash/purge", json={"ids": [pid]}).json() == {"purged": 1}  # 6단계: 휴지통 → 영구 삭제
    assert sql(project, "select (select count(*) from paperlab.translations where paper_id = %s) + "
                        "(select count(*) from paperlab.explanations where paper_id = %s)", (pid, pid))[0][0] == 0
    assert key not in env.storage.objects
    # [번역 지우기]
    pid2 = add_paper(env, project, env.a, [EN])
    jid = ca.post(f"/api/papers/{pid2}/translation", json={}).json()["job"]["id"]
    assert wait_job(env, ca, jid)["status"] == "succeeded"
    key = sql(project, "select tr_key from paperlab.translations where paper_id = %s", (pid2,))[0][0]
    assert ca.delete(f"/api/papers/{pid2}/translation").status_code == 200 and key not in env.storage.objects
    assert ca.get(f"/api/papers/{pid2}/translation").json()["translation"] is None
    assert ca.delete(f"/api/papers/{pid2}/translation").status_code == 404


def test_orphan_translation_files(env, project):
    """AC-D05: admin orphans가 DB에 없는 translations/ 키를 찾고 --delete로 지운다"""
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = add_paper(env, project, env.a, [EN])
    env.fake_ai.reply = reply
    env.app.state.runner.start(scan=False)
    assert wait_job(env, ca, ca.post(f"/api/papers/{pid}/translation", json={}).json()["job"]["id"])["status"] == "succeeded"
    keep = sql(project, "select tr_key from paperlab.translations where paper_id = %s", (pid,))[0][0]
    orphan = f"users/{env.a.id}/translations/{pid}.deadbeef.json"
    env.storage.objects[orphan] = b"{}"
    res = find_orphans(project.admin_db, env.storage)
    assert orphan in res["tr_orphans"] and keep not in res["tr_orphans"]
    find_orphans(project.admin_db, env.storage, delete=True)
    assert orphan not in env.storage.objects and keep in env.storage.objects


def test_settings_engine_rows_and_language(env, project):
    """AC-S01: 설정에 explain · translate 엔진 줄과 translate_language(기본 ko, 그 밖 400)"""
    ca = env.client(env.a)
    s = ca.get("/api/settings").json()
    assert s["translate_language"] == "ko" and s["ai_routing"]["explain"] == ["claude"] and s["ai_routing"]["translate"] == ["claude"]
    assert ca.put("/api/settings", json={"translate_language": "de"}).status_code == 400
    s = ca.put("/api/settings", json={"translate_language": "ja", "ai_routing": {**s["ai_routing"], "translate": ["gemini", "claude"]}}).json()
    assert s["translate_language"] == "ja" and s["ai_routing"]["translate"] == ["gemini", "claude"]
    st = ca.get("/api/ai/status").json()
    assert {"explain", "translate"} <= set(st["kinds"])


def test_logs_hold_no_content(env, project, caplog):
    """AC-L01: 설명 · 선택 번역 · 전체 번역 뒤 앱 로그에 선택 글 · 번역문 · SVG · 제목 · translations/ 키가 없다"""
    caplog.set_level(logging.INFO)
    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = add_paper(env, project, env.a, ["PLANTEDPAGE " + EN] * 2)
    sql(project, "update paperlab.papers set title = 'PLANTEDTITLE paper' where id = %s", (pid,))

    def planted(system, prompt, schema):
        if schema and "one_line" in schema.get("properties", {}):
            return json.dumps({"one_line": "PLANTEDLINE", "easy": "e", "detail": "d",
                               "diagram_svg": SVG.replace("쿼리", "PLANTEDSVG")})
        if schema:
            return json.dumps({"pages": [{"page": n, "text": "PLANTEDTRANS"} for n in pages_in(prompt)]})
        return "PLANTEDTRANS"

    env.fake_ai.reply = planted
    sse(ca, f"/api/papers/{pid}/explain", explain_body(text="SECRETSEL " + SEL))
    sse(ca, f"/api/papers/{pid}/explain", {"kind": "translate", "text": "SECRETSEL " + SEL, "page": 1})
    env.app.state.runner.start(scan=False)
    assert wait_job(env, ca, ca.post(f"/api/papers/{pid}/translation", json={}).json()["job"]["id"])["status"] == "succeeded"
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("paperlab"))
    assert '"event": "explain"' in text and '"event": "translate_chunk"' in text and '"event": "translate_done"' in text
    for bad in ("SECRETSEL", "PLANTEDLINE", "PLANTEDSVG", "PLANTEDTRANS", "PLANTEDTITLE", "PLANTEDPAGE", "/translations/"):
        assert bad not in text, bad


def test_late_stale_run_cannot_erase_newer_pages(env, project):
    """팀장 요청(재현): 리스를 잃은 옛 실행이 늦게 파일을 써도 새 실행이 넣은 쪽이 남는다.
    쓸 때마다 새 세대 키 → 리스 · tr_key가 그대로일 때만 포인터 교체, 아니면 새 키를 지우고 결과를 버림"""
    from paperlab.db import actor_claims
    from paperlab.storage import UserStorage

    ca = env.client(env.a)
    ca.put("/api/settings", json={"anthropic_api_key": KEY})
    pid = add_paper(env, project, env.a, paper_pages(6, refs_at=None))
    jid = ca.post(f"/api/papers/{pid}/translation", json={}).json()["job"]["id"]   # 실행기는 돌리지 않음
    db = env.app.state.db
    tx = lambda: db.user_tx(actor_claims(env.a.id, "api-runner"))  # noqa: E731

    def claim():
        with tx() as lib:
            job = jobs.claim_api(lib, jid)
            pages, _, _ = translate.prepare_chunk(lib, job)
        return str(job["lease_token"]), pages

    t1, pages1 = claim()                       # 옛 실행 E1: 1~3쪽을 잡음
    assert pages1 == [1, 2, 3]

    class Stalling(UserStorage):
        """E1이 파일을 쓰기 직전에 멈춘 사이 E2가 리스를 이어받아 1~6쪽을 끝냄"""
        fired = False

        def put(self, key, data, content_type="application/json"):
            if not Stalling.fired:
                Stalling.fired = True
                sql(project, "update paperlab.jobs set lease_until = now() - interval '1 second' where id = %s", (jid,))
                for _ in range(2):             # E2: 묶음 두 개 (1~3, 4~6)
                    t2, p2 = claim()
                    translate.finish_chunk(tx, UserStorage(env.storage, env.a.id), jid, t2,
                                           {p: f"E2 {p}" for p in p2}, {})
            super().put(key, data, content_type)

    with pytest.raises(jobs.JobError) as e:    # E1이 늦게 끝남 → 리스를 잃어 결과를 버림
        translate.finish_chunk(tx, Stalling(env.storage, env.a.id), jid, t1, {p: f"E1 {p}" for p in pages1}, {})
    assert e.value.code == "lease_lost"
    key = sql(project, "select tr_key from paperlab.translations where paper_id = %s", (pid,))[0][0]
    data = json.loads(env.storage.objects[key])
    assert data["pages"] == {str(p): f"E2 {p}" for p in range(1, 7)}   # E2가 넣은 쪽이 모두 남음
    assert [k for k in env.storage.objects if "/translations/" in k] == [key]   # E1의 새 키 · 옛 세대 키는 지워짐
    tr = ca.get(f"/api/papers/{pid}/translation").json()["translation"]
    assert tr["page_state"] == "dddddd" and tr["pages"]["4"] == "E2 4"
    assert ca.get(f"/api/jobs/{jid}").json()["status"] == "succeeded"
