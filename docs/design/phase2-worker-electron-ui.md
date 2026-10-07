# 화면 시안 — 2단계 작업 큐 · PC 워커 · 엔진 라우팅 · Electron 앱

- 작성: 디자인팀 · 2026-10-08
- 근거: [기능 명세](../specs/phase2-worker-electron.md) 6장(작업 큐 · 대기 기한 6.6) · 7장(작업 보기 · `waiting_reason`) · 9장(엔진 라우팅 · API 키 · 실패 판정) · 12장(기기 연결) · 13장(Electron — 13.2.1 외부 링크, 13.4 로그인, 13.5 트레이 · 자동 시작, 13.6 앱 자체 화면, 13.7 · 13.7.1 설치 · 업데이트 · `/downloads/`) · 16장(화면 목록 S1~S11 · E1~E9) · 17장 H(AC-90~94) · 20.1 사용자 결정 · 20.2 팀장 결정
- 사용자 결정 반영: **U1** 기본 엔진 모두 claude · **U2** API 키 세 회사 · **U3** 이름 PaperLab · 지금 아이콘 · **U4** 로그인 때 자동 시작 · X = 트레이 · **U5** 자동으로 받고 종료 때 설치 + [지금 다시 시작] · **U7** 대기 기한 요약 · 번역 24시간, 대화 · 글쓰기 30분 · **U9** 동시 실행 기본값(claude 2 · codex 1 · gemini 1 · 전체 2) · **Q-S3** 서버 PC 워커 없음 · **U10** 서버 PC `/downloads/` 공개 배포(K22 남용 방지 · K23 SHA-256 표시)
- 재사용한 시안: [1단계 시안](phase1-cloud-ui.md)(로그인 전 화면 `.gate` · 알림 상자 `.notice` · 설정 창 · 계정 메뉴) · [인용 그래프 시안](citation-graph-ui.md) 8.1절(진행 카드 `.graph-progress-card` · `.graph-steps`) · [인하대 시안](inha-proxy-ui.md)(바깥 링크 · 안내 목록 `.inha-guide-list`) · [참고 패널 시안](writing-reference-pane-ui.md)(문서 형식)
- **파일 이름**: 명세 16 · 21장은 `docs/design/phase2-worker-ui.md`라고 적었지만 팀장 지시대로 **이 파일**(`phase2-worker-electron-ui.md`)로 만들었습니다. 기획팀이 명세 이름을 고쳐 주세요.
- **이번 작업은 문서만** 만들었습니다. `app.css` · JS · `desktop/`은 고치지 않았습니다(1C 커밋 전 변경 검토 중). 추가할 CSS는 **부록 A**에 그대로 붙일 수 있게 적었고, 개발 단계에서 `app.css` 맨 끝에 넣습니다.
- 시험 페이지: 디자인팀 scratchpad `phase2ui/index.html`(저장소 밖 — **지금 작업 폴더 `app.css` 사본 + 부록 A CSS**, 가짜 데이터, `?s=화면&theme=dark`). 1280px · 390px, 밝은 · 어두운 테마로 확인(15장).

---

## 0. 개발팀용 클래스 · data 속성 목록 (먼저 확정)

> ★ = 기존 마크업을 바꾸는 곳. **새 클래스는 10개뿐**: `.item-list` · `.item-card` · `.item-head` · `.item-title` · `.item-meta` · `.item-actions`(목록 카드 — 연결된 PC · 작업 목록 · 앱의 엔진이 같이 씀) · `.pair-code` · `.job-card` · `.local-page` · `.local-head`(앱 자체 화면 전용). 나머지는 모두 기존 클래스와 **기존 클래스에 붙는 규칙 몇 줄**(부록 A).
> 새 색 · 새 CSS 변수 없음. 두 테마는 기존 변수로 따라갑니다.

### 0.1 설정 창 — "AI 엔진" 구역 (S1 · S2 · S3) — `dialogs.js` ★

| 이름 | 뜻 |
|---|---|
| `.section-title#set-ai-title` "AI 엔진" ★ | 지금 "AI (요약 · 논문과 대화)" 제목을 바꿈 |
| `#engine-seg` · `#engine-hint` · `#cli-soon` ★ | **삭제**(AC-90) |
| `.notice[data-tone="info"][data-ai-intro]` | API 우선 · CLI 폴백 설명(3.1절) |
| `.field` > `label#rt-{kind}` + `.row[role=group][aria-labelledby]` > `select.input.grow[data-route-kind="summary｜chat｜write"][data-route-i="0｜1｜2"][aria-label]` ×3 | 작업별 엔진 순서(3.2절). 값 `claude｜codex｜gemini｜""(없음 — 2 · 3순위만)` |
| `.hint[data-route-line="{kind}"]` (+ 쓸 수 없으면 `[data-tone="warn"]`) | 그 순서를 풀어 쓴 실행 경로 한 줄(3.3절) |
| `.field` > `label[for]` + `.row` > `input.input.grow[type=password][name="{anthropic｜openai｜google}_api_key"][aria-describedby]` + `button.icon-btn[data-key-reveal][aria-pressed][aria-label]` + `button.btn.sm.ghost[data-key-clear="{name}"]` | API 키 칸 ×3(3.4절). [지우기]는 저장된 키가 있거나 `unreadable`일 때만 |
| `.row.small[data-key-state="set｜none｜unreadable"]` > `span.chip(.success｜.warn)` + `span.grow` + `a.ext-link`(키 발급받기) | 저장 상태 줄 |
| `.notice[data-tone="warn"][data-key-fail]` | 최근 실패(키 오류로 폴백한 기록) — 있을 때만 |
| `.notice[data-tone="warn"][data-key-warn]` | (1단계 그대로) — `unreadable`은 이제 상태 칩이 맡으므로 **삭제** ★ |
| `details[data-model-details]` > `summary` + `.grid-2` > `.field` ×6 | 모델 · 생각 깊이(고급, 처음엔 접힘 — 3.5절) |
| `select.input[name="cli_model_claude"]` · `input.input[name="api_model_codex"]` · `input.input[name="api_model_gemini"]` | `cli_models.claude` · `api_models.codex` · `api_models.gemini`(이름은 개발팀 재량, 값 규칙 명세 9.4) |
| `.status-line(.ok｜.bad)#ai-status` | 지금 그대로(문구만 3.6절) |

### 0.2 설정 창 — "연결된 PC" 구역 (S4 · S5) — `dialogs.js`

| 이름 | 뜻 |
|---|---|
| `.section-title#set-pc-title` "연결된 PC" | "AI 엔진" 구역 **바로 다음**(인용 구역 앞) |
| `.notice[data-tone="warn"][data-pc-mismatch]` | 앱 창에서만 — 이 PC 워커가 다른 계정에 연결돼 있을 때(4.4절) |
| `ul.item-list[data-device-list][aria-labelledby=set-pc-title]` | PC 목록 |
| `li.item-card[data-device-id][data-state="online｜offline｜paused｜revoked"]` | PC 한 대(4.1절) |
| `.item-head` > `span.item-title` + `span.chip…`(상태) + `span.chip.accent`"이 PC" + `span.item-actions` > `button.btn.sm[data-device-rename]` · `button.btn.sm.danger[data-device-revoke]` | 머리줄 |
| `.chips[aria-label="엔진"]` > `span.chip(.success｜.warn)` | 엔진 칩 |
| `p.item-meta` | 실행 중 · 마지막 확인 · 앱 버전 · OS |
| `li.item-card[data-state="empty"]` | 빈 목록(4.2절) |
| `button.btn.sm.primary[data-pair-here]` | 앱 창: [이 PC 연결] |
| `button.btn.sm.primary[data-pair-code]` | 브라우저: [연결 코드 만들기] |
| `button.btn.sm[data-pc-app]` | [PC 앱 받기] |

### 0.3 PC 앱 받기 창 (S4) · 연결 코드 창 (S5) — `dialogs.js` (새 함수 `pcAppDialog()` · `pairCodeDialog()`)

| 이름 | 뜻 |
|---|---|
| `p.small.muted[data-release-meta]` | "Windows 10 · 11용 · 버전 0.2.0 · 98MB · 10월 8일 만듦" |
| `a.btn.primary[href="/downloads/…"][download][data-release-download]` | 설치 파일 받기(같은 출처 링크) |
| `ol.inha-guide-list[data-install-steps]` | 설치 순서 6줄(1A 안내 목록 클래스 재사용) |
| `details[data-release-hash]` > `.code-box[data-sha256]` · `.code-box`(명령) | SHA-256 · `Get-FileHash` 명령, 각각 [복사] |
| `code.pair-code[data-pair-code]` (+`[data-expired]`) | 연결 코드 크게 |
| `span[data-pair-left]` | 남은 시간 |
| `.status-line[role=status][data-pair-wait]` | "PC에서 코드를 넣기를 기다리는 중…" → 연결되면 `.ok` "✓ 연결됐어요: 집 PC" |

### 0.4 작업 진행 표시 (S6~S10) — `reader.js` · `writing.js` · 새 `jobs.js` · `index.html` ★

| 이름 | 붙이는 곳 | 뜻 |
|---|---|---|
| `div.graph-progress-card.job-card[data-summary-progress][data-job-id][data-job-state][data-waiting]` ★ | 읽기 화면 요약 탭(지금 `.ai-cta[data-summary-progress]` 자리) | 요약 작업 카드(6장). `data-summary-progress`는 지금 갱신 코드가 찾는 이름 그대로 |
| `.graph-progress-head` > `span.spinner` 또는 `svg.ico` + 제목 | 카드 머리 | 실행 중 = 스피너, 대기 = 시계 아이콘, 실패 = 경고 아이콘 |
| `.progress(.indeterminate)[role=progressbar][aria-label="요약 진행"]` | 카드 | 실행 중에만 |
| `ol.graph-steps[aria-label="실행 순서"]` > `li[data-state="done｜now｜failed"]` + `span.graph-step-msg` | 카드 | 경로(API → PC) — 경로가 2칸 이상이거나 시도 기록이 있을 때만 |
| `p.graph-progress-msg[role=status]` | 카드 | 설명 한 줄(상태가 바뀔 때만 바뀜) |
| `.notice[data-tone="info"][data-keep-open]` ★ | 카드(실행 중) | 문구를 "탭을 닫아도 계속돼요…"로 바꿈 |
| `.graph-progress-foot` > `span.small.muted[data-job-time]` + `button.btn.sm[data-job-cancel]` · `[data-job-retry]` · `[data-job-settings]` | 카드 바닥 | 기한 · 경과 시간 + 버튼 |
| `.msg.assistant[data-job-id][data-job-state]` > (`.notice[data-tone=warn][data-job-fallback]`) + `.prose`(중간 글) + `.status-line[role=status][data-job-line]` | 대화 기록 | 대화 작업(7장) |
| `.status-line[data-job-line]` > `svg.ico`｜`span.spinner` + `span.grow` + `button.btn.sm.ghost[data-job-cancel]` | 대화 · 글쓰기 · 작업 목록 | 한 줄 상태 |
| `.msg.error[data-job-state="failed"]` > `.row` > `span.grow` + `button.btn.sm[data-job-retry]` | 대화 기록 | 실패 |
| `button.nav-item[data-view="jobs"]` > `svg.ico` + "작업" + `span.count[data-count="jobs"][data-active][aria-label]` ★ | 사이드바 `.nav-main` 끝(논문 쓰기 다음) | 작업 목록 · 진행 중 개수(9장) |
| `ul.item-list[data-job-list]` > `li.item-card[data-job-id][data-job-state]` | 작업 목록 화면 `#/jobs` | 작업 한 건 |
| `details > summary` "시도한 순서 보기" + `ol.graph-steps` | 작업 카드 | 실패 사유(`history`) 펼치기 |

### 0.5 앱 창에서만 (S11 · E5) — `app.js` · `auth.js` · `index.html` ★

| 이름 | 뜻 |
|---|---|
| 계정 메뉴 항목 `{ label: "이 PC 상태", sub: "집 PC · 연결됨" }` ★ | `popupMenu` 기존 `.sub` 그대로 — 누르면 `paperlabDesktop.openStatusWindow()`(10장) |
| `#gate[data-gate="desktop-wait"]` + `.gate-pane[data-pane="desktop-wait"][role=status]` ★ | 브라우저 로그인 대기(11.3절). CSS 한 줄(부록 A) |
| `button.btn[data-desktop-reopen]` · `button.btn.ghost[data-desktop-cancel]` | [브라우저 다시 열기] · [취소] |

### 0.6 앱 자체 화면 (E2 · E4 · E6 · E9) — `desktop/ui/*`

| 이름 | 뜻 |
|---|---|
| `.gate-card` · `.gate-brand` · `.gate-pane` · `.gate-title` · `.gate-text` · `.gate-icon` · `.gate-actions` · `.gate-detail` | 1단계 로그인 전 화면 클래스 **그대로**(첫 실행 E2 · 서버 연결 불가 E9) |
| `main.local-page` > `h1.local-head` | "이 PC 상태" 창 틀(E4) |
| `.item-card[data-engine="claude｜codex｜gemini"][data-state="ready｜login｜missing｜off"]` | 엔진 카드(11.6절) |
| `button.btn.sm[data-pause][aria-pressed]` | 작업 받기 일시 중지 |
| `.status-line[role=status][data-update-line]` | 업데이트 상태 줄(11.7절) |
| `.notice[data-local-banner="revoked｜update_required｜offline｜no_engine｜no_safe_storage"]` | 창 맨 위 알림(11.8절) |
| `input.input[data-pair-input][autocomplete="one-time-code"]` | 코드로 연결(E6 — 11.6절 "연결") |

---

