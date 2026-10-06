"""AI 기능: 수준별·섹션별 요약, 수식 풀이, 논문과 대화(Q&A, 쪽 번호 근거 포함).

두 가지 엔진을 지원한다.
- api: Anthropic API (anthropic SDK). PDF를 그대로 보내 그림·수식까지 읽고, 답변에 쪽 단위 인용이 붙는다.
- cli: 이미 설치된 Claude Code CLI(`claude -p`). API 키 없이 쓸 수 있고, 추출한 텍스트만 보낸다.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from typing import Callable, Iterator

import anthropic

MODELS = {
    "claude-opus-5-5": "Claude Opus 5.5 (기본, 가장 정확)",
    "claude-sonnet-5-5": "Claude Sonnet 5.5 (빠르고 저렴)",
    "claude-haiku-4-5": "Claude Haiku 4.5 (가장 빠름)",
}
# effort와 서버측 거절 대체(fallbacks)를 받는 모델
EFFORT_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-fable-5-1"}
FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"}
FALLBACK_BETA = "server-side-fallback-2026-07-01"

# 요청 한도는 32MB이고 base64로 바꾸면 약 4/3배가 되므로 원본은 22MB까지만 PDF로 보낸다
MAX_PDF_BYTES = 22 * 1024 * 1024
MAX_PDF_PAGES = 600
SMALL_CONTEXT_MODELS = {"claude-haiku-4-5"}  # 200K 문맥 모델은 PDF 100쪽까지

LEVELS = ("elementary", "middle", "high", "graduate")
_LEVEL_SCHEMA = {
    "type": "object",
    "properties": {k: {"type": "string"} for k in LEVELS},
    "required": list(LEVELS),
    "additionalProperties": False,
}
SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {
        "tldr": {"type": "string"},
        "keywords": {"type": "array", "items": {"type": "string"}},
        "research_question": {"type": "string"},
        "method": {"type": "string"},
        "results": {"type": "string"},
        "overview": _LEVEL_SCHEMA,
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "heading": {"type": "string"},
                    "page": {"type": "integer"},
                    "summary": {"type": "string"},
                    "keyPoints": {"type": "array", "items": {"type": "string"}},
                    "levels": _LEVEL_SCHEMA,
                },
                "required": ["heading", "page", "summary", "keyPoints", "levels"],
                "additionalProperties": False,
            },
        },
        "formulas": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "latex": {"type": "string"},
                    "page": {"type": "integer"},
                    "meaning": {"type": "string"},
                    "variables": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"symbol": {"type": "string"}, "meaning": {"type": "string"}},
                            "required": ["symbol", "meaning"],
                            "additionalProperties": False,
                        },
                    },
                    "derivation": {"type": "string"},
                },
                "required": ["name", "latex", "page", "meaning", "variables", "derivation"],
                "additionalProperties": False,
            },
        },
        "contributions": {"type": "array", "items": {"type": "string"}},
        "limitations": {"type": "array", "items": {"type": "string"}},
        "questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["tldr", "keywords", "research_question", "method", "results", "overview", "sections",
                 "formulas", "contributions", "limitations", "questions"],
    "additionalProperties": False,
}

SUMMARY_PROMPT = """첨부한 논문을 {lang}로 정리해 주세요. 독자가 이 논문을 처음 읽는다고 생각하고, 아래 기준을 지켜 주세요.

- tldr: 핵심을 한두 문장으로.
- research_question / method / results: 무엇을 묻고, 어떻게 풀었고, 무엇을 얻었는지. 결과에는 논문의 실제 수치를 넣으세요.
- overview: 논문 전체를 네 수준으로 설명합니다.
  - elementary: 초등학생도 이해하도록 비유와 일상 예시로, 전문 용어 없이.
  - middle: 중학생 수준. 꼭 필요한 용어는 풀어서.
  - high: 고등학생 수준. 기본 수학·과학 개념은 써도 됩니다.
  - graduate: 대학원생·연구자 수준. 기술적 세부와 기존 연구와의 차이까지.
