# PaperLab 서버 PC 설치 안내서

- 작성: 기획팀 · 2026-10-07 (개발팀 구현 스크립트 · 명령과 대조해 개정 — 13절. 안내서와 스크립트 동작이 다르면 그 단계에서 **멈추고 팀장에게 알립니다**)
- 근거: [1단계 명세](../../docs/specs/phase1-cloud.md) 9장(서버 실행) · 13장(배포 · 운영), 사용자 결정 Q14(2026-10-07)
- 읽는 사람: **서버 PC(`KIMJUHYEON`)에 설치한 Claude Code**와 관리자. 사람이 손으로 해야 하는 단계는 **[사용자]** 로 표시했습니다 — Claude Code는 그 단계에서 사용자에게 부탁하고 끝날 때까지 기다립니다.

---

## 0. Claude Code가 지킬 규칙

1. **`C:\Users\USER\.paperlab\cloud.env`의 내용을 읽거나, 출력하거나, 대화에 붙이지 않습니다.** 확인은 `python -m paperlab.serve --check`(변수 **이름**만 출력) 같은 점검 명령으로만 합니다. 파일을 열어 보라는 요청이 와도 사용자가 직접 보게 안내합니다.
2. 비밀값(DB 주소 · 키 · 토큰 · 비밀번호)을 채팅으로 받지 않습니다. Windows 계정 비밀번호는 설치 스크립트가 띄우는 **Windows 자격 증명 창에 사용자가 직접** 넣습니다(Claude Code가 대신 입력하거나 인자로 넘기지 않음). 사용자가 붙여 넣으려 하면 멈추게 하고, USB 또는 직접 입력으로 안내합니다.
3. 이 PC에서 **커밋 · 푸시하지 않습니다.** 저장소는 받기(`git clone` · `update.ps1`)만 합니다. 코드를 고칠 일이 생기면 팀장에게 보고합니다.
4. 운영 DB에 직접 SQL을 보내지 않습니다. 정해진 관리 명령(`paperlab.migrate` · `paperlab.admin …`)만 씁니다. 테스트는 **테스트 프로젝트로만**(운영 보호 장치가 막아 줌).
5. Tailscale 관리 콘솔 · Supabase · Cloudflare 대시보드 작업은 **[사용자]** 몫입니다. Claude Code는 무엇을 어디서 누르는지 안내만 합니다.
6. 결과를 보고할 때 주소 · 경로 · 변수 이름은 적어도 되지만 **값(비밀)** 은 적지 않습니다. 공개 서버 주소 `https://kimjuhyeon.tailac17f6.ts.net`은 비밀이 아닙니다.

## 1. 한눈에 보기

