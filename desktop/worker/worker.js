'use strict';
// PC 워커 (명세 4 · 6 · 8 · 10 · 11장): hello → claim(적응형 폴링) → 실행 → heartbeat(30초 묶음) → result, 끝낼 때 bye.
// - 426 update_required: claim 을 멈추고 상태 update_required (30분마다 hello 로 다시 확인).
// - 401 device_revoked · device_auth_required: 실행 중 프로세스를 끄고 토큰을 버림(main 이 device.bin 삭제).
// - 연결 안 됨 · 5xx: 백오프 5초 → 최대 5분 (13.6).
// - heartbeat 응답 ok:false = 리스 잃음 → 끄고 결과를 올리지 않음, cancel:true → 끄고 cancelled 보고 (6.3 · 6.5).
// 전기 · 시계 · 실행기 · 탐지는 주입 — 테스트는 가짜 서버 + 가짜 CLI.

const { ENGINES, DEFAULT_SLOTS, DEFAULT_TOTAL } = require('./engines');
const { redact } = require('../lib/redact');
const { nullLogger } = require('../lib/log');

const PROTOCOL = 1;
const HELLO_EVERY_MS = 30 * 60 * 1000; // 8.3
const PROBE_EVERY_MS = 30 * 60 * 1000; // 11.7
const IDLE_S = 60;
const BACKOFF_MAX_S = 300;
const RELOCATE = new Set(['cli_not_found', 'cli_not_logged_in']);
const clampInt = (v, lo, hi, d) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function normalizeSettings(s = {}) {
  const engines = {};
  for (const n of ENGINES) {
    const e = (s.engines && s.engines[n]) || {};
    engines[n] = { enabled: e.enabled !== false, slots: clampInt(e.slots, 1, 4, DEFAULT_SLOTS[n]), path: typeof e.path === 'string' ? e.path : '' };
  }
  return { engines, totalSlots: clampInt(s.totalSlots, 1, 4, DEFAULT_TOTAL), paused: s.paused === true };
}

class Worker {
  constructor(o) {
    this.api = o.api;
    this.runTask = o.runTask;
    this.probe = o.probe;
    this.noDetect = o.noDetect === true; // PAPERLAB_NO_DETECT=1 (개발 · 시험): CLI 를 찾지도 실행하지도 않음
    this.log = o.log || nullLogger;
    this.emit = o.emit || (() => {});
    this.appVersion = o.appVersion || '0.0.0';
    this.osName = o.os || '';
    this.workRoot = o.workRoot;
    this.env = o.env;
    this.now = o.now || Date.now;
    this.pollTimers = o.pollTimers || { setTimeout, clearTimeout };
    this.settings = normalizeSettings(o.settings);
    this.token = o.token || null;
    this.running = new Map();
    this.probed = {};
    this.lastProbe = -Infinity;
    this.lastHello = -Infinity;
    this.needHello = true;
    this.needProbe = true;
    this.updateRequired = false;
    this.offline = false;
    this.revoked = false;
    this.lastError = '';
    this.backoff = 0;
    this.stopped = false;
    this.wake = null;
    this.woken = false;
    this.lastWaitMs = null;
    this.hbTimer = null;
    this.hbMs = 0;
  }

  // ------------------------------------------------------------------ 상태
  workerState() {
    if (!this.token) return this.revoked ? 'revoked' : 'unpaired';
    if (this.updateRequired) return 'update_required';
    if (this.offline) return 'offline';
    if (this.lastError === 'not_allowed') return 'error';
    if (this.settings.paused) return 'paused';
    return this.running.size ? 'running' : 'idle';
  }

