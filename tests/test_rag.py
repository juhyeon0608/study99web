"""3단계 RAG · 인용 검증 · AI로 찾기 — DB 없이 (docs/specs/phase3-rag-verify-search.md 16 · 17장).

조각 · 파일 형식 · 캐시 · 키 · 낱말 · RRF · [n] · 직접 인용 · 요약 검사 · 검색(가짜 전송) · 로그.
가짜 임베딩 HashEmbedder, 가짜 저장소 FakeStorage, 가짜 검색 Sources(MockTransport) — 실제 API · R2 · CLI는 부르지 않는다.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import shutil
import subprocess
from pathlib import Path

import httpx
import numpy as np
import pytest

from paperlab import ai, find, jobs, rag, verify
from paperlab.sources import Sources
from paperlab.storage import FakeStorage, StorageKeyError, UserStorage, check_user_key, rag_key

from .conftest import make_pdf

ROOT = Path(__file__).resolve().parent.parent
UA = "11111111-2222-3333-4444-555555555555"
UB = "99999999-8888-7777-6666-555555555555"
SHA = "a" * 64


# ====================================================================== 키 (AC-S01 · S02)
def test_rag_key_shape_and_checks():
    k = rag_key(UA, 12, rag.RAG_VERSION)
    assert re.fullmatch(rf"users/{UA}/rag/12\.v{rag.RAG_VERSION}\.[0-9a-f]{{8}}\.bin", k)
    assert rag_key(UA, 12, rag.RAG_VERSION) != k  # 세대 토큰이 매번 새로
    assert check_user_key(UA, k) == k
    gen = k.split(".")[-2]
    bad = [k.replace(UA, UB), k + "\n", f"users/{UA}/rag/../papers/12.pdf", k[:-4] + ".pdf",
           k.replace(gen, gen.upper() if gen.upper() != gen else "ABCDEF12"), f"users/{UA}/rag/0.v{rag.RAG_VERSION}.{gen}.bin",
           f"users/{UA}/rag/12.vEG512.{gen}.bin", f"users/{UA}/rag/12.v{rag.RAG_VERSION}.{gen}.bin.bak"]
    for key in bad:
        with pytest.raises(StorageKeyError):
            check_user_key(UA, key)
    for args in ((UA, 0, "x"), (UA, True, "x"), (UA, 1, "BAD"), ("nope", 1, "x")):
        with pytest.raises(StorageKeyError):
            rag_key(*args)


def test_other_users_rag_key_never_reaches_storage():
    """AC-S02: B의 사용자 범위 저장소로 A의 rag/ 키를 읽으면 StorageKeyError이고 저장소 호출이 없다. 서명 주소도 없음"""
    st = FakeStorage()
    key_a = rag_key(UA, 5, rag.RAG_VERSION)
    st.objects[key_a] = b"x"
    ub = UserStorage(st, UB)
    with pytest.raises(StorageKeyError):
        ub.get(key_a)
    cache = rag.VectorCache()
    with pytest.raises(StorageKeyError):
        cache.load(UB, [{"id": 5, "rag_key": key_a, "rag_version": rag.RAG_VERSION, "pdf_sha256": SHA}], ub)
    ua = UserStorage(st, UA)
    with pytest.raises(StorageKeyError):
        ua.sign_get(key_a)
    with pytest.raises(StorageKeyError):
        ua.create_upload(key_a)
    with pytest.raises(StorageKeyError):  # 캐시 키(uid)와 저장소 사용자가 다르면 거부
        cache.load(UA, [], ub)
    assert st.log == []


def test_no_signed_url_or_new_system_tx_in_phase3_code():
    """AC-S02 · AC-D04 코드 검색: 3단계 새 모듈에 서명 주소 · system_tx 사용처가 없다(복구 스캔은 2단계 그대로 한 곳)"""
    for name in ("rag.py", "verify.py", "find.py"):
        src = (ROOT / "paperlab" / name).read_text(encoding="utf-8")
        assert "sign_get" not in src and "create_upload" not in src and "system_tx" not in src, name
    runner = (ROOT / "paperlab" / "api_runner.py").read_text(encoding="utf-8")
    assert runner.count("self.db.system_tx(") == 1


# ====================================================================== 조각 · 파일 (AC-I02 · S05 · S08)
def _layout_for(texts):
    data = make_pdf(title="Chunk Test", body="x", pages=1)
    import pymupdf
    doc = pymupdf.open()
    for t in texts:
        page = doc.new_page()
        y = 72
        for para in t.split("\n\n"):
            page.insert_textbox(pymupdf.Rect(72, y, 540, y + 200), para, fontsize=9)
            y += 210
    data = doc.tobytes()
    doc.close()
    from paperlab import pdf
    return data, pdf.extract(data).page_texts, pdf.text_blocks(data)


def test_chunks_cover_each_page_exactly():
    para = "Residual learning eases optimization of deep networks. " * 12
    _, texts, layout = _layout_for(["\n\n".join([para] * 3), "Short page.", ""])
    chunks = rag.make_chunks(texts, layout)
    assert chunks and {c["page"] for c in chunks} <= {1, 2}
    for pno, t in enumerate(texts, 1):
        mine = [c for c in chunks if c["page"] == pno]
        if not t.strip():
            assert not mine
            continue
        assert mine[0]["start"] == 0 and mine[-1]["end"] == len(t)
        for a, b in zip(mine, mine[1:]):
            assert a["end"] == b["start"]  # 빈틈 · 겹침 없음
        for c in mine:
            assert t[c["start"]:c["end"]]
            assert c["rect"] is None or all(0 <= v <= 1 for v in c["rect"])
    assert any(c["rect"] for c in chunks)  # 블록을 맞춘 쪽은 좌표가 있음
    # 블록 없이(레이아웃 없음) · 아주 긴 쪽: 글자 수로 자르고 rect 없음, 2,400자 넘는 조각 없음
    long = ("word " * 3000).strip()
    plain = rag.make_chunks([long])
    assert all(c["rect"] is None for c in plain)
    assert plain[0]["start"] == 0 and plain[-1]["end"] == len(long)
    assert all(c["end"] - c["start"] <= rag.CHUNK_MAX for c in plain)
    assert all(a["end"] == b["start"] for a, b in zip(plain, plain[1:]))


def test_file_roundtrip_and_checks():
    chunks = [{"page": 1, "start": 0, "end": 10, "rect": (0.1, 0.2, 0.5, 0.6)}, {"page": 2, "start": 0, "end": 5, "rect": None}]
    vecs = rag.HashEmbedder().embed(["alpha beta", "gamma"])
    blob = rag.pack(7, SHA, rag.RAG_VERSION, chunks, vecs)
    assert len(blob) == 128 + 20 * 2 + 2 * 2 * 512
    meta, mat = rag.unpack(blob, 7, SHA, rag.RAG_VERSION)
    assert mat.dtype == np.float32 and mat.shape == (2, 512) and np.allclose(mat, vecs, atol=1e-3)
    assert list(meta["page"]) == [1, 2] and list(meta["end"]) == [10, 5]
    assert rag.rect_of(meta[0]) == pytest.approx([0.1, 0.2, 0.5, 0.6], abs=1e-3) and rag.rect_of(meta[1]) is None
    for args in ((8, SHA, rag.RAG_VERSION), (7, "b" * 64, rag.RAG_VERSION), (7, SHA, rag.NO_MODEL_VERSION)):
        with pytest.raises(rag.RagFileError):
            rag.unpack(blob, *args)
    for broken in (blob[:-1], blob + b"\0", b"XXXXXXXX" + blob[8:], blob[:50]):
        with pytest.raises(rag.RagFileError):
            rag.unpack(broken, 7, SHA, rag.RAG_VERSION)
    # 모델 없이 색인한 파일(dim 0) · 조각 수 상한
    blob0 = rag.pack(7, SHA, rag.NO_MODEL_VERSION, chunks, None)
    assert rag.unpack(blob0, 7, SHA, rag.NO_MODEL_VERSION)[1].shape == (2, 0)
    many = rag.HEADER.pack(rag.MAGIC, 7, rag.MAX_CHUNKS + 1, 0, 0, SHA.encode(), rag.RAG_VERSION.encode(), b"")
    with pytest.raises(rag.RagFileError):
        rag.unpack(many + b"\0" * 20 * (rag.MAX_CHUNKS + 1), 7, SHA, rag.RAG_VERSION)


def _put_file(st, uid, pid, n=3, version=rag.RAG_VERSION):
    chunks = [{"page": 1, "start": i * 10, "end": i * 10 + 10, "rect": None} for i in range(n)]
    vecs = rag.HashEmbedder().embed([f"text {pid} {i}" for i in range(n)]) if version == rag.RAG_VERSION else None
    key = rag_key(uid, pid, version)
    st.objects[key] = rag.pack(pid, SHA, version, chunks, vecs)
    return {"id": pid, "rag_key": key, "rag_version": version, "pdf_sha256": SHA}


class Clock:
    t = 1000.0

    def __call__(self):
        return self.t


def test_cache_lru_idle_reload_and_bad_files():
    """AC-S08 · S05: 상한을 작게 주면 가장 오래 안 쓴 사용자가 내려가고, 유휴 사용자도 내려가며, 다시 질문하면 다시 로드된다"""
    st, clock = FakeStorage(), Clock()
    rows_a = [_put_file(st, UA, 1, n=50)]
    rows_b = [_put_file(st, UB, 2, n=50)]
    one_user = 50 * (512 * 4 + 20)
    cache = rag.VectorCache(max_bytes=int(one_user * 1.5), idle_s=600, clock=clock)
    got, bad = cache.load(UA, rows_a, UserStorage(st, UA))
    assert list(got) == [1] and not bad and cache.users() == [UA]
    clock.t += 1
    cache.load(UB, rows_b, UserStorage(st, UB))
    assert cache.users() == [UB]  # A(오래 안 씀)가 내려감, 요청 중인 B는 남음
    st.log.clear()
    clock.t += 1
    got, _ = cache.load(UA, rows_a, UserStorage(st, UA))  # 다시 로드
    assert list(got) == [1] and ("get", rows_a[0]["rag_key"]) in st.log
    assert cache.users() == [UA]
    st.log.clear()
    cache.load(UA, rows_a, UserStorage(st, UA))
    assert st.log == []  # 이미 올라와 있으면 R2를 다시 읽지 않음
    # 유휴: 30분(여기선 600초)을 넘긴 사용자는 다음 접근 때 내려감
    big = rag.VectorCache(idle_s=600, clock=clock)
    big.load(UA, rows_a, UserStorage(st, UA))
    clock.t += 700
    big.load(UB, rows_b, UserStorage(st, UB))
    assert big.users() == [UB]
    # 목록에 없는 캐시 항목은 쓰지 않음 · 키가 바뀌면 다시 읽음 · 검사 실패는 bad로
    assert big.load(UB, [], UserStorage(st, UB))[0] == {}
    row = dict(rows_b[0], pdf_sha256="c" * 64)
    row["rag_key"] = rag_key(UB, 2, rag.RAG_VERSION)
    st.objects[row["rag_key"]] = st.objects[rows_b[0]["rag_key"]]
    got, bad = big.load(UB, [row], UserStorage(st, UB))
    assert got == {} and bad == [row]
    missing = dict(rows_b[0], rag_key=rag_key(UB, 2, rag.RAG_VERSION))
    assert big.load(UB, [missing], UserStorage(st, UB))[1] == [missing]


def test_bad_file_not_reread_and_meta_ranges():
    """품질팀 L1 · L2: 검사에 실패한 키는 다시 읽지 않고(loaded로 봄), 메타 범위(쪽 ≥ 1 · 시작 ≤ 끝 · rect 0~1 · NaN 섞임)가 틀리면 거부"""
    st = FakeStorage()
    row = _put_file(st, UA, 1)
    bad_row = dict(row, pdf_sha256="c" * 64)
    cache = rag.VectorCache()
    assert cache.load(UA, [bad_row], UserStorage(st, UA))[1] == [bad_row]
    st.log.clear()
    assert cache.load(UA, [bad_row], UserStorage(st, UA))[1] == [bad_row]
    assert st.log == [] and cache.loaded(UA, [bad_row])
    good = {"page": 1, "start": 0, "end": 5, "rect": (0.1, 0.1, 0.5, 0.5)}
    for broken in ({"page": 0}, {"start": 9, "end": 5}, {"rect": (0.1, 0.1, 1.5, 0.5)}, {"rect": (-0.1, 0.1, 0.5, 0.5)},
                   {"rect": (math.nan, 0.1, 0.5, 0.5)}):
        blob = rag.pack(7, SHA, rag.RAG_VERSION, [dict(good, **broken)], rag.HashEmbedder().embed(["a"]))
        with pytest.raises(rag.RagFileError):
            rag.unpack(blob, 7, SHA, rag.RAG_VERSION)
    vec = rag.HashEmbedder().embed(["a"])
    vec[0, 0] = np.inf
    with pytest.raises(rag.RagFileError):
        rag.unpack(rag.pack(7, SHA, rag.RAG_VERSION, [good], vec), 7, SHA, rag.RAG_VERSION)


def test_cache_wait_limit():
    st = FakeStorage()
    rows = [_put_file(st, UA, 1)]
    cache = rag.VectorCache()
    u = cache._user(UA)
    u.lock.acquire()
    try:
        with pytest.raises(rag.RagBusy):
            cache.load(UA, rows, UserStorage(st, UA), wait_s=0.05)
    finally:
        u.lock.release()


# ====================================================================== 검색 조각 (AC-Q03 · Q04)
def test_query_terms_and_rrf():
    assert rag.query_terms("트랜스포머의 주의 메커니즘은 무엇인가?") == ["트랜스포머", "주의", "메커니즘", "무엇인"]  # 끝 조사 한 번(가)
    assert rag.query_terms("학교에서 a 가 the attention") == ["학교", "the", "attention"]
    assert len(rag.query_terms(" ".join(f"word{i}" for i in range(20)))) == 8
    assert rag.pgroonga_query(['a"b', "c\\d"]) == '"a\\"b" OR "c\\\\d"'
    vec = [(1, 0), (1, 1), (1, 2), (1, 3), (2, 0)]
    fts = [(3, 0), (1, 0), (2, 0)]
    picked = [x for x, _ in rag.rrf_pick([vec, fts], k=8)]
    assert picked[0] == (1, 0)  # 두 목록 모두에 있는 조각이 맨 위
    assert (3, 0) in picked and (2, 0) in picked  # 낱말만 · 벡터만 맞은 조각도 상위에
    assert sum(1 for p in picked if p[0] == 1) == 3  # 한 논문 최대 3조각


def test_cite_sources_numbers():
    sources = [{"n": i, "paper_id": 10 + i, "page": i, "char_start": 0, "char_end": 5, "rect": None, "title": f"T{i}",
                "year": 2020, "text": "x" * 400} for i in (1, 2, 3)]
    text, cites = rag.cite_sources("가는 그렇다 [1]. 나는 [9] 아니다 [2, 3][12]. 다 [3].", sources)
    assert text == "가는 그렇다 [1]. 나는  아니다 [2][3]. 다 [3]."
    assert [c["n"] for c in cites] == [1, 2, 3] and cites[0]["paper_id"] == 11 and len(cites[0]["text"]) == 300
    assert rag.cite_sources("번호 없음 [7]", sources) == ("번호 없음", [])
    evs = list(rag.with_citations(iter([{"type": "delta", "text": "a"}, {"type": "done", "text": "b [2]"}]), sources))
    assert evs[0] == {"type": "delta", "text": "a"} and evs[1]["citations"][0]["n"] == 2


def test_scope_parse():
    assert rag.parse_scope("library") == ("library", None)
    assert rag.parse_scope("c12") == ("collection", 12) and rag.parse_scope("f3") == ("folder", 3)
    for bad in ("", "c0", "c-1", "x12", "library\n", "c12;drop", "c" + "9" * 16):
        with pytest.raises(ValueError):
            rag.parse_scope(bad)


# ====================================================================== 인용 검증 (AC-V01 · V02)
def test_claims_split_and_markers():
    text = ("# 제목\n"
            "학업 스트레스는 수면을 줄인다 [@lee2022, p. 3]. 다음 문장이다. [@kim2019]\n"
            "그는 “stress was measured by the PSS” [@lee2022, p. 4]라고 썼다.\n"
            "> 인용 블록 글이다 [@a; @b]\n"
            "이스케이프 \\[@x] 아님 [@a, pp. 12-14; @b]")
    cl = verify.claims(text)
    assert [(c["marker_index"], c["key"], c["page"]) for c in cl] == [
        (0, "lee2022", 3), (1, "kim2019", None), (2, "lee2022", 4), (3, "a", None), (3, "b", None), (4, "a", 12), (4, "b", None)]
    assert text[cl[0]["start"]:cl[0]["end"]] == "학업 스트레스는 수면을 줄인다 [@lee2022, p. 3]."
    assert text[cl[1]["start"]:cl[1]["end"]] == "다음 문장이다. [@kim2019]"  # 인용만 남은 조각은 앞 문장에
    assert cl[0]["sentence"] == "학업 스트레스는 수면을 줄인다 ." and not cl[0]["quote"]
    assert cl[2]["quote"] == "stress was measured by the PSS"
    assert cl[3]["quote"] == "인용 블록 글이다" and cl[3]["hash"] != cl[4]["hash"]
    assert verify.claims(text)[0]["hash"] == cl[0]["hash"]  # 해시는 같은 문장이면 같음
    assert verify.claims(text.replace("줄인다", "늘린다"))[0]["hash"] != cl[0]["hash"]


def test_quote_matching_rules():
    pages = ["Intro page.", "In this study, stress was measured by the Perceived Stress Scale (PSS) in all students."]
    q = "stress was measured by the Perceived Stress Scale"
    assert verify.check_quote(q, pages, 2) == ("supported", "", 2)
    assert verify.check_quote("“" + q + "”", pages, None)[0] == "supported"
    assert verify.check_quote(q, pages, 1) == ("weak", "원문은 p.2에 있어요", 2)
    assert verify.check_quote("stress was measurd by the Percieved Stress Scale", pages, 2)[0] == "supported"  # 0.85 이상
    v, reason, _ = verify.check_quote("stress levels were assessed with a perceived scale", pages, 2)
    assert v in ("weak", "unsupported")
    assert verify.check_quote("completely unrelated sentence about rockets", pages, 2)[0] == "unsupported"
    assert verify.check_quote("hyphen-\nated word", ["a hyphenated word here"], 1)[0] == "supported"


def test_quote_time_limit_and_near_pages():
    """품질팀 M3: 590자 인용 × 300쪽 — 쪽이 있으면 ±2쪽만, 없으면 전체를 보되 0.5초 안에 끝(넘으면 확인 못 함)"""
    import random
    import time
    rnd = random.Random(3)
    words = ["stress", "sleep", "student", "measure", "scale", "quality", "cohort", "result", "model", "data"]
    pages = [" ".join(rnd.choice(words) for _ in range(700)) for _ in range(300)]
    quote = " ".join(rnd.choice(words) for _ in range(85))[:590]
    for page in (150, None):
        t = time.monotonic()
        v, reason, _ = verify.check_quote(quote, pages, page)
        assert time.monotonic() - t < 0.9, page
        assert v in ("unchecked", "weak", "unsupported", "supported")
    v, reason, _ = verify.check_quote(quote, pages, None, budget_s=0.05)
    assert (v, reason) == ("unchecked", "원문이 길어 직접 인용을 대조하지 못했어요")
    # 그대로 있는 글은 쪽이 멀어도 바로 찾음(빠른 검사) — 적힌 쪽과 다르면 약함
    pages[280] = pages[280] + " the exact quoted sentence appears here"
    assert verify.check_quote("the exact quoted sentence appears here", pages, 3) == ("weak", "원문은 p.281에 있어요", 281)


def test_view_offsets_are_utf16():
    """품질팀 L8: 화면 textarea 위치(UTF-16) — 이모지(BMP 밖) 뒤 문장도 맞게"""
    content = "😀 앞 문장 [@a].\n두 번째 주장이다 [@b]."
    cl = verify.claims(content)

    class Lib:
        uid = UA

        def _all(self, sql, params=None):
            if "manuscript_citations" in sql:
                return [{"claim_hash": c["hash"], "paper_id": None, "verdict": "unchecked", "method": "none", "reason": "",
                         "evidence": []} for c in cl]
            return []
    items = verify.view(Lib(), 1, content)["items"]
    js_text = content.encode("utf-16-le")
    for it, c in zip(items, cl):
        assert js_text[it["start"] * 2:it["end"] * 2].decode("utf-16-le") == content[c["start"]:c["end"]]
    assert items[0]["start"] == 0 and items[1]["start"] == cl[1]["start"] + 1


def test_markdown_blocks_remote_media_and_csp(local_client):
    """품질팀 M1: AI 답 · 마크다운은 그림 · 미디어 · style을 막고(DOMPurify), 응답에 img-src CSP"""
    ui = (ROOT / "paperlab" / "static" / "js" / "ui.js").read_text(encoding="utf-8")
    assert re.search(r'FORBID_TAGS: \["img"', ui) and "sanitize(html, MD_PURIFY)" in ui
    writing = (ROOT / "paperlab" / "static" / "js" / "writing.js").read_text(encoding="utf-8")
    assert "sanitize(window.marked.parse(result), MD_PURIFY)" in writing
    for path in ("/api/health", "/"):
        csp = local_client.get(path).headers["content-security-policy"]
        assert csp == "img-src 'self' data: blob: https://*.googleusercontent.com; form-action 'self'"
    for tag in ("form", "input", "button", "textarea", "select", "style"):  # 품질팀 N4 · 승인자 N6(@import 유출)
        assert f'"{tag}"' in ui.split("FORBID_TAGS")[1].split("]")[0]
    assert '"background"' in ui.split("FORBID_ATTR")[1].split("]")[0]


def test_unhandled_error_keeps_security_headers(local_client):
    """품질팀 N5: 처리되지 않은 예외로 나가는 500에도 보안 헤더(CSP · X-Frame-Options · nosniff), 내용은 숨김"""
    def boom():
        raise RuntimeError("SECRET detail")
    local_client.app.add_api_route("/api/test-boom", boom)
    r = local_client.get("/api/test-boom")
    assert r.status_code == 500 and "SECRET" not in r.text and r.json()["code"] == "server_error"
    assert r.headers["x-frame-options"] == "DENY" and r.headers["x-content-type-options"] == "nosniff"
    assert "img-src" in r.headers["content-security-policy"]


def test_verify_parse_and_schema():
    res = verify.parse_results('```json\n{"results":[{"id":1,"verdict":"weak","evidence":2,"reason":"r"}]}\n```')
    assert res == [{"id": 1, "verdict": "weak", "evidence": 2, "reason": "r"}]
    with pytest.raises(ai.AIError):
        verify.parse_results('{"nope": 1}')
    assert set(verify.VERIFY_SCHEMA["properties"]["results"]["items"]["required"]) == {"id", "verdict", "evidence", "reason"}


# ====================================================================== AI로 찾기 (AC-F01~F06)
def _oa_work(i, q, doi=""):
    return {"id": f"https://openalex.org/W{100 + i}", "display_name": f"{q} openalex paper number {i}",
            "doi": f"https://doi.org/{doi}" if doi else None, "publication_year": 2020 + i % 3,
            "abstract_inverted_index": {w: [k] for k, w in enumerate(f"{q} abstract text {i}".split())},
            "authorships": [{"author": {"display_name": "Kim Lee"}}], "cited_by_count": i}


def _transport(calls, s2_status=200, oa_status=200):
    def handler(request: httpx.Request):
        q = request.url.params.get("search") or request.url.params.get("query")
        calls.append((request.url.host, q))
        if request.url.host == "api.openalex.org":
            if oa_status != 200:
                return httpx.Response(oa_status)
            results = [_oa_work(i, q, doi="10.1/shared" if i == 0 else "") for i in range(3)]
            return httpx.Response(200, json={"results": results, "meta": {"count": 3}})
        if s2_status != 200:
            return httpx.Response(s2_status)
        data = [{"paperId": "s2a", "title": "Shared title from S2", "externalIds": {"DOI": "10.1/SHARED"},
                 "abstract": "s2 abstract", "venue": "S2 Venue", "year": 2019},
                {"paperId": f"s2-{q}", "title": f"{q} semantic scholar only paper", "abstract": f"{q} s2 only",
                 "year": 2018}]
        return httpx.Response(200, json={"data": data, "total": 2})
    return httpx.MockTransport(handler)


def test_find_queries_parse():
    assert find.parse_queries('{"queries": ["academic stress sleep", "대학생 학업 스트레스 수면", "stress"]}', None, "q") == \
        ["academic stress sleep", "대학생 학업 스트레스 수면", "stress"]
    assert find.parse_queries("", {"queries": ["sleep quality students"]}, "대학생 수면") == ["sleep quality students", "대학생 수면"]
    assert len(find.parse_queries('{"queries": ["ab cd", "ef gh", "ij kl", "mn op", "qr st"]}', None, "q")) == 4
    with pytest.raises(ai.AIError):  # 영어 검색어 없음 → bad_output
        find.parse_queries('{"queries": ["학업 스트레스", "수면의 질"]}', None, "질문")
    with pytest.raises(ai.AIError):
        find.parse_queries("검색어 없음", None, "q")
    assert all(len(q) <= 200 for q in find.parse_queries('{"queries": ["' + "x " * 300 + '", "ab"]}', None, "q"))


def test_find_search_merge_pick():
    """AC-F01 · F02 · F03: 검색어 3개 → OpenAlex 3번 · S2 3번, 같은 DOI · 제목은 하나로(OpenAlex 정보), 가짜 임베딩 상위"""
    calls = []
    src = Sources(lambda k: "", transport=_transport(calls))
    queries = ["sleep quality", "academic stress", "student burnout"]
    items, ranks, warnings = find.search_all(src, queries)
    assert sorted(h for h, _ in calls) == ["api.openalex.org"] * 3 + ["api.semanticscholar.org"] * 3
    assert warnings == []
    shared = [it for it in items if (it.get("doi") or "").lower() == "10.1/shared"]
    assert len(shared) == 1 and shared[0]["source"] == "openalex" and "openalex paper number 0" in shared[0]["title"]
    assert shared[0]["venue"] == "S2 Venue"  # 빈 칸만 S2로 채움
    picked = find.pick("student burnout", items, ranks, rag.HashEmbedder(), k=3)
    assert any("student burnout" in p["title"] for p in picked[:2])
    rrf = find.pick("student burnout", items, ranks, None, k=8)
    assert len(rrf) == 8 and len({p["key"] for p in rrf}) == 8
    cards, warnings, counts = find.prepare(src, rag.HashEmbedder(), "student burnout", queries)
    assert [c["n"] for c in cards] == list(range(1, 9)) and counts["picked"] == 8 and "key" not in cards[0]
    assert len(json.dumps({"candidates": cards}, ensure_ascii=False).encode()) < jobs.PARAMS_MAX


def test_find_source_failures():
    """AC-F06: S2 429 → OpenAlex만 + s2_failed, 둘 다 실패 → FindError(폴백 아님)"""
    calls = []
    src = Sources(lambda k: "", transport=_transport(calls, s2_status=429))
    items, _, warnings = find.search_all(src, ["a b", "c d"])
    assert items and warnings == ["s2_failed"]
    assert sum(1 for h, _ in calls if h == "api.semanticscholar.org") == 2  # 429는 다시 하지 않음
    calls.clear()
    src = Sources(lambda k: "", transport=_transport(calls, s2_status=503))
    find.search_all(src, ["a b"])
    assert sum(1 for h, _ in calls if h == "api.semanticscholar.org") == 2  # 5xx는 한 번 다시
    src = Sources(lambda k: "", transport=_transport([], s2_status=500, oa_status=500))
    with pytest.raises(find.FindError):
        find.search_all(src, ["a b"])


def test_find_answer_checks():
    """AC-F04 · F05: 모든 문장에 유효한 [n], 절반 넘게 빠지면 bad_output, 한글 30% 미만 bad_output, 요약 프롬프트는 늘 한국어"""
    ok = find.check_answer("대학생의 스트레스는 수면을 줄였다 [1]. 다른 연구는 차이가 없었다 [2][9].\n\n- 측정은 설문이었다. [3]", 3)
    assert ok == "대학생의 스트레스는 수면을 줄였다 [1]. 다른 연구는 차이가 없었다 [2].\n\n- 측정은 설문이었다. [3]"
    assert find.check_answer("첫 문장이다 [1]. 둘째 문장이다 [2]. 출처 없는 문장.", 2) == "첫 문장이다 [1]. 둘째 문장이다 [2]."
    for bad in ("출처 없는 문장. 또 없음. 하나만 있음 [1].", "번호 없음.", "Stress reduced sleep [1]. Another finding [2].",
                "결과는 [7] 이다."):
        with pytest.raises(ai.AIError) as e:
            find.check_answer(bad, 2)
        assert e.value.code == "bad_output"
    system, prompt = find.summary_request("q", [{"n": 1, "title": "T", "authors": [{"family": "Kim"}], "abstract": "A"}])
    assert "한국어" in system and "한국어" in prompt and '<source n="1">' in prompt


def test_find_logs_hold_no_content(caplog):
    """AC-L01: 찾기 · 검색 · 로드 로그에 질문 · 검색어 · 제목 · DOI가 없다"""
    caplog.set_level(logging.INFO)
    src = Sources(lambda k: "", transport=_transport([]))
    find.prepare(src, rag.HashEmbedder(), "SECRETQUESTION 수면", ["planted query xyz", "다른 검색어"])
    st = FakeStorage()
    rows = [_put_file(st, UA, 1)]
    rag.VectorCache().load(UA, rows, UserStorage(st, UA))
    # 운영 서버는 httpx · httpcore 로그를 끈다(serve.QUIET_LOGGERS) — 앱 로그만 본다
    text = "\n".join(r.getMessage() for r in caplog.records if r.name.startswith("paperlab"))
    assert '"event": "find"' in text and '"event": "rag_load"' in text
    for planted in ("SECRETQUESTION", "planted", "openalex paper", "10.1/shared", "/rag/", UA):
        assert planted not in text


# ====================================================================== 작업 · 워커 (AC-F09)
def test_cli_contract_for_new_kinds():
    """find ①은 json(스키마), ②는 text, verify는 json(스키마). 결과 해석은 종류별"""
    job = {"kind": "find", "params": {"question": "q"}}
    assert jobs.parse_result(job, '{"queries": ["sleep stress", "수면"]}')["queries"][0] == "sleep stress"
    job2 = {"kind": "find", "params": {"question": "q", "queries": ["a b"], "candidates": [{"n": 1}, {"n": 2}]}}
    assert jobs.parse_result(job2, "요약이다 [1].")["answer"] == "요약이다 [1]."
    job3 = {"kind": "verify", "params": {}}
    assert jobs.parse_result(job3, "", {"results": [{"id": 1, "verdict": "supported", "evidence": 1, "reason": "r"}]})
    assert jobs.clean_progress({"message": "m", "step": "search", "counts": {"queries": 3, "x": 1, "picked": True}}) == \
        {"message": "m", "step": "search", "counts": {"queries": 3}}
    assert jobs.clean_progress({"step": "evil"}) == {"message": ""}


def test_worker_runs_find_and_verify_json_tasks_unchanged(tmp_path):
    """AC-F09: 2b 워커 CLI 실행기(desktop/worker — 수정 없음)가 find · verify의 output json · json_schema 작업을 처리한다(가짜 CLI)"""
    node = shutil.which("node")
    if not node:
        pytest.skip("node가 없어 건너뜀")
    script = tmp_path / "run.js"
    tasks = [
        {"kind": "find", "schema": find.QUERY_SCHEMA, "text": {"queries": ["sleep stress", "수면"]}},
        {"kind": "verify", "schema": verify.VERIFY_SCHEMA,
         "text": {"results": [{"id": 1, "verdict": "weak", "evidence": None, "reason": "일부만"}]}},
    ]
    desktop = (ROOT / "desktop").as_posix()
    script.write_text(f"""