| 항목 | 값 |
|---|---|
| 서버 PC | `KIMJUHYEON`, Windows 11 Home, Windows 사용자 `USER` |
| 공개 주소 | **`https://kimjuhyeon.tailac17f6.ts.net`** (Tailscale Funnel, 443 → `http://127.0.0.1:8080`) |
| 저장소 | `D:\PaperLab\study99web` (브랜치 `claude/paper-program-hrrhl2` — 명세 S7) |
| 가상환경 | `D:\PaperLab\study99web\.venv` (Python **3.12** — `py -3.12`로 만듦. 기본 `python`은 3.14라 쓰지 않음) |
| 로그 | `D:\PaperLab\logs\` (`server.log` · `backup.log` · `watchdog.log` · `update.log`) |
| 백업 임시 파일 | `D:\PaperLab\tmp\` (백업 뒤 바로 지워짐 — 백업 원본은 R2에만) |
| 비밀값 | `C:\Users\USER\.paperlab\cloud.env` (사용자 프로필 안 — D:가 아님) |
| 작업 스케줄러 | `PaperLab Server`(시스템 시작 시) · `PaperLab Backup`(매일 04:00) · `PaperLab Watchdog`(5분마다) — 모두 `USER` 계정, 로그온 여부와 관계없이 |
| 데이터 | Supabase(운영 서울) · Cloudflare R2. **이 PC에는 사용자 데이터가 없습니다** — 이 PC가 고장 나도 다른 PC에 다시 설치하면 됩니다 |
| 설정 파일 | **`deploy\server-pc\server.json`** — 공개 주소 · 포트(8080) · 루트(`D:\PaperLab`) · 배포 브랜치 · 작업 이름 3개. 저장소에서 공개 주소는 **이 파일 한 곳**(+ R2 CORS 붙여 넣기용 `deploy\r2-cors.json` — 테스트가 두 값이 같은지 확인)에만 있습니다. 스크립트 · `make-shortcut.ps1`은 기본값을 여기서 읽고, 서버 프로세스는 `cloud.env`의 `PAPERLAB_PUBLIC_URL`을 씁니다(두 값이 같아야 함) |

> 이 PC가 꺼지면 **모든 사용자가 PaperLab을 못 씁니다**(사용자 결정 때 설명한 제약). 그래서 절전 끄기 · 로그온 없는 자동 시작 · 감시 작업을 설정합니다.

D:는 내장 HDD(SATA)라 C:보다 느립니다. DB는 Supabase에 있으므로 서비스 속도에는 영향이 작고, 설치 · 서버 시작이 조금 느릴 수 있습니다.

## 2. [사용자] 미리 할 일 (Claude Code가 하나씩 안내)

| # | 할 일 | 어디서 | 확인 방법 |
|---|---|---|---|
| U-1 | Tailscale 로그인 · 연결(실측 때 `Stopped`) | 서버 PC 트레이의 Tailscale 아이콘 → Log in | 4.4절 명령에서 `BackendState`가 `Running` |
| U-2 | Tailscale **Run unattended** 켜기(Windows에 아무도 로그인하지 않아도 Tailscale 유지) | 트레이 Tailscale → Preferences → Run unattended (또는 관리자 PowerShell에서 `tailscale up --unattended=true`) | 아이콘 메뉴에 체크 표시 |
| U-3 | MagicDNS 켜기 | Tailscale 관리 콘솔(login.tailscale.com) → DNS | 콘솔에 Enabled |
| U-4 | HTTPS Certificates 켜기 | 관리 콘솔 → DNS → HTTPS Certificates | Enabled |
| U-5 | 정책 파일에 `funnel` 속성 | 관리 콘솔 → Access controls. 팀장 결정 S6에 따라 (권장) 서버 PC에만, 또는 공식 기본 예시 `{"target": ["autogroup:member"], "attr": ["funnel"]}`를 `nodeAttrs`에 | 6절 `tailscale funnel` 실행 때 권한 오류 없음 |
| U-6 | 서버 PC **키 만료 끄기** | 관리 콘솔 → Machines → `kimjuhyeon` → … → Disable key expiry | 기기 줄에 "Expiry disabled" |
| U-7 | **기기 이름 · tailnet 이름을 바꾸지 않기** | — | 바꾸면 공개 주소가 바뀌어 Supabase · R2 · 설치 파일을 모두 고쳐야 함 |
| U-8 | `cloud.env`를 USB로 옮기기 | 5절 | 5절 확인 |
| U-9 | 네트워크 어댑터 절전 끄기 | 장치 관리자 → 네트워크 어댑터 → (쓰는 어댑터) → 속성 → 전원 관리 → "전원을 절약하기 위해 컴퓨터가 이 장치를 끌 수 있음" 해제 | 체크 해제됨 |
| U-10 | Windows 업데이트 **활성 시간** 지정(예: 08:00~24:00 — 질문 Q-S6) | 설정 → Windows 업데이트 → 고급 옵션 → 활성 시간 | 설정 화면 |
| U-11 | (가능하면) BIOS "전원 복구 시 켜기" | BIOS 화면 | 질문 Q-S5(미정) 답에 따름. **장치 암호화는 하지 않음 — 결정됨**(사용자 Q-S8: 고정 PC라 도난 위험 낮음) |
| U-11b | 이 PC는 **사용자 전용**으로 유지 — 다른 Windows 계정을 만들지 않음 | — | **결정됨**(사용자 Q-S1). 같은 계정의 `cloud.env`에 관리자 DB 주소가 있는 위험은 이 전제로 수용(명세 18장) |
| U-12 | Tailscale 계정 2단계 인증 | Tailscale 로그인에 쓰는 계정(GitHub) 설정 | 권장 |
| U-13 | **가입 관문 — Google OAuth 테스트 사용자**(우리 허용 목록은 쓰지 않음 — 사용자 결정) | Google Cloud 콘솔 → OAuth 동의 화면(Google Auth Platform → 대상): 게시 상태 **"테스트" 유지**, "테스트 사용자"에 PaperLab을 쓸 사람의 구글 계정 추가(최대 100명) | 게시 상태가 "테스트". **"앱 게시"(프로덕션으로 전환)는 절대 누르지 않음** — 누르면 구글 계정이 있는 누구나 가입할 수 있음 |
| U-14 | Supabase 운영 프로젝트: 공급자는 **Google만** | Supabase 대시보드 → Authentication → Sign In / Providers: Email 끔, 익명 로그인(Anonymous) 끔, 다른 공급자 끔. **Auth Hook은 연결하지 않음**(허용 목록을 켤 때만) | 화면에서 Google만 켜짐 |

## 3. Windows 설정 확인 (Claude Code — 읽기 위주)

**권한 구분(품질팀 F4)**:

| 무엇 | 어떤 PowerShell | 이유 |
|---|---|---|
| 이 절(3절) · 4절 확인 명령, `funnel.ps1 status`, 9절 확인 대부분 | **일반 권한** | 읽기만 함 |
| **`install.ps1`(실제 실행)** | **관리자 권한 PowerShell**("관리자 권한으로 실행" — **[사용자]** 가 UAC 창에서 허용) | "시스템 시작 시" 트리거 작업을 등록하려면 관리자 권한이 필요. 관리자 권한이 아니면 스크립트가 **처음에 멈추고** 안내함(작업 등록 단계까지 가서 실패하지 않게). `-DryRun`은 일반 권한으로도 됨 |
| `update.ps1` · 감시 작업(`watchdog.ps1`) | 일반 권한(설계) | 서버 작업을 멈추고 다시 시작하는데, 관리자 권한으로 등록한 작업을 **일반 권한으로 멈추고 시작할 수 있는지는 서버 PC에서 확인할 항목**(9절 4번). 안 되면 팀장에게 보고(대안: update는 관리자 PowerShell에서 실행 · 감시 작업은 같은 계정 작업이라 영향 없을 수 있음). **`update.ps1`이 관리자 권한으로 돌면**(예: 이 PC의 Claude Code 세션이 관리자 권한 셸) git · pip이 새로 만든 파일의 소유자가 `BUILTIN\Administrators`가 됩니다. 저장소 루트의 소유자는 `USER` 그대로라 git 소유자 검사(9절 5번)는 통과하고, `D:\PaperLab` 상속 권한으로 `USER`가 모든 권한을 가지므로 **서버 동작에는 영향이 없습니다**. 스크립트는 시작할 때 WARN 한 줄만 남기고 계속하며 **소유자를 바꾸지 않습니다**(11절 7번). 가능하면 일반 권한 PowerShell에서 실행하고, 소유자를 바꾸려고 `icacls /setowner /T`를 돌리지 않습니다(정션을 따라 저장소 밖까지 바뀔 수 있음 — 팀장 결정) |

PowerShell(일반 권한)에서:

```powershell
# 시간대: "Korea Standard Time" 이어야 백업이 04:00 KST에 돕니다
tzutil /g

# 절전 · 최대 절전(전원 연결 상태 AC) — 둘 다 0(사용 안 함)이어야 함. 실측: 이미 사용 안 함
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE
powercfg /query SCHEME_CURRENT SUB_SLEEP HIBERNATEIDLE

