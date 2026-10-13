# 기능 명세 — 5단계 국내 DB · 기관 연동(⑤)

- 작성: 기획팀 · 2026-10-13 (브랜치 `claude/paper-program-hrrhl2`, HEAD `f49b553` 기준)
- 상태: **구현 완료(승인 대기)** — 2026-10-13 구현 · 품질 후속 수정(D1~D9, 19장) 개발팀 완료, 승인자 검토 중. 사용자 U-1~U-5 · 팀장 K-1~K-22 · 디자인 질문 답 9건(16.4절) · 구현 차이 8건 수용(16.5절) · 팀장 결정 D1(8.3절 경계 ① 엄격화) · 사용자 결정 3건(16.1절 — **대신 받기** 포함, 2026-10-13)을 반영함. 판정 함수는 `sources.py`, 새 소스 검색 분기는 `server.py`의 `ext_search`(18장). **키 발급 뒤 확인할 것**은 16.3절 · AC-5R3, 수동 확인 AC-585 · 586은 아직 안 함. 키 발급이 늦어도 픽스처로 개발 · 자동 테스트는 가능(13장)
- 근거: [PLAN.md](../../PLAN.md) 2장(공용 캐시 · 1A 원칙) · 3장 ⑤ · 6장 5단계 · 10장 P9, [1A 명세](inha-proxy.md) 5 · 6 · 8장(`paperProxyTarget` · 감싸지 않는 호스트), [1B 명세](citation-graph.md) 7 · 8 · 9장(공용 캐시 · 호출 규칙 · 로그 · K-5 · K-6 · K-7), [3단계 명세](phase3-rag-verify-search.md) 13장(AI로 찾기 — 공용 캐시 안 씀 K-11)
- 참고(고치지 않음): 1st My paper `work/backend/external/`(kci · riss · europepmc · opencitations — `unpaywall.py`는 U-4로 옮기지 않음)
- 원칙: 기존 모듈 재사용, 꼭 필요하지 않은 것은 "안 하는 것". 수치는 코드 상수 한 곳의 **가정값**
- 표기: **확정** = 사용자 결정, **원칙** = PLAN · 앞 단계 명세에서 이미 정한 것, **K-n** = 팀장 결정(확정), **U-n** = 사용자 결정(확정), **확인됨** = 공식 문서 · 공개 응답으로 확인(17장 출처), **확인 필요** = 공식 문서로 다 확인하지 못함(추측하지 않음 — 개발팀 첫 주 · 키 발급 뒤 실측)

---

## 1. 목적

| 기능 | 사용자가 얻는 것 |
|---|---|
| 국내 논문 검색 | 논문 찾기 화면의 소스에서 **KCI**(한국연구재단 학술지 인용색인) · **RISS**(KERIS 국내학술논문 — **키를 받으면**, U-2)를 골라 국문 논문을 찾고 서재에 담습니다. 결과에 1A의 **"인하대에서 보기"** 가 붙습니다. RISS 키가 없는 동안 RISS는 1A의 [RISS] 검색 바로가기만 씁니다. |
| 생명과학 · 의학 검색 | 같은 자리에서 **Europe PMC**를 고릅니다(키 없음). |
| 무료 PDF | DOI가 있는 논문에서 **OpenAlex의 무료 PDF 정보**(`best_oa_location` · `oa_locations`의 `pdf_url` · `license`)로, **라이선스가 확인된 것(CC · 퍼블릭 도메인)만 서버가 받고** 나머지는 새 탭으로 엽니다(U-3 · U-4). Unpaywall은 쓰지 않습니다. |
| 인용 관계 보강 | OpenAlex에 참고문헌이 없는 DOI 논문을 **OpenCitations**(CC0)로 보강합니다. |
| 다시 받지 않기 | DOI로 다시 찾는 공개 정보 중 **OpenCitations 참고문헌 · 인용 관계**는 1B **공용 캐시**에 두어 다른 사용자가 같은 논문을 볼 때 외부를 다시 부르지 않습니다. OpenAlex 무료 PDF 정보는 1B 캐시에 이미 있는 작품 행을 읽어 씁니다(U-5 — 10장). |

## 2. 결정과 원칙

| 항목 | 내용 | 구분 |
|---|---|---|
| 학교 계정 | 서버는 학교 계정을 **다루지 않고**, openlink로 **대리 로그인 · 자동 요청 · 자동 다운로드를 하지 않음**. KCI · RISS · 학교 구독 원문은 사용자 브라우저 새 탭으로만 | 원칙(PLAN 2장 · 1A) |
| 공용 캐시 | 공개 서지 · 인용 관계는 `paperlab.external_works` · `citation_edges`(1B)를 함께 씀. `user_id` 없음, **누가 조회했는지 남기지 않음**, 시각은 날짜만. 5단계에서 **새로 넣는 것은 OpenCitations 참고문헌뿐**(KCI · RISS · Europe PMC 검색 결과 · 무료 PDF 조회 결과는 넣지 않음). 다만 OpenCitations 보강 때 서지를 찾은 **OpenAlex 작품 행**도 1B와 같은 방식으로 함께 씀(10.2절 — 새 출처 아님) | 확정(PLAN 2장 · U-5) |
| 키 | KCI · RISS 키는 **공용 키 하나씩**. 관리자가 신청해 서버 PC `cloud.env`(`KCI_API_KEY` · `RISS_API_KEY`)에 둠. 사용자별 키 · 설정 창 칸 없음. 키가 없으면 그 소스만 꺼지고 이유를 보임 | 확정(U-1 · PLAN P9 해결) · 팀장 K-13 |
| RISS 키 없을 때 | RISS는 **1A 검색 바로가기만**. API 코드 경로는 유지하되 키가 없으면 목록에서 **비활성**, 자동 테스트는 **손 픽스처**로만 | 확정(U-2 · 팀장) |
| 무료 PDF | 정보는 **OpenAlex 것만**(Unpaywall 안 씀). **라이선스가 확인된 것(CC · 퍼블릭 도메인)만 서버가 받고**, 나머지는 새 탭으로 엶. 기존 [PDF 받기]에도 같은 규칙(K-12). 새 탭 열기에 프록시 · openlink 호스트를 쓰지 않음(K-11) | 확정(U-3 · U-4) |
| 사용자 이메일 | 외부 호출에 **사용자 이메일을 보내지 않음**(Crossref만 예외 — 1B K-6). 5단계는 이메일이 필요한 새 외부 서비스가 없음 | 원칙(1B 2장 · K-6) |
| 외부 요청 대상 | **고정 호스트 상수**에만 요청(9.1절). 요청 본문 · 응답 값으로 호스트를 만들지 않음. API 호출은 리디렉션을 따라가지 않음 | 원칙(1B 9.5절 · 1단계 F3) |
| 외부 호출 중 DB 연결 | 외부 호출 전에 트랜잭션을 끝내고 연결을 돌려줌 | 원칙(1단계 F9) |
| 자동 테스트 | **실제 외부 API를 부르지 않음** — 녹화 픽스처 + 네트워크 차단 단언 | 원칙(1B 12장) · 팀장 지시 |
| 개인 데이터 | 서재에 넣은 논문 · PDF · 메모는 각자(RLS). 받은 PDF는 그 사용자의 R2 경로에만 | 원칙(PLAN 4장) |
| 실패 | 조용히 빈 결과를 주지 않음 — 사유를 그대로(키 없음 · 한도 · 외부 오류) | 원칙(PLAN 5장 5번) |

## 3. 범위

### 하는 것
1. **검색 소스 3개 추가**: `kci` · `riss` · `europepmc`. 기존 `GET /api/search`의 `source` 값으로(K-3). 연도 · 정렬 · 무료 원문 필터를 소스별로 매핑(6.4절). **RISS는 키가 있을 때만 켜짐**(U-2) — 코드 경로는 유지, 키가 없으면 목록에서 비활성.
2. **결과 정규화**: 세 소스 응답을 지금 결과 카드 모양(`sources._empty`)으로 바꿈(6.1~6.3절). 출처 표시(KCI · RISS 이용 조건 — 4장).
3. **서재 추가**: 지금 `POST /api/papers` 그대로. 중복 판별도 지금 규칙(DOI → arXiv → 정규화 제목 12자 이상).
4. **"인하대에서 보기"**: KCI · RISS · Europe PMC 결과 카드와 서재 상세에 1A `paperProxyTarget` 규칙 그대로(7장 — K-15).
5. **OpenAlex 무료 PDF**(U-3 · U-4): DOI → OpenAlex `best_oa_location` · `oa_locations`의 `pdf_url` · `license` 조회(서버, 클릭 때만), 서재 [PDF 받기] · 결과 카드 [무료 PDF 찾기]에서 사용(8장). **라이선스가 확인된 것만 서버가 받고 나머지는 새 탭.** 기존 [PDF 받기]에도 같은 규칙(K-12).
6. **OpenCitations 참고문헌 보강**: ① 서재 상세 "인용 관계" 탭 · 찾기 화면 참고문헌 목록에서 OpenAlex 참고문헌이 0편이고 DOI가 있으면 OpenCitations로 보강 ② 1B 그래프 씨앗 보강에서 S2보다 먼저(9.3절 — K-7).
7. **공용 캐시 확장**: OpenCitations 참고문헌을 1B 표에 저장(10장 — U-5 · K-8). 무료 PDF 조회는 1B 캐시의 OpenAlex 작품 행을 읽기만 하고, 라이선스 칸 `oa_license` 하나를 더함(K-21). 마이그레이션 1개.
8. **공용 키 설정**: KCI · RISS 키(U-1) — 서버 PC `cloud.env`의 `KCI_API_KEY` · `RISS_API_KEY` 두 개뿐(K-13). 없으면 그 소스만 꺼지고 화면에 이유를 보임.
9. **자동 테스트**: 녹화 픽스처로 파서 · 호출 규칙 · 캐시 · RLS · 로그 · 화면 순수 함수(12 · 13장).

### 안 하는 것
| 항목 | 이유 · 나중에 |
|---|---|
| 서버가 KCI · RISS · 학교 구독 원문(PDF)을 받기 | 원칙(학교 계정 · 자동 다운로드 금지). KCI · RISS API는 원문 PDF를 주지 않음(1st My paper 실측 · RISS 명세에 원문 유무 `Y/N`만 — 확인됨) |
| DBpia · KISS API 검색 | 1A 검색 바로가기로 충분(PLAN 범위 밖) |
| 여러 소스 한 번에 통합 검색(OpenAlex + KCI + RISS 합치기) | 소스마다 정렬 · 쪽 넘기기 규칙이 달라 결과 순서가 뒤섞임. 3단계 AI로 찾기가 이미 여러 검색을 합침 |
| 3단계 **AI로 찾기**에 KCI · RISS 넣기 | 3단계 K-9~K-13 확정 범위. 키 · 한도가 정해진 뒤 별도 검토(K-20) |
| KCI 참고문헌 API(`referenceSearch`) · 인용지수(`citationDetail`) | 참고문헌 API는 **제목으로 검색**하는 방식이라 논문 하나의 참고문헌 목록을 얻는 방법이 공식 페이지에 없음, 인용지수는 학술지 단위(확인됨). 그래프 연결은 나중 |
| KCI 논문 상세(`articleDetail`) 따로 부르기 | 검색 응답에 초록 · DOI · 피인용이 이미 있음(확인됨) |
| OpenCitations **피인용**(citations) 목록 · 피인용 수 | OpenAlex 피인용이 이미 있음. 보강 가치가 큰 쪽은 참고문헌 공백(K-7) |
| OpenCitations Meta API · 액세스 토큰 | 토큰은 선택(확인됨). 운영 중 한도 문제가 생기면 K-14 재검토 |
| **Unpaywall** 사용(API · 이메일 · 캐시 행) | 사용자 결정 U-4. 무료 PDF 정보는 OpenAlex 것만 |
| Crossref `link` · Semantic Scholar `openAccessPdf` · Europe PMC `fullTextUrlList`의 PDF 주소로 **서버가 받기** | 라이선스를 확인할 수 없어 U-3 규칙상 서버가 받지 않음(새 탭 열기만). 무료 PDF 정보는 OpenAlex 것만(U-4) |
| 검색 결과마다 무료 PDF 일괄 조회(배지) | 결과 20편마다 20회 호출 · 느림. 클릭 때만(K-10) |
| 사용자별 학교 설정 · 학교 계정 저장 | 1A 확정(인하대 고정, 계정 안 다룸) |
| 검색어 · 검색 결과 목록을 서버에 저장 | 검색어 저장 = 조회 기록. 결과 목록은 공용 캐시에 넣지 않음(U-5 확정) |
| `papers`에 `kci_id` · `riss_id` · `pmid` 새 열 | 서재 중복 판별은 DOI · 제목으로 충분, 원문 링크는 `url`(K-16) |

## 4. 외부 서비스 사실 (2026-10-13 확인 — 출처 17장)

### 4.1 KCI Open API (한국연구재단)
| 항목 | 사실 | 구분 |
|---|---|---|
| API 종류 | 논문 기본 정보(`articleSearch`) · 논문 상세(`articleDetail`) · 참고문헌(`referenceSearch`) · 인용지수(`citation…`) 등 | 확인됨 |
| 인증 | 요청 매개변수 `key`(KCI가 발급한 인증키) 필수. **키에 사용기간이 있음**(오류 "사용기간이 종료되었습니다") | 확인됨 |
| 발급 방법 | 포털에 "OPEN API 키신청" 메뉴가 있으나 로그인 뒤 화면이라 자격 · 절차를 읽지 못함. 2차 자료: **회원가입 → 신청서 → 한국연구재단(kciadmin@nrf.re.kr)에 공문** — **개인 발급 가능 여부 · 승인 기간 확인 필요** | 확인 필요 |
| 응답 형식 | **XML**(공식 페이지의 샘플 출력이 XML, JSON 언급 없음) | 확인됨 |
| `articleSearch` 매개변수 | `key` · `apiCode=articleSearch` · **`title`(필수)** · `author` · `journal` · `doi` · `keyword` · `abstract` · `dateFrom`/`dateTo`(YYYYMM) · `page` · `displayCount`(기본 10, 최대 100) · `sortNm`(title · author · pubiYr) | 확인됨 |
| 응답 필드 | 학술지명 · 발행기관 · 연 · 월 · 권 · 호, `article-id`(KCI 제어번호) · 제목(원어 · 영어) · 저자(이름 · 소속 · ORCID) · **초록**(원어 · 영어) · 쪽 · `orte-open-yn`(원문공개 여부) · **`doi`** · `uci` · **`citation-count`**(KCI · WoS) · `url` | 확인됨 |
| 호출 한도 | 공식 페이지에 없음 | 확인 필요 |
| 이용 조건 | API 페이지에 약관 없음. 데이터 제공 서비스 안내 페이지에 **공공누리 제1유형(출처표시)** 문구 — **Open API 결과 전체에 적용되는지 확인 필요**. 결과 저장 조항 없음 | 확인 필요 |
| 호출 주소 | 2차 자료: `https://open.kci.go.kr/po/openapi/openApiSearch.kci`. 공식 페이지의 샘플 URL 칸이 비어 있음 | 확인 필요 |
| 알려진 문제 | `title` 없이 `keyword`만으로 검색되는지, `displayCount`를 무시하고 10건만 주는 경우(2차 자료) | 확인 필요 |
| 프록시 | KCI는 무료라 인하대 openlink에 없음(1A 5.1절 확인됨) | 확인됨 |

### 4.2 RISS 검색 API (KERIS)
| 항목 | 사실 | 구분 |
|---|---|---|
| 발급 주체 · 경로 | **RISS API 센터**(riss.kr) — 공공데이터포털 경유 아님. 공공데이터포털의 "한국교육학술정보원_학술연구정보"는 **학술지(type=S) 검색**이고 자동승인 — 국내학술논문 검색이 아님 | 확인됨 |
| 이용 대상 | API 센터 소개: 통합검색 결과를 자체 서비스에 연계하려는 **"비영리 기관(대학)"**. 개인 언급 없음 → **개인 발급이 안 될 수 있음** | 확인됨(문구) · 개인 가능 여부 확인 필요 |
| 승인 | **심사 후 승인** | 확인됨 |
| 이용 허락 범위 | **BY-NC-ND** — "저작자와 출처 등을 표시하면 자유 이용을 허용", "영리적 이용과 2차적 저작물 작성 불가". 결과 저장(캐시) 허용 여부는 명시 없음 | 확인됨 · 저장은 확인 필요 |
| 호출 | `http://www.riss.kr/openApi?key=…&version=1.0&type=A&keyword=…` — https 지원 여부 확인 필요 | 확인됨 · https 확인 필요 |
| 매개변수 | `keyword`(또는 `title` · `author` · `subject` · `publisher` · `abstract` · `toc`) · `spubdate`/`epubdate`(연도) · `charge`(0 유료 · 1 무료) · `sort`(T 논문명 · A 저자 · Y 발행년도) · `asc`(A · D) · `rsnum`(시작 번호, 기본 1) · `rowcount`(기본 10, 최대 100) | 확인됨 |
| 응답 | XML `<record><head>totalcount · Error · ErrorMessage</head><metadata>…</metadata>…</record>`. 항목: `riss.type` · `riss.title` · `riss.author` · `riss.publisher` · `riss.pubdate` · `riss.stype`(명세) / `riss.stitle`(공식 샘플) · `riss.vol` · `riss.no` · `riss.reg`(예: KCI등재) · `riss.abstract`/`toc`/`image`(**Y/N 유무만**) · `riss.charge`(샘플) · `url`(예: `http://www.riss.kr/link?id=A101700042`) | 확인됨 |
| 없는 것 | **DOI · 초록 본문 · 피인용 수 없음** | 확인됨 |
| 오류 | 1st My paper 실측: 키 없이 부르면 HTTP 200 + `<Error>004</Error>` "인증 오류" | 참고(공식 아님) |
| 호출 한도 · 키 유효기간 | 공식 페이지에 없음 | 확인 필요 |

### 4.3 Europe PMC REST (EMBL-EBI)
| 항목 | 사실 | 구분 |
|---|---|---|
| 키 | 공식 문서에 키 언급 없음. 2026-10-13 키 없이 `…/rest/search?query=DOI:…&format=json` 1회 → 결과 정상 | 확인됨(실측 1회) |
| 호출 한도 | 공식 문서에서 찾지 못함. EMBL-EBI 이용 약관: 다른 사람의 이용을 막을 정도의 과도한 사용은 **차단**, 운영에 지장을 주면 접근 제한 | 수치는 확인 필요 |
| 데이터 이용 | EMBL-EBI는 원 데이터 소유자가 정한 것 외에 **추가 제한을 두지 않음**, 원 데이터(초록 등)에는 제3자 저작권이 있을 수 있고 이용자 책임 | 확인됨 |
| 주소 · 형식 | `https://www.ebi.ac.uk/europepmc/webservices/rest/search`, `format=json`(기본 XML), `resultType`(`lite` · `core` — core = 전체 메타데이터), `cursorMark` · `pageSize` | 확인됨 · `pageSize` 최대값 · `page` 지원 여부 확인 필요 |
| 응답 필드(lite) | `id` · `source` · `pmid` · `pmcid` · `doi` · `title` · `authorString` · `journalTitle` · `journalVolume` · `issue` · `pageInfo` · `pubYear` · `isOpenAccess` · `citedByCount` · `hasPDF` 등 | 확인됨 |
| 검색 필드 | `DOI` · `OPEN_ACCESS` · `PUB_YEAR` · `LANG` · `HAS_PDF` · `LICENSE` | 확인됨 |
| core 필드 | `abstractText` · `fullTextUrlList` · `license` | 확인 필요(녹화로 확인) |

