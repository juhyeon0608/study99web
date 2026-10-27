"""통계 계산 → APA 표 · 결과 문장 (2026-10-28 사용자 요청).

AI가 아니라 서버가 직접 계산한다(scipy · numpy) — 숫자를 지어낼 일이 없다. 엑셀에서 복사한 표(첫 줄 = 변인 이름)를 받아
기술통계 · 독립/대응표본 t검정 · 일원분산분석(+Tukey) · 상관 · 다중회귀 · 카이제곱 · 크론바흐 α를 계산하고
표(캡션 · 머리줄 포함 행 · 주) 여러 개와 한국어 결과 문단을 돌려준다. 화면(writestatsui.js)이 원고 표 마크다운으로 바꿔 넣는다.
결측(빈칸 · . · NA · -)은 분석마다 쓰는 변인 기준으로 그 행을 뺀다(목록별 제거).
"""
from __future__ import annotations

import math
import re

import numpy as np

MAX_ROWS = 5000
MAX_COLS = 60
MAX_VARS = 10  # 상관 · 기술통계 · 신뢰도 · 회귀 예측변인
MISSING = {"", ".", "na", "n/a", "nan", "-", "null", "없음", "무응답", "#n/a"}
ANALYSES = ("describe", "ttest_ind", "ttest_rel", "anova", "corr", "regression", "chisq", "alpha")
# 별표는 마크다운 강조로 읽히지 않게 \* (원고 · 내보내기에서 * 로 보임)
STAR_NOTE = r"\**p* < .05, \*\**p* < .01, \*\*\**p* < .001."


class StatsError(ValueError):
    pass


# ------------------------------------------------------------------ 숫자 · APA 표기
def num(cell) -> float | None:
    s = str(cell if cell is not None else "").strip().replace(",", "").replace("−", "-")
    if s.lower() in MISSING:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if math.isfinite(v) else None


def f2(x: float, d: int = 2) -> str:
    if x is None or not math.isfinite(float(x)):
        return "—"
    s = f"{float(x):.{d}f}"
    return s[1:] if s.startswith("-") and float(s) == 0 else s


def bounded(x: float, d: int = 2) -> str:
    """1을 넘지 않는 값(r · β · p · α · η²)은 앞 0 없이: .45 · -.12"""
    s = f2(x, d)
    return s.replace("0.", ".", 1) if s.startswith(("0.", "-0.")) else s


def p_cell(p: float) -> str:
    return "—" if not math.isfinite(p) else "< .001" if p < .001 else bounded(p, 3)


def p_text(p: float) -> str:
    return "*p* = —" if not math.isfinite(p) else "*p* < .001" if p < .001 else f"*p* = {bounded(p, 3)}"


def levene_note(lev) -> str:
    """등분산 검정 문구 (집단 안 값이 모두 같아 계산할 수 없으면 빈 글)"""
    f, p = float(lev.statistic), float(lev.pvalue)
    return f"Levene 검정 *F* = {f2(f)}, {p_text(p)}." if math.isfinite(f) and math.isfinite(p) else ""


def stars(p: float) -> str:
    return r"\*" * (3 if p < .001 else 2 if p < .01 else 1 if p < .05 else 0)


def df_text(df: float) -> str:
    return str(int(round(df))) if abs(df - round(df)) < 1e-9 else f2(df)


def sig(p: float, stat: str = "") -> str:
    """'통계적으로 유의하였다(*t*(38) = 2.31, *p* = .025).' 처럼 통계값은 괄호로"""
    return ("통계적으로 유의하였다" if p < .05 else "통계적으로 유의하지 않았다") + (f"({stat})" if stat else "")


_DIGIT_FINAL = "013678"  # 영 · 일 · 삼 · 육 · 칠 · 팔 — 받침 있음


def tail(word: str, a: str, b: str) -> str:
    """조사만 (괄호 뒤에 붙일 때: '사후(*M* = …)와')"""
    return josa(word, a, b)[len(str(word)):]


