# 화면 시안 — 인하대 openlink 링크 · Google Scholar 바로가기 (1A단계)

- 작성: 디자인팀 · 2026-10-07
- 근거: [기능 명세](../specs/inha-proxy.md) 8장(화면) · 9.3절 · 10장(문구) · 11.2절(보안) · 13.2절(수동 확인) · 16장(작업 분담)
- 스타일: `paperlab/static/css/app.css` 맨 끝 **"인하대 openlink · Google Scholar 바로가기"** 구역(이번에 추가, 44줄 — `.school-login` 삭제 뒤). 그 위 기존 줄은 바이트 단위로 그대로입니다(줄 끝 CRLF 유지, 920행 근처 주석도 건드리지 않음).
- 개발팀은 **0장 표의 클래스 · data 속성 이름 그대로** 마크업하면 됩니다. 주소는 반드시 `extlinks.js` 함수의 반환값만 `href` · `window.open`에 넣습니다(명세 8.4).
- **버튼 이름 확정(사용자 답변 2026-10-07, 명세 IU-5)**: "인하대에서 보기" · "학교 DB에서 찾기" · "학교 로그인" · "Google Scholar에서 보기". 클래스 · data 속성에는 이름을 넣지 않았으므로 나중에 바뀌어도 10장 문구만 고치면 됩니다.
- **[학교 로그인] 주소 확정(사용자 답변 2026-10-07, 명세 IU-1)**: 도서관 홈페이지 로그인 화면 **`https://lib.inha.ac.kr/login`** 을 새 탭으로 엽니다(openlink 프록시 주소가 아님).
- **개정 2026-10-07 (사용자 결정 — 기획팀이 명세와 맞춰 고침)**: **[학교 로그인]은 설정 창 "학교 연결 (인하대)" 구역에만** 둡니다(논문 찾기 검색창 줄에서 뺌). 프록시 링크를 열면 openlink가 로그인을 자동으로 요구하고 로그인 뒤 원래 주소로 돌아가는 것으로 봅니다(302 → `authredirect.n2s?url=` — 배포 뒤 명세 M-1에서 사용자 확인). G-1 · G-2를 이 흐름에 맞췄습니다(8 · 10장). 팀장 결정 D-1~D-6 반영(13장). 바뀐 곳: 0.2 · 2 · 3 · 7 · 8 · 9 · 10 · 12.3 · 13장. 쓰는 곳이 없어진 `app.css`의 `.school-login` 규칙은 **이미 삭제했습니다**.
- 시험 페이지: 디자인팀 scratchpad `inha/index.html`(저장소 밖)에서 두 테마 · 390px · 1280px로 확인했습니다(12장).

---

## 0. 개발팀용 클래스 · data 속성 목록 (먼저 확정)

> 붙이는 파일은 명세 16장 분담 기준입니다. ★ = 기존 마크업을 바꾸는 곳.

### 0.1 공통

| 이름 | 뜻 |
|---|---|
| `svg.ico.ext-ico` | 새 탭 표시(↗) 아이콘, 12px, 글자 색을 따름. 항상 `aria-hidden="true"`. 모양은 1.2절 |
| `span.sr-only` | 화면에는 안 보이고 화면 읽기 프로그램만 읽는 글자. 새 탭 링크 · 버튼 안에 `(새 탭에서 열림)` |
| `a.ext-link` | 글자 링크 + 아이콘을 한 줄로 묶음(결과 카드 · 정보 탭) |
| `a.btn` | 버튼 모양 링크(밑줄 안 생김 — CSS 추가) |
| 개발팀 도우미(제안) | `dialogs.js`에서 `EXT_MARK` = `ICON_EXT + '<span class="sr-only">(새 탭에서 열림)</span>'`를 내보내 화면 파일들이 같이 씀. `extlinks.js`는 순수 함수로 두므로 넣지 않음 |

### 0.2 논문 찾기 — `discover.js`

| 이름 | 붙이는 곳 | 뜻 |
|---|---|---|
| `div.school-bar[data-school-bar]` (`role="group"`, `aria-labelledby="school-bar-label"`) | `.discover-head` 안, `.discover-filters` **다음**(맨 끝) | "학교 DB에서 찾기" 줄 |
| `span.school-bar-label#school-bar-label` | 줄 맨 앞 | 글자 "학교 DB에서 찾기" |
| `div.school-links` | 라벨 다음 | DB · Scholar 버튼 묶음 |
| `button.btn.sm[data-inha-search="riss｜dbpia｜kiss"]` | `.school-links` | 학교 DB 검색(새 탭). 비활성은 `disabled` |
| `span.school-sep` (`aria-hidden="true"`) | KISS와 Scholar 사이 | 세로 구분선(560px 이하 숨김) |
| `button.btn.sm[data-scholar-search]` | `.school-links` 끝 | Google Scholar 검색(새 탭) |
| `span.school-hint#school-hint[data-school-hint]` (+`hidden` 클래스) | `.school-links` 다음 | 검색어가 비었을 때만 보이는 "검색어를 입력하세요" |
| `a.ext-link[data-inha-open]` | 결과 카드 `.r-actions` 맨 끝 | 인하대에서 보기 |

### 0.3 서재 상세 패널 — `library.js` `renderDetail` · `infoView`

| 이름 | 붙이는 곳 | 뜻 |
|---|---|---|
| `a.btn[data-inha-open]` ★ | `.actions`, `[data-fetch]` 바로 뒤 | 인하대에서 보기(PDF 없는 논문 · 대상 있음) |
| `span.menu-wrap > button.btn[data-inha-title-search]` (`aria-haspopup="menu"`, `aria-expanded`) ★ | 같은 자리(대상 없음) | 학교 DB에서 제목 검색 ▾ |
| `div.inha-after-slot[data-inha-after]` (`role="status"`) ★ | `.actions` 바로 다음(`[data-issues]` 앞) | G-5 안내가 들어갈 빈 자리. 늘 그려 두고 안에 `.notice.inha-after`를 넣고 뺌 |
| `.notice.inha-after[data-tone="info"]` | `[data-inha-after]` 안 | G-5 한 줄 안내 |
| `⋯` 메뉴 항목 `{ label: "인하대에서 보기", sub: "새 탭" }` ★ | PDF 있는 논문, "PDF 파일 열기" 다음 | `popupMenu` 그대로 |
| `<dt>바로가기</dt><dd><a class="ext-link" data-scholar-open>` ★ | 정보 탭 `dl.kv`, DOI · arXiv · 링크 줄 **다음** | Google Scholar에서 보기 |

