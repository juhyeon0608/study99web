"""인용 그래프 테스트용 가상 세계 (명세 12장).

- World: 손으로 짠 규칙 + 고정 난수로 만든 작은 OpenAlex 세계(작품 약 90편, 번호는 base 대역 — DB 테스트는 W9000000000…
  대역을 쓰고 끝나면 지운다). 실제 OpenAlex 데이터는 넣지 않았다.
- FakeUpstream: httpx.MockTransport 처리기. 요청을 기록(호스트 · 경로 · 매개변수 · 헤더)하고 세계에서 답한다.
  실패 · 지연 · 429 주입, select에 넣은 필드만 돌려줌.
- MemStore: citecache.PgStore와 같은 동작의 메모리 저장소(DB 없는 빌더 테스트용).
- FakeClock: 기한 · 재시도 대기 시험용 시계(sleep이 시계를 움직임).
"""

from __future__ import annotations

import random
import threading
from datetime import date

import httpx

from paperlab import citecache
from paperlab.db import normalize_title

OA = "api.openalex.org"
S2 = "api.semanticscholar.org"


class FakeClock:
    def __init__(self, t: float = 1000.0):
        self.t = t
        self.sleeps: list[float] = []
        self._lock = threading.Lock()

    def __call__(self) -> float:
        with self._lock:
            return self.t

    def advance(self, s: float) -> None:
        with self._lock:
            self.t += s

    def sleep(self, s: float) -> None:
        self.sleeps.append(s)
        self.advance(s)


def _words(text: str) -> dict:
    inv: dict[str, list[int]] = {}
    for i, w in enumerate(text.split()):
        inv.setdefault(w, []).append(i)
    return inv