def josa(word: str, a: str, b: str) -> str:
    """조사 붙이기: a = 받침 없을 때(와 · 가 · 는 · 를 · 로), b = 받침 있을 때(과 · 이 · 은 · 을 · 으로). 모르면 'b(a)' 꼴"""
    w = str(word)
    ch = w.rstrip(" )*")[-1:] if w.rstrip(" )*") else ""
    if "가" <= ch <= "힣":
        final = (ord(ch) - 0xAC00) % 28
        has = final != 0 and not (a == "로" and final == 8)  # ㄹ 받침 + 로
        return w + (b if has else a)
    if ch.isdigit():
        return w + (b if ch in _DIGIT_FINAL and not (a == "로" and ch in "178") else a)
    return w + f"{a}({b})"


# ------------------------------------------------------------------ 자료
class Data:
    def __init__(self, columns, rows):
        if not isinstance(columns, list) or not isinstance(rows, list):
            raise StatsError("자료 모양이 맞지 않아요")
        if len(rows) > MAX_ROWS:
            raise StatsError(f"행은 {MAX_ROWS:,}개까지 계산해요")
        if not columns or len(columns) > MAX_COLS:
            raise StatsError(f"열은 1~{MAX_COLS}개여야 해요")
        self.columns = [str(c or "").strip()[:60] or f"열{i + 1}" for i, c in enumerate(columns)]
        self.rows = [[str(c if c is not None else "").strip() for c in (r if isinstance(r, list) else [])] for r in rows]

    def idx(self, name) -> int:
        try:
            return self.columns.index(str(name))
        except ValueError:
            raise StatsError(f"'{name}' 열을 찾지 못했어요") from None

    def cell(self, r, k):
        return r[k] if k < len(r) else ""

    def numeric(self, names: list[str]) -> np.ndarray:
        """쓰는 변인이 모두 숫자인 행만 → (n, len(names)) 배열"""
        ks = [self.idx(n) for n in names]
        out = []
        bad = set()
        for r in self.rows:
            vals = [num(self.cell(r, k)) for k in ks]
            if all(v is not None for v in vals):
                out.append(vals)
            else:
                for n, k, v in zip(names, ks, vals):
                    if v is None and str(self.cell(r, k)).strip().lower() not in MISSING:
                        bad.add(n)
        if bad and len(out) < len(self.rows) / 2:
            raise StatsError(f"숫자가 아닌 값이 많아요 — {', '.join(sorted(bad))} 열을 확인해 주세요")
        return np.array(out, dtype=float).reshape(-1, len(names))

    def grouped(self, group: str, value: str) -> tuple[list[str], list[np.ndarray]]:
        g, v = self.idx(group), self.idx(value)
        levels: dict[str, list[float]] = {}
        for r in self.rows:
            key = str(self.cell(r, g)).strip()
            x = num(self.cell(r, v))
            if key.lower() in MISSING or x is None:
                continue
            levels.setdefault(key, []).append(x)
        names = sorted(levels, key=lambda k: (num(k) is None, num(k) or 0, k))
        return names, [np.array(levels[k]) for k in names]

    def categorical(self, a: str, b: str) -> list[tuple[str, str]]:
        ka, kb = self.idx(a), self.idx(b)
        out = []
        for r in self.rows:
            x, y = str(self.cell(r, ka)).strip(), str(self.cell(r, kb)).strip()
            if x.lower() not in MISSING and y.lower() not in MISSING:
                out.append((x, y))
        return out


def _need(params: dict, key: str) -> str:
    v = params.get(key)
    if not isinstance(v, str) or not v:
        raise StatsError("분석할 변인을 골라 주세요")
    return v


def _many(params: dict, key: str, lo: int, hi: int = MAX_VARS) -> list[str]:
    v = params.get(key)
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        raise StatsError("분석할 변인을 골라 주세요")
    v = list(dict.fromkeys(v))
    if not lo <= len(v) <= hi:
        raise StatsError(f"변인을 {lo}~{hi}개 골라 주세요")
    return v


def _sd(x: np.ndarray) -> float:
    return float(np.std(x, ddof=1)) if len(x) > 1 else float("nan")


