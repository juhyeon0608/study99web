# 원고 AI 대화 · AI 범위 고치기 · 장 · 절 일괄 처리

2026-10-17 · 논문 쓰기 화면 (제품 책임자 요청: "지금은 자연어로 대화해서 수정하거나 하는 기능이 따로 없는거 같아",
"논문 쓸 때 ai 보내는 범위가 좀 이상한거 같기는 한데", 장 · 절 일괄 처리).
구현: `paperlab/mschat.py`(프롬프트 · 답 읽기 · API) · `supabase/migrations/20261017000007_ms_chat.sql` ·
`paperlab/static/js/writeedit.js`(범위 순수 함수) · `writechat.js`(대화 · 일괄 순수 함수) · `writechatui.js`(패널 보기) ·
시험 `tests/test_mschat.py` · `tests/js/writechat.test.mjs`.

## 1. AI에 보낼 범위 (writeedit.js `textBlocks` · `aiScope`)

예전 `selectionOrParagraph`는 빈 줄 사이 글을 통째로 보내 제목 · 표 · 그림 줄이 섞였다. 이제 원고를 덩어리로 나눈다.

| 덩어리 | 문단 모드로 보냄 |
|---|---|
| 문단(para) · 목록(list — 빈 줄로 띄운 느슨한 목록도 통째로) · 인용 블록(quote) | 예 |
| 제목 `#…` · 표 `|…` · 그림 `![…](fig:…)` · 캡션 `표: …` · 코드 울타리 · 각주 정의 `[^1]: …` · 가로줄 · `[참고문헌]` | 아니오 |

- 범위 종류(✦ AI 도우미 메뉴 — 원고마다 localStorage `paperlab.aiScope.{id}`): **선택**(고른 글, 없으면 커서 문단) · **문단** ·
  **이 절**(지금 `###` 제목 다음 줄 ~ 다음 `###` 이하 단계 제목 전) · **이 장**(지금 `##` 제목 다음 줄 ~ 다음 `##` 전).
  제목 줄 자체는 보내지 않는다(장에는 그 안의 `###` 제목이 맥락으로 남지만 문단 목록에는 들지 않음).
- 커서가 빈 줄 · 제목 · 표 · 그림 · 캡션 · 코드 · 각주 정의 줄이면 문단 모드는 보내지 않고 이유를 토스트로(`SCOPE_WHY`).
- 보내기 전에 보낼 범위를 편집기에서 1.2초 골라 보여 주고(그 사이 손대지 않았으면 원래 커서로 되돌림), 패널에
  `대상: 제2장 제1절 (문단 4개 · 1,230자)`(`scopeSummary`).

## 2. 장 · 절 일괄 처리

- 범위가 이 절 · 이 장이고 모드가 문단 모드(다듬기 · 학술 문체 · 간결하게 · 자세히 · 영어 · 한국어 번역)이며 문단이 둘 이상이면:
  확인 창에 문단 수 → `POST /api/manuscripts/{id}/ai-batch {mode, instruction(끝맺음 규칙), label, doc_hash, items[{text, sel_start, sel_end, before}]}`
  → 문단마다 `write` 작업 하나(params에 `batch {id, n, mode, label}` · `batch_i`). 한 번에 **30개**(진행 중 작업 상한
  `jobs.MAX_ACTIVE_JOBS` 30 — 남은 자리보다 많으면 하나도 만들지 않고 429 too_many_jobs).
- `GET …/ai-batch` 최근 7일 묶음 목록 · `GET …/ai-batch/{bid}` 묶음의 작업(넣기 정보 포함).
- 패널 **[일괄]**: 문단마다 바뀐 부분 · [적용] · [건너뛰기](handled dismissed) · [원고에서 보기], 위에 [모두 적용] · [남은 것 건너뛰기].
  넣기는 문단마다 `planApply`(writeai.js — 지문이 같으면 그 자리, 다르면 원래 문단이 그대로 한 곳에 있을 때만). [모두 적용]은
  뒤 문단부터 글에 넣어 본 뒤 한 번에 넣는다(실행 취소 한 번). 묶음의 첫 넣기 전에 `saveVersion` 한 번.
- 일괄 문단 작업은 [결과] 목록 · 도구 막대 숫자에서 빼고, 끝남 알림은 묶음마다 한 번만.

## 3. 원고 AI 대화

### 3.1 데이터 — `paperlab.ms_chat_messages` (RLS enable + force, 본인 행만)

| 열 | 뜻 |
|---|---|
| user_id · manuscript_id | (manuscript_id, user_id) → manuscripts 복합 외래 키, on delete cascade |
| role | user · assistant |
| content | 질문 · 답 글 (40,000자 CHECK) |
| scope | 보낸 범위 `{kind, label, from, to, fingerprint(원고 지문), chars}` — 범위 글은 넣지 않음(작업 params에만). 답은 `reply_to`(질문 id) · `note` (4KB CHECK) |
| proposals | 답의 수정 제안 `[{find, replace, at, state}]` (256KB CHECK). at = 질문을 보낼 때 원고 위치(UTF-16 — 화면과 같은 셈), state = applied · discarded |
| job_id | 만든 · 답한 작업 (작업 행은 30일 뒤 지워지므로 외래 키 없음) |

