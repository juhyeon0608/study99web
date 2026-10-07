# 화면 시안 — 논문 쓰기 화면의 참고 패널 (1C단계)

- 작성: 디자인팀 · 2026-10-08
- 근거: [기능 명세](../specs/writing-reference-pane.md) 3장(범위) · 4.2절(임베드 모드) · 5장(흐름) · 6장(격자) · 7장(탭별 동작) · 8장(넣는 형식) · 9.5~9.9절(추천 이벤트 · 응답 · 다시 계산) · 10장(저장) · 11장(접근성 · 단축키) · 12.E절(수동 확인) · 16장(작업 분담)
- 재사용한 시안: [인용 그래프 시안](citation-graph-ui.md)(패널 · 탭 · 항목 단추 6.3절 · 진행 카드 8.1절 · 경고 8.2절 · 오류 문구 8.3절), [인하대 · Scholar 시안](inha-proxy-ui.md)(바깥 링크 1.1 · 1.2절, PDF 없음 6장)
- 팀장 결정 반영(2026-10-08): **K-1~K-13 = 명세의 기획팀 추천안 그대로**. 사용자 결정: 패널에 **PDF · 하이라이트·노트 · AI 요약 · 서지 정보를 모두** 보이고, 추천은 **원고 인용 기준 · 서재 밖 논문 포함**. 팀장 지시: 추천 항목에 **[서재에 추가] [추가하고 인용] [인하대에서 보기] [Google Scholar]**(명세 3장 "안 하는 것"과 다름 — 14장 RD-2).
- **U-1(직접 인용 모양) = 사용자 결정 2026-10-08: APA 방식(40단어 미만 본문 안 · 이상 인용 블록) + 둥근 따옴표 “ ”**(기본값 그대로 확정, 설정 창 없음 — RD-5). RD-1~RD-6은 팀장 결정으로 디자인팀 안 채택(14장). 이 문서의 **화면 문구에는 이 값을 적지 않았습니다** — 설명이 필요한 곳은 설정값에서 만든 글자(`{직접 인용 설명}`, 10장)를 씁니다.
- 스타일: `paperlab/static/css/app.css` 맨 끝 **"논문 쓰기 참고 패널"** 구역(이번에 추가, 56줄 — 1370 → 1426줄). 그 위 1370줄(개발팀이 고친 `.writer` 격자 — 아직 커밋 전 — 포함)은 바이트 단위로 그대로입니다(줄 끝 CRLF 유지).
- 개발팀은 **0장 표의 클래스 · data 속성 이름 그대로** 마크업하면 됩니다. 칸 배치 · 숨김은 CSS가 맡고, JS는 속성 · 클래스만 바꿉니다. 제목 · 저자 · 초록 · 하이라이트 · 노트 글은 `esc()` · `textContent`로만(AC-R35).
- 시험 페이지: 디자인팀 scratchpad `refpane/index.html`(저장소 밖, 가짜 PDF 쪽 · 가짜 데이터)에서 두 테마 · 1280px · 390px로 확인했습니다(13장).

---

## 0. 개발팀용 클래스 · data 속성 목록 (먼저 확정)

> ★ = 기존 마크업을 바꾸는 곳(`writing.js` · `reader.js`). 나머지는 새 모듈 `refpane.js`가 그립니다.
> **새 클래스는 9개뿐**: `.ref-pane` · `.ref-head` · `.ref-pick` · `.ref-pdf` · `.ref-basis` · `.ref-note` · `.ref-note-actions` · `.ref-rec-actions` · `.cs-peek`. 나머지는 모두 기존 클래스(1장).

### 0.1 진입점 (`writing.js`)

| 이름 | 붙이는 곳 | 뜻 |
|---|---|---|
| `section.writer[data-ref="open"]` ★ | 원고 화면 전체 | 패널 열림. **클래스가 아니라 속성** — 지금 보기 전환 코드가 `view.className = \`writer view-…\``로 클래스를 통째로 바꾸기 때문(그대로 두면 됨). 닫힘 = 속성 없음 |
| `button.btn.sm[data-ref-toggle][aria-pressed][aria-controls=ref-pane][aria-keyshortcuts="Alt+R"]` ★ | `.writer-tools`, [✦ AI 도우미] 바로 뒤 | [참고] 버튼. `aria-pressed="true"`면 CSS가 눌린 모양(파란 테두리 · 옅은 배경) |
| `svg.ico` 참고 아이콘(`ICON_REF`, 2.1절) | [참고] 버튼 앞 | 장식(`aria-hidden`) |
| `.seg[data-view] button[data-v=split][title]` ★ | 기존 [나란히] | 미리보기가 숨은 동안만 `title="참고 패널을 닫거나 화면을 넓히면 미리보기도 보여요"`(4.3절) |
| `button.cite-row[data-ref-open="{서재 논문 id}"][title]` ★ | `drawCites` — **서재에 있는 키만** | 왼쪽 "이 원고의 인용" 줄을 버튼으로. 안의 `div`는 `span`으로(버튼 안에 `div` 불가 — CSS가 `display:block`) |
| `button.cite-row[aria-current="true"]` | 위 | 지금 패널에 열린 논문(왼쪽 파란 줄 + 옅은 배경) |
| `div.cite-row.missing` | `drawCites` | 서재에 없는 키 — **지금 그대로**(누를 수 없음) |
| `button.btn.sm.cs-peek[data-ref-peek][tabindex="-1"][title]` ★ | `[@` 자동완성 `.cs-item` 맨 끝 | [보기] — 넣지 않고 패널에서 보기. 마우스를 올린 줄 · 고른 줄에서만 보임(터치 화면은 늘) |
| `.cs-hint` ★ | 자동완성 아래 줄 | 문구에 "Ctrl+Enter 옆에 보기" 추가(macOS "⌘+Enter") |
| `div.sr-only[role=status][data-ref-live]` | `section.writer`의 **마지막 자식**(패널 밖) | 화면 읽기 알림 자리(늘 빈 채로 그려 둠). 패널이 닫혀(`display:none`) 있다가 열리는 순간의 알림도 읽히도록 패널 밖에 둠 |

### 0.2 패널 틀 (`refpane.js`)

| 이름 | 뜻 |
|---|---|
| `aside.panel.ref-pane#ref-pane[aria-label="참고 패널"]` | `.writer-body`의 **네 번째 자식**(`.writer-preview` 뒤). 기존 `.panel` 재사용(배경 · 세로 배치). `[data-ref="open"]`이 아니면 CSS가 숨김 |
| `aside.ref-pane[aria-busy="true"]` | 논문을 불러오는 중 |
| `div.ref-head` | 머리줄 |
| `select.input.ref-pick[data-ref-pick][aria-label="열린 논문"][title="{지금 논문 전체 제목}"]` | 열린 논문 고르기(3.2절). **이 상자가 패널 제목 역할**이자 열 때의 초점 자리 |
| `button.btn.sm[data-ref-cite][aria-label="이 논문 인용 넣기"][title]` | [＋ 인용] — `[@키]`(8.4절). 서재 밖 · 빈 상태면 `disabled` |
| `button.icon-btn[data-ref-close][aria-label="참고 패널 닫기"][title="닫기 (Alt+R)"]` | ✕ |
| `div.tabs[role=tablist][aria-label="참고 자료"]` | 탭 줄(기존 `.panel .tabs`). 좁으면 줄바꿈 없이 가로 스크롤 |
| `button[role=tab][data-ref-tab="pdf｜notes｜summary｜info｜recs"][id=ref-tab-…][aria-selected][aria-controls][tabindex]` (+`active`) | PDF · 하이라이트·노트 · 요약 · 정보 · 추천. roving tabindex |
| `button[role=tab][aria-disabled="true"]` | 서재 밖 논문의 PDF · 하이라이트·노트 · 요약(흐리게 — 초점은 받음) |
| `span.graph-tab-n` | 추천 탭 뒤 개수(결과가 있을 때만, 1B와 같은 모양) |
| `div.ref-pdf#ref-pdf[role=tabpanel][aria-labelledby=ref-tab-pdf]` (+`hidden` 클래스) | PDF 탭 칸(0.3절). **다른 탭을 보는 동안에도 지우지 않고 `.hidden`으로만 숨김**(PDF를 다시 받지 않게). `hidden` 속성이 아니라 `.hidden` 클래스(`display:flex`를 이기도록) |
| `div.panel-body#ref-tabpanel[role=tabpanel][aria-labelledby=ref-tab-…][data-ref-body]` (+`hidden`) | 나머지 네 탭의 내용(기존 `.panel-body` — 스크롤) |
| `div.empty > h3[tabindex=-1] + p + div.empty-actions` | 빈 상태 · 오류 · 서재 밖 잠김(3.4절). 기존 `.empty` 재사용(패널 안에서는 여백만 줄임) |
| `div.empty > span.spinner` | 논문 · 탭 내용 불러오는 중(읽기 화면과 같은 모양) |

### 0.3 PDF 탭 (`refpane.js`가 그리고 `reader.js` `mountPdf`에 `.ref-pdf`를 `R.view`로 넘김)

| 이름 | 뜻 |
|---|---|
| `div.reader-bar` | 작은 막대 — **읽기 화면 막대와 같은 클래스**(`reader.js`가 `.reader-bar .hl-color`를 찾음, 명세 4.2절 2번). 패널 안에서는 CSS가 여백을 줄이고 줄바꿈 허용 |
| `div.pageno > input.input[data-page][aria-label="쪽 번호"]` + `span[data-total]` | 쪽 `[n] / N`, Enter로 이동(지금과 같음) |
| `button.icon-btn[data-zoom="-1"][aria-label="축소"]` · `button.btn.sm.ghost[data-fit][title="폭 맞춤"]` · `button.icon-btn[data-zoom="1"][aria-label="확대"]` | − · 맞춤 · ＋ (지금 막대와 같은 data 속성) |
| `div.hl-colors[role=group][aria-label="하이라이트 색"] > button.hl-color[data-c][aria-label="{색 이름}"][aria-pressed]` (+`active`) | 색 5개. 이름: 노랑 · 초록 · 파랑 · 분홍 · 보라 |
| `span.ref-basis[title]` | 막대 끝 "인용 쪽: 인쇄 쪽(345–360)" / "인용 쪽: PDF 쪽"(명세 8.5절 3번). 좁으면 다음 줄 오른쪽 |
| `div.pdf-scroll[tabindex="0"][aria-label="PDF 원문"] > div.pdf-pages` | PDF 칸(기존). 키보드로 스크롤할 수 있게 `tabindex` |
| `div.sel-pop` > … `button.btn.sm.primary[data-quote][title="{직접 인용 설명}"]` ★ | 글자 선택 상자: **[색 5개] · [인용으로 넣기] · [메모] · [복사]**. [AI에게 묻기](`data-ask`)는 임베드 모드에서 그리지 않음 |
| `div.sel-pop.ann-pop .row > button.btn.sm.ghost[data-quote]` ★ | 칠해진 하이라이트 상자: [AI에게 묻기] 자리에 [인용으로 넣기] |
| `div.empty.pdf-missing` | PDF 없는 서재 논문 — **지금 `drawPdfMissing` 그대로**(인하대에서 보기 · PDF 첨부) |

### 0.4 하이라이트·노트 탭 (`reader.js` `highlightsTab(body, { onInsert })` + `refpane.js`)

| 이름 | 뜻 |
|---|---|
| `.ann-item .foot > button.btn.sm[data-insert][title]` ★ | [넣기] — 직접 인용(명세 8.2절). 임베드 모드에서 [묻기](`data-ask`) 대신 |
| `.ann-item .foot > button.btn.sm.ghost[data-insert-comment][title]` ★ | [메모 넣기] — 메모가 있을 때만(8.3절) |
| `.ann-item .foot > button.page-link[data-goto]` | p.N — PDF 탭으로 가서 그 쪽(지금 `pageLink`) |
| `div.section-title` "노트" | 하이라이트 목록 아래 |
| `textarea.input.ref-note[readonly][rows=8][aria-label="노트 (읽기 전용)"][aria-describedby=ref-note-hint]` | 노트(읽기 전용, 키보드로 선택 가능) |
| `div.ref-note-actions > button.btn.sm[data-note-insert][disabled][aria-describedby=ref-note-hint]` + `span.small.muted#ref-note-hint` | [선택한 부분 넣기] + 안내. 선택이 생기면 `disabled` 뺌 |
| `p.small.muted[data-note-empty]` | 노트가 비었을 때(textarea 대신) |

