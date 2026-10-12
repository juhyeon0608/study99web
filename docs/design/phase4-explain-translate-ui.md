# 화면 시안 — 쉬운 설명 · 번역(선택 · 전체) (4단계)

- 작성: 디자인팀 · 2026-10-13 (HEAD 362b7f0)
- 근거: [기능 명세](../specs/phase4-explain-translate.md) 3 · 5장(흐름), 6.3절(쪽 상태), 7장(SVG), 9장(예상), 10장(`item` 모양), 16장(U-1 · K-1~K-14)
- 범위: U-1에 따라 **영역 캡처 · codex 이미지는 없음**. 드래그한 글의 설명 · 그림(SVG) · 번역, 전체 번역만.
- 재사용: 읽기 화면 `.sel-pop` · `.ann-pop` · 패널 `.tabs`, 하이라이트 카드 `.ann-item`, `.seg`, `.chip`, `.notice`, 2단계 상태 줄(`statusLineEl` · `setStatusLine`), `.progress`, `.prose`(`renderMarkdown`), `.ai-cta`, `.kv`, `modal()` · `confirmDialog()` · `popupMenu()`, `.page-link`, `.sr-only`
- 스타일: `paperlab/static/css/app.css` 맨 끝 **"4단계 쉬운 설명 · 번역"** 구역 38줄(1531 → 1569줄). 그 위 1531줄은 바이트 단위로 그대로(CRLF 유지).
- **새 클래스 4개뿐**: `.xt-figure` · `.xt-head` · `.xt-range` · `.panel-sheet`. 나머지는 기존 클래스 + `data-*` 속성 선택자.
- 선택 글 · 설명 · 번역문은 `esc()` · `textContent` · `renderMarkdown`으로만. **SVG 문자열은 어떤 경우에도 `innerHTML`로 넣지 않음**(명세 7.3).

---

## 0. 개발팀용 클래스 · data 속성

### 0.1 읽기 화면 상자 (`reader.js`, K-14)

| 이름 | 뜻 |
|---|---|
| `.sel-pop > button.btn.sm.ghost[data-explain]` "쉽게 설명" · `[data-translate]` "번역" | [AI에게 묻기] 바로 뒤, [복사] 앞. `R.embed`(1C 참고 패널)이면 그리지 않음(`data-ask`와 같은 조건) |
| `.ann-pop > div.row[data-ai-row]` > [AI에게 묻기] [쉽게 설명] [번역] | 하이라이트 상자: 290px 첫 줄에 다 안 들어가서 **AI 버튼 세 개를 둘째 줄로**(색 줄 아래, 인용문 위). 첫 줄은 색만 |
| `button[data-explain｜data-translate][aria-disabled="true"][title="앞의 요청이 끝나면 할 수 있어요"]` | 진행 중(한 읽기 화면에 하나). `disabled` 대신 `aria-disabled` — 초점 · 툴팁이 남음. 누르면 같은 글을 `toast` |
| `.sel-pop` 줄바꿈 | 좁은 화면에서 버튼이 넘치면 둘째 줄로(CSS `flex-wrap`, 최대 `100vw - 16px`) |

### 0.2 패널 탭 · 틀 (`explain.js` 신규, K-1)

| 이름 | 뜻 |
|---|---|
| `.panel .tabs > button[data-tab="explain"]` "설명·번역" | **[질문하기] 바로 뒤**(AI 탭끼리 모음): AI 요약 · 질문하기 · **설명·번역** · 하이라이트 · 노트 · 정보·인용 |
| `.panel-body > div.row > div.seg[role=group][aria-label="보기"] > button[data-xt-view="history｜paper"][aria-pressed]` (+`active`) | [선택 기록 \| 전체 번역] 전환. 마지막 선택을 `savePrefs({ xtView })` |
| `div.sr-only[role=status][data-xt-live]` | 화면 읽기 알림(늘 빈 채로 그려 둠, 8장) |

### 0.3 선택 기록 카드

