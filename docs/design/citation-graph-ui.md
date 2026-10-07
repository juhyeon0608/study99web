# 화면 시안 — 인용 그래프 (1B단계)

- 작성: 디자인팀 · 2026-10-07
- 근거: [기능 명세](../specs/citation-graph.md) 5장(흐름) · 6.3 · 6.8절 · 7.4 · 7.5절(문구) · 9.1~9.3절(API · 이벤트 · 응답 모양) · 10장(화면) · 11장 E · G(화면 수용 기준) · 15장(작업 분담)
- 팀장 결정 반영(2026-10-07): **U-1 그래프를 계정에 기록하지 않음**(최근 그래프 목록 · 화면 없음), **K-1 d3-force로 배치만 계산하고 SVG 그리기 · 확대 · 이동은 직접**, **K-8 논문 수 20 · 40 · 80, 기본 40**, **K-12 별도 화면 `#/graph`, 사이드바 메뉴 없음**.
- 스타일: `paperlab/static/css/app.css` 맨 끝 **"인용 그래프"** 구역(이번에 추가, 245줄 — 1110 → 1355줄). 그 위 기존 1110줄은 바이트 단위로 그대로입니다(줄 끝 CRLF 유지).
- 개발팀은 **0장 표의 클래스 · data 속성 이름 그대로** 마크업하면 됩니다. 색 · 굵기 · 숨김은 CSS가 맡고, JS는 상태(클래스 · 속성)만 바꿉니다. 제목 · 저자 · 초록은 `esc()` · `textContent`로만(SVG `<text>` 포함 — 명세 9.5 · AC-G51).
- 시험 페이지: 디자인팀 scratchpad `graph/index.html`(저장소 밖, 가짜 좌표 — d3 없음)에서 두 테마 · 1280px · 390px로 확인했습니다(13장).

---

## 0. 개발팀용 클래스 · data 속성 목록 (먼저 확정)

> ★ = 기존 마크업을 바꾸는 곳. 나머지는 새 화면 `graph.js`가 그립니다.

### 0.1 진입점

| 이름 | 붙이는 곳 | 뜻 |
|---|---|---|
| `div.graph-entry` ★ | `library.js` `relatedView` 맨 위(`.seg` 앞) | 인용 그래프 안내 상자(아이콘 + 글 + 버튼) |
| `div.graph-entry-text` > `b` + `span` | 상자 안 | "인용 그래프" + 한 줄 설명 |
| `button.btn.sm.primary[data-graph-open]` ★ | 상자 끝 | 인용 그래프 보기 → `#/graph`(씨앗 = `{paper_id}`) |
| `button.link[data-graph-open]` ★ | `discover.js` `resultCard` `.r-actions`, "관련 논문" 바로 뒤 | 그래프 → `#/graph`(씨앗 = 결과의 식별자 묶음) |
| `svg.ico` 그래프 아이콘(`ICON_GRAPH`) | 안내 상자 · [이 논문으로 새 그래프] | 1.2절 |

### 0.2 그래프 화면 틀 (`graph.js`)

| 이름 | 뜻 |
|---|---|
| `section.view.graph-view` | 화면 전체. `#app`에 `reading` 클래스(사이드바 숨김 — GD-1) |
| `[data-graph-state="loading｜ready｜empty｜error｜cancelled｜noseed"]` | 화면 상태. **`ready`가 아니면 패널 · 위 막대 조절기 · 아래 줄이 CSS로 숨음** |
| `[data-graph-mode="graph｜list"]` | 그래프 / 목록 보기. CSS가 `.graph-stage` · `.graph-list` 중 하나만 보임 |
| `header.graph-bar` | 위 막대 |
| `button.btn.sm[data-graph-back]` | ← 돌아가기 |
| `h1.graph-title[tabindex="-1"]` > `span.muted` + 씨앗 제목 | "인용 그래프 · 씨앗 제목"(70자 넘으면 줄임, 전체는 `title`). 화면을 열면 여기로 포커스 |
| `div.graph-ctls` | 조절기 묶음(좁으면 둘째 줄) |
| `div.graph-ctl[role=radiogroup][aria-labelledby=graph-size-label]` > `.seg.seg-radio` > `input[name=graph-size][value=20｜40｜80]` | 논문 수(기존 라디오형 세그먼트 재사용) |
| `div.graph-ctl[role=radiogroup][aria-labelledby=graph-mode-label]` > `.seg.seg-radio` > `input[name=graph-mode][value=graph｜list]` | 보기 |
| `button.btn.sm[data-graph-legend][aria-expanded][aria-controls=graph-legend]` | 범례 열기/닫기(목록 보기에서는 `disabled`) |
| `div.graph-body` | (그래프 영역 \| 오른쪽 패널) 2칸 격자, 900px 이하 세로 |
| `div.graph-main` (`aria-busy="true"` = 크기 바꿔 다시 그리는 중) | 왼쪽 칸 |
| `div.graph-notices[data-graph-notices]` | 경고 · 안내(`.notice`) 자리. 비면 CSS가 숨김 |
| `.notice[data-tone][data-code]` > `button.icon-btn.small[data-notice-close]` | 경고 한 개 + 닫기(이 그래프 동안만 숨김) |
| `div.graph-stage` | 그래프 그림 영역(상대 위치 — 확대 버튼 · 범례 · 진행 표시가 위에 뜸) |
| `div.graph-list` > `table.graph-table` | 목록 보기(7장) |
| `div.graph-foot` > `span` · `span` · `span.graph-keys#graph-keys` | "후보 512편 중 40편" · "OpenAlex 기준 · 2026-10-07" · 조작 안내(760px 이하 · 목록 보기에서 숨김) |
| `div.sr-only[role=status][data-graph-live]` | 화면 읽기 프로그램 알림 자리(늘 빈 채로 그려 둠 — 12장) |
| `div.empty.graph-state` > `h3[tabindex=-1]` · `p` · `div.empty-actions` | 오류 · 빈 상태 · 취소 · 씨앗 없음(8.3절). 기존 `.empty` · `.empty-actions` 재사용 |

### 0.3 그래프 그림 (SVG)

| 이름 | 뜻 |
|---|---|
| `svg.graph-svg[role=group][aria-label][aria-describedby=graph-keys]` | 그림 전체. 끌 때 `.is-panning`, 강조 중 `.is-dimming` |
| `g.graph-viewport[transform]` | 확대 · 이동은 이 `transform`(또는 `viewBox`)만 바꿈 |
| `g.graph-edges` > `line.g-edge[data-source][data-target][data-kind][stroke-width][stroke-opacity]` | 선. `data-kind="coupling｜cocitation｜related"`(`related` = 점선). 굵기 · 진하기는 속성으로(4.3절) |
| `g.graph-nodes` > `g.g-node[data-id][data-yb][role=button][tabindex][aria-pressed][aria-label][transform]` | 노드 하나. `data-yb="0~4｜none"` = 연도 구간(4.2절) |
| `.g-node` 상태 클래스 | `.is-seed` 씨앗 · `.is-lib` 서재에 있음 · `.show-label` 이름표 늘 보임 · `.is-selected` 고름 · `.is-near` 강조 중 이웃(자기 포함) |
| `circle.g-node-hit` | 투명 누르기 영역(반지름 ≥ 12 → 24px) |
| `circle.g-node-seed` | 씨앗 고리(씨앗만, 반지름 r+5) |
| `circle.g-node-dot` | 노드 원(반지름 r) |
| `circle.g-node-focus` | 키보드 포커스 고리(점선, r+5 · 씨앗은 r+9) |
| `g.g-node-lib[transform] > circle + path` | 서재 배지(✓) — `.is-lib`일 때만 그림 |
| `text.g-node-label[y]` | 이름표 "첫 저자 성, 연도" |
| `div.graph-zoom[role=group][aria-label="확대 · 축소"]` > `button.icon-btn[data-zoom="in｜out｜fit"]` | 확대 · 축소 · 맞춤 |
| `section.graph-legend#graph-legend` (+`hidden`) | 범례(4.5절) |
| `button.btn.sm.graph-jump[data-graph-jump]` (+`hidden`) | 900px 이하: "선택: 성, 연도 · 정보 보기 ↓"(9장) |

### 0.4 진행 표시

| 이름 | 뜻 |
|---|---|
| `div.graph-progress[data-graph-progress]` | `.graph-stage` 위를 덮는 반투명 층 |
| `div.graph-progress-card` > `div.graph-progress-head` | 카드 · 제목(스피너 + "그래프를 만드는 중…") |
| `div.progress[role=progressbar][aria-valuenow]` > `div[style=width]` | 기존 진행 막대 재사용(`progress` 값 × 100). 첫 이벤트 전에는 `.progress.indeterminate` |
| `ol.graph-steps` > `li[data-step][data-state="done｜now｜todo"]` (+`aria-current="step"`) | 단계 목록. 받은 `message`의 숫자는 `span.graph-step-msg` |
| `p.graph-progress-msg[role=status]` | 서버가 보낸 지금 단계 문구 그대로 |
| `div.graph-progress-foot` > `span.small.muted` + `button.btn.sm[data-graph-cancel]` | 안내 + 취소 |

### 0.5 오른쪽 패널

| 이름 | 뜻 |
|---|---|
| `aside.panel.graph-panel[aria-label="논문 정보"]` | 기존 `.panel` 재사용(배경 · 테두리 · 탭 · 스크롤) |
| `div.tabs[role=tablist]` > `button[role=tab][data-graph-tab="info｜prior｜derivative"][aria-selected][aria-controls][tabindex]` (+`active`) | 논문 정보 · 이전 연구 · 이후 연구. 개수는 `span.graph-tab-n` |
| `div.panel-body[role=tabpanel]#graph-tabpanel` | 탭 내용 |
| `div.graph-paper` | 논문 정보 묶음(6.1절) |
| `div.chips` > `span.chip(.accent｜.success)` | 씨앗 · 관계 · 서재 표시 |
| `h2.graph-paper-title` > `a`(새 탭) | 제목 |
| `div.graph-paper-authors` · `div.graph-paper-venue` | 저자 · 학술지 · 연도 |
| `div.actions` | 버튼 줄(6.1절) |
| `button.btn.sm.primary[data-graph-add]` · `button.btn.sm[data-graph-addpdf]` | 서재에 추가 · PDF 포함 추가 |
| `button.btn.sm.in-lib[data-graph-openlib]` | ✓ 서재에 있음 · 열기 |
| `button.btn.sm[data-graph-cite]` | 인용 |
| `a.btn.sm[data-inha-open]` | 인하대에서 보기(1A 규칙 그대로 — `bindExtLink`) |
| `a.btn.sm[data-scholar-open]` | Google Scholar에서 보기 |
| `button.btn.sm[data-graph-reseed]` | 이 논문으로 새 그래프(씨앗이면 그리지 않음) |
| `dl.kv` | 피인용 · 씨앗과 · DOI |
| `div.abstract.clamp#graph-abs` + `button.btn.sm.ghost.graph-abs-toggle[aria-expanded][aria-controls=graph-abs]` | 초록(펼치기/접기) |
| `button.btn.sm.ghost.graph-list-back[data-graph-back-list]` | 이전/이후 연구에서 들어온 논문일 때 "← 이전 연구 목록" |
| `p.graph-intro` | 탭 설명 한 줄 |
| `ol.graph-items` > `li.graph-item` > `button.graph-item-btn[data-graph-pick][aria-current]` > `span.graph-item-title` · `span.graph-item-sub` | 이전 · 이후 연구 · 가장 가까운 논문 항목 |
| `div.graph-item-meta` > `span.graph-count` · `.chip` | "그래프 논문 12편이 인용" · 그래프에 있음 · 서재에 있음 |

