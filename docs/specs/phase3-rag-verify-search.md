# 기능 명세 — 3단계 여러 논문 RAG 질문(①) · 인용 검증(⑦) · AI로 찾기(⑨)

- 작성: 기획팀 · 2026-10-08 (브랜치 `claude/paper-program-hrrhl2`, HEAD 8313733 기준)
- 개정: 2026-10-08 — 사용자 결정 **U-1 = D안**(서버 PC 무료 모델 EmbeddingGemma + PGroonga), **U-2 변경 = 벡터를 Supabase(pgvector)에 넣지 않고 Cloudflare R2 파일 + 서버 메모리에 둠**(Supabase 무료 유지). 팀장 K-1~K-15 확정(R2 방식으로 바뀐 K-5 · K-6 고침), 새 팀장 결정 K-16~K-21도 추천안대로 확정(2026-10-08).
- 상태: **개발 착수 가능 — 사용자 U-1 · U-2, 팀장 K-1~K-21 모두 확정(2026-10-08)**
- 근거: [PLAN.md](../../PLAN.md) 2장 · 3장 ①⑦⑨ · 6장 3단계, [1단계 명세](phase1-cloud.md) 5장(RLS · PGroonga · `chat_sessions`) · 7장(R2 키 규칙), [2단계 명세](phase2-worker-electron.md) 5 · 6 · 9 · 15장(작업 큐 · 라우팅 · API 실행기), [1B 명세](citation-graph.md) 7 · 8장(외부 호출 예산 · 조회 기록 없음), [1C 명세](writing-reference-pane.md)(참고 패널)
- 원칙: **ponytail(사용자 결정)** — 기존 모듈을 다시 쓰고, 꼭 필요하지 않은 것은 "안 하는 것"으로 뺍니다. 수치는 코드 상수 한 곳에 두는 **가정값**입니다.
- 표기: **확정** = 사용자 결정, **K-n** = 팀장 결정, **확인 필요** = 개발팀이 첫 주에 실측

---

## 1. 목적

| 기능 | 사용자가 얻는 것 |
|---|---|
| ① 여러 논문 RAG 질문 | 서재 전체 · 컬렉션 · 폴더를 범위로 질문하면, 답의 문장마다 출처 번호가 붙고 누르면 **그 논문의 그 쪽 · 그 위치**가 열립니다. 새 PDF는 올리면 자동으로 색인됩니다. |
| ⑦ 인용 검증 | 원고에서 `[@키]`가 붙은 문장이 그 논문 원문에 근거가 있는지 확인하고, **근거 없음 · 약함**인 문장을 원고 화면에 표시합니다. |
| ⑨ AI로 찾기 | 자연어 질문 하나로 OpenAlex · Semantic Scholar를 여러 검색어로 찾아, **출처 번호가 달린 한국어 요약**과 출처 논문 카드(서재 추가 · 인용 · 인하대에서 보기 · Scholar)를 받습니다. |

## 2. 확정된 결정과 원칙

| 항목 | 내용 | 근거 |
|---|---|---|
| 임베딩 방식 | **D안: 서버 PC 무료 로컬 모델(EmbeddingGemma-300M) + PGroonga 낱말 검색** | **확정 U-1**(2026-10-08) |
| 벡터 저장 | **Supabase DB에 넣지 않음.** 논문마다 벡터 파일 하나를 **R2**(`users/{uid}/rag/…`)에, 검색 때 **서버 메모리**(numpy)에 올림. pgvector 안 씀 | **확정 U-2**(2026-10-08) — Supabase 무료 유지 |
| 낱말 검색 | 1단계 `page_texts` + PGroonga 색인 그대로 | U-1 |
| 개인 데이터 경계 | DB는 RLS(본인 행만). **벡터 파일 · 메모리는 RLS가 없으므로 서버 코드가 사용자 경계를 지킴**(9장) | U-2, PLAN 4장 "R2에는 RLS가 없으므로 서버가 키를 JWT의 `user_id`로만" |
| AI 엔진 | **API 키 우선 → CLI 워커 폴백**, 작업 큐(`jobs`) 위에서 실행 | PLAN 2 · 5장 |
| PC가 꺼져도 동작 | 임베딩(색인 · 질문)은 서버 PC 안에서 끝남 — 사용자 PC 무관 | PLAN 1장 |
| ⑨ 답변 언어 | **항상 한국어** | 사용자 결정 2026-10-07 |
| ⑨ 근거 | 검색된 논문의 서지 · 초록뿐. 출처 없는 문장 · 목록에 없는 번호를 내보내지 않음 | PLAN 6장 3단계 |
| 조회 기록 | **누가 무엇을 조회했는지 남기지 않음** — 로그 · 공용 표에 질문 · 검색어 · 제목 없음 | PLAN 2장, 1B 명세 8.6절 |

## 3. 범위

### 하는 것
1. **색인**: PDF → 쪽 안에서만 자른 조각(쪽 · 본문 위치 · 좌표) → 임베딩 → **R2 벡터 파일**. 작업 큐의 새 종류 `index`. 업로드 · PDF 교체 때 자동, 기존 논문은 처음 쓸 때 한꺼번에(10장).
2. **벡터 캐시**: 서버 프로세스 메모리에 사용자별 행렬을 지연 로드, 상한 · LRU · 유휴 내림(9장).
3. **질문(①)**: 새 화면 `#/ask`의 "내 서재" 탭 — 범위(서재 전체 / 컬렉션 / 폴더), 벡터(메모리) + PGroonga(DB) 혼합 검색, 출처 번호 달린 답, 출처 → 읽기 화면의 그 쪽 · 위치. 범위별 대화 저장. **"현재 논문" 범위는 지금 읽기 화면의 대화 탭 그대로**(K-8).
4. **인용 검증(⑦)**: 쓰기 화면 [인용 검증] — 직접 인용은 문자열 대조(무료), 간접 인용은 근거 조각 3개와 함께 AI 일괄 판정 → "이 원고의 인용" 목록과 미리보기에 표시.
5. **AI로 찾기(⑨)**: `#/ask`의 "논문 찾기" 탭 — 검색어 생성(AI) → OpenAlex · S2 검색 → 중복 제거 → 임베딩 유사도로 8편 → 출처 번호 달린 한국어 요약(AI) → 결과 카드(지금 논문 찾기 카드 재사용).
6. 작업별 엔진 설정에 `find`(AI로 찾기) · `verify`(인용 검증) 두 줄. 서재 질문은 지금 `chat` 설정을 그대로 씀.

### 안 하는 것 (범위 밖)
| 항목 | 이유 · 나중에 넣을 때 |
|---|---|
| pgvector · DB 안 벡터 · 벡터 색인(HNSW) | U-2. 메모리 정확 검색으로 충분(K-6) |
| 서버 PC 디스크 캐시(벡터 파일 사본) | 서버 PC에는 데이터를 두지 않음(PLAN 2장). 재시작 뒤 R2에서 다시 받음(9.4절) |
| 사용자당 묶음 파일(논문 여러 편을 파일 하나로) | 논문별 파일이 무효화가 단순. 로드가 느리다고 실측되면 검토 |
| 그림 · 표 · 수식 이미지 임베딩, 스캔 PDF OCR | 본문 글자만. 스캔본은 "본문 없음" |
| 섹션 인지 청킹 · 조각 겹침 · 참고문헌 분리(1st My paper `chunker.py`) | 쪽 안 문단 묶음으로 충분 |
| AI · 교차 인코더 재정렬, 질문 재작성(RAG) | RRF만(K-7) |
| 컬렉션 하위 컬렉션 포함 범위 | 서재 목록과 같은 집합(직속만) |
| ⑨ 결과 저장 · 기록, 연도 · 분야 필터, 본문 기반 요약, KCI · RISS(5단계), 공용 캐시 읽기 · 쓰기 | K-11 · K-12 · PLAN 5단계 |
| 인용 검증 자동 실행, 편집기(textarea) 안 글자 강조, 워드 · 한글 업로드 문서 검증, 문서 단위 경고 | 버튼으로만, 표시는 목록 + 미리보기 |
| 사용자 PC 워커에서 임베딩 | PC가 꺼지면 질문도 못 함(6장 E안 기각) |
| 서버 프로세스 여러 개 | 1단계 9장대로 한 프로세스 전제. 늘리면 캐시 무효화를 다시 설계(9.5절) |

## 4. 지금 코드와 재사용

| 필요한 것 | 재사용 | 바뀌는 점 |
|---|---|---|
| 쪽별 본문 · 한국어 전문 검색 | `page_texts` + PGroonga 색인(1단계) | 그대로. 조각은 이 글의 **위치(오프셋)만** 가짐(K-5) |
| 벡터 파일 저장 | `storage.Storage` · `UserStorage`(키 fullmatch 검사, `put` · `get` · `delete_quietly`) | 키 규칙 `users/{uid}/rag/…` 하나 추가(8.1절) |
| 고아 파일 정리 | `admin orphans` | `rag/` 키도 대상으로 |
| PDF 글자 블록 · 좌표 | `pdf.py`(PyMuPDF) | `get_text("blocks")` 한 함수 추가 |
| 색인 실행 | `jobs` 표 + `api_runner.ApiRunner`(복구 스캔 · 리스) | 새 종류 `index`, 엔진 `local` |
| 질문 실행(API SSE · CLI 폴백) | `server.stream_job` · `jobs.text_request` · `cli_task` · `_apply`(chat) | 범위용 프롬프트, 출처 목록을 `params.sources`에 고정 |
| AI 호출 | `ai.AIService` — Anthropic 스트림(`write` 경로), OpenAI · Google `text_complete` | `write`의 스트림 경로를 범용 함수로 꺼냄 |
| `[n]` 출처 → 목록 | `ai.cli_citations`(쪽 `[p.N]`) | 번호 `[n]` 판 하나 추가 |
| 쪽 이동 · 글 반짝임 | `reader.goToPage(n, text)` · `flashText` · `#/read/{id}/p{쪽}` | 좌표(사각형)로 스크롤 + 표시 추가 |
| 인용 표시 해석 | `compose.CITE_RE` · `parse_citation`, `db.papers_by_citekeys` | 그대로 |
| 근거 쪽 열기 | 1C `refpane.js` · `reader.embedPdf(page)` | 그대로 호출 |
| 외부 검색 · 중복 판별 | `sources.Sources.search`, `db.normalize_doi` · `normalize_title` | 그대로 |
| 결과 카드 | `discover.js` 결과 카드, `extlinks.js` | 카드 함수 export |

