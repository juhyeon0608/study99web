// 오른쪽 창 폭 조절 (2026-10-26 AI 결과 · 그림 패널 → 2026-11-07 사용자 요청 "오른쪽에 따로 뜨는 창은 다"):
// 창 왼쪽 가장자리 손잡이를 끌면 넓어지고 좁아진다. ← → 키로 20px씩, 두 번 누르면 기본 폭.
// 폭은 host의 CSS 변수(cssVar)로 — 격자 칸 · 고정 창 CSS가 var(cssVar, 기본 폭)으로 쓴다. 창마다 이 브라우저에 기억(key)
import { el } from "./ui.js";
import { PANE_MIN_W, browserStorage, clampPaneWidth, paneWidthCss } from "./writeai.js";

export function loadWidth(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? clampPaneWidth(raw) : null;
  } catch {
    return null;
  }
}
export function saveWidth(storage, key, w) {
  try {
    if (w == null) storage.removeItem(key);
    else storage.setItem(key, String(clampPaneWidth(w)));
  } catch { /* 저장 못 함 — 이번만 */ }
}

// CSS 폭: 고른 폭이되 창이 좁아지면 room(옆 칸 자리)을 남기고 줄어듦(최소 PANE_MIN_W)
export function widthCss(w, room = "") {
  return room ? `clamp(${PANE_MIN_W}px, ${clampPaneWidth(w)}px, max(${PANE_MIN_W}px, 100vw - ${room}))` : paneWidthCss(w);
}

// panes: 손잡이를 붙일 창들(같은 폭을 함께 씀), host: CSS 변수를 둘 요소, key: localStorage 키,
// room: 남길 자리(CSS 길이 식 — 없으면 편집기 560px)
export function paneResizer(panes, { host, cssVar, key, label = "창 폭 조절", room = "" }) {
  const st = browserStorage();
  const apply = (w) => (w == null ? host.style.removeProperty(cssVar) : host.style.setProperty(cssVar, widthCss(w, room)));
  apply(st && loadWidth(st, key));
  const cur = (pane) => Math.round(pane.getBoundingClientRect().width);
  const commit = (w) => { const c = w == null ? null : clampPaneWidth(w); apply(c); if (st) saveWidth(st, key, c); };
  for (const pane of panes) {
    if (!pane || pane.querySelector(":scope > .pane-resize")) continue;
    const h = el(`<div class="pane-resize" role="separator" aria-orientation="vertical" tabindex="0"
      aria-label="${label}" title="끌어서 창 폭 바꾸기 · 두 번 누르면 기본 폭 (← → 키도 됨)"></div>`);
    pane.prepend(h);
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const right = pane.getBoundingClientRect().right;
      h.setPointerCapture(e.pointerId);
      document.body.classList.add("pane-resizing");
      const move = (ev) => apply(clampPaneWidth(right - ev.clientX));
      const up = () => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
        document.body.classList.remove("pane-resizing");
        commit(cur(pane)); // 창 폭 때문에 줄어든 만큼이 아니라 실제로 보이는 폭을 기억
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
    h.addEventListener("dblclick", () => commit(null));
    h.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: 20, ArrowRight: -20 }[e.key];
      if (!d) return;
      e.preventDefault();
      commit(cur(pane) + d);
    });
  }
}