### 0.6 목록 보기 · 설정 창

| 이름 | 뜻 |
|---|---|
| `table.graph-table` > `caption` | 표 · 설명("그래프 논문 40편 · 씨앗과 비슷한 순") |
| `th[scope=col][aria-sort]` > `button.graph-sort[data-sort="title｜year｜cited｜score"]` | 정렬 단추. 지금 정렬 칸에만 `aria-sort`, 글자 뒤 `▲/▼`(`aria-hidden`) |
| `th.num` · `td.num` | 숫자 칸(오른쪽 정렬) |
| `th.col-rel` · `td.col-rel` | 관계 칸(560px 이하 숨김) |
| `tr[data-id]` (+`.is-selected`) | 행 |
| `button.graph-row-btn[data-graph-pick]` (+`aria-current="true"`) · `div.graph-row-sub` | 제목 단추 · 첫 저자 · 학술지 |
| `span.g-swatch[data-yb]` | 연도 칸 앞 색 점(`aria-hidden`) |
| `span.graph-sim > span[style=width]` | 유사도 막대(`aria-hidden`, 560px 이하 숨김) |
| `div.hint#set-oa-key-hint` · `div.hint#set-s2-key-hint` ★ | 설정 창 키 칸 아래 한 줄씩(10장) |
| `div.field.keys-note > div.hint#set-keys-note` ★ | 키 칸 묶음 아래 공통 안내 |

### 0.7 CSS 변수 (연도 색 — 4.2절)

`--g-y0`~`--g-y4`(채움) · `--g-y0-line`~`--g-y4-line`(테두리) · `--g-ynone` · `--g-ynone-line` · `--g-edge` · `--g-select` · `--g-check`. `[data-yb]`가 붙은 요소는 `--g-fill` · `--g-line`을 받습니다(노드 · 범례 · 표 색 점 공통).

---

## 1. 공통 원칙

| 항목 | 정한 것 |
|---|---|
| 재사용 | `.view` · `.panel` · `.tabs` · `.seg.seg-radio` · `.btn`(`sm` · `primary` · `ghost`) · `.icon-btn` · `.chip(s)` · `.kv` · `.abstract.clamp` · `.section-title` · `.notice[data-tone]` · `.empty` · `.empty-actions` · `.progress` · `.spinner` · `.sr-only` · `EXT_MARK`. 새 클래스는 그래프 그림 · 범례 · 진행 단계 · 목록 표 · 패널 항목만 |
| 색 | 화면 틀은 모두 기존 변수(네이비 `--accent` / 어두운 테마 로열 블루). 새 색은 **연도 색 5단계 + 선 · 고른 노드 테두리**뿐(4.2절, 변수로) |
| 바깥 링크 | 1A 규칙: 새 탭 · `rel="noopener noreferrer"` · ↗ 아이콘 + `(새 탭에서 열림)`. 주소는 `safeUrl()` · `paperProxyTarget()` · `scholarUrl()` 반환값만 |
| 움직임 | 배치는 애니메이션 없이 한 번에(명세 10.4). 강조 흐리기만 0.12초(`prefers-reduced-motion`이면 없음). 이동 · 확대도 즉시 |

### 1.1 화면 위치 (GD-1)

- `#/graph`(만드는 중) · `#/graph/W<번호>`(끝난 뒤 `replaceState`). **사이드바 메뉴 없음**(K-12).
- 화면은 **읽기 화면처럼 사이드바를 숨기고 전체 폭**을 씁니다(`#app.reading` — `route()`에서 `#/graph` 일 때 `app.classList.add("reading")`). 1280px에서 그래프 칸 900px · 패널 380px. 사이드바를 두면 그래프 칸이 664px로 줄어 노드 80편이 빽빽해집니다.

### 1.2 그래프 아이콘 (복사해서 쓰기)

```html
<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="6" r="2"/><circle cx="15" cy="17" r="3"/><path d="M7.7 8.9 13 14.8M8.5 6.8l7.5-.6M17.5 7.9l-1.7 6.2"/></svg>
```

`dialogs.js`에 `ICON_GRAPH`로 두고 진입 상자 · [이 논문으로 새 그래프]가 같이 쓰기를 제안합니다.

---

## 2. 진입점 (명세 10.1)

### 2.1 서재 상세 — "인용 관계" 탭 맨 위

```
[정보] [노트] [인용 관계]
┌────────────────────────────────────────────┐
│ ⚭  인용 그래프                    [인용 그래프 보기] │
│    주제가 가까운 논문 수십 편을 한 장의 그림으로 보여 줘요. │
└────────────────────────────────────────────┘
(이 논문을 인용한 논문 | 참고문헌 | 관련 논문)   ← 기존 그대로
```

```html
<div class="graph-entry">
  {ICON_GRAPH}
  <div class="graph-entry-text"><b>인용 그래프</b><span>주제가 가까운 논문 수십 편을 한 장의 그림으로 보여 줘요.</span></div>
  <button type="button" class="btn sm primary" data-graph-open>인용 그래프 보기</button>
</div>
```

- 340px 패널(1180px 이하)에서는 버튼이 글 아래 줄로 내려갑니다(`flex-wrap`).
- **상단 버튼 줄([PDF 받기] … [⋯])에는 넣지 않습니다**(GD-3). 이미 5개라 340px에서 두 줄이고, 그래프는 "인용 관계"를 보는 흐름의 연장입니다.
- 900px 이하에서는 서재 상세 패널이 원래 숨으므로 이 진입점도 안 보입니다(기존 구조 — 논문 찾기 카드 진입점은 보임).

### 2.2 논문 찾기 결과 카드

```
[＋ 서재에 추가]  인용  피인용 123,456  참고문헌  관련 논문  그래프  [PDF] arxiv.org  인하대에서 보기 ↗
```

```html
<!-- "관련 논문" 바로 뒤. 같은 화면 안 이동이므로 ↗ 없음 -->
<button class="link" data-graph-open title="이 논문과 주제가 가까운 논문들을 그래프로 봐요">그래프</button>
```

- 찾기 화면 안 "인용 관계 목록"(`drawGraph`)도 같은 `resultCard`라 거기에도 나옵니다(의도).

### 2.3 그래프 노드 패널

[이 논문으로 새 그래프] → 새 씨앗으로 `#/graph`(**push** — 뒤로 가기 = 이전 그래프. 이전 그래프는 메모리에 있으면 바로, 없으면 다시 요청하며 캐시라 빠름).

### 2.4 [← 돌아가기]

- 같은 탭에서 앱 안 화면(서재 · 찾기 · 이전 그래프)에서 들어왔으면 `history.back()`, 주소로 바로 들어왔으면 `#/library`.
- `title`에 돌아갈 곳: "서재로 돌아가요" · "논문 찾기로 돌아가요" · "이전 그래프로 돌아가요".

---

## 3. 화면 구성 (명세 10.2)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [← 돌아가기] 인용 그래프 · Attention Is All You Need   논문 수 [20|40|80] 보기 [그래프|목록] [범례] │
├───────────────────────────────────────────────────────┬─────────────────────┤
│ ⚠ 일부 정보 없이 그렸어요. …                        ✕ │ 논문 정보 | 이전 연구 20 | 이후 연구 20 │
│ ⓘ 이 논문 주변은 인용 정보가 적어 …                  ✕ │ (씨앗 논문) (✓ 서재에 있음)          │
│                                               [+] │ Attention Is All You Need ↗          │
│          ○        ●                            [−] │ A. Vaswani, … 외 5명                 │
│      ○─────◎──────●   (힘 기반 그래프)          [⤢] │ NeurIPS · 2017                       │
│ ┌범례──────────┐   ○                                │ [＋ 서재에 추가][인용][인하대에서 보기↗] │
│ │크기 · 색 · 선 …│                                   │ [Google Scholar에서 보기↗][새 그래프] │
│ └──────────────┘                                    │ 피인용 123,456회 / 씨앗과 … / DOI    │
├───────────────────────────────────────────────────────┤ 초록 …  [펼치기]                    │
│ 후보 512편 중 40편 · OpenAlex 기준 · 2026-10-07   끌어서 이동 · 휠로 확대 · … │ 가장 가까운 논문 …        │
└───────────────────────────────────────────────────────┴─────────────────────┘
```

### 3.1 골격

```html
<section class="view graph-view" data-graph-state="ready" data-graph-mode="graph">
  <header class="graph-bar">
    <button type="button" class="btn sm" data-graph-back title="논문 찾기로 돌아가요">← 돌아가기</button>
    <h1 class="graph-title" tabindex="-1" title="{씨앗 제목 전체}"><span class="muted">인용 그래프 · </span>{70자 줄인 제목}</h1>
    <div class="graph-ctls">
      <div class="graph-ctl" role="radiogroup" aria-labelledby="graph-size-label">
        <span id="graph-size-label">논문 수</span>
        <div class="seg seg-radio">
          <label><input type="radio" name="graph-size" value="20"><span>20</span></label>
          <label><input type="radio" name="graph-size" value="40" checked><span>40</span></label>
          <label><input type="radio" name="graph-size" value="80"><span>80</span></label>
        </div>
      </div>
      <div class="graph-ctl" role="radiogroup" aria-labelledby="graph-mode-label">
        <span id="graph-mode-label">보기</span>
        <div class="seg seg-radio">
          <label><input type="radio" name="graph-mode" value="graph" checked><span>그래프</span></label>
          <label><input type="radio" name="graph-mode" value="list"><span>목록</span></label>
        </div>
      </div>
      <button type="button" class="btn sm" data-graph-legend aria-expanded="true" aria-controls="graph-legend">범례</button>
    </div>
  </header>
  <div class="graph-body">
    <div class="graph-main">
      <div class="graph-notices" data-graph-notices></div>
      <div class="graph-stage">
        <svg class="graph-svg" …>…</svg>          <!-- 4장 -->
        <div class="graph-zoom" …>…</div>          <!-- 5.3절 -->
        <section class="graph-legend" id="graph-legend" …>…</section>  <!-- 4.5절 -->
        <button type="button" class="btn sm graph-jump hidden" data-graph-jump>…</button>  <!-- 9장 -->
        <!-- 만드는 중이면 .graph-progress가 여기 들어옴(8.1절) -->
      </div>
      <div class="graph-list">…</div>              <!-- 7장 -->
      <div class="graph-foot"><span>후보 512편 중 40편</span><span>OpenAlex 기준 · 2026-10-07</span>
        <span class="graph-keys" id="graph-keys">끌어서 이동 · 휠로 확대 · 키보드: 화살표로 이동, Enter로 고르기</span></div>
    </div>
    <aside class="panel graph-panel" aria-label="논문 정보">…</aside>   <!-- 6장 -->
  </div>
  <div class="sr-only" role="status" data-graph-live></div>
