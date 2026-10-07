# 인하대 기관 프록시(openlink) 링크 · Google Scholar 바로가기 — 기능 명세

- 작성: 기획팀 · 2026-10-07 (저장소 `study99web`, 브랜치 `claude/paper-program-hrrhl2`, 기준 커밋 `d23e523`)
- 근거: 사용자 결정 2026-10-07 — PLAN 5단계 ⑤ "국내 DB · 기관 연동" 가운데 **학교 프록시 링크만 앞당겨 먼저** 넣음(PLAN **1A단계** — 다음은 1B 인용 그래프, 그다음 2단계). 같은 날 사용자 승인 — **"Google Scholar에서 보기" 버튼을 함께 넣음**.
- 개정 2026-10-07: 사용자 · 팀장 결정 반영 — IU-1 · IU-5 확정, IK-1~IK-10 확정, 개발팀 판단 승인(IDN · 루트 호스트 · doi.org 처리 · 서로게이트), 디자인 결정 D-1~D-6, [학교 로그인]은 설정 창에만, IU-2 · 3 · 4 · 6은 배포 뒤 사용자 수동 확인. 결정 목록은 15.3절
- 표기: **확정** = 사용자 결정, **팀장 원칙/결정** = 팀장이 정함, **기획팀 추천** = 팀장 결정 전 안(15.2절 `IK…` — 지금은 모두 확정), **가정** = 기획팀 임시값, **사용자 확인 항목** = 15.1절 `IU…`, **확인됨** = 기획팀이 2026-10-07에 공개 응답으로 확인함(로그인 없이, 읽기만), **확인 필요** = 로그인 상태 등에서만 알 수 있어 아직 모름

---

## 1. 목적

인하대 정석학술정보관이 구독하는 논문(DBpia · KISS · RISS · 해외 출판사)을 **집이나 다른 기기에서** 볼 수 있게, PaperLab 화면에서 **학교 프록시(openlink) 주소로 바로 여는 링크**를 줍니다. 받은 PDF는 사용자가 직접 PaperLab에 올립니다. 같은 자리에 **Google Scholar 검색 바로가기**도 둡니다.

## 2. 확정된 결정과 원칙

| 항목 | 내용 | 구분 |
|---|---|---|
| 앞당김 | PLAN 5단계 ⑤ 중 "학교 프록시 링크"만 먼저 넣음. KCI · RISS API 검색, Unpaywall 등은 그대로 5단계 | 확정 |
| 학교 | 사용자 3~5명 **모두 인하대**. 사용자별 학교 설정은 만들지 않음. 코드에서는 **상수 한 곳**(`extlinks.js`의 `INHA`)에만 둠 | 확정 |
| 대리 로그인 금지 | 서버가 학교 계정으로 로그인하거나 학교 계정 정보를 받거나 저장하지 않음. 로그인은 사용자가 **학교 화면에서 직접** 함 | 팀장 원칙 |
| 자동 수집 금지 | 서버도 브라우저 코드도 openlink 주소로 **요청을 보내지 않음**(본문 · PDF 자동 다운로드 금지, 구독 계약 위반 · 학교 전체 차단 위험). 프록시 주소는 **사용자 브라우저에서 새 탭으로 열기만** 함 | 팀장 원칙 |
| 서버 연동 없음 | 서버가 학교 시스템과 대리 로그인하거나 연동하는 기능은 만들지 않음(사용자 질문에 대한 팀장 답변 취지) | 팀장 원칙 |
| PDF 올리기 | 학교 사이트에서 받은 PDF는 사용자가 PaperLab의 기존 업로드 기능([PDF 첨부] · PDF 추가)으로 올림 | 팀장 원칙 |
| Scholar | `https://scholar.google.com/scholar?q=<질의>` **한 가지 형식만** 쓰고 새 탭으로 엶. 서버 호출 · 스크래핑 · 결과 가져오기는 금지(Google 약관). Scholar 주소는 openlink 프록시로 **감싸지 않음**(Scholar는 프록시 대상이 아님) | 확정(사용자 승인) · 팀장 지시 |

## 3. 범위

### 하는 것

1. **주소 변환**: 출판사 · DB 주소를 인하대 openlink 프록시 주소로 바꾸는 순수 함수(5장)
2. **DOI 링크**: 논문 DOI를 프록시 경유 `doi.org` 주소로 바꿈(6장 — 기본안 (a))
3. **"인하대에서 보기"**: 논문 찾기 결과 카드, 서재 상세 패널, 읽기 화면(PDF 없는 논문)(8장)
4. **학교 DB 검색 바로가기**: 논문 찾기 화면에서 현재 검색어로 **RISS · DBpia · KISS**를 프록시 경유로 엶(7장)
5. **"Google Scholar에서 보기"**: 논문 찾기 검색창(현재 검색어) + 서재 상세 패널(논문 제목)(9장)
6. **"학교 로그인" 버튼**: 설정 창 "학교 연결 (인하대)" 구역에만 둠. 미리 로그인해 두고 싶을 때 도서관 로그인 화면(`https://lib.inha.ac.kr/login`)을 새 탭으로 엶(8.5절). 프록시 링크는 로그인 전에도 openlink가 로그인을 요구하고 원래 주소로 돌아감(가정 — M-1)
7. **안내**: 처음 쓸 때 안내 창, 받은 PDF 올리는 흐름, Scholar 도서관 링크 안내(10장)
8. **자동 테스트**: 변환 · DOI · 검색 · Scholar 링크 단위 테스트(13.1절)

### 안 하는 것 (범위 밖)

- 서버의 학교 대리 로그인, 학교 아이디 · 비밀번호 입력 칸 · 저장 · 전달
- 서버나 브라우저 코드가 openlink · 출판사 · Scholar에 요청을 보내는 일(링크가 살아 있는지 검사, "구독 중" 표시를 위한 조회, 등록 사이트 목록 받기 포함)
- 프록시 경유 PDF 자동 다운로드 · 자동 첨부, 여러 편 한꺼번에 열기
- 브라우저 확장 프로그램, 북마클릿
- Scholar 검색 결과를 PaperLab 안에 보여 주기, Scholar 주소에 다른 매개변수 붙이기
- 사용자별 학교 선택 · 설정 화면, 다른 학교 지원
- KISS · DBpia · RISS의 API 검색(5단계 ⑤ 그대로)
- 2단계 Electron 앱 쪽 구현(12장에 연결 항목으로 기록만)

## 4. 지금 코드 (바뀌는 지점)

| 파일 | 지금 | 바뀌는 점 |
|---|---|---|
| `paperlab/static/js/discover.js` | 검색창 · 소스 선택 · 결과 카드(`resultCard` — 제목 링크 · [PDF] 링크) | 검색창 아래 "학교 DB에서 찾기" 줄(RISS · DBpia · KISS · Google Scholar — [학교 로그인]은 없음), 결과 카드에 "인하대에서 보기" |
| `paperlab/static/js/library.js` | 상세 패널(`renderDetail`) — PDF 없으면 [PDF 받기][PDF 첨부], 정보 탭에 DOI 링크(`https://doi.org/…`) | "인하대에서 보기" · "Google Scholar에서 보기", PDF를 받은 뒤 올리기 안내 |
| `paperlab/static/js/reader.js` | PDF 없는 논문: "PDF가 없어요 — 서재 상세 패널에서 PDF를 받거나 첨부해 주세요"(155~157행) | 빈 화면에 [인하대에서 보기] · [PDF 첨부] |
| `paperlab/static/js/dialogs.js` | 업로드 창(`uploadPdfs`) 등 | 처음 쓸 때 안내 창(`inhaGuideDialog`) 추가 |
| `paperlab/static/js/ui.js` | `safeUrl`(http/https 검사만) | 바꾸지 않음. 새 링크는 새 모듈 `extlinks.js`로 만듦 |
| `paperlab/sources.py` · `server.py` | doi.org를 쓰지 않음. `download_pdf`에 SSRF 방어 있음 | **기본안 (a)면 바꾸지 않음**. (b)를 쓰게 되면 6.3절 API 추가 |
| `paperlab/server.py` 249행 | 응답에 `Referrer-Policy: same-origin` | 그대로(다른 사이트로 PaperLab 주소가 넘어가지 않음 — 새 링크에는 `rel="noopener noreferrer"`도 붙임) |

## 5. 주소 변환 규칙 (프록시)

### 5.1 확인 결과 (확인됨 2026-10-07 — 로그인 없이 프록시 주소에 GET 한 번씩, 응답 헤더만 봄)

등록된 사이트의 프록시 주소는 `302 Found`로 **`https://openlink.inha.ac.kr/authredirect.n2s?url=<원래 주소>`**(학교 인증 중계)로 넘어갑니다. 이 `url=` 값으로 프록시가 주소를 어떻게 되돌려 읽는지 확인할 수 있었습니다. 등록되지 않은 것으로 보이는 사이트는 302 없이 openlink가 직접 응답했습니다(확인 도구가 응답을 읽지 못함 — 내용은 **확인 필요**, 학교 안내 · 오류 페이지로 추정).

