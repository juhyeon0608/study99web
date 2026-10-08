# 기능 명세 — 2단계 작업 큐 · CLI 워커 · 엔진 라우팅 · Electron 설치형 앱

- 단계: 2단계 ([PLAN.md](../../PLAN.md) 6장 "2단계", 5장 "AI 라우팅 규칙", 10장 P2 · P8 · P12)
- 작성: 기획팀 · 2026-10-07 (초안 — 20장 질문의 답을 받으면 개정)
- **호스팅이 PC 서버(서버 PC + Tailscale Funnel)로 바뀜에 따라 개정 중입니다** (사용자 결정 2026-10-07 — [1단계 명세](phase1-cloud.md) 19.1절 Q14). 이 문서의 "서버"는 서버 PC `KIMJUHYEON`에서 도는 PaperLab 서버(공개 주소 `https://kimjuhyeon.tailac17f6.ts.net`)입니다. 개정 내용: 사용자 결정 **U1~U8 반영**(20.1절), 팀장 결정 K1~K17 **기획팀 추천 채택** 기록 + **K2(API 요약 실행 위치)를 Cloud Tasks → 서버 프로세스 안 백그라운드 실행기(jobs 표 기반)로**, **K14(새 환경 변수) 재검토 → 새 변수 없음**(팀장 결정(2026-10-07) — K2' · K14', K1' · K20 포함. **2a 구현 뒤 팀장 승인(2026-10-08)으로 설치 파일 폴더 변수 `PAPERLAB_RELEASES_DIR` 1개가 생김 — K14' 개정**), U2(세 회사 API 키)에 따른 9장 라우팅 · 설정 · 암호화 저장 확장, U6(서버 주소 내장), **서버 PC 워커 상시 운영(13.9절)**. 바뀐 곳: 1 · 3 · 4 · 5.5 · 5.6 · 6.3 · 6.6 · 6.7 · 8.2 · 9 · 10 · 11.2 · 13.5~13.9 · 14 · 15 · 16 · 17 · 19 · 20 · 21 · 22장.
- 개정 2026-10-07 (1A 연결): [인하대 프록시 · Scholar 명세](inha-proxy.md) 12장 · 확정 IK-6(①: 시스템 브라우저)에 맞춰 13.2절 탐색 제한 · 새 창 · `shell.openExternal` 규칙을 **13.2.1절 "외부 링크 열기"** 로 다시 씀(앱 안 창에서는 열지 않음, 스킴은 http(s)만). 수용 기준 AC-86, 팀장 결정 K21(①로 확정 — 목록 밖 http(s)도 시스템 브라우저로), 확인 필요 1줄, 21장 개발팀 표 1줄 추가.
- **개정 2026-10-07 (사용자 결정 U9 · Q-S3 · U11 · U10 변경)**: **U9** 동시 실행 기본값 그대로(claude 2 · codex 1 · gemini 1 · 전체 2). **Q-S3 서버 PC에는 워커를 두지 않음** → 13.9절을 "하지 않음 + 서버 PC의 배포 역할"로 바꿈, AC-83 · K20 · **U11 해당 없음**. **U10 변경 — GitHub Releases를 쓰지 않고 서버 PC가 직접 배포**: 서버 PC `update.ps1`이 git 반영 뒤 데스크톱 앱이 바뀌었으면 Electron 설치 파일을 빌드(electron-builder · NSIS)해 `D:\PaperLab\releases`에 두고, PaperLab 서버가 `/downloads/`로 내려줌. 자동 업데이트는 electron-updater **generic provider**(`https://kimjuhyeon.tailac17f6.ts.net/downloads/`, U5 그대로). 서버 PC에 Node.js LTS 필요. 빌드 실패는 서버 업데이트 성공으로 두고 이전 설치 파일 유지 + WARN. 보안 검토(공개 여부 · 무결성 · 경로 순회 · 캐시)는 **13.7.1절**(기획팀 추천 — 팀장 결정 K22~K24). 바뀐 곳: 1 · 2 · 4장, 6.7 · 13.1 · 13.2.1 · 13.6 · 13.7 · 13.7.1(신규) · 13.9 · 14장, 16 · 17(AC-70 · 71 · 83 개정, AC-87~89 신규) · 18 · 19 · 20 · 21 · 22장. K19는 그대로(개발팀 제안 → 팀장 결정 — 2026-10-08에 확정, 아래 개정 줄)
- **개정 2026-10-08 (사용자 결정 — 2단계를 2a · 2b로 나눔)**: 세션 사용량을 줄이고, 2a를 먼저 반영해 브라우저에서 OpenAI · Google 키를 바로 쓸 수 있게 하려는 것입니다. **2a = 서버 · 웹**(작업 큐, 기기 연결 · 워커 API, API 우선 · CLI 폴백 라우팅, API 키 3종, 설정 화면 "AI 엔진" · "연결된 PC", PC 앱 받기 화면과 `/downloads` 경로, 작업 목록). **2b = Electron 앱, PC 워커(CLI 실행), 서버 PC 빌드 단계(`update.ps1`), 실제 PC 실측**. 명세 본문(1~16 · 18~20 · 22장)은 바꾸지 않고, **17장 수용 기준마다 `[2a]` · `[2b]` 표시**(둘 다 걸치면 `[2a+2b]`와 나눠 적음)와 **21장 작업 목록을 2a · 2b로 나눔**. 2a만 반영된 동안 CLI 작업은 **워커가 없으면 대기**합니다(9.2절 "경로가 비면 400" 규칙과 대기 기한 6.6절은 그대로 — 21.0절 "2a만 반영된 동안의 동작" 참고). 화면 문구는 [디자인 문서](../design/phase2-worker-electron-ui.md)를 따릅니다. 2a 완료 뒤 2b를 시작하며 2b에서 2a 항목을 다시 돌려 회귀를 확인합니다(AC-95 · 96).
- **개정 2026-10-08 (2a 개발 완료 — 팀장이 승인한 구현 차이 반영)**: 코드(`paperlab/jobs.py` · `worker_api.py` · `api_runner.py` · `downloads.py` · `ai.py` · `config.py` · `server.py`, 마이그레이션 `20261009000001_devices_jobs.sql`)를 읽고 실제 값과 맞춰 고침. ① 설치 파일 폴더 환경 변수 `PAPERLAB_RELEASES_DIR`(13.7.1절 · K14' · 21장) ② 작업 보기에 `route` · `route_index` · `question` · `result`(7장) ③ `jobs.leased_at`과 서버 쪽 절대 기한(5.3 · 6.3 · 11.5절) ④ CLI 대기 기한을 작업 만들 때 정하고 CLI 칸 폴백 때 다시 셈(6.6절) ⑤ 오류 코드 `bad_input`(9.6절) ⑥ 대화 · 글쓰기 SSE 작업 리스 660초 고정 — **사실만 기록, 영향은 품질팀 검증 중**(6.3절) ⑦ 연결 코드 알파벳 31자(8.2 · 12.1절 · AC-16) ⑧ `/downloads/` ETag 304 · `.exe` Range 요청 횟수(13.7.1절 · AC-87) ⑨ Gemini는 `responseMimeType`만(9.5절) ⑩ K19 확정(9.4절 · 20.2절) ⑪ 2b가 맞출 워커 계약(8장 · 13.3절)을 구현 기준으로 정리.
- **개정 2026-10-08 (2a 품질 수정 반영 — 코드를 읽어 사실 확인한 뒤 고침)**: ① `jobs.interactive` 열(SSE에서 시작한 대화 · 글쓰기 작업) — 리스가 지나면 다시 실행하지 않고 `cancelled` · `interrupted`로 끝냄, 폴백으로 다음 칸에 가면 표시가 풀림, SSE는 0.05초마다 끊김 확인(5.3 · 6.1 · 6.3 · 9.3 · 15.2절 — 6.3절의 "660초 리스 영향 미정"을 이 결정으로 바꿈) ② `jobs.result_key` 열은 2b 대비로 2a 마이그레이션에 이미 있음(2 · 5.3 · 21.0절) ③ `/downloads` 한도: Range 요청은 시간당 횟수에 넣지 않음, 전체 `GET`은 같은 IP 시간당 10회, 127.0.0.1(XFF 없음)이면 전체 시간당 60회(13.7.1절 · AC-87 · 19장 — 수용 위험 1줄) ④ 연결 코드 한도 2개(IP별 분당 10 · 전체 분당 60, 127.0.0.1이면 전체만 — 8.2절) ⑤ 해지 · 다른 PC 재대기 때 `cancel_requested`면 `cancelled`(6.1 · 12.4절) ⑥ 하트비트 `id`가 bool이거나 범위 밖이면 400, 진행 중 작업을 돌려주는 retry는 200(7.1 · 8.5절) ⑦ 폴백 때 해지된 기기의 CLI 칸은 건너뜀(9.2절 예외) ⑧ 수용 위험: interactive 스트림이 660초를 넘기면 답 없이 끝날 수 있음(14 · 19장).
- **개정 2026-10-08 (2b 개발 완료 — 팀장이 승인한 구현 차이 반영, `desktop/` 코드와 `deploy/server-pc/common.ps1` · `update.ps1`을 읽어 사실 확인한 뒤 고침)**: ① preload는 `preload/preload.js` 하나(출처에 따라 `paperlabDesktop` 또는 `paperlabLocal`), 경계는 main의 IPC 출처 검사(13.1 · 13.3절) ② 13.2.1절 7번 "요청한 프레임을 아는 방법"은 **대안으로 해결**(20.3절) ③ 서버 주소는 `deploy/server-pc/server.json`의 `public_url`을 빌드 때 `extraMetadata.paperlabServer`로 넣음 — `desktop/app-config.json` 없음(13.5 · 21장) ④ 설정 파일 `electron-builder.config.js`를 `--config`로 지정, `update.ps1`은 `npm run dist`를 부르고 빌드 함수는 `common.ps1`, `install.ps1`은 바뀌지 않음, releases 폴더 결정 순서(13.7.1절 "2b 확인 필요"는 **해결**) ⑤ 모델을 대체해 실행해도 결과 글에 문구를 붙이지 않음(11.6절) ⑥ codex · gemini 시스템 프롬프트는 stdin 앞에 붙임(11.4절) ⑦ gemini 로그인 판정(11.4 · 11.8절) ⑧ claude 2.1.259 미만 처리(11.7절) ⑨ 일시 중지 중 claim · bye(8.4 · 8.7절) ⑩ 연결 전 엔진 탐지(11.7절) ⑪ 401이면 토큰 삭제(12.4절) ⑫ 딥링크 콜백 전달(13.4절) ⑬ Fuses(13.2절) ⑭ 개발 실행 데이터 폴더 · 트레이 알림 · 임시 아이콘(13.1 · 13.5절) ⑮ OneDrive 폴더 EPERM(14장). 바뀐 곳: 8.4 · 8.7 · 11.4 · 11.6~11.8 · 12.4 · 13.1~13.7.1 · 14 · 20.3 · 21장.
- 앞 단계: [1단계 명세](phase1-cloud.md) (인증 · RLS · 서버 구조 · 요약 SSE 9.3절 · 19장 결정)
- 표기: **확정** = 사용자 결정(PLAN 2장), **팀장 결정** = 팀장이 정함(사용자 이견 시 변경), **기획팀 추천** = 선택지 중 기획팀 안(팀장 결정 전 — 20.2절 질문 번호 `K…`), **가정** = 기획팀이 임시로 정한 값, **미정** = 사용자 확인 필요(20.1절 질문 번호 `U…`), **확인 필요** = 외부 사실을 공식 문서로 다 확인하지 못함(개발팀이 첫 작업 때 확인하고 이 문서를 고침)
- 비밀값: 이 문서는 변수 **이름만** 씁니다. 기기 토큰 · API 키 · 배포 주소는 어떤 문서 · 코드 · 로그 · 커밋에도 쓰지 않습니다(1단계 AC-69와 같은 원칙).

---

## 1. 목적

1. AI 작업(요약 · 논문과 대화 · 글쓰기 도우미, 뒤 단계의 번역 · 설명 등)을 **작업 큐(`jobs`)** 위에서 돌립니다.
2. 사용자별 **API 키 우선 → 실패 시 CLI 폴백, 키가 없으면 CLI만**(확정) 규칙과 **작업별 엔진 목록**(P8)을 적용합니다.
3. CLI(claude · codex · gemini)는 각 사용자 PC의 **계정별 CLI 워커**가 클라우드 큐에서 작업을 가져가 실행합니다(확정). 여러 PC가 켜져 있으면 **먼저 잡는 PC**가 실행하고, 하트비트가 끊기면 다른 PC로 재할당합니다(확정).
4. 다른 사용자 PC용 **Windows Electron 설치형 앱**(앱 창 = 클라우드 화면 + CLI 워커, 6단계에 폴더 동기화 추가)을 만들고 **서버 PC가 직접 빌드 · 배포(`/downloads/`) + 자동 업데이트**합니다(확정 — U10 변경 2026-10-07, 개정 전: GitHub Releases. 코드 서명 없음 → SmartScreen 경고 안내).

PLAN 2단계 완료 기준(그대로 수용 기준에 들어감 — 17장): 키 있는 사용자는 **각자의 PC를 꺼도(서버 PC는 켜져 있음)** 요약이 되고 탭을 닫아도 계속됨 · 서버를 다시 시작해도 진행 중이던 API 요약이 이어서 끝남 · 키를 틀리게 넣으면 CLI로 넘어가 PC에서 실행됨 · PC 두 대를 켜면 한 대만 작업을 잡음 · 실행 중인 PC를 끄면 하트비트 시간 뒤 다른 PC가 이어받음 · codex가 없는 PC는 codex 작업을 잡지 않음 · 다른 사용자의 작업은 절대 받지 않음 · 해지한 기기 토큰으로는 작업을 받지 못함 · 워커 PC에 DB 접속 정보가 없음 · **서버 PC가 내려주는 설치 파일**(`/downloads/`)로 설치되고 앱 창에서 로그인해 서재가 보임 · **새 앱 버전을 서버 PC에 반영(`update.ps1`)하면** 설치된 앱이 자동으로 업데이트됨. (개정 2026-10-07 U10: 개정 전 "GitHub Releases에서 받은 설치 파일 · 새 릴리스를 올리면")

## 2. 범위

### 하는 것
1. **작업 큐**: `jobs` 표 · 상태 기계 · 원자적 잡기(`FOR UPDATE SKIP LOCKED`) · 리스 · 하트비트 · 재할당 · 재시도 · 취소 · 결과 반영 · 정리(5 · 6장).
2. **기기**: `devices` · `device_pair_codes` 표, "이 PC 연결" 코드 발급 · 교환 · 기기 토큰 · 해지 · 목록(5 · 12장).
3. **서버 API**: 사용자용(작업 만들기 · 조회 · 취소 · 다시 시도 · 기기 관리 · 엔진 설정) · 워커용(연결 · 인사 · 잡기 · 하트비트 · 결과)(7 · 8장).
4. **엔진 라우팅(④)**: 작업 종류별 엔진 목록, API 우선 → CLI 폴백, 실패 판정, 설정 화면(9장).
5. **워커 알림(P2)**: 기획팀 추천 = 적응형 폴링 + 앱 창 로컬 신호(10장).
6. **CLI 실행기**: claude · codex · gemini 비대화형 호출, stdin 프롬프트, 시간 제한, 동시 실행 수, Windows 실행 파일 · 인코딩, 로그인 안 됨 감지, 모델 지정 문제 해결(11장).
7. **Electron 앱**: 앱 창 · 워커 · 트레이 · 자동 시작 · 보안 설정 · 구글 로그인 처리 · 외부 링크(1A 학교 · Scholar 링크 포함)를 시스템 브라우저로 열기(13.2.1절) · 설치(NSIS) · 자동 업데이트 · 로그(13장), 빌드 · 릴리스 절차(14장). **서버 PC 배포**(U10 변경): `update.ps1`의 설치 파일 빌드 단계, 서버의 `/downloads/` 내려주기 · `GET /api/desktop/release`(13.7.1절).
8. **요약을 작업 큐로**(9.3절 1단계 SSE 대체 — 15장), 대화 · 글쓰기 도우미의 CLI 경로.
9. **화면 변경**(16장, 디자인팀 목록).
10. 알려진 문제 해결(PLAN 9장): CLI가 `claude-opus-5-5`를 모르는 문제(`unrecognized_model` — 11.6절, 2단계 확인 항목). (Windows에서 실제 CLI를 부르던 테스트는 2026-10-07 해결 — 가짜 CLI만 씀)

### 안 하는 것
- 폴더 동기화(6단계 — 같은 앱에 추가), RAG · 인용 검증(3단계), 쉬운 설명 · 번역 · codex 이미지 생성(4단계). 단, 작업 종류(`kind`)는 늘릴 수 있게 만듭니다.
- macOS · Linux 앱, 코드 서명, Microsoft Store 배포.
- 한 PC에서 **여러 계정의 작업을 동시에** 받기(기기 하나 = 계정 하나), 다른 사용자의 작업을 내 PC가 실행하기(확정 — 자기 계정 작업만).
- CLI 세션 이어가기(`--resume`), CLI의 도구(파일 읽기 · 셸) · MCP 사용 — 2단계 CLI는 **도구 없이 텍스트 생성만**(11.4절).
- 실시간 공동 편집, 푸시 알림(Windows 알림 센터) — 앱 트레이 알림 정도만(13.6절).
- OpenAI · Google API로 **PDF 원본** 보내기(이 두 API는 본문 텍스트만 — 9.5절. 키 받기 · 텍스트 실행은 확정 U2로 2단계에 함).

### 뒤 단계를 막지 않기 위한 장치
| 뒤 단계 | 2단계에서 해 두는 것 |
|---|---|
| 3 RAG · 인용 검증 | `jobs.kind`는 문자열(검사 제약에 종류를 추가하는 마이그레이션만 필요), 작업 결과 반영 함수를 종류별 등록표로 |
| 4 전체 번역(쪽 단위 병렬) | `jobs.parent_id`(묶음 작업), 같은 사용자의 여러 작업을 여러 PC가 나눠 잡을 수 있는 구조, 큰 결과는 R2 키로 보고하는 자리 — `jobs.result_key text null` 열을 **2a 마이그레이션에 미리 넣어 둠**(2b · 4단계가 마이그레이션을 다시 건드리지 않게). **예약 열** — 2b 워커도 쓰지 않음(큰 결과는 4단계), 2단계 코드는 이 열을 읽지도 쓰지도 않아 늘 null |
| 4 codex 이미지 | 엔진 목록 · CLI 실행기가 codex를 이미 다룸, 결과 파일은 R2 서명 PUT 주소로 올리는 확장 자리 |
| 6 폴더 동기화 | Electron 앱 구조에 "기능 모듈" 자리(워커 · 동기화), 기기 토큰을 동기화도 같이 씀, `devices`에 기능 광고(`features`) 열 |

## 3. 지금 코드 (바뀌는 지점)

| 위치 | 지금(1단계) | 2단계 |
|---|---|---|
| `paperlab/ai.py` `AIService._run_cli` | 서버 안에서 `claude -p`를 직접 실행(클라우드는 `cli_enabled=False`라 막힘). `--model`에 설정의 API 모델 id를 그대로 넘김(450~452행). `--system-prompt <여러 줄>`을 **명령줄 인자**로 넘김 | **서버는 CLI를 실행하지 않습니다.** CLI용 요청(시스템 프롬프트 · 프롬프트 · 출력 형식)을 **만드는 함수**와 워커가 올린 원문을 **해석하는 함수**(`normalize_summary` · `cli_citations` 재사용)로 나눕니다. 실행은 워커(11장). 모델은 별칭 매핑(11.6절) |
| `ai.py` `AIService.engine` · `status()` | 설정 `ai_engine`(`api`만) | `ai_engine` 대신 **작업별 엔진 목록 + API 키 유무 + 켜진 PC**로 경로를 정함(9장). `status()`는 "이 작업을 지금 어떤 경로로 돌릴 수 있는지"를 돌려줌 |
| `paperlab/config.py` `DEFAULT_SETTINGS` · `split_settings_changes` | `ai_engine: "cli"` → 400 | `ai_engine`은 **읽기만 하고 무시**(화면 호환, 가정). 새 설정 키 `ai_routing` · `cli_models` · `api_models`, **새 비밀 키 `openai_api_key` · `google_api_key`**(U2 확정 — 세 회사 모두) — 9.4절 |
| `paperlab/server.py` `POST /api/papers/{pid}/summary` | SSE 스트림(탭을 닫으면 멈춤, 1단계 9.3절 ②) | **작업 만들기**로 바꿈 → `202 {job}`(15장). 화면은 작업 진행을 따라감 |
| `server.py` `POST /api/papers/{pid}/chat` · `POST /api/ai/write` | API SSE만 | 첫 경로가 API면 지금 SSE 그대로, CLI면 SSE가 `{"type":"queued","job_id"}` 하나를 보내고 끝남 → 화면이 작업을 따라감. API가 폴백 대상 오류로 실패하면 `{"type":"fallback","job_id"}`(9.3절) |
| `server.py` 보안 미들웨어 | `/api/*`는 Supabase JWT 필수 | `/api/worker/*`는 **기기 토큰** 인증(8.1절). 나머지는 그대로. (개정: `/internal/tasks/*` Cloud Tasks 경로는 **만들지 않음** — API 실행기는 서버 프로세스 안, 15장) |
| `paperlab/serve.py` (1단계 서버 PC 진입점) | uvicorn 실행 | 시작 때 **API 실행기**(백그라운드 스레드)와 복구 스캔을 함께 시작, 종료 때 정리(15.2절) |
| `paperlab/db.py` `Database.user_tx(claims)` | 검증된 Supabase JWT claims만 | 워커 · 작업 실행기용 **서버가 만든 claims**(`actor_claims`) 경로 하나 추가(5.5절). 연결 도우미 단일 경로 원칙(1단계 AC-13) 유지 |
| `tests/test_ai.py::test_cli_engine_with_fake_claude` | Windows에서도 가짜 CLI로 통과(2026-10-07 해결 — 실제 CLI 호출 차단 단언) | 2단계에서 서버 CLI 실행을 없애면서 서버 쪽은 "요청 만들기 · 결과 해석" 단위 테스트로 바꾸고, 실제 실행은 Node 워커 테스트(가짜 CLI)로 — Windows에서 돎(AC-60) |
| `static/js/dialogs.js` 설정 창 | "Claude CLI" 선택지 비활성 + "2단계 뒤" 안내 | "작업별 엔진" · "연결된 PC" · API 키(추가 회사) 구역(16장) |
| `static/js/reader.js` 요약 | SSE 진행 막대 + "이 탭을 닫으면 요약이 멈춰요" | 작업 진행 표시(대기 · PC에서 실행 · 완료 · 실패), 탭을 닫아도 계속(15장) |
| (없음) `desktop/` | — | **신규** Electron 앱(13장) |
| `supabase/migrations/` | 1단계 표 | `devices` · `device_pair_codes` · `jobs` 표 + RLS(5장) — 새 마이그레이션 파일 |

## 4. 전체 흐름

```
 브라우저 / Electron 앱 창(클라우드 화면)            사용자 PC: Electron 앱의 워커 (여러 대)
   │ ① POST /api/papers/7/summary (JWT)               │  기기 토큰("이 PC 연결"로 받음)
   ▼                                                  │  ④ POST /api/worker/claim  (바깥으로만, 적응형 폴링)
 서버 PC: PaperLab 서버 (FastAPI, Funnel 뒤)          ▼
   ├ ② 경로 정하기: [claude] + API 키 있음?          PaperLab 서버
   │     ├ 있음 → jobs(runner=api) → 서버 프로세스 안 API 실행기(15.2절)   ├ ⑤ 기기 토큰 → user_id 범위 트랜잭션
   │     │     └ 키 오류 · 한도 · 서버 오류 → runner=cli 로 같은 작업을 다시 대기열에 (폴백)
   │     └ 없음 → jobs(runner=cli, engine=claude, status=queued)
   │                                                  ├ ⑥ FOR UPDATE SKIP LOCKED 로 1건 잠금 + 리스 90초
   │ ③ 화면: GET /api/jobs/{id} 로 진행 따라가기       │     → 프롬프트를 이때 만들어 워커에 줌
   │      "대기 중 — 켜진 PC 없음" / "집 PC에서 실행 중"│
   │                                                  │  ⑦ 워커: claude -p (stdin 프롬프트, 도구 끔, 빈 임시 폴더)
   │                                                  │     30초마다 heartbeat (진행 · 취소 확인)
   │                                                  │  ⑧ POST /api/worker/jobs/{id}/result (리스 토큰)
   │                                                  ├ ⑨ 리스 토큰이 맞을 때만 결과 반영(ai_summaries 저장) — 한 번만
   ◀──────────── ⑩ 화면이 완료를 보고 요약 표시 ────────┘
```

- 워커는 **PaperLab 서버(공개 주소 `https://kimjuhyeon.tailac17f6.ts.net`)로만** 연결합니다(워커 PC에 포트를 열지 않음, DB에 직접 붙지 않음 — 확정 · 팀장 결정). DB 접속 정보 · Supabase 비밀 키 · R2 키는 워커 PC에 없습니다(AC-80). **서버 PC에는 워커를 두지 않습니다**(사용자 결정 Q-S3, 2026-10-07 — 13.9절). 서버 PC는 서버 · API 실행기 · **앱 설치 파일 빌드 · 배포**(13.7.1절)만 맡습니다.
- 프롬프트(논문 본문 포함)는 **잡는 순간 서버가 만들어** 워커에 넘기고 DB에 저장하지 않습니다(DB 용량 · 개인 데이터 최소화 — 기획팀 추천 K16). 워커는 실행 뒤 임시 폴더를 지웁니다(PLAN 5장 보안).

---

## 5. 데이터

모든 표는 `paperlab` 스키마, 1단계 규칙 그대로(`bigint identity` id, 공통 `user_id` + 복합 외래 키, `timestamptz`, `jsonb`, **같은 마이그레이션 파일 안에서 RLS + 정책** — 1단계 5.3 · 5.6절, AC-20이 새 표도 자동으로 검사). 마이그레이션 파일 이름은 개발팀 재량(예: `supabase/migrations/20261009000001_devices_jobs.sql`).

### 5.1 `devices` — 연결된 PC

| 열 | 형 | 비고 |
|---|---|---|
| `id` | bigint identity PK | `unique (id, user_id)` |
| 공통 `user_id` | | |
| `name` | text not null | 1~60자, 제어 문자 금지. 기본값 = Windows 컴퓨터 이름(워커가 보냄), 화면에서 바꿈 |
| `token_hash` | text not null unique | 기기 토큰 비밀 부분의 SHA-256(16진). **원문은 저장하지 않음** |
| `engines` | jsonb not null default '[]' | 워커가 광고한 엔진: `[{"name":"claude","version":"2.1.269","logged_in":true,"slots":2}]`(11.7절) |
| `features` | jsonb not null default '["worker"]' | 6단계에 `"sync"` 추가 자리 |
| `app_version` | text not null default '' | Electron 앱 버전 |
| `os` | text not null default '' | 예: `Windows 11 10.0.26200`(표시용) |
| `last_seen_at` | timestamptz null | 워커 요청 때 갱신 — **50초에 한 번까지만 씀**(쓰기 줄이기) |
| `paused` | boolean not null default false | 사용자가 트레이에서 "작업 받지 않기"를 켰는지(워커가 보고) |
| `revoked_at` | timestamptz null | 해지 시각. 해지된 행은 지우지 않고 목록에 "해지됨"으로 30일 보이다가 정리(가정) |
| `created_at`, `updated_at` | | |

색인: `(user_id, revoked_at)`. 사용자당 활성 기기 **10대** 제한(가정 — 넘으면 400 "연결된 PC가 너무 많아요. 쓰지 않는 PC를 해지해 주세요").
**온라인 판정**: `revoked_at is null and last_seen_at > now() - interval '3 minutes'`(가정 — 쉬는 동안 폴링 간격 60초의 3배).

### 5.2 `device_pair_codes` — "이 PC 연결" 코드

| 열 | 형 | 비고 |
|---|---|---|
| `id` | bigint identity PK | |
| 공통 `user_id` | | |
| `code_hash` | text not null unique | 코드(대시 제거 · 대문자)의 SHA-256 |
| `expires_at` | timestamptz not null | 만든 뒤 **10분**(가정) |
| `used_at` | timestamptz null | 한 번 쓰면 끝 |
| `device_id` | bigint null | 이 코드로 만든 기기(복합 FK, `on delete set null (device_id)`) |
| `created_at` | | |

사용자당 유효한(안 쓴 · 안 지난) 코드는 **하나만**: 새로 만들면 이전 코드는 `expires_at = now()`로 끝냄. 지난 코드는 정리 작업(6.8절)이 지움.

### 5.3 `jobs` — 작업 큐

| 열 | 형 | 비고 |
|---|---|---|
| `id` | bigint identity PK | `unique (id, user_id)` |
| 공통 `user_id` | | |
| `kind` | text not null | `summary` · `chat` · `write`(2단계). `check (kind in (…))` — 뒤 단계가 마이그레이션으로 추가 |
| `status` | text not null | `queued` · `running` · `succeeded` · `failed` · `cancelled`(6.1절) |
| `runner` | text not null | 지금 맡은 경로 `api` · `cli` |
| `engine` | text not null | `claude` · `codex` · `gemini` |
| `route` | jsonb not null | 이 작업이 시도할 **경로 목록**(만들 때 고정): `[{"runner":"api","engine":"claude"},{"runner":"cli","engine":"claude"}]`, `route_index int`가 지금 위치 |
| `route_index` | integer not null default 0 | |
| `params` | jsonb not null default '{}' | 종류별 입력 값만(예: chat `{"question": "…"}`, write `{"mode","text","instruction","context","keys","manuscript_id"}` — `manuscript_id`는 7장 `manuscript_title` 조회용, 팀장 결정 2026-10-08). **논문 본문 · 프롬프트는 넣지 않음**(잡을 때 만듦). 최대 64KB(서버 검사) |
| `paper_id` | bigint null | `(paper_id, user_id) references papers(id, user_id) on delete cascade` — 논문을 지우면 작업도 지움 |
| `parent_id` | bigint null | 4단계 묶음 작업 자리(2단계는 늘 null) |
| `device_id` | bigint null | 지금(또는 마지막으로) 맡은 PC. `(device_id, user_id) references devices(id, user_id) on delete set null (device_id)` |
| `lease_token` | uuid null | 잡을 때마다 새로 발급. 하트비트 · 결과는 이 값이 맞아야 받음(펜싱) |
| `lease_until` | timestamptz null | 리스 만료 시각 |
| `leased_at` | timestamptz null | **이번 잡기 시각**(팀장 승인 2026-10-08). CLI 잡기 · API 실행기 잡기 · 대화/글쓰기 SSE 작업 만들기 때마다 `now()`로 덮어씀(`started_at`은 첫 잡기 때만). 대기로 돌아가도 지우지 않고 다음 잡기 때 덮어씀. **서버 쪽 절대 기한**(6.3 · 11.5절)의 기준 |
| `attempts` | integer not null default 0 | CLI 잡기 횟수(재할당 포함) |
| `max_attempts` | integer not null default 3 | 가정(K6) |
| `excluded_devices` | jsonb not null default '[]' | 이 작업을 다시 잡지 않을 기기 id(로그인 안 됨 · 엔진 없음으로 실패한 PC) |
| `cancel_requested` | boolean not null default false | |
| `progress` | jsonb not null default '{}' | `{"message":"…","fraction":0.4|null,"partial_text":"…"}` — `partial_text`는 대화 · 글쓰기의 중간 글, **최대 64KB**(넘으면 뒤만 남김) |
| `interactive` | boolean not null default false | **요청 안 SSE에서 시작한 대화 · 글쓰기 API 작업 표시**(팀장 승인 2026-10-08, 2a 품질 수정). `true`인 `running` 작업은 리스가 지나도 **다시 실행하지 않고** `cancelled`(`error_code = "interrupted"`, "화면 연결이 끊겨 멈췄어요")로 끝남(6.3절). 폴백으로 다음 경로 칸에 넘어가면 `false`로 풀려 보통의 백그라운드 작업이 됨 |
| `result_key` | text null | 4단계 큰 결과의 R2 키 자리 — **2b 대비로 2a 마이그레이션에 포함**. 2단계 코드는 쓰지 않음(늘 null) |
| `result` | jsonb null | 반영한 뒤 **요약은 null로 비움**(본 데이터는 `ai_summaries`), 대화는 `{"message_id"}`만, 글쓰기는 `{"text"}`를 **24시간** 보관 후 비움(6.8절) |
| `error_code` | text not null default '' | 9.6절 · 11.8절 코드 |
| `error` | text not null default '' | 화면에 보일 문구(최대 2,000자, 키 · 토큰 지움) |
| `history` | jsonb not null default '[]' | 경로 시도 기록 `[{"runner","engine","device_id","error_code","at"}]` — 최대 20개 |
| `not_before` | timestamptz not null default now() | 다시 시도 대기(백오프) |
| `deadline_at` | timestamptz null | CLI 대기 기한. 이 시각이 지나도 `runner = cli`로 `queued`면 실패 처리(6.6절, U7). **작업을 만들 때 `now() + 종류별 기한`으로 정하고**, API 칸이 실패해 **CLI 칸으로 넘어갈 때 그 시각부터 다시 셈**(6.6절) |
| `created_at`, `started_at`, `finished_at`, `updated_at` | | `started_at`은 첫 잡기 때 |

색인:
- 잡기용: `(user_id, runner, status, not_before, id) where status in ('queued','running')`
- 화면 목록용: `(user_id, created_at desc)`, `(user_id, paper_id, kind)`
- **같은 논문 요약은 한 번에 하나**: `unique (user_id, paper_id, kind) where kind = 'summary' and status in ('queued','running')` — 두 번 누르면 기존 작업을 돌려줌(7.1절).

사용자당 **진행 중(`queued` + `running`) 작업 30개** 제한(가정 — 넘으면 429 "작업이 너무 많아요. 잠시 후 다시 해 주세요").

### 5.4 RLS

세 표 모두 1단계 틀 그대로: `enable` + `force row level security`, `own_rows` 정책(`(select auth.uid()) = user_id`, `to authenticated`), 권한은 `authenticated`에만. 화면 · 워커 · 실행기 **모든 경로가 사용자 권한 트랜잭션**으로 이 표를 읽고 씁니다. 예외는 **기기 연결 코드 교환 한 곳**(5.6절).

### 5.5 워커 · 실행기의 사용자 권한 트랜잭션 (`actor_claims`)

워커 요청에는 Supabase JWT가 없습니다. 서버는 기기 토큰을 확인한 뒤 **서버가 만든 claims**로 `user_tx`를 엽니다.

- 함수 하나(`db.actor_claims(uid, actor)` — 이름은 개발팀 재량)만 이 claims를 만듭니다: `{"sub": uid, "role": "authenticated", "aud": "authenticated", "paperlab_actor": "device:12" | "api-runner"}`. **이 함수 밖에서 claims 사전을 손으로 만드는 코드 금지**(AC-24 코드 검사).
- `uid`의 출처는 둘뿐: (1) 기기 토큰 안의 uid를 **그 uid 범위 트랜잭션에서 `devices.token_hash`와 상수 시간 비교로 확인**한 뒤(8.1절), (2) **API 실행기**(15.2절)가 받은 `(job_id, user_id)` — 그 사용자가 작업을 만든 요청(검증된 JWT)에서 메모리 대기열로 넘어온 값이거나, 복구 스캔(`system_tx("api job recovery")`)이 `jobs` 행에서 읽은 값. (개정 전: Cloud Tasks 요청의 서명 확인을 통과한 본문)
- 허용 목록 이중 확인(1단계 6.3절 ③)도 그대로 — 단 **`PAPERLAB_ALLOWLIST`가 `off`가 아닐 때만**(운영은 off — 1단계 Q16): 워커 요청 때 그 사용자의 `profiles.email`이 `ALLOWED_EMAILS`에 없으면 403 `not_allowed`(AC-21). off일 때 사람을 막으려면 그 사용자의 기기를 해지하고 Supabase 사용자를 지움(관리자).

### 5.6 관리 권한(service role) 새 사용처

1단계 20장 "관리 권한 사용처" 표에 다음 **두 줄만** 추가합니다(이 밖의 사용은 명세 개정 필요 — 개정: 두 번째 줄은 K2' 서버 프로세스 안 실행기 때문에 추가).

| 사용처 | 방식 | reason(로그) |
|---|---|---|
| `POST /api/worker/pair` 코드 교환 | `system_tx` — 코드 해시로 `device_pair_codes` 한 행 찾기(누구 코드인지 모르는 상태라 사용자 범위로 찾을 수 없음). 찾은 뒤 기기 행 만들기는 **그 사용자 `actor_claims` 트랜잭션**으로 | `device pairing` |
| API 실행기 복구 스캔(서버 시작 때 · 60초마다 — 15.2절, **K2' 개정으로 추가**) | `system_tx` — `jobs`에서 `runner = 'api'`이고 (`queued` 또는 리스가 지난 `running`)인 행의 **`id` · `user_id`만** 최대 100개 읽기(다른 열 · 다른 표는 읽지 않음, 쓰지 않음). 실제 잡기 · 실행 · 반영은 그 사용자 `actor_claims` 트랜잭션 | `api job recovery` |

기기 토큰 확인은 토큰에 uid를 넣어(8.1절) **service role 없이** 합니다(기획팀 추천 K5). K5를 "토큰에 uid 없음"으로 정하면 매 워커 요청이 `system_tx("device auth")`를 쓰게 되어 이 표에 한 줄이 더 붙습니다.

---

## 6. 작업 큐 동작

### 6.1 상태 기계

```
            만들기(경로 첫 칸)
                 │
                 ▼
   ┌────────── queued ◀───────────────────────────────┐
   │  (runner=api|cli)  │                              │
   │ 취소               │ 잡기(api: 실행기 / cli: 워커)  │ 리스 만료(attempts < max) · 폴백(다음 경로 칸)
   ▼                    ▼                              │ · 이 PC 로그인 안 됨(다른 PC가 잡게)
cancelled ◀─ 취소 ── running ──────────────────────────┘
                        │  │
              성공 결과  │  │ 폴백 불가 오류 · 경로 끝 · attempts 다 씀 · deadline 지남
                        ▼  ▼
                 succeeded  failed
```

| 바뀜 | 조건 | 누가 |
|---|---|---|
| (새) → `queued` | 작업 만들기. `runner`/`engine` = `route[0]` | 서버(사용자 요청) |
| `queued` → `running` | 잡기(6.2절). `lease_token` 새로, `lease_until = now() + 리스`, `leased_at = now()`, cli면 `attempts + 1` · `device_id` | 서버(워커 claim / API 실행기) |
| `running` → `running` | 하트비트: 같은 `lease_token`이면 `lease_until` 연장 · `progress` 갱신 | 서버(heartbeat) |
| `running` → `succeeded` | 결과 올림 + 같은 `lease_token` + 반영 성공(6.4절) | 서버(result) |
| `running` → `queued` (다음 경로) | 폴백 대상 오류(9.6절) + `route`에 다음 칸이 있음 → `route_index + 1`, `runner`/`engine` 바꿈, `history`에 기록 | 서버 |
| `running` → `queued` (같은 경로) | 이 PC가 **로그인 안 됨 · 엔진 없음**(11.8절) → 그 기기를 `excluded_devices`에 넣고 다시 대기. **단 `cancel_requested`이면 다시 대기하지 않고 `cancelled`로 끝**(2a 품질 수정) | 서버 |
| `running` → `queued` (기기 해지) | 사용자가 그 기기를 해지(12.4절) → `device_id`를 비우고 다시 대기. **단 `cancel_requested`이면 다시 대기하지 않고 `cancelled`로 끝**(2a 품질 수정) | 서버 |
| `running`(`interactive`, 리스 지남) → `cancelled` | SSE에서 시작한 대화 · 글쓰기 API 작업은 **다시 실행하지 않음** → `cancelled` · `error_code = "interrupted"`(6.3절). 처리 시점: 그 사용자의 잡기 · 조회 · 목록 요청의 `jobs.expire`, 또는 API 실행기가 잡으려 할 때(`claim_api`) | 서버 |
| `running`(리스 지남) → `queued` | 다음 잡기 · 조회 때 발견(6.3절), `attempts < max_attempts` | 서버 |
| `running`(리스 지남) → `failed` | `attempts >= max_attempts` → `error_code = "lease_exhausted"`, "PC 연결이 계속 끊겨서 멈췄어요" | 서버 |
| `queued` → `cancelled` | 사용자 취소 | 서버 |
| `running` → `cancelled` | 사용자 취소 → `cancel_requested = true` → 워커가 하트비트 응답에서 보고 프로세스를 끄고 `cancelled` 보고. 워커가 응답이 없으면 리스가 지날 때 `cancelled`(다시 대기로 가지 않음) | 서버 · 워커 |
| `queued` → `failed` | `runner = cli`이고 `deadline_at` 지남(켜진 PC가 없어 오래 대기 — U7). `runner = api`로 대기 중인 작업은 이 규칙의 대상이 아님(구현) | 서버(정리 6.8절) |

`succeeded` · `failed` · `cancelled`는 끝 상태 — 다시 바뀌지 않습니다(다시 시도는 **새 작업**, 7.1절).

### 6.2 잡기 (CLI 워커)

서버가 그 기기 사용자의 `actor_claims` 트랜잭션 안에서 한 문장으로 잠그고 바꿉니다(기획팀 안 — 개발팀이 실제 질의 확정).

```sql
with c as (
  select id from paperlab.jobs
   where user_id = %(uid)s
     and runner = 'cli'
     and engine = any(%(free_engines)s)               -- 이 PC에 빈 자리가 있는 엔진만
     and not (excluded_devices @> to_jsonb(%(device_id)s::bigint))
     and not_before <= now()
     and (status = 'queued'
          or (status = 'running' and lease_until < now() and not cancel_requested))  -- 리스 만료 재할당
   order by created_at, id
   for update skip locked
   limit 1)
update paperlab.jobs j
   set status = 'running', device_id = %(device_id)s, lease_token = gen_random_uuid(),
       lease_until = now() + interval '90 seconds', attempts = j.attempts + 1,
       started_at = coalesce(j.started_at, now()), updated_at = now()
  from c where j.id = c.id
returning j.*;
```

- **구현(2a)과의 차이**: 실제 질의(`jobs.claim_cli`)는 `status = 'queued'` 행만 잡습니다(위 SQL의 `or (status = 'running' and lease_until < now() …)` 줄 없음). 리스가 지난 `running`은 같은 요청 안에서 **잡기 전에** `jobs.expire`가 먼저 `queued`(또는 `cancelled` · `lease_exhausted`)로 바꾸므로 결과는 같음. 잡을 때 `leased_at = now()`, `progress = '{}'`도 함께 씀. `free_engines`는 요청의 `free`에서 자리가 1 이상이고 **그 기기가 `logged_in: true`로 광고한** 엔진.
- **먼저 잡는 PC가 실행**(확정): 두 PC가 동시에 잡아도 `FOR UPDATE SKIP LOCKED` 때문에 한 행은 한 트랜잭션만 잠그고 바꿉니다(AC-07).
- 리스 만료 재할당 행이 `attempts >= max_attempts`면 잡지 않고 같은 트랜잭션에서 `failed`로 바꿉니다(위 질의 앞에 정리 문장 — 6.3절).
- 워커는 한 번에 **1건**씩 잡습니다(빈 자리가 여럿이면 연달아 요청).
- **응답에 실행 내용을 담습니다**: 잡은 직후 같은 요청 안에서 서버가 그 작업의 프롬프트를 만들어(논문 본문은 DB `page_texts`에서) 함께 돌려줍니다(8.4절). 프롬프트를 만드는 동안 DB 트랜잭션은 커밋해 연결을 돌려줍니다(1단계 F9 원칙).
- 잡은 PC가 **paused**면 잡기 요청 자체를 하지 않습니다(워커 쪽 규칙).

### 6.3 리스 · 하트비트 · 재할당 (가정 — K6)

| 값 | 가정 | 근거 |
|---|---|---|
| 리스 길이 | **90초** | 하트비트 3번을 놓쳐야 만료 — 잠깐의 네트워크 끊김은 견딤 |
| 하트비트 주기 | **30초**(실행 중인 작업마다, 한 요청에 묶어 보냄 — 8.5절) | 서버 요청 수 · DB 쓰기 최소(개정 전 근거: Cloud Run 요청 수) |
| 최대 잡기 횟수 | **3**(첫 실행 + 재할당 2번) | PC가 계속 꺼지는 경우 무한 반복 방지 |
| 재할당 대기 | 리스 만료 즉시(다른 PC가 다음 폴링에서 잡음) | |

- CLI 작업의 만료 검사는 지금처럼 **잡기 · 작업 조회 · 목록 요청 때 그 사용자 범위에서** 합니다(원래 근거였던 Cloud Run 최소 인스턴스 0은 없어졌지만, 사용자 범위 처리가 RLS 원칙에 맞고 관리 권한 사용을 늘리지 않으므로 유지 — 기획팀 추천). 화면이 작업을 보고 있으면 화면 조회가 만료를 처리합니다. **API 작업**은 서버 프로세스 안 실행기의 복구 스캔(60초)이 처리합니다(15.2절).
- **두 번 실행돼도 결과는 한 번만**(확정 원칙): 재할당되면 `lease_token`이 바뀌므로 늦게 끝난 옛 PC의 결과는 409 `lease_lost`로 버려집니다(AC-10). 옛 PC는 409를 받으면 조용히 끝냅니다(로그만).
- Windows 절전: 실행 중에는 앱이 `powerSaveBlocker('prevent-app-suspension')`로 절전을 늦춥니다(13.5절). 그래도 절전 · 강제 종료되면 리스 만료로 다른 PC가 이어받습니다.
- **서버 쪽 절대 기한**(팀장 승인 2026-10-08, 11.5절): 리스는 **이번 잡은 시각(`leased_at`) + 그 작업의 시간 제한 + 5분(300초)까지만** 연장합니다 — 요약 1,200 + 300 = 1,500초, 대화 · 글쓰기 600 + 300 = 900초. 이 시각이 지난 뒤의 CLI 하트비트는 리스를 늘리지 않고 그 항목이 `ok: false, code: "lease_lost"`로 돌아옵니다(8.5절). 이미 정해진 `lease_until`이 지나면 그다음 잡기 · 조회 때 보통의 리스 만료와 똑같이 처리(6.1절). 구현은 CLI 하트비트(`jobs.touch_lease(renew=True, timeout_s=…)`)에만 이 상한을 겁니다 — 진행만 저장하는 호출과 **API 실행기의 30초 리스 연장(15.2절)에는 이 상한이 없음**.
- **대화 · 글쓰기 SSE 작업(`interactive`)의 리스 — 결정(팀장 승인 2026-10-08, 2a 품질 수정. 개정 전 "660초 리스 영향 미정"을 이 결정으로 바꿈)**: 첫 경로 칸이 API인 대화 · 글쓰기는 요청 안 SSE가 작업을 만드는 순간 `running`(`attempts = 1`, `leased_at = started_at = now()`, `lease_token` 발급, **`interactive = true`**)으로 두고, `lease_until = now() + 660초`로 **한 번 정해 고정**합니다(660 = 서버 상수 `TEXT_API_TIMEOUT` 600초 + 60초). 이 경로에는 위 표의 90초 · 30초 하트비트가 적용되지 않습니다: SSE 처리기는 리스를 연장하지 않고(`touch_lease` 호출 없음), API 실행기의 30초 연장 루프도 이 작업을 대상으로 삼지 않습니다(실행기 `running` 목록에 없음). 결과 반영(`jobs.lock_leased`)은 `lease_token`과 `status = 'running'`만 보고 `lease_until`은 보지 않습니다. 규칙:
  1. **리스가 지난 `interactive` 작업은 다시 실행하지 않고 `cancelled`(`error_code = "interrupted"`, "화면 연결이 끊겨 멈췄어요")로 끝냅니다.** 15.2절 복구 스캔이 이 행을 대기열에 넣어도 `claim_api`가 `interactive`를 먼저 보고 취소로 끝낼 뿐 잡지 않으며, `jobs.expire`(그 사용자의 잡기 · 조회 · 목록 요청)도 같은 조건(`interactive`이고 `running`이며 `lease_until < now()`)으로 끝냅니다. 요청 안에서 사라진 스트림은 다시 이을 수 없으므로 "다시 실행"이 의미가 없기 때문입니다. 요약처럼 백그라운드로 도는 API 작업(`interactive = false`)은 지금처럼 리스가 지나면 최대 2회까지 다시 실행합니다(15.2절).
  2. **폴백으로 다음 경로 칸에 가면 `interactive`가 `false`로 풀리고** 보통의 백그라운드 작업이 됩니다(다음 칸이 CLI면 워커가, API면 실행기가 잡음 — 화면 연결과 무관하게 끝까지 감, 9.3절).
  3. **SSE는 0.05초마다 연결이 끊겼는지 확인**하고, 끊기면 그 작업을 바로 `cancelled` · `interrupted`로 끝냅니다. **끊긴 뒤에 들어온 `done`은 저장하지 않습니다**(대화 메시지 · 글쓰기 결과 모두). 결과 저장은 리스 토큰이 아직 내 것일 때만 되므로(`lock_leased`), 이미 `interrupted`로 끝난 작업에는 늦은 결과가 붙지 않습니다.
  4. **수용 위험(19장)**: SSE가 660초(11분)를 넘기면 위 1번 때문에 답이 저장되지 않고 끝날 수 있습니다. 대화 · 글쓰기 한 번이 11분을 넘는 일은 드물어(모델 타임아웃 600초) 그대로 둡니다.

### 6.4 결과 반영

1. 워커가 `POST /api/worker/jobs/{id}/result`(8.6절) — `lease_token`과 함께.
2. 서버: `update jobs set status = 'running' … where id = %s and lease_token = %s and status = 'running' returning *`로 **아직 내 리스인지** 확인(아니면 409).
3. 종류별 **해석 · 반영 함수**(등록표 — 3장 뒤 단계 장치):
   - `summary`: `_extract_json` → `normalize_summary`(지금 `ai.py`) → `save_summary` + 키워드 채우기(지금 규칙). JSON을 못 읽으면 `failed`, `error_code = "bad_output"`(폴백 안 함 — 9.6절).
   - `chat`: `cli_citations`로 `[p.N]` → 인용 목록 → 사용자 질문 · 답 두 메시지 저장(지금 `/chat`과 같은 모양), `result = {"message_id"}`.
   - `write`: 결과 글을 `result.text`에 보관(24시간), 화면이 가져가 편집기에 넣음.
4. 반영과 `status = 'succeeded'`, `finished_at`, `progress = {}`를 **같은 트랜잭션**에서 커밋 — 반영이 실패하면 둘 다 되돌리고 `failed`(`error_code = "apply_failed"`).
5. 반영 대상이 사라졌으면(논문 삭제 → 작업도 cascade로 삭제) 결과는 404로 끝납니다(워커는 로그만).

### 6.5 취소

- `POST /api/jobs/{id}/cancel`: `queued` → 바로 `cancelled`. `running` → `cancel_requested = true`, 응답 `{"status":"running","cancel_requested":true}`.
- **취소를 요청한 뒤에는 다시 대기하지 않습니다**(2a 품질 수정): `cancel_requested = true`인 작업은 기기 해지(12.4절) · 로그인 안 됨 · 엔진 없음으로 다른 PC에 넘기려 할 때도 `queued`로 돌아가지 않고 `cancelled`로 끝납니다. API 칸 실패의 폴백도 같습니다(다음 칸으로 가지 않고 `cancelled`).
- 워커는 하트비트 응답의 `cancel: true`를 보면 CLI 프로세스 **트리 전체를 끄고**(11.5절) `outcome: "cancelled"`로 결과를 올립니다. 화면은 다음 조회에서 `cancelled`를 봄. 워커 응답이 없으면 리스 만료 때 `cancelled`.
- API 실행기(15.2절)는 스트림 이벤트 사이마다 `cancel_requested`를 확인(지금 요약 SSE의 `is_disconnected` 자리)해 멈춥니다.

### 6.6 재시도 · 대기 기한

- **자동 재시도는 하지 않습니다**(리스 만료 재할당과 로그인 안 된 PC 건너뛰기는 재시도가 아니라 "다른 PC에서 실행"). 근거: AI 결과가 비결정적이고 구독 한도를 소모함. 사용자가 실패한 작업의 [다시 시도]를 누르면 같은 `params`로 **새 작업**(7.1절).
- API SDK 자체 재시도(Anthropic SDK 기본값)는 그대로 둡니다.
- **CLI 대기 기한**(`deadline_at`, **확정 U7**): 켜진 PC가 없어 `queued`로 남는 작업은 **요약 24시간**(4단계 번역도 24시간), **대화 · 글쓰기 30분** 뒤 `failed`, `error_code = "no_worker_timeout"`, "켜진 PC가 없어서 작업을 끝내지 못했어요". **기한은 작업을 만들 때 정합니다**(팀장 승인 2026-10-08): 만들 때 종류별로 `deadline_at = now() + 기한`(서버 상수 `jobs.DEADLINE_S`, 첫 칸이 CLI든 API든 같음). **API 칸이 폴백 대상 오류로 실패해 CLI 칸으로 넘어가면 그 시각부터 기한을 다시 셉니다**(`deadline_at = 넘어간 시각 + 기한`). API 칸에서 API 칸으로 넘어가는 경우 · 같은 CLI 칸에서 다른 PC로 다시 대기하는 경우(`cli_not_found` · `cli_not_logged_in`) · 리스 만료 재대기는 `deadline_at`을 바꾸지 않습니다. 만료 처리(`jobs.expire`)는 `runner = cli`이고 `queued`인 작업만 대상입니다. 작업 보기의 `deadline_at`은 `queued`일 때만 값이 있습니다(7장).

### 6.7 동시 실행 수

| 단위 | 가정 | 비고 |
|---|---|---|
| PC당 엔진별 | claude **2** · codex **1** · gemini **1** — **확정 U9(2026-10-07, 기본값 그대로)** | 1st My paper 실측 설정(claude 3, codex 1, gemini 1)보다 보수적. 앱 설정에서 1~4로 바꿈 |
| PC당 전체 | **2** — 확정 U9 | 사무용 PC 부담 · 구독 한도 |
| 사용자당 진행 중 작업 | 30 | 5.3절 |
| API 실행기(서버 프로세스 안) | **4개 스레드**(가정 — K2', 서버 상수), 사용자당 동시 2개 | 서버 PC CPU · 서버 스레드 풀(40)과 나눠 씀. 넘으면 대기열에서 기다림(`queued`) |

### 6.8 정리 (sweeper)

상주 프로세스 없이, 사용자 범위 요청이 들어올 때 그 사용자 것만 가볍게 정리합니다(요청당 최대 1회/10분, 메모리 표시 — 인스턴스가 여럿이면 중복 실행돼도 안전한 질의만).
- 리스 만료 처리(6.3절), `deadline_at` 지난 `queued` → `failed`.
- 끝난 작업 **30일** 지나면 삭제(가정 — K13), `write` 결과 글은 24시간 뒤 `result = null`.
- 지난 · 쓴 연결 코드 삭제, 해지 30일 지난 기기 행 삭제(가정).

---

## 7. 서버 API — 사용자용 (Supabase JWT, 1단계 규칙 그대로)

모든 응답의 작업 모양(“작업 보기”):
```json
{"id": 41, "kind": "summary", "status": "queued", "runner": "cli", "engine": "claude",
 "route": [{"runner": "api", "engine": "claude"}, {"runner": "cli", "engine": "claude"}], "route_index": 1,
 "paper_id": 7, "paper_title": "Attention Is All You Need",
 "manuscript_title": "석사 논문 2장" | null,
 "device": {"id": 3, "name": "집 PC"} | null,
 "waiting_reason": "no_online_worker" | "no_engine_on_worker" | "all_workers_busy" | null,
 "progress": {"message": "…", "fraction": 0.4, "partial_text": "…"},
 "attempts": 1, "error_code": "", "error": "", "cancel_requested": false,
 "history": [{"runner": "api", "engine": "claude", "error_code": "api_auth", "at": "…"}],
 "deadline_at": "…+00:00" | null,
 "question": "…" | null, "result": {"message_id": 12} | {"text": "…"} | null,
 "created_at": "…+00:00", "started_at": null, "finished_at": null}
```
**구현 추가 필드 `route` · `route_index` · `question` · `result`**(팀장 승인 2026-10-08 — `jobs.job_view`):
- `route` · `route_index`: `jobs.route`(경로 목록 — 5.3 · 9.2절)와 지금 가리키는 칸을 **그대로** 돌려줌. 화면이 작업 목록의 "엔진/경로"(S6)와 폴백 진행을 그리는 데 씀.
- `question`: `kind = chat`이면 `params.question`(질문 원문, 요청 검사로 최대 8,000자), 그 밖 종류는 `null`. 대화 탭을 다시 열 때 질문 말풍선 · 작업 목록 [결과 복사]에 씀. 같은 `params`의 다른 값(글쓰기 본문 등)은 작업 보기에 **나가지 않음**.
- `result`: `jobs.result` 열을 **그대로**. 끝나기 전 · 실패 · 취소는 `null`, 요약은 반영 뒤 늘 `null`(본 데이터는 `ai_summaries`), 대화는 `{"message_id": …}`, 글쓰기는 `{"text": "…"}`(24시간 보관 뒤 `null` — 6.8절). 글쓰기 결과 글이 `GET /api/jobs` · `GET /api/jobs/{id}` 응답에 실려 나가므로 목록 응답이 커질 수 있음.
**시안 반영 추가 필드**(디자인 16장 요청 5 · 7, 2026-10-08):
- `deadline_at`: `status = queued`일 때 그 작업의 대기 기한(6.6절 — 화면이 "오후 3:10까지"처럼 보임. 화면이 기한 상수를 따로 갖지 않게), 그 밖 상태는 `null`.
- `manuscript_title`(팀장 결정 2026-10-08): `kind = write` 작업의 `params.manuscript_id`(5.3절)로 **작업 보기를 조회할 때 사용자 권한 트랜잭션(RLS)에서 원고 제목을 읽어** 넣음(작업 목록 제목 "원고: …"). 원고가 지워졌으면 `null` → 화면은 **"삭제된 원고"** 로 표시. `write`가 아니면 `null`. **작업을 만들 때 제목을 복사해 두지 않음**(개인 데이터를 두 곳에 두지 않기 위해).
`waiting_reason`(화면 문구용, `queued` + `runner = cli`일 때만, 아래 순서로 판정):
1. 해지 안 된 기기 중 그 엔진을 **광고한 기기가 하나도 없음** → `no_engine_on_worker`("codex가 있는 PC 없음")
2. 그런 기기는 있지만 **온라인 + 로그인됨 + 일시 중지 아님**인 기기가 없음 → `no_online_worker`("켜진 PC 없음" — 꺼짐 · 로그인 필요 · 일시 중지를 모두 포함, 화면은 기기 목록에서 이유를 보여 줌)
3. 조건에 맞는 기기가 있지만 그 엔진 자리가 모두 찼음(마지막 claim의 `free` 기준) → `all_workers_busy`
4. 그 밖 → null(곧 잡힘)

### 7.1 작업

| 엔드포인트 | 내용 |
|---|---|
| `POST /api/papers/{pid}/summary` | **바뀜**(1단계 SSE → 작업). 경로를 정해(9.2절) 작업을 만들고 `202 {"job": 작업 보기}`. 같은 논문에 진행 중 요약이 있으면 그 작업을 `200`으로 돌려줌. 쓸 수 있는 경로가 하나도 없으면 400(9.2절 문구) |
| `GET /api/papers/{pid}/summary` | `{"summary": …, "job": 진행 중이거나 마지막 요약 작업 | null}` — 1단계에서 늘 null이던 `job` 필드를 다시 씀(화면 호환) |
| `POST /api/papers/{pid}/chat` | SSE 유지. 첫 경로가 API면 지금 그대로 스트리밍. **CLI면** `{"type":"queued","job": 작업 보기}` 한 이벤트 후 끝. API 스트림이 폴백 대상 오류로 실패하면 `{"type":"fallback","job": 작업 보기}`(9.3절) |
| `POST /api/ai/write` | `/chat`과 같은 규칙. CLI 결과는 작업의 `result.text` |
| `GET /api/jobs` | 쿼리 `status=active|recent|all`(기본 `active` = queued+running, `recent` = 최근 7일 전체), `paper_id`, `kind`, `limit`(기본 50, 최대 200). `created_at desc`. 응답에 작업 보기 목록과 함께 **`total` = 조건에 맞는 전체 개수**(`limit`와 무관 — 사이드바 배지를 `limit=1`로 가볍게, 디자인 16장 요청 6) |
| `GET /api/jobs/{id}` | 작업 보기. 남의 작업 · 없는 작업 → 404 |
| `POST /api/jobs/{id}/cancel` | 6.5절. 끝난 작업이면 409 "이미 끝난 작업이에요" |
| `POST /api/jobs/{id}/retry` | `failed` · `cancelled`만. 같은 `kind` · `paper_id` · `params`로 **새 작업**(경로는 지금 설정으로 다시 정함) → `202 {"job"}`. 같은 논문에 **진행 중인 요약이 이미 있어** 새 작업을 만들지 않고 그 작업을 돌려줄 때는 `200 {"job"}`(`POST …/summary`의 두 번째 호출과 같은 규칙, 5.3절 색인). 없는 · 남의 작업 · 범위 밖 id → 404 |

**진행 따라가기 — 기획팀 추천: 폴링(K3)**. 화면은 작업을 보여 주는 동안 `GET /api/jobs/{id}`를 **1.5초**(탭이 보일 때) · **10초**(탭이 숨었을 때)마다 부르고, 끝 상태가 되면 멈춥니다. 여러 작업은 `GET /api/jobs?status=active` 한 번으로(사이드바 배지 — 16장).

| 선택지 | 장점 | 단점 |
|---|---|---|
| ① **폴링**(추천 — 팀장 결정 K3) | 구현 단순, 프록시(Funnel) · 탭 전환에 강함, 요청이 짧음 | 요청 수가 많음(요약 2분 = 약 80번 — 서버 PC 부담은 작음, DB 조회가 늘어남), 지연 최대 1.5초 |
| ② SSE `GET /api/jobs/{id}/events`(서버가 DB를 1초마다 보고 바뀌면 보냄) | 지연 작음 | 서버 스레드를 오래 잡음, Funnel을 거친 긴 연결 유지 **확인 필요**(1단계 AC-78). (개정 전 단점: Cloud Run 과금 · 시간 제한) |
| ③ Supabase Realtime(화면이 private 채널 구독) | 지연 거의 0 | 1단계 범위 밖으로 둔 Realtime 도입 · `realtime.messages` RLS · DB 트리거 필요 |

### 7.2 기기

| 엔드포인트 | 내용 |
|---|---|
| `GET /api/devices` | `[{id, name, online, last_seen_at, engines, app_version, os, paused, revoked, running_jobs, update_required, created_at}]` — 해지된 기기는 30일까지 `revoked: true`로. **토큰 해시는 보내지 않음**. `update_required: bool` = `app_version`이 서버 상수 `min_app_version`(8.3절)보다 낮음(화면 "업데이트 필요" 칩 — 화면이 서버 상수를 모르게, 디자인 16장 요청 3). 연결 코드 창은 새 API 없이 이 목록을 3초마다 불러 `created_at`이 코드 발급 시각보다 늦은 기기가 보이면 성공으로 처리(디자인 16장 요청 4) |
| `POST /api/devices/pair-codes` | 연결 코드 만들기 → `{"code": "K7QF-2M9X", "expires_at": "…"}`(12.1절). 이전 유효 코드는 끝냄 |
| `PATCH /api/devices/{id}` | `{name}` (1~60자) |
| `DELETE /api/devices/{id}` | **해지**: `revoked_at = now()`. 그 기기가 `running`으로 잡은 작업은 즉시 `queued`로 되돌림(`excluded_devices`에 추가 안 함 — 리스 토큰이 바뀌어 옛 결과는 버려짐). 응답 `{"ok": true, "requeued_jobs": n}` |

### 7.3 엔진 · 상태

| 엔드포인트 | 내용 |
|---|---|
| `GET /api/ai/status` | **바뀜**: `{"ready": bool, "kinds": {"summary": {"route": [{"runner","engine","available","reason"}], "first": {"runner","engine"} | null}, …}, "message": "…"}`. `ready` = 요약 경로 중 하나라도 지금 쓸 수 있음(API 키 있음, 또는 그 엔진을 가진 기기가 **연결돼 있음** — 온라인 여부와 무관, 꺼져 있으면 대기). 화면의 AI 버튼 활성화에 씀 |
| `GET /api/ai/engines` | 엔진별 요약: `{"claude": {"api_key": true, "devices_online": 1, "devices_total": 2, "cli_model": "default"}, …}` — 설정 화면용 |
| `GET/PUT /api/settings` | 새 키 `ai_routing` · `cli_models`(9.4절), 새 비밀 키(U2). 모양 규칙은 1단계 그대로(비밀은 `*_set`/`*_status`). **추가(디자인 16장 요청 1)**: `GET`에 `{anthropic,openai,google}_api_key_hint` — 저장된 키의 **끝 4자리**, `*_status = set`일 때만(지금 `user_secrets.hint` 값 — `crypto.hint`는 키가 12자 미만이면 빈 값, 키 원문은 보내지 않음) |

**키별 최근 실패 `{name}_last_error`**(디자인 16장 요청 2 · AC-93 — S3 "최근 실패" 표시, 팀장 결정 2026-10-08):
- 응답: **`GET /api/settings`** 에 `{anthropic,openai,google}_api_key_last_error` — 모양 `{"code": "api_auth" | "api_permission", "at": "…+00:00"} | null`.
- 저장: 기존 **`profiles.settings`**(JSON, RLS 적용) 안의 값. **새 표 · 열 없음**.
- 기록: **API 실행기**(15.2절 · 대화 · 글쓰기 SSE 경로 포함)가 그 키로 실행한 작업이 `api_auth` · `api_permission`(9.6절)으로 실패하면 그 사용자 권한 트랜잭션에서 씀. 그 밖 오류(한도 · 서버 · 연결)는 키 문제가 아니라 기록하지 않음.
- 지우기: **그 키를 다시 저장하면 지움**(`PUT /api/settings`로 그 키를 바꿀 때 같은 트랜잭션에서).

## 8. 워커 API (기기 토큰)

### 8.1 기기 토큰 인증

- 형식(기획팀 추천 K5 — **구현 확인 2026-10-08**): `pld1.<user_id uuid>.<device_id>.<비밀 32바이트 base64url>`. 정확한 모양(`jobs.TOKEN_RE`, 전체 일치): `pld1.` + 소문자 16진 uuid(대시 포함 36자) + `.` + `device_id`(1~18자리 양의 정수, 앞에 0 없음) + `.` + 비밀 **43자**(`[A-Za-z0-9_-]`, 패딩 `=` 없음). 이 모양이 아니면 DB를 열기 전에 401. 서버는 uid · device_id로 `actor_claims` 트랜잭션을 열어 그 기기 행을 읽고 **비밀의 SHA-256을 `token_hash`와 상수 시간 비교**합니다. uid를 위조해도 해시가 맞지 않아 401.
  - 대안(K5 ②): 무작위 토큰만 두고 해시로 찾기 → 사용자를 모르므로 매 요청 `system_tx("device auth")` 필요.
- 헤더: `Authorization: Bearer pld1.…`(`Bearer` 대소문자 무관) + `X-PaperLab: 1`(모든 `POST`에 필수 — **없으면 403 `{"detail":"허용되지 않은 요청","code":"bad_request_header"}`**, 토큰 검사보다 먼저). 워커 API는 전부 `POST`. 경로: `/api/worker/*`만 이 인증을 씀. 반대로 `/api/worker/*`에 **Supabase JWT를 보내면 401**, 다른 `/api/*`에 기기 토큰을 보내면 401(섞어 쓰기 금지 — AC-19).
- 실패 응답: 토큰 없음 · 형식 틀림 · 해시 불일치 · 없는 기기 → 401 `{"detail":"PC 연결이 필요해요","code":"device_auth_required"}`(Supabase JWT를 보내도 같음). **해지된 기기** → 401 `{"detail":"이 PC 연결이 해지됐어요","code":"device_revoked"}`(워커는 토큰을 지우고 연결 화면으로 — 13.4절). 허용 목록 밖 사용자(허용 목록 on일 때만) → 403 `{"detail":"허용되지 않은 계정이에요","code":"not_allowed"}`. 그 밖 오류 본문은 모두 `{"detail": "…", "code": "…"}` 모양. **`pair`를 뺀 모든 워커 요청은 이 검사를 먼저 통과**해야 하고(`hello` 포함 — 해지된 기기는 `hello`도 401), 처리 결과는 그 기기 사용자 범위 트랜잭션 안에서 커밋됩니다.
- 같은 출처 검사: 워커 요청은 `Origin`을 보내지 않음(Node `fetch` 기본). `Origin`이 있으면 1단계 규칙대로 검사.
- 로그: `device_id`만(토큰 · 이메일 없음). `last_seen_at`은 50초에 한 번까지만 씀.

### 8.2 `POST /api/worker/pair` — 코드 교환 (인증 없음)

요청 `{"code": "K7QF-2M9X", "name": "DESKTOP-ABC", "os": "Windows 11 …", "app_version": "0.2.0", "protocol": 1}`
→ `200 {"device_id": 3, "token": "pld1.…", "name": "DESKTOP-ABC", "account_hint": "a***@example.com"}`
- 코드를 대문자 · 대시 제거로 정규화 → 해시 → `system_tx("device pairing")`로 한 행 찾기 → 안 쓰고 안 지난 것만 → 그 사용자 `actor_claims` 트랜잭션에서 기기 행 생성 + 코드 `used_at` · `device_id` 기록(한 트랜잭션, 같은 코드 동시 교환 시 한 쪽만 성공 — `used_at is null` 조건 갱신).
- 틀림 · 지남 · 이미 씀 → 모두 같은 400 `{"detail":"연결 코드가 맞지 않거나 시간이 지났어요","code":"bad_code"}`(어느 쪽인지 알리지 않음). 정규화한 코드가 8자가 아니어도 같은 400.
- 구현 확인(2026-10-08): 인증 헤더는 없지만 `X-PaperLab: 1`은 필요(없으면 403 `bad_request_header`, 8.1절). `name`이 비면 `"내 PC"`(60자 제한 · 제어 문자 제거), `os` 120자 · `app_version` 40자까지만 저장, `protocol`은 **읽지 않음**(426 검사는 `hello` · `claim`에서만 — 8.3절). 활성 기기 10대째를 넘으면 400 `{"code":"too_many_devices"}`, 허용 목록 밖이면 403 `not_allowed`, 속도 제한 429 `{"detail":"잠시 후 다시 시도해 주세요","code":"rate_limited"}`.
- **속도 제한**(메모리, 서버 프로세스 하나 — 가정): **한도가 두 개**입니다 — **IP별 분당 10회**, **전체 분당 60회** → 넘으면 429. 서버는 Funnel 뒤라 접속 주소가 늘 `127.0.0.1` — IP는 Funnel이 붙이는 `X-Forwarded-For`(uvicorn이 `127.0.0.1`만 믿고 풀어 줌)로 봅니다. **주소가 `127.0.0.1`(또는 `::1`)이고 `X-Forwarded-For`가 없으면 IP별로 나눌 수 없으므로 IP별 한도는 보지 않고 전체 한도(분당 60회)만 봅니다**(2a 품질 수정 — 개정 전 "분당 30회로 낮춤" 문구는 코드에 없어 지움). 코드 공간 **31문자** 8자리(31⁸ ≈ 8.5×10¹¹ ≈ 2³⁹·⁶, 개정 전 "32문자 ≈ 2⁴⁰" — 12.1절), 10분 유효라 무차별 대입은 사실상 불가.
- 토큰 원문은 **이 응답에서 한 번만** 나갑니다. 서버 로그 · DB에 남지 않습니다.

### 8.3 `POST /api/worker/hello` — 시작 · 엔진 광고

워커 시작 때, 엔진 상태가 바뀔 때, 30분마다(가정).
요청 `{"app_version": "0.2.0", "protocol": 1, "os": "…", "paused": false, "engines": [{"name":"claude","version":"2.1.269","logged_in":true,"slots":2}, {"name":"codex","version":"0.130.0","logged_in":false,"slots":1}]}`
→ `{"device_id": 3, "name": "집 PC", "account_hint": "a***@example.com", "min_protocol": 1, "min_app_version": "0.2.0", "poll": {"idle_s": 60, "active_s": 5}, "server_time": "…"}`
- `logged_in: false`인 엔진은 잡기 대상에서 빠집니다(서버가 `free_engines`에서 제외).
- 앱 버전이 `min_app_version`보다 낮거나 `protocol`이 `min_protocol`보다 낮으면 **`426`** — 본문(구현 확인 2026-10-08):
  ```json
  {"detail": "PaperLab 앱을 업데이트해 주세요", "code": "update_required",
   "min_app_version": "0.2.0", "min_protocol": 1}
  ```
  워커는 작업을 받지 않고 업데이트를 안내(13.7절). 기준 값은 서버 코드 상수 `jobs.MIN_APP_VERSION`(현재 `"0.2.0"`) · `jobs.MIN_PROTOCOL`(현재 `1`) — 작업 프로토콜이 깨지는 변경 때만 올림. 버전 비교는 `주.부.수` 숫자 셋(`0.2.0-beta` 같은 뒤 문자열은 무시), 해석 못 하는 버전 문자열은 `0.0.0`으로 봐서 426.
- 426을 내는 곳은 **`hello`와 `claim` 둘뿐**입니다(`heartbeat` · `result` · `bye` · `pair`는 버전을 보지 않음). `hello`는 보낸 `app_version` · `engines` · `paused` · `os`를 **먼저 저장한 뒤** 426을 돌려주고(그래서 `GET /api/devices`에 새 버전과 `update_required: true`가 보임), `protocol`을 안 보내면 `1`로 봅니다. `claim`은 요청의 `protocol`을 읽지 않고 **DB에 저장된 `app_version`만** 비교합니다.
- 요청 필드 검사(`hello`): `engines`는 배열(최대 3개), 각 항목 `name`은 `claude` · `codex` · `gemini` 중 하나이며 중복 없음, `slots`는 1~4로 맞춤, `logged_in`은 **불리언 `true`일 때만** 참, `version`은 40자까지. 틀리면 400 `{"detail":"엔진 정보가 올바르지 않아요","code":"bad_request"}`. `engines`를 생략하면 이전 값을 그대로 둠.

### 8.4 `POST /api/worker/claim` — 잡기 · 폴링

요청 `{"free": {"claude": 2, "codex": 0}, "paused": false}`
- `free`: 엔진 이름(`claude` · `codex` · `gemini`)별 빈 자리, 값은 **정수 0~8**(불리언 아님). 모르는 엔진 이름 · 범위 밖 · 정수 아님 → 400 `{"code":"bad_request"}`. 본문을 생략하면 빈 객체로 봄. 서버는 `free`가 1 이상이면서 그 기기가 **`logged_in: true`로 광고한** 엔진의 작업만 잡아 줌.
- `paused: true`면 아무것도 잡지 않고 `200 {"job": null, "next_poll_s": 60}`. (`paused` 값은 기기 행에도 저장.) **워커(2b 구현)는 일시 중지 중에도 `claim {"free": {}, "paused": true}`를 서버가 준 간격(60초)마다 보냅니다** — 쉬는 중이어도 `last_seen_at`이 갱신돼 화면에서 "꺼짐"이 아니라 "일시 중지"로 보이게 하기 위함. 연결이 안 된(토큰 없음) 동안에는 서버 요청을 하지 않음.
- 잡을 것이 없으면 `200 {"job": null, "next_poll_s": 5 | 60}`(10장 적응형 간격 — 그 사용자에게 `queued`/`running` CLI 작업이 있거나 화면 요청이 최근 10분 안이면 5, 아니면 60).
- 있으면 **`200 {"job": {...}, "next_poll_s": 0}`**(구현 확인: 잡은 직후는 0 — 빈 자리가 남았으면 곧바로 다시 잡기. 개정 전 예시의 5는 틀림):
```json
{"id": 41, "lease_token": "…", "lease_s": 90, "heartbeat_s": 30,
 "kind": "summary", "engine": "claude", "model": "opus" | null,
 "output": "json" | "text", "json_schema": {…} | null, "stream_partial": false,
 "system": "당신은 논문을 정확하게 정리하는 연구 조수입니다.",
 "prompt": "<paper title=…>…</paper>\n\n…", "timeout_s": 1200}
```
- 필드 값(`jobs.cli_task`): `lease_s` 90 · `heartbeat_s` 30 · `timeout_s` = 요약 1200 / 대화 · 글쓰기 600. `lease_token`은 문자열(uuid). `output` · `json_schema` · `stream_partial`: **요약**은 `"json"` · 요약 스키마 · `false`, **대화 · 글쓰기**는 `"text"` · `null` · `true`. `model`: 설정 `cli_models`의 그 엔진 값이 `default`면 `null`(워커는 `--model`을 붙이지 않음), 아니면 별칭 문자열(11.6절). `system`은 시스템 프롬프트 전체 문자열.
- 이 요청도 `jobs.expire`를 먼저 돌려(리스 지난 작업 재대기 · 대기 기한 지난 작업 실패) 리스가 만료된 작업이 이 호출에서 다시 잡힐 수 있음. `last_seen_at`은 50초에 한 번까지만 갱신.
- 프롬프트를 못 만들면 그 작업은 서버가 `failed`로 끝내고 응답은 **`{"job": null, "next_poll_s": 0}`**: 논문에 본문도 초록도 없는 경우 등 요청을 만드는 함수가 오류를 내면 `error_code = "bad_input"`(9.6절), 크기가 4MB를 넘으면 `input_too_large`. 워커 입장에서는 "이번엔 받은 작업이 없음"과 같음.
- `prompt`는 지금 `ai.py`의 CLI 프롬프트(요약 · 대화 · 글쓰기)를 그대로 쓰되 서버가 만듭니다. 크기 상한 **4MB**(가정 — claude는 stdin 10MB 한도, 확인함). 넘으면 잡기 대신 그 작업을 `failed`, `error_code = "input_too_large"`, "논문 본문이 너무 길어서 CLI로 보낼 수 없어요".

### 8.5 `POST /api/worker/heartbeat` — 하트비트(여러 작업 묶음)

요청 `{"jobs": [{"id": 41, "lease_token": "…", "progress": {"message": "claude 실행 중", "partial_text": "…"}}]}`
→ `{"jobs": [{"id": 41, "ok": true, "lease_until": "…", "cancel": false}, {"id": 40, "ok": false, "code": "lease_lost"}]}`
- `ok: false`(리스 잃음 · 작업 삭제됨 · **서버 쪽 절대 기한 지남** — 6.3절)면 워커는 그 프로세스를 끄고 결과를 올리지 않습니다. 이유는 늘 `code: "lease_lost"` 하나(작업이 없어도, 토큰이 틀려도, 다른 기기의 작업이어도 같음).
- 구현 확인(2026-10-08): `jobs`는 배열 **최대 16개**(넘거나 배열이 아니면 400 `bad_request`), 항목은 `id`(정수) 필수 — **`id`가 없거나 정수가 아니거나, `true`/`false`(bool)이거나, 범위 밖(1 미만 · 2⁶³ 이상)이면 요청 전체가 400 `bad_request`**(2a 품질 수정), `lease_token`이 없거나 모양이 틀리면 400이 아니라 그 항목만 `ok: false`. 그 기기가 `device_id`로 잡은 작업의 토큰이어야 `ok: true` — 성공 항목은 `{"id", "ok": true, "lease_until": "…+00:00", "cancel": bool}`이고 `cancel`은 `cancel_requested` 값. `progress`는 서버가 정리해 저장: `message` 200자(제어 문자 제거), `fraction` 0~1 숫자만, `partial_text`는 64KB를 넘으면 뒤쪽만(AC-12). 응답 항목 순서는 요청과 같음. `heartbeat` 요청은 `last_seen_at` 갱신도 함께 함.
- 실행 중 작업이 없을 때는 보내지 않습니다(`last_seen_at`은 claim이 갱신).

### 8.6 `POST /api/worker/jobs/{id}/result`

요청
```json
{"lease_token": "…", "outcome": "succeeded" | "failed" | "cancelled",
 "text": "…", "structured": {…} | null,
 "error_code": "cli_not_logged_in", "error": "…(최대 2,000자, 워커가 토큰 · 키 패턴을 지움)",
 "stats": {"duration_ms": 81234, "cli_version": "2.1.269", "exit_code": 0, "cost_usd": 0.0}}
```
→ `200 {"status": "succeeded" | "queued" | "failed" | "cancelled"}`(서버가 폴백 · 재대기를 정했으면 `queued`) · 409 `lease_lost` · 404(작업 없음).
- `text` 최대 **2MB**(가정, 넘으면 400 `{"code":"output_too_large"}` — 워커는 `failed`/`output_too_large`로 다시 보냄).
- 결과 처리 규칙: `succeeded` → 6.4절 반영. `failed` → 9.6절 판정(폴백 · 다른 PC · 실패). `cancelled` → `cancelled`.
- **구현 확인(2026-10-08)**:
  - 필수 `lease_token`(uuid 문자열 — 모양이 틀려도 409 `lease_lost`), `outcome`(위 셋 중 하나, 아니면 400 `bad_request`). `text`는 문자열(없으면 빈 문자열). 이 기기가 `device_id`로 잡은 작업의 토큰이어야 함(다른 기기가 토큰을 알아도 409).
  - `error_code`(outcome이 `failed`일 때만 읽음)는 워커가 보낼 수 있는 값 **8개**: `cli_not_found` · `cli_not_logged_in` · `cli_usage_limit` · `cli_model` · `cli_timeout` · `cli_bad_output` · `cli_exit` · `output_too_large`. **그 밖 값(오타 · 빈 값 · `cancelled` 등)은 서버가 `cli_exit`으로 바꿔 처리**합니다. 처리: `cli_not_found` · `cli_not_logged_in` → 그 기기를 `excluded_devices`에 넣고 같은 칸에서 `queued`(응답 `queued`), `cli_usage_limit` · `cli_exit` → 다음 경로 칸이 있으면 `queued` 없으면 `failed`, `cli_model` · `cli_timeout` · `cli_bad_output` · `output_too_large` → `failed`. `error`(워커가 보낸 문구)는 서버가 키 · 토큰 패턴을 지우고 2,000자로 자름; 비면 표준 문구.
  - `structured`는 JSON 객체일 때만 읽음(아니면 무시). **`stats`는 2a 서버가 읽지 않음**(저장 · 로그 없음 — 18장 "비용 집계 없음"과 같은 취지).
  - 200 응답은 `{"status": "succeeded" | "queued" | "failed" | "cancelled"}`. 결과 해석 실패(JSON 못 읽음 등)는 `failed`, `error_code = "bad_output"`(`cli_bad_output`와 다름). 반영 중 오류는 `failed`/`apply_failed`. 409 본문은 `{"detail":"이 작업은 더 이상 이 PC의 것이 아니에요","code":"lease_lost"}`, 작업이 없으면 404 `{"code":"not_found"}`.
  - 서버가 만드는 `error_code`(워커가 보내지 않음): `lease_exhausted` · `no_worker_timeout` · `input_too_large` · `bad_input` · `bad_output` · `apply_failed`와 API 칸의 `api_*`(9.6절).

### 8.7 `POST /api/worker/bye`

**앱을 끌 때(워커 정지)만** 보냅니다(2b 구현 — 일시 중지 때는 보내지 않고 위 8.4절의 `claim {paused:true}`를 60초마다 보냄. 정지 요청에 `bye`가 실패해도 무시). 본문 `{"paused": true|false}`(그 시점의 일시 중지 설정) — `last_seen_at`을 비워 즉시 "꺼짐"으로 보이게(선택, 실패해도 무시). 응답 `{"ok": true}`. 본문을 생략해도 됨(`paused`는 `true`일 때만 참). 서버 메모리의 그 기기 빈 자리 기록도 지움(`waiting_reason` 판정용).

---

## 9. 엔진 라우팅 (④)

### 9.1 작업별 엔진 목록 (P8 — **확정 U1: 기본은 모두 `[claude]`**)

| 작업(`kind`) | 기본값(2단계 작업은 확정 U1, 4단계는 그 단계에서 확정) | 근거 |
|---|---|---|
| `summary` 요약 | `[claude]` | 지금 결과 스키마 · PDF 첨부가 Anthropic API 기준으로 맞춰져 있음 |
| `chat` 논문과 대화 | `[claude]` | API는 PDF 쪽 인용(citations)이 됨 |
| `write` 글쓰기 도우미 | `[claude]` | |
| (4단계) 번역 | `[claude, gemini]` | PLAN 5장 예시 |
| (4단계) 쉬운 설명 이미지 | `[codex]` | PLAN 5장 예시 |

- 사용자가 설정에서 작업마다 엔진 순서를 바꾸고 둘째 · 셋째 엔진을 추가할 수 있습니다(예: 요약 `[claude, codex]`). 기본값에는 codex 폴백을 넣지 않습니다(확정 U1 — 각자 설정에서 추가).
- 목록에 없는 엔진은 그 작업에 쓰지 않습니다.

### 9.2 경로 정하기 (작업 만들 때 한 번)

작업의 엔진 목록 `[e1, e2, …]`를 **경로 목록**으로 펼칩니다(PLAN 5장 규칙 1~3):

```
각 엔진 e 에 대해 차례로:
  e 의 API 키가 있으면  → {runner: api, engine: e}
  그 다음 항상          → {runner: cli, engine: e}
단, {cli, e} 는 "그 엔진을 광고한 적이 있는 (해지 안 된) 기기"가 하나도 없으면 뺀다
   (예: codex 를 가진 PC 가 아예 없음 → codex CLI 칸 생략, 다음 엔진으로)
```

- 경로가 비면 400. **문구는 PC 앱 설치 파일이 있는지로 나눕니다**(팀장 결정 Q2a-1, 2026-10-08 — 있는지는 `GET /api/desktop/release`와 같은 판정, 즉 `release.json`이 있고 파일이 있으면 "있음"):
  - 설치 파일이 **있을 때**: "AI를 쓸 수 있는 방법이 없어요. 설정에서 API 키를 넣거나, PC에 PaperLab 앱을 설치하고 연결해 주세요."
  - 설치 파일이 **없을 때**(2a만 반영된 동안): "설정 → AI 엔진에서 API 키를 등록해 주세요. (PC 앱 연결은 곧 지원돼요)"
  - 이 문구는 S10(AI 버튼 비활성 안내)과 같습니다.
- **API 실패 뒤 CLI 폴백(팀장 결정 Q2a-1)**: 위 규칙대로 해지 안 된 기기가 하나도 없으면 `{cli, e}` 칸이 경로에 없으므로 작업을 CLI 대기열(`queued`)에 **넣지 않고**, API 오류 사유와 위 안내 문구를 함께 보여 줍니다(작업은 `failed`, 폴백 안 함). 기기가 있는데 꺼져 있으면 아래 규칙대로 **대기 기한(6.6절)까지 `queued`로 둡니다**. 기기 유무는 작업을 만들 때 한 번 정한 경로에 고정되므로, 만든 뒤 기기가 연결 · 해지되는 경우는 6.2절 · 6.6절 규칙(대기 · 기한 실패)을 따릅니다.
- `{cli, e}` 칸은 **켜진 PC가 없어도 실패가 아니라 대기**입니다(PLAN 5장 4번: "대기 중 — 켜진 PC 없음", PC가 켜지면 이어서 실행). 그래서 CLI 칸 뒤의 경로는 그 CLI가 **실패했을 때만** 씁니다.
- 경로는 작업에 고정(`jobs.route`) — 실행 중 설정을 바꿔도 이미 만든 작업은 바뀌지 않습니다. **예외 하나(2a 품질 수정, 품질팀 L5 — 현재 동작 유지)**: 폴백으로 **다음 칸이 CLI인데 그 순간 그 엔진을 광고한 해지 안 된 기기가 하나도 없으면** 그 칸은 건너뛰고 그다음 칸으로 갑니다(만든 뒤에 그 PC를 해지한 경우). 건너뛴 뒤 남은 칸이 없으면 `failed`(API 오류 사유 + 연결 안내 문구). 반대로 만든 뒤 새로 연결된 기기가 있어도 이미 빠진 칸이 살아나지는 않습니다.

### 9.3 API 우선 → CLI 폴백 흐름

| 작업 | API 칸 실행 | 폴백 |
|---|---|---|
| `summary` | **서버 프로세스 안 API 실행기**(15장 — K2', 탭을 닫아도 계속 · 확정 U8). 엔진에 따라 Anthropic · OpenAI · Google 실행기(9.5절) | 폴백 대상 오류면 같은 작업 행을 다음 칸(예: `{cli, claude}`)으로 `queued` |
| `chat` · `write` | 지금처럼 **사용자 요청 안 SSE 스트림**(대화형이라 탭을 닫으면 멈추는 것이 자연스러움). 작업 행을 `running(api)` · **`interactive = true`**로 만들어 두고(리스는 660초 고정, 연장 없음 — 6.3절 "대화 · 글쓰기 SSE 작업(`interactive`)의 리스") 끝나면 `succeeded`. SSE는 **0.05초마다 연결이 끊겼는지** 확인해, 끊기면 바로 `cancelled` · `interrupted`로 끝내고 **끊긴 뒤 들어온 `done`은 저장하지 않음** | 스트림 **시작 전 · 도중** 폴백 대상 오류면 작업 행을 `{cli, …}`로 `queued` + SSE `{"type":"fallback","job"}` → 화면이 작업을 따라감. 이미 화면에 일부 글이 나왔으면 화면은 그 글을 지우고 "PC에서 다시 만드는 중"을 보여 줌 |

- 탭을 닫아 대화 SSE가 끊기면: API 칸은 `cancelled` · `error_code = "interrupted"`(지금 동작과 같음). **리스가 지난 `interactive` 작업은 서버가 다시 실행하지 않고 같은 `cancelled` · `interrupted`로 끝냄**(6.3절). **폴백으로 다음 칸에 넘어가면 `interactive`가 풀려** 그 뒤로는 화면 연결과 무관한 백그라운드 작업입니다. 이미 CLI로 넘어간 작업은 탭과 무관하게 끝까지 돌고 결과가 저장됩니다(대화 메시지 저장 — 다음에 열면 보임). 단 **글쓰기 도우미 창을 사용자가 닫으면**(✕ · Esc · 바깥 클릭 · [취소]) 화면이 그 작업을 **대기 중이든 실행 중이든** 취소합니다(PD-4 — `POST /api/jobs/{id}/cancel`, 6.5절). 창을 닫지 않은 채 탭이 닫히면 작업은 계속되고 결과 글은 24시간 작업 목록에 남습니다.

### 9.4 설정 키

| 키 | 위치 | 모양 · 기본값 |
|---|---|---|
| `ai_routing` | `profiles.settings` | `{"summary": ["claude"], "chat": ["claude"], "write": ["claude"]}` — 값 검사: 알려진 엔진만, 중복 없음, 1~3개. 빠진 작업은 기본값 |
| `cli_models` | `profiles.settings` | `{"claude": "default", "codex": "default", "gemini": "default"}` — 11.6절 |
| `model` · `effort` | 그대로 | **Anthropic API 전용**(Anthropic 모델 id). 화면 문구도 "Anthropic API 모델"로 |
| `api_models` (신규) | `profiles.settings` | `{"codex": "<OpenAI 모델 id>", "gemini": "<Gemini 모델 id>"}` — OpenAI · Google API 실행기가 쓸 모델. **기본 모델 id = 팀장 결정 K19 확정(2026-10-08)**: OpenAI(`codex` 엔진) **`gpt-6.1-sol`**, Google(`gemini` 엔진) **`gemini-3.8-flash`**(20.2절 K19 — 근거와 공식 목록 주소). `api_models`에 값이 없으면 코드 상수 `ai.API_MODEL_DEFAULTS`가 기본값(2a 구현이 이 값과 일치함을 확인). 사용자는 설정 "API 모델" 칸(S3)에서 바꿈. Anthropic(`claude` 엔진)은 기존 기본값 그대로 — 설정 `model`(기본 `claude-opus-5-5`) · `effort`(기본 `medium`). 값 검사: 영문 · 숫자 · `-` `.` `_`만, 1~100자 |
| `ai_engine` | 그대로 남김 | **무시**(읽어도 쓰지 않음, 어떤 값이든 400 아님 — 1단계 AC-31의 `cli → 400`은 2단계에서 폐지) |
| `openai_api_key` · `google_api_key` | `user_secrets` (`name` 그대로) | **확정 U2 — 받음.** 1단계 암호화 규칙 그대로(AES-256-GCM, AAD `"{user_id}:{name}"`, `key_id`, `hint` 끝 4자리). `GET/PUT /api/settings`는 1단계와 같은 모양으로 `openai_api_key_set` · `openai_api_key_status` · `google_api_key_set` · `google_api_key_status`를 더함(빈 문자열 = 그대로, `null` = 지우기). 암호화 키 회전(`admin rotate-key`)이 새 행도 다시 암호화(이름과 무관하게 모든 행 — 지금 코드 그대로) |

### 9.5 API 실행기 범위 (**확정 U2: Anthropic · OpenAI · Google 키 모두 받기**)

| 엔진 | API | 2단계 범위 |
|---|---|---|
| `claude` | Anthropic(지금 코드 — PDF 첨부 · 쪽 인용 · JSON 스키마) | **지원**(그대로) |
| `codex` | OpenAI API | **텍스트 전용 지원**: 논문 본문은 `page_texts`의 텍스트(CLI 프롬프트와 같은 함수로 만듦 — PDF 원본 · 그림은 보내지 않음, 2장 "안 하는 것"). 요약은 JSON 스키마 응답, 대화의 출처는 CLI와 같은 `[p.N]` 규칙(`cli_citations` 재사용) |
| `gemini` | Google Gemini API | 위와 같음(텍스트 전용) |

- 호출 방법: **새 SDK를 더하지 않고 `httpx`로 각 회사 REST API를 직접 부름**(기획팀 추천 — 의존성 최소. 공식 SDK를 쓸지는 개발팀 재량). 엔드포인트 · 구조화 출력(JSON 스키마) 지정 방법 · 스트리밍 방식은 개발팀이 각 회사 공식 문서로 **확인 필요**(이 문서에 결과를 적음).
- **2a 구현 결과**(`ai.AIService.text_complete` — 코드에서 읽은 값. 실제 회사 서버를 부른 확인은 이 문서에 없음, 시험은 가짜 서버 AC-46 · 47):
  - OpenAI: `POST https://api.openai.com/v1/responses`, 헤더 `Authorization: Bearer <키>`, 본문 `{"model", "instructions": <시스템>, "input": <프롬프트>}`. 요약일 때만 `text.format = {"type":"json_schema","name":"paper_summary","schema": <요약 스키마>,"strict":true}`.
  - Google: `POST https://generativelanguage.googleapis.com/v1beta/models/{모델}:generateContent`, 헤더 **`x-goog-api-key: <키>`**(주소 쿼리에 키 없음), 본문 `{"systemInstruction": {"parts":[{"text": 시스템}]}, "contents": [{"role":"user","parts":[{"text": 프롬프트}]}]}`. 요약일 때 **`generationConfig.responseMimeType = "application/json"`만** 보냄 — **응답 스키마(`responseSchema` 등)는 보내지 않고**, 요약 스키마는 **프롬프트 끝에 글로 넣어서**(`ai.summary_request`) 따르게 함. 결과는 `_extract_json` → `normalize_summary`로 읽음(못 읽으면 `bad_output`).
  - 두 회사 모두 **스트리밍 없음**: 응답을 한 번 받아 대화 · 글쓰기는 `delta` 이벤트 1개 + `done`, 호출 제한 시간 600초(`TEXT_API_TIMEOUT`). 요청마다 새 `httpx` 클라이언트(테스트는 주입). 기본 모델 id는 9.4절(K19).
- 대화 · 글쓰기의 API 경로가 OpenAI · Google이면 SSE로 중간 글을 보냄(스트리밍이 어려우면 끝에 한 번 — 개발팀 재량, 화면 이벤트 모양은 같게).
- 키 보호: 서버 로그 · 오류 문구에서 OpenAI 키(`sk-`로 시작) · Google 키(`AIza`로 시작) 패턴을 지움(1단계 `redact` 확장, AC-49 · 96 확장). 키는 요청 헤더로만 보내고 주소(쿼리)에 넣지 않음 — Google API가 키를 쿼리로 받는 방식만 지원하면 헤더 방식(`x-goog-api-key`)을 쓰는지 **확인 필요**(쿼리면 접근 로그 · 오류 문구에 주소가 남지 않게 주의).
- 비용: 각 사용자 본인 키 요금(PLAN 7장). 서버는 다른 사용자 키를 섞어 쓰지 않음(1단계 AC-48 원칙 — 서버 환경 변수 `OPENAI_API_KEY` · `GEMINI_API_KEY` · `GOOGLE_API_KEY`도 **보지 않음**).

키가 없는 엔진은 9.2절에서 API 칸이 생기지 않습니다(= 그 엔진은 CLI만).

### 9.6 실패 판정 (폴백 여부 — 기획팀 추천 K7)

| 오류(`error_code`) | 언제 | 처리 |
|---|---|---|
| `api_no_key` | 키 없음(경로를 만들 때 이미 걸러짐) | — |
| `api_auth` | 401 키가 틀림 | **폴백**. 화면 기록 "API 키가 올바르지 않아 PC로 넘겼어요" |
| `api_permission` | 403 이 키로 모델 사용 불가 | **폴백** |
| `api_rate_limit` | 429 | **폴백** |
| `api_overloaded` · `api_server` | 5xx · 529 | **폴백** |
| `api_connection` · `api_timeout` | 연결 실패 · 시간 초과 | **폴백** |
| `api_bad_request` | 400(예: 입력이 너무 큼) | **폴백**(CLI는 텍스트만 보내므로 통할 수 있음) |
| `api_refusal` | `stop_reason = refusal`(안전 정책) | **폴백 안 함** — 같은 정책의 같은 회사 모델로 다시 해도 같을 가능성이 큼, 사유 그대로 표시(1st My paper 원칙 "실패 사유를 그대로") |
| `bad_output` | 결과 JSON을 못 읽음 | 폴백 안 함, [다시 시도] |
| `bad_input` (신규 — 팀장 승인 2026-10-08) | **CLI 작업을 잡을 때 서버가 프롬프트를 만들지 못함** — 대표 경우: 논문에 **본문(쪽 텍스트)도 초록도 없음**(`error` = "이 논문에는 읽을 수 있는 본문이나 초록이 없어요. PDF를 첨부해 주세요."). 요청을 만드는 함수(`ai.summary_request` · `chat_request` · `write_request`)가 오류를 낸 **모든 경우**(예: 알 수 없는 글쓰기 모드)에 같은 코드, 단 크기 초과(`input_too_large`)는 따로 | **폴백 안 함**, 서버가 그 자리에서 `failed`(`history` 기록 없음). 워커 claim 응답은 `{"job": null, "next_poll_s": 0}`(8.4절). 같은 조건의 **API 칸**은 이 코드가 아니라 `ai.py`가 내는 `bad_request`로 실패(폴백 대상 아님 — 폴백 대상인 `api_bad_request`와 다름) |
| `api_max_tokens` | 결과가 끊김 | 폴백 안 함 |
| `cli_*` | 11.8절 | 11.8절 표(다른 PC · 다음 칸 · 실패) |

**OpenAI · Google API의 같은 판정(U2 — 개발팀이 공식 문서로 응답 모양 확인)**: HTTP 401 → `api_auth`, 403 → `api_permission`, 429(OpenAI 크레딧 소진 포함) → `api_rate_limit`, 5xx · 503 과부하 → `api_server`/`api_overloaded`, 400 → `api_bad_request`, 안전 정책 차단(OpenAI 거절 응답 · Gemini 차단 사유) → `api_refusal`, 출력 길이 한도로 끊김 → `api_max_tokens`, 연결 · 시간 초과 → `api_connection`/`api_timeout`. 처리(폴백 여부)는 위 표와 같음.

- **조용히 빈 응답을 주지 않습니다**(PLAN 5장 5번): 경로를 다 쓰고도 실패하면 마지막 오류 문구를 그대로, `history`에 앞 시도의 사유가 남습니다.
- API 키 오류로 폴백할 때 사용자에게 **키를 고치라는 안내**도 함께(설정 화면 키 옆 "최근 실패: 키가 올바르지 않음" — 16장 S3).

---

## 10. 워커 알림 방식 (P2)

> **서버 PC 전환 메모(재검토 — K1')**: 아래 표의 비용 계산은 Cloud Run 무료 범위 기준이라 **이제 해당 없음**. 서버 PC에서는 요청 수가 돈이 아니라 서버 PC 부하 · Supabase 질의 수로만 계산되고, 하나뿐인 서버 프로세스라 ① 긴 폴링도 DB `LISTEN` 없이 **메모리 신호로 깨우기**가 가능해졌습니다. 그래도 기획팀은 **④를 유지**하자고 추천합니다 — 긴 폴링은 요청마다 서버 스레드(동기 엔드포인트, 풀 40개)를 오래 잡고 Funnel을 거친 긴 연결 유지가 **확인되지 않았기** 때문(1단계 AC-78). 숫자(쉬는 간격 60초)는 K17 그대로, 지연이 불편하면 쉬는 간격을 30초로 줄이는 것은 상수 변경뿐. **팀장 결정(2026-10-07) K1': ④ 유지.**

### 10.1 선택지

(개정 전) 계산 기준: 사용자 5명 × PC 2대 = 워커 10개, Cloud Run 1 vCPU · 2GiB(1단계 9.2절), 무료 범위 **월 18만 vCPU초 · 36만 GiB초 · 요청 200만**(요청 기반 청구, 검색 결과로 확인 — 서울 리전 등급 적용 여부 **확인 필요**). 요청 기반 청구는 **요청을 처리하는 동안의 인스턴스 시간**을 셉니다(1단계 21장 확인).

| 선택지 | 지연 | 비용 · 부담 | 원칙 · 단점 |
|---|---|---|---|
| ① **긴 폴링**(서버가 요청을 25~50초 잡고 있다가 작업이 생기면 응답) | 거의 0 | 워커가 하나라도 켜져 있으면 **인스턴스가 24시간 요청 처리 중** → 월 약 259만 초 = 무료 vCPU초의 **약 14배**, 유료 수십 달러/월 예상(단가 **확인 필요**). DB를 몇 초마다 보거나 `LISTEN`이 필요(Session pooler에서 `LISTEN` 연결을 따로 잡아야 함) | 비추천 — 무료 범위 원칙과 충돌 |
| ② **짧은 폴링 고정 간격**(예: 15초) | 최대 15초 | 10대 × 4회/분 ≈ 월 173만 요청 → 무료 200만에 근접 | 단순하지만 비용과 지연이 맞바뀜 |
| ③ **Supabase Realtime 브로드캐스트로 깨우기** + 느린 안전망 폴링 | 거의 0 | Realtime 무료: 동시 연결 200 · 월 메시지 200만 · 초당 100(공식 문서 확인) — 넉넉. Cloud Run 요청 최소 | 워커가 **Supabase에도 연결**(anon 키 · 주소 — 공개 값이지만 PLAN "워커 → Cloud Run 서버로만 연결"과 어긋남). 워커에는 Supabase JWT가 없어 **공개 채널**(추측 불가 주제 이름, 내용 없는 "깨어나" 신호만)을 써야 하고 프로젝트 설정 "Allow public access"가 켜져 있어야 함. DB에서 `realtime.send()`로 보내려면 권한 · "첫 WebSocket 연결이 일별 파티션을 만든다"는 제약 **확인 필요** |
| ④ **적응형 폴링**(서버가 다음 간격을 정해 줌) + **앱 창 로컬 신호** | 보통 0~5초, 오래 쉰 뒤 첫 작업만 최대 60초 | 아래 10.2절 계산 — 월 약 110만 요청, vCPU초 약 11만(상한 추정) — 무료 안 | 원칙 그대로(Cloud Run만), 추가 설정 없음 |

### 10.2 기획팀 추천 — ④ 적응형 폴링 + 로컬 신호 (K1)

- 서버가 claim 응답의 `next_poll_s`로 간격을 정합니다:
  - **5초**: 그 사용자에게 `queued`/`running` CLI 작업이 있거나, 그 사용자의 화면 요청이 **최근 10분 안**에 있었음(메모리 기록 — 인스턴스가 여럿이면 덜 정확해도 허용).
  - **60초**: 그 밖(쉬는 중).
  - 작업을 하나 잡은 직후는 0초(빈 자리가 남았으면 곧바로 다시 잡기).
- **로컬 신호**: Electron 앱 창(클라우드 화면)에서 CLI 작업을 만들면 화면이 `window.paperlabDesktop.nudge()`(13.3절)를 불러 **같은 PC의 워커가 즉시 잡기**를 합니다. 가장 흔한 경우(앱 창에서 누름 → 그 PC가 실행)의 지연이 0이 됩니다.
- 다른 기기(노트북 브라우저)에서 만든 작업은 사용자가 최근 활동 중이므로 대개 5초 안, 오래 쉰 PC는 최대 60초 안에 잡힙니다.
- 요청 수(추정): 쉬는 시간 10대 × 60회/시 × 24시 × 30일 ≈ 43만 + 활동 시간(사용자당 하루 3시간 × PC 2대 × 720회/시 × 5명 × 30일) ≈ 65만 → **약 110만/월**(무료 200만 안). 요청 하나 100ms로 잡아도 vCPU초 약 11만(무료 18만 안) — 일반 사용분과 합쳐 빠듯해지면 쉬는 간격을 120초로(설정 상수).
- 부수 효과: (개정 전: Cloud Run 콜드 스타트가 줄어듦 — 이제 해당 없음) 워커 claim이 DB 질의를 계속 만들어 **Supabase 일시정지가 덜 일어날 수 있음** — 실제 사용 트래픽이지만 1단계 13.4절("정지를 피하려는 주기적 접속은 추천하지 않음")과 관련되므로 위험 표에 적고 정책 확인(**확인 필요**).
- ③ Realtime 깨우기는 **나중 확장 자리**만 둡니다(워커 구조가 "깨우기 신호 → 즉시 claim"을 받을 수 있게). 지연 불만이 생기면 K1을 다시 엽니다.

---

## 11. CLI 실행 (워커)

### 11.1 실행 위치 · 언어 (기획팀 추천 K4)

- 워커는 **Electron 앱 안의 Node.js 코드**로, 화면을 멈추지 않도록 **`utilityProcess`(Electron이 관리하는 별도 Node 프로세스)** 에서 돕니다. main 프로세스와는 메시지로 상태를 주고받습니다.
- 서버가 프롬프트 · 출력 형식을 정하고 결과 해석도 서버가 하므로(6.4 · 8.4절), 워커는 **"CLI를 안전하게 실행하고 원문을 돌려주는 얇은 실행기"** 입니다. Python을 PC에 둘 필요가 없습니다.
- 대안(K4 ②): Python 워커를 PyInstaller로 묶어 Electron이 띄움 — 기존 `ai.py` 실행 코드를 재사용하지만 설치 파일이 커지고 두 언어를 유지해야 함.

### 11.2 실행 파일 찾기 (Windows)

1st My paper 실측(`work/backend/ai/cli.py`): npm으로 설치한 claude · codex는 `.CMD` 셸 스크립트라 이름만 넘기면 못 찾음. 그리고 Node.js는 2024년 4월 보안 수정 이후 **`.bat`/`.cmd`를 `shell` 옵션 없이 `spawn`하면 `EINVAL` 오류**를 냅니다(CVE-2024-27980, Node 공식 공지 확인). `shell: true`로 돌리면 인자 이스케이프 책임이 우리에게 옵니다.

찾는 순서(기획팀 추천 — 개발팀이 이 PC에서 확인):
1. 앱 설정의 **사용자 지정 경로**(있으면).
2. `PATH`의 **`.exe`**: claude는 네이티브 설치(`%USERPROFILE%\.local\bin\claude.exe`) 또는 npm 패키지 안 `node_modules\@anthropic-ai\claude-code\bin\claude.exe`(이 PC에 있음 — v2.1.269).
3. npm 셸 스크립트(`%APPDATA%\npm\codex.cmd` 등) → 그 패키지의 `package.json` `bin` 항목을 읽어 **`node.exe <진입 js>`** 로 직접 실행(`.cmd`를 거치지 않음).
4. 위가 모두 안 되면 `cmd.exe /d /s /c "<경로>" <고정 플래그>` — **이때 인자는 미리 정한 고정 플래그만**(프롬프트 · 시스템 프롬프트 · 스키마는 절대 인자로 넘기지 않음 — 11.3절).

이 PC(관리자 PC) 확인 결과(2026-10-07): `%APPDATA%\npm`에 `claude.cmd` · `codex.cmd` · `gemini.cmd`, claude 2.1.269 · codex 0.130.0 · gemini-cli 0.59.0, Node.js(`C:\Program Files\nodejs\node.exe`, 버전 **확인 필요**).

**서버 PC 실측(2026-10-07, `KIMJUHYEON`)**: claude **2.1.210**, codex-cli 0.157.0, **gemini 없음**, Node v24.14. 주의: 11.4절 claude 명령의 `--permission-prompts none`은 **2.1.259 이상**에서만 있음(22장 공식 문서) → 서버 PC claude는 **업데이트가 필요**하거나, 워커가 버전을 보고 그 플래그 없이 동작하는 다른 방법을 써야 함(엔진별 최소 버전 표 — 개발팀, 19장 위험). gemini를 서버 PC 워커에서 쓰려면 설치 · 로그인 안내 필요(사용자가 원할 때만). **(개정 2026-10-07 Q-S3: 서버 PC에는 워커를 두지 않으므로 서버 PC CLI 버전은 해당 없음 — 같은 최소 버전 문제는 사용자 PC에도 있으니 엔진별 최소 버전 표는 그대로 필요. Node v24.14는 앱 빌드에 씀 — 13.7.1절)**

### 11.3 프롬프트 · 시스템 프롬프트 전달

- **프롬프트는 항상 stdin**(UTF-8 바이트로 쓰고 즉시 닫음). 1st My paper 실측: `.cmd`를 거치면 여러 줄 인자의 **첫 줄만 전달되고 나머지가 사라짐**(조용히 틀린 답), codex는 stdin을 열어 두면 "Reading additional input from stdin…"으로 멈춤.
- **시스템 프롬프트 · JSON 스키마는 임시 파일**로(`--system-prompt-file`, codex `--output-schema <파일>`). 지금 `ai.py`가 `--system-prompt <여러 줄 문자열>`을 인자로 넘기는 것은 Windows `.cmd` 경유 때 잘리는 **버그 후보**입니다(AC-58로 막음).
- claude stdin 상한 **10MB**(공식 문서 확인) → 서버가 4MB로 자름(8.4절).

### 11.4 엔진별 명령 (기획팀 안 — 플래그는 개발팀이 각 CLI `--help`로 확인)

| 엔진 | 명령(프롬프트는 stdin) | 결과 읽기 | 로그인 확인 |
|---|---|---|---|
| claude | `claude -p --output-format json --no-session-persistence --tools "" --setting-sources "" --strict-mcp-config --permission-prompts none --system-prompt-file <tmp> [--model <별칭>] [--json-schema <스키마 JSON>]` — 대화 · 글쓰기에서 중간 글을 보낼 때는 `--output-format stream-json --verbose --include-partial-messages` | JSON `result`(텍스트) · `structured_output`(스키마 썼을 때) · `is_error` · `total_cost_usd` · `session_id`. 종료 코드 0 = 성공. "실행 중 실패(예: 로그인 없음)는 stdout의 result로 나옴"(공식 문서) | `claude auth status` — 로그인 시 종료 코드 0, 아니면 1, JSON `authMethod`(공식 문서 확인) |
| codex | `codex exec --skip-git-repo-check --ephemeral --sandbox read-only --color never -o <tmp출력> [--output-schema <tmp스키마>] [-m <모델>] -`(마지막 `-` = stdin에서 프롬프트) | `-o` 파일의 마지막 메시지(1st My paper 실측: 이 파일을 최종 결과로 우선) | `codex login status` — 자격 증명이 있으면 0(공식 문서 확인) |
| gemini | `gemini -p "<짧은 고정 지시>" --output-format json [-m <모델>]`, 본문은 stdin | JSON `response` · `stats` · `error`. 종료 코드 0 성공 · 1 일반/API 오류 · 42 입력 오류 · 53 턴 한도(공식 문서 확인) | 전용 상태 명령이 없음 → **구현(2b)**: 사용자 폴더의 **`.gemini\oauth_creds.json` 또는 `.gemini\google_accounts.json` 파일이 있으면 로그인된 것**으로 봄(`USERPROFILE`). 파일이 있어도 실행이 인증 실패 문구(11.8절)로 끝나면 `cli_not_logged_in` |

공통:
- **시스템 프롬프트 전달(2b 구현)**: claude는 `--system-prompt-file`(임시 파일)로 보냅니다. **codex · gemini에는 시스템 프롬프트 플래그가 없어서**, 시스템 프롬프트를 **stdin 맨 앞에 붙입니다**(`<instructions>…</instructions>` 뒤에 빈 줄, 그 뒤에 프롬프트). **gemini의 `-p`는 늘 같은 고정 지시**("표준 입력으로 받은 지시와 자료를 따라 답만 출력하세요.")이고 본문은 모두 stdin입니다(11.3절 — 사용자 글을 인자로 넘기지 않음).
- **`--bare`는 쓰지 않습니다**: 공식 문서상 bare 모드는 "구독 로그인을 쓰지 않고 `ANTHROPIC_API_KEY`만" 씀 → CLI = 각자 구독(확정 취지)과 어긋남.
- **도구 끔 · 빈 작업 폴더**: claude `--tools ""`, codex `--sandbox read-only`, gemini는 비대화형에서 승인이 필요한 도구를 실행하지 않는지 **확인 필요**(안 되면 승인 모드 플래그로 막음). 논문 본문에 "이 명령을 실행하라" 같은 글이 있어도 PC에서 아무것도 실행되지 않게 하기 위함(AC-59).
- **작업 폴더(cwd)**: 작업마다 `%LOCALAPPDATA%\PaperLab\work\<job id>\`(빈 폴더)를 만들고 끝나면 지움. 1st My paper 실측: cwd가 git 저장소면 claude가 저장소 상태를 프롬프트에 섞어 엉뚱한 답을 냄. 사용자 이름에 한글이 있어도 동작해야 함(AC-61).
- **첫 호출 웜업**: 1st My paper 실측("처음 방문한 cwd의 첫 호출에 잡담이 섞임")이 지금 버전에도 있는지 **확인 필요** — 있으면 워커 시작 때 고정 웜업 폴더에서 한 번 `ping`.
- **환경 변수 정리**: 자식 프로세스에서 `CLAUDECODE` · `CLAUDE_CODE_*` · `CLAUDE_PREVIEW_*` · `CLAUDE_AGENT_SDK_VERSION` · `CLAUDE_PID` · `CLAUDE_EFFORT` · `ANTHROPIC_BASE_URL`을 뺍니다(1st My paper 실측 — 부모 세션 값이 섞이면 "organization does not have access"로 실패). **`ANTHROPIC_API_KEY` · `ANTHROPIC_AUTH_TOKEN` · `OPENAI_API_KEY` · `GEMINI_API_KEY`·`GOOGLE_API_KEY`도 뺄지**는 K9(기획팀 추천: 뺌 — CLI 경로는 구독 로그인만 쓰게 해서 예상 밖 종량 과금을 막음).

### 11.5 시간 제한 · 종료

| 작업 | 시간 제한(가정) | 근거 |
|---|---|---|
| `summary` | 20분 | 지금 `ai.py` 1200초 |
| `chat` · `write` | 10분 | |
- 시간 초과 · 취소 · 리스 잃음 → **프로세스 트리 전체 종료**: `taskkill /PID <pid> /T /F`(1st My paper 실측 — 트리를 안 끄면 좀비가 남음). `taskkill` 출력은 한국어 Windows에서 cp949라 읽지 않거나 오류 무시.
- 서버 쪽 절대 기한(구현 확인 2026-10-08): **`leased_at`(이번 잡은 시각 — 재할당 때마다 새로 기록) + `timeout_s` + 5분**까지만 리스를 연장함. 개정 전 기준 `started_at`(첫 잡기)이 아님. 이 시각이 지나면 하트비트가 `ok: false`/`lease_lost`로 거절되고 리스는 자연 만료돼 보통의 리스 만료와 똑같이 처리됨(6.3절).

### 11.6 모델 지정 (알려진 문제 — 기획팀 추천 K8)

- 원인 후보: 설정 `model`(Anthropic **API** 모델 id `claude-opus-5-5`)을 CLI `--model`에 그대로 넘김. 공식 문서는 `--model`이 별칭(`opus` · `sonnet` · `haiku` · `fable` · `default` 등)과 **전체 이름 둘 다** 받는다고 하므로, 이 PC의 claude 2.1.269가 그 이름을 몰랐거나(버전) 구독 계정에서 쓸 수 없는 모델이었을 가능성 — 정확한 원인은 **확인 필요**(개발팀이 이 PC에서 재현).
- 해결(추천): **CLI에는 API 모델 id를 넘기지 않습니다.** 엔진별 CLI 모델 설정 `cli_models`(9.4절):
  - claude: `default`(기본 — `--model`을 붙이지 않음 = 그 계정의 기본 모델) · `opus` · `sonnet` · `haiku` 중 선택 → 별칭만 넘김.
  - codex · gemini: `default`(붙이지 않음)만 2단계 제공, 직접 입력은 뒤 단계.
- 그래도 모델 오류(`model_not_found` 계열 문구 · 공식 문서의 "There's an issue with the selected model")가 나면 워커가 **`--model` 없이 한 번 다시** 실행하고 `stats.model_fallback: true`로 보고합니다. **결과 글에는 아무 문구도 붙이지 않습니다**(2b 결정, 팀장 승인 2026-10-08 — 요약은 JSON이라 문구를 붙이면 깨지고, 대화 · 글쓰기 글에 안내가 섞이면 그대로 원고에 들어갈 수 있음; 개정 전 "…기본 모델로 실행했어요"를 붙이는 안은 폐기). 대체 실행 사실은 **`stats.model_fallback`에만** 남깁니다(서버는 `stats`를 읽지 않으므로 — 8.6절 — 지금 화면에는 보이지 않음). **미확인**: 요청한 "로그에도 남김"은 워커 로그에 아직 없음(`worker.log`의 "작업 결과" 줄에는 `outcome` · `error_code` · 시간 · 종료 코드만) — 개발팀에 한 줄 추가를 요청할지 팀장 결정 필요(보고서 질문).

### 11.7 엔진 광고 · 탐지

- 워커 시작 · 30분마다 · 로그인 실패 직후에: 실행 파일 찾기(11.2절) → `--version`(30초 제한) → 로그인 확인(11.4절 표) → `hello`로 보고(8.3절). 탐지는 프로세스를 띄우므로 결과를 캐시(1st My paper `probe_cached` 120초와 같은 취지).
- **연결 전에도 탐지합니다**(2b 구현): 기기를 연결하기 전에도 워커가 시작하면 바로 엔진을 찾고 로그인을 확인해 "이 PC 상태" 창에 설치 · 로그인 상태를 보입니다(서버 요청은 연결된 뒤에만). **끈 엔진은 실행하지 않고 실행 파일이 있는지만 확인**합니다(화면의 켜기 체크를 쓸 수 있게 — 설치됨 · 끔으로 표시).
- **claude 최소 버전**: 탐지한 claude가 **2.1.259 미만**(`--permission-prompts` 없음 — 22장)이면 `hello`에 **`logged_in: false`로 광고**해 서버가 작업을 보내지 않게 하고, 앱 화면에는 **"업데이트 필요"**(이 PC 상태의 엔진 칩 "! 업데이트 필요" + "claude 2.1.259 이상이 필요해요")로 보입니다. 버전을 읽지 못하면 막지 않음(실패하면 `cli_exit`). 다른 엔진의 최소 버전 표는 아직 없음(20.3절).
- 사용자가 앱에서 엔진별로 **끄기**(이 PC에서 codex 작업 안 받기)를 할 수 있고, 끈 엔진은 광고하지 않습니다.
- `--version`이 되는데 로그인이 안 됐으면 `logged_in: false`로 광고 → 서버는 잡기에서 빼고, 화면 "연결된 PC"에 "codex: 로그인 필요" 표시(16장 S4).

### 11.8 실패 판정 (CLI)

| `error_code` | 판정 | 처리 |
|---|---|---|
| `cli_not_found` | 실행 파일 없음 | 이 PC를 `excluded_devices`에 → **다른 PC가 잡게** `queued`. 광고 다시 |
| `cli_not_logged_in` | claude 결과 `is_error` + 실패 뒤 `claude auth status` ≠ 0, codex `login status` ≠ 0, gemini는 `.gemini\oauth_creds.json` · `google_accounts.json`이 없거나 인증 실패 문구(11.4절 — 실제 문구는 개발 PC 실측 필요) | 위와 같음(다른 PC) + 그 엔진 `logged_in: false` 광고 |
| `cli_usage_limit` | 구독 사용 한도(결과 문구 · `rate_limit` 계열) | **다음 경로 칸으로 폴백**(없으면 실패 — "이 계정의 CLI 사용 한도에 걸렸어요") |
| `cli_model` | 11.6절 재시도 뒤에도 모델 오류 | 실패 |
| `cli_timeout` | 시간 제한 초과 | 실패(재시도 안 함 — 같은 입력이면 또 걸릴 가능성) |
| `cli_bad_output` | 종료 코드 0인데 결과가 비거나 JSON 아님 | 실패(서버 해석 실패는 `bad_output`) |
| `cli_exit` | 그 밖의 비정상 종료 | 다음 경로 칸으로 폴백, 없으면 실패. stderr 앞 500자(키 · 토큰 패턴 지움)를 `error`에 |
| `cancelled` | 취소 | `cancelled` |

- **구현 확인(2026-10-08)**: 워커가 `result`의 `error_code`로 보낼 수 있는 값은 위 표 중 `cancelled`를 뺀 7개 + `output_too_large`(8.6절) — 취소는 `error_code`가 아니라 `outcome: "cancelled"`로 보냄. 그 밖 값은 서버가 `cli_exit`으로 바꿔 처리.

---

## 12. 기기 연결 ("이 PC 연결")

### 12.1 코드

- 서버가 만드는 8자리, 헷갈리는 글자(0 · O · 1 · I · L) 뺀 **31자 알파벳**(`ABCDEFGHJKMNPQRSTUVWXYZ23456789` — 영문 대문자 23자 + 숫자 2~9 8자, 개정 전 "32문자"는 틀림), 4자리마다 대시: `K7QF-2M9X`. 정규식 `^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$`(AC-16). 10분 유효, 한 번만(5.2절).
- 화면 문구: "PaperLab 앱의 [이 PC 연결] 창에 이 코드를 넣어 주세요. 10분 동안 쓸 수 있어요."

### 12.2 두 가지 연결 흐름 (기획팀 추천 K15 — 둘 다)

| 흐름 | 언제 | 순서 |
|---|---|---|
| ① **앱 창에서 한 번에** | 이 PC의 앱 창에서 로그인한 상태 | 설정 "연결된 PC" → [이 PC 연결] → 화면이 `POST /api/devices/pair-codes`로 코드를 받아 `window.paperlabDesktop.pair(code)`로 **main 프로세스에 코드만** 넘김 → main이 `POST /api/worker/pair` → 토큰 저장. **토큰은 화면(원격 페이지)에 절대 오지 않음** |
| ② **코드 입력** | 다른 기기의 브라우저에서 코드를 만든 경우, 또는 앱 창이 다른 계정으로 로그인한 경우 | 트레이 메뉴 [코드로 연결…] 또는 앱의 "이 PC 상태" 창 → 그 창 안 **"연결" 구역**의 코드 칸(PD-7 — 따로 창 없음, 트레이에서 오면 코드 칸에 초점) → 코드 입력 → main이 교환 |

- 앱 창에 로그인한 계정과 워커가 연결된 계정이 **다르면** 앱의 "이 PC 상태" 창과 설정 "연결된 PC"에 경고: "이 PC의 작업 실행은 a***@example.com 계정에 연결돼 있어요"(`account_hint` — 13.4절).
- 이미 연결된 PC에서 다시 연결하면: 옛 토큰을 지우고 새 기기 행(이름 같음)이 생김 — 옛 행은 사용자가 해지하라고 안내(자동 해지는 서버가 옛 토큰을 모르므로 못 함, 가정).

### 12.3 토큰 저장 (PC)

- Electron **`safeStorage`**(Windows는 **DPAPI** — 공식 문서: "같은 로그온 자격 증명을 가진 사용자만 복호화", 같은 사용자 세션의 다른 프로그램으로부터는 보호하지 못함)로 암호화해 `%APPDATA%\PaperLab\device.bin`에 저장. `safeStorage.isEncryptionAvailable()`은 앱 `ready` 뒤에만 참.
- 암호화를 못 쓰는 환경이면 **저장하지 않고**(메모리에만 — 앱을 다시 켜면 다시 연결) 안내(가정).
- Windows 자격 증명 관리자(keytar 등)는 쓰지 않음: keytar는 유지보수가 끝났고 `safeStorage`가 같은 DPAPI 보호를 기본 제공(기획팀 추천).
- 토큰 · 서버 주소 · 기기 id 말고는 저장하지 않음(DB 주소 · Supabase 키 · R2 키 없음 — AC-80).

### 12.4 해지

- 설정 "연결된 PC" → [연결 해지] → 확인 창("이 PC는 더 이상 작업을 받지 않아요. 실행 중인 작업은 다른 PC로 넘어가요.") → `DELETE /api/devices/{id}`. 그 PC가 실행 중이던 작업은 바로 `queued`로 돌아가(다른 PC가 이어받음) 응답의 `requeued_jobs`로 세지만, **이미 취소를 요청한(`cancel_requested`) 작업은 다시 대기하지 않고 `cancelled`로 끝나며 `requeued_jobs`에 들어가지 않음**(2a 품질 수정).
- 그 PC 워커는 다음 요청에서 401 `device_revoked` → 실행 중 프로세스를 끄고 토큰 파일을 지우고, 앱에 "이 PC 연결이 해지됐어요 — [다시 연결]"(AC-15).
- **401 `device_auth_required`도 같은 처리**(2b 구현): 토큰 형식 · 해시가 맞지 않거나(예: 서버에서 기기 행이 지워짐) 없는 기기면 워커는 실행 중 프로세스를 끄고(결과는 올리지 않음) **토큰 파일(`device.bin`)을 지우고** 연결 안 됨 상태로 돌아갑니다(`device_revoked`일 때만 "해지됐어요" 알림 · 안내). 어떤 401이든 토큰을 계속 쥐고 재시도하지 않음.
- 앱 제거(언인스톨)는 서버 기기 행을 지우지 못함 → 설치 안내 · 설정 화면에 "PC를 더 이상 쓰지 않으면 여기서 해지해 주세요".

---

## 13. Electron 앱

### 13.1 구조

```
desktop/                        (같은 저장소 study99web — 기획팀 추천 K11)
  package.json                  앱 이름 · 버전(SemVer — 배포의 기준) · 의존성. package-lock.json 커밋(npm ci)
  electron-builder.config.js    NSIS · protocols · fuses · publish: generic — deploy/server-pc/server.json의
                                public_url을 빌드 때 읽어 extraMetadata.paperlabServer(앱 package.json)와
                                publish url(= public_url + "/downloads/")에 넣음(주소 한 곳 원칙 — 1단계 S10 · AC-69).
                                `--config electron-builder.config.js`로 지정(package.json의 pack · dist 스크립트)
  main/
    main.js                     생명주기 · 단일 인스턴스 잠금 · 앱 창 · 이 PC 상태 창 · 트레이 · 자동 시작 · 딥 링크 · 워커 띄우기 · 기기 연결
    window.js                   앱 창(클라우드 화면) BrowserWindow · 탐색 제한 · 새 창 처리 · 권한 · app:// 처리기
    links.js                    외부 링크 판정 · 개수 제한(13.2.1절, 순수 함수 — AC-86)
    config.js                   서버 주소 읽기(배포본은 package.json의 paperlabServer, 개발 실행은 환경 변수 `PAPERLAB_SERVER_URL`이 반드시 있어야 하고 `127.0.0.1` · `localhost` · `[::1]`만 받음. 없거나 운영 주소면 오류 창을 띄우고 시작하지 않으며 server.json으로 넘어가지 않음. `PAPERLAB_NO_DETECT=1`이면 CLI 탐지를 하지 않음)
    auth-bridge.js              시스템 브라우저 구글 로그인 ↔ paperlab:// 콜백(13.4절)
    updater.js                  electron-updater(13.7절)
    ipc.js                      preload 요청 처리(보낸 프레임 출처 검사)
    store.js                    기기 토큰(safeStorage) · 앱 설정
  lib/
    log.js  redact.js           로그 파일 · 회전(13.8절) · 비밀값 지우기 (main · worker 공용)
  worker/                       utilityProcess 에서 도는 워커(11장)
    entry.js  worker.js  api-client.js  cli-runner.js  resolve-exe.js  engines.js
  preload/
    preload.js                  하나뿐 — 페이지 출처에 따라 `paperlabDesktop`(서버 출처 http(s), 13.3절) 또는
                                `paperlabLocal`(app://, 첫 실행 · 이 PC 상태 · 연결 불가 화면)을 내보냄. 이 분기는 편의일 뿐이고
                                **실제 경계는 main(ipc.js)이 모든 IPC 처리기에서 보낸 프레임의 출처를 다시 검사하는 것**(13.2절 IPC)
  ui/                           앱 자체 화면(app:// 사용자 정의 프로토콜로 — file:// 안 씀)
    setup.html  status.html  offline.html  *.js   theme.js   (코드로 연결은 status.html 안 구역 — PD-7, pair.html 없음)
    app.css                     빌드 때(scripts/copy-css.js) paperlab/static/css/app.css를 복사(PD-5 — 손으로 고른 사본을 두지 않음, .gitignore 대상)
    local.css                   로컬 화면 전용 몇 줄만
  scripts/copy-css.js           app.css 복사
  scripts/make_icons.py         아이콘 그리기(아래 "아이콘")
  build/icon.ico  tray-{idle,running,paused,error}.ico
  test/*.test.js                node:test + 가짜 CLI(17장 F)
```

- **아이콘은 임시 그림입니다**(개발팀이 `scripts/make_icons.py`로 그림 — 디자인팀 확인 대기. 디자인 확인 뒤 `build/*.ico`만 바꾸면 됨).
- **데이터 폴더**: 설치본은 `%APPDATA%\PaperLab`(로그 · 설정 · `device.bin`), 작업 폴더 `%LOCALAPPDATA%\PaperLab\work`. **개발 실행(`npm start`)은 `PaperLab-dev`**로 따로 써서 설치본의 데이터와 섞이지 않고, 자동 시작 · 업데이트 확인도 하지 않음.

- 언어: **빌드 없는 JavaScript**(지금 화면과 같은 방식, TypeScript 안 씀 — 가정). 의존성은 `electron` · `electron-builder`(개발) · `electron-updater`로 최소(로그는 자체 구현 또는 `electron-log` — 개발팀 재량).
- Electron 버전: 빌드 시점의 **최신 안정판**으로 고정하고 릴리스 때 올림(보안 체크리스트 16번 "현재 버전 사용").

### 13.2 앱 창 (클라우드 화면) — 보안

Electron 공식 보안 체크리스트(20개 항목)를 따릅니다. 원격 페이지(서버 PC가 Funnel로 내보내는 화면 — 출처 `https://kimjuhyeon.tailac17f6.ts.net`)를 띄우므로 특히:

| 항목 | 설정 |
|---|---|
| Node 통합 | `nodeIntegration: false`(Electron 5부터 기본), `nodeIntegrationInWorker: false` |
| 문맥 격리 | `contextIsolation: true`(12부터 기본) |
| 샌드박스 | `sandbox: true`(20부터 기본) |
| `webSecurity` | 끄지 않음, `allowRunningInsecureContent` 안 씀, 실험 기능 · `enableBlinkFeatures` · `<webview>` 안 씀 |
| 세션 | `partition: "persist:paperlab"`(로그인 유지). 로그아웃은 화면이 처리(1단계) |
| 탐색 제한 | `will-navigate` · `will-redirect`: 앱 창은 **설정된 서버 출처로만** 이동. 그 밖 주소는 막고(`preventDefault`), 13.2.1절 규칙에 맞으면 시스템 브라우저로 엶, 맞지 않으면 아무것도 하지 않음 |
| 새 창 | `setWindowOpenHandler`: **언제나 `{ action: "deny" }`** — 앱 안에 새 `BrowserWindow`를 만들지 않음(앱은 한 창). 같은 출처는 그냥 막고, 그 밖 주소는 13.2.1절 규칙에 맞을 때만 `shell.openExternal`로 시스템 브라우저에서 엶. 지금 화면의 "빈 창 먼저 열고 주소 넣기"(1단계 6.7절) 흐름이 앱에서도 동작하는지 개발팀 확인(AC-73) |
| `shell.openExternal` | 13.2.1절 규칙을 통과한 주소만(스킴 http(s)만, 체크리스트 15번). main 프로세스에서만 부르고 화면(preload)에 내주지 않음(13.3절) |
| 권한 요청 | `setPermissionRequestHandler`: 클립보드 쓰기(`clipboard-sanitized-write` — 인용 복사)만 허용, 나머지(카메라 · 마이크 · 위치 · 알림 등) 거부 |
| 다운로드 | 기본 저장 대화상자(하이라이트 내보내기 · 워드/한글 내보내기 Blob 다운로드) |
| IPC | 모든 `ipcMain` 처리기가 **보낸 프레임의 출처**를 검사(체크리스트 17번): 클라우드 preload 채널은 서버 출처의 최상위 프레임만, 로컬 preload 채널은 `app://`만 |
| Fuses | **구현(2b, `electron-builder.config.js`의 `electronFuses` — 빌드 때 설정)**: 끔 — `RunAsNode` · `NodeOptions` 환경 변수 · `--inspect` 계열 인자(`enableNodeCliInspectArguments`) · `grantFileProtocolExtraPrivileges`. 켬 — `OnlyLoadAppFromAsar` · `CookieEncryption`. **ASAR 무결성 검사(`EnableEmbeddedAsarIntegrityValidation`)는 설정하지 않아 끔(Electron 기본값)** — 서명 없는 설치본에서 시작이 실패할 위험이 있고 아직 시험하지 않았기 때문(**확인 전** — 켜려면 AC-70 실환경에서 시작 · 업데이트가 되는지 먼저 확인) |
| 탐색 · 하위 프레임 | 위 "탐색 제한"에 더해 `will-frame-navigate`로 **다른 출처 iframe을 막음**(13.2.1절 7번). 첫 실행 · 이 PC 상태 · 연결 불가 화면(`app://ui`)의 CSP는 `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; …` |
| CSP | 서버가 CSP를 아직 안 보냄(1단계 범위 밖) — Electron 개발 콘솔 경고 허용. 로컬 화면(`app://`)에는 엄격한 CSP를 둠 |
| 개발자 도구 | 배포본에서는 메뉴에서 숨김(단축키로는 열림 — 문제 조사용, 가정) |

### 13.2.1 외부 링크 열기 — 시스템 브라우저 (1A 연결 · 확정 IK-6)

근거: [inha-proxy.md](inha-proxy.md) 12장 · 15.2절 IK-6 **① 시스템 브라우저**(팀장 확정 2026-10-07). 1A에서 화면에 들어간 "인하대에서 보기" · "학교 DB에서 찾기"(RISS · DBpia · KISS) · [학교 로그인] · "Google Scholar에서 보기"는 모두 새 탭 링크(`target="_blank"` 또는 `window.open(url, "_blank", "noopener,noreferrer")`)라, 앱 창에서는 `setWindowOpenHandler`로 들어옵니다. 이 링크들이 앱에서도 열리도록 아래 규칙을 둡니다.

**원칙**

- 외부 학술 · 학교 링크는 **`shell.openExternal`로 사용자의 기본(시스템) 브라우저에서** 엽니다. **앱 안 창(새 `BrowserWindow` · 별도 세션 파티션 · `<webview>`)에서는 열지 않습니다.** IK-6 ②(앱 안 전용 세션 창 `persist:inha-openlink`)는 채택하지 않음.
- 그래서 학교(openlink) 로그인 상태 · 쿠키는 **시스템 브라우저가 가지고, 앱은 아무것도 보관하지 않습니다.** 앱의 `persist:paperlab` 파티션에 학교 세션이 생기지 않고, 학교 아이디 · 비밀번호는 앱도 서버도 다루지 않습니다(inha-proxy 2장 "대리 로그인 금지"와 같음).
- 학교 사이트에서 받은 PDF는 시스템 브라우저의 다운로드 폴더에 저장되고, 사용자가 앱 창의 [PDF 첨부]로 올립니다(앱이 자동으로 첨부하지 않음 — inha-proxy 2장).
- 처음 쓸 때 안내 창(inha-proxy 10장 G-1)은 화면 코드 그대로 앱 창에서도 뜨고, [계속 열기]가 부르는 `window.open`이 이 규칙으로 시스템 브라우저를 엽니다(화면 코드는 바꾸지 않음).

**판정 규칙 — `isExternalAllowed(url) → boolean`** (main 프로세스, `desktop/main/window.js` 안 또는 따로 뺀 모듈 — 단위 테스트할 수 있게 순수 함수로)

1. `new URL(url)`로 해석합니다. 실패하면 거부.
2. **스킴 허용 목록은 `http:` · `https:` 둘뿐**입니다. 그 밖(`file:` · `javascript:` · `data:` · `blob:` · `about:` · `mailto:` · `smb:` · `ftp:` · `ms-*:` 등 OS에 등록된 사용자 정의 프로토콜 포함)은 **모두 거부**합니다. 대소문자는 URL API가 정규화한 `protocol` 값으로 비교합니다.
3. 호스트는 URL API가 정규화한 `hostname`(소문자 · 퓨니코드)으로 비교합니다. 문자열 앞부분 비교(`startsWith`)를 쓰지 않습니다(`https://scholar.google.com.evil.example/` 같은 주소를 막기 위해).
4. 아래 **이름 붙은 호스트**는 반드시 열려야 합니다(5번에 따라 목록 밖 http(s)도 엶).

| 호스트 | 무엇 | 근거 |
|---|---|---|
| `*.openlink.inha.ac.kr` (반드시 열려야 하는 목록에 루트 `openlink.inha.ac.kr`는 넣지 않음 — 다만 K21 ①에 따라 루트도 http(s)이므로 열림) | "인하대에서 보기" · 학교 DB 검색 바로가기(프록시 주소, 항상 https) | inha-proxy 5.2 · 7장, AC-2 |
| `lib.inha.ac.kr` | [학교 로그인] (`https://lib.inha.ac.kr/login`) | inha-proxy 8.5절 · AC-2a |
| `scholar.google.com` | "Google Scholar에서 보기" · 논문 찾기 [Google Scholar] | inha-proxy 9장 |
| `doi.org` · `arxiv.org` | 서재 정보 탭의 DOI · arXiv 링크 | AC-73 "화면 안의 외부 링크(DOI 등)" |
| `*.r2.cloudflarestorage.com` | "PDF 파일 열기"(R2 서명 주소) | 이 절 개정 전부터 있던 항목 |
| ~~`github.com` (이 저장소의 Releases 주소)~~ | ~~GitHub Releases 링크~~ — **삭제**(U10 변경 2026-10-07: 설치 파일은 서버 출처 `/downloads/`에서 받으므로 외부 링크가 아님. 목록 밖 http(s)는 K21 ①로 어차피 열림) | — |

5. **위 목록 밖의 http(s) 호스트**(서재 정보 탭 "링크" 줄의 출판사 주소, 논문 찾기 결과의 제목 · [PDF] 링크처럼 호스트를 미리 알 수 없는 논문 주소)도 **시스템 브라우저로 엽니다**(**팀장 결정 K21 ①, 2026-10-07** — AC-73 "화면 안의 외부 링크는 시스템 브라우저로"를 지키기 위함). 결국 주소에 대한 판정은 **스킴(2번)과 해석 가능 여부(1번)** 로 정해지고(그 위에 요청한 곳 · 개수 조건 7 · 8번), 위 표는 반드시 열려야 하는 대표 호스트(AC-86 확인 대상)입니다. 이 결정과 상관없이 **앱 창 자체는 서버 출처 밖으로 이동하지 않고**(탐색 제한), **앱 안에 새 창을 만들지 않습니다**(새 창 처리기는 늘 `deny`).
6. 허용되면 `shell.openExternal(url)`(정규화한 `href`)을 부르고, 새 창 처리기는 그대로 `{ action: "deny" }`를 돌려줍니다. 거부되면 아무 창도 열지 않고 `main.log`에 "외부 링크 거부"와 **거부 이유(스킴 · 출처 · 개수) · 스킴만** 남깁니다(주소 전체 · 질의는 로그에 남기지 않음 — 검색어 · 논문 제목이 들어 있음, 13.8절).
7. **요청한 곳 검사**: 새 창 · 외부 열기 요청(새 창 처리기 · `will-navigate` · `will-redirect`)은 **설정된 서버 출처(`https://kimjuhyeon.tailac17f6.ts.net`)의 최상위 프레임**에서 온 것만 처리합니다. 하위 프레임(iframe)이나 다른 출처 문서에서 온 요청은 URL과 상관없이 거부합니다(13.2절 IPC 출처 검사와 같은 원칙). **요청한 프레임을 알아내는 방법 — 해결(2b 구현, 팀장 승인 2026-10-08)**: Electron의 `setWindowOpenHandler`에 넘어오는 정보(`HandlerDetails`)에는 **요청한 프레임이 없습니다**. 그래서 처리기를 이렇게 나눕니다.
   - **새 창 처리기**: 앱 창 안에 **하위 프레임이 하나라도 있으면**(`framesInSubtree`가 최상위 프레임 하나보다 많으면) 요청을 **거부**합니다. 최상위 프레임만 있을 때는 최상위 프레임(서버 출처)에서 온 것으로 보고 규칙대로 판정합니다. 늘 `{ action: "deny" }`를 돌려주는 것은 그대로.
   - **다른 출처 iframe 자체를 막음**: `will-frame-navigate`에서 하위 프레임이 서버 출처(또는 `about:blank` · `about:srcdoc`) 밖으로 이동하려 하면 `preventDefault`. 그래서 앱 창에는 **다른 출처 문서가 하위 프레임으로 존재할 수 없습니다**(위 거부 조건이 서버 출처 하위 프레임에만 해당).
   - **`will-navigate` · `will-redirect`**: 이벤트의 **`initiator`**(요청한 프레임)로 출처 · 최상위 여부를 판정합니다(`will-redirect`는 최상위 프레임의 리다이렉트만 다루고, `initiator`가 없으면 최상위 프레임으로 봄 — 하위 프레임의 이동은 위 `will-frame-navigate`가 맡음). 서버 출처로 가는 이동은 그대로 두고, 그 밖은 막은 뒤 13.2.1절 규칙으로 시스템 브라우저에 엶.
   - 판정 자체(`decideExternal` — 스킴 · 출처 · 최상위 · 개수)는 순수 함수라 AC-86 (a2)로 단위 시험합니다. 실제 프레임 구성(하위 프레임이 있을 때 거부)은 AC-86 (b)에서 수동 확인.
8. **개수 제한**: 외부 열기는 **짧은 시간 안 개수를 제한**합니다 — 기본 **10초에 5개**(가정 — 상수 한 곳). 넘는 요청은 열지 않고 거부합니다(브라우저의 팝업 차단 같은 장치가 `shell.openExternal`에는 없으므로, 화면이 잘못되거나 탈취돼도 시스템 브라우저 창을 마구 열지 못하게). 제한 판정은 시계를 주입받는 순수 함수로 만들어 단위 테스트합니다.

- 변환 함수(`toInhaProxy` 등)의 출력 검사(inha-proxy 5.2절 8단계 · AC-2)는 화면에서 이미 하므로, 이 규칙은 그 위에 한 겹 더 두는 **앱 쪽 방어**입니다(화면이 바뀌거나 다른 링크가 섞여도 위험한 스킴이 OS로 넘어가지 않게).
- 링크마다 앱 창에 "브라우저에서 열었어요" 같은 알림은 두지 않습니다(가정 — 시스템 브라우저가 앞으로 나오므로).

### 13.3 클라우드 화면에 내주는 API (`window.paperlabDesktop`)

`contextBridge`로 **아래만** 노출합니다(체크리스트 20번 "Electron API를 노출하지 않음"). preload는 `preload/preload.js` 하나이며, **서버 출처(http · https) 페이지에서만** `paperlabDesktop`을 내보내고 `app://` 페이지에는 별도 `paperlabLocal`(첫 실행 · 이 PC 상태 · 연결 불가 화면용 — `state` · `action` · `onState`)을 내보냅니다. 어느 쪽이든 **실제 경계는 main(`ipc.js`)의 IPC 출처 검사**입니다(클라우드 채널 `pl:*`은 서버 출처의 최상위 프레임만, 로컬 채널 `local:*`은 `app://ui`의 최상위 프레임만 — 맞지 않으면 거부하고 로그).

| 함수 | 하는 일 | 돌려주는 값 |
|---|---|---|
| `info()` | 앱 버전 · 이 PC 연결 상태 | `{appVersion, paired, deviceId, deviceName, accountHint, workerState: "idle"|"running"|"paused"|"offline"|"update_required", engines}` — **토큰 없음** |
| `pair(code)` | 12.2절 ① | `{ok, deviceName}` 또는 `{ok:false, error}` |
| `nudge()` | 작업을 만들었으니 즉시 잡기(10.2절) | 없음 |
| `startGoogleLogin(authorizeUrl)` | 13.4절 — main이 **URL이 `{SUPABASE_URL}/auth/v1/authorize`로 시작하는지 검사** 후 시스템 브라우저로 엶 | `{ok}` |
| `onAuthCallback(fn)` | `paperlab://auth-callback?code=…`를 받으면 `fn(code, error)` — 성공이면 `error`는 빈 문자열, 실패 · 취소면 `code`가 빈 문자열이고 `error`에 이유(최대 80자). 2a 화면(`app.js`)이 이 두 인자 모양으로 부름 | 구독 해제 함수 |
| `openStatusWindow()` | 앱의 "이 PC 상태" 창 열기 | 없음 |

화면(`static/js/*`)은 `window.paperlabDesktop`이 있을 때만 이 기능을 씁니다(브라우저에서는 없음 — 그대로 동작).

**2b가 맞출 계약 — 2a 화면 코드(`app.js` · `dialogs.js`)가 실제로 부르는 모양**(구현 확인 2026-10-08, 위 표와 일치):
- `info()`는 **비동기(Promise)** 입니다 — 화면이 `await dk.info()`로 받고, 예외(reject)는 "앱 정보 없음"으로 처리(`try/catch`). 화면이 읽는 필드: `appVersion`(문자열), `paired`(불리언), `deviceId`(서버 `devices.id`와 같은 숫자 — 기기 목록의 "이 PC" 칩 비교), `deviceName`, `accountHint`(서버가 주는 `a***@example.com` 모양 그대로 — 화면이 로그인 계정을 같은 규칙으로 가려 문자열을 비교), `workerState`: 화면이 구분하는 값 `"paused"` · `"update_required"` · `"offline"`(그 밖 값 `idle` · `running`은 "연결됨"으로 표시). `engines`는 2a 화면이 읽지 않음. 연결 전(`paired: false`)에는 나머지 필드가 비어 있어도 됨.
- `pair(code)`: 인자는 `POST /api/devices/pair-codes`가 준 문자열 **그대로**(`"K7QF-2M9X"` — 대시 포함, 서버가 정규화하므로 앱이 고치지 않아도 됨). 반환(Promise): 성공 `{ok: true, deviceName}`, 실패 `{ok: false, error: "<화면에 그대로 보일 문구>"}`. 화면은 `!r || !r.ok`이면 `r.error`(없으면 "잠시 후 다시 시도해 주세요.")를 알림에 씀. **성공 직후 `info()`가 `paired: true`와 새 `deviceId`를 돌려줘야 함**(화면이 다시 부름).
- `openStatusWindow()`: 인자 없음, 반환값은 쓰지 않음. 계정 메뉴의 "이 PC 상태" 항목이 호출.
- 세 함수 모두 토큰을 반환하지 않음(AC-74).
- 2a 화면은 `nudge()` · `startGoogleLogin()` · `onAuthCallback()`을 **아직 부르지 않음**(코드 검색 0건) — 10.2절 로컬 신호와 13.4절 로그인 흐름은 2b에서 화면 코드(`app.js` · `auth.js`)에 더해야 함(21.0절 2b 표). (2b 개발 뒤 확인 2026-10-08: `app.js` · `jobs.js`가 이 함수들을 부름 — `onAuthCallback` · `startGoogleLogin` · `nudge`.)

### 13.4 앱 창에서의 구글 로그인 (P12 — 기획팀 추천 K10)

**공식 근거**: Google은 OAuth 로그인을 **내장 웹뷰(embedded user-agent)** 에서 막습니다("This browser or app may not be secure"). RFC 8252(네이티브 앱 OAuth)도 시스템 브라우저를 쓰라고 합니다. 사용자 에이전트를 속이는 우회는 Google이 금지합니다. → Electron 창 안에서 구글 로그인을 끝내는 방식은 **쓰지 않습니다**.

| 선택지 | 방식 | 장단점 |
|---|---|---|
| ① **시스템 브라우저 + `paperlab://` 딥 링크 + PKCE**(추천) | 화면(supabase-js)이 `signInWithOAuth({provider:"google", options:{redirectTo:"paperlab://auth-callback", skipBrowserRedirect:true}})`로 인증 주소만 받음 → `paperlabDesktop.startGoogleLogin(url)` → 시스템 브라우저에서 구글 로그인 → Supabase가 `paperlab://auth-callback?code=…`로 돌려보냄 → Windows가 앱을 다시 부름 → 단일 인스턴스 잠금의 `second-instance` 이벤트로 main이 받음 → 화면에 `code` 전달 → 화면이 `exchangeCodeForSession(code)`(PKCE 검증자는 앱 창 저장소에 있음) | 공식 권장 방식. 다른 앱이 같은 스킴을 가로채도 PKCE 검증자가 없어 코드가 쓸모없음. **Supabase Redirect URLs에 `paperlab://auth-callback` 추가**(사용자 대시보드 작업) — 사용자 정의 스킴 허용 여부 **확인 필요**(모바일 딥 링크 문서상 가능) |
| ② 시스템 브라우저 + 루프백(`http://127.0.0.1:<임의 포트>/callback`) | main이 잠깐 로컬 서버를 열어 받음 | 프로토콜 등록 불필요. Redirect URLs에 포트 와일드카드 필요(**확인 필요**), PC에 잠깐 포트를 염(PLAN "PC에 포트를 열지 않음"은 워커 대상이지만 혼동 소지) |
| ③ 앱 창 안에서 구글 로그인 | 1단계 Edge `--app` 바로가기처럼 | Electron에서는 Google이 막음 — **채택 불가** |

- 로그인 기다리는 동안 앱 창에 "브라우저에서 로그인을 마쳐 주세요 — [브라우저 다시 열기] [취소]"(16장 E5).
- **콜백 전달(2b 구현)**: `paperlab://auth-callback?...`를 받으면(`second-instance`의 명령줄 · 처음 실행 인자) main은 `code`(모양 검사 `^[A-Za-z0-9._~-]{8,512}$`) 또는 `error`만 꺼내 **이 앱이 `startGoogleLogin`으로 로그인을 시작한 뒤 15분(`LOGIN_WAIT_MS`) 안에 들어온 콜백만** 앱 창이 서버 화면을 다 받은 뒤 화면에 넘깁니다(받는 때 화면이 로딩 중이면 `did-finish-load`에서 다시). 콜백을 한 번 받으면 대기를 끝냅니다. 그 밖의 콜백(처음 실행할 때 인자로 들어온 것 포함)은 무시하고 로그만 남깁니다. main은 그 창이 이미 로그인했는지 판단하지 않고, **이미 로그인된 화면은 콜백을 무시합니다**(화면 쪽 `app.js`가 로그인 상태면 건너뜀). PKCE 검증자는 처음 로그인을 시작한 화면의 저장소에만 있으므로, 다른 앱이 같은 스킴으로 코드를 보내도 교환되지 않습니다.
- 1단계 AC-69(Edge `--app` 창 안 로그인)는 웹 바로가기 쪽 기준으로 그대로 둡니다.

### 13.5 트레이 · 자동 시작 · 백그라운드

| 항목 | 결정(**확정 U4: 자동 시작 + 트레이**, 세부는 기획팀 안) |
|---|---|
| 창 닫기(X) | 앱을 끄지 않고 **트레이로 숨김**(워커 계속). 처음 한 번 "PaperLab은 트레이에서 계속 실행돼요" 안내 |
| 트레이 메뉴 | 열기 · 이 PC 상태 · 작업 받기 일시 중지/다시 시작 · 업데이트 확인 · 로그 폴더 열기 · 종료 (메뉴 첫 줄 · 툴팁 · 업데이트 준비됨 항목 · [코드로 연결…] 등 세부 문구는 시안 11.5절) |
| 트레이 아이콘 상태 | 보통 / 실행 중(작업 수) / 일시 중지 / 연결 안 됨 · 오류 — 디자인팀(16장 E3). 파일은 `desktop/build/tray-{idle,running,paused,error}.ico`(16 · 20 · 24 · 32px 한 파일 — PD-6, Windows 배율 100~200%에 맞는 크기를 OS가 고름) |
| 종료 | 실행 중 작업이 있으면 확인 창("실행 중인 작업 n개는 다른 PC로 넘어가거나 다시 대기해요") → `bye` 후 종료 |
| 자동 시작 | **켬**(기본) — Windows 로그인 때 트레이로만 시작(`app.setLoginItemSettings({openAtLogin:true, args:["--hidden"]})`). 앱 설정에서 끌 수 있음 |
| 절전 | 작업 실행 중에만 `powerSaveBlocker.start('prevent-app-suspension')`, 끝나면 해제 |
| 단일 실행 | `requestSingleInstanceLock()` — 두 번째 실행은 첫 창을 앞으로(워커 중복 방지 · 딥 링크 수신) |
| 트레이 알림 | 트레이 풍선은 `tray.displayBalloon`으로 띄움(Windows 알림 센터 API 아님). 앱 창이 숨었을 때만(설정에서 끌 수 있음), 첫 숨김 안내 · 업데이트 준비됨 · 연결 해지는 늘 |
| 서버 주소 | **확정 U6: 설치 파일에 넣기** — `https://kimjuhyeon.tailac17f6.ts.net`. 저장소의 주소 설정 한 곳(1단계 S10 — **`deploy/server-pc/server.json`의 `public_url`**, 별도 `desktop/app-config.json`은 **없음**)에서 빌드 때 `electron-builder.config.js`가 읽어 앱 `package.json`의 `paperlabServer`(`extraMetadata`)로 넣음. 앱은 `https:` 출처가 아니면 시작하지 않음(오류 상자 후 종료). 첫 실행에 주소 입력 화면 **없음**. 앱 설정에 주소 바꾸기 칸도 두지 않음(가정 — 주소가 바뀌면 새 릴리스. 1단계 13.2절 "이름을 바꾸지 않음"). 개발 실행(`npm start`)은 환경 변수 `PAPERLAB_SERVER_URL`이 **반드시** 있어야 하고 `127.0.0.1`·`localhost`·`[::1]`만 받음 — 없거나 운영 주소면 시작하지 않음(server.json으로 넘어가지 않음, 13.1절 config.js). 배포본은 이 변수를 무시 |

### 13.6 앱 자체 화면 (로컬, `app://`)

- **첫 실행**(U6 개정): 내장 주소로 `GET {주소}/api/health` · `/api/public-config` 확인 → 앱 창 열기. 주소 입력 단계 없음.
- **서버에 연결할 수 없음(신규)**: 확인이 실패하거나 앱 창이 서버에서 화면을 못 받으면 로컬 화면 "PaperLab 서버에 연결할 수 없어요. 서버 PC가 꺼져 있거나 인터넷이 끊겼을 수 있어요. 관리자에게 알려 주세요. [다시 시도]"(30초마다 자동 재시도). 워커는 그동안 claim을 쉬고(백오프 최대 5분 — 가정) 연결되면 이어서. (서버 PC 한 대에 모두 걸림 — 1단계 18장)
- **이 PC 상태**: 연결된 계정(`account_hint`) · 기기 이름 · 엔진별 상태(설치 · 버전 · 로그인 · 켜짐/끔 · 동시 실행 수) · 실행 중 작업(종류 · 경과 시간 · [취소]는 서버 취소 API가 아니라 워커가 끄고 `cancelled` 보고) · **"연결" 구역**(코드로 연결 — E6, PD-7) · [연결 끊기(이 PC에서 토큰 삭제)] · [로그 폴더 열기] · 앱 버전 · 업데이트 상태.
- 작업 완료 · 실패 알림: 트레이 풍선(앱 창이 숨었을 때만, 끌 수 있음 — 가정).
- **업데이트 상태(개정 U10)**: "이 PC 상태"에 지금 버전 · 마지막 확인 시각 · 상태(최신 / 받는 중 n% / 준비됨 — [지금 다시 시작] / 확인 실패). 업데이트 주소는 서버와 같은 출처(`/downloads/`)라 **서버에 연결할 수 없을 때의 확인 실패는 오류 창을 띄우지 않고** 상태 줄에만 "업데이트 확인 실패 — 서버 연결 안 됨"(다음 주기에 다시). 내려받은 파일의 sha512가 맞지 않으면 설치하지 않고 "업데이트 파일이 손상됐어요 — 다음에 다시 받아요"(13.7.1절 무결성), `main.log`에 WARN.
- **수동 업데이트 확인**: 트레이 · 이 PC 상태의 [업데이트 확인]은 서버 `/downloads/latest.yml`을 즉시 확인.

### 13.7 설치 · 자동 업데이트

| 항목 | 기획팀 추천 | 공식 근거 · 확인 |
|---|---|---|
| 설치 형식 | **NSIS**, **사용자별 설치**(`perMachine: false`, 관리자 권한 없음 — **확정 U3**), 한 번에 설치(`oneClick: true`). 앱 이름 **PaperLab**, 아이콘 = 지금 `deploy/paperlab.ico`와 같은 모양(**확정 U3**) | electron-builder 공식: Windows 자동 업데이트는 **NSIS만**, Squirrel.Windows는 지원 안 함(확인) |
| 설치 경로 | `%LOCALAPPDATA%\Programs\PaperLab`(NSIS 사용자별 기본), 데이터 `%APPDATA%\PaperLab` | 사용자별 설치라 업데이트 때 UAC 창 없음 |
| 바로가기 | 시작 메뉴 + 바탕화면 `PaperLab` | 관리자 PC의 1단계 웹 바로가기 `PaperLab.lnk`와 이름이 같아 **덮어씀**(관리자 PC도 앱으로 바꿈 — **확정 U3**) |
| 프로토콜 | `paperlab://` 등록(electron-builder `protocols`) | 13.4절 ① |
| 제거 | 앱 데이터(토큰)는 남김(`deleteAppDataOnUninstall: false`, 가정) — 다시 설치하면 연결 유지 | |
| 받는 곳(개정 U10) | **서버 PC가 내려주는 `https://kimjuhyeon.tailac17f6.ts.net/downloads/`**(13.7.1절). 처음 설치 파일은 클라우드 화면 설정 "연결된 PC"의 [PC 앱 받기](S4) | GitHub Releases 안 씀(사용자 결정 2026-10-07) |
| 업데이트 확인 | 시작 때 + **6시간마다**(가정) | `electron-updater` + **generic provider**(`url` = 위 주소, 빌드가 `app-update.yml`에 넣음 — `setFeedURL`을 코드에서 부르지 않음, 공식 문서). 개정 전: GitHub provider |
| 다운그레이드 | 하지 않음(`allowDowngrade: false` — 기본). 서버를 옛 커밋으로 되돌려도 앱은 그대로(13.7.1절) | |
| 받기 · 설치 | 자동으로 받고, **다음 종료 때 설치**(`autoInstallOnAppQuit`) + 트레이 "업데이트 준비됨 — [지금 다시 시작]". 작업 실행 중에는 다시 시작을 미룸. 알림은 **트레이 · 이 PC 상태에만**, 앱 창(클라우드 화면)에는 띄우지 않음(PD-8) | **확정 U5** |
| 필수 업데이트 | 서버가 `426 update_required`(8.3절)를 주면 작업을 받지 않고 즉시 업데이트를 권함 | |
| 서명 | **코드 서명 없음**(확정) → 첫 설치 때 SmartScreen "Windows의 PC 보호" → [추가 정보] → [실행] 안내. 업데이트 파일 서명 검증(`publisherName`)은 설정하지 않음 — 대신 **HTTPS + `latest.yml` sha512**(13.7.1절 무결성) | 공식 문서: NSIS 업데이트는 적용 전 Authenticode 검증(`verifyUpdateCodeSignature` 기본 켬, `publisherName` 사용). **서명 없는 앱에서 이 검증이 건너뛰어지는지 · 업데이트가 경고 없이 설치되는지 · 백신 오탐 확인 필요**(AC-71) |
| 메타데이터 | 빌드가 `latest.yml`(버전 · 파일 이름 · **sha512** · 크기) · `.blockmap`(차등 받기) 생성 → 서버 PC `D:\PaperLab\releases`에 둠(13.7.1절) | electron-builder 공식: 받은 파일을 `latest.yml`의 sha512로 검증 |
| 개발 시험 | `dev-app-update.yml` + `forceDevUpdateConfig`로 패키지 없이 시험 | 공식 |

### 13.7.1 서버 PC 배포 — `update.ps1` 빌드 · `/downloads/` (신규 — 사용자 결정 U10 변경, 2026-10-07)

**흐름**
```
관리자: 승인 · 푸시된 커밋 → 서버 PC update.ps1 (1단계 13.8절 1~8단계: git 반영 · 마이그레이션 · 서버 재시작 · 상태 확인)
   └ 9(신규). 서버 상태 확인이 성공했고 "데스크톱 빌드 조건"이 맞으면 → Electron 설치 파일 빌드
        npm ci → npm run dist  (= electron-builder --config electron-builder.config.js --win nsis --publish never, desktop/ 에서, 결과는 desktop/dist/)
        → D:\PaperLab\releases\ 에 옮김: .exe → .exe.blockmap → release.json → latest.yml (마지막)
   └ 빌드 실패 = WARN 기록 · 이전 설치 파일 그대로 · update.ps1 종료 코드는 서버 결과대로(성공이면 0)
PaperLab 서버 (FastAPI): GET /downloads/{허용된 파일 이름} → D:\PaperLab\releases 의 파일
설치된 앱: electron-updater generic provider → https://kimjuhyeon.tailac17f6.ts.net/downloads/latest.yml → 새 버전이면 받고 종료 때 설치(U5)
```

**빌드 조건 · 규칙(`update.ps1` — 개발팀)**
| 항목 | 규칙 |
|---|---|
| 언제 빌드 | ① 이번 반영에서 `desktop/` 아래 파일이 바뀌었고(`git diff --name-only <옛 커밋> <새 커밋> -- desktop/`) ② `desktop/package.json`의 `version`이 `releases`에 **아직 없는 버전**일 때. 또는 `update.ps1 -BuildDesktop`(처음 배포 · 지난 빌드 실패 뒤 다시 — 이때도 ②는 지킴) |
| 버전을 안 올린 변경 | `desktop/`이 바뀌었는데 버전이 이미 `releases`에 있으면 **빌드하지 않고 WARN** "데스크톱 앱이 바뀌었지만 버전이 같아 빌드하지 않았어요 — desktop/package.json 버전을 올려 주세요". 같은 버전 이름으로 다른 내용을 내보내지 않음(파일 이름 = 버전, 캐시 · sha512 일관성) |
| 언제 하지 않음 | 서버 상태 확인 실패로 되돌린 경우, `-Ref`로 옛 커밋에 맞춘 경우, `-RestartOnly`. 서버를 되돌려도 `releases`는 지우지 않음(앱은 다운그레이드하지 않음) |
| 순서 | **서버 재시작 · 상태 확인이 끝난 뒤**(빌드가 서버 반영을 늦추거나 막지 않게). 빌드 중에도 서버는 새 코드로 돎 |
| 실행 | `desktop/`에서 `npm ci`(잠금 파일대로 — 공급망) → **`npm run dist`**(`package.json`의 스크립트: `electron-builder --config electron-builder.config.js --win nsis --publish never`). 설정 파일 이름이 기본(`electron-builder.yml` 등)이 아니라 `electron-builder.config.js`이므로 **`--config`로 지정**. `update.ps1`은 이 두 명령(고정 문자열)만 부르며, **빌드 함수(`Invoke-PLDesktopBuild` · `Get-PLReleasesDir` 등)는 `common.ps1`에 있고 `update.ps1`은 그것을 부름**. 시간 제한 **20분**(`-BuildTimeoutSec`, 기본 1200초 — 가정). 캐시는 D:로: `ELECTRON_CACHE` · `ELECTRON_BUILDER_CACHE` = `D:\PaperLab\cache\…`(C: 여유 15GB — 1단계 9.1절, 스크립트 안에서만 설정하는 도구용 변수 — 앱 · 서버 환경 변수 아님). `node_modules` · `dist`는 `.gitignore`(작업 폴더 "고친 파일" 검사에 걸리지 않음) |
| 옮기기 | `desktop/dist/`에서 `releases\.staging\`로 복사 → 확인(`latest.yml`의 파일 이름 · 크기 · sha512가 실제 `.exe`와 맞는지 스크립트가 다시 계산) → `.exe` · `.blockmap` 먼저, **`latest.yml`을 마지막에 이름 바꾸기로 교체**(앱이 새 `latest.yml`을 보는 순간 그 `.exe`가 이미 있게). 실패하면 `.staging`만 지움 |
| `release.json` | 스크립트가 함께 씀: `{version, file, size, sha256, built_at, commit}` — 처음 설치 링크 · SHA-256 표시용(아래 API). `/downloads/`로는 내주지 않음 |
| 보관 | `releases`에 **최근 3개 버전**의 `.exe` · `.blockmap`(차등 받기는 **옛 버전 blockmap**도 받으므로 남김), `latest.yml`은 하나. 넘으면 오래된 것부터 지움(팀장 결정 K24) |
| 실패 처리 | 어느 단계든 실패하면 `update.log`에 **WARN**(실패 단계 · 종료 코드 · 빌드 로그 파일 경로 — 빌드 출력 전체는 `D:\PaperLab\logs\desktop-build-<시각>.log`), 이전 `releases` 그대로, `update.ps1` 종료 코드는 서버 결과(성공 0) 그대로 |
| 로그 | 빌드 로그에 서버 주소가 들어간 것을 한 줄 확인(U6), 토큰 · 비밀값 없음(빌드에 비밀값이 필요 없음 — `GH_TOKEN` 등 안 씀) |
| 권한 | `D:\PaperLab\releases`는 `D:\PaperLab`의 제한된 권한을 상속(`USER` · `SYSTEM` · `Administrators`만 — 1단계 AC-58). 서버는 이 폴더를 **읽기만** |

**서버 PC 준비 — Node.js LTS (사용자 · 관리자 작업, 안내서에 추가)**
- 서버 PC 실측 Node **v24.14**(1단계 9.1절) — Node 24는 LTS 계열. `node -v` · `npm -v`로 확인만 하면 됨. 없거나 LTS가 아니면 nodejs.org의 **LTS Windows 설치 파일(.msi)** 로 설치(기본 옵션, "필요한 도구 자동 설치"는 끔 — electron-builder NSIS 빌드에 C++ 도구 불필요 — 가정, AC-89에서 확인).
- **`update.ps1`**(빌드 함수는 `common.ps1`)이 빌드 전에 `node` · `npm`이 PATH에 있고 주 버전이 **22 이상**(가정)인지 검사 → 아니면 빌드 단계만 WARN 후 건너뜀(서버 업데이트는 계속). **`install.ps1`은 2b에서 바뀌지 않았습니다**(개정 전 "install.ps1도 검사 · 폴더 만들기"는 하지 않음) — `releases` · `cache` · 로그 폴더는 빌드 함수가 처음 빌드 때 만들고(`D:\PaperLab` 아래라 권한은 상속), 처음 배포는 `update.ps1 -BuildDesktop`.
- 첫 빌드는 Electron · NSIS 바이너리를 인터넷에서 받음(서버 PC 인터넷 필요, 수백 MB — 캐시 뒤에는 다시 받지 않음).

**서버 경로 `/downloads/` (개발팀 — `paperlab/server.py` 또는 새 모듈)**
| 항목 | 규칙 |
|---|---|
| 경로 | `GET` · `HEAD /downloads/{name}` 하나. `/downloads/` 자체(목록)와 그 밖 이름은 **404**(디렉터리 목록 없음) |
| 허용 파일 이름 | 정규식 **`^latest\.yml$`** 또는 **`^PaperLab-Setup-\d{1,4}\.\d{1,4}\.\d{1,4}\.exe(\.blockmap)?$`** 만(electron-builder `artifactName`을 `PaperLab-Setup-${version}.${ext}`로 고정). 정규식 통과 뒤에도 `releases` 폴더 기준으로 경로를 풀어 **부모가 그 폴더인지** 다시 확인(`..` · `%2e%2e` · 역슬래시 · 드라이브 문자 · 대체 데이터 스트림 `:` · 심볼릭 링크 밖 차단), 파일이 없으면 404. `.staging` · `release.json` · 로그는 이름 규칙상 나갈 수 없음 |
| 응답 | `FileResponse`(스트리밍 — 메모리에 다 올리지 않음). `Content-Type`: `.yml` = `text/yaml; charset=utf-8`, `.exe` = `application/octet-stream`, `.blockmap` = `application/octet-stream`. `Content-Disposition: attachment; filename=…`(`.exe`). `X-Content-Type-Options: nosniff`(1단계 공통) |
| Range | electron-updater 차등 받기는 `.exe`에 **Range 요청**(여러 범위 포함)을 씀. 서버는 Starlette `FileResponse`의 Range 처리를 그대로 씀. **2a**: `tests/test_downloads.py::test_range_requests`가 단일 범위(206 · `Content-Range`)와 다중 범위(206 · `multipart/byteranges`)를 단언함(작성됨 — 품질팀 실행 결과는 따로). **차등 업데이트가 실제로 되는지(electron-updater가 보내는 Range 모양 · 횟수, 안 될 때 전체 받기로 넘어가는지) 실측은 2b**(AC-71). |
| 설치 파일 폴더(팀장 승인 2026-10-08 — K14' 개정) | **환경 변수 `PAPERLAB_RELEASES_DIR`**(서버 PC `cloud.env` 또는 프로세스 환경 변수 — 둘 다 있으면 프로세스 환경 변수가 우선). 비밀 아님, 값은 폴더 경로 하나. **없거나 공백이면 기본 `D:\PaperLab\releases`**. 서버(`paperlab/serve.py`)가 시작할 때 `cloud.env`를 합쳐 읽고 `downloads.releases_dir()`로 정함. 값 형식 · 폴더 존재는 시작 때 검사하지 않음(`serve --check`의 변수 검사 대상 아님) — 폴더나 파일이 없으면 `/downloads/*`가 404, `GET /api/desktop/release`가 404 `{"code":"not_ready"}`. 서버는 이 폴더를 읽기만 함. **2b 확인 — 해결(2026-10-08, `common.ps1` `Get-PLReleasesDir` 확인)**: `update.ps1`이 쓰는 폴더도 같은 규칙으로 정합니다 — ① **프로세스 환경 변수 `PAPERLAB_RELEASES_DIR`**(공백만이면 무시) → ② **`cloud.env`의 같은 키**(그 한 줄만 읽고 다른 값은 읽지 않음, 따옴표 허용, `-EnvFile`로 위치 지정 가능) → ③ **`D:\PaperLab\releases`**. 이 기본값은 서버 `downloads.py`의 `DEFAULT_RELEASES_DIR`와 같아야 하며 테스트가 확인합니다. 이 문서 본문의 `D:\PaperLab\releases`는 ③의 기본값을 뜻합니다 |
| Cache-Control | `latest.yml` = **`no-cache`**(매번 서버에 확인 — 새 버전을 바로 보게, ETag · Last-Modified로 304 가능). 버전이 이름에 든 `.exe` · `.blockmap` = **`public, max-age=31536000, immutable`**(같은 이름은 내용이 바뀌지 않음 — 위 "버전을 안 올린 변경" 규칙이 보장). `/api/*`의 `no-store` 규칙은 그대로(이 경로는 `/api/` 밖). **`latest.yml`의 304는 서버가 직접 처리**(구현 확인 2026-10-08): 응답에 `ETag` · `Last-Modified`가 있고, 요청 `If-None-Match`가 현재 `ETag` 문자열과 **정확히 같을 때만** `304`(본문 없음, 헤더는 `ETag` · `Cache-Control: no-cache`). 값 목록(`a, b`) · 약한 표시(`W/`) · `If-Modified-Since`는 해석하지 않음(다르면 그냥 200으로 전체 응답). `.exe` · `.blockmap`에는 304 처리가 없음(불변 캐시 헤더만) |
| 인증 · 요청 규칙 | **로그인 없이 받음**(K22 — 아래 보안 검토). Host 검사(1단계 6.5절)는 그대로 적용. `GET` · `HEAD`만(그 밖 405). `X-PaperLab` 헤더 불필요(쓰기 아님) |
| 남용 방지 | `.exe` 동시 전송 **서버 전체 3개**(넘으면 503 + `Retry-After: 60`), 같은 IP(`X-Forwarded-For` — 1단계 AC-75 실측 결과에 따름) `.exe` **전체 `GET` 시간당 10회**(넘으면 429 `{"code":"rate_limited"}` + `Retry-After: 600`). `latest.yml` · `.blockmap`은 작아 제한 없음(가정). **세는 방식(2a 품질 수정 2026-10-08 — 품질팀 M3로 개정 전 "Range도 1회씩 셈"을 바꿈)**: **`Range` 헤더가 있는 요청은 시간당 횟수에 넣지 않고 동시 전송 3개 제한만 적용**합니다(electron-updater 차등 받기 · 이어 받기가 한 번의 업데이트에서 여러 조각을 요청해도 시간당 한도를 쓰지 않게). `Range` 헤더가 **없는 전체 `GET`**만 같은 IP 기준 시간당 10회로 셉니다. **주소가 `127.0.0.1`(`::1` 포함)이고 `X-Forwarded-For`가 없으면** IP별로 나눌 수 없으므로 전체를 하나로 묶어 **전체 시간당 60회**로 셉니다. `HEAD`는 세지도 않고 동시 전송 자리도 차지하지 않음. 횟수 검사를 **먼저** 하고 그 다음 동시 전송 수를 검사하므로 전체 `GET`이 503을 받아도 시간당 횟수에는 들어감. **수용 위험(19장)**: `Range: bytes=0-`처럼 헤더만 붙이면 전체 파일을 시간당 횟수 제한 없이 받을 수 있음 — 동시 3개 제한은 그대로 걸리므로 대역폭을 독점하지는 못하며, **2b 운영 접근 로그에서 지켜봄**(남용이 보이면 Range 요청도 시작 위치별로 세거나 기기 토큰 요구(③)를 재검토) |
| 로그 | 접근 로그 한 줄(경로 · 상태 · 크기 · 걸린 시간), `user_id` 없음(로그인 없음) |
| 처음 설치 정보 | **`GET /api/desktop/release`**(로그인 필요 — 1단계 규칙) → `release.json` 내용 `{version, url: "/downloads/PaperLab-Setup-0.2.0.exe", size, sha256, built_at}` 또는 아직 없으면 404. 설정 S4 [PC 앱 받기]가 이것을 씀(버전 · SHA-256 표시) |

**보안 검토 (기획팀 판단 · 추천 — K22 · K23 · K24 모두 추천안으로 팀장 결정, 2026-10-07)**

1. **`/downloads/`를 로그인 없이 열지 (K22)**

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| ① **공개 + 남용 방지**(기획팀 추천) | 누구나 `GET` 가능, 이름 허용 목록 · 목록 없음 · 동시 전송 · IP별 횟수 제한 | 설치 파일에 **비밀값이 없음**(서버 주소만 — U6, 주소는 이미 Funnel 공개 주소), 저장소가 **공개**라 같은 파일을 누구나 만들 수 있음 → 숨길 내용이 없음. 업데이트가 로그인 · 기기 연결 상태와 무관하게 동작(토큰이 해지되거나 만료된 PC도 최신 앱을 받아 고칠 수 있음) | 누구나 받을 수 있어 **Funnel 대역폭 · 서버 PC 회선을 쓰는 반복 다운로드**(설치 파일 약 100MB 가정) 가능 → 동시 3개 · IP별 시간당 10회로 막음. 서비스 존재 · 앱 버전이 드러남(주소가 이미 공개라 추가 노출 작음) |
| ② 로그인 필요(Supabase JWT) | `/downloads/`도 `Authorization` 요구 | 외부인의 대역폭 사용 차단 | **electron-updater는 요청 헤더를 붙일 수 있지만**(공식: `requestHeaders` 속성 · `addAuthHeader()`), Supabase JWT는 앱 창(클라우드 화면) 쪽에 있고 main 프로세스에는 없음 → 화면에서 main으로 토큰을 넘기는 새 IPC가 필요(13.3절 최소 API 원칙과 충돌), 1시간마다 만료 · 갱신, 로그아웃 상태 PC는 업데이트 불가. 처음 설치는 브라우저 링크라 헤더를 못 붙임 → 서명 주소 · Blob 받기 등 추가 구현 |
| ③ 기기 토큰 필요 | 업데이트는 `addAuthHeader(기기 토큰)` | main에 이미 토큰이 있음 | **연결 안 한 PC · 해지된 PC는 업데이트 못 받음**(앱 창만 쓰는 사용자 · 해지 뒤 다시 연결하려는 PC가 옛 버전에 갇힘), 처음 설치는 여전히 따로 처리, 기기 토큰이 업데이트 요청마다 나감 |

→ **추천 ①**. 근거: 지키려는 비밀이 없고(②③이 막는 것은 대역폭뿐), ②③은 업데이트가 끊기는 실패 모드를 새로 만듦. 대역폭은 남용 방지로 다룸. 운영 중 남용이 보이면(접근 로그) ③을 업데이트에만 거는 안으로 재검토.

2. **무결성 (K23)** — 코드 서명이 없으므로:
   - **전송 구간**: Funnel의 **HTTPS**(ts.net 공인 인증서, 평문 http는 Funnel이 받지 않음 — 1단계 AC-59). electron-updater generic `url`은 `https://`만 씀(빌드 설정 검사 — AC-88).
   - **받은 파일**: electron-updater가 **`latest.yml`의 sha512로 받은 파일을 검증**(공식) → 잘린 · 손상된 파일은 설치하지 않음. `update.ps1`도 옮기기 전에 sha512를 다시 계산해 맞춰 봄.
   - **처음 설치**: 설정 S4에 **SHA-256 표시**(`release.json`) + 설치 안내(E8)에 PowerShell `Get-FileHash .\PaperLab-Setup-x.exe`로 비교하는 방법(선택). 브라우저 다운로드도 HTTPS.
   - **신뢰의 뿌리는 서버 PC 자체**: `latest.yml`과 `.exe`가 같은 서버에서 오므로 sha512는 "서버 PC가 내보낸 그대로인가"만 보장하고, **서버 PC가 털리면 막지 못함**(코드 서명이나 별도 서명 키가 있어도 빌드 · 키가 같은 서버 PC에 있으면 마찬가지). → 서버 PC 보안 관리(1단계 13.7절) · `releases` 폴더 권한 제한에 기댐(수용 위험 — 19장).
   - 추천: **HTTPS + sha512(기본 동작) + 처음 설치 SHA-256 표시**. 자체 서명 키로 `latest.yml`에 서명을 더하는 안은 위 이유로 이득이 작아 하지 않음(18장).
3. **경로 순회 · 목록 (팀장 지시 그대로)**: 위 "허용 파일 이름" — 정규식 + 폴더 기준 재확인, 디렉터리 목록 없음(AC-87).
4. **캐시 (K24)**: 위 "Cache-Control" — `latest.yml`은 `no-cache`, 버전 파일은 `immutable`(같은 버전 재빌드 금지 규칙과 짝). 보관 3개 버전.

### 13.8 로그

| 위치 | 내용 |
|---|---|
| `%APPDATA%\PaperLab\logs\main.log` · `worker.log` | 시각 · 수준 · 사건(시작 · 연결 · 잡기 · 작업 id · 엔진 · 종료 코드 · 걸린 시간 · `error_code` · 업데이트). 파일당 5MB × 3개 회전(가정) |
| 남기지 않는 것 | 기기 토큰 · 연결 코드 · Supabase 토큰 · API 키 · **프롬프트 · 논문 본문 · 결과 글** · 서명 주소 · 이메일 전체(`account_hint`만) |
| stderr | 실패 때 앞 500자만, 토큰 · 키 패턴(`sk-ant-…`, `pld1.…`, `Bearer …`) 지움 |
| 서버 | 워커 요청도 1단계 접근 로그 규칙(`device_id` 추가, 본문 없음). 작업 상태 바뀜 INFO 로그(작업 id · 종류 · runner · engine · 결과 코드) |

### 13.9 서버 PC — 워커 없음, 배포 역할 (개정 — 사용자 결정 Q-S3 · U11, 2026-10-07)

**서버 PC에는 워커(Electron 앱)를 두지 않습니다**(사용자 결정 Q-S3). 그래서 개정 전 이 절의 "서버 PC 워커 상시 운영"(설치 · 계정 · 동시 실행 전체 1 · codex 기본 끔 K20 · 사용자 질문 U11)은 **모두 하지 않음 / 해당 없음**입니다.

| 항목 | 정리 |
|---|---|
| 서버 PC의 역할 | PaperLab 서버(1단계 9장) · API 실행기(15장) · **앱 설치 파일 빌드 · `/downloads/` 배포**(13.7.1절). CLI 작업은 실행하지 않음 |
| 결과 | `cloud.env`가 있는 PC에서 CLI가 논문 본문 지시문에 속아 파일을 읽을 위험(개정 전 19장 위험 · K20)이 **없어짐**. 서버 PC의 claude 2.1.210 업데이트(개정 전 준비 작업)도 **필요 없음** |
| CLI 작업 | 사용자 각자의 PC 워커만 실행. 모두 꺼져 있으면 대기 기한(U7) 안에서 기다림(지금 규칙 그대로) |
| 앱 설치 금지? | 서버 PC에 앱을 깔지 말라는 기술적 막음은 두지 않음(사용자 운영 규칙 — 서버 PC 안내서에 "워커 앱을 설치하지 않음" 한 줄) |
| 시험 | 개정 전 "서버 PC를 두 번째 시험 PC로"(AC-83)는 **해당 없음** → 두 번째 PC 또는 관리자 PC의 다른 Windows 사용자 계정으로(AC-70 · 76 · 77) |


---

## 14. 빌드 · 릴리스 절차 (개정 — 사용자 결정 U10 변경 2026-10-07: 서버 PC가 빌드 · 배포, K12')

| 단계 | 누가 · 어디서 | 내용 |
|---|---|---|
| 1 | 개발팀 · 개발 PC | `desktop/package.json` 버전 올림(SemVer, 예: `0.2.0`). **앱을 바꾸면 반드시 올림**(같은 버전은 서버 PC가 다시 빌드하지 않음 — 13.7.1절) |
| 2 | 품질팀 · 개발 PC | `npm test`(워커 · 가짜 CLI) + 서버 테스트 + 17장 수동 항목. 설치 · 앱 동작 확인은 **개발 PC에서 직접 빌드한 설치 파일**(`npm run dist` — 폴더만 만들어 보려면 `npm run pack`)로 — 다른 Windows 사용자 계정에 설치(AC-70 · 72~82). **주의(개발 PC)**: 저장소가 **OneDrive 폴더 안**에 있으면 electron-builder가 `EPERM`으로 실패합니다(개발팀 보고 — 팀장 확인). OneDrive 밖 폴더에서 빌드하세요. **서버 PC 경로(`D:\PaperLab\…`)에는 해당 없음** |
| 3 | 승인자 → 관리자 | 승인 뒤 커밋 · 푸시(빌드 결과물 `desktop/dist/`는 커밋하지 않음) |
| 4 | 관리자 · 서버 PC | `update.ps1`(1단계 13.8절) — 서버 반영 · 상태 확인이 끝나면 **설치 파일을 빌드해 `D:\PaperLab\releases`에 둠**(13.7.1절). `latest.yml`이 바뀌는 순간부터 설치된 앱들이 업데이트를 받음(**게시 단계가 따로 없음** — 승인 · 푸시가 곧 배포 승인) |
| 5 | 관리자 · 품질팀 | `update.log`에 빌드 성공(버전 · sha256) 확인 → 업데이트 확인(AC-71 · 88 · 89). 빌드 WARN이면 원인을 고쳐 **버전을 올린 커밋**으로 다시 반영하거나 `update.ps1 -BuildDesktop` |

- 태그 · GitHub Releases · `gh` CLI · 토큰 **쓰지 않음**(개정 전 4 · 6단계 "초안 릴리스 · 게시"와 U10 ①~③ 선택지는 폐기).
- 잘못된 버전이 배포되면: 고친 버전(번호를 올림)을 다시 배포. 앱은 다운그레이드하지 않으므로 "옛 버전으로 되돌리기"는 **옛 코드를 새 번호로** 빌드하는 방식(가정).
- 저장소가 공개라 설치 파일 · 소스가 공개됩니다. 앱에 비밀값을 넣지 않습니다. 서버 주소는 **넣음**(확정 U6 — 공개 값, 1단계 13.2절). 빌드는 `deploy/server-pc/server.json`의 `public_url`에서 서버 주소 · 업데이트 주소를 읽음(주소 한 곳 원칙).
- **수용 위험(2a, 2026-10-08 — 자세한 표는 19장)**: ① `/downloads/`의 `Range` 요청은 시간당 횟수에 들어가지 않아 `Range: bytes=0-`로 횟수 제한 없이 받을 수 있음 — 5단계 확인(AC-71 · 88 · 89) 때 **접근 로그에서 같은 IP의 반복 Range 받기가 없는지** 함께 봄(13.7.1절). ② 대화 · 글쓰기 SSE가 11분(660초)을 넘기면 답 없이 끝날 수 있음(6.3절) — 앱 릴리스와 무관, 서버 반영 뒤 `interrupted` 빈도만 봄.
- 서버 쪽 변경(워커 API)은 **앱 릴리스보다 먼저 서버 PC에 반영**하고, 프로토콜을 깨는 변경이면 `min_protocol` · `min_app_version`을 올립니다(8.3절).

---

## 15. 요약 등 긴 작업의 jobs 이전

### 15.1 결정 (개정 — 서버 PC)

1단계는 요약을 **요청 안 SSE**로 돌렸습니다(1단계 9.3절 — 탭을 닫으면 멈춤). **확정 U8: 요약은 탭을 닫아도 계속.** 팀장 결정 K2(기획팀 추천 A — Cloud Tasks)는 **Cloud Run이 없어져 그대로 쓸 수 없으므로** 다시 정합니다(K2').

| 선택지 | 탭을 닫으면 | 설정 | 단점 |
|---|---|---|---|
| ~~A Cloud Tasks~~ | — | — | **폐기**(Cloud Run 폐기, Google Cloud를 더 쓰지 않음) |
| B API 요약은 SSE(작업 행만 기록) | 멈춤 | 없음 | 확정 U8과 어긋남 — **채택 불가** |
| **A' 서버 프로세스 안 백그라운드 실행기(jobs 표 기반)**(기획팀 추천) | **계속** | 없음(서버 PC는 늘 켜진 한 프로세스 — 응답 뒤에도 CPU가 있음. 1단계 9.3절의 Cloud Run 제약이 사라짐) | 서버 프로세스가 재시작 · 업데이트 · 강제 종료되면 실행 중 작업이 끊김 → **jobs 표의 리스 + 복구 스캔**으로 이어서 실행(15.2절). 서버 PC가 꺼져 있으면 당연히 멈춤(1단계 18장) |
| D 서버 PC에 별도 실행기 프로세스(작업 스케줄러로 따로 띄움) | 계속 | 작업 하나 더 | 서버 재시작과 분리되는 장점 대비 설치 · 감시가 늘어남 — 3단계 임베딩 같은 무거운 작업이 생기면 검토 |

**팀장 결정(2026-10-07) K2' = A'**(기획팀 추천 채택) — 서버 프로세스 안 백그라운드 실행기.

### 15.2 A' 사양 (기획팀 안)

- **구성**: 서버 시작(`paperlab.serve`) 때 `ApiRunner`(이름은 개발팀 재량)를 띄움 — 실행 스레드 **4개**(6.7절, 서버 상수), 메모리 대기열(`(job_id, user_id)`), 복구 스캔 타이머. **API 실행기를 위한 새 환경 변수 없음**(K14' — 설치 파일 폴더 변수 `PAPERLAB_RELEASES_DIR`만 별도, 13.7.1절. 개정 전 `SERVICE_URL` · `TASKS_QUEUE` · `TASKS_INVOKER_SA` · `TASKS_BACKEND`는 만들지 않음). `/internal/*` 주소도 없음(바깥에서 부를 수 있는 실행 경로가 아예 없음).
- **작업 만들기**(`runner = api`): 사용자 요청(검증된 JWT) 트랜잭션에서 `jobs`에 `queued`로 넣고 **커밋한 뒤** `(job_id, user_id)`를 메모리 대기열에 넣음 → `202 {job}`. 요청은 바로 끝남.
- **실행**: 실행 스레드가 대기열에서 꺼내 `actor_claims(user_id, "api-runner")` 트랜잭션에서 6.2절과 같은 방식(`FOR UPDATE SKIP LOCKED`, `runner = 'api'`)으로 `running` + 리스 90초 + `lease_token` 발급 → 커밋(연결 반납) → `route[route_index].engine`에 맞는 API 실행기(Anthropic · OpenAI · Google — 9.5절) 실행. 실행 중 **30초마다 리스 연장**, `progress`는 1초에 한 번까지, 스트림 이벤트 사이마다 `cancel_requested` 확인(6.5절) → 끝나면 6.4절과 같이 `lease_token`이 맞을 때만 반영. 폴백 대상 오류면 다음 칸(`{cli, …}`)으로 `queued`.
- **복구 스캔**: 서버 시작 때 한 번 + **60초마다** `system_tx("api job recovery")`로 `runner = 'api'`이고 (`queued` · `not_before <= now()`) 또는 (`running` · `lease_until < now()`)인 행의 `id` · `user_id`만 최대 100개 읽어 대기열에 넣음(이미 대기열 · 실행 중인 id는 건너뜀). 이것으로 **서버 재시작 · 업데이트 · 강제 종료 중이던 작업**과 메모리 대기열에서 사라진 작업을 다시 잡음(5.6절에 관리 권한 사용 1줄 추가).
- **다시 실행 한도**: 리스 만료로 같은 API 칸을 다시 잡는 것은 `attempts`로 세어 **최대 2회**, 넘으면 다음 칸(CLI)으로, 다음 칸이 없으면 `failed`(`error_code = "lease_exhausted"`). (같은 결과가 두 번 반영되지 않는 것은 리스 토큰 규칙 그대로 — 6.3절)
- **`interactive` 작업은 이 실행기가 다시 실행하지 않음**(2a 품질 수정, 6.3절): 대화 · 글쓰기 SSE가 만든 `running` · `interactive = true` 행은 실행기의 `running` 목록에 없고 리스 연장도 받지 않습니다. 복구 스캔이 리스가 지난 이 행의 `id` · `user_id`를 대기열에 넣으면 `claim_api`가 **잡지 않고 `cancelled` · `interrupted`로 끝냅니다**(위 "다시 실행 한도"의 대상이 아님). 복구 스캔 SQL은 `interactive` 열을 읽지 않으므로(5.6절 — `id` · `user_id`만) 걸러내지 않고, 잡는 쪽이 판단합니다. 폴백으로 다음 칸에 넘어가면 `interactive`가 `false`로 풀려 이 실행기의 보통 작업이 됩니다. 알려진 한계: SSE가 660초를 넘기면 복구 스캔 · `expire`가 이 행을 `interrupted`로 끝내 답이 저장되지 않을 수 있음(수용 위험 — 19장).
- **종료**: 서버가 정상 종료될 때 새 작업을 꺼내지 않고 실행 중 작업은 그대로 둠(리스가 지나면 다음 시작의 복구 스캔이 이어받음 — 작업 스케줄러의 종료는 강제 종료일 수 있어 정상 종료 처리에 기대지 않음).
- **사용자당 동시 2개**(6.7절): 같은 사용자의 작업이 2개 실행 중이면 그 사용자 것은 대기열 뒤로.
- **개발 서버 · 테스트**: 같은 `ApiRunner`를 그대로 씀(가짜 큐 · `inline` 값이 필요 없음). 테스트는 실행 스레드 수 · 리스 · 스캔 간격을 주입.

### 15.3 다른 작업

| 작업 | 2단계 |
|---|---|
| 대화 · 글쓰기 도우미 | API는 SSE 유지(대화형), CLI는 작업 큐(9.3절) |
| PDF 업로드 추출 · 메타데이터 찾기 | 그대로(요청 안 — 1단계). 큐로 옮기지 않음 |
| 3단계 색인(임베딩) · 4단계 전체 번역 | 같은 작업 큐 + 같은 서버 프로세스 안 실행기 구조(무거우면 15.1절 D) — 각 단계 명세에서 |


---

## 16. 화면 변경 (디자인팀 목록)

디자인팀은 [`docs/design/phase2-worker-electron-ui.md`](../design/phase2-worker-electron-ui.md)(작성됨 2026-10-08)에 시안 · 문구 · **CSS 클래스 이름 목록**을 먼저 쓰고, 개발팀이 그 이름으로 마크업합니다(1단계와 같은 순서). 앱 자체 화면(E*)은 같은 문서의 별도 절로. **디자인 결정 PD-1~PD-9는 디자인팀 추천안으로 확정**(20.2절) — 아래 표는 그 결정을 반영한 내용입니다.

### 클라우드 화면 (브라우저 · 앱 창 공통)
| # | 화면 | 내용 |
|---|---|---|
| S1 | **설정 "AI 엔진" 구역 재구성**(구역 이름 "AI 엔진" — PD-9) | 1단계의 "API / Claude CLI" 선택 버튼 **삭제** → 안내 한 줄 "API 키가 있으면 API로 먼저, 안 되면 연결된 PC의 CLI로 실행해요" + "PC를 꺼도 AI를 쓰려면 API 키가 필요해요"(PLAN 5장). API 모델 · effort는 "API 설정"으로 묶음 |
| S2 | **작업별 엔진** | 요약 · 논문과 대화 · 글쓰기 도우미 줄마다 **고르기 상자 3개(1 · 2 · 3순위)** — 1순위는 늘 하나, 2 · 3순위는 "없음" 가능, 겹치면 뒤 칸을 비우고 당김(PD-1 — 칩 재정렬 · 추가 · 빼기 단추는 쓰지 않음). 줄 아래 **경로 줄**: 9.2절 규칙대로 펼친 경로와 상태(예: "Anthropic API → 안 되면 PC의 claude (켜진 PC 1대)", 경로가 비면 주황 경고). 엔진별 CLI 모델 선택(claude: 기본/opus/sonnet/haiku) |
| S3 | **API 키 구역** | **Anthropic · OpenAI · Google 세 칸**(확정 U2) — 각 칸에 저장 상태("…ab12 저장됨" — `*_api_key_hint`, 7.3절 / 없음 / "저장된 키를 읽지 못했어요"), 키 옆 **최근 실패** "최근 실패: 키가 올바르지 않아요 (10월 7일 오후 2:14)"(`*_last_error`, 7.3절). **키마다 [확인] 버튼은 두지 않음**(PD-2 — 새 API · 각 회사 호출 비용 없음, 저장 상태와 실제 작업의 최근 실패만 보임), OpenAI · Google 칸 아래 "PDF 그림 · 쪽 인용 없이 본문 글만 보내요" 안내와 **API 모델 입력**(`api_models` — 9.4절) |
| S4 | **연결된 PC**(구역 이름 "연결된 PC" — PD-9. "이 PC 연결"은 버튼 이름) | 목록: 이름 · 켜짐(초록)/꺼짐(회색, "마지막 접속 3시간 전") · 일시 중지 · 엔진 칩(✓ 로그인됨 / ! 로그인 필요 / 없음 — 칩에 **엔진별 `slots`**, PC 전체 동시 실행 수는 웹에 보이지 않음 · 앱 "이 PC 상태"에서만 — PD-3) · 앱 버전(`update_required`면 "업데이트 필요" — 7.2절) · 실행 중 작업 수 · [이름 바꾸기] [연결 해지]. 해지된 PC는 흐리게. 빈 목록: "연결된 PC가 없어요" + **[PC 앱 받기]**(개정 U10: `GET /api/desktop/release`의 `/downloads/PaperLab-Setup-<버전>.exe` — 같은 출처 링크, 옆에 버전 · 크기 · **SHA-256**(접어 두기) · "받은 파일 확인 방법" 도움말) + SmartScreen 안내 링크. 목록이 있을 때도 구역 아래에 작게 [PC 앱 받기]. 아직 빌드가 없으면(404) "PC 앱을 준비 중이에요 — 관리자에게 알려 주세요" |
| S5 | **이 PC 연결 대화상자** | 앱 창이면 [이 PC 연결] 한 번 → 진행 → "연결됐어요: 집 PC". 브라우저면 코드 크게 표시 · 남은 시간 · 복사 · "앱 트레이 메뉴 → 코드로 연결에 넣어 주세요" · [새 코드] |
| S6 | **작업 목록(신규)** | 사이드바 아래 "작업" 항목 + 진행 중 개수 배지. 목록: 종류 · 논문 제목 · 상태 문구(아래 S8) · 엔진/경로 · 경과 시간 · [취소] [다시 시도] · 실패 사유 펼치기(`history` — "API: 키가 올바르지 않음 → PC: 실행 중") |
| S7 | **요약 진행(읽기 화면)** | 1단계 D11 "이 탭을 닫으면 요약이 멈춰요" **삭제**(확정 U8 · K2') → 작업 상태 표시 + "탭을 닫아도 계속돼요" + [취소]. 다시 열면 진행 중 작업을 이어서 보여 줌 |
| S8 | **상태 문구 모음** | 대기 중 — 켜진 PC 없음 / 대기 중 — codex가 있는 PC 없음 / 대기 중 — PC가 다른 작업 중 / API로 실행 중 / "집 PC"에서 실행 중(claude) / 완료 / 실패: … / 취소됨 / PC 연결이 끊겨 다른 PC로 넘겼어요 |
| S9 | **대화 · 글쓰기의 PC 실행** | CLI로 갈 때 답 자리에 "PC에서 답을 만드는 중…"(중간 글이 오면 점점 보임), 폴백 때 "API가 실패해서 PC로 넘겼어요(키가 올바르지 않음)". 탭을 닫아도 대화 답은 저장된다는 작은 안내. **글쓰기 도우미는 창을 닫으면(✕ · Esc · 바깥 클릭 · [취소]) 그 CLI 작업을 대기 중 · 실행 중 모두 취소**(PD-4 — 6.5절 취소 API, API 경로가 창을 닫으면 멈추는 것과 같게). 대기 · 실행 중에 "창을 닫으면 이 작업은 취소돼요." 표시. 창을 닫지 않고 탭을 닫아 끊긴 글쓰기 작업은 계속 돌아 결과가 24시간 남고 작업 목록에서 [결과 복사] |
| S10 | **AI 버튼 비활성 안내** | 경로가 없을 때(9.2절 400 문구)와 같은 문구를 버튼 옆 도움말로 |
| S11 | **앱 창 표시** | 앱 창에서 열렸을 때 계정 메뉴에 "이 PC: 집 PC (연결됨)" 한 줄 · 워커 계정이 다르면 경고 |

### 앱 자체 화면 · 트레이 (Electron)
| # | 화면 | 내용 |
|---|---|---|
| E1 | **앱 아이콘** | `desktop/build/icon.ico`(16 · 24 · 32 · 48 · 64 · 128 · 256px) — 1단계 `deploy/paperlab.ico`와 같은 모양(**확정 U3**) |
| E2 | **첫 실행** | 환영 · 서버 확인 중 · [시작] (**주소 입력 없음** — 확정 U6) |
| E9 | **서버에 연결할 수 없음(신규)** | 13.6절 문구 · [다시 시도] · 자동 재시도 표시 |
| E3 | **트레이 아이콘 4상태 + 메뉴** | 13.5절. 아이콘은 `.ico` 한 파일에 16 · 20 · 24 · 32px(PD-6) |
| E4 | **이 PC 상태 창** | 13.6절 |
| E5 | **브라우저 로그인 대기** | 13.4절 문구 · 버튼 |
| E6 | **코드로 연결** | **"이 PC 상태" 창 안의 "연결" 구역**(따로 창 `pair.html`을 만들지 않음 — PD-7). 트레이 [코드로 연결…]은 이 PC 상태 창을 열고 코드 칸에 초점. 8자리 입력(대시 자동) · 오류 문구 · 성공 |
| E7 | **업데이트 알림** | 트레이 메뉴 · 트레이 알림 · "이 PC 상태"에만 — "새 버전 0.2.1 준비됨 — [지금 다시 시작] [나중에]" · 필수 업데이트 문구. **앱 창(클라우드 화면)에는 띄우지 않음**(PD-8 — U5대로 종료 때 자동 설치, `paperlabDesktop`에 업데이트 함수를 더하지 않음 — 13.3절). (개정 U10) "이 PC 상태"의 업데이트 상태 줄 · 확인 실패 · 손상 파일 문구(13.6절) |
| E8 | **설치 안내 문서** | `desktop/README.md`(기획팀 문구, 디자인팀 스크린샷): **설정 "연결된 PC" [PC 앱 받기]로 받기**(개정 U10 — GitHub 아님) · 선택: `Get-FileHash`로 SHA-256 비교, SmartScreen [추가 정보] → [실행], CLI 설치 · 로그인(`claude` / `codex` / `gemini` 처음 한 번), 이 PC 연결, 해지 · 제거 |

---

## 17. 수용 기준

품질팀이 실행해서 확인합니다. 표시가 없으면 **자동 검사**(pytest — 1단계 10장 테스트용 Supabase 프로젝트 + 가짜 저장소 + 테스트 사용자 JWT, 워커는 **Python 가짜 워커**(httpx)로 API 계약을 시험). **[Node]** = `desktop/`의 `npm test`(node:test, 가짜 CLI). **[실환경]** = 운영 서버(서버 PC · 공개 주소) · 실제 CLI · 실제 설치 파일. **[수동]** = 사람이 화면 확인.

**단계 표시(개정 2026-10-08)**: 기준 번호 바로 뒤의 **`[2a]`** = 2a(서버 · 웹)에서 검증, **`[2b]`** = 2b(Electron 앱 · PC 워커 · 서버 PC 빌드 · 실제 PC 실측)에서 검증, **`[2a+2b]`** = 앞부분은 2a, 뒷부분은 2b(본문에서 나눠 적음). 2a 기준은 **Python 가짜 워커 · 가짜 AI · 가짜 releases 폴더**로 서버가 계약대로 도는지만 봅니다(실제 앱 · 실제 CLI 없이). 2b가 끝나면 2a 기준 전체를 실제 워커로 한 번 더 돌려 회귀를 확인합니다.

**공통 준비**: 사용자 A · B(허용), A의 기기 A1 · A2(가짜 워커 — A1은 `claude` · `codex`, A2는 `claude`만 광고), B의 기기 B1. 가짜 AI(1단계 `http_client` 주입)는 성공 · 401 · 429 · 500 · 거절(refusal)을 골라 낼 수 있게.

### A. 표 · RLS
- **AC-01** [2a] 마이그레이션 적용 뒤 `devices` · `device_pair_codes` · `jobs`가 1단계 AC-20 카탈로그 검사(RLS · force · `own_rows` · `user_id`)를 통과.
- **AC-02** [2a] DB 직접: B의 claims로 `jobs` · `devices` · `device_pair_codes`를 세면 B의 행만, A의 `user_id`로 `insert` → RLS 위반.
- **AC-03** [2a] API: B의 JWT로 A의 작업 `GET/cancel/retry /api/jobs/{id}`, A의 기기 `PATCH/DELETE /api/devices/{id}` → 모두 404, A의 데이터 그대로. `GET /api/jobs` · `GET /api/devices`에 A의 것이 없음.
- **AC-04** [2a] `GET /api/devices` 응답 어디에도 `token_hash`나 토큰 원문이 없음. `devices.token_hash`는 64자리 16진이고 발급한 토큰 문자열이 DB 어느 열에도 없음.

### B. 잡기 · 리스 · 재할당
- **AC-05** [2a] A가 CLI 요약 작업을 만들면 `queued` · `runner: "cli"`. A1이 claim → 그 작업 · `lease_token` · `prompt`(논문 제목 · 본문 포함) 수신, 상태 `running` · `device_id = A1` · `attempts = 1`.
- **AC-06** [2a] B1이 claim을 아무리 불러도 A의 작업은 오지 않음(`job: null`). B1 토큰의 uid 부분만 A로 바꿔 보내면 401.
- **AC-07** [2a] 동시성: A1과 A2가 **같은 순간**(스레드 2개 · 각 50회) claim → 작업 1건은 정확히 한 기기에만 넘어감(DB에 `attempts = 1`, 응답에서 그 작업을 받은 횟수 합 = 1). 작업 20건이면 두 기기가 받은 합이 20이고 겹침 0.
- **AC-08** [2a] codex 작업은 codex를 광고하지 않는 A2에게 오지 않고 A1에게 옴. A1이 codex를 `logged_in: false`로 광고하면 A1에게도 오지 않고 작업 보기 `waiting_reason = "no_online_worker"`. A1을 해지하면(codex를 광고한 기기가 없음) `waiting_reason = "no_engine_on_worker"`. A2를 꺼 둔(마지막 접속 4분 전으로 주입) 상태에서 A1이 claude 자리 0으로 claim하면 claude 작업은 `all_workers_busy`(7장 판정 순서).
- **AC-09** [2a] 재할당: A1이 잡은 뒤 하트비트를 보내지 않고 리스(시험용으로 3초로 주입)가 지나면, A2의 다음 claim이 같은 작업을 받음(`attempts = 2`, `device_id = A2`, `lease_token` 바뀜).
- **AC-10** [2a] 두 번 실행해도 한 번만: AC-09 뒤 A1이 옛 `lease_token`으로 result → 409 `lease_lost`, `ai_summaries`는 바뀌지 않음. A2의 result → 200, 요약 1건 저장. 같은 result를 A2가 한 번 더 보내면 409(또는 200 + 변화 없음 — 어느 쪽이든 `ai_summaries` 갱신 시각이 그대로).
- **AC-11** [2a] 리스가 3번 지나면(`max_attempts = 3`) 4번째 claim에서 작업이 `failed` · `error_code: "lease_exhausted"`가 되고 어느 기기에도 가지 않음.
- **AC-12** [2a] 하트비트: 같은 `lease_token` → `lease_until` 연장 · `progress` 저장(화면 `GET /api/jobs/{id}`에 보임). 틀린 토큰 → 해당 항목 `ok: false, code: "lease_lost"`. `partial_text` 100KB를 보내면 64KB로 잘려 저장. **`id`가 `true` · `false` · 0 · 음수 · 2⁶³ 이상 · 문자열 · 없음이거나 `jobs`가 배열이 아니거나 17개 이상이면 400 `bad_request`**(항목 하나라도 틀리면 요청 전체 400).
- **AC-13** [2a] 같은 논문 요약을 두 번 만들면 두 번째 응답이 첫 작업과 같은 id(200). 끝난 뒤 다시 만들면 새 id.
- **AC-14** [2a] 사용자당 진행 중 작업 30개 상태에서 하나 더 → 429.

### C. 기기 연결 · 인증
- **AC-15** [2a] 해지: A가 A1을 `DELETE` → A1의 다음 claim · heartbeat · result → 401 `code: "device_revoked"`. A1이 잡고 있던 작업은 `queued`로 돌아가 A2가 잡음. `DELETE` 응답 `requeued_jobs = 1`. **A1이 잡은 작업에 취소를 요청(`cancel_requested`)해 둔 상태에서 A1을 해지하면 그 작업은 `queued`가 아니라 `cancelled`이고 `requeued_jobs`에 들어가지 않음.**
- **AC-16** [2a] 연결 코드: `POST /api/devices/pair-codes` → `^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$` 형식(0 · O · 1 · I · L 없음 — 알파벳 31자 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 8.2 · 12.1절). `/api/worker/pair`에 소문자 · 대시 없이 넣어도 성공. 같은 코드 두 번째 → 400. 11분 지난 코드(시간 주입) → 400. 새 코드를 만들면 이전 코드 → 400. 틀린 · 지난 · 쓴 코드의 응답 본문이 모두 같음.
- **AC-17** [2a] 같은 코드로 **동시에** 두 번 교환 → 하나만 200, 기기 행 1개.
- **AC-18** [2a] `/api/worker/pair`를 같은 IP(`X-Forwarded-For`)에서 1분에 11번 → 11번째 429(IP별 분당 10회). IP를 바꿔 가며(IP마다 1~10회) 1분에 61번 → 61번째 429(전체 분당 60회). 접속 주소가 `127.0.0.1`이고 `X-Forwarded-For`가 없으면 IP별 한도는 보지 않고 전체 분당 60회만 적용(61번째 429, 시계 주입).
- **AC-19** [2a] 섞어 쓰기 금지: A의 Supabase JWT로 `/api/worker/claim` → 401, A1의 기기 토큰으로 `GET /api/papers` → 401.
- **AC-20** [2a] 토큰 형식 오류(조각 수 · uuid · base64) · 빈 토큰 → 401이고 500이 아님. 비밀 부분 한 글자만 바꾼 토큰 → 401.
- **AC-21** [2a] (허용 목록 on — 선택 기능) `ALLOWED_EMAILS`에서 A를 빼고 서버를 다시 시작하면 A1의 claim → 403 `not_allowed`. (off) 같은 상황에서 A1의 claim은 200(허용 목록을 보지 않음).
- **AC-22** [2a] 활성 기기 10대에서 11번째 연결 → 400.
- **AC-23** [2a] 관리 권한: 전체 테스트 동안 `system_tx` 로그의 reason이 1단계 20장 목록 + `device pairing` + `api job recovery`뿐(K5 ② 채택 시 `device auth` 추가). `api job recovery` 질의가 `jobs`의 `id` · `user_id` 말고 다른 열을 읽지 않음(코드 검사).
- **AC-24** [2a] 코드 검사: `paperlab/` 안에서 `"role": "authenticated"`가 든 claims 사전을 만드는 곳이 `actor_claims` 한 곳뿐(검증된 JWT 경로 제외). `/api/worker/*` 처리기와 API 실행기가 `actor_claims` 밖에서 `user_tx`를 열지 않음. `/internal/` 경로가 앱에 없음(라우트 목록 검사).

### D. 라우팅 · 폴백
- **AC-25** [2a] 키 있는 A(가짜 AI 성공, **워커 없음**)가 요약 → `202` 응답 직후 클라이언트가 아무 요청도 하지 않아도 `runner: "api"`로 `succeeded`, 요약 저장(K2' — 서버 프로세스 안 실행기). — PLAN "각자의 PC를 꺼도 요약이 되고 탭을 닫아도 계속"
- **AC-26** [2a] 키가 틀린 A(가짜 AI 401) → 작업이 `queued` · `runner: "cli"` · `history[0].error_code = "api_auth"`로 바뀌고, A1이 잡아 실행 · 저장. — PLAN "키를 틀리게 넣으면 CLI로"
- **AC-27** [2a] 429 · 500 · 연결 오류 각각 → 폴백. 거절(refusal) · 결과 JSON 깨짐 → 폴백 없이 `failed`(사유 그대로).
- **AC-28** [2a] 키 없는 A → 첫 경로가 CLI, API 호출 0회(가짜 AI 호출 기록). 키도 없고 claude를 광고한 기기도 없으면 → 400(9.2절 문구). 문구는 설치 파일 유무로 나뉨(Q2a-1): 임시 `releases`가 비어 있으면 "설정 → AI 엔진에서 API 키를 등록해 주세요. (PC 앱 연결은 곧 지원돼요)", 설치 파일을 두면 9.2절 원래 문구. 키는 틀리고 기기는 하나도 없는 A의 요약 → CLI 대기열에 넣지 않고 `failed`(API 오류 사유 + 위 안내), 기기는 있는데 꺼져 있으면(마지막 접속 4분 전 주입) `queued`로 대기 기한까지 남음.
- **AC-29** [2a] 엔진 목록 `[claude, codex]`, claude 키 없음, A1만 codex 보유: claude CLI 칸이 `cli_exit`로 실패하면 다음 칸 `{cli, codex}`로 `queued` → A1이 codex로 실행. 경로를 다 쓰고 실패하면 `error`가 마지막 사유이고 `history`에 두 시도가 다 있음.
- **AC-30** [2a] 대화: 키 없음 → SSE 첫 이벤트 `{"type":"queued","job"}` 후 종료, 워커 결과 반영 뒤 `GET …/chat`에 질문 · 답 2개(답의 `[p.3]`이 인용 목록으로). 키 401 → SSE `{"type":"fallback","job"}`.
- **AC-31** [2a] 설정 `ai_routing`에 모르는 엔진 · 중복 · 0개 · 4개 → 400. `ai_engine: "cli"`를 보내도 400이 아니고 무시됨(1단계 AC-31 대체).
- **AC-32** [2a] `GET /api/ai/status`: 키 없음 + 기기 없음 → `ready: false`. 키 없음 + 기기 있음(꺼져 있어도) → `ready: true`, 요약 첫 경로 `{cli, claude}`.

### E. 취소 · 정리
- **AC-33** [2a] `queued` 취소 → 즉시 `cancelled`, 어느 기기도 못 잡음. `running` 취소 → `cancel_requested: true` → A1의 다음 heartbeat 응답 `cancel: true` → A1이 `cancelled` 결과 → `cancelled`. 끝난 작업 취소 → 409.
- **AC-34** [2a] `running` 취소 뒤 A1이 응답 없이 리스가 지나면 `queued`가 아니라 `cancelled`.
- **AC-35** [2a] [다시 시도]: `failed` 작업 `retry` → 새 id · 같은 `params` · `queued`. `succeeded` 작업 retry → 409. 같은 논문에 진행 중인 요약이 있는 상태에서 `failed` 요약 작업을 retry → 새 작업을 만들지 않고 진행 중인 그 작업을 `200`으로 돌려줌(새 작업이면 `202`). 범위 밖 · 없는 id → 404.
- **AC-36** [2a] 정리(시간 주입): 31일 지난 끝난 작업 삭제, 24시간 지난 `write` 결과 `result = null`, `deadline_at` 지난 `queued` → `failed` · `no_worker_timeout`. 대기 기한(확정 U7): 새 CLI `summary` 작업의 `deadline_at - created_at` = 24시간, `chat` · `write` = 30분. 31분 지난 CLI 대화 작업은 `failed`, 23시간 지난 CLI 요약은 아직 `queued`. (개정 2026-10-08) 기한은 **만들 때** 정해지고 첫 칸이 API인 작업도 같은 값으로 시작함: API 칸이 폴백 대상 오류로 실패해 CLI 칸으로 넘어간 작업은 `deadline_at`이 **넘어간 시각 + 기한**(요약 24시간 · 대화 · 글쓰기 30분)으로 다시 정해지고, 같은 CLI 칸에서 다른 PC로 다시 대기하거나 리스 만료로 다시 대기해도 `deadline_at`은 그대로. `runner = api`로 대기 중인 작업은 `deadline_at`이 지나도 `no_worker_timeout`으로 실패하지 않음.
- **AC-37** [2a] 논문을 지우면 그 논문의 작업 행도 사라지고, 그 작업에 대한 워커 result → 404(500 아님).

### E2. API 실행기 (개정 — K2' 서버 프로세스 안 실행기)
- **AC-40** [2a] 자동: 앱 라우트에 `/internal/`로 시작하는 경로가 없고, 코드 · 설정에 `SERVICE_URL` · `TASKS_QUEUE` · `TASKS_INVOKER_SA` · `TASKS_BACKEND` · `cloudtasks`가 없음(검색 0건 — `docs/` 제외). 실행기를 부를 수 있는 HTTP 경로가 없음.
- **AC-41** [2a] 키 있는 A의 요약 작업이 화면 요청과 무관하게 `succeeded`까지 감(작업을 만든 클라이언트가 바로 연결을 끊어도). `progress`가 1초에 한 번 이하로 갱신됨(DB 쓰기 횟수 기록). 실행 스레드 4개 · 사용자당 동시 2개(작업 6개를 한꺼번에 만들면 같은 시각 `running`이 사용자당 2개 이하).
- **AC-42** [2a] 서버 재시작 흉내: 실행 중 실행기를 강제로 멈추고(리스 갱신 중단 주입) **새 앱 인스턴스**(같은 테스트 DB)를 띄우면 복구 스캔(간격 주입)이 그 작업을 다시 잡아 `succeeded`(`attempts = 2`). 리스 만료가 세 번째면 다음 칸 `{cli, claude}`로 `queued`, 다음 칸이 없으면 `failed` · `lease_exhausted`. 메모리 대기열에 넣지 않은 `queued` API 작업도 복구 스캔이 잡음.
- **AC-43** [2a] API 실행 중 취소 → 다음 스트림 이벤트에서 멈추고 `cancelled`, 요약 저장 없음.
- **AC-97** [2a] (신규 — 2a 품질 수정) `interactive`: 키 있는 A의 대화(또는 글쓰기) SSE가 시작되면 작업 행이 `running` · `runner: "api"` · `interactive: true` · `lease_until ≈ 시작 + 660초`(시간 주입). ① 리스(시간 주입)가 지난 뒤 그 사용자의 `GET /api/jobs/{id}`(또는 목록 · claim)를 부르면 `cancelled` · `error_code: "interrupted"`, 작업이 다시 `running`이 되지 않고 대화 메시지 · 글쓰기 결과가 저장되지 않음. ② 복구 스캔(간격 주입)이 이 행을 대기열에 넣어도 API 실행기가 AI를 호출하지 않음(가짜 AI 호출 0회). ③ 같은 상황의 요약(`interactive: false`)은 리스가 지나면 다시 실행됨(AC-42와 같음). ④ SSE 도중 가짜 클라이언트가 연결을 끊으면 약 0.05초 단위 확인 뒤(테스트는 1초 안) 작업이 `cancelled` · `interrupted`이고, 끊긴 뒤 가짜 AI가 `done`을 내도 저장되지 않음. ⑤ API가 폴백 대상 오류(401)로 실패해 `{cli, …}` 칸으로 넘어간 작업은 `interactive: false`가 되고, 리스가 지나도 `interrupted`로 취소되지 않고 보통의 CLI 재대기 규칙(6.3절)을 따름. ⑥ 11분(660초)을 넘기는 스트림은 ①대로 끝날 수 있음 — 수용 위험(19장)이라 실패로 보지 않고 동작만 단언.
- **AC-98** [2a] (신규 — 2a 품질 수정) 취소 요청 뒤 다시 대기 금지: `running` 작업에 취소를 요청(`cancel_requested`)한 뒤 ① 그 기기를 해지하거나 ② 그 기기가 `cli_not_logged_in` · `cli_not_found`로 결과를 올리면 작업이 `queued`로 돌아가지 않고 `cancelled`. 해지 응답 `requeued_jobs`에 포함되지 않음. 취소 요청 없이 같은 일을 하면 `queued`(AC-15 · 11.8절)로 돌아감.
- **AC-99** [2a] (신규 — 2a 품질 수정, 품질팀 L5) 폴백 때 해지된 기기 건너뛰기: 경로 `[{api,claude},{cli,claude},{cli,codex}]`로 만든 작업 뒤 claude를 가진 유일한 기기를 해지하면, API 칸이 폴백 대상 오류로 실패할 때 `{cli, claude}` 칸을 건너뛰고 `{cli, codex}`로(codex 기기가 있을 때) `queued`, 없으면 `failed`(API 오류 + 연결 안내). 만든 뒤 새 기기를 연결해도 이미 만들어진 경로의 칸 목록은 바뀌지 않음(`route` 그대로).
- **AC-44** [2a] **[실환경]** 서버 PC 운영에서 키 있는 계정으로 요약 시작 → 브라우저를 닫고 사용자 PC 워커도 끈 상태로 5분 뒤 다시 열면 요약이 저장돼 있음. 다른 요약을 시작한 직후 서버 PC에서 `update.ps1 -RestartOnly`(또는 작업 관리자로 서버 강제 종료)를 해도 2~3분 안에 그 요약이 끝남.
- **AC-45** [2a] (U2) 설정: `PUT /api/settings {"openai_api_key": "sk-test-…", "google_api_key": "AIza-test-…"}` → `openai_api_key_set: true` · `google_api_key_set: true`, 평문 없음, DB 암호문에 평문 없음, A의 OpenAI 암호문을 B 행으로 복사하면 B는 `openai_api_key_status: "unreadable"`. `rotate-key` 뒤 세 키 모두 새 `key_id`.
- **AC-46** [2a] (U2) 라우팅: `ai_routing.summary = ["codex"]` + OpenAI 키(가짜 OpenAI 서버 성공) → `runner: "api"` · `engine: "codex"`로 `succeeded`, 가짜 서버가 받은 요청 본문에 PDF(base64 · `application/pdf`)가 없고 논문 본문 텍스트가 있음, 키는 헤더에만(주소 쿼리에 없음 — Google도 같은 검사). `["gemini"]` + Google 키도 같음.
- **AC-47** [2a] (U2) 폴백: 가짜 OpenAI · Google 서버가 401 · 429 · 500을 내면 다음 칸 `{cli, codex}`/`{cli, gemini}`로 `queued`(`history[0].error_code` 각각 `api_auth` · `api_rate_limit` · `api_server`), 안전 차단 · 길이 끊김 응답이면 폴백 없이 `failed`(`api_refusal` · `api_max_tokens`).
- **AC-48** [2a] (U2) 서버 환경 변수 `OPENAI_API_KEY` · `GEMINI_API_KEY` · `GOOGLE_API_KEY`가 있어도 키를 등록하지 않은 사용자의 codex · gemini 경로에 API 칸이 생기지 않음. 로그에 `sk-` · `AIza` 시험 키가 없음(AC-96 확장).

### F. 워커 · CLI 실행 [Node]
- **AC-50** [2b] 실행 파일 찾기: 가짜 `PATH`에 `claude.exe`(가짜)와 `claude.cmd`가 함께 있으면 `.exe`를 고름. `.cmd`만 있고 npm 형식 패키지가 있으면 `node.exe <진입 js>`로 실행(명령줄 기록 검사). 어떤 경우에도 `shell: true` 실행의 인자에 프롬프트 · 시스템 프롬프트 · 스키마 문자열이 없음.
- **AC-51** [2b] 여러 줄 · 한글 · 이모지 · `%` · `"` · `&` · `^`가 든 프롬프트(약 1MB)가 가짜 CLI의 stdin으로 **바이트 그대로**(SHA-256 같음) 도착. 시스템 프롬프트는 파일 경로 인자로 가고 그 파일 내용이 원문과 같음.
- **AC-52** [2b] 가짜 CLI가 30초 동안 응답 없음 + 시간 제한 2초(주입) → 작업 `failed`/`cli_timeout`, 가짜 CLI가 띄운 **자식 프로세스까지** 남아 있지 않음(프로세스 목록 검사).
- **AC-53** [2b] 취소: 실행 중 heartbeat 응답 `cancel: true`(가짜 서버) → 1초 안에 프로세스 트리 종료 · `cancelled` 결과 전송.
- **AC-54** [2b] 로그인 안 됨: 가짜 claude가 `is_error: true` 결과 + `auth status` 종료 코드 1 → 결과 `cli_not_logged_in`, 다음 hello에서 claude `logged_in: false`.
- **AC-55** [2b] 모델: `cli_models.claude = "opus"` → 가짜 CLI 인자에 `--model opus`, `"default"` → `--model` 없음. 어떤 설정에서도 `--model claude-opus-5-5` 같은 API id가 넘어가지 않음. 가짜 CLI가 모델 오류를 내면 `--model` 없이 한 번 다시 실행하고 `stats.model_fallback: true`.
- **AC-56** [2b] 작업 폴더: 실행 중 cwd가 `…\PaperLab\work\<job id>`(빈 폴더)이고 끝나면 폴더가 없음. 실패 · 취소 때도 지움.
- **AC-57** [2b] 환경: 부모에 `CLAUDECODE=1` · `CLAUDE_CODE_ENTRYPOINT=x` · `ANTHROPIC_BASE_URL=x`가 있어도 가짜 CLI가 받은 환경에 없음(K9 채택 시 `ANTHROPIC_API_KEY`도 없음).
- **AC-58** [2b] 동시 실행: claude 자리 2 · 전체 2 설정에서 작업 5건 → 동시에 도는 가짜 CLI가 최대 2개.
- **AC-59** [2b] 도구 끔: claude 명령에 `--tools ""` · `--permission-prompts none`, codex에 `--sandbox read-only`, `--bare` 없음(인자 기록 검사).
- **AC-60** [2a] 지금 `tests/test_ai.py::test_cli_engine_with_fake_claude`(Windows에서도 가짜 CLI로 통과 — 해결됨)는 서버 쪽 "CLI 요청 만들기 · 결과 해석" 테스트로 대체되어 **Windows에서 통과**하고, 서버 코드에 `subprocess` · `shutil.which("claude")` 호출이 남아 있지 않음(코드 검사).
- **AC-61** [2b] 사용자 폴더 이름에 한글 · 공백이 있는 경로(`C:\Users\홍 길동\…`을 흉내 낸 임시 경로)에서 작업 폴더 · 토큰 파일 · 로그가 정상 동작.
- **AC-62** [2b] 로그 검사: 워커 테스트 전체의 로그 파일에 프롬프트 표지 문자열(테스트용 고유 문자열) · 기기 토큰 · `sk-ant-` 시험 키가 한 번도 없음.
- **AC-63** [2a+2b] 서버가 426 `update_required`를 주면 워커가 claim을 더 하지 않고 상태 `update_required`. (2a: Python 가짜 워커가 `app_version`을 낮춰 보내면 서버가 426 `update_required`를 주고 작업을 주지 않음. 2b: Node 워커가 426을 받고 claim을 멈춤)
- **AC-64** [2b] 적응형 폴링: 가짜 서버가 `next_poll_s: 60`을 주면 다음 claim까지 60초(시계 주입), `nudge()`를 부르면 즉시 claim.

### G. Electron 앱 [수동 · 실환경]
- **AC-70** [2b] **[실환경]** (개정 U10) 클라우드 화면 설정 "연결된 PC"의 **[PC 앱 받기]**(서버 PC `/downloads/`)로 `PaperLab-Setup-<버전>.exe`를 **다른 Windows 사용자 계정**에서 받아 화면의 SHA-256과 `Get-FileHash` 값이 같은지 확인한 뒤 실행 → SmartScreen 경고를 [추가 정보] → [실행]으로 넘겨 관리자 권한 창 없이 설치 → `%LOCALAPPDATA%\Programs\PaperLab`에 설치, 시작 메뉴 · 바탕화면 바로가기. — PLAN 완료 기준
- **AC-71** [2b] **[실환경]** (개정 U10) 버전 X 설치 상태에서 버전 X+1 커밋을 서버 PC에 `update.ps1`로 반영(빌드 성공) → 앱이 6시간 안(시험은 [업데이트 확인] 메뉴)에 `https://kimjuhyeon.tailac17f6.ts.net/downloads/latest.yml`을 보고 받아 "업데이트 준비됨" → 종료(또는 [지금 다시 시작]) 때 설치되어 X+1(“이 PC 상태”의 버전). 업데이트 설치 때 SmartScreen · 관리자 권한 창이 뜨는지, 서명 없는 앱에서 Authenticode 검증으로 막히지 않는지 기록. 접근 로그에서 차등 받기(`.blockmap` 두 개 + `.exe` Range 요청)였는지 전체 받기였는지 기록. — PLAN 완료 기준
- **AC-72** [2b] **[실환경]** 앱 첫 실행 → (주소 입력 없이 — U6) 내장 주소 `https://kimjuhyeon.tailac17f6.ts.net` 확인 → [Google로 계속] → **시스템 브라우저**가 열려 로그인 → 앱 창으로 돌아와 서재가 보임. 앱 창 안에서 구글 로그인 화면이 뜨지 않음. — PLAN 완료 기준
- **AC-73** [2b] **[수동]** 앱 창에서 PDF 읽기 · 업로드 · 하이라이트 · 원고 · 워드/한글 내보내기(저장 대화상자) · 인용 복사가 브라우저와 같게 됨. "PDF 파일 열기"는 시스템 브라우저(또는 정한 방식)로 열림. 화면 안의 외부 링크(DOI 등)는 시스템 브라우저로.
- **AC-74** [2b] **[수동]** 개발자 도구 콘솔에서 `typeof require`, `typeof process` → `"undefined"`, `window.paperlabDesktop`에 13.3절 함수 말고는 없음, `paperlabDesktop.info()`에 토큰이 없음. 앱 창에서 `location = "https://example.com"` → 앱 창은 이동하지 않음.
- **AC-75** [2b] **[수동]** 앱 창 [이 PC 연결] 한 번으로 연결 → 설정 "연결된 PC"에 이 PC가 켜짐으로, 엔진 칩이 실제 설치 · 로그인 상태와 같음. 다른 PC 브라우저에서 만든 코드를 [코드로 연결]로 넣어도 연결됨.
- **AC-76** [2b] **[실환경]** PC 두 대(A1 · A2 실제 앱, API 키 없음)를 켜고 요약 → 한 대만 실행("이 PC 상태" 두 곳 확인), 실행 중인 PC의 앱을 [종료]가 아니라 **작업 관리자로 강제 종료** → 약 90초 뒤 다른 PC가 이어받아 완료. — PLAN 완료 기준
- **AC-77** [2b] **[실환경]** codex가 없는 PC만 켜 두고 codex 경로 작업 → 그 PC가 잡지 않고 화면에 "codex가 있는 PC 없음". — PLAN 완료 기준
- **AC-78** [2b] **[수동]** 창 X → 트레이로 숨고 작업 계속, 트레이 [종료] → 실행 중 작업이 있으면 확인 창. Windows 다시 로그인 → 트레이로 자동 시작(창 안 뜸). 앱을 두 번 실행해도 트레이 아이콘 · 워커가 하나.
- **AC-79** [2b] **[수동]** 연결된 PC를 화면에서 해지 → 그 PC 앱이 쉬는 폴링 간격(60초) + 10초 안에 "이 PC 연결이 해지됐어요"를 보이고 `device.bin`이 사라짐. — PLAN "해지한 기기 토큰으로는 작업을 받지 못함"
- **AC-80** [2b] **[수동]** 워커 PC 검사: `%APPDATA%\PaperLab`과 설치 폴더 전체에서 `postgres://` · `SUPABASE_DB_URL` · `service_role` · R2 키 이름 · `sk-ant-`가 나오지 않음, `device.bin`은 평문 토큰(`pld1.`)을 포함하지 않음(DPAPI). — PLAN "워커 PC에 DB 접속 정보가 없음"
- **AC-81** [2b] **[실환경]** 실제 claude CLI(이 PC)로 CLI 요약 1건 · 대화 1건이 끝까지 성공(모델 설정 `default` · `opus` 각각) — 알려진 문제 `unrecognized_model`이 재현되지 않음.
- **AC-82** [2b] **[수동]** `main.log` · `worker.log`에 프롬프트 · 논문 본문 · 토큰이 없음(실제 작업 3건 뒤 검색).
- ~~**AC-83** 서버 PC 워커~~ — **해당 없음**(사용자 결정 Q-S3, 2026-10-07: 서버 PC에는 워커를 두지 않음 — 13.9절). 번호는 비워 둠.
- **AC-84** [2b] **[실환경] (신규 — 주소 내장)** 설치 파일로 깐 앱의 설정 파일 · 화면 어디에도 주소 입력 칸이 없고, 앱이 `https://kimjuhyeon.tailac17f6.ts.net`에만 접속(다른 출처로 이동하지 않음 — AC-74와 함께). 저장소에서 이 주소가 1단계 S10의 한 곳(+ 문서)에만 있음(1단계 AC-69 검사를 `desktop/`까지).
- **AC-85** [2b] **[수동] (신규 — 서버 꺼짐)** 서버 PC의 Funnel을 끄거나(`funnel.ps1 off`) 서버를 멈춘 상태로 앱을 열면 E9 "서버에 연결할 수 없어요" 화면, 다시 켜면 30초 안에 자동으로 앱 창이 열리고 워커가 다시 claim.
- **AC-86** [2b] **[Node + 수동] (신규 — 1A 외부 링크, 13.2.1절)** (a) [Node] `isExternalAllowed`: `https://www-dbpia-co-kr-ssl.openlink.inha.ac.kr/x` · `https://lib.inha.ac.kr/login` · `https://scholar.google.com/scholar?q=a` · `https://doi-org-ssl.openlink.inha.ac.kr/10.1109/CVPR.2016.90` · 목록 밖 `https://www.example-publisher.com/article/1` · `http://ieeexplore.ieee.org/document/7780459/` → 허용(K21 ①). `file:///C:/Windows/System32/calc.exe` · `javascript:alert(1)` · `data:text/html,x` · `blob:https://kimjuhyeon.tailac17f6.ts.net/x` · `mailto:a@b.c` · `smb://host/share` · `ms-settings:` · `ftp://x.org/` · 빈 값 · 해석 안 되는 문자열 → **모두 거부**. (a2) [Node] 요청한 곳 · 개수 제한(13.2.1절 7 · 8번): 서버 출처 최상위 프레임에서 온 허용 주소 → 허용, 같은 주소라도 하위 프레임 또는 다른 출처(`https://example.com`)에서 온 요청 → 거부. 주입한 시계로 10초 안에 6번째 요청 → 거부, 첫 요청에서 10초가 지난 뒤 → 다시 허용. (b) [수동] 앱 창에서 논문 찾기 결과 카드 · 서재 상세 패널 · 읽기 화면(PDF 없는 논문)의 "인하대에서 보기", 논문 찾기 [RISS] [DBpia] [KISS] [Google Scholar], 정보 탭 "Google Scholar에서 보기", 설정 창 [학교 로그인]을 하나씩 누름(처음 안내 창이 뜨면 [계속 열기]) → 각각 **기본 브라우저**에 열리고, 앱 안에 새 창이 생기지 않으며 앱 창은 PaperLab 화면에 그대로 있음. 학교에 로그인한 뒤에도 앱 쪽 파티션(`persist:paperlab`)의 쿠키에 `inha.ac.kr` 쿠키가 없음(개발자 도구 Application 탭).
- **AC-87** [2a] **(신규 — U10, `/downloads/`)** 자동(pytest, 임시 `releases` 폴더 주입): `latest.yml` · `PaperLab-Setup-0.2.0.exe` · `.exe.blockmap`을 두면 토큰 없이 `GET` 200(`HEAD`도 200 · 같은 `Content-Length`). `GET /downloads/` · `/downloads` → 404(목록 없음). 이름 `release.json` · `.staging/latest.yml` · `../cloud.env` · `..%2f..%2fcloud.env` · `%2e%2e/x` · `..\\x` · `C:%5cWindows%5cwin.ini` · `latest.yml::$DATA` · `PaperLab-Setup-0.2.0.exe.bak` · `PaperLab-Setup-1.exe` · 대소문자 다른 `LATEST.YML` · 폴더 밖을 가리키는 심볼릭 링크(만들 수 있으면) → 모두 404이고 폴더 밖 파일 내용이 응답에 없음. `POST` · `PUT` · `DELETE` → 405. `Cache-Control`: `latest.yml` = `no-cache`, `.exe` · `.blockmap` = `public, max-age=31536000, immutable`, 응답에 `X-Content-Type-Options: nosniff`. `Range: bytes=0-99` → 206 · 100바이트, `Range: bytes=0-9,20-29` → 206(다중 범위 — 안 되면 결과를 보고하고 팀장에게, 13.7.1절). `.exe` 동시 4번째 → 503 · `Retry-After`, 같은 IP 시간당 11번째 → 429(시계 주입, `Retry-After: 600`). (개정 2026-10-08) `latest.yml`을 받은 `ETag` 값 그대로 `If-None-Match`에 넣어 다시 `GET` → 304(본문 없음, `ETag` · `Cache-Control: no-cache` 헤더), 다른 값 → 200. **`Range` 요청은 시간당 횟수에 들어가지 않음**(`Range: bytes=0-99`로 11번 이상 받아도 429가 안 나오고, 그 뒤 `Range` 없는 전체 `GET`은 여전히 10회까지 200 · 11번째 429. 동시 4번째 `Range` 요청은 503, `HEAD`는 세지 않음). **주소 127.0.0.1 · `X-Forwarded-For` 없음이면 전체 `GET` 시간당 60회**(61번째 429 — 시계 주입), `X-Forwarded-For`가 서로 다른 두 IP는 각자 10회씩. 설치 파일 폴더는 환경 변수 `PAPERLAB_RELEASES_DIR`로 주입(없으면 기본 `D:\PaperLab\releases` — 시험은 임시 폴더를 이 변수 또는 `create_app(releases=…)`로 줌). `GET /api/desktop/release`: 토큰 없음 401, 로그인하면 `release.json` 내용(`url`이 `/downloads/`로 시작), 파일 없으면 404. 1단계 AC-01의 공개 예외 목록에 `/downloads/*`만 추가됨(다른 경로는 여전히 401).
- **AC-88** [2b] **(신규 — U10, `update.ps1` 빌드 단계)** 자동(가짜 `npm`으로 PowerShell 스크립트 시험 — `update.ps1`은 `npm ci` · `npm run dist`만 부름, 지금 `tests/test_server_pc_scripts.py` 방식): (a) `desktop/` 변경 + 새 버전 → 빌드 호출, `releases`에 `.exe` · `.blockmap` · `release.json` · `latest.yml`, `latest.yml`이 **마지막에** 바뀜(파일 시각 · 호출 순서 기록), `release.json`의 `sha256`이 실제 파일과 같음. (b) 가짜 빌드 실패(종료 코드 1) · 시간 초과 · `latest.yml` sha512와 실제 파일 불일치 → `update.log`에 `WARN` · `releases`의 이전 파일 그대로(해시 같음) · `.staging` 없음 · **스크립트 종료 코드 0**(서버 반영 성공일 때). (c) `desktop/` 변경 + 버전 그대로 → 빌드 안 함 + WARN 문구. (d) `desktop/` 변경 없음 → 빌드 안 함(WARN 없음). (e) 서버 상태 확인 실패로 되돌린 경우 · `-Ref` · `-RestartOnly` → 빌드 안 함. (f) `node`가 없거나 주 버전 22 미만 → 빌드 단계만 WARN, 서버 업데이트는 성공. (g) 4번째 버전을 넣으면 가장 오래된 버전의 `.exe` · `.blockmap`이 지워지고 3개만 남음. (h) 코드 검사: electron-builder 설정의 `publish`가 `generic`이고 `url`이 `server.json`의 `public_url` + `/downloads/`에서 오며 `https://`로 시작, 저장소 어디에도 `GH_TOKEN` · `provider: "github"`가 없음(문서 제외), 공개 주소 한 곳 검사(1단계 AC-69)가 `desktop/`까지 통과.
- **AC-89** [2b] **[실환경] (신규 — U10, 서버 PC 빌드)** 서버 PC에서 `node -v`(LTS 주 버전 기록) → `update.ps1 -BuildDesktop`이 성공해 `D:\PaperLab\releases`에 세 파일이 생기고 `update.log`에 버전 · sha256, 빌드 시간 기록. 다른 망(휴대폰 데이터)에서 `https://kimjuhyeon.tailac17f6.ts.net/downloads/latest.yml` 200 · `/downloads/` 404. `icacls D:\PaperLab\releases`가 1단계 AC-58 (5)와 같음. Electron · NSIS 캐시가 D:에 있음.

### H. 화면 [수동]
- **AC-90** [2a] 설정에 "API / Claude CLI" 선택 버튼이 없고 S1 안내 · S2 작업별 엔진 · S4 연결된 PC가 있음(1단계 AC-65 대체).
- **AC-91** [2a+2b] CLI 대기 작업이 있고 PC가 모두 꺼져 있으면 읽기 화면 · 작업 목록에 "대기 중 — 켜진 PC 없음", PC를 켜면 이어서 실행되고 화면이 새로 고침 없이 완료로 바뀜. (**2a**: 연결된 기기가 있는데 꺼져 있는 상태를 만들어 "대기 중" 표시를 확인하고, Python 가짜 워커가 잡으면 화면이 새로 고침 없이 완료로 바뀜. 워커가 아예 없는 동안은 대기 기한(6.6절)까지 대기. **2b**: 실제 앱이 설치된 PC를 켜서 같은 흐름을 확인)
- **AC-92** [2a] (확정 U8 · K2') 요약 시작 후 탭을 닫았다가 다시 열면 진행 중 또는 완료된 요약이 보임. 설정 화면에 Anthropic · OpenAI · Google 키 칸 세 개(S3).
- **AC-93** [2a] 대화에서 API 401 폴백 때 "API가 실패해서 PC로 넘겼어요" 문구, 설정 API 키 옆 "최근 실패" 표시.
- **AC-94** [2a] 작업 목록에서 취소 · 다시 시도가 되고 실패 사유(`history`)가 펼쳐짐.

### I. 회귀
- **AC-95** [2a] 1단계 자동 수용 기준 전부 통과. 바뀐 것: AC-31(`ai_engine: "cli"` 400 → 무시), AC-53(요약 SSE → 작업 기준 AC-25 · 41로 대체 — K2'), AC-65(CLI 비활성 → AC-90). 품질팀은 대체 표를 결과 보고에 적음.
- **AC-96** [2a] 1단계 AC-49(로그에 키 · JWT · 서명 없음)를 워커 API 포함 전체 테스트로 다시 확인 — 기기 토큰 · 연결 코드도 로그에 없음.

## 18. 범위 밖

- 2장 "안 하는 것" 전부.
- Supabase Realtime(K1을 ③으로 바꾸지 않는 한), 화면의 실시간 구독.
- 코드 서명 인증서 구입 · EV 서명, SmartScreen 평판 쌓기 작업.
- 앱 안 오프라인 모드 · 로컬 캐시(앱은 클라우드 화면 그대로).
- 워커 원격 관리(화면에서 PC의 엔진 끄기 · 동시 실행 수 바꾸기) — PC 앱 설정에서만.
- CLI 설치 · 로그인 자동화(사용자가 각 CLI를 직접 설치 · 로그인 — 안내만).
- GitHub Actions로 설치 파일 빌드(1단계 Q11 — CI 안 함). (개정 U10) **GitHub Releases 배포 · `gh` CLI · 배포 토큰**(사용자 결정 — 서버 PC가 빌드 · 배포), `/downloads/` 로그인 요구(K22 ① — 운영 중 남용이 보이면 재검토), 자체 서명 키로 `latest.yml` 서명(13.7.1절 무결성 — 이득이 작음), 앱 다운그레이드, 단계적 배포(`stagingPercentage`).
- (개정 Q-S3) 서버 PC 워커 · 서버 PC용 워커 설정(동시 실행 수 · codex 끔).
- 기기 토큰 자동 회전 · 만료(해지로만 — 가정).
- 작업 사용 비용 집계 화면(`stats.cost_usd`는 저장만 하지 않고 로그에도 안 남김 — 가정).

## 19. 위험

| 위험 | 내용 | 대응 |
|---|---|---|
| 구글 로그인 차단 | Electron 창 안 구글 로그인은 Google이 막음 | 시스템 브라우저 + 딥 링크(13.4절 ①), AC-72. Supabase가 사용자 정의 스킴 리디렉션을 거부하면 ② 루프백으로(K10) |
| 서명 없는 설치 파일 | SmartScreen 경고 · 백신 오탐 · 사용자가 설치를 포기. (개정 U10) 서명이 없어 electron-updater의 Authenticode 검증이 어떻게 동작하는지 확인 필요 | 설치 안내(E8) · AC-70 · 71로 실제 동작 기록, 무결성은 HTTPS + sha512 + 처음 설치 SHA-256 표시(13.7.1절). 오탐이 잦으면 코드 서명(유료)을 다시 검토 |
| CLI 버전 · 플래그 변화 | CLI가 자주 바뀜(문서상 플래그마다 필요 버전이 다름 — 예: `--permission-prompts`는 2.1.259 이상) | 워커가 `--version`을 광고, 모르는 옵션 오류를 `cli_exit`로 보고 · 사용자에게 "CLI를 업데이트해 주세요", 앱 업데이트로 대응. 엔진별 최소 버전 표를 개발팀이 확정 |
| Windows `.cmd` 실행 | 여러 줄 인자 잘림 · Node `EINVAL` · 인자 주입 | `.exe`/`node <js>` 우선, stdin · 파일만, AC-50 · 51 |
| 논문 본문의 지시문(프롬프트 주입) | 본문에 "명령을 실행하라" | CLI 도구 끔 · 읽기 전용 샌드박스 · 빈 작업 폴더(AC-56 · 59) — 최악이어도 이상한 글이 나올 뿐 PC에서 실행되지 않게 |
| 구독 약관 · 한도 | 자동화된 CLI 사용 · 사용 한도 | 자기 계정 작업만(확정), 동시 실행 수 보수적(6.7절), 한도 오류는 폴백 · 안내(11.8절) |
| 예상 밖 종량 과금 | 사용자 PC 환경에 `ANTHROPIC_API_KEY`가 있으면 CLI가 그 키로 과금될 수 있음 | K9(자식 환경에서 뺌) |
| 폴링 부하 | 기기 · 사용자가 늘면 서버 PC · Supabase 질의가 늘어남(개정 전: Cloud Run 무료 범위 초과) | 적응형 간격, 쉬는 간격 상수로 조절, 2단계 끝에 요청 수 측정 · 보고 |
| Supabase 일시정지 정책 | 워커 폴링이 DB를 계속 깨움 — 정책상 문제 여부 **확인 필요** | 실제 사용 트래픽임을 기록, 문제가 되면 쉬는 동안 DB를 건드리지 않는 claim(메모리 "대기 작업 있음" 표시) 검토 |
| DB 용량 | `jobs.progress.partial_text` · `result`가 쌓임 | 64KB · 2MB 상한, 반영 후 비우기, 30일 삭제(6.8절) |
| 기기 토큰 탈취 | DPAPI는 같은 사용자 세션의 악성 프로그램은 못 막음(공식 문서) | 토큰 범위가 "그 사용자 작업 받기 · 결과 올리기"뿐(서재 읽기 API 불가 — AC-19), 해지 즉시 차단, 기기 목록에 마지막 접속 표시 |
| 프롬프트에 논문 본문 | 워커 PC · CLI 회사로 본문이 감 | 사용자 자신의 PC · 자신의 구독(확정 취지). 실행 후 임시 폴더 삭제, 로그에 본문 없음 |
| 공개 저장소 | 앱 소스 · 워커 프로토콜이 공개 | 비밀은 서버 · 토큰에만, 프로토콜 자체는 공개돼도 안전하게 설계(토큰 없이는 아무것도 못 함) |
| 두 시스템 버전 어긋남 | 서버는 배포, 앱은 업데이트 지연 | `protocol` · `min_app_version` · 426(8.3절), 서버를 먼저 배포(14장) |
| ~~Cloud Tasks 설정 실수~~ | 개정: Cloud Tasks를 쓰지 않음(K2') | — |
| 서버 프로세스 안 실행기(K2') | 서버 재시작 · 업데이트 · 강제 종료 때 실행 중 API 작업이 끊김, 같은 작업이 두 번 API를 부를 수 있음(요금 두 번) | 리스 + 복구 스캔으로 이어서 실행, 다시 실행 최대 2회, 결과는 한 번만 반영(AC-42), 업데이트는 사용자가 적은 시간에(1단계 13.8절) |
| 서버 PC 한 대에 모두 걸림 | 서버 PC가 꺼지면 앱 창 · 워커 · API 실행기 모두 멈춤 | 1단계 18장 대응, 앱의 E9 화면 · 자동 재시도(AC-85), CLI 작업은 대기 기한(U7) 안에 서버가 돌아오면 이어서 |
| ~~서버 PC 워커와 비밀값이 같은 PC~~ | **해당 없음**(Q-S3 — 서버 PC에 워커를 두지 않음, 13.9절) | — |
| ~~서버 PC CLI 버전~~ | **해당 없음**(같은 이유). 사용자 PC CLI의 최소 버전 문제는 위 "CLI 버전 · 플래그 변화" | — |
| 설치 파일 공개 다운로드(U10 · K22 ①) | 누구나 `/downloads/`에서 받을 수 있어 반복 다운로드로 Funnel 대역폭 · 서버 PC 회선을 씀, 앱 버전이 드러남 | 비밀값 없음(U6) · 공개 저장소라 숨길 내용 없음, `.exe` 동시 3개 · 전체 `GET` IP별 시간당 10회(127.0.0.1 · XFF 없음이면 전체 60회, Range는 횟수 제외 — 아래 줄), 접근 로그로 감시, 남용 시 업데이트에 기기 토큰 요구(③)로 재검토 |
| 서버 PC가 털리면 앱 배포도 오염 | `latest.yml`과 설치 파일이 같은 서버에서 나오므로 sha512 · HTTPS는 서버 PC 침해를 막지 못함 → 모든 사용자 PC에 악성 업데이트가 갈 수 있음 | **수용 위험**(코드 서명 없음 — 확정, 서명 키도 같은 PC에 있게 됨). 서버 PC 보안 관리(1단계 13.7절) · `releases` 권한 제한 · 빌드 로그 · `update.log` 확인, 의심 시 Funnel 즉시 끔 |
| 서버 PC 빌드 | 빌드가 서버 PC CPU · 디스크 · 인터넷을 씀(수 분), `npm ci` 공급망, 빌드 실패 | 서버 재시작 · 상태 확인 뒤에 빌드(서버 반영을 막지 않음), 잠금 파일 고정, 실패 시 이전 파일 유지 + WARN(13.7.1절), 업데이트는 사용자가 적은 시간에 |
| 대화 · 글쓰기 SSE가 11분(660초)을 넘김(2a 수용 위험, 2026-10-08) | `interactive` 작업의 리스는 660초 고정이고 연장하지 않음(6.3절). SSE가 그보다 길어지면 `expire` · 복구 스캔이 작업을 `cancelled` · `interrupted`로 끝내 **답이 저장되지 않고 끝날 수 있음**(모델 타임아웃이 600초라 드묾) | 수용. 다시 시도는 사용자가 [다시 시도](새 작업). 운영 로그에 `interrupted`가 잦으면 리스 연장(SSE 중 `touch_lease`)을 재검토 |
| `/downloads` Range로 횟수 제한 우회(2a 수용 위험, 2026-10-08) | `Range` 요청은 시간당 횟수에 넣지 않으므로 `Range: bytes=0-`로 전체 파일을 횟수 제한 없이 받을 수 있음(13.7.1절) | 수용. 동시 전송 3개 제한은 그대로 걸림. **2b 운영 접근 로그에서 지켜봄**(남용이 보이면 Range 요청도 세거나 기기 토큰 요구(③) 재검토) |
| 세 회사 API(U2) | OpenAI · Google 응답 모양 · 오류 코드 · 모델 이름이 바뀜, 키가 로그 · 주소에 남을 위험 | `httpx` 직접 호출을 실행기 한 곳에 모음, 공식 문서 확인(20.3절), 키 패턴 지우기 · 헤더로만(AC-46 · 48) |

## 20. 미정 사항 · 질문

### 20.1 사용자 결정 (2026-10-07 — 확정) · 남은 사용자 질문

| # | 질문 | 결정 | 반영 |
|---|---|---|---|
| **U1** | 작업별 기본 엔진(P8) | **모두 `[claude]`**(설정에서 각자 추가) | 9.1 · 9.4절 |
| **U2** | OpenAI · Google API 키 | **세 회사 키 모두 받기**(OpenAI · Google은 텍스트 전용 — 기획팀 안 ②) | 3장, 9.4~9.6절, S3, AC-45~48 |
| **U3** | 앱 이름 · 아이콘 · 설치 | **PaperLab · 지금 아이콘 · 사용자별 설치 · 관리자 PC 바로가기도 앱으로 교체** | 13.7절, E1 |
| **U4** | 자동 시작 · 창 닫기 | **자동 시작 + X는 트레이로**(설정에서 끌 수 있음) | 13.5절 |
| **U5** | 자동 업데이트 | **자동으로 받고 종료 때 설치** + "지금 다시 시작" | 13.7절 |
| **U6** | 서버 주소 | **설치 파일에 넣기**(이제 `https://kimjuhyeon.tailac17f6.ts.net` — 서버 PC 전환) | 13.5 · 13.6 · 14장, E2, AC-72 · 84 |
| **U7** | CLI 대기 기한 | **요약 · 번역 24시간, 대화 · 글쓰기 30분** | 6.6절, AC-36 |
| **U8** | API 요약을 탭을 닫아도 계속 | **예** → K2'(서버 프로세스 안 실행기) | 15장, AC-25 · 41~44 |
| **U9** | PC당 동시 실행 수 기본값 | **기본값 그대로**: claude 2 · codex 1 · gemini 1 · 전체 2(앱 설정에서 바꿈) — 2026-10-07 | 6.7절 |
| **U10** | 설치 파일 배포 방법 | **변경(2026-10-07): GitHub Releases를 쓰지 않고 서버 PC가 직접 배포** — `update.ps1`이 빌드해 `D:\PaperLab\releases`, 서버가 `/downloads/`로 내려줌, 자동 업데이트는 electron-updater generic provider(U5 유지). 개정 전 선택지(① `gh` CLI ② 웹 업로드 ③ 토큰 파일)는 폐기 | 1 · 2장, 13.7 · 13.7.1 · 14장, S4 · E8, AC-70 · 71 · 87~89 |
| **Q-S3** | 서버 PC 워커를 누구 계정에 연결할지 | **서버 PC에는 워커를 두지 않음**(2026-10-07). 서버 PC는 배포 역할(13.7.1절) | 4장, 13.9절, AC-83 해당 없음 |
| **U11** | 서버 PC 워커에서 codex를 쓸지 | **해당 없음**(Q-S3 — 서버 PC 워커 없음) | 13.9절 |

**남은 미정 — 사용자 확인**: 없음(2단계). 1단계 Q-S2 · Q-S4~Q-S7은 1단계 명세 19.4절(2단계 개발을 막지 않음).

**사용자에게 요청할 준비 작업**(결정이 아님):
- Supabase 대시보드 Auth → URL Configuration → Redirect URLs에 `paperlab://auth-callback` 추가(K10 ①).
- ~~Google Cloud에서 Cloud Tasks API 사용 동의~~ → **필요 없음**(K2').
- 각 사용자 PC: 쓰려는 CLI(claude · codex · gemini)를 설치하고 한 번 로그인(설치 안내 E8). ~~서버 PC: claude 업데이트 · 워커 계정 로그인~~ → **필요 없음**(Q-S3).
- **서버 PC**: Node.js LTS 확인(실측 v24.14 — LTS 계열이면 그대로, 없으면 nodejs.org LTS 설치 파일) — 13.7.1절 · AC-89. 서버 PC 안내서에 절차 추가(21장).
- OpenAI · Google API 키를 쓸 사용자는 각 회사에서 키 발급(각자 요금).
- 시험용 두 번째 PC(또는 관리자 PC의 다른 Windows 사용자 계정) — AC-70 · 76 · 77. (개정 전 "서버 PC를 두 번째 PC로"는 Q-S3로 해당 없음)

### 20.2 팀장 결정

**K1~K17은 기획팀 추천안을 모두 채택했습니다(2026-10-07).** 단 서버 PC 전환으로 **K2 · K14는 다시 정해야 하고(K2' · K14')**, K1은 근거가 바뀌어 확인(K1'), 새 항목 K19 · K20이 생겼습니다. **K1' · K2' · K14' · K20도 기획팀 추천안으로 팀장 결정(2026-10-07).** **K21**(1A 연결 개정 — 이름 붙은 호스트 밖의 http(s) 링크)은 **①로 팀장 결정(2026-10-07)**. **남은 팀장 결정 없음** — K19(OpenAI · Google 기본 모델 id)는 **2026-10-08 팀장 결정으로 확정**(아래 표). 2a 구현 뒤 팀장이 승인한 구현 차이(2026-10-08)로 **K14'가 개정**됨(설치 파일 폴더 변수 1개). U10 변경(2026-10-07)으로 생긴 **K22 · K23 · K24**(배포 보안)는 **기획팀 추천안으로 팀장 결정(2026-10-07)**. K12는 U10 변경으로 **K12'**(14장)로 바뀌고, **K20은 해당 없음**(Q-S3). 디자인 시안(2026-10-08)의 **PD-1~PD-9는 모두 디자인팀 추천안으로 팀장 결정(2026-10-08)** — 표 아래.

| # | 항목 | 선택지 | 결정 / 기획팀 추천 |
|---|---|---|---|
| **K1** | 워커 알림(P2) | ① 긴 폴링 ② 고정 짧은 폴링 ③ Realtime 깨우기 + 안전망 폴링 ④ 적응형 폴링 + 앱 창 로컬 신호(10.1절 표) | **④ 채택**. (개정 전 근거 "Cloud Run 무료 범위 · Cloud Run으로만"은 사라짐) |
| **K1'** | (재검토) 서버 PC에서도 ④ 유지? | ④ 유지 / ① 긴 폴링 + 메모리 신호(서버 프로세스 하나라 가능) | **팀장 결정(2026-10-07): ④ 유지** — 긴 연결이 서버 스레드를 잡고 Funnel 긴 연결이 확인 안 됨(10장 메모) |
| **K2** | API 요약 실행 위치 | A Cloud Tasks / B SSE 유지 / C 인스턴스 청구(15.1절) | ~~A 채택~~ → Cloud Run 폐기로 **K2'로 대체** |
| **K2'** | (재결정) API 요약 실행 위치 — 서버 PC | A' 서버 프로세스 안 백그라운드 실행기(jobs 표 + 리스 + 복구 스캔) / D 서버 PC 별도 실행기 프로세스 / B SSE 유지(U8과 어긋남) | **팀장 결정(2026-10-07): A'**(15장). 관리 권한 사용 1줄(`api job recovery`) 추가가 따라옴(5.6절) |
| **K3** | 화면 진행 표시 | ① 폴링 ② SSE ③ Realtime(7.1절) | **①** |
| **K4** | 워커 구현 | ① Electron `utilityProcess`의 Node 워커(서버가 프롬프트 · 해석 담당) ② Python 워커 묶음 | **①** |
| **K5** | 기기 토큰 확인 | ① 토큰에 uid · device_id 포함 → 사용자 범위에서 해시 비교(service role 없음) ② 무작위 토큰 → 매 요청 `system_tx("device auth")` | **①** |
| **K6** | 리스 · 하트비트 · 시도 횟수 | 90초 · 30초 · 3회(6.3절) / 더 짧게(60 · 20) / 더 길게 | **90 · 30 · 3** |
| **K7** | 폴백 대상 오류 | 9.6절 표(키 · 권한 · 한도 · 서버 · 연결 · 400 폴백, 거절 · 결과 깨짐 · 끊김은 폴백 안 함) | **표대로** |
| **K8** | CLI 모델 지정 | ① 별칭 + 기본(`--model` 없음), API id 안 넘김, 모델 오류 시 기본으로 한 번 재실행 ② API id → 별칭 자동 변환만 ③ 늘 기본 모델 | **①** |
| **K9** | CLI 자식 환경에서 회사 API 키 변수 빼기 | ① 뺌(CLI = 구독만) ② 둠(사용자가 일부러 설정한 경우 존중 — 1st My paper 방식) | **①** |
| **K10** | 앱 창 구글 로그인 | ① 시스템 브라우저 + `paperlab://` + PKCE ② 시스템 브라우저 + 루프백 | **①**(Supabase 허용 확인 후, 안 되면 ②) |
| **K11** | 앱 코드 위치 · 언어 | ① 같은 저장소 `desktop/`, 빌드 없는 JS ② 별도 저장소 ③ TypeScript | **①** |
| **K12** | 빌드 · 릴리스 | 14장 절차(관리자 PC 빌드 → 초안 → 품질 확인 → 승인 후 게시) | ~~14장대로~~ → U10 변경으로 **K12'** |
| **K12'** | (U10 변경 — 사용자 결정 2026-10-07) 빌드 · 릴리스 | 서버 PC `update.ps1`이 빌드 → `releases` → `/downloads/`(13.7.1 · 14장) | **사용자 결정에 따른 절차** — 세부(빌드 조건 · 순서 · 보관 · 실패 처리)는 13.7.1절 기획팀 안 |
| **K13** | 작업 보관 | 끝난 작업 30일, 글쓰기 결과 24시간, 해지 기기 30일 | **그대로** |
| **K14** | 새 환경 변수 이름(K2 = A일 때) | `SERVICE_URL` · `TASKS_QUEUE` · `TASKS_INVOKER_SA` · (개발 · 테스트) `TASKS_BACKEND` | ~~채택~~ → **K14'로 대체** |
| **K14'** | (재검토) 2단계 새 환경 변수 | 없음(실행 스레드 수 · 스캔 간격은 서버 상수, 테스트는 주입) / 조정용 변수 추가 | **팀장 결정(2026-10-07): 새 변수 없음 → 개정(팀장 승인 2026-10-08, 2a 구현 뒤): 새 변수 1개 `PAPERLAB_RELEASES_DIR`**(설치 파일 폴더, 서버 PC `cloud.env` · 환경 변수, 기본 `D:\PaperLab\releases`, 비밀 아님 — 13.7.1절). 그 밖의 2단계 새 변수는 여전히 없음(API 실행기 스레드 수 · 스캔 간격은 서버 상수). (서버 PC 쪽 변수 `SUPABASE_APP_DB_URL` · `PAPERLAB_PUBLIC_URL` · `PAPERLAB_PG_DUMP`는 1단계 19.4절 S1 · S2 · S9) |
| **K19** | OpenAI · Google API 기본 모델 id(`api_models` 기본값) | 개발팀이 구현 때 각 회사 공식 문서의 현재 모델에서 고름 / 사용자에게 물음 | **확정 — 팀장 결정(2026-10-08)**: ① **OpenAI 기본 모델 `gpt-6.1-sol`** — 공식 목록 <https://developers.openai.com/api/docs/models>("near-Astra performance at a lower cost"), **비용 이유로 `astra` 대신** 이 모델 ② **Google 기본 모델 `gemini-3.8-flash`** — 공식 목록 <https://ai.google.dev/gemini-api/docs/models>(안정판, 새 프로젝트 권장) ③ **Anthropic은 기존 기본값 그대로**(설정 `model` = `claude-opus-5-5`) ④ 사용자는 설정에서 바꿀 수 있음(`api_models` · `model`, 9.4절). 2a 코드의 `ai.API_MODEL_DEFAULTS`가 ①②와 일치함을 확인함(기획팀은 공식 목록 페이지를 다시 읽지 않고 팀장 결정 문구를 그대로 옮김) |
| **K20** | 서버 PC 워커의 codex 기본값 | 끔 / 켬(13.9절 보안) | ~~팀장 결정: 끔~~ → **해당 없음**(Q-S3 — 서버 PC 워커 없음, 2026-10-07) |
| **K22** | (U10) `/downloads/` 접근 | ① 공개 + 남용 방지(동시 3 · IP별 시간당 10) ② Supabase 로그인 필요 ③ 기기 토큰 필요(13.7.1절 표) | **기획팀 추천 ①** — 설치 파일에 비밀값 없음(U6) · 공개 저장소, ②③은 업데이트가 끊기는 실패 모드를 만듦(electron-updater는 `requestHeaders` · `addAuthHeader`로 헤더를 붙일 수 있으나 JWT는 main에 없고, 기기 토큰은 연결 안 한 · 해지된 PC에 없음) → **팀장 결정(2026-10-07): ①** |
| **K23** | (U10) 무결성 | HTTPS + `latest.yml` sha512(기본) + 처음 설치 SHA-256 표시 / + 자체 서명 키 | **기획팀 추천: 앞의 것**(서명 키도 같은 서버 PC에 있게 되어 이득이 작음 — 서버 PC 침해는 수용 위험, 19장) → **팀장 결정(2026-10-07): 추천안(HTTPS + sha512 + 처음 설치 SHA-256 표시)** |
| **K24** | (U10) 캐시 · 보관 | `latest.yml` `no-cache`, 버전 파일 `public, max-age=31536000, immutable`(같은 버전 재빌드 금지), 최근 3개 버전 보관, 빌드 시간 제한 20분, Node 주 버전 22 이상 | **팀장 결정(2026-10-07): 그대로**(기획팀 추천) |
| **K15** | 연결 흐름 | ① 앱 창 한 번 + 코드 입력 둘 다 ② 코드 입력만 | **①** |
| **K16** | 프롬프트 저장 | ① 잡을 때 서버가 만들고 저장 안 함 ② 작업 만들 때 만들어 DB(또는 R2)에 저장 | **①**(DB 용량 · 본문 최소 보관). 단점: 작업 만든 뒤 노트가 바뀌면 바뀐 내용으로 실행됨 — 허용 |
| **K17** | 수치 가정 일괄 | 기기 10대 · 진행 중 작업 30개 · 코드 10분 · 프롬프트 4MB · 결과 2MB · 부분 글 64KB · 하트비트 묶음 · 쉬는 폴링 60초/활동 5초 · 업데이트 확인 6시간 · 로그 5MB×3 | **그대로**(운영하며 조정) |
| **K21** | (1A 연결 — 13.2.1절 5번) 이름 붙은 허용 호스트 밖의 http(s) 링크(출판사 논문 주소 · 검색 결과 제목 · [PDF] 링크) | ① 스킴만 맞으면(http(s)) 호스트와 상관없이 시스템 브라우저로 엶 ② 이름 붙은 호스트만 열고 나머지는 거부(그 링크는 앱에서 눌러도 아무 일도 없음) | **팀장 결정(2026-10-07): ①**(기획팀 추천과 같음) — AC-73 "화면 안의 외부 링크는 시스템 브라우저로"를 지키기 위함. 사용자가 누른 링크를 시스템 브라우저가 여는 것이라 브라우저에서 쓰는 지금과 비슷하지만, 앱에는 브라우저의 팝업 차단 같은 장치가 없으므로 13.2.1절 규칙으로 보완함 — 위험한 스킴(`file:` · 사용자 정의 프로토콜) 거부(2번), 서버 출처 최상위 프레임에서 온 요청만 처리(7번), 짧은 시간 안 개수 제한(8번, 기본 10초에 5개). **앱 창 안 이동 금지 · 앱 안 새 창 금지는 그대로** |

**디자인 결정 PD-1~PD-9** ([시안](../design/phase2-worker-electron-ui.md) 17장) — **팀장 결정(2026-10-08): 모두 디자인팀 추천안 확정**
| # | 항목 | 팀장 결정(= 디자인팀 추천) | 반영한 곳 |
|---|---|---|---|
| **PD-1** | 작업별 엔진 순서 고르기 | **고르기 상자 3개(1 · 2 · 3순위) + 경로 줄**. 칩 재정렬 · 추가 · 빼기는 쓰지 않음 | 16장 S2 |
| **PD-2** | API 키 확인 | **[확인] 버튼 없음**(새 API `…/check` 없음). 저장 상태(끝 4자리)와 실제 작업의 **최근 실패**만 | 16장 S3 · 7.3절 |
| **PD-3** | 웹의 PC 동시 실행 수 | **엔진별 `slots`만**. PC 전체 동시 수는 앱 "이 PC 상태"에서만(서버 · 표 변경 없음) | 16장 S4 |
| **PD-4** | 글쓰기 도우미 창을 닫을 때 CLI 작업 | **취소 — 대기 중 · 실행 중 모두**(팀장 확인 2026-10-08, 시안대로. `queued`는 바로 `cancelled`, `running`은 `cancel_requested` — 6.5절. "창을 닫으면 이 작업은 취소돼요" 표시). 탭이 닫혀 끊긴 작업만 결과가 작업 목록에 남음 | 9.3절 · 16장 S9 |
| **PD-5** | 앱 로컬 화면 CSS | **빌드 때 `app.css`를 `desktop/ui/`로 복사**해 그대로 쓰고 `local.css`에는 로컬 전용 몇 줄만 | 13.1절 · 21장 |
| **PD-6** | 트레이 아이콘 형식 | **`.ico` 한 파일에 16 · 20 · 24 · 32px** (`tray-{idle,running,paused,error}.ico`) | 13.5절 · 16장 E3 · 21장 |
| **PD-7** | E6 코드로 연결 | **"이 PC 상태" 창 안의 "연결" 구역**(`pair.html` 없음). 트레이 [코드로 연결…]은 그 창을 열고 코드 칸에 초점 | 12.2 · 13.1 · 13.6절 · 16장 E6 |
| **PD-8** | 업데이트 알림을 앱 창에도 | **띄우지 않음** — 트레이 · 트레이 알림 · 이 PC 상태만(`paperlabDesktop`에 함수 추가 없음 — 13.3절 그대로) | 13.7절 · 16장 E7 |
| **PD-9** | 설정 창 구역 이름 | **"AI 엔진" · "연결된 PC"**. "이 PC 연결"은 버튼 이름 | 16장 S1 · S4 |

### 20.3 확인 필요 (개발팀 첫 주 — 확인 후 이 문서 개정)

| 항목 | 상태 |
|---|---|
| 이 PC에서 `unrecognized_model` 재현 · 원인(CLI 2.1.269 · 계정 플랜) | 미확인 |
| Supabase Redirect URLs의 사용자 정의 스킴(`paperlab://`) 허용 | 미확인(모바일 딥 링크 문서로 가능성 높음) |
| ~~electron-updater GitHub provider의 태그 형식~~ | **해당 없음**(U10 변경 — generic provider) |
| (U10) 서명 없는 앱에서 NSIS 업데이트의 Authenticode 검증(`verifyUpdateCodeSignature` 기본 켬, `publisherName` 없음)이 건너뛰어지는지 · 막히는지 | 미확인 — 공식 문서에 서명 없는 경우가 적혀 있지 않음 → AC-71. 막히면 개발팀이 대안(`publisherName` 비우기 · 설정)을 팀장에게 보고 |
| (U10) Starlette `FileResponse`의 Range · 다중 범위 응답(설치본 1.7.0), 안 될 때 electron-updater가 전체 받기로 넘어가는지 | 2a: 자동 시험 작성됨(`test_range_requests` — 품질팀 실행 확인 대기, AC-87). **electron-updater 차등 받기 실측 · 전체 받기 전환 · `.exe` 요청 횟수는 2b 미확인**(Range는 시간당 횟수에서 빠졌으므로 한도와의 충돌은 없어짐 — 2b는 접근 로그에서 Range 남용 여부만 봄) → AC-71 |
| (U10) 서버 PC에서 electron-builder NSIS 빌드에 추가 도구(C++ 빌드 도구 등)가 필요 없는지, 첫 빌드 다운로드 크기 · 시간 | 미확인 → AC-89 |
| 서명 없는 NSIS 업데이트 설치 때 SmartScreen · UAC 동작, 백신 오탐 | 미확인 → AC-71 |
| gemini CLI: stdin + `-p` 결합 방식, 인증 실패 표시, 비대화형 도구 실행 정책, 모델 플래그 | 일부 확인(출력 형식 · 종료 코드). 2b 구현: 고정 `-p` 지시 + stdin 본문, 로그인은 `.gemini` 인증 파일 유무로 판정(11.4절) — **실제 gemini로 실측은 미확인**(AC-81 확장) |
| (2b) ASAR 무결성 fuse를 켜도 서명 없는 설치본이 시작 · 업데이트되는지 | **미확인** — 지금은 끔(13.2절 Fuses). 켜려면 AC-70 · 71 실환경에서 먼저 시험 |
| (2b) 개발 PC가 OneDrive 폴더 안일 때 electron-builder `EPERM` | 개발팀 보고(14장) — 서버 PC 경로에는 해당 없음, 서버 PC 빌드는 AC-89에서 확인 |
| (2b) 워커 로그에 `model_fallback` 기록 | **구현됨** — `stats`에 담기고(11.6절) `worker.log`에 한 줄 남김 |
| codex `exec`의 `-a`(승인) 플래그를 exec에서 쓰는지, `-` stdin 동작 | 문서상 `-`로 stdin 확인, 실측 필요 |
| claude 첫 호출 웜업 문제가 지금 버전에도 있는지 | 미확인 |
| ~~Cloud Run 무료 범위 · Cloud Tasks OIDC~~ | **해당 없음**(서버 PC 전환) |
| Supabase 일시정지 판정과 워커 폴링의 관계(정책) | 미확인 |
| 개발 PC의 Node.js 버전(`npm test` · 시험 빌드용) | 미확인(서버 PC는 v24.14 — 실측, 서버 PC 빌드는 AC-89) |
| OpenAI · Google API: 엔드포인트, 구조화 출력(JSON 스키마) 방법, 스트리밍 방식, 오류 응답 모양(401 · 403 · 429 · 안전 차단 · 길이 끊김), Google 키를 헤더(`x-goog-api-key`)로 보낼 수 있는지, 현재 모델 목록(K19) | 일부 확인 — 모델 목록(K19)은 **확정**(2026-10-08). 구현이 쓰는 엔드포인트 · 구조화 출력 방식(OpenAI `text.format` 스키마, Google `responseMimeType`만 + 스키마는 프롬프트) · 헤더(`x-goog-api-key`)는 9.5절에 기록. 실제 회사 서버로의 호출 확인과 오류 응답 모양(401 · 403 · 429 · 안전 차단 · 길이 끊김)은 가짜 서버 시험(AC-46 · 47) 밖에서는 **미확인** |
| Funnel을 거친 워커 요청: `X-Forwarded-For`로 IP 구분이 되는지(8.2절 속도 제한), 장시간 연결 | 미확인(1단계 AC-75 · 78) |
| 엔진별 최소 버전 표(사용자 PC CLI — 11.4절 플래그 동작). ~~서버 PC claude 업데이트~~는 Q-S3로 해당 없음 | 미확인 |
| (1A 연결) `window.open(url, "_blank", "noopener,noreferrer")` · `<a target="_blank" rel="noopener noreferrer">`도 `setWindowOpenHandler`로 들어와 `url`을 받는지(13.2.1절) | 미확인 — 공식 문서(window-open)에 noopener 경우가 따로 적혀 있지 않음. 개발팀이 AC-86으로 실측 |
| (1A 연결) 새 창 처리기 · `will-navigate` · `will-redirect`에서 **요청한 프레임**(최상위 여부 · 출처)을 알아내는 방법(13.2.1절 7번) | **해결(2b, 2026-10-08)** — `setWindowOpenHandler`에는 프레임 정보가 없어 하위 프레임이 있으면 거부 + 다른 출처 iframe은 `will-frame-navigate`로 막고, `will-navigate` · `will-redirect`는 `initiator`로 판정(13.2.1절 7번). 실제 프레임 구성에서의 동작은 AC-86 (b) 수동 확인 |

## 21. 작업 분담 (파일 단위)

같은 파일을 두 팀이 동시에 고치지 않습니다. 순서: (질문 답 · 팀장 결정) → 디자인 시안(`docs/design/phase2-worker-electron-ui.md`) · 개발 서버 작업 동시 → 개발 화면 · 앱 작업 → 품질 검증 → 승인 → 관리자 커밋 · 푸시 · 서버 배포 → 앱 릴리스(14장).

### 21.0 2a · 2b 나눔 (개정 2026-10-08 — 사용자 결정)

**순서: 2a 전부 → 품질 검증 · 승인 → 관리자 커밋 · 서버 반영 → 2b 시작.** 아래 "개발팀 · 디자인팀 · 기획팀 · 관리자 · 품질팀" 표의 파일별 설명은 그대로이고, 이 절이 **어느 단계에서 하는지**를 정합니다(수용 기준 쪽 표시는 17장의 `[2a]` · `[2b]`). 같은 파일이 두 단계에 걸치면 어느 부분이 어느 단계인지 적었습니다.

**2a만 반영된 동안의 동작(사용자 결정 2026-10-08 · 기획팀 정리)**
- 브라우저에서 **OpenAI · Google · Anthropic 키를 넣어 API로 바로** 쓸 수 있습니다(서버 프로세스 안 실행기 — 탭을 닫아도 계속).
- **CLI 작업은 워커가 없으면 대기**합니다. 대기 기한(6.6절 — 요약 24시간 · 대화 · 글쓰기 30분)이 지나면 `failed` · `no_worker_timeout`. 화면 문구는 디자인 문서(S8 상태 문구)를 따릅니다.
- 2a에는 실제 PC 앱이 없으므로 **기기는 Python 가짜 워커(테스트)로만 만들어집니다**. 연결 코드 만들기 · 연결된 PC 목록 · 해지 화면과 API는 동작하지만, 사용자가 실제로 연결할 수 있는 앱은 2b에서 생깁니다. [PC 앱 받기]는 설치 파일이 없으면 디자인 문구대로 "PC 앱을 준비 중이에요 — 관리자에게 알려 주세요"(404)를 보입니다.
- 키가 없고 켜진 · 연결된 PC도 없는 사용자는 9.2절대로 AI 작업을 **만들 때 400**(문구는 9.2절 · S10)을 받습니다. **팀장 결정 Q2a-1(2026-10-08)**: 문구는 설치 파일 유무(`GET /api/desktop/release`)로 나눕니다 — 파일이 없는 2a 동안은 "설정 → AI 엔진에서 API 키를 등록해 주세요. (PC 앱 연결은 곧 지원돼요)", 파일이 생기면(2b) 9.2절 원래 문구. API 실패 뒤 CLI 폴백은 **연결된 기기가 하나도 없으면 큐에 넣지 않고** API 오류와 위 안내를 보여 주고, 기기가 있는데 꺼져 있으면 대기 기한까지 `queued`로 둡니다(9.2절). 수용 기준은 AC-28에 반영.

#### 2a — 서버 · 웹 (작업 목록)

| 구분 | 파일 | 2a에서 하는 일 |
|---|---|---|
| 개발 | `supabase/migrations/2026100900000x_devices_jobs.sql` | 5장 표 3개 전부(`devices` · `device_pair_codes` · `jobs` — 2b가 마이그레이션을 다시 건드리지 않게 `devices.features`와 **`jobs.result_key text null`(4단계 대비 예약 열 — 2a · 2b 코드 모두 쓰지 않음)** 까지). 2a 품질 수정으로 **`jobs.interactive boolean not null default false`**(SSE 대화 · 글쓰기 표시, 5.3 · 6.3절)도 이 파일에 있음 — 두 열은 `create table` 뒤 별도 `alter table … add column if not exists` 문장이라, 열이 없던 테스트 DB에도 그 두 문장만 다시 실행하면 안전 |
| 개발 | `paperlab/db.py` · `jobs.py` · `worker_api.py` · `api_runner.py` · `api_engines.py` · `serve.py` · `ai.py` · `config.py` | 5 · 6 · 8 · 9 · 15장 전부: 작업 큐 · 기기 연결 · 워커 API(`/api/worker/*`) · API 우선 → CLI 폴백 라우팅 · API 키 3종(Anthropic · OpenAI · Google) · 서버 프로세스 안 API 실행기 · `ai.py`의 `_run_cli` 삭제와 CLI 요청 만들기 · 결과 해석 함수 · 모델 별칭 매핑 값 |
| 개발 | `paperlab/server.py`(또는 `paperlab/downloads.py`) | 7장 사용자 API, 요약 → 작업, 대화 · 글쓰기 폴백 이벤트, 미들웨어 `/api/worker/*` 분기, **`/downloads/` 내려주기 · `GET /api/desktop/release`**(13.7.1절 서버 쪽 — 임시 `releases` 폴더로 AC-87) |
| 개발 | `paperlab/static/js/api.js` · `app.js` · `state.js` · `reader.js` · `writing.js` · `dialogs.js` · `index.html` · `jobs.js`(신규) | S1~S10(16장): "AI 엔진" 구역 · 작업별 엔진 · API 키 3종 · 연결된 PC(코드 만들기 · 목록 · 이름 · 해지) · **PC 앱 받기 창** · 작업 목록 · 요약 진행 · 대화 · 글쓰기의 PC 실행 문구 |
| 개발 | `tests/test_jobs.py` · `test_worker_api.py` · `test_routing.py` · `test_devices.py` · `test_api_runner.py` · `test_api_engines.py` · `test_downloads.py`(신규), `tests/test_ai.py` · `test_server.py` · `conftest.py` | 17장 `[2a]` 기준(Python 가짜 워커 · 가짜 AI · 임시 releases 폴더) |
| 디자인 | `docs/design/phase2-worker-electron-ui.md`(작성됨) · `paperlab/static/css/app.css` | S1~S10 스타일(연결 코드 · 기기 목록 · 작업 목록 · PC 앱 받기 창 포함) |
| 기획 | `README.md` · `FEATURES.md` | 2a 반영 뒤: 엔진 설정 · API 키 3종 · 작업 목록 · "PC 앱은 2b에서" 안내 |
| 관리자 | 커밋 · 푸시 · 서버 반영 | 기존 `update.ps1`(빌드 단계 없음)로 서버만 반영 |
| 품질 | 17장 `[2a]` 54개 + 신규 AC-97 · 98 · 99(2a 품질 수정) + `[2a+2b]`의 2a 부분 | 결과 보고에 AC-95 대체 표 |

#### 2b — Electron 앱 · PC 워커 · 서버 PC 빌드 · 실측 (작업 목록)

| 구분 | 파일 | 2b에서 하는 일 |
|---|---|---|
| 개발 | `desktop/` 전체(신규 — `build/icon.ico` 제외) · `desktop/electron-builder.config.js`(서버 주소는 `server.json`에서 — `app-config.json` 없음) | 13 · 11장: 앱 창 · 워커(CLI 실행기) · 트레이 · 자동 시작 · 보안 설정 · 구글 로그인(시스템 브라우저) · 서버 연결 불가 화면(E9) · NSIS · 자동 업데이트 설정 · 서버 주소 내장(U6) · `test/` [Node] |
| 개발 | `desktop/main/window.js` · `desktop/test/external-links.test.js` | 13.2.1절 외부 링크 규칙, AC-86 (a) · (a2) |
| 개발 | `deploy/server-pc/update.ps1` · `common.ps1` (`install.ps1`은 **바뀌지 않음**) | 13.7.1절 빌드 단계(`update.ps1`이 `npm ci` · `npm run dist`를 부름) · Node 검사 · `releases` · `cache` 폴더(빌드 함수가 만듦) — 빌드 함수는 `common.ps1`. **완료**: `update.ps1`이 쓰는 폴더는 서버와 같은 규칙(프로세스 환경 → `cloud.env` → `D:\PaperLab\releases`)으로 정함(13.7.1절 "설치 파일 폴더") |
| 개발 | `tests/test_server_pc_scripts.py` | AC-88(가짜 `npm` — `update.ps1`은 `npm ci` · `npm run dist`만 부름) |
| 개발 | `paperlab/static/js/auth.js` · `app.js` | 앱 창이면 13.4절 ① 로그인 흐름, `window.paperlabDesktop` 감지, S5의 앱 창 [이 PC 연결] 버튼, S11 앱 창 표시 — 2a 화면에 **더하는** 부분만 |
| 디자인 | `desktop/ui/*.css` · `desktop/build/icon.ico` · 트레이 아이콘 4종 · 스크린샷(AC-70 뒤) | E1~E9 |
| 기획 | `desktop/README.md`(E8) · `deploy/server-pc/README.md` | 설치 안내 · Node.js LTS · 빌드 WARN 대처(개발팀 update.ps1 작업이 끝난 뒤) |
| 관리자 | `.gitignore`에 `desktop/node_modules/` 추가, 커밋 · 푸시 · `update.ps1`로 서버 반영 + 설치 파일 빌드 · 배포, `update.log` 확인 | 14장 |
| 품질 | 17장 `[2b]` 31개 + `[2a+2b]`의 2b 부분 + **2a 기준 전체 회귀**(실제 워커로 AC-95 · 96) | 실제 PC 두 대(또는 다른 Windows 계정) 준비 |

### 개발팀 (전체 상세 — 단계는 21.0절)

| 파일 | 할 일 |
|---|---|
| `supabase/migrations/2026100900000x_devices_jobs.sql` (신규) | 5장 표 · 색인 · RLS · 정책 |
| `paperlab/db.py` | `actor_claims`(5.5절), 작업 · 기기 · 연결 코드 질의(잡기 6.2절, 리스 · 정리 6.3 · 6.8절) |
| `paperlab/jobs.py` (신규) | 상태 기계 · 경로 만들기(9.2절) · 실패 판정(9.6 · 11.8절) · 결과 반영 등록표(6.4절) |
| `paperlab/worker_api.py` (신규) | `/api/worker/*` 라우터 · 기기 토큰 인증(8장) · 속도 제한 |
| ~~`paperlab/tasks.py`~~ | **만들지 않음**(K2' — Cloud Tasks 폐기) |
| `paperlab/api_runner.py` (신규, K2') | 서버 프로세스 안 API 실행기: 실행 스레드 4 · 메모리 대기열 · 리스 연장 · 취소 확인 · 복구 스캔(`system_tx("api job recovery")`) · 사용자당 동시 2(15.2절) |
| `paperlab/api_engines.py` (신규, U2 — 이름은 개발팀 재량) | OpenAI · Google API 실행기(`httpx`, 텍스트 전용, 요약 JSON · 대화 `[p.N]` · 스트리밍), 오류 → `error_code` 매핑(9.6절) |
| `paperlab/serve.py` (1단계 서버 PC 진입점) | 시작 때 `ApiRunner` 시작 · 종료 정리 |
| `paperlab/ai.py` | `_run_cli` 삭제 → CLI 요청 만들기 · 결과 해석 함수(OpenAI · Google 실행기도 같은 프롬프트 · 해석 함수 재사용), 모델 별칭(11.6절), 요약 진행을 작업 진행으로 |
| `paperlab/config.py` | `ai_routing` · `cli_models` · `api_models` · 새 비밀 키 `openai_api_key` · `google_api_key`(U2) · `ai_engine` 무시. `redact`에 `sk-` · `AIza` 키 패턴. **새 환경 변수 없음**(K14' — 설치 파일 폴더 변수 `PAPERLAB_RELEASES_DIR`은 `downloads.py` · `serve.py`가 읽음, 아래 `downloads.py` 줄) |
| `paperlab/server.py` | 7장 사용자 API, 요약 → 작업(`ApiRunner`에 넣기), 대화 · 글쓰기 폴백 이벤트, 미들웨어에 `/api/worker/*` 분기(`/internal/*` 없음) |
| ~~`deploy/deploy.ps1`~~ | **지워짐**(1단계 20.1절) — 2단계 서버 쪽 추가 설정 없음 |
| ~~`desktop/app-config.json`~~ | **만들지 않음** — 서버 주소(U6)는 1단계 S10의 한 곳 `deploy/server-pc/server.json`의 `public_url`을 빌드가 읽어 `extraMetadata.paperlabServer`로 앱에 넣음(13.5절) |
| `tests/test_jobs.py` · `tests/test_worker_api.py` · `tests/test_routing.py` · `tests/test_devices.py` · `tests/test_api_runner.py`(K2' — AC-40~44) · `tests/test_api_engines.py`(U2 — 가짜 OpenAI · Google 서버, AC-45~48) (신규), `tests/test_ai.py` · `tests/test_server.py` · `tests/conftest.py` | 17장 A~E · I, 가짜 워커(httpx), 동시 잡기 시험 |
| `paperlab/static/js/api.js` · `app.js` · `state.js` · `reader.js` · `writing.js` · `dialogs.js` · `index.html` | S1~S11 로직(디자인팀 클래스 이름 사용), 작업 폴링, `window.paperlabDesktop` 감지 · 로그인 분기(auth.js) |
| `paperlab/static/js/auth.js` | 앱 창이면 13.4절 ① 흐름 |
| `paperlab/static/js/jobs.js` (신규) | 작업 목록 · 폴링 · 배지 |
| `desktop/` 전체 (신규 — `build/icon.ico` 제외) | 13장 앱 · 11장 워커 · `package.json`(electron-builder · NSIS · publish · protocols · fuses) · 서버 주소 내장(U6) · 서버 연결 불가 화면(E9) · `test/` [Node] AC |
| `desktop/electron-builder.config.js` (신규, U10) | NSIS · `artifactName: PaperLab-Setup-${version}.${ext}` · `publish: generic`(url = `server.json` `public_url` + `/downloads/`) · protocols · fuses. `package-lock.json` 커밋 |
| `paperlab/server.py`(또는 새 모듈 `paperlab/downloads.py`) (U10) | `GET` · `HEAD /downloads/{name}`(허용 이름 · 폴더 재확인 · 목록 없음 · Cache-Control · Range · 동시 3 · IP별 시간당 10), 보안 미들웨어 공개 예외에 `/downloads/` 추가, `GET /api/desktop/release`(13.7.1절). `releases` 폴더 경로는 **환경 변수 `PAPERLAB_RELEASES_DIR`(`cloud.env` · 프로세스 환경 변수), 기본값 `D:\PaperLab\releases`**(팀장 승인 2026-10-08 — K14' 개정으로 새 환경 변수 1개. 테스트는 `create_app(releases=…)`로 주입). `latest.yml` 304(ETag) 직접 처리 · `.exe` **Range 요청은 시간당 횟수에 넣지 않고 동시 전송 제한만**, 전체 GET은 IP별 시간당 10회(127.0.0.1 · XFF 없음이면 전체 60회)(13.7.1절) |
| `deploy/server-pc/update.ps1` · `common.ps1` (U10; `install.ps1`은 바뀌지 않음) | 13.7.1절 빌드 단계(조건 · 순서 · `.staging` · `latest.yml` 마지막 · `release.json` · 보관 3개 · WARN · 종료 코드 · `-BuildDesktop`), Node 검사, `releases` · `cache` 폴더 만들기(권한 상속) — 빌드 함수는 `common.ps1`, `update.ps1`이 부름 |
| `tests/test_downloads.py` (신규) · `tests/test_server_pc_scripts.py` (U10) | AC-87 · AC-88(가짜 `npm`) |
| `desktop/main/window.js`(또는 판정 함수를 뺀 모듈) · `desktop/test/external-links.test.js` | 13.2.1절 외부 링크 규칙(`isExternalAllowed` · 요청한 곳 검사 · 개수 제한 · 새 창 처리기 · 탐색 제한), AC-86 (a) · (a2). 화면 코드(`paperlab/static/js/*`)는 1A 링크 때문에 바꾸지 않음 |

### 디자인팀

| 파일 | 할 일 |
|---|---|
| `docs/design/phase2-worker-electron-ui.md` (작성됨 2026-10-08) | 16장 S1~S11 · E1~E9 시안 · 문구 · **CSS 클래스 이름 목록**(S3은 키 세 칸 · API 모델 입력) — 개발팀 화면 작업 전에 먼저 |
| `paperlab/static/css/app.css` | S 화면 스타일(엔진 고르기 상자 · 경로 줄 · 기기 목록 · 작업 목록 · 상태 문구 · 연결 코드) — 시안 부록 A를 맨 끝에(개발 단계) |
| `desktop/ui/*.css` | E 화면 스타일 — **빌드 때 `app.css`를 복사해 쓰고**, 로컬 전용 몇 줄만 따로(PD-5) |
| `desktop/build/icon.ico` · 트레이 아이콘 4종(`desktop/build/tray-{idle,running,paused,error}.ico` — 16 · 20 · 24 · 32px 한 파일, PD-6) | E1 · E3 |

### 기획팀 (구현 후)
- `desktop/README.md` 설치 안내 문구(E8 — [PC 앱 받기] · SHA-256 확인 · SmartScreen · CLI 설치 · 연결 · 해지 · 제거), `README.md` · `FEATURES.md`(PC 앱 · 작업 목록 · 엔진 설정).
- (U10) `deploy/server-pc/README.md`: Node.js LTS 확인 · 설치, `update.ps1` 빌드 단계 · `releases` 폴더 · 빌드 WARN 대처, "서버 PC에는 워커 앱을 설치하지 않음"(Q-S3) — **개발팀의 update.ps1 관련 절 작업이 끝난 뒤**(같은 파일 동시 수정 금지).
- 20장 답이 오면 이 명세 · PLAN 개정(P2 · P8 · P12 해결 표시). (K22~K24 팀장 결정은 2026-10-07 반영함)

### 관리자
- 승인된 결과 커밋 · 푸시 → 서버 PC `update.ps1` 한 번으로 서버 반영 + (앱 버전이 바뀌었으면) 설치 파일 빌드 · 배포(14장). `update.log`에서 빌드 결과 확인.
- 커밋 전에 `desktop/dist/` · `desktop/node_modules/`가 들어가지 않게 `.gitignore`에 추가(지금 `dist/`는 있음, `node_modules/` 없음 — 추가).
- 커밋 · 릴리스 파일에 토큰 · 배포 주소가 없는지 확인(AC-69 패턴 검색을 `desktop/`에도).

### 품질팀
- 17장 실행. [실환경] 항목은 두 번째 PC(또는 다른 Windows 계정) 준비 후. 결과 보고에 AC-95 대체 표 · 요청 수 측정(10.2절 추정과 비교)을 포함.

## 22. 확인한 외부 문서 (2026-10-07)

| 사실 | 출처 | 상태 |
|---|---|---|
| claude `-p` 플래그: `--output-format text/json/stream-json`, `--model`(별칭 또는 전체 이름), `--system-prompt(-file)`, `--tools ""`(모두 끔), `--no-session-persistence`, `--json-schema`, `--setting-sources`, `--strict-mcp-config`, `--fallback-model`, `--permission-prompts none`(2.1.259+), `claude auth status`(로그인 0 · 아니면 1, JSON) | code.claude.com/docs/en/cli-reference | 확인 |
| claude 비대화형: 종료 코드 0/비0, 실행 중 실패(로그인 없음 등)는 stdout result로, **stdin 10MB 상한**, `--bare`는 OAuth · 키체인을 읽지 않고 `ANTHROPIC_API_KEY`만 씀, JSON에 `total_cost_usd`, 재시도 이벤트의 오류 분류(`authentication_failed` · `rate_limit` · `model_not_found` 등) | code.claude.com/docs/en/headless | 확인 |
| claude 모델 별칭(`default` · `opus` · `sonnet` · `haiku` · `fable` 등), 전체 이름 허용, 모르는 모델은 경고 후 기본 모델로 대체 · "There's an issue with the selected model" | code.claude.com/docs/en/model-config | 확인 |
| codex `exec`: 프롬프트 `-`면 stdin, `-o/--output-last-message`, `-m`, `-s read-only`, `--json`, `--ephemeral`, `--skip-git-repo-check`, `--output-schema`, `codex login status`(자격 증명 있으면 0) | learn.chatgpt.com/docs/developer-commands?surface=cli | 확인 |
| gemini 헤드리스: `-p`/비TTY, `--output-format json`(`response` · `stats` · `error`) · `stream-json`, 종료 코드 0 · 1 · 42 · 53 | geminicli.com/docs/cli/headless/ | 확인(인증 · 도구 정책은 확인 필요) |
| Node: `.bat`/`.cmd`를 `shell` 없이 spawn하면 `EINVAL`(CVE-2024-27980) | nodejs.org/en/blog/vulnerability/april-2024-security-releases-2 | 확인 |
| Supabase Realtime 무료: 동시 연결 200 · 월 메시지 200만 · 초당 100 · 브로드캐스트 256KB | supabase.com/docs/guides/realtime/limits, supabase.com/pricing | 확인 |
| Realtime: DB `realtime.send(payload, event, topic, private)`, REST `POST /realtime/v1/api/broadcast/...`, 공개 채널은 anon 키로 구독 가능, private는 `realtime.messages` RLS + JWT, "Allow public access" 설정 | supabase.com/docs/guides/realtime/broadcast, …/realtime/settings | 확인(권한 · 파티션 제약은 확인 필요) |
| Cloud Run 요청 기반 무료: 월 18만 vCPU초 · 36만 GiB초 · 요청 200만, 요청 처리 중에만 과금 | cloud.google.com/run/pricing(검색 결과 요약 — 페이지 직접 읽기 실패) | **해당 없음**(서버 PC 전환 — 기록으로만) |
| Cloud Tasks: HTTP 대상 처리 기한 최대 30분, OIDC 토큰으로 Cloud Run 호출, 무료 월 100만 작업 | cloud.google.com/tasks/docs, …/tasks/pricing(검색 결과 요약) | **해당 없음**(K2' — 기록으로만) |
| Tailscale Funnel 사실(포트 · 127.0.0.1 대상 · 대역폭 제한 · `--bg` 유지) | [1단계 명세](phase1-cloud.md) 21장 | 확인 |
| 서버 PC 실측(claude 2.1.210 · codex 0.157.0 · gemini 없음 · Node v24.14) | 서버 PC의 Claude Code 읽기 전용 점검(2026-10-07, 팀장 전달) | 확인 |
| electron-builder: Windows 자동 업데이트는 NSIS만(Squirrel.Windows 미지원), GitHub provider 공개 저장소, `latest.yml`, `dev-app-update.yml` · `forceDevUpdateConfig`, `stagingPercentage` | electron.build/docs/features/auto-update | 확인 |
| (U10) electron-updater: generic provider(`url` · 파일은 직접 올림), **`requestHeaders` 속성 · `addAuthHeader()`로 요청 헤더를 붙일 수 있음**, 받은 파일을 `latest*.yml`의 `files[]` sha512로 검증, `setFeedURL`을 부르지 말 것(빌드가 `app-update.yml` 생성) | [electron.build/docs/features/auto-update](https://www.electron.build/docs/features/auto-update) (2026-10-07) | 확인 |
| (U10) NSIS 업데이트는 적용 전 Authenticode 검증, `win.verifyUpdateCodeSignature` 기본 켬 · `publisherName`을 `app-update.yml`에 넣음 — **서명 없는 앱의 동작은 문서에 없음** | [electron.build/docs/features/security](https://www.electron.build/docs/features/security) (2026-10-07) | 일부 확인(서명 없는 경우는 AC-71) |
| Electron 보안 체크리스트 20항목, `contextIsolation`(12+) · `nodeIntegration` 끔(5+) · `sandbox`(20+) 기본 | electronjs.org/docs/latest/tutorial/security | 확인 |
| `safeStorage`: Windows DPAPI, 같은 로그온 사용자만 복호화 · 같은 세션 다른 앱은 못 막음, `ready` 뒤 사용 | electronjs.org/docs/latest/api/safe-storage | 확인 |
| Google: 내장 웹뷰 OAuth 차단 · 시스템 브라우저 권장(RFC 8252), 사용자 에이전트 위장 금지 | developers.googleblog.com/2021/06/upcoming-security-changes-to-googles-oauth-2.0-authorization-endpoint.html | 확인 |
| 1st My paper CLI 실측(`.CMD` 경로 · 여러 줄 인자 잘림 · codex stdin 멈춤 · cwd git 오염 · 웜업 · 환경 변수 정리 · `taskkill /T /F` · 엔진별 동시 실행 수) | `논문 작성 프로그램\프로그램\work\backend\ai\cli.py` · `stream.py` · `pool.py` · `router.py` · `config\ai_profiles.json`(저장소 밖, 참고만) | 코드 주석의 실측 기록 확인 |
