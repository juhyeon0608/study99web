# 기능 명세 — 4단계 쉬운 설명(②) · 번역(③)

- 작성: 기획팀 · 2026-10-13 (브랜치 `claude/paper-program-hrrhl2`, HEAD 362b7f0 기준)
- 상태: **구현 완료(승인 대기) — 2026-10-13 구현 차이 반영본(18장).** 확정: 사용자 U-1(영역 캡처 · codex 이미지 생성은 4단계 이후 후속), 팀장 K-1~K-14 추천안 (16장)
- 근거: [PLAN.md](../../PLAN.md) 2장 · 3장 ②③ · 6장 4단계, [2단계 명세](phase2-worker-electron.md) 5 · 6 · 9 · 15장(작업 큐 · 라우팅 · interactive SSE · U7), [3단계 명세](phase3-rag-verify-search.md) 4 · 8 · 11.4 · 14장(`page_texts` · R2 키 규칙 · `goToSpot`), 3단계 품질팀 M1 · 승인자 N6(`ui.js` `MD_PURIFY`)
- 원칙: **ponytail** — 기존 모듈 재사용, 꼭 필요하지 않은 것은 "안 하는 것". 수치는 코드 상수 한 곳의 **가정값**
- 표기: **확정** = 사용자 결정, **K-n** = 팀장 결정(추천안), **U-n** = 사용자 질문, **확인 필요** = 개발팀 실측

---

## 1. 목적

| 기능 | 사용자가 얻는 것 |
|---|---|
| ② 쉬운 설명 | 읽기 화면에서 문장 · 문단을 드래그해 [쉽게 설명]을 누르면 **한 줄 요약 · 쉬운 설명 · 자세한 설명**과, 그림이 도움이 될 때 **개념 그림(SVG)** 을 받습니다. 같은 선택은 다시 누르면 바로 나옵니다. |
| ③ 선택 번역 | 드래그한 부분을 설정한 언어(기본 한국어)로 번역합니다. |
| ③ 전체 번역 | 논문 전체(또는 쪽 범위)를 백그라운드로 번역하고, **PDF 옆 패널에서 지금 보는 쪽의 번역**을 읽습니다. 끝난 쪽부터 바로 보이고, 실패한 쪽만 다시 돌리거나 멈춘 곳부터 이어 갈 수 있습니다. [원고로 만들기]로 원고(쓰기 화면)에 넣어 워드 · 한글로 내보낼 수 있습니다. |

## 2. 결정과 원칙

| 항목 | 내용 | 근거 |
|---|---|---|
| AI 엔진 | **API 키 우선 → CLI 워커 폴백**, 작업 큐(`jobs`) 위 | PLAN 2 · 5장 |
| 작업별 엔진 | 새 설정 두 줄 `explain` · `translate`(선택 · 전체 공용), **기본 `[claude]`** | 확정 U1 규칙, K-10 |
| 실행 방식 | 선택 설명 · 번역 = **interactive SSE**(대화와 같음), 전체 번역 = **백그라운드 작업**(탭을 닫아도 계속) | 2단계 9.3 · 15장 |
| CLI 대기 기한 | 전체 번역 **24시간**(확정 U7), 선택 설명 · 번역 30분(대화와 같은 대화형 — K-7) | U7 |
| DB 용량 | Supabase 무료 500MB 유지 — **큰 번역 본문은 R2 파일**, DB에는 작은 메타만 | PLAN 7장, 3단계 U-2와 같은 원칙 |
| 개인 데이터 | 설명 · 번역은 각자의 데이터(RLS). 다른 사용자와 공유 · 공용 캐시 없음 | PLAN 2장 |
| 실패 | 조용히 빈 결과를 주지 않음 — 사유를 그대로 | PLAN 5장 5번 |

## 3. 범위

### 하는 것
1. 읽기 화면 선택 상자(`sel-pop`)와 하이라이트 상자(`ann-pop`)에 **[쉽게 설명] · [번역]**.
2. 오른쪽 패널 새 탭 **"설명·번역"** — ① 이 논문의 선택 설명 · 번역 기록(카드) ② 전체 번역 보기(K-1).
3. 선택 설명 · 번역: `POST /api/papers/{pid}/explain`(SSE), DB `explanations`에 저장(기록 겸 캐시 — K-4).
4. 개념 그림: AI가 필요할 때만 SVG를 넣음 → 서버 사전 검사 → 화면에서 DOMPurify(SVG 프로필) + **`<img src="blob:">` 격리 표시**(K-2, 7장).
5. 전체 번역: 작업 종류 `translate_paper`, 쪽 묶음 단위로 **잡기 한 번에 묶음 하나**(K-6), 결과는 **R2 JSON 파일 하나** + DB `translations` 메타(K-5). 진행률 · 취소 · 이어서 · 실패 쪽 다시 · 쪽 범위 · 참고문헌 제외(K-8) · 예상 토큰 확인(K-13) · [원고로 만들기](K-12).
6. 설정: 번역 대상 언어 `translate_language`(기본 한국어 — K-9), 작업별 엔진 두 줄.

### 안 하는 것
| 항목 | 이유 · 나중에 |
|---|---|
| **영역 캡처(그림 · 수식 이미지를 잘라 설명)**, **codex 이미지 생성** | **확정 U-1(2026-10-13): 4단계 이후 후속**(PLAN 6장). OpenAI · Google API는 2단계에서 텍스트 전용, CLI에 그림을 넘기는 경로가 없음, codex 이미지는 PC가 켜져 있어야 함 |
| 참고 패널(1C) · 쓰기 화면에서 설명 · 번역 | 1C 원칙(패널에서 AI 안 함) 유지. 탭 그리기 함수는 export만 해 둠 |
| 전체 번역 병렬(묶음 동시 실행) | 묶음마다 대기열 뒤로 가는 방식으로 공평성 확보(K-6). 느리다고 실측되면 검토 |
| 논문당 번역본 여러 언어 동시 보관 | 논문당 하나(다른 언어로 바꾸면 교체) |
| PDF 위에 번역 겹쳐 그리기, 번역 PDF 만들기, 쪽별 원문 텍스트 대역 목록 | 원문은 왼쪽 PDF 그대로가 대역. 문서 파일은 [원고로 만들기] → 기존 내보내기 |
| 표 · 수식 재구성, 그림 속 글자 번역, 스캔 PDF OCR | `page_texts` 글자만 |
| SVG 편집 · 내려받기 · 원고에 넣기, 그림만 다시 그리기 | [다시 만들기]가 전체를 새로 |
| 선택 설명에 PDF 원본 첨부(Claude PDF) | 비용 — 선택 글 + 그 쪽 문맥만 |
| 번역 용어집 · 번역 메모리, 번역문 전문 검색, 열면 자동 번역 | |
| 설명 결과로 대화 이어가기 | 기존 [AI에게 묻기] 사용 |

## 4. 재사용

| 필요한 것 | 재사용 | 바뀌는 점 |
|---|---|---|
| 선택 글 · 쪽 · 좌표 | `reader.js` `onMouseUp` · `selectionRects`(쪽별 `[x,y,w,h]`) · `annotationPopup` | 버튼 두 개, `R.embed`이면 숨김 |
| 위치로 이동 | `goToSpot(page, [x0,y0,x1,y1], text)`(3단계) · `goToPage` · `R.currentPage` | 안내 문구 인자 하나(선택) |
| 메모로 남기기 | `POST /api/papers/{pid}/annotations` | 그대로 |
| 쪽 본문 | `db.page_texts`(1단계) | 그대로 |
| SSE 작업 | `server.stream_job` · `jobs.create_job(running_api=True)` · `interrupted` 규칙 | `done` 이벤트에 `item` |
| CLI 폴백 · 작업 상태 | `jobs.cli_task` · `parse_result` · `_apply` · `watchJob` · `statusLineEl` · `retryJob` | 새 종류 3개 |
| 같은 행 여러 단계 | `jobs.find_hold`(3단계 AI로 찾기) 방식 | `translate_next` |
| 백그라운드 실행 | `api_runner.ApiRunner`(리스 · 복구 스캔 · 사용자당 2) | `translate_paper` 분기 |
| AI 호출 | `ai.AIService.complete(system, prompt, engine, schema)` | 그대로 |
| 글 그리기 | `ui.renderMarkdown` + `MD_PURIFY`(수식 KaTeX) | `MD_PURIFY` 강화(7.4절 — class · id · svg · math 금지) |
| SVG 정화 | `vendor/purify.min.js` | `ui.SVG_PURIFY` · `renderSvg` 신규 |
| R2 | `storage.UserStorage`(키 fullmatch · `put` · `get` · `delete_quietly`) · `admin orphans` | 키 규칙 `translations/` |
| 저장 공간 95% 막기 | 1단계 업로드 검사 | 전체 번역 시작에도 |
| 원고 만들기 | `db.add_manuscript` | 서버가 번역 파일로 본문 생성 |

---

## 5. 사용 흐름 · 화면 (문구 · 배치는 디자인 시안 `docs/design/phase4-explain-translate-ui.md`)

### 5.1 선택 상자
```
[■■■■■] | [메모] [AI에게 묻기] [쉽게 설명] [번역] [복사]       ← 읽기 화면 sel-pop · ann-pop
```
- 누르면 패널이 닫혀 있으면 열고 "설명·번역" 탭으로 → 맨 위에 진행 카드("설명을 쓰는 중…" / 번역은 글이 흘러나옴).
- 선택 글 2~4,000자(공백 정리 뒤). 여러 쪽에 걸치면 첫 쪽 번호 · 첫 쪽 사각형을 저장.
- 한 읽기 화면에서 동시에 하나만(진행 중이면 버튼 비활성 + 툴팁 "앞의 요청이 끝나면 할 수 있어요").
- 탭을 바꿔도 이어지고, 읽기 화면을 떠나면 SSE가 끊겨 `interrupted`(2단계 규칙). CLI로 넘어간 작업은 끝까지 가고 다음에 열면 카드가 보임.

