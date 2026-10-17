'use strict';
// main 쪽 로컬 본문 추출 (명세 selective-sync.md 9.4 · 9.5.3절, D-6 · D-14): 바이트만 넘기고 글 조각만 받는다 — 경로 · 루트 · 토큰을 넘기지 않음.
// - 문서(.docx · .hwpx · .pptx · .xlsx · .odt · .odp · .ods · .hwp · .doc): 별도 utilityProcess(extract/entry.js — 서비스 'PaperLab Extract').
//   필요할 때 띄우고 5분 쉬면 끝냄, 죽으면 다음 요청 때 다시 띄움. Node 권한 모델(--permission — 스파이크 SX-1)로 먼저 띄워 보고,
//   그 플래그로 시작하지 못하면 플래그 없이(바이트만 받음 · 시간 · 메모리 상한으로 충분 — 수용 위험) — 결과는 로그 한 줄.
// - PDF: 숨은 샌드박스 창 app://ui/extract.html(별도 세션 'paperlab-extract' — 네트워크 차단 · 권한 거부, window.js) 의 PDF.js.
//   창은 한 번에 하나, 60초 제한, 끝나면 닫음. 상한 2,000쪽 · 글 합계 8MB(창이 지키고 main 이 다시 자름).
// 로그: 결과 코드 · 조각 수 · 걸린 시간만(본문 · 이름 · 경로 없음 — 11장 10).

const path = require('node:path');

const DOC_TIMEOUT_MS = 45000; // Worker 30초 + 띄우기 · 주고받기 여유
const PDF_TIMEOUT_MS = 60000;
const IDLE_MS = 5 * 60e3;
const MAX_PAGES = 2000;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const CODES = new Set(['local_unreadable', 'local_unsupported', 'local_no_text', 'busy']);

/** 조각 배열 정리: 글만 · 2,000개 · 8MB(넘으면 그 자리에서 멈춤) */
function clampPages(pages) {
  const out = [];
  let bytes = 0;
  for (const raw of Array.isArray(pages) ? pages : []) {
    if (out.length >= MAX_PAGES) break;
    const p = typeof raw === 'string' ? raw : '';
    const b = Buffer.byteLength(p, 'utf8');
    if (bytes + b > MAX_TEXT_BYTES) break;
    out.push(p);
    bytes += b;
  }
  return out;
}

/**
 * d = {utilityProcess, log, entryFile?, openPdfWindow?(): {win, wc}} — openPdfWindow 는 window.js 의 createExtractWindow(시험은 가짜).
 * → {extractDoc(ext, bytes), extractPdf(bytes), onReady(sender), onDone(sender, id, pages, code), stop()}
 */
/** 설치본: app.asar 안 경로 → app.asar.unpacked(electron-builder asarUnpack — 추출 Worker 가 실제 파일에서 파서를 읽게) */
const unpacked = (p) => p.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');