| 이름 | 뜻 |
|---|---|
| `ol[aria-label="설명·번역 기록"] > li.ann-item[data-kind="explain｜translate"][data-xt-id]` | 카드 하나. 왼쪽 줄: 설명 `--accent`, 번역 `--border-strong` |
| `li[data-state="running"][aria-busy="true"]` · `li[data-state="failed"]` | 진행 · 실패(저장 안 된 임시 카드, 맨 위) |
| `li > div.foot`(첫 줄) | 머리: `span.chip.accent` "쉬운 설명" 또는 `span.chip` "번역 · 한국어" · `button.page-link` p.N · 날짜 · (캐시면) `span.chip` "저장된 결과" |
| `li > div.q` | 원문 앞 120자 “…” (`.ann-item[data-kind] .q`는 누르는 곳이 아님 — [원문 위치] 버튼으로) |
| 설명: `div.prose > p > strong`(한 줄) + `p`(쉬운 설명) → `details > summary` "자세한 설명" `> div.prose` → `figure.xt-figure` | 4장 |
| 번역: `div.prose[lang="{lang}"]` | 번역문 |
| `li > div.foot`(끝 줄) > `[data-xt-goto]` 원문 위치 · `[data-xt-memo]` 메모로 남기기 · `[data-xt-copy]` 복사 · spacer · `button.icon-btn.small[data-xt-more][aria-haspopup=menu][aria-label="더 보기: 다시 만들기 · 지우기"]` ⋯ | ⋯ → `popupMenu`: "다시 만들기"(`data-xt-redo`, 힌트 "요금이 다시 나가요") · "지우기"(`data-xt-del`, 빨강). 5개를 한 줄에 두면 380px 패널에서 줄이 넘쳐 메뉴로 묶음 |
| 진행 카드 안 `div.status-line[data-job-line]` | `statusLineEl(onCancel)` + `setStatusLine(job, "설명"｜"번역")` 그대로 |

### 0.4 전체 번역

| 이름 | 뜻 |
|---|---|
| `div.ai-cta` > h3 + p + `button.btn.primary[data-xt-start]` "전체 번역 시작…" | 번역 없음(5.1절) |
| `div.row.small.muted` + `div.chips > span.chip[data-page-state="d｜-｜f｜s｜r"]` | 언어 · "17쪽 중 12쪽 완료" + 개수 칩: 완료(`.success`) · 대기 · 실패(`.warn`) · 건너뜀 · 참고문헌 제외. 0개인 칩은 그리지 않음 |
| `div.status-line[data-job-line]` + `[data-job-cancel]` | 진행 · 대기 · 폴백 · 실패 한 줄(2단계 문구 + " · 12/17쪽") |
| `div.progress[role=progressbar][aria-valuemin=0][aria-valuemax={total}][aria-valuenow={done}][aria-valuetext="17쪽 중 12쪽"]` | 진행 막대(작업이 있을 때만) |
| `div.notice[data-tone=info][data-keep-open]` | 진행 중 한 번: "탭을 닫아도 계속돼요. 끝난 쪽부터 바로 읽을 수 있어요." |
| `div.xt-head` > `h3 > button.page-link[data-goto]`p.12 + " 번역" · `button.icon-btn[data-xt-prev｜data-xt-next][aria-label="이전 쪽 번역"｜"다음 쪽 번역"]` · `button.btn.sm.ghost[data-xt-follow][aria-pressed]` "따라가기" | 쪽 머리. 패널 위에 붙음(sticky) |
| `div.prose[lang][data-xt-page="{n}"]` | 그 쪽 번역문, 또는 6.2절 상태 안내 |
| 아래 줄 `div.row` > `[data-xt-retry="failed"]` 실패한 쪽 다시 (n) · `[data-xt-continue]` 이어서 번역 · `[data-xt-manuscript]` 원고로 만들기 · spacer · `button.btn.sm.ghost.danger[data-xt-delete]` 번역 지우기 | 6.3절 표시 조건 |
| 시작 창 `form#xt-start-form` > `select.input#xt-lang` · `div.xt-range[role=group]` > `input.input[type=number]`×2 · `input[type=checkbox][data-xt-refs]` · `dl.kv[data-xt-est]` · `div.notice[data-tone=warn][data-xt-start-error]` | 5.2절 |