</section>
```

- 라디오형 세그먼트는 기존 `.seg.seg-radio`(양식 시안)라 Tab 한 번 + 화살표로 고르고, 포커스 링도 이미 있습니다.
- DOM 순서 = Tab 순서: 위 막대 → 경고 닫기 → 그래프(노드 한 칸) → 확대 버튼 → 범례 닫기 → 패널 탭 → 패널 내용.

### 3.2 상태별로 보이는 것

| `data-graph-state` | 위 막대 조절기 | 그래프 칸 | 패널 · 아래 줄 |
|---|---|---|---|
| `loading`(처음 만드는 중) | 숨김 | `.graph-stage` 안 진행 카드(8.1) | 숨김(그래프 칸이 전체 폭) |
| `ready` | 보임 | 그래프 또는 목록 | 보임 |
| `ready` + `.graph-main[aria-busy=true]`(논문 수 바꾸는 중) | 보임, 라디오 `disabled` | 이전 그래프 위 반투명 진행 카드 | 보임(이전 내용) |
| `empty` · `error` · `cancelled` · `noseed` | 숨김 | `.empty.graph-state`(8.3) | 숨김 |

숨김은 모두 CSS(`.graph-view:not([data-graph-state="ready"]) …`)가 합니다 — JS는 속성만 바꾸면 됩니다.

---

## 4. 그래프 그림 (명세 10.3)

### 4.1 노드

| 요소 | 규칙 |
|---|---|
| 크기 | 반지름 `r = MIN_R + (MAX_R − MIN_R) × ln(1+c) / ln(1+c_max)`. **20 · 40편: 6~28px, 80편: 5~22px**(빽빽함 방지). 확대 배율과 함께 커짐 |
| 누르기 영역 | `circle.g-node-hit` 반지름 `max(r, 12)` — 작은 노드도 24px 목표 크기 |
| 색 | `data-yb`(4.2절). 채움 + 1.5px 테두리(테두리가 배경 대비 3:1 이상이라 옅은 노드도 윤곽이 보임) |
| 연도 없음 | `data-yb="none"`: 회색 + **점선 테두리**(색 말고 모양으로도 구분) |
| 씨앗 | 바깥 고리 `circle.g-node-seed`(r+5, 글자색 2px) + 이름표 굵게 · 늘 보임. 가운데 고정 |
| 서재에 있음 | 오른쪽 위 초록 원 + 체크(`g.g-node-lib`, 노드 중심에서 `(0.72r, −0.72r)`). 테두리 = 그래프 배경색(겹침 분리) |
| 고름 | `.is-selected`: 노드 테두리 3.5px `--g-select`(밝게 #c2410c · 어둡게 #ffa94d — 파랑 계열과 다른 색) + 이름표 굵게 · 늘 보임 + `aria-pressed="true"` |
| 키보드 포커스 | `circle.g-node-focus` 점선 고리(글자색) — `:focus-visible`일 때만. 고름 표시와 겹쳐도 구분됨 |
| 이름표 | "첫 저자 성, 연도"(연도 없으면 "성, 연도 없음", 저자 없으면 제목 앞 20자…). 11px, 배경색 테두리(`paint-order: stroke`)로 선 위에서도 읽힘. **늘 보임 = 씨앗 + 피인용 상위 `min(15, ⌈n × 0.4⌉)`편**(`.show-label` — 20편이면 8편), 그 밖은 hover · 포커스 · 고름 · 강조 이웃일 때 |
| 그리는 순서 | 선 → 노드. 노드는 **작은 것 먼저**(큰 노드의 이름표가 위에 오게) — 이름표 겹침 피하기는 개발 재량(어려우면 그대로) |

### 4.2 연도 색 — 5단계 (GD-2)

연속 색 대신 **5구간**으로 나눕니다. 이유: 범례에 구간마다 연도 숫자를 붙일 수 있어 "색만으로 구분하지 않기"를 지키고, 비슷한 두 색을 구별하라고 요구하지 않습니다.

| 단계(`data-yb`) | 밝은 테마 채움 / 테두리 | 어두운 테마 채움 / 테두리 |
|---|---|---|
| 0 (가장 오래됨) | `#dbe4f7` / `#6d84c0` | `#2c3a5e` / `#7086bd` |
| 1 | `#a9bfea` / `#5a77bd` | `#3b5592` / `#7f97d6` |
| 2 | `#7194d8` / `#3f5fae` | `#5577cc` / `#93abeb` |
| 3 | `#3d63bd` / `#27458f` | `#7d9cf0` / `#aec3f8` |
| 4 (가장 최근) | `#1e3a8a`(= `--accent`) / `#132a66` | `#b4c8ff` / `#dde6ff` |
| `none` (연도 없음) | `#e8ebf0` / `#7a8293` 점선 | `#272c37` / `#868d9c` 점선 |

- 한 색상 계열(네이비). **밝은 테마는 최근일수록 진하게**(Connected Papers와 같음), **어두운 테마는 최근일수록 밝게**(어두운 배경에서 "눈에 띄는 쪽"이 최근이 되도록 — 범례 문구도 "밝을수록 최근"으로 바뀜).
- 확인값(계산): 밝기(OKLab L)가 단계마다 한 방향으로 변함(밝게 0.92→0.38, 어둡게 0.35→0.84). 테두리 대비 — 밝게 흰 배경 3.7 · 4.4 · 6.1 · 9.0 · 13.5:1, 어둡게 `#181b22` 배경 4.8 · 6.0 · 7.6 · 9.8 · 13.8:1, 연도 없음 3.9 · 5.2:1(모두 그래픽 기준 3:1 이상). 선 `--g-edge` 3.0 · 3.6:1, 고름 테두리 5.2 · 9.1:1.

**구간 나누는 법(`graphmath.js`)**

```
span = yMax − yMin + 1
bins = min(5, span)                       // 연도가 2개뿐이면 2구간
k    = floor((year − yMin) / span × bins) // 0 … bins−1
data-yb = 5 − bins + k                    // 가장 최근 구간은 늘 4(가장 진함)
연도 없음 → "none"
구간 k의 시작 연도 = ceil(yMin + k × span / bins)
```

- AC-G50의 "연도 색 척도(최소 · 최대 · 연도 없음 = 회색)" 시험은 이 함수로: 최소 연도 → `5−bins`, 최대 → 4, 없음 → `"none"`.

### 4.3 선

| 요소 | 규칙 |
|---|---|
| 굵기 | `stroke-width = 1 + 3 × weight`(1~4px) — 속성으로 |
| 진하기 | `stroke-opacity = 0.3 + 0.55 × weight` — 속성으로 |
| 색 | `--g-edge`(회색 계열 — 노드 색과 겹치지 않게) |
| `kind = related` | **점선**(`stroke-dasharray: 5 4` — CSS) |
| 강조 중 이웃 선 | `.is-near` → `--accent-text` 색(CSS) |

### 4.4 강조 (hover · 포커스)

- 노드에 마우스를 올리거나 키보드 포커스가 가면: `svg`에 `.is-dimming`, 그 노드와 이웃 노드에 `.is-near`, 그 노드에 닿는 선에 `.is-near`. 나머지 노드는 22%, 선은 8%로 흐려짐(CSS).
- 마우스가 빠지거나 포커스가 그래프 밖으로 나가거나 Esc → `.is-dimming` 뺌. **고름(`.is-selected`)은 강조와 따로** 유지.
- 목록 보기 · 패널의 항목 단추에 마우스를 올려도 그래프 강조는 하지 않습니다(그래프가 안 보일 수 있음).

### 4.5 범례 (`section.graph-legend`)

```
범례                                         ✕
(●●●) 크기  피인용 수(로그 척도, 최대 123,456회)
색  출판 연도 · 진할수록 최근
[▒▒][▒▒][▓▓][▓▓][██] [┅]
2008 2012 2015 2019 2022–24 없음
━━ 선  굵을수록 더 비슷(함께 인용 · 같은 문헌 인용)
┅┅ 점선  주제만 비슷(인용 근거 없음)
◎ 씨앗 논문    ●✓ 서재에 있음
────────────────────────────────
후보 512편을 비교해 고른 그래프예요(전체 문헌을 다 본 것은 아니에요).
```