### 4.4 OpenCitations Index API v2
| 항목 | 사실 | 구분 |
|---|---|---|
| 주소 | `https://api.opencitations.net/index/v2` — `/references/{id}` · `/citations/{id}` · `/reference-count/{id}` · `/citation-count/{id}`, id 접두어 `doi:` · `omid:` · `pmid:` 등 | 확인됨 |
| 응답 | JSON 배열, 항목 `oci` · `citing` · `cited` · `creation` · `timespan` · `journal_sc` · `author_sc` | 확인됨. `citing` · `cited` 값이 여러 식별자를 공백으로 묶은 꼴인지 **확인 필요(녹화)** |
| 토큰 | **필수 아님**("not compulsory") — 권장. `authorization` 헤더. 토큰 신청에 이메일 필요(토큰은 익명 문자열) | 확인됨 |
| 한도 | **IP당 분당 180회** | 확인됨 |
| 라이선스 | 데이터 **CC0** | 확인됨 |
| COCI | 2023-10부터 여러 인덱스를 OpenCitations Index 하나로 합침(COCI 포함) | 확인됨(2차 자료 — 17장) |

### 4.5 OpenAlex 무료 PDF 정보 (Unpaywall 대신 — U-4)
Unpaywall은 쓰지 않는다(사용자 결정 U-4). 앞 초안의 Unpaywall 사실(email 필수 · 하루 10만 회 · 약관 미확인)은 삭제.

| 항목 | 사실 | 구분 |
|---|---|---|
| 출처 | OpenAlex 블로그: Unpaywall을 OpenAlex 코드에 합쳐 다시 만드는 중, **"Unpaywall과 OpenAlex는 항상 같은 값"**(17장) — 같은 데이터를 OpenAlex로 읽는 것 | 확인됨 |
| 지금 코드가 쓰는 것 | `norm_openalex`가 `best_oa_location.pdf_url`을 `pdf_url`로, `open_access.is_oa`를 `is_oa`로 씀(`paperlab/sources.py`). **`license`는 아직 읽지 않음** | 확인됨(코드) |
| 1B 공용 캐시에 있는 것 | `external_works`에 `pdf_url` · `is_oa` 열이 **이미 있음**(`20261008000002_citation_cache.sql`). **`license` 열은 없음** → K-21로 `oa_license` 열 하나 추가(10.2절) | 확인됨(코드) |
| 쓸 필드 | `best_oa_location` · `oa_locations[]`의 `pdf_url` · `landing_page_url` · **`license`** · `version`. 호출은 지금 `lookup_doi`가 쓰는 `GET api.openalex.org/works/doi:<DOI>` 그대로(새 호스트 · 새 환경 변수 · 이메일 없음) | `pdf_url`은 확인됨(코드) · 나머지 필드 이름 · 값은 **확인 필요(개발팀 첫 주 녹화)** |
| `license` 값 목록 | 서버가 받는 허용 값: `cc-by` · `cc-by-sa` · `cc-by-nc` · `cc-by-nd` · `cc-by-nc-sa` · `cc-by-nc-nd` · `cc0` · `public-domain`(팀장 결정). 그 밖(`other-oa` · `publisher-specific…` · 없음)은 새 탭. **실제 값 목록은 개발팀이 첫 주에 녹화로 확인**(버전 꼬리표 · 대소문자 · 유사 값이 있으면 허용 목록에 추가할지 팀장 보고) | 확인 필요 |
| 호출 한도 | 지금 OpenAlex 호출 규칙 그대로. 이 기능은 **클릭 때 1회**라 추가 부담이 작음 | 원칙 |

### 4.6 저작권 참고 (법률 자문 아님 — 확인 필요)
- 저작권법 제30조(사적이용을 위한 복제): 공표된 저작물을 영리 목적 없이 개인적으로 이용하는 경우 **"그 이용자는"** 복제할 수 있음. 해설 · 판례 요약에서 요건으로 "이용자에 의한 복제"를 들고, 업체를 통한 대리 복제는 해당하지 않는다고 봄(17장). → **라이선스 없는 OA 파일을 서버가 대신 받아 두는 것**은 회색 지대일 수 있음.
- CC 라이선스(`cc-by` 등)가 붙은 OA 파일은 라이선스가 복제를 허락함. → U-3 확정: **라이선스가 확인된 것만** 서버가 받음.
- 지금 PaperLab은 1단계부터 [PDF 받기] · [PDF 포함 추가]에서 **서버가** OpenAlex 무료 PDF 주소의 파일을 받아 그 사용자의 R2에 저장함(`server.py` `fetch_pdf` · `add_paper`). U-3은 이 동작에도 똑같이 적용(K-12 확정).

## 5. 사용 흐름 · 화면 (문구 · 배치는 디자인 시안 `docs/design/phase5-korean-db-ui.md`)

```
[논문 찾기] 검색창 · 소스 ▾ [OpenAlex | Semantic Scholar | arXiv | Crossref | KCI | RISS | Europe PMC]
   · 키가 없는 소스는 목록에 보이되 선택 불가 + 이유("관리자가 KCI 키를 등록하면 쓸 수 있어요")
   · RISS 키를 못 받은 동안: RISS 항목은 비활성 + "RISS 키를 받으면 쓸 수 있어요 — 지금은 [RISS] 검색 바로가기를 써 주세요"(1A 바로가기는 그대로)
   · 소스가 지원하지 않는 정렬 · 필터는 네이티브 `disabled` + **늘 보이는 이유 줄**(6.4절 — 16.4절 8번). 고른 값이 미지원이면 기본값으로 되돌리고 그 사실을 같은 이유 줄에 덧붙이며 화면 읽기로도 알림(16.5절 7번)
결과 카드: 제목(→ 원래 페이지 새 탭) · 저자 · 학술지 · 연도 · [KCI등재] · "KCI 피인용 12"(글 — 버튼 아님, 디자인 AD-6 · 16.4절 7번)
   [＋ 서재에 추가] [인용] [인하대에서 보기](대상 있을 때) [Google Scholar](**새 소스 카드에만** — 16.4절 6번) [그래프](DOI 있을 때)
   [무료 PDF 찾기](DOI 있고 PDF 주소 없을 때 — OpenAlex 조회) → 찾으면 [PDF 포함 추가](라이선스 확인된 것) 또는 [무료 PDF 열기 ↗](그 밖 — U-3)
   카드 묶음 아래 출처 한 줄: "검색 결과 출처: KCI(한국연구재단)" / "RISS(KERIS)" / "Europe PMC"
[서재 상세] PDF 없는 논문: [PDF 받기] → (OpenAlex 무료 PDF 정보 — U-3 규칙) → 저장(서재 주소가 규칙에 안 맞으면 같은 논문의 무료 공개본을 대신 받고 토스트로 알림 — 8.3절) 또는 [무료 PDF 열기 ↗] + "받은 파일은 [PDF 첨부]로 올려 주세요"
[서재 상세 "인용 관계" 탭 · 찾기 참고문헌 목록] OpenAlex 참고문헌 0편 + DOI → OpenCitations 보강 목록 + "OpenCitations 기준" 표시
```

- **KCI · RISS 검색 결과의 [인하대에서 보기]**: 7장.
- **[무료 PDF 열기 ↗]**(새 탭): 서버 응답을 받은 뒤 여는 것이라 팝업 차단을 피하려고 **링크 버튼으로 보여 주고 사용자가 누르게** 함(자동으로 새 탭을 열지 않음 — 1A 8.4절 방식).
- 처음 KCI · RISS를 고를 때 한 번: "KCI · RISS 검색은 PaperLab 공용 키로 요청해요. 원문은 각 사이트(또는 인하대에서 보기)에서 직접 받아 [PDF 첨부]로 올려 주세요." (U-1 확정 — 공용 키 문구 그대로)

## 6. 검색 (서버 — `paperlab/extsources.py` 신규, K-1)

### 6.1 KCI → 결과 카드
| 카드 칸 | KCI 응답 | 비고 |
|---|---|---|
| `source` | `"kci"` | |
| `title` | 원어 `article-title` → 없으면 영어 제목 | 1,000자에서 자름 |
| `authors` | `author-group/author` 이름 → `split_name` | 앞 50명 |
| `year` · `issued` | `pub-year`(· `pub-mon`) | |
| `venue` · `publisher` · `volume` · `issue` · `pages` | `journal-name` · `publisher-name` · `volume` · `issue` · `fpage`–`lpage` | |
| `doi` | `doi` → `normalize_doi`, `10.`으로 시작할 때만 | |
| `url` | `url` (http/https만) — 없으면 `article-id`로 KCI 논문 페이지 주소(상수 틀) | 확인 필요: `url` 값의 모양 |
| `abstract` | 원어 초록 → 없으면 영어 초록 | 5,000자 |
| `cited_by_count` | `citation-count`의 KCI 값 | 속성 구조 확인 필요(녹화) |
| `kci_id` | `article-id`(예: `ART002358582`) — `^ART\d{9}$` 아닌 값은 버림 | 카드 전용(서재 열 없음 — K-16) |
| `is_oa` · `pdf_url` | `orte-open-yn == "Y"` → `is_oa: true`, `pdf_url: ""`(API가 PDF 주소를 주지 않음) | 카드에 "KCI 원문 무료" 표시 |
| `badges` | `kci-registration`(등재 · 등재후보 — 있을 때) | 화면 표시용 |

### 6.2 RISS → 결과 카드
**RISS는 키를 받으면 켜지는 소스**(U-2). 키가 없으면 `GET /api/sources`가 `enabled: false`로 주고 목록에서 비활성, 이 절의 코드 경로는 손 픽스처로만 시험한다(13장).

| 카드 칸 | RISS 응답 | 비고 |
|---|---|---|
| `source` | `"riss"` | |
| `title` | `riss.title` | |
| `authors` | `riss.author`를 `;` · `,` · `/`로 나누고 괄호 안 영문 이름 제거(`백정현(Jeong-Hyun Baek)` → `백정현`) → `split_name` | |
| `year` | `riss.pubdate`의 4자리 연도 | |
| `venue` | `riss.stype` → 없으면 `riss.stitle`(공식 샘플은 `stitle`) | 둘 다 읽음 |
| `publisher` · `volume` · `issue` | `riss.publisher` · `riss.vol` · `riss.no` | |
| `url` | `url` — 호스트가 `www.riss.kr`이고 `http`면 **`https`로 바꿈**(K-15), 그 밖 호스트 · 형식은 빈 값 | |
| `riss_id` | `url`의 `id` 값(`^[A-Z]\d{6,12}$`) | 카드 전용 |
| `doi` · `abstract` · `cited_by_count` | 없음(빈 값 · null) | API가 주지 않음(확인됨) |
| `badges` | `riss.reg`(예: KCI등재), `riss.charge == "1"` → "무료 원문" | |
| `is_oa` · `pdf_url` | `false` · `""` | 무료 원문도 RISS 페이지에서 사용자가 직접 |

### 6.3 Europe PMC → 결과 카드
| 카드 칸 | 응답 | 비고 |
|---|---|---|
| `source` | `"europepmc"` | |
| `title` · `abstract` | `title` · `abstractText`(core) — HTML 엔티티 풀고 태그 제거 | |
| `authors` | `authorString`을 `, `로 나눔 → `split_name` | |
| `year` · `venue` · `volume` · `issue` · `pages` | `pubYear` · `journalTitle` · `journalVolume` · `issue` · `pageInfo` | |
| `doi` · `pmid` · `pmcid` | 그대로(형식 검사) | |
| `url` | `https://europepmc.org/article/{source}/{id}`(`source` · `id`는 `^[A-Z]{3}$` · `^[A-Za-z0-9]{1,20}$`일 때만) | |
| `cited_by_count` · `is_oa` | `citedByCount` · `isOpenAccess == "Y"` | |
| `pdf_url` / `oa_open_url` | **채우지 않음**(`pdf_url: ""`). U-4로 무료 PDF 정보는 OpenAlex 것만 쓰므로 Europe PMC `fullTextUrlList` · `license`는 읽지 않음. 카드의 `url`(Europe PMC 페이지)이 있고, DOI가 있으면 [무료 PDF 찾기]가 OpenAlex를 조회(8장) | U-4 |

### 6.4 검색 매개변수 매핑 (K-5)
| 화면 | KCI | RISS | Europe PMC |
|---|---|---|---|
| 검색어 | `title=<q>`(공식상 필수). `keyword` 병행은 확인 뒤(K-19) | `keyword=<q>` | `query=<q>`(필드 문법은 그대로 통과) |
| 연도 | `dateFrom=<부터>01` · `dateTo=<까지>12` | `spubdate` · `epubdate` | `query`에 ` AND PUB_YEAR:[a TO b]` |
| 관련도순 | 기본(정렬 안 보냄) | 기본 | 기본 |
| 최신순 | `sortNm=pubiYr`(내림 · 오름 확인 필요) | `sort=Y&asc=D` | `sort=P_PDATE_D desc` |
| 피인용순 | **비활성**(미지원) | **비활성** | `sort=CITED desc` |
| 무료 PDF만 | **비활성**(미지원) | `charge=1` | ` AND OPEN_ACCESS:Y` |
| 쪽 넘기기 | `page` · `displayCount=20` | `rsnum=(쪽-1)×20+1` · `rowcount=20` | `cursorMark` — 화면은 [이전] [다음]만(K-6) |
| 쪽 상한 | 500쪽(지금과 같음) | 500쪽 | 다음 커서가 없을 때까지 |

- 검색창이 DOI · arXiv · OpenAlex id면 **지금처럼 소스와 무관하게 `resolve`**(Crossref · OpenAlex)로 찾음(변경 없음).
- 검색어는 1~300자, 제어 문자 제거. 모든 값은 **쿼리 매개변수로만**(httpx 인코딩) — 경로에 넣지 않음.

### 6.5 오류 · 부분 실패
| 상황 | 서버 응답 | 화면 |
|---|---|---|
| 소스 키 없음(KCI · RISS) | 503 `{"code":"source_unconfigured"}` — 외부 호출 0회 | "관리자가 KCI 키를 등록하면 쓸 수 있어요" / RISS는 "RISS 키를 받으면 쓸 수 있어요" |
| KCI · RISS 키 오류(KCI "등록되지 않은 key" · "사용기간이 종료" / RISS `Error` ≠ 0) | 502 `{"code":"source_key_invalid"}` | "KCI 키가 맞지 않거나 사용기간이 끝났어요. 관리자에게 알려 주세요" |
| 한도 · 429 · 5xx · 연결 오류 | 1회 재시도 뒤 502 `{"code":"upstream_unavailable"}` / 429 `{"code":"upstream_limited"}` | 1B 문구 계열 |
| XML · JSON을 읽을 수 없음 · 10MB 초과 · DOCTYPE · ENTITY 포함(인코딩 무관 — UTF-16도) | 502 `upstream_unavailable` | |
| 결과 0건 | 200 `{"items":[],"total":0}` | 지금 빈 상태 문구 |

- 오류 문구 · 로그에 **요청 주소 · 검색어 · 키 · 이메일을 넣지 않음**(호스트 + 상태 + code만 — 1B 9.6절).

## 7. "인하대에서 보기" (1A 재사용 — K-15)

| 결과 | 동작 | 근거 |
|---|---|---|
| KCI + DOI 있음 | `inhaDoiUrl(doi)` → 프록시 경유 `doi.org`(1A IK-1 그대로) | 1A 6.5절 1번 |
| KCI + DOI 없음 | **버튼 숨김**(KCI는 무료 · 프록시 미등록 — 1A 5.3절 제외 호스트). 제목 링크가 KCI 원문 페이지 | 1A 5.3절 |
| RISS | `url`(`https://www.riss.kr/link?id=…`) → `toInhaProxy` → `https://www-riss-kr-ssl.openlink.inha.ac.kr/link?id=…` | 1A 5.1절(riss 등록 확인됨) |
| Europe PMC | DOI 있으면 프록시 `doi.org`, 없으면 `europepmc.org`(프록시 등록 여부 미확인 — 1A 규칙대로 변환 시도) | 1A 6.5절 |

- `extlinks.js`는 **고치지 않음**(서버가 RISS `url`을 https로 바꿔 내보냄). 서재에 넣은 뒤에도 같은 규칙(상세 패널 · 읽기 화면 — 1A 8.2 · 8.3절)이 그대로 적용.
- RISS `/link?id=` 주소를 프록시로 열었을 때 로그인 뒤 그 논문 화면으로 돌아오는지는 **배포 뒤 사용자 수동 확인**(M5-3).

## 8. OpenAlex 무료 PDF (U-3 · U-4 · K-10~K-12)

Unpaywall은 쓰지 않는다(U-4). 무료 PDF 정보는 OpenAlex 것만 쓴다(4.5절).

### 8.1 조회 (서버만)
- **정보 출처 순서**: ① 1B 공용 캐시 `external_works`의 그 DOI 행(`pdf_url` · `is_oa` · **`oa_license`**) — `oa_license`가 **null도 `''`도 아닐 때만** 믿음(D5 — `''`은 "best 위치에 라이선스 없음"일 뿐 `oa_locations`에 허용 위치가 있을 수 있어 캐시로 판정하지 않음) ② 행이 없거나 `oa_license`가 null · `''`이면 OpenAlex `GET /works/doi:<DOI>` **1회**(지금 `lookup_doi`가 부르는 호출 — `select`에 `best_oa_location` · `oa_locations`가 이미 있음. 새 호스트 · 새 환경 변수 · 이메일 없음). 이 조회 결과는 **캐시에 쓰지 않음**(5단계에서 무료 PDF용 새 쓰기 경로 없음 — U-5).
- DOI 검사: `normalize_doi` 뒤 `^10\.\d{4,9}/\S{1,250}$`(등록자 번호 **4~9자리**), 경로에는 **퍼센트 인코딩**해 넣고 `/`로 나눈 조각에 `.` · `..`이 있으면 요청하지 않음(1B AC-G35와 같은 규칙). **엄격 검사 한 가지로 통일(2026-10-13 후속)**: `check_doi` · `doi_path`를 쓰는 모든 경로 — `Sources.oa_locations` · `crossref_pdf_link` · `/api/oa/lookup` · OpenCitations · **`lookup_doi`** — 가 같은 검사를 씀. 앞서 `lookup_doi`에 두었던 느슨한 검사(`strict=False` — `.` · `..` 조각과 빈 값만 거부)는 **없앰**. **사용자 영향**: 등록자 번호가 4~9자리가 아닌 DOI(예: `10.1/x`)는 `lookup_doi`에서도 "DOI 형식이 올바르지 않아요"로 거부돼 조회되지 않음.
- `/api/oa/lookup` 본문은 **`small_json`**(4KB 상한 — `Content-Length`가 없거나 chunked여도 4KB 넘게는 읽지 않음, 그래프 · 추천 요청과 같은 함수)으로 읽음. 넘거나 JSON이 아니거나 객체가 아니면 400 `bad_request`(D3).
- 호출 시점: **사용자가 [무료 PDF 찾기] · [PDF 받기]를 누를 때만**(K-10). 검색 결과를 미리 조회하지 않음.
- **고르는 위치**(`sources.pick_oa_location` — 순수 함수, 순환 import를 피하려고 `sources.py`에 둠. `extsources`가 다시 내보냄): `best_oa_location`과 `oa_locations[]`를 이 순서로 보고(http/https 주소만, **openlink 호스트 주소는 버림**, 같은 위치는 한 번), `pdf_url`이 있는 위치 가운데 **① `license`가 8.2절 허용 값인 위치 → ② 없으면 호스트가 `arxiv.org`인 PDF 위치**(arXiv 예외 — 16.5절 2번)를 **서버가 받을 위치**로 고름. 둘 다 없으면 `best_oa_location`의 `pdf_url`(없으면 `pdf_url`이 있는 첫 위치)을 **새 탭용**(`open_kind: "pdf"`)으로, `pdf_url`이 하나도 없으면 `landing_page_url`을 새 탭용(`open_kind: "landing"`)으로, 위치가 아예 없으면 없음(None).
- 응답 값: `pdf_url` · `landing_url` · `license` · `version`(OpenAlex 필드 이름 · 값은 개발팀 첫 주 녹화로 확인), 새 탭이면 `open_url` · **`open_kind`**(`pdf` | `landing` — 16.4절 3번).
- **캐시 한계**: 1B 캐시에는 `best_oa_location` 하나의 `pdf_url`만 있고(`oa_locations` 없음), 이 `pdf_url`은 OA 주소가 없을 때 arXiv 주소로 채워질 수 있음(`norm_openalex` 동작). 캐시의 `pdf_url` 호스트가 `arxiv.org`이면 arXiv 규칙(8.3절 ②)으로 처리. 캐시 행은 `oa_license`가 null도 `''`도 아닐 때만 믿고(`extsources.cache_locations` — D5), 서재 `pdf_url`이 이 캐시 위치와 **다르거나 캐시 위치가 허용 라이선스가 아니면 캐시로 판정하지 않고 OpenAlex 위치 전체를 다시 조회**(8.3절 1번 — 16.5절 3번).

