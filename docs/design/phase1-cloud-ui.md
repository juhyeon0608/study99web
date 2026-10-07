# 화면 시안 — 1단계 클라우드 (로그인 · 계정 · 폴더 · 업로드 · 저장 공간)

- 작성: 디자인팀 · 2026-10-07
- 근거: [1단계 명세](../specs/phase1-cloud.md) 14장(D1~D14) · 2장 · 6장 · 7장 · 9.3절 · 13.4절 · 19장, [PLAN.md](../../PLAN.md) 5장
- 스타일: `paperlab/static/css/app.css` 맨 끝 **"1단계 클라우드"** 구역(이번에 추가). 기존 834줄은 바이트 단위로 그대로입니다(줄 끝 CRLF 유지).
- 개발팀은 **0장 표의 클래스 · data 속성 이름 그대로** 마크업하면 됩니다. 문구는 해요체로 확정한 것입니다(16장 모음).
- 시험 페이지: 디자인팀 scratchpad `design-p1/index.html`(저장소 밖)에서 두 테마 · 390px · 1280px로 확인했습니다(17장).
- 개정: 2026-10-07 팀장 결정 9건 반영 — 17장을 결정 기록으로, 만료 원고 임시 보관 문구(6장), 요약 안내(13장), 아이콘 생성 담당(15장), 대비 변수 수정(`--text-3` · `--warn`, 17.1).

---

## 0. 개발팀용 클래스 · data 속성 목록 (먼저 확정)

> "붙이는 곳"의 파일은 20장 분담 기준입니다. ★ = 기존 마크업을 바꾸는 곳.

### 0.1 로그인 전 전체 화면 (D1 · D2 · D5 · D6) — `index.html`, `auth.js`, `app.js`

| 이름 | 붙이는 곳 | 뜻 |
|---|---|---|
| `body[data-auth="pending｜out｜in"]` ★ | `<body>` (처음 값 `pending`) | `pending`·`out`이면 `#gate`를 보이고 `#app`을 숨김, `in`이면 반대. **속성이 없으면 지금 화면 그대로**(CSS가 아무것도 숨기지 않음) |
| `#gate.gate[data-gate="boot｜login｜denied｜down"]` | `#app`의 형제(앞) | 로그인 전 화면. `data-gate`에 맞는 `.gate-pane` 하나만 보임(CSS가 처리) |
| `.gate-card` | `#gate` 안 `<section>` | 가운데 카드(폭 400px) |
| `.gate-brand` · `svg.gate-mark` (`.gm-bg` · `.gm-line`) · `.gate-name` | 카드 머리 | 앱 아이콘(파비콘과 같은 모양, 색은 `--accent`) + "PaperLab" |
| `.gate-pane[data-pane="boot｜login｜denied｜down"]` | 카드 안 | 상태별 묶음 |
| `.gate-title` (`h1`, `tabindex="-1"`) · `.gate-text` | 각 묶음 | 제목 · 설명 |
| `.gate-icon[data-tone="warn｜danger"]` | denied · down 묶음 | 동그라미 아이콘 |
| `.gate-actions` | 각 묶음 | 버튼 줄(세로, 버튼 폭 100%) |
| `button.btn-google[data-google]` (+`.is-loading`, `disabled`) · `svg.btn-google-logo` · `.spinner` · `.btn-google-label` | login 묶음 | 구글 로그인 버튼 |
| `.notice[data-tone="info"][data-gate-note]` | login 묶음 | 만료 · 로그아웃 · 취소 안내(없으면 `hidden`) |
| `.notice[data-tone="danger"][data-gate-error]` (`role="alert"`) | login 묶음 | 로그인 실패 · 네트워크 오류(없으면 `hidden`) |
| `.gate-boot[data-boot]` · `[data-boot-text]` | boot 묶음 | 스피너 + "PaperLab을 여는 중…" |
| `.gate-wake[data-wake]` | boot 묶음 | 3초 넘으면 `hidden` 빼기(D6) |
| `.gate-email[data-gate-email]` | denied 묶음 | 거부된 계정 이메일(모르면 `hidden`) |
| `button.btn.primary[data-gate-switch]` | denied 묶음 | 다른 계정으로 로그인 |
| `[data-down-title]` · `[data-down-text]` · `pre.gate-detail[data-gate-detail]` | down 묶음 | 멈춤/연결 실패 문구 · 기술 정보(없으면 `hidden`) |
| `button.btn.primary[data-gate-retry]` | down 묶음 | 다시 시도 |
| `.gate-foot` | 카드 아래 `<p>` | 허용 계정 안내 |

### 0.2 쓰는 도중의 알림 띠 (D5 · D6) — `index.html`, `api.js`

| 이름 | 뜻 |
|---|---|
| `#app-banner.app-banner[data-kind="wake｜paused｜offline"]` (+`hidden`) | 화면 위 가운데 고정 띠. `wake`는 `role="status"`, 나머지는 `role="alert"` |
| `.app-banner .spinner` / `svg.ico` | `wake`는 스피너, 나머지는 경고 아이콘(둘 중 하나만 보이게) |
| `.app-banner-text` | 문구 |
| `button.btn.sm[data-banner-retry]` | 다시 시도(`wake`에서는 `hidden`) |

### 0.3 계정 메뉴 (D3) — `index.html`, `app.js`

| 이름 | 붙이는 곳 | 뜻 |
|---|---|---|
| `.sidebar-foot` ★ | 사이드바 바닥 | 내용을 `[계정 버튼][설정][테마]`로 바꿈(3.1) |
| `span.menu-wrap.account-wrap` > `button#account-btn.account-btn` (`aria-haspopup="menu"`, `aria-expanded`) | `.sidebar-foot` 첫 칸 | 계정 버튼(남는 폭 전부) |
| `.avatar` (`span` 이니셜 또는 `img`, +`.lg`) | 계정 버튼 · 메뉴 · 설정 | 프로필 사진/이니셜 |
| `.account-name` · `svg.account-caret` | 계정 버튼 | 이름(말줄임) · ▾ |
| `button#open-settings.icon-btn` ★ | `.sidebar-foot` | 지금 `.nav-item` "설정" → 아이콘 버튼(id 그대로) |
| `.menu.account-menu` | `popupMenu`가 돌려준 메뉴에 추가 | 폭 260px(사이드바 안에서는 214px) |
| `.account-menu-head` · `.account-menu-name` · `.account-menu-email` | 메뉴 맨 앞에 `prepend` | 이름 · 이메일 머리 |
| `span.menu-wrap.account-mini-wrap` > `button#account-mini.account-mini` | `#app` **뒤** 형제 | 900px 이하에서만 오른쪽 아래 둥근 계정 버튼. 읽기 · 원고 편집(`#app.reading`)과 로그인 전에는 숨김(CSS) |

### 0.4 저장 공간 (D14) — `index.html`, `app.js`, `dialogs.js`

| 이름 | 뜻 |
|---|---|
| `.storage-meter[data-storage][data-level="ok｜warn｜full"]` | 사이드바 `.sidebar-foot` **바로 앞**. 불러오기 전 · 실패 시 `hidden` |
| `.storage-meter-head` · `.storage-meter-num[data-storage-text]` | "저장 공간" · "1.2GB / 10GB" |
| `.usage-bar` (+`.lg`) > `span` (인라인 `width:%`) | 막대. `role="meter"` + `aria-valuenow` 등은 막대 요소에 |
| `.storage-meter-msg[data-storage-msg]` | 경고 줄(`ok`에서는 CSS가 숨김) |
| `.usage-block[data-usage][data-level]` · `.usage-head` · `.usage-num[data-usage-text]` · `.hint` | 설정 창 · 업로드 창의 큰 사용량 묶음 |
| `.notice[data-usage-msg]` | 설정 창 경고 상자(`data-tone` `warn`/`danger`, `ok`이면 `hidden`) |

### 0.5 설정 창 (D7) — `dialogs.js`

| 이름 | 뜻 |
|---|---|
| `#engine-seg button[data-v="cli"][disabled][aria-describedby="cli-soon"]` | Claude CLI 비활성 |
| `.hint.is-strong#cli-soon` | "Claude CLI는 PC 연결(2단계) 뒤에 쓸 수 있어요." (`--text-2`로 진하게) |
| `.account-card` · `.account-card-id` · `.account-card-name` · `.account-card-email` · `button[data-logout]` | "계정" 구역 카드 |
| `.notice[data-tone="warn"][data-key-warn]` | API 키 칸 아래, 저장된 키를 복호화하지 못했을 때만(팀장 결정 8 — 필드는 개발팀이 추가) |
| `.seg button:disabled` | (CSS) 비활성 세그먼트 버튼 모양 — 새로 추가 |

### 0.6 폴더 (D8 · D9) — `index.html`, `app.js`, `library.js`, `dialogs.js`

