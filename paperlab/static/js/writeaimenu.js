// AI 도우미 메뉴 묶음 (2026-10-28 사용자 요청 "버튼 정리 — 합치고 안에서 옵션을 선택"): 메뉴에는 묶음 몇 개만 두고,
// 묶음을 누르면 창에서 방식을 고른다. 글을 바꾸는 방식이면 같은 창에서 범위 · 끝맺음도 고른다.
// 명령 팔레트(Ctrl+K)는 찾기 쉽게 방식마다 한 줄씩 그대로 둔다 (flatChoices)

// [키, 이름, 설명]. 키는 글쓰기 모드(ai.WRITE_MODES) 또는 화면 동작 이름
export const AI_GROUPS = [
  { id: "fix", label: "글 고치기…", sub: "다듬기 · 학술 문체 · 간결 · 자세히", title: "글 고치기", ok: "고치기", choices: [
    ["polish", "문장 다듬기", "뜻 · 주장은 그대로 두고 읽기 좋게"],
    ["academic", "학술 문체로", "논문에 맞는 말투로"],
    ["concise", "간결하게", "군더더기를 덜어 짧게"],
    ["expand", "자세히 풀어 쓰기", "논리를 더 풀어 씀 — 새 내용은 [확인 필요]로 표시"],
  ] },
  { id: "translate", label: "번역 · 초록…", sub: "영어 · 한국어 · 영문 · 국문 초록", title: "번역 · 초록", ok: "시작", choices: [
    ["to_en", "영어로 번역", "고른 범위를 학술 영어로"],
    ["to_ko", "한국어로 번역", "고른 범위를 학술 한국어로"],
    ["abstract_en", "영문 초록 만들기", "국문 초록 → Abstract 자리에"],
    ["abstract_ko", "국문 초록 만들기", "Abstract → 국문 초록 자리에"],
  ] },
  { id: "write", label: "새로 쓰기…", sub: "이어 쓰기 · 초안 · 메모 → 문단", title: "새로 쓰기", ok: "시작", choices: [
    ["continue", "이어 쓰기", "커서 앞 글에 이어지는 문단"],
    ["draft", "논문을 골라 초안 쓰기", "고른 서재 논문만 근거로"],
    ["memo", "메모 · 받아쓰기 → 논문 문단", "고른 글 또는 붙여 넣기 · 🎤 받아쓰기"],
  ] },
  { id: "chat", label: "AI와 대화하며 고치기…", sub: "Alt+C" },
  { id: "figure", label: "그림…", sub: "Alt+G", title: "그림", ok: "시작", needs: "fig", choices: [
    ["fig_describe", "그림 만들기", "원하는 그림을 말로 설명"],
    ["fig_content", "이 내용으로 그림 만들기", "고른 글 · 커서 문단을 그림으로"],
    ["fig_edit", "커서의 그림 고치기", "커서가 있는 그림을 말로 고침"],
  ] },
  { id: "check", label: "점검…", sub: "맞춤법 · 출처 · 인용 · 표절 · 연구문제", title: "점검", ok: "점검", choices: [
    ["proof", "맞춤법 · 띄어쓰기", "Alt+P"],
    ["source", "출처 확인", "커서 문장 · [확인 필요]의 근거를 AI가 찾음"],
    ["cite", "인용이 필요한 문장 찾기", "내 서재에서 논문 추천"],
    ["similar", "표절 미리 점검", "내 서재 원문과 대조"],
    ["align", "연구문제 ↔ 결론 대응 검사", "원고 전체 · 빠진 답 찾기"],
  ] },
  { id: "make", label: "자료 만들기…", sub: "비교표 · 통계 · 대응표 · 발표 · 모의 심사", title: "자료 만들기", ok: "시작", choices: [
    ["matrix", "선행연구 비교표", "고른 논문 → 표"],
    ["stats", "통계 출력 → 표 · 문장", "SPSS · jamovi 출력 붙여넣기 — 원자료는 [통계] 단추"],
    ["response", "심사 의견 대응표", "의견 → 수정 내용 · 위치"],
    ["slides", "발표 자료", "원고 전체 → PPT · 예상 질문"],
    ["review", "AI 모의 심사", "원고 전체 · 총평 · 예상 질문"],
  ] },
];

// 범위(선택 · 문단 · 이 절 · 이 장)를 쓰는 방식 — 고른 글을 그 자리에서 바꾸는 것만
export const SCOPE_MODES = new Set(["polish", "academic", "concise", "expand", "to_en", "to_ko"]);
// 끝맺음(원문 유지 · 개조식 · 서술체)을 쓰는 방식 — 한국어 글을 새로 쓰는 것
export const ENDING_MODES = new Set(["polish", "academic", "concise", "expand", "to_ko", "continue", "draft", "memo"]);

export const groupById = (id) => AI_GROUPS.find((g) => g.id === id) || null;

// 묶음에서 처음 고를 방식: 지난번 고른 것(이 묶음에 있을 때) → 첫 방식
export function initialChoice(group, last) {
  const keys = (group.choices || []).map((c) => c[0]);
  return keys.includes(last) ? last : keys[0] || "";
}

// 팔레트용: 묶음 · 방식마다 한 줄 ({group, key, label, sub}). needs가 빠진 묶음(그림 패널 없음)은 뺀다
export function flatChoices(has = {}) {
  const out = [];
  for (const g of AI_GROUPS) {
    if (g.needs && !has[g.needs]) continue;
    if (!g.choices) { out.push({ group: g.id, key: g.id, label: g.label, sub: g.sub || "" }); continue; }
    for (const [key, label, sub] of g.choices) out.push({ group: g.id, key, label: `${g.title}: ${label}`, sub });
  }
  return out;
}
