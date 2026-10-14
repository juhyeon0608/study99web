'use strict';
// 짧은 외부 명령 한 번 실행(reg · powershell · mountvol · attrib). 출력은 utf8 문자열, 창을 띄우지 않음.

const { execFile } = require('node:child_process');

/** → {code: 0 | 종료 코드 | null(시작 못 함 · 시간 초과), out} */
function run(cmd, args, { timeout = 15000 } = {}) {
  return new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout, encoding: 'utf8' }, (err, out) => {
    if (!err) return resolve({ code: 0, out: String(out) });
    resolve({ code: err.killed || typeof err.code !== 'number' ? null : err.code, out: String(out || '') });
  }));
}

module.exports = { run };
