'use strict';
// 옛 워드(.doc — Word 97-2003) 글 뽑기 어댑터 (명세 selective-sync.md 9.5.1 · 9.5.4절): word-extractor@1.0.4(MIT).
// 버퍼만 넘김(파일 이름을 주지 않아 라이브러리가 디스크를 읽지 않음), 본문(getBody)만 — 각주 · 머리글은 읽지 않음.
// OLE 머리가 아니면 라이브러리를 부르지 않음(.docx 경로 — yauzl · saxes 는 실행되지 않음). 이 파일은 추출 Worker 안에서만 require 된다(AC-S49).

const { ExtractError } = require('./kinds');

const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/** bytes(Buffer) → 문단 배열 */
async function docParagraphs(bytes) {
  if (!bytes.subarray(0, 8).equals(OLE)) throw new ExtractError('local_unreadable', 'not ole');
  const WordExtractor = require('word-extractor'); // eslint-disable-line global-require — 추출 Worker 안에서만
  let body;
  try {
    const d = await new WordExtractor().extract(bytes);
    body = String(d.getBody() || '');
  } catch { throw new ExtractError('local_unreadable', 'doc parse'); } // 암호 · 손상 · 워드 문서 아님
  return body.split(/\r\n|\r|\n/);
}

module.exports = { docParagraphs };