const path = require('node:path'); const fs = require('node:fs');
const {{ tempHome, makeShim }} = require({json.dumps(desktop + '/test/helpers')});
const {{ resolveEngine }} = require({json.dumps(desktop + '/worker/resolve-exe')});
const {{ runTask }} = require({json.dumps(desktop + '/worker/cli-runner')});
(async () => {{
  const home = tempHome('pl-p3-'); const bin = path.join(home, 'npm'); fs.mkdirSync(bin, {{ recursive: true }});
  const shim = makeShim(bin, 'claude');
  const tasks = {json.dumps(tasks, ensure_ascii=False)};
  const out = [];
  for (const [i, t] of tasks.entries()) {{
    const env = {{ ...process.env, PATH: `${{path.dirname(process.execPath)}}${{path.delimiter}}${{process.env.PATH}}`, USERPROFILE: home,
                  FAKE_TEXT: JSON.stringify(t.text) }};
    const task = {{ id: 500 + i, engine: 'claude', kind: t.kind, model: null, output: 'json', json_schema: t.schema, stream_partial: false,
                   system: 's', prompt: 'p', timeout_s: 60, lease_token: 'x' }};
    const res = await runTask(task, {{ resolved: resolveEngine('claude', {{ customPath: shim, env }}), workRoot: path.join(home, 'work'), env }});
    out.push({{ outcome: res.outcome, text: res.text, structured: res.structured }});
  }}
  process.stdout.write(JSON.stringify(out));
}})();
""", encoding="utf-8")
    proc = subprocess.run([node, str(script)], capture_output=True, encoding="utf-8", timeout=120)
    assert proc.returncode == 0, proc.stderr
    results = json.loads(proc.stdout)
    assert [r["outcome"] for r in results] == ["succeeded", "succeeded"], results
    parsed = jobs.parse_result({"kind": "find", "params": {"question": "q"}}, results[0]["text"], results[0]["structured"])
    assert parsed["queries"] == ["sleep stress", "수면"]
    parsed = jobs.parse_result({"kind": "verify", "params": {}}, results[1]["text"], results[1]["structured"])
    assert parsed["results"][0]["verdict"] == "weak"


# ====================================================================== 모델 (받기 · 실제 모델 — 있을 때만)
def test_download_model_checks_sha(tmp_path, monkeypatch):
    blobs = {name: f"content of {name}".encode() for name in rag.MODEL_FILES}
    monkeypatch.setattr(rag, "MODEL_FILES", {n: (hashlib.sha256(b).hexdigest(), len(b)) for n, b in blobs.items()})
    seen = []

    def handler(request):
        seen.append(str(request.url))
        name = str(request.url.path).split(f"/resolve/{rag.MODEL_REVISION}/", 1)[1]
        return httpx.Response(200, content=blobs[name])
    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert sorted(rag.download_model(tmp_path, client)) == sorted(blobs)
    assert all(u.startswith(f"https://huggingface.co/{rag.MODEL_REPO}/resolve/{rag.MODEL_REVISION}/") for u in seen)
    assert rag.model_problems(tmp_path, check_hash=True) == []
    assert rag.download_model(tmp_path, client) == []  # 이미 맞으면 다시 받지 않음
    (tmp_path / "tokenizer.json").write_bytes(b"tampered")
    assert rag.model_problems(tmp_path, check_hash=True) == ["tokenizer.json"]
    blobs["tokenizer.json"] = b"evil"
    with pytest.raises(RuntimeError):
        rag.download_model(tmp_path, client)
    assert not (tmp_path / "tokenizer.json.part").exists()
    assert rag.load_embedder(tmp_path / "nothing") is None
    # 품질팀 L6: 예상 크기 × 1.2를 넘으면 중단 · .part 지움, 리디렉션은 Hugging Face · CDN만
    blobs["tokenizer.json"] = b"x" * 1000
    with pytest.raises(RuntimeError, match="예상보다"):
        rag.download_model(tmp_path, client)
    assert not (tmp_path / "tokenizer.json.part").exists()

    def redirect(request):
        if request.url.host == "huggingface.co":
            return httpx.Response(302, headers={"Location": "https://evil.example.com/x"})
        return httpx.Response(200, content=b"x")
    bad = httpx.Client(transport=httpx.MockTransport(redirect), follow_redirects=True)
    with pytest.raises(RuntimeError, match="허용하지 않은 주소"):
        rag.download_model(tmp_path / "other", bad)
    cdn = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(302, headers={
        "Location": "https://us.aws.cdn.hf.co/blob"}) if r.url.host == "huggingface.co" else httpx.Response(200, content=b"zz")),
        follow_redirects=True)
    with pytest.raises(RuntimeError, match="SHA-256"):  # CDN 주소는 따라가고(내용이 달라 SHA 오류)
        rag.download_model(tmp_path / "cdn", cdn)


@pytest.mark.model
def test_real_model_embeds_korean_and_english():
    d = rag.model_dir()
    if rag.model_problems(d):
        pytest.skip("모델 파일이 없어 건너뜀 (PAPERLAB_EMBED_MODEL_DIR)")
    emb = rag.load_embedder(d)
    v = emb.embed([rag.QUERY_PREFIX + "Which planet is known as the Red Planet?",
                   rag.doc_text("none", "Mars, known for its reddish appearance, is often referred to as the Red Planet."),
                   rag.doc_text("none", "Venus is often called Earth's twin."),
                   rag.doc_text("none", "화성은 붉은 행성이라고 불린다.")])
    assert v.shape == (4, 512) and np.allclose(np.linalg.norm(v, axis=1), 1, atol=1e-4)
    assert v[0] @ v[1] > v[0] @ v[2] and v[0] @ v[3] > v[0] @ v[2]
    assert not math.isnan(float(v.sum())) and os.cpu_count()
