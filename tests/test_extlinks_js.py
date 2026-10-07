"""extlinks.js 단위 테스트를 pytest 안에서 돌린다 (docs/specs/inha-proxy.md 13.1절 · IK-2).

- 실제 테스트는 tests/js/extlinks.test.mjs(Node 내장 `node --test`). 여기서는 그 결과만 확인한다.
- Node가 없거나 너무 오래되면(20.10 미만) 건너뛴다(skip) — AC-8.
- 경로에 한글 · 공백이 있어도 되게 셸을 거치지 않고 리스트 인자로 부른다.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
TEST_FILE = ROOT / "tests" / "js" / "extlinks.test.mjs"
MIN_NODE = (20, 10)  # --test-reporter · String.isWellFormed · --experimental-detect-module
DETECT_DEFAULT = (22, 7)  # 이 버전부터 package.json 없는 .js의 ES 모듈 문법을 기본으로 알아봄


def _node_version(node: str) -> tuple[int, ...] | None:
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.match(r"v(\d+)\.(\d+)\.(\d+)", out.strip())
    return tuple(int(x) for x in m.groups()) if m else None


def test_extlinks_js_node():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js가 없어 extlinks.js 테스트를 건너뜀 (node --test tests/js/extlinks.test.mjs)")
    version = _node_version(node)
    if version is None or version[:2] < MIN_NODE:
        pytest.skip(f"Node.js {'.'.join(map(str, MIN_NODE))} 이상이 필요함 (지금 {version})")
    assert TEST_FILE.is_file(), TEST_FILE

    cmd = [node]
    if version[:2] < DETECT_DEFAULT:
        cmd.append("--experimental-detect-module")  # extlinks.js(.js · package.json 없음)를 ES 모듈로 읽게 함
    cmd += ["--test", "--test-reporter=tap", str(TEST_FILE)]
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, encoding="utf-8", errors="replace", timeout=300)
    out = proc.stdout + proc.stderr

    def count(name: str) -> int:
        m = re.search(rf"^# {name} (\d+)\s*$", out, re.M)
        assert m, f"TAP 요약에 '{name}'이 없음:\n{out[-3000:]}"
        return int(m.group(1))

    assert proc.returncode == 0, f"node --test 실패 (종료 코드 {proc.returncode}):\n{out[-6000:]}"
    assert count("fail") == 0, out[-6000:]
    assert count("cancelled") == 0, out[-6000:]
    assert count("pass") >= 80, f"통과한 테스트가 너무 적음:\n{out[-3000:]}"  # 명세 표 행 + 추가 검사