---

## 5. 사용 흐름 · 화면 위치 (K-3)

**새 화면 `#/ask` "AI 질문"**(사이드바 항목 하나). 탭 두 개가 같은 "출처 번호 달린 답 + 출처 목록" 모양을 씀.

```
[내 서재] [논문 찾기]
─ 내 서재 ─────────────────────────────────────
범위: (서재 전체 ▾ / 컬렉션 ▾ / 폴더 ▾)   "이 범위 32편 중 30편 색인됨 · 2편 색인 중"
대화(저장됨) … 답 본문의 [1][2] → 아래 출처 카드로
출처 카드: [1] 제목 · 연도 · p.5 · 조각 앞부분  → 누르면 #/read/{id}/p5 + 그 위치 표시
─ 논문 찾기 ───────────────────────────────────
질문 입력 → 진행("검색어 만드는 중 → 검색 중 → 고르는 중 → 요약 쓰는 중")
"초록 기반 요약이에요. 원문과 다를 수 있어요." + 쓴 검색어(칩) + 경고
요약 [1][2] … → 출처 카드 = 논문 찾기 결과 카드(서재 추가 · 인용 · 인하대에서 보기 · Scholar · 그래프)
```

- 들어가는 곳: 사이드바 "AI 질문", 서재에서 컬렉션 · 폴더를 고른 상태면 그 범위(`#/ask/c{id}` · `#/ask/f{id}`), 논문 찾기 화면 [AI로 찾기](입력 글을 질문으로 → `#/ask/find`).
- `#/ask`를 열면 서버가 그 사용자 벡터를 **미리 불러오기 시작**(9.4절) — 질문을 입력하는 동안 로드가 끝나게.
- 읽기 화면 대화 탭은 **바꾸지 않음** = "현재 논문" 범위(K-8). 탭 아래 "여러 논문에 질문 →" 링크만.
- 쓰기 화면: 도구 막대 [인용 검증], 왼쪽 "이 원고의 인용" 목록에 상태, 미리보기 인용에 색 표시(11.4절).
- 문구 · 아이콘 · CSS 클래스는 디자인팀 시안 `docs/design/phase3-ask-ui.md`(신규)를 따름.

---

## 6. 임베딩 방식 (확정 U-1 = D, K-1 · K-2)

### 6.1 문제
- 2단계 라우팅의 세 엔진 중 **Anthropic은 임베딩 API가 없고**(공식 문서: Voyage AI 안내), **CLI는 임베딩을 내주지 않습니다.** "API 우선 → CLI 폴백"을 임베딩에 그대로 쓸 수 없습니다.
- 임베딩은 색인 때(논문마다 수십 번)와 질문 때마다(1번) 필요하므로 서버 쪽에서 끝나야 합니다.

### 6.2 선택지 비교 (결정 기록 — 2026-10-08 웹 확인, 22장 출처)

| | A 사용자 API 키 | B 서버 PC 로컬 모델 | C PGroonga만 | **D 혼합 B + C (확정)** |
|---|---|---|---|---|
| 임베딩 비용 | OpenAI `text-embedding-3-small` $0.02 / 100만 토큰(서재 300편 ≈ $0.09), Google `gemini-embedding-2` $0.20 / 100만(무료 등급은 내용이 제품 개선에 쓰임) | 0원 | 0원 | 0원 |
| 누가 쓰나 | OpenAI · Google 키가 있는 사용자만 | 모두 | 모두 | 모두 |
| 다국어 품질 | 3-small MIRACL 44.0(3-large 54.9) | EmbeddingGemma MTEB 다국어 v2 61.15(768) · 60.71(512) | 한국어 질문 ↔ 영어 논문 못 찾음 | B + 정확 일치 보강 |
| 본문이 밖으로 | 본문 전체가 그 회사로 | 안 나감 | 안 나감 | 안 나감 |
| 서버 PC 부담 | 없음 | 모델 메모리 · 색인 CPU | 없음 | B와 같음 |

- **E 사용자 PC 워커에서 임베딩**: PC가 꺼지면 질문도 못 함 — 기각.
- 모델을 못 불러오면 C로 자동으로 내려가고 화면에 "의미 검색 꺼짐" 표시(벡터 쪽 결과가 비는 것뿐 — 코드 경로 하나).

### 6.3 로컬 모델 (K-1 확정)

| 모델 | 크기 · 차원 | 입력 길이 | 라이선스 | 비고 |
|---|---|---|---|---|
| **EmbeddingGemma-300M (확정)** | 3억 파라미터, 768 → **512로 잘라 씀**(MRL, 다시 정규화) | 2,048토큰 | Gemma 약관 — Hugging Face에서 **동의 후 받음(게이트)** | 양자화 시 메모리 200MB 미만(Google), ONNX 판 있음. 질의 · 문서 앞 문구 `task: search result \| query: …` / `title: … \| text: …` |
| voyage-4-nano (대안) | 약 3억, 2048 → 512(MRL) | 32,000 | Apache 2.0 | ONNX 판 없음 → torch 필요 |
| bge-m3 (대안) | 1024 | 8,192 | MIT | 한국어 강함, 파일 · 메모리 2배 |

- 실행: `onnxruntime` + `tokenizers`(또는 그 모델을 지원하면 `fastembed` — 개발팀 재량, 확인 필요).
- 모델 파일: 관리자가 한 번 받아(게이트 동의 — 사용자 작업) 서버 PC `D:\PaperLab\models\<모델>`에 둠. `update.ps1`은 있는지만 확인(없으면 WARN — 서버는 C로 동작).
- 상수(`paperlab/rag.py` 한 곳): `EMBED_MODEL`, `EMBED_DIM = 512`, `RAG_VERSION = "eg512c1"`(모델 · 차원 · 조각 규칙 · 파일 형식이 바뀌면 바꿈 → 전체 재색인, 10.3절). `RAG_VERSION`은 키에 들어가므로 `[a-z0-9]{1,16}`만.

### 6.4 실행 위치 (K-2 확정)
- **서버 프로세스 안**: 모델은 처음 쓸 때 한 번 불러 둠. 색인 작업은 서버 전체에서 동시에 1개, ONNX 스레드 = 코어 절반. 질의 임베딩 1번(수십 ms)은 요청 스레드에서.

---

## 7. 용량 · 메모리 추정 (U-2 반영 — 다시 계산)

가정(**실측 필요** — AC-D05 · S07): 논문 1편 = 20쪽 × 쪽당 4,000자. 조각 약 1,400자 → 쪽당 약 3개 = **편당 60조각**. PDF는 편당 2~5MB(PLAN 7장).

### 7.1 Supabase DB 증가분 (3단계 새로 늘어나는 것만)
| 항목 | 크기 | 비고 |
|---|---|---|
| `papers.rag_version` · `rag_key` | 편당 약 80B → 2,500편이어도 0.2MB | |
| 범위 대화(`chat_messages`, 출처 8개 jsonb) | 답 1개 약 3~4KB → 5명 × 500답 ≈ 8MB | 사용자가 "대화 지우기"로 줄임 |
| `manuscript_citations` | 행 약 300B → 5명 × 원고 10 × 인용 100 ≈ 1.5MB | |
| `jobs`(새 종류) | 30일 뒤 지움(2단계) | 무시할 만함 |
| **합계** | **약 10MB 안팎** | 벡터 · 조각 메타는 DB에 없음. `page_texts` + PGroonga는 1단계부터 있던 것 그대로 |

→ 무료 500MB는 1단계 본문 · 전문 검색과 1B 공용 캐시(상한 150MB)가 대부분을 씁니다. 3단계 때문에 늘어나는 양은 거의 없습니다(1단계 본문 크기는 AC-D05에서 함께 재서 기록).

### 7.2 R2 사용량 (벡터 파일)
파일 1개 = 머리 128B + 조각 메타 60 × 20B + 벡터 60 × 512 × 2B(float16) ≈ **63KB/편**.

| 시나리오 | 벡터 파일 | 참고: PDF(편당 2~5MB) | R2 무료 10GB 대비 |
|---|---|---|---|
| 5명 × 300편 = 1,500편 | **약 95MB** | 3~7.5GB | 벡터는 PDF의 약 1~3% |
| 5명 × 500편 = 2,500편 | **약 160MB** | 5~12.5GB | **PDF만으로 10GB를 넘을 수 있음**(1단계 80% 경고가 알림) |

- 요청 수: 색인 1편 = 쓰기 1번(+ 옛 파일 지우기), 로드 1편 = 읽기 1번. 서버 재시작 · 유휴 내림 뒤 다시 읽어도 월 수천~수만 번 — R2 무료 요청 한도 안(확인 필요 — 22장).
- 벡터 파일은 **DB 백업 대상이 아님**: 지워져도 다시 색인해 만들 수 있음.

