// 대화상자: 인용, 설정, 논문 추가(식별자/직접 입력), 업로드 결과, 가져오기/내보내기, 참고문헌 목록

import { api, downloadBlob } from "./api.js";
import { forgetStyle, listStyles, render, sentenceCase, styleOptions } from "./cite.js";
import { formatManagerDialog, formatOptions, listFormats } from "./formats.js";
import { $, $$, authorsShort, confirmDialog, copyText, el, errorToast, esc, modal, pickFiles, toast } from "./ui.js";
import { state, refreshAll } from "./state.js";

// ------------------------------------------------------------------- cite
const LOCALES = [["en-US", "영문 용어 (et al., and)"], ["ko-KR", "국문 용어 (외, 및)"]];

async function rememberStyle(patch) {
  try { state.settings = await api.put("/api/settings", patch); } catch { /* 다음에 다시 저장 */ }
}

export function issuesBox(issues, onFix) {
  if (!issues || !issues.length) return null;
  const box = el(`<div class="status-line bad" style="align-items:flex-start;margin-bottom:12px">
    <span>!</span><div style="flex:1">인용에 필요한 정보가 비어 있어요: <b>${issues.map(esc).join(", ")}</b>
    <div class="small" style="margin-top:2px">빠진 채로 인용하면 형식이 어긋나요.</div></div>
    ${onFix ? `<button class="btn sm">채우기</button>` : ""}</div>`);
  if (onFix) $("button", box).onclick = onFix;
  return box;
}

