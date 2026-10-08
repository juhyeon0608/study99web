"""서버 PC 스크립트 (deploy/server-pc/*.ps1 · make-shortcut.ps1) — 이 PC에서는 **바꾸지 않는** 검사만 (명세 20.1):
PowerShell 파서 오류 0, BOM(Windows PowerShell 5.1이 한글을 바르게 읽게), 시험 실행(-DryRun)이 아무것도 바꾸지 않음
(update.ps1 만 예외 — git fetch 로 원격 추적 브랜치만 갱신),
공개 주소를 한 곳에만 둠(S10). 실제 작업 등록 · 권한 변경 · Funnel은 서버 PC에서 확인(AC-55 · 58 · 76 · 77 · 79).
"""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = sorted((ROOT / "deploy").rglob("*.ps1"))
SERVER_PC = ROOT / "deploy" / "server-pc"

pytestmark = pytest.mark.skipif(sys.platform != "win32" or not shutil.which("powershell"),
                                reason="Windows PowerShell 전용 스크립트")


def ps(script: Path, *args: str, timeout: int = 180) -> subprocess.CompletedProcess:
    """powershell 로 스크립트 실행 (-Switch 는 그대로, 값은 작은따옴표). 출력은 UTF-8로 받는다(파이썬 하위 프로세스도)."""
    def q(a: str) -> str:
        return "'" + a.replace("'", "''") + "'"

    argv = " ".join(a if re.fullmatch(r"-[A-Za-z]+", a) else q(a) for a in args)
    command = f"[Console]::OutputEncoding=[Text.Encoding]::UTF8; & {q(str(script))} {argv}; exit $LASTEXITCODE"
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    return subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
                           command], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
                          timeout=timeout, cwd=ROOT)