### 5.2 "설명·번역" 탭 — 위: [선택 기록 | 전체 번역] 전환
- **선택 기록**: 이 논문의 카드, 최신이 위. 카드 = 원문 앞 120자(“…”) · p.N · 종류 칩(설명/번역) · 언어 · 만든 날짜.
  - 설명 카드: **한 줄**(굵게) → **쉬운 설명** → [자세히 ▾] 접힌 **자세한 설명**(`renderMarkdown`) → **그림**(있을 때, 7장).
  - 번역 카드: 번역문(`renderMarkdown`).
  - 버튼: [원문 위치](`goToSpot`) · [메모로 남기기](선택 사각형 + 노랑 하이라이트 + 메모 = 한 줄 + 쉬운 설명 / 번역문) · [복사] · [다시 만들기](`force`) · [지우기].
  - 캐시로 나온 카드는 "저장된 설명" 표시. 실패 카드는 사유 + [다시 시도].
- **전체 번역**(5.3절).

### 5.3 전체 번역 보기 — "PDF 왼쪽 원문 · 패널 오른쪽 번역"(K-1)
- **번역 없음**: 언어(기본 설정값) · 쪽 범위(기본 전체, `p.__~p.__`) · "참고문헌 이후(p.18~20)는 번역하지 않아요 [포함]" · **예상**("17쪽 · 입력 약 3.5만 · 출력 약 2.9만 토큰 · 약 6분, 사용 중인 API 키로 요금이 나가요" — 9장) → [번역 시작]. CLI 경로면 "‘집 PC’의 claude 구독으로 실행" 안내.
- **진행 중**: 진행 막대 문구 **"12/17쪽"**(서버 `progress.message` = 끝난 쪽/번역할 쪽 + "쪽" — `done`+`failed`+`-` 쪽이 분모, 건너뜀 · 제외 쪽은 뺌) + 2단계 상태 줄(대기 · 어느 PC · 폴백) · [취소]. 끝난 쪽은 바로 읽을 수 있음. **[취소]는 진행 중인 묶음이 끝난 뒤에 적용**된다(그 묶음 결과는 반영 · 이후 묶음만 멈춤 → `cancelled`).
- **읽기**: 패널은 PDF의 `R.currentPage`를 따라감(스크롤 멈춘 뒤 300ms). 머리 "p.12 번역" + [◀ ▶] + [따라가기 켬/끔]. 쪽 상태별 문구: 대기 "아직 번역 전이에요" · 실패 "번역하지 못했어요 (사유) [이 쪽 다시]" · 빈 쪽 "글자가 없는 쪽" · 같은 언어 "이미 한국어인 쪽" · 참고문헌 "참고문헌 이후 — 번역하지 않음 [포함해 번역]".
- 아래 줄: [실패한 쪽 다시(3)] · [이어서 번역](대기 쪽이 있고 진행 중 작업 없음) · [원고로 만들기] · [번역 지우기] · **[다른 언어로 번역…]**(진행 중 작업이 없을 때). [다른 언어로 번역…]은 시작 창을 열되 언어 기본값을 **지금 번역의 언어가 아닌 것**부터 보여 주고, 다른 언어로 시작하면 서버가 409를 돌려주어 "기존 영어 번역을 지우고 한국어로 새로 번역할까요?" 확인 뒤 `replace:true`로 다시 보낸다(문구는 서버 `detail`에 담김 — 6.3절 1번).
- 작업 목록(2단계): 이름표 "쉬운 설명" · "선택 번역" · "전체 번역", [열기] → `#/read/{pid}`. 단 **화면 연결에 묶인 interactive SSE 작업(선택 설명 · 번역)은 "설명·번역" 탭의 진행 중 목록(`GET …/explanations`의 `jobs`)에서 뺀다** — 그 화면의 진행 카드가 이미 보여 주므로 중복 · 끊긴 연결 잔상을 막음. 켜진 PC 대기(CLI) · 백그라운드 작업만 목록에 나온다.

---

## 6. 엔진 · 작업

### 6.1 작업 종류
| `kind` | 엔진 설정 | 화면 연결 | CLI 대기 기한 | 시간 제한 | 출력 | 결과 반영 |
|---|---|---|---|---|---|---|
| `explain` | `ai_routing.explain` | API = SSE, CLI = 큐 | 30분 | 600초 | JSON(`EXPLAIN_SCHEMA`) | `explanations` 행, `result = {"explanation_id"}` |
| `translate` | `ai_routing.translate` | API = SSE(글 흐름), CLI = 큐(`stream_partial`) | 30분 | 600초 | 글 | 같음 |
| `translate_paper` | `ai_routing.translate` | 백그라운드 + 폴링(1.5초/10초) | **24시간**(U7), 묶음이 끝날 때마다 다시 셈 | 묶음당 900초 | JSON(`TRANSLATE_SCHEMA`) | R2 파일 + `translations.page_state`, 끝나면 `result = {"translation_id","done","failed"}` |

- `config.JOB_KINDS`에 `explain` · `translate`, `jobs.ALL_KINDS`에 `translate_paper`(엔진 설정 없음 — `translate` 경로 사용, 범위 대화가 `chat`을 쓰는 것과 같음).
- 2단계 9.1절 표의 "(4단계) 번역 `[claude, gemini]` · 쉬운 설명 이미지 `[codex]`" 예시는 **폐기**(K-10).
- 진행 중 `translate_paper`는 논문당 하나(부분 유일 색인). 두 번 누르면 기존 작업을 200으로.

### 6.2 선택 설명 · 번역 (SSE)
1. 요청 `{"kind","text","page","rects","force":false}`. 검사: 내 논문(RLS), `text` 2~4,000자, `rects` ≤ 20개 · 0~1, `kind=translate`이고 대상이 한국어인데 한글 비율 ≥ 50% → 400 "이미 한국어예요".
2. **캐시**: `force`가 아니면 `(paper_id, kind, lang, sel_hash)` 행이 있으면 작업 없이 `{"type":"done","cached":true,"item"}` 한 이벤트. `sel_hash = sha256(kind \n lang \n 공백 정리한 text)`, `lang` = 설명은 `summary_language`, 번역은 `translate_language`.
3. 없으면 `stream_job(kind, params={"text","page","rects","force"})`. 쪽 문맥은 **실행할 때** `page_texts`로 만듦(params에 본문 없음 — 2단계 K16).
4. `done` → `_apply`가 검사 · 저장(같은 키 행이 있으면 갱신) → 이벤트에 `item`(카드 모양, 10장). CLI · 폴백 · 실패 · 끊김은 대화와 같은 이벤트.
5. 결과 검사(`explain.parse`): JSON 못 읽음 · `one_line` 빈 값 → `bad_output`(폴백 없음). 번역 글 빈 값 → `bad_output`, 20,000자 초과 → `bad_output`. SVG는 7.2절 사전 검사에 걸리면 **SVG만 빼고**(`svg=""`, `svg_note="unsafe"|"too_large"`) 설명은 저장.

### 6.3 전체 번역 (K-5 · K-6 · K-8)
1. **시작** `POST /api/papers/{pid}/translation` `{"lang","from","to","include_refs","replace":false}`:
   - 쪽 상태 `page_state`(쪽마다 한 글자): `-` 대기 · `d` 끝 · `f` 실패 · `s` 건너뜀(글 20자 미만, 또는 대상 한국어 + 한글 ≥ 50%) · `r` 참고문헌 이후 제외 · `.` 범위 밖.
   - 참고문헌: **뒤 60% 쪽** 중 한 줄이 `(?i)^\s*(references|bibliography|works cited|literature cited|참\s*고\s*문\s*헌|参考文献|引用文献)\s*$`인 첫 쪽 = `refs_from`. 그 쪽은 제목 줄 **앞까지만** 번역, 다음 쪽부터 끝까지 `r`(부록 포함). `include_refs`면 `-`. **`refs_from`은 저장해 둔 값을 믿지 않고 시작 · 이어서 · 다시 때마다 `page_texts`로 다시 계산**해 달라졌으면 행을 고친다(`translate.refs_start`).
   - 한글 비율(`hangul_ratio` — 글자(문자 · 한자 · 가나, 숫자 · 기호 · 공백 제외) 중 한글 비율, 기준 `KO_RATIO` 0.5)은 **`translate.py`가 갖고** `explain.py` · `server.py`가 가져다 쓴다(선택 번역 400 검사와 쪽 상태 `s`가 같은 함수).
   - 한 번에 번역할 쪽(`-`) ≤ **100쪽**(넘으면 400 "100쪽까지 한 번에 번역할 수 있어요. 쪽 범위를 정해 주세요"). R2 95% 이상이면 400(1단계 문구). 경로 없음 → 400(2단계 문구).
   - 행이 없으면 만들고(`tr_key`에 새 세대 토큰), 같은 언어 행이 있으면 범위 안 `-`만 다시 표시(이어서), **다른 언어 행이 있으면 409** `{"detail": "기존 {옛 언어} 번역을 지우고 {새 언어}로 새로 번역할까요?", "code": "other_lang", "lang"}` — **확인 문구는 서버 `detail`에 담겨** 화면이 그대로 확인창에 쓴다. `replace:true`면 옛 행 · 파일 지우고 새로.
   - 작업 `translate_paper`, `params = {"translation_id", "retry": false}` → 202 `{job}`.