  snapshot() {
    return {
      workerState: this.workerState(),
      engines: ENGINES.map((n) => {
        const p = this.probed[n] || {};
        const s = this.settings.engines[n];
        return { name: n, enabled: s.enabled, slots: s.slots, installed: !!p.installed, version: p.version || '', logged_in: !!p.logged_in,
          outdated: !!p.outdated, path: p.path || '', source: s.path ? 'custom' : 'auto', reason: p.reason || '' };
      }),
      running: [...this.running.values()].map((e) => ({ id: e.id, kind: e.kind, engine: e.engine, startedAt: e.startedAt })),
      lastProbeAt: Number.isFinite(this.lastProbe) ? this.lastProbe : null,
      lastError: this.lastError,
    };
  }

  refresh() {
    this.emit({ type: 'state', ...this.snapshot() });
  }

  usable(name) {
    const p = this.probed[name];
    return this.settings.engines[name].enabled && p && p.installed && p.logged_in && !p.outdated;
  }

  /** hello 로 광고할 엔진 — 켠 · 설치된 엔진만. 버전이 낮으면 로그인 안 됨으로 광고해 작업이 오지 않게 */
  advertised() {
    return ENGINES.filter((n) => this.settings.engines[n].enabled && this.probed[n] && this.probed[n].installed).map((n) => {
      const p = this.probed[n];
      return { name: n, version: p.version || '', logged_in: !!p.logged_in && !p.outdated, slots: this.settings.engines[n].slots };
    });
  }

  /** claim 의 엔진별 빈 자리 (6.7 — 엔진별 · 전체 둘 다) */
  free() {
    const left = Math.max(0, this.settings.totalSlots - this.running.size);
    const out = {};
    for (const n of ENGINES) {
      if (!this.usable(n)) continue;
      const busy = [...this.running.values()].filter((e) => e.engine === n).length;
      out[n] = Math.max(0, Math.min(this.settings.engines[n].slots - busy, left));
    }
    return out;
  }

  // ------------------------------------------------------------------ 바깥에서
  start() {
    if (this.loopRunning) return;
    this.loopRunning = true;
    this.loop().finally(() => { this.loopRunning = false; });
  }

  setToken(token) {
    this.token = token || null;
    this.revoked = false;
    this.updateRequired = false;
    this.needHello = true;
    this.lastError = '';
    this.refresh();
    this.wakeUp();
  }

  setSettings(s) {
    const before = JSON.stringify(this.settings);
    const next = normalizeSettings(s);
    const pathChanged = ENGINES.some((n) => next.engines[n].path !== this.settings.engines[n].path);
    this.settings = next;
    if (JSON.stringify(next) === before) return;
    if (pathChanged || ENGINES.some((n) => JSON.parse(before).engines[n].enabled !== next.engines[n].enabled)) this.needProbe = true;
    this.needHello = true;
    this.refresh();
    this.wakeUp();
  }

  nudge() { this.wakeUp(); }

  recheck() {
    this.needProbe = true;
    this.needHello = true;
    this.wakeUp();
  }

  cancel(id) {
    const e = this.running.get(Number(id));
    if (!e || e.cancelled || e.lost) return false;
    e.cancelled = true;
    this.log.info('작업 취소(이 PC에서)', { job: e.id });
    e.ac.abort('cancelled');
    return true;
  }

  async stop({ bye = true } = {}) {
    this.stopped = true;
    this.wakeUp();
    if (this.hbTimer) clearTimeout(this.hbTimer);
    const pending = [...this.running.values()];
    for (const e of pending) { e.lost = true; e.ac.abort('lost'); } // 결과를 올리지 않음 — 리스가 지나면 다른 PC가 이어받음
    await Promise.race([Promise.allSettled(pending.map((e) => e.done)), new Promise((r) => setTimeout(r, 8000))]);
    if (bye && this.token) {
      try { await this.api.post('/api/worker/bye', { paused: this.settings.paused }, { timeout: 5000 }); } catch { /* 실패해도 무시 (8.7) */ }
    }
  }

