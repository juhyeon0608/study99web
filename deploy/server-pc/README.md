# PaperLab 서버 PC 설치 안내서

- 작성: 기획팀 · 2026-10-07 (개발팀 구현 스크립트 · 명령과 대조해 개정 — 13절. 안내서와 스크립트 동작이 다르면 그 단계에서 **멈추고 팀장에게 알립니다**). 2026-10-13: 5단계(국내 DB) `cloud.env` 새 변수 · 키 신청 · 녹화 도구 · 반영 순서를 14절에 추가(5절 · 11절 · 12절 · 13절에 줄 추가). 2026-10-13 후속: 14.3절 녹화 도구 문구(이메일 모양은 가려 저장, 키 문자열일 때만 멈춤). 2026-10-14: 6단계(폴더 동기화 · 휴지통) **반영 순서 · 관리자 작업 · 새 설정값을 15절에 추가**(5절 · 13절에 줄 추가, 11절에는 이미 설정값 줄이 있음). 2026-10-14 전체 점검 반영: **처음 반영 때 옛 `update.ps1`이 돈다는 점(D-1) · 여러 단계를 한 번에 올리는 16절 신설 · 업데이트 동작 번호(8 · 9 · 10) 정리 · 수동 반영에 코드 받기 줄 추가 · `PAPERLAB_EMBED_MODEL_DIR` · 되돌리기 주의(앱 0.3.0)**. **2026-10-14 전체 오류 점검 반영**: 마이그레이션 표 잠금 대기 상한 `lock_timeout` 10초(11절 4번 · 12절) · 폴더 통째 지우기 안전 검사 `Remove-PLTree`(13절 `common.ps1` 줄 · 12절)
- **서버 PC 반영 현황: 2026-10-14 현재 서버 PC는 `f9e748e`(1C)까지 반영, 2a~6단계는 미반영입니다.** 한꺼번에 올리는 순서는 **16절**.
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
| LibreOffice (서재에 워드 · 한글 · PPT · 엑셀 넣기 — 17절) | `& 'C:\Program Files\LibreOffice\program\soffice.exe' --version` | `LibreOffice 26.8…` | **[사용자]** 동의 후 libreoffice.org의 Windows 설치 파일(기본 옵션). 다른 곳에 깔았으면 `cloud.env`에 `PAPERLAB_SOFFICE=<soffice.exe 전체 경로>`. **없어도 서버는 뜨고** PDF · 사진만 올라감(문서는 "문서 변환기가 없어…" 오류) |
| H2Orestart (한글 .hwp · .hwpx 읽기) | `& 'C:\Program Files\LibreOffice\program\unopkg.com' list --shared` 에 `H2Orestart` | 있음(공유 설치) | **[사용자]** 확장 파일(.oxt)을 받아 `unopkg.com add --shared <H2Orestart.oxt>` — **반드시 `--shared`**(서버는 자기 전용 LibreOffice 프로필로 돌아서 사용자 프로필에만 깐 확장은 못 씀) |
| Java (H2Orestart가 씀) | `java -version` | Temurin 21 | **[사용자]** 동의 후 Temurin 21 JRE(64비트). 없으면 한글 파일만 "PDF로 바꾸지 못했어요" |
| Node.js LTS · npm (PC 앱 설치 파일 빌드 — 2단계 13.7.1절) | `node -v` · `npm -v` | `v24.14` (주 버전 **22 이상**) | **[사용자]** 동의 후 nodejs.org의 LTS Windows 설치 파일(.msi, 기본 옵션 · "필요한 도구 자동 설치"는 끔). 없거나 22 미만이면 `update.ps1`이 **빌드 단계만 WARN으로 건너뛰고** 서버 업데이트는 그대로 함 |

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
   - (선택 — 2단계) `PAPERLAB_RELEASES_DIR=…` PC 앱 설치 파일 배포 폴더. 없으면 기본값 `D:\PaperLab\releases`
   - (선택 — 3단계 AI 질문) `PAPERLAB_EMBED_MODEL_DIR=<폴더>` 임베딩 모델을 놓는 폴더. 없으면 기본값 `D:\PaperLab\models\embeddinggemma-300m`. 아래 11절 "임베딩 모델"
   - (선택 — 5단계 국내 DB 검색) `KCI_API_KEY=…` · `RISS_API_KEY=…` 한 줄씩. **없으면(또는 비어 있으면) 그 소스만 꺼질 뿐 서버는 그대로 뜹니다.** 키 값은 **채팅에 적지 말고 메모장으로 파일에 직접** 넣습니다. 신청 · 설명은 14절
   - (선택 — 6단계 폴더 동기화) `PAPERLAB_SYNC_USER_CAP_MB=…`(사용자당 동기화 올리기 상한, 기본 2048) · `PAPERLAB_DB_LIMIT_MB=…`(Supabase DB 한도, 기본 500). **없으면 기본값으로 동작**하고 값은 비밀이 아니지만 파일은 5절 규칙대로 직접 고칩니다. 설명 · 반영 순서는 15절
   - (선택 — 서재 문서 넣기) `PAPERLAB_SOFFICE=<soffice.exe 전체 경로>` LibreOffice를 기본 위치(`C:\Program Files\LibreOffice`)가 아닌 곳에 깔았을 때만. 17절
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
- **HSTS 주의**: PaperLab은 모든 응답에 `Strict-Transport-Security: max-age=31536000`(1년, includeSubDomains 없음)을 보냅니다. 공개 주소를 한 번 연 브라우저는 1년 동안 같은 호스트 이름(`kimjuhyeon.tailac17f6.ts.net`)을 **https로만** 엽니다 — 이 이름의 다른 포트로 `http://` 서비스를 띄우면 그 브라우저에서는 https로 바뀌어 열리지 않습니다. 되돌리려면 그 브라우저의 `chrome://net-internals/#hsts`(Edge는 `edge://net-internals/#hsts`) → *Delete domain security policies*에 이름을 넣어 지우거나, 서버가 `max-age=0`을 보내도록 바꾼 뒤 https로 한 번 접속합니다.

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

1. Supabase 운영 프로젝트 → Authentication → URL Configuration: **Site URL**과 **Redirect URLs**에 `https://kimjuhyeon.tailac17f6.ts.net/`. 2단계(PC 앱)부터는 **Redirect URLs에 `paperlab://auth-callback`도 추가**합니다(2단계 명세 K10 ①). 빠지면 PC 앱 로그인이 브라우저의 웹 화면에서 끝나고 앱으로 돌아오지 않습니다(Supabase가 허용 안 된 주소 대신 Site URL로 보냄).
2. Cloudflare R2 버킷 → Settings → CORS: `AllowedOrigins`에 `https://kimjuhyeon.tailac17f6.ts.net`(값 전체는 명세 20장 관리자 절 JSON).
3. 관리자 PC에서 바탕화면 바로가기: `powershell -ExecutionPolicy Bypass -File deploy\make-shortcut.ps1` (주소는 `server.json`에서 읽음 — `-Url`은 다른 주소를 쓸 때만)
4. Google Cloud 프로젝트는 PaperLab 서버로 더 쓰지 않지만, **Google 로그인(OAuth) 클라이언트가 그 프로젝트에 있으면 지우면 안 됩니다**(확인 필요).

## 11. 일상 운영

