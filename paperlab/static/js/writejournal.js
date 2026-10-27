// 학술지 투고 규정 (2026-10-27 사용자 요청) — 순수 함수. 원고 설정 cover.journal:
// { name, max_pages, max_chars, abstract_ko_max(자), abstract_en_max(단어), keywords_min, keywords_max, refs_max, style, notes[] }
// 규정 글은 AI(글쓰기 작업 mode=journal)가 JSON으로 뽑고, 제출 전 점검표가 이 기준으로 본다(writecheck.js).

export const JOURNAL_NUM_KEYS = ["max_pages", "max_chars", "abstract_ko_max", "abstract_en_max", "keywords_min", "keywords_max", "refs_max"];
export const JOURNAL_LABELS = {
  max_pages: "본문 분량 (쪽 이하)", max_chars: "본문 분량 (글자 이하)", abstract_ko_max: "국문 초록 (글자 이하)",
  abstract_en_max: "영문 초록 (단어 이하)", keywords_min: "주제어 (개 이상)", keywords_max: "주제어 (개 이하)", refs_max: "참고문헌 (편 이하)",
};

const posInt = (v) => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : v;
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n) : null;
};

/** AI 답(JSON — 코드 블록 · 앞뒤 글이 있어도) → 정리한 규정 (알 수 없는 값은 버림) | null */
export function parseJournal(text) {
  const s = String(text ?? "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let data;
  try { data = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  return cleanJournal(data);
}

export function cleanJournal(data) {
  if (!data || typeof data !== "object") return null;
  const out = {};
  if (typeof data.name === "string" && data.name.trim()) out.name = data.name.trim().slice(0, 100);
  for (const k of JOURNAL_NUM_KEYS) {
    const n = posInt(data[k]);
    if (n != null) out[k] = n;
  }
  if (typeof data.style === "string" && data.style.trim()) out.style = data.style.trim().slice(0, 60);
  const notes = Array.isArray(data.notes) ? data.notes.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 200)).slice(0, 12) : [];
  if (notes.length) out.notes = notes;
  return out;
}

// '## 국문 초록' · '## Abstract' 절의 글 (다음 같은 단계 이상 제목까지)
function section(value, re) {
  const lines = String(value ?? "").split("\n");
  let level = 0;
  const out = [];
  for (const l of lines) {
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      if (level && h[1].length <= level) break;
      if (!level && re.test(h[2].replace(/\s+/g, ""))) { level = h[1].length; continue; }
    }
    if (level) out.push(l);
  }
  return level ? out.join("\n") : null;
}
const KO_ABS_RE = /^(국문)?(초록|요약|요지)$/;
const EN_ABS_RE = /^abstract$/i;
const KW_RE = /^\s*(?:\*\*)?(주제어|핵심어|키워드|key\s*words?)(?:\*\*)?\s*[:：]\s*(.+)$/i;

const bodyChars = (t) => t.replace(/\[@[^\]\n]*\]/g, "").replace(/[*_#>`|]/g, "").replace(/\s+/g, " ").trim().length;

/** → [{ sev, code, msg, at? }] — stats: { pages, chars, refs, style } (점검표가 이미 어림한 값) */
export function journalIssues(value, journal, stats = {}) {
  const j = journal || {};
  const out = [];
  const name = j.name ? `'${j.name}' ` : "";
  const push = (sev, code, msg, at = null) => out.push({ sev, code, msg, at });
  if (j.max_pages && stats.pages > j.max_pages) push("must", "journal-pages", `${name}투고 규정은 ${j.max_pages}쪽 이하인데 어림 ${stats.pages}쪽이에요`);
  if (j.max_chars && stats.chars > j.max_chars) {
    push("must", "journal-chars", `${name}투고 규정은 ${j.max_chars.toLocaleString("ko-KR")}자 이하인데 지금 ${stats.chars.toLocaleString("ko-KR")}자예요`);
  }
  const ko = section(value, KO_ABS_RE);
  if (j.abstract_ko_max && ko != null && bodyChars(ko) > j.abstract_ko_max) {
    push("warn", "journal-abstract-ko", `국문 초록이 ${bodyChars(ko).toLocaleString("ko-KR")}자예요 (규정 ${j.abstract_ko_max.toLocaleString("ko-KR")}자 이하)`,
      String(value).indexOf(ko));
  }
  const en = section(value, EN_ABS_RE);
  if (j.abstract_en_max && en != null) {
    const words = (en.replace(/^\s*key\s*words?\s*[:：].*$/gim, "").match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
    if (words > j.abstract_en_max) push("warn", "journal-abstract-en", `영문 초록이 ${words}단어예요 (규정 ${j.abstract_en_max}단어 이하)`, String(value).indexOf(en));
  }
  if (j.keywords_min || j.keywords_max) {
    const lines = String(value ?? "").split("\n");
    let pos = 0;
    for (const l of lines) {
      const m = l.match(KW_RE);
      if (m) {
        const n = m[2].split(/[,，;·]/).map((x) => x.trim()).filter(Boolean).length;
        if ((j.keywords_min && n < j.keywords_min) || (j.keywords_max && n > j.keywords_max)) {
          const range = j.keywords_min && j.keywords_max ? `${j.keywords_min}~${j.keywords_max}개` : j.keywords_min ? `${j.keywords_min}개 이상` : `${j.keywords_max}개 이하`;
          push("warn", "journal-keywords", `${m[1]}가 ${n}개예요 (규정 ${range})`, pos);
        }
      }
      pos += l.length + 1;
    }
  }
  if (j.refs_max && stats.refs > j.refs_max) push("warn", "journal-refs", `참고문헌이 ${stats.refs}편이에요 (규정 ${j.refs_max}편 이하)`);
  if (j.style && stats.style && !styleMatches(j.style, stats.style)) {
    push("warn", "journal-style", `${name}인용 양식은 '${j.style}'인데 원고는 '${stats.style}'를 쓰고 있어요`);
  }
  return out;
}

// 'APA 7판' ↔ apa · 'Chicago' ↔ chicago-author-date 처럼 이름의 첫 낱말로 비교 (모르는 이름은 같다고 봄)
const STYLE_WORDS = ["apa", "chicago", "mla", "harvard", "ieee", "vancouver", "kci", "ama", "nature", "acs"];
export function styleMatches(rule, style) {
  const r = String(rule).toLowerCase();
  const s = String(style).toLowerCase();
  const known = STYLE_WORDS.find((w) => r.includes(w));
  return !known || s.includes(known);
}