  // ------------------------------------------------------------------ 폴링
  async loop() {
    while (!this.stopped) {
      let s;
      try { s = await this.tick(); } catch (e) { this.log.error('워커 오류', { error: e && e.message }); s = IDLE_S; }
      if (this.stopped) break;
      await this.waitFor(s * 1000);
    }
  }

  waitFor(ms) {
    return new Promise((resolve) => {
      if (this.woken || this.stopped) { this.woken = false; resolve(); return; }
      this.lastWaitMs = ms;
      const t = this.pollTimers.setTimeout(() => { this.wake = null; resolve(); }, ms);
      this.wake = () => { this.pollTimers.clearTimeout(t); this.wake = null; resolve(); };
    });
  }

  wakeUp() {
    if (this.wake) this.wake();
    else this.woken = true;
  }

  async tick() {
    // 연결 전에도 탐지(이 PC 상태 창에 설치 · 로그인 상태를 보이게) — 서버 요청은 연결된 뒤에만
    if (this.needProbe || this.now() - this.lastProbe >= PROBE_EVERY_MS) await this.doProbe();
    if (!this.token) { this.offline = false; this.refresh(); return 3600; }
    try {
      if (this.needHello || this.now() - this.lastHello >= HELLO_EVERY_MS) await this.hello();
      if (this.updateRequired) return HELLO_EVERY_MS / 1000;
      const paused = this.settings.paused;
      const r = await this.api.post('/api/worker/claim', paused ? { free: {}, paused: true } : { free: this.free(), paused: false });
      this.online();
      if (r && r.job) return this.startJob(r.job) ? 0 : 5;
      const n = Number(r && r.next_poll_s);
      return Number.isFinite(n) ? Math.max(1, n) : IDLE_S;
    } catch (e) {
      return this.onError(e);
    }
  }

  async doProbe() {
    this.needProbe = false;
    const before = JSON.stringify(this.advertised());
    const results = this.noDetect ? ENGINES.map((n) => ({ name: n, installed: false, reason: 'detect_off' })) : await Promise.all(ENGINES.map((n) => Promise.resolve()
      .then(() => this.probe(n, { customPath: this.settings.engines[n].path, enabled: this.settings.engines[n].enabled }))
      .catch(() => ({ name: n, installed: false, reason: 'probe_failed' }))));
    for (const r of results) this.probed[r.name] = r;
    this.lastProbe = this.now();
    if (JSON.stringify(this.advertised()) !== before) this.needHello = true;
    const label = (r) => (r.reason === 'detect_off' ? '탐지 끔' : !r.installed ? '없음' : r.reason === 'off' ? '끔'
      : `${r.version || '?'}${r.logged_in ? '' : '(로그인 필요)'}${r.outdated ? '(버전 낮음)' : ''}`);
    this.log.info('엔진 확인', Object.fromEntries(results.map((r) => [r.name, label(r)])));
    this.refresh();
  }

  async hello() {
    let r;
    try {
      r = await this.api.post('/api/worker/hello', { app_version: this.appVersion, protocol: PROTOCOL, os: this.osName,
        paused: this.settings.paused, engines: this.advertised() });
    } catch (e) {
      if (e.status !== 426) throw e;
      this.lastHello = this.now();
      this.needHello = false;
      this.setUpdateRequired();
      return;
    }
    this.lastHello = this.now();
    this.needHello = false;
    this.updateRequired = false;
    this.online();
    this.log.info('서버 연결', { device_id: r && r.device_id });
    this.emit({ type: 'hello', deviceId: r && r.device_id, name: r && r.name, accountHint: r && r.account_hint });
  }

  online() {
    if (this.offline || this.backoff || this.lastError) this.log.info('서버에 다시 연결됨');
    this.offline = false;
    this.backoff = 0;
    this.lastError = '';
    this.refresh();
  }

  setUpdateRequired() {
    if (!this.updateRequired) this.log.warn('앱 업데이트 필요(426) — 작업을 받지 않음');
    this.updateRequired = true;
    this.refresh();
    this.emit({ type: 'update-required' });
  }