def scheduled_paperlab_tasks() -> str:
    p = subprocess.run(["powershell", "-NoProfile", "-Command",
                        "Get-ScheduledTask -TaskName 'PaperLab*' -ErrorAction SilentlyContinue | "
                        "ForEach-Object { $_.TaskName + '|' + $_.State }"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    return p.stdout.strip()


def test_scripts_parse_without_errors():
    assert {p.name for p in SCRIPTS} >= {"install.ps1", "update.ps1", "funnel.ps1", "watchdog.ps1", "uninstall.ps1",
                                         "common.ps1", "make-shortcut.ps1"}
    probe = ("$bad = 0; foreach ($f in ($env:PL_FILES | ConvertFrom-Json)) { $t = $null; $e = $null; "
             "[System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$t, [ref]$e) | Out-Null; "
             "foreach ($x in $e) { Write-Output ($f + ':' + $x.Extent.StartLineNumber + ': ' + $x.Message); $bad++ } }; "
             "Write-Output ('errors=' + $bad)")
    p = subprocess.run(["powershell", "-NoProfile", "-Command", probe], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=120,
                       env=dict(os.environ, PL_FILES=json.dumps([str(s) for s in SCRIPTS])))
    assert p.stdout.strip().endswith("errors=0"), p.stdout + p.stderr


def test_scripts_have_bom_and_no_hardcoded_server_paths():
    for s in SCRIPTS:
        raw = s.read_bytes()
        assert raw.startswith(b"\xef\xbb\xbf"), s.name  # PowerShell 5.1은 BOM 없는 UTF-8을 ANSI(cp949)로 읽음
        text = raw.decode("utf-8-sig")
        # 서버 PC 경로 · 계정을 박지 않음 (기본값은 server.json · 스크립트 위치 · %USERPROFILE%)
        for bad in ("C:\\Users\\USER", "tools\\pgsql", "kimjuhyeon", "D:\\PaperLab\\study99web"):
            assert bad not in text, (s.name, bad)


def test_public_url_in_one_place():
    """S10 · AC-69: 공개 주소는 server.json(+ R2 CORS 붙여 넣기 파일) 밖의 코드 · 스크립트 · 테스트에 없음"""
    cfg = json.loads((SERVER_PC / "server.json").read_text(encoding="utf-8"))
    host = cfg["public_url"].split("//", 1)[1]
    assert cfg["public_url"].startswith("https://") and cfg["port"] == 8080
    cors = json.loads((ROOT / "deploy" / "r2-cors.json").read_text(encoding="utf-8"))
    assert cors[0]["AllowedOrigins"] == [cfg["public_url"]]  # 127.0.0.1 개발 출처 없음 (승인자 L4)
    hits = []
    for base in ("paperlab", "deploy", "tests", "supabase", "desktop"):  # desktop: AC-84 · AC-88 (h) — 빌드가 server.json 에서 읽음
        for f in (ROOT / base).rglob("*"):
            if {"node_modules", "dist"} & set(f.relative_to(ROOT).parts):  # 설치 패키지 · 빌드 결과물(커밋 안 함)
                continue
            if f.is_file() and f.suffix in (".py", ".ps1", ".json", ".js", ".html", ".sql", ".toml", ".md"):
                if host in f.read_text(encoding="utf-8", errors="replace"):
                    hits.append(f.relative_to(ROOT).as_posix())
    assert sorted(hits) == ["deploy/r2-cors.json", "deploy/server-pc/README.md", "deploy/server-pc/server.json"]
    shortcut = (ROOT / "deploy" / "make-shortcut.ps1").read_text(encoding="utf-8-sig")
    assert "server.json" in shortcut and "Mandatory" not in shortcut


@pytest.fixture
def fake_env(tmp_path):
    f = tmp_path / "cfg" / "cloud.env"
    f.parent.mkdir()
    f.write_text("SUPABASE_URL=https://fakeref.supabase.co\nSUPABASE_ANON_KEY=anon-SECRET-value\n"
                 "APP_ENCRYPTION_KEY=a2tra2tra2tra2tra2tra2tra2tra2tra2tra2tra2s=\n"
                 "PAPERLAB_PUBLIC_URL=https://pl.example\nR2_ACCOUNT_ID=a\nR2_BUCKET=b\nR2_ACCESS_KEY_ID=c\n"
                 "R2_SECRET_ACCESS_KEY=r2-SECRET-value\n", encoding="utf-8")
    return f


def _acl(path: Path) -> list[str]:
    """icacls 결과 중 권한 줄만 (끝의 요약 문장은 표시 언어가 바뀔 수 있어 뺌)"""
    out = subprocess.run(["icacls", str(path)], capture_output=True, text=True, errors="replace").stdout
    return [ln.strip().replace(str(path), "") for ln in out.splitlines() if ":(" in ln]


def test_install_dry_run_changes_nothing(tmp_path, fake_env):
    root = tmp_path / "root"
    tasks_before, acl_before = scheduled_paperlab_tasks(), _acl(fake_env)
    p = ps(SERVER_PC / "install.ps1", "-DryRun", "-Root", str(root), "-EnvFile", str(fake_env), "-SkipFunnel")
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert not root.exists()                                   # 폴더를 만들지 않음
    assert _acl(fake_env) == acl_before                        # 권한을 바꾸지 않음
    assert scheduled_paperlab_tasks() == tasks_before          # 작업을 등록하지 않음
    for secret in ("anon-SECRET-value", "r2-SECRET-value", "fakeref"):
        assert secret not in out                               # cloud.env 값이 나오지 않음
    for step in ("마이그레이션", "app-role --write-env --if-missing", "pg-dump-check", "PaperLab Server",
                 "PaperLab Backup", "PaperLab Watchdog"):
        assert step in out, step
    # 작업 정의(시험 실행이 보여 주는 실행 인자 · 설정)
    assert "-m paperlab.serve --port 8080" in out and "--log-dir" in out
    assert "MSFT_TaskBootTrigger" in out and "999" in out and "PT0S" in out and "IgnoreNew" in out
    assert "backup --tmp-dir" in out and "MSFT_TaskDailyTrigger" in out and "PT1H" in out
    assert "watchdog.ps1" in out and "MSFT_TaskTimeTrigger" in out
    assert "빠졌거나 틀린 변수: 없음" in out and "SUPABASE_APP_DB_URL 사용자: (비어 있음)" in out


def _git(*args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
    origin, app = tmp_path / "origin", tmp_path / "app"
    _git("init", "-q", "-b", "main", str(origin), cwd=tmp_path)
    for k, v in (("user.email", "t@example.com"), ("user.name", "t")):
        _git("config", k, v, cwd=origin)
    (origin / "a.txt").write_text("1\n", encoding="utf-8")
    _git("add", ".", cwd=origin)
    _git("commit", "-qm", "one", cwd=origin)
    _git("clone", "-q", str(origin), str(app), cwd=tmp_path)
    (origin / "a.txt").write_text("1\n2\n", encoding="utf-8")
    _git("commit", "-qam", "two", cwd=origin)
    _git("fetch", "-q", cwd=app)
    return app


def _head(app):
    return subprocess.run(["git", "rev-parse", "HEAD"], cwd=app, capture_output=True, text=True).stdout.strip()


def test_update_dry_run(repo, tmp_path):
    before = _head(repo)
    logs = tmp_path / "logs"
    p = ps(SERVER_PC / "update.ps1", "-DryRun", "-Yes", "-AppDir", str(repo), "-Branch", "main", "-LogDir", str(logs))
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert "[DRY] 코드 반영" in out and "[DRY] 마이그레이션" in out and "PaperLab Server" in out and "two" in out
    assert _head(repo) == before and not logs.exists()
    # -RestartOnly 시험 실행
    p = ps(SERVER_PC / "update.ps1", "-DryRun", "-RestartOnly", "-AppDir", str(repo), "-LogDir", str(logs))
    assert p.returncode == 0 and "[DRY]" in p.stdout, p.stdout + p.stderr
    # 고친 파일이 있으면 시작하지 않음 (AC-79)
    (repo / "local-edit.txt").write_text("x", encoding="utf-8")
    p = ps(SERVER_PC / "update.ps1", "-DryRun", "-Yes", "-AppDir", str(repo), "-Branch", "main", "-LogDir", str(logs))
    assert p.returncode == 1 and "local-edit.txt" in p.stdout + p.stderr
    assert _head(repo) == before


def _is_admin() -> bool:
    return subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole("
         "[Security.Principal.WindowsBuiltInRole]::Administrator)"], capture_output=True, text=True).stdout.strip() == "True"


ADMIN_WARN = ("관리자 권한으로 실행 중: 새로 받는 파일의 소유자가 Administrators가 되지만, 상속 권한으로 서버 계정이 접근할 수 "
              "있어 동작에는 영향이 없습니다. 가능하면 일반 권한 PowerShell에서 실행하세요.")


def test_update_dry_run_fetches_first(repo, tmp_path):
    """서버 PC 1A: 미리 fetch 하지 않아도 시험 실행이 새 커밋을 보여 줌. fetch 만 함(원격 추적 브랜치 갱신),
    작업 폴더 · HEAD · 브랜치는 그대로, update.log 를 만들지 않음"""
    origin = tmp_path / "origin"
    (origin / "a.txt").write_text("1\n2\n3\n", encoding="utf-8")
    _git("commit", "-qam", "three-not-fetched", cwd=origin)
    origin_head = _head(origin)
    before, before_text = _head(repo), (repo / "a.txt").read_text(encoding="utf-8")
    logs = tmp_path / "logs"
    p = ps(SERVER_PC / "update.ps1", "-DryRun", "-Yes", "-AppDir", str(repo), "-Branch", "main", "-LogDir", str(logs))
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert "three-not-fetched" in out and "two" in out and "[DRY] git fetch" in out, out
    assert "git fetch 만 했고 나머지는 바꾸지 않음" in out
    tracking = subprocess.run(["git", "rev-parse", "origin/main"], cwd=repo, capture_output=True, text=True).stdout.strip()
    assert tracking == origin_head                                    # 원격 추적 브랜치는 갱신
    assert _head(repo) == before and (repo / "a.txt").read_text(encoding="utf-8") == before_text
    branch = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo, capture_output=True, text=True)
    assert branch.stdout.strip() == "main" and not logs.exists()
    assert (ADMIN_WARN in out) == _is_admin()


def test_update_scripts_do_not_change_owner():
    """팀장 결정(품질팀 H2): 소유자를 바꾸지 않음 — icacls /setowner 같은 재귀 소유자 변경이 update 경로에 없음"""
    for name in ("update.ps1", "common.ps1"):
        text = (SERVER_PC / name).read_text(encoding="utf-8-sig").lower()
        assert "setowner" not in text and "takeown" not in text, name


# 스크립트 임시 사본의 common.ps1 끝에 덧붙이는 가짜 함수. 파이썬 명령은 기록만 하고 PL_FAIL 에 든 낱말(pip · migrate)이
# 인자에 있으면 처음 한 번만 실패, 작업 재시작은 기록만, 상태 확인은 기대한 커밋으로 정상, 관리자 여부는 PL_ADMIN.
# 실제 작업 스케줄러 · DB · 권한 · 소유자에는 닿지 않는다.
_UPDATE_STUB = (
    "\r\nfunction Invoke-PLNative {{\r\n"
    "  param([Parameter(Mandatory = $true)][string]$FilePath, [string[]]$Arguments = @(), [string]$WorkingDirectory)\r\n"
    "  $line = ($Arguments -join ' ')\r\n"
    "  $seen = ''\r\n"
    "  if (Test-Path -LiteralPath '{calls}') {{ $seen = Get-Content -LiteralPath '{calls}' -Raw -Encoding UTF8 }}\r\n"
    "  Add-Content -LiteralPath '{calls}' -Value $line -Encoding UTF8\r\n"
    "  if ($env:PL_FAIL -and $line.Contains($env:PL_FAIL) -and -not $seen.Contains($env:PL_FAIL)) {{ return 1 }}\r\n"
    "  return 0\r\n}}\r\n"
    "function Restart-PLServerTask {{\r\n"
    "  param([string]$TaskName, [int]$Port, [string]$LogFile, [switch]$DryRun)\r\n"
    "  Add-Content -LiteralPath '{calls}' -Value ('restart ' + $TaskName) -Encoding UTF8\r\n}}\r\n"
    "function Wait-PLHealth {{\r\n"
    "  param([int]$Port, [switch]$Deep, [int]$TimeoutSec, [string]$Commit)\r\n"
    "  return [pscustomobject]@{{ ok = $true; commit = $Commit }}\r\n}}\r\n"
    "function Test-PLIsAdmin {{ return ($env:PL_ADMIN -eq '1') }}\r\n")


@pytest.fixture
def stubbed_scripts(tmp_path):
    copy = tmp_path / "scripts"
    shutil.copytree(SERVER_PC, copy)
    calls = tmp_path / "calls.txt"
    with open(copy / "common.ps1", "ab") as f:
        f.write(_UPDATE_STUB.format(calls=calls).encode("utf-8"))
    return copy, calls


def _bump_pyproject(app: Path, tmp_path: Path):
    """원격에 pyproject.toml 을 바꾸는 새 커밋(three) — update.ps1 이 pip install -e . 을 부르게"""
    origin = tmp_path / "origin"
    (origin / "pyproject.toml").write_text("[project]\nname = 'x'\n", encoding="utf-8")
    _git("add", ".", cwd=origin)
    _git("commit", "-qm", "three", cwd=origin)


@pytest.mark.parametrize("admin", [True, False])
def test_update_admin_warns_and_continues(repo, tmp_path, monkeypatch, stubbed_scripts, admin):
    """팀장 결정: 관리자 권한이면 시작할 때 WARN 한 줄(화면 + update.log)만 남기고 계속 — 소유자는 바꾸지 않음"""
    copy, calls = stubbed_scripts
    monkeypatch.setenv("PL_ADMIN", "1" if admin else "0")
    monkeypatch.delenv("PL_FAIL", raising=False)
    logs = tmp_path / "logs"
    p = ps(copy / "update.ps1", "-Yes", "-AppDir", str(repo), "-Branch", "main", "-LogDir", str(logs), "-TimeoutSec", "5")
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    log = (logs / "update.log").read_text(encoding="utf-8-sig")
    assert "업데이트 성공" in log
    assert (("[WARN] " + ADMIN_WARN) in log) == admin and (ADMIN_WARN in out) == admin
    if admin:
        assert log.index(ADMIN_WARN) < log.index("git fetch")  # 시작할 때
    assert "setowner" not in out.lower()


@pytest.mark.parametrize("fail", ["pip", "paperlab.migrate"])
def test_update_rolls_back_when_step_after_merge_fails(repo, tmp_path, monkeypatch, stubbed_scripts, fail):
    """품질팀 M1: pyproject.toml 이 바뀐 업데이트에서 pip install 이 실패하면 옛 커밋으로 되돌리고(옛 의존성 다시 설치)
    다시 시작 · 확인, 종료 코드 1. 마이그레이션 실패는 되돌리되 서버를 다시 시작하지 않음(기존 동작)"""
    copy, calls = stubbed_scripts
    _bump_pyproject(repo, tmp_path)
    monkeypatch.setenv("PL_ADMIN", "0")
    monkeypatch.setenv("PL_FAIL", fail)
    before = _head(repo)
    logs = tmp_path / "logs"
    p = ps(copy / "update.ps1", "-Yes", "-AppDir", str(repo), "-Branch", "main", "-LogDir", str(logs), "-TimeoutSec", "5")
    out = p.stdout + p.stderr
    assert p.returncode == 1, out
    assert _head(repo) == before and not (repo / "pyproject.toml").exists()  # 옛 커밋으로 되돌림
    log = (logs / "update.log").read_text(encoding="utf-8-sig")
    recorded = calls.read_text(encoding="utf-8-sig")
    assert recorded.count(" pip install ") == 2                # 새 의존성 → (되돌린 뒤) 옛 의존성
    assert "적용된 상태" not in log                             # 마이그레이션이 끝나지 않았으니 그 경고 없음
    if fail == "pip":
        assert "[ERROR] 코드 반영 · 의존성 설치 단계 오류: pip install 실패" in log
        assert "paperlab.migrate" not in recorded
        assert "자동 되돌림" in log and "[ERROR] 업데이트 실패 · 되돌림 완료" in log
        assert recorded.count("restart PaperLab Server") == 1   # 옛 커밋으로 다시 시작 · 확인
    else:
        assert "마이그레이션 실패 — 코드를" in log and "(서버는 다시 시작하지 않음" in log
        assert "[ERROR] 업데이트 실패: " in log and "(마이그레이션 단계)" in log
        assert "restart" not in recorded


def test_watchdog_dry_run_changes_nothing(tmp_path):
    """품질팀 F3: 시험 실행은 상태 파일 · 로그 · lastDaily를 바꾸지 않고 화면에만. 재시작 판단 · 시간당 한도는 화면으로 확인"""
    from datetime import datetime, timezone
    logs, state = tmp_path / "logs", tmp_path / "state.json"
    args = ("-DryRun", "-Port", "9", "-TimeoutSec", "2", "-LogDir", str(logs), "-StateFile", str(state),
            "-MaxRestartsPerHour", "1")
    # 상태 파일이 없을 때: 실패 1/3, 아무 파일도 만들지 않음
    p = ps(SERVER_PC / "watchdog.ps1", "-SkipDaily", *args)
    assert p.returncode == 0 and "1/3" in p.stdout, p.stdout + p.stderr
    assert not logs.exists() and not state.exists()
    # 연속 실패 2번이 기록된 상태: 이번이 3번째 → 다시 시작할 차례(시험 실행이라 하지 않음), 파일은 그대로
    seeded = '{"failures":2,"restarts":[],"lastDaily":"2000-01-01"}'
    state.write_text(seeded, encoding="utf-8")
    p = ps(SERVER_PC / "watchdog.ps1", *args)  # 하루 한 번 검사도 화면에만
    assert p.returncode == 0 and "3/3" in p.stdout and "[DRY] 다시 시작할 차례" in p.stdout, p.stdout + p.stderr
    assert state.read_text(encoding="utf-8") == seeded and not logs.exists()
    # 최근 1시간에 이미 한 번 재시작(한도 1) → 다시 시작하지 않고 경고만
    now = datetime.now(timezone.utc).astimezone().isoformat()
    seeded = '{"failures":2,"restarts":["%s"],"lastDaily":""}' % now
    state.write_text(seeded, encoding="utf-8")
    p = ps(SERVER_PC / "watchdog.ps1", "-SkipDaily", *args)
    assert p.returncode == 0 and "한도" in p.stdout and "다시 시작할 차례" not in p.stdout, p.stdout + p.stderr
    assert state.read_text(encoding="utf-8") == seeded and not logs.exists()


def test_update_restart_error_rolls_back(repo, tmp_path):
    """품질팀 F2 재현: 재시작 단계가 'Access is denied'를 던져도 옛 커밋으로 되돌리고 update.log에 ERROR · 결과 줄.
    스크립트 임시 사본의 common.ps1 끝에 가짜 함수를 덧붙인다(파이썬 명령 = 성공으로 기록만, 작업 재시작 = 예외).
    실제 작업 스케줄러 · DB에는 닿지 않는다."""
    copy = tmp_path / "scripts"
    shutil.copytree(SERVER_PC, copy)
    calls = tmp_path / "calls.txt"
    stub = (
        "\r\nfunction Invoke-PLNative {\r\n"
        "  param([Parameter(Mandatory = $true)][string]$FilePath, [string[]]$Arguments = @(), [string]$WorkingDirectory)\r\n"
        f"  Add-Content -LiteralPath '{calls}' -Value ($Arguments -join ' ') -Encoding UTF8\r\n"
        "  return 0\r\n}\r\n"
        "function Restart-PLServerTask {\r\n"
        "  param([string]$TaskName, [int]$Port, [string]$LogFile, [switch]$DryRun)\r\n"
        f"  Add-Content -LiteralPath '{calls}' -Value ('restart ' + $TaskName) -Encoding UTF8\r\n"
        "  throw 'Access is denied'\r\n}\r\n")
    with open(copy / "common.ps1", "ab") as f:
        f.write(stub.encode("utf-8"))
    before = _head(repo)
    logs = tmp_path / "logs"
    p = ps(copy / "update.ps1", "-Yes", "-AppDir", str(repo), "-Branch", "main", "-LogDir", str(logs), "-TimeoutSec", "5")
    out = p.stdout + p.stderr
    assert p.returncode == 1, out
    assert _head(repo) == before  # 옛 커밋으로 되돌림
    log = (logs / "update.log").read_text(encoding="utf-8-sig")
    assert "[ERROR] 재시작 단계 오류: Access is denied" in log
    assert "자동 되돌림" in log and "마이그레이션은" in log and "적용된 상태" in log  # 앞으로 가는 업데이트 → 경고
    assert "[ERROR] 업데이트 실패 · 되돌린 뒤에도 서버 상태 확인 실패" in log
    recorded = calls.read_text(encoding="utf-8-sig")
    assert "paperlab.migrate" in recorded and recorded.count("restart PaperLab Server") == 2


def test_install_requires_admin_for_task_registration(tmp_path, fake_env):
    """품질팀 F4: 작업 등록이 필요한데 관리자가 아니면 시험 실행은 경고, 실제 실행은 아무것도 바꾸기 전에 중단"""
    is_admin = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole("
         "[Security.Principal.WindowsBuiltInRole]::Administrator)"], capture_output=True, text=True).stdout.strip()
    if is_admin == "True":
        pytest.skip("관리자 권한으로 실행 중이라 이 검사는 해당 없음")
    root = tmp_path / "root"
    p = ps(SERVER_PC / "install.ps1", "-DryRun", "-Root", str(root), "-EnvFile", str(fake_env), "-SkipFunnel",
           "-ReRegisterTasks")
    assert p.returncode == 0 and "관리자 권한" in p.stdout and "확인 실패(시험 실행이라 계속)" in p.stdout, p.stdout
    acl_before = _acl(fake_env)
    p = ps(SERVER_PC / "install.ps1", "-Root", str(root), "-EnvFile", str(fake_env), "-SkipFunnel", "-ReRegisterTasks")
    out = p.stdout + p.stderr
    assert p.returncode != 0 and "관리자 권한" in out, out
    assert not root.exists() and _acl(fake_env) == acl_before  # 아무것도 바꾸지 않음