def _table(caption: str, head: list[str], rows: list[list[str]], note: str = "", align: list | None = None) -> dict:
    return {"caption": caption, "rows": [head, *rows], "note": note,
            "align": align or ["left"] + ["right"] * (len(head) - 1)}


# ------------------------------------------------------------------ 분석
def describe(d: Data, p: dict) -> dict:
    from scipy import stats as st
    names = _many(p, "vars", 1)
    rows, text = [], []
    for n in names:
        x = d.numeric([n])[:, 0]
        if len(x) < 2:
            raise StatsError(f"'{n}'에 숫자 값이 두 개 이상 있어야 해요")
        sk = float(st.skew(x, bias=False)) if len(x) > 2 else float("nan")
        ku = float(st.kurtosis(x, bias=False)) if len(x) > 3 else float("nan")
        rows.append([n, str(len(x)), f2(x.mean()), f2(_sd(x)), f2(x.min()), f2(x.max()),
                     "—" if math.isnan(sk) else f2(sk), "—" if math.isnan(ku) else f2(ku)])
        text.append(f"{n}의 평균은 {f2(x.mean())}(*SD* = {f2(_sd(x))})")
    normal = all(r[6] == "—" or abs(float(r[6])) < 2 for r in rows) and all(r[7] == "—" or abs(float(r[7])) < 7 for r in rows)
    para = "주요 변인의 기술통계는 표와 같다. " + ", ".join(text) + "이었다."
    para += (" 왜도의 절댓값이 2 미만, 첨도의 절댓값이 7 미만으로 정규분포 가정을 크게 벗어나지 않았다(Curran et al., 1996)."
             if normal else " 일부 변인의 왜도 · 첨도가 정규분포 기준(왜도 2, 첨도 7)을 넘어 해석에 주의가 필요하다.")
    return {"tables": [_table("주요 변인의 기술통계", ["변인", "*N*", "*M*", "*SD*", "최솟값", "최댓값", "왜도", "첨도"], rows)], "text": para}


def ttest_ind(d: Data, p: dict) -> dict:
    from scipy import stats as st
    group, value = _need(p, "group"), _need(p, "value")
    names, xs = d.grouped(group, value)
    if len(names) != 2:
        raise StatsError(f"'{group}' 열의 집단이 {len(names)}개예요 — 독립표본 t검정은 집단이 2개여야 해요 (3개 이상이면 분산분석)")
    a, b = xs
    if min(len(a), len(b)) < 2:
        raise StatsError("집단마다 값이 두 개 이상 있어야 해요")
    lev = st.levene(a, b, center="mean")
    equal = not (float(lev.pvalue) < .05)
    r = st.ttest_ind(a, b, equal_var=equal)
    df = float(r.df) if hasattr(r, "df") else len(a) + len(b) - 2
    pooled = math.sqrt(((len(a) - 1) * _sd(a) ** 2 + (len(b) - 1) * _sd(b) ** 2) / (len(a) + len(b) - 2))
    dd = (a.mean() - b.mean()) / pooled if pooled else float("nan")
    t, pv = float(r.statistic), float(r.pvalue)
    rows = [[names[0], str(len(a)), f2(a.mean()), f2(_sd(a)), f2(t), df_text(df), p_cell(pv), f2(dd)],
            [names[1], str(len(b)), f2(b.mean()), f2(_sd(b)), "", "", "", ""]]
    note = (levene_note(lev) + " " + ("등분산을 가정하였다." if equal else "등분산 가정을 충족하지 않아 Welch 검정 결과를 보고하였다.")).strip()
    para = (f"{group}에 따른 {value}의 차이를 독립표본 *t*검정으로 분석한 결과, {names[0]} 집단(*M* = {f2(a.mean())}, *SD* = {f2(_sd(a))})과 "
            f"{names[1]} 집단(*M* = {f2(b.mean())}, *SD* = {f2(_sd(b))})의 차이는 "
            f"{sig(pv, f'*t*({df_text(df)}) = {f2(t)}, {p_text(pv)}, *d* = {f2(dd)}')}.")
    return {"tables": [_table(f"{group}에 따른 {value}의 차이", ["집단", "*n*", "*M*", "*SD*", "*t*", "*df*", "*p*", "Cohen's *d*"], rows, note)],
            "text": para}


