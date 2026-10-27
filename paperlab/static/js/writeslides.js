// 발표 자료 (2026-10-27): AI 답(JSON) 읽기 · AI 결과 패널 미리보기 HTML — 순수 함수. PPT 파일은 서버(paperlab/slides.py)가 만든다
export function parseSlides(text) {
  const s = String(text ?? "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  let d;
  try { d = JSON.parse(s.slice(a, b + 1)); } catch { return null; }
  if (!d || !Array.isArray(d.slides) || !d.slides.length) return null;
  return d;
}

/** 패널에 보일 슬라이드 목록 (esc는 화면의 이스케이프 함수) — 읽지 못하면 null(마크다운 그대로 보임) */
export function slidesHtml(text, esc) {
  const d = parseSlides(text);
  if (!d) return null;
  const slides = d.slides.map((sl, i) => `<li><b>${i + 1}. ${esc(sl.title || "")}</b>
    ${(sl.bullets || []).length ? `<ul>${sl.bullets.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    ${sl.notes ? `<p class="small muted">🗣 ${esc(sl.notes)}</p>` : ""}</li>`).join("");
  const qs = (d.questions || []).map((q) => `<li><b>${esc(q.q || "")}</b>${q.a ? `<br><span class="small muted">→ ${esc(q.a)}</span>` : ""}</li>`).join("");
  return `<h3>${esc(d.title || "발표 자료")}</h3><ol class="deck">${slides}</ol>${qs ? `<h4>예상 질문</h4><ol>${qs}</ol>` : ""}`;
}
