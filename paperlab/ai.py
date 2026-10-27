"""AI 기능: 수준별·섹션별 요약, 수식 풀이, 논문과 대화(Q&A, 쪽 번호 근거 포함), 글쓰기 도우미 (2단계 9장).

엔진(작업별 경로 — jobs.py가 정함):
- claude(API): Anthropic API (anthropic SDK). PDF를 그대로 보내 그림·수식까지 읽고, 답변에 쪽 단위 인용이 붙는다.
- codex · gemini(API): OpenAI Responses API · Google Gemini generateContent를 httpx로 직접 부른다. 본문 **텍스트만**
  보내고(PDF 원본 없음 — 9.5절), 프롬프트 · 결과 해석은 CLI 워커와 같은 함수(`*_request` · `parse_text_result`)를 쓴다.
- CLI: 서버는 실행하지 않는다. 워커가 잡을 때 서버가 `*_request`로 프롬프트를 만들어 주고, 올라온 원문을
  `parse_text_result`로 해석한다(11장).
"""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from typing import Callable, Iterator
from urllib.parse import quote

import httpx
import anthropic

from .config import redact

MODELS = {
    "claude-opus-5-5": "Claude Opus 5.5 (기본, 가장 정확)",
    "claude-sonnet-5-5": "Claude Sonnet 5.5 (빠르고 저렴)",
    "claude-haiku-4-5": "Claude Haiku 4.5 (가장 빠름)",
}
# effort와 서버측 거절 대체(fallbacks)를 받는 모델
EFFORT_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-fable-5-1"}
FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"}
FALLBACK_BETA = "server-side-fallback-2026-07-01"
API_BASE_URL = "https://api.anthropic.com"

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