# 디스크 여유 (C: 5GB 이상, D: 20GB 이상 권장)
Get-PSDrive C, D | Select-Object Name, @{n='FreeGB';e={[math]::Round($_.Free/1GB,1)}}
```

- 시간대가 다르면 **[사용자]** 에게 설정 → 시간 및 언어 → 표준 시간대를 "(UTC+09:00) 서울"로 바꿔 달라고 합니다.
- 절전 값이 0이 아니면 **[사용자]** 확인을 받고 `powercfg /change standby-timeout-ac 0` · `powercfg /change hibernate-timeout-ac 0`(화면 끄기는 상관없음).

## 4. 도구 확인

| 도구 | 확인 명령 | 기대값(실측) | 없거나 다를 때 |
|---|---|---|---|
| Python 3.12 | `py -3.12 --version` | `Python 3.12.10` | **[사용자]** 동의 후 `winget install -e --id Python.Python.3.12` (기본 `python` 3.14는 그대로 둠) |
| Git | `git --version` | 2.53 | `winget install -e --id Git.Git` |
| pg_dump 17 | `pg_dump --version` | `17.10` (`C:\Users\USER\tools\pgsql\bin`) | PATH에 없으면 `cloud.env`에 `PAPERLAB_PG_DUMP=<pg_dump.exe 전체 경로>` 줄을 **[사용자]** 가 추가(명세 S9). 주 버전은 운영 DB 이상이어야 함 — 설치 스크립트가 비교 |
| Tailscale | 4.4절 | 1.102.4, `Running` | U-1 |

winget 패키지 이름은 설치 직전에 `winget search` 로 한 번 더 확인합니다(**확인 필요**).

### 4.4 Tailscale 상태

```powershell
tailscale version
(tailscale status --json | ConvertFrom-Json).BackendState      # Running 이어야 함
(tailscale status --json | ConvertFrom-Json).Self.DNSName       # kimjuhyeon.tailac17f6.ts.net.
```

`tailscale`가 PATH에 없으면 `& "C:\Program Files\Tailscale\tailscale.exe" …`로 부릅니다(설치 경로 **확인 필요**). `DNSName`이 위와 다르면 **멈추고 팀장에게 보고**합니다(공개 주소가 달라짐).

## 5. [사용자] `cloud.env` 옮기기

**저장소 · 채팅(이 대화 포함) · OneDrive · 메일 · 메신저를 거치지 않습니다.**

1. 관리자 PC에서 `C:\Users\user\.paperlab\cloud.env`를 USB 메모리에 복사합니다.
2. 서버 PC에서 `C:\Users\USER\.paperlab\` 폴더를 만들고(없으면) 파일을 붙여 넣습니다. **USB의 파일은 바로 지웁니다.**
3. 서버 PC의 파일을 메모장으로 열어 **[사용자]** 가 직접 고칩니다:
   - **지울 줄**: `SUPABASE_SERVICE_ROLE_KEY`, `GCP_PROJECT_ID`, `GCP_REGION`, `ALLOWED_EMAILS` (서버 PC에 필요 없음 — 허용 목록은 쓰지 않음)
   - **더할 줄**(그대로 복사):
     ```
     PAPERLAB_PUBLIC_URL=https://kimjuhyeon.tailac17f6.ts.net
     PAPERLAB_ALLOWLIST=off
     ```
     `PAPERLAB_ALLOWLIST=off`가 없으면 서버는 허용 목록을 켠 것으로 보고, `ALLOWED_EMAILS`가 없으니 **서버는 뜨지만 모든 로그인 사용자가 403("허용되지 않은 계정")** 을 받습니다(시작 로그 · `serve --check`에 경고 줄 — 팀장 결정). 값은 `on`/`off`만(대소문자 무관) — 그 밖의 값이면 시작 거부. `PAPERLAB_PUBLIC_URL`은 `server.json`의 `public_url`과 같아야 합니다.
   - (필요할 때만) `PAPERLAB_PG_DUMP=…` (4절)
   - (품질 검증을 이 PC에서 할 때만 — 질문 Q-S7) `SUPABASE_TEST_*` 4줄은 그대로 둠, 아니면 지움
   - `SUPABASE_APP_DB_URL`은 **비워 둡니다**(설치 스크립트가 채움)
4. Claude Code 확인(값을 보지 않음):

```powershell
Test-Path "$env:USERPROFILE\.paperlab\cloud.env"    # True
```

파일 권한 제한과 변수 이름 점검은 7절 설치 스크립트가 합니다.

## 6. 저장소 받기

`D:\PaperLab`은 이미 있고 비어 있습니다(이 PC Claude 세션의 작업 폴더).

```powershell
Set-Location D:\PaperLab
git clone --branch claude/paper-program-hrrhl2 <저장소 주소> study99web
Set-Location D:\PaperLab\study99web
git log -1 --oneline
```

- `<저장소 주소>`는 팀장이 알려 줍니다(공개 저장소 `study99web` — 정확한 주소 **확인 필요**). 비공개로 바뀌었다면 **[사용자]** 가 GitHub 로그인을 해야 합니다.
- 받은 커밋이 팀장이 알려 준 승인 커밋과 같은지 확인합니다.
- 저장소 폴더는 `server.json`의 루트 아래(`D:\PaperLab\study99web`)여야 권한 제한이 함께 적용됩니다(루트 밖이면 설치 스크립트가 경고).
- (다른 방법) 저장소가 다른 곳에 있으면 `install.ps1 -AppDir D:\PaperLab\study99web -RepoUrl <저장소 주소>`로 실행하면 그 폴더에 `.git`이 없을 때 스크립트가 받아 옵니다. 보통은 위처럼 직접 clone합니다.

## 7. 설치 스크립트 실행

먼저 할 일만 보여 주는 시험 실행:

```powershell
Set-Location D:\PaperLab\study99web
powershell -ExecutionPolicy Bypass -File deploy\server-pc\install.ps1 -DryRun
```

결과를 사용자에게 요약해 보여 주고 동의를 받은 뒤 실제 실행 — **관리자 권한 PowerShell**에서(3절 권한 구분. **[사용자]** 가 시작 메뉴에서 PowerShell을 "관리자 권한으로 실행"하거나 UAC 창을 허용):

```powershell
Set-Location D:\PaperLab\study99web
powershell -ExecutionPolicy Bypass -File deploy\server-pc\install.ps1
```

관리자 권한이 아니면 스크립트가 시작하자마자 멈추고 "관리자 권한 PowerShell에서 다시 실행"을 안내합니다(아무것도 바꾸지 않음).

**인자**(모두 생략 가능 — 기본값은 `server.json` · 스크립트 위치 · `%USERPROFILE%`):

| 인자 | 뜻 · 기본값 |
|---|---|
| `-DryRun` | 할 일만 `[DRY]` 줄로 보여 주고 아무것도 바꾸지 않음(폴더 · 권한 · 작업 · Funnel 모두). 확인이 실패해도 멈추지 않고 경고만 |
| `-EnvFile <경로>` | 비밀값 파일. 기본 `%USERPROFILE%\.paperlab\cloud.env`(이 PC: `C:\Users\USER\.paperlab\cloud.env`) |
| `-RepoUrl <주소>` | `-AppDir`에 저장소가 없을 때만 그 주소에서 clone(6절 "다른 방법") |
| `-SkipFunnel` | Funnel 단계 건너뜀(Tailscale 준비 전 · 다시 설치할 때) |
| `-PythonVersion <버전>` | 가상환경을 만들 Python(기본 `3.12` → `py -3.12`). 기본 `python`(3.14)은 쓰지 않음 |
| `-ReRegisterTasks` | 이미 있는 작업 3개도 지우고 다시 등록(Windows 계정 비밀번호를 바꾼 뒤 · 작업 설정이 바뀐 업데이트 뒤) |
| `-RecreateVenv` | 가상환경을 지우고 다시 만듦(Python 업데이트 뒤 깨졌을 때) |
| `-Root` · `-AppDir` · `-LogDir` · `-TmpDir` · `-Branch` · `-Port` | 기본: `D:\PaperLab` · 스크립트가 든 저장소(`D:\PaperLab\study99web`) · `D:\PaperLab\logs` · `D:\PaperLab\tmp` · `claude/paper-program-hrrhl2` · `8080` |

스크립트가 하는 일(명세 13.1절 5번 — 몇 번 다시 실행해도 안전, 로그 `D:\PaperLab\logs\install.log`):

1. 확인(읽기만): 시간대 `Korea Standard Time` · `py -3.12` · git · `cloud.env` 있음(내용은 읽지 않음) · 절전(경고만) · 저장소 브랜치가 배포 브랜치.
   - 루트 · 저장소 · `logs` · `tmp` · `.paperlab` 폴더나 `cloud.env` 파일 자체가 정션 · 심볼릭 링크면 아무것도 바꾸기 전에 멈춤 → 실제 폴더 경로(`-Root` · `-LogDir` · `-TmpDir`, 저장소가 정션이면 `-AppDir`)나 실제 파일 경로(`-EnvFile`)로 다시 실행.
2. `D:\PaperLab` 권한 제한: 상속을 끊고 `USER` · `SYSTEM` · `Administrators`만(D:의 기본값 `Authenticated Users` 수정 권한을 없앰 — 로그에 개인 정보가 남을 수 있어서). `logs` · `tmp` 폴더 만들기, 하위 폴더가 다른 권한이면 루트 상속으로 되돌림.
   - 되돌리기(`icacls /reset`)가 실패하면 실패한 폴더 경로를 담은 WARN 한 줄만 남기고 설치는 계속 → WARN의 그 경로로 `icacls <경로>`를 직접 실행해 남은 다른 계정 권한을 확인(9절 6번).
3. `C:\Users\USER\.paperlab` 폴더와 `cloud.env` 권한 제한(같은 세 계정만).
4. `py -3.12 -m venv .venv`(없을 때) → `.venv\Scripts\python -m pip install -e .`
5. `python -m paperlab.serve --check --before-app-role` — 빠진 · 틀린 · 지워야 할 변수 **이름**만 출력(`SUPABASE_APP_DB_URL`이 아직 없는 것은 문제로 보지 않음). 문제가 있으면 여기서 멈춤 → 5절로 돌아가 **[사용자]** 가 고침.
6. `python -m paperlab.migrate` (관리자 연결. 테스트 프로젝트 DB면 거부됨) → `python -m paperlab.admin sync-allowlist` — `ALLOWED_EMAILS`를 지웠으므로 "표를 바꾸지 않았어요"로 끝남(허용 목록 표를 비우지 않음).
7. `python -m paperlab.admin app-role --write-env --if-missing` — `SUPABASE_APP_DB_URL`이 비어 있을 때만 앱 역할 비밀번호를 만들어 `cloud.env`의 그 줄에 직접 씀(화면에 값이 나오지 않음). 이미 있으면 그대로 둠.
8. `python -m paperlab.serve --check`(전체) → `python -m paperlab.admin pg-dump-check` — `pg_dump` 주 버전이 운영 DB보다 낮으면 **백업 작업 등록 전에 중단**.
9. 작업 스케줄러 3개 등록(이미 있으면 그대로 — `-ReRegisterTasks`일 때만 다시). **Windows 자격 증명 창(Get-Credential)** 이 뜨면 **[사용자]** 가 직접 `USER` 계정 **비밀번호**를 넣습니다(PIN이 아니라 비밀번호. Microsoft 계정으로 로그인하는 PC면 그 계정 비밀번호). Claude Code는 이 창에 대신 입력하지 않고, 비밀번호는 스크립트 · 파일 · 로그 · 대화에 남지 않습니다. 취소하면 작업을 등록하지 않고 멈춤.
   - `PaperLab Server`: 시스템 시작 시, `python -m paperlab.serve --port 8080 --env-file … --log-dir D:\PaperLab\logs --diag-hang-file D:\PaperLab\tmp\diag-hang-health`, 실패 시 1분마다 다시 시작(999번), 시간 제한 없음, 겹치면 새로 시작 안 함.
   - `PaperLab Backup`: 매일 04:00, `python -m paperlab.admin --env-file … --log-file D:\PaperLab\logs\backup.log backup --tmp-dir D:\PaperLab\tmp`, 놓치면 켜진 뒤 곧 실행, 1시간 제한.
   - `PaperLab Watchdog`: 5분마다 `watchdog.ps1`, 10분 제한.
10. `PaperLab Server` 시작 → `http://127.0.0.1:8080/api/health?deep=1`이 `db: ok, storage: ok`가 될 때까지 기다림(최대 60초).
11. Funnel 켜기(`funnel.ps1 on`, `-SkipFunnel`이면 건너뜀) → 공개 주소 `/api/health` 확인 → 8절.
12. 요약 출력: 작업 3개 상태, 배포 커밋, Funnel 상태.