| 이름 | 붙이는 곳 | 뜻 |
|---|---|---|
| `.nav-section[data-folders]` | "내 서재" 구역과 "컬렉션" 구역 사이 | 폴더 구역 |
| `.nav-title > span` + `.nav-sub` ★ | 폴더 · **컬렉션** 제목 | "폴더 · 파일 위치 · 한 곳" / "컬렉션 · 분류 · 여러 곳" |
| `button#add-folder.icon-btn.small` | 폴더 제목 오른쪽 | 새 폴더 |
| `#folder-tree.folder-tree` | 폴더 구역 | 트리(하위는 기존 `.tree-children` — 폴더 트리에서는 안내선이 붙음) |
| `.tree-row.folder-row` | 폴더 한 줄 | |
| `button.tree-toggle[aria-expanded]` / `span.tree-toggle-spacer` | 줄 첫 칸 | 펼치기/접기(하위가 없으면 빈 칸) |
| `button.nav-item[data-fid]` > `svg.ico.folder-ico` · `.label` · `.count` | 줄 가운데 | 폴더 필터 |
| `button.nav-item[data-filter="no_folder"]` | 트리 맨 끝(폴더가 1개 이상일 때만) | "폴더 없음" |
| `.row-menu` | 줄 끝(기존과 같음) | ⋯ 메뉴. **키보드 포커스 · 터치 화면에서도 보이게 CSS 추가**(컬렉션 · 태그에도 적용) |
| `.nav-item.drop-target` | 끌어다 놓기 중 | 기존 클래스 그대로 |
| `.modal.folder-modal` | `modal()` 뒤 `.modal`에 추가 | 좁은 화면에서 창이 넘치지 않게 |
| `form.folder-pick[data-folder-pick]` > `.folder-pick-list[role="radiogroup"]` | 폴더 고르기 창 본문 | |
| `label.folder-opt` (인라인 `--depth:N`, +`.is-current`, `.is-disabled`) > `input[type=radio][name=folder][value]` · `svg.folder-ico` · `.folder-opt-name` · `.chip` | 선택지 한 줄 | `value=""` = 폴더 없음/맨 위 |
| `.folder-pick-empty` | 폴더가 없을 때 안내 | |
| `[data-folder-new]` · `[data-no]` · `[data-yes]` | 폴더 고르기 창 바닥 | 새 폴더… · 취소 · 옮기기 |
| `.folder-line[data-folder-line]` · `.folder-path` (+`.is-none`) · `.sep` · `button.btn.sm[data-move-folder]` | 상세 패널 "폴더" 구역 | 현재 폴더 경로 · 옮기기 |
| `button.btn.sm[data-folder]` | 일괄 작업 막대 | 폴더로 이동… |

### 0.7 업로드 진행률 (D10) — `dialogs.js`, `library.js`

| 이름 | 뜻 |
|---|---|
| `.notice[data-upload-storage]` | 80% 이상일 때 맨 위 경고(`data-tone="warn"`) |
| `.status-line[data-upload-summary]` (`aria-live="polite"`) | 전체 요약 줄(기존 클래스) |
| `.upload-list[data-upload-list]` | 파일 목록 |
| `.upload-item[data-state="waiting｜uploading｜processing｜done｜duplicate｜error"]` | 파일 한 줄(진행 막대는 `uploading`·`processing`에서만 보임 — CSS) |
| `.upload-st` | 상태 아이콘 칸(스피너 또는 글자 ○ ✓ ＝ ✕) |
| `.upload-main` · `.upload-name` · `.upload-file` · `.upload-size` | 이름 줄 |
| `.upload-item .progress` (+`.indeterminate`) | 기존 진행 막대 재사용 |
| `.upload-msg` · `.upload-warn` | 상태 문구 · 경고(기존 `warnings`) |
| `button.btn.sm[data-retry]` | 실패한 줄 오른쪽 |
| `.upload-foot-note` · `[data-cancel-all]` · `[data-close-upload]` | 바닥 안내 · 모두 취소 · 닫기 |
| `.upload-blocked[data-upload-blocked]` | 95% 이상 막힘 화면 |

### 0.8 요약 진행 (D11) — `reader.js`

| 이름 | 뜻 |
|---|---|
| `.ai-cta[data-summary-progress]` · `[data-progress-msg]` | 기존 요약 진행 화면 |
| `.notice[data-tone="info"][data-keep-open]` | "다른 화면에 다녀와도 괜찮아요. 탭만 닫지 마세요." 안내 |

### 0.9 공통

| 이름 | 뜻 |
|---|---|
| `.notice[data-tone="info｜warn｜danger"]` > `svg.ico` + `div` | 새 알림 상자. 글자는 `--text`, 색은 왼쪽 테두리 · 아이콘에만 |
| `.field .hint.is-strong` | 꼭 읽어야 하는 안내를 `--text-2`로 더 진하게(`--text-3`도 이제 AA는 통과 — 17.1) |
| `localStorage` 키 `paperlab.draft.{user_id}.{manuscript_id}` | 만료 시 저장 못 한 원고 임시 보관(6.1 — 개발팀 구현, 클래스 없음) |
| `.nav-item:focus-visible` | (CSS) 사이드바 항목 키보드 포커스 링 — 새로 추가 |

---

## 1. 공통 원칙

| 항목 | 정한 것 |
|---|---|
| 재사용 | `.btn` · `.icon-btn` · `.modal` · `.status-line` · `.progress` · `.spinner` · `.chip` · `.seg` · `.menu`(`popupMenu`) · `confirmDialog` · `promptDialog` · `toast` · `.tree-row` · `.nav-item` |
| 대비 | 밝은 테마 `--text-3` = `#626a7e`, `--warn` = `#a35300`(팀장 결정 9 — 17.1 표). 두 테마 모든 새 글자 AA 이상 |
| 테마 | 모든 색은 CSS 변수. 구글 버튼만 Google 상표 지침 색(밝게 `#fff`/`#747775`/`#1f1f1f`, 어둡게 `#131314`/`#8e918f`/`#e3e3e3`). 어두운 테마의 사용량 막대(정상)는 `--accent-text`로 칠해 배경 대비 3:1 이상 |
| 좁은 화면 | 900px 이하는 지금처럼 사이드바가 숨으므로 **오른쪽 아래 계정 버튼**(`.account-mini`)으로 설정 · 로그아웃에 닿게 함. 로그인 화면 카드는 화면 폭 − 32px. 알림 띠는 560px 이하에서 좌우 16px로 펼침. 폴더 고르기 창은 `.folder-modal`로 넘침 방지 |
| 키보드 | 새 조작은 모두 진짜 `<button>` · `<input type=radio>`. Esc = 창 닫기(기존 `modal()`). 포커스 링은 `:focus-visible` |
| 크기 표시 | `fmtBytes`: 1 GiB(1024³) 미만은 `MB` 정수(`320MB`), 이상은 소수 한 자리 `GB`(`8.2GB`), 0은 `0MB`. 한도 10737418240 → `10GB`. 비율은 **내림**(`Math.floor(used / limit * 100)`) — 79.6%를 80%로 보이면서 `level`은 `ok`인 어긋남을 막음. 색 · 문구는 서버 `level`을 따름 |
| 이름 | 사람 이름 = `/api/me`의 `display_name`, 비면 이메일 `@` 앞부분. 이니셜 = 이름 첫 글자(영문이면 대문자). 사진 = supabase 세션 `user_metadata.avatar_url`이 있으면 `<img class="avatar" alt="" referrerpolicy="no-referrer">`(구글 사진은 referrer가 있으면 막힐 때가 있음), 읽기 실패(`onerror`) 시 이니셜로 |

---

## 2. D1 로그인 화면 · D6 시작 화면

```
            ┌──────────────────────────────┐
            │            [■]               │  ← 앱 아이콘(파비콘 모양)
            │          PaperLab            │
            │ 논문을 찾고, 읽고, 쓰는 나만의 서재예요. │
            │ ┃ⓘ 로그인이 만료됐어요. …       │  ← 안내/오류(있을 때만)
            │ ┌──────────────────────────┐ │
            │ │ G  Google로 계속하기       │ │
            │ └──────────────────────────┘ │
            │   (이메일 로그인 자리 — 2.3)   │
            └──────────────────────────────┘
   허용된 계정만 들어올 수 있어요. 계정이 필요하면 관리자에게 알려 주세요.
```

### 2.1 골격 (`index.html` — `#app` 앞)