export async function citeDialog(paperOrId) {
  let data;
  const inLibrary = typeof paperOrId === "number";
  try {
    data = inLibrary ? await api.get(`/api/papers/${paperOrId}/cite`) : await api.post("/api/cite-preview", { paper: paperOrId });
  } catch (e) { return errorToast(e); }
  const styles = await listStyles().catch(() => []);
  const body = el(`<div>
    <div class="issues"></div>
    <div class="grid-2">
      <div class="field"><label>인용 스타일</label><select class="input" data-style>${styleOptions(styles, state.settings.citation_style || "apa")}</select></div>
      <div class="field"><label>용어</label><select class="input" data-locale>${LOCALES.map(([k, v]) => `<option value="${k}" ${k === (state.settings.citation_locale || "en-US") ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </div>
    <div class="out"><div class="status-line"><span class="spinner"></span> 인용 문구를 만드는 중…</div></div>
    <div style="margin-top:14px">
      <div class="seg" style="margin-bottom:8px"><button class="active" data-f="bibtex">BibTeX</button><button data-f="ris">RIS (EndNote)</button></div>
      <div class="code-box"></div>
      <div style="margin-top:8px;display:flex;justify-content:flex-end"><button class="btn sm" data-copy>복사</button></div>
    </div></div>`);
  const m = modal({ title: "인용하기", body, wide: true });
  const fix = inLibrary ? async () => {
    m.close();
    const p = await api.get(`/api/papers/${paperOrId}`);
    editPaperDialog(p);
  } : null;
  const ib = issuesBox(data.issues, fix);
  if (ib) $(".issues", body).appendChild(ib);

  const draw = async () => {
    const style = $("[data-style]", body).value;
    const locale = $("[data-locale]", body).value;
    const out = $(".out", body);
    try {
      const r = await render([data.csl], { style, locale });
      const entry = r.entries[0] || { html: "", text: "" };
      out.innerHTML = "";
      const inText = el(`<div class="cite-block"><div class="name"><span>${r.note ? "각주" : "본문 인용"}</span><button class="btn sm">복사</button></div>
        <div class="body">${window.DOMPurify.sanitize(r.citation.html)}</div></div>`);
      $("button", inText).onclick = () => copyText(r.citation.text, r.citation.html);
      out.appendChild(inText);
      if (entry.text) {
        const ref = el(`<div class="cite-block"><div class="name"><span>참고문헌</span><button class="btn sm">복사</button></div>
          <div class="body">${entry.html}</div></div>`);
        $("button", ref).onclick = () => copyText(entry.text, entry.html);
        out.appendChild(ref);
      }
      const key = data.csl["citation-key"];
      const tip = el(`<div class="row small muted"><span class="grow">복사하면 기울임꼴 같은 서식도 함께 붙여넣어져요 (Word·한글·Google Docs).</span>
        ${key ? `<button class="btn sm" title="논문 쓰기·워드·한글 문서에 넣으면 나중에 스타일을 바꿔도 자동으로 맞춰져요">[@${esc(key)}] 복사</button>` : ""}</div>`);
      if (key) $("button", tip).onclick = () => copyText(`[@${key}]`);
      out.appendChild(tip);
    } catch (e) {
      out.innerHTML = `<div class="status-line bad">${esc(e.message)}</div>`;
    }
  };
  $("[data-style]", body).onchange = () => { rememberStyle({ citation_style: $("[data-style]", body).value }); draw(); };
  $("[data-locale]", body).onchange = () => { rememberStyle({ citation_locale: $("[data-locale]", body).value }); draw(); };
  let fmt = "bibtex";
  const show = () => { $(".code-box", body).textContent = data[fmt]; $$(".seg button", body).forEach((b) => b.classList.toggle("active", b.dataset.f === fmt)); };
  $$(".seg button", body).forEach((b) => (b.onclick = () => { fmt = b.dataset.f; show(); }));
  $("[data-copy]", body).onclick = () => copyText(data[fmt]);
  show();
  draw();
}

// --------------------------------------------------------------- settings
export async function settingsDialog() {
  const s = await api.get("/api/settings");
  const status = await api.get("/api/ai/status");
  const models = state.meta.models;
  const styles = await listStyles(true).catch(() => []);
  const formats = await listFormats(true).catch(() => null);
  const fmtDefault = s.doc_format_default || "default";
  const body = el(`<form autocomplete="off">
    <div class="section-title" style="margin-top:0">AI (요약 · 논문과 대화)</div>
    <div class="field"><label>AI 엔진</label>
      <div class="seg" id="engine-seg">
        <button type="button" data-v="api">Anthropic API</button>
        <button type="button" data-v="cli">Claude CLI (설치된 claude 명령)</button>
      </div>
      <div class="hint" id="engine-hint"></div>
    </div>
    <div class="field api-only"><label>Anthropic API 키</label>
      <input class="input" type="password" name="anthropic_api_key" placeholder="${s.anthropic_api_key_set ? "저장됨 (바꾸려면 새 키 입력)" : s.env_api_key_set ? "환경변수 ANTHROPIC_API_KEY 사용 중" : "sk-ant-..."}">
      <div class="hint">키는 이 컴퓨터의 설정 파일에만 저장돼요. <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">키 발급받기</a>
      ${s.anthropic_api_key_set ? ' · <a href="#" id="clear-key">저장된 키 지우기</a>' : ""}</div>
    </div>
    <div class="grid-2">
      <div class="field"><label>모델</label><select class="input" name="model">
        ${Object.entries(models).map(([k, v]) => `<option value="${k}" ${k === s.model ? "selected" : ""}>${esc(v)}</option>`).join("")}
        ${models[s.model] ? "" : `<option value="${esc(s.model)}" selected>${esc(s.model)}</option>`}
      </select></div>
      <div class="field api-only"><label>생각 깊이 (effort)</label><select class="input" name="effort">
        ${[["low", "낮음 · 빠름"], ["medium", "보통 (기본)"], ["high", "높음 · 정확"], ["xhigh", "매우 높음"]]
          .map(([k, v]) => `<option value="${k}" ${k === s.effort ? "selected" : ""}>${v}</option>`).join("")}
      </select></div>
    </div>
    <div class="field"><label>AI 답변 언어</label><input class="input" name="summary_language" value="${esc(s.summary_language)}"></div>
    <div class="status-line ${status.ready ? "ok" : "bad"}" id="ai-status">${status.ready ? "✓" : "!"} ${esc(status.message)}</div>

    <div class="section-title">인용</div>
    <div class="grid-2">
      <div class="field"><label>기본 인용 스타일</label><select class="input" name="citation_style">${styleOptions(styles, s.citation_style)}</select></div>
      <div class="field"><label>인용 용어</label><select class="input" name="citation_locale">
        ${LOCALES.map(([k, v]) => `<option value="${k}" ${k === s.citation_locale ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    </div>
    <label class="check" style="margin-bottom:10px"><input type="checkbox" name="korean_first" ${s.korean_first ? "checked" : ""}> 참고문헌 목록에서 국문 문헌을 영문 문헌보다 앞에 두기 (저자-연도 스타일)</label>
    <div class="field"><label>학술지 스타일 추가</label>
      <div class="row"><button type="button" class="btn sm" data-add-style>.csl 파일 추가</button>
        <a class="small" href="https://www.zotero.org/styles" target="_blank" rel="noopener">Zotero 스타일 저장소에서 찾기 (10,000+개)</a></div>
      <div class="hint">투고할 학술지 이름으로 검색해 .csl 파일을 받아 추가하면, 그 학술지 형식 그대로 인용돼요.</div>
      <div class="chips" data-custom-styles style="margin-top:6px"></div>
    </div>

    <div class="section-title">논문 양식</div>
    <div class="field">
      <label for="set-doc-format">새 원고 기본 양식</label>
      <div class="row">
        <select class="input grow" id="set-doc-format" name="doc_format_default" ${formats ? "" : "disabled"}>${formats ? formatOptions(formats, fmtDefault)
          : `<option>양식 목록을 불러오지 못했어요</option>`}</select>
        <button type="button" class="btn sm" data-manage-formats>양식 관리…</button>
      </div>
      <div class="hint">원고마다 편집 화면 위쪽에서 바꿀 수 있어요.</div>
    </div>

    <div class="section-title">논문 검색 데이터베이스</div>
    <div class="field"><label>연락처 이메일 (선택)</label><input class="input" name="contact_email" value="${esc(s.contact_email)}" placeholder="you@example.com">
      <div class="hint">OpenAlex·Crossref에 이메일을 알려주면 더 안정적인 요청 한도를 받아요.</div></div>
    <div class="grid-2">
      <div class="field"><label>OpenAlex API 키 (선택)</label><input class="input" type="password" name="openalex_api_key" placeholder="${s.openalex_api_key_set ? "저장됨" : "없어도 돼요"}"></div>
      <div class="field"><label>Semantic Scholar API 키 (선택)</label><input class="input" type="password" name="semantic_scholar_api_key" placeholder="${s.semantic_scholar_api_key_set ? "저장됨" : "없어도 돼요"}"></div>
    </div>
    <div class="section-title">데이터</div>
    <div class="small muted">서재 데이터와 PDF는 이 폴더에 저장돼요. 폴더째 복사하면 백업돼요.<br><code>${esc(state.meta.data_dir)}</code></div>
  </form>`);
  let engine = s.ai_engine;
  const syncEngine = () => {
    $$("#engine-seg button", body).forEach((b) => b.classList.toggle("active", b.dataset.v === engine));
    $$(".api-only", body).forEach((x) => x.classList.toggle("hidden", engine !== "api"));
    $("#engine-hint", body).textContent = engine === "api"
      ? "PDF를 그림·수식까지 통째로 읽고, 답변에 쪽 번호 근거가 붙어요. 사용량만큼 요금이 나가요."
      : "API 키 없이, 이 컴퓨터에 로그인된 Claude Code로 실행해요. 추출한 텍스트만 보내요.";
  };
  $$("#engine-seg button", body).forEach((b) => (b.onclick = () => { engine = b.dataset.v; syncEngine(); }));
  syncEngine();
  const drawCustom = (list) => {
    const box = $("[data-custom-styles]", body);
    box.innerHTML = "";
    for (const st of list.filter((x) => !x.builtin)) {
      const chip = el(`<span class="chip">${esc(st.title)}<button type="button" title="삭제">✕</button></span>`);
      $("button", chip).onclick = async () => {
        if (!(await confirmDialog(`'${st.title}' 스타일을 지울까요?`, { ok: "삭제" }))) return;
        try { await api.del(`/api/styles/${st.id}`); forgetStyle(st.id); drawCustom(await listStyles(true)); } catch (e) { errorToast(e); }
      };
      box.appendChild(chip);
    }
  };
  drawCustom(styles);
  $("[data-add-style]", body).onclick = async () => {
    const files = await pickFiles({ accept: ".csl,.xml", multiple: true });
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        const st = await api.post("/api/styles", fd);
        forgetStyle(st.id);
        toast(`'${st.title}' 스타일을 추가했어요`, "success");
      } catch (e) { errorToast(e); }
    }
    const list = await listStyles(true);
    drawCustom(list);
    const sel = $("[name=citation_style]", body);
    const cur = sel.value;
    sel.innerHTML = styleOptions(list, cur);
  };
  // 양식 관리 창을 닫고 돌아오면 선택지를 새로 그린다 (고른 양식이 지워졌으면 기본 (A4))
  $("[data-manage-formats]", body).onclick = async () => {
    const sel = $("#set-doc-format", body);
    await formatManagerDialog({ selected: sel.disabled ? fmtDefault : sel.value });
    try {
      const list = await listFormats(true);
      const cur = list.some((f) => f.id === sel.value) ? sel.value : "default";
      sel.innerHTML = formatOptions(list, cur);
      sel.value = cur;
      sel.disabled = false;
    } catch (e) { errorToast(e); }
  };
  const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button><button class="btn primary" data-save>저장</button></div>`);
  const m = modal({ title: "설정", body, foot, wide: true });
  const clear = $("#clear-key", body);
  if (clear) clear.onclick = async (e) => {
    e.preventDefault();
    await api.put("/api/settings", { anthropic_api_key: null });
    toast("저장된 API 키를 지웠어요");
    m.close();
  };
  $("[data-no]", foot).onclick = () => m.close();
  $("[data-save]", foot).onclick = async () => {
    const fd = Object.fromEntries(new FormData(body).entries());
    fd.ai_engine = engine;
    fd.korean_first = !!$("[name=korean_first]", body).checked;
    try {
      state.settings = await api.put("/api/settings", fd);
      const st = await api.get("/api/ai/status");
      toast(st.ready ? "저장했어요" : `저장했어요 · ${st.message}`, st.ready ? "success" : "");
      m.close();
    } catch (e) { errorToast(e); }
  };
}

// ------------------------------------------------------- add by identifier
export function addByIdentifierDialog() {
  const body = el(`<div>
    <form class="row"><input class="input grow" placeholder="DOI, arXiv ID/주소, 또는 논문 제목"><button class="btn primary">찾기</button></form>
    <div class="hint small muted" style="margin-top:6px">예: <code>10.1038/nature14539</code> · <code>arXiv:1706.03762</code> · <code>https://arxiv.org/abs/2303.08774</code></div>
    <div class="result-area"></div></div>`);
  const m = modal({ title: "식별자로 논문 추가", body });
  const area = $(".result-area", body);
  $("form", body).onsubmit = async (e) => {
    e.preventDefault();
    const q = $("input", body).value.trim();
    if (!q) return;
    area.innerHTML = `<div class="status-line" style="margin-top:10px"><span class="spinner"></span> 찾는 중…</div>`;
    try {
      const item = await api.post("/api/resolve", { identifier: q });
      area.innerHTML = "";
      area.appendChild(previewCard(item, () => m.close()));
    } catch (err) {
      area.innerHTML = `<div class="status-line bad" style="margin-top:10px">${esc(err.message)}</div>`;
    }
  };
}

function previewCard(item, done) {
  const card = el(`<div class="preview-card">
    <div style="font-weight:650">${esc(item.title)}</div>
    <div class="small muted" style="margin-top:2px">${esc(authorsShort(item.authors, 6))}</div>
    <div class="small muted">${esc([item.venue, item.year].filter(Boolean).join(" · "))}${item.doi ? ` · DOI ${esc(item.doi)}` : ""}</div>
    ${item.abstract ? `<div class="abstract clamp small" style="margin-top:8px">${esc(item.abstract)}</div>` : ""}
    <div class="row" style="margin-top:12px">
      ${item.pdf_url ? `<label class="check"><input type="checkbox" checked data-pdf> 무료 PDF도 받기</label>` : `<span class="small muted">무료 PDF 없음</span>`}
      <span class="spacer"></span>
      ${item.in_library ? `<span class="chip success">이미 서재에 있어요</span>` : `<button class="btn primary" data-add>서재에 추가</button>`}
    </div></div>`);
  const add = $("[data-add]", card);
  if (add) add.onclick = async () => {
    add.disabled = true;
    add.innerHTML = `<span class="spinner"></span> 추가 중`;
    const pdfBox = $("[data-pdf]", card);
    const r = await addPaper(item, { downloadPdf: pdfBox && pdfBox.checked });
    if (r) done();
    else { add.disabled = false; add.textContent = "서재에 추가"; }
  };
  return card;
}

// 서재에 추가 (현재 보고 있는 컬렉션이 있으면 그 안에)
export async function addPaper(item, { downloadPdf = false } = {}) {
  const payload = { ...item, download_pdf: downloadPdf && !!item.pdf_url };
  delete payload.in_library;
  // 서재에서 컬렉션을 보고 있을 때만 그 컬렉션에 넣는다 (논문 찾기 화면에서는 넣지 않음)
  if (state.view === "library" && state.filter.kind === "collection") payload.collection_id = state.filter.id;
  try {
    const r = await api.post("/api/papers", payload, { allowConflict: true });
    if (r.conflict) { toast("이미 서재에 있는 논문이에요"); return r.paper; }
    toast(r.warning || "서재에 추가했어요", r.warning ? "" : "success");
    refreshAll();
    return r.paper;
  } catch (e) { errorToast(e); return null; }
}

// --------------------------------------------------------- edit metadata
export function editPaperDialog(paper = null) {
  const p = paper || { title: "", authors: [], item_type: "article" };
  const authorsText = (p.authors || []).map((a) => a.literal ? `{${a.literal}}` : [a.family, a.given].filter(Boolean).join(", ")).join("\n");
  const types = state.meta.item_types;
  const body = el(`<form>
    <div class="field"><label>제목</label>
      <div class="row"><input class="input grow" name="title" value="${esc(p.title)}" required>
      <button type="button" class="btn sm" data-sentence title="APA 등은 제목을 문장형(첫 글자만 대문자)으로 써요. 바뀐 결과를 확인하고 저장하세요.">문장형으로</button></div></div>
    <div class="field"><label>저자 (한 줄에 한 명, "성, 이름" 형식)</label><textarea class="input" name="authors" rows="4">${esc(authorsText)}</textarea></div>
    <div class="grid-3">
      <div class="field"><label>발행일 (연도 또는 YYYY-MM-DD)</label><input class="input" name="issued" value="${esc(p.issued || p.year || "")}" placeholder="2017-06-12"></div>
      <div class="field"><label>유형</label><select class="input" name="item_type">${Object.entries(types).map(([k, v]) => `<option value="${k}" ${k === p.item_type ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>인용 키</label><input class="input" name="citekey" value="${esc(p.citekey || "")}"></div>
    </div>
    <div class="field"><label>학술지 / 학회</label><input class="input" name="venue" value="${esc(p.venue || "")}"></div>
    <div class="grid-3">
      <div class="field"><label>권</label><input class="input" name="volume" value="${esc(p.volume || "")}"></div>
      <div class="field"><label>호</label><input class="input" name="issue" value="${esc(p.issue || "")}"></div>
      <div class="field"><label>쪽</label><input class="input" name="pages" value="${esc(p.pages || "")}"></div>
    </div>
    <div class="grid-2">
      <div class="field"><label>DOI</label><input class="input" name="doi" value="${esc(p.doi || "")}"></div>
      <div class="field"><label>arXiv ID</label><input class="input" name="arxiv_id" value="${esc(p.arxiv_id || "")}"></div>
    </div>
    <div class="grid-2">
      <div class="field"><label>출판사</label><input class="input" name="publisher" value="${esc(p.publisher || "")}"></div>
      <div class="field"><label>URL</label><input class="input" name="url" value="${esc(p.url || "")}"></div>
    </div>
    <div class="field"><label>초록</label><textarea class="input" name="abstract" rows="5">${esc(p.abstract || "")}</textarea></div>
  </form>`);
  const foot = el(`<div style="display:contents"><button class="btn" data-no>취소</button><button class="btn primary" data-save>${paper ? "저장" : "추가"}</button></div>`);
  const m = modal({ title: paper ? "논문 정보 수정" : "직접 입력해서 추가", body, foot, wide: true });
  if (paper && paper.cite_issues && paper.cite_issues.length) {
    body.prepend(issuesBox(paper.cite_issues, null));
  }
  $("[data-sentence]", body).onclick = () => { const t = $("[name=title]", body); t.value = sentenceCase(t.value); t.focus(); };
  $("[data-no]", foot).onclick = () => m.close();
  $("[data-save]", foot).onclick = async () => {
    const fd = Object.fromEntries(new FormData(body).entries());
    if (!fd.title.trim()) return toast("제목을 입력해 주세요", "error");
    const date = (fd.issued || "").trim().match(/^(\d{4})(?:[-./](\d{1,2}))?(?:[-./](\d{1,2}))?$/);
    if (fd.issued.trim() && !date) return toast("발행일은 2017 또는 2017-06-12 형식으로 적어 주세요", "error");
    fd.year = date ? Number(date[1]) : null;
    fd.issued = date ? [date[1], date[2], date[3]].filter(Boolean).map((x, i) => (i ? x.padStart(2, "0") : x)).join("-") : "";
    fd.authors = fd.authors.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      if (l.startsWith("{") && l.endsWith("}")) return { literal: l.slice(1, -1) };
      if (l.includes(",")) { const [family, ...rest] = l.split(","); return { family: family.trim(), given: rest.join(",").trim() }; }
      if (/^[가-힣]{2,4}$/.test(l)) return { family: l[0], given: l.slice(1) };
      const parts = l.split(/\s+/);
      return { family: parts.pop(), given: parts.join(" ") };
    });
    try {
      if (paper) {
        await api.patch(`/api/papers/${paper.id}`, fd);
        toast("저장했어요");
      } else {
        if (state.filter.kind === "collection") fd.collection_id = state.filter.id;
        const r = await api.post("/api/papers", fd, { allowConflict: true });
        if (r.conflict) return toast("같은 논문이 이미 서재에 있어요", "error");
        state.activeId = r.paper.id;
        toast("추가했어요", "success");
      }
      m.close();
      refreshAll();
    } catch (e) { errorToast(e); }
  };
}

