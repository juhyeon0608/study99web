# 화면 시안 — 논문 양식 (서식 프리셋)

- 작성: 디자인팀 · 2026-10-06
- 근거: [기능 명세](../specs/doc-formats.md) 11장(화면 흐름) · 15장(작업 분담)
- 스타일: `paperlab/static/css/app.css` 맨 끝 **"논문 양식"** 구역(이번에 추가). 기존 규칙은 고치지 않았습니다.
- 개발팀은 이 문서의 **HTML 골격·클래스·data 속성 이름 그대로** 마크업하면 됩니다(8장 표). 문구는 해요체로 확정한 것입니다.

---

## 0. 공통 원칙

| 항목 | 정한 것 |
|---|---|
| 재사용 | `.modal`(wide 포함) · `.field` · `.grid-2/3` · `.seg` · `.chip(s)` · `.btn` · `.check` · `.status-line` · `.section-title` · `.spinner` · `.empty` · `popupMenu` · `confirmDialog` · `promptDialog` · `toast` |
| 새로 만든 것 | 양식 관리 창 레이아웃(`.fmt-*`), 표지 정보 창 레이아웃·문구 미리보기(`.cover-*`), 라디오형 세그먼트(`.seg.seg-radio`), 필수 점(`.req-dot`), 미리보기 양식 반영(`.doc.doc-formatted`) |
| 테마 | 모든 색은 CSS 변수(`--surface`, `--warn` …)를 써서 밝게/어둡게 모두 맞습니다. **종이**(미리보기 `.doc`, 표지 문구 미리보기 `.cover-sheet`)는 지금 미리보기처럼 어두운 테마에서도 흰 종이 + 검은 글자로 둡니다. |
| 좁은 화면 | 760px 이하: 양식 관리 창은 목록이 위·편집 폼이 아래(한 열), 표지 정보 창은 미리보기가 폼 아래로, 원고 상단 막대는 줄바꿈. 560px 이하: 양식 편집 폼과 표지 정보 폼의 입력 칸이 모두 한 열. |
| 키보드 | 모든 조작은 Tab으로 닿는 진짜 `<button>`·`<input>`·`<select>`로 만듭니다. 라디오형 선택은 진짜 `<input type="radio">`(`.seg-radio`)라 ←/→로 바뀝니다. Esc = 창 닫기(기존 `modal()` 동작). 포커스 링은 `:focus-visible`에서만 보입니다. |
| 숫자 단위 | 입력 칸 오른쪽에 붙은 회색 꼬리표(`.fmt-unit`)로 `mm` · `pt` · `%`를 표시. 길이(`Length`)는 꼬리표 대신 단위 선택(`글자` / `mm`). |

---

## 1. 원고 편집 화면 상단 막대 (명세 11.1)

```
← 원고 | 제목 …………………… | 저장됨 | [APA 7th ▾] [인하대 … 학위논문 ▾] [표지 정보•] [내보내기 ▾]
```

```html
<div class="writer-bar">
  <a class="btn ghost sm" href="#/write">← 원고</a>
  <div class="title" data-title>…</div>
  <span class="small muted" data-save></span>
  <select class="input" data-style title="인용 스타일" style="width:auto;max-width:190px">…</select>

  <!-- 새로 추가 ① 양식 선택 -->
  <select class="input fmt-select" data-format title="내보낼 때 쓸 논문 양식" aria-label="논문 양식">
    <optgroup label="기본 양식">
      <option value="default">기본 (A4)</option>
      <option value="apa7-student">영문 원고 (APA 7 학생 논문)</option>
      <option value="inha-mie-thesis">인하대 제조혁신전문대학원 학위논문 (석사·박사)</option>
      <option value="inha-mie-report">인하대 제조혁신전문대학원 석사학위논문 대체 보고서</option>
    </optgroup>
    <optgroup label="내 양식">
      <option value="user-3">내 학위논문 (12pt)</option>
      <!-- 내 양식이 없으면: <option disabled>아직 없어요</option> -->
    </optgroup>
    <hr>
    <option value="__manage">양식 관리…</option>
  </select>

  <!-- 새로 추가 ② 표지 정보 (cover_kind가 none이면 class="hidden") -->
  <button type="button" class="btn sm cover-btn" data-cover
          title="표지 · 속표지 · 인정서에 들어갈 정보" aria-label="표지 정보">표지 정보</button>

  <span class="menu-wrap"><button class="btn sm" data-export>내보내기 ▾</button></span>
</div>
```

| 동작 | 정한 것 |
|---|---|
| 양식 선택 방식 | 인용 스타일과 같은 **기본 `<select>`** + `<optgroup>` 묶음. 키보드·화면 읽기 프로그램이 그대로 동작하고 두 테마에서 같은 모양입니다. 각 `<option>`의 `title`에 목록 API의 `description`을 넣어 주세요. |
| 바꿀 때 | `change` → 바로 `PATCH {doc_format}` → `[data-save]`에 "저장됨" → 미리보기 다시 그림 → 표지 정보 버튼 보이기/숨기기. 실패하면 이전 값으로 되돌리고 `errorToast`. 따로 토스트는 띄우지 않습니다. |
| "양식 관리…" | 값 `__manage`를 고르면 **즉시 이전 값으로 되돌리고** 양식 관리 창을 엽니다. 창이 닫히면 목록을 다시 받아 옵션을 새로 그리고, 지금 원고의 양식이 지워졌으면 `default`로 표시합니다. (맨 끝 항목이라 화살표로 지나치다 열릴 일은 끝까지 내려갈 때뿐입니다.) `<hr>`는 Chrome·Edge 119+에서 구분선으로 보이고, 지원하지 않는 브라우저에서는 무시됩니다. |
| 표지 정보 버튼 | 고른 양식의 `cover_kind`가 `none`이면 `hidden` 클래스. 필수 항목(이름 · 학과 · 졸업 연월) 중 빈 것이 있으면 **`data-incomplete` 속성**을 붙입니다 → 버튼 오른쪽 위에 주황 점. 이때 `title`은 `표지 정보 — 비어 있는 칸: 이름, 학과`, `aria-label`은 `표지 정보 (빈 칸 있음)`. |
| 좁은 화면 | 760px 이하에서 막대가 두 줄로 접히고, 양식 `<select>`는 최대 150px로 줄어듭니다(글자는 브라우저가 자름). 인용 스타일 `<select>`는 지금 인라인 `max-width:190px` 그대로입니다. |

---

## 2. 내보내기 메뉴 · 확인 창 · 알림 (명세 11.3)

### 2.1 메뉴 문구 (`popupMenu` 그대로)

| label | sub (아랫줄) |
|---|---|
| `워드 (.docx)` | `양식: {양식 이름}` |
| `한글 (.hwpx)` | `양식: {양식 이름}` |
| `마크다운 (.md)` | `각주 포함 · 양식과 무관` |
| `-` | |
| `서식 그대로 복사` | `붙여넣기용` |

- `popupMenu`가 돌려주는 메뉴 요소에 **`export-menu` 클래스**를 붙여 주세요: `popupMenu(anchor, items).classList.add("export-menu")`. 폭 300px 메뉴에서 아랫줄 문구가 이름 **밑에** 한 줄로 나오고, 긴 양식 이름은 줄바꿈됩니다(다른 메뉴 모양은 그대로).

### 2.2 표지 정보가 빈 채로 내보낼 때 확인 창

`confirmDialog`는 버튼이 두 개뿐이라 `modal()`로 직접 만듭니다.

```html
<!-- body -->
<div>
  <p style="margin:4px 0 8px">표지 정보가 비어 있어요: 이름, 학과, 졸업 연월. 빈 칸은 ○○○로 들어가요.</p>
</div>
<!-- foot -->
<div style="display:contents">
  <button class="btn" data-no>취소</button>
  <button class="btn" data-go>그대로 내보내기</button>
  <button class="btn primary" data-cover>표지 정보 입력</button>
</div>
```

- 제목: `확인`. 열리면 **[표지 정보 입력]에 포커스**(Enter = 표지 정보 창 열기). Esc·[취소] = 내보내기 취소.
- 빈 칸 이름은 고정 순서: `국문 제목`(원고 제목도 없을 때만) · `이름` · `학과` · `졸업 연월`.

### 2.3 내보낸 뒤 알림 (토스트)

순서대로 띄웁니다. 경고가 여러 개면 한 토스트에 ` · `로 이어 붙입니다.
표시 시간: `toast`가 받게 될 선택 인자(개발팀이 `ui.js`에 추가)로 정합니다. **긴 안내는 8초**, 짧은 알림은 지금 기본값(보통 3.2초 · 오류 6초) 그대로입니다.