```html
<body data-auth="pending">
<div id="gate" class="gate" data-gate="boot">
  <section class="gate-card" aria-labelledby="gate-name">
    <div class="gate-brand">
      <svg class="gate-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect class="gm-bg" width="32" height="32" rx="8" fill="#1e3a8a"/>
        <path d="M10 8h9l5 5v11a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" fill="#fff"/>
        <path class="gm-line" d="M12 17h8M12 21h6" stroke="#1e3a8a" stroke-width="2" stroke-linecap="round" fill="none"/>
      </svg>
      <span class="gate-name" id="gate-name">PaperLab</span>
    </div>

    <!-- 시작 (D6) -->
    <div class="gate-pane" data-pane="boot" role="status">
      <div class="gate-boot" data-boot><span class="spinner"></span><span data-boot-text>PaperLab을 여는 중…</span></div>
      <div class="gate-wake hidden" data-wake>
        <h1 class="gate-title">서버에 연결하는 중…</h1>
        <p class="gate-text">응답이 늦어지고 있어요. 잠시만 기다려 주세요.</p>
        <div class="progress indeterminate"><div></div></div>
      </div>
    </div>

    <!-- 로그인 (D1) -->
    <div class="gate-pane" data-pane="login">
      <p class="gate-text">논문을 찾고, 읽고, 쓰는 나만의 서재예요.</p>
      <div class="notice hidden" data-tone="info" data-gate-note role="status">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5v.01"/></svg>
        <div>…안내 문구…</div>
      </div>
      <div class="notice hidden" data-tone="danger" data-gate-error role="alert">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.5v.01"/></svg>
        <div>…오류 문구…</div>
      </div>
      <div class="gate-actions">
        <button type="button" class="btn-google" data-google>
          <svg class="btn-google-logo" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          <span class="spinner"></span>
          <span class="btn-google-label">Google로 계속하기</span>
        </button>
      </div>
    </div>

    <!-- D2 · D5 묶음은 3장 · 4장 -->
  </section>
  <p class="gate-foot">허용된 계정만 들어올 수 있어요. 계정이 필요하면 관리자에게 알려 주세요.</p>
</div>
<div id="app">…지금 그대로…</div>
```

### 2.2 상태 표 (무엇을 언제 보이나)

| 상황 | `body[data-auth]` | `#gate[data-gate]` | 덧붙임 |
|---|---|---|---|
| 화면을 연 직후 · `GET /api/public-config` 기다림 | `pending` | `boot` | 3초 넘게 응답이 없으면 `[data-boot]`에 `hidden`, `[data-wake]`에서 `hidden` 빼기 |
| 구글에서 돌아와 `?code=`를 세션으로 바꾸는 중 · `GET /api/me` 기다림 | `pending` | `boot` | `[data-boot-text]` = "로그인하는 중…" (3초 규칙 같음) |
| 세션 없음 | `out` | `login` | |
| 로그아웃 직후 | `out` | `login` | `[data-gate-note]` = "로그아웃했어요." |
| 로그인 만료(D4, 6장) | `out` | `login` | 토스트 + `[data-gate-note]` = "로그인이 만료됐어요. 다시 로그인해 주세요." — 보관한 원고가 있으면 6.1의 문구를 이어 붙임 |
| 구글 화면에서 취소하고 돌아옴(`error=access_denied`) | `out` | `login` | `[data-gate-note]` = "로그인을 취소했어요." |
| 그 밖의 OAuth 오류 | `out` | `login` | `[data-gate-error]` = "로그인하지 못했어요. 잠시 후 다시 시도해 주세요." |
| 로그인 버튼을 눌렀는데 인터넷이 끊김 | `out` | `login` | `[data-gate-error]` = "인터넷에 연결되지 않았어요. 연결을 확인하고 다시 시도해 주세요." |
| 허용 목록 밖(Auth Hook 거부 · `/api/me` 403 `not_allowed`) | `out` | `denied` | 3장 |
| 503 `db_unavailable` · Supabase Auth 무응답 | `pending` | `down` | 4장 `paused` |
| `public-config` · `me`가 네트워크 오류 · 그 밖의 5xx | `pending` | `down` | 4장 `error` |
| 로그인 끝 | `in` | — | `#gate`는 CSS로 숨음(지울 필요 없음) |

### 2.3 동작

| 항목 | 정한 것 |
|---|---|
| 구글 버튼 누름 | 즉시 `disabled` + `.is-loading` + `aria-busy="true"`, 라벨 "구글로 이동하는 중…"(로고 대신 스피너). 이동이 실패해 페이지에 남으면 원래대로 + 오류 상자 |
| 이메일 로그인 자리(이후 작업) | `.gate-actions` 안 구글 버튼 **아래**에 "또는" 구분선 + 이메일 칸 + [이메일로 계속]을 넣을 예정. 지금은 아무것도 그리지 않습니다(빈 여백도 두지 않음 — 카드가 위아래로 늘어나는 구조라 나중에 넣어도 배치가 깨지지 않음) |
| 포커스 | `login`이 보일 때 `[data-google]`에 포커스. 안내 · 오류 상자는 `role`로 읽힘 |
| 끌어다 놓기 | 로그인 전에는 `app.js`의 PDF 끌어다 놓기 덮개(`#drop-overlay`)가 뜨지 않게 `body[data-auth="in"]`일 때만 동작시켜 주세요 |
| 테마 | 로그인 화면도 `localStorage`의 테마를 따릅니다. 지금은 `app.js`(모듈, 늦게 실행)가 테마를 붙여서 어두운 테마 사용자에게 **밝은 화면이 잠깐 번쩍**일 수 있어요 → `<head>`에서 테마를 먼저 붙이는 작은 인라인 스크립트를 권합니다(개발팀 판단) |

---

## 3. D2 허용되지 않은 계정

```html
<div class="gate-pane" data-pane="denied">
  <div class="gate-icon" data-tone="warn"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9h-13zM12 14.5v2"/></svg></div>
  <h1 class="gate-title" tabindex="-1">이 계정은 쓸 수 없어요</h1>
  <p class="gate-text">이 계정은 PaperLab을 쓸 수 없어요. 관리자에게 허용을 요청해 주세요.</p>
  <span class="gate-email" data-gate-email>you@gmail.com</span>
  <div class="gate-actions"><button type="button" class="btn primary" data-gate-switch>다른 계정으로 로그인</button></div>
</div>
```

| 항목 | 정한 것 |
|---|---|
| 이메일 | `/api/me` 403 경로는 세션 이메일을 넣고, Auth Hook 거부 경로(계정이 안 생김)는 이메일을 모르므로 `[data-gate-email]`에 `hidden` |
| 자동 로그아웃 | 명세 6.2-5대로 화면을 그린 **뒤** `signOut()` (화면은 그대로 둠) |
| [다른 계정으로 로그인] | 구글 계정 고르기 창이 다시 뜨도록 `signInWithOAuth`에 `queryParams: { prompt: "select_account" }`를 넣어 주세요(안 넣으면 같은 계정으로 바로 돌아와 다시 거부될 수 있음) |
| 포커스 | `.gate-title`에 포커스(읽기 프로그램이 제목부터 읽음) → Tab 한 번에 버튼 |

---

## 4. D5 서비스 멈춤 · 연결 실패

### 4.1 시작할 때 — 전체 화면 `down`

```html
<div class="gate-pane" data-pane="down">
  <div class="gate-icon" data-tone="warn"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 9v6M14 9v6"/></svg></div>
  <h1 class="gate-title" tabindex="-1" data-down-title>서비스가 잠시 멈춰 있어요</h1>
  <p class="gate-text" data-down-text>관리자에게 알려 주세요. (관리자: Supabase 대시보드에서 프로젝트를 다시 켜 주세요)</p>
  <pre class="gate-detail hidden" data-gate-detail></pre>
  <div class="gate-actions"><button type="button" class="btn primary" data-gate-retry>다시 시도</button></div>
</div>
```

| 종류 | 언제 | 아이콘(`d`) · tone | 제목 | 설명 | `[data-gate-detail]` |
|---|---|---|---|---|---|
| `paused` | 503 `db_unavailable`, Supabase Auth 무응답 | 멈춤 `M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 9v6M14 9v6` · warn | 서비스가 잠시 멈춰 있어요 | 관리자에게 알려 주세요. (관리자: Supabase 대시보드에서 프로젝트를 다시 켜 주세요) | 숨김 |
| `offline` | `navigator.onLine === false` 또는 `fetch` 네트워크 오류 | 느낌표 `M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.5v.01` · warn | 인터넷에 연결되지 않았어요 | 연결을 확인하고 다시 시도해 주세요. | 숨김 |
| `error` | 그 밖의 5xx · 알 수 없는 오류 | 느낌표 · danger | 서버에 연결하지 못했어요 | 잠시 후 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요. | `HTTP 502` 같은 짧은 정보(토큰 · 주소 넣지 않음) |

- [다시 시도]: `disabled` + 라벨 "다시 연결하는 중…" → 처음 시작 흐름을 다시(성공하면 그 다음 상태로). 포커스는 `.gate-title`.

### 4.2 쓰는 도중 — 알림 띠 (화면은 그대로)

쓰던 원고 · 선택이 사라지지 않도록, 로그인한 뒤의 503 · 네트워크 오류 · 느린 응답은 **전체 화면으로 바꾸지 않고** 위쪽 띠로 알립니다.

