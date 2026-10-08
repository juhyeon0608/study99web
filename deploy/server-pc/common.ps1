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

# ====================================================================== 데스크톱 앱 빌드 (2단계 명세 13.7.1 — update.ps1 이 부름)
# 설치 파일 폴더 기본값: paperlab/downloads.py 의 DEFAULT_RELEASES_DIR 과 같은 값(서버가 읽는 폴더와 같게 — 테스트가 확인)
$script:PLDefaultReleasesDir = 'D:\PaperLab\releases'
$script:PLDesktopMinNode = 22

function Get-PLReleasesDir {
  <# 서버(paperlab/downloads.py releases_dir)와 같은 규칙: 프로세스 환경 변수 PAPERLAB_RELEASES_DIR → cloud.env 의 같은 키 →
     기본값. cloud.env 에서는 이 키 한 줄만 읽고 다른 값은 읽거나 출력하지 않는다 #>
  param([string]$EnvFile)
  $v = [Environment]::GetEnvironmentVariable('PAPERLAB_RELEASES_DIR')
  if ($v -and $v.Trim()) { return $v.Trim() }
  if ($EnvFile -and (Test-Path -LiteralPath $EnvFile)) {
    foreach ($line in (Get-Content -LiteralPath $EnvFile -Encoding UTF8)) {
      $m = [regex]::Match($line, '^\s*(?:export\s+)?PAPERLAB_RELEASES_DIR\s*=(.*)$')
      if (-not $m.Success) { continue }
      $val = $m.Groups[1].Value.Trim()
      if ($val.Length -ge 2 -and ($val[0] -eq [char]34 -or $val[0] -eq [char]39) -and $val[-1] -eq $val[0]) { $val = $val.Substring(1, $val.Length - 2) }
      if ($val.Trim()) { return $val.Trim() }
    }
  }
  return $script:PLDefaultReleasesDir
}

function Test-PLNodeForBuild {
  <# node · npm 이 PATH 에 있고 node 주 버전이 22 이상인지 → Ok · Text #>
  $nodeV = (Get-PLNativeText -FilePath 'node' -Arguments @('-v')).Trim()
  $npmV = (Get-PLNativeText -FilePath 'npm' -Arguments @('-v')).Trim()
  $m = [regex]::Match($nodeV, '^v?(\d+)\.')
  $ok = $m.Success -and ([int]$m.Groups[1].Value -ge $script:PLDesktopMinNode) -and ($npmV -match '^\d+\.')
  if (-not $nodeV) { $nodeV = '없음' }
  if (-not $npmV) { $npmV = '없음' }
  return [pscustomobject]@{ Ok = [bool]$ok; Text = "node $nodeV, npm $npmV" }
}

function Invoke-PLTimedCommand {
  <# cmd.exe /d /s /c "<고정 명령>" 을 작업 폴더에서 실행 — 출력은 로그 파일에 덧붙이고, 제한 시간이 지나면 프로세스 트리를
     끄고(taskkill /T /F) -1. 명령은 스크립트가 정한 상수만(npm ci · npm run dist) — 사용자 값이 들어가지 않음 #>
  param([string]$CommandLine, [string]$WorkingDirectory, [string]$OutFile, [hashtable]$Environment, [int]$TimeoutSec)
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = '/d /s /c "' + $CommandLine + ' 1>>"' + $OutFile + '" 2>&1"'
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  foreach ($k in $Environment.Keys) { $psi.EnvironmentVariables[$k] = [string]$Environment[$k] }
  $p = [System.Diagnostics.Process]::Start($psi)
  if (-not $p.WaitForExit([Math]::Max(1, $TimeoutSec) * 1000)) {
    & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null
    $p.WaitForExit(15000) | Out-Null
    return -1
  }
  return $p.ExitCode
}

function Get-PLSha512Base64 {
  param([Parameter(Mandatory = $true)][string]$Path)
  $s = [IO.File]::OpenRead($Path)
  try { $h = [Security.Cryptography.SHA512]::Create().ComputeHash($s) } finally { $s.Dispose() }
  return [Convert]::ToBase64String($h)
}

function Get-PLYmlValue {
  param([string]$Text, [string]$Pattern)
  $m = [regex]::Match($Text, $Pattern)
  if (-not $m.Success) { return '' }
  return $m.Groups[1].Value.Trim().Trim([char]39, [char]34)
}