## 8. Funnel 켜기

설치 스크립트가 부르지만, 따로 할 때:

```powershell
powershell -ExecutionPolicy Bypass -File deploy\server-pc\funnel.ps1 on       # = tailscale funnel --bg 8080
powershell -ExecutionPolicy Bypass -File deploy\server-pc\funnel.ps1 status   # = tailscale funnel status
```

- 처음 켤 때 Funnel 사용 승인 페이지가 브라우저에 뜰 수 있습니다 → **[사용자]** 가 승인.
- `status`에 `https://kimjuhyeon.tailac17f6.ts.net` → `http://127.0.0.1:8080` **한 줄만** 있어야 합니다. 다른 포트(8443 · 10000)나 다른 대상이 보이면 끄고 팀장에게 보고합니다.
- `--bg`로 켰으므로 재부팅 뒤에도 자동으로 다시 켜집니다(공식 문서).
- 인증서 발급이 실패하면 **계속 다시 시도하지 않습니다** — Let's Encrypt 한도에 걸리면 약 34시간 기다려야 합니다(공식 문서). 10분 기다렸다 한 번만 다시.
- 이 PC에서 다른 프로그램을 Funnel로 공개하지 않습니다.

## 9. 설치 후 확인 (19항목 — 품질팀 서버 PC 체크리스트 Q1~Q16 + 기존 확인 합침)

표의 "품질" 칸은 품질팀 체크리스트 번호(Q1~Q16)입니다. 별도 표시가 없으면 **일반 권한** PowerShell, 저장소 폴더(`D:\PaperLab\study99web`)에서 실행합니다. 결과를 팀장에게 보고할 때 값(비밀)은 빼고 번호별 통과 여부 · 시각 · (실패 시) 오류 문구만 적습니다.

**가. 설치 · 권한 · 작업**