```html
<div id="app-banner" class="app-banner hidden" data-kind="paused" role="alert">
  <span class="spinner hidden"></span>
  <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.5v.01"/></svg>
  <span class="app-banner-text">서비스가 잠시 멈춰 있어요. 관리자에게 알려 주세요.</span>
  <button class="btn sm" data-banner-retry>다시 시도</button>
</div>
```

| `data-kind` | 언제 | 문구 | 버튼 | 사라짐 |
|---|---|---|---|---|
| `wake` | 일반 요청이 3초 넘게 응답 없음(6장) | 서버에 연결하는 중… | 없음(스피너) | 응답이 오면 바로 |
| `paused` | 503 `db_unavailable` | 서비스가 잠시 멈춰 있어요. 관리자에게 알려 주세요. | 다시 시도 | 다음 요청이 성공하면 |
| `offline` | 네트워크 오류 | 인터넷 연결이 끊겼어요. 연결되면 다시 시도해 주세요. | 다시 시도 | `online` 이벤트 또는 다음 성공 |

- [다시 시도] = 실패한 요청 하나를 다시 보냄(또는 `refreshAll()`). 띠가 있는 동안 같은 오류의 `errorToast`는 띄우지 않습니다(중복).
- 띠는 모달(z 100) 위(z 190), 토스트(z 200) 아래.

---

## 5. D6 서버에 연결하는 중 (규칙)

- 시작: 2.2 표. 3초 기준은 **`public-config` 요청을 보낸 순간부터**.
- 사용 중: `wake` 띠는 **일반 JSON 요청**에만. 원래 오래 걸리는 요청은 빼 주세요 — 요약 · 대화 · 글쓰기 도우미 스트림, `uploads/{id}/complete` · `pdf/complete`(PDF 추출), `fetch-pdf`, `compose/*`, 워드 · 한글 내보내기, 서명 주소로 R2에서 받기/올리기.
- 문구에 "콜드 스타트" 같은 말은 쓰지 않습니다.

---

## 6. D4 로그인 만료 · 로그아웃

| 상황 | 화면 |
|---|---|
| 401 → `refreshSession()` 성공 | 아무것도 안 보임(명세 6.6) |
| 그래도 401 · refresh 실패 | 토스트(보통) "로그인이 만료됐어요. 다시 로그인해 주세요." → `data-auth="out"`, `data-gate="login"`, `[data-gate-note]` 같은 문구, 포커스 `[data-google]` |
| 로그아웃(계정 메뉴 · 설정 창) | 확인 창 없이 바로 `signOut()` → `state`·캐시 비움 → `login` + "로그아웃했어요." |

- 로그인 화면으로 바꿀 때 `#app` 안 내용은 **지우지 않고 숨기기만** 합니다(CSS). 다시 로그인은 구글로 **페이지를 떠났다 돌아오는** 방식이라, 저장 안 된 원고는 6.1처럼 브라우저에 보관합니다(팀장 결정 1).

### 6.1 저장 못 한 원고 임시 보관 (팀장 결정 1 — 개발팀 구현)

| 단계 | 동작 | 화면 |
|---|---|---|
| 만료가 확정될 때(구글로 떠나기 전) | 저장 안 된 원고마다 `localStorage` `paperlab.draft.{user_id}.{manuscript_id}` = `{title, content, saved_at}` | 로그인 화면 `[data-gate-note]` 두 번째 줄: "저장하지 못한 원고는 이 브라우저에 보관해 두었어요. 다시 로그인하면 이어서 저장해요." |
| 다시 로그인(같은 `user_id`) | 보관한 원고마다 자동 저장 재시도(지금 저장 규칙 — 나중 저장이 이김) → 성공하면 그 키 삭제 | 성공: 토스트 success "보관해 둔 원고를 저장했어요" (여러 개면 "보관해 둔 원고 {n}개를 저장했어요") |
| 재시도 실패(네트워크 · 5xx) | 키는 그대로 두고 다음 시작 때 다시 | 토스트 error(8초) "보관해 둔 원고를 아직 저장하지 못했어요. 이 브라우저에 그대로 두고 다음에 다시 저장할게요." |
| 원고가 이미 지워짐(404) | 그 키 삭제 | 토스트 보통(8초) "보관해 둔 원고 ‘{제목}’은 이미 지워져서 저장하지 않았어요." |
| 다른 계정으로 로그인 | 다른 `user_id`의 키는 건드리지 않음(읽지도 저장하지도 않음) | 없음 |

- 직접 로그아웃(계정 메뉴 · 설정)은 보관을 만들지 않습니다. 로그아웃 전에 원고 자동 저장을 먼저 끝내 주세요(flush).
- 키에 `user_id`를 넣는 이유: 같은 브라우저에서 다른 사람이 로그인했을 때 남의 원고를 자기 계정에 저장하지 않게.

---

## 7. D3 계정 메뉴

### 7.1 사이드바 바닥 (`index.html` ★)

```
│ 저장 공간         1.2GB / 10GB │  ← D14 (9장)
│ ▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
├───────────────────────────────┤
│ (김) 김연구 …   ▾ │ ⚙ │ ☾      │
```

```html
<div class="storage-meter hidden" data-storage data-level="ok">…9장…</div>
<div class="sidebar-foot">
  <span class="menu-wrap account-wrap">
    <button class="account-btn" id="account-btn" aria-haspopup="menu" aria-expanded="false" title="계정">
      <span class="avatar" aria-hidden="true">김</span>
      <span class="account-name">김연구</span>
      <svg class="ico account-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>
    </button>
  </span>
  <button class="icon-btn" id="open-settings" title="설정" aria-label="설정"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4"/></svg></button>
  <button class="icon-btn" id="theme-toggle" title="밝게/어둡게">…지금 그대로…</button>
</div>
```

- 명세 D3의 "상단(테마 버튼 옆)"은 지금 테마 버튼이 사이드바 **바닥**에 있어서 바닥에 둡니다. 설정은 자주 쓰므로 아이콘 버튼으로 남기고 메뉴에도 넣습니다.

### 7.2 메뉴 (`popupMenu` + 머리)

```js
const m = popupMenu(btn, [
  { label: "설정", action: settingsDialog },
  { label: "로그아웃", action: signOut },
], { left: true });              // 좁은 화면 버튼(#account-mini)은 left 없이(오른쪽 맞춤)
m.classList.add("account-menu");
m.prepend(el(`<div class="account-menu-head">
  <span class="avatar lg" aria-hidden="true">김</span>
  <div><div class="account-menu-name">김연구</div><div class="account-menu-email">you@gmail.com</div></div>
</div>`), el("<hr>"));
```

- 바닥에서 열리면 `popupMenu`가 이미 위로 뒤집습니다. 열 때 `aria-expanded="true"`, 닫히면 `false`.
- 키보드: Enter/Space로 열면 **첫 항목(설정)에 포커스**, Esc = 닫고 계정 버튼으로 포커스. (지금 `popupMenu`는 Esc를 처리하지 않습니다 — `ui.js`에 넣으면 모든 메뉴가 좋아져요.)
- 900px 이하: `#account-mini`(오른쪽 아래 44px 둥근 버튼, 아바타만, `aria-label="계정 메뉴"`)가 같은 메뉴를 엽니다.

```html
<!-- #app 다음 -->
<span class="menu-wrap account-mini-wrap">
  <button class="account-mini" id="account-mini" aria-haspopup="menu" aria-expanded="false" aria-label="계정 메뉴"><span class="avatar" aria-hidden="true">김</span></button>
</span>
```

---

## 8. D7 설정 창

| 바꾸는 곳 | 지금 | 1단계 |
|---|---|---|
| AI 엔진 버튼 | `Claude CLI (설치된 claude 명령)` | `<button type="button" data-v="cli" disabled aria-describedby="cli-soon">Claude CLI</button>` |
| 엔진 안내 | `#engine-hint` 하나(CLI 문구 포함) | `#engine-hint`는 API 문구만, 그 아래 `<div class="hint is-strong" id="cli-soon">Claude CLI는 PC 연결(2단계) 뒤에 쓸 수 있어요.</div>` (항상 보임) |
| 저장된 `ai_engine`이 `cli` | — | 화면은 `api`로 선택해 보여 줌(명세 8.1) |
| API 키 칸 placeholder | 저장됨 / 환경변수 / `sk-ant-...` | 저장됨 (바꾸려면 새 키 입력) / `sk-ant-...` (환경변수 문구 삭제) |
| API 키 안내 | 키는 이 컴퓨터의 설정 파일에만 저장돼요. … | **키는 계정별로 암호화해 클라우드에 저장돼요. PC를 꺼도 AI를 쓰려면 API 키가 필요해요.** [키 발급받기] · [저장된 키 지우기] |
| "데이터" 구역 | 데이터 폴더 경로 | **삭제** → 같은 자리(맨 끝)에 "계정" 구역 |

"계정" 구역:

```html
<div class="section-title">계정</div>
<div class="account-card">
  <span class="avatar lg" aria-hidden="true">김</span>
  <div class="account-card-id"><div class="account-card-name">김연구</div><div class="account-card-email">you@gmail.com</div></div>
  <button type="button" class="btn sm" data-logout>로그아웃</button>
</div>
<div class="usage-block" data-usage data-level="ok">
  <div class="usage-head"><span>저장 공간</span><span class="usage-num" data-usage-text>전체 8.2GB / 10GB · 내 PDF 1.2GB</span></div>
  <div class="usage-bar lg" role="meter" aria-label="저장 공간" aria-valuemin="0" aria-valuemax="100" aria-valuenow="82" aria-valuetext="10GB 중 8.2GB 사용"><span style="width:82%"></span></div>
  <div class="hint">PDF와 DB 백업이 함께 쓰는 공간이에요(모든 사용자 합계). 80%를 넘으면 알려 드리고, 95%를 넘으면 PDF를 더 올릴 수 없어요.</div>
  <div class="notice hidden" data-tone="warn" data-usage-msg><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.5v.01"/></svg><div>…</div></div>
</div>
```

- 저장된 API 키를 복호화하지 못했다는 신호(개발팀이 설정 API에 추가할 필드)가 오면 API 키 칸 아래에 `<div class="notice" data-tone="warn" data-key-warn><svg class="ico" …(경고 삼각형)…/><div>저장된 키를 읽지 못했어요. 키를 다시 입력해 주세요.</div></div>`, placeholder는 `sk-ant-...`.
- 사용량을 못 받으면 `.usage-block` 대신 `<p class="small" style="color:var(--text-2)">저장 공간 사용량을 불러오지 못했어요.</p>`.
- [로그아웃]은 저장하지 않은 설정을 버리고 바로 로그아웃(6장).
- 390px에서는 카드의 [로그아웃]이 이름 아래 줄로 내려갑니다(의도).

---

## 9. D14 저장 공간

| `level` | 사이드바 `[data-storage-text]` | 사이드바 `[data-storage-msg]` | 설정 · 업로드 창 `.notice` |
|---|---|---|---|
| `ok` (< 80%) | `1.2GB / 10GB` | (숨김) | 없음 |
| `warn` (80% ~) | `8.2GB / 10GB` | 저장 공간 82% 사용 중 (주황) | `warn` · 저장 공간 82% 사용 중 (8.2GB / 10GB) · 관리자에게 알려 주세요. |
| `full` (95% ~) | `9.6GB / 10GB` | PDF를 더 올릴 수 없어요 (빨강) | `danger` · 저장 공간이 거의 찼어요 (96%). PDF를 더 올릴 수 없어요. 관리자에게 알려 주세요. |

- 사이드바 막대는 **전체 사용량**(`used_bytes / limit_bytes`). `title` = "모든 사용자가 함께 쓰는 저장 공간이에요 · 내 PDF {mine}".
- `aria-valuetext` = "10GB 중 8.2GB 사용".
- 언제 다시 받나: 시작 때, 업로드 · PDF 첨부/교체 · 논문 삭제가 끝난 뒤(`refreshAll`과 함께), 설정 창 열 때.

---

## 10. D8 폴더 트리

```
내 서재 …
폴더 파일 위치 · 한 곳            ＋
 › 🗀 졸업논문                   5   ⋯
 │   🗀 2장 선행연구             12
 │   🗀 3장 방법
   🗀̶ 폴더 없음                 25      ← 폴더가 1개 이상일 때만
컬렉션 분류 · 여러 곳              ＋
   ▫ 추천 시스템                  8
```

컬렉션과 구별: **대표색 폴더 아이콘** · **하위 안내선** · 제목 옆 짧은 설명(`.nav-sub`) · 펼침 버튼이 따로 있음(컬렉션은 글자 ▸▾▫).

```html
<div class="nav-section" data-folders>
  <div class="nav-title" title="폴더: 논문 파일이 실제로 있는 곳이에요. 논문 한 편은 폴더 한 곳에만 있어요.">
    <span>폴더<span class="nav-sub">파일 위치 · 한 곳</span></span>
    <button class="icon-btn small" id="add-folder" title="새 폴더" aria-label="새 폴더"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
  </div>
  <div id="folder-tree" class="folder-tree">
    <!-- 한 줄 -->
    <div class="tree-row folder-row">
      <button class="tree-toggle" aria-expanded="true" aria-label="‘졸업논문’ 하위 폴더 접기"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
      <!-- 하위가 없으면: <span class="tree-toggle-spacer"></span> -->
      <button class="nav-item" data-fid="1">
        <svg class="ico folder-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9.3A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z"/></svg>
        <span class="label">졸업논문</span><span class="count">5</span>
      </button>
      <span class="menu-wrap"><button class="icon-btn small row-menu" title="메뉴" aria-label="‘졸업논문’ 폴더 메뉴">⋯</button></span>
    </div>
    <div class="tree-children">…같은 줄…</div>
    <!-- 맨 끝 (폴더가 있을 때만) -->
    <div class="tree-row folder-row">
      <span class="tree-toggle-spacer"></span>
      <button class="nav-item" data-filter="no_folder"><svg class="ico folder-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9.3A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18zM9.5 13.5h5"/></svg><span class="label">폴더 없음</span><span class="count">25</span></button>
    </div>
  </div>
</div>
```

컬렉션 제목도 같이 바꿉니다 ★: `<div class="nav-title" title="컬렉션: 주제별로 묶는 분류예요. 논문 한 편을 여러 컬렉션에 넣을 수 있어요."><span>컬렉션<span class="nav-sub">분류 · 여러 곳</span></span> <button … id="add-collection">…</button></div>`

| 항목 | 정한 것 |
|---|---|
| 빈 트리 | `<div class="empty-hint">＋를 눌러 논문 파일을 정리할 폴더를 만들어 보세요</div>` |
| 펼침 | `.tree-toggle` 클릭/Enter. `aria-label` "‘{이름}’ 하위 폴더 펼치기/접기". 접힘 상태는 컬렉션처럼 `localStorage`(키 이름은 개발팀 — 컬렉션 키와 따로) |
| 필터 | `.nav-item` = `GET /api/papers?folder={id}`, "폴더 없음" = `filter=no_folder`. 툴바 제목은 폴더 이름 / "폴더 없음". 폴더가 비면 `.empty`: 제목 "이 폴더에 논문이 없어요", 설명 "논문을 끌어다 놓거나 ‘폴더로 이동…’으로 옮겨 보세요." |
| ⋯ 메뉴 | `하위 폴더 만들기` · `이름 바꾸기` · `옮기기…`(11장 창, 자기와 하위는 비활성) · `-` · `삭제 (논문은 남아요)`(danger) |
| 만들기 | `promptDialog("새 폴더 이름", { placeholder: "예: 2장 선행연구, 학회 발표 자료" })` / 하위는 "하위 폴더 이름" / 바꾸기는 "폴더 이름" |
| 삭제 확인 | `confirmDialog(…, { ok: "삭제", danger: true })` — 문구는 16장 "폴더 삭제 확인" |
| 삭제 뒤 토스트 | 응답 `moved_papers`·`moved_folders`로 "폴더를 지웠어요 · 논문 2편과 하위 폴더 1개는 상위 폴더로 옮겼어요"(부모 없으면 "폴더 밖으로"), 둘 다 0이면 "폴더를 지웠어요" |
| 끌어다 놓기 | 논문 행을 폴더 줄에 놓으면 `bulk move_folder`. 놓는 동안 기존 `.drop-target`. 끝나면 토스트 "{n}편을 ‘{이름}’ 폴더로 옮겼어요"("폴더 없음"에 놓으면 "{n}편을 폴더 밖으로 옮겼어요"). 폴더를 끌어 옮기는 기능은 없음(메뉴 `옮기기…`) |
| 키보드 | Tab: 펼침 버튼 → 폴더 → ⋯(줄에 포커스가 있으면 보임 — CSS 추가) → 다음 줄. 끌어다 놓기의 키보드 대안은 `폴더로 이동…` |

서버 오류 문구(개발팀이 서버 400 `detail`로 — 제안):

| 경우 | 문구 |
|---|---|
| 같은 부모 아래 같은 이름(대소문자 무시) | 같은 이름의 폴더가 이미 있어요 |
| 금지 문자 `/ \ : * ? " < > |` | 폴더 이름에 / \ : * ? " < > | 는 쓸 수 없어요 |
| 길이 | 폴더 이름은 1~100자로 적어 주세요 |
| 자기(하위) 안으로 옮김 | 폴더를 자기 안으로 옮길 수 없어요 |
| 남의 · 없는 폴더 id | 폴더를 찾을 수 없어요 |

---

## 11. D9 논문을 폴더로 옮기기

여는 곳: 일괄 막대 `<button class="btn sm" data-folder>폴더로 이동…</button>`(컬렉션 버튼 바로 뒤), 상세 패널 ⋯ 메뉴 `폴더로 이동…`(정보 수정 다음), 상세 패널 "폴더" 구역 [옮기기].

