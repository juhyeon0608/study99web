// 논문 쓰기 수식 (2026-10-17): 줄 수식 $$ … $$ {#eq:이름} (오른쪽 번호 (1) · 장마다면 (2-1) · @eq:이름 → "식 (1)"),
// 문장 안 수식 $ … $. 미리보기는 KaTeX, 워드 · 한글 내보내기는 수식 + 번호를 그린 PNG(그림으로 넣음 — 그림 목차에는 안 들어감),
// 문장 안 수식은 내보낼 때 x₁ · α · ≤ 같은 글자로 바꾼다(texToText).

const LABEL = "[\\p{L}\\p{N}_-]+";
// 한 문단 전체가 $$ … $$ (여러 줄 가능) + 꼬리표 {#eq:이름}
const EQ_BLOCK_RE = new RegExp(`^\\$\\$([\\s\\S]+?)\\$\\$\\s*(?:\\{#(eq:${LABEL})\\})?\\s*$`, "u");
// 문장 안 수식 $…$: 여는 $ 뒤 · 닫는 $ 앞에 빈칸 없음, $$ 아님, 닫는 $ 바로 뒤가 숫자면 금액($5)으로 봄
export const INLINE_MATH_RE = /(?<![\\$\p{L}\p{N}])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?![\p{N}$])/gu;
const MARK_L = "";
const MARK_R = "";
export const MATH_MARK_RE = /(\d+)/;

export function equationInfo(text) {
  const m = String(text || "").trim().match(EQ_BLOCK_RE);
  return m && m[1].trim() ? { tex: m[1].trim(), label: m[2] || "" } : null;
}

// 문장 안 수식을 자리표시로 바꿔 둔다(마크다운이 _ · * 를 기울임으로 읽지 않게). 코드 블록(``` · ~~~) 안은 그대로
export function protectInlineMath(src) {
  const maths = [];
  let fence = false;
  const text = String(src).split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return line; }
    if (fence || /^\s*\$\$/.test(line) || /\$\$\s*(\{#eq:[^}]*\})?\s*$/.test(line)) return line;
    return line.replace(INLINE_MATH_RE, (_, tex) => `${MARK_L}${maths.push(tex) - 1}${MARK_R}`);
  }).join("\n");
  return { text, maths };
}

const GREEK = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ",
  iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ",
  phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω" };
const SYMBOLS = { times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠",
  approx: "≈", sim: "∼", equiv: "≡", infty: "∞", sum: "∑", prod: "∏", int: "∫", partial: "∂", nabla: "∇", to: "→",
  rightarrow: "→", leftarrow: "←", Rightarrow: "⇒", Leftrightarrow: "⇔", in: "∈", notin: "∉", subset: "⊂", cup: "∪", cap: "∩",
  forall: "∀", exists: "∃", ldots: "…", cdots: "⋯", circ: "∘", degree: "°", sqrt: "√", propto: "∝", perp: "⊥" };
const SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "=": "⁼",
  "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", T: "ᵀ" };
const SUB = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "=": "₌",
  "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", i: "ᵢ", j: "ⱼ", k: "ₖ", n: "ₙ", o: "ₒ", t: "ₜ", x: "ₓ" };
const script = (s, map, mark) => ([...s].every((c) => map[c]) ? [...s].map((c) => map[c]).join("") : `${mark}(${s})`);

// 간단한 TeX → 글자 (내보내기의 문장 안 수식). 못 바꾸는 명령은 이름만 남긴다
export function texToText(tex) {
  let s = String(tex || "");
  for (let k = 0; k < 4; k++) s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)").replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
  s = s.replace(/\\(?:mathrm|mathbf|mathit|text|operatorname)\s*\{([^{}]*)\}/g, "$1");
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => GREEK[name] || SYMBOLS[name] || name);
  s = s.replace(/\^\{([^{}]*)\}|\^(\S)/g, (_, a, b) => script(a ?? b, SUP, "^"));
  s = s.replace(/_\{([^{}]*)\}|_(\S)/g, (_, a, b) => script(a ?? b, SUB, "_"));
  return s.replace(/[{}]/g, "").replace(/\\[,;:! ]/g, " ").replace(/\s+/g, " ").trim();
}

export function katexHtml(tex, display) {
  try {
    return window.katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore", output: "html" });
  } catch {
    return `<code>${String(tex).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</code>`;
  }
}

// ---------------------------------------------------------------- 내보내기용 PNG (수식 + 오른쪽 번호, 본문 폭)
// KaTeX HTML을 글꼴을 품은 SVG(foreignObject)로 그려 캔버스 → PNG. 300dpi 기준 본문 폭 150mm = 1772px, 11pt ≈ 46px
let cssCache = null;
async function katexCss() {
  if (cssCache) return cssCache;
  const base = "/static/vendor/katex/";
  let css = await (await fetch(`${base}katex.min.css`)).text();
  const names = [...new Set([...css.matchAll(/url\(fonts\/([^)]+\.woff2)\)/g)].map((m) => m[1]))];
  const data = {};
  await Promise.all(names.map(async (n) => {
    const buf = new Uint8Array(await (await fetch(`${base}fonts/${n}`)).arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    data[n] = `data:font/woff2;base64,${btoa(bin)}`;
  }));
  css = css.replace(/url\(fonts\/([^)]+\.woff2)\)/g, (m, n) => `url(${data[n]})`).replace(/,\s*url\(fonts\/[^)]+\)\s*format\("(?:woff|truetype)"\)/g, "");
  cssCache = css;
  return css;
}

export async function equationPng(tex, num, { width = 1772, font = 46 } = {}) {
  const css = await katexCss();
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-99999px;top:0;width:${width}px;font-size:${font}px;color:#000;background:#fff`;
  host.innerHTML = katexHtml(tex, true);
  document.body.append(host);
  await document.fonts.ready;
  const h = Math.ceil(host.getBoundingClientRect().height) + Math.round(font * 0.6);
  const xml = new XMLSerializer().serializeToString(host.firstElementChild || host);
  host.remove();
  const no = num ? `<div style="position:absolute;right:0;top:0;height:100%;display:flex;align-items:center;font-family:'Times New Roman',serif">(${num})</div>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}"><foreignObject x="0" y="0" width="100%" height="100%">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${width}px;height:${h}px;font-size:${font}px;color:#000;display:flex;align-items:center;justify-content:center">`
    + `<style>${css.replace(/</g, "\\3c ")}.katex-display{margin:0}</style>${xml}${no}</div></foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = h;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, width, h);
  g.drawImage(img, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("수식을 그리지 못했어요");
  return new File([blob], "equation.png", { type: "image/png" });
}
