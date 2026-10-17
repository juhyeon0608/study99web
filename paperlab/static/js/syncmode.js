// 선택 동기화(폴더 · 파일별 켜고 끄기) 화면 문구 · 결정 — 순수 함수만(DOM 없음). docs/specs/selective-sync.md 10장.
// 서버가 주는 sync 객체(10.1절 — 논문 목록 · 상세)와 폴더의 sync_mode · effective_mode(C-2)만 읽는다.
// ctx = { desktop: paperlabDesktop.info() 결과 | null, deviceId: 이 PC 기기 id | null, syncOn: 폴더 동기화를 켠 PC가 있는지
//         (/api/stats sync_on), has: localHas() 결과 {id: "here" | "missing"} | null }
// 웹 · 옛 앱(ctx.desktop 없음)은 언제나 "다른 곳" 화면 (C-3).

import { IMAGE_EXTS, extOf } from "./filetypes.js";
import { josa } from "./ui.js";

export const LOCAL_TIP = "서버에는 정보만 있어요 — 본문 검색 · 서버 AI에서 빠져요";
export const FOLDER_PC_TIP = "이 폴더의 새 파일은 PC에만 둬요";
export const MISMATCH_TIP = "옮기거나 웹에서 올려서 폴더 설정과 저장 위치가 달라요. 바꾸려면 [폴더 설정대로 맞추기]를 눌러 주세요.";
export const EXPLAIN_LOCAL_TEXT = "이 PC에만 있는 파일은 선택 설명 · 번역을 쓸 수 없어요. [동기화 켜기]로 서버에 올리면 쓸 수 있어요.";
export const SEARCH_LOCAL_HINT = "PC에만 둔 파일은 본문으로 찾지 않아요(제목 · 노트로는 찾아요)";
// 배지 · 폴더 표의 작은 PC 그림
export const ICON_PC = `<svg class="ico pc-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="11" rx="1.5"/><path d="M9 19.5h6M12 15.5v4"/></svg>`;
// 끌 수 있는 PC가 없음 (서버 400 no_sync_pc와 같은 문구 — [다른 PC 고르기]가 목록을 먼저 받을 때)
export const NO_SYNC_PC_TEXT = "폴더 동기화를 켠 PC(0.4.0 이상)가 없어 ‘PC에만’으로 바꿀 수 없어요. PC 앱에서 폴더 동기화를 먼저 켜 주세요.";
export const BACKUP_HELP = "PC에만 둔 파일은 그 PC에만 있어요. PC가 고장 나면 서재에서 되살릴 수 없으니 따로 백업해 주세요.";

const q = (name) => `‘${name}’`;
const GONE_TIP = "연결을 해지한 PC에만 있던 파일이에요. 파일이 있으면 [파일 다시 올리기]로 올려 주세요.";