| 하고 싶은 일 | 방법 |
|---|---|
| 새 버전 반영 | 팀장이 승인 · 푸시를 알리면 `powershell -ExecutionPolicy Bypass -File deploy\server-pc\update.ps1` (아래 "업데이트 동작"). **서버 PC가 `f9e748e`(1C)처럼 옛 커밋이면 처음 한 번은 옛 `update.ps1`이 끝까지 돌아 `-BuildDesktop`을 모르고 빌드 단계도 없습니다 → `update.ps1 -Yes` 뒤 `update.ps1 -BuildDesktop`을 따로 실행(16절).** 먼저 `-DryRun`으로 반영할 커밋을 볼 수 있음(**`git fetch`만 함** — 원격 추적 브랜치 · `FETCH_HEAD` · 객체 · 태그 갱신, 작업 폴더 · HEAD · 브랜치 · 서버 · 로그는 그대로. 미리 fetch할 필요 없음), `-Yes`는 확인 질문 생략 |
| 특정 커밋으로 되돌리기 | `update.ps1 -Ref <커밋>` — 옛 커밋으로 갈 때는 마이그레이션을 하지 않음(DB 마이그레이션은 되돌리지 않음). **앱 0.3.0 이상(지금 0.3.1)이 배포된 뒤 `f9e748e`로 되돌리면 앱의 워커와 동기화가 연결되지 않고, 휴지통 논문은 옛 코드에서 보이지 않습니다**(15.2절 · 16절 9번) |
| `cloud.env`를 고친 뒤 | `update.ps1 -RestartOnly` (코드는 그대로, 서버만 다시 시작 → 상태 확인) |
| KCI · RISS 키 넣기 · 바꾸기(5단계) | **[사용자]** 가 메모장으로 `cloud.env`의 `KCI_API_KEY` · `RISS_API_KEY` 줄을 고침(값은 채팅에 적지 않음) → `update.ps1 -RestartOnly`. 확인: 로그인해서 논문 찾기의 소스 목록에서 그 소스의 "(키 등록 전)" 표시가 사라졌는지(`serve --check`는 이 두 변수를 점검하지 않음). 자세한 내용 14절 |
| 폴더 동기화 한도 바꾸기(6단계) | `cloud.env`에 `PAPERLAB_SYNC_USER_CAP_MB=2048`(사용자당 동기화 올리기 상한 — 내 PDF 총량 · 휴지통 포함, 기본 2048) · `PAPERLAB_DB_LIMIT_MB=500`(DB 한도 — 90%를 넘으면 동기화 새 논문 올리기를 막음, 기본 500) → `update.ps1 -RestartOnly`. DB 크기 확인 · PGroonga 정리는 `.venv\Scripts\python -m paperlab.admin maintain`(전 · 후 크기만 출력) |
| PC 앱 설치 파일 처음 만들기 · 지난 빌드 실패 뒤 다시 | `update.ps1 -BuildDesktop` — 새 커밋이 없어도 9번 빌드만 함(그 버전 파일이 이미 `releases`에 있으면 WARN만). 결과는 `update.log`의 "데스크톱 앱 빌드 성공: 버전 … · sha256 …". **옛 커밋(`f9e748e` 등)에서 처음 올릴 때는 `update.ps1 -Yes`가 끝난 뒤에 실행**합니다 — 새 스크립트가 있어야 이 옵션이 먹습니다(옛 스크립트는 매개변수 오류, 16절) |
| 사용자 추가 · 빼기 | **[사용자]** Google Cloud 콘솔 → OAuth 동의 화면 → 테스트 사용자에서 추가 · 삭제(서버 재시작 필요 없음). 뺄 때는 Supabase 대시보드 Users에서 그 사용자도 삭제 |
| 서버만 다시 시작 | `Stop-ScheduledTask "PaperLab Server"; Start-ScheduledTask "PaperLab Server"` |
| 로그 보기 | `Get-Content D:\PaperLab\logs\server.log -Tail 50` (JSON 한 줄씩 — 토큰 · 키 · 본문은 원래 남지 않음) |
| 주간 점검(주 1회) | `watchdog.log`의 WARN 줄, `Get-ScheduledTaskInfo "PaperLab Backup"`의 마지막 결과, `funnel.ps1 status`, `D:\PaperLab\study99web`에서 `.venv\Scripts\python -m paperlab.admin cache-stats`로 공용 캐시 크기 확인(크기 · 행 수만 나옴 — 150MB 넘으면 `cache-prune --max-mb 150`, [1B 명세](../../docs/specs/citation-graph.md) 8.5절), **[사용자]** Google OAuth 동의 화면 게시 상태가 "테스트"인지 |
| (선택) 허용 목록 켜기 | `cloud.env`에 `PAPERLAB_ALLOWLIST=on` · `ALLOWED_EMAILS=…` → `sync-allowlist` → **[사용자]** Supabase Auth Hook "Before User Created"에 `paperlab.before_user_created` 연결 → `update.ps1 -RestartOnly` (명세 6.3절) |
| 앱 역할 비밀번호 회전 | `.venv\Scripts\python -m paperlab.admin app-role --write-env`(`--if-missing` 없이 — 새 비밀번호, 값 출력 없음) → 곧바로 `update.ps1 -RestartOnly`. 백업 작업은 실행할 때마다 파일을 새로 읽으므로 할 일 없음 |
| 암호화 키 회전 | 명세 8.3절 순서(서버 멈춤 → `cloud.env` 새 키 → `admin rotate-key` → 서버 시작) |
| Windows 계정 비밀번호를 바꾼 뒤 | 작업 3개의 저장된 비밀번호도 바꿔야 함 — `install.ps1 -ReRegisterTasks -SkipFunnel`(자격 증명 창에 **[사용자]** 가 새 비밀번호 입력) |
| 급히 공개를 막기 | `funnel.ps1 off` (서버는 계속 돌지만 바깥에서 못 들어옴) |
| 임베딩 모델 받기(3단계 AI 질문 · 처음 한 번) | `D:\PaperLab\study99web`에서 서버 계정으로 `.venv\Scripts\python -m paperlab.admin rag-model --download` → `update.ps1 -RestartOnly`. 아래 "임베딩 모델". **3단계 코드를 반영한 뒤에 받습니다 — 옛 코드(`f9e748e`)에는 `rag-model` 명령이 없습니다** |
| 색인 처음부터 다시(모델 · 규칙을 바꾼 뒤) | `.venv\Scripts\python -m paperlab.admin rag-reindex --all` — 모든 논문이 '색인 대기'가 되고, 사용자가 AI 질문 화면을 열 때 차례로 다시 색인(옛 벡터 파일은 교체 때 지워짐) |
| 문서 변환기 확인 · 바꾸기(서재 문서 넣기) | 서버 시작 줄(`server.log`)의 `"converter": true` 확인. LibreOffice를 다른 곳에 깔았으면 `cloud.env`에 `PAPERLAB_SOFFICE=<soffice.exe 전체 경로>` → `update.ps1 -RestartOnly`. LibreOffice · H2Orestart · Java를 업데이트한 뒤에는 할 일 없음(다음 변환부터 새것). 자세한 내용 17절 |
| 복원 | `deploy/README.md` 4장 복원 절차 |
| 제거 | `deploy\server-pc\uninstall.ps1`(작업 삭제 · Funnel 끔, `-DryRun` 가능). 저장소 · `cloud.env`는 **[사용자]** 가 직접 지움 |

**업데이트 동작(`update.ps1`, 명세 13.8절)** — 로그 `D:\PaperLab\logs\update.log`

