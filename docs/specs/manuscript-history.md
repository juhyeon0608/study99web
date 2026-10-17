# 원고 버전 기록 · 비교 · 되돌리기

2026-10-17 · 논문 쓰기 화면. 구현: `paperlab/versions.py`(정책 · API) · `supabase/migrations/20261017000003_manuscript_versions.sql` ·
`paperlab/static/js/writehist.js`(순수 함수) · `paperlab/static/js/writehistui.js`(기록 창) · 시험 `tests/test_manuscript_versions.py` ·
`tests/js/writehist.test.mjs`.

## 1. 문제와 목표

원고는 자동 저장(`PATCH /api/manuscripts/{id}` — 0.8초 디바운스)이 `paperlab.manuscripts.content`를 **덮어쓴다**. 실수로 지우거나
AI 결과를 잘못 넣으면 돌아갈 길이 없었다. 목표:

- 지난 글이 사용자가 따로 하지 않아도 남는다(편집 중 10분마다 · AI 넣기 전 · 되돌리기 전).
- [지금 버전 저장]으로 이름 붙인 버전을 남긴다.
- 지난 버전과 지금 원고를 줄 · 낱말 단위로 비교하고, 되돌리거나 복사한다.
- 무료 DB 500MB를 지킨다(4장).

## 2. 데이터 — `paperlab.manuscript_versions`

| 열 | 뜻 |
|---|---|
| `id` · `user_id` · `manuscript_id` | 복합 외래 키 `(manuscript_id, user_id) → manuscripts (id, user_id) on delete cascade` — 원고 주인만, 원고를 지우면 함께 |
| `reason` | `auto` · `ai_apply` · `restore` · `manual` (CHECK) |
| `label` | 이름 (60자 · 제어 문자 없음, 빈 글 = 이름 없음) |
| `content` | 그때 원고 글 전체 (마크다운) |
| `size` · `chars` | UTF-8 바이트 · 글자 수. CHECK로 `octet_length` · `char_length`와 같고 `size ≤ 4MB` — 목록 · 보관 계산에 본문을 읽지 않게 |
| `sha256` | 같은 글 다시 남기지 않기 |
| `created_at` | 서버 시각(초 단위). 정렬은 `created_at desc, id desc` |

- 색인 `(user_id, manuscript_id, created_at desc, id desc)`.
- RLS enable + force, 정책 `own_rows`(authenticated, `auth.uid() = user_id`), authenticated · service_role(백업)에 select/insert/update/delete.
  anon 권한 없음. `paper_id` 열이 없어 휴지통 숨김 정책(`hide_trashed_children`) 대상이 아니다.
- 마이그레이션은 추가만(새 표 하나), 다시 돌려도 안전.

## 3. 언제 남기나

| 종류 | 언제 | 무엇을 |
|---|---|---|
| `auto` | `PATCH`에 `content`가 있고 글이 바뀌며, 이 원고의 **마지막 기록이 없거나 10분(`SNAPSHOT_EVERY`)보다 오래**됐을 때 | 바뀌기 **전** 글(DB에 있던 글). 그 글이 마지막 기록과 같거나(sha256) 비어 있거나 4MB를 넘으면 남기지 않음 |
| `ai_apply` | 화면이 AI 글쓰기 결과를 넣기 직전(`applyAiResult` · [커서 위치에 넣기]) `POST …/versions {reason: "ai_apply", content}` — 실패해도 넣기는 그대로 | 넣기 직전 **편집기 글**(아직 저장 전일 수 있음) |
| `restore` | 되돌리기 직전(서버) | 화면이 보낸 **편집기 글**(`current`)과 DB 글 — 다르면 둘 다(DB 글 먼저, 편집기 글이 가장 최근). 화면은 먼저 저장(flush)도 하지만, 그 저장이 실패해도(네트워크 · 5xx · 서버 재시작) 편집기 글이 기록에 남는다 |
| `manual` | [지금 버전 저장] | 화면은 먼저 저장(flush)하고 편집기 글을 보냄 |

- 같은 글 건너뛰기: 마지막 기록과 sha256이 같으면 새 행을 만들지 않고 그 기록을 돌려준다(`created: false`). 단 `manual`은 마지막 기록이
  직접 저장 · 이름 붙인 것일 때만 건너뛴다(자동 기록 위의 [지금 버전 저장]은 따로 남겨 보관 대상에서 빠지게). 이름을 주면 그 기록이
  이름 없을 때만 붙이고, 이미 **다른 이름**이 붙어 있으면 그 이름을 지우지 않고 새 기록(새 이름)을 만든다.