### 8.2 받기 — U-3 확정(라이선스가 확인된 것만 서버가 받음)
| 구분 | OpenAlex `license` 값 | 동작 |
|---|---|---|
| **서버가 받음** | `cc-by` · `cc-by-sa` · `cc-by-nc` · `cc-by-nd` · `cc-by-nc-sa` · `cc-by-nc-nd` · `cc0` · `public-domain`(소문자로 바꿔 비교) | 서버가 받아 그 사용자 R2에 저장 |
| **새 탭으로만** | 없음(null · 빈 값) · `other-oa` · `publisher-specific…` · 위 목록에 없는 모든 값 | 응답 `open_url` → [무료 PDF 열기 ↗] |

- 판정은 **허용 목록 방식**: 목록에 없으면 모두 새 탭(알 수 없는 값은 안전한 쪽). 순수 함수 `server_fetch_allowed(license)`. 실제 값 목록(버전 꼬리표 · 대소문자 · 유사 값)은 **개발팀이 첫 주에 녹화로 확인**하고, 목록을 바꿔야 하면 팀장에게 보고.
- **서버가 받을 때**: 지금 `Sources.download_pdf`(SSRF 방어 · 100MB · `%PDF` 검사)로 받아 `users/{uid}/papers/{pid}.pdf`에 저장 — **그 사용자 R2에만**, 공용 캐시 · 다른 사용자와 공유 없음. 받는 주소는 **서버가 캐시 · 조회로 정한 값만**(클라이언트가 보낸 주소를 이 경로에서 쓰지 않음 — K-11).
- **서버가 받아 저장했을 때**: 응답에 **`license`**(판정에 쓴 라이선스 값, arXiv는 빈 값)를 넣음(16.4절 3번 — 화면 토스트용).
- **새 탭일 때**: 응답 `{"open_url": "<pdf 또는 landing 주소>", "open_kind": "pdf" | "landing", "reason": "license_unknown"}` → 화면이 [무료 PDF 열기 ↗] (`landing`이면 "무료 원문 페이지 열기") 링크 + "받은 파일을 [PDF 첨부]로 올려 주세요". **프록시 · openlink 호스트로 감싸지 않음**(K-11). S2 `openAccessPdf` · Crossref `link`는 **새 탭만 연다**(K-22 — 16.4절 2번).
- **openlink 거부(새 안전장치)**: `download_pdf`는 호스트가 `openlink.inha.ac.kr`이거나 `.openlink.inha.ac.kr`로 끝나면 **요청하지 않고 실패**(학교 프록시 자동 다운로드 금지 원칙을 코드로 막음). OpenAlex 주소는 프록시로 감싸지 않음(1A 6.5절 "`pdf_url`은 감싸지 않음" 그대로).
- 한 번 클릭 = 논문 한 편. 여러 편 한꺼번에 받기 · 백그라운드 자동 받기 없음.

### 8.3 기존 경로와 맞추기 (K-12 확정)
지금 `fetch_pdf`는 `pdf_url` → arXiv → `lookup_doi`(Crossref · OpenAlex `best_oa_location.pdf_url`) 순으로 찾아 **서버가 받음**. → **U-3 규칙을 서버가 OpenAlex 정보로 찾은 OA 주소에 똑같이 적용**. 라이선스를 확인할 수 없는 주소(Crossref `link`, Semantic Scholar `openAccessPdf` — `lookup_doi` 병합 결과에 섞일 수 있음)는 **서버가 받지 않고 새 탭으로만**(U-4: 무료 PDF 정보는 OpenAlex 것만). 결과 카드의 `pdf_url`도 같은 규칙으로 채움: OpenAlex 카드는 `oa_license`가 허용 값일 때만 `pdf_url`, 아니면 빈 값 + `oa_open_url`(새 탭용). `norm_openalex`가 `license`를 읽도록 고침(8.1절).
- 새 `fetch_pdf` 순서(구현: `extsources.plan_pdf` — `server.py`의 `fetch_pdf`와 `add_paper`가 함께 씀):
  1. 서재 `pdf_url`이 있으면(**http/https가 아닌 주소는 없는 것으로 쳐서** 2번으로 넘어감) — 호스트가 `arxiv.org`이면 지금대로 받음(경계 ②). 아니고 DOI가 있으면 **그 DOI의 OpenAlex 위치 중 글자까지 똑같은 주소**를 찾아 그 `license`로 판정(허용이면 받음). 위치 목록은 **1B 캐시의 같은 위치가 허용 라이선스일 때만 캐시로**, 아니면 **OpenAlex 위치 전체를 다시 조회**(16.5절 3번). **그 밖이면 같은 논문의 무료 공개본을 "대신 받음"**(경계 ① — 사용자 결정 2026-10-13): 같은 주소가 허용 위치가 아니거나, OpenAlex 위치에 없거나(S2 · Crossref 주소 · 사용자가 직접 넣은 주소 · 변형한 주소), DOI가 없는 경우. 대신 받는 순서는 (가) 논문의 arXiv 번호(`arxiv.org/pdf/<번호>`, 라이선스 빈 값) → (나) OpenAlex 위치 중 `arxiv.org` PDF 위치 → (다) 허용 라이선스 OpenAlex 위치(`extsources.substitute`, openlink 위치는 후보에서 뺌). **셋 다 없으면 원래 주소를 `open_url` · `open_kind: "pdf"`(새 탭)로**(D1 그대로). 대신 받으면 응답에 `via: "substitute"`가 붙는다(아래 "대신 받기" 항목).
  2. arXiv 번호가 있으면 `arxiv.org/pdf/…`를 지금대로 받음(경계 ② — U-3의 예외).
  3. DOI가 있으면 8.1절 조회(캐시 → OpenAlex) → 8.2절 판정. **OpenAlex 위치가 하나도 없으면 Crossref `link`를 1회 조회**해 PDF 주소가 있으면 **새 탭용**(`open_kind: "pdf"`)으로 돌려줌(서버가 받지 않음 — K-22 · AC-548, 16.5절 4번).
  4. 모두 없으면 지금처럼 404. 외부 조회가 실패하면 502(무료 PDF 정보를 확인하지 못했어요).
- **`add_paper`([PDF 포함 추가]) — 팀장 결정 1(16.4절)**: `POST /api/papers`의 `download_pdf` 경로도 **클라이언트가 보낸 `pdf_url`을 믿지 않고** 위 1번 판정(`plan_pdf`, 서재 `pdf_url` 자리에 보낸 주소)을 서버가 다시 함. 허용(arXiv 주소이거나 그 DOI의 허용 라이선스 OpenAlex 위치와 글자까지 같음)이면 받아 저장. 통과하지 못하면 **대신 받기**(경계 ①)를 시도하고 — 이때 arXiv 번호는 **요청 본문의 `arxiv_id`**로 판정 — 받으면 저장 + 응답에 `via: "substitute"` · `license`(실제로 받은 위치의 라이선스, arXiv면 `""`) · `warning: ""`, 서재 `pdf_url`도 실제로 받은 주소로 바꿈. 대신 받을 곳도 없으면 **PDF 없이 논문만 추가**하고 응답에 `open_url` · `open_kind` · `reason: "license_unknown"`과 안내 문구 **`warning`**(기존 필드, 16.5절 8번)을 돌려줌. 이 판정은 논문을 먼저 커밋한 뒤(DB 연결을 돌려준 뒤) 함. **`dialogs.js`는 대신 받기 토스트 때문에 바뀜**(아래 "대신 받기" 항목 · 18장).
- **경계 ① · ② — 확정(2026-10-13)**:
  - **① (팀장 확정 → 2026-10-13 후속 D1로 엄격화, 적용 대상 `add_paper` · `fetch-pdf`)**: 서버가 받는 주소는 **두 가지뿐**이다. **(a) arXiv 주소 (b) 그 DOI의 OpenAlex 위치 중 허용 라이선스 위치와 글자까지 똑같은 주소.** 그 밖의 주소는 **서버가 그 주소로 받지 않는다** — 서재에 있는 S2 · Crossref 주소, 사용자가 직접 넣은 주소, 변형한 주소(쿼리 · 대소문자 · 끝 `/` 등 글자가 다른 것) 전부. 대신 같은 논문의 무료 공개본이 있으면 그것을 받고(아래 "대신 받기"), 없으면 **원래 주소를 새 탭**으로 연다. http/https가 아닌 주소는 없는 것으로 친다. **"사용자가 넣은 주소는 지금대로 받음" 규칙은 없앴다**(앞선 확정안 — "사용자가 직접 넣은 주소까지 막으면 지금 기능이 줄어듦"을 팀장이 뒤집음).
    - **사용자 영향**: PDF 주소를 직접 넣은 논문도 **그 주소를 서버가 받지는 않는다**(사용자 결정 1 — D1 유지). 같은 논문의 arXiv · 허용 라이선스 공개본이 있으면 그것을 대신 받고, 없으면 새 탭으로 열려 받은 파일을 직접 올려야 한다([PDF 첨부]).
    - **대신 받기(사용자 결정 2026-10-13 — 앞의 "후속 검토 항목"을 대체)**: 보낸 주소나 서재 주소가 위 규칙에 맞지 않으면 **같은 논문의 무료 공개본을 서버가 대신 받는다**(구현 `extsources.substitute` · `plan_pdf`). 고르는 순서: ① 그 주소가 허용 라이선스 위치와 같으면 그 주소(규칙 (b) 그대로) → ② arXiv PDF — 논문의 `arxiv_id`, 없으면 OpenAlex 위치 중 arXiv 주소(`fetch-pdf`는 서재 논문의 `arxiv_id`, `add_paper`는 요청 본문의 `arxiv_id`) → ③ 허용 라이선스 OpenAlex 위치 → ④ 모두 없으면 원래 주소를 새 탭으로(D1). `arxiv_id`가 있으면 OpenAlex 위치를 보기 전에 바로 arXiv를 고른다(②가 ③보다 먼저). **openlink 호스트 위치는 후보에서 뺀다.**
      - 응답: `via: "substitute"`, `license` = 실제로 받은 위치의 라이선스(arXiv 번호로 받으면 `""`, OpenAlex의 arXiv 위치면 그 위치의 값 또는 `""`). `fetch-pdf`는 `{paper, warnings, license, via}`, `add_paper`는 `{paper, warning: "", via, license}`.
      - **서재 `pdf_url`은 실제로 받은 주소로 바뀐다**(`fetch-pdf`는 늘 받은 주소로 갱신 — 기존 동작, `add_paper`는 대신 받았을 때만 갱신). 원래 주소는 서재에 남지 않는다(15장 위험).
      - 화면 토스트(`sourcemeta.substituteText(license)`): "같은 논문의 무료 공개본(라이선스 CC BY)을 받았어요", 라이선스 이름이 없으면(빈 값 · `other-oa` 등 이름표가 없는 값) 괄호를 뺀 "같은 논문의 무료 공개본을 받았어요". [PDF 포함 추가](`dialogs.js`)는 "서재에 추가하고 " + 위 문구, 서재 [PDF 받기](`library.js`)는 위 문구만. `via`가 없으면 지금 문구 그대로.
      - 서재 `pdf_url`이 **비어 있을 때**(보낸 주소 없음)는 이 규칙이 아니라 위 2 · 3번 순서(arXiv 번호 → DOI)이고 `via`가 붙지 않는다.
      - 대신 받을 곳을 찾으려고 OpenAlex를 부르다 실패하면 지금처럼 `fetch-pdf` 502 · `add_paper`는 "PDF는 받지 못했어요" 경고.
  - **② (사용자 결정, 2026-10-13)**: **arXiv는 지금처럼 서버가 받는다. U-3의 예외다.** 근거는 "arXiv는 누구나 받도록 공개한 저장소"라는 점이다. arXiv 논문은 CC 라이선스가 아니라 arXiv 배포 허락만 있는 경우가 많아 U-3의 "라이선스 확인" 원칙과는 다르지만, 이 예외는 사용자가 정했다. 호스트가 `arxiv.org`인 주소(서재 `pdf_url` · 번호로 만든 `arxiv.org/pdf/…` · 1B 캐시 `pdf_url`이 arXiv 주소인 경우)에 적용된다. **이것은 법률 자문이 아니다** — 논문마다 저작권자의 허락 범위가 다를 수 있고, 현행 법 · 약관 확인은 사용자 몫이다(4.6절).
- **그 밖 — 확정(2026-10-13)**: Europe PMC `fullTextUrlList`는 쓰지 않는다(`pdf_url` 비움 — 6.3절). Crossref `link` · Semantic Scholar `openAccessPdf` 주소는 **서버가 그 주소로는 받지 않고** 새 탭으로만 연다(단, 같은 논문에 arXiv · 허용 라이선스 공개본이 있으면 그것을 대신 받음 — 위 "대신 받기").

## 9. OpenCitations 참고문헌 보강 (K-7 · K-8)

### 9.1 호출
- `GET https://api.opencitations.net/index/v2/references/doi:<DOI>` — DOI 인코딩 · `..` 거부는 8.1절과 같음. 토큰 없이(K-14). 응답 `cited`에서 `doi:` 값만 뽑아 소문자 · 정규화, 최대 500편.
- 서버 전체 **초당 2회 이하**(공식 IP당 분당 180회보다 낮게 — 가정).

### 9.2 서재 상세 "인용 관계" 탭 · 찾기 참고문헌 목록
- 지금 `Sources.related(kind="references")`가 **0편이고 논문에 DOI가 있으면** OpenCitations 1회 → DOI 목록을 OpenAlex `filter=doi:…`(100개씩, 지금 `works_by_doi`)로 서지를 받음(1B S2 보강과 같은 방식). 응답에 `"via": "opencitations"` · `"unresolved": N`(OpenAlex에서 못 찾은 DOI 수).
- **`warnings`(팀장 결정 4 — 16.4절)**: `related` 응답에 늘 `warnings` 배열을 넣음. OpenAlex가 0편이고 **OpenCitations 호출이 실패**(404 아님)하면 `[{"code":"oc_failed"}]`(0편 빈 결과와 구분). OpenAlex 서지 묶음 조회가 실패하면 `refs_partial`. 정상이면 `[]`. OpenCitations 404(그 DOI를 모름)는 실패가 아니라 0편.
- 구현: `server.py` `oc_references` · `related_for`(서재 `GET /api/papers/{id}/related`와 찾기 `POST /api/related`가 같이 씀). OpenAlex가 모르는 논문(`SourceError`)도 DOI가 있으면 OpenCitations를 시도함.
- 화면: 목록 위 "OpenCitations 기준 · 서지를 찾지 못한 참고문헌 N편" 한 줄. `oc_failed`면 "OpenAlex에 참고문헌 정보가 없고, OpenCitations도 응답하지 않았어요" 알림 + [다시 시도](디자인 5.2절).
- 피인용 · 관련 논문 목록은 바꾸지 않음.

### 9.3 1B 그래프 씨앗 보강 (K-7)
- 지금(1B K-7): 씨앗의 OpenAlex 참고문헌 0편 + DOI → **S2** 참고문헌 1회.
- 5단계: **OpenCitations 먼저** → 0편이거나 실패면 S2(지금 그대로). 그래프 1회 호출 예산(1B 7.3절 `MAX_LIST_CALLS = 12`)과 OpenAlex `doi:` 필터 ≤ 2회 상한은 그대로 — OpenCitations로 채웠으면 S2를 부르지 않음. 구현: `graph_build.py` `_s2_augment`(이름은 그대로, 두 소스를 차례로 시도). OpenCitations · S2의 404(그 DOI를 모름)는 경고 없이 다음 단계로.
- 경고: OpenCitations 실패는 경고 `oc_failed`(1B 9.3절 경고 code 표에 추가 — 1B 명세에 반영함). S2까지 실패면 지금 `s2_failed`. 추천(1C) 응답은 S2 · OpenCitations 보강을 하지 않으므로 `oc_failed`를 내보내지 않음(`REC_WARNINGS`에 없음).
- **그래프 응답의 출처(팀장 결정 5 — 16.4절, D6로 값 확장)**: 씨앗의 참고문헌 목록이 보강으로 채워졌으면(이번 호출에서 채웠든 캐시에서 읽었든, 편수가 1 이상) 그래프 응답에 **`refs_via`**를 넣음 — 값은 **`"opencitations"` | `"s2"`**(보강이 없으면 필드 없음). 화면 아래 출처 줄은 `opencitations`일 때 "OpenAlex · OpenCitations 기준 · {날짜}", 그 밖은 지금처럼 "OpenAlex 기준 · {날짜}".
- **`oc_failed` 문구(D6)**: 서버 경고 문구는 **"OpenCitations가 응답하지 않아 참고문헌을 보강하지 못했어요."**(`graph_build.py` `WARNINGS`). 화면(`graph.js`)은 `refs_via`가 **`s2`일 때만** "OpenCitations가 응답하지 않아 Semantic Scholar 자료로 참고문헌을 채웠어요."라고 쓰고(S2가 실제로 채운 경우), 아니면 서버 문구를 그대로 씀. `oc_failed` + `s2_failed`가 함께면 지금처럼 한 줄 경고("OpenCitations와 Semantic Scholar가 응답하지 않아 참고문헌을 보강하지 못했어요.").

## 10. 데이터 · 공용 캐시

### 10.1 무엇을 넣나 (U-5 확정 — "DOI로 다시 찾는 것만")
| 대상 | 공용 캐시 |
|---|---|
| **OpenCitations 참고문헌**(OpenAlex 번호가 있는 작품) | **넣음**(`citation_edges`, source `opencitations`) — 5단계의 주 대상. 보강 때 서지를 찾은 OpenAlex 작품 행도 같이(10.2절) |
| **OpenAlex 무료 PDF 정보** | **새로 넣지 않음.** 1B 캐시 `external_works`(OpenAlex 작품 행)에 **이미 있는 `pdf_url` · `is_oa`를 읽어 씀.** 다만 **라이선스 칸이 없어** `oa_license` 열 하나를 더함(K-21 — 10.2절). 새 행 · 새 쓰기 경로 없음(8.1절) |
| KCI · RISS · Europe PMC **검색 결과 서지** | 안 넣음(검색어는 저장하지 않음) |

- 근거: 검색은 매번 외부를 불러야 하므로(검색어를 저장하면 조회 기록) 결과 서지를 캐시해도 **다시 받지 않게 되는 경우가 없음**. RISS 이용 조건(BY-NC-ND · 저장 조항 없음) · KCI 라이선스 적용 범위가 불명확. 3단계 AI로 찾기도 같은 이유로 캐시를 안 씀(3단계 K-11).
- 확인(2026-10-13, 코드): 1B 마이그레이션 `20261008000002_citation_cache.sql`의 `external_works`에 `pdf_url` · `is_oa`가 있고, 1B가 쓰는 작품 데이터는 `norm_openalex`와 같은 `best_oa_location.pdf_url` · `open_access.is_oa` 값. `license` 열은 없음.
- 남는 신호: Unpaywall 행을 만들지 않으므로 앞 초안의 "누군가 그날 이 DOI의 무료 PDF를 찾았다"는 신호는 **새로 생기지 않음.** OpenCitations 참고문헌 행의 신호는 1B 8.6절 8번(사용자 결정으로 수용한 것)과 같은 종류.

