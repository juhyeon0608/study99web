# 인용 그래프 (Connected Papers 방식) — 기능 명세 (1B단계)

- 단계: **1B** ([PLAN.md](../../PLAN.md) 6장 "1B단계", 3장 ⑥) — 진행 순서 0 → 1 → 1A → **1B** → 2 → …
- 작성: 기획팀 · 2026-10-07 (저장소 `study99web`, 브랜치 `claude/paper-program-hrrhl2`, 기준 커밋 `2b8dd95`)
- 근거: 사용자 결정 2026-10-07 — ⑥ 인용 그래프를 5단계에서 **1B로 앞당김**, **공개 서지 · 인용 관계는 사용자끼리 같이 쓰는 공용 캐시(`external_works` · `citation_edges`)로 둠, 누가 무엇을 조회했는지는 남기지 않음, 개인 데이터는 공유하지 않음**(PLAN 2장).
- 참고: 1단계 명세 [phase1-cloud.md](phase1-cloud.md)(RLS · 스키마 · 사용자 권한 트랜잭션 · 로그 규칙), 1A 명세 [inha-proxy.md](inha-proxy.md)(인하대에서 보기 · Scholar 버튼), 지금 코드 `paperlab/sources.py`(`related` · `_openalex_id_for`) · `paperlab/server.py`(`/api/papers/{id}/related` · `/api/related` · `mark_library`), 이전 프로젝트 1st My paper `work/backend/graph/`(builder · coupling · similarity) · `work/config/external.json` `graph` 절 · `work/frontend/js/features/graph.js`(참고만 — 고치지 않음).
- 개정 2026-10-07: **사용자 결정 U-1 = ① 그래프를 계정에 기록하지 않음**, **팀장 결정 K-1~K-16 = 모두 기획팀 추천안으로 확정**(K-1 = d3-force + 의존 패키지 UMD를 그래프 화면에서만 불러 배치 계산, SVG 그리기는 직접). 본문의 "기획팀 추천(K-…)"은 이제 **팀장 결정**으로 읽습니다. 결정 기록은 14.4절
- 개정 2026-10-07 (구현 반영 — 개발팀이 명세와 다르게 처리한 15개 항목, **팀장 승인**): ① D 단계 저장 · 계산 방식(8.3절) ② OpenAlex가 돌려주지 않는 번호는 제목 빈 행으로 30일(8.2절) ③ 이전 · 이후 연구에서 씨앗 제외(6.7절) ④ 제목 합치기는 정규화 제목 12자 이상(6.2절) ⑤ 예비 점수 0은 D 대상 제외 · 씨앗 `score` = null(6.5 · 9.3절) ⑥ E 단계에서 세 크기 모두 미리 받기(최대 2회, 7.3절) ⑦ 마이그레이션 `20261008000002_citation_cache.sql`(8.7절) ⑧ AC-G20 ③ 열 이름 규칙 ⑨ S2 404는 경고 없음 · 재시도는 연결 오류 · 429 · 5xx만 1회(7.5절) ⑩ OpenAlex 키는 `api_key` 쿼리(7.4절) ⑪ K-6 확대 — 사용자 이메일은 Crossref에만(7.4절) ⑫ 서재 씨앗의 형식이 틀린 칸은 버림(6.1 · 9.5절) ⑬ 시작되지 않은 대기 자리는 30초 뒤 비움(9.4절) ⑭ JS 래퍼 `tests/test_graph_js.py` 따로(12장) ⑮ `truncated`는 참고문헌 300편 초과 때(6.2 · 9.3절). 새 모듈 `paperlab/graph_build.py`(15장)
- 개정 2026-10-07 (품질팀 문서 정합 — 팀장 요청): ⑫ 서재 씨앗의 칸이 모두 틀리면 400 `bad_seed`로 통일(6.1절), 합쳐진(merged) 씨앗 번호 처리(6.1절 6번 · 9.5절 · AC-G35a), S2 경로 = 퍼센트 인코딩 + `.`/`..` 조각 거부(9.5절 · AC-G35), 그래프 로그에 `result`(9.6절), 같은 씨앗 합치기 때 첫 요청자의 OpenAlex 키 사용(M-2 수용 — 9.4절), 수용 위험 M-9 · M-10(13장), 화면 메모리는 로그아웃 때 비움(M-5 — 8.1 · 8.6절)
- 개정 2026-10-08 (1C 구현 반영 — 팀장 결정 Q-1): 공용 캐시 관계에 **`cited_by_top_c`**(C 단계 피인용 상위 목록 — 1C 추천이 쓰고, 사용자 결정 I-1에 따라 그래프도 씀) 추가. 7.6절 TTL 30일 · 8.3절 관계 표 · 상한 100 · 그래프의 재사용 규칙 · 8.4절 SQL · 8.7절 마이그레이션 `20261008000003_citation_edges_top_c.sql`. 결정 기록 14.4절
- 표기: **확정** = 사용자 결정, **팀장 원칙** = 팀장이 이미 정한 원칙(PLAN · 1단계 명세), **기획팀 추천** = 팀장 결정 전 안(14.2절 `K-…` — 2026-10-07 모두 확정), **가정** = 기획팀 임시값(구현 · 실측으로 조정), **미정(사용자)** = 14.1절 `U-…`, **확인 필요** = 외부 서비스 사실을 공식 문서로 다 확인하지 못함(개발팀이 첫 작업 때 실측하고 이 문서를 고침).

---

## 1. 목적

씨앗 논문 한 편에서 출발해 **주제가 가까운 논문 수십 편을 한 장의 그림**으로 보여 줍니다. 선은 "누가 누구를 인용했나"가 아니라 **얼마나 비슷한가**(같은 문헌을 함께 인용 · 같은 논문에게 함께 인용됨)를 뜻하고, 비슷한 논문끼리 가까이 모입니다(Connected Papers 방식). 노드를 눌러 정보를 보고 **서재에 담고 · 인용하고 · 인하대에서 보고 · Google Scholar에서 찾습니다.** 그래프 논문들이 공통으로 기대는 **이전 연구**(prior works)와, 그래프 논문들을 많이 인용하는 **이후 연구**(derivative works) 목록도 줍니다.

가져온 공개 서지 · 인용 관계는 **공용 캐시**에 저장해, 같은 씨앗(또는 겹치는 주변 논문)을 다른 사용자가 열 때 외부 API를 다시 부르지 않습니다.

## 2. 확정된 결정과 원칙

| 항목 | 내용 | 구분 |
|---|---|---|
| 단계 | ⑥ 인용 그래프를 1B로 앞당김(1A 다음, 2단계 전) | 확정 |
| 공용 캐시 | 공개 서지(제목 · 저자 · DOI · 연도 · 피인용 수 등)와 인용 관계만 공용. `user_id` 없음 | 확정 |
| 조회 기록 없음 | **누가 무엇을 조회했는지 남기지 않음** — 공용 표 · 로그 · 시스템 작업 이유 문자열 어디에도 "사용자 ↔ 씨앗/논문" 연결을 남기지 않음(8.6절 점검표) | 확정 |
| 개인 데이터 비공유 | 서재 · PDF · 메모 · 하이라이트는 그대로 각자. 그래프의 "서재에 있음" 표시는 **요청한 사용자 권한(RLS)** 으로만 계산 | 확정 |
| 사용자 이메일 | 외부 학술 API 호출에 **사용자 이메일을 보내지 않음**(`mailto` · User-Agent 모두). OpenAlex는 2026년 2월 polite pool을 없앴고 `mailto`를 무시함(공식 Deprecations — 16장) | 팀장 지시 |
| 서버 경유 권한 | 사용자 데이터는 `user_tx`(RLS), 공용 캐시 **쓰기는 `system_tx`(service_role)만**, 이유 문자열 필수(1단계 5.2절) | 팀장 원칙 |
| 외부 요청 대상 | 서버는 **고정된 주소**(`api.openalex.org`, `api.semanticscholar.org`)에만 요청. 사용자가 준 URL로 요청하지 않음 | 팀장 원칙(SSRF — 1단계 F3) |
| 외부 호출 중 DB 연결 | 외부 호출 전에 트랜잭션을 끝내고 연결을 돌려줌(1단계 F9) | 팀장 원칙 |
| 화면 | 빌드 없는 ES 모듈. 외부 라이브러리는 `static/vendor/`에 넣고 `THIRD_PARTY.md`에 기록 | 팀장 원칙 |

## 3. 범위

### 하는 것
1. **씨앗 고르기**: 서재 논문(상세 패널) 또는 논문 찾기 결과 카드에서 [인용 그래프] → 그래프 화면(5장).
2. **그래프 만들기(서버)**: OpenAlex에서 씨앗의 참고문헌 · 피인용 · 관련 논문 · 함께 인용된 논문을 모으고(6.2절), 서지 결합 + 공동 인용 유사도(6.4절)로 노드를 골라(6.5절) 선을 만듦(6.6절). 이전 · 이후 연구 목록(6.7절). 국문 등 인용 정보가 적은 논문은 OpenAlex "관련 논문"으로 보조(6.8절, 점선으로 구분).
3. **진행 표시**: 요청 안 스트리밍(SSE) 진행 이벤트(9.2절 — K-2).
4. **공용 캐시**: `external_works`(서지) · `citation_edges`(관계 목록) 새 표, RLS(읽기 = 로그인 사용자, 쓰기 = 서버 `system_tx`만), 유효 기간(TTL), 크기 점검 · 정리 명령(8장).
5. **그래프 화면**: 힘 기반 배치(클라이언트), 노드 크기 = 피인용 수, 색 = 연도, 선 굵기 = 유사도, 확대 · 이동, 노드 패널(정보 · 서재 추가 · 인용 · 인하대에서 보기 · Google Scholar · 이 논문으로 새 그래프), 이전 · 이후 연구 탭, 목록 보기(접근성), 크기 선택(20 · 40 · 80편)(10장).
6. **Semantic Scholar 보강(조건부)**: 씨앗이 OpenAlex에서 참고문헌이 0편이고 DOI가 있을 때만 S2 참고문헌 1회(7.3절 — K-7).
7. **자동 테스트**: 가짜 OpenAlex · S2 응답으로 알고리즘 · API · 캐시 재사용 · RLS · 로그 검사(11 · 12장).

### 안 하는 것 (범위 밖)
- **그래프 저장 · 기록**: 내가 만든 그래프 목록을 서버에 남기지 않음(**확정 — 사용자 결정 U-1 ①**). 매번 다시 계산(캐시 덕분에 빠름).
- 인용 방향 그래프 모드(1st My paper `mode=citation`), 2단계 이상 깊이 확장, 여러 씨앗 합친 그래프, 그래프 내보내기(이미지 · 파일), 노드 끌어 옮기기, 그래프 공유.
- **OpenCitations · KCI · RISS · Unpaywall** — 5단계(그때 같은 공용 캐시 표를 늘려 씀 — 8.7절). (기획팀 추천 K-14)
- 기존 상세 패널 "인용 관계" 탭 · 찾기 화면의 피인용/참고문헌/관련 목록(`/api/papers/{id}/related` · `/api/related`)은 **그대로**(캐시를 쓰도록 바꾸지 않음 — 나중에 합칠 수 있음).
- 임베딩(의미) 유사도 — 3단계 임베딩 모델 뒤에 재검토.
- 캐시를 사용자에게 목록으로 보여 주는 화면 · API(조회 기록이 드러날 수 있어 만들지 않음).
- "최신 정보로 다시 만들기"(TTL 무시) 버튼 — 유효 기간이 지나면 자동으로 다시 받음.

### 뒤 단계 연결
| 뒤 단계 | 1B에서 해 두는 것 |
|---|---|
| 2 작업 큐 | 그래프는 AI 작업이 아니라 큐에 넣지 않음. 서버 프로세스 안에서 SSE로 끝냄 |
| 3 AI로 찾기 | 검색 결과 서지를 `external_works`에 넣을지는 3단계 명세(PLAN 미정 P17). 표 구조는 OpenAlex 밖 출처(`source`)를 받을 수 있게 둠 |
| 5 국내 DB · OpenCitations | `external_works.source` · 식별자 열(`doi` 등), `citation_edges.source`로 출처를 구분. OpenAlex 번호가 없는 논문(KCI 등)용 키는 5단계 마이그레이션에서 추가(8.7절) |

## 4. 지금 코드 (바뀌는 지점)

| 위치 | 지금 | 1B |
|---|---|---|
| `paperlab/sources.py` `Sources.related` · `_openalex_id_for` | 씨앗 해석(OpenAlex id → DOI → arXiv → 제목), 피인용/참고문헌/관련 목록 한 쪽씩 | 씨앗 해석 로직을 그래프에서도 재사용. **그래프용 OpenAlex 호출 함수 추가**(id 묶음 조회 · `cites:` 묶음 조회 · 필드 선택) — 이메일 없음, 사용자 키만(7.4절) |
| `Sources._client` · `_openalex_params` | User-Agent에 `mailto:{contact_email}`, OpenAlex 요청에 `mailto=` | 그래프 호출은 **둘 다 넣지 않음**. 기존 검색 · 조회의 OpenAlex `mailto` 제거는 K-6 |
| `Sources._get_json` 오류 문구 | `"{host}에 연결할 수 없어요: {e}"` — `e`에 요청 주소(필터 · 식별자)가 섞일 수 있음 | 그래프 경로의 오류 · 로그는 **호스트 + 상태 코드만**(9.6절) |
| `paperlab/server.py` | `/api/papers/{id}/related` · `/api/related` | **`POST /api/graph`**(SSE) 추가(9장). 기존 두 엔드포인트는 그대로 |
| `paperlab/db.py` | 개인 표 질의 | 공용 캐시 읽기(사용자 트랜잭션 안) · 쓰기(`system_tx`) 함수 |
| `supabase/migrations/` | 1단계 파일 7개 | **새 마이그레이션 1개**(8.7절) |
| `tests/test_rls.py::test_catalog_rls_everywhere` (1단계 AC-20) | `paperlab`의 모든 표에 `user_id` + `authenticated` 정책 요구(시스템 표 2개 예외) | **공용 캐시 표 2개 예외 + 별도 검사**(8.4절, AC-G20) |
| 화면 | 상세 패널 "인용 관계" 탭(목록), 찾기 카드의 피인용 · 참고문헌 · 관련 논문 링크 | 두 곳에 **[인용 그래프]** 진입 + 새 화면 `#/graph`(10장) |

**1st My paper에서 가져오는 것(코드는 새로 씀)**: 후보 수집 순서(참고문헌 + 관련 + 피인용 상위), **제목 정규화로 프리프린트/출판본 중복 합치기**(빈 제목 제외, 씨앗은 교체 안 함), 자카드 정규화 서지 결합 · 공동 인용, **`min_shared = 2`**(겹침 1편으로 자카드 1.0이 나와 진짜 신호를 밀어내던 실측 문제), **관련 논문은 인용 근거가 없을 때만 쓰는 폴백**(국문 논문은 참고문헌 데이터가 36%뿐이라 실측상 고립점투성이), 노드당 선 상한, OpenAlex id 체계 맞추기(DOI id와 `W…` id 혼용 문제 — 1B는 OpenAlex 번호 하나로 통일). 수치 기본값(6.9절)은 1st My paper `external.json` 실측값에서 출발합니다.
**버리는 것**: 로컬 SQLite 캐시 · `external_edges` 스키마(ID 체계 혼용), 인용 방향 모드, 설정 파일로 수치를 바꾸는 구조(1B는 코드 상수 — 가정), 직접 만든 힘 계산(K-1에서 선택지로만).

## 5. 사용자 흐름

