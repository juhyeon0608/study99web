# 화면 시안 — AI 질문(서재 질문 · AI로 찾기) · 인용 검증 (3단계)

- 작성: 디자인팀 · 2026-10-08 (HEAD 8313733)
- 근거: [기능 명세](../specs/phase3-rag-verify-search.md) 5장(화면 위치 K-3) · 6.2절(모델 없으면 낱말 검색) · 9.4절(첫 로드 지연) · 10장(색인) · 11.4절(출처 → 쪽 · 위치) · 12.4절(검증 표시) · 13장(AI로 찾기) · 14.2절(이름표 · 설정)
- 재사용: [인용 그래프 시안](citation-graph-ui.md)(진행 카드 8.1 · 경고 8.2 · 목록 단추), [참고 패널 시안](writing-reference-pane-ui.md)(`cite-row` 단추 · 근거 쪽 열기), 2단계 작업 카드(`.job-card`) · 상태 줄(`.status-line`) · 알림 상자(`.notice`)
- 스타일: `paperlab/static/css/app.css` 맨 끝 **"3단계 AI 질문 · 인용 검증"** 구역 53줄(1478 → 1531줄). 그 위 1478줄은 바이트 단위로 그대로(CRLF 유지).
- **새 클래스 6개뿐**: `.ask` · `.ask-pane` · `.ask-sources` · `.vd` · `.cite-vd` · `.spot-rect`. 나머지는 모두 기존 클래스.
- 글(질문 · 답 · 제목 · 초록 · 문장 · 이유)은 모두 `esc()` · `textContent`로만. **질문 · 문장은 주소(hash)에 넣지 않음**(AC-L03).

---

## 0. 개발팀용 클래스 · data 속성

### 0.1 `#/ask` 틀 (`ask.js` 신규, `app.js` 경로 · 사이드바)

| 이름 | 뜻 |
|---|---|
| `button.nav-item[data-view="ask"]` | 사이드바 "AI 질문" — `논문 찾기` 바로 아래(아이콘 2.1절) |
| `section.view.ask[aria-labelledby=ask-h]` | 화면 전체. `.view` 재사용 |
| `div.discover-head > h1#ask-h + div.sub + div.tabs` | 머리(논문 찾기 화면과 같은 머리). `.ask`가 탭 줄을 머리 아래 선에 붙임 |
| `div.tabs[role=tablist][aria-label="질문 방식"] > button[role=tab][id=ask-tab-library｜ask-tab-find][aria-selected][aria-controls][tabindex]` (+`active`) | [내 서재에 묻기] [논문 찾기 (AI로 찾기)]. roving tabindex |
| `div.ask-pane[role=tabpanel][data-ask-pane="library｜find"][aria-labelledby]` | 탭 내용. 가운데 880px. `library`는 대화 칸만 스크롤, `find`는 칸 전체 스크롤 |
| `div.sr-only[role=status][data-ask-live]` | 화면 읽기 알림(늘 빈 채로 그려 둠, 9장) |

### 0.2 내 서재 탭

| 이름 | 뜻 |
|---|---|
| `div.discover-filters` | 범위 줄(기존 클래스) |
| `div.seg.seg-radio[role=radiogroup][aria-labelledby=ask-scope-l] > label > input[type=radio][name=ask-scope][value=library｜collection｜folder] + span` | 범위 고르기(기존 `.seg-radio`) |
| `select.input[data-ask-scope-id][aria-label="컬렉션 고르기"｜"폴더 고르기"]` | 컬렉션 · 폴더일 때만. 바꾸면 `#/ask/c{id}` · `#/ask/f{id}` |
| `a.small[data-ask-paper][href="#/read/{id}"]` | "한 논문만: 읽기 화면 대화 →" — 최근 연 논문이 있을 때만(AD-1) |
| `button.btn.sm.ghost[data-ask-clear]` | [대화 지우기] — 기존 확인 창(`confirmDialog`) 거쳐 `DELETE /api/ask` |
| `div.status-line[data-ask-index][data-state="ok｜indexing｜pending｜failed"]` | 색인 상태(3.2절) |
| `div.status-line[data-ask-load]` | 벡터 불러오는 중(3.3절). `loaded: true`면 그리지 않음 |
| `div.notice[data-tone=warn][data-ask-embed]` | `embed: false` — 낱말 검색만(3.2절) |
| `div.chat-log[role=log][aria-label="이 범위의 대화"]` · `div.chat-input` | 읽기 화면 대화와 같은 클래스 |
| `div.msg.assistant[aria-busy] > div.prose` | 답. 스트리밍 중 `aria-busy="true"`, 첫 글자 전엔 `.typing` |
| `.prose button.cite-ref[data-n][aria-label="출처 {n} 보기"]` | 본문 `[n]` → 아래 출처 줄로 초점 이동(이동은 아님) |
| `ol.cite-list[aria-label="출처"] > li > button.cite-item[data-n][title="읽기 화면에서 이 위치 열기"]` | 출처 줄. 안: `span.cite-ref` · `span.page-link`(p.N) · `span > b(제목) · 연도 q(앞 300자)` |
| `button.cite-item.is-flash` | `[n]`을 눌러 초점이 온 줄(1.5초 옅은 파랑) |

