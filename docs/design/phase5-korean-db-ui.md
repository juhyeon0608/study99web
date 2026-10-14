# 화면 시안 — 국내 DB · 기관 연동 (5단계)

- 작성: 디자인팀 · 2026-10-13 (HEAD f49b553)
- 근거: [기능 명세](../specs/phase5-korean-db.md) 5장(흐름) · 6.1~6.5절(카드 칸 · 매핑 · 오류) · 7장(인하대에서 보기) · 8장(무료 PDF) · 9장(OpenCitations) · 11장(API) · 16장(U-1~U-5 · K-1~K-21)
- 범위: 논문 찾기의 소스 선택 · 정렬/필터 비활성, KCI · RISS · Europe PMC 결과 카드, 무료 PDF 버튼(찾기 결과 카드 · 서재 상세), 인용 관계 탭 · 찾기 참고문헌 목록의 OpenCitations 표시, 오류 · 빈 상태 문구, 접근성 · 좁은 화면.
- 없는 것: **설정 창 키 칸 없음**(U-1 — `dialogs.js` 설정 창은 고치지 않음). **Unpaywall 문구 없음**(U-4). 1A [RISS] 검색 바로가기는 그대로(U-2).
- 재사용: `.discover-*` · `.result` · `.r-actions` · `.seg`(`button:disabled` 스타일 있음) · `.check` · `.chip`(`.accent` · `.success`) · `.notice[data-tone]` · `.status-line` · `.pager` · `.mini-list` · `.ext-link` + `EXT_MARK` · `.btn[aria-disabled="true"]`(4단계) · `.sr-only` · `G5_NOTICE` 방식 슬롯 · `openExternal` · `bindExtLink` · `inhaSearchUrl` · `paperProxyTarget` · `scholarUrl` · `toast` · `errorToast`
- 스타일: `paperlab/static/css/app.css` 맨 끝 **"5단계 국내 DB · 기관 연동"** 구역 31줄(1569 → 1600줄). 그 위 1569줄은 바이트 단위로 그대로(CRLF 유지). **새 색 · 새 토큰 없음.**
- 새 클래스: `.discover-note` · `.notice-actions` · `.r-badges` · `.src-chip` · `.r-cites` · `.r-noabs` · `.oa-none` · `.oa-after` · `.result-src` · `.via-line` · `.via-note` (11개). 나머지는 기존 클래스 + `data-*`.
- 외부에서 온 글(제목 · 저자 · 학술지 · 초록 · 배지 · 라이선스)은 모두 `esc()` · `textContent`로만(AC-582).

---

## 0. 개발팀용 클래스 · data 속성

### 0.1 논문 찾기 머리 (`discover.js`)

| 이름 | 뜻 |
|---|---|
| `select.input[name=source][aria-describedby="src-off-note"]` > `optgroup[label="전 분야"｜"국내"｜"생명과학 · 의학"]` > `option[value]` | 소스 7개를 묶음 3개로(2장). 키 없는 소스는 `option[disabled]` + 글자 끝 " (키 등록 전)" |
| `p.discover-note#src-off-note[data-src-off]` | 쓸 수 없는 소스의 이유(2.2절). 쓸 수 없는 소스가 없으면 그리지 않음(`hidden`) |
| `.discover-filters[role=group][aria-describedby="src-limit-note"]` | 기간 · 정렬 · 무료 PDF 줄 |
| `.seg[data-sort] > button[data-v][disabled]` | 이 소스가 지원하지 않는 정렬(2.3절). 기존 `.seg button:disabled` 모양 |
| `label.check > input[name=oa][disabled]` | 지원하지 않는 '무료 PDF 있는 논문만'. 글자는 `:has(> input:disabled)`로 흐리게(CSS) |
| `p.discover-note#src-limit-note[data-src-limits]` | 지원하지 않는 정렬 · 필터 이유, 자동으로 바꾼 것 알림(2.3절). 없으면 `hidden` |
| `[data-srcdesc]` | 소스 한 줄 설명(기존 칸, 문구만 추가 — 2.1절) |
| `div.sr-only[role=status][data-discover-live]` | 화면 읽기 알림(새로 — 늘 빈 채로 그려 둠, 7.3절) |

### 0.2 결과 목록 (`discover.js`)

| 이름 | 뜻 |
|---|---|
| `.discover-results > div.notice[data-tone=info][data-kdb-intro]` > `svg` + `div` + `button.icon-btn.small[data-kdb-intro-close][aria-label="안내 닫기"]` | 처음 KCI · RISS 결과를 볼 때 한 번(3.1절) |
| `.discover-results > div.notice[data-tone=warn][data-search-error="{code}"]` > `div` > `b` + 글 + `div.notice-actions` > `button.btn.sm` | 검색 오류(6.1절). 기존 `.status-line.bad`는 code를 모르는 오류에만 남김 |
| `div.result[data-source="kci｜riss｜europepmc"]` | 새 소스 카드(기존 소스 카드는 `data-source`만 붙고 모양 그대로) |
| `div.r-badges` > `span.chip.src-chip` · `span.chip.accent` · `span.chip.success` · `span.r-cites` | 소스 · 등재 · 원문 공개 · 소스 피인용(3.2절). `r-meta` 바로 아래 |
| `p.r-noabs` | 초록 없음(3.2절). `r-abs` 자리 |
| `p.result-src[data-result-src]` | 카드 묶음 아래 출처 한 줄(3.3절). 결과가 1편 이상일 때만 |
| `.pager[data-cursor]` | Europe PMC: "← 이전 · N쪽 · 다음 →"(3.4절) |

### 0.3 무료 PDF (찾기 카드 `discover.js` · 서재 상세 `library.js`)