function Test-PLLatestYml {
  <# latest.yml 의 version · path · files[0].url · sha512 · size 가 실제 .exe 와 맞는지 — 맞지 않으면 이유 문자열, 맞으면 빈 문자열 #>
  param([string]$YmlPath, [string]$ExePath, [string]$Version)
  $yml = Get-Content -LiteralPath $YmlPath -Raw -Encoding UTF8
  $name = Split-Path -Leaf $ExePath
  $sha = Get-PLSha512Base64 -Path $ExePath
  $size = [string](Get-Item -LiteralPath $ExePath).Length
  if ((Get-PLYmlValue $yml '(?m)^version:\s*(\S+)') -ne $Version) { return "latest.yml 버전이 $Version 이 아님" }
  if ((Get-PLYmlValue $yml '(?m)^path:\s*(\S+)') -ne $name) { return "latest.yml path 가 $name 이 아님" }
  if ((Get-PLYmlValue $yml '(?m)^\s+-\s+url:\s*(\S+)') -ne $name) { return "latest.yml files.url 이 $name 이 아님" }
  if ((Get-PLYmlValue $yml '(?m)^sha512:\s*(\S+)') -ne $sha) { return 'latest.yml sha512 가 실제 파일과 다름' }
  if ((Get-PLYmlValue $yml '(?m)^\s+sha512:\s*(\S+)') -ne $sha) { return 'latest.yml files.sha512 가 실제 파일과 다름' }
  if ((Get-PLYmlValue $yml '(?m)^\s+size:\s*(\d+)') -ne $size) { return 'latest.yml size 가 실제 파일과 다름' }
  return ''
}

function Move-PLReplace {
  <# 같은 폴더 안 교체(대상이 있으면 File.Replace, 없으면 File.Move) — latest.yml 을 읽는 앱이 빈 순간을 보지 않게 #>
  param([string]$Source, [string]$Destination)
  # 백업 경로 인자는 [NullString] — PowerShell 의 $null 은 문자열 인자에서 '' 가 되어 "경로 형식" 오류
  if (Test-Path -LiteralPath $Destination) { [IO.File]::Replace($Source, $Destination, [NullString]::Value) }
  else { [IO.File]::Move($Source, $Destination) }
}

function Get-PLReleaseVersions {
  <# releases 의 PaperLab-Setup-주.부.수.exe 목록 → File · Key([version]) · Text, 높은 버전부터 #>
  param([string]$ReleasesDir)
  if (-not (Test-Path -LiteralPath $ReleasesDir)) { return @() }
  return @(Get-ChildItem -LiteralPath $ReleasesDir -File -Filter 'PaperLab-Setup-*.exe' | ForEach-Object {
      $m = [regex]::Match($_.Name, '^PaperLab-Setup-(\d{1,4})\.(\d{1,4})\.(\d{1,4})\.exe$')
      if ($m.Success) {
        $t = '{0}.{1}.{2}' -f $m.Groups[1].Value, $m.Groups[2].Value, $m.Groups[3].Value
        [pscustomobject]@{ File = $_; Key = [version]$t; Text = $t }
      }
    } | Sort-Object Key -Descending)
}

function Remove-PLOldReleases {
  <# 최근 Keep 개 버전의 .exe · .blockmap 만 남김 (K24). 지금 latest.yml 이 가리키는 버전은 몇 번째든 지우지 않음 #>
  param([string]$ReleasesDir, [int]$Keep = 3, [string]$LogFile)
  $items = Get-PLReleaseVersions -ReleasesDir $ReleasesDir
  $current = ''
  $yml = Join-Path $ReleasesDir 'latest.yml'
  if (Test-Path -LiteralPath $yml) { $current = Get-PLYmlValue (Get-Content -LiteralPath $yml -Raw -Encoding UTF8) '(?m)^version:\s*(\S+)' }
  foreach ($old in ($items | Select-Object -Skip $Keep)) {
    if ($old.Text -eq $current) {
      Write-PLLog -LogFile $LogFile -Message "latest.yml 이 가리키는 버전이라 지우지 않음: $($old.File.Name)"
      continue
    }
    Remove-Item -LiteralPath $old.File.FullName -Force
    Remove-Item -LiteralPath ($old.File.FullName + '.blockmap') -Force -ErrorAction SilentlyContinue
    Write-PLLog -LogFile $LogFile -Message "옛 설치 파일 지움(최근 $Keep 개 버전만 보관): $($old.File.Name)"
  }
}