### 0.5 좁은 화면

| 이름 | 뜻 |
|---|---|
| `section.reader.panel-sheet` | 900px 이하에서만 뜻이 있음: 패널을 화면 아래 75vh 시트로 엶(AD-1). [쉽게 설명] · [번역] · ◧가 붙이고, ◧ · Esc가 뗌 |

---

## 1. 공통 원칙
- **결과는 늘 패널에**(K-1): 팝오버 결과 없음. 상자 버튼 → 패널이 닫혀 있으면 열고 "설명·번역" · [선택 기록]으로 → 맨 위 진행 카드.
- **비용이 드는 일은 누르기 전에 알림**: 전체 번역은 시작 창(예상), [다시 만들기]는 메뉴 힌트 "요금이 다시 나가요". 선택 설명 · 번역 1회는 작아 확인 없음.
- **실패는 사유와 함께, 결과는 지우지 않음**: 그림만 실패하면 설명 글은 그대로, 쪽만 실패하면 다른 쪽은 그대로.
- 문구는 '~해요'체, 버튼은 동사형 짧게. 색만으로 구분하지 않음(칩 글자 · 상태 문구 함께).

## 2. 선택 상자 (K-14)

```
읽기 화면 선택:   [● ● ● ● ●] | [메모] [AI에게 묻기] [쉽게 설명] [번역] [복사]
하이라이트 상자:  [● ● ● ● ●]
                  [AI에게 묻기] [쉽게 설명] [번역]
                  “The attention function maps …”
                  [메모 칸                          ]
                  [삭제]                  [복사] [저장]
```
- 누르면: 선택 해제 · 상자 닫기 → 패널 열기(`panel-closed` 해제, 900px 이하면 `panel-sheet`) → 탭 · 보기 전환 → 맨 위 진행 카드. **초점은 옮기지 않음**(PDF 읽기 흐름 유지), 대신 `[data-xt-live]` "쉬운 설명을 만들고 있어요".
- 보내기 전 화면 검사(서버 400을 줄이려고): 공백 정리 뒤 2자 미만은 버튼을 숨기지 않고 무시, **4,000자 초과**면 `toast` "4,000자까지 설명할 수 있어요. 조금 줄여서 골라 주세요". 서버 400("이미 한국어예요", 경로 없음 등)은 카드를 만들지 않고 `errorToast`.

## 3. "설명·번역" 탭 — 선택 기록

```
[선택 기록 | 전체 번역]
┃ (번역 · 한국어) p.5 10월 13일
┃ “The attention function maps a query and …”
┃ ( ◌ Anthropic API로 번역 중이에요                [취소] )
┃ 어텐션 함수는 쿼리(query)와 키-값(key-value) 쌍의 …      ← 글이 흘러나옴
┃ (쉬운 설명) p.5 10월 13일 (저장된 결과)
┃ “The attention function …”
┃ **어텐션은 문장 속 단어끼리 얼마나 관련 있는지 재는 방법이에요.**
┃ 도서관 사서에게 질문(쿼리)을 하면 …
┃ ▸ 자세한 설명
┃ ┌ [개념 그림] ───────────────┐
┃ └ AI가 그린 개념 그림이라 틀릴 수 있어요 ┘
┃ 원문 위치  메모로 남기기  복사                  ⋯
최근 300개까지 보관해요.
```