- 10분 간격은 "마지막 기록" 기준이라 AI 넣기 전 · 직접 저장 직후 10분 동안은 자동 기록이 생기지 않는다(바로 앞 글이 이미 남음).

## 4. 보관 · DB 크기 (500MB 무료 한도)

**정리 규칙**(`versions.thin_ids` — 자동 기록이 하나 생길 때마다 그 원고만):

1. `manual`이거나 이름이 붙은 기록은 지우지 않는다. 원고마다 최대 `PINNED_MAX = 50`개 · 합계 `PINNED_MAX_BYTES = 10MB`
   (넘으면 [지금 버전 저장] · 이름 붙이기가 400 — 지우거나 이름을 빼고 다시).
2. 나머지(`auto` · `ai_apply` · `restore`, 이름 없음)는 최신순으로
   - 최근 `KEEP_RECENT = 30`개는 모두,
   - 그보다 오래된 것은 `DAILY_DAYS = 30`일 안에서 한국 날짜마다 가장 최근 하나(최근 30개와 같은 날이면 지움),
   - 남긴 것의 합계가 `AUTO_MAX_BYTES = 5MB`(UTF-8, 압축 전)를 넘으면 그 뒤(더 오래된 것)는 지움 — 가장 최근 하나는 늘 남김.
3. 원고를 지우면 기록도 cascade로 지워진다.

**크기 계산**(가정: 한글 1자 ≈ UTF-8 3바이트, 마크다운 기호 · 공백 포함 평균 2.7바이트/자, TOAST 압축은 0.6~1.0배 — 보수적으로 1.0):

| 원고 | 글 크기 | 자동 기록 최대 개수 | 원고당 자동 기록 최대 |
|---|---|---|---|
| 학술지 논문 2만 자 | ≈ 55KB | 60 (30 + 30일) | ≈ 3.3MB |
| 학위논문 6만 자 | ≈ 165KB | 5MB 상한 → ≈ 30 | 5MB |
| 매우 긴 원고 | 1MB | 5개 | 5MB |

- 연구실 규모(사용자 10명 × 한창 쓰는 원고 2개 = 20개)에서 자동 기록 **최악 ≈ 100MB**(모두 5MB 상한), 한 달 매일 쓰는
  학술지 원고 기준 **≈ 66MB**. 직접 저장은 명시적인 행동이라 보통 원고당 수 개(학위논문 10개 ≈ 1.7MB).
- 직접 저장 · 이름 붙인 기록까지 넣은 **원고당 최악은 15MB**(자동 5MB + 직접 10MB). 20개 원고가 모두 그러면 ≈ 300MB라
  500MB 안이지만 다른 데이터와 합치면 빠듯하다 — 그 전에 아래 90% 안전장치가 직접 저장을 막는다. 실제로는 학위논문 한 편이
  직접 저장 50개(165KB × 50 ≈ 8MB)를 채워야 닿는 수치다.
- 안전장치: DB 크기가 한도의 90%(`server.DB_LEVEL` · `PAPERLAB_DB_LIMIT_MB`)를 넘으면 `auto`는 건너뛰고(로그 경고) `manual` ·
  `ai_apply` 요청은 400 "저장 공간이 거의 차서…". `restore` 직전 기록은 공간과 상관없이 남긴다(되돌리기를 되돌릴 수 있게 — 4MB 넘는 원고면
  되돌리기를 거절). 크기는 `system_sizes`(사용자 트랜잭션 안이면 30초 캐시)로 재며, 기록을 남기려 할 때만(최대 10분에 한 번) 잰다.
- 상수는 `paperlab/versions.py` 맨 위. 바꾸면 이 표와 FEATURES.md 8장을 함께 고친다.

## 5. API (모두 사용자 트랜잭션 · RLS + `user_id` 조건, 원고가 내 것이 아니면 404)

