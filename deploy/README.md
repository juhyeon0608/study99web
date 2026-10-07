# PaperLab 1단계 운영 안내 (초안 — 문구는 기획팀 검토)

서버는 **서버 PC(상시 켜 둔 Windows PC) + Tailscale Funnel**에서 Python으로 직접 돕니다(사용자 결정 2026-10-07).
서버 PC 설치 · 업데이트 · 감시는 **[서버 PC 설치 안내서](server-pc/README.md)** 를 따르세요. 이 문서는 사용자 준비 ·
테스트 프로젝트 · 관리 명령 · 복원 절차만 다룹니다.

명세: `docs/specs/phase1-cloud.md` 9 · 13장. 모든 비밀값은 `%USERPROFILE%\.paperlab\cloud.env`에만 두고, 이 문서 ·
저장소 · 로그에 쓰지 않습니다. 공개 서버 주소는 비밀이 아니며 저장소에서는 `deploy/server-pc/server.json` 한 곳에 둡니다
(팀장 결정 S10 — `make-shortcut.ps1` · 서버 PC 스크립트가 읽음. R2 CORS 붙여 넣기용 `r2-cors.json`에도 같은 값).

## 1. 사용자가 먼저 할 일

| 할 일 | 비고 |
|---|---|
| 운영 Supabase 프로젝트(서울) | `SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_DB_URL`(대시보드 Connect → **Session pooler**, 사용자 이름은 `postgres.<프로젝트 ref>` 형식 — 관리 명령 · 마이그레이션 전용) · 레거시 키일 때만 `SUPABASE_JWT_SECRET` |
| 테스트용 Supabase 프로젝트(뭄바이 ap-south-1 — 사용자 결정으로 그대로 둠) | `SUPABASE_TEST_URL` · `SUPABASE_TEST_ANON_KEY` · `SUPABASE_TEST_SERVICE_ROLE_KEY` · `SUPABASE_TEST_DB_URL`(Session pooler). **이메일+비밀번호 로그인 켜기, 이메일 확인 끄기** |
| Google OAuth 클라이언트(웹) | 승인된 리디렉션 URI = Supabase 콜백 주소. 클라이언트 ID · 비밀은 Supabase 대시보드에만. **동의 화면은 "테스트" 상태로 두고 쓸 사람만 테스트 사용자로 등록**(사용자 결정 Q16 — 가입 관문, 최대 100명). **"앱 게시"(프로덕션 전환)는 하지 않음** — 하면 구글 계정이 있는 누구나 가입 가능 |
| 운영 프로젝트 Auth | **Google 공급자만 켜기** — 이메일 공급자 · 익명 로그인(Anonymous) · 다른 공급자는 **반드시 끔**(허용 목록이 꺼져 있어, 켜 두면 누구나 공개 anon 키로 가입할 수 있음 — 명세 6.1절 · AC-80). Site URL · Redirect URLs = 공개 서버 주소(`server-pc/server.json`의 `public_url`, Funnel을 켠 뒤). **"Before User Created" 훅은 연결하지 않음**(기본 — 사용자 결정 Q16). 마이그레이션이 함수 `paperlab.before_user_created`를 만들어 두지만 연결 전에는 아무 일도 하지 않음. 허용 목록을 켤 때만(아래 "기타") 대시보드 Authentication → Hooks → Before User Created → Postgres 함수로 연결 |
| R2 | 버킷 · 이 버킷 하나에 대한 객체 읽기/쓰기 API 토큰 → `R2_ACCOUNT_ID` · `R2_BUCKET` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY`. CORS는 `deploy/r2-cors.json`, 수명 주기 규칙 `delete-incoming`(접두어 `incoming/`, 1일), r2.dev 공개 주소 끔 |
| 기타 | `APP_ENCRYPTION_KEY`(아래 명령으로 생성), `PAPERLAB_PUBLIC_URL`(공개 서버 주소 — `server.json`과 같은 값), **`PAPERLAB_ALLOWLIST=off`**(운영 — 사용자 결정 Q16: 가입 관문은 Google OAuth 테스트 사용자 목록, `ALLOWED_EMAILS` 줄은 두지 않음). 이 줄이 없거나 `on`이면 서버 허용 목록이 켜지고 `ALLOWED_EMAILS`(쉼표 구분)가 필수 — 비어 있으면 서버는 뜨지만 모든 요청이 403(전부 허용으로 보지 않음). 허용 목록을 다시 켜려면: `PAPERLAB_ALLOWLIST=on` + `ALLOWED_EMAILS` → `admin sync-allowlist` → 위 훅 연결 → 서버 다시 시작 |

`SUPABASE_APP_DB_URL`(앱 역할 주소)은 사람이 쓰지 않습니다 — 서버 PC 설치 스크립트가 `admin app-role --write-env`로 채웁니다.
서버 PC `cloud.env`에는 `SUPABASE_SERVICE_ROLE_KEY`를 두지 않습니다(최소 권한 — `serve --check`가 남아 있으면 이름으로 알림).

암호화 키 만들기(출력값을 cloud.env에 붙여 넣고 화면은 지우기):

```
python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"
```

## 2. 테스트 프로젝트 준비 (한 번)

1. 표지 붙이기 — 운영과 같은 프로젝트면 거부하고, 프로젝트 ref를 직접 입력해 확인합니다.
   ```
   .venv\Scripts\python -m paperlab.admin mark-test-project
   ```
2. 테스트 실행 — 세션 시작 때 테스트 프로젝트에 마이그레이션을 적용하고(같은 파일 · 같은 도구), 앱 역할 주소를 만듭니다.
   앱 역할 비밀번호는 **매번 바꾸지 않습니다**: 테스트 프로젝트의 `public.paperlab_test_secrets`(RLS 켜고 정책 없음, anon ·
   authenticated · service_role 권한 회수 — 관리자 연결만 읽음)에 보관해 재사용하고, 처음이거나 그 값으로 로그인이 안 될 때만
   새로 만듭니다(advisory lock — 동시에 여러 pytest가 시작해도 서로 깨지지 않음).
   ```
   .venv\Scripts\python -m pytest -q
   ```
   - 빼고 돌릴 테스트는 없습니다. `tests/test_ai.py::test_cli_engine_with_fake_claude`는 Windows에서도 가짜 CLI만 쓰며, 실제 claude CLI가 불리지 않음을 단언합니다.
   - 표지가 없으면 테스트 전체가 즉시 중단됩니다(운영 보호 장치 2번). 테스트 URL · DB가 운영과 같아도 중단(1번).
   - DB에 접속하지 못하면(비밀번호 · 일시정지 · 네트워크) DB 테스트만 이유를 적고 건너뜁니다.
   - 백업 복원 테스트는 PostgreSQL 17 클라이언트(`pg_dump` · `pg_restore`)가 PATH에 있어야 돕니다.
   - 풀러가 `paperlab_app` 접속을 받지 않으면(AC-12a 실패) 임시로 `PAPERLAB_TEST_DB_AS_ADMIN=1`로 돌릴 수 있지만, 팀장에게 보고해야 합니다.
3. 실환경 R2 계약 테스트(선택): `set PAPERLAB_R2_CONTRACT=1` 후 `pytest tests/test_storage.py -k r2_contract` — 임의 uuid 사용자 경로에서 실행 후 지웁니다.

## 3. 관리 명령

서버 PC에서는 `D:\PaperLab\study99web\.venv\Scripts\python`으로 실행합니다(설치 · 업데이트 스크립트가 필요한 것은 알아서 부름).
공통 인자: `--env-file`(기본 `%USERPROFILE%\.paperlab\cloud.env`), `--log-file`(회전 로그).

| 명령 | 하는 일 |
|---|---|
| `python -m paperlab.migrate` | 관리자 연결로 아직 적용 안 된 `supabase/migrations/*.sql` 적용(테스트 표지 DB는 거부) |
| `python -m paperlab.admin sync-allowlist` | `ALLOWED_EMAILS` → `paperlab.allowed_emails`(Auth Hook을 **연결한 경우에만** 쓰임 — 운영 기본은 미연결). 변수가 비어 있으면 표를 바꾸지 않고 끝남(설치 · 업데이트 스크립트가 늘 불러도 안전) |
| `python -m paperlab.admin app-role --write-env` | 앱 역할 비밀번호 **명시적 회전** → `cloud.env`의 `SUPABASE_APP_DB_URL` 줄만 바꿔 씀(값은 출력하지 않음). 곧바로 서버 다시 시작(`update.ps1 -RestartOnly`). `--if-missing`은 값이 없을 때만(설치 스크립트) |
| `python -m paperlab.admin rotate-key` | `cloud.env`의 `APP_ENCRYPTION_KEY`를 새 값으로 바꾼 뒤(서버 멈춘 상태) 실행, 옛 키는 화면에 안 보이게 입력 → 서버 시작 |
| `python -m paperlab.admin orphans [--delete]` | DB에 없는 R2 PDF 찾기/지우기 |
| `python -m paperlab.admin backup --tmp-dir <폴더>` | 수동 백업(보통은 서버 PC 작업 `PaperLab Backup`이 매일 04:00). 앱 역할 주소 + `pg_dump`(`PAPERLAB_PG_DUMP` → PATH). 같은 날 다시 돌리면 그날 파일 `backups/db/<YYYYMMDD>.dump`를 덮어씀. 임시 파일은 끝나면 지움 |
| `python -m paperlab.admin pg-dump-check` | `pg_dump` 주 버전이 DB 서버 주 버전 이상인지(설치 스크립트가 백업 작업 등록 전에 부름) |
| `python -m paperlab.admin latest-backup` | R2의 가장 최근 백업 날짜(감시 작업이 하루 한 번 — 36시간 넘으면 종료 코드 2) |
| `python -m paperlab.serve --check` | 서버 설정 점검: 빠진 · 틀린 · 지울 변수 **이름**, 앱 역할 사용자 이름 앞부분, `cloud.env` 권한 |

## 4. 복원 절차 (초안)

1. R2 `backups/db/<YYYYMMDD>.dump`를 받습니다.
2. 빈 프로젝트에 `python -m paperlab.migrate`로 스키마를 만든 뒤, 데이터만 복원합니다.
   `pg_restore --data-only --schema=paperlab --no-owner --disable-triggers -d "<관리자 주소>" <파일>`
3. `auth.users`는 백업에 없습니다. 사용자가 같은 구글 계정으로 다시 로그인하면 `user_id`가 달라질 수 있으므로,
   옛 id → 새 id로 모든 개인 표의 `user_id`를 바꾸는 단계가 필요합니다(기획팀이 절차 문구 작성).
4. 1단계 검증 때 테스트 프로젝트의 별도 스키마로 한 번 복원해 봅니다(AC-70, `tests/test_backup.py`).
5. 받은 덤프 파일은 복원이 끝나면 지웁니다(모든 사용자 데이터가 들어 있음).

## 5. 확인할 것 (실환경)

- 운영 Supabase Auth에 Google 공급자만 켜져 있고(이메일 · 익명 꺼짐), Before User Created 훅이 연결돼 있지 않음(AC-05 · 80). Google OAuth 동의 화면이 "테스트" 상태(AC-82).
- (선택 기능 — 허용 목록을 켜고 Auth Hook을 연결한 경우에만) 훅이 구글 로그인 가입을 거부하면 Supabase Auth가 `redirectTo` 주소로 `error` ·
  `error_code` · `error_description`을 쿼리와 `#` 조각 둘 다에 붙여 돌려보냅니다(Auth 서버 코드 확인). `error_description`에는
  훅 메시지 "허용되지 않은 이메일이에요 (not_allowed)"가 들어갈 것으로 예상 — 화면은 `not_allowed`가 들어 있으면 D2 화면.
- Supabase 풀러가 `paperlab_app.<ref>` 접속을 받는지(AC-12a, M2).
- 서버 PC `pg_dump` 주 버전이 운영 Supabase Postgres 이상인지(`admin pg-dump-check`).