상세 패널 "컬렉션" 구역 **앞**:

```html
<div class="section-title">폴더</div>
<div class="folder-line" data-folder-line>
  <svg class="ico folder-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9.3A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z"/></svg>
  <span class="folder-path">졸업논문<span class="sep">›</span>2장 선행연구</span>   <!-- 없으면 class="folder-path is-none" 내용 "폴더 없음", 아이콘은 'M9.5 13.5h5' 붙은 것 -->
  <button class="btn sm" data-move-folder>옮기기</button>
</div>
```

폴더 고르기 창 (`modal({ title })` 뒤 `.modal`에 `folder-modal`):

```html
<!-- body -->
<form class="folder-pick" data-folder-pick>
  <div class="folder-pick-list" role="radiogroup" aria-label="옮길 폴더">
    <label class="folder-opt" style="--depth:0"><input type="radio" name="folder" value=""><svg class="ico folder-ico" …(폴더 없음 아이콘)…/><span class="folder-opt-name">폴더 없음</span></label>
    <label class="folder-opt" style="--depth:0"><input type="radio" name="folder" value="1"><svg class="ico folder-ico" …/><span class="folder-opt-name">졸업논문</span></label>
    <label class="folder-opt is-current" style="--depth:1"><input type="radio" name="folder" value="2"><svg …/><span class="folder-opt-name">2장 선행연구</span><span class="chip">지금 위치</span></label>
  </div>
  <!-- 폴더가 하나도 없으면 목록 아래: <div class="folder-pick-empty">아직 폴더가 없어요. [새 폴더…]로 만들어 보세요.</div> -->
</form>
<!-- foot -->
<div style="display:contents">
  <div class="left"><button class="btn" data-folder-new title="고른 폴더 안에 새 폴더를 만들어요">새 폴더…</button></div>
  <button class="btn" data-no>취소</button>
  <button class="btn primary" data-yes>옮기기</button>
</div>
```

| 항목 | 정한 것 |
|---|---|
| 제목 | 한 편: "폴더로 이동" · 여러 편: "{n}편을 폴더로 이동" · 폴더 옮기기: "‘{이름}’ 폴더 옮기기" |
| 첫 줄 | 논문: "폴더 없음" · 폴더 옮기기: "맨 위 (상위 폴더 없음)" — 둘 다 `value=""` |
| 처음 선택 | 한 편 · 폴더 옮기기 = 지금 위치(`.is-current` + 칩 "지금 위치"), 여러 편 = 선택 없음 |
| [옮기기] | 선택이 없거나 지금 위치와 같으면 `disabled` |
| 폴더 옮기기 | 자기 자신과 하위 폴더는 `.is-disabled` + `input disabled` |
| [새 폴더…] | `promptDialog("새 폴더 이름")` → 고른 폴더 안(또는 맨 위)에 만들고 목록을 다시 그려 새 폴더를 선택 |
| 순서 | 트리 순서 그대로(부모 다음 자식, 같은 단계는 이름순) |
| 긴 이름 | 한 줄 말줄임(`title`에 전체 경로를 넣어 주세요) |
| 키보드 | 창이 열리면 선택된 라디오(없으면 첫 라디오)에 포커스. ↑/↓ = 선택 이동, Enter = [옮기기](폼 submit), Esc = 닫기 |
| 끝나면 | 토스트 10장과 같은 문구, `refreshAll()` |

---

## 12. D10 업로드 진행률

`uploadPdfs`의 창(제목 "PDF 추가"). PDF 첨부 · 바꾸기도 같은 창에 한 줄(제목 "PDF 첨부" / "PDF 바꾸기").

```html
<div>
  <!-- warn일 때만 --><div class="notice" data-tone="warn" data-upload-storage style="margin-bottom:8px">…저장 공간 82% 사용 중 (8.2GB / 10GB) · 관리자에게 알려 주세요.</div>
  <div class="status-line" data-upload-summary aria-live="polite"><span class="spinner"></span><span>PDF 6개를 올리고 있어요 · 3개 끝남</span></div>
  <div class="upload-list" data-upload-list>
    <div class="upload-item" data-state="uploading">
      <span class="upload-st" aria-hidden="true"><span class="spinner"></span></span>
      <div class="upload-main">
        <div class="upload-name"><span class="upload-file">paper.pdf</span><span class="upload-size">48.6MB</span></div>
        <div class="progress" role="progressbar" aria-label="paper.pdf 올리기" aria-valuemin="0" aria-valuemax="100" aria-valuenow="42"><div style="width:42%"></div></div>
        <div class="upload-msg">올리는 중 · 42%</div>
      </div>
      <!-- 실패하고 다시 할 수 있을 때만: <button class="btn sm" data-retry>다시 시도</button> -->
    </div>
  </div>
</div>
<!-- foot (올리는 중) -->
<div style="display:contents"><div class="left"><span class="upload-foot-note">올리는 동안 이 탭을 닫지 마세요</span></div><button class="btn" data-cancel-all>모두 취소</button></div>
<!-- foot (끝) -->
<div style="display:contents"><button class="btn primary" data-close-upload>닫기</button></div>
```

| `data-state` | `.upload-st` | 이름 줄 | `.upload-msg` | 막대 |
|---|---|---|---|---|
| `waiting` | ○ | 파일 이름 · 크기 | 기다리는 중 | 없음 |
| `uploading` | 스피너 | 파일 이름 · 크기 | 올리는 중 · 42% | 진행률 |
| `processing` | 스피너 | 파일 이름 · 크기 | 논문 정보를 찾는 중… | `.indeterminate` |
| `done` | ✓ | **논문 제목** · 크기 | {파일} · 정보 출처: {matched_by} (또는 `note`) | 없음 |
| `duplicate` | ＝ | 논문 제목 · 크기 | {파일} · {note 또는 "이미 서재에 있어요"} | 없음 |
| `error` | ✕ | 파일 이름 · 크기 | 아래 표 | 없음 |

- 응답의 `warnings`는 줄마다 `<div class="upload-warn">`.
- 동시에 3개(명세 7.2 가정), 나머지는 `waiting`. 진행률 문구 갱신은 1% 단위 이하로 자주 하지 않아도 됩니다(요약 줄만 `aria-live`라 읽기 프로그램이 매번 읽지 않음).

오류 문구:

| 경우 | 문구 | [다시 시도] |
|---|---|---|
| 100MB 초과(보내기 전 · 서버 `error` · `complete` 크기 확인) | 파일이 너무 커요 (100MB 초과) | 없음 |
| PDF가 아님 | 서버 `error` 그대로 (PDF 파일이 아니에요) | 없음 |
| PUT 네트워크 실패 | 올리지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요. | 있음 |
| PUT 403(서명 주소 10분 지남) | 올리기 시간이 지났어요. 다시 시도해 주세요. | 있음(새 서명 주소부터) |
| `complete` 실패(그 밖) | 서버 `detail` 그대로 | 있음 |
| 취소 | 취소했어요 | 없음 |

요약 줄:

| 때 | 문구 |
|---|---|
| 올리는 중 | PDF {전체}개를 올리고 있어요 · {끝난 수}개 끝남 (스피너) |
| 끝 | ✓ {추가}개 추가 · {중복·건너뜀}개 건너뜀 (실패가 있으면 ` · {n}개 실패`) — 추가가 1개 이상이면 `status-line ok` |

닫기 동작: 올리는 중에 ✕ · Esc로 창을 닫아도 **올리기는 계속**하고, 끝나면 토스트 "PDF {n}개를 추가했어요"(실패가 있으면 " · {m}개는 실패했어요", 보통 8초). [모두 취소]는 기다리는 것과 올리는 중인 것을 멈춤(이미 `complete`로 처리 중인 것은 끝까지).

### 12.1 저장 공간이 꽉 참 (`full`)

시작 전에 아는 `level`이 `full`이거나 `POST /api/uploads`가 400 "저장 공간이 거의 찼어요…"를 주면 목록 대신:

```html
<div class="upload-blocked" data-upload-blocked>
  <div class="notice" data-tone="danger" role="alert"><svg class="ico" …(느낌표)…/><div><b>저장 공간이 거의 찼어요.</b> PDF를 더 올릴 수 없어요. 관리자에게 알려 주세요.</div></div>
  <div class="usage-block" data-level="full" style="margin:0">…전체 9.6GB / 10GB · 내 PDF 1.2GB + 막대…</div>
  <p class="small" style="margin:0;color:var(--text-2)">필요 없는 논문을 지우면 그 PDF만큼 공간이 생겨요.</p>
</div>
```
바닥은 [닫기]만, 포커스는 [닫기].

---

## 13. D11 요약 진행

`reader.js`의 진행 화면(지금 `drawJob`)을 SSE `progress` 이벤트로 그립니다.

