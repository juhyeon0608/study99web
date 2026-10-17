'use strict';
// 폴더 동기화 엔진 (명세 6 · 7 · 9 · 10 · 11 · 12 · 15장). utilityProcess(entry.js) 안에서 돌고, 시계 · API · 전송 · 휴지통 · 속성 읽기는 주입.
//
// 한 번의 "맞추기"(pass) = 루트 검사(lstat) → 안정된 파일만 해시 → reconcile(J · L · S) → 실행 → 다시 검사(할 일이 없을 때까지, 최대 8번).
// 감시 이벤트 · 피드 · 주기 검사는 맞추기를 부르는 신호일 뿐이다(판정은 늘 검사 결과로 — 9.1절).
//
// 안전(12.1절):
// - 사용자 파일을 영구 삭제하지 않는다. 지울 때는 main 의 trash IPC(shell.trashItem), 실패하면 보관함으로 옮김.
//   unlink · rmdir 은 safe-remove.js 한 곳(임시 파일 · 빈 디렉터리)에서만.
// - 삭제는 명시적 신호로만: PC 쪽은 J 에 있던 파일이 5초 넘게 사라짐, 서버 쪽은 휴지통 · 묘비. 대량 삭제는 멈추고 묻는다(K-12).
// - 덮어쓰지 않는다: 받은 파일은 tmp 에 받아 해시를 확인하고, 자리가 비었을 때만 이름 바꾸기로 넣음. 교체는 옛 파일을 휴지통으로 보낸 뒤.
// 저널 쓰기 순서: 디스크를 먼저 바꾸고 J 를 고침 — 그 사이 앱이 죽어도 다음 비교가 "연결" · "같은 위치로 옮기기"(서버 no-op)로 끝나고
// 삭제로 읽히지 않는다(J 에서 빠진 항목은 받기 · 연결로만 이어짐). 그래서 저널은 묶어서 쓴다.
// 로그: id · 결과 코드 · 개수만(파일 이름 · 경로 · 해시 · 주소 없음 — 12.6절).
//
// 선택 동기화(docs/specs/selective-sync.md 8장): sync/start 응답의 protocol 이 2 이상이면 v2 — 동기화 확장자 전부(filekind.SYNC_EXTS) ·
// 로컬 항목(보관 PC) · 끄기/켜기 전환(mode.ack · mode.fail · promote) · 표현 바뀜(swap_rep). 없거나 1이면(옛 서버) v1 — .pdf 만,
// 새 동작을 만들지 않음(0.3.1과 같음). proto 는 start 마다 다시 정하고, 바뀌면 전체 다시 맞추기. 모든 요청에 X-PaperLab-Sync: 2(entry.js).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { run } = require('../lib/run');
const P = require('./paths');
const R = require('./reconcile');
const journal = require('./journal');
const scanner = require('./scanner');
const { SYNC_EXTS, extOf, kindOf, isPdfExt } = require('./filekind');
const { removeTemp, removeEmptyDir } = require('./safe-remove');
const { watchRoot } = require('./watcher');
const { nullLogger } = require('../lib/log');

const API = '/api/worker/sync';
const TIMING = {
  debounceMs: 2000, stableMs: 2000, stableChecks: 2, writingMs: 10 * 60e3, deleteWaitMs: 5000, massWindowMs: 30e3, reaskMs: 3600e3,
  rootCheckMs: 30e3, rootDeepMs: 10 * 60e3, rescanMs: 10 * 60e3, fullMs: 6 * 3600e3, retryBaseMs: 60e3, retryMaxMs: 3600e3, backoffBaseMs: 5000, backoffMaxMs: 300e3,
  statusMs: 50e3, quotaRetryMs: 10 * 60e3, updateRetryMs: 30 * 60e3, pollMs: 60e3, probeStableTries: 30,
};
const MASS = { count: 10, ratio: 0.1, min: 3, anomaly: 0.5 };
const LIMITS = { ops: 20, slots: 10, download: 20, lookup: 200, upload: 2, get: 3, problems: 500, snapshot: 2000, changes: 500 };
const DISK_SPARE = 1024 ** 3;
const PER_LOCAL_BYTES = 8 * 1024; // 로컬 항목 한 편의 DB 추정치(서버가 db.per_local_bytes 를 주면 그 값 — 가정, 8.3절)
const NO_RETRY_MS = 24 * 3600e3; // 같은 파일이면 같은 결과인 거절(형식 · 변환 실패) — 파일이 바뀌면(해시 키가 달라짐) 바로 다시
const PDF_ONLY = new Set(['.pdf']);
const SLOW_MS = 240e3; // files/add · content · promote — 서버 문서 변환(최대 180초 — convert.TIMEOUT) + 여유(8.4절). 나머지는 30초
const DEEP_ISSUES = new Set(['drive', 'recycle_off']); // 깊은 확인으로만 알 수 있는 루트 문제
const TOKEN_RE = /^pld1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([1-9][0-9]{0,17})\./;

const emptyS = () => ({ folders: new Map(), papers: new Map(), trashed: new Map(), gonePapers: new Set(), goneFolders: new Set() });
const kstDate = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

function parseToken(t) {
  const m = TOKEN_RE.exec(String(t || ''));
  return m ? { uid: m[1], deviceId: Number(m[2]) } : null;
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } });
  await Promise.all(workers);
}

