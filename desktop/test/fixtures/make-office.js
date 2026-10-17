'use strict';
// 시험이 직접 만드는 ZIP · 문서 견본 (명세 selective-sync.md 9.5.5절 — 저장소에 개인 문서를 넣지 않음).
// zip(entries, opts): entries = [{name, data, method?, flags?, declaredSize?, declaredCsize?, crc?, localName?}] — 거부 시험용으로 머리 값을 속일 수 있음.
// docx · hwpx · pptx · xlsx · odt · odp · ods: 작은 XML 몇 개로 된 최소 문서.

const zlib = require('node:zlib');
const { crc32 } = require('../../extract/zip');

function zip(entries, { zip64Locator = false, eocdOverride = null, comment = '' } = {}) {
  const locals = [];
  const cens = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const method = e.method === undefined ? 8 : e.method;
    const body = e.raw ? e.raw : method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = e.crc === undefined ? crc32(data) : e.crc;
    const usize = e.declaredSize === undefined ? data.length : e.declaredSize;
    const csize = e.declaredCsize === undefined ? body.length : e.declaredCsize;
    const flags = (e.flags || 0) | 0x800;
    const lname = Buffer.from(e.localName === undefined ? e.name : e.localName, 'utf8');
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(flags, 6); loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc >>> 0, 14); loc.writeUInt32LE(csize >>> 0, 18); loc.writeUInt32LE(usize >>> 0, 22);
    loc.writeUInt16LE(lname.length, 26); loc.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(flags, 8); cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc >>> 0, 16); cen.writeUInt32LE(csize >>> 0, 20); cen.writeUInt32LE(usize >>> 0, 24); cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(e.offset === undefined ? offset : e.offset, 42);
    locals.push(loc, lname, body);
    cens.push(cen, name);
    offset += loc.length + lname.length + body.length;
  }
  const cd = Buffer.concat(cens);
  const parts = [...locals, cd];
  if (zip64Locator) { const l = Buffer.alloc(20); l.writeUInt32LE(0x07064b50, 0); parts.push(l); }
  const c = Buffer.from(comment, 'latin1');
  const eocd = Buffer.alloc(22);
  const o = { entries: entries.length, cdSize: cd.length, cdOff: offset, disk: 0, ...(eocdOverride || {}) };
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(o.disk, 4); eocd.writeUInt16LE(o.disk, 6);
  eocd.writeUInt16LE(o.entries, 8); eocd.writeUInt16LE(o.entries, 10); eocd.writeUInt32LE(o.cdSize >>> 0, 12); eocd.writeUInt32LE(o.cdOff >>> 0, 16);
  eocd.writeUInt16LE(c.length, 20);
  parts.push(eocd, c);
  return Buffer.concat(parts);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function docx(paras) {
  const body = paras.map((p) => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('');
  return zip([
    { name: '[Content_Types].xml', data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>` },
    { name: 'word/document.xml', data: `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>` },
  ]);
}

function hwpx(paras) {
  const sec = (ps) => `${XML}<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">` +
    ps.map((p) => `<hp:p id="0"><hp:run charPrIDRef="0"><hp:t>${esc(p)}</hp:t></hp:run></hp:p>`).join('') + '</hs:sec>';
  const half = Math.ceil(paras.length / 2);
  return zip([
    { name: 'mimetype', data: 'application/hwp+zip', method: 0 },
    { name: 'Contents/content.hpf', data: `${XML}<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"><opf:manifest>` +
      '<opf:item id="section1" href="Contents/section1.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>' +
      '</opf:manifest><opf:spine><opf:itemref idref="section0"/><opf:itemref idref="section1"/></opf:spine></opf:package>' },
    { name: 'Contents/section1.xml', data: sec(paras.slice(half)) },
    { name: 'Contents/section0.xml', data: sec(paras.slice(0, half)) },
  ]);
}

function pptx(slides) {
  return zip(slides.map((lines, i) => ({ name: `ppt/slides/slide${slides.length - i}.xml`, data: `${XML}<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody>` +
    slides[slides.length - 1 - i].map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join('') + '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>' })));
}

/** sheets = [[[cell, …], …], …] — 문자열은 공유 문자열(t="s"), {inline: '…'} 는 inlineStr, 숫자는 v */
function xlsx(sheets) {
  const shared = [];
  const sIdx = (s) => { let i = shared.indexOf(s); if (i < 0) { shared.push(s); i = shared.length - 1; } return i; };
  const files = sheets.map((rows, n) => ({ name: `xl/worksheets/sheet${n + 1}.xml`, data: `${XML}<worksheet xmlns="x"><sheetData>` + rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((c) => {
    if (typeof c === 'number') return `<c r="A1"><v>${c}</v></c>`;
    if (c && c.inline !== undefined) return `<c r="A1" t="inlineStr"><is><t>${esc(c.inline)}</t></is></c>`;
    return `<c r="A1" t="s"><v>${sIdx(c)}</v></c>`;
  }).join('') + '</row>').join('') + '</sheetData></worksheet>' }));
  files.push({ name: 'xl/sharedStrings.xml', data: `${XML}<sst xmlns="x">` + shared.map((s) => `<si><r><t>${esc(s)}</t></r><rPh><t>요미</t></rPh></si>`).join('') + '</sst>' });
  return zip(files);
}

function odf(kind, units) {
  const NS = 'xmlns:office="o" xmlns:text="t" xmlns:table="tb" xmlns:draw="d"';
  let body;
  if (kind === 'odt') body = `<office:text>${units.map((p) => `<text:p>${esc(p).replace(/ {2}/g, ' <text:s/>')}<text:note><text:note-body><text:p>각주 글</text:p></text:note-body></text:note></text:p>`).join('')}</office:text>`;
  else if (kind === 'odp') body = `<office:presentation>${units.map((lines) => `<draw:page>${lines.map((l) => `<draw:frame><draw:text-box><text:p>${esc(l)}</text:p></draw:text-box></draw:frame>`).join('')}</draw:page>`).join('')}</office:presentation>`;
  else body = `<office:spreadsheet>${units.map((rows) => `<table:table>${rows.map((r) => `<table:table-row>${r.map((c) => `<table:table-cell><text:p>${esc(c)}</text:p></table:table-cell>`).join('')}</table:table-row>`).join('')}</table:table>`).join('')}</office:spreadsheet>`;
  return zip([
    { name: 'mimetype', data: `application/vnd.oasis.opendocument.${kind === 'odt' ? 'text' : kind === 'odp' ? 'presentation' : 'spreadsheet'}`, method: 0 },
    { name: 'content.xml', data: `${XML}<office:document-content ${NS}><office:body>${body}</office:body></office:document-content>` },
  ]);
}

module.exports = { zip, docx, hwpx, pptx, xlsx, odf, XML };