### 7.3 서버 메모리
| 항목 | 크기 |
|---|---|
| 임베딩 모델 | 약 0.3~1GB(양자화 여부 — 실측 AC-I08) |
| 사용자 1명 벡터(메모리는 **float32** — numpy float16 행렬 곱은 BLAS가 없어 매우 느림) | 조각 수 × 512 × 4B: 300편(18,000조각) ≈ **37MB**, 500편(30,000조각) ≈ **62MB** + 메타 약 1MB |
| 5명 모두 올림 | 300편씩 ≈ 190MB, 500편씩 ≈ 315MB |
| **캐시 상한(K-18)** | **512MB** — 5명 × 500편까지 내리지 않고 들어감. 넘으면 가장 오래 안 쓴 사용자부터 내림 |

---

## 8. 벡터 파일 (R2) (K-16 · K-17)

### 8.1 키 규칙
- 형식: **`users/{uid}/rag/{paper_id}.v{RAG_VERSION}.{gen}.bin`** — `gen` = 쓸 때마다 새로 만드는 16진수 8자리. (요청 예시 `{paper_id}.v{rag_version}.bin`에 **세대 토큰을 더함**: 새 파일을 다른 키에 쓴 뒤 DB 포인터만 바꿔 교체하기 위함 — 8.3절)
- 검사 정규식(1단계 규칙대로 **fullmatch**): `^users/([0-9a-f-]{36})/rag/([1-9][0-9]{0,18})\.v([a-z0-9]{1,16})\.([0-9a-f]{8})\.bin$`. `storage.check_user_key`에 더해 **uid가 요청 uid와 같을 때만** 통과. 키를 만드는 함수는 `storage.rag_key(uid, paper_id, version)` 하나.
- 지금 키를 DB `papers.rag_key`에 둠(''이면 없음). **서버는 DB에 적힌 키만 읽음**(목록 조회로 찾지 않음).
- 서명 주소를 만들지 않음 — 벡터 파일은 브라우저로 가지 않음. `put`의 content-type은 `application/octet-stream`.

### 8.2 파일 형식 (리틀 엔디언, 버전 1)
```
머리 128B:  magic "PLRAGV01"(8) | paper_id u64 | n u32(조각 수) | dim u16(512, 모델 없이 색인하면 0) | 예약 u16
            | pdf_sha256 ASCII 64 | version ASCII 16(빈칸 0) | 예약 24
메타 n×20B: page u16 | char_start u32 | char_end u32 | rect float16×4(x0,y0,x1,y1 — 0~1, 없으면 모두 NaN) | 예약 u16
벡터 n×dim×2B: float16, 행마다 L2 정규화
```
- 읽기 = `numpy.frombuffer` 세 번(구조체 dtype). 검사: magic · 길이(`128 + 20n + 2·n·dim`과 정확히 같음) · `paper_id`가 DB 행과 같음 · `pdf_sha256`이 `papers.pdf_sha256`과 같음 · `version`이 지금 `RAG_VERSION`과 같음. 하나라도 틀리면 그 논문은 **"색인 대기"로 되돌리고**(`rag_version = ''`) 검색에서 뺌.
- 상한: `n ≤ 20,000`(파일 약 21MB) — 넘으면 색인 실패(손상 PDF 방어).

### 8.3 조각 메타 위치 (K-16 — 추천: **파일에만**)
| | 파일에만(추천) | DB `chunks` 표에도 |
|---|---|---|
| DB 크기 | 0 | 편당 약 7KB(행 60개 × 약 120B) → 2,500편 17MB + 색인 |
| 낱말 검색 결과(쪽) → 조각 | 메모리의 메타로 바꿈(그 사용자 파일이 이미 로드됨) | SQL 조인 |
| 인용 검증 근거 · 대화 출처 | 위치(쪽 · 오프셋)를 `manuscript_citations.evidence` · `chat_messages.citations`에 복사해 둠 → 메타가 없어도 표시 가능 | 같음 |
| 정합성 | 메타와 벡터가 한 파일 — 항상 같이 바뀜 | 파일과 표 두 곳을 맞춰야 함 |
- → **파일에만**. DB에는 논문당 `rag_version` · `rag_key` 두 열만.

### 8.4 쓰기 · 교체 · 지우기 (정합성)
1. 색인 결과를 **새 키**(`gen` 새로)에 `put` — R2 객체 쓰기는 전부 되거나 전부 안 됨.
2. 짧은 트랜잭션(사용자 권한)에서 `select … for update`로 그 논문을 잠그고 `pdf_sha256`이 색인할 때와 같은지 확인 → 같으면 `rag_key = 새 키`, `rag_version = RAG_VERSION`으로 바꿈(**교체 = 이 한 줄**). 다르면(그 사이 PDF가 바뀜) 바꾸지 않음.
3. 커밋 뒤 옛 키(있으면)와, 2에서 쓰지 못한 새 키를 `delete_quietly`. 메모리 캐시의 그 논문 항목을 새 파일로 바꿈(로드돼 있을 때만).
4. 1에서 실패 → DB는 그대로(옛 파일 계속 사용 또는 대기), 작업은 다음 논문으로 · 끝에 경고. 2 뒤 3에서 지우기 실패 → 고아 파일 → `admin orphans`가 정리(DB `rag_key`에 없는 `rag/` 키).
- **논문 삭제**: `delete_paper`가 `pdf_key`와 함께 `rag_key`를 돌려주고, 커밋 뒤 둘 다 `delete_quietly` + 캐시에서 뺌.
- **PDF 교체 · 없앰**(`db.set_pdf`): 같은 트랜잭션에서 `rag_key = ''`, `rag_version = ''` → 커밋 뒤 옛 파일 지우기 + 캐시에서 뺌 → `ensure_index_job`.
- **사용자 삭제**(Supabase에서 지움): DB 행은 cascade, R2 `users/{uid}/` 파일은 PDF와 같이 `admin orphans --delete`가 정리(1단계 규칙 그대로).

---

## 9. 메모리 벡터 캐시 · 사용자 경계 (K-18~K-21)

### 9.1 구조
- 모듈 전역 하나(`rag.VectorCache`): `{uid: UserVectors}`. `UserVectors` = `{paper_id: (rag_key, meta 배열, float32 행렬)}` + 마지막 사용 시각 + 사용자별 잠금. 검색 때 필요한 논문 행렬을 이어 붙인 결과는 범위가 같으면 재사용(가정 — 단순하게 매번 이어 붙여도 됨, 개발팀 재량).
- **캐시 키는 검증된 uid**(사용자 요청 = JWT `sub`, 실행기 · 워커 = `actor_claims`의 uid)뿐. 화면 · 요청 본문에서 받은 값으로 캐시를 고르지 않음.

### 9.2 검색 때 (사용자 경계를 지키는 순서)
1. **사용자 권한 트랜잭션(RLS)**으로 범위의 논문 행을 읽음: `id, rag_key, rag_version, pdf_sha256`(`rag_version`이 `RAG_VERSION` 또는 모델 없이 색인한 `{RAG_VERSION}n`인 것만 — 후자는 낱말 검색에만 쓰임). 이 목록이 **검색해도 되는 논문의 전부**.
2. 캐시에서 그 uid 항목을 꺼내, 목록의 각 논문에 대해 `rag_key`가 캐시와 다르거나 없으면 그 키 파일을 R2에서 읽음(8.1 검사 · 8.2 검사). `rag_key`가 빈 논문(본문 없음)은 건너뜀. 목록에 없는 캐시 항목은 **쓰지 않음**(지워진 논문 · 남의 논문은 애초에 목록에 없음).
3. 목록에 있는 논문의 행렬만으로 점수 계산. 결과 조각은 모두 목록 안의 논문.
- **DB 포인터가 진실**이므로 캐시 무효화가 늦어도 틀린 결과가 나오지 않음 — 9.5절의 무효화는 메모리를 비우는 최적화.

### 9.3 상한 · 내림 (K-18)
- 상한 **512MB**(행렬 + 메타 합계, 상수). 새로 올려 넘으면 **사용자 단위 LRU**로 가장 오래 안 쓴 사용자를 통째로 내림(지금 요청 중인 사용자는 내리지 않음).
- **30분** 동안 안 쓴 사용자는 내림(정리는 다음 캐시 접근 때 · 분당 1회까지).
- 한 사용자 벡터가 상한을 넘으면(약 8,000편 — 가정상 없음) 그 범위 논문만 올리고 다 쓰면 내림.

### 9.4 로드 · 재시작
- **지연 로드**: 처음 질문 · 검증 · `#/ask` 열기 · 색인할 때 그 사용자 파일만. `#/ask`를 열면 백그라운드에서 미리 불러오기 시작(같은 사용자 로드는 잠금으로 한 번만).
- 읽기는 **동시 8개**(스레드 풀, 상수). 1편 약 63KB.
- **걸리는 시간 추정**(실측 AC-S07): R2 GET 1번 약 0.1~0.2초 가정 → 300편 = 300 ÷ 8 × 0.15 ≈ **약 6초**, 500편 ≈ **약 10초**. 서버를 다시 시작하면 메모리가 비므로 각 사용자 첫 사용 때 이만큼 걸림 — 화면은 "서재 색인을 불러오는 중"(미리 불러오기로 대부분 가려짐). 질문 요청은 로드가 끝날 때까지 기다림(최대 60초, 넘으면 503 "잠시 후 다시").
- 서버 시작 때 모든 사용자를 미리 올리지 않음(재시작 직후 R2 요청 몰림 방지, 안 쓰는 사용자 메모리 낭비).

### 9.5 무효화 (프로세스 안만 — K-21)
- 서버 PC 한 대 · 서버 프로세스 하나(1단계 9장)라 캐시는 그 프로세스 메모리에만. 바꾸는 곳: 색인 교체(8.4-3), 논문 삭제, `set_pdf`, 사용자 대화 범위와 무관한 컬렉션 · 폴더 변경은 캐시를 건드리지 않음(범위는 매번 DB로 정함).
- 서버 프로세스를 여러 개로 늘리면 이 설계를 다시 검토(9.2의 DB 포인터 검사 덕분에 틀린 결과는 안 나오지만 옛 파일을 지운 뒤 읽기 실패가 날 수 있음).