1. `git fetch` → 배포 브랜치의 새 커밋 목록 → 확인(`-Yes`면 생략). 새 커밋이 없으면 끝. **`-DryRun`도 이 `git fetch`는 실제로 함**(fetch만 함 — 원격 추적 브랜치 `origin/…` · `FETCH_HEAD` · 객체 · 태그 갱신, 작업 폴더 · HEAD · 브랜치는 그대로) — 그래야 반영할 커밋 목록이 맞음. 그 뒤 단계(코드 반영 · pip · 마이그레이션 · 재시작)는 `[DRY]` 줄로 보여 주기만 하고, `update.log`도 쓰지 않음.
2. 작업 폴더에 고친 파일이 있거나, 지금 브랜치가 배포 브랜치가 아니거나, 앞으로만 갈 수 없으면(ff-only 불가) **시작하지 않음** → 팀장에게 보고.
3. 코드 반영(`git merge --ff-only`, `-Ref`면 그 커밋으로) → `pyproject.toml`이 바뀌었으면 `pip install -e .`. **여기서 실패하면**(pip 오류 등) 6번처럼 **옛 커밋으로 되돌리고(`pyproject.toml`이 바뀐 경우 옛 의존성 다시 설치) 서버를 다시 시작 · 확인**, 마이그레이션은 하지 않음. 종료 코드 1.
4. 마이그레이션(`paperlab.migrate`) → `admin sync-allowlist`. **여기서 실패하면**(DB 오류 · **Supabase 일시정지** 포함) **코드만 옛 커밋으로 되돌리고 서버는 다시 시작하지 않음** — 서버는 옛 코드로 계속 돎. 종료 코드 1. **마이그레이션 파일마다 트랜잭션 안에서 `lock_timeout` 10초가 걸립니다**(2026-10-14): 서버 요청이 잡고 있는 표 잠금을 10초 안에 얻지 못하면 그 파일은 **실패**(그 파일만 롤백 — 기록 없음, 앞서 끝난 파일은 남음)하고 위처럼 **코드가 되돌아갑니다**. 서버가 표 잠금을 오래 기다리며 뒤 요청을 줄 세워 멈추는 것을 막으려는 장치이므로 고장이 아닙니다 — **사용자가 적은 시간(새벽 등)에 `update.ps1`을 다시 실행**합니다(두 번 돌려도 안전).
5. 서버 작업 다시 시작 → `http://127.0.0.1:8080/api/health?deep=1`이 정상이고 응답의 커밋이 새 커밋인지 60초 동안 확인.
6. **확인 실패면 자동으로 옛 커밋으로 되돌리고 다시 시작**(마이그레이션은 되돌리지 않음). `deep=1`은 DB까지 보므로 **반영 중 Supabase가 일시정지돼 있으면 이 단계에서도 되돌림**이 일어남 — Supabase를 Restore한 뒤 다시 업데이트. 되돌린 뒤에도 정상이 아니면 오류로 남기고 팀장에게 보고.
7. **관리자 권한(elevated)으로 실행하면** 시작할 때 WARN 한 줄을 화면과 `update.log`에 남기고 그대로 진행: "관리자 권한으로 실행 중: 새로 받는 파일의 소유자가 Administrators가 되지만, 상속 권한으로 서버 계정이 접근할 수 있어 동작에는 영향이 없습니다. 가능하면 일반 권한 PowerShell에서 실행하세요." **소유자 · 권한은 바꾸지 않음**(`icacls` 쓰지 않음 — 팀장 결정). 일반 권한이면 이 줄도 없음.
8. 결과(옛 → 새 커밋)를 `update.log`에 남김.
9. **PC 앱 설치 파일 빌드**(2단계 명세 13.7.1절 — 5번 상태 확인까지 **성공한 뒤에만**, 빌드 중에도 서버는 새 코드로 돎): 이번 반영에서 `desktop\`이 바뀌었으면(또는 `-BuildDesktop`) `node` · `npm`(22 이상) 확인 → `desktop\`에서 `npm ci` → `npm run dist`(electron-builder NSIS, **20분 제한** — `-BuildTimeoutSec`). Electron · NSIS · npm 캐시는 `D:\PaperLab\cache\`(첫 빌드만 수백 MB를 받음). 결과는 `releases`(`cloud.env`의 `PAPERLAB_RELEASES_DIR` — 서버가 읽는 폴더와 같은 규칙, 없으면 `D:\PaperLab\releases`)의 `.staging`에서 `latest.yml`의 sha512 · 크기를 실제 `.exe`와 다시 맞춰 본 뒤 `.exe` → `.blockmap` → `release.json`(sha256) → **`latest.yml`(마지막, 교체)** 순서로 옮기고 **최근 3개 버전**만 남김. 빌드 로그 전체는 `D:\PaperLab\logs\desktop-build-<시각>.log`, `update.log`에는 성공 줄(버전 · sha256 · 걸린 초)과 빌드 로그의 서버 주소 한 줄. **빌드는 어느 단계에서 실패해도 WARN만 남기고 이전 설치 파일을 그대로 두며 종료 코드는 서버 결과대로(성공 0)**. `-Ref` · `-RestartOnly` · 6번에서 되돌린 경우에는 빌드하지 않음(앱은 다운그레이드하지 않음). `desktop\`이 바뀌었는데 `desktop\package.json` 버전이 이미 `releases`에 있으면 빌드하지 않고 WARN(같은 버전 이름으로 다른 내용을 내보내지 않음 — 개발팀에 버전을 올려 달라고 보고). **처음 반영 때는 이 단계가 돌지 않습니다**: 서버 PC가 옛 커밋이면 옛 `update.ps1`이 끝까지 돌고(빌드 단계 · `-BuildDesktop` 없음), 그래서 `update.ps1 -Yes` 뒤에 `update.ps1 -BuildDesktop`을 따로 실행합니다(16절).
10. **임베딩 모델 확인**(3단계): 5번 상태 확인까지 성공하면 `admin rag-model`로 모델 파일이 있는지(SHA-256까지) 봄. 없거나 틀리면 **WARN만**(서버는 낱말 검색만으로 동작, 종료 코드 영향 없음) — 아래 "임베딩 모델"대로 받음. (번호는 스크립트 주석을 따름 — 실제 실행은 10번 확인이 먼저, 9번 빌드가 나중입니다.)

**서버 PC에는 PaperLab PC 앱(워커)을 설치하지 않습니다**(사용자 결정 Q-S3) — 이 PC는 설치 파일을 만들어 `/downloads/`로 내보내기만 합니다.

**임베딩 모델**(3단계 명세 6.3절 — EmbeddingGemma-300M ONNX, 약 330MB)

- 받는 곳: Hugging Face 공식 저장소 `onnx-community/embeddinggemma-300m-ONNX`, **고정 커밋 `5090578`**. 받는 파일은 `onnx/model_quantized.onnx` · `onnx/model_quantized.onnx_data` · `tokenizer.json` 세 개뿐이고, 받은 뒤 코드에 적힌 SHA-256과 맞는지 확인합니다(틀리면 지움).
- 이 저장소는 **게이트(동의 · 로그인)가 없습니다**(2026-10-08 확인). 모델은 Gemma 이용 약관(https://ai.google.dev/gemma/terms)을 따릅니다 — 서버 PC 안에서 검색용 임베딩으로만 씁니다.
- 놓는 곳: `D:\PaperLab\models\embeddinggemma-300m\`(다른 곳이면 `cloud.env`에 `PAPERLAB_EMBED_MODEL_DIR=<폴더>`). **저장소(git)에는 넣지 않습니다.**
- 실행 패키지 `onnxruntime` · `tokenizers` · `numpy`는 `pyproject.toml`에 있어 `update.ps1`의 `pip install -e .`이 설치합니다.
- 모델이 없으면 서버는 그대로 뜨고 AI 질문 화면에 "지금은 낱말 검색만 해요"가 보입니다. 모델을 받은 뒤 `update.ps1 -RestartOnly` → 모델 없이 색인된 논문은 다음에 AI 질문을 열 때 다시 색인됩니다.
- 서버 시작 줄(`server.log`)의 `"embed": true`로 확인합니다.

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
| PC 앱 로그인이 브라우저 웹 화면에서 끝나고 앱으로 안 돌아옴 | Supabase Redirect URLs에 `paperlab://auth-callback`이 있는지 | **[사용자]** 추가(10절 1번) → 앱에서 다시 로그인 |
| PDF 업로드 · 보기 CORS 오류 | R2 CORS | 10절 2번 |
| 백업 실패 | `backup.log`(값 없이 오류만), `admin pg-dump-check`, `admin latest-backup` | "pg_dump를 찾지 못했어요" → `PAPERLAB_PG_DUMP`(4절). 버전 오류 → PostgreSQL 클라이언트를 운영 DB 주 버전 이상으로. "SUPABASE_APP_DB_URL 이 비어 있어요" → `admin app-role --write-env --if-missing` |
| 업데이트가 "마이그레이션 단계"에서 실패 · 되돌림 | `update.log`, Supabase 대시보드 | Supabase 일시정지면 **[사용자]** Restore 후 다시 `update.ps1`. 그 밖이면 팀장에게 보고(서버는 옛 코드로 계속 돎) |
| 마이그레이션 실패 문구가 "표 잠금을 10s 안에 얻지 못했어요(서버 요청이 잡고 있음 — 잠시 뒤 다시)" | `update.log`의 `paperlab.migrate` 오류 줄 | `lock_timeout` 10초 초과(11절 4번) — 코드는 이미 옛 커밋으로 되돌아가 서버는 정상. **사용자가 적은 시간에 `update.ps1`을 다시** 실행. 같은 곳에서 계속 실패하면 팀장 보고(서버 PC에서 SQL을 직접 보내지 않음) |
| "정션 · 심볼릭 링크라 지우지 않았어요: …" 오류로 스크립트가 멈춤 | 적힌 경로(`dist` · `.staging` · 설치 `.venv`)가 정션 · 심볼릭 링크인지(`Get-Item <경로> \| Select Attributes`) | `Remove-PLTree`의 안전 장치(13절) — 링크 대상의 내용이 지워지는 것을 막으려고 멈춘 것. 링크를 **직접 확인**하고 필요하면 **[사용자]** 가 링크만 제거한 뒤 다시 실행(링크 안의 내용은 지우지 않음). 팀장 보고 |
| `update.log`에 "데스크톱 앱 빌드 실패(…)" WARN | 같은 줄의 단계 · 이유, 적힌 `desktop-build-<시각>.log`(마지막 줄들) | 서버 업데이트는 정상(이전 설치 파일 그대로). 인터넷 끊김 · 디스크 부족이면 고친 뒤 `update.ps1 -BuildDesktop`. 그 밖(코드 · 설정 오류)은 빌드 로그 이름과 함께 팀장에게 보고 — 서버 PC에서 고치지 않음 |
| "버전이 같아 빌드하지 않았어요" WARN | `desktop\package.json`의 `version` | 개발팀에 버전을 올린 커밋을 요청(서버 PC에서 고치지 않음) |
| "Node.js 22 이상 · npm 이 없어 … 건너뛰어요" WARN | `node -v` · `npm -v` | 4절 Node.js LTS 설치 → `update.ps1 -BuildDesktop` |
| 논문 찾기에서 KCI · RISS가 "키 등록 전"으로 흐리게 보임 | 그 키 줄이 `cloud.env`에 있는지(**[사용자]** 가 메모장으로 — Claude Code는 내용을 읽지 않음), 넣은 뒤 서버를 다시 시작했는지 | 14절 — 키가 없으면 정상 동작(그 소스만 꺼짐). 넣었다면 `update.ps1 -RestartOnly` |
| KCI · RISS 검색이 "키가 맞지 않거나 사용기간이 끝났어요"(관리자에게 알려 달라는 문구) | 키 유효기간 · 철자(**[사용자]** 가 신청처에서 확인 — 값은 채팅에 적지 않음) | 새 키를 받아 `cloud.env`에 직접 넣고 `update.ps1 -RestartOnly`. 서버 코드 문제가 아님 |
| 워드 · 한글 · PPT를 올리면 "서버에 문서 변환기(LibreOffice)가 없어…" | 서버 시작 줄의 `"converter"`, `Test-Path 'C:\Program Files\LibreOffice\program\soffice.exe'` | 4절 LibreOffice 설치, 다른 경로면 `PAPERLAB_SOFFICE`(17절) → `update.ps1 -RestartOnly`. PDF · 사진(JPG · PNG 등)은 변환기 없이도 올라감 |
| 한글(.hwp · .hwpx)만 "문서를 PDF로 바꾸지 못했어요" (워드는 됨) | `unopkg.com list --shared`에 H2Orestart, `java -version` | 4절 — H2Orestart를 **`--shared`로** 다시 설치 · Java(Temurin 21) 설치. 서버 재시작은 필요 없음 |
| 문서 올리기가 오래 "PDF로 바꾸는 중…"에 머묾 · 다음 문서도 안 됨 | `Get-Process soffice* \| Select Id, StartTime` | 한 파일 180초가 넘으면 서버가 그 변환을 끝냄(오류 "PDF로 바꾸지 못했어요"). 그래도 오래된 `soffice.bin`이 남아 있으면 그 프로세스만 끝내고(`Stop-Process -Id <Id>`), 계속되면 `%TEMP%\paperlab-soffice-profile` 폴더를 지운 뒤 다시(다음 변환 때 새로 만듦) — 그래도 안 되면 팀장 보고 |
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
| `deploy/server-pc/update.ps1` | 11절 업데이트 동작 · `-Ref` · `-Yes` · `-RestartOnly` · `-DryRun`(`git fetch`만 함) · `-TimeoutSec`(기본 60) · **`-BuildDesktop`**(9번 PC 앱 빌드만 다시 — 새 커밋 없어도. 옛 커밋에서 처음 올릴 때는 `-Yes` 반영이 끝난 뒤에 실행 — 16절) · `-BuildTimeoutSec`(기본 1200) · `-ReleasesDir` · `-CacheDir`(시험용 — 기본은 `PAPERLAB_RELEASES_DIR` 규칙 · `D:\PaperLab\cache`). 반영 뒤 단계(pip 포함)가 실패하면 옛 커밋으로 되돌림. 관리자 권한으로 돌면 시작할 때 WARN 한 줄만(소유자는 바꾸지 않음 — 11절 7번) |
| `deploy/server-pc/funnel.ps1` | `on`(`tailscale funnel --bg 8080`) · `status` · `off`, `-DryRun`. `tailscale`는 PATH → `Program Files\Tailscale` 순으로 찾음 |
| `deploy/server-pc/watchdog.ps1` | 5분마다: `/api/health` 3번 연속 실패면 서버 재시작(1시간 3번까지, 넘으면 경고만). 하루 한 번: 공개 주소 · 최근 백업(36시간) · 디스크 여유(시스템 5GB · 데이터 20GB) → `watchdog.log`(1MB × 5). **`-DryRun`은 아무것도 바꾸지 않음**(작업 재시작 없이 `[DRY]` 기록만 — 품질팀 F3, 개발팀 수정). `-SkipDaily` · `-StateFile` · `-MaxRestartsPerHour` 등은 시험용 |
| `deploy/server-pc/uninstall.ps1` | 작업 삭제 · Funnel 끔(`cloud.env` · 저장소는 지우지 않는다고 알림) |
| `deploy/server-pc/common.ps1` | 다른 스크립트가 함께 쓰는 함수(설정 읽기 · 로그 · 권한 · 관리자 권한 확인 · 상태 확인). **폴더 삭제 안전 검사 `Remove-PLTree`**(2026-10-14): 폴더를 통째로 지우는(`-Recurse`) 곳은 이 함수 하나뿐이며(앱 빌드 `dist` · `.staging` · 설치의 `.venv` 다시 만들기), **지울 경로가 정션 · 심볼릭 링크(대상이 없는 정션 포함)면 지우지 않고 멈춥니다**(Windows PowerShell 5.1의 `Remove-Item -Recurse`는 링크를 따라 들어가 대상 폴더의 내용을 지울 수 있음). 없는 경로는 그냥 지나감. 폴더 **안쪽**의 정션은 검사하지 않음(PLAN.md 12장 남은 일 14번 — 수용 여부는 팀장 확인) |
| `deploy/server-pc/server.json` | 공개 주소 · 포트 · 루트 · 브랜치 · 작업 이름(비밀 없음 — 주소를 두는 한 곳) |
| `python -m paperlab.serve` | 서버 실행. `--check`(설정 점검, 이름만) · `--before-app-role` · `--log-dir` · `--diag-hang-file`(진단 스위치 — 9절 17번) |
| `python -m paperlab.admin app-role --write-env [--if-missing]` | 앱 역할 주소를 `cloud.env`에 씀(`--if-missing`: 이미 있으면 그대로) |
| `python -m paperlab.admin backup --tmp-dir <폴더>` | 백업(앱 역할 주소 + `pg_dump`, 임시 파일 정리) |
| `python -m paperlab.admin pg-dump-check` | `pg_dump` 주 버전 ≥ DB 서버 주 버전인지(앱 역할 주소로 버전만 읽음) |
| `python -m paperlab.admin rag-model [--download] [--dir <폴더>]` | 3단계 임베딩 모델 파일 확인(SHA-256 — 없거나 틀리면 종료 코드 2) · `--download`면 Hugging Face 공식 저장소(고정 커밋)에서 받음 |
| `python -m paperlab.admin rag-reindex --all` | 모든 논문을 색인 대기로(3단계 10.3절) |
| `python -m paperlab.admin maintain` | 6단계 DB 정리: `extensions.pgroonga_vacuum()` 실행 + **전 · 후 `pg_database_size` 출력**(관리자 주소 — 테스트 표지 DB는 거부). 15.3절 |
| `python -m paperlab.admin orphans [--delete]` | DB에 없는 R2 PDF와 벡터 파일(`users/*/rag/*.bin`) 찾기 · 지우기 |
| `python -m paperlab.admin latest-backup [--max-hours 36]` | R2의 가장 최근 백업 날짜(없거나 기한 넘으면 종료 코드 2) |
| `tools/record_extsources.py [--env-file <경로>] [--only kci,riss,epmc,oc,openalex]` | 5단계 녹화 도구 — **관리자가 키로 한 번** 실행(14절). 서버 PC 설치 · 업데이트와 무관 |

