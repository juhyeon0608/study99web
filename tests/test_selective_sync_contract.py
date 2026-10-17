"""선택 동기화 계약 · 순수 함수 시험 [자동 — DB 없음] (docs/specs/selective-sync.md 14장 S31 · S54 · S57 계약 몫).

- 동기화 확장자 목록 = convert.ACCEPT_EXTS = 마이그레이션 papers_file_name_check = desktop/sync/filekind.js = static/js/filetypes.js
- 로컬 AI 확장자 LOCAL_TEXT_EXTS(서버) = desktop/extract/kinds.js
- JS fence · taggedText 시험 벡터(tests/fixtures/fence_vectors.json)가 지금 Python ai.fence · PaperContext.tagged_text 결과와 같음
- PC 파일 이름 규칙(확장자 일반화) · 실효 모드 상속 · sync 객체 · 로컬 프롬프트 표지
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from paperlab import ai, convert, db, jobs
from paperlab.db import (clean_file_name, copy_name, effective_of, file_name_problem, folder_modes, generated_file_name,
                         numbered_name, split_ext, sync_view)

ROOT = Path(__file__).resolve().parent.parent
VECTORS = ROOT / "tests" / "fixtures" / "fence_vectors.json"


def js_array(path: Path, name: str) -> tuple[str, ...]:
    text = path.read_text(encoding="utf-8")
    m = re.search(rf"\b{name}\s*=\s*(?:Object\.freeze\()?\[([^\]]*)\]", text)
    assert m, f"{path.name}에 {name} 배열이 없어요"
    return tuple(re.findall(r"""['"](\.[a-z0-9]+)['"]""", m.group(1)))


# ====================================================================== 확장자 목록
def test_sync_exts_match_migration():
    sql = (ROOT / "supabase" / "migrations" / "20261017000001_selective_sync.sql").read_text(encoding="utf-8")
    m = re.search(r"file_name ~\* '\\\.\(([a-z|]+)\)\$'", sql)
    assert m, "papers_file_name_check 확장자 목록을 찾지 못함"
    assert tuple("." + e for e in m.group(1).split("|")) == convert.ACCEPT_EXTS


def test_sync_exts_match_web():
    js = ROOT / "paperlab" / "static" / "js" / "filetypes.js"
    assert ("." + "pdf",) + js_array(js, "DOC_EXTS") + js_array(js, "IMAGE_EXTS") == convert.ACCEPT_EXTS


def test_sync_exts_match_desktop():
    path = ROOT / "desktop" / "sync" / "filekind.js"
    if not path.exists():
        pytest.skip("desktop/sync/filekind.js가 아직 없음 (개발자 D)")
    assert js_array(path, "SYNC_EXTS") == convert.ACCEPT_EXTS


def test_local_text_exts_match_desktop():
    assert jobs.LOCAL_TEXT_EXTS == db.LOCAL_TEXT_EXTS == (".pdf", ".docx", ".hwpx", ".pptx", ".xlsx", ".odt", ".odp",
                                                          ".ods", ".hwp", ".doc")
    path = ROOT / "desktop" / "extract" / "kinds.js"
    if not path.exists():
        pytest.skip("desktop/extract/kinds.js가 아직 없음 (개발자 D)")
    assert js_array(path, "LOCAL_TEXT_EXTS") == db.LOCAL_TEXT_EXTS


# ====================================================================== fence 시험 벡터 (AC-S54 서버 몫)
def test_fence_vectors_match_python():
    data = json.loads(VECTORS.read_text(encoding="utf-8"))
    assert data["local_text_marker"] == ai.LOCAL_TEXT_MARKER == "\u2063PAPERLAB_LOCAL_PAPER_TEXT\u2063"
    assert len(data["fence"]) >= 40 and len(data["tagged_text"]) >= 8
    for v in data["fence"]:
        assert ai.fence(v["input"]) == v["output"], v["input"]
    for v in data["tagged_text"]:
        assert ai.PaperContext(title="", pdf_bytes=None, page_texts=v["pages"]).tagged_text() == v["output"], v["pages"]
    # 벡터가 규칙의 경계를 실제로 덮는지: 바뀌는 것 · 안 바뀌는 것 · 한글 경계 · 대소문자
    changed = {v["input"] for v in data["fence"] if v["input"] != v["output"]}
    assert {"</paper>", "<PAPER title=\"x\">", "<page 가>", "<sources?>"} <= changed
    assert not changed & {"<paperx>", "<page가>", "<p>", "‹paper>"}