| 프록시 주소(시험한 것) | 결과 | 프록시가 읽은 원래 주소(`url=`) |
|---|---|---|
| `https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/` | 302 → 인증 중계 | `https://www.dbpia.co.kr/` |
| `https://kiss-kstudy-com-ssl.openlink.inha.ac.kr/` | 302 → 인증 중계 | `https://kiss.kstudy.com/` |
| `https://www-riss-kr-ssl.openlink.inha.ac.kr/index.do` | 302 → 인증 중계 | `https://www.riss.kr/index.do` |
| `https://www-riss-kr-ssl.openlink.inha.ac.kr/search/Search.do?query=%EB%94%A5%EB%9F%AC%EB%8B%9D&isDetailSearch=N` | 302 → 인증 중계 | 경로 · 쿼리 · 퍼센트 인코딩 그대로 유지 |
| `https://doi-org-ssl.openlink.inha.ac.kr/10.1109/CVPR.2016.90` | 302 → 인증 중계 | `https://doi.org/10.1109/CVPR.2016.90`(경로 대문자 유지) |
| `https://www-sciencedirect-com-ssl.openlink.inha.ac.kr/` | 302 → 인증 중계 | `https://www.sciencedirect.com/` |
| `https://linkinghub-elsevier-com-ssl.openlink.inha.ac.kr/retrieve/pii/S0893608014002135` | 302 → 인증 중계 | `https://linkinghub.elsevier.com/retrieve/pii/…` |
| `https://link-springer-com-ssl.openlink.inha.ac.kr/` | 302 → 인증 중계 | `https://link.springer.com/` |
| `https://ieeexplore-ieee-org-ssl.openlink.inha.ac.kr/` | 302 → 인증 중계 | `https://ieeexplore.ieee.org/` |
| `https://onlinelibrary-wiley-com-ssl.openlink.inha.ac.kr/` | 302 → 인증 중계 | `https://onlinelibrary.wiley.com/` |
| `https://www-nature-com-ssl.openlink.inha.ac.kr/` | 302 → 인증 중계 | `https://www.nature.com/` |
| `https://scholar-kyobobook-co-kr-ssl.openlink.inha.ac.kr/` | 302 → 인증 중계 | `https://scholar.kyobobook.co.kr/` |
| **http 사이트**: `https://www-riss-kr.openlink.inha.ac.kr/` (`-ssl` 없음) | 302 → 인증 중계 | **`http://www.riss.kr/`** — `-ssl`이 없으면 원래 주소를 http로 읽음. 프록시 주소 자체는 https로 열림 |
| **http 사이트**: `https://ieeexplore-ieee-org.openlink.inha.ac.kr/document/7780459/` | 302 → 인증 중계 | `http://ieeexplore.ieee.org/document/7780459/` |
| **하이픈**: `https://www-thieme--connect-com-ssl.openlink.inha.ac.kr/` | 302 → 인증 중계 | **`https://www.thieme-connect.com/`** — 원래 하이픈은 `--`로 씀 |
| 하이픈을 그대로 둔 `https://www-thieme-connect-com-ssl.openlink.inha.ac.kr/` | 302 없음(직접 응답) | (`www.thieme.connect.com`으로 읽혀 미등록으로 보임) |
| 대조: `www-example-com-ssl` · `www-wikipedia-org-ssl` · `www-kci-go-kr-ssl` | 302 없음(직접 응답) | 미등록으로 보임(KCI는 무료라 프록시에 없음) |
| `https://openlink.inha.ac.kr/` · `authredirect.n2s?url=…` 페이지 자체 | 확인 도구가 응답을 읽지 못함 | 로그인 화면 모양 · 주소 **확인 필요** |

해석: 인하대 openlink는 EZproxy와 같은 **호스트 이름 방식(proxy by hostname)** 입니다. 원래 host에서 **`-` → `--`, `.` → `-`**, https면 끝에 **`-ssl`**, 뒤에 **`.openlink.inha.ac.kr`** 를 붙이고, 경로 · 쿼리는 그대로 둡니다. 302는 등록된 사이트라는 신호로 보이지만 **로그인 뒤 실제 본문이 열리는지는 확인 필요**(사용자 로그인 상태 — 13.2절 M-1 · M-2).

### 5.2 규칙 — `toInhaProxy(url) → string | null`

입력은 절대 주소 문자열. 변환할 수 없으면 `null`을 돌려주고, 화면은 그 경우 버튼을 숨깁니다(오류 창을 띄우지 않음).

1. `new URL(url)`로 해석합니다. 해석 실패 · 상대 주소 · 빈 값이면 `null`.
2. **스킴**: `http:` · `https:`만 받습니다. 그 밖(`javascript:` · `data:` · `ftp:` · `file:` 등)은 `null`.
3. **계정 정보**: `username` · `password`가 있으면 `null`.
4. **호스트**: URL API가 소문자 · 퓨니코드(ASCII)로 바꾼 `hostname`을 씁니다. 끝의 `.`은 뗍니다.
   - IP 주소(IPv4 · `[IPv6]`)이거나 점이 없는 이름(`localhost` 등)이면 `null`.
   - 이미 프록시 주소(`*.openlink.inha.ac.kr`)면 **변환하지 않고** `https:`로 맞춘 그 주소를 돌려줍니다(두 번 감싸지 않음). **`openlink.inha.ac.kr` 루트 호스트 자체는 `null`**(프록시 대상 주소가 아님 — 팀장 승인 2026-10-07).
   - 마지막 라벨이 `ssl`인 호스트는 `null`(`-ssl` 접미와 겹쳐 되돌릴 수 없음 — 실제로는 없음).
   - **라벨 문자 제한**: 원래 호스트를 `.`로 나눈 **모든 라벨이 `^[a-z0-9-]+$`에 맞아야** 합니다(빈 라벨 · `_` · 그 밖의 문자가 있으면 `null`). 그리고 **6단계에서 만든 라벨이 `xn--`로 시작하면 `null`**(첫 라벨이 IDN인 경우 + 알려진 제약: `xn-a.com`처럼 `xn-`로 시작하는 라벨도 하이픈이 두 배가 되어 걸림 — AC-1a I-1e). 브라우저마다 퓨니코드 처리가 달라 8단계 재해석에 기대지 않고 함수가 명시적으로 거부합니다(팀장 승인 2026-10-07 — 개발팀 수정).
5. **포트**: 기본 포트(https 443 · http 80)는 URL API가 지우므로 그대로 진행합니다. **기본이 아닌 포트가 있으면 `null`**(가정 — 프록시의 포트 표기 형식이 확인 필요, IK-8).
6. **라벨 만들기**: `label = host.replaceAll("-", "--").replaceAll(".", "-")` (**하이픈 먼저, 점 나중**) + (https면 `"-ssl"`, http면 없음).
   - `label`이 **63자를 넘으면 `null`**(DNS 라벨 한도 — 그 주소는 열리지 않음).
7. **결과**: `"https://" + label + ".openlink.inha.ac.kr" + pathname + search + hash`. 프록시 주소는 원래 스킴과 상관없이 **항상 https**입니다(확인됨). 경로 · 쿼리는 URL API가 정규화한 값을 그대로 쓰고 다시 인코딩하지 않습니다. `#…`은 그대로 붙입니다(서버로 가지 않으므로 무해).
8. **출력 검사(보안)**: 만든 문자열을 다시 `new URL()`로 해석해 `protocol === "https:"`, `hostname`이 `.openlink.inha.ac.kr`로 끝남, `username` · `password` · `port`가 비어 있음을 **모두** 확인합니다. 하나라도 어긋나면 `null`.

- **IDN(한글 도메인)** (팀장 승인 2026-10-07 — 개발팀 판단): 4단계에서 퓨니코드가 되므로 `xn--` 안의 `--`도 6단계에서 `----`가 됩니다.
  - **첫 라벨이 IDN**(예: `한국.kr` → `xn--3e0b707e.kr`)이면 만든 라벨이 `xn----3e0b707e-kr-ssl`처럼 **`xn--`로 시작**하게 되는데, 브라우저마다 퓨니코드 처리가 달라 4단계 "라벨 문자 제한"에서 첫 라벨 `xn--`를 명시적으로 거부합니다 → **`null`**.
  - **첫 라벨이 IDN이 아니면**(예: `www.한국.kr` → `www-xn----3e0b707e-kr-ssl`) 변환합니다. 프록시가 실제로 그렇게 읽는지는 확인 필요(등록된 IDN 사이트를 찾지 못함 — 학술 DB에는 드묾).

### 5.3 프록시로 감싸지 않는 주소 (`paperProxyTarget`에서만 적용)

논문의 `url`을 프록시로 바꿀 때, 다음 호스트는 무료이거나 프록시에 없어서 감싸지 않습니다(버튼 숨김). **가정** — 목록은 `extlinks.js` 상수 한 곳.

| 호스트 | 이유 |
|---|---|
| `arxiv.org` · `*.arxiv.org` | 무료 원문 |
| `openalex.org` · `*.openalex.org` | 메타데이터 사이트 |
| `semanticscholar.org` · `*.semanticscholar.org` | 메타데이터 사이트 |
| `www.kci.go.kr` · `kci.go.kr` | 무료, 프록시에 없음(확인됨 — 302 없음) |
| `scholar.google.com` | Scholar는 프록시 대상 아님 |

## 6. DOI 처리

### 6.1 선택지 비교