## 14. 5단계 국내 DB 검색 — 키 · 녹화 도구 · 반영 순서

근거: [5단계 명세](../../docs/specs/phase5-korean-db.md) 4 · 13 · 14 · 16장. 이 절은 **관리자(사람)가 할 일**이 대부분이라 Claude Code는 안내만 하고 값을 받거나 읽지 않습니다(0절 1 · 2번).

### 14.1 `cloud.env` 새 변수 (선택)

| 변수 | 뜻 | 없으면 |
|---|---|---|
| `KCI_API_KEY` | KCI(한국연구재단 학술지 인용색인) Open API 공용 인증키 하나 — 모든 사용자가 같이 씀 | **KCI만 비활성**(논문 찾기 소스 목록에 "KCI (키 등록 전)") |
| `RISS_API_KEY` | RISS(KERIS) 검색 API 공용 키 하나 | **RISS만 비활성** — 1A의 `[RISS]` 검색 바로가기는 그대로 동작 |
| `SCIENCEON_API_KEY` · `SCIENCEON_CLIENT_ID` · `SCIENCEON_MAC_ADDRESS` | ScienceON(KISTI) 인증키 · client id · 신청할 때 등록한 서버 PC MAC 주소(`9C-6B-…` 처럼 대문자 · 하이픈). 액세스 토큰(약 2시간)은 서버가 알아서 받음 | **ScienceON만 비활성**. MAC이 다르면(랜카드 교체 등) 검색이 "키가 맞지 않아요"로 실패 → ScienceON에서 MAC 다시 등록 |

- **둘 다 선택 항목**입니다. 없어도 서버는 정상으로 시작하고, Europe PMC(키 없음)와 기존 소스는 그대로 씁니다. 한쪽만 넣어도 됩니다.
- **값은 채팅에 적지 않습니다.** **[사용자]** 가 서버 PC에서 메모장으로 `C:\Users\USER\.paperlab\cloud.env`를 열어 `KCI_API_KEY=…` · `RISS_API_KEY=…` 줄을 직접 넣고 저장합니다(5절과 같은 방식). 관리자 PC의 `cloud.env`에도 같은 줄이 있어야 녹화 도구(14.3절)가 키를 읽습니다. Claude Code는 파일을 열지 않고, 확인은 서버를 다시 시작한 뒤 화면에서 합니다.
- 넣은 뒤: `update.ps1 -RestartOnly` → 로그인해서 **논문 찾기** 소스 목록에서 그 소스의 "(키 등록 전)"이 사라졌는지 봅니다. (`serve --check`는 이 두 변수를 점검하지 않고, `GET /api/sources`는 키 값을 돌려주지 않고 켜짐 · 꺼짐만 돌려줍니다.)
- 키에는 **사용기간**이 있을 수 있습니다(KCI는 오류 "사용기간이 종료되었습니다" 확인됨). 끝나면 KCI · RISS 검색이 "키가 맞지 않거나 사용기간이 끝났어요"를 보입니다 → 새 키를 받아 같은 줄을 바꾸고 `update.ps1 -RestartOnly`.
- 키는 요청 주소의 `key=` 쿼리로 가므로 서버 로그 · 오류 문구에는 남기지 않게 되어 있습니다(주소 · 검색어 · 키 없음). 로그를 팀장에게 보고할 때도 키 값은 적지 않습니다.
- RISS는 `https`를 지원하는지 **아직 확인하지 못했습니다**(14.3절 녹화로 확인). http만 되면 키가 평문으로 가므로 **팀장에게 보고**하고 RISS 키는 넣지 않습니다.

### 14.2 키 신청 (관리자 몫 — Claude Code가 대신 신청하지 않음)

요약이며 정확한 절차 · 서류는 신청 화면에서 확인합니다(명세 4.1 · 4.2 · 16.3절 — 일부는 2차 자료라 **확인 필요**).

| 키 | 어디서 | 요약 |
|---|---|---|
| KCI | KCI 포털(kci.go.kr)의 Open API **"키신청"** 메뉴(로그인 뒤 화면) | 회원가입 → 신청서 → 한국연구재단에 공문(2차 자료: kciadmin@nrf.re.kr)이라는 안내가 있음. **개인 발급 가능 여부 · 승인 기간 확인 필요.** 키에 사용기간이 있음 |
| RISS | RISS API 센터(riss.kr → API 센터) 이용신청 | **심사 후 승인.** 이용 대상 안내가 "비영리 기관(대학)"이라 **개인은 안 될 수 있음.** 못 받으면 **RISS는 1A 검색 바로가기만** 쓰면 됨(사용자 결정 U-2 — 앱은 그대로 동작). 이용 허락 범위 BY-NC-ND(출처 표시, 영리 · 2차 저작 불가) |

- 신청서의 **용도**에 "소규모(3~5명) 연구 그룹 내부 도구에서 검색 결과를 표시하고 개인 서재에 저장"을 적고, 이용 조건에 맞는지 **회신으로 확인**합니다(명세 15장). 확인한 내용(호출 한도 · 사용기간 · 저장 허용 여부)은 팀장에게 알려 명세 4장에 반영합니다.
- 키는 받는 즉시 **관리자 PC와 서버 PC의 `cloud.env`에 직접** 넣습니다(14.1절). 메일 · 메신저 · 이 대화에 붙이지 않습니다.

### 14.3 녹화 도구 `tools/record_extsources.py` (관리자가 키로 한 번)

자동 테스트는 실제 외부 서비스를 부르지 않고 **저장된 응답 파일(녹화 픽스처)** 만 읽습니다. 지금 KCI · RISS 픽스처는 공식 명세를 본뜬 **손 픽스처**라, 키를 받은 뒤 진짜 응답으로 바꾸고 추정한 값(KCI 응답 칸 이름 · RISS https · OpenAlex `license` 실제 값 · Europe PMC `core` 필드)을 확인하는 데 씁니다(명세 16.3절 · AC-5R3).

```powershell
# 관리자 PC의 저장소 작업 폴더에서 (서버 PC 저장소에서는 실행하지 않음 — 0절 3번: 이 PC에서 커밋하지 않음)
.venv\Scripts\python.exe tools\record_extsources.py
# 일부만: --only kci,riss,epmc,oc,openalex   |  다른 비밀값 파일: --env-file <경로>
```

