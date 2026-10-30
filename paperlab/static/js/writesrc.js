// 출처 확인 (2026-10-26 사용자 요청 — "[확인 필요]를 AI가 직접 확인해서 알려 주기") — 순수 함수
// 원고 문장 하나 → 서버 작업(find, mode=claim): 내 서재 본문 조각 [L1…] + OpenAlex · Semantic Scholar 논문 [1…] → AI 판정.
// 화면은 writesrcui.js (AI 패널의 '출처' 보기)
import { CHECK_RE } from "./writemd.js";

export const CLAIM_MAX = 1500; // 서버 find.CLAIM_MAX와 같게

// 문장 끝: . ? ! 。 (괄호 [ ] ( ) 안은 문장 끝이 아님 — [확인 필요: 출처 — KOSIS 2023.] 같은 표시가 잘리지 않게)
function sentences(par) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < par.length; i++) {
    const ch = par[i];
    if (ch === "[" || ch === "(") depth++;
    else if ((ch === "]" || ch === ")") && depth) depth--;
    else if (!depth && /[.?!。]/.test(ch) && (i + 1 === par.length || /\s/.test(par[i + 1]))) {
      out.push([start, i + 1]);
      start = i + 1;
    }
  }
  if (start < par.length) out.push([start, par.length]);
  return out
    .map(([a, b]) => {
      while (a < b && /\s/.test(par[a])) a++;
      return [a, b];
    })
    .filter(([a, b]) => b > a);
}

/** 확인할 문장: 고른 글이 있으면 그 글, 없으면 커서가 있는 문장. 커서 문장에 [확인 필요]가 없으면 같은 문단에서
 *  표시가 든 문장 중 커서에 가장 가까운 것. → { from, to, text } | null (빈 문단 · 제목 줄 · 너무 김) */