### 0.5 요약 · 정보 탭

| 이름 | 뜻 |
|---|---|
| (요약 있음) `drawSummary(body, s, { ask: false })`의 마크업 그대로 | 읽기 화면 요약과 같은 모양, 물어보기 · 다시 만들기 없음 |
| `div.ai-cta[data-ref-summary="none"]` > `div.big` · `h3` · `p.small` · `a.btn.primary[href="#/read/{id}"][data-ref-read]` | 요약 없음(기존 `.ai-cta`) |
| `div.graph-paper` | 정보 묶음 — **1B 패널 "논문 정보" 클래스 재사용**(`.graph-paper-title` · `-authors` · `-venue` · `.actions` · `.kv` · `.abstract.clamp` · `.graph-abs-toggle`) |
| `button.btn.sm.primary[data-ref-insert-key]` | [인용 넣기](서재 논문) |
| `a.btn.sm[href="#/read/{id}"][data-ref-read]` | [읽기 화면에서 열기] |
| `button.btn.sm.ghost.graph-list-back[data-ref-back-recs]` | 서재 밖 논문: [← 추천 목록](1B 클래스) |
| `div.chips > span.chip` "서재 밖 논문" · `span.chip.accent` "내 인용 {n}편과 연결" | 서재 밖 논문 머리 칩 |
| `button.btn.sm.primary[data-ref-add]` · `button.btn.sm[data-ref-addpdf]` · `button.btn.sm[data-ref-addcite]` | [＋ 서재에 추가] · [PDF 포함 추가](`pdf_url` 있을 때) · [추가하고 인용] |
| `a.btn.sm[data-inha-open]` · `a.btn.sm[data-scholar-open]` | 서재 밖 논문 정보의 인하대에서 보기 · Google Scholar에서 보기(1A 규칙 — `bindExtLink`) |
| `issuesBox(...)`(지금 `dialogs.js`) | 인용 정보가 빈 서재 논문 — 버튼 줄 아래 |

### 0.6 추천 탭

| 이름 | 뜻 |
|---|---|
| `div[data-ref-recs="noseed｜nonumber｜loading｜ready｜empty｜error｜cancelled"]` | 추천 탭 상태(시험 · 품질팀 확인용. CSS는 쓰지 않음) |
| `div.row > p.graph-intro.grow` + `button.btn.sm[data-ref-rec-retry]` | 머리 한 줄 "이 원고의 인용 9편을 바탕으로 찾았어요 · OpenAlex 기준 {날짜}" + [다시 계산] |
| `div.graph-notices[data-ref-notices]` > `.notice[data-tone][data-code]` | 알림 상자(1B 클래스 — 패널 안에서는 바깥 여백만 줄임). 비면 CSS가 숨김 |
| `.notice > button.icon-btn.small[data-notice-close][aria-label="알림 닫기"]` | 닫기(이 결과 동안만) |
| `ol.graph-items > li.graph-item` | 추천 항목 — **1B 6.3절 항목 그대로** |
| `button.graph-item-btn[data-ref-rec="W…"]` (+`aria-current="true"`) > `span.graph-item-title` · `span.graph-item-sub` | 제목 + "첫 저자 성 외 · 연도 · 피인용 N" → 누르면 정보 탭 |
| `div.graph-item-meta > span.graph-count[title]` + `span` + `span.chip.success` · `span.chip.accent` | "내 인용 3편과 연결" · "· 같은 참고문헌" · "✓ 서재에 있음" · "원고에 인용함" |
| `div.ref-rec-actions` | 항목 동작 줄(새 클래스 — 버튼 + 글자 링크 한 줄, 넘치면 줄바꿈) |
| `.ref-rec-actions > button.btn.sm[data-ref-insert-key]` | 서재에 있으면 [인용 넣기] |
| `.ref-rec-actions > button.btn.sm[data-ref-add]` · `button.btn.sm[data-ref-addcite]` | 없으면 [＋ 서재에 추가] · [추가하고 인용] |
| `.ref-rec-actions > a.ext-link[data-inha-open]` · `a.ext-link[data-scholar-open]` | 인하대에서 보기↗ · Google Scholar에서 보기↗(글자 링크 — 20편에 테두리 버튼 4개씩은 무거움) |
| `div.graph-progress-card` > `.graph-progress-head` · `.progress[role=progressbar]` · `ol.graph-steps > li[data-step][data-state]` · `p.graph-progress-msg[role=status]` · `.graph-progress-foot` > `button.btn.sm[data-ref-rec-cancel]` | 진행 카드 — **1B 8.1절 카드 그대로**(덮는 층 `.graph-progress` 없이 탭 안에 바로) |
| `div.empty > h3[tabindex=-1] · p · div.empty-actions` | 씨앗 없음 · 결과 0편 · 오류 · 취소(9.6절) |

---

## 1. 공통 원칙

| 항목 | 정한 것 |
|---|---|
| 재사용 | `.panel` · `.tabs` · `.panel-body` · `.reader-bar` · `.pageno` · `.hl-colors` · `.hl-color` · `.pdf-scroll` · `.pdf-pages` · `.sel-pop` · `.ann-pop` · `.ann-item` · `.page-link` · `.ai-cta` · `.empty` · `.empty-actions` · `.spinner` · `.notice[data-tone]` · `.graph-notices` · `.graph-paper(-title · -authors · -venue)` · `.graph-abs-toggle` · `.graph-list-back` · `.graph-intro` · `.graph-items` · `.graph-item(-btn · -title · -sub · -meta)` · `.graph-count` · `.graph-tab-n` · `.graph-progress-card(-head · -msg · -foot)` · `.graph-steps` · `.progress` · `.chip(s)` · `.kv` · `.abstract.clamp` · `.section-title` · `.btn`(`sm` · `primary` · `ghost` · `danger`) · `.icon-btn` · `.ext-link` · `EXT_MARK` · `.sr-only` · `.row` · `.grow` · `.input` |
| 새 클래스 | 0장 머리말의 9개. 새 색 · 새 CSS 변수 **없음**(모두 기존 변수 — 두 테마가 그대로 따라감) |
| 바깥 링크 | 1A 규칙: 새 탭 · `rel="noopener noreferrer"` · ↗ + `(새 탭에서 열림)`. 주소는 `paperProxyTarget()` · `scholarUrl()` · `safeUrl()` 반환값만, 인하대는 `bindExtLink`(처음 안내 창) |
| 넣기 | 모든 넣기는 지금 `insertText(ta, text)` 하나로(새 넣기 코드 없음). 형식은 `refquote.js`(명세 8장) |
| 움직임 | 패널 열고 닫기 · 탭 전환에 애니메이션 없음 |

---

## 2. 진입점 (명세 5.1절)

### 2.1 도구 막대 [참고]

```
[B][I][장][절][• 목록][❝] | [＋ 인용 넣기][참고문헌][✦ AI 도우미 ▾][▥ 참고]        [편집|나란히|미리보기]
                                                              └ 열려 있으면 눌린 모양
```

```html
<button type="button" class="btn sm" data-ref-toggle aria-pressed="false" aria-controls="ref-pane"
  aria-keyshortcuts="Alt+R" title="참고 패널 (Alt+R)">{ICON_REF}참고</button>
```

```html
<!-- ICON_REF: 오른쪽에 칸이 붙은 창. refpane.js에서 export, writing.js가 가져다 씀(구현 반영 ⑥ — 팀장 승인) -->
<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M16.5 8.5h2M16.5 12h2"/></svg>
```

- 열고 닫을 때마다 `aria-pressed`와 `section.writer[data-ref]`를 함께 바꿉니다. CSS가 눌린 모양을 그립니다.
- 390px에서는 도구 막대가 지금처럼 여러 줄로 접히고 [참고]는 둘째 줄 [AI 도우미] 옆에 옵니다(13장 그림).

### 2.2 왼쪽 "이 원고의 인용" — 누를 수 있는 줄

```
이 원고의 인용
┃@vaswani2017attention          ← 지금 패널에 열린 논문(왼쪽 파란 줄)
┃Attention Is All You Need
 @devlin2019bert                 ← 누르면 패널에서 이 논문
 BERT: Pre-training of Deep Bi…
 빈 항목: 쪽
 @kim2023                        ← 서재에 없는 키: 지금 그대로(주황, 누를 수 없음)
 ⚠ 서재에 없는 키
```

```html
<button type="button" class="cite-row" data-ref-open="12" aria-current="true" title="참고 패널에서 보기 · {제목}">
  <code>@vaswani2017attention</code><span class="muted">{제목 60자}</span>
  <span class="warn-text">빈 항목: 쪽</span>   <!-- 있을 때만 -->
</button>
<div class="cite-row missing" title="서재에 이 인용키를 가진 논문이 없어요"><code>@kim2023</code><div class="muted">⚠ 서재에 없는 키</div></div>
```

- 모양은 지금 줄과 같고, 마우스를 올리면 옅은 파랑, 키보드 초점은 2px 테두리.
- `aria-current="true"`는 패널에 열린 논문의 줄 하나에만(논문을 바꾸면 옮김).
- 1100px 이하에서는 왼쪽 칸이 원래 숨으므로 이 진입점도 없습니다(2.1 · 2.3절로 열기).

### 2.3 `[@` 자동완성 — [보기] · Ctrl+Enter

```
┌────────────────────────────────────────────────────────────┐
│ @vaswani2017attention  Attention Is All You Need  2017 [보기] │ ← 고른 줄 · 마우스 올린 줄에만 [보기]
│ @devlin2019bert        BERT: Pre-training of D…   2019        │
│ @kim2023study          트랜스포머 번역 모델의 …    2023        │
│ ↑↓ 고르기 · Enter/Tab 넣기 · Ctrl+Enter 옆에 보기 · Esc 닫기    │
└────────────────────────────────────────────────────────────┘
```

```html
<div class="cs-item active" data-i="0"><code>@…</code><span>{제목}</span><span class="muted">{연도}</span>
  <button type="button" class="btn sm cs-peek" data-ref-peek tabindex="-1" title="참고 패널에서 보기 (Ctrl+Enter)">보기</button></div>
…
<div class="cs-hint">↑↓ 고르기 · Enter/Tab 넣기 · Ctrl+Enter 옆에 보기 · Esc 닫기</div>
```

- [보기]는 `mousedown`에서 `preventDefault()` + `stopPropagation()`(줄의 "넣기"가 같이 일어나지 않게, 원고 초점도 그대로). `tabindex="-1"` — 키보드는 Ctrl+Enter.
- 마우스를 쓸 수 있는 기기에서는 고른 줄 · 마우스 올린 줄에만 보이고(목록을 가볍게), 터치 화면(`hover: none`)에서는 늘 보입니다. 숨은 줄에서도 자리를 차지하므로 글자 칸이 흔들리지 않습니다.
- macOS 안내 문구는 "⌘+Enter 옆에 보기", `title`도 "(⌘+Enter)".

---

## 3. 패널 틀 (명세 5.2 · 5.3 · 7장)

```
┌ 참고 패널 ─────────────────────────────────────┐
│ [Attention Is All You Need            ▾] [＋ 인용] ✕ │ ← .ref-head
│  PDF  하이라이트·노트  요약  정보  추천 20          │ ← .tabs (roving)
├─────────────────────────────────────────────────┤
│ (PDF 탭: 작은 막대 + PDF / 그 밖: .panel-body 스크롤) │
└─────────────────────────────────────────────────┘
```

### 3.1 골격

