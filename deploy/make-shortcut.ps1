<#
.SYNOPSIS
  바탕화면에 PaperLab 앱 창 바로가기(PaperLab.lnk)를 만듭니다 (명세 11.1, 확정 Q6).

.DESCRIPTION
  대상 = Microsoft Edge --app=<서버 주소> (주소창 · 탭 없는 창). Edge가 없으면 Chrome --app=,
  둘 다 없으면 일반 인터넷 바로가기(PaperLab.url). 아이콘은 deploy\paperlab.ico.
  -Url 을 빼면 deploy\server-pc\server.json 의 공개 주소(public_url)를 씁니다 — 주소는 저장소에서 그 한 곳에만 둡니다
  (명세 13.2, 팀장 결정 S10).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\make-shortcut.ps1
  powershell -ExecutionPolicy Bypass -File deploy\make-shortcut.ps1 -Url https://other-host.example/
#>
param([string]$Url)

$ErrorActionPreference = "Stop"
if (-not $Url) {
  $config = Join-Path $PSScriptRoot "server-pc\server.json"
  $Url = (Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json).public_url
}
if ($Url -notmatch '^https://[^\s/]+') { Write-Host "https:// 로 시작하는 서버 주소를 넣어 주세요" -ForegroundColor Red; exit 1 }
$Url = $Url.TrimEnd("/") + "/"
$Desktop = [Environment]::GetFolderPath("Desktop")   # 이 PC는 OneDrive 바탕 화면
$Icon = Join-Path $PSScriptRoot "paperlab.ico"

$browsers = @(
  (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
  (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
  (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
  (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
) | Where-Object { $_ -and (Test-Path $_) }

if ($browsers) {
  $exe = @($browsers)[0]
  $lnk = Join-Path $Desktop "PaperLab.lnk"
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath = $exe
  $sc.Arguments = "--app=$Url"
  $sc.WorkingDirectory = Split-Path -Parent $exe
  $sc.Description = "PaperLab"
  if (Test-Path $Icon) { $sc.IconLocation = "$Icon,0" }
  $sc.Save()
  Write-Host "바로가기를 만들었어요: $lnk ($([IO.Path]::GetFileNameWithoutExtension($exe)) 앱 창, $Url)" -ForegroundColor Green
} else {
  $urlFile = Join-Path $Desktop "PaperLab.url"
  $lines = @("[InternetShortcut]", "URL=$Url")
  if (Test-Path $Icon) { $lines += @("IconFile=$Icon", "IconIndex=0") }
  [IO.File]::WriteAllLines($urlFile, $lines)
  Write-Host "Edge · Chrome을 찾지 못해 일반 인터넷 바로가기를 만들었어요: $urlFile" -ForegroundColor Yellow
}