2. **이어서 · 다시**: `POST …/translation/continue` `{"pages":"pending"|"failed"|[n…]}` — `failed` · 쪽 목록은 해당 쪽을 `-`로 바꾸고 `params.retry = true`(**1쪽씩** 묶음), `include_refs` 켜기도 여기로.
3. **묶음**(`translate.next_chunk`): 쪽 번호 순서로 연속된 `-` 쪽, **최대 3쪽 · 9,000자**, 한 쪽이 9,000자를 넘으면 혼자(20,000자에서 자르고 끝에 "(뒷부분이 길어 생략했어요)"). `retry`면 1쪽.
4. **잡기 한 번 = 묶음 하나(API · CLI 같음 — K-6)**: 잡을 때 묶음을 정해 `params.chunk`에 적음(`set_params` — 3단계 verify 방식) → 실행 → 반영:
   - ① 리스 확인(읽기만) ② **트랜잭션 밖에서** R2 지금 파일 읽기 → 쪽 글 넣기 → **새 세대 키**(`tr_key` 새로 뽑음 — 같은 키를 덮어쓰지 않음)에 쓰기(F9) ③ 트랜잭션에서 `lock_leased` · 리스 기한 · **`translations.tr_key`가 ①에서 읽은 키 그대로일 때만(조건부)** `page_state` 갱신 + 포인터(`tr_key`)를 새 키로 교체 → 남은 `-`가 있으면 **`translate_next`**(`find_hold`와 같음: `queued` · `attempts = 0` · `not_before = now()` · `deadline_at = now() + 24h` · `progress` 유지) — API 실행기는 그 작업을 **대기열 뒤로** 다시 넣음, 없으면 `succeeded`. 옛 키는 교체 커밋 **뒤에** 지움.
   - ②와 ③ 사이에 리스를 잃거나 포인터가 바뀌었으면(**늦게 끝난 실행** · 번역 지우기 · 다른 언어 교체) 결과를 버리고 방금 쓴 새 키를 지운다 — 그 쪽은 `-`로 남아 다시 번역됨. 늦은 실행이 새 번역 파일을 덮어쓰지 못한다.
   - 결과 JSON `{"pages":[{"page","text"}]}`: 묶음 밖 번호는 버림, 빠진 쪽 · 빈 글 · 30,000자 초과 → 그 쪽 `f`(사유 `bad_output`).
5. **실패 규칙**: 폴백 대상 오류(2단계 9.6 — 키 · 한도 · 서버 · 연결 · `api_bad_request`)는 **작업 전체**가 다음 경로 칸으로(남은 쪽부터). 폴백 안 하는 오류(`api_refusal` · `api_max_tokens` · `bad_output` · CLI 결과 해석 실패)는 **그 묶음 쪽만 `f`**(사유는 `translations.page_errors`), 다음 묶음 계속. 경로를 다 쓰면 `failed` — 끝난 쪽은 남음.
6. **진행**: `progress = {"message","fraction","counts":{"pages_done","pages_total"}}`(`clean_progress`의 `counts` 허용 키에 추가). 화면은 `pages_done`이 바뀔 때만 `GET …/translation`.
7. **취소**: 2단계 6.5절 그대로 — 실행 중이면 **진행 중인 묶음이 끝나 반영된 뒤** `cancelled`(`advance`가 취소 요청을 보고 다음 묶음을 잡지 않음). 끝난 쪽 유지 → [이어서 번역].
8. **재시작 · 리스 만료**: 복구 스캔 · 재할당 그대로 — 파일에 쓴 쪽은 `d`라 다음 묶음부터.
9. **PDF 교체**: `set_pdf` 트랜잭션에서 `translations` 행을 지우고 옛 `tr_key`를 돌려줌 → 커밋 뒤 파일 삭제. 진행 중 작업은 다음 반영 때 행이 없으므로 `cancelled`(`error = "PDF가 바뀌어 번역을 멈췄어요"`). 선택 기록(`explanations`)은 원문 글을 갖고 있어 **남김**(K-11).

### 6.4 프롬프트 규칙 (`explain.py` · `translate.py` 상수, 세 경로 같은 프롬프트)
- **공통 문맥**: 제목, 초록 앞 1,500자(설명만), 선택 쪽 `page_texts`에서 선택 글 위치 앞뒤 합 **6,000자 이하**(못 찾으면 그 쪽 앞 6,000자).
- **설명** — `summary_language`로. `one_line` 80자 이하 · 전문용어 없이. `easy` 비유 하나를 끝까지, 용어는 그 자리에서 풀기, 3~5문장. `detail` 정확한 설명(마크다운, 수식 `$…$`), 선택 글에 없는 보충은 "※ 일반 지식으로 보충" 표시. `diagram_svg`는 흐름 · 구조 · 비교 · 계층 · 시간 순서가 그림으로 쉬워질 때만, 아니면 `""`. SVG 규칙(AD-2): 루트 `<svg viewBox="0 0 400 H">`(H ≤ 600), 색은 `currentColor` · `var(--accent)`만, 배경 칠 금지, `<text>` 글자 크기 12~14px, 요소 200개 이하, `style` · `script` · `image` · `foreignObject` · `a` · `use` · 바깥 주소 · `href` 금지.
- **번역(선택 · 전체)** — `translate_language`로, 번역문만. 학술 문체, 전문용어 첫 등장에 원어 병기 "트랜스포머(Transformer)". 수식 · 변수 · 기호 · 숫자 · 단위 · 인용 번호 `[12]` · 그림/표 번호 · 저자-연도 인용은 그대로. 줄 끝 하이픈 · 줄바꿈 복원. 머리글 · 바닥글 · 쪽 번호 빼기. 소제목은 `### ` 줄. 표 조각은 숫자를 바꾸지 않고 줄글로, 깨진 수식은 원문 그대로(추측 복원 금지). 원문이 이미 대상 언어면 그대로.
- 위 400 · 600 · 12~14는 **AI에게 주는 지시값**이다. 서버 검사 · 화면 검사의 상한은 그대로 `viewBox` 폭 · 높이 0 초과 4,000 이하(7.2 · 7.3절) — 지시를 어겨도 이 범위 안이면 그린다.
- 언어 목록: 서버는 `config.TRANSLATE_LANGS` **하나**(`translate.LANGS`는 그 별칭, 설정 검사 · 쪽 계획 · 409 문구가 모두 이것을 씀) — `ko` 한국어 · `en` English · `ja` 日本語 · `zh` 简体中文. 화면 `explain.js`의 `LANGS`는 같은 네 개를 적어 둔 복사본이다(아래 12장 AC-S02).

---

## 7. SVG 그림 보안 (K-2 · K-3)

### 7.1 위협
AI 출력은 믿지 않습니다(논문 본문의 프롬프트 주입 포함). 막을 것: 스크립트(`<script>` · `on*=` · `javascript:`) · `foreignObject`(HTML 끼워 넣기) · 바깥 요청(`<image href>` · `feImage` · `use href` · `url(https://…)` · `<style>@import` — **3단계 M1 · N6 교훈: 읽음 추적 · 주소 유출**) · 화면 스타일 오염(`<style>`이 앱 CSS를 덮음) · 앱 클래스 · id 사칭(`class="modal-backdrop"`, `id="open-settings"` 등 — `R.onKey`가 `.modal-backdrop`을 찾음) · XML 엔티티 · 거대 · 복잡한 그림(화면 멈춤).

### 7.2 서버 사전 검사 (`explain.check_svg` — 저장 전, 걸리면 SVG만 뺌) — 품질 M-1 수정분 반영
순서(검사용 글만 바꾸고 **저장은 원문 그대로**):
1. 24KB(UTF-8) 초과 → `svg_note = "too_large"`.
2. **풀기**: HTML 엔티티(이름 · 10진 · 16진, 두 번)와 CSS 이스케이프(`\72` · `\r`)를 푼 글(`flat`)을 만든다. 이어서 **이름공간 접두어**(`s:script` · `x:onload` · `xlink:href`의 `s:` · `x:` · `xlink:`)를 뗀 글(`bare`)도 만든다.
3. **루트 모양**: `flat`이 `<svg …>`로 시작(앞뒤 공백 뺀 뒤), `</svg>`로 끝나고 `</svg>`가 정확히 하나, `bare`에서 `<svg` 열기 태그가 정확히 하나, **루트 태그에** `viewBox`가 있고 폭 · 높이가 0 초과 4,000 이하.
4. **전역 금지 패턴**(대소문자 무시)을 `flat` · `bare` **둘 다**에서, 태그 안 · 밖을 가리지 않고 글 전체에서 찾는다. 하나라도 있으면 거부: `on[a-z]+\s*=` · `<script` · `foreignobject` · `href` · `url\(\s*(?!#)` · `<style` · `\sstyle\s*=` · `@import` · `<!doctype` · `<!entity` · `<![cdata` · `<?` · `<iframe` · `<img` · `<image` · `<use` · `<feimage` · `include` · `javascript:` · `xml:base` · `<a` 요소.
5. 걸리면 `svg = ""`, `svg_note = "unsafe"`(모양 · 패턴), 설명은 저장.
- **오탐은 받아들임(승인)**: 패턴이 태그 안 · 밖을 가리지 않으므로 그림 속 글자에 `Ontology=`(`on…=`와 일치) · `include` · `href` 같은 낱말이 있으면 멀쩡한 그림도 빠진다. 그때는 "그림이 안전 검사를 통과하지 못해 빼었어요"가 뜨고 설명 글은 그대로이며, [다시 만들기]로 새 그림을 받을 수 있다. 오탐을 줄이려고 패턴을 느슨하게 하지 않는다(우회 방어 우선).
- 서버에서 HTML을 정화하지는 않음(Python 정화기 추가 안 함) — **진짜 방어는 화면(7.3)**, 서버는 이중 방어 + 용량 상한.

