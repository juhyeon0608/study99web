// 논문 쓰기 도구 (화면 — docs/specs/writing-figures-tables.md): 편집 적용(실행 취소 되게) · 그림 올리기 · 보이기 ·
// 표 고치기 창 · 단축키 도움말 창. 글을 바꾸는 규칙(순수 함수)은 writeedit.js에 있다.

import { api } from "./api.js";
import { $, $$, el, esc, modal, toast } from "./ui.js";
import { jpegNeedsReencode, shortcutHelp } from "./writeedit.js";

const MAC = /Mac|iPhone|iPad/.test(navigator.platform || "");
export const FIGURE_MAX = 10 * 1024 * 1024; // 서버 figures.MAX_FIGURE_BYTES와 같게
const DIRECT_TYPES = ["image/png", "image/jpeg", "image/gif"]; // 워드 · 한글이 바로 읽는 형식 — 나머지는 PNG로 바꿔 올림
const MAX_ROWS = 200;
const MAX_COLS = 12;

// ------------------------------------------------------------- 편집 적용
// 실행 취소(Ctrl+Z)에 남도록 execCommand("insertText")로 바꾸고, 안 되는 브라우저면 setRangeText + input 이벤트
export function applyEdit(ta, edit) {
  if (!edit) return false;
  ta.focus();
  if (edit.from !== edit.to || edit.text) {
    ta.setSelectionRange(edit.from, edit.to);
    const before = ta.value;
    let ok = false;
    try {
      ok = edit.text ? document.execCommand("insertText", false, edit.text) : document.execCommand("delete");
    } catch { ok = false; }
    const expect = before.slice(0, edit.from) + edit.text + before.slice(edit.to);
    if (!ok || ta.value !== expect) {
      ta.value = expect;
      ta.dispatchEvent(new Event("input"));
    }
  }
  ta.setSelectionRange(edit.selStart, edit.selEnd);
  return true;
}

// ------------------------------------------------------------- 그림
async function reencode(file, type, ext) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("이 그림 형식은 넣을 수 없어요. PNG · JPEG · GIF로 저장해 주세요"); }
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) throw new Error("그림을 바꾸지 못했어요");
  return new File([blob], `${(file.name || "image").replace(/\.[^.]+$/, "")}.${ext}`, { type });
}

async function toUploadable(file) {
  if (file.type === "image/jpeg") {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    return jpegNeedsReencode(head) ? reencode(file, "image/jpeg", "jpg") : file;
  }
  if (DIRECT_TYPES.includes(file.type)) return file;
  // WebP · BMP · AVIF 등은 브라우저에서 PNG로 바꾼다(워드 · 한글이 못 읽는 형식)
  return reencode(file, "image/png", "png");
}

// 그림 한 장 올리기 → { name, ref, width, height, size }
export async function uploadFigure(mid, file) {
  const f = await toUploadable(file);
  if (f.size > FIGURE_MAX) throw new Error("그림이 너무 커요 (10MB 초과)");
  const fd = new FormData();
  fd.append("file", f, f.name || "image.png");
  return api.post(`/api/manuscripts/${mid}/figures`, fd);
}