### 0.3 논문 찾기 탭

| 이름 | 뜻 |
|---|---|
| `form.discover-bar[role=search][aria-label="AI로 찾기"] > div.searchbox > input.input[name=q][aria-label="찾고 싶은 내용"]` + `button.btn.primary` | 질문 입력(2~1,000자) + [AI로 찾기] |
| `p.small.muted` | 한 줄 설명(5.1절) |
| `div.graph-progress-card.job-card[data-job-state] > .graph-progress-head + ol.graph-steps > li[data-step][data-state] + p.graph-progress-msg + .graph-progress-foot` | 진행(2단계 작업 카드 그대로, 단계 4개) |
| `div.graph-notices` > `div.notice[data-tone=info｜warn]` | "초록 기반 · 24시간" 안내 + 경고 |
| `div.discover-filters > span "쓴 검색어" + div.chips > span.chip` | 쓴 검색어 |
| `div.msg.assistant > div.prose` (+ `button.cite-ref`) | 한국어 요약. `[n]` → 아래 카드로 스크롤 · 초점 |
| `div.section-title#find-src-h` + `ol.ask-sources[aria-labelledby=find-src-h] > li#find-src-{n}` | 출처 논문 목록. `li.is-flash` = 방금 `[n]`으로 온 카드 |
| `li > div.result`(discover `resultCard(it, { n, lite: true })`) | 카드. `.r-title` 맨 앞에 `span.cite-ref[aria-hidden]`{n}(제목 링크의 `aria-label`에 "출처 {n}: " 앞붙임) |

### 0.4 인용 검증 (`writing.js`)

| 이름 | 뜻 |
|---|---|
| `button.btn.sm[data-verify]` | 도구 막대 [인용 검증], [참고] 바로 뒤. 아이콘 2.1절. 작업 중엔 `disabled aria-busy="true"` + `span.spinner` + "검증 중…" |
| `.writer-side > div.section-title#vd-h "인용 검증"` + `div.small[data-verify-box]` | "이 원고의 인용" 아래. 검증한 적 없으면 그리지 않음 |
| `div.notice[data-tone=warn][data-verify-stale]` | 원고가 바뀜(6.4절) |
| `div.status-line[data-verify-job]` | 작업 진행 한 줄(문구는 `jobs.js` 상태 문구 그대로) |
| `div.chips[aria-label="검증 결과 요약"] > span.chip[data-verdict] > span.vd` | 개수 요약 |
| `ol.graph-items[aria-labelledby=vd-h] > li.cite-row[data-verdict][data-method]` | 판정 한 줄(문제 있는 것만, 순서 6.2절) |
| `li > span.vd` | 판정 이름(모양 + 글자, 6.1절) |
| `li > button.graph-row-btn[data-vd-claim="{i}"][title="편집기에서 이 문장 선택"]` | 문장 앞부분 + `code`@키 — 두 줄까지 |
| `li > span.muted` | 이유(서버 `reason`) |
| `li > span.muted "근거 후보" > button.page-link[data-vd-ev][data-paper][data-page][title="참고 패널에서 p.N 열기"]` | 근거 쪽 → 참고 패널 PDF 탭 그 쪽 |
| `details > summary.small "근거 있음 N개 보기" > ol.graph-items` | 근거 있음은 접어 둠 |
| `.doc span.cite-vd[data-verdict="weak｜unsupported"][data-vd-claim][role=button][tabindex=0][title]` + 바로 뒤 `span.sr-only "(인용 검증: …)"` | 미리보기 인용 표시(6.3절). 기존 `runsHtml`의 인용 런을 감쌈 |
| `.writer-status` 안 `span[data-verify-sum]` | 1100px 이하(왼쪽 칸이 숨음)에서 요약 한 줄(AD-4) |