## 1. 공통 원칙

| 항목 | 정한 것 |
|---|---|
| 재사용 | `.modal` · `.section-title` · `.field` · `.hint` · `.row` · `.grid-2` · `.input` · `.btn` · `.icon-btn` · `.chip(s)` · `.notice[data-tone]` · `.status-line(.ok｜.bad)` · `.progress` · `.spinner` · `.graph-progress-card(-head · -msg · -foot)` · `.graph-steps` · `.graph-step-msg` · `.code-box` · `.inha-guide-list` · `.ext-link` · `.msg` · `.ai-cta` · `.nav-item .count` · `.menu .sub` · `.seg` · `.toolbar` · `.gate*` · `confirmDialog` · `promptDialog` · `toast` · `copyText` |
| 문구 톤 | 지금 화면과 같은 "~해요" 체. 버튼은 동사로 끝냄(받기 · 연결 · 해지 · 다시 시도) |
| 이름 표기 | **엔진** = Claude · Codex · Gemini(설정의 고르기 상자). **PC에서 실행하는 프로그램**은 소문자 `claude` · `codex` · `gemini`(사용자가 명령 프롬프트에 치는 이름과 같게). **회사 API** = Anthropic API · OpenAI API · Google API. "워커" · "리스" · "큐" 같은 말은 화면에 쓰지 않음 → "작업 받기" · "PC에서 실행" · "대기" |
| 경로 표기 | API 칸 = "{회사} API", CLI 칸 = "PC의 {프로그램}"(예: "Anthropic API → PC의 claude") |
| 시간 | 오늘 = "오후 3:10", 내일 = "내일 오후 2:30", 그 밖 = "10월 9일 오후 2:30". 1시간 안 기한은 뒤에 "(23분 남음)". 경과 = "40초" · "1분 20초" · "1시간 5분". 지난 시각 = "1분 전" · "3시간 전" · "10월 2일". 모두 사용자 PC 시간대 |
| 색만으로 구분하지 않기 | 상태 칩에 글자와 기호(● 켜짐 · ○ 꺼짐 · ❙❙ 일시 중지 · ✓ · !), 경로 단계 ✓ ● ✕ ○, 트레이 아이콘은 배지 **모양**이 다름(11.5절) |
| 움직임 | 새 애니메이션 없음(스피너 · 진행 막대는 기존) |
| 앱 창 감지 | `window.paperlabDesktop`이 있을 때만 앱 창 전용 문구 · 버튼(명세 13.3). 브라우저에서는 그대로 |

---

## 2. 설정 창 구성 (S1)

순서(위에서 아래): **AI 엔진**(바뀜) → **연결된 PC**(새로) → 인용 → 논문 양식 → 논문 검색 데이터베이스 → 학교 연결 → 계정. 한 창에서 스크롤(탭을 새로 만들지 않음 — 기존 구조).

```
┌ 설정 ────────────────────────────────────────── ✕ ┐
│ AI 엔진                                              │
│ ┃ⓘ API 키가 있으면 API로 먼저, 안 되면 연결된 PC의 CLI로…│
│ 요약 — 쓰는 순서                                      │
│ [Claude ▾] [없음 ▾] [없음 ▾]                          │
│ Anthropic API → 안 되면 PC의 claude (켜진 PC 1대)     │
│ 논문과 대화 — 쓰는 순서 …                              │
│ 글쓰기 도우미 — 쓰는 순서 …                            │
│ Anthropic API 키 (Claude)                            │
│ [저장됨 · …ab12 (바꾸려면 새 키 입력)   ] 👁 [지우기]   │
│ ✓ 저장됨 · 끝자리 ab12                    키 발급받기↗ │
│ ┃⚠ 최근 실패: 키가 올바르지 않아요 (10월 7일 오후 2:14)… │
│ OpenAI API 키 (Codex) …  Google API 키 (Gemini) …     │
│ 키는 계정별로 암호화해 저장해요. OpenAI · Google API에는…│
│ ▸ 모델 · 생각 깊이 (고급)                              │
│ AI 답변 언어 [한국어]                                  │
│ ✓ 요약은 Anthropic API로 먼저 실행해요.                │
│ 연결된 PC                                             │
│ ┌ 집 PC  ● 켜짐  이 PC          [이름 바꾸기][연결 해지]┐│
│ │ claude ✓ · 동시 2  codex ! 로그인 필요  gemini 없음   ││
│ │ 실행 중 1개 · 마지막 확인 1분 전 · 앱 0.2.0 · Windows 11││
│ └──────────────────────────────────────────────┘│
│ …                                                    │
│ [연결 코드 만들기] [⬇ PC 앱 받기]                       │
│ PC를 더 이상 쓰지 않으면 여기서 해지해 주세요…            │
│ 인용 …                                               │
└──────────────────────────────────────── [취소][저장] ┘
```

- 창을 열 때 지금 부르는 `/api/settings` · `/api/ai/status`에 더해 `GET /api/devices`를 함께 부릅니다(`/api/ai/engines`는 경로 줄 계산에 필요한 값이 `devices`와 설정에 다 있으면 부르지 않아도 됨 — 개발팀 재량).
- **저장**은 지금처럼 [저장] 한 번(엔진 순서 · 키 · 모델). **PC 이름 바꾸기 · 해지 · 연결 코드**는 누르는 즉시 서버에 반영(저장 버튼과 무관 — 버튼 이름이 동사라 기대와 맞음).
- 모달이 열릴 때 첫 입력칸에 초점이 가는 지금 동작(`modal()`)은 첫 `input`이 Anthropic 키 칸이 되므로, **설정 창은 초점을 `h3` 다음의 첫 고르기 상자**(`[data-route-kind="summary"][data-route-i="0"]`)로 옮겨 주세요(키 칸에 바로 초점이 가면 실수로 붙여 넣기 쉬움).

---

## 3. "AI 엔진" 구역 (S1 · S2 · S3)

### 3.1 안내 (S1)

`.notice[data-tone="info"][data-ai-intro]`:
> **API 키가 있으면 API로 먼저, 안 되면 연결된 PC의 CLI로 실행해요.** 키가 없는 엔진은 PC에서만 실행돼요. PC를 꺼도 AI를 쓰려면 API 키가 필요해요.

### 3.2 작업별 엔진 순서 (S2)

칩 끌어 놓기 대신 **고르기 상자 3개**(1 · 2 · 3순위)로 합니다(ponytail — 키보드 · 화면 읽기 · 터치에서 그대로 동작, 새 컴포넌트 없음). 명세 S2의 "칩 · 순서 바꾸기"와 다름 → 17장 PD-1.

| 칸 | 선택지 | 규칙 |
|---|---|---|
| 1순위 | Claude · Codex · Gemini | 늘 하나 |
| 2순위 | 없음 · (1순위에서 고르지 않은 엔진) | 1순위와 같은 값은 목록에 없음 |
| 3순위 | 없음 · (남은 엔진) | 2순위가 "없음"이면 `disabled` + "없음" |

- 앞 칸을 바꿔 뒤 칸과 겹치면 뒤 칸을 "없음"으로 비우고 그 뒤를 앞으로 당깁니다(중복 · 빈칸 없는 목록만 저장 — 명세 9.4 값 검사와 같음).
- 저장 값 = `ai_routing[kind] = [1순위, 2순위?, 3순위?]`. 기본은 셋 다 `["claude"]`(U1).
- 줄 이름: **요약 — 쓰는 순서** · **논문과 대화 — 쓰는 순서** · **글쓰기 도우미 — 쓰는 순서**. 각 상자 `aria-label` "요약 1순위 엔진" 식.
- 4단계(번역 · 쉬운 설명)는 같은 줄을 늘리면 됩니다.

### 3.3 실행 경로 줄 (S2 "칩 옆 상태")

각 줄 아래 `.hint[data-route-line]`에 명세 9.2절 규칙대로 펼친 경로를 씁니다(화면 계산 — **입력칸에 새로 넣은 키도 "있음"으로**, [지우기]한 키는 "없음"으로 봄).

| 경우 | 문구 |
|---|---|
| 키 있음 + 그 엔진을 가진 PC 있음 | `Anthropic API → 안 되면 PC의 claude (켜진 PC 1대)` |
| 2칸 이상 | `Anthropic API → PC의 claude → PC의 codex (켜진 PC 1대)`(화살표 = "안 되면") |
| 키 없음 · PC 있음 | `PC의 claude만 써요 (켜진 PC 없음 — 켜질 때까지 기다려요)` |
| 키 있음 · PC 없음 | `Anthropic API만 써요` |
| 경로가 빔(키도 PC도 없음) | `[data-tone=warn]` 주황: `이대로는 {작업}을 쓸 수 없어요 — {회사} API 키를 넣거나, {프로그램}이(가) 있는 PC를 연결해 주세요.` |

- "켜진 PC n대" = 그 엔진을 `logged_in: true`로 광고한 온라인 PC 수(로그인 필요 PC는 세지 않음). 0대면 "켜진 PC 없음".
- 조사: 프로그램 이름이 영문이라 "claude가" · "codex가" · "gemini가"로 고정(모두 모음 소리로 끝남).

### 3.4 API 키 세 칸 (S3)

| 칸 | 이름(`label`) | 자리 표시(없을 때) | 발급 링크 |
|---|---|---|---|
| `anthropic_api_key` | Anthropic API 키 (Claude) | `sk-ant-...` | console.anthropic.com/settings/keys |
| `openai_api_key` | OpenAI API 키 (Codex) | `sk-...` | platform.openai.com/api-keys |
| `google_api_key` | Google API 키 (Gemini) | `AIza...` | aistudio.google.com/apikey |

(발급 주소는 개발팀이 구현 때 각 회사 공식 문서로 한 번 더 확인 — 바뀌었으면 고쳐 주세요.)

**상태별 모양** (`[data-key-state]`)

| 상태(`*_status`) | 입력칸 자리 표시 | 상태 줄 | [지우기] |
|---|---|---|---|
| `set` | `저장됨 · …ab12 (바꾸려면 새 키 입력)` | `.chip.success` "✓ 저장됨 · 끝자리 ab12" | 보임 |
| `none` | 위 표의 예시 | `.chip` "없음" | 숨김 |
| `unreadable` | `다시 입력해 주세요` | `.chip.warn` "! 저장된 키를 읽지 못했어요" | 보임 |
| 새로 입력함(저장 전) | — | `.chip.accent` "저장하면 바뀌어요" | 그대로 |

- **가린 표시**: 입력칸은 `type=password`. [👁](`data-key-reveal`)는 **지금 입력한 글자만** 보였다 가립니다(`aria-pressed`, 이름 "{회사} API 키 보이기"/"가리기"). 저장된 키 원문은 서버가 보내지 않으므로 볼 수 없습니다 — 끝 4자리만(`*_hint`, 16장 개발팀 요청 1).
- **지우기**: 누르면 바로 `PUT /api/settings {name: null}` → 그 줄만 "없음"으로 다시 그리고 토스트 "{회사} API 키를 지웠어요". **창은 닫지 않습니다**(지금 1단계 코드는 `m.close()` — 다른 칸에 입력한 값이 사라지므로 바꿈 ★). 확인 창은 두지 않음(다시 넣으면 되는 값).
- **확인 결과**: 별도 [확인] 버튼은 두지 않고(17장 PD-2), 실제 실행 결과를 보여 줍니다.
  - 최근 실패(`api_auth` · `api_permission`)가 있으면 칸 아래 `.notice[data-tone=warn][data-key-fail]`: **"최근 실패: 키가 올바르지 않아요** (10월 7일 오후 2:14). 그 작업은 PC로 넘겼어요. 키를 확인해 주세요." / 권한이면 **"최근 실패: 이 키로 쓸 수 없는 모델이에요** (…). 모델 설정이나 키 권한을 확인해 주세요."
  - 키를 새로 저장하면 그 실패 표시는 지웁니다(서버가 지움 — 16장 요청 2).
  - 저장 뒤 `#ai-status` 줄이 그 키로 경로가 생겼는지 알려 줌(3.6절).
- 세 칸 아래 `.hint` 한 줄: "키는 계정별로 암호화해 저장해요. OpenAI · Google API에는 PDF 그림 · 쪽 인용 없이 **본문 글만** 보내요. 요금은 각 회사에서 키 주인에게 나가요."
- 세 칸은 **세로로 한 칸씩**(390px에서 두 칸 나란히는 넘침 — 확인함).

### 3.5 모델 · 생각 깊이 (고급 — 접힘)

`details[data-model-details]` "모델 · 생각 깊이 (고급)" — 처음엔 접혀 있음(대부분 기본값으로 충분).

| 칸 | 값 |
|---|---|
| Anthropic API 모델 | 지금 `model` 고르기 그대로 |
| 생각 깊이 (effort) | 지금 그대로 |
| OpenAI API 모델 | 글자 칸, 자리 표시 "기본값" (빈 값 = 서버 기본 — K19 결정값) |
| Google API 모델 | 같음 |
| PC의 claude 모델 | 계정 기본 모델(기본) · opus · sonnet · haiku (`cli_models.claude`) |
| PC의 codex · gemini 모델 | "계정 기본 모델" — `disabled`(2단계는 기본만, 명세 11.6) |

- 값이 기본이 아니면 `summary` 뒤에 `· 바꾼 값 있음`을 붙여 접혀 있어도 알 수 있게.

### 3.6 상태 줄 (`#ai-status`)

서버 `GET /api/ai/status`의 `message`를 그대로 쓰되 서버 문구 제안:

| 경우 | 문구 |
|---|---|
| 요약 첫 경로 API | ✓ 요약은 {회사} API로 먼저 실행해요. |
| 요약 첫 경로 CLI · 켜진 PC 있음 | ✓ 요약은 PC의 {프로그램}로 실행해요. |
| 요약 첫 경로 CLI · 켜진 PC 없음 | ✓ 요약은 PC의 {프로그램}로 실행해요. 지금은 켜진 PC가 없어 PC가 켜질 때까지 기다려요. |
| `ready: false` | ! AI를 쓸 수 있는 방법이 없어요. API 키를 넣거나, PC에 PaperLab 앱을 설치하고 연결해 주세요. |

---

## 4. "연결된 PC" 구역 (S4 · S5)

### 4.1 PC 한 대 (`li.item-card[data-state]`)

```
┌ 집 PC  ● 켜짐  이 PC                         [이름 바꾸기] [연결 해지] ┐
│ claude ✓ · 동시 2   codex ! 로그인 필요   gemini 없음                    │
│ 실행 중 1개 · 마지막 확인 1분 전 · 앱 0.2.0 · Windows 11                 │
└──────────────────────────────────────────────────────────┘
```

| `data-state` | 판정(명세 5.1) | 상태 칩 | `item-meta` 첫머리 |
|---|---|---|---|
| `online` | 해지 안 됨 · 3분 안 접속 · 일시 중지 아님 | `.chip.success` "● 켜짐" | 실행 중 n개(0이면 생략) |
| `paused` | 온라인 + `paused` | `.chip.warn` "❙❙ 일시 중지" | "이 PC에서 작업 받기를 멈춰 두었어요" |
| `offline` | 3분 넘게 접속 없음 | `.chip` "○ 꺼짐" | (없음) |
| `revoked` | `revoked: true` | `.chip` "해지됨 · 10월 2일" — 카드 점선 · 회색 바탕, 버튼 없음 | "이 PC는 작업을 받지 않아요. 30일 뒤 목록에서 사라져요." |

- 덧붙는 칩: 앱 창에서 `paperlabDesktop.info().deviceId`가 같으면 `.chip.accent` "이 PC". 앱 버전이 서버 `min_app_version`보다 낮으면 `.chip.warn` "업데이트 필요"(16장 요청 3).
- **엔진 칩**(`engines` 배열, 늘 claude · codex · gemini 순, 광고하지 않은 엔진은 "없음"):
  - `logged_in: true` → `.chip.success` "claude ✓ · 동시 2"(`slots`)
  - `logged_in: false` → `.chip.warn` "codex ! 로그인 필요"
  - 광고 안 함(설치 안 됨 · 앱에서 끔) → `.chip` "gemini 없음"
  - 칩 `title`: 버전("claude 2.1.269")
- **동시 실행 수**: 엔진별 `slots`를 칩에 표시. PC 전체 동시 수는 서버에 없으므로 표시하지 않음(17장 PD-3).
- `item-meta` 나머지: `마지막 확인 {상대 시각} · 앱 {버전} · {OS 짧게}`(OS는 "Windows 11"까지만 — `os` 문자열 앞 두 낱말).
- 정렬: 이 PC → 켜짐 → 일시 중지 → 꺼짐(최근 접속 순) → 해지됨.
- 목록은 설정 창이 열려 있는 동안 **15초마다** 다시 받습니다(켜짐/꺼짐이 바뀌는 것을 보게 — 창이 닫히면 멈춤).

**버튼**
- [이름 바꾸기] → `promptDialog("PC 이름", 지금 이름, {ok: "바꾸기"})` → `PATCH`. 1~60자, 빈 값이면 "이름을 입력해 주세요". 성공 토스트 "이름을 바꿨어요".
- [연결 해지] → `confirmDialog`:
  - 제목: "‘집 PC’ 연결을 해지할까요?"
  - 내용: "이 PC는 더 이상 작업을 받지 않아요. 실행 중인 작업은 다른 PC로 넘어가요."
  - 버튼: [해지](빨강 `.danger-fill`) · [취소]
  - 성공 토스트: "연결을 해지했어요" (+ `requeued_jobs > 0`이면 " · 실행 중이던 작업 n개를 다시 대기시켰어요")
- 버튼 `aria-label`에 PC 이름을 넣음("집 PC 연결 해지").

### 4.2 빈 목록 · 아래 버튼

빈 목록(해지된 것만 있어도 활성 0대면 같은 안내를 목록 위에):
```
┌ 연결된 PC가 없어요. PC를 연결하면 API 키 없이도 그 PC의 claude · codex · gemini 로그인으로 ┐
│ 요약 · 대화 · 글쓰기를 쓸 수 있어요.                                                  │
│ [이 PC 연결](앱 창) 또는 [연결 코드 만들기](브라우저)   [PC 앱 받기]                       │
└──────────────────────────────────────────────────────────────┘
```
목록이 있을 때 구역 끝: `[연결 코드 만들기]`(브라우저) 또는 `[이 PC 연결]`(앱 창 · 이 PC가 아직 이 계정에 연결 안 됐을 때) + `[⬇ PC 앱 받기]` + `.hint` "PC를 더 이상 쓰지 않으면 여기서 해지해 주세요. 앱을 지워도 연결은 남아 있어요."

구역 첫머리 `.hint`(늘): "PaperLab 앱을 설치하고 연결한 PC는 그 PC의 claude · codex · gemini 로그인으로 AI 작업을 실행해요. 여러 대가 켜져 있으면 먼저 가져간 PC가 실행해요."

### 4.3 이 PC 연결 (S5)

**앱 창**(`paperlabDesktop` 있음 — 명세 12.2 ①): [이 PC 연결] 한 번
1. 버튼 `disabled` + `aria-busy` + 스피너 + "연결하는 중…"
2. `POST /api/devices/pair-codes` → `paperlabDesktop.pair(code)`
3. 성공: 토스트(success) "연결됐어요: 집 PC", 목록 다시 받기, 초점은 새 카드의 [이름 바꾸기]
4. 실패: 버튼 원래대로 + 토스트(error) "연결하지 못했어요. {error}" (`error` 없으면 "잠시 후 다시 시도해 주세요.")

이미 **다른 계정**에 연결된 PC면(4.4절) 먼저 확인 창: "이 PC를 지금 계정으로 다시 연결할까요?" / "a***@example.com 계정의 작업은 더 이상 이 PC에서 실행되지 않아요. 그 계정의 연결된 PC 목록에서 이 PC를 해지해 주세요." / [다시 연결] · [취소].

**브라우저** — [연결 코드 만들기] → 창 "이 PC 연결"(`pairCodeDialog`):
```
┌ 이 PC 연결 ─────────────────────────── ✕ ┐
│ PaperLab 앱이 설치된 PC에서 이 코드를 넣어 주세요. │
│ ┌──────────────────────────┐            │
│ │        K7QF-2M9X          │ ← .pair-code│
│ └──────────────────────────┘            │
│ 9:41 남음 · 10분 동안 한 번만 쓸 수 있어요 [코드 복사]│
│ 넣는 곳: 화면 오른쪽 아래 트레이의 PaperLab 아이콘   │
│        → [코드로 연결…]                        │
│ ┃ⓘ 연결하려는 PC가 지금 이 PC라면, PaperLab 앱 창의 │
│ ┃  설정에서 [이 PC 연결]을 누르면 코드 없이 연결돼요.  │
│ ◌ PC에서 코드를 넣기를 기다리는 중…              │
│ [새 코드]                              [닫기]  │
└────────────────────────────────────────┘
```
- 남은 시간은 1초마다 바꾸되 **화면 읽기 알림은 하지 않음**(`aria-live` 없음). 0이 되면 코드에 `data-expired`(취소선 · 회색), 줄을 `.status-line.bad[role=status]` "코드 시간이 지났어요. 새 코드를 만들어 주세요." + [새 코드](primary)로 바꿈.
- 창이 열려 있는 동안 `GET /api/devices`를 **3초마다** 불러 이 코드를 만든 뒤 생긴 기기가 보이면 `.status-line.ok` "✓ 연결됐어요: {이름}" + 설정 창 목록 갱신 + 2초 뒤 창을 닫지 **않음**(사용자가 [닫기]). 16장 요청 4.
- [새 코드]: 새로 받으면 이전 코드는 서버가 끝냄(명세 5.2). 확인 창 없음.
- `.pair-code`에 `aria-label="연결 코드 K 7 Q F 2 M 9 X"`(한 글자씩 읽히게). 글자는 `user-select: all`(한 번 눌러 전체 선택).

### 4.4 계정이 다를 때 (명세 12.2)

앱 창에서 `paperlabDesktop.info().paired`가 참인데 `accountHint`가 지금 로그인 계정과 다르면 구역 맨 위 `.notice[data-tone=warn][data-pc-mismatch]`:
> 이 PC의 작업 실행은 **a***@example.com** 계정에 연결돼 있어요. 이 계정의 작업을 이 PC에서 실행하려면 [이 PC 연결]을 눌러 주세요.

(지금 계정의 이메일과 `accountHint`를 비교하는 방법은 개발팀 — 둘 다 같은 가림 규칙으로 만들어 비교)

### 4.5 PC 앱 받기 창 (S4 — `pcAppDialog`, `GET /api/desktop/release`)

```
┌ PaperLab PC 앱 받기 ───────────────────────── ✕ ┐
│ Windows 10 · 11용 · 버전 0.2.0 · 98MB · 10월 8일 만듦 │
│ [        ⬇ 설치 파일 받기        ]  (primary, 폭 100%) │
│ 설치 순서                                         │
│ 1. 받은 PaperLab-Setup-0.2.0.exe를 실행해요.          │
│ 2. “Windows의 PC 보호” 창이 뜨면 [추가 정보] → [실행]을  │
│    눌러요.                                          │
│ 3. 관리자 권한 없이 설치되고 PaperLab 창이 열려요.        │
│ 4. [Google로 계속하기] → 브라우저에서 로그인해요.         │
│ 5. 설정 → 연결된 PC → [이 PC 연결]을 눌러요.            │
│ 6. 쓰려는 AI 도구에 한 번 로그인해요. 명령 프롬프트에서    │
│    claude · codex · gemini를 실행하면 돼요.            │
│ ┃ⓘ “알 수 없는 게시자” 경고가 떠요. PaperLab은 코드 서명  │
│ ┃  인증서가 없어서 Windows가 처음 보는 프로그램으로 표시해요.│
│ ┃  이 화면에서 받은 파일이면 실행해도 돼요. 확실히 하려면    │
│ ┃  아래에서 파일 지문을 비교해 보세요.                    │
│ ▸ 받은 파일 확인하기 (SHA-256)          (처음엔 접힘)    │
│   [9f86d0…0a08                         ] [지문 복사]   │
│   PowerShell에서 아래 명령의 결과(Hash)가 위 값과 같으면 │
│   서버가 내보낸 파일 그대로예요.                        │
│   [Get-FileHash "$env:USERPROFILE\Downloads\…"] [명령 복사]│
│                                            [닫기]    │
└───────────────────────────────────────────────┘
```

| 경우 | 화면 |
|---|---|
| 정보 받는 중 | 본문 `.status-line` 스피너 "설치 파일 정보를 불러오는 중…" |
| 200 | 위 그림. 받기 링크 = 응답 `url`(같은 출처 `/downloads/…`, 서버 값만 — 화면이 주소를 만들지 않음), `download` 속성. 크기 `fmtBytes(size)`, 날짜 `built_at` |
| 404(아직 빌드 없음) | `.notice[data-tone=warn]` "**PC 앱을 준비 중이에요.** 관리자에게 알려 주세요." — 받기 · 순서 · 지문 없음 |
| 그 밖 오류 | `.status-line.bad` "설치 파일 정보를 불러오지 못했어요." + [다시 시도] |
| Windows가 아닌 기기(`navigator.userAgent`에 `Windows` 없음) | 맨 위 `.notice[data-tone=info]` "PC 앱은 Windows용이에요. Windows PC에서 이 화면을 열어 받아 주세요." (받기 버튼은 그대로 — 받아서 옮길 수도 있음) |
| 앱 창에서 엶 | 맨 위 `.notice[data-tone=info]` "지금 PaperLab 앱 {appVersion}을 쓰고 있어요. 업데이트는 자동으로 받아요. 다른 PC에 설치하려면 그 PC에서 이 화면을 열어 주세요." |

- [설치 파일 받기]를 누르면 토스트 "설치 파일을 받고 있어요. 받은 뒤 실행해 주세요."(8초) — 브라우저 다운로드 막대가 작게 뜨는 경우 대비.
- 429 · 503(남용 방지 — 명세 13.7.1)은 브라우저 다운로드 자체가 실패로 보이므로 화면이 알 수 없음. `.hint`(받기 버튼 아래, 늘): "받기가 안 되면 1분 뒤 다시 눌러 주세요."
- `Get-FileHash` 명령은 파일 이름에 버전을 넣어 만듭니다. 지문 칸 `.code-box`는 `word-break: break-all`(기존)이라 390px에서 두 줄.
- SmartScreen 실제 화면 그림은 넣지 않습니다(Windows 버전마다 다름, 이 창이 길어짐). 스크린샷은 E8 설치 안내 문서(`desktop/README.md`)에 — 11.10절.

---

## 5. 작업 상태 문구 (S8) — 한곳에서

`jobs.js`가 작업 보기(명세 7장)를 이 표로 바꿉니다. 같은 문구를 요약 카드 · 대화 · 글쓰기 · 작업 목록이 함께 씁니다.

### 5.1 상태 → 제목 · 한 줄

