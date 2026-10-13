'use strict';
// 시험용 가짜 동기화 서버(메모리) — 명세 14.1 `/api/worker/sync/*` 모양을 흉내 낸다(서버 규칙의 정밀한 판정은 Python [db] 시험 몫).
// 바이트는 같은 출처 /_dev_storage/ 서명 주소로(개발 실행과 같은 모양) — 가짜 fetch 가 메모리 저장소에서 주고받는다.
// 모든 요청은 calls 에 기록(시험이 "서버 요청 0회"를 확인). 웹 동작(옮기기 · 휴지통 · 되살리기 · 폴더 이름 바꾸기)은 web* 함수로.

const crypto = require('node:crypto');
const { ApiError } = require('../../worker/api-client');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pdf = (text) => Buffer.from(`%PDF-1.4\n${text}\n%%EOF\n`);

class FakeSyncApi {
  constructor({ uid = '11111111-2222-3333-4444-555555555555', deviceId = 7, deviceName = '집 PC' } = {}) {
    this.uid = uid;
    this.deviceId = deviceId;
    this.deviceName = deviceName;
    this.folders = new Map(); // id → {id, name, parent_id, deleted}
    this.papers = new Map(); // id → {id, folder_id, file_name, sha256, size, deleted_at, deleted_by_label, gone}
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
  }

  // ------------------------------------------------------------------ 웹 · 다른 PC 흉내
  bump(kind, id) { this.rev++; this.log.push({ rev: this.rev, kind, id }); }
  folder(name, parentId = null) { const id = this.nextId++; this.folders.set(id, { id, name, parent_id: parentId }); this.bump('folder', id); return id; }
  add(name, bytes, folderId = null) {
    const id = this.nextId++;
    this.papers.set(id, { id, folder_id: folderId, file_name: name, sha256: sha(bytes), size: bytes.length, deleted_at: null });
    this.storage.set(`users/${this.uid}/papers/${id}.pdf`, Buffer.from(bytes));
    this.bump('paper', id);
    return id;
  }
  webMove(id, folderId, name) { const p = this.papers.get(id); p.folder_id = folderId; if (name) p.file_name = name; this.bump('paper', id); }
  webTrash(id, label = '웹') { const p = this.papers.get(id); p.deleted_at = new Date().toISOString(); p.deleted_by_label = label; this.bump('paper', id); }
  webRestore(id) { const p = this.papers.get(id); p.deleted_at = null; this.bump('paper', id); }
  webReplace(id, bytes) { const p = this.papers.get(id); p.sha256 = sha(bytes); p.size = bytes.length; this.storage.set(`users/${this.uid}/papers/${id}.pdf`, Buffer.from(bytes)); this.bump('paper', id); }
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

  // ------------------------------------------------------------------ 서버
  folderJson(f) { return { id: f.id, name: f.name, parent_id: f.parent_id }; }
  paperJson(p) { return { id: p.id, folder_id: p.folder_id, file_name: p.file_name, sha256: p.sha256, size: p.size }; }
  nameTaken(folderId, name, except) {
    return [...this.papers.values()].some((p) => p.id !== except && !p.deleted_at && !p.gone && p.folder_id === folderId && p.file_name.toLowerCase() === name.toLowerCase());
  }
  copyName(folderId, name, except) {
    if (!this.nameTaken(folderId, name, except)) return name;
    const stem = name.replace(/\.pdf$/i, '');
    for (let i = 1; ; i++) {
      const n = `${stem} (충돌 사본 ${this.deviceName} 2026-10-13${i > 1 ? ` ${i}` : ''}).pdf`;
      if (!this.nameTaken(folderId, n, except)) return n;
    }
  }

