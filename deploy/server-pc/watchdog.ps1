<#
.SYNOPSIS
  PaperLab 감시 (작업 스케줄러 'PaperLab Watchdog' — 5분마다, 명세 13.5절). 결과는 watchdog.log (1MB × 5 회전).

.DESCRIPTION
  매번  : http://127.0.0.1:<포트>/api/health (DB를 건드리지 않음). 연속 3번 실패(15분)면 'PaperLab Server' 작업을
          멈췄다 다시 시작. 재시작은 1시간에 3번까지 — 넘으면 경고만.
  하루 한 번:
          - 공개 주소 /api/health — 실패하면 `tailscale funnel status` 의 주소 · 포트 줄을 경고로 (자동 복구 안 함)
          - R2 가장 최근 백업 날짜(admin latest-backup) — 36시간 넘으면 경고
          - 디스크 여유: 시스템 드라이브 5GB · 데이터 드라이브(루트) 20GB 미만이면 경고
  외부 알림은 보내지 않습니다(범위 밖). -DryRun 은 재시작을 실제로 하지 않고 "[DRY]" 로만 남깁니다.
#>
[CmdletBinding()]
param(
  [int]$Port = 0,
  [string]$LogDir,
  [string]$Root,
  [string]$EnvFile,
  [string]$AppDir,
  [string]$StateFile,
  [int]$FailLimit = 3,
  [int]$MaxRestartsPerHour = 3,
  [int]$TimeoutSec = 10,
  [double]$MinFreeGBSystem = 5,
  [double]$MinFreeGBData = 20,
  [double]$BackupMaxHours = 36,
  [switch]$SkipDaily,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$cfg = Get-PLConfig
if ($Port -le 0) { $Port = [int]$cfg.port }
if (-not $Root) { $Root = $cfg.root }
if (-not $LogDir) { $LogDir = Join-Path $Root 'logs' }
if (-not $AppDir) { $AppDir = Get-PLRepoRoot }
if (-not $EnvFile) { $EnvFile = Get-PLDefaultEnvFile }
if (-not $StateFile) { $StateFile = Join-Path $LogDir 'watchdog-state.json' }
$Log = Join-Path $LogDir 'watchdog.log'
if ($DryRun) { $Log = $null }   # 시험 실행: 로그 · 상태 파일을 바꾸지 않고 화면에만 (품질팀 F3)
$TaskServer = $cfg.tasks.server

# ---------------------------------------------------------------- 상태 파일
$state = [pscustomobject]@{ failures = 0; restarts = @(); lastDaily = '' }
if (Test-Path -LiteralPath $StateFile) {
  try {
    $loaded = Get-Content -LiteralPath $StateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $state.failures = [int]$loaded.failures
    $state.restarts = @($loaded.restarts | Where-Object { $_ })
    $state.lastDaily = [string]$loaded.lastDaily
  } catch {
    Write-PLLog -LogFile $Log -Level WARN -Message "상태 파일을 읽지 못해 새로 시작해요: $StateFile"
  }
}

function Save-State {
  $dir = Split-Path -Parent $StateFile
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  ($state | ConvertTo-Json -Compress) | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

# ---------------------------------------------------------------- 1. 로컬 상태 · 멈춤 시 재시작
$h = Get-PLHealth -Port $Port -TimeoutSec $TimeoutSec
if ($h -and $h.ok) {
  if ($state.failures -gt 0) { Write-PLLog -LogFile $Log -Message "서버 응답 회복 (연속 실패 $($state.failures)번 뒤)" }
  $state.failures = 0
} else {
  $state.failures = [int]$state.failures + 1
  Write-PLLog -LogFile $Log -Level WARN -Message "서버 상태 확인 실패 $($state.failures)/$FailLimit (http://127.0.0.1:$Port/api/health)"
  if ($state.failures -ge $FailLimit) {
    $hourAgo = (Get-Date).AddHours(-1)
    $recent = @($state.restarts | Where-Object { [datetime]::Parse($_) -gt $hourAgo })
    if ($recent.Count -ge $MaxRestartsPerHour) {
      Write-PLLog -LogFile $Log -Level WARN -Message "최근 1시간 재시작 $($recent.Count)번 — 한도($MaxRestartsPerHour)라 다시 시작하지 않아요. server.log 확인 필요"
    } else {
      try {
        Restart-PLServerTask -TaskName $TaskServer -Port $Port -LogFile $Log -DryRun:$DryRun
        if ($DryRun) { Write-PLLog -Level DRY -Message "[DRY] 다시 시작할 차례 (시험 실행 — 기록하지 않음)" }
        else { Write-PLLog -LogFile $Log -Level WARN -Message "응답이 없어 '$TaskServer' 작업을 다시 시작했어요" }
        $state.restarts = @($recent) + @((Get-Date).ToString('o'))
        $state.failures = 0
      } catch {
        Write-PLLog -LogFile $Log -Level ERROR -Message "다시 시작하지 못했어요: $($_.Exception.Message)"
      }
    }
  }
}

# ---------------------------------------------------------------- 2. 하루 한 번
$today = (Get-Date).ToString('yyyy-MM-dd')
if (-not $SkipDaily -and $state.lastDaily -ne $today) {
  $state.lastDaily = $today
  # 공개 주소
  $pub = Get-PLHealth -BaseUrl ($cfg.public_url.TrimEnd('/')) -TimeoutSec 20
  if ($pub -and $pub.ok) {
    Write-PLLog -LogFile $Log -Message "공개 주소 정상: $($cfg.public_url)"
  } else {
    $lines = ''
    $ts = Find-PLTailscale
    if ($ts) {
      try { $lines = ((Get-PLNativeText -FilePath $ts -Arguments @('funnel', 'status')) -split "`n" | Where-Object { $_ -match 'https://|proxy|127\.0\.0\.1' } | ForEach-Object { $_.Trim() }) -join ' | ' } catch { $lines = '(funnel status 실패)' }
    } else { $lines = '(tailscale 없음)' }
    Write-PLLog -LogFile $Log -Level WARN -Message "공개 주소 확인 실패: $($cfg.public_url) — funnel status: $lines"
  }
  # 최근 백업 (R2)
  $py = Get-PLVenvPython -AppDir $AppDir
  if (Test-Path -LiteralPath $py) {
    $ErrorActionPreference = 'Continue'
    $out = (& $py -m paperlab.admin --env-file $EnvFile latest-backup --max-hours $BackupMaxHours 2>$null) | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($code -eq 0) { Write-PLLog -LogFile $Log -Message $out.Trim() }
    else { Write-PLLog -LogFile $Log -Level WARN -Message "새 백업이 $BackupMaxHours 시간 넘게 없거나 확인 실패: $($out.Trim()) (backup.log · 작업 'PaperLab Backup' 확인)" }
  }
  # 디스크 여유
  $sysDrive = $env:SystemDrive.TrimEnd(':')
  $dataDrive = (Split-Path -Qualifier $Root).TrimEnd(':')
  foreach ($pair in @(@($sysDrive, $MinFreeGBSystem), @($dataDrive, $MinFreeGBData))) {
    $d = Get-PSDrive -Name $pair[0] -ErrorAction SilentlyContinue
    if (-not $d) { continue }
    $free = [math]::Round($d.Free / 1GB, 1)
    if ($free -lt $pair[1]) { Write-PLLog -LogFile $Log -Level WARN -Message "$($pair[0]): 여유 $free GB (기준 $($pair[1]) GB 미만)" }
  }
}

if ($DryRun) {
  Write-PLLog -Level DRY -Message ("[DRY] 상태 파일은 그대로 (지금 연속 실패 {0}번)" -f $state.failures)
} else {
  Save-State
}
exit 0