### 0.5 읽기 화면 (`reader.js`)

| 이름 | 뜻 |
|---|---|
| `.hl-layer > div.spot-rect` | `goToSpot(page, rect, text)`가 그 쪽 `.hl-layer`에 `rect`(0~1) × 100%로 붙임. 6초 뒤 지움 + `flashText(text)` |
| 대화 탭 `a.btn.sm.ghost[href="#/ask"]` "여러 논문에 질문 →" | 대화 빈 상태 · 입력칸 위 오른쪽(명세 5장) |

---

## 1. 공통 원칙

- **같은 모양 두 번**: 서재 질문과 AI로 찾기 모두 "답(`.msg.assistant .prose`) + `[n]` + 번호 붙은 출처" 한 모양. 서재 출처는 줄(`cite-item`), 찾기 출처는 카드(`result`).
- **색만으로 구분하지 않음**: 판정은 모양(✓ ◐ ✕ – …) + 글자, 미리보기는 밑줄 모양(점선 · 물결) + 위첨자 `?` `!` + 화면 읽기용 글. 색은 모양 · 왼쪽 줄에만, 판정 글자는 `--text`(두 테마 대비 AA).
- **기다림은 이유와 함께**: 색인 · 불러오기 · 찾기 진행은 무엇을 기다리는지와 "다른 화면으로 가도 계속돼요"를 씀.
- 문구는 '~해요'체, 버튼은 동사형 짧게.

## 2. 진입점

### 2.1 아이콘 (복사해서 쓰기)
- AI 질문(사이드바): `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4zM9 9.5h6M9 12.5h4"/></svg>`
- 인용 검증(도구 막대): `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6zM9 12l2 2 4-4"/></svg>`

### 2.2 들어가는 곳
| 곳 | 동작 |
|---|---|
| 사이드바 "AI 질문" | 서재에서 컬렉션 · 폴더를 고른 상태면 `#/ask/c{id}` · `#/ask/f{id}`, 아니면 `#/ask`(서재 전체) |
| 논문 찾기 화면 `.discover-bar` [검색] 옆 `button.btn[data-ai-find]` "✦ AI로 찾기" | 입력 글을 **메모리로** 넘기고 `#/ask/find` → 바로 실행(AD-5). 입력이 2자 미만이면 입력칸에 초점만 |
| 읽기 화면 대화 탭 "여러 논문에 질문 →" | `#/ask` |
| 작업 목록의 `find` 카드 | `#/ask/find/j{id}`(결과 다시 보기 — 24시간 안, AD-8) |

## 3. 내 서재 탭

```
AI 질문
내 서재 논문의 원문이나 공개 학술 DB를 근거로, 출처 번호가 붙은 답을 받아요.
[내 서재에 묻기] [논문 찾기 (AI로 찾기)]
───────────────────────────────────────────────
범위 (서재 전체|컬렉션|폴더) [석사논문 선행연구 ▾]  한 논문만: 읽기 화면 대화 →   [대화 지우기]
( ◌ 32편 중 30편 색인됨 · 2편 색인 중 (1/2)                         작업 보기 )
( ◌ 서재 색인을 불러오는 중이에요 — 처음 한 번은 몇 초 걸려요 )
[⚠ 지금은 낱말 검색만 해요. …]
                                     [이 컬렉션 논문들은 … 측정했어?]
대부분 자기보고식 척도를 썼어요. … 그대로 썼고 ¹ ² , … 검증했어요 ³ .
  1  p.5  Perceived stress and sleep quality … · 2021  “Stress was measured …”
  2  p.3  대학생의 학업 스트레스와 수면의 관계 · 2019  “본 연구에서는 …”
[ 이 범위 논문들에 물어보세요                                 ] [보내기]
```