| 언제 | 문구 | 종류 | 표시 시간 |
|---|---|---|---|
| 성공(표지 없는 양식) | `워드 파일로 저장했어요` / `한글 파일로 저장했어요` (지금과 같음) | success | 기본 |
| 성공(표지 있는 양식) | `워드 파일로 저장했어요 · 목차는 워드(참조 → 목차) · 한글(도구 → 차례/색인)로 넣어 주세요` | success | **8초** |
| 응답 경고 `cover-missing:a,b` | `표지에 빈 칸이 있어 ○○○로 넣었어요: {항목 이름들}` | 보통 | **8초** |
| 응답 경고 `cover-overflow:front` | `표지 내용이 한 쪽을 넘을 수 있어요 ({쪽 이름})` | 보통 | **8초** |
| 그 밖의 경고 코드 | `내보내기 경고: {코드 원문}` | 보통 | **8초** |
| **워드(.docx)** + 양식 글꼴(본문·표지)에 한컴 글꼴이 있음 | `휴먼명조 같은 한컴 글꼴이 없는 PC의 워드에서는 비슷한 다른 글꼴로 보여요. 제출 파일은 한컴오피스가 설치된 PC에서 확인하세요` | 보통 · **세션마다 양식별 한 번** | **8초** |
| 양식 삭제(원고가 바뀐 경우) | `양식을 지웠어요 · 원고 n개를 기본 (A4)로 바꿨어요` | 보통 | **8초** |

- 정리하면 **한 문장을 넘는 안내·경고 토스트는 모두 8초**, 그 밖의 확인용 토스트(저장했어요 등)는 기본 시간입니다.

- 한컴 글꼴 목록(이름 포함 여부로 판단): `휴먼명조`, `HY신명조`, `신명조`, `신명 세명조`, `한양신명조`, `함초롬바탕`, `함초롬돋움`.
- 경고 코드 → 이름: 필드 `title_ko` 국문 제목 · `title_en` 영문 제목 · `name` 이름 · `department` 학과 · `graduation` 졸업 연월 · `approval` 인정 연월 · `advisors` 지도교수. 쪽 `front` 표지(보고서는 앞표지) · `inner` 속표지 · `approval` 인정서(보고서는 인준서).

---

## 3. 표지 정보 대화상자 (명세 11.2)

- `modal({ title: "표지 정보 — {양식 이름}", wide: true })` 후 `.modal`에 **`cover-modal`** 클래스를 더합니다(폭 980px).
- 학위논문(`thesis`)과 대체 보고서(`report`)가 같은 골격을 쓰고, `data-only="thesis"` 묶음은 보고서에서 `hidden`.

```
┌ 표지 정보 — 인하대 제조혁신전문대학원 학위논문 (석사·박사) ─────────────── ✕ ┐
│ ● 표시 칸이 비어 있으면 표지에 ○○○로 들어가요.        │ 문구 미리보기         │
│ 학위   [석사|박사]      학위명 [공학        ]           │ [표지][속표지][인정서] │
│                        공학 → 공학석사학위 논문         │ ┌────────────┐       │
│ 국문 제목 [스마트 제조 공정의 … (원고 제목)       ]     │ │공학석사학위 논문│       │
│ 영문 제목 [                     ] 부제 (선택) [     ]   │ │ 스마트 제조 …  │       │
│ 졸업 연월● [2027]년 [2월|8월|기타]                      │ │  A Study …    │       │
│ 인정 연월  2026년 12월 · 2월 졸업 → 전년 12월 □직접 입력 │ │  2027년 2월   │       │
│ 대학원 [인하대학교 제조혁신전문대학원]                  │ │      ⋮       │       │
│ 학과● [스마트제조공학과]   이름● [김인하] ☑글자 사이 띄우기 김 인 하 │ └────────────┘ │
│ 지도교수 [홍길동] □공동지도                              │                      │
│ 심사위원  주심 [   ] 부심 [   ] 위원 [   ]               │                      │
│ 넣을 쪽  ☑표지 ☑속표지 ☑인정서                          │                      │
├──────────────────────────────────────────────── [취소] [저장] ┤
```

### 3.1 골격

```html
<form class="cover-layout" data-cover-form autocomplete="off" novalidate>
  <div class="cover-form">
    <div class="status-line bad hidden" data-cover-error role="alert"></div>
    <p class="small muted" style="margin:0 0 10px"><span class="req-dot" aria-hidden="true"></span> 표시 칸이 비어 있으면 표지에 ○○○로 들어가요.</p>

    <div class="grid-2" data-only="thesis">
      <div class="field">
        <label id="cv-degree-l">학위</label>
        <div class="seg seg-radio" role="radiogroup" aria-labelledby="cv-degree-l" data-degree>
          <label><input type="radio" name="degree" value="master" checked><span>석사</span></label>
          <label><input type="radio" name="degree" value="doctor"><span>박사</span></label>
        </div>
      </div>
      <div class="field">
        <label for="cv-degree-field">학위명</label>
        <input class="input" id="cv-degree-field" name="degree_field" placeholder="공학">
        <div class="hint" data-degree-hint>공학 → 공학석사학위 논문</div>
      </div>
    </div>

    <div class="field">
      <label for="cv-title-ko">국문 제목</label>
      <input class="input" id="cv-title-ko" name="title_ko" placeholder="{원고 제목}">
      <div class="hint">비우면 원고 제목을 써요.</div>
    </div>
    <div class="grid-2">
      <div class="field"><label for="cv-title-en">영문 제목</label><input class="input" id="cv-title-en" name="title_en" placeholder="A Study on …"></div>
      <div class="field"><label for="cv-subtitle">부제 (선택)</label><input class="input" id="cv-subtitle" name="subtitle"><div class="hint">국문 제목 밑에 – 부제 – 로 들어가요.</div></div>
    </div>

    <div class="grid-2">
      <div class="field">
        <label id="cv-grad-l">졸업 연월<span class="req-dot" aria-hidden="true"></span></label>
        <div class="cover-ym" role="group" aria-labelledby="cv-grad-l">
          <input class="input cover-year" type="number" name="grad_year" min="2000" max="2100" inputmode="numeric" placeholder="2027" aria-label="졸업 연도"><span>년</span>
          <div class="seg seg-radio" role="radiogroup" aria-label="졸업 월" data-grad-month>
            <label><input type="radio" name="grad_month" value="2"><span>2월</span></label>
            <label><input type="radio" name="grad_month" value="8"><span>8월</span></label>
            <label><input type="radio" name="grad_month" value="other"><span>기타</span></label>
          </div>
          <select class="input hidden" name="grad_month_other" aria-label="졸업 월 (기타)">
            <option value="1">1월</option> … <option value="12">12월</option> <!-- 2·8 제외 -->
          </select>
        </div>
        <div class="hint hidden" data-grad-warn style="color:var(--warn)">2월·8월 졸업이 아니에요. 저장은 되지만 졸업 연월을 다시 확인해 주세요.</div>
      </div>
      <div class="field">
        <label id="cv-appr-l">인정 연월</label>
        <div class="cover-auto" data-approval-auto>2026년 12월 <span class="muted">· 2월 졸업 → 전년 12월</span></div>
        <div class="cover-ym hidden" role="group" aria-labelledby="cv-appr-l" data-approval-manual>
          <input class="input cover-year" type="number" name="approval_year" min="2000" max="2100" inputmode="numeric" aria-label="인정 연도"><span>년</span>
          <select class="input" name="approval_month" aria-label="인정 월"><option value="1">1월</option> … <option value="12">12월</option></select>
        </div>
        <div class="fmt-checks" style="margin:0"><label class="check"><input type="checkbox" name="approval_manual"> 직접 입력</label></div>
      </div>
    </div>

    <div class="field"><label for="cv-school">대학원</label><input class="input" id="cv-school" name="school" value="인하대학교 제조혁신전문대학원"></div>
    <div class="grid-2">
      <div class="field"><label for="cv-dept">학과<span class="req-dot" aria-hidden="true"></span></label><input class="input" id="cv-dept" name="department" placeholder="스마트제조공학과"></div>
      <div class="field">
        <label for="cv-name">이름<span class="req-dot" aria-hidden="true"></span></label>
        <input class="input" id="cv-name" name="name" placeholder="김인하">
        <div class="fmt-checks" style="margin:0"><label class="check"><input type="checkbox" name="spaced_name" checked> 글자 사이 띄우기 <span class="name-preview" data-name-preview>김 인 하</span></label></div>
      </div>
    </div>

    <div class="field">
      <label for="cv-adv1" data-adv-label>지도교수</label>
      <div class="row">
        <input class="input grow" id="cv-adv1" name="advisor_1" placeholder="홍길동">
        <label class="check"><input type="checkbox" name="co_advised"> 공동지도</label>
      </div>
      <input class="input hidden" name="advisor_2" placeholder="두 번째 지도교수" aria-label="공동지도교수 2" style="margin-top:6px">
      <div class="hint hidden" data-adv-hint>두 줄 모두 ‘공동지도교수 ○○○’로 들어가요.</div>
    </div>

    <fieldset class="cover-committee" data-committee>
      <legend>심사위원</legend>
      <div class="cover-members">
        <div class="cover-member"><label class="cover-role" for="cv-cm-0">주심</label><input class="input" id="cv-cm-0" name="committee" data-i="0"></div>
        <div class="cover-member"><label class="cover-role" for="cv-cm-1">부심</label><input class="input" id="cv-cm-1" name="committee" data-i="1"></div>
        <div class="cover-member"><label class="cover-role" for="cv-cm-2">위원</label><input class="input" id="cv-cm-2" name="committee" data-i="2"></div>
        <!-- 박사: 위원 칸 2개 더 (cv-cm-3, cv-cm-4) -->
      </div>
      <div class="hint">비워 두면 직함만 들어가요.</div>
    </fieldset>

    <fieldset class="cover-include">
      <legend>넣을 쪽</legend>
      <div class="fmt-checks">
        <label class="check"><input type="checkbox" name="include_front" checked> 표지</label>
        <label class="check"><input type="checkbox" name="include_inner" checked> 속표지</label>
        <label class="check"><input type="checkbox" name="include_approval" checked> 인정서</label>
      </div>
    </fieldset>
  </div>

  <aside class="cover-preview" aria-label="문구 미리보기">
    <div class="cover-preview-head">
      <span class="cover-preview-title">문구 미리보기</span>
      <div class="seg" data-cover-tabs>
        <button type="button" data-page="front" aria-pressed="true" class="active">표지</button>
        <button type="button" data-page="inner" aria-pressed="false">속표지</button>
        <button type="button" data-page="approval" aria-pressed="false">인정서</button>
      </div>
    </div>
    <div class="cover-sheet is-bold" data-cover-sheet style="--ar: 188 / 257; --cover-font: 'HY신명조', '바탕', serif">
      <p class="cover-line" style="--pt:14">공학석사학위 논문</p>
      <div class="cover-gap lg"></div>
      <p class="cover-line" style="--pt:16">스마트 제조 공정의 품질 예측 연구</p>
      <div class="cover-gap"></div>
      <p class="cover-line" style="--pt:16">A Study on …</p>
      <div class="cover-gap lg"></div>
      <p class="cover-line" style="--pt:14">2027년 2월</p>
      <div class="cover-fill"></div>
      <p class="cover-line" style="--pt:14">인하대학교 제조혁신전문대학원</p>
      <div class="cover-gap"></div>
      <p class="cover-line" style="--pt:14"><span class="ph">○○○학과</span></p>
      <div class="cover-gap"></div>
      <p class="cover-line" style="--pt:14"><span class="ph">○○○</span></p>
    </div>
    <div class="small muted">줄 순서와 글자 크기 비율만 보여 줘요. 실제 위치는 내보낸 파일에서 확인하세요.</div>
  </aside>
</form>
<!-- foot -->
<div style="display:contents"><button class="btn" data-no>취소</button><button class="btn primary" data-save>저장</button></div>
```

