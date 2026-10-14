'use strict';
// 앱 설정 · 기기 토큰 (명세 12.3): %APPDATA%\PaperLab\settings.json(비밀 아님) + device.bin(safeStorage = Windows DPAPI 암호문).
// 암호화를 쓸 수 없으면 토큰을 파일에 쓰지 않고 메모리에만 둔다(다시 켜면 다시 연결). 토큰 · 서버 주소 · 기기 id 말고 비밀은 없음.
// safeStorage 는 주입(테스트는 가짜) — app ready 뒤에만 isEncryptionAvailable() 이 참.

const fs = require('node:fs');
const path = require('node:path');
const { normalizeSettings } = require('../worker/worker');
const { writeAtomic } = require('../lib/write-atomic');

// 폴더 동기화 설정(명세 15.1 · 7.3 K-33): 루트는 미리보기 [시작]에서만 저장, 그때의 설치 ID 를 함께. 비밀 아님
const SYNC_DEFAULTS = { enabled: false, root: '', installId: '', previousRoot: '', paused: false, notify: true };
function normalizeSync(s = {}) {
  const o = s && typeof s === 'object' ? s : {};
  const str = (v) => (typeof v === 'string' ? v.slice(0, 1024) : '');
  return { enabled: o.enabled === true && !!str(o.root), root: str(o.root), installId: str(o.installId).slice(0, 64), previousRoot: str(o.previousRoot),
    paused: o.paused === true, notify: o.notify !== false };
}

const DEFAULTS = {
  setupDone: false, autoStart: true, notify: true, trayHintShown: false,
  deviceId: null, deviceName: '', accountHint: '', bounds: null,
  worker: normalizeSettings({}),
  sync: { ...SYNC_DEFAULTS },
};

class Store {
  constructor(dir, safeStorage) {
    this.dir = dir;
    this.safe = safeStorage;
    this.file = path.join(dir, 'settings.json');
    this.tokenFile = path.join(dir, 'device.bin');
    this.memToken = null;
    let data = {};
    try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { data = {}; }
    this.data = { ...DEFAULTS, ...(data && typeof data === 'object' ? data : {}) };
    this.data.worker = normalizeSettings(this.data.worker);
    this.data.sync = normalizeSync(this.data.sync);
  }

  get(k) { return this.data[k]; }

  set(patch) {
    Object.assign(this.data, patch);
    if (patch.worker) this.data.worker = normalizeSettings(patch.worker);
    if (patch.sync) this.data.sync = normalizeSync(patch.sync);
    writeAtomic(this.file, JSON.stringify(this.data, null, 2));
  }

  canEncrypt() {
    try { return !!this.safe && this.safe.isEncryptionAvailable(); } catch { return false; }
  }

  readToken() {
    if (this.memToken) return this.memToken;
    if (!this.canEncrypt()) return null;
    try { return this.safe.decryptString(fs.readFileSync(this.tokenFile)); } catch { return null; }
  }

  /** → true(파일에 암호화 저장) | false(메모리에만) */
  saveToken(token) {
    this.clearToken();
    if (!this.canEncrypt()) { this.memToken = token; return false; }
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.tokenFile, this.safe.encryptString(token));
    return true;
  }

  clearToken() {
    this.memToken = null;
    try { fs.rmSync(this.tokenFile, { force: true }); } catch { /* 없음 */ }
  }
}

module.exports = { Store, DEFAULTS, normalizeSync };
