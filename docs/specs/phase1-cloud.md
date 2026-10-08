# 기능 명세 — 1단계 클라우드 기반 (Supabase Auth · Postgres · R2 · 서버 PC + Tailscale Funnel)

- 단계: 1단계 ([PLAN.md](../../PLAN.md) 6장 "1단계")
- 작성: 기획팀 · 2026-10-07
- 개정: 2026-10-07 사용자 답변(Q1~Q8)과 팀장 결정(T1~T15 — 기획팀 추천안 전부 채택) 반영 — 19장. 같은 날 사용자 결정 추가: **테스트는 별도 테스트용 Supabase 프로젝트**(Docker 안 씀). 사용자 최종 결정: **PDF · DB 백업은 R2**(Supabase Storage 안 씀 — 잠시 검토한 안은 대안으로만), **CI는 지금 안 함**. 구현 후 사용자 결정(Q12 · Q13): **DB 백업은 매일 04:00 KST · 최근 14개 보관**(M1 해결), 다른 사용자 PC용은 **2단계 Electron 설치형 앱**(1단계는 웹 + 이 PC 바탕화면 바로가기 그대로). 팀장 결정: 13.2절 주소 예시를 자리표시로(AC-69). 품질팀 제보(F2 · F3 · F6 · F9 · F10)와 팀장 결정 반영: 앱 역할 비밀번호는 명시적 명령일 때만 회전(M3 변경), JWKS 재요청 최소 30초(F2), SSRF 방어(F3), 폴더 이름 규칙(F6), 외부 호출 중 연결 반납(F9), 개발 서버 규칙(F10), 백업 파일 날짜 KST
- **개정 2026-10-07 (호스팅 변경 — 사용자 결정)**: **Cloud Run을 쓰지 않습니다.** 서버는 **상시 켜 둔 별도 Windows PC(이하 "서버 PC")** 에서 **Docker 없이 Python 가상환경으로 직접** 실행하고, **Tailscale Funnel**의 공개 고정 HTTPS 주소 `https://<PC이름>.<tailnet>.ts.net`으로 엽니다. Supabase(DB · 인증)와 R2(PDF · 백업)는 그대로. Cloud Run 배포 파일(Dockerfile · `.dockerignore` · `deploy.ps1` 등 Cloud Run · Secret Manager · Cloud Scheduler · Artifact Registry 관련)은 **지웁니다**(예비로 남기지 않음). 서버 PC에는 Claude Code를 설치해 [서버 PC 설치 안내서](../../deploy/server-pc/README.md)대로 설치합니다. 바뀐 곳: 1 · 2장, 3장 표, 4장, 5.1 · 5.2절 4번, 6.1 · 6.5절, 7.2 · 7.5 · 7.6절, 8.2~8.4절, **9장(서버 실행) · 13장(배포 · 운영) 전면 개정**, 11.1절, 14장 D5 · D6, 16장 AC-12a · 38 · 43 · 54 · 55 · 58~61 · 69 · 71(+ 신규 AC-73~79), 17 · 18장, 19장(결정 기록 S · 새 질문), 20 · 21장. 같은 날 **사용자 결정 Q16: 가입 허용 목록(`ALLOWED_EMAILS`)을 쓰지 않음** — 관문은 Google OAuth 동의 화면 "테스트" 상태의 테스트 사용자 목록, 팀장 결정: 서버 허용 목록 검사는 `PAPERLAB_ALLOWLIST=off`일 때만 꺼짐(기본 on, 빈 목록을 전부 허용으로 보지 않음), Auth Hook은 연결하지 않는 것이 기본(바뀐 곳: 2 · 4장, 6.1~6.3절, 8.4절, 10.2절, 13.1 · 13.8절, D2, AC-03~06 · 80~82, 17 · 18 · 19장, 20.1절). 같은 날 승인자 조건 반영: 테스트 프로젝트 지역은 **뭄바이(ap-south-1, 사용자 결정 "그대로 둠")**, 팀장 결정을 확정처럼 쓴 두 곳 정정.
- 표기: **확정** = 사용자 결정(PLAN 2장), **팀장 결정** = 팀장이 정함(사용자 이견 시 변경), **기획팀 추천** = 선택지 중 기획팀 안(팀장 결정 전), **가정** = 기획팀이 임시로 정한 값(19장 질문으로 확인), **미정** = 사용자 확인 필요, **확인 필요** = 외부 서비스 사실을 공식 문서로 다 확인하지 못함(개발팀이 첫 작업 때 확인하고 이 문서를 고침)
- 비밀값: 이 문서는 `C:\Users\user\.paperlab\cloud.env`의 **변수 이름만** 씁니다. 값은 어떤 문서·코드·로그·커밋에도 쓰지 않습니다.

---

## 1. 목적

지금 PaperLab의 기능(검색 · 서재 · PDF 읽기 · 하이라이트 · 노트 · AI 요약 · 질문 · 인용 · 원고 · 양식 · 워드/한글 내보내기)을 **클라우드에서 계정별로 그대로** 쓰게 만듭니다.

- **확정**: 사용자용 프로그램은 클라우드뿐입니다(로컬 실행 모드 없음). PC에는 2단계 CLI 워커 · 6단계 폴더 동기화만 둡니다.
- **확정**: 사용자 3~5명, 서재는 완전히 각자. 공개 서지 · 인용 관계만 공용 캐시(1B단계 — 개정 2026-10-07, 개정 전: 5단계).
- **확정**: **서버 PC(상시 켜 둔 Windows PC, Python 직접 실행) + Tailscale Funnel**(사용자 결정 2026-10-07 — Cloud Run에서 변경) + Supabase 무료 플랜(운영 프로젝트 서울) + **Cloudflare R2**(PDF · DB 백업, 무료 10GB — 사용자 최종 결정 2026-10-07).
- **확정(제약)**: 서버가 PC 한 대에서 돌므로 **서버 PC가 꺼지거나(전원 · 재부팅 · 인터넷 끊김) 서버 프로세스가 멈추면 모든 사용자가 PaperLab을 쓸 수 없습니다**. 데이터(DB · PDF · 백업)는 클라우드(Supabase · R2)에 있어 서버 PC가 고장 나도 남습니다(사용자에게 설명하고 받은 결정 — 18장 위험).
- **팀장 결정**: Supabase Auth 구글 로그인 기본 + 이메일 보조, 허용 이메일 목록으로 가입 제한 · 모든 개인 표 `user_id` + RLS · 서버 경유 질의도 요청마다 사용자 권한으로 RLS 적용 · PDF 다운로드는 R2 서명 주소.
- **확정(2026-10-07, Q2)**: 1단계는 **구글 로그인만**. 이메일 로그인은 사용자가 도메인을 준비한 뒤 **Resend**(메일 발송 서비스, 도메인 인증 필요)로 붙입니다 — 이후 작업(17장).
- **확정(Q1)**: 기존 데이터 **없음, 새로 시작** — 이관 도구를 만들지 않습니다.
- 1단계를 마치면: **사용자 각자의 PC를 꺼도 (서버 PC가 켜져 있으면)** 어느 기기에서나 로그인해 같은 서재 · 원고를 보고, **API 키를 등록한 사람은** AI 요약 · 질문 · 글쓰기 도우미를 씁니다.

## 2. 범위

### 하는 것
1. **DB 이관**: `paperlab/db.py`를 SQLite → Supabase Postgres로. 스키마는 SQL 마이그레이션 파일로 관리, 모든 개인 표에 `user_id` + RLS(5장).
2. **전문 검색**: SQLite FTS5 trigram → **PGroonga**. 한국어 2글자 검색 · 영문 부분 일치 · 메모/하이라이트 검색 유지(5.7절).
3. **폴더(신규)**: 논문 파일의 실제 위치(논문당 한 곳). 만들기 · 이름 바꾸기 · 옮기기 · 지우기, 논문을 폴더로 옮기기, 폴더로 걸러 보기. 컬렉션은 지금 그대로.
4. **인증**: 로그인 화면(**구글만** — 확정 Q2), 로그아웃, 가입 관문 = **Google OAuth 테스트 사용자**(확정 Q16) + 서버 허용 목록 스위치 `PAPERLAB_ALLOWLIST`(운영은 `off`, 켜면 동작하는 선택 기능), 서버 JWT 검증, 요청 보안 규칙 교체(6장).
5. **파일**: PDF를 **R2**에(`users/{user_id}/papers/{paper_id}.pdf`), 서명 주소로 직접 업로드 + 서버가 R2에서 읽어 추출(P11 — 7.2절), 서명 주소 다운로드, 삭제, 저장 공간 사용량 경고(10GB 기준), 저장소 교체 계층 `STORAGE_BACKEND`(기본 `r2`, 7장).
6. **설정 · 비밀**: `settings.json` → `profiles.settings`, API 키 → `user_secrets`(암호화).
7. **배포 · 운영 (서버 PC)**: 실행 진입점(9장), 서버 PC 설치 · 자동 시작 · Funnel 설정 · 업데이트 스크립트, 비밀값 파일 `%USERPROFILE%\.paperlab\cloud.env`(Secret Manager 대체), 상태 확인 주소 · 감시, **매일 자동 DB 백업**(확정 Q3 · Q12, 작업 스케줄러 — 13.3절), 배포 후 **바탕화면 웹 바로가기**(확정 Q6, 11장), Cloud Run 배포 파일 삭제.
8. **AI**: 사용자 본인 API 키로 요약 · 질문 · 글쓰기 도우미. 요약의 백그라운드 스레드 문제 해결(9.3절).
9. **개발 · 테스트 환경**: **테스트용 Supabase 프로젝트**(운영과 별도), 기존 테스트의 Postgres 이식, RLS · 인증 · 저장소 테스트(10장).
10. **설치형 실행기 정리**(11장). 기존 데이터 가져오기는 **하지 않음**(확정 Q1, 12장).

### 안 하는 것 (뒤 단계)
- CLI 엔진 · 작업 큐(`jobs`) · 기기 토큰(`devices`) · 워커 — 2단계. 1단계 클라우드에서는 **CLI 엔진을 쓸 수 없습니다**(설정 화면에서 "2단계 PC 연결 후" 안내).
- RAG(`chunks`, pgvector) · 인용 검증 — 3단계. 쉬운 설명 · 번역 — 4단계. 국내 DB — 5단계. **인용 그래프 · 공용 캐시 표(`external_works` · `citation_edges`) — 1B단계**(개정 2026-10-07: PLAN 단계 순서 변경, [1B 명세](citation-graph.md) 8장). 폴더 동기화(`sync_state`) — 6단계.
- 서재 공유 · 협업 · 실시간 동시 편집(Supabase Realtime 미사용). 같은 원고를 두 기기에서 동시에 고치면 **나중 저장이 이김**(지금과 같음).
- 계정 삭제 화면, 관리자 화면, 결제, 사용자 정의 도메인(Funnel 주소 `<PC이름>.<tailnet>.ts.net`만 — Funnel은 tailnet 도메인 이름만 지원, 13.2절), 다국어 화면.
- 서버 이중화(서버 PC 두 대 · 자동 대체), 서버 PC 원격 장애 알림(19.4절 질문).
- 이메일 로그인(확정 Q2 — 도메인 준비 후 Resend로, 이후 작업), 기존 데이터 이관(확정 Q1).

### 뒤 단계를 막지 않기 위한 장치
| 뒤 단계 | 1단계에서 미리 해 두는 것 |
|---|---|
| 2 작업 큐 · 워커 | AI 호출을 `AIService` 한 곳에 모으고, 사용자별 설정 · 키를 요청마다 주입(전역 설정 없음). `user_secrets`는 `name`으로 늘릴 수 있는 행 구조 |
| 3 RAG · 인용 검증 | `page_texts`를 쪽 단위로 유지(PGroonga 색인), `chat_sessions.scope` 열(1단계는 `paper`만), id는 `bigint`라 `chunks.paper_id` 외래 키가 단순 |
| 1B 공용 캐시 (개정 2026-10-07 — 5단계에서 앞당김) | 공용 표는 `user_id` 없는 별도 표로 추가만 하면 됨. **개정(1B 명세 K-4 — 팀장 결정)**: 공용 표도 **같은 `paperlab` 스키마에 PLAN 이름 그대로**(`external_works` · `citation_edges`, 접두어 · 별도 스키마 없음) — Data API 비노출이 그대로 적용. 개인 표 RLS 규칙과는 정책 · 권한으로 구분(읽기 = `authenticated` select만, 쓰기 = `system_tx`만 — [1B 명세](citation-graph.md) 8.4절). (개정 전: "5단계에서 같은 스키마에 `shared_` 접두어 또는 별도 스키마") |
| 6 폴더 동기화 | `folders`에 같은 부모 아래 이름 중복 금지, 저장 키는 폴더와 무관(`paper_id` 기준) → 폴더를 옮겨도 파일 이동 없음 |

## 3. 지금 코드 (바뀌는 지점)

| 위치 | 지금 | 1단계 |
|---|---|---|
| `paperlab/server.py` `local_only` 미들웨어 | Host가 `127.0.0.1`·`localhost`만, Origin 검사, 쓰기 요청에 `X-PaperLab: 1` | Bearer 토큰 검증 + 같은 출처 검사 + `X-PaperLab` 유지(6.5절) |
| `server.py` `create_app(data_dir)` | 데이터 폴더 하나 = 서재 하나, `Settings`·`Database`·`Sources`·`AIService`를 앱 전체에 하나씩 | 환경 변수 설정으로 시작, **요청마다** 사용자 DB 트랜잭션 · 사용자 설정 · `Sources` · `AIService`를 만듦 |
| `server.py` `Jobs` | 요약을 **프로세스 안 스레드**로 돌리고 메모리에 진행 상황 | 1단계 구현은 요청 안 SSE(9.3절 — 결정 당시 Cloud Run 제약 기준). 서버 PC에서는 2단계에서 작업 큐 + 서버 프로세스 안 실행기로(2단계 명세 15장) |
| `server.py` `compose_store` | 워드·한글 문서를 메모리에 10개까지(토큰) | 사용자별로 분리(토큰 + `user_id`), 크기 60MB → **30MB**(결정 당시 근거는 Cloud Run 32MiB 한도 — 서버 PC에서도 **유지**, 7.5절 · 팀장 결정 S8) |
| `server.py` `store_pdf` · `pdf_path_of` | `data_dir/pdfs/{id}-{slug}.pdf` | 저장소 키(7.1절) |
| `server.py` 인용 스타일 | `data_dir/styles/*.csl` | DB `user_styles`(7.7절) |
| `paperlab/db.py` | SQLite, `INTEGER PRIMARY KEY`, JSON은 TEXT, FTS5 trigram, `MIGRATIONS` 사전, `_write_lock` | Postgres(psycopg 3), `bigint identity`, `jsonb`, PGroonga, SQL 마이그레이션 파일, 잠금 없음 |
| `paperlab/config.py` | `settings.json`(비밀 키 평문 포함), `default_data_dir()` | 서버 설정 = 환경 변수, 사용자 설정 = `profiles.settings`, 비밀 = `user_secrets`(암호화) |
| `paperlab/ai.py` `AIService.status` · `_client` | 설정 키가 없으면 **서버 환경 변수 `ANTHROPIC_API_KEY`** 사용, CLI 엔진 지원 | 클라우드에서는 환경 변수 키를 **쓰지 않음**(다른 사용자 비용으로 돌면 안 됨), CLI 엔진은 "2단계" 안내 |
| `paperlab/__main__.py` | 포트 찾기, 브라우저 열기, `--window`(pywebview) | 개발용 서버 실행만(11장) |
| `PaperLab.bat` · `PaperLab.command` · `paperlab.sh` | 가상환경 만들고 로컬 서버 실행 | 11장 |
| `static/js/api.js` | `X-PaperLab: 1` 헤더 | + `Authorization: Bearer <access token>`, 401 처리 |
| `static/js/reader.js` · `library.js` | `/api/papers/{id}/pdf`를 pdf.js · `window.open`으로 직접 열기, 하이라이트 내보내기도 `window.open` | 헤더를 못 붙이는 GET이라 **서명 주소 / fetch + Blob**으로(6.7절) |
| `static/js/dialogs.js` 설정 창 | "데이터" 구역에 데이터 폴더 경로 | 제거, "계정" 구역으로(14장) |
| `tests/` | `tmp_path`에 SQLite, `TestClient(headers={"X-PaperLab": "1"})` | 테스트용 Supabase 프로젝트 + 가짜 저장소 + 실제 JWT(10장) |

## 4. 요청 흐름

```
브라우저 ──(1) 구글/이메일 로그인──▶ Supabase Auth ──▶ access token(JWT, 기본 1시간) + refresh token
   │
   │(2) https://kimjuhyeon.tailac17f6.ts.net/api/* + Authorization: Bearer <JWT> + X-PaperLab: 1
   ▼
Tailscale Funnel (TLS 종료 — 서버 PC의 tailscaled) ──▶ http://127.0.0.1:8080
   ▼
서버 PC: uvicorn + FastAPI (python -m paperlab.serve, 9장)
   ├ (3) JWT 서명·만료·aud·iss 검증 → claims(sub = user_id, email)
   ├ (4) PAPERLAB_ALLOWLIST가 on일 때만: email이 허용 목록에 있는지 (운영은 off — 관문은 Google 테스트 사용자, 6.3절)
   ├ (5) 연결 풀에서 연결 → BEGIN
   │       SET LOCAL ROLE authenticated
   │       SELECT set_config('request.jwt.claims', '<검증된 claims JSON>', true)
   │       … 질의 (RLS가 user_id = auth.uid() 행만 보이게 함) …
   │     COMMIT (실패 시 ROLLBACK) → 연결 반납
   ├ (6) PDF가 필요하면 R2에서 직접 읽기(서버, 키는 JWT의 uid로만 생성) / 브라우저엔 서명 주소만 줌
   └ (7) AI는 그 사용자의 복호화한 API 키로 Anthropic 호출
브라우저 ──(8) 서명 주소(10분)──▶ R2 에서 PDF 직접 받기 · 올리기
```

---

## 5. 데이터 계층

### 5.1 드라이버 · 연결 방식

| 항목 | 결정 |
|---|---|
| 드라이버 | **psycopg 3** (`psycopg[binary]`) + **`psycopg_pool.ConnectionPool`**(동기). 지금 엔드포인트가 동기 `def`(스레드 풀에서 실행)라 그대로 맞습니다. (**팀장 결정** T15 — asyncpg는 엔드포인트를 전부 `async`로 바꿔야 해서 제외) |
| 연결 대상 | **Supabase 공유 풀러(Supavisor) Session 모드**(풀러 주소의 5432 포트). 사용자는 `cloud.env`의 `SUPABASE_DB_URL`에 대시보드 Connect 화면의 "Session pooler" 연결 문자열(관리자 `postgres` 계정)을 넣고, 서버는 그 주소에서 계정만 **앱 전용 역할**로 바꾼 주소를 씁니다(5.2절 4번, 13.1절). (**팀장 결정** T15) |
| 풀 크기 | 인스턴스당 최소 1, 최대 5(가정). 최대 인스턴스 1~2(9.2절)라 DB 연결은 많아야 10 |
| 풀 반납 시 | `reset` 콜백에서 `ROLLBACK` 후 `RESET ROLE; RESET ALL;` — 앞 요청의 상태가 다음 요청에 남지 않게 |

**연결 방식 선택 근거** (Supabase 공식 문서 "Connecting to Postgres" 확인, 2026-10-07):

| 방식 | 공식 문서 내용 | 이 프로젝트에서 |
|---|---|---|
| 직접 연결(5432) | 오래 도는 서버 · 컨테이너용으로 권장. 단 **무료 플랜은 IPv6 전용**(IPv4는 유료 애드온) | (결정 당시 근거: Cloud Run 기본 외부 연결이 IPv4) 서버 PC도 가정 · 사무실 인터넷의 IPv6 지원이 보장되지 않음 → **계속 비추천**. 연결 방식은 바꾸지 않음(서버 PC 전환 후에도 Session pooler) |
| 공유 풀러 Session 모드(5432) | IPv4 지원, 세션을 그대로 유지 | **추천**. 준비된 문(prepared statement) 제약 없음. 우리 쪽 풀이 연결 몇 개만 쓰므로 풀러 한도 안 |
| 공유 풀러 Transaction 모드(6543) | IPv4 지원, 서버리스용. **prepared statement 미지원**, "세션 수준 상태(`SET`·`RESET`, 세션 advisory lock, `LISTEN/NOTIFY`, 임시 표)는 트랜잭션 사이에 사라짐" | 가능하지만 psycopg의 `prepare_threshold=None` 필수. 인스턴스가 많이 늘 때의 대안 |

**`SET LOCAL` 호환성**: 우리 방식(`SET LOCAL ROLE` + `set_config(…, true)`)은 **트랜잭션 안에서만** 유효한 설정이라, 두 풀러 모드 모두에서 같은 트랜잭션 안의 질의에 적용됩니다(Transaction 모드도 한 트랜잭션은 한 백엔드에서 실행). 문서가 경고하는 것은 트랜잭션 **밖**의 세션 상태입니다. (기획팀 해석 — **AC-12**로 실제 풀러에서 확인)
반대로 **세션 수준 `SET`(LOCAL 없이)은 코드에서 금지**합니다. Transaction 모드에서는 다른 요청으로 새고, Session 모드에서도 우리 풀의 다음 요청으로 샙니다(**AC-13**: 코드 검색으로 확인).

### 5.2 사용자 권한 트랜잭션

`paperlab/db.py`가 제공하는 연결 도우미(이름은 개발팀 재량, 아래는 동작 규칙):

1. `db.user_tx(claims)` — 모든 사용자 요청이 쓰는 유일한 경로. `BEGIN` → `SET LOCAL ROLE authenticated` → `SELECT set_config('request.jwt.claims', %s, true)`(검증된 claims JSON) → 질의 → `COMMIT`/`ROLLBACK`. **요청 하나 = 트랜잭션 하나**가 기본(FastAPI 의존성으로 처음 DB를 쓸 때 열고 응답 전에 닫음). 스트리밍 응답(SSE)은 DB 작업마다 짧은 트랜잭션을 따로 엽니다(긴 AI 호출 동안 트랜잭션을 잡고 있지 않음).
   - **외부 호출 중 연결 반납 (F9)**: 느린 외부 호출(학술 DB 검색 · 메타데이터 조회 · URL에서 PDF 받기 · R2에서 받기 · PDF 추출) **전에** 지금 트랜잭션을 커밋하고 연결을 풀에 돌려줍니다(`RequestCtx.release()`). 그 뒤 DB를 다시 쓰면 새 트랜잭션이 열리므로, 그 사이 바뀌었을 수 있는 것(논문 · 컬렉션 · 폴더가 지워졌는지)을 **다시 확인**합니다(없어진 논문은 404, 없어진 컬렉션 · 폴더에는 넣지 않음). 그래서 이런 요청은 트랜잭션이 둘 이상일 수 있습니다.
2. `db.system_tx(reason)` — 서버 안에서 사용자와 무관한 시스템 작업 전용(1단계는 상태 확인뿐). `BEGIN` → `SET LOCAL ROLE service_role`. 호출할 때 `reason` 문자열이 필수이고 **로그에 남깁니다**(PLAN "service role은 이유 기록"). 1단계 사용처는 20장 표에 적힌 곳뿐. 마이그레이션 · 관리 명령(`sync-allowlist` · `rotate-key` · `orphans`)은 서버 프로세스가 아니라 **별도 명령으로 관리자 연결**(`cloud.env`의 `SUPABASE_DB_URL`)을 써서 설치 · 업데이트 스크립트(13.1절) · 관리자가 서버 PC(또는 관리자 PC)에서 실행하고, 각 명령이 시작할 때 `reason`을 로그에 남깁니다. 백업 작업은 13.3절.
3. 서버 코드의 쿼리에도 `user_id = %(uid)s` 조건을 넣습니다(PLAN 4장 "서버 코드에서도 user_id로 한정" — RLS와 이중 방어). `INSERT`는 `user_id`를 명시합니다.
4. **앱 전용 로그인 역할 (팀장 결정 T3)**. Supabase의 `postgres` 역할과 `service_role`은 `bypassrls` 속성이 있습니다(공식 문서). 서버가 `postgres`로 붙으면 `SET LOCAL ROLE`을 빠뜨린 질의가 **모든 사용자 행을 봅니다**. 그래서 서버는 전용 역할로만 붙습니다.
   - 역할: `paperlab_app` — `LOGIN NOINHERIT NOBYPASSRLS`, 표 권한 없음, `grant authenticated to paperlab_app`(→ `SET LOCAL ROLE authenticated` 가능), `grant service_role to paperlab_app`(→ `system_tx`만 `SET LOCAL ROLE service_role`). NOINHERIT라서 `SET ROLE` 없이 질의하면 **권한 오류**가 납니다(누출이 아니라 오류).
   - 역할 생성 · 비밀번호: 마이그레이션 파일은 역할을 `NOLOGIN`으로만 만들고(비밀번호를 파일에 쓰지 않음), `admin app-role`이 관리자 연결로 무작위 비밀번호를 설정해 **앱용 연결 문자열을 만들어 서버 PC `cloud.env`의 `SUPABASE_APP_DB_URL` 줄에 바로 씁니다**(화면 · 로그에 찍지 않음, 파일 권한 유지 — 13.1절, **팀장 결정 S1**). (개정 전: Secret Manager `SUPABASE_DB_URL` — Cloud Run 폐기로 없어짐)
   - **비밀번호 회전은 명시적 명령일 때만**(팀장 결정, M3 변경): 배포 · 업데이트 · 테스트 때마다 바꾸지 않습니다. 바꾸는 순간 옛 비밀번호로 붙어 있던 서버 · 다른 테스트가 새 연결을 못 열기 때문입니다. 운영은 `cloud.env`에 `SUPABASE_APP_DB_URL`이 **비어 있을 때(첫 설치)** 또는 `python -m paperlab.admin app-role`을 직접 실행할 때만 새로 만들고, 회전하면 곧바로 **서버 작업을 다시 시작**합니다(백업 작업은 실행할 때마다 파일을 새로 읽으므로 따로 할 일 없음). 테스트 프로젝트는 10.2절 세션 준비 1번.
   - 변수 구분(S1 기획팀 추천 ①): `SUPABASE_DB_URL` = **관리자 주소**(마이그레이션 · 관리 명령만), `SUPABASE_APP_DB_URL` = **앱 역할 주소**(서버 · 백업). 서버는 `SUPABASE_DB_URL`을 **읽지 않고**, `SUPABASE_APP_DB_URL`의 사용자 이름이 **`paperlab_app.<ref>` 형식이 아니면(postgres · supabase_admin 등 다른 계정 모두) 시작하지 않습니다**(AC-74 — 구현 `config.is_app_role_user`, 백업 · `pg-dump-check`도 같은 규칙).
   - 풀러가 사용자 정의 역할(`paperlab_app.<프로젝트 ref>` 형식 사용자 이름)을 받는지는 **실환경에서 확인**(AC-12a). 안 받으면 팀장에게 보고(대안: Transaction 모드 · 직접 연결 재검토).
   - 그래도 연결 도우미 밖에서 연결을 여는 코드는 금지(**AC-13**).
5. `auth.uid()`는 `request.jwt.claims`의 `sub`를 읽습니다(Supabase 내장 함수). RLS 정책은 이것만 씁니다.

### 5.3 스키마 · 마이그레이션 관리

| 항목 | 결정 |
|---|---|
| 스키마 | 개인 표를 **`paperlab` 스키마**에 둡니다(`public` 아님). (**팀장 결정** T4) 근거: Supabase는 `public` 스키마를 Data API(PostgREST)로 공개하고, 화면은 anon 키를 가지고 있어 사용자가 **서버를 거치지 않고** 자기 행을 직접 쓸 수 있습니다. RLS 덕분에 남의 행은 못 보지만, 서버의 검증(양식 값 검사, 저장소 키 규칙 등)을 건너뛴 값을 넣을 수 있습니다. `paperlab` 스키마를 "Exposed schemas"에 넣지 않으면 이 길이 막힙니다. (RLS는 그래도 모두 겁니다 — 팀장 결정 원칙, PLAN 2장 "보안 원칙") |
| 파일 위치 | `supabase/migrations/<YYYYMMDDHHMMSS>_<이름>.sql` (Supabase CLI 이름 규칙과 같게) |
| 적용 도구 | **`paperlab/migrate.py`(신규)**: 파일 이름 순으로 아직 적용 안 된 것만 한 트랜잭션씩 실행, 기록은 `paperlab.schema_migrations(version text primary key, applied_at timestamptz)`. 테스트 프로젝트와 운영 프로젝트가 **같은 파일 · 같은 도구**를 씁니다. 실행: `python -m paperlab.migrate`(관리자 연결 — `cloud.env`의 `SUPABASE_DB_URL`, 배포 스크립트에서만). (**팀장 결정** T5 — Supabase CLI `db push`는 쓰지 않음) |
| 규칙 | 적용한 파일은 고치지 않음(새 파일로 변경). 각 파일은 다시 실행해도 안전하게(`if not exists`) 쓰지 않아도 됨 — 기록 표가 막아 줌. **개인 표를 만드는 파일은 같은 파일 안에 `enable row level security` + 정책**을 둠(AC-20) |
| 첫 파일들 | `…_extensions.sql`(`create extension if not exists pgroonga with schema extensions;`), `…_app_role.sql`(5.2절 4번 `paperlab_app` NOLOGIN + 부여), `…_schema.sql`(5.5절 표), `…_rls.sql`(5.6절, `service_role`에 `paperlab` 스키마 읽기 · 쓰기 권한 포함 — 백업 · 시스템 작업용), `…_search.sql`(5.7절 색인), `…_auth_hook.sql`(6.3절) |

### 5.4 id · 시간 · JSON 규칙

| 항목 | 결정 | 근거 |
|---|---|---|
| 개인 데이터 id | **`bigint generated always as identity`** (모든 사용자가 한 순번을 같이 씀) | 화면이 정수 id를 가정함(`#/read/(\d+)`, `Number(dataset.id)`, 양식 id `user-{번호}`). uuid로 바꾸면 화면 · API · 양식 id 규칙을 모두 고쳐야 함. 순번이 전역이라 지운 id를 다시 쓰지 않음(지금 `doc_formats` AUTOINCREMENT 의도와 같음). 단점: id로 전체 행 수를 짐작할 수 있음 — 3~5명이라 문제없음 (**팀장 결정** T6) |
| 사용자 id | `uuid` = `auth.users.id` (JWT `sub`) | Supabase 규칙 |
| 같은 사용자 확인 | 부모 표에 `unique (id, user_id)`, 자식 표는 **복합 외래 키** `(paper_id, user_id) references papers (id, user_id) on delete cascade` | 외래 키 검사는 RLS를 거치지 않으므로, 내 논문을 남의 컬렉션 id에 잇는 식의 행을 DB가 막게 함 |
| 시간 | `timestamptz not null default now()`. **API 응답은 지금 모양 그대로**: UTC, 초 단위 ISO 문자열 `2026-10-07T01:02:03+00:00` | 화면 · 테스트가 문자열을 비교함 |
| `doc_formats.updated_at` | 지금 규칙 유지: 같은 초에 두 번 바꿔도 응답 값이 달라지게(이전 값 ≥ 지금이면 +1초) | 0단계 AC-08 |
| JSON | `jsonb` (`authors`, `keywords`, `rects`, `citations`, 요약 `data`, `cover`, 양식 `data`, `settings`) | PLAN |
| 삭제 | 사용자가 지우면 즉시 지움(휴지통 없음 — 지금과 같음). `auth.users` 행이 지워지면 개인 행은 `on delete cascade` | |

