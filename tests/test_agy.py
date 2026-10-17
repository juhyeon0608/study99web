"""Antigravity(agy) 엔진 — 사용자 PC 워커 전용 새 엔진 (2026-10-17, docs/specs/phase2-worker-electron.md 11.9절).

빠른 시험(DB 없음): 엔진 목록 · 설정 검사(모델 · 생각 깊이) · 경로(API 칸 없음) · 상태 문구 · 워커 광고(모델 목록) 정리 ·
작업 응답의 model · effort · 마이그레이션 글. DB 시험(pytest.mark.db): 가짜 워커가 agy를 광고 → 요약 작업이 PC의 agy로 →
잡기 응답에 고른 모델 · 생각 깊이 → 결과 반영, 새 엔진 제약(20261017000002). 실제 agy는 부르지 않는다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from paperlab import ai, jobs
from paperlab.config import (AGY_DEFAULT_MODEL, API_ENGINES, ENGINE_LABELS, ENGINES, UserSettings, normalize_cli_efforts,
                             normalize_cli_models, normalize_routing, split_settings_changes)

ROOT = Path(__file__).resolve().parent.parent
MODELS = [{"id": "gemini-3.8-flash-high", "label": "Gemini 3.8 Flash (High)"},
          {"id": "gemini-3.8-flash-medium", "label": "Gemini 3.8 Flash (Medium)"},
          {"id": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6 (Thinking)"}]


def pc(engines, **kw):
    return {"id": kw.get("id", 1), "name": "집 PC", "revoked_at": kw.get("revoked_at"), "online": kw.get("online", True),
            "paused": False, "engines": engines}


AGY_PC = pc([{"name": "agy", "version": "1.4.0", "logged_in": True, "slots": 1, "models": MODELS}])


# ---------------------------------------------------------------- 엔진 목록 · 설정
def test_engine_registry():
    assert ENGINES == ("claude", "codex", "gemini", "agy")
    assert API_ENGINES == ("claude", "codex", "gemini") and "agy" not in ai.ENGINE_KEYS and "agy" not in ai.ENGINE_COMPANY
    assert ENGINE_LABELS["agy"] == "Antigravity" and ENGINE_LABELS["gemini"] == "gemini"
    assert AGY_DEFAULT_MODEL == "gemini-3.8-flash-medium"
    assert ai.AIService({}.get).model_name("agy") == "agy"  # API 모델 없음 — KeyError 없이


def test_settings_cli_models_and_efforts():
    s = UserSettings({}, {})
    assert s.get("cli_models")["agy"] == "default" and s.get("cli_efforts") == {"agy": "default"}
    # 옛 저장 값(agy 없음)은 agy 기본으로 채움
    old = UserSettings({"cli_models": {"claude": "opus", "codex": "default", "gemini": "default"}}, {})
    assert old.get("cli_models") == {"claude": "opus", "codex": "default", "gemini": "default", "agy": "default"}
    ok = normalize_cli_models({"claude": "sonnet", "agy": "claude-opus-4-6-thinking"})
    assert ok["agy"] == "claude-opus-4-6-thinking" and ok["gemini"] == "default"
    for bad in ("Gemini Pro", "../x", "a" * 65, "-x", "gemini 3", "모델"):
        with pytest.raises(ValueError):
            normalize_cli_models({"agy": bad})
    with pytest.raises(ValueError):
        normalize_cli_models({"agy": "default", "bash": "x"})
    assert normalize_cli_efforts({"agy": "xhigh"}) == {"agy": "xhigh"}
    assert normalize_cli_efforts({}) == {"agy": "default"}
    for bad in ({"agy": "ultra"}, {"claude": "high"}, ["high"]):
        with pytest.raises(ValueError):
            normalize_cli_efforts(bad)
    plain, _ = split_settings_changes({"cli_efforts": {"agy": "max"}, "cli_models": {"agy": "gemini-3.8-flash-low"}})
    assert plain["cli_efforts"] == {"agy": "max"} and plain["cli_models"]["agy"] == "gemini-3.8-flash-low"
    with pytest.raises(ValueError):
        split_settings_changes({"cli_efforts": {"agy": "turbo"}})
    # 틀린 저장 값은 기본값으로 읽음
    assert UserSettings({"cli_efforts": {"agy": "turbo"}}, {}).get("cli_efforts") == {"agy": "default"}
    # 엔진 순서에 agy (gemini는 그대로)
    r = normalize_routing({"summary": ["agy", "claude"], "chat": ["gemini", "agy"]})
    assert r["summary"] == ["agy", "claude"] and r["chat"] == ["gemini", "agy"]
    with pytest.raises(ValueError, match="Antigravity"):
        normalize_routing({"summary": ["agy", "agy"]})


# ---------------------------------------------------------------- 경로 · 상태
def test_route_agy_is_cli_only():
    keys = UserSettings({"ai_routing": {"summary": ["agy", "gemini"]}}, {"google_api_key": "AIza-user-key-1234567890"})
    assert jobs.build_route("summary", keys.get, []) == [{"runner": "api", "engine": "gemini"}]
    assert jobs.build_route("summary", keys.get, [AGY_PC]) == [{"runner": "cli", "engine": "agy"},
                                                               {"runner": "api", "engine": "gemini"}]
    assert jobs.build_route("summary", keys.get, [AGY_PC], cli_only=True) == [{"runner": "cli", "engine": "agy"}]
    st = jobs.ai_status(keys.get, [AGY_PC], True)
    assert [(s["runner"], s["engine"]) for s in st["kinds"]["summary"]["route"]] == [("cli", "agy"), ("api", "gemini"), ("cli", "gemini")]
    assert st["kinds"]["summary"]["first"] == {"runner": "cli", "engine": "agy"}
    assert st["message"] == "요약은 연결된 내 PC의 Antigravity로 실행해요."
    off = jobs.ai_status(keys.get, [pc(AGY_PC["engines"], online=False)], True)
    assert off["message"].startswith("요약은 연결된 내 PC의 Antigravity로 실행해요. 지금은 켜진 PC가 없어")
    # API 칸의 agy는 받지 않음 (DB에 닿기 전에 거절)
    with pytest.raises(jobs.JobError) as e:
        jobs.create_job(None, "summary", [{"runner": "api", "engine": "agy"}], {})
    assert e.value.code == "no_route"


def test_engines_summary_and_models():
    s = UserSettings({"cli_models": {"agy": "claude-sonnet-4-6"}, "cli_efforts": {"agy": "high"}}, {})
    other = pc([{"name": "agy", "logged_in": False, "models": [MODELS[0], {"id": "gpt-oss-120b-medium", "label": "GPT-OSS"}]}], id=2)
    gone = pc([{"name": "agy", "logged_in": True, "models": [{"id": "gone-model", "label": "x"}]}], id=3, revoked_at="2026-10-01", online=False)
    out = jobs.engines_summary(s.get, [AGY_PC, other, gone])
    assert out["codex"] == {"api_key": False, "devices_online": 0, "devices_total": 0, "cli_model": "default"}
    a = out["agy"]
    assert (a["api_key"], a["devices_online"], a["devices_total"], a["cli_model"], a["cli_effort"]) == (False, 1, 2, "claude-sonnet-4-6", "high")
    assert a["label"] == "Antigravity" and a["default_model"] == AGY_DEFAULT_MODEL
    assert [m["id"] for m in a["models"]] == ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "claude-sonnet-4-6", "gpt-oss-120b-medium"]


def test_cli_options_model_and_effort():
    assert jobs.cli_options(UserSettings({}, {}), "agy") == (AGY_DEFAULT_MODEL, None)
    s = UserSettings({"cli_models": {"agy": "claude-opus-4-6-thinking", "claude": "opus"}, "cli_efforts": {"agy": "low"}}, {})
    assert jobs.cli_options(s, "agy") == ("claude-opus-4-6-thinking", "low")
    assert jobs.cli_options(s, "claude") == ("opus", None)
    assert jobs.cli_options(s, "gemini") == (None, None)


# ---------------------------------------------------------------- 워커 광고 정리
def test_clean_engines_agy_models():
    raw = [{"name": "claude", "version": "2.1.300", "logged_in": True, "slots": 2, "models": [{"id": "x-y"}]},
           {"name": "agy", "version": "1.4.0", "logged_in": True, "slots": 1,
            "models": [*MODELS, {"id": "BAD MODEL", "label": "x"}, {"id": "gemini-3.8-flash-high", "label": "중복"},
                       {"id": "evil- ", "label": "x"}, "not-a-dict", {"id": "ok-model", "label": "a\x00b c" + "z" * 200}]}]
    out = jobs.clean_engines(raw)
    assert out[0] == {"name": "claude", "version": "2.1.300", "logged_in": True, "slots": 2}  # models는 agy만
    agy = out[1]
    assert [m["id"] for m in agy["models"]] == ["gemini-3.8-flash-high", "gemini-3.8-flash-medium", "claude-sonnet-4-6", "ok-model"]
    assert agy["models"][3]["label"] == ("abc" + "z" * 200)[:80]
    many = jobs.clean_engines([{"name": "agy", "logged_in": True, "models": [{"id": f"m-{i}", "label": str(i)} for i in range(100)]}])
    assert len(many[0]["models"]) == jobs.AGY_MODELS_MAX == 40
    assert jobs.clean_engines([{"name": "agy", "logged_in": False, "models": "x"}])[0]["models"] == []
    with pytest.raises(jobs.JobError):  # 네 엔진까지
        jobs.clean_engines([{"name": n} for n in ("claude", "codex", "gemini", "agy", "claude")])
    with pytest.raises(jobs.JobError):
        jobs.clean_engines([{"name": "antigravity"}])


def test_migration_widens_engine_check():
    sql = (ROOT / "supabase" / "migrations" / "20261017000002_agy_engine.sql").read_text(encoding="utf-8")
    assert "drop constraint if exists jobs_engine_check" in sql
    assert "check (engine in ('claude', 'codex', 'gemini', 'agy', 'local'))" in sql


# ---------------------------------------------------------------- DB (가짜 워커)
from .test_jobs import SUMMARY_TEXT, Worker, ab, env, paper, sql  # noqa: E402,F401 - 픽스처 · 가짜 워커 그대로


@pytest.mark.db
def test_agy_worker_end_to_end(env, project):
    ca = env.client(env.a)
    w = Worker(env, env.a, engines=(("claude", True),), name="AGY")
    r = w.http.post("/api/worker/hello", json={"app_version": "0.4.1", "protocol": 1, "os": "Windows 11", "paused": False,
                                               "engines": [{"name": "agy", "version": "1.4.0", "logged_in": True, "slots": 1,
                                                            "models": MODELS + [{"id": "BAD ID", "label": "x"}]}]})
    assert r.status_code == 200, r.text
    dev = next(d for d in ca.get("/api/devices").json() if d["id"] == w.id)
    assert dev["engines"] == [{"name": "agy", "version": "1.4.0", "logged_in": True, "slots": 1, "models": MODELS}]
    eng = ca.get("/api/ai/engines").json()
    assert eng["agy"]["devices_online"] == 1 and [m["id"] for m in eng["agy"]["models"]] == [m["id"] for m in MODELS]

    # 설정: 엔진 순서 · 모델 · 생각 깊이 저장
    s = ca.put("/api/settings", json={"ai_routing": {"summary": ["agy"]}, "cli_models": {"agy": "claude-sonnet-4-6"},
                                      "cli_efforts": {"agy": "high"}})
    assert s.status_code == 200, s.text
    assert s.json()["cli_models"]["agy"] == "claude-sonnet-4-6" and s.json()["cli_efforts"] == {"agy": "high"}
    assert ca.put("/api/settings", json={"cli_efforts": {"agy": "turbo"}}).status_code == 400
    assert ca.put("/api/settings", json={"cli_models": {"agy": "Bad Model"}}).status_code == 400
    st = ca.get("/api/ai/status").json()
    assert st["kinds"]["summary"]["first"] == {"runner": "cli", "engine": "agy"} and "Antigravity" in st["message"]

    # 요약 → PC의 agy (새 엔진 제약 통과) → 잡기 응답에 model · effort → 결과 반영
    pid = paper(ca)
    j = ca.post(f"/api/papers/{pid}/summary").json()["job"]
    assert (j["runner"], j["engine"]) == ("cli", "agy")
    assert w.claim(claude=2)["job"] is None  # agy 자리를 내지 않으면 받지 않음
    task = w.claim(agy=1)["job"]
    assert task["engine"] == "agy" and task["model"] == "claude-sonnet-4-6" and task["effort"] == "high"
    assert task["output"] == "json" and task["prompt"]
    assert w.result(task, "succeeded", SUMMARY_TEXT).json()["status"] == "succeeded"
    done = ca.get(f"/api/jobs/{j['id']}").json()
    assert done["status"] == "succeeded" and done["engine"] == "agy"

    # 기본 설정이면 PaperLab 기본 모델 · 생각 깊이 없음, 실패 결과는 그대로 (cli_not_logged_in → 이 PC 빼고 다시 대기)
    ca.put("/api/settings", json={"cli_models": {"agy": "default"}, "cli_efforts": {"agy": "default"}})
    j2 = ca.post(f"/api/papers/{paper(ca)}/summary").json()["job"]
    t2 = w.claim(agy=1)["job"]
    assert t2["id"] == j2["id"] and t2["model"] == AGY_DEFAULT_MODEL and t2["effort"] is None
    assert w.result(t2, "failed", error_code="cli_not_logged_in", error="이 PC의 Antigravity가 로그인돼 있지 않아요").json()["status"] == "queued"
    assert ca.get(f"/api/jobs/{j2['id']}").json()["history"][-1]["engine"] == "agy"
    rows = sql(project, "select engine from paperlab.jobs where id = %s", (j2["id"],))
    assert rows == [("agy",)]
