'use strict';
// 동기화 엔진 시험 도우미: 한글 · 공백이 든 임시 루트(os.tmpdir 아래), 기록하는 가짜 API, 가짜 Windows 휴지통(<임시>\fake-recycle), 주입 시계.
// 실제 Windows 휴지통 · 사용자 폴더 · 서버에는 닿지 않는다(명세 18장).

const fs = require('node:fs');
const path = require('node:path');
const { SyncEngine } = require('../sync/engine');
const { createTransfer } = require('../sync/transfer');
const { FakeSyncApi, fakeStorageFetch, sha, pdf } = require('./fixtures/fake-sync-api');
const { tempHome } = require('./helpers');

const ORIGIN = 'http://127.0.0.1:9';
const UID = '11111111-2222-3333-4444-555555555555';
const TOKEN = `pld1.${UID}.7.${'A'.repeat(43)}`;

function setup(o = {}) {
  const home = tempHome('pl-sync-');
  const root = path.join(home, '논문 폴더');
  fs.mkdirSync(root, { recursive: true });
  const api = o.api || new FakeSyncApi({ uid: UID });
  const clock = { t: Date.parse('2026-10-13T03:00:00Z') };
  const recycle = path.join(home, 'fake-recycle');
  const trashed = [];
  const urls = [];
  const emitted = [];
  const env = { home, root, api, clock, recycle, trashed, urls, emitted, journalFile: path.join(home, 'AppData', 'sync', 'state.json') };
  env.trashImpl = async (abs) => {
    fs.mkdirSync(recycle, { recursive: true });
    const dest = path.join(recycle, `${trashed.length}-${path.basename(abs)}`);
    fs.renameSync(abs, dest);
    trashed.push({ abs, dest });
    return { ok: true };
  };
  env.make = (extra = {}) => new SyncEngine({
    api, emit: (m) => emitted.push(m), now: () => clock.t, journalFile: env.journalFile, installId: 'I1', token: TOKEN, watch: null, autoLoop: false,
    transfer: createTransfer({ serverOrigin: ORIGIN, dev: true, getUid: () => UID, fetchImpl: fakeStorageFetch(api, { urls }) }),
    trash: (abs) => (env.trashOverride ? env.trashOverride(abs) : env.trashImpl(abs)),
    readAttrs: async (ps) => new Map(ps.map((p) => [p, env.attrs ? env.attrs(p) : 32])),
    driveType: async () => env.drive || 'Fixed', recycleNuke: async () => 'off', statfs: () => (env.free == null ? 500 * 1024 ** 3 : env.free),
    timing: { stableChecks: 0, deleteWaitMs: 0, ...(o.timing || {}) }, ...extra,
  });
  env.write = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, pdf(text)); return p; };
  env.read = (rel) => fs.readFileSync(path.join(root, rel));
  env.exists = (rel) => fs.existsSync(path.join(root, rel));
  /** 루트 안 PDF 목록(상대 경로 · 정렬, .paperlab-sync 제외) */
  env.tree = () => {
    const out = [];
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const r = rel ? `${rel}\\${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), r); else out.push(r);
      }
    };
    walk(root, '');
    return out.sort();
  };
  /** 첫 연결: 살펴보기 → 미리보기 → [시작] → 한 바퀴 */
  env.connect = async (e, place) => {
    await e.probe(root);
    if (e.mode !== 'preview') throw new Error(`미리보기 실패: ${e.pickError}`);
    const r = await e.confirmStart(place || e.preview.place);
    if (!r.ok) throw new Error(`시작 실패: ${r.code}`);
    await e.cycle();
    return e;
  };
  /** 몇 바퀴 돌림(시계를 조금씩 앞으로, 감시 이벤트가 온 것처럼) */
  env.spin = async (e, n = 3, stepMs = 11000) => { for (let i = 0; i < n; i++) { clock.t += stepMs; e.dirty = true; await e.cycle(); } };
  return env;
}

module.exports = { setup, sha, pdf, UID, TOKEN, ORIGIN };