def ps_common(snippet: str, **env: str) -> subprocess.CompletedProcess:
    """common.ps1 을 읽은 뒤 snippet 실행 (경로는 환경 변수로 넘김)"""
    common = str(SERVER_PC / "common.ps1").replace("'", "''")
    command = (f"[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; "
               f". '{common}'; {snippet}")
    return subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
                           command], env=dict(os.environ, **env), capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=120)


def _icacls(*args: str):
    subprocess.run(["icacls", *args], check=True, capture_output=True)


def _my_sid() -> str:
    return subprocess.run(["powershell", "-NoProfile", "-Command",
                           "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"],
                          capture_output=True, text=True).stdout.strip()


@pytest.fixture
def junctions():
    """cmd /c mklink /J 로 정션 만들기(관리자 권한 불필요). 정리할 때 정션을 먼저 cmd /c rmdir 로 지운다 —
    대상 폴더는 건드리지 않고, 지울 수 없는 폴더를 남기지 않음"""
    made: list[Path] = []

    def make(link: Path, target: Path, create_target: bool = True) -> Path:
        if create_target:
            target.mkdir(parents=True, exist_ok=True)
        link.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], check=True, capture_output=True)
        made.append(link)
        return link

    yield make
    for link in reversed(made):
        subprocess.run(["cmd", "/c", "rmdir", str(link)], capture_output=True)
        assert not os.path.lexists(link), link


