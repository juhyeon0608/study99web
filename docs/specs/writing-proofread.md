# 논문 쓰기 — 맞춤법 · 띄어쓰기 점검 + 영문/국문 초록 만들기 (2026-10-17)

제품 책임자 요청(김주현, 2026-10-17 AI 글쓰기 확장 S3): ① 원고의 맞춤법 · 띄어쓰기 · 문법 · 어색한 표현을 AI로 찾아
목록으로 보여 주고 한 곳씩 · 한꺼번에 안전하게 고친다. ② 국문 초록으로 영문 초록(Abstract)을 만들어 국문 초록 뒤
`**Abstract**`(원고가 제목 모양이면 `## Abstract`) 아래에 넣는다(반대 방향 국문 초록도).

**새 표 없음.** 작업 종류 `proofread`는 마이그레이션 `20261017000006_ai_writing_kinds.sql`(jobs_kind_check)에서 이미 허용 —
이 기능은 그 제약을 건드리지 않는다. AI는 다른 작업과 같이 **사용자 PC의 CLI 워커 또는 사용자 API 키**로만 실행(서버 PC 칸 없음).

## 1. 파일

| 파일 | 내용 |
|---|---|
| `paperlab/proofread.py` | 프롬프트 · JSON 스키마 · 결과 검사(`validate` · `parse`) · 작업 result · 작업 보기 `proof` · 요청 검사(`clean_params`) |
| `paperlab/jobs.py` | 종류 등록(`ALL_KINDS` · `ROUTE_KIND["proofread"] = "write"` · 기한 · 시간 제한), `MANUSCRIPT_KINDS`, `text_request` · `cli_task`(스키마) · `parse_result` · `_apply` 분기, 원고별 목록 · 7일 결과 비우기에 포함 |
| `paperlab/api_runner.py` | API 키 경로 분기 (`ai.complete` + 스키마 → `parse_result`) |
| `paperlab/server.py` | `POST /api/ai/proofread` (202 {job}) |
| `paperlab/ai.py` | `WRITE_MODES`에 `abstract_en` · `abstract_ko` 두 줄 |
| `paperlab/static/js/writeproof.js` | 순수 함수: 범위 · 조각 · 자리 다시 찾기 · 고치기 · 모두 고치기 · 묶음 상태 · 이어서 점검 · 무시 기억 · 점검표 한 줄 · 초록 계획 |
| `paperlab/static/js/writeproofui.js` | 점검 패널(Alt+P) · `startAbstract` |
| `paperlab/static/js/writing.js` | 연결만: import · AI 메뉴 2모드 + 점검 항목 · `runAi` 첫 분기 · 결과 패널 `resultText`(제목 붙이기) · `W.proof` · 점검표 `extra` · `closeWriter` |
| `paperlab/static/js/writecheckui.js` | 점검표 아래 `extra()` 한 줄(AI 맞춤법 점검 요약 + 열기 단추) |
| `paperlab/static/js/jobs.js` | 작업 화면 이름 *맞춤법 점검* · 원고 제목 · 원고로 가는 주소 |
| `tests/test_proofread.py` · `tests/js/writeproof.test.mjs` | 검사 · 프롬프트 · 작업 경로(DB) · 화면 규칙 · 코드 검사 |

## 2. 점검 작업

1. 화면이 범위를 고른다: `sel` 고른 글 · `para` 커서 문단(빈 줄로 나뉨) · `sec` 커서가 있는 절(`###`까지의 마지막 제목 ~ 다음 같은/윗 단계 제목) ·
   `chap` 장(`##`까지) · `all` 전체. 제목 줄도 범위에 들어간다(번호는 서버가 지킴).
2. 범위를 **4,000자 안쪽 조각**으로(빈 줄 → 줄바꿈 → 문장 끝 → 띄어쓰기 순서로 자름, 글자 없는 조각은 뺌). 한 번에 **8조각**까지
   작업을 만들고(사용자당 진행 중 작업 30개 한도), 남으면 [이어서 점검].