```html
<aside class="panel ref-pane" id="ref-pane" aria-label="참고 패널">
  <div class="ref-head">
    <select class="input ref-pick" data-ref-pick aria-label="열린 논문" title="{지금 논문 전체 제목}">
      <optgroup label="최근 연 논문">
        <option value="12" selected>{제목 80자}</option>
        <option value="34">{제목 80자}</option>             <!-- 이 원고에서 최근 연 서재 논문 최대 8편, 새것이 위 -->
      </optgroup>
      <option value="__pick">다른 논문 찾기…</option>
    </select>
    <button type="button" class="btn sm" data-ref-cite aria-label="이 논문 인용 넣기" title="이 논문 인용을 원고 커서 자리에 넣어요 ([@{key}])">＋ 인용</button>
    <button type="button" class="icon-btn" data-ref-close aria-label="참고 패널 닫기" title="닫기 (Alt+R)">✕</button>
  </div>
  <div class="tabs" role="tablist" aria-label="참고 자료">
    <button type="button" role="tab" id="ref-tab-pdf" data-ref-tab="pdf" aria-controls="ref-pdf" aria-selected="true" tabindex="0" class="active">PDF</button>
    <button type="button" role="tab" id="ref-tab-notes" data-ref-tab="notes" aria-controls="ref-tabpanel" aria-selected="false" tabindex="-1">하이라이트·노트</button>
    <button type="button" role="tab" id="ref-tab-summary" data-ref-tab="summary" aria-controls="ref-tabpanel" aria-selected="false" tabindex="-1">요약</button>
    <button type="button" role="tab" id="ref-tab-info" data-ref-tab="info" aria-controls="ref-tabpanel" aria-selected="false" tabindex="-1">정보</button>
    <button type="button" role="tab" id="ref-tab-recs" data-ref-tab="recs" aria-controls="ref-tabpanel" aria-selected="false" tabindex="-1">추천<span class="graph-tab-n">20</span></button>
  </div>
  <div class="ref-pdf" id="ref-pdf" role="tabpanel" aria-labelledby="ref-tab-pdf">…5장…</div>
  <div class="panel-body hidden" id="ref-tabpanel" role="tabpanel" aria-labelledby="ref-tab-notes"></div>
</aside>
```

- DOM 순서 = Tab 순서: 고르기 상자 → [＋ 인용] → ✕ → 탭(한 칸) → 탭 내용.
- PDF 탭을 고르면 `.ref-pdf`에서 `hidden`을 빼고 `.panel-body`에 `hidden`, 다른 탭이면 반대. `.panel-body`의 `aria-labelledby`는 지금 탭의 `id`로.
- **PDF는 PDF 탭을 처음 볼 때 받습니다**(명세 4.2절). 다른 탭을 보는 동안 `.ref-pdf`는 숨겨질 뿐 내용은 그대로입니다.

### 3.2 머리줄 — 열린 논문 고르기

| 경우 | 고르기 상자 | [＋ 인용] |
|---|---|---|
| 서재 논문 | `optgroup "최근 연 논문"`(최대 8편) + "다른 논문 찾기…" | 켜짐 |
| 추천에서 연 서재 밖 논문 | 맨 위에 임시 항목 `서재 밖 · {제목}`(선택됨) — 다른 논문으로 바꾸면 사라짐. 서재에 추가하면 그 자리에서 "최근 연 논문"으로 옮김 | 꺼짐, `title="서재에 추가하면 인용할 수 있어요"` |
| 빈 상태(최근 목록 없음) | `열린 논문 없음`(선택됨 · `disabled`) + "다른 논문 찾기…" | 꺼짐 |

- "다른 논문 찾기…"를 고르면 상자 값을 원래대로 돌리고 `citePicker(ta, null, { multi: false, onPick })`(지금 것)을 엽니다.
- 항목 글자는 제목 80자(넘으면 "…"). 상자 `title`에 전체 제목.
- **바꾸기는 `change`에서 400ms 늦춰** 적용해 주세요: Windows Chrome은 닫힌 상자에서 ↑↓만 눌러도 `change`가 일어나 한 칸마다 PDF를 받게 됩니다(14장 RD-4).

### 3.3 탭

| 탭 | 내용 | 서재 밖 논문 |
|---|---|---|
| PDF | 5장 | `aria-disabled="true"` → 잠김 상태(3.4절) |
| 하이라이트·노트 | 6장 | 잠김 |
| 요약 | 7장 | 잠김 |
| 정보 | 8장 | 서재 밖 모양(8.2절) |
| 추천 | 9장 | 그대로(이 원고 기준이므로 논문과 무관) |

- 탭 이름은 줄바꿈하지 않고, 칸이 좁으면 탭 줄만 가로로 스크롤됩니다(스크롤 막대 숨김 — 390px에서도 다섯 개가 한 줄에 들어감, 13장).
- 추천 개수(`span.graph-tab-n`)는 결과가 있을 때만. 계산 중 · 오류에는 숫자 없음.
- 논문을 바꾸면 **같은 탭**을 유지합니다(명세 5.2절). 그 탭이 서재 밖이라 잠기면 잠김 상태를 보입니다.

### 3.4 패널 상태 (탭 내용 자리)

| 경우 | 제목(`h3`) | 설명 | 버튼 |
|---|---|---|---|
| 빈 상태(열 논문 없음) — PDF · 하이라이트·노트 · 요약 · 정보 탭 | 옆에 띄워 볼 논문을 골라 주세요 | 원고에 인용한 논문이나 서재 논문을 골라 옆에 띄워 보세요. | **[서재에서 고르기]**(`data-ref-browse`, primary) [추천 보기](`data-ref-goto-recs`) |
| 논문 불러오는 중 | — | — | `div.empty > span.spinner` + `aside[aria-busy=true]` |
| 서재에서 지워진 논문(404) | 서재에서 이 논문을 찾지 못했어요 | 삭제됐을 수 있어요. 최근 목록에서도 뺐어요. | [다른 논문 고르기](`data-ref-browse`) |
| 불러오기 실패(그 밖) | 논문 정보를 불러오지 못했어요 | 잠시 후 다시 시도해 주세요. | [다시 시도](`data-ref-retry`, primary) [다른 논문 고르기] |
| 서재 밖 논문의 잠긴 탭 | 서재에 추가하면 볼 수 있어요 | 추천에서 연 서재 밖 논문은 정보만 볼 수 있어요. 서재에 추가하면 PDF · 하이라이트 · 요약을 볼 수 있어요. | [＋ 서재에 추가](`data-ref-add`, primary) |

```html
<div class="empty"><h3 tabindex="-1">옆에 띄워 볼 논문을 골라 주세요</h3>
  <p>원고에 인용한 논문이나 서재 논문을 골라 옆에 띄워 보세요.</p>
  <div class="empty-actions"><button type="button" class="btn primary" data-ref-browse>서재에서 고르기</button>
    <button type="button" class="btn" data-ref-goto-recs>추천 보기</button></div></div>
```

- 빈 상태에서 PDF 탭이 선택돼 있으면 `.ref-pdf` 대신 `.panel-body`에 위 상자를 그립니다(PDF 칸은 논문이 생길 때 만듦).
- 패널 안 `.empty`는 CSS가 위아래 여백을 70px → 36px로 줄입니다.
- 상태 상자가 사용자의 동작(다시 시도 · 논문 바꾸기) 결과로 나타나면 `h3`로 초점(1B와 같음). 패널을 열 때 나타나면 초점은 3.1절 규칙(고르기 상자).

---

## 4. 화면 배치 — 폭별 격자 (명세 6장 · K-9)

### 4.1 CSS 규칙 (이번에 넣은 것 — 요약)

```css
.ref-pane { display: none; border-left: 0; }
.writer[data-ref="open"] .ref-pane { display: flex; }
.writer[data-ref="open"] .writer-body { grid-template-columns: 220px minmax(0, 1fr) minmax(0, 1fr); }            /* 편집 · 미리보기 보기 */
.writer[data-ref="open"].view-split .writer-body { grid-template-columns: 220px repeat(3, minmax(0, 1fr)); }  /* 1501px 이상 나란히 */
@media (max-width: 1500px) { /* 나란히: 미리보기 숨김 */ … .view-split .writer-preview { display: none; } }
@media (max-width: 1100px) { /* 왼쪽은 개발팀 규칙이 이미 숨김 → 두 칸 */ … minmax(0, 1fr) minmax(0, 1fr) }
@media (max-width: 760px)  { /* 한 칸 · 위아래 반씩(개발팀 규칙의 grid-auto-rows 그대로) */ … minmax(0, 1fr) }
```

- **개발팀이 고친 `.writer` 격자(1100 · 760 · 560px)는 건드리지 않고** 그 위에 `[data-ref="open"]` 규칙만 더했습니다. 패널이 닫혀 있으면 지금 화면과 완전히 같습니다(13.1절 측정).
- 새 단계 폭은 **1500px 하나**(명세 6장). 1101~1500 · 761~1100 · 760 이하는 개발팀 단계와 같은 경계.
- 패널 왼쪽 테두리는 그리지 않습니다: 앞 칸이 편집이면 편집 칸의 오른쪽 테두리가, 미리보기면 배경색 차이(`--surface-3` / `--surface`)가 경계가 됩니다(두 줄 겹침 방지). 760px 이하는 편집 칸의 아래 테두리(개발팀 규칙)가 경계.
- 560px 이하는 개발팀 규칙(미리보기 여백 줄임) 그대로이고 패널 쪽 추가 규칙은 없습니다(탭 줄 가로 스크롤 · 막대 줄바꿈이 모든 폭에서 이미 적용).

### 4.2 폭별 표 (측정값 — 13.1절)

| 화면 폭 | 패널 닫힘(지금 그대로) | 열림 · 나란히 | 열림 · 편집 | 열림 · 미리보기 |
|---|---|---|---|---|
| **1920** | 왼쪽 220 · 편집 850 · 미리보기 850 | 왼쪽 220 · 편집 567 · 미리보기 567 · **참고 567** | 왼쪽 · 편집 850 · 참고 850 | 왼쪽 · 미리보기 850 · 참고 850 |
| **1501** | 220 · 641 · 641 | 220 · 427 · 427 · **427** | 220 · 641 · 641 | 220 · 641 · 641 |
| **1500** | 220 · 640 · 640 | 220 · 편집 640 · 참고 640 (**미리보기 숨김**) | 같음 | 220 · 미리보기 640 · 참고 640 |
| **1280** | 220 · 530 · 530 | 220 · 편집 530 · 참고 530 (미리보기 숨김) | 같음 | 220 · 미리보기 530 · 참고 530 |
| **1100** | 편집 550 · 미리보기 550 | 편집 550 · 참고 550 (미리보기 숨김) | 같음 | 미리보기 550 · 참고 550 |
| **900** | 450 · 450 | 편집 450 · 참고 450 | 같음 | 미리보기 450 · 참고 450 |
| **761** | 381 · 381 | 편집 381 · 참고 381 | 같음 | 미리보기 381 · 참고 381 |
| **760** | 편집 위 · 미리보기 아래(각 321 높이) | 편집 위 · **참고 아래**(반씩) | 같음 | 미리보기 위 · 참고 아래 |
| **390** | 편집 위 · 미리보기 아래(각 328 높이) | 편집 위 · 참고 아래(반씩) | 같음 | 미리보기 위 · 참고 아래 |

(높이는 800px · 844px 창 기준. 모든 경우 `scrollWidth = 화면 폭` — 가로 넘침 없음)

### 4.3 폭별 그림 (패널 열림 · 나란히 보기)

```
1920px
┌────────────────────────────── 원고 막대 · 도구 막대 ([▥ 참고] 눌림) ──────────────────────────────┐
│ 왼쪽 220 │ 편집 567                │ 미리보기 567            │ 참고 567                    │
│ 개요     │ ## 1. 서론              │  1. 서론                │ [Attention Is All …▾][＋인용]✕│
│ 이 원고의│ 순환 신경망 없이 …       │  순환 신경망 없이 …      │ PDF 하이라이트·노트 요약 정보 추천│
│ 인용     │                        │  (Vaswani et al., 2017) │ [2]/15 − 맞춤 ＋ ●●●●● 인용 쪽:…│
│ ┃@vasw…  │                        │                         │ ┌──────── PDF ────────┐       │
└──────────┴────────────────────────┴─────────────────────────┴─────────────────────────────┘

1500px · 1280px (1101~1500)                      ← 미리보기가 먼저 빠짐
┌ 왼쪽 220 ┬ 편집 530 (1280 기준) ──────────┬ 참고 530 ────────────────────┐
│ 개요     │ ## 1. 서론                     │ [Attention …▾] [＋ 인용] ✕   │
│ 이 원고의│ …                             │ PDF | 하이라이트·노트 | …      │
│ 인용     │                               │ (PDF · 목록)                  │
└──────────┴───────────────────────────────┴──────────────────────────────┘
  [나란히] title: "참고 패널을 닫거나 화면을 넓히면 미리보기도 보여요"

1100px · 900px (761~1100)                        ← 왼쪽 칸은 원래 숨음
┌ 편집 450 (900 기준) ───────────┬ 참고 450 ─────────────────┐
│ ## 1. 서론                    │ [Attention …▾] [＋ 인용] ✕ │
│ …                            │ PDF | 하이라이트·노트 | …    │
└──────────────────────────────┴────────────────────────────┘

760px · 390px (760 이하)                          ← 위아래 반씩
┌ 원고 막대 · 도구 막대(여러 줄) ┐
├ 편집 ────────────────────────┤
│ ## 1. 서론                   │
│ …                           │
├ 참고 ────────────────────────┤
│ [Attention …▾] [＋ 인용] ✕   │
│ PDF 하이라이트·노트 요약 정보 추천│
│ [2]/15 − 맞춤 ＋ ●●●●●       │
│               인용 쪽: 인쇄 쪽 │
│ (PDF — 패널 안에서 스크롤)     │
└ 상태 줄 ─────────────────────┘
```