### 0.4 읽기 화면 — `reader.js` `loadPdf`

| 이름 | 뜻 |
|---|---|
| `div.empty.pdf-missing` ★ | 지금 빈 화면(`.empty`)에 클래스 하나 더함 |
| `div.empty-actions` | 문구 아래 버튼 줄(가운데 정렬, 줄바꿈) |
| `a.btn.primary[data-inha-open]` | 인하대에서 보기(대상 있을 때) |
| `button.btn[data-attach]` | PDF 첨부(대상 없으면 `primary`) |

### 0.5 설정 창 · 안내 창 — `dialogs.js`

| 이름 | 뜻 |
|---|---|
| `div.section-title#set-school-title` | "학교 연결 (인하대)" — "논문 검색 데이터베이스" 다음, "계정" 앞 |
| `div.field[role="group"][aria-labelledby="set-school-title"]` | 구역 묶음 |
| `div.row.school-conn` | 버튼 줄(줄바꿈 허용) |
| `a.btn.sm[data-inha-login]` (`aria-describedby="set-school-g2"`) | 학교 로그인 |
| `button.btn.sm.ghost[data-inha-guide]` | 처음 안내 다시 보기 |
| `div.school-conn-notes` > `div.hint.is-strong#set-school-g2` · `div.hint` | G-2 · G-6 |
| `.modal.inha-guide-modal` | 안내 창(`modal()` 뒤 `.modal`에 추가 — 바닥 줄바꿈 허용) |
| `div.inha-guide` | 안내 본문(세로 묶음) |
| `ol.inha-guide-list` | 안내 번호 목록 |
| `input[type=checkbox][data-guide-skip]` | 다시 보지 않기(바닥 `.left` 안) |
| `button.btn[data-no]` · `button.btn.primary[data-guide-go]` | 취소 · 계속 열기 |
| `localStorage` 키 `paperlab.inhaGuideSeen = "1"` | 명세 10장 그대로 |

---

## 1. 공통 원칙

