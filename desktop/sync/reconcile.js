'use strict';
// 세 갈래 비교 (명세 6.4 · 6.5절) — 순수 함수. J = 저널(마지막으로 맞춘 상태), L = PC 지금(검사 결과), S = 서버 최신(스냅숏 + 피드).
// 결과는 "할 일" 목록뿐이고 실행 · 대량 삭제 검사 · 5초 대기는 engine.js 가 한다.
// 짝 맞추기: 파일 ID(ino) → 같은 상대 경로(대소문자 무시) → 크기 · 해시(복사 후 원본 삭제) 순서 (K-5 · 9.3절).
// 같은 상대 경로에서 ino 만 바뀐 것(안전 저장)은 경로 짝으로 맞춰져 "내용 비교"로 간다.
//
// J = {files: {pid: {rel, sha256, size, mtime_ms, ino, kind}}, folders: {fid: {rel, ino}}, swapping: {키: {rel, sha256}}, modeFails: {pid: reason}}
// L = {files: [{rel, key, size, mtime_ms, ino, sha256|null(아직 안정되지 않음)}], dirs: [{rel, key, ino}], excluded: {files, dirs}(제외 · 건너뜀 — 보류)}
// S = {folders: Map(fid → {id, name, parent_id, sync_mode}), papers: Map(pid → {id, folder_id, file_name, sha256, size, kind, storage, holder,
//      holderGone, pending}), trashed: Map(pid → {sha256, label}), gonePapers: Set(pid), goneFolders: Set(fid)}
//
// 선택 동기화(selective-sync.md 8.3절 — 프로토콜 2에서만): 로컬 항목(storage 'local')은 보관 PC(holder)에만 파일이 있다.
// 보관 PC = 나(opts.me): 받지 않고 내용이 바뀌면 메타데이터만 올림(upload_content local) · 켜기 대기면 promote.
// 보관 PC = 남: 받지 않고, 저널에 있던 사본은 Windows 휴지통(trash_local moved_local — 대량 검사 · L = J = S 일 때만),
// 보관 PC가 그 뒤 고친 판이면 이 PC 사본은 두고 문제 목록(elsewhere_old), 여기서 고친 사본은 새 항목.
// 끄기 대기(cloud + to_local) · 보관 = 나: 파일이 서버와 같으면 mode_ack, 받을 수 없으면 mode_fail(같은 이유 한 번만).
// 표현 바뀜(서버 이름의 확장자 ≠ 저널 · 해시도 다름 — D-8): swap_rep(원본을 새 이름으로 받고 옛 변환본은 휴지통).
// PC 새 파일: 그 위치의 실효 모드(effectiveMode)가 끔이면 add_local(올리지 않음), 아니면 upload_new.

const P = require('./paths');
const { extOf } = require('./filekind');

/** 실효 모드(5.2절): 폴더 설정을 따라 올라가 처음 만나는 inherit 아닌 값, 루트까지 없으면 'cloud'(D-11). 순환은 방문 집합으로 막음 */
function effectiveMode(S, folderId) {
  const seen = new Set();
  let fid = folderId;
  while (fid != null) {
    const f = S.folders.get(Number(fid));
    if (!f || seen.has(f.id)) break;
    seen.add(f.id);
    if (f.sync_mode === 'cloud' || f.sync_mode === 'local') return f.sync_mode;
    fid = f.parent_id;
  }
  return 'cloud';
}

/** rel 이 들어 있는 서재 폴더 id(저널 폴더 중 가장 가까운 조상, 루트면 null) */
function folderIdFor(J, rel) {
  let dir = P.parentRel(rel);
  while (dir) {
    const k = P.fold(dir);
    for (const [fid, f] of Object.entries(J.folders || {})) if (P.fold(f.rel) === k) return Number(fid);
    dir = P.parentRel(dir);
  }
  return null;
}

function folderRel(S, fid, seen = new Set()) {
  if (fid == null) return '';
  const f = S.folders.get(Number(fid));
  if (!f || seen.has(f.id) || P.nameProblem(f.name)) return null;
  seen.add(f.id);
  const parent = folderRel(S, f.parent_id, seen);
  return parent == null ? null : P.joinRel(parent, f.name);
}