### 10.2 마이그레이션 `supabase/migrations/20261014000001_external_sources.sql` (이름 가정)
```sql
-- external_works: OpenAlex 라이선스 칸 (null = 아직 모름, '' = 라이선스 값 없음 — abstract와 같은 방식)
alter table paperlab.external_works
    add column oa_license text check (oa_license is null or char_length(oa_license) <= 100);

-- citation_edges: OpenCitations로 만든 참고문헌 목록
alter table paperlab.citation_edges drop constraint citation_edges_source_check;
alter table paperlab.citation_edges add constraint citation_edges_source_check
    check (source in ('openalex', 's2', 'opencitations'));
```
- **K-21(확정 — 팀장 2026-10-13)**: `oa_license` 열. 1B 캐시에 라이선스가 없으면 U-3 판정을 캐시만으로 못 해 매번 OpenAlex를 다시 불러야 함. 1B가 OpenAlex 작품 행을 쓸 때(`citecache.py` 업서트) `best_oa_location.license`를 함께 채움 — **기존 행은 null이라 처음 클릭 때 OpenAlex 1회 조회**(8.1절). (기각된 대안: 캐시를 쓰지 않고 클릭 때마다 OpenAlex 조회.)
- Unpaywall 행 · `source_id` · `oa_host_type` · `oa_on` 등 앞 초안의 열 · 검사 제약 · 유니크 인덱스는 **모두 삭제**(U-4). `external_works_source_check`는 `('openalex')` 그대로.
- 제약 이름(`…_source_check`)은 1B 마이그레이션의 자동 이름 — **구현 때 실제 이름 확인**(`\d+ paperlab.citation_edges`).
- RLS · 권한은 1B 그대로(읽기 = 로그인 사용자 `select`, 쓰기 = `system_tx`만). 새 열 이름 `oa_license`는 AC-G20 ③ 검사식(`user` · `ip` · `session` · `email` · `_by$`)에 걸리지 않음.
- 쓰기: `system_tx("citation cache write")`(1B와 같은 고정 문자열 — 변수 · DOI 없음). 무료 PDF용 새 쓰기 문자열 없음.
- OpenCitations 참고문헌은 **씨앗이 OpenAlex 번호를 가질 때만** `citation_edges(work_no, 'references', source='opencitations')`에 씀(1B 8.3절 키 체계 그대로). **OpenAlex 참고문헌 행이 이미 있으면 덮어쓰지 않음**(OpenAlex가 0편일 때만 쓰는 보강이므로). OpenAlex 번호가 없는 논문의 OpenCitations 결과는 **캐시하지 않음**(매번 호출 — 한도 안).
- **OpenAlex 작품 행도 함께 씀(16.5절 6번)**: OpenCitations 보강 때 DOI로 서지를 찾은 OpenAlex 작품은 1B `external_works`에 같은 방식으로(`store.write`, `system_tx("citation cache write")` 한 번에 관계 행과 함께) 씀 — 다음 사람이 같은 목록을 볼 때 서지를 다시 받지 않게. `source`는 `openalex` 그대로라 새 출처 · 새 열은 없음. 서재 · 검색 결과 · 무료 PDF 조회는 여전히 쓰지 않음(U-5).
- 크기: 새 열 한 개 · OpenCitations 행은 1B 상한 150MB(`cache-prune`) 안. `cache-prune` 변경 없음.

### 10.3 서재 (`papers`) — 바꾸지 않음 (K-16)
KCI · RISS · Europe PMC 결과를 서재에 넣으면 지금 열(`title` · `authors` · `doi` · `url` · `abstract` · …)에 그대로. 카드 전용 칸(`kci_id` · `riss_id` · `pmid` · `badges` · `oa_open_url`)은 저장하지 않음.

## 11. 서버 API

| 경로 | 내용 |
|---|---|
| `GET /api/search?source=kci\|riss\|europepmc&q=…&page=…&cursor=…` | 6장. `cursor`는 Europe PMC만(`next_cursor`를 응답에 넣음). 응답 `items`는 `mark_library` 거침(지금과 같음) |
| `GET /api/sources` | 소스별 사용 가능 여부만 `{"kci":{"enabled":false,"reason":"unconfigured"}, "riss":{…}, "europepmc":{"enabled":true}}` — 키 값은 돌려주지 않음 |
| `POST /api/oa/lookup` `{"doi"}` (본문으로만) | OpenAlex 기준(8.1절). `{"oa": {pdf_url, landing_url, license, version, server_fetch: bool, open_url, open_kind} \| null, "cached": bool}`(`cached` = 1B 캐시 행에서 읽음). `pdf_url`은 **서버가 받을 위치일 때만** 채움(아니면 빈 값 — 새 탭 주소는 `open_url`). DOI 모양이 틀리면 400 `bad_doi`, OpenAlex 연결 실패 502 `upstream_unavailable`. DOI는 경로 · 쿼리에 넣지 않음 |
| `POST /api/papers/{pid}/fetch-pdf` | 8.3절 순서(경계 ① 엄격화 — D1 · 대신 받기). 서버가 받으면 `{paper, warnings, license}`(대신 받았으면 `via: "substitute"`도 있고 서재 `pdf_url`이 받은 주소로 바뀜), 새 탭이면 `{"open_url", "open_kind", "reason": "license_unknown"}`(200), 없으면 지금처럼 404, 외부 조회 실패 502. 본문의 주소는 쓰지 않음 |
| `POST /api/papers`(`download_pdf: true` + `pdf_url`) | 보낸 `pdf_url`을 믿지 않고 8.3절 판정을 다시 함(16.4절 1번 — arXiv 주소 · 그 DOI의 허용 라이선스 OpenAlex 위치와 글자까지 같은 주소만 그대로 받고, 그 밖은 같은 논문의 arXiv · 허용 라이선스 공개본을 대신 받음(본문 `arxiv_id`로 판정), 없으면 새 탭, D1). 응답 `{paper, warning}` — 대신 받았으면 `via: "substitute"` · `license`를 덧붙이고 서재 `pdf_url`을 받은 주소로 바꿈, 대신 받을 곳도 없으면 PDF 없이 추가하고 `{open_url, open_kind, reason}`을 덧붙임 |
| `GET /api/papers/{id}/related?kind=references` · `POST /api/related` | 9.2절 보강, 응답에 `via` · `unresolved` · **`warnings`**(`oc_failed` · `refs_partial` — 항상 배열) |
| `POST /api/graph`(1B, SSE) | 그래프 결과(`result` 이벤트)에 **`refs_via`**(`"opencitations"` | `"s2"` — 씨앗 참고문헌을 보강으로 채웠을 때만) 추가, 경고 `oc_failed`(9.3절) |

- 모든 경로 로그인 · `X-PaperLab` · Origin 검사(1단계 규칙 그대로).
- 동시성: 사용자당 외부 검색 동시 2개(가정 — 넘으면 429 `search_busy`). 서버 전체 속도 제한은 14장.

## 12. 수용 기준

표시: `[자동]` pytest/Node(녹화 픽스처 · 가짜 전송 — 네트워크 차단), `[db]` 테스트용 Supabase, `[수동]` 화면, `[실환경]` 서버 PC + 실제 키. 공통 준비: 사용자 A · B, 가짜 전송(`httpx.MockTransport`)이 요청을 **기록**(호스트 · 경로 · 매개변수 · 헤더). **RISS 조건(U-2)**: `[수동]` · `[실환경]` · M5의 RISS 결과 항목(AC-583 · 584의 RISS 부분, M5-1 · M5-3)은 **RISS 키를 받은 경우에만** 실행하고, 키가 없으면 "RISS 비활성 표시 + 1A [RISS] 검색 바로가기 동작"으로 대신 확인한다. `[자동]` RISS 항목은 손 픽스처로 항상 실행.

### 50x 검색 공통
- **AC-501** [자동] `source=kci|riss|europepmc`에서 가짜 전송이 받은 요청의 호스트가 각각 상수 한 곳(9.1 · 14장 표)뿐이고, 검색어가 **쿼리 매개변수**로만 있으며(경로에 없음), 리디렉션 응답(302)을 따라가지 않고 `upstream_unavailable`이 된다.
- **AC-502** [자동] 6.4절 표대로 매개변수가 만들어진다: 연도 2015~2020 → KCI `dateFrom=201501` · `dateTo=202012`, RISS `spubdate=2015` · `epubdate=2020`, EPMC `PUB_YEAR:[2015 TO 2020]`. 2쪽 → KCI `page=2` · RISS `rsnum=21`. RISS 무료 → `charge=1`. EPMC 피인용순 → `sort=CITED desc`.
- **AC-503** [자동] KCI · RISS에 `sort=cited` 또는 KCI에 `oa=true`를 보내면 400 `unsupported_option`이고 외부 호출 0회.
- **AC-504** [자동] `KCI_API_KEY` 또는 `RISS_API_KEY`가 설정되지 않은 소스 → 503 `source_unconfigured`, 외부 호출 0회. `GET /api/sources`가 그 소스를 `enabled: false`로 주고 응답 어디에도 키 문자열이 없다. `RISS_API_KEY`만 비우고 KCI 키는 두면 KCI는 정상, RISS만 꺼진다.
- **AC-505** [자동] 429 → 1회 재시도(`Retry-After` 최대 5초), 다시 429면 429 `upstream_limited`. 5xx · 연결 오류 → 1회 재시도 뒤 502. 응답 10MB 초과 · `<!DOCTYPE` 포함 XML · 깨진 XML/JSON → 502 `upstream_unavailable`. **D2**: 바이트에 `<!DOCTYPE` · `<!ENTITY`가 안 보이는 인코딩(UTF-16 등)의 DOCTYPE · ENTITY 문서도 502(expat `StartDoctypeDeclHandler` · `EntityDeclHandler`에서 거부), DOCTYPE 없는 보통 UTF-16 XML은 정상으로 읽힘.
- **AC-506** [자동] DOI 모양 검색어는 `source=kci`여도 지금처럼 `resolve` 경로(Crossref · OpenAlex 가짜 전송)로 가고 KCI 가짜 전송 호출 0회.
- **AC-507** [db] KCI · RISS · EPMC 결과 카드를 `POST /api/papers`로 넣으면 서재에 추가되고, 같은 검색을 다시 하면 그 카드 `in_library`가 새 id. 같은 DOI(또는 같은 정규화 제목 12자 이상)를 다시 넣으면 409 `duplicate`.

### 51x KCI
- **AC-511** [자동] `tests/fixtures/extsources/kci_search.xml`을 파싱하면 카드 필드(6.1절)가 기대값과 같다: 제목 원어 우선, 초록, DOI 소문자, KCI 피인용, `kci_id` 형식 검사, `orte-open-yn=Y` → `is_oa: true` · `pdf_url: ""`.
- **AC-512** [자동] 오류 응답 픽스처 "등록되지 않은 key" · "사용기간이 종료되었습니다" → 502 `source_key_invalid`, 응답 · 로그에 키 값이 없다.
- **AC-513** [자동] 요청 매개변수에 `apiCode=articleSearch` · `title=<q>` · `displayCount=20` · `key=<공용 키>`가 있다(U-1 확정 — 사용자 A · B가 같은 키로 요청하고 사용자별 키 칸은 없다).

### 52x RISS
- **AC-521** [자동] 공식 샘플을 본뜬 `riss_search.xml`(`riss.stitle`) · 녹화 응답(`riss.stype`) 모두에서 학술지명이 채워진다. 저자 `백정현(Jeong-Hyun Baek);김철수` → 성 · 이름 두 명(괄호 제거). `url` `http://www.riss.kr/link?id=A101700042` → `https://www.riss.kr/link?id=A101700042`, `riss_id = A101700042`. 다른 호스트 `url`은 빈 값.
- **AC-522** [자동] `<Error>004</Error>`(HTTP 200) → 502 `source_key_invalid`. `<Error>0</Error>`이고 `metadata` 0개 → 200 빈 결과.
- **AC-523** [자동] 결과 카드에 `doi` · `abstract`가 빈 값이고 `riss.reg` · `riss.charge=1`이 `badges`에 들어간다.
- **AC-524** [자동] (U-2) `RISS_API_KEY`가 없으면 `GET /api/sources`의 `riss.enabled = false`(`reason: "unconfigured"`)이고 `source=riss` 검색은 503 · 외부 호출 0회. 가짜 키를 넣은 테스트에서는 손 픽스처(`riss_search.xml`)로 AC-521~523이 통과한다 — RISS 코드 경로는 키가 없는 동안에도 **자동 테스트로 유지**된다. 실제 RISS 서버를 부르는 테스트는 없다.

### 53x Europe PMC
- **AC-531** [자동] 녹화 `epmc_search.json`에서 제목 · 초록의 HTML 엔티티 · 태그가 제거되고, `url`이 `https://europepmc.org/article/MED/<id>` 꼴, `isOpenAccess=Y` → `is_oa: true`. `source` · `id`가 형식 밖이면 `url` 빈 값.
- **AC-532** [자동] 첫 쪽 응답의 `nextCursorMark`가 `next_cursor`로 오고, 그 값으로 다시 요청하면 `cursorMark=<값>`이 매개변수로만 간다. 키 · 인증 헤더가 없다.
- **AC-533** [자동] Europe PMC 카드는 `fullTextUrlList` · `license`가 응답에 있어도 `pdf_url`이 빈 값이고 `oa_open_url`도 없다(U-4 — 무료 PDF 정보는 OpenAlex 것만).

### 54x OpenAlex 무료 PDF (U-3 · U-4 — Unpaywall 없음)
- **AC-541** [자동] 5단계 테스트 전체에서 가짜 전송이 받은 요청 중 호스트가 `api.unpaywall.org`인 것이 **0개**, 코드에 `unpaywall` · `UNPAYWALL_EMAIL`이 **없다**(코드 검색). `GET /api/sources` 응답에 `unpaywall` 키가 없다.
- **AC-542** [자동] `server_fetch_allowed(license)`: `cc-by` · `cc-by-sa` · `cc-by-nc` · `cc-by-nd` · `cc-by-nc-sa` · `cc-by-nc-nd` · `cc0` · `public-domain`(대문자 섞인 `CC-BY`도) → 참. `None` · `""` · `other-oa` · `publisher-specific-oa` · `foo` → 거짓.
- **AC-543** [자동] DOI `10.1234/a/../b` · `10.1234/./b` · `10.1/x?y#z`(등록자 번호가 4~9자리 밖) · `not a doi` · 빈 값 → OpenAlex 요청 0회(앞), `10.1234/x?y#z` → 경로 한 조각 `/works/doi:10.1234/x%3Fy%23z`로 인코딩(뒤, 가짜 서버가 받은 원시 경로에 `?` · `#` 없음). `check_doi("10.1234/a/../b")`는 `ValueError`. **엄격 검사 한 가지로 통일**: `lookup_doi`도 같은 검사를 써서 등록자 번호가 4~9자리 밖인 DOI는 요청 없이 "DOI 형식이 올바르지 않아요"(`SourceError`)로 거부한다. (기록 정리: 처음엔 "`lookup_doi`는 느슨한 검사라 `.` · `..` 조각만 거부"로 적었고 예시도 `10.1/x?y#z`에서 `10.1234/x?y#z`로 바꿨으나, 후속 수정에서 느슨한 검사를 없애 이 단서는 삭제함. 16.5절 5번) ※ `lookup_doi` 직접 단언은 `tests/test_sources.py::test_lookup_doi_strict_doi_check`에 있음(등록자 3자리 · 10자리 · `10.1000.10/…` · `.`/`..` 조각은 요청 0회 거부, `10.1234/a?b#c`는 `/works/10.1234/a%3Fb%23c` 한 조각으로 인코딩 — 승인자 L2, 2026-10-13 추가).
- **AC-544** [db] `fetch-pdf`: 서재 `pdf_url` 없음 · arXiv 아님 · DOI 있음 → 가짜 OpenAlex(`best_oa_location.license: "cc-by"` · `pdf_url`)이면 서버가 그 주소를 받아 `users/{A}/papers/{pid}.pdf`에 저장(가짜 저장소 기록)하고 응답에 `license: "cc-by"`. `license: null` · `"other-oa"` · `"publisher-specific-oa"`이면 저장 0회 · 응답 `{"open_url", "open_kind": "pdf", "reason": "license_unknown"}`(200). `best_oa_location`은 라이선스 없음이나 `oa_locations`에 `cc-by` PDF 위치가 있으면 그 위치를 받는다. PDF 위치 없이 `landing_page_url`만 있으면 `open_kind: "landing"`.
- **AC-545** [db] 1B 캐시에 그 DOI의 OpenAlex 작품 행(`oa_license` 채워짐)이 있으면 `POST /api/oa/lookup`이 OpenAlex 호출 0회 · `cached: true`(다른 사용자 B 포함). `oa_license`가 null인 행 · 행이 없으면 OpenAlex 1회 · `cached: false`이고 **조회 결과가 `external_works`에 새로 쓰이지 않는다**(행 수 · `oa_license` 값 그대로). **D5**: `oa_license`가 `''`인 행도 캐시로 판정하지 않고 OpenAlex 1회 · `cached: false` — `best_oa_location`은 라이선스 없음이나 `oa_locations`에 `cc-by` 위치가 있으면 그 위치를 서버가 받을 위치(`server_fetch: true`)로 돌려준다(검색 카드와 같은 결과).
- **AC-546** [자동] `download_pdf("https://www-riss-kr-ssl.openlink.inha.ac.kr/x.pdf")` · `https://openlink.inha.ac.kr/…` → 요청 0회 · 실패(어느 경로에서 불러도). 테스트 전체에서 가짜 전송이 받은 요청 중 호스트가 `openlink.inha.ac.kr`로 끝나는 것이 0개. 새 탭용 `open_url`도 `openlink` 호스트로 감싸지 않는다.
- **AC-547** [db] `fetch-pdf`가 클라이언트 본문의 주소를 쓰지 않는다: 본문에 `{"pdf_url":"https://evil.example/x.pdf"}`를 넣어도 가짜 전송이 그 호스트 요청을 받지 않는다. **`POST /api/papers`(`download_pdf: true`)도 보낸 `pdf_url`을 그대로 받지 않는다**(팀장 결정 1): 라이선스 없는 OpenAlex 위치와 같은 주소를 보내면 PDF 없이 논문만 추가되고 응답에 `open_url` · `open_kind: "pdf"` · `reason: "license_unknown"` · 안내 `warning`이 있으며 그 호스트 요청 0회. `cc-by` 위치 주소면 받아 저장(`open_url` 없음). openlink 호스트 주소를 보내면 PDF 없이 추가 + `warning`, openlink 요청 0회. **D1**: 그 밖 주소(S2 `pdfs.semanticscholar.org/…` · 허용 위치 주소에 `?x=1`을 붙인 변형 · 사용자가 넣은 주소)는 보낸 주소로는 요청 0회. **대신 받을 곳(arXiv 번호 · 허용 라이선스 위치 · OpenAlex의 arXiv 위치)이 없으면** PDF 없이 추가 + 보낸 주소 그대로 `open_url`, 있으면 대신 받음(AC-550a · 550b).
- **AC-548** [db] (K-12 · K-22) 지금 `lookup_doi` 경로의 OpenAlex `best_oa_location`이 라이선스 없음이면 서버 저장 0회 · `open_url`. **OpenAlex 위치가 없고 Crossref `link`만 있는 논문은 Crossref를 1회 조회해 서버 저장 0회 · `open_url`**(`open_kind: "pdf"`). arXiv 논문(서재 `pdf_url`이 `arxiv.org` 또는 arXiv 번호)은 지금처럼 서버가 받는다 — **OpenAlex 위치 중 `arxiv.org` PDF 위치도 라이선스 없이 서버가 받는다**(`pick_oa_location`, 16.5절 2번). 서재 `pdf_url`이 가짜 OpenAlex 위치 중 하나와 같고 `license`가 없으면 — **같은 논문에 대신 받을 곳(arXiv 번호 · 허용 라이선스 위치 · OpenAlex의 arXiv 위치)이 없을 때** — 서버 저장 0회 · `open_url`(있으면 AC-550a대로 대신 받음). 서재 `pdf_url`이 1B 캐시 행의 위치와 다르면 캐시로 판정하지 않고 OpenAlex 위치 전체를 다시 조회한다(16.5절 3번).
- **AC-550** [db · 자동] (D1 — 8.3절 경계 ① 엄격화, `fetch-pdf` · `POST /api/papers` 둘 다) 서버가 받는 주소는 (a) arXiv 주소 (b) 그 DOI의 OpenAlex 위치 중 허용 라이선스 위치와 **글자까지 같은 주소**뿐이다. 그 주소 **그대로** 받는 것은 이 둘뿐이고, 다음 주소는 **같은 논문에 대신 받을 곳(arXiv 번호 · OpenAlex의 arXiv 위치 · 허용 라이선스 위치 — AC-550a)이 없을 때** 저장 0회 · 응답 `{"open_url": <그 주소 그대로>, "open_kind": "pdf", "reason": "license_unknown"}` · 가짜 전송이 그 주소의 호스트 요청 0회: 라이선스 없는 위치 주소 · 사용자가 직접 넣은 주소(DOI 있음) · 사용자가 넣은 주소(DOI 없음) · S2 주소(`pdfs.semanticscholar.org`) · Crossref 주소 · 허용 위치 주소에 `?dl=1`을 붙인 변형 · `http://`로 바꾼 변형. (대신 받을 곳이 있으면 같은 주소들도 AC-550a대로 대신 받으며, **어느 경우에도 보낸 주소의 호스트로는 요청 0회**.) 서재 `pdf_url`이 허용 위치와 같으면 받고 `license`가 응답에 있다(`via` 없음). arXiv 주소(`pdf_url`이 `arxiv.org`)는 그대로 받는다. 순수 함수(`plan_pdf`) 단위: 캐시에 같은 주소의 허용 위치가 있으면 OpenAlex 조회 0회, 캐시 위치가 허용이 아니거나 주소가 다르면 OpenAlex 1회, DOI가 없으면 허용 위치와 같은 글자의 주소라도 그대로는 받지 않고(arXiv 번호가 없으면 새 탭), `http`/`https`가 아닌 주소는 없는 것으로 쳐서 arXiv 번호 · DOI 순으로 넘어간다.
- **AC-550a** [db · 자동] (사용자 결정 2 — **대신 받기**, 8.3절 경계 ①) `fetch-pdf`: 서재 `pdf_url`이 규칙에 맞지 않을 때 다음을 가짜 서버로 확인한다 — ⓐ DOI에 허용 라이선스 위치(예: `cc-by`)가 있고 `pdf_url`이 S2 주소 · `?dl=1` 변형 · `http://` 변형이면 그 허용 위치를 받아 저장하고 응답 `via: "substitute"` · `license: "cc-by"`, 서재 `pdf_url`이 그 위치 주소로 바뀜, 보낸 주소 호스트 요청 0회. ⓑ 논문에 `arxiv_id`가 있으면(DOI의 허용 위치가 없어도) `https://arxiv.org/pdf/<번호>`를 받고 `license: ""`, 서재 `pdf_url`이 그 주소로 바뀜. ⓒ 같은 논문에 허용 위치와 arXiv 위치(번호 없이 OpenAlex 위치로만)가 둘 다 있으면 **arXiv가 먼저**, `arxiv_id`가 있으면 OpenAlex 위치 조회 결과와 상관없이 arXiv. ⓓ 위치 중 `openlink.inha.ac.kr` 호스트(허용 라이선스여도)는 후보에서 빠지고, 그 호스트 요청 0회(`openlink.inha.ac.kr.evil` 같은 다른 호스트는 후보). ⓔ 아무것도 없으면 `{"open_url": <원래 주소>, "open_kind": "pdf", "reason": "license_unknown"}`(AC-550). ⓕ 서재 `pdf_url`이 비어 있으면 대신 받기가 아니라 기존 순서(arXiv 번호 → DOI)이고 `via`가 없다. 순수 함수 단위(`tests/test_extsources.py::test_plan_pdf_substitute` · `test_plan_pdf_order`): `plan_pdf`와 `substitute`의 반환값이 `{"fetch", "license", "via": "substitute"}` 꼴.
- **AC-550b** [db · 자동] (대신 받기 — `POST /api/papers`, `download_pdf: true`) DOI에 허용 위치가 있고 보낸 `pdf_url`이 그 밖 주소(S2 · `?x=1` 변형)면 PDF가 저장되고(`has_pdf`) 응답 `via: "substitute"` · `license: "cc-by"` · `warning: ""` · `open_url` 없음, 저장된 논문의 `pdf_url`이 받은 허용 위치 주소로 바뀐다. **본문의 `arxiv_id`**가 있으면 DOI의 허용 위치가 없어도 arXiv를 받는다(`license: ""`). 대신 받을 곳이 없으면 PDF 없이 추가 + `open_url`(보낸 주소 그대로) + `warning`, 그 호스트 요청 0회. `ftp://` 같은 주소는 `plan_pdf`가 None → 경고 "찾지 못했어요"(TypeError 아님).
- **AC-550c** [자동 Node] `tests/js/sources.test.mjs`: `substituteText("cc-by")` = "같은 논문의 무료 공개본(라이선스 CC BY)을 받았어요", `substituteText("")` · `substituteText("other-oa")` = "같은 논문의 무료 공개본을 받았어요"(괄호 없음).
- **AC-550d** [수동 — 아직 안 함] (대신 받기 화면) 서재에서 PDF 주소가 허용 위치가 아닌 DOI 논문(허용 라이선스 공개본이 있는 논문)의 [무료 PDF 찾기]를 누르면 토스트 "같은 논문의 무료 공개본(라이선스 …)을 받았어요"가 뜨고 PDF가 열린다(서재 `pdf_url`은 받은 주소로 바뀌지만 화면에는 보이지 않고 토스트로만 알림). 논문 찾기에서 [PDF 포함 추가]를 누르면 "서재에 추가하고 같은 논문의 무료 공개본…을 받았어요". 대신 받을 곳이 없는 논문은 [무료 PDF 열기 ↗] 링크가 나온다. `via`가 없는 일반 저장은 지금 문구("무료 PDF를 받아 저장했어요 (CC BY)" · "서재에 추가했어요") 그대로.
- **AC-549** [자동] OpenAlex 결과 카드(`norm_openalex`): `best_oa_location.license = cc-by` → `pdf_url` 채워짐, `license = null` → `pdf_url` 빈 값 + `oa_open_url`(arXiv 주소 대체 채움은 지금대로).

