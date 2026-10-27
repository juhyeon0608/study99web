// 통계 계산 창 (2026-10-28 사용자 요청): ① 엑셀에서 원자료를 복사해 붙여 넣기(또는 CSV 열기) ② 분석 · 변인 고르기
// ③ 서버가 계산(/api/stats — scipy, AI 아님)한 APA 표 · 결과 문장을 미리 보고 ④ 커서 자리에 넣기. 순수 함수는 writestats.js
import { api } from "./api.js";
import { $, $$, el, errorToast, esc, modal, pickFiles, renderMarkdown, toast } from "./ui.js";
import { ANALYSES, columnKinds, fieldOptions, parseData, statsMarkdown } from "./writestats.js";

/** insert(markdown): 원고 커서 자리에 넣기 (writing.js) */
export function statsDialog({ insert }) {
  let data = null;
  let kinds = [];
  let result = null;
  const body = el(`<div class="stats-box">
    <div class="field"><label class="small">① 원자료를 붙여 넣으세요 — 엑셀에서 첫 줄(변인 이름)까지 골라 복사(Ctrl+C) → 여기에 붙여넣기(Ctrl+V)</label>
      <textarea class="input" data-raw rows="6" spellcheck="false" placeholder="집단	사전	사후	성별&#10;실험	3.2	4.1	남&#10;통제	3.4	3.5	여&#10;…"></textarea>
      <div class="stats-row"><button type="button" class="btn sm" data-csv>CSV 파일 열기</button><span class="small muted" data-info></span></div></div>
    <div class="field" data-step2 hidden><label class="small">② 분석</label>
      <select class="input" data-kind>${ANALYSES.map((a) => `<option value="${a.key}">${esc(a.name)} — ${esc(a.hint)}</option>`).join("")}</select>
      <div data-fields class="stats-fields"></div></div>
    <div data-out class="stats-out" hidden></div>
    <p class="small muted" style="margin:6px 0 0">계산은 서버가 직접 해요(AI 아님). 표는 APA 7판 형식, 결측값(빈칸 · NA · .)이 있는 행은 분석마다 빼요.</p></div>`);
  const foot = el(`<div style="display:contents"><button type="button" class="btn" data-no>닫기</button>
    <button type="button" class="btn" data-run disabled>계산하기</button><button type="button" class="btn primary" data-ok disabled>원고에 넣기</button></div>`);
  const md = modal({ title: "통계 계산 → APA 표 · 결과 문장", body, foot, wide: true });
  const raw = $("[data-raw]", body);
  const info = $("[data-info]", body);
  const kindSel = $("[data-kind]", body);
  const fieldsBox = $("[data-fields]", body);
  const out = $("[data-out]", body);
  const runBtn = $("[data-run]", foot);
  const okBtn = $("[data-ok]", foot);

  const clearResult = () => { result = null; out.hidden = true; out.innerHTML = ""; okBtn.disabled = true; };
  const load = () => {
    clearResult();
    const d = parseData(raw.value);
    data = d.error ? null : d;
    $("[data-step2]", body).hidden = !data;
    runBtn.disabled = !data;
    if (!data) { info.textContent = raw.value.trim() ? d.error : ""; return; }
    kinds = columnKinds(data);
    const nums = kinds.filter((k) => k.kind === "num").length;
    info.textContent = `${data.rows.length.toLocaleString("ko-KR")}행 · 변인 ${data.columns.length}개 (숫자 ${nums} · 범주 ${data.columns.length - nums})${d.cut ? " — 5,000행까지만 써요" : ""}`;
    drawFields();
  };
  const drawFields = () => {
    clearResult();
    const a = ANALYSES.find((x) => x.key === kindSel.value);
    fieldsBox.innerHTML = "";
    for (const f of a.fields) {
      const opts = fieldOptions(data, kinds, f);
      const kindName = f.kind === "num" ? "숫자 변인" : "범주가 2~12개인 변인";
      if (!opts.length) {
        fieldsBox.append(el(`<div class="small status-line bad">${esc(f.label)}: 고를 수 있는 ${kindName}이 없어요</div>`));
        continue;
      }
      if (f.many) {
        fieldsBox.append(el(`<fieldset class="stats-many" data-f="${esc(f.name)}"><legend class="small">${esc(f.label)} (${f.min}개 이상)</legend>
          ${opts.map((o) => `<label class="small"><input type="checkbox" value="${esc(o)}"> ${esc(o)}</label>`).join("")}</fieldset>`));
      } else {
        fieldsBox.append(el(`<label class="small stats-one">${esc(f.label)} <select class="input" data-f="${esc(f.name)}">
          ${opts.map((o, i) => `<option value="${esc(o)}" ${i === Math.min(a.fields.indexOf(f), opts.length - 1) ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`));
      }
    }
  };
  const params = () => {
    const a = ANALYSES.find((x) => x.key === kindSel.value);
    const p = {};
    for (const f of a.fields) {
      const box = $(`[data-f="${f.name}"]`, fieldsBox);
      if (!box) return null;
      if (f.many) {
        p[f.name] = $$("input:checked", box).map((x) => x.value);
        if (p[f.name].length < f.min) { toast(`${f.label}을(를) ${f.min}개 이상 골라 주세요`, "error"); return null; }
      } else p[f.name] = box.value;
    }
    return p;
  };

  raw.addEventListener("input", load);
  kindSel.addEventListener("change", drawFields);
  fieldsBox.addEventListener("change", clearResult);
  $("[data-csv]", body).onclick = async () => {
    const [file] = await pickFiles({ accept: ".csv,.tsv,.txt,text/csv" });
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast("5MB보다 작은 파일만 열 수 있어요", "error");
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) { try { text = new TextDecoder("euc-kr").decode(buf); } catch { /* 그대로 */ } } // 엑셀 한글 CSV(CP949)
    raw.value = text;
    load();
  };
  runBtn.onclick = async () => {
    const p = params();
    if (!p || !data) return;
    runBtn.disabled = true;
    out.hidden = false;
    out.innerHTML = `<span class="spinner"></span> 계산 중…`;
    try {
      result = await api.post("/api/stats", { columns: data.columns, rows: data.rows, analysis: kindSel.value, params: p });
      out.innerHTML = `<div class="doc stats-preview">${renderMarkdown(statsMarkdown(result))}</div>`;
      okBtn.disabled = false;
      okBtn.focus();
    } catch (e) {
      result = null;
      out.innerHTML = `<div class="status-line bad">${esc(e.message)}</div>`;
      errorToast(e);
    } finally { runBtn.disabled = false; }
  };
  okBtn.onclick = () => {
    if (!result) return;
    insert(statsMarkdown(result));
    toast("표와 결과 문장을 넣었어요 — 표 번호는 자동으로 매겨져요", "success");
    md.close();
  };
  $("[data-no]", foot).onclick = () => md.close();
  setTimeout(() => raw.focus(), 40);
}
