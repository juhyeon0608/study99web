"""AI로 찾기 (docs/specs/phase3-rag-verify-search.md 13장, K-9~K-13).

검색어(AI 1회) → OpenAlex · Semantic Scholar 검색(`Sources.search`, 검색어마다 20편씩) → 합치기 → 임베딩 유사도 8편
(모델 없으면 RRF) → 출처 번호가 달린 한국어 요약(AI 1회) → 번호 · 한국어 검사. 공용 캐시는 읽지도 쓰지도 않는다(K-12).
로그는 숫자만(질문 · 검색어 · 제목 · DOI 없음).
"""

from __future__ import annotations

import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, wait

import numpy as np

from . import ai
from .db import normalize_doi, normalize_title
from .rag import QUERY_PREFIX, doc_text, rrf_pick
from .sources import SourceError, merge

log = logging.getLogger("paperlab.find")

PER_SOURCE = 20
PICK = 8
DEADLINE_S = 45.0
QUERY_MAX = 200
SOURCES = ("openalex", "semanticscholar")
WARN_KEY = {"openalex": "openalex_failed", "semanticscholar": "s2_failed"}
SEARCH_FAILED = "검색 결과를 받지 못했어요. 잠시 후 다시 시도해 주세요."


class FindError(Exception):
    """검색이 모두 실패 — 작업 실패(폴백 아님)"""


QUERY_SCHEMA = {"type": "object", "properties": {"queries": {"type": "array", "items": {"type": "string"}}},
                "required": ["queries"], "additionalProperties": False}
QUERY_SYSTEM = "당신은 학술 문헌 검색을 돕는 사서입니다."
QUERY_PROMPT = """아래 질문에 답할 논문을 OpenAlex · Semantic Scholar에서 찾을 검색어를 3개(2~4개) 만드세요.
- 검색어는 핵심 개념 낱말 몇 개를 이은 짧은 글(각 200자 이하)로, 문장으로 쓰지 마세요.
- 적어도 1개는 영어로 쓰세요. 질문이 한국어면 한국어 검색어도 1개 넣으세요.
다른 말 없이 JSON {{"queries": ["…", "…"]}} 하나만 출력하세요.

<question>
{question}
</question>"""

SUMMARY_SYSTEM = "당신은 학술 문헌을 근거로 요약하는 연구 조수입니다. 설정과 무관하게 항상 한국어로 씁니다."
SUMMARY_PROMPT = """아래 <source>(논문의 제목 · 저자 · 연도 · 학술지 · 초록)만 근거로, 질문에 대한 답을 한국어로 요약하세요.
- 모든 문장 끝에 근거 출처 번호를 [번호] 형식으로 붙이세요 (예: …으로 나타났다 [1][3]).
- 출처에 없는 내용 · 수치를 쓰지 마세요. 목록에 없는 번호를 쓰지 마세요.
- 5~10문장, 머리말 · 제목 줄 없이 본문만. 출처끼리 결과가 다르면 다르다고 쓰세요.

<question>
{question}
</question>

{sources}"""


def is_english(q: str) -> bool:
    return bool(re.search(r"[A-Za-z]{2}", q)) and not re.search(r"[가-힣]", q)


def query_request(question: str) -> tuple[str, str]:
    return QUERY_SYSTEM, QUERY_PROMPT.format(question=question)


def parse_queries(text: str, structured, question: str) -> list[str]:
    """2~4개, 각 200자 이하, 영어 1개 이상(없으면 bad_output). 개수가 모자라면 원래 질문을 더함(13.1절 2)"""
    data = structured if isinstance(structured, dict) else ai._extract_json(text or "")
    raw = data.get("queries")
    if not isinstance(raw, list):
        raise ai.AIError("검색어 결과 모양이 틀렸어요", "bad_output")
    qs = list(dict.fromkeys(re.sub(r"\s+", " ", str(q)).strip()[:QUERY_MAX] for q in raw if str(q).strip()))[:4]
    if len(qs) < 2 and question[:QUERY_MAX] not in qs:
        qs.append(question[:QUERY_MAX])
    if not any(is_english(q) for q in qs):
        raise ai.AIError("영어 검색어를 만들지 못했어요", "bad_output")
    return qs


def _key(it: dict) -> str:
    doi = normalize_doi(it.get("doi") or "")
    if doi:
        return "doi:" + doi
    t = normalize_title(it.get("title") or "")
    return "t:" + t if len(t) >= 12 else f"id:{it.get('source')}:{it.get('openalex_id') or it.get('s2_id') or t}"


def search_all(sources, queries: list[str], deadline_s: float = DEADLINE_S) -> tuple[list[dict], list[list[str]], list[str]]:
    """검색어 × (OpenAlex, S2) 동시 → (합친 논문, RRF용 순위 목록, 경고). 429 · 5xx · 연결 오류는 1번만 다시(하루 예산 429는 아님)"""
    def one(q: str, src: str) -> list[dict]:
        for attempt in (0, 1):
            try:
                return sources.search(q, src, 1, PER_SOURCE)["items"]
            except SourceError as e:
                if attempt or "한도" in str(e) or "404" in str(e):
                    raise
        return []

    jobs = [(q, src) for q in queries for src in SOURCES]
    ex = ThreadPoolExecutor(len(jobs))
    futs = [ex.submit(one, q, src) for q, src in jobs]
    done, _ = wait(futs, timeout=deadline_s)
    ex.shutdown(wait=False, cancel_futures=True)
    warnings, ok = [], {s: False for s in SOURCES}
    if len(done) < len(futs):
        warnings.append("partial")
    results: dict[tuple, list[dict]] = {}
    for (q, src), f in zip(jobs, futs):
        if f in done and f.exception() is None:
            results[(q, src)] = f.result()
            ok[src] = True
    for src in SOURCES:
        if not ok[src]:
            warnings.append(WARN_KEY[src])
    if not any(ok.values()):
        raise FindError(SEARCH_FAILED)
    merged: dict[str, dict] = {}
    ranks = []
    for src in SOURCES:  # OpenAlex 정보가 남고 S2는 빈 칸만 채움
        for q in queries:
            keys = []
            for it in results.get((q, src)) or []:
                if not (it.get("title") or "").strip() and not (it.get("abstract") or "").strip():
                    continue
                k = _key(it)
                merged[k] = merge(merged[k], it) if k in merged else dict(it)
                keys.append(k)
            ranks.append(keys)
    return [dict(v, key=k) for k, v in merged.items()], ranks, warnings