### 3.1 범위
- 라디오 3개(서재 전체 · 컬렉션 · 폴더). 컬렉션 · 폴더를 고르면 옆에 선택 상자(처음엔 서재에서 고른 것, 없으면 첫 항목). 바꾸면 주소가 바뀌고 그 범위 대화를 불러옴.
- **현재 논문 범위는 라디오가 아니라 링크**(K-8 — 읽기 화면 대화가 그 범위). 최근 연 논문이 있을 때만 "한 논문만: 읽기 화면 대화 →"(AD-1).
- 컬렉션 · 폴더가 하나도 없으면 그 라디오는 `disabled` + `title="컬렉션이 없어요"`.

### 3.2 색인 상태 (`GET /api/ask`의 `index` · 진행 중 `index` 작업)
| 경우 | 모양 · 문구 |
|---|---|
| 모두 색인 | `.status-line` 없이 대화 위 `p.small.muted` "이 범위 32편 모두 색인됨" (본문 없는 논문이 있으면 " · 2편은 본문이 없어 빠져요(스캔본)") |
| 색인 중(작업 있음) | `.status-line[data-state=indexing]` 스피너 + "32편 중 **30편** 색인됨 · 2편 색인 중 (1/2)" + `a` [작업 보기]. 진행은 작업 `progress.message`에서 |
| 대기인데 작업 없음(취소 · 실패) | `[data-state=pending]` 시계 아이콘 + "2편이 아직 색인되지 않았어요" + `button.btn.sm[data-ask-index-run]` [색인하기] |
| 실패 | `[data-state=failed]` 경고 아이콘 + "색인하지 못한 논문이 있어요 ({오류 이름})" + [다시 색인하기] |
| `embed: false` | `.notice[data-tone=warn]` "**지금은 낱말 검색만 해요.** 의미 검색 모델이 서버에 없어요. 논문에 나오는 낱말(영어 논문이면 영어 용어)을 넣어 물으면 더 잘 찾아요." |
| 색인된 논문 0편 | 대화 대신 `.empty` — h3 "이 범위에 색인된 논문이 없어요" / p "PDF가 있는 논문을 넣으면 자동으로 색인해요. 색인이 끝나면 여기서 물어볼 수 있어요." (색인 중이면 위 상태 줄도 함께) |

- 색인 중이어도 **질문은 막지 않음**(색인된 논문만으로 답함). 입력칸 아래 힌트 없음 — 상태 줄로 충분.

### 3.3 첫 로드 지연 (`loaded: false`)
- `.status-line[data-ask-load]` 스피너 + "서재 색인을 불러오는 중이에요 — 처음 한 번은 몇 초 걸려요. 그동안 질문을 써 두세요." `#/ask`를 연 순간 그리고, `GET /api/ask`를 3초마다 다시 불러 `loaded: true`면 지움.
- 그 사이 보낸 질문: 답 자리 `.typing` 옆에 `span.small.muted` "색인을 다 불러오면 답해요".
- 60초 넘어 503: `.msg.error` "색인을 불러오는 데 시간이 오래 걸려요. 잠시 후 다시 물어봐 주세요." + [다시 보내기].

### 3.4 대화 · 출처
- 빈 대화: `.empty`(작게) h3 "이 범위 논문들에 물어보세요" / p "답의 문장마다 출처 번호가 붙고, 누르면 그 논문의 그 쪽이 열려요." + `.suggest` 3개: "이 논문들의 공통 연구 방법은?" · "결론이 서로 다른 논문이 있어?" · "가장 많이 쓴 측정 도구는?"
- 스트림 · 대기열 · 폴백 · 오류 문구는 읽기 화면 대화와 같음(2단계 SSE 이벤트, `jobs.js` 문구).
- `[n]` 단추: 그 `cite-item`에 초점 + `.is-flash` 1.5초. **읽기 화면으로 가지는 않음**(본문 읽다 튕기지 않게).
- 출처 줄: 누르면 화면 메모리에 `{paper_id, page, rect, text}`를 두고 `#/read/{id}/p{page}` → 4장. 지운 논문이면 `toast` "이 논문은 서재에서 지워졌어요".

