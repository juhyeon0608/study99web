<#
.SYNOPSIS
  PaperLab 서버 PC 설치 (명세 13.1절 5번, 서버 PC 안내서 7절). 몇 번 다시 실행해도 안전합니다.

.DESCRIPTION
  1. 확인: 루트 · 저장소 · logs · tmp · cloud.env 폴더 · cloud.env 파일이 정션 · 심볼릭 링크가 아님 · 시간대 KST · py -3.12 · git ·
     절전(경고만) · cloud.env 있음 · 저장소 브랜치
  2. 루트 폴더(기본 D:\PaperLab) 권한 제한(상속 끊고 현재 사용자 · SYSTEM · Administrators 만), logs · tmp 만들기
  3. cloud.env 폴더 · 파일 권한 제한(같은 세 계정)
  4. py -3.12 -m venv .venv → pip install -e .
  5. python -m paperlab.serve --check --before-app-role (변수 이름만 출력)
  6. python -m paperlab.migrate → python -m paperlab.admin sync-allowlist (관리자 연결 · 테스트 표지 DB는 거부)
  7. python -m paperlab.admin app-role --write-env --if-missing (SUPABASE_APP_DB_URL 이 비어 있을 때만)
  8. serve --check (전체) → admin pg-dump-check (낮으면 백업 작업 등록 전에 중단)
  9. 작업 스케줄러 3개 등록(PaperLab Server · Backup · Watchdog — 로그온 여부와 관계없이, 암호 저장).
     비밀번호는 Windows 입력 창(Get-Credential)으로만 받고 파일 · 로그에 남기지 않음 (팀장 결정 S4)
 10. 서버 작업 시작 → 127.0.0.1:<포트>/api/health?deep=1 이 db · storage ok 가 될 때까지(최대 60초)
 11. Funnel 켜기(funnel.ps1 on) → 공개 주소 /api/health 확인
 12. 요약: 작업 상태 · 배포 커밋 · Funnel 상태

  cloud.env 의 값은 읽거나 출력하지 않습니다. 이 PC 경로를 코드에 박지 않습니다 — 기본값은 server.json 과 스크립트 위치.