def test_reset_acl_does_not_follow_junctions(tmp_path, junctions):
    """품질팀 점검 · 팀장 결정 B: 하위 폴더 권한 되돌리기는 그 폴더만(icacls /reset). 하위 정션이 가리키는 바깥 폴더의
    보호 ACL(그 안의 보호된 폴더 · 파일 포함)은 바뀌지 않는다. 대조로 예전 명령(/reset /T)은 바꾼다는 것도 확인"""
    me = _my_sid()
    root, outside = tmp_path / "root", tmp_path / "outside"
    child = root / "tmp"
    child.mkdir(parents=True)
    _icacls(str(root), "/inheritance:r", "/grant:r", f"*{me}:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F")
    _icacls(str(child), "/grant", "*S-1-5-32-545:(OI)(CI)RX")       # 루트 밖 계정(Users) 명시 항목 → 되돌릴 대상
    prot, inner = outside / "prot", outside / "prot" / "inner"
    inner.mkdir(parents=True)
    (inner / "f.txt").write_text("x", encoding="utf-8")
    _icacls(str(prot), "/inheritance:r", "/grant:r", f"*{me}:(OI)(CI)F", "*S-1-5-32-545:(OI)(CI)R")
    _icacls(str(inner), "/inheritance:r", "/grant:r", f"*{me}:(OI)(CI)F", "*S-1-5-32-545:(OI)(CI)M")
    junctions(child / "link", prot)

    def snap():
        return [_acl(p) for p in (prot, inner, inner / "f.txt")]

    before = snap()
    p = ps_common("$a = Get-PLAclProblems -Path $env:PL_PATH; $code = Reset-PLInheritedAcl -Path $env:PL_PATH; "
                  "$b = Get-PLAclProblems -Path $env:PL_PATH; "
                  "Write-Output ('before=' + $a.Others.Count + ' code=' + $code + ' inherited=' + $b.Inherited + "
                  "' others=' + $b.Others.Count)", PL_PATH=str(child))
    assert "before=1 code=0 inherited=True others=0" in p.stdout, p.stdout + p.stderr
    assert snap() == before                                          # 정션 대상은 그대로
    subprocess.run(["icacls", str(child), "/reset", "/T", "/C", "/Q"], capture_output=True)
    assert snap() != before                                          # 대조: /T 는 정션을 따라 들어감


def test_install_scripts_do_not_reset_recursively():
    for name in ("install.ps1", "common.ps1"):
        text = (SERVER_PC / name).read_text(encoding="utf-8-sig")
        assert not re.search(r"/reset\s+/T", text, re.IGNORECASE), name


def test_reparse_point_check(tmp_path, junctions):
    """팀장 결정 C: 정션(대상이 없는 정션 포함)만 걸리고, 실제 폴더 · 파일 · 아직 없는 경로는 통과"""
    real = tmp_path / "real"
    real.mkdir()
    (real / "f.txt").write_text("x", encoding="utf-8")
    link = junctions(tmp_path / "link", tmp_path / "target")
    dangling = junctions(tmp_path / "dangling", tmp_path / "nowhere", create_target=False)
    # 같은 경로가 여러 번(대소문자 · 끝의 \ 만 다름) 들어와도 한 번만 (품질팀 A-2)
    paths = [str(x) for x in (real, real / "f.txt", tmp_path / "missing", link, link / "logs", dangling)]
    paths += [str(link).upper(), str(link) + "\\", str(dangling)]
    p = ps_common("Get-PLReparsePoints -Paths ($env:PL_PATHS | ConvertFrom-Json) | ForEach-Object { 'HIT ' + $_ }; "
                  "Write-Output ('count=' + @(Get-PLReparsePoints -Paths @($env:PL_REAL)).Count)",
                  PL_PATHS=json.dumps(paths), PL_REAL=str(real))
    hits = [ln[4:] for ln in p.stdout.splitlines() if ln.startswith("HIT ")]
    assert hits == [str(link), str(dangling)], p.stdout + p.stderr
    assert "count=0" in p.stdout


def test_reparse_point_check_file_symlink(tmp_path, fake_env):
    """팀장 결정: cloud.env 파일 자체가 심볼릭 링크여도 걸리고, 설치 시험 실행이 -EnvFile 안내를 보여 줌.
    파일 심볼릭 링크는 일반 권한(개발자 모드 꺼짐)으로 만들 수 없으면 건너뜀 — 그 경우 코드 경로는
    test_install_stops_on_junction_paths[EnvFile](cloud.env 이름의 정션)로 확인"""
    link = tmp_path / "linkcfg" / "cloud.env"
    link.parent.mkdir()
    try:
        os.symlink(fake_env, link)
    except OSError as e:
        pytest.skip(f"파일 심볼릭 링크를 만들 권한이 없음: {e}")
    try:
        p = ps_common("Get-PLReparsePoints -Paths @($env:PL_PATH, $env:PL_REAL) | ForEach-Object { 'HIT ' + $_ }",
                      PL_PATH=str(link), PL_REAL=str(fake_env))
        assert [ln[4:] for ln in p.stdout.splitlines() if ln.startswith("HIT ")] == [str(link)], p.stdout + p.stderr
        p = ps(SERVER_PC / "install.ps1", "-DryRun", "-Root", str(tmp_path / "root"), "-AppDir", str(tmp_path / "app"),
               "-EnvFile", str(link), "-SkipFunnel")
        out = p.stdout + p.stderr
        assert p.returncode == 0 and f"{link} — -EnvFile로 실제 파일 경로를 넘기세요" in out, out
    finally:
        link.unlink()