### 3.1 카드 상태
| 경우 | 모양 · 문구 |
|---|---|
| 진행(설명) | 머리 + 원문 + 상태 줄(2단계 문구: "Anthropic API로 실행 중이에요" · "PC의 claude를 기다리는 중이에요" · 폴백 문구) + [취소]. 글 자리는 비움 |
| 진행(번역) | 위 + 상태 줄 아래 `.prose[aria-busy=true]`에 `delta`를 이어 붙임(첫 글자 전엔 `.typing`) |
| 끝 | 진행 카드를 그 자리에서 완성 카드로 바꿈. 알림 "쉬운 설명을 다 썼어요" / "번역을 다 썼어요" |
| 캐시(`cached: true`) | 진행 카드 없이 바로 완성 카드(기존 카드가 목록에 있으면 맨 위로 옮기고 1.5초 `--accent-soft` 바탕) + 머리 칩 "저장된 결과". 알림 "저장된 설명을 보여 드려요" |
| 실패 | `li[data-state=failed]` 머리 + 원문 + `.notice[data-tone=danger]` "**설명을 만들지 못했어요.** {errorLabel}" / "**번역하지 못했어요.** …" + [닫기] [다시 시도](primary). 저장 안 됨 — 새로 고치면 사라짐 |
| 취소 · 끊김(`interrupted`) | 진행 카드 제거 + `toast` "취소했어요" |
| CLI로 넘어감 · 탭 떠남 | 다시 열면 `GET …/explanations`의 진행 중 작업으로 진행 카드를 다시 그림(2단계 규칙) |
| 기록 0개 | `.ai-cta` h3 "아직 설명·번역이 없어요" / p.small "PDF에서 문장을 드래그하고 [쉽게 설명]이나 [번역]을 눌러 보세요." |

### 3.2 버튼
| 버튼 | 동작 · 문구 |
|---|---|
| [원문 위치] · 머리 `p.N` | `goToSpot(page, rect, source_text)` — 알림 "p.5의 원문 위치를 표시했어요". `rect`가 없으면 쪽 이동만 |
| [메모로 남기기] | 노랑 하이라이트 + 메모(설명 = 한 줄 + 쉬운 설명, 번역 = 번역문) → `toast` "노랑 하이라이트와 메모로 남겼어요". 그 뒤 버튼은 "메모로 남김 ✓" `aria-disabled`(같은 카드에서 중복 방지, 다시 열면 원래대로). `rects`가 비면 숨김 |
| [복사] | 설명 = "한 줄\n\n쉬운 설명\n\n자세한 설명", 번역 = 번역문 → `toast` "복사했어요" |
| ⋯ > 다시 만들기 | `force: true`. 그 카드가 그 자리에서 진행 상태로(새 카드 만들지 않음) |
| ⋯ > 지우기 | 확인 없이 지움(하이라이트 삭제와 같음) → 초점은 다음 카드의 [원문 위치], 없으면 [선택 기록] 버튼. 알림 "지웠어요" |

## 4. 개념 그림 (`ui.renderSvg` → `figure.xt-figure`)

| `data-state` | 안 | 문구 |
|---|---|---|
| `ok` | `img[src="blob:…"][alt="{one_line}"]` + `figcaption` | "AI가 그린 개념 그림이라 틀릴 수 있어요" |
| `failed`(`renderSvg` → `null`, `img.onerror`) | 글만, 점선 테두리, `role=note` | "그림을 그리지 못했어요 — 설명 글은 위에 그대로 있어요." |
| `svg_note="unsafe"` | 같음 | "그림이 안전 검사를 통과하지 못해 빼었어요." |
| `svg_note="too_large"` | 같음 | "그림이 너무 커서 빼었어요." |
| `svg=""` · `svg_note` 없음 | **그리지 않음**(AI가 그림이 필요 없다고 판단) | — |

- 바탕은 카드와 같은 `--surface`, 1px 테두리 · 8px 둥글림 · 안쪽 10px. 이미지 폭 100%, **최대 높이 480px**(`object-fit: contain`, K-3).
- 색은 그릴 때의 테마 계산값(`currentColor` → `--text`, `var(--…)` → `--accent-text` — 두 테마에서 바탕 대비 AA). **테마를 바꾸면 다시 그림**(blob URL 새로 만들고 옛것 `revokeObjectURL`).
- `img`라서 그림 속 글자는 화면 읽기가 못 읽음 → `alt`는 한 줄 요약(그 아래 쉬운 설명이 같은 내용을 글로 줌).
- 그림 글자 크기 문제와 크게 보기는 AD-2.