class World:
    """작품 번호 = base + 오프셋. 이름(seed, R, L, C, D, X …)으로 번호를 꺼낸다."""

    def __init__(self, base: int = 9_000_000_000, seed: int = 11):
        self.base = b = base
        rnd = random.Random(seed)
        self.works: dict[int, dict] = {}
        self.S = b + 1  # 씨앗
        self.X = [b + 1000 + i for i in range(20)]  # 고전(이전 연구 후보)
        self.R = [b + 100 + i for i in range(30)]  # 씨앗의 참고문헌
        self.L = [b + 200 + i for i in range(5)]  # 씨앗의 관련 논문
        self.C = [b + 300 + i for i in range(40)]  # 씨앗을 인용
        self.D = [b + 400 + i for i in range(30)]  # 함께 인용(씨앗은 인용하지 않음)
        self.EMPTY_TITLE = b + 130
        self.MISSING = b + 131  # 세계에 없음(OpenAlex가 돌려주지 않음)
        self.DUP_LOW, self.DUP_HIGH = b + 128, b + 129  # 같은 제목(프리프린트/출판본)
        # 인용 정보가 적은 씨앗(국문 흉내): 참고문헌 없음, 관련 논문끼리만
        self.K = b + 600
        self.KR = [b + 610 + i for i in range(6)]
        # 참고문헌이 없는 씨앗(DOI 있음) — S2 보강
        self.S2SEED = b + 800
        # 참고문헌이 350편인 씨앗 — 300편에서 자름
        self.BIG = b + 700
        self.BIGR = [b + 2000 + i for i in range(350)]

        def add(no, title, year, cited, refs=(), related=(), doi=None, pdf=False, lang="en"):
            self.works[no] = {"no": no, "title": title, "year": year, "cited": cited, "refs": list(refs),
                              "related": list(related), "doi": doi, "pdf": pdf, "lang": lang,
                              "month": 1 + no % 12}

        for i, x in enumerate(self.X):
            add(x, f"Classic Foundations of Learning Theory Volume {i}", 1990 + i, 20_000 - i * 500,
                refs=self.X[:i][-2:])
        for i, r in enumerate(self.R):
            refs = rnd.sample(self.X, rnd.randint(4, 7)) + self.R[max(0, i - 2):i]
            add(r, f"Reference Study {i} on Representation Methods", 2005 + i % 12, 3000 - i * 60, refs=refs,
                doi=f"10.5555/r{i}.{b}", pdf=i % 3 == 0)
        self.works[self.DUP_LOW]["title"] = "Duplicate Titled Work About Graph Embeddings"
        self.works[self.DUP_HIGH]["title"] = "Duplicate titled work — about graph embeddings!"
        self.works[self.DUP_LOW]["cited"], self.works[self.DUP_HIGH]["cited"] = 5, 900
        add(self.EMPTY_TITLE, "", 2010, 1, refs=self.X[:2])
        for i, x in enumerate(self.L):
            add(x, f"Related Topic Paper {i} on Graph Learning", 2018 + i % 3, 400 - i * 10,
                refs=rnd.sample(self.X, 3))
        for i, c in enumerate(self.C):
            refs = [self.S] + rnd.sample(self.R[:28], rnd.randint(3, 6)) + rnd.sample(self.X, rnd.randint(2, 4))
            add(c, f"Citing Follow-up {i} Extending Graph Learning", 2018 + i % 8, 800 - i * 15, refs=refs,
                doi=f"10.5555/c{i}.{b}")
        for i, d in enumerate(self.D):
            refs = rnd.sample(self.R[:28], rnd.randint(3, 6)) + rnd.sample(self.C[:10], rnd.randint(0, 2)) + \
                rnd.sample(self.X, 2)
            add(d, f"Co-cited Neighbour {i} in Representation Learning", 2019 + i % 7, 300 - i * 7, refs=refs)
        add(self.S, "Seed Paper On Graph Representation Learning", 2017, 5000,
            refs=self.R + [self.EMPTY_TITLE, self.MISSING], related=self.L + [self.R[0]], doi=f"10.5555/seed.{b}",
            pdf=True)
        # 관련 논문 목록(각 작품 3편, 고정 난수)
        pool = self.R + self.C + self.D + self.L
        for no, w in self.works.items():
            if not w["related"]:
                w["related"] = rnd.sample([p for p in pool if p != no], 3)
        # 국문 흉내 세계
        add(self.K, "참고문헌 정보가 적은 국내 학술지 논문의 주제 연구", 2021, 3, refs=[], related=self.KR, lang="ko",
            doi=f"10.5555/k.{b}")
        for i, k in enumerate(self.KR):
            add(k, f"국내 학술지 관련 연구 제{i}편 주제 분석", 2015 + i, 10 + i, refs=[],
                related=[self.K] + [x for x in self.KR if x != k][:3], lang="ko")
        # S2 보강 씨앗: OpenAlex 참고문헌 0, S2가 R 앞 10편의 DOI를 앎
        add(self.S2SEED, "Seed Without OpenAlex References Indexed", 2020, 50, refs=[], related=[],
            doi=f"10.5555/s2seed.{b}")
        self.s2_refs = {f"10.5555/s2seed.{b}": [f"10.5555/r{i}.{b}" for i in range(10)] + ["10.9999/unknown.doi"]}
        # 큰 씨앗
        for i, r in enumerate(self.BIGR):
            add(r, f"Big Reference Item {i} Survey Entry", 2000 + i % 20, i, refs=self.X[:3])
        add(self.BIG, "A Survey With Very Many References Indeed", 2022, 100, refs=self.BIGR, related=[])

    # ------------------------------------------------------------ OpenAlex 모양
    def oa(self, no: int) -> dict:
        w = self.works[no]
        doi = w["doi"]
        out = {
            "id": f"https://openalex.org/W{no}",
            "doi": f"https://doi.org/{doi}" if doi else None,
            "display_name": w["title"],
            "authorships": [{"author": {"display_name": f"Author{no % 97} Family{no % 89}"}},
                            {"author": {"display_name": "Second Writer"}}],
            "publication_year": w["year"],
            "publication_date": f"{w['year']}-{w['month']:02d}-01",
            "language": w["lang"],
            "primary_location": {"source": {"display_name": "Journal of Fake Studies", "host_organization_name": "Fake Pub"},
                                 "landing_page_url": f"https://example.org/w/{no}"},
            "biblio": {"volume": "7", "issue": "2", "first_page": "10", "last_page": "20"},
            "locations": [],
            "best_oa_location": {"pdf_url": f"https://example.org/w/{no}.pdf"} if w["pdf"] else None,
            "cited_by_count": w["cited"],
            "type": "article",
            "open_access": {"is_oa": w["pdf"]},
            "referenced_works_count": len(w["refs"]),
            "referenced_works": [f"https://openalex.org/W{r}" for r in w["refs"]],
            "related_works": [f"https://openalex.org/W{r}" for r in w["related"]],
            "abstract_inverted_index": _words(f"Abstract of work {no} about graphs and learning."),
        }
        return out

    def titles(self) -> list[str]:
        return [w["title"] for w in self.works.values() if w["title"]]