```
[서재 상세 패널]  ──[인용 그래프]──┐
[논문 찾기 결과 카드] ──[그래프]──┤
[그래프 노드 패널] ──[이 논문으로 새 그래프]──┘
        ▼
#/graph 화면: "그래프를 만드는 중… (2/5 참고문헌 · 관련 논문 312편)"  ← SSE 진행
        ▼ done
힘 기반 그래프(씨앗 가운데) + 오른쪽 패널 [논문 정보 | 이전 연구 | 이후 연구]
  · 노드 클릭 → 논문 정보: 제목 · 저자 · 연도 · 학술지 · 피인용 · 초록 · 씨앗과의 관계
      [＋ 서재에 추가] [PDF 포함 추가](OA PDF 있을 때) [인용] [인하대에서 보기] [Google Scholar에서 보기] [이 논문으로 새 그래프]
      서재에 이미 있으면 [✓ 서재에 있음 · 열기]
  · 노드에 마우스/포커스 → 이웃 노드 · 선 강조, 나머지 흐리게
  · 이전 연구 탭: 그래프 논문들이 많이 인용한 논문 20편 ("그래프 논문 12편이 인용")
  · 이후 연구 탭: 그래프 논문들을 많이 인용한 논문 20편 ("그래프 논문 9편을 인용")
  · 상단: [← 돌아가기] · 크기 [20 | 40 | 80] · [목록으로 보기] · 범례
```

- **씨앗 = 서재 논문**: 요청에 `paper_id`만 보냄. 서버가 사용자 권한으로 논문을 읽어 `openalex_id` → DOI → arXiv → 제목 순으로 OpenAlex 작품을 찾고, 찾은 `openalex_id`가 논문에 비어 있으면 채워 둠(지금 `/related`와 같은 동작 — 개인 데이터).
- **씨앗 = 찾기 결과**(OpenAlex · S2 · arXiv · Crossref 어느 결과든): 그 결과의 식별자(`openalex_id` · `doi` · `arxiv_id` · `title`)만 보냄.
- 그래프가 끝나면 화면 주소를 `#/graph/W<번호>`로 바꿈(`history.replaceState`). 해시는 서버로 가지 않음. 새로 고침하면 같은 씨앗으로 다시 만듦(캐시로 빠름).
- **크기 바꾸기**(20 · 40 · 80): 같은 후보 풀에서 다시 고르므로 외부 호출 없이 서버 재계산(캐시만 읽음).
- 서재에 추가하면 그 노드 표시가 "서재에 있음"으로 바뀜(지금 찾기 화면 `addPaper` 흐름 그대로).

## 6. 알고리즘 (서버, `paperlab/citegraph.py` — 입출력 없는 순수 함수)

용어: **작품(work)** = OpenAlex 작품 하나(번호 `W` 뒤 숫자, 저장은 `bigint`). **풀(pool)** = 후보 작품 모음. **refs(x)** = x의 참고문헌 작품 번호 집합. **citers(x)** = 풀 안에서 x를 참고문헌에 가진 작품 집합.

### 6.1 씨앗 해석
1. `openalex_id`(형식 `^W[1-9][0-9]{0,11}$`)가 있으면 그것.
2. 없고 DOI가 있으면: 캐시 `external_works.doi`에서 찾고, 없으면 OpenAlex `filter=doi:https://doi.org/<doi>`(목록 호출 1회). 경로에 DOI를 넣지 않음(9.5절).
3. arXiv id면 DOI `10.48550/arxiv.<id>`로 2번.
4. 제목만 있으면 지금 `match_title` 규칙(정규화 제목 일치 또는 20자 넘는 포함 관계)으로 OpenAlex 검색 1회(검색 호출 — 비용이 큼, 7.1절). 맞는 것이 없으면 오류 `seed_not_found` "이 논문을 OpenAlex에서 찾지 못했어요. DOI가 있으면 정확해져요."
5. 씨앗 작품의 전체 서지 + `referenced_works` + `related_works`가 캐시에 유효하면 호출 없음, 아니면 단건 조회 1회(OpenAlex 단건 조회는 무료 — 7.1절).
- **서재 씨앗(구현 반영 ⑫)**: 서재 논문의 `openalex_id` · `doi` · `arxiv_id` · 제목 가운데 **형식이 틀린 칸은 버리고** 나머지로 위 순서를 진행(틀린 칸이 **일부만** 있으면 400을 내지 않음 — 사용자가 서재에 잘못 적어 둔 값 때문에 그래프가 막히지 않게). **쓸 수 있는 칸이 하나도 남지 않으면 스트림 전에 400 `bad_seed`**(화면 "이 논문으로는 그래프를 만들 수 없어요"). 이 경우는 `seed_not_found`가 아님 — `seed_not_found`는 **형식은 맞는데 OpenAlex에서 찾지 못한** 경우(위 2~4번)에만 씀.
6. **합쳐진(merged) 씨앗 번호**: OpenAlex는 합쳐진 작품의 옛 번호를 단건 조회하면 **3xx 리디렉션**으로 새 번호를 알려 줌. 리디렉션을 자동으로 따라가지 않으므로(9.5절), `Location`이 **같은 호스트(`api.openalex.org`)이고 `W` 번호를 담고 있을 때만** 그 번호로 **1번 다시 조회**함(그 밖의 `Location`이나 두 번째 리디렉션은 따라가지 않음 — 대부분 `seed_not_found`, 단 `javascript:`처럼 httpx가 주소로 해석하지 못하는 `Location` 값은 `upstream_unavailable`. **어느 경우에도 추가 요청은 보내지 않음**). 응답 작품의 `id`가 요청한 번호와 다르면 **응답 `id`를 씨앗으로 씀**(그래프 · 캐시 · 화면 주소 `#/graph/W…`가 새 번호. 서재 씨앗이면 논문의 `openalex_id`도 새 번호로 채움).

### 6.2 후보 수집
| 단계 | 모으는 것 | 상한(가정 — 6.9절) |
|---|---|---|
| A | 씨앗의 참고문헌 R = refs(seed) | 앞에서 **300편**까지(참고문헌이 **300편을 넘을 때** `truncated` 경고 — 구현 반영 ⑮) |
| B | 씨앗의 관련 논문 L = OpenAlex `related_works` | **20편** |
| C | 씨앗을 인용한 논문 C: `cites:W<seed>`, 피인용 많은 순 | **100편**(1회) |
| D | 함께 인용 자료 D: 예비 점수(6.5절 1단계) 상위 **49편 + 씨앗**을 `cites:W1\|W2\|…`(최대 50값)로 묶어, 피인용 많은 순 100편 + 최신순 100편. **예비 점수가 0인 작품은 대상에서 뺌**(구현 반영 ⑤). 계산에 쓰는 D는 응답 그대로가 아니라 **캐시에서 다시 찾은 "대상 작품들을 인용한 작품"**(8.3절 — 구현 반영 ①) | 2회 |

- A · B는 작품 번호만 알므로 **서지 + 참고문헌 목록**을 묶음 조회(`filter=openalex:…|…`, 100개씩 — 7.3절)로 받습니다. C · D는 응답에 이미 서지 + 참고문헌 목록이 옴.
- 풀 = {seed} ∪ R ∪ L ∪ C ∪ D. 최대 약 620편.
- **중복 합치기**(1st My paper `_add_to_pool`): ① 제목이 빈 작품은 넣지 않음(씨앗 제외) ② 같은 OpenAlex 번호는 하나 ③ **정규화 제목이 같고 그 정규화 제목이 12자 이상이면**(지금 `db.normalize_title` — 서재 중복 찾기와 같은 12자 기준, 구현 반영 ④. 짧은 제목 "Introduction" 등이 서로 다른 논문을 합치지 않게) 피인용이 큰 쪽을 남기고 참고문헌은 합집합, 지운 쪽 번호는 남긴 쪽의 **별칭**으로 기록해 다른 작품의 refs · citers에서도 같은 노드로 셈 ④ 씨앗과 제목이 같은 작품은 씨앗으로 합침(씨앗은 바뀌지 않음).
- D 단계의 `cites:` OR 필터가 실제로 동작하는지 **확인 필요**(OpenAlex 공식 문서는 "한 필터 안에서 `|`로 최대 100값"이라고만 함 — AC-G40 실측). 안 되면 D를 "예비 상위 10편 각각 `cites:` 1회(피인용 순 50편)"로 바꾸고 호출 상한(6.9절)을 지킴 — 개발팀이 팀장에게 보고.

### 6.3 공동 인용 범위의 한계 (화면에 안내)
공동 인용은 **풀 안에서 가져온 인용 논문들**(C ∪ D ∪ 참고문헌 목록을 아는 모든 풀 작품)만으로 셉니다. Connected Papers는 약 5만 편을 분석하지만 1B는 수백 편 범위라 공동 인용 신호가 약할 수 있습니다. 화면 범례 아래 작은 글씨: "후보 N편을 비교해 고른 그래프예요(전체 문헌을 다 본 것은 아니에요)."

### 6.4 유사도 (두 작품 a, b)
```
coupling(a,b)   = J(refs(a), refs(b))      단, |refs(a) ∩ refs(b)| < MIN_SHARED 이면 0
cocitation(a,b) = J(citers(a), citers(b))  단, |citers(a) ∩ citers(b)| < MIN_SHARED 이면 0
J(X,Y) = |X∩Y| / |X∪Y|  (둘 중 하나라도 비면 0)

cited = W_COUPLING·coupling + W_COCITATION·cocitation
related_sim = 1.0  (a가 b를, 또는 b가 a를 related_works로 지목)
            = J(related(a)∩풀, related(b)∩풀)  (그 밖)
sim(a,b) = cited                          (cited > 0 일 때 — 인용 근거가 있으면 그것만)
         = W_RELATED·related_sim           (cited = 0 일 때만 — 폴백)
kind = coupling · cocitation · related 중 기여가 가장 큰 것, shared = 그 성분의 겹친 편수
```
- refs · related · citers는 모두 **별칭을 풀어 같은 노드 번호로** 맞춘 뒤 계산(1st My paper의 ID 체계 문제 재발 방지).
- 계산량: 6.5절 1단계는 씨앗 대 후보(≤620번), 2단계 선 계산은 고른 노드끼리(80편이면 3,160쌍)만 — 풀 전체 쌍을 계산하지 않음.

### 6.5 노드 고르기
1. **예비 점수**(D 단계 대상 고르기, C까지 모은 뒤): `prelim(w) = sim(seed, w)` (C까지의 자료로 계산). **0보다 큰 것 중** 상위 49편(0인 작품은 D 대상에서 뺌 — 구현 반영 ⑤).
2. **최종 점수**(D까지 모은 뒤): `rank(w) = W_RANK_SIM · sim(seed, w) + ln(1 + cited_by_count(w))` — 1st My paper `rank_coupling_weight = 5.0` 출발(가정, M-G03에서 실측 조정).
3. 씨앗 + `rank` 상위 (크기 − 1)편 = 노드. 크기는 20 · 40(기본) · 80.
4. 같은 점수면 OpenAlex 번호 오름차순(결과 고정 — 테스트 재현성).
5. 풀이 3편 미만(씨앗 포함)이면 그래프 대신 빈 상태(10.6절).

### 6.6 선(엣지)
- 고른 노드끼리 모든 쌍의 `sim` 계산 → `sim < MIN_SCORE` 버림 → **노드당 상위 `MAX_EDGES_PER_NODE`개**(양끝 중 한쪽이라도 그 노드의 상위 안에 들면 남김 — 1st My paper `cap_edges_per_node`).
- 씨앗과 선이 하나도 없는 노드도 남김(위치는 다른 노드와의 선으로 정해짐, 선이 아예 없으면 가장자리).
- 각 선: `source` · `target`(노드 id), `weight`(0~1, 소수 4자리), `kind`, `shared`, 성분 `coupling` · `cocitation` · `related`.

### 6.7 이전 연구 · 이후 연구
Connected Papers 정의(16장): 이전 연구 = 그래프 논문들이 **공통으로 많이 인용한** 문헌(기초 · 대표 문헌), 이후 연구 = 그래프 논문들을 **공통으로 많이 인용하는** 문헌(최근 연구 · 리뷰).
- **씨앗은 이전 · 이후 연구 목록에 넣지 않음**(구현 반영 ③ — 씨앗은 그래프 가운데에 이미 있음).
- **이전 연구**: 노드(씨앗 포함)의 refs를 모두 세어 `count(x) = x를 인용한 노드 수`. `count ≥ 2`, 노드 자신도 후보에 포함(Connected Papers처럼 그래프 안 논문이 이전 연구일 수 있음 — 화면에 "그래프에 있음" 표시). `count` 내림차순, 같으면 피인용 내림차순 → **20편**. 서지가 캐시에 없는 작품은 마무리 묶음 조회(7.3절 E)로 받음.
- **이후 연구**: 풀 안의 인용 논문(C ∪ D ∪ 기타 refs를 아는 작품) 중 `count(y) = y가 인용한 노드 수 ≥ 2`. `count` 내림차순, 같으면 연도 내림차순 → **20편**. D에 "최신순 100편"을 넣는 이유가 이것(최근 연구가 빠지지 않게).
- 각 항목: 작품 정보 + `count` + `in_graph`(노드인지) + `in_library`.

### 6.8 인용 정보가 적은 논문 (국문 등)
- 1st My paper 실측(한국어 인용 상위 25편): 참고문헌 있음 36%, 관련 논문 있음 100%(영어는 참고문헌 84%). 그래서 6.4절 폴백(`related`)을 둡니다. 화면에서는 **점선**, 범례 "주제 유사(인용 근거 없음)".
- 고른 노드의 선 가운데 `related`가 **절반 넘으면** 경고 `weak_citation_data` "이 논문 주변은 인용 정보가 적어 주제 유사도로 보강했어요."
- 씨앗의 OpenAlex 참고문헌이 0편이면 7.3절 S2 보강(K-7)을 먼저 시도.
- KCI 같은 국내 DB 인용 정보는 5단계.

### 6.9 수치 (기획팀 추천 K-8 · K-9 — 코드 상수 한 곳 `citegraph.py`, 가정)
| 이름 | 값 | 근거 |
|---|---|---|
| `SIZES` · 기본 | 20 · **40** · 80 | Connected Papers "몇십 편"(16장), 1st My paper 기본 60 |
| `MAX_SEED_REFS` | 300 | 묶음 조회 3회 |
| `MAX_RELATED` | 20 | 1st My paper `seed_related` |
| `CITERS_TOP` | 100 | 1회(최대 `per_page` 100) |
| `COCITE_TARGETS` | 49 + 씨앗 | OR 50값 |
| `COCITE_PER_SORT` | 100 × 2(피인용 순 · 최신순) | |
| `W_COUPLING` · `W_COCITATION` | 0.6 · 0.4 | 1st My paper |
| `MIN_SHARED` | 2 | 1st My paper 실측 |
| `W_RELATED` | 0.25 | 1st My paper |
| `MIN_SCORE` | 0.05 | 1st My paper |
| `MAX_EDGES_PER_NODE` | 6 | 1st My paper |
| `W_RANK_SIM` | 5.0 | 1st My paper `rank_coupling_weight` |
| `PRIOR_N` · `DERIVATIVE_N` · 최소 count | 20 · 20 · 2 | |
| `MAX_REFS_STORED` | 500 / 작품 | 저장 크기(8.5절) |
| `MAX_LIST_CALLS` | **12** / 그래프 1회 | 7.3절 예산 |

## 7. 데이터 소스 · 호출 예산

