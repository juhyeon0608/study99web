"""수치 그래프를 코드로 그리기 (charts.py — 2026-10-28): 명세 검사 · 정확한 비율 · 정화 통과 · 명세 되읽기 · AI 응답 · 통계 그래프"""
import re

import pytest

from paperlab import ai, charts, figgen, stats

BAR = {"type": "bar", "x_label": "집단", "y_label": "평균", "categories": ["실험", "통제"],
       "series": [{"name": "사후", "values": [4, 2], "errors": [0.5, None]}]}


def rects(svg):
    """막대 (fill이 흰 배경 · 범례가 아닌 rect) → [(x, y, w, h)]"""
    return [tuple(float(v) for v in m.groups()) for m in
            re.finditer(r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#222"', svg)]


def test_validate_cleans_and_rejects():
    s = charts.validate({**BAR, "evil": "<script>", "series": [{"name": 3, "values": ["1,200", None, 9], "errors": [-0.5]}]})
    assert "evil" not in s and s["series"][0] == {"name": "3", "values": [1200.0, None], "errors": [0.5, None]}
    for bad, msg in [({"type": "pie"}, "bar · line · scatter"), ({**BAR, "categories": []}, "항목"),
                     ({**BAR, "series": [{"values": ["x"]}]}, "숫자가 아니에요"), ({**BAR, "series": [{"values": [float("inf")]}]}, "너무 크거나"),
                     ({"type": "scatter", "series": [{"xy": [[1]]}]}, r"\[x, y\]"),
                     ({"type": "scatter", "series": [{"xy": [[i, i] for i in range(2001)]}]}, "2,000개")]:
        with pytest.raises(charts.ChartError, match=msg):
            charts.validate(bad)


def test_bar_heights_are_exact_proportions_and_error_bars():
    svg = charts.render(BAR)
    (x1, y1, w1, h1), (x2, y2, w2, h2) = rects(svg)
    assert abs(h1 / h2 - 2) < 0.01 and abs((y1 + h1) - (y2 + h2)) < 0.01  # 4 : 2, 같은 바닥(0)
    assert svg.count("<path d=\"M") == 2  # 오차 막대 1개 + 축선
    assert ">4<" in svg and ">2<" in svg and "[확인 필요" not in svg and "font-family=\"'Malgun Gothic'" in svg


def test_ticks_wrap_and_missing_values():
    assert charts.nice_ticks(0, 4.6) == [0, 1, 2, 3, 4, 5] and charts.nice_ticks(2.9, 4.4) == [2.5, 3, 3.5, 4, 4.5]
    assert charts.wrap("응답하지 않음 및 기타", 120) == ["응답하지", "않음 및", "기타"] and charts.wrap("아주아주긴낱말하나", 40) is None
    svg = charts.render({**BAR, "series": [{"name": "a", "values": [3, None]}]})
    assert charts.CHECK in svg and ">?<" in svg
    assert charts.CHECK in charts.render({**BAR, "series": [{"name": "a", "values": [None, None]}]})


def test_line_scatter_trend_and_legend():
    line = charts.render({"type": "line", "categories": ["사전", "사후"], "series": [{"name": "실험", "values": [1, 2]}, {"name": "통제", "values": [1, 1]}]})
    assert line.count("<polyline") == 2 and 'stroke-dasharray="10 6"' in line and ">실험<" in line and ">통제<" in line
    sc = charts.render({"type": "scatter", "trend": True, "series": [{"name": "", "xy": [[1, 2], [2, 4], [3, 6], [4, 8]]}]})
    assert sc.count('r="6"') == 4 and "R² = 1.00" in sc


def test_render_passes_sanitizer_and_spec_round_trips():
    svg = figgen.sanitize_svg(charts.render(BAR))
    assert figgen.sanitize_svg(svg) == svg and 'id="pl-hatch"' in charts.render({**BAR, "series": [{"values": [1, 2]}] * 4})
    assert charts.spec_from_svg(svg) == charts.validate(BAR)
    assert charts.spec_from_svg("<svg><desc>x</desc></svg>") is None
    tricky = figgen.sanitize_svg(charts.render({**BAR, "categories": ['</desc><script>"&', "b"]}))
    assert "<script" not in tricky and charts.spec_from_svg(tricky)["categories"][0] == '</desc><script>"&'


def test_ai_chart_answer_is_drawn_by_code_and_edit_sends_spec():
    raw = ('그림 종류: 막대그래프 — 집단 비교\n캡션: 그림 2. 집단별 평균\n<chart>\n```json\n'
           '{"type": "bar", "categories": ["A", "B"], "series": [{"name": "x", "values": [3, null]}]}\n```\n</chart>')
    out = figgen.parse(raw)
    assert out["chart"] is True and out["caption"] == "집단별 평균" and out["check_needed"] is True
    assert charts.spec_from_svg(out["svg"])["series"][0]["values"] == [3.0, None]
    with pytest.raises(ai.AIError, match="그래프 명세"):
        figgen.parse('<chart>{"type": "pie"}</chart>')
    assert figgen.parse('<chart>깨짐</chart>\n' + figgen.sanitize_svg(charts.render(BAR)))["chart"] is False  # SVG가 있으면 그것으로
    _, prompt = figgen.build_request({"mode": "edit", "base_svg": out["svg"], "instruction": "B는 4"})
    assert "<previous_chart>" in prompt and "<previous_svg>" not in prompt and '"values": [3.0, null]' in prompt
    assert "<chart>JSON</chart>" in figgen.SYSTEM and '"type": "bar" | "line" | "scatter"' in figgen.SYSTEM


def test_edit_prompt_compacts_long_decimals_in_attributes_only():
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1.23456 7.891L-2.555 3"/><text x="1.06">3.14159</text></svg>'
    assert figgen.compact_svg(svg).endswith('<path d="M1.2 7.9L-2.6 3"/><text x="1.1">3.14159</text></svg>')
    _, prompt = figgen.build_request({"mode": "edit", "base_svg": svg, "instruction": "x"})
    assert "M1.2 7.9" in prompt and "3.14159" in prompt


def test_stats_results_come_with_graphs():
    cols = ["g", "pre", "post", "sex"]
    rows = [["a", "1", "2", "m"], ["a", "2", "4", "f"], ["b", "3", "5", "m"], ["b", "4", "5", "f"], ["c", "5", "7", "m"], ["c", "6", "9", "f"]]
    run = lambda kind, p: stats.run({"columns": cols, "rows": rows, "analysis": kind, "params": p})  # noqa: E731
    an = run("anova", {"group": "g", "value": "post"})
    assert an["chart"]["caption"] == "g에 따른 post의 평균 (오차 막대: ±1 SD)"
    spec = charts.spec_from_svg(an["chart"]["svg"])
    assert spec["categories"] == ["a", "b", "c"] and spec["series"][0]["values"] == [3.0, 5.0, 8.0]
    assert charts.spec_from_svg(run("chisq", {"a": "g", "b": "sex"})["chart"]["svg"])["series"][0] == {"name": "f", "values": [1.0, 1.0, 1.0]}
    assert charts.spec_from_svg(run("regression", {"y": "post", "xs": ["pre"]})["chart"]["svg"])["trend"] is True
    assert "chart" in run("corr", {"vars": ["pre", "post"]}) and "chart" not in run("alpha", {"vars": ["pre", "post"]})
