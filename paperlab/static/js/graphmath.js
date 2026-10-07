// 인용 그래프 화면의 순수 함수 (docs/specs/citation-graph.md 10장 · docs/design/citation-graph-ui.md 4 · 5 · 7 · 8장)
// DOM · 네트워크를 쓰지 않는다 — Node에서 그대로 시험한다(tests/js/graph.test.mjs).
// 배치(layoutGraph)는 d3-force를 인자로 받아 계산만 시킨다(그리기는 graph.js의 SVG).

export const GRAPH_SIZES = [20, 40, 80];
export const DEFAULT_SIZE = 40;
export const STEPS = ["seed", "references", "citing", "cocitation", "finish", "compute"];
export const STEP_LABELS = {
  seed: "씨앗 논문 찾기",
  references: "참고문헌 · 관련 논문 모으기",
  citing: "이 논문을 인용한 논문 모으기",
  cocitation: "함께 인용된 논문 찾기",
  finish: "초록 · 이전 연구 정보 받기",
  compute: "유사도 계산",
};
// 노드 반지름 범위(px): 20 · 40편 6~28, 80편 5~22 (디자인 GD-9)
const R_RANGE = { 20: [6, 28], 40: [6, 28], 80: [5, 22] };

export const REL_TEXT = {
  reference: "씨앗이 인용함",
  citing: "씨앗을 인용함",
  related: "OpenAlex 관련 논문",
  cocited: "함께 인용됨",
};

// 경고 code → 문구 (디자인 8.2 — 모르는 code는 서버 message)
export const WARN_TEXT = {
  partial: "시간이 오래 걸려 일부 단계를 건너뛰었어요.",
  refs_partial: "참고문헌 일부를 받지 못했어요.",
  citing_failed: "이 논문을 인용한 논문을 받지 못했어요.",
  cocite_failed: "함께 인용된 논문을 받지 못했어요.",
  abstracts_failed: "일부 논문의 초록을 받지 못했어요.",
  stale_cache: "일부 정보가 오래됐을 수 있어요.",
  s2_failed: "Semantic Scholar가 응답하지 않아 참고문헌을 보강하지 못했어요.",
};
const INFO_CODES = ["weak_citation_data", "truncated"];
const SEPARATE_CODES = ["upstream_limited", "resize_failed"];

// ------------------------------------------------------------------ 크기 · 색
export function radius(cited, cMax, size = DEFAULT_SIZE) {
  const [lo, hi] = R_RANGE[size] || R_RANGE[DEFAULT_SIZE];
  const c = Math.max(0, Number(cited) || 0);
  if (!(cMax > 0)) return lo;
  const v = Math.log1p(c) / Math.log1p(cMax);
  return lo + (hi - lo) * Math.min(1, Math.max(0, v));
}

// 연도 5구간(디자인 4.2): 가장 최근 구간은 늘 4, 연도가 적으면 구간도 적게
export function yearScale(years) {
  const ys = (years || []).filter((y) => Number.isInteger(y));
  if (!ys.length) return null;
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const span = yMax - yMin + 1;
  return { yMin, yMax, span, bins: Math.min(5, span) };
}

export function yearBin(year, sc) {
  if (!sc || !Number.isInteger(year)) return "none";
  let k = Math.floor(((year - sc.yMin) / sc.span) * sc.bins);
  k = Math.min(sc.bins - 1, Math.max(0, k));
  return 5 - sc.bins + k;
}

// 범례 칸: [{yb, start, end, label, title}] — 칸 아래 숫자는 구간 시작 연도, 마지막 칸만 "시작–끝(두 자리)"
export function yearRamp(sc) {
  if (!sc) return [];
  const out = [];
  for (let k = 0; k < sc.bins; k++) {
    const start = Math.ceil(sc.yMin + (k * sc.span) / sc.bins);
    const next = k + 1 < sc.bins ? Math.ceil(sc.yMin + ((k + 1) * sc.span) / sc.bins) : sc.yMax + 1;
    const end = next - 1;
    const last = k === sc.bins - 1;
    const range = end > start ? `${start}–${String(end).slice(-2)}` : String(start);
    out.push({ yb: 5 - sc.bins + k, start, end, label: last ? range : String(start), title: end > start ? `${start}–${end}` : String(start) });
  }
  return out;
}