def pick(question: str, items: list[dict], ranks: list[list[str]], embedder, k: int = PICK) -> list[dict]:
    """관련도 = 질문과 '제목 + 초록(1,500자)' 임베딩 코사인 상위 k편(K-10). 모델이 없으면 RRF 순위"""
    if not items:
        return []
    if embedder is None:
        order = [key for key, _ in rrf_pick(ranks, k=k, per_group=1, group=lambda x: x)]
        by_key = {it["key"]: it for it in items}
        return [by_key[x] for x in order if x in by_key]
    q = embedder.embed([QUERY_PREFIX + question])[0]
    docs = embedder.embed([doc_text(it.get("title") or "", (it.get("abstract") or "")[:1500]) for it in items])
    top = np.argsort(-(docs @ q), kind="stable")[:k]
    return [items[i] for i in top]


def summary_request(question: str, cands: list[dict]) -> tuple[str, str]:
    blocks = []
    for c in cands:
        authors = ", ".join(" ".join(x for x in (a.get("given"), a.get("family"), a.get("literal")) if x)
                            for a in (c.get("authors") or [])[:6])
        blocks.append(f'<source n="{c["n"]}">\n제목: {c.get("title") or ""}\n저자: {authors}\n연도: {c.get("year") or "n.d."}\n'
                      f'학술지: {c.get("venue") or ""}\n초록: {(c.get("abstract") or c.get("tldr") or "(없음)")[:2500]}\n</source>')
    return SUMMARY_SYSTEM, SUMMARY_PROMPT.format(question=question, sources="\n".join(blocks))


_SPLIT = re.compile(r"(?:(?<=[.!?。])|(?<=\d\]))\s+(?!\[\d)")
_NUM = re.compile(r"\[\d{1,3}(?:\s*[,，]\s*\d{1,3})*\]")


def check_answer(text: str, n: int) -> str:
    """번호 검사(13.1절 7): 목록 밖 번호는 지우고 유효한 [n]이 없는 문장은 뺌(제목 줄 · 빈 줄 제외).
    절반 넘게 빠지거나 남은 문장이 없거나 한글이 글자의 30% 미만이면 bad_output"""
    valid = set(range(1, n + 1))

    def fix(m: re.Match) -> str:
        return "".join(f"[{x}]" for x in (int(d) for d in re.findall(r"\d+", m.group(0))) if x in valid)

    out, total, dropped = [], 0, 0
    for line in (text or "").strip().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            out.append(line)
            continue
        kept = []
        for sent in _SPLIT.split(line):
            sent = _NUM.sub(fix, sent)
            if not re.sub(r"[\W_\d]", "", _NUM.sub("", sent)):  # 번호 · 기호만 남은 조각은 앞 문장에
                if kept:
                    kept[-1] += " " + sent.strip()
                continue
            total += 1
            if re.search(r"\[\d+\]", sent):
                kept.append(sent)
            else:
                dropped += 1
        if kept:
            out.append(" ".join(kept))
    body = "\n".join(out).strip()
    if not total or dropped == total or dropped * 2 > total:
        raise ai.AIError("요약의 출처 번호가 맞지 않아요", "bad_output")
    letters = re.sub(r"[\W_\d]", "", _NUM.sub("", body))
    if not letters or len(re.findall(r"[가-힣]", letters)) / len(letters) < 0.3:
        raise ai.AIError("요약이 한국어가 아니에요", "bad_output")
    return body


CARD_FIELDS = ("source", "title", "authors", "year", "venue", "volume", "issue", "pages", "publisher", "doi", "arxiv_id",
               "openalex_id", "s2_id", "url", "pdf_url", "abstract", "cited_by_count", "item_type", "keywords", "tldr",
               "issued", "is_oa")


def cards(cands: list[dict]) -> list[dict]:
    """결과 카드 모양(논문 찾기 검색 결과와 같은 필드) + n"""
    return [{k: c.get(k) for k in CARD_FIELDS if k in c} | {"n": c["n"]} for c in cands]


def prepare(sources, embedder, question: str, queries: list[str]) -> tuple[list[dict], list[str], dict]:
    """검색 · 합치기 · 고르기 (13.1절 3~5) → (번호 붙은 후보, 경고, 개수)"""
    started = time.monotonic()
    items, ranks, warnings = search_all(sources, queries)
    picked = pick(question, items, ranks, embedder)
    cands = [dict(c, n=i + 1) for i, c in enumerate(picked)]
    for c in cands:
        c.pop("key", None)
        c["abstract"] = (c.get("abstract") or "")[:1500]  # params 64KB 안 (13.2절)
    log.info(json.dumps({"event": "find", "ms": int((time.monotonic() - started) * 1000), "queries": len(queries),
                         "candidates": len(items), "picked": len(cands), "warnings": len(warnings)}))
    return cards(cands), warnings, {"queries": len(queries), "candidates": len(items), "picked": len(cands)}
