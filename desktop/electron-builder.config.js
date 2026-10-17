'use strict';
// electron-builder 설정 (명세 13.1 · 13.7 · 13.7.1, U3 · U5 · U6 · U10).
// - 서버 주소는 저장소의 한 곳(deploy/server-pc/server.json public_url)에서 빌드할 때 읽어 앱 package.json(paperlabServer)에 넣는다.
// - 자동 업데이트: generic provider, url = public_url + "/downloads/" (https만 — AC-88). GitHub · 토큰 안 씀.
// - 설치: NSIS 사용자별 · 한 번에 설치, 파일 이름 PaperLab-Setup-<버전>.exe(서버 /downloads/ 허용 이름).
//   paperlab:// 는 NSIS 가 등록하지 않음(protocols 는 macOS 용) → 앱이 시작할 때 등록(main/auth-bridge.js), 제거 때 installer.nsh 가 지움.
// - Electron fuses(보안 체크리스트 19번): runAsNode · NODE_OPTIONS · --inspect 끔. ASAR 무결성(embeddedAsarIntegrityValidation)은 일부러 켜지 않음 —
//   서명 없는 설치본에서 실측 전(README 후속).

const fs = require('node:fs');
const path = require('node:path');
const { copyAppCss } = require('./scripts/copy-css');
const { copyVendor } = require('./scripts/copy-vendor');

const SERVER_JSON = path.join(__dirname, '..', 'deploy', 'server-pc', 'server.json');
// 추출 Worker 가 require 하는 패키지와 그 의존성(잠금 파일 기준 — 선택 동기화 9.5.4)
const EXTRACT_DEPS = ['hwp.js', 'cfb', 'adler-32', 'crc-32', 'pako', 'word-extractor', 'saxes', 'xmlchars', 'yauzl', 'fd-slicer', 'pend', 'buffer-crc32'];

function publicUrl() {
  const cfg = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf8').replace(/^﻿/, ''));
  const url = String(cfg.public_url || '').replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(url)) throw new Error(`server.json public_url은 https 출처여야 해요: ${url}`);
  return url;
}

const server = publicUrl();
copyAppCss(); // PD-5 — 빌드마다 app.css를 새로 복사
copyVendor(); // 선택 동기화 9.4 — PDF.js 두 파일(ui/vendor/)을 서버 사본에서 새로 복사
console.log(`PaperLab 서버 주소(server.json): ${server} · 업데이트 주소: ${server}/downloads/`); // 빌드 로그 확인용(U6)

module.exports = {
  appId: 'kr.paperlab.desktop',
  productName: 'PaperLab',
  copyright: 'PaperLab',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['package.json', 'main/**/*', 'preload/**/*', 'worker/**/*', 'sync/**/*', 'lib/**/*', 'ui/**/*', 'extract/**/*'],
  // 로컬 문서 본문 추출(선택 동기화 9.5 — utilityProcess + worker_threads)은 asar 밖 실제 파일에서 돈다(main/extract-host.js unpacked)
  asarUnpack: ['extract/**/*', ...EXTRACT_DEPS.map((n) => `node_modules/${n}/**/*`)],
  extraResources: [
    { from: 'build', to: 'icons', filter: ['icon.ico', 'tray-*.ico'] },
    { from: 'build/THIRD_PARTY_NOTICES.txt', to: 'THIRD_PARTY_NOTICES.txt' }, // 오픈 소스 고지(9.5.4 — 이 PC 상태 창 아래 링크로 엶)
  ],
  extraMetadata: { paperlabServer: server },
  asar: true,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  protocols: [{ name: 'PaperLab', schemes: ['paperlab'] }],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    artifactName: 'PaperLab-Setup-${version}.${ext}',
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'PaperLab',
    artifactName: 'PaperLab-Setup-${version}.${ext}',
    include: 'build/installer.nsh', // 제거할 때 동기화 설치 ID · paperlab:// 등록 지움(업데이트 때는 남김 — 6단계 K-33)
  },
  publish: [{ provider: 'generic', url: `${server}/downloads/` }],
};
