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
const { version: APP_VERSION } = require('../../package.json');

const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
// 실제 앱(sync/entry.js)과 같은 머리글 — 없으면 새 서버가 모든 동기화 요청에 426 update_required(선택 동기화 D-7)
const SYNC_HEADERS = { 'X-PaperLab-Sync': '2' };

/**
 * 실패로 끝내기: process.exit() 를 바로 부르지 않고 종료 코드만 정해 이벤트 루프가 비면 끝나게 한다.
 * Windows 의 Node 24 는 fetch 응답을 받은 바로 그 틱에 process.exit() 하면(재사용 중인 keep-alive 소켓이 남아 있을 때)
 * libuv 가 "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c" 로 죽고, 그 전에 쓴 error 줄도 잃을 수 있음.
 * 무언가 루프를 붙잡고 있으면 1초 뒤(같은 틱이 아님) 마저 끝냄.
 */
function fail(m) {
  out({ event: 'error', ...m });
  process.exitCode = 2;
  setTimeout(() => process.exit(2), 1000).unref();
}

(async () => {
  const [server, code, root, stateDir] = process.argv.slice(2);
  if (!['127.0.0.1', 'localhost'].includes(new URL(server).hostname)) throw new Error('로컬 개발 서버에만 붙어요');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  const pair = await createApi({ baseUrl: server }).post('/api/worker/pair',
    { code, name: process.env.SIM_NAME || 'Node 동기화 PC', os: 'Windows test', app_version: APP_VERSION, protocol: 1 }, { auth: false });
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
    api: createApi({ baseUrl: server, getToken: () => pair.token, headers: SYNC_HEADERS }),
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
  if (engine.mode !== 'preview') { fail({ code: engine.pickError }); return; }
  out({ event: 'preview', plan: engine.preview.plan, place: engine.preview.place });
  const r = await engine.confirmStart(process.env.SIM_PLACE || engine.preview.place);
  if (!r.ok) { fail({ code: r.code }); return; }
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
})().catch((e) => fail({ code: e.code || 'error', status: e.status || 0 }));
