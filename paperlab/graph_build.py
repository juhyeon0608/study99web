"""인용 그래프 만들기 (명세 docs/specs/citation-graph.md 6 · 7 · 9장).

    씨앗 해석 → 씨앗 → (S2 보강) → A·B 참고문헌 · 관련 논문 → C 피인용 → D 함께 인용 → E 초록 · 이전 연구 → 계산

- 캐시(store)에 유효한 것은 다시 받지 않는다. 받은 것은 단계마다 그 자리에서 캐시에 쓴다(중간에 끊겨도 남음).
- 외부 호출 동안 DB 연결을 잡지 않는다(store가 읽기 · 쓰기마다 짧은 트랜잭션).
- 함께 인용(D) 결과는 "묶음 질의"로 저장하지 않는다(8.3절). 대신 응답 작품들의 참고문헌 행으로 남고, 계산에는
  **캐시에서 그 대상들을 인용한 작품**(store.citers — 피인용 순 100 ∪ 최신순 100)을 쓴다. 그래서 처음 만들 때와
  캐시로 다시 만들 때 같은 풀이 나온다(AC-G12). 씨앗의 `cited_by_top` 행은 C와 D가 모두 끝났다는 표시도 겸한다.
- 로그 · 오류 문구에 씨앗 · 작품 번호 · DOI · 제목을 넣지 않는다(8.6절).

이 모듈의 GraphGate(동시 2 · 대기 4 · 사용자당 1)와 Flights(같은 씨앗 합치기)는 server.py가 쓴다.
"""

from __future__ import annotations

import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date

from . import citegraph as cg
from .citecache import TTL_ABSTRACT, TTL_CITED, TTL_META, TTL_REFERENCES, TTL_RELATED, fresh
from .db import normalize_title
from .sources import (GRAPH_ABSTRACT_FIELDS, GRAPH_LINK_FIELDS, GRAPH_META_FIELDS, GraphBudget, GraphCancelled,
                      GraphDeadline, UpstreamError)

FIELDS_META = GRAPH_META_FIELDS
FIELDS_FULL = GRAPH_META_FIELDS + GRAPH_LINK_FIELDS
FIELDS_ABSTRACT = GRAPH_META_FIELDS + GRAPH_ABSTRACT_FIELDS
DEADLINE_S = 45.0
BATCH = 100
E_MAX_CALLS = 2
S2_MAX_DOIS = 200
PARALLEL = 3  # 그래프 하나 안 OpenAlex 동시 호출 (7.5절)
ABSTRACT_OUT = 1500  # 응답에 넣는 초록 길이 (9.3절)

ERRORS = {
    "seed_not_found": "이 논문을 OpenAlex에서 찾지 못했어요. DOI가 있으면 정확해져요.",
    "upstream_unavailable": "OpenAlex에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.",
    "upstream_limited": "OpenAlex 하루 사용량을 다 썼어요(한국 시간 오전 9시에 초기화). "
                        "설정에서 OpenAlex API 키를 넣으면 한도가 10배가 돼요.",
    "graph_queue_full": "지금 그래프 요청이 많아요. 잠시 후 다시 시도해 주세요.",
    "internal": "그래프를 만들지 못했어요. 잠시 후 다시 시도해 주세요.",
}
# 경고 code → 문구 (화면은 code로 문구를 고르고, 모르는 code만 이 문구를 씀 — 디자인 GD-4)
WARNINGS = {
    "partial": "시간이 오래 걸려 일부 단계를 건너뛰었어요.",
    "refs_partial": "참고문헌 일부를 받지 못했어요.",
    "citing_failed": "이 논문을 인용한 논문을 받지 못했어요.",
    "cocite_failed": "함께 인용된 논문을 받지 못했어요.",
    "abstracts_failed": "일부 논문의 초록을 받지 못했어요.",
    "stale_cache": "일부 정보가 오래됐을 수 있어요.",
    "s2_failed": "Semantic Scholar가 응답하지 않아 참고문헌을 보강하지 못했어요.",
    "upstream_limited": "OpenAlex 하루 사용량을 다 써서 저장돼 있던 정보로만 그렸어요(한국 시간 오전 9시에 초기화). "
                        "설정에서 OpenAlex API 키를 넣으면 한도가 10배가 돼요.",
    "weak_citation_data": "이 논문 주변은 인용 정보가 적어 주제 유사도로 보강했어요.",
    "truncated": "참고문헌이 많아 앞의 300편만 비교했어요.",
}
WARNING_ORDER = tuple(WARNINGS)


class GraphError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(ERRORS.get(code, ERRORS["internal"]))


class BadSeed(ValueError):
    """요청 형식 위반 (400 bad_seed). 문구에 받은 값을 되풀이하지 않는다"""