// --------------------------------------------------------------- upload
export async function uploadPdfs(files) {
  files = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  if (!files.length) return toast("PDF 파일만 올릴 수 있어요", "error");
  const body = el(`<div><div class="status-line"><span class="spinner"></span><span>${files.length}개 파일을 읽고 논문 정보를 찾는 중…</span></div><div class="list"></div></div>`);
  const m = modal({ title: "PDF 추가", body });
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  if (state.view === "library" && state.filter.kind === "collection") fd.append("collection_id", state.filter.id);
  try {
    const { results } = await api.post("/api/upload", fd);
    const ok = results.filter((r) => r.id && !r.duplicate).length;
    $(".status-line", body).outerHTML = `<div class="status-line ${ok ? "ok" : ""}">✓ ${ok}개 추가 · ${results.length - ok}개 건너뜀</div>`;
    const list = $(".list", body);
    for (const r of results) {
      const icon = r.error ? "✕" : r.duplicate ? "＝" : "✓";
      const detail = r.error || r.note || `정보 출처: ${r.matched_by}`;
      list.appendChild(el(`<div class="upload-result"><span class="st">${icon}</span><div>
        <div style="font-weight:600">${esc(r.title || r.file)}</div>
        <div class="small muted">${esc(r.file)} · ${esc(detail)}</div>
        ${(r.warnings || []).map((w) => `<div class="small" style="color:var(--warn)">${esc(w)}</div>`).join("")}
      </div></div>`));
    }
    const first = results.find((r) => r.id);
    if (first) state.activeId = first.id;
    refreshAll();
  } catch (e) {
    m.close();
    errorToast(e);
  }
}