def ttest_rel(d: Data, p: dict) -> dict:
    from scipy import stats as st
    a_name, b_name = _need(p, "a"), _need(p, "b")
    if a_name == b_name:
        raise StatsError("서로 다른 두 변인을 골라 주세요")
    x = d.numeric([a_name, b_name])
    if len(x) < 3:
        raise StatsError("짝지은 값이 세 쌍 이상 있어야 해요")
    a, b = x[:, 0], x[:, 1]
    r = st.ttest_rel(a, b)
    diff = a - b
    dz = diff.mean() / _sd(diff) if _sd(diff) else float("nan")
    t, pv, df = float(r.statistic), float(r.pvalue), len(x) - 1
    rows = [[a_name, str(len(x)), f2(a.mean()), f2(_sd(a)), f2(t), str(df), p_cell(pv), f2(dz)],
            [b_name, str(len(x)), f2(b.mean()), f2(_sd(b)), "", "", "", ""]]
    para = (f"{a_name}(*M* = {f2(a.mean())}, *SD* = {f2(_sd(a))}){tail(a_name, '와', '과')} "
            f"{b_name}(*M* = {f2(b.mean())}, *SD* = {f2(_sd(b))})의 차이를 대응표본 *t*검정으로 분석한 결과, 차이는 "
            f"{sig(pv, f'*t*({df}) = {f2(t)}, {p_text(pv)}, *d* = {f2(dz)}')}.")
    return {"tables": [_table(f"{josa(a_name, '와', '과')} {b_name}의 차이", ["변인", "*N*", "*M*", "*SD*", "*t*", "*df*", "*p*", "Cohen's *d*"], rows,
                              "효과크기 *d* = 차이 점수의 평균 / 차이 점수의 표준편차.")], "text": para}


def anova(d: Data, p: dict) -> dict:
    from scipy import stats as st
    group, value = _need(p, "group"), _need(p, "value")
    names, xs = d.grouped(group, value)
    if len(names) < 2:
        raise StatsError(f"'{group}' 열의 집단이 2개 이상이어야 해요")
    if len(names) > 12:
        raise StatsError(f"'{group}' 열의 집단이 {len(names)}개예요 — 집단을 나타내는 열을 골라 주세요")
    if any(len(x) < 2 for x in xs):
        raise StatsError("집단마다 값이 두 개 이상 있어야 해요")
    allx = np.concatenate(xs)
    grand = allx.mean()
    ssb = float(sum(len(x) * (x.mean() - grand) ** 2 for x in xs))
    ssw = float(sum(((x - x.mean()) ** 2).sum() for x in xs))
    dfb, dfw = len(xs) - 1, len(allx) - len(xs)
    msb, msw = ssb / dfb, ssw / dfw
    f = msb / msw if msw else float("inf")
    pv = float(st.f.sf(f, dfb, dfw))
    eta = ssb / (ssb + ssw) if ssb + ssw else 0.0
    lev = st.levene(*xs, center="mean")
    desc = [[n, str(len(x)), f2(x.mean()), f2(_sd(x))] for n, x in zip(names, xs)]
    src = [["집단 간", f2(ssb), str(dfb), f2(msb), f2(f), p_cell(pv), bounded(eta)],
           ["집단 내", f2(ssw), str(dfw), f2(msw), "", "", ""],
           ["전체", f2(ssb + ssw), str(dfb + dfw), "", "", "", ""]]
    tables = [_table(f"{group}별 {value}의 기술통계", ["집단", "*n*", "*M*", "*SD*"], desc),
              _table(f"{group}에 따른 {value}의 일원분산분석", ["변산원", "*SS*", "*df*", "*MS*", "*F*", "*p*", "*η*²"], src,
                     levene_note(lev))]
    para = (f"{group}에 따른 {value}의 차이를 일원분산분석으로 분석한 결과, 집단 간 차이는 "
            f"{sig(pv, f'*F*({dfb}, {dfw}) = {f2(f)}, {p_text(pv)}, *η*² = {bounded(eta)}')}.")
    if pv < .05 and len(xs) >= 3:
        tk = st.tukey_hsd(*xs)
        rows, pairs = [], []
        for i in range(len(xs)):
            for j in range(i + 1, len(xs)):
                pij = float(tk.pvalue[i, j])
                rows.append([f"{names[i]} - {names[j]}", f2(xs[i].mean() - xs[j].mean()), p_cell(pij)])
                if pij < .05:
                    hi, lo = (i, j) if xs[i].mean() > xs[j].mean() else (j, i)
                    pairs.append(f"{names[hi]} 집단이 {names[lo]} 집단보다")
        tables.append(_table("사후 검정 (Tukey HSD)", ["비교", "평균 차이", "*p*"], rows))
        para += (" Tukey 사후 검정 결과, " + ", ".join(pairs) + f" {josa(value, '가', '이')} 유의하게 높았다." if pairs
                 else " Tukey 사후 검정에서는 유의한 쌍별 차이가 나타나지 않았다.")
    if float(lev.pvalue) < .05:
        para += " 다만 등분산 가정을 충족하지 않아(Levene 검정) 해석에 주의가 필요하다."
    return {"tables": tables, "text": para}


