"""화면 순수 모듈의 Node 단위 테스트(tests/js/*.test.mjs)를 pytest 안에서 돌린다. 여기서는 그 결과만 확인한다.

- extlinks.test.mjs: 인하대 · 학교 DB · Scholar 주소 (docs/specs/inha-proxy.md 13.1절 · IK-2)
- graph.test.mjs: 인용 그래프 순수 함수 · 코드 검사 · 벤더 해시 (docs/specs/citation-graph.md 11장 E — AC-G50 · 51 · 52)
- refquote.test.mjs: 참고 패널 넣기 형식 · 쪽 번호 · 이스케이프 · 코드 검사 (docs/specs/writing-reference-pane.md 12장 D)
- jobs.test.mjs: 2단계 작업 상태 문구 · 경로 단계 · 기한 · 계정 가림 (docs/design/phase2-worker-electron-ui.md 5장)
- ask.test.mjs: 3단계 AI 질문 주소 · 색인 상태 · 찾기 단계 · 인용 검증 표시 (docs/design/phase3-ask-ui.md)
- sources.test.mjs: 5단계 소스 표 · 비활성 이유 · 오류 문구 · 라이선스 이름 · OpenCitations 줄 (docs/design/phase5-korean-db-ui.md)
- trash.test.mjs: 6단계 휴지통 남은 날 · 연결된 PC 동기화 줄 · 충돌 사본 (docs/design/phase6-folder-sync-ui.md 8 · 10장)
- explain.test.mjs: 4단계 SVG 순수 함수 · 쪽 상태 문구 · 시작 창 예상 · 코드 검사 (docs/specs/phase4-explain-translate.md 7.3 · 13장)
- filetypes.test.mjs: 서재에 넣는 파일 형식 · 형식 배지 (docs/specs/library-documents.md)
- writeedit.test.mjs: 논문 쓰기 목록(Enter · Tab) · 표 · 그림 · 캡션 번호 · 상호 참조 · 단축키 도움말 (docs/specs/writing-figures-tables.md)
- writeai.test.mjs: AI 글쓰기 결과 넣기 — 원고 지문 · 넣을 자리 다시 찾기 · 바뀌는 부분 (2026-10-16 백그라운드 AI) ·
  AI 결과 패널(모달 대신 편집기 옆 — 상태 · 단추 · 열림 기억 · Alt+A · 코드 검사, 2026-10-17)
- writenotes.test.mjs: 논문 쓰기 각주 읽기 · [각주] 넣기 · 도구 막대 한 줄 (docs/specs/export-lists-footnotes.md)
- syncmode.test.mjs: 선택 동기화 배지 · 폴더/파일 메뉴 · 켜고 끄기 확인 창 문구 · 로컬 항목 읽기/AI 안내 (docs/specs/selective-sync.md 10장 — AC-S61 · S62)
- writehist.test.mjs: 원고 버전 기록 — 줄 비교 · 접기 · 낱말 차이 · 목록 문구 · 코드 검사 (docs/specs/manuscript-history.md)
- writecheck.test.mjs: 논문 쓰기 제출 전 점검표 — 양식 · 번호 · 인용 · 글 다듬기 점검 규칙 · 분량 추정 (docs/specs/writing-checklist.md)
- writechat.test.mjs: AI에 보낼 범위(진짜 문단 · 이 절 · 이 장) · 원고 AI 대화 답 읽기 · 제안 넣기 · 장 · 절 일괄 처리 · 코드 검사
  (docs/specs/manuscript-ai-chat.md)
- writefig.test.mjs: 그림 만들기 · 고치기 — '이 내용으로' 범위 · 넣을 자리 · 그림 넣기 · 바꾸기 · PNG 크기 · 코드 검사 (docs/specs/writing-figure-ai.md)
- writeproof.test.mjs: 맞춤법 · 띄어쓰기 점검(범위 · 조각 · 자리 다시 찾기 · 고치기) · 영문/국문 초록 만들기 (docs/specs/writing-proofread.md)
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
MIN_PASS = {"extlinks": 80, "graph": 15, "refquote": 10, "jobs": 8, "ask": 8, "explain": 12, "sources": 10,
            "trash": 4,  # trash: 6단계 휴지통 · 동기화 웹 문구  # 너무 적게 통과하면(테스트가 사라짐) 실패
            "filetypes": 5,  # filetypes: 서재에 문서 · 이미지 넣기(받는 형식 · 형식 배지)
            "writeedit": 17,  # writeedit: 논문 쓰기 목록 · 표 · 그림 · 캡션 · 단축키 도움말 · 코드 블록 · JPEG 머리글
            "writeai": 30,  # writeai: AI 글쓰기 결과 넣기(원고가 바뀌었으면 묻기) · 글쓰기 도우미 = 작업(2026-10-16) · 결과 패널(2026-10-17)
            "writenotes": 8,  # writenotes: 각주 [^1] · "[^1]: 내용" 읽기 · [각주] 넣기 (export-lists-footnotes.md)
            "writeproof": 16,  # writeproof: 맞춤법 점검 범위 · 조각 · 자리 다시 찾기 · 모두 고치기 · 초록 만들기 (writing-proofread.md)
            "syncmode": 30,  # syncmode: 선택 동기화(폴더 · 파일별 PC에만 두기) 화면 결정 함수 · 문구 (AC-S61)
            "writehist": 7,  # writehist: 원고 버전 기록 — 줄 비교 · 접기 · 목록 문구 · 코드 검사 (manuscript-history.md)
            "writecheck": 17,  # writecheck: 논문 쓰기 제출 전 점검표 규칙 · 분량 추정 · 코드 검사 (2026-10-17)
            "writechat": 22,  # writechat: AI 범위(진짜 문단 · 이 절 · 이 장) · 원고 AI 대화 제안 · 장 · 절 일괄 처리 (manuscript-ai-chat.md)
            "writefig": 9,  # writefig: 그림 만들기 · 고치기 — 범위 · 넣기 · 바꾸기 · PNG 크기 · 코드 검사 (writing-figure-ai.md)
            "writemath": 4,  # writemath: 수식 — 줄 수식 · 문장 안 수식 자리표시 · 내보내기 글자 · 식 참조 (2026-10-17)
            "writemd": 7,
            "writesrc": 7,
            "writepaste": 4,
            "writeterms": 5,
            "writegoals": 3,
            "writejournal": 4,
            "writematch": 4,
            "writeredline": 3}  # writeredline: 수정 표시 워드 (2026-10-27)  # writematch: 서재 대조 — 인용 빠짐 · 표절 미리 점검 (2026-10-27)  # writejournal: 투고 규정 · AI 도구 결과 단추 (2026-10-27)  # writegoals: 분량 · 일정 목표 (2026-10-27)  # writeterms: 용어 통일 (2026-10-27)  # writepaste: 표 붙여넣기 (2026-10-27)  # writesrc: 출처 확인 — 확인할 문장 · 표시 자리 · 판정 글 · 고친 문장 자리 · 근거 번호 · 화면 연결 (2026-10-26)  # writemd: 한글 조사 옆 굵게 · 기울임 · 굵게 감싸기 빈칸 · AI 패널 폭 끌기 (2026-10-26)


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