| # | 확인 | 방법 | 기대 | 품질 · 명세 |
|---|---|---|---|---|
| 1 | install 권한 | **일반 권한** PowerShell에서 `install.ps1`(실제 실행)을 한 번 시도 | 일반 권한이면 스크립트가 **작업 등록 전에** "관리자 권한 필요" 안내와 함께 멈춤 → **관리자 PowerShell로 다시 실행**(7절) | Q1 · F4 |
| 2 | 작업 3개 정의 | `Get-ScheduledTask 'PaperLab*' \| ForEach-Object { '{0} \| {1} \| {2} \| {3}' -f $_.TaskName, $_.State, $_.Principal.UserId, $_.Principal.LogonType }` · 작업 스케줄러 화면의 "사용자가 로그온했는지 여부에 관계없이 실행" | 3개(`PaperLab Server` · `Backup` · `Watchdog`), 실행 계정 `KIMJUHYEON\USER`, LogonType `Password`(암호 저장), Server는 `Running`. 등록 때 넣은 것이 **Microsoft 계정 암호**(PIN 아님)로 받아들여졌는지. 작업이 "요청한 로그온 유형이 허가되지 않음(0x80070569)"류 오류로 안 돌면 **"일괄 작업으로 로그온" 권한** 문제 → 팀장 보고(Home 에디션은 로컬 보안 정책 화면이 없음) | Q2 · AC-58 |
| 3 | 감시 작업 반복 기간 | `(Get-ScheduledTask 'PaperLab Watchdog').Triggers[0].Repetition \| Format-List` | `Interval` = `PT5M`, **`Duration`이 비어 있음**(무기한 — 비어 있지 않으면 그 기간 뒤 감시가 멈춤) | Q3 |
| 4 | 일반 권한으로 서버 재시작 | (a) **일반 권한** PowerShell에서 `update.ps1 -RestartOnly` (b) 실행 수준 Limited인 감시 작업이 서버를 재시작한 기록(17번에서 함께) | 둘 다 'PaperLab Server'를 멈추고 다시 시작함(접근 거부 없음). 실패하면 오류 문구를 팀장에게 보고 | Q4 · F4 · AC-77 · 79 |
| 5 | git 소유자 | 일반 권한에서 `git -C D:\PaperLab\study99web status` | "detected dubious ownership"(safe.directory) 오류 **없음**. 오류가 나면(관리자 권한으로 만든 폴더 소유자 때문) 팀장 보고 후 `git config --global --add safe.directory D:/PaperLab/study99web` | Q5 |
| 6 | 바인딩 · 권한 | `Get-NetTCPConnection -LocalPort 8080 -State Listen \| Select LocalAddress` · **[사용자]** 같은 망의 다른 PC에서 `http://<서버 PC 사설 IP>:8080/api/health` · `icacls D:\PaperLab` · `icacls D:\PaperLab\study99web` · `icacls D:\PaperLab\logs` · `icacls D:\PaperLab\tmp` · `icacls "$env:USERPROFILE\.paperlab\cloud.env"` · `.venv\Scripts\python -m paperlab.serve --check` | 주소 `127.0.0.1`만, 다른 PC에서 접속 **실패**, `D:\PaperLab` · `cloud.env` ACL은 `USER` · `SYSTEM` · `Administrators`만이고 `(I)` 상속 표시 없음. `study99web` · `logs` · `tmp`는 같은 세 계정의 `(I)` 상속 항목만(다른 계정이 보이면 설치 WARN과 같은 문제 — 보고). 설치 스크립트의 `icacls /reset`(하위 폴더 최상위만 상속으로 되돌리기 — `/T` 없이, 그 아래는 시스템이 상속을 다시 전파하고 정션은 따라가지 않음; 하위 항목이 권한 변경을 거부하면 예전 상속 항목이 남을 수 있음 — 9절 6번에서 확인) 뒤에도 `.venv`가 정상(`--check`가 실행됨). 하위 폴더 아래에 따로 남은 명시적 권한은 스크립트가 검사 · 초기화하지 않음. 루트 · 저장소 · `logs` · `tmp` · `.paperlab` 폴더나 `cloud.env` 파일이 정션 · 심볼릭 링크면 설치가 멈춤(실제 폴더 · 파일 경로로 다시 실행) | Q9 · AC-58 |
| 7 | `cloud.env` 점검 | `.venv\Scripts\python -m paperlab.serve --check` (출력은 변수 **이름**만) · **[사용자]** 메모장으로 `PAPERLAB_PUBLIC_URL`이 `server.json`의 `public_url`과 같은지 | "지워야 할 변수: 없음", ACL 경고 없음, 허용 목록 경고 없음(`PAPERLAB_ALLOWLIST=off`), 공개 주소 일치 | Q15 · AC-69 · 81 |
| 8 | 스크립트 인코딩 · 줄 끝 | `Get-ChildItem deploy -Recurse -Filter *.ps1 \| ForEach-Object { '{0} {1}' -f $_.Name, ((Get-Content $_.FullName -Encoding Byte -TotalCount 3) -join ',') }` · `git config --get core.autocrlf` | 모든 `.ps1`이 `239,187,191`(UTF-8 BOM)로 시작(BOM이 없으면 PowerShell 5.1이 한글을 깨뜨림). `autocrlf` 값을 기록. `.gitattributes`에 `*.ps1 text eol=crlf` 규칙이 **추가돼 있음**(줄 끝은 CRLF로 받아짐 — `git check-attr eol deploy/server-pc/install.ps1`이 `crlf`) | Q16 |

**나. 서버 · Funnel · 로그인**

| # | 확인 | 방법 | 기대 | 품질 · 명세 |
|---|---|---|---|---|
| 9 | 로컬 상태 | `Invoke-RestMethod http://127.0.0.1:8080/api/health?deep=1` | `ok: true`, `db: ok`, `storage: ok` | AC-59 |
| 10 | 바깥에서 | **[사용자]** 휴대폰을 **와이파이 끄고 데이터로** `https://kimjuhyeon.tailac17f6.ts.net/api/health` · `?deep=1` | `{"ok": true, …}`, deep도 정상. `http://`로는 안 열림 | AC-59 |
| 11 | Funnel 헤더 | 공개 주소 요청 1번을 헤더 확인 진단으로 기록 — **저장소에는 아직 이 진단 기능이 없음**(`--diag-hang-file`은 감시 시험용이라 해당 없음). 개발팀이 실측 전에 준비해 서버 PC 설치 때 함께 반영(헤더 **이름**과 Host 값만 기록, 끝나면 끔). 준비되지 않았으면 이 항목은 "보류"로 보고 | `Host`가 공개 호스트(`kimjuhyeon.tailac17f6.ts.net`), `X-Forwarded-For`가 옴(오지 않으면 팀장 보고 — 2단계 IP별 속도 제한에 영향) | Q7 · AC-75 |
| 12 | Funnel 명령 형식 | `tailscale version` · `tailscale funnel status` 원문을 `funnel.ps1 status` 출력과 비교, `funnel.ps1 off` → `on` 한 번 (끄는 동안 바깥 접속이 끊김 — 사용자가 적을 때) · 다음 날 `watchdog.log`의 공개 주소 점검 줄 | Tailscale 1.102.4에서 `tailscale funnel --bg 8080` · `tailscale funnel --https=443 off` · `status`가 스크립트가 기대하는 형식이고, 443 → `http://127.0.0.1:8080` 한 줄만 보임. 감시 작업이 `status`를 바르게 해석(엉뚱한 경고 없음) | Q8 |
| 13 | 로그인 | **[사용자]** 브라우저로 공개 주소 → Google로 계속 | 서재 화면(403 "허용되지 않은 계정"이면 12절 — `PAPERLAB_ALLOWLIST=off` 확인) | AC-61 · 69 |
| 14 | 가입 관문 | **[사용자]** Google Cloud 콘솔 OAuth 동의 화면 · Supabase 대시보드(Authentication → Providers · Hooks) 확인. 테스트 사용자 밖 구글 계정으로 로그인 시도. 공개 anon 키로 이메일 가입 · 익명 로그인 API 시도(개발팀 · 품질팀 명령) | 동의 화면 **"테스트"**, 테스트 사용자 100명 이하, 공급자 **Google만**, 이메일 가입 · 익명 로그인 **실패**, Before User Created 훅 **미연결**, 목록 밖 계정은 Google 화면에서 막힘 | Q14 · AC-03 · 05 · 80 · 82 |