def corr(d: Data, p: dict) -> dict:
    from scipy import stats as st
    names = _many(p, "vars", 2)
    x = d.numeric(names)
    if len(x) < 3:
        raise StatsError("모든 변인에 값이 있는 행이 세 개 이상이어야 해요")
    k = len(names)
    head = ["변인", "*M*", "*SD*", *[str(i + 1) for i in range(k)]]
    rows, found = [], []
    for i in range(k):
        row = [f"{i + 1}. {names[i]}", f2(x[:, i].mean()), f2(_sd(x[:, i]))]
        for j in range(k):
            if j < i:
                r = st.pearsonr(x[:, i], x[:, j])
                rv, pv = float(r.statistic), float(r.pvalue)
                row.append(f"{bounded(rv)}{stars(pv)}")
                if pv < .05:
                    found.append(f"{josa(names[j], '와', '과')} {names[i]}(*r* = {bounded(rv)}, {p_text(pv)})")
            else:
                row.append("—" if j == i else "")
        rows.append(row)
    para = (f"주요 변인 간의 상관을 Pearson 상관분석으로 분석한 결과(*N* = {len(x)}), "
            + ("유의한 상관은 " + ", ".join(found) + "에서 나타났다." if found else "유의한 상관은 나타나지 않았다."))
    return {"tables": [_table("주요 변인 간의 상관", head, rows, f"*N* = {len(x)}. {STAR_NOTE}")], "text": para}


