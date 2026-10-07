from types import SimpleNamespace as NS

from paperlab import ai


def test_normalize_summary_fills_shape():
    out = ai.normalize_summary({"tldr": "짧게", "sections": [{"heading": "서론", "levels": {"high": "고"}}],
                                "formulas": [{"latex": "$$E=mc^2$$", "page": "3"}]})
    assert out["overview"] == {k: "" for k in ai.LEVELS}
    assert out["sections"][0]["levels"]["high"] == "고" and out["sections"][0]["levels"]["graduate"] == ""
    assert out["formulas"][0]["latex"] == "E=mc^2" and out["formulas"][0]["page"] == 3


def test_extract_json_from_fenced_text():
    assert ai._extract_json('설명\n```json\n{"a": 1}\n```') == {"a": 1}


def test_cli_citations():
    text, cites = ai.cli_citations("결과는 좋다 [p.3]. 방법은 [p.2, 5] 참고.")
    assert text == "결과는 좋다 [1]. 방법은 [2][3] 참고."
    assert [c["page"] for c in cites] == [3, 2, 5]


def test_api_citations_page_location():
    content = [
        NS(type="text", text="Transformer는 순환 구조를 쓰지 않습니다", citations=[
            NS(type="page_location", start_page_number=2, end_page_number=3, cited_text="dispensing with recurrence")]),
        NS(type="text", text=". 끝.", citations=None),
        NS(type="thinking", thinking=""),
    ]
    text, cites = ai.api_citations(content, page_based=True)
    assert text == "Transformer는 순환 구조를 쓰지 않습니다[1]. 끝."
    assert cites == [{"n": 1, "page": 2, "end_page": 2, "text": "dispensing with recurrence"}]


def test_text_fallback_document_uses_page_blocks():
    svc = ai.AIService(lambda k: {"model": "claude-opus-5-5"}.get(k, ""))
    ctx = ai.PaperContext(title="T", pdf_bytes=None, page_texts=["p1", "p2"])
    block = svc._document_block(ctx, citations=True)
    assert block["source"]["type"] == "content"
    assert [c["text"] for c in block["source"]["content"]] == ["p1", "p2"]
    assert block["citations"] == {"enabled": True}


def test_request_kwargs_by_model():
    kw = ai.AIService(lambda k: {"model": "claude-opus-5-5", "effort": "high"}.get(k, ""))._request_kwargs()
    assert kw["output_config"] == {"effort": "high"} and kw["fallbacks"] == "default"
    kw = ai.AIService(lambda k: {"model": "claude-haiku-4-5"}.get(k, ""))._request_kwargs()
    assert kw == {"model": "claude-haiku-4-5"}


# ---- Anthropic SDK 호출을 가짜 전송 계층으로 끝까지 확인한다 (네트워크 없음) ----
import json as _json

import httpx2
from anthropic import DefaultHttpxClient

from .conftest import make_pdf


def _sse(events):
    return "".join(f"event: {e['type']}\ndata: {_json.dumps(e)}\n\n" for e in events).encode()