### 9.6 보안 검토
| 위협 | 장치 | 확인 |
|---|---|---|
| 남의 벡터 파일 읽기(키 조작) | 키는 서버가 요청 uid로만 만들고, 읽을 키는 **RLS 질의로 얻은 `rag_key`**뿐. 읽기 전에 fullmatch + uid 일치 검사 | AC-S01 · S02 |
| 남의 논문을 범위에 넣기 | 범위 → 논문 id는 RLS 트랜잭션 질의. 요청의 컬렉션 · 폴더 id가 남의 것이면 0편 → 400 | AC-S03 |
| 캐시에서 다른 사용자 벡터 섞임 | 캐시 키 = 검증된 uid, 검색은 1번 목록과 교집합만 | AC-S04 |
| 파일 바꿔치기 · 다른 논문 파일 | 머리의 `paper_id` · `pdf_sha256` · `version`을 DB 행과 대조, 길이 정확히 일치 | AC-S05 |
| 지운 논문이 검색에 남음 | DB 목록에 없으면 캐시에 있어도 안 씀 + 삭제 때 캐시에서 뺌 + 파일 삭제 | AC-S06 |
| 브라우저에서 R2 직접 접근 | 벡터 파일 서명 주소를 만들지 않음, 버킷 비공개(1단계), R2 키는 서버 PC `cloud.env`만 | AC-S02 · 코드 검토 |
| 메모리 고갈 · 큰 파일 | 상한 512MB + LRU, 파일 `n ≤ 20,000` · 길이 검사 | AC-S08 |
| 관리 권한 남용 | service role 새 사용처 없음 — 색인 · 검색 모두 사용자 권한 트랜잭션 + 사용자 범위 저장소 | AC-D04 |
| 로그로 새는 정보 | 키 · 논문 id · 제목 · 질문을 로그에 남기지 않음(15장) | AC-L01 |
| 백업에 벡터 없음 | 다시 색인으로 복구(데이터 손실 아님) | — |

---

## 10. 색인 파이프라인 (K-4)

### 10.1 작업 하나 = 그 사용자의 "색인 대기" 논문 전부
- `index` 작업: `paper_id = null`, `params = {}`, `route = [{"runner":"api","engine":"local"}]`, 폴백 없음. API 실행기가 실행(서버 전체 동시 1개 — 다른 사용자 `index`는 대기열 뒤로).
- 대기 = PDF가 있고 `rag_version <> RAG_VERSION`인 논문. 한 편씩, 편마다 짧은 트랜잭션(1단계 F9). 진행 `{"message":"색인 중 3/12편","fraction":0.25}`. 끝내기 직전 같은 트랜잭션에서 한 번 더 세고 0일 때만 `succeeded`.
- **`ensure_index_job(lib)`**: 대기 논문이 있고 진행 중 `index` 작업이 없으면 만듦(`insert … on conflict do nothing`). 부르는 곳: PDF 붙이기 커밋 뒤(모두 `db.set_pdf`를 거침), `GET /api/ask`, 2단계 정리(sweep). → 기존 논문은 처음 `#/ask`를 열 때 한꺼번에.
- 취소 가능(남은 논문은 대기로, 다음 `ensure` 때 다시).

### 10.2 논문 하나 색인
1. R2에서 PDF, DB에서 `page_texts` · `pdf_sha256`을 읽음.
2. 쪽마다 `get_text("blocks")`의 글 블록을 그 쪽 `page_texts.text` 안에서 앞에서부터 찾아(공백 정규화) 블록마다 `(start, end, bbox)`.
3. 이어진 블록을 **약 1,400자**까지 묶어 조각(최소 300자 — 짧은 꼬리는 앞에 붙임, 2,400자 넘는 블록은 문단 · 글자 수로 자름). 위치 = 첫 블록 시작 ~ 마지막 블록 끝, `rect` = bbox 합 ÷ 쪽 크기. 블록을 못 맞춘 쪽은 쪽 글을 같은 크기로 잘라 `rect` 없음.
4. 임베딩 입력 `title: {제목} | text: {조각 글}`, 16개씩, 512로 자르고 다시 정규화 → float16.
5. 파일 쓰기 · 교체(8.4절).
- 본문 없는 논문(스캔본)은 조각 0개 파일 없이 `rag_key = ''`, `rag_version = RAG_VERSION` → 다시 시도하지 않음. 모델 없이 색인하면 `dim = 0` 파일 + `rag_version = "{RAG_VERSION}n"`(지금 값과 달라 모델이 생기면 다시 색인됨, 그동안 낱말 검색은 메타로 동작 — 9.2절 1번 목록 조건은 "`RAG_VERSION` 또는 `{RAG_VERSION}n`").

### 10.3 재색인 규칙
| 일 | 처리 |
|---|---|
| PDF를 새로 붙임 · 바꿈 · 없앰 | `set_pdf`가 포인터를 비우고 → 커밋 뒤 옛 파일 삭제 · `ensure_index_job` |
| 논문 삭제 | 커밋 뒤 파일 삭제(8.4절) |
| 제목 · 메타데이터 변경 | **재색인 안 함** |
| `RAG_VERSION` 변경 | 모든 논문이 대기 → 사용자별 `ensure` 때 차례로. 옛 파일은 교체 때 지워짐 |
| 모델 없이 색인됨(`…n`) | 모델이 생기면 대기로 보임 → 다시 색인 |
| 파일 검사 실패(8.2절) | 그 논문을 대기로 되돌림 → 다시 색인 |
| 수동 | `python -m paperlab.admin rag-reindex --all`(관리자 연결 — 모든 `rag_version = ''`, 파일은 다음 교체 때 지워짐, 로그에 `reason`) |

---

## 11. 검색 · 질문 (①)

### 11.1 범위 → 논문 목록 (RLS)
- `library`: 내 논문 전부 · `collection`: `paper_collections`의 그 컬렉션 논문(서재 목록과 같은 직속 집합) · `folder`: `papers.folder_id`가 그 폴더.
- 9.2절 1번 질의로 색인된 논문만. 없으면 400 "이 범위에 색인된 논문이 없어요".

### 11.2 혼합 검색 (K-6 · K-7)
1. **벡터(메모리)**: 질의 임베딩(`task: search result | query: …`) → 범위 논문 행렬과 내적(정규화돼 있어 코사인) → `argpartition`으로 상위 **40조각**. 정확 검색.
2. **전문 검색(DB, 1단계 색인 그대로)**: 질문을 낱말로(2자 미만 버림, 한글 낱말 끝 조사 `은 는 이 가 을 를 의 에 에서 으로 로 와 과 도 만` 한 번 떼기, 최대 8개) → `page_texts`에서 범위 논문 중 `text &@~ <낱말 OR …>`(`pgroonga_query_escape`) 점수순 **20쪽** → 그 쪽의 조각(메모리 메타) 중 낱말이 든 조각에 쪽 순위.
3. **합치기**: RRF(`k = 60`, 가중치 1) → 상위 **8조각**, 한 논문 최대 3조각. 이것이 재정렬의 전부.
- 수치는 `rag.py` 상수, 가정. 조각 글은 `page_texts`에서 위치로 잘라 옴(9.2절 목록의 논문만).

### 11.3 답 만들기 (작업 큐 · 라우팅 그대로)
- `POST /api/ask`(SSE) = 지금 `stream_job(kind="chat")`. `params = {"question", "scope": {"type","id"}}`, `paper_id = null`. 경로는 `ai_routing.chat`.
- 출처 고르기는 실행하는 쪽이 한 번 하고 결과(논문 id · 쪽 · 위치 · rect · 제목 · 연도)를 `params.sources`에 적음 → 결과 반영 때 같은 번호표. API SSE는 요청 안에서, CLI는 잡을 때(`cli_task`) 고름.
- 프롬프트: `<source n="1" title="…" year="…" page="5">조각 글</source>` × 8 + 그 범위 대화 최근 6개 + 질문. 규칙: 설정 언어(`summary_language`)로, 출처만 근거로, 근거 문장 끝에 `[n]`, 자료에 없으면 밝히고 일반 지식과 구분.
- 엔진: claude API = 범용 스트림, OpenAI · Google = `text_complete`, CLI = 텍스트. **세 경로 같은 프롬프트 · 같은 `[n]` 해석**(1~8 밖 번호는 지우고 쓰인 번호만 `citations`에).
- 대기 기한 · 시간 제한 · 폴백 · 탭 닫힘은 지금 `chat`과 같음.

### 11.4 출처 → 쪽 · 좌표로 이동
- 출처 카드를 누르면 화면 메모리에 `{paper_id, page, rect, text}`를 두고 `#/read/{id}/p{page}`. 읽기 화면은 그 쪽에서 `rect`의 y가 보이게 스크롤, 사각형을 잠깐 표시 + `flashText(text)`. `rect`가 없으면 쪽 이동 + `flashText`만. 이미 열린 논문이면 `reader.goToSpot(page, rect, text)`(새 함수)만.

### 11.5 `chat_messages.citations` 모양 (범위 대화)
```json
[{"n":1,"paper_id":12,"page":5,"char_start":1820,"char_end":3190,"rect":[0.08,0.41,0.49,0.77],
  "title":"Attention Is All You Need","year":2017,"text":"조각 앞 300자"}]
```
- 출처를 메시지 안에 복사해 두므로 나중에 재색인돼도 표시 · 이동이 됨(쪽 위치는 PDF가 같으면 유효).

---

## 12. 인용 검증 (⑦) (K-14)

