"""그림 만들기 · 자연어로 고치기 (2026-10-17 사용자 요청 — docs/specs/writing-figure-ai.md).

"그림 만드는 기능도 추가해줘. claude cli 사용해서 svg로 이미지 만드는 기능", "이 내용 기반으로 그림 만들어줘",
"이미지 생성해서 바로 붙여 넣거나 자연어를 통한 수정 같은 것도 가능해야지".

- 작업 종류 'figure'(마이그레이션 20261017000006). 실행은 내 PC의 claude CLI가 먼저, 다음 내 Claude API 키.
  claude가 둘 다 없을 때만 다른 엔진(내 PC의 codex · gemini → 내 API 키) — 화면에 안내 문구(route_note). 서버 PC의 CLI는 쓰지 않는다.
- 프롬프트(build_request): ① 설명으로 그리기(describe) ② 원고 내용으로 그리기(content — 내용에 없는 사실은 지어내지 않고
  모르는 값은 [확인 필요]) ③ 고치기(edit — 지난 SVG + 고쳐 달라는 말). 고치기 사슬은 params.chain(지난 작업 id들)으로 남는다.
- AI가 만든 SVG는 믿지 않는다: sanitize_svg가 허용 목록(요소 · 속성)으로 **다시 써서** 저장한다(원문을 그대로 두지 않음).
  화면도 <img src="blob:">로만 보이고(인라인 DOM 금지), 원고 · 내보내기는 화면이 그린 PNG를 쓴다(SVG는 다시 고칠 때의 원본).
"""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from typing import Callable

from . import ai

SVG_MAX_BYTES = 300 * 1024      # SVG 원본 상한 (AI 결과 · 저장 원본 · 고칠 원본 모두)
MAX_ELEMENTS = 5000             # 요소 수 상한 (그리는 브라우저가 멈추지 않게)
MAX_DEPTH = 40
MAX_SIDE = 10000                # viewBox 가로 · 세로 상한
ATTR_MAX = 100_000              # 속성 값 하나 (긴 path d)
DESC_MAX, CONTENT_MAX, INSTR_MAX, CAPTION_MAX = 2000, 12000, 2000, 300
CHAIN_MAX = 30                  # 고치기 사슬에 남기는 지난 작업 수
PARAMS_MAX = 420 * 1024         # 그림 작업 params 상한 (고칠 SVG 300KB + 원고 내용 — 다른 작업은 jobs.PARAMS_MAX 64KB)
TIMEOUT_S = 900                 # CLI 시간 제한
MODES = ("describe", "content", "edit")
ENGINE_ORDER = ("claude", "codex", "gemini")

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
XML_NS = "http://www.w3.org/XML/1998/namespace"
FONT_STACK = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Nanum Gothic',sans-serif"


class SvgError(ValueError):
    """쓸 수 없는 SVG (화면 문구)"""


