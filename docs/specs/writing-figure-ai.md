# 논문 쓰기 — 그림 만들기 · 말로 고치기 (2026-10-17)

사용자 요청: "그림 만드는 기능도 추가해줘. claude cli 사용해서 svg로 이미지 만드는 기능", "이미지 생성해서 바로 붙여 넣거나
자연어를 통한 수정 같은 것도 가능해야지", "이 내용 기반으로 그림 만들어줘. 같은 것도 가능해야해".

## 1. 흐름

1. ✦ AI 도우미 → **그림 만들기…**(설명) · **이 내용으로 그림 만들기**(고른 글 · 이 문단 · 이 절 · 장) · **커서의 그림 고치기**, 또는 `Alt+G`.
2. `POST /api/ai/figure` → 작업 종류 **`figure`**(마이그레이션 20261017000006이 허용 — 새 표 없음). 202 `{job, note}`.
3. 내 PC 워커(claude CLI)가 잡아 `figgen.build_request`의 프롬프트로 실행 → 결과 글을 `figgen.parse`가 읽고 SVG를 **정화해서**
   작업 result `{svg, caption, kind_note, check_needed}`로 남긴다(원문은 남기지 않음, 30일 뒤 작업 행과 함께 지움).
4. 화면 그림 패널(writefigui.js)이 작업을 따라가 미리보기 → [원고에 넣기]: 브라우저가 SVG를 PNG로 그려 `POST /api/manuscripts/{id}/figures`
   (multipart `file` = PNG, `svg` = SVG 원본)로 올리고 `![캡션](fig:이름)` 문단을 넣는다.
5. 고치기: `mode: "edit"` + `parent_job_id`(지난 그림 작업) 또는 `base_figure`(원고 그림 — 서버가 PNG 옆 SVG 원본을 읽음) + 고칠 말.
   params.chain = 지난 작업 id들(최대 30) → 화면의 **버전 1 · 2 · 3…**.

## 2. 실행 경로 (`figgen.route` · `jobs.build_route`)

| 순서 | 칸 |
|---|---|
| 1 | 내 PC의 claude CLI (claude를 광고한 연결된 PC가 있으면 — 꺼져 있으면 켜질 때까지 대기, 24시간) |
| 2 | 내 Claude(Anthropic) API 키 |
| 3 (claude가 둘 다 없을 때만) | 내 PC의 codex · gemini → 내 OpenAI · Google API 키 — 응답 `note`와 패널에 "Claude를 쓸 수 없어 …로 그려요" |

작업별 엔진 설정(`ai_routing`)에는 넣지 않았다(사용자가 claude CLI를 콕 집어 요청). 서버 PC의 CLI · 서버 환경 변수 키 칸은 만들지 않는다(다른 작업과 같음).
CLI 시간 제한 900초, 대기 기한 24시간, params 상한 420KB(고칠 SVG 300KB + 원고 내용 12,000자 — 다른 작업은 64KB).
API 칸은 `api_runner`가 `ai.complete`(스트림, 결과는 끝에 한 번)로 실행하고, 결과가 틀리면 `bad_output`(폴백 없음).

## 3. 프롬프트 (`figgen.SYSTEM` · `build_request`)

- SVG 하나: `xmlns` · `viewBox="0 0 W H"`(W≈1000), 가로 16cm로 줄었을 때 읽히게 글자 20~28 · 선 2~3, 글꼴
  `'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Nanum Gothic',sans-serif`, 기본 흑백(검정 · 회색 · 흰 배경), 화살표는 `<marker>` + `url(#이름)`.
- 금지: script · `on…=` · foreignObject · image · use · a · iframe · 애니메이션 · `<style>`/style 속성 · @import/@font-face · 바깥 주소 · DOCTYPE/엔티티.
- 내용: 주어진 설명 · 원고에 있는 것만, 지어내지 않음 — 모르는 값은 그림 안에 `[확인 필요]`. 수치가 없으면 그래프에 축 · 범례만.
- 출력 형식: `그림 종류: … — 이유 한 줄` / `캡션: …`('그림 1.' 번호 없이) / `<svg …>…</svg>`. 읽을 때 코드 블록 표시 · 굵게 · 영어 머리말도 받는다.
- 사용자 글(설명 · 원고 · 고칠 말 · 캡션)은 `<request>` · `<manuscript>` · `<previous_caption>` 칸에 넣고 `ai.fence` + 이 칸 태그 무디게(프롬프트 주입 방어).
  고칠 SVG는 정화한 것만 `<previous_svg>`에 넣는다(정화 결과에는 그 태그가 생길 수 없음). 그림 글 · 캡션 언어 = 원고에 한글이 있으면 한국어, 아니면 영어.

## 4. SVG 정화 (`figgen.sanitize_svg` — 서버, 진짜 방어)