# ------------------------------------------------------------------ 입력 검증 (9.5절)
_OA_ID_RE = re.compile(r"W[1-9][0-9]{0,11}")
_DOI_RE = re.compile(r"10\.\d{4,9}/\S{1,250}")
_DOI_PREFIX_RE = re.compile(r"^(?:https?://(?:dx\.|www\.)?doi\.org/|doi:\s*)", re.I)
_ARXIV_RE = re.compile(r"(?:arxiv:)?\s*(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?", re.I)
_CTRL_RE = re.compile(r"[\x00-\x1f\x7f-\x9f  ]")
INT64_MAX = 2 ** 63 - 1


@dataclass(frozen=True)
class Seed:
    no: int | None = None
    doi: str = ""
    arxiv_id: str = ""
    title: str = ""

    def key(self) -> str:
        """같은 씨앗 합치기 키 (메모리에만)"""
        if self.no:
            return f"W{self.no}"
        if self.doi:
            return "doi:" + self.doi
        if self.arxiv_id:
            return "arxiv:" + self.arxiv_id.lower()
        return "title:" + normalize_title(self.title)

    def empty(self) -> bool:
        return not (self.no or self.doi or self.arxiv_id or self.title)


def parse_openalex_id(v) -> int | None:
    """'W123' · 'https://openalex.org/W123' → 123. 형식이 틀리면 BadSeed"""
    if not isinstance(v, str):
        raise BadSeed()
    s = v.strip()
    if s.lower().startswith("https://openalex.org/"):
        s = s[len("https://openalex.org/"):]
    if not _OA_ID_RE.fullmatch(s):
        raise BadSeed()
    return int(s[1:])


def clean_doi(v) -> str:
    """DOI 검사 · 정규화. 형식이 틀리면 BadSeed, OpenAlex 필터 문법과 부딪히는 글자(| ,)면 ''(다음 식별자로)."""
    if not isinstance(v, str):
        raise BadSeed()
    s = _DOI_PREFIX_RE.sub("", v.strip()).strip().lower()
    if _CTRL_RE.search(s) or not _DOI_RE.fullmatch(s):
        raise BadSeed()
    if any(seg in (".", "..") for seg in s.split("/")):
        raise BadSeed()
    if "|" in s or "," in s:
        return ""
    return s


def clean_arxiv(v) -> str:
    if not isinstance(v, str):
        raise BadSeed()
    m = _ARXIV_RE.fullmatch(v.strip())
    if not m:
        raise BadSeed()
    return m.group(1)


def clean_title(v) -> str:
    if not isinstance(v, str):
        raise BadSeed()
    s = re.sub(r"\s+", " ", _CTRL_RE.sub(" ", v)).strip()
    if not 3 <= len(s) <= 300:
        raise BadSeed()
    return s


def parse_request(body) -> tuple[int | None, Seed | None, int]:
    """POST /api/graph 본문 → (paper_id, 식별자 씨앗, 크기). 형식 위반은 BadSeed"""
    if not isinstance(body, dict) or not isinstance(body.get("seed"), dict):
        raise BadSeed()
    size = body.get("size", cg.DEFAULT_SIZE)
    if isinstance(size, bool) or not isinstance(size, int) or size not in cg.SIZES:
        raise BadSeed()
    seed = body["seed"]
    ident_keys = [k for k in ("openalex_id", "doi", "arxiv_id", "title") if seed.get(k) not in (None, "")]
    if "paper_id" in seed and seed["paper_id"] is not None:
        if ident_keys:
            raise BadSeed()
        pid = seed["paper_id"]
        if isinstance(pid, bool) or not isinstance(pid, int) or not 1 <= pid <= INT64_MAX:
            raise BadSeed()
        return pid, None, size
    if not ident_keys:
        raise BadSeed()
    no = parse_openalex_id(seed["openalex_id"]) if "openalex_id" in ident_keys else None
    doi = clean_doi(seed["doi"]) if "doi" in ident_keys else ""
    arxiv = clean_arxiv(seed["arxiv_id"]) if "arxiv_id" in ident_keys else ""
    title = clean_title(seed["title"]) if "title" in ident_keys else ""
    out = Seed(no, doi, arxiv, title)
    if out.empty():  # DOI만 있었는데 금지 글자라 버림
        raise BadSeed()
    return None, out, size


def seed_from_paper(p: dict) -> Seed:
    """서재 논문 → 씨앗(형식이 틀린 칸은 버림 — 사용자 데이터라 400으로 막지 않음)"""
    def safe(fn, v, default):
        try:
            return fn(v) if v else default
        except BadSeed:
            return default
    title = re.sub(r"\s+", " ", _CTRL_RE.sub(" ", str(p.get("title") or ""))).strip()[:300]
    return Seed(safe(parse_openalex_id, p.get("openalex_id"), None), safe(clean_doi, p.get("doi"), ""),
                safe(clean_arxiv, p.get("arxiv_id"), ""), title if len(title) >= 3 else "")


