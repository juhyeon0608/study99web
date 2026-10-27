"""원고 공유 링크 · 의견 (2026-10-27): 토큰 해시 · 인용 표시 · 공개 경로(로그인 없음) 입력 검사 · 마이그레이션"""
from pathlib import Path

from paperlab import shares

ROOT = Path(__file__).resolve().parents[1]


def test_token_and_cite_label():
    assert len(shares.token_hash("abc")) == 64
    assert shares.cite_label({"authors": [{"family": "김철수"}, {"family": "이"}, {"family": "박"}], "year": 2020}) == "김철수 외, 2020"
    assert shares.cite_label({"authors": [{"family": "Kim"}, {"family": "Lee"}], "year": 2021}) == "Kim · Lee, 2021"
    assert shares.cite_label({"authors": [], "title": "제목만 있는 논문", "year": None}) == "제목만 있는 논문, n.d."


def test_limiter():
    lim = shares.Limiter()
    assert all(lim.ok("t") for _ in range(shares.RATE_N))
    assert not lim.ok("t") and lim.ok("other")


def test_public_routes_need_no_login_but_check_token(local_client):
    # 로그인 없이 공개 경로에 닿는다(토큰 모양이 틀리면 DB 전에 404)
    r = local_client.get("/api/public/share/x", headers={"authorization": ""})
    assert r.status_code == 404
    # 쓰기는 공유 페이지 헤더 필요 (CSRF)
    r = local_client.post("/api/public/share/" + "a" * 32 + "/comments", json={"author": "a", "body": "b"},
                          headers={"x-paperlab": "0"})
    assert r.status_code == 403
    page = local_client.get("/s/" + "a" * 32)
    assert page.status_code == 200 and "share.js" in page.text and page.headers["x-robots-tag"].startswith("noindex")


def test_migration_has_rls_for_both_tables():
    sql = (ROOT / "supabase" / "migrations" / "20261027000001_manuscript_shares.sql").read_text(encoding="utf-8")
    for t in ("manuscript_shares", "share_comments"):
        assert f"alter table paperlab.{t} enable row level security" in sql
        assert f"alter table paperlab.{t} force row level security" in sql
    assert "token_hash     text not null unique" in sql