### 7.3 화면 표시 (`ui.renderSvg(svgText, {text, accent})` → 요소 또는 `null`)
1. `SVG_PURIFY = { USE_PROFILES: { svg: true }, FORBID_TAGS: ["style","image","a","use","foreignObject","script","feImage","animate","set","animateMotion","animateTransform","textPath","mpath"], FORBID_ATTR: ["style","href","xlink:href","class"] }` — `svgFilters` 프로필은 켜지 않음. **`id`는 남김**(마커 `url(#arrow)`용), 대신 4번 격리로 앱 DOM과 섞이지 않음.
2. 정화 결과의 루트가 `svg` 하나가 아니거나, 요소가 **1,500개 초과**(순수 함수 `svgCountOk(개수)`가 셈 — Node 테스트 가능)거나, `viewBox`의 폭 · 높이가 0 이하 · 4,000 초과(`svgViewBoxOk`)면 실패.
3. 속성 값의 `url(…)`은 CSS 이스케이프를 푼 뒤 `url(#이름)`만 남기고(`svgUrlOk`) 나머지 속성은 지움. `currentColor` → 지금 테마 글자색, `var(--이름[, 대체])` → 지금 테마 강조색(계산값 hex). `width` · `height` 속성은 지우고 표시 크기는 CSS(폭 100%, 최대 높이 480px).
4. 직렬화 → `new Blob([…], {type:"image/svg+xml"})` → `URL.createObjectURL` → **`<img alt="{one_line}">`**. 이미지로 그린 SVG는 브라우저가 **스크립트를 실행하지 않고 바깥 자원을 불러오지 않으며**, 안의 스타일 · id · class가 앱 화면에 닿지 않음. **blob 주소는 이미지가 로드되거나 실패하면(`load` · `error`) 바로 `revokeObjectURL`** — 카드가 화면에 있는 동안 붙들고 있지 않는다(테마가 바뀌면 다시 그림). CSP `img-src`는 이미 `blob:` 허용(변경 없음).
5. 실패(`null` · `img.onerror`): 그림 자리에 "그림을 그리지 못했어요" — 설명 글은 그대로. 서버가 뺀 경우(`svg_note`)는 "그림이 안전 검사를 통과하지 못해 빼었어요". 테마가 바뀌면 다시 그림.
- **절대 하지 않음**: 정화 전 · 후 SVG 문자열을 `innerHTML`로 앱 DOM에 넣기, `MD_PURIFY`로 SVG 그리기, 서명 주소 · 파일로 SVG 내보내기.

### 7.4 마크다운 정화 `ui.MD_PURIFY` (품질 H-1 · L-2)
설명 · 번역 · 대화 등 AI 글을 `renderMarkdown`으로 그릴 때의 설정. 이 설정은 앱 전체의 마크다운 그리기에 적용된다(쓰기 화면 미리보기 포함).
- `USE_PROFILES: { html: true }` — HTML 프로필만. 금지 태그: `img` · `image` · `picture` · `source` · `video` · `audio` · `form` · `input` · `button` · `textarea` · `select` · `style` · **`svg` · `math` · `dialog`**. 금지 속성: `style` · `srcset` · `background` · **`class` · `id` · `popover` · `popovertarget` · `popovertargetaction`**. (`dialog open`은 브라우저 기본 스타일로 패널 밖 화면 가운데에 뜨므로 금지 — 승인자 C-2)
- **근거(H-1)**: AI 글(논문 본문의 프롬프트 주입 포함)이 `class="modal-backdrop"` 같은 **앱 클래스를 사칭해 앱 화면 안에 가짜 창 · 단추를 만들 수 있다**. 그래서 `class` · `id`를 막고, 그림은 `renderSvg`(7.3절)로만 그린다. 수식(KaTeX) · 인용 번호 단추는 정화 **뒤에** 텍스트 노드에서 끼워 넣으므로 영향이 없다. 코드 블록의 `language-*` class는 쓰는 곳이 없어 잃어도 무방(L-2).
- 3단계 M1 · N6의 "바깥 주소 · 폼 막기"는 그대로 유지(위 금지 태그 · 속성에 포함).

---

## 8. 데이터 · 저장

### 8.1 마이그레이션 `supabase/migrations/20261013000001_explain_translate.sql`
1. **`explanations`**(RLS 1단계 틀 — enable + force, `own_rows`, `authenticated`만, `service_role` 백업 권한): `id` identity, 공통 `user_id`, `paper_id`(복합 FK `on delete cascade`), `kind text check in ('explain','translate')`, `lang text`(1~20자), `sel_hash text`(64자 16진수), `page int`, `rects jsonb default '[]'`(≤ 20), `source_text text`(≤ 4,000자), `result jsonb`(설명 `{"one_line","easy","detail","svg","svg_note"}` / 번역 `{"text"}`, 검사: 크기 64KB 이하), `engine text`, `model text`, `created_at`, `updated_at`. `unique (user_id, paper_id, kind, lang, sel_hash)`, 색인 `(user_id, paper_id, created_at desc)`.
   - **사용자당 300행**(가정 — K-4): 저장한 같은 트랜잭션에서 오래된(`updated_at`) 것부터 지움. 화면 안내 "최근 300개까지 보관".
2. **`translations`**(같은 RLS 틀): `id`, 공통 `user_id`, `paper_id`(복합 FK cascade), `lang text`, `tr_key text not null`(검사: 8.2절 모양 — uid 일치는 서버가 검사), `pdf_sha256 text`, `page_state text`(쪽 수 = 길이, 글자 `-dfsr.`만), `page_errors jsonb default '{}'`(`{"12":"api_refusal"}`), `include_refs bool`, `refs_from int null`, `engine text`, `model text`, `created_at`, `updated_at`. `unique (user_id, paper_id)`.
3. **`jobs`**: `kind` 검사에 `explain` · `translate` · `translate_paper`(엔진 `local` 규칙은 그대로 `index`만), `unique (user_id, paper_id, kind) where kind = 'translate_paper' and status in ('queued','running')`.

### 8.2 R2 번역 파일 (K-5)
- 키 `users/{uid}/translations/{paper_id}.{gen}.json`(`gen` = 8자리 16진수 **세대 토큰 — 행을 만들 때, 그리고 묶음 결과를 쓸 때마다 새로 뽑음**. 쓴 뒤 DB 포인터 `translations.tr_key`를 조건부로 교체하므로 지운 뒤 늦게 온 쓰기와 새 번역이 섞이지 않음 — 6.3절 4번). `storage._TR_KEY_RE` fullmatch, `tr_key(uid, pid)`, `check_user_key` 확장. **서명 주소를 만들지 않음** — 서버가 읽어 돌려줌.
- 내용 `{"v":1,"paper_id","pdf_sha256","lang","pages":{"12":"번역문", …}}`(`application/json`). 읽을 때 `paper_id` · `pdf_sha256`이 DB와 다르면 그 파일을 쓰지 않고 오류("번역 파일이 맞지 않아요 — 번역을 지우고 다시 해 주세요").
- 읽을 키는 **RLS 질의로 얻은 `translations.tr_key`뿐**(3단계 9.2절과 같은 사용자 경계).
- 정리: 논문 삭제 — `delete_paper`가 `tr_key`도 돌려주고 커밋 뒤 `delete_quietly`. [번역 지우기] · `replace` · PDF 교체도 같은 순서(DB 먼저, 커밋 뒤 파일). 남은 고아는 `admin orphans`가 `translations/`도 대상으로. DB 백업 대상 아님(다시 번역 가능 — 3단계 K-20과 같음).

### 8.3 용량 추정 (가정)
| 곳 | 계산 | 결과 |
|---|---|---|
| DB `explanations` | 평균 8KB(설명 4KB + SVG 4KB) × 300행 × 5명, 최악(SVG 24KB 가득) 30KB | 평균 **12MB**, 최악 45MB |
| DB `translations` · `jobs` | 행당 1KB 미만 | 1MB 미만 |
| R2 번역 파일 | 쪽당 한국어 약 2,000자 × 3바이트 ≈ 6KB → 50쪽 300KB, 5명 × 100편 | 약 **150MB**(10GB 중) |

---

## 9. 비용 · 길이 (2026-10-13 AC-P15 실측으로 상수를 고침 — 9.1절)

`translate.EST` 상수(코드 한 곳, 팀장 결정 2026-10-13)로 아래를 계산한다.

| 상수 | 값 | 전 가정 |
|---|---|---|
| `chars_per_token`(입력 글자 ÷ 이 값 = 입력 토큰) | **3.25** | 3.9(영어 4자/토큰) |
| `out_ratio`(출력 = 입력 토큰 × 이 값) | **1.6** | 1.5 |
| `chunk_overhead`(묶음당 고정분 — 지시 · 제목 · JSON, 입력 토큰) | **1,800** | 600 |
| `tokens_per_s`(출력 속도) | **110** | 50 |
| `chunk_wait_s`(묶음 사이 대기 — CLI 폴링 5초) | 5(그대로) | 5 |
| 쪽 본문 글자 수 | 아래 두 행의 표는 쪽당 **3,500자**(2단 가정 그대로). 실측 논문은 1단 쪽당 약 4,600자 | 3,500자 |
| 묶음 크기 | 3쪽 · 9,000자 규칙(6.3절) — **쪽당 3,500자면 3쪽(10,500자)이 9,000자를 넘어 2쪽씩**, 쪽당 4,600자면 2쪽(9,200자)도 넘어 1쪽씩 묶임. 글이 적은 쪽이 섞이면 3쪽도 가능 | 같음 |