### 12.1 흐름
1. [인용 검증] → `POST /api/manuscripts/{id}/verify`.
2. 저장된 원고를 문장으로 나누고 인용 표시가 있는 문장마다 `(문장, 인용키, 쪽)`(`compose.CITE_RE` · `parse_citation`, `[@a; @b]`는 키마다 하나).
3. `claim_hash`가 같고 `paper_sha`가 지금 PDF와 같고 `pending`이 아니면 **그대로 씀**. 지금 원고에 없는 해시의 행은 지움.
4. 새로 검사:
   | 경우 | 판정 |
   |---|---|
   | 인용키가 서재에 없음 | `unchecked` "서재에 없는 인용키예요" |
   | PDF · 본문 없음 | `unchecked` "원문(PDF)이 없어요" |
   | **직접 인용**(“ ” · " " 안, 또는 `>` 블록) | **문자열 대조**(12.3절) — AI 안 씀 · 색인 불필요 |
   | 간접 인용 · 색인 안 됨 | `unchecked` "색인 중이에요. 끝나면 다시 검증해 주세요" |
   | 간접 인용 | 그 논문 하나만으로 혼합 검색(11.2절, 질의 = 인용 표시 뺀 문장, 적힌 쪽 조각을 앞에) → 근거 후보 3조각 위치를 `evidence`에 → `pending` |
5. `pending`이 있으면 `verify` 작업 하나(그 원고에 진행 중이면 그것). 경로가 없으면 작업 없이 `unchecked` "AI를 쓸 수 없어 근거 후보만 보여요"(후보 유지).
6. 응답 = `GET`과 같은 모양(12.4절).

### 12.2 AI 일괄 판정 (`verify` 작업)
- 경로 `ai_routing.verify`(기본 `[claude]`), 백그라운드, CLI 대기 기한 24시간, 시간 제한 1,200초.
- 한 작업 = AI 호출 1번, **문장 최대 40개**(오래된 `pending`부터). 남으면 "남은 N개는 다시 누르면 확인해요".
- 프롬프트는 잡을 때: 지금 원고에서 문장을 다시 뽑아 `pending` 해시와 맞춤(바뀐 문장은 건너뜀), 근거 글은 `evidence` 위치로 `page_texts`에서 잘라 옴(벡터 캐시 불필요). 출력 JSON `{"results":[{"id","verdict":"supported|weak|unsupported","evidence":1|2|3|null,"reason"}]}`.
- 반영: 아직 `pending`이고 해시가 그대로인 행만. 모르는 · 빠진 id는 `pending` 그대로.
- **비용 추정**: 1회 입력 약 40 × (문장 60 + 조각 3 × 400) ≈ **5만 토큰**, 출력 약 2,500토큰(사용자 키 요금 또는 CLI 구독). 다시 눌러도 바뀐 문장만 보냄.

### 12.3 직접 인용 문자열 대조 (AI 없음)
- 정규화: NFKC, 둥근 따옴표 · 줄 끝 하이픈 연결 · 공백 묶기, 소문자. 인용 글 600자까지.
- 적힌 쪽 → 나머지 쪽: 그대로 있으면 `supported`, 없으면 인용 길이 창을 1/4씩 옮기며 `difflib` 최고 비율 **0.85 이상 `supported` · 0.6 이상 `weak` · 그 밖 `unsupported`**(가정). 다른 쪽에서 찾으면 `weak` "원문은 p.N에 있어요".

### 12.4 화면 표시
- `GET /api/manuscripts/{id}/verify` → `{"items":[{"start","end","marker_index","citekey","paper_id","verdict","method","reason","evidence":[{"page","text"(앞 200자)}]}],"counts":{…},"job":<작업 보기|null>}`. 서버가 지금 원고로 다시 나누어 해시로 맞춤.
- 왼쪽 "이 원고의 인용" 아래 **인용 검증** 목록(상태 아이콘 5종 + 문장 앞부분 + 이유). 누르면 편집기에서 그 문장 선택 · 스크롤. 근거 "p.5 …" → **참고 패널(1C) PDF 탭이 그 쪽**으로.
- 미리보기: `weak` · `unsupported` 인용 표시에 색 · 툴팁. 원고를 고친 뒤엔 "원고가 바뀌었어요 — 다시 검증해 주세요".

---

## 13. AI로 찾기 (⑨) (K-9~K-13)

### 13.1 흐름 (작업 종류 `find`, 백그라운드 + 진행 표시)
1. `POST /api/find` `{"question"}`(본문으로만, 2~1,000자) → `202 {job}`. 경로 `ai_routing.find`(기본 `[claude]`), CLI 대기 기한 30분, 호출마다 600초.
2. **검색어(AI 1회)**: JSON `{"queries":[…]}` 2~4개(기본 3), 각 200자 이하, **영어 1개 이상**(없으면 `bad_output`). 개수가 틀리면 원래 질문을 더해 씀.
3. **검색**: 검색어마다 OpenAlex `search`(20편) + S2 `paper/search`(20편) — 지금 `Sources.search`. 한쪽 실패 → 다른 쪽으로 계속 + 경고 `openalex_failed` / `s2_failed`. 둘 다 실패 → 작업 실패 "검색 결과를 받지 못했어요"(폴백 아님).
4. **합치기**: DOI(`normalize_doi`) → 정규화 제목(12자 이상) 순으로 합침(OpenAlex 우선, S2는 빈 칸만). 초록 · 제목 모두 없으면 버림.
5. **고르기(K-10)**: 질문과 `제목 + 초록`(1,500자까지) 임베딩 코사인 상위 **8편**(벡터 캐시 · R2 불필요 — 그 자리에서 계산). 모델이 없으면 RRF 순위. 0편이면 AI 요약 없이 "관련 논문을 찾지 못했어요"로 성공.
6. **요약(AI 1회)**: `<source n="1">제목 · 저자 · 연도 · 학술지 · 초록</source>` × 8. **항상 한국어**, 문장마다 `[n]`, 출처에 없는 내용 · 수치 금지.
7. **번호 검사**: 목록 밖 번호는 지우고, 유효한 `[n]`이 없는 문장은 뺌(제목 줄 · 빈 줄 제외). 절반 넘게 빠지거나 남은 문장이 없으면 `bad_output`. 한글이 글자(공백 · 숫자 · 기호 · `[n]` 제외)의 30% 미만이어도 `bad_output`. 자동 재시도 없음.
8. 결과 `jobs.result = {"answer","sources":[결과 카드 모양 + "n"],"queries","warnings"}` → 화면이 폴링.

### 13.2 엔진 경로별 실행
- **API 칸**: API 실행기가 2~7을 한 번에.
- **CLI 칸 — 같은 작업 행 두 단계**: ① `params.queries`가 없으면 검색어 프롬프트(JSON) → 결과로 `params.queries`를 적고 **같은 칸으로 다시 `queued`**(`attempts = 0`, `deadline_at` 그대로). ② 다시 잡을 때 서버가 3~5를 하고 8편을 `params.candidates`에 적은 뒤(그동안 연결 반납) 요약 프롬프트 → 결과에 7. `candidates`가 이미 있으면 다시 검색하지 않음. `params` 64KB 안.
- 워커(2b) 변경 없음: `output`(`text`/`json`) · `json_schema`를 그대로 씀(AC-F09).

### 13.3 외부 호출 예산 (1B 7장 규칙 그대로)
| 호출 | 횟수 | 비용 · 한도 |
|---|---|---|
| OpenAlex 검색 | 3 | 1,000회당 $1 → 키 없이 하루 $0.10 = 검색 100회(IP 공유 여부 확인 필요 — 1B) → 약 30번/일. 사용자 OpenAlex 키면 약 300번 |
| S2 검색 | 3 | 키 없으면 공용 풀(429 잦음), 키면 초당 1회 |
| 재시도 | 429 · 5xx · 연결 오류만 1번 | 하루 예산 429는 재시도 안 함 + 1B 문구 |
| 전체 | 외부 호출 최대 6 + 재시도 6, 45초 기한(넘으면 받은 것으로 + `partial`) | |

### 13.4 공용 캐시 · 기록 (K-11 · K-12)
- 1B 공용 캐시는 **읽지도 쓰지도 않음**. 카드 [서재 추가] · [그래프]는 지금 흐름 그대로.
- `find` 작업은 끝나고 **24시간 뒤 `params` · `result`를 비움**(정리 한 줄). 결과 저장 표 없음.

---

## 14. 데이터 · 작업 종류 · API

### 14.1 마이그레이션 `supabase/migrations/20261010000001_rag.sql` (DB 변경은 이것뿐 — pgvector · 벡터 열 없음)
1. **`papers`**: `rag_version text not null default ''`, `rag_key text not null default ''`(검사: `''` 또는 8.1절 정규식 모양 — uid 일치는 서버가 검사), 색인 `(user_id, rag_version)`.
2. **`chat_sessions`**: `scope` 검사를 `('paper','collection','folder','library')`로, `collection_id` · `folder_id` 추가(복합 외래 키 `on delete cascade`), scope별 필요한 id만 채워지는 검사, 범위마다 하나 — `unique (user_id) where scope = 'library'`, `unique (user_id, collection_id) where scope = 'collection'`, `unique (user_id, folder_id) where scope = 'folder'`. `chat_messages`는 그대로(출처는 `citations jsonb`).
3. **`manuscript_citations`**(신규, RLS 1단계 틀): `id` identity, 공통 `user_id`, `manuscript_id`(복합 FK cascade), `claim_hash text`(`unique (manuscript_id, claim_hash)`), `citekey text`, `paper_id bigint null`(복합 FK `on delete set null (paper_id)`), `paper_sha text default ''`, `method text`(`quote` · `ai` · `none`), `verdict text`(`supported` · `weak` · `unsupported` · `unchecked` · `pending`), `reason text`(300자 이하), `evidence jsonb default '[]'`(최대 3개 `{"page","char_start","char_end","score"}`), `checked_at timestamptz`. `service_role`에 백업용 권한.
4. **`jobs`**: `kind`에 `index` · `find` · `verify`, `engine`에 `local`(**`index`만**), `unique (user_id, kind) where kind = 'index' and status in ('queued','running')`.
- `config.JOB_KINDS`(작업별 엔진 설정)에는 `find` · `verify`만.