class FakeUpstream:
    """가짜 OpenAlex · S2. requests = [{"host","path","params","headers","kind"}]"""

    def __init__(self, world: World, clock: FakeClock | None = None):
        self.world = world
        self.clock = clock
        self.requests: list[dict] = []
        self.fail = None  # fail(info) -> httpx.Response | Exception | None
        self.delay: dict[str, float] = {}  # kind → 초(시계를 움직임, read 제한보다 길면 ReadTimeout)
        self.block: threading.Event | None = None  # 설정하면 풀릴 때까지 기다림(동시성 시험)
        self.hide: set[int] = set()  # 응답에서 뺄 번호
        self._lock = threading.Lock()

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def count(self, kind: str | None = None) -> int:
        with self._lock:
            return sum(1 for r in self.requests if kind is None or r["kind"] == kind)

    def clear(self) -> None:
        with self._lock:
            self.requests.clear()

    @staticmethod
    def kind_of(request: httpx.Request) -> str:
        host, path, params = request.url.host, request.url.path, request.url.params
        if host == S2:
            return "s2"
        if host != OA:
            return "other"
        if path.startswith("/works/W"):
            return "single"
        if path == "/works" and "search" in params:
            return "search"
        if path == "/works":
            return "list"
        return "other"

    def handle(self, request: httpx.Request) -> httpx.Response:
        info = {"host": request.url.host, "path": request.url.path, "raw_path": request.url.raw_path.decode(),
                "params": dict(request.url.params), "headers": dict(request.headers), "kind": self.kind_of(request),
                "url": str(request.url), "timeout": dict(request.extensions.get("timeout") or {})}
        with self._lock:
            self.requests.append(info)
        if self.block is not None:
            self.block.wait(30)
        d = self.delay.get(info["kind"]) or self.delay.get("*")
        if d and self.clock is not None:
            read = (request.extensions.get("timeout") or {}).get("read")
            if read is not None and d > read:
                self.clock.advance(read)
                raise httpx.ReadTimeout("timed out", request=request)
            self.clock.advance(d)
        if self.fail is not None:
            out = self.fail(info)
            if isinstance(out, Exception):
                raise out
            if out is not None:
                return out
        if info["kind"] == "s2":
            return self._s2(info)
        if info["kind"] == "other":
            return httpx.Response(404)
        return self._oa(info)

    def _select(self, no: int, params: dict) -> dict:
        full = self.world.oa(no)
        sel = params.get("select")
        if not sel:
            return full
        keep = set(sel.split(",")) | {"id"}
        return {k: v for k, v in full.items() if k in keep}

    def _s2(self, info) -> httpx.Response:
        path = info["path"]
        prefix = "/graph/v1/paper/DOI:"
        if not (path.startswith(prefix) and path.endswith("/references")):
            return httpx.Response(404)
        doi = path[len(prefix):-len("/references")]
        refs = self.world.s2_refs.get(doi)
        if refs is None:
            return httpx.Response(404)
        return httpx.Response(200, json={"data": [{"citedPaper": {"externalIds": {"DOI": d}}} for d in refs]})

    def _oa(self, info) -> httpx.Response:
        w = self.world
        params = info["params"]
        if info["kind"] == "single":
            try:
                no = int(info["path"][len("/works/W"):])
            except ValueError:
                return httpx.Response(404)
            if no not in w.works or no in self.hide:
                return httpx.Response(404)
            return httpx.Response(200, json=self._select(no, params))
        per = int(params.get("per_page") or 25)
        if info["kind"] == "search":
            q = normalize_title(params["search"])
            hits = [no for no, x in w.works.items() if x["title"] and (q in normalize_title(x["title"]))]
            return httpx.Response(200, json={"meta": {"count": len(hits)},
                                             "results": [self._select(n, params) for n in hits[:per]]})
        flt = params.get("filter") or ""
        name, _, value = flt.partition(":")
        vals = value.split("|")
        if name == "openalex":
            nos = [int(v[1:]) for v in vals if v[1:].isdigit()]
            hits = [n for n in nos if n in w.works]
        elif name == "doi":
            want = {v.replace("https://doi.org/", "") for v in vals}
            hits = [n for n, x in w.works.items() if x["doi"] and x["doi"] in want]
        elif name == "cites":
            targets = {int(v[1:]) for v in vals if v[1:].isdigit()}
            hits = [n for n, x in w.works.items() if targets & set(x["refs"])]
            if params.get("sort") == "publication_date:desc":
                hits.sort(key=lambda n: (f"{w.works[n]['year']}-{w.works[n]['month']:02d}", -n), reverse=True)
            else:
                hits.sort(key=lambda n: (-w.works[n]["cited"], n))
        else:
            return httpx.Response(400)
        hits = [n for n in hits if n not in self.hide]
        return httpx.Response(200, json={"meta": {"count": len(hits)},
                                         "results": [self._select(n, params) for n in hits[:per]]})