# ------------------------------------------------------------------ 응답 모양 (9.3절)
def paper_view(row: dict) -> dict:
    """캐시 행 → norm_openalex와 같은 키(+ author_count · reference_count)"""
    doi = row.get("doi") or ""
    arxiv = row.get("arxiv_id") or ""
    if doi.startswith("10.48550/arxiv."):
        arxiv = arxiv or doi.split(".", 2)[2]
        doi = ""
    abstract = row.get("abstract") or ""
    return {
        "source": "openalex", "title": row.get("title") or "", "authors": list(row.get("authors") or []),
        "author_count": int(row.get("author_count") or 0), "year": row.get("year"), "issued": row.get("issued") or "",
        "venue": row.get("venue") or "", "volume": row.get("volume") or "", "issue": row.get("issue") or "",
        "pages": row.get("pages") or "", "publisher": row.get("publisher") or "", "doi": doi, "arxiv_id": arxiv,
        "openalex_id": f"W{row['no']}", "s2_id": "", "url": row.get("url") or "", "pdf_url": row.get("pdf_url") or "",
        "abstract": abstract[:ABSTRACT_OUT], "cited_by_count": int(row.get("cited_by_count") or 0),
        "reference_count": int(row.get("reference_count") or 0), "item_type": row.get("item_type") or "article",
        "keywords": [], "tldr": "", "language": row.get("language") or "", "is_oa": bool(row.get("is_oa")),
    }


# 묶음 조회에 없던 번호의 빈 행(제목 '' — 풀 · 화면에 나오지 않음)
TOMBSTONE = {"doi": "", "arxiv_id": "", "title": "", "authors": [], "author_count": 0, "year": None, "issued": "",
             "venue": "", "publisher": "", "volume": "", "issue": "", "pages": "", "item_type": "article", "language": "",
             "url": "", "pdf_url": "", "is_oa": False, "cited_by_count": 0, "reference_count": 0, "refs": None,
             "related": None, "abstract": None}


def _chunks(seq: list, n: int) -> list[list]:
    return [seq[i:i + n] for i in range(0, len(seq), n)]


