'use strict';
// utilityProcess 진입점 (명세 11.1 · K4 ①): main 과 메시지로만 주고받는다. 토큰은 main 이 safeStorage 에서 읽어 넘김.
// main → {type: init | token | settings | nudge | recheck | cancel | stop}, 워커 → {type: state | hello | token-invalid | update-required | job-finished | stopped}

const { Worker } = require('./worker');
const { createApi } = require('./api-client');
const { runTask, probeEngine } = require('./cli-runner');
const { resolveEngine } = require('./resolve-exe');
const { Logger } = require('../lib/log');

const port = process.parentPort;
let worker = null;
const send = (m) => { try { port.postMessage(m); } catch { /* main 이 닫힘 */ } };

port.on('message', async ({ data: m }) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'init' && !worker) {
    const log = new Logger(m.logFile);
    const api = createApi({ baseUrl: m.serverUrl, getToken: () => worker && worker.token });
    worker = new Worker({
      api, log, emit: send, appVersion: m.appVersion, os: m.os, settings: m.settings, token: m.token || null, workRoot: m.workRoot,
      runTask, probe: (name, o) => probeEngine(name, { resolveEngine, ...o }), noDetect: m.noDetect === true,
    });
    log.info('워커 시작', { app: m.appVersion, paired: m.token ? 'yes' : 'no' });
    worker.start();
    return;
  }
  if (!worker) return;
  if (m.type === 'token') worker.setToken(m.token);
  else if (m.type === 'settings') worker.setSettings(m.settings);
  else if (m.type === 'nudge') worker.nudge();
  else if (m.type === 'recheck') worker.recheck();
  else if (m.type === 'cancel') worker.cancel(m.id);
  else if (m.type === 'stop') {
    await worker.stop({ bye: m.bye !== false });
    send({ type: 'stopped' });
    setTimeout(() => process.exit(0), 50);
  }
});
