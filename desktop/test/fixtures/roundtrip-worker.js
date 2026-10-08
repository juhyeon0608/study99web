'use strict';
// 로컬 서버 왕복 시험용(tests/test_desktop_worker.py가 부름): 연결 코드 교환 → 실제 워커 코드(hello · claim · heartbeat · result)
// + 가짜 claude CLI. 작업 하나를 끝내면 결과를 한 줄 JSON 으로 찍고 끝남. 운영 서버 · 실제 CLI 에는 쓰지 않는다.
// 사용: node roundtrip-worker.js <서버 주소> <연결 코드> <작업 폴더>

const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('../../worker/worker');
const { createApi } = require('../../worker/api-client');
const { runTask, probeEngine } = require('../../worker/cli-runner');
const { resolveEngine } = require('../../worker/resolve-exe');
const { Logger } = require('../../lib/log');
const { makeShim } = require('../helpers');

(async () => {
  const [server, code, dir] = process.argv.slice(2);
  const pair = await createApi({ baseUrl: server }).post('/api/worker/pair',
    { code, name: 'Node 시험 PC', os: 'Windows test', app_version: '0.2.0', protocol: 1 }, { auth: false });
  console.log(JSON.stringify({ event: 'paired', device_id: pair.device_id, hint: pair.account_hint }));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const shim = makeShim(bin, 'claude');
  const env = { ...process.env, USERPROFILE: dir };
  const w = new Worker({
    api: createApi({ baseUrl: server, getToken: () => w.token }), runTask,
    probe: (name, o) => probeEngine(name, { resolveEngine, env, ...o }),
    log: new Logger(path.join(dir, 'worker.log')), appVersion: '0.2.0', os: 'Windows test', token: pair.token,
    settings: { engines: { claude: { path: shim }, codex: { enabled: false }, gemini: { enabled: false } } },
    workRoot: path.join(dir, 'work'), env,
    emit: async (m) => {
      if (m.type === 'hello') console.log(JSON.stringify({ event: 'hello', device_id: m.deviceId }));
      if (m.type === 'job-finished') {
        console.log(JSON.stringify({ event: 'finished', ...m }));
        await w.stop();
        process.exit(0);
      }
    },
  });
  w.start();
})().catch((e) => { console.error(String(e && e.message)); process.exit(2); });