```html
<section class="graph-legend" id="graph-legend" aria-labelledby="graph-legend-title">
  <div class="graph-legend-head"><span id="graph-legend-title">범례</span>
    <button type="button" class="icon-btn small" data-legend-close aria-label="범례 닫기">✕</button></div>
  <ul class="graph-legend-items">
    <li><svg width="40" height="24" viewBox="-20 -12 40 24" aria-hidden="true"><circle class="g-node-dot" cx="-14" cy="6" r="4"/><circle class="g-node-dot" cx="-4" cy="3" r="7"/><circle class="g-node-dot" cx="10" cy="0" r="10"/></svg>
      <span><b>크기</b> 피인용 수(로그 척도, 최대 {c_max}회)</span></li>
    <li class="g-legend-ramp"><span><b>색</b> 출판 연도 · {진할수록｜밝을수록} 최근</span>
      <ol class="g-ramp" aria-label="연도 구간" style="--g-bins:{bins}">
        <li title="2008–11"><span class="g-swatch" data-yb="0"></span>2008</li> …
        <li title="2022–24"><span class="g-swatch" data-yb="4"></span>2022–24</li>
        <li class="g-ramp-none"><span class="g-swatch" data-yb="none"></span>없음</li>   <!-- 연도 없는 노드가 있을 때만 -->
      </ol></li>
    <li><svg width="40" height="16" viewBox="0 0 40 16" aria-hidden="true"><line class="g-edge" x1="2" y1="4" x2="38" y2="4" stroke-width="1.2" stroke-opacity=".6"/><line class="g-edge" x1="2" y1="12" x2="38" y2="12" stroke-width="4" stroke-opacity=".85"/></svg>
      <span><b>선</b> 굵을수록 더 비슷(함께 인용 · 같은 문헌 인용)</span></li>
    <li><svg width="40" height="8" viewBox="0 0 40 8" aria-hidden="true"><line class="g-edge" data-kind="related" x1="2" y1="4" x2="38" y2="4" stroke-width="2" stroke-opacity=".85"/></svg>
      <span><b>점선</b> 주제만 비슷(인용 근거 없음)</span></li>
    <li class="g-legend-pair">
      <span><svg width="24" height="24" viewBox="-12 -12 24 24" aria-hidden="true"><circle class="g-node-seed" r="10"/><circle class="g-node-dot" r="5.5"/></svg><b>씨앗 논문</b></span>
      <span><svg width="24" height="24" viewBox="-12 -12 24 24" aria-hidden="true"><circle class="g-node-dot" r="7"/><g class="g-node-lib" transform="translate(5 -5)"><circle r="5.5"/><path d="M-2.4 0.1 -0.7 1.8 2.5-1.7"/></g></svg><b>서재에 있음</b></span></li>
  </ul>
  <p class="graph-legend-note">후보 {candidates}편을 비교해 고른 그래프예요(전체 문헌을 다 본 것은 아니에요).</p>
</section>
```

- 칸 아래 숫자는 **구간 시작 연도**, 마지막 칸만 "시작–끝(두 자리)". 칸 `title`에 전체 구간. 구간이 5개 미만이면 `--g-bins`를 그 수로.
- 점선 줄은 `related` 선이 하나라도 있을 때만, "없음" 칸은 연도 없는 노드가 있을 때만, "서재에 있음"은 늘(뜻을 미리 알려 줌).
- 연도 범례 문구 "진할수록 최근"은 어두운 테마에서 "밝을수록 최근"(`document.documentElement.dataset.theme`로 고르고, 테마를 바꾸면 범례만 다시 그림).
- **열림 상태**(GD-8): 900px 초과는 기본 열림, 이하는 기본 닫힘. [범례]나 ✕로 바꾸면 `localStorage` `paperlab.graphLegend = "1"｜"0"`에 기억(못 쓰면 기본값). 목록 보기에서는 [범례] `disabled`.

---

## 5. 조작

### 5.1 마우스 · 터치

| 동작 | 결과 |
|---|---|
| 노드 누르기 | 고름 → 패널 "논문 정보" 탭으로 그 논문. 포커스 칸(roving)도 그 노드로 |
| 노드 위에 올리기 | 강조(4.4) + 이름표 |
| 빈 곳 끌기 | 이동(`.is-panning` → 커서 grabbing) |
| 휠 | 마우스 위치를 중심으로 확대 · 축소(Ctrl 없이). 한 칸 1.15배, 범위 0.4~4배 |
| 빈 곳 누르기(끌지 않고) | 강조만 풀기(고름은 그대로) |
| 터치 | 한 손가락 끌기 = 이동, 두 손가락 = 확대, 누르기 = 고름(`touch-action: none` — 9장 확인 필요) |

### 5.2 키보드 (그래프에 포커스가 있을 때)

| 키 | 결과 |
|---|---|
| Tab | 그래프 전체가 **한 칸**(roving tabindex: 고른 노드 — 처음엔 씨앗 — 만 `tabindex="0"`, 나머지 `-1`) |
| ← ↑ → ↓ | 그 방향의 가장 가까운 노드로 포커스(방향 앞쪽 노드 중 `거리 + 2 × 옆으로 벗어난 거리`가 가장 작은 것 — 개발 재량). 포커스한 노드는 강조 |
| Home | 씨앗으로 |
| Enter · Space | 고름(패널 갱신). 포커스는 노드에 그대로 |
| Esc | 강조 풀기(고름 · 화면은 그대로 — 화면을 떠나지 않음) |
| `+` / `=` · `-` · `0` | 확대 · 축소 · 맞춤 |

- 포커스하거나 고른 노드가 화면 밖이면 그 노드가 가운데 오도록 **즉시** 이동(애니메이션 없음).
- 키 안내는 아래 줄 `#graph-keys`(보이는 글자)이고, `svg`의 `aria-describedby`로도 읽힙니다.

### 5.3 확대 버튼

```html
<div class="graph-zoom" role="group" aria-label="확대 · 축소">
  <button type="button" class="icon-btn" data-zoom="in" aria-label="확대" title="확대 (+)">＋</button>
  <button type="button" class="icon-btn" data-zoom="out" aria-label="축소" title="축소 (−)">－</button>
  <button type="button" class="icon-btn" data-zoom="fit" aria-label="화면에 맞추기" title="화면에 맞추기 (0)"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
</div>
```

- 버튼 한 번 1.25배. 처음 그릴 때와 [맞춤]은 모든 노드 + 반지름 + 24px 여백이 들어오게(범례가 일부를 가려도 맞춤은 그대로 — 범례는 닫을 수 있음).
- 그래프 영역 크기가 바뀌면(창 크기 · 패널) 지금 배율을 유지하고 가운데만 맞춤.

---

## 6. 오른쪽 패널 (명세 10.5)

```html
<aside class="panel graph-panel" aria-label="논문 정보">
  <div class="tabs" role="tablist" aria-label="그래프 정보">
    <button type="button" role="tab" id="graph-tab-info" data-graph-tab="info" aria-selected="true" aria-controls="graph-tabpanel" tabindex="0" class="active">논문 정보</button>
    <button type="button" role="tab" id="graph-tab-prior" data-graph-tab="prior" aria-selected="false" aria-controls="graph-tabpanel" tabindex="-1">이전 연구<span class="graph-tab-n">20</span></button>
    <button type="button" role="tab" id="graph-tab-derivative" data-graph-tab="derivative" aria-selected="false" aria-controls="graph-tabpanel" tabindex="-1">이후 연구<span class="graph-tab-n">20</span></button>
  </div>
  <div class="panel-body" role="tabpanel" id="graph-tabpanel" aria-labelledby="graph-tab-info">…</div>
</aside>
```

- 탭: ← → 로 옮기고(자동으로 그 탭 열기), Home/End. 개수가 0이면 숫자 대신 탭은 그대로 두고 빈 문구(6.2).
- 처음에는 **씨앗 논문 정보**.

### 6.1 논문 정보 탭

```
(씨앗이 인용함) (함께 인용됨) (✓ 서재에 있음)
Language Models via Representation ↗
A. Radford, B. Lewis, C. Clark 외 4명
ICLR · 2021
[＋ 서재에 추가][PDF 포함 추가][인용][인하대에서 보기 ↗][Google Scholar에서 보기 ↗][⚭ 이 논문으로 새 그래프]
피인용   12회
씨앗과   같은 참고문헌 9편
DOI      10.xxxx/…
초록
The dominant sequence … (6줄)
[펼치기]
가장 가까운 논문
  Neural Machine Translation via Vision
  Radford 외 · 2012 · 피인용 10,529
  …(선 굵은 순 5편)
```

```html
<div class="graph-paper">
  <div class="chips">{칩들}</div>
  <h2 class="graph-paper-title"><a href="{safeUrl(url)}" target="_blank" rel="noopener noreferrer">{제목}{EXT_MARK}</a></h2>  <!-- 주소 없으면 글자만 -->
  <div class="graph-paper-authors">{앞 3명} 외 {N}명</div>
  <div class="graph-paper-venue">{학술지} · {연도}</div>
  <div class="actions">
    <button type="button" class="btn sm primary" data-graph-add>＋ 서재에 추가</button>
    <button type="button" class="btn sm" data-graph-addpdf>PDF 포함 추가</button>            <!-- pdf_url 있을 때 -->
    <!-- 서재에 있으면 위 둘 대신: <button type="button" class="btn sm in-lib" data-graph-openlib>✓ 서재에 있음 · 열기</button> -->
    <button type="button" class="btn sm" data-graph-cite>인용</button>
    <a class="btn sm" href="{paperProxyTarget}" target="_blank" rel="noopener noreferrer" data-inha-open title="인하대 openlink(정석학술정보관)로 원문 페이지를 열어요">인하대에서 보기{EXT_MARK}</a>  <!-- 대상 있을 때만 -->
    <a class="btn sm" href="{scholarUrl}" target="_blank" rel="noopener noreferrer" data-scholar-open title="{SCHOLAR_LIBRARY_NOTE}">Google Scholar에서 보기{EXT_MARK}</a>
    <button type="button" class="btn sm" data-graph-reseed>{ICON_GRAPH}이 논문으로 새 그래프</button>  <!-- 씨앗이면 없음 -->
  </div>
  <dl class="kv">
    <dt>피인용</dt><dd>{N}회</dd>
    <dt>씨앗과</dt><dd>{관계 문구}</dd>          <!-- 씨앗이면 없음 -->
    <dt>DOI</dt><dd><a href="https://doi.org/{doi}" target="_blank" rel="noopener">{doi}</a></dd>  <!-- 있을 때 -->
  </dl>
  <div class="section-title">초록</div>
  <div class="abstract clamp" id="graph-abs">{초록}</div>
  <button type="button" class="btn sm ghost graph-abs-toggle" aria-expanded="false" aria-controls="graph-abs">펼치기</button>
  <div class="section-title">가장 가까운 논문</div>
  <ol class="graph-items">{6.3절 항목 × 최대 5}</ol>
</div>
```