| 이름 | 뜻 |
|---|---|
| `button.btn.sm[data-oa-find]` "무료 PDF 찾기" | 카드: DOI 있음 · `pdf_url` · `oa_open_url` 없음 · 서재에 없음. `[data-lib]` 안 [＋ 서재에 추가] 바로 뒤 |
| `button.btn.sm[data-oa-find][aria-busy=true]` + `span.spinner` "찾는 중" | 조회 중(`disabled`) |
| `button.btn.sm[data-addpdf]` "PDF 포함 추가" + `span.chip.success[data-oa-license]` "CC BY" | 서버가 받음(4.1절) |
| `a.btn.sm[data-oa-open][href][target=_blank][rel="noopener noreferrer"]` "무료 PDF 열기" + `extMark(…)` | 새 탭(4.2절). 프록시 · openlink로 감싸지 않음, 학교 안내 창(`inhaGuideDialog`) 안 띄움 |
| `span.oa-none[tabindex=-1]` "무료 PDF 없음" | 없음(4.3절). 초점을 받을 수 있게 `tabindex=-1`(버튼이 사라진 자리로 초점을 옮김) |
| `.result > div.notice.oa-after[data-tone=info]` | 카드에서 [무료 PDF 열기]를 누른 뒤 한 줄 |
| 서재 상세 `button.btn.primary[data-fetch]` "무료 PDF 찾기" | 기존 [PDF 받기] 자리 · 이름 변경(AD-3) |
| 서재 상세 `a.btn.primary[data-oa-open]` "무료 PDF 열기" | 새 탭 결과가 오면 [무료 PDF 찾기]를 이 링크로 바꿈 |
| 서재 상세 `button.btn[data-fetch][aria-disabled=true]` "무료 PDF 없음" | 404일 때 |
| 서재 상세 `div.oa-after-slot[data-oa-after][role=status]` > `div.notice.oa-after[data-tone=info]` | `[data-inha-after]` 바로 뒤. 패널을 다시 그릴 때까지 |

### 0.4 인용 관계 (`library.js` `relatedView` · `discover.js` `drawGraph`)

| 이름 | 뜻 |
|---|---|
| `div.via-line[data-via="opencitations"]` > `span` "참고문헌 23편" + `span.chip[title]` "OpenCitations 기준" | 기존 "23편" 줄을 바꿈(5.1절). `via`가 없으면 지금 그대로 |
| `p.via-note` | 설명 + `unresolved` 수 |
| `div.notice[data-tone=warn][data-code="oc_failed"]` + `div.notice-actions > button.btn.sm[data-retry]` | 보강 실패(5.2절) |

---

## 1. 공통 원칙
- **안 되는 것은 숨기지 않고 이유와 함께 흐리게**(K-4 · K-5). 이유는 색이 아니라 글로, 늘 화면에 보이는 한 줄로(툴팁만으로 두지 않음 — 터치 화면 · 화면 읽기).
- **서버가 받는 것과 사용자가 직접 받는 것을 구분해 말함**(U-3). "PaperLab이 대신 받지 않아요"는 라이선스 이유로만, 학교 계정 · 로그인을 떠올리게 하는 말은 쓰지 않음.
- **새 탭은 사용자가 누르는 링크로만**(명세 5장 — 팝업 차단 회피, 자동으로 열지 않음).
- 문구는 '~해요'체, 버튼은 동사형 짧게. 소스 이름은 "KCI" · "RISS" · "Europe PMC" 그대로.

## 2. 논문 찾기 — 소스 선택

```
[⌕ 딥러닝 의료영상                          ] [KCI          ▾] [검색] [✦ AI로 찾기]
기간 [부터] – [까지]  정렬 (관련도순|피인용순|최신순)  [ ] 무료 PDF 있는 논문만     국내 학술지 논문 · 제목으로 찾아요
                              ^흐림            ^흐림
KCI는 피인용순 정렬과 ‘무료 PDF 있는 논문만’을 지원하지 않아요.
RISS는 키를 받으면 쓸 수 있어요. 지금은 아래 ‘학교 DB에서 찾기’의 [RISS]로 찾아 주세요.
───────────────────────────────────────────────
학교 DB에서 찾기  [RISS ↗] [DBpia ↗] [KISS ↗] | [Google Scholar ↗]      ← 그대로(U-2)
```

### 2.1 소스 목록 (`select` 그대로 — AD-1)
| 묶음(`optgroup`) | 값 · 이름 | `[data-srcdesc]` 설명 |
|---|---|---|
| 전 분야 | `openalex` OpenAlex · `semanticscholar` Semantic Scholar · `arxiv` arXiv · `crossref` Crossref | 지금 문구 그대로 |
| 국내 | `kci` KCI | "국내 학술지 논문 · 제목으로 찾아요"(K-19) |
| 국내 | `riss` RISS | "국내 학술논문 · 초록은 RISS에서 봐요" |
| 생명과학 · 의학 | `europepmc` Europe PMC | "생명과학 · 의학 논문 (PubMed 포함)" |

- 쓸 수 있는지는 화면을 열 때 `GET /api/sources` 한 번(메모리에 둠). **응답이 실패하면 모두 켜 둠** — 검색 때 서버 503 문구가 대신 알려 줌(6.1절).
- 키 없는 소스: `option[disabled]` + 글자 "KCI (키 등록 전)" · "RISS (키 등록 전)". 고를 수 없음(K-4).
- 메모리의 `ds.source`가 꺼진 소스면(새로 고친 뒤 키가 빠짐 등) OpenAlex로 되돌리고 `[data-src-limits]`에 "KCI를 지금 쓸 수 없어 OpenAlex로 바꿨어요."
- **검색 중 503 `source_unconfigured`를 받았을 때(D8)**: 위 상태와 똑같이 맞춤 — 그 소스 옵션을 `option[disabled]` + " (키 등록 전)"로 바꾸고(`GET /api/sources` 응답이 없어도 메모리 상태를 `enabled: false · reason: "unconfigured"`로 고침), 고른 소스를 OpenAlex로 되돌린 뒤 이유 줄(`[data-src-limits]`)에 **"KCI를 지금 쓸 수 없어 OpenAlex로 바꿨어요."**(RISS면 "RISS를 …")를 보임. (구현: `discover.js` `syncSourceSelect` · 검색 오류 처리)