## 5. 전체 번역 (K-1 · K-5 · K-13)

### 5.1 번역 없음
`.ai-cta`: h3 "이 논문을 통째로 번역해요" / p.small "끝난 쪽부터 PDF 옆에서 바로 읽을 수 있어요. 시작 전에 쪽 수와 예상 비용을 보여 드려요." / [전체 번역 시작…]. PDF가 없거나 쪽 글이 없으면 버튼 `aria-disabled` + p "PDF 글자를 읽을 수 없는 논문이에요(스캔본)."

### 5.2 시작 창 (`modal()`, 제목 "전체 번역 시작")
```
번역할 언어   [한국어 ▾]           설정의 ‘번역 언어’가 기본이에요.
쪽 범위       [ 1 ] ~ [ 20 ] / 전체 20쪽   한 번에 100쪽까지 번역할 수 있어요.
[ ] 참고문헌 이후(p.18~20)도 번역   참고문헌은 보통 번역할 필요가 없어 기본으로 빼요.
예상 (대략)
  번역할 쪽  17쪽 (참고문헌 이후 3쪽 제외)
  토큰       입력 약 2만 · 출력 약 2.3만
  시간       약 8분
  실행       Anthropic API 키 — 쓰는 만큼 키 계정에 요금이 나가요
[ⓘ 탭을 닫아도 계속돼요. 끝난 쪽부터 바로 읽을 수 있고, 취소해도 끝난 쪽은 남아요.]
                                         [취소] [번역 시작 (17쪽)]
```
- 참고문헌을 못 찾음(`refs_from` 없음): 체크 상자 대신 hint "참고문헌 제목을 찾지 못해 모든 쪽을 번역해요."
- 실행 줄: API = "{회사} API 키 — 쓰는 만큼 키 계정에 요금이 나가요" / CLI = "‘{PC 이름}’의 claude 구독으로 실행 — 구독 사용 한도를 써요. PC가 꺼져 있으면 24시간까지 기다려요."
- 범위 · 언어 · 참고문헌을 바꾸면 예상 · 버튼 글자("번역 시작 (N쪽)")를 바로 다시 셈(AD-3). 0쪽이면 버튼 `disabled` + 예상 자리 "번역할 쪽이 없어요".
- 시작 오류(400)는 창을 닫지 않고 `[data-xt-start-error]`에 서버 문구(100쪽 초과 · 저장 공간 95% · 경로 없음 + [설정 열기]).
- 다른 언어 번역이 이미 있음(409): `confirmDialog` "기존 영어 번역을 지우고 한국어로 새로 번역할까요?" ok "지우고 새로 번역"(danger) → `replace: true`.
- Enter = [번역 시작](form submit), Esc = 닫기(기존 `modal`). 처음 초점은 언어 선택 상자.

### 5.3 진행 · 읽기
```
[선택 기록 | 전체 번역]
한국어 번역 · 17쪽 중 12쪽 완료  (완료 12) (대기 4) (실패 1) (건너뜀 3)
( ◌ Anthropic API로 번역 중이에요 · 12/17쪽                 [취소] )
[■■■■■■■■■■■■□□□□□]
──────────────────────────────────────────── ← 여기부터 sticky
 p.12 번역  ◀ ▶                               [따라가기]
──────────────────────────────────────────────
### 3.2 어텐션
어텐션 함수는 쿼리(query)와 키-값(key-value) 쌍의 …
──────────────────────────────────────────────
[실패한 쪽 다시 (1)] [이어서 번역] [원고로 만들기]        [번역 지우기]
```
- **따라가기 켬(기본)**: `R.currentPage`가 바뀌고 300ms 멈추면 그 쪽으로. ◀ ▶는 **PDF도 함께** 넘김(`gotoPage`) — 둘이 늘 같은 쪽. **끔**: ◀ ▶는 패널만 넘김, 머리 `p.N`을 누르면 PDF가 그 쪽으로. 켬/끔은 `aria-pressed` + 켬일 때 `--accent-soft` 바탕.
- 쪽이 바뀌면 `.panel-body`를 그 쪽 머리(`.xt-head`) 위치로 스크롤(맨 위가 아니라 머리 — 진행 줄이 계속 보이게).
- 진행 중 끝난 쪽은 바로 보임. 지금 보는 쪽이 방금 끝나면 그 자리에서 글로 바뀜(스크롤 유지).
- 작업 끝: 상태 줄 · 막대 · 안내를 지우고 알림 "전체 번역을 마쳤어요. 17쪽 중 16쪽 완료, 1쪽 실패".
- 작업 실패(경로 다 씀 · 24시간 지남 · PDF 교체): 상태 줄 `failed` + 2단계 문구(PDF 교체는 "PDF가 바뀌어 번역을 멈췄어요") — 끝난 쪽은 그대로 읽힘.
- 번역 파일이 맞지 않음(서버 오류): `.notice[data-tone=danger]` "번역 파일이 맞지 않아요 — 번역을 지우고 다시 해 주세요." + [번역 지우기].