def regression(d: Data, p: dict) -> dict:
    from scipy import stats as st
    y_name = _need(p, "y")
    xs = _many(p, "xs", 1)
    if y_name in xs:
        raise StatsError("종속변인을 예측변인으로 함께 고를 수 없어요")
    data = d.numeric([y_name, *xs])
    n, k = len(data), len(xs)
    if n < k + 3:
        raise StatsError(f"행이 너무 적어요 — 예측변인 {k}개면 {k + 3}행 이상")
    y, X = data[:, 0], data[:, 1:]
    A = np.column_stack([np.ones(n), X])
    if np.linalg.matrix_rank(A) < A.shape[1]:
        raise StatsError("예측변인끼리 완전히 겹쳐요(다중공선성) — 변인을 줄여 주세요")
    b, *_ = np.linalg.lstsq(A, y, rcond=None)
    resid = y - A @ b
    dfe = n - k - 1
    sse = float(resid @ resid)
    sst = float(((y - y.mean()) ** 2).sum())
    r2 = 1 - sse / sst if sst else 0.0
    adj = 1 - (1 - r2) * (n - 1) / dfe
    mse = sse / dfe
    se = np.sqrt(np.diag(mse * np.linalg.inv(A.T @ A)))
    t = b / se
    pv = 2 * st.t.sf(np.abs(t), dfe)
    sdy = _sd(y)
    beta = [b[i + 1] * _sd(X[:, i]) / sdy if sdy else float("nan") for i in range(k)]
    fval = (r2 / k) / ((1 - r2) / dfe) if r2 < 1 else float("inf")
    fp = float(st.f.sf(fval, k, dfe))
    vif = []
    for i in range(k):
        if k == 1:
            vif.append("")
            continue
        others = np.column_stack([np.ones(n), np.delete(X, i, axis=1)])
        bi, *_ = np.linalg.lstsq(others, X[:, i], rcond=None)
        ri = X[:, i] - others @ bi
        ss = float(((X[:, i] - X[:, i].mean()) ** 2).sum())
        r2i = 1 - float(ri @ ri) / ss if ss else 1.0
        vif.append(f2(1 / (1 - r2i)) if r2i < 1 else "∞")
    head = ["변인", "*B*", "*SE*", "*β*", "*t*", "*p*"] + (["VIF"] if k > 1 else [])
    rows = [["(상수)", f2(b[0]), f2(se[0]), "", f2(t[0]), p_cell(float(pv[0]))] + ([""] if k > 1 else [])]
    effects, last = [], ""
    for i, name in enumerate(xs):
        rows.append([name, f2(b[i + 1]), f2(se[i + 1]), bounded(beta[i]), f2(t[i + 1]), p_cell(float(pv[i + 1]))] + ([vif[i]] if k > 1 else []))
        if pv[i + 1] < .05:
            effects.append(f"{name}(*β* = {bounded(beta[i])}, {p_text(float(pv[i + 1]))})")
            last = name
    note = f"*R*² = {bounded(r2)}, 수정된 *R*² = {bounded(adj)}, *F*({k}, {dfe}) = {f2(fval)}, {p_text(fp)}."
    para = (f"{josa(', '.join(xs), '가', '이')} {y_name}에 미치는 영향을 {'다중' if k > 1 else '단순'}회귀분석으로 분석한 결과, 회귀모형은 "
            f"{sig(fp, f'*F*({k}, {dfe}) = {f2(fval)}, {p_text(fp)}')}. 모형의 설명력은 {r2 * 100:.1f}%였다(*R*² = {bounded(r2)}). "
            + ("유의한 예측변인은 " + ", ".join(effects) + tail(last, "였다", "이었다") + "." if effects else "유의한 예측변인은 없었다."))
    if any(v not in ("", "∞") and float(v) >= 10 for v in vif) or "∞" in vif:
        para += " 일부 변인의 VIF가 10 이상으로 다중공선성을 확인할 필요가 있다."
    return {"tables": [_table(f"{y_name}에 대한 회귀분석 결과", head, rows, note)], "text": para}


def chisq(d: Data, p: dict) -> dict:
    from scipy import stats as st
    a, b = _need(p, "a"), _need(p, "b")
    if a == b:
        raise StatsError("서로 다른 두 변인을 골라 주세요")
    pairs = d.categorical(a, b)
    ra = sorted({x for x, _ in pairs}, key=lambda k: (num(k) is None, num(k) or 0, k))
    cb = sorted({y for _, y in pairs}, key=lambda k: (num(k) is None, num(k) or 0, k))
    if len(ra) < 2 or len(cb) < 2:
        raise StatsError("두 변인 모두 범주가 2개 이상이어야 해요")
    if len(ra) > 12 or len(cb) > 10:
        raise StatsError("범주가 너무 많아요 — 범주형 변인(집단 · 성별 등)을 골라 주세요")
    obs = np.zeros((len(ra), len(cb)), dtype=int)
    for x, y in pairs:
        obs[ra.index(x), cb.index(y)] += 1
    res = st.chi2_contingency(obs, correction=False)
    chi, pv, dof, exp = float(res.statistic), float(res.pvalue), int(res.dof), res.expected_freq
    n = int(obs.sum())
    v = math.sqrt(chi / (n * (min(obs.shape) - 1))) if n else 0.0
    rows = []
    for i, x in enumerate(ra):
        tot = obs[i].sum()
        rows.append([x, *[f"{obs[i, j]} ({obs[i, j] / tot * 100:.1f}%)" if tot else "0" for j in range(len(cb))], str(tot)])
    rows.append(["전체", *[str(obs[:, j].sum()) for j in range(len(cb))], str(n)])
    low = float((exp < 5).mean())
    note = f"*χ*²({dof}, *N* = {n}) = {f2(chi)}, {p_text(pv)}, Cramér's *V* = {bounded(v)}. 괄호 안은 행 백분율."
    para = (f"{josa(a, '와', '과')} {b}의 관련성을 카이제곱 검정으로 분석한 결과, 두 변인의 관련성은 "
            f"{sig(pv, f'*χ*²({dof}, *N* = {n}) = {f2(chi)}, {p_text(pv)}, Cramér' + chr(39) + f's *V* = {bounded(v)}')}.")
    if low > .2:
        warn = f" 기대빈도 5 미만인 칸이 {low * 100:.0f}%로 20%를 넘어"
        if obs.shape == (2, 2):
            fp = float(st.fisher_exact(obs).pvalue)
            note += f" Fisher 정확 검정 {p_text(fp)}."
            para += warn + f" Fisher 정확 검정 결과({p_text(fp)})를 함께 보고한다."
        else:
            para += warn + " 범주를 합치는 것을 검토할 필요가 있다."
    return {"tables": [_table(f"{a}에 따른 {b}의 분포", [f"{a} \\ {b}", *cb, "전체"], rows, note)], "text": para}