class MemStore:
    """citecache.PgStore와 같은 동작(신선도 · 초록 유지 규칙 · 역방향 찾기)의 메모리 판"""

    def __init__(self):
        self.w: dict[int, dict] = {}
        self.e: dict[tuple[int, str], dict] = {}
        self.writes = 0
        self._lock = threading.Lock()

    def works(self, nos):
        with self._lock:
            return {int(n): dict(self.w[int(n)]) for n in nos if int(n) in self.w}

    def edges(self, nos, relations):
        with self._lock:
            return {(int(n), r): dict(self.e[(int(n), r)]) for n in nos for r in relations if (int(n), r) in self.e}

    def by_doi(self, dois):
        with self._lock:
            out = {}
            for no in sorted(self.w, key=lambda n: (-self.w[n]["cited_by_count"], n)):
                d = self.w[no]["doi"]
                if d and d in dois:
                    out.setdefault(d, no)
            return out

    def citers(self, targets, today: date, per_sort: int):
        t = {int(x) for x in targets}
        rc = citecache.cutoff(citecache.TTL_REFERENCES, today)
        mc = citecache.cutoff(citecache.TTL_META, today)
        with self._lock:
            cand = [no for (no, rel), e in self.e.items() if rel == "references" and e["fetched_on"] > rc
                    and t & set(e["nos"]) and no in self.w and self.w[no]["meta_on"] > mc]
            top = sorted(cand, key=lambda n: (-self.w[n]["cited_by_count"], n))[:per_sort]
            recent = sorted(cand, key=lambda n: (self.w[n]["issued"], self.w[n]["year"] or 0, -n), reverse=True)[:per_sort]
        return list(dict.fromkeys(top + recent))

    def write(self, works, edges, today):
        with self._lock:
            self.writes += 1
            for w in works:
                vals = dict(zip(citecache.WORK_COLS, citecache.work_params(w, today)))
                vals["authors"] = vals["authors"].obj
                old = self.w.get(vals["openalex_no"])
                if vals["abstract"] is None and old is not None:
                    vals["abstract"], vals["abstract_on"] = old["abstract"], old["abstract_on"]
                row = {k: vals[k] for k in citecache.META_KEYS}
                row.update(no=vals["openalex_no"], title_norm=vals["title_norm"], abstract=vals["abstract"],
                           meta_on=vals["meta_on"], abstract_on=vals["abstract_on"])
                self.w[row["no"]] = row
            for e in edges:
                no, rel, nos, total, trunc, source, on = citecache.edge_params(e, today)
                self.e[(no, rel)] = {"work_no": no, "relation": rel, "nos": nos, "total": total, "truncated": trunc,
                                     "source": source, "fetched_on": on}