### 5.4 쪽 상태 문구 (`page_state` 한 글자 → 순수 함수, Node 테스트)
| 글자 | 모양 | 문구 · 버튼 |
|---|---|---|
| `d` | `.prose` | 번역문(`renderMarkdown`, 수식 KaTeX) |
| `-` 작업 있음 | `p.small.muted` + `.typing` | "아직 번역 전이에요. 차례가 오면 바로 보여 드려요." |
| `-` 작업 없음 | `.notice` | "아직 번역 전이에요." + [이어서 번역] |
| `f` | `.notice[data-tone=warn]` | "**이 쪽은 번역하지 못했어요.** {errorLabel(page_errors[n])}" + [이 쪽 다시](`continue {pages:[n]}`) |
| `s` | `.notice` | "글자가 거의 없거나 이미 {언어}인 쪽이라 건너뛰었어요." (AD-4) |
| `r` | `.notice` | "참고문헌 이후 쪽이라 번역하지 않았어요." + [포함해 번역](`include_refs` 켜고 이어서) |
| `.` | `.notice` | "번역 범위 밖이에요 (p.3~5만 번역했어요)." + [이 쪽도 번역](`continue {pages:[n]}`) |
- 참고문헌 첫 쪽(`refs_from`)은 `d`로 제목 앞까지 번역됨 — 글 끝에 `p.small.muted` "이 아래는 참고문헌이라 번역하지 않았어요."

### 5.5 아래 버튼 줄 (진행 중 작업이 있으면 앞의 둘은 숨김)
| 버튼 | 보일 때 | 동작 |
|---|---|---|
| [실패한 쪽 다시 (n)] | `f` ≥ 1 | `continue {pages:"failed"}` |
| [이어서 번역] | `-` ≥ 1 | `continue {pages:"pending"}` |
| [원고로 만들기] | `d` ≥ 1 | 버튼 `aria-busy` + `span.spinner` "만드는 중…" → 끝나면 버튼 옆 `a.btn.sm[href="#/write/{id}"]` "원고 열기 →" + `toast` "원고 ‘[번역] {제목}’을 만들었어요" |
| [번역 지우기] | 늘 | `confirmDialog` "이 논문의 한국어 번역을 지울까요? 원고로 만든 글은 남아요." ok "번역 지우기"(danger) → 5.1절로 |

## 6. 진행 표시 재사용
- 선택 설명 · 번역: 카드 안 **2단계 상태 줄**(`statusLineEl` · `setStatusLine`) — 단계 목록(`.graph-steps`)은 쓰지 않음(단계가 하나라 소음).
- 전체 번역: **상태 줄 + `.progress` 막대 + 칩**. 1B 진행 카드(`.graph-progress-card`)는 덮개(overlay)용이고 2단계 `summaryCard`는 요약 문구가 박혀 있어 쓰지 않음. 쪽 수는 `progress.counts`에서.

## 7. 설정 · 작업 목록