### 55x OpenCitations
- **AC-551** [db] 서재 논문(DOI 있음, 가짜 OpenAlex 참고문헌 0편)의 `related?kind=references` → 가짜 OpenCitations `/index/v2/references/doi:<DOI>` 1회 + OpenAlex `doi:` 필터 ≤ 2회 → 목록 · `via: "opencitations"` · `unresolved`(OpenAlex가 모르는 DOI 수)가 기대값. 인증 헤더 없음.
- **AC-552** [db] 같은 논문을 B가 열면 OpenCitations 호출 0회(씨앗에 OpenAlex 번호가 있을 때 — `citation_edges.source = 'opencitations'`). OpenAlex 번호가 없는 논문은 매번 호출(캐시 행 0개).
- **AC-553** [db] 1B 그래프: 씨앗 OpenAlex 참고문헌 0편 + DOI → OpenCitations 1회로 채워지면 S2 호출 0회, 응답에 **`refs_via: "opencitations"`**(팀장 결정 5). OpenCitations가 0편 · 실패 → S2 1회(지금 그대로), 실패는 경고 `oc_failed`. S2가 참고문헌을 채우면 `refs_via: "s2"`(D6 — 화면은 이때만 "Semantic Scholar 자료로 채웠어요"), S2도 0편이면 `refs_via` 없음 · 서버 `oc_failed` 문구가 그대로 보임. 그래프 1회 목록 호출 ≤ 12(AC-G11 회귀).
- **AC-554** [db] OpenAlex `references` 행이 이미 있는 작품에는 OpenCitations 결과를 쓰지 않는다(행의 `source`가 그대로 `openalex`). 목록 응답은 OpenCitations 것(`via`)이어도 캐시 행은 덮어쓰지 않는다.
- **AC-555** [db] (팀장 결정 4) `related?kind=references`: OpenAlex 0편 + OpenCitations 5xx · 연결 오류 → 200, `items: []` · `warnings: [{"code":"oc_failed"}]`(0편과 구분). OpenCitations 404 → 경고 없이 빈 목록. 정상 응답은 `warnings: []`.
- **AC-556** [db — **테스트 추가됨**(`tests/test_extsources_api.py`)] (16.5절 6번) OpenCitations 보강 때 DOI로 서지를 찾은 OpenAlex 작품이 `external_works`에 쓰이고(`source = 'openalex'`, 가짜 참고문헌 25편 모두 행 있음), B 사용자가 같은 목록을 열면 그 작품들의 OpenAlex `doi:` 조회 요청이 0회이고 캐시로 그려진다.

### 56x 캐시 · RLS
- **AC-561** [db] 마이그레이션 두 번 → 두 번째 할 일 없음. `external_works.oa_license` 열이 있고 200자 값 → 거부, null · `''` · `'cc-by'` 허용. `external_works.source`는 `'openalex'`만 허용(`'unpaywall'` · `'kci'` → 거부). `citation_edges.source='opencitations'` 허용 · `'foo'` 거부.
- **AC-562** [db] AC-G20 · G21 회귀: 두 표 RLS + force, `authenticated`는 `select`만, 새 열 이름(`oa_license`)이 검사식에 걸리지 않고, 시각 열은 모두 `date`(새 시각 열 없음). B 사용자 트랜잭션에서 `insert` → 권한 오류.
- **AC-563** [자동] 코드 검사: 공용 캐시 쓰기 SQL이 `system_tx(` 안에만 있고 5단계가 더하는 이유 문자열이 고정 문자열 `"citation cache write"` 하나뿐(`"oa cache write"` 없음 — 무료 PDF 새 쓰기 경로 없음). 1B 업서트가 `oa_license`를 함께 쓴다.
- **AC-564** [db] (U-5) KCI · RISS · EPMC 검색과 `fetch-pdf` · `oa/lookup`을 여러 번 한 뒤 `external_works`에 `source in ('kci','riss','europepmc')` 행이 0개이고, 그 호출들 때문에 `external_works` 행 수가 늘지 않으며, 어떤 표에도 검색어 문자열이 없다.

### 57x 보안 · 로그
- **AC-571** [자동] 5단계 테스트 전체 동안 서버 로그(접근 · 앱 · `system_tx`)에 심어 둔 검색어 · DOI · KCI 키 · RISS 키 문자열이 **한 번도** 나오지 않는다. 외부 오류 로그 줄은 `{"event":"upstream_error","host":…,"status":…}` 꼴뿐.
- **AC-572** [자동] `config.redact`가 `?key=abc123…` · `api_key=` · `&email=x@y.z` 값을 가린다(새 패턴 — `email=`은 5단계에서 쓰지 않지만 K-17대로 방어용으로 둠), 예외 메시지에 요청 주소가 섞여도 키가 나오지 않는다.
- **AC-573** [자동] `paperlab/` 안에서 5단계 경로가 만드는 외부 호스트가 14장 표의 상수뿐이다(코드 검색) — `riss.kr` · `kci.go.kr`의 API 경로 외 페이지(원문 · 상세 화면)를 부르는 코드가 없다.
- **AC-574** [자동] 인증 · 요청 규칙: 11장 새 경로에 토큰 없음 401, `X-PaperLab` 없음 403, 남의 Origin 403. `POST /api/oa/lookup` 본문 5KB → 400. **D3**: `Content-Length` 없이 chunked로 6KB를 보내도 400 `bad_request`(4KB를 넘게 읽지 않음), 본문이 JSON 객체가 아니면(`[1]`) 400.
- **AC-575** [자동] 자동 테스트가 실제 네트워크로 나가면 실패한다(가짜 전송이 아닌 요청 차단 단언 — 1B 12장 방식).

### 58x 화면
- **AC-581** [자동 Node] `tests/js/sources.test.mjs`: 소스별 정렬 · 필터 사용 가능 표(6.4절)가 서버 표와 같고(같은 JSON 상수를 서버가 내려 줌 — 또는 두 곳 비교 테스트), 키 없는 소스 · 미지원 옵션이 비활성 + 이유 문구를 돌려준다.
- **AC-582** [자동] `discover.js`가 결과 제목 · 저자 · 초록 · 배지를 `esc()`/`textContent`로만 넣는다(코드 검사).
- **AC-583** [수동] 논문 찾기 소스 목록에 KCI · RISS · Europe PMC가 있고, 키가 없을 때 이유가 보이며, KCI · RISS 결과 카드 아래 출처 한 줄("KCI(한국연구재단)" · "RISS(KERIS)")이 보인다.
- **AC-584** [수동] KCI(DOI 있음) · RISS 결과의 [인하대에서 보기]가 각각 `doi-org-ssl.openlink…` · `www-riss-kr-ssl.openlink…` 주소로 새 탭을 열고, KCI(DOI 없음)는 버튼이 없다. 서재에 넣은 뒤 상세 패널에서도 같다.
- **AC-585** [수동 — **아직 안 함**, 구현 뒤 사람이 확인] [무료 PDF 찾기] → CC 논문은 [PDF 포함 추가]로 서재 + PDF, 라이선스 없는 논문은 [무료 PDF 열기 ↗] 링크 + 안내 문구(새 탭 주소가 `openlink` 호스트가 아님). 팝업 차단 경고가 뜨지 않는다. **서재 상세의 무료 PDF 세 상태**(① 서버가 받아 저장 · ② 새 탭 열기(`landing`이면 "무료 원문 페이지 열기") · ③ 없음)를 모두 눈으로 확인한다.
- **AC-586** [수동 — **아직 안 함**] 인용 관계 탭에 "OpenCitations 기준" 표시가 보이는 논문이 하나 이상(품질팀이 OpenAlex 참고문헌 0편 · DOI 있는 논문을 고름). 같은 논문의 그래프 아래 출처 줄이 "OpenAlex · OpenCitations 기준"인지도 확인.
- **AC-587** [자동 Node · 수동] (D6) `GM.toModel`이 그래프 응답의 `refs_via`(`"opencitations"` | `"s2"` | 없음)를 `refsVia`로 옮긴다(`tests/js/graph.test.mjs`가 `s2` · `opencitations` · 없음(`""`) 세 경우를 모두 단언 — 승인자 L3, 2026-10-13 추가). 화면: `oc_failed`가 있는 그래프에서 `refs_via`가 `s2`이면 "OpenCitations가 응답하지 않아 Semantic Scholar 자료로 참고문헌을 채웠어요."가, `refs_via`가 없으면(S2도 0편) 서버 문구 "OpenCitations가 응답하지 않아 참고문헌을 보강하지 못했어요."가 보인다. 서버 `WARNINGS["oc_failed"]` 문구가 위와 같다.
- **AC-588** [수동] (D7) 화면 폭 560px 이하(예: 390px)에서 논문 찾기 화면 전체가 한 번에 스크롤되고, 검색 줄 · 필터 · 이유 줄이 길어져도 결과 목록이 머리에 가려지지 않으며 결과 상자 안에 따로 스크롤 영역이 생기지 않는다. 가로 넘침 없음.
- **AC-589** [수동 · 가능하면 자동] (D8) KCI 키가 없는 서버에서 화면을 연 채(소스 목록 응답이 모두 켜진 상태) KCI로 검색해 503 `source_unconfigured`를 받으면, 새로 고침 없이 KCI 옵션이 "KCI (키 등록 전)" 비활성이 되고 선택이 OpenAlex로 돌아가며 이유 줄에 "KCI를 지금 쓸 수 없어 OpenAlex로 바꿨어요."가 보인다.

### 59x 회귀
- **AC-591** [자동] 1 · 1A · 1B · 1C · 2a · 3 · 4단계 자동 검사가 모두 통과한다(1A `extlinks.js` 변환표 · 1B AC-G11 · G12 · G19 · G20 포함).

### 실환경 (키 발급 뒤 — 서버 PC)
- **AC-5R1** KCI · Europe PMC에서 "딥러닝" · "deep learning" 검색이 결과를 보이고 서재에 추가됨(PLAN 5단계 완료 기준 ①). **RISS는 키를 받았을 때만** 같은 검사(키가 없으면 이 항목에서 RISS는 제외 — 비활성 표시와 1A [RISS] 검색 바로가기가 동작하는지만 확인). 각 소스 첫 응답 시간 기록.
- **AC-5R2** DOI가 있는 OA 논문 3편(CC 2 · 라이선스 없음 1)에서 OpenAlex 무료 PDF 정보로 U-3 규칙대로 — CC는 서버가 받아 서재에 저장, 라이선스 없음은 새 탭으로 엶(완료 기준 ②). 기존 OpenAlex [PDF 받기]도 같은 결과.
- **AC-5R3** 실측 보고(4장 "확인 필요"를 이 문서에 반영): KCI 호출 주소 · `keyword`만으로 검색되는지 · `displayCount` · `sortNm=pubiYr` 방향 · `citation-count` 구조 · `url` 모양, RISS https 지원 · 한도 · 키 유효기간(키를 받은 뒤), Europe PMC `pageSize` 최대, OpenCitations `cited` 값 모양, **OpenAlex `best_oa_location` · `oa_locations`의 `license` 실제 값 목록과 필드 이름**(개발팀 첫 주 — 8.2절 허용 목록 확정용). **실행 방법**: 관리자가 키로 `tools/record_extsources.py`를 한 번 실행(서버 PC 안내서 `deploy/server-pc/README.md` 14절). 구체 목록은 16.3절.

### 수동 확인 (배포 뒤 — 사용자)
- **M5-1** 로그인하지 않은 상태에서 RISS 결과 [인하대에서 보기] → 학교 로그인 → 그 논문 화면으로 돌아오는지(1A M-1과 같은 종류).
- **M5-2** KCI 결과의 국문 초록 · 저자 · 학술지가 KCI 사이트 화면과 같은지 3편.
- **M5-3** RISS `/link?id=` 프록시 주소가 그 논문 상세로 열리고 원문 받기 버튼이 보이는지(구독 · 무료 각 1편).

## 13. 테스트 방법 · 녹화 픽스처 (K-18)

- **가짜 전송**: 지금 `httpx.MockTransport` 방식. 소스별 가짜는 요청을 기록하고 `tests/fixtures/extsources/`의 파일로 답함.
- **녹화 픽스처**: `tools/record_extsources.py`(신규 — **관리자가 손으로 한 번 실행**, 자동 테스트 · CI에서 실행하지 않음)가 정해 둔 질의(국문 2 · 영문 1 · DOI 5편)로 실제 응답을 받아 저장. 저장 전 **요청 주소 · 헤더를 버리고 응답 본문만**, 본문에 **키 문자열이 있으면 저장하지 않고 중단**, **이메일 모양 문자열(저자 연락처 등)은 `redacted@example.invalid`로 바꿔 저장**(D9 — 멈추지 않음). 파일 머리(별도 `*.meta.json`)에 받은 날짜 · 소스 · 질의 종류만.
- **키를 받기 전**: KCI는 공식 응답 명세(4.1절)대로 만든 **손 픽스처**(`kci_search.handmade.xml` — 이름에 `handmade` 표시, 녹화본이 생기면 교체), RISS는 **공식 샘플**(`/api/xml/apiSearchDissKor.xml`)을 본뜬 픽스처. Europe PMC · OpenCitations는 키가 없으므로 바로 녹화. **OpenAlex 무료 PDF 정보**(`best_oa_location` · `oa_locations` — CC 논문 · `other-oa`/`publisher-specific` 논문 · OA 없음 각 1편 이상)도 키 없이 바로 녹화해 `license` 실제 값을 확인(8.2절). **RISS는 키를 받기 전까지(또는 못 받으면 계속) 손 픽스처만** 쓰고 녹화 도구에서 RISS는 키가 있을 때만 실행.
- **경계 픽스처**(손으로): 오류 응답(KCI 키 · 사용기간, RISS `004`), 빈 결과, 깨진 XML, `<!DOCTYPE` · 엔티티 포함 XML(UTF-8 · **UTF-16** 둘 다 — D2), 11MB, 302, 429 + `Retry-After`, 위험한 `url`(`javascript:`) · 5,000자 제목.
- **시계 · 오늘 날짜 주입**: 1B `citecache` 방식 그대로(5단계에서 새 TTL 없음).
- **DB 테스트**: 1단계 규칙(`@pytest.mark.db`, 테스트 프로젝트, 공용 캐시 행은 고유 DOI 대역 `10.99999/plt5-…` · 끝나면 지움).
- 파일: `tests/test_extsources.py`(파서 · 매개변수 · 오류 · 보안 — DB 없음), `tests/test_extsources_api.py`(`[db]` — 검색 · 서재 · OpenAlex 무료 PDF · OpenCitations · 캐시), `tests/test_rls.py`(AC-562), `tests/js/sources.test.mjs` + `tests/test_js_node.py` 한 줄.