| 부분 | 규칙 |
|---|---|
| 칩 | 씨앗: `chip accent` "씨앗 논문". 그 밖: `relation`마다 `chip` — reference "씨앗이 인용함" · citing "씨앗을 인용함" · related "OpenAlex 관련 논문" · cocited "함께 인용됨". 서재: `chip success` "✓ 서재에 있음". 이전/이후 연구에서 온 그래프 밖 논문: `chip` "이전 연구 · 그래프 논문 12편이 인용" / "이후 연구 · 그래프 논문 9편을 인용" |
| 버튼 순서 | **담기 → 인용 → 원문 보기 → 다른 곳에서 보기 → 새 그래프**. 주 버튼은 [＋ 서재에 추가] 하나 |
| 서재에 추가 | 지금 찾기 카드 `doAdd`와 같음: 누르면 `disabled` + `<span class="spinner"></span> 추가 중`(PDF면 "PDF 받는 중") → 성공하면 [✓ 서재에 있음 · 열기]로 바뀌고 **그래프 노드에 `.is-lib` · 배지 · `aria-label` 갱신**, 목록 표 · 이전/이후 연구 항목의 칩도 갱신, `[data-graph-live]`에 "서재에 추가했어요" |
| 서재에 있음 · 열기 | `state.activeId = id; location.hash = "#/library"`(찾기 카드와 같음) |
| 인하대 · Scholar | 1A 그대로(`bindExtLink` — 인하대만 처음 안내 창). Scholar 질의 = 제목, 없으면 DOI |
| 씨앗과 | 씨앗과 잇는 선이 있으면 그 선의 `kind`로: coupling "같은 참고문헌 {shared}편", cocitation "함께 인용한 논문 {shared}편", related "주제가 비슷함(인용 근거 없음)". 선이 없으면 "직접 이어진 선은 없어요" |
| 초록 | 6줄 접힘(`.abstract.clamp`). 6줄 넘을 때만 [펼치기]/[접기]. 초록이 없으면 `p.small.muted` "초록이 없어요." |
| 가장 가까운 논문 | 이 노드와 이어진 선 굵은 순 5편(이웃이 없으면 이 절 전체 생략). 누르면 그 노드를 고름 — **화면 읽기 · 키보드로 그래프 구조를 따라가는 길**(GD-7) |

### 6.2 이전 연구 · 이후 연구 탭

```
그래프 논문들이 공통으로 많이 인용한 논문이에요. 이 분야의 기초 · 대표 문헌일 수 있어요.
Foundations of Attention Transformer
Vaswani 외 · 1997 · 피인용 123,456
그래프 논문 14편이 인용  (그래프에 있음) (✓ 서재에 있음)
─────────
…
```

```html
<p class="graph-intro">그래프 논문들이 <b>공통으로 많이 인용한</b> 논문이에요. 이 분야의 기초 · 대표 문헌일 수 있어요.</p>
<ol class="graph-items">
  <li class="graph-item">
    <button type="button" class="graph-item-btn" data-graph-pick="W…">
      <span class="graph-item-title">{제목}</span>
      <span class="graph-item-sub">{첫 저자 성} 외 · {연도} · 피인용 {N}</span>
    </button>
    <div class="graph-item-meta"><span class="graph-count">그래프 논문 12편이 인용</span><span class="chip accent">그래프에 있음</span><span class="chip success">✓ 서재에 있음</span></div>
  </li>
</ol>
```

- 누르기: `in_graph`면 그 노드를 고르고 "논문 정보" 탭으로. 아니면 "논문 정보" 탭에 그 논문을 보이되 그래프 고름은 풀고, 맨 위에 `button.btn.sm.ghost.graph-list-back[data-graph-back-list]` "← 이전 연구 목록"(누르면 그 탭 · 그 항목으로 포커스).
- 지금 패널에 보이는 논문의 항목 단추에 `aria-current="true"`(배경 강조).
- 빈 목록: `p.graph-intro` 아래 `p.small.muted` — 이전 "그래프 논문 2편 이상이 함께 인용한 논문이 없어요." / 이후 "그래프 논문 2편 이상을 함께 인용한 논문이 없어요."

### 6.3 항목 단추 (가장 가까운 논문 · 이전/이후 연구 공통)

- 단추 하나에 제목 + 한 줄 정보(접근 가능한 이름 = 제목 + 정보). 칩 · 개수는 단추 밖 `.graph-item-meta`(가장 가까운 논문은 서재 칩만).

---

## 7. 목록 보기 (명세 10.7 — 그래프의 대안)

```
그래프 논문 40편 · 씨앗과 비슷한 순
제목                                   연도   피인용   유사도 ▼   관계
Attention Is All You Need               ● 2017 123,456     —      씨앗
Vaswani 외 · NeurIPS  (씨앗)(✓ 서재에 있음)
Transformer with Sequence               ● 2012       9  ▬▬ 0.92  씨앗을 인용함
```

```html
<div class="graph-list">
  <table class="graph-table">
    <caption>그래프 논문 40편 · 씨앗과 비슷한 순</caption>
    <thead><tr>
      <th scope="col"><button type="button" class="graph-sort" data-sort="title">제목</button></th>
      <th scope="col" class="num"><button type="button" class="graph-sort" data-sort="year">연도</button></th>
      <th scope="col" class="num"><button type="button" class="graph-sort" data-sort="cited">피인용</button></th>
      <th scope="col" class="num" aria-sort="descending"><button type="button" class="graph-sort" data-sort="score">유사도 <span aria-hidden="true">▼</span></button></th>
      <th scope="col" class="col-rel">관계</th>
    </tr></thead>
    <tbody>
      <tr data-id="W…" class="is-selected">
        <td><button type="button" class="graph-row-btn" data-graph-pick="W…" aria-current="true">{제목}</button>
          <div class="graph-row-sub">{첫 저자 성} 외 · {학술지}</div>
          <span class="chip accent">씨앗</span><span class="chip success">✓ 서재에 있음</span></td>
        <td class="num"><span class="g-swatch" data-yb="3" aria-hidden="true"></span> 2017</td>
        <td class="num">123,456</td>
        <td class="num"><span class="graph-sim" aria-hidden="true"><span style="width:92%"></span></span>0.92</td>
        <td class="col-rel">씨앗을 인용함</td>
      </tr>
    </tbody>
  </table>
</div>
```

| 항목 | 규칙 |
|---|---|
| 기본 정렬 | 유사도(`score`) 내림차순, 씨앗 맨 위(씨앗 유사도 칸은 "—") |
| 정렬 바꾸기 | 머리 단추: 같은 칸 다시 누르면 방향 반대. 제목은 가나다 오름차순부터, 숫자는 내림차순부터. 지금 칸 `th`에만 `aria-sort` + ▲/▼. 바꾸면 `caption` 문구 갱신("… · 피인용 많은 순" 등) |
| 고르기 | 제목 단추 → 같은 패널 동작(행 `.is-selected` + 단추 `aria-current`). 그래프 보기로 돌아가면 고른 노드에 포커스 |
| 관계 칸 | 씨앗 "씨앗", 그 밖 `relation` 문구를 ", "로(6.1 칩 문구와 같음) |
| 연도 칸 | 색 점(`g-swatch`)은 장식 — 숫자가 정보 |
| 좁은 화면 | 560px 이하: 관계 칸 · 유사도 막대 숨김(숫자는 남음). 표가 넘치면 `.graph-list` 안에서만 가로 스크롤 |

---

## 8. 진행 · 경고 · 오류 · 빈 상태 (명세 9.1 · 9.2 · 10.6)

### 8.1 진행 표시 (SSE `progress`)

```
┌──────────────────────────────────────┐
│ ◌ 그래프를 만드는 중…                    │
│ ███████████░░░░░░░░░░░                  │
│ ✓ 씨앗 논문 찾기                          │
│ ✓ 참고문헌 · 관련 논문 모으기  320편        │
│ ● 이 논문을 인용한 논문 모으기  100편       │
│ ○ 함께 인용된 논문 찾기                   │
│ ○ 초록 · 이전 연구 정보 받기              │
│ ○ 유사도 계산                            │
│ 이 논문을 인용한 논문 100편                │
│ 처음 보는 논문은 10~30초 걸릴 수 있어요. [취소] │
└──────────────────────────────────────┘
```

```html
<div class="graph-progress" data-graph-progress>
  <div class="graph-progress-card">
    <div class="graph-progress-head"><span class="spinner" aria-hidden="true"></span>그래프를 만드는 중…</div>
    <div class="progress" role="progressbar" aria-label="그래프 만들기 진행" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><div style="width:50%"></div></div>
    <ol class="graph-steps">
      <li data-step="seed" data-state="done">씨앗 논문 찾기<span class="sr-only">(완료)</span></li>
      <li data-step="references" data-state="done">참고문헌 · 관련 논문 모으기 <span class="graph-step-msg">320편</span><span class="sr-only">(완료)</span></li>
      <li data-step="citing" data-state="now" aria-current="step">이 논문을 인용한 논문 모으기 <span class="graph-step-msg">100편</span></li>
      <li data-step="cocitation" data-state="todo">함께 인용된 논문 찾기</li>
      <li data-step="finish" data-state="todo">초록 · 이전 연구 정보 받기</li>
      <li data-step="compute" data-state="todo">유사도 계산</li>
    </ol>
    <p class="graph-progress-msg" role="status">{서버 message 그대로}</p>
    <div class="graph-progress-foot"><span class="small muted">처음 보는 논문은 10~30초 걸릴 수 있어요.</span>
      <button type="button" class="btn sm" data-graph-cancel>취소</button></div>
  </div>
</div>
```

| 항목 | 규칙 |
|---|---|
| 단계 | 서버 `step` 6개(`seed` · `references` · `citing` · `cocitation` · `finish` · `compute`) = 목록 6줄. 이벤트가 오면 그 단계 `now`, **앞 단계는 모두 `done`**(캐시로 건너뛴 단계 포함) |
| `wait` 단계 | 목록 줄이 아님 — `seed`를 `now`로 두고 `.graph-progress-msg`에 "다른 그래프가 끝나기를 기다리는 중이에요" |
| 숫자 | 서버 `message`에 "320편" 같은 수가 있으면 그 단계 줄 `.graph-step-msg`에도 남김(끝난 단계의 결과가 보이게). 수를 뽑는 정규식은 `/(\d[\d,]*)편/` |
| 진행 막대 | `progress × 100`. 첫 이벤트 전 · 캐시로 바로 끝날 때는 `.progress.indeterminate`(기존) |
| 처음 0.4초 | 캐시면 보통 바로 `done`이 오므로 **진행 카드는 0.4초 뒤에 보이기**(번쩍임 방지). 그 전에는 빈 그래프 칸 |
| 논문 수 바꾸기 | 이전 그래프 위 반투명 층(`.graph-main[aria-busy=true]`) + 카드 제목 "논문 {N}편으로 다시 그리는 중…", 단계 목록은 `progress` 이벤트가 올 때만 그림. 라디오 `disabled`. 실패하면 이전 그래프 그대로 + 경고 줄(8.2 `resize_failed`) |
| 화면 읽기 | `role=status`는 단계가 바뀔 때만 문구를 바꿈(같은 단계 안 % 변화로 매번 읽히지 않게) |
| [취소] | 스트림 끊기(`AbortController`) → `cancelled` 상태(8.3). 다른 화면으로 나가도 같은 처리(상태 화면 없이) |