| `data-job-state` | 조건 | 아이콘 | 제목(요약 카드) | 한 줄(`data-job-line` · 카드 메시지) |
|---|---|---|---|---|
| `api-queued` | `queued` · `runner=api` | 스피너 | 논문을 정리하고 있어요 | {회사} API 차례를 기다리는 중 |
| `api-running` | `running` · `api` | 스피너 | 논문을 정리하고 있어요 | {회사} API로 정리하는 중 · {진행 문구} · 40% |
| `cli-waiting` · `data-waiting=""` | `queued` · `cli` · `waiting_reason=null` | 시계 | PC에서 실행 대기 중 | PC가 곧 작업을 가져가요 |
| `cli-waiting` · `no_online_worker` | | 시계 | PC에서 실행 대기 중 | PC에서 실행 대기 중 — 켜진 PC가 없어요 |
| `cli-waiting` · `no_engine_on_worker` | | 시계 | PC에서 실행 대기 중 | PC에서 실행 대기 중 — {프로그램}가 있는 PC가 없어요 |
| `cli-waiting` · `all_workers_busy` | | 시계 | PC에서 실행 대기 중 | PC에서 실행 대기 중 — PC가 다른 작업 중이에요 |
| `cli-running` | `running` · `cli` | 스피너 | 논문을 정리하고 있어요 | ‘{PC 이름}’에서 실행 중 ({프로그램}) · {경과} |
| `cli-running` + 재할당(`attempts ≥ 2`이고 직전 기록이 리스 만료) | | 스피너 | 논문을 정리하고 있어요 | PC 연결이 끊겨 다른 PC로 넘겼어요 · ‘{PC 이름}’에서 실행 중 |
| `cancelling` | `cancel_requested` | 스피너 | 취소하는 중… | 취소하는 중… |
| `succeeded` | | — | (결과를 그림) | 완료 · ‘{PC 이름}’({프로그램})에서 실행 / 완료 · {회사} API |
| `failed` | | 경고 | 요약을 만들지 못했어요 | 실패: {error} |
| `cancelled` | | — | (요약 탭은 처음 화면 + 토스트 "요약을 취소했어요") | 취소됨 |

- 대화에서는 "논문을 정리하고 있어요" 대신 "답을 만드는 중", 글쓰기에서는 "글을 만드는 중"(5.2절 표의 `{동작}`).
- `no_engine_on_worker`일 때는 버튼 [설정 열기](`data-job-settings` — `settingsDialog()`, 연결된 PC 구역으로 스크롤)를 함께.
- 진행 문구(`progress.message`)는 서버 · 워커가 보낸 짧은 글(예: "claude 실행 중")을 그대로, 없으면 생략.

### 5.2 기한 · 경과 (U7)

| 작업 | 대기 중 아래 줄 | 1시간 안 |
|---|---|---|
| 요약(24시간) | `내일 오후 2:30까지 기다려요` | (해당 없음 — 마지막 1시간이면) `오후 2:30까지 기다려요 (23분 남음)` |
| 대화 · 글쓰기(30분) | `오후 3:10까지 (23분 남음)` | 같음 |
| 실행 중 | `시작한 지 1분 20초` · 요약은 처음 3분 동안 `보통 1~3분 걸려요` | |

- 기한은 `created_at + 기한`(서버가 `deadline_at`을 작업 보기에 넣어 주면 그 값 — 16장 요청 5).

### 5.3 경로 단계 (`ol.graph-steps`)

`route`와 `history`로 만듭니다. 칸마다 `li`:

| 칸 상태 | `data-state` | 기호 | 오른쪽 작은 글(`graph-step-msg`) |
|---|---|---|---|
| 이미 실패하고 넘어감 | `failed` | ✕(주황) | 오류 이름(5.4절) |
| 지금 칸 | `now` | ● | 대기 사유 · "‘집 PC’에서 실행 중" |
| 아직 안 간 칸 | (없음) | ○ | 없음 |
| 성공한 칸 | `done` | ✓ | 없음 |

- 칸 이름: "Anthropic API" · "PC의 claude"(재할당 · 다른 PC 실패는 같은 칸 안에서 오른쪽 글로: "집 PC: 로그인 안 됨 → 다른 PC에서").
- 경로가 1칸이고 기록이 없으면 단계 목록을 그리지 않습니다(같은 말 두 번 방지).

### 5.4 오류 이름 (`history.error_code` → 짧은 글)

`jobs.js`의 표 하나(`ERROR_LABELS`). 최종 실패의 긴 문구는 서버 `error`를 그대로 씁니다.

| 코드 | 짧은 글 | 코드 | 짧은 글 |
|---|---|---|---|
| `api_auth` | 키가 올바르지 않음 | `cli_not_found` | {프로그램} 설치 안 됨 |
| `api_permission` | 이 키로 쓸 수 없는 모델 | `cli_not_logged_in` | {프로그램} 로그인 안 됨 |
| `api_rate_limit` | API 사용 한도에 걸림 | `cli_usage_limit` | CLI 사용 한도에 걸림 |
| `api_overloaded` · `api_server` | API 서버 오류 | `cli_model` | 고른 CLI 모델을 쓸 수 없음 |
| `api_connection` · `api_timeout` | API에 연결하지 못함 | `cli_timeout` | 시간 제한을 넘김 |
| `api_bad_request` | API가 요청을 받지 않음 | `cli_bad_output` · `bad_output` | 결과를 읽지 못함 |
| `api_refusal` | AI가 답하기를 거절함 | `cli_exit` | CLI가 오류로 끝남 |
| `api_max_tokens` | 결과가 너무 길어 끊김 | `lease_exhausted` | PC 연결이 계속 끊김 |
| `no_worker_timeout` | 기한 안에 켜진 PC 없음 | `input_too_large` | 논문 본문이 너무 김 |
| `apply_failed` | 결과를 저장하지 못함 | `output_too_large` | 결과가 너무 김 |
| (모르는 코드) | 실패 | | |

---

## 6. 요약 (S7 — 읽기 화면 요약 탭)

1단계 D11 진행 화면(`.ai-cta[data-summary-progress]` + "탭만 닫지 마세요")을 **진행 카드**로 바꿉니다.

```
┌ ◷ PC에서 실행 대기 중 ─────────────────┐   ┌ ◌ 논문을 정리하고 있어요 ────────────┐
│ ✕ Anthropic API   키가 올바르지 않음     │   │ ▬▬▬▬▬▬▭▭▭▭▭▭ (indeterminate)       │
│ ● PC의 claude     켜진 PC가 없어요      │   │ ‘집 PC’에서 실행 중 (claude) · 1분 20초│
│ PaperLab 앱이 켜진 PC가 생기면 바로      │   │ ┃ⓘ 탭을 닫아도 계속돼요. 다시 열면     │
│ 시작해요. 탭을 닫아도 기다려요.          │   │ ┃  이어서 보여 드려요.                │
│ 내일 오후 2:30까지 기다려요      [취소] │   │ 보통 1~3분 걸려요              [취소] │
└──────────────────────────────────┘   └───────────────────────────────┘
```

| 상태 | 카드 메시지(`graph-progress-msg`) | 바닥 왼쪽 | 버튼 |
|---|---|---|---|
| `api-queued` · `api-running` | {회사} API로 정리하는 중 · 40% | 보통 1~3분 걸려요 | [취소] |
| `cli-waiting`(`no_online_worker`) | PaperLab 앱이 켜진 PC가 생기면 바로 시작해요. 탭을 닫아도 기다려요. | 내일 오후 2:30까지 기다려요 | [취소] |
| `cli-waiting`(`no_engine_on_worker`) | {프로그램}가 설치 · 로그인된 PC가 연결돼 있지 않아요. 설정에서 PC를 연결하거나 엔진 순서를 바꿔 주세요. | 같음 | [설정 열기] [취소] |
| `cli-waiting`(`all_workers_busy`) | PC가 하던 작업을 끝내면 시작해요. | 같음 | [취소] |
| `cli-waiting`(null) | PC가 곧 작업을 가져가요. | 같음 | [취소] |
| `cli-running` | ‘{PC 이름}’에서 실행 중 ({프로그램}) · {경과} | 보통 1~3분 걸려요 | [취소] |
| `cancelling` | 취소하는 중… | — | [취소] `disabled` |
| `failed` | 서버 `error`(`role=alert`) | {시작 시각} 시작 | [다시 시도](primary) |

- 실행 중 카드에 `.notice[data-tone=info][data-keep-open]` "탭을 닫아도 계속돼요. 다시 열면 이어서 보여 드려요."(U8 — 1단계 "탭만 닫지 마세요" 삭제).
- [취소] → `POST /api/jobs/{id}/cancel`. 확인 창 없음(다시 만들 수 있음). `queued`면 곧바로 처음 화면 + 토스트 "요약을 취소했어요".
- [다시 시도] → `POST /api/jobs/{id}/retry` → 새 작업 카드.
- 성공하면 지금처럼 요약을 그림. 폴백 · 다른 PC로 실행됐으면 요약 맨 위에 작은 줄 하나(`.small.muted`): "PC의 claude로 만들었어요 (API 키가 올바르지 않아 넘김)" — 다음에 열면 없음.
- 다시 열기: 요약 탭을 열 때 `GET /api/papers/{pid}/summary`의 `job`이 진행 중이면 카드부터(AC-92).
- **폴링**: 명세 7.1 — 카드가 보이는 동안 1.5초(탭 숨김 10초). 같은 상태면 DOM은 진행 막대 · 경과 시간만 바꿈.
- 서재 목록 · 상세의 요약 버튼에도 진행 중이면 지금처럼 "요약 중"(1단계 그대로 — 대기 중이어도 "요약 중").

### 6.1 AI를 쓸 방법이 없을 때 (S10)

[요약 만들기] · 대화 [보내기] · 글쓰기 [AI 도우미] 메뉴에서 `ai/status.ready === false`면:
- 버튼은 **`disabled` 대신 `aria-disabled="true"`**(초점을 받아 이유를 읽을 수 있게, 누르면 아무 일도 없이 설명에 초점) + `aria-describedby`로 아래 글.
- 버튼 아래 `p.small`: "AI를 쓸 수 있는 방법이 없어요. 설정에서 API 키를 넣거나, PC에 PaperLab 앱을 설치하고 연결해 주세요." + `a`[설정 열기].
- 글쓰기 도우미(메뉴 버튼)는 지금처럼 누르면 토스트 + 설정 창(1단계 동작 그대로 — 메뉴 안에 설명 자리가 없음).

---

## 7. 논문과 대화 (S9)

```
                         [이 논문의 기여를 세 줄로 정리해 줘]
◷ PC에서 실행 대기 중 — 켜진 PC가 없어요 · 오후 3:10까지 (23분 남음)   [취소]
탭을 닫아도 답은 저장돼요. 다시 열면 보여요.

                                   [셀프 어텐션의 계산량은?]
┃⚠ API가 실패해서 PC로 넘겼어요 (키가 올바르지 않음).
셀프 어텐션은 시퀀스 길이 n에 대해 O(n²·d)…  ← 중간 글이 오면 점점
◌ ‘집 PC’에서 답을 만드는 중 (claude)                          [취소]
```

| 때 | 답 자리(`.msg.assistant[data-job-id]`) |
|---|---|
| SSE `queued` | `.status-line[data-job-line]` 5.1절 한 줄 + [취소](ghost) + 그 아래 `p.small.muted` "탭을 닫아도 답은 저장돼요. 다시 열면 보여요."(첫 대기 때만) |
| SSE `fallback` | 이미 나온 API 글을 지우고 위에 `.notice[data-tone=warn][data-job-fallback]` "API가 실패해서 PC로 넘겼어요 ({5.4절 짧은 글})." + 상태 줄 |
| `progress.partial_text` | 상태 줄 **위**에 `.prose`로 글을 그림(지금 스트리밍과 같은 렌더) — 상태 줄은 "‘{PC}’에서 답을 만드는 중 ({프로그램})" |
| 성공 | 상태 줄 · 폴백 상자 지우고 지금 답 모양(인용 목록 포함). 폴백했으면 답 아래 `.small.muted` "PC의 claude로 답했어요" |
| 실패 | `.msg.error` > `.row` "{error}" + [다시 시도] |
| 취소 | 답 자리 지우고 질문은 남김(토스트 없음) |

- 기다리는 동안 입력칸은 지금처럼 `disabled`, 자리 표시 "답을 기다리는 중이에요…". [취소]하면 다시 쓸 수 있음.
- 탭을 다시 열면 `GET /api/jobs?status=active&paper_id=…&kind=chat`로 진행 중 대화 작업을 찾아 같은 자리(마지막 질문 아래)에 이어서 그림. 질문 메시지는 작업이 끝나야 저장되므로(명세 6.4) 다시 열었을 때는 **작업의 `params.question`으로 질문 말풍선을 임시로** 그려 주세요.

---

## 8. 글쓰기 도우미 (S9)

지금 "AI 글쓰기 도우미" 창 그대로, `.ai-out` 위에 상태 줄:
```
┌ AI 글쓰기 도우미 ─────────────────────────── ✕ ┐
│ 학술 문체로 · 참고 논문 2편                         │
│ ◷ PC에서 실행 대기 중 — PC가 다른 작업 중이에요 · 오후 3:10까지│
│ 창을 닫으면 이 작업은 취소돼요.                       │
│ (중간 글이 오면 .ai-out에 점점)                       │
│ [고쳐서 넣기][복사]              [취소] [바꾸기(꺼짐)] │
└─────────────────────────────────────────────┘
```
- 폴백이면 상태 줄 위에 `.notice[data-tone=warn]` "API가 실패해서 PC로 넘겼어요 (…)." — 이미 나온 글은 지움.
- **창을 닫으면(✕ · Esc · 바깥 클릭 · [취소]) 작업을 취소**합니다(API 경로가 지금 창을 닫으면 멈추는 것과 같게). 그래서 `.small.muted` "창을 닫으면 이 작업은 취소돼요."를 대기 · 실행 중에 보여 줌. → 17장 PD-4.
- 탭을 닫아 끊긴 CLI 글쓰기 작업은 계속 돌아 결과가 24시간 남으므로, 작업 목록에서 [결과 복사](9장).
- 실패: `.ai-out`에 `.msg.error`(지금 그대로) + 바닥 [다시 시도].