- **한 번만, 관리자가 손으로** 실행합니다. 자동 테스트 · CI · 서버 업데이트에서 돌지 않고, Claude Code가 임의로 실행하지 않습니다(실제 KCI · RISS · Europe PMC · OpenCitations · OpenAlex에 요청을 보냄).
- 키는 `cloud.env`(기본 `%USERPROFILE%\.paperlab\cloud.env`)의 `KCI_API_KEY` · `RISS_API_KEY`에서 읽고 **값은 출력하지 않습니다.** 키가 없는 소스는 건너뜁니다(RISS는 키가 있을 때만). Europe PMC · OpenCitations · OpenAlex는 키가 없어도 받습니다.
- 정해 둔 질의(국문 2 · 영문 1 · DOI 5편)로 받은 **응답 본문만** `tests\fixtures\extsources\`에 저장하고, 요청 주소 · 헤더는 버립니다. 각 파일 옆 `*.meta.json`에는 받은 날짜 · 소스 · 질의 종류만 있습니다.
- **결과 픽스처에 키가 들어가지 않습니다**: 본문에 **키 문자열이 있으면** 그 파일은 **저장하지 않고 멈춥니다**(멈추면 팀장에게 알려 주세요 — 어느 파일에서 멈췄는지는 화면에 나옴, 키 값은 안 나옴). **이메일 모양 문자열**(저자 연락처 등)은 멈추지 않고 `redacted@example.invalid`로 바꿔 저장합니다(그래서 픽스처에 이 가짜 주소가 보여도 정상입니다).
- 끝에 OpenAlex `license` 값별 개수가 출력됩니다(허용 목록 `cc-by` · `cc-by-sa` · `cc-by-nc` · `cc-by-nd` · `cc-by-nc-sa` · `cc-by-nc-nd` · `cc0` · `public-domain` 밖의 값이 있으면 **팀장에게 보고**). 이 출력에는 비밀이 없습니다.
- 만들어진 파일은 개발팀이 검토해 저장소에 넣습니다. **서버 PC에서는 커밋 · 푸시하지 않습니다.**

### 14.4 반영 순서 (5단계 코드를 서버 PC에 올릴 때)

팀장이 승인 · 푸시를 알리면 11절 `update.ps1`로 반영합니다. 이 변경에는 **DB 마이그레이션 `20261014000001_external_sources.sql`**(공용 캐시 `external_works.oa_license` 열 추가 + `citation_edges` 출처에 `opencitations` 허용)이 들어 있어, **DB가 먼저 바뀐 뒤에 새 코드가 실행되어야** 합니다. 새 코드는 이 열을 읽고 쓰기 때문입니다.

1. **마이그레이션 `20261014000001`** — `update.ps1`이 코드 파일을 받은 뒤 `paperlab.migrate`로 적용합니다(11절 "업데이트 동작" 4번). 새 열은 비어 있어도 되고(null) 옛 코드와도 호환되므로, 이 단계에서 실패해 되돌려도 서버는 옛 코드로 계속 돕니다.
2. **새 코드로 서버 다시 시작** — 마이그레이션이 끝난 **뒤에야** `PaperLab Server`가 다시 시작해 새 코드로 뜹니다(5번 상태 확인에서 `/api/health`의 커밋이 새 값이어야 통과).
3. (선택) KCI · RISS 키를 `cloud.env`에 넣고 `update.ps1 -RestartOnly`(14.1절) — 키는 코드 반영과 순서가 상관없습니다. 코드를 먼저 올려 두고 나중에 넣어도 됩니다(그동안 두 소스는 "키 등록 전").
4. (키를 받은 뒤) 녹화 도구(14.3절) → 개발팀이 픽스처 · 명세 확인 필요 항목 갱신.

- 수동으로 나눠 할 때: **새 코드를 먼저 받고**(`git fetch origin claude/paper-program-hrrhl2` → `git merge --ff-only origin/claude/paper-program-hrrhl2` → `.venv\Scripts\python -m pip install -e .`) → `.venv\Scripts\python -m paperlab.migrate` → `update.ps1 -RestartOnly`. 순서를 거꾸로(코드가 먼저 돌고 마이그레이션이 나중에) 하지 않습니다.
- 마이그레이션은 **되돌리지 않습니다**(11절). 문제가 생겨 `update.ps1 -Ref <옛 커밋>`으로 코드만 되돌려도 새 열 · 새 허용 값은 DB에 남지만 옛 코드와 호환됩니다.
- 설치 후 확인(9절)에는 변경이 없습니다. 반영 뒤 사람이 화면으로 보는 항목(명세 AC-585 · 586)은 팀장 · 품질팀 몫입니다.

## 15. 6단계 폴더 동기화 · 휴지통 — 새 설정값 · 반영 순서 · 관리자 작업

근거: [6단계 명세](../../docs/specs/phase6-folder-sync.md) 13 · 14 · 16.5 · 22장. **상태: 구현 완료 · 커밋됨(853c81e) — 서버 PC 미반영.** 팀장이 푸시를 알린 뒤에 11절 `update.ps1`로 반영합니다(2a~6단계를 한 번에 올리는 순서는 16절). 이 절의 DB 확인은 **관리자(사람)** 가 하고, Claude Code는 0절 4번대로 운영 DB에 직접 SQL을 보내지 않습니다(정해진 관리 명령만).

### 15.1 새 설정값 (`cloud.env` — 선택)

| 변수 | 뜻 | 기본값 | 없으면 |
|---|---|---|---|
| `PAPERLAB_SYNC_USER_CAP_MB` | **사용자당 동기화 올리기 상한**(MB). 기준 = 그 사용자의 PDF 총량(내 PDF + 휴지통 PDF). **동기화 올리기에만** 적용(웹 업로드는 기존 R2 95% 규칙만). 5명이 R2 무료 10GB를 나눠 쓰는 근사값 | 2048 (= 2GB) | 기본값 |
| `PAPERLAB_DB_LIMIT_MB` | **Supabase DB 한도**(MB). 이 값의 **90%**를 넘으면 동기화로 새 논문을 올리지 못함(첫 연결 미리보기 "DB 예산"의 기준). Supabase Pro로 올리면 그에 맞게 키움 | 500 (무료 한도) | 기본값 |

- 값은 **메모장으로 직접** 넣습니다(5절 방식 — 비밀값이 아니어도 `cloud.env`는 Claude Code가 읽지 않음). 비었거나 숫자가 아니면 기본값으로 동작합니다. 바꾼 뒤 `update.ps1 -RestartOnly`(11절 "폴더 동기화 한도 바꾸기" 줄과 같음).
- `serve --check`는 이 두 변수를 점검하지 않습니다(없어도 문제 아님).
- 1,000편(약 3GB)을 가진 사용자는 기본 2GB에 걸리므로, 관리자가 사용자와 합의해 `PAPERLAB_SYNC_USER_CAP_MB`를 올립니다(R2 10GB · 사용자 수를 같이 보고).

### 15.2 반영 순서 (6단계 코드를 서버 PC에 올릴 때)

이 변경에는 **DB 마이그레이션 `20261015000001_folder_sync.sql`**(`papers` · `folders` 새 열, 변경 로그 트리거 · 묘비, 휴지통 RLS 정책, 새 표 3개 `sync_tombstones` · `sync_devices` · `sync_ops`, **앱 역할 `paperlab_app`의 `idle_in_transaction_session_timeout = '60s'`**)이 들어 있어 **DB가 먼저 바뀐 뒤에 새 코드가 실행**되어야 합니다. 새 코드가 `deleted_at` · `sync_xid` 같은 새 열을 읽고 쓰기 때문입니다(5단계 14.4절과 같은 원칙).

1. **마이그레이션 `20261015000001`** — `update.ps1`이 코드 파일을 받은 뒤 `paperlab.migrate`(관리자 연결)로 적용합니다(11절 "업데이트 동작" 4번). 앱 역할 설정(`alter role … set`)도 이 단계에서 걸립니다. 두 번 돌려도 안전합니다. 여기서 실패하면 코드를 옛 커밋으로 되돌리고 서버는 옛 코드로 계속 돕니다.
2. **새 코드로 서버 다시 시작** — 마이그레이션이 끝난 **뒤에야** `PaperLab Server`가 새 코드로 뜹니다(5번 상태 확인에서 `/api/health`의 커밋이 새 값이어야 통과).
3. **앱 역할 idle 60s 적용 확인**(관리자 — 15.3절 1번). 서버가 뜬 뒤 한 번.
4. (선택) 설정값 넣기 → `update.ps1 -RestartOnly`(15.1절).
5. **PC 앱 배포(0.3.1)** — `update.ps1` 9번(11절)이 설치 파일을 빌드해 `releases`에 둡니다(`desktop\package.json` 버전 0.3.1). **다만 서버 PC가 `f9e748e`(1C) 같은 옛 커밋이면 처음 한 번은 옛 `update.ps1`이 끝까지 돌아 `-BuildDesktop`이 없어(매개변수 오류) 빌드 단계가 없습니다. 그러므로 `update.ps1 -Yes`가 끝난 뒤 `update.ps1 -BuildDesktop`을 따로 실행합니다(이때는 새 스크립트가 돎).** 두 번째 반영부터는 `desktop\`이 바뀌면 `update.ps1` 한 번으로 빌드까지 됩니다. 사용자 PC의 앱은 자동 업데이트로 올라오고, **동기화 워커 API는 앱 0.3.0 미만이면 426**(앱이 "업데이트가 필요해요"를 보임). 그 버전이 이미 `releases`에 있으면 빌드하지 않고 WARN만 남김(11절 9번 — 개발팀에 버전 요청). 동기화는 사용자가 앱에서 폴더를 고르고 [시작]을 눌러야 켜집니다(자동으로 켜지지 않음).

- 수동으로 나눠 할 때: **새 코드를 먼저 받고**(`git fetch origin claude/paper-program-hrrhl2` → `git merge --ff-only origin/claude/paper-program-hrrhl2` → `.venv\Scripts\python -m pip install -e .`) → `.venv\Scripts\python -m paperlab.migrate` → `update.ps1 -RestartOnly`. 코드를 받지 않고 `migrate`만 돌리면 옛 파일의 마이그레이션 목록으로 실행되어 새 마이그레이션이 적용되지 않습니다. 순서를 거꾸로(코드가 먼저 돌고 마이그레이션이 나중에) 하지 않습니다. 수동 반영은 자동 되돌림이 없고 빌드도 하지 않으므로 앱 설치 파일은 `update.ps1 -BuildDesktop`으로 따로 만듭니다.
- 마이그레이션은 **되돌리지 않습니다**(11절). `update.ps1 -Ref <옛 커밋>`으로 코드만 되돌리면 새 열 · 표는 DB에 남지만, 옛 코드는 휴지통을 모르므로 **이미 휴지통에 있는 논문은 옛 코드에서 보이지 않고**(데이터는 DB · R2에 남음) 옛 코드의 [삭제]는 다시 바로 지우는 방식입니다. 새 코드로 다시 올리면 돌아옵니다. **앱 0.3.0 이상(지금 0.3.1)이 배포된 뒤 `f9e748e`로 되돌리면 앱의 워커와 동기화가 연결되지 않습니다**(옛 서버 코드에 새 동기화 · 워커 API가 없음) — 앱은 다운그레이드되지 않으므로 사용자 PC의 앱(0.3.0 이상)은 서버를 새 코드로 다시 올릴 때까지 연결 오류를 보입니다.
- 설치 후 확인(9절) 항목에는 변경이 없습니다.

### 15.3 관리자 작업 (사람이 하는 일 — 반영 뒤)

1. **앱 역할 `idle_in_transaction_session_timeout = '60s'`가 운영에서 적용됐는지 확인.** 이유: 이 값이 0(무제한)이면 트랜잭션을 연 채 쉬는 연결 하나가 변경 피드 기준(`pg_snapshot_xmin`)을 붙잡아 **모든 사용자의 동기화 피드가 멈춥니다**. 확인: **[사용자]** 가 Supabase 대시보드 SQL Editor에서 읽기만 하는 `select rolconfig from pg_roles where rolname = 'paperlab_app';`를 실행해 `idle_in_transaction_session_timeout=60s`가 있는지 봅니다(결과에 비밀 없음 — 보고할 때 이 한 줄만). **확인 필요**: 운영 풀러 접속(`paperlab_app.<ref>`) 세션에서 실제 값이 `60s`인지(`show idle_in_transaction_session_timeout`)는 앱 역할 주소로 접속해야 보이는데 **이를 보여 주는 관리 명령이 아직 없음** — 팀장에게 확인 방법을 묻습니다(명세 AC-6D1).
2. **운영 DB 크기와 PGroonga(Groonga) 파일 크기 구성 확인.** 시험 DB는 논문 0편인데도 약 366MB(그중 Groonga 약 349MB)였고, 첫 할당 약 55MB에 더해 편당 약 0.26MB가 늘어납니다. 운영도 비슷하면 한도 500MB의 90%(450MB)까지 남는 양이 약 84MB(약 320편)입니다. 확인: Supabase 대시보드의 DB 사용량(또는 15.3절 3번 `admin maintain`이 출력하는 전 · 후 크기). **숫자만** 팀장에게 보고합니다. 450MB를 넘기게 되면 Supabase Pro($25/월) 전환 여부는 **사용자 확인**(PLAN 7 · 11장).
3. **`admin maintain` 실행**(필요할 때): `D:\PaperLab\study99web`에서
   ```powershell
   .venv\Scripts\python -m paperlab.admin maintain
   ```
   `pgroonga_vacuum()`을 실행하고 "DB 정리(pgroonga_vacuum): {전}MB → {후}MB"를 출력합니다. **언제**: 사용자가 휴지통에서 논문을 많이 영구 삭제한 뒤(행을 지워도 Groonga 파일은 줄지 않고 이 명령으로만 돌아옴), 또는 DB가 한도에 가까울 때. 관리자 주소(`SUPABASE_DB_URL`)를 쓰고 **테스트 표지가 붙은 DB는 거부**합니다. 서버 요청 경로에서는 자동으로 돌지 않습니다. 실행 시간 · 실행 중 영향은 아직 실측하지 않았으므로 처음에는 사용자가 적은 때에 하고, 출력(전 · 후 크기)을 팀장에게 보고합니다.
4. **휴지통 정리**: 30일이 지난 휴지통 논문은 그 사용자가 서버를 쓸 때(앱 PC가 켜져 있으면 하루 안에) 자동으로 영구 삭제됩니다. 아무도 접속하지 않은 사용자의 휴지통은 남을 수 있으며 별도 관리 명령(`purge-trash`)은 만들지 않았습니다.
5. **앱 설치 ID 동작은 사용자 PC 실측 몫**(관리자 · 품질팀, 시험용 계정으로): 앱 자동 업데이트 뒤에는 동기화 설정이 그대로 이어지고, 제거 후 새로 설치하면 꺼짐으로 시작하는지(레지스트리 `HKCU\Software\PaperLab\InstallId` — 명세 7.3절 · 21.4절 S-5 (f)). 실제 논문 폴더 · 실제 사용자 계정으로는 시험하지 않습니다.

### 15.4 문제 해결 (6단계)

| 증상 | 확인 | 조치 |
|---|---|---|
| 사용자 앱이 "업데이트가 필요해요"(동기화) | 앱 버전이 0.3.0 미만이면 동기화 API가 426 | 앱 자동 업데이트를 기다리거나 `/downloads/`의 새 설치 파일 · `releases`에 0.3.0이 있는지(`update.log`) |
| 동기화 상태 "올리기 멈춤 — 서재 데이터베이스 공간" | DB 크기(15.3절 2번), `PAPERLAB_DB_LIMIT_MB` | 15.3절 3번 `admin maintain`, 그래도 부족하면 Pro 전환 판단(사용자 확인) |
| "올리기 멈춤 — 내 올리기 한도" | 그 사용자의 PDF 총량(휴지통 포함) | 사용자에게 휴지통 비우기 안내 또는 `PAPERLAB_SYNC_USER_CAP_MB` 조정(15.1절) |
| "올리기 멈춤 — 서재 저장 공간" | R2 사용량(95%에서 업로드를 막는 기존 규칙 — 사용자 화면의 저장 공간 막대) | 필요 없는 논문 영구 삭제 안내, 한도 판단은 1단계 M9 |
| 서버 로그에 `sync feed xmin stalled`(숫자만 있는 WARN) | 다른 연결이 트랜잭션을 연 채 쉬는 중 — 피드가 새 변경을 못 줌(응답은 정상) | 15.3절 1번을 다시 확인, 계속되면 팀장에게 WARN 줄(숫자만)과 함께 보고 |
| 마이그레이션 단계에서 업데이트가 되돌림 | `update.log`(11절 4번) | 12절 해당 줄 — 팀장 보고 |

## 16. 여러 단계를 한 번에 반영(1C → 6단계)

**현황**: 2026-10-14 현재 서버 PC는 `f9e748e`(1C)까지 반영돼 있고, 2a · 2b · 3 · 4 · 5 · 6단계는 미반영입니다. 6단계 커밋(`853c81e`)까지 **한 번에** 올릴 때의 순서입니다. 이 절의 순서는 개별 단계의 반영 절(14.4 · 15.2)과 11절 "업데이트 동작"을 합친 것이며, 각 번호에서 **기대와 다르면 멈추고 팀장에게 보고**합니다.

**이번에 적용되는 마이그레이션 5개**(`paperlab.migrate`가 순서대로 한 번에 적용 — 되돌리지 않음):

| 파일 | 단계 | 내용(요약) |
|---|---|---|
| `20261009000001_devices_jobs.sql` | 2a | PC 앱 기기 · 작업 표 |
| `20261010000001_rag.sql` | 3 | AI 질문 · 인용 검증(대화 · 검증 결과 표, 색인 판 열) |
| `20261013000001_explain_translate.sql` | 4 | 쉬운 설명 · 번역 표 |
| `20261014000001_external_sources.sql` | 5 | 공용 캐시 `oa_license` 열, `opencitations` 출처 허용 |
| `20261015000001_folder_sync.sql` | 6 | 폴더 동기화 · 휴지통 · 앱 역할 `idle_in_transaction_session_timeout = '60s'` |

(`supabase\migrations\` 폴더의 실제 파일명입니다. 2b에는 마이그레이션이 없습니다.)

> **처음 한 번은 옛 `update.ps1`이 돕니다.** `update.ps1`은 서버 PC에 있는 파일이 실행되므로, `f9e748e`에서 시작하면 코드를 받는 그 실행은 **옛 스크립트로 끝까지** 돕니다. 옛 스크립트에는 `-BuildDesktop`이 없어 붙이면 매개변수 오류가 나고, 빌드 · 임베딩 모델 확인 단계도 없습니다. 그래서 **`update.ps1 -Yes`(빌드 없음) → 끝난 뒤 `update.ps1 -BuildDesktop`(이때는 새 스크립트가 돎)** 두 번에 나눕니다. 또 `admin rag-model`은 옛 코드에 없는 명령이라 **반영한 뒤에** 받습니다.

**0. 준비**
- **사용자가 적은 시간에** 합니다. 반영 중 몇 분 동안 옛 서버가 새 화면 파일(저장소에서 바로 읽음)을 내보내 일부 기능이 오류를 낼 수 있습니다(품질팀 D-5).
- Supabase가 일시정지 상태가 아닌지 봅니다(대시보드 — 일시정지면 **[사용자]** Restore).
- `node -v`가 **22 이상**인지 봅니다(4절).
- D: 드라이브 여유 공간이 **20GB 이상**인지 봅니다(3절 `Get-PSDrive`).

**1. 백업**: `Start-ScheduledTask 'PaperLab Backup'` → 1~2분 뒤 `.venv\Scripts\python -m paperlab.admin latest-backup`이 **오늘(KST) 날짜**인지 확인합니다. 아니면 **멈춥니다**(반영하지 않음). 이 백업이 마이그레이션 뒤 DB 쪽 되돌리기의 유일한 수단입니다(9번).

**2. 미리 보기**: `update.ps1 -DryRun`으로 반영할 커밋 목록을 확인합니다(`f9e748e` 다음부터 `853c81e`까지인지).

**3. 반영**: `update.ps1 -Yes`를 실행합니다. **`-BuildDesktop`은 붙이지 않습니다**(옛 스크립트라 오류). 실패하면 코드가 **자동으로 옛 커밋으로 되돌아갑니다**(마이그레이션은 되돌리지 않음). `D:\PaperLab\logs\update.log`를 확인합니다.

**4. 상태 확인**: `Invoke-RestMethod http://127.0.0.1:8080/api/health?deep=1`이 `ok`이고 `commit` 값이 반영한 커밋(`853c81e`)과 맞는지 확인합니다.

