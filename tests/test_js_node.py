"""화면 순수 모듈의 Node 단위 테스트(tests/js/*.test.mjs)를 pytest 안에서 돌린다. 여기서는 그 결과만 확인한다.

- extlinks.test.mjs: 인하대 · 학교 DB · Scholar 주소 (docs/specs/inha-proxy.md 13.1절 · IK-2)
- graph.test.mjs: 인용 그래프 순수 함수 · 코드 검사 · 벤더 해시 (docs/specs/citation-graph.md 11장 E — AC-G50 · 51 · 52)
- refquote.test.mjs: 참고 패널 넣기 형식 · 쪽 번호 · 이스케이프 · 코드 검사 (docs/specs/writing-reference-pane.md 12장 D)
- jobs.test.mjs: 2단계 작업 상태 문구 · 경로 단계 · 기한 · 계정 가림 (docs/design/phase2-worker-electron-ui.md 5장)
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
MIN_NODE = (20, 10)  # --test-reporter · String.isWellFormed · --experimental-detect-module
DETECT_DEFAULT = (22, 7)  # 이 버전부터 package.json 없는 .js의 ES 모듈 문법을 기본으로 알아봄
MIN_PASS = {"extlinks": 80, "graph": 15, "refquote": 10, "jobs": 8}  # 너무 적게 통과하면(테스트가 사라짐) 실패


def _node_version(node: str) -> tuple[int, ...] | None:
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.match(r"v(\d+)\.(\d+)\.(\d+)", out.strip())
    return tuple(int(x) for x in m.groups()) if m else None


@pytest.mark.parametrize("name", sorted(MIN_PASS))
def test_js_node(name):
    test_file = ROOT / "tests" / "js" / f"{name}.test.mjs"
    node = shutil.which("node")
    if not node:
        pytest.skip(f"Node.js가 없어 {name} 테스트를 건너뜀 (node --test tests/js/{name}.test.mjs)")
    version = _node_version(node)
    if version is None or version[:2] < MIN_NODE:
        pytest.skip(f"Node.js {'.'.join(map(str, MIN_NODE))} 이상이 필요함 (지금 {version})")
    assert test_file.is_file(), test_file

    cmd = [node]
    if version[:2] < DETECT_DEFAULT:
        cmd.append("--experimental-detect-module")  # static/js/*.js(.js · package.json 없음)를 ES 모듈로 읽게 함
    cmd += ["--test", "--test-reporter=tap", str(test_file)]
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, encoding="utf-8", errors="replace", timeout=300)
    out = proc.stdout + proc.stderr

    def count(key: str) -> int:
        m = re.search(rf"^# {key} (\d+)\s*$", out, re.M)
        assert m, f"TAP 요약에 '{key}'이 없음:\n{out[-3000:]}"
        return int(m.group(1))

    assert proc.returncode == 0, f"node --test 실패 (종료 코드 {proc.returncode}):\n{out[-6000:]}"
    assert count("fail") == 0, out[-6000:]
    assert count("cancelled") == 0, out[-6000:]
    assert count("pass") >= MIN_PASS[name], f"통과한 테스트가 너무 적음:\n{out[-3000:]}"