function paperRel(S, p) {
  if (!p || P.nameProblem(p.file_name, { file: true })) return null;
  const dir = folderRel(S, p.folder_id);
  return dir == null ? null : P.joinRel(dir, p.file_name);
}

const same = (a, b) => P.nfc(a) === P.nfc(b);
/** 보관 PC 이름(서버 holder_name — normPaper): 확인 창 · 알림의 label('' = 모름 — 화면은 "다른 PC") */
const holderName = (sp) => (sp && sp.holder_name) || '';
/** 문제 목록 항목에 붙일 {label} — 이름을 모르면 붙이지 않음 */
const holderLabel = (sp) => (holderName(sp) ? { label: holderName(sp) } : {});

/** 파일 · 디렉터리 짝 맞추기: ino → 경로 키. → Map(id → L 항목), 남은 L.
 *  confirm(j, l): 다른 경로의 같은 ino 를 이동으로 받아들일지(파일은 해시가 같거나 아직 모를 때만 — K-44, 모르면 이번엔 보류) */
function matchByIdAndPath(jmap, items, confirm = () => true) {
  const byIno = new Map();
  const byKey = new Map();
  for (const it of items) { if (it.ino) byIno.set(it.ino, it); byKey.set(it.key, it); }
  const claimed = new Set();
  const match = new Map();
  for (const [id, j] of Object.entries(jmap)) {
    const l = j.ino && byIno.get(j.ino);
    if (l && !claimed.has(l) && (l.key === P.fold(j.rel) || confirm(j, l))) { match.set(Number(id), l); claimed.add(l); }
  }
  for (const [id, j] of Object.entries(jmap)) {
    if (match.has(Number(id))) continue;
    const l = byKey.get(P.fold(j.rel));
    if (l && !claimed.has(l)) { match.set(Number(id), l); claimed.add(l); }
  }
  return { match, rest: items.filter((it) => !claimed.has(it)) };
}

// ---------------------------------------------------------------------------------------- 폴더 (6.5)
/**
 * → [{t:'link_dir', fid, rel, ino} | {t:'mkdir', fid, rel} | {t:'folder_create', rel, ino, replace?} |
 *     {t:'folder_update', fid, rel} | {t:'move_dir', fid, from, to} | {t:'drop_dir', fid}], problems
 * 얕은 것부터. 실행기는 조건(부모 · 대상 자리)을 다시 확인하고, 맞지 않으면 다음 검사로 미룬다.
 */
function planFolders(J, L, S, { root } = {}) {
  const acts = [];
  const problems = [];
  const { match, rest } = matchByIdAndPath(J.folders, L.dirs);
  for (const [k, j] of Object.entries(J.folders)) {
    const fid = Number(k);
    const l = match.get(fid);
    const sf = S.folders.get(fid);
    if (!l) {
      if (!sf) acts.push({ t: 'drop_dir', fid }); // PC 도 서버도 없음(묘비 · 사라짐) — 서버 쪽 지움은 파일 단계 끝(빈 뒤)
      continue;
    }
    if (!sf) {
      if (!S.goneFolders.has(fid)) acts.push({ t: 'folder_create', rel: l.rel, ino: l.ino, replace: fid }); // 서버에 아예 없음(되돌림) → 다시 만듦(K-23)
      continue; // 묘비 → 비면 지움(파일 단계)
    }
    const sRel = folderRel(S, fid);
    if (l.rel !== j.rel) acts.push({ t: 'folder_update', fid, rel: l.rel }); // PC 에서 이름 · 위치 바뀜(둘 다 바뀌면 도착 순서 — 우리가 나중)
    else if (sRel != null && !same(sRel, j.rel)) acts.push({ t: 'move_dir', fid, from: j.rel, to: sRel });
    else if (sRel == null) problems.push({ code: 'bad_name_server', rel: j.rel });
  }
  const restByKey = new Map(rest.map((d) => [d.key, d]));
  const linked = new Set();
  const newS = [...S.folders.values()].filter((f) => !Object.prototype.hasOwnProperty.call(J.folders, String(f.id)));
  for (const f of newS) {
    const rel = folderRel(S, f.id);
    if (rel == null) { problems.push({ code: 'bad_name_server', rel: f.name }); continue; }
    const l = restByKey.get(P.fold(rel));
    if (l) { acts.push({ t: 'link_dir', fid: f.id, rel: l.rel, ino: l.ino }); linked.add(l); continue; }
    if (root && P.fullLength(root, rel) > P.MAX_PATH) { problems.push({ code: 'too_long_down', rel }); continue; }
    acts.push({ t: 'mkdir', fid: f.id, rel });
  }
  for (const d of rest) if (!linked.has(d)) acts.push({ t: 'folder_create', rel: d.rel, ino: d.ino });
  const order = { drop_dir: 0, link_dir: 1, folder_update: 2, move_dir: 2, mkdir: 3, folder_create: 3 };
  acts.sort((a, b) => order[a.t] - order[b.t] || P.depth(a.rel || a.from || '') - P.depth(b.rel || b.from || ''));
  return { acts, problems };
}

