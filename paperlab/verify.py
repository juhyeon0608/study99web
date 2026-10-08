"""인용 검증 (docs/specs/phase3-rag-verify-search.md 12장, K-14).

원고의 `[@키]` 문장마다: 직접 인용(따옴표 · `>` 블록)은 원문 글자 대조(AI 없음), 간접 인용은 그 논문 혼합 검색으로 근거 후보 3조각을
`evidence`에 두고 `pending` → `verify` 작업이 AI 한 번에 최대 40문장을 판정한다. 결과 캐시는 `manuscript_citations`(RLS).
인용 표시 해석은 `compose.CITE_RE` · `parse_citation`(화면 refquote.js와 같은 규칙), 줄 단위 — 미리보기의 인용 순번과 같다.
"""

from __future__ import annotations

import bisect
import difflib
import hashlib
import json
import logging
import re
import time
import unicodedata

from psycopg.types.json import Jsonb

from . import ai
from .compose import CITE_RE, parse_citation
from .rag import SEARCH_VERSIONS, page_slices

log = logging.getLogger("paperlab.verify")

MAX_AI_CLAIMS = 40
QUOTE_MAX = 600
SUPPORTED_RATIO, WEAK_RATIO = 0.85, 0.6   # 가정 (12.3절)
EVIDENCE_N = 3
QUOTE_NEAR = 2          # 비슷한 글 찾기는 적힌 쪽 ±2쪽만 (품질팀 M3)
QUOTE_BUDGET_S = 0.5    # 직접 인용 하나의 대조 시간 상한
REASONS = {
    "no_key": "서재에 없는 인용키예요",
    "no_pdf": "원문(PDF)이 없어요",
    "indexing": "색인 중이에요. 끝나면 다시 검증해 주세요",
    "no_ai": "AI를 쓸 수 없어 근거 후보만 보여요",
    "too_long": "원문이 길어 직접 인용을 대조하지 못했어요",
}
RECHECK = {REASONS["indexing"], REASONS["no_ai"]}   # 다시 누르면 다시 확인하는 '확인 못 함'
_QUOTES = str.maketrans({"“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "「": '"', "」": '"', "『": '"', "』": '"'})
_QUOTE_RE = re.compile(r'"([^"\n]{8,})"')
_SENT_END = re.compile(r"(?<=[.!?。])[\"'”’)]*\s+")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").translate(_QUOTES)
    s = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", s)   # 줄 끝 하이픈 연결
    return re.sub(r"\s+", " ", s).strip().lower()


def _strip_cites(s: str) -> str:
    return re.sub(r"\s+", " ", CITE_RE.sub(lambda m: "" if parse_citation(m.group(1)) else m.group(0), s)).strip()


def claims(content: str) -> list[dict]:
    """원고 → 인용 단위 [{start, end, sentence, key, page, quote, marker_index, hash}] (원고 순서).
    줄마다 인용 표시를 가린 뒤 문장 끝(. ! ? 。 + 공백)으로 나누고, 인용만 남은 조각은 앞 문장에 붙인다."""
    out, marker, pos = [], 0, 0
    for line in (content or "").split("\n"):
        base, pos = pos, pos + len(line) + 1
        cites = [(m.start(), m.end(), items) for m in CITE_RE.finditer(line) if (items := parse_citation(m.group(1)))]
        if not cites:
            continue
        masked = list(line)
        for s, e, _ in cites:
            masked[s:e] = "#" * (e - s)
        bounds, start = [], 0
        for m in _SENT_END.finditer("".join(masked)):
            bounds.append([start, m.start()])
            start = m.end()
        bounds.append([start, len(line)])
        merged: list[list[int]] = []
        for b in bounds:
            if merged and len(re.sub(r"[\W_]", "", _strip_cites(line[b[0]:b[1]]))) < 2:
                merged[-1][1] = b[1]
            else:
                merged.append(b)
        block_quote = line.lstrip().startswith(">")
        for s, e, items in cites:
            span = next((b for b in merged if b[0] <= s < b[1]), [0, len(line)])
            raw = line[span[0]:span[1]]
            sentence = _strip_cites(raw.lstrip("> ") if block_quote else raw)
            quotes = _QUOTE_RE.findall(raw.translate(_QUOTES)[:s - span[0]])
            quote = (sentence if block_quote else (quotes[-1] if quotes else ""))[:QUOTE_MAX]
            for it in items:
                loc = re.match(r"\d+", it.get("locator") or "")
                page = int(loc.group(0)) if loc and 0 < int(loc.group(0)) < 100000 else None
                h = hashlib.sha256(f"{norm(sentence)}\x00{it['key']}\x00{page or ''}".encode("utf-8")).hexdigest()
                out.append({"start": base + span[0], "end": base + span[1], "sentence": sentence, "key": it["key"],
                            "page": page, "quote": quote, "marker_index": marker, "hash": h})
            marker += 1
    return out


def check_quote(quote: str, pages: list[str], page: int | None,
                budget_s: float = QUOTE_BUDGET_S) -> tuple[str, str, int | None]:
    """직접 인용 문자열 대조(12.3절) → (판정, 이유, 찾은 쪽).
    그대로 있는지는 모든 쪽에서(빠름), 비슷한 글 찾기(difflib)는 적힌 쪽 ±2쪽만 — 쪽이 없을 때만 전체.
    인용 하나에 budget_s를 넘으면 '확인 못 함' (품질팀 M3)"""
    q = norm(quote)
    if not q:
        return "unchecked", REASONS["no_pdf"], None
    deadline = time.monotonic() + budget_s
    page = page if page and page <= len(pages) else None
    texts = [norm(t) for t in pages]

    def located(p: int, verdict: str, reason: str = "") -> tuple[str, str, int]:
        if page and p != page:
            return "weak", f"원문은 p.{p}에 있어요", p
        return verdict, reason, p

    if page and q in texts[page - 1]:
        return located(page, "supported")
    for p, t in enumerate(texts, 1):
        if q in t:
            return located(p, "supported")
    near = range(max(1, page - QUOTE_NEAR), min(len(pages), page + QUOTE_NEAR) + 1) if page else range(1, len(pages) + 1)
    order = sorted(near, key=lambda p: abs(p - page)) if page else list(near)
    best, best_page = 0.0, None
    step = max(1, len(q) // 4)
    for p in order:
        t = texts[p - 1]
        for i in range(0, max(1, len(t) - len(q) + 1), step):
            if time.monotonic() > deadline:
                return "unchecked", REASONS["too_long"], None
            sm = difflib.SequenceMatcher(None, q, t[i:i + len(q)], autojunk=False)
            if sm.quick_ratio() > best and (r := sm.ratio()) > best:
                best, best_page = r, p
    if best >= SUPPORTED_RATIO:
        return located(best_page, "supported")
    if best >= WEAK_RATIO:
        return "weak", f"원문과 조금 달라요 (p.{best_page})", best_page
    return "unsupported", "원문에서 이 인용 글을 찾지 못했어요", None


def _papers(lib, keys: list[str]) -> dict[str, dict]:
    if not keys:
        return {}
    return {r["citekey"]: r for r in lib._all(
        "select id, citekey, title, year, pdf_key <> '' as has_pdf, pdf_sha256, rag_key, rag_version from paperlab.papers "
        "where user_id = %s and citekey = any(%s) order by id desc", (lib.uid, keys))}


def run_check(tx, rag, uid: str, mid: int, content: str, has_route: bool) -> dict:
    """POST …/verify의 서버 쪽 확인(12.1절 2~4) → {"pending", "quote", "reused", "claims"}. AI는 부르지 않는다.
    ① 짧은 RLS 트랜잭션에서 행 · 논문(키) · 쪽 글을 읽고 ② 대조 · 근거 검색(R2 · 임베딩)은 트랜잭션 밖에서
    ③ 짧은 트랜잭션으로 결과를 쓴다 (품질팀 M2). tx() = 그 사용자 권한 트랜잭션"""
    cl = claims(content)
    current = {c["hash"]: c for c in cl}
    stats = {"claims": len(current), "quote": 0, "ai": 0, "reused": 0, "pending": 0}
    with tx() as lib:
        lib._x("delete from paperlab.manuscript_citations where user_id = %s and manuscript_id = %s "
               "and claim_hash <> all(%s)", (uid, mid, list(current)))
        existing = {r["claim_hash"]: r for r in lib._all(
            "select claim_hash, paper_id, paper_sha, verdict, reason from paperlab.manuscript_citations "
            "where user_id = %s and manuscript_id = %s", (uid, mid))}
        papers = _papers(lib, sorted({c["key"] for c in cl}))
        todo = []
        for h, c in current.items():
            p = papers.get(c["key"])
            row = existing.get(h)
            pid, sha = (p["id"], p["pdf_sha256"]) if p else (None, "")
            if row and row["paper_id"] == pid and row["paper_sha"] == sha and row["reason"] not in RECHECK:
                stats["reused"] += 1
                stats["pending"] += row["verdict"] == "pending"
            else:
                todo.append((h, c, p))
        texts = {p["id"]: lib.page_texts(p["id"]) for _, _, p in todo if p and p["has_pdf"]}
    results = []
    for h, c, p in todo:
        method, verdict, reason, evidence = "none", "unchecked", "", []
        pages = texts.get(p["id"]) if p else None
        if not p:
            reason = REASONS["no_key"]
        elif not any(t.strip() for t in pages or []):
            reason = REASONS["no_pdf"]
        elif c["quote"]:
            method = "quote"
            verdict, reason, found = check_quote(c["quote"], pages, c["page"])
            evidence = [{"page": found, "char_start": 0, "char_end": 0, "score": 1}] if found else []
            stats["quote"] += 1
        elif p["rag_version"] not in SEARCH_VERSIONS or not p["rag_key"]:
            reason = REASONS["indexing"]
        else:
            method = "ai"
            hits = rag.search(tx, uid, [p], c["sentence"], k=EVIDENCE_N, per_paper=EVIDENCE_N, prefer_page=c["page"])
            evidence = [{k: x[k] for k in ("page", "char_start", "char_end", "score")} for x in hits]
            verdict, reason = ("pending", "") if has_route else ("unchecked", REASONS["no_ai"])
            stats["ai"] += 1
        stats["pending"] += verdict == "pending"
        results.append((uid, mid, h, c["key"][:200], p["id"] if p else None, p["pdf_sha256"] if p else "", method, verdict,
                        reason[:300], Jsonb(evidence)))
    with tx() as lib:
        if results and lib._one("select 1 from paperlab.manuscripts where id = %s and user_id = %s for share", (mid, uid)):
            with lib.conn.cursor() as cur:
                cur.executemany(
                    "insert into paperlab.manuscript_citations (user_id, manuscript_id, claim_hash, citekey, paper_id, "
                    "paper_sha, method, verdict, reason, evidence, checked_at) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                    "now()) on conflict (manuscript_id, claim_hash) do update set citekey = excluded.citekey, "
                    "paper_id = excluded.paper_id, paper_sha = excluded.paper_sha, method = excluded.method, "
                    "verdict = excluded.verdict, reason = excluded.reason, evidence = excluded.evidence, "
                    "checked_at = excluded.checked_at", results)
    log.info(json.dumps({"event": "verify", "claims": stats["claims"], "quote": stats["quote"], "ai": stats["ai"],
                         "reused": stats["reused"]}))
    return stats


def view(lib, mid: int, content: str) -> dict:
    """GET …/verify (12.4절): 지금 원고로 다시 나누어 해시로 맞춘 목록"""
    cl = claims(content)
    rows = {r["claim_hash"]: r for r in lib._all(
        "select claim_hash, paper_id, verdict, method, reason, evidence from paperlab.manuscript_citations "
        "where user_id = %s and manuscript_id = %s", (lib.uid, mid))}
    ev_items = [{"paper_id": r["paper_id"], "page": e["page"]} for r in rows.values() if r["paper_id"]
                for e in r["evidence"] or [] if e.get("page")]
    pages = page_slices(lib, ev_items)
    astral = [i for i, ch in enumerate(content or "") if ord(ch) > 0xFFFF]

    def u16(i: int) -> int:  # 화면 textarea는 UTF-16 위치 — BMP 밖 글자(이모지 등)는 2칸 (품질팀 L8)
        return i + bisect.bisect_left(astral, i)

    items, counts, unverified = [], {}, 0
    for c in cl:
        r = rows.get(c["hash"])
        if not r:
            unverified += 1
            continue
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
        evidence = []
        for e in r["evidence"] or []:
            if not e.get("page") or not r["paper_id"]:
                continue
            text = (pages.get((r["paper_id"], e["page"])) or "")[e.get("char_start") or 0:e.get("char_end") or 0]
            evidence.append({"page": e["page"], "text": re.sub(r"\s+", " ", text).strip()[:200]})
        items.append({"start": u16(c["start"]), "end": u16(c["end"]), "marker_index": c["marker_index"], "citekey": c["key"],
                      "paper_id": r["paper_id"], "verdict": r["verdict"], "method": r["method"], "reason": r["reason"],
                      "sentence": c["sentence"][:200], "evidence": evidence})
    return {"items": items, "counts": counts, "unverified": unverified}


# ---------------------------------------------------------------- AI 일괄 판정 (12.2절)
VERIFY_SCHEMA = {
    "type": "object",
    "properties": {"results": {"type": "array", "items": {
        "type": "object",
        "properties": {"id": {"type": "integer"},
                       "verdict": {"type": "string", "enum": ["supported", "weak", "unsupported"]},
                       "evidence": {"type": ["integer", "null"]},
                       "reason": {"type": "string"}},
        "required": ["id", "verdict", "evidence", "reason"], "additionalProperties": False}}},
    "required": ["results"], "additionalProperties": False,
}
VERIFY_SYSTEM = "당신은 학술 원고의 인용이 원문에 근거가 있는지 꼼꼼히 확인하는 검토자입니다."
VERIFY_PROMPT = """아래 <claim>마다, 함께 준 <evidence>(그 논문 원문에서 찾은 근거 후보) 안에 그 문장의 주장을 뒷받침하는 내용이 있는지 판정하세요.
- verdict: supported(근거가 분명함) · weak(일부만 · 간접적으로 뒷받침) · unsupported(근거 후보에 없거나 반대)
- evidence: 가장 잘 맞는 근거 후보 번호(1~3), 없으면 null
- reason: {lang}로 한 문장(150자 이내) — 왜 그렇게 판정했는지
근거 후보 밖의 지식으로 판정하지 마세요. 다른 말 없이 JSON {{"results": [{{"id", "verdict", "evidence", "reason"}}, …]}} 하나만 출력하세요."""


def build_request(lib, job: dict, lang: str) -> tuple[str, str, list[int], int]:
    """잡을 때 프롬프트(12.2절): 지금 원고에서 문장을 다시 뽑아 pending 해시와 맞춤(오래된 것부터 최대 40개).
    → (시스템, 프롬프트, 행 id 목록(프롬프트 번호 순), 남은 수)"""
    mid = (job["params"] or {}).get("manuscript_id")
    m = lib.get_manuscript(mid) if isinstance(mid, int) else None
    if not m:
        raise ai.AIError("원고를 찾을 수 없어요", "bad_request")
    current = {}
    for c in claims(m["content"]):
        current.setdefault(c["hash"], c)
    rows = [r for r in lib._all("select id, claim_hash, citekey, paper_id, evidence from paperlab.manuscript_citations "
                                "where user_id = %s and manuscript_id = %s and verdict = 'pending' order by checked_at, id",
                                (lib.uid, mid)) if r["claim_hash"] in current]
    batch, remaining = rows[:MAX_AI_CLAIMS], max(0, len(rows) - MAX_AI_CLAIMS)
    if not batch:
        raise ai.AIError("확인할 문장이 없어요", "bad_request")
    pages = page_slices(lib, [{"paper_id": r["paper_id"], "page": e["page"]} for r in batch if r["paper_id"]
                              for e in r["evidence"] or [] if e.get("page")])
    parts = []
    for i, r in enumerate(batch, 1):
        ev = "".join(f'\n<evidence n="{j}" page="{e["page"]}">\n'
                     f'{(pages.get((r["paper_id"], e["page"])) or "")[e["char_start"]:e["char_end"]].strip()}\n</evidence>'
                     for j, e in enumerate(r["evidence"] or [], 1))
        parts.append(f'<claim id="{i}" key="{r["citekey"]}">\n{current[r["claim_hash"]]["sentence"]}{ev}\n</claim>')
    return VERIFY_SYSTEM, "\n\n".join(parts) + "\n\n" + VERIFY_PROMPT.format(lang=lang), [r["id"] for r in batch], remaining


def parse_results(text: str, structured=None) -> list[dict]:
    data = structured if isinstance(structured, dict) else ai._extract_json(text or "")
    res = data.get("results")
    if not isinstance(res, list):
        raise ai.AIError("AI 판정 결과 모양이 틀렸어요", "bad_output")
    return [r for r in res if isinstance(r, dict)]


def apply_results(lib, job: dict, results: list[dict]) -> dict:
    """아직 pending인 행만 반영. 모르는 · 빠진 id는 pending 그대로"""
    params = job["params"] or {}
    ids = params.get("claim_ids") or []
    applied = 0
    for r in results:
        i, verdict = r.get("id"), r.get("verdict")
        if not isinstance(i, int) or not 1 <= i <= len(ids) or verdict not in ("supported", "weak", "unsupported"):
            continue
        row = lib._one("select evidence from paperlab.manuscript_citations where id = %s and user_id = %s "
                       "and verdict = 'pending'", (ids[i - 1], lib.uid))
        if not row:
            continue
        ev = list(row["evidence"] or [])
        pick = r.get("evidence")
        if isinstance(pick, int) and 1 <= pick <= len(ev):  # 고른 근거를 맨 앞으로
            ev.insert(0, ev.pop(pick - 1))
        lib._x("update paperlab.manuscript_citations set verdict = %s, method = 'ai', reason = %s, evidence = %s, "
               "checked_at = now() where id = %s and user_id = %s and verdict = 'pending'",
               (verdict, str(r.get("reason") or "")[:300], Jsonb(ev), ids[i - 1], lib.uid))
        applied += 1
    return {"applied": applied, "remaining": params.get("remaining") or 0}
