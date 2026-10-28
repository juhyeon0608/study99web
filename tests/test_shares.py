"""원고 공유 링크 · 의견 (2026-10-27): 토큰 해시 · 인용 표시 · 공개 경로(로그인 없음) 입력 검사 · 마이그레이션"""
from pathlib import Path

import pytest

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


@pytest.mark.db
def test_share_link_full_flow(client):
    """링크 만들기 → 로그인 없이 원고 보기 · 의견 쓰기 → 주인이 의견 보기 · 해결 → 읽기만 링크 → 끊기 (2026-10-28 점검)"""
    mid = client.post("/api/manuscripts", json={}).json()["id"]
    assert client.patch(f"/api/manuscripts/{mid}", json={"title": "공유 시험", "content": "## 서론\n\n첫 문장이다 [@kim2020].\n"}).status_code == 200
    r = client.post(f"/api/manuscripts/{mid}/shares", json={"label": "지도교수님", "days": 30})
    assert r.status_code == 201
    token, sid = r.json()["token"], r.json()["share"]["id"]
    assert client.post(f"/api/manuscripts/{mid}/shares", json={"days": 5}).status_code == 400

    pub = client  # 공개 경로는 로그인 머리글을 비워서 부른다
    page = pub.get(f"/s/{token}", headers={"authorization": ""})
    assert page.status_code == 200
    v = pub.get(f"/api/public/share/{token}", headers={"authorization": ""}).json()
    assert v["title"] == "공유 시험" and "첫 문장이다" in v["content"] and v["allow_comments"] and v["label"] == "지도교수님"

    hdr = {"authorization": "", "x-paperlab": "1"}
    c = pub.post(f"/api/public/share/{token}/comments", json={"author": "김교수", "quote": "첫 문장이다", "body": "근거를 더 쓰세요"}, headers=hdr)
    assert c.status_code == 201
    assert pub.post(f"/api/public/share/{token}/comments", json={"author": "", "body": "x"}, headers=hdr).status_code == 400
    assert [x["body"] for x in pub.get(f"/api/public/share/{token}", headers={"authorization": ""}).json()["comments"]] == ["근거를 더 쓰세요"]

    got = client.get(f"/api/manuscripts/{mid}/comments").json()
    assert got["open"] == 1 and got["items"][0]["author"] == "김교수" and got["items"][0]["quote"] == "첫 문장이다"
    assert client.patch(f"/api/comments/{got['items'][0]['id']}", json={"resolved": True}).status_code == 200
    assert client.get(f"/api/manuscripts/{mid}/comments").json()["open"] == 0
    listed = client.get(f"/api/manuscripts/{mid}/shares").json()["items"]
    assert listed[0]["comments"] == 1 and listed[0]["open_comments"] == 0

    ro = client.post(f"/api/manuscripts/{mid}/shares", json={"allow_comments": False, "days": None}).json()["token"]
    assert pub.post(f"/api/public/share/{ro}/comments", json={"author": "a", "body": "b"}, headers=hdr).status_code == 403

    assert client.delete(f"/api/shares/{sid}").status_code == 200
    assert pub.get(f"/api/public/share/{token}", headers={"authorization": ""}).status_code == 404
    assert pub.post(f"/api/public/share/{token}/comments", json={"author": "a", "body": "b"}, headers=hdr).status_code == 404


@pytest.mark.db
def test_review_copy_marks_and_cleanup(client):
    """검토본 (2026-10-28): 처음 열 때 복사 → 원고를 고쳐도 링크는 검토본 → 고친 글 · 의견 → 주인 수정 완료 · 거부 → 검토본 지움 → 다시 열면 새 검토본"""
    mid = client.post("/api/manuscripts", json={}).json()["id"]
    client.patch(f"/api/manuscripts/{mid}", json={"title": "검토 시험", "content": "첫 문장이다. 둘째 문장이다.\n"})
    token = client.post(f"/api/manuscripts/{mid}/shares", json={"label": "김교수"}).json()["token"]
    pub = {"authorization": ""}
    hdr = {"authorization": "", "x-paperlab": "1"}
    assert client.get(f"/api/manuscripts/{mid}/reviews").json()["items"] == []  # 아직 안 열어 봄 → 검토본 없음

    v = client.get(f"/api/public/share/{token}", headers=pub).json()
    assert "첫 문장이다" in v["content"] and v["copied_at"]
    client.patch(f"/api/manuscripts/{mid}", json={"content": "완전히 새로 쓴 원고.\n"})
    assert "첫 문장이다" in client.get(f"/api/public/share/{token}", headers=pub).json()["content"]  # 링크는 검토본 그대로

    url = f"/api/public/share/{token}/comments"
    assert client.post(url, json={"author": "김교수", "kind": "edit", "quote": "", "replacement": "x"}, headers=hdr).status_code == 400
    assert client.post(url, json={"author": "김교수", "kind": "edit", "quote": "둘째", "replacement": "둘째"}, headers=hdr).status_code == 400
    e = client.post(url, json={"author": "김교수", "kind": "edit", "quote": "둘째 문장이다", "replacement": "둘째 문장은 고친다"}, headers=hdr)
    assert e.status_code == 201 and e.json()["kind"] == "edit" and e.json()["status"] == "open" and e.json()["body"] == ""
    c = client.post(url, json={"author": "김교수", "quote": "첫 문장이다", "body": "근거를 쓰세요"}, headers=hdr).json()

    rv = client.get(f"/api/manuscripts/{mid}/reviews").json()
    assert rv["open"] == 2 and len(rv["items"]) == 1
    it = rv["items"][0]
    assert it["has_copy"] and "첫 문장이다" in it["content"] and it["label"] == "김교수"
    assert [(x["kind"], x["replacement"]) for x in it["comments"]] == [("edit", "둘째 문장은 고친다"), ("comment", "")]
    assert client.get("/api/reviews").json()[str(mid)] == {"copies": 1, "open": 2}

    assert client.patch(f"/api/comments/{e.json()['id']}", json={"status": "bogus"}).status_code == 400
    assert client.patch(f"/api/comments/{e.json()['id']}", json={"status": "done"}).json()["cleared"] is False
    assert client.patch(f"/api/comments/{c['id']}", json={"status": "rejected"}).json()["cleared"] is True
    assert client.get(f"/api/manuscripts/{mid}/reviews").json() == {"items": [], "open": 0}
    assert str(mid) not in client.get("/api/reviews").json()
    statuses = [x["status"] for x in client.get(f"/api/public/share/{token}", headers=pub).json()["comments"]]
    assert statuses == ["done", "rejected"]  # 교수님 쪽에도 처리 결과

    # 검토를 끝낸 뒤 다시 연 링크 = 지금 원고로 새 검토본
    assert "완전히 새로 쓴 원고" in client.get(f"/api/public/share/{token}", headers=pub).json()["content"]
    # 읽기 전용 링크는 복사하지 않고 지금 원고
    ro = client.post(f"/api/manuscripts/{mid}/shares", json={"allow_comments": False}).json()["token"]
    v2 = client.get(f"/api/public/share/{ro}", headers=pub).json()
    assert v2["copied_at"] is None and "완전히 새로 쓴 원고" in v2["content"]