### 2.2 쓸 수 없는 이유 (`[data-src-off]`, 소스마다 한 줄 · 붙여 씀)
| `reason` | 문구 |
|---|---|
| KCI `unconfigured` | "KCI는 관리자가 키를 등록하면 쓸 수 있어요." |
| RISS `unconfigured` | "RISS는 키를 받으면 쓸 수 있어요. 지금은 아래 ‘학교 DB에서 찾기’의 [RISS]로 찾아 주세요." |
| 그 밖 · 모르는 값 | "{이름}은 지금 쓸 수 없어요." |

### 2.3 지원하지 않는 정렬 · 필터 (6.4절 표 → 순수 함수)
| 소스 | 관련도순 | 최신순 | 피인용순 | 무료 PDF 있는 논문만 | 기간 |
|---|---|---|---|---|---|
| KCI | ○ | ○ | **비활성** | **비활성** | ○ |
| RISS | ○ | ○ | **비활성** | ○ (`charge=1`) — 글자는 "무료 원문 있는 논문만"으로 바꿔 보임 | ○ |
| Europe PMC | ○ | ○ | ○ | ○ (`OPEN_ACCESS:Y`) — "오픈 액세스 논문만" | ○ |
| 기존 4개 | 지금 그대로 | | | | |

- 비활성은 **기본 `disabled`**(AD-2). Tab 순서에서 빠지고, 이유는 아래 `[data-src-limits]` 한 줄이 늘 보여 줌: "{이름}는 피인용순 정렬과 ‘무료 PDF 있는 논문만’을 지원하지 않아요." (하나만이면 그 하나만)
- 소스를 바꿨을 때 고른 값이 지원되지 않으면 **기본값으로 되돌리고 같은 줄에 덧붙임**: "… 지원하지 않아 관련도순으로 검색했어요." 체크 상자는 해제. 화면 읽기 알림도 같은 글(7.3절).
- 체크 상자 글자를 소스에 맞춰 바꾸는 이유: RISS `charge=1`은 "무료 원문"(RISS 사이트에서 직접 받음), EPMC는 OA 여부라 "무료 PDF"라고 하면 서버가 받아 주는 것처럼 읽힘.
- 표는 서버와 같은 상수(AC-581). 화면 쪽은 순수 모듈 하나(예: `sourcemeta.js` — `SOURCE_META` · `sourceLimits(source)` · `licenseLabel()` · `searchErrorView()`)에 두고 Node 테스트.

## 3. 결과 목록 · 카드

```
ⓘ KCI · RISS 검색은 PaperLab 공용 키로 요청해요. 원문은 각 사이트(또는 인하대에서 보기)에서
  직접 받아 [PDF 첨부]로 올려 주세요.                                                    ✕
검색 결과 약 1,284건 · KCI
합성곱 신경망을 이용한 흉부 X선 영상의 폐결절 자동 검출                     ← 제목 = KCI 논문 페이지(새 탭)
김민수, 이지은, 박정호 - 대한의료영상학회지, 2023 - doi:10.3348/jksr.2023.0012
(KCI) (KCI등재) (원문 무료 · KCI)  KCI 피인용 12
본 연구는 합성곱 신경망(CNN)을 이용하여 …                                   ← 3줄, 누르면 펼침(지금과 같음)
[＋ 서재에 추가] [무료 PDF 찾기]  인용  참고문헌  관련 논문  그래프  인하대에서 보기↗  Google Scholar에서 보기↗
────
의료 인공지능의 법적 책임에 관한 연구
최현우 - 의료법학, 2021
(KCI) (KCI등재후보)  KCI 피인용 0
초록이 없어요.
[＋ 서재에 추가]  인용  Google Scholar에서 보기↗                           ← DOI 없음: 인하대 · 무료 PDF · 참고문헌 · 그래프 없음
────
검색 결과 출처: KCI(한국연구재단)
                       [← 이전]  3 / 65  [다음 →]
```
(스크린샷 확인: 9장)

### 3.1 처음 안내 (명세 5장 — U-1 문구 그대로)
- 소스가 `kci` · `riss`인 결과를 처음 그릴 때 목록 맨 위 `.notice[data-tone=info][data-kdb-intro]`: "KCI · RISS 검색은 PaperLab 공용 키로 요청해요. 원문은 각 사이트(또는 **인하대에서 보기**)에서 직접 받아 **[PDF 첨부]**로 올려 주세요."
- ✕(`aria-label="안내 닫기"`)를 누르면 `localStorage["paperlab.kdbIntro"]="1"`(try/catch — 못 쓰면 다음에 또 보임) · 초점은 `.result-info`(`tabindex=-1`)로. 창(modal)으로 막지 않음(AD-7).

### 3.2 카드 칸 (새 소스만 — 기존 소스 카드는 그대로)
| 칸 | KCI | RISS | Europe PMC |
|---|---|---|---|
| 제목 링크 | `url`(KCI 논문 페이지) | `url`(`https://www.riss.kr/link?id=…`) | `url`(europepmc.org) |
| `.src-chip` | "KCI" | "RISS" | "Europe PMC" |
| 등재 `.chip.accent` | `badges`의 등재 값 그대로: "KCI등재" · "KCI등재후보" | `riss.reg` 값(예: "KCI등재") | — |
| 원문 공개 `.chip.success` | `is_oa` → "원문 무료 · KCI" | `badges`의 무료 원문 → "원문 무료 · RISS" | `is_oa` → "오픈 액세스" |
| `.r-cites` (글, 버튼 아님) | "KCI 피인용 {n}" (0도 보임) | — | "Europe PMC 피인용 {n}" |
| 초록 없음 `.r-noabs` | "초록이 없어요." | "RISS 검색 결과에는 초록이 없어요. 제목을 누르면 RISS에서 볼 수 있어요." | "초록이 없어요." |
| [인하대에서 보기] | DOI 있을 때만(7장 K-15 — `paperProxyTarget`이 이미 그렇게 됨) | 늘 | `paperProxyTarget` 결과대로 |
| [Google Scholar에서 보기] | 늘(명세 5장) — `scholarUrl(title)` | 늘 | 늘 |
| [무료 PDF 찾기] | DOI 있을 때(4장) | — (DOI 없음) | DOI 있을 때 |
| 참고문헌 · 관련 논문 · 그래프 | **DOI 있을 때만**(AD-6) | — | DOI 있을 때만 |