### 7.1 설정 "AI 엔진" (`dialogs.js` `JOB_KINDS`, K-10)
| 줄 | 이름 | 힌트(`.hint`) |
|---|---|---|
| `explain` (신규) | 쉬운 설명 | "읽기 화면에서 고른 글을 쉽게 풀고, 필요하면 개념 그림을 그려요." |
| `translate` (신규) | 번역 (선택 · 전체) | "고른 글 번역과 논문 전체 번역이 함께 써요. 전체 번역은 쪽 수만큼 요금이 나가요." |
- 순서: `verify` 뒤.

### 7.2 번역 언어 (K-9)
- "AI 답변 언어" 칸 바로 아래 `div.field > label[for=set-tr-lang] "번역 언어" + select.input#set-tr-lang[name=translate_language]`: 한국어(`ko`) · English(`en`) · 日本語(`ja`) · 简体中文(`zh`). hint "선택 번역과 전체 번역의 대상 언어예요. 쉬운 설명은 위 ‘AI 답변 언어’로 써요."

### 7.3 작업 목록 (`jobs.js` `KIND_LABEL` · `jobTitle` · `jobHref`)
| `kind` | 이름표 `.chip` | 카드 제목 | 누르면 |
|---|---|---|---|
| `explain` | 쉬운 설명 | 논문 제목(기본 규칙) | `#/read/{pid}` + 탭 "설명·번역" · [선택 기록] |
| `translate` | 선택 번역 | 같음 | 같음 |
| `translate_paper` | 전체 번역 | 같음, 진행 "번역 중 12/17쪽"(`progress.message`) | `#/read/{pid}` + [전체 번역] |
- 탭 지정은 주소가 아니라 화면 메모리(`openTab: "explain", xtView`) — 주소 규칙을 늘리지 않음.

## 8. 좁은 화면 · 다크 · 키보드 · 화면 읽기

### 8.1 너비 (1280 · 1180 · 1000 · 390px 확인)
- 패널 탭 6개: 1180px 초과(패널 440px)는 버튼 안쪽 8px로 한 줄(423px), 1180px 이하(패널 380px)는 6px · 12.5px로 한 줄(약 370px). 그래도 넘치면 가로 스크롤(스크롤 막대 숨김).
- 900px 이하: 기존에는 패널이 아예 숨음 → **`.panel-sheet`로 아래 시트**(AD-1). 시트는 75vh, 위쪽 읽기 막대(◧)는 그대로 보여 닫을 수 있음. 시트 안 여백 14px.
- 390px: 선택 상자는 두 줄, 카드 아래 줄 · 전체 번역 버튼 줄은 줄바꿈, 시작 창은 화면 폭 - 40px. 가로 넘침 없음(`scrollWidth = 390`).