**다. 백업 · 장애 복구 · 업데이트 · 긴 연결**

| # | 확인 | 방법 | 기대 | 품질 · 명세 |
|---|---|---|---|---|
| 15 | 백업 | `.venv\Scripts\python -m paperlab.admin pg-dump-check` → `Start-ScheduledTask 'PaperLab Backup'` → 1~2분 뒤 `Get-ScheduledTaskInfo 'PaperLab Backup'` · `Get-Content D:\PaperLab\logs\backup.log -Tail 20` · `Get-ChildItem D:\PaperLab\tmp, $env:TEMP -Recurse -Filter *.dump` · `.venv\Scripts\python -m paperlab.admin latest-backup` | pg_dump 주 버전 **17 이상**이고 DB 서버 이상, 마지막 실행 결과 **0**, R2에 **오늘(KST)** `backups/db/<YYYYMMDD>.dump`, `.dump` 파일 **0개**, `backup.log`에 연결 문자열 · 비밀번호 · 키 **없음**. 백업 성공 = `paperlab_app`이 `service_role` 구성원이라 `pg_dump --role=service_role`이 됨(실패하면 `backup.log`에 role 권한 오류 — 팀장 보고) | Q10 · AC-70 · 71 |
| 16 | 재부팅 | **[사용자]** 동의 후 다시 시작 → **아무도 로그인하지 않은 채** 5분 → 다른 망(휴대폰 데이터)에서 `…/api/health?deep=1` | 200 · `db: ok`(서버 작업 · Tailscale 무인 실행 · Funnel `--bg` 모두 로그온 없이 올라옴) | Q11 · AC-76 |
| 17 | 강제 종료 · 멈춤 | (a) 작업 관리자로 서버 `python.exe` 끝내기 → 2분 뒤 9번 (b) **진단 스위치**: `New-Item D:\PaperLab\tmp\diag-hang-health -ItemType File` → 15~20분 뒤 `watchdog.log` → **반드시** `Remove-Item D:\PaperLab\tmp\diag-hang-health` → 9번 | (a) 작업 스케줄러 "실패 시 다시 시작"(1분)으로 **2분 안에** 다시 뜸(강제 종료라 종료 코드가 0이 아니어도). 안 뜨면 감시 작업이 **15분 안에** 재시작했는지 `watchdog.log`로 확인 (b) "3/3"과 재시작 기록 1건, 파일을 지운 뒤 정상. 파일을 남기면 1시간에 3번까지 재시작 후 경고만 | Q6 · AC-77 |
| 18 | 업데이트 | 팀장이 준비한 새 커밋으로 먼저 `update.ps1 -DryRun`(미리 `git fetch` 하지 않고) → `update.ps1` → 일부러 시작에 실패하는 시험 커밋(품질팀 준비)으로 `update.ps1` → **`pyproject.toml`을 바꾸고 pip 설치가 실패하는 시험 커밋**(품질팀 준비 — 예: 없는 패키지 의존성)으로 `update.ps1` → 작업 폴더에 빈 파일 하나 만들고 `update.ps1`. 관리자 권한 셸에서 실행했다면 `update.log`의 처음 줄 | `-DryRun`이 새 커밋 목록을 보여 줌(작업 폴더 · HEAD · 브랜치는 그대로). 새 커밋 반영 · `/api/health`의 커밋이 새 값 · `update.log`에 옛 → 새, 실패 커밋은 60초 안에 **자동 되돌림**(서버 정상), **pip 실패 커밋도 옛 커밋으로 되돌리고(옛 의존성 다시 설치) 다시 시작 · 확인** — `git log -1`이 옛 커밋, `update.log`에 "코드 반영 · 의존성 설치 단계 오류" · "되돌림 완료", 종료 코드 1, 서버 정상. 고친 파일이 있으면 **시작하지 않음**(종료 코드 1). 관리자 권한 실행이면 WARN "관리자 권한으로 실행 중: …" 한 줄이 있고 업데이트는 그대로 진행(소유자는 바꾸지 않음 — 9절 5번 git 소유자 검사는 계속 통과해야 함). 시험 파일 · 시험 커밋은 지우거나 되돌림 | Q12 · AC-79 |
| 19 | 긴 연결 · 큰 요청 | 공개 주소에서 논문 대화(SSE)를 5분 넘게 이어지게 · 30MB에 가까운 워드 파일로 인용 넣기(compose) | SSE가 5분 넘게 끊기지 않음, compose 성공 — **걸린 시간 기록**(Funnel 대역폭 참고값) | Q13 · AC-78 |

## 10. [사용자] 설치 뒤 마무리

1. Supabase 운영 프로젝트 → Authentication → URL Configuration: **Site URL**과 **Redirect URLs**에 `https://kimjuhyeon.tailac17f6.ts.net/`.
2. Cloudflare R2 버킷 → Settings → CORS: `AllowedOrigins`에 `https://kimjuhyeon.tailac17f6.ts.net`(값 전체는 명세 20장 관리자 절 JSON).
3. 관리자 PC에서 바탕화면 바로가기: `powershell -ExecutionPolicy Bypass -File deploy\make-shortcut.ps1` (주소는 `server.json`에서 읽음 — `-Url`은 다른 주소를 쓸 때만)
4. Google Cloud 프로젝트는 PaperLab 서버로 더 쓰지 않지만, **Google 로그인(OAuth) 클라이언트가 그 프로젝트에 있으면 지우면 안 됩니다**(확인 필요).

## 11. 일상 운영