### 3.2 동작 · 상태

| 항목 | 정한 것 |
|---|---|
| 학위 종류 | `thesis`만 보임. 박사로 바꾸면 심사위원에 `위원` 칸 2개를 더하고(이미 쓴 값 유지), 석사로 돌아가면 4·5번째 칸을 지웁니다(값은 창을 닫기 전까지 기억). 보고서는 항상 3칸. |
| 학위명 도움말 | 입력할 때마다 `[data-degree-hint]`를 `{학위명}{석사/박사}학위 논문`으로. 비면 `석사학위 논문`. |
| 졸업 월 `기타` | 월 선택 `<select>`가 나타나고 `[data-grad-warn]` 경고 표시. |
| 인정 연월 | 기본은 자동 표시(`.cover-auto`). 2월 → `{전년} 12월 · 2월 졸업 → 전년 12월`, 8월 → `{같은 해} 6월 · 8월 졸업 → 6월`. 기타 달이거나 졸업 연도가 비었으면 `.cover-auto`에 **`is-warn`** 클래스 + 문구 `자동으로 정할 수 없어요. 직접 입력해 주세요.` 그리고 [직접 입력]을 자동으로 켭니다. [직접 입력]을 켜면 `[data-approval-manual]`이 보이고 자동 표시는 숨깁니다. 끄면 `approval`을 빈 값으로 저장(자동). |
| 이름 띄우기 | `[data-name-preview]`에 결과(예 `김 인 하`). 규칙(공백 없는 한글 2~5자)에 맞지 않으면 `그대로 들어가요`. |
| 공동지도 | 켜면 두 번째 칸·`[data-adv-hint]`가 보이고 라벨 `[data-adv-label]`이 `공동지도교수`로 바뀝니다. |
| 넣을 쪽 | 보고서는 라벨을 `앞표지` · `속표지` · `인준서`로(**확정** — 미리보기 탭·내보내기 경고의 쪽 이름도 같음). 끈 쪽은 미리보기 탭은 남기고 종이에 `is-off` 클래스(흐리게). |
| 미리보기 | 입력할 때마다(지연 없이) 지금 탭의 줄을 다시 그립니다. 탭은 표지/속표지/인정서(보고서 앞표지/속표지/인준서). **입력 칸에 포커스가 가면 관련 쪽으로 탭을 옮겨** 주세요(지도교수 → 속표지, 심사위원·인정 연월 → 인정서, 나머지 → 지금 탭 유지). 줄은 명세 6.3·6.4의 순서·크기(`--pt`)대로, "채움" 자리에 `.cover-fill`, 간격 10mm 이하는 `.cover-gap`, 15mm 이상은 `.cover-gap.lg`. 빈 값 자리표시(○○○ 등)는 `<span class="ph">`로 감쌉니다. 종이 비율 `--ar`는 양식 용지(학위논문 `188 / 257`, 보고서 `210 / 297`), 글꼴 `--cover-font`는 표지 글꼴(`--doc-font`와 같은 규칙: **영문 → 한글** → 대체 목록), `cover.bold`면 `is-bold`. |
| 저장 | [저장] 또는 입력 칸에서 Enter → `PATCH {cover}`. 버튼은 `disabled` + 글자 `<span class="spinner"></span> 저장 중`. 성공: 창 닫기 + 토스트 `표지 정보를 저장했어요`(success) + 상단 막대 점 갱신. 400: `[data-cover-error]`에 서버 `detail`을 보이고 창 유지. |
| 키보드 | 열리면 첫 텍스트 칸(학위명 또는 국문 제목)에 포커스(기존 `modal()` 동작). 라디오 묶음은 ←/→. Esc = 취소(저장 안 함). |

---

## 4. 양식 관리 대화상자 (명세 11.4)

- `modal({ title: "논문 양식", wide: true })` 후 `.modal`에 **`fmt-modal`** 클래스(폭 1080px, 높이 820px 고정 — 안쪽 두 칸이 각자 스크롤).
- 여는 곳: 상단 막대 양식 선택의 "양식 관리…", 설정 창의 [양식 관리…].

```
┌ 논문 양식 ───────────────────────────────────────────────────────────── ✕ ┐
│ [＋ 새 양식 ▾] [양식 파일 가져오기] │ 인하대 … 학위논문 (석사·박사) [기본] [표지: 학위논문] │
│ 기본 양식                          │                        [복사해서 내 양식 만들기] │
│ ▸ 기본 (A4)               기본     │ (용지·여백)(글꼴)(본문)(논문 제목)(제목 수준)…     │
│ ▸ 영문 원고 (APA 7 …)      기본     │──────────────────────────────────────────────────│
│ ■ 인하대 … 학위논문         기본     │ 🔒 기본 양식은 바꿀 수 없어요. …                 │
│ ▸ 인하대 … 대체 보고서      기본     │ ┌ 근거 설명 ───────────────────────────────┐    │
│ 내 양식                      1/50  │ │ ‘학위청구 논문 작성 안내’ 기준이에요. …     │    │
│ ▸ 내 학위논문 (12pt) •             │ └──────────────────────────────────────────┘    │
│ ┌ 양식 파일을 끌어다 놓거나 ┐       │ 용지·여백                                       │
│ │ [파일 고르기] .docx .dotx .hwpx │ │ 용지 [4×6배판 (188×257) ▾] 폭 [188]mm 높이 [257]mm│
│ └─────────────────┘       │ …                                               │
├──────────────────────────────────────────────── 저장 안 한 변경이 있어요 [닫기] [저장] ┤
```

### 4.1 골격