### 8.2 다크
- 새 색 없음: 카드 줄 `--accent` · `--border-strong`, 칩 `.accent` · `.success` · `.warn`, 그림 틀 `--surface` · `--border`. 그림 속 색은 다크 계산값(`--text` #e7e9ee · `--accent-text` #9db5f5)으로 다시 그려 대비 유지.

### 8.3 키보드
| 곳 | 키 |
|---|---|
| 상자 버튼 | 기존과 같음(마우스로 연 상자, Esc로 닫힘) |
| [선택 기록 \| 전체 번역] | Tab · Enter/Space(토글 버튼 두 개, `aria-pressed`) |
| 카드 ⋯ | Enter → `popupMenu`(↑ ↓ · Esc, 기존 도우미) |
| `details` 자세한 설명 | Enter/Space(브라우저 기본) |
| 전체 번역 ◀ ▶ | 버튼. 패널 안에 초점이 있을 때만 `[` `]`로도(PDF 쪽 단축키와 겹치지 않게 — 개발팀 확인) |
| 시트(900px 이하) | **Esc는 먼저 시트를 닫음**(지금 읽기 화면 Esc = 서재로 — `R.onKey`에서 시트가 열려 있으면 닫기만) |
| 초점 테두리 | 패널 탭 · 모든 버튼 2px `--accent`(탭은 이번 CSS에서 추가) |

### 8.4 화면 읽기 (`[data-xt-live]`)
- 알림: "쉬운 설명을 만들고 있어요" · "쉬운 설명을 다 썼어요" · "번역을 다 썼어요" · "저장된 설명을 보여 드려요" · "설명을 만들지 못했어요: {사유}" · "p.12 번역을 보여 드려요"(◀ ▶을 눌렀을 때만 — 따라가기로 바뀔 때는 알리지 않음) · "전체 번역을 마쳤어요. …" · "지웠어요".
- 흐르는 번역 글은 `aria-busy="true"`로 글자마다 읽지 않게, 끝나면 `false`.
- 그림 `alt` = 한 줄 요약, 실패 문구는 `role=note`.
- 진행 막대 `aria-valuetext="17쪽 중 12쪽"`.
- 패널 탭은 기존처럼 `role=tab` 없이 버튼(이번에 바꾸면 다른 탭과 어긋남 — 따로 하려면 다섯 탭 함께).

## 9. 확인 결과 · 남은 것
- 정적 시험 페이지: scratchpad `xt/index.html`(저장소 밖, `?v=history｜paper｜modal｜pop`, `&theme=dark`, `&sheet=1`, `&st=none`, `&pg=f｜r`, `&fig=failed｜unsafe`, `&busy=1`)을 로컬 서버로 띄워 1280 · 1180 · 1000 · 390px × 밝은 · 어두운 테마 확인. 390px 네 화면 가로 넘침 없음, 1180 · 1000px 탭 한 줄(379/379), 1280px `.xt-head` sticky 위치 0px, blob 그림이 두 테마 색으로 그려짐.
- 확인 못 함: 실제 앱(`explain.js` 없음), 실제 PDF 위 `goToSpot`, NVDA 낭독, 실제 AI SVG 품질. 브라우저 창 캡처가 자주 시간 초과돼 일부(390px 모달 · 상자)는 크기 계산값으로만 확인.

## 10. 팀장 결정 (디자인팀 추천안)

| # | 항목 | 추천 | 다른 안 |
|---|---|---|---|
| AD-1 | 900px 이하(패널 숨음)에서 결과를 볼 곳 | `.reader.panel-sheet` 아래 시트 75vh(CSS 반영됨, JS가 클래스만 붙임). ◧도 시트를 엶 — 모바일에서 요약 · 대화도 처음으로 보임 | 900px 이하에서 [쉽게 설명] · [번역]을 숨김(지금 한계 유지) |
| AD-2 | 그림 글자 크기 | **명세 6.4 SVG 규칙을 `viewBox="0 0 400 H"`(H ≤ 600) · 글자 12~14px로** — 패널 폭(약 370px)에서 실제 글자 11~13px. 지금 720 폭이면 7~8px로 너무 작음 | 720 유지 + 그림을 누르면 `modal({wide})`로 크게 보기(같은 blob) |
| AD-3 | 시작 창 예상 다시 셈 | 서버 `estimate`에 쪽별 글자 수(`page_chars`)를 함께 주고 화면이 9장 상수로 다시 셈 | 범위를 바꿀 때마다 `GET …/translation?from&to&include_refs` |
| AD-4 | `s` 쪽 문구 | 한 문구 "글자가 거의 없거나 이미 {언어}인 쪽이라 건너뛰었어요" | 서버가 `page_errors`에 `empty`·`same_lang`을 적고 두 문구로 |
| AD-5 | 카드 [다시 만들기] · [지우기] | ⋯ 메뉴(`popupMenu`)로 묶음 — 380px에서 한 줄 유지, 실수 지우기 줄임 | 버튼 5개를 그대로(두 줄) |
| AD-6 | 하이라이트 상자 AI 버튼 | 둘째 줄 `[data-ai-row]`에 [AI에게 묻기] [쉽게 설명] [번역] | 첫 줄에 넣고 상자 폭 290 → 330px |
| AD-7 | 탭 위치 | [질문하기] 바로 뒤 | 맨 끝(정보·인용 뒤) |