# ------------------------------------------------------------------ 만들기
class GraphBuilder:
    """그래프 1회분. store = citecache.PgStore(또는 테스트용 메모리 저장소), sources = sources.GraphSources."""

    def __init__(self, store, sources, today: date, progress=None):
        self.store = store
        self.src = sources
        self.today = today
        self._progress = progress
        self.rows: dict[int, dict] = {}  # 서지(+초록)
        self.links: dict[tuple[int, str], dict] = {}  # (번호, 관계) → 캐시 행
        self.warnings: set[str] = set()
        self.fetched: set[int] = set()
        self.stop = False  # 기한 · 호출 상한을 넘으면 남은 외부 호출을 건너뜀
        self._w_rows: list[dict] = []
        self._w_edges: list[dict] = []
        self._loaded: set[int] = set()
        self.t0 = time.monotonic()

    # ------------------------------------------------------------ 도우미
    def progress(self, step: str, message: str, frac: float) -> None:
        self.src.check_cancel()  # 끊겼으면 여기서 멈춤
        if self._progress:
            self._progress({"type": "progress", "step": step, "message": message, "progress": frac})

    def _load(self, nos, relations=("references", "related")) -> None:
        nos = [int(n) for n in nos if int(n) not in self._loaded]
        if not nos:
            return
        for no, row in self.store.works(nos).items():
            self.rows.setdefault(no, row)
        for key, e in self.store.edges(nos, relations).items():
            self.links.setdefault(key, e)
        self._loaded.update(nos)

    def _meta_fresh(self, no: int) -> bool:
        r = self.rows.get(no)
        return bool(r) and fresh(r.get("meta_on"), TTL_META, self.today)

    def _link_fresh(self, no: int, rel: str) -> bool:
        e = self.links.get((no, rel))
        ttl = {"references": TTL_REFERENCES, "related": TTL_RELATED}.get(rel, TTL_CITED)
        return bool(e) and fresh(e.get("fetched_on"), ttl, self.today)

    def _needs_links(self, no: int) -> bool:
        return not (self._link_fresh(no, "references") and self._link_fresh(no, "related"))

    def _needs_full(self, no: int) -> bool:
        """서지 + 참고문헌 · 관련 목록을 받아야 하는지. 빈 행(OpenAlex가 돌려주지 않은 번호)은 서지 기간 동안 건너뜀"""
        r = self.rows.get(no)
        if r is None:
            return True
        if not r.get("title") and self._meta_fresh(no):
            return False
        return self._needs_links(no)

    def _tombstones(self, requested, returned) -> None:
        """묶음 조회에 없던 번호(합쳐짐 · 지워짐)를 빈 행으로 남겨 다음에 다시 부르지 않게 (서지 유효 기간 동안)"""
        for n in requested:
            if n not in returned and n not in self.rows:
                self._absorb(dict(TOMBSTONE, no=n), False)

    def _absorb(self, row: dict, links: bool) -> None:
        """받은 작품을 메모리 · 쓰기 목록에 넣는다. 참고문헌 · 관련 목록은 캐시가 없거나 지났을 때만 바꿈(AC-G14)"""
        no = row["no"]
        old = self.rows.get(no)
        new = {k: v for k, v in row.items() if k not in ("refs", "related", "refs_total")}
        new["meta_on"] = self.today
        if new.get("abstract") is None and old is not None:  # 초록을 받지 않은 호출: 있던 초록 유지
            new["abstract"], new["abstract_on"] = old.get("abstract"), old.get("abstract_on")
        elif new.get("abstract") is not None:
            new["abstract_on"] = self.today
        else:
            new["abstract_on"] = None
        new["title_norm"] = normalize_title(new.get("title") or "")
        self.rows[no] = new
        self.fetched.add(no)
        self._w_rows.append(row)
        if links:
            for rel, nos, total in (("references", row.get("refs"), row.get("refs_total")),
                                    ("related", row.get("related"), None)):
                if nos is None or self._link_fresh(no, rel):
                    continue
                e = {"work_no": no, "relation": rel, "nos": list(nos), "total": max(int(total or 0), len(nos)),
                     "truncated": bool(total and total > len(nos)), "source": "openalex", "fetched_on": self.today}
                self.links[(no, rel)] = e
                self._w_edges.append(e)

    def _absorb_many(self, rows: list[dict], links: bool) -> None:
        """여러 작품을 받은 뒤: 캐시 행을 먼저 읽어(참고문헌 목록이 아직 유효한지 알아야 함) 넣는다"""
        if links:
            self._load([r["no"] for r in rows])
        for r in rows:
            self._absorb(r, links)

    def _set_edge(self, no: int, rel: str, nos: list[int], total: int, source: str = "openalex") -> None:
        e = {"work_no": no, "relation": rel, "nos": list(nos), "total": max(total, len(nos)),
             "truncated": total > len(nos), "source": source, "fetched_on": self.today}
        self.links[(no, rel)] = e
        self._w_edges.append(e)

    def _flush(self) -> None:
        rows, edges = self._w_rows, self._w_edges
        self._w_rows, self._w_edges = [], []
        if rows or edges:
            self.store.write(rows, edges, self.today)

    def _limits(self, exc: BaseException) -> None:
        """기한 · 호출 상한 → 남은 단계를 건너뛰고 부분 결과 + partial"""
        self.warnings.add("partial")
        self.stop = True

    def _run_batches(self, tasks: list[tuple[str, list[int], tuple]]) -> tuple[list[tuple], list[list[int]]]:
        """[(종류, 번호들, 필드)] 를 동시 3개까지. (성공 [(번호들, 작품들, links)], 실패한 번호 묶음)"""
        ok: list[tuple] = []
        failed: list[list[int]] = []
        if not tasks:
            return ok, failed

        def one(task):
            kind, nos, fields = task
            return self.src.works(nos, fields)

        with ThreadPoolExecutor(max_workers=min(PARALLEL, len(tasks))) as pool:
            futures = [(t, pool.submit(one, t)) for t in tasks]
            errors: list[BaseException] = []
            for (kind, nos, fields), fut in futures:
                try:
                    ok.append((nos, fut.result(), fields == FIELDS_FULL))
                except UpstreamError:
                    failed.append(nos)
                except (GraphDeadline, GraphBudget) as e:
                    self._limits(e)
                    failed.append(nos)
                except GraphCancelled as e:
                    errors.append(e)
        if errors:
            raise errors[0]
        return ok, failed

    def _ensure(self, nos, warn: str) -> None:
        """작품들의 서지 · 참고문헌 · 관련 목록을 캐시에서 읽고, 없거나 지난 것만 묶음 조회."""
        nos = [n for n in dict.fromkeys(int(x) for x in nos)]
        self._load(nos)
        full = [n for n in nos if self._needs_full(n)]
        full_set = set(full)
        meta = [n for n in nos if n not in full_set and not self._meta_fresh(n)]
        if not (full or meta):
            return
        if self.stop:
            if any(n in self.rows for n in full + meta):
                self.warnings.add("stale_cache")
            return
        tasks = [("full", c, FIELDS_FULL) for c in _chunks(full, BATCH)] + \
                [("meta", c, FIELDS_META) for c in _chunks(meta, BATCH)]
        ok, failed = self._run_batches(tasks)
        for asked, works, links in ok:
            self._absorb_many(works, links)
            self._tombstones(asked, {r["no"] for r in works})
        if failed:
            self.warnings.add(warn)
            if any(n in self.rows and n not in self.fetched for b in failed for n in b):
                self.warnings.add("stale_cache")
        self._flush()

    # ------------------------------------------------------------ 씨앗 해석 (6.1절)
    def resolve(self, seed: Seed) -> int:
        if seed.no:
            return seed.no
        upstream_failed = False
        dois = [d for d in (seed.doi, f"10.48550/arxiv.{seed.arxiv_id.lower()}" if seed.arxiv_id else "") if d]
        for doi in dois:
            self.progress("seed", "씨앗 논문을 찾는 중", 0.05)
            hit = self.store.by_doi([doi]).get(doi)
            if hit:
                return hit
            try:
                rows = self.src.works_by_doi([doi], FIELDS_FULL)
            except UpstreamError as e:
                if e.limited:
                    raise GraphError("upstream_limited") from None
                upstream_failed = True
                continue
            except (GraphDeadline, GraphBudget):
                raise GraphError("upstream_unavailable") from None
            if rows:
                best = sorted(rows, key=lambda r: (-r["cited_by_count"], r["no"]))[0]
                self._absorb_many([best], True)
                self._flush()
                return best["no"]
        if seed.title:
            self.progress("seed", "씨앗 논문을 찾는 중", 0.05)
            target = normalize_title(seed.title)
            try:
                rows = self.src.search_title(seed.title, FIELDS_FULL)
            except UpstreamError as e:
                if e.limited:
                    raise GraphError("upstream_limited") from None
                upstream_failed = True
                rows = []
            except (GraphDeadline, GraphBudget):
                raise GraphError("upstream_unavailable") from None
            for row in rows:  # 지금 match_title 규칙: 정규화 제목 일치 또는 20자 넘는 포함 관계
                cand = normalize_title(row["title"])
                if cand and (cand == target or (len(target) > 20 and (cand in target or target in cand))):
                    self._absorb_many([row], True)
                    self._flush()
                    return row["no"]
        raise GraphError("upstream_unavailable" if upstream_failed else "seed_not_found")

    # ------------------------------------------------------------ 만들기
    def build(self, seed_no: int, size: int) -> dict:
        seed = int(seed_no)
        self.progress("seed", "씨앗 논문을 찾는 중", 0.05)
        self._load([seed], ("references", "related", "cited_by_top"))
        seed = self._seed_work(seed)  # 합쳐진 번호면 OpenAlex가 돌려준 번호(I-1)
        self._s2_augment(seed)

        # A · B: 참고문헌(앞 300편) · 관련 논문(20편)
        ref_e = self.links.get((seed, "references"))
        rel_e = self.links.get((seed, "related"))
        refs_all = list(ref_e["nos"]) if ref_e else []
        if (ref_e and max(ref_e["total"], len(refs_all)) > cg.MAX_SEED_REFS) or len(refs_all) > cg.MAX_SEED_REFS:
            self.warnings.add("truncated")
        R = [n for n in refs_all[:cg.MAX_SEED_REFS] if n != seed]
        L = [n for n in (rel_e["nos"] if rel_e else [])[:cg.MAX_RELATED] if n != seed]
        AB = list(dict.fromkeys(R + L))
        self.progress("references", f"참고문헌 · 관련 논문 {len(AB)}편", 0.3)
        self._ensure(AB, "refs_partial")

        # C: 씨앗을 인용한 논문(피인용 순 100편)
        C, c_cached, c_total = self._citing(seed)
        self.progress("citing", f"이 논문을 인용한 논문 {len(C)}편", 0.5)

        pool = cg.Pool(seed)
        self._add(pool, [seed], "seed")
        self._add(pool, R, "reference")
        self._add(pool, L, "related")
        self._add(pool, C, "citing")
        targets = cg.prelim_targets(cg.index(pool))

        # D: 함께 인용 (예비 상위 49편 + 씨앗을 인용한 논문 — 피인용 순 · 최신순)
        self.progress("cocitation", "함께 인용된 논문을 찾는 중", 0.7)
        if not c_cached:
            d_ok = self._cocite([seed] + targets)
            if d_ok and C is not None and self._c_fetched:
                self._set_edge(seed, "cited_by_top", C, c_total)  # C · D 완료 표시 (다음엔 캐시로)
            self._flush()
        D = self.store.citers([seed] + targets, self.today, cg.COCITE_PER_SORT)
        self._load(D)
        self._add(pool, D, "cocited")

        ix = cg.index(pool)
        ranks = cg.rank_scores(ix)

        # E: 초록 · 이전 연구 서지 (세 크기 모두 — 크기를 바꿔도 외부 호출이 없게)
        self.progress("finish", "초록 · 이전 연구 정보", 0.85)
        self._finish(ix, ranks, size)

        self.progress("compute", "유사도 계산", 0.95)
        lay = cg.compute(ix, size, {n: r for n, r in self.rows.items() if r.get("title")}, ranks)
        if self.src.limited:
            self.warnings.add("upstream_limited")
        if self.src.limited and len(lay.nodes) < cg.MIN_GRAPH:
            raise GraphError("upstream_limited")
        if lay.weak:
            self.warnings.add("weak_citation_data")
        return self._assemble(pool, ix, lay, size)

    def _seed_work(self, seed: int) -> int:
        """씨앗 작품을 캐시 또는 단건 조회로. 돌려준 작품 번호가 다르면(합쳐짐) 그 번호를 씨앗으로 돌려준다"""
        need_links = self._needs_links(seed)
        if self._meta_fresh(seed) and not need_links:
            return seed
        fields = FIELDS_FULL if need_links else FIELDS_META
        try:
            row = self.src.work(seed, fields)
            if row["no"] != seed:
                self._load([row["no"]], ("references", "related", "cited_by_top"))
                if fields != FIELDS_FULL and self._needs_links(row["no"]):
                    fields = FIELDS_FULL
                    row = self.src.work(row["no"], fields)
        except UpstreamError as e:
            if seed in self.rows:  # 오래된 캐시로 그림
                self.warnings.add("stale_cache")
                return seed
            if e.limited:
                raise GraphError("upstream_limited") from None
            raise GraphError("seed_not_found" if e.status == 404 else "upstream_unavailable") from None
        except (GraphDeadline, GraphBudget) as e:
            if seed in self.rows:
                self._limits(e)
                return seed
            raise GraphError("upstream_unavailable") from None
        self._absorb_many([row], fields == FIELDS_FULL)
        self._flush()
        return row["no"]

    def _s2_augment(self, seed: int) -> None:
        """씨앗의 OpenAlex 참고문헌이 0편이고 DOI가 있을 때만 S2 참고문헌 1회 (K-7)"""
        e = self.links.get((seed, "references"))
        row = self.rows.get(seed) or {}
        doi = row.get("doi") or ""
        if (e and e["nos"]) or not doi or self.stop:
            return
        if e and e.get("source") == "s2" and self._link_fresh(seed, "references"):
            return  # 지난번 보강 결과(0편)가 아직 유효
        try:
            clean_doi(doi)
        except BadSeed:
            return
        try:
            dois = self.src.s2_reference_dois(doi)
        except UpstreamError as ex:
            if ex.status != 404:  # 404 = S2도 모르는 논문(실패가 아님)
                self.warnings.add("s2_failed")
            return
        except (GraphDeadline, GraphBudget) as ex:
            self._limits(ex)
            return
        valid = []
        for d in dois:
            try:
                c = clean_doi(d)
            except BadSeed:
                continue
            if c:
                valid.append(c)
        valid = list(dict.fromkeys(valid))[:S2_MAX_DOIS]
        by_doi: dict[str, int] = {}
        for chunk in _chunks(valid, BATCH):
            if self.stop:
                break
            try:
                got = self.src.works_by_doi(chunk, FIELDS_FULL)
            except UpstreamError:
                self.warnings.add("refs_partial")
                continue
            except (GraphDeadline, GraphBudget) as ex:
                self._limits(ex)
                break
            self._absorb_many(got, True)
            for r in got:
                if r["doi"]:
                    by_doi.setdefault(r["doi"], r["no"])
        nos = [by_doi[d] for d in valid if d in by_doi]
        nos = [n for n in dict.fromkeys(nos) if n != seed]
        self._set_edge(seed, "references", nos[:cg.MAX_REFS_STORED], len(valid), source="s2")
        self._flush()

    _c_fetched = False

    def _citing(self, seed: int) -> tuple[list[int], bool, int]:
        """(C 번호들, 캐시에서 왔는지, 전체 수)"""
        e = self.links.get((seed, "cited_by_top"))
        if e and self._link_fresh(seed, "cited_by_top"):
            self._ensure(e["nos"], "citing_failed")
            return list(e["nos"]), True, e["total"]
        if self.stop:
            if e:
                self.warnings.add("stale_cache")
                self._ensure(e["nos"], "citing_failed")
                return list(e["nos"]), False, e["total"]
            return [], False, 0
        try:
            rows, total = self.src.citing([seed], "cited_by_count:desc", FIELDS_FULL)
        except (UpstreamError, GraphDeadline, GraphBudget) as ex:
            if isinstance(ex, UpstreamError):
                self.warnings.add("citing_failed")
            else:
                self._limits(ex)
            if e:  # 지난 목록으로
                self.warnings.add("stale_cache")
                self._ensure(e["nos"], "citing_failed")
                return list(e["nos"]), False, e["total"]
            return [], False, 0
        self._absorb_many(rows, True)
        self._flush()
        self._c_fetched = True
        return [r["no"] for r in rows if r["no"] != seed][:cg.CITERS_TOP], False, total

    def _cocite(self, targets: list[int]) -> bool:
        if self.stop:
            return False
        sorts = ("cited_by_count:desc", "publication_date:desc")
        results: list = []
        failed = False
        with ThreadPoolExecutor(max_workers=2) as pool:
            futs = [pool.submit(self.src.citing, targets, s, FIELDS_FULL) for s in sorts]
            errors = []
            for f in futs:
                try:
                    results.append(f.result()[0])
                except UpstreamError:
                    failed = True
                except (GraphDeadline, GraphBudget) as ex:
                    self._limits(ex)
                    failed = True
                except GraphCancelled as ex:
                    errors.append(ex)
            if errors:
                raise errors[0]
        for rows in results:
            self._absorb_many(rows, True)
        if failed:
            self.warnings.add("cocite_failed")
        return not failed

    def _add(self, pool: cg.Pool, nos, origin: str) -> None:
        for n in nos:
            row = self.rows.get(int(n))
            if not row:
                continue
            w = dict(row)
            w["no"] = int(n)
            r = self.links.get((int(n), "references"))
            rl = self.links.get((int(n), "related"))
            w["refs"] = list(r["nos"]) if r else None
            w["related"] = list(rl["nos"]) if rl else None
            pool.add(w, origin)

    def _finish(self, ix: cg.Index, ranks: dict, size: int) -> None:
        nodes_max = cg.select_nodes(ix, max(cg.SIZES), ranks)
        want: list[int] = []
        prior_all: list[int] = []
        for s in [size] + [x for x in cg.SIZES if x != size]:
            nodes = nodes_max[:s]
            want += nodes
            pc = [x for x, _ in cg.prior_candidates(ix, nodes)]
            prior_all += pc
            want += pc
            want += [y for y, _ in cg.derivative_works(ix, nodes)]
        want = list(dict.fromkeys(want))
        self._load([x for x in prior_all if x not in self.rows], relations=())
        need = [x for x in want if not self._meta_fresh(x) or self.rows[x].get("title") and (
                self.rows[x].get("abstract") is None or not fresh(self.rows[x].get("abstract_on"), TTL_ABSTRACT, self.today))]
        if not need:
            return
        if self.stop:
            if any(x in self.rows for x in need):
                self.warnings.add("stale_cache")
            return
        calls = min(E_MAX_CALLS, self.src.budget_left())
        need = need[:calls * BATCH]
        failed = False
        for chunk in _chunks(need, BATCH):
            try:
                rows = self.src.works(chunk, FIELDS_ABSTRACT)
            except UpstreamError:
                failed = True
                continue
            except (GraphDeadline, GraphBudget) as ex:
                self._limits(ex)
                break
            for r in rows:
                self._absorb(r, False)
            self._tombstones(chunk, {r["no"] for r in rows})
        if failed:
            self.warnings.add("abstracts_failed")
        self._flush()

    def _assemble(self, pool: cg.Pool, ix: cg.Index, lay: cg.Layout, size: int) -> dict:
        seed = pool.seed
        if lay.nodes:
            node_nos = lay.nodes
        else:  # 풀이 3편 미만: 빈 상태(화면이 씨앗 제목으로 Scholar 버튼을 만듦)
            node_nos = [seed] + sorted(n for n in pool.works if n != seed)
        nodeset = set(node_nos)
        nodes = [{"id": f"W{n}", "is_seed": n == seed, "relation": lay.relations.get(n, []),
                  "score": None if n == seed else lay.scores.get(n, 0.0), "paper": paper_view(self.rows[n])}
                 for n in node_nos]
        edges = [dict(e, source=f"W{e['source']}", target=f"W{e['target']}") for e in lay.edges]
        prior = [{"id": f"W{x}", "count": c, "in_graph": x in nodeset, "paper": paper_view(self.rows[x])}
                 for x, c in lay.prior if x in self.rows]
        deriv = [{"id": f"W{y}", "count": c, "in_graph": y in nodeset, "paper": paper_view(self.rows[y])}
                 for y, c in lay.derivative if y in self.rows]
        warnings = [{"code": c, "message": WARNINGS[c]} for c in WARNING_ORDER if c in self.warnings]
        return {
            "seed": f"W{seed}", "size": size, "nodes": nodes, "edges": edges, "prior": prior, "derivative": deriv,
            "warnings": warnings,
            "stats": {"candidates": len(pool.works), "list_calls": self.src.list_calls,
                      "cache_hits": sum(1 for n in pool.works if n not in self.fetched),
                      "elapsed_ms": int((time.monotonic() - self.t0) * 1000), "built_on": self.today.isoformat()},
        }

    def info(self) -> dict:
        """그래프 완료 로그용 숫자(9.6절 — 씨앗 · 번호 · 제목 없음)"""
        return {"list_calls": self.src.list_calls, "single_calls": self.src.single_calls, "s2_calls": self.src.s2_calls,
                "openalex_remaining": self.src.remaining}