| | (a) 프록시 경유 `doi.org`를 바로 엶 | (b) 서버가 DOI의 출판사 주소를 알아내 프록시로 바꿈 |
|---|---|---|
| 방법 | `https://doi-org-ssl.openlink.inha.ac.kr/<DOI>` | 서버가 **doi.org 핸들 API**(`https://doi.org/api/handles/<DOI>`)를 불러 `type: "URL"` 값을 받고(출판사에 접속하지 않음 · 리디렉션을 따라가지 않음), 화면이 5장 규칙으로 변환 |
| 확인 결과 | `doi-org-ssl` → 302 인증 중계(확인됨, `doi.org`는 프록시에 등록돼 있음). **로그인 뒤 doi.org가 보내는 출판사 리디렉션을 프록시가 프록시 주소로 바꿔 주는지 확인 필요**(EZproxy류는 등록 사이트로 가는 리디렉션을 보통 바꿔 줌) | 핸들 API 응답 확인됨: `10.1109/CVPR.2016.90` → `http://ieeexplore.ieee.org/document/7780459/`, `10.1016/j.neunet.2014.09.003` → `https://linkinghub.elsevier.com/retrieve/pii/S0893608014002135`. 두 주소의 프록시 형태 모두 302 인증 중계(확인됨) |
| 장점 | 화면(JS)만으로 끝남, 서버 변경 · 외부 요청 없음, 클릭 한 번. 최종 사이트가 프록시에 없으면 원래 출판사 페이지가 열려 무료 논문은 그대로 볼 수 있음(자연스러운 실패) | 프록시의 리디렉션 처리에 기대지 않음. 출판사 호스트를 미리 알 수 있음 |
| 단점 | 리디렉션 처리가 안 되면 학교 밖에서는 출판사의 비구독 화면이 뜸 | 서버 API · 외부 요청 추가(작음), 클릭마다 왕복 지연. 핸들 값이 **중간 주소**(예: `linkinghub.elsevier.com`)나 **http 주소**인 경우가 있고, 그 호스트가 프록시에 없으면 openlink 안내 · 오류 페이지가 뜸 |
| 보안 | 해당 없음 | 서버는 **고정 호스트 `doi.org`에만** 요청(사용자 입력은 경로의 DOI뿐, 정규식 검사 + 경로 인코딩). 출판사 본문은 받지 않음. 기존 `Sources` 클라이언트(시간 제한 · User-Agent) 사용. 받은 URL은 http/https만 돌려줌 |

### 6.2 결정 (IK-1 — 기획팀 추천안으로 확정)

**(a)를 기본으로 구현**합니다. 수용 기준 M-2(로그인 상태에서 IEEE · Elsevier · Springer DOI 각 1편)로 프록시가 리디렉션을 바꿔 주는지 확인하고, **안 되면 (b)를 추가**합니다(6.3절은 그때의 사양). 이유: 변경이 가장 작고, 서버가 외부에 요청하지 않으며, 실패해도 원래 출판사 페이지로 떨어집니다.

### 6.3 (b)를 쓰게 될 때의 서버 사양 (예비)

- `GET /api/links/doi-target?doi=<DOI>` → `{ "url": "https://…" | null }`. 로그인 필요(기존 인증 의존성 그대로).
- `paperlab/sources.py`에 `Sources.doi_target(doi) -> str | None`: DOI를 6.4절대로 정규화하고, `https://doi.org/api/handles/{인코딩한 DOI}`를 `_get_json`으로 부름. `responseCode == 1`이고 `values` 중 `type == "URL"`의 `data.value`가 http/https면 돌려줌, 아니면 `None`.
- 출판사 주소로는 **요청하지 않음**(리디렉션을 따라가지 않으므로 `download_pdf`의 SSRF 방어가 필요한 경로가 아님 — 요청 대상은 `doi.org` 고정).
- 결과는 공개 데이터라 서버 메모리 캐시(예: 최대 1,000개 · 24시간)는 둘 수 있으나 **누가 조회했는지 기록하지 않음**(PLAN 2장 공용 캐시 원칙). 접근 로그에는 경로만 남음(`server.py` 255행 — 쿼리 문자열은 남기지 않음).
- 화면: 버튼을 누르면 빈 탭을 먼저 열고(팝업 차단 회피 — `openPdfFile`과 같은 방식) 응답을 받아 `toInhaProxy`로 바꿔 이동. `null`이면 (a) 주소로 이동.

### 6.4 DOI 정규화 · 프록시 DOI 주소 — `inhaDoiUrl(doi) → string | null`

1. 앞뒤 공백 제거, 앞의 `doi:` · `https://doi.org/` · `http://dx.doi.org/` 등을 떼어 냄(대소문자 무시). **`doi.org` 주소 꼴로 들어온 DOI는 경로가 이미 인코딩돼 있으므로 `decodeURIComponent`로 한 번 풀고**(실패하면 그대로) 3단계에서 다시 인코딩합니다(이중 인코딩 방지 — 팀장 승인 2026-10-07).
2. `^10\.\d{4,9}/\S+$`에 맞지 않으면 `null`.
3. 경로 인코딩: `encodeURIComponent(doi).replaceAll("%2F", "/")` (`#` · `?` · `;` · `:` · `<` · `>` · 공백은 인코딩, `/`만 살림). 대소문자는 바꾸지 않음.
4. 결과: `"https://doi-org-ssl.openlink.inha.ac.kr/" + 인코딩한 DOI`. 5.2절 8단계 출력 검사를 똑같이 거침.

### 6.5 논문 하나의 대상 고르기 — `paperProxyTarget(p) → string | null`

1. `p.doi`가 있고 `inhaDoiUrl`이 값을 주면 그 값(6.2 기본안 (a)).
2. 아니면 `p.url`이 `doi.org`/`dx.doi.org` 주소면 그 경로를 DOI로 보고 1과 같이 처리. **경로가 올바른 DOI가 아니면(예: doi.org 첫 화면) `null`** — 3단계로 넘어가 doi.org 첫 화면을 프록시로 열지 않음(팀장 승인 2026-10-07).
3. 아니면 `p.url`의 호스트가 5.3절 제외 목록이 아니면 `toInhaProxy(p.url)`.
4. 다 아니면 `null`(버튼 숨김 — 대신 7장 검색 바로가기를 제목으로 보여 줌).

`pdf_url`(무료 PDF 주소)은 프록시로 감싸지 않습니다.

## 7. 학교 DB 검색 바로가기 (프록시 경유)

### 7.1 검색 주소 형식

| DB | 원래 검색 주소 | 확인 | 프록시 경유 주소 |
|---|---|---|---|
| **RISS** | `https://www.riss.kr/search/Search.do?isDetailSearch=N&searchGubun=true&viewYn=OP&query=<q>` | **확인됨**: 원래 사이트에서 "딥러닝"으로 국내학술논문 12,389 · 학위논문 12,091건 등 결과 표시. 프록시 형태도 쿼리 유지 302 | `https://www-riss-kr-ssl.openlink.inha.ac.kr/search/Search.do?isDetailSearch=N&searchGubun=true&viewYn=OP&query=<q>` |
| **DBpia** | `https://www.dbpia.co.kr/search/topSearch?searchOption=all&query=<q>` | **일부 확인**: 주소를 받고 페이지 제목에 검색어가 들어감("딥러닝 : 논문 검색 결과 - DBpia…"). 결과 목록은 화면 스크립트가 불러와서 확인 도구에는 0건으로 보임 → **브라우저에서 결과 표시 확인 필요** | `https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/search/topSearch?searchOption=all&query=<q>` |
| **KISS** | 미확인 — `https://kiss.kstudy.com/Search/Result`는 있으나(빈 결과 화면) 검색어 매개변수 이름을 공개 응답에서 찾지 못함 | **확인 필요 — 사용자 로그인 상태에서 KISS 검색 후 주소창 주소 확인**(IU-3) | 확인 전 임시안: **KISS 첫 페이지** `https://kiss-kstudy-com-ssl.openlink.inha.ac.kr/`를 열고, 검색어를 클립보드에 복사한 뒤 알림 "검색어를 복사했어요. KISS 검색창에 붙여 넣으세요" |

- `<q>` = 9.2절 정규화를 거친 질의를 `encodeURIComponent`로 인코딩.
- 주소 조립은 **원래 검색 주소를 만든 뒤 `toInhaProxy`로 변환**합니다(하드코딩한 프록시 주소를 따로 두지 않음 — 규칙 하나로 검증).
- 검색 주소 템플릿은 `extlinks.js` 상수 한 곳에 둡니다(사이트가 주소를 바꾸면 여기만 고침).

### 7.2 함수 — `inhaSearchUrl(db, query) → string | null`

`db`는 `"riss" | "dbpia" | "kiss"`. 정규화한 질의가 비면 `null`(단, KISS 임시안은 질의가 있어야 버튼이 켜지고 결과는 첫 페이지 주소). 모르는 `db`는 `null`.

## 8. 화면

버튼 이름 "인하대에서 보기" · "학교 DB에서 찾기" · "학교 로그인" · "Google Scholar에서 보기"는 **확정**(사용자 — IU-5). 문구는 10장. 배치 · 모양은 디자인팀이 정합니다(아래는 위치 요구).

### 8.1 논문 찾기 화면 (`discover.js`)

- 검색창 아래(필터 줄 근처) **"학교 DB에서 찾기"** 줄: `[RISS] [DBpia] [KISS] [Google Scholar]`. **[학교 로그인]은 이 줄에 두지 않습니다**(사용자 결정 2026-10-07 — 설정 창에만, 8.5절). 로그인하지 않은 채 눌러도 openlink가 로그인을 요구하고 로그인 뒤 그 검색 결과로 돌아갑니다(가정 — M-1 · M-3에서 확인).
  - 질의는 **검색창의 지금 입력값**(검색 버튼을 누르기 전 값도) — `input` 이벤트마다 버튼 활성 상태를 다시 계산합니다.
  - 입력값을 정규화한 결과가 비면 네 버튼 모두 **비활성**(`disabled`, `aria-disabled`), 마우스를 올리면 "검색어를 입력하세요".
  - 입력이 DOI · arXiv ID여도 그대로 질의로 씁니다(변환하지 않음).
- **결과 카드**(`resultCard`) 아래 동작 줄에 **"인하대에서 보기"** 링크: `paperProxyTarget(it)`가 `null`이 아닐 때만. [PDF] 링크가 있어도 함께 보여 줌.
- 인용 관계 목록(`miniResult`)에는 넣지 않습니다(가정 — 공간이 좁음).

### 8.2 서재 상세 패널 (`library.js` `renderDetail`)

