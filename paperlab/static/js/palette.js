// 명령 팔레트 (Ctrl+K · ⌘K — 2026-10-28 사용자 요청): 기능 이름 · 초성(ㅁㅊㅂ)으로 찾아 바로 실행.
// 화면마다 registerCommands(이름, () => [{ label, sub?, group?, keys?, action }])로 명령을 내놓고, 사이드바 메뉴는 자동으로 들어간다.
// 고르면 팔레트를 닫고 원래 초점(편집기 커서 · 선택)을 되돌린 뒤 실행한다. 최근 쓴 명령은 빈 검색에서 맨 위
const providers = new Map();
const RECENT_KEY = "paperlab.paletteRecent";
const RECENT_MAX = 8;
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

/** 명령 내놓기 — 돌려준 함수를 부르면 뺀다(화면을 닫을 때) */
export function registerCommands(key, fn) {
  providers.set(key, fn);
  return () => { if (providers.get(key) === fn) providers.delete(key); };
}

/** 한글 → 초성 (그 밖의 글자는 그대로) */
export function chosung(s) {
  return [...String(s ?? "")].map((ch) => {
    const c = ch.charCodeAt(0) - 0xac00;
    return c >= 0 && c < 11172 ? CHO[Math.floor(c / 588)] : ch;
  }).join("");
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[\s·…:()（）]+/g, "");
const isCho = (q) => /^[ㄱ-ㅎ]+$/.test(q);

// 글자가 순서대로 다 들어 있으면(사이에 다른 글자 허용) 그 흩어짐 정도, 아니면 -1
function subseq(q, t) {
  let k = 0;
  let gaps = 0;
  let last = -1;
  for (let i = 0; i < t.length && k < q.length; i++) {
    if (t[i] === q[k]) { if (last >= 0) gaps += i - last - 1; last = i; k++; }
  }
  return k === q.length ? gaps : -1;
}

/** 검색어와 명령의 맞음 점수 (클수록 앞, 안 맞으면 -1) — 이름 > 초성 > 설명 · 묶음, 앞에서 맞을수록 · 붙어 있을수록 높게 */
export function matchScore(query, cmd) {
  const q = norm(query);
  if (!q) return 0;
  const label = norm(cmd.label);
  const cho = isCho(q) ? chosung(label) : null;
  const target = cho || label;
  const at = target.indexOf(q);
  if (at === 0) return 1000 - target.length;
  if (at > 0) return 800 - at;
  const gaps = subseq(q, target);
  if (gaps >= 0 && gaps <= q.length * 3) return 500 - gaps;
  const extra = norm(`${cmd.group || ""}${cmd.sub || ""}${cmd.keys || ""}`);
  const ex = cho ? chosung(extra) : extra;
  if (ex.includes(q)) return 300;
  return -1;
}

/** 검색어로 거르고 줄 세운 명령 (같은 점수면 최근 쓴 것 · 원래 순서) */
export function rankCommands(query, cmds, recent = [], limit = 60) {
  const rec = (c) => { const k = recent.indexOf(c.label); return k < 0 ? 0 : RECENT_MAX - k; };
  return cmds.map((c, i) => ({ c, i, s: matchScore(query, c) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => (b.s - a.s) || (rec(b.c) - rec(a.c)) || (a.i - b.i))
    .slice(0, limit).map((x) => x.c);
}

// 사이드바 메뉴(논문 찾기 · 논문 쓰기 · 서재 · 폴더 · 컬렉션 …)와 설정 · 밝기
function sidebarCommands() {
  if (typeof document === "undefined") return [];
  const out = [];
  for (const b of document.querySelectorAll("#sidebar .nav-item")) {
    const label = [...b.childNodes].filter((n) => n.nodeType === 3 || (n.nodeType === 1 && !n.classList.contains("count") && n.tagName !== "svg"))
      .map((n) => n.textContent).join("").trim();
    if (!label) continue;
    const where = b.closest("#folder-tree") ? "폴더" : b.closest("#collection-tree") ? "컬렉션" : b.closest("#tag-list") ? "태그" : "이동";
    out.push({ label: where === "이동" ? label : `${where}: ${label}`, group: where, action: () => b.click() });
  }
  const set = document.getElementById("open-settings");
  if (set) out.push({ label: "설정", group: "앱", action: () => set.click() });
  const theme = document.getElementById("theme-toggle");
  if (theme) out.push({ label: "밝게 · 어둡게 바꾸기", group: "앱", action: () => theme.click() });
  return out;
}

function loadRecent() {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}
function saveRecent(label) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([label, ...loadRecent().filter((x) => x !== label)].slice(0, RECENT_MAX))); } catch { /* 저장소 없음 */ }
}

