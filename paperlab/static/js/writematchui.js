// 서재 대조 화면 (2026-10-27): ① 인용이 필요한 문장 → 서재 논문 추천 · [@키] 넣기 ② 표절 미리 점검 → 서재 원문과 표현이 비슷한
// 문장 · [AI로 바꿔 쓰기]. 원고를 보면서 쓰도록 떠 있는 창(floating). 순수 함수는 writematch.js
import { api } from "./api.js";
import { $, el, errorToast, esc, modal, toast } from "./ui.js";
import { citeEdit, queryText, similarHits, similarityCandidates, uncitedClaims } from "./writematch.js";

const BATCH = 150; // 서버 한 번에 받는 문장 수
const MAX_SIMILAR = 600; // 표절 점검 문장 (긴 원고는 앞부분만)

async function matchAll(queries, k, onStep) {
  const results = [];
  let indexed = 0;
  for (let i = 0; i < queries.length; i += BATCH) {
    onStep(i, queries.length);
    const r = await api.post("/api/library-match", { queries: queries.slice(i, i + BATCH), k });
    results.push(...r.results);
    indexed = r.indexed;
  }
  return { results, indexed };
}

/** h: { select(a, b), apply(edit), paraphrase(sentence, hit), alive() } */
export async function matchDialog(ta, mode, h) {
  const cite = mode === "cite";
  const all = cite ? uncitedClaims(ta.value) : similarityCandidates(ta.value);
  const items = cite ? all : all.slice(0, MAX_SIMILAR);
  if (!items.length) {
    toast(cite ? "인용이 필요해 보이는 문장을 찾지 못했어요 (다른 연구 · 통계를 말하는데 [@인용]이 없는 문장)" : "점검할 문장이 없어요");
    return;
  }
  const body = el(`<div class="match-box"><p class="small muted match-st" data-st aria-live="polite"></p><ol class="match-list" data-list></ol></div>`);
  const st = $("[data-st]", body);
  const list = $("[data-list]", body);
  let alive = true;
  modal({ title: cite ? "인용이 필요한 문장 (내 서재에서 추천)" : "표절 미리 점검 (내 서재 원문과 대조)", body, wide: true, floating: true,
    onClose: () => { alive = false; } });
  st.innerHTML = `<span class="spinner" aria-hidden="true"></span> 문장 ${items.length}개를 내 서재 본문과 대조하는 중…`;
  let res;
  try {
    res = await matchAll(items.map((s) => queryText(s.text)), cite ? 3 : 2, (i, n) => {
      if (n > BATCH) st.innerHTML = `<span class="spinner" aria-hidden="true"></span> 대조하는 중… ${Math.min(i + BATCH, n)}/${n}`;
    });
  } catch (e) {
    st.textContent = "대조하지 못했어요";
    return errorToast(e);
  }
  if (!alive) return;
  if (!res.indexed) {
    st.textContent = "본문 색인이 끝난 서재 논문이 없어요. 서재에 PDF가 있는 논문을 넣고 색인이 끝나면 다시 해 주세요.";
    return;
  }
  const go = (s) => {
    const at = ta.value.indexOf(s.text, Math.max(0, s.from - 300));
    if (at < 0) return toast("원고에서 이 문장을 찾지 못했어요 — 그 사이 고쳤을 수 있어요", "error");
    h.select(at, at + s.text.length);
  };
  if (cite) {
    st.textContent = `인용이 필요해 보이는 문장 ${items.length}개 · 본문 색인 ${res.indexed}편과 대조했어요. 맞는 논문의 [@키 넣기]를 누르면 문장 끝에 들어가요.`;
    items.forEach((s, i) => {
      const hits = res.results[i] || [];
      const li = el(`<li class="match-item"><div class="match-s"><button type="button" class="link" data-go></button>
        <span class="chip">${esc(s.reason)}</span></div><ol class="match-hits"></ol></li>`);
      $("[data-go]", li).textContent = s.text.length > 140 ? `${s.text.slice(0, 140)}…` : s.text;
      $("[data-go]", li).onclick = () => go(s);
      const ol = $(".match-hits", li);
      if (!hits.length) ol.append(el(`<li class="small muted">서재에서 비슷한 내용을 찾지 못했어요 — [확인 필요]를 붙이거나 외부 검색을 해 보세요</li>`));
      for (const hit of hits) {
        const row = el(`<li><div class="match-ref"><b></b> <span class="small muted"></span>
          ${hit.citekey ? `<button type="button" class="btn sm" data-cite>[@${esc(hit.citekey)}] 넣기</button>` : ""}</div>
          <details><summary class="small">본문 조각 보기</summary><p class="small match-x"></p></details></li>`);
        $("b", row).textContent = hit.title || "제목 없음";
        $(".small.muted", row).textContent = `${hit.year || "n.d."} · p.${hit.page}`;
        $(".match-x", row).textContent = hit.text;
        const b = $("[data-cite]", row);
        if (b) b.onclick = () => {
          const cur = { ...s, from: ta.value.indexOf(s.text, Math.max(0, s.from - 300)) };
          cur.to = cur.from + s.text.length;
          const edit = cur.from >= 0 ? citeEdit(ta.value, cur, hit.citekey) : null;
          if (!edit) return toast("원고에서 이 문장을 찾지 못했어요 — 그 사이 고쳤을 수 있어요", "error");
          h.apply(edit);
          s.text = ta.value.slice(cur.from, cur.to + edit.text.length);
          b.disabled = true;
          b.textContent = "넣었어요";
        };
        ol.append(row);
      }
      list.append(li);
    });
    return;
  }
  const hits = similarHits(items, res.results);
  st.textContent = hits.length
    ? `표현이 서재 원문과 많이 겹치는 문장 ${hits.length}개 (문장 ${items.length}개 · 본문 색인 ${res.indexed}편과 대조). 직접 인용이면 따옴표와 쪽수를, 아니면 바꿔 쓰고 출처를 달아 주세요.`
    : `서재 원문과 표현이 많이 겹치는 문장을 찾지 못했어요 (문장 ${items.length}개 · 본문 색인 ${res.indexed}편).`;
  if (all.length > items.length) st.textContent += ` 원고가 길어 앞 ${MAX_SIMILAR}문장만 봤어요.`;
  list.after(el(`<p class="small muted" style="margin:8px 0 0">내 서재에 있는 논문하고만 대조해요. 카피킬러 · Turnitin 같은 표절 검사를 대신하지는 않아요.</p>`));
  for (const s of hits) {
    const pct = Math.round(s.hit.overlap * 100);
    const li = el(`<li class="match-item"><div class="match-s"><button type="button" class="link" data-go></button>
      <span class="chip" data-tone="${pct >= 60 ? "bad" : "warn"}">겹침 ${pct}%</span></div>
      <div class="match-ref"><b></b> <span class="small muted"></span></div>
      <details><summary class="small">서재 원문 조각 보기</summary><p class="small match-x"></p></details>
      <div class="row" style="gap:6px;margin-top:4px"><button type="button" class="btn sm" data-para>AI로 바꿔 쓰기</button>
        ${s.hit.citekey && !s.text.includes(`@${s.hit.citekey}`) ? `<button type="button" class="btn sm" data-cite>[@${esc(s.hit.citekey)}] 넣기</button>` : ""}</div></li>`);
    $("[data-go]", li).textContent = s.text.length > 160 ? `${s.text.slice(0, 160)}…` : s.text;
    $("[data-go]", li).onclick = () => go(s);
    $("b", li).textContent = s.hit.title || "제목 없음";
    $(".match-ref .small", li).textContent = `${s.hit.year || "n.d."} · p.${s.hit.page}`;
    $(".match-x", li).textContent = s.hit.text;
    $("[data-para]", li).onclick = () => {
      const at = ta.value.indexOf(s.text, Math.max(0, s.from - 300));
      if (at < 0) return toast("원고에서 이 문장을 찾지 못했어요 — 그 사이 고쳤을 수 있어요", "error");
      h.paraphrase({ from: at, to: at + s.text.length, text: s.text }, s.hit);
    };
    const c = $("[data-cite]", li);
    if (c) c.onclick = () => {
      const at = ta.value.indexOf(s.text, Math.max(0, s.from - 300));
      const edit = at >= 0 ? citeEdit(ta.value, { from: at, to: at + s.text.length, text: s.text }, s.hit.citekey) : null;
      if (!edit) return toast("원고에서 이 문장을 찾지 못했어요 — 그 사이 고쳤을 수 있어요", "error");
      h.apply(edit);
      s.text = ta.value.slice(at, at + s.text.length + edit.text.length);
      c.disabled = true;
      c.textContent = "넣었어요";
    };
    list.append(li);
  }
}
