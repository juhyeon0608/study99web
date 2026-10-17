'use strict';
// ZIP + XML 문서의 글만 뽑기 (명세 selective-sync.md 9.5.1 · 9.5.2절, D-14): .docx · .hwpx · .pptx · .xlsx · .odt · .odp · .ods.
// 표 · 그림 · 각주 구조는 보존하지 않음(글만). 조각 단위: 문서(.docx · .hwpx · .odt) = 문단을 이어 약 3,000자, .pptx = 슬라이드,
// .xlsx = 시트(행 = 줄, 칸 = 탭, 시트당 2만 칸), .odp = 그리기 페이지, .ods = 표. 상한(2,000조각 · 8MB)은 limitPages 가 마지막에 자름.

const { readZip } = require('./zip');
const { walkXml } = require('./xmltext');
const { LIMITS, ExtractError } = require('./kinds');

const num = (name, re) => { const m = re.exec(name); return m ? Number(m[1]) : NaN; };
const byNumber = (re) => (a, b) => num(a, re) - num(b, re);

/**
 * XML 하나 → 문단 배열. spec = {text: Set(글을 모을 요소), para: Set(끝에서 문단을 끊을 요소), tab, br: Set, space: Set(text:s — c 속성 수만큼 공백),
 *   skip: Set(안을 읽지 않을 요소), cell: Set(칸 — 끝에서 탭), row: Set(행 — 끝에서 줄), unit: Set(끝에서 조각을 끊을 요소)}
 * → {paras: string[], units: string[][]} (unit 이 있으면 단위별 문단 묶음)
 */
function collect(xml, spec) {
  const S = (k) => spec[k] || new Set();
  const text = S('text'); const para = S('para'); const tab = S('tab'); const br = S('br'); const space = S('space');
  const skip = S('skip'); const cell = S('cell'); const row = S('row'); const unit = S('unit');
  const units = [];
  let paras = [];
  let cur = '';
  let inText = 0;
  let inSkip = 0;
  let inCell = 0;
  const endPara = (sep) => { if (inCell) { cur += sep === '\n' ? ' ' : sep; return; } paras.push(cur); cur = ''; };
  // walkXml 은 스스로 닫는 태그(<a/>)에도 close 를 부르므로 여는 수 · 닫는 수가 늘 짝이 맞음
  walkXml(xml, {
    open(name, attrs) {
      if (inSkip || skip.has(name)) { inSkip++; return; }
      if (text.has(name)) inText++;
      if (cell.has(name)) inCell++;
      if (tab.has(name)) cur += '\t';
      else if (br.has(name)) cur += '\n';
      else if (space.has(name)) cur += ' '.repeat(Math.min(1000, Math.max(1, Number(attrs.c) || 1)));
    },
    close(name) {
      if (inSkip) { inSkip--; return; }
      if (text.has(name) && inText) inText--;
      if (para.has(name)) endPara('\n');
      if (cell.has(name) && inCell) { inCell--; cur = `${cur.replace(/ +$/, '')}\t`; }
      if (row.has(name)) { paras.push(cur.replace(/\t+$/, '')); cur = ''; }
      if (unit.has(name)) { if (cur) paras.push(cur); cur = ''; units.push(paras); paras = []; }
    },
    text(s) { if (inText && !inSkip) cur += s; },
  });
  if (cur) paras.push(cur);
  if (unit.size && paras.some((p) => p.trim())) units.push(paras);
  return { paras, units };
}