| 논문 | 번역 쪽(참고문헌 제외) | 묶음 | 입력 | 출력 | 시간 |
|---|---|---|---|---|---|
| 20쪽 | 17쪽(3쪽 제외, 59,500자) | **9** (2쪽씩 8 + 1쪽 1) | 약 **3.5만** 토큰(18.3천 + 9 × 1.8천) | 약 **2.9만**(18.3천 × 1.6) | 약 **6분**(출력 266초 + 대기 45초) |
| 50쪽 | 44쪽(6쪽 제외, 154,000자) | **22** (2쪽씩) | 약 **8.7만**(47.4천 + 22 × 1.8천) | 약 **7.6만** | 약 **14분**(출력 689초 + 대기 110초, 올림) |

- 시간 = 출력 ÷ `tokens_per_s` + 묶음 수 × `chunk_wait_s`, 분 단위로 올림(`estimate`와 같음). 이 표는 CLI 폴링 대기를 넣은 값이다. API 경로는 대기가 수 초라 조금 짧을 수 있다(미확인 — 9.1절 한계).
- 요금 = 입력 × 입력 단가 + 출력 × 출력 단가(**사용자 본인 키** — 설정 모델의 공식 가격표). 예시(단가 가정 입력 $5 · 출력 $25 / 100만 토큰): 20쪽 약 $0.90(입력 $0.17 + 출력 $0.73), 50쪽 약 $2.33(입력 $0.43 + 출력 $1.90). 전 가정(상수 고치기 전)은 $0.68 · $1.74였다. CLI 경로는 구독 한도를 씀.
- 선택 설명 1회: 입력 약 2.5천(문맥 6,000자 + 지시 · SVG 규칙) · 출력 약 1.5~3천 토큰. 선택 번역 1회: 입력 약 1.5천 · 출력 ≈ 선택 글 토큰 × 1.5.
- 화면 예상(5.3절)은 서버 `translate.estimate(page_texts, lang)` — 위 상수(`translate.EST`, 입력 글자 ÷ 3.25 = 토큰)로 계산하고 "대략"으로 표시. 시작 창은 같은 상수와 쪽별 글자 수를 받아 범위 · 언어 · 참고문헌을 바꿀 때 다시 셈(AD-3). 묶음 상한(3쪽 · 9,000자)으로 한 번의 출력이 `max_tokens`(16,000)에 닿지 않게 함.

### 9.1 실측 결과 (AC-P15 — 2026-10-13, 품질팀 실시 · 사용자 승인)
- **조건**: arXiv 2310.17407v1, 20쪽, 1단 조판, CC BY 4.0. 참고문헌 2쪽을 빼고 **18쪽** 번역. Claude CLI(워커 코드 그대로), 모델 claude-opus-5-5, 대상 언어 `ko`.

| 항목 | 실측 | 새 상수로 계산한 추정 | 차이 |
|---|---|---|---|
| 묶음 | 14(쪽당 약 4,600자라 대부분 1쪽씩), 실패 0 | 14 | 같음 |
| 입력 글자 | 80,396 | — | — |
| 입력 토큰 | 50,261 | 약 49,900 | 약 -1% |
| 출력 토큰 | 40,206 | 약 39,600 | 약 -1.5% |
| 시간 | 순수 358초(약 6.0분), 워커 폴링 5초 × 14를 넣으면 약 7.1분 | 약 430초(7.2분) | 약 +1% (폴링 포함 기준) |

- **회귀식**(14개 묶음): 입력 = 1,821 + 글자 ÷ 3.247 · 출력 = 82 + 글자 × 0.486 · 시간(초) = 3.76 + 출력 ÷ 131.6. 이 값을 둥글려 `chars_per_token` 3.25 · `out_ratio` 1.6(출력 ≈ 글자 × 0.49) · `chunk_overhead` 1,800 · `tokens_per_s` 110(회귀 131.6보다 보수적)으로 고침.
- **전 가정과의 차이**: 전 가정(3.9 · 1.5 · 600 · 50)으로 같은 18쪽을 셈하면 입력은 약 42% · 출력은 약 23% 적게, 시간은 약 11.5분으로 오히려 길게 나온다(출력 속도를 50으로 낮게 잡았기 때문). 2배 넘는 차이는 아니어서 팀장 보고 기준에는 걸리지 않았으나 상수를 맞춰 고침.
- **한계 — 이 값을 어디까지 믿는가**
  - 논문 **1편**(영어 · 1단 · 한국어 번역)만 쟀다. 2단 논문 · 수식 · 표가 많은 글 · 다른 언어(ja · zh · en)는 글자 대 토큰 비가 다를 수 있다.
  - **CLI 경로만** 쟀다. 묶음당 고정분 1,800(`chunk_overhead`)은 CLI 경로에서 나온 값이라, **API 경로의 고정분은 확인하지 못했다**(API 키 경로 실측은 후속).
  - 모델 한 가지(claude-opus-5-5)만 쟀다. 설정에서 다른 모델을 고르면 달라진다.
  - 표의 20쪽 · 50쪽 행은 실측이 아니라 **새 상수로 다시 계산한 값**이다(쪽당 3,500자 가정).
- **후속(낮음)**: 실측 결과 1쪽 번역문의 제목이 소제목 규칙(`### `, 6.4절)이 아니라 `# `로 나왔다. 화면 모양에만 영향이 있어 이번에 고치지 않고 개발팀 후속 목록에 둔다(프롬프트에서 제목 줄을 `### `로 못박거나, 서버가 `# `를 `### `로 바꾸는 방법 중 개발팀이 고른다 — 미정).

## 10. API
| 경로 | 내용 |
|---|---|
| `POST /api/papers/{pid}/explain` (SSE) | 6.2절. 이벤트 `delta`(번역만) · `done`(`item`, `cached`) · `queued` · `fallback` · `error` |
| `GET /api/papers/{pid}/explanations` | 카드 목록(최신 100개) + 진행 중 `explain`/`translate` 작업(`/api/jobs?kind=…&paper_id=…`과 같은 모양) |
| `DELETE /api/explanations/{id}` | 지우기(남의 것 · 없는 것 404) |
| `GET /api/papers/{pid}/translation` | `{"translation": {id, lang, page_state, page_errors, refs_from, include_refs, pages: {"N": 글 — d 쪽만}} | null, "job": 진행 중이거나 마지막 작업 | null, "estimate": {pages, refs_from, input_tokens, output_tokens, minutes}}` |
| `POST /api/papers/{pid}/translation` · `…/translation/continue` | 6.3절 → 202 `{job}` / 진행 중이면 200 `{job}` |
| `DELETE /api/papers/{pid}/translation` | 진행 중 작업 취소 + 행 삭제 + 커밋 뒤 파일 삭제 |
| `POST /api/papers/{pid}/translation/manuscript` | 원고 만들기 → `{"id"}`. 제목 "[번역] 논문 제목", 본문 맨 위 "> AI 번역 — 인용 전에 원문과 대조하세요", 쪽마다 `## p.N` + 번역문(실패 · 대기 · 제외 쪽은 한 줄 안내). 새 원고 기본 양식 |

- 카드 모양 `item`: `{"id","kind","lang","page","rect":[x0,y0,x1,y1]|null,"rects","source_text","one_line","easy","detail","svg","svg_note","text","engine","created_at","cached"}`(`rect` = `rects` 경계 상자 — `goToSpot`용).
- 선택 글 · 번역문은 **본문에만**, 주소에 없음. 설정 `GET/PUT /api/settings`에 `translate_language`(`ko|en|ja|zh`, 기본 `ko`, 그 밖 400), `ai_routing`에 `explain` · `translate`.

## 11. 로그 · 기록
- 앱 로그는 숫자 · 코드만: `{"event":"explain","kind","cached","ms","svg":true|false,"svg_note"}`, `{"event":"translate_chunk","pages","chars","ms","failed"}`, `{"event":"translate_done","done","failed","skipped"}`. **선택 글 · 설명 · 번역문 · SVG · 제목 · R2 키 없음**. 2단계 `job created/failed` 로그는 그대로.

---

## 12. 수용 기준
표시: `[자동]` pytest/Node(가짜 AI · `FakeStorage`), `[db]` 테스트용 Supabase, `[수동]` 화면, `[실환경]` 서버 PC + 실제 키.

