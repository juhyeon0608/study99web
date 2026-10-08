'use strict';
// 테스트 도우미: 한글 · 공백이 든 임시 폴더(AC-61), npm 셸 스크립트 흉내(가짜 CLI), 가짜 워커 서버(node:http)

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const FAKE = path.join(__dirname, 'fixtures', 'fake-cli.js');

/** C:\Users\홍 길동\… 흉내 */
function tempHome(prefix = 'pl-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(dir, '홍 길동');
  fs.mkdirSync(home, { recursive: true });
  return home;
}

/** npm 이 만드는 것과 같은 모양의 <엔진>.cmd + node_modules\<패키지>\bin\<엔진>.js (→ node <진입 js> 로 실행됨) */
function makeShim(dir, engine) {
  const bin = path.join(dir, 'node_modules', `fake-${engine}`, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, `${engine}.js`), `require(${JSON.stringify(FAKE)})(${JSON.stringify(engine)});\n`);
  fs.writeFileSync(path.join(dir, `${engine}.cmd`),
    `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n` +
    `"%_prog%"  "%dp0%\\node_modules\\fake-${engine}\\bin\\${engine}.js" %*\r\n`);
  return path.join(dir, `${engine}.cmd`);
}

/** cmd.exe 를 거쳐야만 하는 .cmd (진입 파일을 읽을 수 없는 모양) — 셸 경로 시험용 */
function makeOpaqueCmd(dir, engine) {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${engine}.cmd`);
  // 배치 파일은 OEM 코드 페이지로 읽혀 한글 경로를 적으면 깨짐 → 가짜 CLI 를 옆에 복사하고 %~dp0 로 부름
  fs.copyFileSync(FAKE, path.join(dir, 'fake-cli.js'));
  fs.writeFileSync(p, `@"${process.execPath}" "%~dp0fake-cli.js" ${engine} %*\r\n`);
  return p;
}

function readLog(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitFor(cond, ms = 5000, step = 25) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
}

/**
 * 가짜 워커 서버. handlers[path](body, req) → {http, body} | 객체(200). 요청은 calls 에 기록(헤더 포함)
 */
async function fakeServer(handlers) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      const p = req.url.replace(/\?.*$/, '');
      calls.push({ path: p, body, headers: req.headers, at: Date.now() });
      const key = Object.keys(handlers).find((k) => (k.endsWith('*') ? p.startsWith(k.slice(0, -1)) : p === k));
      let out = key ? await handlers[key](body, req) : { http: 404, body: { code: 'not_found' } };
      if (!out || out.http === undefined) out = { http: 200, body: out || {} };
      res.writeHead(out.http, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, calls, close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }) };
}

module.exports = { FAKE, tempHome, makeShim, makeOpaqueCmd, readLog, alive, waitFor, fakeServer };