- **피인용 수는 그 소스의 숫자라 버튼으로 만들지 않음**(AD-6): 지금 "피인용 N" 버튼은 OpenAlex 인용 목록을 여는데, KCI · Europe PMC 숫자와 목록 편수가 달라 헷갈림.
- 원문 공개가 아니면 아무것도 붙이지 않음("유료" 칩 없음 — 소음).
- 배지 줄이 비면 `.r-badges`도 그리지 않음(기존 소스 카드 모양 유지).
- 등재 값은 화면이 만들지 않고 서버 `badges`를 그대로 씀. 모르는 값도 `esc()` 해서 그대로 칩 하나.

### 3.3 출처 한 줄 (`.result-src` — AC-583)
| 소스 | 문구 |
|---|---|
| KCI | "검색 결과 출처: KCI(한국연구재단)" |
| RISS | "검색 결과 출처: RISS(KERIS)" |
| Europe PMC | "검색 결과 출처: Europe PMC" |
- 카드 묶음 바로 아래, 쪽 넘기기 위. 결과 0편이면 없음. 기존 소스는 지금처럼 없음.

### 3.4 쪽 넘기기
- KCI · RISS: 지금 `pager` 그대로(쪽 번호 · 500쪽 상한).
- **Europe PMC(K-6)**: 커서라 전체 쪽 수를 모름 → "[← 이전]  {n}쪽  [다음 →]". [다음]은 `next_cursor`가 없으면 `disabled`, [이전]은 1쪽에서 `disabled`. 지나온 커서는 `ds.cursors` 배열(메모리)에 쌓고 [이전]은 하나 꺼냄. 검색어 · 소스 · 정렬 · 필터를 바꾸면 비움. 결과 수(`total`)는 머리 줄 "검색 결과 약 N건"에만.

### 3.5 불러오는 중
- "KCI에서 검색 중…" · "RISS에서 검색 중…" · "Europe PMC에서 검색 중…"(지금 "검색 중…"에 소스 이름만).

## 4. 무료 PDF 버튼 (U-3 · K-10~K-12)

세 상태를 **찾기 결과 카드와 서재 상세가 같은 이름 · 같은 문구**로 씀.

| 상태 | 서버 응답 | 버튼 · 글 |
|---|---|---|
| **① 서버가 받음** | 카드: `pdf_url` 있음, 또는 `oa/lookup`의 `server_fetch: true` / 서재: `fetch-pdf` → `{paper}`(대신 받았으면 `via: "substitute"` 포함) | 카드 [PDF 포함 추가] + 라이선스 칩 / 서재 바로 저장(대신 받았으면 4.1절 토스트) |
| **② 새 탭으로 열기** | 카드: `oa_open_url`, 또는 `server_fetch: false` / 서재: `{open_url, reason: "license_unknown"}` | [무료 PDF 열기 ↗] + 안내 "직접 받아 [PDF 첨부]로" |
| **③ 없음** | `oa: null` / 404 | "무료 PDF 없음" |

### 4.1 ① 서버가 받음
- 카드: [PDF 포함 추가] + `span.chip.success[data-oa-license]` **라이선스 이름**(AD-4) + `.sr-only` " 라이선스 — PaperLab이 받아 저장할 수 있어요". 칩 `title` "라이선스: CC BY — PaperLab이 받아 서재에 저장해요".
- 라이선스 이름표(`licenseLabel`, 허용 목록 값만): `cc-by` CC BY · `cc-by-sa` CC BY-SA · `cc-by-nc` CC BY-NC · `cc-by-nd` CC BY-ND · `cc-by-nc-sa` CC BY-NC-SA · `cc-by-nc-nd` CC BY-NC-ND · `cc0` CC0 · `public-domain` 퍼블릭 도메인. 목록 밖이면 `null`(칩 없음).
- arXiv(`pdf_url`이 arxiv.org)는 라이선스 칩 없이 지금 그대로 "[PDF] arxiv.org" 링크 + [PDF 포함 추가].
- 검색 결과에 처음부터 `pdf_url`이 있는 카드(OpenAlex · 허용 라이선스)는 지금 모양 그대로(칩 없음 — 카드에 라이선스 값이 없음).
- 서재: 토스트 "무료 PDF를 받아 저장했어요" — 응답에 `license`가 있으면 "무료 PDF를 받아 저장했어요 (CC BY)"(확인 필요 3번).
- **대신 받았을 때**(응답 `via: "substitute"` — 서재 주소가 규칙에 맞지 않아 같은 논문의 arXiv · 허용 라이선스 공개본을 받음, 사용자 결정 2026-10-13): 토스트 문구는 `sourcemeta.substituteText(license)` 하나.
  - 서재 [무료 PDF 찾기]: "같은 논문의 무료 공개본(라이선스 CC BY)을 받았어요"
  - 라이선스 이름이 없으면(arXiv 번호로 받음 · 빈 값 · `other-oa` 등 이름표 없는 값) 괄호를 뺌: "같은 논문의 무료 공개본을 받았어요"
  - 논문 찾기 [PDF 포함 추가]: "서재에 추가하고 같은 논문의 무료 공개본(라이선스 CC BY)을 받았어요" (괄호 규칙 같음)
  - 왜 "같은 논문의 무료 공개본"인가: 사용자가 넣은 주소의 파일이 아니라 **다른 주소의 파일**이라는 점을 알려 주려고. 종류 `success`. `via`가 없는 일반 저장 문구는 위 그대로.

