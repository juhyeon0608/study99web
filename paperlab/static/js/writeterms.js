// 용어 통일 점검 (2026-10-27 사용자 요청) — 순수 함수. 제출 전 점검표(writecheck.js)의 '용어' 묶음
// ① 같은 말의 여러 표기(참여자/참가자, 콘텐츠/컨텐츠 …) ② 띄어쓰기만 다른 같은 말(연구 대상/연구대상)
// ③ 약어를 처음 쓸 때 풀어 썼는지(SNS → 사회관계망서비스(SNS)) ④ 내 용어집(원고 설정 cover.glossary: 쓸 말 ← 피할 말)

// 같은 뜻 · 다른 표기 (앞이 권장 — 국립국어원 외래어 표기 · 통계 용어 관례)
export const VARIANTS = [
  ["참여자", "참가자"], ["콘텐츠", "컨텐츠", "콘텐트"], ["메시지", "메세지"], ["리더십", "리더쉽"], ["데이터", "데이타"],
  ["웹사이트", "웹 사이트", "웹싸이트"], ["애플리케이션", "어플리케이션"], ["워크숍", "워크샵"], ["팬데믹", "펜데믹"],
  ["코로나19", "코로나 19", "코로나-19"], ["알고리즘", "알고리듬"], ["매뉴얼", "메뉴얼"], ["비즈니스", "비지니스"], ["타깃", "타겟"],
  ["플랫폼", "플렛폼", "플랫홈"], ["리포트", "레포트"], ["네트워크", "네트웍"], ["유의한", "유의미한"],
  ["독립변인", "독립변수"], ["종속변인", "종속변수"], ["매개변인", "매개변수"], ["조절변인", "조절변수"],
  ["설문조사", "설문 조사"], ["사전검사", "사전 검사"], ["사후검사", "사후 검사"], ["표준편차", "표준 편차"],
];
// 풀어 쓰지 않아도 되는 약어
const COMMON_ABBR = new Set(["PDF", "URL", "DOI", "ISBN", "ISSN", "APA", "IT", "PC", "TV", "OK", "USA", "UK", "EU", "UN", "AM", "PM",
  "CEO", "ID", "PPT", "QR", "OECD", "ICT", "AI", "SPSS", "AMOS", "SAS", "STATA", "KCI", "SCI", "SSCI", "II", "III", "IV", "VI", "VII",
  "VIII", "IX", "XI", "XII", "Vol", "No", "ed", "eds", "NA", "PRISMA"]);
// 띄어쓰기 비교에서 떼는 조사 · 어미 (긴 것부터)
const TAILS = ["에서는", "으로는", "에게서", "이라는", "에서", "에게", "으로", "이다", "에는", "와는", "과는", "들은", "들이", "들의", "들을",
  "들", "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도", "로", "만", "적", "인"];
const HANGUL_WORD_RE = /[가-힣]+/g;