### D. 데이터 · 경계
- **AC-D01** [db] 마이그레이션 뒤 `explanations` · `translations`가 RLS(enable + force, `own_rows`)이고 `tests/test_rls.py` 카탈로그 검사(AC-20)가 통과한다.
- **AC-D02** [db] 사용자 A의 설명 · 번역 행과 4단계 작업을 B 권한으로 읽으면 0행이고, B가 A의 `pid`로 10장 경로를 부르면 404이며 A의 R2 파일을 읽지 않는다(가짜 저장소 호출 기록).
- **AC-D03** [자동] `tr_key`가 8.2절 형식을 만들고, 검사가 fullmatch로 다른 uid · 끝 줄바꿈 · `..` · 대문자 16진수 · 다른 확장자를 거부한다. B 요청 경로에서 A의 `translations/` 키 → `StorageKeyError`, 저장소 호출 없음. 번역 파일 서명 주소를 만드는 코드가 없다(코드 검색).
- **AC-D04** [db] 논문을 지우면 두 표의 행이 지워지고 커밋 뒤 번역 파일이 지워진다. PDF를 바꾸면 `translations` 행 · 파일이 지워지고 진행 중 `translate_paper`는 `cancelled`, `explanations`는 남는다.
- **AC-D05** [자동] `admin orphans`가 DB에 없는 `translations/` 키를 찾고 `--delete`로 지운다.
- **AC-D06** [db] 상한을 3으로 주입하고 설명 4개를 저장하면 가장 오래된 1개가 지워진다.
- **AC-D07** [자동] 4단계 코드에 `system_tx` 새 사용처가 없다(코드 검색).

### E. 선택 설명 · 번역
- **AC-E01** [db] 가짜 Anthropic이 설명 JSON을 돌려주면 SSE `done.item`에 `one_line` · `easy` · `detail` · `svg`가 있고 `explanations` 1행, 작업 `succeeded` · `result.explanation_id`.
- **AC-E02** [db] 같은 글 · 같은 언어로 다시 요청하면 가짜 AI 호출 0회 · 새 작업 0개 · `cached: true` 한 이벤트. `force: true`면 다시 호출하고 같은 행이 갱신된다. 언어 설정을 바꾸면 새로 만든다.
- **AC-E03** [db] 키 없고 기기 있음 → `queued` 이벤트 후 가짜 워커 JSON 결과가 같은 모양으로 저장. 키가 틀림 → `fallback`. 키도 기기도 없음 → 400(2단계 문구).
- **AC-E04** [자동] 프롬프트에 선택 글 · 제목 · 쪽 문맥(앞뒤 합 6,000자 이하)과 설정 언어가 들어가고, 작업 `params`에 쪽 본문이 없다.
- **AC-E05** [자동] 결과 검사: JSON 못 읽음 · `one_line` 빈 값 → `bad_output`(폴백 없음). 번역 빈 글 · 20,000자 초과 → `bad_output`. SVG 사전 검사 실패 → `svg = ""` · `svg_note`가 붙고 설명은 저장된다.
- **AC-E06** [자동] 선택 글 1자 · 4,001자 → 400, `rects` 21개 · 범위 밖 값 → 400, 대상 한국어 번역에 한글 50% 이상 → 400 "이미 한국어예요".
- **AC-E07** [db] 선택 번역(가짜 스트림)은 `delta`가 둘 이상 오고 `done` 뒤 카드 `text`가 저장된다.
- **AC-E08** [db] SSE를 중간에 끊으면 작업이 `cancelled` · `interrupted`이고 행이 생기지 않는다(2단계 회귀).
- **AC-E09** [수동] 읽기 화면 선택 상자 · 하이라이트 상자에 [쉽게 설명] · [번역]이 있고 참고 패널(1C)에는 없다. 카드 [원문 위치] → 그 쪽 사각형 · 반짝임, [메모로 남기기] → 노랑 하이라이트 + 메모, [복사] · [다시 만들기] · [지우기]가 동작한다. 진행 중에는 두 버튼이 비활성이다.

### G. SVG
- **AC-G01** [자동] `tests/fixtures/svg/` 악성 모음(`script` · `onload` · `foreignObject` · `javascript:` 링크 · `<image href="https://…">` · `use href` · `fill="url(https://…)"` · `<style>@import` · `<!DOCTYPE>/<!ENTITY>` · 24KB 초과 · 루트가 svg 아님 · `viewBox` 없음)을 서버 사전 검사가 모두 거부하고, 정상 예시 3개는 통과시킨다. 같은 악성 모음을 **엔티티(`&#x6F;nload` · `&lt;`류) · CSS 이스케이프(`u\72l(…)`) · 이름공간 접두어(`s:script` · `x:onload` · `xlink:href`)로 위장**한 변형도 모두 거부하고, `<svg` 둘 · `</svg>` 둘 · 루트 바깥 글이 있는 것도 거부한다. 그림 속 글자 `Ontology=`가 든 정상 그림은 **거부되는 것이 기대 동작**(오탐 수용 — 7.2절).
- **AC-G02** [자동] `ui.js` 코드 검사: `SVG_PURIFY`가 7.3절 목록을 모두 포함하고 `svgFilters`가 없으며, `renderSvg`가 `<img>` + `blob:`로 그리고 SVG 문자열을 `innerHTML`로 넣는 코드가 없다(`explain.js` 포함).
- **AC-G03** [자동 Node] `renderSvg`의 순수 함수: `svgColor`(`currentColor` · `var(--x, y)` 바꾸기), `svgUrlOk`(`url(#a)`만 남기기 — CSS 이스케이프 `u\72l(…)`도 막음), `svgCountOk(1500)` 참 · `svgCountOk(1501)` 거짓, `svgViewBoxOk` — `viewBox` 폭 · 높이 0 · 4,001 → 실패, 4,000 → 통과.
- **AC-G04** [수동] 개발 서버에서 사전 검사를 끈 테스트 설정 + 가짜 AI가 악성 모음을 차례로 돌려줄 때: 알림창이 뜨지 않고, 개발자 도구 네트워크에 바깥 주소 요청이 0건, 앱 화면 모양 · 단축키(Esc)가 그대로이며, 그림은 `<img src="blob:…">` 안에만 있다.
- **AC-G05** [수동] 정상 그림이 밝은 · 어두운 테마에서 글자색 · 강조색으로 보이고, 깨진 SVG면 "그림을 그리지 못했어요"와 설명 글이 그대로 보인다.
- **AC-G06** [자동] CSP 헤더가 3단계 값 그대로다(회귀).
- **AC-G07** [자동] `ui.js` 코드 검사 + Node: `MD_PURIFY`가 `USE_PROFILES: { html: true }`이고 `FORBID_ATTR`에 `class` · `id` · `style` · `srcset` · `background`, `FORBID_TAGS`에 `svg` · `math` · `dialog` · `style` · `form` · `input` · `button` · `textarea` · `select`가 있다(7.4절). [수동] 설명 글에 `<div class="modal-backdrop">…</div>`가 든 마크다운을 그려도 앱 창 모양이 생기지 않고 글자만 나온다.
- **AC-G08** [수동] 그림을 그린 직후 개발자 도구에서 그 `blob:` 주소를 다시 열면 이미 해제되어 있다(load · error 때 revoke).

### P. 전체 번역
- **AC-P01** [자동] 쪽 상태: 20자 미만 → `s`, 대상 한국어 + 한글 50% 이상 → `s`, 뒤 60% 안의 참고문헌 제목 줄 쪽 → 그 쪽은 제목 앞까지만 번역 · 다음 쪽부터 `r`, 앞 40% 안의 "References"는 무시, `include_refs`면 `-`, 범위 밖 `.`.
- **AC-P02** [자동] 묶음: 연속 `-` 쪽, 최대 3쪽 · 9,000자, 넘치는 한 쪽은 혼자(20,000자에서 자름), `retry`면 1쪽. 쪽당 3,500자 17쪽이면 2쪽씩 묶여 9묶음이 되고 `estimate`의 `chunks`가 9, `minutes`가 6이다(새 상수 — 9장).
- **AC-P03** [db] 20쪽 가짜 PDF + 가짜 Anthropic: 시작 202 → 묶음마다 같은 작업이 다시 대기 · 잡힘 → `progress.counts`가 늘고 → `succeeded`. `page_state`는 `d`/`s`/`r`만, R2 파일 `pages`가 그 쪽들과 같고, `GET …/translation`은 `d` 쪽만 돌려준다.
- **AC-P04** [db] 한 묶음에서 가짜 AI가 `api_refusal`(또는 `bad_output`)이면 그 쪽만 `f` · `page_errors`에 사유, 나머지는 계속, 끝은 `succeeded`. `continue {"pages":"failed"}` → 그 쪽만 1쪽씩 호출된다(가짜 AI 호출 기록).
- **AC-P05** [db] 묶음 도중 `api_auth` → 같은 작업이 CLI 칸으로 `queued`, 가짜 워커가 받은 프롬프트에 이미 `d`인 쪽이 없다.
- **AC-P06** [db] 실행 중 취소 → **진행 중인 묶음 결과가 반영된 뒤** `cancelled`(그 묶음 쪽은 `d`, 다음 묶음은 안 잡힘), `d` 쪽 유지. 늦게 끝난 실행(리스 잃음 · 번역 지움 · 다른 언어로 교체)은 새 세대 파일을 지우고 결과를 버려 새 번역 파일을 덮어쓰지 않는다(가짜 저장소 호출 기록). `continue {"pages":"pending"}` → 남은 쪽만. 실행기를 멈췄다 다시 만들면(재시작) 복구 스캔으로 남은 묶음부터 끝난다.
- **AC-P07** [db] 켜진 PC가 없으면 `queued` · `deadline_at` ≈ 24시간 뒤, 묶음이 끝날 때마다 다시 셈, 기한이 지나면 `no_worker_timeout`이고 `d` 쪽은 남는다.
- **AC-P08** [db] 같은 논문 두 번 시작 → 두 번째는 200 + 같은 작업. 다른 언어로 `replace` 없이 → 409, `replace: true` → 옛 행 · 파일이 지워지고 새로 시작.
- **AC-P09** [db] 대기 쪽 101쪽 → 400, `from: 3, to: 5` → 3~5쪽만 `-`, R2 95% 이상 → 400.
- **AC-P10** [db] 결과 JSON 검사: 묶음 밖 쪽 번호는 버리고, 빠진 쪽 · 빈 글 · 30,000자 초과 쪽은 `f`.
- **AC-P11** [db] [원고로 만들기] → 원고 제목 "[번역] …", 본문에 `## p.N`이 쪽 순서대로, 실패 · 대기 · 제외 쪽은 안내 한 줄.
- **AC-P12** [db] 실행 스레드 1개로 주입하고 번역 작업(묶음 5개)과 다른 사용자 요약을 함께 넣으면 요약이 번역이 끝나기 전에 끝난다(묶음마다 대기열 뒤로).
- **AC-P13** [자동] 2b 워커 코드가 `explain`(json) · `translate`(text, 중간 글) · `translate_paper`(json) 작업을 수정 없이 처리한다(가짜 CLI).
- **AC-P14** [수동] 시작 창에 예상 쪽 · 토큰 · 시간 · 제외 쪽이 보이고, PDF를 넘기면 번역 보기가 그 쪽으로 따라가며, 진행 중에도 끝난 쪽은 바로 보이고, [이 쪽 다시] · [이어서 번역] · [번역 지우기]가 동작한다.
- **AC-P15** [실환경] **실측 완료(2026-10-13, 품질팀 · 사용자 승인 — 9.1절).** arXiv 2310.17407v1(20쪽, 참고문헌 2쪽 제외 18쪽)을 Claude CLI 경로 · claude-opus-5-5 · `ko`로 번역: 14묶음 · 실패 0 · 입력 50,261 · 출력 40,206 토큰 · 순수 358초. 결과로 `translate.EST`를 고침. 남은 한계(논문 1편 · CLI 경로만 · API 고정분 미확인)는 9.1절. 다른 경로 · 모델 · 논문으로 다시 재면 2배 넘게 다를 때 팀장 보고.