### 14.2 작업 종류
| `kind` | 엔진 경로 | 화면 연결 | CLI 대기 기한 | 시간 제한 | 결과 반영 |
|---|---|---|---|---|---|
| `chat`(범위 대화 포함) | `ai_routing.chat` | API = SSE, CLI = 큐 | 30분 | 600초 | 범위 세션에 질문 · 답, 출처는 `params.sources` |
| `find` | `ai_routing.find` | 백그라운드 + 폴링 | 30분 | 단계마다 600초 | `result`(24시간) |
| `verify` | `ai_routing.verify` | 백그라운드 + 폴링 | 24시간 | 1,200초 | `manuscript_citations` |
| `index` | `[{api, local}]` 고정 | 백그라운드 | — | 논문 하나 600초(가정) | R2 파일 + `papers.rag_*` |

- 설정 "작업별 엔진"에 `AI로 찾기` · `인용 검증`, 작업 목록 이름표에 `서재 질문` · `AI로 찾기` · `인용 검증` · `색인`.

### 14.3 API
| 경로 | 내용 |
|---|---|
| `GET /api/ask?scope=library\|c{id}\|f{id}` | 범위 대화 + `index: {papers, with_text, indexed, pending, embed: true\|false, loaded: true\|false}` + 진행 중 `index` 작업. 부를 때 `ensure_index_job` + 벡터 미리 불러오기 시작 |
| `POST /api/ask` (SSE) | `{"scope","question"}` → 지금 대화 SSE 이벤트 모양(`delta` · `done`(+`citations`) · `queued` · `fallback` · `error`) |
| `DELETE /api/ask?scope=…` | 범위 대화 지우기 |
| `POST /api/find` | `{"question"}` → 202 `{job}` |
| `POST /api/manuscripts/{id}/verify` · `GET` 같은 주소 | 12.1 · 12.4절 |
| `python -m paperlab.admin rag-reindex --all` | 10.3절 |
| `python -m paperlab.admin orphans [--delete]` | **확장**: DB `rag_key`에 없는 `users/*/rag/*.bin`도 고아로(크기 합계 따로 출력) |

- 범위 id는 주소에, **질문 · 문장은 본문에만**.

## 15. 로그 · 조회 기록 없음 (1B 8.6절 점검표에 추가)
- 앱 로그는 숫자만: `{"event":"ask","ms","chunks","papers","vector":true}`, `{"event":"rag_load","papers","ms","mb"}`, `{"event":"rag_evict","reason":"lru|idle","mb"}`, `{"event":"find","ms","queries","candidates","picked","warnings","openalex_remaining"}`, `{"event":"verify","claims","quote","ai","reused"}`, `{"event":"index","papers","chunks","ms","embed"}`. **질문 · 검색어 · 제목 · DOI · 인용키 · 문장 · 저장소 키 없음.**
- 외부 호출 오류는 호스트 · 상태만. 공용 표에 새로 쓰는 것 없음. `find` 기록은 24시간 뒤 비움.

---

## 16. 수용 기준

표시: `[자동]` pytest/Node(가짜 저장소 `FakeStorage`), `[db]` 테스트용 Supabase 프로젝트(`@pytest.mark.db`), `[실환경]` 서버 PC + 실제 R2, `[수동]` 화면.

### D. 데이터 · DB
- **AC-D01** [db] 마이그레이션 뒤 `manuscript_citations`가 RLS이고 기존 카탈로그 검사(`tests/test_rls.py` AC-20)가 통과한다. `vector` 확장 · 벡터 열이 없다.
- **AC-D02** [db] 사용자 A의 범위 대화 · 검증 결과 · `index`/`find`/`verify` 작업을 B 권한으로 읽으면 0행이다.
- **AC-D03** [db] 컬렉션 · 폴더를 지우면 그 범위 대화가 지워지고, 논문을 지우면 검증 결과의 `paper_id`가 null이 된다.
- **AC-D04** [자동] 코드 검색: 3단계 코드에 `system_tx` 새 사용처가 없다(관리 명령 제외).
- **AC-D05** [실환경] 논문 20편(영어 15 · 한국어 5)을 색인한 뒤 DB 전체 크기 증가가 1MB 미만이고, `page_texts`(PGroonga 포함 여부) 크기와 R2 벡터 파일 평균 크기를 이 문서 7장에 적는다(추정과 2배 넘게 다르면 팀장 보고).

### S. 벡터 파일 · 캐시 · 사용자 경계
- **AC-S01** [자동] `storage.rag_key`가 8.1절 형식을 만들고, 검사가 fullmatch로 다른 uid · 끝 줄바꿈 · `..` · 다른 확장자 · 대문자 16진수를 거부한다.
- **AC-S02** [자동] 사용자 B 요청 경로에서 A의 `rag/` 키를 읽으려 하면 `StorageKeyError`이고 저장소 호출이 없다. 벡터 파일 서명 주소를 만드는 코드가 없다(코드 검색).
- **AC-S03** [db] B가 A의 컬렉션 id로 질문하면 400이고 A의 파일을 읽지 않는다(가짜 저장소 호출 기록으로 확인).
- **AC-S04** [db] A · B를 번갈아 질문해도(캐시에 둘 다 있음) 각 답의 출처는 자기 논문뿐이다.
- **AC-S05** [자동] 파일 머리의 `paper_id` · `pdf_sha256` · `version`이 DB와 다르거나 길이가 맞지 않으면 그 논문을 검색에서 빼고 `rag_version = ''`로 되돌린다.
- **AC-S06** [db] 논문을 지우면 커밋 뒤 벡터 파일이 지워지고, 그 직후 질문에 그 논문이 나오지 않는다(캐시에 남아 있어도).
- **AC-S07** [실환경] 서버를 다시 시작한 뒤 300편 사용자의 첫 질문까지 로드 시간을 재서 기록한다(목표 15초 이하, 넘으면 팀장 보고 — 묶음 파일 검토).
- **AC-S08** [자동] 캐시 상한을 작게 주입하면 가장 오래 안 쓴 사용자가 내려가고(요청 중인 사용자는 아님), 유휴 시간을 짧게 주입하면 유휴 사용자가 내려간다. 내려간 뒤 질문하면 다시 로드된다. `n > 20,000` 파일은 거부한다.
- **AC-S09** [자동] 색인 교체: 새 키 쓰기 → DB 포인터 교체 → 옛 키 삭제 순서이고, 포인터 교체 전에 실패하면 옛 파일 · 옛 포인터가 그대로이며 새 키는 지워진다. 그 사이 PDF가 바뀌면 포인터를 바꾸지 않는다.
- **AC-S10** [자동] `admin orphans`가 DB에 없는 `rag/` 키를 찾고 `--delete`로 지운다.

### I. 색인
- **AC-I01** [db] PDF를 올리면 커밋 뒤 `index` 작업이 생기고, 끝나면 `rag_version = RAG_VERSION`, `rag_key`의 파일이 저장소에 있다(가짜 임베딩).
- **AC-I02** [자동] 조각 함수: 모든 조각이 한 쪽 안이고 `page_texts.text[start:end]`가 비어 있지 않으며 쪽 글을 빈틈 · 겹침 없이 덮는다. `rect`는 0~1이거나 없음. 파일을 쓰고 다시 읽으면 메타 · 벡터가 같다(float16 오차 안).
- **AC-I03** [db] PDF 50편을 한꺼번에 올려도 진행 중 `index`는 1개이고 50편이 모두 색인된다. 색인 중 51번째도 빠지지 않는다.
- **AC-I04** [db] PDF를 바꾸면 포인터가 비워지고 옛 파일이 지워진 뒤 다시 색인된다. 제목만 바꾸면 재색인되지 않는다.
- **AC-I05** [자동] 모델이 없으면 `dim = 0` 파일 · `rag_version = "{RAG_VERSION}n"`, 질문은 전문 검색만으로 답하고 `GET /api/ask`가 `embed: false`. 모델이 생기면 대기로 보인다.
- **AC-I06** [자동] 본문 없는 PDF는 파일 없이 `rag_version`이 적히고 다시 시도되지 않는다.
- **AC-I07** [db] 두 사용자가 동시에 색인해도 실행 중 `index`는 서버 전체 1개. 색인 중 서버를 다시 시작하면 복구 스캔으로 이어서 끝난다.
- **AC-I08** [실환경] 실제 모델로 20쪽 영어 논문 색인 시간 · 서버 메모리를 기록(목표 60초 이하 · 모델 1.5GB 이하, 넘으면 팀장 보고).

### Q. 질문 (①)
- **AC-Q01** [db] 컬렉션 범위 질문(가짜 AI가 `[1][2]`)의 `citations`에 논문 id · 쪽 · 위치가 있고 모두 그 컬렉션 논문이다.
- **AC-Q02** [db] 읽기 화면 대화(현재 논문)는 지금과 같은 응답이고 다른 논문 출처가 없다(회귀).
- **AC-Q03** [자동] 혼합 검색: 의미가 가까운 조각(벡터)과 낱말이 같은 조각(전문 검색)이 둘 다 상위 8개에 들고, 한 논문 3조각 이하. 조사 떼기(`트랜스포머의` → `트랜스포머`) 동작.
- **AC-Q04** [자동] `[n]` 해석: 출처 밖 번호는 지워지고 쓰인 번호만 남는다.
- **AC-Q05** [db] CLI 경로(가짜 워커): 잡을 때 고른 출처가 `params.sources`에 있고 반영 때 그 번호표를 쓴다.
- **AC-Q06** [db] 키가 있으면 API, 틀리면 같은 작업이 CLI 대기열, 키도 기기도 없으면 400(2단계 문구).
- **AC-Q07** [db] 색인된 논문이 없는 범위는 400 "이 범위에 색인된 논문이 없어요".
- **AC-Q08** [수동] 출처 카드를 누르면 그 논문이 그 쪽으로 열리고 위치에 사각형 · 반짝임이 보인다. 열린 논문이면 다시 열지 않는다.
- **AC-Q09** [실환경] 한국어 질문 10개(정답 쪽을 미리 정함) 중 8개 이상에서 정답 쪽이 출처에 있다(가정 목표, 못 미치면 팀장 보고).