### 7.1 OpenAlex (주 소스) — 공식 문서 확인 2026-10-07 (16장)
| 항목 | 사실 |
|---|---|
| 무료 사용량 | **키 없이 하루 $0.10**, **무료 API 키 하루 $1**(10배). 매일 **자정 UTC = 한국 오전 9시** 초기화 |
| 호출 종류별 비용 | 단건 조회(`/works/W…`) **무료**, 목록 + 필터 **1,000회당 $0.10**, 검색 **1,000회당 $1**, PDF 내려받기 1,000회당 $10 |
| → 하루 가능 횟수 | 키 없이: 목록 1,000회 또는 검색 100회 / 키: 목록 10,000회 또는 검색 1,000회 |
| 초당 한도 | 초당 100회 넘으면 429. 하루 예산을 넘어도 429 |
| 한 쪽 최대 | `per_page` 최대 100, 기본 페이지 넘기기로 1만 건까지 |
| OR 필터 | 한 필터 안에서 `\|`로 **최대 100값**(필터 사이 OR 불가) |
| 응답 헤더 | `X-RateLimit-Limit` · `X-RateLimit-Remaining` · `X-RateLimit-Credits-Used` · `X-RateLimit-Reset` |
| 키 전달 | `api_key=` 쿼리 또는 `Authorization: Bearer` |
| polite pool · `mailto` | **2026년 2월부터 없어짐. `mailto`는 무시됨**, 모든 사용자에게 (무료) 키를 권함 |
| `related_works` | "가장 많은 주제를 공유하는 최근 논문"(알고리즘) — 지원 중(폐기 표시 없음) |

- **키 없는 예산이 IP 단위인지 확인 필요**. IP 단위라면 서버 PC 한 대(공개 IP 하나)의 모든 사용자 · 모든 기능(검색 포함)이 하루 $0.10을 나눠 씀 → 7.4절.

### 7.2 Semantic Scholar — 공식 문서 확인 2026-10-07 (16장)
| 항목 | 사실 |
|---|---|
| 키 없이 | **모든 비인증 사용자가 함께** 초당 1,000회를 나눠 씀, 붐비면 더 제한 — 429가 잦음(1st My paper도 "키 없이 쓰면 429"로 꺼 둠) |
| 키 있음 | 처음 한도 **초당 1회**(모든 엔드포인트) |
| 묶음 조회 | `POST /paper/batch` 한 번에 **500 id**, 응답 최대 10MB |
| 참고문헌 · 인용 | `/paper/{id}/references` · `/citations`의 `limit` 최대 1,000 |
| id 형식 | `DOI:` · `ARXIV:` · `CorpusId:` · `MAG:` 등 접두어 |

### 7.3 그래프 1회 호출 예산 (캐시가 비었을 때)
| 단계 | 호출 | 종류 | 횟수 |
|---|---|---|---|
| 씨앗 | `GET /works/W…`(번호를 알 때) / `filter=doi:` / 제목 검색 | 단건(무료) / 목록 / 검색 | 1 |
| A · B 서지 | `GET /works?filter=openalex:W1\|…\|W100&per_page=100&select=…` | 목록 | ≤ 4 (300 + 20편) |
| C 피인용 | `filter=cites:W<seed>&sort=cited_by_count:desc&per_page=100` | 목록 | 1 |
| D 함께 인용 | `filter=cites:W…\|…(50값)` × 정렬 2가지 | 목록 | 2 |
| E 마무리 | **세 크기(20 · 40 · 80) 모두의** 노드 + 이전 · 이후 연구 중 **초록 · 서지가 캐시에 없는 것**만 미리 `filter=openalex:…`(100개씩) — 크기를 바꿔도 다시 받지 않게(구현 반영 ⑥, AC-G13) | 목록 | **최대 2** |
| S2 보강(조건부) | S2 `GET /paper/DOI:<doi>/references?fields=externalIds&limit=1000` 1회 + OpenAlex `filter=doi:…` ≤ 2회 | S2 + 목록 | ≤ 1 + 2 |

- **상한 `MAX_LIST_CALLS = 12`**(목록 · 검색 합계). 넘을 일이 생기면 남은 단계를 건너뛰고 부분 결과 + 경고.
- 비용: 목록 12회 = 약 $0.0012 → 키 없이도 하루 약 80번, 키가 있으면 약 800번의 "처음 만드는" 그래프. **캐시가 유효하면 0회**(AC-G12).
- `select`로 필요한 필드만 받음: A~D는 초록(`abstract_inverted_index` — 큼) **빼고**, E에서만 초록 포함. 필드 목록은 지금 `norm_openalex`가 쓰는 것 + `referenced_works` · `referenced_works_count` · `related_works`.
- 묶음 조회 필터 이름: 지금 코드가 쓰는 `openalex:`(1st My paper는 `openalex_id:`) — 어느 쪽이 공식 · 현행인지 **확인 필요**(AC-G40).

### 7.4 키 · 이메일 · 보내는 정보 (기획팀 추천 K-5 · K-6)
- **OpenAlex 키**: 그래프를 요청한 사용자가 설정에 `openalex_api_key`를 넣었으면 **그 키**, 없으면 **키 없이**. 키는 **`api_key` 쿼리 매개변수**로 보냄(구현 반영 ⑩ — 지금 검색 코드와 같은 방식, `Authorization` 헤더 안 씀). 그래서 요청 주소에 키가 들어가므로 외부 호출 주소 · 오류 문구를 로그에 남기지 않는 규칙(9.6절)이 키 보호도 겸함. 공용 서버 키(새 환경 변수 `OPENALEX_API_KEY`)는 1B에서 만들지 않고, 운영 중 429(예산 초과)가 잦으면 팀장 결정으로 추가(그때 관리자가 OpenAlex 계정에서 무료 키 발급 — 사용자 작업).
  - 사용자 키로 받은 서지도 공용 캐시에 들어갑니다(공개 데이터). OpenAlex 쪽에는 그 키 주인의 사용량으로 남습니다 — 우리 쪽 기록이 아니라 외부 서비스의 기록입니다(설정 창 키 칸 안내에 한 줄 — 디자인).
- **S2 키**: 사용자 `semantic_scholar_api_key`가 있으면 `x-api-key`, 없으면 키 없이. 키가 있어도 초당 1회를 지킴.
- **이메일**: `mailto` 쿼리 · User-Agent 이메일 **보내지 않음**. User-Agent는 `PaperLab/<버전>`만.
- K-6(1B에 함께 — **구현 반영 ⑪으로 확대**): 사용자 연락처 이메일(`contact_email`)은 **Crossref에만** 보냄(Crossref polite pool — `mailto` 매개변수 · User-Agent). **OpenAlex · arXiv · Semantic Scholar · 주소에서 PDF 받기**에는 `mailto` · User-Agent 이메일 모두 **보내지 않음**(User-Agent는 `PaperLab/<버전>`만). 설정 창 안내 문구: "Crossref에 이메일을 알려 주면 요청이 우선 처리돼요(OpenAlex에는 보내지 않아요)."

### 7.5 타임아웃 · 재시도 · 속도 · 부분 실패
| 항목 | 값(가정) |
|---|---|
| 호출 하나 | 연결 5초, 읽기 15초. 응답 본문 최대 **10MB**(넘으면 그 호출 실패로) |
| 그래프 하나 전체 | **45초** 기한. 넘으면 남은 단계를 건너뛰고 지금까지 모은 것으로 계산 + 경고 `partial` |
| 재시도 | 429 · 5xx · 연결 오류만 **1번**. `Retry-After`가 있으면 따르되 최대 5초, 없으면 1초. 하루 예산 429(`X-RateLimit-Remaining: 0`)는 재시도 안 함. **S2도 연결 오류 · 429 · 5xx만 1번 재시도**하고, S2 **404**(그 DOI를 S2가 모름)는 재시도 · 경고 없이 보강만 건너뜀(구현 반영 ⑨) |
| 동시 호출 | 그래프 하나 안에서 OpenAlex 동시 3개(A 묶음 · D 두 정렬). 서버 전체 OpenAlex **초당 10회 이하**(토큰 버킷 — 공식 100보다 훨씬 낮게), S2 초당 1회 |
| 부분 실패 | 씨앗 해석 실패 = 오류(`seed_not_found` / `upstream_unavailable`). A~E 중 일부 실패 = **있는 것으로 계속** + 경고(`refs_partial` · `citing_failed` · `cocite_failed` · `abstracts_failed`). 받은 것은 그 자리에서 캐시에 씀(다음에 다시 받지 않게) |
| 하루 예산 소진 | 캐시(+ 그때까지 받은 것)로 그릴 수 있으면 그리고 경고 `upstream_limited`, 아니면 오류 `upstream_limited`(같은 이름 — 9.3절 표) "OpenAlex 하루 사용량을 다 썼어요(한국 시간 오전 9시에 초기화). 설정에서 OpenAlex API 키를 넣으면 한도가 10배가 돼요." |
| 캐시가 오래됨 + 외부 실패 | 오래된 캐시로 그리고 경고 `stale_cache` "일부 정보가 오래됐을 수 있어요" |

### 7.6 캐시 유효 기간 (TTL, 기획팀 추천 K-10 — 가정)
| 대상 | 유효 기간 | 이유 |
|---|---|---|
| 서지(제목 · 저자 · 연도 · 학술지 · 피인용 수) | 30일 | 피인용 수만 자주 바뀜 |
| 참고문헌 목록 | 180일 | 거의 안 바뀜(정정 정도) |
| 관련 논문 목록 | 90일 | OpenAlex 알고리즘 갱신 |
| 피인용 목록(C · D) | 30일 | 새 인용이 계속 생김 |
| C 단계 피인용 목록(`cited_by_top_c` — 그래프 · 1C 추천이 씀, 8.3절) | 30일 | 피인용 목록과 같음 |
| 초록 | 180일 | |
| OpenAlex가 돌려주지 않은 번호(빈 행) | **30일** | 묶음 조회에서 응답에 없던 번호(병합 · 삭제된 작품 등)는 **제목이 빈 행**으로 남겨, 30일 동안 다시 묻지 않음(구현 반영 ②, 8.2절) |
- 기간 계산은 **날짜 단위**(8.2절 `*_on date`). 지난 것은 "필요할 때" 다시 받음(미리 갱신하는 배치 작업 없음).

## 8. 저장

### 8.1 원칙
- 공용 캐시는 **공개 서지와 관계 목록만**. 사용자 · 요청 · 세션 · IP · 조회 시각(시 · 분)을 담는 열이 **없음**.
- 개인 그래프(씨앗 · 크기 · 결과)는 **서버에 저장하지 않음**(확정 — U-1 ①). 브라우저 메모리에만(같은 탭에서 뒤로 가기 때 다시 그리기용, 최근 8개) 두고, **로그아웃할 때 비움**(M-5 — 같은 브라우저에서 다른 계정으로 로그인해도 앞 사람의 그래프 · `in_library` 표시가 남지 않게). `localStorage` 등 디스크에는 쓰지 않음(범례 열림 상태만 예외 — 디자인 GD-8).
- 표 위치: **`paperlab` 스키마, 이름은 PLAN 그대로**(`external_works` · `citation_edges`) — 기획팀 추천 K-4. `paperlab`은 Data API에 노출되지 않으므로(1단계 T4) 화면에서 직접 읽을 수 없고 서버를 거쳐야 함.

### 8.2 `paperlab.external_works` — 공개 서지 (작품 하나 = 행 하나)
| 열 | 형 | 비고 |
|---|---|---|
| `id` | bigint identity PK | 내부 번호(외부에 노출 안 함) |
| `openalex_no` | bigint unique null | `W` 뒤 숫자. 1B의 모든 행은 값이 있음. 검사: `openalex_no > 0` |
| `source` | text not null default `'openalex'` | `check (source in ('openalex'))` — 5단계에서 늘림 |
| `doi` | text not null default '' | 소문자 정규화, 있으면 `10.`으로 시작(검사 제약). 색인(유일 아님 — OpenAlex에도 같은 DOI 작품이 둘인 경우가 있음) |
| `arxiv_id` | text not null default '' | |
| `title` | text not null | 최대 1,000자(잘라 저장) |
| `title_norm` | text not null default '' | `normalize_title` — 중복 합치기 · 서재 일치용. 색인 |
| `authors` | jsonb not null default '[]' | `[{given, family}]` 앞 **20명**까지 |
| `author_count` | integer not null default 0 | 전체 저자 수 |
| `year` | integer null | |
| `issued` · `venue` · `publisher` · `volume` · `issue` · `pages` · `item_type` · `language` | text not null default '' | 지금 `norm_openalex` 필드 그대로(길이 상한 300) |
| `url` · `pdf_url` | text not null default '' | **`http://` · `https://`로 시작할 때만** 저장(그 밖은 빈 값 — `javascript:` 등 차단) |
| `is_oa` | boolean not null default false | |
| `cited_by_count` | integer not null default 0 | |
| `reference_count` | integer not null default 0 | OpenAlex `referenced_works_count`(잘린 경우에도 전체 수) |
| `abstract` | text null | **그래프 노드 · 이전/이후 연구로 화면에 나온 작품만** 채움(7.3절 E), 최대 5,000자. null = 아직 안 받음, '' = 없음 |
| `meta_on` | date not null | 서지를 받은 날 |
| `abstract_on` | date null | 초록을 받은 날 |
| 색인 | `(doi) where doi <> ''`, `(title_norm)`, `(meta_on)`(정리 명령용) | |

- **빈 행(구현 반영 ②)**: 묶음 조회로 요청했는데 OpenAlex가 돌려주지 않은 번호는 `title = ''`인 행으로 남깁니다(그 번호를 30일 동안 다시 묻지 않게 — 7.6절). 빈 행은 풀 · 노드 · 이전/이후 연구에 넣지 않고(제목 빈 작품 제외 규칙 — 6.2절), 30일이 지나면 다시 물어봄.

### 8.3 `paperlab.citation_edges` — 관계 목록 (작품 하나 × 관계 종류 = 행 하나)
"인용 관계(edge)"를 한 줄에 하나씩 두면 그래프 한 번에 수만 행이 생겨 무료 DB 500MB를 빨리 씁니다(8.5절). 그래서 **한 작품의 한 방향 목록을 배열 하나로** 둡니다(인접 목록). 이름은 PLAN 그대로 둡니다 — 기획팀 추천 K-3.

| 열 | 형 | 비고 |
|---|---|---|
| `work_no` | bigint not null | 기준 작품의 OpenAlex 번호(`external_works` 행이 없을 수도 있음 — 외래 키 없음) |
| `relation` | text not null | `check (relation in ('references','related','cited_by_top','cited_by_recent','cited_by_top_c'))` — `cited_by_top_c`는 1C에서 추가(8.7절 `…000003`) |
| `nos` | bigint[] not null | 상대 작품 번호 목록. `references` 최대 500, `related` 최대 20, `cited_by_*`(`cited_by_top_c` 포함) 최대 100 (`cardinality` 검사 제약) |
| `total` | integer not null | 출처가 알려 준 전체 수(예: 참고문헌 812편 중 500편 저장 → 812) |
| `truncated` | boolean not null default false | |
| `source` | text not null default `'openalex'` | `check (source in ('openalex','s2'))` — S2 보강으로 만든 참고문헌 목록은 `s2` |
| `fetched_on` | date not null | |
| PK | `(work_no, relation)` | |

- `cited_by_*`는 "그 작품을 인용한 논문 상위 목록"(C 단계 · 씨앗일 때만 생김).

