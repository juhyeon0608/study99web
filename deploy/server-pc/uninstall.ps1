<#
.SYNOPSIS
  PaperLab 서버 PC 제거 (명세 20.1 — 가정): 작업 스케줄러 3개 삭제 · Funnel 끄기.

.DESCRIPTION
  저장소 · 로그 · cloud.env 는 지우지 않습니다 — 사용자가 직접 지웁니다.
  -KeepFunnel 이면 Funnel 은 그대로 둡니다. -DryRun 은 할 일만 보여 줍니다.
#>
[CmdletBinding()]
param([switch]$KeepFunnel, [switch]$DryRun)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$cfg = Get-PLConfig

foreach ($name in @($cfg.tasks.server, $cfg.tasks.backup, $cfg.tasks.watchdog)) {
  $t = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if (-not $t) {
    Write-PLLog -Message "작업 '$name' 없음"
    continue
  }
  Invoke-PLStep -DryRun:$DryRun -Description "작업 멈추고 삭제: '$name'" -Action {
    if ($t.State -eq 'Running') { Stop-ScheduledTask -TaskName $name }
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
  } | Out-Null
}
if (-not $KeepFunnel) {
  & (Join-Path $PSScriptRoot 'funnel.ps1') off -DryRun:$DryRun
}
Write-PLLog -Message "저장소 · 로그 · cloud.env 는 지우지 않았어요 (사용자가 직접)"
exit 0
