"""graph.test.mjs(인용 그래프 화면 순수 함수 · 코드 검사 · 벤더 해시)를 pytest 안에서 돌린다
(docs/specs/citation-graph.md 11장 E — AC-G50 · 51 · 52). tests/test_extlinks_js.py와 같은 방식.

- Node가 없거나 너무 오래되면(20.10 미만) 건너뛴다(skip).
- 경로에 한글 · 공백이 있어도 되게 셸을 거치지 않고 리스트 인자로 부른다.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from .test_extlinks_js import DETECT_DEFAULT, MIN_NODE, _node_version

ROOT = Path(__file__).resolve().parent.parent
TEST_FILE = ROOT / "tests" / "js" / "graph.test.mjs"


def test_graph_js_node():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js가 없어 graph.js 테스트를 건너뜀 (node --test tests/js/graph.test.mjs)")
    version = _node_version(node)
    if version is None or version[:2] < MIN_NODE:
        pytest.skip(f"Node.js {'.'.join(map(str, MIN_NODE))} 이상이 필요함 (지금 {version})")
    assert TEST_FILE.is_file(), TEST_FILE
    cmd = [node]
    if version[:2] < DETECT_DEFAULT:
        cmd.append("--experimental-detect-module")
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
    assert count("pass") >= 15, f"통과한 테스트가 너무 적음:\n{out[-3000:]}"