WRITE_MODES = {
    "polish": "아래 글의 뜻과 주장은 그대로 두고, 문장을 자연스럽고 매끄럽게 다듬어 주세요.",
    "academic": "아래 글을 학술 논문에 맞는 문체로 바꿔 주세요. 구어체·과장 표현을 없애고 객관적으로 쓰세요.",
    "concise": "아래 글에서 군더더기를 덜어내 핵심만 간결하게 다시 써 주세요.",
    "expand": "아래 글의 논리를 더 자세히 풀어 써 주세요. 새로운 사실·수치·출처를 지어내지 마세요.",
    "to_en": "아래 글을 자연스러운 학술 영어로 번역해 주세요.",
    "to_ko": "아래 글을 자연스러운 학술 한국어로 번역해 주세요.",
    "continue": "아래 글에 자연스럽게 이어지는 다음 문단을 써 주세요.",
    "draft": "주어진 참고 자료만 근거로, 요청한 절의 초안을 써 주세요.",
    "abstract_en": ("아래 국문 초록으로 학술 논문의 영문 초록(Abstract)을 써 주세요. 낱말을 옮기지 말고 영어권 학술지 "
                    "문체로, 목적 · 방법 · 결과 · 결론이 드러나는 한 문단(150~250단어)으로 쓰고 초록에 없는 내용은 더하지 "
                    "마세요. 빈 줄 하나 뒤 마지막 줄에 'Keywords: ' 다음 핵심어 5개를 쉼표로 이어 쓰세요. 제목 줄은 쓰지 마세요."),
    "abstract_ko": ("아래 영문 초록(Abstract)으로 학술 논문의 국문 초록을 써 주세요. 직역하지 말고 자연스러운 한국어 학술 "
                    "문체로, 목적 · 방법 · 결과 · 결론이 드러나는 한 문단(500~800자)으로 쓰고 초록에 없는 내용은 더하지 "
                    "마세요. 빈 줄 하나 뒤 마지막 줄에 '주제어: ' 다음 핵심어 5개를 쉼표로 이어 쓰세요. 제목 줄은 쓰지 마세요."),
    # 논문 검토 · 정리 도구 (2026-10-27 사용자 요청)
    "matrix": ("주어진 참고 자료(논문들)만 근거로 선행연구 비교표를 마크다운 표로 만들어 주세요. 행은 논문 하나씩이고 첫 칸은 "
               "'저자(연도) [@인용키]'로 쓰세요. 열은 추가 요청에 적힌 열을 쓰고, 없으면 '연구 대상 · 연구 방법 · 주요 결과 · 한계'로 "
               "하세요. 칸은 짧은 명사구로 쓰고, 자료에 없는 내용은 지어내지 말고 '확인 필요'라고 쓰세요. 표 바로 위 줄에 "
               "'표: 선행연구 비교' 캡션 한 줄을 쓰고, 표 아래 빈 줄 뒤에 공통점 · 차이 · 연구 공백을 2~4문장 문단으로 정리하세요."),
    "stats": ("아래는 통계 프로그램(SPSS · jamovi · R · 엑셀 등)의 분석 결과예요. 학술 논문 '연구 결과' 절에 넣을 APA 7판 형식의 "
              "표와 문단으로 정리해 주세요. 먼저 '표: …' 캡션 한 줄과 마크다운 표, 빈 줄 뒤에 결과를 해석하는 문단을 쓰세요. "
              "통계 기호는 기울임(*M*, *SD*, *t*, *F*, *p*, *r*, *β*, *R*²)으로, 값은 APA 표기(예: *t*(48) = 2.31, *p* = .025, "
              "*p* < .001, 소수점 둘째 자리)로 쓰세요. 결과에 없는 수치를 만들지 말고, 효과크기가 없으면 "
              "[확인 필요: 효과크기 — 분석 결과]로 표시하세요. 유의하지 않은 결과는 유의하지 않았다고 쓰세요."),
    "memo": ("아래는 연구자가 말로 녹음해 받아 적었거나 급히 적은 메모예요. 뜻과 주장은 그대로 두고 학술 논문 본문 문단으로 "
             "정리해 주세요. 구어체 · 반복 · 군말을 없애고 논리 순서로 문단을 나누세요. 메모에 없는 사실 · 수치 · 출처를 더하지 "
             "말고, 근거가 필요한 주장에는 [확인 필요: 확인할 것 — 확인할 곳]을 붙이세요."),
    "review": ("당신은 이 분야 학위논문 심사위원입니다. 아래 원고를 읽고 심사평을 써 주세요. 형식은 '## 총평'(3~5문장: 연구의 "
               "기여와 가장 큰 문제), '## 주요 지적'(번호 목록 — 항목마다 문제, 원고 위치(장 · 절 제목이나 짧은 인용), 고치는 방법), "
               "'## 세부 지적'(문장 · 용어 · 형식, 번호 목록), '## 예상 질문'(심사 때 받을 만한 질문 5~8개와 답변 방향 한 줄씩)으로 "
               "쓰세요. 연구 문제 · 가설과 결론의 일관성, 연구 방법의 타당성과 한계, 논리 비약, 선행연구 검토의 충분성, 결과 해석의 "
               "과장 여부를 중점으로 보세요. 원고에 없는 내용을 있다고 하지 말고, 칭찬보다 고칠 점을 구체적으로 쓰세요."),
    "response": ("아래는 논문 심사 의견이에요. <context>의 원고 개요를 참고해 심사 의견 대응표를 마크다운 표로 만들어 주세요. 열은 "
                 "'번호 | 심사 의견 | 수정 내용(답변) | 수정 위치'입니다. 심사 의견은 하나씩 나눠 요지를 옮기고, 수정 내용은 정중한 "
                 "'~하였습니다' 체로 쓰되 실제로 무엇을 고쳤는지 알 수 없는 부분은 [확인 필요: 수정 내용 — 원고 해당 절]로 두세요. "
                 "수정 위치는 원고 개요의 장 · 절 제목으로 쓰고 모르면 '확인 필요'라고 쓰세요. 표 바로 위 줄에 "
                 "'표: 심사 의견 대응표' 캡션 한 줄을 쓰세요."),
}
WRITE_MODES["journal"] = (
    "아래는 학술지 투고 규정(원고 작성 요령)이에요. 규정에 적힌 값만 골라 JSON 객체 하나로만 답하세요 — 설명 · 코드 블록 없이. "
    '키: "name"(학술지 이름), "max_pages"(본문 최대 쪽 수), "max_chars"(본문 최대 글자 수), "abstract_ko_max"(국문 초록 최대 글자 수), '
    '"abstract_en_max"(영문 초록 최대 단어 수), "keywords_min", "keywords_max"(주제어 개수), "refs_max"(참고문헌 최대 편 수), '
    '"style"(인용 양식 이름, 예: "APA 7판"), "notes"(그 밖의 중요한 형식 규정 한 줄씩, 10개까지 — 글꼴 · 여백 · 줄 간격 · 익명화 등). '
    "숫자는 정수로, 규정에 없는 값은 null로 두고 지어내지 마세요. 원고지 매수는 200자 × 매수로 글자 수를 계산하세요.")