---

## 9. 작업 목록 (S6)

### 9.1 사이드바

`.nav-main`의 [논문 쓰기] 다음에 `button.nav-item[data-view="jobs"]` "작업" + `span.count[data-count="jobs"]`:
- 진행 중(`queued`+`running`) 개수. 0이면 빈 칸. 1 이상이면 `data-active`(대표색 · 굵게), `aria-label="진행 중 2개"`.
- 개수는 화면이 이미 부르는 곳에서 갱신: 작업을 보고 있으면 그 폴링, 아니면 **30초마다** `GET /api/jobs?status=active&limit=1`(개수만 — 서버가 `total`을 주면 좋음, 16장 요청 6). 탭이 숨으면 멈춤.
- 아이콘(`ICON_JOBS`): `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2L7.5 11"/><circle cx="5.5" cy="18" r="1.5"/></svg>`
- 900px 이하(사이드바 숨김)에서는 계정 버튼(`.account-mini`) 메뉴에 "작업 (2)" 항목.

### 9.2 화면 `#/jobs`

```
작업   (진행 중 2 | 최근 7일)                     ← .toolbar h1 + .seg
┌ 요약  Attention Is All You Need                    [취소] ┐
│ ◷ PC에서 실행 대기 중 — codex가 있는 PC가 없어요 [설정 열기] │
│ API(Anthropic) 실패 → PC(claude) 실패 → PC(codex) 대기 ·    │
│ 3분 전 시작 · 내일 오후 2:30까지                           │
│ ▸ 시도한 순서 보기                                        │
└─────────────────────────────────────────────────┘
┌ 글쓰기  원고: 2장 관련 연구                        [다시 시도] ┐
│ 실패: PC 연결이 계속 끊겨서 멈췄어요.                        │
│ 어제 오후 4:02 · 3번 시도                                 │
└─────────────────────────────────────────────────┘
```

| 칸 | 내용 |
|---|---|
| 머리 | `.chip` 종류(요약 · 대화 · 글쓰기) + `.item-title` 논문 제목(글쓰기는 "원고: {원고 제목}" — 서버가 주지 않으면 "글쓰기 도우미") + `.item-actions` |
| 상태 줄 | `.status-line`(대기 · 실행 = 기본, 실패 = `.bad`, 완료 = `.ok`) — 5.1절 한 줄 |
| 메타 | 경로 요약 · 시작 시각 · 기한(대기 중) / 시도 횟수(실패) |
| 펼치기 | `details` "시도한 순서 보기" > 5.3절 단계 — `history`가 있을 때만(AC-94) |
| 버튼 | 대기 · 실행: [취소] / 실패 · 취소됨: [다시 시도](primary) / 완료 요약 · 대화: [열기](읽기 화면 요약 · 대화 탭) / 완료 글쓰기(24시간 안): [결과 복사] |

- 제목을 누르면 그 논문 읽기 화면(요약 · 대화 탭). `.item-title`은 `a`.
- 빈 목록: `.empty` "진행 중인 작업이 없어요" / "최근 7일 동안 한 작업이 없어요".
- 폴링: 진행 중 작업이 있으면 1.5초(명세 7.1 — 목록은 `GET /api/jobs?status=active` 한 번), 없으면 멈춤.

---

## 10. 앱 창 표시 (S11)

계정 메뉴(`openAccountMenu`)에 앱 창일 때만 맨 위 항목 하나:
- `{ label: "이 PC 상태", sub: "{deviceName} · 연결됨" }` — `paired`면
- `sub: "연결 안 됨"` — 연결 전
- `sub: "다른 계정에 연결됨"` — 4.4절
- `sub: "작업 받기 멈춤"` — `workerState === "paused"`, `"업데이트 필요"` — `update_required`, `"서버 연결 끊김"` — `offline`
- 누르면 `paperlabDesktop.openStatusWindow()`.
(기존 `.menu button .sub` 모양 그대로 — 새 클래스 없음)

---

## 11. Electron 앱 (E1~E9)

### 11.1 창 · 로컬 화면 공통

| 항목 | 정한 것 |
|---|---|
| 앱 창 | 제목 "PaperLab", 처음 1280×800(화면이 작으면 화면의 90%), **최소 400×560**(클라우드 화면이 390px까지 되므로). 크기 · 위치 기억 |
| 이 PC 상태 창 | 제목 "PaperLab — 이 PC 상태", 480×720, 최소 380×480, 크기 조절 가능, 앱 창과 별개(닫으면 숨김). Esc = 창 닫기 |
| 로컬 화면 CSS | `desktop/ui/local.css` = `app.css`의 **변수(`:root` · 어두운 테마) + 쓰는 클래스만** 옮긴 사본 + 부록 A의 `.local-*` · `.item-*` · `.gate*`. 클래스 이름이 같아 화면 모양이 같음. 사본이 어긋나지 않게 하는 방법은 17장 PD-5 |
| 테마 | 로컬 화면은 **Windows 설정**(`prefers-color-scheme`)을 따름 — 첫 줄 스크립트가 `document.documentElement.dataset.theme`을 붙임. 클라우드 화면은 지금처럼 화면 안 테마 버튼 |
| 글꼴 | 지금 `--font`(Pretendard 없으면 맑은 고딕) |
| 문구 | 이 문서의 문구를 `desktop/ui`에 그대로. 영어 문구 없음 |
| 네이티브 대화상자 | 종료 확인 · 다시 시작 확인 · 경로 고르기는 Electron `dialog`(Windows 기본 모양) — 문구만 이 문서 |

### 11.2 E2 첫 실행 (`app://setup.html`, 앱 창 안)

```
             [■] PaperLab
     PaperLab에 오신 걸 환영해요
 서재 화면과, 이 PC의 AI 도구(claude · codex · gemini)로
 작업을 실행하는 기능이 함께 들어 있어요.
  • 창을 닫아도 화면 오른쪽 아래 트레이에서 계속 실행돼요.
  • 이 PC를 연결하면 API 키 없이도 PC의 AI 도구로 요약 · 대화를 할 수 있어요.
     [✓] Windows에 로그인하면 자동으로 시작
  ✓ PaperLab 서버에 연결됐어요            ← 확인 중엔 스피너 "서버를 확인하는 중…"
  [                시작                ]
```
- 처음 한 번만(앱 설정에 `setupDone`). 다시 설치해도 앱 데이터가 남으면 안 뜸.
- 서버 확인(`/api/health` · `/api/public-config`) 중엔 [시작] `disabled`. 실패하면 E9로.
- [시작] → 체크 상태대로 자동 시작 설정 → 앱 창에 클라우드 화면을 엶 → 로그인 화면(1단계 D1).
- 서버 주소는 보이지 않음(U6 — 주소 입력 없음 · AC-84).
- 초점: 제목(`tabindex=-1`) → Tab 순서 체크 → [시작].

### 11.3 E5 브라우저 로그인 대기 (클라우드 화면 — `#gate[data-gate="desktop-wait"]`)

앱 창에서 [Google로 계속하기]를 누르면(명세 13.4 ①) 로그인 묶음 대신:
```
             [■] PaperLab
                 (□)               ← 브라우저 아이콘
     브라우저에서 로그인을 마쳐 주세요
 기본 브라우저에 Google 로그인 화면을 열었어요.
 로그인을 마치면 이 창으로 자동으로 돌아와요.
 ┃ⓘ 브라우저에 ‘PaperLab을 여시겠습니까?’ 같은 확인 창이 뜨면
 ┃  [열기]를 눌러 주세요.
 [          브라우저 다시 열기          ]
 [               취소                 ]  (ghost)
```

| 때 | 화면 |
|---|---|
| `startGoogleLogin` 성공 | 위 그림, 초점 = 제목 |
| `onAuthCallback(code)` 받음 | `boot` 묶음 "로그인하는 중…"(1단계 그대로) |
| [브라우저 다시 열기] | 새 인증 주소로 다시 `startGoogleLogin`(같은 화면 유지) |
| [취소] | `login` 묶음 + `[data-gate-note]` "로그인을 취소했어요." |
| 10분 동안 콜백 없음 | `login` 묶음 + `[data-gate-note]` "로그인 시간이 지났어요. 다시 시도해 주세요." |
| 코드 교환 실패 | `login` 묶음 + `[data-gate-error]` "로그인하지 못했어요. 잠시 후 다시 시도해 주세요." |
| `startGoogleLogin` `{ok:false}` | `login` 묶음 + `[data-gate-error]` "브라우저를 열지 못했어요. 다시 시도해 주세요." |

- 아이콘(`ICON_BROWSER`): `<path d="M3 9h18M6 6.8h.01M8.5 6.8h.01"/><rect x="3" y="4.5" width="18" height="15" rx="2"/>`(`.gate-icon` 기본 회색).
- 콜백을 받으면 main이 앱 창을 앞으로 가져옴(브라우저가 앞에 있으므로 — 개발팀).

### 11.4 E9 서버에 연결할 수 없음 (`app://offline.html`, 앱 창 안)

```
             [■] PaperLab
                 (!)               ← .gate-icon[data-tone=warn]
   PaperLab 서버에 연결할 수 없어요
 서버 PC가 꺼져 있거나 인터넷이 끊겼을 수 있어요. 관리자에게 알려 주세요.
 [연결 시간 초과 (ETIMEDOUT)]        ← .gate-detail(있을 때만)
 ◌ 24초 뒤에 다시 시도해요
 [              다시 시도              ]
 [            로그 폴더 열기            ]  (ghost)
  연결되면 이 PC의 작업 받기도 이어서 해요.
```
- 30초마다 자동 재시도(명세 13.6). 카운트다운 줄은 `role=status`이지만 **숫자는 10초 단위로만** 바꿈(화면 읽기가 매초 읽지 않게).
- [다시 시도] → `disabled` + "다시 연결하는 중…" → 되면 앱 창에 클라우드 화면.
- 인터넷 자체가 끊김(`navigator.onLine === false`) → 제목 "인터넷에 연결되지 않았어요", 설명 "연결을 확인하면 자동으로 다시 시도해요."
- 쓰는 도중 서버가 끊기면 클라우드 화면의 1단계 알림 띠(`#app-banner`)가 맡음 — E9는 **앱 창이 화면을 못 받을 때만**.
- `.gate-detail`에는 오류 이름만(주소 · 토큰 없음).

### 11.5 E3 트레이

**아이콘 4가지** (`desktop/build/tray-{idle｜running｜paused｜error}.ico`, 16 · 20 · 24 · 32px 한 파일 — 명세의 `.png`보다 Windows 배율에 맞음 → 17장 PD-6). 모양은 앱 아이콘(E1)을 바탕으로 **오른쪽 아래 배지 모양으로 구분**(색만으로 구분하지 않음):

| 상태 | 언제 | 바탕 | 배지 |
|---|---|---|---|
| `idle` 보통 | 연결됨 · 작업 없음 | 남색 `#1e3a8a` | 없음 |
| `running` 실행 중 | 작업 1개 이상 | 남색 | 초록 원 + 흰 ▶ (흰 테두리) |
| `paused` 일시 중지 | 작업 받기 멈춤 | **회색** `#6b7280` | 짙은 회색 원 + 흰 ❙❙ |
| `error` 연결 안 됨 · 오류 | 서버 연결 불가 · 해지됨 · 업데이트 필요 · 연결 전 · 쓸 수 있는 엔진 없음 | 남색 | 주황 ▲ + 흰 ! |

16px에서는 배지가 아이콘 폭의 50%(8px)여야 보입니다. 시험 페이지 그림은 32px 시안(15장) — 실제 파일은 디자인팀이 개발 단계에서 만듦.

**툴팁**(마우스를 올리면): `PaperLab — 대기 중` / `PaperLab — 작업 2개 실행 중` / `PaperLab — 작업 받기 일시 중지` / `PaperLab — 서버에 연결할 수 없어요` / `PaperLab — 이 PC가 연결되지 않았어요` / `PaperLab — 업데이트가 필요해요`

**메뉴**(오른쪽 클릭 — Electron `Menu`, 왼쪽 클릭 · 두 번 클릭 = 앱 창 열기):
```
집 PC · 작업 1개 실행 중              (회색 — enabled:false, 지금 상태 한 줄)
──────────
PaperLab 열기
이 PC 상태
코드로 연결…                         (연결 전 · 해지됨일 때만)
──────────
작업 받기 일시 중지                    (type: checkbox — 멈춰 있으면 ✓, 연결 전엔 꺼짐)
──────────
업데이트 확인                         (업데이트 준비되면 → "업데이트 설치하고 다시 시작 (0.2.1)")
로그 폴더 열기
──────────
종료
```
- 첫 줄 문구: `{PC 이름} · 대기 중` / `{PC 이름} · 작업 n개 실행 중` / `{PC 이름} · 작업 받기 멈춤` / `서버에 연결할 수 없어요` / `이 PC가 연결되지 않았어요` / `이 PC 연결이 해지됐어요` / `업데이트가 필요해요`.
- [업데이트 확인]을 누르면 결과를 알림 한 번: "최신 버전이에요 (0.2.0)" / "새 버전 0.2.1을 받는 중이에요" / "업데이트를 확인하지 못했어요 — 서버에 연결할 수 없어요".
- [종료] — 실행 중 작업이 있으면 네이티브 확인 창:
  - 제목 "PaperLab 종료" · 본문 "실행 중인 작업이 2개 있어요." · 자세히 "지금 끄면 작업은 다른 PC로 넘어가거나 다시 대기해요." · 버튼 [종료] [취소](기본 = 취소)

