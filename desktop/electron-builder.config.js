'use strict';
// electron-builder 설정 (명세 13.1 · 13.7 · 13.7.1, U3 · U5 · U6 · U10).
// - 서버 주소는 저장소의 한 곳(deploy/server-pc/server.json public_url)에서 빌드할 때 읽어 앱 package.json(paperlabServer)에 넣는다.
// - 자동 업데이트: generic provider, url = public_url + "/downloads/" (https만 — AC-88). GitHub · 토큰 안 씀.
// - 설치: NSIS 사용자별 · 한 번에 설치, paperlab:// 프로토콜 등록, 파일 이름 PaperLab-Setup-<버전>.exe(서버 /downloads/ 허용 이름).
// - Electron fuses(보안 체크리스트 19번): runAsNode · NODE_OPTIONS · --inspect 끔.

const fs = require('node:fs');
const path = require('node:path');
const { copyAppCss } = require('./scripts/copy-css');

const SERVER_JSON = path.join(__dirname, '..', 'deploy', 'server-pc', 'server.json');

function publicUrl() {
  const cfg = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf8').replace(/^﻿/, ''));
  const url = String(cfg.public_url || '').replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(url)) throw new Error(`server.json public_url은 https 출처여야 해요: ${url}`);
  return url;
}

const server = publicUrl();
copyAppCss(); // PD-5 — 빌드마다 app.css를 새로 복사
console.log(`PaperLab 서버 주소(server.json): ${server} · 업데이트 주소: ${server}/downloads/`); // 빌드 로그 확인용(U6)

module.exports = {
  appId: 'kr.paperlab.desktop',
  productName: 'PaperLab',
  copyright: 'PaperLab',
  directories: { output: 'dist', buildResources: 'build' },
  files: ['package.json', 'main/**/*', 'preload/**/*', 'worker/**/*', 'lib/**/*', 'ui/**/*'],
  extraResources: [{ from: 'build', to: 'icons', filter: ['icon.ico', 'tray-*.ico'] }],
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
  },
  publish: [{ provider: 'generic', url: `${server}/downloads/` }],
};