### V. 인용 검증 (⑦)
- **AC-V01** [자동] 문장 나누기 · 인용 뽑기: `…이다 [@a, p. 3].`, `“직접 인용” [@a, p. 3]`, `[@a; @b]`, `\[@a]`(인용 아님), 인용 블록.
- **AC-V02** [자동] 직접 인용: 그대로 → `supported`, 조금 다름 → 비율 규칙, 다른 쪽 → `weak` + "원문은 p.N에 있어요", 없음 → `unsupported`.
- **AC-V03** [db] 간접 인용이 있으면 `verify` 작업 1개, 가짜 AI JSON 반영 뒤 판정 · 근거 쪽이 응답에 있다.
- **AC-V04** [db] 다시 누르면 안 바뀐 문장은 AI에 안 보냄(가짜 AI 호출 0회), 고친 문장 · PDF가 바뀐 논문 문장만 보냄.
- **AC-V05** [db] 서재에 없는 키 · PDF 없음 · AI 경로 없음이 각각 `unchecked`와 정한 이유(경로 없음이면 작업 없음).
- **AC-V06** [db] 문장 41개 이상이면 40개만 보내고 나머지는 `pending` + 안내.
- **AC-V07** [수동] 근거 없음 · 약함 문장이 목록 · 미리보기에 표시, 목록 클릭 → 편집기 문장 선택, 근거 쪽 → 참고 패널 PDF 그 쪽.

### F. AI로 찾기 (⑨)
- **AC-F01** [자동] 가짜 AI가 검색어 3개(영어 포함) → OpenAlex 3번 · S2 3번 호출(가짜 전송) · 결과 합침. 영어가 없으면 `bad_output`.
- **AC-F02** [자동] 같은 DOI · 같은 정규화 제목은 하나로, OpenAlex 정보가 남음.
- **AC-F03** [자동] 가짜 임베딩에서 질문과 낱말이 겹치는 논문이 상위 8편. 모델 없으면 RRF.
- **AC-F04** [자동] 최종 답의 모든 문장에 유효한 `[n]`, 모든 `n`이 `sources`에 있음. 절반 넘게 빠지면 `bad_output`.
- **AC-F05** [자동] 요약 프롬프트는 설정 언어와 무관하게 한국어를 지시하고, 한글 비율 검사(30% 미만 `bad_output`)가 동작한다.
- **AC-F06** [자동] S2 429 → OpenAlex만으로 답 + `s2_failed`. 둘 다 실패 → 작업 실패, 폴백 없음.
- **AC-F07** [db] 결과 카드 [서재 추가]로 서재에 들어감.
- **AC-F08** [db] API 키 있으면 API, 없으면 CLI 두 단계(가짜 워커가 두 번 잡음), 켜진 기기 없으면 "대기 중". 두 번째 잡기 리스를 잃고 다른 기기가 잡아도 다시 검색하지 않음.
- **AC-F09** [자동] 2b 워커 코드가 `find` · `verify`의 `output: json` 작업을 수정 없이 처리한다(가짜 CLI).
- **AC-F10** [db] 끝난 `find`는 24시간 뒤 정리에서 `params` · `result`가 비워진다.

### L. 로그 · 조회 기록
- **AC-L01** [자동] 질문 · 찾기 · 검증 · 색인 · 로드 뒤 앱 로그에 질문 · 검색어 · 제목 · DOI · 인용키 · 원고 문장 · `rag/` 키가 없다(심어 둔 문자열로 검사).
- **AC-L02** [db] AI로 찾기 전후 `external_works` · `citation_edges` 행 수가 같다.
- **AC-L03** [자동] 질문 · 문장은 요청 본문에만 있고 주소에 없다.

### X. 회귀
- **AC-X01** [자동] 1단계 · 1A · 1B · 1C · 2a 자동 검사 전부 통과.

## 17. 테스트 방법
- **가짜 임베딩** `HashEmbedder`(`rag.py` 안, 테스트 전용): 낱말을 해시해 512차원에 더하고 정규화. 앱 팩토리에 주입. 실제 모델 테스트는 모델 파일이 있을 때만(`@pytest.mark.model`).
- **가짜 저장소**: 지금 `storage.FakeStorage`(호출 기록으로 AC-S02 · S03 확인). 캐시 상한 · 유휴 시간 · 로드 동시 수는 주입.
- **가짜 AI**: 지금 가짜 HTTP 클라이언트(OpenAI · Google) · 가짜 Anthropic 스트림 · Python 가짜 워커.
- **가짜 검색**: `Sources(transport=httpx.MockTransport(…))`.
- **DB**: 테스트용 Supabase 프로젝트(1단계 10.2절).
- **화면 순수 함수**: `tests/js/ask.test.mjs`(`[n]` → 링크, `#/ask/c12` 해석), `tests/test_js_node.py`에 한 줄.
- 파일: `tests/test_rag.py`(조각 · 파일 형식 · 캐시 · 키 · 낱말 · RRF · `[n]` · 직접 인용 · 요약 검사 — DB 없음), `tests/test_rag_api.py`(`[db]`).

## 18. 수동 확인 (배포 뒤)
- M-1 실제 30편 서재에서 서재 전체 · 컬렉션 질문 5개 — 출처 위치가 맞는지(AC-Q08 · Q09).
- M-2 실제 원고(인용 20개 이상) 인용 검증 — 판정이 납득되는지, 쪽 번호 오류가 잡히는지.
- M-3 AI로 찾기 한국어 질문 5개 — 한국어 요약, 번호 → 카드, 카드 버튼 4개. 키 없이 몇 번에서 OpenAlex 한도가 오는지 기록.
- M-4 서버 PC 작업 관리자로 색인 · 로드 중 CPU · 메모리, 다른 사용자 응답이 느려지지 않는지(AC-I08 · S07).

## 19. 위험
| 위험 | 대응 |
|---|---|
| R2 무료 10GB를 PDF가 먼저 채움(5명 × 500편) | 1단계 80% 경고, 벡터는 PDF의 1~3%. 넘으면 R2 유료(GB당 과금 — 확인 필요) 또는 PDF 정리 |
| 재시작 뒤 첫 질문이 느림(R2 수백 번 읽기) | 미리 불러오기, 동시 8, AC-S07 실측 → 느리면 사용자 묶음 파일 |
| 벡터에 RLS가 없음 | 9.6절 장치 · AC-S01~S06, 키는 RLS 질의로만 얻음 |
| 서버 PC 메모리 · CPU 부족(사양 미확인) | 상한 512MB · LRU, 색인 동시 1개, AC-I08 실측 |
| 게이트 모델 받기 번거로움 | 관리자 1회 작업, 안 되면 voyage-4-nano |
| 블록 ↔ `page_texts` 맞추기 실패 | 쪽 이동 + 글 반짝임으로 대신 |
| AI 판정 오판 · ⑨ 초록 기반 왜곡 | "AI 판정 · 초록 기반" 표시, 근거 · 원문 링크, 번호 검사 |
| OpenAlex 키 없는 하루 예산 공유 | 사용자 OpenAlex 키 안내, 소진 시 1B 문구 |

---

## 20. 결정 · 미정

### 20.1 사용자 결정 (2026-10-08 — 확정)
| # | 결정 |
|---|---|
| U-1 | **D안** — 서버 PC 무료 모델(EmbeddingGemma) + PGroonga 낱말 검색 |
| U-2 | (개정) 벡터를 Supabase DB(pgvector)에 넣지 않고 **R2 파일 + 서버 메모리** — Supabase 무료 유지 |

### 20.2 팀장 결정 K-1~K-15 (2026-10-08 확정 — 기획팀 추천안, R2 방식으로 K-5 · K-6 고침)
| # | 결정 |
|---|---|
| K-1 | 모델 EmbeddingGemma-300M, 512차원(파일 float16 · 메모리 float32), ONNX. 막히면 voyage-4-nano |
| K-2 | 임베딩은 서버 프로세스 안, 색인 동시 1개, ONNX 스레드 = 코어 절반 |
| K-3 | 새 화면 `#/ask`(내 서재 · 논문 찾기), 논문 찾기 화면 [AI로 찾기], 읽기 화면 대화 그대로 |
| K-4 | 색인 = 작업 큐 `index`(사용자당 진행 중 1개, 엔진 `local`) |
| K-5 (고침) | 조각 글은 어디에도 저장하지 않음 — `page_texts` 오프셋만(벡터 파일 메타에) |
| K-6 (고침) | 벡터 검색 = 서버 메모리 numpy 정확 검색(DB 벡터 · HNSW 없음) |
| K-7 | 재정렬은 RRF만 |
| K-8 | "현재 논문" 범위는 지금 대화 그대로 |
| K-9 | 검색어 3개(2~4), 소스별 20편, 요약 8편 |
| K-10 | 관련도 = 임베딩 유사도(모델 없으면 RRF) |
| K-11 | AI로 찾기 결과 저장 안 함 — 24시간 뒤 질문까지 비움 |
| K-12 | AI로 찾기는 공용 캐시를 읽지도 쓰지도 않음 |
| K-13 | AI로 찾기 = 백그라운드 + 폴링, CLI는 같은 행 두 단계 |
| K-14 | 직접 인용 = 문자열 대조, 간접 = AI 일괄(1회 40문장), 캐시 `manuscript_citations` |
| K-15 | `find` · `verify` 기본 `[claude]`, 범위 질문은 `chat` 설정 공유 |