```html
<div class="ai-cta" data-summary-progress>
  <div class="big">✦</div><h3>논문을 정리하고 있어요</h3>
  <p class="small" data-progress-msg>요약을 작성하는 중 · 42%</p>
  <div class="progress" style="margin:14px 20px" role="progressbar" aria-label="요약 진행" aria-valuemin="0" aria-valuemax="100" aria-valuenow="42"><div style="width:42%"></div></div>
  <div class="notice" data-tone="info" data-keep-open><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5v.01"/></svg><div>다른 화면에 다녀와도 괜찮아요. 탭만 닫지 마세요.</div></div>
  <p class="small">보통 1~3분 걸려요.</p>
</div>
```

- 앱 안에서 화면을 옮겨도 스트림은 끊지 않고, 탭을 닫을 때만 멈춥니다(팀장 결정 3). 안내 문구는 팀장 결정 문구 그대로입니다.
- 맨 아래 줄은 `.muted` 대신 `.ai-cta` 기본색(`--text-2`)을 씁니다.
- `progress`가 없으면 막대에 `.indeterminate`, 문구는 `message`만.
- 요약 중 다른 화면에 갔다가 끝나면 지금처럼 토스트 "AI 요약이 준비됐어요"(success).
- `error` 이벤트 · 연결 끊김 → 기존 `drawSummaryCta(body, 오류)`. 끊김 문구: "연결이 끊겨 요약이 멈췄어요. 다시 만들어 주세요."
- 요약 · 업로드가 진행 중일 때 `beforeunload`로 브라우저 기본 확인 창을 띄우기를 권합니다(문구는 브라우저가 정함).

---

## 14. D12 문구 변경 (화면 코드)

| 파일 · 위치 | 지금 | 1단계 |
|---|---|---|
| `dialogs.js` 설정 · AI 엔진 버튼 | Claude CLI (설치된 claude 명령) | Claude CLI (비활성, 8장) |
| `dialogs.js` 설정 · CLI 안내 | API 키 없이, 이 컴퓨터에 로그인된 Claude Code로 실행해요. … | 삭제 → "Claude CLI는 PC 연결(2단계) 뒤에 쓸 수 있어요." |
| `dialogs.js` 설정 · API 키 안내 | 키는 이 컴퓨터의 설정 파일에만 저장돼요. | 키는 계정별로 암호화해 클라우드에 저장돼요. PC를 꺼도 AI를 쓰려면 API 키가 필요해요. |
| `dialogs.js` 설정 · API 키 placeholder | 환경변수 ANTHROPIC_API_KEY 사용 중 | 삭제 |
| `dialogs.js` 설정 · "데이터" 구역 | 서재 데이터와 PDF는 이 폴더에 저장돼요. 폴더째 복사하면 백업돼요. + 경로 | 삭제 → "계정" 구역 |
| `app.js` 시작 실패 | 서버에 연결하지 못했어요 (`.empty`) | 전체 화면 `down`(4.1) |
| `reader.js` 요약 진행 | 보통 1~3분 걸려요. 그동안 논문을 읽거나 다른 화면에 다녀와도 괜찮아요. | 13장(안내 상자 "다른 화면에 다녀와도 괜찮아요. 탭만 닫지 마세요." + "보통 1~3분 걸려요.") |

- `formats.js` · `writing.js`의 "한컴 글꼴이 없는 **PC**의 워드" 문구는 로컬 실행과 무관해 그대로 둡니다.
- README · FEATURES는 기획팀 몫.

---

## 15. D13 바로가기 아이콘 — 판단

- **아이콘 파일은 필요합니다.** Windows 바로가기(`.lnk`)의 아이콘은 `.ico`(또는 exe/dll 안 아이콘)만 받고 SVG는 못 씁니다. 없으면 Edge 아이콘으로 보입니다(명세 11.1 "없으면 브라우저 기본 아이콘").
- **모양은 새로 만들지 않고 지금 파비콘 SVG를 그대로 씁니다**(로그인 화면 `.gate-mark`와 같은 모양). 원본(256 기준):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="256" height="256">
  <rect width="32" height="32" rx="8" fill="#1e3a8a"/>
  <path d="M10 8h9l5 5v11a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" fill="#fff"/>
  <path d="M12 17h8M12 21h6" stroke="#1e3a8a" stroke-width="2" stroke-linecap="round"/>
</svg>
```

- 크기: 16 · 32 · 48 · 256px 네 장을 한 `.ico`에. 16px에서도 선 두 개가 1px로 남아 따로 손볼 것 없음. 배경 투명(둥근 모서리 밖).
- 앱 창(`--app`)의 제목줄 · 작업 표시줄 아이콘은 Edge가 페이지 파비콘을 쓰므로 따로 필요 없습니다.
- **만들기: 개발팀**이 위 SVG로 `deploy/paperlab.ico`를 생성합니다(팀장 결정 4). 디자인팀은 16px에서 선 두 개가 보이는지 결과만 확인합니다.

---

## 16. 문구 모음

| 위치 | 문구 |
|---|---|
| 로그인 소개 | 논문을 찾고, 읽고, 쓰는 나만의 서재예요. |
| 구글 버튼 | Google로 계속하기 / 누른 뒤: 구글로 이동하는 중… |
| 카드 아래 | 허용된 계정만 들어올 수 있어요. 계정이 필요하면 관리자에게 알려 주세요. |
| 시작 | PaperLab을 여는 중… / 로그인하는 중… |
| 연결하는 중(전체) | 서버에 연결하는 중… / 응답이 늦어지고 있어요. 잠시만 기다려 주세요. |
| 연결하는 중(띠) | 서버에 연결하는 중… |
| 로그인 안내 | 로그인이 만료됐어요. 다시 로그인해 주세요. / 로그아웃했어요. / 로그인을 취소했어요. |
| 로그인 오류 | 로그인하지 못했어요. 잠시 후 다시 시도해 주세요. / 인터넷에 연결되지 않았어요. 연결을 확인하고 다시 시도해 주세요. |
| 만료 토스트 | 로그인이 만료됐어요. 다시 로그인해 주세요. |
| 허용 안 됨 | 이 계정은 쓸 수 없어요 / 이 계정은 PaperLab을 쓸 수 없어요. 관리자에게 허용을 요청해 주세요. / [다른 계정으로 로그인] |
| 멈춤(전체) | 서비스가 잠시 멈춰 있어요 / 관리자에게 알려 주세요. (관리자: Supabase 대시보드에서 프로젝트를 다시 켜 주세요) / [다시 시도] · 다시 연결하는 중… |
| 연결 실패(전체) | 인터넷에 연결되지 않았어요 / 연결을 확인하고 다시 시도해 주세요. · 서버에 연결하지 못했어요 / 잠시 후 다시 시도해 주세요. 계속되면 관리자에게 알려 주세요. |
| 멈춤 · 끊김(띠) | 서비스가 잠시 멈춰 있어요. 관리자에게 알려 주세요. / 인터넷 연결이 끊겼어요. 연결되면 다시 시도해 주세요. |
| 계정 메뉴 | 설정 · 로그아웃 / 버튼 `title` "계정", 좁은 화면 `aria-label` "계정 메뉴" |
| 설정 · CLI | Claude CLI는 PC 연결(2단계) 뒤에 쓸 수 있어요. |
| 설정 · API 키 | 키는 계정별로 암호화해 클라우드에 저장돼요. PC를 꺼도 AI를 쓰려면 API 키가 필요해요. |
| 설정 · 사용량 | 전체 {used} / {limit} · 내 PDF {mine} / PDF와 DB 백업이 함께 쓰는 공간이에요(모든 사용자 합계). 80%를 넘으면 알려 드리고, 95%를 넘으면 PDF를 더 올릴 수 없어요. / 저장 공간 사용량을 불러오지 못했어요. |
| 저장 공간 경고 | 저장 공간 {p}% 사용 중 ({used} / {limit}) · 관리자에게 알려 주세요. |
| 저장 공간 꽉 참 | 저장 공간이 거의 찼어요 ({p}%). PDF를 더 올릴 수 없어요. 관리자에게 알려 주세요. |
| 사이드바 사용량 | 저장 공간 · {used} / {limit} · 저장 공간 {p}% 사용 중 · PDF를 더 올릴 수 없어요 / `title`: 모든 사용자가 함께 쓰는 저장 공간이에요 · 내 PDF {mine} |
| 폴더 제목 | 폴더 · 파일 위치 · 한 곳 / `title`: 폴더: 논문 파일이 실제로 있는 곳이에요. 논문 한 편은 폴더 한 곳에만 있어요. |
| 컬렉션 제목 | 컬렉션 · 분류 · 여러 곳 / `title`: 컬렉션: 주제별로 묶는 분류예요. 논문 한 편을 여러 컬렉션에 넣을 수 있어요. |
| 폴더 빈 트리 | ＋를 눌러 논문 파일을 정리할 폴더를 만들어 보세요 |
| 폴더 메뉴 | 하위 폴더 만들기 · 이름 바꾸기 · 옮기기… · 삭제 (논문은 남아요) |
| 폴더 이름 입력 | 새 폴더 이름(예: 2장 선행연구, 학회 발표 자료) / 하위 폴더 이름 / 폴더 이름 |
| 폴더 삭제 확인 | ‘{이름}’ 폴더를 삭제할까요? 안의 논문 {n}편과 하위 폴더는 상위 폴더로 옮겨져요. (최상위 폴더면 "…폴더 밖으로 옮겨져요.", 비었으면 "‘{이름}’ 폴더를 삭제할까요? 빈 폴더예요.") [삭제] |
| 폴더 삭제 토스트 | 폴더를 지웠어요 · 논문 {n}편과 하위 폴더 {m}개는 상위 폴더로 옮겼어요 (0인 항목은 빼고, 최상위면 "폴더 밖으로") |
| 옮김 토스트 | {n}편을 ‘{이름}’ 폴더로 옮겼어요 / {n}편을 폴더 밖으로 옮겼어요 / ‘{이름}’ 폴더를 옮겼어요 |
| 폴더 빈 목록 | 이 폴더에 논문이 없어요 / 논문을 끌어다 놓거나 ‘폴더로 이동…’으로 옮겨 보세요. |
| 폴더 고르기 | 폴더로 이동 / {n}편을 폴더로 이동 / ‘{이름}’ 폴더 옮기기 · 폴더 없음 / 맨 위 (상위 폴더 없음) · 지금 위치 · [새 폴더…] [취소] [옮기기] · 아직 폴더가 없어요. [새 폴더…]로 만들어 보세요. |
| 상세 패널 | 폴더 · 폴더 없음 · [옮기기] / ⋯ 메뉴 "폴더로 이동…" / 일괄 막대 "폴더로 이동…" |
| 업로드 | 12장 표 · 올리는 동안 이 탭을 닫지 마세요 · [모두 취소] · [닫기] · 토스트 PDF {n}개를 추가했어요 · {m}개는 실패했어요 |
| 업로드 막힘 | 저장 공간이 거의 찼어요. PDF를 더 올릴 수 없어요. 관리자에게 알려 주세요. / 필요 없는 논문을 지우면 그 PDF만큼 공간이 생겨요. |
| 요약 진행 | 논문을 정리하고 있어요 · 다른 화면에 다녀와도 괜찮아요. 탭만 닫지 마세요. · 보통 1~3분 걸려요. · 연결이 끊겨 요약이 멈췄어요. 다시 만들어 주세요. |
| 원고 임시 보관 | 저장하지 못한 원고는 이 브라우저에 보관해 두었어요. 다시 로그인하면 이어서 저장해요. / 보관해 둔 원고를 저장했어요 · 보관해 둔 원고 {n}개를 저장했어요 / 보관해 둔 원고를 아직 저장하지 못했어요. 이 브라우저에 그대로 두고 다음에 다시 저장할게요. / 보관해 둔 원고 ‘{제목}’은 이미 지워져서 저장하지 않았어요. |
| API 키 복호화 실패 | 저장된 키를 읽지 못했어요. 키를 다시 입력해 주세요. (`.notice[data-tone="warn"]`, API 키 칸 아래 — 필드는 개발팀이 설정 API에 추가) |

---

## 17. 확인 결과 · 남은 것


### 17.1 대비 (팀장 결정 9 반영 — WCAG 계산값)

밝은 테마 변수만 바꿨습니다(어두운 테마 변수는 그대로). 종이 미리보기의 고정색 `.cite-warn` · `.cover-line .ph`도 같은 문제(경고 글자 on `#fff1e0`)라 같은 색으로 맞췄습니다.

