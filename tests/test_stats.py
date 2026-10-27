"""통계 계산 → APA 표 · 문장 (2026-10-28): 손으로 셀 수 있는 값 · APA 표기 · 조사 · 결측 · 잘못된 입력 · API"""
import pytest

from paperlab import stats


def run(kind, params, cols, rows):
    return stats.run({"columns": cols, "rows": rows, "analysis": kind, "params": params})


def test_apa_formatting_and_josa():
    assert stats.bounded(0.456) == ".46" and stats.bounded(-0.12) == "-.12" and stats.bounded(1.0) == "1.00"
    assert stats.p_cell(0.0004) == "< .001" and stats.p_text(0.0321) == "*p* = .032"
    assert stats.f2(-0.001) == "0.00" and stats.f2(float("nan")) == "—"
    assert stats.josa("사전", "와", "과") == "사전과" and stats.josa("사후", "와", "과") == "사후와"
    assert stats.josa("만족도", "가", "이") == "만족도가" and stats.josa("성별", "로", "으로") == "성별로"
    assert stats.josa(".716", "로", "으로") == ".716으로" and stats.josa("score", "와", "과") == "score와(과)"


def test_independent_t_matches_hand_values():
    rows = [["A", "1"], ["A", "2"], ["A", "3"], ["A", "4"], ["A", "5"], ["B", "2"], ["B", "3"], ["B", "4"], ["B", "5"], ["B", "6"], ["", "9"]]
    out = run("ttest_ind", {"group": "g", "value": "x"}, ["g", "x"], rows)
    t = out["tables"][0]["rows"]
    assert t[0] == ["집단", "*n*", "*M*", "*SD*", "*t*", "*df*", "*p*", "Cohen's *d*"]
    assert t[1] == ["A", "5", "3.00", "1.58", "-1.00", "8", ".347", "-0.63"]
    assert "통계적으로 유의하지 않았다(*t*(8) = -1.00, *p* = .347, *d* = -0.63)." in out["text"]


def test_paired_anova_corr_regression_chisq_alpha():
    cols = ["g", "pre", "post", "q1", "q2", "q3", "sex"]
    rows = [["a", "1", "2", "1", "2", "1", "m"], ["a", "2", "4", "2", "2", "3", "f"], ["b", "3", "5", "3", "4", "3", "m"],
            ["b", "4", "5", "4", "4", "5", "f"], ["c", "5", "7", "5", "4", "5", "m"], ["c", "6", "9", "5", "5", "4", "f"]]
    pr = run("ttest_rel", {"a": "post", "b": "pre"}, cols, rows)
    assert pr["tables"][0]["rows"][1][4:7] == ["5.97", "5", ".002"]  # 차이 1,2,2,1,2,3: 평균 1.83 / (0.75 / √6)
    an = run("anova", {"group": "g", "value": "post"}, cols, rows)
    src = an["tables"][1]["rows"]
    assert src[1][:3] == ["집단 간", "25.33", "2"] and src[2][:3] == ["집단 내", "4.00", "3"] and src[1][4] == "9.50"  # 평균 3 · 5 · 8
    assert an["tables"][1]["note"] == ""  # b 집단 값이 같아 Levene 계산 불가 → 문구 없음
    co = run("corr", {"vars": ["pre", "post"]}, cols, rows)
    assert co["tables"][0]["rows"][2][3] == r".97\*\*" and co["tables"][0]["note"].endswith(r"\*\*\**p* < .001.")
    rg = run("regression", {"y": "post", "xs": ["pre"]}, cols, rows)
    assert rg["tables"][0]["rows"][2][:4] == ["pre", "1.26", "0.15", ".97"]
    assert "*R*² = .94" in rg["tables"][0]["note"]
    ch = run("chisq", {"a": "g", "b": "sex"}, cols, rows)
    assert ch["tables"][0]["rows"][-1] == ["전체", "3", "3", "6"] and "기대빈도 5 미만" in ch["text"]
    al = run("alpha", {"vars": ["q1", "q2", "q3"]}, cols, rows)
    assert al["tables"][0]["note"].startswith("전체 Cronbach's *α* = .932")
    assert "q2 문항을 제거하면" in al["text"]


def test_errors_are_clear():
    with pytest.raises(stats.StatsError, match="집단이 3개"):
        run("ttest_ind", {"group": "g", "value": "x"}, ["g", "x"], [["a", "1"], ["b", "2"], ["c", "3"]])
    with pytest.raises(stats.StatsError, match="숫자가 아닌 값"):
        run("describe", {"vars": ["x"]}, ["x"], [["가"], ["나"], ["1"]])
    with pytest.raises(stats.StatsError, match="찾지 못했어요"):
        run("describe", {"vars": ["y"]}, ["x"], [["1"], ["2"]])
    with pytest.raises(stats.StatsError, match="분석 종류"):
        stats.run({"columns": ["x"], "rows": [], "analysis": "nope"})


def test_api_endpoint(local_client):
    r = local_client.post("/api/stats", json={"columns": ["x"], "rows": [["1"], ["2"], ["4"]], "analysis": "describe", "params": {"vars": ["x"]}})
    assert r.status_code == 200 and r.json()["tables"][0]["rows"][1][:4] == ["x", "3", "2.33", "1.53"]
    r = local_client.post("/api/stats", json={"columns": ["x"], "rows": [], "analysis": "describe", "params": {"vars": ["x"]}})
    assert r.status_code == 400