### 20.3 새 팀장 결정 (R2 방식에서 생김 — 기획팀 추천안대로 확정(2026-10-08))
| # | 항목 | 결정 |
|---|---|---|
| K-16 | 조각 메타 위치 | **벡터 파일에만**(DB `chunks` 표 없음) — 8.3절 |
| K-17 | 키 · 교체 방식 | `users/{uid}/rag/{paper_id}.v{RAG_VERSION}.{gen}.bin`(세대 토큰 추가), 새 키에 쓰고 DB `papers.rag_key` 포인터를 바꾼 뒤 옛 키 삭제 — 8.1 · 8.4절 |
| K-18 | 메모리 캐시 | 상한 512MB, 사용자 단위 LRU, 30분 유휴 내림, 메모리는 float32 — 9.3절 |
| K-19 | 로드 방식 | 지연 로드 + `#/ask` 열 때 미리 불러오기, 동시 8, 서버 시작 때 전체 로드 안 함, 서버 PC 디스크 캐시 없음 — 9.4절 |
| K-20 | 백업 · 고아 정리 | 벡터 파일은 DB 백업 대상 아님(다시 색인), 고아는 `admin orphans` 확장 |
| K-21 | 캐시 무효화 범위 | 서버 프로세스 하나 전제, 프로세스 안에서만. 정확성은 DB 포인터 검사로 보장 — 9.5절 |

### 20.4 확인 필요 (개발팀 첫 주 — 결과를 이 문서에 적음)
1. PGroonga 색인 파일이 Supabase DB 크기에 잡히는지, `page_texts` 실제 크기(AC-D05).
2. 서버 PC CPU · 메모리(관리자) → AC-I08 · 캐시 상한 조정.
3. EmbeddingGemma ONNX 판의 게이트 여부 · CPU 속도 · `fastembed` 지원 여부.
4. `get_text("blocks")` 글이 `page_texts` 안에서 찾아지는 비율(AC-I02에 기록).
5. `pgroonga_score`가 `&@~` 질의와 함께 1단계 색인(TokenNgram)에서 동작하는지.
6. 서버 PC → R2 GET 지연(1편 63KB)과 300편 로드 시간(AC-S07), R2 무료 요청 한도 · 초과 요금.

---

## 21. 작업 목록 (파일 단위 — 디자인 · 개발이 같은 파일을 동시에 고치지 않음)

### 디자인팀 (먼저)
- `docs/design/phase3-ask-ui.md`(신규): `#/ask`(탭 · 범위 · 색인 상태 · "불러오는 중" · 출처 카드 · 진행 · 경고 · "초록 기반"), 읽기 화면 위치 표시, 쓰기 화면 [인용 검증] · 검증 목록 · 미리보기 표시 · 상태 아이콘 5종, 설정 두 줄 · 작업 이름표 문구, CSS 클래스.
- `paperlab/static/css/app.css`.

### 개발팀
| 파일 | 할 일 |
|---|---|
| `supabase/migrations/20261010000001_rag.sql`(신규) | 14.1절 |
| `paperlab/storage.py` | `rag/` 키 규칙 · `rag_key()` · `check_user_key` 확장, `UserStorage.put`의 content-type 인자 |
| `paperlab/rag.py`(신규) | 상수, ONNX 모델 · `HashEmbedder`, 조각 만들기, 파일 쓰기 · 읽기 · 검사, `VectorCache`(지연 로드 · 상한 · LRU · 유휴), `ensure_index_job` · 논문 색인 · 교체, 범위 → 논문 목록, 혼합 검색 · RRF · 조사 떼기, 질문 프롬프트, `[n]` 해석 |
| `paperlab/verify.py`(신규) | 문장 · 인용 뽑기 · 해시, 직접 인용 대조, 검증 프롬프트 · 해석, `GET` 모양 |
| `paperlab/find.py`(신규) | 검색어 프롬프트 · 검사, 다중 검색 · 합치기 · 선별, 요약 프롬프트 · 번호 검사 |
| `paperlab/pdf.py` | 쪽별 글 블록 + 쪽 크기 함수 |
| `paperlab/db.py` | `set_pdf` · `delete_paper`가 `rag_key`도 처리, 범위 세션 · 메시지, `manuscript_citations` |
| `paperlab/ai.py` | `write` 스트림을 범용 `complete(system, prompt, engine, schema=None)`로 |
| `paperlab/config.py` | `JOB_KINDS`에 `find` · `verify`, 기본 라우팅 |
| `paperlab/jobs.py` | 새 종류 기한 · 시간 제한, `text_request` · `cli_task`(범위 출처 고정 · `find` 두 단계 · `verify` JSON), `_apply`, `index` 경로, 정리에 `find` 24시간 비우기 |
| `paperlab/api_runner.py` | `index`(동시 1개) · `find` · `verify` · 범위 `chat` |
| `paperlab/server.py` | 14.3절 경로, PDF 붙이기 · 논문 삭제 뒤 파일 정리 · `ensure_index_job` · 캐시 갱신, 임베더 · 캐시 주입 |
| `paperlab/admin.py` | `rag-reindex --all`, `orphans`에 `rag/` |
| `pyproject.toml` | `onnxruntime` · `tokenizers`(또는 `fastembed`), `numpy` 명시 |
| `deploy/server-pc/README.md` · `update.ps1` | 모델 파일 받기(관리자 · 게이트 동의), 없으면 WARN |
| `paperlab/static/js/ask.js`(신규) | `#/ask` |
| `paperlab/static/js/app.js` | 경로 · 사이드바 |
| `paperlab/static/js/reader.js` | `goToSpot`, 열 때 대기 위치 처리, "여러 논문에 질문 →" |
| `paperlab/static/js/discover.js` | 결과 카드 export, [AI로 찾기] |
| `paperlab/static/js/writing.js` | [인용 검증] · 목록 · 미리보기 표시 · 근거 → 참고 패널 |
| `paperlab/static/js/dialogs.js` · `jobs.js` | 작업별 엔진 두 줄, 이름표 |
| `tests/test_rag.py` · `tests/test_rag_api.py` · `tests/js/ask.test.mjs`(신규), `tests/test_js_node.py` | 16 · 17장 |

### 품질팀
- 16장 `[자동]` · `[db]` 전부, `[실환경]` AC-D05 · S07 · I08 · Q09, 18장 수동 확인.

### 기획팀 (후속)
- 1단계 명세 7장(R2 키 규칙에 `rag/`) · 1B 명세 8.6절 점검표에 3단계 항목, `FEATURES.md`(구현 뒤).

## 22. 변경 기록
- 2026-10-08 초안(기획팀).
- 2026-10-08 개정: U-1 = D 확정, U-2 = R2 파일 + 서버 메모리(pgvector · `chunks` 표 · halfvec 삭제), K-1~K-15 확정(K-5 · K-6 고침), K-16~K-21 추가 · 같은 날 팀장 확정, 7장 용량 · 메모리 다시 계산, 8 · 9장(벡터 파일 · 캐시 · 보안) 신설, AC-S01~S10 추가.

## 23. 확인한 외부 자료 (2026-10-08)
| 내용 | 출처 |
|---|---|
| OpenAI `text-embedding-3-small` $0.02 / 100만 토큰, `3-large` $0.13 | [OpenAI API pricing](https://developers.openai.com/api/docs/pricing), [모델 페이지](https://developers.openai.com/api/docs/models/text-embedding-3-small) |
| `3-small` 1536차원 · MIRACL 44.0(3-large 54.9, ada-002 31.4) | [Pinecone](https://www.pinecone.io/learn/openai-embeddings-v3/), [Vercel](https://vercel.com/ai-gateway/models/text-embedding-3-small/about) (OpenAI 원문은 403으로 직접 확인 못 함) |
| Gemini 임베딩 모델 · 차원 · 입력 길이 | [Gemini API Embeddings](https://ai.google.dev/gemini-api/docs/embeddings) |
| `gemini-embedding-2` $0.20 / 100만, 무료 등급 내용은 제품 개선에 쓰임 | [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Anthropic은 자체 임베딩 모델 없음(Voyage AI 안내), voyage-4-nano 오픈 가중치 | [Claude 문서 Embeddings](https://platform.claude.com/docs/en/build-with-claude/embeddings), [voyage-4-nano](https://huggingface.co/voyageai/voyage-4-nano) |
| EmbeddingGemma-300M: 768(512/256/128 MRL), 2,048토큰, MTEB 다국어 v2 61.15/60.71, Gemma 약관 · 게이트, 양자화 시 200MB 미만, float16 활성값 미지원(파일 저장 형식과는 무관) | [모델 카드](https://huggingface.co/google/embeddinggemma-300m), [HF 블로그](https://huggingface.co/blog/embeddinggemma), [Google](https://deepmind.google/models/gemma/embeddinggemma/), [ONNX 판](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX) |
| bge-m3: MIT, 1024차원, 8,192토큰 | [모델 카드](https://huggingface.co/BAAI/bge-m3) |
| 한국어 검색 비교(제3자 표 — 참고만) | [KURE-v1](https://huggingface.co/nlpai-lab/KURE-v1), [KURE-v2](https://huggingface.co/nlpai-lab/KURE-v2) |
| fastembed(Python) 다국어 모델 목록 | [FastEmbed Supported Models](https://qdrant.github.io/fastembed/examples/Supported_Models/) |
| R2 무료 한도(저장 10GB · egress 무료) | PLAN 7장(1단계 확인). 요청 수 한도는 확인 필요 |
| OpenAlex 검색 단가 · 하루 예산, S2 한도 | 1B 명세 7.1 · 7.2절 |
