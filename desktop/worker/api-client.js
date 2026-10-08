'use strict';
// 워커 API 호출 (명세 8장): 전부 POST, 헤더 Authorization: Bearer <기기 토큰> + X-PaperLab: 1, Origin 없음.
// 실패는 ApiError(status, body.code). 응답을 못 받으면 network = true. 토큰은 오류 · 로그에 넣지 않는다.

class ApiError extends Error {
  constructor(status, body, network = false) {
    super(network ? 'network' : `HTTP ${status}${body && body.code ? ` ${body.code}` : ''}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = (body && body.code) || '';
    this.body = body || null;
    this.network = network;
  }
}

function createApi({ baseUrl, getToken = () => null, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  const root = String(baseUrl).replace(/\/+$/, '');
  async function post(path, body, { auth = true, timeout = timeoutMs } = {}) {
    const headers = { 'Content-Type': 'application/json', 'X-PaperLab': '1' };
    if (auth) {
      const token = getToken();
      if (!token) throw new ApiError(401, { code: 'device_auth_required' });
      headers.Authorization = `Bearer ${token}`;
    }
    let res;
    try {
      res = await fetchImpl(root + path, { method: 'POST', headers, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(timeout) });
    } catch {
      throw new ApiError(0, null, true);
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }
  return { post };
}

module.exports = { createApi, ApiError };
