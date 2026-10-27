// AI 결과의 숫자 · 인용 대조 (2026-10-28 사용자 요청) — 순수 함수 (tests/js/writeguard.test.mjs). 화면은 writing.js AI 결과 패널.
// AI는 글을 복사하지 않고 다시 써서, 다듬기 · 번역에서 "34.5%"가 "약 35%"로 바뀌거나 [@인용키]가 빠지고, 통계 출력을 옮기다
// 숫자를 잘못 적고, 비교표에서 연도를 틀릴 수 있다. 엔진(claude · codex · gemini · API 키)과 상관없이 결과를 코드로 대조해 알린다.

// 숫자 · 인용이 원래 글과 같아야 하는 글쓰기 (번역은 작은 수를 낱말로 풀 수 있어 0~10 정수는 보지 않음)
const SAME_MODES = new Set(["polish", "academic", "concise", "paraphrase", "to_en", "to_ko", "memo", "abstract_en", "abstract_ko"]);
const TRANSLATE = new Set(["to_en", "to_ko", "abstract_en", "abstract_ko"]);
const NEW_ONLY = new Set(["expand"]); // 늘려 쓰기: 원래 글에 없던 숫자 · 인용이 생기면 지어낸 것일 수 있음
const CITE_RE = /\[[^\]\n]*@[^\]\n]*\]/g;
const KEY_RE = /@([\p{L}\p{N}_][\p{L}\p{N}_:.#$%&+?<>~/-]*)/gu;
// 숫자: 1,234 · 3.45 · .025 · −0.63. 바로 앞이 영문 · 숫자면 숫자로 안 봄(H1 · var2), 앞이 숫자인 - 는 부호 아님(1-5 범위). 한글 바로 뒤(약35%)는 봄
const NUM_RE = /(^|[^A-Za-z0-9_.,])([-−–]?)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?!\d)/gu;

/** 글 속 [@인용키] → 키 목록 (순서대로, 겹침 포함) */
export function citeKeys(text) {
  const out = [];
  for (const m of String(text || "").matchAll(CITE_RE)) for (const k of m[0].matchAll(KEY_RE)) out.push(k[1].replace(/[.,;:]+$/, ""));
  return out;
}

/** 글 속 숫자 → [{ raw, value, dec }] (인용 표시 안 숫자는 뺌). value는 쉼표 · 앞 0 · 끝 0을 맞춘 글("0.025", "-3.5") */
export function numbersIn(text) {
  const s = String(text || "").replace(CITE_RE, " ");
  const out = [];
  for (const m of s.matchAll(NUM_RE)) {
    const body = m[3].replace(/,/g, "");
    const dec = body.includes(".") ? body.split(".")[1].length : 0;
    const v = Number((m[2] ? "-" : "") + body);
    if (!Number.isFinite(v)) continue;
    out.push({ raw: (m[2] ? "−" : "") + m[3], value: String(v), num: v, dec });
  }
  return out;
}

// a에 있고 b에 덜 있는 것 (겹침 셈) → 처음 나온 순서, 한 번씩
function lacking(a, b, key) {
  const cnt = new Map();
  for (const x of b) cnt.set(key(x), (cnt.get(key(x)) || 0) + 1);
  const out = [];
  const seen = new Set();
  for (const x of a) {
    const k = key(x);
    const n = cnt.get(k) || 0;
    if (n > 0) { cnt.set(k, n - 1); continue; }
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

const smallInt = (n) => n.dec === 0 && Math.abs(n.num) <= 10;
const list = (xs, max = 8) => xs.slice(0, max).join(", ") + (xs.length > max ? ` 외 ${xs.length - max}개` : "");

/** 다듬기 · 번역 · 늘려 쓰기: 원래 글(orig)과 결과(out)의 숫자 · 인용 키 차이 → [{ tone, text }] */
export function compareRewrite(mode, orig, out) {
  if (!SAME_MODES.has(mode) && !NEW_ONLY.has(mode)) return [];
  const skip = TRANSLATE.has(mode) ? smallInt : () => false;
  const a = numbersIn(orig).filter((n) => !skip(n));
  const b = numbersIn(out).filter((n) => !skip(n));
  const ka = citeKeys(orig);
  const kb = citeKeys(out);
  const notes = [];
  const lost = NEW_ONLY.has(mode) ? [] : lacking(a, b, (n) => n.value);
  const added = lacking(b, a, (n) => n.value);
  if (lost.length) notes.push({ tone: "warn", text: `원래 글의 숫자가 결과에서 빠지거나 바뀌었어요: ${list(lost.map((n) => n.raw))}` });
  if (added.length) notes.push({ tone: "warn", text: `원래 글에 없던 숫자가 결과에 생겼어요: ${list(added.map((n) => n.raw))} — 지어낸 값이 아닌지 확인해 주세요` });
  const lostK = NEW_ONLY.has(mode) ? [] : lacking(ka, kb, (k) => k);
  const addedK = lacking(kb, ka, (k) => k);
  if (lostK.length) notes.push({ tone: "warn", text: `인용 표시가 빠졌어요: ${list(lostK.map((k) => `[@${k}]`))} — 출처 없는 문장이 되지 않게 확인해 주세요` });
  if (addedK.length) notes.push({ tone: "warn", text: `원래 글에 없던 인용이 생겼어요: ${list(addedK.map((k) => `[@${k}]`))}` });
  return notes;
}

const roundTo = (x, d) => Math.round((x + Number.EPSILON * Math.sign(x)) * 10 ** d) / 10 ** d;

/**
 * 통계 출력 → 표 · 문장: 결과의 숫자가 붙여 넣은 출력(orig)의 어떤 값을 반올림한 것인지 → 아닌 숫자 [{ tone, text }].
 * 부호 차이(|t|) · 앞 0(.025) · "< .001" · 1~20 정수(표 번호 · 열 번호)는 넘어간다
 */
export function compareStats(orig, out) {
  const src = numbersIn(orig).map((n) => Math.abs(n.num));
  const body = String(out || "").replace(/<\s*0?\.001\b/g, " ").replace(/^표\s*\d*\s*[.:：].*$/gm, " ");
  const bad = [];
  const seen = new Set();
  for (const n of numbersIn(body)) {
    const v = Math.abs(n.num);
    if (n.dec === 0 && v >= 1 && v <= 20) continue;
    if (src.some((u) => Math.abs(roundTo(u, n.dec) - v) < 1e-9)) continue;
    if (!seen.has(n.value)) { seen.add(n.value); bad.push(n.raw); }
  }
  return bad.length ? [{ tone: "warn", text: `붙여 넣은 통계 출력에 없는 숫자가 있어요: ${list(bad)} — AI가 계산했거나 잘못 옮긴 값일 수 있으니 출력과 대조해 주세요` }] : [];
}

const familyOf = (a) => String((a && (a.literal || a.family)) || "").trim();

/**
 * 선행연구 비교표: 행마다 [@키]가 서재 논문인지 · 고른 논문인지, 같은 칸의 (연도) · 첫 저자가 서재 정보와 맞는지.
 * papers = [{ citekey, year, authors: [{family, given, literal}] }], chosen = 고른 키 목록
 */
export function compareMatrix(out, papers, chosen = []) {
  const byKey = new Map((papers || []).map((p) => [p.citekey, p]));
  const pick = new Set(chosen || []);
  const unknown = [];
  const notChosen = [];
  const wrongYear = [];
  const wrongAuthor = [];
  for (const line of String(out || "").split("\n")) {
    if (!/^\s*\|/.test(line)) continue;
    const cell = line.split("|").find((c) => c.includes("[@")) || "";
    for (const key of citeKeys(cell)) {
      const p = byKey.get(key);
      if (!p) { unknown.push(`[@${key}]`); continue; }
      if (pick.size && !pick.has(key)) notChosen.push(`[@${key}]`);
      const y = cell.match(/\((\d{4})[a-z]?\)|(\d{4})[a-z]?\s*\[@/);
      const year = y && (y[1] || y[2]);
      if (year && p.year && String(p.year).slice(0, 4) !== year) wrongYear.push(`[@${key}] ${year} → 서재 ${String(p.year).slice(0, 4)}`);
      const fam = familyOf((p.authors || [])[0]);
      if (fam && !cell.replace(CITE_RE, " ").toLowerCase().includes(fam.toLowerCase())) wrongAuthor.push(`[@${key}] 첫 저자 ${fam}`);
    }
  }
  const notes = [];
  if (unknown.length) notes.push({ tone: "warn", text: `서재에 없는 인용 키예요: ${list(unknown)} — AI가 지어낸 논문일 수 있어요` });
  if (notChosen.length) notes.push({ tone: "warn", text: `고르지 않은 논문이 표에 들어갔어요: ${list(notChosen)}` });
  if (wrongYear.length) notes.push({ tone: "warn", text: `연도가 서재 정보와 달라요: ${list(wrongYear)}` });
  if (wrongAuthor.length) notes.push({ tone: "info", text: `저자 이름이 서재 정보와 다를 수 있어요: ${list(wrongAuthor)}` });
  return notes;
}

/** AI 결과 패널의 대조 알림: w = 작업의 write 정보 { mode, text, keys }, result = 결과 글 */
export function guardNotes(w, result, papers = []) {
  w = w || {};
  if (!result) return [];
  if (w.mode === "stats") return w.text ? compareStats(w.text, result) : [];
  if (w.mode === "matrix") return compareMatrix(result, papers, w.keys);
  return w.text ? compareRewrite(w.mode, w.text, result) : [];
}