### S · L · X
- **AC-S01** [db] 설정에 `explain` · `translate` 엔진 줄과 `translate_language`(기본 `ko`, 그 밖 값 400)가 저장 · 반영된다.
- **AC-S02** [자동] 언어 목록 서버 정의가 `config.TRANSLATE_LANGS` 하나이고 `translate.LANGS`가 그것을 가리키며(`is`), 화면 `explain.js` `LANGS`의 키 · 이름이 같다.
- **AC-L01** [자동] 설명 · 선택 번역 · 전체 번역 뒤 앱 로그에 심어 둔 선택 글 · 번역문 · SVG 조각 · 제목 · `translations/` 키가 없다.
- **AC-X01** [자동] 1 · 1A · 1B · 1C · 2a · 3단계 자동 검사가 모두 통과한다.

## 13. 테스트 방법
- **가짜 AI**: 지금의 가짜 Anthropic 스트림 · 가짜 HTTP(OpenAI · Google) · Python 가짜 워커. 설명 JSON · 번역 JSON을 돌려주는 고정 응답, 묶음 n번째에 오류를 내는 주입.
- **가짜 SVG**: `tests/fixtures/svg/good_*.svg`(3개 — 흐름도 · 비교표 · 계층도) · `bad_*.svg`(AC-G01 목록). Python 사전 검사 테스트와 수동 확인(AC-G04 — qa4 브라우저 시험 페이지가 이 파일들을 `renderSvg`로 그려 Chrome · Edge에서 확인)이 같은 파일을 씀. 개발 서버용 가짜 AI 설정은 만들지 않음.
- **가짜 저장소**: `storage.FakeStorage`(호출 기록으로 AC-D02 · D03). 실행기 스레드 수 · 상한 · 묶음 크기는 주입.
- **DB**: 테스트용 Supabase(1단계 10.2절). 가짜 PDF는 쪽 글을 직접 넣은 `page_texts`.
- **화면 순수 함수**: `tests/js/explain.test.mjs`(색 바꾸기 · `url(#)` 거르기 · 크기 검사 · `rects` → 경계 상자 · 쪽 상태 → 문구) + `tests/test_js_node.py` 한 줄. DOMPurify 동작은 Node에 DOM이 없어 수동(AC-G04)으로.
- 파일: `tests/test_explain.py`(프롬프트 · 검사 · 사전 검사 · 묶음 · 참고문헌 · 쪽 상태 · 추정 — DB 없음), `tests/test_explain_api.py`(`[db]`).

## 14. 수동 확인 (배포 뒤)
- M-1 실제 논문 3편(영어 2 · 한국어 1)에서 문장 · 수식이 섞인 문단 · 표 조각을 설명 5번 — 쉬운 설명이 납득되는지, 그림이 필요할 때만 나오는지, 그림이 겹치지 않는지.
- M-2 실제 20쪽 논문 전체 번역(AC-P15) — 용어 병기 · 수식 · 인용 번호 유지, 참고문헌 감지, 원고로 만들기 → 워드 내보내기.
- M-3 PC 앱만 연결된 계정(키 없음)으로 선택 설명 · 전체 번역 — 상태 줄 · 대기 · 이어받기.
- M-4 브라우저 개발자 도구로 AC-G04 반복(Chrome · Edge).

## 15. 위험
| 위험 | 대응 |
|---|---|
| AI가 만든 SVG를 통한 XSS · 추적 | 서버 사전 검사 + DOMPurify SVG 프로필 + **이미지(blob) 격리** + CSP `img-src`, AC-G01~G06 |
| 전체 번역 요금이 예상보다 큼 | 시작 전 예상 표시 · 확인, 참고문헌 기본 제외, 쪽 범위, 100쪽 상한, 취소해도 끝난 쪽 유지, AC-P15 실측 |
| 긴 번역이 서버 실행기를 오래 잡음 | 잡기 한 번 = 묶음 하나, 묶음마다 대기열 뒤로(AC-P12), 사용자당 동시 2 |
| 번역 파일에 RLS가 없음 | 키는 RLS 질의로만, fullmatch, 서명 주소 없음, AC-D02 · D03 |
| `page_texts`의 수식 · 표 깨짐 | 프롬프트에서 원문 유지 · 추측 복원 금지, 원문 PDF가 바로 옆 |
| 한국어 토큰 효율 가정이 틀림 | AC-P15 실측으로 9장 상수를 고침(2026-10-13). 한계(논문 1편 · CLI만)는 9.1절 — 다른 경로 · 언어는 후속 실측 |
| 저작권 | 번역본은 본인 계정에만(공유 · 공용 캐시 없음), 원고 머리에 "AI 번역" 표시 |

### 수용한 위험 (팀장 승인 2026-10-13 — 고치지 않고 알고 감)
| 위험 | 내용 · 사용자에게 보이는 모습 |
|---|---|
| **L-3** 번역 실행 중 PDF 교체 | 진행 중 작업은 다음 반영 때 `cancelled`(PDF가 바뀌어 번역을 멈췄어요)로 끝나므로, 새 PDF를 번역하려면 **[번역 시작]을 한 번 더** 눌러야 함(자동으로 이어 가지 않음) |
| 교체 직후 빈 쪽 | PDF를 바꾼 직후 번역 보기가 **잠깐 빈 쪽으로 보일 수 있음**(서버가 번역 행을 지운 뒤 화면이 다시 읽어 오기 전까지) |
| `Ontology=` 오탐 | 그림 속 글자가 서버 금지 패턴과 우연히 같으면 정상 그림도 빠짐(7.2절). 설명 글은 저장, [다시 만들기]로 재시도 |

---

## 16. 결정 · 미정

### 16.1 사용자 결정 (확정 2026-10-13)
| # | 질문 | 결정 |
|---|---|---|
| **U-1** | PLAN 6장 4단계 범위에 있던 **영역 캡처(그림 · 수식을 사각형으로 잘라 설명)** 와 **codex 이미지 생성**을 이번 4단계에서 빼고 나중에 해도 될까요? | **확정(2026-10-13): 이번에 빼고 4단계 이후 후속으로.** 4단계는 드래그한 글 설명 · 그림(SVG) · 번역만. PLAN 6장에 "4단계 이후 후속"으로 옮겨 적음 |