## 14. 호출 규칙 · 한도 (가정값 — 코드 상수 한 곳, K-14)

| 소스 | 호스트 상수 | 서버 전체 속도 | 시간 제한 | 비고 |
|---|---|---|---|---|
| KCI | `open.kci.go.kr`(확인 필요 — 바뀌면 상수 하나) | 초당 2 | 연결 5초 · 읽기 15초 | 키 `key=` 쿼리 |
| RISS | `www.riss.kr` — https 우선, http만 되면 팀장 보고(키가 평문으로 감) | 초당 2 | 같음 | 키 `key=` 쿼리 |
| Europe PMC | `www.ebi.ac.uk` | 초당 2 | 같음 | 키 없음 |
| OpenCitations | `api.opencitations.net` | 초당 2(공식 IP당 분당 180) | 같음 | 토큰 없음 |

- Unpaywall은 쓰지 않음(U-4). 무료 PDF 조회는 지금의 OpenAlex 호출 규칙 · 호스트(`api.openalex.org`) 그대로이고 클릭 때 1회라 새 상수 · 속도 제한이 없음.
- 공통: 응답 10MB, 리디렉션 안 따라감, 재시도 1회(429 · 5xx · 연결 오류), `Retry-After` 최대 5초, User-Agent `PaperLab/<버전>`(이메일 없음). 1B `GraphSources._send`의 규칙을 공통 함수로 꺼내 씀(K-1).
- XML: 표준 `xml.etree` + **`<!DOCTYPE` · `<!ENTITY`가 바이트에 보이면 파싱 전에 거부**, 그 밖 인코딩(UTF-16 등)은 **expat `StartDoctypeDeclHandler` · `EntityDeclHandler`에서 거부**(D2 — 인코딩과 관계없이 502) + 10MB(K-2). C 구현 `ET.XMLParser`는 안쪽 expat 파서(`.parser`)를 내주지 않아, `xml.parsers.expat` 파서에 `ET.TreeBuilder`를 붙여 씀(`extsources.parse_xml`). 새 의존 패키지 없음.
- 공용 키 하나를 모든 사용자가 나눠 쓰므로 KCI · RISS가 보는 것은 **서버 PC IP + 공용 키 + 검색어**(누가 검색했는지는 모름 — U-1 확정).

## 15. 위험

| 위험 | 대응 |
|---|---|
| **RISS 키를 받지 못함**(이용 대상 "비영리 기관(대학)" · 심사) | U-2 확정 — 받지 못하면 RISS는 1A 검색 바로가기만, PLAN 완료 기준은 "RISS는 키를 받으면"으로 조건부(반영함). RISS 코드 경로는 유지하고 키가 없으면 비활성 · 손 픽스처로만 시험(AC-524) |
| KCI 키 발급 절차가 공문 · 기관 명의일 수 있음(2차 자료) · 키 사용기간 만료 | U-1 · 관리자 작업 목록. 만료는 `source_key_invalid` 문구로 바로 드러남 |
| RISS 이용 허락 BY-NC-ND · KCI 공공누리 적용 범위 불명확 | 출처 표시(AC-583), 영리 이용 없음(3~5명 연구용), 결과 서지를 공용 캐시에 넣지 않음(U-5 확정), 키 신청 때 "소규모 연구 그룹 내부 도구에서 검색 결과 표시 · 개인 서재 저장" 용도를 적고 회신으로 확인 |
| 라이선스 없는 OA PDF를 서버가 받는 것의 저작권 회색 지대 | U-3 확정 — 라이선스가 확인된 것(CC · 퍼블릭 도메인)만 서버가 받고 나머지는 새 탭. 허용 목록 방식(알 수 없는 값은 새 탭), 클릭 한 번 = 한 편, 그 사용자 R2에만, 공유 없음. 서버가 받는 주소는 arXiv(사용자 결정 — "누구나 받도록 공개한 저장소", U-3의 예외, 법률 자문 아님)와 그 DOI의 허용 라이선스 OpenAlex 위치와 글자까지 같은 주소뿐 — 서재에 있는 S2 · Crossref 주소 · 사용자가 직접 넣은 주소 · 변형 주소는 그 주소로 받지 않고, 같은 논문의 arXiv · 허용 라이선스 공개본이 있으면 그것을 대신 받으며 없으면 새 탭(8.3절 경계 ① D1 엄격화 + 대신 받기 · ② — 확정). 이로 인해 **PDF 주소를 직접 넣은 논문은 대신 받을 공개본이 없으면 새 탭으로 열리고 받은 파일을 직접 올려야 함**(사용자 영향) |
| **대신 받기로 서재 `pdf_url`이 바뀜** — 사용자가 넣은 주소가 사라지고 서버가 고른 공개본 주소(arXiv 또는 허용 라이선스 위치)로 덮어써짐. 사용자가 일부러 넣은 판본(예: 학교 서버의 최종본)과 다른 파일이 저장될 수 있음 | 사용자 결정 2(대신 받기)의 알려진 부작용이라 막지는 않고 **알림으로 드러냄**: 토스트에 "같은 논문의 무료 공개본…을 받았어요"(`via: "substitute"`)로 다른 파일임을 알림(주소 자체는 화면에 보이지 않음). 원래 주소는 복구하지 않음(필요하면 사용자가 [PDF 첨부]로 올림). 서버는 보낸 주소의 호스트를 부르지 않음(AC-550a). 후보는 arXiv와 허용 라이선스 위치뿐이라 U-3 · U-3 예외 범위를 넘지 않음 |
| OpenAlex `license` 값이 예상과 다름(허용 목록 밖 표기, 필드 이름 다름) | 안전한 쪽(새 탭)으로 동작. 개발팀 첫 주 녹화로 확인(AC-5R3), 목록 변경은 팀장 보고 |
| 공용 캐시가 드러내는 것 | 5단계 새 신호는 OpenCitations 참고문헌 행(1B 8.6절 8번과 같은 종류, 누구인지는 없음). 무료 PDF 조회는 새 캐시 행을 만들지 않음(U-5). DB 직접 접근은 관리자뿐, 목록 API 없음 |
| 공용 키 남용 · 한도 | 사용자당 동시 2, 서버 전체 초당 2, 오류 code로 드러남. 한도 수치는 실측(AC-5R3) |
| 키가 쿼리 문자열에 실림 | URL을 로그 · 오류 문구에 남기지 않음, `redact` 패턴(AC-571 · 572), https만(RISS 확인 필요) |
| XML 폭탄 · 외부 엔티티 | DOCTYPE · ENTITY 거부(바이트 검사 + expat 처리기 — UTF-16도) + 10MB(AC-505) |
| 학교 프록시 자동 요청 사고 | `download_pdf` openlink 호스트 거부(AC-546), 서버 코드가 openlink 주소를 만들지 않음(1A 그대로) |
| Europe PMC 한도 미확인 | 낮은 속도(초당 2), 차단 징후(403 · 429 연속)면 팀장 보고 |

## 16. 결정 · 미정

### 16.1 사용자 결정 (2026-10-13 — 확정)
| # | 질문 | 결정 | 반영 위치 |
|---|---|---|---|
| **U-1** (PLAN P9) | KCI · RISS API 키를 사용자마다 받을까, 하나를 같이 쓸까 | **확정: 공용 키 하나.** 관리자가 신청해 서버 PC `cloud.env`에 둠. PLAN P9 해결 | 2 · 5 · 14장, K-13, AC-513 |
| **U-2** | RISS 키를 받지 못하면 | **확정: RISS는 1A 검색 바로가기만.** 완료 기준에서 RISS 검색은 "키를 받으면" 조건부. 키가 있을 때 쓰는 RISS 코드 경로는 **유지**(팀장 결정) — 키가 없으면 목록에서 비활성, 손 픽스처로만 테스트 | 1 · 3 · 5 · 6.2 · 12 · 13 · 15장, AC-524 · 5R1, PLAN 5단계 |
| **U-3** | 무료 PDF를 어떻게 받을까 | **확정: 라이선스가 확인된 것(CC · 퍼블릭 도메인)만 서버가 받고, 나머지는 새 탭.** 기존 OpenAlex [PDF 받기]에도 같은 규칙(K-12). 판정 규칙: OpenAlex `license`가 cc-by · cc-by-sa · cc-by-nc · cc-by-nd · cc-by-nc-sa · cc-by-nc-nd · cc0 · public-domain 계열이면 받고, 없거나 other-oa · publisher-specific 등이면 새 탭(팀장). 실제 값 목록은 개발팀 첫 주 확인. 새 탭에 프록시 · openlink 호스트 안 씀(K-11) | 8장, AC-542 · 544 · 548 · 549 |
| **U-4** | Unpaywall 이메일은 어떤 주소로 | **확정: Unpaywall은 쓰지 않음.** 무료 PDF 정보는 OpenAlex(`best_oa_location` / `oa_locations`의 `pdf_url` · `license`)만. (앞 초안 선택지 ③에 해당 — 이메일 · `UNPAYWALL_EMAIL` 없음) PLAN 5단계 범위에서 Unpaywall 삭제, 변경 이유는 "사용자 결정" | 1 · 3 · 4.5 · 8 · 10 · 14 · 17장, K-9 · 10 · 13, AC-54x, PLAN |
| **U-5** | 공용 캐시에 무엇을 넣을까 | **확정: DOI로 다시 찾는 것만.** Unpaywall이 빠졌으므로 주 대상은 **OpenCitations 참고문헌 · 피인용 관계**(이 명세 범위는 참고문헌 — 피인용은 3장 "안 하는 것"). OpenAlex 무료 PDF 정보는 새로 넣지 않고 **1B 캐시의 `external_works`(`pdf_url` · `is_oa`)를 읽어 씀**(확인 — 10.1절). 라이선스 칸은 없어 `oa_license` 열 추가(K-21, 확정). 검색 결과 서지는 안 넣음 | 10장, AC-561~564 |
| **U-3 예외** (arXiv) | 8.3절 경계 ②: arXiv 주소는 라이선스 확인 없이 서버가 받아도 될까 | **확정(2026-10-13): 지금처럼 서버가 받는다 — U-3의 예외.** 근거 "arXiv는 누구나 받도록 공개한 저장소". 법률 자문이 아니며 논문마다 저작권자의 허락 범위는 다를 수 있음 | 8.3 · 15장, AC-548 |
| **U-6** (승인자 질문 1) | 사용자가 직접 넣은 PDF 주소도 서버가 받지 않고 새 탭으로 열까 | **확정(2026-10-13): 새 탭으로 연다 — D1 유지.** 사용자가 넣은 주소를 서버가 그 주소로 받지는 않는다(단 U-7로 같은 논문의 공개본이 있으면 그것을 대신 받음) | 8.3 · 15장, AC-547 · 550 |
| **U-7** (승인자 질문 2) | 서재 주소가 허용 위치가 아닐 때(앞 "후속 검토 항목") 같은 논문의 다른 무료 공개본을 대신 받을까 | **확정(2026-10-13): 대신 받는다.** 순서: 그 주소가 허용 위치와 같으면 그 주소 → arXiv PDF(논문 `arxiv_id`, 없으면 OpenAlex 위치 중 arXiv) → 허용 라이선스 OpenAlex 위치 → 모두 없으면 원래 주소 새 탭. openlink 위치는 후보에서 뺌. 응답 `via: "substitute"` · 실제 받은 위치의 `license`, 서재 `pdf_url`은 받은 주소로 바뀜, 토스트 `sourcemeta.substituteText` | 8.3 · 11 · 15 · 18장, AC-550a~550d, 디자인 4.1 |
| **U-8** (승인자 질문 3) | `lookup_doi`의 DOI 검사를 엄격하게 둘까 | **확정(2026-10-13): 지금처럼 엄격하게**(등록자 번호 4~9자리 — 느슨한 검사로 되돌리지 않음). 사용자 영향: `10.1/x` 같은 DOI는 조회되지 않음 | 8.1, AC-543 |

### 16.2 팀장 결정 (2026-10-13 — K-1~K-20 기획팀 추천안으로 확정, 아래 예외 반영)
- **예외 1**: Unpaywall 관련 K-9(삭제) · K-10(OpenAlex 기준으로 다시 씀) — U-4. **예외 2**: K-13의 새 환경 변수는 `KCI_API_KEY` · `RISS_API_KEY` 두 개뿐. U-2에 따라 RISS 코드 경로는 유지(키 없으면 비활성 · 손 픽스처 테스트).
- **K-21**과 8.3절 경계 ①은 확정 이후 기획팀이 새로 올린 항목으로, 팀장이 **확정**(2026-10-13). 경계 ①은 품질 후속에서 팀장이 **엄격화(D1 — 16.6절)**. 경계 ②는 사용자 결정(16.1절 U-3 예외). Europe PMC `fullTextUrlList` 제외 · Crossref `link` · S2 `openAccessPdf` 새 탭만 — 팀장 **확정**.

| # | 결정할 것 | 선택지 | 확정 내용 · 근거 |
|---|---|---|---|
| **K-1** | 코드 위치 | ① 새 모듈 `paperlab/extsources.py`(호출 + 순수 파서) + `sources.py`는 분기만 ② `sources.py`에 모두 | **①** — `sources.py`가 이미 1,000줄, 파서를 픽스처로 따로 시험. 1B `GraphSources._send` 규칙(리디렉션 · 10MB · 호스트+상태 로그 · 재시도)을 공통 함수로 꺼내 두 곳이 같이 씀 |
| **K-2** | XML 파싱 안전 | ① 표준 `xml.etree` + DOCTYPE 거부 + 10MB ② `defusedxml` 새 의존 | **①** — DOCTYPE이 없으면 엔티티 공격이 성립하지 않음, 새 패키지 없음(THIRD_PARTY · 배포 부담 없음). 후속(D2): 바이트 검사에 expat 처리기 거부를 더함 |
| **K-3** | 화면 위치 | ① 논문 찾기 소스 목록에 3개 추가 ② "국내 DB" 탭 따로 | **①** — 지금 구조 그대로, 디자인 변경 최소 |
| **K-4** | 키 없는 소스 표시 | ① 목록에 보이되 비활성 + 이유 ② 목록에서 숨김 | **①** — 기능이 있다는 것과 왜 안 되는지를 알림 |
| **K-5** | 정렬 · 필터 매핑 | 6.4절 표 | **6.4절 그대로** — 미지원은 비활성(조용히 무시하지 않음) |
| **K-6** | Europe PMC 쪽 넘기기 | ① `cursorMark` + [이전]/[다음] ② `page` 번호(공식 지원 확인 필요) | **①** — 공식 문서에 있는 방식. 화면이 지나온 커서를 메모리에 둠 |
| **K-7** | OpenCitations 쓰임 | ① 인용 관계 탭 보강 + 그래프 씨앗 보강(S2 앞) ② 탭만 ③ 그래프만 | **①** — 둘 다 "OpenAlex 참고문헌 0편 + DOI" 같은 조건 · 같은 함수. OpenCitations는 키 없이 분당 180회(S2 키 없는 공용 풀은 429가 잦음 — 1B 7.2절) |
| **K-8** | OpenCitations 저장 | ① DOI → OpenAlex 번호로 바꿔 `citation_edges`(source `opencitations`), 못 바꾼 DOI는 수만 ② DOI 배열 새 열 | **①** — 1B S2 보강과 같은 방식 · 같은 키 체계, 화면에 서지가 어차피 필요(OpenAlex `doi:` 묶음) |
| **K-9** | ~~Unpaywall 캐시 저장 · 기간~~ | **해당 없음(삭제)** — U-4로 Unpaywall을 쓰지 않음. OpenAlex 기준으로는 새 캐시 행 없이 1B 작품 행 읽기 + `oa_license` 열(K-21) | **예외 1 — 삭제.** 앞 초안의 `source='unpaywall'` 행 · 30일/14일 기간 · `oa_locations` 표 안은 모두 폐기 |
| **K-10** | 무료 PDF 조회를 부르는 때(OpenAlex) | ① 클릭 때만 ② 검색 결과마다 미리 | **①** — 호출 수 · 지연 최소. (OpenAlex 기준으로 다시 씀 — 예외 1) |
| **K-11** | 받을 PDF 주소를 누가 정하나 | ① 무료 PDF 경로는 서버가 캐시 · OpenAlex 조회로 정함(클라이언트 주소 안 씀) + `download_pdf` openlink 거부, 새 탭 열기에도 프록시 · openlink 호스트를 쓰지 않음 ② 클라이언트가 준 주소 | **①** 확정 — U-3 규칙을 서버에서 지킬 수 있고 학교 프록시 자동 요청을 코드로 막음 |
| **K-12** | U-3 규칙을 지금 [PDF 받기]에도 적용 | ① 서버가 OpenAlex 정보로 찾은 OA 주소에 적용(arXiv는 지금대로 — 경계 8.3절. ~~서재에 사용자가 넣은 `pdf_url`은 지금대로~~ — D1로 뒤집힘: 사용자가 넣은 주소도 새 탭). 라이선스를 확인할 수 없는 주소(Crossref `link` 등)는 새 탭 ② 5단계 새 경로에만 | **①** 확정 — 같은 OpenAlex 데이터가 경로에 따라 다르게 처리되면 안 됨. 사용자 결정 U-3이 기존 OpenAlex [PDF 받기]에도 적용된다고 명시 |
| **K-13** | 공용 키 환경 변수 | 새 변수는 **`KCI_API_KEY` · `RISS_API_KEY` 두 개뿐**(서버 PC `cloud.env`, 없으면 그 소스만 꺼짐 — 서버 시작은 막지 않음) | **채택 · 예외 2 반영** — "변수 이름 고정" 원칙의 예외(1B K-5와 같은 처리). `UNPAYWALL_EMAIL`은 없음(U-4). 사용자별 키(`user_secrets`) 안은 U-1로 폐기 |
| **K-14** | 속도 · 시간 제한 · OpenCitations 토큰 | 14장 표, 토큰 없이 | **14장 그대로** — 토큰은 필수가 아님. 429가 잦으면 재검토. Unpaywall 줄은 삭제 |
| **K-15** | KCI · RISS "인하대에서 보기" | 7장 표(KCI는 DOI 있을 때만, RISS는 `url` https로 바꿔 `toInhaProxy`) | **7장 그대로** — `extlinks.js`를 고치지 않음, 1A 확인 결과(KCI 미등록 · riss 등록)와 맞음 |
| **K-16** | `papers`에 출처별 번호 열 | ① 만들지 않음 ② `kci_id` · `riss_id` · `pmid` 추가 | **①** — 중복 판별 · 원문 링크에 필요 없음. 나중에 KCI 인용 연결을 하면 그때 |
| **K-17** | 비밀 가리기 | `config.redact`에 `key=` · `email=` · `api_key=` 쿼리 값 패턴 추가 | **채택** — 키가 쿼리로 가는 소스가 늘어남(AC-572) |
| **K-18** | 픽스처 | 13장(관리자 수동 녹화 도구 · 키 전에는 공식 명세 · 샘플 기반 손 픽스처) | **13장 그대로** |
| **K-19** | KCI 검색 필드 | ① `title=<q>`만(공식상 필수) ② `title`과 `keyword` 두 번 불러 합침 | **①로 시작** — 실측(AC-5R3)에서 `keyword`만으로 되면 그때 바꿈. 화면 소스 설명에 "KCI는 제목으로 찾아요" |
| **K-20** | 3단계 AI로 찾기에 KCI 넣기 | ① 이번엔 안 함 ② 넣음 | **①** — 3단계 확정 범위 · 공용 키 한도 미확인. 실측 뒤 별도 검토 |
| **K-21** (**확정** — 팀장 2026-10-13) | 1B `external_works`에 OpenAlex 라이선스 열 `oa_license`(nullable) 추가 | ① 열 추가(1B 업서트가 함께 채움, 기존 행은 null → 처음 클릭 때 OpenAlex 1회) ② 열 없이 클릭 때마다 OpenAlex 조회 | 기획팀 추천 **①** — 1B 캐시에는 `pdf_url` · `is_oa`만 있고 라이선스가 없어(10.1절) 캐시만으로 U-3 판정이 안 됨. ②는 구조 변경이 없지만 같은 논문을 볼 때마다 OpenAlex 호출. 팀장이 K-1~K-20을 확정하며 다루지 않은 항목이라 별도로 올렸고 **확정**. 8.3절 경계 ① 확정(팀장) · ② 확정(사용자 결정 — U-3 예외) |
| **K-22** (신규 번호 — 확정) | 무료 PDF 주소 출처 정리 | ① Europe PMC `fullTextUrlList` 제외 ② Crossref `link` · Semantic Scholar `openAccessPdf`는 새 탭으로만(서버가 받지 않음) | **확정(팀장 2026-10-13)** — 라이선스를 확인할 수 없는 주소를 서버가 받지 않는다는 U-3 · U-4와 같은 원칙. 6.3 · 8.3절 |

