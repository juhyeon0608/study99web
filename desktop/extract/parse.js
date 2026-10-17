'use strict';
// 형식별 글 뽑기 한 곳 (명세 selective-sync.md 9.5.1절) — 추출 Worker(parse-worker.js) 안에서 부른다.
// 확장자 판정이 첫 바이트와 어긋나면(예: .docx 인데 OLE) local_unreadable. 결과는 글 조각 배열(상한 2,000조각 · 8MB — limitPages).

const { methodOf, LIMITS, ExtractError } = require('./kinds');
const { ZIP_EXTRACTORS, chunkParas, limitPages } = require('./office');

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** (ext, bytes) → Promise<string[]> | ExtractError(code) */
async function extractText(ext, bytes) {
  const e = String(ext || '').toLowerCase();
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buf.length > LIMITS.inputMaxBytes) throw new ExtractError('local_unreadable', 'too big');
  const method = methodOf(e);
  if (method === 'unsupported') throw new ExtractError('local_unsupported', 'old format');
  if (method === 'image') throw new ExtractError('local_no_text', 'image');
  let pages;
  if (method === 'zip') {
    if (!buf.subarray(0, 4).equals(ZIP)) throw new ExtractError('local_unreadable', 'not zip');
    pages = ZIP_EXTRACTORS[e](buf);
  } else if (e === '.hwp') {
    pages = chunkParas(require('./hwp').hwpParagraphs(buf)); // eslint-disable-line global-require
  } else if (e === '.doc') {
    if (!buf.subarray(0, 8).equals(OLE)) throw new ExtractError('local_unreadable', 'not ole');
    pages = chunkParas(await require('./doc').docParagraphs(buf)); // eslint-disable-line global-require
  } else throw new ExtractError('local_unsupported', 'unknown');
  pages = limitPages(pages.map((p) => String(p)));
  if (!pages.some((p) => p.trim())) throw new ExtractError('local_no_text', 'empty');
  return pages;
}

module.exports = { extractText };