| 관계 | 뜻 | 쓰는 곳 | 유효 기간 · 상한 |
|---|---|---|---|
| `references` | 참고문헌 목록(A · D 응답 작품) | 그래프 · 추천 | 180일 · 500 |
| `related` | OpenAlex 관련 논문(B) | 그래프 · 추천 | 90일 · 20 |
| `cited_by_top` | 씨앗을 인용한 논문 피인용 순 상위 — **C · D 모두 끝났다는 표시**를 겸함(아래) | 그래프가 씀, 그래프 · 추천이 읽음 | 30일 · 100 |
| `cited_by_recent` | 검사 제약에만 있는 이름(지금 코드는 쓰지 않음) | — | 30일 · 100 |
| **`cited_by_top_c`** (1C 추가) | 씨앗을 인용한 논문 피인용 순 상위 — **C 단계 목록**(D 완료 여부와 무관. 뜻은 "그래프나 추천이 이 작품의 C를 받았다"뿐) | **그래프 · 1C 추천 모두 C를 새로 받으면 씀**(사용자 결정 I-1 "흔적 구분 못 하게", 2026-10-08 — 개발팀 변경 중), 그래프 · 추천이 읽음. 추천은 D를 외부에서 받지 않으므로 `cited_by_top`은 쓰지 않음 | 30일 · 100 |

- **`cited_by_top_c` 재사용 규칙**(팀장 결정 Q-1, 2026-10-08 — `graph_build.py` `_citing`):
  - **그래프**: 씨앗의 `cited_by_top`이 유효하면 지금처럼 C · D 모두 캐시. `cited_by_top`이 없거나 지났고 **`cited_by_top_c`가 유효하면** 그 목록을 C로 다시 쓰고(C 외부 호출 없음) **D만 받음** → D가 끝나면 `cited_by_top`을 씀(C · D 완료 표시). 둘 다 유효하지 않으면 C를 새로 받고 **그 자리에서 `cited_by_top_c`에 씀**(I-1 — 추천과 같은 흔적), D가 끝나면 `cited_by_top`도 씀(외부 실패 · 기한이면 지난 `cited_by_top`, 없으면 지난 `cited_by_top_c`로 그리고 `stale_cache`).
  - **추천**: `cited_by_top` 또는 `cited_by_top_c`가 유효하면 C는 캐시. 아니면 C를 받아 **`cited_by_top_c`에 씀**(`cited_by_top`은 쓰지 않음 — D를 받지 않았으므로).
- **D 단계 저장 · 계산 (개정 — 구현 반영 ①, 팀장 승인)**:
  - 저장: D 단계(여러 작품 묶음 `cites:`) 결과는 **각 응답 작품의 `references` 행 + 서지로만** 남김(묶음 질의 · 그 결과 목록 자체는 저장하지 않음 — 질의 모양이 씨앗을 드러내므로).
  - 계산: 그래프를 계산할 때 D는 외부 응답을 그대로 쓰지 않고, **캐시에서 "D 대상 작품들을 `references`에 가진 작품"** 을 찾아 씀 — 피인용 많은 순 100편 ∪ 최신순 100편(`citation_edges.nos`의 **GIN 색인**, `relation = 'references'` 부분 색인 — 8.4절). 그래서 처음 만들 때와 캐시로 다시 만들 때 **같은 풀**이 나옴.
  - 완료 표시: 씨앗의 `cited_by_top` 행은 **C와 D가 모두 끝난 뒤에** 씀 → 이 행이 유효하면 "C · D까지 캐시에 있음"으로 보고 외부를 부르지 않음(중간에 끊긴 그래프는 다음에 C · D를 다시 받음).
  - 이유: 8.3절 처음 안(묶음 결과를 저장하지 않고 응답만으로 계산)대로면 캐시로 다시 만들 때 D 결과를 되살릴 수 없어 **AC-G12(두 번째 사용자 외부 호출 0회 · 같은 결과)를 지킬 수 없음**.
  - 대가: **다른 그래프가 캐시에 넣은 인용 작품도 풀에 들어올 수 있음**(대상 작품을 인용한 작품이 이미 캐시에 있으면 함께 잡힘). 같은 캐시 상태면 결과는 같지만, 캐시가 늘어나면 같은 씨앗의 그래프가 조금 달라질 수 있음(위험 — 13장).
- "누가 x를 인용하나"는 이 표만으로 다 알 수 없습니다(캐시에 있는 작품의 `references`에 x가 들어 있는 만큼만). 1B 알고리즘은 풀 안에서만 세므로 충분합니다.

### 8.4 RLS · 권한 (마이그레이션 SQL 요지)
```sql
create table paperlab.external_works ( … 8.2절 … );
create table paperlab.citation_edges ( … 8.3절 … );
-- 캐시에서 "이 작품들을 인용한 작품" 찾기(D 단계 계산 — 8.3절, 구현 반영 ①)
create index citation_edges_refs_gin on paperlab.citation_edges using gin (nos) where relation = 'references';

-- 1C 추가(…000003 — 8.7절): 관계 검사 제약만 바꿈. 배열 상한은 위 cardinality 검사(그 밖 관계 100)가 그대로 적용
alter table paperlab.citation_edges drop constraint citation_edges_relation_check;
alter table paperlab.citation_edges add constraint citation_edges_relation_check
    check (relation in ('references', 'related', 'cited_by_top', 'cited_by_recent', 'cited_by_top_c'));

alter table paperlab.external_works enable row level security;
alter table paperlab.external_works force row level security;
alter table paperlab.citation_edges enable row level security;
alter table paperlab.citation_edges force row level security;

-- 읽기: 로그인한 사용자 누구나 (공용 캐시 — 사용자 결정)
create policy shared_read on paperlab.external_works for select to authenticated using (true);
create policy shared_read on paperlab.citation_edges for select to authenticated using (true);
grant select on paperlab.external_works, paperlab.citation_edges to authenticated;
-- 쓰기 권한은 authenticated에 주지 않음(insert/update/delete 정책도 없음) → 사용자 트랜잭션에서 쓰면 권한 오류

-- 쓰기: 서버 system_tx(service_role)만
grant select, insert, update, delete on paperlab.external_works, paperlab.citation_edges to service_role;
grant usage, select on all sequences in schema paperlab to service_role;

revoke all on paperlab.external_works, paperlab.citation_edges from anon, public;
```
- 1단계 `…_rls_grants.sql`의 `grant … on all tables … to service_role`은 **그때 있던 표에만** 적용되므로 새 표에 위처럼 다시 줍니다(백업 `pg_dump --role=service_role`도 이 권한으로 읽음).
- 서버 코드: 그래프 계산 중 캐시 **읽기는 사용자 트랜잭션(`user_tx`) 안에서**(서재 일치 계산과 같은 트랜잭션), **쓰기는 `system_tx("citation cache write")`** — 이유 문자열은 **고정 문자열**(씨앗 · 작품 번호 · 제목을 넣지 않음, 8.6절). 쓰기 하나는 짧은 트랜잭션(외부 호출 사이에 연결을 잡고 있지 않음).
- 쓰기 방식: `insert … on conflict (openalex_no) do update` / `on conflict (work_no, relation) do update`. 같은 작품을 두 그래프가 동시에 쓰면 나중 것이 이김(공개 데이터라 문제없음).
- **1단계 AC-20 검사 개정**(AC-G20): 공용 캐시 표 2개는 `user_id` 요구에서 빼되, 대신 ① RLS + force 켜짐 ② `authenticated` 정책이 `select` 하나뿐 ③ `authenticated`의 표 권한이 `SELECT`뿐 ④ 열 이름에 낱말 `user`(`users`) · `ip` · `session` · `email`이 없고(밑줄로 나뉜 낱말 단위) **`_by`로 끝나는 이름이 없음**을 검사(구현 반영 ⑧ — `cited_by_count`처럼 중간에 `_by`가 든 공개 서지 열은 허용).

### 8.5 크기 추정 · 정리
- 처음 만드는 그래프 1회에 늘어나는 양(추정): 풀 약 620편 × 서지 행 약 0.6KB ≈ 370KB + 참고문헌 배열(평균 40편 × 8바이트) 약 200KB + 초록(노드 + 이전 연구 ≤ 100편 × 1.5KB) 약 150KB → **최대 약 0.7MB**. 주제가 겹치는 그래프는 훨씬 적게 늘어남.
  - 비교: 관계를 한 줄에 하나(정규화) + 빈 작품 행으로 두면 같은 그래프에 약 4MB(K-3 표).
- Supabase 무료 DB **500MB**(PLAN 7장)를 개인 데이터와 함께 씀 → 공용 캐시 **목표 상한 150MB**(가정, K-13).
- **관리 명령**(관리자 연결, 서버 프로세스 아님): `python -m paperlab.admin cache-stats`(두 표 크기 · 행 수 · 가장 오래된 날짜 — 내용 · 번호는 출력하지 않음), `python -m paperlab.admin cache-prune --max-mb 150`(`meta_on`이 오래된 작품부터 지우고, 그 작품의 `citation_edges` 행도 지움, 상한 아래가 될 때까지). 지워도 다음에 필요하면 다시 받음 — 데이터 손실 아님.
- 관리자 주간 점검(1단계 13.5절)에 `cache-stats` 한 줄 추가(안내서 — 개발팀/기획팀).

### 8.6 "누가 조회했는지 남기지 않음" 점검표
| # | 장치 | 확인 |
|---|---|---|
| 1 | 공용 표에 사용자 · 요청 · 세션 · IP 열 없음 | AC-G20 |
| 2 | 공용 표의 시각은 **날짜**(`date`)만 — 시 · 분으로 접근 로그와 맞춰 보는 일을 어렵게 함 | AC-G20 |
| 3 | 씨앗은 **요청 본문**으로만 보냄. 경로 · 쿼리에 넣지 않음(접근 로그는 `path`만 남김 — 1단계 13.5절) | AC-G31 |
| 4 | 앱 로그 · `system_tx` 이유 문자열 · 오류 문구에 씨앗 · 작품 번호 · DOI · 제목 없음. 그래프 완료 로그는 숫자만(걸린 시간 · 호출 수 · 캐시 적중 수 · 노드 수 · OpenAlex 남은 예산) | AC-G32 |
| 5 | 캐시 내용을 목록으로 돌려주는 API 없음. 그래프 API는 요청한 씨앗의 결과만 | 코드 검토 |
| 6 | 진행 중 그래프 정보(같은 씨앗 합치기 키 · 진행 상황)는 **메모리에만**, 끝나면 즉시 지움 | AC-G33 |
| 7 | 화면 주소 해시 `#/graph/W…`는 서버로 가지 않음(브라우저 방문 기록에는 남음 — 사용자 자기 기기). 화면이 메모리에 둔 최근 그래프는 **로그아웃할 때 비움**(M-5, 8.1절) | — |
| 8 | 남는 위험(사용자 결정으로 수용): 캐시에 어떤 작품이 있다는 사실 자체는 "누군가 이 주변을 봤다"를 뜻함(누구인지는 모름). DB를 직접 볼 수 있는 사람은 관리자뿐 | 13장 |

### 8.7 마이그레이션
- 새 파일 **`supabase/migrations/20261008000002_citation_cache.sql`**(구현 반영 ⑦ — `20261008000001` 바로 뒤) 하나: 두 표 · 검사 제약 · 색인 · RLS · 권한(8.4절). 적용은 지금처럼 `python -m paperlab.migrate`(업데이트 스크립트가 자동).
- **1C 추가 `supabase/migrations/20261008000003_citation_edges_top_c.sql`**(팀장 결정 Q-1, 2026-10-08): `citation_edges_relation_check`를 지우고 `cited_by_top_c`를 더한 같은 이름의 검사 제약으로 다시 만듦(8.4절). **검사 제약만** 바꿈 — 기존 행 · 색인 · RLS · 권한 · 배열 상한 검사는 그대로. 새 표 · 열 없음.
- 1단계 명세 2장 "공용 표 = 5단계에서 같은 스키마에 `shared_` 접두어 또는 별도 스키마"는 PLAN 개정(1B 앞당김)과 K-4에 따라 **1B · 같은 스키마 · PLAN 이름**으로 바뀜(1단계 명세 문구 정리는 기획팀 후속 — 15장).
- 5단계(OpenCitations · KCI)가 OpenAlex 번호 없는 작품을 넣을 때: `external_works`에 출처별 식별자 열 · 검사를 늘리고, `citation_edges`에 그 키 체계용 열을 추가하는 **새 마이그레이션**(5단계 명세).

## 9. 서버 API

### 9.1 엔드포인트
**`POST /api/graph`** → `text/event-stream`(SSE — 기획팀 추천 K-2. 지금 요약 · 대화와 같은 방식, 화면은 `api.js` `streamEvents` 사용)

요청 본문(JSON, 최대 4KB):
```json
{"seed": {"paper_id": 12}, "size": 40}
{"seed": {"openalex_id": "W1234567890", "doi": "10.48550/arxiv.1706.03762", "arxiv_id": "1706.03762", "title": "Attention Is All You Need"}, "size": 80}
```
- `seed`는 `paper_id`(서재) **또는** 식별자 묶음 중 하나. 둘 다 있으면 400.
- `size` ∈ {20, 40, 80}, 없으면 40.
- 인증 · `X-PaperLab` · Origin 규칙은 1단계 그대로(POST라 `X-PaperLab: 1` 필수).

스트림 시작 **전** 오류(일반 JSON 응답):
| 상태 | `code` | 경우 |
|---|---|---|
| 400 | `bad_seed` | 형식 위반(9.5절), `size` 값 밖, 본문 4KB 초과 |
| 404 | — | `paper_id`가 내 서재에 없음(남의 논문도 404 — 1단계 AC-11과 같음) |
| 429 | `graph_busy` | 이 사용자의 그래프가 이미 만들어지는 중(사용자당 1개) "그래프를 만드는 중이에요. 끝난 뒤 다시 눌러 주세요." |
| 503 | `graph_queue_full` | 서버 전체에서 진행 2개 + 대기 4개가 다 참 "지금 그래프 요청이 많아요. 잠시 후 다시 시도해 주세요." |

### 9.2 SSE 이벤트
```
{"type":"progress","step":"seed","message":"씨앗 논문을 찾는 중","progress":0.05}
{"type":"progress","step":"wait","message":"다른 그래프가 끝나기를 기다리는 중","progress":0.05}
{"type":"progress","step":"references","message":"참고문헌 · 관련 논문 320편","progress":0.3}
{"type":"progress","step":"citing","message":"이 논문을 인용한 논문 100편","progress":0.5}
{"type":"progress","step":"cocitation","message":"함께 인용된 논문을 찾는 중","progress":0.7}
{"type":"progress","step":"finish","message":"초록 · 이전 연구 정보","progress":0.85}
{"type":"progress","step":"compute","message":"유사도 계산","progress":0.95}
{"type":"done","graph":{…9.3절…}}
{"type":"error","code":"seed_not_found|upstream_unavailable|upstream_limited|internal","error":"…"}
```
- 캐시로 다 되면 `progress` 없이 바로 `done`일 수 있음.
- **15초마다 SSE 주석 줄**(`: ping`)을 보내 Funnel 긴 연결이 끊기지 않게(1단계 AC-78 참고 — Funnel 유휴 시간 제한은 **확인 필요**).
- 클라이언트가 끊으면(탭 닫기 · 뒤로 가기) 남은 외부 호출을 멈춤. **이미 받은 것은 캐시에 남음**(다음에 빠름).
- 토큰 검사는 시작할 때만(1단계 6.6절).