def test_reset_acl_reports_failure_and_install_warns(tmp_path):
    """팀장 결정: Reset-PLInheritedAcl 은 icacls 종료 코드를 돌려주고(실패면 0이 아님), install 은 그때 WARN 만 남기고 계속"""
    p = ps_common("Write-Output ('code=' + (Reset-PLInheritedAcl -Path $env:PL_PATH))", PL_PATH=str(tmp_path / "missing"))
    m = re.search(r"code=(\d+)", p.stdout)
    assert m and m.group(1) != "0", p.stdout + p.stderr
    text = (SERVER_PC / "install.ps1").read_text(encoding="utf-8-sig")
    block = text[text.index("$code = Reset-PLInheritedAcl"):]
    block = block[:block.index("} | Out-Null")]
    assert "if ($code -ne 0)" in block and "-Level WARN" in block and "설치는 계속" in block and "throw" not in block
    assert 'icacls `"$child`" 를 직접 실행' in block                 # 실패한 그 경로로 확인하라고 안내 (품질팀 A-1)


@pytest.mark.parametrize("which", ["Root", "AppDir", "LogDir", "TmpDir", "EnvDir", "EnvFile", "RootIsEnvDir"])
def test_install_stops_on_junction_paths(tmp_path, fake_env, junctions, which):
    """팀장 결정 C: 루트 · 저장소 · logs · tmp · cloud.env 폴더가 정션이면 시험 실행은 무엇이 걸리는지 보여 주고,
    실제 실행은 아무것도 만들거나 바꾸기 전에 멈춘다(관리자 권한 확인보다 먼저).
    -AppDir 는 임시 폴더라 검사가 빠져도 저장소 확인에서 멈춤 — 이 PC의 저장소 · 작업 스케줄러에 닿지 않는다"""
    target = tmp_path / "target"
    (target / "inner").mkdir(parents=True)
    root, app, env_file = tmp_path / "root", tmp_path / "app", fake_env
    log_dir, tmp_dir = root / "logs", root / "tmp"
    if which in ("Root", "RootIsEnvDir"):
        root = junctions(tmp_path / "rootlink", target)
        log_dir, tmp_dir = root / "logs", root / "tmp"
        if which == "RootIsEnvDir":  # 같은 정션이 루트이자 cloud.env 폴더 → 한 번만 보고 (품질팀 A-2)
            env_file = root / "cloud.env"
    elif which == "AppDir":
        app = junctions(tmp_path / "applink", target)
    elif which == "LogDir":
        log_dir = junctions(root / "logs", target)
    elif which == "TmpDir":
        tmp_dir = junctions(root / "tmp", target)
    elif which == "EnvDir":
        env_file = junctions(tmp_path / "cfglink", fake_env.parent, create_target=False) / "cloud.env"
    else:  # cloud.env 이름의 정션 — 파일 심볼릭 링크와 같은 재분석 지점 검사 경로(일반 권한으로 만들 수 있음)
        env_file = junctions(tmp_path / "cfg2" / "cloud.env", target)
    link = {"Root": root, "AppDir": app, "LogDir": log_dir, "TmpDir": tmp_dir, "EnvDir": env_file.parent,
            "EnvFile": env_file, "RootIsEnvDir": root}[which]
    args = ("-Root", str(root), "-AppDir", str(app), "-LogDir", str(log_dir), "-TmpDir", str(tmp_dir),
            "-EnvFile", str(env_file), "-SkipFunnel")
    msg = "정션 · 심볼릭 링크 경로는 지원하지 않아요: " + str(link)
    hint = "-EnvFile로 실제 파일 경로를 넘기세요" if which == "EnvFile" else "실제 폴더 경로를 -Root/-LogDir/-TmpDir"

    def state():
        return (sorted(str(x) for x in tmp_path.rglob("*")), _acl(target), _acl(target / "inner"), _acl(fake_env),
                _acl(fake_env.parent), scheduled_paperlab_tasks())

    before = state()
    p = ps(SERVER_PC / "install.ps1", "-DryRun", *args)
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert "확인 실패(시험 실행이라 계속): " + msg + " — " + hint in out, out
    assert out.count(msg + " — ") == 1, out                         # 같은 경로는 한 번만
    assert state() == before
    p = ps(SERVER_PC / "install.ps1", *args)
    out = p.stdout + p.stderr
    assert p.returncode != 0, out
    assert "확인 실패: " + msg in out and "설치를 멈췄어요: 정션 · 심볼릭 링크 경로 1개" in out, out
    assert "설치 시작" not in out                                    # 로그 파일 · 폴더를 만들기 전에 멈춤
    assert state() == before


def test_funnel_and_uninstall_dry_run():
    tasks_before = scheduled_paperlab_tasks()
    p = ps(SERVER_PC / "funnel.ps1", "off", "-DryRun")
    assert p.returncode == 0 and "[DRY] Funnel 끄기" in p.stdout, p.stdout + p.stderr
    p = ps(SERVER_PC / "funnel.ps1", "on", "-DryRun")
    assert p.returncode == 0 and "[DRY] Funnel 켜기: tailscale funnel --bg 8080" in p.stdout, p.stdout + p.stderr
    p = ps(SERVER_PC / "uninstall.ps1", "-DryRun")
    assert p.returncode == 0 and "[DRY] Funnel 끄기" in p.stdout, p.stdout + p.stderr
    assert scheduled_paperlab_tasks() == tasks_before
    assert re.search(r"cloud\.env", p.stdout)  # 비밀 파일은 지우지 않는다고 알림


# ====================================================================== 2b — update.ps1 데스크톱 앱 빌드 단계 (AC-88, 명세 13.7.1)
# 가짜 npm · node(.cmd → 파이썬)를 PATH 앞에 두고 스크립트 임시 사본의 common.ps1 끝에 서버 쪽 가짜 함수(파이썬 명령 · 작업 재시작 ·
# 상태 확인)를 덧붙인다. 실제 npm · electron-builder · 작업 스케줄러 · DB 에는 닿지 않는다.
_FAKE_NPM = r'''
import hashlib, base64, json, os, sys, time
from pathlib import Path
args = sys.argv[1:]
with open(os.environ["FAKE_NPM_LOG"], "a", encoding="utf-8") as f:
    f.write(json.dumps({"args": args, "cwd": os.getcwd(), "at": time.time(),
                        "env": {k: os.environ.get(k) for k in ("npm_config_cache", "ELECTRON_CACHE", "ELECTRON_BUILDER_CACHE")}}) + "\n")
if args[:1] == ["-v"]:
    print("11.0.0"); sys.exit(0)
if args[:1] == ["ci"]:
    print("added 300 packages"); sys.exit(int(os.environ.get("FAKE_NPM_CI_EXIT", "0")))
if args[:2] == ["run", "dist"]:
    if os.environ.get("FAKE_NPM_SLEEP"):
        time.sleep(float(os.environ["FAKE_NPM_SLEEP"]))
    code = int(os.environ.get("FAKE_NPM_DIST_EXIT", "0"))
    if code:
        print("electron-builder failed"); sys.exit(code)
    version = json.loads(Path("package.json").read_text(encoding="utf-8"))["version"]
    dist = Path("dist"); dist.mkdir(exist_ok=True)
    exe = dist / f"PaperLab-Setup-{version}.exe"
    exe.write_bytes(("installer " + version).encode() * 5000)
    (dist / f"{exe.name}.blockmap").write_bytes(b"blockmap " + version.encode())
    sha = base64.b64encode(hashlib.sha512(exe.read_bytes()).digest()).decode()
    if os.environ.get("FAKE_NPM_BAD_SHA"):
        sha = base64.b64encode(hashlib.sha512(b"other").digest()).decode()
    (dist / "latest.yml").write_text(f"version: {version}\nfiles:\n  - url: {exe.name}\n    sha512: {sha}\n    size: {exe.stat().st_size}\n"
                                     f"path: {exe.name}\nsha512: {sha}\nreleaseDate: '2026-10-08T00:00:00.000Z'\n", encoding="utf-8")
    print("PaperLab 서버 주소(server.json): https://pl.example · 업데이트 주소: https://pl.example/downloads/")
    sys.exit(0)
sys.exit(9)
'''