- **PDF 없는 논문**: 동작 줄 순서 **`[PDF 받기] [인하대에서 보기] [PDF 첨부]`**(D-4 — 대상이 있을 때). 대상이 없으면 그 자리에 `[학교 DB에서 제목 검색 ▾]`(RISS · DBpia · KISS 메뉴, 질의 = 제목).
- **PDF 있는 논문**: `⋯` 메뉴에 "인하대에서 보기"(대상이 있을 때).
- **"Google Scholar에서 보기"**: **정보 탭 "바로가기" 줄**(D-5 — 시안 5.4). 질의는 9.3절.
- [인하대에서 보기]를 누른 뒤 그 패널에 한 줄 안내(10장 G-5) "학교 사이트에서 PDF를 받았다면 [PDF 첨부]로 올려 주세요" — **상세 패널을 다시 그릴 때까지** 표시(D-1). PDF 있는 논문이면 표시하지 않음.

### 8.3 읽기 화면 — PDF 없는 논문 (`reader.js` `loadPdf`)

지금 빈 화면 문구 아래에 `[인하대에서 보기]`(대상이 있을 때) · `[PDF 첨부]` 버튼. [PDF 첨부]는 기존 업로드(`uploadPdfs`의 `attachTo`)를 그대로 쓰고, 올리기가 끝나면 읽기 화면을 다시 불러 PDF를 표시합니다.

### 8.4 링크 여는 방식 (공통)

- 정적 링크는 `<a href="…" target="_blank" rel="noopener noreferrer">`, 스크립트로 열면 `window.open(url, "_blank", "noopener,noreferrer")`.
- `href`에 넣기 전 `esc()`로 이스케이프합니다. 주소는 **반드시 `extlinks.js` 함수의 반환값**만 씁니다(화면 코드에서 문자열을 직접 이어 붙이지 않음).
- 처음 한 번은 10장 안내 창을 먼저 띄우고, 안내 창의 [계속 열기]를 누를 때 새 탭을 엽니다(사용자 클릭 안에서 열어 팝업 차단을 피함).
- **가운데 클릭 · 수정키(Ctrl/⌘/Shift) 클릭**은 안내 창을 띄우지 않고 브라우저 기본 동작으로 새 탭을 엽니다(D-3).

### 8.5 "학교 로그인" 버튼

- 위치: **설정 창 "학교 연결 (인하대)" 구역에만**(사용자 결정 2026-10-07 · D-6). 논문 찾기 검색창 줄 · 사이드바에는 두지 않습니다.
- 왜 한 곳뿐인가: **프록시 링크를 열면 openlink가 로그인을 자동으로 요구하고, 로그인 뒤 원래 주소로 돌아가는 것으로 봅니다**(확인된 사실: 로그인 전 프록시 주소는 302 → `https://openlink.inha.ac.kr/authredirect.n2s?url=<원래 주소>` — 원래 주소를 들고 인증으로 감. 로그인 뒤 복귀는 **배포 뒤 M-1에서 사용자 확인**). 그래서 미리 로그인하지 않아도 되고, 이 버튼은 미리 로그인해 두고 싶을 때 쓰는 보조 수단입니다.
- 동작: `INHA.loginUrl`을 새 탭으로 엶 → 정석학술정보관 로그인 화면에서 사용자가 직접 로그인.
- **로그인 진입 주소 — 확정(사용자 확인 2026-10-07, IU-1)**: **`https://lib.inha.ac.kr/login`**(쿼리 없음 — 돌아갈 주소 등 매개변수를 붙이지 않음). 이 주소는 openlink 주소가 아니므로 **`toInhaProxy`로 변환하지 않고, AC-2 출력 불변식 대상도 아닙니다**(상수 그대로 씀 — 13.1절 AC-2a).
- 구역 설명 문구 G-2(10장).

## 9. Google Scholar 바로가기

### 9.1 주소

`https://scholar.google.com/scholar?q=` + `encodeURIComponent(정규화한 질의)` — **이 형식 하나만**, 다른 매개변수 없음. 프록시로 감싸지 않음. 새 탭(`rel="noopener noreferrer"`). 서버 호출 · 결과 가져오기 없음.

### 9.2 질의 정규화 — `normalizeQuery(text) → string` (검색 바로가기 · Scholar 공통)

1. `String(text ?? "")`를 NFC로 정규화.
2. 제어 문자(유니코드 `Cc` — 줄바꿈 `\n` `\r`, 탭, `\u0000`~`\u001F`, `\u007F`~`\u009F`)는 **공백 하나로** 바꿈.
3. 형식 문자(`Cf` — 너비 없는 공백 `\u200B`, `\uFEFF`, 방향 표시 등)와 **짝 잃은 서로게이트**(짝이 없는 `U+D800`~`U+DFFF` — `encodeURIComponent` 예외 방지)는 **지움**(팀장 승인 2026-10-07).
4. 연속 공백(일반 공백 · `\u00A0` · `\u3000` 포함)을 공백 하나로 합치고 앞뒤를 자름.
5. **길이 상한 256자**(코드포인트 기준 — `Array.from`; 이모지 · 한글 반쪽 잘림 없음). 넘으면 256자에서 자르고, 마지막 40자 안에 공백이 있으면 그 공백 앞까지만 남긴 뒤 다시 앞뒤를 자름(**확정 — IK-4, 이 문장 그대로 구현**. 근거: 논문 제목은 거의 256자 안, Google은 질의 32단어 넘는 부분을 무시하므로 더 길어도 의미 없음).
6. 결과가 빈 문자열이면 버튼 비활성(함수들은 `null`을 돌려줌).

### 9.3 위치와 질의

| 위치 | 질의 | 비고 |
|---|---|---|
| 논문 찾기 검색창 줄 | 검색창의 지금 입력값 | 비면 비활성 |
| 서재 상세 패널 | **제목**(확정 IK-3). 제목이 비어 있고 DOI가 있으면 DOI | Scholar는 DOI 검색을 공식 지원하지 않아(본문에 DOI가 있을 때만 걸림) 제목이 더 잘 맞음. 따옴표로 감싸지 않음(제목이 조금만 달라도 안 걸림) |

### 9.4 함수 — `scholarUrl(query) → string | null`

정규화 결과가 비면 `null`, 아니면 9.1절 주소. 결과는 항상 `https://scholar.google.com/scholar?q=`로 시작하고 `?` 뒤 매개변수가 `q` 하나뿐이어야 함(출력 검사).

## 10. 안내 문구 (디자인팀이 다듬음, 뜻은 유지)

| # | 어디 | 문구(초안) |
|---|---|---|
| G-1 | **처음 쓸 때 안내 창**(첫 "인하대에서 보기" · 학교 DB 바로가기 · 학교 로그인 클릭 때 한 번) 제목 | 인하대 정석학술정보관으로 열어요 |
| G-1 | 본문 | ① 학교에 로그인하지 않았으면 **학교 로그인 화면이 자동으로 떠요.** **정석학술정보관 계정으로 학교 화면에서 직접** 로그인하면 **보려던 페이지로 돌아가요.** ② **PaperLab은 학교 아이디 · 비밀번호를 저장하거나 사용하지 않아요.** 로그인은 이 브라우저와 학교 사이에서만 이뤄져요. ③ 학교 로그인이 끝나면(시간이 지나거나 브라우저를 닫으면) 다음에 열 때 **다시 로그인 화면이 떠요.** ④ 받은 PDF는 서재의 논문 상세에서 **[PDF 첨부]** 로 올리세요. ⑤ 학교가 구독하지 않는 사이트면 학교 안내 · 오류 페이지나 출판사의 구매 화면이 뜰 수 있어요. ⑥ 구독 계약상 **논문을 한꺼번에 많이 받으면 학교 전체 접속이 막힐 수 있어요.** 필요한 논문만 한 편씩 받아 주세요. |
| G-1 | 버튼 | [ ] 다시 보지 않기 · [취소] [계속 열기] |
| G-2 | 설정 창 "학교 연결 (인하대)" 구역 설명(학교 로그인 버튼 옆) | "인하대에서 보기"를 누르면 학교 로그인이 필요할 때 자동으로 로그인 화면이 뜨고, 로그인하면 보려던 페이지로 돌아가요. 미리 로그인해 두고 싶으면 [학교 로그인]을 누르세요. 로그인은 학교 화면에서 직접 하고, PaperLab은 학교 계정을 저장하거나 사용하지 않아요. 학교 로그인이 끝나면 다시 로그인 화면이 떠요. |
| G-3 | "학교 DB에서 찾기" 줄 비활성 툴팁 | 검색어를 입력하세요 |
| G-4 | KISS 임시안 알림 | 검색어를 복사했어요. KISS 검색창에 붙여 넣으세요. |
| G-5 | 상세 패널 한 줄 안내 | 학교 사이트에서 PDF를 받았다면 [PDF 첨부]로 올려 주세요. |
| G-6 | Scholar 버튼 근처(툴팁 또는 안내 창 · 설정 구역) | Scholar 설정 → 도서관 링크에서 '인하대학교'를 켜면 학교 구독 원문 링크가 표시됩니다. (Scholar의 도서관 링크 목록에 인하대학교가 있는지는 배포 뒤 M-15에서 사용자 확인) |

- "다시 보지 않기"는 **이 브라우저에만** 기억(`localStorage` 키 `paperlab.inhaGuideSeen = "1"`) — 확정 IK-5(서버 변경 없음). 체크한 채 안내 창이 **어떻게 닫히든**([계속 열기] · [취소] · ✕ · Esc · 바깥 클릭) 저장합니다(D-2). 설정 창 "학교 연결" 구역에서 안내를 다시 볼 수 있음.

## 11. 서버 · 보안

### 11.1 서버 변경

