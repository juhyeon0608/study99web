'use strict';
// PDF 바이트 전송 (명세 9.7 · 12.4 · K-11): 서버가 발급한 서명 주소로 직접 PUT · GET.
// 요청 전에 주소를 검사한다 — 운영은 https + *.r2.cloudflarestorage.com 만, 개발 실행은 서버 출처의 /_dev_storage/ 만.
// 사용자 정보(user:pass@) 거부, 3xx 는 따르지 않고 실패. 객체 키는 올리기 incoming/{내 uid}/, 받기 users/{내 uid}/papers/ 로 시작해야 함.
// 어긋나면 요청 0회. 주소 · 키는 로그에 쓰지 않는다(12.6).

const fs = require('node:fs');
const crypto = require('node:crypto');
const { MAX_PDF_BYTES } = require('./paths');

const R2_SUFFIX = '.r2.cloudflarestorage.com';
const DEV_PREFIX = '/_dev_storage/';

class TransferError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function decodeKey(pathname) {
  let key;
  try { key = decodeURIComponent(pathname); } catch { return null; }
  if (key.includes('\\') || key.includes('//') || key.split('/').some((s) => s === '..' || s === '.')) return null;
  return key.replace(/^\/+/, '');
}

/**
 * kind 'put' | 'get' → 검사를 통과한 절대 주소, 아니면 TransferError('bad_url')
 * o = {serverOrigin, dev, uid}
 */
function checkUrl(raw, kind, { serverOrigin, dev, uid }) {
  if (typeof raw !== 'string' || !raw || !/^[0-9a-f-]{36}$/.test(String(uid))) throw new TransferError('bad_url');
  let u;
  try { u = new URL(raw, dev ? serverOrigin : undefined); } catch { throw new TransferError('bad_url'); }
  if (u.username || u.password) throw new TransferError('bad_url');
  const prefix = kind === 'put' ? `incoming/${uid}/` : `users/${uid}/papers/`;
  let keys;
  if (dev) {
    if (u.origin !== new URL(serverOrigin).origin || !u.pathname.startsWith(DEV_PREFIX)) throw new TransferError('bad_url');
    keys = [decodeKey(u.pathname.slice(DEV_PREFIX.length))];
  } else {
    if (u.protocol !== 'https:' || !u.hostname.endsWith(R2_SUFFIX) || u.port) throw new TransferError('bad_url');
    const k = decodeKey(u.pathname);
    // 가상 호스트형(버킷이 호스트 앞) · 경로형(버킷이 경로 첫 조각) 둘 다
    keys = k == null ? [null] : [k, k.split('/').slice(1).join('/')];
  }
  if (!keys.some((k) => k && k.startsWith(prefix) && k.length > prefix.length)) throw new TransferError('bad_url');
  return u.href;
}

function createTransfer({ serverOrigin, dev, getUid, fetchImpl = globalThis.fetch, timeoutMs = 10 * 60 * 1000 }) {
  const opts = () => ({ serverOrigin, dev, uid: getUid() });

  /** upload = {method, url, headers} — 파일을 읽어 해시가 expect 와 같을 때만 올림 */
  async function put(upload, abs, expectSha) {
    const url = checkUrl(upload && upload.url, 'put', opts());
    const data = await fs.promises.readFile(abs);
    if (data.length > MAX_PDF_BYTES) throw new TransferError('too_big');
    if (crypto.createHash('sha256').update(data).digest('hex') !== expectSha) throw new TransferError('changed');
    const headers = {};
    for (const [k, v] of Object.entries((upload && upload.headers) || {})) if (/^content-type$/i.test(k)) headers['Content-Type'] = String(v);
    let res;
    try {
      res = await fetchImpl(url, { method: 'PUT', body: data, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch { throw new TransferError('network'); }
    if (res.status < 200 || res.status >= 300) throw new TransferError(res.status >= 300 && res.status < 400 ? 'redirect' : `http_${res.status}`);
  }

  /** 받아서 dest(임시 파일)에 쓰고 SHA-256 을 돌려줌. 크기 상한을 넘으면 실패 */
  async function get(rawUrl, dest) {
    const url = checkUrl(rawUrl, 'get', opts());
    let res;
    try {
      res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch { throw new TransferError('network'); }
    if (res.status !== 200 || !res.body) throw new TransferError(res.status >= 300 && res.status < 400 ? 'redirect' : `http_${res.status}`);
    const h = crypto.createHash('sha256');
    const fh = await fs.promises.open(dest, 'wx');
    let size = 0;
    try {
      for await (const chunk of res.body) {
        size += chunk.length;
        if (size > MAX_PDF_BYTES) throw new TransferError('too_big');
        h.update(chunk);
        await fh.write(chunk);
      }
      await fh.sync();
    } finally { await fh.close(); }
    return { sha256: h.digest('hex'), size };
  }

  return { put, get };
}

module.exports = { checkUrl, createTransfer, TransferError };