WRITE_MODES["paraphrase"] = (
    "아래 문장이 <context>의 원문 표현과 너무 비슷해요(표절 미리 점검). 뜻과 사실은 그대로 두고 낱말과 문장 구조를 바꿔 다시 "
    "써 주세요. 원문과 같은 표현을 다섯 글자 넘게 이어 쓰지 말고, 원문에 없는 내용은 더하지 마세요. 추가 요청에 인용 표시가 "
    "있으면 문장 끝(마침표 앞)에 그대로 붙이고, 원래 문장에 있던 [@인용키]는 그대로 두세요.")
# 원고 글 없이(고른 논문 자료만으로) 시작하는 모드
WRITE_NO_TEXT_MODES = {"draft", "matrix"}

WRITE_SYSTEM = """당신은 연구자의 논문 집필을 돕는 편집자입니다.
- 결과 글만 마크다운으로 출력하세요. 설명, 머리말, 따옴표로 감싸기 없이.
- 글에 있는 [@인용키] 표시는 바꾸거나 지우지 말고 그대로 두세요.
- 인용을 새로 달 때는 제공된 자료의 [@인용키]만 쓰세요. 목록에 없는 문헌·저자·수치를 지어내지 마세요.
- 근거가 부족한 주장은 쓰지 말고, 꼭 필요하면 그 자리에 [확인 필요: 확인할 것 — 확인할 곳]처럼 무엇을 어디서 확인하면
  되는지 짧게 쓰세요. 확인할 곳은 실제로 있는 기관 · 통계 · 데이터베이스 · 문헌 종류로 쓰고 모르면 문헌 종류만 쓰세요
  (예: [확인 필요: 2023년 출생아 수 — 통계청 KOSIS 인구동향조사], [확인 필요: 출처 — KCI · RISS에서 선행연구 검색],
  [확인 필요: 표본 수 — 원 논문의 연구 방법 절]). 내용 없이 [확인 필요]만 쓰지 말고, 논문 제목 · 저자 · 주소를 지어내지 마세요."""

CLI_CITE_RULE = "\n- 근거가 되는 쪽은 문장 끝에 [p.쪽번호] 형식으로 표시하세요 (예: [p.3])."
SUMMARY_SYSTEM = "당신은 논문을 정확하게 정리하는 연구 조수입니다."

# OpenAI · Google API (2단계 U2 — 텍스트 전용). 기본 모델 = K19 확정(2026-10-08)
API_MODEL_DEFAULTS = {"codex": "gpt-6.1-sol", "gemini": "gemini-3.8-flash"}
# API 키가 있는 엔진만 (config.API_ENGINES). agy(Antigravity)는 PC CLI 전용이라 여기 없다 — ENGINE_KEYS.get(e)로 찾을 것
ENGINE_KEYS = {"claude": "anthropic_api_key", "codex": "openai_api_key", "gemini": "google_api_key"}
ENGINE_COMPANY = {"claude": "Anthropic", "codex": "OpenAI", "gemini": "Google"}
OPENAI_URL = "https://api.openai.com/v1/responses"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
TEXT_API_TIMEOUT = 600.0
MODEL_ID_RE = re.compile(r"[A-Za-z0-9._-]{1,100}")


def scrub_keys(text: str) -> str:
    """오류 문구에서 API 키 · 기기 토큰 패턴을 지운다 (명세 9.5 — config.redact와 같은 규칙)"""
    return redact(str(text or ""))


class AIError(Exception):
    """AI 실패. code = 9.6절 error_code(폴백 판정에 씀)"""

    def __init__(self, message: str, code: str = ""):
        super().__init__(message)
        self.code = code