**알림(풍선)** — 앱 창이 숨어 있을 때만, "이 PC 상태"에서 끌 수 있음(첫 번째 · 업데이트 · 해지는 끌 수 없음). 누르면 "이 PC 상태" 창.

| 때 | 제목 | 내용 |
|---|---|---|
| 처음으로 X를 눌러 숨김(한 번만) | PaperLab은 트레이에서 계속 실행돼요 | 끄려면 트레이 아이콘을 오른쪽 클릭 → [종료]를 눌러 주세요. |
| 작업 성공 | PaperLab | 이 PC에서 {요약｜대화｜글쓰기} 작업을 끝냈어요. |
| 작업 실패(이 PC에서 끝남) | PaperLab | {요약…} 작업이 실패했어요: {짧은 글}. |
| 로그인 안 됨 · 설치 안 됨으로 넘김 | PaperLab | {프로그램}에 로그인되어 있지 않아 작업을 다른 PC로 넘겼어요. 눌러서 이 PC 상태를 확인해 주세요. |
| 업데이트 받음 | PaperLab | 새 버전 {버전}을 받았어요. 다음에 앱을 끌 때 설치돼요. |
| 해지됨 | PaperLab | 이 PC 연결이 해지됐어요. 다시 쓰려면 이 PC 상태에서 연결해 주세요. |

(논문 제목은 워커가 모르므로 넣지 않음 — 명세 8.4 응답에 제목 없음, 로그 · 알림에 본문을 남기지 않는 원칙과도 맞음)

### 11.6 E4 이 PC 상태 (+ E6 코드로 연결 · 워커 설정 · 자동 시작)

한 창 안에 네 구역(`.section-title`): **연결 · 실행 중인 작업 · 이 PC에서 쓸 AI 도구 · 앱**. 맨 위에 알림 상자(11.8절)가 필요할 때만.

```
[■] 이 PC 상태
┃ⓧ 이 앱 버전으로는 작업을 받을 수 없어요. …           ← 있을 때만
연결
┌ 집 PC  ● 작업 받는 중                 [작업 받기 일시 중지] ┐
│ 계정 j***@example.com · 실행 중 1개 · 이름은 웹 설정 → 연결된 PC에서 바꿔요 │
└──────────────────────────────────────────────┘
                                          이 PC에서 연결 끊기
실행 중인 작업
┌ 요약  claude · 1분 20초                          [취소] ┐
이 PC에서 쓸 AI 도구
한 번에 실행할 작업 수 (전체) [2 (기본) ▾]
사무용 PC는 2를 권해요. 바꾸면 바로 적용돼요.
┌ [✓] claude  ✓ 2.1.269 · 로그인됨              동시 [2 ▾] ┐
│ 경로: 자동으로 찾음 · C:\Users\…\npm\claude.cmd  [바꾸기…]     │
┌ [✓] codex   ! 로그인 필요                     동시 [1 ▾] ┐
│ 명령 프롬프트에서 codex를 한 번 실행해 로그인한 뒤 [다시 확인]을 … │
┌ [ ] gemini  설치되지 않음                                 ┐
│ 설치했는데 못 찾으면 경로를 직접 골라 주세요. [경로 고르기…]       │
마지막 확인 오후 2:31                              [다시 확인]
앱
✓ 버전 0.2.1 준비됨 · 다음에 앱을 끌 때 설치돼요   [지금 다시 시작]
[✓] Windows에 로그인하면 자동으로 시작 (트레이로)
[✓] 창이 숨어 있을 때 작업 완료 · 실패 알림 보이기
[로그 폴더 열기]                                  PaperLab 0.2.0
```

**연결 구역**

| 상태 | 카드 칩 | 버튼 |
|---|---|---|
| 연결됨 · 받는 중 | `.chip.success` "● 작업 받는 중" | [작업 받기 일시 중지](`aria-pressed=false`) |
| 일시 중지 | `.chip.warn` "❙❙ 일시 중지" | [작업 받기 다시 시작](`aria-pressed=true`) |
| 서버 연결 끊김 | `.chip.warn` "서버 연결 끊김" | (일시 중지 버튼 그대로) |
| 연결 전 · 해지됨 | 카드 대신 **코드 입력**(E6) | — |

- [이 PC에서 연결 끊기](ghost · 빨강) → 네이티브 확인 "이 PC에서 연결 정보를 지울까요?" / "웹 설정의 연결된 PC 목록에는 남아 있어요. 그곳에서도 해지해 주세요." / [연결 끊기] [취소].
- **E6 코드로 연결**(같은 창 — 따로 `pair.html`을 만들지 않음, 17장 PD-7):
  - `.field` "연결 코드" + `.row` > `input.input.grow[data-pair-input]`(고정폭 글꼴 · 대문자 · 4자리 뒤 대시 자동, `maxlength=9`, `autocomplete=one-time-code`) + [연결](primary)
  - `.hint`: "웹 설정 → 연결된 PC → [연결 코드 만들기]에서 받은 8자리 코드예요. 앱 창에서 [이 PC 연결]을 눌러도 돼요."
  - Enter = [연결]. 진행 중 버튼 "연결하는 중…". 실패 `.status-line.bad[role=alert]` "연결 코드가 맞지 않거나 시간이 지났어요." / 429 "잠시 뒤에 다시 시도해 주세요." / 네트워크 "서버에 연결할 수 없어요."
  - 성공: 연결 카드로 바뀌고 `.status-line.ok[role=status]` "✓ 연결됐어요: {이름}".
  - 트레이 [코드로 연결…]은 이 창을 열고 코드 칸에 초점.
  - 한 번에 붙여 넣은 `k7qf 2m9x` · `K7QF2M9X`도 받아들임(공백 · 대시 · 소문자 정리).

**실행 중인 작업**: `.item-card` 한 줄 — `.chip` 종류 + `.item-title` "{프로그램} · {경과}" + [취소](워커가 끄고 `cancelled` 보고 — 명세 13.6). 없으면 `p.small.muted` "실행 중인 작업이 없어요."

**이 PC에서 쓸 AI 도구 (워커 설정 — 앱 설정, 바꾸면 바로 적용 · 저장 버튼 없음)**

| 칸 | 정한 것 |
|---|---|
| 한 번에 실행할 작업 수(전체) | 1 · **2 (기본)** · 3 · 4 (U9) |
| 엔진 켜기 체크 `label.check` "claude" | 끄면 광고하지 않음(명세 11.7) — 웹 목록에 "없음". 설치 안 됨이면 `disabled` |
| 상태 칩 | `ready` ✓ {버전} · 로그인됨(success) / `login` ! 로그인 필요(warn) / `missing` 설치되지 않음(기본) / `off` 끔(기본) |
| 동시 | 1~4, 기본 claude 2 · codex 1 · gemini 1. 전체보다 크게 고르면 `.hint` "전체 수(2)가 먼저 적용돼요" |
| 경로(`item-meta`) | "경로: 자동으로 찾음 · {경로}" + [바꾸기…] / 직접 고름: "경로: 직접 고름 · {경로}" + [바꾸기…] [자동으로] / 못 찾음: "설치했는데 못 찾으면 경로를 직접 골라 주세요." + [경로 고르기…]. 고르기 창 필터 "실행 파일 (*.exe; *.cmd)" |
| 로그인 필요 안내 | "명령 프롬프트에서 `{프로그램}`를 한 번 실행해 로그인한 뒤 [다시 확인]을 눌러 주세요. 그동안 {프로그램} 작업은 다른 PC가 받아요." |
| 버전이 너무 낮음(엔진별 최소 버전 — 명세 20.3) | `.chip.warn` "! 업데이트 필요" + "{프로그램} {최소 버전} 이상이 필요해요. 명령 프롬프트에서 업데이트해 주세요." |
| [다시 확인] | 세 엔진을 다시 찾고 로그인 확인(명세 11.7) — 그동안 버튼 "확인하는 중…", 끝나면 "마지막 확인 {시각}" |

- 긴 경로는 `item-meta`에서 줄바꿈(`overflow-wrap:anywhere`) — 한글 사용자 폴더도 그대로 보임(AC-61).

**앱 구역 — 업데이트 상태 줄(E7)** `.status-line[data-update-line][role=status]`

| 상태 | 줄 | 버튼 |
|---|---|---|
| 최신 | `버전 0.2.0 · 최신이에요 (오후 2:00 확인)` | [업데이트 확인] |
| 확인 중 | 스피너 `업데이트를 확인하는 중…` | — |
| 받는 중 | `버전 0.2.0 · 0.2.1 받는 중 45%` + 아래 `.progress[role=progressbar]` | — |
| 준비됨 | `.ok` `버전 0.2.1 준비됨 · 다음에 앱을 끌 때 설치돼요` | [지금 다시 시작](primary) |
| 확인 실패 | `.bad` `업데이트 확인 실패 — 서버 연결 안 됨` (오류 창 없음, 명세 13.6) | [업데이트 확인] |
| 손상 | `.bad` `업데이트 파일이 손상됐어요 — 다음에 다시 받아요` | [업데이트 확인] |

- [지금 다시 시작] — 실행 중 작업이 있으면 네이티브 확인: "실행 중인 작업이 1개 있어요." / "작업이 끝나면 다시 시작할까요? 지금 다시 시작하면 작업은 다른 PC로 넘어가거나 다시 대기해요." / [끝나면 다시 시작] [지금 다시 시작] [취소]. "끝나면"을 고르면 줄이 `작업이 끝나면 다시 시작해요` + [취소].
- 체크 두 개: "Windows에 로그인하면 자동으로 시작 (트레이로)"(U4 — 기본 켬) · "창이 숨어 있을 때 작업 완료 · 실패 알림 보이기"(기본 켬).
- 맨 아래: [로그 폴더 열기] + 오른쪽 `PaperLab {버전}`.

### 11.7 E7 업데이트 알림 — 어디에 보이나

| 곳 | 보임 |
|---|---|
| 트레이 | 메뉴 항목이 "업데이트 설치하고 다시 시작 ({버전})"로 바뀜 + 알림 한 번(11.5절) |
| 이 PC 상태 | 앱 구역 줄(11.6절) |
| 앱 창(클라우드 화면) | **보이지 않음**(17장 PD-8 — `paperlabDesktop`에 업데이트 상태 · 다시 시작 함수가 없음. U5대로 종료 때 자동 설치) |
| 필수 업데이트(426) | 이 PC 상태 맨 위 빨강 상자(11.8절) + 트레이 오류 아이콘 + 계정 메뉴 `sub` "업데이트 필요" |

### 11.8 앱 오류 상자 (이 PC 상태 맨 위 `.notice[data-local-banner]`)

| `data-local-banner` | tone | 문구 | 버튼 |
|---|---|---|---|
| `revoked` | danger | **이 PC 연결이 해지됐어요.** 다시 쓰려면 새 연결 코드를 넣어 주세요. | (아래 코드 칸) |
| `update_required` | danger | **이 앱 버전으로는 작업을 받을 수 없어요.** 새 버전을 받는 중이에요. 준비되면 [지금 다시 시작]을 눌러 주세요. | (업데이트 줄) |
| `offline` | warn | **서버에 연결할 수 없어 작업을 받지 못하고 있어요.** 다시 연결되면 이어서 받아요. | — |
| `no_engine` | warn | **이 PC에서 쓸 수 있는 AI 도구가 없어요.** claude · codex · gemini 중 하나를 설치하고 로그인해 주세요. | [다시 확인] |
| `no_safe_storage` | warn | **이 PC에서는 연결 정보를 안전하게 저장할 수 없어요.** 앱을 다시 켜면 다시 연결해야 해요. | — (명세 12.3) |

- 여러 개면 위 순서대로 위쪽에 하나만(가장 급한 것). `role=alert`.
- **CLI 없음 · 로그인 안 됨**은 엔진 카드(11.6절)가 맡고, 모든 엔진이 안 될 때만 `no_engine` 상자.
- 웹 쪽에서는 같은 사실이 "연결된 PC" 엔진 칩(4.1절)과 작업 대기 사유(5.1절)로 보임.

### 11.9 E1 앱 아이콘

- `desktop/build/icon.ico` = 1단계 `deploy/paperlab.ico`와 같은 모양(U3) — 남색 둥근 네모 + 흰 문서 + 두 줄. 16 · 24 · 32 · 48 · 64 · 128 · 256px.
- 16 · 24px은 두 줄 대신 **한 줄**(작은 크기에서 뭉개짐 방지 — 1단계 파일에 이미 그렇게 돼 있으면 그대로).
- 개발 단계에서 디자인팀이 `deploy/paperlab.ico`를 복사 · 확인해 넣고, 트레이 4종을 만듭니다(명세 21장 디자인팀 분담).

### 11.10 E8 설치 안내 스크린샷 (기획팀 `desktop/README.md`용 — 개발 단계에서)

1) 설정 → 연결된 PC → [PC 앱 받기] 창, 2) SmartScreen "Windows의 PC 보호" → [추가 정보] → [실행](실제 Windows 11 화면), 3) `Get-FileHash` 결과 비교, 4) 첫 실행(E2), 5) 브라우저 로그인 대기(E5) + 브라우저의 "PaperLab 열기" 확인 창, 6) [이 PC 연결] 뒤 연결된 PC 목록, 7) 트레이 메뉴, 8) 이 PC 상태(로그인 필요 엔진 포함). 설치 파일이 생긴 뒤 다른 Windows 계정에서 찍습니다(AC-70).

