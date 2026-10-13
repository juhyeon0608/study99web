'use strict';
// 엔진이 지우는 유일한 곳 (명세 12.1-1 · AC-659): ① 루트\.paperlab-sync\tmp\ 안의 자기 임시 파일 ② 빈 디렉터리.
// 사용자 파일은 어떤 경우에도 여기서 지우지 않는다(지울 때는 Windows 휴지통 — main 의 shell.trashItem, 실패하면 보관함으로 옮김).

const fs = require('node:fs');
const path = require('node:path');
const { isInside, SYNC_DIR } = require('./paths');

/** 임시 파일 하나 — tmp 폴더 바로 안의 파일만 */
function removeTemp(root, abs) {
  const tmpDir = path.join(root, SYNC_DIR, 'tmp');
  if (!isInside(tmpDir, abs) || path.dirname(path.resolve(abs)).toLowerCase() !== path.resolve(tmpDir).toLowerCase()) return false;
  try { fs.unlinkSync(abs); return true; } catch { return false; }
}

/** 빈 디렉터리 하나 — 비어 있지 않으면 운영 체제가 거절한다(ENOTEMPTY) */
function removeEmptyDir(root, abs) {
  if (!isInside(root, abs)) return false;
  try { fs.rmdirSync(abs); return true; } catch { return false; }
}

module.exports = { removeTemp, removeEmptyDir };