# 로컬 항목(PC에만 둔 파일 — selective-sync.md 7.4절 · D-6): 서버는 본문 자리에 이 표지 한 번만 넣고, 보관 PC의 워커가
# 로컬 파일에서 뽑은 글(tagged_text와 같은 모양)로 바꾼다. 본문은 서버를 지나가지 않는다. 표지를 흉내 낼 수 없게 프롬프트의
# 다른 부분(제목 · 초록 · 대화 · 질문)에서는 U+2063(보이지 않는 구분 문자)을 지운다
LOCAL_TEXT_MARKER = "⁣PAPERLAB_LOCAL_PAPER_TEXT⁣"


def unmark(text) -> str:
    """표지 문자(U+2063)를 지운다 — 로컬 본문 표지를 사용자 글로 흉내 내지 못하게"""
    return str(text if text is not None else "").replace("⁣", "")


@dataclass
class PaperContext:
    title: str
    pdf_bytes: bytes | None
    page_texts: list[str]
    abstract: str = ""
    local_text: bool = False  # 로컬 항목 — 본문 대신 LOCAL_TEXT_MARKER (보관 PC 워커가 채움)

    def usable_pdf(self, model: str = "") -> bool:
        limit = 100 if model in SMALL_CONTEXT_MODELS else MAX_PDF_PAGES
        return not self.local_text and bool(self.pdf_bytes) and len(self.pdf_bytes) <= MAX_PDF_BYTES and \
            0 < len(self.page_texts) <= limit

    def text_pages(self) -> list[str]:
        if self.local_text:
            return []
        pages = [t.strip() for t in self.page_texts]
        if any(pages):
            return pages
        if self.abstract:
            return [f"제목: {self.title}\n\n초록: {self.abstract}"]
        return []

    def has_text(self) -> bool:
        return self.local_text or bool(self.text_pages())

    def tagged_text(self) -> str:
        if self.local_text:
            return LOCAL_TEXT_MARKER
        return "\n\n".join(f'<page number="{i + 1}">\n{fence(t)}\n</page>' for i, t in enumerate(self.text_pages()))


# 프롬프트에서 자료를 감싸는 우리 태그 이름 (번역 · 쉬운 설명 · 요약 · 대화 · 글쓰기 · 서재 질문 · AI로 찾기 · 인용 검증)
_FENCE_RE = re.compile(r"<(/?)(paper|page|context|selection|abstract|sources?|evidence|claim|conversation|text)\b",
                       re.I)


def fence(text) -> str:
    """자료 안의 우리 태그 모양을 무디게 — 자료(논문 본문 · 제목 · 초록 · 근거 글)가 `</source>` 같은 닫는 태그로 자기 칸을
    닫고 지시를 끼워 넣지 못하게(프롬프트 주입 방어). `<` 를 `‹` 로 바꾼다. 프롬프트를 만드는 모든 곳이 이 함수 하나를 쓴다"""
    return _FENCE_RE.sub(lambda m: f"‹{m.group(1)}{m.group(2)}", str(text if text is not None else ""))


def fence_attr(text) -> str:
    """속성 값(title="…")용: fence + 큰따옴표 · 줄바꿈 없앰"""
    return fence(text).replace('"', "'").replace("\n", " ")


def _extract_json(text: str) -> dict:
    text = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if m:
        text = m.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise AIError("AI 응답에서 JSON을 찾지 못했어요", "bad_output")
    try:
        data = json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise AIError(f"AI 응답 JSON을 읽지 못했어요: {e}", "bad_output") from e
    if not isinstance(data, dict):
        raise AIError("AI 응답 JSON 모양이 틀렸어요", "bad_output")
    return data


# ---------------------------------------------------------------- 텍스트 요청 (CLI 워커 · OpenAI · Google 공용)
def summary_request(ctx: "PaperContext", lang: str) -> tuple[str, str]:
    """(시스템, 프롬프트). 본문 텍스트를 쪽 표시와 함께 넣는다"""
    if not ctx.has_text():
        raise AIError("이 논문에는 읽을 수 있는 본문이나 초록이 없어요. PDF를 첨부해 주세요.", "bad_request")
    schema = json.dumps(SUMMARY_SCHEMA, ensure_ascii=False)
    return SUMMARY_SYSTEM, (f"<paper title=\"{unmark(fence_attr(ctx.title))}\">\n{ctx.tagged_text()}\n</paper>\n\n"
                            f"{SUMMARY_PROMPT.format(lang=unmark(lang))}\n\n"
                            f"다른 말 없이 아래 JSON 스키마를 따르는 JSON 객체 하나만 출력하세요.\n{schema}")