AI 결과 · 올리는 SVG 원본 · 고칠 원본 · 원본 받기 모두 같은 함수. **허용 목록으로 다시 쓴다**(원문을 고쳐 두지 않고 새로 직렬화).

| 항목 | 규칙 |
|---|---|
| 크기 | 300KB(UTF-8) 넘으면 거부. 요소 5,000개 · 깊이 40 넘으면 거부. 속성 값 하나 100,000자 |
| 파싱 | 맨 앞 `<?xml …?>`만 떼고, `<!DOCTYPE` · `<!ENTITY` · `<!ATTLIST` · `<!ELEMENT` · `<!NOTATION`이 있으면 거부(외부 엔티티 · 엔티티 폭탄). 선언 없는 엔티티 → XML 오류로 거부. 주석 · 처리 지시는 버림 |
| 루트 | SVG 이름공간의 `svg` 하나. viewBox(4개 숫자, 가로 · 세로 0 초과 10,000 이하) — 없으면 숫자 width · height로 만듦, 둘 다 없으면 거부. 결과 루트 width · height = viewBox 크기 |
| 요소 | svg g defs title desc rect circle ellipse line polyline polygon path text tspan marker linearGradient radialGradient stop clipPath pattern style 만. 그 밖(script · foreignObject · image · use · a · iframe · animate · set · filter · feImage · 안쪽 svg · 다른 이름공간)은 **하위까지 버림** (글자 요소 안이면 뒤 글자만 남김) |
| 속성 | 위치 · 모양 · 칠 · 글꼴 · marker · gradient · pattern · clip 관련 허용 목록만(`figgen.ATTRS`). `on…` · `xml:base` · 다른 이름공간 속성 없음 |
| href | linearGradient · radialGradient · pattern의 `#조각`만(→ `href`). 그 밖은 버림 |
| 값 | `url(#조각)` 말고 다른 `url(…)`, `javascript:` · `vbscript:` · `data:` · `expression(` · `@` · `\`(CSS 이스케이프) · `/*` · `image(`/`image-set(`/`cross-fade(`/`element(`/`src(` · `behavior:` · `-moz-binding` · 제어 문자가 있으면 그 속성만 버림. id는 `[A-Za-z_][\w.-]*`, class는 영숫자 · 공백 · `-` `_` |
| `<style>` | 글이 같은 값 규칙을 통과할 때만(그래서 @import · @font-face · 바깥 url 없음), 아니면 요소째 버림 |
| 글자 | text · tspan · title · desc · style 안의 글만 남기고 이스케이프해서 씀 |

화면(writefigui.js)은 한 번 더: DOMPurify SVG 프로필 + 개념 그림과 같은 금지 요소, href 금지, `url(#…)` 말고 다른 url 속성 제거 → 직렬화 →
`<img src="blob:">`로만 보인다(앱 DOM에 SVG를 넣지 않음 — 스크립트 실행 · 바깥 자원 · 앱 스타일 영향 없음). 시험: tests/test_figgen.py 악성 견본 17개 + 거부 견본 15개.

## 5. 저장 (storage · figures · server)

- PNG: 기존 그림 키 `users/{uid}/figures/{원고}/{hex16}.png` (원고 · 미리보기 · 워드 · 한글 내보내기는 이것만 — `figures.NAME_RE` 그대로).
- SVG 원본: 같은 폴더 **`{같은 hex16}.svg`** — `storage.figure_svg_key` · `_FIGURE_SVG_KEY_RE`, `check_user_key`가 받고, 서명 주소는 거부(`_pdf_only`),
  `list_figures`(원고 삭제 정리) · `FigureSizeCache`(사용량 · 95% 규칙)에 들어간다. 그림 키 함수 `figure_key`는 여전히 .svg를 받지 않는다.
- `POST /api/manuscripts/{id}/figures`에 선택 필드 `svg` — 정화해서 PNG와 함께 저장(실패하면 400, 롤백 때 둘 다 지움). 원고당 200장 상한은 PNG만 세고, 300MB 합계에는 SVG도 넣는다.
- `GET /api/manuscripts/{id}/figures/{이름.png}/source` → `{"name", "svg"}` JSON(내려줄 때 한 번 더 정화). SVG 파일(`image/svg+xml`)로는 내려주지 않는다 — `GET …/figures/{x}.svg`는 404.
- DB 표는 새로 만들지 않았다(마이그레이션 없음): 그림 결과 · 고치기 사슬은 jobs 행(params · result), 원본은 R2.

**PNG를 브라우저에서 그리는 이유**: 서버에는 순수 파이썬 SVG 렌더러가 없다. 설치된 PyMuPDF(MuPDF, C 라이브러리)는 SVG를 그릴 수 있지만 한글 글꼴을
찾지 못해 글자가 빠지고, 신뢰하지 않는 SVG를 서버의 C 파서에 넣는 위험이 늘어난다. 브라우저는 사용자 PC의 한글 글꼴(맑은 고딕 등)로 그리고,
정화한 SVG를 blob `<img>`로 불러 canvas에 그리므로 바깥 자원이 없어 canvas가 오염되지 않는다. 크기: 가로 1890px(16cm × 300dpi), 세로가 4000px을 넘으면 세로에 맞춤, 흰 바탕.
워드 · 한글 내보내기는 기존 그림 경로(`figures.attach_images` — python-docx는 PNG를 읽음)를 그대로 쓴다.

## 6. 화면 (writefig.js 순수 함수 · writefigui.js)

- 그림 패널: 편집기 오른쪽 칸 — AI 결과 패널과 같은 자리 · 폭(`--ai-w`). `section.writer[data-fig-pane="open"]`. 둘 중 하나만 열린다
  (그림 패널을 열면 AI 결과 패널을 닫고, AI 결과 패널이 열리면 그림 패널을 닫음). 모달이 아니라 그리는 동안 계속 쓸 수 있다.
- 요청 칸: [설명으로 | 이 내용으로]. 이 내용으로 = 범위(고른 글 · 이 문단 · 이 절 · 장 — `contentRange`, 장 · 절은 그 제목 줄부터 다음 같은 단계 이상 제목 앞까지,
  '# 논문 제목' 아래는 문단), 범위 글 보기(누르면 편집기에서 고름), 추가 요청.
- 결과 칸: 버전 단추(1 · 2 · 3…, 고치기 사슬 + 이 세션에서 본 버전), 상태(그리는 중 — 'PC'에서 그리는 중 (claude) · [취소]), 경로 안내, 미리보기(흰 바탕),
  그림 종류 한 줄, `[확인 필요]` 경고, 캡션 칸(AI 제안), *본문에 '(그림 N 참조)' 넣기*, [원고에 넣기] · [다시 만들기], 고쳐 달라고 하기(Ctrl+Enter).
- 넣기(`insertFigure`): '이 내용으로'면 그 내용 바로 뒤(`contentEnd` — 원래 자리, 아니면 원고에서 한 곳만 찾을 때, 아니면 커서), 아니면 커서 자리에
  `![캡션](fig:이름){#fig:ai-xxxxxx}` 문단. 참조를 켜면 내용 끝(또는 커서) 문장 부호 앞에 `(@fig:ai-xxxxxx 참조)`(영문 `(see @fig:…)`) — 미리보기 · 내보내기에서
  "(그림 2 참조)"가 된다. 한 번의 편집(Ctrl+Z 한 번), 넣기 전 원고는 버전 기록('AI 넣기 전').
- 원고 그림 고치기: 미리보기에서 그림을 누르면 SVG 원본이 있을 때만 그림 위에 [이 그림 고치기]. 바꾸기(`replaceFigure`)는 확인 창 → PNG 올리기 →
  버전 기록 → 그 그림 줄의 `fig:` 이름만 새 이름으로(캡션을 고쳤으면 캡션도, `{#fig:…}` 참조 이름 그대로). **같은 이름에 덮어쓰지 않는 이유**: 버전 기록으로
  되돌리면 옛 글이 옛 그림을 가리켜야 하므로(그림은 원고를 지울 때까지 남음).
- 이 브라우저에 원고별 마지막 그림 작업 id(`paperlab.figJob.{원고}`)를 기억해 패널을 다시 열면 이어서 보인다.
- 단축키 `Alt+G`(단축키 도움말에 있음), 패널 안 `Esc` 닫기. 작업 화면에는 "그림 만들기" 종류로 보이고 [열기]는 그 원고.

## 7. 시험

- tests/test_figgen.py: 정화(정상 그림 유지 · 두 번 정화해도 같음, 악성 견본 17개, 거부 견본 15개, 크기 · 요소 수 · 깊이 상한), 프롬프트(규칙 · 칸 무디게 ·
  고치기), 결과 읽기(캡션 · 그림 종류 · [확인 필요] · 못 읽으면 bad_output), 경로(PC claude 먼저 · 다른 엔진 안내), params(상한 · 사슬), 저장 키(.svg ·
  남의 키 · 서명 거부 · 사용량). DB: 그림 + SVG 올리기 · 원본 받기 · .svg 파일 404 · 내보내기에 PNG · 원고 삭제 정리, 그림 작업(PC CLI) 실행 → 고치기 사슬 ·
  원고 그림으로 고치기 · 남의 작업 404.
- tests/js/writefig.test.mjs: 범위 · 넣을 자리 · 넣기(참조 · 캡션 고름 · marked가 그림 문단으로 읽음) · 바꾸기 · 커서의 그림 · PNG 크기 · 상태 · 버전 · 안내 ·
  요청 본문 · Alt+G, writefigui.js 코드 검사(esc · blob img만), writing.js 연결.