# ------------------------------------------------------------------ 동시성 (9.4절)
class GraphGate:
    """서버 전체 동시 running개 · 대기 waiting개, 사용자당 1개. 진행 표는 메모리에만(끝나면 지움 — AC-G33)."""

    UNCLAIMED_S = 30.0  # 응답을 시작하지 못한 자리(스트림이 한 번도 돌지 않음)는 이만큼 지나면 비움

    def __init__(self, running: int = 2, waiting: int = 4, clock=time.monotonic):
        self.running, self.waiting = running, waiting
        self.clock = clock
        self._lock = threading.Lock()
        self.active = 0
        self.queued = 0
        self.users: dict[str, dict] = {}  # uid → {"claimed": bool, "t": 시각, "token": 요청마다 고유 표식}

    def _purge(self) -> None:
        now = self.clock()
        for uid, s in list(self.users.items()):
            if not s["claimed"] and now - s["t"] > self.UNCLAIMED_S:
                del self.users[uid]
                self.queued -= 1

    def enter(self, uid: str) -> tuple[str, str]:
        """('ok', 표식) | ('busy', '')(사용자당 1개) | ('full', '')(진행 + 대기가 다 참).
        표식은 요청마다 새로 — 늦게 시작된 옛 스트림이 같은 사용자의 새 자리를 차지하지 못하게(품질팀 M-1)"""
        with self._lock:
            self._purge()
            if uid in self.users:
                return "busy", ""
            if self.active + self.queued >= self.running + self.waiting:
                return "full", ""
            token = secrets.token_hex(8)
            self.users[uid] = {"claimed": False, "t": self.clock(), "token": token}
            self.queued += 1
            return "ok", token

    def claim(self, uid: str, token: str) -> bool:
        """스트림이 시작됨(이제부터는 끝날 때 leave가 꼭 불림). 비워졌거나 다른 요청의 자리면 False"""
        with self._lock:
            s = self.users.get(uid)
            if s is None or s["token"] != token or s["claimed"]:
                return False
            s["claimed"] = True
            return True

    def try_start(self) -> bool:
        with self._lock:
            if self.active < self.running:
                self.queued -= 1
                self.active += 1
                return True
            return False

    def leave(self, uid: str, token: str, started: bool) -> None:
        with self._lock:
            s = self.users.get(uid)
            if s is None or s["token"] != token:
                return  # 이미 비워졌거나 다른 요청의 자리
            del self.users[uid]
            if started:
                self.active -= 1
            else:
                self.queued -= 1

    def snapshot(self) -> dict:
        with self._lock:
            return {"active": self.active, "queued": self.queued, "users": len(self.users)}


