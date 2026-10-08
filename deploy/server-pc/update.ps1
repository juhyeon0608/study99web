<#
.SYNOPSIS
  PaperLab 서버 PC 업데이트 · 되돌리기 · 다시 시작 (명세 13.8절, 팀장 결정 S7 — 승인 · 푸시된 커밋을 수동 반영).

.DESCRIPTION
  1. git fetch → 배포 브랜치의 새 커밋 목록 → 진행 확인(-Yes 로 생략)
  2. 작업 폴더에 고친 파일이 있으면 중단 (서버 PC에서 코드를 고치지 않음)
  3. 지금 커밋을 update.log 에 기록 → git merge --ff-only (또는 -Ref 커밋으로 맞춤)
  4. pyproject.toml 이 바뀌었으면 pip install -e .
  5. python -m paperlab.migrate → admin sync-allowlist (서버를 멈추기 전에 — 옛 커밋으로 되돌릴 때는 건너뜀)
  6. 'PaperLab Server' 작업 멈춤 → 시작
  7. /api/health?deep=1 이 정상이고 commit 이 새 커밋인지 확인. 60초 안에 안 되면 자동으로 옛 커밋으로 되돌리고
     다시 시작 · 경고 (마이그레이션은 되돌리지 않음)
  8. 결과를 update.log 에
  9. (2단계 명세 13.7.1) 서버 상태 확인까지 성공했고 이번 반영에서 desktop\ 이 바뀌었으면(또는 -BuildDesktop) PC 앱 설치 파일 빌드:
     node · npm(22 이상) 확인 → desktop\ 에서 npm ci → npm run dist(electron-builder NSIS, 20분 제한, 캐시는 <루트>\cache)
     → <releases>\.staging 에서 latest.yml 의 sha512 · 크기를 실제 .exe 와 맞춰 본 뒤 .exe · .blockmap · release.json · latest.yml(마지막)
     순서로 옮김 → 최근 3개 버전만 보관. 버전(desktop\package.json)이 이미 releases 에 있으면 빌드하지 않고 WARN.
     빌드가 실패해도 WARN 만 남기고 이전 설치 파일을 그대로 둠 — 종료 코드는 서버 업데이트 결과대로(성공 0).
     -Ref(특정 커밋 · 되돌리기) · -RestartOnly · 상태 확인 실패로 되돌린 경우에는 빌드하지 않음.
     releases 폴더는 서버와 같은 규칙: 환경 변수 PAPERLAB_RELEASES_DIR → cloud.env 의 같은 키(이 한 줄만 읽음) → D:\PaperLab\releases.
  코드 반영 뒤 단계(pip install · 마이그레이션 · 재시작 · 확인)가 실패하면 옛 커밋으로 되돌림 — 종료 코드 1.
  관리자 권한(elevated)으로 실행하면 시작할 때 경고 한 줄만 남기고 계속함(새 파일 소유자가 Administrators 가 되지만
  D:\PaperLab 상속 권한으로 서버 계정이 접근할 수 있음 — 소유자는 바꾸지 않음). 가능하면 일반 권한 PowerShell 에서 실행.

  -DryRun: git fetch 만 함(원격 추적 브랜치 · FETCH_HEAD · 객체 · 태그 갱신 — 작업 폴더 · HEAD · 브랜치는 그대로).
           반영할 커밋과 그 뒤 할 일은 [DRY] 줄로 보여 주기만 하고 update.log 도 쓰지 않음.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\update.ps1
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\update.ps1 -Ref 1a2b3c4      # 특정 커밋으로
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\update.ps1 -RestartOnly      # cloud.env 를 고친 뒤
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\update.ps1 -BuildDesktop     # 처음 배포 · 지난 빌드 실패 뒤 다시(새 커밋이 없어도)
#>
[CmdletBinding()]
param(
  [string]$Ref,
  [switch]$Yes,
  [switch]$RestartOnly,
  [string]$AppDir,
  [string]$LogDir,
  [string]$Branch,
  [int]$Port = 0,
  [string]$EnvFile,
  [string]$Remote = 'origin',
  [int]$TimeoutSec = 60,
  [switch]$DryRun,
  [switch]$BuildDesktop,
  [string]$ReleasesDir,
  [string]$CacheDir,
  [int]$BuildTimeoutSec = 1200
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$cfg = Get-PLConfig
if (-not $AppDir) { $AppDir = Get-PLRepoRoot }
if (-not $LogDir) { $LogDir = Join-Path $cfg.root 'logs' }
if (-not $Branch) { $Branch = $cfg.branch }
if ($Port -le 0) { $Port = [int]$cfg.port }
if (-not $EnvFile) { $EnvFile = Get-PLDefaultEnvFile }
$TaskServer = $cfg.tasks.server
if (-not $ReleasesDir) { $ReleasesDir = Get-PLReleasesDir -EnvFile $EnvFile }
if (-not $CacheDir) { $CacheDir = Join-Path $cfg.root 'cache' }
$Log = $null
if (-not $DryRun) { $Log = Join-Path $LogDir 'update.log' }
$Py = Get-PLVenvPython -AppDir $AppDir

function Invoke-PLGit {
  # 단순 함수($args) — git 인자(--hard 등)를 PowerShell 매개변수로 해석하지 않고 그대로 넘긴다
  $ErrorActionPreference = 'Continue'
  $out = & git.exe -C $AppDir @args
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') 실패" }
  return $out
}

function Restart-AndCheck {
  param([string]$ExpectCommit)
  Restart-PLServerTask -TaskName $TaskServer -Port $Port -LogFile $Log -DryRun:$DryRun
  if ($DryRun) {
    Write-PLLog -Level DRY -Message "[DRY] 상태 확인: http://127.0.0.1:$Port/api/health?deep=1 (commit $ExpectCommit, 최대 $TimeoutSec 초)"
    return $true
  }
  $h = Wait-PLHealth -Port $Port -Deep -TimeoutSec $TimeoutSec -Commit $ExpectCommit
  return [bool]$h
}

function Build-Desktop {
  <# 9단계 — 서버 반영 · 상태 확인이 끝난 뒤에만 부름. 실패해도 WARN 만(종료 코드에 영향 없음) #>
  param([switch]$Changed, [string]$Commit)
  try {
    Invoke-PLDesktopBuild -AppDir $AppDir -ReleasesDir $ReleasesDir -CacheDir $CacheDir -LogDir $LogDir -LogFile $Log -Commit $Commit `
      -TimeoutSec $BuildTimeoutSec -Changed:$Changed -DryRun:$DryRun | Out-Null
  } catch {
    Write-PLLog -LogFile $Log -Level WARN -Message "데스크톱 앱 빌드 단계 오류: $($_.Exception.Message) — 이전 설치 파일을 그대로 둬요 (서버 업데이트 결과에는 영향 없음)"
  }
}

function Install-Deps {
  Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "의존성 다시 설치: pip install -e . (pyproject.toml 바뀜)" -Action {
    $code = Invoke-PLNative -FilePath $Py -Arguments @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-e', '.') -WorkingDirectory $AppDir
    if ($code -ne 0) { throw "pip install 실패" }
  } | Out-Null
}

# ---------------------------------------------------------------- 다시 시작만
if ($RestartOnly) {
  Write-PLLog -LogFile $Log -Message "다시 시작만 (-RestartOnly)"
  $head = ((Invoke-PLGit rev-parse --short=7 HEAD) | Out-String).Trim()
  $restarted = $false
  try {
    $restarted = Restart-AndCheck -ExpectCommit $head
  } catch {
    Write-PLLog -LogFile $Log -Level ERROR -Message "다시 시작 단계 오류: $($_.Exception.Message)"
  }
  if ($restarted) {
    if ($DryRun) { Write-PLLog -Level DRY -Message "[DRY] 시험 실행 끝 — 바꾼 것 없음" }
    else { Write-PLLog -LogFile $Log -Message "다시 시작 정상 (커밋 $head)" }
    exit 0
  }
  Write-PLLog -LogFile $Log -Level ERROR -Message "다시 시작 뒤 상태 확인 실패 — server.log 확인"
  exit 1
}

# ---------------------------------------------------------------- 1 · 2. 새 커밋 · 깨끗한 작업 폴더
if (Test-PLIsAdmin) {
  Write-PLLog -LogFile $Log -Level WARN -Message ("관리자 권한으로 실행 중: 새로 받는 파일의 소유자가 Administrators가 되지만, " +
    "상속 권한으로 서버 계정이 접근할 수 있어 동작에는 영향이 없습니다. 가능하면 일반 권한 PowerShell에서 실행하세요.")
}
# 시험 실행도 fetch 는 함 — 원격 추적 브랜치 · FETCH_HEAD · 객체 · 태그만 갱신하고 작업 폴더 · HEAD · 브랜치는 바꾸지 않음
if ($DryRun) {
  Write-PLLog -Level DRY -Message "[DRY] git fetch $Remote (시험 실행도 받음 — 작업 폴더 · HEAD · 브랜치는 그대로)"
} else {
  Write-PLLog -LogFile $Log -Message "git fetch $Remote"
}
Invoke-PLGit fetch --quiet $Remote | Out-Null
$dirty = (Invoke-PLGit status --porcelain) | Out-String
if ($dirty.Trim()) {
  Write-PLLog -LogFile $Log -Level ERROR -Message "작업 폴더에 고친 파일이 있어 업데이트하지 않아요 (서버 PC에서 코드를 고치지 않음 — 팀장에게 보고):`n$($dirty.TrimEnd())"
  exit 1
}
$old = ((Invoke-PLGit rev-parse HEAD) | Out-String).Trim()
$oldShort = $old.Substring(0, 7)
if ($Ref) {
  $target = ((Invoke-PLGit rev-parse --verify "$Ref^{commit}") | Out-String).Trim()
} else {
  $cur = ((Invoke-PLGit rev-parse --abbrev-ref HEAD) | Out-String).Trim()
  if ($cur -ne $Branch) {
    Write-PLLog -LogFile $Log -Level ERROR -Message "지금 브랜치($cur)가 배포 브랜치($Branch)가 아니에요"
    exit 1
  }
  $target = ((Invoke-PLGit rev-parse --verify "$Remote/$Branch^{commit}") | Out-String).Trim()
}
$newShort = $target.Substring(0, 7)
if ($target -eq $old) {
  Write-PLLog -LogFile $Log -Message "새 커밋이 없어요 (지금 $oldShort)"
  if ($BuildDesktop -and -not $Ref) { Build-Desktop -Commit $oldShort }
  exit 0
}
$ErrorActionPreference = 'Continue'
& git.exe -C $AppDir merge-base --is-ancestor $old $target
$forward = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if (-not $Ref -and -not $forward) {
  Write-PLLog -LogFile $Log -Level ERROR -Message "원격 브랜치가 지금 커밋에서 앞으로만 갈 수 없어요(ff-only 불가) — 팀장에게 보고"
  exit 1
}
Write-Host "반영할 커밋 ($oldShort → $newShort):"
if ($forward) { (Invoke-PLGit log --oneline "$old..$target") | ForEach-Object { Write-Host "  $_" } }
else { Write-Host "  (옛 커밋으로 되돌리기)" }
if (-not $Yes -and -not $DryRun) {
  $answer = Read-Host "진행할까요? (y/N)"
  if ($answer -notin @('y', 'Y', 'yes')) { Write-Host "취소했어요."; exit 0 }
}

# ---------------------------------------------------------------- 3 ~ 7. 반영 · 마이그레이션 · 재시작 · 확인 · 실패 시 되돌리기
# 코드 반영 뒤 어느 단계에서 실패해도(pip install 포함 — 품질팀 M1) 옛 커밋으로 되돌리고 결과 줄을 남긴다 (품질팀 F2).
# 마이그레이션 실패만은 서버를 멈추기 전이라 다시 시작하지 않음(서버는 옛 코드로 계속)
Write-PLLog -LogFile $Log -Message "업데이트 시작: $oldShort → $newShort"
$pyprojectChanged = [bool](((Invoke-PLGit diff --name-only $old $target '--' pyproject.toml) | Out-String).Trim())
$desktopChanged = [bool](((Invoke-PLGit diff --name-only $old $target '--' desktop/) | Out-String).Trim())
$updated = $false
$migrated = $false
$migrationFailed = $false
$result = "업데이트 실패: $oldShort → $newShort"
try {
  # 3 · 4. 코드 반영 → (pyproject.toml 이 바뀌었으면) 의존성 다시 설치
  $applied = $false
  try {
    Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "코드 반영: $newShort" -Action {
      if ($Ref) { Invoke-PLGit reset --hard --quiet $target | Out-Null } else { Invoke-PLGit merge --ff-only --quiet $target | Out-Null }
    } | Out-Null
    if ($pyprojectChanged) { Install-Deps }
    $applied = $true
  } catch {
    Write-PLLog -LogFile $Log -Level ERROR -Message "코드 반영 · 의존성 설치 단계 오류: $($_.Exception.Message)"
  }

  # 5. 마이그레이션 (앞으로 갈 때만)
  if ($applied) {
    if ($forward) {
      try {
        Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "마이그레이션: python -m paperlab.migrate → admin sync-allowlist" -Action {
          $code = Invoke-PLNative -FilePath $Py -Arguments @('-m', 'paperlab.migrate', '--env-file', $EnvFile) -WorkingDirectory $AppDir
          if ($code -ne 0) { throw "마이그레이션 실패" }
          $code = Invoke-PLNative -FilePath $Py -Arguments @('-m', 'paperlab.admin', '--env-file', $EnvFile, 'sync-allowlist') -WorkingDirectory $AppDir
          if ($code -ne 0) { throw "허용 목록 맞추기 실패" }
        } | Out-Null
        $migrated = $true
      } catch {
        Write-PLLog -LogFile $Log -Level ERROR -Message "$($_.Exception.Message) — 코드를 $oldShort 로 되돌려요 (서버는 다시 시작하지 않음 · 옛 코드로 계속)"
        $migrationFailed = $true
      }
    } else {
      Write-PLLog -LogFile $Log -Message "옛 커밋으로 되돌리기라 마이그레이션은 하지 않아요 (DB 마이그레이션은 되돌리지 않음)"
    }
  }

  # 6 · 7. 재시작 · 확인 (재시작 단계에서 예외가 나도 — 작업 권한 오류 등 — 아래에서 되돌림)
  if ($applied -and -not $migrationFailed) {
    try {
      $updated = Restart-AndCheck -ExpectCommit $newShort
      if (-not $updated) { Write-PLLog -LogFile $Log -Level ERROR -Message "새 커밋 $newShort 상태 확인 실패($TimeoutSec 초)" }
    } catch {
      Write-PLLog -LogFile $Log -Level ERROR -Message "재시작 단계 오류: $($_.Exception.Message)"
    }
  }
  if ($updated) {
    if ($DryRun) { $result = "[DRY] 시험 실행 끝 — git fetch 만 했고 나머지는 바꾸지 않음 ($oldShort → $newShort 예정)" }
    else { $result = "업데이트 성공: $oldShort → $newShort" }
  }
} finally {
  if (-not $updated) {
    if (-not $migrationFailed) { Write-PLLog -LogFile $Log -Level ERROR -Message "$oldShort 로 자동 되돌림" }
    try {
      Invoke-PLGit reset --hard --quiet $old | Out-Null
      if ($pyprojectChanged) { Install-Deps }
    } catch {
      Write-PLLog -LogFile $Log -Level ERROR -Message "코드 되돌리기 오류: $($_.Exception.Message) — 팀장에게 보고"
    }
    if ($migrationFailed) {
      $result = "업데이트 실패: $oldShort → $newShort (마이그레이션 단계)"
    } else {
      if ($migrated) {
        Write-PLLog -LogFile $Log -Level WARN -Message "DB 마이그레이션은 $newShort 기준으로 적용된 상태로 남아요(되돌리지 않음) — 옛 코드와 함께 돌아도 되는 규칙이지만 팀장에게 보고"
      }
      $back = $false
      try {
        $back = Restart-AndCheck -ExpectCommit $oldShort
      } catch {
        Write-PLLog -LogFile $Log -Level ERROR -Message "되돌린 뒤 재시작 오류: $($_.Exception.Message)"
      }
      if ($back) { $result = "업데이트 실패 · 되돌림 완료: $newShort → $oldShort (서버 정상). 팀장에게 보고" }
      else { $result = "업데이트 실패 · 되돌린 뒤에도 서버 상태 확인 실패 ($oldShort) — server.log 확인, 팀장에게 보고" }
    }
  }
  if ($updated) { Write-PLLog -LogFile $Log -Message $result }
  else { Write-PLLog -LogFile $Log -Level ERROR -Message $result }
}
# 9. PC 앱 설치 파일 빌드 — 서버 재시작 · 상태 확인이 끝난 뒤(빌드가 서버 반영을 늦추거나 막지 않게). 실패는 WARN 만
if ($updated) {
  if ($Ref) {
    if ($desktopChanged -or $BuildDesktop) { Write-PLLog -LogFile $Log -Message "-Ref 로 커밋을 맞춘 경우라 데스크톱 앱은 빌드하지 않아요 (앱은 다운그레이드하지 않음)" }
  } elseif ($desktopChanged -or $BuildDesktop) {
    Build-Desktop -Changed:$desktopChanged -Commit $newShort
  }
  exit 0
}
exit 1
