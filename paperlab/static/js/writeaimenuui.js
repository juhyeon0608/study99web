// AI 도우미 묶음 창 (writeaimenu.js): 방식 하나를 고르고, 글을 바꾸는 방식이면 범위 · 끝맺음도 같은 창에서 고른다.
// 방식을 두 번 누르거나 Enter = 바로 시작
import { $, $$, el, esc, modal } from "./ui.js";
import { ENDING_MODES, SCOPE_MODES, initialChoice } from "./writeaimenu.js";

let seq = 0;

/** opts: { last, scope, scopes: {key: 이름}, ending, endings: [[key, 이름]] } → Promise<{ key, scope, ending } | null> */
export function aiGroupDialog(group, opts) {
  const n = ++seq;
  const radios = (name, list, cur, cls = "") => `<div class="seg seg-radio ${cls}" role="radiogroup" aria-labelledby="${name}-l">${list.map(([k, label]) =>
    `<label><input type="radio" name="${name}" value="${esc(k)}"${k === cur ? " checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div>`;
  const body = el(`<div class="ai-group">
    <div class="ai-choices" role="radiogroup" aria-label="${esc(group.title)} 방식">${group.choices.map(([k, label, sub]) =>
      `<label class="ai-choice"><input type="radio" name="aig-${n}" value="${esc(k)}"><span><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span></label>`).join("")}</div>
    <div class="field" data-opt="scope"><span class="small" id="aig-${n}-scope-l">범위</span>
      ${radios(`aig-${n}-scope`, Object.entries(opts.scopes || {}), opts.scope)}</div>
    <div class="field" data-opt="ending"><span class="small" id="aig-${n}-end-l">문장 끝맺음</span>
      ${radios(`aig-${n}-end`, opts.endings || [], opts.ending)}</div>
  </div>`);
  const foot = el(`<div><button class="btn" data-x>취소</button><button class="btn primary" data-ok>${esc(group.ok || "시작")}</button></div>`);
  return new Promise((resolve) => {
    let out = null;
    const m = modal({ title: group.title, body, foot, onClose: () => resolve(out) });
    const pick = (name) => ($(`input[name="${name}"]:checked`, body) || {}).value || "";
    const sync = () => {
      const k = pick(`aig-${n}`);
      $("[data-opt=scope]", body).hidden = !SCOPE_MODES.has(k) || !opts.scopes;
      $("[data-opt=ending]", body).hidden = !ENDING_MODES.has(k) || !opts.endings;
    };
    const done = () => {
      out = { key: pick(`aig-${n}`), scope: pick(`aig-${n}-scope`), ending: pick(`aig-${n}-end`) };
      if (!out.key) out = null;
      m.close();
    };
    const first = $(`input[name="aig-${n}"][value="${CSS.escape(initialChoice(group, opts.last))}"]`, body);
    if (first) first.checked = true;
    for (const r of $$(`input[name="aig-${n}"]`, body)) {
      r.addEventListener("change", sync);
      r.closest("label").addEventListener("dblclick", done);
    }
    body.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); done(); } });
    $("[data-x]", foot).onclick = () => m.close();
    $("[data-ok]", foot).onclick = done;
    sync();
    setTimeout(() => first && first.focus(), 0);
  });
}