- **미리보기가 숨은 동안**(열림 · 나란히 · 1500px 이하) [나란히] 버튼에 `title` "참고 패널을 닫거나 화면을 넓히면 미리보기도 보여요". 개발팀은 `matchMedia("(max-width: 1500px)")`와 패널 열림으로 붙였다 뗐다 하면 됩니다. 숨겨도 미리보기 계산은 계속(왼쪽 "이 원고의 인용"이 씀).
- 760px 이하 참고 칸 높이 ≈ 330px(390×844 기준): 머리줄 · 탭 · PDF 막대를 빼면 PDF가 약 180px 보입니다. 쓸 만하지만 넉넉하지 않습니다 — 화면을 [편집]으로 두고 패널만 크게 보는 방법은 없습니다(명세 K-9 "반씩"). 실제 휴대폰 확인 뒤 필요하면 팀장에게 비율 조정(예: 편집 2 : 참고 3)을 제안합니다(13.3절).

---

## 5. PDF 탭 (명세 4.2 · 7.1절)

```
[ 2 ] / 15   −  맞춤  ＋   ◉ ● ● ● ●            인용 쪽: 인쇄 쪽(345–360)
┌────────────────────────────── (회색 바탕) ──────────────────────────────┐
│        ┌───── PDF 2쪽 (패널 폭에 맞춤) ─────┐                              │
│        │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │                              │
│  [◉●●●● | 인용으로 넣기 | 메모 | 복사]  ← 글자를 드래그하면 뜨는 상자          │
│        │ ████████████████ (선택한 문장)    │                              │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.1 작은 막대

```html
<div class="ref-pdf" id="ref-pdf" role="tabpanel" aria-labelledby="ref-tab-pdf">
  <div class="reader-bar">
    <div class="pageno"><input class="input" data-page value="1" aria-label="쪽 번호"> / <span data-total>…</span></div>
    <button class="icon-btn" data-zoom="-1" title="축소" aria-label="축소">−</button>
    <button class="btn sm ghost" data-fit title="폭 맞춤">맞춤</button>
    <button class="icon-btn" data-zoom="1" title="확대" aria-label="확대">＋</button>
    <div class="hl-colors" role="group" aria-label="하이라이트 색">
      <button class="hl-color active" data-c="yellow" aria-label="노랑" aria-pressed="true"></button>
      <button class="hl-color" data-c="green" aria-label="초록" aria-pressed="false"></button>
      <button class="hl-color" data-c="blue" aria-label="파랑" aria-pressed="false"></button>
      <button class="hl-color" data-c="pink" aria-label="분홍" aria-pressed="false"></button>
      <button class="hl-color" data-c="purple" aria-label="보라" aria-pressed="false"></button>
    </div>
    <span class="ref-basis" title="{기준 설명}">인용 쪽: 인쇄 쪽(345–360)</span>
  </div>
  <div class="pdf-scroll" tabindex="0" aria-label="PDF 원문"><div class="pdf-pages"></div></div>
</div>
```

| 부분 | 규칙 |
|---|---|
| 막대 | 읽기 화면 막대에서 [← 서재] · 제목 · 패널 버튼(◧)만 뺀 것. data 속성 · 클래스가 같아 `reader.js`의 찾기 코드가 그대로 동작(명세 4.2절 2번) |
| 색 버튼 | 지금 읽기 화면 막대에는 이름이 없음 → 패널 막대에는 `aria-label`(색 이름) · `aria-pressed`(고른 색)를 붙임. 색을 바꾸면 `active`와 `aria-pressed`를 함께(읽기 화면 막대에도 같이 붙이면 좋음 — 선택) |
| 배율 · 색 | 처음은 [맞춤](패널 폭). 배율 · 색은 읽기 화면과 같은 `paperlab.reader` 값 |
| 인용 쪽 기준 | 인쇄 쪽 대응이 되면 "인용 쪽: 인쇄 쪽({첫쪽}–{끝쪽})", `title` "논문의 쪽 범위({첫쪽}–{끝쪽})가 PDF 쪽 수와 같아 인쇄된 쪽 번호로 넣어요". 안 되면 "인용 쪽: PDF 쪽", `title` "논문의 쪽 범위를 모르거나 PDF 쪽 수와 달라 PDF 쪽 번호로 넣어요" |
| 좁은 칸 | 막대는 줄바꿈 허용(CSS). 427px 칸에서는 한 줄, 390px에서는 "인용 쪽 …"이 둘째 줄 오른쪽(13장 그림) |
| PDF 칸 | 바탕 `--surface-3`(읽기 화면과 같음), 위아래 여백만 18 · 40px로 줄임 |

### 5.2 글자 선택 상자 · 하이라이트 상자

```html
<!-- 글자를 드래그했을 때 (임베드 모드) -->
<div class="sel-pop">
  <button class="hl-color active" data-c="yellow" title="하이라이트" aria-label="노랑으로 하이라이트"></button> … (5개)
  <span class="sep"></span>
  <button class="btn sm primary" data-quote title="{직접 인용 설명}">인용으로 넣기</button>
  <button class="btn sm ghost" data-note>메모</button>
  <button class="btn sm ghost" data-copy>복사</button>
</div>

<!-- 칠해진 하이라이트를 눌렀을 때: .row의 [AI에게 묻기] 자리 -->
<div class="sel-pop ann-pop"><div class="row">{색 5개}<span class="spacer"></span>
  <button class="btn sm ghost" data-quote title="{직접 인용 설명}">인용으로 넣기</button></div> …(지금 그대로)</div>
```

- 글자 선택 상자에서는 **[인용으로 넣기]가 주 버튼**(이 화면에 온 목적). 색 · 메모는 지금처럼 하이라이트를 만들고, [인용으로 넣기]는 하이라이트를 만들지 않고 넣습니다(명세 7.1절).
- 넣은 뒤: 상자를 닫고 선택을 지우고 → 원고로 초점(12.3절) → 알림 "원고에 넣었어요".
- 상자 폭은 약 330px(13장 — 390px 화면에서도 화면 안. `placePopup`이 이미 좌우를 맞춤).
- 키보드만으로는 PDF 글자를 고를 수 없습니다(읽기 화면과 같은 제한) — 대안은 하이라이트 목록의 [넣기](6장).

### 5.3 PDF 없음 · 서재 밖

- PDF 없는 서재 논문: `.pdf-pages` 안에 지금 `drawPdfMissing` 그대로(인하대에서 보기 · PDF 첨부). 첨부가 끝나면 **패널 PDF만** 다시 띄움(명세 4.2절 7번 — 원고 화면이 다시 열리지 않음).
- 서재 밖 논문: PDF 탭이 잠김 → 3.4절 잠김 상태.

---

## 6. 하이라이트·노트 탭 (명세 7.2절)

```
3개                                  (전체 ● ● ●)  [.md]
┌──────────────────────────────────────────────────┐
│▌The Transformer allows for significantly more …   │
│▌병렬화 — 서론 2문단 근거로                           │
│▌p.2  2026-10-07          [넣기] 메모 넣기  메모  삭제 │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│▌Self-attention, sometimes called intra-attention… │
│▌p.3  2026-10-07                   [넣기]  메모  삭제 │
└──────────────────────────────────────────────────┘
노트
┌──────────────────────────────────────────────────┐
│ ## 핵심                                (읽기 전용)  │
│ - 순환 구조 없이 어텐션만으로 번역                     │
└──────────────────────────────────────────────────┘
[선택한 부분 넣기]  노트에서 넣을 부분을 고르세요. 노트는 읽기 화면에서 고칠 수 있어요.
```

| 부분 | 규칙 |
|---|---|
| 목록 | 지금 `highlightsTab` 그대로(쪽 순서 · 색 거르기 · 메모 고치기 · 삭제 · `.md`). 임베드 모드에서 항목 끝 버튼만 바뀜: **[넣기]**(테두리 버튼 — 눈에 띄게) · **[메모 넣기]**(메모가 있을 때, ghost) · [메모] · [삭제]. [묻기] 없음 |
| [넣기] | `title="{직접 인용 설명}"`. 형식 명세 8.2절 |
| [메모 넣기] | `title="메모를 내 말로(따옴표 없이) 넣어요"`. 형식 8.3절 |
| p.N | PDF 탭으로 바꾸고 그 쪽으로(PDF를 아직 안 받았으면 받은 뒤). 초점은 `.pdf-scroll` |
| 항목 끝 줄 | 좁은 칸에서는 줄바꿈(CSS) — 날짜 뒤 버튼들이 다음 줄로 |
| 하이라이트 없음 | 지금 문구 그대로(🖍 하이라이트가 없어요 / PDF에서 문장을 드래그하면 …) |
| 노트 | 읽기 전용 `textarea`(회색 바탕 — 고칠 수 없음을 모양으로도), 고정폭 글꼴(읽기 화면 노트 편집기와 같음), 높이 8줄 · 아래 끝을 끌어 늘릴 수 있음 |
| [선택한 부분 넣기] | 노트에서 글자를 고르면 켜짐(`select` · `keyup` · `mouseup`에서 `selectionStart !== selectionEnd`). 꺼져 있을 때도 옆 안내가 이유를 보임 |
| 노트 없음 | `textarea` · 버튼 대신 `p.small.muted` "노트가 없어요. 읽기 화면에서 쓸 수 있어요." |

```html
<div class="section-title">노트</div>
<textarea class="input ref-note" readonly rows="8" aria-label="노트 (읽기 전용)" aria-describedby="ref-note-hint">{노트}</textarea>
<div class="ref-note-actions">
  <button type="button" class="btn sm" data-note-insert disabled aria-describedby="ref-note-hint">선택한 부분 넣기</button>
  <span class="small muted" id="ref-note-hint">노트에서 넣을 부분을 고르세요. 노트는 읽기 화면에서 고칠 수 있어요.</span>
</div>
```

- 이 탭을 열 때마다 `R.annotations`로 다시 그리고, 탭 안에서 고치거나 지우면 바로 다시 그립니다(명세 4.2절 5번).

---

## 7. 요약 탭 (명세 7.3절)

| 상태 | 화면 |
|---|---|
| 불러오는 중 | `.ai-cta > .spinner`(읽기 화면과 같음) |
| 요약 있음 | `drawSummary(body, s, { ask: false })` 그대로 — [물어보기] · [다시 만들기] 없음. 섹션의 p.N → PDF 탭 그 쪽. **넣기 버튼 없음** |
| 요약 없음 | 아래 상자 |
| 불러오기 실패 | `.ai-cta` "요약을 불러오지 못했어요" + [다시 시도](`data-ref-retry`) |

```
              ✦
      아직 AI 요약이 없어요
읽기 화면에서 만들 수 있어요. 원고는 자동으로 저장돼요.
       [읽기 화면에서 열기]
```

```html
<div class="ai-cta" data-ref-summary="none"><div class="big">✦</div><h3>아직 AI 요약이 없어요</h3>
  <p class="small">읽기 화면에서 만들 수 있어요. 원고는 자동으로 저장돼요.</p>
  <a class="btn primary" href="#/read/{id}" data-ref-read>읽기 화면에서 열기</a></div>