## 4. 읽기 화면 위치 표시 (`goToSpot`)

- 그 쪽으로 스크롤해 `rect` 위쪽이 화면 위 1/4에 오게 → `.spot-rect`(파란 2px 테두리 · 옅은 채움, 두 번 맥박) 6초 + 그 글 `flashText`. `rect`가 없으면 쪽 이동 + `flashText`만.
- 이미 열린 논문이면 다시 열지 않고 `goToSpot`만. 브라우저 [뒤로]로 `#/ask`(대화는 서버에서 다시 불러옴).
- 알림: "p.5의 출처 위치를 표시했어요".
- 움직임 줄이기 설정이면 맥박 없이 테두리만(CSS).

## 5. 논문 찾기 탭 (AI로 찾기)

```
[⌕ 대학생 학업 스트레스와 수면의 관계                ] [AI로 찾기]
OpenAlex · Semantic Scholar에서 여러 검색어로 찾아 8편을 골라 한국어로 요약해요. 결과는 24시간 뒤 지워져요.
┌ ◌ AI로 찾는 중 ───────────────────────┐
│ ✓ 검색어 만들기 3개                      │
│ ✓ 검색 OpenAlex · Semantic Scholar 112편 │
│ ● 관련 논문 고르기                       │
│ ○ 한국어 요약 쓰기                       │
│ Anthropic API로 실행 중이에요. …          │
│ 작업 목록에서 보기                 [취소] │
└───────────────────────────────────────┘
[ⓘ 초록을 바탕으로 쓴 요약이에요. … 24시간 뒤 지워져요 …]
[⚠ Semantic Scholar 검색이 응답하지 않아 …]
쓴 검색어 (academic stress sleep …) (대학생 학업 스트레스 수면) (…)
대학생의 학업 스트레스가 높을수록 … ¹ ² . …
출처 논문 8편
 ¹ Academic stress and sleep quality …         ← .result 카드
   Lee J, Park S - Sleep Medicine, 2022 - doi:…
   초록 3줄…
   [＋ 서재에 추가] 인용 그래프 인하대에서 보기↗ Scholar↗
```

### 5.1 진행 (`find` 작업 폴링 — 2단계 작업 카드)
| 단계 `data-step` | 이름 | 끝난 뒤 옆 글 |
|---|---|---|
| `queries` | 검색어 만들기 | "{n}개" |
| `search` | 검색 | "OpenAlex · Semantic Scholar {n}편" |
| `pick` | 관련 논문 고르기 | "{n}편" |
| `summary` | 한국어 요약 쓰기 | — |
- `.graph-progress-msg`: 경로 문구(`jobs.js` — "Anthropic API로 실행 중이에요" · "PC의 claude를 기다리는 중이에요") + " 보통 30초~1분 걸려요. 다른 화면으로 가도 계속돼요." CLI 두 단계는 단계 이름 그대로(1 · 4는 PC, 2 · 3은 서버).
- 진행 중 입력칸 · [AI로 찾기]는 `disabled`. [취소] → 카드가 "취소했어요" 후 사라짐.

### 5.2 결과
- 안내(늘): `.notice[data-tone=info]` "**초록을 바탕으로 쓴 요약이에요.** 원문과 다를 수 있으니 출처 논문을 확인해 주세요. 이 결과는 24시간 뒤 지워져요 — 필요한 논문은 서재에 추가해 두세요."
- 경고(`warnings`): `openalex_failed` "OpenAlex 검색이 응답하지 않아 Semantic Scholar 결과로만 골랐어요." · `s2_failed` "Semantic Scholar 검색이 응답하지 않아 OpenAlex 결과로만 골랐어요." · `partial` "45초 안에 다 받지 못해 받은 결과로만 골랐어요." · 하루 예산 소진은 1B `WARN_TEXT` 그대로.
- 출처 카드: discover `resultCard`를 `lite`로 — **[서재에 추가](PDF 포함 추가) · 인용 · 그래프 · 인하대에서 보기 · Scholar**. 피인용 · 참고문헌 · 관련 논문(논문 찾기 화면 안에서만 동작)은 숨기고, 1C와 같은 Scholar 링크(`data-scholar-open`, `INHA.buttons.scholar`)를 더함(AD-3).
- 요약의 `[n]` → `#find-src-{n}`으로 부드럽게 스크롤(움직임 줄이기면 즉시) + 카드 제목 링크에 초점 + `li.is-flash` 1.5초.