// 점검하지 않을 부분을 같은 길이 빈칸으로: 코드 블록 · 인용 키 · 그림 · 링크 주소 · 꼬리표 · 수식 · 각주 정의 표시 · [확인 필요: …]
export function maskText(value) {
  const lines = String(value ?? "").split("\n");
  let fence = false;
  return lines.map((l) => {
    if (/^\s{0,3}(```|~~~)/.test(l)) { fence = !fence; return " ".repeat(l.length); }
    if (fence) return " ".repeat(l.length);
    return l.replace(/\[확인\s*필요[^\]\n]*\]|\[@[^\]\n]*\]|@(?:fig|tbl|eq):[\w-]+|!\[[^\]\n]*\]\([^)\n]*\)|\]\([^)\n]*\)|https?:\/\/\S+|\{#[^}\n]*\}|\$\$?[^$\n]+\$\$?|\[\^[^\]\n]*\]/g,
      (x) => " ".repeat(x.length));
  }).join("\n");
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 낱말 경계: 앞이 한글 · 영문 · 숫자가 아니어야 (뒤는 조사가 붙으니 따지지 않음)
function occurrences(text, word) {
  const re = new RegExp(`(?<![가-힣A-Za-z0-9])${escRe(word)}`, "g");
  return [...text.matchAll(re)].map((m) => m.index);
}

function stem(w) {
  for (const t of TAILS) if (w.length - t.length >= 2 && w.endsWith(t)) return w.slice(0, -t.length);
  return w;
}

/** → [{ sev, code, msg, from, to, action? }] (writecheck item 모양, group은 부르는 쪽이 붙임) */
export function termIssues(value, glossary = []) {
  const text = maskText(value);
  const out = [];
  const push = (sev, code, msg, from, to, action) => out.push({ sev, code, msg, from, to, action });
  const heading = new Set(); // 제목 · 표 줄의 시작 위치 — 약어 점검에서 뺀다
  {
    let s = 0;
    for (const l of text.split("\n")) {
      if (/^\s{0,3}(#{1,6}\s|\|)/.test(l)) heading.add(s);
      s += l.length + 1;
    }
  }
  const lineStart = (pos) => text.lastIndexOf("\n", pos - 1) + 1;

  // ① 여러 표기 — 긴 표기부터 맞춰서 '웹 사이트'가 '웹사이트'에 겹쳐 세지지 않게
  for (const group of VARIANTS) {
    const re = new RegExp(`(?<![가-힣A-Za-z0-9])(?:${[...group].sort((a, b) => b.length - a.length).map(escRe).join("|")})`, "g");
    const counts = new Map();
    for (const m of text.matchAll(re)) {
      if (!counts.has(m[0])) counts.set(m[0], []);
      counts.get(m[0]).push(m.index);
    }
    if (counts.size < 2) continue;
    const ranked = [...counts].sort((a, b) => b[1].length - a[1].length);
    const [minor, at] = ranked[ranked.length - 1];
    push("warn", "term-variant", `같은 말을 여러 표기로 썼어요 — ${ranked.map(([w, p]) => `'${w}' ${p.length}곳`).join(" · ")}`, at[0], at[0] + minor.length);
  }

  // ② 띄어쓰기만 다른 같은 말: '연구 대상(은)' ↔ '연구대상(은)' (두 낱말 모두 두 글자 이상)
  const words = [...text.matchAll(HANGUL_WORD_RE)].map((m) => ({ w: m[0], at: m.index }));
  const joined = new Map(); // 붙여 쓴 낱말의 줄기 → 첫 위치 · 수
  for (const { w, at } of words) {
    const k = stem(w);
    if (k.length < 4) continue;
    const j = joined.get(k);
    if (j) j.n++; else joined.set(k, { at, n: 1, w });
  }
  const spaced = new Map();
  for (let i = 0; i + 1 < words.length; i++) {
    const a = words[i];
    const b = words[i + 1];
    if (a.w.length < 2 || text.slice(a.at + a.w.length, b.at) !== " ") continue;
    const bs = stem(b.w);
    if (bs.length < 2) continue;
    const k = a.w + bs;
    if (!joined.has(k)) continue;
    const s = spaced.get(k);
    if (s) s.n++; else spaced.set(k, { at: a.at, n: 1, w: `${a.w} ${bs}`, end: b.at + bs.length });
  }
  let nSpace = 0;
  for (const [k, s] of spaced) {
    if (nSpace++ >= 15) break;
    const j = joined.get(k);
    const [from, to] = s.n <= j.n ? [s.at, s.end] : [j.at, j.at + k.length];
    push("warn", "term-spacing", `띄어쓰기가 섞여 있어요 — '${s.w}' ${s.n}곳 · '${k}' ${j.n}곳`, from, to);
  }

  // ③ 약어 첫 등장: 'ABC(풀어 쓴 말)' · '풀어 쓴 말(ABC)' · '(Full Name, ABC)' 꼴이면 풀어 쓴 것
  const seen = new Set();
  for (const m of text.matchAll(/(?<![A-Za-z0-9])[A-Z][A-Z0-9]{1,6}s?(?![A-Za-z0-9])/g)) {
    const abbr = m[0].replace(/s$/, "");
    if (seen.has(abbr) || COMMON_ABBR.has(abbr) || (abbr.match(/[A-Z]/g) || []).length < 2) continue;
    if (heading.has(lineStart(m.index))) continue; // 제목 · 표 줄은 본문 첫 등장에서 본다
    seen.add(abbr);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 8).replace(/^[-\d]+/, ""); // COVID-19(…)
    const before = text.slice(Math.max(0, m.index - 80), m.index);
    const open = before.lastIndexOf("(");
    const inParen = open >= 0 && before.indexOf(")", open) < 0;
    if (/^\s?\(/.test(after) || inParen) continue;
    push("warn", "term-abbr", `처음 나온 약어 '${abbr}' — 풀어 쓴 말을 함께 적어 주세요 (예: 풀어 쓴 말(${abbr}))`, m.index, m.index + m[0].length);
  }

  // ④ 내 용어집: 피할 말이 나온 곳마다
  for (const g of glossary || []) {
    for (const avoid of g.avoid || []) {
      if (!avoid || avoid === g.use) continue;
      for (const at of occurrences(text, avoid)) {
        push("must", "term-glossary", `용어집: '${avoid}' 대신 '${g.use}'`, at, at + avoid.length, "glossary");
      }
    }
  }
  return out;
}

/** 용어집대로 모두 바꾼 원고 (코드 블록 · 인용 키 등 가린 곳은 그대로) */
export function applyGlossary(value, glossary = []) {
  const v = String(value ?? "");
  const text = maskText(v);
  const edits = [];
  for (const g of glossary || []) {
    for (const avoid of g.avoid || []) {
      if (!avoid || avoid === g.use) continue;
      for (const at of occurrences(text, avoid)) edits.push([at, at + avoid.length, g.use]);
    }
  }
  edits.sort((a, b) => a[0] - b[0]);
  let out = "";
  let last = 0;
  for (const [a, b, rep] of edits) {
    if (a < last) continue; // 겹치면 앞 것만
    out += v.slice(last, a) + rep;
    last = b;
  }
  return out + v.slice(last);
}