```

- **패널에서 요약을 만들지 않습니다**(명세 3장 · 사용자 결정 1 ③ "보여 줌"). 이동만 하고, 읽기 화면에서 [요약 만들기]를 누르게 합니다. 이동할 때 읽기 화면이 **요약 탭으로 열리도록**(`paperlab.reader`의 `tab`을 `"summary"`로 저장한 뒤 이동) 하는 것을 추천합니다 — 단추 이름을 "읽기 화면에서 요약 만들기"로 할지는 14장 RD-3.
- "원고는 자동으로 저장돼요" — 화면을 떠날 때 지금처럼 저장(`closeWriter` → `W.saver.flush`)되므로 안심 문구만 둡니다.

---

## 8. 정보 탭 (명세 7.4절)

### 8.1 서재 논문

```
Attention Is All You Need                    ← 제목(DOI · URL 있으면 새 탭 링크)
A. Vaswani, N. Shazeer, … 외 N명               ← authorsShort(앞 8명)
Advances in Neural Information … · 2017
[인용 넣기] [읽기 화면에서 열기]
(인용 정보가 빈 경우 issuesBox — 채우기 버튼 포함)
인용키  @vaswani2017attention
DOI     10.48550/arXiv.1706.03762 ↗
쪽      5998–6008                            ← 있을 때만(인쇄 쪽 기준을 확인할 수 있게)
초록
The dominant sequence … (6줄)
[펼치기]
```

```html
<div class="graph-paper">
  <h2 class="graph-paper-title" tabindex="-1"><a href="{safeUrl}" target="_blank" rel="noopener noreferrer">{제목}{EXT_MARK}</a></h2>
  <div class="graph-paper-authors">{authorsShort}</div>
  <div class="graph-paper-venue">{학술지} · {연도}</div>
  <div class="actions">
    <button type="button" class="btn sm primary" data-ref-insert-key>인용 넣기</button>
    <a class="btn sm" href="#/read/{id}" data-ref-read>읽기 화면에서 열기</a>
  </div>
  {issuesBox}
  <dl class="kv">
    <dt>인용키</dt><dd><code>@{key}</code></dd>
    <dt>DOI</dt><dd><a href="https://doi.org/{doi}" target="_blank" rel="noopener noreferrer">{doi}{EXT_MARK}</a></dd>
    <dt>쪽</dt><dd>{pages}</dd>
  </dl>
  <div class="section-title">초록</div>
  <div class="abstract clamp" id="ref-abs">{초록}</div>
  <button type="button" class="btn sm ghost graph-abs-toggle" aria-expanded="false" aria-controls="ref-abs">펼치기</button>
</div>
```

- 초록 · [펼치기]/[접기] · "초록이 없어요."는 1B 6.1절 규칙 그대로.
- 인하대 · Scholar 버튼은 **서재 논문에는 넣지 않습니다**(서재 상세에 있음 — 명세 3장).

### 8.2 서재 밖 논문 (추천에서 연 것)

```
[← 추천 목록]
(서재 밖 논문) (내 인용 3편과 연결)
Neural Machine Translation by Jointly Learning to Align and Translate ↗
D. Bahdanau, K. Cho, Y. Bengio
ICLR · 2015
[＋ 서재에 추가][PDF 포함 추가][추가하고 인용][인하대에서 보기 ↗][Google Scholar에서 보기 ↗]
추천 이유  같은 참고문헌 · @vaswani2017attention 외 2편과 연결
피인용    31,250회
DOI       10.48550/arXiv.1409.0473 ↗
초록 …
```

- 버튼 순서 1B와 같음: **담기 → 인용 → 원문 보기 → 다른 곳에서 보기**. 주 버튼은 [＋ 서재에 추가] 하나.
- "추천 이유" = `{kind 문구} · {씨앗 인용키 첫째} 외 {n−1}편과 연결`(씨앗이 하나면 "@키와 연결"). 씨앗 번호 → 인용키는 화면의 `W.papers`로(명세 9.6절).
- 서재에 추가하면 이 화면이 **8.1절 모양으로 바뀌고**(인용키 생김), 탭 잠김이 풀리고, 고르기 상자의 임시 항목이 "최근 연 논문"으로 옮겨집니다.
- [← 추천 목록]: 추천 탭으로 돌아가 그 항목 단추로 초점.

---

## 9. 추천 탭 (명세 7.5 · 9.5~9.9절)

```
이 원고의 인용 9편을 바탕으로 찾았어요 · OpenAlex 기준 2026-10-08      [다시 계산]
┌ ⓘ 원고의 인용이 바뀌었어요. [다시 계산]                                       ┐
┌ ⓘ 한 번에 다 보지 못해 14편 중 9편만 반영했어요. [다시 계산]하면 이어서 반영해요. ✕ ┐
│   OpenAlex 번호가 없는 2편은 빠졌어요.                                        │
Neural Machine Translation by Jointly Learning to Align and Translate
Bahdanau 외 · 2015 · 피인용 31,250
내 인용 3편과 연결 · 같은 참고문헌
[＋ 서재에 추가] [추가하고 인용]  인하대에서 보기 ↗  Google Scholar에서 보기 ↗
──────────────
Sequence to Sequence Learning with Neural Networks
Sutskever 외 · 2014 · 피인용 24,010
내 인용 2편과 연결 · 함께 인용됨 (✓ 서재에 있음)
[인용 넣기]  인하대에서 보기 ↗  Google Scholar에서 보기 ↗
──────────────
Deep Residual Learning for Image Recognition
He 외 · 2016 · 피인용 180,233
내 인용 1편과 연결 · 주제가 비슷함(인용 근거 없음) (✓ 서재에 있음) (원고에 인용함)
[인용 넣기]  인하대에서 보기 ↗  Google Scholar에서 보기 ↗
```

### 9.1 항목

```html
<ol class="graph-items">
  <li class="graph-item">
    <button type="button" class="graph-item-btn" data-ref-rec="W2133564696">
      <span class="graph-item-title">{제목}</span><span class="graph-item-sub">{첫 저자 성} 외 · {연도} · 피인용 {N}</span></button>
    <div class="graph-item-meta"><span class="graph-count" title="@vaswani2017attention · @devlin2019bert · @kim2023 와 연결">내 인용 3편과 연결</span><span>· 같은 참고문헌</span>
      <span class="chip success">✓ 서재에 있음</span><span class="chip accent">원고에 인용함</span></div>
    <div class="ref-rec-actions">
      <!-- 서재에 있으면 -->
      <button type="button" class="btn sm" data-ref-insert-key>인용 넣기</button>
      <!-- 없으면 -->
      <button type="button" class="btn sm" data-ref-add>＋ 서재에 추가</button>
      <button type="button" class="btn sm" data-ref-addcite>추가하고 인용</button>
      <!-- 서재에 없을 때만 (서재에 있는 항목에는 두 링크 없음 — 구현 반영 ②, 팀장 승인). 인하대는 대상이 있을 때만 -->
      <a class="ext-link" href="{paperProxyTarget}" target="_blank" rel="noopener noreferrer" data-inha-open title="{INHA_OPEN_TITLE}">인하대에서 보기{EXT_MARK}</a>
      <a class="ext-link" href="{scholarUrl}" target="_blank" rel="noopener noreferrer" data-scholar-open title="{SCHOLAR_LIBRARY_NOTE}">Google Scholar에서 보기{EXT_MARK}</a>
    </div>
  </li>
</ol>
```

| 부분 | 규칙 |
|---|---|
| 항목 단추 | 1B `itemEl`과 같은 모양(제목 + 한 줄 정보). 누르면 정보 탭(8.2절, 서재에 있으면 그 서재 논문을 패널에 열어 8.1절). 지금 정보 탭에 보이는 논문 단추에 `aria-current="true"` |
| 연결 수 | `span.graph-count` "내 인용 {linked}편과 연결"(굵게). `title`에 씨앗 인용키 최대 3개 |
| 연결 종류 | 이어서 `· 같은 참고문헌`(coupling) · `· 함께 인용됨`(cocitation) · `· 주제가 비슷함(인용 근거 없음)`(related) |
| 칩 | "✓ 서재에 있음"(`chip success`, `in_library`가 있을 때) · "원고에 인용함"(`chip accent`, 그 서재 논문 id가 원고 인용 논문 id와 같을 때) — 색만이 아니라 글자로 구분 |
| 동작 줄 | 버튼은 테두리 `btn sm`(주 버튼 없음 — 20편이 모두 파랗지 않게). 인하대 · Scholar는 글자 링크(`.ext-link`) — 1A 규칙 · `bindExtLink`, Scholar 질의 = 제목(없으면 DOI). **서재에 있는 항목에는 두 링크를 두지 않음**([인용 넣기]만 — 서재 추가 직후에도 다시 그려져 링크가 빠짐) |
| 정렬 | 서버 순서 그대로, 바꾸기 · 거르기 없음 |

### 9.2 서재 추가 · 추가하고 인용

| 동작 | 화면 |
|---|---|
| [＋ 서재에 추가] | 1B `doAdd`와 같음: 단추 `disabled` + `<span class="spinner"></span> 추가 중` → 성공하면 두 단추를 **[인용 넣기]로 바꾸고** "✓ 서재에 있음" 칩을 더함 → 알림 "서재에 추가했어요" → 초점은 새 [인용 넣기]. 실패하면 단추를 되돌림(오류는 `addPaper`가 알림) |
| [추가하고 인용] | 같은 진행 표시("추가 중") → 성공하면 받은 인용키로 `[@키]`를 원고에 넣음 → 알림 "서재에 추가하고 원고에 인용했어요" → 초점은 원고(12.3절). 항목은 위와 같이 바뀜 |
| [PDF 포함 추가] | 정보 탭에만(진행 문구 "PDF 받는 중") |
| [인용 넣기] | `[@키]`(명세 8.4절) → "원고에 넣었어요" |

- 추가가 끝나면 서재 목록을 새로 받아(`libraryPapers(true)`) 자동완성 · 왼쪽 목록 · 미리보기의 주황 표시가 바로 풀리게 합니다(명세 16장).

### 9.3 진행 (SSE `progress`)

```
┌─────────────────────────────────────────┐
│ ◌ 참고할 논문을 찾는 중…                    │
│ ███████░░░░░░░░░░░░░                      │
│ ● 인용 논문 정보 모으기  3/12               │
│ ○ 초록 받기                                │
│ ○ 추천 계산                                │
│ 인용 논문 정보를 모으는 중 (3/12)            │
│ 처음 계산하면 10~40초 걸릴 수 있어요.   [취소] │
└─────────────────────────────────────────┘
```

```html
<div data-ref-recs="loading">
  <div class="graph-progress-card">
    <div class="graph-progress-head"><span class="spinner" aria-hidden="true"></span>참고할 논문을 찾는 중…</div>
    <div class="progress" role="progressbar" aria-label="추천 찾기 진행" aria-valuemin="0" aria-valuemax="100" aria-valuenow="30"><div style="width:30%"></div></div>
    <ol class="graph-steps">
      <li data-step="seeds" data-state="now" aria-current="step">인용 논문 정보 모으기 <span class="graph-step-msg">3/12</span></li>
      <li data-step="finish" data-state="todo">초록 받기</li>
      <li data-step="compute" data-state="todo">추천 계산</li>
    </ol>
    <p class="graph-progress-msg" role="status">{서버 message 그대로}</p>
    <div class="graph-progress-foot"><span class="small muted">처음 계산하면 10~40초 걸릴 수 있어요.</span>
      <button type="button" class="btn sm" data-ref-rec-cancel>취소</button></div>
  </div>
</div>
```

| 항목 | 규칙 |
|---|---|
| 단계 | 서버 `step` 세 개(`seeds` · `finish` · `compute`) = 목록 세 줄. 오면 그 단계 `now`, 앞 단계는 모두 `done`(1B와 같은 ✓ ● ○ + `(완료)`) |
| `wait` | 목록 줄이 아님 — `seeds`를 `now`로 두고 메시지 줄 "다른 그래프나 추천이 끝나기를 기다리는 중이에요" |
| 숫자 | 서버 `message`의 `(3/12)`를 단계 줄 `.graph-step-msg`에도 `3/12`로 남김(정규식 `/\((\d+\/\d+)\)/`) |
| 막대 | `progress × 100`. 첫 이벤트 전 · 캐시로 바로 끝날 때는 `.progress.indeterminate` |
| 처음 0.4초 | 캐시면 보통 바로 `done` → **카드는 0.4초 뒤에 보이기**(번쩍임 방지, 1B 규칙) |
| 화면 읽기 | `role=status`는 단계가 바뀔 때만 문구를 바꿈 |
| 다른 탭 · 패널 닫기 | 계산은 계속(명세 5.3 · 9.9절). 돌아오면 그때 상태(카드 또는 결과)를 그림 |
| [취소] | 스트림 끊기 → 취소 상태(9.6절) |

### 9.4 결과 머리 · 알림 상자

```html
<div class="row"><p class="graph-intro grow">이 원고의 인용 <b>{used}편</b>을 바탕으로 찾았어요 · OpenAlex 기준 {built_on}</p>
  <button type="button" class="btn sm" data-ref-rec-retry>다시 계산</button></div>