### 8.2 경고 (`done.graph.warnings` — 그래프 위 알림 줄)

- 화면은 **`code`로 문구를 고릅니다**(아래 표). 표에 없는 `code`면 서버 `message`를 그대로(GD-4).
- 묶기: ① "실패 · 누락" 경고는 **하나의 주황 상자**에 목록으로 ② `weak_citation_data` · `truncated`는 **파란 안내 상자** 하나 ③ `upstream_limited`(캐시로 그림)는 따로 주황 상자 + [설정 열기].
- 상자마다 ✕(`data-notice-close`) — 이 그래프 동안만 숨김(새 그래프 · 논문 수 바꾸면 다시 나옴).

```html
<div class="notice" data-tone="warn" data-code="partial">{ICON_WARN}
  <div><b>일부 정보 없이 그렸어요.</b> 그래프가 덜 정확할 수 있어요.
    <ul><li>함께 인용된 논문을 받지 못했어요.</li><li>일부 정보가 오래됐을 수 있어요.</li></ul></div>
  <button type="button" class="icon-btn small" data-notice-close aria-label="알림 닫기">✕</button>
</div>
```

| `code` | 상자 | 문구 |
|---|---|---|
| `partial` | 주황(묶음) | 시간이 오래 걸려 일부 단계를 건너뛰었어요. |
| `refs_partial` | 주황(묶음) | 참고문헌 일부를 받지 못했어요. |
| `citing_failed` | 주황(묶음) | 이 논문을 인용한 논문을 받지 못했어요. |
| `cocite_failed` | 주황(묶음) | 함께 인용된 논문을 받지 못했어요. |
| `abstracts_failed` | 주황(묶음) | 일부 논문의 초록을 받지 못했어요. |
| `stale_cache` | 주황(묶음) | 일부 정보가 오래됐을 수 있어요. |
| `s2_failed`(명세 9.3절 확정, GD-6) | 주황(묶음) | Semantic Scholar가 응답하지 않아 참고문헌을 보강하지 못했어요. |
| 묶음 머리 | — | **일부 정보 없이 그렸어요.** 그래프가 덜 정확할 수 있어요. |
| `weak_citation_data` | 파랑 | 이 논문 주변은 인용 정보가 적어 주제 유사도로 보강했어요. **점선**은 인용 근거 없이 주제만 비슷한 연결이에요. (국문 논문은 OpenAlex 인용 정보가 적은 편이에요.) |
| `truncated` | 파랑 | 참고문헌이 많아 앞의 300편만 비교했어요. |
| `upstream_limited`(경고로 올 때, GD-6) | 주황(따로) | OpenAlex 하루 사용량을 다 써서 저장돼 있던 정보로만 그렸어요(한국 시간 오전 9시에 초기화). 설정에서 OpenAlex API 키를 넣으면 한도가 10배가 돼요. + `button.btn.sm[data-graph-settings]` 설정 열기 |
| `resize_failed`(화면 전용) | 주황(따로) | 논문 수를 바꾸지 못했어요. 이전 그래프를 그대로 보여 드려요. |

### 8.3 오류 · 빈 상태 · 취소 (그래프 대신 `.empty.graph-state`)

```html
<div class="empty graph-state">
  <h3 tabindex="-1">{제목}</h3>
  <p>{설명}</p>
  <div class="empty-actions">{버튼들 — 첫 버튼이 primary}</div>
</div>
```

| 경우(출처) | `data-graph-state` | 제목 | 설명 | 버튼 |
|---|---|---|---|---|
| `seed_not_found`(SSE error) | `error` | 이 논문을 OpenAlex에서 찾지 못했어요 | DOI가 있으면 더 정확하게 찾아요. 서재 논문이라면 ⋯ → ‘정보 수정’에서 DOI를 넣고 다시 시도해 보세요. | [Google Scholar에서 보기 ↗] [돌아가기] |
| 노드 3편 미만(`done`인데 노드 < 3) | `empty` | 연결된 논문을 충분히 찾지 못했어요 | OpenAlex에 인용 정보가 적은 논문일 수 있어요. Google Scholar에서 ‘인용’ · ‘관련 학술자료’를 살펴보세요. | [Google Scholar에서 보기 ↗] [돌아가기] |
| `upstream_limited`(SSE error) | `error` | OpenAlex 하루 사용량을 다 썼어요 | 한국 시간 오전 9시에 초기화돼요. 설정에서 OpenAlex API 키(무료)를 넣으면 한도가 10배가 돼요. | [설정 열기] [돌아가기] |
| `upstream_unavailable`(SSE error) | `error` | OpenAlex에 연결할 수 없어요 | 잠시 후 다시 시도해 주세요. | [다시 시도] [돌아가기] |
| `internal`(SSE error) · 알 수 없는 오류 | `error` | 그래프를 만들지 못했어요 | 잠시 후 다시 시도해 주세요. | [다시 시도] [돌아가기] |
| 429 `graph_busy`(시작 전 JSON) | `error` | 이미 그래프를 만드는 중이에요 | 끝난 뒤 다시 눌러 주세요. 다른 탭에서 만들고 있을 수도 있어요. | [다시 시도] [돌아가기] |
| 503 `graph_queue_full`(시작 전 JSON) | `error` | 지금 그래프 요청이 많아요 | 잠시 후 다시 시도해 주세요. | [다시 시도] [돌아가기] |
| 400 `bad_seed` | `error` | 이 논문으로는 그래프를 만들 수 없어요 | DOI · arXiv 번호 · 제목 형식을 알아보지 못했어요. | [돌아가기] |
| 404(서재 논문 없음) | `error` | 서재에서 이 논문을 찾지 못했어요 | 삭제됐을 수 있어요. | [서재로] |
| 연결이 중간에 끊김(`done` 없이 스트림 끝) | `error` | 연결이 끊겼어요 | 그동안 받은 정보는 저장돼 있어서 다시 만들면 더 빨라요. | [다시 시도] [돌아가기] |
| [취소] | `cancelled` | 그래프 만들기를 취소했어요 | 그동안 받은 정보는 저장돼 있어서 다시 만들면 더 빨라요. | [다시 만들기] [돌아가기] |
| `#/graph`에 씨앗 없이 들어옴(새로 고침 전 등) | `noseed` | 그래프를 만들 논문을 골라 주세요 | 서재 논문 상세의 ‘인용 관계’ 탭이나 논문 찾기 결과의 ‘그래프’에서 시작해요. | [서재로] [논문 찾기로] |

- 버튼 data 속성: [다시 시도]/[다시 만들기] `data-graph-retry`, [돌아가기] `data-graph-back`, [설정 열기] `data-graph-settings`(`settingsDialog()` — 열면 "논문 검색 데이터베이스" 구역으로 스크롤은 선택), Scholar `a.btn.primary[data-scholar-open]`(질의 = 씨앗 제목, 없으면 DOI — 둘 다 없으면 버튼 없음), [서재로] `#/library`, [논문 찾기로] `#/discover`.
- 401 · 403(로그인 끝남 등)은 지금 `api.js` 공통 처리 그대로.
- 상태 화면이 뜨면 `h3`로 포커스(화면 읽기 프로그램이 바로 읽음).

---

## 9. 좁은 화면 (900px 이하 · 390px 확인)

```
┌ 390px ─────────────────────────┐
│ [← 돌아가기] 인용 그래프 · Attention… │
│ 논문 수 [20|40|80]  보기 [그래프|목록] │
│ [범례]                           │
├─────────────────────────────────┤
│ ⚠ 일부 정보 없이 그렸어요 …      ✕ │
│                          [+][−][⤢]│
│        (그래프 — 높이 58vh)          │
│     [선택: Vaswani, 2017 · 정보 보기 ↓] │
├─────────────────────────────────┤
│ 후보 512편 중 40편 · OpenAlex 기준 …  │
├─────────────────────────────────┤
│ 논문 정보 | 이전 연구 20 | 이후 연구 20 │
│ (패널 내용 — 화면이 아래로 이어짐)      │
└─────────────────────────────────┘
```

| 폭 | 배치 |
|---|---|
| 1180px 초과 | 패널 380px |
| 900~1180px | 패널 340px |
| 900px 이하 | 세로 한 줄: 위 막대 → 경고 → 그래프(높이 `58vh`, 최소 320px) → 아래 줄 → 패널(탭 + 내용). **화면 전체(`.graph-view`)가 세로로 스크롤** |
| 760px 이하 | 조절기가 제목 아래 줄로, 조작 안내(`#graph-keys`) 숨김 |
| 560px 이하 | 목록 표의 관계 칸 · 유사도 막대 숨김 |

- **[선택: … · 정보 보기 ↓]**(`[data-graph-jump]`): 900px 이하에서 노드를 누르면 그래프 아래 가운데에 뜨는 단추. 누르면 패널을 `scrollIntoView`하고 패널 제목(`h2.graph-paper-title`, `tabindex=-1`)으로 포커스. 다른 노드를 고르면 글자만 바뀜. 범례가 열려 있으면 CSS가 숨김(겹침 방지). 900px 초과에서는 `hidden`.
- 범례는 900px 이하에서 기본 닫힘(4.5), 열면 그래프 칸 폭에 맞춰 넓어짐.
- 진행 카드 · 상태 화면은 폭에 맞춰 줄어듦(카드 최대 420px).
- 390px에서 가로 넘침 0(13.2).

---

## 10. 설정 창 — API 키 안내 (명세 7.4 · 13장)

"논문 검색 데이터베이스" 구역, 지금 키 칸 두 개(`grid-2`)에 한 줄씩 + 아래 공통 안내:

```html
<div class="field"><label>연락처 이메일 (선택)</label><input class="input" name="contact_email" …>
  <div class="hint">Crossref에 이메일을 알려 주면 요청이 우선 처리돼요(OpenAlex에는 보내지 않아요).</div></div>
<div class="grid-2">
  <div class="field"><label>OpenAlex API 키 (선택)</label>
    <input class="input" type="password" name="openalex_api_key" … aria-describedby="set-oa-key-hint set-keys-note">
    <div class="hint" id="set-oa-key-hint">무료 키를 넣으면 하루 사용 한도가 10배가 돼요.</div></div>
  <div class="field"><label>Semantic Scholar API 키 (선택)</label>
    <input class="input" type="password" name="semantic_scholar_api_key" … aria-describedby="set-s2-key-hint set-keys-note">
    <div class="hint" id="set-s2-key-hint">키가 있으면 요청이 덜 막혀요.</div></div>
</div>
<div class="field keys-note"><div class="hint" id="set-keys-note">키는 검색과 인용 그래프에 쓰여요. 키 없이 쓰면 하루 한도가 작아 그래프를 만들지 못할 때가 있어요. 키로 받은 공개 서지 정보(제목 · 저자 · 인용 관계)도 모든 사용자가 함께 쓰는 저장소에 들어가고, OpenAlex · Semantic Scholar 쪽에는 키 주인의 사용량으로 기록돼요. PaperLab은 누가 어떤 논문을 조회했는지 남기지 않아요.</div></div>
```

- `label`에 `for`가 없는 지금 마크업이면 `input`에 `id`(`set-oa-key` · `set-s2-key`)와 `label for`를 함께 붙여 주세요(지금은 칸 이름이 읽히지 않을 수 있음 — 같은 김에).
- **연락처 이메일 안내 (GD-5 — 확정)**: **"Crossref에 이메일을 알려 주면 요청이 우선 처리돼요(OpenAlex에는 보내지 않아요)."** K-6(확대 — 이메일은 Crossref에만, OpenAlex · arXiv · S2 · PDF 받기에는 보내지 않음, 명세 7.4절)에 따른 문구로, 지금 `dialogs.js`의 `#set-contact-hint`와 같습니다. (개정 전 두 후보 문구는 폐기)

---

## 11. 문구 모음 (한곳에서 찾기)

| 위치 | 문구 |
|---|---|
| 진입(서재 상세) | 인용 그래프 / 주제가 가까운 논문 수십 편을 한 장의 그림으로 보여 줘요. / [인용 그래프 보기] |
| 진입(찾기 카드) | 그래프 / 툴팁: 이 논문과 주제가 가까운 논문들을 그래프로 봐요 |
| 위 막대 | ← 돌아가기(툴팁: 서재로 · 논문 찾기로 · 이전 그래프로 돌아가요) / 인용 그래프 · {제목} / 논문 수 / 보기 · 그래프 · 목록 / 범례 |
| 확대 | 확대 (+) · 축소 (−) · 화면에 맞추기 (0) / 묶음: 확대 · 축소 |
| 범례 | 4.5절. 크기 · 색 · 선 · 점선 · 씨앗 논문 · 서재에 있음 · "진할수록 최근"(어둡게 "밝을수록 최근") · 없음 / 6.3 안내: 후보 {N}편을 비교해 고른 그래프예요(전체 문헌을 다 본 것은 아니에요). / 범례 닫기 |
| 아래 줄 | 후보 {candidates}편 중 {n}편 · OpenAlex 기준 · {built_on} · 끌어서 이동 · 휠로 확대 · 키보드: 화살표로 이동, Enter로 고르기 |
| 패널 탭 | 논문 정보 · 이전 연구 · 이후 연구 / 탭 묶음 이름: 그래프 정보 |
| 패널 칩 | 씨앗 논문 · 씨앗이 인용함 · 씨앗을 인용함 · OpenAlex 관련 논문 · 함께 인용됨 · ✓ 서재에 있음 · 이전 연구 · 그래프 논문 {N}편이 인용 · 이후 연구 · 그래프 논문 {N}편을 인용 |
| 패널 버튼 | ＋ 서재에 추가 · PDF 포함 추가 · (진행) 추가 중 · PDF 받는 중 · ✓ 서재에 있음 · 열기 · 인용 · 인하대에서 보기 · Google Scholar에서 보기 · 이 논문으로 새 그래프 · 펼치기 · 접기 · ← 이전 연구 목록 · ← 이후 연구 목록 |
| 패널 표 | 피인용 {N}회 · 씨앗과: 같은 참고문헌 {N}편 / 함께 인용한 논문 {N}편 / 주제가 비슷함(인용 근거 없음) / 직접 이어진 선은 없어요 · 초록이 없어요. · 가장 가까운 논문 |
| 이전 연구 설명 | 그래프 논문들이 **공통으로 많이 인용한** 논문이에요. 이 분야의 기초 · 대표 문헌일 수 있어요. / 항목: 그래프 논문 {N}편이 인용 · 그래프에 있음 / 빈: 그래프 논문 2편 이상이 함께 인용한 논문이 없어요. |
| 이후 연구 설명 | 그래프 논문들을 **공통으로 많이 인용하는** 논문이에요. 최근 연구나 리뷰일 수 있어요. / 항목: 그래프 논문 {N}편을 인용 / 빈: 그래프 논문 2편 이상을 함께 인용한 논문이 없어요. |
| 목록 표 | 그래프 논문 {N}편 · 씨앗과 비슷한 순(정렬: · 최근 순 · 오래된 순 · 피인용 많은 순 · 피인용 적은 순 · 제목 순 · 비슷하지 않은 순) / 제목 · 연도 · 피인용 · 유사도 · 관계 / 씨앗 |
| 진행 | 그래프를 만드는 중… · 논문 {N}편으로 다시 그리는 중… / 단계: 씨앗 논문 찾기 · 참고문헌 · 관련 논문 모으기 · 이 논문을 인용한 논문 모으기 · 함께 인용된 논문 찾기 · 초록 · 이전 연구 정보 받기 · 유사도 계산 / 기다림: 다른 그래프가 끝나기를 기다리는 중이에요 / 처음 보는 논문은 10~30초 걸릴 수 있어요. / 취소 / (완료) |
| 경고 · 오류 · 빈 상태 | 8.2 · 8.3절 표 |
| 좁은 화면 | 선택: {성}, {연도} · 정보 보기 ↓ |
| 화면 읽기 알림 | 12장 표 |
| 노드 이름(`aria-label`) | {제목}, {연도}년(없으면 "연도 없음"), 피인용 {N}회[, 씨앗 논문][, 서재에 있음] |
| 그림 이름(`aria-label`) | 인용 그래프, 논문 {n}편 · 연결 {m}개 |
| 설정 창 | 10장 |

- 서버 진행 `message`(명세 9.2: "씨앗 논문을 찾는 중" · "참고문헌 · 관련 논문 320편" …)는 **그대로** `.graph-progress-msg`에 씁니다. 다만 기다림은 화면 문구로("다른 그래프가 끝나기를 기다리는 중이에요" — 서버 문구와 같아도 됨).

---

## 12. 접근성 · 키보드

| 항목 | 정한 것 |
|---|---|
| 그림의 대안 | **[목록] 보기**(7장 — 실제 `<table>`, 정렬 · 고르기 · 같은 패널) + 패널의 **가장 가까운 논문**(이웃을 따라가기) + 이전/이후 연구 목록. 그림 자체도 노드마다 이름이 있음 |
| 노드 | `role="button"` · `aria-pressed`(고름) · `aria-label`(11장). SVG `<title>`은 쓰지 않음(툴팁이 이름표와 겹침) |
| 그림 묶음 | `svg[role=group][aria-label][aria-describedby=graph-keys]` — 처음 Tab으로 들어가면 "인용 그래프, 논문 40편 · 연결 112개, 그룹" + 키 안내 |
| roving tabindex | 그래프는 Tab 한 칸(5.2). 노드 80편을 Tab으로 다 지나지 않음 |
| 색만으로 구분하지 않기 | 연도 = 범례 숫자 · 목록 연도 칸 · 노드 이름(연도 포함) / 연도 없음 = 점선 테두리 / 관련 논문 선 = 점선 / 씨앗 = 고리 / 서재 = 체크 모양 / 고름 = 굵은 테두리 + 이름표 굵게 + `aria-pressed` / 진행 단계 = ✓ ● ○ 모양 + `(완료)` · `aria-current` |
| 대비 | 4.2절 — 노드 테두리 · 선 · 고름 표시 모두 그래프 배경 대비 3:1 이상. 글자는 모두 기존 글자 변수 |
| 포커스 링 | 노드 `g-node-focus` 점선 고리, 목록 · 정렬 · 항목 · 탭 · 확대 버튼 `outline 2px var(--accent)`(기존 패턴과 같음) |
| 화면 읽기 알림(`[data-graph-live]`, 늘 빈 채로 그려 둠) | 그래프가 다 그려짐: "논문 {n}편 그래프를 그렸어요. ‘목록’ 보기로 표를 볼 수 있어요." / 노드 고름: "{제목}을 골랐어요." / 서재 추가: "서재에 추가했어요" / 정렬: "{caption 문구}" / 경고가 있으면 다 그린 알림 끝에 "알림 {k}개가 있어요." |
| 진행 | `role=progressbar` + 단계가 바뀔 때만 `role=status` 문구 갱신(8.1) |
| 포커스 이동 | 화면을 열 때 `h1.graph-title`(`tabindex=-1`, 포커스 링 없음), 상태 화면은 `h3`, 좁은 화면 [정보 보기 ↓]는 패널 제목, 목록 → 그래프 전환 때 고른 노드 |
| 움직임 | 배치 애니메이션 없음, 흐리기 0.12초(`prefers-reduced-motion: reduce`면 없음), 이동 즉시 |
| Esc | 강조만 풀기. 대화상자(`modal()`)가 열려 있으면 대화상자가 먼저 받음(지금 동작) |
| 고대비(Windows forced colors) | SVG 색이 그대로일 수 있음 — 목록 보기가 대안(확인 못 함, 13.3) |

---

## 13. 확인 결과 · 남은 것

### 13.1 CSS 변경