- **기본안 (a)에서는 서버 변경 없음.** 변환 · 검색 · Scholar 주소는 모두 화면(JS)의 순수 함수로 만듭니다. 학교가 하나뿐이고 사용자별 설정이 없으므로 서버 설정값 · DB 열도 만들지 않습니다.
- 6.2절 확인에서 (a)가 안 되면 6.3절 API 하나만 추가합니다(서버가 `doi.org` 핸들 API만 부름).

### 11.2 보안 규칙

| # | 규칙 |
|---|---|
| S-1 | 변환 입력은 http/https만. 계정 정보 · IP 주소 · 점 없는 이름 · 기본이 아닌 포트는 변환하지 않음(5.2절) |
| S-2 | 변환 출력은 반드시 `https:` + 호스트 `*.openlink.inha.ac.kr` + 계정 정보 · 포트 없음 — 함수 안에서 다시 해석해 확인(5.2절 8단계) |
| S-3 | Scholar 출력은 반드시 `https://scholar.google.com/scholar?q=…` 하나(9.4절) |
| S-4 | 서버와 브라우저 코드는 `openlink.inha.ac.kr` · `scholar.google.com`에 **요청을 보내지 않음**(`fetch` · XHR · `httpx` 금지). 사용자가 누른 링크로 새 탭을 여는 것만 허용 |
| S-5 | 학교 아이디 · 비밀번호 입력 칸, 저장, 서버 전달 없음 |
| S-6 | 새 탭은 `noopener noreferrer`(새 탭이 PaperLab 창을 조작하지 못함, PaperLab 주소가 넘어가지 않음 — 서버의 `Referrer-Policy: same-origin`과 이중 방어) |
| S-7 | 화면 HTML에 넣는 주소 · 질의는 `esc()`로 이스케이프 |
| S-8 | 어떤 논문의 링크를 눌렀는지 서버에 기록하지 않음((a)에서는 서버에 요청 자체가 없음) |

## 12. 2단계 Electron 앱 연결 항목 (기록만 — 2단계 명세에 옮겨 적을 것)

> **phase2 13.2.1절 · AC-86으로 옮김 (2026-10-07, 기획팀)** — [`phase2-worker-electron.md`](phase2-worker-electron.md) 13.2.1절 "외부 링크 열기": ① 시스템 브라우저(`shell.openExternal`), 앱 안 창에서는 열지 않음, 스킴은 http(s)만. 허용 호스트에 `*.openlink.inha.ac.kr` · `lib.inha.ac.kr` · `scholar.google.com` 포함, 목록 밖 http(s)도 시스템 브라우저로 엶(팀장 결정 K21 ①). 아래 표와 줄 번호(712~714행)는 옮기기 전 기록입니다.

2단계 명세 13장(`phase2-worker-electron.md` 712~714행)은 앱 창의 새 창을 **R2 서명 주소 · GitHub Releases 허용 목록만** `shell.openExternal`로 열고 나머지는 거부합니다. 이대로면 앱에서 "인하대에서 보기" · Scholar 링크가 **열리지 않습니다.** 2단계에서 다음 중 하나를 정합니다(IK-6).

| 안 | 내용 | 학교 로그인 상태 | 비밀번호 |
|---|---|---|---|
| ① 시스템 브라우저(확정 IK-6 — 2단계 명세에 반영) | 허용 목록에 `https://*.openlink.inha.ac.kr`, `https://scholar.google.com`을 더해 `shell.openExternal`로 엶. 2단계 AC-73("화면 안의 외부 링크는 시스템 브라우저로")과 같은 방식 | 사용자의 기본 브라우저가 가짐 — 앱은 아무것도 보관하지 않음 | 앱은 다루지 않음 |
| ② 앱 안 별도 창 | 앱이 전용 세션 파티션(예: `persist:inha-openlink`)의 창으로 openlink를 엶. **앱은 쿠키(세션)만 보관하고 비밀번호는 저장하지 않음**(Electron에는 비밀번호 자동 저장 기능이 없고, 넣지도 않음). "학교 로그아웃"은 그 파티션 비우기. PDF 내려받기(`will-download`)는 저장 대화상자로만 — 자동 첨부 금지 | 앱의 파티션이 가짐 | 앱은 다루지 않음 |

①은 이 명세의 웹 동작과 같고 추가 코드가 거의 없습니다. ②는 앱 안에서 끝나지만 다운로드 처리 · 탐색 제한 · 로그아웃 코드가 늘어납니다.

## 13. 수용 기준

### 13.1 자동 테스트 (품질팀 실행)

**실행 방법(확정 — IK-2)**: `paperlab/static/js/extlinks.js`는 DOM · 다른 모듈에 기대지 않는 **순수 ES 모듈**로 만들고, `tests/js/extlinks.test.mjs`를 Node 내장 테스트 **`node --test "tests/js/**/*.test.mjs"`**(저장소 루트에서, 따옴표 포함 — Node 21 이상은 폴더 인자를 받지 않음)로 돌립니다. `tests/test_extlinks_js.py`가 pytest 안에서 같은 명령을 부르고, Node가 없으면 **건너뜀(skip)으로 표시**합니다(서버 PC Node v24.14 실측, 관리자 PC 버전은 확인 필요). 이렇게 하면 기존 `pytest` 한 번으로 함께 돕니다.

**AC-1 프록시 변환표** — `toInhaProxy(입력) === 기대값`

| # | 입력 | 기대값 |
|---|---|---|
| 1 | `https://www.dbpia.co.kr/` | `https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/` |
| 2 | `https://kiss.kstudy.com/` | `https://kiss-kstudy-com-ssl.openlink.inha.ac.kr/` |
| 3 | `https://www.riss.kr/index.do` | `https://www-riss-kr-ssl.openlink.inha.ac.kr/index.do` |
| 4 | `https://www.riss.kr/search/Search.do?query=%EB%94%A5%EB%9F%AC%EB%8B%9D&isDetailSearch=N` | `https://www-riss-kr-ssl.openlink.inha.ac.kr/search/Search.do?query=%EB%94%A5%EB%9F%AC%EB%8B%9D&isDetailSearch=N` |
| 5 | `http://www.riss.kr/` | `https://www-riss-kr.openlink.inha.ac.kr/` |
| 6 | `http://ieeexplore.ieee.org/document/7780459/` | `https://ieeexplore-ieee-org.openlink.inha.ac.kr/document/7780459/` |
| 7 | `https://www.thieme-connect.com/products/` | `https://www-thieme--connect-com-ssl.openlink.inha.ac.kr/products/` |
| 8 | `https://doi.org/10.1109/CVPR.2016.90` | `https://doi-org-ssl.openlink.inha.ac.kr/10.1109/CVPR.2016.90` |
| 9 | `https://WWW.DBPIA.CO.KR/Journal/ArticleDetail/NODE1` | `https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/Journal/ArticleDetail/NODE1` (호스트만 소문자) |
| 10 | `https://www.dbpia.co.kr:443/x` | `https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/x` |
| 11 | `http://www.riss.kr:80/x` | `https://www-riss-kr.openlink.inha.ac.kr/x` |
| 12 | `https://www.nature.com/articles/abc#sec1` | `https://www-nature-com-ssl.openlink.inha.ac.kr/articles/abc#sec1` |
| 13 | `https://www.dbpia.co.kr.` (끝 점) | `https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/` |
| 14 | `https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/x?y=1` (이미 프록시) | 같은 문자열 |
| 15 | `http://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/x` | `https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/x` |
| 16 | `https://한국.kr/a` | `null` (브라우저마다 퓨니코드 처리가 달라 함수가 첫 라벨 `xn--`와 `[a-z0-9-]` 밖의 문자를 명시적으로 거부한다 — 5.2절 4단계) |
| 16a | `https://www.한국.kr/a` | `https://www-xn----3e0b707e-kr-ssl.openlink.inha.ac.kr/a` (규칙상 값 — 프록시 실제 동작은 확인 필요) |
| 16b | `https://openlink.inha.ac.kr/` · `http://openlink.inha.ac.kr/x` (루트 호스트) | `null` |
| 17 | `https://example.com:8443/x` | `null` |
| 18 | `https://user:pw@www.dbpia.co.kr/` | `null` |
| 19 | `https://127.0.0.1/` · `http://[::1]/` · `http://localhost/` · `http://intranet/` | 모두 `null` |
| 20 | `javascript:alert(1)` · `data:text/html,x` · `ftp://x.org/` · `file:///C:/a.pdf` | 모두 `null` |
| 21 | `""` · `null` · `undefined` · `"not a url"` · `"/relative/path"` · `"www.dbpia.co.kr"`(스킴 없음) | 모두 `null` |
| 22 | 라벨이 63자를 넘는 호스트(예: `https://` + `a`×30 + `.` + `b`×30 + `.com/`) | `null` |
| 23 | `https://evil.com.openlink.inha.ac.kr.attacker.net/` | `https://evil-com-openlink-inha-ac-kr-attacker-net-ssl.openlink.inha.ac.kr/` (공격 호스트도 프록시 하위로만 감) |
| 24 | `https://foo.ssl/` | `null` |

**AC-1a IDN · `xn` 라벨 (I-1 — `tests/js/extlinks.test.mjs` "I-1" 테스트와 같은 값)**