<div class="graph-notices" data-ref-notices>{알림 상자들}</div>
<ol class="graph-items">…</ol>
```

알림 상자는 아래 순서로, 해당하는 것만 그립니다. 경고 `code`의 문구는 화면이 고르고, 모르는 `code`는 서버 `message`를 ③ 상자에 그대로(1B GD-4 규칙).

| 순서 | `data-code` | 상자 | 문구 | 닫기 |
|---|---|---|---|---|
| ① | `stale`(화면 전용) | 파랑 | 원고의 인용이 바뀌었어요. + `button.btn.sm[data-ref-rec-retry]` 다시 계산 | 없음(다시 계산하면 사라짐) |
| ② | `coverage`(묶음) | 파랑 | 줄마다: `partial` → "한 번에 다 보지 못해 {total}편 중 {used}편만 반영했어요. [다시 계산]하면 이어서 반영해요." / `seeds_capped` → "인용이 많아 처음 나온 20편만 바탕으로 했어요." / 화면 계산 → "OpenAlex 번호가 없는 {k}편은 빠졌어요." | ✕ |
| ③ | `failed`(묶음) | 주황 | 머리 **"일부 정보 없이 찾았어요."** 추천이 덜 정확할 수 있어요. + 목록: `refs_partial` 참고문헌 일부를 받지 못했어요. · `citing_failed` 이 논문을 인용한 논문을 받지 못했어요.(1B와 같은 문구 — 2026-10-08 개발팀 변경) · `abstracts_failed` 일부 논문의 초록을 받지 못했어요. · `stale_cache` 일부 정보가 오래됐을 수 있어요. · 모르는 code → 서버 `message` | ✕ |
| ④ | `upstream_limited` | 주황 | OpenAlex 하루 사용량을 다 써서 저장돼 있던 정보로만 찾았어요(한국 시간 오전 9시에 초기화). 설정에서 OpenAlex API 키를 넣으면 한도가 10배가 돼요. + `button.btn.sm[data-ref-settings]` 설정 열기 | ✕ |
| ⑤ | `weak_citation_data` | 파랑 | 인용 정보가 적어 주제가 비슷한 논문으로 보강했어요. **‘주제가 비슷함’** 은 인용 근거가 없는 추천이에요. (국문 논문은 OpenAlex 인용 정보가 적은 편이에요.) | ✕ |

- 아이콘: 파랑 = `ICON_INFO`, 주황 = `ICON_WARN`(지금 `dialogs.js` · `graph.js`에 같은 것이 따로 있음 — `dialogs.js`에서 export해 셋이 같이 쓰기 제안).
- 닫은 상자는 **이 결과 동안만** 숨김(다시 계산하면 다시 나옴).
- `{k}`(번호 없는 편수) = 원고 인용 서재 논문 중 `openalex_id`가 없는 수(화면이 계산 — 서버는 알려 주지 않음). 0이면 그 줄 없음.

### 9.5 원고 인용이 바뀔 때

- 추천 탭을 **열 때** 씨앗이 바뀌었으면 자동으로 다시 계산(카드).
- 탭을 **보는 동안** 바뀌면 ① 상자만 띄움(자동으로 다시 하지 않음 — 명세 K-7). 같은 씨앗으로 돌아가면(인용을 지웠다 되살림) ① 상자를 뺌.

### 9.6 상태 화면 (탭 안 `.empty`)

| 경우 | `data-ref-recs` | 제목 | 설명 | 버튼 |
|---|---|---|---|---|
| 원고에 인용 없음 | `noseed` | 아직 인용한 논문이 없어요 | 원고에 인용한 논문을 바탕으로 찾아요. `[@`로 서재 논문을 인용해 보세요. | 없음 |
| 인용 논문에 OpenAlex 번호가 하나도 없음(화면 판단 · 서버 400 `no_seeds`) | `nonumber` | 인용한 논문으로 찾을 수 없어요 | 인용한 논문에 OpenAlex 번호가 없어 찾을 수 없어요. 서재 상세의 [인용 그래프 보기]를 한 번 열면 번호가 채워져요. | 없음 |
| 결과 0편 | `empty` | 연결된 논문을 찾지 못했어요 | 인용한 논문들과 연결된 논문을 찾지 못했어요. OpenAlex에 인용 정보가 적은 논문(국문 등)일 수 있어요. | [다시 계산] |
| `upstream_limited`(SSE error) | `error` | OpenAlex 하루 사용량을 다 썼어요 | 한국 시간 오전 9시에 초기화돼요. 설정에서 OpenAlex API 키(무료)를 넣으면 한도가 10배가 돼요. | [설정 열기] |
| `upstream_unavailable` | `error` | OpenAlex에 연결할 수 없어요 | 잠시 후 다시 시도해 주세요. | [다시 시도] |
| `internal` · 알 수 없는 오류 | `error` | 추천을 찾지 못했어요 | 잠시 후 다시 시도해 주세요. | [다시 시도] |
| 429 `graph_busy` | `error` | 이미 그래프나 추천을 만드는 중이에요 | 다른 탭에서 그래프나 추천을 만드는 중이에요. 끝난 뒤 다시 눌러 주세요. | [다시 시도] |
| 503 `graph_queue_full` | `error` | 지금 요청이 많아요 | 잠시 후 다시 시도해 주세요. | [다시 시도] |
| 400 `bad_request` | `error` | 추천 요청이 올바르지 않아요 | 원고를 다시 열어 보고, 계속되면 알려 주세요. | [다시 시도] |
| 연결이 중간에 끊김 | `error` | 연결이 끊겼어요 | 그동안 받은 정보는 저장돼 있어서 다시 계산하면 더 빨라요. | [다시 시도] |
| [취소] | `cancelled` | 추천 찾기를 취소했어요 | 그동안 받은 정보는 저장돼 있어서 다시 계산하면 더 빨라요. | [다시 계산] |

- 버튼 data 속성: [다시 계산] · [다시 시도] `data-ref-rec-retry`(첫 버튼 primary), [설정 열기] `data-ref-settings`(`settingsDialog()`).
- `noseed` · `nonumber`는 **서버를 부르지 않습니다**(화면 판단).
- 이전 결과가 있는데 다시 계산이 실패하면: 이전 목록을 그대로 두고 맨 위에 주황 상자(`data-code="retry_failed"`) "다시 계산하지 못했어요. 이전 결과를 그대로 보여 드려요. ({오류 제목})" + ✕(1B `resize_failed`와 같은 방식).

---

## 10. 원고에 넣기와 U-1 (명세 8장 · 15.1절)

### 10.1 설정값 한 곳

U-1은 기본값 그대로 확정됐고(2026-10-08) 설정 창은 만들지 않습니다(RD-5). 직접 인용 모양은 **`refquote.js`의 설정값 하나**에서만 정하고 화면 문구 · 툴팁 · 시험은 모두 이 값에서 만듭니다.

```js
// refquote.js — U-1 사용자 결정(2026-10-08): APA 방식 + 둥근 따옴표
export const QUOTE_STYLE = { mode: "apa", quotes: "curly", blockWords: 40 };
//   mode:   "apa"(짧으면 본문 안 · blockWords 이상 블록) | "inline"(늘 본문 안) | "block"(늘 블록)
//   quotes: "curly"(“ ”) | "straight"(" ")
```

- 버튼 이름은 모양과 무관하게 **"인용으로 넣기"** · **"넣기"** 로 고정.
- `title`(툴팁) **`{직접 인용 설명}`** 은 `quoteRuleText(QUOTE_STYLE)`이 만듭니다:

| `mode` | `{직접 인용 설명}` |
|---|---|
| `apa` | 원고 커서 자리에 직접 인용으로 넣어요. 짧으면 {여는}…{닫는}로 본문에, {blockWords}단어 이상이면 인용 블록으로 넣어요. |
| `inline` | 원고 커서 자리에 직접 인용으로 넣어요. 길이와 관계없이 {여는}…{닫는}로 본문에 넣어요. |
| `block` | 원고 커서 자리에 직접 인용으로 넣어요. 늘 인용 블록으로 넣어요. |

(`{여는}` `{닫는}` = `curly` → “ ”, `straight` → " ". 이 문서의 다른 곳 · 화면 · FEATURES.md에 "큰따옴표" · "40단어" 같은 값을 따로 적지 않습니다.)

### 10.2 넣는 것별 정리

| 넣는 곳 | 버튼 | 형식(명세) | 알림 |
|---|---|---|---|
| PDF 선택 상자 · 하이라이트 상자 | 인용으로 넣기 | 직접 인용(8.1절 — `QUOTE_STYLE`) | 원고에 넣었어요 |
| 하이라이트 목록 | 넣기 | 직접 인용(8.2절) | 원고에 넣었어요 |
| 하이라이트 목록 | 메모 넣기 | `{메모} [@키, p. N]`(8.3절) | 원고에 넣었어요 |
| 노트 | 선택한 부분 넣기 | `{고른 글} [@키]`(8.3절) | 원고에 넣었어요 |
| 머리줄 · 정보 · 추천 | ＋ 인용 · 인용 넣기 | `[@키]`(8.4절) | 원고에 넣었어요 |
| 추천 · 정보(서재 밖) | 추가하고 인용 | 추가 뒤 `[@새 키]` | 서재에 추가하고 원고에 인용했어요 |

- **인쇄 쪽 번호를 모르는 논문**에서 처음 넣을 때 한 번(명세 8.5절 2번): 알림 · 토스트 "인쇄된 쪽 번호를 알 수 없어 PDF 쪽({n})으로 넣었어요. 필요하면 원고에서 고쳐 주세요."(토스트 8초).
- **편집 칸이 숨어 있을 때**(미리보기 보기): 화면 읽기 알림에 더해 **토스트 "원고에 넣었어요"**(눈으로도 확인 — 편집 칸이 보이면 토스트 없음, 넣은 글이 바로 보이므로).

---

## 11. 문구 모음 (한곳에서 찾기)

| 위치 | 문구 |
|---|---|
| 도구 막대 | 참고 / 툴팁: 참고 패널 (Alt+R) |
| [나란히] 툴팁(미리보기 숨음) | 참고 패널을 닫거나 화면을 넓히면 미리보기도 보여요 |
| 왼쪽 인용 줄 툴팁 | 참고 패널에서 보기 · {제목} |
| 자동완성 | 보기 / 툴팁: 참고 패널에서 보기 (Ctrl+Enter) / 안내 줄: ↑↓ 고르기 · Enter/Tab 넣기 · Ctrl+Enter 옆에 보기 · Esc 닫기 (macOS ⌘+Enter) |
| 패널 이름 | 참고 패널 / 탭 묶음: 참고 자료 |
| 머리줄 | 열린 논문(상자 이름) · 최근 연 논문(묶음) · 다른 논문 찾기… · 서재 밖 · {제목} · 열린 논문 없음 / ＋ 인용(이름: 이 논문 인용 넣기, 툴팁: 이 논문 인용을 원고 커서 자리에 넣어요 ([@{key}]) · 꺼짐: 서재에 추가하면 인용할 수 있어요) / 참고 패널 닫기 · 닫기 (Alt+R) |
| 탭 | PDF · 하이라이트·노트 · 요약 · 정보 · 추천 |
| 빈 · 오류 · 잠김 | 3.4절 표 |
| PDF 막대 | 쪽 번호 · 축소 · 폭 맞춤(맞춤) · 확대 · 하이라이트 색: 노랑 · 초록 · 파랑 · 분홍 · 보라 / 인용 쪽: 인쇄 쪽({첫}–{끝}) · 인용 쪽: PDF 쪽 (툴팁 5.1절) / PDF 원문(칸 이름) |
| 선택 상자 | (색)으로 하이라이트 · 인용으로 넣기 · 메모 · 복사 |
| 하이라이트 목록 | 넣기 · 메모 넣기(툴팁: 메모를 내 말로(따옴표 없이) 넣어요) · 메모 · 삭제 |
| 노트 | 노트 · 노트 (읽기 전용) · 선택한 부분 넣기 · 노트에서 넣을 부분을 고르세요. 노트는 읽기 화면에서 고칠 수 있어요. · 노트가 없어요. 읽기 화면에서 쓸 수 있어요. |
| 요약 | 아직 AI 요약이 없어요 · 읽기 화면에서 만들 수 있어요. 원고는 자동으로 저장돼요. · 읽기 화면에서 열기 · 요약을 불러오지 못했어요 · 다시 시도 |
| 정보 | 인용 넣기 · 읽기 화면에서 열기 · 인용키 · DOI · 쪽 · 초록 · 펼치기 · 접기 · 초록이 없어요. / 서재 밖: ← 추천 목록 · 서재 밖 논문 · 내 인용 {n}편과 연결 · ＋ 서재에 추가 · PDF 포함 추가 · 추가하고 인용 · 인하대에서 보기 · Google Scholar에서 보기 · 추천 이유 · 피인용 {N}회 · (진행) 추가 중 · PDF 받는 중 |
| 추천 머리 | 이 원고의 인용 {used}편을 바탕으로 찾았어요 · OpenAlex 기준 {날짜} · 다시 계산 |
| 추천 항목 | {성} 외 · {연도} · 피인용 {N} / 내 인용 {n}편과 연결 · 같은 참고문헌 · 함께 인용됨 · 주제가 비슷함(인용 근거 없음) / ✓ 서재에 있음 · 원고에 인용함 / 인용 넣기 · ＋ 서재에 추가 · 추가하고 인용 · 인하대에서 보기 · Google Scholar에서 보기 |
| 추천 진행 | 참고할 논문을 찾는 중… · 인용 논문 정보 모으기 · 초록 받기 · 추천 계산 · 다른 그래프나 추천이 끝나기를 기다리는 중이에요 · 처음 계산하면 10~40초 걸릴 수 있어요. · 취소 · (완료) / 막대 이름: 추천 찾기 진행 |
| 추천 알림 · 상태 | 9.4 · 9.6절 표 |
| 넣기 설명 | 10.1절 `{직접 인용 설명}` |
| 화면 읽기 알림 | 12.4절 표 |

---

## 12. 접근성 · 키보드 (명세 11장)

### 12.1 단축키

| 키 | 어디서 | 동작 |
|---|---|---|
| **Alt+R** | 원고 화면 어디서나(대화상자가 열려 있으면 무시) | 닫혀 있으면 **열고 고르기 상자로 초점**. 열려 있고 초점이 패널 밖이면 **패널로 초점만**(닫지 않음), 초점이 패널 안이면 **닫고 원고로**(14장 RD-1 — 명세의 단순 열기/닫기 전환을 바꿈). `e.code === "KeyR" && e.altKey && !e.ctrlKey && !e.metaKey` + `preventDefault()`(macOS Option+R의 ® 막기) |
| **Ctrl+Enter**(macOS ⌘+Enter) | `[@` 자동완성이 떠 있을 때 | 고른 논문을 패널에서 보기. 넣지 않음 · 목록 · 원고 초점 그대로 |
| ← → · Home · End | 패널 탭 | 탭 이동(자동으로 그 탭 열기, 1B와 같음). 꺼진 탭(`aria-disabled`)에도 멈춤 |
| Enter | 쪽 번호 칸 | 그 쪽으로(지금과 같음) |
| Esc | 패널 안 | 12.3절 |

- **원고 칸에서는 Tab이 공백 두 칸을 넣기 때문에** Tab으로 패널에 갈 수 없습니다(지금 동작). 그래서 Alt+R이 "패널로 가기"도 맡아야 합니다(RD-1).
- 도구 막대 [참고] 버튼에 `aria-keyshortcuts="Alt+R"`, 툴팁에도 표시.

### 12.2 탭 · 이름

| 항목 | 정한 것 |
|---|---|
| 패널 | `aside[aria-label="참고 패널"]` |
| 고르기 상자 | 이름 "열린 논문" + 값(지금 논문 제목)이 읽힘 → 패널 제목 역할 |
| 탭 | `role=tablist/tab/tabpanel` · `aria-selected` · `aria-controls` · roving tabindex(1B 그래프 패널과 같음). 탭 이름에 개수가 붙으면 "추천 20" |
| 꺼진 탭 | `aria-disabled="true"`(초점은 받고, 고르면 잠김 이유를 보임) |
| 색만으로 구분하지 않기 | 칩 글자("✓ 서재에 있음" · "원고에 인용함" · "서재 밖 논문"), 색 버튼 `aria-label`, 진행 단계 ✓ ● ○ + `(완료)`, 연결 종류 글자, 지금 연 논문 = 왼쪽 줄 `aria-current` |
| 대비 | 모두 기존 글자 · 배경 변수(두 테마 AA). 꺼진 탭(55% 흐림)은 꺼진 컨트롤이라 대비 기준 밖 |
| 포커스 링 | 탭 · 왼쪽 인용 줄 `outline 2px var(--accent)`, 항목 단추는 1B 규칙 그대로 |

### 12.3 초점 규칙 (넣은 뒤 원고로 돌아가기)

| 동작 | 초점 |
|---|---|
| [참고] · Alt+R로 열기, 왼쪽 인용 줄 누르기 | 고르기 상자(`[data-ref-pick]`) |
| 자동완성 Ctrl+Enter · [보기] | **원고 그대로**(입력이 끊기지 않음) + 알림 "참고 패널에서 {제목}을 열었어요" |
| 패널 닫기([✕] · [참고] · 패널 안에서 Alt+R) | 원고 편집 칸(보이면). 미리보기 보기라 숨어 있으면 [참고] 버튼 |
| **모든 넣기**(인용으로 넣기 · 넣기 · 메모 넣기 · 선택한 부분 넣기 · 인용 넣기 · ＋ 인용 · 추가하고 인용) | **원고 편집 칸, 커서는 넣은 글 바로 뒤**(지금 `insertText` 동작). 편집 칸이 숨어 있으면 누른 단추에 그대로(+ 토스트, 10.2절) |
| [서재에 추가](추천 항목) | 새로 생긴 [인용 넣기] |
| 추천 항목 단추 | 정보 탭 제목(`h2.graph-paper-title[tabindex=-1]`) |
| [← 추천 목록] | 추천 탭의 그 항목 단추 |
| p.N(하이라이트 · 요약) | PDF 탭으로 바꾸고 `.pdf-scroll` |
| [다시 시도] · 논문 바꾸기 뒤 상태 화면 | 그 상태 화면 `h3` |
| **Esc**(패널 안) | 선택 상자 · 하이라이트 상자가 떠 있으면 그것만 닫음 → 아니면 **원고 편집 칸**(숨어 있으면 [참고] 버튼). 패널은 닫지 않음. 대화상자가 열려 있으면 대화상자가 먼저(지금 동작) |

- "원고로 돌아갈 때" 커서 자리는 원고가 마지막으로 가졌던 선택 위치입니다(`textarea`가 기억). 넣기는 그 자리에 들어갑니다.

### 12.4 화면 읽기 알림 (`[data-ref-live]` — `section.writer` 끝, 늘 빈 채로)

| 때 | 알림 |
|---|---|
| 넣기 | 원고에 넣었어요 |
| 서재 추가 | 서재에 추가했어요 |
| 추가하고 인용 | 서재에 추가하고 원고에 인용했어요 |
| 자동완성에서 보기 | 참고 패널에서 {제목}을 열었어요 |
| 추천 끝남 | 추천 {n}편을 찾았어요. (알림 상자가 있으면 + " 알림 {k}개가 있어요.") |
| 추천 0편 · 오류 | 상태 화면 제목 그대로 |
| 원고 인용이 바뀜(추천 탭을 보는 중) | 원고의 인용이 바뀌었어요. 다시 계산할 수 있어요. |
| 인쇄 쪽 모름(처음 한 번) | 인쇄된 쪽 번호를 알 수 없어 PDF 쪽({n})으로 넣었어요. 필요하면 원고에서 고쳐 주세요. |

- 같은 문구가 연달아 와도 읽히도록 비웠다가 다음 틱에 넣어 주세요(1B `announce`와 같은 방식).
- 진행 단계는 카드 안 `role=status`가 따로 읽습니다(9.3절).

### 12.5 움직임 · 기타

- 애니메이션 없음(패널 열기 · 탭). 스피너는 기존(`prefers-reduced-motion` 처리는 기존 그대로).
- PDF 글자 선택은 마우스 · 터치만(명세 11장). 키보드 사용자는 하이라이트 목록의 [넣기] · 노트 선택으로 같은 일을 할 수 있습니다.

---

## 13. 확인 결과 · 남은 것

### 13.1 CSS 변경

- `app.css` 맨 끝에 **56줄 추가**(1370 → 1426줄). 기존 1370줄(개발팀의 커밋 전 `.writer` 격자 변경 포함)은 작업 전 사본과 바이트 비교로 그대로임을 확인, 줄 끝 CRLF 유지(LF만 있는 줄 0).
- 새 클래스 9개(0장 머리말), 새 변수 없음. 나머지는 기존 클래스에 패널 안 범위 규칙(`.ref-pane …`)만.
- **격자 측정**(시험 페이지 — 보기 3가지 × 패널 열림/닫힘, 칸 폭 · 높이 · `scrollWidth`): 1920 · 1501 · 1500 · 1100 · 900 · 761 · 760 · 560 · 390px 모두 4.2절 표와 같고 가로 넘침 0. **패널을 닫은 상태는 개발팀 격자와 칸 폭이 같음**(1920 220/850/850, 1280 220/530/530, 1100 550/550, 760 위아래 반씩).

### 13.2 확인한 것 (정적 시험 페이지)

- 시험 페이지: 디자인팀 scratchpad `refpane/index.html`(저장소 밖 — **실제 `app.css` 사본**, 가짜 PDF 쪽 · 가짜 데이터, 주소 `?tab=…&theme=dark&view=…&pop=…`로 상태 전환). 스크린샷 `refpane/shots/`.
- 1280px(headless Chrome): PDF 탭 + 글자 선택 상자, 하이라이트·노트, 추천(알림 상자 · 칩 · 동작 줄), 정보(서재 밖 · 잠긴 탭) — **밝은 · 어두운 테마** 모두. 1920px 정보 탭(세 칸 + 패널), 900px 추천(어두운), 1280px 미리보기 보기 + 토스트.
- 390px(폭 390 iframe — 브라우저 창 최소 폭 제한 때문): PDF 탭 + 선택 상자, 하이라이트·노트, 추천(어두운), 추천 진행 카드, 빈 상태(어두운), 자동완성 [보기](어두운). 탭 다섯 개 한 줄, 머리줄 · 막대 넘침 없음, 선택 상자 화면 안.
- 확인하며 정한 것: 패널 왼쪽 테두리 없음(편집 칸 테두리와 두 줄 겹침), `.ref-pdf`는 `hidden` 속성 대신 `.hidden` 클래스(`display:flex`가 속성을 이김), 알림 자리를 패널 밖으로(닫힌 패널 안 live 영역은 안 읽힘), 추천 동작 줄의 인하대 · Scholar를 글자 링크로(테두리 버튼 4개 × 20편이 무거움), [다시 계산]은 머리 한 줄로 모음.

### 13.3 못 한 것 · 남은 것

- **실제 앱 화면**(시안 작성 때 기준 — 지금은 화면 코드가 들어옴, 13.4절): JS(`refpane.js` · 임베드 모드)가 아직 없어 로그인한 앱에서는 못 봤습니다. 특히 ① 실제 PDF.js가 패널 폭에 [맞춤]으로 맞는지 · 다른 탭에서 돌아와도 배율이 그대로인지(명세 4.2절 6번) ② 선택 상자가 패널 오른쪽 끝에서 잘리지 않는지 ③ 자동완성 [보기]의 `mousedown` 처리 ④ 고르기 상자 ↑↓ 연속 변경(RD-4) — 구현 뒤 품질팀 M-R01 · M-R02 · M-R08에서.
- **Alt+R 겹침**: Windows Chrome · Edge · Firefox · 한글 입력 상태(M-R10) — 못 함.
- 화면 읽기 프로그램(NVDA)으로 알림 · 탭 · 고르기 상자 이름 읽힘, Firefox · Safari, Windows 고대비 — 못 함.
- **760px 이하 높이**: 390×844에서 참고 칸 약 330px, PDF가 보이는 높이 약 180px. 실제 휴대폰에서 불편하면 비율 조정을 팀장에게 제안(4.3절). 추천 탭은 알림 상자가 둘 이상이면 첫 항목이 칸 아래로 밀림(✕로 닫을 수 있음).
- 390px 그림은 iframe, 1280 · 1920 · 900px는 headless Chrome 창 크기로 찍었습니다(실제 기기 아님).

### 13.4 1C 구현 뒤 (개정 2026-10-08 — 동작 표는 기획팀이 코드 · FEATURES.md 8장 "참고 패널" 절을 읽고 정리, 확인 결과는 개발팀 시험 페이지)

화면 코드(`static/js/refpane.js` · `refquote.js`, `reader.js` 임베드 모드 `mountPdf` · `embedPdf` · `highlightsTab(body, { onInsert })` · `drawSummary(body, s, { ask })`, `writing.js`)는 이 문서의 클래스 · `data-` 속성 · 문구를 씁니다. 아래는 코드와 FEATURES.md에 있는 사실만 적었습니다.

| 항목 | 지금 동작 (코드 · FEATURES.md 8장) |
|---|---|
| 여는 곳 · Alt+R | [참고](`ICON_REF` + "참고", `title` "참고 패널 (Alt+R)") · Alt+R, 왼쪽 *이 원고의 인용* 줄, `[@` 자동완성 Ctrl+Enter(macOS ⌘+Enter) · [보기](`mousedown`으로 처리 — 넣기가 같이 일어나지 않고 원고 초점 그대로). Alt+R = 열기 · 패널로 이동 · (패널 안에서) 닫고 원고로, 패널 안 Esc = 원고로(RD-1) |
| 머리줄 · 탭 | 열린 논문 고르기 상자(최근 8편 + *다른 논문 찾기…*, `change` 400ms 늦춤 — RD-4) · [＋ 인용] · ✕. 탭 PDF · 하이라이트·노트 · 요약 · 정보 · 추천. 서재 밖 논문은 PDF · 하이라이트·노트 · 요약 탭이 잠김(*서재에 추가하면 볼 수 있어요*) |
| PDF 탭 | 패널 폭 [맞춤], 다른 탭을 보는 동안 PDF 칸은 지우지 않고 숨김(`.hidden`), 숨은 칸의 폭 0에서는 배율을 다시 맞추지 않음. 선택 상자 [색 5개 · 인용으로 넣기 · 메모 · 복사]. PDF 없으면 *인하대에서 보기* · *PDF 첨부*(첨부가 끝나면 패널에 PDF) |
| 넣기 | 직접 인용은 `QUOTE_STYLE`(APA · 둥근 따옴표 · 40단어) 하나로, 쪽은 인쇄 쪽/PDF 쪽(막대 끝 *인용 쪽: …*). 편집 칸이 숨어 있으면 토스트(RD-6) |
| 요약 · 정보 | 요약은 물어보기 · 다시 만들기 없음, 없으면 [읽기 화면에서 열기](요약 탭으로 — RD-3). 정보 탭 [인용 넣기] · [읽기 화면에서 열기] · 인용 정보 경고 |
| 추천 | 진행 카드(0.4초 뒤에 보임, 단계 세 줄, [취소]), 결과 머리 + [다시 계산], 알림 상자(인용이 바뀜 · 반영 범위 · 일부 실패 · `upstream_limited` · `weak_citation_data`), 항목 20편 · 칩 · 동작 줄 |
| 화면 읽기 알림 | `section.writer` 끝 `div.sr-only[role=status][data-ref-live]` 하나(패널 밖 — 13.2절에서 정한 대로) |
| 배치 | 1501px 이상 세 칸, 1500px 이하 미리보기 숨김 + [나란히] 설명, 760px 이하 위아래(4장) |

**시안과 다르게 구현된 것** (팀장 승인 — 명세 [writing-reference-pane.md](../specs/writing-reference-pane.md) 15.4절 "구현 반영 ①~⑦")
- 9.1절 HTML의 "늘" 링크: **서재에 있는 추천 항목에는 [인하대에서 보기] · [Google Scholar에서 보기]가 없음**(서재 밖 항목 · 서재 밖 정보 탭에만 — 명세 7.5절). 9.1절 본문을 이에 맞게 고침(2026-10-08).
- 9.3절 [취소] → 취소 상태: **이전 결과가 있으면 취소 상태 대신 이전 목록을 그대로** 보임. 다시 계산이 실패해도 이전 목록 + 알림 "다시 계산하지 못했어요. 이전 결과를 그대로 보여 드려요."
- 9.3절 "화면 읽기": 그대로 구현 — 카드 문구(`role=status`)는 단계가 바뀔 때만 바뀌고, 씨앗 수 `3/12`는 단계 줄 옆에만 갱신.
- 9.5절: 결과가 아직 없을 때(인용 없음 화면 등) 탭을 보는 중에 첫 인용이 생기면 알림 없이 **자동으로 계산** 시작.
- 2.1절 `ICON_REF` "dialogs.js에 두고 같이 쓰기 제안": **`refpane.js`에 두고** `writing.js`가 가져다 씀. 2.1절 본문을 이에 맞게 고침(2026-10-08).
- 12.4절 "참고 패널에서 {제목}을 열었어요": 조사를 제목 끝 글자로 고름(받침 있음 "을" · 없음 "를" · 한글 아님 "을(를)"). → 개발팀이 문구를 **"참고 패널에서 열었어요: {제목}"** 으로 바꿀 예정(2026-10-08 팀장 전달 — 명세 11장 개정). 12.3 · 12.4절 표의 문구도 그때 이 문구로 읽음.
- 9.4 · 9.6절 `upstream_limited`: 화면은 이 문서의 code별 문구를 씀. 서버가 보내는 문구는 1B 그래프와 같은 문구(경고 "…정보로만 그렸어요…")라 화면에는 나오지 않음(모르는 code일 때만 서버 문구).

**개발팀 확인** (2026-10-08 — 팀장 전달. **실제 static 파일에 가짜 API**(PyMuPDF로 만든 PDF, SSE 추천)를 붙인 시험 페이지, 콘솔 오류 0건)
| 항목 | 결과 |
|---|---|
| 패널 열기 · 닫기 초점 | 열면 고르기 상자, 닫으면 원고. 미리보기 보기에서 닫으면 [참고] 버튼 |
| Alt+R | 닫힘 → 열기, 초점이 밖 → 패널로, 안 → 닫기. `preventDefault` 확인 |
| 패널 안 Esc | 원고로 초점만 옮김(패널은 그대로) |
| 탭 5개 | ← → 이동, roving tabindex, `aria-disabled` |
| PDF | 렌더 · 폭 맞춤(1500px에서 쪽 587px / 칸 625px), 탭을 바꿔도 배율 유지, `/open`을 부르지 않음, PDF 없음 화면 |
| 인용 넣기 | 짧은 인용 `“…” [@vaswani2017attention, p. 347]`, 두 쪽에 걸친 40어절 이상 → `> … [@…, pp. 347–348]` 블록 + 이스케이프, 인쇄 쪽을 모르면 처음 한 번만 안내 |
| 하이라이트 · 노트 · 요약 | 하이라이트 [넣기] · [메모 넣기], 노트 [선택한 부분 넣기]. 요약 탭에 물어보기 · 다시 만들기 없음, p.N은 PDF 탭으로 이동, 요약이 없을 때 링크는 읽기 화면 요약 탭으로 |
| 추천 | 0.4초 뒤 진행 카드 → 결과 9편 + 알림 상자. [서재에 추가] 뒤 초점은 [인용 넣기]로, [추가하고 인용]은 `[@새키]`를 넣고 주황 표시 없음, 인용이 바뀌면 알림. 서재 밖 정보 탭 · 잠긴 탭 · `noopener` 링크. 인용이 없거나 번호가 없으면 서버를 부르지 않음 |
| 저장 | `localStorage`에는 open · tab · 최근 id만 |
| 자동완성 · 토스트 · 새로 고침 | Ctrl+Enter · [보기]를 써도 원고 초점 그대로. 미리보기 보기에서 넣으면 토스트(RD-6). 새로 고침하면 열림 상태 · 논문 · 탭 복원. 읽기 화면 회귀 없음 |
| 패널 연 상태의 칸 폭(가로 넘침 0) | 1920: 220/562/562/562 · 1500: 220/632/632 · 1100: 543/543 · 760: 위아래 371씩 · 390: 위아래 328씩 |
| 다크 모드 | 390px 추천 탭, 1920px PDF 탭 |

**못 한 것 · 남은 것** (개발팀 확인 기준)
- 실제 창 크기를 바꿀 때 `matchMedia` 동작, 실제 업로드 뒤 패널 PDF, 브라우저별 Alt+R 겹침 · NVDA, 실제 OpenAlex 걸린 시간, 실제 마우스 선택 위치(선택 상자가 패널 끝에서 잘리는지 포함).
- 위는 시험 페이지 확인이라 로그인한 실제 앱 · 실제 기기 확인은 아님 — 품질팀 M-R01 · M-R02 · M-R08 · M-R10 · M-R11에서.

---

## 14. 팀장 결정 (2026-10-08 — RD-1~RD-6 모두 **팀장 결정: 디자인팀 안 채택**)

| # | 질문 | 디자인팀 추천(= 팀장 결정) | 다른 안(채택 안 함) |
|---|---|---|---|
| **RD-1** | Alt+R · 닫은 뒤 초점 | **Alt+R = 닫혀 있으면 열기 · 열려 있고 초점이 밖이면 패널로 초점 · 패널 안이면 닫기. 닫으면 원고로 초점**(숨어 있으면 [참고]). 이유: 원고 칸에서는 Tab이 공백을 넣어 키보드로 패널에 갈 길이 Alt+R뿐이고, 닫은 뒤 바로 이어 쓰게 | 명세 그대로(Alt+R 단순 전환, 닫으면 [참고] 버튼) — 열린 패널로 돌아가려면 Alt+R 두 번 |
| **RD-2** | 추천 항목의 [인하대에서 보기] · [Google Scholar] (명세 3장 "안 하는 것"과 다름) | **팀장 지시대로 넣되 글자 링크로**, 추천 항목 · 서재 밖 정보 탭에만(서재 논문 정보 탭에는 없음 — 서재 상세에 있음). 기획팀이 명세 3장 · 7.5절을 고쳐야 함 | 테두리 버튼(1B 패널과 같은 모양) · 넣지 않음(명세 그대로) |
| **RD-3** | 요약이 없을 때 '요약 만들기'로 갈지 | **패널에서 만들지 않고 읽기 화면으로 이동만**, 이동하면 읽기 화면이 **요약 탭**으로 열리게(그곳의 [요약 만들기]를 누름 — AI 비용을 실수로 쓰지 않게). 단추 이름은 명세대로 "읽기 화면에서 열기" | 단추 이름 "읽기 화면에서 요약 만들기"(목적이 더 분명) · 이동하며 바로 만들기 시작(한 번에 되지만 원하지 않는 AI 사용 위험) · 패널 안 [요약 만들기](명세 3장과 다름) |
| **RD-4** | 패널 제목 | **고르기 상자가 제목 겸 초점 자리**(제목 줄을 따로 두지 않음 — 좁은 칸에서 같은 제목 두 번 방지). Windows ↑↓ 연속 변경은 `change` 400ms 늦춤으로 막음 | 고르기 상자 위에 제목 줄 `h2[tabindex=-1]`을 따로(명세 11장 글자 그대로, 세로 한 줄 더 씀) |
| **RD-5** | U-1 직접 인용 모양을 설정 창에 둘지 | **U-1 답을 본 뒤**: "하나로 정해 달라"면 `QUOTE_STYLE` 상수만 바꿈(설정 창 없음), "학술지마다 다르다"면 설정 창 "인용" 구역에 라디오 두 줄(모양 3가지 · 따옴표 2가지)을 추가 — 그때 디자인팀이 시안 보충. 어느 쪽이든 화면 문구는 10.1절 `{직접 인용 설명}`이라 고칠 곳 없음 | 지금 바로 설정 창에 넣기 |
| **RD-6** | 미리보기 보기에서 넣었을 때 토스트 | **편집 칸이 숨어 있을 때만 토스트 "원고에 넣었어요"**(보이면 넣은 글이 바로 보여 중복) | 늘 토스트 · 화면 읽기 알림만 |

- 2026-10-08 팀장 결정: 위 6개 모두 **디자인팀 안 채택**. 사용자 U-1 답 = **APA 방식 + 둥근 따옴표 “ ”**(기본값 그대로) → RD-5에 따라 `QUOTE_STYLE` 상수 그대로, 설정 창 없음. 기획팀이 명세 3장(RD-2 — "안 하는 것"에서 인하대 · Scholar 링크를 뺌) · 5.1 · 5.3 · 6 · 7.3 · 7.4 · 7.5 · 8장 · 11장 · AC-R30 · 15장에 반영했습니다(명세 15.4절 결정 기록).