def alpha(d: Data, p: dict) -> dict:
    names = _many(p, "vars", 2, 40)
    x = d.numeric(names)
    n, k = x.shape
    if n < 3:
        raise StatsError("모든 문항에 응답한 행이 세 개 이상이어야 해요")

    def cron(m: np.ndarray) -> float:
        kk = m.shape[1]
        tv = float(np.var(m.sum(axis=1), ddof=1))
        return kk / (kk - 1) * (1 - float(np.var(m, axis=0, ddof=1).sum()) / tv) if tv and kk > 1 else float("nan")

    a = cron(x)
    rows = []
    weak = []
    for i, name in enumerate(names):
        rest = np.delete(x, i, axis=1)
        total = rest.sum(axis=1)
        sd_i, sd_t = _sd(x[:, i]), _sd(total)
        rit = float(np.corrcoef(x[:, i], total)[0, 1]) if sd_i and sd_t else float("nan")
        ad = cron(rest) if k > 2 else float("nan")
        rows.append([name, f2(x[:, i].mean()), f2(sd_i), "—" if math.isnan(rit) else bounded(rit), "—" if math.isnan(ad) else bounded(ad, 3)])
        if not math.isnan(ad) and ad > a + .005:
            weak.append(name)
    level = "매우 높은" if a >= .9 else "높은" if a >= .8 else "수용할 만한" if a >= .7 else "낮은"
    para = f"{k}개 문항의 내적 일관성 신뢰도(Cronbach's *α*)는 {josa(bounded(a, 3), '로', '으로')} {level} 수준이었다(*N* = {n})."
    if weak:
        para += f" {', '.join(weak)} 문항을 제거하면 신뢰도가 높아져 문항 검토가 필요하다."
    return {"tables": [_table("문항 신뢰도 분석", ["문항", "*M*", "*SD*", "수정된 문항-총점 상관", "항목 삭제 시 *α*"], rows,
                              f"전체 Cronbach's *α* = {bounded(a, 3)}, 문항 {k}개, *N* = {n}.")], "text": para}


RUN = {"describe": describe, "ttest_ind": ttest_ind, "ttest_rel": ttest_rel, "anova": anova, "corr": corr,
       "regression": regression, "chisq": chisq, "alpha": alpha}


def run(payload: dict) -> dict:
    """{columns, rows, analysis, params} → {tables: [{caption, rows, note, align}], text, n}"""
    if not isinstance(payload, dict):
        raise StatsError("자료 모양이 맞지 않아요")
    kind = payload.get("analysis")
    if kind not in RUN:
        raise StatsError("분석 종류를 골라 주세요")
    params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
    d = Data(payload.get("columns"), payload.get("rows"))
    with np.errstate(all="ignore"):
        out = RUN[kind](d, params)
    out["text"] = re.sub(r"\(\s*\)", "", out["text"])
    return out