# ---------------------------------------------------------------- SVG 정화 (허용 목록으로 다시 쓰기)
# 요소: 도형 · 글자 · 묶음 · 화살촉(marker) · 그러데이션 · 무늬(흑백 그래프의 빗금) · 잘라내기만.
# script · foreignObject · image · use · a · iframe · animate/set · feImage · filter 등은 하위 요소까지 통째로 버린다
ELEMENTS = {
    "svg", "g", "defs", "title", "desc", "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text",
    "tspan", "marker", "linearGradient", "radialGradient", "stop", "clipPath", "pattern", "style",
}
TEXT_TAGS = {"text", "tspan", "title", "desc", "style"}  # 글자를 남기는 요소 (나머지 요소 안의 글자는 버림)
# 속성: 위치 · 모양 · 칠 · 글꼴만. on* · href(아래 예외) · 바깥 주소를 받는 속성(src · xlink:* · xml:base …)은 없음
ATTRS = {
    "id", "class", "transform", "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "x1", "y1", "x2", "y2", "d", "points",
    "dx", "dy", "rotate", "textLength", "lengthAdjust", "viewBox", "preserveAspectRatio", "pathLength",
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset",
    "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "opacity", "color", "display", "visibility",
    "clip-path", "clip-rule", "clipPathUnits", "marker-start", "marker-mid", "marker-end",
    "markerWidth", "markerHeight", "markerUnits", "refX", "refY", "orient",
    "font-family", "font-size", "font-weight", "font-style", "font-variant", "text-anchor", "dominant-baseline",
    "alignment-baseline", "baseline-shift", "letter-spacing", "word-spacing", "text-decoration", "writing-mode",
    "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod", "fx", "fy", "fr",
    "patternUnits", "patternContentUnits", "patternTransform", "vector-effect", "shape-rendering", "text-rendering",
    "paint-order", "style", "xml:space",
}
HREF_TAGS = {"linearGradient", "radialGradient", "pattern"}  # href="#다른그러데이션"만 (같은 문서 조각)
_ID_RE = re.compile(r"[A-Za-z_][\w.-]{0,100}")
_CLASS_RE = re.compile(r"[A-Za-z0-9_ -]{1,200}")
_FRAG_RE = re.compile(r"#[A-Za-z_][\w.-]{0,100}")
_URL_FRAG_RE = re.compile(r"url\(\s*(['\"]?)#[A-Za-z_][\w.-]{0,100}\1\s*\)", re.I)
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# 값에 있으면 버리는 것: 바깥 주소 · 스크립트 주소 · 옛 IE 식 · CSS 규칙(@import · @font-face) · CSS 이스케이프(\72 우회)
_BAD_VALUE_RE = re.compile(r"javascript:|vbscript:|data:|expression\s*\(|@|\\|-moz-binding|behavior\s*:|"
                           r"(?<![\w-])(?:image|image-set|cross-fade|element|src)\s*\(", re.I)
_DECL_RE = re.compile(r"^\s*<\?xml\b[^>]*\?>", re.I)
_DTD_RE = re.compile(r"<!\s*(DOCTYPE|ENTITY|ATTLIST|ELEMENT|NOTATION)", re.I)


def _value_ok(v: str) -> bool:
    """속성 값 · CSS 글: url(#이름) 말고 다른 url(…)이 없고, 위험한 글자 · 식이 없음"""
    if _CTRL_RE.search(v) or _BAD_VALUE_RE.search(v) or "/*" in v:
        return False
    return "url(" not in re.sub(r"\s+", "", _URL_FRAG_RE.sub("", v)).lower()


def _css_ok(css: str) -> bool:
    return "<" not in css and _value_ok(css)


def _num(v: str) -> float | None:
    try:
        x = float(re.sub(r"(px)?\s*$", "", str(v).strip()))
    except ValueError:
        return None
    return x if math.isfinite(x) else None


def _fmt(x: float) -> str:
    return str(int(x)) if x == int(x) else f"{x:g}"


def parse_viewbox(v) -> tuple[float, float, float, float] | None:
    parts = [p for p in re.split(r"[\s,]+", str(v or "").strip()) if p]
    if len(parts) != 4:
        return None
    try:
        n = [float(p) for p in parts]
    except ValueError:
        return None
    if not all(math.isfinite(x) for x in n) or not (0 < n[2] <= MAX_SIDE and 0 < n[3] <= MAX_SIDE):
        return None
    return n[0], n[1], n[2], n[3]


def _local(name: str) -> tuple[str, str]:
    """'{ns}name' → (ns, name)"""
    if name.startswith("{"):
        ns, _, local = name[1:].partition("}")
        return ns, local
    return "", name