### 9.3 `done.graph` 모양
```json
{
  "seed": "W1234567890",
  "size": 40,
  "nodes": [{
    "id": "W1234567890",
    "is_seed": true,
    "relation": ["reference" | "citing" | "related" | "cocited"],
    "score": 0.4123,
    "paper": {"title": "…", "authors": [{"given":"…","family":"…"}], "author_count": 8, "year": 2017,
              "issued": "", "venue": "…", "doi": "…", "arxiv_id": "…", "openalex_id": "W…", "url": "…",
              "pdf_url": "…", "is_oa": true, "cited_by_count": 123456, "reference_count": 40,
              "item_type": "article", "abstract": "…", "source": "openalex"},
    "in_library": 12
  }],
  "edges": [{"source": "W…", "target": "W…", "weight": 0.31, "kind": "coupling", "shared": 9,
             "coupling": 0.31, "cocitation": 0.12, "related": 0.0}],
  "prior": [{"id": "W…", "count": 12, "in_graph": false, "paper": {…}, "in_library": null}],
  "derivative": [{"id": "W…", "count": 9, "in_graph": false, "paper": {…}, "in_library": null}],
  "warnings": [{"code": "weak_citation_data", "message": "…"}],
  "stats": {"candidates": 512, "list_calls": 7, "cache_hits": 0, "elapsed_ms": 6400, "built_on": "2026-10-07"}
}
```
- `paper`는 **지금 `norm_openalex` 출력과 같은 키**(+ `author_count`) → 화면이 기존 `addPaper` · `citeDialog` · `paperProxyTarget` · `scholarUrl`을 **그대로** 씀.
- `relation`: 씨앗과의 관계(씨앗이 인용 · 씨앗을 인용 · OpenAlex 관련 · D 단계에서 들어옴). 여러 개일 수 있음.
- `score`: 씨앗과의 유사도(`sim(seed, w)`). **씨앗 노드는 `null`**(구현 반영 ⑤ — 화면 목록 보기에서 "—").
- `in_library`: 요청한 사용자 서재의 논문 id 또는 null — 지금 `mark_library`(DOI → arXiv → 정규화 제목) 규칙, **사용자 트랜잭션 안에서**. 120편 안팎이므로 한 트랜잭션에서 묶어 처리(개발팀 — 질의 수를 줄이는 방식은 재량).
- `abstract`는 노드 · 이전/이후 연구에만, 최대 1,500자로 잘라 보냄(응답 크기 — 80편이어도 약 150KB 안).
- 응답에 공용 캐시 내부 `id`, 다른 사용자 정보, 원시 오류 문구는 없음.

#### `warnings` 경고 code 목록 (확정 2026-10-07 — 디자인 GD-4 · GD-6, 이름은 [디자인 문서](../design/citation-graph-ui.md) 8.2절과 같음)
- 모양: `{"code": "<아래 이름>", "message": "<서버 한국어 문구>"}`. 같은 code는 한 그래프에 한 번만.
- **화면 처리(GD-4)**: 화면은 **`code`별 문구 · 상자**(디자인 8.2절 표)를 쓰고, **표에 없는 `code`면 서버 `message`를 그대로** 보임. 그래서 서버 `message`도 항상 사람이 읽을 수 있는 한국어 문장이어야 하고(원시 예외 · 주소 · 식별자 금지 — 9.6절), 새 code를 서버에 먼저 추가해도 화면이 깨지지 않음.
- 그래프를 그릴 수 있으면 경고, 그릴 수 없으면 `error` 이벤트(9.2절) — `upstream_limited`는 둘 다에 쓰는 이름.

| `code` | 뜻 (언제 붙나) | 화면 상자(디자인 8.2) |
|---|---|---|
| `partial` | 전체 기한(45초) 또는 호출 상한(12회)에 걸려 남은 단계를 건너뜀(7.3 · 7.5절) | 주황 묶음 |
| `refs_partial` | A · B 단계(참고문헌 · 관련 논문 묶음 조회) 일부 실패 | 주황 묶음 |
| `citing_failed` | C 단계(씨앗을 인용한 논문) 실패 | 주황 묶음 |
| `cocite_failed` | D 단계(함께 인용 `cites:` 묶음) 실패 | 주황 묶음 |
| `abstracts_failed` | E 단계(초록 · 이전 연구 서지) 실패 — 초록 없이 표시 | 주황 묶음 |
| `stale_cache` | 유효 기간이 지난 캐시를 다시 받지 못해 오래된 정보로 그림 | 주황 묶음 |
| **`s2_failed`**(신규) | S2 보강(7.3절, K-7) 호출이 실패 — 연결 오류 · 429 · 5xx(1번 재시도 뒤에도) · 시간 초과. S2 키 유무와 무관. 보강 없이 계속. **S2 404(그 DOI를 모름)는 경고하지 않음**(구현 반영 ⑨) | 주황 묶음 |
| **`upstream_limited`**(경고로 쓸 때 — 신규 확정) | **OpenAlex 하루 사용량 초과**(429 + `X-RateLimit-Remaining: 0`, 7.5절)로 그 뒤 단계를 받지 못해 **캐시에 있던 정보 + 그때까지 받은 것으로만** 그림. 캐시로도 못 그리면 같은 이름의 `error` | 주황 따로 + [설정 열기] |
| `weak_citation_data` | 고른 노드의 선 중 `related`(주제 유사)가 절반 넘음(6.8절) | 파랑 |
| `truncated` | 씨앗 참고문헌이 **300편을 넘어**(`MAX_SEED_REFS`) 앞의 300편만 비교(6.2절, 구현 반영 ⑮ — 정확히 300편이면 띄우지 않음) | 파랑 |
| (`resize_failed`) | **서버가 보내지 않음** — 화면 전용(크기 바꾸기 요청 실패 시 이전 그래프 유지) | 주황 따로 |

- S2 하루 · 초당 한도 초과는 `upstream_limited`가 아니라 **`s2_failed`**(`upstream_limited`는 OpenAlex 전용).

### 9.4 동시성 · 서버 PC 부하 (기획팀 추천 K-11)
- **서버 전체 동시 2개**(세마포어), 대기 최대 4개(대기 중 `wait` 진행 이벤트, 최대 20초 기다리면 `error` `graph_queue_full`), **사용자당 1개**(9.1절 429). 구현은 `graph_build.GraphGate`.
- **시작되지 않은 대기 자리 정리**(구현 반영 ⑬): 요청을 받아 자리(사용자 잠금 · 대기 칸)를 잡았는데 스트림이 **시작되지 않으면**(응답을 읽기 전에 클라이언트가 끊는 등) **30초 뒤 그 자리를 비움** → 같은 사용자가 429 `graph_busy`에 갇히지 않게.
- **같은 씨앗 합치기**(single-flight): 같은 OpenAlex 번호 · 같은 크기 그래프가 이미 만들어지는 중이면 새로 부르지 않고 그 결과를 기다려 받음. 단 `in_library`는 **요청한 사용자마다 따로** 계산(남의 서재 결과가 섞이지 않게 — AC-G24).
  - **합쳐진 동안의 외부 호출은 첫 요청자의 OpenAlex 키로 이어짐**(나중 요청자의 키는 쓰지 않음). 그래서 그 그래프의 남은 호출 사용량은 **첫 요청자의 OpenAlex 계정**에 남음(첫 요청자가 키가 없으면 키 없이). 품질팀 M-2 — **수용**(사용자 3~5명, 그래프 1회 최대 약 $0.0012 — 7.3절. 키를 가진 사람만 손해를 볼 수 있고 금액이 매우 작음). 우리 쪽에는 누가 합쳐졌는지 기록하지 않음.
- CPU: 6.4절처럼 씨앗 대 후보 + 고른 노드끼리만 계산 → 80편 기준 1초 안(가정, AC-G41로 측정). 계산은 SSE 생성기 안 동기 코드(스레드 풀) — 이벤트 루프를 막지 않게 개발팀이 확인.
- DB: 외부 호출 동안 연결 반납(F9). 쓰기는 단계마다 짧은 `system_tx` 하나(최대 6번).
- Funnel 대역폭: 응답 JSON 약 50~200KB, 그래프 1회 1번. 화면 라이브러리는 정적 파일로 한 번 받음.

### 9.5 입력 검증 · SSRF
- 외부 요청 주소는 **코드 상수 두 개**(`https://api.openalex.org`, `https://api.semanticscholar.org/graph/v1`)에서만 만듦. 요청 본문의 어떤 값도 호스트 · 경로 앞부분이 될 수 없음. 리디렉션 따라가지 않음(`follow_redirects=False` — 3xx는 실패로). **예외 하나**: 씨앗 단건 조회의 3xx `Location`이 같은 호스트의 `W` 번호면 그 번호로 1번 다시 조회(합쳐진 작품 — 6.1절 6번). 이때도 `Location` 주소를 그대로 부르지 않고 번호만 뽑아 상수 주소로 다시 만듦.
- 식별자 형식(맞지 않으면 400 `bad_seed`, 그 값은 응답 · 로그에 되풀이하지 않음):
  - `paper_id`: 양의 정수(int64 범위)
  - `openalex_id`: `^W[1-9][0-9]{0,11}$`(앞뒤 공백 · `https://openalex.org/` 접두어는 서버가 벗김)
  - `doi`: 지금 `detect_identifier`처럼 벗긴 뒤(`https://doi.org/` 등) 소문자, `^10\.\d{4,9}/\S{1,250}$`, 제어 문자 · `|` · `,` 금지(OpenAlex 필터 문법과 충돌 — 이런 DOI면 DOI를 쓰지 않고 다음 식별자로)
  - `arxiv_id`: 지금 `detect_identifier`의 arXiv 패턴
  - `title`: 3~300자, 제어 문자 제거
  - 그 밖 키는 무시
  - (구현 반영 ⑫) 위 규칙은 **요청 본문으로 받은 식별자**에 적용(틀리면 400). **서재 씨앗**(`paper_id`)은 서재에 저장된 값 가운데 형식이 틀린 칸만 버리고 나머지로 진행(6.1절)
- 외부 호출에서 DOI · 번호는 **쿼리 매개변수로만**(httpx가 인코딩) 넣고, URL 경로에는 검사를 통과한 `W` 번호만 넣음. S2만 DOI가 경로에 들어감(`/paper/DOI:<doi>/references`): 그 값은 **퍼센트 인코딩**해 넣고(`?` · `#` · `%` · 공백 · 역슬래시 등이 경로 · 쿼리 경계를 바꾸지 못하게), DOI를 `/`로 나눈 조각 가운데 **`.` 또는 `..`인 조각이 있으면 S2 보강을 하지 않음**(요청을 보내지 않고 거부 — 경고 없이 건너뜀). 개정: 처음 안 "`quote(doi, safe="/")`로 `..` 무력화"는 `..` 조각이 경로 정규화로 위 단계로 올라갈 수 있어 **인코딩 + `..` 거부**로 바꿈(개발팀 작업 중 — 이 동작 기준으로 AC-G35).
- **응답 검증**: JSON이 아니면 실패. 작품 `id`가 `^https://openalex\.org/W[0-9]+$`가 아니면 그 작품 버림, `referenced_works` · `related_works`도 같은 형식만. 숫자는 0 이상 정수, 문자열은 8.2절 길이로 자름, `url` · `pdf_url`은 http(s)만. 응답 10MB 초과 = 실패.
- 화면: 제목 · 저자 · 초록은 `textContent` / `esc()`로만 넣음(SVG `<text>` 포함), 링크는 기존 `safeUrl()`.

### 9.6 로그
- 그래프 하나가 끝나면 앱 로그 한 줄: `{"event":"graph","result":"done","ms":…,"list_calls":…,"cache_hits":…,"nodes":…,"warnings":["partial"],"openalex_remaining":…}` — `result`는 결과 code만(`done` · `cancelled` · `db_unavailable` · 오류 code `seed_not_found` · `upstream_unavailable` · `upstream_limited` · `graph_queue_full` · `internal`) — **씨앗 · 번호 · 제목 · 사용자 id 없음**(접근 로그 줄에는 지금처럼 `user_id` · `path=/api/graph`가 남음 — 씨앗은 없음).
- 외부 호출 오류는 `{"event":"upstream_error","host":"api.openalex.org","status":429}`처럼 **호스트 · 상태만**. 예외 문구(주소가 섞일 수 있음)를 로그 · 화면에 그대로 내지 않음.
- `X-RateLimit-Remaining`을 읽어 위 로그에 남김(운영자가 예산을 보게 — 숫자만).

## 10. 화면 (디자인팀: `docs/design/citation-graph-ui.md`에 시안 · 문구 · CSS 클래스 목록을 먼저 쓰고, 개발팀이 그 이름으로 마크업 — 1단계 · 1A와 같은 순서)

### 10.1 진입점 · 경로
| 위치 | 추가 |
|---|---|
| 서재 상세 패널(`library.js`) | 탭 "인용 관계" 맨 위에 **[인용 그래프 보기]** 버튼(기존 목록은 그대로). 상단 버튼 줄에도 넣을지는 디자인 |
| 논문 찾기 결과 카드(`discover.js`) | 행동 줄의 "관련 논문" 뒤에 **[그래프]** 링크(피인용 · 참고문헌 링크와 같은 모양) |
| 그래프 노드 패널 | **[이 논문으로 새 그래프]** |
| 경로 | `#/graph`(만드는 중 · 상태 객체로 씨앗 전달) → 끝나면 `#/graph/W<번호>`. 새로 고침 · 직접 들어오면 `{"seed":{"openalex_id":…}}`로 다시 요청. 사이드바 메뉴 항목은 **만들지 않음**(씨앗 없이 들어갈 일이 없음 — 가정, 디자인 확인) |

### 10.2 화면 구성
- 위 줄: [← 돌아가기](들어온 화면으로) · 씨앗 제목(70자 넘으면 줄임) · 크기 [20 | 40 | 80] · [그래프 | 목록] 전환 · 범례 열기.
- 가운데: 그래프 영역(확대 · 이동 · [+] [−] [맞춤] 버튼).
- 오른쪽 패널(좁은 화면에서는 아래로): 탭 **[논문 정보 | 이전 연구 | 이후 연구]**. 처음에는 씨앗 정보.
- 아래 작은 글씨: "후보 512편 중 40편 · OpenAlex 기준 · 2026-10-07" + 경고(있을 때).

### 10.3 노드 · 선 표현
| 요소 | 규칙 |
|---|---|
| 노드 크기 | **피인용 수의 로그 척도**: 반지름 = `MIN_R + (MAX_R − MIN_R) × ln(1+c) / ln(1+c_max)`(그래프 안 최대값 기준), `MIN_R` 6px · `MAX_R` 28px(가정 — 디자인 조정) |
| 노드 색 | **연도**: 그래프 안 최소~최대 연도를 한 색상 계열로, **최근일수록 진하게**(Connected Papers와 같음). 연도 없음 = 회색. 다크 모드 색은 디자인 |
| 씨앗 | 테두리 고리 + 가운데 고정 |
| 서재에 있는 논문 | 작은 표시(예: 체크 배지) — 디자인 |
| 이름표 | 큰 노드(상위 약 15편)만 "첫 저자 성, 연도"(Connected Papers 식), 나머지는 마우스 · 포커스 때 |
| 선 | 굵기 · 진하기 ∝ `weight`. `kind = related`는 **점선** |
| 강조 | 노드에 마우스 · 키보드 포커스 → 그 노드와 이웃 · 연결선만 진하게, 나머지 흐리게 |
| 범례 | 크기 = 피인용 수, 색 = 연도(최소 · 최대 표시), 선 = 유사도, 점선 = 주제 유사(인용 근거 없음) |