.PARAMETER DryRun
  할 일만 "[DRY]" 줄로 보여 주고 아무것도 바꾸지 않습니다(읽기 확인은 함). 확인이 실패해도 멈추지 않고 경고만.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\install.ps1 -DryRun
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\install.ps1
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\install.ps1 -ReRegisterTasks   # Windows 비밀번호를 바꾼 뒤
#>
[CmdletBinding()]
param(
  [string]$Root,
  [string]$AppDir,
  [string]$LogDir,
  [string]$TmpDir,
  [string]$Branch,
  [int]$Port = 0,
  [string]$EnvFile,
  [string]$RepoUrl,
  [string]$PythonVersion = '3.12',
  [switch]$DryRun,
  [switch]$ReRegisterTasks,
  [switch]$RecreateVenv,
  [switch]$SkipFunnel
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$cfg = Get-PLConfig
if (-not $Root) { $Root = $cfg.root }
if (-not $AppDir) { $AppDir = Get-PLRepoRoot }
if (-not $LogDir) { $LogDir = Join-Path $Root 'logs' }
if (-not $TmpDir) { $TmpDir = Join-Path $Root 'tmp' }
if (-not $Branch) { $Branch = $cfg.branch }
if ($Port -le 0) { $Port = [int]$cfg.port }
if (-not $EnvFile) { $EnvFile = Get-PLDefaultEnvFile }
$TaskServer = $cfg.tasks.server
$TaskBackup = $cfg.tasks.backup
$TaskWatchdog = $cfg.tasks.watchdog
$Log = $null
if (-not $DryRun) { $Log = Join-Path $LogDir 'install.log' }
$Py = Get-PLVenvPython -AppDir $AppDir
$script:Problems = @()

function Check {
  param([bool]$Ok, [string]$Message)
  if ($Ok) { Write-PLLog -LogFile $Log -Message "확인: $Message"; return }
  if ($DryRun) { Write-PLLog -Level WARN -Message "확인 실패(시험 실행이라 계속): $Message"; $script:Problems += $Message; return }
  Write-PLLog -LogFile $Log -Level ERROR -Message "확인 실패: $Message"
  throw "설치를 멈췄어요: $Message"
}

function Run-Py {
  param([string[]]$PyArgs, [string]$What)
  $code = Invoke-PLNative -FilePath $Py -Arguments $PyArgs -WorkingDirectory $AppDir
  if ($code -ne 0) { throw "$What 실패 (종료 코드 $code)" }
}

# 정션 · 심볼릭 링크 경로는 거부 (품질팀 점검 · 팀장 결정 C) — 권한 제한이 링크 개체에만 걸리고 대상 폴더는 그대로라서.
# 폴더 · 로그 파일을 만들기 전에 확인한다(로그 폴더가 링크면 그 대상에 쓰게 되므로 실패는 화면에만)
$envDir = Split-Path -Parent $EnvFile
$links = @(Get-PLReparsePoints -Paths @($Root, $AppDir, $LogDir, $TmpDir, $envDir, $EnvFile))
foreach ($link in $links) {
  $m = "정션 · 심볼릭 링크 경로는 지원하지 않아요: $link — 실제 폴더 경로를 -Root/-LogDir/-TmpDir 로 넘기세요 (저장소는 -AppDir, cloud.env 는 -EnvFile)"
  if ($link -eq $EnvFile) { $m = "정션 · 심볼릭 링크 경로는 지원하지 않아요: $link — -EnvFile로 실제 파일 경로를 넘기세요" }
  if ($DryRun) { Write-PLLog -Level WARN -Message "확인 실패(시험 실행이라 계속): $m"; $script:Problems += $m }
  else { Write-PLLog -Level ERROR -Message "확인 실패: $m" }
}
if ($links.Count -gt 0 -and -not $DryRun) { throw "설치를 멈췄어요: 정션 · 심볼릭 링크 경로 $($links.Count)개 ($($links -join ', '))" }

$mode = ''
if ($DryRun) { $mode = ' (시험 실행 — 바꾸지 않음)' }
# 작업 등록(시스템 시작 시 트리거 · 로그온 여부와 관계없이)은 관리자 권한이 필요하다 — 무엇이든 바꾸기 전에 확인 (품질팀 F4)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
$tasksNeeded = $ReRegisterTasks -or @(@($cfg.tasks.server, $cfg.tasks.backup, $cfg.tasks.watchdog) |
  Where-Object { -not (Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue) }).Count -gt 0
$adminMsg = "관리자 권한으로 실행 중 (작업 스케줄러 등록에 필요 — 시작 메뉴에서 PowerShell을 '관리자 권한으로 실행'한 뒤 다시 실행)"
if ($tasksNeeded -and -not $isAdmin -and -not $DryRun) {
  # 로그 파일(폴더)도 만들기 전에 멈춘다 — 아무것도 바꾸지 않음
  Write-PLLog -Level ERROR -Message "확인 실패: $adminMsg"
  throw "설치를 멈췄어요: $adminMsg"
}
if ($tasksNeeded) {
  Check $isAdmin $adminMsg
} elseif (-not $isAdmin) {
  Write-PLLog -LogFile $Log -Message "관리자 권한 아님 — 작업이 이미 있어 등록 단계는 건너뛰므로 계속해요"
}

Write-PLLog -LogFile $Log -Message "PaperLab 서버 PC 설치 시작$mode — 루트 $Root, 저장소 $AppDir, 포트 $Port, 브랜치 $Branch"
if ($links.Count -eq 0) { Write-PLLog -LogFile $Log -Message "확인: 루트 · 저장소 · logs · tmp · cloud.env 폴더 · cloud.env 파일이 정션 · 심볼릭 링크가 아님 (없는 경로는 건너뜀)" }

# ---------------------------------------------------------------- 1. 확인 (읽기만)
$tz = Get-PLNativeText -FilePath tzutil.exe -Arguments @('/g')
Check ($tz.Trim() -eq 'Korea Standard Time') "시간대가 Korea Standard Time (백업 04:00 KST)"
$pyLauncher = Get-Command py -ErrorAction SilentlyContinue
$pyOk = $false
if ($pyLauncher) {
  $ver = Get-PLNativeText -FilePath py -Arguments @("-$PythonVersion", '--version')
  $pyOk = $ver -match "Python $([regex]::Escape($PythonVersion))\."
}
Check $pyOk "py -$PythonVersion 있음 (없으면 사용자 동의 후 winget install -e --id Python.Python.$PythonVersion)"
Check ([bool](Get-Command git -ErrorAction SilentlyContinue)) "git 있음"
Check (Test-Path -LiteralPath $EnvFile) "cloud.env 있음: $EnvFile (내용은 읽지 않음)"
try {
  foreach ($setting in @('STANDBYIDLE', 'HIBERNATEIDLE')) {
    $hex = [regex]::Matches((Get-PLNativeText -FilePath powercfg.exe -Arguments @('/query', 'SCHEME_CURRENT', 'SUB_SLEEP', $setting)), '0x[0-9a-fA-F]{8}')
    if ($hex.Count -ge 2) {
      $ac = [Convert]::ToInt32($hex[$hex.Count - 2].Value, 16)
      if ($ac -ne 0) { Write-PLLog -LogFile $Log -Level WARN -Message "전원(AC) $setting 이 $ac 초 — 사용자 확인 후 0(사용 안 함)으로 (안내서 3절)" }
    }
  }
} catch { Write-PLLog -LogFile $Log -Level WARN -Message "절전 설정을 읽지 못했어요 (안내서 3절로 직접 확인)" }

if (Test-Path -LiteralPath (Join-Path $AppDir '.git')) {
  $cur = Get-PLNativeText -FilePath git -Arguments @('-C', $AppDir, 'rev-parse', '--abbrev-ref', 'HEAD')
  Check ($cur.Trim() -eq $Branch) "저장소 브랜치가 배포 브랜치($Branch) — 지금 $($cur.Trim())"
} elseif ($RepoUrl) {
  Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "저장소 받기: git clone --branch $Branch <저장소> $AppDir" -Action {
    $code = Invoke-PLNative -FilePath git -Arguments @('clone', '--branch', $Branch, $RepoUrl, $AppDir)
    if ($code -ne 0) { throw "git clone 실패" }
  } | Out-Null
} else {
  Check $false "저장소가 없어요: $AppDir (안내서 6절대로 clone 하거나 -RepoUrl)"
}

# ---------------------------------------------------------------- 2 · 3. 폴더 · 권한
foreach ($d in @($Root, $LogDir, $TmpDir)) {
  if (-not (Test-Path -LiteralPath $d)) {
    Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "폴더 만들기: $d" -Action { New-Item -ItemType Directory -Path $d -Force | Out-Null } | Out-Null
  }
}
Set-PLRestrictedAcl -Path $Root -Directory -DryRun:$DryRun -LogFile $Log
foreach ($child in @($AppDir, $LogDir, $TmpDir)) {
  $underRoot = $child.TrimEnd('\').StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
  if (-not $underRoot) {
    Write-PLLog -LogFile $Log -Level WARN -Message "루트 밖 경로라 권한 상속을 확인하지 않아요: $child"
    continue
  }
  if ($DryRun) {
    Write-PLLog -Level DRY -Message "[DRY] 하위 폴더 권한이 루트를 상속하는지 확인 · 필요하면 그 폴더만 상속으로 되돌리기(icacls /reset — 그 아래는 시스템이 다시 전파, 정션은 따라가지 않음): $child"
    continue
  }
  # 검사 · 초기화는 하위 폴더 최상위만. 그 아래에 따로 남은 명시적 권한은 다루지 않음 (팀장 결정 B)
  if (Test-Path -LiteralPath $child) {
    $p = Get-PLAclProblems -Path $child
    if ($p.Others.Count -gt 0) {
      Invoke-PLStep -LogFile $Log -Description "하위 폴더 권한을 루트 상속으로 되돌리기(그 폴더만): $child" -Action {
        $code = Reset-PLInheritedAcl -Path $child
        # 실패해도 설치는 계속 — 남은 다른 계정 권한은 그 경로의 icacls 확인(안내서 9절 6번)으로 잡는다 (팀장 결정)
        if ($code -ne 0) { Write-PLLog -LogFile $Log -Level WARN -Message "하위 폴더 권한을 상속으로 되돌리지 못했어요(icacls 종료 코드 $code): $child — 설치는 계속. icacls `"$child`" 를 직접 실행해 현재 사용자 · SYSTEM · Administrators 의 (I) 상속 항목만 있는지 확인하세요 (안내서 9절 6번)" }
      } | Out-Null
    }
  }
}
if (Test-Path -LiteralPath $envDir) { Set-PLRestrictedAcl -Path $envDir -Directory -DryRun:$DryRun -LogFile $Log }
if (Test-Path -LiteralPath $EnvFile) { Set-PLRestrictedAcl -Path $EnvFile -DryRun:$DryRun -LogFile $Log }

# ---------------------------------------------------------------- 4. 가상환경 · 의존성
$venv = Join-Path $AppDir '.venv'
if ($RecreateVenv -and (Test-Path -LiteralPath $venv)) {
  Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "가상환경 지우기(다시 만들기): $venv" -Action { Remove-Item -LiteralPath $venv -Recurse -Force } | Out-Null
}
if ($RecreateVenv -or -not (Test-Path -LiteralPath $Py)) {
  Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "가상환경 만들기: py -$PythonVersion -m venv .venv" -Action {
    $code = Invoke-PLNative -FilePath py -Arguments @("-$PythonVersion", '-m', 'venv', '.venv') -WorkingDirectory $AppDir
    if ($code -ne 0) { throw "가상환경을 만들지 못했어요" }
  } | Out-Null
}
Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "의존성 설치: .venv\Scripts\python -m pip install -e ." -Action {
  Run-Py -PyArgs @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-e', '.') -What 'pip install'
  $v = Get-PLNativeText -FilePath $Py -Arguments @('--version')
  if ($v -notmatch "Python $([regex]::Escape($PythonVersion))\.") { throw "가상환경 Python 이 $PythonVersion 이 아니에요: $($v.Trim()) (-RecreateVenv)" }
} | Out-Null

# ---------------------------------------------------------------- 5. 설정 점검 (이름만)
if (Test-Path -LiteralPath $Py) {
  Write-PLLog -LogFile $Log -Message "설정 점검: python -m paperlab.serve --check --before-app-role (변수 이름만)"
  $code = Invoke-PLNative -FilePath $Py -Arguments @('-m', 'paperlab.serve', '--check', '--before-app-role', '--env-file', $EnvFile) -WorkingDirectory $AppDir
  Check ($code -eq 0) "cloud.env 변수 점검 통과 (빠진 · 틀린 변수는 위 줄의 이름 — 사용자가 직접 고침, 안내서 5절)"
} else {
  Write-PLLog -Level DRY -Message "[DRY] 설정 점검: python -m paperlab.serve --check --before-app-role (가상환경을 만든 뒤)"
}

# ---------------------------------------------------------------- 6 · 7 · 8. DB 단계 (관리자 연결)
Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "마이그레이션: python -m paperlab.migrate (관리자 연결, 테스트 표지 DB 거부)" -Action {
  Run-Py -PyArgs @('-m', 'paperlab.migrate', '--env-file', $EnvFile) -What '마이그레이션'
} | Out-Null
Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "허용 목록 맞추기: python -m paperlab.admin sync-allowlist (ALLOWED_EMAILS 가 비면 건너뜀)" -Action {
  Run-Py -PyArgs @('-m', 'paperlab.admin', '--env-file', $EnvFile, 'sync-allowlist') -What '허용 목록 맞추기'
} | Out-Null
Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "앱 역할 주소: python -m paperlab.admin app-role --write-env --if-missing (비어 있을 때만, 값 출력 없음)" -Action {
  Run-Py -PyArgs @('-m', 'paperlab.admin', '--env-file', $EnvFile, 'app-role', '--write-env', '--if-missing') -What '앱 역할 주소 쓰기'
} | Out-Null
Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "설정 전체 점검: python -m paperlab.serve --check" -Action {
  Run-Py -PyArgs @('-m', 'paperlab.serve', '--check', '--env-file', $EnvFile) -What '설정 점검'
} | Out-Null
Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "pg_dump 주 버전 확인: python -m paperlab.admin pg-dump-check (낮으면 백업 작업 등록 전에 중단)" -Action {
  Run-Py -PyArgs @('-m', 'paperlab.admin', '--env-file', $EnvFile, 'pg-dump-check') -What 'pg_dump 버전 확인'
} | Out-Null

# ---------------------------------------------------------------- 9. 작업 스케줄러
function New-PLTaskDefinitions {
  $q = { param($s) '"' + $s + '"' }
  $exe = $Py
  if ($exe -match ' ') { $exe = & $q $Py }   # 작업 스케줄러 실행 파일 칸: 공백이 있으면 따옴표
  $serverArgs = "-m paperlab.serve --port $Port --env-file $(& $q $EnvFile) --log-dir $(& $q $LogDir) --diag-hang-file $(& $q (Join-Path $TmpDir 'diag-hang-health'))"
  $backupArgs = "-m paperlab.admin --env-file $(& $q $EnvFile) --log-file $(& $q (Join-Path $LogDir 'backup.log')) backup --tmp-dir $(& $q $TmpDir)"
  $watchdogScript = Join-Path $AppDir 'deploy\server-pc\watchdog.ps1'
  $watchdogArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File $(& $q $watchdogScript) -Port $Port -LogDir $(& $q $LogDir) -Root $(& $q $Root) -EnvFile $(& $q $EnvFile) -AppDir $(& $q $AppDir)"
  $repeat = New-ScheduledTaskTrigger -Once -At ((Get-Date).Date.AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 5)
  return @(
    [pscustomobject]@{
      Name = $TaskServer; Description = 'PaperLab 서버 (127.0.0.1:' + $Port + ', 명세 9.2)'
      Action = New-ScheduledTaskAction -Execute $exe -Argument $serverArgs -WorkingDirectory $AppDir
      Trigger = New-ScheduledTaskTrigger -AtStartup
      Settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -Priority 4
    },
    [pscustomobject]@{
      Name = $TaskBackup; Description = 'PaperLab DB 백업 → R2 (매일 04:00 KST, 14개 보관, 명세 13.3)'
      Action = New-ScheduledTaskAction -Execute $exe -Argument $backupArgs -WorkingDirectory $AppDir
      Trigger = New-ScheduledTaskTrigger -Daily -At '04:00'
      Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    },
    [pscustomobject]@{
      Name = $TaskWatchdog; Description = 'PaperLab 감시 (5분마다, 명세 13.5)'
      Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $watchdogArgs -WorkingDirectory $AppDir
      Trigger = $repeat
      Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    }
  )
}

$taskNames = @($TaskServer, $TaskBackup, $TaskWatchdog)
$existing = @($taskNames | Where-Object { Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue })
$toRegister = @($taskNames | Where-Object { $ReRegisterTasks -or ($existing -notcontains $_) })
if ($toRegister.Count -eq 0) {
  Write-PLLog -LogFile $Log -Message "작업 3개가 이미 있어 그대로 둬요 (다시 등록: -ReRegisterTasks)"
} elseif ($DryRun) {
  # 작업 정의 객체만 만들어 내용을 보여 줌 (New-ScheduledTask* 는 시스템을 바꾸지 않음)
  foreach ($d in (New-PLTaskDefinitions | Where-Object { $toRegister -contains $_.Name })) {
    $s = $d.Settings
    Write-PLLog -Level DRY -Message ("[DRY] 작업 등록: '{0}' — {1}\{2}, 로그온 여부와 관계없이 실행 · 암호 저장(Windows 입력 창으로 받음)" -f $d.Name, $env:USERDOMAIN, $env:USERNAME)
    Write-PLLog -Level DRY -Message ("[DRY]   실행: {0} {1} (시작 폴더 {2})" -f $d.Action.Execute, $d.Action.Arguments, $d.Action.WorkingDirectory)
    Write-PLLog -Level DRY -Message ("[DRY]   트리거: {0} · 실패 시 다시 시작 {1}번/{2} · 시간 제한 {3} · 겹치면 {4} · 놓치면 곧 실행 {5}" -f `
        $d.Trigger.CimClass.CimClassName, $s.RestartCount, $s.RestartInterval, $s.ExecutionTimeLimit, $s.MultipleInstances, $s.StartWhenAvailable)
  }
} else {
  $defs = New-PLTaskDefinitions | Where-Object { $toRegister -contains $_.Name }
  Write-PLLog -LogFile $Log -Message "작업 등록에 Windows 계정 비밀번호가 필요해요 — 입력 창에 넣어 주세요 (PIN 아님, 스크립트 · 파일에 남지 않음)"
  $cred = Get-Credential -UserName "$env:USERDOMAIN\$env:USERNAME" -Message 'PaperLab 작업 스케줄러: 이 Windows 계정의 비밀번호 (로그온 없이 실행용)'
  if (-not $cred) { throw "비밀번호 입력을 취소했어요. 작업을 등록하지 않았어요." }
  try {
    foreach ($d in $defs) {
      Invoke-PLStep -LogFile $Log -Description "작업 등록: '$($d.Name)'" -Action {
        if (Get-ScheduledTask -TaskName $d.Name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $d.Name -Confirm:$false }
        Register-ScheduledTask -TaskName $d.Name -Description $d.Description -Action $d.Action -Trigger $d.Trigger -Settings $d.Settings -User $cred.UserName -Password $cred.GetNetworkCredential().Password -RunLevel Limited | Out-Null
      } | Out-Null
    }
  } catch {
    throw "작업을 등록하지 못했어요 (비밀번호가 틀렸을 수 있어요): $($_.Exception.Message)"
  } finally {
    $cred = $null
  }
}

# ---------------------------------------------------------------- 10. 서버 시작 · 상태 확인
Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "서버 시작 → http://127.0.0.1:$Port/api/health?deep=1 대기(최대 60초)" -Action {
  $h = Get-PLHealth -Port $Port
  if (-not $h) {
    Start-ScheduledTask -TaskName $TaskServer
  }
  $ok = Wait-PLHealth -Port $Port -Deep -TimeoutSec 60
  if (-not $ok) {
    $last = Get-PLHealth -Port $Port -Deep
    $detail = '응답 없음 (server.log 확인)'
    if ($last) { $detail = "db=$($last.db), storage=$($last.storage)" }
    throw "서버 상태 확인 실패: $detail"
  }
  Write-PLLog -LogFile $Log -Message "서버 정상: version $($ok.version)"
} | Out-Null

# ---------------------------------------------------------------- 11. Funnel
$funnel = Join-Path $PSScriptRoot 'funnel.ps1'
if ($SkipFunnel) {
  Write-PLLog -LogFile $Log -Message "Funnel 단계 건너뜀 (-SkipFunnel)"
} else {
  & $funnel on -Port $Port -DryRun:$DryRun
  if (-not $DryRun -and $LASTEXITCODE -ne 0) { throw "Funnel 을 켜지 못했어요 (위 줄의 이유 — 안내서 8 · 12절)" }
  if (-not $DryRun) {
    $pub = Get-PLHealth -BaseUrl ($cfg.public_url.TrimEnd('/')) -TimeoutSec 20
    if ($pub -and $pub.ok) { Write-PLLog -LogFile $Log -Message "공개 주소 정상: $($cfg.public_url)/api/health" }
    else { Write-PLLog -LogFile $Log -Level WARN -Message "공개 주소 확인 실패 — 처음이면 Funnel 승인 페이지(브라우저)를 사용자가 승인했는지, 휴대폰 데이터로 다시 확인 (안내서 8 · 9절)" }
  }
}

# ---------------------------------------------------------------- 12. 요약
Write-PLLog -LogFile $Log -Message "---- 요약 ----"
foreach ($n in $taskNames) {
  $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
  $state = '없음'
  if ($t) { $state = [string]$t.State }
  Write-PLLog -LogFile $Log -Message "작업 '$n': $state"
}
if (Test-Path -LiteralPath (Join-Path $AppDir '.git')) {
  $commit = (Get-PLNativeText -FilePath git -Arguments @('-C', $AppDir, 'rev-parse', '--short=7', 'HEAD')).Trim()
  Write-PLLog -LogFile $Log -Message "배포 커밋: $commit"
}
if (-not $SkipFunnel -and -not $DryRun) { & $funnel status -Port $Port }
if ($DryRun) {
  if ($script:Problems.Count -gt 0) {
    Write-PLLog -Level WARN -Message "시험 실행 끝 — 확인 실패 $($script:Problems.Count)건 (실제 실행 전에 고쳐야 함)"
  } else {
    Write-PLLog -Message "시험 실행 끝 — 바꾼 것 없음"
  }
} else {
  Write-PLLog -LogFile $Log -Message "설치 끝"
}
exit 0