def _esc_text(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _esc_attr(s: str) -> str:
    return (_esc_text(s).replace('"', "&quot;").replace("\n", "&#10;").replace("\r", "&#13;").replace("\t", "&#9;"))


def _clean_attrs(tag: str, el: ET.Element) -> list[tuple[str, str]]:
    out = []
    for raw, value in el.attrib.items():
        ns, name = _local(raw)
        if ns == XML_NS:
            name = f"xml:{name}"
        elif ns in (XLINK_NS, "") and name == "href":
            if tag in HREF_TAGS and _FRAG_RE.fullmatch(value.strip()):
                out.append(("href", value.strip()))  # SVG2 href (xlink 이름공간 없이)
            continue
        elif ns:
            continue  # 다른 이름공간 속성은 모두 버림
        if name not in ATTRS or len(value) > ATTR_MAX:
            continue
        if name == "xml:space" and value not in ("default", "preserve"):
            continue
        if name == "id" and not _ID_RE.fullmatch(value):
            continue
        if name == "class" and not _CLASS_RE.fullmatch(value):
            continue
        if name == "style" and not _css_ok(value):
            continue
        if not _value_ok(value):
            continue
        out.append((name, value))
    return out


def sanitize_svg(text) -> str:
    """AI · 화면이 준 SVG → 허용 목록으로 다시 쓴 SVG 글. 쓸 수 없으면 SvgError.

    DOCTYPE · 엔티티 선언은 받지 않는다(외부 엔티티 · 엔티티 폭탄). 루트는 SVG 이름공간의 svg 하나, viewBox(없으면 숫자
    width · height로 만듦)가 있어야 한다. 허용하지 않는 요소는 하위까지 버리고, 허용하지 않는 속성 · 위험한 값은 그 속성만 버린다.
    결과 루트에는 width · height = viewBox 크기를 넣는다(브라우저가 <img>로 그릴 때 크기를 알게)."""
    if not isinstance(text, str):
        raise SvgError("SVG 글이 아니에요")
    text = text.lstrip("﻿").strip()
    if not text:
        raise SvgError("빈 SVG예요")
    if len(text.encode("utf-8")) > SVG_MAX_BYTES:
        raise SvgError(f"SVG가 너무 커요 ({SVG_MAX_BYTES // 1024}KB 초과)")
    text = _DECL_RE.sub("", text, count=1).lstrip()
    if _DTD_RE.search(text):
        raise SvgError("DOCTYPE · 엔티티 선언이 있는 SVG는 쓸 수 없어요")
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        raise SvgError("SVG를 읽지 못했어요 (XML 형식이 깨졌어요)") from None
    if _local(root.tag) != (SVG_NS, "svg"):
        raise SvgError("맨 바깥이 <svg>가 아니에요 (xmlns=\"http://www.w3.org/2000/svg\" 필요)")
    vb = parse_viewbox(root.get("viewBox"))
    if vb is None:
        w, h = _num(root.get("width", "")), _num(root.get("height", ""))
        if not (w and h and 0 < w <= MAX_SIDE and 0 < h <= MAX_SIDE):
            raise SvgError("viewBox가 없거나 올바르지 않아요")
        vb = (0.0, 0.0, w, h)
    count = [0]
    out: list[str] = []

    def walk(el: ET.Element, depth: int, nl: bool = False) -> None:
        ns, tag = _local(el.tag)
        count[0] += 1
        if count[0] > MAX_ELEMENTS or depth > MAX_DEPTH:
            raise SvgError("SVG가 너무 복잡해요")
        css = "".join(el.itertext()) if tag == "style" else ""
        if tag == "style" and not (_css_ok(css) and len(css) <= ATTR_MAX):
            return  # @import · @font-face · 바깥 url() 이 있는 <style>은 통째로 버림
        attrs = [(k, v) for k, v in _clean_attrs(tag, el) if not (depth == 0 and k in ("viewBox", "width", "height"))]
        if depth == 0:
            attrs = [("xmlns", SVG_NS), ("viewBox", " ".join(_fmt(x) for x in vb)),
                     ("width", _fmt(vb[2])), ("height", _fmt(vb[3]))] + attrs
        out.append(("\n" if nl else "") + f"<{tag}" + "".join(f' {k}="{_esc_attr(v)}"' for k, v in attrs) + ">")
        keep_text = tag in TEXT_TAGS
        if tag == "style":
            out.append(_esc_text(css) + "</style>")
            return
        if keep_text and el.text:
            out.append(_esc_text(_CTRL_RE.sub("", el.text)))
        for child in el:
            # 주석 · 처리 지시는 건너뜀. 허용하지 않는 요소는 하위까지 버리고, 글자 요소 안이면 뒤 글자(tail)만 남긴다
            cns, ctag = _local(child.tag) if isinstance(child.tag, str) else ("", "")
            if cns == SVG_NS and ctag in ELEMENTS and ctag != "svg":
                walk(child, depth + 1, nl=not keep_text)  # 글자 요소 밖이면 요소마다 줄을 바꿔 읽기 쉽게
            if keep_text and child.tail:
                out.append(_esc_text(_CTRL_RE.sub("", child.tail)))
        out.append(f"</{tag}>")

    walk(root, 0)
    svg = "".join(out)
    if len(svg.encode("utf-8")) > SVG_MAX_BYTES:
        raise SvgError(f"SVG가 너무 커요 ({SVG_MAX_BYTES // 1024}KB 초과)")
    return svg


def svg_size(svg: str) -> tuple[float, float]:
    """정화한 SVG의 viewBox 가로 · 세로"""
    m = re.search(r'viewBox="([^"]*)"', svg)
    vb = parse_viewbox(m.group(1)) if m else None
    return (vb[2], vb[3]) if vb else (0.0, 0.0)


# ---------------------------------------------------------------- 실행 경로
def route(has_key: Callable[[str], bool], advertised: set[str]) -> list[dict]:
    """그림 작업 경로: 내 PC의 claude CLI → 내 Claude API 키. claude가 둘 다 없을 때만 다른 엔진(PC CLI 먼저 → API 키).
    서버 PC의 CLI · 서버 키 칸은 만들지 않는다(jobs.build_route와 같은 원칙)"""
    out = []
    if "claude" in advertised:
        out.append({"runner": "cli", "engine": "claude"})
    if has_key("claude"):
        out.append({"runner": "api", "engine": "claude"})
    if out:
        return out
    others = [e for e in ENGINE_ORDER if e != "claude"]
    return ([{"runner": "cli", "engine": e} for e in others if e in advertised]
            + [{"runner": "api", "engine": e} for e in others if has_key(e)])


def route_note(route_: list[dict]) -> str:
    """claude가 아닌 엔진으로 그릴 때 화면 안내"""
    if not route_ or route_[0].get("engine") == "claude":
        return ""
    e = route_[0].get("engine")
    where = f"내 PC의 {e}" if route_[0].get("runner") == "cli" else f"내 {ai.ENGINE_COMPANY.get(e, e)} API 키"
    return (f"Claude(PC의 claude CLI · Claude API 키)를 쓸 수 없어 {where}로 그려요. 그림 품질이 다를 수 있어요. "
            "설정 → 연결된 PC에서 claude CLI를 쓰는 PC를 연결하면 Claude로 그려요.")


# ---------------------------------------------------------------- 프롬프트
SYSTEM = f"""당신은 학술 논문에 넣을 그림(도식 · 흐름도 · 개념도 · 구조도 · 그래프 · 표 형태 도해)을 SVG로 그리는 연구 그림 디자이너입니다.

SVG 규칙 (반드시 지키세요):
- 완결된 SVG 하나. 루트는 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H"> (W는 1000 안팎, H는 내용에 맞게 400~1400).
- 이 그림은 원고에서 가로 16cm로 줄어 들어갑니다. viewBox 너비 1000 기준 글자 크기 20~28(본문 9~12pt), 선 굵기 2~3,
  글자가 도형 밖으로 넘치거나 서로 겹치지 않게 넉넉히 배치하세요.
- 글꼴은 모든 <text>에 font-family="{FONT_STACK}".
- 기본은 흑백 학술 양식: 검정 · 회색(#000 #333 #666 #999 #ccc #eee)과 흰색만. 색을 요청받았을 때만 차분한 색을 쓰세요.
  맨 뒤에 흰 배경 <rect width="100%" height="100%" fill="#fff"/>를 깔아 주세요.
- 쓸 수 있는 요소: g, defs, rect, circle, ellipse, line, polyline, polygon, path, text, tspan, marker, linearGradient,
  radialGradient, stop, clipPath, pattern, title, desc. 화살표는 <defs>의 <marker>를 marker-end="url(#이름)"으로.
- 쓰면 안 되는 것: <script>, on…= 속성(onclick 등), <foreignObject>, <image>, <use>, <a>, <iframe>, 애니메이션(<animate> · <set>),
  <style> 요소 · style 속성(속성으로 직접 쓰세요), @import · @font-face, 바깥 주소(http · data:), url(#이름) 말고 다른 url(…), DOCTYPE · 엔티티.
- 여러 줄 글은 <tspan x=".." dy="..">로 나누세요.

내용 규칙:
- 주어진 설명 · 원고 내용에 있는 것만 그리세요. 수치 · 이름 · 결과 · 관계를 지어내지 마세요.
  모르는 값 · 확인이 필요한 부분은 그림 안에 [확인 필요]라고 쓰세요.
- 그래프는 주어진 수치가 있을 때만 그 수치로 그리고, 수치가 없으면 축 · 범례만 두고 [확인 필요]로 표시하세요.

출력 형식 (이 순서 그대로, 다른 말 · 설명 · 코드 블록 표시(```) 없이):
그림 종류: <흐름도 · 개념도 · 막대그래프 같은 종류> — <왜 이 종류가 맞는지 한 줄>
캡션: <그림 캡션 한 문장. '그림 1.' 같은 번호는 붙이지 마세요>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="...">...</svg>"""

_OUR_TAGS = re.compile(r"<(/?)(request|manuscript|previous_svg|previous_caption)\b", re.I)


def _fence(text) -> str:
    """사용자 글이 우리 칸 태그를 닫고 지시를 끼워 넣지 못하게 (ai.fence + 이 모듈의 태그)"""
    return _OUR_TAGS.sub(lambda m: f"‹{m.group(1)}{m.group(2)}", ai.fence(ai.unmark(text)))


def build_request(params: dict) -> tuple[str, str]:
    """(시스템, 프롬프트) — CLI 워커 · API 공용. params는 서버가 만든 그림 작업 params"""
    mode = params.get("mode")
    if mode not in MODES:
        raise ai.AIError("알 수 없는 그림 요청이에요", "bad_request")
    lang = "영어" if params.get("lang") == "en" else "한국어"
    desc = str(params.get("description") or "").strip()
    content = str(params.get("content") or "").strip()
    parts = []
    if content:
        parts.append("아래는 사용자가 쓰고 있는 논문 원고의 일부입니다. 이 내용만 근거로 그리세요.\n"
                     f"<manuscript>\n{_fence(content)}\n</manuscript>")
    if mode == "edit":
        svg = str(params.get("base_svg") or "")
        if not svg:
            raise ai.AIError("고칠 그림이 없어요", "bad_request")
        if desc:
            parts.append(f"처음 그림을 만들 때의 요청:\n<request>\n{_fence(desc)}\n</request>")
        cap = str(params.get("base_caption") or "").strip()
        if cap:
            parts.append(f"<previous_caption>{_fence(cap)}</previous_caption>")
        parts.append(f"지금 그림(SVG):\n<previous_svg>\n{svg}\n</previous_svg>")
        parts.append("위 그림을 아래 요청대로 고쳐 주세요. 요청하지 않은 부분(배치 · 글 · 양식)은 그대로 두고, "
                     f"고친 그림 전체를 같은 출력 형식으로 다시 내 주세요.\n<request>\n{_fence(params.get('instruction') or '')}\n</request>")
    elif mode == "content":
        parts.append("위 원고 내용을 독자가 한눈에 이해하도록 돕는 그림 하나를 그려 주세요. 내용의 구조(단계 · 관계 · 비교 · 분류 · "
                     "시간 순서 · 수치)에 가장 맞는 그림 종류를 고르세요."
                     + (f"\n추가 요청:\n<request>\n{_fence(desc)}\n</request>" if desc else ""))
    else:
        if not desc:
            raise ai.AIError("어떤 그림인지 설명해 주세요", "bad_request")
        parts.append(f"다음 그림을 그려 주세요.\n<request>\n{_fence(desc)}\n</request>")
    parts.append(f"그림 안의 글자와 캡션은 {lang}로 쓰세요.")
    return SYSTEM, "\n\n".join(parts)


# ---------------------------------------------------------------- 결과 읽기
_SVG_START = re.compile(r"<svg[\s>]", re.I)
_CAPTION_RE = re.compile(r"^[\s>*_#-]*(?:캡션|caption)[\s*_]*[:：]\s*(.+?)\s*$", re.I | re.M)
_KIND_RE = re.compile(r"^[\s>*_#-]*(?:그림\s*종류|figure\s*type)[\s*_]*[:：]\s*(.+?)\s*$", re.I | re.M)
_CAP_NUM = re.compile(r"^(?:그림|figure|fig\.)\s*\d+\s*[.:：]?\s*", re.I)


def clean_caption(text) -> str:
    t = re.sub(r"\s+", " ", str(text or "")).strip().strip("*_\"'“”` ")
    t = _CAP_NUM.sub("", t).strip()
    return t[:CAPTION_MAX]


def parse(text) -> dict:
    """CLI · API 원문 → {"svg", "caption", "kind_note", "check_needed"}. SVG가 없거나 쓸 수 없으면 AIError(bad_output)"""
    text = str(text or "")
    m = _SVG_START.search(text)
    end = text.lower().rfind("</svg>")
    if not m or end < m.start():
        raise ai.AIError("AI 응답에서 SVG 그림을 찾지 못했어요. 다시 만들어 주세요.", "bad_output")
    try:
        svg = sanitize_svg(text[m.start():end + len("</svg>")])
    except SvgError as e:
        raise ai.AIError(f"AI가 만든 그림을 쓸 수 없어요: {e}", "bad_output") from None
    head = text[:m.start()] + "\n" + text[end + len("</svg>"):]
    cap = _CAPTION_RE.search(head)
    kind = _KIND_RE.search(head)
    caption = clean_caption(cap.group(1)) if cap else ""
    return {"svg": svg, "caption": caption, "kind_note": re.sub(r"\s+", " ", kind.group(1)).strip()[:300] if kind else "",
            "check_needed": "[확인 필요]" in svg or "[확인 필요]" in caption}


def result_of(parsed: dict) -> dict:
    """작업 result로 남길 모양 (jobs._apply)"""
    return {k: parsed[k] for k in ("svg", "caption", "kind_note", "check_needed")}


def view(params: dict) -> dict:
    """작업 보기의 그림 정보 (화면: 고치기 사슬 · 원고 · 요청 글) — 고칠 SVG 원본(base_svg)은 넣지 않음(크기)"""
    return {"manuscript_id": params.get("manuscript_id"), "mode": params.get("mode"),
            "description": str(params.get("description") or "")[:DESC_MAX],
            "instruction": str(params.get("instruction") or "")[:INSTR_MAX],
            "has_content": bool(params.get("content")), "content_head": str(params.get("content") or "")[:200],
            "parent_job_id": params.get("parent_job_id"), "chain": list(params.get("chain") or [])[-CHAIN_MAX:],
            "base_figure": params.get("base_figure"), "lang": params.get("lang") or "ko"}


def make_params(data: dict, *, manuscript_id: int, base: dict | None = None) -> dict:
    """POST /api/ai/figure 본문 → 작업 params. 틀리면 ValueError(화면 문구 → 400).
    base = 고칠 그림 {"svg", "caption", "parent_job_id", "chain", "description", "content", "base_figure"} (서버가 읽어 줌)"""
    mode = data.get("mode")
    if not isinstance(mode, str) or mode not in MODES:
        raise ValueError("알 수 없는 그림 요청이에요")
    desc = str(data.get("description") or "").strip()[:DESC_MAX]
    content = str(data.get("content") or "").strip()[:CONTENT_MAX]
    instruction = str(data.get("instruction") or "").strip()[:INSTR_MAX]
    lang = "en" if data.get("lang") == "en" else "ko"
    params = {"manuscript_id": manuscript_id, "mode": mode, "description": desc, "content": content, "lang": lang,
              "instruction": "", "parent_job_id": None, "chain": [], "base_figure": None}
    if mode == "describe" and not desc:
        raise ValueError("어떤 그림인지 설명해 주세요")
    if mode == "content" and len(content) < 10:
        raise ValueError("그림으로 만들 원고 내용을 고르거나 문단에 커서를 두세요")
    if mode == "edit":
        if not instruction:
            raise ValueError("어떻게 고칠지 적어 주세요")
        if not base or not base.get("svg"):
            raise ValueError("고칠 그림이 없어요")
        params.update(instruction=instruction, base_svg=sanitize_svg(base["svg"]),
                      base_caption=clean_caption(data.get("caption") if data.get("caption") is not None else base.get("caption")),
                      parent_job_id=base.get("parent_job_id"), chain=list(base.get("chain") or [])[-CHAIN_MAX:],
                      base_figure=base.get("base_figure"),
                      description=desc or str(base.get("description") or "")[:DESC_MAX],
                      content=content or str(base.get("content") or "")[:CONTENT_MAX])
    return params


def chain_after(parent: dict) -> list:
    """고치기 사슬: 지난 작업의 사슬 + 지난 작업 id (오래된 것부터, 최대 CHAIN_MAX)"""
    chain = [c for c in ((parent.get("params") or {}).get("chain") or []) if isinstance(c, int) and not isinstance(c, bool)]
    return (chain + [parent["id"]])[-CHAIN_MAX:]


# ---------------------------------------------------------------- API (server.py가 등록)
def register(app, Ctx, H) -> None:
    """POST /api/ai/figure — H: need_manuscript(ctx, mid) · new_job(ctx, kind, params, paper_id) → (view, created)"""
    from fastapi import Body, HTTPException
    from fastapi.responses import JSONResponse

    from . import figures, jobs
    from .storage import NotFound, StorageKeyError

    @app.post("/api/ai/figure")
    def ai_figure(data: dict = Body(...), ctx=Ctx):
        """그림 만들기 · 고치기 = 백그라운드 작업 (202 {job, note}). 창을 닫아도 내 PC · 내 API 키가 끝까지 실행하고,
        결과(result.svg · caption)는 작업에 남는다(30일). 고치기는 지난 그림 작업(parent_job_id) 또는 원고 그림의 SVG 원본(base_figure)"""
        mid = data.get("manuscript_id")
        if not jobs.valid_id(mid):
            raise HTTPException(400, "원고 번호가 올바르지 않아요")
        H.need_manuscript(ctx, mid)
        base = None
        if data.get("mode") == "edit":
            pid, fig = data.get("parent_job_id"), data.get("base_figure")
            if pid is not None:
                if not jobs.valid_id(pid):
                    raise HTTPException(400, "고칠 그림 작업 번호가 올바르지 않아요")
                row = ctx.lib._one("select id, params, result, status from paperlab.jobs where id = %s and user_id = %s "
                                   "and kind = 'figure'", (pid, ctx.uid))
                res = (row or {}).get("result") or {}
                if not row or row["status"] != "succeeded" or not isinstance(res, dict) or not res.get("svg"):
                    raise HTTPException(404, "고칠 그림을 찾을 수 없어요")
                p = row["params"] or {}
                base = {"svg": res["svg"], "caption": res.get("caption") or "", "parent_job_id": row["id"],
                        "chain": chain_after(row), "description": p.get("description") or "", "content": p.get("content") or "",
                        "base_figure": p.get("base_figure")}
            elif isinstance(fig, str) and figures.NAME_RE.fullmatch(fig):
                try:
                    raw = ctx.storage.get(ctx.storage.figure_svg_key(mid, figures.svg_name(fig)))
                except (NotFound, StorageKeyError):
                    raise HTTPException(404, "이 그림에는 고칠 수 있는 원본(SVG)이 없어요") from None
                base = {"svg": raw.decode("utf-8", "replace"), "caption": data.get("caption") or "", "base_figure": fig}
            else:
                raise HTTPException(400, "고칠 그림을 골라 주세요")
        try:
            params = make_params(data, manuscript_id=mid, base=base)
        except SvgError as e:
            raise HTTPException(400, f"고칠 그림을 읽지 못했어요: {e}") from None
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        view_, _ = H.new_job(ctx, "figure", params, None)
        return JSONResponse({"job": view_, "note": route_note(view_.get("route") or [])}, status_code=202)