function Invoke-PLDesktopBuild {
  <# 데스크톱 앱 설치 파일 빌드 → releases (명세 13.7.1). 실패해도 예외를 던지지 않고 WARN 만 — 서버 업데이트 결과(종료 코드)는 그대로.
     -Changed: 이번 반영에서 desktop/ 이 바뀌었는지(버전이 같을 때 문구만 다름) #>
  param(
    [Parameter(Mandatory = $true)][string]$AppDir,
    [Parameter(Mandatory = $true)][string]$ReleasesDir,
    [Parameter(Mandatory = $true)][string]$CacheDir,
    [Parameter(Mandatory = $true)][string]$LogDir,
    [string]$LogFile,
    [string]$Commit = '',
    [int]$TimeoutSec = 1200,
    [switch]$Changed,
    [switch]$DryRun
  )
  $desktop = Join-Path $AppDir 'desktop'
  $pkgPath = Join-Path $desktop 'package.json'
  if ($DryRun) {
    Write-PLLog -Level DRY -Message ("[DRY] 데스크톱 앱 빌드: node · npm 확인(22 이상) → desktop\ 에서 npm ci → npm run dist (제한 $TimeoutSec 초, " +
      "캐시 $CacheDir) → $ReleasesDir\.staging 확인 → .exe · .blockmap · release.json → latest.yml(마지막) · 최근 3개 버전 보관")
    return $true
  }
  if (-not (Test-Path -LiteralPath $pkgPath)) {
    Write-PLLog -LogFile $LogFile -Level WARN -Message "데스크톱 앱 빌드 건너뜀: desktop\package.json 이 없어요"
    return $false
  }
  # package.json 이 깨져 있어도 예외로 끝나지 않고 WARN 만 (품질팀 F4 — 서버 업데이트 결과는 그대로)
  try {
    $version = [string](Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json).version
  } catch {
    Write-PLLog -LogFile $LogFile -Level WARN -Message "데스크톱 앱 빌드 건너뜀: desktop\package.json 을 읽지 못했어요 ($($_.Exception.Message))"
    return $false
  }
  if ($version -notmatch '^\d{1,4}\.\d{1,4}\.\d{1,4}$') {
    Write-PLLog -LogFile $LogFile -Level WARN -Message "데스크톱 앱 빌드 건너뜀: desktop\package.json 버전($version)이 '주.부.수' 숫자 모양이 아니에요"
    return $false
  }
  $exeName = "PaperLab-Setup-$version.exe"
  if (Test-Path -LiteralPath (Join-Path $ReleasesDir $exeName)) {
    if ($Changed) {
      Write-PLLog -LogFile $LogFile -Level WARN -Message "데스크톱 앱이 바뀌었지만 버전이 같아 빌드하지 않았어요 — desktop/package.json 버전을 올려 주세요 (버전 $version)"
    } else {
      Write-PLLog -LogFile $LogFile -Level WARN -Message "버전 $version 설치 파일이 이미 있어 빌드하지 않았어요 — 새로 내보내려면 desktop/package.json 버전을 올려 주세요"
    }
    return $false
  }
  # 내보낸 가장 높은 버전 이하이면 빌드하지 않음 — 앱은 다운그레이드하지 않으므로 낮은 버전을 latest.yml 에 올리면 안 됨 (품질팀 F2)
  $top = @(Get-PLReleaseVersions -ReleasesDir $ReleasesDir) | Select-Object -First 1
  if ($top -and [version]$version -le $top.Key) {
    Write-PLLog -LogFile $LogFile -Level WARN -Message ("데스크톱 앱 버전 $version 이 이미 내보낸 가장 높은 버전 $($top.Text) 이하라 빌드하지 않았어요 — " +
      "desktop/package.json 버전을 $($top.Text) 보다 높게 올려 주세요")
    return $false
  }
  $node = Test-PLNodeForBuild
  if (-not $node.Ok) {
    Write-PLLog -LogFile $LogFile -Level WARN -Message "Node.js $($script:PLDesktopMinNode) 이상 · npm 이 없어 데스크톱 앱 빌드를 건너뛰어요 ($($node.Text)) — 서버 PC 안내서 '데스크톱 앱 빌드' 절"
    return $false
  }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $buildLog = Join-Path $LogDir "desktop-build-$stamp.log"
  $staging = Join-Path $ReleasesDir '.staging'
  $dist = Join-Path $desktop 'dist'
  $started = Get-Date
  $step = '준비'
  Write-PLLog -LogFile $LogFile -Message "데스크톱 앱 빌드 시작: 버전 $version ($($node.Text)) — 빌드 로그 $buildLog"
  try {
    foreach ($d in @($LogDir, $ReleasesDir, $CacheDir)) { if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }
    if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
    # 캐시는 D: 로 (C: 여유가 적음 — 이 빌드 프로세스에만 주는 도구용 변수, 앱 · 서버 환경 변수 아님)
    $envs = @{
      npm_config_cache = (Join-Path $CacheDir 'npm')
      ELECTRON_CACHE = (Join-Path $CacheDir 'electron')
      ELECTRON_BUILDER_CACHE = (Join-Path $CacheDir 'electron-builder')
    }
    $deadline = $started.AddSeconds($TimeoutSec)
    foreach ($cmd in @('npm ci', 'npm run dist')) {
      $step = $cmd
      $left = [int][Math]::Ceiling(($deadline - (Get-Date)).TotalSeconds)
      if ($left -le 0) { throw "시간 초과($TimeoutSec 초)" }
      Add-Content -LiteralPath $buildLog -Value "> $cmd" -Encoding UTF8
      $code = Invoke-PLTimedCommand -CommandLine $cmd -WorkingDirectory $desktop -OutFile $buildLog -Environment $envs -TimeoutSec $left
      if ($code -eq -1) { throw "시간 초과($TimeoutSec 초)" }
      if ($code -ne 0) { throw "종료 코드 $code" }
    }
    $step = '결과 확인'
    $files = @($exeName, "$exeName.blockmap", 'latest.yml')
    foreach ($f in $files) { if (-not (Test-Path -LiteralPath (Join-Path $dist $f))) { throw "빌드 결과에 $f 가 없어요" } }
    $step = '.staging 확인'
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    New-Item -ItemType Directory -Path $staging -Force | Out-Null
    foreach ($f in $files) { Copy-Item -LiteralPath (Join-Path $dist $f) -Destination (Join-Path $staging $f) -Force }
    $bad = Test-PLLatestYml -YmlPath (Join-Path $staging 'latest.yml') -ExePath (Join-Path $staging $exeName) -Version $version
    if ($bad) { throw $bad }
    $exe = Get-Item -LiteralPath (Join-Path $staging $exeName)
    $sha256 = (Get-FileHash -LiteralPath $exe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $info = [ordered]@{ version = $version; file = $exeName; size = $exe.Length; sha256 = $sha256
      built_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss+00:00'); commit = $Commit }
    [IO.File]::WriteAllText((Join-Path $staging 'release.json'), ($info | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
    # 옮기기: .exe → .blockmap → release.json → latest.yml(마지막 — 앱이 새 latest.yml 을 보는 순간 .exe 가 이미 있게)
    # 중간에 실패하면 이번에 옮긴 새 버전 파일을 지우고 release.json 을 되돌린다(latest.yml 은 마지막이라 아직 옛것)
    $step = '옮기기'
    $prevInfo = Join-Path $ReleasesDir 'release.json'
    $infoBackup = Join-Path $staging 'release.json.prev'
    if (Test-Path -LiteralPath $prevInfo) { Copy-Item -LiteralPath $prevInfo -Destination $infoBackup -Force }
    try {
      foreach ($f in @($exeName, "$exeName.blockmap", 'release.json', 'latest.yml')) {
        Move-PLReplace -Source (Join-Path $staging $f) -Destination (Join-Path $ReleasesDir $f)
      }
    } catch {
      foreach ($f in @($exeName, "$exeName.blockmap")) { Remove-Item -LiteralPath (Join-Path $ReleasesDir $f) -Force -ErrorAction SilentlyContinue }
      if (Test-Path -LiteralPath $infoBackup) { Copy-Item -LiteralPath $infoBackup -Destination $prevInfo -Force }
      else { Remove-Item -LiteralPath $prevInfo -Force -ErrorAction SilentlyContinue }
      throw
    }
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    $step = '보관 정리'
    Remove-PLOldReleases -ReleasesDir $ReleasesDir -Keep 3 -LogFile $LogFile
    $secs = [int]((Get-Date) - $started).TotalSeconds
    Write-PLLog -LogFile $LogFile -Message "데스크톱 앱 빌드 성공: 버전 $version · $exeName · sha256 $sha256 · $secs 초"
    $urlLine = @(Get-Content -LiteralPath $buildLog -Encoding UTF8 -ErrorAction SilentlyContinue | Where-Object { $_ -match 'PaperLab 서버 주소' } | Select-Object -First 1)
    if ($urlLine.Count) { Write-PLLog -LogFile $LogFile -Message "빌드 로그 확인: $($urlLine[0].Trim())" }
    return $true
  } catch {
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
    Write-PLLog -LogFile $LogFile -Level WARN -Message ("데스크톱 앱 빌드 실패($step — $($_.Exception.Message)) — 이전 설치 파일을 그대로 둬요. " +
      "빌드 로그: $buildLog (서버 업데이트 결과에는 영향 없음)")
    return $false
  }
}
