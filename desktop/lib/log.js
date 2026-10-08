'use strict';
// 로그 파일 (명세 13.8): %APPDATA%\PaperLab\logs\main.log · worker.log, 파일당 5MB × 3개 회전.
// 한 줄 = 시각 · 수준 · 사건. 모든 줄은 redact()를 거친다 — 토큰 · 키 · 연결 코드가 남지 않게.
// 프롬프트 · 논문 본문 · 결과 글 · 주소 전체는 부르는 쪽이 애초에 넘기지 않는다.

const fs = require('node:fs');
const path = require('node:path');
const { redact } = require('./redact');

class Logger {
  constructor(file, { maxBytes = 5 * 1024 * 1024, keep = 3, echo = false } = {}) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.keep = keep;
    this.echo = echo;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* 쓸 때 다시 시도 */ }
  }

  _rotate() {
    try {
      if (fs.statSync(this.file).size < this.maxBytes) return;
    } catch { return; }
    for (let i = this.keep - 1; i >= 1; i--) {
      const src = i === 1 ? this.file : `${this.file}.${i - 1}`;
      try { fs.renameSync(src, `${this.file}.${i}`); } catch { /* 없으면 건너뜀 */ }
    }
  }

  write(level, msg, fields) {
    let line = `${new Date().toISOString()} [${level}] ${msg}`;
    if (fields) {
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null && v !== '') line += ` ${k}=${String(v).replace(/\s+/g, ' ')}`;
      }
    }
    line = redact(line, 4000);
    if (this.echo) console.log(line);
    try {
      this._rotate();
      fs.appendFileSync(this.file, line + '\n', 'utf8');
    } catch { /* 로그 실패로 앱을 멈추지 않음 */ }
  }

  info(msg, fields) { this.write('INFO', msg, fields); }
  warn(msg, fields) { this.write('WARN', msg, fields); }
  error(msg, fields) { this.write('ERROR', msg, fields); }
}

const nullLogger = { info() {}, warn() {}, error() {}, write() {} };

module.exports = { Logger, nullLogger };