### 5.5 1단계에 만드는 표와 열

모든 표는 `paperlab` 스키마. "공통 열" = `user_id uuid not null references auth.users(id) on delete cascade`. 표시가 없으면 `created_at` · `updated_at`은 `timestamptz not null default now()`.

**`profiles`** — 사용자 정보 · 설정
| 열 | 형 | 비고 |
|---|---|---|
| `user_id` | uuid PK, `auth.users(id)` cascade | |
| `email` | text not null | 로그인 이메일(표시용) |
| `display_name` | text not null default '' | 구글 이름 |
| `settings` | jsonb not null default '{}' | 8.1절 키만. 빠진 키는 서버가 기본값으로 채움 |
| `created_at`, `updated_at` | | |
행 생성: 서버가 로그인한 사용자의 첫 요청에서 `insert … on conflict do nothing`(트리거로 `auth` 스키마를 건드리지 않음).

**`user_secrets`** — 암호화한 비밀값(8.2절)
| 열 | 형 | 비고 |
|---|---|---|
| 공통 `user_id` | | |
| `name` | text not null | `anthropic_api_key` · `openalex_api_key` · `semantic_scholar_api_key` (2단계에 더 늘어남) |
| `ciphertext` | bytea not null | AES-256-GCM 암호문 + 태그 |
| `nonce` | bytea not null | 12바이트 |
| `key_id` | text not null | 암호화에 쓴 키의 지문(8.3절) |
| `hint` | text not null default '' | 끝 4자리(화면 "…ab12 저장됨" 표시용, 가정) |
| `updated_at` | | |
| PK | `(user_id, name)` | |

**`folders`** — 폴더(신규)
| 열 | 형 | 비고 |
|---|---|---|
| `id` | bigint identity PK | `unique (id, user_id)` |
| 공통 `user_id` | | |
| `name` | text not null | 6단계 PC(Windows) 폴더 이름으로 그대로 쓸 수 있게(F6): 1~100자, `/ \ : * ? " < > |` · **제어 문자**(줄바꿈 · 탭 등) 금지, **마침표 · 공백으로 끝나기** 금지(`.` · `..` 포함), **Windows 예약 이름**(`CON` · `PRN` · `AUX` · `NUL` · `COM1~9` · `LPT1~9`, 확장자가 붙어도) 금지. 앞의 세 가지는 DB 검사 제약(마이그레이션 `20261008000001_folder_name_rules.sql`)과 서버가 함께, 예약 이름은 서버 코드(`db.folder_name_problem`)가 막음 → 400 |
| `parent_id` | bigint null | `(parent_id, user_id) references folders(id, user_id)` — 지울 때 규칙은 아래 |
| `created_at`, `updated_at` | | |
| 제약 | 같은 부모 아래 이름 중복 금지: `unique (user_id, coalesce(parent_id, 0), lower(name))` (색인) | |
폴더 삭제 규칙(**확정** Q5): 안의 논문과 하위 폴더를 **지운 폴더의 부모로 올립니다**(논문 · PDF는 절대 같이 지우지 않음). 부모가 없으면 "폴더 없음"(최상위)으로.

**`papers`** — 지금 열 전부 + 아래
| 열 | 변경 |
|---|---|
| `id` | bigint identity PK, `unique (id, user_id)` |
| 공통 `user_id` | 추가 |
| `authors`, `keywords` | jsonb not null default '[]' |
| `year`, `page_count`, `rating`, `cited_by_count` | integer (rating not null default 0) |
| `starred` | boolean not null default false (API는 지금처럼 true/false) |
| `issued`, `language` | text not null default '' (지금 MIGRATIONS 열을 처음부터) |
| `folder_id` | bigint null, `(folder_id, user_id) references folders(id, user_id)` (`on delete`는 위 삭제 규칙을 서버가 먼저 처리) |
| `pdf_path` | **삭제** → `pdf_key text not null default ''`(저장소 키), `pdf_sha256 text not null default ''`, `pdf_size bigint` |
| `title_norm` | text not null default '' — 서버가 `normalize_title(title)`로 채움(중복 찾기용, Python 정규식과 같은 결과를 내기 위해 DB 함수 대신 코드에서) |
| `added_at`, `updated_at`, `last_opened_at` | timestamptz (`last_opened_at` null 허용) |
| 색인 | `(user_id, doi)`, `(user_id, arxiv_id)`, `(user_id, title_norm)`, `(user_id, citekey)`, `(user_id, folder_id)`, `(user_id, added_at desc)` |
API 응답의 `has_pdf`는 `pdf_key <> ''`. `pdf_path`는 응답에서 빠지고 화면은 `has_pdf`만 씁니다(개발팀이 화면에서 `pdf_path` 사용처가 없는지 확인).

**`collections`** · **`paper_collections`**
- `collections`: `id` bigint identity, 공통 `user_id`, `name`, `parent_id`(복합 외래 키, `on delete cascade` — 지금처럼 하위 컬렉션도 지움, 논문은 안 지움), `created_at`.
- `paper_collections`: 공통 `user_id`, `paper_id`, `collection_id`, PK `(paper_id, collection_id)`, 두 복합 외래 키 cascade.

**`tags`** · **`paper_tags`**
- `tags`: `id`, 공통 `user_id`, `name`, `color text not null default ''`, **`unique (user_id, lower(name))`**(지금 `UNIQUE COLLATE NOCASE`를 사용자별로).
- `paper_tags`: 공통 `user_id`, `paper_id`, `tag_id`, PK `(paper_id, tag_id)`, 복합 외래 키 cascade.

**`annotations`**: `id`, 공통 `user_id`, `paper_id`(복합 FK cascade), `page int`, `kind`, `color`, `text`, `comment`, `rects jsonb default '[]'`, `created_at`, `updated_at`. 색인 `(paper_id, page)`.

**`notes`**: PK `paper_id`(복합 FK cascade), 공통 `user_id`, `content`, `updated_at`.

**`page_texts`**: 공통 `user_id`, `paper_id`(복합 FK cascade), `page int`, `text`, PK `(paper_id, page)`, PGroonga 색인(5.7절).

**`paper_search`**(신규, 검색용): PK `paper_id`(복합 FK cascade), 공통 `user_id`, `meta text not null default ''` — 지금 `papers_fts`의 `title · authors · abstract · keywords+tags · notes+하이라이트` 를 줄바꿈으로 이은 것. 본문(`fulltext`)은 여기 두지 않고 `page_texts`를 검색(용량 절약). PGroonga 색인.

**`ai_summaries`**: PK `paper_id`(복합 FK cascade), 공통 `user_id`, `data jsonb`, `model`, `created_at`.

**`chat_sessions`**(PLAN 1단계 표): `id` bigint identity, 공통 `user_id`, `scope text not null default 'paper' check (scope in ('paper'))`(3단계에 `collection` · `folder` · `library` 추가), `paper_id`(복합 FK cascade, null 허용 — 3단계용), `created_at`. 1단계는 논문당 세션 하나: `unique (user_id, paper_id) where scope = 'paper'`. 화면 · API는 지금처럼 논문 단위(서버가 세션을 자동으로 만듦).

**`chat_messages`**: `id` bigint identity, 공통 `user_id`, `session_id`(복합 FK cascade), `role`, `content`, `citations jsonb default '[]'`, `created_at`. 색인 `(session_id, id)`. (3단계에 출처 조각 열 추가)

**`manuscripts`**: `id`, 공통 `user_id`, `title`, `content`, `template`, `style`, `doc_format text not null default 'default'`, `cover jsonb not null default '{}'`, `created_at`, `updated_at`. 색인 `(user_id, updated_at desc)`.

**`doc_formats`**: `id`(전역 순번 — 양식 id `user-{id}`), 공통 `user_id`, `name`, `base`, `data jsonb`, `created_at`, `updated_at`. 사용자당 50개 제한(서버, 지금과 같음).

**`user_styles`**(신규, 7.7절): `id`, 공통 `user_id`, `style_id text`(지금 파일 이름 slug), `title`, `info jsonb`(목록 표시용 `read_info` 결과), `xml text`(최대 2MB), `created_at`, `updated_at`, `unique (user_id, style_id)`.

**`allowed_emails`**(시스템 표, 6.3절): `email text primary key`(소문자), `added_at`. **RLS 켜고 정책 없음**(사용자 역할로는 읽기 · 쓰기 불가), Auth Hook 함수와 관리자 연결(배포 스크립트의 `sync-allowlist`)만 읽고 씀.

### 5.6 RLS 정책

**모든 개인 표**(`profiles`, `user_secrets`, `folders`, `papers`, `collections`, `paper_collections`, `tags`, `paper_tags`, `annotations`, `notes`, `page_texts`, `paper_search`, `ai_summaries`, `chat_sessions`, `chat_messages`, `manuscripts`, `doc_formats`, `user_styles`)에 같은 틀:

```sql
alter table paperlab.<표> enable row level security;
alter table paperlab.<표> force row level security;   -- 표 소유자도 RLS 적용(가정, 개발팀이 postgres 역할에 미치는 영향 확인)
create policy own_rows on paperlab.<표>
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.<표> to authenticated;
```
- `(select auth.uid())`로 감싸는 것은 Supabase 공식 권장(문장 단위로 한 번만 계산).
- `anon` 역할에는 아무 권한도 주지 않습니다. `grant usage on schema paperlab to authenticated;` 만.
- 순번(identity) 사용 권한: `grant usage on all sequences in schema paperlab to authenticated;`
- `user_secrets`도 사용자 역할로 읽기 가능(암호문뿐이라 키 없이는 무의미). 화면에는 암호문을 보내지 않습니다.
- 새 개인 표를 만들 때 RLS를 빠뜨리지 않도록 **카탈로그 검사 테스트**(AC-20): `paperlab` 스키마의 모든 표가 `relrowsecurity = true`이고 정책이 1개 이상(시스템 표 `allowed_emails` · `schema_migrations`는 정책 0개 허용 목록). **개정 2026-10-07(1B)**: 공용 캐시 표 `external_works` · `citation_edges`는 `user_id` 없이 `authenticated` 읽기 정책 하나만 둠 — 예외 목록에 넣고 별도 검사([1B 명세](citation-graph.md) 8.4절 · AC-G20).

### 5.7 전문 검색 (PGroonga)

**지금 동작**(`db.py` `_search_ids`): 검색어를 공백으로 나눠 **모든 낱말이 있는 논문**(AND). 3글자 이상은 FTS5 trigram, 3글자 미만(한국어 2글자 등)은 `LIKE`. 대상 = 제목 · 저자 · 초록 · 키워드+태그 · 노트+하이라이트 글·메모 · 본문. 본문에서 찾은 경우 스니펫 `…[[낱말]]…`. 대소문자 구분 없음.

**1단계**:
1. 색인(공식 문서 확인한 문법). 영문 부분 일치(지금 trigram처럼 `transduc` → `transduction`)를 유지하려고 공식 문서가 권하는 `TokenNgram` 옵션을 씁니다.
   ```sql
   create index page_texts_pgroonga on paperlab.page_texts using pgroonga (text)
     with (tokenizer = 'TokenNgram("unify_alphabet", false, "unify_symbol", false, "unify_digit", false)');
   create index paper_search_pgroonga on paperlab.paper_search using pgroonga (meta)
     with (tokenizer = 'TokenNgram("unify_alphabet", false, "unify_symbol", false, "unify_digit", false)');
   ```
   정규화는 기본(`NormalizerAuto` — 대소문자 무시). 
2. 질의: 낱말마다 `(ps.meta &@ %(t)s OR exists (select 1 from paperlab.page_texts pt where pt.paper_id = ps.paper_id and pt.text &@ %(t)s))`를 **AND**로 잇습니다. 사용자가 친 `OR`, `-`, 괄호가 문법으로 해석되지 않도록 **`&@~`(질의 문법)가 아니라 `&@`(낱말 하나 일치)** 를 씁니다.
3. 1글자 낱말: PGroonga n-gram 색인이 1글자를 찾는지 **확인 필요**. 못 찾으면 그 낱말만 `ILIKE '%…%'`(지금 `LIKE`와 같은 대소문자 무시)로 찾습니다. 어느 쪽이든 결과는 지금과 같아야 합니다(AC-33).
4. 스니펫: 본문(`page_texts`)에서 찾은 논문은 **첫 번째로 맞는 쪽**의 텍스트에서 첫 3글자 이상 낱말 주변 약 16단어를 잘라 `[[낱말]]`로 감싸 서버 코드(Python)에서 만듭니다. 메타에서만 찾으면 스니펫 없음(지금과 같음).
5. `_reindex` 대응: 제목 · 저자 · 초록 · 키워드 · 태그 · 노트 · 하이라이트가 바뀔 때 `paper_search.meta`만 다시 씁니다. 본문은 `page_texts`에 쓰는 순간 색인됩니다(별도 재색인 없음).
6. 1000개 상한: 지금처럼 검색으로 찾은 id는 최대 1000개, 그다음 정렬 · 쪽 나누기.

### 5.8 지금 쿼리 동작 보존 목록

| 동작 | 지금(SQLite) | Postgres에서 같게 하는 법 |
|---|---|---|
| 정렬 `title` | `p.title COLLATE NOCASE` | `lower(p.title) collate "C", p.id` |
| 정렬 `first_author` | `json_extract(authors,'$[0].family') COLLATE NOCASE` (값 없는 논문이 **앞**) | `lower(p.authors->0->>'family') collate "C" asc nulls first, p.id` — Postgres 기본은 `asc` = NULL **뒤**라 `nulls first` 필수 |
| 정렬 `year` · `cited` · `opened` | `COALESCE` 사용 | 같은 식 그대로(`coalesce(p.last_opened_at, '-infinity')` 등) |
| 정렬 `added` · `updated` | `DESC` | `desc, p.id desc` (같은 시각일 때 순서 고정 — 지금은 rowid 순) |
| 태그 · 컬렉션 목록 | `name COLLATE NOCASE` | `lower(name) collate "C"` |
| 태그 이름 | 대소문자 무시 유일(`NLP`=`nlp`) | `unique (user_id, lower(name))`, `ensure_tag`도 `lower(name) = lower(%s)`로 찾기 |
| `INSERT OR IGNORE` | | `insert … on conflict do nothing` |
| `INSERT OR REPLACE`(요약) | | `insert … on conflict (paper_id) do update` |
| 중복 찾기 | DOI 정규화 일치 → arXiv 일치 → 정규화 제목(12자 이상) 일치(파이썬에서 전체 반복) | 같은 순서. 제목은 `title_norm = %s`로 색인 검색. **사용자 범위 안에서만**(남의 서재와 비교하지 않음) |
| 인용키 | `make_citekey` + 같은 키가 있으면 `a, b, …, z, aa…` 덧붙임 | 같은 규칙, **사용자 범위 안에서** 유일. 유일 제약은 걸지 않음(지금도 사용자가 같은 키로 고칠 수 있음) |
| `papers_by_citekeys` | 서재 전체에서 찾기 | 내 서재에서만 |
| `is_descendant`(컬렉션 순환 금지) | 부모를 따라 올라가며 검사 | 같은 규칙, 폴더에도 적용 |
| `stats` | 전체 개수 | RLS로 내 것만(같은 키 · 같은 의미) |
| `LIKE` 이스케이프 | `ESCAPE '\'` | `ILIKE … ESCAPE '\'` |
| 빈 태그 정리 | 연결 없는 · 색 없는 태그 삭제 | 같은 규칙, 내 태그만 |
| `doc_format_usage` · 양식 삭제 시 원고 되돌리기 | | 내 원고만 |
| `rowcount` 반환(지운 원고 수) | | `cursor.rowcount` |
| 오류 `sqlite3.IntegrityError` → 400 "같은 이름의 태그" | | `psycopg.errors.UniqueViolation` → 같은 400 |

### 5.9 1단계에 만들지 않는 표

`devices` · `jobs`(2), `chunks` · `manuscript_citations`(3), `explanations` · `translations`(4), `external_works` · `citation_edges`(**1B** — 개정 2026-10-07, 열 · 권한은 [1B 명세](citation-graph.md) 8장), `sync_state`(6). PLAN은 "미리 만들어도 됨"이지만, 열이 그 단계 명세에서 정해지므로 **그 단계의 마이그레이션 파일로 추가**합니다(빈 표를 미리 두면 RLS 검사 · 열 변경만 늘어남). 1단계 표는 이 표들이 외래 키로 붙을 수 있게 `papers (id, user_id)`, `folders (id, user_id)`, `collections (id, user_id)` 유일 제약을 둡니다.

---

## 6. 인증

### 6.1 Supabase · Google 설정 (사용자 작업 — 팀이 안내문 작성)

| 할 일 | 누가 | 비고 |
|---|---|---|
| Supabase 프로젝트 생성(서울 리전) | 사용자 | 값을 `cloud.env`에: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`(Session pooler), 레거시 키 방식일 때만 `SUPABASE_JWT_SECRET` |
| Google Cloud 콘솔에서 OAuth 클라이언트(웹) 생성, 승인된 리디렉션 URI = Supabase 콜백 주소 | 사용자 | 클라이언트 ID · 비밀은 **Supabase 대시보드에만** 넣음(cloud.env에 넣지 않음 — 변수 목록에 없음) |
| Supabase Auth: Google 공급자 켜기, Site URL · Redirect URLs = 서버 주소 `https://kimjuhyeon.tailac17f6.ts.net/`(Funnel을 켠 뒤) | 사용자(팀이 값 안내) | (개정 전: Cloud Run 주소) |
| **Google OAuth 동의 화면을 "테스트(Testing)" 게시 상태로 두고 "테스트 사용자"에 쓸 사람의 구글 계정을 넣기**(개정 — 확정 Q16, 가입 관문) | 사용자 | Google Cloud 콘솔 → OAuth 동의 화면(Google Auth Platform → 대상) → 테스트 사용자 추가. **최대 100명**(Google 공식). **"앱 게시"(프로덕션으로 전환) 버튼을 누르지 않음** — 누르면 구글 계정이 있는 누구나 로그인 · 가입 가능(18장 위험). 목록 밖 계정은 Google 화면에서 막혀 Supabase로 돌아오지 않음(Google의 차단 화면 문구 **확인 필요**) |
| Auth Hook "Before User Created" 연결(6.3절 함수) | 사용자(대시보드) 또는 팀 | **개정: 기본은 연결하지 않음**(확정 Q16 · 팀장 결정). 허용 목록을 켤 때(`PAPERLAB_ALLOWLIST=on`)만 연결 — 선택 기능. 마이그레이션은 함수만 만들어 둠(연결 전에는 아무 일도 안 함) |
| 이메일 공급자 **끄기**(Email provider → 가입 비활성) · **익명 로그인 끄기** · 구글 말고 다른 공급자 모두 끔 | 사용자(팀이 안내) | 확정 Q2: 1단계는 구글만. **개정 — 이제 필수**: 허용 목록 · 훅이 꺼져 있으므로, 이메일 공급자나 익명 로그인이 켜져 있으면 **누구나 Auth API(공개 anon 키)로 계정을 만들어 서버에 들어올 수 있음** — Google 테스트 사용자 관문을 우회하는 유일한 길(AC-80) |

**이메일 로그인 — 이후 작업(확정 Q2)**: Supabase 기본 메일 발송은 "프로젝트 팀원 주소가 아니면 보내지 않고, 시간당 2통" 제한이 있습니다(공식 문서). 사용자는 **Resend**를 쓰기로 했지만 Resend는 **보내는 도메인 인증**이 필요하므로, 도메인이 준비되면 Supabase Auth의 사용자 정의 SMTP를 Resend로 설정하고 이메일 공급자 · 로그인 화면 이메일 칸을 켜는 작업을 따로 합니다. 그때 SMTP 비밀값 변수 이름을 새로 정합니다(1단계 변수 목록에는 없음). **개정(Q16)**: 이메일 로그인을 켜면 Google 테스트 사용자 관문이 이메일 가입에는 적용되지 않으므로, 그때는 **허용 목록을 다시 켜거나(`PAPERLAB_ALLOWLIST=on` + Auth Hook) Supabase 가입을 끄고 관리자가 초대**하는 방식을 함께 정해야 합니다(그 소명세에서 — 사용자 확인).

### 6.2 화면 로그인 흐름

1. **supabase-js**: 빌드 없는 화면에 맞게 공식 배포 파일을 **`static/vendor/supabase/`에 버전 고정으로 넣어** 씁니다(지금 pdf.js · KaTeX · marked처럼, `THIRD_PARTY.md`에 출처 · 라이선스 추가). (**팀장 결정** T7 — CDN ESM · 직접 REST 호출은 쓰지 않음)
   - UMD 파일(`window.supabase`)을 고전 `<script>`로 넣을지, ESM 파일을 `import`할지는 개발팀이 배포본 구성을 보고 정함(**확인 필요**: 고정할 버전의 배포 파일 이름).
2. 화면 시작(`app.js`): `GET /api/public-config` → `{supabase_url, supabase_anon_key}`(공개해도 되는 값, 인증 불필요) → `createClient(url, key, {auth: {flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}})`.
3. 세션이 없으면 **로그인 화면**만 그립니다(사이드바 · 서재를 그리지 않음 — `/api/*`를 부르지 않음).
4. [Google로 계속] → `signInWithOAuth({provider: "google", options: {redirectTo: location.origin + "/"}})` → 돌아오면 supabase-js가 `?code=`를 세션으로 바꿈 → 주소에서 `code`를 지우고 `#/library`로.
5. 로그인 직후 `GET /api/me` → `{user_id, email, display_name}`. 403 `not_allowed`면 "허용되지 않은 계정" 화면 + 자동 로그아웃(허용 목록이 on일 때만 생김 — 운영 off에서는 Google 테스트 사용자 밖 계정이 Google 화면에서 막혀 PaperLab으로 돌아오지 않음).
6. 토큰 저장: supabase-js 기본(localStorage). XSS가 토큰 탈취로 이어지므로 지금 원칙(사용자 입력 HTML은 DOMPurify, `esc()`)을 계속 지킵니다.

### 6.3 가입 관문 · 허용 목록 (개정 — 확정 Q16, 2026-10-07)

**사용자 결정(Q16): 가입 허용 목록(`ALLOWED_EMAILS`)을 쓰지 않습니다.** 관문은 **Google OAuth 동의 화면 "테스트" 상태의 테스트 사용자 목록**입니다(6.1절 — 최대 100명, 게시 금지). 우리 서버의 허용 목록 검사 · Auth Hook은 **선택 기능으로 남겨** 두고(코드 · 마이그레이션 유지), 운영에서는 끕니다.

**서버 스위치 `PAPERLAB_ALLOWLIST`(팀장 결정)**

| 값 | 동작 |
|---|---|
| `off` | 서버 허용 목록 검사(아래 ③)를 하지 않음. `ALLOWED_EMAILS`가 없어도 서버가 뜸. **운영 서버 PC 설정**(`cloud.env`에 `PAPERLAB_ALLOWLIST=off`) |
| `on` 또는 **없음(기본)** | 아래 ③ 검사를 함. `ALLOWED_EMAILS`가 **없거나 비어 있으면(빈 값 · 공백뿐)**: 서버는 **시작하지만 아무도 허용하지 않음**(모든 `/api/*` 403 `not_allowed` — "빈 목록 = 전부 허용"으로 해석하지 않음) + **시작 로그에 경고**, `serve --check`에도 **경고 줄**(종료 코드는 정상 — 시작 거부 아님). **팀장 결정(확정)** |
| 그 밖 값 | 서버가 시작하지 않음(오타로 검사가 꺼지는 일 방지) |

- 끄려면 **명시적으로** `off`를 써야 합니다(설정 누락 · 빈 목록 · 오타는 모두 "닫힘" 쪽).
- `off`에서도 JWT 검증(6.4절) · RLS · 사용자 분리는 그대로입니다. 바뀌는 것은 "Supabase에 계정이 있는 사람은 누구나 서버를 쓸 수 있다"는 점 → **Supabase에 계정이 생기는 길이 구글(테스트 사용자)뿐이어야** 함: 이메일 공급자 · 익명 로그인 · 다른 공급자 끔(6.1절, AC-80).
- `off`일 때 `GET /api/public-config` · 로그에 스위치 값을 내보내지 않음(가정 — 공격자에게 알릴 이유 없음). 시작 로그에 한 줄 "허용 목록 검사 꺼짐(PAPERLAB_ALLOWLIST=off)".
- 개발 서버(11장)는 지금 규칙 그대로(`PAPERLAB_DEV_ALLOWED_EMAILS` — 비면 모두 허용, 테스트 프로젝트 · 127.0.0.1 전용).

**아래는 허용 목록을 켤 때(`on`)의 선택 기능 — 개정 전 내용 그대로.** 허용 목록의 원본은 `cloud.env`의 `ALLOWED_EMAILS`(쉼표 구분, 소문자 비교 — 가정)입니다.

| 방식 | 장점 | 단점 |
|---|---|---|
| ① **Auth Hook "Before User Created"(Postgres 함수)** | 공식 기능 · **무료 플랜 사용 가능**(공식 문서 표). 구글 · 이메일 가입 모두에 적용. 목록 밖이면 계정 자체가 안 생김 | 함수는 DB 표를 읽으므로 `ALLOWED_EMAILS` → `paperlab.allowed_emails` **동기화 명령**이 필요. 대시보드에서 훅 연결(사람 손) |
| ② Auth Hook (HTTP → 서버) | 환경 변수를 바로 읽음 | 서버 PC가 꺼져 있으면 가입 자체가 실패, 훅 서명 비밀(새 변수 이름) 필요 (개정 전 단점: Cloud Run 콜드 스타트) |
| ③ 서버에서 요청마다 확인 | 간단, 목록에서 빼면 **즉시** 차단 | 계정은 Supabase에 생김(목록 밖 사람도 로그인은 됨, 데이터는 못 씀) |
| ④ `auth.users` DB 트리거 | | Supabase 관리 스키마에 트리거 — 공식 훅이 있는데 쓸 이유 없음, 업그레이드 위험 |
| ⑤ 가입 끄기 + 관리자가 계정 미리 생성 | 훅 없음 | 구글 로그인이 미리 만든 이메일 계정에 자동 연결되는지 **확인 필요**, 사람이 매번 생성 |

**팀장 결정 = ① + ③** (T8 — **개정: 허용 목록을 켤 때만**. 운영 기본은 둘 다 꺼짐 — Q16):
- 마이그레이션 `…_auth_hook.sql`: `paperlab.before_user_created(event jsonb) returns jsonb` — `event->'user'->>'email'`을 소문자로 `allowed_emails`에서 찾고, 없으면 `{"error": {"http_code": 403, "message": "허용되지 않은 이메일이에요"}}`를 돌려줌(반환 형식은 공식 문서 예제대로 — 개발팀 확인). `grant execute … to supabase_auth_admin`, `revoke … from authenticated, anon, public`, `grant select on paperlab.allowed_emails to supabase_auth_admin`(공식 문서의 권한 패턴).
- 동기화: `python -m paperlab.admin sync-allowlist` — `ALLOWED_EMAILS`를 읽어 `allowed_emails`를 똑같이 맞춤(관리자 연결, 로그에 `reason=allowlist sync`). **개정(구현 반영)**: 설치 · 업데이트 스크립트는 `sync-allowlist`를 늘 부르지만, **`ALLOWED_EMAILS`가 비어 있으면 명령이 표를 바꾸지 않고 "바꾸지 않았어요"로 끝남**(빈 변수로 표를 통째로 비우지 않음). 운영(off)은 `ALLOWED_EMAILS` 줄이 없으므로 사실상 건너뜀 — 훅이 연결되지 않아 표 내용과 무관.
- 서버(③): JWT의 `email`(소문자)이 `ALLOWED_EMAILS`에 없으면 모든 `/api/*`(공개 주소 제외)에 **403 `{"detail": "허용되지 않은 계정이에요", "code": "not_allowed"}`**. 목록에서 뺀 사람은 다음 요청부터 막힘(이미 생긴 Supabase 계정 삭제는 관리자가 대시보드에서 — 범위 밖).

### 6.4 서버 JWT 검증

- 라이브러리: **PyJWT[crypto]**(`PyJWKClient`) (기획팀 추천 — `python-jose`보다 유지보수 활발).
- 키 선택:
  - `SUPABASE_JWT_SECRET`이 **비어 있으면** 비대칭 키: JWKS `"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"`(공식 문서 경로), 알고리즘 `ES256`·`RS256`만 허용, JWKS 캐시 **10분 이하**(공식 문서: 엔드포인트가 10분 캐시되므로 더 길게 캐시하지 말 것). 모르는 `kid`면 한 번 다시 받아 봄. 단 **다시 받기는 최소 30초 간격**(F2 — 실패한 시도도 간격에 포함, 모르는 `kid` 토큰을 계속 보내 인증을 느리게 만드는 공격 방지). 받는 동안 다른 요청은 기다리지 않고 지금 키로 판단하고(키가 하나도 없을 때만 기다림), 다시 받기에 실패하면 옛 키를 계속 씀.
  - **값이 있으면** 레거시 HS256(그 비밀로 검증). 공식 문서는 레거시 방식을 권하지 않으므로, 새 프로젝트가 비대칭 키를 쓰면 이 변수는 비워 둡니다(사용자 안내). 새 프로젝트의 기본이 어느 쪽인지 **확인 필요**.
- 검사 항목: 서명, `exp`(시계 오차 30초 허용 — 가정), `aud == "authenticated"`, `iss == SUPABASE_URL + "/auth/v1"`, `role == "authenticated"`, `sub`가 uuid. 하나라도 틀리면 401.
- `alg: none`, 허용 목록 밖 알고리즘, 서명 없는 토큰은 401(AC-04).
- 검증한 claims 전체를 `request.jwt.claims`로 DB에 넘깁니다(5.2절). 토큰 원문은 로그에 남기지 않습니다.
- `SUPABASE_ANON_KEY`가 새 형식(publishable key)일 수도 있음 — 화면 `createClient`에만 쓰므로 영향 없음(**확인 필요**).

### 6.5 요청 보안 규칙 (지금 `local_only` 대체)