  onError(e) {
    if (e.status === 401) { this.invalidate(e.code || 'device_auth_required'); return 3600; }
    if (e.status === 426) { this.setUpdateRequired(); return HELLO_EVERY_MS / 1000; }
    if (e.status === 403) { this.lastError = e.code || 'forbidden'; this.log.warn('서버가 거부함', { status: 403, code: e.code }); this.refresh(); return 1800; }
    if (e.network || e.status >= 500 || e.status === 429) {
      this.backoff = this.backoff ? Math.min(BACKOFF_MAX_S, this.backoff * 2) : 5;
      if (!this.offline) this.log.warn('서버에 연결할 수 없음', { status: e.status || 'network', retry_s: this.backoff });
      this.offline = true;
      this.refresh();
      return this.backoff;
    }
    this.log.warn('워커 요청 실패', { status: e.status, code: e.code });
    return IDLE_S;
  }

  /** 토큰이 더는 쓸모없음: 실행 중 프로세스를 끄고(결과 안 올림) 토큰을 버린다 (12.4 · AC-79) */
  invalidate(code) {
    if (!this.token) return;
    this.log.warn('이 PC 연결이 끊김', { code });
    for (const e of this.running.values()) { e.lost = true; e.ac.abort('lost'); }
    this.token = null;
    this.revoked = code === 'device_revoked';
    this.needHello = true;
    this.refresh();
    this.emit({ type: 'token-invalid', code });
  }

  // ------------------------------------------------------------------ 실행
  /** 잡은 작업 실행 시작. 작업 정보가 이상하면(id 가 양의 안전한 정수가 아님 · 리스 토큰 없음) 받지 않고 false */
  startJob(task) {
    if (!task || !Number.isSafeInteger(task.id) || task.id <= 0 || typeof task.lease_token !== 'string' || !task.lease_token) {
      this.log.warn('서버가 준 작업 정보가 올바르지 않아 받지 않음');
      return false;
    }
    // 같은 작업을 새 리스로 다시 잡음(리스 만료 뒤 재할당이 이 PC로 옴): 옛 실행은 끄고(결과 안 올림) 끝난 뒤 새로 시작
    const prev = this.running.get(task.id);
    if (prev) {
      prev.lost = true;
      prev.ac.abort('lost');
      this.log.info('같은 작업을 다시 잡음 — 옛 실행을 멈춤', { job: task.id });
    }
    const e = { id: task.id, task, engine: task.engine, kind: task.kind, startedAt: this.now(), ac: new AbortController(),
      partial: '', lost: false, cancelled: false, done: null, prev: prev ? prev.done : null };
    this.running.set(e.id, e);
    this.log.info('작업 시작', { job: e.id, kind: e.kind, engine: e.engine });
    this.refresh();
    this.scheduleHeartbeat(task.heartbeat_s);
    e.done = this.execute(e);
    return true;
  }

  async execute(e) {
    if (e.prev) await e.prev.catch(() => {});
    const p = this.probed[e.engine] || {};
    let res;
    try {
      res = await this.runTask(e.task, { resolved: p.resolved, version: p.version, signal: e.ac.signal, workRoot: this.workRoot,
        env: this.env, onPartial: (t) => { e.partial = t; } });
    } catch (err) {
      this.log.error('실행 오류', { job: e.id, error: err && err.message });
      res = { outcome: 'failed', error_code: 'cli_exit', error: 'PC 앱이 CLI를 실행하지 못했어요', stats: {} };
    }
    if (res.stats && res.stats.model_fallback) {
      this.log.info('선택한 CLI 모델을 쓸 수 없어 기본 모델로 다시 실행함', { job: e.id, engine: e.engine, model: e.task.model });
    }
    if (e.lost || res.outcome === 'lost') {
      this.log.info('작업 멈춤(이 PC의 것이 아님)', { job: e.id });
    } else {
      await this.upload(e, res);
    }
    // 같은 id 를 새 리스로 다시 잡았으면 표의 항목은 새 실행의 것 — 내 것(이 실행 · 리스 토큰)일 때만 지움
    const cur = this.running.get(e.id);
    if (cur === e) this.running.delete(e.id);
    this.refresh();
    this.wakeUp(); // 빈 자리가 생김 → 바로 잡기
  }

