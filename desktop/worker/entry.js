'use strict';
// utilityProcess 진입점 (명세 11.1 · K4 ①): main 과 메시지로만 주고받는다. 토큰은 main 이 safeStorage 에서 읽어 넘김.
// main → {type: init | token | settings | nudge | recheck | cancel | invalidate | local-text-result | stop},
// 워커 → {type: state | hello | token-invalid | update-required | job-finished | local-text | stopped}
// local-text(선택 동기화 9.4절): 로컬 항목 작업의 본문 — {type: 'local-text', id, paper_id, sha256} → main 이 로컬 파일을 검사 · 추출해
// {type: 'local-text-result', id, ok, pages, code}. 120초 안에 답이 없으면 local_unreadable.

const { Worker } = require('./worker');
const { createApi } = require('./api-client');
const { runTask, probeEngine } = require('./cli-runner');
const { resolveEngine } = require('./resolve-exe');
const { Logger } = require('../lib/log');

const LOCAL_TEXT_MS = 120000;
const port = process.parentPort;
let worker = null;
const send = (m) => { try { port.postMessage(m); } catch { /* main 이 닫힘 */ } };
const waiting = new Map();
let seq = 0;

function localText(paperId, sha256) {
  const id = ++seq;
  return new Promise((resolve) => {
    const t = setTimeout(() => { waiting.delete(id); resolve({ ok: false, code: 'local_unreadable' }); }, LOCAL_TEXT_MS);
    waiting.set(id, (r) => { clearTimeout(t); resolve(r); });
    send({ type: 'local-text', id, paper_id: paperId, sha256 });
  });
}

port.on('message', async ({ data: m }) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'init' && !worker) {
    const log = new Logger(m.logFile);
    const api = createApi({ baseUrl: m.serverUrl, getToken: () => worker && worker.token });
    worker = new Worker({
      api, log, emit: send, appVersion: m.appVersion, os: m.os, settings: m.settings, token: m.token || null, workRoot: m.workRoot,
      runTask, probe: (name, o) => probeEngine(name, { resolveEngine, ...o }), noDetect: m.noDetect === true, localText,
    });
    log.info('워커 시작', { app: m.appVersion, paired: m.token ? 'yes' : 'no' });
    worker.start();
    return;
  }
  if (m.type === 'local-text-result') {
    const fn = waiting.get(m.id);
    if (fn) { waiting.delete(m.id); fn({ ok: m.ok === true, pages: Array.isArray(m.pages) ? m.pages : [], code: String(m.code || '') }); }
    return;
  }
  if (!worker) return;
  if (m.type === 'token') worker.setToken(m.token);
  else if (m.type === 'settings') worker.setSettings(m.settings);
  else if (m.type === 'nudge') worker.nudge();
  else if (m.type === 'recheck') worker.recheck();
  else if (m.type === 'cancel') worker.cancel(m.id);
  else if (m.type === 'invalidate') worker.invalidate(String(m.code || 'device_auth_required')); // 동기화가 먼저 401 을 받음
  else if (m.type === 'stop') {
    await worker.stop({ bye: m.bye !== false });
    send({ type: 'stopped' });
    setTimeout(() => process.exit(0), 50);
  }
});