def _message_events(text_blocks, stop_reason="end_turn"):
    ev = [{"type": "message_start", "message": {
        "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5", "content": [],
        "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 0}}}]
    for i, (text, cites) in enumerate(text_blocks):
        ev.append({"type": "content_block_start", "index": i,
                   "content_block": {"type": "text", "text": "", **({"citations": []} if cites else {})}})
        for c in cites:
            ev.append({"type": "content_block_delta", "index": i, "delta": {"type": "citations_delta", "citation": c}})
        ev.append({"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": text}})
        ev.append({"type": "content_block_stop", "index": i})
    ev.append({"type": "message_delta", "delta": {"stop_reason": stop_reason, "stop_sequence": None},
               "usage": {"output_tokens": 5}})
    ev.append({"type": "message_stop"})
    return _sse(ev)


def _service(body: bytes, captured: list):
    def handler(request: httpx2.Request):
        captured.append(request)
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    client = DefaultHttpxClient(transport=httpx2.MockTransport(handler))
    settings = {"model": "claude-opus-5-5", "effort": "medium", "anthropic_api_key": "sk-test", "ai_engine": "api"}
    return ai.AIService(settings.get, http_client=client)


def test_summarize_request_and_parse():
    summary = {k: v for k, v in ai.normalize_summary({"tldr": "핵심"}).items()}
    captured = []
    svc = _service(_message_events([(_json.dumps(summary, ensure_ascii=False), [])]), captured)
    ctx = ai.PaperContext(title="ResNet", pdf_bytes=make_pdf(), page_texts=["p1", "p2"])
    out = svc.summarize(ctx)
    assert out["tldr"] == "핵심"
    req = captured[0]
    body = _json.loads(req.content)
    assert req.headers["anthropic-beta"] == "server-side-fallback-2026-07-01"
    assert body["model"] == "claude-opus-5-5" and body["stream"] is True and body["fallbacks"] == "default"
    assert body["output_config"]["effort"] == "medium"
    assert body["output_config"]["format"]["type"] == "json_schema"
    doc = body["messages"][0]["content"][0]
    assert doc["source"]["media_type"] == "application/pdf" and "citations" not in doc
    assert doc["cache_control"] == {"type": "ephemeral"}


def test_chat_stream_with_page_citations():
    cite = {"type": "page_location", "cited_text": "residual learning", "document_index": 0,
            "document_title": "ResNet", "start_page_number": 2, "end_page_number": 3}
    captured = []
    svc = _service(_message_events([("잔차 학습을 씁니다", [cite]), (".", [])]), captured)
    ctx = ai.PaperContext(title="ResNet", pdf_bytes=make_pdf(), page_texts=["p1", "p2"])
    history = [{"role": "user", "content": "첫 질문"}, {"role": "assistant", "content": "첫 답"}]
    events = list(svc.chat(ctx, history, "두 번째 질문"))
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "잔차 학습을 씁니다."
    done = events[-1]
    assert done["text"] == "잔차 학습을 씁니다[1]." and done["citations"][0]["page"] == 2
    body = _json.loads(captured[0].content)
    msgs = body["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert msgs[0]["content"][0]["citations"] == {"enabled": True}  # 문서는 첫 메시지에 고정 → 캐시 재사용
    assert msgs[2]["content"] == "두 번째 질문"


def test_refusal_is_reported():
    svc = _service(_message_events([("", [])], stop_reason="refusal"), [])
    ctx = ai.PaperContext(title="T", pdf_bytes=None, page_texts=["text"])
    try:
        list(svc.chat(ctx, [], "q"))
        raise AssertionError("refusal not raised")
    except ai.AIError as e:
        assert "안전 정책" in str(e)


def test_cli_engine_with_fake_claude(tmp_path, monkeypatch):
    """CLI 엔진(2단계용 코드)을 **가짜 claude**로만 확인한다. 이 PC의 실제 claude CLI는 절대 부르지 않는다:
    가짜를 PATH 맨 앞에 두고(os.pathsep), Windows는 claude.cmd 래퍼, 시작할 때 shutil.which가 가짜를 가리키는지 단언.
    가짜는 호출 기록 파일을 남긴다(실제로 가짜가 불렸는지 확인)."""
    import os
    import shutil
    import sys

    calls = tmp_path / "calls.jsonl"
    script = tmp_path / "fake_claude.py"
    script.write_text(
        "import json, sys\n"
        "args = sys.argv[1:]\n"
        "sys.stdin.reconfigure(encoding='utf-8')\n"
        "prompt = sys.stdin.read()\n"
        f"open({str(calls)!r}, 'a', encoding='utf-8').write(json.dumps({{'args': args}}, ensure_ascii=False) + '\\n')\n"
        "assert '-p' in args and '--tools' in args and '<page number=\"2\">' in prompt\n"
        "sys.stdout.reconfigure(encoding='utf-8')\n"
        "print(json.dumps({'type': 'result', 'is_error': False, 'result': '두 번째 쪽에 나와요 [p.2]'}))\n",
        encoding="utf-8")
    if sys.platform == "win32":
        fake = tmp_path / "claude.cmd"
        # cmd는 배치 파일을 OEM 코드 페이지로 읽는다 (파이썬 경로에 한글이 있을 수 있음)
        fake.write_text(f'@echo off\r\n"{sys.executable}" "{script}" %*\r\n', encoding="oem")
    else:
        fake = tmp_path / "claude"
        fake.write_text(f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n', encoding="utf-8")
        fake.chmod(0o755)
    monkeypatch.setenv("PATH", str(tmp_path) + os.pathsep + os.environ.get("PATH", ""))
    found = shutil.which("claude")
    # 가짜를 못 찾으면 여기서 멈춘다 — 실제 CLI가 불리지 않게
    assert found and os.path.samefile(found, fake), f"가짜 claude가 아닌 것을 찾았어요: {found}"
    # 모델 인자는 가짜 CLI 기준(실제 CLI의 모델 이름 지원 여부는 2단계 범위)
    svc = ai.AIService({"ai_engine": "cli", "model": "fake-model"}.get, cli_enabled=True)
    assert svc.status()["ready"]
    ctx = ai.PaperContext(title="T", pdf_bytes=None, page_texts=["첫 쪽", "둘째 쪽"])
    done = list(svc.chat(ctx, [], "어디에 나와?"))[-1]
    assert done["text"] == "두 번째 쪽에 나와요 [1]" and done["citations"][0]["page"] == 2
    logged = calls.read_text(encoding="utf-8").splitlines()
    assert len(logged) == 1 and "--model" in logged[0] and "fake-model" in logged[0]


def test_pdf_limits_fall_back_to_text():
    big = ai.PaperContext(title="T", pdf_bytes=b"%PDF" + b"0" * (23 * 1024 * 1024), page_texts=["a"])
    assert not big.usable_pdf("claude-opus-5-5")
    long = ai.PaperContext(title="T", pdf_bytes=b"%PDF", page_texts=["p"] * 150)
    assert long.usable_pdf("claude-opus-5-5") and not long.usable_pdf("claude-haiku-4-5")
    svc = ai.AIService({"model": "claude-haiku-4-5"}.get)
    assert svc._document_block(long, citations=True)["source"]["type"] == "content"
