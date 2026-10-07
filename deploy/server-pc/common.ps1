<#
  PaperLab 서버 PC 스크립트 공통 함수 (install · update · funnel · watchdog · uninstall 이 dot-source 로 읽음).
  - 설정은 같은 폴더의 server.json(공개 주소 · 포트 · 기본 경로 · 작업 이름 — 비밀 없음, 팀장 결정 S10).
  - cloud.env 의 값은 읽지 않는다. 확인은 `python -m paperlab.serve --check`(변수 이름만)로.
  - Windows PowerShell 5.1 기준 (?? · ?: 연산자 쓰지 않음).
#>

$script:PLSidSystem = 'S-1-5-18'
$script:PLSidAdmins = 'S-1-5-32-544'

function Get-PLConfig {
  param([string]$Path = (Join-Path $PSScriptRoot 'server.json'))
  if (-not (Test-Path -LiteralPath $Path)) { throw "설정 파일이 없어요: $Path" }
  return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Get-PLRepoRoot {
  # deploy\server-pc 의 두 단계 위 = 저장소
  return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Get-PLDefaultEnvFile {
  return (Join-Path $env:USERPROFILE '.paperlab\cloud.env')
}

function Get-PLVenvPython {
  param([Parameter(Mandatory = $true)][string]$AppDir)
  return (Join-Path $AppDir '.venv\Scripts\python.exe')
}

function Write-PLLog {
  <# 화면 + (LogFile 이 있으면) 회전 로그 파일. 1MB 넘으면 .1~.5 로 밀어냄 (명세 13.5 — 합계 제한) #>
  param(
    [string]$LogFile,
    [ValidateSet('INFO', 'WARN', 'ERROR', 'DRY')][string]$Level = 'INFO',
    [Parameter(Mandatory = $true)][string]$Message,
    [int]$MaxBytes = 1048576,
    [int]$Keep = 5
  )
  $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz'), $Level, $Message
  $color = 'Gray'
  if ($Level -eq 'WARN') { $color = 'Yellow' } elseif ($Level -eq 'ERROR') { $color = 'Red' } elseif ($Level -eq 'DRY') { $color = 'Cyan' }
  Write-Host $line -ForegroundColor $color
  if (-not $LogFile) { return }
  try {
    $dir = Split-Path -Parent $LogFile
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if ((Test-Path -LiteralPath $LogFile) -and ((Get-Item -LiteralPath $LogFile).Length -gt $MaxBytes)) {
      for ($i = $Keep - 1; $i -ge 1; $i--) {
        $src = "$LogFile.$i"
        if (Test-Path -LiteralPath $src) { Move-Item -LiteralPath $src -Destination "$LogFile.$($i + 1)" -Force }
      }
      Move-Item -LiteralPath $LogFile -Destination "$LogFile.1" -Force
    }
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
  } catch {
    Write-Host "로그 파일에 쓰지 못했어요: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Invoke-PLStep {
  <# 바꾸는 동작은 모두 이 함수로: -DryRun 이면 "[DRY]" 한 줄만 찍고 실행하지 않는다 #>
  param(
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [switch]$DryRun,
    [string]$LogFile
  )
  if ($DryRun) {
    Write-PLLog -Level DRY -Message "[DRY] $Description"
    return $null
  }
  Write-PLLog -LogFile $LogFile -Message $Description
  return (& $Action)
}

function Invoke-PLNative {
  <# 외부 명령 실행: 출력은 그대로 보여 주고 종료 코드를 돌려준다 (값을 찍는 명령은 부르지 않음) #>
  param([Parameter(Mandatory = $true)][string]$FilePath, [string[]]$Arguments = @(), [string]$WorkingDirectory)
  # PowerShell 5.1 은 Stop 일 때 외부 명령의 표준 오류(파이썬 로그 등)를 오류로 바꿀 수 있어 이 함수 안에서만 Continue
  $ErrorActionPreference = 'Continue'
  $old = Get-Location
  try {
    if ($WorkingDirectory) { Set-Location -LiteralPath $WorkingDirectory }
    & $FilePath @Arguments | ForEach-Object { Write-Host "    $_" }
    return $LASTEXITCODE
  } finally {
    Set-Location -LiteralPath $old
  }
}

function Get-PLNativeText {
  <# 외부 명령의 출력(표준 출력 + 표준 오류)을 문자열로. 실행 파일이 없거나 실패해도 예외 없이 '' #>
  param([Parameter(Mandatory = $true)][string]$FilePath, [string[]]$Arguments = @())
  $ErrorActionPreference = 'Continue'
  try {
    return ((& $FilePath @Arguments 2>&1 | ForEach-Object { "$_" }) -join "`n")
  } catch {
    return ''
  }
}

function Get-PLCurrentSid {
  return [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
}

function Test-PLIsAdmin {
  <# 관리자 권한(elevated)으로 실행 중인지. UAC 로 걸러진 일반 셸은 Administrators 구성원이어도 $false #>
  return ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-PLAclProblems {
  <# 허용(Allow) 항목 중 현재 사용자 · SYSTEM · Administrators 가 아닌 계정 이름과 상속 여부 #>
  param([Parameter(Mandatory = $true)][string]$Path)
  $ok = @((Get-PLCurrentSid), $script:PLSidSystem, $script:PLSidAdmins)
  $acl = Get-Acl -LiteralPath $Path
  $bad = @()
  $badSids = @()
  foreach ($a in $acl.Access) {
    $sid = $null
    try { $sid = $a.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $sid = $a.IdentityReference.Value }
    if ($a.AccessControlType -eq 'Allow' -and $ok -notcontains $sid) { $bad += $a.IdentityReference.Value; $badSids += $sid }
  }
  return [pscustomobject]@{ Inherited = (-not $acl.AreAccessRulesProtected); Others = @($bad | Sort-Object -Unique);
                            OtherSids = @($badSids | Sort-Object -Unique) }
}

function Set-PLRestrictedAcl {
  <# 상속을 끊고 현재 사용자 · SYSTEM · Administrators 만 전체 권한 (명세 13.1-3 · 9.1, AC-58). SID 로 지정해 언어와 무관 #>
  param([Parameter(Mandatory = $true)][string]$Path, [switch]$Directory, [switch]$DryRun, [string]$LogFile)
  $inherit = ''
  if ($Directory) { $inherit = '(OI)(CI)' }
  $me = Get-PLCurrentSid
  $grants = @("*${me}:${inherit}F", "*$($script:PLSidSystem):${inherit}F", "*$($script:PLSidAdmins):${inherit}F")
  Invoke-PLStep -DryRun:$DryRun -LogFile $LogFile -Description "권한 제한(상속 끊기, 현재 사용자 · SYSTEM · Administrators만): $Path" -Action {
    $args1 = @($Path, '/inheritance:r', '/grant:r') + $grants
    & icacls.exe @args1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "icacls 실패: $Path" }
    # 명시적으로 남아 있던 다른 계정 항목 지우기
    $p = Get-PLAclProblems -Path $Path
    foreach ($sid in $p.OtherSids) {
      & icacls.exe $Path '/remove:g' "*$sid" | Out-Null
    }
    $p = Get-PLAclProblems -Path $Path
    if ($p.Inherited -or $p.Others.Count -gt 0) { throw "권한 제한을 확인하지 못했어요: $Path ($($p.Others -join ', '))" }
  } | Out-Null
}

function Reset-PLInheritedAcl {
  <# 폴더 하나의 권한을 상속 상태로 되돌림 — 그 폴더만(icacls /reset, 하위로 내려가는 스위치 없음). 상속받는 하위 항목은
     시스템이 다시 전파하고 정션은 따라가지 않는다. 하위로 내려가게 하면 정션을 따라 바깥 폴더 ACL까지 초기화됨
     (품질팀 점검 · 팀장 결정 B). icacls 종료 코드를 돌려준다 — /C 를 붙이면 실패해도 0 이라 붙이지 않음(한 폴더만이라 필요 없음) #>
  param([Parameter(Mandatory = $true)][string]$Path)
  & icacls.exe $Path /reset /Q | Out-Null
  return $LASTEXITCODE
}

function Get-PLReparsePoints {
  <# 주어진 경로 중 재분석 지점(정션 · 심볼릭 링크)인 것만 돌려줌. 아직 없는 경로는 건너뜀(통과) — 팀장 결정 C.
     대상이 없는 정션도 항목은 있으므로 걸린다. 같은 경로(대소문자 · 끝의 \ 만 다른 것 포함)는 한 번만 #>
  param([string[]]$Paths = @())
  $hits = @()
  $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($p in $Paths) {
    if (-not $p) { continue }
    if (-not $seen.Add($p.TrimEnd('\'))) { continue }
    $item = Get-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue
    if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $hits += $p }
  }
  return $hits
}

function Find-PLTailscale {
  $cmd = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @((Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Tailscale\tailscale.exe'))) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

function Get-PLHealth {
  <# http://127.0.0.1:<포트>/api/health[?deep=1] — 실패하면 $null #>
  param([int]$Port = 8080, [switch]$Deep, [int]$TimeoutSec = 10, [string]$BaseUrl)
  if (-not $BaseUrl) { $BaseUrl = "http://127.0.0.1:$Port" }
  $url = "$BaseUrl/api/health"
  if ($Deep) { $url += '?deep=1' }
  try {
    return (Invoke-RestMethod -Uri $url -TimeoutSec $TimeoutSec -UseBasicParsing -ErrorAction Stop)
  } catch {
    return $null
  }
}

function Wait-PLHealth {
  <# 상태 확인이 통과할 때까지 기다림. -Deep 이면 db · storage 모두 ok, -Commit 이 있으면 그 커밋이어야 함.
     다른 요청의 확인이 진행 중이면 서버가 pending 을 돌려주는데, ok 가 아니므로 전체 대기 시간 안에서 다시 묻는다 #>
  param([int]$Port = 8080, [switch]$Deep, [int]$TimeoutSec = 60, [string]$Commit)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    $h = Get-PLHealth -Port $Port -Deep:$Deep -TimeoutSec 10
    if ($h -and $h.ok) {
      if (-not $Commit -or ($h.commit -and $Commit.StartsWith([string]$h.commit))) { return $h }
    }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Restart-PLServerTask {
  param([string]$TaskName = 'PaperLab Server', [int]$Port = 8080, [string]$LogFile, [switch]$DryRun)
  Invoke-PLStep -DryRun:$DryRun -LogFile $LogFile -Description "작업 '$TaskName' 멈춤 → 시작" -Action {
    $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if ($t.State -eq 'Running') { Stop-ScheduledTask -TaskName $TaskName }
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 500
    }
    Start-ScheduledTask -TaskName $TaskName
  } | Out-Null
}