| 규칙 | 1단계 |
|---|---|
| 바인딩 | 서버는 **`127.0.0.1:8080`에만** 엽니다(9.1절). 외부에서는 Funnel을 거쳐서만 들어옴 — 서버 PC 방화벽에 들어오는 규칙을 만들지 않음 |
| Host 검사 | **개정(서버 PC)**: Host가 공개 주소의 호스트(`kimjuhyeon.tailac17f6.ts.net`) 또는 `127.0.0.1:8080` · `localhost:8080`(서버 PC 안 상태 확인용)일 때만 받고, 그 밖은 400(DNS 리바인딩 방어 — 서버 PC에서 연 악성 웹 페이지가 127.0.0.1로 요청하는 경우). Funnel이 원래 Host를 그대로 넘기는지 **확인 필요**(AC-75) |
| Origin 검사 | **개정**: `Origin` 헤더가 있으면 설정값 **`PAPERLAB_PUBLIC_URL`의 출처**(`https://kimjuhyeon.tailac17f6.ts.net`)와 **정확히 같아야** 함(아니면 403). `null`은 403. Host에서 출처를 만들지 않음(프록시가 Host를 바꿔도 안전) — **팀장 결정 S2**(개정 전: `https://{Host}`) |
| 프록시 헤더 | uvicorn `--proxy-headers --forwarded-allow-ips=127.0.0.1`(Funnel의 tailscaled만 믿음 — `*` 금지). `X-Forwarded-For`로 실제 접속 IP를 얻는지 **확인 필요**(AC-75 — 2단계 연결 코드 IP별 속도 제한에 씀). 서버 PC 안의 다른 프로그램은 이 헤더를 꾸밀 수 있음(같은 PC 신뢰 — 18장) |
| CORS | **열지 않음**(CORS 미들웨어 없음 — 화면과 API가 같은 출처). R2 버킷 CORS만 따로(7.6절) |
| 인증 | `/api/*`는 `Authorization: Bearer <JWT>` 필수, 없거나 틀리면 **401** `{"detail": "로그인이 필요해요", "code": "auth_required"}`. 예외(공개): `GET /api/health`, `GET /api/public-config`, 정적 파일 `/`, `/static/*` |
| CSRF | 토큰을 쿠키가 아니라 헤더로 보내므로 다른 사이트가 사용자 대신 요청을 만들 수 없음. 그래도 **`X-PaperLab: 1` 헤더 규칙은 유지**(쓰기 요청 없으면 403, 0단계 AC-12와 같은 의미) — 비용이 거의 없고 이중 방어 |
| 캐시 | `/api/*` 응답 `Cache-Control: no-store` 유지. `/static/*`는 `Cache-Control: no-cache`(매번 재검증, 304) |
| 보안 헤더(추가) | `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=31536000`(includeSubDomains 없음 — ts.net 공유 도메인). CSP는 범위 밖(17장) |
| 오류 응답 | DB 일시정지 · 연결 실패 → **503** `{"detail": "데이터베이스에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.", "code": "db_unavailable"}`(13.4절) |

### 6.6 세션 만료

- supabase-js가 access token을 자동 갱신(기본 1시간, **확인 필요**: 프로젝트 설정 값).
- `api.js`는 요청마다 `supabase.auth.getSession()`으로 **최신 토큰**을 붙입니다.
- 401을 받으면 `refreshSession()` 한 번 시도 후 같은 요청을 **한 번만** 다시 보냄. 그래도 401이면 "로그인이 만료됐어요" 토스트 + 로그인 화면. 쓰던 원고는 화면 메모리에 남아 있으므로, 다시 로그인하면 원고 화면의 자동 저장이 다시 시도되게 합니다(개발팀 — 원고 편집기의 저장 실패 처리 확인).
- 스트리밍(SSE) 요청은 **시작할 때만** 토큰을 검사합니다(긴 요약 · 대화 도중 만료돼도 끊지 않음).
- 로그아웃: `supabase.auth.signOut()` → 로그인 화면. 화면 상태(`state`)와 메모리 캐시를 비움. 다른 기기 세션은 그대로(전체 로그아웃은 범위 밖).

### 6.7 헤더를 붙일 수 없는 요청 바꾸기

지금 몇 곳은 `window.open` · pdf.js가 **헤더 없이** `/api/...`를 GET합니다. 1단계에서 모두 401이 되므로 바꿉니다.

| 지금 | 1단계 |
|---|---|
| `reader.js` `getDocument({url: "/api/papers/{id}/pdf"})` | `GET /api/papers/{id}/pdf-url` → `{url, expires_at}` → `fetch(url)`로 **파일 전체를 받아** `getDocument({data})`. (서명 주소가 10분 뒤 만료돼도 이미 받은 파일로 계속 읽음 — pdf.js 범위 요청을 쓰지 않음) |
| `library.js` "PDF 파일 열기" `window.open("/api/papers/{id}/pdf")` | 클릭 때 빈 창을 먼저 열고(팝업 차단 회피) `pdf-url`을 받아 그 창 주소로 |
| `library.js` · `reader.js` 하이라이트 내보내기 `window.open("/api/annotations/export/{id}")` | `api.raw("GET", …)` → Blob → `downloadBlob(…, "<제목>.md")` |
| `GET /api/papers/{id}/pdf` | **없앰**(서버는 PDF 본문을 내보내지 않음 — PLAN 팀장 결정 "서명 주소로 직접") |

---

## 7. 파일 저장소 (R2)

