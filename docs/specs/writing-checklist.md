# 논문 쓰기 — 제출 전 점검표 (2026-10-17)

사용자 요청(김주현, "기능들 전부 추가해줘" ③): 제출하기 전에 원고의 문제를 한 화면에 모아 보여 주고, [이동]으로 편집기의 그 자리로 간다.

원고는 지금처럼 마크다운 글 하나(paperlab.manuscripts.content). **DB 마이그레이션 · 새 API 없음.** 서버 자료는 이미 있는 것만 쓴다:
미리보기가 받아 둔 `POST /api/citekeys` 결과(인용키 → CSL | null, `citation_issues` 빈 항목), 양식 값(`GET /api/doc-formats/{id}`),
원고의 표지 정보(`manuscripts.cover`), 마지막 인용 검증 결과(`GET /api/manuscripts/{id}/verify`). **AI 호출 없음.**

## 1. 파일

| 파일 | 내용 |
|---|---|
| `paperlab/static/js/writecheck.js` | 점검 규칙 — 순수 함수(DOM · 네트워크 없음). `checkManuscript(text, opts)` · `estimatePages` · `bracketProblem` · `fixDoubleSpaces` · `badgeOf` · `summaryText` |
| `paperlab/static/js/writecheckui.js` | 화면 — 겹쳐 뜨는 패널 · 배지 · Alt+K · [이동] · 고치기 단추 |
| `paperlab/static/js/writing.js` | 연결만: import 1줄 · 도구 막대 단추 1줄 · `W.check = checkPanel(…)` · `renderPreview` · `updateCoverBtn` 끝에서 `refresh()` · `closeWriter`에서 `destroy()` |
| `paperlab/static/js/writeedit.js` | 단축키 도움말에 "제출 전 점검 열기 · 닫기 — 점검 버튼 · Alt+K" |
| `paperlab/static/css/app.css` | `.check-pane` · `.ck-badge` 등 (파일 끝 한 덩어리) |
| `tests/js/writecheck.test.mjs` | 규칙 · 분량 추정 · 코드 검사 (pytest 래퍼 `tests/test_js_node.py`, 최소 통과 17) |

## 2. 결과 모양

`checkManuscript` → `{ items, counts: { must, warn }, stats: { pages, chars, minPages, cites, refs } }`.
항목 = `{ sev: "must" | "warn", group: "format" | "number" | "cite" | "text", code, msg, from, to, action? }`.
`from · to`는 원고 글자 위치(UTF-16, textarea와 같음). 양식 전체 항목(표지 · 분량 · 초록)은 `null` — [이동] 없음.
`action`: `cover`(표지 정보 창) · `renumber`(`renumberHeadings`) · `spaces`(`fixDoubleSpaces`) · `verify`(인용 검증 실행).
정렬: 꼭 고칠 것 먼저, 같은 등급은 원고 순서(위치 없는 항목이 맨 앞). 같은 `code`는 20개까지 + "같은 문제가 N곳 더 있어요" 한 줄.

## 3. 규칙

등급: **must = 꼭 고칠 것**(내보내면 틀린 결과가 나오거나 제출 요건 미달) · **warn = 확인 권장**(사람이 판단).

### 3.1 양식 (표지 종류 `thesis` · `report` 양식만 — 내 양식은 고른 표지 종류를 따름)
| code | 등급 | 조건 |
|---|---|---|
| cover-missing | must | 표지 · 속표지에 ○○○로 들어갈 빈 칸: 영문 제목 · 이름 · 학과 · 졸업 연월, 학위논문은 학위명, 국문 제목(원고 `#` 제목도 없을 때), 속표지가 있으면 지도교수. 앞표지 · 속표지를 모두 빼면 이름만(인정서) — `doc_formats.missing_cover_fields` + 지도교수 |
| cover-committee | warn | 인정서(인준서)를 넣는데 심사위원 이름이 석사 3 · 박사 5칸보다 적음 (빈 칸은 서명 자리로만 나감) |
| min-pages | must | `FORMAT_RULES.report.minPages = 30` — 본문 추정 쪽 수 < 30. 문구에 "어림한 값"을 밝힘 |
| no-chapters | must | 앞 · 뒤 부분(초록 · 목차 · 참고문헌 · 부록 · 감사의 글)을 뺀 `##` 장이 없음 |
| order-intro · order-conclusion | warn | 첫 본문 장 제목에 서론 · 들어가며 · 머리말 · Introduction 없음 / 마지막 본문 장(2장 이상일 때)에 결론 · 맺음말 · Conclusion 없음 |
| order-bib | warn | `[참고문헌]` 뒤에 본문 장 |
| no-references | must | 인용이 하나도 없음 |
| abstract-ko · abstract-en | warn | 학위논문(`thesis`)만: 제목이나 굵은 줄 `**…**`이 "국문초록 · 초록 · 요약"/"Abstract"인 곳이 없음 ("연구 결과 요약" 같은 절은 아님) |
| abstract-chapter | warn | 쪽 번호가 `first_chapter`인 양식에서 첫 `##`가 초록 · 목차 → 쪽 번호 1이 거기서 시작 |

