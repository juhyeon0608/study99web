@echo off
rem PaperLab 실행기 (Windows): 처음 실행하면 가상환경을 만들고 설치한 뒤 실행합니다.
chcp 65001 > nul
setlocal
cd /d "%~dp0"

set "PY=.venv\Scripts\python.exe"
if exist "%PY%" goto check

echo [PaperLab] 처음 실행이라 설치를 진행합니다. 1~3분 걸려요...
where py > nul 2> nul
if %errorlevel%==0 (
  py -3 -m venv .venv
) else (
  python -m venv .venv
)
if not exist "%PY%" (
  echo.
  echo Python 3.10 이상이 필요해요. https://www.python.org/downloads/ 에서 설치할 때
  echo "Add python.exe to PATH" 를 꼭 체크해 주세요.
  pause
  exit /b 1
)

:check
rem pyproject.toml이 바뀌었으면(업데이트) 다시 설치
fc /b pyproject.toml .venv\pyproject.installed > nul 2> nul
if %errorlevel%==0 goto run
echo [PaperLab] 필요한 패키지를 설치하는 중...
"%PY%" -m pip install --disable-pip-version-check -q --upgrade pip
"%PY%" -m pip install --disable-pip-version-check -q -e .
if errorlevel 1 (
  echo 설치에 실패했어요. 인터넷 연결을 확인하고 다시 실행해 주세요.
  pause
  exit /b 1
)
copy /y pyproject.toml .venv\pyproject.installed > nul

:run
"%PY%" -m paperlab %*
if errorlevel 1 pause