| 글자 / 배경 | 전 | 후 |
|---|---|---|
| `--text-3` on `--surface`(#fff) — `.hint` · `.muted` · `.nav-title` 등 | 3.86 | **5.41** (`#7a8293` → `#626a7e`) |
| `--text-3` on `--bg` | 3.60 | **5.05** |
| `--text-3` on `--surface-2` | 3.47 | **4.87** |
| `--text-3` on `--surface-3` | 3.23 | **4.53** |
| `--warn` on `--warn-soft` — `.status-line.bad` · `.chip.warn` · `.badge-status.reading` · `.cover-auto.is-warn` | 4.25 | **4.98** (`#b35c00` → `#a35300`) |
| `--warn` on `--surface` — 사이드바 경고 줄 · `.upload-warn` · `.warn-text` | 4.72 | **5.53** |
| `--warn` on `--bg` | 4.40 | **5.16** |
| 종이 `.cite-warn` · `.cover-line .ph` (on `#fff1e0`) | 4.25 | **4.98** |
| 어두운 테마 `--text-3` on surface / bg / surface-2 | 5.17 / 5.58 / 4.72 | 그대로 |
| 어두운 테마 `--warn` on warn-soft / surface | 7.24 / 9.05 | 그대로 |
| 이번에 새로 쓴 글자 전체(두 테마) | 밝은 최저 4.72 · 어두운 최저 5.17 | 밝은 최저 **5.41** · 어두운 최저 5.17 |

- `#626a7e`는 같은 회색 계열(색상 · 채도 유지)에서 네 배경 모두 4.5:1 이상이 되는 가장 옅은 값입니다(팀장 추가 결정). 표지 미리보기 넘침 테두리(`.cover-sheet.is-overflow`, 글자 아님)는 `#b35c00` 그대로 둡니다.

### 17.2 확인한 것 · 못 한 것

- 확인(정적 시험 페이지, 두 테마, 390px · 1280px): 15개 화면 가로 넘침 0(시험 중 `.folder-modal` 추가로 고침), 새 버튼 모두 Tab으로 닿음, 줄 메뉴(⋯)가 키보드 포커스 때 보임. CSS 변경은 맨 끝 구역 추가 + 위 대비 4줄(`--text-3` · `--warn` · `.cite-warn` · `.cover-line .ph`)뿐, 줄 끝 CRLF 유지.
- 못 한 것: 실제 Tab 키로 본 포커스 링 모양(미리보기 창이 가려져 키 입력 불가 — 규칙과 포커스 가능 여부만 확인), 실제 구글 로그인 · Edge 앱 창 · 화면 읽기 프로그램 · Firefox/Safari(`:has()`), 개발팀 JS와 합친 모습. 대비 변경 뒤 값은 공식 계산으로 확인(화면 재측정은 안 함).

### 17.3 결정 기록 (팀장 결정 2026-10-07)

| # | 항목 | 결정 | 반영 | 담당 |
|---|---|---|---|---|
| 1 | 만료 후 다시 로그인하면 저장 안 된 원고가 사라짐 | 떠나기 전 `localStorage`(원고 id별)에 임시 보관 → 돌아오면 자동 저장 재시도, 성공 시 삭제 | 6.1 · 16장 문구 | 개발팀 구현 |
| 2 | Auth Hook 거부를 구글 복귀 주소에서 구별하는 법 | **개발팀 확인 항목** — 돌아온 `error` · `error_code` · `error_description` 모양을 확인해 D2로 보냄. 구별이 안 되면 D2 대신 "로그인하지 못했어요"가 떠 AC-03 미달이므로 결과를 팀장에게 보고 | 2.2 표 | 개발팀 |
| 3 | 요약 중 다른 화면으로 이동 | 앱 안에서 화면을 옮겨도 스트림을 끊지 않음, 탭을 닫을 때만 멈춤. 안내 "다른 화면에 다녀와도 괜찮아요. 탭만 닫지 마세요." | 13장 · 14장 · 16장 | 개발팀(스트림 유지) |
| 4 | `deploy/paperlab.ico` | 개발팀이 파비콘 SVG(15장)로 생성(16 · 32 · 48 · 256px) | 15장 | 개발팀 |
| 5 | 좁은 화면 계정 버튼 | 시안대로 확정(900px 이하 오른쪽 아래 `.account-mini`) | 7.2 | 개발팀 |
| 6 | 구글 버튼 문구 | "Google로 계속하기" 확정 | 2장 · 16장 | — |
| 7 | 503 표시 | 시작할 때 전체 화면(`down`), 사용 중에는 알림 띠 — 확정 | 4장 | 개발팀 |
| 8 | API 키 복호화 실패 | 개발팀이 설정 API에 필드 추가 예정, 문구는 준비한 것 유지: "저장된 키를 읽지 못했어요. 키를 다시 입력해 주세요."(`.notice[data-tone="warn"]`, API 키 칸 아래) | 16장 | 개발팀(필드 이름 정해지면 알려 주기) |
| 9 | 기존 대비 문제 | 밝은 테마 `--text-3` → `#626a7e`(흰 · `--bg` · `--surface-2` · `--surface-3` 모두 4.5 이상), `.status-line.bad` · `.chip.warn` AA 이상으로 지금 수정 | 17.1 · `app.css` | 디자인팀(완료) |