**5. 임베딩 모델**: `.venv\Scripts\python -m paperlab.admin rag-model --download` → `update.ps1 -RestartOnly` → `server.log`에 `"embed": true`가 있는지 확인합니다(11절 "임베딩 모델").

**6. PC 앱 설치 파일**: `update.ps1 -BuildDesktop` → `update.log`에 **"데스크톱 앱 빌드 성공: 버전 0.3.1"** 이 있는지, `releases\latest.yml`이 생겼는지 확인합니다. 로그인해서 설정 → **PC 앱 받기**에서 0.3.1이 보이는지도 봅니다. 첫 빌드는 Electron · NSIS 캐시를 받느라 오래 걸립니다(20분 제한 — 실패하면 11절 · 12절).

**7. 관리자 확인**(15.3절)
- **[사용자]** Supabase SQL Editor에서 `select rolconfig from pg_roles where rolname='paperlab_app'` → `idle_in_transaction_session_timeout=60s`가 있는지 봅니다.
- DB 크기를 확인합니다(Supabase 대시보드). 한도 500MB의 90%(450MB)에 가까우면 `.venv\Scripts\python -m paperlab.admin maintain`을 실행합니다(전 · 후 크기만 출력). 450MB를 넘기게 되면 Pro 전환은 **사용자 확인**.

**8. (선택) 키 · 한도 넣기**: `KCI_API_KEY` · `RISS_API_KEY`(14절) · `PAPERLAB_SYNC_USER_CAP_MB` · `PAPERLAB_DB_LIMIT_MB`(15.1절)를 **[사용자]** 가 메모장으로 `cloud.env`에 직접 넣고(값은 채팅에 적지 않음) `update.ps1 -RestartOnly`를 실행합니다.

**9. 되돌리기**
- `update.ps1 -Ref f9e748e`는 **코드만** 되돌리고 DB는 그대로 둡니다(옛 코드와 호환됨 — 새 열 · 표는 남음).
- 이때 **휴지통에 있는 논문은 옛 코드에서 보이지 않고**(데이터는 남음), **앱 0.3.0 이상(지금 0.3.1)은 서버에 연결되지 않습니다**(워커 · 동기화 — 앱은 다운그레이드되지 않음, 품질팀 D-11).
- **DB까지** 되돌리려면 1번 백업으로 복원해야 하는데, **이 복원 절차는 아직 검증되지 않았습니다**(`deploy/README.md` 4장 "(초안)" · 품질팀 D-3). **위험으로 받아들이고**, 그래서 1번 백업 확인이 필수입니다. 복원이 필요한 상황이면 직접 시도하지 말고 팀장에게 보고합니다.

## 17. 서재에 문서 · 사진 넣기 (2026-10-16) — 변환기 · 반영 순서

서재에 PDF 말고도 **워드(.doc · .docx) · 한글(.hwp · .hwpx) · PPT(.ppt · .pptx) · 엑셀(.xls · .xlsx) · OpenDocument(.odt · .odp · .ods) · .rtf · 사진(.jpg · .jpeg · .png · .gif · .bmp · .tif · .tiff · .webp)** 을 넣을 수 있습니다. 서버가 올릴 때 **PDF 변환본**을 만들어 읽기 · 형광펜 · AI · 검색은 그 PDF로 하고, **올린 원본은 R2 `users/{uid}/sources/`에 따로 보관**해 화면의 **[원본 받기]** 로 내려받습니다. 자세한 규칙은 [명세](../../docs/specs/library-documents.md).

### 17.1 필요한 것 (4절 표)

| 무엇 | 쓰는 곳 | 없으면 |
|---|---|---|
| LibreOffice (`C:\Program Files\LibreOffice\program\soffice.exe`, 26.8 실측) | 워드 · 한글 · PPT · 엑셀 · OpenDocument · RTF · WebP 사진 → PDF | 그 파일만 "서버에 문서 변환기(LibreOffice)가 없어…" 오류. PDF와 JPG · PNG 등 사진은 그대로 올라감 |
| H2Orestart 확장 (**공유 설치** `unopkg.com add --shared`) | 한글 .hwp · .hwpx | 한글 파일만 "문서를 PDF로 바꾸지 못했어요" |
| Java (Temurin 21 JRE) | H2Orestart | 위와 같음 |
| (선택) `cloud.env`의 `PAPERLAB_SOFFICE` | LibreOffice가 기본 위치가 아닐 때 그 `soffice.exe` 전체 경로 | 기본 위치 → PATH의 `soffice` 순서로 찾음 |

- 서버는 **자기 전용 LibreOffice 프로필**(`%TEMP%\paperlab-soffice-profile` — 서버 계정의 임시 폴더)로 한 번에 한 파일씩 바꿉니다. 첫 변환 때 프로필을 만들고(몇 초 더 걸림) 다음부터 다시 씁니다. 사용자가 이 PC에서 LibreOffice를 직접 써도 서로 영향이 없습니다.
- 보안: 그 프로필에 **문서 속 외부 링크 그림을 받지 않기(`BlockUntrustedRefererLinks`) · 매크로 끄기**를 서버가 넣습니다(올린 문서가 서버 PC에서 내부망 주소를 부르지 못하게). 프로필 폴더를 지워도 다음 변환 때 다시 넣습니다.
- 한 파일 변환은 **180초 제한**(넘으면 그 LibreOffice 프로세스를 끝내고 오류). 문서 한 개는 보통 3~15초입니다.
- 원본 크기도 저장 공간 사용량 · 휴지통 크기에 들어갑니다(R2 95% 규칙 그대로).