function chunks(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

const attrib = (dir) => run('attrib.exe', ['+h', dir], { timeout: 10000 });

function defaultStatfs(p) {
  try { const s = fs.statfsSync(p); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

class SyncEngine {
  constructor(o) {
    this.api = o.api;
    this.transfer = o.transfer;
    this.trashFn = o.trash; // async (abs) → {ok, reason}
    this.emit = o.emit || (() => {});
    this.log = o.log || nullLogger;
    this.now = o.now || Date.now;
    this.t = { ...TIMING, ...(o.timing || {}) };
    this.journalFile = o.journalFile;
    this.installId = o.installId || '';
    this.readAttrs = o.readAttrs || scanner.readAttrs;
    this.driveType = o.driveType || require('./rootcheck').driveType;
    this.recycleNuke = o.recycleNuke || require('./rootcheck').recycleNuke;
    this.statfs = o.statfs || defaultStatfs;
    this.uuid = o.uuid || (() => crypto.randomUUID());
    this.watch = o.watch === undefined ? watchRoot : o.watch; // null = 감시 안 함(시험)
    this.autoLoop = o.autoLoop !== false; // false = 시험이 cycle() 을 직접 부름
    this.setTimer = o.setTimer || setTimeout;
    this.clearTimer = o.clearTimer || clearTimeout;
    this.settings = { enabled: false, root: '', installId: '', previousRoot: '', paused: false, ...(o.settings || {}) };
    this.setToken(o.token || null, { quiet: true });

    this.mode = 'off';
    this.root = '';
    this.J = null;
    this.S = emptyS();
    this.cursor = null;
    this.budget = null;
    this.place = 'local';
    this.offset = null;
    this.paused = !!this.settings.paused;
    this.previousRoot = '';
    this.flags = { offline: false, updateRequired: false, revoked: false, accountMismatch: false };
    this.rootIssue = '';
    this.pickError = '';
    this.uploadBlock = null; // {reason, until}
    this.held = null; // {batch_id, kind, pids: Set, labels: Set, askAt, base}
    this.approved = { local: new Set(), remote: new Set() };
    this.goneSince = new Map();
    this.sent = { local: [], remote: [] }; // [{at, n}] — 30초 창
    this.obs = new Map(); // 안정 대기: key → {size, mtime, at, count, since}
    this.hashCache = new Map();
    this.retries = new Map(); // 동작 키 → {at, ms, code}
    this.problems = [];
    this.lastPlan = { up: 0, down: 0, todo: 0 };
    this.progress = null;
    this.lastSyncAt = null;
    this.lastFullAt = 0;
    this.lastRescan = 0;
    this.lastRootCheck = 0;
    this.lastDeepCheck = 0;
    this.needFull = true;
    this.dirty = true;
    this.feedDue = 0;
    this.backoff = 0;
    this.statusSent = { at: -Infinity, key: '', state: '' };
    this.busy = false;
    this.preview = null;
    this.probing = null;
    this.suspended = false;
    this.watcher = null;
    this.wakeFn = null;
    this.stopped = false;
    this.loopRunning = false;
    this.notes = [];
    this.archiveBytes = 0;
    this.firstPassPending = false;
    this.proto = null; // 서버 동기화 프로토콜(start 응답) — null = 아직 모름(미리보기는 스냅숏 모양으로 짐작)
    this.snapshotProto = null;
    this.exts = null; // 서버가 준 동기화 확장자(start 응답 exts — SYNC_EXTS 안의 것만)
    this.forceCloud = new Set(); // upload_required 를 받은 새 파일(접는 경로 \n 해시) — 다음 바퀴는 올림
  }

  /** 지금 맞추는 확장자: v1(옛 서버) = .pdf 만, v2 = 서버 목록(없으면 SYNC_EXTS) */
  scanExts(proto = this.proto) {
    if ((proto || 1) < 2) return PDF_ONLY;
    return this.exts ? new Set(this.exts) : null;
  }

  // ====================================================================== 바깥에서
  setToken(token, { quiet = false } = {}) {
    this.token = token || null;
    this.who = parseToken(this.token);
    if (quiet) return;
    this.flags.revoked = false;
    if (!this.who && this.mode !== 'off') this.turnOffLocal(); // 연결을 끊음 → 꺼짐 + "전에 쓰던 폴더"(Q-2 ②)
    this.refresh();
    this.wake();
  }

  /** 해지(401) · 연결 끊기: 서버를 부르지 않고 꺼짐으로. 다시 연결해도 자동으로 켜지지 않음(Q-2 ②) */
  turnOffLocal() {
    const root = this.root || '';
    this.mode = 'off';
    this.held = null;
    this.preview = null;
    this.suspended = false;
    this.closeWatcher();
    if (this.journalFile) { try { journal.save(this.journalFile, journal.fresh()); } catch { /* 다음에 */ } }
    this.J = null;
    if (root) this.previousRoot = root;
    this.emit({ type: 'turned-off', root });
  }

  setSettings(s) { this.settings = { ...this.settings, ...(s || {}) }; }

  /** 시작 판정(AC-673a · 673b): 저장된 루트 + 같은 설치 ID 일 때만 켬. 아니면 아무 파일도 읽지 않고 off */
  startupDecision() {
    const s = this.settings;
    if (!s.enabled || !s.root) return { run: false, previous: s.previousRoot || '' };
    if (!this.installId || s.installId !== this.installId) return { run: false, previous: s.root };
    return { run: true, previous: '' };
  }

  async start() {
    const d = this.startupDecision();
    if (!d.run) { this.mode = 'off'; this.previousRoot = d.previous; this.refresh(); return; }
    this.root = this.settings.root;
    await this.open();
    if (this.autoLoop) this.loop();
  }

  /** 켜진 상태로 열기: 저널 · 계정 · 루트 확인 → sync/start. 실패해도 루프에서 다시 확인 */
  async open() {
    this.mode = 'running';
    this.stopped = false;
    let J = journal.load(this.journalFile);
    if (J && J.root && P.fold(J.root) !== P.fold(this.root)) J = null;
    this.recovering = !J;
    if (J && J.migrated) this.log.info('저널 v1 → v2 — 전체 다시 맞추기'); // 0.3.x → 0.4.0 첫 실행(8.5절 — 아래 needFull)
    this.J = J || journal.fresh({ root: this.root, user_id: this.who ? this.who.uid : '', device_id: this.who ? this.who.deviceId : null });
    if (this.recovering) this.place = 'library'; // 저널이 깨짐 → 전체 다시 맞추기(삭제를 추론하지 않음, 서재 위치를 따름)
    this.cleanTmp(this.root); // 지난번에 받다 만 파일(15.5)
    this.needFull = true;
    this.refresh();
  }

  stop() {
    this.stopped = true;
    this.closeWatcher();
    this.flushJournal();
    this.wake();
  }

  pause(on) {
    this.paused = !!on;
    this.settings.paused = this.paused;
    this.refresh();
    if (!on) { this.dirty = true; this.wake(); }
  }

  nudge() { this.feedDue = 0; this.dirty = true; this.wake(); }
  syncNow() { this.needFull = true; this.dirty = true; this.wake(); }

  /** 확인 창 선택(K-31 · K-32): continue | revert | later | off */
  async confirm(batchId, choice) {
    const h = this.held;
    if (!h || h.batch_id !== batchId) return false;
    if (choice === 'later') { h.askAt = this.now() + this.t.reaskMs; this.refresh(); return true; }
    if (choice === 'off') { await this.turnOff(); return true; }
    if (choice === 'continue') {
      for (const pid of h.pids) this.approved[h.kind === 'remote_delete' || h.kind === 'moved_local' ? 'remote' : 'local'].add(pid);
      this.held = null;
    } else if (choice === 'revert') {
      if (h.kind === 'moved_local') return false; // 다른 PC에만 두기로 한 파일 — 되돌릴 것이 없음(서재 정보는 그대로, 파일은 보관 PC에)
      if (h.kind === 'remote_delete') await this.restoreRemote([...h.pids]);
      else {
        // PC 에 되돌리기: J 에서 빼면 서버 논문이 "새 것"으로 보여 다시 받음. 사라진 디렉터리도 J 에서 빼 다시 만들게
        for (const pid of h.pids) { delete this.J.files[pid]; this.goneSince.delete(pid); }
        const tree = await scanner.scanTree(this.root).catch(() => null);
        if (tree) {
          const keys = new Set(tree.dirs.map((d) => d.key));
          for (const [fid, f] of Object.entries(this.J.folders)) if (!keys.has(P.fold(f.rel))) delete this.J.folders[fid];
        }
        this.held = null;
        this.flushJournal();
      }
    } else return false;
    this.log.info('대량 삭제 확인', { choice, n: h.pids.size, kind: h.kind });
    this.dirty = true;
    this.refresh();
    this.wake();
    return true;
  }

  /** 동기화 끄기(7.3): 파일은 그대로, 저널만 비움, 서버 enabled=false */
  async turnOff() {
    const root = this.root || (this.preview && this.preview.root) || '';
    this.mode = 'off';
    this.held = null;
    this.preview = null;
    this.closeWatcher();
    if (this.journalFile) journal.save(this.journalFile, journal.fresh());
    this.J = null;
    this.previousRoot = root;
    try { await this.api.post(`${API}/start`, { root_label: P.baseName(root).slice(0, 60), enabled: false }); } catch { /* 다음에 */ }
    this.log.info('동기화 끔');
    this.emit({ type: 'turned-off', root });
    this.refresh();
    this.wake();
  }

  // ====================================================================== 첫 연결 · 미리보기 (7.2)
  /** 고른 폴더를 살펴봄 — 읽기만(표식 · 설정 · sync/start 없음, AC-673a) */
  async probe(root) {
    if (this.probing) return;
    this.probing = { root, done: 0, total: 0 };
    this.pickError = '';
    if (this.mode === 'running') this.suspended = true;
    this.prevMode = this.mode;
    this.mode = 'probing';
    this.refresh();
    try {
      this.preview = await this.buildPreview(root);
      this.mode = 'preview';
      this.emit({ type: 'notify', kind: 'preview_ready' });
    } catch (e) {
      this.pickError = e.code || 'probe_failed';
      this.log.info('미리보기 실패', { code: this.pickError });
      this.preview = null;
      this.mode = this.suspended ? 'running' : 'off';
      if (this.suspended) this.needFull = true;
      this.suspended = false;
    } finally {
      this.probing = null;
      this.refresh();
      this.wake();
    }
  }

  async buildPreview(root) {
    const fail = (code) => Object.assign(new Error(code), { code });
    if (!this.who) throw fail('unpaired');
    let st;
    try { st = fs.lstatSync(root); } catch { throw fail('missing'); }
    if (st.isSymbolicLink()) throw fail('link');
    if (!st.isDirectory()) throw fail('missing');
    if ((await this.driveType(root)) !== 'Fixed') throw fail('not_fixed');
    const ctx = { root, J: journal.fresh(), obs: new Map(), cache: new Map() };
    let L;
    for (let i = 0; ; i++) {
      L = await this.scanLocal(ctx, { progress: true, exts: this.proto === 1 ? PDF_ONLY : null });
      if (L.nestedMarker) throw fail('overlap');
      if (!L.unstable || i >= this.t.probeStableTries) break;
      await this.delay(this.t.stableMs);
    }
    const S = await this.fetchSnapshot();
    const place = (this.budget.otherDevices || 0) > 0 ? 'library' : 'local';
    // 미리보기는 sync/start 전이라 프로토콜을 모름 — 스냅숏 모양(새 필드)으로 짐작, 빈 서재면 새 서버로 봄. 옛 서버면 .pdf 만 다시 셈
    const proto = this.proto || this.snapshotProto || 2;
    if (proto < 2) L = { ...L, files: L.files.filter((f) => isPdfExt(f.rel)) };
    const plan = this.previewPlan(root, L, S, place, proto);
    return { root, place, defaultPlace: place, otherDevices: this.budget.otherDevices || 0, S, cursor: this.cursor, budget: this.budget, plan, at: this.now() };
  }

  previewPlan(root, L, S, place, proto = this.proto || 2) {
    const J0 = journal.fresh();
    const fp = R.planFolders(J0, L, S, { root });
    const p = R.planFiles(J0, L, S, { place, root, me: this.who ? this.who.deviceId : null, proto });
    const sum = (arr) => arr.reduce((a, x) => a + (x.size || 0), 0);
    const by = (t) => p.acts.filter((a) => a.t === t);
    const links = by('link');
    const ups = by('upload_new');
    const downs = by('download');
    const localNew = by('add_local'); // 이 PC에만 둘 파일(서버에 올리지 않음 — 선택 동기화 8.3절)
    const me = this.who ? this.who.deviceId : null;
    const elsewhere = proto >= 2 ? [...S.papers.values()].filter((sp) => sp.storage === 'local' && sp.holder !== me) : []; // 다른 PC에만 있음(받지 않음)
    const moved = links.filter((a) => !R.paperRel(S, S.papers.get(a.pid)) || P.fold(R.paperRel(S, S.papers.get(a.pid))) !== P.fold(a.at))
      .map((a) => ({ local: a.at, library: R.paperRel(S, S.papers.get(a.pid)) || '' }));
    const problems = [...L.problems, ...fp.problems, ...p.problems];
    const plan = {
      link: links.length, upload: ups.length, uploadBytes: sum(ups), download: downs.length, downloadBytes: sum(downs),
      restore: by('restore').length, foldersPc: fp.acts.filter((a) => a.t === 'mkdir').length,
      foldersLibrary: fp.acts.filter((a) => a.t === 'folder_create').length, moved: moved.slice(0, 200), movedCount: moved.length,
      skipped: problems.slice(0, LIMITS.problems), skippedCount: problems.length,
      empty: !L.files.length && !S.papers.size,
      localOnly: localNew.length, localOnlyBytes: sum(localNew), elsewhere: elsewhere.length,
    };
    const free = this.statfs(root);
    const b = this.budget || {};
    plan.disk = { free, after: free == null ? null : free - plan.downloadBytes };
    plan.budget = { bytes: b.upload_budget_bytes, limit: b.upload_budget_limit, userCap: b.user_cap_bytes, trash: b.trash_bytes };
    const blocks = [];
    if (free != null && plan.downloadBytes > free - DISK_SPARE) blocks.push({ kind: 'disk', need: plan.downloadBytes, free });
    if (Number.isFinite(b.upload_budget_bytes) && plan.uploadBytes > b.upload_budget_bytes) {
      blocks.push({ kind: b.upload_budget_limit === 'user' ? 'user' : 'storage', need: plan.uploadBytes, left: b.upload_budget_bytes, cap: b.user_cap_bytes, trash: b.trash_bytes });
    }
    const db = b.db;
    if (db && Number.isFinite(db.budget_bytes) && Number.isFinite(db.per_paper_bytes)) {
      const perLocal = Number.isFinite(db.per_local_bytes) ? db.per_local_bytes : PER_LOCAL_BYTES; // 로컬 항목은 본문 · 색인이 없어 편당 수 KB
      plan.db = { size: db.size_bytes, limit: db.limit_bytes, grow: plan.upload * db.per_paper_bytes + plan.localOnly * perLocal, budget: db.budget_bytes };
      if (plan.db.grow > db.budget_bytes) blocks.push({ kind: 'db', n: plan.upload + plan.localOnly, need: plan.db.grow, left: db.budget_bytes, size: db.size_bytes, limitBytes: db.limit_bytes });
    }
    plan.blocks = blocks;
    return plan;
  }

  async setPreviewPlace(place) {
    if (this.mode !== 'preview' || !['local', 'library'].includes(place)) return false;
    this.preview.place = place;
    this.refresh();
    return true;
  }

  async recheckPreview() {
    if (this.mode !== 'preview') return false;
    const root = this.preview.root;
    this.mode = 'probing';
    this.refresh();
    try { this.preview = { ...(await this.buildPreview(root)), place: this.preview.place }; this.mode = 'preview'; } catch (e) { this.pickError = e.code || 'probe_failed'; this.mode = this.suspended ? 'running' : 'off'; this.preview = null; }
    this.refresh();
    return true;
  }

  cancelPreview() {
    if (!['preview', 'probing'].includes(this.mode) && !this.preview) return false;
    this.preview = null;
    if (this.suspended) this.needFull = true; // 미리보기 스냅숏이 커서를 바꿨으니 옛 폴더는 처음부터 다시 맞춤
    this.mode = this.suspended ? 'running' : 'off';
    this.suspended = false;
    this.refresh();
    this.wake();
    return true;
  }

  /** 미리보기 [시작] — 이때 처음으로 표식 · 저널 · sync/start · 설정 저장(main) */
  async confirmStart(place) {
    if (this.mode !== 'preview' || !this.preview) return { ok: false, code: 'no_preview' };
    if (this.preview.plan.blocks.length) return { ok: false, code: 'blocked' };
    const pv = this.preview;
    const root = pv.root;
    const markerDir = path.join(root, P.SYNC_DIR);
    const rootId = this.uuid();
    const madeDir = !fs.existsSync(markerDir);
    try {
      fs.mkdirSync(path.join(markerDir, 'tmp'), { recursive: true });
      fs.writeFileSync(path.join(markerDir, 'root.json'), JSON.stringify({ root_id: rootId, device_id: this.who.deviceId, user_id: this.who.uid, created_at: new Date(this.now()).toISOString() }));
    } catch {
      if (madeDir) { removeEmptyDir(root, path.join(markerDir, 'tmp')); removeEmptyDir(root, markerDir); }
      this.pickError = 'not_writable'; // K-36: [시작]에서 표식을 못 만들면 같은 거부 — 루트 · 설정 저장 0
      this.preview = null;
      this.mode = this.suspended ? 'running' : 'off';
      this.suspended = false;
      this.refresh();
      return { ok: false, code: 'not_writable' };
    }
    await attrib(markerDir);
    this.cleanTmp(root);
    try {
      await this.callStart(root, true);
    } catch (e) {
      this.log.info('sync/start 실패', { status: e.status || 'network', code: e.code });
      return { ok: false, code: e.network ? 'offline' : e.code || 'start_failed' };
    }
    if (this.mode === 'running' || this.suspended) { this.closeWatcher(); this.held = null; }
    this.suspended = false;
    this.root = root;
    this.J = journal.fresh({ user_id: this.who.uid, device_id: this.who.deviceId, root, root_id: rootId });
    this.flushJournal();
    this.S = pv.S;
    this.cursor = pv.cursor;
    this.budget = pv.budget;
    this.place = pv.place;
    this.recovering = false;
    this.firstPassPending = true;
    this.needFull = false;
    this.lastFullAt = this.now();
    this.preview = null;
    this.mode = 'running';
    this.previousRoot = '';
    this.resetRuntime();
    this.emit({ type: 'started', root });
    this.log.info('동기화 시작');
    this.refresh();
    if (this.autoLoop) this.loop();
    this.wake();
    return { ok: true };
  }

  /** 루트 .paperlab-sync/tmp 바로 아래의 *.part 만 지움(받다 만 임시 파일 — safe-remove 규칙). 다른 파일은 건드리지 않음 */
  cleanTmp(root) {
    const tmp = path.join(root, P.SYNC_DIR, 'tmp');
    let names = [];
    try { names = fs.readdirSync(tmp, { withFileTypes: true }).filter((e) => e.isFile() && /\.part$/i.test(e.name)).map((e) => e.name); } catch { return 0; }
    let n = 0;
    for (const name of names) if (removeTemp(root, path.join(tmp, name))) n++;
    if (n) this.log.info('임시 파일 정리', { n });
    return n;
  }

  resetRuntime() {
    this.obs.clear(); this.hashCache.clear(); this.retries.clear(); this.goneSince.clear();
    this.approved.local.clear(); this.approved.remote.clear(); this.held = null; this.rootIssue = ''; this.dirty = true;
  }

  async callStart(root, enabled) {
    const t0 = this.now();
    const r = await this.api.post(`${API}/start`, { root_label: P.baseName(root).slice(0, 60), enabled });
    const t1 = this.now();
    const st = r && Date.parse(r.server_time);
    if (Number.isFinite(st)) this.offset = Math.round(st - (t0 + (t1 - t0) / 2));
    if (r && r.poll && Number(r.poll.idle_s) > 0) this.t.pollMs = Number(r.poll.idle_s) * 1000;
    if (enabled) this.setProtocol(r);
    return r;
  }

  /** start 응답의 protocol · exts(8.6절). 프로토콜이 바뀌면(서버 배포 · 되돌림) 전체 다시 맞추기 */
  setProtocol(r) {
    const proto = r && Number(r.protocol) >= 2 ? 2 : 1;
    const exts = r && Array.isArray(r.exts) ? r.exts.map((e) => String(e).toLowerCase()).filter((e) => SYNC_EXTS.includes(e)) : null;
    if (this.proto != null && this.proto !== proto) {
      this.needFull = true;
      this.dirty = true;
      this.log.info('동기화 프로토콜 바뀜', { from: this.proto, to: proto });
    }
    this.proto = proto;
    this.exts = exts && exts.length ? exts : null;
  }

  // ====================================================================== 루프
  async loop() {
    if (this.loopRunning) return;
    this.loopRunning = true;
    try {
      while (!this.stopped && this.mode !== 'off') {
        try { await this.cycle(); } catch (e) { this.log.error('동기화 한 바퀴 실패', { code: e.code || e.name }); }
        if (this.stopped || this.mode === 'off') break;
        await this.sleep(this.nextWaitMs());
      }
    } finally { this.loopRunning = false; }
  }

  nextWaitMs() {
    if (this.flags.offline) return Math.min(this.t.backoffMaxMs, this.backoff || this.t.backoffBaseMs);
    const now = this.now();
    const due = [this.feedDue, this.lastRootCheck + this.t.rootCheckMs, this.lastRescan + this.t.rescanMs];
    if (this.dirty) due.push(now + this.t.debounceMs);
    if (this.obs.size) due.push(now + this.t.stableMs);
    if (this.goneSince.size) due.push(now + this.t.deleteWaitMs);
    if (this.held && this.held.askAt) due.push(this.held.askAt);
    for (const r of this.retries.values()) due.push(r.at);
    return Math.max(50, Math.min(...due) - now);
  }

  sleep(ms) {
    return new Promise((resolve) => {
      const done = () => { this.clearTimer(timer); this.wakeFn = null; resolve(); };
      const timer = this.setTimer(done, ms);
      this.wakeFn = done;
    });
  }

  delay(ms) { return new Promise((r) => this.setTimer(r, ms)); }
  wake() { if (this.wakeFn) this.wakeFn(); }

  /** 한 바퀴: 루트 확인 → 서버(스냅숏 · 피드) → 필요하면 맞추기 → 상태 보고 */
  async cycle() {
    if (this.mode !== 'running' || this.suspended || this.busy) return;
    this.busy = true;
    try {
      if (!this.who) { this.turnOffLocal(); return; }
      if (this.J.user_id && this.J.user_id !== this.who.uid) { this.flags.accountMismatch = true; return; } // AC-674
      if (!this.J.user_id) { this.J.user_id = this.who.uid; this.J.device_id = this.who.deviceId; }
      if (this.flags.updateRequired && this.now() < this.updateRetryAt) return;
      if (this.paused) return;
      const now = this.now();
      if (this.rootIssue || now - this.lastRootCheck >= this.t.rootCheckMs || !this.lastRootCheck) {
        const was = this.rootIssue;
        this.rootIssue = await this.rootCheck(now, was);
        this.lastRootCheck = now;
        if (this.rootIssue) {
          this.closeWatcher();
          if (!was) { this.log.warn('동기화 폴더 잃음 — 멈춤', { issue: this.rootIssue }); this.emit({ type: 'notify', kind: 'root_missing', name: P.baseName(this.root) }); }
          return;
        }
        if (was) { this.needFull = true; this.dirty = true; this.log.info('동기화 폴더 다시 찾음'); }
      }
      if (!this.watcher && this.watch) this.startWatcher();
      // 프로토콜은 start 마다 다시 정함 — 처음 · 전체 다시 맞추기(6시간 · needFull) 때(8.6절)
      if (this.offset == null || this.proto == null || this.needFull || now - this.lastFullAt >= this.t.fullMs) await this.callStart(this.root, true);
      if (this.needFull || now - this.lastFullAt >= this.t.fullMs) {
        this.S = await this.fetchSnapshot();
        this.needFull = false;
        this.lastFullAt = now;
        this.fullReported = false;
        this.J.last_full_at = new Date(now).toISOString();
        this.dirty = true;
      } else if (now >= this.feedDue) {
        if (await this.pollFeed()) this.dirty = true;
      }
      this.flags.offline = false;
      this.flags.updateRequired = false;
      this.backoff = 0;
      if (now - this.lastRescan >= this.t.rescanMs || this.obs.size || this.goneSince.size || this.retries.size) this.dirty = true;
      if (this.held && this.held.askAt && now >= this.held.askAt) {
        this.held.askAt = now + this.t.reaskMs;
        this.emit({ type: 'notify', kind: this.held.kind, n: this.held.pids.size, always: true, ...this.heldLabel() });
      }
      if (this.dirty) {
        this.dirty = false;
        this.lastRescan = now;
        await this.pass();
      }
    } catch (e) {
      this.onApiError(e);
    } finally {
      this.busy = false;
      this.flushNotes();
      this.flushJournal();
      this.refresh();
      await this.reportStatus().catch(() => {});
    }
  }

  onApiError(e) {
    if (e && e.name === 'ApiError') {
      if (e.status === 401) { // main 에도 알림 — 워커와 같은 token-invalid 길(트레이 · 상태 · 토큰 지우기)
        this.log.warn('기기 인증 실패 — 동기화 끔', { code: e.code });
        this.turnOffLocal();
        this.emit({ type: 'token-invalid', code: e.code || 'device_auth_required' });
        return;
      }
      if (e.status === 426) { this.flags.updateRequired = true; this.updateRetryAt = this.now() + this.t.updateRetryMs; this.emit({ type: 'update-required' }); return; }
      if (e.status === 409 && e.code === 'resync_required') { this.needFull = true; this.dirty = true; return; }
      if (e.network || e.status >= 500 || e.status === 429) {
        this.flags.offline = true;
        this.backoff = Math.min(this.t.backoffMaxMs, this.backoff ? this.backoff * 2 : this.t.backoffBaseMs);
        return;
      }
      this.log.warn('서버 오류', { status: e.status, code: e.code });
      return;
    }
    this.log.error('동기화 오류', { code: (e && (e.code || e.name)) || 'error' });
  }

  /**
   * 루트 확인 → '' | 문제 코드. 가벼운 확인(checkRootAlive)은 매번. 깊은 확인(드라이브 종류 · 휴지통 "바로 삭제" — PowerShell)은 처음 · 문제가
   * 풀리는 순간에 하고, 깊은 확인으로만 아는 문제(drive · recycle_off)가 이어지는 동안은 rootDeepMs(10분)에 한 번만.
   */
  async rootCheck(now, was) {
    const issue = this.checkRootAlive();
    if (issue) return issue;
    if (this.lastRootCheck && !was) return '';
    if (DEEP_ISSUES.has(was) && now - this.lastDeepCheck < this.t.rootDeepMs) return was;
    this.lastDeepCheck = now;
    return this.deepRootIssue();
  }

  /** 가벼운 확인(파일 시스템만): '' = 괜찮음 | missing | junction | marker (12.3 · K-43) */
  checkRootAlive() {
    let st;
    try { st = fs.lstatSync(this.root); } catch { return 'missing'; }
    if (st.isSymbolicLink()) return 'junction';
    if (!st.isDirectory()) return 'missing';
    try {
      const real = fs.realpathSync.native(this.root);
      if (P.fold(real).replace(/\\+$/, '') !== P.fold(path.resolve(this.root)).replace(/\\+$/, '')) return 'junction';
      fs.readdirSync(this.root);
    } catch { return 'missing'; }
    const marker = (() => { try { return JSON.parse(fs.readFileSync(path.join(this.root, P.SYNC_DIR, 'root.json'), 'utf8')); } catch { return null; } })();
    if (!marker) return 'marker';
    if (this.J.root_id && marker.root_id !== this.J.root_id) return 'marker';
    if (!this.J.root_id) {
      if (marker.device_id !== this.who.deviceId || (marker.user_id && marker.user_id !== this.who.uid)) return 'marker';
      this.J.root_id = marker.root_id;
    }
    return '';
  }

  /** 깊은 확인: '' | drive(고정 디스크 아님) | recycle_off(휴지통 "바로 삭제" — Q-5) */
  async deepRootIssue() {
    if ((await this.driveType(this.root)) !== 'Fixed') return 'drive';
    if ((await this.recycleNuke(this.root)) === 'on') return 'recycle_off';
    return '';
  }

  startWatcher() {
    this.watcher = this.watch(this.root, (kind) => {
      if (kind === 'root') { this.lastRootCheck = 0; this.closeWatcher(); }
      if (kind === 'overflow') this.lastRescan = 0;
      this.dirty = true;
      this.wake();
    });
  }

  closeWatcher() { if (this.watcher) { try { this.watcher.close(); } catch { /* 닫힘 */ } this.watcher = null; } }

  // ====================================================================== 서버 상태 (스냅숏 · 피드)
  async fetchSnapshot() {
    const S = emptyS();
    let pageAfter = null;
    let first = null;
    let v2Fields = false;
    for (let guard = 0; guard < 10000; guard++) {
      const r = await this.api.post(`${API}/snapshot`, pageAfter ? { page_after: pageAfter, limit: LIMITS.snapshot } : { limit: LIMITS.snapshot });
      if (!first) first = r;
      for (const f of r.folders || []) { S.folders.set(Number(f.id), normFolder(f)); if ('sync_mode' in f) v2Fields = true; }
      for (const p of r.papers || []) { if (p.sha256) S.papers.set(Number(p.id), normPaper(p)); if ('storage' in p || 'kind' in p) v2Fields = true; }
      for (const t of r.trashed || []) S.trashed.set(Number(t.id), { sha256: t.sha256 || '', label: t.deleted_by_label || '' });
      for (const t of r.tombstones || []) (t.kind === 'folder' ? S.goneFolders : S.gonePapers).add(Number(t.id));
      if (!r.more || !r.next) break;
      pageAfter = r.next;
    }
    this.cursor = first ? first.cursor : null;
    this.J && (this.J.cursor = this.cursor);
    this.snapshotProto = v2Fields ? 2 : S.folders.size || S.papers.size ? 1 : null; // 미리보기용 짐작(빈 서재면 모름)
    this.budget = first ? {
      upload_budget_bytes: first.upload_budget_bytes, upload_budget_limit: first.upload_budget_limit, user_cap_bytes: first.user_cap_bytes,
      trash_bytes: first.trash_bytes, db: first.db || null, otherDevices: Number(first.other_sync_devices) || 0,
    } : {};
    this.feedDue = this.now();
    return S;
  }

  async pollFeed() {
    let changed = false;
    for (let guard = 0; guard < 100; guard++) {
      const r = await this.api.post(`${API}/changes`, { cursor: this.cursor, limit: LIMITS.changes });
      for (const ch of r.changes || []) { this.applyChange(ch); changed = true; }
      if (r.cursor) this.cursor = r.cursor;
      const next = Number(r.next_poll_s);
      this.feedDue = this.now() + (Number.isFinite(next) && next > 0 ? next * 1000 : this.t.pollMs);
      if (!r.more) break;
    }
    if (this.J) this.J.cursor = this.cursor;
    return changed;
  }

  applyChange(ch) {
    const id = Number(ch.id);
    const S = this.S;
    const d = ch.data || {};
    if (ch.kind === 'folder') {
      if (ch.op === 'delete') { S.folders.delete(id); S.goneFolders.add(id); }
      else S.folders.set(id, normFolder({ ...d, id }));
      return;
    }
    // 서버가 이 논문을 바꿈(취소 뒤 다시 요청 등 — 서버 mode_error 가 비었을 수 있음) → 보낸 mode.fail 기록을 잊어 같은 이유도 다시 알림
    if (this.J && this.J.modeFails) delete this.J.modeFails[id];
    if (ch.op === 'upsert') {
      S.trashed.delete(id);
      if (d.sha256) S.papers.set(id, normPaper({ ...d, id })); else S.papers.delete(id);
    } else if (ch.op === 'trash') {
      const cur = S.papers.get(id);
      S.papers.delete(id);
      S.trashed.set(id, { sha256: d.sha256 || (cur && cur.sha256) || '', label: d.deleted_by_label || '' });
    } else if (ch.op === 'delete') {
      S.papers.delete(id); S.trashed.delete(id); S.gonePapers.add(id);
    }
  }

  // ====================================================================== PC 검사
  /**
   * ctx = {root, J, obs, cache} → {files, dirs, problems, unstable, nestedMarker}
   * 해시가 필요한 파일(저널과 크기 · 시각 · ID · 경로 중 하나라도 다름)은 안정된 뒤에만, 속성 확인을 먼저(K-45).
   */
  async scanLocal(ctx, { progress = false, exts = this.scanExts() } = {}) {
    const { root, J } = ctx;
    const kept = new Set((J.kept || []).map(P.fold));
    const tree = await scanner.scanTree(root, { skip: (rel) => kept.has(P.fold(rel)), exts });
    const now = this.now();
    const problems = [...tree.problems];
    const byKey = new Map();
    for (const j of Object.values(J.files)) byKey.set(P.fold(j.rel), j);
    const need = [];
    for (const f of tree.files) {
      f.sha256 = null;
      const j = byKey.get(f.key);
      if (j && j.size === f.size && j.mtime_ms === f.mtime_ms && j.ino === f.ino && j.rel === f.rel) { f.sha256 = j.sha256; continue; }
      const c = ctx.cache.get(f.key);
      if (c && c.size === f.size && c.mtime_ms === f.mtime_ms && c.ino === f.ino) { f.sha256 = c.sha256; continue; }
      need.push(f);
    }
    const ready = [];
    let unstable = 0;
    for (const f of need) {
      const o = ctx.obs.get(f.key);
      if (!o || o.size !== f.size || o.mtime !== f.mtime_ms) {
        ctx.obs.set(f.key, { size: f.size, mtime: f.mtime_ms, at: now, count: 0, since: o ? o.since : now });
        if (this.t.stableChecks === 0) ready.push(f); else unstable++;
        if (o && now - o.since > this.t.writingMs) problems.push({ code: 'writing', rel: f.rel });
      } else if (now - o.at >= this.t.stableMs) {
        o.count++; o.at = now;
        if (o.count >= this.t.stableChecks) ready.push(f); else unstable++;
      } else unstable++;
    }
    const absOf = (f) => path.join(root, f.rel);
    const attrs = ready.length ? await this.readAttrs(ready.map(absOf)) : new Map();
    if (progress && this.probing) { this.probing.total = ready.length; this.probing.done = 0; this.refresh(); }
    for (const f of ready) {
      const abs = absOf(f);
      const a = attrs.has(abs) ? attrs.get(abs) : -1;
      const bad = scanner.attrProblem(a);
      if (bad) { problems.push({ code: bad, rel: f.rel }); f.blocked = true; ctx.obs.delete(f.key); continue; }
      if (a & scanner.ATTR.READONLY) f.ro = true;
      if (!(await scanner.canRead(abs))) { problems.push({ code: 'busy', rel: f.rel }); unstable++; continue; }
      let h = null;
      try { h = await scanner.hashFile(abs); } catch { h = null; }
      if (progress && this.probing) { this.probing.done++; if (this.probing.done % 20 === 0) this.refresh(); }
      if (!h) { ctx.obs.delete(f.key); unstable++; continue; }
      ctx.obs.delete(f.key);
      // 형식 판정(8.1): 첫 바이트 %PDF 면 이름과 관계없이 PDF, 아니면 확장자 + 매직이 맞아야. v1(옛 서버)은 PDF 만
      const kind = kindOf(h.head, f.rel);
      if (!kind || (exts === PDF_ONLY && kind !== 'pdf')) { problems.push({ code: isPdfExt(f.rel) ? 'not_pdf' : 'bad_format', rel: f.rel }); f.blocked = true; continue; }
      f.sha256 = h.sha256;
      ctx.cache.set(f.key, { size: f.size, mtime_ms: f.mtime_ms, ino: f.ino, sha256: h.sha256 });
    }
    // 사라진 파일의 관찰 기록 정리
    const keys = new Set(tree.files.map((f) => f.key));
    for (const k of ctx.obs.keys()) if (!keys.has(k)) ctx.obs.delete(k);
    for (const k of ctx.cache.keys()) if (!keys.has(k)) ctx.cache.delete(k);
    const files = tree.files.map((f) => (f.blocked ? { ...f, sha256: null } : f));
    // 같은 경로에서 해시가 막힌 J 파일은 "아직 모름"(sha null)으로 남겨 삭제로 읽히지 않게
    return { files, dirs: tree.dirs, problems, excluded: tree.excluded, unstable, nestedMarker: tree.nestedMarker };
  }

  // ====================================================================== 맞추기
  async pass() {
    const ctx = { root: this.root, J: this.J, obs: this.obs, cache: this.hashCache };
    const execProblems = [];
    let L = null;
    let totalDone = 0;
    this.pruneModeFails();
    for (let iter = 0; iter < 8; iter++) {
      L = await this.scanLocal(ctx);
      this.pruneLocalRetries(L);
      if (L.nestedMarker) execProblems.push({ code: 'nested_root', rel: '' });
      const fp = R.planFolders(this.J, L, this.S, { root: this.root });
      const fdone = await this.execFolders(fp.acts, L, execProblems);
      if (fdone) { totalDone += fdone; continue; }
      const p = R.planFiles(this.J, L, this.S, { place: this.place, root: this.root, me: this.who.deviceId, proto: this.proto || 1, forceCloud: this.forceCloud });
      this.lastPlan = { problems: [...fp.problems, ...p.problems], up: p.acts.filter((a) => /^upload|^restore|^promote/.test(a.t)).length, down: p.acts.filter((a) => a.t === 'download' || a.t === 'swap_rep').length };
      this.lastPlan.todo = p.acts.length;
      this.progress = { done: 0, total: p.acts.length };
      const done = await this.execFiles(p.acts, L, execProblems);
      totalDone += done;
      if (!done) break;
    }
    const kept = (this.J.kept || []).map((rel) => ({ code: 'folder_kept', rel }));
    // 끄기를 확인하지 못해 서버에 알린 것(mode.fail) — 대기가 남아 있는 동안 문제 목록에(10.9)
    const modeFailed = Object.keys(this.J.modeFails || {}).map(Number).filter((pid) => { const sp = this.S.papers.get(pid); return sp && sp.pending === 'to_local'; })
      .map((pid) => ({ code: 'mode_fail', rel: R.paperRel(this.S, this.S.papers.get(pid)) || this.S.papers.get(pid).file_name }));
    this.problems = dedupeProblems([...(L ? L.problems : []), ...(this.lastPlan.problems || []), ...execProblems, ...this.retryProblems(), ...kept, ...modeFailed]);
    this.progress = null;
    if (totalDone || !this.lastSyncAt) this.lastSyncAt = this.now();
    if (this.firstPassPending && !this.lastPlan.todo) {
      this.firstPassPending = false;
      this.emit({ type: 'notify', kind: 'first_done', counts: this.firstCounts || {} });
    }
    if (!this.lastPlan.todo || totalDone) this.place = 'local';
    this.archiveBytes = dirSize(path.join(this.root, P.SYNC_DIR, '보관함'));
    this.log.info('맞추기', { done: totalDone, files: Object.keys(this.J.files).length, problems: this.problems.length });
  }

  /** 보낸 mode.fail 기록(J.modeFails)은 서버가 아직 "끄기 대기 · 보관 = 이 PC"일 때만 둠 — 취소 · 끝남 · 넘겨줌이면 지움 */
  pruneModeFails() {
    const mf = this.J && this.J.modeFails;
    if (!mf) return;
    const me = this.who && this.who.deviceId;
    for (const k of Object.keys(mf)) {
      const sp = this.S.papers.get(Number(k));
      if (!sp || sp.storage === 'local' || sp.pending !== 'to_local' || sp.holder == null || me == null || Number(sp.holder) !== Number(me)) delete mf[k];
    }
  }

  retryProblems() {
    const out = [];
    for (const [k, r] of this.retries) if (r.rel != null) out.push({ code: r.code || 'retrying', rel: r.rel, at: r.at, key: k, ...(r.label ? { label: r.label } : {}) });
    return out;
  }

  /** 재시도 대기 중이면 true(이번엔 건너뜀) */
  waiting(key) { const r = this.retries.get(key); return !!r && this.now() < r.at; }

  /** 재시도 대기. base 는 바닥 — 앞서 짧게 실패한 키도 다시 시도 안 함(24시간) · 한도 대기는 그보다 줄지 않음. label = 문제 목록에 보일 이름(보관 PC 등) */
  failLater(key, code, rel, { base = this.t.retryBaseMs, label = '', local = null } = {}) {
    const r = this.retries.get(key);
    const ms = r ? Math.max(base, Math.min(this.t.retryMaxMs, r.ms * 2)) : base;
    this.retries.set(key, { at: this.now() + ms, ms, code, rel, ...(label ? { label: String(label) } : {}), ...(local ? { local } : {}) });
  }

  /**
   * PC 파일 하나에 묶인 긴 대기(local = 해시 또는 true — 서버 거절 · 확장자 바꾸기 · local_elsewhere)는 그 파일이 없어지거나
   * 내용이 바뀌면 지움 — 고친 뒤에도 옛 이유가 24시간 문제 목록에 남지 않게(바뀐 파일은 키가 달라 바로 다시 시도)
   */
  pruneLocalRetries(L) {
    const byKey = new Map(L.files.map((f) => [f.key, f]));
    for (const [k, r] of this.retries) {
      if (!r.local || r.rel == null) continue;
      const f = byKey.get(P.fold(r.rel));
      if (!f || (typeof r.local === 'string' && f.sha256 != null && f.sha256 !== r.local)) this.retries.delete(k);
    }
  }

  okNow(key) { this.retries.delete(key); }

  opId(key) {
    if (!this.J.opIds[key]) this.J.opIds[key] = this.uuid();
    return this.J.opIds[key];
  }

  doneOp(key) { delete this.J.opIds[key]; }

  folderIdOf(rel) {
    if (!rel) return null;
    const k = P.fold(rel);
    for (const [fid, f] of Object.entries(this.J.folders)) if (P.fold(f.rel) === k) return Number(fid);
    return undefined;
  }

  rebaseJ(from, to) {
    for (const f of Object.values(this.J.files)) f.rel = P.rebase(f.rel, from, to);
    for (const f of Object.values(this.J.folders)) f.rel = P.rebase(f.rel, from, to);
  }

  /** ops 묶음(최대 20) → 항목별 결과. 한 항목 실패가 다른 항목을 막지 않음(서버) */
  async ops(list) {
    const out = [];
    for (const part of chunks(list, LIMITS.ops)) {
      const r = await this.api.post(`${API}/ops`, { ops: part.map((o) => o.op) });
      const res = Array.isArray(r) ? r : (r && (r.results || r.ops)) || [];
      const byId = new Map(res.map((x) => [x.op_id, x]));
      for (const o of part) out.push({ ...o, res: byId.get(o.op.op_id) || { ok: false, code: 'missing' } });
    }
    return out;
  }

  // ---------------------------------------------------------------------- 폴더 실행
  async execFolders(acts, L, problems) {
    let done = 0;
    const lDirs = new Map(L.dirs.map((d) => [d.key, d]));
    const moving = [];
    for (const a of acts) {
      if (a.t === 'drop_dir') { delete this.J.folders[a.fid]; done++; continue; }
      if (a.t === 'link_dir') { this.J.folders[a.fid] = { rel: a.rel, ino: a.ino }; done++; continue; }
      if (a.t === 'move_dir') {
        if (moving.some((m) => P.isUnder(a.from, m) || P.isUnder(a.to, m))) continue;
        if (this.waiting(`dir:${a.fid}`)) continue;
        const from = P.safeJoin(this.root, a.from);
        const to = P.safeJoin(this.root, a.to);
        if (!from || !to) { problems.push({ code: 'bad_name_server', rel: a.to }); continue; }
        if (to.length > P.MAX_PATH) { problems.push({ code: 'too_long_down', rel: a.to }); continue; }
        if (!this.isRealDir(from) || !this.isRealDir(path.dirname(to))) continue;
        if (fs.existsSync(to) && P.fold(a.from) !== P.fold(a.to)) continue; // 자리에 다른 것 — 다음에
        try { fs.renameSync(from, to); } catch (e) { this.failLater(`dir:${a.fid}`, 'busy', a.from); continue; }
        this.okNow(`dir:${a.fid}`);
        this.rebaseJ(a.from, a.to);
        moving.push(a.from);
        done++;
      }
    }
    // 서버 폴더 바꾸기(PC 이름 · 위치) — 얕은 것부터, 겹치는 것은 다음 검사로
    const updates = acts.filter((a) => a.t === 'folder_update').filter((a, _i, arr) => !arr.some((b) => b !== a && P.isUnder(this.J.folders[a.fid].rel, this.J.folders[b.fid].rel)));
    const ups = [];
    for (const a of updates) {
      if (!this.confirmDirMove(a, L)) { // 파일 ID 는 힌트 — 안의 구성으로 확인되지 않으면 이동으로 보지 않음(K-44)
        delete this.J.folders[a.fid];
        done++;
        continue;
      }
      const parentId = this.folderIdOf(P.parentRel(a.rel));
      if (parentId === undefined) continue;
      const key = `fupd:${a.fid}:${P.fold(a.rel)}`;
      ups.push({ a, key, op: { op_id: this.opId(key), type: 'folder.update', id: a.fid, name: P.nfc(P.baseName(a.rel)), parent_id: parentId } });
    }
    for (const r of ups.length ? await this.ops(ups) : []) {
      const { a, key, res } = r;
      this.doneOp(key);
      if (res.ok && res.result === 'applied' && res.folder) {
        const f = res.folder;
        this.S.folders.set(Number(f.id), normFolder({ sync_mode: (this.S.folders.get(Number(f.id)) || {}).sync_mode, ...f }));
        this.rebaseJ(this.J.folders[a.fid].rel, a.rel);
        done++;
      } else if (res.result === 'rejected' || res.result === 'gone' || res.code === 'not_found') { delete this.J.folders[a.fid]; this.needFull = true; done++; } else this.failLater(key, 'retrying', a.rel);
    }
    // PC 에 폴더 만들기(서버 새 폴더)
    for (const a of acts.filter((x) => x.t === 'mkdir')) {
      const abs = P.safeJoin(this.root, a.rel);
      if (!abs) { problems.push({ code: 'bad_name_server', rel: a.rel }); continue; }
      if (!this.isRealDir(path.dirname(abs))) continue;
      if (lDirs.has(P.fold(a.rel)) || fs.existsSync(abs)) continue;
      try { fs.mkdirSync(abs); } catch { this.failLater(`mkdir:${a.fid}`, 'retrying', a.rel); continue; }
      let ino = '';
      try { const st = fs.lstatSync(abs, { bigint: true }); ino = st.ino ? `${st.dev}:${st.ino}` : ''; } catch { /* 없음 */ }
      this.J.folders[a.fid] = { rel: a.rel, ino };
      done++;
    }
    // 서버에 폴더 만들기(PC 새 디렉터리) — 깊이별(부모 id 가 필요)
    const creates = acts.filter((x) => x.t === 'folder_create');
    const depths = [...new Set(creates.map((a) => P.depth(a.rel)))].sort((x, y) => x - y);
    for (const d of depths) {
      const batch = [];
      for (const a of creates.filter((x) => P.depth(x.rel) === d)) {
        const parentId = this.folderIdOf(P.parentRel(a.rel));
        if (parentId === undefined) continue;
        const key = `fnew:${P.fold(a.rel)}`;
        batch.push({ a, key, op: { op_id: this.opId(key), type: 'folder.create', parent_id: parentId, name: P.nfc(P.baseName(a.rel)) } });
      }
      for (const r of batch.length ? await this.ops(batch) : []) {
        const { a, key, res } = r;
        this.doneOp(key);
        if (res.ok && res.folder) {
          const f = res.folder;
          this.S.folders.set(Number(f.id), normFolder(f));
          if (a.replace != null) delete this.J.folders[a.replace];
          this.J.folders[Number(f.id)] = { rel: a.rel, ino: a.ino || '' };
          done++;
        } else this.failLater(key, 'retrying', a.rel);
      }
    }
    return done;
  }

  /** 디렉터리 이동 확인: 비었거나, 저널의 안쪽 파일 절반 이상(최소 1개)이 새 위치에 같은 크기 · 시각으로 있음 */
  confirmDirMove(a, L) {
    const from = this.J.folders[a.fid].rel;
    const inside = Object.values(this.J.files).filter((f) => P.isUnder(f.rel, from));
    if (!inside.length) return true;
    const lByKey = new Map(L.files.map((f) => [f.key, f]));
    const hit = inside.filter((f) => { const l = lByKey.get(P.fold(P.rebase(f.rel, from, a.rel))); return l && l.size === f.size && l.mtime_ms === f.mtime_ms; }).length;
    return hit >= 1 && hit * 2 >= inside.length;
  }

  isRealDir(abs) {
    if (P.fold(path.resolve(abs)) === P.fold(path.resolve(this.root))) return true;
    if (!P.isInside(this.root, abs)) return false;
    // 루트에서 대상까지 링크 · 정션이 없어야 함(12.4)
    let cur = path.resolve(abs);
    const top = P.fold(path.resolve(this.root));
    while (P.fold(cur) !== top) {
      try { const st = fs.lstatSync(cur); if (st.isSymbolicLink() || !st.isDirectory()) return false; } catch { return false; }
      cur = path.dirname(cur);
    }
    return true;
  }

  // ---------------------------------------------------------------------- 파일 실행
  async execFiles(acts, L, problems) {
    let done = 0;
    const lByKey = new Map(L.files.map((f) => [f.key, f]));
    const tick = () => { if (this.progress) { this.progress.done++; if (this.progress.done % 10 === 0) this.refresh(); } };
    const by = (t) => acts.filter((a) => a.t === t);
    for (const a of [...by('drop'), ...by('refresh'), ...by('link')]) {
      if (a.t === 'drop') delete this.J.files[a.pid];
      else this.J.files[a.pid] = { rel: a.rel, sha256: a.sha256, size: a.size, mtime_ms: a.mtime_ms, ino: a.ino || '', kind: this.repKind(a.pid) };
      if (a.t === 'link') this.firstCount('link');
      done++;
    }
    await this.finishSwapping(problems); // 지난번 표현 바꾸기에서 남은 옛 변환본(J.swapping) — 휴지통으로
    for (const a of by('local_move')) { if (await this.localMove(a, problems)) { done++; tick(); } }
    done += await this.serverMoves(by('srv_move'), problems);
    done += await this.modeOps([...by('mode_ack'), ...by('mode_fail')]); // 끄기 확인 · 실패 알림(ops 묶음 — 8.3절 순서)
    done += await this.uploads([...by('upload_content'), ...by('upload_new'), ...by('restore'), ...by('add_local'), ...by('promote')], lByKey, problems, tick);
    done += await this.downloads(by('download'), problems, tick);
    done += await this.swaps(by('swap_rep'), problems, tick);
    done += await this.serverDeletes(by('srv_delete'), L);
    const trashes = by('trash_local');
    done += await this.localTrash(trashes.filter((a) => a.reason !== 'moved_local'), problems, 'remote_delete');
    done += await this.localTrash(trashes.filter((a) => a.reason === 'moved_local'), problems, 'moved_local'); // 다른 PC에만 두기로 한 사본(D-4)
    // 사라진 J 파일 중 이번 계획에 없는 것(다시 나타남 등)의 대기 기록 정리
    const goneNow = new Set(by('srv_delete').map((a) => a.pid));
    for (const pid of this.goneSince.keys()) if (!goneNow.has(pid)) this.goneSince.delete(pid);
    if (this.held && this.held.kind !== 'remote_delete' && this.held.kind !== 'moved_local') {
      for (const pid of [...this.held.pids]) if (!goneNow.has(pid)) this.held.pids.delete(pid);
      if (!this.held.pids.size) this.held = null;
    }
    // 폴더 지우기(자식 먼저) — 서버 folder.delete · 빈 디렉터리
    const fdel = by('folder_delete').filter((a) => !this.held);
    const batch = fdel.map((a) => { const key = `fdel:${a.fid}`; return { a, key, op: { op_id: this.opId(key), type: 'folder.delete', id: a.fid } }; });
    for (const r of batch.length ? await this.ops(batch) : []) {
      this.doneOp(r.key);
      if (r.res.result === 'deleted' || r.res.code === 'not_found') { delete this.J.folders[r.a.fid]; this.S.folders.delete(r.a.fid); this.S.goneFolders.add(r.a.fid); done++; }
      else if (r.res.result === 'not_empty') { delete this.J.folders[r.a.fid]; this.needFull = true; done++; } // 다른 곳에서 넣은 논문 → 디렉터리를 다시 만들고 받음
      else this.failLater(r.key, 'retrying', r.a.rel);
    }
    for (const a of by('rmdir')) {
      const abs = P.safeJoin(this.root, a.rel);
      if (abs && this.isRealDir(abs) && removeEmptyDir(this.root, abs)) { delete this.J.folders[a.fid]; done++; continue; }
      // 남은 파일(비PDF 등) → 디렉터리를 두고 다시 서재 폴더로 만들지 않음
      if (!this.J.kept.some((k) => P.fold(k) === P.fold(a.rel))) this.J.kept.push(a.rel);
      delete this.J.folders[a.fid];
      problems.push({ code: 'folder_kept', rel: a.rel });
      done++;
    }
    return done;
  }

  firstCount(k) { if (this.firstPassPending) { this.firstCounts = this.firstCounts || { link: 0, up: 0, down: 0 }; this.firstCounts[k]++; } }

  async localMove(a, problems) {
    const key = `mv:${a.pid}`;
    if (this.waiting(key)) return false;
    const from = P.safeJoin(this.root, a.from, { file: true });
    const to = P.safeJoin(this.root, a.to, { file: true });
    if (!to) { problems.push({ code: 'bad_name_server', rel: a.to }); return false; }
    if (!from) return false;
    if (to.length > P.MAX_PATH || from.length > P.MAX_PATH) { problems.push({ code: to.length > P.MAX_PATH ? 'too_long_down' : 'too_long_local', rel: a.from }); return false; }
    if (!this.isRealDir(path.dirname(to)) || !this.isRealDir(path.dirname(from))) return false;
    // 대소문자만 바꾸는 이름 바꾸기: NFC 는 넣지 않음(Windows 는 NFC · NFD 이름을 다른 파일로 봄 — renameSync 가 덮어씀).
    // 자리에 무언가 있으면 정말 같은 파일일 때만(realpath) 이어감 — 아니면 덮어쓰지 않음
    const caseOnly = a.from.toLowerCase() === a.to.toLowerCase();
    if (fs.existsSync(to) && !(caseOnly && sameFile(from, to))) return false;
    try { const st = fs.lstatSync(from); if (!st.isFile()) return false; } catch { return false; }
    try { fs.renameSync(from, to); } catch (e) {
      if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') { this.failLater(key, 'busy', a.from); return false; }
      return false;
    }
    this.okNow(key);
    const j = this.J.files[a.pid];
    if (j) j.rel = a.to;
    return true;
  }

  async serverMoves(acts, problems) {
    const list = [];
    for (const a of acts) {
      const folderId = this.folderIdOf(P.parentRel(a.rel));
      if (folderId === undefined) continue;
      const key = `fmv:${a.pid}:${P.fold(a.rel)}`;
      if (this.waiting(key)) continue;
      list.push({ a, key, op: { op_id: this.opId(key), type: 'file.move', id: a.pid, folder_id: folderId, file_name: P.nfc(P.baseName(a.rel)) } });
    }
    let done = 0;
    for (const r of list.length ? await this.ops(list) : []) {
      const { a, key, res } = r;
      this.doneOp(key);
      if (res.ok && res.result === 'applied') {
        if (res.paper) this.S.papers.set(Number(res.paper.id), normPaper({ ...this.S.papers.get(a.pid), ...res.paper }));
        else this.S.papers.set(a.pid, { ...this.S.papers.get(a.pid), folder_id: this.folderIdOf(P.parentRel(a.rel)), file_name: P.nfc(P.baseName(a.rel)) });
        const j = this.J.files[a.pid];
        if (j) j.rel = a.rel; // 서버가 이름을 바꿨으면(K-8) 다음 비교가 PC 이름을 맞춤
        done++;
      } else if (res.result === 'gone') { this.needFull = true; done++; } else if (res.code === 'bad_name') {
        // 서버가 이름을 받지 않음(C-1) — 확장자 바꾸기(PC 표현은 그대로) 등. 같은 이름이면 같은 결과라 다시 보내지 않음(이름을 바꾸면 키가 달라짐)
        const sp = this.S.papers.get(a.pid);
        const extChanged = !!sp && path.extname(sp.file_name).toLowerCase() !== path.extname(a.rel).toLowerCase();
        this.failLater(key, extChanged ? 'ext_change' : 'bad_name_local', a.rel, { base: NO_RETRY_MS, local: true });
      } else { this.failLater(key, 'retrying', a.rel); problems.push({ code: 'retrying', rel: a.rel }); }
    }
    return done;
  }

  // ---------------------------------------------------------------------- 삭제 (대량 검사 — K-12 · 12.2 · 12.3)
  massExceeded(n, kind) {
    const now = this.now();
    const win = this.sent[kind].filter((x) => now - x.at < this.t.massWindowMs);
    this.sent[kind] = win;
    const total = n + win.reduce((s, x) => s + x.n, 0);
    const base = Math.max(1, Object.keys(this.J.files).length);
    return total >= MASS.count || (total >= base * MASS.ratio && total >= MASS.min);
  }

  hold(kind, pids, labels = []) {
    if (!this.held) {
      this.held = { batch_id: this.uuid(), kind, pids: new Set(), labels: new Set(), askAt: this.now() + this.t.reaskMs, base: Object.keys(this.J.files).length };
      for (const l of labels) if (l) this.held.labels.add(l);
      this.emit({ type: 'notify', kind, n: pids.length, always: true, ...this.heldLabel() });
      this.log.info('대량 삭제 — 확인 대기', { kind, n: pids.length });
    }
    for (const p of pids) this.held.pids.add(p);
    for (const l of labels) if (l) this.held.labels.add(l);
  }

  /** 다른 PC에만 두기(moved_local) 알림의 보관 PC 이름 {label} — 보관 PC가 하나로 같을 때만(‘연구실 PC’), 아니면 {} */
  heldLabel() {
    const h = this.held;
    return h && h.kind === 'moved_local' && h.labels.size === 1 ? { label: [...h.labels][0] } : {};
  }

  async serverDeletes(acts, L) {
    const now = this.now();
    const ready = [];
    for (const a of acts) {
      if (!this.goneSince.has(a.pid)) this.goneSince.set(a.pid, now);
      if (now - this.goneSince.get(a.pid) >= this.t.deleteWaitMs) ready.push(a);
    }
    if (!ready.length) return 0;
    const approved = ready.filter((a) => this.approved.local.has(a.pid));
    let rest = ready.filter((a) => !this.approved.local.has(a.pid));
    if (this.held) {
      if (this.held.kind !== 'remote_delete') this.hold(this.held.kind, rest.map((a) => a.pid));
      rest = []; // 한 번에 묶음 하나만 — 기다리는 동안 새 삭제는 보내지 않음
    } else if (rest.length) {
      const base = Object.keys(this.J.files).length;
      const anomaly = base >= 2 * MASS.min && rest.length >= Math.ceil(base * MASS.anomaly);
      if (anomaly || this.massExceeded(rest.length, 'local')) { this.hold(anomaly ? 'root_anomaly' : 'local_delete', rest.map((a) => a.pid)); rest = []; }
    }
    const send = [...approved, ...rest];
    if (!send.length) return 0;
    for (const a of rest) this.approved.local.add(a.pid); // 대량 검사를 통과한 것 — 실패해 다시 시도할 때 또 세지 않음
    const list = send.map((a) => { const key = `del:${a.pid}`; return { a, key, op: { op_id: this.opId(key), type: 'file.delete', id: a.pid, base_sha256: a.base } }; });
    let done = 0;
    for (const r of await this.ops(list)) {
      const { a, key, res } = r;
      this.doneOp(key);
      this.goneSince.delete(a.pid);
      this.approved.local.delete(a.pid);
      if (res.result === 'trashed' || res.result === 'gone') {
        const sp = this.S.papers.get(a.pid);
        this.S.papers.delete(a.pid);
        this.S.trashed.set(a.pid, { sha256: (sp && sp.sha256) || a.base, label: '' });
        delete this.J.files[a.pid];
        done++;
      } else if (res.result === 'changed') { // 바뀐 쪽이 이김 — 지우지 않고 다시 받음(10.2)
        if (res.paper) this.S.papers.set(Number(res.paper.id), normPaper(res.paper));
        delete this.J.files[a.pid];
        this.needFull = true;
        this.note('rejected_delete', P.baseName(a.rel));
        done++;
      } else if (res.result === 'not_holder') { // 다른 PC에만 두기로 한 항목(D-4) — 이 PC 사본이 사라진 것뿐, 서재 항목은 그대로. 서버 상태를 다시 맞춤
        delete this.J.files[a.pid];
        this.needFull = true;
        done++;
      } else this.failLater(key, 'retrying', a.rel);
    }
    this.sent.local.push({ at: now, n: send.length });
    this.log.info('PC 삭제 반영', { n: done });
    return done;
  }

  /** 서버 → PC 지우기: kind 'remote_delete'(서재 휴지통) · 'moved_local'(다른 PC에만 두기로 바뀐 사본 — 선택 동기화 D-4). 대량 검사 공통 */
  async localTrash(acts, problems, kind = 'remote_delete') {
    // 기다리는 서재 → PC 묶음에서 이번에 더는 지울 대상이 아닌 것(다른 곳에서 되살림 등)을 뺌 — 비면 대기 끝
    if (this.held && this.held.kind === kind) {
      for (const pid of [...this.held.pids]) if (!acts.some((a) => a.pid === pid)) this.held.pids.delete(pid);
      if (!this.held.pids.size) this.held = null;
    }
    if (!acts.length) return 0;
    const approved = acts.filter((a) => this.approved.remote.has(a.pid));
    let rest = acts.filter((a) => !this.approved.remote.has(a.pid));
    if (this.held) {
      if (this.held.kind === kind) this.hold(kind, rest.map((a) => a.pid), rest.map((a) => a.label));
      rest = [];
    } else if (rest.length && this.massExceeded(rest.length, 'remote')) {
      this.hold(kind, rest.map((a) => a.pid), rest.map((a) => a.label));
      rest = [];
    }
    let done = 0;
    for (const a of rest) this.approved.remote.add(a.pid); // 대량 검사를 통과한 것 — 재시도 때 또 세지 않음
    const todo = [...approved, ...rest].map((a) => ({ ...a, abs: P.safeJoin(this.root, a.rel, { file: true }) })).filter((a) => a.abs);
    const attrs = await this.trashAttrs(todo);
    for (const a of todo) {
      const abs = a.abs;
      const r = await this.trashFile(abs, a.rel, problems, attrs);
      if (r === 'ok' || r === 'archived' || r === 'gone') {
        delete this.J.files[a.pid];
        this.approved.remote.delete(a.pid);
        done++;
      }
    }
    if (rest.length) this.sent.remote.push({ at: this.now(), n: rest.length });
    return done;
  }

  /** [서재에 되살리기](K-32): 그 파일들의 해시로 files/add → 서버가 restored */
  async restoreRemote(pids) {
    for (const pid of pids) {
      const j = this.J.files[pid];
      if (!j) continue;
      const folderId = this.folderIdOf(P.parentRel(j.rel));
      const key = `restore:${pid}`;
      try {
        const r = await this.api.post(`${API}/files/add`, { op_id: this.opId(key), sha256: j.sha256, size: j.size, mtime_ms: j.mtime_ms, clock_offset_ms: this.offset,
          folder_id: folderId === undefined ? null : folderId, file_name: P.nfc(P.baseName(j.rel)) });
        this.doneOp(key);
        if (r && r.paper) this.acceptPaper(r.paper, j.rel, j, pid);
      } catch (e) { this.onApiError(e); this.failLater(key, 'retrying', j.rel); }
    }
    this.held = null;
    this.flushJournal();
  }

  /** 휴지통에 보낼 파일들의 속성을 한 번에(PowerShell 한 번) — [{abs, rel}] 중 재시도 대기 · 없는 파일은 뺌 */
  async trashAttrs(items) {
    const list = items.filter((x) => !this.waiting(`trash:${P.fold(x.rel)}`) && fs.existsSync(x.abs)).map((x) => x.abs);
    return list.length ? this.readAttrs(list) : new Map();
  }

  /**
   * Windows 휴지통(main IPC) → 중단(aborted) · 시간 초과(timeout)는 파일을 제자리에 두고 지수 대기 재시도만(횟수 제한 없음, 최대 1시간 간격 —
   * 사용자 결정 2026-10-14), 해석 실패는 문제 목록, 그 밖 실패(other)만 보관함(K-43 · K-27). attrs = trashAttrs 결과(없으면 이 파일만 읽음)
   */
  async trashFile(abs, rel, problems, attrs = null) {
    const key = `trash:${P.fold(rel)}`;
    if (!abs) return 'skip';
    if (this.waiting(key)) return 'retry';
    try { if (!fs.lstatSync(abs).isFile()) return 'skip'; } catch { return 'gone'; }
    const a = attrs && attrs.has(abs) ? attrs.get(abs) : (await this.readAttrs([abs])).get(abs);
    if (a > 0 && (a & scanner.ATTR.READONLY)) { problems.push({ code: 'read_only', rel }); return 'skip'; }
    let r;
    try { r = await this.trashFn(abs); } catch { r = { ok: false, reason: 'other' }; }
    if (r && r.ok) {
      this.okNow(key);
      if (abs.length > P.MAX_PATH || r.reason === 'long_path') this.note('long_path', P.baseName(rel));
      return 'ok';
    }
    const reason = (r && r.reason) || 'other';
    if (reason === 'timeout') { this.failLater(key, 'trash_timeout', rel); return 'retry'; } // main 이 아직 보내는 중일 수 있음 — 보관함으로 옮기지 않음
    if (reason === 'aborted') { this.failLater(key, 'trash_aborted', rel); return 'retry'; } // 몇 번이 이어져도 보관함으로 옮기지 않음
    if (reason === 'parse_failed') { this.failLater(key, 'trash_parse_failed', rel, { base: this.t.retryMaxMs }); return 'retry'; }
    // 보관함: 루트\.paperlab-sync\보관함\YYYY-MM-DD\<상대 경로>(옮기기만 — 지우지 않음)
    const day = path.join(this.root, P.SYNC_DIR, '보관함', kstDate(this.now()));
    let dest = path.join(day, rel);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const ext = /(\.[^.\\]+)$/.exec(rel); // 아무 확장자(문서 · 사진도 — 선택 동기화 8.1)
      for (let i = 2; fs.existsSync(dest); i++) dest = path.join(day, ext ? `${rel.slice(0, -ext[1].length)} (${i})${ext[1]}` : `${rel} (${i})`);
      fs.renameSync(abs, dest);
    } catch {
      this.failLater(key, 'trash_failed', rel);
      return 'retry';
    }
    this.okNow(key);
    this.note('archived', P.baseName(rel));
    this.log.warn('휴지통 보내기 실패 — 보관함으로 옮김', { reason });
    return 'archived';
  }

  // ---------------------------------------------------------------------- 올리기 (K-30 · 10장 · 선택 동기화 8.4)
  /** 업로드 자리가 필요한 동작인가 — 되살리기 · 로컬 항목(add_local · 로컬 내용 메타데이터)은 바이트를 보내지 않음 */
  static needsSlot(a) { return a.t !== 'restore' && a.t !== 'add_local' && !(a.t === 'upload_content' && a.local); }

  async uploads(acts, lByKey, problems, tick) {
    if (!acts.length) return 0;
    const now = this.now();
    const blocked = !!this.uploadBlock && now < this.uploadBlock.until; // 저장 공간 · 한도 멈춤 — 바이트를 보내지 않는 동작은 계속
    if (!blocked) this.uploadBlock = null;
    const todo = [];
    for (const a of acts) {
      if (blocked && SyncEngine.needsSlot(a)) continue;
      const folderId = this.folderIdOf(P.parentRel(a.rel));
      if (folderId === undefined) continue; // 폴더가 먼저
      const key = a.t === 'upload_content' ? `content:${a.pid}:${a.sha256}` : a.t === 'promote' ? `promote:${a.pid}:${a.sha256}`
        : a.t === 'add_local' ? `addl:${P.fold(a.rel)}:${a.sha256}` : `add:${P.fold(a.rel)}:${a.sha256}`;
      if (this.waiting(key)) continue;
      todo.push({ ...a, folderId, key, abs: path.join(this.root, a.rel) });
    }
    const needSlot = todo.filter((a) => SyncEngine.needsSlot(a));
    const slots = new Map();
    try {
      for (const part of chunks(needSlot, LIMITS.slots)) {
        const r = await this.api.post(`${API}/upload-slots`, { files: part.map((a) => ({ size: a.size })) });
        const arr = Array.isArray(r) ? r : (r && (r.slots || r.items)) || [];
        part.forEach((a, i) => { if (arr[i] && arr[i].upload_id && arr[i].upload) slots.set(a, arr[i]); else this.failLater(a.key, 'retrying', a.rel); });
      }
    } catch (e) {
      if (!this.quotaError(e)) throw e;
    }
    let done = 0;
    let addLock = Promise.resolve();
    const serial = (fn) => { const p = addLock.then(fn, fn); addLock = p.catch(() => {}); return p; };
    await pool(todo, LIMITS.upload, async (a) => {
      const needs = SyncEngine.needsSlot(a);
      if (this.uploadBlock && needs) return;
      const slot = slots.get(a);
      if (needs && !slot) return;
      if (slot) {
        try { await this.transfer.put(slot.upload, a.abs, a.sha256); } catch (e) {
          this.failLater(a.key, e.code === 'bad_url' ? 'bad_url' : 'retrying', a.rel);
          this.log.warn('올리기 실패', { code: e.code || 'error' });
          return;
        }
      }
      await serial(async () => {
        if (this.uploadBlock && needs) return;
        try {
          if (await this.finishUpload(a, slot, lByKey, problems)) { done++; tick(); this.okNow(a.key); }
        } catch (e) {
          if (this.quotaError(e)) { if (!needs) this.failLater(a.key, 'retrying', a.rel, { base: this.t.quotaRetryMs }); return; }
          if (e && e.name === 'ApiError' && (e.network || e.status >= 500 || e.status === 429)) { this.failLater(a.key, 'retrying', a.rel, { base: 5000 }); return; }
          const rj = this.uploadRejected(a, e);
          if (rj === 'no_retry') return; // 형식 · 변환 거절 — 이유 · 24시간 대기를 그대로 둠(다시 맞추기 · 재시도로 덮지 않음)
          if (rj) { done++; return; }
          if (e && e.name === 'ApiError' && e.status === 404 && a.t === 'upload_content') { delete this.J.files[a.pid]; done++; return; } // 영구 삭제된 논문 → 새 파일로
          if (e && e.name === 'ApiError' && e.status === 400) this.needFull = true; // 서버 상태와 어긋남(되살릴 휴지통 논문이 없음 등) → 다시 맞춤
          this.failLater(a.key, 'retrying', a.rel);
          this.log.warn('올리기 완료 실패', { status: e.status, code: e.code });
        }
      });
    });
    return done;
  }

  /**
   * 선택 동기화 오류(7.1절 표) → 처리했으면 true(이번 맞추기에서 상태가 바뀜 — 다시 계획).
   * upload_required: 그 파일만 다음 바퀴에 올림. 형식 · 변환 거절: 같은 파일이면 같은 결과라 다시 하지 않음(파일이 바뀌면 키가 달라져 다시)
   * → 'no_retry'(이유 코드 · 24시간 대기를 적어 둠 — 부르는 쪽은 아무것도 더 하지 않음).
   */
  uploadRejected(a, e) {
    if (!e || e.name !== 'ApiError') return false;
    if (e.status === 409 && e.code === 'upload_required') { this.forceCloud.add(`${P.fold(a.rel)}\n${a.sha256}`); return true; }
    if (e.status === 409 && e.code === 'changed' && a.t === 'promote') { // 서버 표현이 다름 — 내용을 먼저 맞춘 뒤 다음 바퀴에 다시
      if (e.body && e.body.paper) this.S.papers.set(Number(e.body.paper.id), normPaper(e.body.paper));
      return true;
    }
    if (e.status === 409 && ['not_pending', 'not_holder', 'local_only'].includes(e.code)) { this.needFull = true; this.failLater(a.key, 'retrying', a.rel); return true; }
    if (e.status === 400 && ['bad_format', 'convert_failed', 'no_converter', 'bad_pdf'].includes(e.code)) {
      this.failLater(a.key, e.code === 'bad_pdf' ? 'not_pdf' : e.code, a.rel, { base: NO_RETRY_MS, local: a.sha256 || true });
      this.log.info('서버가 파일을 받지 않음', { code: e.code });
      return 'no_retry';
    }
    return false;
  }

  quotaError(e) {
    if (e && e.name === 'ApiError' && e.status === 400 && ['storage_full', 'sync_quota', 'db_full'].includes(e.code)) {
      const reason = e.code === 'storage_full' ? 'storage' : e.code === 'db_full' ? 'db' : 'sync_quota';
      if (!this.uploadBlock) this.emit({ type: 'notify', kind: 'storage_full', reason, always: true });
      this.uploadBlock = { reason, until: this.now() + this.t.quotaRetryMs };
      this.log.warn('올리기 멈춤', { reason });
      return true;
    }
    return false;
  }

  async finishUpload(a, slot, lByKey, problems = []) {
    const l = lByKey.get(P.fold(a.rel));
    const meta = { size: a.size, mtime_ms: a.mtime_ms, ino: (l && l.ino) || '' };
    if (a.t === 'upload_content') {
      // 로컬 항목(보관 = 나): 업로드 자리 없이 해시 · 크기 · 시각만(8.4절) — 서버는 보관 PC 하나라 충돌 없음
      const body = { op_id: this.opId(a.key), base_sha256: a.base, sha256: a.sha256, mtime_ms: a.mtime_ms, clock_offset_ms: this.offset };
      if (a.local) body.size = a.size; else body.upload_id = slot.upload_id;
      const r = await this.api.post(`${API}/files/${a.pid}/content`, body, { timeout: SLOW_MS });
      this.doneOp(a.key);
      if (r.translation_cleared === true) this.note('translation_cleared', P.baseName(a.rel));
      if (r.result === 'conflict') return this.applyConflict(a, r, meta);
      if (r.paper) this.S.papers.set(Number(r.paper.id), normPaper(r.paper));
      else this.S.papers.set(a.pid, { ...this.S.papers.get(a.pid), sha256: a.sha256, size: a.size });
      this.S.trashed.delete(a.pid);
      this.J.files[a.pid] = { rel: a.rel, sha256: a.sha256, ...meta, kind: this.repKind(a.pid) };
      this.firstCount('up');
      return true;
    }
    if (a.t === 'promote') { // 켜기(5.3): 같은 업로드 자리 흐름, 마지막 호출만 files/{id}/promote — 서버가 웹 업로드처럼 처리
      const r = await this.api.post(`${API}/files/${a.pid}/promote`, { op_id: this.opId(a.key), upload_id: slot.upload_id, sha256: a.sha256, size: a.size,
        mtime_ms: a.mtime_ms, clock_offset_ms: this.offset }, { timeout: SLOW_MS });
      this.doneOp(a.key);
      if (r && r.paper) this.S.papers.set(Number(r.paper.id), normPaper(r.paper));
      else this.S.papers.set(a.pid, { ...this.S.papers.get(a.pid), storage: 'cloud', pending: '', holder: null });
      this.J.files[a.pid] = { rel: a.rel, sha256: a.sha256, ...meta, kind: this.repKind(a.pid) };
      this.log.info('서버에도 저장(켜기) 마침', { id: a.pid });
      return true;
    }
    const body = { op_id: this.opId(a.key), sha256: a.sha256, size: a.size, mtime_ms: a.mtime_ms, clock_offset_ms: this.offset, folder_id: a.folderId, file_name: P.nfc(P.baseName(a.rel)) };
    if ((this.proto || 1) >= 2) body.storage = a.t === 'add_local' ? 'local' : 'cloud';
    if (slot) body.upload_id = slot.upload_id;
    const r = await this.api.post(`${API}/files/add`, body, { timeout: SLOW_MS });
    this.doneOp(a.key);
    if (r && r.result === 'local_elsewhere') { // 다른 활성 PC가 보관하는 로컬 항목과 같은 파일(D-9) — 연결하지 않고 문제 목록, 저널에 넣지 않음
      this.failLater(a.key, 'local_elsewhere', a.rel, { base: this.t.retryMaxMs, label: typeof r.holder_name === 'string' ? r.holder_name.slice(0, 100) : '', local: a.sha256 || true });
      return false;
    }
    if (!r || !r.paper) return false;
    if (a.dropPid != null) delete this.J.files[a.dropPid];
    if (a.note) this.note(a.note, P.baseName(a.rel));
    this.acceptPaper(r.paper, a.rel, { sha256: a.sha256, ...meta });
    if (r.result === 'created') this.firstCount('up'); else this.firstCount('link');
    return true;
  }

  /** files/add · 되살리기 응답의 논문을 서버 상태 · 저널에 넣음. 서버 이름이 다르면(K-8) 다음 비교가 PC 이름을 맞춤 */
  acceptPaper(paper, rel, meta) {
    const p = normPaper(paper);
    this.S.papers.set(p.id, p);
    this.S.trashed.delete(p.id);
    this.S.gonePapers.delete(p.id);
    this.J.files[p.id] = { rel, sha256: meta.sha256, size: meta.size, mtime_ms: meta.mtime_ms, ino: meta.ino || '', kind: this.repKind(p.id) };
  }

  /** 저널 kind(8.5): 서버 표현 — 로컬 항목 'local', 원본 'source', 그 밖 'pdf' */
  repKind(pid) {
    const sp = this.S.papers.get(Number(pid));
    if (!sp) return 'pdf';
    return sp.storage === 'local' ? 'local' : sp.kind === 'source' ? 'source' : 'pdf';
  }

  /** 충돌(U-1): winner incoming → 원래 = 우리 내용, 사본 = 옛 서버 내용(받음). winner server → 우리 파일을 사본 이름으로 바꾸고 원래 이름은 받음 */
  applyConflict(a, r, meta) {
    const paper = r.paper && normPaper(r.paper);
    const copy = r.copy && normPaper(r.copy);
    if (paper) this.S.papers.set(paper.id, paper);
    if (copy) this.S.papers.set(copy.id, copy);
    if (r.winner === 'incoming') {
      this.J.files[a.pid] = { rel: a.rel, sha256: a.sha256, ...meta, kind: this.repKind(a.pid) };
    } else if (copy) {
      const dir = P.parentRel(a.rel);
      const to = P.joinRel(dir, copy.file_name);
      const from = P.safeJoin(this.root, a.rel, { file: true });
      const dest = P.safeJoin(this.root, to, { file: true });
      delete this.J.files[a.pid]; // 원래 이름에는 서버 내용을 받음
      if (from && dest && !fs.existsSync(dest)) {
        try { fs.renameSync(from, dest); this.J.files[copy.id] = { rel: to, sha256: a.sha256, ...meta, kind: this.repKind(copy.id) }; } catch { /* 다음 비교가 연결로 처리 */ }
      }
    }
    this.note('conflict', P.baseName(a.rel));
    return true;
  }

  // ---------------------------------------------------------------------- 끄기 확인 · 실패 (선택 동기화 5.3 · 8.4)
  /** mode_ack · mode_fail → ops 묶음(최대 20). applied = 서버가 R2 · 본문을 지우고 로컬 항목이 됨 */
  async modeOps(acts) {
    const list = [];
    for (const a of acts) {
      const key = `mode:${a.t}:${a.pid}`;
      if (this.waiting(key)) continue;
      const op = a.t === 'mode_ack' ? { op_id: this.opId(key), type: 'mode.ack', id: a.pid, sha256: a.sha256 }
        : { op_id: this.opId(key), type: 'mode.fail', id: a.pid, reason: a.reason };
      list.push({ a, key, op });
    }
    if (!list.length) return 0;
    let done = 0;
    for (const { a, key, res } of await this.ops(list)) {
      this.doneOp(key);
      if (a.t === 'mode_fail') {
        if (res.ok !== false) { this.J.modeFails[a.pid] = a.reason; done++; } else this.failLater(key, 'retrying', null);
        continue;
      }
      if (res.ok !== false && res.result === 'applied') {
        const cur = this.S.papers.get(a.pid) || {};
        this.S.papers.set(a.pid, res.paper ? normPaper({ ...cur, ...res.paper }) : { ...cur, storage: 'local', pending: '', holder: this.who.deviceId });
        if (this.J.files[a.pid]) this.J.files[a.pid].kind = 'local';
        delete this.J.modeFails[a.pid];
        this.log.info('PC에만 두기 마침', { id: a.pid });
        done++;
      } else if (res.result === 'changed') { // 그 사이 다른 PC가 내용을 바꿈 — 받기로 맞춘 뒤 다시 확인
        if (res.paper) this.S.papers.set(Number(res.paper.id), normPaper(res.paper));
        done++;
      } else if (res.result === 'not_pending') { this.needFull = true; done++; } else this.failLater(key, 'retrying', null);
    }
    return done;
  }

  // ---------------------------------------------------------------------- 표현 바뀜 (D-8 · 8.3절 swap_rep)
  /**
   * 원본을 새 이름으로 받기(임시 → 해시 확인 → 넣기) → 저널 → 옛 변환본은 Windows 휴지통(대량 검사 대상 아님 — 내용이 새 파일로 대체됨).
   * 넣기 전에 J.swapping 에 옛 파일을 적어 두므로 중간에 죽어도 옛 파일이 새 파일(올리기)로 읽히지 않고, 삭제로도 읽히지 않음(AC-S34).
   */
  async swaps(acts, problems, tick) {
    const todo = [];
    for (const a of acts) {
      const key = `swap:${a.pid}:${a.sha256}`;
      if (this.waiting(key)) continue;
      const to = P.safeJoin(this.root, a.to, { file: true });
      if (!to) { problems.push({ code: 'bad_name_server', rel: a.to }); continue; }
      if (to.length > P.MAX_PATH) { problems.push({ code: 'too_long_down', rel: a.to }); continue; }
      if (!this.isRealDir(path.dirname(to))) continue;
      todo.push({ ...a, key, abs: to, fromAbs: P.safeJoin(this.root, a.from, { file: true }) });
    }
    if (!todo.length) return 0;
    let done = 0;
    const tmpDir = path.join(this.root, P.SYNC_DIR, 'tmp');
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch { return 0; }
    for (const part of chunks(todo, LIMITS.download)) {
      const need = part.filter((a) => !fs.existsSync(a.abs));
      const r = need.length ? await this.api.post(`${API}/download`, { ids: need.map((a) => a.pid) }) : [];
      const all = Array.isArray(r) ? r : (r && (r.items || r.files)) || [];
      const items = new Map(all.filter((x) => x && x.url).map((x) => [Number(x.id), x]));
      for (const a of part) {
        let placed = false;
        if (fs.existsSync(a.abs)) { // 지난번에 넣고 죽었을 수 있음 — 같은 해시면 이어서, 다른 파일이면 덮어쓰지 않음
          let h = null;
          try { h = await scanner.hashFile(a.abs); } catch { h = null; }
          if (!h || h.sha256 !== a.sha256) { this.failLater(a.key, 'retrying', a.to); continue; }
          placed = true;
        }
        if (!placed) {
          const it = items.get(a.pid);
          if (!it) { this.failLater(a.key, 'retrying', a.to); continue; }
          const tmp = path.join(tmpDir, `${this.uuid()}.part`);
          let got;
          try { got = await this.transfer.get(it.url, tmp); } catch (e) {
            removeTemp(this.root, tmp);
            this.failLater(a.key, e.code === 'bad_url' ? 'bad_url' : 'retrying', a.to);
            continue;
          }
          if (got.sha256 !== a.sha256) { removeTemp(this.root, tmp); this.failLater(a.key, 'retrying', a.to, { base: 1000 }); continue; }
          this.J.swapping[P.fold(a.from)] = { rel: a.from, sha256: a.oldSha }; // 넣기 전에 — 디스크 → 저널 순서의 예외(옛 파일 보호)
          this.flushJournal();
          if (fs.existsSync(a.abs)) { delete this.J.swapping[P.fold(a.from)]; removeTemp(this.root, tmp); continue; }
          try { fs.renameSync(tmp, a.abs); } catch (e) {
            delete this.J.swapping[P.fold(a.from)];
            removeTemp(this.root, tmp);
            this.failLater(a.key, e.code === 'EBUSY' || e.code === 'EPERM' ? 'busy' : 'retrying', a.to);
            continue;
          }
        } else this.J.swapping[P.fold(a.from)] = { rel: a.from, sha256: a.oldSha };
        let st;
        try { st = fs.lstatSync(a.abs, { bigint: true }); } catch { continue; }
        this.J.files[a.pid] = { rel: a.to, sha256: a.sha256, size: Number(st.size), mtime_ms: Number(st.mtimeNs / 1000000n), ino: st.ino ? `${st.dev}:${st.ino}` : '', kind: this.repKind(a.pid) };
        this.flushJournal();
        await this.trashSwapped(P.fold(a.from), problems);
        this.okNow(a.key);
        this.note('swap_rep', P.baseName(a.to));
        this.firstCount('down');
        done++;
        tick();
      }
    }
    return done;
  }

  /** J.swapping 의 옛 파일 하나를 휴지통으로(같은 해시일 때만 — 사용자가 고쳤으면 두고 새 파일로 맞춤) */
  async trashSwapped(key, problems) {
    const x = this.J.swapping[key];
    if (!x) return;
    const abs = P.safeJoin(this.root, x.rel, { file: true });
    if (!abs || !fs.existsSync(abs)) { delete this.J.swapping[key]; return; }
    let h = null;
    try { h = await scanner.hashFile(abs); } catch { h = null; }
    if (!h) return; // 쓰는 중 — 다음에
    if (h.sha256 !== x.sha256) { delete this.J.swapping[key]; return; }
    const t = await this.trashFile(abs, x.rel, problems);
    if (t === 'ok' || t === 'archived' || t === 'gone') delete this.J.swapping[key];
  }

  async finishSwapping(problems) {
    for (const key of Object.keys(this.J.swapping || {})) await this.trashSwapped(key, problems);
  }

  // ---------------------------------------------------------------------- 받기 (9.7)
  async downloads(acts, problems, tick) {
    if (!acts.length) return 0;
    const free = this.statfs(this.root);
    let need = 0;
    const todo = [];
    for (const a of acts) {
      const key = `get:${a.pid}:${a.sha256}`;
      if (this.waiting(key)) continue;
      const abs = P.safeJoin(this.root, a.rel, { file: true });
      if (!abs) { problems.push({ code: 'bad_name_server', rel: a.rel }); continue; }
      if (abs.length > P.MAX_PATH) { problems.push({ code: 'too_long_down', rel: a.rel }); continue; }
      if (!this.isRealDir(path.dirname(abs))) continue;
      need += a.size || 0;
      if (free != null && need > free - DISK_SPARE) { problems.push({ code: 'disk_full', rel: a.rel }); continue; }
      todo.push({ ...a, key, abs });
    }
    let done = 0;
    const tmpDir = path.join(this.root, P.SYNC_DIR, 'tmp');
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch { return 0; }
    const replAttrs = await this.trashAttrs(todo.filter((a) => a.replace)); // 바꿀 옛 파일 속성 한 번에
    for (const part of chunks(todo, LIMITS.download)) {
      const r = await this.api.post(`${API}/download`, { ids: part.map((a) => a.pid) });
      const all = Array.isArray(r) ? r : (r && (r.items || r.files)) || [];
      // 404(휴지통 · 없음) — 서버 상태를 다시 받음. local_only(그 사이 PC에만 두기로 바뀜)는 그 파일만 건너뜀 — 다음 피드가 고침(8.4)
      if (all.some((x) => x && !x.url && x.code !== 'local_only')) this.needFull = true;
      const localOnly = new Set(all.filter((x) => x && x.code === 'local_only').map((x) => Number(x.id)));
      const items = new Map(all.filter((x) => x && x.url).map((x) => [Number(x.id), x]));
      await pool(part, LIMITS.get, async (a) => {
        const it = items.get(a.pid);
        if (!it && localOnly.has(a.pid)) return;
        if (!it) { this.failLater(a.key, 'retrying', a.rel); return; }
        const tmp = path.join(tmpDir, `${this.uuid()}.part`);
        let got;
        try { got = await this.transfer.get(it.url, tmp); } catch (e) {
          removeTemp(this.root, tmp);
          this.failLater(a.key, e.code === 'bad_url' ? 'bad_url' : 'retrying', a.rel);
          this.log.warn('받기 실패', { id: a.pid, code: e.code || 'error' });
          return;
        }
        if (got.sha256 !== a.sha256 || (it.sha256 && got.sha256 !== it.sha256)) { // 해시 불일치 → 넣지 않고 다시 받음(AC-667)
          removeTemp(this.root, tmp);
          this.failLater(a.key, 'retrying', a.rel, { base: 1000 });
          this.log.warn('받은 파일 해시 불일치', { id: a.pid });
          return;
        }
        if (a.replace) {
          const old = this.J.files[a.pid];
          if (old && fs.existsSync(a.abs)) {
            const t = await this.trashFile(a.abs, a.rel, problems, replAttrs); // K-18: 옛 파일은 휴지통 먼저
            if (t !== 'ok' && t !== 'archived' && t !== 'gone') { removeTemp(this.root, tmp); return; }
          }
        } else if (fs.existsSync(a.abs)) { removeTemp(this.root, tmp); return; } // 덮어쓰지 않음
        try { fs.renameSync(tmp, a.abs); } catch (e) {
          removeTemp(this.root, tmp);
          this.failLater(a.key, e.code === 'EBUSY' || e.code === 'EPERM' ? 'busy' : 'retrying', a.rel);
          return;
        }
        let st;
        try { st = fs.lstatSync(a.abs, { bigint: true }); } catch { return; }
        this.J.files[a.pid] = { rel: a.rel, sha256: a.sha256, size: Number(st.size), mtime_ms: Number(st.mtimeNs / 1000000n), ino: st.ino ? `${st.dev}:${st.ino}` : '', kind: this.repKind(a.pid) };
        this.okNow(a.key);
        this.firstCount('down');
        done++;
        tick();
      });
    }
    return done;
  }

  // ====================================================================== 알림 · 상태
  note(kind, name) { this.notes.push({ kind, name }); }

  flushNotes() {
    if (!this.notes.length) return;
    const by = new Map();
    for (const n of this.notes) { if (!by.has(n.kind)) by.set(n.kind, []); by.get(n.kind).push(n.name); }
    this.notes = [];
    for (const [kind, names] of by) this.emit({ type: 'notify', kind, n: names.length, names: names.slice(0, 3) });
  }

  flushJournal() {
    if (!this.J || !this.journalFile || this.mode !== 'running') return;
    try { journal.save(this.journalFile, this.J); } catch (e) { this.log.warn('저널 쓰기 실패', { code: e.code }); }
  }

  computeState() {
    if (this.mode === 'off') return 'off';
    if (this.mode === 'probing') return 'scanning';
    if (this.mode === 'preview') return 'preview';
    if (this.flags.revoked || !this.who) return 'revoked';
    if (this.flags.updateRequired) return 'update_required';
    if (this.flags.accountMismatch) return 'account_mismatch';
    if (this.rootIssue) return 'root_missing';
    if (this.held) return 'waiting_confirm';
    if (this.paused) return 'paused';
    if (this.flags.offline) return 'offline';
    if (this.uploadBlock) return 'storage_full';
    if (this.progress && this.progress.total) return 'syncing';
    if (this.busy && this.needFull) return 'scanning';
    return 'idle';
  }

  snapshot() {
    const state = this.computeState();
    const h = this.held;
    const pv = this.preview;
    const confirmFiles = h ? [...h.pids].slice(0, 50).map((pid) => (this.J.files[pid] ? this.J.files[pid].rel : (this.S.papers.get(pid) || {}).file_name || '')) : [];
    return {
      state,
      reason: state === 'storage_full' ? this.uploadBlock.reason : '',
      provisional: this.mode === 'probing' || this.mode === 'preview',
      root: this.root || '',
      rootLabel: P.baseName(this.root || ''),
      previewRoot: (pv && pv.root) || (this.probing && this.probing.root) || '',
      previousRoot: this.previousRoot || '',
      rootIssue: this.rootIssue,
      pickError: this.pickError,
      progress: this.mode === 'probing' && this.probing ? { done: this.probing.done, total: this.probing.total } : this.progress,
      counts: {
        files: this.J ? Object.keys(this.J.files).length : 0, pending_up: this.lastPlan.up || 0, pending_down: this.lastPlan.down || 0,
        waiting_confirm: h ? h.pids.size : 0, problems: this.problems.length, ...this.modeCounts(),
      },
      proto: this.proto || 0,
      lastSyncAt: this.lastSyncAt,
      problems: this.problems.slice(0, LIMITS.problems),
      archiveBytes: this.archiveBytes,
      userCap: this.budget ? this.budget.user_cap_bytes : null,
      confirm: h ? { batch_id: h.batch_id, kind: h.kind, count: h.pids.size, base: h.base, files: confirmFiles, labels: [...h.labels].slice(0, 5) } : null,
      preview: pv ? { root: pv.root, place: pv.place, defaultPlace: pv.defaultPlace, otherDevices: pv.otherDevices, plan: pv.plan, changing: !!this.suspended, oldRoot: this.suspended ? this.root : '' } : null,
      paused: this.paused,
    };
  }

  /** 이 PC 상태 · sync_devices.counts(10.8절): local = 이 PC가 보관하는 로컬 항목, pending_mode = 이 PC가 마쳐야 할 끄기 · 켜기 대기 */
  modeCounts() {
    if ((this.proto || 1) < 2 || !this.who || this.mode !== 'running') return { local: 0, pending_mode: 0 };
    let local = 0;
    let pending = 0;
    for (const sp of this.S.papers.values()) {
      if (sp.holder !== this.who.deviceId) continue;
      if (sp.storage === 'local') local++;
      if (sp.pending) pending++;
    }
    return { local, pending_mode: pending };
  }

  refresh() { this.emit({ type: 'state', ...this.snapshot() }); }

  // ====================================================================== 로컬 파일 다리 (선택 동기화 8.4 · 9.2절 — main 이 물음)
  /**
   * 논문 id → 이 PC 파일 위치(main 이 다시 검사 · 해시 확인 뒤에만 읽음). 경로는 저널(J.rel)에서만 만든다(렌더러는 id만 보냄).
   * → {ok, abs, rel, sha256, size, ext, kind, storage, mine} | {ok: false, code}
   * code: sync_off(꺼짐 · 루트 문제) · unsupported(옛 서버 — v1) · not_local(서재에 없음) · missing(저널 · 파일 없음) · changed(쓰는 중) · path
   */
  resolveLocal(pid) {
    const id = Number(pid);
    if (this.mode !== 'running' || !this.J || !this.root || this.rootIssue || !this.who) return { ok: false, code: 'sync_off' };
    if ((this.proto || 1) < 2) return { ok: false, code: 'unsupported' };
    const sp = this.S.papers.get(id);
    if (!sp) return { ok: false, code: 'not_local' };
    const j = this.J.files[id];
    if (!j) return { ok: false, code: 'missing' };
    const abs = P.safeJoin(this.root, j.rel, { file: true });
    if (!abs) return { ok: false, code: 'path' };
    let st;
    try { st = fs.lstatSync(abs, { bigint: true }); } catch { return { ok: false, code: 'missing' }; }
    if (!st.isFile()) return { ok: false, code: 'path' };
    const ino = st.ino ? `${st.dev}:${st.ino}` : '';
    if (Number(st.size) !== j.size || Number(st.mtimeNs / 1000000n) !== j.mtime_ms || (j.ino && ino !== j.ino)) return { ok: false, code: 'changed' };
    return { ok: true, abs, rel: j.rel, sha256: j.sha256, size: j.size, ext: extOf(j.rel), kind: sp.kind, storage: sp.storage, mine: sp.holder === this.who.deviceId };
  }

  /** 이 PC가 보관하는 로컬 항목만 키로: here(저널 · 파일 있음) | missing (9.1절 localHas — 최대 500개) */
  localHas(ids) {
    const out = {};
    if (this.mode !== 'running' || !this.who || (this.proto || 1) < 2) return out;
    for (const raw of (ids || []).slice(0, 500)) {
      const id = Number(raw);
      const sp = this.S.papers.get(id);
      if (!sp || sp.storage !== 'local' || sp.holder !== this.who.deviceId) continue;
      const j = this.J && this.J.files[id];
      const abs = j && this.root ? P.safeJoin(this.root, j.rel, { file: true }) : null;
      let here = false;
      try { here = !!abs && fs.lstatSync(abs).isFile(); } catch { here = false; }
      out[id] = here ? 'here' : 'missing';
    }
    return out;
  }

  async reportStatus() {
    if (this.mode !== 'running' || !this.who || this.flags.revoked) return;
    const s = this.snapshot();
    const counts = { ...s.counts };
    if (s.state === 'storage_full') counts.reason = s.reason;
    const key = JSON.stringify(counts);
    const now = this.now();
    const last = this.statusSent;
    // 50초에 한 번까지만, 상태가 바뀌면 바로(13장 sync_devices)
    if (last.state === s.state && (key === last.key || now - last.at < this.t.statusMs)) return;
    const body = { state: s.state, counts, root_label: s.rootLabel.slice(0, 60) };
    if (this.fullReported === false) body.full = true; // 전체 다시 맞추기를 마침 → 서버 last_full_at
    this.statusSent = { at: now, key, state: s.state };
    await this.api.post(`${API}/status`, body);
    this.fullReported = true;
  }
}

function sameFile(a, b) {
  try { return fs.realpathSync.native(a) === fs.realpathSync.native(b); } catch { return false; }
}

/**
 * 서버 논문 항목(스냅숏 · 피드 · 응답) → S.papers 모양. 선택 동기화 필드(kind · storage · holder · holder_name · holder_gone · pending)가 없으면(옛 서버 — v1)
 * 지금과 같은 켬 항목으로 본다(8.2절)
 */
function normPaper(p) {
  return {
    id: Number(p.id), folder_id: p.folder_id == null ? null : Number(p.folder_id), file_name: String(p.file_name || ''), sha256: String(p.sha256 || ''), size: Number(p.size) || 0,
    kind: ['pdf', 'source', 'local'].includes(p.kind) ? p.kind : 'pdf',
    storage: p.storage === 'local' ? 'local' : 'cloud',
    holder: p.holder == null || p.holder === '' ? null : Number(p.holder),
    holderGone: p.holder_gone === true || p.holderGone === true,
    // 보관 PC 이름 — D-4 확인 창 · 알림 · 문제 목록의 ‘연구실 PC’(10.9절). 옛 서버 · 없음이면 ''
    holder_name: typeof p.holder_name === 'string' ? p.holder_name.slice(0, 100) : '',
    pending: p.pending === 'to_local' || p.pending === 'to_cloud' ? p.pending : '',
  };
}

function normFolder(f) {
  return { id: Number(f.id), name: String(f.name), parent_id: f.parent_id == null ? null : Number(f.parent_id),
    sync_mode: f.sync_mode === 'cloud' || f.sync_mode === 'local' ? f.sync_mode : 'inherit' };
}

/** 같은 이유 · 경로는 하나만. 뒤엣것에만 이름(label — 보관 PC 등)이 있으면 그 이름을 붙임 */
function dedupeProblems(list) {
  const seen = new Map();
  const out = [];
  for (const p of list) {
    const k = `${p.code}\n${p.rel}`;
    const had = seen.get(k);
    if (!had) { const q = { ...p }; seen.set(k, q); out.push(q); } else if (p.label && !had.label) had.label = p.label;
  }
  return out;
}

function dirSize(dir) {
  let n = 0;
  const walk = (d) => {
    let es;
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile()) { try { n += fs.statSync(p).size; } catch { /* 없음 */ } }
    }
  };
  walk(dir);
  return n;
}

module.exports = { SyncEngine, parseToken, TIMING, MASS, kstDate };
