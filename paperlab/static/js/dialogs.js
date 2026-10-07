// 대화상자: 인용, 설정, 논문 추가(식별자/직접 입력), 업로드 결과, 가져오기/내보내기, 참고문헌 목록

import { api, downloadBlob } from "./api.js";
import { forgetStyle, listStyles, render, sentenceCase, styleOptions } from "./cite.js";
import { INHA } from "./extlinks.js";
import { formatManagerDialog, formatOptions, listFormats } from "./formats.js";
import {
  $, $$, authorsShort, avatarEl, confirmDialog, copyText, el, errorToast, esc, fmtBytes, modal, pickFiles, promptDialog, toast,
} from "./ui.js";
import { actions, refreshAll, refreshUsage, state } from "./state.js";

export const ICON_WARN = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l9.5 16.5h-19zM12 10v4.5M12 17.5v.01"/></svg>`;
const ICON_ALERT = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.5v.01"/></svg>`;
const FOLDER_PATH = "M3.5 6.5A1.5 1.5 0 0 1 5 5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v9.3A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z";
// 폴더 아이콘 (none = "폴더 없음" 모양)
export const folderIcon = (none = false) =>
  `<svg class="ico folder-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${FOLDER_PATH}${none ? "M9.5 13.5h5" : ""}"/></svg>`;

// ------------------------------------------------- 학교 링크 · 새 탭 (docs/design/inha-proxy-ui.md 0~2 · 8장)
// 주소는 extlinks.js 함수의 반환값만 넣는다. 새 탭은 항상 noopener · noreferrer (S-6)
export const ICON_EXT = `<svg class="ico ext-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>`;
export const extMark = (note = "새 탭에서 열림") => `${ICON_EXT}<span class="sr-only">(${esc(note)})</span>`;
export const EXT_MARK = extMark();
export const ICON_INFO = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.5v.01"/></svg>`;
const ICON_LOCK = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>`;
const GUIDE_KEY = "paperlab.inhaGuideSeen";
export const G5_NOTICE = `<div class="notice inha-after" data-tone="info">${ICON_INFO}<div>학교 사이트에서 PDF를 받았다면 <b>[PDF 첨부]</b>로 올려 주세요.</div></div>`;
export const SCHOOL_LOGIN_NOTE = "‘인하대에서 보기’를 누르면 학교 로그인이 필요할 때 자동으로 로그인 화면이 뜨고, 로그인하면 보려던 페이지로 돌아가요. 미리 로그인해 두고 싶으면 [학교 로그인]을 누르세요. 로그인은 학교 화면에서 직접 하고, PaperLab은 학교 계정을 저장하거나 사용하지 않아요. 학교 로그인이 끝나면 다시 로그인 화면이 떠요.";
export const SCHOLAR_LIBRARY_NOTE = "Google Scholar: 설정 → 도서관 링크에서 ‘인하대학교’를 켜면 검색 결과에 학교 구독 원문 링크가 함께 나와요.";
// 인용 그래프 아이콘 (docs/design/citation-graph-ui.md 1.2절) — 진입 상자 · [이 논문으로 새 그래프]
export const ICON_GRAPH = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="6" r="2"/><circle cx="15" cy="17" r="3"/><path d="M7.7 8.9 13 14.8M8.5 6.8l7.5-.6M17.5 7.9l-1.7 6.2"/></svg>`;

// 이 브라우저에서 안내 창을 "다시 보지 않기" 했는지 (저장소를 못 쓰면 매번 안내)
function guideSeen() {
  try { return localStorage.getItem(GUIDE_KEY) === "1"; } catch { return false; }
}
function setGuideSeen(on) {
  try { if (on) localStorage.setItem(GUIDE_KEY, "1"); else localStorage.removeItem(GUIDE_KEY); } catch { /* 저장 못 함 — 다음에 다시 뜸 */ }
}

const openTab = (url) => window.open(url, "_blank", "noopener,noreferrer");

