#!/usr/bin/env bash
# macOS에서 더블클릭으로 실행하는 파일
exec "$(dirname "$0")/paperlab.sh" "$@"