_BUILD_STUB = (
    "\r\nfunction Invoke-PLNative {{\r\n"
    "  param([Parameter(Mandatory = $true)][string]$FilePath, [string[]]$Arguments = @(), [string]$WorkingDirectory)\r\n"
    "  Add-Content -LiteralPath '{calls}' -Value ($Arguments -join ' ') -Encoding UTF8\r\n"
    "  return 0\r\n}}\r\n"
    "function Restart-PLServerTask {{\r\n"
    "  param([string]$TaskName, [int]$Port, [string]$LogFile, [switch]$DryRun)\r\n"
    "  Add-Content -LiteralPath '{calls}' -Value ('restart ' + $TaskName) -Encoding UTF8\r\n}}\r\n"
    "function Wait-PLHealth {{\r\n"
    "  param([int]$Port, [switch]$Deep, [int]$TimeoutSec, [string]$Commit)\r\n"
    "  if ($env:PL_HEALTH_FAIL -eq '1') {{ return $null }}\r\n"
    "  return [pscustomobject]@{{ ok = $true; commit = $Commit }}\r\n}}\r\n"
    "function Test-PLIsAdmin {{ return $false }}\r\n")


@pytest.fixture
def build_env(tmp_path, monkeypatch):
    """가짜 npm · node 를 PATH 앞에, 스크립트 사본(서버 쪽 가짜 함수), releases · cache · logs 폴더"""
    fake = tmp_path / "fakebin"
    fake.mkdir()
    (fake / "fake_npm.py").write_text(_FAKE_NPM, encoding="utf-8")
    # 배치 파일은 OEM 코드 페이지로 읽혀 한글 경로가 깨짐 → 저장소 밖(가상환경이 아닌) 파이썬 경로를 씀(표준 라이브러리만 필요)
    py = Path(sys.base_prefix) / "python.exe"
    py = py if py.exists() and str(py).isascii() else Path(sys.executable)
    (fake / "npm.cmd").write_text(f'@"{py}" "{fake / "fake_npm.py"}" %*\r\n', encoding="ascii")
    (fake / "node.cmd").write_text("@echo %FAKE_NODE_VERSION%\r\n", encoding="ascii")
    monkeypatch.setenv("PATH", f"{fake}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("FAKE_NODE_VERSION", "v24.14.0")
    monkeypatch.setenv("FAKE_NPM_LOG", str(tmp_path / "npm.log"))
    monkeypatch.delenv("PAPERLAB_RELEASES_DIR", raising=False)
    for k in ("FAKE_NPM_CI_EXIT", "FAKE_NPM_DIST_EXIT", "FAKE_NPM_SLEEP", "FAKE_NPM_BAD_SHA", "PL_HEALTH_FAIL"):
        monkeypatch.delenv(k, raising=False)
    copy = tmp_path / "scripts"
    shutil.copytree(SERVER_PC, copy)
    calls = tmp_path / "calls.txt"
    with open(copy / "common.ps1", "ab") as f:
        f.write(_BUILD_STUB.format(calls=calls).encode("utf-8"))
    dirs = {k: tmp_path / k for k in ("releases", "cache", "logs")}
    return {"scripts": copy, "calls": calls, "npm_log": tmp_path / "npm.log", **dirs}


def _desktop_repo(tmp_path, change: str) -> Path:
    """origin: desktop/package.json 0.2.0 → 다음 커밋(change): bump(desktop 바뀜 + 0.2.1) · same(desktop 바뀜, 버전 그대로) · none(desktop 밖만)"""
    origin, app = tmp_path / "origin", tmp_path / "app"
    _git("init", "-q", "-b", "main", str(origin), cwd=tmp_path)
    for k, v in (("user.email", "t@example.com"), ("user.name", "t")):
        _git("config", k, v, cwd=origin)
    (origin / "desktop").mkdir()
    (origin / "desktop" / "package.json").write_text('{"name": "x", "version": "0.2.0"}\n', encoding="utf-8")
    (origin / "desktop" / "a.js").write_text("1\n", encoding="utf-8")
    (origin / "a.txt").write_text("1\n", encoding="utf-8")
    (origin / ".gitignore").write_text("dist/\nnode_modules/\n", encoding="utf-8")  # 저장소 .gitignore 와 같게(빌드 결과물)
    _git("add", ".", cwd=origin)
    _git("commit", "-qm", "one", cwd=origin)
    _git("clone", "-q", str(origin), str(app), cwd=tmp_path)
    if change in ("bump", "same"):
        (origin / "desktop" / "a.js").write_text("2\n", encoding="utf-8")
    if change == "bump":
        (origin / "desktop" / "package.json").write_text('{"name": "x", "version": "0.2.1"}\n', encoding="utf-8")
    if change == "none":
        (origin / "a.txt").write_text("2\n", encoding="utf-8")
    _git("commit", "-qam", "two", cwd=origin)
    _git("fetch", "-q", cwd=app)
    return app


def _run_update(env, app, *extra):
    return ps(env["scripts"] / "update.ps1", "-Yes", "-AppDir", str(app), "-Branch", "main", "-LogDir", str(env["logs"]),
              "-TimeoutSec", "5", "-ReleasesDir", str(env["releases"]), "-CacheDir", str(env["cache"]), *extra, timeout=240)


def _seed_release(releases: Path, *versions: str) -> dict:
    """이전에 내보낸 설치 파일들 + latest.yml(마지막 버전) → {이름: sha256}"""
    releases.mkdir(parents=True, exist_ok=True)
    for v in versions:
        (releases / f"PaperLab-Setup-{v}.exe").write_bytes(f"old {v}".encode())
        (releases / f"PaperLab-Setup-{v}.exe.blockmap").write_bytes(f"bm {v}".encode())
    (releases / "latest.yml").write_text(f"version: {versions[-1]}\n", encoding="utf-8")
    return _hashes(releases)


def _hashes(folder: Path) -> dict:
    import hashlib
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.iterdir()) if p.is_file()}


def _npm_calls(env) -> list[dict]:
    p = env["npm_log"]
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines()] if p.exists() else []


def test_build_success_moves_files_and_writes_release_json(tmp_path, build_env):
    """AC-88 (a): desktop/ 변경 + 새 버전 → 서버 반영 · 상태 확인 뒤 npm ci → npm run dist, releases 에 네 파일,
    release.json sha256 = 실제 파일, 캐시 변수는 -CacheDir 아래, .staging 없음, 종료 코드 0"""
    import hashlib
    app = _desktop_repo(tmp_path, "bump")
    p = _run_update(build_env, app)
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    rel = build_env["releases"]
    exe = rel / "PaperLab-Setup-0.2.1.exe"
    assert exe.exists() and (rel / "PaperLab-Setup-0.2.1.exe.blockmap").exists() and not (rel / ".staging").exists()
    info = json.loads((rel / "release.json").read_text(encoding="utf-8"))
    assert info["version"] == "0.2.1" and info["file"] == exe.name and info["size"] == exe.stat().st_size
    assert info["sha256"] == hashlib.sha256(exe.read_bytes()).hexdigest() and len(info["commit"]) == 7
    assert "version: 0.2.1" in (rel / "latest.yml").read_text(encoding="utf-8")
    calls = _npm_calls(build_env)
    assert [c["args"] for c in calls if c["args"] != ["-v"]] == [["ci"], ["run", "dist"]]
    assert all(Path(c["cwd"]) == app / "desktop" for c in calls if c["args"] != ["-v"])
    assert calls[-1]["env"] == {"npm_config_cache": str(build_env["cache"] / "npm"), "ELECTRON_CACHE": str(build_env["cache"] / "electron"),
                                "ELECTRON_BUILDER_CACHE": str(build_env["cache"] / "electron-builder")}
    log = (build_env["logs"] / "update.log").read_text(encoding="utf-8-sig")
    assert log.index("업데이트 성공") < log.index("데스크톱 앱 빌드 시작") < log.index("데스크톱 앱 빌드 성공")  # 서버 확인 뒤
    assert f"sha256 {info['sha256']}" in log and "빌드 로그 확인: PaperLab 서버 주소" in log
    assert "[WARN]" not in log
    builds = list(build_env["logs"].glob("desktop-build-*.log"))
    assert len(builds) == 1 and "> npm ci" in builds[0].read_text(encoding="utf-8-sig")
    assert "restart PaperLab Server" in build_env["calls"].read_text(encoding="utf-8-sig")