# ====================================================================== PC 파일 이름 (확장자 일반화 — 4장)
def test_file_name_rules_accept_sync_exts():
    for ok in ("보고서.docx", "발표.PPTX", "한글 문서.hwp", "사진.JPEG", "a.pdf", "표.xlsx", "x.webp"):
        assert not file_name_problem(ok), ok
    for bad in ("setup.exe", "바로가기.lnk", "확장자없음", ".docx", "CON.docx", "a.txt", "x" * 196 + ".docx"):
        assert file_name_problem(bad), bad
    assert split_ext("보고서.v2.DOCX") == ("보고서.v2", ".DOCX") and split_ext("a.txt") == ("a.txt", "")


def test_generalized_name_helpers():
    assert clean_file_name("C:\\x\\보고서 v1.2.DOCX") == "보고서 v1.2.docx"
    assert clean_file_name("보고서.docx", ".pdf") == "보고서.pdf"       # 표현에 맞춰 확장자를 바꿈
    assert clean_file_name("scan", ".png") == "scan.png" and clean_file_name("aux.hwp") == "_aux.hwp"
    assert generated_file_name({"id": 3, "title": "회의록"}, ".hwpx") == "회의록.hwpx"
    assert numbered_name("보고서.DOCX", 2) == "보고서 (2).DOCX"
    assert copy_name("보고서.HWP", "집 PC", "2026-10-17") == "보고서 (충돌 사본 집 PC 2026-10-17).hwp"
    big = copy_name("x" * 195 + ".docx", "PC", "2026-10-17")
    assert len(big) == 200 and big.endswith(" (충돌 사본 PC 2026-10-17).docx")


# ====================================================================== 실효 모드 · sync 객체 (5.2절 · 10.1절)
def test_folder_modes_inherit():
    rows = [{"id": 1, "parent_id": None, "sync_mode": "local"}, {"id": 2, "parent_id": 1, "sync_mode": "inherit"},
            {"id": 3, "parent_id": 2, "sync_mode": "cloud"}, {"id": 4, "parent_id": 3, "sync_mode": "inherit"},
            {"id": 5, "parent_id": None, "sync_mode": "inherit"},
            {"id": 6, "parent_id": 7, "sync_mode": "inherit"}, {"id": 7, "parent_id": 6, "sync_mode": "inherit"}]  # 순환
    assert folder_modes(rows) == {1: "local", 2: "local", 3: "cloud", 4: "cloud", 5: "cloud", 6: "cloud", 7: "cloud"}
    assert effective_of("inherit", None) == "cloud" and effective_of("inherit", "local") == "local"
    assert effective_of("cloud", "local") == "cloud" and effective_of("local", None) == "local"


def test_sync_view_states():
    base = {"sync_mode": "inherit", "folder_mode": None, "storage": "cloud", "mode_pending": "", "mode_error": "",
            "local_device_id": None, "holder": None, "pdf_key": "users/x/papers/1.pdf", "file_name": "a.pdf"}
    v = sync_view(base)
    assert v == {"mode": "inherit", "effective": "cloud", "storage": "cloud", "pending": "", "pending_error": "",
                 "holder": None, "mismatch": False, "has_file": True, "local_ai": None}
    # 끔 폴더에 웹 업로드 → 폴더 설정과 다름
    assert sync_view({**base, "folder_mode": "local"})["mismatch"] is True
    # 끄는 중(대기) — 다름 표시 안 함, 보관 PC
    v = sync_view({**base, "folder_mode": "local", "mode_pending": "to_local", "local_device_id": 7,
                   "holder": {"name": "집 PC", "revoked": False, "online": True}})
    assert not v["mismatch"] and v["holder"] == {"id": 7, "name": "집 PC", "online": True, "gone": False}
    # 로컬 항목 · 보관 PC 해지 · 형식별 local_ai
    loc = {**base, "storage": "local", "pdf_key": "", "local_device_id": 7, "file_name": "발표.ppt",
           "holder": {"name": "집 PC", "revoked": True, "online": False}, "sync_mode": "local"}
    v = sync_view(loc)
    assert v["has_file"] and v["holder"]["gone"] and v["local_ai"] == "unsupported" and not v["mismatch"]
    assert sync_view({**loc, "file_name": "보고서.hwp"})["local_ai"] == "ok"
    assert sync_view({**loc, "local_device_id": None, "holder": None})["holder"] == \
        {"id": None, "name": "", "online": False, "gone": True}
    # 파일 없는 논문: 설정만
    assert sync_view({**base, "pdf_key": "", "folder_mode": "local"})["has_file"] is False