def chat_request(ctx: "PaperContext", history: list[dict], question: str, lang: str) -> tuple[str, str]:
    # 대화 · 질문은 사용자 글 — 로컬 본문 표지 문자를 지운다(표지가 프롬프트에 정확히 한 번 — 7.4절)
    convo = "\n\n".join(f"{'사용자' if m['role'] == 'user' else '조수'}: {unmark(m['content'])}" for m in history)
    return CHAT_SYSTEM.format(lang=unmark(lang)) + CLI_CITE_RULE, (
        f"<paper title=\"{unmark(fence_attr(ctx.title))}\">\n{ctx.tagged_text()}\n</paper>\n\n"
        + (f"<conversation>\n{convo}\n</conversation>\n\n" if convo else "") + f"질문: {unmark(question)}")


def write_request(mode: str, text: str, *, instruction: str = "", context: str = "",
                  sources: list[dict] | None = None) -> tuple[str, str]:
    if mode not in WRITE_MODES:
        raise AIError("알 수 없는 글쓰기 모드예요", "bad_request")
    parts = [WRITE_MODES[mode]]
    if instruction:
        parts.append(f"추가 요청: {instruction}")
    if sources:
        lines = []
        for s in sources:
            lines.append(f"<source key=\"{fence_attr(s['key'])}\">\n제목: {fence(s.get('title', ''))}\n"
                         f"저자·연도: {fence(s.get('authors', ''))} ({fence(s.get('year') or 'n.d.')})\n"
                         + "\n".join(f"{k}: {fence(v)}" for k, v in (("초록", s.get("abstract")), ("요약", s.get("summary")),
                                                                    ("내 메모", s.get("note"))) if v)
                         + "\n</source>")
        parts.append("<sources>\n" + "\n".join(lines) + "\n</sources>")
    if context:
        parts.append(f"<context>\n{context}\n</context>")
    parts.append(f"<text>\n{text}\n</text>")
    return WRITE_SYSTEM, "\n\n".join(parts)


def parse_text_result(kind: str, text: str, structured=None) -> dict:
    """CLI · OpenAI · Google 원문 → 반영할 결과. summary {"summary"}, chat {"text","citations"}, write {"text"}"""
    text = str(text or "")
    if kind == "summary":
        data = structured if isinstance(structured, dict) else _extract_json(text)
        return {"summary": normalize_summary(data)}
    if not text.strip():
        raise AIError("AI 응답이 비어 있어요", "bad_output")
    if kind == "chat":
        body, cites = cli_citations(text)
        return {"text": body, "citations": cites}
    return {"text": text.strip()}