export const imageFiles = (list) => [...(list || [])].filter((f) => f && /^image\//.test(f.type));

// 그림 주소: 인증이 필요한 API라 blob으로 받아 blob: 주소로 보인다(CSP img-src blob:). 원고를 닫으면 풀어 준다
const URLS = new Map(); // "원고id/이름" → Promise<주소 | null>

export function figureUrl(mid, name) {
  const key = `${mid}/${name}`;
  if (!URLS.has(key)) {
    URLS.set(key, api.raw("GET", `/api/manuscripts/${mid}/figures/${encodeURIComponent(name)}`)
      .then(async (res) => {
        if (res.ok) return URL.createObjectURL(await res.blob());
        if (res.status !== 404) URLS.delete(key); // 잠깐의 오류는 다음 미리보기에서 다시
        return null;
      })
      .catch(() => { URLS.delete(key); return null; }));
  }
  return URLS.get(key);
}

export function revokeFigureUrls() {
  for (const p of URLS.values()) p.then((u) => u && URL.revokeObjectURL(u)).catch(() => {});
  URLS.clear();
}

// 미리보기의 <img data-fig="이름">에 그림을 채운다 (없으면 안내 글)
export function hydrateFigures(root, mid) {
  for (const img of $$("img[data-fig]", root)) {
    figureUrl(mid, img.dataset.fig).then((u) => {
      if (!img.isConnected) return;
      if (u) img.src = u;
      else img.replaceWith(el(`<div class="doc-fig-missing">그림을 찾을 수 없어요</div>`));
    });
  }
}

// ------------------------------------------------------------- 표 고치기 창
// table = { rows: [[칸…]…], align, caption, label } (writeedit.findTables · newTable 모양)
// → { action: "save", table } | { action: "delete" } | null(취소)
// ko · chapter: 캡션 번호 안내(표 1 · 표 2-1), setChapter: [장마다 번호로] — 표지 정보의 그림 · 표 번호 설정을 바꿈(writing.js)
// 떠 있는 창(floating): 뒤 화면을 막지 않아 참고 문서를 보며 고칠 수 있고, 머리줄을 끌어 옮긴다 (2026-10-26 사용자 요청)
export function tableDialog(table, { existing = false, ko = true, chapter = false, setChapter = null } = {}) {
  return new Promise((resolve) => {
    const t = { rows: table.rows.map((r) => [...r]), align: [...(table.align || [])], caption: table.caption || "",
      label: (table.label || "").replace(/^tbl:/, "") };
    let cur = { r: Math.min(1, t.rows.length - 1), c: 0 };
    const word = ko ? "표" : "Table";
    const capHint = (ch) => (ch ? `표 위에 "${esc(word)} 2-1. 제목"처럼 장 번호와 함께 들어가요 (제1장 앞은 1, 2, …)`
      : `표 위에 "${esc(word)} 1. 제목"으로 들어가요 — 처음부터 이어 매기는 번호예요`);
    const body = el(`<div class="tbl-dlg">
      <div class="grid-2">
        <div class="field"><label for="tbl-cap">표 제목 (캡션)</label><input class="input" id="tbl-cap" data-cap aria-describedby="tbl-cap-hint">
          <div class="hint small muted" id="tbl-cap-hint" style="margin-top:4px"><span data-cap-hint></span>
            <button type="button" class="btn sm ghost" data-chapter style="margin-left:4px;height:22px;padding:0 6px"
              title="그림 · 표 번호를 장마다 새로 매겨요 (표지 정보 → 그림 · 표 번호)">장마다 번호(2-1)로</button></div></div>
        <div class="field"><label for="tbl-label">참조 이름 (선택)</label><input class="input" id="tbl-label" data-label placeholder="예: result" aria-describedby="tbl-label-hint">
          <div class="hint small muted" id="tbl-label-hint" style="margin-top:4px">본문에 @tbl:이름 으로 쓰면 "${esc(word)} 1"처럼 번호로 바뀌어요</div></div>
      </div>
      <div class="row tbl-tools" role="toolbar" aria-label="표 편집">
        <button type="button" class="btn sm" data-op="row-above">위에 줄 추가</button>
        <button type="button" class="btn sm" data-op="row-below">아래에 줄 추가</button>
        <button type="button" class="btn sm" data-op="row-del">줄 삭제</button>
        <span class="sep"></span>
        <button type="button" class="btn sm" data-op="col-left">왼쪽에 칸 추가</button>
        <button type="button" class="btn sm" data-op="col-right">오른쪽에 칸 추가</button>
        <button type="button" class="btn sm" data-op="col-del">칸 삭제</button>
        <span class="sep"></span>
        <span class="small muted">내용 정렬</span>
        <span class="seg" data-align aria-label="이 열의 내용 정렬 (머리글은 늘 가운데)" title="이 열의 내용 칸 정렬이에요. 머리글 줄은 늘 가운데예요"><button type="button" data-a="left">왼쪽</button><button type="button" data-a="center">가운데</button><button type="button" data-a="right">오른쪽</button></span>
      </div>
      <div class="tbl-grid-wrap"><table class="tbl-grid"></table></div>
      <p class="small muted" style="margin:6px 0 0">첫 줄은 머리글(굵게 · 가운데)이에요. <b>Shift+Enter</b>는 칸 안 줄바꿈, Enter는 아래 칸, Tab은 다음 칸으로 가요. 칸 안의 | 글자도 그대로 넣을 수 있어요. 창은 제목 줄을 끌어 옮길 수 있고, 뒤 화면도 그대로 볼 수 있어요.</p>
    </div>`);
    const foot = el(`<div style="display:contents"><div class="left">${existing ? `<button class="btn danger" data-del>표 삭제</button>` : ""}</div>
      <button class="btn" data-no>취소</button><button class="btn primary" data-ok>${existing ? "저장" : "넣기"}</button></div>`);
    let result = null;
    const m = modal({ title: existing ? "표 고치기" : "표 넣기", body, foot, wide: true, floating: true, onClose: () => resolve(result) });
    $("[data-cap]", body).value = t.caption;
    $("[data-label]", body).value = t.label;
    const drawHint = (ch) => {
      $("[data-cap-hint]", body).textContent = capHint(ch);
      $("[data-chapter]", body).hidden = ch || !setChapter;
    };
    drawHint(chapter);
    $("[data-chapter]", body).onclick = async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      if (setChapter && await setChapter()) drawHint(true);
      b.disabled = false;
    };
    const grid = $(".tbl-grid", body);
    const read = () => {
      for (const inp of $$("textarea[data-r]", grid)) t.rows[Number(inp.dataset.r)][Number(inp.dataset.c)] = inp.value;
    };
    // 칸 높이를 글 줄 수에 맞춤 (CSS field-sizing을 모르는 브라우저용)
    const fit = (inp) => {
      if (globalThis.CSS && CSS.supports && CSS.supports("field-sizing", "content")) return;
      inp.style.height = "auto";
      inp.style.height = String(inp.scrollHeight + 2) + "px";
    };
    grid.addEventListener("input", (e) => { if (e.target.matches("textarea[data-r]")) fit(e.target); });
    const draw = (focus = true) => {
      const cols = t.rows[0].length;
      grid.innerHTML = t.rows.map((row, r) => `<tr>${row.map((_, c) => `<td><textarea class="input ${r === 0 ? "head" : ""}" rows="1" data-r="${r}" data-c="${c}"
        aria-label="${esc(`${r === 0 ? "머리글" : `${r}줄`} ${c + 1}칸`)}" style="text-align:${esc(t.align[c] || "left")}"></textarea></td>`).join("")}</tr>`).join("");
      for (const inp of $$("textarea[data-r]", grid)) { inp.value = t.rows[Number(inp.dataset.r)][Number(inp.dataset.c)] ?? ""; fit(inp); }
      $("[data-op=row-del]", body).disabled = t.rows.length <= 1;
      $("[data-op=col-del]", body).disabled = cols <= 1;
      for (const op of ["row-above", "row-below"]) $(`[data-op=${op}]`, body).disabled = t.rows.length >= MAX_ROWS;
      for (const op of ["col-left", "col-right"]) $(`[data-op=${op}]`, body).disabled = cols >= MAX_COLS;
      cur = { r: Math.min(cur.r, t.rows.length - 1), c: Math.min(cur.c, cols - 1) };
      $$("[data-align] button", body).forEach((b) => b.classList.toggle("active", (t.align[cur.c] || "left") === b.dataset.a));
      if (focus) $(`textarea[data-r="${cur.r}"][data-c="${cur.c}"]`, grid)?.focus();
    };
    grid.addEventListener("focusin", (e) => {
      const inp = e.target.closest("textarea[data-r]");
      if (!inp) return;
      cur = { r: Number(inp.dataset.r), c: Number(inp.dataset.c) };
      $$("[data-align] button", body).forEach((b) => b.classList.toggle("active", (t.align[cur.c] || "left") === b.dataset.a));
    });
    const nextRow = () => {
      read();
      if (cur.r === t.rows.length - 1) {
        if (t.rows.length >= MAX_ROWS) return;
        t.rows.push(Array(t.rows[0].length).fill(""));
      }
      cur.r++;
      draw();
    };
    let shiftEnter = false;
    grid.addEventListener("keydown", (e) => {
      const inp = e.target.closest("textarea[data-r]");
      shiftEnter = e.key === "Enter" && e.shiftKey;
      if (!inp || e.key !== "Enter") return;
      if (e.shiftKey || e.isComposing || e.keyCode === 229) return; // Shift+Enter = 칸 안 줄바꿈 · 한글 조합 중은 아래 input에서
      e.preventDefault();
      nextRow();
    });
    // 한글 조합 중 Enter처럼 keydown에서 못 막고 브라우저가 줄을 바꾼 경우: 그 줄바꿈을 지우고 아래 칸으로
    grid.addEventListener("input", (e) => {
      const inp = e.target.closest("textarea[data-r]");
      if (!inp || e.inputType !== "insertLineBreak" || shiftEnter) return;
      const p = inp.selectionStart;
      if (inp.value[p - 1] === "\n") inp.value = inp.value.slice(0, p - 1) + inp.value.slice(p);
      nextRow();
    });
    $(".tbl-tools", body).addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      read();
      const cols = t.rows[0].length;
      const op = b.dataset.op;
      if (op === "row-above" || op === "row-below") {
        const at = cur.r + (op === "row-below" ? 1 : 0);
        t.rows.splice(Math.max(1, at), 0, Array(cols).fill("")); // 머리글 위에는 넣지 않음
        cur.r = Math.max(1, at);
      } else if (op === "row-del" && t.rows.length > 1) {
        t.rows.splice(cur.r, 1);
      } else if (op === "col-left" || op === "col-right") {
        const at = cur.c + (op === "col-right" ? 1 : 0);
        t.rows.forEach((r) => r.splice(at, 0, ""));
        t.align.splice(at, 0, null);
        cur.c = at;
      } else if (op === "col-del" && cols > 1) {
        t.rows.forEach((r) => r.splice(cur.c, 1));
        t.align.splice(cur.c, 1);
      } else if (b.dataset.a) {
        t.align[cur.c] = b.dataset.a === "left" ? null : b.dataset.a;
      }
      draw();
    });
    $("[data-no]", foot).onclick = () => m.close();
    $("[data-ok]", foot).onclick = () => {
      read();
      const label = $("[data-label]", body).value.trim().replace(/^tbl:/, "");
      if (label && !/^[\p{L}\p{N}_-]+$/u.test(label)) return toast("참조 이름은 글자 · 숫자 · _ · - 만 쓸 수 있어요", "error");
      result = { action: "save", table: { rows: t.rows, align: t.align, caption: $("[data-cap]", body).value.trim(), label: label ? `tbl:${label}` : "" } };
      m.close();
    };
    const del = $("[data-del]", foot);
    if (del) del.onclick = () => { result = { action: "delete" }; m.close(); };
    draw(false);
    setTimeout(() => $("[data-cap]", body).focus(), 40);
  });
}