---

## 12. 문구 모음 (한곳에서 찾기)

| 위치 | 문구 |
|---|---|
| 설정 구역 | AI 엔진 · 연결된 PC |
| AI 안내 | API 키가 있으면 API로 먼저, 안 되면 연결된 PC의 CLI로 실행해요. 키가 없는 엔진은 PC에서만 실행돼요. PC를 꺼도 AI를 쓰려면 API 키가 필요해요. |
| 엔진 순서 | 요약 — 쓰는 순서 · 논문과 대화 — 쓰는 순서 · 글쓰기 도우미 — 쓰는 순서 · 없음 · {작업} {n}순위 엔진(상자 이름) |
| 경로 줄 | 3.3절 표 |
| API 키 | Anthropic API 키 (Claude) · OpenAI API 키 (Codex) · Google API 키 (Gemini) · 저장됨 · …{끝 4자리} (바꾸려면 새 키 입력) · ✓ 저장됨 · 끝자리 {hint} · 없음 · ! 저장된 키를 읽지 못했어요 · 다시 입력해 주세요 · 저장하면 바뀌어요 · 지우기 · 키 발급받기 · {회사} API 키 보이기/가리기 · {회사} API 키를 지웠어요 · 최근 실패: 키가 올바르지 않아요 ({시각}). 그 작업은 PC로 넘겼어요. 키를 확인해 주세요. · 최근 실패: 이 키로 쓸 수 없는 모델이에요 ({시각}). 모델 설정이나 키 권한을 확인해 주세요. · 키는 계정별로 암호화해 저장해요. OpenAI · Google API에는 PDF 그림 · 쪽 인용 없이 본문 글만 보내요. 요금은 각 회사에서 키 주인에게 나가요. |
| 모델 | 모델 · 생각 깊이 (고급) · 바꾼 값 있음 · Anthropic API 모델 · 생각 깊이 (effort) · OpenAI API 모델 · Google API 모델 · 기본값 · PC의 claude 모델 · 계정 기본 모델 · PC의 codex · gemini 모델 |
| 상태 줄 | 3.6절 표 |
| 연결된 PC | PaperLab 앱을 설치하고 연결한 PC는 그 PC의 claude · codex · gemini 로그인으로 AI 작업을 실행해요. 여러 대가 켜져 있으면 먼저 가져간 PC가 실행해요. · ● 켜짐 · ○ 꺼짐 · ❙❙ 일시 중지 · 해지됨 · {날짜} · 이 PC · 업데이트 필요 · {프로그램} ✓ · 동시 {n} · {프로그램} ! 로그인 필요 · {프로그램} 없음 · 실행 중 {n}개 · 마지막 확인 {상대 시각} · 앱 {버전} · 이 PC에서 작업 받기를 멈춰 두었어요 · 이 PC는 작업을 받지 않아요. 30일 뒤 목록에서 사라져요. · 이름 바꾸기 · 연결 해지 · 연결 코드 만들기 · 이 PC 연결 · 연결하는 중… · PC 앱 받기 · PC를 더 이상 쓰지 않으면 여기서 해지해 주세요. 앱을 지워도 연결은 남아 있어요. |
| 빈 목록 | 연결된 PC가 없어요. PC를 연결하면 API 키 없이도 그 PC의 claude · codex · gemini 로그인으로 요약 · 대화 · 글쓰기를 쓸 수 있어요. |
| 해지 확인 | ‘{이름}’ 연결을 해지할까요? / 이 PC는 더 이상 작업을 받지 않아요. 실행 중인 작업은 다른 PC로 넘어가요. / 해지 · 취소 / 연결을 해지했어요 · 실행 중이던 작업 {n}개를 다시 대기시켰어요 |
| 이름 바꾸기 | PC 이름 · 바꾸기 · 이름을 입력해 주세요 · 이름을 바꿨어요 |
| 이 PC 연결(앱 창) | 연결됐어요: {이름} · 연결하지 못했어요. {error} · 이 PC를 지금 계정으로 다시 연결할까요? / {account} 계정의 작업은 더 이상 이 PC에서 실행되지 않아요. 그 계정의 연결된 PC 목록에서 이 PC를 해지해 주세요. / 다시 연결 |
| 계정 다름 | 이 PC의 작업 실행은 {account} 계정에 연결돼 있어요. 이 계정의 작업을 이 PC에서 실행하려면 [이 PC 연결]을 눌러 주세요. |
| 연결 코드 창 | 이 PC 연결 · PaperLab 앱이 설치된 PC에서 이 코드를 넣어 주세요. · {m:ss} 남음 · 10분 동안 한 번만 쓸 수 있어요 · 코드 복사 · 넣는 곳: 화면 오른쪽 아래 트레이의 PaperLab 아이콘 → [코드로 연결…] · 연결하려는 PC가 지금 이 PC라면, PaperLab 앱 창의 설정에서 [이 PC 연결]을 누르면 코드 없이 연결돼요. · PC에서 코드를 넣기를 기다리는 중… · ✓ 연결됐어요: {이름} · 코드 시간이 지났어요. 새 코드를 만들어 주세요. · 새 코드 · 닫기 |
| PC 앱 받기 | PaperLab PC 앱 받기 · Windows 10 · 11용 · 버전 {v} · {크기} · {날짜} 만듦 · 설치 파일 받기 · 받기가 안 되면 1분 뒤 다시 눌러 주세요. · 설치 순서(4.5절 1~6) · “알 수 없는 게시자” 경고가 떠요. … · 받은 파일 확인하기 (SHA-256) · 지문 복사 · PowerShell에서 아래 명령의 결과(Hash)가 위 값과 같으면 서버가 내보낸 파일 그대로예요. · 명령 복사 · 설치 파일을 받고 있어요. 받은 뒤 실행해 주세요. · PC 앱을 준비 중이에요. 관리자에게 알려 주세요. · 설치 파일 정보를 불러오는 중… · 설치 파일 정보를 불러오지 못했어요. · PC 앱은 Windows용이에요. Windows PC에서 이 화면을 열어 받아 주세요. · 지금 PaperLab 앱 {v}을 쓰고 있어요. 업데이트는 자동으로 받아요. 다른 PC에 설치하려면 그 PC에서 이 화면을 열어 주세요. |
| 작업 상태 | 5.1절 표 · 5.2 기한 · 5.4 오류 이름 |
| 요약 카드 | 6장 표 · 탭을 닫아도 계속돼요. 다시 열면 이어서 보여 드려요. · 보통 1~3분 걸려요 · 시작한 지 {경과} · 취소 · 다시 시도 · 설정 열기 · 요약을 취소했어요 · PC의 {프로그램}로 만들었어요 ({짧은 글}로 넘김) |
| 쓸 방법 없음 | AI를 쓸 수 있는 방법이 없어요. 설정에서 API 키를 넣거나, PC에 PaperLab 앱을 설치하고 연결해 주세요. · 설정 열기 |
| 대화 | 탭을 닫아도 답은 저장돼요. 다시 열면 보여요. · API가 실패해서 PC로 넘겼어요 ({짧은 글}). · ‘{PC}’에서 답을 만드는 중 ({프로그램}) · 답을 기다리는 중이에요… · PC의 {프로그램}로 답했어요 |
| 글쓰기 | 창을 닫으면 이 작업은 취소돼요. · ‘{PC}’에서 글을 만드는 중 ({프로그램}) |
| 작업 목록 | 작업 · 진행 중 {n} · 최근 7일 · 요약 · 대화 · 글쓰기 · 원고: {제목} · 글쓰기 도우미 · 시도한 순서 보기 · {n}번 시도 · 열기 · 결과 복사 · 결과 글은 24시간 동안 복사할 수 있어요 · 결과를 복사했어요 · 진행 중인 작업이 없어요 · 최근 7일 동안 한 작업이 없어요 · 진행 중 {n}개(배지 이름) |
| 계정 메뉴 | 이 PC 상태 · {이름} · 연결됨 · 연결 안 됨 · 다른 계정에 연결됨 · 작업 받기 멈춤 · 업데이트 필요 · 서버 연결 끊김 · 작업 ({n}) |
| E2 | PaperLab에 오신 걸 환영해요 · 서재 화면과, 이 PC의 AI 도구(claude · codex · gemini)로 작업을 실행하는 기능이 함께 들어 있어요. · 창을 닫아도 화면 오른쪽 아래 트레이에서 계속 실행돼요. · 이 PC를 연결하면 API 키 없이도 PC의 AI 도구로 요약 · 대화를 할 수 있어요. · Windows에 로그인하면 자동으로 시작 · 서버를 확인하는 중… · ✓ PaperLab 서버에 연결됐어요 · 시작 |
| E5 | 브라우저에서 로그인을 마쳐 주세요 · 기본 브라우저에 Google 로그인 화면을 열었어요. 로그인을 마치면 이 창으로 자동으로 돌아와요. · 브라우저에 ‘PaperLab을 여시겠습니까?’ 같은 확인 창이 뜨면 [열기]를 눌러 주세요. · 브라우저 다시 열기 · 취소 · 로그인을 취소했어요. · 로그인 시간이 지났어요. 다시 시도해 주세요. · 브라우저를 열지 못했어요. 다시 시도해 주세요. |
| E9 | PaperLab 서버에 연결할 수 없어요 · 서버 PC가 꺼져 있거나 인터넷이 끊겼을 수 있어요. 관리자에게 알려 주세요. · {n}초 뒤에 다시 시도해요 · 다시 시도 · 다시 연결하는 중… · 로그 폴더 열기 · 연결되면 이 PC의 작업 받기도 이어서 해요. · 인터넷에 연결되지 않았어요 · 연결을 확인하면 자동으로 다시 시도해요. |
| 트레이 | 11.5절(툴팁 · 메뉴 · 첫 줄 · 업데이트 확인 결과 · 종료 확인 · 알림) |
| 이 PC 상태 | 11.6 · 11.8절 |

---

## 13. 접근성 · 키보드

| 항목 | 정한 것 |
|---|---|
| 설정 창 | Tab 순서 = 화면 순서. 엔진 상자 3개는 `role=group` + `aria-labelledby`(줄 이름) + 상자마다 `aria-label`. 경로 줄은 첫 상자의 `aria-describedby`. 키 칸 `aria-describedby` = 상태 줄 id. 키 보이기 `aria-pressed` |
| PC 목록 | `ul`/`li`, 버튼 이름에 PC 이름. 목록이 15초마다 바뀌어도 **초점이 있는 카드는 다시 그리지 않고 글자만 바꿈**(초점이 사라지지 않게) |
| 진행 카드 | `role=status`는 `.graph-progress-msg` 하나 — **상태가 바뀔 때만** 글을 바꿈(1.5초 폴링마다 같은 글을 다시 넣지 않음). 경과 시간 · 막대는 `role=status` 밖. 실패 메시지는 `role=alert` |
| 대화 · 글쓰기 상태 줄 | `role=status`, 같은 규칙. 폴백 상자는 처음 한 번 읽힘(`role=status` 안에 넣지 않고 상태 줄 글에 "API가 실패해서 PC로 넘겼어요"를 먼저 한 번) |
| 연결 코드 | 글자 하나씩 읽히는 `aria-label`, 남은 시간은 알림 없음, 만료는 `role=status` 한 번 |
| 작업 목록 | `details/summary`(네이티브 — Enter · Space로 펼침). 배지 `aria-label="진행 중 2개"` |
| `aria-disabled` 버튼(S10) | 초점 받음 · 누르면 설명으로 초점 · 화면 읽기는 "흐리게 표시됨" + 설명 |
| 색만으로 구분하지 않기 | 1장 표 |
| 대비 | 모두 기존 글자 · 배경 변수(두 테마 AA). `.chip` 기본(꺼짐 · 없음)은 `--text-2` on `--surface-2` |
| 포커스 링 | 기존 규칙(`:focus-visible`) 그대로 |
| 로컬 화면 | `lang="ko"`, 각 창 첫 초점 = 제목(`tabindex=-1`) 또는 첫 조작. E6 코드 칸 Enter = 연결. 이 PC 상태 창 Esc = 닫기(숨김) |
| 트레이 | 네이티브 메뉴(Windows 화면 읽기 지원). 키보드: Win+B → 화살표로 PaperLab 아이콘 → Shift+F10(메뉴) · Enter(열기). 일시 중지는 `checkbox` 메뉴 항목(상태가 읽힘) |
| 네이티브 확인 창 | 기본 버튼 = 안전한 쪽(취소) |

---

## 14. 좁은 화면 (390px)

| 화면 | 정한 것(확인함 — 15장) |
|---|---|
| 설정 창 | 모달 내용 폭 약 310px. 엔진 상자 3개 한 줄(각 약 95px). 키 칸은 세로 한 칸씩(두 칸 나란히는 넘침 → 바꿈). 키 칸 줄: 입력칸 + 👁 + [지우기] 한 줄. 모델(고급)의 `.grid-2`는 두 칸 그대로(지금 설정 창과 같음) |
| PC 카드 | 머리줄 버튼이 다음 줄 오른쪽으로 내려감(`flex-wrap`), 칩 줄바꿈, 메타 줄바꿈. 가로 넘침 없음 |
| PC 앱 받기 | 받기 버튼 폭 100%, 지문 · 명령 `.code-box` 두 줄, 순서 목록 줄바꿈 |
| 연결 코드 | 코드 30px 고정폭 한 줄(약 220px) |
| 요약 카드 | `min(420px, 100%)` — 패널 폭에 맞춤. 읽기 화면은 900px 이하에서 패널이 원래 숨으므로(1단계) 실제로는 넓은 화면에서만 |
| 대화 | 상태 줄 글이 두 줄로, [취소]는 오른쪽 |
| 작업 목록 | 머리줄의 제목이 길면 버튼이 다음 줄. 상태 줄 · 메타 줄바꿈 |
| 앱 창 · 로컬 화면 | 앱 창 최소 400px. "이 PC 상태" 창 380px에서 엔진 카드 머리(체크 · 칩 · 동시) 한두 줄, 경로 줄바꿈 |

