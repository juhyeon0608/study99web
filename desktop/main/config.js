'use strict';
// 서버 주소 (확정 U6 — 설치 파일에 넣음, 주소 입력 칸 없음). 배포본: 빌드가 package.json 의 paperlabServer 에 넣은 값만.
// 개발 실행(npm start)은 환경 변수 PAPERLAB_SERVER_URL(이 PC 안 주소 — 127.0.0.1 · localhost)이 꼭 있어야 하고, 없으면 시작하지 않음
// (개발 실행이 운영 서버에 붙지 않게 — 품질팀 F9). 저장소의 server.json 은 빌드만 읽는다.

const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

function cleanOrigin(url, { allowLocalHttp }) {
  let u;
  try { u = new URL(String(url || '')); } catch { return null; }
  const local = LOCAL_HOSTS.includes(u.hostname);
  if (u.protocol !== 'https:' && !(allowLocalHttp && local && u.protocol === 'http:')) return null;
  return u.origin;
}

function serverOrigin({ isPackaged, env = process.env, pkg = require('../package.json') } = {}) {
  if (isPackaged) return cleanOrigin(pkg.paperlabServer, { allowLocalHttp: false });
  const origin = cleanOrigin(env.PAPERLAB_SERVER_URL, { allowLocalHttp: true });
  return origin && LOCAL_HOSTS.includes(new URL(origin).hostname) ? origin : null;
}

module.exports = { serverOrigin, cleanOrigin };