### 16.3 확인 필요 (관리자 · 개발팀 — 결과를 이 문서에 적음)
1. **관리자(사용자 작업)**: KCI · RISS 키 신청 — 개인 신청 가능 여부, 필요 서류(공문), 심사 기간, 키 사용기간, 일일 한도, **소규모 연구 그룹 내부 도구에서 검색 결과 표시 · 개인 서재 저장이 이용 조건에 맞는지**(RISS BY-NC-ND · KCI 공공누리 적용 범위). 기획팀이 신청 문구 초안을 준비할 수 있음.
2. (삭제 — Unpaywall 약관 확인은 U-4로 필요 없음.)
3. **개발팀 첫 주**: **OpenAlex `best_oa_location` · `oa_locations`의 `license` 실제 값 목록과 필드 이름**(8.2절 허용 목록 확정), Europe PMC 한도 · `pageSize` 최대 · `page` 지원, OpenCitations v2 `cited` 값 모양, 1B 마이그레이션의 실제 검사 제약 이름(`citation_edges_source_check`).
4. **키 발급 뒤**: AC-5R3 전부.

**구현 완료 시점(2026-10-13)에 남은 확인 필요 목록** — 코드는 아래 값이 **추정**이라 자동 테스트는 손 픽스처로만 통과했고, 실제 응답으로 확인해야 함. 관리자가 `tools/record_extsources.py`를 키로 한 번 실행해 얻은 결과로 이 문서 4장 · 6장을 고침(실행 방법: `deploy/server-pc/README.md` 14절):
- (a) **OpenAlex `license` 실제 값 목록** — `record_extsources.py`가 끝에 값별 개수를 출력함(8.2절 허용 목록과 비교, 목록 밖 값은 팀장 보고). 키 없이 실행 가능.
- (b) **KCI 응답 칸 이름 — 추정**: `kci-registration`(등재 배지) · `citation-count`의 `kci` 속성(피인용) · 키 오류 응답의 모양(`KCI_KEY_ERRORS` 문구 일치). 코드(`norm_kci`)는 `kci-registration`(없으면 `journal-registration`)과 `citation-count`의 `kci` 속성(없으면 요소 글)을 읽고, 키 오류는 응답 글에 "등록되지 않은" · "사용기간" · "인증키"가 있는지로 판단 — 실제 응답에 맞춰 정리.
- (c) **RISS가 https를 지원하는지**(`RISS_URL`을 https로 둠 — http만 되면 키가 평문으로 가므로 팀장 보고, 14장).
- (d) **Europe PMC `core` / `lite` 필드**(`abstractText` 등이 `core`에서만 오는지, `pageSize` 최대).
- (e) **수동 확인 AC-585 · 586**(서재 상세 무료 PDF 세 상태, 인용 관계 탭 "OpenCitations 기준") — 사람이 화면으로.
- 위와 별개로 4장에 남은 "확인 필요"(KCI 호출 주소 · `displayCount` · `sortNm` 방향 · 호출 한도 · 이용 조건 등)는 그대로.

### 16.4 팀장 결정 — 디자인 10장 질문에 대한 답 (2026-10-13, 확정)
| # | 결정 | 반영 위치 |
|---|---|---|
| 1 | `add_paper`는 클라이언트가 보낸 `pdf_url`을 믿지 않고 8.3절 판정을 다시 함. 통과하지 못하면 PDF 없이 추가하고 `open_url` · `open_kind` · `reason`과 `warning`을 돌려줌 | 8.3 · 11장, AC-547 |
| 2 | S2 `openAccessPdf` · Crossref `link`는 **새 탭만** 엶(K-22 재확인) | 8.2 · 8.3, AC-548 |
| 3 | 새 탭 응답에 `open_kind`(`pdf` \| `landing`), `fetch-pdf` 성공 응답에 `license` | 8.1 · 8.2 · 11장, AC-544 |
| 4 | `related` 응답에 `warnings`(`oc_failed`) | 9.2 · 11장, AC-555 |
| 5 | 그래프 응답에 OpenCitations 출처(`refs_via`) | 9.3 · 11장, AC-553 |
| 6 | [Google Scholar]는 **새 소스 카드에만**(기존 소스 카드는 그대로) | 5장 흐름, 디자인 3.2 |
| 7 | 새 소스 카드의 피인용은 **글**로 표시(버튼 아님 — AD-6) | 5장 흐름, 디자인 3.2 |
| 8 | AD-2 = 네이티브 `disabled` + **늘 보이는 이유 줄** | 5장 흐름, 디자인 2.3 |
| 9 | 나머지 AD(AD-1 · 3 · 4 · 5 · 6 · 7 · 8 · 9)는 디자인 안대로 | `docs/design/phase5-korean-db-ui.md` 11장 |

### 16.5 구현 차이 8건 — 팀장 수용 (2026-10-13)
명세 초안과 구현이 달라진 곳. 코드(`paperlab/extsources.py` · `sources.py` · `server.py` · `graph_build.py`)를 읽어 확인함.
1. **판정 함수 위치**: `server_fetch_allowed` · `pick_oa_location` · `parse_oc_references`는 **`sources.py`**에 있음(순환 import 회피 — `extsources.py`가 `sources.py`를 가져다 씀. `extsources`는 다시 내보냄). 새 소스 검색 분기는 `Sources.search`가 아니라 **`server.py`의 `ext_search`**(`/api/search`가 `source`가 `kci` · `riss` · `europepmc`이고 DOI · arXiv · OpenAlex 번호 검색어가 아니면 `ext_search`로). 처음 안(18장 `Sources.search` 분기)을 이렇게 바꿈.
2. **arXiv 예외 확대**: OpenAlex 위치 중 `arxiv.org` PDF 위치에도 라이선스 없이 서버가 받는 예외(8.3절 경계 ②)를 적용(`pick_oa_location`). 처음 안은 서재 `pdf_url` · arXiv 번호 · 캐시 `pdf_url`만.
3. **서재 `pdf_url`이 캐시 행과 다르면** 캐시로 판정하지 않고 OpenAlex 위치 **전체를 다시 조회**(1B 캐시에는 `best_oa_location` 하나만 있어서 — 8.1절 캐시 한계). 후속(D1 · D5): 캐시 위치가 허용 라이선스가 아니거나 `oa_license`가 `''`이어도 같음.
4. **OpenAlex 위치가 없으면 Crossref `link`를 1회 조회**해 새 탭으로 엶(AC-548 — K-22를 코드로 이행. 처음 안은 "없으면 404").
5. **AC-543 예시**는 `10.1234/x?y#z`. 처음 구현은 5단계 새 경로만 엄격 형식 검사(`check_doi`)를 쓰고 기존 `lookup_doi`는 느슨한 검사를 유지했으나, **후속(2026-10-13)에서 `lookup_doi`도 등록자 4~9자리 엄격 검사로 통일**함(느슨한 검사 삭제 — 8.1절 · AC-543).
6. **OpenCitations 보강 때 서지를 찾은 OpenAlex 작품 행도 캐시에 씀**(10.2절 — 새 출처 · 새 열 없음. 10.1절 표의 "OpenCitations 참고문헌만" 문구를 이에 맞게 고침).
7. **자동 되돌림**(고른 정렬 · 필터가 소스에서 지원되지 않을 때 기본값으로 되돌림)은 이유 줄에 덧붙이고 **화면 읽기로도 알림**(디자인 2.3절 · 7.3절).
8. **`add_paper` 안내는 `warning` 필드**에 둠(기존 필드 — 당시에는 `dialogs.js`를 바꾸지 않았음. 이후 대신 받기 토스트 때문에 `dialogs.js`가 바뀜 — 18장). 새 탭 주소는 `open_url` · `open_kind` · `reason`으로 함께 줌.

### 16.6 품질 후속 수정 D1~D9 (2026-10-13 — 개발팀 완료, 승인자 검토 중)
품질 검증에서 나온 지적을 고친 것. 코드(`extsources.py` · `sources.py` · `server.py` · `graph_build.py` · `discover.js` · `graph.js` · `app.css` · `tools/record_extsources.py`)와 대조해 반영함.
| # | 내용 | 반영 위치 |
|---|---|---|
| D1 | **8.3절 경계 ① 엄격화(팀장 결정)** — `add_paper` · `fetch-pdf`가 서버로 받는 주소는 (a) arXiv (b) 그 DOI의 OpenAlex 위치 중 허용 라이선스 위치와 글자까지 같은 주소뿐. 그 밖(S2 · Crossref · 사용자가 넣은 주소 · 변형)은 모두 새 탭. "사용자가 넣은 주소는 지금대로 받음" 규칙 삭제. http/https 아닌 주소는 없는 것으로 침. 서재 주소가 허용 위치가 아니어도 같은 DOI의 다른 허용 위치를 대신 받지 않음(당시 **후속 검토 항목** → 같은 날 사용자 결정 U-7로 **대신 받기**로 바뀜). 사용자 영향: 직접 넣은 PDF 주소 논문도 새 탭 + 파일 직접 올리기(대신 받을 공개본이 없을 때) | 8.3 · 15 · AC-547 · 548 · 550 |
| D1+ | **대신 받기(사용자 결정 U-7)** — 규칙에 안 맞는 주소 → arXiv(번호 · OpenAlex 위치) → 허용 라이선스 위치 → 없으면 새 탭. `extsources.substitute` 신설 · `plan_pdf` 수정, 응답 `via: "substitute"` · `license`, 서재 `pdf_url` 갱신, `add_paper`도 본문 `arxiv_id`로 판정, 토스트 `sourcemeta.substituteText`(`library.js` · **`dialogs.js`**) | 8.3 · 11 · 15 · 18 · AC-550 · 550a~d |
| D2 | XML 거부 강화 — 바이트 정규식 + expat `StartDoctypeDeclHandler` · `EntityDeclHandler`, UTF-16도 502. `ET.XMLParser`(C 구현)에 `.parser`가 없어 expat 파서 + `TreeBuilder` | 6.5 · 14 · 15 · 16.2 K-2 · AC-505 |
| D3 | `/api/oa/lookup` 본문을 `small_json`(4KB)으로 — chunked도 상한 | 8.1 · AC-574 |
| D5 | 캐시 `oa_license`가 `''`이면 캐시로 판정하지 않고 OpenAlex 1회 → `oa_locations`에서 고름 | 8.1 · AC-545 |
| D6 | 서버 `oc_failed` 문구 "…참고문헌을 보강하지 못했어요." · `refs_via`는 `opencitations` \| `s2` · 화면은 `s2`일 때만 "Semantic Scholar 자료로 채웠어요" | 9.3 · 11 · AC-553 · 587, 디자인 5.2 |
| D7 | 560px 이하에서 `.discover-view` 전체 스크롤 · 결과 상자 고정 높이 풂 | AC-588, 디자인 7.4 |
| D8 | 검색 중 503 `source_unconfigured` → 옵션 "(키 등록 전)" 비활성 · OpenAlex로 되돌림 · 이유 줄 "KCI를 지금 쓸 수 없어 OpenAlex로 바꿨어요." | AC-589, 디자인 2.1 · 6장 |
| D9 | 녹화 도구: 이메일 모양은 `redacted@example.invalid`로 바꿔 저장, 키 문자열이 있으면 중단 | 13 · 서버 PC 안내서 14.3절 |
| 정리 | `lookup_doi`도 등록자 4~9자리 엄격 검사로 통일(AC-543 기록 정리). AC-556 테스트 추가. 이후 승인자 후속 L2(`lookup_doi` 엄격 검사 직접 테스트 — `tests/test_sources.py`) · L3(`refs_via` `s2` · 없음 Node 단언 — `tests/js/graph.test.mjs`) 테스트 추가, 사용자 결정 U-8로 엄격 검사 유지 확정 | 8.1 · 16.5절 5번 · AC-543 · 556 · 587 |

## 17. 확인 근거 (2026-10-13, 웹 문서 · 공개 응답)