// ---------------------------------------------------------------------------------------- 파일 (6.4)
/**
 * opts = {place: 'local' | 'library', root, me, proto, forceCloud}
 * place: PC 새 파일과 서재 논문의 해시가 같고 위치가 다를 때 — 'local' = 서재 논문을 PC 위치로(file.move),
 *        'library' = PC 파일을 서재 위치로(K-13). 평소(첫 연결 뒤)는 'local'(나중에 넣은 쪽 위치 — 10.2절).
 * me = 이 PC 기기 id, proto = 서버 동기화 프로토콜(1 = 옛 서버 — 선택 동기화 줄을 만들지 않음),
 * forceCloud = Set(`${접는 경로}\n${해시}`) — 서버가 upload_required 를 준 새 파일(다음 바퀴는 올림 — 8.3절 끝 줄).
 */
function planFiles(J, L, S, { place = 'local', root, me = null, proto = 1, forceCloud = new Set() } = {}) {
  const acts = [];
  const problems = [];
  const v2 = proto >= 2;
  const isLocal = (sp) => v2 && !!sp && sp.storage === 'local';
  const mine = (sp) => sp.holder != null && me != null && Number(sp.holder) === Number(me);
  const pendingLocalMine = (sp) => v2 && !!sp && sp.storage !== 'local' && sp.pending === 'to_local' && mine(sp);
  const modeFails = J.modeFails || {};
  const modeFail = (sp, reason) => { if (modeFails[sp.id] !== reason) acts.push({ t: 'mode_fail', pid: sp.id, reason }); };
  // 표현 바꾸기 중인 옛 파일(J.swapping) — 새 파일로 읽지 않음(엔진이 휴지통으로 보냄)
  const swapKeys = new Map(Object.values(J.swapping || {}).map((x) => [P.fold(x.rel), x.sha256]));
  const swappingNow = (l) => swapKeys.has(l.key) && (l.sha256 == null || swapKeys.get(l.key) === l.sha256);
  /** PC 새 파일: 그 위치가 끔이면 올리지 않는 로컬 항목(서버가 다시 판정 — upload_required 면 다음 바퀴 올림) */
  const newFileAct = (l) => {
    const local = v2 && effectiveMode(S, folderIdFor(J, l.rel)) === 'local' && !forceCloud.has(`${l.key}\n${l.sha256}`);
    return { t: local ? 'add_local' : 'upload_new', rel: l.rel, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms };
  };
  let { match, rest } = matchByIdAndPath(J.files, L.files, (j, l) => l.sha256 == null || l.sha256 === j.sha256);
  // 복사 후 원본 삭제 · 바꿔치기 저장: 짝 없는 J 와 같은 크기 · 해시의 새 파일
  const unmatched = Object.keys(J.files).map(Number).filter((pid) => !match.has(pid));
  if (unmatched.length && rest.length) {
    const bySha = new Map();
    for (const l of rest) if (l.sha256 && !bySha.has(l.sha256)) bySha.set(l.sha256, l);
    const used = new Set();
    for (const pid of unmatched) {
      const j = J.files[pid];
      const l = bySha.get(j.sha256);
      if (l && !used.has(l) && l.size === j.size) { match.set(pid, l); used.add(l); }
    }
    rest = rest.filter((l) => !used.has(l));
  }
  // 지금 있지만 제외 · 건너뜀으로 바뀐 것(0바이트 · 임시 이름 · 이름 길이 · 링크 · 대소문자 겹침 · 그 폴더 안) — 사라짐이 아니라 보류
  // (12.1-3 삭제는 명시적 신호로만). 같은 경로 · 파일 ID · 제외된 폴더(경로 또는 J 폴더의 ID) 안이면 보류
  const ex = L.excluded || { files: [], dirs: [] };
  const exIno = new Set([...ex.files, ...ex.dirs].map((x) => x.ino).filter(Boolean));
  const exKeys = new Set(ex.files.map((x) => P.fold(x.rel)));
  const exDirs = ex.dirs.map((x) => x.rel).concat(Object.values(J.folders || {}).filter((f) => f.ino && exIno.has(f.ino)).map((f) => f.rel));
  const excludedNow = (rel, ino) => (!!ino && exIno.has(ino)) || exKeys.has(P.fold(rel)) || exDirs.some((d) => P.fold(rel) === P.fold(d) || P.isUnder(rel, d));
  const live = new Set(); // 이 PC 에 연결된 논문
  for (const [k, j] of Object.entries(J.files)) {
    const pid = Number(k);
    const l = match.get(pid);
    const sp = S.papers.get(pid);
    const st = S.trashed.get(pid);
    const gone = S.gonePapers.has(pid);
    live.add(pid);
    const elsewhere = isLocal(sp) && !mine(sp); // 다른 PC에만 두기로 한 항목
    if (!l) {
      if (excludedNow(j.rel, j.ino)) continue; // 보류 — 서버에도 PC 에도 아무것도 하지 않음
      if (elsewhere) { acts.push({ t: 'drop', pid }); continue; } // 이 PC 사본이 사라짐 — 서재 항목은 보관 PC 것이라 지우지 않음
      if (st || gone || !sp) acts.push({ t: 'drop', pid });            // 둘 다 없음 · 서버에도 없음
      else if (sp.sha256 !== j.sha256 && !isLocal(sp)) { // 사라짐 vs 내용 바뀜 → 받기(바뀐 쪽이 이김). 로컬 항목(보관 = 나)은 받을 곳이 없어 지움 신호
        acts.push({ t: 'drop', pid });
        const rel = paperRel(S, sp);
        if (rel != null) acts.push({ t: 'download', pid, rel, replace: false, sha256: sp.sha256, size: sp.size });
      }
      else acts.push({ t: 'srv_delete', pid, base: j.sha256, rel: j.rel }); // 대량 삭제 검사 · 5초 대기는 엔진
      continue;
    }
    if (l.sha256 == null) continue; // 아직 안정되지 않음 — 이 파일은 이번에 아무것도 하지 않음
    const lChanged = l.sha256 !== j.sha256;
    const meta = l.size !== j.size || l.mtime_ms !== j.mtime_ms || l.ino !== j.ino || l.rel !== j.rel;
    if (st || gone) {
      if (lChanged && st) acts.push({ t: 'upload_content', pid, rel: l.rel, base: j.sha256, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms }); // 서버가 되살리고 교체
      else if (lChanged) acts.push({ t: 'upload_new', rel: l.rel, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms, dropPid: pid });
      else acts.push({ t: 'trash_local', pid, rel: l.rel, label: st ? st.label || '' : '' }); // 대량 삭제 검사는 엔진
      continue;
    }
    if (!sp) { // J · L 에 있는데 서버에 아예 없음(휴지통도 묘비도 아님) → 지우지 않고 다시 올림 (K-23)
      acts.push({ t: 'upload_new', rel: l.rel, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms, dropPid: pid });
      continue;
    }
    if (elsewhere) {
      if (sp.holderGone && !lChanged) { // 보관 PC가 해지됨 · 없어짐 → 같은 파일을 가진 이 PC가 넘겨받음(서버 adopted — D-9)
        acts.push({ t: 'add_local', rel: l.rel, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms });
      } else if (lChanged) { // 여기서 고친 사본 → 새 항목(그 위치 실효 모드대로) + 알림
        acts.push({ ...newFileAct(l), dropPid: pid, note: 'local_kept_new' });
      } else if (sp.sha256 === j.sha256) acts.push({ t: 'trash_local', pid, rel: l.rel, label: holderName(sp), reason: 'moved_local' }); // 대량 검사 · 확인 창은 엔진(D-4 — ‘연구실 PC’)
      else problems.push({ code: 'elsewhere_old', rel: l.rel, ...holderLabel(sp) }); // 보관 PC가 그 뒤 고침 — 이 PC 사본은 다른 판이라 지우지 않고 그대로(사용자가 정함)
      continue;
    }
    const sRel = paperRel(S, sp);
    // 표현 바뀜(D-8): 옛 변환본(X.pdf) → 원본(X.docx). 내용도 다를 때만(같은 해시면 이름만 바뀐 것 — 옮기기)
    if (v2 && !isLocal(sp) && sRel != null && extOf(sp.file_name) !== extOf(j.rel) && sp.sha256 !== j.sha256) {
      if (lChanged) { // 옛 변환본을 여기서 고쳤음 → 고친 파일은 새 항목으로 남기고 새 원본은 따로 받음
        acts.push({ t: 'upload_new', rel: l.rel, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms, dropPid: pid });
        if (!L.files.some((x) => x.key === P.fold(sRel))) acts.push({ t: 'download', pid, rel: sRel, replace: false, sha256: sp.sha256, size: sp.size });
      } else acts.push({ t: 'swap_rep', pid, from: l.rel, to: sRel, oldSha: j.sha256, sha256: sp.sha256, size: sp.size });
      continue;
    }
    if (sRel == null) problems.push({ code: 'bad_name_server', rel: l.rel });
    const lMoved = l.rel !== j.rel;
    const sMoved = sRel != null && !same(sRel, j.rel);
    const sChanged = sp.sha256 !== j.sha256;
    if (lMoved && (sRel == null || !same(sRel, l.rel))) { acts.push({ t: 'srv_move', pid, rel: l.rel }); continue; }
    if (!lMoved && sMoved) { acts.push({ t: 'local_move', pid, from: l.rel, to: sRel }); continue; }
    if (lChanged && l.sha256 === sp.sha256) { acts.push({ t: 'refresh', pid, rel: l.rel, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms, ino: l.ino }); continue; }
    if (lChanged || (isLocal(sp) && sChanged)) { // 로컬 항목(보관 = 나)은 업로드 없이 메타데이터만 — 서버가 다른 해시를 알면 이 PC 파일 기준으로 맞춤
      acts.push({ t: 'upload_content', pid, rel: l.rel, base: j.sha256, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms, ...(isLocal(sp) ? { local: true } : {}) });
      continue;
    }
    if (sChanged) { acts.push({ t: 'download', pid, rel: l.rel, replace: true, sha256: sp.sha256, size: sp.size }); continue; }
    if (meta) acts.push({ t: 'refresh', pid, rel: l.rel, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms, ino: l.ino });
    if (isLocal(sp) && sp.pending === 'to_cloud') acts.push({ t: 'promote', pid, rel: l.rel, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms }); // 켜기(5.3)
    else if (pendingLocalMine(sp)) acts.push({ t: 'mode_ack', pid, sha256: sp.sha256 }); // 끄기 확인(D-2) — 같은 해시의 파일을 가졌음
  }
  // 서버 쪽: 같은 해시 논문 중 가장 작은 id 만 PC 파일로 (7.2-4)
  const liveBySha = new Map();
  for (const sp of [...S.papers.values()].sort((a, b) => a.id - b.id)) {
    if (!sp.sha256) continue;
    if (!liveBySha.has(sp.sha256)) liveBySha.set(sp.sha256, sp);
  }
  const trashedBySha = new Map();
  for (const [pid, t] of S.trashed) if (t.sha256 && !trashedBySha.has(t.sha256)) trashedBySha.set(t.sha256, pid);
  const linkedNow = new Set();
  const seenNewSha = new Set();
  const placeTaken = new Set(L.files.map((l) => l.key));
  for (const l of rest) {
    if (l.sha256 == null || swappingNow(l)) continue;
    if (seenNewSha.has(l.sha256)) { problems.push({ code: 'duplicate_copy', rel: l.rel }); continue; }
    seenNewSha.add(l.sha256);
    const sp = liveBySha.get(l.sha256);
    if (sp && (live.has(sp.id) || linkedNow.has(sp.id))) { problems.push({ code: 'duplicate_copy', rel: l.rel }); continue; }
    if (sp && isLocal(sp) && !mine(sp)) { // 다른 PC에만 두기로 한 파일과 같음(D-9) — 보관 PC가 없어졌으면 넘겨받음(서버 adopted)
      linkedNow.add(sp.id);
      if (sp.holderGone) acts.push({ t: 'add_local', rel: l.rel, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms });
      else problems.push({ code: 'local_elsewhere', rel: l.rel, ...holderLabel(sp) });
      continue;
    }
    if (sp) {
      const sRel = paperRel(S, sp);
      linkedNow.add(sp.id);
      // J 위치를 정해 두면 다음 비교가 옮김을 만든다: library → J=PC 위치(서버 위치로 PC 파일을 옮김), local → J=서버 위치(file.move)
      const jRel = place === 'library' || sRel == null ? l.rel : sRel;
      acts.push({ t: 'link', pid: sp.id, rel: jRel, at: l.rel, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms, ino: l.ino });
      continue;
    }
    const tp = trashedBySha.get(l.sha256);
    if (tp != null) { acts.push({ t: 'restore', pid: tp, rel: l.rel, sha256: l.sha256, size: l.size, mtime_ms: l.mtime_ms }); continue; }
    acts.push(newFileAct(l));
  }
  for (const sp of liveBySha.values()) {
    if (live.has(sp.id) || linkedNow.has(sp.id)) continue;
    const rel = paperRel(S, sp);
    if (isLocal(sp)) { // 로컬 항목은 받지 않음 — 이 PC가 보관인데 파일이 없으면 문제 목록(받을 곳이 없음)
      if (mine(sp)) problems.push({ code: 'local_missing', rel: rel == null ? sp.file_name || '' : rel, ...holderLabel(sp) });
      continue;
    }
    if (rel == null) { problems.push({ code: 'bad_name_server', rel: sp.file_name || '' }); if (pendingLocalMine(sp)) modeFail(sp, 'missing'); continue; }
    if (root && P.fullLength(root, rel) > P.MAX_PATH) { problems.push({ code: 'too_long_down', rel }); if (pendingLocalMine(sp)) modeFail(sp, 'too_long'); continue; }
    if (placeTaken.has(P.fold(rel))) continue; // 그 자리에 다른 파일이 있음 — 그쪽이 먼저 정리된 뒤(K-8 이름 바꿈) 받음
    acts.push({ t: 'download', pid: sp.id, rel, replace: false, sha256: sp.sha256, size: sp.size });
  }
  // 폴더 지우기(자식 먼저): PC 에서 사라지고 J 안에 아무것도 남지 않은 폴더 → folder.delete,
  // 서버 묘비 · PC 에 남은 디렉터리 → 빈 디렉터리만 지움(남은 파일이 있으면 두고 문제 목록)
  const lDirKeys = new Set(L.dirs.map((d) => d.key));
  const jRels = [...Object.values(J.files).map((f) => f.rel), ...Object.values(J.folders).map((f) => f.rel)];
  const folderActs = [];
  for (const [k, jf] of Object.entries(J.folders)) {
    const fid = Number(k);
    if (jRels.some((r) => P.isUnder(r, jf.rel)) || excludedNow(jf.rel, jf.ino)) continue;
    const onPc = lDirKeys.has(P.fold(jf.rel));
    if (!onPc && S.folders.has(fid)) folderActs.push({ t: 'folder_delete', fid, rel: jf.rel });
    else if (onPc && S.goneFolders.has(fid) && !S.folders.has(fid)) folderActs.push({ t: 'rmdir', fid, rel: jf.rel });
  }
  folderActs.sort((a, b) => P.depth(b.rel) - P.depth(a.rel));
  return { acts: acts.concat(folderActs), problems };
}

module.exports = { folderRel, paperRel, planFolders, planFiles, matchByIdAndPath, effectiveMode, folderIdFor };