### 16.2 팀장 결정 — **확정(2026-10-13), K-1~K-14 모두 기획팀 추천안대로**
| # | 항목 | 추천 |
|---|---|---|
| K-1 | 결과 위치 | 읽기 화면 오른쪽 패널 새 탭 **"설명·번역"**(선택 기록 / 전체 번역 전환). 팝오버 안 씀(그림 폭 · 기록 보기). 전체 번역은 "PDF 왼쪽 · 번역 오른쪽, 지금 쪽 따라가기" |
| K-2 | SVG 표시 | 서버 사전 검사 + **DOMPurify SVG 프로필 + `<img src="blob:">` 격리**. 대안(인라인 + id 접두어 · class 금지 훅)은 앱 DOM과 섞여 검사할 것이 많아 기각 |
| K-3 | SVG 상한 | 원문 24KB · 요소 1,500 · `viewBox` 필수(폭 · 높이 0 초과 4,000 이하) · 표시 최대 높이 480px |
| K-4 | 선택 결과 저장 | DB `explanations` = 기록 겸 캐시, 키 `(논문, 종류, 언어, 정규화 글 해시)`, **사용자당 300개** |
| K-5 | 전체 번역 저장 | **R2 JSON 파일 하나** + DB `translations` 메타(`page_state` 한 줄). DB 안(쪽별 행)은 500MB 원칙상 기각 |
| K-6 | 전체 번역 실행 | 작업 하나, **잡기 한 번 = 묶음 하나(최대 3쪽 · 9,000자)**, API · CLI 같은 방식, 묶음마다 대기열 뒤로. 묶음 병렬 없음(PLAN "쪽 단위 병렬"·"병렬 수" 미정을 이것으로 닫음) |
| K-7 | 기한 · 시간 제한 | `explain` · `translate` 30분 · 600초, `translate_paper` 24시간(U7) · 묶음당 900초 · 묶음마다 기한 다시 셈. U7의 "번역 24시간"은 전체 번역으로 해석(사용자 이견 시 변경) |
| K-8 | 건너뛸 쪽 | 글 20자 미만, 이미 대상 언어(한국어는 한글 50% 기준), **참고문헌 이후 기본 제외**(포함 선택 가능) |
| K-9 | 언어 | 번역 = 새 설정 `translate_language`(ko · en · ja · zh, 기본 ko), 쉬운 설명 = 기존 "AI 답변 언어" |
| K-10 | 엔진 설정 | 작업별 엔진 두 줄 `explain` · `translate`(선택 · 전체 공용), 기본 `[claude]`. 2단계 9.1의 4단계 예시값 폐기 |
| K-11 | PDF 교체 | 전체 번역은 지움, 선택 기록은 남김 |
| K-12 | 원고 저장 | PLAN의 "결과는 원고로 저장"을 **[원고로 만들기] 버튼**(서버가 R2 파일로 생성)으로 바꿈 — 읽기는 패널, 문서가 필요할 때만 원고 |
| K-13 | 비용 확인 | 시작 창에 예상 쪽 · 토큰 · 시간 · 요금 안내, 한 번에 100쪽 상한, 쪽 범위 |
| K-14 | 상자 버튼 | 선택 상자 · 하이라이트 상자 둘 다, 참고 패널(1C)에는 없음 |

### 16.3 확인 필요 (개발팀 첫 주)
1. ~~Claude · OpenAI · Gemini에서 한국어 번역 출력 토큰 비율~~ — Claude CLI는 AC-P15로 실측(9.1절, 1.6배). **OpenAI · Gemini · API 경로는 미확인(후속).**
2. `complete()`의 JSON 스키마 출력에 SVG 문자열(따옴표 · 줄바꿈 이스케이프)이 깨지지 않는지 세 경로 · CLI.
3. 묶음 3쪽 · 9,000자에서 출력이 `max_tokens` 16,000에 닿는 경우가 있는지.
4. 브라우저가 blob SVG 이미지에서 `<image>` · `url()` 바깥 자원을 정말 부르지 않는지(Chrome · Edge — AC-G04).

## 17. 작업 목록 (파일 단위 — 디자인 · 개발이 같은 파일을 동시에 고치지 않음)

### 디자인팀 (먼저)
- `docs/design/phase4-explain-translate-ui.md`(신규): 상자 버튼 두 개, "설명·번역" 탭 · 전환, 설명 · 번역 카드 · 진행 · 실패 · 캐시 표시, 그림 틀 · 실패 문구, 전체 번역 시작 창(언어 · 범위 · 참고문헌 · 예상) · 진행 · 쪽 보기 · 쪽 상태 문구 6종 · 아래 버튼 줄, 설정 두 줄 · 언어 선택, 작업 이름표, CSS 클래스.
- `paperlab/static/css/app.css`.

### 개발팀
| 파일 | 할 일 |
|---|---|
| `supabase/migrations/20261013000001_explain_translate.sql`(신규) | 8.1절 |
| `paperlab/explain.py`(신규) | 설명 · 선택 번역 프롬프트 · `EXPLAIN_SCHEMA` · 결과 검사 · `check_svg`(7.2절) · `sel_hash` · 카드 모양 (한글 비율은 `translate.py`에서 가져다 씀) |
| `paperlab/translate.py`(신규) | `LANGS`(= `config.TRANSLATE_LANGS`) · `hangul_ratio` · 쪽 상태 · 참고문헌 감지 · 묶음 · 프롬프트 · `TRANSLATE_SCHEMA` · 결과 검사 · 파일 읽기 · 쓰기 · 추정 · 원고 본문 |
| `paperlab/storage.py` | `translations/` 키 규칙 · `tr_key` · `check_user_key` |
| `paperlab/db.py` | `explanations` 저장(상한) · 목록 · 삭제, `translations` CRUD, `delete_paper` · `set_pdf`가 `tr_key` 처리 |
| `paperlab/config.py` | `JOB_KINDS`에 `explain` · `translate`, `translate_language` 기본 · 검사 |
| `paperlab/jobs.py` | 새 종류 기한 · 시간 제한, `text_request` · `cli_task`(묶음 정하기) · `parse_result` · `_apply`, `translate_next`, `clean_progress` 키 |
| `paperlab/api_runner.py` | `explain`/`translate` 폴백 뒤 실행, `translate_paper` 묶음 하나 실행 · 대기열 뒤로 |
| `paperlab/server.py` | 10장 경로, `stream_job` `done.item`, 논문 삭제 · PDF 교체 뒤 파일 정리, 95% 검사 |
| `paperlab/admin.py` | `orphans`에 `translations/` |
| `paperlab/static/js/explain.js`(신규) | "설명·번역" 탭 · 카드 · SSE · 전체 번역 보기(export — 나중에 참고 패널에서 쓸 수 있게) |
| `paperlab/static/js/reader.js` | 상자 버튼 두 개(`R.embed`면 숨김), 탭 등록, `R.currentPage` 알림, `goToSpot` 문구 인자 |
| `paperlab/static/js/ui.js` | `SVG_PURIFY` · `renderSvg` · 순수 함수(`svgColor` · `svgUrlOk` · `svgViewBoxOk` · `svgCountOk`) · `MD_PURIFY` 강화(7.4절) |
| `paperlab/static/js/dialogs.js` · `jobs.js` | 작업별 엔진 두 줄 · 번역 언어, 이름표 · 열기 주소 |
| `tests/test_explain.py` · `tests/test_explain_api.py` · `tests/js/explain.test.mjs` · `tests/fixtures/svg/`(신규), `tests/test_js_node.py` | 12 · 13장 |

### 품질팀
- 12장 `[자동]` · `[db]` 전부, `[수동]` AC-E09 · G04 · G05 · P14, `[실환경]` AC-P15, 14장 수동 확인.

### 기획팀 (결정 뒤 · 구현 뒤)
- PLAN.md 6장 4단계(U-1 · K-6 · K-12 반영, 명세 링크) · 10장, 2단계 명세 9.1절 4단계 줄, 1단계 명세 7장 R2 키 규칙에 `translations/`, `FEATURES.md` 5 · 6 · 10 · 11장.

## 18. 변경 기록
- 2026-10-13 초안(기획팀).
- 2026-10-13 확정: 사용자 U-1(영역 캡처 · codex 이미지 생성은 4단계 이후 후속), 팀장 K-1~K-14 추천안대로 확정. PLAN.md 6장 4단계 절 반영.
- 2026-10-13 구현 차이 반영(기획팀, 팀장 승인분 — `explain.py` · `translate.py` · `ui.js` · `explain.js` · `server.py` 실제 코드와 대조): SVG 지시값 400 × H ≤ 600 · 글자 12~14px, 서버 상한 4,000 유지(6.4) / 서버 사전 검사 풀기 → 접두어 제거 → 전역 금지 패턴 + 루트 모양, `Ontology=` 오탐 수용(7.2) / 마크다운 정화 7.4절 신설(H-1 · L-2) / blob 즉시 revoke · `svgCountOk`(7.3) / 묶음 수 표 20쪽 9묶음 · 약 9분(9) / 취소는 진행 묶음 뒤(5.3 · 6.3) / 409 확인 문구는 서버 `detail`(6.3) / 한글 비율 `translate.py`(6.3 · 17) / interactive 작업은 탭 목록에서 제외(5.3) / R2 번역 파일 쓸 때마다 새 세대 키 + 조건부 포인터 교체(6.3 · 8.2) / [다른 언어로 번역…](5.3) / `refs_from` 다시 계산(6.3) / 언어 목록 서버 단일 정의(6.4) / 수용 위험 L-3 등(15장) / AC-G07 · G08 · S02 추가.
- 2026-10-13 승인자 조건 반영(팀장): `MD_PURIFY` 금지 태그에 `dialog`, 금지 속성에 `popover` 계열 추가(C-2, 7.4 · AC-G07) / AC-G04 수동 확인 방식을 qa4 시험 페이지로 정정(C-3, 13장) / 9장 50쪽 행 22묶음으로 정정.
- 2026-10-13 AC-P15 실측 반영(기획팀, 팀장 결정 — 코드 `translate.EST`는 이미 반영): 9장 상수를 `chars_per_token` 3.25 · `out_ratio` 1.6 · `chunk_overhead` 1,800 · `tokens_per_s` 110으로 고쳐 20쪽 행(입력 약 3.5만 · 출력 약 2.9만 · 약 6분) · 50쪽 행(약 8.7만 · 7.6만 · 약 14분) · 요금 예시($0.90 · $2.33) 다시 계산 / 9.1절 실측 결과 표 · 회귀식 · 한계(논문 1편 · CLI만 · API 고정분 미확인) · 낮음 후속(1쪽 제목이 `###`이 아닌 `#`로 나옴) 신설 / AC-P15 "실측 완료", AC-P02 `minutes` 9 → 6 / 5.3절 예상 예시 · 15장 · 16.3절 1번 문구 정리.