// ------------------------------------------------------------------ 글자
export function firstFamily(paper) {
  const a = ((paper && paper.authors) || [])[0];
  if (!a) return "";
  return String(a.family || a.literal || a.given || "").trim();
}

// 이름표 "첫 저자 성, 연도" (저자 없으면 제목 앞 20자…)
export function nodeLabel(paper) {
  const fam = firstFamily(paper);
  const year = paper && Number.isInteger(paper.year) ? String(paper.year) : "연도 없음";
  if (fam) return `${fam}, ${year}`;
  const t = String((paper && paper.title) || "").trim();
  return t.length > 20 ? `${t.slice(0, 20)}…` : t || "제목 없음";
}

export function shortTitle(title, n = 70) {
  const t = String(title || "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export function nodeAriaLabel(node) {
  const p = node.paper || {};
  const parts = [String(p.title || "제목 없음"), Number.isInteger(p.year) ? `${p.year}년` : "연도 없음",
    `피인용 ${fmt(p.cited_by_count || 0)}회`];
  if (node.isSeed) parts.push("씨앗 논문");
  if (node.inLibrary) parts.push("서재에 있음");
  return parts.join(", ");
}

export function fmt(n) {
  return Number(n || 0).toLocaleString("ko-KR");
}

// 진행 문구의 수 ("참고문헌 · 관련 논문 320편" → "320편")
export function countFromMessage(msg) {
  const m = String(msg || "").match(/(\d[\d,]*)편/);
  return m ? `${m[1]}편` : "";
}

// 진행 단계 상태: 지금 단계 앞은 모두 done (캐시로 건너뛴 단계 포함). wait = 씨앗 단계에 머묾
export function stepStates(step) {
  const cur = step === "wait" ? 0 : Math.max(0, STEPS.indexOf(step));
  const out = {};
  STEPS.forEach((s, i) => { out[s] = i < cur ? "done" : i === cur ? "now" : "todo"; });
  return out;
}

export function relationText(relation) {
  return (relation || []).map((r) => REL_TEXT[r]).filter(Boolean).join(", ");
}

// 씨앗과의 관계(논문 정보 탭 "씨앗과")
export function seedRelationText(edge) {
  if (!edge) return "직접 이어진 선은 없어요";
  if (edge.kind === "coupling") return `같은 참고문헌 ${edge.shared}편`;
  if (edge.kind === "cocitation") return `함께 인용한 논문 ${edge.shared}편`;
  return "주제가 비슷함(인용 근거 없음)";
}

// Scholar 질의: 제목, 없으면 DOI
export function scholarQuery(paper) {
  return String((paper && (paper.title || paper.doi)) || "").trim();
}

// ------------------------------------------------------------------ 씨앗 (진입점 → 요청 본문)
export function seedFromResult(it) {
  const s = {};
  if (it && /^W[1-9]\d{0,11}$/.test(String(it.openalex_id || ""))) s.openalex_id = it.openalex_id;
  if (it && it.doi) s.doi = String(it.doi);
  if (it && it.arxiv_id) s.arxiv_id = String(it.arxiv_id);
  const t = String((it && it.title) || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (t.length >= 3) s.title = t;
  return s;
}

export function seedKey(seed) {
  if (!seed) return "";
  if (seed.paper_id) return `p:${seed.paper_id}`;
  if (seed.openalex_id) return seed.openalex_id;
  if (seed.doi) return `doi:${String(seed.doi).toLowerCase()}`;
  if (seed.arxiv_id) return `arxiv:${seed.arxiv_id}`;
  return `title:${String(seed.title || "").toLowerCase()}`;
}

// ------------------------------------------------------------------ 이웃 · 정렬
export function neighbors(edges) {
  const m = new Map();
  for (const e of edges || []) {
    if (!m.has(e.source)) m.set(e.source, new Set());
    if (!m.has(e.target)) m.set(e.target, new Set());
    m.get(e.source).add(e.target);
    m.get(e.target).add(e.source);
  }
  return m;
}

// 이 노드와 이어진 선 굵은 순 k편 [{id, edge}]
export function closest(id, edges, k = 5) {
  return (edges || [])
    .filter((e) => e.source === id || e.target === id)
    .sort((a, b) => b.weight - a.weight || (a.source + a.target).localeCompare(b.source + b.target))
    .slice(0, k)
    .map((e) => ({ id: e.source === id ? e.target : e.source, edge: e }));
}

export function edgeBetween(a, b, edges) {
  return (edges || []).find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a)) || null;
}