### 10.4 배치 (클라이언트, 힘 기반)
- 선 = 스프링(길이는 `weight`가 클수록 짧게, 세기 ∝ `weight`), 노드끼리 반발, 겹침 방지(반지름 + 여백), 가운데 끌림. 씨앗은 가운데 고정(가정).
- **애니메이션 없이** 정해진 횟수(약 300번) 계산한 뒤 한 번에 그림 → 같은 입력이면 같은 그림(노드를 id 순으로 넣어 시작 위치 고정 — 테스트 재현성). `prefers-reduced-motion`과 무관하게 움직임 없음.
- 그리기는 SVG(노드 80 · 선 약 250개면 충분). 확대 · 이동은 `viewBox`/`transform`.
- 라이브러리는 **K-1**(10.8절).

### 10.5 노드 패널 (논문 정보 탭)
- 제목(원문 링크 — `safeUrl`), 저자(앞 3명 + "외 N명"), 연도 · 학술지, 피인용 N회, 씨앗과의 관계(예: "씨앗이 인용함 · 참고문헌 9편 겹침"), 초록(접기).
- 버튼: **[＋ 서재에 추가]**(지금 `addPaper(paper)`), OA PDF가 있으면 **[PDF 포함 추가]**, **[인용]**(`citeDialog(paper)`), **[인하대에서 보기]**(`paperProxyTarget(paper)`가 있을 때만 — 1A 규칙 · 첫 사용 안내 그대로), **[Google Scholar에서 보기]**(`scholarUrl(title)` 또는 DOI — 1A 9장), **[이 논문으로 새 그래프]**. 서재에 있으면 [✓ 서재에 있음 · 열기](지금 찾기 화면과 같음).
- 바깥 링크는 1A 규칙(새 탭 · `noopener noreferrer`).

### 10.6 진행 · 오류 · 빈 상태
| 상태 | 화면 |
|---|---|
| 만드는 중 | 진행 막대 + 단계 문구(9.2절) + [취소](스트림 끊기). "처음 보는 논문은 10~30초 걸릴 수 있어요" |
| 경고 | 그래프 위 알림 줄 — code 목록 · 처리는 9.3절 표, 문구는 디자인 문서 8.2절(모르는 code면 서버 `message`) |
| `seed_not_found` | "이 논문을 OpenAlex에서 찾지 못했어요." + [Google Scholar에서 보기] |
| 노드 3편 미만 | "연결된 논문을 충분히 찾지 못했어요. OpenAlex에 인용 정보가 적은 논문일 수 있어요." + Scholar 버튼 |
| `upstream_limited` | 7.5절 문구 + [설정 열기] |
| 429 `graph_busy` · 503 | 9.1절 문구 |

### 10.7 접근성
- **[목록] 보기**: 노드를 표로(제목 · 연도 · 피인용 · 씨앗과의 유사도 · 관계) — 유사도 내림차순, 정렬 바꾸기. 같은 패널 동작.
- 노드는 키보드로 이동(Tab · 화살표 — 가까운 이웃 순서는 개발 재량) · Enter로 선택. 노드에 `aria-label`("제목, 연도, 피인용 N회").
- 색만으로 구분하지 않음(범례에 연도 숫자, 점선 · 실선).

### 10.8 렌더링 라이브러리 선택지 (팀장 결정 K-1 — **① 확정** 2026-10-07)
조건: 빌드 없는 ES 모듈, `static/vendor/`에 파일을 넣음(인터넷 CDN 금지), 노드 ≤ 80, 디자인팀이 CSS로 모양을 정할 수 있어야 함, 테스트 가능.

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| ① **d3-force만 + SVG 직접**(기획팀 추천) | `d3-force` 3.0.0(ISC) + 의존 `d3-dispatch` · `d3-quadtree` · `d3-timer` UMD 4파일(합계 수십 KB — 정확한 크기 확인 필요)을 그래프 화면에 들어올 때만 불러 배치 계산만 시키고, 그리기 · 확대 · 이동 · 강조는 우리 코드(SVG) | 검증된 배치 알고리즘, 작음, SVG라 CSS · 접근성 · 다크 모드가 쉬움, 1st My paper 화면 구조와 비슷 | 확대 · 이동을 직접 구현(1st My paper에 선례). UMD 전역 `d3` 사용(ES 모듈 소스는 맨 이름 import라 import map이 필요) |
| ② 직접 구현 | 1st My paper처럼 반발 · 스프링 · 중심력을 직접 | 의존성 0 | 배치 품질 · 수렴 · 겹침 처리를 우리가 책임, 코드 · 테스트 부담 |
| ③ force-graph 1.52.0(MIT) | 캔버스 그리기 + 상호작용 다 들어 있는 한 파일 UMD | 가장 빨리 화면이 나옴 | 의존 15개를 묶은 큰 파일(패키지 6.4MB — 실제 min.js 크기 확인 필요), 캔버스라 CSS 테마 · 접근성(DOM 없음)이 어려움, 모양 고치기 제한 |
| ④ Cytoscape.js 3.34.3(MIT) | ESM 한 파일(`cytoscape.esm.mjs`), 의존성 없음 | 기능 풍부, ES 모듈 그대로 | 파일이 큼(패키지 5.7MB — min.js 크기 확인 필요), 우리에게 필요 없는 그래프 분석 기능이 대부분, 자체 스타일 문법(CSS 아님) |
| ⑤ sigma.js 3.0.3 + graphology | WebGL | 수천 노드도 빠름 | UMD 없음 · 맨 이름 import → **빌드나 import map 필요**, 80노드엔 과함 — **제외 추천** |

벤더 규칙(어느 안이든): npm 공식 배포본을 고치지 않고 넣음, `THIRD_PARTY.md`에 버전 · 라이선스 · SHA-256(supabase-js 줄과 같은 방식), 라이선스 파일 함께.

## 11. 수용 기준

품질팀이 실행합니다. 표시가 없으면 **자동**(pytest — 1단계 10장의 테스트용 Supabase 프로젝트 + 가짜 외부 응답, 12장). **[실환경]** = 운영 서버 PC(공개 주소)에서 실제 OpenAlex로, **[수동]** = 화면을 사람이 확인. 공통 준비: 사용자 A · B(1단계 AC 준비와 같음), A 서재에 씨앗 논문 S(DOI · `openalex_id` 있음)와 그래프에 나올 논문 P 하나.

### A. 알고리즘 (`tests/test_citegraph.py` — DB · 네트워크 없음)
- **AC-G01** 자카드 · `MIN_SHARED`: 겹침 1편이면 그 성분 0, 2편이면 자카드 값. 빈 집합 0.
- **AC-G02** 폴백: 인용 근거(`coupling` 또는 `cocitation` > 0)가 있는 쌍은 `related` 성분이 0이고 `kind`가 인용 쪽. 인용 근거 0 + 서로 관련 지목 → `weight = 0.25`, `kind = related`.
- **AC-G03** 중복 합치기: 같은 정규화 제목의 두 작품(피인용 10 · 100) → 100 쪽 하나만 노드, 참고문헌은 합집합, 지운 쪽 번호를 참고문헌에 가진 다른 작품에서도 같은 노드로 셈. 제목 빈 작품은 풀에 없음. 씨앗과 제목이 같은 작품은 씨앗으로 합쳐지고 씨앗 id는 그대로.
- **AC-G04** 노드 고르기: 고정 픽스처 풀에서 크기 20 · 40 · 80의 노드 id 목록이 기대값과 같음(점수 동률은 번호 오름차순). 씨앗은 항상 포함. 풀이 3편 미만이면 빈 결과.
- **AC-G05** 선: `MIN_SCORE` 미만 없음, 각 노드의 상위 6 규칙대로 남음, 같은 쌍이 두 번 나오지 않음, 자기 자신과의 선 없음.
- **AC-G06** 이전 · 이후 연구: 픽스처에서 `count` · 순서 · 20편 상한 · `count ≥ 2` · `in_graph` 표시가 기대값과 같음.
- **AC-G07** 국문 경고: 고른 노드의 선 중 `related`가 절반 넘으면 `weak_citation_data` 경고.
- **AC-G08** 성능: 풀 620편(픽스처 생성) · 크기 80 계산이 1초 안(CPU 기준값 — 결과 기록).

### B. API · 캐시 (`tests/test_graph_api.py` — 테스트 프로젝트 + 가짜 OpenAlex/S2, `@pytest.mark.db`)
- **AC-G10** A가 `POST /api/graph {"seed":{"paper_id":S}}` → SSE `progress` 1개 이상 → `done.graph`에 씨앗(`is_seed`) · 노드 ≤ 40 · 선 · `prior` · `derivative` · `stats`. 노드 `paper`의 키가 `norm_openalex` 출력 키를 모두 가짐.
- **AC-G11** 호출 예산: 빈 캐시에서 그래프 1회의 가짜 OpenAlex **목록 · 검색 호출 ≤ 12**, 단건 조회 ≤ 2. A~E 단계 호출 모양(필터 · 정렬 · `per_page=100` · `select`에 초록은 E에서만)이 7.3절과 같음.
- **AC-G12** **(PLAN 1B 완료 기준)** A가 씨앗 S로 그래프를 만든 뒤 **B가** 같은 씨앗(찾기 결과 식별자로)으로 요청 → 가짜 외부 서버 호출 **0회**, 노드 · 선이 A의 결과와 같음(`in_library`만 각자).
- **AC-G13** 크기만 바꿔 다시 요청(20 → 80) → 외부 호출 0회.
- **AC-G14** TTL: 가짜 "오늘"을 31일 뒤로 옮기면 서지 · 피인용 목록만 다시 받고 참고문헌 목록(180일)은 다시 받지 않음.
- **AC-G15** 부분 실패: D 단계 호출이 500 → `done`이 오고 `warnings`에 `cocite_failed`, 노드는 있음. A 단계 4번 중 1번 실패 → `refs_partial`. 씨앗 조회 실패 → `error` `upstream_unavailable` 또는 `seed_not_found`. 실패 전에 받은 작품은 캐시에 남음.
- **AC-G16** 기한: 가짜 서버가 응답을 20초 늦추면(시계 주입) 호출 하나는 15초에 끊기고, 전체 45초 기한에서 `partial` 경고와 함께 `done`.
- **AC-G17** 429: `Retry-After: 2` → 1번 재시도. `X-RateLimit-Remaining: 0` 429 → 재시도 없음, 캐시로 못 그리면 `error` `upstream_limited`(7.5절 문구), 캐시로 그릴 수 있으면 `done` + 경고 `upstream_limited`. 모든 경고 `code`가 9.3절 표 안의 이름이고 `message`가 비어 있지 않은 한국어 문장(식별자 · 주소 없음).
- **AC-G18** S2 보강: 씨앗의 OpenAlex `referenced_works`가 비고 DOI가 있으면 가짜 S2 `references` 1회 + OpenAlex `doi:` 필터로 참고문헌을 채움, `citation_edges.source = 's2'`. 사용자 S2 키가 있으면 `x-api-key` 헤더, 없으면 없음. S2가 연결 오류 · 429 · 5xx면 1번 재시도 뒤에도 실패할 때(또는 시간 초과) 건너뛰고 경고 `s2_failed`(`upstream_limited` 아님). S2 404 → 재시도 · 경고 없이 건너뜀(구현 반영 ⑨).
- **AC-G19** 키 · 이메일: 사용자 A가 `openalex_api_key`를 저장했으면 A의 그래프 요청에만 `api_key`가 붙고, B(키 없음)의 요청엔 없음. 사용자 `contact_email`을 설정해 두어도 **그래프 경로의 모든 외부 요청에 `mailto` 매개변수가 없고 User-Agent에 `@`가 없음**. (구현 반영 ⑩ · ⑪) OpenAlex 키는 `api_key` 쿼리로 감. 검색 · 조회 경로에서도 이메일은 Crossref 요청에만 있고 OpenAlex · arXiv · S2 · PDF 받기 요청에는 없음.

### C. 저장 · RLS · 개인정보 (`tests/test_rls.py` 개정 + 신규)
- **AC-G20** 카탈로그(1단계 AC-20 개정): `paperlab`의 모든 표 RLS + force. `external_works` · `citation_edges`는 `user_id` 요구에서 예외이되 ① `authenticated` 정책이 `select` 하나(`using (true)`) ② `authenticated`의 표 권한이 `SELECT`뿐(`has_table_privilege` — insert · update · delete 거짓) ③ 열 이름에 낱말 `user`(`users`) · `ip` · `session` · `email`이 없고 **`_by`로 끝나는 열 이름이 없음**(개정 — 구현 반영 ⑧: `cited_by_count`는 허용. 검사식 `(^|_)(user|users|ip|session|email)(_|$)|_by$`) ④ 시각 열은 모두 `date` 형. 그 밖 표는 지금 AC-20 그대로.
- **AC-G21** DB 직접: `SET LOCAL ROLE authenticated` + B claims로 두 표 `select` 됨, `insert` · `update` · `delete` → 권한 오류. `anon`은 스키마 사용 권한 없음(지금 그대로). `system_tx`(service_role)로 쓰기 됨.
- **AC-G22** 서버 코드 검사: 공용 캐시 표에 쓰는 SQL이 `system_tx(` 안에만 있고 이유 문자열이 고정 문자열 `"citation cache write"`(변수 · f-string 아님). `paperlab/` 안에 `api.openalex.org` · `api.semanticscholar.org` 말고 그래프 경로가 만드는 다른 호스트 없음.
- **AC-G23** 마이그레이션: 빈 테스트 DB에 `paperlab.migrate` 두 번 → 두 번째 할 일 없음. 검사 제약: `doi`가 `10.`으로 시작하지 않는 값 · `relation` 목록 밖 · `references` 배열 501개 → 거부. (1C 추가) `relation = 'cited_by_top_c'`는 배열 100개까지 들어가고 101개는 거부(`tests/test_rls.py` `test_shared_cache_constraints`).
- **AC-G24** 서재 분리: A의 서재에만 P가 있을 때, A의 결과에서 P 노드 `in_library = <A의 id>`, **같은 씨앗을 동시에(합치기 경로로)** 요청한 B의 결과에서는 `null`. B가 `{"seed":{"paper_id": <A의 논문 id>}}` → 404.
- **AC-G25** 서재 추가: 그래프 노드 `paper`로 `POST /api/papers` → 정상 추가, 같은 씨앗 다시 요청 시 그 노드 `in_library`가 새 id.

