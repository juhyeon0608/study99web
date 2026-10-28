// 논문 찾기 소스 표 · 문구 (docs/design/phase5-korean-db-ui.md 2 · 3 · 4 · 5 · 6장)
// 순수 모듈 — DOM · 네트워크를 쓰지 않는다. tests/js/sources.test.mjs가 시험한다.

import { esc, josa } from "./ui.js";

// 소스별 지원 정렬 · '무료만' 필터 (명세 6.4절). 서버 paperlab/extsources.py SOURCE_LIMITS와 같아야 함(테스트로 비교 — JSON 그대로 둠)
export const SOURCE_LIMITS = {"kci": {"sort": ["relevance", "date"], "oa": false}, "riss": {"sort": ["relevance", "date"], "oa": true}, "europepmc": {"sort": ["relevance", "date", "cited"], "oa": true}};

export const SORT_LABEL = { relevance: "관련도순", cited: "피인용순", date: "최신순" };
const OA_LABEL = "무료 PDF 있는 논문만";

// 이름 · 묶음 · 설명(2.1절), 카드 · 출처 · 빈 상태 문구(3 · 6장). 기존 4개는 지금 문구 그대로
export const SOURCE_META = {
  openalex: { name: "OpenAlex", group: "전 분야", desc: "2억+ 편, 피인용·인용 관계" },
  semanticscholar: { name: "Semantic Scholar", group: "전 분야", desc: "AI 요약(TL;DR) 제공" },
  arxiv: { name: "arXiv", group: "전 분야", desc: "최신 프리프린트" },
  crossref: { name: "Crossref", group: "전 분야", desc: "DOI 등록 출판물" },
  kci: {
    name: "KCI", group: "국내", desc: "국내 학술지 논문 · 제목으로 찾아요", keyed: true,
    chip: "KCI", oaChip: "원문 무료 · KCI", cites: "KCI 피인용", noAbs: "초록이 없어요.",
    src: "검색 결과 출처: KCI(한국연구재단)",
    empty: "KCI는 논문 제목으로 찾아요. 제목에 들어갈 낱말로 바꿔 보세요.",
    off: "KCI는 관리자가 키를 등록하면 쓸 수 있어요.",
  },
  riss: {
    name: "RISS", group: "국내", desc: "국내 학술논문 · 초록은 RISS에서 봐요", keyed: true,
    chip: "RISS", oaChip: "원문 무료 · RISS", oaLabel: "무료 원문 있는 논문만",
    noAbs: "RISS 검색 결과에는 초록이 없어요. 제목을 누르면 RISS에서 볼 수 있어요.",
    src: "검색 결과 출처: RISS(KERIS)",
    off: "RISS는 키를 받으면 쓸 수 있어요. 지금은 아래 ‘학교 DB에서 찾기’의 [RISS]로 찾아 주세요.",
  },
  europepmc: {
    name: "Europe PMC", group: "생명과학 · 의학", desc: "생명과학 · 의학 논문 (PubMed 포함)",
    chip: "Europe PMC", oaChip: "오픈 액세스", oaLabel: "오픈 액세스 논문만", cites: "Europe PMC 피인용",
    noAbs: "초록이 없어요.", src: "검색 결과 출처: Europe PMC", cursor: true,
    empty: "Europe PMC에는 생명과학 · 의학 논문만 있어요. 다른 분야는 OpenAlex에서 찾아 보세요.",
  },
};
export const GROUPS = ["전 분야", "국내", "생명과학 · 의학"];
export const EMPTY_TEXT = "결과가 없어요. 검색어를 바꾸거나 다른 데이터베이스를 골라 보세요.";

const nameOf = (s) => (SOURCE_META[s] || {}).name || s;
export const isNewSource = (s) => Object.prototype.hasOwnProperty.call(SOURCE_LIMITS, s);

// 쓸 수 없는 이유 (2.2절)
export function offReason(source, reason) {
  const m = SOURCE_META[source];
  if (m && m.off && reason === "unconfigured") return m.off;
  return `${josa(nameOf(source), "은/는")} 지금 쓸 수 없어요.`;
}

// 소스의 정렬 · 필터 제한 (2.3절): {sortOff: [값], oaOff: bool, oaLabel, note}
export function sourceLimits(source) {
  const lim = SOURCE_LIMITS[source];
  const m = SOURCE_META[source] || {};
  if (!lim) return { sortOff: [], oaOff: false, oaLabel: OA_LABEL, note: "" };
  const sortOff = Object.keys(SORT_LABEL).filter((k) => !lim.sort.includes(k));
  const parts = sortOff.map((k) => `${SORT_LABEL[k]} 정렬`);
  if (!lim.oa) parts.push(`‘${OA_LABEL}’`);
  const note = parts.length ? `${nameOf(source)}는 ${parts.join("과 ")}을 지원하지 않아요.` : "";
  return { sortOff, oaOff: !lim.oa, oaLabel: m.oaLabel || OA_LABEL, note };
}

// 소스를 바꿨을 때 고른 값이 지원되지 않으면 기본값으로 (2.3절). → {sort, oa, said: 알림 글('' = 바꾼 것 없음)}
export function adjustOptions(source, { sort, oa }) {
  const l = sourceLimits(source);
  const out = { sort, oa, said: "" };
  const bits = [];
  if (l.sortOff.includes(sort)) { out.sort = "relevance"; bits.push("관련도순으로 검색했어요"); }
  if (oa && l.oaOff) { out.oa = false; bits.push(`‘${OA_LABEL}’을 껐어요`); }
  if (bits.length) out.said = `지원하지 않아 ${bits.join(" · ")}.`;
  return out;
}