| # | 입력 | 기대값 |
|---|---|---|
| I-1a | `https://xn--3e0b707e.kr/a` · `http://xn--3e0b707e.kr/a` · `https://XN--3E0B707E.KR/` · `https://한국.한국/` | 모두 `null`(첫 라벨이 `xn--` — 퓨니코드로 직접 쓴 주소 · http · 대문자도 같음) |
| I-1b | `https://www.xn--3e0b707e.kr/a` | `https://www-xn----3e0b707e-kr-ssl.openlink.inha.ac.kr/a` |
| I-1c | `http://www.한국.kr/` | `https://www-xn----3e0b707e-kr.openlink.inha.ac.kr/` |
| I-1d | `https://xna.com/` | `https://xna-com-ssl.openlink.inha.ac.kr/` (`xn`으로 시작해도 IDN이 아니면 변환) |
| I-1e | `https://xn-a.com/` | `null` — **알려진 제약**: 원래 라벨은 IDN이 아니지만 하이픈이 두 배가 되어 만든 라벨이 `xn--a-com-ssl`로 `xn--`로 시작하므로 거부(만든 라벨 기준 검사). 이런 호스트의 학술 사이트는 알려진 것이 없어 받아들임 |

**AC-1b 라벨 문자 제한 (m-1 — 테스트 "m-1"과 같은 값)**

| # | 입력 | 기대값 |
|---|---|---|
| m-1a | `https://<호스트>/` — 호스트가 `a"b.com` · ``a`b.com`` · `a{b}.com` · `a%20b.com` · `a&b.com` · `a_b.com` · `a!b.com` · `a$b.com` · `a'b.com` · `a(b).com` · `a*b.com` · `a+b.com` · `a,b.com` · `a;b.com` · `a=b.com` · `a~b.com` | 모두 `null`(라벨이 `^[a-z0-9-]+$`가 아님) |
| m-1b | `https://a-1.b2.com/` | `https://a--1-b2-com-ssl.openlink.inha.ac.kr/` (하이픈 · 숫자 허용) |

**AC-2 출력 불변식** — AC-1(1a · 1b 포함) · AC-3 · AC-4 · AC-5의 `null`이 아닌 모든 출력을 `new URL()`로 해석했을 때 `protocol === "https:"`, `hostname`이 `.openlink.inha.ac.kr`로 끝남(루트 `openlink.inha.ac.kr` 자체는 아님), `username === ""`, `password === ""`, `port === ""`. **`INHA.loginUrl`은 openlink 주소가 아니므로 이 불변식 대상에서 뺍니다.**

**AC-2a 로그인 주소** — `INHA.loginUrl === "https://lib.inha.ac.kr/login"`(쿼리 · 해시 없음).

**AC-3 DOI** — `inhaDoiUrl(입력) === 기대값`

| # | 입력 | 기대값 |
|---|---|---|
| 1 | `10.1109/CVPR.2016.90` | `https://doi-org-ssl.openlink.inha.ac.kr/10.1109/CVPR.2016.90` |
| 2 | `https://doi.org/10.1016/j.neunet.2014.09.003` | `https://doi-org-ssl.openlink.inha.ac.kr/10.1016/j.neunet.2014.09.003` |
| 3 | `doi:10.1016/j.neunet.2014.09.003` · `  DOI:10.1016/j.neunet.2014.09.003 ` · `http://dx.doi.org/10.1016/j.neunet.2014.09.003` | 2와 같음 |
| 4 | `10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-0` | `https://doi-org-ssl.openlink.inha.ac.kr/10.1002/(SICI)1097-4571(199806)49%3A8%3C693%3A%3AAID-ASI4%3E3.0.CO%3B2-0` |
| 5 | `10.1234/ab#c?d=1` | `https://doi-org-ssl.openlink.inha.ac.kr/10.1234/ab%23c%3Fd%3D1` |
| 6 | `""` · `abc` · `11.1234/x` · `10.12/x`(등록자 번호 4자리 미만) · `10.1234/` · `https://doi.org/` | 모두 `null` |
| 7 | `https://doi.org/10.1002/(SICI)1097-4571(199806)49%3A8%3C693%3A%3AAID-ASI4%3E3.0.CO%3B2-0` (이미 인코딩된 주소 꼴) | 4와 같음(한 번 풀고 다시 인코딩 — `%253A` 같은 이중 인코딩 없음) — **테스트에 들어감** |

**AC-4 논문 대상** — `paperProxyTarget(p)`

| # | 논문 | 기대값 |
|---|---|---|
| 1 | `{doi: "10.1109/cvpr.2016.90", url: "https://ieeexplore.ieee.org/document/7780459"}` | `https://doi-org-ssl.openlink.inha.ac.kr/10.1109/cvpr.2016.90` (DOI 우선) |
| 2 | `{doi: "", url: "https://doi.org/10.1109/CVPR.2016.90"}` | `https://doi-org-ssl.openlink.inha.ac.kr/10.1109/CVPR.2016.90` |
| 3 | `{doi: "", url: "https://www.dbpia.co.kr/journal/articleDetail?nodeId=NODE1"}` | `https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/journal/articleDetail?nodeId=NODE1` |
| 4 | `{doi: "", url: "https://arxiv.org/abs/1706.03762"}` · `{url: "https://openalex.org/W1"}` · `{url: "https://www.semanticscholar.org/paper/x"}` · `{url: "https://www.kci.go.kr/kciportal/x"}` | 모두 `null` |
| 5 | `{doi: "", url: ""}` · `{}` | `null` |
| 6 | `{doi: "not-a-doi", url: "https://link.springer.com/article/x"}` | `https://link-springer-com-ssl.openlink.inha.ac.kr/article/x` |
| 7 | `{doi: "", url: "https://doi.org/"}` · `{url: "https://dx.doi.org/"}` (doi.org 첫 화면) | `null` — **테스트에 들어감** |

**AC-5 학교 DB 검색** — `inhaSearchUrl(db, q)`

| # | 호출 | 기대값 |
|---|---|---|
| 1 | `("riss", "딥러닝")` | `https://www-riss-kr-ssl.openlink.inha.ac.kr/search/Search.do?isDetailSearch=N&searchGubun=true&viewYn=OP&query=%EB%94%A5%EB%9F%AC%EB%8B%9D` |
| 2 | `("dbpia", "딥러닝")` | `https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/search/topSearch?searchOption=all&query=%EB%94%A5%EB%9F%AC%EB%8B%9D` |
| 3 | `("kiss", "딥러닝")` | `https://kiss-kstudy-com-ssl.openlink.inha.ac.kr/` (임시안 — IU-3 확인 뒤 검색 주소로 바꾸고 이 행을 고침) |
| 4 | `("riss", "a&query=b")` | `query=` 값이 `a%26query%3Db` 하나뿐(매개변수 주입 안 됨) |
| 5 | `("riss", "  \n\t ")` · `("dbpia", "")` · `("kiss", null)` | 모두 `null` |
| 6 | `("unknown", "x")` | `null` |

**AC-6 Scholar** — `scholarUrl(q)` · `normalizeQuery(q)`

| # | 입력 | 기대값 |
|---|---|---|
| 1 | `"deep residual learning"` | `https://scholar.google.com/scholar?q=deep%20residual%20learning` |
| 2 | `"딥러닝  기반\n결함\t검출"` | `https://scholar.google.com/scholar?q=` + `encodeURIComponent("딥러닝 기반 결함 검출")` |
| 3 | `"a&b=c#d"` | `https://scholar.google.com/scholar?q=a%26b%3Dc%23d` (매개변수 `q` 하나뿐) |
| 4 | `"\u200B딥\uFEFF러닝\u0000"` | 질의 `딥러닝` |
| 5 | `""` · `"   "` · `"\n\t\r"` · `"\u200B"` · `null` · `undefined` | `null` |
| 6 | `"a".repeat(300)` | 질의 길이 정확히 256자 |
| 7 | `"word ".repeat(80)` | 질의 길이 256자 이하이고 마지막 글자가 공백이 아님(단어 중간에서 자르지 않음) |
| 8 | 서로게이트 쌍(이모지)이 255~256자 경계에 걸친 입력 | 결과가 올바른 UTF-16(짝 잃은 서로게이트 없음 — `encodeURIComponent`가 예외를 내지 않음) |
| 9 | `"\u3000딥러닝\u00A0모델 "` | 질의 `딥러닝 모델` |
| 9a | `"딥"` + 짝 잃은 상위 서로게이트(코드 단위 `0xD800`) + `"러닝"` + 짝 잃은 하위 서로게이트(`0xDC00`) | 질의 `딥러닝`(짝 잃은 서로게이트는 지움, 예외 없음) — **테스트에 들어감** |
| 10 | 모든 `null`이 아닌 결과 | `https://scholar.google.com/scholar?q=`로 시작하고 `new URL(결과).searchParams`의 키가 `["q"]`뿐, 호스트 `scholar.google.com` |

**AC-7 코드 검사**(품질팀이 검색으로 확인)
- `paperlab/` 아래 Python 코드에 `openlink.inha.ac.kr` · `scholar.google.com`으로 요청하는 코드가 없음(문자열 검색 0건 — 6.3절 (b)를 넣어도 요청 대상은 `doi.org`뿐).
- `extlinks.js`에 `fetch` · `XMLHttpRequest` · `import`(다른 모듈)가 없음.
- `openlink` · `scholar.google` 문자열은 `extlinks.js`(그리고 테스트 · 문서)에만 있음(상수 한 곳 — 화면 파일에 하드코딩 없음).
- 화면에 학교 아이디 · 비밀번호 입력 칸이 없음(`type="password"` 새로 추가 0건).
- 새로 넣은 외부 링크는 모두 `rel="noopener noreferrer"` 또는 `window.open(…, "noopener,noreferrer")`.

**AC-8 기존 테스트**: `pytest` 전체 통과(새 테스트 포함, Node가 없으면 `test_extlinks_js`만 skip).

### 13.2 수동 확인 (품질팀 · 사용자 — 로그인 필요 항목은 **사용자**가 직접)