class Flight:
    """같은 씨앗 · 크기 그래프 하나(여러 요청이 함께 기다림). 진행 이벤트는 모두에게."""

    def __init__(self, key):
        self.key = key
        self.events: list[dict] = []
        self.done = threading.Event()
        self.cancel = threading.Event()
        self.result: dict | None = None
        self.seed_no: int | None = None
        self.error: str | None = None
        self.info: dict = {}
        self.subscribers = 0
        self._lock = threading.Lock()

    def emit(self, ev: dict) -> None:
        with self._lock:
            self.events.append(ev)

    def read(self, start: int) -> tuple[list[dict], bool]:
        with self._lock:
            return self.events[start:], self.done.is_set()


class Flights:
    def __init__(self):
        self._lock = threading.Lock()
        self._map: dict = {}

    def join(self, key, start) -> Flight:
        """진행 중인 같은 키가 있으면 거기에 붙고, 없으면 새로 만들어 start(flight)를 부른다(스레드)"""
        with self._lock:
            f = self._map.get(key)
            created = f is None or f.cancel.is_set()
            if created:
                f = Flight(key)
                self._map[key] = f
            f.subscribers += 1
        if created:
            threading.Thread(target=start, args=(f,), daemon=True, name="paperlab-graph").start()
        return f

    def leave(self, f: Flight) -> None:
        with self._lock:
            f.subscribers -= 1
            if f.subscribers <= 0 and not f.done.is_set():
                f.cancel.set()  # 아무도 기다리지 않으면 남은 외부 호출을 멈춤(받은 것은 캐시에 남음)
                if self._map.get(f.key) is f:
                    del self._map[f.key]

    def finish(self, f: Flight) -> None:
        with self._lock:
            if self._map.get(f.key) is f:
                del self._map[f.key]
            f.done.set()

    def __len__(self) -> int:
        with self._lock:
            return len(self._map)