### 17.2 반영 순서

이 변경에는 **DB 마이그레이션 `20261016000001_source_files.sql`**(`papers`에 `source_key` · `source_name` · `source_size` 열 추가만 — 기존 행은 빈 값, 다시 돌려도 안전)이 있습니다. `update.ps1`이 다른 마이그레이션처럼 적용합니다.

1. 4절 표의 LibreOffice · H2Orestart(`--shared`) · Java를 확인합니다(이 PC에는 2026-10-16 설치됨).
2. 백업 확인(16절 1번과 같음) → `update.ps1 -Yes`.
3. `server.log`의 서버 시작 줄에 `"converter": true`가 있는지 봅니다.
4. **[사용자]** 로그인해서 서재에 작은 .docx · .hwpx · 사진을 하나씩 끌어다 놓아 봅니다 → 목록에 **DOCX · HWPX · 이미지** 배지, 상세의 **[원본 받기]** 로 원래 파일이 받아지는지 확인합니다.
5. 되돌리기: `update.ps1 -Ref <옛 커밋>`은 코드만 되돌립니다. 새 열은 남고, 옛 코드에서는 문서 항목이 **PDF 변환본만 있는 논문**처럼 보입니다(원본 파일은 R2에 남지만 옛 화면에는 [원본 받기]가 없음 · 영구 삭제해도 원본 파일은 남아 `admin orphans`가 나중에 찾음).

## 18. 논문 쓰기 그림 · 표 · 목록 · 단축키 도움말 (2026-10-16) — 반영

논문 쓰기 화면에 **그림 넣기(캡션 "그림 1.") · 표 넣기/고치기(캡션 "표 1.") · 글머리/번호 목록 편집 · 단축키 도움말(? · Ctrl+/)** 이 생겼습니다. 자세한 규칙은 [명세](../../docs/specs/writing-figures-tables.md).

- **DB 마이그레이션 · 새 설정값 · 새 프로그램 없음.** `update.ps1`로 코드만 반영하면 됩니다(서버 재시작 필요 — 새 API `POST/GET /api/manuscripts/{id}/figures`). PC 앱(Electron) 다시 만들기도 필요 없습니다.
- 그림은 R2 `users/{uid}/figures/{원고 id}/` 아래에 저장됩니다(한 장 10MB · 원고 하나 200장 · 300MB까지). 원고를 지우면 함께 지워지고, `admin orphans`는 이 폴더를 건드리지 않습니다.
- 그림 용량은 R2 사용량(설정 → 계정, 95% 규칙)에 더해집니다. 사용량을 잴 때 최대 5분에 한 번 R2 `users/` 목록을 읽어 그림 합계를 잽니다(목록 요청이 조금 늘어남). 사용량이 95%를 넘으면 그림 올리기도 "저장 공간이 거의 찼어요"로 막힙니다.
- 확인: **[사용자]** 원고를 열어 [그림]으로 사진 하나 · [표]로 3×3 표를 넣고, 미리보기에 "그림 1." · "표 1."이 보이는지, 워드 · 한글로 내보내 그림과 표가 들어 있는지 봅니다.
- 되돌리기: `update.ps1 -Ref <옛 커밋>`은 코드만 되돌립니다. 원고 글의 `![설명](fig:…)` 줄은 옛 화면에서 설명 글자로만 보이고(그림 파일은 R2에 남음), 표는 옛 방식(칸을 | 로 이은 문단)으로 내보내집니다.

## 19. AI 백그라운드 실행 · 끝나면 알림 · AI 경로(내 PC · 내 키만) (2026-10-16) — 반영

- **무엇이 바뀌나**: AI 글쓰기 도우미가 서버 작업(`POST /api/ai/write` → 202 `{job}`)이 되어 창 · 브라우저를 닫아도 끝까지 돌고 결과는 7일 동안 남습니다. 논문과 대화 · 서재 질문 · 쉬운 설명 · 선택 번역(SSE)은 화면 연결이 끊겨도 **취소하지 않고 서버가 끝까지 받아 저장**합니다(예전 품질팀 H1의 "끊기면 취소"를 바꿈). 화면은 어디서든 끝나면 토스트 · 브라우저 알림을 띄웁니다. 새 API: `POST /api/jobs/{id}/handled`, `GET /api/jobs?status=finished&since=…` · `manuscript_id=…`.
- **AI 경로**: AI는 **사용자가 연결한 PC 앱의 CLI · 사용자가 넣은 API 키로만** 실행합니다. 서버 코드는 claude · codex · gemini CLI를 실행하지 않고(코드 검사 테스트가 막음), `serve.py`는 시작할 때 `ANTHROPIC_*` · `OPENAI_*` · `GEMINI_*` · `GOOGLE_GENAI_*` · `GOOGLE_API_KEY` · `CLAUDE_CODE_*` · `CODEX_*` 환경 변수를 지우고 이름만 `server.log`에 WARN으로 남깁니다(값은 남기지 않음). **이 서버 PC에는 계속 PaperLab PC 앱(워커)을 설치하지 않습니다**(11절 — 설치하면 그 PC가 연결된 PC로 작업을 가져감). `cloud.env`에 AI 키 줄을 넣지 않습니다(넣어도 쓰지 않음).
- **DB 마이그레이션 · 새 설정값 · 새 프로그램 없음.** `update.ps1`로 코드만 반영하면 됩니다(서버 재시작 필요). PC 앱(Electron) 다시 만들기도 필요 없습니다 — 워커 프로토콜은 그대로입니다. 글쓰기 결과 보관이 24시간 → 7일로 늘어 `jobs.result`가 조금 더 오래 남습니다(30일 정리 규칙은 그대로).
- **재시작 중인 작업**: 화면에 붙어 있던 SSE 작업이 서버 재시작으로 끊기면 예전처럼 "서버가 다시 시작돼 작업이 멈췄어요"(cancelled · interrupted)로 끝납니다. 화면을 떠나 백그라운드로 넘어간 작업 · 글쓰기 작업은 리스가 지나면(약 90초) 복구 스캔이 다시 실행합니다.
- 확인: **[사용자]** 원고에서 문단을 고르고 ✦ AI 도우미 → 학술 문체로 → 창을 바로 닫고 → 다른 화면으로 갔다가 끝남 토스트의 [열기]로 결과 창이 열리는지, [바꾸기]로 원고에 들어가는지 봅니다. 결과를 기다리는 동안 그 문단을 고친 뒤 [바꾸기]를 누르면 "원래 자리를 찾지 못했어요"가 나와야 합니다. 키도 연결된 PC도 없는 계정이면 시작 전에 "설정 → 연결된 PC … 내 API 키 …" 안내가 나와야 합니다.
- 되돌리기: `update.ps1 -Ref <옛 커밋>`은 코드만 되돌립니다. 옛 화면은 글쓰기를 SSE로 부르므로 새 서버와 섞이지 않게 서버와 화면을 함께 되돌립니다(같은 저장소라 함께 바뀜).

## 20. 선택 동기화(폴더 · 파일별 PC에만 두기) · PC 동기화 문서 원본 (2026-10-17) — 반영 순서 · 관리자 작업

근거: [명세](../../docs/specs/selective-sync.md) 6 · 7 · 13장. PC 앱의 동기화 서재에서 폴더 · 파일마다 **"서버에도 저장(켬)" / "이 PC에만(끔)"** 을 고르고(끈 항목은 서버에 정보 · 노트 · 하이라이트만), PC 폴더 동기화가 워드 · 한글 · PPT · 엑셀 · 사진도 **원본 그대로** 맞춥니다. 서버(pip) · 웹은 새 의존성이 없고, PC 앱은 0.4.0(로컬 문서 본문 추출용 npm 2개 — 앱 설치 파일에 들어감, 서버 PC에 따로 설치할 것 없음)입니다. `cloud.env` 새 값도 없습니다.

### 20.1 무엇이 바뀌나

- **DB 마이그레이션 `20261017000001_selective_sync.sql`**: `papers`에 `sync_mode` · `storage` · `local_device_id` · `mode_pending` · `mode_requested_at/by` · `mode_error` · `source_sha256`, `folders.sync_mode`, `sync_devices.protocol`, `jobs.pinned_device_id`, PC 파일 이름 규칙을 문서 · 사진 확장자까지 넓힘, 변경 로그 트리거 넓힘, 로컬 항목에 본문(`page_texts`)을 쓰지 못하게 하는 트리거. **추가만** 하고 기존 행은 기본값(`inherit` · `cloud` · 빈 값)이라 옛 코드가 돌아도 안전합니다. 두 번 돌려도 안전합니다.
- **동기화 API 프로토콜 2**: 동기화 요청에 머리글 `X-PaperLab-Sync: 2`가 없으면(= 앱 0.3.1) **426 `update_required`**(최소 0.4.0). 0.3.1 앱은 426을 받으면 동기화를 멈추고(파일 · 저널 그대로, 30분 뒤 다시) 자동 업데이트를 확인합니다 — 아무것도 지우지 않습니다. 워커(AI 작업) API는 그대로입니다.
- **PC 표현 = 원본**: 웹에서 올린 문서도 PC에는 `원래 이름.docx` 원본으로 내려갑니다(지금까지는 `원래 이름.pdf` 변환본). 이미 운영에 있는 문서 행은 **20.3절 `sync-originals`** 를 실행해야 원본으로 바뀝니다(실행 전에는 지금처럼 변환본으로 맞춤 — 섞여도 깨지지 않음).
- 새 사용자 API: `POST /api/papers/sync-mode` · `POST /api/folders/{id}/sync-mode` · `GET /api/sync/holders`. 끈 항목은 서버 R2 · 본문 검색 · 서버 AI 키에서 빠지고, 요약 · 논문 대화는 **그 파일을 가진 PC의 CLI로만** 실행됩니다(서버 PC의 CLI · 키는 계속 쓰지 않음 — 19절).

### 20.2 반영 순서 (서버 PC — 실제 순서)

