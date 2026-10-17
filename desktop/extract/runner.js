'use strict';
// 추출 작업 실행기 (명세 selective-sync.md 9.5.3절): 작업마다 worker_threads Worker 를 새로 만들어 그 안에서 파싱한다.
// - resourceLimits {maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 4} — 넘으면 ERR_WORKER_OUT_OF_MEMORY → local_unreadable
// - 30초에 worker.terminate() → local_unreadable
// - 한 번에 하나, 대기 2개 — 넘으면 busy(호출한 쪽이 잠시 뒤 다시). 작업이 끝나면 Worker 를 버림(파서 상태가 다음 파일에 남지 않음).
// 시험은 workerFile 로 가짜 파서(무한 반복 · 메모리 폭주)를 주입한다(AC-S4A).

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { LIMITS } = require('./kinds');

const CODES = new Set(['local_unreadable', 'local_unsupported', 'local_no_text']);

function createRunner({ workerFile = path.join(__dirname, 'parse-worker.js'), timeoutMs = LIMITS.workerTimeoutMs, queueMax = LIMITS.queue,
  resourceLimits = { maxOldGenerationSizeMb: LIMITS.workerOldMb, maxYoungGenerationSizeMb: LIMITS.workerYoungMb, stackSizeMb: LIMITS.workerStackMb } } = {}) {
  let running = false;
  const queue = [];

  function runOne(ext, bytes) {
    return new Promise((resolve) => {
      let settled = false;
      let w;
      const finish = (r) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        if (w) w.terminate().catch(() => {});
        resolve(r);
      };
      const t = setTimeout(() => finish({ ok: false, code: 'local_unreadable', why: 'timeout' }), timeoutMs);
      try {
        w = new Worker(workerFile, { resourceLimits, stdout: true, stderr: true });
      } catch { finish({ ok: false, code: 'local_unreadable', why: 'spawn' }); return; }
      w.stdout.resume();
      w.stderr.resume(); // 파서가 쓰는 글은 버림(본문 · 경고가 로그에 남지 않게)
      w.once('message', (m) => {
        if (m && m.ok === true && Array.isArray(m.pages)) finish({ ok: true, pages: m.pages.map((p) => String(p)) });
        else finish({ ok: false, code: m && CODES.has(m.code) ? m.code : 'local_unreadable' });
      });
      w.once('error', (e) => finish({ ok: false, code: 'local_unreadable', why: (e && e.code) || 'error' }));
      w.once('exit', () => finish({ ok: false, code: 'local_unreadable', why: 'exit' }));
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const copy = new Uint8Array(buf.length);
      copy.set(buf);
      w.postMessage({ ext: String(ext || ''), bytes: copy }, [copy.buffer]);
    });
  }

  function pump() {
    if (running || !queue.length) return;
    running = true;
    const job = queue.shift();
    runOne(job.ext, job.bytes).then((r) => { running = false; job.resolve(r); pump(); });
  }

  /** (ext, bytes) → Promise<{ok, pages} | {ok: false, code}> — code: local_unreadable · local_unsupported · local_no_text · busy */
  function run(ext, bytes) {
    if (running && queue.length >= queueMax) return Promise.resolve({ ok: false, code: 'busy' });
    return new Promise((resolve) => { queue.push({ ext, bytes, resolve }); pump(); });
  }

  return { run, busy: () => running, waiting: () => queue.length };
}

module.exports = { createRunner };