```html
<div class="fmt-layout" data-fmt>
  <!-- 왼쪽: 목록 -->
  <div class="fmt-side">
    <div class="fmt-side-actions">
      <span class="menu-wrap"><button type="button" class="btn sm" data-fmt-new>＋ 새 양식 ▾</button></span>
      <button type="button" class="btn sm" data-fmt-import>양식 파일 가져오기</button>
    </div>
    <div class="fmt-list" data-fmt-list role="list" aria-label="양식 목록">
      <div class="fmt-group-title">기본 양식</div>
      <button type="button" class="fmt-item" role="listitem" data-id="default" aria-current="false">
        <span class="fmt-item-name"><span>기본 (A4)</span><span class="chip">기본</span></span>
        <span class="fmt-item-sub">지금까지의 내보내기 서식 (A4, 바탕/Times New Roman 11pt)</span>
      </button>
      … (기본 양식 4개)
      <div class="fmt-group-title">내 양식 <span data-fmt-count>1/50</span></div>
      <!-- 가져온 양식(저장 전)이 있으면 맨 위에 -->
      <button type="button" class="fmt-item is-draft" role="listitem" data-id="__draft" aria-current="true">
        <span class="fmt-item-name"><span>학위논문양식</span><span class="chip warn">저장 전</span></span>
        <span class="fmt-item-sub">학위논문양식.dotx에서 가져옴</span>
      </button>
      <button type="button" class="fmt-item is-dirty" role="listitem" data-id="user-3" aria-current="false">
        <span class="fmt-item-name"><span>내 학위논문 (12pt)</span></span>
        <span class="fmt-item-sub">인하대 … 학위논문에서 복사 · 10월 6일 수정</span>
      </button>
      <!-- 내 양식이 없을 때 -->
      <div class="fmt-empty">아직 내 양식이 없어요. 기본 양식을 고르고 [복사해서 내 양식 만들기]를 누르거나, 학과 양식 파일을 가져오세요.</div>
    </div>
    <div class="fmt-drop" data-fmt-drop>
      양식 파일을 여기에 끌어다 놓거나 <button type="button" class="btn sm" data-fmt-pick>파일 고르기</button>
      <div class="small">.docx · .dotx · .hwpx (20MB 이하)</div>
    </div>
  </div>

  <!-- 오른쪽: 고른 양식 -->
  <div class="fmt-main" data-fmt-main>
    <div class="fmt-head">
      <h4 class="fmt-title" data-fmt-title>인하대 제조혁신전문대학원 학위논문 (석사·박사)</h4>
      <!-- 가져온 양식(저장 전)일 때는 h4 대신: -->
      <!-- <input class="input fmt-name-input" data-fmt-name maxlength="60" aria-label="양식 이름" value="학위논문양식"> -->
      <span class="chip">기본</span> <span class="chip accent">표지: 학위논문</span>
      <div class="fmt-head-actions">
        <!-- 기본 양식 --> <button type="button" class="btn sm primary" data-fmt-copy>복사해서 내 양식 만들기</button>
        <!-- 내 양식 --> <button type="button" class="btn sm" data-fmt-rename>이름 바꾸기</button>
                         <button type="button" class="btn sm ghost danger" data-fmt-delete>삭제</button>
      </div>
      <nav class="fmt-nav" aria-label="항목 묶음으로 이동">
        <button type="button" data-jump="page">용지·여백</button>
        <button type="button" data-jump="fonts">글꼴</button>
        <button type="button" data-jump="body">본문</button>
        <button type="button" data-jump="title">논문 제목</button>
        <button type="button" data-jump="headings">제목 수준</button>
        <button type="button" data-jump="quote">인용문</button>
        <button type="button" data-jump="footnote">각주</button>
        <button type="button" data-jump="bibliography">참고문헌</button>
        <button type="button" data-jump="page_number">쪽 번호</button>
        <button type="button" data-jump="cover">표지</button>
      </nav>
    </div>

    <div class="fmt-content">
      <!-- 기본 양식일 때 -->
      <div class="status-line fmt-lock">기본 양식은 바꿀 수 없어요. [복사해서 내 양식 만들기]로 내 양식을 만든 뒤 고쳐 쓰세요.</div>
      <div class="fmt-note" data-fmt-note>… 4.4절 문구 …</div>

      <!-- 가져온 양식일 때 (4.6절) -->
      <div class="fmt-import" data-fmt-import-info>…</div>

      <form class="fmt-form is-readonly" data-fmt-form autocomplete="off" novalidate>
        <fieldset class="fmt-fields" disabled>   <!-- 기본 양식: disabled, 내 양식·가져온 양식: disabled 없음 -->
          … 4.3절 묶음 10개 …
        </fieldset>
      </form>
    </div>
  </div>
</div>
<!-- foot -->
<div style="display:contents">
  <div class="left"><span class="fmt-foot-status" data-fmt-status aria-live="polite"></span></div>
  <button class="btn" data-no>닫기</button>                     <!-- 가져온 양식일 때 글자: 취소 -->
  <button class="btn primary" data-fmt-save disabled>저장</button> <!-- 기본 양식일 때 hidden -->
</div>
```

### 4.2 입력 칸 한 개의 골격 (모든 묶음 공통)

```html
<!-- 숫자 + 단위 꼬리표 -->
<div class="field fmt-field" data-field="body.size_pt">
  <label for="f-body-size_pt">글자 크기 <span class="fmt-origin" data-origin="file">파일에서 읽음</span></label>
  <div class="fmt-num">
    <input class="input" id="f-body-size_pt" type="number" data-path="body.size_pt" min="5" max="72" step="0.5" inputmode="decimal">
    <span class="fmt-unit">pt</span>
  </div>
  <div class="fmt-err" hidden></div>
</div>

<!-- 길이 (글자 / mm) -->
<div class="field fmt-field" data-field="body.first_line_indent">
  <label for="f-body-first_line_indent">첫 줄 들여쓰기</label>
  <div class="fmt-len">
    <input class="input" id="f-body-first_line_indent" type="number" data-path="body.first_line_indent.value" step="0.1" inputmode="decimal">
    <select class="input" data-path="body.first_line_indent.unit" aria-label="첫 줄 들여쓰기 단위">
      <option value="ch">글자</option><option value="mm">mm</option>
    </select>
  </div>
  <div class="fmt-err" hidden></div>
</div>

<!-- 정렬 -->
<div class="field fmt-field" data-field="body.align">
  <label for="f-body-align">정렬</label>
  <select class="input" id="f-body-align" data-path="body.align">
    <option value="justify">양쪽 정렬</option><option value="left">왼쪽</option>
    <option value="center">가운데</option><option value="right">오른쪽</option>
  </select>
</div>

<!-- 체크 묶음 (그리드 한 칸을 차지) -->
<div class="fmt-checks">
  <label class="check"><input type="checkbox" data-path="headings.1.bold"> 굵게</label>
  <label class="check"><input type="checkbox" data-path="headings.1.italic"> 기울임</label>
  <label class="check"><input type="checkbox" data-path="headings.1.page_break_before"> 새 쪽에서 시작</label>
</div>
```

- `id` 규칙: `f-` + 경로의 `.`을 `-`로(예 `f-headings-1-size_pt`).
- `data-path`는 명세 4.2의 JSON 경로 그대로. 서버 400의 `detail`에 들어 있는 경로로 `[data-path="…"]`를 찾아 표시합니다(4.7절).
- **화면에 없는 값**(제목 수준의 `fonts` · `line_spacing_pct` · 들여쓰기, `gutter_mm` 등)은 저장할 때 **불러온 `data`에 폼 값을 덮어써서** 그대로 보존해 주세요. 폼에서 `data`를 새로 만들면 안 됩니다.
- 비어 있어도 되는 칸(`line_spacing_pct: null`)은 빈 칸 + `placeholder="본문과 같게"`. 빈 칸 → `null`.

### 4.3 항목 묶음 10개

각 묶음은 `<fieldset class="fmt-sec" data-sec="{키}" id="fmt-sec-{키}"><legend class="fmt-sec-title">{이름}</legend> … </fieldset>`. 안의 칸들은 `<div class="fmt-grid">`(자동 2~4열, 560px 이하 한 열)에 넣습니다.