명세 13장과 같은 순서입니다. 이 PC에서는 **`update.ps1 -Yes` 한 번이 서버 반영과 앱 0.4.0 빌드 · 내보내기를 함께 합니다** — `update.ps1`은 옛 커밋과 새 커밋 사이에 `desktop\`이 바뀌었으면(`$desktopChanged` = `git diff --name-only <옛> <새> -- desktop/`가 비지 않음 — 이번 반영은 0.4.0이라 해당) 서버 재시작 · 상태 확인이 끝난 **바로 뒤, 같은 실행 안에서** 앱을 빌드해 `releases`에 올립니다(`-BuildDesktop` 불필요). 그 사이 몇 분 동안 사용자 PC의 0.3.1 앱은 동기화가 426으로 **안전하게 멈춰** 있다가, 0.4.0이 `releases`에 올라가면 자동 업데이트로 이어집니다. 0.4.0 앱은 옛 서버(프로토콜 없음)를 만나면 0.3.1과 같은 v1 방식(PDF만)으로 돌기 때문에, 순서가 거꾸로 되어도 안전합니다.

1. **백업 확인**(16절 1번): `Start-ScheduledTask 'PaperLab Backup'` → `.venv\Scripts\python -m paperlab.admin latest-backup`이 오늘(KST)인지. 아니면 멈춥니다.
2. **서버 반영 + 앱 0.4.0 빌드(한 번에)**: 첫 번째 PowerShell 창에서 `update.ps1 -Yes`. 이 한 실행이 차례로 합니다 — 코드 받기 → **마이그레이션 `20261017000001`**(11절 4번 — 코드보다 먼저 DB) → 서버 재시작 → `/api/health?deep=1`이 `ok` · 새 `commit`인지 확인 → `update.log` "업데이트 성공: <옛> → <새>" → 임베딩 모델 확인 → "데스크톱 앱 빌드 시작: 버전 0.4.0" → `npm ci` · `npm run dist`(몇 분, 최대 20분) → `releases`에 `.exe` · `.blockmap` · `release.json` · **`latest.yml`(마지막)** → "데스크톱 앱 빌드 성공: 버전 0.4.0" → 끝. 즉 **이 창이 돌아왔을 때는 이미 0.4.0이 나가 있습니다** — 3번을 이 창이 끝난 뒤로 미루지 않습니다.
3. **같은 때에 두 번째 PowerShell 창에서 원본 표현 채우기**(20.3절) — 아래 "안전한 창" 안에서 `sync-originals --dry-run` → 숫자만 보고 곧바로 실행:

   ```powershell
   Set-Location D:\PaperLab\study99web
   # 1) 새 커밋이 보일 때까지 몇 초마다 다시 — update.log "업데이트 시작: <옛> → <새>"의 <새>(7자리)와 같아야 시작
   (Invoke-RestMethod 'http://127.0.0.1:8080/api/health?deep=1').commit
   # 2) 같으면 곧바로
   .venv\Scripts\python -m paperlab.admin sync-originals --dry-run
   .venv\Scripts\python -m paperlab.admin sync-originals
   ```

   - **안전한 창 = `/api/health?deep=1`의 `commit`이 새 커밋이 된 순간부터 `releases\latest.yml`이 0.4.0으로 바뀌는 순간(`update.log` "데스크톱 앱 빌드 성공: 버전 0.4.0")까지** — 대략 앱 빌드 시간(몇 분)입니다. 이 동안 서버는 새 코드라 0.3.1 PC는 426으로 멈춰 있고 0.4.0은 아직 받을 수 없어 **어떤 PC도 옛 문서 행을 건드리지 못합니다.**
   - **창이 열리기 전에는 돌리지 않습니다**: `commit`이 아직 옛 값이면 옛 서버가 돌고 있고(0.3.1 PC가 동기화 중) 마이그레이션 전일 수도 있습니다. `update.ps1`이 상태 확인 실패로 **옛 커밋으로 되돌렸으면**(`update.log` "자동 되돌림") 돌리지 않고 팀장에게 보고합니다.
   - **창이 닫힌 뒤에도 실행이 끝나지 않았으면** 멈추지 말고 끝까지 둡니다 — 잃는 파일은 없습니다. 0.4.0 PC는 다음 확인(426 재시도 30분마다 · 앱 시작 · 6시간마다) 때 받아 쉬는 동안 설치하므로 실제로는 조금 더 여유가 있고, 끝나지 않은 행은 서버가 지킵니다('PC에만'으로 바꾸지 못하게 막음 — `needs_originals`, PC에서 고친 변환본이 올라와도 원본을 지우지 않음). 그 사이 PC가 변환본을 고쳐 올린 행은 `sync-originals`가 옛 원본을 되돌리지 않고 떼어 냅니다(20.3절).
4. **빌드 확인**: 첫 창의 `update.log`에 **"데스크톱 앱 빌드 성공: 버전 0.4.0"**, `releases\latest.yml`이 0.4.0인지 봅니다. 빌드가 실패하거나 건너뛰었으면(WARN — 이전 설치 파일 그대로) 3번을 마친 뒤 `update.ps1 -BuildDesktop`을 실행합니다(그동안 0.3.1 PC의 동기화가 멈춰 있으므로 오래 미루지 않음).
5. **확인**: 아래 20.4절.

- **되돌리기 주의(R-3)**: `update.ps1 -Ref <옛 커밋>`으로 서버 코드를 되돌려도 새 열은 기본값이라 옛 코드가 돌아갑니다. **단 사용자가 'PC에만 두기'를 한 번이라도 쓴 뒤에는 서버를 되돌리지 않습니다** — 옛 서버의 피드가 PC에만 둔 항목을 "PDF 없음"으로 보고 빼므로, 0.4.0 앱(옛 서버에서는 v1 방식)이 그 파일을 새 논문으로 다시 올려 중복을 만들 수 있습니다. 꼭 되돌려야 하면 먼저 팀장에게 보고합니다(모든 항목을 켜는 관리 작업이 먼저 필요).

### 20.3 관리 명령 `admin sync-originals`

서재 문서 기능(17절)이 이미 운영에 나가 있으므로, 원본 해시를 모르는 문서 행(`source_key`는 있고 `source_sha256`이 빈 행)이 있습니다. 이 명령이 R2의 원본을 읽어 해시를 적고 PC 파일 이름을 원본 확장자로 바꿉니다(같은 폴더에 같은 이름이 있으면 ` (2)`). 그 뒤 각 PC 앱(0.4.0)은 피드로 원본을 받고 **옛 변환본(`이름.pdf`)은 Windows 휴지통으로** 옮깁니다(사용자가 그 변환본을 고쳐 두었으면 지우지 않고 새 항목으로 남김). **단 원본을 적은 뒤 PC가 변환본(`.pdf`)을 고쳐 올린 행**(서버가 올린 PC를 기억함)은 PC의 PDF가 최신이므로 해시를 채우지 않고 **원본을 떼어 냅니다**(R2 원본 삭제 · PC에는 고친 PDF 그대로 — PC에서 `.pdf`를 올리면 옛 원본을 지우는 새 규칙과 같음). 옛 원본이 PC로 되돌아와 고친 PDF를 휴지통으로 보내는 일이 없게 하려는 것입니다.

```powershell
.venv\Scripts\python -m paperlab.admin sync-originals --dry-run   # 채울 문서 수 · 원본을 떼어 낼 문서 수만 (바꾸지 않음)
.venv\Scripts\python -m paperlab.admin sync-originals             # 실행 — 채운 편수 · 이름 바꾼 수 · 떼어 낸 수 · 건너뜀만 출력
```

- 관리자 주소(`SUPABASE_DB_URL`)로 id만 모으고, 쓰기는 **사용자별 권한 트랜잭션**으로 합니다. 테스트 표지가 붙은 DB는 거부합니다. 출력 · 로그에 파일 이름 · 경로 · 해시는 없습니다.
- 멱등: 두 번째 실행은 할 일 0입니다(채운 행 · 떼어 낸 행 모두 더는 대상이 아님). R2 원본이 없는 행(이미 지워짐 등)은 건너뛰고 셉니다 — 건너뜀이 0이 아니면 숫자를 팀장에게 보고합니다.
- 문서가 많으면 R2에서 원본을 하나씩 받으므로 시간이 걸립니다(사용자가 적은 시간에).

### 20.4 확인 · 관리자 작업

1. `server.log`에 서버 시작 줄 · 오류 없음. 앱 0.3.1이 남은 PC의 `sync` 요청이 426인지(접근 로그 경로 · 상태만)는 업데이트 뒤 사라지는지로 봅니다.
2. **[사용자]** 0.4.0으로 업데이트된 PC 앱에서 **시험용 폴더** 하나를 "PC에만 두기"로 바꿔 봅니다 → 확인 창의 경고 문단(PC가 고장 나면 되살릴 수 없음) → 서재 배지 "이 PC에만" · 웹에서 "‘PC 이름’에만". 다시 "서버에도 저장"으로 켜면 파일이 올라가 웹에서 읽히는지 봅니다. 실제 논문 폴더로 시험하지 않습니다.
3. **[사용자]** 동기화 폴더에 작은 .docx를 넣어 → 서재에 DOCX 배지, 다른 PC에 `.docx` 원본으로 내려오는지 봅니다.
4. 보관 PC를 해지하면(설정 → 연결된 PC) 그 PC에만 있던 항목은 "파일 없음 (연결 해지된 PC)"가 됩니다 — 해지 확인 창 문구를 사용자에게 안내합니다.

### 20.5 문제 해결

| 증상 | 확인 | 조치 |
|---|---|---|
| 앱이 "업데이트가 필요해요"(동기화)에서 안 넘어감 | `releases\latest.yml` 버전, `update.log`의 빌드 줄 | 20.2절 4번 `update.ps1 -BuildDesktop`을 다시 — 0.4.0이 올라가면 앱이 자동 업데이트 |
| "PC에만으로 바꾸는 중"이 오래 남음 | 그 보관 PC가 켜져 있고 0.4.0인지(연결된 PC 줄 — 프로토콜 1이면 0.3.x) | 보관 PC를 켜고 동기화를 켬. 그 PC를 잃었으면 사용자가 [바꾸기 취소] |
| "확인 필요 — 이 PC에 파일이 없어요" | 보관 PC 앱이 끄기를 확인하지 못함(`mode_error` — 화면 표시) | 사용자가 [바꾸기 취소] 또는 파일을 되살린 뒤 기다림 |
| 끈 항목 요약이 "그 PC의 AI로만" 오류 | 보관 PC 앱에 Claude · Codex · Gemini CLI가 연결됐는지 | 사용자 PC에서 AI 도구 연결(서버 PC의 CLI는 쓰지 않음 — 19절) |
| `sync-originals`가 "건너뜀"을 많이 셈 | R2 원본이 없음 · 원본 이름에 확장자가 없음 | 숫자만 팀장에게 보고(그 행은 변환본 표현 그대로 동작 — 'PC에만'으로는 바꿀 수 없음) |
| 문서를 'PC에만'으로 바꾸려는데 "원본 정리 전" 안내(`blocked` 코드 `needs_originals`) | 그 문서가 `sync-originals` 전 행인지(원본 해시 없음) | `sync-originals`를 다시 실행(멱등). 건너뜀으로 남는 행은 원본을 PC에 내려줄 수 없어 끌 수 없음 — 팀장에게 보고 |