  async post(path, body) {
    this.calls.push({ path, body: JSON.parse(JSON.stringify(body || {})) });
    if (this.fail[path]) { const f = this.fail[path]; if (f.once) delete this.fail[path]; throw new ApiError(f.status, { code: f.code }, !!f.network); }
    const p = path.replace('/api/worker/sync', '');
    if (body && body.op_id && this.ops.has(body.op_id)) return this.ops.get(body.op_id);
    const remember = (r) => { if (body && body.op_id) this.ops.set(body.op_id, r); return r; };
    if (p === '/start') return { server_time: new Date().toISOString(), poll: { idle_s: 60, active_s: 10 }, limits: { max_ops: 20 } };
    if (p === '/status') return { ok: true };
    if (p === '/snapshot') {
      const live = this.live();
      return {
        cursor: String(this.rev), ...this.budget, db: this.db, other_sync_devices: this.otherDevices,
        folders: [...this.folders.values()].map((f) => this.folderJson(f)), papers: live.map((x) => this.paperJson(x)),
        trashed: [...this.papers.values()].filter((x) => x.deleted_at && !x.gone).map((x) => ({ id: x.id, sha256: x.sha256, deleted_at: x.deleted_at })),
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
        return { kind: 'paper', id: e.id, op: 'upsert', data: this.paperJson(x) };
      });
      return { changes, cursor: String(this.rev), more: false, next_poll_s: 10 };
    }
    if (p === '/upload-slots') {
      if (this.quota) throw new ApiError(400, { code: this.quota });
      return { slots: body.files.map(() => { const id = crypto.randomUUID(); return { upload_id: id, upload: { method: 'PUT', url: `/_dev_storage/incoming/${this.uid}/${id}.pdf?X-Amz-Signature=x`, headers: { 'Content-Type': 'application/pdf' } } }; }) };
    }
    if (p === '/files/add') {
      if (this.quota) throw new ApiError(400, { code: this.quota });
      const hit = this.live().find((x) => x.sha256 === body.sha256);
      if (hit) return remember({ result: 'linked', paper: this.paperJson(hit) });
      const tr = [...this.papers.values()].find((x) => x.deleted_at && !x.gone && x.sha256 === body.sha256);
      if (tr) {
        tr.deleted_at = null; tr.folder_id = body.folder_id; tr.file_name = this.copyName(body.folder_id, body.file_name, tr.id); this.bump('paper', tr.id);
        return remember({ result: 'restored', paper: this.paperJson(tr) });
      }
      const key = `incoming/${this.uid}/${body.upload_id}.pdf`;
      const data = this.storage.get(key);
      if (!data) throw new ApiError(404, { code: 'not_found' });
      if (sha(data) !== body.sha256) throw new ApiError(400, { code: 'sha_mismatch' });
      const id = this.nextId++;
      this.papers.set(id, { id, folder_id: body.folder_id, file_name: this.copyName(body.folder_id, body.file_name), sha256: body.sha256, size: data.length, deleted_at: null });
      this.storage.set(`users/${this.uid}/papers/${id}.pdf`, data);
      this.storage.delete(key);
      this.bump('paper', id);
      return remember({ result: 'created', paper: this.paperJson(this.papers.get(id)) });
    }
    const m = p.match(/^\/files\/(\d+)\/content$/);
    if (m) {
      const x = this.papers.get(Number(m[1]));
      if (!x || x.gone) throw new ApiError(404, { code: 'not_found' });
      const data = this.storage.get(`incoming/${this.uid}/${body.upload_id}.pdf`);
      if (!data || sha(data) !== body.sha256) throw new ApiError(400, { code: 'sha_mismatch' });
      const cleared = this.translated.delete(x.id);
      const replace = () => { x.sha256 = body.sha256; x.size = data.length; this.storage.set(`users/${this.uid}/papers/${x.id}.pdf`, data); this.bump('paper', x.id); };
      if (x.deleted_at) { x.deleted_at = null; replace(); return remember({ result: 'restored', paper: this.paperJson(x), translation_cleared: cleared }); }
      if (x.sha256 === body.base_sha256) { replace(); return remember({ result: 'replaced', paper: this.paperJson(x), translation_cleared: cleared }); }
      const id = this.nextId++;
      if (this.winner === 'incoming') { // 옛 서버 내용 → 사본, 원래 = 들어온 내용
        this.papers.set(id, { id, folder_id: x.folder_id, file_name: this.copyName(x.folder_id, x.file_name), sha256: x.sha256, size: x.size, deleted_at: null });
        this.storage.set(`users/${this.uid}/papers/${id}.pdf`, this.storage.get(`users/${this.uid}/papers/${x.id}.pdf`));
        this.bump('paper', id);
        replace();
      } else {
        this.papers.set(id, { id, folder_id: x.folder_id, file_name: this.copyName(x.folder_id, x.file_name), sha256: body.sha256, size: data.length, deleted_at: null });
        this.storage.set(`users/${this.uid}/papers/${id}.pdf`, data);
        this.bump('paper', id);
      }
      return remember({ result: 'conflict', winner: this.winner, paper: this.paperJson(x), copy: this.paperJson(this.papers.get(id)), translation_cleared: false });
    }
    if (p === '/download') {
      return body.ids.filter((id) => { const x = this.papers.get(id); return x && !x.deleted_at && !x.gone; }).map((id) => {
        const x = this.papers.get(id);
        return { id, url: `/_dev_storage/users/${this.uid}/papers/${id}.pdf?X-Amz-Signature=x`, sha256: x.sha256, size: x.size };
      });
    }
    if (p === '/ops') return { results: body.ops.map((o) => (this.ops.has(o.op_id) ? this.ops.get(o.op_id) : (this.ops.set(o.op_id, { op_id: o.op_id, ...this.op(o) }), this.ops.get(o.op_id)))) };
    if (p === '/device-check') return { status: 'self' };
    throw new ApiError(404, { code: 'not_found' });
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
      if (!x || x.deleted_at || x.gone) return { ok: true, result: 'gone' };
      x.folder_id = o.folder_id; x.file_name = this.copyName(o.folder_id, o.file_name, x.id); this.bump('paper', x.id);
      return { ok: true, result: 'applied', paper: this.paperJson(x) };
    }
    if (o.type === 'file.delete') {
      const x = this.papers.get(o.id);
      if (!x || x.gone) return { ok: true, result: 'gone' };
      if (x.deleted_at) return { ok: true, result: 'trashed' };
      if (x.sha256 !== o.base_sha256) return { ok: true, result: 'changed' };
      x.deleted_at = new Date().toISOString(); x.deleted_by_label = this.deviceName; this.bump('paper', x.id);
      return { ok: true, result: 'trashed' };
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

module.exports = { FakeSyncApi, fakeStorageFetch, sha, pdf };