| # | 누가 | 항목 |
|---|---|---|
| M-1 | 사용자(배포 뒤) | **자동 로그인 요구 · 복귀 확인**: 학교에 로그인하지 않은 브라우저에서 DBpia 논문의 "인하대에서 보기" → openlink가 **로그인을 자동으로 요구**(302 → `authredirect.n2s?url=…` → 학교 로그인 화면) → 학교 화면에서 직접 로그인 → **원래 열려던 DBpia 논문 페이지로 돌아와** 프록시 주소(`www-dbpia-co-kr-ssl.openlink.inha.ac.kr`)로 열리고 원문 보기 · PDF 받기가 됨. 로그인 뒤 원래 주소로 돌아가지 않으면(학교 첫 화면에 머무름 등) 팀장에게 보고 → 안내 문구 · 학교 로그인 버튼 위치 재검토 |
| M-2 | 사용자(배포 뒤 — IU-2) | **DOI 기본안 확인(IK-1)**: 로그인 상태에서 IEEE(`10.1109/CVPR.2016.90`) · Elsevier(`10.1016/j.neunet.2014.09.003`) · Springer DOI 논문 각 1편의 "인하대에서 보기" → 주소창 호스트가 **`…openlink.inha.ac.kr`로 유지**되고 원문 PDF를 받을 수 있음. 하나라도 출판사 원래 주소로 빠지면 결과를 팀장에게 보고 → 6.3절 (b) 추가 |
| M-3 | 사용자(배포 뒤 — IU-3) | 로그인 상태에서 논문 찾기 "학교 DB에서 찾기"의 [RISS] · [DBpia]가 검색어 결과 목록을 보여 줌. [KISS]는 첫 페이지 + 복사 알림(임시안), 그때 KISS에서 검색한 주소창 주소를 기획팀에 알려 줌 |
| M-4 | 품질팀 | 검색창이 비어 있으면 [RISS] [DBpia] [KISS] [Google Scholar] 비활성, 글자를 치면 (검색 버튼을 누르지 않아도) 활성, 공백만 치면 계속 비활성 |
| M-5 | 품질팀 | [Google Scholar] → 새 탭이 `https://scholar.google.com/scholar?q=<입력값>`으로 열림(줄바꿈 붙여 넣은 입력도 한 줄 질의). 서재 상세의 "Google Scholar에서 보기"는 논문 제목으로 검색 |
| M-6 | 품질팀 | 처음 링크를 누르면 안내 창(G-1) → [계속 열기]로 새 탭. "다시 보지 않기"를 켜면 같은 브라우저에서 다시 안 뜸, 다른 브라우저(또는 시크릿 창)에서는 다시 뜸. 설정 창 "학교 연결" 구역에서 안내를 다시 볼 수 있음 |
| M-7 | 품질팀 | 안내 창에서 [계속 열기]를 눌러도 팝업 차단에 걸리지 않음(Chrome · Edge 기본 설정) |
| M-8 | 품질팀 | 개발자 도구 네트워크 탭: "인하대에서 보기" · 학교 DB · Scholar · 학교 로그인 클릭 때 PaperLab 서버로 가는 요청이 없음(기본안 (a)), 새 탭의 `document.referrer`가 비어 있고 `window.opener`가 `null` |
| M-9 | 품질팀 | 결과 카드: DOI 있는 논문 · DBpia 주소 논문에는 "인하대에서 보기"가 있고, arXiv만 있는 논문 · 주소 없는 논문에는 없음 |
| M-10 | 품질팀 | 서재 상세: PDF 없는 논문에 [인하대에서 보기](대상 있을 때) 또는 [학교 DB에서 제목 검색 ▾](대상 없을 때). [인하대에서 보기]를 누른 뒤 G-5 안내가 보이고, [PDF 첨부]로 받은 PDF를 올리면 `has_pdf`가 되어 [읽기 · AI 요약]이 나타남 |
| M-11 | 품질팀 | 읽기 화면(PDF 없는 논문 — `#/read/<id>`로 직접 열기): [인하대에서 보기] · [PDF 첨부]가 보이고, 첨부 뒤 PDF가 표시됨 |
| M-12 | 품질팀 | "학교 로그인" 버튼이 **설정 창 "학교 연결" 구역에만** 있고(논문 찾기 검색창 줄 · 사이드바에는 없음) `https://lib.inha.ac.kr/login`을 새 탭으로 엶. 설명이 G-2 뜻을 담음 |
| M-13 | 사용자 | 학교 세션이 끝난 뒤(브라우저를 닫았다 열거나 학교 로그아웃) "인하대에서 보기"를 누르면 다시 학교 로그인 화면이 뜸(안내 G-1 ③과 일치) |
| M-14 | 품질팀 | 한 화면의 문구에 "학교 아이디 · 비밀번호를 저장하지 않음" 뜻이 안내 창 · 설정 구역에 보임. Scholar 도서관 링크 안내(G-6)가 보임 |
| M-15 | 사용자(배포 뒤 — IU-4) | Google Scholar 설정 → 도서관 링크에서 "인하대학교"(또는 Inha University)가 검색되는지. 안 되면 G-6 문구를 고침 |
| M-16 | 사용자(배포 뒤 — IU-6) | 학교가 구독하지 않는 사이트를 프록시로 열면(예: `https://www-wikipedia-org-ssl.openlink.inha.ac.kr/`) 뜨는 화면을 확인해 G-1 ⑤ 문구와 맞는지 |
| M-17 | 품질팀 | (D-3) 링크를 **가운데 클릭 · Ctrl/⌘/Shift+클릭**으로 열면 안내 창 없이 새 탭이 열림. (D-2) 안내 창에서 "다시 보지 않기"를 켠 뒤 [계속 열기] · [취소] · ✕ · Esc · 바깥 클릭 어느 것으로 닫아도 저장됨. (D-1) G-5 안내는 상세 패널을 다시 그리면 사라짐 |

## 14. 데이터

- **DB 변경 없음.** 새 표 · 열 · 설정값 없음(사용자별 학교 설정 없음 — 확정).
- 브라우저 `localStorage`: `paperlab.inhaGuideSeen`(안내 창 다시 보지 않기) 하나.
- 상수(`extlinks.js`의 `INHA`): `suffix = ".openlink.inha.ac.kr"`, `sslTag = "-ssl"`, `loginUrl = "https://lib.inha.ac.kr/login"`(8.5절 — 확정, 프록시 변환 · AC-2 대상 아님), `label = "인하대"`, 검색 주소 템플릿(7.1절), 제외 호스트(5.3절). Scholar 기본 주소 `SCHOLAR_BASE = "https://scholar.google.com/scholar"`.

## 15. 미정 사항 · 질문

### 15.1 사용자 확인 항목 (개정 2026-10-07)

| # | 질문 | 상태 |
|---|---|---|
| IU-1 | 학교 로그인 주소 | **확정(사용자 확인)**: `https://lib.inha.ac.kr/login`(쿼리 없음) — 8.5 · 14장 |
| IU-2 | 로그인 상태에서 IEEE · Elsevier · Springer DOI가 프록시 주소로 유지되는지 | **배포 뒤 사용자 수동 확인 — M-2**. 실패하면 6.3절 (b) 추가 |
| IU-3 | KISS 검색 결과 화면 주소(검색어 매개변수), DBpia 검색 결과 표시 | **배포 뒤 사용자 수동 확인 — M-3**. 그때까지 KISS는 임시안 |
| IU-4 | Scholar 도서관 링크에 "인하대학교"가 있는지 | **배포 뒤 사용자 수동 확인 — M-15** |
| IU-5 | 버튼 이름 4개 | **확정(사용자)**: "인하대에서 보기" · "학교 DB에서 찾기" · "학교 로그인" · "Google Scholar에서 보기" |
| IU-6 | 구독하지 않는 사이트를 열면 뜨는 화면 | **배포 뒤 사용자 수동 확인 — M-16** |
| IU-7 | 프록시 링크를 열면 openlink가 로그인을 자동으로 요구하고 로그인 뒤 원래 주소로 돌아가는지 | **사용자 결정: 그렇게 동작한다고 보고 설계**(302 → `authredirect.n2s?url=` 확인됨). **배포 뒤 M-1에서 사용자 확인** |

### 15.2 팀장 결정 — **모두 기획팀 추천안으로 확정(2026-10-07)**

| # | 질문 | 결정 |
|---|---|---|
| IK-1 | DOI 처리: (a) 프록시 경유 doi.org / (b) 서버 핸들 API | **(a) 기본**, M-2 실패 시 (b) 추가(6.2절) |
| IK-2 | JS 단위 테스트 실행 방식 | **`node --test "tests/js/**/*.test.mjs"`** + pytest 래퍼(Node 없으면 skip). Node 21 이상은 폴더 인자를 받지 않아 글롭으로 바꿈(팀장 정정). (기각된 대안: 같은 규칙을 Python으로도 구현) |
| IK-3 | Scholar 상세 패널 질의: 제목 / DOI 우선 | **제목 우선**, 제목이 없을 때만 DOI(9.3절) |
| IK-4 | 질의 상한 · 정규화 규칙 | **256자(코드포인트)**, 제어 문자 → 공백, 형식 문자 삭제, 공백 합침, 마지막 40자 안 공백에서 자름(9.2절) |
| IK-5 | 안내 창 "다시 보지 않기" 저장 위치 | **브라우저 `localStorage`**(서버 변경 없음). 대안: `profiles` 설정(계정별, 기기 간 공유) |
| IK-6 | 2단계 Electron 앱에서 프록시 · Scholar 링크 여는 방식 | **① 시스템 브라우저**(허용 목록에 `*.openlink.inha.ac.kr` · `scholar.google.com` 추가). ② 앱 안 전용 세션 창(쿠키만 보관, 비밀번호 저장 안 함)은 대안 — 12장 |
| IK-7 | 새 외부 링크 `rel` | **`noopener noreferrer`**(기존 링크의 `noopener`는 그대로 둠) |
| IK-8 | 기본이 아닌 포트가 있는 주소 | **변환 안 함(`null`)** — 프록시 포트 표기 미확인, 학술 사이트에 거의 없음 |
| IK-9 | 감싸지 않을 호스트 목록(5.3절) | 표대로(arXiv · OpenAlex · Semantic Scholar · KCI · Scholar) |
| IK-10 | PLAN.md 반영 | **반영함(2026-10-07)**: PLAN에 **1A단계**(이 명세)로 기록 — 2 · 3 · 6 · 10(P15) · 11장, 5단계 미정의 "학교 프록시 주소 형식" 삭제. 단계 이름 "1A" 확정 |