| # | `data-sec` | 이름 | 칸 (라벨 · 단위 · 범위) | 도움말 `.fmt-sec-help` |
|---|---|---|---|---|
| ① | `page` | 용지·여백 | **용지** `<select data-paper-preset>`: `A4 (210×297)` · `4×6배판 (188×257)` · `Letter (216×279)` · `직접 입력` / **폭** `page.width_mm` mm 50~500 · **높이** `page.height_mm` mm 50~500 / (`.fmt-grid.cols-2`로) **위쪽** `page.margin_mm.top` · **머리말** `page.header_mm` · **아래쪽** `page.margin_mm.bottom` · **꼬리말** `page.footer_mm` · **왼쪽** `page.margin_mm.left` · **오른쪽** `page.margin_mm.right` — 모두 mm **0~100**, step 0.1 | `한글 ‘편집 용지’와 같은 뜻이에요. 워드에서는 위 여백 = 위쪽 + 머리말로 바뀌어 들어가요.` 그 아래 `<div class="hint" data-word-hint>`에 실시간 계산: `워드에서는 위 여백 20mm · 머리글 거리 15mm, 아래 여백 29mm · 바닥글 거리 21mm로 들어가요.` |
| ② | `fonts` | 글꼴 | **한글** `fonts.hangul` · **영문** `fonts.latin` · **한자** `fonts.hanja` — `<input class="input" list="fmt-font-list">` | (항상 표시, `.fmt-help`) 명세 11.4 글꼴 도움말 원문. 학위논문 기본 양식이면 묶음 제목 옆에 `<span class="chip">안내에 명시 없음, 휴먼명조로 통일</span>` |
| ③ | `body` | 본문 | 글자 크기 pt 5~72 step 0.5 · 줄간격 % 50~500 step 1 · 정렬 · 첫 줄 들여쓰기(글자/mm, **-50~100mm**) · 문단 위 pt · 문단 아래 pt(각각 **0~100mm 환산 범위**, step 0.5) — 범위는 4.7절 | `목록·표도 본문 글꼴·크기·줄간격을 따라요.` |
| ④ | `title` | 논문 제목 | 체크 `title.show` **본문 첫머리에 넣기** · 글자 크기 · 정렬 · 굵게/기울임 · 문단 위 · 문단 아래 | `# 으로 쓴 제목이에요. 끄면 본문에는 넣지 않고 표지의 국문 제목으로만 써요.` |
| ⑤ | `headings` | 제목 수준 | 세 칸을 `<div class="fmt-sub" data-level="1|2|3">`로: 제목 `제목 1수준 · 장 (##)` / `제목 2수준 · 절 (###)` / `제목 3수준 · 항 (####)`. 각각 글자 크기 · 정렬 · 굵게/기울임/새 쪽에서 시작 · 문단 위 · 문단 아래 | `####` 이하는 모두 3수준 모양을 써요. |
| ⑥ | `quote` | 인용문 | 글자 크기 · 줄간격(빈 칸 = 본문과 같게) · 정렬 · 왼쪽 들여쓰기(글자/mm) · 오른쪽 들여쓰기(글자/mm) | `> 로 쓴 인용문 블록이에요.` |
| ⑦ | `footnote` | 각주 | 글자 크기 · 줄간격 | `각주는 크기와 줄간격만 써요.` |
| ⑧ | `bibliography` | 참고문헌 | 글자 크기 · 줄간격 · 정렬 · 내어쓰기 폭(글자/mm) · 체크 `bibliography.new_page` **새 쪽에서 시작** | `참고문헌 제목은 제목 1수준 모양을 써요. 번호식 인용 스타일은 내어쓰기를 하지 않아요.` |
| ⑨ | `page_number` | 쪽 번호 | 체크 `page_number.show` **쪽 번호 넣기** · 위치 `page_number.position`(`꼬리말 가운데` footer-center · `꼬리말 오른쪽` footer-right · `머리말 가운데` header-center · `머리말 오른쪽` header-right) · 시작 `page_number.start`(`본문 첫 쪽부터` document · `첫 장(##)부터 1쪽` first_chapter) · 체크 `page_number.dashes` **번호 양옆에 줄표 (- 1 -)**. `show`를 끄면 나머지 칸 `disabled` | `표지·속표지·인정서에는 쪽 번호가 없고 쪽 수에도 세지 않아요. 글자 모양은 본문과 같아요.` |
| ⑩ | `cover` | 표지 | 종류 `cover.kind`(`표지 없음` none · `학위논문 (표지 · 속표지 · 인정서)` thesis · `대체 보고서 (앞표지 · 속표지 · 인준서)` report) · 체크 **본문 글꼴과 같게**(켜면 `cover.fonts = null`, 아래 세 칸 `disabled`) · 표지 한글/영문/한자 글꼴(`cover.fonts.*`, 글꼴 목록 사용) · 체크 `cover.bold` **굵게**. 종류가 `none`이면 나머지 칸 `disabled` | `줄 위치와 크기는 표지 종류에 맞춰 정해져 있어요. 학위·이름 같은 내용은 원고 편집 화면의 [표지 정보]에서 넣어요.` |

글꼴 추천 목록(창 안에 한 번만):

```html
<datalist id="fmt-font-list">
  <option value="휴먼명조"><option value="HY신명조"><option value="신명조"><option value="신명 세명조">
  <option value="바탕"><option value="함초롬바탕"><option value="Times New Roman"><option value="맑은 고딕">
</datalist>
```

용지 선택: 폭·높이를 직접 고치면 맞는 항목이 있으면 그것으로, 없으면 `직접 입력`으로 자동 전환. Letter는 215.9×279.4로 넣습니다.

### 4.4 기본 양식 근거 설명 (`.fmt-note` 문구 — 확정)

```html
<div class="fmt-note"><b>…첫 문장…</b><ul><li>…</li></ul></div>
```

- **기본 (A4)**: **지금까지의 내보내기 서식이에요.** · 한글 파일은 지금처럼 한글 기본 서식(10pt 등)으로 나가요. 이 값을 한글에도 그대로 쓰려면 복사해서 내 양식으로 쓰세요. · 복사본은 워드 줄간격이 고정값으로 들어가요.
- **영문 원고 (APA 7 학생 논문)**: **APA 7판 학생 논문 규칙 중 확인할 수 있는 것만 넣었어요.** · 용지는 A4로 두었어요(APA는 미국 Letter 기준이지만 용지 크기를 규칙으로 정하지 않아요). · 한글·한자 글꼴 ‘바탕’은 APA에 규정이 없어 임시로 정한 값이에요. · 제목 쪽(표지)과 4·5수준 제목은 넣지 않아요.
- **인하대 학위논문**: **‘학위청구 논문 작성 안내’ 기준이에요.** · 안내문에 "내용 편집과 관련한 대학원규정은 없으므로 학과내규 또는 전공학회 편집규정을 참조"라고 되어 있어 본문 서식은 권장값이에요. 복사해서 고칠 수 있어요. · 인쇄: 4×6배판 188×257mm, 모조지 70g 이상, 소프트커버 회색 레자크, 무선제본. · 본문 글꼴은 안내에 명시가 없어 휴먼명조로 통일했어요. · 인용문은 한 탭(40pt) 들여쓰기예요. · 쪽 번호(꼬리말 가운데, 첫 장부터 1쪽)는 학과 확인 중이에요. 양식 설정에서 바꿀 수 있어요. · 안내문에 없어 임시로 정한 값: 문단 위·아래 간격, 장 제목 가운데·새 쪽, 제목 3수준, 참고문헌 내어쓰기·새 쪽.
- **인하대 대체 보고서**: **‘석사학위논문 대체 보고서(산학공동연구결과보고서)’ 안내 기준이에요.** · 순서: 앞표지 → 속표지 → 인준서 → 목차 → 본문 → 참고문헌 → 부록(선택). 목차는 워드(참조 → 목차) · 한글(도구 → 차례/색인)로 넣어 주세요. · 분량 30쪽 이상, 서론 · 본론 · 결론 순이에요(PaperLab이 검사하지는 않아요). · 본문 11pt · 180%는 안내 범위(10~12pt · 175~185%) 중 기본값이에요. · 쪽 번호 위치(꼬리여백 11mm)는 학과 확인 중이에요. 양식 설정에서 바꿀 수 있어요. · 안내문에 없어 임시로 정한 값: 첫 줄 들여쓰기·정렬, 제목 굵게, 인용문, 참고문헌, 표지 글꼴.

### 4.5 목록 · 만들기 · 이름 바꾸기 · 삭제

| 동작 | 정한 것 |
|---|---|
| 처음 열 때 | 원고 화면에서 열었으면 그 원고의 양식, 설정에서 열었으면 `doc_format_default`를 고른 상태로. |
| 목록 항목 | `aria-current="true"` = 지금 고른 것. 저장 안 한 변경이 있는 항목은 `is-dirty`(이름 뒤 주황 점). 내 양식 sub = `{base 이름}에서 복사 · {수정 날짜(fmtDate)} 수정`, 기본 양식 sub = `description`. |
| ＋ 새 양식 ▾ | `popupMenu`(left): 기본 양식 4개, label = 양식 이름, sub = `표지 없음` / `학위논문 표지` / `보고서 표지`. 고르면 `promptDialog("새 양식 이름", { value: "{이름} 복사본", ok: "만들기" })` → `POST` → 목록 새로 그리고 새 양식 선택 → 토스트 `‘{이름}’ 양식을 만들었어요`(success). |
| 복사해서 내 양식 만들기 | 위와 같은 흐름(base = 지금 기본 양식). |
| 50개 제한 | 내 양식 50개면 [＋ 새 양식] · [양식 파일 가져오기] · [복사해서 내 양식 만들기] `disabled`, `title="내 양식은 50개까지 만들 수 있어요"`. |
| 이름 바꾸기 | `promptDialog("양식 이름 바꾸기", { value, ok: "바꾸기" })` → `PATCH {name}` → 토스트 `이름을 바꿨어요`. 비었거나 60자 초과는 `toast("이름은 1~60자로 적어 주세요", "error")`. |
| 삭제 | `confirmDialog("'{이름}' 양식을 지울까요? 이 양식을 쓰는 원고 n개는 기본 (A4)로 바뀌어요.", { ok: "삭제", danger: true })`. **n = 목록 응답(`GET /api/doc-formats`) 각 양식에 붙는 `used_by`**(이 양식을 쓰는 원고 수, 정수 — 팀장 결정으로 API에 추가). 확인 창을 열기 직전에 목록을 다시 받아 최신 값을 씁니다. n이 0이면 `"'{이름}' 양식을 지울까요? 되돌릴 수 없어요."`. 지운 뒤 목록 첫 항목(기본 (A4)) 선택, 토스트 `양식을 지웠어요` (+ `reset_manuscripts > 0`이면 ` · 원고 {n}개를 기본 (A4)로 바꿨어요`). |
| 저장 | 내 양식에서 칸을 고치면 `is-dirty` + 바닥 상태 `저장 안 한 변경이 있어요`(`.fmt-foot-status.is-dirty`) + [저장] 활성. 저장 중 버튼 `<span class="spinner"></span> 저장 중`. 성공: 상태 `저장했어요`, 토스트 없음. |
| 저장 안 한 변경 | 다른 양식을 고르거나 창을 닫을 때(✕·[닫기]·Esc·바깥 클릭) `confirmDialog("저장하지 않은 변경이 있어요. 버리고 계속할까요?", { ok: "버리기", danger: true })`. |

