// 대화상자: 인용, 설정, 논문 추가(식별자/직접 입력), 업로드 결과, 가져오기/내보내기, 참고문헌 목록

import { api, downloadBlob } from "./api.js";
import { $, $$, authorsShort, copyText, el, errorToast, esc, modal, pickFiles, toast } from "./ui.js";
import { state, refreshAll } from "./state.js";

// ------------------------------------------------------------------- cite
export async function citeDialog(paperOrId) {
  let data;
  try {
    data = typeof paperOrId === "number"
      ? await api.get(`/api/papers/${paperOrId}/cite`)
      : await api.post("/api/cite-preview", { paper: paperOrId });
  } catch (e) { return errorToast(e); }
  const body = el(`<div></div>`);
  const pref = state.settings.citation_style || "apa";
  const order = [pref, ...Object.keys(data.styles).filter((k) => k !== pref)];
  for (const key of order) {
    const s = data.styles[key];
    const block = el(`<div class="cite-block">
      <div class="name"><span>${esc(state.meta.styles[key] || key)} <span class="muted" style="font-weight:500">· 본문 ${esc(s.in_text)}</span></span>
        <button class="btn sm">복사</button></div>
      <div class="body">${s.html}</div></div>`);
    $("button", block).onclick = () => copyText(s.text, s.html);
    body.appendChild(block);
  }
  const raw = el(`<div style="margin-top:12px">
    <div class="seg" style="margin-bottom:8px"><button class="active" data-f="bibtex">BibTeX</button><button data-f="ris">RIS (EndNote)</button></div>
    <div class="code-box"></div>
    <div style="margin-top:8px;display:flex;justify-content:flex-end"><button class="btn sm" data-copy>복사</button></div></div>`);
  let fmt = "bibtex";
  const show = () => { $(".code-box", raw).textContent = data[fmt]; $$(".seg button", raw).forEach((b) => b.classList.toggle("active", b.dataset.f === fmt)); };
  $$(".seg button", raw).forEach((b) => (b.onclick = () => { fmt = b.dataset.f; show(); }));
  $("[data-copy]", raw).onclick = () => copyText(data[fmt]);
  show();
  body.appendChild(raw);
  modal({ title: "인용하기", body, wide: true });
}

// --------------------------------------------------------------- settings
export async function settingsDialog() {
  const s = await api.get("/api/settings");
  const status = await api.get("/api/ai/status");
  const models = state.meta.models;
  const styles = state.meta.styles;
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
    <div class="field"><label>기본 인용 스타일</label><select class="input" name="citation_style">
      ${Object.entries(styles).map(([k, v]) => `<option value="${k}" ${k === s.citation_style ? "selected" : ""}>${esc(v)}</option>`).join("")}
    </select></div>

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
  if (state.filter.kind === "collection") payload.collection_id = state.filter.id;
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
    <div class="field"><label>제목</label><input class="input" name="title" value="${esc(p.title)}" required></div>
    <div class="field"><label>저자 (한 줄에 한 명, "성, 이름" 형식)</label><textarea class="input" name="authors" rows="4">${esc(authorsText)}</textarea></div>
    <div class="grid-3">
      <div class="field"><label>연도</label><input class="input" name="year" value="${esc(p.year || "")}"></div>
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
  $("[data-no]", foot).onclick = () => m.close();
  $("[data-save]", foot).onclick = async () => {
    const fd = Object.fromEntries(new FormData(body).entries());
    if (!fd.title.trim()) return toast("제목을 입력해 주세요", "error");
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
  if (state.filter.kind === "collection") fd.append("collection_id", state.filter.id);
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
  const body = el(`<div>
    <div class="row" style="margin-bottom:10px"><select class="input">${Object.entries(state.meta.styles).map(([k, v]) => `<option value="${k}" ${k === (state.settings.citation_style || "apa") ? "selected" : ""}>${v}</option>`).join("")}</select>
    <span class="spacer"></span><button class="btn" data-copy>전체 복사</button></div>
    <div class="list prose" style="font-size:13.5px"></div></div>`);
  const m = modal({ title: "참고문헌 목록", body, wide: true });
  let entries = [];
  const load = async () => {
    const style = $("select", body).value;
    try {
      entries = (await api.post("/api/bibliography", { ...scope, style })).entries;
      $(".list", body).innerHTML = entries.length
        ? entries.map((e) => `<p style="padding-left:2em;text-indent:-2em">${e.html}</p>`).join("")
        : `<p class="muted">논문이 없어요</p>`;
    } catch (e) { errorToast(e); m.close(); }
  };
  $("select", body).onchange = load;
  $("[data-copy]", body).onclick = () => copyText(entries.map((e) => e.text).join("\n\n"),
    entries.map((e) => `<p>${e.html}</p>`).join(""));
  load();
}
