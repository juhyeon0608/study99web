'use strict';
// 동기화 대상 파일 종류 (명세 selective-sync.md 8.1절) — 순수 함수. 서버 convert.ACCEPT_EXTS · convert.kind 와 같은 목록 · 같은 판정
// (tests/test_selective_sync_contract.py 가 이 파일의 SYNC_EXTS 를 읽어 서버 목록과 맞춰 봄 — 한 줄 배열 그대로 둘 것).
// kindOf: 첫 바이트가 %PDF 면 이름과 관계없이 'pdf', 아니면 확장자 + 매직이 함께 맞아야 'doc' · 'image', 어긋나면 ''.

const SYNC_EXTS = Object.freeze(['.pdf', '.doc', '.docx', '.hwp', '.hwpx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods', '.rtf', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp']);
const DOC_EXTS = Object.freeze(['.doc', '.docx', '.hwp', '.hwpx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods', '.rtf']);
const IMAGE_EXTS = Object.freeze(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp']);
/** 판정에 읽는 첫 바이트 수(WebP 는 8~12번째 바이트까지 봄) */
const HEAD_BYTES = 16;

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const IMAGE_MAGIC = [Buffer.from([0xff, 0xd8, 0xff]), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('GIF87a', 'latin1'),
  Buffer.from('GIF89a', 'latin1'), Buffer.from('BM', 'latin1'), Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.from([0x4d, 0x4d, 0x00, 0x2a])];

/** Python os.path.splitext 와 같은 확장자(소문자, 점 포함). 점으로 시작하는 이름(.pdf)은 확장자 없음 */
function extOf(name) {
  const s = String(name == null ? '' : name);
  const base = s.slice(Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/')) + 1);
  const stem = base.replace(/^\.+/, '');
  const i = stem.lastIndexOf('.');
  return i < 0 ? '' : stem.slice(i).toLowerCase();
}

const isSyncName = (name) => SYNC_EXTS.includes(extOf(name));
const isPdfExt = (name) => extOf(name) === '.pdf';

const starts = (buf, magic) => buf.length >= magic.length && buf.subarray(0, magic.length).equals(magic);

/** head = 첫 바이트(Buffer · Uint8Array, HEAD_BYTES 이상 권장) → 'pdf' | 'doc' | 'image' | '' */
function kindOf(head, name) {
  const b = Buffer.isBuffer(head) ? head : Buffer.from(head || []);
  if (starts(b, Buffer.from('%PDF', 'latin1'))) return 'pdf';
  const ext = extOf(name);
  if (DOC_EXTS.includes(ext)) {
    if (starts(b, ZIP) || starts(b, OLE) || (ext === '.rtf' && starts(b, Buffer.from('{\\rtf', 'latin1')))) return 'doc';
    return '';
  }
  if (IMAGE_EXTS.includes(ext)) {
    if (IMAGE_MAGIC.some((m) => starts(b, m))) return 'image';
    if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image';
  }
  return '';
}

module.exports = { SYNC_EXTS, DOC_EXTS, IMAGE_EXTS, HEAD_BYTES, extOf, isSyncName, isPdfExt, kindOf };