### 4.6 양식 파일 가져오기

| 단계 | 화면 |
|---|---|
| 고르기 | [양식 파일 가져오기]·[파일 고르기] → `pickFiles({ accept: ".docx,.dotx,.hwpx" })`. 또는 `.fmt-drop`에 끌어다 놓기(놓을 수 있는 동안 `.fmt-drop.is-over`). 다른 확장자는 업로드하지 않고 `toast("워드는 .docx나 .dotx로, 한글은 .hwpx로 저장해서 올려 주세요", "error")`. |
| 읽는 중 | 오른쪽 `.fmt-main` 전체를 `<div class="fmt-loading"><span class="spinner"></span> ‘{파일 이름}’에서 서식을 읽는 중…</div>`로. 왼쪽 버튼들 `disabled`. |
| 실패 | 오른쪽에 `<div class="fmt-content"><div class="status-line bad">{서버 detail}</div><button class="btn sm" data-fmt-pick>다른 파일 고르기</button></div>`. 이전에 보던 양식은 목록에서 다시 누르면 열립니다. |
| 확인·수정 | 목록 "내 양식" 맨 위에 `is-draft` 항목(`저장 전`), 오른쪽은 이름 입력 칸(`.fmt-name-input`, 값 = `suggested_name`) + 칩 `<span class="chip warn">가져온 양식 (저장 전)</span>` + 아래 정보 상자 + 수정 가능한 폼. 각 칸 라벨에 `.fmt-origin`: `data-origin="file"` **파일에서 읽음**, `data-origin="default"` **기본값**. |
| 저장 / 취소 | 바닥 [저장] → `POST {base, name, data}` → `is-draft` 항목이 진짜 내 양식으로 바뀌고 토스트 `가져온 양식을 저장했어요`(success). 바닥 [취소](가져온 양식일 때 [닫기] 대신) → 확인 없이 버리고 직전에 보던 양식으로. |

정보 상자:

```html
<div class="fmt-import" data-fmt-import-info>
  <div class="status-line ok">‘학위논문양식.dotx’에서 12개 항목을 읽었어요. 읽지 못한 항목은 ‘기본 (A4)’ 값으로 채웠어요.</div>
  <div class="fmt-import-row">
    <label for="fmt-import-base" class="small">빈 칸을 채울 기본 양식</label>
    <select class="input" id="fmt-import-base" data-import-base>…기본 양식 4개…</select>
  </div>
  <div class="small muted">기본값으로 채운 묶음: <span class="chips" data-import-missing><span class="chip">논문 제목</span><span class="chip">인용문</span>…</span></div>
  <div class="status-line bad fmt-warnings" data-import-warnings><ul><li>Normal 스타일 줄간격이 ‘고정값’이라 %로 바꿔 근사했어요</li></ul></div>
  <div class="small muted">학과 양식 파일의 사용자 정의 스타일(예: ‘장제목’)은 읽지 않아요. 필요한 값은 아래에서 직접 고쳐 주세요.</div>
</div>
```

- `found`가 0개면 첫 줄을 `status-line bad`로: `‘{파일}’에서 읽을 수 있는 서식을 찾지 못했어요. 모든 칸을 ‘{base 이름}’ 값으로 채웠어요.`
- `warnings`가 없으면 `[data-import-warnings]`는 `hidden`.
- 빈 칸 기본 양식을 바꾸면 **같은 파일을 `base`와 함께 다시 올려** 결과를 새로 받습니다(사용자가 고친 칸은 다시 덮어써지므로, 고친 칸이 있으면 `confirmDialog("고친 칸이 다시 바뀌어요. 계속할까요?")`).
- `missing` 경로 → 묶음 이름: `page` 용지·여백 · `fonts` 글꼴 · `body` 본문 · `title` 논문 제목 · `headings.1/2/3` 제목 1/2/3수준 · `quote` 인용문 · `footnote` 각주 · `bibliography` 참고문헌 · `page_number` 쪽 번호 · `cover` 표지. 더 깊은 경로는 그 칸의 라벨 글자를 씁니다.
- 칸별 출처 판단: 칸의 경로가 `found`에 있거나 `found`의 어떤 경로가 `칸경로.`로 시작하면 `file`, 그 밖은 `default`.

### 4.7 오류 표시

- **길이 허용 범위(팀장 결정)** — 단위가 pt·글자(ch)인 칸은 **mm로 바꾼 뒤** 같은 범위로 검사합니다(1pt = 25.4/72mm, 1글자 = 그 문단 글자 크기 pt).

  | 칸 | 범위 | 오류 문구 (`.fmt-err`) |
  |---|---|---|
  | 여백(위쪽·아래쪽·왼쪽·오른쪽) · 머리말 · 꼬리말 | 0~100mm | `0~100mm 사이로 입력해 주세요` |
  | 문단 위 · 문단 아래 간격 (pt) | 0~100mm (≈ 0~283.5pt) | `0~100mm(약 283pt) 사이로 입력해 주세요` |
  | 첫 줄 들여쓰기 · 인용문 왼쪽/오른쪽 들여쓰기 · 참고문헌 내어쓰기 (글자/mm) | -50~100mm | 단위가 mm면 `-50~100mm 사이로 입력해 주세요`, 글자면 `-50~100mm 사이가 되도록 입력해 주세요 (지금 {n}mm)` |
  | 용지 폭·높이 | 50~500mm | `50~500mm 사이로 입력해 주세요` |
  | 글자 크기 | 5~72pt | `5~72pt 사이로 입력해 주세요` |
  | 줄간격 | 50~500% | `50~500% 사이로 입력해 주세요` |

  mm 단위 칸은 `<input>`에 `min`/`max`를 그대로 넣고, pt·글자 칸은 환산이 필요하므로 화면 코드에서 검사합니다. 서버 400의 `detail`이 오면 그 문구를 그대로 보여 줍니다.
- 입력 칸 검사(위 범위·빈 값) 또는 서버 400 → 해당 `.fmt-field`에 `is-invalid`, 그 안 `.fmt-err`에 문구(서버 `detail` 그대로, 예 `5~72 사이로 입력해 주세요`), 입력에 `aria-invalid="true"` + `aria-describedby`(오류 id). 첫 오류 칸으로 스크롤·포커스. 바닥 상태 `고칠 칸이 있어요`.
- 목록·양식 불러오기 실패: 해당 칸에 `<div class="status-line bad">양식을 불러오지 못했어요: {detail}</div> <button class="btn sm" data-fmt-retry>다시 시도</button>`.
- 처음 열 때(목록 받는 중): 왼쪽 목록에 `<div class="fmt-loading"><span class="spinner"></span> 불러오는 중…</div>`.

### 4.8 키보드

| 키 | 동작 |
|---|---|
| Tab | 왼쪽 버튼 → 목록 → 끌어 놓기 상자 → 오른쪽 머리(이름·버튼·묶음 이동) → 폼 → 바닥 버튼 |
| ↑ / ↓ (목록 안) | 이전/다음 양식 항목으로 포커스 이동(Home/End = 처음/끝). Enter/Space = 열기 |
| 묶음 이동 버튼 | 누르면 그 `fieldset`으로 스크롤하고 첫 입력 칸에 포커스 |
| Ctrl+S | 저장(내 양식·가져온 양식일 때) — 브라우저 저장 창은 막음 |
| Esc | 창 닫기(변경 있으면 확인 창) |

- 기본 양식은 `fieldset disabled`라 칸에 포커스가 가지 않습니다. 값은 흐리지 않게 보이도록 CSS 처리했습니다.
- 끌어다 놓기: `app.js`의 창 전체 끌어 놓기(PDF·워드 인용 넣기)와 겹치지 않도록, **양식 관리 창의 `.modal-backdrop`에서 `dragenter`·`dragover`·`dragleave`·`drop`을 받아 `stopPropagation()`** 해 주세요(그래야 "PDF를 놓으면…" 덮개가 뜨지 않고 원고 화면에서 인용 넣기 창이 열리지 않습니다).