### 5.3 실패 · 빈 결과
| 경우 | 모양 |
|---|---|
| 관련 논문 0편(성공) | `.empty` h3 "관련 논문을 찾지 못했어요" / p "더 구체적으로 묻거나 영어 용어를 넣어 보세요." |
| 둘 다 검색 실패 | `.job-card[data-job-state=failed]` "검색 결과를 받지 못했어요. 잠시 후 다시 시도해 주세요." + [다시 찾기] |
| `bad_output` | 같은 카드 "요약을 제대로 만들지 못했어요(출처 번호 · 한국어 검사). 다시 시도해 주세요." + [다시 찾기] |
| 경로 없음(키 · PC 없음) | 2단계 문구 그대로 + [설정 열기] |
| 24시간 지남(`#/ask/find/j{id}`) | `.empty` h3 "이 결과는 24시간이 지나 지워졌어요" / p "다시 찾으려면 질문을 입력해 주세요." |

## 6. 인용 검증 (쓰기 화면)

### 6.1 판정 이름 (`.vd` — 모양은 CSS가, 글자는 JS가)
| `verdict` | 모양 | `method=ai` · `none` | `method=quote` |
|---|---|---|---|
| `supported` | ✓ (초록) | 근거 있음 | 직접 인용 일치 |
| `weak` | ◐ (주황) | 근거 약함 | 직접 인용 다름 |
| `unsupported` | ✕ (빨강) | 근거 없음 | 직접 인용 불일치 |
| `unchecked` | – (회색) | 확인 못 함 | 확인 못 함 |
| `pending` | … (파랑) | 확인 중 | — |

### 6.2 왼쪽 "인용 검증" 목록
```
인용 검증
[⚠ 원고가 바뀌었어요 — 새로 쓴 인용 2개는 아직 검증 전이에요. [다시 검증]]
( ◌ 문장 12개를 AI가 확인하고 있어요 · PC 대기 중 )
(✕ 근거 없음 1) (◐ 약함 2) (– 확인 못 함 1) (✓ 근거 있음 5)
┃✕ 근거 없음
┃학업 스트레스는 모든 대학생의 수면 시간을 2시간 이상 줄인다 @lee2022
┃원문은 상관만 보고하고, 줄어든 시간은 다루지 않아요.
┃근거 후보 [p.4] [p.7]
 ◐ 직접 인용 다름 …
▸ 근거 있음 5개 보기
```
- 순서: 근거 없음 → 약함 → 확인 못 함 → 확인 중 → (접힌) 근거 있음. 같은 판정 안은 원고 순서.
- 문장 단추: 편집기에서 `start`~`end` 선택 + 스크롤 + 초점(편집 보기가 숨어 있으면 나란히 보기로).
- 근거 `p.N`: `W.ref.open(paper_id, { tab: "pdf", page })` — 1C 참고 패널이 그 쪽으로(닫혀 있으면 열림). 근거 글 앞 200자는 `title`로.
- 이유 문구(서버): "서재에 없는 인용키예요" · "원문(PDF)이 없어요" · "색인 중이에요. 끝나면 다시 검증해 주세요" · "AI를 쓸 수 없어 근거 후보만 보여요" · "원문은 p.N에 있어요" · AI 이유.
- 40문장 넘음: 목록 위 `.notice[data-tone=info]` "남은 {N}개는 [인용 검증]을 다시 누르면 확인해요."
- 처음(검증 결과 없음): 이 구역을 그리지 않음 — [인용 검증] 버튼의 `title` "원고의 인용 문장이 원문에 근거가 있는지 확인해요. 직접 인용은 글자를 대조하고, 나머지는 AI가 판정해요."