// 처음 쓸 때 안내 창(G-1). onGo가 있으면 [계속 열기]의 클릭 안에서 바로 부른다(팝업 차단 회피), 없으면 보기 전용
export function inhaGuideDialog({ onGo = null, returnFocus = null } = {}) {
  const body = el(`<div class="inha-guide">
    <div class="notice" data-tone="info">${ICON_LOCK}<div><b>PaperLab은 학교 아이디·비밀번호를 저장하거나 사용하지 않아요.</b> 로그인은 이 브라우저와 학교 사이에서만 이뤄져요.</div></div>
    <ol class="inha-guide-list">
      <li>학교에 로그인하지 않았으면 <b>학교 로그인 화면이 자동으로 떠요.</b> <b>정석학술정보관 계정으로 학교 화면에서 직접</b> 로그인하면 <b>보려던 페이지로 돌아가요.</b></li>
      <li>시간이 지나거나 브라우저를 닫아 학교 로그인이 끝나면 다음에 열 때 <b>다시 로그인 화면이 떠요.</b></li>
      <li>받은 PDF는 서재의 논문 상세에서 <b>[PDF 첨부]</b>로 올려 주세요.</li>
      <li>학교가 구독하지 않는 사이트면 학교 안내·오류 페이지나 출판사의 구매 화면이 뜰 수 있어요.</li>
    </ol>
    <div class="notice" data-tone="warn">${ICON_WARN}<div>구독 계약상 <b>논문을 한꺼번에 많이 받으면 학교 전체 접속이 막힐 수 있어요.</b> 필요한 논문만 한 편씩 받아 주세요.</div></div>
  </div>`);
  const foot = el(`<div style="display:contents">
    <div class="left"><label class="check"><input type="checkbox" data-guide-skip ${!onGo && guideSeen() ? "checked" : ""}> 다시 보지 않기</label></div>
    ${onGo ? `<button class="btn" data-no>취소</button><button class="btn primary" data-guide-go>계속 열기${EXT_MARK}</button>`
      : `<button class="btn primary" data-no>닫기</button>`}
  </div>`);
  const skip = $("[data-guide-skip]", foot);
  // 다시 보지 않기: 창이 어떻게 닫히든 체크 상태를 저장 (D-2)
  const m = modal({ title: "인하대 정석학술정보관으로 열어요", body, foot, onClose: () => {
    setGuideSeen(skip.checked);
    // 바깥 클릭(mousedown)으로 닫히면 그 기본 동작이 포커스를 옮기므로, 그 뒤에 돌려준다
    if (returnFocus) setTimeout(() => { if (returnFocus.isConnected) returnFocus.focus(); }, 0);
  } });
  $(".modal", m.el).classList.add("inha-guide-modal");
  $("[data-no]", foot).onclick = () => m.close();
  const go = $("[data-guide-go]", foot);
  if (go) go.onclick = () => { onGo(); m.close(); };
  setTimeout(() => (go || $("[data-no]", foot)).focus(), 40);
  return m;
}

// 새 탭으로 열기. guide: 처음이면 안내 창을 먼저(학교 링크), before: 열기 직전 동기 동작(KISS 복사), onOpen: 실제로 연 뒤
export function openExternal(url, { guide = true, before = null, onOpen = null, returnFocus = null } = {}) {
  if (!url) return;
  const run = () => { if (before) before(); openTab(url); if (onOpen) onOpen(); };
  if (!guide || guideSeen()) return run();
  inhaGuideDialog({ onGo: run, returnFocus });
}

// <a href target=_blank rel="noopener noreferrer"> 학교 링크: 처음이면 막고 안내 창, 이미 봤으면 브라우저 기본 동작.
// 가운데 클릭 · Ctrl/⌘/Shift+클릭은 안내 창 없이 브라우저 기본 동작 (D-3). Alt+클릭은 보통 클릭처럼 안내 창
export function bindExtLink(a, { guide = true, onOpen = null } = {}) {
  a.addEventListener("click", (e) => {
    if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.metaKey || !guide || guideSeen()) {
      if (!e.altKey && onOpen) onOpen();
      return;
    }
    e.preventDefault();
    inhaGuideDialog({ onGo: () => { openTab(a.href); if (onOpen) onOpen(); }, returnFocus: a });
  });
  a.addEventListener("auxclick", (e) => { if (e.button === 1 && onOpen) onOpen(); });
  return a;
}

// KISS 임시안(G-4): 기다리지 않고 복사를 시작만 한다(바로 이어서 새 탭을 연다). 토스트는 결과 하나만
export function copySearchQuery(q) {
  const done = (ok) => toast(ok ? "검색어를 복사했어요. KISS 검색창에 붙여 넣으세요."
    : "검색어를 복사하지 못했어요. KISS 검색창에 직접 입력해 주세요.", "", { duration: 8000 });
  let p;
  try { p = navigator.clipboard.writeText(q); } catch (e) { p = Promise.reject(e); }
  p.then(() => done(true), () => done(false));
}

// ------------------------------------------------------------ 저장 공간 (D14)
// 비율은 내림(79.6%를 80%로 보이면서 level은 ok인 어긋남을 막음), 색 · 문구는 서버 level을 따른다
export function usageInfo(u) {
  const pct = u.limit_bytes ? Math.floor((u.used_bytes / u.limit_bytes) * 100) : 100;
  const used = fmtBytes(u.used_bytes);
  const limit = fmtBytes(u.limit_bytes);
  const level = ["ok", "warn", "full"].includes(u.level) ? u.level : "ok";
  const msg = level === "warn" ? `저장 공간 ${pct}% 사용 중 (${used} / ${limit}) · 관리자에게 알려 주세요.`
    : level === "full" ? `저장 공간이 거의 찼어요 (${pct}%). PDF를 더 올릴 수 없어요. 관리자에게 알려 주세요.` : "";
  return { pct, used, limit, mine: fmtBytes(u.mine_bytes), level, msg };
}