const SORT_CAPTION = {
  "score:desc": "씨앗과 비슷한 순", "score:asc": "비슷하지 않은 순", "year:desc": "최근 순", "year:asc": "오래된 순",
  "cited:desc": "피인용 많은 순", "cited:asc": "피인용 적은 순", "title:asc": "제목 순", "title:desc": "제목 역순",
};

export function sortCaption(key, dir, n) {
  return `그래프 논문 ${n}편 · ${SORT_CAPTION[`${key}:${dir}`] || ""}`;
}

// 목록 보기 정렬. score 정렬에서는 씨앗이 늘 맨 위. 같은 값은 id 순(결과 고정)
export function sortRows(nodes, key = "score", dir = "desc") {
  const sign = dir === "asc" ? 1 : -1;
  const val = (n) => {
    if (key === "title") return String(n.paper.title || "");
    if (key === "year") return Number.isInteger(n.paper.year) ? n.paper.year : -Infinity;
    if (key === "cited") return n.paper.cited_by_count || 0;
    return n.score == null ? -Infinity : n.score;
  };
  return [...nodes].sort((a, b) => {
    if (key === "score") {
      if (a.isSeed !== b.isSeed) return a.isSeed ? -1 : 1;
    }
    const va = val(a);
    const vb = val(b);
    let c = key === "title" ? va.localeCompare(vb, "ko") : va < vb ? -1 : va > vb ? 1 : 0;
    c *= sign;
    return c || a.id.localeCompare(b.id);
  });
}

// ------------------------------------------------------------------ 응답 → 화면 모델
export function toModel(graph) {
  const raw = (graph && graph.nodes) || [];
  const size = (graph && graph.size) || DEFAULT_SIZE;
  const cMax = Math.max(0, ...raw.map((n) => (n.paper && n.paper.cited_by_count) || 0));
  const sc = yearScale(raw.map((n) => n.paper && n.paper.year));
  const nodes = raw.map((n) => ({
    id: n.id,
    isSeed: !!n.is_seed,
    paper: n.paper || {},
    relation: n.relation || [],
    score: n.score == null ? null : n.score,
    inLibrary: n.in_library || null,
    r: radius((n.paper || {}).cited_by_count, cMax, size),
    yb: yearBin((n.paper || {}).year, sc),
    label: nodeLabel(n.paper || {}),
  }));
  // 늘 보이는 이름표: 씨앗 + 피인용 상위 min(15, ⌈n × 0.4⌉)편
  const nLabels = Math.min(15, Math.ceil(nodes.length * 0.4));
  const top = [...nodes].filter((n) => !n.isSeed)
    .sort((a, b) => (b.paper.cited_by_count || 0) - (a.paper.cited_by_count || 0) || a.id.localeCompare(b.id))
    .slice(0, nLabels).map((n) => n.id);
  const always = new Set(top);
  for (const n of nodes) n.showLabel = n.isSeed || always.has(n.id);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = ((graph && graph.edges) || []).filter((e) => ids.has(e.source) && ids.has(e.target));
  const seed = nodes.find((n) => n.isSeed) || nodes[0] || null;
  return {
    seedId: seed ? seed.id : (graph && graph.seed) || "",
    seed,
    size,
    nodes,
    edges,
    byId: new Map(nodes.map((n) => [n.id, n])),
    nbrs: neighbors(edges),
    yearScale: sc,
    cMax,
    prior: (graph && graph.prior) || [],
    derivative: (graph && graph.derivative) || [],
    warnings: (graph && graph.warnings) || [],
    stats: (graph && graph.stats) || {},
    hasRelated: edges.some((e) => e.kind === "related"),
    hasNoYear: nodes.some((n) => n.yb === "none"),
  };
}

// 선 굵기 · 진하기 (디자인 4.3)
export const edgeWidth = (w) => 1 + 3 * Math.max(0, Math.min(1, w || 0));
export const edgeOpacity = (w) => 0.3 + 0.55 * Math.max(0, Math.min(1, w || 0));