분량 추정(`estimatePages`): 쓸 수 있는 폭 = 용지 − 좌우 여백, 높이 = 용지 − 위아래 여백 − 머리말 − 꼬리말. 줄 수 = `doc_formats.estimate_lines`와 같은 셈
(한글 1.0 · 영문 0.55 · 공백 0.3 em), 줄 높이 = 글자 크기 × 줄간격 %. 장 새 쪽 · `---` · 참고문헌 새 쪽은 쪽을 끊고, 그림 = 높이의 1/3,
표 = 줄마다 본문 한 줄, 참고문헌 = 문헌마다 두 줄. `# 제목`은 양식이 제목을 본문에 넣을 때만. 표지류는 세지 않음. 양식 값이 없으면 기본 (A4).
대체 보고서 양식에서 한글 약 1,000자 ≈ 1쪽.

### 3.2 번호
chapter-number · section-number(must — `제N장` · `제N절`은 [번호 다시 매기기], `1.` · `1.1` 꼴은 문구만), section-orphan(warn),
figure-caption(must — 빈 캡션 · "그림 설명" · "Figure caption"), table-caption(must — 표 위 `표:` 줄 또는 표 아래 캡션 줄이 없거나 제목이 빔),
xref-missing(must), label-duplicate(must), mention-missing(warn — "그림 5"인데 그림이 3개), figure-unref · table-unref(warn — `@fig:` 참조도
"그림 N" 글자도 없음), figure-inline(warn — 문단 안의 `![](fig:…)`), empty-heading(must), empty-section(warn — 다음 같은 · 높은 단계 제목까지 글 없음).

### 3.3 인용
cite-missing(must — `items[key] === null`. 미리보기가 아직 받지 않은 키는 건너뜀), cite-fields(빈 항목에 제목 · 저자 · 연도가 있으면 must, 아니면 warn),
cite-xref(must — `[@fig:x]`), cite-unreadable(warn), bib-marker(warn — 인용은 있는데 `[참고문헌]` 없음 → 문서 맨 끝에 붙음), bib-duplicate(warn),
verify-unsupported(must) · verify-weak(warn) · verify-pending(warn, [인용 검증] — 검증 결과의 `unverified`).
"인용하지 않은 참고문헌"은 참고문헌이 인용으로만 만들어지므로 해당 없음.

### 3.4 글 (코드 블록 안은 모두 건너뜀)
check-marker(must — `[확인 필요…]`), todo(must — TODO · FIXME · TBD · XXX 낱말, "추후 작성/보완/수정/추가", "작성 예정"),
placeholder · placeholder-title(must — `manuscripts.py` 템플릿 안내 글 · 제목), long-paragraph(warn — 1,200자, 한글 없는 원고 2,000자 초과),
double-space(warn — 낱말 사이 두 칸 이상, 줄 앞 들여쓰기 · 줄 끝 · 표 줄 제외, [모두 고치기]),
bracket(warn — 덩어리마다 첫 문제 하나: `( ) [ ] { } “ ” ‘ ’ 「 」 『 』 《 》 〈 〉 【 】` 짝, 큰따옴표 `"` 홀수. 인라인 코드 · `\` 이스케이프 ·
`{#fig:…}` 꼬리표 · `1)` · `가)` · `a)` · `ii)` 항목 번호 · 짝 없는 `’`(아포스트로피) 제외. 표는 줄마다).

## 4. 화면
- 도구 막대 [인용 검증] 오른쪽 **[점검]**(짧은 글자 — 1280px에서 잘리지 않음). 한 번 연 뒤부터 배지: 꼭 고칠 것 수(빨강), 없으면 확인 권장 수(주황).
- 패널: `aside.panel.check-pane` `role="dialog" aria-modal="false"` — 편집 칸 위 끝 높이에 고정(`--ck-top`), 폭 380px(760px 이하는 좌우 8px).
  머리: 제목 · [다시 점검] · ✕. 요약 줄(aria-live): "본문 약 N쪽(추정) · 꼭 고칠 것 a · 확인 권장 b". 등급별 목록 · 꼬리표 · [이동] · 고치기 단추 · 맨 아래 안내 한 줄.
- 열기 · 닫기: [점검] · **Alt+K**(모달이 열려 있으면 무시). 패널 안 **Esc** = 닫고 편집기로. 열면 초점은 패널, [이동]은 편집기에서 그 범위를 고르고 초점을 편집기로(패널은 그대로).
- 다시 점검: 미리보기가 그려질 때마다(입력 350ms 뒤 · 스타일 · 인용 검증 결과), 양식 · 표지 정보가 바뀔 때. 패널 안 초점 · 스크롤은 다시 그려도 유지.
  [다시 점검]은 미리보기를 새로 그려 인용 정보까지 다시 받는다.
- 고치기 단추는 `applyEdit`(실행 취소 한 번에 되돌림).

## 5. 범위 밖
목차 유무(워드 · 한글 차례 기능), 실제 쪽 나눔 계산(워드 · 한글에서 확인), 맞춤법 검사, AI 문장 점검, 학과별 세부 규정, 점검 결과 저장.