---

## 5. 설정 창 "논문 양식" 구역 (명세 11.4)

"인용" 구역 다음, "논문 검색 데이터베이스" 앞에 넣습니다.

```html
<div class="section-title">논문 양식</div>
<div class="field">
  <label for="set-doc-format">새 원고 기본 양식</label>
  <div class="row">
    <select class="input grow" id="set-doc-format" name="doc_format_default">…상단 막대와 같은 optgroup (양식 관리… 항목은 빼기)…</select>
    <button type="button" class="btn sm" data-manage-formats>양식 관리…</button>
  </div>
  <div class="hint">원고마다 편집 화면 위쪽에서 바꿀 수 있어요.</div>
</div>
```

- 기존 저장 코드(`FormData`)에 `doc_format_default`가 그대로 실립니다. 양식 관리 창을 닫고 돌아오면 선택지를 새로 그립니다.

---

## 6. 편집 화면 미리보기 반영 (명세 11.5)

### 6.1 개발팀이 `.doc[data-doc]`에 넣을 것

- 기본 (A4)(`default`): **아무것도 넣지 않음**. 양식을 바꿔 기본으로 돌아오면 `doc.className = "doc"`, `doc.style.cssText = ""`로 되돌립니다(지금 `.doc`에는 인라인 스타일이 없음).
- 그 밖의 양식: 클래스 `doc-formatted` + 아래 변수(`doc.style.setProperty`). **값은 단위 없는 숫자**(CSS가 화면 폭에 맞춰 환산)입니다.

| 변수 | 값 (단위) | 학위논문 예 |
|---|---|---|
| `--doc-paper-w` | `page.width_mm` (mm) | `188` |
| `--doc-pad-t` | `margin_mm.top + header_mm` (mm) | `20` |
| `--doc-pad-r` | `margin_mm.right` (mm) | `21` |
| `--doc-pad-b` | `margin_mm.bottom + footer_mm` (mm) | `29` |
| `--doc-pad-l` | `margin_mm.left` (mm) | `24` |
| `--doc-font` | CSS `font-family` 목록 문자열: **영문 글꼴, 한글 글꼴**, `"바탕", "Batang", "Noto Serif KR", serif` 순서(팀장 결정 — 워드·한글처럼 영문 글자는 영문 글꼴, 영문 글꼴에 없는 한글은 다음 순서인 한글 글꼴로 그려짐). 두 이름이 같으면 한 번만. 이름은 큰따옴표로 감싸고 안의 `"`·`\`는 이스케이프 | 학위논문 `"휴먼명조", "바탕", "Batang", "Noto Serif KR", serif` / APA `"Times New Roman", "바탕", "Batang", "Noto Serif KR", serif` |
| `--doc-size` | `body.size_pt` (pt) | `11` |
| `--doc-lh` | `body.line_spacing_pct / 100` | `1.8` |
| `--doc-para-before` | `body.space_before_pt` (pt) | `0` |
| `--doc-para-after` | `body.space_after_pt` (pt) | `0` (기본 A4 복사본이면 `6`) |
| `--doc-indent` | `body.first_line_indent` → mm (`ch`면 값 × 본문 pt × 25.4 / 72) | `11.64` |
| `--doc-align` | `body.align` 그대로(`left` · `center` · `right` · `justify`는 CSS 값과 같음) | `justify` |
| `--doc-title-size` / `-align` / `-weight` | `title.size_pt` / `title.align` / 굵게면 `700` 아니면 `400` | `16` / `center` / `700` |
| `--doc-h1-size` … `--doc-h3-size` | `headings."1"~"3".size_pt` | `16` · `13` · `11` |
| `--doc-h{1,2,3}-align` | `headings.N.align` | |
| `--doc-h{1,2,3}-weight` | `700` / `400` | |
| `--doc-h{1,2,3}-style` | 기울임이면 `italic` 아니면 `normal` | |
| `--doc-quote-size` | `quote.size_pt` | `11` |
| `--doc-quote-lh` | `(quote.line_spacing_pct ?? body.line_spacing_pct) / 100` | `1.6` |
| `--doc-quote-indent` | `quote.indent_left` → mm (`ch`면 인용문 pt 기준) | `11.64` |
| `--doc-fn-size` | `footnote.size_pt` | `10` |
| `--doc-bib-size` | `bibliography.size_pt` | `11` |
| `--doc-bib-lh` | `(bibliography.line_spacing_pct ?? body) / 100` | `1.8` |
| `--doc-bib-hang` | `bibliography.hanging_indent` → mm | `10` |

클래스(조건이 맞을 때만 `.doc`에 추가):

| 클래스 | 조건 | 화면 |
|---|---|---|
| `doc-formatted` | `default`가 아닌 모든 양식 | 위 변수 적용 |
| `doc-title-off` | `title.show == false` | `#` 제목을 회색으로 + 밑에 작은 글씨 "표지에만 들어가요" |
| `doc-pb-h1` / `doc-pb-h2` / `doc-pb-h3` | `headings."1"/"2"/"3".page_break_before` | 그 수준 제목 위에 지금의 "쪽 나눔" 점선 표시(문서 첫 요소이거나 바로 앞이 이미 쪽 나눔이면 생략) |
| `doc-pb-bib` | `bibliography.new_page` | 참고문헌 제목 위에 "쪽 나눔" 점선 |

### 6.2 CSS가 하는 일 (참고)

- 종이 배율 `--_s`(px/mm) = `min(3.6px, 미리보기 칸 폭 / 용지 폭)`. A4는 지금처럼 약 756px 폭, 188mm 용지는 약 677px로 **실제 용지 크기 차이가 보이고**, 칸이 좁으면 비율대로 줄어듭니다(`.writer-preview`가 컨테이너 쿼리 기준이 됨 — 양식이 적용됐을 때만).
- 글자 크기 = pt × 0.3528 × 배율, 여백·들여쓰기 = mm × 배율, 줄간격 = 숫자 그대로(한글의 % 뜻과 같음).
- 본문 문단(목록 포함)의 위·아래 간격 = `--doc-para-before` · `--doc-para-after`(pt × 배율). 워드·한글처럼 **앞 문단 아래 간격과 다음 문단 위 간격이 더해지도록** margin 대신 padding으로 넣었습니다. 참고문헌 항목은 간격 0, 제목 앞뒤는 글자 크기 비례 고정값입니다.
- 반영하지 않는 것(명세대로): 실제 쪽 나눔·쪽 번호·머리말/꼬리말, 표지류, 각주 위치(끝에 모아 보임), 용지 높이.
- 코드 블록은 Consolas 9.5pt 비율로, 목록은 지금 들여쓰기(인라인 스타일) 그대로.

---

## 7. 문구 모음 (한곳에서 찾기)

| 위치 | 문구 |
|---|---|
| 양식 선택 툴팁 | 내보낼 때 쓸 논문 양식 |
| 표지 정보 버튼 툴팁 | 표지 · 속표지 · 인정서에 들어갈 정보 / 표지 정보 — 비어 있는 칸: {항목} |
| 표지 정보 창 제목 | 표지 정보 — {양식 이름} |
| 표지 저장 토스트 | 표지 정보를 저장했어요 |
| 내보내기 확인 창 | 표지 정보가 비어 있어요: {항목}. 빈 칸은 ○○○로 들어가요. [취소] [그대로 내보내기] [표지 정보 입력] |
| 양식 관리 창 제목 | 논문 양식 |
| 읽기 전용 안내 | 기본 양식은 바꿀 수 없어요. [복사해서 내 양식 만들기]로 내 양식을 만든 뒤 고쳐 쓰세요. |
| 새 양식 이름 | 새 양식 이름 / 기본값 "{이름} 복사본" / [만들기] |
| 만들기 토스트 | ‘{이름}’ 양식을 만들었어요 |
| 삭제 확인 | '{이름}' 양식을 지울까요? 이 양식을 쓰는 원고 n개는 기본 (A4)로 바뀌어요. |
| 삭제 토스트 | 양식을 지웠어요 · 원고 n개를 기본 (A4)로 바꿨어요 |
| 변경 버리기 | 저장하지 않은 변경이 있어요. 버리고 계속할까요? [버리기] |
| 바닥 상태 | 저장 안 한 변경이 있어요 / 저장했어요 / 고칠 칸이 있어요 |
| 가져오기 읽는 중 | ‘{파일}’에서 서식을 읽는 중… |
| 가져오기 칩 | 가져온 양식 (저장 전) · 칸별: 파일에서 읽음 / 기본값 |
| 가져오기 저장 토스트 | 가져온 양식을 저장했어요 |
| 잘못된 파일 | 워드는 .docx나 .dotx로, 한글은 .hwpx로 저장해서 올려 주세요 |
| 50개 제한 | 내 양식은 50개까지 만들 수 있어요 |
| 이름 길이 | 이름은 1~60자로 적어 주세요 |
| 미리보기 제목 표시 | 표지에만 들어가요 |

