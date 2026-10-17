'use strict';
// 직접 만든 ZIP 읽기 (명세 selective-sync.md 9.5.2절 — 새 의존성 없음, Node 내장 zlib 만). 디스크에 쓰지 않고 메모리 버퍼만 다룬다.
// 거부(모두 ExtractError local_unreadable): ZIP64 표지(0xFFFF · 0xFFFFFFFF · ZIP64 끝 레코드) · 여러 디스크 · 암호(일반 플래그 bit 0) ·
// 압축 방법 0(저장) · 8(deflate) 밖 · 위치 · 길이가 파일 밖 · 로컬 머리와 중앙 디렉터리의 이름 길이 다름 · 항목 5,000개 넘음 ·
// 같은 이름 두 번 · 선언 크기 64MB 넘음 · 선언 비율 200배 넘음 · 풀린 합계 256MB 넘음 · 실제 크기 ≠ 선언 · CRC 다름.
// 압축 폭탄: inflateRawSync 의 maxOutputLength = min(선언 크기, 64MB) — 선언을 속여도 실제 출력이 상한을 넘지 못함(넘으면 RangeError).
// 필요한 항목만 이름으로 골라 풂(이름은 비교에만 쓰고 경로로 쓰지 않음), 안의 ZIP 은 풀지 않음.

const zlib = require('node:zlib');
const { LIMITS, ExtractError } = require('./kinds');

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

const bad = (why) => new ExtractError('local_unreadable', `zip: ${why}`);

let CRC_TABLE = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0; // Node 22.2+ (Electron 44 = Node 24)
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 끝 64KB + 22바이트에서 EOCD 를 찾음(주석 길이가 끝과 맞는 것) */
function findEocd(buf) {
  const min = Math.max(0, buf.length - (65535 + 22));
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD && i + 22 + buf.readUInt16LE(i + 20) === buf.length) return i;
  }
  return -1;
}

/** 중앙 디렉터리 → [{name, flags, method, crc, csize, usize, offset, nameLen}] */
function listEntries(buf, limits = LIMITS) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw bad('too short');
  const e = findEocd(buf);
  if (e < 0) throw bad('no end record');
  if (e >= 20 && buf.readUInt32LE(e - 20) === SIG_ZIP64_LOCATOR) throw bad('zip64');
  const disk = buf.readUInt16LE(e + 4);
  const cdDisk = buf.readUInt16LE(e + 6);
  const onDisk = buf.readUInt16LE(e + 8);
  const total = buf.readUInt16LE(e + 10);
  const cdSize = buf.readUInt32LE(e + 12);
  const cdOff = buf.readUInt32LE(e + 16);
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw bad('multi disk');
  if (total === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) throw bad('zip64');
  if (total > limits.zipMaxEntries) throw bad('too many entries');
  if (cdOff + cdSize > e) throw bad('directory out of range');
  const out = [];
  let p = cdOff;
  for (let i = 0; i < total; i++) {
    if (p + 46 > cdOff + cdSize || buf.readUInt32LE(p) !== SIG_CEN) throw bad('bad directory');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const startDisk = buf.readUInt16LE(p + 34);
    const offset = buf.readUInt32LE(p + 42);
    if (csize === 0xffffffff || usize === 0xffffffff || offset === 0xffffffff || startDisk === 0xffff) throw bad('zip64');
    if (startDisk !== 0) throw bad('multi disk');
    if (flags & 0x1) throw bad('encrypted');
    const end = p + 46 + nameLen + extraLen + commentLen;
    if (end > cdOff + cdSize) throw bad('bad directory');
    const raw = buf.subarray(p + 46, p + 46 + nameLen);
    const name = flags & 0x800 ? raw.toString('utf8') : raw.toString('latin1');
    out.push({ name, flags, method, crc, csize, usize, offset, nameLen });
    p = end;
  }
  return out;
}

/**
 * 고른 항목만 풂 → Map(이름 → Buffer). want(name) 이 참인 항목만(디렉터리 · 그 밖 항목은 읽지 않음).
 * 상한 · 거부는 머리 주석. 실패하면 ExtractError(local_unreadable).
 */
function readZip(buf, want, limits = LIMITS) {
  const entries = listEntries(buf, limits);
  const out = new Map();
  let total = 0;
  for (const en of entries) {
    if (en.name.endsWith('/') || !want(en.name)) continue;
    if (out.has(en.name)) throw bad('duplicate name');
    if (en.method !== 0 && en.method !== 8) throw bad('method');
    if (en.usize > limits.zipMaxEntryBytes) throw bad('entry too big');
    if (en.usize > 0 && (en.csize === 0 || en.usize / en.csize > limits.zipMaxRatio)) throw bad('ratio');
    if (en.method === 0 && en.csize !== en.usize) throw bad('stored size');
    total += en.usize;
    if (total > limits.zipMaxTotalBytes) throw bad('total too big');
    const o = en.offset;
    if (o + 30 > buf.length || buf.readUInt32LE(o) !== SIG_LOC) throw bad('local header');
    const lNameLen = buf.readUInt16LE(o + 26);
    const lExtraLen = buf.readUInt16LE(o + 28);
    if (lNameLen !== en.nameLen) throw bad('name length');
    const start = o + 30 + lNameLen + lExtraLen;
    const end = start + en.csize;
    if (end > buf.length) throw bad('data out of range');
    const data = buf.subarray(start, end);
    let plain;
    if (en.method === 0) plain = Buffer.from(data);
    else {
      try {
        plain = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, Math.min(en.usize, limits.zipMaxEntryBytes)) });
      } catch { throw bad('inflate'); } // RangeError(출력 상한) 포함
    }
    if (plain.length !== en.usize) throw bad('size mismatch');
    if (crc32(plain) !== en.crc >>> 0) throw bad('crc');
    out.set(en.name, plain);
  }
  return out;
}

module.exports = { readZip, listEntries, crc32 };