// 경고 묶기 (디자인 8.2): [{tone, code, head, items:[문구], settings}]
export function groupNotices(warnings) {
  const fail = [];
  const info = [];
  const separate = [];
  for (const w of warnings || []) {
    if (SEPARATE_CODES.includes(w.code)) separate.push(w);
    else if (INFO_CODES.includes(w.code)) info.push(w);
    else fail.push(WARN_TEXT[w.code] || String(w.message || ""));
  }
  const out = [];
  if (fail.length) out.push({ tone: "warn", code: "partial", items: fail.filter(Boolean) });
  if (info.length) out.push({ tone: "info", code: info.map((w) => w.code).join(" "), infos: info.map((w) => w.code) });
  for (const w of separate) out.push({ tone: "warn", code: w.code, settings: w.code === "upstream_limited" });
  return out;
}

// ------------------------------------------------------------------ 배치 · 화면 맞춤 · 키보드
// d3-force로 정해진 횟수만 계산(애니메이션 없음). 노드를 id 순으로 넣어 시작 위치를 고정 → 같은 입력이면 같은 좌표
export function layoutGraph(model, d3, { iterations = 300 } = {}) {
  const nodes = [...model.nodes].sort((a, b) => a.id.localeCompare(b.id))
    .map((n) => ({ id: n.id, r: n.r, ...(n.isSeed ? { fx: 0, fy: 0 } : {}) }));
  const links = model.edges.map((e) => ({ source: e.source, target: e.target, weight: e.weight || 0 }));
  const sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id)
      .distance((l) => 50 + 150 * (1 - Math.min(1, l.weight)))
      .strength((l) => 0.15 + 0.85 * Math.min(1, l.weight)))
    .force("charge", d3.forceManyBody().strength(-170).distanceMax(600))
    .force("collide", d3.forceCollide((d) => d.r + 6).iterations(2))
    .force("x", d3.forceX(0).strength(0.05))
    .force("y", d3.forceY(0).strength(0.05))
    .stop();
  sim.tick(iterations);
  const pos = new Map();
  for (const n of nodes) pos.set(n.id, { x: Math.round(n.x * 100) / 100, y: Math.round(n.y * 100) / 100 });
  return pos;
}

// 모든 노드 + 반지름 + pad가 w×h 안에 들어오는 변환 {k, x, y} (화면 = 배치 × k + (x, y))
export function fitTransform(points, w, h, pad = 24, kMax = 2.5) {
  if (!points.length || !(w > 0) || !(h > 0)) return { k: 1, x: w / 2 || 0, y: h / 2 || 0 };
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of points) {
    const r = p.r || 0;
    x0 = Math.min(x0, p.x - r); y0 = Math.min(y0, p.y - r);
    x1 = Math.max(x1, p.x + r); y1 = Math.max(y1, p.y + r);
  }
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  const k = Math.min(kMax, Math.max(0.05, Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh)));
  return { k, x: w / 2 - ((x0 + x1) / 2) * k, y: h / 2 - ((y0 + y1) / 2) * k };
}

// 마우스 위치(px, py)를 중심으로 배율을 factor배(최소 · 최대 안)로
export function zoomAt(t, factor, px, py, kMin, kMax) {
  const k = Math.min(kMax, Math.max(kMin, t.k * factor));
  const f = k / t.k;
  return { k, x: px - (px - t.x) * f, y: py - (py - t.y) * f };
}

// 화살표 방향으로 가장 가까운 노드: 방향 앞쪽 노드 중 (거리 + 2 × 옆으로 벗어난 거리)가 가장 작은 것
export function nearestInDirection(pos, fromId, dir) {
  const a = pos.get(fromId);
  if (!a) return null;
  const v = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[dir];
  if (!v) return null;
  let best = null;
  let bestScore = Infinity;
  for (const [id, p] of pos) {
    if (id === fromId) continue;
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const ahead = dx * v[0] + dy * v[1];
    if (ahead <= 0) continue;
    const side = Math.abs(dx * v[1] - dy * v[0]);
    const score = Math.hypot(dx, dy) + 2 * side;
    if (score < bestScore || (score === bestScore && id < best)) { best = id; bestScore = score; }
  }
  return best;
}
