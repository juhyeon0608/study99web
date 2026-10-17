'use strict';
// 시험용 가짜 동기화 서버(메모리) — 명세 14.1 `/api/worker/sync/*` 모양을 흉내 낸다(서버 규칙의 정밀한 판정은 Python [db] 시험 몫).
// 바이트는 같은 출처 /_dev_storage/ 서명 주소로(개발 실행과 같은 모양) — 가짜 fetch 가 메모리 저장소에서 주고받는다.
// 모든 요청은 calls 에 기록(시험이 "서버 요청 0회"를 확인). 웹 동작(옮기기 · 휴지통 · 되살리기 · 폴더 이름 바꾸기)은 web* 함수로.
//
// 선택 동기화 v2(docs/specs/selective-sync.md 7.1절 — 계약 C-1): protocol: 2 로 만들면 start 가 {protocol: 2, exts, device_id} 를 주고
// 스냅숏 · 피드 · lookup 항목이 표현(kind · storage · holder · holder_name · holder_gone · pending · 표현 해시)을, 폴더가 sync_mode 를 준다.
// files/add storage: "local" · 해시 일치 표(linked · adopted · local_elsewhere · restored) · upload_required, 로컬 항목 content(메타데이터만 ·
// 보관 PC만), files/{id}/promote, ops mode.ack · mode.fail, download 의 local_only · 원본(sources/) 서명 주소.
// protocol: 1(기본)은 6단계(0.3.x) 서버 그대로 — 옛 시험 묶음이 v1 모드로 통과하는지 본다(AC-S36). v1Client: true 는 머리글 없는 옛 앱(426 — AC-S71).

