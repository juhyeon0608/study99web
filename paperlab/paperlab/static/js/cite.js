// 인용 엔진: citeproc-js(Zotero·Mendeley와 같은 엔진) + 공식 CSL 스타일로 인용 문구와 참고문헌을 만든다

import { api } from "./api.js";
import { state } from "./state.js";

let stylesCache = null;
let enginePromise = null;
const styleXmlCache = new Map();
const localeCache = new Map();

function loadEngine() {
  if (window.CSL) return Promise.resolve(window.CSL);
  if (!enginePromise) {
    enginePromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/static/vendor/citeproc.js";
      s.onload = () => resolve(window.CSL);
      s.onerror = () => { enginePromise = null; reject(new Error("인용 엔진을 불러오지 못했어요")); };
      document.head.appendChild(s);
    });
  }
  return enginePromise;
}

export async function listStyles(force = false) {
  if (!stylesCache || force) stylesCache = await api.get("/api/styles");
  return stylesCache;
}

export function styleOptions(styles, selected) {
  const groups = new Map();
  for (const s of styles) {
    const g = s.builtin ? s.group : "내가 추가한 스타일";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  return [...groups].map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((s) =>
    `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.short)}${s.format === "numeric" ? " · 번호" : s.note ? " · 각주" : ""}</option>`).join("")}</optgroup>`).join("");
}

async function styleXml(id) {
  if (!styleXmlCache.has(id)) {
    const res = await api.raw("GET", `/api/styles/${encodeURIComponent(id)}`);
    if (!res.ok) {
      let msg = "인용 스타일을 불러오지 못했어요";
      try { msg = (await res.json()).detail || msg; } catch { /* 본문 없음 */ }
      throw new Error(msg);
    }
    styleXmlCache.set(id, await res.text());
  }
  return styleXmlCache.get(id);
}

async function preloadLocale(lang) {
  if (localeCache.has(lang)) return;
  const res = await fetch(`/static/vendor/csl/locales/locales-${lang}.xml`);
  if (res.ok) localeCache.set(lang, await res.text());
}

export function forgetStyle(id) {
  styleXmlCache.delete(id);
  stylesCache = null;
}

const isKorean = (it) => it.language === "ko" || /[가-힣]/.test(it.title || "");

/**
 * items: CSL-JSON 배열 (순서 = 번호식 스타일의 번호 순서)
 * 결과: { entries: [{id, html, text}], citation: {html, text}, numeric, note }
 */
export async function render(items, { style, locale, koreanFirst = false } = {}) {
  const CSL = await loadEngine();
  style = style || state.settings.citation_style || "apa";
  locale = locale || state.settings.citation_locale || "en-US";
  const xml = await styleXml(style);
  const defaultLocale = (xml.match(/<style[^>]*default-locale="([^"]+)"/) || [])[1];
  await Promise.all(["en-US", locale, defaultLocale].filter(Boolean).map(preloadLocale));
  const byId = new Map(items.map((it) => [String(it.id), it]));
  const sys = {
    retrieveLocale: (lang) => localeCache.get(lang) || localeCache.get(lang.replace("_", "-"))
      || [...localeCache].find(([k]) => k.startsWith(lang.slice(0, 2)))?.[1] || localeCache.get("en-US"),
    retrieveItem: (id) => byId.get(String(id)),
  };
  // 한국어 용어를 고르면 스타일 기본 언어보다 우선, 영어면 스타일 기본 언어(예: Nature는 영국식)를 따른다
  const engine = new CSL.Engine(sys, xml, locale, locale === "ko-KR");
  const ids = items.map((it) => String(it.id));
  engine.updateItems(ids);
  const numeric = /citation-format="numeric"/.test(xml) || /variable="citation-number"/.test(xml);
  const note = engine.opt.xclass === "note";

  const out = { entries: [], citation: { html: "", text: "" }, numeric, note };
  const build = (format) => {
    engine.setOutputFormat(format);
    const bib = engine.makeBibliography();
    const cluster = ids.length ? engine.makeCitationCluster(ids.map((id) => ({ id }))) : "";
    return { bib, cluster };
  };
  const html = build("html");
  const text = build("text");
  out.citation = { html: html.cluster, text: text.cluster };
  if (html.bib) {
    const [meta, entries] = html.bib;
    const textEntries = text.bib[1];
    out.entries = entries.map((h, i) => ({
      id: String(meta.entry_ids[i][0]),
      html: cleanEntry(h),
      text: textEntries[i].replace(/\s+/g, " ").trim(),
    }));
    out.hangingIndent = !!meta.hangingindent;
  }
  if (koreanFirst && !numeric && !note) {
    const ko = out.entries.filter((e) => isKorean(byId.get(e.id)));
    out.entries = [...ko, ...out.entries.filter((e) => !ko.includes(e))];
  }
  return out;
}

function cleanEntry(h) {
  // citeproc 출력의 div 구조(번호 칸 등)를 한 줄로 정리하고 안전하게 거른다
  let s = h.replace(/<div class="csl-left-margin">(.*?)<\/div>\s*<div class="csl-right-inline">(.*?)<\/div>/s, "$1 $2");
  s = s.replace(/^\s*<div class="csl-entry">/, "").replace(/<\/div>\s*$/, "").trim();
  return window.DOMPurify ? window.DOMPurify.sanitize(s, { ALLOWED_TAGS: ["i", "b", "em", "strong", "sup", "sub", "span", "a"], ALLOWED_ATTR: ["href", "style"] }) : s;
}

// APA 등은 논문 제목을 문장형 대소문자로 쓴다. 약어(BERT)·대소문자 혼합(ImageNet)·첫 단어는 그대로 둔다
export function sentenceCase(title) {
  let capNext = true;
  return title.split(/(\s+)/).map((tok) => {
    if (/^\s+$/.test(tok)) return tok;
    const keep = capNext;
    capNext = /[:?!.]$/.test(tok) || /^[—–-]$/.test(tok);
    if (keep) return tok;
    return tok.split("-").map((part) => {
      const m = part.match(/^([^A-Za-z]*)([A-Z])([a-z'’]*)([^A-Za-z]*)$/);
      return m && m[3].length ? m[1] + m[2].toLowerCase() + m[3] + m[4] : part;
    }).join("-");
  }).join("");
}
