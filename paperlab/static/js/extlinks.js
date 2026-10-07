// 바깥 링크 주소 만들기: 인하대 openlink 프록시 · DOI · 학교 DB 검색 · Google Scholar (docs/specs/inha-proxy.md)
// 순수 모듈 — DOM · 네트워크 · 다른 모듈을 쓰지 않는다. 주소는 만들기만 하고 요청은 보내지 않는다(S-4).
// 변환할 수 없으면 null을 돌려준다(화면은 그때 버튼을 숨기거나 비활성으로 둔다).

const deepFreeze = (o) => {
  for (const v of Object.values(o)) if (v && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
};

// 학교 상수는 이 한 곳에만 둔다(사용자별 학교 설정 없음 — 명세 2장 · 14장)
export const INHA = deepFreeze({
  label: "인하대",
  proxyName: "인하대 openlink", // 툴팁 문구용 이름(화면 파일에 "openlink"를 직접 쓰지 않음 — AC-7)
  suffix: ".openlink.inha.ac.kr", // 호스트 이름 방식 프록시(5.1절 확인됨)
  sslTag: "-ssl", // 원래 주소가 https면 라벨 끝에 붙음, http면 없음
  // 학교 로그인 버튼 — 도서관 홈페이지 로그인 화면(IU-1 사용자 확인). 쿼리(returnUrl 등)는 붙이지 않음
  loginUrl: "https://lib.inha.ac.kr/login",
  // 버튼 이름(IU-5 사용자 확정)
  buttons: {
    view: "인하대에서 보기",
    searchDb: "학교 DB에서 찾기",
    login: "학교 로그인",
    scholar: "Google Scholar에서 보기",
  },
  // 원래 사이트의 검색 주소({q} = 인코딩한 질의). 프록시 주소는 toInhaProxy로만 만든다(7.1절)
  searchTemplates: {
    riss: "https://www.riss.kr/search/Search.do?isDetailSearch=N&searchGubun=true&viewYn=OP&query={q}",
    dbpia: "https://www.dbpia.co.kr/search/topSearch?searchOption=all&query={q}",
    kiss: "https://kiss.kstudy.com/", // 임시안(IU-3): 검색어 매개변수 미확인 — 첫 페이지만 엶({q} 없음)
  },
  // paperProxyTarget에서 감싸지 않는 호스트(5.3절). "*.x"는 x의 하위 도메인
  noProxyHosts: [
    "arxiv.org", "*.arxiv.org",
    "openalex.org", "*.openalex.org",
    "semanticscholar.org", "*.semanticscholar.org",
    "www.kci.go.kr", "kci.go.kr",
    "scholar.google.com",
  ],
});

export const SCHOLAR_BASE = "https://scholar.google.com/scholar";

const MAX_QUERY = 256; // 코드포인트(9.2절 · IK-4)
const BACKOFF = 40; // 자를 때 마지막 40자 안의 공백까지 물러남
const MAX_LABEL = 63; // DNS 라벨 한도
const DOI_RE = /^10\.\d{4,9}\/\S+$/;
const DOI_PREFIX_RE = /^(?:doi:\s*|https?:\/\/(?:dx\.|www\.)?doi\.org\/)/i;
const DOI_HOSTS = new Set(["doi.org", "dx.doi.org", "www.doi.org"]);
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const HOST_LABEL_RE = /^[a-z0-9-]+$/; // 퓨니코드 변환 뒤 라벨 한 개 (따옴표 · 중괄호 · % · & · _ 등은 거부)

// ------------------------------------------------------------------ 작은 도우미
function parseUrl(s) {
  if (typeof s !== "string" || !s) return null;
  try { return new URL(s); } catch { return null; } // 상대 주소 · 스킴 없음도 여기서 실패
}

// URL API가 소문자 · 퓨니코드로 바꾼 호스트, 끝의 '.' 제거
const hostOf = (u) => u.hostname.replace(/\.$/, "");

const PROXY_ROOT = INHA.suffix.slice(1); // "openlink.inha.ac.kr"
const isProxyHost = (h) => h === PROXY_ROOT || h.endsWith(INHA.suffix);

function isNoProxyHost(h) {
  return INHA.noProxyHosts.some((p) => (p.startsWith("*.") ? h.endsWith(p.slice(1)) : h === p));
}

// 출력 검사(5.2절 8단계 · S-2): https + *.openlink.inha.ac.kr + 계정 정보 · 포트 없음
function checkProxyOutput(s) {
  const u = parseUrl(s);
  const ok = u && u.protocol === "https:" && u.hostname.endsWith(INHA.suffix)
    && u.username === "" && u.password === "" && u.port === "";
  return ok ? s : null;
}

// ------------------------------------------------------------------ 프록시 변환 (5.2절)
// 원래 host에서 '-' → '--', '.' → '-'(하이픈 먼저), https면 '-ssl', 뒤에 '.openlink.inha.ac.kr'. 경로 · 쿼리는 그대로
export function toInhaProxy(url) {
  const u = parseUrl(url);
  if (!u) return null;
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  if (u.port) return null; // 기본 포트(443 · 80)는 URL API가 지움 — 남아 있으면 기본이 아닌 포트(IK-8)
  const host = hostOf(u);
  if (!host || host.startsWith("[") || IPV4_RE.test(host) || !host.includes(".")) return null;
  if (!host.split(".").every((l) => HOST_LABEL_RE.test(l))) return null; // 브라우저마다 허용 범위가 달라 직접 제한
  const rest = u.pathname + u.search + u.hash; // 정규화된 값 그대로, 다시 인코딩하지 않음
  if (isProxyHost(host)) return checkProxyOutput(`https://${host}${rest}`); // 이미 프록시 — 두 번 감싸지 않음
  if (host.split(".").pop() === "ssl") return null; // '-ssl' 접미와 겹쳐 되돌릴 수 없음
  const label = host.replaceAll("-", "--").replaceAll(".", "-") + (u.protocol === "https:" ? INHA.sslTag : "");
  if (label.length > MAX_LABEL) return null;
  // 첫 라벨이 IDN(xn--…)이면 결과도 "xn--"로 시작해 잘못된 퓨니코드가 됨. Chrome은 거부하지 않으므로 직접 거름
  if (label.startsWith("xn--")) return null;
  return checkProxyOutput(`https://${label}${INHA.suffix}${rest}`);
}

// ------------------------------------------------------------------ DOI (6.4절 — 기본안 (a): 프록시 경유 doi.org)
const DOI_PROXY_BASE = toInhaProxy("https://doi.org/"); // "https://doi-org-ssl.openlink.inha.ac.kr/"

function cleanDoi(doi) {
  let s = String(doi ?? "").trim();
  const m = s.match(DOI_PREFIX_RE);
  if (m) {
    s = s.slice(m[0].length);
    // 주소 꼴이면 퍼센트 인코딩을 풀어 두 번 인코딩되지 않게 한다
    if (!m[0].toLowerCase().startsWith("doi:")) { try { s = decodeURIComponent(s); } catch { /* 그대로 */ } }
  }
  return s;
}

export function inhaDoiUrl(doi) {
  const d = cleanDoi(doi);
  if (!DOI_RE.test(d)) return null;
  let path;
  try { path = encodeURIComponent(d).replaceAll("%2F", "/"); } catch { return null; } // 짝 잃은 서로게이트
  return checkProxyOutput(DOI_PROXY_BASE + path); // '/'만 살리고 나머지는 인코딩 — 대소문자는 그대로
}

// ------------------------------------------------------------------ 논문 하나의 대상 (6.5절)
// DOI 우선 → doi.org 주소 → 제외 목록이 아닌 url. pdf_url은 감싸지 않는다
export function paperProxyTarget(p) {
  if (!p || typeof p !== "object") return null;
  if (p.doi) {
    const d = inhaDoiUrl(p.doi);
    if (d) return d;
  }
  const u = parseUrl(p.url);
  if (!u) return null;
  const host = hostOf(u);
  if (DOI_HOSTS.has(host)) {
    let path = u.pathname.slice(1);
    try { path = decodeURIComponent(path); } catch { /* 그대로 */ }
    return inhaDoiUrl(path); // DOI가 아니면 null(doi.org 첫 페이지를 여는 버튼은 만들지 않음)
  }
  if (isNoProxyHost(host)) return null;
  return toInhaProxy(p.url);
}

// ------------------------------------------------------------------ 질의 정규화 (9.2절 — 검색 바로가기 · Scholar 공통)
export function normalizeQuery(text) {
  let s = String(text ?? "").normalize("NFC");
  s = s.replace(/\p{Cc}/gu, " "); // 줄바꿈 · 탭 · 제어 문자 → 공백
  s = s.replace(/[\p{Cf}\p{Cs}]/gu, ""); // 너비 없는 공백 · BOM · 방향 표시, 짝 잃은 서로게이트 → 지움
  s = s.replace(/\s+/g, " ").trim(); //   · 　 포함
  const cps = Array.from(s); // 코드포인트 단위 — 이모지 · 한글이 반쪽으로 잘리지 않음
  if (cps.length > MAX_QUERY) {
    let cut = cps.slice(0, MAX_QUERY);
    const sp = cut.lastIndexOf(" ");
    if (sp >= MAX_QUERY - BACKOFF) cut = cut.slice(0, sp); // 단어 중간에서 자르지 않음
    s = cut.join("").trim();
  }
  return s;
}

// ------------------------------------------------------------------ 학교 DB 검색 (7장)
// db: "riss" | "dbpia" | "kiss". 질의가 비거나 모르는 db면 null. KISS는 임시안(첫 페이지 — 화면이 검색어를 복사해 줌)
export function inhaSearchUrl(db, query) {
  if (typeof db !== "string" || !Object.hasOwn(INHA.searchTemplates, db)) return null;
  const q = normalizeQuery(query);
  if (!q) return null;
  const enc = encodeURIComponent(q);
  return toInhaProxy(INHA.searchTemplates[db].replace("{q}", () => enc));
}

// 그 DB의 검색 주소에 질의가 들어가는지(템플릿에 {q}가 있음). false면 첫 페이지만 열리므로 화면이 검색어를 복사해 준다(KISS 임시안)
export function inhaSearchTakesQuery(db) {
  return typeof db === "string" && Object.hasOwn(INHA.searchTemplates, db) && INHA.searchTemplates[db].includes("{q}");
}

// ------------------------------------------------------------------ Google Scholar (9장)
// 형식은 https://scholar.google.com/scholar?q=<질의> 하나뿐. 프록시로 감싸지 않음
export function scholarUrl(query) {
  const q = normalizeQuery(query);
  if (!q) return null;
  const s = `${SCHOLAR_BASE}?q=${encodeURIComponent(q)}`;
  const u = parseUrl(s);
  const ok = u && u.href.startsWith(`${SCHOLAR_BASE}?q=`) && u.hostname === "scholar.google.com"
    && u.username === "" && u.password === "" && u.port === "" && u.hash === ""
    && [...u.searchParams.keys()].join("\n") === "q";
  return ok ? s : null;
}