| 항목 | 정한 것 |
|---|---|
| 재사용 | `.btn`(`sm` · `primary` · `ghost`) · `.menu`(`popupMenu`) · `.notice[data-tone]` · `.empty` · `.kv` · `.section-title` · `.field .hint(.is-strong)` · `.check` · `.modal`(`modal()`) · `toast` · `.hidden`. 새 클래스는 줄 배치 · 아이콘 크기 · 화면 읽기 전용 글자만 |
| 색 | 모두 기존 변수(`--accent` #1E3A8A 네이비 / 어두운 테마 #4169E1, `--accent-text`, `--text-2` · `--text-3`, `--border(-strong)`). 새 색 없음 |
| 테마 | 두 테마 모두 변수만으로 맞음(12장에서 확인) |
| `<a>`와 `<button>` | **주소가 정해진 것은 `<a href target="_blank" rel="noopener noreferrer">`**(인하대에서 보기 · 학교 로그인 · 정보 탭 Scholar) — 가운데 클릭 · 주소 복사가 되고 화면 읽기 프로그램이 "링크"로 읽음. **입력값에 따라 바뀌거나 비활성이 필요한 것은 `<button type="button">`**(검색창 줄 DB · Scholar, 제목 검색 메뉴) — 누를 때 `window.open(url, "_blank", "noopener,noreferrer")` |
| 기존 링크 | 제목 링크 · [PDF] · DOI · arXiv 링크(`rel="noopener"`)는 **바꾸지 않음**(명세 IK-7). 아이콘도 새 링크에만 붙임 |

### 1.1 외부 링크 아이콘 — 표시함

- 이번에 새로 넣는 **새 탭 링크 · 버튼에는 모두 ↗ 아이콘**을 글자 뒤에 붙입니다. 이유: 누르면 PaperLab을 떠나 학교 로그인 화면이 뜰 수 있으므로, 같은 줄의 [인용] · [참고문헌](같은 화면에서 동작)과 구별돼야 합니다.
- 메뉴 항목(`popupMenu`)은 글자만 받으므로 아이콘 대신 아랫줄 `sub`에 **"새 탭"** 을 씁니다(화면 읽기 프로그램도 그대로 읽음).
- 기존 외부 링크(제목 · [PDF] · DOI)에 아이콘을 붙일지는 이번 범위 밖 — 붙이면 결과 카드가 아이콘투성이가 되므로 지금은 새 링크만(12.3 남은 것).

### 1.2 아이콘 · 화면 읽기 글자 (복사해서 쓰기)

```html
<svg class="ico ext-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg><span class="sr-only">(새 탭에서 열림)</span>
```

- 링크 · 버튼의 접근 가능한 이름 = 보이는 글자 + "(새 탭에서 열림)" — 예: "인하대에서 보기 (새 탭에서 열림)". `aria-label`로 덮어쓰지 않습니다(보이는 이름과 읽는 이름이 같아야 음성 명령이 맞음).

---

## 2. 링크 여는 방식 · 처음 안내 창 연결 (명세 8.4 — 개발팀 `openExternal`)

| 누르는 것 | 처음 안내 창(G-1) | 여는 주소 |
|---|---|---|
| 인하대에서 보기(결과 카드 · 상세 · ⋯ 메뉴 · 읽기 화면) | **뜸**(처음 한 번) | `paperProxyTarget(p)` |
| 학교 DB 버튼(RISS · DBpia · KISS — 검색창 줄 · 상세 제목 검색 메뉴) | **뜸** | `inhaSearchUrl(db, q)` |
| 학교 로그인(**설정 창에만**) | **뜸** | `INHA.loginUrl` = `https://lib.inha.ac.kr/login`(확정, 사용자가 로그인 버튼에서 확인. returnUrl 쿼리는 붙이지 않음 — 프록시 변환 · `toInhaProxy`를 거치지 않는 고정 주소) |
| Google Scholar(검색창 줄 · 정보 탭) | 안 뜸 | `scholarUrl(q)` |

- `<a>`는 클릭 때 `paperlab.inhaGuideSeen`이 없으면 `e.preventDefault()` → 안내 창 → [계속 열기]의 클릭 처리 안에서 **바로** `window.open(href, "_blank", "noopener,noreferrer")`(팝업 차단 회피 — `await` 뒤에 열지 않기). 이미 봤으면 막지 않고 링크 기본 동작으로 엶.
- 가운데 클릭 · 수정키(Ctrl/⌘/Shift) 클릭은 안내 창 없이 열립니다(**팀장 결정 D-3** — 안내는 알림용이고, 그렇게 여는 사람은 이미 아는 사람). `click`에서 `e.ctrlKey || e.metaKey || e.shiftKey`면 막지 않고, `auxclick`은 검사하지 않습니다.
- `localStorage`를 못 쓰는 브라우저(시크릿 일부 · 저장소 차단)는 `try/catch`로 감싸고 **매번 안내 창**을 띄웁니다.
- 안내 창을 닫은 뒤 포커스는 누른 버튼 · 링크로 돌려 주세요(`modal()`은 포커스를 돌려주지 않음 — 새 탭으로 옮겨 가지 않았을 때(취소) 필요).

---

## 3. 논문 찾기 — "학교 DB에서 찾기" 줄 (명세 8.1 · 9.3)

> 개정 2026-10-07(사용자 결정): 이 줄에는 **[학교 로그인]이 없습니다**(설정 창에만 — 7장). 로그인하지 않은 채 DB 버튼을 눌러도 openlink가 로그인을 요구하고, 로그인 뒤 그 검색 결과로 돌아갑니다(명세 M-1 · M-3에서 확인).

```
논문 찾기
[⌕ 딥러닝 결함 검출                          ] [OpenAlex ▾] [검색]
기간 [부터] – [까지]  정렬 (관련도순|피인용순|최신순)  □ 무료 PDF …        설명
───────────────────────────────────────────────────────────────────────
학교 DB에서 찾기 [RISS ↗] [DBpia ↗] [KISS ↗] │ [Google Scholar ↗]
```

검색어가 비었을 때:

```
학교 DB에서 찾기 [RISS ↗] [DBpia ↗] [KISS ↗] │ [Google Scholar ↗]  검색어를 입력하세요
                 └──────────── 흐리게(disabled) ────────────┘
```

### 3.1 골격 (`.discover-filters` 다음, `.discover-head` 안)

```html
<div class="school-bar" data-school-bar role="group" aria-labelledby="school-bar-label">
  <span class="school-bar-label" id="school-bar-label">학교 DB에서 찾기</span>
  <div class="school-links">
    <button type="button" class="btn sm" data-inha-search="riss" title="검색어로 RISS를 열어요 (인하대 openlink)">RISS{EXT_MARK}</button>
    <button type="button" class="btn sm" data-inha-search="dbpia" title="검색어로 DBpia를 열어요 (인하대 openlink)">DBpia{EXT_MARK}</button>
    <button type="button" class="btn sm" data-inha-search="kiss" title="KISS 첫 페이지를 열고 검색어를 복사해요">KISS{EXT_MARK}</button>
    <span class="school-sep" aria-hidden="true"></span>
    <button type="button" class="btn sm" data-scholar-search title="검색어로 Google Scholar를 열어요. Scholar 설정 → 도서관 링크에서 ‘인하대학교’를 켜면 학교 구독 원문 링크가 함께 나와요.">Google Scholar{EXT_MARK}</button>
  </div>
  <span class="school-hint hidden" id="school-hint" data-school-hint>검색어를 입력하세요</span>
</div>
```

- 이 줄은 `<form class="discover-bar">` **밖**이라 버튼을 눌러도 PaperLab 검색이 실행되지 않습니다(`type="button"`도 붙임).

### 3.2 상태

| 상태 | 화면 |
|---|---|
| 검색창 입력값을 `normalizeQuery`한 결과가 빔(빈칸 · 공백 · 줄바꿈뿐) | 네 버튼 `disabled`(+ 명세대로 `aria-disabled="true"`, 해는 없음) · 각 버튼 `title="검색어를 입력하세요"` · `[data-school-hint]`의 `hidden` 클래스 뺌 |
| 글자가 있음 | 네 버튼 켜짐, `title`은 3.1의 설명으로 되돌림, `[data-school-hint]`에 `hidden` |
| 다시 계산하는 때 | 화면을 그릴 때(이전 `ds.q`가 들어 있음) + 검색창 `input` 이벤트마다(검색 버튼을 누르기 전 값도) |
| 함수가 `null`을 줌(질의 정규화 결과 빔 이외에는 없음) | 그 버튼 `disabled` — 오류 창 · 토스트 없음 |
| 누름 | 2장 표대로(학교 DB는 처음이면 안내 창). 질의는 **누른 순간의** 검색창 값 |

### 3.3 KISS 임시안 (명세 7.1 · G-4 — IU-3 확인 전까지)

- [KISS] → KISS 프록시 첫 페이지를 새 탭으로 열고 검색어를 클립보드에 복사 → 토스트 **"검색어를 복사했어요. KISS 검색창에 붙여 넣으세요."**(보통, **8초** — 한 문장을 넘는 안내는 8초, 양식 시안 2.3절 규칙).
- 순서: `navigator.clipboard.writeText(q)`를 **먼저 부르고**(기다리지 않음) 곧바로 `window.open`. 새 탭이 열려 PaperLab 창이 포커스를 잃은 뒤에는 Chrome이 클립보드 쓰기를 거부할 수 있기 때문입니다(개발팀 실제 확인 필요).
- 복사 실패: 토스트 **"검색어를 복사하지 못했어요. KISS 검색창에 직접 입력해 주세요."**(보통, 8초). 새 탭은 그대로 엶.
- `ui.js`의 `copyText`는 스스로 "복사했어요" 토스트를 띄우므로 그대로 쓰면 토스트가 둘이 됩니다 — G-4 하나만 보이게 해 주세요.
- 화면 읽기 프로그램: KISS 버튼의 `.sr-only`를 `(새 탭에서 열림 · 검색어를 복사해요)`로.
- **IU-3 확인 뒤**: KISS도 RISS와 똑같이(검색 결과 주소로 열기) — 토스트 · 위 `title` · `sr-only` 추가 문구 · 3.5절 메뉴의 "제목 복사"를 지웁니다.

### 3.4 좁은 화면

| 폭 | 배치 |
|---|---|
| 560px 초과 | 한 줄. 넘치면 버튼이 다음 줄로 넘어감 |
| 560px 이하 | 라벨이 한 줄을 차지하고, 그 아래 버튼들이 줄바꿈. 구분선 숨김(390px에서: RISS · DBpia · KISS / Google Scholar / [검색어를 입력하세요] — 학교 로그인이 빠졌으므로 390px 배치는 개발 통합 뒤 다시 확인) |

---

## 4. 논문 찾기 — 결과 카드 (명세 8.1)

```
Deep Residual Learning for Image Recognition
K He, X Zhang … - CVPR, 2016 - doi:10.1109/CVPR.2016.90
[＋ 서재에 추가] [PDF 포함 추가]  인용  피인용 123,456  참고문헌  관련 논문  [PDF] arxiv.org  인하대에서 보기 ↗
```

```html
<!-- .r-actions 맨 끝, paperProxyTarget(it)가 null이 아닐 때만 -->
<a class="ext-link" href="{esc(target)}" target="_blank" rel="noopener noreferrer" data-inha-open
   title="인하대 openlink(정석학술정보관)로 원문 페이지를 열어요">인하대에서 보기{EXT_MARK}</a>
```

- 색 · 크기는 같은 줄의 [PDF] 링크와 같음(`--accent-text`, 13px). [PDF] 링크가 있어도 함께 보입니다.
- 인용 관계 화면(`drawGraph`)도 같은 `resultCard`를 쓰므로 거기에도 나옵니다(의도). 서재 상세의 인용 관계 목록(`miniResult`)에는 넣지 않습니다(명세 가정).
- 대상이 `null`이면(arXiv · OpenAlex · Semantic Scholar · KCI 주소만 있음, 주소 없음) **링크 자체를 그리지 않음**(빈 자리 · 비활성 표시 없음 — 명세 5.2).

---

## 5. 서재 상세 패널 (명세 8.2 · 9.3)

### 5.1 PDF 없는 논문 — 대상 있음

```
스마트 제조 공정의 품질 예측을 위한 딥러닝 모델 연구
김인하, 홍길동
[PDF 받기] [인하대에서 보기 ↗] [PDF 첨부] [인용] [⋯]
┃ ⓘ 학교 사이트에서 PDF를 받았다면 [PDF 첨부]로 올려 주세요.     ← 누른 뒤에만
```

```html
<div class="actions">
  <button class="btn primary" data-fetch>PDF 받기</button>
  <a class="btn" href="{esc(target)}" target="_blank" rel="noopener noreferrer" data-inha-open
     title="인하대 openlink(정석학술정보관)로 원문 페이지를 열어요">인하대에서 보기{EXT_MARK}</a>
  <button class="btn" data-attach>PDF 첨부</button>
  <button class="btn" data-cite>인용</button>
  <span class="menu-wrap"><button class="btn" data-more>⋯</button></span>
</div>
<div class="inha-after-slot" data-inha-after role="status"></div>
<div data-issues></div>
```

- 순서는 **받는 흐름대로**: 무료 PDF 찾기(PDF 받기) → 학교에서 열기 → 받은 파일 올리기(PDF 첨부). 400px 패널에서 [인용] [⋯]은 둘째 줄로 내려갑니다(지금도 `flex-wrap`).
- [인하대에서 보기]는 **보조 버튼**(테두리) — 주 버튼은 지금처럼 [PDF 받기] 하나.

**G-5 안내** — 실제로 새 탭을 연 뒤(안내 창에서 [취소]했으면 아님) `[data-inha-after]` 안에 넣습니다:

```html
<div class="notice inha-after" data-tone="info"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5v.01"/></svg><div>학교 사이트에서 PDF를 받았다면 <b>[PDF 첨부]</b>로 올려 주세요.</div></div>
```

- `role="status"` 자리는 **늘 비어 있는 채로 그려 두고** 내용을 나중에 넣어야 화면 읽기 프로그램이 읽습니다(내용이 든 채로 새로 생긴 live 영역은 읽지 않는 브라우저가 있음).
- 언제까지: **상세 패널을 다시 그릴 때까지**(팀장 결정 D-1 — 명세 문구대로). 상태 · 별점 · 태그를 바꿔 패널이 다시 그려지면 안내도 사라집니다. (기각된 디자인팀 제안: 모듈 변수로 같은 논문이 열려 있는 동안 유지)

### 5.2 PDF 없는 논문 — 대상 없음 (제목 검색 메뉴)

```
[PDF 받기] [학교 DB에서 제목 검색 ▾] [PDF 첨부] [인용] [⋯]
           ┌────────────────────────┐
           │ RISS               새 탭 │
           │ DBpia              새 탭 │
           │ KISS     새 탭 · 제목 복사 │
           └────────────────────────┘
```

```html
<span class="menu-wrap"><button class="btn" data-inha-title-search aria-haspopup="menu" aria-expanded="false">학교 DB에서 제목 검색 ▾</button></span>
```

- `popupMenu(btn, items, { left: true, focus: 키보드로 열었으면 true, onClose: () => btn.setAttribute("aria-expanded", "false") })`, 열 때 `aria-expanded="true"`.
- 항목: `{ label: "RISS", sub: "새 탭" }` · `{ label: "DBpia", sub: "새 탭" }` · `{ label: "KISS", sub: "새 탭 · 제목 복사" }`(3.3 임시안 — 복사 · 토스트 동작 같음, 토스트 문구의 "검색어"는 그대로). 질의 = 논문 제목.
- 제목이 비어 있으면(정규화 결과 빔) 이 버튼도 그리지 않습니다.

### 5.3 PDF 있는 논문 — `⋯` 메뉴

```
정보 수정 / 폴더로 이동… / 온라인 정보로 채우기 / PDF 바꾸기 / PDF 파일 열기 / 인하대에서 보기 (새 탭) / 하이라이트·노트 내보내기 (.md) / ─ / 삭제
```

- `{ label: "인하대에서 보기", sub: "새 탭", action }` — 대상이 있을 때만, "PDF 파일 열기" 바로 다음. `popupMenu`의 항목 클릭 처리 안에서 동기로 실행되므로 `window.open`이 팝업 차단에 걸리지 않습니다. G-5는 띄우지 않음(PDF가 이미 있음).

### 5.4 정보 탭 — Google Scholar (명세 8.2 "디자인팀 결정")

**정보 탭 식별자 목록의 "바로가기" 줄로 정했습니다**(⋯ 메뉴가 아님). 이유: ⋯ 메뉴는 숨어 있어 찾기 어렵고 대부분 이 논문을 *바꾸는* 동작인데, Scholar는 자주 쓰는 *찾아보기* 링크라 DOI · arXiv 옆이 자연스럽습니다. 진짜 링크라 가운데 클릭 · 주소 복사도 됩니다.

```
DOI      10.1109/CVPR.2016.90
arXiv    1512.03385
바로가기  Google Scholar에서 보기 ↗
유형      학술지 논문
```

```html
<!-- ids 문자열 끝(DOI · arXiv · 링크 다음)에 붙임. scholarUrl(제목 || DOI)가 null이면 줄 전체 생략 -->
<dt>바로가기</dt><dd><a class="ext-link" href="{esc(url)}" target="_blank" rel="noopener noreferrer" data-scholar-open
  title="Scholar 설정 → 도서관 링크에서 ‘인하대학교’를 켜면 학교 구독 원문 링크가 함께 나와요.">Google Scholar에서 보기{EXT_MARK}</a></dd>
```

- 질의: 제목, 제목이 비면 DOI(명세 IK-3). 안내 창 없이 바로 엶.
- 줄 이름을 "바로가기"로 둔 것은 나중에 다른 바로가기(예: 2단계 KCI)가 같은 줄에 ` · `로 이어 붙을 수 있게 하려는 것입니다.

---

## 6. 읽기 화면 — PDF 없는 논문 (명세 8.3)

```
              PDF가 없어요
 인하대에서 논문을 열어 PDF를 받은 뒤 [PDF 첨부]로 올려 주세요.
        [인하대에서 보기 ↗] [PDF 첨부]
```

| 경우 | 문구(`p`) | 버튼 |
|---|---|---|
| 대상 있음 | 인하대에서 논문을 열어 PDF를 받은 뒤 [PDF 첨부]로 올려 주세요. | `a.btn.primary[data-inha-open]` 인하대에서 보기 ↗ · `button.btn[data-attach]` PDF 첨부 |
| 대상 없음 | PDF 파일이 있으면 [PDF 첨부]로 올려 주세요. 무료 PDF는 서재 상세 패널의 [PDF 받기]로 찾을 수 있어요. | `button.btn.primary[data-attach]` PDF 첨부 |

```html
<div class="empty pdf-missing">
  <h3>PDF가 없어요</h3>
  <p>인하대에서 논문을 열어 PDF를 받은 뒤 [PDF 첨부]로 올려 주세요.</p>
  <div class="empty-actions">
    <a class="btn primary" href="{esc(target)}" target="_blank" rel="noopener noreferrer" data-inha-open>인하대에서 보기{EXT_MARK}</a>
    <button type="button" class="btn" data-attach>PDF 첨부</button>
  </div>
</div>
```

- 문구 자체가 G-5 뜻을 담으므로 여기서는 따로 한 줄 안내를 띄우지 않습니다.
- [PDF 첨부] → `uploadPdfs([file], { attachTo: pid })`(파일 고르기는 상세 패널과 같은 `attachPdf` 흐름), 끝나면 읽기 화면을 다시 불러 PDF 표시(명세 8.3). 실패하면 빈 화면 그대로(업로드 창이 오류를 보여 줌).
- 키보드: 두 버튼 모두 Tab으로 닿음. 읽기 화면의 Esc(서재로)는 지금 그대로(입력 칸이 아니므로 버튼에 포커스가 있어도 Esc = 서재로).

---

## 7. 설정 창 "학교 연결 (인하대)" 구역 (명세 8.5 · 10장 — 학교 로그인의 유일한 위치)

**"학교 로그인"은 설정 창에만 둡니다**(사용자 결정 2026-10-07 · 팀장 결정 D-6). 이유: 프록시 링크를 열면 openlink가 로그인을 자동으로 요구하고 로그인 뒤 원래 주소로 돌아가므로(명세 8.5 — M-1에서 확인) 매번 미리 로그인할 필요가 없고, 이 버튼은 미리 로그인해 두고 싶을 때 쓰는 보조 수단입니다. 사이드바는 236px로 좁고 900px 이하에서는 아예 숨어 후보에서 뺐습니다.

"논문 검색 데이터베이스" 다음, "계정" 앞:

```html
<div class="section-title" id="set-school-title">학교 연결 (인하대)</div>
<div class="field" role="group" aria-labelledby="set-school-title">
  <div class="row school-conn">
    <a class="btn sm" href="{INHA.loginUrl}" target="_blank" rel="noopener noreferrer" data-inha-login aria-describedby="set-school-g2">학교 로그인{EXT_MARK}</a>
    <button type="button" class="btn sm ghost" data-inha-guide>처음 안내 다시 보기</button>
  </div>
  <div class="school-conn-notes">
    <div class="hint is-strong" id="set-school-g2">‘인하대에서 보기’를 누르면 학교 로그인이 필요할 때 자동으로 로그인 화면이 뜨고, 로그인하면 보려던 페이지로 돌아가요. 미리 로그인해 두고 싶으면 [학교 로그인]을 누르세요. 로그인은 학교 화면에서 직접 하고, PaperLab은 학교 계정을 저장하거나 사용하지 않아요. 학교 로그인이 끝나면 다시 로그인 화면이 떠요.</div>
    <div class="hint">Google Scholar: 설정 → 도서관 링크에서 ‘인하대학교’를 켜면 검색 결과에 학교 구독 원문 링크가 함께 나와요.</div>
  </div>
</div>
```

- 입력 칸이 없어 기존 저장 코드(`FormData`)에 아무것도 실리지 않습니다(학교 계정 칸 없음 — 명세 S-5).
- [학교 로그인]: 2장 규칙(처음이면 안내 창). 설정 창은 열린 채로 둡니다.
- [처음 안내 다시 보기]: 8.2절 "보기 전용"으로 안내 창을 설정 창 위에 엶(`modal()`은 겹친 창의 Esc를 맨 위 창만 받음 — 지금 동작).

---

## 8. 처음 쓸 때 안내 창 (G-1 — 개발팀 `inhaGuideDialog`)

```
┌ 인하대 정석학술정보관으로 열어요 ─────────────────────── ✕ ┐
│ ┃🔒 PaperLab은 학교 아이디·비밀번호를 저장하거나 사용하지 않아요. │
│ ┃   로그인은 이 브라우저와 학교 사이에서만 이뤄져요.            │
│ 1. 학교에 로그인하지 않았으면 학교 로그인 화면이 자동으로 떠요.     │
│    정석학술정보관 계정으로 학교 화면에서 직접 로그인하면 보려던     │
│    페이지로 돌아가요.                                         │
│ 2. 시간이 지나거나 브라우저를 닫아 학교 로그인이 끝나면 다음에 열 때 │
│    다시 로그인 화면이 떠요.                                    │
│ 3. 받은 PDF는 서재의 논문 상세에서 [PDF 첨부]로 올려 주세요.      │
│ 4. 학교가 구독하지 않는 사이트면 학교 안내·오류 페이지나 출판사의   │
│    구매 화면이 뜰 수 있어요.                                   │
│ ┃⚠ 구독 계약상 논문을 한꺼번에 많이 받으면 학교 전체 접속이 막힐 수 │
│ ┃   있어요. 필요한 논문만 한 편씩 받아 주세요.                   │
├──────────────────────────────────────────────────────────┤
│ □ 다시 보지 않기                       [취소] [계속 열기 ↗]   │
└──────────────────────────────────────────────────────────┘
```

### 8.1 골격

`modal({ title: "인하대 정석학술정보관으로 열어요", body, foot })` 후 `m.el.querySelector(".modal").classList.add("inha-guide-modal")`.

```html
<!-- body -->
<div class="inha-guide">
  <div class="notice" data-tone="info"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg><div><b>PaperLab은 학교 아이디·비밀번호를 저장하거나 사용하지 않아요.</b> 로그인은 이 브라우저와 학교 사이에서만 이뤄져요.</div></div>
  <ol class="inha-guide-list">
    <li>학교에 로그인하지 않았으면 <b>학교 로그인 화면이 자동으로 떠요.</b> <b>정석학술정보관 계정으로 학교 화면에서 직접</b> 로그인하면 <b>보려던 페이지로 돌아가요.</b></li>
    <li>시간이 지나거나 브라우저를 닫아 학교 로그인이 끝나면 다음에 열 때 <b>다시 로그인 화면이 떠요.</b></li>
    <li>받은 PDF는 서재의 논문 상세에서 <b>[PDF 첨부]</b>로 올려 주세요.</li>
    <li>학교가 구독하지 않는 사이트면 학교 안내·오류 페이지나 출판사의 구매 화면이 뜰 수 있어요.</li>
  </ol>
  <div class="notice" data-tone="warn">{ICON_WARN — dialogs.js에 이미 있음}<div>구독 계약상 <b>논문을 한꺼번에 많이 받으면 학교 전체 접속이 막힐 수 있어요.</b> 필요한 논문만 한 편씩 받아 주세요.</div></div>
</div>
<!-- foot (여는 경우) -->
<div style="display:contents">
  <div class="left"><label class="check"><input type="checkbox" data-guide-skip> 다시 보지 않기</label></div>
  <button class="btn" data-no>취소</button>
  <button class="btn primary" data-guide-go>계속 열기{EXT_MARK}</button>
</div>
<!-- foot (설정의 "처음 안내 다시 보기" — 보기 전용) -->
<div style="display:contents">
  <div class="left"><label class="check"><input type="checkbox" data-guide-skip> 다시 보지 않기</label></div>
  <button class="btn primary" data-no>닫기</button>
</div>
```

- 명세 G-1의 ①~⑥ 뜻은 그대로 두고 **배치만** 바꿨습니다: ②(계정을 저장하지 않음)는 가장 먼저 읽혀야 하므로 맨 위 파란 상자로, ⑥(한꺼번에 받기 금지)은 경고라서 맨 아래 주황 상자로, 나머지 ①③④⑤는 번호 목록 1~4.

### 8.2 동작

| 항목 | 정한 것 |
|---|---|
| 열릴 때 포커스 | **[계속 열기]**(보기 전용이면 [닫기]) — `confirmDialog`처럼 `setTimeout(() => btn.focus(), 40)`. Enter = 계속 열기 |
| [계속 열기] | 클릭 처리 안에서 **동기로** `window.open(url, "_blank", "noopener,noreferrer")` → 창 닫기. KISS면 3.3절 순서(복사 먼저) |
| [취소] · Esc · ✕ · 바깥 클릭 | 열지 않고 닫음. 포커스는 누른 버튼으로(2장) |
| 다시 보지 않기 | (팀장 결정 D-2) 창이 **어떻게 닫히든** 체크 상태를 저장: 켜짐 → `localStorage.setItem("paperlab.inhaGuideSeen", "1")`, 꺼짐 → `removeItem`. 보기 전용으로 열 때는 지금 저장된 값으로 체크해서 보여 줌(여기서 끄면 다음에 다시 뜸) |
| 바닥 줄 | 좁으면 체크 상자 줄과 버튼 줄이 나뉘어 접힘(`.inha-guide-modal .modal-foot { flex-wrap: wrap }`). 390px에서는 한 줄에 들어감 |
| Tab 순서 | ✕ → 다시 보지 않기 → 취소 → 계속 열기(본문에는 포커스 갈 곳 없음) |

---

## 9. 숨김 · 비활성 규칙 (한눈에)

| 위치 | 함수 결과가 `null`일 때 | 비고 |
|---|---|---|
| 검색창 줄 RISS · DBpia · KISS · Scholar | **비활성**(`disabled`) + "검색어를 입력하세요"(보이는 글자 + `title`) | 질의를 입력하면 켜지므로 자리를 남김 |
| 결과 카드 인하대에서 보기 | **숨김**(그리지 않음) | 변환 불가 주소 · 제외 호스트 · 주소 없음 |
| 상세 인하대에서 보기(PDF 없음) | **숨김** → 대신 학교 DB에서 제목 검색 ▾ | 제목도 비면 그것도 숨김 |
| 상세 ⋯ 메뉴 인하대에서 보기(PDF 있음) | 항목 빼기 | |
| 정보 탭 바로가기 · Scholar | 줄 전체 빼기 | 제목 · DOI 둘 다 없을 때만 |
| 읽기 화면 인하대에서 보기 | **숨김**, 문구 · [PDF 첨부]만(6장 표) | |
| 설정 학교 로그인 · 안내 다시 보기 | 해당 없음 — 항상 보임 | |

- 원칙: **사용자가 바꿀 수 있는 원인(검색어)이면 비활성 + 이유, 바꿀 수 없는 원인(주소 형식)이면 숨김.** 숨길 때 오류 창 · 토스트 없음(명세 5.2).

---

## 10. 문구 모음 (한곳에서 찾기)

> 버튼 이름 4개는 **확정**(사용자 답변 2026-10-07). G-2는 사용자 답변 취지로 확정. G-4 · G-6은 확인 결과(IU-3 · IU-4)에 따라 바뀔 수 있음.

| # | 위치 | 문구 |
|---|---|---|
| — | 버튼 · 링크 | **인하대에서 보기** / **학교 DB에서 찾기**(줄 이름) / **학교 로그인** / **Google Scholar에서 보기**(정보 탭) · **Google Scholar**(검색창 줄 — 줄 이름이 "찾기"라 짧게) / **학교 DB에서 제목 검색 ▾**(상세, 대상 없음) |
| — | 화면 읽기 글자 | (새 탭에서 열림) / KISS 임시안: (새 탭에서 열림 · 검색어를 복사해요) |
| — | 메뉴 아랫줄 | 새 탭 / KISS: 새 탭 · 제목 복사 |
| — | 인하대에서 보기 툴팁 | 인하대 openlink(정석학술정보관)로 원문 페이지를 열어요 |
| — | 검색창 줄 툴팁 | 검색어로 RISS를 열어요 (인하대 openlink) / 검색어로 DBpia를 열어요 (인하대 openlink) / KISS 첫 페이지를 열고 검색어를 복사해요 / 검색어로 Google Scholar를 열어요. + G-6 |
| G-1 | 안내 창 제목 | 인하대 정석학술정보관으로 열어요 |
| G-1 | 안내 창 본문 | 8.1절(명세 ①~⑥ 뜻 유지, 배치만 바꿈. 개정 2026-10-07: ①을 "자동으로 로그인 화면이 뜨고, 로그인하면 보려던 페이지로 돌아감" 흐름으로. 바뀐 표현: ③ "학교 로그인이 끝나면(시간이 지나거나 브라우저를 닫으면) 다음에 열 때" → "시간이 지나거나 브라우저를 닫아 학교 로그인이 끝나면 다음에 열 때", ④ "올리세요" → "올려 주세요") |
| G-1 | 안내 창 버튼 | □ 다시 보지 않기 · [취소] [계속 열기] / 보기 전용: [닫기] |
| G-2 | 설정 구역 설명(학교 로그인 버튼 옆 — 검색창 줄 툴팁은 없어짐) | ‘인하대에서 보기’를 누르면 학교 로그인이 필요할 때 자동으로 로그인 화면이 뜨고, 로그인하면 보려던 페이지로 돌아가요. 미리 로그인해 두고 싶으면 [학교 로그인]을 누르세요. 로그인은 학교 화면에서 직접 하고, PaperLab은 학교 계정을 저장하거나 사용하지 않아요. 학교 로그인이 끝나면 다시 로그인 화면이 떠요. |
| G-3 | 비활성 툴팁 · 보이는 안내 | 검색어를 입력하세요 |
| G-4 | KISS 토스트(8초) | 검색어를 복사했어요. KISS 검색창에 붙여 넣으세요. / 실패: 검색어를 복사하지 못했어요. KISS 검색창에 직접 입력해 주세요. |
| G-5 | 상세 한 줄 안내 | 학교 사이트에서 PDF를 받았다면 [PDF 첨부]로 올려 주세요. |
| G-6 | 설정 설명 · Scholar 툴팁 | Google Scholar: 설정 → 도서관 링크에서 ‘인하대학교’를 켜면 검색 결과에 학교 구독 원문 링크가 함께 나와요. (명세의 "표시됩니다"를 해요체로 · IU-4 확인 필요) |
| — | 설정 구역 제목 · 버튼 | 학교 연결 (인하대) / 처음 안내 다시 보기 |
| — | 읽기 화면 | PDF가 없어요 / 6장 표의 두 문구 |

---

## 11. 접근성 · 키보드

| 항목 | 정한 것 |
|---|---|
| 새 탭 알림 | 모든 새 탭 링크 · 버튼 안에 `<span class="sr-only">(새 탭에서 열림)</span>`(메뉴 항목은 보이는 "새 탭"). 아이콘은 `aria-hidden` |
| 묶음 이름 | 검색창 줄 `role="group"` + `aria-labelledby="school-bar-label"` → "학교 DB에서 찾기, 그룹". 설정 구역도 같은 방식 |
| 비활성 이유 | `disabled` 버튼은 Tab으로 닿지 않으므로 이유를 **보이는 글자**(`[data-school-hint]`)로도 둠 — 툴팁만으로는 키보드 · 화면 읽기 사용자에게 안 보임 |
| G-5 알림 | 미리 그려 둔 빈 `role="status"` 자리에 내용을 넣어 읽힘(5.1) |
| 메뉴 | `aria-haspopup="menu"` · `aria-expanded` 갱신, Enter/Space로 열면 첫 항목에 포커스(`focus: true`), Esc = 닫고 버튼으로(지금 `popupMenu` 동작) |
| 안내 창 | 열리면 [계속 열기]에 포커스, Enter = 계속 열기, Esc = 취소. `modal()`의 `role="dialog"` · `aria-modal` 그대로. (제안 — 범위 밖: `modal()`이 `<h3>`에 id를 주고 `aria-labelledby`를 걸면 모든 창의 제목이 읽힘. `ui.js`는 개발팀 파일) |
| 포커스 링 | 새 요소는 모두 기존 `.btn` · `<a>`라 브라우저 기본 `:focus-visible` 링 그대로(새 규칙 없음) |
| 검색창 Enter | 지금처럼 PaperLab 검색. 학교 DB 버튼은 Tab으로 가서 Enter/Space |

---

## 12. 확인 결과 · 남은 것

### 12.1 CSS 변경

- `app.css` 맨 끝에 44줄 추가(1066 → 1110줄 — 처음 46줄에서 `.school-login` 규칙을 지운 뒤). 기존 1066줄은 바이트 비교로 그대로임을 확인, 줄 끝 CRLF 유지.
- 새 클래스: `.sr-only` · `svg.ico.ext-ico` · `.ext-link` · `a.btn:hover`(밑줄 끔) · `.school-bar` · `.school-bar-label` · `.school-links` · `.school-sep` · `.school-hint` · `.inha-after`(상세 패널 안 간격) · `.empty-actions` · `.inha-guide` · `.inha-guide-list` · `.inha-guide-modal` · `.school-conn` · `.school-conn-notes`. 색은 모두 기존 변수.

### 12.2 확인한 것

- 정적 시험 페이지(`scratchpad/inha/index.html`, 저장소 밖 — 실제 `app.css` 복사본 사용)에서: 검색창 줄(켜짐 · 비활성) · 결과 카드 · 상세 패널 3가지(400px · 340px, 메뉴 열린 모습) · 읽기 화면 빈 화면 · 설정 구역 · 안내 창 · 토스트를 **밝은/어두운 테마**, **1280px · 390px**에서 봄.
- 390px: 모든 경우 가로 넘침 0(`scrollWidth === innerWidth`, 화면 밖으로 나간 요소 0). 이때 줄 끝에 남던 구분선을 발견해 560px 이하에서 숨기도록 고침.
- 검색어 지우기 → 네 버튼 비활성 · "검색어를 입력하세요" 보임, 글자 입력 → 켜짐(시험 페이지 스크립트로 흉내).

### 12.3 못 한 것 · 남은 것

- **개발팀 JS와 합친 실제 화면**(이 문서 시점에 화면 파일은 바뀌지 않음), 실제 새 탭 열기 · 팝업 차단 · 클립보드(3.3 순서) · 안내 창 포커스 이동은 개발팀 통합 뒤 품질팀 M-4 ~ M-12로 확인 필요.
- 실제 Tab 키로 본 포커스 링, 화면 읽기 프로그램(NVDA 등)으로 "(새 탭에서 열림)" · G-5 `role="status"` 읽힘, Firefox · Safari.
- openlink 로그인 화면 · 비구독 사이트 화면 모양(IU-6) — 안내 문구 ④는 확인 뒤 다듬을 수 있음. openlink가 로그인을 자동으로 요구하고 로그인 뒤 원래 주소로 돌아가는지는 배포 뒤 사용자 M-1에서 확인(안 되면 G-1 ① · G-2 문구와 학교 로그인 위치를 다시 맞춤).
- 기존 외부 링크(제목 · [PDF] · DOI)에도 아이콘 · `noreferrer`를 맞출지(1.1) — 별도 결정.
- 900px 이하에서는 서재 상세 패널이 원래 숨으므로 상세의 버튼들은 좁은 화면에서 보이지 않음(기존 구조 — 읽기 화면 빈 화면은 보임).

---

## 13. 팀장 결정 (2026-10-07 결정됨)

결정: **D-1은 명세 문구대로 "상세 패널을 다시 그릴 때까지"**(디자인팀 안 "같은 논문 동안 유지"는 채택 안 함), **D-2 · D-3은 디자인팀 안대로**(어떻게 닫히든 저장 · 가운데/수정키 클릭은 안내 창 생략), **D-4~D-6은 시안대로**. D-6은 사용자 결정으로 설정 창이 **유일한** 위치가 됨. 기록: 명세 15.3절.

| # | 질문 | 디자인팀 안 |
|---|---|---|
| D-1 | G-5 안내를 언제까지 보일지 | **같은 논문이 열려 있는 동안 유지**(상태 · 태그 바꿔 다시 그려도), 다른 논문 · PDF 붙음 때 지움. 명세 문구("다시 그릴 때까지")대로 해도 됨 |
| D-2 | 다시 보지 않기 저장 시점 | **창이 어떻게 닫히든 저장**(취소해도). 대안: [계속 열기] 때만 |
| D-3 | 가운데 클릭 · Ctrl+클릭으로 열 때 안내 창 | **안 띄움**(2장). 대안: `auxclick`도 막고 안내 창 |
| D-4 | 상세 패널 버튼 순서 | **[PDF 받기] [인하대에서 보기] [PDF 첨부]**(받는 흐름 순). 명세 문구는 "[PDF 받기][PDF 첨부] 옆에" |
| D-5 | Scholar 상세 위치(명세 8.2) | **정보 탭 "바로가기" 줄**(5.4) — 이 문서에서 결정, 이견 있으면 알려 주세요 |
| D-6 | "학교 로그인" 둘째 위치(명세 8.5) | **설정 창 "학교 연결 (인하대)" 구역**(7장) — 기획팀 추천과 같음 |