// 새 표 크기 고르기 (줄 · 칸) → { rows, cols } | null
export function tableSizeDialog() {
  return new Promise((resolve) => {
    const body = el(`<form class="grid-2"><div class="field"><label for="tbl-rows">줄 (머리글 포함)</label><input class="input" id="tbl-rows" name="rows" type="number" min="2" max="50" value="3"></div>
      <div class="field"><label for="tbl-cols">칸</label><input class="input" id="tbl-cols" name="cols" type="number" min="1" max="${MAX_COLS}" value="3"></div></form>`);
    const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button><button class="btn primary" data-ok>다음</button></div>`);
    let result = null;
    const m = modal({ title: "표 넣기", body, foot, onClose: () => resolve(result) });
    const ok = () => {
      const fd = new FormData(body);
      result = { rows: Math.min(50, Math.max(2, Number(fd.get("rows")) || 3)), cols: Math.min(MAX_COLS, Math.max(1, Number(fd.get("cols")) || 3)) };
      m.close();
    };
    body.addEventListener("submit", (e) => { e.preventDefault(); ok(); });
    $("[data-no]", foot).onclick = () => m.close();
    $("[data-ok]", foot).onclick = ok;
  });
}

// ------------------------------------------------------------- 단축키 · 서식 도움말
export function shortcutDialog() {
  const h = shortcutHelp(MAC);
  const rows = (list) => list.map(([a, b]) => `<tr><th scope="row">${esc(a)}</th><td><kbd>${esc(b)}</kbd></td></tr>`).join("");
  const syntax = (list) => list.map(([a, b]) => `<tr><td><code>${esc(a)}</code></td><td>${esc(b)}</td></tr>`).join("");
  modal({ title: "단축키 · 서식 도움말", wide: true, body: `<div class="kbd-help">
    <section><h4>단축키</h4><table class="kbd-table">${rows(h.keys)}</table></section>
    <section><h4>쓰는 대로 바뀌는 서식 (마크다운)</h4><table class="kbd-table">${syntax(h.syntax)}</table>
      <p class="small muted">그림 · 표 번호는 원고에 나온 순서대로 자동으로 매겨지고, 그림 · 표를 옮기거나 지우면 다시 매겨져요.
      줄 앞에 <code>- </code>나 <code>1. </code>을 치면 바로 목록이 되고, Enter로 다음 항목이 이어져요.</p></section></div>` });
}