### 6.3 미리보기 표시
- **`weak` · `unsupported`인 인용 표시만**(`marker_index`로 그 인용 런을 감쌈 — AD-2). 근거 있음 · 확인 못 함은 표시 안 함(소음 줄이기, AD-7).
- 약함 = 옅은 주황 바탕 + 점선 밑줄 + 위첨자 `?`, 없음 = 옅은 빨강 바탕 + 물결 밑줄 + 위첨자 `!`. 종이는 늘 흰색이라 두 테마 모두 밝은 색 고정.
- `title` "{판정 이름} — {이유}", 뒤에 `span.sr-only` "(인용 검증: {판정 이름})". 누르거나 Enter · Space → 6.2절 문장 단추와 같음.

### 6.4 실행 · 다시 검증
- [인용 검증] → `POST …/verify`(저장되지 않은 글은 먼저 저장). 응답으로 바로 그림(직접 인용 · 재사용은 즉시), `pending`이 있으면 작업 폴링 → 끝나면 `GET`으로 다시 그림 + 알림 "인용 검증을 마쳤어요. 근거 없음 1개, 약함 2개".
- 자동 저장 뒤 `GET …/verify`(AI 없음)로 다시 맞춤. 지금 원고의 인용 수가 `items`보다 많으면 `[data-verify-stale]` "원고가 바뀌었어요 — 새로 쓴 인용 {N}개는 아직 검증 전이에요." + [다시 검증].
- 1100px 이하(왼쪽 칸이 숨음): `.writer-status`에 `[data-verify-sum]` "인용 검증: ✕ 1 · ◐ 2 — 미리보기에 표시했어요"(AD-4).

## 7. 작업 목록 · 설정 문구

### 7.1 작업 목록 (`jobs.js`)
| `kind` | 이름표 `.chip` | 카드 제목 | 누르면 |
|---|---|---|---|
| `index` | 색인 | "서재 색인" (진행 "색인 중 3/12편") | `#/ask` |
| `find` | AI로 찾기 | "“{질문 앞 40자}”" · 24시간 지나면 "AI로 찾기 (결과가 지워졌어요)" | `#/ask/find/j{id}` |
| `verify` | 인용 검증 | "원고: {원고 제목}" | `#/write/{원고 id}` |
| `chat`(`paper_id` 없음) | 서재 질문 | "서재 전체" · "컬렉션: {이름}" · "폴더: {이름}" | 그 범위 `#/ask/…` |

- `index`는 엔진이 `local` → 경로 줄 "서버에서 실행"(PC · API 단계 없음). 오류 이름 추가: `index_failed` "색인하지 못함".

### 7.2 설정 "AI 엔진" (`dialogs.js` `JOB_KINDS`)
| 줄 | 이름 | 힌트(`.hint`) |
|---|---|---|
| `chat` | 논문과 대화 · 서재 질문 | "읽기 화면 대화와 AI 질문(내 서재)이 함께 써요." |
| `find` (신규) | AI로 찾기 | "검색어 만들기와 한국어 요약에 써요. 논문 검색은 공개 DB라 무료예요." |
| `verify` (신규) | 인용 검증 | "간접 인용 판정에만 써요. 직접 인용은 AI 없이 글자로 대조해요." |
- OpenAlex 키 칸 힌트 끝에 " AI로 찾기도 이 키를 써요." 한 문장 추가. 임베딩 설정은 없음(서버 전용).

## 8. 좁은 화면 · 다크 모드 (390px · 1280px 확인)

- 560px 이하: 머리 · 범위 줄 · 상태 줄 여백을 16 → 12px. 범위 줄은 줄바꿈(라디오 → 선택 상자 · 링크 → [대화 지우기]).
- 찾기 탭: 카드 · 진행 카드 모두 화면 폭. 가로 넘침 없음(시험 페이지에서 `scrollWidth = 390`).
- 900px 이하 사이드바가 숨는 것은 기존 한계 — `#/ask`는 주소 · 읽기 화면 링크로 들어감(새 진입 버튼 만들지 않음).
  → 개발 때 좁은 화면 메뉴에 'AI 질문' 항목을 추가(팀장 결정)