def test_build_moves_latest_yml_last():
    """AC-88 (a): 옮기는 순서 .exe → .blockmap → release.json → latest.yml(마지막), latest.yml 은 교체(File.Replace)"""
    text = (SERVER_PC / "common.ps1").read_text(encoding="utf-8-sig")
    assert "foreach ($f in @($exeName, \"$exeName.blockmap\", 'release.json', 'latest.yml'))" in text
    assert "[IO.File]::Replace($Source, $Destination, [NullString]::Value)" in text


@pytest.mark.parametrize("failure", ["dist_exit", "ci_exit", "timeout", "bad_sha", "move_fail"])
def test_build_failure_keeps_previous_release(tmp_path, build_env, monkeypatch, failure):
    """AC-88 (b): 빌드 실패 · 시간 초과 · latest.yml sha512 불일치 → WARN, 이전 파일 그대로(해시 같음), .staging 없음, 종료 코드 0"""
    app = _desktop_repo(tmp_path, "bump")
    before = _seed_release(build_env["releases"], "0.1.9", "0.2.0")
    extra = ()
    if failure == "dist_exit":
        monkeypatch.setenv("FAKE_NPM_DIST_EXIT", "1")
    elif failure == "ci_exit":
        monkeypatch.setenv("FAKE_NPM_CI_EXIT", "1")
    elif failure == "timeout":
        monkeypatch.setenv("FAKE_NPM_SLEEP", "60")
        extra = ("-BuildTimeoutSec", "4")
    elif failure == "bad_sha":
        monkeypatch.setenv("FAKE_NPM_BAD_SHA", "1")
    else:  # latest.yml 교체가 실패(읽기 전용) → 이번에 옮긴 새 버전 파일을 지우고 release.json 을 되돌림
        (build_env["releases"] / "release.json").write_text('{"version": "0.2.0"}', encoding="utf-8")
        before = _hashes(build_env["releases"])
        os.chmod(build_env["releases"] / "latest.yml", 0o444)
    p = _run_update(build_env, app, *extra)
    os.chmod(build_env["releases"] / "latest.yml", 0o666)
    out = p.stdout + p.stderr
    assert p.returncode == 0, out
    assert _hashes(build_env["releases"]) == before
    assert not (build_env["releases"] / ".staging").exists()
    log = (build_env["logs"] / "update.log").read_text(encoding="utf-8-sig")
    assert "업데이트 성공" in log and "[WARN] 데스크톱 앱 빌드 실패(" in log and "이전 설치 파일을 그대로 둬요" in log
    assert "desktop-build-" in log
    reason = {"dist_exit": "npm run dist — 종료 코드 1", "ci_exit": "npm ci — 종료 코드 1", "timeout": "시간 초과(4 초)",
              "bad_sha": "sha512 가 실제 파일과 다름", "move_fail": "데스크톱 앱 빌드 실패(옮기기"}[failure]
    assert reason in log, log


def test_build_skipped_when_version_unchanged(tmp_path, build_env):
    """AC-88 (c): desktop/ 이 바뀌었는데 버전이 이미 releases 에 있으면 빌드하지 않고 WARN"""
    app = _desktop_repo(tmp_path, "same")
    before = _seed_release(build_env["releases"], "0.2.0")
    p = _run_update(build_env, app)
    assert p.returncode == 0, p.stdout + p.stderr
    log = (build_env["logs"] / "update.log").read_text(encoding="utf-8-sig")
    assert "[WARN] 데스크톱 앱이 바뀌었지만 버전이 같아 빌드하지 않았어요 — desktop/package.json 버전을 올려 주세요" in log
    assert not [c for c in _npm_calls(build_env) if c["args"] != ["-v"]]
    assert _hashes(build_env["releases"]) == before


def test_build_not_run_without_desktop_change(tmp_path, build_env):
    """AC-88 (d): desktop/ 이 바뀌지 않으면 빌드하지 않음(WARN 없음)"""
    app = _desktop_repo(tmp_path, "none")
    p = _run_update(build_env, app)
    assert p.returncode == 0, p.stdout + p.stderr
    log = (build_env["logs"] / "update.log").read_text(encoding="utf-8-sig")
    assert "업데이트 성공" in log and "데스크톱" not in log and "[WARN]" not in log
    assert not _npm_calls(build_env) and not build_env["releases"].exists()


@pytest.mark.parametrize("case", ["health_fail", "ref", "restart_only"])
def test_build_not_run_on_rollback_ref_or_restart(tmp_path, build_env, monkeypatch, case):
    """AC-88 (e): 상태 확인 실패로 되돌린 경우 · -Ref · -RestartOnly → 빌드하지 않음"""
    app = _desktop_repo(tmp_path, "bump")
    if case == "health_fail":
        monkeypatch.setenv("PL_HEALTH_FAIL", "1")
        p = _run_update(build_env, app)
        assert p.returncode == 1
    elif case == "ref":
        target = subprocess.run(["git", "rev-parse", "origin/main"], cwd=app, capture_output=True, text=True).stdout.strip()
        p = _run_update(build_env, app, "-Ref", target)
        assert p.returncode == 0, p.stdout + p.stderr
        log = (build_env["logs"] / "update.log").read_text(encoding="utf-8-sig")
        assert "-Ref 로 커밋을 맞춘 경우라 데스크톱 앱은 빌드하지 않아요" in log
    else:
        p = ps(build_env["scripts"] / "update.ps1", "-RestartOnly", "-BuildDesktop", "-AppDir", str(app), "-LogDir", str(build_env["logs"]),
               "-TimeoutSec", "5", "-ReleasesDir", str(build_env["releases"]), "-CacheDir", str(build_env["cache"]))
        assert p.returncode == 0, p.stdout + p.stderr
    assert not _npm_calls(build_env) and not build_env["releases"].exists()


def test_build_skipped_when_node_too_old(tmp_path, build_env, monkeypatch):
    """AC-88 (f): node 주 버전이 22 미만이면 빌드 단계만 WARN, 서버 업데이트는 성공(종료 코드 0)"""
    monkeypatch.setenv("FAKE_NODE_VERSION", "v20.11.0")
    app = _desktop_repo(tmp_path, "bump")
    p = _run_update(build_env, app)
    assert p.returncode == 0, p.stdout + p.stderr
    log = (build_env["logs"] / "update.log").read_text(encoding="utf-8-sig")
    assert "업데이트 성공" in log and "[WARN] Node.js 22 이상 · npm 이 없어 데스크톱 앱 빌드를 건너뛰어요 (node v20.11.0, npm 11.0.0)" in log
    assert not [c for c in _npm_calls(build_env) if c["args"] != ["-v"]]