### D. 로그 · 요청 규칙 · 입력 검증
- **AC-G30** 인증 · 요청 규칙: 토큰 없음 401, `X-PaperLab` 없음 403, 남의 Origin 403(1단계 규칙 그대로 적용됨).
- **AC-G31** 접근 로그에 그래프 요청 `path`가 `/api/graph`뿐(씨앗 식별자가 경로 · 쿼리에 없음). 화면 코드(`graph.js`)가 씨앗을 URL 쿼리로 보내지 않음(코드 검사).
- **AC-G32** 로그 검사: 그래프 테스트 전체 동안 서버 로그(접근 · 앱 · `system_tx`)에 씨앗과 픽스처 작품들의 `W` 번호 · DOI · 제목 문자열이 **한 번도** 나오지 않음. 그래프 완료 로그 줄에 숫자 필드만 있음(9.6절).
- **AC-G33** 그래프가 끝나거나(정상 · 오류 · 클라이언트 끊김) 나면 진행 중 표(합치기 키 · 사용자 잠금)가 비어 있음(내부 상태 검사).
- **AC-G34** 동시성: 같은 사용자의 두 번째 요청 → 429 `graph_busy`. 서로 다른 사용자 7명이 동시에 → 2개 진행 · 4개 대기(`wait` 이벤트) · 1개 503 `graph_queue_full`. 같은 씨앗 두 사용자 동시 → 외부 호출은 한 번분.
- **AC-G35** 입력 검증: `openalex_id` = `W0` · `W12a` · `https://evil.example/W1` · 13자리, `doi` = `10.1/a?b#c` · `10.1/../../x` · 제어 문자 · `|` 포함, `title` 2자 · 301자, `size` 50, `paper_id` = -1 · `"1"`(문자열) · 2^63, 본문 5KB → 각각 400(또는 DOI 금지 문자는 다음 식별자로 넘어가 동작 — 9.5절). 어느 경우에도 가짜 외부 서버가 받은 요청의 호스트가 상수 두 곳 밖이 아니고, 경로에 `..` · `?` · `#`이 생기지 않음. (개정 — S2 경로) 형식 검사를 통과하는 DOI라도 S2 보강 때: `?` · `#` · `%` · 공백 · 역슬래시가 든 DOI는 **퍼센트 인코딩된 채** 경로 한 조각으로만 감(가짜 S2가 받은 경로를 디코딩하기 전 문자열에 `?` · `#`이 없고 쿼리가 바뀌지 않음), `/`로 나눈 조각에 `.` · `..`이 있는 DOI(예: `10.1234/a/../b`)는 **가짜 S2가 요청을 하나도 받지 않음**(경고 없음).
- **AC-G35a** (합쳐진 씨앗 — 6.1절 6번) 가짜 OpenAlex가 `GET /works/W100`에 `301 Location: https://api.openalex.org/works/W200`을 주면 `W200`을 1번 조회하고 `done.graph.seed = "W200"`(서재 씨앗이면 논문 `openalex_id`가 `W200`). `Location`이 다른 호스트(`https://evil.example/works/W200`) · `W` 번호 없음 · 다시 리디렉션이면 따라가지 않고 `seed_not_found`, `Location: javascript:alert(1)`처럼 주소로 해석되지 않는 값이면 `upstream_unavailable` — 어느 경우에도 가짜 서버가 받은 추가 요청 0개. 리디렉션 없이 응답 `id`가 `W200`이어도 씨앗은 `W200`.
- **AC-G36** 응답 검증: 가짜 OpenAlex가 `id: "https://evil.example/W1"` 작품, `url: "javascript:alert(1)"`, 제목 5,000자, 음수 피인용, 11MB 응답을 주면 → 그 작품 버림 · `url` 빈 값 · 제목 1,000자 · 피인용 0 · 그 호출 실패 처리. 리디렉션(302) 응답은 따라가지 않고 실패.

### E. 화면 (`tests/js/graph.test.mjs` — Node, 1A와 같은 방식 + [수동])
- **AC-G50** 순수 함수(`graphmath.js`): 크기 척도(0 · 최대 · 중간값), 연도 색 척도(최소 · 최대 · 연도 없음 = 회색), 이름표 "성, 연도", 이웃 집합, 목록 정렬, 응답 → 화면 모델 변환이 기대값과 같음. 같은 입력 두 번 배치 → 같은 좌표(배치 함수를 Node에서 돌릴 수 있게 분리했을 때 — K-1 ①이면 d3-force UMD를 Node에서 불러 시험).
- **AC-G51** `graph.js`가 제목 · 저자 · 초록을 `innerHTML`에 그대로 넣지 않음(코드 검사 — `esc()` · `textContent`만).
- **AC-G52** 벤더: `THIRD_PARTY.md`에 새 라이브러리 줄(버전 · 라이선스 · SHA-256)이 있고 파일 해시가 같음, 외부 CDN 주소(`https://cdn` · `unpkg` · `jsdelivr`)를 화면 코드가 부르지 않음.

### F. [실환경] (서버 PC · 실제 OpenAlex)
- **AC-G40** 실측 보고: ① `filter=openalex:W…|W…` 묶음 조회와 `filter=cites:W…|W…` OR가 동작하는지 ② 키 없는 하루 예산이 IP 단위인지(응답 헤더 `X-RateLimit-Limit` 값 기록) ③ `select`에 넣은 필드가 다 오는지 — 결과를 이 명세 7장에 반영(안 되면 6.2절 대안).
- **AC-G41** 씨앗 3편(M-G01의 영어 · 국문 · 참고문헌 없는 논문)으로 처음 만들기 걸린 시간 · 목록 호출 수, 같은 씨앗 두 번째(다른 계정) 걸린 시간 · 호출 0을 로그 숫자로 기록. 처음 만들기 30초 안(가정 기준), 두 번째 3초 안.
- **AC-G42** Funnel을 거쳐 SSE가 끝까지 옴(30초 넘게 걸리는 씨앗 포함), 중간에 탭을 닫으면 서버 로그에 그 그래프가 `cancelled`로 끝나고 다음 요청이 바로 됨.
- **AC-G43** `admin cache-stats`가 크기 · 행 수만 출력(번호 · 제목 없음), `cache-prune --max-mb <작은 값>`이 오래된 것부터 지우고 다음 그래프 요청이 정상(다시 받음).

### G. [수동] 화면 확인 (품질팀 · 사용자)
- **M-G01** 씨앗: ① 영어 대표 논문(예: DOI `10.48550/arXiv.1706.03762`) ② DOI 있는 국문 학술지 논문 하나(품질팀이 고름) ③ OpenAlex 참고문헌이 없는 논문 → 각각 그래프가 그려지고, ②는 점선 · 경고, ③은 S2 보강 또는 빈 상태 문구.
- **M-G02** 노드 크기가 피인용 순서와 맞고(가장 큰 원 = 가장 많이 인용), 색이 연도 순서(최근이 진함)이며 범례 숫자와 맞음. 다크 모드에서도 구분됨.
- **M-G03** 비슷한 논문끼리 모여 보임(사람 판단). 이상하면 6.9절 가중치를 바꿔 다시 보고(팀장에게 수치 제안).
- **M-G04** 노드 클릭 → 패널 버튼 6종 동작: 서재 추가(서재에 나타남) · PDF 포함 추가 · 인용 창 · 인하대에서 보기(1A 안내 · 새 탭) · Scholar(새 탭) · 새 그래프.
- **M-G05** 이전 · 이후 연구 탭 항목을 눌러 같은 패널 동작, "그래프 논문 N편이 인용/을 인용" 표시.
- **M-G06** [목록] 보기 · 키보드만으로 노드 선택 · 패널 버튼 사용 가능, 화면 읽기 프로그램에 노드 이름이 읽힘.
- **M-G07** 크기 20 · 40 · 80 전환이 빠르고(캐시), 새로 고침(`#/graph/W…`)해도 같은 그래프.
- **M-G08** 만드는 중 [취소] · 다른 화면으로 이동 → 멈추고, 다시 들어가면 이어서 빠르게 만들어짐(받은 것은 캐시).

## 12. 테스트 방법

- **가짜 외부 서버**: 지금 `tests/test_sources.py`처럼 `httpx.MockTransport`를 `Sources(…, transport=…)`에 주입. 그래프 전용 가짜는 요청을 **기록**(호스트 · 경로 · 매개변수 · 헤더)하고 픽스처 JSON으로 답함 → 호출 수 · 모양 · `mailto` 없음 · 키 헤더를 단언(AC-G11 · 12 · 19 · 35).
- **픽스처**: `tests/fixtures/citegraph/`에 작은 가상 세계(작품 약 60편, 번호 `W100…`, 손으로 만든 참고문헌 · 인용 관계 — 실제 OpenAlex 데이터를 통째로 넣지 않음) + 경계 사례(중복 제목 · 빈 제목 · 국문처럼 참고문헌 없는 작품 · 1,000편 참고문헌). 성능 픽스처는 코드로 생성(AC-G08).
- **시계 · 오늘 날짜 주입**: TTL(AC-G14) · 기한(AC-G16)용으로 `citegraph`/캐시 함수가 `today()` · 시계를 인자로 받게.
- **실제 외부 API는 자동 테스트에서 부르지 않음**(네트워크 차단 단언 — 가짜 전송이 아닌 요청이 나가면 실패). [실환경] AC만 실제.
- **JS**: `tests/js/graph.test.mjs`(Node 내장 `node --test`), pytest 래퍼는 **`tests/test_js_node.py` 하나**(JS 테스트 파일 이름으로 parametrize — 2026-10-08 개정. 처음 구현 반영 ⑭의 따로 둔 `test_graph_js.py`를 합침. Node가 없거나 20.10 미만이면 건너뜀).
- **DB 테스트**는 1단계 규칙(`@pytest.mark.db`, 테스트 프로젝트, 품질팀 실행 시 건너뜀 0). 테스트가 넣은 공용 캐시 행은 **고유 번호 대역**(예: `W9000000000…`)을 쓰고 끝나면 지움(공용 표는 사용자 삭제로 연쇄 삭제되지 않음 — 정리 픽스처 필수).

## 13. 위험

- **OpenAlex 하루 예산(키 없이 $0.10)**: 서버 PC 한 IP를 모든 사용자 · 기능이 나눠 쓰면(확인 필요) 검색(1회 $0.001)이 많은 날 그래프가 막힐 수 있음. 대응: 사용자 키 우선, 캐시, 호출 상한 12, 남은 예산 로그, 필요하면 공용 키(K-5).
- **커버리지 · 정확도**: OpenAlex의 참고문헌 · 인용 연결은 출처마다 빠진 것이 있고 국문 논문은 특히 적음 → 폴백 · 경고 · 5단계 KCI. 그래프는 "탐색 도구"이지 완전한 인용 목록이 아님(화면 안내).
- **공용 예산을 한 사용자가 다 쓸 수 있음 (품질팀 M-9 — 수용 위험)**: 키 없이 쓰는 OpenAlex 하루 예산($0.10 — IP 단위라면 서버 PC 하나를 모두가 나눠 씀, 7.1절)은 사용자별로 나누지 않으므로, 한 사용자가 처음 보는 씨앗으로 그래프를 많이 만들거나 검색을 많이 하면 그날 다른 사용자의 그래프 · 검색이 `upstream_limited`가 될 수 있음. 사용자 3~5명이라 사용자별 할당을 두지 않음. 대응: 사용자당 동시 1개, 캐시, 호출 상한 12, 자기 OpenAlex 키를 넣으면 그 사용자 요청은 자기 예산을 씀, 로그의 `openalex_remaining`으로 관리자가 봄, 잦으면 K-5 ③(공용 서버 키) 재검토.
- **요청을 끊어도 잠시 동시 3개 이상이 돌 수 있음 (품질팀 M-10 — 수용 위험)**: 클라이언트가 끊으면 자리(동시 2)는 곧 비지만, 이미 나간 외부 호출 · 계산은 끝날 때까지(호출 하나 최대 15초) 백그라운드에서 마저 돌 수 있어, 그 사이 새 그래프가 시작되면 **일시적으로 3개 이상**이 동시에 돎. 서버 PC CPU · OpenAlex 초당 한도(서버 전체 초당 10회 토큰 버킷 — 7.5절)에는 여유가 커서 수용. 받은 결과는 캐시에 남아 낭비가 아님.
- **캐시가 늘면 같은 씨앗의 그래프가 조금 달라짐(구현 반영 ① — 수용)**: D 단계를 캐시의 "대상 작품을 인용한 작품"으로 계산하므로, 다른 그래프가 캐시에 넣은 인용 작품이 풀에 들어올 수 있음. 같은 캐시 상태에서는 결과가 같음(AC-G12). 대가로 처음 사용자와 두 번째 사용자가 같은 결과를 받고 외부 호출이 0회가 됨.
- **후보 범위가 작음**: Connected Papers(약 5만 편 분석)보다 훨씬 작은 수백 편 → 공동 인용이 약함(6.3절). 실측(M-G03) 후 수치 조정.
- **공용 캐시가 드러내는 것**: 캐시에 어떤 작품이 있는지 = "누군가 이 주변을 봤다"(누구인지는 없음). 사용자 결정(공용 캐시 허용)으로 수용. DB 직접 접근은 관리자뿐, 목록 API 없음.
  - (1C 추가 — 품질팀 I-1, **해결**: 사용자 결정 "흔적 구분 못 하게", 2026-10-08) `cited_by_top_c`를 추천만 쓰면 그 행 = "이 작품이 누군가의 원고에 인용됐다" + 날짜가 되어, 사용자 3~5명이면 관리자가 누구인지 짐작하기 쉬움. 그래서 **그래프도 C를 받으면 `cited_by_top_c`를 씀**(8.3절) → 이 행은 "그래프나 추천이 이 작품의 C를 받았다"는 뜻만 남음(위 "누군가 이 주변을 봤다"와 같은 수준). 1C 명세 9.8절 6번 · 14장.
  - (남는 신호 — 수용 위험, 팀장 결정 2026-10-08) "`cited_by_top_c`만 있고 `cited_by_top`은 없음" = "추천이 쓰였거나, 그래프가 D 전에 끊겼다"는 약한 신호(관리자만 봄). 막으려면 추천도 D를 받아야 해 씨앗마다 외부 호출이 2회 늘어 막지 않음. 30일이 지나도 행은 남음(캐시로 안 쓰일 뿐 — `cache-prune` · 다시 받기 때 정리). 사용자에게는 팀장이 마무리 보고에서 알림.
- **DB 용량**: 그래프당 최대 약 0.7MB → 상한 150MB · 정리 명령(8.5절).
- **외부 데이터 오염**: 이상한 응답(긴 제목 · 위험한 URL) → 응답 검증(9.5절), 화면 이스케이프.
- **서버 PC 부하 · Funnel 긴 연결**: 동시 2개 · 대기 4개, ping, 탭 닫으면 중단.
- **사용자 키의 외부 기록**: 사용자 OpenAlex 키로 받으면 OpenAlex에는 그 키 사용량으로 남음(우리 쪽 기록 아님) — 설정 안내.

## 14. 미정 사항 · 질문

### 14.1 사용자에게 물을 것 (취향 · 개인정보 선택만) — **결정됨 2026-10-07**
| # | 질문 | 선택지 | 기획팀 추천 | 결정 |
|---|---|---|---|---|
| **U-1** | 내가 만든 그래프를 **계정에 기록(최근 그래프 목록)** 해 둘까요? | ① 남기지 않음 — 매번 다시 그림(캐시라 보통 몇 초) ② 내 계정에만 최근 10개 씨앗 목록(나만 보임 — 개인 데이터 표 · RLS) | **① 남기지 않음**. "누가 무엇을 조회했는지 남기지 않는다"는 결정의 취지에 가장 가깝고, 캐시 덕분에 다시 그리는 비용이 작음 | **① 확정(사용자 결정)** — 그래프는 계정에 기록하지 않고 매번 다시 그림 |

(그 밖 — 크기 · 색 · 화면 위치 · 수치 — 는 화면에서 바꿀 수 있거나 기술 판단이라 팀장 결정으로 둡니다. 공용 OpenAlex 키가 필요해지면 그때 사용자에게 "무료 키 발급"을 요청합니다 — K-5.)

