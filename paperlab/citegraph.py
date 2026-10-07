"""인용 그래프(Connected Papers 방식) 알고리즘 — 입출력 없는 순수 함수 (명세 docs/specs/citation-graph.md 6장).

용어: 작품(work) = OpenAlex 작품 하나(번호 = `W` 뒤 숫자, int). 풀(pool) = 후보 작품 모음.
refs(x) = x의 참고문헌 번호 집합, citers(x) = 풀 안에서 x를 참고문헌에 가진 작품 집합.

작품 하나는 dict로 다룬다(캐시 행 모양):
    {"no": int, "title": str, "title_norm": str, "cited_by_count": int, "year": int | None,
     "issued": str, "refs": list[int] | None, "related": list[int] | None, ...그 밖 서지}
refs · related가 None이면 "모름"(빈 집합으로 셈).

수치는 이 파일 맨 위 상수 한 곳(6.9절 — 가정, 실측 뒤 조정).
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field

from .db import normalize_title

# ------------------------------------------------------------------ 6.9절 수치
SIZES = (20, 40, 80)
DEFAULT_SIZE = 40
MAX_SEED_REFS = 300
MAX_RELATED = 20
CITERS_TOP = 100
COCITE_TARGETS = 49  # + 씨앗 = OR 50값
COCITE_PER_SORT = 100
W_COUPLING = 0.6
W_COCITATION = 0.4
MIN_SHARED = 2
W_RELATED = 0.25
MIN_SCORE = 0.05
MAX_EDGES_PER_NODE = 6
W_RANK_SIM = 5.0
PRIOR_N = 20
DERIVATIVE_N = 20
MIN_COUNT = 2
MAX_REFS_STORED = 500
MAX_LIST_CALLS = 12
MIN_GRAPH = 3  # 씨앗 포함 이 수 미만이면 그래프 대신 빈 상태
# 정규화 제목이 이보다 짧으면 같은 제목으로 합치지 않음("Introduction" · "Editorial" 같은 흔한 제목 오합침 방지 —
# 서재 중복 판단 db.find_duplicate와 같은 12자)
MIN_TITLE_MERGE = 12
# 이전 연구 후보: 20번째와 같은 count까지(동률 포함) 서지를 받되 최대 이만큼
PRIOR_FETCH_CAP = 60

_EMPTY: frozenset[int] = frozenset()


def jaccard(a, b) -> float:
    """|A∩B| / |A∪B|. 둘 중 하나라도 비면 0."""
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if not inter:
        return 0.0
    return inter / (len(a) + len(b) - inter)


# ------------------------------------------------------------------ 풀 · 중복 합치기 (6.2절)
@dataclass
class Pool:
    """후보 작품 모음. 같은 번호 · 같은 정규화 제목은 하나로 합치고, 지운 번호는 별칭으로 남긴다."""

    seed: int
    works: dict[int, dict] = field(default_factory=dict)
    alias: dict[int, int] = field(default_factory=dict)
    origin: dict[int, set] = field(default_factory=dict)
    _by_title: dict[str, int] = field(default_factory=dict)

    def canon(self, no: int) -> int:
        seen = 0
        while no in self.alias and seen < 64:  # 별칭 사슬(합친 쪽이 다시 합쳐진 경우)
            no = self.alias[no]
            seen += 1
        return no

    def __contains__(self, no: int) -> bool:
        return self.canon(no) in self.works

    def add(self, w: dict, origin: str = "") -> int | None:
        """작품을 넣고 남은(대표) 번호를 돌려준다. 넣지 않으면 None."""
        no = int(w["no"])
        tn = w.get("title_norm")
        if tn is None:
            tn = normalize_title(w.get("title") or "")
        c = self.canon(no)
        if c in self.works:  # ② 같은 번호(또는 이미 합쳐진 번호)
            self._merge_into(c, w)
            self._tag(c, origin)
            return c
        if no != self.seed and not (w.get("title") or "").strip():
            return None  # ① 제목 빈 작품은 넣지 않음
        other = self._by_title.get(tn) if len(tn) >= MIN_TITLE_MERGE else None
        if other is not None and other != no:
            o = self.works[other]
            keep_other = other == self.seed or no != self.seed and \
                int(o.get("cited_by_count") or 0) >= int(w.get("cited_by_count") or 0)
            if keep_other:  # ③ 피인용이 큰 쪽(같으면 먼저 들어온 쪽) · ④ 씨앗은 바뀌지 않음
                self.alias[no] = other
                self._merge_into(other, w)
                self._tag(other, origin)
                return other
            # 새 작품이 남는다: 먼저 있던 쪽을 새 작품의 별칭으로
            nw = self._copy(w)
            self.works[no] = nw
            self._merge_into(no, o)
            self.origin[no] = set(self.origin.pop(other, set()))
            del self.works[other]
            self.alias[other] = no
            self._by_title[tn] = no
            self._tag(no, origin)
            return no
        self.works[no] = self._copy(w)
        self.origin.setdefault(no, set())
        if tn and len(tn) >= MIN_TITLE_MERGE and tn not in self._by_title:
            self._by_title[tn] = no
        self._tag(no, origin)
        return no

    @staticmethod
    def _copy(w: dict) -> dict:
        out = dict(w)
        out["no"] = int(w["no"])
        out["refs"] = None if w.get("refs") is None else list(w["refs"])
        out["related"] = None if w.get("related") is None else list(w["related"])
        return out

    def _merge_into(self, keep: int, w: dict) -> None:
        k = self.works[keep]
        for key in ("refs", "related"):
            new = w.get(key)
            if new is None:
                continue
            if k.get(key) is None:
                k[key] = list(new)
            else:
                k[key] = list(dict.fromkeys(list(k[key]) + list(new)))

    def _tag(self, no: int, origin: str) -> None:
        if origin:
            self.origin.setdefault(no, set()).add(origin)


# ------------------------------------------------------------------ 유사도 (6.4절)
@dataclass
class Index:
    """별칭을 풀어 같은 노드 번호로 맞춘 refs · related · citers"""

    pool: Pool
    refs: dict[int, frozenset]
    related: dict[int, frozenset]
    citers: dict[int, frozenset]
    members: frozenset


def index(pool: Pool) -> Index:
    canon = pool.canon
    refs: dict[int, frozenset] = {}
    related: dict[int, frozenset] = {}
    for no, w in pool.works.items():
        refs[no] = frozenset(c for c in (canon(r) for r in (w.get("refs") or ())) if c != no)
        related[no] = frozenset(c for c in (canon(r) for r in (w.get("related") or ())) if c != no)
    members = frozenset(pool.works)
    cit: dict[int, set] = {}
    for y, rs in refs.items():
        for x in rs:
            if x in members:
                cit.setdefault(x, set()).add(y)
    citers = {x: frozenset(s) for x, s in cit.items()}
    return Index(pool, refs, related, citers, members)


@dataclass(frozen=True)
class Sim:
    weight: float
    kind: str
    shared: int
    coupling: float
    cocitation: float
    related: float


ZERO = Sim(0.0, "coupling", 0, 0.0, 0.0, 0.0)


def similarity(ix: Index, a: int, b: int) -> Sim:
    ra, rb = ix.refs.get(a, _EMPTY), ix.refs.get(b, _EMPTY)
    sh_c = len(ra & rb)
    coupling = jaccard(ra, rb) if sh_c >= MIN_SHARED else 0.0
    ca, cb = ix.citers.get(a, _EMPTY), ix.citers.get(b, _EMPTY)
    sh_k = len(ca & cb)
    cocitation = jaccard(ca, cb) if sh_k >= MIN_SHARED else 0.0
    cited = W_COUPLING * coupling + W_COCITATION * cocitation
    la, lb = ix.related.get(a, _EMPTY), ix.related.get(b, _EMPTY)
    if b in la or a in lb:  # 서로(또는 한쪽이) 관련 논문으로 지목
        rel = 1.0
        sh_r = len((la & lb) | ({b} & la) | ({a} & lb))
    else:
        la2, lb2 = la & ix.members, lb & ix.members
        rel = jaccard(la2, lb2)
        sh_r = len(la2 & lb2)
    if cited > 0:  # 인용 근거가 있으면 그것만 (관련 논문은 폴백)
        rel_part, rel_out, weight = 0.0, 0.0, cited
    else:
        rel_part, rel_out = W_RELATED * rel, rel
        weight = rel_part
    parts = ((W_COUPLING * coupling, "coupling", sh_c), (W_COCITATION * cocitation, "cocitation", sh_k),
             (rel_part, "related", sh_r))
    _, kind, shared = max(parts, key=lambda t: t[0])
    return Sim(weight, kind, shared, coupling, cocitation, rel_out)


# ------------------------------------------------------------------ 노드 고르기 (6.5절)
def prelim_targets(ix: Index, n: int = COCITE_TARGETS) -> list[int]:
    """D 단계(함께 인용) 대상: 씨앗과의 예비 유사도 상위 n편(0점은 뺌, 동률은 번호 오름차순)."""
    seed = ix.pool.seed
    scored = [(similarity(ix, seed, w).weight, w) for w in ix.members if w != seed]
    scored = [(s, w) for s, w in scored if s > 0]
    scored.sort(key=lambda t: (-t[0], t[1]))
    return [w for _, w in scored[:n]]


def rank_scores(ix: Index) -> dict[int, tuple[float, float]]:
    """씨앗이 아닌 풀 작품마다 (rank, sim)"""
    seed = ix.pool.seed
    out = {}
    for w in ix.members:
        if w == seed:
            continue
        s = similarity(ix, seed, w).weight
        c = max(0, int(ix.pool.works[w].get("cited_by_count") or 0))
        out[w] = (W_RANK_SIM * s + math.log1p(c), s)
    return out


def select_nodes(ix: Index, size: int, ranks: dict | None = None) -> list[int]:
    """씨앗 + rank 상위 (size − 1)편. 풀이 MIN_GRAPH편 미만이면 []."""
    if len(ix.members) < MIN_GRAPH:
        return []
    ranks = ranks if ranks is not None else rank_scores(ix)
    order = sorted(ranks, key=lambda w: (-ranks[w][0], w))
    return [ix.pool.seed] + order[:max(0, size - 1)]


# ------------------------------------------------------------------ 선 (6.6절)
def build_edges(ix: Index, nodes: list[int], max_per_node: int = MAX_EDGES_PER_NODE) -> list[dict]:
    ordered = sorted(nodes)
    cand: list[dict] = []
    for i, a in enumerate(ordered):
        for b in ordered[i + 1:]:
            s = similarity(ix, a, b)
            if s.weight < MIN_SCORE:
                continue
            cand.append({"source": a, "target": b, "weight": round(s.weight, 4), "kind": s.kind, "shared": s.shared,
                         "coupling": round(s.coupling, 4), "cocitation": round(s.cocitation, 4),
                         "related": round(s.related, 4), "_w": s.weight})
    if max_per_node > 0:
        by_node: dict[int, list[int]] = {}
        for k, e in enumerate(cand):
            by_node.setdefault(e["source"], []).append(k)
            by_node.setdefault(e["target"], []).append(k)
        keep: set[int] = set()
        for node, ks in by_node.items():
            other = lambda k, node=node: cand[k]["target"] if cand[k]["source"] == node else cand[k]["source"]  # noqa: E731
            ks.sort(key=lambda k: (-cand[k]["_w"], other(k)))
            keep.update(ks[:max_per_node])
        cand = [e for k, e in enumerate(cand) if k in keep]
    cand.sort(key=lambda e: (-e["_w"], e["source"], e["target"]))
    for e in cand:
        del e["_w"]
    return cand


# ------------------------------------------------------------------ 이전 · 이후 연구 (6.7절)
def prior_candidates(ix: Index, nodes: list[int], n: int = PRIOR_N, cap: int = PRIOR_FETCH_CAP) -> list[tuple[int, int]]:
    """[(번호, count)] — 노드들이 인용한 수 count ≥ 2(씨앗 제외). count 내림차순 · 번호 오름차순으로 n번째와 같은
    count까지(동률 포함), 최대 cap편. 마지막 순서(피인용)는 서지를 받은 뒤 finalize_prior가 정한다."""
    seed = ix.pool.seed
    cnt: Counter = Counter()
    for node in nodes:
        for r in ix.refs.get(node, _EMPTY):
            cnt[r] += 1
    items = sorted(((x, c) for x, c in cnt.items() if c >= MIN_COUNT and x != seed), key=lambda t: (-t[1], t[0]))
    if len(items) > n:
        floor = items[n - 1][1]
        items = [t for t in items if t[1] >= floor]
    return items[:cap]


def finalize_prior(cands: list[tuple[int, int]], meta: dict[int, dict], n: int = PRIOR_N) -> list[tuple[int, int]]:
    """서지가 있는 후보만, count 내림차순 → 피인용 내림차순 → 번호 오름차순으로 n편"""
    have = [(x, c) for x, c in cands if x in meta]
    have.sort(key=lambda t: (-t[1], -int(meta[t[0]].get("cited_by_count") or 0), t[0]))
    return have[:n]


def derivative_works(ix: Index, nodes: list[int], n: int = DERIVATIVE_N) -> list[tuple[int, int]]:
    """[(번호, count)] — 풀 안 작품 중 노드를 count ≥ 2편 인용한 것(씨앗 제외). count 내림차순 → 연도 내림차순 → 번호."""
    seed = ix.pool.seed
    nodeset = set(nodes)
    out = []
    for y in ix.members:
        if y == seed:
            continue
        c = len(ix.refs.get(y, _EMPTY) & nodeset)
        if c >= MIN_COUNT:
            out.append((y, c))
    year = lambda y: int(ix.pool.works[y].get("year") or 0)  # noqa: E731
    out.sort(key=lambda t: (-t[1], -year(t[0]), t[0]))
    return out[:n]


# ------------------------------------------------------------------ 관계 · 경고
def relations(ix: Index, w: int) -> list[str]:
    """씨앗과의 관계(9.3절 relation)"""
    seed = ix.pool.seed
    if w == seed:
        return []
    out = []
    if w in ix.refs.get(seed, _EMPTY):
        out.append("reference")
    if seed in ix.refs.get(w, _EMPTY):
        out.append("citing")
    if w in ix.related.get(seed, _EMPTY) or seed in ix.related.get(w, _EMPTY):
        out.append("related")
    if not out and "cocited" in ix.pool.origin.get(w, ()):
        out.append("cocited")
    return out


def weak_citation(edges: list[dict]) -> bool:
    """고른 노드의 선 가운데 related가 절반을 넘으면 참 (6.8절)"""
    return bool(edges) and sum(1 for e in edges if e["kind"] == "related") * 2 > len(edges)


@dataclass
class Layout:
    """한 크기의 그래프 결과(번호만 — 서지는 호출 쪽이 붙인다)"""

    nodes: list[int]
    scores: dict[int, float]
    relations: dict[int, list[str]]
    edges: list[dict]
    prior: list[tuple[int, int]]
    derivative: list[tuple[int, int]]
    weak: bool


def compute(ix: Index, size: int, meta: dict[int, dict], ranks: dict | None = None) -> Layout:
    """크기 하나의 결과. meta = 이전 연구 후보의 서지(풀 밖 작품 포함)."""
    ranks = ranks if ranks is not None else rank_scores(ix)
    nodes = select_nodes(ix, size, ranks)
    if not nodes:
        return Layout([], {}, {}, [], [], [], False)
    edges = build_edges(ix, nodes)
    prior = finalize_prior(prior_candidates(ix, nodes), meta)
    deriv = derivative_works(ix, nodes)
    scores = {w: round(ranks[w][1], 4) for w in nodes if w in ranks}
    rels = {w: relations(ix, w) for w in nodes}
    return Layout(nodes, scores, rels, edges, prior, deriv, weak_citation(edges))