# ====================================================================== 로컬 프롬프트 표지 (7.4절 · AC-S53 서버 몫)
def test_local_prompt_has_marker_once_and_no_text():
    ctx = ai.PaperContext(title="제목\u2063" + ai.LOCAL_TEXT_MARKER, pdf_bytes=None, page_texts=["본문 비밀"],
                          abstract="ABSTRACT-SECRET", local_text=True)
    system, prompt = ai.summary_request(ctx, "한국어")
    assert prompt.count(ai.LOCAL_TEXT_MARKER) == 1 and "본문 비밀" not in prompt and "ABSTRACT-SECRET" not in prompt
    hist = [{"role": "user", "content": "앞 질문 " + ai.LOCAL_TEXT_MARKER}, {"role": "assistant", "content": "답"}]
    system, prompt = ai.chat_request(ctx, hist, "질문 " + ai.LOCAL_TEXT_MARKER, "한국어")
    assert prompt.count(ai.LOCAL_TEXT_MARKER) == 1 and "\u2063" not in prompt.replace(ai.LOCAL_TEXT_MARKER, "")
    assert not ctx.usable_pdf() and ctx.text_pages() == []
    # 켬 항목은 그대로(표지 없음)
    cloud = ai.PaperContext(title="t", pdf_bytes=None, page_texts=["p1"])
    assert ai.LOCAL_TEXT_MARKER not in ai.summary_request(cloud, "한국어")[1]


def test_local_task_and_messages():
    src = {"local": {"paper_id": 5, "sha256": "a" * 64, "file_name": "보고서.HWP", "holder": 7}}
    assert jobs.local_task(src) == {"paper_id": 5, "sha256": "a" * 64, "ext": ".hwp", "kind": "doc"}
    assert jobs.local_task({"local": {**src["local"], "file_name": "x.PDF"}})["kind"] == "pdf"
    assert jobs.local_task({"local": {**src["local"], "file_name": "x.jpg"}})["kind"] == "image"
    assert "사진" in jobs.local_unsupported_message("a.png") and ".ppt" in jobs.local_unsupported_message("a.ppt")
    assert jobs.LOCAL_CODES <= jobs.WORKER_CODES and not jobs.LOCAL_CODES & (jobs.FALLBACK_CODES | jobs.RELOCATE_CODES)
    assert all(jobs.DEFAULT_ERRORS[c] for c in jobs.LOCAL_CODES)


def test_pinned_note_particle():
    """보관 PC 대기 안내의 조사(이/가) — 받침 있는 이름(노트북 · 데스크톱)은 '이' (static/js/ui.js josa와 같은 규칙)"""
    assert jobs.josa("‘노트북’", "이/가") == "‘노트북’이" and jobs.josa("‘집 PC’", "이/가") == "‘집 PC’가"
    assert jobs.josa("‘데스크톱’", "이/가") == "‘데스크톱’이" and jobs.josa("‘연구실 PC 2’", "이/가") == "‘연구실 PC 2’가"
    assert jobs.josa("‘Laptop’", "이/가") == "‘Laptop’이" and jobs.josa("‘MacBook’", "이/가") == "‘MacBook’이"
    assert jobs.josa("‘서울’", "으로/로") == "‘서울’로" and jobs.josa("‘???’", "이/가") == "‘???’이(가)"
    devs = [{"id": 3, "name": "노트북", "online": False, "paused": False}]
    v = jobs._pinned_view({"pinned_device_id": 3, "status": "queued"}, devs)
    assert v["note"] == "‘노트북’이 켜지면 실행돼요" and v["online"] is False
    v = jobs._pinned_view({"pinned_device_id": 3, "status": "queued"}, [{**devs[0], "name": "집 PC"}])
    assert v["note"] == "‘집 PC’가 켜지면 실행돼요"


def test_paper_out_has_holder_name():
    """C-1 추가: 스냅숏 · 피드 논문 항목에 holder_name(D-4 확인 창 · 알림의 ‘연구실 PC’)"""
    from paperlab.sync import paper_out
    r = {"id": 1, "folder_id": None, "file_name": "a.pdf", "rep_sha": "a" * 64, "rep_size": 3, "rep_kind": "local",
         "storage": "local", "local_device_id": 7, "holder_gone": False, "mode_pending": "", "holder_name": "연구실 PC"}
    assert paper_out(r)["holder_name"] == "연구실 PC"
    assert paper_out({**r, "holder_name": None, "local_device_id": None})["holder_name"] == ""
