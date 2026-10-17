'use strict';
// 동기화 utilityProcess 진입점 (명세 15.1 · 15.3 · K-2): main 과 메시지로만 주고받는다. 워커와 다른 프로세스(한쪽이 죽어도 다른 쪽은 계속).
// main → {type: init | token | settings | probe | preview-place | preview-recheck | cancel-preview | start | pause | now | nudge | confirm | off | trash-result |
//         resolve | local-has | stop}
// sync → main {type: state | trash | notify | started | turned-off | start-result | token-invalid | update-required | resolve-result | local-has-result | stopped}
// 휴지통 보내기는 main 의 shell.trashItem 으로만(utilityProcess 에서는 동작하지 않음 — S-3 실측, K-43).
// resolve(선택 동기화 8.4 · 9.2절): 논문 id → 이 PC 파일 위치(저널 기준). main 이 루트 안 · 링크 아님 · 해시를 다시 확인한 뒤에만 읽는다.
// 모든 동기화 요청에 X-PaperLab-Sync: 2(새 서버의 프로토콜 문 — 옛 서버는 무시, D-7).

const path = require('node:path');
const { SyncEngine } = require('./engine');
const { createApi } = require('../worker/api-client');
const { createTransfer } = require('./transfer');
const { Logger } = require('../lib/log');

const port = process.parentPort;
let engine = null;
const send = (m) => { try { port.postMessage(m); } catch { /* main 이 닫힘 */ } };
const waiting = new Map();
let seq = 0;

/** main 에 휴지통 보내기를 부탁하고 결과를 기다림(2분 안에 답이 없으면 timeout — main 이 아직 보내는 중일 수 있어 보관함으로 옮기지 않고 다시 시도) */
function trash(abs) {
  const id = ++seq;
  return new Promise((resolve) => {
    const t = setTimeout(() => { waiting.delete(id); resolve({ ok: false, reason: 'timeout' }); }, 120000);
    waiting.set(id, (r) => { clearTimeout(t); resolve(r); });
    send({ type: 'trash', id, path: abs });
  });
}

port.on('message', async ({ data: m }) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'init' && !engine) {
    const log = new Logger(m.logFile);
    const api = createApi({ baseUrl: m.serverUrl, getToken: () => engine && engine.token, headers: { 'X-PaperLab-Sync': '2' } });
    const transfer = createTransfer({ serverOrigin: m.serverUrl, dev: m.dev === true, getUid: () => (engine && engine.who ? engine.who.uid : '') });
    engine = new SyncEngine({ api, transfer, trash, emit: send, log, journalFile: m.journalFile, installId: m.installId, settings: m.settings, token: m.token || null });
    log.info('동기화 프로세스 시작', { app: m.appVersion });
    engine.start();
    return;
  }
  if (!engine) return;
  switch (m.type) {
    case 'trash-result': { const fn = waiting.get(m.id); if (fn) { waiting.delete(m.id); fn({ ok: m.ok === true, reason: String(m.reason || '') }); } break; }
    case 'token': engine.setToken(m.token); break;
    case 'settings': engine.setSettings(m.settings); break;
    case 'probe': engine.probe(path.resolve(String(m.root))); break;
    case 'preview-place': engine.setPreviewPlace(m.place); break;
    case 'preview-recheck': engine.recheckPreview(); break;
    case 'cancel-preview': engine.cancelPreview(); break;
    case 'start': send({ type: 'start-result', ...(await engine.confirmStart(m.place)), id: m.id }); break;
    case 'pause': engine.pause(m.on === true); break;
    case 'now': engine.syncNow(); break;
    case 'nudge': engine.nudge(); break;
    case 'confirm': engine.confirm(String(m.batch_id), String(m.choice)); break;
    case 'off': await engine.turnOff(); break;
    case 'state': engine.refresh(); break;
    case 'resolve': send({ type: 'resolve-result', id: m.id, ...engine.resolveLocal(m.paper_id) }); break;
    case 'local-has': send({ type: 'local-has-result', id: m.id, map: engine.localHas(Array.isArray(m.ids) ? m.ids : []) }); break;
    case 'stop':
      engine.stop();
      send({ type: 'stopped' });
      setTimeout(() => process.exit(0), 50);
      break;
    default:
  }
});