export function claimAt(value, start, end = start) {
  const v = String(value ?? "");
  if (end > start) {
    let a = start;
    let b = end;
    while (a < b && /\s/.test(v[a])) a++;
    while (b > a && /\s/.test(v[b - 1])) b--;
    const text = v.slice(a, b);
    return text.length >= 5 && text.length <= CLAIM_MAX ? { from: a, to: b, text } : null;
  }
  const ps = v.lastIndexOf("\n\n", Math.max(0, start - 1));
  const pFrom = ps < 0 ? 0 : ps + 2;
  const pe = v.indexOf("\n\n", start);
  const pTo = pe < 0 ? v.length : pe;
  const par = v.slice(pFrom, pTo);
  if (!par.trim() || /^\s{0,3}(#{1,6}\s|\||```|~~~|!\[)/.test(par)) return null;
  const sents = sentences(par).map(([a, b]) => ({ from: pFrom + a, to: pFrom + b }));
  if (!sents.length) return null;
  const at = sents.find((s) => start >= s.from && start <= s.to) || sents[sents.length - 1];
  const has = (s) => new RegExp(CHECK_RE.source).test(v.slice(s.from, s.to));
  let pick = at;
  if (!has(at)) {
    const marked = sents.filter(has);
    if (marked.length) pick = marked.reduce((x, y) => (Math.abs(y.from - start) < Math.abs(x.from - start) ? y : x));
  }
  const text = v.slice(pick.from, pick.to).trim();
  return text.length >= 5 && text.length <= CLAIM_MAX ? { from: pick.from, to: pick.from + text.length, text } : null;
}

/** 원고의 [확인 필요] 목록 (2026-10-27): 표시마다 { at, mark, need, claim } — 같은 문장에 표시가 여럿이면 한 번.
 *  need = 표시의 '확인할 것' 글, claim = 그 문장(claimAt — 제목 · 표 안이면 null) */
export function checkList(value) {
  const v = String(value ?? "");
  const out = [];
  const seen = new Set();
  for (const m of v.matchAll(CHECK_RE)) {
    const claim = claimAt(v, m.index);
    const key = claim ? `c${claim.from}` : `m${m.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const need = m[0].replace(/^\[확인\s*필요\s*[:：]?\s*/, "").replace(/\]$/, "").trim();
    out.push({ at: m.index, mark: m[0], need, claim });
  }
  return out;
}

// 서버가 저장하는 문장(빈칸 정리)과 같게 — 지난 확인 작업과 짝짓기
export const claimKey = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/** 미리보기의 n번째 표시(같은 글의 표시 중 k번째) → 원고에서 그 표시의 자리 (없으면 -1) */
export function markerIndex(value, markText, k) {
  let seen = 0;
  for (const m of String(value ?? "").matchAll(CHECK_RE)) {
    if (m[0] !== markText) continue;
    if (seen++ === k) return m.index;
  }
  return -1;
}

const LABELS = { "근거": "basis", "고친 문장": "revised", "확인할 곳": "where" };
export const VERDICT_TONE = { "근거 있음": "ok", "일부 있음": "warn", "반대 근거 있음": "bad", "찾지 못함": "bad" };

/** 판정 글 → { verdict, tone, basis, revised, where } ("없음"은 빈 글) */
export function parseClaim(answer) {
  const out = { verdict: "", tone: "", basis: "", revised: "", where: "" };
  let key = null;
  for (const raw of String(answer ?? "").split(/\r?\n/)) {
    const line = raw.replace(/^\s*[-*]\s+/, "");
    const m = line.match(/^\s*\**\s*(판정|근거|고친 문장|확인할 곳)\s*\**\s*[:：]\s*\**\s*(.*)$/);
    if (m && m[1] === "판정") {
      const v = m[2].replace(/\*+/g, "").trim();
      out.verdict = Object.keys(VERDICT_TONE).find((x) => v.includes(x)) || v;
      out.tone = VERDICT_TONE[out.verdict] || "";
      key = null;
      continue;
    }
    if (m) {
      key = LABELS[m[1]];
      out[key] = m[2].trim();
      continue;
    }
    if (key && line.trim()) out[key] += (out[key] ? "\n" : "") + line.trim();
  }
  for (const k of ["basis", "revised", "where"]) {
    out[k] = out[k].replace(/^["“]|["”]$/g, "").trim();
    if (/^없음\.?$/.test(out[k])) out[k] = "";
  }
  return out;
}

/** 고친 문장 넣기: 원래 자리가 그대로면 거기, 아니면 원고에서 같은 문장(하나뿐일 때) → { from, to } | null */
export function claimRange(value, claim) {
  const v = String(value ?? "");
  if (!claim || !claim.text) return null;
  if (Number.isInteger(claim.from) && v.slice(claim.from, claim.from + claim.text.length) === claim.text) {
    return { from: claim.from, to: claim.from + claim.text.length };
  }
  const i = v.indexOf(claim.text);
  if (i < 0 || v.indexOf(claim.text, i + 1) >= 0) return null;
  return { from: i, to: i + claim.text.length };
}

/** 근거 글의 [L1] · [3] → 누를 수 있는 번호 (글은 esc 한 뒤 번호만 바꿈) */
const REF_NAME = { L: "내 서재 조각", W: "웹 자료", "": "외부 논문" };
export function refsHtml(text, esc, { lib = 0, ext = 0, web = 0 } = {}) {
  return esc(String(text ?? "")).replace(/\[([LW]?)(\d{1,3})\]/g, (all, l, d) => {
    const n = Number(d);
    if (n < 1 || n > (l === "L" ? lib : l === "W" ? web : ext)) return "";
    return `<button type="button" class="cite-ref src-ref" data-src-ref="${l}${n}" title="${REF_NAME[l]} ${l}${n} 보기">${l}${n}</button>`;
  });
}

// 웹 자료 종류 → 칩 색 (통계 · 정부·기관은 1차 출처, 뉴스 · 웹은 학술 근거 아님)
export const WEB_TONE = { "통계": "ok", "정부·기관": "ok", "뉴스": "warn", "웹": "warn" };

/** 확인한 웹 자료 → 서재 항목(웹페이지): 제목 · 발행처(저자 자리 literal) · 날짜 · 주소 */
export function webPaper(w) {
  const m = /^(\d{4})(?:[-./](\d{1,2}))?(?:[-./](\d{1,2}))?/.exec(String(w.date || "").trim());
  const year = m ? Number(m[1]) : null;
  const issued = m ? [m[1], m[2] && m[2].padStart(2, "0"), m[3] && m[3].padStart(2, "0")].filter(Boolean).join("-") : "";
  return {
    title: String(w.title || w.site || "").slice(0, 300), item_type: "webpage", url: String(w.url || ""),
    authors: w.publisher ? [{ literal: String(w.publisher).slice(0, 120) }] : [],
    venue: String(w.publisher || w.site || "").slice(0, 120), year, issued, abstract: String(w.quote || ""),
  };
}