---

## 8. 개발팀용 클래스 · data 속성 목록

### 8.1 상단 막대 · 내보내기

| 이름 | 붙이는 곳 | 뜻 |
|---|---|---|
| `select.input.fmt-select[data-format]` | 상단 막대 양식 선택 | 값 = 양식 id, `__manage` = 양식 관리 열기 |
| `button.btn.sm.cover-btn[data-cover]` | 상단 막대 표지 정보 버튼 | `hidden` 클래스로 숨김 |
| `[data-incomplete]` | `.cover-btn` | 필수 표지 항목이 비었을 때 주황 점 |
| `.menu.export-menu` | `popupMenu`가 돌려준 내보내기 메뉴 | 아랫줄 문구를 이름 밑에 표시(폭 300px) |
| `.btn.primary.danger-fill` | `confirmDialog(…, { danger: true })`가 이미 붙이는 클래스 | 빨간 채움 버튼(양식 삭제 · 변경 버리기 확인 등). 이번에 스타일 추가 — 밝은/어두운 테마 |
| `[data-go]` · `[data-cover]` · `[data-no]` | 표지 빈 칸 확인 창 버튼 | 그대로 내보내기 · 표지 정보 입력 · 취소 |

### 8.2 표지 정보 창

| 이름 | 뜻 |
|---|---|
| `.modal.cover-modal` | 창 폭 980px (`modal()` 뒤 `.modal`에 추가) |
| `form.cover-layout[data-cover-form]` | 폼(왼쪽) + 미리보기(오른쪽) 두 칸, 760px 이하 한 칸 |
| `.cover-form` | 왼쪽 입력 영역 |
| `[data-cover-error]` | 저장 오류 상자 (`status-line bad`) |
| `[data-only="thesis"]` | 학위논문 양식에서만 보이는 묶음 |
| `.seg.seg-radio` | 라디오형 세그먼트(`label > input[type=radio] + span`) |
| `[data-degree]` · `name="degree"` | 학위 석사/박사 |
| `name="degree_field"` · `[data-degree-hint]` | 학위명 · 결과 미리 보기 |
| `name="title_ko"` · `"title_en"` · `"subtitle"` | 제목들 |
| `.cover-ym` · `.cover-year` | 연·월 입력 묶음 · 연도 칸 |
| `name="grad_year"` · `"grad_month"`(2/8/other) · `"grad_month_other"` · `[data-grad-month]` · `[data-grad-warn]` | 졸업 연월 |
| `.cover-auto[data-approval-auto]` (+`.is-warn`) | 인정 연월 자동 표시 |
| `[data-approval-manual]` · `name="approval_manual"` · `"approval_year"` · `"approval_month"` | 인정 연월 직접 입력 |
| `name="school"` · `"department"` · `"name"` · `"spaced_name"` | 대학원 · 학과 · 이름 · 띄우기 |
| `.name-preview[data-name-preview]` | 띄운 이름 미리 보기 |
| `name="advisor_1"` · `"advisor_2"` · `"co_advised"` · `[data-adv-label]` · `[data-adv-hint]` | 지도교수 |
| `fieldset.cover-committee[data-committee]` · `.cover-members` · `.cover-member` · `.cover-role` · `name="committee"[data-i]` | 심사위원 |
| `fieldset.cover-include` · `name="include_front"` · `"include_inner"` · `"include_approval"` | 넣을 쪽 |
| `.req-dot` | 필수 표시 주황 점(라벨 끝, `aria-hidden`) |
| `aside.cover-preview` · `.cover-preview-head` · `.cover-preview-title` | 문구 미리보기 상자 |
| `.seg[data-cover-tabs] > button[data-page="front|inner|approval"]` (+`.active`, `aria-pressed`) | 미리보기 쪽 탭 |
| `.cover-sheet[data-cover-sheet]` (+`.is-bold`, `.is-off`, `.is-overflow`) | 종이. 인라인 변수 `--ar`(용지 비율 `폭 / 높이`), `--cover-font`(글꼴 목록) |
| `.cover-line` (인라인 `--pt`) · `.cover-line .ph` | 한 줄(크기 pt) · 빈 값 자리표시 강조 |
| `.cover-gap` · `.cover-gap.lg` · `.cover-fill` | 작은 간격 · 큰 간격 · 남는 높이 채움 |

### 8.3 양식 관리 창

| 이름 | 뜻 |
|---|---|
| `.modal.fmt-modal` | 창 1080×820 (`modal()` 뒤 `.modal`에 추가). `.modal-body` 여백·스크롤은 CSS가 처리 |
| `.fmt-layout[data-fmt]` | 왼쪽 목록 + 오른쪽 편집 |
| `.fmt-side` · `.fmt-side-actions` | 왼쪽 칸 · 위 버튼 줄 |
| `[data-fmt-new]` · `[data-fmt-import]` · `[data-fmt-pick]` | 새 양식 메뉴 · 가져오기 · 파일 고르기 |
| `.fmt-list[data-fmt-list]` · `.fmt-group-title` · `[data-fmt-count]` | 목록 · 묶음 제목 · 내 양식 수 |
| `button.fmt-item[data-id]` (+`aria-current`, `.is-dirty`, `.is-draft`) · `.fmt-item-name` · `.fmt-item-sub` | 목록 항목 (`data-id="__draft"` = 가져온 양식) |
| `.fmt-empty` | 내 양식 없음 안내 |
| `.fmt-drop[data-fmt-drop]` (+`.is-over`) | 끌어 놓기 상자 |
| `.fmt-main[data-fmt-main]` | 오른쪽 칸(스크롤) |
| `.fmt-head` · `.fmt-title[data-fmt-title]` · `.fmt-name-input[data-fmt-name]` · `.fmt-head-actions` | 머리(스크롤해도 위에 고정) |
| `[data-fmt-copy]` · `[data-fmt-rename]` · `[data-fmt-delete]` | 복사해서 만들기 · 이름 바꾸기 · 삭제 |
| `nav.fmt-nav > button[data-jump]` (+`aria-current`) | 묶음 이동 |
| `.fmt-content` | 머리 아래 본문 여백 |
| `.status-line.fmt-lock` | 기본 양식 읽기 전용 안내 |
| `.fmt-note[data-fmt-note]` | 근거 설명 |
| `.fmt-import[data-fmt-import-info]` · `.fmt-import-row` · `[data-import-base]` · `[data-import-missing]` · `.fmt-warnings[data-import-warnings]` | 가져오기 정보 상자 |
| `form.fmt-form[data-fmt-form]` (+`.is-readonly`) · `fieldset.fmt-fields` (기본 양식은 `disabled`) | 폼 |
| `fieldset.fmt-sec[data-sec][id="fmt-sec-{키}"]` · `legend.fmt-sec-title` · `.fmt-sec-help` | 항목 묶음 |
| `.fmt-grid` (+`.cols-2`) · `.span-all` | 칸 배치(자동 열 / 2열 고정 / 한 줄 전체) |
| `.field.fmt-field[data-field]` (+`.is-invalid`) · `.fmt-err` | 칸 하나 · 오류 문구 |
| `[data-path]` | 입력 요소 ↔ JSON 경로 |
| `.fmt-num` + `.fmt-unit` | 숫자 + 단위 꼬리표 |
| `.fmt-len` | 숫자 + 단위 선택(글자/mm) |
| `.fmt-checks` | 체크 상자 줄 |
| `.fmt-sub[data-level]` · `.fmt-sub-title` | 제목 1~3수준 상자 |
| `.fmt-help` | 글꼴 도움말 상자(주황 바탕) |
| `.fmt-origin[data-origin="file|default"]` | 칸별 출처 꼬리표 |
| `[data-paper-preset]` · `[data-word-hint]` | 용지 선택 · 워드 환산 안내 |
| `datalist#fmt-font-list` | 글꼴 추천 목록 |
| `.fmt-loading` | 불러오는 중 |
| `.fmt-foot-status[data-fmt-status]` (+`.is-dirty`) · `[data-fmt-save]` · `[data-fmt-retry]` | 바닥 상태 · 저장 · 다시 시도 |

### 8.4 설정 창 · 미리보기

| 이름 | 뜻 |
|---|---|
| `select#set-doc-format[name="doc_format_default"]` · `[data-manage-formats]` | 설정 창 논문 양식 구역 |
| `.doc.doc-formatted` | 양식 적용된 미리보기 |
| `.doc-title-off` · `.doc-pb-h1` · `.doc-pb-h2` · `.doc-pb-h3` · `.doc-pb-bib` | 미리보기 상태 클래스(6.1) |
| `--doc-*` | 6.1 표 (명세 11.5의 고정 이름 + 팀장 결정으로 추가한 `--doc-para-before` · `--doc-para-after`: 본문 문단 위·아래 간격, 단위 없는 pt 숫자) |
| `--doc-para-before` · `--doc-para-after` | `.doc.doc-formatted`의 인라인 변수. 없으면 0 |