/** 문단 배열 → 약 size 자 조각(문단 경계에서, 한 문단이 넘으면 그 자리에서 자름) */
function chunkParas(paras, size = LIMITS.chunkChars) {
  const out = [];
  let cur = '';
  for (const raw of paras) {
    const p = String(raw).replace(/\s+$/, '');
    if (!p.trim()) continue;
    if (cur && cur.length + 1 + p.length > size) { out.push(cur); cur = ''; }
    if (p.length > size) {
      for (let i = 0; i < p.length; i += size) {
        const part = p.slice(i, i + size);
        if (cur) { out.push(cur); cur = ''; }
        if (part.length === size) out.push(part); else cur = part;
      }
      continue;
    }
    cur = cur ? `${cur}\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

/** 조각 상한(2,000개 · 8MB) — 넘으면 그 자리에서 멈춤(잘린 표시 없이 — 9.5.1절) */
function limitPages(pages) {
  const out = [];
  let bytes = 0;
  for (const p of pages) {
    if (out.length >= LIMITS.maxChunks) break;
    const b = Buffer.byteLength(p, 'utf8');
    if (bytes + b > LIMITS.maxTextBytes) {
      const room = LIMITS.maxTextBytes - bytes;
      if (room > 0) out.push(Buffer.from(p, 'utf8').subarray(0, room).toString('utf8').replace(/�+$/, ''));
      break;
    }
    out.push(p);
    bytes += b;
  }
  return out;
}

const need = (files, name) => {
  const b = files.get(name);
  if (!b) throw new ExtractError('local_unreadable', `missing ${name}`);
  return b;
};

// ------------------------------------------------------------------------------- 형식별
function docx(buf) {
  const files = readZip(buf, (n) => n === 'word/document.xml');
  const { paras } = collect(need(files, 'word/document.xml'), {
    text: new Set(['t']), para: new Set(['p']), tab: new Set(['tab']), br: new Set(['br', 'cr']),
    skip: new Set(['pPr', 'rPr', 'sectPr', 'instrText', 'delText', 'footnoteReference', 'endnoteReference']),
  });
  return chunkParas(paras);
}

const HWPX_SECTION = /^Contents\/section(\d+)\.xml$/;
function hwpx(buf) {
  const files = readZip(buf, (n) => n === 'Contents/content.hpf' || HWPX_SECTION.test(n));
  // 순서: content.hpf 의 spine(itemref → manifest href). 없거나 못 읽으면 section 번호 순
  let order = [];
  const hpf = files.get('Contents/content.hpf');
  if (hpf) {
    const items = new Map();
    const spine = [];
    try {
      walkXml(hpf, {
        open(name, a) { if (name === 'item' && a.id && a.href) items.set(a.id, a.href); else if (name === 'itemref' && a.idref) spine.push(a.idref); },
        close() {}, text() {},
      });
    } catch { /* 순서만 못 읽음 — 번호 순으로 */ }
    order = spine.map((id) => items.get(id)).filter(Boolean).map((h) => (h.startsWith('Contents/') ? h : `Contents/${h.replace(/^\.?\//, '')}`))
      .filter((h, i, arr) => HWPX_SECTION.test(h) && files.has(h) && arr.indexOf(h) === i);
  }
  if (!order.length) order = [...files.keys()].filter((n) => HWPX_SECTION.test(n)).sort(byNumber(HWPX_SECTION));
  if (!order.length) throw new ExtractError('local_unreadable', 'hwpx: no section');
  const paras = [];
  for (const name of order) {
    paras.push(...collect(files.get(name), { text: new Set(['t']), para: new Set(['p']), tab: new Set(['tab']), br: new Set(['lineBreak']) }).paras);
  }
  return chunkParas(paras);
}

const PPTX_SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/;
function pptx(buf) {
  const files = readZip(buf, (n) => PPTX_SLIDE.test(n));
  const names = [...files.keys()].sort(byNumber(PPTX_SLIDE)); // N 숫자 순(presentation.xml 순서는 읽지 않음 — 수용)
  if (!names.length) throw new ExtractError('local_unreadable', 'pptx: no slide');
  return names.map((n) => collect(files.get(n), { text: new Set(['t']), para: new Set(['p']), br: new Set(['br']) }).paras
    .map((p) => p.replace(/\s+$/, '')).filter((p) => p.trim()).join('\n'));
}

const XLSX_SHEET = /^xl\/worksheets\/sheet(\d+)\.xml$/;
function xlsx(buf) {
  const files = readZip(buf, (n) => n === 'xl/sharedStrings.xml' || XLSX_SHEET.test(n));
  const shared = [];
  const ss = files.get('xl/sharedStrings.xml');
  if (ss) {
    let cur = null;
    let inT = 0;
    let inPh = 0;
    walkXml(ss, {
      open(name, _a, self) {
        if (name === 'si' && !self) cur = '';
        else if (name === 'si') shared.push('');
        else if ((name === 'rPh' || name === 'phoneticPr') && !self) inPh++;
        else if (name === 't' && !self) inT++;
      },
      close(name) {
        if (name === 'si' && cur !== null) { shared.push(cur); cur = null; } else if (name === 'rPh' && inPh) inPh--; else if (name === 't' && inT) inT--;
      },
      text(s) { if (inT && !inPh && cur !== null) cur += s; },
    });
  }
  const names = [...files.keys()].filter((n) => XLSX_SHEET.test(n)).sort(byNumber(XLSX_SHEET));
  if (!names.length) throw new ExtractError('local_unreadable', 'xlsx: no sheet');
  return names.map((n) => {
    const rows = [];
    let row = null;
    let cell = null; // {t, v, is}
    let where = '';
    let cells = 0;
    walkXml(files.get(n), {
      open(name, a, self) {
        if (name === 'row') { row = []; if (self) { rows.push(''); row = null; } } else if (name === 'c' && row) {
          cells++;
          cell = cells <= LIMITS.maxCellsPerSheet ? { t: a.t || '', v: '', is: '' } : null;
          if (self && cell) { row.push(''); cell = null; }
        } else if (cell && (name === 'v' || name === 'is')) where = name;
        else if (cell && name === 't' && where === 'is') where = 'is';
      },
      close(name) {
        if (name === 'c' && cell && row) {
          const val = cell.t === 's' ? shared[Number(cell.v)] || '' : cell.t === 'inlineStr' ? cell.is : cell.v;
          row.push(String(val).replace(/[\t\r\n]+/g, ' '));
          cell = null;
        } else if (name === 'row' && row) { rows.push(row.join('\t').replace(/\t+$/, '')); row = null; } else if (name === 'v' || name === 'is') where = '';
      },
      text(s) { if (cell && where === 'v') cell.v += s; else if (cell && where === 'is') cell.is += s; },
    });
    return rows.filter((r) => r.trim()).join('\n');
  });
}

const ODF_SKIP = new Set(['note', 'annotation', 'tracked-changes', 'note-citation']);
function odf(buf, ext) {
  const files = readZip(buf, (n) => n === 'content.xml');
  const xml = need(files, 'content.xml');
  const base = { text: new Set(['p', 'h']), para: new Set(['p', 'h']), tab: new Set(['tab']), br: new Set(['line-break']), space: new Set(['s']),
    skip: ODF_SKIP, cell: new Set(['table-cell']), row: new Set(['table-row']) };
  if (ext === '.odt') return chunkParas(collect(xml, base).paras);
  const unit = new Set([ext === '.odp' ? 'page' : 'table']);
  const { units } = collect(xml, { ...base, unit });
  return units.map((ps) => ps.map((p) => p.replace(/\s+$/, '')).filter((p) => p.trim()).join('\n'));
}

const ZIP_EXTRACTORS = { '.docx': docx, '.hwpx': hwpx, '.pptx': pptx, '.xlsx': xlsx, '.odt': (b) => odf(b, '.odt'), '.odp': (b) => odf(b, '.odp'), '.ods': (b) => odf(b, '.ods') };

module.exports = { ZIP_EXTRACTORS, collect, chunkParas, limitPages };
