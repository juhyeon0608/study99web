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


def test_pdf_limits_fall_back_to_text():
    big = ai.PaperContext(title="T", pdf_bytes=b"%PDF" + b"0" * (23 * 1024 * 1024), page_texts=["a"])
    assert not big.usable_pdf("claude-opus-5-5")
    long = ai.PaperContext(title="T", pdf_bytes=b"%PDF", page_texts=["p"] * 150)
    assert long.usable_pdf("claude-opus-5-5") and not long.usable_pdf("claude-haiku-4-5")
    svc = ai.AIService({"model": "claude-haiku-4-5"}.get)
    assert svc._document_block(long, citations=True)["source"]["type"] == "content"


# ---- 2단계: CLI 요청 만들기 · 결과 해석 (AC-60 대체), OpenAI · Google 텍스트 API (U2 — 가짜 전송, 실제 호출 없음) ----
import httpx
import pytest


def test_text_requests_carry_paper_text_and_rules():
    ctx = ai.PaperContext(title="ResNet", pdf_bytes=None, page_texts=["첫 쪽", "둘째 쪽"])
    system, prompt = ai.summary_request(ctx, "한국어")
    assert system == ai.SUMMARY_SYSTEM and '<page number="2">\n둘째 쪽' in prompt and '"tldr"' in prompt
    system, prompt = ai.chat_request(ctx, [{"role": "user", "content": "앞 질문"}], "어디?", "한국어")
    assert "[p.쪽번호]" in system and "사용자: 앞 질문" in prompt and prompt.endswith("질문: 어디?")
    system, prompt = ai.write_request("polish", "고칠 글", sources=[{"key": "he2016", "title": "ResNet"}])
    assert system == ai.WRITE_SYSTEM and '<source key="he2016">' in prompt and "<text>\n고칠 글\n</text>" in prompt
    with pytest.raises(ai.AIError):
        ai.summary_request(ai.PaperContext(title="T", pdf_bytes=None, page_texts=[]), "한국어")


def test_parse_text_result_by_kind():
    out = ai.parse_text_result("summary", '설명\n```json\n{"tldr": "핵심"}\n```')
    assert out["summary"]["tldr"] == "핵심"
    assert ai.parse_text_result("summary", "", {"tldr": "구조"})["summary"]["tldr"] == "구조"
    chat = ai.parse_text_result("chat", "결과 [p.3]")
    assert chat["text"] == "결과 [1]" and chat["citations"][0]["page"] == 3
    assert ai.parse_text_result("write", "  다듬은 글 ") == {"text": "다듬은 글"}
    for kind, text in (("summary", "JSON 아님"), ("chat", "  ")):
        with pytest.raises(ai.AIError) as e:
            ai.parse_text_result(kind, text)
        assert e.value.code == "bad_output"


def test_server_has_no_cli_execution():
    """AC-60: 서버 코드에 subprocess · shutil.which("claude")가 없음 (CLI는 PC 워커만)"""
    from pathlib import Path
    src = Path(ai.__file__).parent
    for f in src.glob("*.py"):
        text = f.read_text(encoding="utf-8")
        assert 'which("claude")' not in text, f.name
        if f.name in ("ai.py", "jobs.py", "worker_api.py", "api_runner.py", "server.py"):
            assert "subprocess" not in text, f.name


def _text_service(engine, handler, **settings):
    client = httpx.Client(transport=httpx.MockTransport(handler))
    base = {"openai_api_key": "sk-test-openai-key-123", "google_api_key": "AIza-test-google-key-123"}
    base.update(settings)
    return ai.AIService(base.get, http_client=client)


@pytest.mark.parametrize("engine", ["codex", "gemini"])
def test_text_api_request_shape_text_only_key_in_header(engine):
    """AC-46 (요청 모양): PDF 없이 본문 글만, 키는 헤더로만(주소 쿼리에 없음), 기본 모델 = K19 후보"""
    seen = []

    def handler(request):
        seen.append(request)
        if engine == "codex":
            return httpx.Response(200, json={"status": "completed", "output": [{"type": "message", "content": [
                {"type": "output_text", "text": '{"tldr": "핵심"}'}]}]})
        return httpx.Response(200, json={"candidates": [{"finishReason": "STOP", "content": {"parts": [
            {"text": '{"tldr": "핵심"}'}]}}]})

    svc = _text_service(engine, handler)
    ctx = ai.PaperContext(title="ResNet", pdf_bytes=b"%PDF-1.7 binary", page_texts=["본문 첫 쪽 글"])
    out = svc.summarize(ctx, engine=engine)
    assert out["tldr"] == "핵심"
    req = seen[0]
    body = req.content.decode("utf-8")
    assert "본문 첫 쪽 글" in body and "application/pdf" not in body and "JVBER" not in body
    assert "key" not in str(req.url.query).lower() and "sk-test" not in str(req.url) and "AIza" not in str(req.url)
    if engine == "codex":
        assert req.headers["authorization"] == "Bearer sk-test-openai-key-123"
        data = _json.loads(body)
        assert data["model"] == ai.API_MODEL_DEFAULTS["codex"] and data["text"]["format"]["type"] == "json_schema"
    else:
        assert req.headers["x-goog-api-key"] == "AIza-test-google-key-123"
        assert ai.API_MODEL_DEFAULTS["gemini"] in str(req.url)


@pytest.mark.parametrize("status,code", [(401, "api_auth"), (403, "api_permission"), (429, "api_rate_limit"),
                                         (500, "api_server"), (503, "api_overloaded"), (400, "api_bad_request")])
@pytest.mark.parametrize("engine", ["codex", "gemini"])
def test_text_api_http_errors_map_to_codes(engine, status, code):
    """AC-47 (오류 판정): 오류 문구에 키가 남지 않음"""
    svc = _text_service(engine, lambda r: httpx.Response(status, text="bad key sk-test-openai-key-123"))
    with pytest.raises(ai.AIError) as e:
        svc.text_complete(engine, "s", "p")
    assert e.value.code == code and "sk-test" not in str(e.value) and "AIza" not in str(e.value)


def test_text_api_refusal_and_truncation():
    cases = [
        ("codex", {"output": [{"type": "message", "content": [{"type": "refusal", "refusal": "no"}]}]}, "api_refusal"),
        ("codex", {"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}, "output": []},
         "api_max_tokens"),
        ("gemini", {"promptFeedback": {"blockReason": "SAFETY"}}, "api_refusal"),
        ("gemini", {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": []}}]}, "api_max_tokens"),
    ]
    for engine, body, code in cases:
        svc = _text_service(engine, lambda r, b=body: httpx.Response(200, json=b))
        with pytest.raises(ai.AIError) as e:
            svc.text_complete(engine, "s", "p")
        assert e.value.code == code, (engine, body)


def test_text_api_connection_errors():
    def boom(request):
        raise httpx.ConnectError("down")

    with pytest.raises(ai.AIError) as e:
        _text_service("codex", boom).text_complete("codex", "s", "p")
    assert e.value.code == "api_connection"
    with pytest.raises(ai.AIError) as e:
        ai.AIService({}.get).text_complete("gemini", "s", "p")
    assert e.value.code == "api_no_key"