### 15.3 결정 기록 (2026-10-07)

| # | 결정 | 내용 | 반영 위치 |
|---|---|---|---|
| U-a | 사용자 | 학교 로그인 주소 `https://lib.inha.ac.kr/login`(쿼리 없음). openlink 주소가 아니므로 AC-2 불변식 대상 아님 | 8.5 · 13.1(AC-2 · AC-2a) · 14장 |
| U-b | 사용자 | 버튼 이름 4개 제안안 그대로 | 8장 |
| U-c | 사용자 | **[학교 로그인] 버튼은 설정 창 "학교 연결" 구역에만**(논문 찾기 검색창 줄에서 뺌). 프록시 링크를 열면 openlink가 로그인을 자동으로 요구하고 로그인 뒤 원래 주소로 돌아가는 것으로 봄 — 배포 뒤 M-1에서 확인 | 8.1 · 8.5 · 10장(G-1 · G-2) · M-1 · M-12 |
| U-d | 사용자 | IU-2 · 3 · 4 · 6은 배포 뒤 사용자 수동 확인으로 남김 | M-2 · M-3 · M-15 · M-16 |
| K-a | 팀장 | IK-1~IK-10 모두 추천안으로 확정, IK-2 실행 명령은 `node --test "tests/js/**/*.test.mjs"` | 13.1 · 15.2 |
| K-b | 팀장(개발팀 판단 승인) | 첫 라벨이 IDN인 호스트(`https://한국.kr/a`)는 `null`, 첫 라벨이 아니면(`www.한국.kr`) 변환 · `openlink.inha.ac.kr` 루트는 `null` · doi.org 첫 화면(DOI 없음)은 `null` · doi.org 주소 꼴 DOI는 한 번 풀고 다시 인코딩 · 짝 잃은 서로게이트 제거 · 256자 규칙은 9.2절 문장 그대로 | 5.2 · 6.4 · 6.5 · 9.2 · AC-1(16 · 16a · 16b) · AC-3(6 · 7) · AC-4(7) · AC-6(9a) |
| D-1 | 팀장(디자인 결정) | G-5 안내는 **상세 패널을 다시 그릴 때까지**(명세 문구대로 — 디자인 제안 "같은 논문 동안 유지"는 채택 안 함) | 8.2 · M-17 |
| D-2 | 팀장(디자인 결정) | "다시 보지 않기"는 안내 창이 **어떻게 닫히든 저장**(취소 · ✕ · Esc 포함) | 10장 · M-17 |
| D-3 | 팀장(디자인 결정) | **가운데 클릭 · 수정키(Ctrl/⌘/Shift) 클릭**은 안내 창을 생략하고 바로 새 탭 | 8.4 · M-17 |
| D-4 | 팀장(디자인 결정) | 상세 패널 버튼 순서 [PDF 받기] [인하대에서 보기] [PDF 첨부] — 시안대로 | 8.2 · `docs/design/inha-proxy-ui.md` |
| D-5 | 팀장(디자인 결정) | Scholar 상세 위치는 정보 탭 "바로가기" 줄 — 시안대로 | 8.2 · 시안 |
| D-6 | 팀장(디자인 결정) | "학교 로그인" 위치는 설정 창 "학교 연결 (인하대)" 구역 — 시안대로(U-c로 이곳 **하나만**) | 8.5 · 시안 |

### 15.4 후속 (배포 뒤)

- **M-1 · M-15 결과에 따라 `dialogs.js`의 `SCHOOL_LOGIN_NOTE` · 안내 창(G-1) · `SCHOLAR_LIBRARY_NOTE` 문구를 완화할지 결정**(품질팀 조건부 승인 2026-10-07 — FEATURES.md는 이미 "돌아가도록 되어 있습니다" · "목록에 있으면 켜세요"로 완화함).

## 16. 팀별 작업 (파일 단위 — 같은 파일을 동시에 고치지 않음)

| 순서 | 팀 | 파일 | 할 일 |
|---|---|---|---|
| 1 | 개발팀 | `paperlab/static/js/extlinks.js` (새 파일) | 순수 모듈: `INHA` · `SCHOLAR_BASE` 상수, `normalizeQuery` · `toInhaProxy` · `inhaDoiUrl` · `paperProxyTarget` · `inhaSearchUrl` · `scholarUrl`(5 · 6 · 7 · 9장). DOM · 다른 모듈 import 없음 |
| 1 | 개발팀 | `tests/js/extlinks.test.mjs` (새 파일) · `tests/test_extlinks_js.py` (새 파일) | AC-1~AC-6 표 그대로, AC-2 불변식, pytest 래퍼(Node 없으면 skip) |
| 1 | 디자인팀 | `docs/design/inha-proxy-ui.md` (새 파일) | 8장 배치 · 버튼 모양 · 비활성 상태 · 안내 창 · 설정 "학교 연결" 구역 시안, 10장 문구 확정 |
| 2 | 디자인팀 | `paperlab/static/css/app.css` | "학교 DB에서 찾기" 줄 · 안내 창 · 상세 패널 한 줄 안내 스타일 |
| 2 | 개발팀 | `paperlab/static/js/dialogs.js` | `inhaGuideDialog()`(G-1, `localStorage`), 링크 열기 도우미 `openExternal(url)`(처음이면 안내 창 → 새 탭, `noopener,noreferrer`) |
| 3 | 개발팀 | `paperlab/static/js/discover.js` | 8.1절(검색창 줄 · 입력에 따른 활성화 · 결과 카드 링크 · KISS 임시안 복사 — 학교 로그인 버튼은 이 파일에 없음) |
| 3 | 개발팀 | `paperlab/static/js/library.js` | 8.2절(상세 패널 버튼 · `⋯` 메뉴 · Scholar · G-5 안내) |
| 3 | 개발팀 | `paperlab/static/js/reader.js` | 8.3절(PDF 없는 빈 화면 버튼 · 첨부 뒤 다시 불러오기) |
| 3 | 개발팀 | 설정 창 파일(`dialogs.js` 또는 설정 창이 있는 파일 — 디자인 시안에 따름) | "학교 연결(인하대)" 구역: 학교 로그인 버튼 · 안내 다시 보기 · G-2 · G-6 |
| 조건부 | 개발팀 | `paperlab/sources.py` · `paperlab/server.py` · `tests/test_sources.py` · `tests/test_server.py` | **M-2 실패 시에만** 6.3절 `doi_target` · `GET /api/links/doi-target` · 테스트(가짜 transport로 핸들 API 응답, DOI 검증 · 경로 인코딩 · `responseCode` ≠ 1 · URL 아닌 값 · http/https 아닌 값) |
| 4 | 품질팀 | — | 13.1절 자동 · 13.2절 수동(사용자 항목은 사용자에게 요청), 결과 보고 |
| 5 | 기획팀 | `FEATURES.md` · `README.md` · `docs/specs/phase2-worker-electron.md` | **완료(2026-10-07)** — 승인 뒤(PLAN은 반영함 — IK-10): 사용 설명서에 "인하대에서 보기 · 학교 로그인 · Scholar" 사용법과 안내(FEATURES 3 · 4 · 5 · 10 · 12 · 14 · 15 · 16장, README 기능 1), 2단계 명세 13장 새 창 허용 목록에 12장 항목 연결(phase2 13.2.1절 · AC-86 · K21) |

## 17. 확인 근거 (2026-10-07, 기획팀 — 로그인 · 폼 제출 없이 GET만)

| 확인 | 방법 | 결과 |
|---|---|---|
| 프록시 변환 규칙 · 등록 여부 | 5.1절 표의 프록시 주소에 GET, 응답의 `Location` 헤더만 읽음 | 302 → `https://openlink.inha.ac.kr/authredirect.n2s?url=…`(등록), 미등록은 직접 응답 |
| openlink 로그인 화면 | `https://openlink.inha.ac.kr/`, `authredirect.n2s` 페이지 GET | 확인 도구가 응답 형식을 읽지 못함 — 확인 필요 |
| doi.org 핸들 API | `https://doi.org/api/handles/10.1109/CVPR.2016.90` · `…/10.1016/j.neunet.2014.09.003` | `responseCode: 1`, URL 값 확인(6.1절) |
| RISS 검색 주소 | 원래 사이트 검색 주소 GET | 결과 목록 · 건수 표시 확인 |
| DBpia 검색 주소 | 원래 사이트 검색 주소 GET | 페이지 제목에 검색어 반영, 결과는 스크립트로 불러옴 — 브라우저 확인 필요 |
| KISS 검색 주소 | 첫 페이지 · `/Search/Result?query=` GET | 매개변수 이름 확인 못함 — 확인 필요 |
| Scholar 도서관 링크 | — | 설정 화면 확인은 하지 않음 — 배포 뒤 M-15(IU-4) |
| 학교(도서관) 로그인 주소 | 기획팀 GET(`lib.inha.ac.kr/`, `/login` — 스크립트 화면이라 읽지 못함) 뒤 사용자 확인(2026-10-07) | `https://lib.inha.ac.kr/login` 확정(IU-1) |