const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let open = null;

/** 팔레트 열기 (이미 열려 있으면 닫기) */
export function openPalette() {
  if (open) { open.close(); return; }
  const before = document.activeElement;
  const sel = before && "selectionStart" in before ? [before.selectionStart, before.selectionEnd] : null;
  const cmds = [];
  for (const fn of providers.values()) {
    try { for (const c of fn() || []) if (c && c !== "-" && c.label && typeof c.action === "function") cmds.push(c); } catch { /* 한 화면의 오류로 팔레트를 막지 않음 */ }
  }
  cmds.push(...sidebarCommands());
  const recent = loadRecent();
  const wrap = document.createElement("div");
  wrap.className = "palette-wrap";
  wrap.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="명령 팔레트">
    <input class="palette-input" type="text" placeholder="기능 찾기 — 이름이나 초성(예: ㅁㅊㅂ → 맞춤법)" aria-label="기능 찾기" autocomplete="off" spellcheck="false"
      role="combobox" aria-expanded="true" aria-controls="palette-list">
    <ul class="palette-list" id="palette-list" role="listbox"></ul>
    <div class="palette-foot small muted">↑↓ 고르기 · Enter 실행 · Esc 닫기</div></div>`;
  document.body.append(wrap);
  const input = wrap.querySelector("input");
  const list = wrap.querySelector("ul");
  let shown = [];
  let active = 0;
  const draw = () => {
    const q = input.value;
    shown = q.trim() ? rankCommands(q, cmds, recent)
      : [...recent.map((l) => cmds.find((c) => c.label === l)).filter(Boolean), ...cmds.filter((c) => !recent.includes(c.label))].slice(0, 60);
    active = Math.min(active, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length ? shown.map((c, i) => `<li role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === active}" class="${i === active ? "active" : ""}">
      <span class="palette-label">${escHtml(c.label.replace(/…$/, ""))}</span>${c.sub ? `<span class="palette-sub">${escHtml(c.sub)}</span>` : ""}
      ${c.keys ? `<kbd>${escHtml(c.keys)}</kbd>` : ""}<span class="palette-group">${escHtml(!q.trim() && recent.includes(c.label) ? "최근" : c.group || "")}</span></li>`).join("")
      : `<li class="palette-empty muted">맞는 기능이 없어요</li>`;
    input.setAttribute("aria-activedescendant", shown.length ? `pal-${active}` : "");
    const cur = list.querySelector("li.active");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  };
  const close = (restore = true) => {
    wrap.remove();
    open = null;
    if (restore && before && before.isConnected && typeof before.focus === "function") {
      before.focus();
      if (sel) try { before.setSelectionRange(sel[0], sel[1]); } catch { /* 고를 수 없는 칸 */ }
    }
  };
  const run = (c) => {
    if (!c) return;
    close();
    saveRecent(c.label);
    setTimeout(() => { try { c.action(); } catch (e) { console.error(e); } }, 0);
  };
  input.addEventListener("input", () => { active = 0; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = (active + 1) % Math.max(1, shown.length); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = (active - 1 + shown.length) % Math.max(1, shown.length); draw(); }
    else if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); run(shown[active]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  }); // Ctrl+K 다시 누르기 = 닫기는 app.js의 창 단축키가 openPalette()로
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) run(shown[Number(li.dataset.i)]); });
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
  open = { close };
  draw();
  input.focus();
}

export const paletteOpen = () => !!open;