3. 조각마다 `POST /api/ai/proofread` `{text, offset, chunk, chunks, scope, run, end, doc_len, doc_hash, manuscript_id}` → 202 {job}.
   `run` = 점검 묶음 이름(`[0-9a-z]{1,32}`) — 같은 묶음 조각을 화면이 모아 보여 준다. 틀린 값은 버리거나 400.
   엔진 순서는 글쓰기 도우미 설정(`ai_routing.write`)을 쓴다 — 설정 화면 · `ai_status`는 바뀌지 않음.
4. 프롬프트: 원고 글을 `<text>`로 감싸고(`ai.fence`), 자료 안 지시를 따르지 말라는 규칙 + 고치지 말 것 목록. 출력은 JSON
   `{"issues": [{"find", "replace", "type": 맞춤법|띄어쓰기|문법|표현, "reason"}]}` (CLI는 `output: json` + 스키마, API는 구조화 출력).
5. 결과 검사(`proofread.validate` — AI는 믿지 않음):
   - `find`가 보낸 글에 그대로 있어야 함(줄바꿈 없음 · 200자 이하), `replace` ≠ `find`(300자 이하, 줄바꿈 없음), 같은 항목 두 번은 하나만.
   - **고치면 안 되는 자리**에 걸치면 그 자리는 뺀다: `[@…]` · `[^…]` · `@fig:`/`@tbl:` · `{#…}` · 주소 · DOI · `` `코드` `` · `$수식$` · HTML 태그 ·
     `![…](…)`, 줄 통째로 코드 블록 · 표 줄(`|`) · 그림 줄 · `표:` 캡션 · `[참고문헌]`, 줄 머리의 제목 기호 + 번호(`## 제1장 ` · `### 1.2. `) · 목록 기호 · `>`.
   - `replace`가 마크다운 · 표지 문자(`[]`$#|*<>{}@^\~`)의 개수를 바꾸면 버림.
   - 같은 글자열이 여러 곳이면 고칠 수 있는 자리마다 한 항목(20개까지), 앞 항목과 겹치는 자리는 뺌. 모양이 틀리면 `bad_output`(실패 — 다시 시도 가능).
   - 결과 크기 상한(DB · 작업 목록 응답): 한 조각에 자리별 항목 **300개**, issues JSON **120,000자** — 넘으면 원고 뒤쪽 항목부터 빼고 `dropped`에 셈.
6. 작업 result: `{issues: [{find, replace, type, reason, at(원고 위치 = offset + 조각 안 위치), before, after(앞뒤 24자)}], dropped, offset, length, run, chunk, chunks, scope, doc_hash}`.
   원고는 서버에서 바꾸지 않는다. 결과는 글쓰기 결과처럼 **7일** 뒤 비우고(30일 뒤 행 삭제), 작업 보기의 `proof` 필드는
   `{run, chunk, chunks, scope, offset, length, end, doc_len, doc_hash, tail(조각 끝 60자)}` — 원래 글은 보내지 않는다.

## 3. 패널 (writeproofui.js)

- 점검표와 같은 겹쳐 뜨는 패널(`.check-pane.proof-pane`, `aria-modal="false"`). 열기: AI 도우미 메뉴 *맞춤법 · 띄어쓰기 점검…* · `Alt+P`, 닫기: ✕ · `Alt+P` · 패널 안 `Esc`.
- 열 때 · 시작 · 다시 시도 · 취소 뒤에는 `GET /api/jobs?status=recent&kind=proofread&manuscript_id=…`(결과까지)로 가장 최근 묶음을 보여 준다.
  점검 중에는 `status=active`(진행 중 작업만, 결과 없음 — 가벼움)만 2초(숨은 탭 10초)마다 보고, 조각이 끝났을 때만 결과까지 다시 받는다.
  다시 시도한 조각은 마지막 작업만. 실패 · 취소 조각은 [다시 시도], 점검 중이면 [취소](묶음의 진행 중 작업 모두).
- 항목: 꼬리표 · `<del>find</del> → <ins>replace</ins>` · 이유 — **모두 textContent**. [이동] · [고치기] · [무시].
- **자리 다시 찾기** (`locateIssue`): `at` 자리 글이 `find`와 같고 **그 앞 글이나 뒤 글(8자까지)도 같으면** 그 자리(앞에서 글이 늘고 줄어
  같은 짧은 글자열의 다른 곳 — 나중에 쓴 글 · 인용문 — 이 원래 자리로 밀려온 경우를 막음) → 아니면 `before+find+after` · `before+find` · `find+after`가
  원고에 **한 곳만** 있을 때 그 자리(앞뒤 글 합이 4자 미만이면 쓰지 않음) → 못 찾으면 *원고에서 찾지 못했어요*, 고치지 않음.
- [고치기]: 그 한 곳만 `applyEdit`(Ctrl+Z로 되돌림). [모두 고치기]: 찾은 곳만 · 겹치면 앞의 것 → **`saveVersion` 먼저**, 그다음
  `diffEdit` 한 덩어리 편집(Ctrl+Z 한 번).
- 무시 · 고침 표시: `localStorage["paperlab.proof.{원고}"] = {run, hidden, fixed}`(묶음이 바뀌면 비움, 저장소가 막혀도 동작).
- [이어서 점검]: 원고 지문이 그대로면 마지막 조각 끝부터 `end`까지, 바뀌었으면 마지막 조각 끝 글(`tail`)을 한 곳에서 찾아 그 뒤부터 ·
  끝은 원고 길이 차이만큼 옮김. 못 찾으면 범위를 다시 고르게 안내. 같은 `run`, 조각 번호는 이어서.
- 제출 전 점검표: 목록 아래 한 줄 `AI 맞춤법 점검: 아직 안 했어요 | 점검 중 | 고칠 곳 N건 | 고칠 곳 없음` + [맞춤법 점검 열기] —
  마지막 결과만 쓰고 AI를 부르지 않는다.

## 4. 초록 만들기 (글쓰기 모드)

- **초록 표지 두 모양**을 다 받는다: 굵은 줄(`**국문초록**` 다음 줄부터 · `**Abstract** — 글`처럼 같은 줄에 이어도 됨 — 국내 학술지 ·
  IMRaD 양식과 제출 전 점검표가 권하는 모양)과 제목(`## 국문 초록`). 표지 이름: `국문 초록` · `초록` · `요약`(괄호 덧말 허용) / `Abstract`.
  - 굵은 줄 초록 = 다음 제목 또는 다음 **앞뒤 표지 굵은 줄**(`**주제어**` · `**Keywords**` · 다른 초록 · 목차) 앞까지. 본문 안 강조
    (`**중요한** 점은…`)나 구조 초록 소제목(`**목적**: …`)에서는 끊지 않는다. 제목 초록 = 다음 같은 · 윗 단계 제목(또는 그 표지 굵은 줄) 앞까지.
  - 코드 블록 안은 표지가 아님.
- `abstract_en`: 보낼 글 = 고른 글, 없으면 국문 초록 본문. 넣을 자리 = 영문 초록 표지가 있고 비어 있으면 그 표지 줄 끝, 글이 있으면
  그 끝(덧붙임 — 안내), 없으면 **원문 초록 묶음 끝**(뒤따르는 `**주제어**` 줄까지 지나서; 원문 초록이 없으면 고른 글 끝). 6,000자 넘으면 안내.
- `abstract_ko`: 반대(`Abstract` → `국문초록`, 마지막 줄 `주제어:`).
- 작업은 `POST /api/ai/write`(insert = true, `writeAnchor`) — 결과는 **AI 결과 패널의 넣기 경로 그대로**(원고가 바뀌었으면 확인).
  대상 표지가 지금 원고에 없으면 넣을 글 앞에 **원문 초록과 같은 모양**의 표지를 붙인다(`withAbstractHeading`): 굵은 줄이면 `**Abstract**`
  (또는 `**국문초록**`)와 `**Keywords**:`(`**주제어**:`) 줄, 제목이면 같은 단계 제목, 원문 초록이 없으면 굵은 줄. 결과가 이미 `#` · `**`로 시작하면 그대로.
  굵은 줄 원고에 `## Abstract` 장을 만들지 않는다 — 첫 장이 되어 쪽 번호가 거기서 시작하고 점검표가 *abstract-chapter*를 띄우기 때문.

## 5. 하지 않는 것

- 서버에서 원고를 고치기, 점검표가 AI를 부르기, 맞춤법 사전 · 규칙 엔진(AI만), 영문 원고 전용 규칙, 여러 기기 사이 무시 표시 공유.