### 4.2 ② 새 탭으로 열기 — 라이선스 미확인
- 버튼: `a.btn.sm`(서재는 `a.btn.primary`) "무료 PDF 열기" + `extMark("새 탭에서 열림 · 직접 받아 올려야 해요")`. `open_kind`가 `landing`이면 "무료 원문 페이지 열기"(확인 필요 3번).
- 툴팁(`title`): "라이선스를 확인하지 못한 PDF예요. 새 탭에서 직접 받아 [PDF 첨부]로 올려 주세요."
- **라이선스 이름은 보여 주지 않음**(AD-4): `other-oa` · `publisher-specific-oa` 같은 값은 뜻이 어렵고, "확인하지 못했어요"가 판단 이유를 그대로 말함.
- 안내 문구
  - 서재 상세(누르는 즉시 `[data-oa-after]`): "무료 PDF가 있지만 라이선스를 확인하지 못해 PaperLab이 대신 받지 않았어요. **[무료 PDF 열기]**로 직접 받은 뒤 **[PDF 첨부]**로 올려 주세요."
  - 카드(링크를 실제로 누른 뒤 — 1A G-5 방식, 카드 아래 `.notice.oa-after`): "라이선스를 확인하지 못해 PaperLab이 대신 받지 않아요. 직접 받은 뒤 서재에 추가하고 **[PDF 첨부]**로 올려 주세요." 20장 카드마다 미리 붙이면 소음이라 누른 카드에만.
- 링크는 `bindExtLink`를 쓰지 않음(학교 링크가 아니라 안내 창 대상 아님). 가운데 클릭 · Ctrl+클릭도 브라우저 기본.

### 4.3 ③ 없음
- 카드: 버튼 자리에 `span.oa-none` "무료 PDF 없음"(초점을 이리로).
- 서재: [무료 PDF 찾기] → `aria-disabled="true"` "무료 PDF 없음"(누르면 같은 안내를 다시 알림만) + `[data-oa-after]`
  - 인하대 버튼이 있을 때: "무료 PDF를 찾지 못했어요. 학교가 구독하는 논문이면 **[인하대에서 보기]**에서 받아 **[PDF 첨부]**로 올려 주세요."
  - 없을 때: "무료 PDF를 찾지 못했어요. PDF 파일이 있으면 **[PDF 첨부]**로 올려 주세요."
- 패널을 다시 그리면 원래 [무료 PDF 찾기]로 돌아감(저장하지 않음).

### 4.4 흐름 · 기타
- **카드**: [무료 PDF 찾기] → `aria-busy` + 스피너 "찾는 중"(`disabled`) → `POST /api/oa/lookup {doi}` → ①②③ 중 하나로 **그 자리에서 바꿈**. 오류(429 · 502 등)면 `errorToast` + 버튼 복구.
- **서재 상세**: 기존 [PDF 받기]의 **이름을 [무료 PDF 찾기]로**(AD-3) · 툴팁 "무료 PDF를 찾아요. 라이선스가 확인되면 바로 저장하고, 아니면 직접 받을 링크를 드려요." 누르면 "찾는 중" → `fetch-pdf` → ①(지금처럼 다시 그림) · ②(버튼을 링크로 바꾸고 안내) · ③. 502(받기 실패)는 지금처럼 `errorToast` + 버튼 복구.
- 서재 상세 [무료 PDF 찾기]는 **`doi` · `arxiv_id` · `pdf_url` 중 하나가 있을 때만**(AD-9). 셋 다 없으면 늘 404라 숨기고 [인하대에서 보기｜학교 DB에서 제목 검색] · [PDF 첨부]만.
- 함께 바꿀 문구: `library.js` 239행 토스트 "PDF가 없는 논문이에요. 상세 패널에서 무료 PDF를 찾거나 첨부해 주세요." · `reader.js` 252행 "… 무료 PDF는 서재 상세 패널의 [무료 PDF 찾기]로 찾을 수 있어요."
- 그래프 옆 패널 · 참고 패널 · 인용 관계 미니 목록 · 식별자로 추가 창의 [PDF 포함 추가]는 `pdf_url`이 있을 때만 보이는 지금 규칙 그대로 — 서버가 `pdf_url`을 U-3 규칙으로 채우면 자동으로 맞음(확인 필요 2번). 이 자리들에 [무료 PDF 열기]는 이번에 넣지 않음.

## 5. 인용 관계 — OpenCitations 보강 (9.2 · 9.3절)

```
[이 논문을 인용한 논문 | 참고문헌 | 관련 논문]
참고문헌 23편  (OpenCitations 기준)
OpenAlex에 참고문헌 정보가 없어 OpenCitations 자료로 채웠어요. 서지를 찾지 못한 4편은 목록에 없어요.
ImageNet classification with deep convolutional neural networks
Krizhevsky A, Sutskever I · NeurIPS · 2012 · 인용 120,000
[＋ 서재에 추가]
```

### 5.1 출처 표기 (`via: "opencitations"`)
- 서재 상세 "인용 관계" 탭 [참고문헌]과 논문 찾기의 "…의 참고문헌" 목록(`drawGraph`) 둘 다 같은 도우미(`viaLine(res)`).
- 첫 줄 `.via-line`: "참고문헌 {total}편" + `span.chip` "OpenCitations 기준"(`title` "OpenCitations(CC0) 참고문헌 자료예요"). AC-586 글자 그대로.
- 둘째 줄 `.via-note`: "OpenAlex에 참고문헌 정보가 없어 OpenCitations 자료로 채웠어요." + `unresolved > 0`이면 " 서지를 찾지 못한 {n}편은 목록에 없어요."
- `via`가 없으면 지금 줄("23편") 그대로. 피인용 · 관련 논문 목록은 바꾸지 않음.
- 불러오는 중: [참고문헌]일 때만 "참고문헌을 불러오는 중… OpenAlex에 없으면 OpenCitations에서 찾아요"(OpenCitations가 3초 넘게 걸릴 수 있음 — 1st My paper 실측). 다른 탭은 지금 "OpenAlex에서 불러오는 중…".

