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

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\update.ps1
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\update.ps1 -Ref 1a2b3c4      # 특정 커밋으로
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\update.ps1 -RestartOnly      # cloud.env 를 고친 뒤
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
  [switch]$DryRun
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
if ($DryRun) {
  Write-PLLog -Level DRY -Message "[DRY] git fetch $Remote (시험 실행은 받지 않고 지금 있는 원격 기록으로 계산)"
} else {
  Write-PLLog -LogFile $Log -Message "git fetch $Remote"
  Invoke-PLGit fetch --quiet $Remote | Out-Null
}
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

# ---------------------------------------------------------------- 3 · 4. 코드 반영
Write-PLLog -LogFile $Log -Message "업데이트 시작: $oldShort → $newShort"
$pyprojectChanged = [bool](((Invoke-PLGit diff --name-only $old $target '--' pyproject.toml) | Out-String).Trim())
Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "코드 반영: $newShort" -Action {
  if ($Ref) { Invoke-PLGit reset --hard --quiet $target | Out-Null } else { Invoke-PLGit merge --ff-only --quiet $target | Out-Null }
} | Out-Null
if ($pyprojectChanged) { Install-Deps }

# ---------------------------------------------------------------- 5. 마이그레이션 (앞으로 갈 때만)
if ($forward) {
  try {
    Invoke-PLStep -DryRun:$DryRun -LogFile $Log -Description "마이그레이션: python -m paperlab.migrate → admin sync-allowlist" -Action {
      $code = Invoke-PLNative -FilePath $Py -Arguments @('-m', 'paperlab.migrate', '--env-file', $EnvFile) -WorkingDirectory $AppDir
      if ($code -ne 0) { throw "마이그레이션 실패" }
      $code = Invoke-PLNative -FilePath $Py -Arguments @('-m', 'paperlab.admin', '--env-file', $EnvFile, 'sync-allowlist') -WorkingDirectory $AppDir
      if ($code -ne 0) { throw "허용 목록 맞추기 실패" }
    } | Out-Null
  } catch {
    Write-PLLog -LogFile $Log -Level ERROR -Message "$($_.Exception.Message) — 코드를 $oldShort 로 되돌려요 (서버는 다시 시작하지 않음 · 옛 코드로 계속)"
    Invoke-PLGit reset --hard --quiet $old | Out-Null
    if ($pyprojectChanged) { Install-Deps }
    Write-PLLog -LogFile $Log -Level ERROR -Message "업데이트 실패: $oldShort → $newShort (마이그레이션 단계)"
    exit 1
  }
} else {
  Write-PLLog -LogFile $Log -Message "옛 커밋으로 되돌리기라 마이그레이션은 하지 않아요 (DB 마이그레이션은 되돌리지 않음)"
}

# ---------------------------------------------------------------- 6 · 7. 재시작 · 확인 · 실패 시 되돌리기
# 재시작 단계에서 예외가 나도(작업 권한 오류 등) 옛 커밋으로 되돌리고 결과 줄을 남긴다 (품질팀 F2)
$updated = $false
$result = "업데이트 실패: $oldShort → $newShort"
try {
  try {
    $updated = Restart-AndCheck -ExpectCommit $newShort
    if (-not $updated) { Write-PLLog -LogFile $Log -Level ERROR -Message "새 커밋 $newShort 상태 확인 실패($TimeoutSec 초)" }
  } catch {
    Write-PLLog -LogFile $Log -Level ERROR -Message "재시작 단계 오류: $($_.Exception.Message)"
  }
  if ($updated) {
    if ($DryRun) { $result = "[DRY] 시험 실행 끝 — 바꾼 것 없음 ($oldShort → $newShort 예정)" }
    else { $result = "업데이트 성공: $oldShort → $newShort" }
  }
} finally {
  if (-not $updated) {
    Write-PLLog -LogFile $Log -Level ERROR -Message "$oldShort 로 자동 되돌림"
    try {
      Invoke-PLGit reset --hard --quiet $old | Out-Null
      if ($pyprojectChanged) { Install-Deps }
    } catch {
      Write-PLLog -LogFile $Log -Level ERROR -Message "코드 되돌리기 오류: $($_.Exception.Message) — 팀장에게 보고"
    }
    if ($forward) {
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
  if ($updated) { Write-PLLog -LogFile $Log -Message $result }
  else { Write-PLLog -LogFile $Log -Level ERROR -Message $result }
}
if ($updated) { exit 0 }
exit 1