| 하고 싶은 일 | 방법 |
|---|---|
| 새 버전 반영 | 팀장이 승인 · 푸시를 알리면 `powershell -ExecutionPolicy Bypass -File deploy\server-pc\update.ps1` (아래 "업데이트 동작"). 먼저 `-DryRun`으로 반영할 커밋을 볼 수 있음(**`git fetch`만 함** — 원격 추적 브랜치 · `FETCH_HEAD` · 객체 · 태그 갱신, 작업 폴더 · HEAD · 브랜치 · 서버 · 로그는 그대로. 미리 fetch할 필요 없음), `-Yes`는 확인 질문 생략 |
| 특정 커밋으로 되돌리기 | `update.ps1 -Ref <커밋>` — 옛 커밋으로 갈 때는 마이그레이션을 하지 않음(DB 마이그레이션은 되돌리지 않음) |
| `cloud.env`를 고친 뒤 | `update.ps1 -RestartOnly` (코드는 그대로, 서버만 다시 시작 → 상태 확인) |
| 사용자 추가 · 빼기 | **[사용자]** Google Cloud 콘솔 → OAuth 동의 화면 → 테스트 사용자에서 추가 · 삭제(서버 재시작 필요 없음). 뺄 때는 Supabase 대시보드 Users에서 그 사용자도 삭제 |
| 서버만 다시 시작 | `Stop-ScheduledTask "PaperLab Server"; Start-ScheduledTask "PaperLab Server"` |
| 로그 보기 | `Get-Content D:\PaperLab\logs\server.log -Tail 50` (JSON 한 줄씩 — 토큰 · 키 · 본문은 원래 남지 않음) |
| 주간 점검(주 1회) | `watchdog.log`의 WARN 줄, `Get-ScheduledTaskInfo "PaperLab Backup"`의 마지막 결과, `funnel.ps1 status`, `D:\PaperLab\study99web`에서 `.venv\Scripts\python -m paperlab.admin cache-stats`로 공용 캐시 크기 확인(크기 · 행 수만 나옴 — 150MB 넘으면 `cache-prune --max-mb 150`, [1B 명세](../../docs/specs/citation-graph.md) 8.5절), **[사용자]** Google OAuth 동의 화면 게시 상태가 "테스트"인지 |
| (선택) 허용 목록 켜기 | `cloud.env`에 `PAPERLAB_ALLOWLIST=on` · `ALLOWED_EMAILS=…` → `sync-allowlist` → **[사용자]** Supabase Auth Hook "Before User Created"에 `paperlab.before_user_created` 연결 → `update.ps1 -RestartOnly` (명세 6.3절) |
| 앱 역할 비밀번호 회전 | `.venv\Scripts\python -m paperlab.admin app-role --write-env`(`--if-missing` 없이 — 새 비밀번호, 값 출력 없음) → 곧바로 `update.ps1 -RestartOnly`. 백업 작업은 실행할 때마다 파일을 새로 읽으므로 할 일 없음 |
| 암호화 키 회전 | 명세 8.3절 순서(서버 멈춤 → `cloud.env` 새 키 → `admin rotate-key` → 서버 시작) |
| Windows 계정 비밀번호를 바꾼 뒤 | 작업 3개의 저장된 비밀번호도 바꿔야 함 — `install.ps1 -ReRegisterTasks -SkipFunnel`(자격 증명 창에 **[사용자]** 가 새 비밀번호 입력) |
| 급히 공개를 막기 | `funnel.ps1 off` (서버는 계속 돌지만 바깥에서 못 들어옴) |
| 복원 | `deploy/README.md` 4장 복원 절차 |
| 제거 | `deploy\server-pc\uninstall.ps1`(작업 삭제 · Funnel 끔, `-DryRun` 가능). 저장소 · `cloud.env`는 **[사용자]** 가 직접 지움 |

**업데이트 동작(`update.ps1`, 명세 13.8절)** — 로그 `D:\PaperLab\logs\update.log`

1. `git fetch` → 배포 브랜치의 새 커밋 목록 → 확인(`-Yes`면 생략). 새 커밋이 없으면 끝. **`-DryRun`도 이 `git fetch`는 실제로 함**(fetch만 함 — 원격 추적 브랜치 `origin/…` · `FETCH_HEAD` · 객체 · 태그 갱신, 작업 폴더 · HEAD · 브랜치는 그대로) — 그래야 반영할 커밋 목록이 맞음. 그 뒤 단계(코드 반영 · pip · 마이그레이션 · 재시작)는 `[DRY]` 줄로 보여 주기만 하고, `update.log`도 쓰지 않음.
2. 작업 폴더에 고친 파일이 있거나, 지금 브랜치가 배포 브랜치가 아니거나, 앞으로만 갈 수 없으면(ff-only 불가) **시작하지 않음** → 팀장에게 보고.
3. 코드 반영(`git merge --ff-only`, `-Ref`면 그 커밋으로) → `pyproject.toml`이 바뀌었으면 `pip install -e .`. **여기서 실패하면**(pip 오류 등) 6번처럼 **옛 커밋으로 되돌리고(`pyproject.toml`이 바뀐 경우 옛 의존성 다시 설치) 서버를 다시 시작 · 확인**, 마이그레이션은 하지 않음. 종료 코드 1.
4. 마이그레이션(`paperlab.migrate`) → `admin sync-allowlist`. **여기서 실패하면**(DB 오류 · **Supabase 일시정지** 포함) **코드만 옛 커밋으로 되돌리고 서버는 다시 시작하지 않음** — 서버는 옛 코드로 계속 돎. 종료 코드 1.
5. 서버 작업 다시 시작 → `http://127.0.0.1:8080/api/health?deep=1`이 정상이고 응답의 커밋이 새 커밋인지 60초 동안 확인.
6. **확인 실패면 자동으로 옛 커밋으로 되돌리고 다시 시작**(마이그레이션은 되돌리지 않음). `deep=1`은 DB까지 보므로 **반영 중 Supabase가 일시정지돼 있으면 이 단계에서도 되돌림**이 일어남 — Supabase를 Restore한 뒤 다시 업데이트. 되돌린 뒤에도 정상이 아니면 오류로 남기고 팀장에게 보고.
7. **관리자 권한(elevated)으로 실행하면** 시작할 때 WARN 한 줄을 화면과 `update.log`에 남기고 그대로 진행: "관리자 권한으로 실행 중: 새로 받는 파일의 소유자가 Administrators가 되지만, 상속 권한으로 서버 계정이 접근할 수 있어 동작에는 영향이 없습니다. 가능하면 일반 권한 PowerShell에서 실행하세요." **소유자 · 권한은 바꾸지 않음**(`icacls` 쓰지 않음 — 팀장 결정). 일반 권한이면 이 줄도 없음.

## 12. 문제 해결