### 5.2 실패 `oc_failed`
| 곳 | 경우 | 모양 · 문구 |
|---|---|---|
| 인용 관계 탭 · 찾기 참고문헌 | OpenAlex 0편 + OpenCitations 실패(확인 필요 4번 — 응답에 `warnings`) | `.notice[data-tone=warn][data-code=oc_failed]` "OpenAlex에 참고문헌 정보가 없고, OpenCitations도 응답하지 않았어요. 잠시 후 다시 시도해 주세요." + [다시 시도](`load("references")`). 빈 상태 "결과가 없어요"는 대신 그리지 않음 |
| 인용 그래프 | `oc_failed`만 | **알림 톤 info**로(AD-8 — `INFO_CODES`에 넣어 "일부 정보 없이 그렸어요"(warn)에 섞지 않음). **문구는 그래프 응답 `refs_via`로 고름(D6)**: `s2`(S2가 실제로 채움)일 때만 "OpenCitations가 응답하지 않아 Semantic Scholar 자료로 참고문헌을 채웠어요.", 그 밖(S2도 0편 등)이면 서버 문구 **"OpenCitations가 응답하지 않아 참고문헌을 보강하지 못했어요."**를 그대로 씀. 앞 안은 `oc_failed`만 있으면 늘 "채웠어요"라고 해서, 채우지 못한 경우에도 거짓으로 읽혔음 |
| 인용 그래프 | `oc_failed` + `s2_failed` | warn 묶음 한 줄로 합침: "OpenCitations와 Semantic Scholar가 응답하지 않아 참고문헌을 보강하지 못했어요." (`s2_failed` 줄은 따로 내지 않음 — `groupNotices` 순수 함수) |
| 인용 그래프 아래 출처 | 씨앗 참고문헌을 OpenCitations로 채움 | "OpenAlex · OpenCitations 기준 · {날짜}"(확인 필요 5번 — 응답 표시가 있을 때만, 없으면 지금 그대로) |

## 6. 오류 · 빈 상태

### 6.1 검색 오류 (`searchErrorView(code, source)` → `.notice[data-tone=warn][data-search-error]`)
| code | 굵은 첫 문장 | 이어지는 글 | 버튼(`.notice-actions`) |
|---|---|---|---|
| `source_unconfigured` KCI | KCI 검색을 아직 쓸 수 없어요. | 관리자가 KCI 키를 등록하면 쓸 수 있어요. | [OpenAlex로 검색] |
| `source_unconfigured` RISS | RISS 검색을 아직 쓸 수 없어요. | RISS 키를 받으면 쓸 수 있어요. 지금은 학교 DB 바로가기로 찾아 주세요. | [RISS에서 이 검색어로 찾기 ↗](`inhaSearchUrl("riss", q)` + `openExternal` — 1A 안내 창 규칙 그대로) |
| `source_key_invalid` (키 만료 · 틀림) | {KCI｜RISS} 키가 맞지 않거나 사용기간이 끝났어요. | 관리자에게 알려 주세요. 그동안은 다른 데이터베이스를 골라 주세요. | [OpenAlex로 검색] (RISS면 + [RISS에서 이 검색어로 찾기 ↗]) |
| `upstream_limited` (호출 제한) | {이름}에 요청이 많아 잠시 막혔어요. | KCI · RISS: "PaperLab 사용자가 같은 공용 키를 함께 써서 생길 수 있어요. 잠시 후 다시 시도해 주세요." / Europe PMC: "잠시 후 다시 시도해 주세요." | [다시 시도] |
| `upstream_unavailable` (장애 · 응답 이상) | {이름}에 연결할 수 없어요. | 서비스가 점검 중이거나 잠시 응답하지 않아요. 잠시 후 다시 시도해 주세요. | [다시 시도] [OpenAlex로 검색] |
| `search_busy` | 앞의 검색이 아직 끝나지 않았어요. | 끝난 뒤 다시 시도해 주세요. | [다시 시도] |
| `unsupported_option` (화면이 막아 보통 안 생김) | {이름}는 이 정렬·필터를 지원하지 않아요. | 관련도순으로 다시 검색해 보세요. | [관련도순으로 검색] |
| 그 밖 · code 없음 | — | 지금처럼 `.status-line.bad`에 서버 `detail` | — |

- [OpenAlex로 검색]: 소스를 OpenAlex로 바꾸고 같은 검색어로 다시 검색(정렬 · 필터 유지). [다시 시도]: 같은 조건으로 `search()`.
- `source_unconfigured`를 받으면 그 소스를 메모리에서 꺼진 것으로 바꾸고 목록 · `[data-src-off]`를 다시 그림(새로 고침 없이 2장 상태와 맞춤). 옵션 "(키 등록 전)" 비활성 · OpenAlex로 되돌림 · 이유 줄 "KCI를 지금 쓸 수 없어 OpenAlex로 바꿨어요."(2.1절 — D8).
- 문구에 요청 주소 · 키 · 검색어를 넣지 않음(서버 `detail`을 쓰지 않고 code로 고름 — 명세 6.5).
- 오류 상자가 나타나면 초점은 옮기지 않고 `[data-discover-live]`로 굵은 첫 문장을 알림.

### 6.2 빈 결과 (`items: []`)
| 소스 | 문구 |
|---|---|
| 공통(지금) | "결과가 없어요. 검색어를 바꾸거나 다른 데이터베이스를 골라 보세요." |
| KCI 덧붙임 | "KCI는 논문 제목으로 찾아요. 제목에 들어갈 낱말로 바꿔 보세요." |
| Europe PMC 덧붙임 | "Europe PMC에는 생명과학 · 의학 논문만 있어요. 다른 분야는 OpenAlex에서 찾아 보세요." |
| RISS | 공통만 |

### 6.3 무료 PDF 조회 오류
- `oa/lookup` · `fetch-pdf` 실패(429 · 502 · 연결 오류): `errorToast(e)`(서버 문구) + 버튼 복구. 상태 ③(없음)과 섞지 않음 — "없음"은 404 · `oa: null`일 때만.

