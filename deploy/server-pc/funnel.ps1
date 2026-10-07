<#
.SYNOPSIS
  Tailscale Funnel 켜기 · 상태 · 끄기 (명세 13.6절). 공개 443 → http://127.0.0.1:<포트> 하나만.

.DESCRIPTION
  on     : tailscale funnel --bg <포트>   (--bg 라 재부팅 · down/up 뒤에도 다시 켜짐)
  status : tailscale funnel status
  off    : tailscale funnel --https=443 off
  tailscale 실행 파일은 PATH → 기본 설치 경로 순으로 찾고, BackendState 가 Running 이 아니면 멈춥니다.
  켜기 전에 이 기기의 DNS 이름이 server.json 공개 주소의 호스트와 같은지 확인합니다(다르면 공개 주소가 바뀜 — 중단).
  인증서 발급이 실패하면 반복해서 다시 시도하지 마세요(Let's Encrypt 한도 — 약 34시간 대기).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\funnel.ps1 on
  powershell -ExecutionPolicy Bypass -File deploy\server-pc\funnel.ps1 status
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][ValidateSet('on', 'status', 'off')][string]$Action = 'status',
  [int]$Port = 0,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$cfg = Get-PLConfig
if ($Port -le 0) { $Port = [int]$cfg.port }
$publicHost = ([Uri]$cfg.public_url).Host.ToLowerInvariant()

$ts = Find-PLTailscale
if (-not $ts) {
  if ($DryRun) {
    Write-PLLog -Level WARN -Message "tailscale 을 찾지 못했어요 (시험 실행이라 계속)"
    $ts = 'tailscale'
  } else {
    Write-PLLog -Level ERROR -Message "tailscale 을 찾지 못했어요 — Tailscale 설치 · 로그인 (안내서 U-1)"
    exit 1
  }
}

function Get-TsStatus {
  try {
    return ((Get-PLNativeText -FilePath $ts -Arguments @('status', '--json')) | ConvertFrom-Json)
  } catch {
    return $null
  }
}

if ($Action -ne 'off') {
  $st = $null
  if (Find-PLTailscale) { $st = Get-TsStatus }
  if (-not $st -or $st.BackendState -ne 'Running') {
    $state = 'unknown'
    if ($st) { $state = $st.BackendState }
    if ($DryRun) {
      Write-PLLog -Level WARN -Message "Tailscale 상태가 Running 이 아니에요($state) — 시험 실행이라 계속"
    } else {
      Write-PLLog -Level ERROR -Message "Tailscale 상태가 Running 이 아니에요($state) — 로그인 · 무인 실행 확인 (안내서 U-1 · U-2)"
      exit 1
    }
  } elseif ($Action -eq 'on') {
    $dns = ([string]$st.Self.DNSName).TrimEnd('.').ToLowerInvariant()
    if ($dns -ne $publicHost) {
      if ($DryRun) {
        Write-PLLog -Level WARN -Message "이 기기의 DNS 이름($dns)이 공개 주소 호스트($publicHost)와 달라요 — 시험 실행이라 계속 (서버 PC가 아니면 정상)"
      } else {
        Write-PLLog -Level ERROR -Message "이 기기의 DNS 이름($dns)이 공개 주소 호스트($publicHost)와 달라요 — 멈추고 팀장에게 보고"
        exit 1
      }
    }
  }
}

switch ($Action) {
  'on' {
    Invoke-PLStep -DryRun:$DryRun -Description "Funnel 켜기: tailscale funnel --bg $Port (공개 443 → http://127.0.0.1:$Port)" -Action {
      $ErrorActionPreference = 'Continue'
      & $ts funnel --bg $Port
      if ($LASTEXITCODE -ne 0) { throw "tailscale funnel 실패 — 처음이면 브라우저 승인 페이지를 사용자가 승인 (안내서 8절)" }
    } | Out-Null
    if (-not $DryRun) { & $ts funnel status }
  }
  'status' {
    if ($DryRun -and -not (Find-PLTailscale)) { Write-PLLog -Level DRY -Message "[DRY] tailscale funnel status"; break }
    & $ts funnel status
  }
  'off' {
    Invoke-PLStep -DryRun:$DryRun -Description "Funnel 끄기: tailscale funnel --https=443 off (서버는 계속 돌지만 바깥에서 못 들어옴)" -Action {
      $ErrorActionPreference = 'Continue'
      & $ts funnel --https=443 off
      if ($LASTEXITCODE -ne 0) { throw "tailscale funnel off 실패" }
    } | Out-Null
  }
}
exit 0
