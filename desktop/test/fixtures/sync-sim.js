'use strict';
// 여러 PC 시뮬레이션용 동기화 엔진 하나(명세 18장 층 4 [다중] — tests/test_desktop_sync.py 가 PC 수만큼 띄움).
// 로컬 개발 서버(FakeStorage /_dev_storage)에만 붙는다 — 서버 주소가 127.0.0.1 · localhost 가 아니면 시작하지 않음.
// 실제 Windows 휴지통 대신 <상태 폴더>\fake-recycle 로 옮기고 기록한다.
//
// 사용: node sync-sim.js <서버 주소> <연결 코드> <루트 폴더> <상태 폴더>
// 환경 변수: SIM_PLACE=local|library(첫 연결 위치 — 없으면 엔진 기본), SIM_CLOCK_OFFSET_MS(이 PC 시계 차이), SIM_NAME(기기 이름),
//            SIM_TRASH_FAIL=other|locked|parse_failed(가짜 휴지통 실패 흉내)
// 표준 출력: 한 줄 JSON — {"event":"paired"|"preview"|"started"|"state"|"notify"|"trash"|"error", …}
// 표준 입력: 한 줄 JSON — {"cmd":"confirm","choice":"continue|revert|later|off"} · {"cmd":"now"} · {"cmd":"pause","on":true} ·
//            {"cmd":"state"} · {"cmd":"stop"}

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { SyncEngine } = require('../../sync/engine');
const { createTransfer } = require('../../sync/transfer');
const { createApi } = require('../../worker/api-client');
const { Logger } = require('../../lib/log');

const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);

(async () => {
  const [server, code, root, stateDir] = process.argv.slice(2);
  if (!['127.0.0.1', 'localhost'].includes(new URL(server).hostname)) throw new Error('로컬 개발 서버에만 붙어요');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const pair = await createApi({ baseUrl: server }).post('/api/worker/pair',
    { code, name: process.env.SIM_NAME || 'Node 동기화 PC', os: 'Windows test', app_version: '0.3.0', protocol: 1 }, { auth: false });
  out({ event: 'paired', device_id: pair.device_id });
  const offset = Number(process.env.SIM_CLOCK_OFFSET_MS) || 0;
  const recycle = path.join(stateDir, 'fake-recycle');
  let n = 0;
  const trash = async (abs) => {
    if (process.env.SIM_TRASH_FAIL) return { ok: false, reason: process.env.SIM_TRASH_FAIL };
    fs.mkdirSync(recycle, { recursive: true });
    const dest = path.join(recycle, `${++n}-${path.basename(abs)}`);
    fs.renameSync(abs, dest);
    out({ event: 'trash', rel: path.relative(root, abs), dest });
    return { ok: true };
  };
  let last = '';
  let engine = null;
  engine = new SyncEngine({
    api: createApi({ baseUrl: server, getToken: () => pair.token }),
    transfer: createTransfer({ serverOrigin: new URL(server).origin, dev: true, getUid: () => (engine && engine.who ? engine.who.uid : '') }),
    trash, now: () => Date.now() + offset, journalFile: path.join(stateDir, 'state.json'), installId: 'sim', token: pair.token,
    log: new Logger(path.join(stateDir, 'sync.log')),
    timing: { debounceMs: 200, stableMs: 300, stableChecks: 1, deleteWaitMs: 1000, rootCheckMs: 5000, pollMs: 2000 },
    emit: (m) => {
      if (m.type === 'state') {
        const key = JSON.stringify([m.state, m.counts, m.reason, m.confirm && m.confirm.count]);
        if (key !== last) { last = key; out({ event: 'state', state: m.state, reason: m.reason, counts: m.counts, confirm: m.confirm, problems: m.problems.length }); }
      } else if (m.type === 'notify') out({ event: 'notify', kind: m.kind, n: m.n || 0, names: m.names || [] });
      else if (m.type === 'started') out({ event: 'started' });
      else if (m.type === 'turned-off') out({ event: 'turned-off' });
    },
  });
  await engine.probe(path.resolve(root));
  if (engine.mode !== 'preview') { out({ event: 'error', code: engine.pickError }); process.exit(2); }
  out({ event: 'preview', plan: engine.preview.plan, place: engine.preview.place });
  const r = await engine.confirmStart(process.env.SIM_PLACE || engine.preview.place);
  if (!r.ok) { out({ event: 'error', code: r.code }); process.exit(2); }
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let c;
    try { c = JSON.parse(line); } catch { return; }
    if (c.cmd === 'confirm' && engine.held) await engine.confirm(engine.held.batch_id, c.choice);
    else if (c.cmd === 'now') engine.syncNow();
    else if (c.cmd === 'pause') engine.pause(c.on === true);
    else if (c.cmd === 'state') { const s = engine.snapshot(); out({ event: 'state', state: s.state, counts: s.counts, problems: s.problems.length, confirm: s.confirm }); }
    else if (c.cmd === 'stop') { engine.stop(); out({ event: 'stopped' }); setTimeout(() => process.exit(0), 50); }
  });
})().catch((e) => { out({ event: 'error', code: e.code || 'error', status: e.status || 0 }); process.exit(2); });