function createExtractHost(d) {
  const { utilityProcess, log } = d;
  const entryFile = d.entryFile || unpacked(path.join(__dirname, '..', 'extract', 'entry.js'));
  const H = { child: null, ready: null, pending: new Map(), seq: 0, idle: null, permission: null, triedPermission: false, stopping: false, pdf: null, pdfQueue: [] };

  // ------------------------------------------------------------------ 문서: 추출 프로세스
  function fork(withPermission) {
    const readDir = path.dirname(path.dirname(path.dirname(entryFile))); // 앱 폴더의 부모(설치본 = resources — app.asar · app.asar.unpacked 둘 다)
    const execArgv = withPermission ? ['--permission', `--allow-fs-read=${readDir}`, '--allow-worker'] : [];
    const child = utilityProcess.fork(entryFile, [], { serviceName: 'PaperLab Extract', stdio: 'ignore', execArgv });
    H.child = child;
    H.ready = new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 10000);
      child.on('message', (m) => {
        if (m && m.type === 'ready') {
          clearTimeout(t);
          if (H.permission === null || H.permission !== !!m.permission) log.info('추출 프로세스 시작', { permission: m.permission ? 'yes' : 'no' });
          H.permission = !!m.permission;
          resolve(true);
          return;
        }
        if (m && m.type === 'result') {
          const w = H.pending.get(m.id);
          if (w) { H.pending.delete(m.id); w(m.ok === true ? { ok: true, pages: clampPages(m.pages) } : { ok: false, code: CODES.has(m.code) ? m.code : 'local_unreadable' }); }
        }
      });
      child.on('exit', (code) => {
        clearTimeout(t);
        resolve(false);
        if (H.child === child) { H.child = null; H.ready = null; }
        for (const [id, w] of H.pending) { H.pending.delete(id); w({ ok: false, code: 'local_unreadable' }); }
        if (!H.stopping) log.info('추출 프로세스 끝남', { code });
      });
    });
    return H.ready;
  }

  async function ensureChild() {
    if (H.child && H.ready) return H.ready;
    if (!H.triedPermission) {
      H.triedPermission = true;
      if (await fork(true)) return true;
      log.info('권한 모델로 추출 프로세스를 띄우지 못함 — 플래그 없이(SX-1)');
      H.permission = false;
      if (H.child) { try { H.child.kill(); } catch { /* 끝남 */ } H.child = null; }
      return fork(false);
    }
    return fork(H.permission === true);
  }

  function touchIdle() {
    if (H.idle) clearTimeout(H.idle);
    H.idle = setTimeout(() => {
      if (H.pending.size || !H.child) return;
      H.stopping = true;
      try { H.child.kill(); } catch { /* 끝남 */ }
      H.child = null; H.ready = null; H.stopping = false;
    }, IDLE_MS);
    if (H.idle.unref) H.idle.unref();
  }

  async function extractDoc(ext, bytes) {
    const t0 = Date.now();
    if (!(await ensureChild()) || !H.child) return { ok: false, code: 'local_unreadable' };
    const id = ++H.seq;
    const r = await new Promise((resolve) => {
      const t = setTimeout(() => { H.pending.delete(id); resolve({ ok: false, code: 'local_unreadable' }); }, DOC_TIMEOUT_MS);
      H.pending.set(id, (x) => { clearTimeout(t); resolve(x); });
      try { H.child.postMessage({ type: 'extract', id, ext: String(ext), bytes }); } catch { H.pending.delete(id); clearTimeout(t); resolve({ ok: false, code: 'local_unreadable' }); }
    });
    touchIdle();
    log.info('문서 본문 추출', { ok: r.ok ? 'yes' : r.code, parts: r.ok ? r.pages.length : 0, ms: Date.now() - t0 });
    return r;
  }

  // ------------------------------------------------------------------ PDF: 숨은 추출 창
  function pumpPdf() {
    if (H.pdf || !H.pdfQueue.length) return;
    const job = H.pdfQueue.shift();
    const t0 = Date.now();
    let win = null;
    const done = (r) => {
      if (!H.pdf || H.pdf.job !== job) return;
      clearTimeout(H.pdf.timer);
      H.pdf = null;
      try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* 닫힘 */ }
      log.info('PDF 본문 추출', { ok: r.ok ? 'yes' : r.code, parts: r.ok ? r.pages.length : 0, ms: Date.now() - t0 });
      job.resolve(r);
      pumpPdf();
    };
    H.pdf = { job, done, timer: setTimeout(() => done({ ok: false, code: 'local_unreadable' }), PDF_TIMEOUT_MS), wc: null, sent: false };
    try {
      win = d.openPdfWindow();
      H.pdf.wc = win.webContents;
      win.webContents.once('render-process-gone', () => done({ ok: false, code: 'local_unreadable' }));
      win.webContents.once('did-fail-load', () => done({ ok: false, code: 'local_unreadable' }));
    } catch { done({ ok: false, code: 'local_unreadable' }); }
  }

  function extractPdf(bytes) {
    return new Promise((resolve) => { H.pdfQueue.push({ bytes, resolve }); pumpPdf(); });
  }

  /** 추출 창이 준비됨(extract:ready) → 바이트를 보냄. 보낸 곳이 지금 창이 아니면 무시 */
  function onReady(sender) {
    const p = H.pdf;
    if (!p || !p.wc || sender !== p.wc || p.sent) return;
    p.sent = true;
    const b = p.job.bytes;
    const data = new Uint8Array(b.length);
    data.set(b);
    p.wc.send('extract:job', { id: 1, data });
  }

  /** 추출 창의 결과(extract:done) */
  function onDone(sender, _id, pages, code) {
    const p = H.pdf;
    if (!p || !p.wc || sender !== p.wc) return;
    if (code) p.done({ ok: false, code: CODES.has(code) && code !== 'busy' ? code : 'local_unreadable' });
    else p.done({ ok: true, pages: clampPages(pages) });
  }

  function stop() {
    H.stopping = true;
    if (H.idle) clearTimeout(H.idle);
    try { if (H.child) H.child.kill(); } catch { /* 끝남 */ }
    if (H.pdf) H.pdf.done({ ok: false, code: 'local_unreadable' });
  }

  return { extractDoc, extractPdf, onReady, onDone, stop, permission: () => H.permission };
}

module.exports = { createExtractHost, clampPages, unpacked };