- 다크: 새 색은 모두 기존 변수(`--success` · `--warn` · `--danger` · `--accent-text`). 미리보기 표시만 흰 종이용 고정색(기존 `.cite-warn`과 같은 값).

## 9. 접근성 · 키보드

| 곳 | 키 · 이름 |
|---|---|
| 탭 | ← → Home End(roving), 탭 내용 `role=tabpanel` |
| 범위 | 라디오 기본 화살표. 선택 상자 바꾸면 알림 "컬렉션 석사논문 선행연구의 대화를 불러왔어요" |
| 질문 입력 | Enter 보내기, Shift+Enter 줄바꿈(읽기 화면과 같음), 스트리밍 중 [중지] |
| `[n]` | Tab으로 닿음, Enter → 출처 줄 · 카드로 초점 |
| 출처 줄 · 검증 문장 · `p.N` | 모두 `button`. 초점 테두리 2px `--accent` |
| 미리보기 표시 | `role=button tabindex=0`, Enter · Space |
| 알림(`[data-ask-live]` · 쓰기 화면 기존 `[data-ref-live]`) | 답 끝 "답을 다 썼어요. 출처 3개" · 찾기 끝 "요약과 출처 논문 8편을 찾았어요" · 검증 끝(6.4절) · 색인 끝 "색인을 마쳤어요". 스트리밍 글자마다는 알리지 않음(`aria-busy`) |
| 움직임 | `prefers-reduced-motion`이면 `.spot-rect` · 하이라이트 맥박 · 카드 반짝임 없음 |

## 10. 확인 결과 · 남은 것

- 정적 시험 페이지: scratchpad `ask/index.html`(저장소 밖, `?v=ask｜find｜verify｜reader`, `&theme=dark`) — 1280px · 390px × 밝은 · 어두운 테마로 스크린샷 확인. 390px에서 네 화면 모두 가로 넘침 없음. `::before`/`::after` 판정 글리프가 화면 읽기에서 빠지는지(`content: "✓" / ""`)는 계산값으로만 확인.
- 확인 못 함: 실제 앱(`ask.js`가 아직 없음), 실제 화면 읽기 프로그램(NVDA) 낭독, 실제 PDF 쪽 위 `.spot-rect` 좌표 맞춤.
- 390px에서 상태 줄 세 개(색인 · 불러오기 · 낮은 검색)가 한꺼번에 나오면 대화 칸이 화면 절반 아래로 줄어듦 — 실제로는 셋이 겹칠 일이 드물어 그대로 둠.

## 11. 팀장 결정(2026-10-08): 디자인팀 추천안 채택

| # | 항목 | 추천 | 다른 안 |
|---|---|---|---|
| AD-1 | "현재 논문" 범위 | 라디오가 아닌 링크 "한 논문만: 읽기 화면 대화 →"(K-8과 맞음) | 라디오 4번째 — 누르면 다른 화면으로 가 헷갈림 |
| AD-2 | 미리보기 표시 단위 | 인용 표시(`marker_index`)만 | 문장 전체 — 원고 위치 ↔ 미리보기 런 대응이 새로 필요 |
| AD-3 | AI로 찾기 출처 카드 | 논문 찾기 카드(`resultCard`) `lite` + Scholar — 초록이 보여 요약 대조 가능 | 1C 추천 항목(`graph-item`) — 작지만 초록 없음 |
| AD-4 | 1100px 이하 검증 목록 | 상태 줄 요약 + 미리보기 표시만 | 왼쪽 칸을 겹쳐 여는 새 패널 |
| AD-5 | 논문 찾기 [AI로 찾기] | 바로 실행(질문은 메모리로) | 입력만 채우고 사용자가 한 번 더 누름 |
| AD-6 | 사이드바 위치 · 이름 | "논문 찾기" 아래 "AI 질문" | — |
| AD-7 | 근거 있음 표시 | 목록에서 접고, 미리보기엔 안 함 | 미리보기에 초록 밑줄 |
| AD-8 | 찾기 결과 다시 보기 주소 | `#/ask/find/j{작업 id}`(작업 id는 민감하지 않음) | 작업 목록에서만 결과 보기 |
