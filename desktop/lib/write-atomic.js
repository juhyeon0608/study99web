'use strict';
// 원자적 쓰기: 같은 폴더의 임시 파일에 쓴 뒤 이름 바꾸기(중간에 죽어도 옛 내용이나 새 내용 중 하나만 남음).

const fs = require('node:fs');
const path = require('node:path');

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { writeAtomic };