def http_error_code(status: int, body: str = "") -> str:
    """OpenAI · Google HTTP 오류 → error_code (9.6절)"""
    if status == 401 or (status == 400 and "API_KEY_INVALID" in body):
        return "api_auth"
    if status == 403:
        return "api_permission"
    if status in (402, 429):  # OpenAI 크레딧 소진도 429, Google 선불 잔액 소진 402
        return "api_rate_limit"
    if status in (503, 529):
        return "api_overloaded"
    if status >= 500:
        return "api_server"
    return "api_bad_request"


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
    """한 사용자의 AI 호출. engine = 작업 경로 칸의 엔진(claude는 Anthropic SDK, codex · gemini는 텍스트 API).
    서버 환경 변수(ANTHROPIC_API_KEY · OPENAI_API_KEY · GEMINI_API_KEY · GOOGLE_API_KEY 등)는 보지 않는다 — 사용자 설정의 키만
    (명세 9.5, AC-48)."""

    def __init__(self, get_setting: Callable[[str], str], http_client=None):
        self.get_setting = get_setting
        self._http_client = http_client  # 테스트에서 가짜 전송 계층을 넣을 때 쓴다 (Anthropic · OpenAI · Google 공용)

    @property
    def model(self) -> str:
        return self.get_setting("model") or "claude-opus-5-5"

    def model_name(self, engine: str = "claude") -> str:
        """요약에 기록할 모델 이름"""
        if engine == "claude":
            return self.model
        if engine not in API_MODEL_DEFAULTS:  # agy 등 PC CLI 전용 엔진 — API 모델이 없으니 엔진 이름을 남긴다
            return engine
        return (self.get_setting("api_models") or {}).get(engine) or API_MODEL_DEFAULTS[engine]

    # ------------------------------------------------------------ Anthropic
    def _client(self) -> anthropic.Anthropic:
        key = self.get_setting("anthropic_api_key") or None
        if not key:
            raise AIError("설정에서 Anthropic API 키를 넣어주세요.", "api_no_key")
        kw = {"http_client": self._http_client} if self._http_client else {}
        # api_key를 명시하면 SDK(1.x)는 자격 증명 환경 변수(ANTHROPIC_API_KEY · ANTHROPIC_AUTH_TOKEN)와 프로필 ·
        # 기본 자격 증명 탐색을 하지 않는다. 다만 ANTHROPIC_BASE_URL은 여전히 읽으므로 주소를 고정해 사용자 키가
        # 다른 곳으로 가지 않게 한다(승인자 L3). 운영 진입점(serve.py)은 시작할 때 ANTHROPIC_* 환경 변수를 지운다.
        return anthropic.Anthropic(api_key=key, base_url=API_BASE_URL, **kw)

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
                raise AIError("이 논문에는 읽을 수 있는 본문이나 초록이 없어요. PDF를 첨부해 주세요.", "bad_request")
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
            return AIError("API 키가 올바르지 않아요. 설정에서 확인해 주세요.", "api_auth")
        if isinstance(e, anthropic.PermissionDeniedError):
            return AIError("이 API 키로는 선택한 모델을 쓸 수 없어요.", "api_permission")
        if isinstance(e, anthropic.NotFoundError):
            return AIError("모델을 찾을 수 없어요. 설정에서 모델을 확인해 주세요.", "api_bad_request")
        if isinstance(e, anthropic.RateLimitError):
            return AIError("요청이 너무 많아요. 잠시 후 다시 시도해 주세요.", "api_rate_limit")
        if isinstance(e, anthropic.BadRequestError):
            return AIError(f"요청 오류: {self._scrub(e.message)}", "api_bad_request")
        if isinstance(e, anthropic.APIStatusError):
            code = "api_overloaded" if e.status_code in (503, 529) else "api_server"
            return AIError(f"Anthropic 서버 오류 ({e.status_code}). 잠시 후 다시 시도해 주세요.", code)
        if isinstance(e, anthropic.APITimeoutError):
            return AIError("Anthropic 서버 응답이 너무 늦어요. 잠시 후 다시 시도해 주세요.", "api_timeout")
        if isinstance(e, anthropic.APIConnectionError):
            return AIError("Anthropic 서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.", "api_connection")
        return AIError(self._scrub(str(e)), "api_server")

    def _scrub(self, text: str) -> str:
        """오류 문구에 API 키가 섞이면 지운다 (명세 8.2 · 9.5)"""
        text = str(text or "")
        for name in ENGINE_KEYS.values():
            key = self.get_setting(name) or ""
            if key:
                text = text.replace(key, "***")
        return scrub_keys(text)

    # ------------------------------------------------------------ OpenAI · Google (텍스트 전용)
    def text_complete(self, engine: str, system: str, prompt: str, schema: dict | None = None,
                      schema_name: str = "paper_summary") -> str:
        """OpenAI Responses API · Gemini generateContent 한 번 (스트리밍 없이 — 결과를 끝에 한 번). 키는 헤더로만."""
        name = ENGINE_COMPANY[engine]
        key = self.get_setting(ENGINE_KEYS[engine]) or ""
        if not key:
            raise AIError(f"설정에서 {name} API 키를 넣어주세요.", "api_no_key")
        model = self.model_name(engine)
        if not MODEL_ID_RE.fullmatch(model):
            raise AIError(f"{name} API 모델 이름이 올바르지 않아요.", "api_bad_request")
        if engine == "codex":
            url, headers = OPENAI_URL, {"Authorization": f"Bearer {key}"}
            body: dict = {"model": model, "instructions": system, "input": prompt}
            if schema:
                body["text"] = {"format": {"type": "json_schema", "name": schema_name, "schema": schema, "strict": True}}
        else:
            url, headers = GEMINI_URL.format(model=quote(model, safe="")), {"x-goog-api-key": key}
            body = {"systemInstruction": {"parts": [{"text": system}]},
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}]}
            if schema:
                # 스키마는 프롬프트에 글로 들어 있음(summary_request). 공식 참조에서 확인한 필드(responseMimeType)만 쓴다
                body["generationConfig"] = {"responseMimeType": "application/json"}
        client = self._http_client or httpx.Client()
        try:
            r = client.post(url, json=body, headers=headers, timeout=TEXT_API_TIMEOUT)
        except httpx.TimeoutException:
            raise AIError(f"{name} 서버 응답이 너무 늦어요. 잠시 후 다시 시도해 주세요.", "api_timeout") from None
        except httpx.HTTPError:
            raise AIError(f"{name} 서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.", "api_connection") from None
        finally:
            if client is not self._http_client:
                client.close()
        if r.status_code >= 400:
            code = http_error_code(r.status_code, r.text[:2000])
            msg = {"api_auth": f"{name} API 키가 올바르지 않아요. 설정에서 확인해 주세요.",
                   "api_permission": f"이 {name} API 키로는 선택한 모델을 쓸 수 없어요.",
                   "api_rate_limit": f"{name} API 사용 한도에 걸렸어요. 잠시 후 다시 시도해 주세요."}.get(
                code, f"{name} API 오류 ({r.status_code}).")
            raise AIError(msg, code)
        try:
            data = r.json()
        except ValueError:
            raise AIError(f"{name} API 응답을 읽지 못했어요.", "api_server") from None
        return _openai_text(data) if engine == "codex" else _gemini_text(data)

    # ------------------------------------------------------------ 작업
    def summarize(self, ctx: PaperContext, progress: ProgressFn | None = None, engine: str = "claude") -> dict:
        progress = progress or (lambda msg, frac: None)
        lang = self.get_setting("summary_language") or "한국어"
        if engine != "claude":
            system, prompt = summary_request(ctx, lang)
            progress(f"{ENGINE_COMPANY[engine]} API로 정리하는 중", None)
            return parse_text_result("summary", self.text_complete(engine, system, prompt, SUMMARY_SCHEMA))["summary"]
        prompt = SUMMARY_PROMPT.format(lang=lang)
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
            raise AIError("모델이 이 요청을 처리하지 않았어요 (안전 정책). 다른 모델로 다시 시도해 보세요.", "api_refusal")
        if final.stop_reason == "max_tokens":
            raise AIError("요약이 너무 길어 중간에 끊겼어요. 다시 시도해 주세요.", "api_max_tokens")
        text = "".join(b.text for b in final.content if b.type == "text")
        return normalize_summary(_extract_json(text))

    def chat(self, ctx: PaperContext, history: list[dict], question: str, engine: str = "claude") -> Iterator[dict]:
        """이벤트를 차례로 내보낸다: {"type":"delta","text":...} … {"type":"done","text":...,"citations":[...]}"""
        lang = self.get_setting("summary_language") or "한국어"
        if engine != "claude":
            system, prompt = chat_request(ctx, history, question, lang)
            res = parse_text_result("chat", self.text_complete(engine, system, prompt))
            yield {"type": "delta", "text": res["text"]}
            yield {"type": "done", **res}
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
            raise AIError("모델이 이 질문에 답하지 않았어요 (안전 정책).", "api_refusal")
        if final.stop_reason == "max_tokens":
            raise AIError("답이 너무 길어 중간에 끊겼어요.", "api_max_tokens")
        text, cites = api_citations(final.content, page_based=ctx.usable_pdf(self.model))
        yield {"type": "done", "text": text, "citations": cites}

    def write(self, mode: str, text: str, *, instruction: str = "", context: str = "",
              sources: list[dict] | None = None, engine: str = "claude") -> Iterator[dict]:
        """글쓰기 도우미. 이벤트: {"type":"delta","text"} … {"type":"done","text"}"""
        system, prompt = write_request(mode, text, instruction=instruction, context=context, sources=sources)
        yield from self.complete(system, prompt, engine)

    def complete(self, system: str, prompt: str, engine: str = "claude", schema: dict | None = None,
                 schema_name: str = "result") -> Iterator[dict]:
        """범용 한 번 호출(3단계 서재 질문 · AI로 찾기 · 인용 검증 · 글쓰기). claude는 스트림, OpenAI · Google은 text_complete.
        이벤트: {"type":"delta","text"} … {"type":"done","text"}. schema가 있으면 JSON 출력을 강제한다."""
        if engine != "claude":
            out = self.text_complete(engine, system, prompt, schema, schema_name).strip()
            if not out:
                raise AIError("AI 응답이 비어 있어요", "bad_output")
            yield {"type": "delta", "text": out}
            yield {"type": "done", "text": out}
            return
        kw = self._request_kwargs(effort=self.get_setting("effort") or "medium")
        if schema:
            kw["output_config"] = {**kw.get("output_config", {}), "format": {"type": "json_schema", "schema": schema}}
        try:
            with self._client().beta.messages.stream(
                    max_tokens=16000, system=system, messages=[{"role": "user", "content": prompt}], **kw) as stream:
                for event in stream:
                    if event.type == "text" and event.text:
                        yield {"type": "delta", "text": event.text}
                final = stream.get_final_message()
        except anthropic.APIError as e:
            raise self._call_errors(e) from e
        if final.stop_reason == "refusal":
            raise AIError("모델이 이 요청을 처리하지 않았어요 (안전 정책).", "api_refusal")
        if final.stop_reason == "max_tokens":
            raise AIError("결과가 너무 길어 중간에 끊겼어요.", "api_max_tokens")
        yield {"type": "done", "text": "".join(b.text for b in final.content if b.type == "text").strip()}

    def complete_text(self, system: str, prompt: str, engine: str = "claude", schema: dict | None = None,
                      schema_name: str = "result") -> str:
        """complete의 마지막 글만"""
        done = None
        for ev in self.complete(system, prompt, engine, schema, schema_name):
            if ev["type"] == "done":
                done = ev
        if not done or not done["text"]:
            raise AIError("AI 응답이 비어 있어요", "bad_output")
        return done["text"]