  async upload(e, res) {
    let body = { lease_token: e.task.lease_token, outcome: res.outcome, text: res.text || '', structured: res.structured || null,
      error_code: res.error_code || '', error: redact(res.error || '', 2000), stats: res.stats || {} };
    for (let i = 0; i < 6 && !this.stopped; i++) {
      try {
        const r = await this.api.post(`/api/worker/jobs/${e.id}/result`, body, { timeout: 120000 });
        this.log.info('작업 결과', { job: e.id, outcome: body.outcome, error_code: body.error_code, status: r && r.status,
          ms: body.stats.duration_ms, exit: body.stats.exit_code });
        if (RELOCATE.has(body.error_code)) { this.needProbe = true; this.needHello = true; }
        this.emit({ type: 'job-finished', id: e.id, kind: e.kind, engine: e.engine, outcome: body.outcome, error_code: body.error_code, status: r && r.status });
        return;
      } catch (err) {
        if (err.status === 400 && err.code === 'output_too_large' && body.outcome !== 'failed') {
          body = { ...body, outcome: 'failed', text: '', structured: null, error_code: 'output_too_large', error: '결과가 너무 길어요' };
          continue;
        }
        if (err.status === 409 || err.status === 404) { this.log.info('결과를 버림', { job: e.id, status: err.status, code: err.code }); return; }
        if (err.status === 401) { this.invalidate(err.code); return; }
        if (err.network || err.status >= 500 || err.status === 429) { await new Promise((r) => setTimeout(r, Math.min(30000, 5000 * (i + 1)))); continue; }
        this.log.warn('결과 보내기 실패', { job: e.id, status: err.status, code: err.code });
        return;
      }
    }
  }

  scheduleHeartbeat(seconds) {
    const ms = Math.max(100, (Number(seconds) || 30) * 1000);
    if (this.hbTimer && ms >= this.hbMs) return;
    if (this.hbTimer) clearTimeout(this.hbTimer);
    this.hbMs = ms;
    this.hbTimer = setTimeout(() => this.heartbeatTick(), ms);
  }

  async heartbeatTick() {
    this.hbTimer = null;
    const entries = [...this.running.values()].filter((e) => !e.lost);
    if (!entries.length || this.stopped) { this.hbMs = 0; return; }
    const items = entries.slice(0, 16).map((e) => ({ id: e.id, lease_token: e.task.lease_token,
      progress: { message: `${e.engine} 실행 중`, ...(e.partial ? { partial_text: e.partial } : {}) } }));
    try {
      const r = await this.api.post('/api/worker/heartbeat', { jobs: items });
      this.online();
      for (const it of (r && r.jobs) || []) {
        const e = this.running.get(Number(it.id));
        if (!e) continue;
        if (!it.ok) {
          if (!e.lost) { e.lost = true; this.log.info('리스 잃음 — 작업을 멈춤', { job: e.id }); e.ac.abort('lost'); }
        } else if (it.cancel && !e.cancelled) {
          e.cancelled = true;
          this.log.info('취소 요청을 받음', { job: e.id });
          e.ac.abort('cancelled');
        }
      }
    } catch (err) {
      if (err.status === 401) { this.invalidate(err.code); return; }
      if (err.network || err.status >= 500) { this.offline = true; this.refresh(); }
    }
    if (this.running.size && !this.stopped) this.hbTimer = setTimeout(() => this.heartbeatTick(), this.hbMs);
    else this.hbMs = 0;
  }
}

module.exports = { Worker, normalizeSettings, PROTOCOL };
