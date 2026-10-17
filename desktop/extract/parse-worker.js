'use strict';
// 추출 Worker 몸체 (명세 selective-sync.md 9.5.3절): 작업마다 새로 만들어지고(resourceLimits — 메모리 상한) 한 번 쓰고 버려진다.
// 받는 것: {ext, bytes} 뿐(경로 · 루트 · 토큰을 모름). 돌려주는 것: {ok, pages} | {ok: false, code}. 디스크 · 네트워크를 쓰지 않는다.

const { parentPort } = require('node:worker_threads');
const { extractText } = require('./parse');

parentPort.once('message', async (m) => {
  try {
    const pages = await extractText(m && m.ext, m && m.bytes);
    parentPort.postMessage({ ok: true, pages });
  } catch (e) {
    const code = e && ['local_unreadable', 'local_unsupported', 'local_no_text'].includes(e.code) ? e.code : 'local_unreadable';
    parentPort.postMessage({ ok: false, code });
  }
});
