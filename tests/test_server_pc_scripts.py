"""서버 PC 스크립트 (deploy/server-pc/*.ps1 · make-shortcut.ps1) — 이 PC에서는 **바꾸지 않는** 검사만 (명세 20.1):
PowerShell 파서 오류 0, BOM(Windows PowerShell 5.1이 한글을 바르게 읽게), 시험 실행(-DryRun)이 아무것도 바꾸지 않음,
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
    for base in ("paperlab", "deploy", "tests", "supabase"):
        for f in (ROOT / base).rglob("*"):
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