// 크기: 1MB 미만 KB, 10MB 미만 소수 한 자리(2.1MB), 그 위는 정수 MB, 1GB부터 GB
export function sizeText(n) {
  const b = Math.max(0, Number(n) || 0);
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))}KB`;
  if (b < 10 * 1024 ** 2) return `${(b / 1024 ** 2).toFixed(1).replace(/\.0$/, "")}MB`;
  if (b < 1024 ** 3) return `${Math.round(b / 1024 ** 2)}MB`;
  return `${(b / 1024 ** 3).toFixed(1).replace(/\.0$/, "")}GB`;
}

const holderOf = (s) => (s && s.holder) || null;
// 보관 PC가 해지됐거나 없어짐 (기기 행이 지워지면 holder = null)
export const holderGone = (s) => !holderOf(s) || !!holderOf(s).gone;
// 보관 PC 이름 (없으면 "다른 PC")
export const holderName = (s) => (holderOf(s) && holderOf(s).name) || "다른 PC";

// 이 PC가 보관 PC인지 — PC 앱 창 안에서만(웹은 언제나 아님)
export function isHere(s, ctx = {}) {
  const h = holderOf(s);
  return !!(ctx.desktop && ctx.deviceId != null && h && !h.gone && Number(h.id) === Number(ctx.deviceId));
}

// 이 PC에서 로컬 파일을 열 수 있는 창인지. ctx.bridge = paperlabDesktop.localFile이 있음
// (C-3: 없으면 웹 · 옛 앱 — 다른 곳 화면)
export const canOpenHere = (paper, ctx = {}) =>
  !!(paper && paper.sync && paper.sync.storage === "local" && ctx.bridge === true && isHere(paper.sync, ctx));

export const isLocal = (paper) => !!(paper && paper.sync && paper.sync.storage === "local");

// 읽기 화면 종류: PDF · 사진은 앱 안에서, 그 밖(워드 · 한글 · PPT · 엑셀)은 PC 기본 앱으로 (D-5)
export function readerKind(paper) {
  const ext = extOf((paper && (paper.file_name || paper.source_name)) || "");
  if (ext === ".pdf") return "pdf";
  if (IMAGE_EXTS.includes(ext)) return "image";
  return "doc";
}

// ------------------------------------------------------------------ 배지 (10.2절)
// {text, tone: "local" | "warn" | "pending", title} 또는 null(켬 — 지금과 같음). 폴더 설정과 다름은 mismatchBadge
export function badgeFor(paper, ctx = {}) {
  const s = paper && paper.sync;
  if (!s) return null; // 옛 서버(배지 없음 — 13장 5)
  const here = isHere(s, ctx);
  const name = holderName(s);
  // 올리던 중 보관 PC가 해지됨: 올릴 PC가 없음 — 로컬 · 해지와 같게 (12장, [파일 다시 올리기])
  if (s.pending === "to_cloud" && holderGone(s)) return { text: "파일 없음 (연결 해지된 PC)", tone: "warn", title: GONE_TIP };
  if (s.pending && (s.pending_error || (s.pending === "to_local" && holderGone(s)))) {
    return { text: "확인 필요", tone: "warn", title: pendingErrorText(s) };
  }
  if (s.pending === "to_local") {
    return { text: here ? "PC에만으로 바꾸는 중" : `PC에만으로 바꾸는 중 (${name} 대기)`, tone: "pending",
      title: `${josa(q(name), "이/가")} 파일을 가지고 있는지 확인하면 서버의 파일을 지워요` };
  }
  if (s.pending === "to_cloud") {
    return { text: here ? "서버에 올리는 중" : `서버에 올리는 중 (${name} 대기)`, tone: "pending",
      title: `${josa(q(name), "이/가")} 켜지면 파일을 서버에 올려요` };
  }
  if (s.storage !== "local") return null;
  if (holderGone(s)) return { text: "파일 없음 (연결 해지된 PC)", tone: "warn", title: GONE_TIP };
  if (here) {
    if (ctx.has && ctx.has[paper.id] === "missing") {
      return { text: "이 PC에 파일 없음", tone: "warn", title: "이 PC의 동기화 폴더에서 파일을 찾지 못했어요. Windows 휴지통에서 되살리거나 같은 파일을 다시 넣어 주세요." };
    }
    return { text: "이 PC에만", tone: "local", title: LOCAL_TIP };
  }
  return { text: `${name}에만`, tone: "local", title: LOCAL_TIP };
}

export function mismatchBadge(paper) {
  const s = paper && paper.sync;
  return s && s.mismatch && !s.pending ? { text: "폴더 설정과 다름", tone: "mismatch", title: MISMATCH_TIP } : null;
}

// 끄기 확인을 마치지 못한 이유 (mode.fail reason · 보관 PC 해지) — 상세 · 배지 툴팁
const FAIL_TEXT = {
  missing: (n) => `${q(n)}에 이 파일이 없어요. 파일을 다시 받거나 [바꾸기 취소]를 눌러 주세요.`,
  changed_here: (n) => `${q(n)}에서 파일이 바뀌어 확인하지 못했어요. 맞춘 뒤 다시 확인해요.`,
  too_long: (n) => `파일 이름이나 경로가 너무 길어 ${q(n)}에 받을 수 없어요. 이름을 줄이거나 [바꾸기 취소]를 눌러 주세요.`,
  unreadable: (n) => `${q(n)}에서 파일을 읽지 못했어요. [바꾸기 취소]를 누르거나 잠시 뒤 다시 확인해요.`,
};

export function pendingErrorText(s) {
  if (!s) return "";
  if (s.pending === "to_local" && holderGone(s)) return "고른 PC가 해지됐어요. [취소]하거나 다른 PC를 골라 주세요.";
  const f = FAIL_TEXT[s.pending_error];
  return f ? f(holderName(s)) : `${q(holderName(s))}에서 확인하지 못했어요 (${s.pending_error || "알 수 없음"}).`;
}

// ------------------------------------------------------------- 상세 "저장 위치" 줄 (10.4절)
// {text, tone, actions: ["cancel" | "pick" | "align" | "reupload"]} 또는 null(파일 없는 켬 항목)
export function storageLine(paper, ctx = {}) {
  const s = paper && paper.sync;
  if (!s) return null;
  const name = holderName(s);
  const who = isHere(s, ctx) ? "이 PC" : q(name);
  if (s.pending === "to_cloud" && holderGone(s)) { // 올리던 중 보관 PC 해지 — 다시 올리거나 올리기를 취소 (12장)
    return { text: "연결이 해지된 PC에만 있던 파일이에요 — 서버에는 정보만 있어요", tone: "warn", actions: ["cancel", "reupload"] };
  }
  if (s.pending && (s.pending_error || (s.pending === "to_local" && holderGone(s)))) {
    return { text: `확인 필요 — ${pendingErrorText(s)}`, tone: "warn",
      actions: s.pending === "to_local" && holderGone(s) ? ["cancel", "pick"] : ["cancel"] };
  }
  if (s.pending === "to_local") {
    return { text: `${who}에만으로 바꾸는 중 — ${josa(who, "이/가")} 켜지면 서버의 파일을 지워요`, tone: "pending", actions: ["cancel"] };
  }
  if (s.pending === "to_cloud") {
    return { text: `서버에 올리는 중 — ${josa(who, "이/가")} 켜지면 올려요`, tone: "pending", actions: ["cancel"] };
  }
  if (s.storage === "local") {
    if (holderGone(s)) return { text: "연결이 해지된 PC에만 있던 파일이에요 — 서버에는 정보만 있어요", tone: "warn", actions: ["reupload"] };
    if (s.mismatch) return { text: "폴더 설정(서버에도 저장)과 달라요", tone: "mismatch", actions: ["align"], sub: `${who}에만 — 서버에는 정보만 있어요` };
    return { text: `${who}에만 — 서버에는 정보만 있어요`, tone: "local", actions: [] };
  }
  if (!s.has_file) return null;
  if (s.mismatch) return { text: "폴더 설정(PC에만)과 달라요", tone: "mismatch", actions: ["align"], sub: "서버 · 모든 PC(동기화 켬)" };
  return { text: "서버 · 모든 PC(동기화 켬)", tone: "", actions: [] };
}

// ------------------------------------------------------------- 메뉴 (10.3 · 10.4절)
// 항목 {act, label, mode?}. act: "to_local" | "to_cloud" | "inherit" | "align" | "cancel".
// mode = 서버 sync-mode 요청에 보낼 값 — 반대 방향 요청이 대기를 취소한다(5.3절)
const OFF = "동기화 끄기 — PC에만 두기…";
const ON = "동기화 켜기 — 서버에도 저장…";

export function paperMenu(paper, ctx = {}) {
  const s = paper && paper.sync;
  if (!s) return [];
  if (s.pending === "to_local") return [{ act: "cancel", label: "바꾸기 취소", mode: "cloud" }];
  if (s.pending === "to_cloud") return [{ act: "cancel", label: "바꾸기 취소", mode: "local" }];
  if (!ctx.syncOn) return [];
  const items = [];
  if (s.storage === "local") {
    if (!holderGone(s)) items.push({ act: "to_cloud", label: ON, mode: "cloud" });
  } else if (s.has_file) {
    items.push({ act: "to_local", label: OFF, mode: "local" });
  }
  if (s.mismatch && !(s.storage === "local" && holderGone(s))) items.push({ act: "align", label: "폴더 설정대로 맞추기", mode: "inherit" });
  if (s.mode && s.mode !== "inherit") items.push({ act: "inherit", label: "폴더 설정 따르기", mode: "inherit" });
  return items;
}

// 여러 개 선택 막대 — 같은 두 항목
export function bulkMenu(ctx = {}) {
  if (!ctx.syncOn) return [];
  return [{ act: "to_local", label: "PC에만 두기…", mode: "local" }, { act: "to_cloud", label: "서버에도 저장…", mode: "cloud" }];
}

export function folderMenu(folder, ctx = {}) {
  if (!folder || !ctx.syncOn || !folder.effective_mode) return [];
  const items = [folder.effective_mode === "local" ? { act: "to_cloud", label: ON, mode: "cloud" } : { act: "to_local", label: OFF, mode: "local" }];
  if (folder.sync_mode && folder.sync_mode !== "inherit") items.push({ act: "inherit", label: "위 폴더 설정 따르기", mode: "inherit" });
  return items;
}

// 폴더 트리의 작은 "PC" 표: 실효 끔일 때만. own = 이 폴더에 설정이 있음(진하게), 아니면 위에서 물려받음(흐리게)
export function folderMark(folder) {
  if (!folder || folder.effective_mode !== "local") return null;
  return { text: "PC", own: folder.sync_mode === "local",
    title: folder.sync_mode === "local" ? FOLDER_PC_TIP : `${FOLDER_PC_TIP} (위 폴더 설정을 따름)` };
}

// 서재 목록 머리 줄의 폴더 스위치 "서버에도 저장 [● 켬]"
export function folderSwitch(folder, ctx = {}) {
  if (!folder || !ctx.syncOn || !folder.effective_mode) return null;
  const on = folder.effective_mode !== "local";
  return { on, label: "서버에도 저장", state: on ? "켬" : "끔", mode: on ? "local" : "cloud",
    title: on ? "끄면 이 폴더의 파일을 PC에만 둬요" : "켜면 이 폴더의 파일을 서버에도 저장해요" };
}

// 폴더 id → 실효 모드 (서버 effective_mode가 있으면 그것, 없으면 상속 계산 — 루트는 언제나 켬, D-11)
export function folderEffective(fid, folders = []) {
  if (fid == null) return "cloud";
  const byId = new Map(folders.map((f) => [f.id, f]));
  const seen = new Set();
  for (let f = byId.get(fid); f && !seen.has(f.id); f = byId.get(f.parent_id)) {
    seen.add(f.id);
    if (f.effective_mode) return f.effective_mode;
    if (f.sync_mode && f.sync_mode !== "inherit") return f.sync_mode;
  }
  return "cloud";
}

// 하위 폴더 중 따로 설정한 것 수 (확인 창의 "하위 항목도" 체크 상자)
export function customChildFolders(fid, folders = []) {
  const kids = new Set([fid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (kids.has(f.parent_id) && !kids.has(f.id)) { kids.add(f.id); grew = true; }
  }
  kids.delete(fid);
  return folders.filter((f) => kids.has(f.id) && f.sync_mode && f.sync_mode !== "inherit").length;
}

// 옮긴 뒤 저장 위치가 새 폴더 설정과 달라질 논문 (D-3 — 옮기기는 저장 위치를 바꾸지 않음): 웹 이동 토스트의 [폴더 설정대로 맞추기]
export function moveMismatch(papers, toFolderId, folders = []) {
  const eff = folderEffective(toFolderId, folders);
  return (papers || []).filter((p) => {
    const s = p && p.sync;
    return s && !s.pending && (s.mode || "inherit") === "inherit" && (s.storage === "local" || s.has_file)
      && !(s.storage === "local" && holderGone(s)) && s.storage !== eff;
  }).map((p) => p.id);
}

// 파일 이름 뒤 조사는 확장자를 뺀 이름에 맞춤: "‘보고서.hwp’를" · "‘논문.pdf’을" (10.5절)
export function fileParticle(name) {
  const n = String(name || "");
  const stem = n.replace(/\.[A-Za-z0-9]{1,5}$/, "") || n;
  return josa(stem, "을/를").slice(stem.length);
}

// 켜기(to_cloud) 확인 창 · 토스트의 "올릴 PC" — 서버 응답에는 보관 PC가 없어서(끄기만 holder) 화면이 가진 논문 sync.holder로.
// 올릴 로컬 항목들의 보관 PC가 하나로 같을 때만 이름, 크기는 pdf_size + source_size 합(서버 bytes와 같은 셈)
// → {fromName, fromBytes, fromCount}
export function uploadSource(papers) {
  const up = (papers || []).filter((p) => p && p.sync && p.sync.storage === "local" && p.sync.pending !== "to_cloud" && !holderGone(p.sync));
  const names = [...new Set(up.map((p) => holderName(p.sync)))];
  const bytes = up.reduce((n, p) => n + (Number(p.pdf_size) || 0) + (Number(p.source_size) || 0), 0);
  return { fromName: names.length === 1 ? names[0] : "", fromBytes: bytes, fromCount: up.length };
}

// [다른 PC 고르기] (끄는 중 보관 PC가 해지됨 — 12장): 논문 자기 설정은 그대로 두고 보관 PC만 다시 고른다.
// inherit 논문에 local을 쓰면 뒤의 폴더 설정 변경을 따르지 않게 되므로 원래 값으로 보냄
export const pickMode = (paper) => (((paper && paper.sync && paper.sync.mode) || "inherit") === "inherit" ? "inherit" : "local");

// 보관 PC 라디오의 처음 고른 값: 이 PC(앱 창)가 목록에 있으면 이 PC, 하나뿐이면 그 PC, 아니면 고르기 전(null)
export function defaultHolder(holders, here) {
  const list = holders || [];
  if (here != null && list.some((h) => Number(h.id) === Number(here))) return Number(here);
  return list.length === 1 ? Number(list[0].id) : null;
}

// 논문 sync-mode 요청은 한 번에 200편까지(서버 400) — 나눠 보내고 응답 숫자를 합친다
export const SYNC_IDS_MAX = 200;
export function chunkIds(ids, size = SYNC_IDS_MAX) {
  const out = [];
  for (let i = 0; i < (ids || []).length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
export function mergeReplies(replies) {
  const out = { to_local: 0, to_cloud: 0, cancelled: 0, unchanged: 0, no_file: 0, freed_bytes: 0, overrides: 0, holder: null, other_pcs: [], blocked: [] };
  const pcs = new Map();
  for (const r of replies || []) {
    if (!r) continue;
    for (const k of ["to_local", "to_cloud", "cancelled", "unchanged", "no_file", "freed_bytes", "overrides"]) out[k] += Number(r[k]) || 0;
    if (r.bytes) out.bytes = (out.bytes || 0) + Number(r.bytes);
    if ("dry_run" in r) out.dry_run = r.dry_run;
    out.holder = out.holder || r.holder || null;
    out.blocked.push(...(r.blocked || []));
    for (const x of r.other_pcs || []) {
      const cur = pcs.get(x.id);
      pcs.set(x.id, cur ? { ...cur, files: cur.files + (x.files || 0) } : { ...x });
    }
  }
  out.other_pcs = [...pcs.values()];
  return out;
}

// 원본 정리(sync-originals) 전인 옛 문서 행: 서버가 끄지 않고 blocked needs_originals로 돌려줌 (7.2절 — 논문 설정도 그대로)
export const needsOriginalsCount = (r) => ((r && r.blocked) || []).filter((b) => b && b.code === "needs_originals").length;
export const needsOriginalsText = (n) => (Number(n) > 0
  ? `원본 정리 전인 문서 ${Number(n)}개는 아직 PC에만으로 바꿀 수 없어요 (관리자가 원본 정리를 마치면 돼요)` : "");

// ------------------------------------------------------------- 확인 창 문구 (10.5절)
// preview = 켜고 끄기 응답(dry_run). ctx.target = {type: "folder" | "file" | "files", name, count},
// ctx.mode = 요청한 mode, ctx.holderName = 고른 보관 PC 이름(보관 PC 라디오), ctx.fromName · fromBytes · fromCount = 켜기에서
// 올릴 PC 이름 · 크기(uploadSource — 서버 응답에 없을 때)
// → {title, lead, bullets[], warn, note, ok, dir: "off" | "on" | "none"}
export function confirmText(preview, ctx = {}) {
  const p = preview || {};
  const t = ctx.target || { type: "files", count: 0 };
  const off = (p.to_local || 0) > 0;
  const on = !off && (p.to_cloud || 0) > 0;
  const dir = off ? "off" : on ? "on" : "none";
  const holder = ctx.holderName || (p.holder && p.holder.name) || (ctx.desktop && ctx.desktop.deviceName) || "고른 PC";
  const H = q(holder);
  const subject = (verb) => t.type === "folder" ? `${q(t.name)} 폴더를 ${verb}`
    : t.type === "file" ? `${q(t.name)}${fileParticle(t.name)} ${verb}` : `선택한 파일 ${t.count || 0}개를 ${verb}`;
  const n = off ? p.to_local : p.to_cloud || 0;
  // 올릴 크기: 서버 bytes(있으면) → 고른 논문들의 크기 합(올릴 편수와 같을 때만 — 일부만 올리면 합이 틀림)
  const upBytes = p.bytes || (ctx.fromBytes && ctx.fromCount === p.to_cloud ? ctx.fromBytes : 0);
  const size = off && p.freed_bytes ? sizeText(p.freed_bytes) : on && upBytes ? sizeText(upBytes) : "";
  // 조사는 괄호 앞 낱말에 맞춤: "이 파일(2.1MB)을" · "파일 12개(48MB)를"
  const what = t.type === "file" ? `이 파일${size ? `(${size})` : ""}을`
    : `${t.type === "folder" ? "이 폴더의 " : ""}파일 ${n}개${size ? `(${size})` : ""}를`;
  const warn = ctx.mode === "local" || off
    ? `${josa(H, "이/가")} 고장 나거나 그 PC에서 파일이 지워지면 서재에서 이 파일을 되살릴 수 없어요. 서재에는 정보 · 노트 · 하이라이트만 남아요. 중요한 파일은 따로 백업해 두세요.`
    : "";
  const tail = [];
  const held = needsOriginalsCount(p);
  if (held > 0) tail.push(needsOriginalsText(held));
  if ((p.cancelled || 0) > 0) tail.push(`바꾸던 파일 ${p.cancelled}개는 바꾸기를 취소하고 지금 위치에 그대로 둬요.`);
  if ((p.no_file || 0) > 0) tail.push(`파일이 없는 ${p.no_file}편은 설정만 바뀌어요.`);
  if (off) {
    const bullets = [
      `서버 본문 검색 · 서재 질문 · 선택 설명 · 번역에서 빠지고, AI 요약 · 질문은 ${H}의 AI로만 돼요.`,
      ...(p.other_pcs || []).filter((x) => x && x.files > 0).map((x) => t.type === "file"
        ? `${q(x.name)}에 있는 이 파일은 Windows 휴지통으로 옮겨져요.`
        : `${q(x.name)}에 있는 이 파일 ${x.files}개는 Windows 휴지통으로 옮겨져요.`),
      "지금까지 만든 AI 요약 · 대화 · 설명 기록과 하이라이트한 글은 그대로 남아요.",
      `서버 파일은 ${josa(H, "이/가")} 파일을 가지고 있는지 확인한 뒤에 지워요.`,
      ...tail,
    ];
    return { dir, title: subject("PC에만 둘까요?"), lead: `${what} 서버에서 지우고 ${H}에만 둬요. 제목 · 저자 · 노트 · 하이라이트 · 태그는 서버에 남아요.`,
      bullets, warn, note: "", ok: "PC에만 두기" };
  }
  if (on) {
    // 올릴 PC 이름: 서버 holder(있으면) → 고른 논문들의 보관 PC(ctx.fromName — 하나로 같을 때만) → 이름 없이
    const fromName = (p.holder && p.holder.name) || ctx.fromName || "";
    const from = fromName ? q(fromName) : "파일을 가진 PC";
    return { dir, title: subject("서버에도 저장할까요?"),
      lead: `${josa(from, "이/가")} ${what.replace(/^이 폴더의 /, "")} 서버에 올려요. 올리면 본문 검색 · 서버 AI · 다른 PC와 웹에서 읽기를 쓸 수 있어요. 다른 PC에도 파일이 내려가요.`,
      bullets: tail, warn: "", note: `(${josa(from, "이/가")} 꺼져 있으면 켜질 때 올려요.)`, ok: "서버에도 저장" };
  }
  // 논문 요청이 모두 원본 정리 전이라 막힘: 바뀌는 것이 없음 — 안내만 (dir "blocked": [확인] 단추 없이 닫기만)
  if (held > 0 && t.type !== "folder" && !(p.unchanged > 0) && !(p.no_file > 0) && !(p.cancelled > 0)) {
    return { dir: "blocked", title: "아직 PC에만으로 바꿀 수 없어요", lead: needsOriginalsText(held), bullets: [], warn: "", note: "", ok: "" };
  }
  // 옮길 파일이 없음: 설정만 바꿈(빈 폴더 · 이미 같은 위치)
  const local = ctx.mode === "local" || (ctx.mode === "inherit" && ctx.inheritEffective === "local");
  return { dir, title: t.type === "folder" ? `${q(t.name)} 폴더 설정을 바꿀까요?` : "동기화 설정을 바꿀까요?",
    lead: `지금 서버에서 지우거나 올릴 파일은 없어요. ${t.type === "folder" ? "앞으로 이 폴더에 새로 넣는 파일은 " : "이 설정은 "}${local ? `PC에만 둬요.` : "서버에도 저장해요."}`,
    bullets: tail, warn: local ? warn || `PC에만 둔 파일은 그 PC에만 있어요. PC가 고장 나면 서재에서 되살릴 수 없으니 중요한 파일은 따로 백업해 두세요.` : "",
    note: "", ok: "바꾸기" };
}

// 하위 항목 체크 상자 문구 (n을 모르면 개수 없이)
export const childrenLabel = (n) => n > 0 ? `안에서 따로 정한 폴더 · 파일 ${n}개도 이 설정으로 바꾸기` : "안에서 따로 정한 폴더 · 파일도 이 설정으로 바꾸기";

// 보관 PC 라디오 한 줄: "집 PC · 켜짐" / "연구실 PC · 마지막 접속 3시간 전"
export function holderOption(h, ago = (x) => x) {
  const tail = h.online ? "켜짐" : h.last_seen_at ? `마지막 접속 ${ago(h.last_seen_at)}` : "꺼짐";
  return `${h.name}${h.this_device ? " (이 PC)" : ""} · ${tail}`;
}

// 요청 뒤 토스트 (10.5절)
export function requestToast(result, ctx = {}) {
  const r = result || {};
  const held = needsOriginalsText(needsOriginalsCount(r));
  if (!held) return requestToastBase(r, ctx);
  // 원본 정리 전이라 막힌 문서가 있으면 그 줄을 덧붙임 — 그 밖에 바뀐 것이 없으면 그 줄만
  if (!(r.to_local > 0 || r.to_cloud > 0 || r.cancelled > 0 || r.unchanged > 0 || r.no_file > 0)) return held;
  const base = requestToastBase(r, ctx);
  return `${base}${base.endsWith(".") ? "" : "."} ${held}`;
}

function requestToastBase(r, ctx) {
  const holder = ctx.holderName || (r.holder && r.holder.name) || "고른 PC";
  if (r.to_local > 0) return `${r.to_local}개를 PC에만으로 바꾸는 중이에요. ${josa(q(holder), "이/가")} 확인하면 서버에서 지워요.`;
  if (r.to_cloud > 0) { // 켜기는 PC를 고르지 않음 — 올릴 PC 이름을 알 때만(ctx.fromName · 서버 holder), 아니면 이름 없이
    const from = (r.holder && r.holder.name) || ctx.fromName || "";
    return `${from ? josa(q(from), "이/가") : "파일을 가진 PC가"} ${r.to_cloud}개를 서버에 올리고 있어요.`;
  }
  if (r.cancelled > 0) return `${r.cancelled}개의 바꾸기를 취소했어요`;
  return "동기화 설정을 바꿨어요";
}

// 끄기 대기가 모두 끝난 것을 다음 새로 고침이 볼 때
export function doneToast({ count = 0, holder = "", bytes = 0 } = {}) {
  return `${count}개를 ${q(holder || "고른 PC")}에만 두었어요.${bytes ? ` 서버 공간 ${sizeText(bytes)}를 비웠어요.` : ""}`;
}

// 웹 업로드가 끔 폴더로 갔을 때 (5.4절)
export const uploadLocalFolderText = (folderName) =>
  `${q(folderName || "이")} 폴더는 PC에만 두는 폴더예요. 웹에서 올린 파일은 서버에 저장했어요`;

// ------------------------------------------------------------- 읽기 화면 · AI (9.3 · 10.6 · 10.9절)
const LOCAL_FILE_TEXT = {
  not_local: "이 PC가 보관하는 파일이 아니에요.",
  missing: "이 PC의 동기화 폴더에서 파일을 찾지 못했어요. 옮겼거나 지웠으면 Windows 휴지통에서 되살리거나 같은 파일을 다시 넣어 주세요.",
  changed: "파일을 고치는 중이에요. 저장을 마친 뒤 다시 열어 주세요.",
  too_big: "파일이 너무 커서(100MB 초과) 열 수 없어요.",
  path: "파일 위치가 동기화 폴더 규칙에 맞지 않아 열 수 없어요(바로 가기 · 연결된 폴더 등).",
  sync_off: "이 PC의 폴더 동기화가 꺼져 있어요. 이 PC 상태 창에서 동기화를 켠 뒤 다시 열어 주세요.",
  unsupported: "서버가 아직 ‘PC에만 두기’를 지원하지 않아요. 잠시 뒤 다시 열어 주세요.",
  busy: "다른 파일을 여는 중이에요. 잠시 뒤 다시 열어 주세요.",
  // openLocal: Windows가 열 앱을 찾지 못함(shell.openPath 실패 — D의 C-3 보충)
  open_failed: "이 PC에서 이 파일을 열 앱을 찾지 못했어요. 파일 형식에 맞는 앱이 설치돼 있는지 확인해 주세요.",
};
export const localFileText = (code) => LOCAL_FILE_TEXT[code] || "이 PC에서 파일을 열지 못했어요. 잠시 뒤 다시 해 주세요.";

// 다른 PC · 웹에서 연 로컬 항목의 읽기 영역 안내
export function localNotice(paper) {
  const s = paper && paper.sync;
  if (holderGone(s)) {
    return { title: "이 파일을 열 수 없어요", text: "연결이 해지된 PC에만 있던 파일이라 열 수 없어요. 파일이 있으면 [파일 다시 올리기]로 올려 주세요.", reupload: true };
  }
  const H = q(holderName(s));
  return { title: `이 파일은 ${H}에만 있어요`,
    text: `PC에만 두기로 해서 서버에는 파일이 없어요. ${H}의 PaperLab 앱에서 열 수 있어요. 노트 · 하이라이트 · 정보는 여기서도 볼 수 있어요.`, reupload: false };
}

// 상세 패널 "다른 곳" 한 줄
export const elsewhereLine = (paper) => `${q(holderName(paper && paper.sync))}에만 있어요 — 그 PC의 PaperLab 앱에서 열 수 있어요`;

// 로컬 항목 AI를 쓸 수 없는 형식 문구 (서버 400 local_unsupported와 같은 문구 — 화면이 file_name 확장자로 고름)
export function localUnsupportedText(fileName) {
  const ext = extOf(fileName);
  if (IMAGE_EXTS.includes(ext)) return "사진(이미지)은 글자를 읽지 않아요. AI 요약 · 질문은 쓸 수 없어요.";
  if (ext === ".hwp") return "아주 옛 한글 파일(HWP 3.0 이하)은 이 PC에서 내용을 읽지 못해요. [동기화 켜기]로 서버에도 저장하거나 한글에서 새 형식으로 저장해 주세요.";
  return "옛 파워포인트(.ppt) · 엑셀(.xls) · RTF 파일은 이 PC에서 내용을 읽지 못해 AI를 쓸 수 없어요. [동기화 켜기]로 서버에도 저장하면 AI를 쓸 수 있어요. (.pptx · .xlsx · .docx로 다시 저장해도 돼요.)";
}

// AI 요약 · 질문하기 탭 시작 버튼 위 한 줄 → {text, tone, disabled} 또는 null(켬 항목)
export function localAiNote(paper) {
  const s = paper && paper.sync;
  if (!s || s.storage !== "local") return null;
  if (s.local_ai === "unsupported") return { text: localUnsupportedText(paper.file_name || paper.source_name), tone: "warn", disabled: true };
  if (holderGone(s)) return { text: "연결이 해지된 PC에만 있던 파일이라 AI를 쓸 수 없어요.", tone: "warn", disabled: true };
  const H = q(holderName(s));
  const off = holderOf(s).online === false;
  return { text: `이 파일은 ${H}에만 있어서 ${H}의 AI(CLI)로 실행해요. 서버 AI 키는 쓰지 않아요.${off ? ` ${josa(H, "이/가")} 켜지면 실행돼요.` : ""}`,
    tone: off ? "warn" : "info", disabled: false };
}

// 서재 질문: 범위 안의 로컬 편수
export const excludedLocalText = (n) => (Number(n) > 0 ? `이 PC에만 있는 ${Number(n)}편은 서재 질문에서 빠졌어요` : "");

// ------------------------------------------------------------- 연결된 PC (10.5 · 10.7절)
// 동기화 줄 끝에 붙이는 "이 PC에만 둔 파일 n개(m MB)"
export const deviceLocalText = (d) => (d && d.local_count > 0
  ? `이 PC에만 둔 파일 ${d.local_count}개${d.local_bytes ? `(${sizeText(d.local_bytes)})` : ""}` : "");

export const OLD_PROTOCOL_TEXT = "! 멈춤 — 앱을 업데이트해야 동기화가 이어져요 (PC에만 두기를 쓰려면 0.4.0 이상)";

// 해지 확인 창에 더하는 줄 (로컬 항목이 있을 때만)
export const revokeLocalText = (d) => (d && d.local_count > 0
  ? `이 PC에만 있는 파일 ${d.local_count}개(정보 · 노트는 남아요)는 해지하면 서재에서 열 수 없어요. 그 PC에서 [동기화 켜기]로 먼저 서버에 올리거나, 나중에 다른 PC의 동기화 폴더에 같은 파일을 넣으면 다시 연결돼요.`
  : "");