## 7. 접근성 · 좁은 화면

### 7.1 비활성 항목 aria
| 곳 | 방법 |
|---|---|
| 소스 `option[disabled]` | 기본 비활성(화면 읽기가 "사용할 수 없음"으로 읽음) + 글자 "(키 등록 전)". `select[aria-describedby="src-off-note"]`로 이유 줄을 함께 읽음 |
| 정렬 버튼 · 체크 상자 | 기본 `disabled`. `.discover-filters[aria-describedby="src-limit-note"]`로 이유 줄 연결 |
| 서재 "무료 PDF 없음" | `aria-disabled="true"`(초점 · 툴팁 유지 — 4단계와 같음), 누르면 `[data-oa-after]` 문구를 다시 알림만 |
| 라이선스 칩 | 칩 글자 "CC BY" + `.sr-only` " 라이선스 — PaperLab이 받아 저장할 수 있어요" |
| 새 탭 링크 | `extMark(…)`의 `.sr-only` "(새 탭에서 열림 · …)" |
| 배지 줄 | 칩은 글자로 뜻을 다 말함(색만으로 구분 안 함). `.src-chip`은 테두리 · 굵기로 등재 칩과 구분 |

### 7.2 키보드 순서
1. 검색창 → 소스 선택 → [검색] → [AI로 찾기] → 기간 부터 · 까지 → 정렬(지원하는 버튼만) → 무료 PDF 체크(지원할 때만) → 학교 DB 버튼들.
2. 결과: 처음 안내 ✕ → 오류 상자 버튼 → 카드마다 제목 링크 → [＋ 서재에 추가] → [무료 PDF 찾기｜PDF 포함 추가｜무료 PDF 열기] → 인용 → 참고문헌 → 관련 논문 → 그래프 → 인하대에서 보기 → Google Scholar → (다음 카드) → [← 이전] [다음 →].
3. [무료 PDF 찾기]가 바뀌면 **초점을 바뀐 자리로**: ① [PDF 포함 추가] ② [무료 PDF 열기] ③ `span.oa-none`(`tabindex=-1`). 서재 상세도 같음(② 링크, ③ 같은 버튼 유지).
4. Enter · Space: 모두 기본 버튼 · 링크 동작. 새 창 · 메뉴가 없어 Esc 동작 추가 없음(1A 안내 창은 기존 `modal` 그대로).
5. 초점 테두리: 기존 `.btn` · 링크 기본 + `.seg` 버튼은 지금 규칙.

### 7.3 화면 읽기 알림 (`[data-discover-live]` · 서재는 `[data-oa-after][role=status]`)
- "KCI는 피인용순을 지원하지 않아 관련도순으로 바꿨어요" · "CC BY 라이선스 PDF를 찾았어요. PDF 포함 추가를 누르면 서재에 넣고 저장해요" · "무료 PDF가 있지만 라이선스를 확인하지 못했어요. 새 탭에서 직접 받아 주세요" · "무료 PDF를 찾지 못했어요" · 검색 오류의 첫 문장.

### 7.4 좁은 화면 · 테마
- 560px 이하(CSS 반영): 머리 · 결과 양옆 **16px**, 검색창은 한 줄 전체, 소스 선택은 [검색] · [AI로 찾기]와 둘째 줄을 나눠 씀(`flex: 1 1 120px`). 카드 버튼 · 배지 · 이유 줄은 줄바꿈. 390 · 375px 가로 넘침 없음(9장).
- **560px 이하에서는 `.discover-view` 전체가 스크롤**되고 결과 상자(`.discover-results`)의 고정 높이를 풂(`flex: none; overflow: visible` — D7). 머리(검색 · 필터 · 이유 줄)가 결과와 함께 올라가므로, 머리가 화면을 다 덮어 결과가 안 보이는 일이 없음. 560px 넘는 화면은 바꾸지 않음. (구현: `app.css` 좁은 화면 블록)
- 900px 이하에서 서재 상세 패널이 숨는 것은 지금 한계 그대로(이번 범위 밖).
- 다크: 새 색 없음. `.src-chip`은 `--surface` 바탕 + `--border-strong` 테두리 + `--text`, 원문 공개 `.chip.success`, 등재 `.chip.accent`, 이유 줄 `--text-2`, 출처 · 초록 없음 · via 줄 `--text-3`(두 테마 모두 기존 AA 값).

## 8. 개발팀 훅 요약
| 파일 | 할 일 |
|---|---|
| `discover.js` | `SOURCES`에 3개 + `optgroup`, `GET /api/sources` 한 번, 2장 비활성 · 이유 줄 · 자동 되돌림, 3장 카드 칸 · 출처 줄 · EPMC 커서 쪽 넘기기, 4장 카드 무료 PDF 흐름, 5장 `viaLine`(찾기 참고문헌), 6장 `searchErrorView`, `[data-discover-live]` |
| `library.js` | [PDF 받기] → [무료 PDF 찾기](AD-3 · AD-9), `open_url` · 404 처리 · `[data-oa-after]`, 239행 문구, `relatedView`의 `viaLine` · `oc_failed` |
| `reader.js` | 252행 문구만 |
| `graphmath.js` · `graph.js` | `WARN_TEXT` · `INFO_CODES`에 `oc_failed`, `oc_failed`+`s2_failed` 합치기, 출처 줄(5.2절) |
| 순수 모듈(새, 이름 자유) | `SOURCE_META`(이름 · 설명 · 묶음 · 지원 정렬/필터 · 체크 상자 글자 · 출처 줄) · `sourceLimits` · `licenseLabel` · `searchErrorView` — `tests/js/sources.test.mjs`(AC-581) |
| `dialogs.js` | [PDF 포함 추가] 대신 받기 토스트만 변경(4.1절 — "서재에 추가하고 " + `substituteText`). 설정 창은 변경 없음(U-1) |

