"""6단계 폴더 동기화 — DB 없이 도는 규칙 (AC-603 서버 몫 · 635 · 634 판정 · 605 코드 검사 · 693 웹 esc)."""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from paperlab.db import (clean_file_name, copy_name, deleted_by_label, file_name_problem, generated_file_name, kst_day,
                         numbered_name)
from paperlab.sync import _ms_time, winner

PKG = Path(__file__).resolve().parent.parent / "paperlab"


def test_file_name_rules():
    """AC-603(서버 코드): 예약 이름 · 금지 문자 · 확장자 · 길이"""
    for bad in ("CON.pdf", "nul.PDF", "COM¹.pdf", "LPT9.PDF", "a<b.pdf", "a.txt", "x" * 197 + ".pdf", "a\nb.pdf",
                ".pdf", " a.pdf", ".hidden.pdf"):
        assert file_name_problem(bad), bad
    for ok in ("논문.PDF", "Smith 2020 - Attention.pdf", "x" * 196 + ".pdf", "con2.pdf"):
        assert not file_name_problem(ok), ok


def test_generated_and_uploaded_names():
    """8.2절: `{첫 저자 성} {연도} - {제목}.pdf`(120자) · 비면 paper-{id} · 예약 이름 앞에 _ · 올린 이름 정리"""
    assert generated_file_name({"id": 3, "title": "A: B? c.", "authors": [{"family": "Kim"}], "year": 2020}) == \
        "Kim 2020 - A B c.pdf"
    assert generated_file_name({"id": 7, "title": "", "authors": []}) == "paper-7.pdf"
    assert generated_file_name({"id": 7, "title": "con"}) == "_con.pdf"
    long = generated_file_name({"id": 1, "title": "가" * 300, "authors": [{"literal": "W3C"}], "year": 1999})
    assert len(long) <= 120 and long.startswith("W3C 1999 - 가")
    assert clean_file_name(r"C:\x\y\my paper.PDF") == "my paper.pdf"
    assert clean_file_name("../../etc/passwd") == "passwd.pdf"
    assert clean_file_name("aux") == "_aux.pdf" and clean_file_name("") == ""
    assert clean_file_name("e\u0301.pdf") == "\u00e9.pdf"  # NFC


def test_copy_names():
    """AC-635: 사본 이름 — ` 2`, 금지 문자 제거, 200자에서 원래 이름만 줄임, 한국 날짜"""
    assert copy_name("Smith 2020 - Attention.pdf", "집 PC", "2026-10-13") == \
        "Smith 2020 - Attention (충돌 사본 집 PC 2026-10-13).pdf"
    assert copy_name("a.pdf", "A:B*", "2026-10-13", 2) == "a (충돌 사본 AB 2026-10-13 2).pdf"
    big = copy_name("x" * 196 + ".pdf", "PC", "2026-10-13")
    assert len(big) == 200 and big.endswith(" (충돌 사본 PC 2026-10-13).pdf")
    assert copy_name("b (충돌 사본 웹 2026-10-01).pdf", "웹", "2026-10-02") == \
        "b (충돌 사본 웹 2026-10-01) (충돌 사본 웹 2026-10-02).pdf"
    assert kst_day(datetime(2026, 10, 13, 16, 0, tzinfo=timezone.utc)) == "2026-10-14"
    assert numbered_name("a.pdf", 2) == "a (2).pdf" and len(numbered_name("y" * 196 + ".pdf", 12)) == 200
    assert deleted_by_label("web", None) == "웹" and deleted_by_label("device:3", "집 PC") == "집 PC"


def test_later_rule():
    """AC-634: 시계 차이 모름 · 미래 · 2000년 이전 · 2초 이하 → 도착 순서(들어온 쪽)"""
    now = datetime.now(timezone.utc)
    ms = int(now.timestamp() * 1000)
    assert _ms_time(ms, None) is None and _ms_time(None, 0) is None
    assert _ms_time(ms + 6 * 60 * 1000, 0) is None and _ms_time(0, 0) is None
    assert abs(_ms_time(ms - 1000, 1000) - now) < timedelta(seconds=1)
    assert winner(None, now) == "incoming" and winner(now, None) == "incoming"
    assert winner(now, now - timedelta(seconds=2)) == "incoming"
    assert winner(now - timedelta(hours=1), now) == "server"
    assert winner(now, now - timedelta(hours=1)) == "incoming"


def test_trash_setting_only_in_trash_tx():
    """AC-605(코드 검사): paperlab.trash를 켜는 곳은 db.Library.trash_tx 한 곳"""
    hits = [(p.name, i) for p in PKG.rglob("*.py") for i, line in enumerate(p.read_text(encoding="utf-8").splitlines())
            if "paperlab.trash" in line and "set_config" in line]
    assert {name for name, _ in hits} == {"db.py"} and len(hits) == 2, hits


def test_trash_view_escapes_text():
    """AC-693(코드 검사): 휴지통 화면은 제목 · 파일 이름을 esc()로만 넣는다"""
    js = (PKG / "static" / "js" / "trash.js").read_text(encoding="utf-8")
    raw = re.findall(r"\$\{\s*p.(?:title|file_name)\s*(?:\}|\|\|)", js)
    assert raw == [], raw
    assert "esc(p.title" in js and "esc(p.file_name)" in js
    assert "innerHTML = `<div class=\"msg error\">${esc(" in js


def test_cap_settings_from_env():
    """K-30 · K-46: 사용자당 올리기 상한 · DB 한도는 cloud.env(MB)로 바꾸고, 비었거나 틀리면 기본값"""
    from paperlab.config import DB_LIMIT_DEFAULT, SYNC_USER_CAP_DEFAULT, _mb
    assert _mb({"X": "4096"}, "X", 1) == 4096 * 1024 ** 2
    assert _mb({}, "X", SYNC_USER_CAP_DEFAULT) == 2 * 1024 ** 3 and _mb({"X": "abc"}, "X", DB_LIMIT_DEFAULT) == 500 * 1024 ** 2
    assert _mb({"X": "-1"}, "X", 7) == 7