- KCI Open API 목록(논문 기본 · 상세 · 참고문헌 · 인용지수): [kci.go.kr — OPEN API 목록](https://www.kci.go.kr/kciportal/po/openapi/openApiList.kci)
- KCI 논문 기본 정보 API(매개변수 · `title` 필수 · `displayCount` 최대 100 · XML · 응답 필드 · 사용기간 오류): [openDataView dtstSeqNo=1](https://www.kci.go.kr/kciportal/po/openapi/openDataView.kci?datasetBean.dtstSeqNo=1)
- KCI 논문 상세(`articleDetail` — 참고문헌 · 피인용 목록 없음): [dtstSeqNo=21](https://www.kci.go.kr/kciportal/po/openapi/openDataView.kci?datasetBean.dtstSeqNo=21), 참고문헌(`referenceSearch` — 제목 필수): [dtstSeqNo=2](https://www.kci.go.kr/kciportal/po/openapi/openDataView.kci?datasetBean.dtstSeqNo=2), 인용지수 상세(`citationDetail` — 학술지 단위): [dtstSeqNo=23](https://www.kci.go.kr/kciportal/po/openapi/openDataView.kci?datasetBean.dtstSeqNo=23)
- KCI 데이터 제공 서비스(Open API는 키 신청 · 발급 필요, 공공누리 제1유형 문구): [openDataPackGuide](https://www.kci.go.kr/kciportal/po/openapi/openDataPackGuide.kci?datasetBean.dtstTyCd=00)
- KCI 키 발급 절차 · 호출 주소 · `displayCount` 문제(**2차 자료**): [glama.ai — KCI MCP 서버 안내](https://glama.ai/mcp/servers/iapke486-arch/mcp-server)
- RISS 검색 API 소개(이용 대상 "비영리 기관(대학)"): [riss.kr — apiSearchIntro](https://www.riss.kr/apicenter/apiSearchIntro.do)
- RISS 국내학술논문 검색 API(`type=A` · 매개변수 · 응답 · 심사 후 승인 · BY-NC-ND · DOI 없음): [riss.kr — apiSearchDissKor](https://www.riss.kr/apicenter/apiSearchDissKor.do), 공식 샘플 응답: [apiSearchDissKor.xml](https://www.riss.kr/api/xml/apiSearchDissKor.xml), 학술지 API 페이지(API 목록 · 이용신청 링크): [apiSearchJournal](https://www.riss.kr/apicenter/apiSearchJournal.do)
- 공공데이터포털 KERIS API(학술지 검색 · 자동승인 — 국내학술논문 검색 아님): [data.go.kr 3046254](https://www.data.go.kr/data/3046254/openapi.do)
- Europe PMC REST(주소 · `format` · `resultType`): [dev.europepmc.org — RestfulWebService](https://dev.europepmc.org/RestfulWebService), 검색 필드 목록: [rest/fields](https://www.ebi.ac.uk/europepmc/webservices/rest/fields), 키 없이 1회 실측: `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:10.1038/nature12373&format=json&resultType=lite`(2026-10-13), EMBL-EBI 이용 약관(과도한 사용 차단 · 데이터 추가 제한 없음 · 제3자 권리): [ebi.ac.uk — Terms of Use](https://www.ebi.ac.uk/about/terms-of-use), 키 불필요(2차 자료): [rOpenSci europepmc](https://github.com/ropensci/europepmc)
- OpenCitations Index API v2(연산 · 응답 필드 · IP당 분당 180회 · 토큰 권장): [api.opencitations.net/index/v2](https://api.opencitations.net/index/v2), Meta API: [api.opencitations.net/meta/v1](https://api.opencitations.net/meta/v1), 토큰(필수 아님 · 이메일로 발급 · 데이터 CC0): [OpenCitations Access Token](https://opencitations.net/accesstoken/), 인덱스 통합(2023-10, 2차 자료): [Wikipedia — OpenCitations](https://en.wikipedia.org/wiki/OpenCitations)
- (Unpaywall 출처는 U-4로 삭제 — Unpaywall을 쓰지 않음.)
- Unpaywall · OpenAlex 코드 통합("항상 같은 값" — 무료 PDF 정보를 OpenAlex 것만 써도 되는 근거): [OpenAlex 블로그 — We're Rebuilding OpenAlex](https://blog.openalex.org/were-rebuilding-openalex-while-its-running-heres-whats-changing), [We're now OpenAlex](https://blog.openalex.org/category/unpaywall)
- OpenAlex `best_oa_location` · 1B 캐시 열(`pdf_url` · `is_oa`): 로컬 코드 `paperlab/sources.py` `norm_openalex` · `supabase/migrations/20261008000002_citation_cache.sql`. `license` 필드 · 값 목록은 **공식 문서로 확인하지 못함 — 개발팀 첫 주 녹화**.
- 저작권법 제30조 해설 · 판례 요약(법률 자문 아님 — 현행 조문은 국가법령정보센터에서 확인 필요): [nepla — 사적이용을 위한 복제](https://www.nepla.ai/wiki/지식재산/저작권/저작물의-공정이용/사적이용을-위한-복제-rv5n714qnzm4), [대법원 2011도5835](https://www.nepla.ai/case/대법원/2011도5835), [로톡 — 북스캔 사례](https://www.lawtalk.co.kr/posts/85796)
- 1st My paper 참고(로컬, 고치지 않음): `work/backend/external/kci.py`(KCI 키 · XML · 실측 국문 참고문헌 36%) · `riss.py`(키 없이 `Error 004`, 원문 자동 받기 안 함) · `europepmc.py` · `opencitations.py`(3초 이상 느림)

## 18. 작업 목록 (파일 단위 — 디자인 · 개발이 같은 파일을 동시에 고치지 않음)

### 디자인팀 (먼저)
- `docs/design/phase5-korean-db-ui.md`(신규): 소스 목록 3개 · 소스 설명 · 비활성 이유 문구, 미지원 정렬 · 필터 표시, 결과 카드 배지(KCI등재 · 무료 원문 · KCI 피인용) · 출처 한 줄, [무료 PDF 찾기] · [PDF 포함 추가] · [무료 PDF 열기 ↗] · 안내 문구, 처음 KCI · RISS 안내, Europe PMC [이전]/[다음], 인용 관계 탭 "OpenCitations 기준" 줄, 오류 code별 문구(6.5절), CSS 클래스.
- `paperlab/static/css/app.css`.

### 개발팀
| 파일 | 할 일 |
|---|---|
| `supabase/migrations/20261014000001_external_sources.sql`(신규, 이름 가정) | 10.2절 |
| `paperlab/extsources.py`(신규) | **구현됨**: `ExtSources`(공용 키 · 속도 제한 · 14장 상수 · `search` · `status`), 순수 파서 `norm_kci` · `parse_kci` · `norm_riss` · `parse_riss` · `norm_epmc` · `parse_epmc`, DOCTYPE · ENTITY 거부(`parse_xml` — 바이트 정규식 + expat 처리기, D2), 옵션 검사, 무료 PDF 판정 순서 `plan_pdf`(D1 엄격화 + 대신 받기) · `substitute`(대신 받기 — arXiv → 허용 라이선스 위치, openlink 제외) · `cache_locations`(`oa_license` null · `''`이면 None — D5) · `match_location`(8.3절). `server_fetch_allowed` · `pick_oa_location` · `parse_oc_references`는 **`sources.py`에 있고**(순환 import 회피 — 16.5절 1번) 여기서 다시 내보냄. Unpaywall 파서 없음 |
| `paperlab/sources.py` | **구현됨**: 공통 엄격 호출 `strict_get`(1B `_send` 규칙 꺼냄) · `RateLimiter`, `server_fetch_allowed` · `pick_oa_location` · `oa_locations_of` · `parse_oc_references` · `check_doi` · `doi_path`, `Sources.oa_locations` · `crossref_pdf_link`, `download_pdf` openlink 호스트 거부, `norm_openalex`가 `license`를 읽고 카드 `pdf_url`/`oa_open_url`을 U-3 규칙으로 채움, `lookup_doi`도 엄격 DOI 검사(`check_doi` — 느슨한 검사 삭제, 16.5절 5번). 검색 분기(새 소스)는 여기가 아니라 `server.py` `ext_search` |
| `paperlab/citecache.py` | 1B 작품 행 업서트가 `oa_license`를 함께 씀 · DOI로 작품 행 읽기(K-21), OpenCitations 참고문헌 쓰기(`system_tx("citation cache write")` — OpenAlex 행 있으면 안 씀). 무료 PDF용 새 쓰기 · TTL 없음 |
| `paperlab/graph_build.py` | 씨앗 보강(`_s2_augment`): OpenCitations 먼저 → S2(9.3절), 경고 `oc_failed`(문구 "…참고문헌을 보강하지 못했어요." — D6), 그래프 응답 `refs_via`(`opencitations` \| `s2`) |
| `paperlab/server.py` | 11장 경로: `ext_search`(소스 검사 · 503 · 400 · 사용자당 동시 2), `/api/sources` · `/api/oa/lookup`(본문 `small_json` — D3), `fetch_pdf` 새 순서(8.3절 — `open_url` · `open_kind` · `license`, 경계 ① 엄격화 D1, 대신 받기 `via` · 서재 `pdf_url` 갱신), `add_paper` 판정 다시 하기(`warning` · 대신 받으면 `via` · `license` · `pdf_url` 갱신 · 본문 `arxiv_id`로 판정), `related`의 OpenCitations 보강(`oc_references` — `via` · `unresolved` · `warnings`) |
| `paperlab/config.py` | 새 환경 변수 **`KCI_API_KEY` · `RISS_API_KEY` 두 개만** 읽기(K-13 — 없으면 그 소스만 꺼짐), `redact` 패턴(K-17). `SECRET_KEYS` 변경 없음(U-1 공용 키) |
| `paperlab/static/js/discover.js` | 소스 목록 · 비활성 · 정렬/필터 매핑 · 카드 배지 · 출처 줄 · [무료 PDF 찾기] 흐름 · EPMC 커서 · 검색 중 503 `source_unconfigured` 때 옵션 비활성 · OpenAlex로 되돌림(D8) |
| `paperlab/static/js/graph.js` · `graphmath.js` | `oc_failed` 문구를 `refs_via`로 고름(`s2`일 때만 "채웠어요" — D6) |
| `paperlab/static/css/app.css` | 560px 이하 `.discover-view` 전체 스크롤(D7) |
| `paperlab/static/js/library.js` | [PDF 받기]의 `open_url` 처리 · 안내, 인용 관계 탭 `via` · `unresolved` 표시, 응답 `via === "substitute"`면 토스트 `substituteText(license)`(대신 받기) |
| `paperlab/static/js/sourcemeta.js` | `substituteText(license)` 신설(대신 받기 토스트 — `licenseLabel`로 괄호 붙임 · 뺌) |
| `paperlab/static/js/dialogs.js` | **[PDF 포함 추가] 토스트만 변경**(대신 받기): 응답 `via === "substitute"`면 "서재에 추가하고 " + `substituteText(license)`, 아니면 `warning` 또는 "서재에 추가했어요" 그대로. (처음 안은 "변경 없음 — U-1 공용 키라 설정 창 키 칸이 없음"이었음. 키 칸이 없다는 점은 그대로, 설정 창은 바뀌지 않음) |
| `tools/record_extsources.py`(신규) | 13장 녹화 도구(관리자 수동). OpenAlex 무료 PDF 응답 녹화 포함, RISS는 키가 있을 때만. 이메일 모양은 `redacted@example.invalid`로 바꿔 저장, 키 문자열이면 중단(D9) |
| `tests/test_extsources.py` · `tests/test_extsources_api.py` · `tests/fixtures/extsources/`(신규) · `tests/test_rls.py` · `tests/js/sources.test.mjs`(신규) · `tests/test_js_node.py` | 12 · 13장. 대신 받기: `test_extsources.py::test_plan_pdf_substitute` · `test_plan_pdf_order`, `test_extsources_api.py`의 `fetch-pdf` · `add_paper` 대신 받기 단언, `sources.test.mjs` "대신 받기 토스트"(AC-550a~550c) |
| `tests/test_sources.py` · `tests/js/graph.test.mjs` | **추가됨**: `test_lookup_doi_strict_doi_check`(AC-543, 승인자 L2) · `refs_via` `s2` / `opencitations` / 없음 단언(AC-587, 승인자 L3) |

### 품질팀
- 12장 `[자동]` · `[db]` 전부(건너뛰기 0), `[수동]` AC-583~586 · 550d · 588 · 589, 키 발급 뒤 `[실환경]` AC-5R1~5R3, 사용자 M5-1~3 안내.
- 후속 수정 확인(16.6절): AC-550(D1) · AC-505(D2) · AC-574(D3) · AC-545(D5) · AC-587~589(D6 · D7 · D8) · AC-556(테스트 추가됨). 대신 받기: AC-550a · 550b · 550c · 550d(16.1절 U-7). 앞서 빈 곳이던 `lookup_doi` 엄격 검사 직접 단언(AC-543 — L2)과 `refs_via` `s2` · 없음 Node 단언(AC-587 — L3)은 테스트가 추가돼 확인만 하면 됨.

### 기획팀 (결정 뒤 · 구현 뒤)
- **결정 반영 완료(2026-10-13)**: 이 문서 U · K 결정, PLAN.md 5단계 절(범위 · 완료 기준 · 미정) · 10장 P9 해결 · 3장 ⑤ 행의 Unpaywall 삭제.
- **구현 반영 완료(2026-10-13)**: 이 문서(16.4 · 16.5절 · 상태 줄), 1B 명세(`oc_failed` 경고 · 씨앗 보강 순서 · 출처 줄 · `source` 값 · 8.7절 마이그레이션 안내), 서버 PC 안내서(`cloud.env` 새 변수 · 키 신청 · 녹화 도구 · 반영 순서), `FEATURES.md` 5단계 기능.
- **후속 수정 반영 완료(2026-10-13)**: 16.6절 D1~D9(이 문서 · 디자인 `phase5-korean-db-ui.md` 해당 부분 · `FEATURES.md` · 1B 명세 D6 부분 · 서버 PC 안내서 14.3절).
- **남음**: 키 발급 뒤 16.3절 실측 반영(4 · 6장), 수동 확인 AC-585 · 586 결과, PLAN.md 5단계 "완료" 표시(품질 통과 · 사용자 승인 뒤), 키 신청 문구 초안(관리자 요청 시).

## 19. 변경 기록
- 2026-10-13 초안(기획팀). 외부 서비스 사실은 17장 출처로 확인, 확인하지 못한 것은 "확인 필요"로 표시.
- 2026-10-13 결정 반영(기획팀) — 상태 "결정 반영 — 구현 대기".
  - 사용자 U-1 공용 키 · U-2 RISS 키 없으면 1A 바로가기(코드 경로 유지 · 비활성 · 손 픽스처) · U-3 라이선스 확인된 것만 서버가 받음(기존 [PDF 받기]에도) · U-4 **Unpaywall 사용 안 함** · U-5 DOI로 다시 찾는 것만 공용 캐시.
  - 팀장 K-1~K-20 추천안 확정. K-9 삭제 · K-10 OpenAlex 기준 재작성 · K-11 · K-12 · K-13(`KCI_API_KEY` · `RISS_API_KEY` 두 개뿐) · K-14 수정. 신규 K-21(`oa_license` 열)은 팀장 확인 대기.
  - 고친 곳: 1 · 2 · 3 · 4.5 · 4.6 · 5 · 6.2 · 6.3 · 6.5 · 8(전면) · 10.1 · 10.2(마이그레이션에서 Unpaywall 행 · 열 · 제약 삭제, `oa_license` 추가) · 11 · 12(AC-504 · 513 · 524 신설 · 533 · 54x 전면 · 561~564 · 571 · 572 · 585 · 5R1~5R3) · 13 · 14 · 15 · 16 · 17 · 18.
  - Europe PMC `fullTextUrlList` 기반 무료 PDF 주소는 U-4(무료 PDF 정보는 OpenAlex 것만)에 따라 뺌.
- 2026-10-13 확정 반영(기획팀, 팀장 · 사용자 결정) — 16장 "확정".
  - **K-21 확정**: `external_works`에 nullable `oa_license` 열 추가(10.2절).
  - **8.3절 경계 ① 확정(팀장)**: DOI가 있고 주소가 OpenAlex 위치와 같으면 그 라이선스로 판정, 아니면 사용자가 직접 넣은 주소로 보고 지금대로 받음.
  - **8.3절 경계 ② 확정(사용자 결정)**: arXiv는 지금처럼 서버가 받음 — **U-3의 예외**, 근거 "arXiv는 누구나 받도록 공개한 저장소". 법률 자문이 아님을 8.3 · 15장에 적음. 16.1절에 "U-3 예외" 행 추가.
  - **K-22 확정(팀장)**: Europe PMC `fullTextUrlList` 제외, Crossref `link` · S2 `openAccessPdf`는 새 탭으로만.
  - 고친 곳: 상태 줄 · 8.3 · 10.2 · 15 · 16.1 · 16.2 · 18. 1A 명세(`inha-proxy.md` 18행) · 1B 명세(`citation-graph.md` 49행)의 Unpaywall 문구를 "Unpaywall은 쓰지 않음(5단계 사용자 결정 U-4)"으로 고치고 18장 "기획팀 남음"에서 해당 항목 삭제.
- 2026-10-13 구현 반영(기획팀, 팀장 결정 9건 · 구현 차이 8건 수용) — 상태 **"구현 완료(검증 중)"**. 실제 코드(`paperlab/extsources.py` · `sources.py` · `server.py` · `graph_build.py` · `tools/record_extsources.py`)를 읽어 맞는지 확인하고 반영. 코드는 건드리지 않음.
  - **16.4절 신설(팀장 결정 9건)**: ① `add_paper`가 `pdf_url`을 다시 판정(통과 못하면 PDF 없이 추가 + `open_url` · `open_kind` · `reason` · `warning`) ② S2 `openAccessPdf` · Crossref `link`는 새 탭만(K-22) ③ 새 탭 응답에 `open_kind`, `fetch-pdf` 성공 응답에 `license` ④ `related` 응답에 `warnings`(`oc_failed`) ⑤ 그래프 응답에 `refs_via` ⑥ [Google Scholar]는 새 소스 카드에만 ⑦ 새 소스 카드의 피인용은 글 ⑧ AD-2는 네이티브 `disabled` + 늘 보이는 이유 줄 ⑨ 나머지 AD는 디자인 안대로.
  - **16.5절 신설(구현 차이 8건 수용)**: ① 판정 함수는 `sources.py`, 새 소스 분기는 `server.py` `ext_search` ② OpenAlex 위치 중 `arxiv.org` PDF에도 arXiv 예외 ③ 서재 `pdf_url`이 캐시 행과 다르면 OpenAlex 위치 전체 재조회 ④ OpenAlex 위치가 없으면 Crossref `link` 1회 조회 → 새 탭(AC-548) ⑤ AC-543 예시 `10.1234/x?y#z` · `lookup_doi`는 느슨한 검사 ⑥ OpenCitations 보강 때 찾은 OpenAlex 작품 행도 캐시에 씀 ⑦ 자동 되돌림은 이유 줄에 덧붙이고 화면 읽기로도 알림 ⑧ `add_paper` 안내는 `warning` 필드.
  - **16.3절**: "확인 필요(키 받은 뒤)" 목록 정리 — OpenAlex `license` 실제 값 · KCI 응답 칸 이름(`kci-registration` · `citation-count`의 `kci` 속성 · 키 오류 모양 — 추정) · RISS https 지원 · Europe PMC `core`/`lite` 필드 · 수동 확인 AC-585 · 586.
  - 고친 곳: 상태 줄 · 2장(공용 캐시 행) · 5장 흐름 · 8.1 · 8.2 · 8.3(`plan_pdf` 순서 · `add_paper` 재판정) · 9.2 · 9.3(`warnings` · `refs_via`) · 10.1 · 10.2 · 11장 API 표 · 12장(AC-543 · 544 · 547 · 548 · 553 · 554 · 5R3 고침, **AC-555 · 556 신설**, AC-585 · 586 "아직 안 함" 표시) · 16.3 · 16.4 · 16.5 · 18장(개발팀 행 · 기획팀 남은 일). 1B 명세 `citation-graph.md` · 서버 PC 안내서 `deploy/server-pc/README.md`(14절 신설) · `FEATURES.md`도 같은 날 고침.
- 2026-10-13 품질 후속 수정 반영(기획팀, 개발팀 D1~D9 완료) — 상태 **"구현 완료(승인 대기)"**. 코드를 읽어 대조한 뒤 문서만 고침(코드 · 커밋 없음).
  - **D1(팀장) 8.3절 경계 ① 엄격화**: 서버가 받는 주소는 arXiv · 그 DOI의 허용 라이선스 OpenAlex 위치와 글자까지 같은 주소뿐, 그 밖은 모두 새 탭("사용자가 넣은 주소는 지금대로 받음" 삭제 — 16.2절 K-12 · 15장 · 8.3절의 앞선 확정 문구를 고침). 서재 주소가 허용 위치가 아니어도 다른 허용 위치를 대신 받지 않음 = **후속 검토 항목**. 사용자 영향 명시.
  - D2 XML 거부(expat 처리기 · UTF-16) · D3 `/api/oa/lookup` `small_json` · D5 `oa_license ''` 캐시 판정 제외 · D6 `oc_failed` 문구 · `refs_via` `opencitations | s2` · D7 560px 이하 스크롤 · D8 `source_unconfigured` 때 옵션 비활성 · D9 녹화 도구 이메일 가리기(서버 PC 안내서 14.3절 "멈추면 팀장에게 알림" 문구도 맞춤).
  - **정리**: `lookup_doi` 엄격 검사 통일(등록자 4~9자리) — AC-543 · 8.1 · 16.5절 5번 · 18장 기록 정리. AC-556 테스트 추가 표시.
  - 새 AC: AC-550(D1) · AC-587 · 588 · 589(D6 · D7 · D8). 고친 AC: 505 · 543 · 545 · 547 · 548 · 553 · 556 · 574. 16.6절 신설.
  - 고친 곳: 상태 줄 · 6.5 · 8.1 · 8.2 · 8.3 · 9.3 · 11장 · 12장 · 13 · 14 · 15 · 16.2 · 16.5 · 16.6(신설) · 18 · 19. 디자인 `phase5-korean-db-ui.md` 2.1 · 5.2 · 6 · 7.4, 1B 명세 `citation-graph.md`(D6), `FEATURES.md`도 같은 날 고침.
- 2026-10-13 사용자 결정 3건 · 대신 받기 반영(기획팀, 개발팀 구현 대조) — 코드(`paperlab/extsources.py` `substitute` · `plan_pdf`, `server.py` `fetch_pdf` · `add_paper`, `static/js/sourcemeta.js` · `dialogs.js` · `library.js`, 테스트 4개)를 읽어 맞는지 확인한 뒤 문서만 고침(코드 · 커밋 없음).
  - **16.1절**: U-6(직접 넣은 PDF 주소도 새 탭 — D1 유지) · U-7(대신 받기) · U-8(`lookup_doi` 엄격 검사 유지).
  - **8.3절 경계 ①**: "다른 허용 위치를 대신 받지 않음 — 후속 검토 항목"을 **대신 받기 규칙**으로 교체(주소가 허용 위치와 같으면 그 주소 → arXiv(번호 → OpenAlex의 arXiv 위치) → 허용 라이선스 위치 → 없으면 원래 주소 새 탭, openlink 위치 제외, `via: "substitute"` · 실제 받은 `license`, 서재 `pdf_url` 갱신, `add_paper`는 본문 `arxiv_id`로 판정, 토스트 `substituteText`). 8.3절 1번 · `add_paper` 항목 · "그 밖" 항목 · 11장 API 표 · 5장 흐름도 맞춤.
  - **AC**: 550 고침(그대로 받는 주소 vs 대신 받기), **550a · 550b · 550c · 550d 신설**(550a `fetch-pdf` · 550b `add_paper` · 550c Node 토스트 · 550d 수동), 547 · 548 단서 추가, 543 · 587에서 "직접 단언 없음 · 추가 필요" 문구를 테스트 추가됨(L2 · L3)으로 바꿈.
  - **15장**: 사용자 영향 문구 고침 + 위험 행 "대신 받기로 서재 `pdf_url`이 바뀜" 신설(알림으로 드러냄 · 복구 안 함). **16.6절** D1 행 고침 · D1+ 행 · 정리 행(L2 · L3). **16.5절 8번**.
  - **18장**: `dialogs.js` "변경 없음" → **[PDF 포함 추가] 토스트 변경**(`sourcemeta.js` · `library.js` 행 추가), `extsources.py` · `server.py` · 테스트 행, 품질팀 확인 항목. 디자인 `phase5-korean-db-ui.md` 4.1 · `FEATURES.md` 무료 PDF 규칙도 같은 날 고침.
- 2026-10-13 승인자 조건부 승인 뒤 팀장 수정: `add_paper`에서 `plan_pdf`가 None이면 "무료 PDF를 찾지 못했어요" 경고(TypeError 문구 대신, 테스트 추가) / `lookup_dois`가 앞 200편(S2_MAX_DOIS)만 돌려줘 그래프 total · 인용 관계 탭 `unresolved`가 조회 범위를 넘지 않음(L1). 후속(낮음): `lookup_doi` 엄격 검사 직접 테스트(L2), graph Node 테스트 `refs_via` s2 · 없음(L3), 운영 `citation_edges_source_check` 이름 확인(L5).
- 2026-10-13 승인자 조건부 승인(대신 받기) 반영(팀장): C-1 AC-550d · 15장 위험 행 — 상세 패널에 PDF 주소가 보이지 않으므로 "토스트로만 알림"으로 정정, 버튼 이름 [무료 PDF 찾기] / L-1 `plan_pdf`가 arXiv 번호를 `ARXIV_ID_RE`로 검사(형식 밖이면 번호 없음으로 — 엉뚱한 PDF 방지, 테스트 추가). 후속(낮음): L-2 경로별 후보 순서 차이(대신 받기는 arXiv 우선, pdf_url 없을 때는 허용 라이선스 우선) — 명세대로 유지.