## 9. 확인 결과 · 못 한 것
- 정적 시험 페이지: scratchpad `p5/index.html`(저장소 밖 — 소스 선택 · 이유 줄 · 처음 안내 · KCI/RISS/EPMC 카드 · 세 무료 PDF 상태 · 출처 줄 · EPMC 쪽 넘기기 · 오류 상자 · 서재 상세 · OpenCitations 줄)을 로컬 서버로 띄워 **1280 · 900 · 375px × 밝은 · 어두운 테마** 확인. 375px `scrollWidth = 375`(넘침 0개), 머리 양옆 16px, 소스 선택 161px · [AI로 찾기]가 같은 줄.
- 확인 못 함: 실제 앱(구현 전), 실제 KCI · RISS · Europe PMC 응답 길이(긴 학술지명 · 등재 값 모양), `option[disabled]` · `aria-describedby`의 NVDA 낭독, 팝업 차단 동작(링크 방식이라 문제없을 것으로 봄 — AC-585 수동 확인). 브라우저 창 캡처가 자주 시간 초과돼 일부(어두운 테마 아래쪽)는 계산값 · 부분 캡처로만 봄.

## 10. 확인 필요 · 기획과 맞출 곳
1. **[PDF 포함 추가]가 클라이언트 주소로 받음**: 지금 `POST /api/papers`의 `download_pdf`는 요청 본문의 `pdf_url`을 서버가 받음(`server.py` `add_paper`). [무료 PDF 찾기] 뒤의 [PDF 포함 추가]가 조회 결과 주소를 본문에 실어 보내면 K-11("무료 PDF 경로는 서버가 정한 주소만")과 어긋남. 디자인 추천: 화면은 같은 버튼 하나로 두고, 서버가 `add_paper`에서도 8.3절 판정을 다시 하거나(추천), 화면이 [서재 추가 → `fetch-pdf`] 두 번 부르기. 어느 쪽인지 기획 · 개발 결정 필요.
2. **Semantic Scholar · Crossref 카드의 `pdf_url`**: 지금 `norm_s2`(`openAccessPdf`) · Crossref `link`가 카드 `pdf_url`을 채워 [PDF 포함 추가]로 서버가 받음. 명세 8.3절은 OpenAlex 카드 · `lookup_doi`만 다룸 → U-3대로라면 이 둘도 `oa_open_url`(새 탭)로 옮겨야 함. 기획 확인 필요.
3. **응답 모양 두 가지 추가 요청**: `fetch-pdf` · `oa/lookup`의 새 탭 응답에 PDF인지 논문 페이지인지(`open_kind: "pdf"｜"landing"` 등 — 버튼 글자 "무료 PDF 열기"/"무료 원문 페이지 열기"), `fetch-pdf` 저장 성공 응답에 `license`(토스트용, 없어도 동작).
4. **인용 관계 탭의 OpenCitations 실패**: 명세는 `oc_failed`를 그래프 경고로만 정함. 탭(`related`)에서 OpenCitations가 실패하면 지금은 0편 · 오류 구분이 안 됨 → `related` 응답에 `warnings: [{code:"oc_failed"}]`를 넣어 줄지 기획 결정.
5. **그래프 출처 줄**: 씨앗 참고문헌을 OpenCitations로 채웠다는 표시가 그래프 응답에 없음. 넣을지(선택).
6. 명세 5장의 카드 [Google Scholar]: 지금 일반 카드에는 없고 AI로 찾기 카드에만 있음 → **새 소스 카드에만** 넣음(기존 소스 카드는 그대로). 전체에 넣을지는 따로.
7. RISS `charge`(무료 원문) 체크 상자 글자를 "무료 원문 있는 논문만"으로 바꾸는 것(2.3절)이 명세 6.4절 "무료 PDF만" 매핑과 같은 매개변수인지 확인만.

## 11. 팀장 결정 (디자인팀 추천안)

| # | 항목 | 추천 | 다른 안 |
|---|---|---|---|
| AD-1 | 소스 목록 모양 | 지금 `select` + `optgroup` 3묶음 + `option[disabled]`, 이유는 아래 한 줄 | 새 목록 상자(listbox)를 만들어 항목마다 이유 — 새 패턴 · 키보드 처리 부담 |
| AD-2 | 미지원 정렬 · 필터 | 기본 `disabled` + 늘 보이는 이유 줄, 고른 값이 미지원이면 기본값으로 되돌리고 알림 | `aria-disabled`(초점 유지)로 두고 누르면 알림 |
| AD-3 | 서재 [PDF 받기] 이름 | **[무료 PDF 찾기]** — 결과가 저장 · 새 탭 · 없음 셋이라 "받기"는 맞지 않음, 찾기 카드와 같은 이름 | [PDF 받기] 유지, 결과만 다르게 |
| AD-4 | 라이선스 이름 표시 | 서버가 받을 때만 허용 목록 이름(CC BY 등)을 칩으로, 새 탭일 때는 이름 없이 "라이선스를 확인하지 못했어요" | 새 탭일 때도 원래 값(`other-oa` 등)을 보임 |
| AD-5 | 소스 칩 | 새 3개 소스 카드에만 | 모든 카드에(기존 화면도 바뀜) · 아예 없음(출처 줄만) |
| AD-6 | 새 소스 카드의 피인용 · 참고문헌 · 그래프 | 피인용 수는 소스 이름을 붙인 글(버튼 아님), 참고문헌 · 관련 논문 · 그래프는 DOI 있을 때만 | 지금처럼 버튼(OpenAlex 목록 — 숫자와 편수가 다름) |
| AD-7 | 처음 KCI · RISS 안내 | 결과 위 알림 + ✕(이 브라우저에 기억) | 처음 한 번 창(modal) |
| AD-8 | 그래프 `oc_failed` 톤 | S2가 채웠으면 info, 둘 다 실패면 warn 한 줄로 합침 | 늘 warn("일부 정보 없이 그렸어요"에 포함) |
| AD-9 | 서재 [무료 PDF 찾기] 표시 조건 | `doi` · `arxiv_id` · `pdf_url` 중 하나가 있을 때만 | 지금처럼 늘(눌러야 404) |