// 라이선스 이름표 (4.1절 — 허용 목록 값만, 밖이면 null)
const LICENSE_NAMES = {
  "cc-by": "CC BY", "cc-by-sa": "CC BY-SA", "cc-by-nc": "CC BY-NC", "cc-by-nd": "CC BY-ND",
  "cc-by-nc-sa": "CC BY-NC-SA", "cc-by-nc-nd": "CC BY-NC-ND", cc0: "CC0", "public-domain": "퍼블릭 도메인",
};
export function licenseLabel(lic) {
  const k = typeof lic === "string" ? lic.trim().toLowerCase() : "";
  return Object.prototype.hasOwnProperty.call(LICENSE_NAMES, k) ? LICENSE_NAMES[k] : null;
}

// 검색 오류 (6.1절) → {head, body, actions: ["openalex" | "retry" | "riss" | "relevance"]} | null(code 모름)
export function searchErrorView(code, source) {
  const name = nameOf(source);
  const keyed = source === "kci" || source === "riss";
  switch (code) {
    case "source_unconfigured":
      return source === "riss"
        ? { head: "RISS 검색을 아직 쓸 수 없어요.", body: "RISS 키를 받으면 쓸 수 있어요. 지금은 학교 DB 바로가기로 찾아 주세요.", actions: ["riss"] }
        : { head: `${name} 검색을 아직 쓸 수 없어요.`, body: `관리자가 ${name} 키를 등록하면 쓸 수 있어요.`, actions: ["openalex"] };
    case "source_key_invalid":
      return { head: `${name} 키가 맞지 않거나 사용기간이 끝났어요.`, body: "관리자에게 알려 주세요. 그동안은 다른 데이터베이스를 골라 주세요.",
        actions: source === "riss" ? ["openalex", "riss"] : ["openalex"] };
    case "upstream_limited":
      // Semantic Scholar 키 없는 요청 = 전 세계 공용 한도 (2026-10-28 사용자 "한 번도 검색 안 했는데")
      if (source === "semanticscholar") {
        return { head: "Semantic Scholar가 지금 요청을 받지 않아요.",
          body: "키 없이 쓰는 전 세계 사용자가 한도를 함께 나눠 써서 생겨요. 내가 검색을 많이 해서가 아니에요. 잠시 후 다시 시도하거나 OpenAlex로 찾아 주세요.",
          actions: ["retry", "openalex"] };
      }
      return { head: `${name}에 요청이 많아 잠시 막혔어요.`,
        body: keyed ? "PaperLab 사용자가 같은 공용 키를 함께 써서 생길 수 있어요. 잠시 후 다시 시도해 주세요." : "잠시 후 다시 시도해 주세요.",
        actions: ["retry"] };
    case "upstream_unavailable":
      return { head: `${name}에 연결할 수 없어요.`, body: "서비스가 점검 중이거나 잠시 응답하지 않아요. 잠시 후 다시 시도해 주세요.", actions: ["retry", "openalex"] };
    case "search_busy":
      return { head: "앞의 검색이 아직 끝나지 않았어요.", body: "끝난 뒤 다시 시도해 주세요.", actions: ["retry"] };
    case "unsupported_option":
      return { head: `${name}는 이 정렬·필터를 지원하지 않아요.`, body: "관련도순으로 다시 검색해 보세요.", actions: ["relevance"] };
    default:
      return null;
  }
}

// 인용 관계 "OpenCitations 기준" 줄 (5.1절) → {count, note} | null(via 없음)
export function viaLine(res) {
  if (!res || res.via !== "opencitations") return null;
  const n = Number(res.unresolved) || 0;
  return {
    count: `참고문헌 ${Number(res.total || 0).toLocaleString("ko-KR")}편`,
    note: "OpenAlex에 참고문헌 정보가 없어 OpenCitations 자료로 채웠어요." + (n > 0 ? ` 서지를 찾지 못한 ${n.toLocaleString("ko-KR")}편은 목록에 없어요.` : ""),
  };
}
// 위 줄의 HTML (찾기 참고문헌 목록 · 서재 인용 관계 탭 공용). via가 없으면 ""
export function viaHtml(res) {
  const v = viaLine(res);
  return v ? `<div class="via-line" data-via="opencitations"><span>${esc(v.count)}</span><span class="chip" title="${esc(OC_CHIP_TITLE)}">OpenCitations 기준</span></div>
    <p class="via-note">${esc(v.note)}</p>` : "";
}
export const OC_FAILED_TEXT ="OpenAlex에 참고문헌 정보가 없고, OpenCitations도 응답하지 않았어요. 잠시 후 다시 시도해 주세요.";
export const OC_CHIP_TITLE = "OpenCitations(CC0) 참고문헌 자료예요";

// 대신 받기 토스트(사용자 결정 2026-10-13): 서재 주소 대신 같은 논문의 무료 공개본(arXiv · 허용 라이선스 위치)을 받았을 때
export function substituteText(license) {
  const lic = licenseLabel(license);
  return `같은 논문의 무료 공개본${lic ? `(라이선스 ${lic})` : ""}을 받았어요`;
}

// 무료 PDF 새 탭 버튼 글자 (4.2절)
export const oaOpenLabel = (kind) => (kind === "landing" ? "무료 원문 페이지 열기" : "무료 PDF 열기");
export const OA_OPEN_TITLE = "라이선스를 확인하지 못한 PDF예요. 새 탭에서 직접 받아 [파일 첨부]로 올려 주세요.";