- `app.css` 맨 끝에 **245줄 추가**(1110 → 1355줄). 기존 1110줄은 원본 사본과 바이트 비교(`cmp`)로 그대로임을 확인, 줄 끝 CRLF 유지(LF만 있는 줄 0).
- 새 변수: `--g-y0`~`--g-y4`(+`-line`) · `--g-ynone`(+`-line`) · `--g-edge` · `--g-select` · `--g-check`(밝게 · 어둡게).
- 새 클래스: `.graph-entry(-text)` · `.graph-view` 상태 규칙 · `.graph-bar` · `.graph-title` · `.graph-ctls` · `.graph-ctl` · `.graph-body` · `.graph-main` · `.graph-notices` · `.graph-stage` · `.graph-foot` · `.graph-keys` · `.graph-svg` · `.g-edge` · `.g-node(-hit · -dot · -seed · -focus · -lib · -label)` · `.graph-zoom` · `.graph-legend(-head · -items · -note)` · `.g-legend-pair` · `.g-legend-ramp` · `.g-ramp(-none)` · `.g-swatch` · `.graph-progress(-card · -head · -msg · -foot)` · `.graph-steps` · `.graph-step-msg` · `.graph-list` · `.graph-table` · `.graph-sort` · `.graph-row-btn` · `.graph-row-sub` · `.graph-sim` · `.graph-tab-n` · `.graph-paper(-title · -authors · -venue)` · `.graph-abs-toggle` · `.graph-list-back` · `.graph-intro` · `.graph-items` · `.graph-item(-btn · -title · -sub · -meta)` · `.graph-count` · `.graph-jump` · `.keys-note`. 화면 틀 색은 모두 기존 변수.

### 13.2 확인한 것 (정적 시험 페이지)

- 시험 페이지: 디자인팀 scratchpad `graph/index.html`(저장소 밖 — **실제 `app.css` 복사본**, 가짜 노드 40편 · 고정 난수 좌표, d3 없음). 스크린샷 `graph/shots/`.
- 본 것: 그래프(강조 중 · 고름 · 씨앗 · 서재 배지 · 점선 · 연도 없음 노드) · 범례 · 경고 3종 · 진행 카드(처음 · 논문 수 바꾸기) · 목록 표 · 패널 3탭(씨앗 · 일반 노드 · 이전/이후 연구) · 상태 화면(찾지 못함 · 빈 상태 · 취소) · 진입점 2곳 · 설정 키 안내를 **밝은/어두운 테마**, **1280px · 390px**에서.
- 390px: 그래프 · 목록 · 패널 · 범례 열림 모두 가로 넘침 0(`scrollWidth === 390`), 목록 표도 칸 숨김으로 넘치지 않음.
- 확인하며 고친 것: 범례가 그래프를 너무 가려 한 줄 항목으로 줄임 · 좁은 화면에서 위 막대가 눌려 조절기가 경고 밑으로 숨던 것(`flex: none`) · [정보 보기 ↓]가 열린 범례와 겹치던 것 · 오류 상태에서도 조절기 · 빈 패널이 보이던 것(상태 규칙으로 숨김) · 목록 보기에서 "끌어서 이동" 안내가 보이던 것.
- 색 계산: 4.2절 값(대비 · 밝기 단조)은 스크립트로 계산.

### 13.3 실제 화면 확인 (개정 2026-10-07 — 1B 구현 뒤) · 못 한 것 · 남은 것

화면 코드(`static/js/graph.js` · `graphmath.js`)는 이 문서의 클래스 · `data-` 속성 · 문구(11장)를 그대로 씁니다. 아래는 **실제 static 파일에 가짜 SSE를 붙인 시험 페이지**에서 확인한 결과입니다(개발팀 · 품질팀 각각, 2026-10-07).

**개발팀 확인**
| 항목 | 결과 |
|---|---|
| 진행(8.1) | 0.4초 뒤 카드가 나타남, 단계 기호 ✓ ● ○, 단계별 편수 표시, 기다림 문구 |
| 완성 | 노드 40개, 연도 색, 서재 배지, 점선, 이름표, 범례, 경고 상자 2개 |
| 노드 고르기 | 이웃 강조, 패널 갱신, `aria-pressed`, roving tabindex |
| 패널 버튼(6.1) | 서재 추가 때 배지 · `aria-label` · 화면 읽기 알림이 함께 바뀜, 인하대 프록시 링크 `noopener`, Scholar 버튼, 새 그래프, 뒤로 가면 메모리에서 바로 다시 그림 |
| 이전/이후 연구(6.2) | 그래프 밖 논문은 논문 정보 탭으로 열리고 "← 목록"으로 돌아옴 |
| 논문 수 바꾸기 | 반투명 표시 + 라디오 잠금, 40 → 80 뒤 다시 40은 요청 없이 메모리에서 그림 |
| 목록 보기(7장) | 정렬 · `aria-sort` · 행 고르기, 그래프로 돌아오면 포커스 복원 |
| 키보드(5.2) | 화살표 · `Home` · `Enter` · `Esc` · `+` · `0` |
| 마우스 | 휠 확대, 끌어 이동 |
| 상태 화면(8.3) | 취소 · 다시 만들기, 오류 7종, 씨앗 없음 |
| 주소 | `#/graph/W…`로 새로 고침하면 같은 그래프를 다시 그림 |
| 390px(9장) | 가로 넘침 0, 범례 기본 닫힘(GD-8), [정보 보기 ↓], 목록 칸 숨김 |
| 다크 모드 | 색이 맞고 범례 "밝을수록 최근" |
| XSS | 제목에 넣은 `<script>`가 글자로만 표시됨 |
| 확인 중 고친 것 3건 | 화면을 닫을 때 강조 해제 오류, `setPointerCapture` 오류, 논문 수 변경 뒤 서재 배지가 사라짐 |
| 대신한 것 | 서재 상세 진입 버튼(2.1)은 시험 하네스로 그리지 못해 **코드 검토**로 대신함 |

**품질팀 독립 확인**
| 항목 | 결과 |
|---|---|
| d3 불러오기 | SRI로 d3 4개 파일 정상 로드. 노드 40개 · 선 68개 |
| XSS | XSS 제목이 실행되지 않음(문서에 생긴 script 요소 0개) |
| 키보드 | `tabindex="0"`인 노드가 하나뿐, 화살표 → `Enter`로 고르면 패널 버튼 5종이 나옴 |
| 375px + 다크 모드 | `scrollWidth` 375(넘침 0), [정보 보기 ↓] 동작 |
| 상태 화면 7종 | 이미 만드는 중(busy) · 404 · `seed_not_found` · `upstream_limited` · 연결 끊김 · 빈 상태 · 취소 — 문구와 단추 정상 |

**못 한 것 · 남은 것**
- **실제 데이터로 하는 확인**: 명세 M-G01~05 · M-G07(실제 OpenAlex 씨앗 · 크기 · 색 판단 · 묶임 품질 · 패널 버튼 실동작 · 크기 전환), **로그인한 실제 앱 화면** — 개발팀 · 품질팀 모두 못 함. 배포 뒤 [실환경] · [수동]으로 확인. 실제 d3-force 배치에서 이름표 겹침 · 80편 밀도도 이때 봄(M-G02 · M-G03).
- **로그아웃 때 그래프 메모리 비우기**(명세 8.1절 M-5): 개발팀 수정 중 — 수정 뒤 확인.
- **좁은 화면 터치**: 그래프 칸이 58vh라 그 위에서 한 손가락으로 끌면 화면 대신 그래프가 움직임(`touch-action: none`). 위 · 아래 여백으로 화면을 스크롤할 수 있지만 실제 휴대폰에서 불편하면 "두 손가락으로 이동"으로 바꿀지 확인 필요.
- 화면 읽기 프로그램(NVDA 등)으로 노드 이름 · 알림 · 표 정렬 읽힘, Firefox · Safari, Windows 고대비 모드.
- 13.2절 디자인팀 시험 페이지의 1280px 그림은 headless Chrome, 390px는 iframe(폭 390px) 안에서 찍었습니다(브라우저 창 최소 폭 제한 때문). 위 개발팀 · 품질팀 확인도 시험 페이지에서 한 것이라 실제 휴대폰 기기 확인은 아님.

---

## 14. 팀장 결정 (2026-10-07 — GD-1~9 모두 **팀장 결정: 디자인팀 안 채택**)

| # | 질문 | 디자인팀 안 → 결정 |
|---|---|---|
| GD-1 | 그래프 화면에서 사이드바 | **숨김**(`#app.reading`, 읽기 화면처럼 전체 폭). 대안: 사이드바를 두고 그래프 칸 664px(1280px 기준) → **팀장 결정: 디자인팀 안 채택** |
| GD-2 | 연도 색: 연속 vs 구간 | **5구간**(범례에 연도 숫자 · 구별하기 쉬움, 4.2절). 명세 10.3의 "최소~최대를 한 색상 계열로"와 뜻은 같고 AC-G50 시험도 그대로 가능 → **팀장 결정: 디자인팀 안 채택** |
| GD-3 | 서재 상세 상단 버튼 줄에도 [인용 그래프] | **넣지 않음**(인용 관계 탭 맨 위만 — 2.1절). 대안: ⋯ 메뉴에 "인용 그래프 보기" 항목 추가 → **팀장 결정: 디자인팀 안 채택** |
| GD-4 | 경고 문구의 주인 | **화면이 `code`별 문구(8.2절 표)를 쓰고, 모르는 `code`만 서버 `message`**. 진행 `message`는 서버 문구 그대로. 대안: 서버가 8.2절 문구를 `message`로 보내고 화면은 그대로 표시(이 경우 묶음 머리 · 상자 색은 여전히 화면이 `code`로 정함) → **팀장 결정: 디자인팀 안 채택**(명세 9.3절 표) |
| GD-5 | 설정 창 연락처 이메일 안내 | **확정 문구 하나**: "Crossref에 이메일을 알려 주면 요청이 우선 처리돼요(OpenAlex에는 보내지 않아요)."(10장 — K-6 확대) → **팀장 결정: 디자인팀 안 채택** |
| GD-6 | 명세에 이름이 없는 경고 | S2 보강 실패 `s2_failed`, 캐시로 그린 하루 한도 초과 `upstream_limited`(경고로도 씀) → **팀장 결정: 디자인팀 안 채택** — 명세 9.3절 `warnings` 표에 이름 확정됨 |
| GD-7 | 패널 "가장 가까운 논문"(명세에 없는 추가) | **넣음**(이웃 5편 — 키보드 · 화면 읽기 사용자가 그래프 구조를 따라가는 길). 빼도 목록 보기로 대안은 충분 → **팀장 결정: 디자인팀 안 채택** |
| GD-8 | 범례 기본 상태 | **900px 초과 열림 · 이하 닫힘 + 사용자가 바꾸면 `localStorage` `paperlab.graphLegend`에 기억**(개인 기기 설정, 서버 기록 아님) → **팀장 결정: 디자인팀 안 채택** |
| GD-9 | 80편일 때 노드 크기 | **5~22px**(20 · 40편은 명세 가정 6~28px). M-G02 실측 뒤 조정 → **팀장 결정: 디자인팀 안 채택** |
