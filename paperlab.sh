#!/usr/bin/env bash
# PaperLab 실행기 (macOS / Linux): 처음 실행하면 가상환경을 만들고 설치한 뒤 실행합니다.
set -e
cd "$(dirname "$0")"

PY=.venv/bin/python
if [ ! -x "$PY" ]; then
  echo "[PaperLab] 처음 실행이라 설치를 진행합니다. 1~3분 걸려요..."
  if command -v python3 > /dev/null; then BASE=python3; else BASE=python; fi
  if ! "$BASE" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2> /dev/null; then
    echo "Python 3.10 이상이 필요해요: https://www.python.org/downloads/"
    exit 1
  fi
  "$BASE" -m venv .venv
fi

# pyproject.toml이 바뀌었으면(업데이트) 다시 설치
if ! cmp -s pyproject.toml .venv/pyproject.installed; then
  echo "[PaperLab] 필요한 패키지를 설치하는 중..."
  "$PY" -m pip install --disable-pip-version-check -q --upgrade pip
  "$PY" -m pip install --disable-pip-version-check -q -e .
  cp pyproject.toml .venv/pyproject.installed
fi

exec "$PY" -m paperlab "$@"