| 요청 | 응답 |
|---|---|
| `GET /api/manuscripts/{mid}/versions` | `{items: [{id, reason, label, size, chars, created_at, pinned}], pinned_max, every_minutes}` 최신순 200개, 본문 없음 |
| `GET …/versions/{vid}` | 위 + `content` |
| `POST …/versions` `{label?, reason?: "manual"(기본) \| "ai_apply", content?}` | 위 메타 + `created`. `content`가 없으면 저장된 원고 글. 4MB 초과 · 잘못된 이름 · 다른 reason · 상한 · DB 공간 → 400 |
| `PATCH …/versions/{vid}` `{label}` | 이름 붙이기(붙이면 정리 대상에서 빠짐) · `""`면 빼기 |
| `DELETE …/versions/{vid}` | `{ok: true}` |
| `POST …/versions/{vid}/restore` `{current?}` | 편집기 글(`current`, 없으면 저장된 글)과 저장된 글을 `restore`로 남기고(그 버전과 같은 글은 빼고) 원고 글 · 제목(`#` 줄)을 그 버전으로. `{ok, changed, content, title, updated_at, backup, restored}` — `changed`는 "편집기 글이 그 버전과 달랐나", 둘 다 같으면 기록 없음 |

`PATCH /api/manuscripts/{mid}`는 응답이 그대로이고, 안에서 `versions.on_patch`가 3장 `auto` 규칙을 적용한다.

## 6. 화면 (`writehistui.js`)

- 도구 막대 오른쪽 **[기록]**(한 줄 — 1280px에서 잘리지 않게 두 글자) · `Alt+H`(macOS `⌥+H`, 창이 열려 있으면 무시). 단축키 도움말
  (`writeedit.shortcutHelp`)에 있음.
- 기록 창(넓은 대화상자, 1040px — 좁은 화면은 위아래로 쌓임):
  - 왼쪽: [이름 (선택)] + **[지금 버전 저장]**, 목록(시각 "오늘 14:05" · 종류 꼬리표 · 이름 · "1,234자 · 3.6KB"), 보관 안내 한 줄.
    목록은 listbox — `↑` `↓` `Home` `End`로 고르기.
  - 오른쪽: 고른 버전 제목 · 보조 줄("지금 원고와 비교: −N줄 +M줄" 또는 "지금 원고와 같아요") · **바뀐 부분 | 이 버전 전체**.
    비교는 "그 버전 → 지금 **편집기** 글"(저장 전 글 포함): 줄 LCS(`lineDiff` — 앞뒤 같은 줄을 떼고 가운데만, 200만 칸 넘으면 통째로),
    같은 수의 지운 줄 · 넣은 줄 묶음(40줄까지)은 줄마다 낱말 차이(`writeai.wordDiff`), 바뀐 곳 앞뒤 2줄 밖의 같은 줄은
    "… 같은 줄 N줄 …"로 접음. 4000줄 넘으면 앞부분만.
  - 아래: [이름] · [삭제](확인 — 초점은 취소) · [복사] · **[이 버전으로 되돌리기]**(확인 창: 지금 원고는 ‘되돌리기 전’으로 남는다고 알림).
- 되돌리기: 쓰던 글 저장(flush) → `restore {current: 편집기 글}` → 창 닫기(inert 풀림) → `writetools.applyEdit`(insertText)로
  편집기 글 전체를 바꿈 — 브라우저 실행 취소에 남아 `Ctrl+Z`로 되돌리기를 취소할 수 있고, `input` 이벤트로 저장 · 미리보기 · 개요가
  편집과 같은 길 → 알림.
- 모든 사용자 글(원고 · 이름 · 오류 문구)은 `esc()` 또는 `textContent`로만 — `tests/js/writehist.test.mjs` 코드 검사.

## 7. 시험

- `tests/test_manuscript_versions.py`: 순수(보관 정리 · 이름 · 10분) + DB(10분 간격 · 같은 글 · 직접 저장 · AI 넣기 전 · 이름 ·
  되돌리기 · 지우기 · cascade · 상한 · 보관 정리 · DB 한도 · RLS: 다른 사용자 API 404 · 직접 SQL 0행 · 남의 원고 가리키는 행 거절 ·
  카탈로그 RLS/권한 · CHECK).
- `tests/js/writehist.test.mjs`(pytest `tests/test_js_node.py`의 `writehist`): 줄 비교 · 다시 합치기 · 접기 · 낱말 차이 · 문구 ·
  코드 검사 · writing.js 연결(AI 넣기 전 saveVersion이 넣기보다 먼저).