**확정(사용자 최종 결정, 2026-10-07)**: PDF와 DB 백업은 **Cloudflare R2**(무료 저장 10GB, 내보내기(egress) 무료)에 둡니다. 사용자가 R2를 만들었고 `cloud.env`의 `R2_ACCOUNT_ID` · `R2_BUCKET` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY`를 채웠습니다. Supabase Storage는 쓰지 않습니다(같은 날 잠시 검토했던 안은 **대안**으로만 7.8절에 남김).

**공식 문서 확인**: R2 서명 주소는 GET · HEAD · PUT · DELETE 지원(POST 없음), 유효 시간 1초~7일, **S3 API 도메인에서만 동작(사용자 정의 도메인 불가)**, 브라우저에서 쓰려면 버킷 CORS 필요, PUT 서명에 `Content-Type`을 넣으면 다른 형식은 403.

**R2에는 RLS가 없습니다.** 서버가 버킷 전체 권한 키를 가지므로 사용자 분리는 **전적으로 서버의 키 생성 규칙**(7.1절)에 달려 있습니다 → AC-39 · 39a로 강하게 확인합니다.

### 7.1 키 규칙 · 서버 측 강제

| 대상 | 키 |
|---|---|
| 논문 PDF | `users/{user_id}/papers/{paper_id}.pdf` (PLAN 확정) |
| 올리는 중인 파일(임시) | `incoming/{user_id}/{upload_id}.pdf` — `upload_id`는 서버가 만든 uuid. 접두어가 `incoming/`인 이유: R2 수명 주기 규칙은 **접두어**로 걸리므로 `users/*/incoming`처럼 중간 와일드카드를 쓸 수 없음 |
| DB 백업 | `backups/db/{YYYYMMDD}.dump` (13.3절, **팀장 결정** — 같은 버킷 접두어) |

**서버 측 강제 규칙**(`paperlab/storage.py` 한 곳에서만 키를 만듦):
1. 사용자 요청에서 쓰는 키는 **함수 두 개로만** 만듭니다: `paper_key(uid, paper_id)` · `incoming_key(uid, upload_id)`. `uid`는 **검증된 JWT의 `sub`만**(요청 본문 · 쿼리 · DB 값에서 오지 않음), `paper_id`는 그 사용자 트랜잭션에서 RLS로 조회된 논문의 id, `upload_id`는 uuid 정규식 통과값.
2. 서명(GET · PUT) · 받기 · 이동 · 삭제 함수는 키가 `users/{uid}/` 또는 `incoming/{uid}/`로 시작하는지 **다시 검사**하고, 아니면 예외(→ 404). DB의 `pdf_key`도 이 검사를 통과해야 씀.
3. `backups/` 접두어는 백업 명령(`admin backup`)만 씁니다. 서버의 사용자 요청 경로에서는 `backups/`를 만들거나 서명할 수 없습니다(검사 함수가 거부).
4. 접근 라이브러리: **boto3**(S3 호환, `endpoint_url = https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, `region_name="auto"`, 서명 v4).

### 7.2 업로드 (P11 — 팀장 결정 T1)

브라우저가 **서명 주소로 R2에 직접** 올리고, 서버가 **R2에서 읽어** 텍스트 · DOI를 추출합니다. 근거: 서버 대역폭 절약(**Tailscale Funnel은 바꿀 수 없는 대역폭 제한이 있음** — 공식 문서), 서버 PC 인터넷 회선 부담 감소, R2 내보내기 무료. (개정 전 근거였던 Cloud Run 32MiB 한도는 없어졌지만 방식은 그대로 — 더 중요해짐)

1. `POST /api/uploads` `{"files": [{"name": "a.pdf", "size": 1234567}]}` (최대 20개) → 파일마다 `{upload_id, backend: "r2", upload: {method: "PUT", url, headers: {"Content-Type": "application/pdf"}}}`. `size`가 **100MB**를 넘으면 그 파일만 `error: "파일이 너무 커요 (100MB 초과)"`. 저장 공간이 **한도의 95%** 이상이면 전체 400 "저장 공간이 거의 찼어요. 관리자에게 알려 주세요"(7.6절). 서명 주소 유효 **10분**.
2. 브라우저가 파일마다 `PUT`(XHR로 진행률 표시, 동시 3개 — 가정). 화면 코드는 응답의 `backend` · `upload` 값대로 보내는 작은 어댑터 하나(저장소를 바꿔도 화면 수정 최소).
3. `POST /api/uploads/{upload_id}/complete` `{"collection_id": 3, "folder_id": 5, "lookup": true}` → 서버가 `HEAD`로 크기 확인(100MB 초과면 삭제 + 오류) → `incoming/{uid}/{upload_id}.pdf`를 받아 **지금 `/api/upload`와 같은 처리**(`%PDF` 확인 · `pdf.extract` · 메타데이터 찾기 · 중복 처리 · 논문 추가) → 최종 키로 **복사(CopyObject)** → 임시 파일 삭제 → 응답은 지금 `results` 항목 하나와 같은 모양(`file, id, title, matched_by, note, duplicate, warnings, error`).
4. 이미 있는 논문에 PDF 붙이기: `POST /api/papers/{pid}/pdf/upload` → `{upload_id, backend, upload}`, 올린 뒤 `POST /api/papers/{pid}/pdf/complete {"upload_id"}` → 지금 `attach_pdf` 응답과 같음(같은 키에 덮어씀).
5. 남의 임시 파일을 완료시킬 수 없음: 키는 `incoming/{JWT의 uid}/{upload_id}.pdf`로만 만들어지므로 다른 사용자의 `upload_id`를 넣어도 내 경로에 없어서 404.
6. 남은 임시 파일: 버킷 수명 주기 규칙 "`incoming/` 접두어 1일 뒤 삭제"(7.6절).
7. 서버가 URL에서 받는 경우(`add_paper`의 `download_pdf`, `fetch-pdf`)는 지금처럼 서버가 받아(100MB 제한 그대로) **바로 최종 키에 PUT**. 받는 동안 DB 연결은 반납합니다(5.2절 1번, F9).
8. **SSRF 방어 (F3)** — 사용자가 준 주소로 서버가 요청하므로(`sources.download_pdf`):
   - `http` · `https`만, 계정 정보(`user@`)가 든 주소 거부. `localhost` · `metadata.google.internal` 같은 이름과 `.localhost` · `.internal` · `.local` · `.localdomain` · `.home.arpa`로 끝나는 이름 거부.
   - 호스트를 DNS로 해석해 **해석된 모든 IP가 공인(전역 유니캐스트)** 일 때만 허용 — 사설 · 루프백 · 링크로컬(메타데이터 `169.254.169.254`) · 예약 · 멀티캐스트 · 미지정 주소면 거부. IPv6 안에 든 IPv4(IPv4 매핑 · 6to4 · Teredo)도 같은 검사.
   - 검사한 IP로 직접 연결(이름 재해석으로 검사를 피하지 못하게, https는 SNI · 인증서를 원래 이름으로).
   - 리디렉션은 자동으로 따라가지 않고 **단계마다 위 검사를 다시** 함, 최대 5번.
   - 실패 문구는 하나("PDF를 받지 못했어요. 주소를 확인하거나 직접 파일을 첨부해 주세요.") — 내부 탐색 단서를 주지 않음.

### 7.3 다운로드 (서명 주소)

- `GET /api/papers/{pid}/pdf-url` → `{"url": "...", "expires_at": "…+00:00"}`. PDF가 없으면 404 "PDF가 없어요". 유효 시간 **10분**(PLAN 예시값, 가정). `ResponseContentType=application/pdf`, `ResponseContentDisposition=inline; filename*=UTF-8''<제목>.pdf`(가정).
- 화면은 그 주소로 **파일 전체를 받아** pdf.js에 넘김(6.7절). 서명 주소는 로그에 남기지 않습니다(누가 보면 10분 동안 파일을 받을 수 있음).
- **브라우저 캐시(T16 — 팀장 결정: 구현하되 우선순위 낮음)**: R2는 egress가 무료라 필수는 아님. 받은 PDF를 브라우저 Cache Storage에 `pdf_sha256` 열쇠로 보관해 다시 열 때 빠르게(로그아웃 때 비움). 1단계 다른 작업이 끝난 뒤 여유가 있으면 구현, 없으면 다음 단계로 넘겨도 1단계 완료에 영향 없음(수용 기준 없음).
- AI(요약 · 대화)는 서버가 R2에서 직접 읽습니다(`PaperContext.pdf_bytes`). 22MB 넘는 PDF는 지금처럼 텍스트로 대체.

### 7.4 삭제 · 교체 · 정리

- 논문 삭제(단건 · 일괄): **DB 커밋이 끝난 뒤** R2 객체 삭제. 실패하면 로그만 남기고 응답은 성공(DB가 기준).
- PDF 교체: 같은 키에 덮어쓰기. `pdf_sha256` · `pdf_size` · `page_texts` 갱신.
- 고아 파일: `python -m paperlab.admin orphans --delete`(PC, 관리자 연결 + `cloud.env`의 R2 키) — DB에 없는 `users/*/papers/*.pdf`를 찾아 지움(`incoming/`은 수명 주기 규칙이 처리). 로그에 `reason=orphan scan`.

### 7.5 크기 제한

| 대상 | 제한 | 지금 |
|---|---|---|
| PDF 업로드 | **100MB/파일**(신고 크기 + `complete`의 `HEAD`로 재확인), 한 번에 20개. 근거: R2 단일 PUT 한도(수 GB)보다 훨씬 작고, 서버가 추출할 때 파일 전체를 메모리에 올리므로 서버 메모리에 맞춤(개정 전 2GiB 인스턴스 기준 — 서버 PC도 그대로 둠) · 지금 URL 받기 한도와 같음 | 업로드 무제한 |
| URL에서 받기 | 100MB(그대로) | 100MB |
| 인용 스타일 | 2MB(그대로, DB) | 2MB |
| 양식 파일 가져오기 | 20MB(그대로) | 20MB |
| 워드 · 한글 인용 넣기(compose) | **30MB 유지**(줄인 근거였던 Cloud Run 32MiB 한도는 없어졌지만 Funnel 대역폭 제한 · 구현 · 테스트 변경 최소화로 그대로 — **팀장 결정 S8**) | 60MB |
| 응답 | 큰 파일 응답(compose 결과)은 `StreamingResponse` 그대로(바꿀 이유 없음) | |

### 7.6 버킷 설정 · 사용량

**버킷 설정**(사용자가 Cloudflare 대시보드에서 적용 — 관리자가 아래 값으로 안내, 20장 관리자 목록에 JSON):
- **CORS**: 브라우저가 서명 주소로 직접 올리고(PUT) 받기(GET) 때문에 필요. `AllowedOrigins` = 서버 주소 `https://kimjuhyeon.tailac17f6.ts.net` **하나만**(개정 — 승인자 L4 · 구현 `deploy/r2-cors.json`: 운영 버킷에 개발 서버 출처를 넣지 않음. 개발 서버는 같은 출처 가짜 저장소라 필요 없음. 개정 전: Cloud Run 배포 주소 + 개발 서버), `AllowedMethods` = `GET, HEAD, PUT`, `AllowedHeaders` = `Content-Type`, `ExposeHeaders` = `ETag, Content-Length`, `MaxAgeSeconds` = 3600.
- **수명 주기**: `incoming/` 접두어 1일 뒤 삭제. (`backups/`는 백업 명령이 세대 수로 정리 — 13.3절)
- 공개 접근(r2.dev 공개 주소) **끔**. 사용자 정의 도메인 연결 안 함(서명 주소가 S3 API 도메인에서만 동작).
- R2 API 토큰: **이 버킷 하나에 대한 객체 읽기 · 쓰기** 권한만(사용자 안내).

**사용량 표시 · 경고**:
- R2 무료 10GB는 **버킷 전체(사용자 3~5명 PDF + DB 백업 합계)** 한도로 봅니다.
- `GET /api/storage/usage` → `{"backend": "r2", "used_bytes": …, "limit_bytes": 10737418240, "mine_bytes": …, "level": "ok|warn|full"}`.
  - `used_bytes` = 모든 사용자 `papers.pdf_size` 합(`system_tx("storage usage")` — 사용자 구분 없는 합계만) + `backups/` 객체 크기 합(R2 목록, 5분 캐시).
  - `mine_bytes` = 내 PDF 합(RLS).
  - `limit_bytes` = 설정 상수(기본 10GB, 가정 — 유료로 늘리면 값만 바꿈).
- `warn` = **80%** 이상: 사이드바 아래 · 설정 "계정" 구역에 "저장 공간 80% 사용 중 (8.2GB / 10GB)". `full` = **95%** 이상: 업로드 막음(7.2절 1번) + 같은 안내(디자인 D14).
- 실제 R2 사용량과 DB 합계가 어긋날 수 있음(임시 파일 · 고아 파일) — `admin orphans`가 둘 다 출력.

### 7.7 사용자 인용 스타일

**DB `user_styles.xml`에 저장합니다**(**팀장 결정** T9 — PLAN 1단계 범위의 "사용자 CSL 스타일을 R2로"를 이 결정으로 바꿈). 근거: 파일이 작고(보통 수십 KB, 최대 2MB), 목록 표시에 매번 R2를 훑지 않아도 되며, RLS로 자동 분리.
API는 지금과 같음: `GET /api/styles`(기본 스타일 + 내 스타일), `GET /api/styles/{id}`(내 스타일이 기본 스타일과 같은 id면 **내 것 우선** — 지금 규칙), `POST /api/styles`, `DELETE /api/styles/{id}`(내 것만).

### 7.8 저장소 계층 교체 (`STORAGE_BACKEND`)

`paperlab/storage.py`에 한 인터페이스(`create_upload` · `sign_get` · `get` · `head` · `move` · `delete` · `list_prefix_size`)와 구현을 둡니다.

| 값 | 상태 | 내용 |
|---|---|---|
| `r2` | **기본값, 1단계 사용** | boto3, 7.1~7.6절 |
| `supabase` | **대안**(1단계 구현 안 함) | Supabase Storage 비공개 버킷 + `storage.objects` RLS(사용자 JWT로 호출), 무료 1GB · 파일 50MB · egress 5GB/월(공식 문서). R2를 못 쓰게 될 때를 위한 자리만 |
| `fake` | 테스트 전용 | 메모리 구현, 요청 기록(키 · 동작)을 남겨 AC-39 검사에 씀 |

- 환경 변수 `STORAGE_BACKEND`(비밀 아님). 없으면 `r2`. `r2`인데 R2 변수 4개 중 하나라도 비면 서버가 시작하지 않고 빠진 변수 **이름**만 로그. 모르는 값이면 시작하지 않음.
- 키 규칙은 어떤 구현이든 같음 → 나중에 옮길 때 키를 그대로 복사.
- 1단계는 `r2` · `fake`만 구현. 같은 **계약 테스트**(올리기 · 서명 · 받기 · 이동 · 삭제 · 없는 키 · 남의 접두어 거부)를 `fake`에는 자동으로, `r2`에는 [실환경]으로 돌림(AC-45a).

## 8. 설정 · 비밀

### 8.1 설정 키 옮기기

| 지금 `settings.json` 키 | 1단계 위치 | 비고 |
|---|---|---|
| `ai_engine` | `profiles.settings` | 1단계는 `"api"`만 받음. `"cli"`를 보내면 400 "CLI 엔진은 PC 연결(2단계) 뒤에 쓸 수 있어요". 저장된 값이 `cli`면 `api`로 읽음 |
| `model`, `effort`, `summary_language`, `citation_style`, `citation_locale`, `korean_first`, `doc_format_default` | `profiles.settings` | 기본값은 지금 `DEFAULT_SETTINGS` |
| `contact_email` | `profiles.settings` | 비밀 아님(OpenAlex · Crossref polite pool). 빈 값이면 로그인 이메일을 쓸지 — **가정: 쓰지 않음**(사용자가 넣은 값만) |
| `anthropic_api_key`, `openalex_api_key`, `semantic_scholar_api_key` | `user_secrets` (`name` = 키 이름) | 학술 API 키도 **사용자별**(공용 키 아님 — 5단계 P9와 별개) |

- `GET /api/settings` · `PUT /api/settings`의 **요청 · 응답 모양은 지금과 같음**(비밀은 `*_set: true/false`, 빈 문자열 = 변경 없음, `null` = 지우기). `env_api_key_set`은 항상 `false`(서버 환경 변수 키를 쓰지 않으므로 — 필드는 화면 호환을 위해 남김, 가정).
- 서버는 요청마다 `profiles.settings` + 복호화한 비밀로 **사용자 설정 객체**를 만들어 `Sources(get)` · `AIService(get)`에 넘깁니다(지금 `get_setting` 콜러블 인터페이스 그대로).
- `AIService.status()` · `_client()`: 클라우드에서는 `ANTHROPIC_API_KEY` · `ANTHROPIC_AUTH_TOKEN` 환경 변수를 **보지 않음**(AC-48). 키가 없으면 지금 문구 "설정에서 Anthropic API 키를 넣어주세요."

### 8.2 `user_secrets` 암호화

| 항목 | 결정 |
|---|---|
| 알고리즘 | **AES-256-GCM**(`cryptography` 패키지 `AESGCM`), 행마다 무작위 12바이트 nonce |
| 키 | `APP_ENCRYPTION_KEY` = 32바이트를 base64로 쓴 값(만드는 명령은 배포 안내문에: `python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"`). 길이가 틀리면 서버가 **시작하지 않음** |
| 추가 인증 데이터(AAD) | `"{user_id}:{name}"` — 암호문을 다른 사용자 · 다른 이름 행에 복사해 넣어도 복호화 실패 |
| 저장 위치 | 키는 **서버 PC의 `cloud.env`**(파일 권한: 서버를 돌리는 Windows 사용자만 — 13.1절. 개정 전: Secret Manager), 암호문은 DB. **DB가 유출돼도 키 없이는 못 읽음**. Supabase Vault(DB 안 키)는 이 분리를 깨므로 쓰지 않음. 대신 **서버 PC 자체가 털리면 키 · DB 관리자 주소 · R2 키가 함께 나감**(18장 위험 — 서버 PC 보안 관리, 13.7절) |
| 화면 노출 | 평문 · 암호문 모두 화면으로 보내지 않음. `hint`(끝 4자리)만 — 가정 |
| 로그 | 평문 키 · 요청 본문을 로그에 남기지 않음. Anthropic 오류 메시지에 키가 섞이면 지움 |

### 8.3 키 회전

- `key_id` = `sha256(키)` 앞 8자(16진). 복호화할 때 행의 `key_id`로 키를 고름.
- 회전 절차(관리자 명령 `python -m paperlab.admin rotate-key`, **팀장 결정** T10): 행의 `key_id`로 옛 키를 알아보고 새 키로 모든 행을 다시 암호화. 실행하는 동안 **옛 키와 새 키가 함께** 필요합니다. 고정 변수 목록에 옛 키 자리가 없으므로, 회전 명령은 옛 키를 **명령 실행 때만** 입력받고(표준 입력, 화면에 안 보이게) 저장하지 않습니다(새 변수 이름 없음). 순서(서버 PC): 서버 작업 멈춤 → `cloud.env`의 `APP_ENCRYPTION_KEY`를 새 값으로 → 명령 실행(옛 키 입력) → 서버 작업 다시 시작. (개정 전: Secret Manager 새 버전 → 재배포. 관리자 PC의 `cloud.env`도 쓰고 있으면 같은 값으로 맞춤)
- 회전 시점: 키 유출 의심 시. 정기 회전은 하지 않음(3~5명 규모 — 가정).
- 키를 잃으면 저장된 API 키는 복구 불가 → 사용자가 다시 입력(화면에 "다시 입력해 주세요" 표시: 복호화 실패 시 `*_set: false` + 경고 — 가정).

### 8.4 서버 환경 변수 (이름만)

**개정(서버 PC)**: Secret Manager · Cloud Run 환경 변수가 없어졌습니다. 서버 · 관리 명령 · 백업은 모두 **서버 PC의 `%USERPROFILE%\.paperlab\cloud.env`**(이 PC는 `C:\Users\USER\.paperlab\cloud.env`)를 읽습니다(이미 있는 환경 변수가 우선 — 지금 `load_env_file` 규칙). 값은 화면 · 로그 · 저장소 어디에도 쓰지 않습니다.

| 변수 | 쓰는 곳 | 서버 PC `cloud.env`에 두나 | 비고 |
|---|---|---|---|
| `SUPABASE_URL` | JWT `iss` 검사 · JWKS 주소 · `/api/public-config` | 예 | 비밀 아님 |
| `SUPABASE_ANON_KEY` | `/api/public-config`(화면에 공개되는 값) | 예 | 비밀 아님 |
| `SUPABASE_DB_URL` | **관리자**(`postgres`) Session pooler 주소 → 마이그레이션 · `sync-allowlist` · `app-role` · `rotate-key` · `orphans`. **서버 프로세스는 읽지 않음** | 예(업데이트 때 마이그레이션에 필요) | 비밀 |
| `SUPABASE_APP_DB_URL` | **신규(S1)** — `admin app-role`이 쓰는 **`paperlab_app` 주소**. 서버 · 백업이 씀(5.2절 4번) | 예(사람이 손으로 쓰지 않음) | 비밀. 사용자 이름이 `postgres`면 서버 시작 거부 |
| `SUPABASE_JWT_SECRET` | 레거시 HS256일 때만 | 값이 있을 때만 | 비밀 |
| `SUPABASE_SERVICE_ROLE_KEY` | **1단계 서버는 쓰지 않음** | **아니오**(최소 권한 — 서버 PC에 두지 않음) | 관리자 PC에만 있어도 됨 |
| `STORAGE_BACKEND` | 저장소 선택, 기본 `r2`(7.8절) | 없어도 됨(코드 기본값) | 비밀 아님 |
| `R2_ACCOUNT_ID`, `R2_BUCKET` | R2 주소 · 버킷 | 예 | 비밀 아님 |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 접근 | 예 | 비밀 |
| `ALLOWED_EMAILS` | 6.3절 ③ · 동기화 명령 — **허용 목록을 켤 때만** | **아니오(운영 — 확정 Q16)**. 켤 때만 넣음 | 이메일이라 로그에 찍지 않음 |
| `PAPERLAB_ALLOWLIST` | **신규(Q16 · 팀장 결정)** — `on`(기본) / `off`. 6.3절 | **예: `PAPERLAB_ALLOWLIST=off`** | 비밀 아님. 모르는 값이면 서버 시작 거부 |
| `APP_ENCRYPTION_KEY` | 8.2절 | 예 | 비밀 |
| `PAPERLAB_PUBLIC_URL` | **신규(S2)** — 공개 주소 `https://kimjuhyeon.tailac17f6.ts.net`. Origin · Host 검사(6.5절), 상태 확인 스크립트 | 예 | 비밀 아님. 비었거나 `https://`가 아니면 서버 시작 거부 |
| `PAPERLAB_PG_DUMP` | **신규(S9, 선택)** — `pg_dump.exe` 경로. 비면 `PATH`에서 찾음(서버 PC는 PATH에 있음). 코드에 경로를 박지 않음 | 선택 | 비밀 아님 |
| `PAPERLAB_RELEASES_DIR` | **2단계(선택)** — PC 앱 설치 파일 배포 폴더. 서버가 `/downloads/`로 내려줄 파일을 여기서 읽음(읽기만). 기본값 `D:\PaperLab\releases`([2단계 명세](phase2-worker-electron.md) 13.7.1절) | 선택(없으면 기본값) | 비밀 아님. 값 검사 없음 — 폴더나 파일이 없으면 `/downloads/*` 404 |
| `GCP_PROJECT_ID`, `GCP_REGION` | **폐기**(Cloud Run 배포 스크립트 전용이었음) | **아니오** — 관리자 PC `cloud.env`에서도 지워도 됨 | |
| `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY`, `SUPABASE_TEST_DB_URL` | **테스트 전용**(10.2절) | 서버 PC에서 품질 검증을 돌릴 때만(19.4절 질문 Q-S7) | 운영 서버는 절대 읽지 않음 |

- `PAPERLAB_ALLOWLIST`는 팀장 결정(Q16에 따름). 새 변수 3개(`SUPABASE_APP_DB_URL` · `PAPERLAB_PUBLIC_URL` · `PAPERLAB_PG_DUMP`)는 "변수 이름 고정" 원칙의 예외로 **팀장 결정(2026-10-07)**(19.4절 S1 · S2 · S9).
- `cloud.env`에는 처음 13개 변수 줄이 있고(R2 4개 포함), 관리자 PC의 파일을 사용자가 **USB 등으로 서버 PC에 옮깁니다**(13.1절 — 저장소 · 채팅 · OneDrive · 메일을 거치지 않음). 옮긴 뒤 `PAPERLAB_PUBLIC_URL` · `PAPERLAB_ALLOWLIST=off` 줄을 더하고 `ALLOWED_EMAILS` 줄은 지우며(Q16), `SUPABASE_APP_DB_URL`은 설치 스크립트가 채웁니다. `STORAGE_BACKEND`는 없어도 됨.
- 개발 서버 전용 변수(11장, 운영에는 넣지 않음): `PAPERLAB_DEV=1`, `PAPERLAB_DEV_ENCRYPTION_KEY`(개발용 암호화 키 — 없으면 실행할 때만 쓰는 임시 키), `PAPERLAB_DEV_ALLOWED_EMAILS`(개발용 허용 목록 — 비면 테스트 프로젝트 로그인 사용자 모두 허용). 개발 서버는 운영 `APP_ENCRYPTION_KEY` · `ALLOWED_EMAILS`를 읽지 않음.

---

## 9. 서버 실행 (서버 PC — 개정 2026-10-07, 사용자 결정)

> 개정 전 "9. Cloud Run"(컨테이너 · 서비스 설정 · 팀장 결정 T11)은 **폐기**했습니다. 9.3절 요약 SSE 결정(T2)은 1단계 구현 그대로 두고, 2단계에서 작업 큐로 옮깁니다.

### 9.1 서버 PC와 실행 방식

**서버 PC 실측(2026-10-07, 그 PC의 Claude Code가 읽기 전용 점검)**: Windows 11 **Home** 10.0.26200, PC 이름 `KIMJUHYEON`, Windows 사용자 `USER`(`C:\Users\USER`), 기본 `python` = 3.14.3 · **3.12.10은 `py -3.12`**, git 2.53, Node v24.14, `pg_dump` **17.10**(`C:\Users\USER\tools\pgsql\bin` — PATH 등록), Tailscale 1.102.4(실측 때 연결 안 됨 — `Stopped`), 전원 = 절전 · 최대 절전 사용 안 함, C: 여유 약 **15GB**(SSD로 추정 — 미확인), **D: 내장 SATA HDD 1TB(NTFS, 여유 455GB, C:와 다른 디스크, BitLocker 없음)**, `D:\PaperLab` 이미 있고 비어 있음(그 PC Claude 세션의 작업 폴더). `icacls D:\` 기본값 = Administrators F · SYSTEM F · **Authenticated Users M(상속)** · Users RX. claude 2.1.210 · codex-cli 0.157.0 설치, gemini 없음.

| 항목 | 결정 |
|---|---|
| 실행 방식 | **Docker 없이** 저장소를 받아 **Python 3.12 가상환경**으로 직접 실행(사용자 결정). 가상환경은 `py -3.12 -m venv .venv`로 만듦(기본 `python`이 3.14라 **반드시 `py -3.12`** — 3.14는 의존성 휠 지원 **확인 안 됨**) |
| 설치 위치 | **D 드라이브**(사용자 결정 2026-10-07) — 팀장 결정: 저장소 `D:\PaperLab\study99web`(`D:\PaperLab` 안에 `git clone`), 가상환경 저장소 안 `D:\PaperLab\study99web\.venv`, 로그 `D:\PaperLab\logs\`, 백업 임시 파일 `D:\PaperLab\tmp\`. **`cloud.env`만 `C:\Users\USER\.paperlab\cloud.env`에 유지**(사용자 프로필은 기본으로 본인만 접근 — D:는 Authenticated Users 수정 권한이 상속됨). 설치 스크립트가 **`D:\PaperLab`의 상속을 끊고 `USER` · `SYSTEM` · `Administrators`만** 권한을 갖게 제한(로그에 `user_id` · 오류 문구 등 개인 정보가 남을 수 있으므로 — AC-58). D:는 HDD라 읽기 · 쓰기가 느릴 수 있으나 DB는 Supabase에 있어 영향 작음(서버 시작 · `pip install`이 조금 느릴 뿐 — 참고). 경로는 설치 스크립트 인자로 바꿀 수 있게(개발팀) |
| 의존성 | `.venv\Scripts\python -m pip install -e .`(편집 가능 설치 — `git pull` 뒤 파이썬 파일은 다시 설치하지 않아도 반영, 의존성이 바뀌면 업데이트 스크립트가 다시 설치). 의존성 목록은 1단계 그대로. Windows용 휠이 모두 있는지(PyMuPDF · psycopg[binary] · lxml · cryptography — cp312 win_amd64) **확인 필요**(설치 스크립트 첫 실행으로 확인) |
| 실행 진입점 | **`python -m paperlab.serve`(신규)** — `cloud.env`를 읽어 설정 검사(빠진 변수 **이름만** 로그 후 종료 코드 ≠ 0) → uvicorn을 **`127.0.0.1:8080`** 에만 열고(`0.0.0.0` 금지 — 외부는 Funnel로만), `proxy_headers=True`, `forwarded_allow_ips="127.0.0.1"`, 접근 로그는 앱 JSON 로그만. 포트는 인자로 바꿀 수 있음(기본 8080). `paperlab/cloud.py`(Cloud Run 진입점)는 **지움**(앱 만드는 함수는 `serve.py`로 옮김) |
| 단일 실행 | 같은 포트에 두 번째 서버가 뜨면 포트 충돌로 바로 종료(작업 스케줄러 "이미 실행 중이면 새 인스턴스 시작 안 함"과 이중) |
| 시작 시 | 지금처럼 DB 연결 풀은 **지연 연결**(DB가 일시정지여도 `/api/health`는 응답). 추가 검사: `PAPERLAB_PUBLIC_URL`이 `https://`로 시작, `SUPABASE_APP_DB_URL`의 사용자 이름이 `postgres`로 시작하지 않음(AC-74), `cloud.env` 파일 권한이 서버 사용자 · 관리자 · SYSTEM 밖에 열려 있으면 **경고 로그**(시작은 함 — 가정) |
| 로그 | 표준 출력 대신 **회전 파일** `D:\PaperLab\logs\server.log`(JSON 한 줄, 10MB × 5개 — 가정. D: 여유는 넉넉하지만 무한히 쌓이지 않게). 남기지 않는 것은 13.5절 그대로 |
| 마이그레이션 | 서버 시작 때 **자동 실행하지 않음**. 업데이트 스크립트가 서버 재시작 **전에** `python -m paperlab.migrate`(관리자 연결) 실행(13.1절) |
| 개발 서버 | `python -m paperlab`(11장) 그대로 — 테스트 프로젝트 · 127.0.0.1:8765. 운영 서버(8080)와 같은 PC에서 함께 떠도 서로 무관 |
| 개발 전용 파일 | 개정 전에는 `.dockerignore`가 이미지에서 `static/js/dev-login.js`를 뺐지만, 서버 PC는 저장소를 그대로 쓰므로 **파일이 디스크에 있음**. 운영 모드 서버가 이 파일을 어떤 경로 표기로도 내보내지 않는 기존 규칙(AC-73 — 지금 `test_dev_login_module_hidden_in_production`)으로 막음 |

### 9.2 자동 시작 · 계속 실행 (팀장 결정 S3 · S4 — 작업 스케줄러, 로그온 무관 + 암호 저장)

| 선택지 | 방식 | 장점 | 단점 |
|---|---|---|---|
| ① **작업 스케줄러**(팀장 결정 S3) | 작업 `PaperLab Server`: 트리거 "시스템 시작 시", 동작 `D:\PaperLab\study99web\.venv\Scripts\python.exe -m paperlab.serve`(시작 폴더 `D:\PaperLab\study99web`), "사용자가 로그온했는지 여부에 관계없이 실행", 실패 시 1분마다 다시 시작(최대 999번 — 가정), "작업이 다음 시간 이상 실행되면 중지" **끔**, "이미 실행 중이면 새 인스턴스 시작 안 함" | Windows 11 **Home에도 있음**, 추가 프로그램 없음, PowerShell `Register-ScheduledTask`로 스크립트화 가능 | 멈춤(프로세스는 살아 있는데 응답 없음)은 감지 못함 → 감시 작업(13.5절)이 보완. 실패 재시작이 "프로세스가 오류 코드로 끝날 때"만 동작하는지 **확인 필요**(AC-77) |
| ② Windows 서비스(WinSW · NSSM 같은 감싸기 프로그램) | 서비스 관리자가 시작 · 재시작 | 서비스답게 동작, 재시작 규칙 풍부 | **외부 실행 파일을 받아야 함**(공급망 · 유지보수 부담 — NSSM은 오래 갱신 안 됨), 서비스 계정에 사용자 비밀번호 필요는 ①과 같음 |
| ③ 로그인 때 시작(시작프로그램) | 사용자가 로그인해야 뜸 | 가장 단순 | 재부팅 뒤 누군가 로그인할 때까지 서버가 꺼져 있음 — 비추천 |

**로그온 방식(S4)** — ①을 고르면 "로그온 여부와 관계없이 실행"에 두 가지가 있습니다:
- **암호 저장**(팀장 결정 S4): 작업 등록 때 `USER` 계정 비밀번호를 Windows 자격 증명 창에 **사용자가 직접** 한 번 입력(Windows가 보관). 인터넷 · 사용자 파일(`cloud.env`) 접근이 정상. 계정 비밀번호를 바꾸면 작업 비밀번호도 다시 넣어야 함(안내서에 적음). Microsoft 계정 로그인인 PC면 그 계정 비밀번호(PIN 아님).
- "암호 저장 안 함"(S4U): Microsoft 문서상 이 방식은 **로컬 자원만** 쓰고 "네트워크 · 암호화된 파일에 접근하지 못함" — 서버는 Supabase · R2 · Anthropic에 나가야 하므로 **비추천**(실제로 인터넷 연결이 막히는지는 **확인 필요**).
- 서버 · 백업 작업은 모두 **`USER` 계정으로** 실행(그래야 `%USERPROFILE%\.paperlab\cloud.env`를 읽음). 별도 서버 전용 계정 분리는 19.4절 S5.

### 9.3 백그라운드 작업 문제 (요약)

> **서버 PC 전환 메모**: 아래 결정(T2 — SSE)의 근거는 Cloud Run 요청 밖 CPU 제한이었습니다. 서버 PC는 늘 켜진 한 프로세스라 그 제약이 없지만, **1단계는 구현 · 검증된 SSE를 그대로 둡니다**(바꾸면 1단계 재작업). "탭을 닫아도 요약 계속"(사용자 결정 U8)은 2단계에서 **작업 표 + 서버 프로세스 안 실행기**로 합니다(2단계 명세 15장).

지금 `POST /api/papers/{pid}/summary`는 스레드를 띄우고 **즉시 응답**하며, 화면은 `/api/jobs/{id}`를 폴링합니다. Cloud Run 기본(요청 기반 청구)은 "**요청을 처리하는 동안에만 CPU가 할당**"됩니다(공식 문서). 응답 뒤 스레드는 거의 멈추고, 인스턴스가 0으로 줄면 작업이 사라집니다.

| 선택지 | 장점 | 단점 |
|---|---|---|
| ① 인스턴스 기반 청구(옛 "CPU 항상 할당") | 코드 변경 없음 | 요청이 없어도 인스턴스가 살아 있는 동안 계속 과금. 공식 문서: 쉬는 인스턴스는 "언제든 종료될 수 있음" → 긴 작업 유실 가능. 무료 범위가 줄어듦(**확인 필요**) |
| ② **요청 안에서 스트리밍(SSE)** | 요청 기반 청구(무료 범위 유지), 지금 대화(`/chat`) · 글쓰기 도우미와 같은 방식. 진행률은 이벤트로 | 화면이 요청을 끝까지 열고 있어야 함 — **탭을 닫거나 다른 기기로 옮기면 요약이 중단**됨. 화면 · API 변경(요약 시작/진행 흐름) |
| ③ 2단계 `jobs` 표 + Cloud Tasks 등을 앞당김 | 탭을 닫아도 계속, 2단계와 같은 구조 | 1단계 범위가 커짐(작업 표 · 재시도 · 잠금 · Cloud Tasks 설정), 2단계 설계를 미리 확정해야 함 |
| ④ 지금 그대로(요청 기반 + 스레드) | 없음 | 동작 보장 안 됨 — **채택 불가** |

**팀장 결정 = ②** (T2). 사양:
- `POST /api/papers/{pid}/summary` → `text/event-stream`: `{"type":"progress","message":"요약을 작성하는 중","progress":0.42}` … `{"type":"done","summary":{data, model, created_at}}` 또는 `{"type":"error","error":"…"}`. 완료 시 서버가 DB에 저장(지금처럼 키워드도 채움).
- 연결이 끊기면(탭 닫기) 서버는 Anthropic 스트림을 멈추고 아무것도 저장하지 않음.
- `GET /api/papers/{pid}/summary` → `{"summary": …, "job": null}`(필드 유지, `job`은 항상 null — 화면 호환). `GET /api/jobs/{id}`와 `Jobs` 클래스는 **삭제**.
- 화면: 요약 중 "이 탭을 닫으면 요약이 멈춰요" 안내(14장).
- 같은 논문 요약을 두 탭에서 동시에 누르면 각각 돌아감(나중 결과가 저장) — 1단계 허용(가정).
- 2단계에서 API 실행기를 작업 큐로 옮길 때 이 엔드포인트를 작업 생성으로 바꿉니다.

### 9.4 응답 속도 · 동시성 · 비용

- 콜드 스타트 **없음**: 서버가 늘 떠 있음(개정 전 Q7 최소 인스턴스 0 · AC-60 측정은 **해당 없음**). 대신 서버 PC가 꺼져 있으면 화면 자체가 안 열림(13.4 · 13.6절).
- 로딩 화면: 첫 요청이 3초 넘게 걸리면 "서버에 연결하는 중…"(14장 D6 — 문구 변경).
- 동시성: 동기 엔드포인트는 스레드 풀(기본 40)에서 돌고 DB 풀은 최대 5(서버가 프로세스 하나라 DB 연결은 많아야 5 + 백업 1) → 풀이 모자라면 대기(타임아웃 30초 후 503 — 가정). 서버 PC가 2단계 CLI 워커도 돌리면 CPU를 나눠 씀(2단계 명세 13.9절).
- 비용: Cloud Run · Cloud Build · Artifact Registry · Secret Manager 비용 **없음**. 서버 PC 전기 · 인터넷(사용자 부담), Tailscale(개인 무료 플랜에서 Funnel 사용 가능 여부 **확인 필요** — 사용자 계정 플랜 확인), Supabase · R2는 PLAN 7장 그대로.
- **Funnel 대역폭**: "바꿀 수 없는 대역폭 제한"(공식 문서, 수치 미공개). PDF는 R2 서명 주소로 직접 오가므로 서버를 거치는 것은 JSON · 화면 파일 · compose 문서뿐 — 3~5명이면 문제없을 것으로 봄(실측: AC-78).

---

## 10. 개발 · 테스트 환경 (사용자용 로컬 모드와 별개)

### 10.1 이 PC 확인 결과 (2026-10-07)

| 항목 | 결과 |
|---|---|
| Python | 3.12.10 |
| `psql` · `pg_config` · `gcloud` · `supabase` CLI | 없음 |
| Docker | 설치돼 있으나 **1단계 테스트에는 쓰지 않음**(사용자 결정 — 10.2절) |
| `%APPDATA%\PaperLab` | 없음(이 PC에는 로컬 PaperLab 서재 없음) |

### 10.2 테스트 DB — 테스트용 Supabase 프로젝트 (확정, 사용자 결정 2026-10-07)

운영 프로젝트와 **별도의 테스트용 Supabase 무료 프로젝트**(**뭄바이 `ap-south-1`** — 사용자 결정 "그대로 둠", 운영은 서울)를 상대로 테스트합니다. Docker 컨테이너는 쓰지 않습니다(팀장 결정 T12를 이 결정으로 바꿈).

**환경 변수**(`cloud.env`, 이름만):
| 변수 | 쓰는 곳 |
|---|---|
| `SUPABASE_TEST_URL` | 테스트 프로젝트 주소(JWKS · Auth) |
| `SUPABASE_TEST_ANON_KEY` | 테스트 사용자 로그인(비밀번호 grant)으로 실제 JWT 받기 |
| `SUPABASE_TEST_SERVICE_ROLE_KEY` | **테스트 프로젝트에서만**: Auth admin API로 테스트 사용자 생성 · 삭제 |
| `SUPABASE_TEST_DB_URL` | 테스트 프로젝트 관리자(`postgres`) Session pooler 주소 — 마이그레이션 · 앱 역할 비밀번호 · RLS 직접 검사 |

**운영 보호 장치**(모두 자동, 하나라도 걸리면 `pytest.exit`로 **즉시 중단** — 실패가 아니라 전체 중단):
1. `SUPABASE_TEST_URL`과 `SUPABASE_URL`의 프로젝트 ref가 같거나, `SUPABASE_TEST_DB_URL`과 `SUPABASE_DB_URL`의 호스트 · 사용자(ref 포함)가 같으면 중단(환경 변수와 `cloud.env`를 둘 다 읽어 비교 — 운영 값이 비어 있으면 이 검사만 건너뜀).
2. 테스트 프로젝트 표지: 테스트 DB에 `public.paperlab_test_project` 표(한 행: 프로젝트 ref)가 **있어야** 테스트가 돎. 이 표는 한 번만 `python -m paperlab.admin mark-test-project`로 만듦 — 이 명령은 대상이 `SUPABASE_URL`(운영)과 같으면 거부하고, 사람이 프로젝트 ref를 직접 입력해 확인해야 함.
3. 반대 방향: 배포 스크립트 · `paperlab.migrate`(운영)는 대상 DB에 `paperlab_test_project` 표가 **있으면** 거부(테스트 프로젝트를 운영으로 착각하는 것 방지).
4. 테스트 코드는 운영 변수(`SUPABASE_URL` · `SUPABASE_DB_URL` · `SUPABASE_SERVICE_ROLE_KEY` 등)를 **읽어서 접속하지 않음** — 1번 비교에만 씀. 서버 앱은 테스트 때 `SUPABASE_TEST_*` 값으로 만든 설정을 주입받음.

**세션 준비**(pytest 세션 시작 한 번):
1. 보호 장치 검사 → `SUPABASE_TEST_DB_URL`로 `paperlab.migrate`(운영과 같은 파일) → 테스트용 `paperlab_app` 접속 주소 얻기(`admin.test_app_role_conninfo`, M3 변경). **비밀번호를 매번 바꾸지 않고 재사용**합니다:
   - 보관: 테스트 프로젝트 DB의 `public.paperlab_test_secrets`(RLS 켜고 정책 없음, `anon` · `authenticated` · `service_role` 권한 회수 → **관리자 연결만 읽음**). 테스트 프로젝트에만 있고 운영 비밀과 무관. 테스트 표지가 없는 DB면 거부.
   - 저장된 비밀번호로 앱 역할 접속을 시도해 **비밀번호 인증 실패일 때만**(처음이거나 누가 바꿈) advisory lock(트랜잭션 범위) 아래에서 새로 만들어 역할에 설정하고 표에 저장 — 동시에 여러 pytest · 개발 서버가 시작해도 한 곳만 바꾸고 나머지는 같은 값을 씀. 다른 접속 오류(네트워크 · 일시정지)면 바꾸지 않고 오류.
   - 개발 서버(11장)도 같은 함수로 앱 역할 주소를 얻음.
2. 지난 실행이 남긴 것 청소: 이메일이 `t-`로 시작하고 하루 지난 테스트 사용자를 삭제.

**테스트 사용자 · 데이터**:
- 테스트(함수)마다 **고유 사용자**를 만듭니다: 이메일 `t-{실행id}-{번호}@paperlab.test`(가정 — 실제 메일이 가지 않는 도메인), Auth **admin API**(`SUPABASE_TEST_SERVICE_ROLE_KEY`)로 `email_confirm: true` + 무작위 비밀번호로 생성. 생성 전에 그 이메일을 테스트 프로젝트 `allowed_emails`에 넣음(Auth Hook이 admin 생성에도 걸리는지 **확인 필요** — 걸려도 통과하도록).
- JWT는 그 사용자로 **비밀번호 로그인**(`SUPABASE_TEST_ANON_KEY`)해서 받습니다 → 서버의 **실제 JWKS 검증 경로**를 그대로 시험. 그래서 테스트 프로젝트는 운영과 달리 **이메일+비밀번호 로그인을 켜고 이메일 확인은 끕니다**(메일 발송 없음). 허용 목록 · 훅은 (개정 Q16) **선택 기능을 시험하기 위해 테스트 프로젝트에서는 켠 상태로 유지**하고, 서버 앱은 테스트마다 `allowlist` 설정(`on`/`off`)을 주입해 두 경우를 모두 시험(AC-04 · 05 · 81). 운영(off)과 다른 점은 이 한 가지.
- 끝나면(픽스처 정리) 사용자를 지움(개인 행은 `on delete cascade`로 같이 지워짐), `allowed_emails` 행도 지움. 테스트가 중간에 죽어 남은 것은 다음 세션 시작 때 청소.
- 레거시 HS256 경로 · 잘못된 토큰(AC-02)은 테스트 안에서 만든 키로 서명한 토큰을 씀(서버 검증기에 키를 주입하는 시험 전용 경로).
- 저장소: 자동 테스트는 **가짜 저장소**(`STORAGE_BACKEND=fake`, 메모리 · 요청 기록)만 씁니다. 운영 R2 버킷을 자동 테스트에서 건드리지 않습니다(R2 키는 운영 변수 — 보호 장치 4번). 실제 R2 확인은 [실환경] AC(AC-38 · 43 · 45a)로, **존재하지 않는 임의 uuid 사용자 경로**(`users/{임의 uuid}/…`)에서 하고 끝나면 지웁니다.

**주의할 점**:
- 무료 플랜은 **활성 프로젝트 2개까지**(공식 문서) — 운영 + 테스트로 **둘 다 씁니다**. 스테이징 등 세 번째 프로젝트는 만들 수 없습니다(필요해지면 Pro).
- 테스트 프로젝트도 **1주 미사용 시 일시정지**됩니다. 정지 상태면 세션 시작에서 "테스트 프로젝트가 일시정지됐어요 — Supabase 대시보드에서 Restore" 메시지로 중단(건너뜀 아님). 1주 안에 한 번 테스트를 돌리면 정지가 덜 일어남(10.3절).
- 네트워크가 필요하고 로컬 DB보다 느립니다(테스트 프로젝트가 뭄바이라 서울보다 왕복이 김 — 전체 실행 시간은 1단계 끝에 측정해 보고. AC-35 검색 성능 기준값도 이 왕복을 포함해 해석).
- 여러 사람이 동시에 돌려도 사용자가 고유해서 서로 간섭하지 않음. 단 AC-20 같은 카탈로그 검사 · 마이그레이션은 공유 — 마이그레이션은 `schema_migrations` 잠금(advisory lock, 트랜잭션 범위)으로 동시 실행을 막음.
- DB가 필요한 테스트는 `@pytest.mark.db`. `SUPABASE_TEST_*`가 없으면 **건너뛰되 이유를 출력**. **품질팀 검증 때는 건너뜀 0개여야 함**(AC-62). DB가 필요 없는 테스트(`test_citations`, `test_writing`, `test_doc_formats`의 변환 부분, `test_sources`, `test_ai`)는 지금처럼 그냥 돎.

### 10.3 CI

**사용자 결정(2026-10-07): 지금은 CI를 하지 않습니다**(팀장 결정 T13을 대체). 품질팀이 **이 PC에서** 테스트 프로젝트(`cloud.env`의 `SUPABASE_TEST_*`)로 전체 테스트를 실행합니다. GitHub Actions와 그 비밀 등록은 범위 밖(17장).
테스트 프로젝트 일시정지를 줄이려면 1주 안에 한 번은 테스트를 돌립니다(개발 기간에는 자연히 충족 — 가정).

## 11. 설치형 실행기

| 선택지 | 내용 | 장단점 |
|---|---|---|
| ① 지우기 | `PaperLab.bat` · `PaperLab.command` · `paperlab.sh`, `[project.scripts] paperlab`, `desktop`(pywebview) 선택 의존성, `__main__`의 브라우저 열기 · `--window` · `--data-dir` 삭제 | 사용자 결정(로컬 모드 없음)과 일치, 혼동 없음 |
| ② 웹 주소 바로가기로 | 같은 이름의 파일이 서버 주소(개정 전: Cloud Run 주소)를 브라우저로 엶 | 편하지만 주소는 배포 후에 정해지고 저장소에 사용자 주소가 박힘. 브라우저 즐겨찾기 · "앱으로 설치"(PWA 아님)로 충분 |
| ③ 2단계 워커 실행기로 | 지금 파일을 워커 설치 · 실행기로 고침 | 워커 설계(2단계)가 아직 없음 — 지금 하면 다시 고침 |

**팀장 결정 = ①** (+ 2단계에서 워커 실행기를 새로 만듦). 개발용으로 `python -m paperlab`은 **개발 서버**로 남깁니다: `PAPERLAB_DEV=1`과 테스트/개발 DB · Supabase 값이 있어야만 뜨고, `127.0.0.1`에만 열며, 데이터 폴더 · 브라우저 자동 열기 없음. README의 "실행" 절은 "클라우드 주소로 접속"으로 바꿉니다.

**개발 서버 규칙 (F10, 팀장 결정)**:
| 항목 | 규칙 |
|---|---|
| 대상 | **테스트용 Supabase 프로젝트만**(`SUPABASE_TEST_URL` · `SUPABASE_TEST_ANON_KEY` · `SUPABASE_TEST_DB_URL`). 운영 변수(`SUPABASE_URL` · `SUPABASE_DB_URL` · `R2_*` · `APP_ENCRYPTION_KEY` · `ALLOWED_EMAILS`)는 읽지 않음 |
| DB 접속 | 관리자(`postgres`)가 아니라 **앱 역할 `paperlab_app`** 으로(운영과 같은 RLS 경로). 주소는 10.2절 세션 준비 1번과 같은 함수로 얻음(테스트 표지 없는 DB면 시작 거부). 관리자 주소는 시작할 때 그 값을 읽는 데만 씀 |
| 저장소 | **같은 출처 가짜 저장소**: 메모리 구현의 서명 주소를 `/_dev_storage/{키}?X-Amz-Expires=…&X-Amz-Signature=…`로 만들고, 개발 서버에만 `PUT` · `GET /_dev_storage/{키}` 경로를 둠(서명 · 만료 검사, 틀리면 403, 크기 100MB). 브라우저 업로드 · PDF 보기를 실제로 확인할 수 있음. 운영(`dev=False`)에는 이 경로가 없음 |
| 암호화 키 · 허용 목록 | 개발용 변수 `PAPERLAB_DEV_ENCRYPTION_KEY`(없으면 실행 동안만 쓰는 임시 키 — 다시 시작하면 저장한 API 키를 못 읽음) · `PAPERLAB_DEV_ALLOWED_EMAILS`(비면 테스트 프로젝트 로그인 사용자 모두 허용, 시작할 때 안내 출력) |
| 로그인 | 테스트 프로젝트는 구글 공급자가 꺼져 있으므로, **개발 모드에서만** 이메일 · 비밀번호 로그인을 엶: `GET /api/public-config`에 `dev_email_login: true`가 있을 때만 화면이 `static/js/dev-login.js`를 불러 로그인 칸을 그림. **운영은 `dev_email_login`을 내보내지 않고 `/static/js/dev-login.js`가 404**(운영은 구글 로그인만 — 확정 Q2) |
| 출처 검사 | 개발 모드에서는 `http://{Host}`도 같은 출처로 인정 |

### 11.1 바탕화면 웹 바로가기 (확정 Q6)

서버가 열린 뒤 **앱 창으로 열리는 바로가기**를 바탕화면에 만듭니다(주소창 · 탭 없는 창 — 지금 `--window`와 비슷한 느낌).
- 스크립트 `deploy/make-shortcut.ps1 -Url <배포 주소>`: 바탕화면(`[Environment]::GetFolderPath('Desktop')` — 이 PC는 OneDrive 바탕 화면)에 `PaperLab.lnk`를 만듭니다. 대상 = Microsoft Edge(Windows 11 기본 포함) `--app=<배포 주소>`. Edge가 없으면 Chrome `--app=`, 둘 다 없으면 일반 인터넷 바로가기(`.url`)로.
- 아이콘: `deploy/paperlab.ico`(디자인팀 — 지금 화면 아이콘과 같은 모양). 없으면 브라우저 기본 아이콘.
- **개정(서버 PC)**: 주소는 Funnel 고정 주소 `https://kimjuhyeon.tailac17f6.ts.net/`. 이 주소는 사용자 본인의 공개 서버 주소이고 2단계 설치 파일에도 들어가므로(U6) **문서에 적어도 됩니다**(사용자 · 팀장 확인 2026-10-07 — Supabase ref · 키 같은 비밀은 계속 금지). 스크립트는 지금처럼 `-Url` 인자로 받고, 기본값을 넣을지는 개발팀 재량(넣는다면 S10 "주소를 한 곳에만" 규칙). 관리자가 Funnel을 켠 뒤 **관리자 PC에서** 실행합니다. 2단계 Electron 앱이 나오면 같은 이름 바로가기를 앱이 덮어씁니다(U3).
- **다른 사용자 PC는 2단계 Electron 설치형 앱**으로 합니다(확정 Q13 — 앱 창(클라우드 화면) + CLI 워커, 6단계에 폴더 동기화 추가, Windows만, GitHub Releases + 자동 업데이트). 1단계에서 다른 사용자는 웹 주소로 접속합니다(브라우저 즐겨찾기).
- 앱 창에서 구글 로그인이 같은 창 안에서 끝나는지 **[실환경] AC-69**로 확인.
- macOS · Linux 바로가기는 범위 밖(사용자 PC가 Windows — 필요하면 요청).

## 12. 기존 데이터 이관

**확정(Q1): 기존 데이터 없음, 새로 시작합니다.** 이관 도구(`library.db` · `pdfs/` 가져오기)는 만들지 않고, PLAN 1단계의 "이관 도구" 범위와 완료 기준 "로컬 데이터 이관 후 논문 수 · 하이라이트 수 · 원고 수가 같음"을 지웁니다(PLAN 개정 반영). 나중에 필요해지면 별도 명세로 다룹니다.

---

## 13. 배포 · 운영

> **개정 2026-10-07(사용자 결정)**: 이 장은 서버 PC 기준으로 다시 썼습니다. 개정 전 내용(`deploy.ps1` · Secret Manager · Cloud Run Job · Cloud Scheduler · 리비전 되돌리기)은 폐기. 서버 PC에서 그대로 따라 할 설치 절차는 **[`deploy/server-pc/README.md`](../../deploy/server-pc/README.md)**(기획팀 작성, 스크립트는 개발팀)에 있습니다.

### 13.1 설치 흐름 (사람 손 작업은 사용자, 명령은 서버 PC의 Claude Code · 관리자)

1. **사용자 — 계정 준비**(대부분 끝남): 운영 · 테스트 Supabase 프로젝트, Google OAuth, R2(6.1 · 7.6 · 10.2절), 관리자 PC `cloud.env`. **Tailscale 관리 콘솔**(13.6절): MagicDNS 켜기, HTTPS 인증서 켜기, 정책 파일에 `funnel` 노드 속성, 서버 PC 키 만료 끄기.
2. **사용자 — 비밀값 옮기기**: 관리자 PC `C:\Users\user\.paperlab\cloud.env`를 **USB 메모리로** 서버 PC `C:\Users\USER\.paperlab\cloud.env`에 복사(또는 사용자가 서버 PC에서 직접 입력). **저장소 · 채팅(Claude Code 대화 포함) · OneDrive · 메일 · 메신저를 거치지 않음.** 복사 뒤 USB의 파일은 지움. 서버 PC용으로 줄 정리: `SUPABASE_SERVICE_ROLE_KEY` · `GCP_PROJECT_ID` · `GCP_REGION` 줄 삭제(서버 PC에 필요 없음 — 최소 권한), `PAPERLAB_PUBLIC_URL=https://kimjuhyeon.tailac17f6.ts.net` 줄 추가. 서버 PC의 Claude Code는 이 파일의 **내용을 읽거나 출력하지 않고**, 점검 스크립트(변수 **이름**만 보고)로만 확인합니다.
3. **파일 권한**: 설치 스크립트가 `.paperlab` 폴더와 `cloud.env`의 상속을 끊고 `USER` · `SYSTEM` · `Administrators`만 접근하게 함(`icacls` — 개발팀). 지금 관리자 PC 방식(icacls 현재 사용자만)과 같은 취지.
4. **서버 PC 준비**(13.7절 · 안내서): 절전 끄기 확인, 시간대 `Korea Standard Time` 확인, Git · Python 3.12(`py -3.12`) · `pg_dump` 17 확인, Tailscale 로그인 · 무인 실행.
5. **설치 스크립트 `deploy/server-pc/install.ps1`(개발팀)** — `cloud.env` 값을 화면 · 로그에 찍지 않음, 몇 번 다시 실행해도 안전:
   1. `D:\PaperLab` 권한 제한(상속 끊고 `USER` · `SYSTEM` · `Administrators`만), `logs` · `tmp` 폴더 만들기. 저장소를 `D:\PaperLab\study99web`에 받기(없을 때 `git clone`, 있으면 건너뜀), 배포 브랜치 확인(S7). (처음 한 번은 안내서대로 서버 PC의 Claude Code가 `D:\PaperLab`에서 직접 clone한 뒤 그 안의 이 스크립트를 실행)
   2. `py -3.12 -m venv .venv` → `pip install -e .`.
   3. `cloud.env` 점검(빠진 변수 이름만 출력, 13.1-2의 지울 줄이 남아 있으면 경고).
   4. 관리자 연결로 `python -m paperlab.migrate`(운영 보호 장치 3번 — 테스트 표지 DB면 거부). 이어서 `python -m paperlab.admin sync-allowlist`를 **늘 부름** — `ALLOWED_EMAILS`가 비었거나 없으면 표를 바꾸지 않고 끝남(운영 off는 이 줄이 없으므로 아무것도 안 함 — 6.3절 · AC-06).
   5. **앱 역할 주소**: `SUPABASE_APP_DB_URL`이 비어 있을 때만 `python -m paperlab.admin app-role --write-env` — 무작위 비밀번호 설정 후 `cloud.env`의 그 줄만 바꿔 씀(임시 파일에 쓰고 바꿔치기, 권한 유지, 값은 출력 안 함). 이미 있으면 건드리지 않음(M3 원칙).
   6. 작업 스케줄러 등록: `PaperLab Server`(9.2절), `PaperLab Backup`(13.3절), `PaperLab Watchdog`(13.5절). `USER` 비밀번호는 Windows 입력 창으로만 받음(스크립트 · 파일에 남기지 않음 — S4).
   7. 서버 작업 시작 → `http://127.0.0.1:8080/api/health?deep=1`이 `db: ok, storage: ok`가 될 때까지 대기(최대 60초).
   8. Funnel 켜기(13.6절 `deploy/server-pc/funnel.ps1`) → 공개 주소 `https://kimjuhyeon.tailac17f6.ts.net/api/health` 200 확인.
   9. 끝에 요약: 서버 · 백업 · 감시 작업 상태, 배포한 커밋, Funnel 상태(값 없이).
6. **사용자 — 첫 설치 뒤**: Supabase Auth Site URL · Redirect URLs, R2 버킷 CORS `AllowedOrigins`에 `https://kimjuhyeon.tailac17f6.ts.net` 넣기(6.1 · 7.6절). **관리자**: 관리자 PC 바탕화면 바로가기(11.1절).

### 13.2 주소

- **확정(사용자 결정 2026-10-07)**: 공개 주소 = **`https://kimjuhyeon.tailac17f6.ts.net`** (서버 PC 이름 `kimjuhyeon` + tailnet DNS 이름 `tailac17f6.ts.net` — 서버 PC 실측). 사용자 본인의 공개 서버 주소이고 설치 파일에도 들어가므로 문서에 적습니다(비밀 아님). 개정 전 Q4(기본 Cloud Run 주소)는 폐기.
- **이 주소가 바뀌는 경우**: Tailscale에서 기기 이름을 바꾸거나 tailnet DNS 이름을 바꾸면 주소가 바뀝니다 → Supabase Redirect URLs · R2 CORS · `PAPERLAB_PUBLIC_URL` · 바로가기 · **2단계 설치 파일(새 릴리스 필요)** 을 모두 고쳐야 함. 그래서 **기기 이름 · tailnet 이름을 바꾸지 않습니다**(안내서 경고). 서버 PC를 다른 PC로 바꿀 때 같은 주소를 쓰려면 새 PC의 Tailscale 기기 이름을 `kimjuhyeon`으로 맞춰야 함(옛 기기 삭제 후 — 가능 여부 **확인 필요**).
- 저장소 · 코드에서 이 주소는 **한 곳에만** 둡니다(S10 — 서버는 `cloud.env`의 `PAPERLAB_PUBLIC_URL`, 2단계 앱은 빌드 설정 한 곳). 사용자 정의 도메인은 범위 밖(Funnel은 tailnet 도메인만 지원 — 공식 문서).

### 13.3 백업

- **공식 문서 확인**: Supabase **무료 플랜은 자동 일일 백업이 없고**, CLI `db dump`로 직접 내보내라고 권합니다. Pro는 일일 백업 7일 보관(+ 선택 PITR).
- **확정(Q3 → Q12로 변경): 매일 자동 DB 덤프, 세대 보관.** **실행 위치(개정 — 사용자 결정 2026-10-07에 따름): 서버 PC 작업 스케줄러**(개정 전 팀장 결정 T14 Cloud Run Job + Cloud Scheduler는 폐기). **저장 위치: R2**(사용자 결정 — M7 해결). **팀장 결정: PDF와 같은 버킷의 `backups/db/` 접두어**(기획팀 추천). 근거: 새 변수 · 새 토큰이 필요 없음(변수 이름 고정 원칙), 수명 주기 규칙 `incoming/`과 겹치지 않음, 서버의 사용자 경로는 `backups/`를 만들거나 서명할 수 없음(7.1절 3번). 단점: 같은 키로 백업도 지울 수 있음 — 별도 버킷 + 전용 토큰(새 변수 2~3개 필요)은 필요해지면 검토(19.3절 M10).
- 작업: 작업 스케줄러 `PaperLab Backup` — `USER` 계정 · 암호 저장(S4), 동작 `D:\PaperLab\study99web\.venv\Scripts\python.exe -m paperlab.admin backup --tmp-dir D:\PaperLab\tmp`(임시 폴더 인자 — 새 변수 없음), 출력은 `D:\PaperLab\logs\backup.log`(회전 — 1MB × 5개, 가정).
  - `pg_dump` 찾기: `cloud.env`의 `PAPERLAB_PG_DUMP`(S9) → 없으면 `PATH`. **경로를 코드에 박지 않음.** 서버 PC 실측: `pg_dump` 17.10이 `C:\Users\USER\tools\pgsql\bin`(PATH 등록). 주 버전 규칙: `pg_dump` 주 버전 ≥ Supabase Postgres 주 버전 — 테스트 프로젝트 서버 17.11과 같은 17이라 문제없음, **운영 프로젝트 서버 버전은 확인 필요**(`select version()`, 설치 스크립트가 비교해 낮으면 백업 작업 등록 전에 중단). 작업 스케줄러가 로그온 없이 돌 때 사용자 PATH가 적용되는지 **확인 필요** — 안 되면 `PAPERLAB_PG_DUMP`에 경로를 넣음(안내서).
  - 접속: **앱 역할 주소**(`SUPABASE_APP_DB_URL`) + `pg_dump --format=custom --schema=paperlab --role=service_role`(앱 역할 주소로 접속 후 `--role`로 `service_role` 전환 — RLS를 넘어 전체 행을 읽기 위한 시스템 작업, 로그에 `reason=backup`). `auth.users`는 Supabase 관리 영역이라 덤프하지 않음(복구 시 같은 구글 계정으로 다시 로그인하면 `user_id`가 달라질 수 있음 — 복구 절차서에 `user_id` 다시 잇기 단계 포함, 기획팀이 배포 안내문에 작성).
  - 결과를 R2 `backups/db/{YYYYMMDD}.dump`에 올림(**파일 이름 날짜는 한국 시간(KST)** — 04:00 KST 실행을 UTC로 쓰면 전날 날짜가 되므로)(R2 기본 저장 암호화, 추가 암호화 없음 — 가정). 덤프는 수 MB 수준이라 10GB 한도에 영향 작음(사용량 표시에 포함, 7.6절).
  - **로컬에 남기지 않음**: 덤프는 `D:\PaperLab\tmp` 아래 임시 폴더에 만들고 R2에 올린 뒤 **성공 · 실패 모두** 지움(지금 `tempfile.TemporaryDirectory` — 위치만 인자로). 백업 원본은 R2 하나(로컬 보관 · 복사본 없음, AC-71). 덤프에는 모든 사용자 데이터가 들어 있으므로 C: 기본 `%TEMP%`가 아니라 권한을 제한한 `D:\PaperLab\tmp`를 씀.
  - **세대 보관: 최근 14개(14일)** (확정 Q12, M1 해결) — 올린 뒤 오래된 것을 지움. 같은 날(KST) 다시 실행하면 그날 파일 `{YYYYMMDD}.dump`를 **덮어씀**(**팀장 결정** — 하루에 한 세대). 실패하면 종료 코드 ≠ 0 + `backup.log`에 오류(값 없이), 작업 스케줄러 "마지막 실행 결과"에 남음. 감시 작업이 매일 R2의 가장 최근 백업 날짜를 보고 **36시간 넘게 새 백업이 없으면** `watchdog.log`에 경고(13.5절, 알림 발송은 범위 밖).
- 일정: 작업 스케줄러 **매일 04:00**(확정 Q12) — 서버 PC 시간대가 **`Korea Standard Time`(KST)** 이어야 함(설치 스크립트가 `tzutil /g`로 확인, 다르면 중단). "예약된 시작 시간을 놓친 경우 가능한 대로 빨리 작업 시작" **켬**(04:00에 PC가 꺼져 있었으면 켜진 뒤 실행). "작업이 다음 시간 이상 실행되면 중지" = 1시간.
- 복원: `pg_restore`로 빈 프로젝트에 복원하는 절차를 `deploy/README.md`에 적고, 1단계 검증 때 **테스트 프로젝트에 한 번 복원해 봄**(AC-70).
- 백업은 DB에 접속하므로 일시정지를 늦추는 효과가 있을 수 있으나, 그것을 목적으로 하지 않음(13.4절).
- R2의 PDF는 따로 백업하지 않음(R2 자체 내구성에 맡김, 객체 버전 관리 지원 여부 **확인 필요**). 사용자가 지운 PDF는 복구 불가(지금과 같음).

### 13.4 일시정지 대응

- Supabase 무료 플랜은 1주일 안 쓰면 일시정지(PLAN). 정지 중에는 로그인 · DB 모두 안 됨.
- 서버: DB 연결 실패 → 503 `db_unavailable`(6.5절). 화면: "서비스가 잠시 멈춰 있어요. 관리자에게 알려 주세요(Supabase 대시보드에서 다시 켜기)" 화면(14장). 로그인 단계에서 Supabase Auth가 응답하지 않을 때도 같은 화면.
- 다시 켜기: 사용자가 Supabase 대시보드에서 Restore(팀이 안내문 작성).
- 주기적 접속으로 정지를 피하는 방법은 Supabase 정책상 허용되는지 **확인 필요** — 기획팀은 추천하지 않음. 공식 해결은 Pro(코드 변경 없음, PLAN). (서버 PC의 감시 작업은 `/api/health`(DB 안 건드림)만 자주 부르고, `deep=1`은 하루 몇 번만 — 정지 회피 목적의 DB 접속을 만들지 않음)
- **서버 PC가 꺼진 경우(새 제약)**: Funnel 주소 자체가 응답하지 않으므로 PaperLab 화면이 **열리지 않습니다**(브라우저 기본 오류 화면 — 우리 화면이 아님). 이미 열려 있던 탭은 다음 요청에서 네트워크 오류 → D5와 같은 문구에 "서버 PC가 꺼져 있을 수 있어요"를 더함(14장 D5). 다시 켜기: 서버 PC 전원을 켜면 로그온 없이 서버 · Funnel이 자동으로 올라옴(13.6 · 13.7절, AC-76).

### 13.5 로그 · 상태 확인 · 감시

- 로그(서버 PC 파일, 9.1절): `D:\PaperLab\logs\server.log`(JSON 한 줄: 시각 · 요청 id · 경로 · 상태 코드 · 걸린 시간 · `user_id`), `backup.log`, `watchdog.log`, `update.log`. 모두 크기 회전(합계 100MB 이하 — 가정). 폴더 권한은 `USER` · `SYSTEM` · `Administrators`만(9.1절). **남기지 않는 것**: 토큰, API 키, 서명 주소, 요청 본문, 논문 내용, 이메일, `cloud.env` 값. 요청 id는 들어온 `X-Request-Id`가 있으면 그것, 없으면 새로(개정 전 `x-cloud-trace-context`는 지움).
- `system_tx(reason)` 사용은 `reason`과 함께 INFO 로그.
- `GET /api/health` → `{"ok": true, "version": …}`(DB를 건드리지 않음 — 프로세스 생존 확인). `GET /api/health?deep=1` → DB `select 1` · R2 `head_bucket` 결과 `{"ok":…, "db": "ok|error", "storage": "ok|error"}`(인증 불필요, 오류 내용은 숨김). `version`에 배포한 커밋 앞 7자리를 더함(가정 — 업데이트 확인용).
- **감시 작업 `PaperLab Watchdog`**(작업 스케줄러, 5분마다 — 가정, 스크립트 `deploy/server-pc/watchdog.ps1`):
  1. `http://127.0.0.1:8080/api/health` — 3번 연속 실패(15분)면 `PaperLab Server` 작업을 멈췄다 다시 시작하고 `watchdog.log`에 기록(멈춤 · 응답 없음 대비 — 작업 스케줄러 재시작은 프로세스가 끝날 때만 동작).
  2. 하루 한 번 공개 주소 `https://kimjuhyeon.tailac17f6.ts.net/api/health` — 실패하면 `tailscale funnel status` 결과(주소 · 포트만)를 `watchdog.log`에 경고로(자동 복구는 하지 않음 — Funnel 설정을 스크립트가 함부로 바꾸지 않게).
  3. 하루 한 번 최근 백업 날짜 확인(13.3절, 36시간).
  4. C: 여유 공간 **5GB 미만**(지금 약 15GB — Windows 업데이트 · Python 캐시가 씀) 또는 D: 여유 **20GB 미만**이면 경고(가정).
- **외부 알림(메일 · 메신저 · 외부 감시 서비스)은 범위 밖** — 관리자가 주 1회 `watchdog.log` · 작업 스케줄러 상태와 **Google OAuth 동의 화면 게시 상태("테스트"인지 — Q16, AC-82)** 를 확인(가정). 서버 PC가 아예 꺼지면 이 감시도 멈추므로 **사용자가 "안 열려요"로 처음 알게 됨** — 외부 감시를 둘지는 19.4절 Q-S4.

### 13.6 Tailscale Funnel 설정

**공식 문서 확인(2026-10-07, tailscale.com/kb/1223/funnel · kb/1311/tailscale-funnel)**: Funnel은 Tailscale v1.38.3 이상, tailnet에 **MagicDNS** 켜짐 · **HTTPS 인증서** 켜짐, 정책 파일 `nodeAttrs`에 **`funnel` 속성**이 필요. **공개 포트는 443 · 8443 · 10000만**. TLS는 **서버 PC의 Tailscale이 종료**하고 복호화한 요청을 로컬 서비스로 넘김(Funnel 중계 서버는 TCP만 중계). 프록시 대상은 **`http://127.0.0.1`만 지원**. 이름은 tailnet 도메인(`*.ts.net`)만. **바꿀 수 없는 대역폭 제한** 있음. `--bg`로 켜면 **재부팅 · `tailscale down/up` 뒤에도 자동으로 다시 공유**. Let's Encrypt 발급 한도에 걸리면 **약 34시간** 기다려야 할 수 있음(인증서를 자꾸 새로 받지 않음).

| 항목 | 설정 |
|---|---|
| 관리 콘솔(사용자) | DNS → MagicDNS **켜기**, HTTPS Certificates **켜기**. tailnet DNS 이름은 지금 `tailac17f6.ts.net` — **바꾸지 않음**(13.2절) |
| 정책 파일 `nodeAttrs` | 공식 기본 예시는 `"target": ["autogroup:member"]`(tailnet의 **모든 사용자 기기**가 Funnel 가능). **기획팀 추천(S6)**: 서버 PC에만 — 태그 `tag:paperlab-server`를 만들어(`tagOwners`) 서버 PC에 붙이고 `{"target": ["tag:paperlab-server"], "attr": ["funnel"]}`. 태그 문법 · 태그를 붙인 기기의 소유권 변화(사용자 → 태그) **확인 필요**. 대안: 기본 예시 그대로(설정 쉬움, 다른 기기도 Funnel을 켤 수 있음) |
| 기기 키 만료 | 서버 PC 기기의 **Key expiry 끄기**(관리 콘솔 Machines → 서버 PC → Disable key expiry). 만료되면 Funnel이 끊김. 태그 기기는 기본으로 만료가 꺼지는지 **확인 필요** |
| 무인 실행 | 서버 PC Tailscale을 **Run unattended**로(트레이 → Preferences, 또는 `tailscale up --unattended=true` — 관리자 권한 필요할 수 있음). 그래야 Windows에 아무도 로그인하지 않아도 연결 유지(Tailscale 문서 "Keep Tailscale running when I'm not logged in"). 실측 때 `BackendState=Stopped`라 **먼저 로그인 · 연결 필요** |
| Funnel 켜기 | `tailscale funnel --bg 8080`(공개 443 → `http://127.0.0.1:8080`). 처음 실행 때 브라우저에서 Funnel 사용 승인 화면이 뜰 수 있음(공식 문서 — 사용자가 승인). 스크립트 `deploy/server-pc/funnel.ps1`(개발팀): 켜기 · 상태(`tailscale funnel status`) · 끄기(`tailscale funnel --https=443 off`). **443 하나만** 열고 8443 · 10000은 쓰지 않음 |
| 확인 | `tailscale funnel status`에 `https://kimjuhyeon.tailac17f6.ts.net` → `http://127.0.0.1:8080` 한 줄. 휴대폰 데이터(서버 PC와 다른 망)로 공개 주소 `/api/health` 200(AC-59) |
| Host · 헤더 | Funnel이 원래 `Host`(`kimjuhyeon.tailac17f6.ts.net`)를 넘기는지, `X-Forwarded-For` · `X-Forwarded-Proto`를 붙이는지 공식 문서에서 찾지 못함 → **확인 필요**(AC-75로 실측 — 6.5절 Host · 출처 검사는 `PAPERLAB_PUBLIC_URL` 기준이라 Host가 바뀌어도 동작하게 설계) |
| 긴 연결 | 대화 · 글쓰기 SSE가 Funnel을 거쳐 몇 분 이어지는지 **확인 필요**(AC-78) |

### 13.7 서버 PC 설정 · 보안 관리

**전원 · 재부팅**
- 절전 · 최대 절전 **사용 안 함**(실측: 이미 그렇게 돼 있음). 설치 스크립트가 `powercfg /query`로 AC 전원의 절전(`STANDBYIDLE`) · 최대 절전 시간이 0인지만 확인하고 아니면 안내(바꾸는 것은 사용자 확인 후 — 가정). 화면 끄기는 상관없음.
- 네트워크 어댑터 "전원을 절약하기 위해 컴퓨터가 이 장치를 끌 수 있음" 끄기(안내서 — 사용자 손 작업).
- 정전 뒤 자동으로 켜지기: BIOS/UEFI의 "AC 전원 복구 시 켜기(Restore on AC Power Loss)" — PC마다 메뉴가 달라 **사용자 확인**(19.4절 Q-S5).
- Windows 업데이트 재부팅: **활성 시간**을 사용자들이 쓰는 시간대(예: 08~24시 — 가정)로. 재부팅 뒤 서버(작업 스케줄러 "시스템 시작 시") · Tailscale(무인 실행) · Funnel(`--bg`)은 **로그온 없이** 올라옴(AC-76). 2단계 CLI 워커(Electron 앱)는 **사용자 로그온이 있어야** 돌므로 재부팅 뒤 로그온 전까지 서버 PC 워커는 꺼짐(2단계 명세 13.9절, 질문 Q-S2).

**보안 (Funnel로 인터넷에 공개되므로)**
- 공개되는 것은 Funnel 443 → `127.0.0.1:8080` **하나뿐**. 서버는 `127.0.0.1`에만 열고 방화벽 들어오는 규칙을 만들지 않음. 원격 데스크톱 · 파일 공유를 인터넷에 열지 않음(Windows 11 Home은 원격 데스크톱 호스트가 없음 — 원격 관리가 필요하면 Tailscale 안에서만, 범위 밖).
- 서버 PC Windows 계정 `USER`: 강한 비밀번호, 화면 잠금, 다른 사람 계정 · 손님 계정 없음. **서버 PC는 사용자 전용**(사용자 결정 Q17 — 다른 Windows 계정 없음).
- 디스크 암호화: **하지 않음**(사용자 결정 Q18 — 집 · 사무실 고정 PC라 도난 위험 낮다고 판단. Windows 11 Home은 BitLocker 관리 기능도 없음). PC 도난 시 `cloud.env` · 로그가 노출되는 위험을 받아들임(18장) — 도난 · 분실이 생기면 13.7절 "유출 의심" 절차(키 재발급)를 바로 실행.
- Windows 보안(Defender) · 자동 업데이트 켜 둠. Python · 의존성 업데이트는 13.8절 업데이트 때 함께.
- `cloud.env`: 13.1-3 권한, 백업 · 동기화 폴더(OneDrive) 밖, 내용을 화면에 띄우지 않음. 유출이 의심되면: Supabase DB 비밀번호 · R2 키 다시 발급 → `cloud.env` 수정 → `admin app-role`(앱 역할 회전) → `rotate-key`(암호화 키 회전, 8.3절) → 서버 다시 시작.
- 서버 PC의 Claude Code: 운영 · 점검에 쓰되 `cloud.env` 내용을 읽거나 대화에 붙이지 않고, 운영 DB에 직접 질의하지 않음(관리 명령만). 테스트는 테스트 프로젝트로만(10.2절 보호 장치 그대로).
- Tailscale 계정: 2단계 인증 켜기 권장(사용자). Tailscale 관리 콘솔 권한이 곧 Funnel을 켜고 끄는 권한.

### 13.8 업데이트 · 되돌리기

**업데이트 스크립트 `deploy/server-pc/update.ps1`(개발팀)** — 관리자(또는 서버 PC의 Claude Code)가 **승인 · 푸시된 커밋만** 반영. 자동 `git pull`은 하지 않음(가정 — S7).
1. `git fetch` → 배포 브랜치(S7)의 새 커밋 목록을 보여 줌 → 진행 확인(`-Yes`로 생략 가능).
2. 작업 폴더에 고친 파일이 있으면 중단(서버 PC에서 코드를 직접 고치지 않음).
3. 지금 커밋을 `D:\PaperLab\logs\update.log`에 기록 → `git pull --ff-only`.
4. `pyproject.toml`이 바뀌었으면 `pip install -e .`.
5. 관리자 연결로 `python -m paperlab.migrate` → `admin sync-allowlist`(`ALLOWED_EMAILS`가 비면 아무것도 안 함 — 6.3절)(서버를 멈추기 **전**에 — 마이그레이션은 "열 삭제 · 이름 변경은 두 번에 나눠" 규칙이라 옛 코드와 함께 돌아도 안전). 옛 커밋으로 되돌리는 경우(`-Ref`가 뒤쪽 커밋)는 이 단계를 건너뜀. **이 단계가 실패하면**(DB 오류 · Supabase 일시정지 포함) **코드만 옛 커밋으로 되돌리고 서버는 다시 시작하지 않음**(옛 코드로 계속 돎), 종료 코드 1.
6. `PaperLab Server` 작업 멈춤 → 시작(중단 수 초 — 그동안 요청은 실패, 대화 SSE는 끊김. 사용자가 적은 시간에 — 가정).
7. `127.0.0.1:8080/api/health?deep=1` 정상 · 응답의 커밋이 새 커밋인지 확인(`-TimeoutSec`, 기본 60초). 안 되면 **자동으로 3번 커밋으로 되돌리고**(`git reset --hard <옛 커밋>`, 의존성이 바뀌었으면 다시 설치 — 마이그레이션은 되돌리지 않음) 서버 재시작 · 경고. `deep=1`은 DB까지 확인하므로 **반영 중 Supabase가 일시정지돼 있어도 되돌림**이 일어남(정지 해제 후 다시 업데이트). 되돌린 뒤에도 비정상이면 오류로 남기고 팀장 보고.

**되돌림 조건 정리(구현 반영)**: (a) 시작 전 거부 — 작업 폴더에 고친 파일 · 배포 브랜치 아님 · ff-only 불가(코드 안 바뀜). (b) 마이그레이션 · `sync-allowlist` 실패 → 코드만 되돌림, 서버 재시작 없음. (c) 재시작 뒤 상태 확인 실패(새 코드 시작 실패 · DB · 저장소 오류 · Supabase 일시정지 · 커밋 불일치) → 코드 되돌림 + 재시작. 어느 경우든 DB 마이그레이션은 되돌리지 않음.
8. 결과(옛 커밋 → 새 커밋, 성공/되돌림)를 `update.log`에.

- **되돌리기**: `update.ps1 -Ref <커밋>`(지정 커밋으로 맞추고 6~8단계). 개정 전 Cloud Run 리비전 되돌리기는 없음. DB 마이그레이션은 되돌리지 않음(규칙 그대로).
- **비밀값 · 설정 변경**: `cloud.env` 수정 뒤 서버 작업만 다시 시작(`update.ps1 -RestartOnly` — 가정). 사용자 추가 · 삭제는 **Google Cloud 콘솔의 OAuth 테스트 사용자 목록**에서(서버 재시작 필요 없음 — Q16). 사람을 뺄 때는 Supabase 대시보드에서 그 사용자도 지움(이미 받은 세션이 만료 전까지 남을 수 있음 — **확인 필요**). (허용 목록을 켠 경우에만 `ALLOWED_EMAILS` 수정 → `sync-allowlist` → 재시작)
- **Python 자체 · Tailscale 업데이트**: 사용자가 알림을 보고 함. Python 3.12 패치 업데이트 뒤 가상환경이 깨지면 `install.ps1 -RecreateVenv`(가정).

---

## 14. 화면 변경 (디자인팀 몫)

디자인팀은 `docs/design/phase1-cloud-ui.md`에 시안 · 문구 · **CSS 클래스 이름 목록**을 먼저 쓰고, 개발팀이 그 이름으로 마크업합니다(0단계와 같은 순서).

| # | 화면 | 내용 |
|---|---|---|
| D1 | **로그인 화면** | 로고 · "PaperLab", **[Google로 계속] 하나만**(확정 Q2 — 이메일 칸 없음. 나중에 Resend로 이메일 로그인을 붙일 자리만 여백으로 고려), 오류 문구(허용되지 않은 계정 · 로그인 실패 · 네트워크), 로딩 상태. 사이드바 없는 전체 화면 |
| D2 | **허용되지 않은 계정** | "이 계정은 PaperLab을 쓸 수 없어요. 관리자에게 허용을 요청해 주세요." + [다른 계정으로 로그인]. **개정(Q16)**: 허용 목록이 on일 때만 나타남(선택 기능 — 화면은 유지). 운영(off)에서는 Google 테스트 사용자 밖 계정이 **Google 쪽 차단 화면**에서 멈춤(우리 화면 아님). 로그인 화면 아래 작은 안내 "로그인이 막히면 관리자에게 사용 등록을 요청해 주세요"(디자인팀 — 가정) |
| D3 | **계정 메뉴** | 상단(테마 버튼 옆): 프로필 이니셜/사진, 펼치면 이메일 · [설정] · [로그아웃] |
| D4 | **로그인 만료** | 토스트 "로그인이 만료됐어요. 다시 로그인해 주세요." → 로그인 화면 |
| D5 | **서비스 멈춤(503 · 네트워크 오류)** | 13.4절 문구, [다시 시도]. **개정**: 요청이 네트워크 오류(서버 응답 없음)로 실패하면 "서버에 연결할 수 없어요. 서버 PC가 꺼져 있거나 인터넷이 끊겼을 수 있어요. 관리자에게 알려 주세요." (화면이 이미 열려 있을 때만 — 처음 접속은 브라우저 오류 화면) |
| D6 | **서버 연결 중** | **개정**: 첫 요청 3초 이상이면 "서버에 연결하는 중…"(콜드 스타트 문구 "서버를 깨우는 중…"은 서버가 늘 켜져 있어 맞지 않음) |
| D7 | **설정 창** | "데이터"(데이터 폴더 경로) 구역 **삭제** → "계정" 구역(이메일 · 로그아웃). 가져오기 없음(확정 Q1). AI 엔진의 "Claude CLI" 선택지는 **비활성 + "PC 연결(2단계) 뒤에 쓸 수 있어요"**. API 키 안내 "키는 계정별로 암호화해 클라우드에 저장돼요" · "PC를 꺼도 AI를 쓰려면 API 키가 필요해요"(PLAN 5장) |
| D8 | **폴더 트리(신규)** | 사이드바에 "폴더" 구역(컬렉션 구역과 **구별되는 아이콘 · 설명**: 폴더 = 논문 파일의 실제 위치, 한 곳 / 컬렉션 = 분류, 여러 곳). 새 폴더 · 이름 바꾸기 · 옮기기 · 삭제(확인 창: "안의 논문 N편과 하위 폴더는 상위 폴더로 옮겨져요"), 끌어다 놓기로 논문 옮기기 |
| D9 | **논문을 폴더로 옮기기** | 논문 메뉴 · 일괄 작업 막대에 "폴더로 이동…"(폴더 고르기 대화상자). 상세 패널에 현재 폴더 표시 |
| D10 | **업로드 진행률** | 파일별 진행 막대(올리는 중 → 처리 중 → 완료/오류) — 7.2절. 100MB 초과 안내 |
| D11 | **요약 진행** | 9.3절 ②: 진행 막대 + "이 탭을 닫으면 요약이 멈춰요" |
| D12 | **문구 변경** | "이 컴퓨터" · "데이터 폴더" · "백업은 폴더째 복사" 같은 로컬 표현 제거(README · FEATURES는 기획팀) |
| D14 | **저장 공간 사용량** | 7.6절: 사이드바 아래 작은 막대(80% 넘으면 경고색), 설정 "계정" 구역에 "전체 8.2GB / 10GB · 내 PDF 1.2GB", 95% 넘으면 업로드 창에 막힘 안내 |
| D13 | **바로가기 아이콘** | `deploy/paperlab.ico`(16 · 32 · 48 · 256px, 지금 화면 아이콘과 같은 모양) — 11.1절 |

## 15. API 계약 변경 요약

바뀌지 않는 엔드포인트는 **요청 · 응답 모양이 지금과 같아야** 합니다(id는 정수 그대로). 모든 `/api/*`는 공개 예외를 빼고 Bearer 토큰 필요.

| 엔드포인트 | 변경 |
|---|---|
| `GET /api/public-config` | **신규**, 공개: `{supabase_url, supabase_anon_key}` |
| `GET /api/me` | **신규**: `{user_id, email, display_name}` (첫 호출 때 `profiles` 행 생성) |
| `GET /api/health` | 공개 유지, `?deep=1` 추가 |
| `GET /api/meta` | `data_dir` **삭제** |
| `GET/PUT /api/settings` | 모양 유지, `ai_engine: "cli"` → 400 |
| `GET /api/papers` | 쿼리 `folder`(폴더 id) · `filter=no_folder` 추가. 항목에 `folder_id` 추가, `pdf_path` 삭제 |
| `PATCH /api/papers/{id}` | `folder_id` 받음(내 폴더인지 확인, 아니면 400) |
| `POST /api/papers/bulk` | `action: "move_folder"`, `value`: 폴더 id 또는 `null`(최상위) |
| `GET/POST/PATCH/DELETE /api/folders[/{id}]` | **신규**: 목록 `[{id, name, parent_id, count}]`(컬렉션과 같은 모양), 만들기 `{name, parent_id}`, 바꾸기 `{name?, parent_id?}`(순환 → 400), 지우기(5.5절 규칙, 응답 `{ok, moved_papers, moved_folders}`) |
| `POST /api/upload` | **삭제** → `POST /api/uploads`, `POST /api/uploads/{upload_id}/complete` |
| `POST /api/papers/{id}/pdf` | **삭제** → `POST /api/papers/{id}/pdf/upload`, `…/pdf/complete` |
| `GET /api/papers/{id}/pdf` | **삭제** → `GET /api/papers/{id}/pdf-url` |
| `GET /api/storage/usage` | **신규**(7.6절) |
| `POST /api/papers/{id}/summary` | ② 채택 시 SSE 스트림(9.3절) |
| `GET /api/jobs/{id}` | ② 채택 시 **삭제** |
| `POST /api/compose/scan` | 30MB 제한, 토큰을 사용자별로 |
| 오류 응답 | 401 `auth_required`, 403 `not_allowed`, 503 `db_unavailable` 추가(본문 `{detail, code}`) |

---

## 16. 수용 기준

품질팀이 실행해서 확인합니다. 특별한 말이 없으면 **자동 검사**(pytest, 10장 **테스트용 Supabase 프로젝트** + 가짜 저장소 + 테스트 사용자 JWT)입니다. **[실환경]** 표시는 운영 Supabase · **서버 PC(Funnel 공개 주소)** 에서 확인하는 항목(설치 후, 절차를 결과 보고에 기록 — 개정 전: Cloud Run), **[수동]**은 화면을 사람이 확인.

**공통 준비**: 사용자 A(`a@test.example`, 허용), B(`b@test.example`, 허용), C(`c@test.example`, 허용 안 됨). A · B 각자 논문 2편(PDF 포함), 컬렉션 · 태그 · 하이라이트 · 노트 · 요약 · 대화 · 원고 · 내 양식 · 내 스타일 하나씩.

### A. 인증 · 요청 규칙
- **AC-01** 토큰 없이 `GET /api/papers` → 401 `code: auth_required`. `GET /api/health`, `GET /api/public-config`, `GET /`, `GET /static/js/app.js`는 토큰 없이 200.
- **AC-02** 만료된 토큰(`exp` 과거), 서명이 틀린 토큰, `aud`가 다른 토큰, `iss`가 다른 토큰, `alg: none` 토큰, `role: anon` 토큰 → 각각 401.
- **AC-03** **[실환경] (개정 — Q16, off 기준)** 운영 서버 PC의 `PAPERLAB_ALLOWLIST=off`. Google OAuth 동의 화면이 **"테스트" 게시 상태**이고 테스트 사용자 목록에 A · B만 있음(Google Cloud 콘솔 화면으로 확인 — 이메일은 보고서에 쓰지 않음). 테스트 사용자 밖 구글 계정(C)으로 [Google로 계속] → **Google 화면에서 막히고** PaperLab으로 돌아오지 않으며 Supabase 대시보드 Users에 C가 **생기지 않음**. A는 정상 로그인. Auth API로 이메일 가입(`POST {SUPABASE_URL}/auth/v1/signup`)과 익명 로그인을 직접 시도해도 실패. 로그인 화면에 이메일 입력 칸이 없음.
- **AC-04** **(개정)** 자동: (off) `PAPERLAB_ALLOWLIST=off` + `ALLOWED_EMAILS` 없음 → 서버가 뜨고, 테스트 프로젝트의 어떤 유효한 사용자 토큰으로도 `GET /api/papers` 200(403 아님). (선택 기능 on) `on`이고 목록 밖 이메일(C)의 **유효한** 토큰 → 403 `code: not_allowed`, `ALLOWED_EMAILS`에서 B를 빼고 서버를 다시 시작하면 B의 다음 요청이 403.
- **AC-05** **(개정 — 선택 기능 on)** Auth Hook 함수 단위 검사(테스트 프로젝트): `paperlab.before_user_created`에 허용된 이메일 이벤트 → 오류 없음, 목록 밖 → `error.http_code = 403`. `authenticated` 역할로 이 함수 실행 · `allowed_emails` 읽기 → 권한 오류. **[실환경]** 운영 프로젝트에는 훅이 **연결돼 있지 않음**(대시보드 Hooks 화면, off 기본).
- **AC-06** **(선택 기능 on — 그대로)** `sync-allowlist`를 `ALLOWED_EMAILS="A@Test.example, b@test.example"`로 실행하면 `allowed_emails`가 정확히 `a@test.example`, `b@test.example`(소문자 · 공백 제거), 다시 실행해도 같음. (개정 — 구현 반영) `ALLOWED_EMAILS`가 비었거나 없을 때 `sync-allowlist`는 종료 코드 0으로 끝나고 `allowed_emails` 표를 **바꾸지 않음**(빈 변수로 표를 비우지 않음 — 운영 off에서 설치 · 업데이트 스크립트가 불러도 안전).
- **AC-07** 유효 토큰이어도 `X-PaperLab` 헤더 없는 `POST /api/papers` · `PATCH /api/manuscripts/{id}` · `DELETE /api/doc-formats/{id}` → 403. `GET`은 헤더 없이도 됨.
- **AC-08** `Origin: https://evil.example` 또는 `Origin: null`인 요청 → 403. **개정(S2)**: `Origin`이 설정 `PAPERLAB_PUBLIC_URL`의 출처와 같으면 통과, `Host`를 `evil.example`로 바꾸고 `Origin: https://evil.example`을 보내도 403(Host에서 출처를 만들지 않음). Host가 공개 호스트 · `127.0.0.1:8080` · `localhost:8080`이 아니면 400. 응답에 `Access-Control-Allow-Origin` 헤더가 없음. (개발 모드는 지금처럼 `http://{Host}` 허용)
- **AC-09** `/api/*` 응답에 `Cache-Control: no-store`, 모든 응답에 `X-Content-Type-Options: nosniff`.
- **AC-10** JWKS: 알 수 없는 `kid` 토큰이 오면 JWKS를 한 번 다시 받아 검증(가짜 JWKS 서버로 키 교체 시나리오). `SUPABASE_JWT_SECRET`이 있으면 HS256 토큰이 통과하고 ES256 토큰 경로는 쓰지 않음.

### B. 사용자 분리 (RLS)
- **AC-11** API: B의 토큰으로 A의 논문 id에 `GET/PATCH/DELETE /api/papers/{id}`, `GET /api/papers/{id}/annotations`, `PUT …/note`, `GET …/summary`, `GET …/chat`, `GET …/pdf-url`, `GET /api/manuscripts/{A원고}`, `GET /api/doc-formats/user-{A양식}`, `PATCH /api/annotations/{A하이라이트}`, `DELETE /api/collections/{A컬렉션}`, `PATCH /api/tags/{A태그}`, `GET /api/styles/{A스타일}` → 각각 **404**(존재 여부도 알리지 않음), A의 데이터는 그대로.
- **AC-12** **DB 직접 + [실환경]**: Session pooler(테스트 프로젝트는 자동, 운영은 [실환경])로 접속해 트랜잭션 안에서 `SET LOCAL ROLE authenticated; select set_config('request.jwt.claims', '{"sub":"<B>","role":"authenticated"}', true);` 후 `paperlab`의 모든 개인 표 `select count(*)` → B의 행만. 같은 트랜잭션에서 A의 `user_id`로 `insert` → RLS 위반 오류. **트랜잭션이 끝난 뒤** 같은 연결에서 `select current_setting('request.jwt.claims', true)`가 비어 있고 `current_user`가 원래 역할(설정이 새지 않음). 테스트 프로젝트에서 자동으로 같은 검사.
- **AC-12a** 앱 전용 역할(팀장 결정 T3): 테스트 프로젝트와 **[실환경]** 모두에서 `paperlab_app`으로 접속해 `SET ROLE` 없이 `select * from paperlab.papers` → **권한 오류**(행이 나오지 않음). `rolbypassrls = false`, `rolinherit = false`. `SET LOCAL ROLE authenticated` 후에는 AC-12와 같이 본인 행만. **[실환경]** Supabase Session pooler가 `paperlab_app` 접속을 받음(못 받으면 팀장에게 보고). **개정**: 서버 PC `cloud.env`의 `SUPABASE_APP_DB_URL` 사용자 이름이 `paperlab_app.`으로 시작함(점검 스크립트가 사용자 이름 앞부분만 출력 — 비밀번호 · 호스트는 보고서에 쓰지 않음). 서버 코드가 `SUPABASE_DB_URL`을 읽지 않음(코드 검사).
- **AC-13** 코드 검사(자동): `paperlab/` 안에서 (1) `psycopg.connect`/풀 `connection()` 호출이 연결 도우미 모듈 밖에 없음, (2) `LOCAL` 없는 `SET ` 문 · `set_config(…, false)`가 없음, (3) `system_tx(` 호출이 모두 `reason` 인자를 가짐.
- **AC-14** 목록 · 통계: B로 `GET /api/papers`, `/api/stats`, `/api/collections`, `/api/tags`, `/api/folders`, `/api/manuscripts`, `/api/doc-formats`(내 양식 부분), `/api/styles`(내 스타일 부분)에 A의 것이 하나도 없음. `stats.total`이 B의 논문 수.
- **AC-15** 검색: A만 가진 낱말(제목 · 본문 · 메모 각각)로 B가 `GET /api/papers?q=…` → 0건.
- **AC-16** 중복 · 인용키 사용자 분리: A와 **같은 DOI** 논문을 B가 추가 → 409가 아니라 정상 추가. A와 같은 제목 · 저자 · 연도 논문을 B가 추가하면 B의 인용키는 접미어 없이 `vaswani2017attention`(A의 키와 겹쳐도 됨). `POST /api/citekeys`로 B가 A의 키를 찾으면 `null`(B에게 없을 때).
- **AC-17** 교차 연결 금지: B가 `POST /api/papers/bulk {"ids":[B논문], "action":"add_collection", "value": A컬렉션}` → 오류(400 또는 404), DB에 행 없음. B가 `PATCH /api/papers/{B논문} {"folder_id": A폴더}` → 400.
- **AC-18** 남의 업로드 완료 금지: A가 받은 `upload_id`로 B가 `POST /api/uploads/{upload_id}/complete` → 404(B의 `incoming/` 경로에 없음).
- **AC-19** compose 토큰: A의 `compose/scan` 토큰으로 B가 `compose/apply` → 404.
- **AC-20** 카탈로그 검사: `paperlab` 스키마의 모든 표가 RLS 켜짐 + `force`, 시스템 표(`allowed_emails`, `schema_migrations`)와 **공용 캐시 표(`external_works`, `citation_edges` — 1B)** 를 뺀 모든 표에 `authenticated` 대상 정책이 있고 `user_id` 열이 있음. `anon` 역할은 `paperlab` 스키마 사용 권한이 없음. **(개정 2026-10-07 — 1B)** 공용 캐시 표는 대신 [1B 명세](citation-graph.md) **AC-G20**으로 검사: `authenticated` 정책이 `select` 하나뿐, `authenticated` 표 권한이 `SELECT`뿐, 열 이름에 낱말 `user` · `ip` · `session` · `email`이 없고 `_by`로 끝나는 이름 없음(`cited_by_count`는 허용), 시각 열은 모두 `date`.
- **AC-21** **[실환경]** `paperlab` 스키마가 Data API에 노출되지 않음: 화면의 anon 키 + A의 토큰으로 `GET {SUPABASE_URL}/rest/v1/papers` (`Accept-Profile: paperlab`) → 오류(노출 안 된 스키마). (T4를 `public`으로 결정하면 대신 "B 토큰으로 A 행 0건")
- **AC-22** 계정 삭제 연쇄(테스트 프로젝트, Auth admin API로 삭제): `auth.users`에서 A를 지우면 A의 모든 개인 행이 사라지고 B의 행은 그대로.

### C. 기능 동등성
- **AC-23** 기존 테스트 이식: `tests/test_server.py` · `tests/test_db_pdf.py`의 모든 시나리오(업로드 · 중복 · 검색 결과로 추가 · 인용 내보내기/가져오기 · 컬렉션 · 태그 · 일괄 작업 · 하이라이트 · 노트 · 요약/대화 · 스타일 · 리뷰 회귀)가 테스트 프로젝트 + 가짜 저장소 + 테스트 사용자 토큰으로 통과. `test_citations` · `test_writing` · `test_doc_formats` · `test_sources` · `test_ai`도 통과(**제외 없음** — `test_cli_engine_with_fake_claude`는 Windows에서도 가짜 CLI만 쓰고 실제 CLI 호출을 막는 단언 포함, 2026-10-07 해결 · PLAN 9장).
- **AC-24** 0단계 양식 수용 기준 AC-06~AC-16(양식 API · 원고 설정)이 Postgres에서 통과. AC-15(예전 `library.db` 열 추가)는 SQLite 전용이라 **해당 없음**으로 기록. AC-01~03 골든 파일(내보내기 결과)이 그대로 같음.
- **AC-25** 정렬: 같은 논문 5편(제목 대소문자 섞임, 저자 없는 논문 1편, 연도 없는 논문 1편, 한 번도 안 연 논문 포함)에 대해 `sort` = `added · updated · opened · year · title · cited · first_author` 결과 id 순서가 **변경 전 SQLite 코드의 결과와 같음**(개발팀이 SQLite 코드로 기대값을 먼저 뽑아 테스트에 고정).
- **AC-26** 태그: `["NLP","transformer","nlp"]` → 2개(`NLP`, `transformer`). 이름을 다른 태그와 대소문자만 다르게 바꾸면 400 "같은 이름의 태그가 이미 있어요". 연결 없고 색 없는 태그는 자동 삭제.
- **AC-27** 중복 찾기: `https://doi.org/10.48550/ARXIV.1706.03762`가 소문자 DOI 논문과 일치, `"attention is all you need!"`가 제목 일치, 11자 이하 정규화 제목은 제목으로 일치시키지 않음.
- **AC-28** 원고: 만들기 · 수정 · `updated_at` 변화 · 삭제, 다른 탭(같은 사용자 다른 클라이언트)에서 `GET`하면 마지막 저장 내용.
- **AC-29** 대화: 질문 → 스트림 `done` 뒤 `GET …/chat`에 user · assistant 2개, `DELETE …/chat` 후 0개. `chat_sessions`에 그 논문 세션 1개.
- **AC-30** 워드 · 한글 · 마크다운 내보내기, compose(스캔 → 적용)가 지금과 같은 결과(기존 테스트). compose 30MB 초과 → 400 "파일이 너무 커요 (30MB 초과)".
- **AC-31** 설정: `PUT /api/settings {"anthropic_api_key":"sk-test-…"}` → 응답 `anthropic_api_key_set: true`, 평문 없음. 빈 문자열 → 그대로, `null` → `false`. `ai_engine: "cli"` → 400. 사용자 A의 설정 변경이 B의 `GET /api/settings`에 영향 없음.

### D. 검색
- **AC-32** `test_library_crud_and_search`의 검색 단언 전부: `self-attention`(본문, 스니펫에 `[[self-attention]]`), `vaswani transduction`(저자+초록 AND), 없는 낱말 0건, `신경망`, **`추천`(한국어 2글자)**, `콜드 스타트`(노트), `핵심 수식`(하이라이트 메모), 논문 삭제 뒤 `scaled` 0건.
- **AC-33** 1글자 검색(`망`, `x`)과 영문 부분 낱말(`transduc`), 대소문자(`ATTENTION`)의 결과가 변경 전 SQLite 코드 결과와 같음.
- **AC-34** 검색어에 `OR`, `-attention`, `(`, `"`, `%`, `_`, `\`가 들어가도 500이 아니라 낱말 그대로 찾음(문법 해석 안 함).
- **AC-35** 성능(자동, 테스트 프로젝트): 논문 500편 · 쪽 1만 개(쪽당 2,000자)에서 `q=추천` · `q=self-attention` 검색이 각각 1초 안(가정 기준값, 네트워크 왕복 포함 — 결과를 보고서에 기록). 데이터는 끝나면 사용자 삭제로 정리.

### E. PDF · R2
- **AC-36** 업로드(T1, 가짜 저장소): `POST /api/uploads` → `upload_id` · `backend: "r2"` · `upload.method = "PUT"`, 가짜 저장소에 PUT → `complete` → 응답 `id` · `title` · `matched_by`, `users/{A}/papers/{id}.pdf`가 생기고 `incoming/{A}/{upload_id}.pdf`는 없어짐, `page_texts`가 쪽 수만큼.
- **AC-37** 같은 PDF를 다시 올리면 `duplicate: true`, PDF 없는 기존 논문과 일치하면 "이미 있는 논문에 PDF를 붙였어요". `%PDF`로 시작하지 않는 파일 → `error: "PDF 파일이 아니에요"`, 임시 파일 삭제.
- **AC-38** **[실환경]** `GET /api/papers/{id}/pdf-url`의 주소로 바로 받으면 200 · `application/pdf`, **유효 시간(10분)이 지난 뒤** 같은 주소 → 403(R2 만료). 서명 주소의 키 부분을 다른 사용자 경로로 손으로 바꾸면 서명이 맞지 않아 403.
- **AC-39** **서버 측 키 강제**(자동, 가짜 저장소의 요청 기록 검사): 전체 테스트 동안 사용자 요청이 만든 모든 저장소 요청(서명 GET · 서명 PUT · 받기 · 복사 · 삭제)의 키가 `users/{그 요청 JWT의 uid}/` 또는 `incoming/{그 uid}/`로 시작. 요청 본문 · 쿼리에 다른 `user_id` · 키 · 경로(`../`, `backups/…`, `users/{B}/…`)를 넣어도 키에 반영되지 않음. DB `pdf_key`를 일부러 B의 경로로 바꿔 두면 A의 `pdf-url` · 삭제 · AI 읽기가 그 키를 쓰지 않고 404.
- **AC-39a** 단위 검사: `paper_key` · `incoming_key`가 uid · id 형식이 틀리면 예외, 접두어 검사 함수가 `users/{uid}/…` · `incoming/{uid}/…` 말고는(다른 uid, `backups/`, 빈 문자열, `users/{uid}/../x`) 모두 거부. 코드 검사: `paperlab/` 안에서 boto3 호출이 `storage.py` 밖에 없음.
- **AC-40** `size` 100MB 초과 신고 → 그 파일만 `error: "파일이 너무 커요 (100MB 초과)"`. 신고는 작게 하고 실제로 100MB 넘는 파일을 올리면 `complete`의 크기 확인에서 오류 + 임시 파일 삭제.
- **AC-41** 논문 삭제(단건 · 일괄) 후 저장소에 그 PDF 없음. 저장소 삭제가 실패하도록 만든 경우에도 API는 200, DB 행은 삭제, 로그에 경고.
- **AC-42** `fetch-pdf`(URL에서 받기)가 최종 키에 바로 저장.
- **AC-43** **[실환경]** 브라우저(서버 주소 `https://kimjuhyeon.tailac17f6.ts.net`)에서 PDF 열기 · 업로드가 CORS 오류 없이 됨. 다른 출처(`http://example.com` 페이지의 `fetch`)에서 서명 주소 GET은 CORS로 막힘.
- **AC-44** **[실환경]** 버킷 공개 주소(r2.dev)가 꺼져 있음, `incoming/` 수명 주기 규칙(1일)과 CORS 규칙이 있음 — Cloudflare 대시보드 화면으로 확인.
- **AC-44a** 사용량(자동): A가 PDF 2편(합계 X바이트)을 올리면 `GET /api/storage/usage`의 `backend: "r2"`, `limit_bytes` 기본 10GB, `mine_bytes = X`, `used_bytes` ≥ X(+ 가짜 `backups/` 객체 크기 포함), B의 `mine_bytes`는 B 것만. `limit_bytes`를 시험용으로 작게 주입해 80% 넘기면 `level: "warn"`, 95% 넘기면 `level: "full"`이고 `POST /api/uploads`가 400 "저장 공간이 거의 찼어요".
- **AC-44b** `admin orphans`(가짜 저장소 + 테스트 프로젝트): DB 행 없는 `users/*/papers/*.pdf` 1개를 찾아 보고하고 `--delete` 때 지움. 정상 PDF · `backups/`는 건드리지 않음.

### F. 비밀 · 설정
- **AC-45a** 저장소 계약 테스트: 같은 테스트 묶음(올리기 · 서명 · 받기 · 이동 · 삭제 · 없는 키 404 · 남의 접두어 거부)이 가짜 구현에서 자동으로 통과, **[실환경]** R2 구현에서도 통과(임의 uuid 사용자 경로에서 실행 후 삭제). `STORAGE_BACKEND`가 없으면 `r2`로 동작, `r2`인데 R2 변수 4개 중 하나라도 비면 서버가 시작하지 않고 빠진 변수 **이름**만 로그, 모르는 값이면 시작하지 않음.
- **AC-45** `user_secrets`의 `ciphertext`에 평문 키 문자열이 들어 있지 않음. A의 행 암호문을 B의 행으로 복사하면 B의 설정 조회는 `anthropic_api_key_set: false`(복호화 실패 처리) + 500이 아님.
- **AC-46** `APP_ENCRYPTION_KEY`가 없거나 32바이트가 아니면 서버가 시작하지 않고, 로그에 변수 **이름**만 나옴(값 없음).
- **AC-47** `rotate-key` 후 모든 행의 `key_id`가 새 키 지문이고, 복호화 결과가 회전 전과 같음.
- **AC-48** 서버 환경에 `ANTHROPIC_API_KEY`가 있어도, 키를 등록하지 않은 사용자의 `GET /api/ai/status`는 `ready: false`, 요약 요청은 400.
- **AC-49** 로그 검사: 전체 테스트 실행 동안의 로그에 시험용 API 키 문자열 · JWT 문자열 · 서명 주소의 `X-Amz-Signature` 값이 한 번도 나오지 않음.

### G. 폴더
- **AC-50** 폴더 만들기 · 하위 폴더 · 이름 바꾸기, 같은 부모 아래 같은 이름(대소문자만 다른 것 포함) → 400, 금지 문자 · 제어 문자(줄바꿈 · 탭) · 마침표나 공백으로 끝나는 이름 · Windows 예약 이름(`CON`, `nul.txt`, `COM1` 등) → 400(F6), 자기 하위로 옮기기 → 400.
- **AC-51** 논문을 폴더로 옮기면 `GET /api/papers?folder={id}`에 나오고 이전 폴더에서 빠짐(논문당 한 곳). 컬렉션 소속은 그대로. 저장소 키는 바뀌지 않음.
- **AC-52** 논문 2편 · 하위 폴더 1개가 든 폴더를 지우면 응답 `moved_papers: 2, moved_folders: 1`, 논문 · PDF 그대로, 부모 폴더(또는 최상위)로 이동.

### H. AI · 백그라운드
- **AC-53** 가짜 AI로 `POST /api/papers/{id}/summary` → `progress` 이벤트 1개 이상 → `done`에 요약, 이후 `GET …/summary`에 저장됨. 가짜 AI가 오류를 내면 `error` 이벤트, 저장 없음. 스트림 중간에 클라이언트가 끊으면 저장 없음.
- **AC-54** **[실환경] (개정)** 서버 PC 서버에 공개 주소로 접속해 실제 API 키로 10쪽 이상 논문 요약이 끝까지 완료(SSE가 Funnel을 거쳐 끝까지 옴).

### I. 배포 · 운영 (개정 — 서버 PC)
- **AC-55** **(개정)** 자동: 저장소에 `Dockerfile` · `.dockerignore` · `deploy/deploy.ps1` · `paperlab/cloud.py`가 **없고**, `git grep -nE "gcloud|Secret Manager|secretmanager|Cloud Scheduler|Artifact Registry|asia-northeast3"`가 `docs/` · `PLAN.md` 밖(코드 · 스크립트 · 테스트)에서 0건. `.gitignore`에 `*.env`가 있음. [실환경]: 서버 PC에서 `install.ps1`이 처음부터 끝까지 성공하고(저장소만 clone된 `D:\PaperLab` 기준), 두 번째 실행도 오류 없이 끝남(다시 실행해도 안전).
- **AC-56** DB 연결이 안 되는 상태(시험용으로 연결 주소를 닿지 않는 호스트로 주입)에서 `GET /api/health` 200, `GET /api/health?deep=1` → `db: "error"`, `GET /api/papers` → 503 `db_unavailable`(500 아님). 올바른 주소로 되돌리면(풀 재연결) 서버 재시작 없이 회복.
- **AC-57** 마이그레이션: 빈 DB에 `python -m paperlab.migrate` 두 번 실행 → 두 번째는 아무것도 안 함. 모든 파일이 `supabase/migrations/` 이름 규칙을 따름.
- **AC-58** **[실환경] (개정)** 서버 PC 점검: (1) 서버가 `127.0.0.1:8080`에만 열려 있음(`Get-NetTCPConnection -LocalPort 8080 -State Listen`의 주소가 `127.0.0.1`뿐 — `0.0.0.0` · 사설 IP 없음), 같은 망의 다른 PC에서 `http://<서버 PC 사설 IP>:8080` 접속 실패. (2) `C:\Users\USER\.paperlab\cloud.env`의 `icacls` 결과에 `USER` · `SYSTEM` · `Administrators` 말고 없음(상속 끊김). (3) `cloud.env`에 `SUPABASE_SERVICE_ROLE_KEY` · `GCP_PROJECT_ID` 줄이 없음(점검 스크립트가 변수 **이름**만 출력). (4) 작업 스케줄러에 `PaperLab Server`(시스템 시작 시 · 로그온 여부와 관계없이 · 실패 시 다시 시작 · 시간 제한 없음), `PaperLab Backup`(매일 04:00 · 놓치면 곧 실행), `PaperLab Watchdog`(5분) 세 작업이 있고 실행 계정이 `USER`. (5) 저장소 · 가상환경 · 로그 · 임시 폴더가 모두 `D:\PaperLab` 아래이고, `icacls D:\PaperLab`에 상속 표시가 없으며 `USER` · `SYSTEM` · `Administrators`만 있음(`Authenticated Users` · `Users` 없음).
- **AC-59** **[실환경] (개정)** 서버 PC와 **다른 망**(휴대폰 데이터 등)에서 `https://kimjuhyeon.tailac17f6.ts.net/api/health` → 200 `{"ok": true}`, `?deep=1` → `db: ok, storage: ok`. `tailscale funnel status`가 443 → `http://127.0.0.1:8080` 하나뿐(8443 · 10000 없음). `http://`(평문)로는 접속되지 않음.
- **AC-60** **(개정 — 해당 없음)** 콜드 스타트 측정은 서버가 늘 켜져 있어 하지 않음. 대신 **[실환경]** 하루 이상 쓰지 않은 뒤 첫 화면이 열리기까지 시간을 3회 기록(참고값).
- **AC-61** **[실환경] (개정)** PLAN 1단계 완료 기준: A · B 두 계정으로 각자 로그인해 서로의 서재가 안 보임 · 다른 기기(또는 다른 브라우저)에서 같은 원고가 이어서 열림 · **관리자 PC(사용자 각자의 PC)와 그 개발 서버를 끈 상태에서, 서버 PC만 켜져 있으면** 다른 기기에서 서재 · 읽기 · 하이라이트 · 원고 · 내보내기가 됨 · 한국어 2글자 검색이 됨.
- **AC-62** 품질팀 실행 시 `SUPABASE_TEST_*` 4개가 설정돼 DB · 저장소 테스트 **건너뜀 0개**. 실행 뒤 테스트 프로젝트에 이번 실행의 테스트 사용자 · `allowed_emails` 행이 **남아 있지 않음**(정리 확인).
- **AC-69** **[실환경] (개정)** `deploy/make-shortcut.ps1`을 인자 없이 실행(관리자 PC — 주소는 `server.json`에서 읽음, `-Url`은 선택) → 바탕화면에 `PaperLab.lnk`가 생기고, 더블클릭하면 주소창 없는 앱 창으로 PaperLab이 열리며, 그 창 안에서 구글 로그인이 끝나 서재가 보임. **주소 규칙(S10 — 팀장 결정)**: 저장소의 코드 · 스크립트 · 설정 · 테스트(`paperlab/` · `deploy/` · `tests/` · `supabase/`)에서 공개 주소는 **`deploy/server-pc/server.json`과 `deploy/r2-cors.json` 두 곳**(+ 안내서 `deploy/server-pc/README.md`)에만 있고, 자동 테스트(`tests/test_server_pc_scripts.py::test_public_url_in_one_place`)가 ① 위 세 파일 밖에 주소가 없음 ② `r2-cors.json`의 `AllowedOrigins`가 `server.json`의 `public_url` **하나와 정확히 같음** ③ `make-shortcut.ps1`이 `server.json`을 읽고 `-Url`이 필수 인자가 아님을 확인. 그 밖에 주소가 있어도 되는 곳은 `docs/` · `PLAN.md`(문서). 서버 PC `cloud.env`의 `PAPERLAB_PUBLIC_URL`은 `server.json`과 같은 값이어야 함([실환경] — 설치 때 사용자 확인). `git grep -nE "\.a\.run\.app"` 0건. Supabase ref · 키 · DB 주소는 어디에도 없음(`git grep -nE "supabase\.co|postgres(ql)?://[^<\s]*@|sk-ant-"`이 테스트의 가짜 값 · 문서 자리표시 말고 0건).
- **AC-70** 백업(테스트 프로젝트 + 가짜 저장소): `admin backup` 실행 → `backups/db/{오늘}.dump`가 생기고, 덤프를 `pg_restore --list`로 읽으면 `paperlab` 스키마의 모든 표가 들어 있으며, 테스트 프로젝트의 별도 스키마(예: `paperlab_restore_check`)로 복원한 뒤 A · B의 논문 · 하이라이트 · 원고 수가 원본과 같음(확인 후 그 스키마 삭제). 백업 15개가 있는 상태에서 실행하면 가장 오래된 것부터 지워 **14개**만 남음. (**개정**: `pg_dump` · `pg_restore`는 서버 PC의 PostgreSQL 17 클라이언트 — `PAPERLAB_PG_DUMP` 또는 PATH. 서버 PC에서 품질팀이 실행 가능)
- **AC-71** **[실환경] (개정)** 서버 PC에서 `PaperLab Backup` 작업을 수동 실행(`Start-ScheduledTask`) → 종료 코드 0, R2 `backups/db/{오늘 KST}.dump`가 생김, 실행 뒤 `%TEMP%`와 `D:\PaperLab` 아래에 `.dump` 파일이 **남아 있지 않음**, `backup.log`에 연결 문자열 · 비밀번호 · R2 키가 없음. 자동: `pg_dump`를 못 찾으면(`PAPERLAB_PG_DUMP`가 없는 파일 경로 · PATH에 없음) 종료 코드 ≠ 0과 "pg_dump를 찾지 못했어요"이고 임시 파일이 남지 않음. 백업 명령은 **앱 역할 주소**(`SUPABASE_APP_DB_URL`)로 접속함(가짜 `pg_dump`로 받은 `PGUSER` 검사).
- **AC-73** 자동: 운영 모드 서버는 `static/js/dev-login.js`를 어떤 경로 표기로도 내보내지 않음(지금 `test_dev_login_module_hidden_in_production` 유지 — `.dockerignore` 검사 부분은 삭제).
- **AC-74** 자동: `paperlab.serve`의 설정 검사 — `SUPABASE_APP_DB_URL`이 비었거나 사용자 이름이 **`paperlab_app.<ref>`가 아니면**(앱 역할 사용자 이름은 `paperlab_app.` + 비지 않은 ref만 허용 — `postgres` · `postgres.<ref>` · `supabase_admin` · `paperlab_app.`(ref 없음) 등 그 밖 모두 거부), `PAPERLAB_PUBLIC_URL`이 비었거나 `https://`가 아니면 시작하지 않고 변수 **이름**만 출력(값 없음, 종료 코드 ≠ 0). `SUPABASE_DB_URL`만 있고 `SUPABASE_APP_DB_URL`이 없으면 관리자 주소로 대신 붙지 않고 거부. uvicorn 실행 인자가 `host="127.0.0.1"` · `forwarded_allow_ips="127.0.0.1"`(코드 검사 또는 실행 인자 가로채기).
- **AC-75** **[실환경]** Funnel 헤더 실측: 공개 주소로 들어온 요청에서 서버가 본 `Host` · `X-Forwarded-For` · `X-Forwarded-Proto`를 개발팀이 임시 진단(로그에 헤더 **이름과 Host 값만**, 끝나면 끔)으로 기록해 보고 → Host가 공개 호스트가 아니면 6.5절 Host 허용 목록을 고치고, `X-Forwarded-For`가 없으면 2단계 명세 8.2절 IP별 속도 제한 방식을 팀장에게 보고.
- **AC-76** **[실환경]** 서버 PC를 **다시 시작하고 아무도 로그인하지 않은 채** 5분 뒤 다른 망에서 공개 주소 `/api/health?deep=1` → 200 · `db: ok`. (Tailscale 무인 실행 · Funnel `--bg` · 작업 스케줄러 시작 시 실행 확인)
- **AC-77** **[실환경]** 작업 관리자로 서버의 `python.exe`를 강제 종료 → 2분 안에 다시 떠서 `/api/health` 200(작업 스케줄러 실패 재시작 또는 감시 작업). 서버가 응답하지 않는 상태를 흉내(개발팀 제공 진단 스위치 — 가정)내면 감시 작업이 15~20분 안에 재시작하고 `watchdog.log`에 기록.
- **AC-78** **[실환경]** Funnel을 거친 긴 연결 · 큰 요청: 대화 SSE가 5분 이상 끊기지 않음, 30MB에 가까운 워드 파일 compose가 성공(걸린 시간 기록 — 대역폭 참고값).
- **AC-79** **[실환경]** 업데이트: `update.ps1`로 새 커밋 반영 → `/api/health`의 `version`에 새 커밋, `update.log`에 옛 → 새 커밋. 일부러 시작에 실패하는 커밋(품질팀이 테스트 브랜치로 준비 — 가정)을 반영하면 60초 안에 옛 커밋으로 자동 되돌려지고 서버가 정상. 작업 폴더에 고친 파일이 있으면 업데이트가 시작되지 않음.
- **AC-80** **[실환경] (신규 — Q16)** 운영 Supabase Auth 설정 화면: 공급자 중 **Google만 켜짐**, Email 공급자 꺼짐, 익명 로그인(Anonymous sign-ins) 꺼짐. 공개 anon 키로 `POST /auth/v1/signup`(이메일) · 익명 로그인 요청이 모두 실패(AC-03과 함께).
- **AC-81** 자동(신규 — 스위치): `PAPERLAB_ALLOWLIST` 값별 서버 시작 — `off` → 뜸(`ALLOWED_EMAILS` 없어도), 스위치 없음 · `on` + `ALLOWED_EMAILS` **없음 또는 빈 목록** → **뜨지만 모든 `/api/*` 403 `not_allowed`(전부 허용 아님) + 시작 로그 경고, `serve --check`에 경고 줄(종료 코드 0)** — 시작 거부 아님(팀장 확정), `yes` · `false` · `0` 같은 모르는 값 → 시작 거부. 값은 앞뒤 공백을 지우고 대소문자를 가리지 않음(`OFF`도 off), 빈 값은 기본(on)으로 봄(구현 반영). `serve.py --check`가 이 스위치 값과 문제를 이름으로 출력.
- **AC-82** **[실환경] (신규 — Q16)** Google Cloud 콘솔 OAuth 동의 화면의 게시 상태가 **"테스트"**(프로덕션 아님)이고 테스트 사용자 수가 100명 이하 — 관리자 주간 점검 항목에 포함(13.5절 · 안내서).
- **AC-72** 운영 보호 장치(자동): (1) `SUPABASE_TEST_URL`을 `SUPABASE_URL`과 같은 값으로 두고 pytest 실행 → 테스트가 하나도 돌지 않고 즉시 중단(종료 코드 ≠ 0, 메시지에 "운영 프로젝트"). (2) `paperlab_test_project` 표지가 없는 DB를 `SUPABASE_TEST_DB_URL`로 주면 즉시 중단. (3) 표지가 있는 DB를 대상으로 운영용 `paperlab.migrate` · 설치 · 업데이트 스크립트의 DB 단계 · `admin backup`을 실행하면 거부. (4) 코드 검사: `tests/` 안에서 `SUPABASE_URL` · `SUPABASE_DB_URL` · `SUPABASE_APP_DB_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `SUPABASE_ANON_KEY`를 읽는 곳이 보호 장치의 비교 함수 하나뿐이고, `R2_*`를 읽는 곳은 [실환경] 계약 테스트(명시적으로 켤 때만 — 예: `PAPERLAB_R2_CONTRACT=1`) 하나뿐.

### J. 화면 (수동)
- **AC-63** 로그인 전에는 로그인 화면만 보이고 네트워크 탭에 `/api/*` 요청이 `public-config` 외에 없음. 구글 로그인 후 주소창에 `code=`가 남지 않음.
- **AC-64** 계정 메뉴에 이메일 · 로그아웃. 로그아웃 후 뒤로 가기로 서재 데이터가 보이지 않음.
- **AC-65** 설정 창에 데이터 폴더 경로가 없고 "계정" 구역이 있음. CLI 엔진 선택지는 비활성 + 안내 문구.
- **AC-66** 폴더 트리와 컬렉션 트리가 시각적으로 구별되고, 끌어다 놓기로 논문을 폴더 · 컬렉션에 넣을 수 있음.
- **AC-67** 읽기 화면에서 PDF가 열리고, 10분 넘게 열어 둔 뒤에도 쪽 넘기기 · 하이라이트가 됨(파일 전체를 받아 둠). "PDF 파일 열기"가 새 탭에서 열림(팝업 차단 없음). 하이라이트 내보내기가 `.md` 파일로 받아짐.
- **AC-68** 액세스 토큰을 강제로 만료시키면(개발자 도구에서 저장된 세션의 `expires_at` 조작) 다음 동작에서 자동 갱신되어 계속 쓰이고, refresh token까지 지우면 D4 토스트 → 로그인 화면.

---

## 17. 범위 밖

- 2~6단계 기능 전부(2장 "안 하는 것"), Supabase Realtime, 공용 캐시 표
- 계정 삭제 · 탈퇴 화면, 관리자 화면(사용자 등록은 Google Cloud 콘솔 테스트 사용자 목록으로만 — Q16, 허용 목록을 켤 때는 `cloud.env` + 명령), 전체 기기 로그아웃
- Google OAuth 앱 게시(프로덕션 전환) · Google 앱 인증 심사(Q16 — 게시 금지)
- 사용자 정의 도메인, CSP 헤더, 오류 알림(메일 · 메신저 · 외부 감시 서비스 — Q-S4), 사용량 대시보드
- 서버 이중화 · 자동 대체 서버, 서버 PC 원격 데스크톱 · 원격 관리 도구, UPS 구입 · 설정(Q-S5), 서버 PC 디스크 전체 백업(데이터는 Supabase · R2에 있으므로 서버 PC는 다시 설치하면 됨)
- 오프라인 사용, PWA, 데스크톱 앱 창(pywebview)
- PDF 객체 버전 관리 · 휴지통
- 기존 데이터 이관 도구(확정 Q1 — 새로 시작)
- 이메일 로그인(확정 Q2) — **이후 작업**: 사용자가 도메인을 준비하면 Resend 도메인 인증 → Supabase 사용자 정의 SMTP(Resend) → 이메일 공급자 켜기 → 로그인 화면 이메일 칸(D1) → SMTP 비밀 변수 이름 정하기. 별도 소명세로
- macOS · Linux 바로가기(11.1절)
- 다른 사용자 PC용 설치 프로그램 — **2단계 Electron 앱**(확정 Q13)
- 워드 · 한글 compose 파일을 R2로 옮기기(30MB 한도로 대신)
- Supabase Storage 구현(7.8절 — `supabase` 값은 자리만)
- **CI(GitHub Actions)** · 관련 수용 기준(사용자 결정 Q11 — 지금은 안 함)

## 18. 위험

| 위험 | 내용 | 대응 |
|---|---|---|
| RLS 누락 · 우회 | `postgres` · `service_role`은 `bypassrls`(공식 문서) | 서버는 전용 역할 `paperlab_app`(NOINHERIT, bypassrls 없음 — 팀장 결정 T3)으로만 접속, 연결 도우미 단일 경로, AC-12 · 12a · 13 · 20 |
| 풀러가 전용 역할을 안 받음 | Supavisor의 사용자 정의 역할 지원 **확인 필요** | 첫 실환경 연결에서 AC-12a 확인, 안 되면 팀장 보고(대안: Transaction 모드 · 직접 연결 재검토). **직접 연결로 바꾸면 사용자 이름이 `paperlab_app`(`.<ref>` 없음)이 되므로 앱 역할 이름 규칙(`is_app_role_user` · AC-74)도 함께 바꿔야 함** |
| 구글 계정 없는 사용자 | 1단계는 구글만(확정 Q2) | 이메일 로그인은 도메인 준비 후 Resend로(17장) |
| 요약 중 탭 닫기 | SSE 방식이라 요약 중단(팀장 결정 T2) | 화면 안내(D11), 2단계에서 작업 큐 |
| Funnel 대역폭 제한(개정 — 옛 32MiB 요청 한도 대신) | 수치 미공개 · 바꿀 수 없음 | PDF는 서명 주소 직접 업로드(T1), compose 30MB 유지(S8), AC-78 측정 |
| DB 500MB | `page_texts` + PGroonga 색인이 큼(본문 텍스트 논문당 수십 KB, 색인은 그 몇 배 — **확인 필요**) | 1단계 끝에 실제 크기 측정 · 보고(1편당 평균), 넘을 것 같으면 Pro(PLAN) |
| Supabase 일시정지 | 무료 플랜 1주 미사용 시 정지 | 13.4절 화면 · 안내, 불편하면 Pro(PLAN) |
| 백업 실패를 모름 | 알림이 범위 밖 | 감시 작업의 36시간 경고(13.5절) + 관리자 주 1회 `watchdog.log` 확인(가정), AC-70 · 71 |
| **서버 PC 한 대에 모두 걸림** (사용자에게 설명하고 받은 결정) | 서버 PC의 **전원(정전 · 실수로 끔) · 재부팅(Windows 업데이트) · 인터넷 끊김 · 하드웨어 고장 · 디스크 가득 참** 중 하나면 **모든 사용자가 PaperLab을 못 씀**. 사용자 각자의 PC는 상관없음. 데이터(DB · PDF · 백업)는 Supabase · R2에 있어 잃지 않음 | 절전 끔 · 무로그온 자동 시작 · Funnel `--bg` · 무인 실행(13.6 · 13.7절, AC-76), 실패 재시작 + 감시 작업(AC-77), Windows 업데이트 활성 시간, 디스크 5GB 경고, 정전 대비 BIOS 설정 · UPS는 사용자 확인(Q-S5). 고장 나면 다른 PC에 `install.ps1`로 다시 설치(데이터 이전 없음 — 주소는 13.2절 주의). 꺼짐을 알릴 외부 감시는 Q-S4 |
| **Funnel로 인터넷에 공개** | 공개 주소는 누구나 접속 가능 · 인증서 투명성 로그 등으로 주소가 알려질 수 있음(사실상 공개 주소로 봄). 서버 PC 쪽 Funnel 설정 실수로 다른 포트 · 다른 서비스가 공개될 수 있음 | 앱 자체 로그인(Google 테스트 사용자만 — Q16) · RLS(6장)가 1차 방어, 443 → `127.0.0.1:8080` 하나만 공개(AC-59), 서버 `127.0.0.1` 바인딩(AC-58), Host · Origin 검사(6.5절), funnel 속성을 서버 PC에만(S6), 서버 PC에서 다른 서비스를 Funnel로 열지 않음(안내서). 공격이 의심되면 `funnel.ps1 off`로 즉시 닫음 |
| **서버 PC 보안 관리** | 서버 PC에 `cloud.env`(DB 관리자 주소 · 앱 역할 주소 · R2 키 · 암호화 키)가 있어, 그 PC가 털리거나 도난되면 **모든 사용자 데이터에 접근 가능**. Windows 11 Home이라 BitLocker 관리 기능 없음. 2단계에 같은 PC에서 CLI 워커(외부 논문 본문을 CLI에 넣음)도 돌릴 예정 | 파일 권한(13.1-3), 강한 계정 비밀번호 · 화면 잠금 · Defender · 자동 업데이트(13.7절), 유출 · 도난 의심 시 키 재발급 절차(13.7절). **수용한 위험(승인자 L4 · 사용자 결정 Q17 · Q18)**: ① 서버 · 백업 · (2단계) 워커가 **같은 Windows 계정**이라 그 계정의 `cloud.env`에 **관리자 DB 주소**(`SUPABASE_DB_URL`)까지 함께 있음 — 서버 PC가 **사용자 전용**(다른 계정 없음)이므로 수용(팀장 결정 S5 같은 계정, 2단계 서버 PC 워커는 codex 기본 끔 K20). ② **장치 암호화 안 함** — 고정 PC라 도난 위험이 낮다고 보고 수용 |
| **가입 관문이 Google OAuth "테스트" 상태에 달림 (Q16)** | 우리 허용 목록이 꺼져 있어(`PAPERLAB_ALLOWLIST=off`) **OAuth 앱을 "게시"(프로덕션 전환)하면 구글 계정이 있는 누구나 가입 · 로그인**해 서버를 씀(남의 데이터는 RLS로 못 보지만 저장 공간 · 서버 자원을 씀). 이메일 공급자 · 익명 로그인을 실수로 켜도 누구나 가입. 테스트 사용자는 최대 100명. Google 공식상 테스트 상태 승인은 동의 후 **7일**에 만료(구글 동의를 다시 거칠 수 있음 — PaperLab 세션 영향 **확인 필요**). 사람을 빼도 이미 받은 세션은 만료 전까지 남을 수 있음 | **게시 금지**(안내서 · 관리자 주간 점검 AC-82), Google Cloud 콘솔 권한은 관리자만, Supabase 공급자 Google만(AC-80), 사람을 뺄 때 Supabase 사용자도 삭제(13.8절), 필요하면 허용 목록을 다시 켬(`on` + Auth Hook — 선택 기능, 6.3절) |
| 같은 PC의 다른 프로그램 | `127.0.0.1:8080`에 서버 PC 안의 다른 프로그램은 바로 접속 · `X-Forwarded-For`를 꾸밀 수 있음 | 서버 PC에는 신뢰하는 프로그램만(가정), 인증은 그대로 필요(토큰 없으면 401) |
| 서버 PC 주소 변경 | Tailscale 기기 · tailnet 이름을 바꾸면 주소가 바뀌어 Supabase · R2 · 설치 파일을 모두 고쳐야 함 | 이름을 바꾸지 않음(13.2절), 주소는 한 곳에만(S10) |
| 업데이트 중 중단 | 서버 재시작 동안(수 초) 요청 실패 · SSE 끊김 | 사용자가 적은 시간에 업데이트, 실패하면 자동 되돌리기(13.8절, AC-79) |
| 서명 주소 유출 | 10분 동안 누구나 받음 | 짧은 유효 시간, 로그 금지, 화면에서만 사용 |
| XSS → 토큰 탈취 | 토큰이 localStorage | 기존 DOMPurify · `esc()` 원칙 유지, CSP는 다음 단계 검토 |
| PGroonga 1글자 · 동작 차이 | trigram과 결과가 다를 수 있음 | AC-32~34, `ILIKE` 대체 |
| 테스트가 운영을 건드림 | 테스트 설정 실수로 운영 프로젝트에 접속 | 10.2절 보호 장치 4개(ref 비교 · 테스트 표지 · 운영 쪽 거부 · 운영 변수 미사용), AC-72 |
| 테스트 프로젝트 일시정지 · 무료 2개 한도 | 1주 미사용 시 정지, 세 번째 프로젝트 불가 | 정지 시 명확한 중단 메시지, 1주에 한 번 테스트 실행, 필요하면 Pro |
| R2에 RLS 없음 | 서버가 버킷 전체 키를 가짐 — 키 생성 실수가 곧 누출 | 키 생성 함수 2개 · 접두어 재검사(7.1절), AC-39 · 39a |
| R2 10GB | 3~5명 PDF + 백업 합계 | 사용량 경고(7.6절), 넘으면 R2 유료(GB당 소액 — **확인 필요**) |
| 백업과 PDF가 같은 키 · 같은 버킷 | 키가 유출되면 백업도 지울 수 있음 | 키는 `cloud.env`(관리자 PC · 서버 PC)에만, 필요하면 별도 버킷(M10) |
| 외부 문서 변경 | 무료 범위 · 기본값이 바뀜 | "확인 필요" 항목을 개발 첫 주에 확인하고 이 문서 개정 |

## 19. 결정 기록 · 남은 미정

### 19.1 사용자 결정 (2026-10-07 답변 — 확정)

| # | 질문 | 결정 | 반영 |
|---|---|---|---|
| Q1 | 옮겨 올 기존 데이터 | **없음, 새로 시작** | 이관 도구 · 관련 완료 기준 삭제(12장, PLAN) |
| Q2 | 로그인 수단 | 사용자 희망은 구글 + 이메일(Resend). Resend는 도메인 인증이 필요해 **1단계는 구글만**, 이메일은 도메인 준비 후 Resend로 **이후 작업** | 6.1 · 6.2 · D1 · AC-03 · 17장 |
| Q3 | DB 백업 | ~~주 1회 자동 DB 덤프, 8개~~ → **Q12로 변경**. R2 같은 버킷 `backups/` 접두어(팀장 결정) | 13.3절, AC-70 · 71 |
| Q4 | 주소 | ~~기본 Cloud Run 주소~~ → **Q14로 변경**: Funnel 주소 `https://kimjuhyeon.tailac17f6.ts.net` | 13.2절 |
| Q5 | 폴더 삭제 시 논문 | **상위 폴더로 옮김** | 5.5절, AC-52 |
| Q6 | 바로가기 | 배포 후 **바탕화면 웹 바로가기(앱 창으로 열림)** 생성 | 11.1절, D13, AC-69 |
| Q7 | 최소 인스턴스 | ~~0~~ → **해당 없음**(Q14 — 서버가 늘 켜져 있음) | 9.4절, AC-60 |
| Q8 | `cloud.env` R2 변수 | 질문 철회 — R2 변수 4개는 이미 있음(기획팀 확인 오류), 계정 · 값은 사용자가 준비 중 | 8.4절 |
| Q9 | PDF 저장소 | **R2**(사용자가 R2를 만듦, 무료 10GB). Supabase Storage는 쓰지 않음(대안으로만 — `STORAGE_BACKEND`, 기본 `r2`) | 7장, AC-36~45a |
| Q10 | 테스트 DB | **별도 테스트용 Supabase 무료 프로젝트**, Docker 안 씀, 운영에서 테스트 금지(보호 장치) | 10.2절, AC-62 · 72 |
| Q11 | CI | **지금은 안 함** — 품질팀이 이 PC에서 테스트 프로젝트로 실행(M6 해결) | 10.3절 |
| Q12 | 백업 일정 · 보관 (M1) | **매일 04:00 KST, 최근 14개 보관** | 13.3절, AC-70 · 71 |
| Q13 | 다른 사용자 PC | **Electron 설치형 앱**(앱 창(클라우드 화면) + CLI 워커 + 폴더 동기화를 한 앱에). **2단계에 워커와 함께**, 6단계에 폴더 동기화 추가. **Windows만**. 배포는 **GitHub Releases + 자동 업데이트**(저장소가 public이라 토큰 불필요, 코드 서명이 없어 첫 설치 때 SmartScreen 경고). 1단계는 웹 배포 + 이 PC 바탕화면 바로가기(`make-shortcut.ps1`) 그대로 | 11.1절, PLAN 6장 2 · 6단계 |
| **Q14** | **호스팅 (2026-10-07 변경)** | **Cloud Run을 쓰지 않음.** 상시 켜 둔 별도 Windows PC(서버 PC `KIMJUHYEON`)에서 **Docker 없이 Python으로 직접** 실행, **Tailscale Funnel** 공개 고정 HTTPS 주소(`https://kimjuhyeon.tailac17f6.ts.net`)로 공개. Supabase · R2 그대로. 서버 PC에 Claude Code를 설치해 안내서대로 설치 · 운영 · 검증. **Cloud Run 배포 파일은 지움**(예비로 남기지 않음). 서버 PC가 꺼지면 모두 못 쓴다는 점은 설명 후 받은 결정 | 1 · 2 · 9 · 13장, 18장 위험, AC-55 · 58~61 · 69 · 71 · 73~79 |
| Q15 | 테스트 프로젝트 지역 | **뭄바이(ap-south-1) 그대로 둠**(운영은 서울) | 10.2절 |
| **Q17** | 서버 PC 사용 범위 (Q-S1, 2026-10-07) | 서버 PC는 **사용자 전용**, 다른 Windows 계정 없음 | 13.7절, 18장 위험(같은 계정 `cloud.env` — 수용) |
| **Q18** | 서버 PC 장치 암호화 (Q-S8, 2026-10-07) | **안 함** — 집 · 사무실 고정 PC라 도난 위험 낮다고 판단 | 13.7절, 18장 위험 |
| **Q16** | 가입 허용 목록 (2026-10-07) | **쓰지 않음**(`ALLOWED_EMAILS` 없음). 관문은 **Google OAuth 동의 화면 "테스트" 상태의 테스트 사용자 목록**(최대 100명, 게시 금지) | 6.1~6.3절, 8.4절, D2, AC-03~06 · 80~82, 18장 |

**사용자에게 요청할 사항** (결정이 아니라 준비 작업):
- **서버 PC 준비(Q14 — 새 항목)**: 관리자 PC `cloud.env`를 USB로 서버 PC에 옮기기(13.1-2), Tailscale 로그인 · 무인 실행, Tailscale 관리 콘솔에서 MagicDNS · HTTPS 인증서 · `funnel` 속성 · 서버 PC 키 만료 끄기(13.6절), 작업 스케줄러 등록 때 `USER` 계정 비밀번호 입력(S4), 네트워크 어댑터 절전 끄기 · BIOS 전원 복구 확인(13.7절). 순서는 [서버 PC 설치 안내서](../../deploy/server-pc/README.md).
- **테스트용 Supabase 프로젝트 만들기**(**뭄바이 `ap-south-1`** — 사용자 결정으로 그대로 둠, 무료 — 운영과 합쳐 무료 2개를 모두 씀): 값을 `cloud.env`의 `SUPABASE_TEST_URL` · `SUPABASE_TEST_ANON_KEY` · `SUPABASE_TEST_SERVICE_ROLE_KEY` · `SUPABASE_TEST_DB_URL`(Session pooler)에. 이 프로젝트는 이메일+비밀번호 로그인 켜기 · 이메일 확인 끄기(10.2절). 만든 뒤 팀이 `admin mark-test-project`로 표지를 붙임(프로젝트 ref 확인을 사용자에게 요청).
- **테스트 프로젝트**: 이메일+비밀번호 로그인 **켜기**, 이메일 확인(확인 메일) **끄기**(10.2절).
- **운영 프로젝트**: 이메일 공급자 · 익명 로그인 **끄기**(1단계는 구글만 — Q16 이후 필수). ~~Auth Hook 연결~~ → **연결하지 않음**(허용 목록을 켤 때만 — Q16).
- **Google OAuth 동의 화면(Q16)**: 게시 상태 **"테스트" 유지(게시 금지)**, 테스트 사용자에 쓸 사람 3~5명의 구글 계정 추가(최대 100명).
- **R2 버킷**: 관리자가 안내하는 CORS(20장 JSON) · `incoming/` 1일 수명 주기 적용, r2.dev 공개 주소 끔. R2 API 토큰은 이 버킷만(7.6절). (R2 변수 4개는 이미 채움)
- 운영 Supabase 프로젝트(서울) · Google OAuth 클라이언트 — 6.1절. 값은 `cloud.env`에만. ~~Google Cloud SDK 설치와 `gcloud auth login`~~ → **필요 없음**(Q14). 이미 만든 Google Cloud 프로젝트 · 결제 설정은 PaperLab이 더 쓰지 않으므로 사용자가 정리 여부를 정함(Google OAuth 클라이언트가 같은 프로젝트에 있으면 **그 프로젝트는 지우면 안 됨** — 확인 필요).
- Funnel을 켠 뒤: Supabase Auth Site URL · Redirect URLs, R2 CORS의 `AllowedOrigins`에 `https://kimjuhyeon.tailac17f6.ts.net` 넣기.

### 19.2 팀장 결정 (2026-10-07 — 기획팀 추천안 모두 채택)

| # | 항목 | 팀장 결정 |
|---|---|---|
| T1 | PDF 업로드(P11) | R2 서명 주소로 직접 업로드 + 서버가 R2에서 읽어 추출(7.2절) |
| T2 | 요약 백그라운드 | 요청 안 SSE 스트리밍(9.3절) |
| T3 | DB 로그인 역할 | 전용 `paperlab_app`(NOINHERIT · bypassrls 없음 · `authenticated`/`service_role`로 `SET ROLE` 가능). 풀러 지원은 실환경에서 확인(5.2절 4번, AC-12a) |
| T4 | 개인 표 스키마 | `paperlab`(Data API 비노출) |
| T5 | 마이그레이션 | `supabase/migrations/*.sql` + `paperlab/migrate.py` |
| T6 | id 체계 | `bigint identity` |
| T7 | supabase-js | `static/vendor/supabase/`에 버전 고정 |
| T8 | 허용 목록 | Auth Hook(Postgres 함수) + 서버 이중 확인 → **개정(Q16에 따른 팀장 결정)**: 선택 기능으로 유지, 서버 검사는 `PAPERLAB_ALLOWLIST=off`일 때만 꺼짐(기본 on, 빈 목록 ≠ 전부 허용), Auth Hook은 연결하지 않는 것이 기본. 운영은 off |
| T9 | 사용자 CSL 스타일 | DB `user_styles.xml` |
| T10 | 암호화 키 회전 | `key_id` 기반, 옛 키는 회전 명령 실행 때만 입력 |
| T11 | Cloud Run 설정 | ~~9.2절 값~~ → **폐기**(Q14). 서버 PC 실행 방식은 19.4절 S1~S10 |
| T12 | 테스트 DB | ~~Postgres + PGroonga 테스트 컨테이너~~ → **사용자 결정 Q10으로 대체**: 테스트용 Supabase 프로젝트 |
| T13 | CI | ~~1단계에 GitHub Actions~~ → **사용자 결정 Q11로 대체**: 지금은 안 함 |
| T14 | 백업 실행 위치 · 저장 | ~~Cloud Run Job + Cloud Scheduler~~ → **서버 PC 작업 스케줄러**(Q14에 따름, 매일 04:00 — Q12), 저장은 R2 같은 버킷 `backups/db/` 접두어(그대로) |
| T15 | DB 드라이버 · 연결 | psycopg 3 + Session pooler |
| T16 | PDF 브라우저 캐시 | 구현하되 **우선순위 낮음**(R2 egress 무료 — 7.3절, 수용 기준 없음) |

### 19.3 남은 미정 · 확인 필요

| # | 항목 | 누가 | 기획팀 안 |
|---|---|---|---|
| ~~M1~~ | ~~백업 보관 세대 수와 일정~~ → **해결**(Q12: 매일 04:00 KST, 14개) | — | — |
| M2 | 풀러가 `paperlab_app` 접속을 받는지 | 개발팀 실환경 확인 → 안 되면 팀장 결정 | Transaction 모드로 같은 역할 시도 → 그래도 안 되면 팀장 판단 |
| ~~M3~~ | ~~배포마다 앱 역할 비밀번호를 새로 만들지~~ → **팀장 결정(변경)**: 배포 · 업데이트 · 테스트 때 회전하지 않음, 명시적 명령(`admin app-role`)일 때만(개정: `deploy.ps1 -RotateAppRole`은 파일과 함께 폐기, 저장 위치는 Secret Manager → `cloud.env`의 `SUPABASE_APP_DB_URL` — S1). 테스트 프로젝트는 `public.paperlab_test_secrets`에 보관 · 재사용(5.2절 4번, 10.2절, 13.1절 5-5) | — | — |
| M4 | 21장 "확인 필요" 항목(JWT 기본 서명 방식, PGroonga 1글자 · 색인 크기, 운영 프로젝트 Postgres 버전 대 `pg_dump` 17, 새 API 키 형식, R2 대시보드 CORS 입력 형식 · 객체 버전 관리 · 10GB 초과 요금, **Funnel Host · X-Forwarded-* 전달 · 긴 연결 · Tailscale 플랜의 Funnel 사용 가능 여부 · 태그 문법 · 작업 스케줄러 무로그온 때 PATH**) | 개발팀 첫 주(서버 PC에서) | 확인 후 이 문서 개정 |
| M5 | 이메일 로그인(Resend) 일정 | 사용자 — 도메인 준비 시점 | 도메인 준비되면 소명세 |
| M9 | 저장 공간 10GB가 찼을 때 R2 유료 사용 여부 | 사용자 확인(80% 경고 때) | 그때 다시 묻기 |
| M10 | 백업을 별도 R2 버킷 + 전용 토큰으로 분리할지(새 변수 필요) | 팀장(필요해지면) | 1단계는 같은 버킷 접두어 |

### 19.4 서버 PC 전환 (Q14) — 팀장 결정(2026-10-07) · 사용자 확인

**팀장 결정(2026-10-07)** — S1~S10 모두 기획팀 추천안 채택(사용자 이견 시 변경). 선택지 칸은 기록으로 남김.

| # | 항목 | 선택지(기록) | 팀장 결정(2026-10-07) |
|---|---|---|---|
| **S1** | 앱 역할 주소 보관(Secret Manager 대체) | ① `cloud.env`에 새 변수 `SUPABASE_APP_DB_URL` ② 별도 파일 `server.env` ③ 서버 전용 Windows 계정 | **① `SUPABASE_APP_DB_URL`**(`admin app-role --write-env`가 씀, 서버 · 백업은 이것만 읽음, 사용자 이름은 `paperlab_app.<ref>`만 — AC-74) |
| **S2** | 같은 출처 판단 | ① `PAPERLAB_PUBLIC_URL` 고정 + Host 허용 목록 ② `https://{Host}` | **① `PAPERLAB_PUBLIC_URL` + Host 허용 목록**(6.5절) |
| **S3** | 자동 시작 방식 | ① 작업 스케줄러 ② Windows 서비스(WinSW · NSSM) ③ 로그인 때 시작 | **① 작업 스케줄러**(9.2절) + 감시 작업 |
| **S4** | 작업 스케줄러 로그온 | ① 로그온 무관 + 암호 저장 ② 암호 저장 안 함(S4U) ③ 로그온했을 때만 | **① 로그온 여부와 관계없이 + 암호 저장** — 암호는 설치 때 Windows 자격 증명 창에 **사용자가 직접 입력**(스크립트 · 파일 · 대화에 남지 않음) |
| **S5** | 서버와 (2단계) CLI 워커의 Windows 계정 | ① 같은 `USER` 계정 ② 서버 전용 계정 분리 | **① 같은 계정**(2단계에서 서버 PC 워커 codex 기본 끔 — 2단계 K20) |
| **S6** | Funnel 권한 대상 | ① 서버 PC 태그 `tag:paperlab-server`에만 ② `autogroup:member` | **① 서버 PC 태그에만**(태그 문법은 실환경에서 확인) |
| **S7** | 배포 브랜치 · 반영 방식 | ① 승인 · 푸시된 커밋을 `update.ps1`로 수동 반영 ② 자동 pull | **① 승인 커밋을 `update.ps1`로 수동 반영**(브랜치 `claude/paper-program-hrrhl2`, 자동 pull 없음 — 13.8절) |
| **S8** | compose 크기 한도 | ① 30MB 유지 ② 60MB | **① 30MB 유지** |
| **S9** | `pg_dump` 경로 | ① `PATH` → 선택 변수 `PAPERLAB_PG_DUMP` ② `PATH`만 | **① `PATH` 또는 `PAPERLAB_PG_DUMP`**(코드에 경로를 박지 않음) |
| **S10** | 공개 주소를 코드에 두는 곳 | ① 저장소 설정 파일 한 곳 ② 환경 변수로만 | **① `deploy/server-pc/server.json`**(+ R2 붙여 넣기용 `deploy/r2-cors.json` — 같은 값, 테스트가 일치 확인, AC-69). 서버 프로세스는 `cloud.env`의 `PAPERLAB_PUBLIC_URL`. 2단계 앱도 `server.json`을 읽는 쪽으로(가정) |

**미정 — 사용자 확인**

| # | 질문 | 기획팀 추천 |
|---|---|---|
| ~~Q-S1~~ | ~~서버 PC를 다른 사람도 쓰나요?~~ → **결정됨(사용자 2026-10-07)**: 서버 PC는 **사용자 전용**, 다른 Windows 계정 없음 (19.1절 Q17) | — |
| **Q-S2** | 서버 PC가 재부팅된 뒤 **Windows 자동 로그인**을 켤까요? 서버 · Funnel은 로그인 없이 뜨지만, 2단계 CLI 워커(Electron 앱)는 로그인해야 돕니다. 자동 로그인은 PC를 만지는 누구나 그 계정에 들어갈 수 있게 함 | **켜지 않음** — 재부팅 뒤 워커는 누가 로그인할 때까지 쉼(다른 PC 워커 · API 키로 대신) |
| **Q-S3** | 서버 PC의 2단계 CLI 워커를 **누구 계정**에 연결할까요? (기기 하나 = 계정 하나 — 확정. 그 PC의 claude · codex 로그인 구독이 그 사람 것이어야 함) | 관리자(사용자 본인) 계정 하나 |
| **Q-S4** | 서버 PC가 꺼졌을 때 알림을 받을까요? (예: 외부 무료 감시 서비스가 공개 주소 `/api/health`를 몇 분마다 확인하고 메일 — 새 외부 서비스 가입 필요) | 지금은 안 함(범위 밖), 불편하면 추가 |
| **Q-S5** | 정전 대비: 서버 PC BIOS에서 "전원 복구 시 켜기"를 켤 수 있나요? UPS(무정전 전원)를 쓸 생각이 있나요? | BIOS 설정만 확인, UPS는 범위 밖 |
| **Q-S6** | Windows 업데이트 재시작 활성 시간(사용자들이 쓰는 시간)은 몇 시~몇 시로 할까요? | 08:00~24:00 |
| **Q-S7** | 서버 PC에서도 품질팀 테스트(테스트 프로젝트)를 돌릴까요? 그러면 서버 PC `cloud.env`에 `SUPABASE_TEST_*` 4줄(테스트 프로젝트 관리자 주소 포함)이 더 들어갑니다 | 예 — 실환경 AC(58 · 59 · 71 · 75~79)는 어차피 서버 PC에서 하므로, 자동 테스트도 같은 곳에서 |
| ~~Q-S8~~ | ~~장치 암호화를 켤까요?~~ → **결정됨(사용자 2026-10-07)**: **장치 암호화 안 함**(집 · 사무실 고정 PC라 도난 위험 낮다고 판단) (19.1절 Q18) | — |

Q-S2~Q-S7은 설치를 막지 않으므로 **미정 유지**(답이 오면 개정).

## 20. 작업 분담 (파일 단위)

> **서버 PC 전환 작업(Q14, 2026-10-07)** 은 아래 원래 분담과 별도로 **20.1절** 목록대로 합니다. 원래 분담 표의 `paperlab/cloud.py` · `Dockerfile` · `.dockerignore` · `deploy/deploy.ps1` 줄은 **폐기됨**(파일 삭제 — 표에 취소선으로 표시), 자리표시 주소(`<배포 주소>`)는 `server.json`의 공개 주소로 바뀜(S10).

같은 파일을 두 팀이 동시에 고치지 않습니다. 순서: 관리자 `.gitignore` 정리 → 디자인 시안(`docs/design/phase1-cloud-ui.md`) · 개발 서버 작업 동시 → 개발 화면 작업 → 품질 검증 → 승인 → 관리자 커밋 · 푸시 · 배포.

### 개발팀

| 파일 | 할 일 |
|---|---|
| `supabase/migrations/*.sql` (신규) | 확장 · 앱 역할(NOLOGIN) · 표(5.5) · RLS(5.6) · PGroonga 색인(5.7) · Auth Hook 함수(6.3) |
| `paperlab/migrate.py` (신규) | 마이그레이션 적용 도구(5.3) |
| `paperlab/db.py` | Postgres로 다시 쓰기: 연결 풀 · `user_tx` · `system_tx`(5.2), 모든 메서드에 `user_id`, 5.8 동작 보존, 검색(5.7), 폴더 · 사용자 스타일 · 세션 대화 |
| `paperlab/auth.py` (신규) | JWT 검증(6.4), 허용 목록 확인, FastAPI 의존성 |
| `paperlab/storage.py` (신규) | 저장소 인터페이스 · **R2 구현(boto3)** · 가짜 구현 · `STORAGE_BACKEND` 분기(기본 `r2`, `supabase`는 자리만), 키 생성 함수 2개 · 접두어 재검사(7.1절), 서명 주소, 사용량(7장) |
| `paperlab/crypto.py` (신규 — 표준 모듈 `secrets`와 이름 충돌 피함) | AES-GCM 암호화 · `key_id` · 회전(8.2 · 8.3) |
| `paperlab/config.py` | 서버 환경 변수 읽기 · 검사(8.4), 사용자 설정 객체(기본값 · 비밀 결합), `default_data_dir` · `settings.json` 제거 |
| `paperlab/server.py` | 보안 미들웨어 교체(6.5), 요청별 DB · 설정 · `Sources` · `AIService`, 15장 API 변경, 업로드 · 다운로드 · 삭제, 요약 SSE(9.3), compose 사용자 분리 · 30MB · 스트리밍 응답, 스타일 DB, `/api/me` · `/api/public-config` · `/api/health?deep=1`, 503 처리 |
| `paperlab/ai.py` | 환경 변수 키 폴백 제거(서버), CLI 엔진은 "2단계" 상태 문구, 요약 진행을 SSE용 이벤트로 낼 수 있게 |
| ~~`paperlab/cloud.py`~~ | **폐기됨**(Q14 — 파일 삭제, 진입점은 `paperlab/serve.py` — 20.1절) |
| `paperlab/admin.py` (신규) | `sync-allowlist` · `app-role` · `rotate-key` · `orphans`(R2) · `backup`(세대 정리 포함 — **14개**, Q12) · `mark-test-project` 명령 |
| `paperlab/__main__.py` | 개발 서버로 축소(11장) |
| `pyproject.toml` | 의존성 추가(9.1), `scripts` · `desktop` 제거 |
| `PaperLab.bat` · `PaperLab.command` · `paperlab.sh` | 삭제(11장) |
| ~~`Dockerfile` · `.dockerignore` · `deploy/deploy.ps1`~~ | **폐기됨**(Q14 — 파일 삭제, AC-55) |
| `deploy/r2-cors.json` · `deploy/README.md` | 버킷 CORS(공개 주소 — `server.json`과 같은 값, AC-69) · 수명 주기 값, 사용자 준비 안내 · 관리 명령 · 복원 절차(문구는 기획팀 검토). 서버 PC 설치 · 백업 작업(매일 04:00 KST)은 `deploy/server-pc/`(20.1절) |
| `deploy/make-shortcut.ps1` (신규) | 바탕화면 앱 창 바로가기(11.1절). 주소는 `deploy/server-pc/server.json`에서 읽음(`-Url`은 선택 — AC-69) |
| `tests/conftest.py`(운영 보호 장치 · 테스트 사용자 생성/삭제 · 세션 청소) · `tests/test_*.py` · `tests/test_rls.py` (신규) · `tests/test_auth.py` (신규) · `tests/test_storage.py` (신규) · `tests/test_backup.py` (신규) | 10장 환경, 16장 자동 수용 기준 |
| `paperlab/static/vendor/supabase/` · `paperlab/static/vendor/THIRD_PARTY.md` | supabase-js 고정본(T7) |
| `paperlab/static/js/auth.js` (신규) | Supabase 클라이언트, 구글 로그인 · 로그아웃 · 세션 · 토큰 제공 |
| `paperlab/static/js/api.js` | Bearer 토큰, 401 재시도 · 만료 처리, 503 처리 |
| `paperlab/static/js/app.js` | 시작 시 로그인 확인 · 로그인 화면 전환, 계정 메뉴, 폴더 트리 · 폴더 필터 |
| `paperlab/static/js/state.js` | 사용자 · 폴더 상태 |
| `paperlab/static/js/library.js` | 업로드 흐름(T1), PDF 열기 · 하이라이트 내보내기(6.7), 폴더로 이동 |
| `paperlab/static/js/reader.js` | 서명 주소로 PDF 받기, 요약 SSE · 안내, 하이라이트 내보내기 |
| `paperlab/static/js/dialogs.js` | 설정 창(D7), 업로드 진행률, 폴더 고르기 대화상자 |
| `paperlab/static/index.html` | 로그인 화면 · 계정 메뉴 자리, supabase 스크립트(디자인팀 클래스 이름 사용) |

### 디자인팀

| 파일 | 할 일 |
|---|---|
| `docs/design/phase1-cloud-ui.md` (신규) | 14장 D1~D13 시안 · 문구 확정 · **CSS 클래스 이름 목록**. 개발팀 화면 작업 전에 먼저 |
| `paperlab/static/css/app.css` | 위 클래스 스타일(로그인 화면, 계정 메뉴, 폴더 트리 구별, 진행 막대, 멈춤 · 연결 중 화면 — D6 문구 개정) |
| `deploy/paperlab.ico` (신규) | 바로가기 아이콘(D13) |

### 기획팀 (구현 후)
- `README.md` · `FEATURES.md`: 실행 방법(서버 주소 · 바탕화면 바로가기), 데이터 폴더 · 백업 설명, 폴더 기능, compose 30MB, 구글 로그인. (서버 PC 기준 정리 완료 — 2026-10-07)
- `deploy/README.md` 사용자 안내 · 복원 절차 문구 검토.
- 19.3절 남은 항목 답이 오면 이 명세 개정.

### 관리자
- **`.gitignore`에 `*.env` 추가**(지금 없음 — `cloud.env`는 저장소 밖이지만 실수로 복사돼도 커밋되지 않게). 개발 작업 시작 전에.
- 승인된 결과 커밋 · 푸시(브랜치 `claude/paper-program-hrrhl2`). 커밋 전에 비밀값이 들어 있지 않은지 확인(개정: 공개 서버 주소는 S10의 한 곳 · 문서에는 있어도 됨 — AC-69).
- ~~승인 후 `deploy/deploy.ps1` 실행~~ → **개정(Q14)**: 승인 · 푸시 뒤 서버 PC에서 `deploy/server-pc/install.ps1`(처음) · `update.ps1`(그 뒤) 실행 — 서버 PC의 Claude Code가 안내서대로 하거나 관리자가 직접(13.1 · 13.8절).
- Funnel을 켠 뒤 `deploy/make-shortcut.ps1 -Url https://kimjuhyeon.tailac17f6.ts.net/`로 관리자 PC 바탕화면 바로가기 생성(11.1절).
- **R2 버킷 설정 안내**(사용자가 Cloudflare 대시보드 → R2 → 버킷 → Settings에 붙여 넣도록, 7.6절). CORS 예시(개정: 서버 주소는 공개 값이라 그대로 적음 — `deploy/r2-cors.json`도 이 값으로, S10):
  ```json
  [
    {
      "AllowedOrigins": ["https://kimjuhyeon.tailac17f6.ts.net"],
      "AllowedMethods": ["GET", "HEAD", "PUT"],
      "AllowedHeaders": ["Content-Type"],
      "ExposeHeaders": ["ETag", "Content-Length"],
      "MaxAgeSeconds": 3600
    }
  ]
  ```
  수명 주기 규칙: 이름 `delete-incoming`, 접두어 `incoming/`, 업로드 후 **1일** 뒤 삭제. 공개 접근(r2.dev) 끔. (대시보드의 CORS 입력 형식이 위와 다르면 같은 값으로 옮겨 적음 — **확인 필요**)
- 주 1회 서버 PC `D:\PaperLab\logs\watchdog.log` · `backup.log` · 작업 스케줄러 "마지막 실행 결과" 확인(가정 — 개정 전: 월 1회 Job 기록).

### 관리 권한 사용처 (1단계 전부 — 이 밖의 사용은 명세 개정 필요)
| 사용처 | 방식 | reason(로그) |
|---|---|---|
| `paperlab/migrate.py` | 관리자 연결(서버 PC 설치 · 업데이트 스크립트, 또는 관리자 PC) | `migrate` |
| `admin sync-allowlist` | 관리자 연결 | `allowlist sync` |
| `admin app-role` | 관리자 연결 — **명시적 회전 때만**(첫 설치에서 `SUPABASE_APP_DB_URL`이 비었을 때 · 직접 실행, M3 변경). 결과는 `cloud.env`에 씀(S1) | `app role password` |
| `admin.test_app_role_conninfo` (pytest 세션 시작 · 개발 서버 시작) | **테스트 프로젝트** 관리자 연결 — 테스트 표지 확인 후 `public.paperlab_test_secrets` 읽기, 저장 비밀번호가 인증 실패일 때만 advisory lock 아래 재생성 · 저장 | 재생성할 때만 `app role password (test project)` |
| `admin rotate-key` | 관리자 연결 | `encryption key rotation` |
| `admin orphans` | 관리자 연결 + R2 키(PC) | `orphan scan` |
| `/api/storage/usage` 의 전체 합계 | `system_tx` | `storage usage` (사용자 구분 없는 합계만) |
| `admin mark-test-project` | 테스트 프로젝트 관리자 연결 | `mark test project` |
| `admin pg-dump-check` (신규 — 설치 스크립트 · 수동) | **앱 역할 주소**(`SUPABASE_APP_DB_URL`)로 접속해 DB 서버 버전만 읽음(표를 읽지 않음, 역할 전환 없음 — 관리 권한 사용 아님), `pg_dump --version`과 주 버전 비교. 관리자 주소로 대신 붙지 않음 | (없음 — 표를 읽지 않음) |
| `admin latest-backup` (신규 — 감시 작업 하루 한 번) | DB 접속 없음. R2 `backups/db/` 목록을 읽고 가장 최근 파일 하나에 HeadObject 한 번(올린 시각 `LastModified` 기준 경과 시간 — 36시간 넘거나 없으면 종료 코드 2) | (없음 — DB를 쓰지 않음) |
| `admin backup` (서버 PC 작업 스케줄러 — 개정 전 Cloud Run Job) | 앱 역할(`SUPABASE_APP_DB_URL`) + `pg_dump --role=service_role`, R2 `backups/db/`에 쓰기 · 세대 정리 | `backup` |
| `/api/health?deep=1` 의 `select 1` | `system_tx` | `health check` (표를 읽지 않음) |

### 20.1 서버 PC 전환 작업 (Q14 — 파일 단위)

순서: 팀장 결정(S1~S10) → 개발팀 코드 · 스크립트 · 테스트 → 디자인팀 D5 · D6 문구 → 품질팀(관리자 PC 자동 테스트 + 서버 PC 실환경) → 승인 → 관리자 커밋 · 푸시 → 서버 PC에서 `install.ps1`. 같은 파일을 두 팀이 동시에 고치지 않습니다.

**개발팀 — 지울 파일**
| 파일 | 비고 |
|---|---|
| `Dockerfile` · `.dockerignore` | Cloud Run 이미지(9.1절 개정 전) |
| `deploy/deploy.ps1` | Cloud Run · Secret Manager · Cloud Scheduler · Artifact Registry · Cloud Build 배포 |
| `paperlab/cloud.py` | Cloud Run 진입점 → `paperlab/serve.py`로 대체(앱 만드는 부분은 옮김) |
| (그 밖) | 저장소에서 `gcloud` · Secret Manager · Cloud Scheduler · Cloud Run Job을 부르는 코드 전부(`admin.py`의 `_push_secret` · `--project` · `GCP_PROJECT_ID` 등) — AC-55 검색 0건 |

**개발팀 — 고치거나 새로 만들 파일**
| 파일 | 할 일 |
|---|---|
| `paperlab/serve.py` (신규) | 실행 진입점 `python -m paperlab.serve [--port 8080] [--env-file …] [--check]`: `cloud.env` 읽기 · 설정 검사(AC-74), 회전 파일 로그(9.1 · 13.5절), uvicorn `127.0.0.1` · `proxy_headers` · `forwarded_allow_ips="127.0.0.1"`. `--check`는 서버를 띄우지 않고 빠진 · 남은(지울) 변수 **이름**과 `SUPABASE_APP_DB_URL` 사용자 이름 앞부분만 출력(설치 스크립트 · 안내서 확인용) |
| `paperlab/config.py` | `ServerConfig.from_env`: DB 주소를 `SUPABASE_APP_DB_URL`에서(S1 — 사용자 이름은 `paperlab_app.<ref>`만 허용, 그 밖 모두 거부), `PAPERLAB_PUBLIC_URL`(S2) 추가, `SUPABASE_DB_URL`은 서버 설정에서 읽지 않음. **`PAPERLAB_ALLOWLIST`(Q16 — `off`면 `ALLOWED_EMAILS`를 보지 않음, 없음 · `on`인데 `ALLOWED_EMAILS`가 없거나 비면 시작은 하되 모든 `/api/*` 403 + 경고(시작 거부 아님), 모르는 값만 시작 거부, 6.3절 · AC-81)**. 주석의 "Cloud Run" 정리 |
| `paperlab/auth.py` · `paperlab/server.py`(허용 목록 부분) | `off`일 때 `Allowlist.check`를 건너뛰는 분기(빈 목록 = 전부 허용으로 바꾸지 않음 — 지금 `Allowlist([])` 동작 유지), 시작 로그 한 줄 |
| `paperlab/server.py` | 6.5절: Origin = `PAPERLAB_PUBLIC_URL` 출처(개발 모드는 지금 규칙), Host 허용 목록 → 400, 요청 id(`x-cloud-trace-context` → `X-Request-Id`), `/api/health` `version`에 커밋. "Cloud Run" 주석 정리(compose 30MB 값은 유지 — S8) |
| `paperlab/admin.py` | `app-role --write-env`: `cloud.env`의 `SUPABASE_APP_DB_URL` 줄만 바꿔 씀(임시 파일 → 바꿔치기, 권한 유지, 값 출력 없음, 다른 줄 · 주석 · 순서 보존). `backup`: `SUPABASE_APP_DB_URL`로 접속, `pg_dump`는 `PAPERLAB_PG_DUMP` → PATH(S9), `--tmp-dir` 인자(없으면 시스템 임시 폴더), 임시 파일 정리 보장. Secret Manager · GCP 코드 삭제. 맨 위 설명 갱신 |
| `deploy/server-pc/install.ps1` (신규) | 13.1절 5번 전체(다시 실행해도 안전). 인자: `-Root`(기본 `D:\PaperLab`) · `-AppDir`(기본 `D:\PaperLab\study99web`) · `-LogDir`(기본 `D:\PaperLab\logs`) · `-TmpDir`(기본 `D:\PaperLab\tmp`) · `-Branch` · `-Port`(8080) · `-DryRun`(할 일만 출력). `py -3.12` 확인(없으면 중단 · 안내), `pg_dump` 주 버전 대 운영 DB 버전 비교, 시간대 KST 확인, `cloud.env` 권한 설정(`icacls`), 작업 3개 등록(`Register-ScheduledTask` — 비밀번호는 `Get-Credential` 창으로만), Funnel 켜기는 `funnel.ps1` 호출 |
| `deploy/server-pc/update.ps1` (신규) | 13.8절(확인 · 깨끗한 작업 폴더 검사 · ff-only · 의존성 · 마이그레이션 · 재시작 · 상태 확인 · 실패 시 되돌리기 · `update.log`). 인자 `-Ref` · `-Yes` · `-RestartOnly` |
| `deploy/server-pc/funnel.ps1` (신규) | `on`(`tailscale funnel --bg 8080`) · `status` · `off`. `tailscale` 실행 파일 찾기(PATH → 기본 설치 경로), `BackendState`가 `Running`이 아니면 중단 · 안내(13.6절) |
| `deploy/server-pc/watchdog.ps1` (신규) | 13.5절 감시 1~4. 재시작 횟수 제한(시간당 3번 — 가정, 넘으면 경고만) |
| `deploy/server-pc/uninstall.ps1` (신규, 가정) | 작업 3개 삭제 · Funnel 끄기(저장소 · `cloud.env`는 지우지 않음 — 사용자가 직접) |
| `deploy/server-pc/server.json` 또는 S10에서 정한 한 곳 (신규) | 공개 주소 · 포트 · 기본 경로(비밀 없음). 스크립트 · `make-shortcut.ps1` · (2단계) 앱 빌드가 읽음 |
| `deploy/make-shortcut.ps1` | `-Url` 생략 시 S10 파일의 공개 주소 사용(가정), 도움말 예시 주소를 공개 주소로 |
| `deploy/r2-cors.json` | `AllowedOrigins`에 공개 주소(자리표시 제거 — S10) |
| `deploy/README.md` | Cloud Run 절(3장 배포 · `gcloud` · Secret Manager · 되돌리기 · 관리 명령의 `--project`) 삭제 → 사용자 준비 · 테스트 프로젝트(**뭄바이**) · 관리 명령 · 복원 절차만 남기고 서버 PC 안내서로 연결(문구는 기획팀 검토) |
| `tests/test_cloud_units.py` | `test_dockerignore_excludes_secrets_and_tests` · `test_dev_login_module_served_in_dev_and_excluded_from_image`의 `.dockerignore` 단언 **삭제** → AC-55(지운 파일 없음 · 검색 0건) · AC-73 검사로 교체 |
| `tests/test_serve.py` (신규) | AC-74(설정 검사 · 바인딩 · 프록시 신뢰), AC-08 개정(공개 출처 · Host 허용 목록), AC-81(허용 목록 스위치), `--check` 출력에 값이 없음 |
| `tests/test_auth.py` | AC-04 개정(off에서 목록 밖 사용자 200, on에서 403) |
| `deploy/server-pc/install.ps1` · `update.ps1`(위 줄에 추가) | `sync-allowlist`를 늘 부르되 `ALLOWED_EMAILS`가 비면 아무것도 안 함(AC-06), `--check`는 off면 `ALLOWED_EMAILS`를 "필요 없음"으로, on인데 비었으면 **경고 줄**(시작 거부 아님 — AC-81) |
| `tests/test_admin_env.py` (신규) | `app-role --write-env`(가짜 DB 함수 주입): 그 줄만 바뀜 · 다른 줄 보존 · 표준 출력 · 로그에 값 없음 · 파일이 없으면 오류 |
| `tests/test_backup.py` | 앱 역할 주소 사용 · `PAPERLAB_PG_DUMP`/PATH 해석 · 못 찾으면 오류 · 임시 파일 정리(AC-71 자동 부분), 설명의 "Cloud Run Job" 정리 |
| `tests/conftest.py` | 보호 장치 검사 대상에 `SUPABASE_APP_DB_URL` 추가(AC-72 (4)), 테스트 설정 만들기(`make_config`)에 공개 주소 값 |
| `tests/test_server.py` | Origin · Host 관련 단언을 개정 규칙으로 |

**디자인팀**: `docs/design/phase1-cloud-ui.md` D5 · D6 문구(14장 개정), `paperlab/static/css/app.css` 변경 없음(문구만이면).
**기획팀(구현 후)**: `README.md` · `FEATURES.md`(서버 주소 · 서버 PC 운영 설명, "Cloud Run" 표현 정리), `deploy/README.md` 문구 검토, 19.4절 답이 오면 이 명세 · PLAN · 안내서 개정.
**관리자**: 커밋 전 `git grep`으로 AC-55 · 69 검사, 서버 PC에서 `install.ps1`(또는 서버 PC의 Claude Code가 안내서대로).
**품질팀**: 관리자 PC에서 자동 테스트 전체, 서버 PC에서 [실환경] AC-54 · 58 · 59 · 61 · 69 · 71 · 75~79(+ 개정 안 된 [실환경] 항목 — 12 · 12a · 21 · 38 · 43 · 44 · 45a).

## 21. 확인한 외부 문서 (2026-10-07)

| 사실 | 출처 | 상태 |
|---|---|---|
| Supabase 무료 플랜: 무료 프로젝트 2개 · 1주 미사용 시 정지. (대안 저장소 참고) Storage 1GB · 업로드 최대 50MB · egress 5GB/월, `storage.objects` RLS, 서명 업로드 주소 2시간 | supabase.com/pricing, …/storage/uploads/file-limits, …/storage/security/access-control | 확인 |
| 직접 연결은 무료 플랜 IPv6 전용, 풀러는 IPv4. Transaction 모드는 prepared statement 미지원 · 세션 상태가 트랜잭션 사이에 사라짐. 직접 연결은 오래 도는 컨테이너용 권장 | supabase.com/docs/guides/database/connecting-to-postgres | 확인 |
| Cloud Run이 IPv6로 나가려면 Direct VPC egress + 이중 스택 서브넷 | docs.cloud.google.com/run/docs/configuring/vpc-dual-stack-subnet | 확인(검색 결과 요약) |
| Before User Created 훅: 가입 전 실행, 오류 반환 시 가입 거부, OAuth · 이메일 모두, Postgres 함수 또는 HTTP, **Free · Pro 사용 가능** | supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook, …/auth-hooks | 확인. 반환 JSON 정확한 모양은 개발팀 확인 |
| 기본 SMTP는 팀원 주소에만, 시간당 2통 | supabase.com/docs/guides/auth/auth-smtp | 확인 |
| JWKS 경로 `/auth/v1/.well-known/jwks.json`, 10분 캐시, 레거시 HS256 비권장 | supabase.com/docs/guides/auth/jwts, …/signing-keys | 확인. 새 프로젝트 기본 서명 방식은 **확인 필요** |
| RLS `(select auth.uid())` 권장, `to authenticated`, `postgres` · `service_role`은 `bypassrls` | supabase.com/docs/guides/database/postgres/row-level-security | 확인 |
| PGroonga 사용 가능(`create extension pgroonga with schema extensions`), 기본 토크나이저 TokenBigram, 부분 일치는 `TokenNgram(... unify_* false)` 권장, 다열 색인 가능 | supabase.com/docs/guides/database/extensions/pgroonga, pgroonga.github.io/reference/create-index-using-pgroonga.html | 확인. 1글자 검색 · 색인 크기는 **확인 필요** |
| 무료 플랜 자동 백업 없음(CLI `db dump` 권장), Pro 일일 백업 7일 | supabase.com/docs/guides/platform/backups | 확인 |
| R2 서명 주소: GET · HEAD · PUT · DELETE, 1초~7일, S3 API 도메인만, 브라우저는 CORS 필요, PUT에 Content-Type 서명 | developers.cloudflare.com/r2/api/s3/presigned-urls/ | 확인 |
| Cloud Run: 요청 기반 청구는 요청 처리 중에만 CPU, 인스턴스 기반은 수명 내내 CPU, 쉬는 인스턴스는 언제든 종료 가능 | docs.cloud.google.com/run/docs/configuring/billing-settings | 확인 |
| Cloud Run: HTTP/1 요청 · 응답 32MiB(분할 · 스트리밍 응답은 예외), 요청 시간 최대 60분, 인스턴스당 동시 요청 최대 1000 | docs.cloud.google.com/run/quotas | 확인 |
| Cloud Run · Secret Manager · Artifact Registry · Cloud Build 무료 범위 수치, 서울 리전 가격 등급 | cloud.google.com/run/pricing 등 | **해당 없음**(Q14 — Cloud Run 폐기. 위 Cloud Run 두 줄도 기록으로만 남김) |
| Supabase 새 API 키(publishable/secret) 형식과 `SUPABASE_ANON_KEY` 관계 | Supabase 문서 | **확인 필요** |
| Supavisor가 사용자 정의 로그인 역할을 받는지(T3) | Supabase 문서 | **확인 필요** |
| **Tailscale Funnel**: v1.38.3+, MagicDNS · HTTPS 인증서 · 정책 `nodeAttrs`의 `funnel` 속성 필요(기본 예시 `autogroup:member`), 포트 443 · 8443 · 10000만, TLS는 기기의 Tailscale이 종료하고 복호화한 요청을 로컬로, 프록시 대상은 `http://127.0.0.1`만, `*.ts.net` 이름만, 바꿀 수 없는 대역폭 제한, `--bg`면 재부팅 · down/up 뒤 자동 재개, Let's Encrypt 한도 시 약 34시간 대기 | tailscale.com/kb/1223/funnel, tailscale.com/kb/1311/tailscale-funnel | 확인. Host · `X-Forwarded-*` 전달, 긴 연결 제한, 무료(개인) 플랜에서의 사용 가능 여부, 태그 대상 문법은 **확인 필요**(AC-75 · 78) |
| Funnel 요청에는 Tailscale 신원 헤더(`Tailscale-User-*`)가 붙지 않음(Serve만), 들어온 같은 이름 헤더는 지움 | tailscale.com/kb/1312/serve | 확인(검색 요약) — 우리 서버는 이 헤더를 쓰지 않음 |
| Tailscale Windows **무인 실행**(Run unattended, `tailscale up --unattended=true`): 사용자가 로그아웃해도 계속 실행, 관리자 권한이 필요할 수 있음 | tailscale.com/kb/1088/run-unattended | 확인(검색 요약) |
| 작업 스케줄러 "암호 저장 안 함"(S4U): 로컬 자원만 · 네트워크 · 암호화 파일 접근 불가 → 인터넷이 필요한 작업에 비추천, "암호 저장"은 정상 | learn.microsoft.com Task Security Context · TASK_LOGON_TYPE | 확인(검색 요약). 실제 인터넷 차단 여부는 **확인 필요** |
| Google OAuth 동의 화면 "테스트" 게시 상태: 테스트 사용자 **최대 100명**, 테스트 사용자의 승인은 **동의 후 7일**에 만료(오프라인 refresh token도 만료), 미인증 앱 경고가 표시됨 | support.google.com/cloud/answer/15549945 | 확인(검색 요약). 7일 만료가 Supabase 로그인 세션에 주는 영향, 테스트 사용자 밖 계정의 차단 화면 문구는 **확인 필요** |
| 서버 PC 실측(Windows 11 Home, `py -3.12` = 3.12.10, `pg_dump` 17.10, Tailscale 1.102.4, D: HDD 455GB 여유, `icacls D:\` 기본값) | 서버 PC의 Claude Code 읽기 전용 점검(2026-10-07, 팀장 전달) | 확인 |