- sections: 논문의 실제 섹션 순서대로(초록·서론·방법·실험·결론 등). page는 그 섹션이 시작하는 PDF 쪽 번호(1부터). levels는 그 섹션을 위의 네 수준으로 각각 설명합니다.
- formulas: 논문의 핵심 수식(최대 8개). latex에는 $ 기호 없이 KaTeX로 렌더링 가능한 LaTeX만. variables에 각 기호의 뜻, derivation에 이 식이 어떻게 나왔는지 단계별 풀이. 수식이 없는 논문이면 빈 배열.
- contributions / limitations: 논문이 주장하는 기여와, 논문이 밝히거나 독자가 짚어볼 한계.
- questions: 이 논문을 읽고 나서 스스로 답해 볼 만한 질문 3~5개.
- keywords: 핵심 용어 5~10개 (원어 유지).

논문에 없는 내용은 지어내지 말고, 확실하지 않으면 그렇다고 쓰세요."""

CHAT_SYSTEM = """당신은 연구자가 논문을 이해하도록 돕는 조수입니다. 첨부된 논문을 근거로 {lang}로 답하세요.
- 논문에서 확인되는 내용은 해당 부분을 인용해 근거를 보여 주세요.
- 논문에 없는 내용을 물으면 논문에는 없다고 먼저 밝히고, 일반 지식으로 답할 때는 그렇다고 구분해 주세요.
- 수식은 $...$(인라인) 또는 $$...$$(블록) LaTeX로 쓰세요.
- 답은 핵심부터, 필요한 만큼만 길게."""

CLI_CITE_RULE = "\n- 근거가 되는 쪽은 문장 끝에 [p.쪽번호] 형식으로 표시하세요 (예: [p.3])."


class AIError(Exception):
    pass


@dataclass
class PaperContext:
    title: str
    pdf_bytes: bytes | None
    page_texts: list[str]
    abstract: str = ""

    def usable_pdf(self, model: str = "") -> bool:
        limit = 100 if model in SMALL_CONTEXT_MODELS else MAX_PDF_PAGES
        return bool(self.pdf_bytes) and len(self.pdf_bytes) <= MAX_PDF_BYTES and \
            0 < len(self.page_texts) <= limit

    def text_pages(self) -> list[str]:
        pages = [t.strip() for t in self.page_texts]
        if any(pages):
            return pages
        if self.abstract:
            return [f"제목: {self.title}\n\n초록: {self.abstract}"]
        return []

    def tagged_text(self) -> str:
        return "\n\n".join(f'<page number="{i + 1}">\n{t}\n</page>' for i, t in enumerate(self.text_pages()))


def _extract_json(text: str) -> dict:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if m:
        text = m.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise AIError("AI 응답에서 JSON을 찾지 못했어요")
    try:
        return json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise AIError(f"AI 응답 JSON을 읽지 못했어요: {e}") from e


def normalize_summary(data: dict) -> dict:
    """CLI 응답처럼 스키마가 강제되지 않은 결과도 화면이 기대하는 모양으로 맞춘다."""
    out = {k: data.get(k) for k in SUMMARY_SCHEMA["properties"]}
    for k in ("tldr", "research_question", "method", "results"):
        out[k] = str(out[k] or "")
    for k in ("keywords", "contributions", "limitations", "questions"):
        out[k] = [str(x) for x in (out[k] or []) if x]
    ov = out["overview"] if isinstance(out["overview"], dict) else {}
    out["overview"] = {lv: str(ov.get(lv) or "") for lv in LEVELS}
    secs = []
    for s in out["sections"] or []:
        if not isinstance(s, dict):
            continue
        lv = s.get("levels") if isinstance(s.get("levels"), dict) else {}
        secs.append({"heading": str(s.get("heading") or ""), "page": _int(s.get("page")),
                     "summary": str(s.get("summary") or ""),
                     "keyPoints": [str(x) for x in s.get("keyPoints") or []],
                     "levels": {k: str(lv.get(k) or "") for k in LEVELS}})
    out["sections"] = secs
    forms = []
    for f in out["formulas"] or []:
        if not isinstance(f, dict):
            continue
        latex = str(f.get("latex") or "").strip()
        latex = re.sub(r"^\$+|\$+$", "", latex).strip()
        latex = re.sub(r"^\\\[|\\\]$", "", latex).strip()
        forms.append({"name": str(f.get("name") or ""), "latex": latex, "page": _int(f.get("page")),
                      "meaning": str(f.get("meaning") or ""), "derivation": str(f.get("derivation") or ""),
                      "variables": [{"symbol": str(v.get("symbol") or ""), "meaning": str(v.get("meaning") or "")}
                                    for v in f.get("variables") or [] if isinstance(v, dict)]})
    out["formulas"] = forms
    return out


def _int(v) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


ProgressFn = Callable[[str, float | None], None]


class AIService:
    def __init__(self, get_setting: Callable[[str], str], http_client=None):
        self.get_setting = get_setting
        self._http_client = http_client  # 테스트에서 가짜 전송 계층을 넣을 때 쓴다

    @property
    def engine(self) -> str:
        return self.get_setting("ai_engine") or "api"

    @property
    def model(self) -> str:
        return self.get_setting("model") or "claude-opus-5-5"

    def status(self) -> dict:
        if self.engine == "cli":
            path = shutil.which("claude")
            return {"engine": "cli", "ready": bool(path),
                    "message": "Claude CLI를 찾았어요" if path else "claude 명령을 찾지 못했어요. Claude Code를 설치하고 로그인해 주세요."}
        has_key = bool(self.get_setting("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY")
                       or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
        return {"engine": "api", "ready": has_key, "model": self.model,
                "message": "API 키가 설정돼 있어요" if has_key else "설정에서 Anthropic API 키를 넣어주세요."}

    # ------------------------------------------------------------ API engine
    def _client(self) -> anthropic.Anthropic:
        kw = {"http_client": self._http_client} if self._http_client else {}
        key = self.get_setting("anthropic_api_key") or None
        return anthropic.Anthropic(api_key=key, **kw) if key else anthropic.Anthropic(**kw)

    def _request_kwargs(self, effort: str | None = None) -> dict:
        kw: dict = {"model": self.model}
        if self.model in EFFORT_MODELS:
            kw["output_config"] = {"effort": effort or self.get_setting("effort") or "medium"}
        if self.model in FALLBACK_MODELS:
            # 안전 분류기가 요청을 거절하면 서버가 권장 모델로 다시 실행한다
            kw["betas"] = [FALLBACK_BETA]
            kw["fallbacks"] = "default"
        return kw

    def _document_block(self, ctx: PaperContext, citations: bool) -> dict:
        if ctx.usable_pdf(self.model):
            block = {"type": "document",
                     "source": {"type": "base64", "media_type": "application/pdf",
                                "data": base64.standard_b64encode(ctx.pdf_bytes).decode("ascii")}}
        else:
            pages = ctx.text_pages()
            if not pages:
                raise AIError("이 논문에는 읽을 수 있는 본문이나 초록이 없어요. PDF를 첨부해 주세요.")
            # 쪽마다 블록을 나눠 두면 인용 위치(블록 번호)가 곧 쪽 번호가 된다
            block = {"type": "document",
                     "source": {"type": "content",
                                "content": [{"type": "text", "text": t or "(빈 쪽)"} for t in pages]}}
        block["title"] = (ctx.title or "논문")[:500]
        if citations:
            block["citations"] = {"enabled": True}
        block["cache_control"] = {"type": "ephemeral"}
        return block

    def _call_errors(self, e: Exception) -> AIError:
        if isinstance(e, anthropic.AuthenticationError):
            return AIError("API 키가 올바르지 않아요. 설정에서 확인해 주세요.")
        if isinstance(e, anthropic.PermissionDeniedError):
            return AIError("이 API 키로는 선택한 모델을 쓸 수 없어요.")
        if isinstance(e, anthropic.NotFoundError):
            return AIError("모델을 찾을 수 없어요. 설정에서 모델을 확인해 주세요.")
        if isinstance(e, anthropic.RateLimitError):
            return AIError("요청이 너무 많아요. 잠시 후 다시 시도해 주세요.")
        if isinstance(e, anthropic.BadRequestError):
            return AIError(f"요청 오류: {e.message}")
        if isinstance(e, anthropic.APIStatusError):
            return AIError(f"Anthropic 서버 오류 ({e.status_code}). 잠시 후 다시 시도해 주세요.")
        if isinstance(e, anthropic.APIConnectionError):
            return AIError("Anthropic 서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.")
        return AIError(str(e))

    def summarize(self, ctx: PaperContext, progress: ProgressFn | None = None) -> dict:
        progress = progress or (lambda msg, frac: None)
        lang = self.get_setting("summary_language") or "한국어"
        prompt = SUMMARY_PROMPT.format(lang=lang)
        if self.engine == "cli":
            progress("Claude CLI로 요약하는 중", None)
            schema = json.dumps(SUMMARY_SCHEMA, ensure_ascii=False)
            text = self._run_cli(
                f"<paper title=\"{ctx.title}\">\n{ctx.tagged_text()}\n</paper>\n\n{prompt}\n\n"
                f"다른 말 없이 아래 JSON 스키마를 따르는 JSON 객체 하나만 출력하세요.\n{schema}",
                system="당신은 논문을 정확하게 정리하는 연구 조수입니다.")
            return normalize_summary(_extract_json(text))

        kw = self._request_kwargs()
        kw["output_config"] = {**kw.get("output_config", {}),
                               "format": {"type": "json_schema", "schema": SUMMARY_SCHEMA}}
        messages = [{"role": "user", "content": [self._document_block(ctx, citations=False),
                                                  {"type": "text", "text": prompt}]}]
        progress("논문을 읽는 중", 0.05)
        chars = 0
        try:
            with self._client().beta.messages.stream(max_tokens=64000, messages=messages, **kw) as stream:
                for event in stream:
                    if event.type == "text":
                        chars += len(event.text)
                        # 결과 JSON 길이는 대개 1만~3만 자 사이라 대략적인 진행률로 쓴다
                        progress("요약을 작성하는 중", min(0.95, 0.1 + chars / 25000))
                final = stream.get_final_message()
        except anthropic.APIError as e:
            raise self._call_errors(e) from e
        if final.stop_reason == "refusal":
            raise AIError("모델이 이 요청을 처리하지 않았어요 (안전 정책). 다른 모델로 다시 시도해 보세요.")
        if final.stop_reason == "max_tokens":
            raise AIError("요약이 너무 길어 중간에 끊겼어요. 다시 시도해 주세요.")
        text = "".join(b.text for b in final.content if b.type == "text")
        return normalize_summary(_extract_json(text))

    def chat(self, ctx: PaperContext, history: list[dict], question: str) -> Iterator[dict]:
        """이벤트를 차례로 내보낸다: {"type":"delta","text":...} … {"type":"done","text":...,"citations":[...]}"""
        lang = self.get_setting("summary_language") or "한국어"
        if self.engine == "cli":
            convo = "\n\n".join(f"{'사용자' if m['role'] == 'user' else '조수'}: {m['content']}" for m in history)
            text = self._run_cli(
                f"<paper title=\"{ctx.title}\">\n{ctx.tagged_text()}\n</paper>\n\n"
                + (f"<conversation>\n{convo}\n</conversation>\n\n" if convo else "")
                + f"질문: {question}",
                system=CHAT_SYSTEM.format(lang=lang) + CLI_CITE_RULE)
            text, cites = cli_citations(text)
            yield {"type": "delta", "text": text}
            yield {"type": "done", "text": text, "citations": cites}
            return

        doc = self._document_block(ctx, citations=True)
        messages: list[dict] = []
        for i, m in enumerate(history):
            if i == 0 and m["role"] == "user":
                messages.append({"role": "user", "content": [doc, {"type": "text", "text": m["content"]}]})
            else:
                messages.append({"role": m["role"], "content": m["content"]})
        if messages:
            messages.append({"role": "user", "content": question})
        else:
            messages.append({"role": "user", "content": [doc, {"type": "text", "text": question}]})

        kw = self._request_kwargs(effort=self.get_setting("effort") or "medium")
        try:
            with self._client().beta.messages.stream(
                    max_tokens=16000, system=CHAT_SYSTEM.format(lang=lang), messages=messages, **kw) as stream:
                for event in stream:
                    if event.type == "text" and event.text:
                        yield {"type": "delta", "text": event.text}
                final = stream.get_final_message()
        except anthropic.APIError as e:
            raise self._call_errors(e) from e
        if final.stop_reason == "refusal":
            raise AIError("모델이 이 질문에 답하지 않았어요 (안전 정책).")
        text, cites = api_citations(final.content, page_based=ctx.usable_pdf(self.model))
        yield {"type": "done", "text": text, "citations": cites}

    # ------------------------------------------------------------ CLI engine
    def _run_cli(self, prompt: str, system: str) -> str:
        exe = shutil.which("claude")
        if not exe:
            raise AIError("claude 명령을 찾지 못했어요. Claude Code를 설치하고 `claude`로 한 번 로그인해 주세요.")
        base = [exe, "-p", "--output-format", "json"]
        model = self.get_setting("model")
        if model:
            base += ["--model", model]
        attempts = [base + ["--tools", "", "--no-session-persistence", "--system-prompt", system],
                    base + ["--append-system-prompt", system]]
        last_err = ""
        for cmd in attempts:
            try:
                proc = subprocess.run(cmd, input=prompt, capture_output=True, text=True, encoding="utf-8",
                                      timeout=1200,
                                      creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except subprocess.TimeoutExpired as e:
                raise AIError("Claude CLI 응답이 20분 안에 오지 않았어요") from e
            if proc.returncode == 0:
                try:
                    data = json.loads(proc.stdout)
                except json.JSONDecodeError:
                    return proc.stdout
                if data.get("is_error"):
                    raise AIError(f"Claude CLI 오류: {data.get('result') or data}")
                return data.get("result") or ""
            last_err = (proc.stderr or proc.stdout or "").strip()
            if "unknown option" not in last_err.lower():
                break
        raise AIError(f"Claude CLI 실행 실패: {last_err[:500]}")


def api_citations(content, page_based: bool) -> tuple[str, list[dict]]:
    """API 응답 블록을 '본문[1]' 형태 텍스트와 인용 목록으로 바꾼다."""
    parts: list[str] = []
    cites: list[dict] = []
    seen: dict[tuple, int] = {}
    for block in content:
        if getattr(block, "type", "") != "text":
            continue
        parts.append(block.text)
        markers = []
        for c in getattr(block, "citations", None) or []:
            if c.type == "page_location":
                start, end = c.start_page_number, max(c.start_page_number, c.end_page_number - 1)
            elif c.type == "content_block_location" and not page_based:
                start, end = c.start_block_index + 1, max(c.start_block_index + 1, c.end_block_index)
            else:
                start = end = None
            key = (start, (c.cited_text or "").strip()[:200])
            if key not in seen:
                seen[key] = len(cites) + 1
                cites.append({"n": seen[key], "page": start, "end_page": end,
                              "text": (c.cited_text or "").strip()})
            if f"[{seen[key]}]" not in markers:
                markers.append(f"[{seen[key]}]")
        if markers:
            parts.append("".join(markers))
    return "".join(parts).strip(), cites


def cli_citations(text: str) -> tuple[str, list[dict]]:
    cites: list[dict] = []
    index: dict[int, int] = {}

    def repl(m: re.Match) -> str:
        out = []
        for num in re.findall(r"\d+", m.group(1)):
            page = int(num)
            if page not in index:
                index[page] = len(cites) + 1
                cites.append({"n": index[page], "page": page, "end_page": page, "text": ""})
            out.append(f"[{index[page]}]")
        return "".join(out)

    text = re.sub(r"\[(?:p\.|pp\.|페이지\s*|쪽\s*)\s*(\d+(?:\s*[,\-–]\s*\d+)*)\]", repl, text)
    return text.strip(), cites