### 14.2 팀장 결정 (기획팀 추천안 포함) — **K-1~K-16 모두 추천안으로 확정(2026-10-07)**
| # | 결정할 것 | 선택지 | 기획팀 추천 |
|---|---|---|---|
| **K-1** | 그래프 그리기 라이브러리 | 10.8절 ①~⑤ | **① d3-force(+3개 의존) UMD를 그래프 화면에서만 불러 배치 계산, SVG · 확대 · 이동은 직접** |
| **K-2** | 진행 표시 방식 | ① 요청 안 SSE ② 백그라운드 스레드 + 폴링(`GET /api/graph/builds/{id}`) | **① SSE** — 요약 · 대화와 같은 방식, 그래프는 수십 초 안에 끝나고 받은 것은 캐시에 남아 탭을 닫아도 손해가 작음. ②는 작업 상태 저장 · 소유자 검사 · 정리가 늘어남 |
| **K-3** | 캐시 표 구조 | ① 인접 목록(작품 × 관계 = 행 하나, `bigint[]`) ② 인용 하나 = 행 하나 + 빈 작품 행 | **①** — 그래프당 최대 약 0.7MB vs 약 4MB(무료 500MB), ID 체계 하나(OpenAlex 번호). 단점: "누가 x를 인용" 역방향 질의가 어려움(1B 알고리즘엔 불필요, 5단계에서 필요하면 색인 · 표 추가) |
| **K-4** | 표 위치 · 이름 | ① `paperlab` 스키마 + PLAN 이름 ② 별도 스키마(`paperlab_shared`) ③ `shared_` 접두어 | **①** — Data API 비노출이 그대로 적용, 마이그레이션 · 권한 · 백업 경로가 하나. AC-20 검사에 예외 + 별도 검사(AC-G20) |
| **K-5** | OpenAlex 키 | ① 요청한 사용자 키 → 없으면 키 없이 ② 공용 서버 키(새 환경 변수 `OPENALEX_API_KEY`) ③ 둘 다(사용자 키 → 서버 키 → 없이) | **①로 시작**, 운영 중 `upstream_limited`가 잦으면 ③(새 변수는 "변수 이름 고정" 원칙의 예외라 그때 팀장 결정 + 사용자에게 키 발급 요청) |
| **K-6** | 기존 검색 · 조회의 OpenAlex `mailto`(사용자 `contact_email`) | ① 1B에서 함께 없앰 ② 그대로 | **①** — OpenAlex가 2026-02부터 무시(공식), 사용자 이메일만 외부로 나감. **확대(구현 반영 ⑪, 팀장 승인)**: 사용자 이메일은 **Crossref에만**, arXiv · S2 · 주소에서 PDF 받기에서도 뺌(7.4절) |
| **K-7** | Semantic Scholar 보강 | ① 씨앗 참고문헌 0편 + DOI 있을 때만 S2 1회 ② 쓰지 않음 ③ 항상 S2도 함께 | **①** — 비용 · 429 위험 작고, 참고문헌 없는 씨앗에서 그래프가 텅 비는 것을 줄임 |
| **K-8** | 그래프 크기 | 기본 40, 선택 20 · 40 · 80 / 기본 60(1st My paper) / 선택 없이 고정 | **기본 40 + 화면 선택 20 · 40 · 80**(외부 호출 없이 바뀜) |
| **K-9** | 유사도 · 수치 | 6.9절 표(1st My paper 실측값) | **6.9절 그대로 시작**, M-G03 실측 후 개발팀이 조정안 보고 |
| **K-10** | TTL · 시각 단위 | 7.6절 표, 날짜 단위 | **7.6절 그대로** |
| **K-11** | 동시성 | 전체 2 · 대기 4 · 사용자당 1 · 같은 씨앗 합치기 | **그대로** |
| **K-12** | 화면 위치 | ① 별도 화면 `#/graph`(서재 상세 · 찾기 카드에서 진입) ② 서재 상세 패널 안 작은 그래프 ③ 사이드바 메뉴 추가 | **①** — 그래프는 넓은 화면이 필요, 사이드바 메뉴는 씨앗 없이 들어갈 일이 없어 만들지 않음 |
| **K-13** | 캐시 크기 관리 | ① 상한 150MB + 관리 명령(수동) ② 서버가 매일 자동 정리 | **①** — 정리는 드물게 필요, 백업 작업처럼 스케줄러에 넣는 것은 운영 중 필요해지면 |
| **K-14** | OpenCitations | 1B에 포함 / 5단계 | **5단계**(PLAN 5단계 범위와 함께 — 느리고(1st My paper "3초+") 1B 알고리즘에 필수 아님) |
| **K-15** | 초록 저장 | ① 화면에 나온 작품만 ② 전부 ③ 저장 안 함(클릭 때 받기) | **①** — 용량과 클릭 속도의 균형 |
| **K-16** | 국문 등 인용 정보가 적을 때 | ① 관련 논문 폴백(점선 · 경고) ② 폴백 없이 빈 그래프 | **①**(1st My paper 실측 근거) |

### 14.3 확인 필요 (개발팀이 첫 작업 때 실측 — AC-G40)
- OpenAlex 묶음 조회 필터 이름(`openalex:` vs `ids.openalex` vs `openalex_id:`)과 `cites:` OR 동작
- 키 없는 예산이 IP 단위인지, `select`에 `referenced_works_count` 등이 되는지
- Funnel 유휴 시간 제한(SSE ping 15초로 충분한지)
- d3-force 등 후보 파일의 실제 크기(K-1 표 보완)
- Crossref polite pool(`mailto`) 현행 여부(K-6 범위 밖 확인)

### 14.4 결정 기록 (2026-10-07)
| 항목 | 결정 | 구분 |
|---|---|---|
| U-1 | ① 그래프를 계정에 기록하지 않음 — 매번 다시 그림 | 사용자 결정 |
| K-1 | d3-force + 의존 패키지(`d3-dispatch` · `d3-quadtree` · `d3-timer`) UMD를 **그래프 화면에서만** 불러 배치 계산, SVG 그리기 · 확대 · 이동 · 강조는 직접 | 팀장 결정(추천안) |
| K-2~K-16 | 14.2절 기획팀 추천안 그대로(SSE · 배열 인접 목록 · `paperlab` 스키마 PLAN 이름 · 사용자 OpenAlex 키 → 없으면 키 없이 · 기존 OpenAlex `mailto` 제거 · S2 조건부 1회 · 크기 40(20/40/80) · 6.9절 수치 · 7.6절 TTL 날짜 단위 · 동시 2/대기 4/사용자당 1 · 별도 화면 `#/graph` · 캐시 150MB 수동 정리 · OpenCitations 5단계 · 초록은 화면에 나온 작품만 · 국문 관련 논문 폴백) | 팀장 결정(추천안) |
| GD-4 · GD-6(디자인) | 경고 `code` 목록 확정(9.3절 표): 신규 `s2_failed` · 경고용 `upstream_limited`. 화면은 code별 문구, 모르는 code면 서버 `message` | 팀장 요청 |
| 문서 반영 | PLAN.md(머리말 · 2장 · 6장 1B · 10장 P16), phase1-cloud.md(2장 · 5.9절 · AC-20), 서버 PC 안내서 주간 점검(`cache-stats`) — 같은 날 반영. FEATURES.md는 구현 승인 뒤 | 팀장 지시 |
| Q-1 (2026-10-08, 1C 구현 중) | 추천이 남기는 "C만 끝난 피인용 목록"은 **정식 관계 이름 `cited_by_top_c` + 마이그레이션 `…000003`**(검사 제약만 교체). 쓰지 않는 `cited_by_recent`를 이 뜻으로 재사용하지 않음. TTL 30일 · 상한 100, 그래프는 `cited_by_top`이 없을 때 이 목록을 C로 다시 쓰고 D만 받음(7.6 · 8.3 · 8.4 · 8.7절) | 팀장 결정 |
| I-1 (2026-10-08, 품질팀 정보) | **흔적 구분 못 하게**: 그래프도 C를 새로 받으면 `cited_by_top_c`를 씀 → 이 행으로 그래프와 추천(원고 인용)을 구분할 수 없게(8.3절 · 13장) | 사용자 결정 |

## 15. 팀별 작업 (파일 단위 — 같은 파일을 동시에 고치지 않음)

### 디자인팀 (먼저)
| 파일 | 작업 |
|---|---|
| `docs/design/citation-graph-ui.md`(신규) | 그래프 화면 시안 · 문구 · CSS 클래스 이름 목록(10장), 진입 버튼 위치, 노드 크기 · 연도 색 계열(밝은 · 다크), 범례, 경고 · 빈 상태 문구, 목록 보기, 설정 창 OpenAlex 키 칸 안내 한 줄(7.4절) |
| `paperlab/static/css/app.css` | 그래프 화면 스타일(디자인 문서의 클래스) |

### 개발팀
| 파일 | 작업 |
|---|---|
| `supabase/migrations/20261008000002_citation_cache.sql`(신규) | 8.2~8.4절(GIN 색인 포함) |
| `paperlab/citegraph.py`(신규) | 6장 순수 알고리즘(풀 · 중복 합치기 · 유사도 · 고르기 · 선 · 이전/이후 연구 · 경고), 6.9절 상수 |
| `paperlab/graph_build.py`(신규 — 구현에서 추가, 팀장 승인) | 그래프 만들기 흐름(씨앗 해석 · 입력 검증 → S2 보강 → A~E 단계 → 계산), 단계마다 캐시 쓰기, 45초 기한 · 호출 예산 · 취소, 경고 · 오류 code와 서버 문구(9.3절), `GraphGate`(동시 2 · 대기 4 · 사용자당 1 · 시작 안 된 자리 30초 정리)와 `Flights`(같은 씨앗 합치기) — `server.py`가 씀 |
| `paperlab/citecache.py`(신규) | 캐시 읽기(사용자 트랜잭션 연결을 받음) · 쓰기(`system_tx("citation cache write")`), TTL 판단(오늘 날짜 주입), D 단계용 "대상 작품들을 인용한 작품" 찾기(GIN 색인 — 8.3절), 빈 행(8.2절) |
| `paperlab/sources.py` | 그래프용 OpenAlex 호출(묶음 · `cites:` OR · `select` · 키 · `mailto` 없음 · 응답 검증 · 10MB 상한 · 리디렉션 안 따라감 · 호스트/상태만 오류), S2 참고문헌 1회, 속도 제한(OpenAlex 초당 10 · S2 초당 1). K-6 채택 시 기존 OpenAlex `mailto` 제거 |
| `paperlab/server.py` | `POST /api/graph`(SSE · 9장), 동시성 · 합치기 · 사용자 잠금, 서재 일치(`mark_library` 묶음), 로그(9.6절) |
| `paperlab/db.py` | 공용 캐시 질의 도우미(필요하면 — 연결은 기존 도우미로만, 1단계 AC-13) |
| `paperlab/admin.py` | `cache-stats` · `cache-prune`(8.5절) |
| `paperlab/static/js/graphmath.js`(신규) | DOM 없는 순수 함수(척도 · 색 · 이름표 · 이웃 · 목록 · 모델 변환, 가능하면 배치 호출) |
| `paperlab/static/js/graph.js`(신규) | 그래프 화면(SSE · 진행 · SVG · 확대/이동 · 패널 · 탭 · 목록 · 접근성), 라이브러리 지연 로드 |
| `paperlab/static/js/app.js` | `#/graph` · `#/graph/W…` 경로 |
| `paperlab/static/js/library.js` | 상세 패널 [인용 그래프 보기] |
| `paperlab/static/js/discover.js` | 결과 카드 [그래프] |
| `paperlab/static/vendor/<라이브러리>/` · `vendor/THIRD_PARTY.md` | K-1 결과 파일 · 라이선스 · SHA-256 |
| `tests/test_citegraph.py`(신규) · `tests/test_graph_api.py`(신규) · `tests/test_rls.py`(AC-20 → AC-G20 개정) · `tests/fixtures/citegraph/`(신규) · `tests/js/graph.test.mjs`(신규) · `tests/test_js_node.py`(JS pytest 래퍼 — 모든 `tests/js/*.test.mjs` 공용, 2026-10-08 합침) | 11 · 12장 |

### 기획팀 (팀장 결정 뒤)
| 파일 | 작업 |
|---|---|
| `docs/specs/citation-graph.md` | ~~U-1 · K-1~K-16 결정~~ **반영함(2026-10-07)**, AC-G40 실측 결과 반영(구현 뒤) |
| `PLAN.md` | **반영함(2026-10-07)**: 머리말 "1B단계 기능 명세" 링크, 6장 1B 절, 10장 P16 |
| `docs/specs/phase1-cloud.md` | **반영함(2026-10-07)**: 2장 "공용 표" 문구 · 5.9절 · AC-20에 1B 공용 캐시 예외 |
| `deploy/server-pc/README.md` | **반영함(2026-10-07)**: 주간 점검 표에 `cache-stats` 한 줄(다른 절은 건드리지 않음) |
| `FEATURES.md` | **반영함(2026-10-07, 구현 승인 뒤)**: 3장 "인용 그래프" 절, 설정 · 외부로 나가는 데이터 · 단축키 · 개발자 장 |

### 품질팀
- 11장 AC 전부(자동 · [실환경] · [수동]), 결과 보고에 AC-G40 · 41 실측값.

## 16. 확인 근거 (2026-10-07, 웹 문서)

- OpenAlex 인증 · 한도(키 없이/있음 10배, 초당 100회, 자정 UTC 초기화, `per_page` 100, OR 100값, 응답 헤더 이름, 키 전달 방식): [help.openalex.org — Authentication](https://help.openalex.org/api-reference/authentication) (구 주소 developers.openalex.org에서 이동), [help.openalex.org — Authentication(가이드)](https://help.openalex.org/api/authentication/)
- OpenAlex 가격(무료 하루 $1, 키 없이 $0.10, 단건 무료 · 목록 1,000회 $0.10 · 검색 1,000회 $1 · 내려받기 1,000회 $10): [Pricing](https://help.openalex.org/access/pricing/), [Example costs](https://help.openalex.org/access/example-costs/)
- OpenAlex polite pool · `mailto` 폐지(2026년 2월 이전에만 있었음, 지금은 무시): [Deprecations](https://help.openalex.org/api/deprecations/)
- OpenAlex OR 필터(한 필터 안 최대 100값, 필터 사이 OR 불가): [Filtering](https://help.openalex.org/api/filtering/)
- OpenAlex `related_works` · `referenced_works` · `cited_by_count` 정의: [Work attributes](https://help.openalex.org/data/works/attributes/)
- Semantic Scholar 한도(비인증 사용자 전체가 초당 1,000회 공유 · 붐비면 추가 제한, 키 초당 1회): [Semantic Scholar API](https://www.semanticscholar.org/product/api)
- Semantic Scholar 묶음 500 id · 10MB, references/citations `limit` 최대 1,000, id 접두어: [Graph API OpenAPI 정의](https://api.semanticscholar.org/graph/v1/swagger.json)
- Connected Papers 방식(약 5만 편 분석 후 가장 강하게 연결된 몇십 편, 공동 인용 + 서지 결합 유사도, 힘 기반 배치, 크기 = 피인용 · 색 = 연도, 인용 트리가 아님): [Connected Papers — About](https://www.connectedpapers.com/about), [LMU 도서관 안내](https://libguides.lmu.edu/AIresearchtools/CP)(Semantic Scholar 말뭉치 사용, 진한 색 = 최근)
- Prior / Derivative works 정의(그래프 논문들이 공통으로 인용한 기초 문헌 / 그래프 논문들을 공통으로 인용하는 이후 연구 · 리뷰): [CASRAI — Connected Papers 안내](https://www.casrai.org/guides/connected-papers)
- 렌더링 후보 패키지 정보(버전 · 라이선스 · 의존성 · 배포 파일): npm 레지스트리 [d3-force](https://registry.npmjs.org/d3-force/latest) · [force-graph](https://registry.npmjs.org/force-graph/latest) · [cytoscape](https://registry.npmjs.org/cytoscape/latest) · [sigma](https://registry.npmjs.org/sigma/latest)
- 1st My paper 참고(로컬, 고치지 않음): `논문 작성 프로그램\프로그램\work\backend\graph\builder.py` · `coupling.py` · `similarity.py`, `work\backend\external\openalex.py`, `work\config\external.json`(`graph` 절 · `_related_note` 실측), `work\frontend\js\features\graph.js`(D3 없이 SVG + 직접 힘 계산)