// 설정 창 · 업로드 창의 큰 사용량 묶음
export function usageBlock(u, { hint = true, notice = true, level = null } = {}) {
  const x = usageInfo(u);
  const lv = level || x.level;
  const w = Math.min(100, x.pct);
  return el(`<div class="usage-block" data-usage data-level="${lv}">
    <div class="usage-head"><span>저장 공간</span><span class="usage-num" data-usage-text>전체 ${esc(x.used)} / ${esc(x.limit)} · 내 PDF ${esc(x.mine)}</span></div>
    <div class="usage-bar lg" role="meter" aria-label="저장 공간" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${w}"
      aria-valuetext="${esc(x.limit)} 중 ${esc(x.used)} 사용"><span style="width:${w}%"></span></div>
    ${hint ? `<div class="hint">PDF와 DB 백업이 함께 쓰는 공간이에요(모든 사용자 합계). 80%를 넘으면 알려 드리고, 95%를 넘으면 PDF를 더 올릴 수 없어요.</div>` : ""}
    ${notice ? `<div class="notice ${x.msg ? "" : "hidden"}" data-tone="${lv === "full" ? "danger" : "warn"}" data-usage-msg>${lv === "full" ? ICON_ALERT : ICON_WARN}<div>${esc(x.msg)}</div></div>` : ""}
  </div>`);
}

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
  let s, status;
  try {
    [s, status] = await Promise.all([api.get("/api/settings"), api.get("/api/ai/status")]);
  } catch (e) { return errorToast(e); }
  const usageP = refreshUsage(); // 설정 창 열 때 사용량을 다시 받는다 (사이드바 막대도 함께)
  const models = state.meta.models;
  const styles = await listStyles(true).catch(() => []);
  const formats = await listFormats(true).catch(() => null);
  const fmtDefault = s.doc_format_default || "default";
  const keyUnreadable = s.anthropic_api_key_status === "unreadable";
  const user = state.user || {};
  const body = el(`<form autocomplete="off">
    <div class="section-title" style="margin-top:0">AI (요약 · 논문과 대화)</div>
    <div class="field"><label>AI 엔진</label>
      <div class="seg" id="engine-seg">
        <button type="button" data-v="api" class="active">Anthropic API</button>
        <button type="button" data-v="cli" disabled aria-describedby="cli-soon">Claude CLI</button>
      </div>
      <div class="hint" id="engine-hint">PDF를 그림·수식까지 통째로 읽고, 답변에 쪽 번호 근거가 붙어요. 사용량만큼 요금이 나가요.</div>
      <div class="hint is-strong" id="cli-soon">Claude CLI는 PC 연결(2단계) 뒤에 쓸 수 있어요.</div>
    </div>
    <div class="field api-only"><label for="set-api-key">Anthropic API 키</label>
      <input class="input" type="password" id="set-api-key" name="anthropic_api_key" placeholder="${s.anthropic_api_key_set ? "저장됨 (바꾸려면 새 키 입력)" : "sk-ant-..."}">
      ${keyUnreadable ? `<div class="notice" data-tone="warn" data-key-warn style="margin-top:6px">${ICON_WARN}<div>저장된 키를 읽지 못했어요. 키를 다시 입력해 주세요.</div></div>` : ""}
      <div class="hint">키는 계정별로 암호화해 클라우드에 저장돼요. PC를 꺼도 AI를 쓰려면 API 키가 필요해요. <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">키 발급받기</a>
      ${s.anthropic_api_key_set || keyUnreadable ? ' · <a href="#" id="clear-key">저장된 키 지우기</a>' : ""}</div>
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
    <div class="field"><label for="set-contact-email">연락처 이메일 (선택)</label><input class="input" id="set-contact-email" name="contact_email" value="${esc(s.contact_email)}" placeholder="you@example.com" aria-describedby="set-contact-hint">
      <div class="hint" id="set-contact-hint">Crossref에 이메일을 알려 주면 요청이 우선 처리돼요(OpenAlex에는 보내지 않아요).</div></div>
    <div class="grid-2">
      <div class="field"><label for="set-oa-key">OpenAlex API 키 (선택)</label><input class="input" type="password" id="set-oa-key" name="openalex_api_key" placeholder="${s.openalex_api_key_set ? "저장됨" : "없어도 돼요"}" aria-describedby="set-oa-key-hint set-keys-note">
        <div class="hint" id="set-oa-key-hint">무료 키를 넣으면 하루 사용 한도가 10배가 돼요.</div></div>
      <div class="field"><label for="set-s2-key">Semantic Scholar API 키 (선택)</label><input class="input" type="password" id="set-s2-key" name="semantic_scholar_api_key" placeholder="${s.semantic_scholar_api_key_set ? "저장됨" : "없어도 돼요"}" aria-describedby="set-s2-key-hint set-keys-note">
        <div class="hint" id="set-s2-key-hint">키가 있으면 요청이 덜 막혀요.</div></div>
    </div>
    <div class="field keys-note"><div class="hint" id="set-keys-note">키는 검색과 인용 그래프에 쓰여요. 키 없이 쓰면 하루 한도가 작아 그래프를 만들지 못할 때가 있어요. 키로 받은 공개 서지 정보(제목 · 저자 · 인용 관계)도 모든 사용자가 함께 쓰는 저장소에 들어가고, OpenAlex · Semantic Scholar 쪽에는 키 주인의 사용량으로 기록돼요. PaperLab은 누가 어떤 논문을 조회했는지 남기지 않아요.</div></div>

    <div class="section-title" id="set-school-title">학교 연결 (${esc(INHA.label)})</div>
    <div class="field" role="group" aria-labelledby="set-school-title">
      <div class="row school-conn">
        <a class="btn sm" href="${esc(INHA.loginUrl)}" target="_blank" rel="noopener noreferrer" data-inha-login aria-describedby="set-school-g2">${esc(INHA.buttons.login)}${EXT_MARK}</a>
        <button type="button" class="btn sm ghost" data-inha-guide>처음 안내 다시 보기</button>
      </div>
      <div class="school-conn-notes">
        <div class="hint is-strong" id="set-school-g2">${esc(SCHOOL_LOGIN_NOTE)}</div>
        <div class="hint">${esc(SCHOLAR_LIBRARY_NOTE)}</div>
      </div>
    </div>

    <div class="section-title">계정</div>
    <div class="account-card">
      <span data-avatar></span>
      <div class="account-card-id"><div class="account-card-name">${esc(user.name || "")}</div><div class="account-card-email">${esc(user.email || "")}</div></div>
      <button type="button" class="btn sm" data-logout>로그아웃</button>
    </div>
    <div data-usage-slot><div class="status-line"><span class="spinner"></span> 저장 공간 사용량을 불러오는 중…</div></div>
  </form>`);
  $("[data-avatar]", body).replaceWith(avatarEl(user, true));
  bindExtLink($("[data-inha-login]", body));
  $("[data-inha-guide]", body).onclick = (e) => inhaGuideDialog({ returnFocus: e.currentTarget });
  // 저장된 ai_engine이 cli여도 1단계는 API만 보여 주고, 저장하면 api가 된다 (명세 8.1)
  const engine = "api";
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
  // 저장 공간 (D14): 못 받으면 안내 한 줄
  usageP.then((u) => {
    const slot = $("[data-usage-slot]", body);
    slot.innerHTML = "";
    slot.appendChild(u ? usageBlock(u) : el(`<p class="small" style="color:var(--text-2)">저장 공간 사용량을 불러오지 못했어요.</p>`));
  });
  // 로그아웃: 저장하지 않은 설정은 버리고 바로 (시안 8장)
  $("[data-logout]", body).onclick = () => {
    m.close();
    if (actions.logout) actions.logout();
  };
  const clear = $("#clear-key", body);
  if (clear) clear.onclick = async (e) => {
    e.preventDefault();
    try {
      state.settings = await api.put("/api/settings", { anthropic_api_key: null });
      toast("저장된 API 키를 지웠어요");
      m.close();
    } catch (err) { errorToast(err); }
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
  if (state.view === "library" && state.filter.kind === "folder") payload.folder_id = state.filter.id;
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
        if (state.filter.kind === "folder") fd.folder_id = state.filter.id;
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
// 브라우저 → 서명 주소로 저장소(R2)에 바로 올리고, 서버가 그 파일을 읽어 논문을 만든다 (명세 7.2, 시안 12장)
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const PARALLEL = 3; // 동시에 올리는 파일 수 (명세 7.2 가정)
const batches = new Set(); // 진행 중인 업로드 창들 (탭 닫기 확인 · 로그아웃 때 멈춤)

export const uploadsRunning = () => [...batches].some((b) => b.running());

export function cancelUploads() {
  for (const b of batches) b.cancelAll();
}

const isPdf = (f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf";

function fmtSize(n) {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return fmtBytes(n);
}

// 저장소 어댑터: 서버가 준 backend · upload 값대로 보낸다 (지금은 서명 주소 PUT 하나 — 저장소를 바꿔도 여기만)
function putToStorage(slot, file, onProgress) {
  const up = slot.upload || {};
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    if (up.method !== "PUT" || !up.url) {
      reject(Object.assign(new Error("지원하지 않는 저장소예요"), { unsupported: true }));
      return;
    }
    xhr.open("PUT", up.url);
    for (const [k, v] of Object.entries(up.headers || {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve()
      : reject(Object.assign(new Error(`HTTP ${xhr.status}`), { status: xhr.status })));
    xhr.onerror = () => reject(Object.assign(new Error("network"), { network: true }));
    xhr.onabort = () => reject(Object.assign(new Error("abort"), { aborted: true }));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

const isFullError = (e) => e && e.status === 400 && /저장 공간이 거의 찼어요/.test(e.message || "");
const noRetryError = (msg) => /100MB 초과|PDF 파일이 아니에요|PDF를 열 수 없어요/.test(msg || "");

// 저장 공간이 꽉 찼을 때 목록 대신 보이는 안내 (시안 12.1)
function blockedView(u) {
  const v = el(`<div class="upload-blocked" data-upload-blocked>
    <div class="notice" data-tone="danger" role="alert">${ICON_ALERT}<div><b>저장 공간이 거의 찼어요.</b> PDF를 더 올릴 수 없어요. 관리자에게 알려 주세요.</div></div>
    <p class="small" style="margin:0;color:var(--text-2)">필요 없는 논문을 지우면 그 PDF만큼 공간이 생겨요.</p></div>`);
  const put = (x) => {
    const b = usageBlock(x, { hint: false, notice: false, level: "full" });
    b.style.margin = "0";
    $(".notice", v).after(b);
  };
  if (u) put(u);
  else refreshUsage().then((x) => { if (x) put(x); });
  return v;
}

function blockedDialog(title, u) {
  const foot = el(`<div style="display:contents"><button class="btn primary" data-close-upload>닫기</button></div>`);
  const m = modal({ title, body: blockedView(u), foot });
  $("[data-close-upload]", foot).onclick = () => m.close();
  setTimeout(() => $("[data-close-upload]", foot).focus(), 40);
}

// files: 올릴 PDF들. attachTo: 이미 있는 논문 id(PDF 첨부 · 바꾸기 — 파일 하나)
export async function uploadPdfs(files, { attachTo = null, replace = false } = {}) {
  files = (files || []).filter(isPdf);
  if (!files.length) return toast("PDF 파일만 올릴 수 있어요", "error");
  if (attachTo) files = files.slice(0, 1);
  const title = attachTo ? (replace ? "PDF 바꾸기" : "PDF 첨부") : "PDF 추가";
  const known = state.usage;
  if (known && known.level === "full") return blockedDialog(title, known);
  // 지금 보고 있는 컬렉션 · 폴더에 넣는다
  const into = {};
  if (!attachTo && state.view === "library" && state.filter.kind === "collection") into.collection_id = state.filter.id;
  if (!attachTo && state.view === "library" && state.filter.kind === "folder") into.folder_id = state.filter.id;

  const warn = known && known.level === "warn" ? usageInfo(known).msg : "";
  const body = el(`<div>
    ${warn ? `<div class="notice" data-tone="warn" data-upload-storage style="margin-bottom:8px">${ICON_WARN}<div>${esc(warn)}</div></div>` : ""}
    <div class="status-line" data-upload-summary aria-live="polite"></div>
    <div class="upload-list" data-upload-list></div></div>`);
  const foot = el(`<div style="display:contents"></div>`);
  let closed = false;
  const m = modal({ title, body, foot, onClose: () => { closed = true; } });

  const items = files.map((file) => ({ file, state: "waiting", pct: 0, msg: "", title: "", warnings: [], retry: false }));
  let active = 0;
  let announced = false;
  let blocked = false;
  const batch = {
    running: () => items.some((it) => ["waiting", "uploading", "processing"].includes(it.state)),
    cancelAll,
  };
  batches.add(batch);

  const list = $("[data-upload-list]", body);
  for (const it of items) {
    it.row = el(`<div class="upload-item" data-state="waiting">
      <span class="upload-st" aria-hidden="true"></span>
      <div class="upload-main">
        <div class="upload-name"><span class="upload-file"></span><span class="upload-size">${esc(fmtSize(it.file.size))}</span></div>
        <div class="progress" role="progressbar" aria-label="${esc(it.file.name)} 올리기" aria-valuemin="0" aria-valuemax="100"><div></div></div>
        <div class="upload-msg"></div>
      </div></div>`);
    list.appendChild(it.row);
    draw(it);
  }

  function draw(it) {
    const r = it.row;
    r.dataset.state = it.state;
    const st = $(".upload-st", r);
    st.innerHTML = it.state === "uploading" || it.state === "processing" ? `<span class="spinner"></span>`
      : esc({ waiting: "○", done: "✓", duplicate: "＝", error: "✕" }[it.state]);
    $(".upload-file", r).textContent = (it.state === "done" || it.state === "duplicate") && it.title ? it.title : it.file.name;
    const bar = $(".progress", r);
    bar.classList.toggle("indeterminate", it.state === "processing");
    $("div", bar).style.width = it.state === "uploading" ? `${it.pct}%` : "0%";
    if (it.state === "uploading") bar.setAttribute("aria-valuenow", it.pct); else bar.removeAttribute("aria-valuenow");
    $(".upload-msg", r).textContent = it.state === "waiting" ? "기다리는 중"
      : it.state === "uploading" ? `올리는 중 · ${it.pct}%`
        : it.state === "processing" ? (attachTo ? "PDF를 읽는 중…" : "논문 정보를 찾는 중…") : it.msg;
    $$(".upload-warn", r).forEach((w) => w.remove());
    for (const w of it.warnings) $(".upload-main", r).appendChild(el(`<div class="upload-warn">${esc(w)}</div>`));
    const btn = $("[data-retry]", r);
    if (it.state === "error" && it.retry) {
      if (!btn) {
        const b = el(`<button type="button" class="btn sm" data-retry>다시 시도</button>`);
        b.onclick = () => retry(it);
        r.appendChild(b);
      }
    } else if (btn) btn.remove();
  }

  function fail(it, msg, canRetry) {
    it.state = "error";
    it.msg = msg;
    it.retry = canRetry;
    draw(it);
  }

  // 서명 주소 받기 → 올리기 → 서버 처리
  async function run(it) {
    it.cancelled = false;
    it.state = "uploading";
    it.pct = 0;
    it.warnings = [];
    draw(it);
    let phase = "slot";
    try {
      if (it.file.size > MAX_PDF_BYTES) return fail(it, "파일이 너무 커요 (100MB 초과)", false);
      let slot;
      if (attachTo) slot = await api.post(`/api/papers/${attachTo}/pdf/upload`);
      else {
        const r = await api.post("/api/uploads", { files: [{ name: it.file.name, size: it.file.size }] });
        slot = (r.files || [])[0] || {};
        if (slot.error) return fail(it, slot.error, false);
      }
      if (it.cancelled) return fail(it, "취소했어요", false);
      phase = "put";
      const put = putToStorage(slot, it.file, (f) => {
        const pct = Math.min(100, Math.floor(f * 100));
        if (pct !== it.pct) { it.pct = pct; draw(it); }
      });
      it.abort = put.abort;
      await put.promise;
      it.abort = null;
      phase = "complete";
      it.state = "processing";
      draw(it);
      if (attachTo) {
        const r = await api.post(`/api/papers/${attachTo}/pdf/complete`, { upload_id: slot.upload_id });
        it.state = "done";
        it.id = attachTo;
        it.title = (r.paper && r.paper.title) || "";
        it.msg = `${it.file.name} · ${replace ? "PDF를 바꿨어요" : "PDF를 붙였어요"}`;
        it.warnings = r.warnings || [];
      } else {
        const r = await api.post(`/api/uploads/${encodeURIComponent(slot.upload_id)}/complete`,
          { name: it.file.name, lookup: true, ...into });
        if (r.error) return fail(it, r.error, false);
        it.id = r.id;
        it.title = r.title || "";
        it.state = r.duplicate ? "duplicate" : "done";
        it.msg = r.duplicate ? `${r.file || it.file.name} · ${r.note || "이미 서재에 있어요"}`
          : `${r.file || it.file.name} · ${r.note || `정보 출처: ${r.matched_by}`}`;
        it.warnings = r.warnings || [];
      }
      draw(it);
    } catch (e) {
      it.abort = null;
      if (e.aborted || it.cancelled) return fail(it, "취소했어요", false);
      if (isFullError(e)) return block();
      if (phase === "put") {
        if (e.status === 403) return fail(it, "올리기 시간이 지났어요. 다시 시도해 주세요.", true);
        if (e.unsupported) return fail(it, e.message, false);
        return fail(it, "올리지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.", true);
      }
      fail(it, e.message || "올리지 못했어요", !noRetryError(e.message));
    }
  }

  function pump() {
    while (!blocked && active < PARALLEL) {
      const next = items.find((x) => x.state === "waiting" && !x.started);
      if (!next) break;
      next.started = true;
      active++;
      run(next).finally(() => { active--; pump(); update(); });
    }
    update();
  }

  // 다시 시도: 서명 주소부터 새로 받는다
  function retry(it) {
    it.started = false;
    it.state = "waiting";
    it.retry = false;
    announced = false;
    batches.add(batch);
    draw(it);
    pump();
  }

  function cancelAll() {
    for (const it of items) {
      if (it.state === "waiting") { it.started = true; fail(it, "취소했어요", false); }
      else if (it.state === "uploading") { it.cancelled = true; if (it.abort) it.abort(); }
    }
    update();
  }

  // 저장 공간이 꽉 참: 남은 것은 멈추고 목록 대신 안내 (시안 12.1)
  function block() {
    if (blocked) return;
    blocked = true;
    cancelAll();
    batches.delete(batch);
    body.innerHTML = "";
    body.appendChild(blockedView(null));
    foot.innerHTML = `<button class="btn primary" data-close-upload>닫기</button>`;
    $("[data-close-upload]", foot).onclick = () => m.close();
    if (!closed) $("[data-close-upload]", foot).focus();
  }

  function update() {
    if (blocked) return;
    const n = (st) => items.filter((it) => it.state === st).length;
    const finished = n("done") + n("duplicate") + n("error");
    const summary = $("[data-upload-summary]", body);
    if (batch.running()) {
      summary.className = "status-line";
      summary.innerHTML = `<span class="spinner"></span><span>PDF ${items.length}개를 올리고 있어요 · ${finished}개 끝남</span>`;
      if (!foot.querySelector("[data-cancel-all]")) {
        foot.innerHTML = `<div class="left"><span class="upload-foot-note">올리는 동안 이 탭을 닫지 마세요</span></div>
          <button class="btn" data-cancel-all>모두 취소</button>`;
        $("[data-cancel-all]", foot).onclick = cancelAll;
      }
      return;
    }
    const added = n("done");
    const cancelled = items.filter((it) => it.state === "error" && it.msg === "취소했어요").length;
    const failed = n("error") - cancelled;
    const skipped = n("duplicate") + cancelled;
    if (attachTo) {
      summary.className = `status-line ${added ? "ok" : "bad"}`;
      summary.textContent = added ? `✓ ${replace ? "PDF를 바꿨어요" : "PDF를 붙였어요"}` : `✕ ${replace ? "PDF를 바꾸지 못했어요" : "PDF를 붙이지 못했어요"}`;
    } else {
      summary.className = `status-line ${added ? "ok" : ""}`;
      summary.textContent = `✓ ${added}개 추가 · ${skipped}개 건너뜀${failed ? ` · ${failed}개 실패` : ""}`;
    }
    if (!foot.querySelector("[data-close-upload]")) {
      foot.innerHTML = `<button class="btn primary" data-close-upload>닫기</button>`;
      $("[data-close-upload]", foot).onclick = () => m.close();
      if (!closed) $("[data-close-upload]", foot).focus();
    }
    if (announced) return;
    announced = true;
    batches.delete(batch);
    const first = items.find((it) => it.id);
    if (first && !attachTo) state.activeId = first.id;
    if (added || n("duplicate")) { refreshAll(); refreshUsage(); }
    // 창을 닫은 뒤에 끝났으면 토스트로 알린다
    if (closed && (added || failed)) {
      if (attachTo) toast(added ? (replace ? "PDF를 바꿨어요" : "PDF를 붙였어요") : (replace ? "PDF를 바꾸지 못했어요" : "PDF를 붙이지 못했어요"), added ? "success" : "error");
      else toast(`PDF ${added}개를 추가했어요${failed ? ` · ${failed}개는 실패했어요` : ""}`, "", { duration: 8000 });
    }
  }

  pump();
}

// ------------------------------------------------------------ 폴더 고르기 (D9)
// 트리 순서(부모 다음 자식, 같은 단계는 이름순)로 펼친 목록 [{f, depth}]
export function folderTreeList(folders = state.folders) {
  const byParent = new Map();
  for (const f of folders) {
    const k = f.parent_id || 0;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(f);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const out = [];
  const walk = (pid, depth) => {
    for (const f of byParent.get(pid) || []) {
      out.push({ f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(0, 0);
  return out;
}

// 폴더 경로 ["졸업논문", "2장 선행연구"]
export function folderPath(fid) {
  const byId = new Map(state.folders.map((f) => [f.id, f]));
  const names = [];
  const seen = new Set();
  for (let f = byId.get(fid); f && !seen.has(f.id); f = byId.get(f.parent_id)) {
    seen.add(f.id);
    names.unshift(f.name);
  }
  return names;
}

// 자기와 하위 폴더 id (폴더 옮기기에서 고를 수 없음)
export function folderSubtree(fid) {
  const out = new Set([fid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of state.folders) if (out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

// current: 지금 위치(null = 폴더 없음/맨 위, undefined = 여러 편이라 없음). 고르면 {value: id|null}, 취소하면 null
export function folderPickDialog({ title, current = undefined, firstLabel = "폴더 없음", disabled = new Set() }) {
  return new Promise((resolve) => {
    let result = null;
    let picked = current === undefined ? undefined : current;
    const body = el(`<form class="folder-pick" data-folder-pick><div class="folder-pick-list" role="radiogroup" aria-label="옮길 폴더"></div></form>`);
    const foot = el(`<div style="display:contents">
      <div class="left"><button type="button" class="btn" data-folder-new title="고른 폴더 안에 새 폴더를 만들어요">새 폴더…</button></div>
      <button type="button" class="btn" data-no>취소</button>
      <button type="button" class="btn primary" data-yes>옮기기</button></div>`);
    const m = modal({ title, body, foot, onClose: () => resolve(result) });
    m.el.querySelector(".modal").classList.add("folder-modal");
    const listEl = $(".folder-pick-list", body);
    const yes = $("[data-yes]", foot);
    const valueOf = (v) => (v === "" ? null : Number(v));
    const sync = () => { yes.disabled = picked === undefined || picked === current; };

    const draw = () => {
      listEl.innerHTML = "";
      const opt = (value, name, depth, none, path) => {
        const isCur = current !== undefined && valueOf(value) === current;
        const off = value !== "" && disabled.has(Number(value));
        const o = el(`<label class="folder-opt ${isCur ? "is-current" : ""} ${off ? "is-disabled" : ""}" style="--depth:${depth}" title="${esc(path)}">
          <input type="radio" name="folder" value="${value}" ${off ? "disabled" : ""}>${folderIcon(none)}
          <span class="folder-opt-name">${esc(name)}</span>${isCur ? `<span class="chip">지금 위치</span>` : ""}</label>`);
        const input = $("input", o);
        input.checked = picked !== undefined && valueOf(value) === picked;
        input.onchange = () => { picked = valueOf(input.value); sync(); };
        listEl.appendChild(o);
      };
      opt("", firstLabel, 0, true, firstLabel);
      for (const { f, depth } of folderTreeList()) opt(String(f.id), f.name, depth, false, folderPath(f.id).join(" › "));
      $$(".folder-pick-empty", body).forEach((x) => x.remove());
      if (!state.folders.length) body.appendChild(el(`<div class="folder-pick-empty">아직 폴더가 없어요. [새 폴더…]로 만들어 보세요.</div>`));
      sync();
    };
    draw();
    const focusPicked = () => {
      const input = $("input:checked", listEl) || $("input:not(:disabled)", listEl);
      if (input) input.focus();
    };
    setTimeout(focusPicked, 40);

    const submit = () => {
      if (yes.disabled) return;
      result = { value: picked };
      m.close();
    };
    body.onsubmit = (e) => { e.preventDefault(); submit(); };
    // 라디오에서 Enter = 옮기기
    body.onkeydown = (e) => { if (e.key === "Enter" && e.target.matches("input[type=radio]")) { e.preventDefault(); submit(); } };
    yes.onclick = submit;
    $("[data-no]", foot).onclick = () => m.close();
    $("[data-folder-new]", foot).onclick = async () => {
      const parent = picked !== undefined && picked !== null && !disabled.has(picked) ? picked : null;
      const name = await promptDialog("새 폴더 이름", { placeholder: "예: 2장 선행연구, 학회 발표 자료" });
      if (!name) return focusPicked();
      try {
        const { id } = await api.post("/api/folders", { name, parent_id: parent });
        state.folders = await api.get("/api/folders");
        picked = id;
        draw();
        focusPicked();
        refreshAll();
      } catch (e) { errorToast(e); }
    };
  });
}

export function movedText(n, fid) {
  if (fid == null) return `${n}편을 폴더 밖으로 옮겼어요`;
  const f = state.folders.find((x) => x.id === fid);
  return `${n}편을 ‘${f ? f.name : "폴더"}’ 폴더로 옮겼어요`;
}

// 논문을 폴더로 옮기기: 한 편이면 current = 그 논문의 folder_id
export async function moveToFolderDialog(ids, current = undefined) {
  if (!ids.length) return;
  const one = ids.length === 1;
  const r = await folderPickDialog({ title: one ? "폴더로 이동" : `${ids.length}편을 폴더로 이동`, current: one ? (current ?? null) : undefined });
  if (!r) return;
  try {
    await api.post("/api/papers/bulk", { ids, action: "move_folder", value: r.value });
    toast(movedText(ids.length, r.value));
    refreshAll();
  } catch (e) { errorToast(e); }
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