---

## 15. 확인 결과 · 못 한 것

### 15.1 확인한 것 (정적 시험 페이지)

- 시험 페이지: scratchpad `phase2ui/index.html` + `phase2.css`(= 부록 A) + `app.css`(작업 폴더 사본 — 1C 커밋 전 변경 포함). 화면 전환 `?s=settings｜settings-app｜pcapp｜pair｜summary｜chat｜write｜jobs｜gates｜status｜tray&theme=dark`. 390px은 폭 390 iframe(`wrap.html` — 브라우저 창 최소 폭 때문), 1280px은 headless Chrome 창 크기.
- 스크린샷 `phase2ui/shots/`(26장): 설정(1280 · 390 × 밝은 · 어두운), 그 밖 10개 화면 1280 밝은 · 390 어두운.
- 확인하며 고친 것: API 키 두 칸 나란히(`.grid-2`)가 390px에서 넘침 → 세 칸 모두 세로로. 설치 순서를 `.graph-steps`로 그리면 `li`가 `flex`라 굵은 글 · 코드가 따로 떨어짐 → 1A `.inha-guide-list` 재사용.
- 가로 넘침: 390px 모든 화면에서 눈으로 확인(가로 스크롤 없음). 어두운 테마에서 주황 경로 줄 · 경고 칩 · 실패 기호 ✕ 읽힘.
- 트레이 아이콘 4종은 **32px 시안 그림**만(실제 16px `.ico`는 개발 단계).

### 15.2 못 한 것

- 실제 앱(로그인 · 실제 API · 폴링) 위에서 본 것 아님 — JS가 없음. 특히 ① 1.5초 폴링 때 `role=status` 중복 읽힘 ② PC 목록 15초 갱신 중 초점 유지 ③ 연결 코드 창 3초 폴링 → 연결 감지 ④ 대화 탭을 다시 열었을 때 질문 임시 말풍선.
- Electron 실제 창 · 네이티브 메뉴 · 풍선 알림 · 16px 트레이 아이콘 가독성 · Windows 고대비 · 배율 125/150% — 못 함(트레이 메뉴 · 알림은 HTML 흉내 그림).
- 브라우저의 `paperlab://` "열기" 확인 창 실제 문구(Chrome · Edge 버전마다 다름) — E5 안내 문구는 "같은 확인 창"으로 두루뭉술하게 씀.
- SmartScreen 실제 화면 · 문구(“Windows의 PC 보호” · [추가 정보] · [실행])는 명세 문구를 따름 — Windows 11 실제 화면에서 품질팀 확인(AC-70).
- 화면 읽기 프로그램(NVDA), Firefox · Safari.

---

## 16. 개발팀 전달 사항 (훅 · 서버 값 요청)

| # | 요청 | 왜 |
|---|---|---|
| 1 | `GET /api/settings`에 `{anthropic｜openai｜google}_api_key_hint`(끝 4자리, `set`일 때만) | 3.4절 "…ab12 저장됨"(명세 S3). `user_secrets.hint`는 이미 있음 |
| 2 | 키별 **최근 실패** `{name}_last_error: {code, at}`(`api_auth` · `api_permission`만, 그 키를 새로 저장하면 비움) — `GET /api/settings` 또는 `GET /api/ai/engines` | 3.4절 · AC-93. 명세 S3에 자리만 있고 값이 정의되지 않음 |
| 3 | `GET /api/devices` 항목에 `update_required: bool`(앱 버전 < `min_app_version`) | 4.1절 "업데이트 필요" 칩 — 화면이 서버 상수를 모름 |
| 4 | 연결 코드 창: `GET /api/devices`를 3초마다 부르고 `created_at > 코드 발급 시각`인 기기가 보이면 성공 처리 | 4.3절(새 API 없이) |
| 5 | 작업 보기에 `deadline_at`(대기 중일 때) | 5.2절 — 화면이 기한 상수를 따로 갖지 않게 |
| 6 | `GET /api/jobs` 응답에 `total`(조건에 맞는 개수) | 사이드바 배지를 `limit=1`로 가볍게 |
| 7 | 작업 보기에 `paper_title` 외에 글쓰기면 `manuscript_title`(있으면) | 작업 목록 제목 "원고: …" |
| 8 | `paperlabDesktop.info()`의 `accountHint`와 비교할 지금 계정 가림 값 — 같은 가림 함수를 화면에도 | 4.4절 계정 다름 판정 |
| 9 | 설정 창 첫 초점을 엔진 첫 상자로 | 2장 |
| 10 | 키 [지우기] 뒤 창을 닫지 않기(지금 `m.close()` 삭제) | 3.4절 |
| 11 | `data-job-state` · `data-waiting` · `data-device-id` · `data-state` · `data-engine` · `data-update-line` · `data-local-banner`는 품질팀 확인용 — CSS가 `data-state="revoked"` · `data-job-state="failed"`만 씀 | 0장 |
| 12 | 앱 쪽: 트레이 메뉴 첫 줄 · 툴팁 · 알림 문구(11.5절), 네이티브 확인 창 문구(11.5 · 11.6절), 창 크기(11.1절), 콜백 받으면 앱 창 앞으로(11.3절) | |
| 13 | `desktop/ui/local.css`를 만들 때 `app.css`의 변수 · `.gate*` · `.btn` · `.input` · `.field` · `.row` · `.chip` · `.notice` · `.status-line` · `.progress` · `.spinner` · `.section-title` · `.check` · `.item-*` · `.local-*`만 | 11.1절, PD-5 |

**CSS**: 부록 A를 `app.css` 맨 끝에(1C 커밋 뒤, 개발 단계). `desktop/ui`는 PD-5 결정대로.

---

## 17. 팀장 결정 항목 (디자인팀 추천 포함)

| # | 질문 | 디자인팀 추천 | 다른 안 |
|---|---|---|---|
| **PD-1** | 작업별 엔진 순서 고르기 모양 (명세 S2는 "칩 · 순서 바꾸기 · 추가 · 빼기") | **고르기 상자 3개(1 · 2 · 3순위) + 아래 경로 줄**. 새 컴포넌트 없이 키보드 · 터치 · 화면 읽기에서 그대로, 390px에서도 한 줄. 상태(키 · 켜진 PC)는 경로 줄이 말해 줌 | 칩 + ↑↓ · ✕ · [＋ 엔진] 버튼(명세 그대로 — 새 컴포넌트, 초점 관리 필요) |
| **PD-2** | API 키 "확인 결과" | **[확인] 버튼 없이** 저장 상태(끝 4자리) + 실제 작업에서 생긴 **최근 실패** 표시(16장 요청 2) + 저장 뒤 상태 줄. 새 API · 각 회사 호출 비용 없음 | 키 칸마다 [확인] → 새 API `POST /api/ai/keys/{name}/check`(각 회사 모델 목록 호출 — 개발 · 시험 늘어남) |
| **PD-3** | PC 전체 동시 실행 수를 웹 목록에 보일지 | **엔진별 `slots`만**(지금 `devices.engines`에 있음). 전체 수는 앱의 이 PC 상태에서만 | `hello`에 `slots_total`을 더해 웹에도(서버 · 표 변경) |
| **PD-4** | 글쓰기 도우미 창을 닫을 때 CLI 작업 | **취소**(지금 API 경로와 같음, 창에 "창을 닫으면 이 작업은 취소돼요" 표시). 탭을 닫아 남은 결과만 작업 목록 [결과 복사] | 닫아도 계속 → 결과를 작업 목록에서 받기(30분까지 기다리는 동안 원고를 쓸 수 있지만, 넣을 자리를 다시 골라야 함) |
| **PD-5** | 앱 로컬 화면 CSS를 `app.css`와 어떻게 맞출지 | **빌드 때 `paperlab/static/css/app.css`를 `desktop/ui/`로 복사**(electron-builder `extraResources` 또는 `npm` 스크립트 한 줄)해 그대로 쓰고, `local.css`에는 로컬 전용 몇 줄만 — 사본이 어긋나지 않음 | 손으로 고른 사본 `local.css`(파일이 작지만 `app.css`가 바뀔 때마다 맞춰야 함) |
| **PD-6** | 트레이 아이콘 파일 형식 (명세 `tray-*.png`) | **`.ico`(16 · 20 · 24 · 32px 한 파일)** — Windows 배율 100~200%에 맞는 크기를 OS가 고름 | PNG `@1x`/`@2x`(125 · 150%에서 흐려질 수 있음) |
| **PD-7** | E6 "코드로 연결" 창 (명세 13.1 `pair.html`) | **"이 PC 상태" 창 안의 "연결" 구역**으로(창 하나 줄임). 트레이 [코드로 연결…]은 그 창을 열고 코드 칸에 초점 | 따로 작은 창 `pair.html` |
| **PD-8** | 업데이트 준비 알림을 **앱 창(클라우드 화면)** 에도 띄울지 | **띄우지 않음** — 트레이 메뉴 · 알림 · 이 PC 상태만. U5대로 종료 때 자동 설치되고, 띄우려면 `paperlabDesktop`에 상태 · 다시 시작 함수를 더해야 함(13.3 최소 API 원칙) | 앱 창 위쪽 띠(1단계 `#app-banner`) "새 버전 준비됨 — [지금 다시 시작]" + preload 함수 2개 |
| **PD-9** | 설정 창 구역 이름 | **"AI 엔진" · "연결된 PC"**(명세 S1 · S4 이름). 팀장 지시의 "이 PC 연결"은 **버튼 이름**으로 씀(구역에는 다른 PC도 보이므로) | 구역 이름 "이 PC 연결" |

---

## 부록 A. 추가할 CSS (개발 단계에 `app.css` 맨 끝 — 시험 페이지 `phase2.css`와 같음)

```css
/* ---------------- 2단계 작업 큐 · PC 연결 (docs/design/phase2-worker-electron-ui.md) ---------------- */
/* 목록 카드 — 연결된 PC(S4) · 작업 목록(S6) · 앱 "이 PC 상태"의 엔진(E4) 공용 */
.item-list { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.item-card {
  display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 10px 12px;
  border: 1px solid var(--border); border-radius: 10px; background: var(--surface);
}
.item-card[data-state="revoked"] { background: var(--surface-2); border-style: dashed; }
.item-head { display: flex; align-items: center; gap: 6px 8px; flex-wrap: wrap; min-width: 0; }
.item-title { font-weight: 650; min-width: 0; overflow-wrap: anywhere; }
.item-card[data-state="revoked"] .item-title { font-weight: 550; color: var(--text-2); }
.item-meta { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-2); word-break: keep-all; overflow-wrap: anywhere; }
.item-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.item-card > .item-actions { margin-left: 0; }
.item-card details > summary { cursor: pointer; font-size: 12px; color: var(--text-2); width: max-content; max-width: 100%; }
.item-card details > .graph-steps { margin-top: 6px; font-size: 12px; }
.item-card .check { font-weight: 650; }

/* 이 PC 연결 코드 (S5) */
.pair-code {
  display: block; padding: 14px 10px; border: 1px dashed var(--border-strong); border-radius: 10px; background: var(--surface-2);
  font: 700 30px/1.2 var(--mono); letter-spacing: .12em; text-align: center; color: var(--text); user-select: all;
}
.pair-code[data-expired] { color: var(--text-3); text-decoration: line-through; user-select: none; }

/* 작업 진행 카드 (S7) — 1B .graph-progress-card를 탭 안에 바로. 단계 = 경로(API → PC) */
.job-card { margin: 20px auto; text-align: left; }
.job-card .graph-progress-head > svg.ico { width: 20px; height: 20px; color: var(--text-2); }
.job-card[data-job-state="failed"] .graph-progress-head > svg.ico { color: var(--warn); }
.graph-steps li[data-state="failed"] { color: var(--text-2); }
.graph-steps li[data-state="failed"]::before { content: "✕"; color: var(--warn); font-weight: 700; }

/* 한 줄 상태(대화 · 글쓰기 · 작업 목록): 글자 칸이 늘고 버튼은 오른쪽 */
.status-line .grow { flex: 1; min-width: 0; }
.status-line > svg.ico { flex: none; }
.msg.assistant > .status-line, .msg.assistant > .notice { margin-top: 6px; }

/* 사이드바 "작업" 진행 중 개수 */
.nav-item .count[data-active] { color: var(--accent-text); font-weight: 700; }

/* E5 앱 창 로그인 대기 — 로그인 전 화면(#gate)의 새 묶음 */
.gate[data-gate="desktop-wait"] .gate-pane[data-pane="desktop-wait"] { display: flex; }

/* 앱 자체 화면(desktop/ui — app://) 전용: 이 PC 상태 창 */
.local-page { max-width: 600px; margin: 0 auto; padding: 16px 16px 32px; }
.local-head { display: flex; align-items: center; gap: 10px; margin: 0 0 4px; font-size: 17px; font-weight: 700; }
.local-head .gate-mark { width: 28px; height: 28px; }
```

- 1단계 `body[data-auth="pending"|"out"] > .gate` 규칙이 `desktop-wait`에도 그대로 적용됩니다(`data-auth="out"`으로 둠).
- 줄 끝은 `app.css`와 같게 CRLF로 넣어 주세요.