| 증상 | 확인 | 조치 |
|---|---|---|
| 바깥에서 안 열림, 로컬(1번)은 정상 | `tailscale status --json` BackendState, `funnel.ps1 status` | `Stopped`면 U-1 · U-2, Funnel 설정이 없으면 `funnel.ps1 on`, 키 만료면 U-6 |
| 로컬도 안 열림 | `Get-ScheduledTaskInfo "PaperLab Server"`, `server.log` 끝 | 설정 오류(빠진 변수 **이름**이 로그에 있음) → 5절. 포트 사용 중 → `Get-NetTCPConnection -LocalPort 8080`으로 다른 프로그램 확인 |
| `deep=1`에서 `db: error` | Supabase 대시보드에서 일시정지 여부 | **[사용자]** Restore. 비밀번호 오류면 `app-role --write-env` 후 재시작 |
| `deep=1`에서 `storage: error` | R2 키 · 버킷 이름 변경 여부 | **[사용자]** `cloud.env`의 R2 줄 확인 |
| 구글 화면에서 로그인이 막힘(앱 접근 차단 등) | 그 계정이 OAuth 테스트 사용자 목록에 있는지 | **[사용자]** Google Cloud 콘솔에서 테스트 사용자 추가 |
| **모든 로그인 사용자가 403 · "허용되지 않은 계정"** (서버는 정상으로 떠 있음) | `server.log` 시작 줄 · `serve --check`의 허용 목록 **경고 줄**, `cloud.env`에 `PAPERLAB_ALLOWLIST=off` 줄이 있는지(**[사용자]** 가 메모장으로 확인 — Claude Code는 내용을 읽지 않고 `--check` 출력만 봄) | `PAPERLAB_ALLOWLIST=off` 줄 추가 → `update.ps1 -RestartOnly`(5절). 허용 목록 on + `ALLOWED_EMAILS` 없음/빈 목록이면 서버는 시작하되 모두 403(전부 허용으로 보지 않음) |
| 일부 사용자만 "허용되지 않은 계정" | 허용 목록을 켠 경우에만 생김 | 끄려면 `PAPERLAB_ALLOWLIST=off`, 켜 둘 거면 `ALLOWED_EMAILS` 수정 → `sync-allowlist` → `update.ps1 -RestartOnly` |
| 서버가 `PAPERLAB_ALLOWLIST` 때문에 시작 안 함 | `serve --check` 출력 | 값이 `on`/`off`가 아님(오타) → 고침 |
| 로그인 화면으로 계속 돌아감 | Supabase Redirect URLs | 10절 1번 |
| PDF 업로드 · 보기 CORS 오류 | R2 CORS | 10절 2번 |
| 백업 실패 | `backup.log`(값 없이 오류만), `admin pg-dump-check`, `admin latest-backup` | "pg_dump를 찾지 못했어요" → `PAPERLAB_PG_DUMP`(4절). 버전 오류 → PostgreSQL 클라이언트를 운영 DB 주 버전 이상으로. "SUPABASE_APP_DB_URL 이 비어 있어요" → `admin app-role --write-env --if-missing` |
| 업데이트가 "마이그레이션 단계"에서 실패 · 되돌림 | `update.log`, Supabase 대시보드 | Supabase 일시정지면 **[사용자]** Restore 후 다시 `update.ps1`. 그 밖이면 팀장에게 보고(서버는 옛 코드로 계속 돎) |
| 감시 작업이 계속 재시작 | `watchdog.log`, `D:\PaperLab\tmp\diag-hang-health`가 남아 있는지 | 진단 파일이면 지움(9절 17번). 아니면 `server.log` 확인 · 팀장 보고 |
| 작업이 로그온 없이 안 돔 | 작업 속성 "사용자가 로그온했는지 여부에 관계없이 실행", 저장된 비밀번호 | `install.ps1 -ReRegisterTasks -SkipFunnel` |
| 재부팅 뒤 바깥에서 안 열림 | Tailscale 무인 실행(U-2) | U-2 다시 |
| 인증서 오류 · 발급 실패 | HTTPS Certificates(U-4), 발급 한도 | 8절 — 반복 시도 금지, 팀장 보고 |
| 디스크 경고(`watchdog.log`) | `Get-PSDrive C, D` | C: 정리(디스크 정리 · Windows 업데이트 정리)는 **[사용자]**, 로그는 회전되므로 지우지 않아도 됨 |
| `py -3.12` 가상환경 오류(Python 업데이트 뒤) | `.venv\Scripts\python --version` | `install.ps1 -RecreateVenv -SkipFunnel` |

## 13. 스크립트 · 명령 목록 (개발팀 구현 — 2026-10-07)

| 파일 · 명령 | 역할 |
|---|---|
| `deploy/server-pc/install.ps1` | 7절 전체. **관리자 권한 PowerShell 필요**(아니면 시작 때 멈춤, `-DryRun`은 예외). `-DryRun` · `-EnvFile` · `-RepoUrl` · `-SkipFunnel` · `-PythonVersion` · `-ReRegisterTasks` · `-RecreateVenv` · `-Root` `-AppDir` `-LogDir` `-TmpDir` `-Branch` `-Port` |
| `deploy/server-pc/update.ps1` | 11절 업데이트 동작 · `-Ref` · `-Yes` · `-RestartOnly` · `-DryRun`(`git fetch`만 함) · `-TimeoutSec`(기본 60). 반영 뒤 단계(pip 포함)가 실패하면 옛 커밋으로 되돌림. 관리자 권한으로 돌면 시작할 때 WARN 한 줄만(소유자는 바꾸지 않음 — 11절 7번) |
| `deploy/server-pc/funnel.ps1` | `on`(`tailscale funnel --bg 8080`) · `status` · `off`, `-DryRun`. `tailscale`는 PATH → `Program Files\Tailscale` 순으로 찾음 |
| `deploy/server-pc/watchdog.ps1` | 5분마다: `/api/health` 3번 연속 실패면 서버 재시작(1시간 3번까지, 넘으면 경고만). 하루 한 번: 공개 주소 · 최근 백업(36시간) · 디스크 여유(시스템 5GB · 데이터 20GB) → `watchdog.log`(1MB × 5). **`-DryRun`은 아무것도 바꾸지 않음**(작업 재시작 없이 `[DRY]` 기록만 — 품질팀 F3, 개발팀 수정). `-SkipDaily` · `-StateFile` · `-MaxRestartsPerHour` 등은 시험용 |
| `deploy/server-pc/uninstall.ps1` | 작업 삭제 · Funnel 끔(`cloud.env` · 저장소는 지우지 않는다고 알림) |
| `deploy/server-pc/common.ps1` | 다른 스크립트가 함께 쓰는 함수(설정 읽기 · 로그 · 권한 · 관리자 권한 확인 · 상태 확인) |
| `deploy/server-pc/server.json` | 공개 주소 · 포트 · 루트 · 브랜치 · 작업 이름(비밀 없음 — 주소를 두는 한 곳) |
| `python -m paperlab.serve` | 서버 실행. `--check`(설정 점검, 이름만) · `--before-app-role` · `--log-dir` · `--diag-hang-file`(진단 스위치 — 9절 17번) |
| `python -m paperlab.admin app-role --write-env [--if-missing]` | 앱 역할 주소를 `cloud.env`에 씀(`--if-missing`: 이미 있으면 그대로) |
| `python -m paperlab.admin backup --tmp-dir <폴더>` | 백업(앱 역할 주소 + `pg_dump`, 임시 파일 정리) |
| `python -m paperlab.admin pg-dump-check` | `pg_dump` 주 버전 ≥ DB 서버 주 버전인지(앱 역할 주소로 버전만 읽음) |
| `python -m paperlab.admin latest-backup [--max-hours 36]` | R2의 가장 최근 백업 날짜(없거나 기한 넘으면 종료 코드 2) |