// ------------------------------------------------------- import / export
export async function importDialog() {
  const [file] = await pickFiles({ accept: ".bib,.bibtex,.ris,.json,.txt" });
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  if (state.filter.kind === "collection") fd.append("collection_id", state.filter.id);
  try {
    const r = await api.post("/api/import", fd);
    toast(`${r.added}개를 가져왔어요${r.skipped ? ` (중복·빈 항목 ${r.skipped}개 건너뜀)` : ""}`, "success");
    refreshAll();
  } catch (e) { errorToast(e); }
}

export async function exportPapers(format, scope) {
  try {
    const res = await api.raw("POST", "/api/export", { format, ...scope });
    if (!res.ok) throw new Error("내보내기 실패");
    const ext = { bibtex: "bib", ris: "ris", csljson: "json", txt: "txt" }[format];
    downloadBlob(await res.blob(), `paperlab-${new Date().toISOString().slice(0, 10)}.${ext}`);
  } catch (e) { errorToast(e); }
}

export async function bibliographyDialog(scope) {
  let data;
  try { data = await api.post("/api/csl", scope); } catch (e) { return errorToast(e); }
  if (!data.items.length) return toast("참고문헌에 넣을 논문이 없어요");
  const styles = await listStyles().catch(() => []);
  let order = data.items.map((it) => it.id);
  const byId = new Map(data.items.map((it) => [it.id, it]));
  const body = el(`<div>
    <div class="grid-3">
      <div class="field"><label>인용 스타일</label><select class="input" data-style>${styleOptions(styles, state.settings.citation_style || "apa")}</select></div>
      <div class="field"><label>용어</label><select class="input" data-locale>${LOCALES.map(([k, v]) => `<option value="${k}" ${k === (state.settings.citation_locale || "en-US") ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label>&nbsp;</label><label class="check" data-kf-wrap><input type="checkbox" data-kf ${state.settings.korean_first !== false ? "checked" : ""}> 국문 문헌 먼저</label></div>
    </div>
    <div class="issues"></div>
    <div class="hint small muted" data-hint style="margin-bottom:8px"></div>
    <div class="list prose" style="font-size:13.5px"></div></div>`);
  const foot = el(`<div style="display:contents"><div class="left"><button class="btn" data-txt>.txt 저장</button><button class="btn" data-html title="Word·한글에서 열 수 있어요">.html 저장</button></div>
    <button class="btn primary" data-copy>전체 복사</button></div>`);
  const m = modal({ title: `참고문헌 목록 · ${data.items.length}편`, body, foot, wide: true });
  const bad = Object.entries(data.issues).filter(([, v]) => v.length);
  if (bad.length) {
    const box = el(`<details class="status-line bad" style="display:block;margin-bottom:10px"><summary style="cursor:pointer">${bad.length}편에 인용 정보가 비어 있어요 (눌러서 보기)</summary>
      <ul class="small" style="margin:6px 0 0;padding-left:18px">${bad.map(([id, v]) => `<li>${esc((byId.get(id) || {}).title || id)} — ${v.map(esc).join(", ")}</li>`).join("")}</ul></details>`);
    $(".issues", body).appendChild(box);
  }
  let result = null;
  const draw = async () => {
    const style = $("[data-style]", body).value;
    const list = $(".list", body);
    try {
      result = await render(order.map((id) => byId.get(id)), {
        style, locale: $("[data-locale]", body).value, koreanFirst: $("[data-kf]", body).checked,
      });
    } catch (e) {
      list.innerHTML = `<div class="status-line bad">${esc(e.message)}</div>`;
      return;
    }
    $("[data-kf-wrap]", body).classList.toggle("hidden", result.numeric || result.note);
    $("[data-hint]", body).textContent = result.numeric
      ? "번호식 스타일은 목록 순서대로 번호가 매겨져요. 본문에서 처음 인용한 순서대로 ↑↓로 맞춰 주세요."
      : result.note ? "각주 스타일: 아래는 문서 끝 참고문헌 목록이에요. 각주 문구는 논문별 ‘인용’에서 복사하세요." : "";
    list.innerHTML = "";
    result.entries.forEach((e, i) => {
      const row = el(`<div class="row" style="align-items:flex-start;gap:6px;margin-bottom:8px">
        ${result.numeric ? `<span style="display:flex;flex-direction:column"><button class="icon-btn small" data-up title="위로">↑</button><button class="icon-btn small" data-down title="아래로">↓</button></span>` : ""}
        <p class="grow" style="margin:0;${result.hangingIndent ? "padding-left:2em;text-indent:-2em" : ""}">${e.html}</p></div>`);
      const move = (d) => {
        const j = order.indexOf(e.id);
        const k = j + d;
        if (k < 0 || k >= order.length) return;
        [order[j], order[k]] = [order[k], order[j]];
        draw();
      };
      if (result.numeric) { $("[data-up]", row).onclick = () => move(-1); $("[data-down]", row).onclick = () => move(1); }
      list.appendChild(row);
    });
  };
  $("[data-style]", body).onchange = () => { rememberStyle({ citation_style: $("[data-style]", body).value }); draw(); };
  $("[data-locale]", body).onchange = () => { rememberStyle({ citation_locale: $("[data-locale]", body).value }); draw(); };
  $("[data-kf]", body).onchange = () => { rememberStyle({ korean_first: $("[data-kf]", body).checked }); draw(); };
  const htmlDoc = () => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>참고문헌</title>
    <style>body{font-family:"Times New Roman","바탕",serif;font-size:12pt;line-height:1.6;max-width:720px;margin:40px auto}
    p{margin:0 0 10px;${result.hangingIndent ? "padding-left:2em;text-indent:-2em" : ""}}</style></head><body><h2>참고문헌</h2>
    ${result.entries.map((e) => `<p>${e.html}</p>`).join("\n")}</body></html>`;
  $("[data-copy]", foot).onclick = () => result && copyText(result.entries.map((e) => e.text).join("\n\n"),
    result.entries.map((e) => `<p>${e.html}</p>`).join(""));
  $("[data-txt]", foot).onclick = () => result && downloadBlob(new Blob([result.entries.map((e) => e.text).join("\n\n") + "\n"], { type: "text/plain;charset=utf-8" }), "references.txt");
  $("[data-html]", foot).onclick = () => result && downloadBlob(new Blob([htmlDoc()], { type: "text/html;charset=utf-8" }), "references.html");
  draw();
}