def test_build_keeps_three_versions(tmp_path, build_env):
    """AC-88 (g): 4번째 버전을 넣으면 가장 오래된 버전의 .exe · .blockmap 이 지워지고 3개만 남음"""
    app = _desktop_repo(tmp_path, "bump")
    _seed_release(build_env["releases"], "0.1.10", "0.1.2", "0.2.0")
    p = _run_update(build_env, app)
    assert p.returncode == 0, p.stdout + p.stderr
    names = sorted(x.name for x in build_env["releases"].iterdir())
    assert names == ["PaperLab-Setup-0.1.10.exe", "PaperLab-Setup-0.1.10.exe.blockmap", "PaperLab-Setup-0.2.0.exe",
                     "PaperLab-Setup-0.2.0.exe.blockmap", "PaperLab-Setup-0.2.1.exe", "PaperLab-Setup-0.2.1.exe.blockmap",
                     "latest.yml", "release.json"]  # 0.1.2 < 0.1.10 (숫자 비교)


def test_build_desktop_switch_without_new_commit(tmp_path, build_env):
    """-BuildDesktop: 새 커밋이 없어도(처음 배포 · 지난 실패 뒤) 빌드, 이미 있는 버전이면 WARN"""
    app = _desktop_repo(tmp_path, "none")
    _git("merge", "-q", "--ff-only", "origin/main", cwd=app)
    p = _run_update(build_env, app, "-BuildDesktop")
    assert p.returncode == 0, p.stdout + p.stderr
    assert (build_env["releases"] / "PaperLab-Setup-0.2.0.exe").exists()
    p = _run_update(build_env, app, "-BuildDesktop")
    log = (build_env["logs"] / "update.log").read_text(encoding="utf-8-sig")
    assert p.returncode == 0 and "[WARN] 버전 0.2.0 설치 파일이 이미 있어 빌드하지 않았어요" in log


def test_build_dry_run_changes_nothing(tmp_path, build_env):
    app = _desktop_repo(tmp_path, "bump")
    p = ps(build_env["scripts"] / "update.ps1", "-DryRun", "-Yes", "-AppDir", str(app), "-Branch", "main", "-LogDir", str(build_env["logs"]),
           "-ReleasesDir", str(build_env["releases"]), "-CacheDir", str(build_env["cache"]))
    assert p.returncode == 0, p.stdout + p.stderr
    assert "[DRY] 데스크톱 앱 빌드: node · npm 확인(22 이상) → desktop\\ 에서 npm ci → npm run dist" in p.stdout
    assert not _npm_calls(build_env) and not build_env["releases"].exists() and not build_env["logs"].exists()


def test_releases_dir_rule_matches_server(tmp_path, fake_env):
    """서버(downloads.py)와 같은 규칙: 프로세스 환경 변수 → cloud.env 의 같은 키 → 기본값(같은 상수). cloud.env 다른 값은 출력하지 않음"""
    from paperlab.downloads import DEFAULT_RELEASES_DIR
    text = (SERVER_PC / "common.ps1").read_text(encoding="utf-8-sig")
    assert f"$script:PLDefaultReleasesDir = '{DEFAULT_RELEASES_DIR}'" in text
    snippet = "Write-Output ('dir=' + (Get-PLReleasesDir -EnvFile $env:PL_ENV))"
    p = ps_common(snippet, PL_ENV=str(fake_env), PAPERLAB_RELEASES_DIR="")
    assert f"dir={DEFAULT_RELEASES_DIR}" in p.stdout, p.stdout + p.stderr
    with open(fake_env, "a", encoding="utf-8") as f:
        f.write('PAPERLAB_RELEASES_DIR="E:\\PL\\rel"\n')
    p = ps_common(snippet, PL_ENV=str(fake_env), PAPERLAB_RELEASES_DIR="")
    assert "dir=E:\\PL\\rel" in p.stdout, p.stdout + p.stderr
    p = ps_common(snippet, PL_ENV=str(fake_env), PAPERLAB_RELEASES_DIR="F:\\x")
    assert "dir=F:\\x" in p.stdout
    for secret in ("anon-SECRET-value", "r2-SECRET-value", "fakeref"):
        assert secret not in p.stdout + p.stderr


def test_no_github_publish_or_token_in_repo():
    """AC-88 (h): 저장소(문서 제외)에 GH_TOKEN · provider github 가 없음"""
    hits = []
    for base in ("paperlab", "deploy", "tests", "desktop"):
        for f in (ROOT / base).rglob("*"):
            if {"node_modules", "dist"} & set(f.relative_to(ROOT).parts) or not f.is_file() or f.suffix not in (".py", ".ps1", ".js", ".json", ".yml"):
                continue
            if f.name == "test_server_pc_scripts.py":
                continue
            t = f.read_text(encoding="utf-8", errors="replace")
            if "GH_TOKEN" in t or re.search(r"provider['\"]?\s*:\s*['\"]github", t):
                hits.append(f.relative_to(ROOT).as_posix())
    assert hits == []


def test_build_skipped_when_version_not_higher(tmp_path, build_env):
    """품질팀 F2: 새 버전이 releases 의 가장 높은 버전 이하이면 빌드하지 않고 WARN(파일 그대로 · latest.yml 그대로)"""
    app = _desktop_repo(tmp_path, "bump")  # 0.2.1
    before = _seed_release(build_env["releases"], "0.3.0", "0.4.0", "0.5.0")
    p = _run_update(build_env, app)
    assert p.returncode == 0, p.stdout + p.stderr
    log = (build_env["logs"] / "update.log").read_text(encoding="utf-8-sig")
    assert "[WARN] 데스크톱 앱 버전 0.2.1 이 이미 내보낸 가장 높은 버전 0.5.0 이하라 빌드하지 않았어요" in log
    assert not [c for c in _npm_calls(build_env) if c["args"] != ["-v"]]
    assert _hashes(build_env["releases"]) == before


def test_retention_never_removes_current_latest(tmp_path):
    """품질팀 F2: 옛 파일 정리는 최근 3개 버전만 남기되, 지금 latest.yml 이 가리키는 버전은 몇 번째든 지우지 않음"""
    rel = tmp_path / "rel"
    _seed_release(rel, "0.1.1", "0.1.2", "0.1.3", "0.1.0")  # latest.yml → 0.1.0 (가장 낮음)
    p = ps_common("Remove-PLOldReleases -ReleasesDir $env:PL_REL -Keep 3", PL_REL=str(rel))
    assert p.returncode == 0, p.stdout + p.stderr
    assert (rel / "PaperLab-Setup-0.1.0.exe").exists() and (rel / "PaperLab-Setup-0.1.0.exe.blockmap").exists()
    assert "latest.yml 이 가리키는 버전이라 지우지 않음" in p.stdout
    (rel / "latest.yml").write_text("version: 0.1.3\n", encoding="utf-8")
    ps_common("Remove-PLOldReleases -ReleasesDir $env:PL_REL -Keep 3", PL_REL=str(rel))
    assert sorted(x.name for x in rel.glob("*.exe")) == ["PaperLab-Setup-0.1.1.exe", "PaperLab-Setup-0.1.2.exe", "PaperLab-Setup-0.1.3.exe"]


def test_build_malformed_package_json_is_warn_only(tmp_path, build_env):
    """품질팀 F4: desktop/package.json 이 JSON 이 아니어도 서버 반영은 성공(종료 코드 0), 빌드만 WARN"""
    app = _desktop_repo(tmp_path, "bump")
    origin = tmp_path / "origin"
    (origin / "desktop" / "package.json").write_text('{"name": "x", "version": "0.2.2",,}\n', encoding="utf-8")
    _git("commit", "-qam", "three", cwd=origin)
    _git("fetch", "-q", cwd=app)
    p = _run_update(build_env, app)
    assert p.returncode == 0, p.stdout + p.stderr
    log = (build_env["logs"] / "update.log").read_text(encoding="utf-8-sig")
    assert "업데이트 성공" in log and "[WARN] 데스크톱 앱 빌드 건너뜀: desktop\\package.json 을 읽지 못했어요" in log
    assert not [c for c in _npm_calls(build_env) if c["args"] != ["-v"]]