_GEMINI_BLOCKED = {"SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "LANGUAGE", "IMAGE_SAFETY"}


def _openai_text(data: dict) -> str:
    """Responses API 응답 → 글. 거절 · 길이 끊김은 AIError (9.6절)"""
    parts = []
    for item in data.get("output") or []:
        for c in (item.get("content") or []) if item.get("type") == "message" else []:
            if c.get("type") == "refusal":
                raise AIError(f"OpenAI 모델이 이 요청을 처리하지 않았어요: {scrub_keys(c.get('refusal'))[:300]}", "api_refusal")
            if c.get("type") == "output_text":
                parts.append(c.get("text") or "")
    if data.get("status") == "incomplete":
        reason = (data.get("incomplete_details") or {}).get("reason")
        if reason == "content_filter":
            raise AIError("OpenAI 모델이 이 요청을 처리하지 않았어요 (안전 정책).", "api_refusal")
        raise AIError("결과가 너무 길어 중간에 끊겼어요.", "api_max_tokens")
    return "".join(parts)


def _gemini_text(data: dict) -> str:
    block = (data.get("promptFeedback") or {}).get("blockReason")
    if block:
        raise AIError(f"Gemini가 이 요청을 처리하지 않았어요 ({block}).", "api_refusal")
    cands = data.get("candidates") or []
    if not cands:
        raise AIError("Gemini 응답이 비어 있어요.", "api_refusal")
    cand = cands[0]
    reason = cand.get("finishReason") or ""
    if reason == "MAX_TOKENS":
        raise AIError("결과가 너무 길어 중간에 끊겼어요.", "api_max_tokens")
    if reason in _GEMINI_BLOCKED:
        raise AIError(f"Gemini가 이 요청을 처리하지 않았어요 ({reason}).", "api_refusal")
    return "".join(p.get("text") or "" for p in (cand.get("content") or {}).get("parts") or [] if not p.get("thought"))


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
