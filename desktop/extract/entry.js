'use strict';
// 문서 추출 프로세스 진입점 (명세 selective-sync.md 9.5.3절 — 서비스 이름 'PaperLab Extract'): main 이 필요할 때 띄우고 5분 쉬면 끝냄.
// 동기화 · 워커 프로세스와 분리 — 파서가 죽어도 동기화 · 워커는 계속. 받는 것은 {type: 'extract', id, ext, bytes} 뿐(경로 · 루트 · 토큰을 모름),
// 돌려주는 것은 {type: 'result', id, ok, pages, code} 뿐. 결과 글은 main → 워커로만 가고 디스크 · 로그에 남지 않는다.
// Electron utilityProcess(process.parentPort) 와 Node child_process.fork(시험 — process.send) 둘 다로 돈다.
// 추가 방어(스파이크 SX-1): main 이 Node 권한 모델(--permission)로 띄우면 파일 쓰기 · 자식 프로세스 · 네트워크가 막힌다 — ready 에 알림.

const { createRunner } = require('./runner');
const { LOCAL_TEXT_EXTS } = require('./kinds');

const port = process.parentPort || null;
const send = (m) => { try { if (port) port.postMessage(m); else if (process.send) process.send(m); } catch { /* main 이 닫힘 */ } };
const runner = createRunner();
const DOC_EXTS = new Set(LOCAL_TEXT_EXTS.filter((e) => e !== '.pdf'));

function toBuffer(b) {
  if (Buffer.isBuffer(b)) return b;
  if (b instanceof Uint8Array) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (b instanceof ArrayBuffer) return Buffer.from(b);
  if (b && b.type === 'Buffer' && Array.isArray(b.data)) return Buffer.from(b.data); // JSON 직렬화(시험 fork)
  return null;
}

async function onMessage(m) {
  if (!m || typeof m !== 'object' || m.type !== 'extract') return;
  const id = Number(m.id);
  if (!Number.isSafeInteger(id)) return;
  const ext = String(m.ext || '').toLowerCase();
  const bytes = toBuffer(m.bytes);
  if (!DOC_EXTS.has(ext) || !bytes) { send({ type: 'result', id, ok: false, pages: [], code: 'local_unsupported' }); return; }
  const r = await runner.run(ext, bytes);
  send({ type: 'result', id, ok: r.ok === true, pages: r.ok ? r.pages : [], code: r.ok ? '' : r.code });
}

if (port) port.on('message', (e) => { onMessage(e && e.data); });
else process.on('message', onMessage);

let permission = false;
try { permission = !!process.permission && !process.permission.has('fs.write') && !process.permission.has('child'); } catch { permission = false; }
send({ type: 'ready', permission });