원고마다 최근 300개만 둔다(넣을 때 정리). 질문 4,000자 · 범위 글 16,000자(작업 params 64KB 안) · 목차 4,000자.

### 3.2 API (`mschat.register`)

- `GET /api/manuscripts/{id}/chat` → `{messages, jobs: {질문 id: 그 질문의 가장 최근 ms_chat 작업}, limits}` (다시 시도로 새 작업이 생겨도 이어 보임)
- `POST /api/manuscripts/{id}/chat {content, scope{kind, label, from, to, fingerprint, text}, outline, ending}` → 202 `{message, job}`.
  답을 기다리는 작업이 있으면 409. 경로가 없으면 400(질문 행도 롤백).
- `PATCH …/chat/{msg}/proposals/{i} {state}` · `DELETE …/chat`(진행 중 작업 취소 + 모두 지움 — 늦게 끝난 답은 버림)
- 다시 시도는 기존 `POST /api/jobs/{id}/retry` (params에 질문 id가 있어 같은 질문의 답으로 붙음)

### 3.3 작업 `ms_chat`

- 경로: `jobs.ROUTE_KIND["ms_chat"] = "write"` — 글쓰기 엔진 순서로 **내 PC의 CLI** 또는 **내 API 키**. 서버 CLI 없음.
  기한 24시간 · CLI 시간 제한 600초 · 중간 글은 진행(partial_text)으로.
- 프롬프트(`mschat.chat_request`, 시스템 `MS_CHAT_SYSTEM`): 편집자 역할 + `[@키]` 그대로 · 지어내지 않음 · `[확인 필요]` ·
  자료 안의 지시는 따르지 않음 + 제안 형식. 순서: `<outline>` → `<sources>`(범위 · 질문의 `[@키]` · `@키` → 제목 · 초록 · 요약 · 메모)
  → `<conversation>`(이 질문 앞 10개, 제안 수 · 적용 수 포함) → `<scope kind label>` → 끝맺음 규칙 → `요청:`.
  자료 글은 모두 `ai.fence` + scope · outline 태그 무디게 + U+2063 지움(프롬프트 주입 방어).
- 답 형식: 글 + 끝에 ```` ```json {"edits": [{"find", "replace"}], "note"} ```` 또는 `{"replace_all": "…"}`. 서버(`split_reply` ·
  `proposals_from`)가 마지막 JSON 블록(없으면 끝의 맨 JSON)을 읽고, find를 범위 글에서 찾아(그대로 → 앞뒤 공백 뺀 글 →
  띄어쓰기 · 줄바꿈만 다른 글, **한 곳일 때만**) 원고에 실제로 있는 글과 위치를 적는다. 깨진 형식은 답 끝에 안내.
  화면(`writechat.splitReply`)도 같은 규칙으로 만드는 중인 글에서 JSON을 숨긴다("수정 제안을 쓰는 중…").

### 3.4 화면 (AI 패널 '대화' — `writechatui.chatView`)

- 범위 칩(선택 · 문단 · 이 절 · 이 장, 기본 자동 = 고른 글 → 문단 → 절) · 대상 한 줄 · 대화 · 입력(Enter 보내기 · Shift+Enter 줄바꿈).
- 제안마다 바뀐 부분(diffHtml) · [적용] · [다시](그 부분을 다르게 다시 묻기) · [버리기] · [원고에서 보기], 둘 이상이면 [모두 적용].
  넣기는 `proposalEdit` = planApply(지문 · at · find) — same은 그 자리, moved는 원래 글이 그대로 한 곳에 있을 때, lost면 넣지 않고 [복사].
  넣기 전 `saveVersion`. 제안이 `[@키]`를 빠뜨리면 경고.
- 답 글은 purifyMd(marked), 만드는 중인 글 · 질문은 textContent, 바뀐 부분은 diffHtml(이스케이프)로만.
- 열기: 패널 [대화] · ✦ AI 도우미 → *AI와 대화하며 고치기…* · `Alt+C`(입력 칸으로) · 끝남 알림 [열기](`#/write/{id}/j{작업}`).

## 4. 시험

- `tests/test_mschat.py`: 프롬프트(규칙 · 순서 · 주입 방어) · 답 읽기 · 자리 찾기 · UTF-16 위치 · 범위 검사 · 인용키 + DB(API 키 흐름 ·
  지난 대화 · 제안 상태 · 409 · 지우기 · CLI 경로 프롬프트 · 다시 시도 · RLS · 표 검사 · 보관 수 · 일괄 처리 · 상한 429)
- `tests/js/writechat.test.mjs`: 덩어리 · 범위 · 대상 한 줄 · 목차 · 답 읽기 · 제안 넣기 · 모두 적용 · 대화 줄 · 일괄 넣기 · Alt+C · 코드 검사