const crypto = require('node:crypto');
const { ApiError } = require('../../worker/api-client');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pdf = (text) => Buffer.from(`%PDF-1.4\n${text}\n%%EOF\n`);
const EXTS = ['.pdf', '.doc', '.docx', '.hwp', '.hwpx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.odp', '.ods', '.rtf', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp'];
const extOf = (n) => { const m = /(\.[^.\\/]+)$/.exec(String(n)); return m ? m[1].toLowerCase() : ''; };

class FakeSyncApi {
  constructor({ uid = '11111111-2222-3333-4444-555555555555', deviceId = 7, deviceName = '집 PC', protocol = 1, v1Client = false } = {}) {
    this.uid = uid;
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.protocol = protocol;
    this.v1Client = v1Client;
    this.folders = new Map(); // id → {id, name, parent_id, sync_mode}
    // id → {id, folder_id, file_name, sha256, size, deleted_at, deleted_by_label, gone, kind, storage, holder, pending, mode_error}
    this.papers = new Map();
    this.storage = new Map(); // key → Buffer
    this.log = []; // {rev, kind, id}
    this.rev = 0;
    this.nextId = 100;
    this.ops = new Map(); // op_id → 응답
    this.calls = [];
    this.fail = {}; // path → ApiError 로 실패시킴
    this.budget = { upload_budget_bytes: 10 * 1024 ** 3, upload_budget_limit: 'storage', user_cap_bytes: 2 * 1024 ** 3, trash_bytes: 0 };
    this.db = null;
    this.otherDevices = 0;
    this.winner = 'incoming';
    this.translated = new Set(); // 전체 번역이 있는 논문
    this.devices = new Map([[deviceId, { id: deviceId, name: deviceName, revoked: false }]]);
    this.convertFail = null; // 'convert_failed' | 'no_converter' — 문서 files/add 를 거절
  }

  // ------------------------------------------------------------------ 웹 · 다른 PC 흉내
  bump(kind, id) { this.rev++; this.log.push({ rev: this.rev, kind, id }); }
  folder(name, parentId = null, syncMode = 'inherit') { const id = this.nextId++; this.folders.set(id, { id, name, parent_id: parentId, sync_mode: syncMode }); this.bump('folder', id); return id; }
  add(name, bytes, folderId = null) {
    const id = this.nextId++;
    const isPdf = extOf(name) === '.pdf';
    this.papers.set(id, { id, folder_id: folderId, file_name: name, sha256: sha(bytes), size: bytes.length, deleted_at: null, kind: isPdf ? 'pdf' : 'source', storage: 'cloud', holder: null, pending: '' });
    this.storage.set(isPdf ? `users/${this.uid}/papers/${id}.pdf` : `users/${this.uid}/sources/${id}${extOf(name)}`, Buffer.from(bytes));
    this.bump('paper', id);
    return id;
  }
  /** 다른 PC(holder)가 보관하는 로컬 항목 */
  addLocal(name, bytes, folderId = null, holder = 9) {
    const id = this.nextId++;
    this.papers.set(id, { id, folder_id: folderId, file_name: name, sha256: sha(bytes), size: bytes.length, deleted_at: null, kind: 'local', storage: 'local', holder, pending: '' });
    this.bump('paper', id);
    return id;
  }
  device(id, name) { this.devices.set(id, { id, name, revoked: false }); }
  revoke(id) { const d = this.devices.get(id); if (d) d.revoked = true; for (const p of this.papers.values()) if (p.holder === id) this.bump('paper', p.id); }
  /** 웹 [동기화 끄기/켜기](7.2): 대기만 씀 — 반대 방향 요청은 대기 취소 */
  webMode(id, mode, holder = this.deviceId) {
    const p = this.papers.get(id);
    if (mode === 'local') {
      if (p.storage === 'local' && p.pending === 'to_cloud') p.pending = '';
      else if (p.storage === 'cloud') { p.pending = 'to_local'; p.holder = holder; }
    } else if (mode === 'cloud') {
      if (p.storage === 'cloud' && p.pending === 'to_local') { p.pending = ''; p.holder = null; p.mode_error = ''; } else if (p.storage === 'local') p.pending = 'to_cloud';
    }
    this.bump('paper', id);
  }
  webFolderMode(fid, mode) { this.folders.get(fid).sync_mode = mode; this.bump('folder', fid); }
  /** 웹에서 올린 문서를 원본 표현으로(백필 — D-8): 이름 확장자 · 해시가 원본으로 바뀜 */
  webToSource(id, name, bytes) {
    const p = this.papers.get(id);
    p.file_name = name; p.sha256 = sha(bytes); p.size = bytes.length; p.kind = 'source';
    this.storage.set(`users/${this.uid}/sources/${id}${extOf(name)}`, Buffer.from(bytes));
    this.bump('paper', id);
  }
  webMove(id, folderId, name) { const p = this.papers.get(id); p.folder_id = folderId; if (name) p.file_name = name; this.bump('paper', id); }
  webTrash(id, label = '웹') { const p = this.papers.get(id); p.deleted_at = new Date().toISOString(); p.deleted_by_label = label; this.bump('paper', id); }
  webRestore(id) { const p = this.papers.get(id); p.deleted_at = null; this.bump('paper', id); }
  webReplace(id, bytes) { const p = this.papers.get(id); p.sha256 = sha(bytes); p.size = bytes.length; this.storage.set(this.objectKey(p), Buffer.from(bytes)); this.bump('paper', id); }
  webRenameFolder(id, name) { this.folders.get(id).name = name; this.bump('folder', id); }
  webDeleteFolder(id) {
    const f = this.folders.get(id);
    for (const p of this.papers.values()) if (p.folder_id === id) { p.folder_id = f.parent_id; this.bump('paper', p.id); }
    this.folders.delete(id);
    this.bump('folder', id);
  }
  live() { return [...this.papers.values()].filter((p) => !p.deleted_at && !p.gone); }
  count(path) { return this.calls.filter((c) => c.path === path).length; }
  opCount(type) { return this.calls.filter((c) => c.path.endsWith('/ops')).reduce((n, c) => n + c.body.ops.filter((o) => o.type === type).length, 0); }
  objectKey(p) { return p.kind === 'source' ? `users/${this.uid}/sources/${p.id}${extOf(p.file_name)}` : `users/${this.uid}/papers/${p.id}.pdf`; }
  /** 서버 _REP_COLS 와 같음: (로컬 항목 또는 바꾸기 대기)이고 보관 PC가 없거나 해지됨 */
  holderGone(p) { const d = p.holder == null ? null : this.devices.get(p.holder); return (p.storage === 'local' || !!p.pending) && (!d || d.revoked); }
  effective(folderId) {
    const seen = new Set();
    for (let f = this.folders.get(folderId); f && !seen.has(f.id); f = this.folders.get(f.parent_id)) {
      seen.add(f.id);
      if (f.sync_mode === 'cloud' || f.sync_mode === 'local') return f.sync_mode;
    }
    return 'cloud';
  }

  // ------------------------------------------------------------------ 서버
  folderJson(f) { return this.protocol >= 2 ? { id: f.id, name: f.name, parent_id: f.parent_id, sync_mode: f.sync_mode || 'inherit' } : { id: f.id, name: f.name, parent_id: f.parent_id }; }
  paperJson(p) {
    const base = { id: p.id, folder_id: p.folder_id, file_name: p.file_name, sha256: p.sha256, size: p.size };
    if (this.protocol < 2) return base;
    return { ...base, kind: p.storage === 'local' ? 'local' : p.kind || 'pdf', storage: p.storage || 'cloud', holder: p.holder == null ? null : p.holder,
      holder_name: p.holder == null ? '' : (this.devices.get(p.holder) || {}).name || '', // 서버 sync.py _paper_item과 같음(D-4 · 10.9절)
      holder_gone: this.holderGone(p), pending: p.pending || '' };
  }
  /** v1 서버(6단계)는 PDF 표현만 동기화 대상 — 로컬 항목 · 원본 표현은 피드에서 "PDF 없음"(지움) */
  synced(p) { return this.protocol >= 2 || ((p.storage || 'cloud') === 'cloud' && (p.kind || 'pdf') === 'pdf'); }
  nameTaken(folderId, name, except) {
    return [...this.papers.values()].some((p) => p.id !== except && !p.deleted_at && !p.gone && p.folder_id === folderId && p.file_name.toLowerCase() === name.toLowerCase());
  }
  copyName(folderId, name, except) {
    if (!this.nameTaken(folderId, name, except)) return name;
    const ext = extOf(name) || '.pdf';
    const stem = name.slice(0, name.length - ext.length);
    for (let i = 1; ; i++) {
      const n = `${stem} (충돌 사본 ${this.deviceName} 2026-10-13${i > 1 ? ` ${i}` : ''})${ext}`;
      if (!this.nameTaken(folderId, n, except)) return n;
    }
  }

  async post(path, body) {
    this.calls.push({ path, body: JSON.parse(JSON.stringify(body || {})) });
    if (this.v1Client && this.protocol >= 2) throw new ApiError(426, { code: 'update_required', min_app_version: '0.4.0', min_sync_protocol: 2 });
    if (this.fail[path]) { const f = this.fail[path]; if (f.once) delete this.fail[path]; throw new ApiError(f.status, { code: f.code, ...(f.body || {}) }, !!f.network); }
    const p = path.replace('/api/worker/sync', '');
    if (body && body.op_id && this.ops.has(body.op_id)) return this.ops.get(body.op_id);
    const remember = (r) => { if (body && body.op_id) this.ops.set(body.op_id, r); return r; };
    if (p === '/start') {
      const r = { server_time: new Date().toISOString(), poll: { idle_s: 60, active_s: 10 }, limits: { max_ops: 20, max_file_bytes: 100 * 1024 * 1024 } };
      return this.protocol >= 2 ? { ...r, protocol: 2, exts: EXTS, device_id: this.deviceId } : r;
    }
    if (p === '/status') return { ok: true };
    if (p === '/snapshot') {
      const live = this.live().filter((x) => this.synced(x));
      return {
        cursor: String(this.rev), ...this.budget, db: this.db, other_sync_devices: this.otherDevices,
        folders: [...this.folders.values()].map((f) => this.folderJson(f)), papers: live.map((x) => this.paperJson(x)),
        trashed: [...this.papers.values()].filter((x) => x.deleted_at && !x.gone && this.synced(x)).map((x) => ({ id: x.id, sha256: x.sha256, deleted_at: x.deleted_at })),
        tombstones: [...this.papers.values()].filter((x) => x.gone).map((x) => ({ kind: 'paper', id: x.id })), more: false, next: null,
      };
    }
    if (p === '/changes') {
      const since = Number(body.cursor) || 0;
      const seen = new Map();
      for (const e of this.log) if (e.rev > since) seen.set(`${e.kind}:${e.id}`, e);
      const changes = [...seen.values()].sort((a, b) => a.rev - b.rev).map((e) => {
        if (e.kind === 'folder') { const f = this.folders.get(e.id); return f ? { kind: 'folder', id: e.id, op: 'upsert', data: this.folderJson(f) } : { kind: 'folder', id: e.id, op: 'delete', data: {} }; }
        const x = this.papers.get(e.id);
        if (!x || x.gone) return { kind: 'paper', id: e.id, op: 'delete', data: {} };
        if (x.deleted_at) return { kind: 'paper', id: e.id, op: 'trash', data: { sha256: x.sha256, deleted_by_label: x.deleted_by_label || '' } };
        if (!this.synced(x)) return { kind: 'paper', id: e.id, op: 'upsert', data: { id: x.id, folder_id: x.folder_id, file_name: x.file_name, sha256: '' } }; // v1: PDF 없음
        return { kind: 'paper', id: e.id, op: 'upsert', data: this.paperJson(x) };
      });
      return { changes, cursor: String(this.rev), more: false, next_poll_s: 10 };
    }
    if (p === '/upload-slots') {
      if (this.quota) throw new ApiError(400, { code: this.quota });
      return { slots: body.files.map(() => { const id = crypto.randomUUID(); return { upload_id: id, upload: { method: 'PUT', url: `/_dev_storage/incoming/${this.uid}/${id}.pdf?X-Amz-Signature=x`, headers: { 'Content-Type': 'application/pdf' } } }; }) };
    }
    if (p === '/files/add') return this.addFile(body, remember);
    let m = p.match(/^\/files\/(\d+)\/content$/);
    if (m) return this.content(Number(m[1]), body, remember);
    m = p.match(/^\/files\/(\d+)\/promote$/);
    if (m) return this.promote(Number(m[1]), body, remember);
    if (p === '/download') {
      return body.ids.filter((id) => { const x = this.papers.get(id); return x && !x.deleted_at && !x.gone; }).map((id) => {
        const x = this.papers.get(id);
        if (x.storage === 'local') return { id, status: 409, code: 'local_only' };
        return { id, url: `/_dev_storage/${this.objectKey(x)}?X-Amz-Signature=x`, sha256: x.sha256, size: x.size, ...(this.protocol >= 2 ? { kind: x.kind || 'pdf' } : {}) };
      });
    }
    if (p === '/ops') return { results: body.ops.map((o) => (this.ops.has(o.op_id) ? this.ops.get(o.op_id) : (this.ops.set(o.op_id, { op_id: o.op_id, ...this.op(o) }), this.ops.get(o.op_id)))) };
    if (p === '/device-check') return { status: 'self' };
    throw new ApiError(404, { code: 'not_found' });
  }

  addFile(body, remember) {
    if (this.quota && body.storage !== 'local') throw new ApiError(400, { code: this.quota });
    if (body.storage === 'local' && body.upload_id) throw new ApiError(400, { code: 'bad_request' });
    const hit = this.live().find((x) => x.sha256 === body.sha256 && this.synced(x));
    if (hit) {
      if (hit.storage === 'local' && hit.holder !== this.deviceId) {
        if (!this.holderGone(hit)) return { result: 'local_elsewhere', paper: this.paperJson(hit), holder_name: (this.devices.get(hit.holder) || {}).name || '' }; // 멱등 기록 안 함
        hit.holder = this.deviceId; hit.folder_id = body.folder_id; hit.file_name = this.copyName(body.folder_id, body.file_name, hit.id); this.bump('paper', hit.id);
        return remember({ result: 'adopted', paper: this.paperJson(hit) });
      }
      return remember({ result: 'linked', paper: this.paperJson(hit) });
    }
    const tr = [...this.papers.values()].find((x) => x.deleted_at && !x.gone && x.sha256 === body.sha256);
    if (tr) {
      tr.deleted_at = null; tr.folder_id = body.folder_id; tr.file_name = this.copyName(body.folder_id, body.file_name, tr.id);
      if (tr.storage === 'local') tr.holder = this.deviceId;
      this.bump('paper', tr.id);
      return remember({ result: 'restored', paper: this.paperJson(tr) });
    }
    const eff = this.effective(body.folder_id);
    if (body.storage === 'local') {
      if (eff === 'cloud') throw new ApiError(409, { code: 'upload_required', paper_folder_mode: 'cloud' });
      return remember(this.createLocal(body));
    }
    const key = `incoming/${this.uid}/${body.upload_id}.pdf`;
    const data = this.storage.get(key);
    if (!data) throw new ApiError(404, { code: 'not_found' });
    if (sha(data) !== body.sha256) throw new ApiError(400, { code: 'sha_mismatch' });
    if (this.protocol >= 2 && eff === 'local') { this.storage.delete(key); return remember(this.createLocal(body)); } // 끔 폴더 → 로컬 항목(임시 파일 지움)
    const isPdf = extOf(body.file_name) === '.pdf';
    if (!isPdf && this.convertFail) throw new ApiError(400, { code: this.convertFail });
    const id = this.nextId++;
    this.papers.set(id, { id, folder_id: body.folder_id, file_name: this.copyName(body.folder_id, body.file_name), sha256: body.sha256, size: data.length, deleted_at: null,
      kind: isPdf ? 'pdf' : 'source', storage: 'cloud', holder: null, pending: '' });
    this.storage.set(this.objectKey(this.papers.get(id)), data);
    this.storage.delete(key);
    this.bump('paper', id);
    return remember({ result: 'created', paper: this.paperJson(this.papers.get(id)) });
  }

  createLocal(body) {
    const id = this.nextId++;
    this.papers.set(id, { id, folder_id: body.folder_id, file_name: this.copyName(body.folder_id, body.file_name), sha256: body.sha256, size: body.size, deleted_at: null,
      kind: 'local', storage: 'local', holder: this.deviceId, pending: '' });
    this.bump('paper', id);
    return { result: 'created', paper: this.paperJson(this.papers.get(id)) };
  }

  content(id, body, remember) {
    const x = this.papers.get(id);
    if (!x || x.gone) throw new ApiError(404, { code: 'not_found' });
    if (x.storage === 'local') { // 메타데이터만 · 보관 PC만(충돌 없음)
      if (x.holder !== this.deviceId) throw new ApiError(409, { code: 'not_holder' });
      if (body.upload_id) throw new ApiError(400, { code: 'bad_request' });
      x.sha256 = body.sha256; x.size = body.size; this.bump('paper', x.id);
      return remember({ result: 'replaced', paper: this.paperJson(x) });
    }
    const data = this.storage.get(`incoming/${this.uid}/${body.upload_id}.pdf`);
    if (!data || sha(data) !== body.sha256) throw new ApiError(400, { code: 'sha_mismatch' });
    const cleared = this.translated.delete(x.id);
    const replace = () => { x.sha256 = body.sha256; x.size = data.length; this.storage.set(this.objectKey(x), data); this.bump('paper', x.id); };
    if (x.deleted_at) { x.deleted_at = null; replace(); return remember({ result: 'restored', paper: this.paperJson(x), translation_cleared: cleared }); }
    if (x.sha256 === body.base_sha256) { replace(); return remember({ result: 'replaced', paper: this.paperJson(x), translation_cleared: cleared }); }
    const nid = this.nextId++;
    const kind = x.kind || 'pdf';
    if (this.winner === 'incoming') { // 옛 서버 내용 → 사본, 원래 = 들어온 내용
      this.papers.set(nid, { id: nid, folder_id: x.folder_id, file_name: this.copyName(x.folder_id, x.file_name), sha256: x.sha256, size: x.size, deleted_at: null, kind, storage: 'cloud', holder: null, pending: '' });
      this.storage.set(this.objectKey(this.papers.get(nid)), this.storage.get(this.objectKey(x)));
      this.bump('paper', nid);
      replace();
    } else {
      this.papers.set(nid, { id: nid, folder_id: x.folder_id, file_name: this.copyName(x.folder_id, x.file_name), sha256: body.sha256, size: data.length, deleted_at: null, kind, storage: 'cloud', holder: null, pending: '' });
      this.storage.set(this.objectKey(this.papers.get(nid)), data);
      this.bump('paper', nid);
    }
    return remember({ result: 'conflict', winner: this.winner, paper: this.paperJson(x), copy: this.paperJson(this.papers.get(nid)), translation_cleared: false });
  }

  promote(id, body, remember) {
    const x = this.papers.get(id);
    // 서버 promote.check() 순서: 없음 · 휴지통 · 로컬 아님 · 켜기 대기 아님 → not_pending, 보관 PC 아님 → not_holder, 해시 다름 → changed
    if (!x || x.gone || x.deleted_at || x.storage !== 'local' || x.pending !== 'to_cloud') throw new ApiError(409, { code: 'not_pending' });
    if (x.holder !== this.deviceId) throw new ApiError(409, { code: 'not_holder' });
    if (body.sha256 !== x.sha256) throw new ApiError(409, { code: 'changed', paper: this.paperJson(x) });
    const key = `incoming/${this.uid}/${body.upload_id}.pdf`;
    const data = this.storage.get(key);
    if (!data || sha(data) !== body.sha256) throw new ApiError(400, { code: 'sha_mismatch' });
    x.storage = 'cloud'; x.holder = null; x.pending = ''; x.kind = extOf(x.file_name) === '.pdf' ? 'pdf' : 'source';
    this.storage.set(this.objectKey(x), data);
    this.storage.delete(key);
    this.bump('paper', x.id);
    return remember({ result: 'promoted', paper: this.paperJson(x) });
  }

  op(o) {
    if (o.type === 'folder.create') {
      const same = [...this.folders.values()].find((f) => f.parent_id === o.parent_id && f.name.toLowerCase() === o.name.toLowerCase());
      if (same) return { ok: true, result: 'linked', folder: this.folderJson(same) };
      return { ok: true, result: 'created', folder: this.folderJson(this.folders.get(this.folder(o.name, o.parent_id))) };
    }
    if (o.type === 'folder.update') {
      const f = this.folders.get(o.id);
      if (!f) return { ok: false, code: 'not_found' };
      if (o.name !== undefined) f.name = o.name;
      if (o.parent_id !== undefined) f.parent_id = o.parent_id;
      this.bump('folder', f.id);
      return { ok: true, result: 'applied', folder: this.folderJson(f) };
    }
    if (o.type === 'folder.delete') {
      if (this.live().some((p) => p.folder_id === o.id) || [...this.folders.values()].some((f) => f.parent_id === o.id)) return { ok: true, result: 'not_empty' };
      this.folders.delete(o.id); this.bump('folder', o.id);
      return { ok: true, result: 'deleted' };
    }
    if (o.type === 'file.move') {
      const x = this.papers.get(o.id);
      if (!x || x.deleted_at || x.gone) return { ok: false, result: 'gone' };
      // 서버 op_file_move: 확장자(PC 표현)를 바꾸는 이동은 받지 않음 — SyncError(400, bad_name)
      if (this.protocol >= 2 && x.file_name && extOf(o.file_name).toLowerCase() !== extOf(x.file_name).toLowerCase()) return { ok: false, result: 'error', code: 'bad_name' };
      x.folder_id = o.folder_id; x.file_name = this.copyName(o.folder_id, o.file_name, x.id); this.bump('paper', x.id);
      return { ok: true, result: 'applied', paper: this.paperJson(x) };
    }
    if (o.type === 'file.delete') {
      const x = this.papers.get(o.id);
      if (!x || x.gone) return { ok: false, result: 'gone' };
      if (x.deleted_at) return { ok: true, result: 'trashed' };
      // 서버 op_file_delete: 로컬 항목은 보관 PC의 파일 — 다른 PC의 옛 사본이 지워져도 서재 항목은 휴지통에 넣지 않음(D-4)
      if (x.storage === 'local' && x.holder !== this.deviceId) return { ok: false, result: 'not_holder' };
      if (x.sha256 !== o.base_sha256) return { ok: false, result: 'changed', paper: this.paperJson(x) };
      x.deleted_at = new Date().toISOString(); x.deleted_by_label = this.deviceName; this.bump('paper', x.id);
      return { ok: true, result: 'trashed' };
    }
    if (o.type === 'mode.ack') { // 끄기 실행(5.3): 보관 PC = 이 기기 · to_local 대기 · 해시 일치 → R2 객체 지움 · 로컬 항목
      const x = this.papers.get(o.id);
      if (!x || x.gone || x.deleted_at || x.pending !== 'to_local' || x.holder !== this.deviceId) return { ok: false, result: 'not_pending' };
      if (o.sha256 !== x.sha256) return { ok: false, result: 'changed', paper: this.paperJson(x) };
      this.storage.delete(this.objectKey(x));
      x.storage = 'local'; x.pending = ''; x.kind = 'local'; x.mode_error = '';
      this.bump('paper', x.id);
      return { ok: true, result: 'applied', paper: this.paperJson(x) };
    }
    if (o.type === 'mode.fail') {
      const x = this.papers.get(o.id);
      if (!x || x.gone || x.deleted_at || x.pending !== 'to_local' || x.holder !== this.deviceId) return { ok: false, result: 'not_pending' };
      x.mode_error = o.reason;
      return { ok: true, result: 'recorded' };
    }
    return { ok: false, code: 'bad_op' };
  }
}

/** 가짜 저장소 fetch: /_dev_storage/<키> 로 PUT · GET (서명 검사 없음). urls 에 요청 주소를 기록 */
function fakeStorageFetch(api, { urls = [] } = {}) {
  return async (url, opts) => {
    urls.push({ method: opts.method, url });
    const u = new URL(url);
    const key = decodeURIComponent(u.pathname.replace(/^\/_dev_storage\//, ''));
    if (opts.method === 'PUT') { api.storage.set(key, Buffer.from(opts.body)); return { status: 200 }; }
    const data = api.corrupt && api.corrupt.has(key) ? Buffer.from('%PDF-broken') : api.storage.get(key);
    if (!data) return { status: 404, body: null };
    return { status: 200, body: [data] };
  };
}

module.exports = { FakeSyncApi, fakeStorageFetch, sha, pdf, EXTS };
