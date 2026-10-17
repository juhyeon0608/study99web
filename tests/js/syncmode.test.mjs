// 선택 동기화 화면 순수 함수 — 배지 · 메뉴 · 확인 창 문구 (docs/specs/selective-sync.md 10.2 · 10.3 · 10.4 · 10.5절, AC-S61 · AC-S62)
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bare, templateExprs } from "./codecheck.mjs";

const S = await import("../../paperlab/static/js/syncmode.js");

// 이 PC = 기기 7 (집 PC), 다른 PC = 9 (연구실 PC)
const HOME = { id: 7, name: "집 PC", online: true, gone: false };
const LAB = { id: 9, name: "연구실 PC", online: false, gone: false };
const sync = (o = {}) => ({ mode: "inherit", effective: "cloud", storage: "cloud", pending: "", pending_error: "", holder: null,
  mismatch: false, has_file: true, local_ai: null, ...o });
const paper = (o = {}, id = 1, file_name = "보고서.pdf") => ({ id, title: "보고서", file_name, sync: sync(o) });
const APP = { desktop: { paired: true, deviceId: 7, deviceName: "집 PC" }, deviceId: 7, bridge: true, syncOn: true, has: null };
const WEB = { desktop: null, deviceId: null, bridge: false, syncOn: true, has: null };

describe("배지 (10.2절 표 — 모든 줄)", () => {
  test("켬 · 옛 서버(sync 없음)는 배지 없음", () => {
    assert.equal(S.badgeFor(paper(), APP), null);
    assert.equal(S.badgeFor({ id: 1, title: "x" }, APP), null);
    assert.equal(S.mismatchBadge(paper()), null);
  });
  test("로컬 · 보관 PC = 이 PC: 앱 안은 ‘이 PC에만’, 웹 · 다른 PC는 ‘집 PC에만’", () => {
    const p = paper({ storage: "local", effective: "local", holder: HOME, local_ai: "ok" });
    assert.deepEqual(S.badgeFor(p, APP), { text: "이 PC에만", tone: "local", title: S.LOCAL_TIP });
    assert.equal(S.badgeFor(p, WEB).text, "집 PC에만");
    assert.equal(S.badgeFor(p, { ...APP, deviceId: 9 }).text, "집 PC에만");
    assert.equal(S.LOCAL_TIP, "서버에는 정보만 있어요 — 본문 검색 · 서버 AI에서 빠져요");
  });
  test("로컬 · 이 PC 보관인데 파일 없음(localHas = missing) — 웹은 그대로 ‘집 PC에만’", () => {
    const p = paper({ storage: "local", holder: HOME });
    assert.deepEqual(S.badgeFor(p, { ...APP, has: { 1: "missing" } }).text, "이 PC에 파일 없음");
    assert.equal(S.badgeFor(p, { ...APP, has: { 1: "missing" } }).tone, "warn");
    assert.equal(S.badgeFor(p, { ...APP, has: { 1: "here" } }).text, "이 PC에만");
    assert.equal(S.badgeFor(p, { ...WEB, has: { 1: "missing" } }).text, "집 PC에만");
  });
  test("로컬 · 보관 PC 해지 · 없음 (경고색, 어디서나 같음)", () => {
    for (const holder of [{ ...HOME, gone: true }, null]) {
      const p = paper({ storage: "local", holder });
      assert.deepEqual([S.badgeFor(p, APP).text, S.badgeFor(p, APP).tone], ["파일 없음 (연결 해지된 PC)", "warn"]);
      assert.equal(S.badgeFor(p, WEB).text, "파일 없음 (연결 해지된 PC)");
    }
  });
  test("to_local · to_cloud 대기 (점선) — 다른 곳은 보관 PC 이름", () => {
    const off = paper({ pending: "to_local", holder: HOME, effective: "local" });
    assert.deepEqual([S.badgeFor(off, APP).text, S.badgeFor(off, APP).tone], ["PC에만으로 바꾸는 중", "pending"]);
    assert.equal(S.badgeFor(off, WEB).text, "PC에만으로 바꾸는 중 (집 PC 대기)");
    const on = paper({ storage: "local", pending: "to_cloud", holder: LAB });
    assert.equal(S.badgeFor(on, APP).text, "서버에 올리는 중 (연구실 PC 대기)");
    assert.equal(S.badgeFor(on, { ...APP, deviceId: 9 }).text, "서버에 올리는 중");
  });
  test("대기 + pending_error · 끄는 중 보관 PC 해지 → 확인 필요 (경고색, 이유는 툴팁)", () => {
    const p = paper({ pending: "to_local", pending_error: "missing", holder: HOME });
    assert.deepEqual([S.badgeFor(p, WEB).text, S.badgeFor(p, WEB).tone], ["확인 필요", "warn"]);
    assert.match(S.badgeFor(p, WEB).title, /‘집 PC’에 이 파일이 없어요/);
    const gone = paper({ pending: "to_local", holder: { ...HOME, gone: true } });
    assert.equal(S.badgeFor(gone, APP).text, "확인 필요");
    assert.match(S.badgeFor(gone, APP).title, /고른 PC가 해지됐어요/);
    for (const r of ["changed_here", "too_long", "unreadable", "새이유"]) assert.ok(S.pendingErrorText(sync({ pending: "to_local", pending_error: r, holder: HOME })), r);
  });
  test("올리던 중(to_cloud) 보관 PC 해지 → 파일 없음 (연결 해지된 PC) · [취소] + [파일 다시 올리기] (12장)", () => {
    for (const holder of [{ ...LAB, gone: true }, null]) {
      const p = paper({ storage: "local", pending: "to_cloud", holder });
      assert.deepEqual([S.badgeFor(p, WEB).text, S.badgeFor(p, WEB).tone], ["파일 없음 (연결 해지된 PC)", "warn"]);
      assert.deepEqual(S.storageLine(p, WEB), { text: "연결이 해지된 PC에만 있던 파일이에요 — 서버에는 정보만 있어요", tone: "warn", actions: ["cancel", "reupload"] });
      assert.equal(S.localNotice(p).reupload, true);
    }
  });
  test("폴더 설정과 다름 (작은 글씨, 대기 중이면 없음)", () => {
    assert.deepEqual(S.mismatchBadge(paper({ mismatch: true, effective: "local" })), { text: "폴더 설정과 다름", tone: "mismatch", title: S.MISMATCH_TIP });
    assert.equal(S.mismatchBadge(paper({ mismatch: true, pending: "to_local", holder: HOME })), null);
  });
  test("폴더 트리 PC 표 — 이 폴더 설정이면 진하게, 물려받았으면 흐리게", () => {
    assert.equal(S.folderMark({ sync_mode: "inherit", effective_mode: "cloud" }), null);
    assert.equal(S.folderMark({ sync_mode: "local", effective_mode: "local" }).own, true);
    assert.equal(S.folderMark({ sync_mode: "inherit", effective_mode: "local" }).own, false);
    assert.equal(S.folderMark({ sync_mode: "local", effective_mode: "local" }).title, "이 폴더의 새 파일은 PC에만 둬요");
    assert.equal(S.folderMark(null), null);
  });
});

describe("폴더 메뉴 · 스위치 (10.3절)", () => {
  const f = (sync_mode, effective_mode) => ({ id: 3, name: "개인 자료", parent_id: null, sync_mode, effective_mode });
  test("실효 켬 → 끄기, 실효 끔 → 켜기, 설정이 있으면 위 폴더 따르기", () => {
    assert.deepEqual(S.folderMenu(f("inherit", "cloud"), APP), [{ act: "to_local", label: "동기화 끄기 — PC에만 두기…", mode: "local" }]);
    assert.deepEqual(S.folderMenu(f("local", "local"), APP), [{ act: "to_cloud", label: "동기화 켜기 — 서버에도 저장…", mode: "cloud" },
      { act: "inherit", label: "위 폴더 설정 따르기", mode: "inherit" }]);
    assert.deepEqual(S.folderMenu(f("inherit", "local"), WEB).map((x) => x.act), ["to_cloud"]);
    assert.deepEqual(S.folderMenu(f("cloud", "cloud"), WEB).map((x) => x.act), ["to_local", "inherit"]);
  });
  test("폴더 동기화를 켠 PC가 없거나 옛 서버면 메뉴 · 스위치 없음", () => {
    assert.deepEqual(S.folderMenu(f("inherit", "cloud"), { ...WEB, syncOn: false }), []);
    assert.deepEqual(S.folderMenu({ id: 3, name: "x", parent_id: null }, APP), []);
    assert.equal(S.folderSwitch(f("inherit", "cloud"), { syncOn: false }), null);
    assert.equal(S.folderSwitch(null, APP), null);
  });
  test("스위치: 켬이면 누를 때 끄기(local), 끔이면 켜기(cloud)", () => {
    assert.deepEqual(S.folderSwitch(f("inherit", "cloud"), APP), { on: true, label: "서버에도 저장", state: "켬", mode: "local",
      title: "끄면 이 폴더의 파일을 PC에만 둬요" });
    assert.equal(S.folderSwitch(f("local", "local"), APP).mode, "cloud");
    assert.equal(S.folderSwitch(f("local", "local"), APP).state, "끔");
  });
  test("상속 계산 · 하위 따로 설정 수", () => {
    const folders = [{ id: 1, parent_id: null, sync_mode: "local" }, { id: 2, parent_id: 1, sync_mode: "inherit" },
      { id: 3, parent_id: 2, sync_mode: "cloud" }, { id: 4, parent_id: null, sync_mode: "inherit" }];
    assert.equal(S.folderEffective(null, folders), "cloud");
    assert.equal(S.folderEffective(2, folders), "local");
    assert.equal(S.folderEffective(3, folders), "cloud");
    assert.equal(S.folderEffective(4, folders), "cloud");
    assert.equal(S.folderEffective(4, [{ id: 4, parent_id: null, sync_mode: "inherit", effective_mode: "local" }]), "local");
    assert.equal(S.customChildFolders(1, folders), 1);
    assert.equal(S.customChildFolders(4, folders), 0);
  });
});

describe("파일 메뉴 · 상세 저장 위치 (10.4절)", () => {
  const acts = (p, ctx = APP) => S.paperMenu(p, ctx).map((x) => `${x.act}:${x.mode}`);
  test("켬 파일 → 끄기, 로컬 → 켜기, 설정 있음 → 폴더 설정 따르기", () => {
    assert.deepEqual(acts(paper()), ["to_local:local"]);
    assert.deepEqual(acts(paper({ storage: "local", holder: HOME, mode: "local" })), ["to_cloud:cloud", "inherit:inherit"]);
    assert.deepEqual(acts(paper({ mode: "cloud" })), ["to_local:local", "inherit:inherit"]);
    assert.equal(S.paperMenu(paper(), APP)[0].label, "동기화 끄기 — PC에만 두기…");
  });
  test("대기 중이면 바꾸기 취소만 (반대 방향 요청 = 취소, 5.3절)", () => {
    assert.deepEqual(S.paperMenu(paper({ pending: "to_local", holder: HOME }), WEB), [{ act: "cancel", label: "바꾸기 취소", mode: "cloud" }]);
    assert.deepEqual(acts(paper({ storage: "local", pending: "to_cloud", holder: HOME }), { ...WEB, syncOn: false }), ["cancel:local"]);
  });
  test("파일 없는 항목 · 보관 PC 해지 · 동기화 PC 없음", () => {
    assert.deepEqual(acts(paper({ has_file: false })), []);
    assert.deepEqual(acts(paper({ storage: "local", holder: { ...HOME, gone: true } })), []);
    assert.deepEqual(acts(paper(), { ...WEB, syncOn: false }), []);
    assert.deepEqual(acts({ id: 1 }), []);
  });
  test("폴더 설정과 다름 → 폴더 설정대로 맞추기(inherit)", () => {
    assert.deepEqual(acts(paper({ mismatch: true, effective: "local" })), ["to_local:local", "align:inherit"]);
  });
  test("여러 개 선택 막대 — 같은 두 항목", () => {
    assert.deepEqual(S.bulkMenu(APP).map((x) => x.label), ["PC에만 두기…", "서버에도 저장…"]);
    assert.deepEqual(S.bulkMenu({ syncOn: false }), []);
  });
  test("저장 위치 줄 문구 · 단추", () => {
    const line = (o, ctx = WEB) => S.storageLine(paper(o), ctx);
    assert.deepEqual(line({}), { text: "서버 · 모든 PC(동기화 켬)", tone: "", actions: [] });
    assert.equal(line({ has_file: false }), null);
    assert.equal(line({ storage: "local", holder: HOME }).text, "‘집 PC’에만 — 서버에는 정보만 있어요");
    assert.equal(line({ storage: "local", holder: HOME }, APP).text, "이 PC에만 — 서버에는 정보만 있어요");
    assert.deepEqual(line({ pending: "to_local", holder: HOME }), { text: "‘집 PC’에만으로 바꾸는 중 — ‘집 PC’가 켜지면 서버의 파일을 지워요", tone: "pending", actions: ["cancel"] });
    assert.deepEqual(line({ storage: "local", pending: "to_cloud", holder: HOME }).text, "서버에 올리는 중 — ‘집 PC’가 켜지면 올려요");
    assert.deepEqual(line({ mismatch: true, effective: "local" }).actions, ["align"]);
    assert.equal(line({ mismatch: true, effective: "local" }).text, "폴더 설정(PC에만)과 달라요");
    assert.deepEqual(line({ storage: "local", holder: null }).actions, ["reupload"]);
    assert.deepEqual(line({ pending: "to_local", holder: { ...HOME, gone: true } }).actions, ["cancel", "pick"]);
    assert.match(line({ pending: "to_local", pending_error: "missing", holder: HOME }).text, /^확인 필요 — /);
  });
  test("옮긴 뒤 폴더 설정과 달라질 논문 (D-3)", () => {
    const folders = [{ id: 5, parent_id: null, sync_mode: "local", effective_mode: "local" }];
    const ps = [paper({}, 1), paper({ storage: "local", holder: HOME }, 2), paper({ mode: "cloud" }, 3), paper({ has_file: false }, 4),
      paper({ pending: "to_local", holder: HOME }, 6)];
    assert.deepEqual(S.moveMismatch(ps, 5, folders), [1]);
    assert.deepEqual(S.moveMismatch(ps, null, folders), [2]);
  });
});

describe("확인 창 문구 (10.5절 · Q-5 · D-12)", () => {
  const WARN = "‘집 PC’가 고장 나거나 그 PC에서 파일이 지워지면 서재에서 이 파일을 되살릴 수 없어요. 서재에는 정보 · 노트 · 하이라이트만 남아요. 중요한 파일은 따로 백업해 두세요.";
  const KEEP = "지금까지 만든 AI 요약 · 대화 · 설명 기록과 하이라이트한 글은 그대로 남아요.";
  const off = { dry_run: true, to_local: 12, to_cloud: 0, cancelled: 0, unchanged: 3, no_file: 0, freed_bytes: 48 * 1024 * 1024,
    holder: { id: 7, name: "집 PC" }, other_pcs: [{ id: 9, name: "연구실 PC", files: 12 }], blocked: [] };
  test("폴더 끄기 — 명세 문구 그대로", () => {
    const t = S.confirmText(off, { target: { type: "folder", name: "개인 자료" }, mode: "local" });
    assert.equal(t.dir, "off");
    assert.equal(t.title, "‘개인 자료’ 폴더를 PC에만 둘까요?");
    assert.equal(t.lead, "이 폴더의 파일 12개(48MB)를 서버에서 지우고 ‘집 PC’에만 둬요. 제목 · 저자 · 노트 · 하이라이트 · 태그는 서버에 남아요.");
    assert.deepEqual(t.bullets, [
      "서버 본문 검색 · 서재 질문 · 선택 설명 · 번역에서 빠지고, AI 요약 · 질문은 ‘집 PC’의 AI로만 돼요.",
      "‘연구실 PC’에 있는 이 파일 12개는 Windows 휴지통으로 옮겨져요.",
      KEEP,
      "서버 파일은 ‘집 PC’가 파일을 가지고 있는지 확인한 뒤에 지워요.",
    ]);
    assert.equal(t.warn, WARN);
    assert.equal(t.ok, "PC에만 두기");
  });
  test("Q-5 경고 문단은 파일 하나 · 여러 개 · 폴더 모두에서 (AC-S62)", () => {
    const one = S.confirmText({ ...off, to_local: 1, freed_bytes: 2.1 * 1024 * 1024, other_pcs: [] }, { target: { type: "file", name: "보고서.hwp" }, mode: "local" });
    assert.equal(one.title, "‘보고서.hwp’를 PC에만 둘까요?"); // 조사는 확장자를 뺀 이름에 (10.5절 그대로)
    assert.equal(one.lead, "이 파일(2.1MB)을 서버에서 지우고 ‘집 PC’에만 둬요. 제목 · 저자 · 노트 · 하이라이트 · 태그는 서버에 남아요.");
    const many = S.confirmText({ ...off, to_local: 3 }, { target: { type: "files", count: 3 }, mode: "local" });
    assert.equal(many.title, "선택한 파일 3개를 PC에만 둘까요?");
    const folder = S.confirmText(off, { target: { type: "folder", name: "개인 자료" }, mode: "inherit" });
    for (const t of [one, many, folder]) {
      assert.equal(t.warn, WARN);
      assert.ok(t.bullets.includes(KEEP)); // D-12 안내 한 줄
    }
    // 고른 PC 이름(보관 PC 라디오)이 서버 holder보다 먼저
    assert.match(S.confirmText(off, { target: { type: "files", count: 12 }, mode: "local", holderName: "연구실 PC" }).warn, /^‘연구실 PC’가 고장 나거나/);
    // 옮길 파일이 없어도 끄는 설정이면 경고는 보임 (빈 폴더 끄기)
    const empty = S.confirmText({ to_local: 0, to_cloud: 0, cancelled: 0, unchanged: 0, no_file: 0 }, { target: { type: "folder", name: "새 폴더" }, mode: "local" });
    assert.equal(empty.dir, "none");
    assert.ok(empty.warn);
    assert.equal(empty.lead, "지금 서버에서 지우거나 올릴 파일은 없어요. 앞으로 이 폴더에 새로 넣는 파일은 PC에만 둬요.");
  });
  test("켜기 — 보관 PC가 올림, 꺼져 있으면 켜질 때", () => {
    const t = S.confirmText({ to_local: 0, to_cloud: 12, cancelled: 0, holder: { id: 7, name: "집 PC" }, bytes: 48 * 1024 * 1024 },
      { target: { type: "folder", name: "개인 자료" }, mode: "cloud" });
    assert.equal(t.title, "‘개인 자료’ 폴더를 서버에도 저장할까요?");
    assert.equal(t.lead, "‘집 PC’가 파일 12개(48MB)를 서버에 올려요. 올리면 본문 검색 · 서버 AI · 다른 PC와 웹에서 읽기를 쓸 수 있어요. 다른 PC에도 파일이 내려가요.");
    assert.equal(t.note, "(‘집 PC’가 꺼져 있으면 켜질 때 올려요.)");
    assert.equal(t.warn, "");
    assert.equal(t.ok, "서버에도 저장");
  });
  test("취소 · 파일 없음 줄, 하위 항목 체크 상자, 보관 PC 라디오 줄", () => {
    const t = S.confirmText({ ...off, cancelled: 1, no_file: 2 }, { target: { type: "folder", name: "x" }, mode: "local" });
    assert.ok(t.bullets.some((b) => /바꾸던 파일 1개/.test(b)) && t.bullets.some((b) => /파일이 없는 2편/.test(b)));
    assert.equal(S.childrenLabel(3), "안에서 따로 정한 폴더 · 파일 3개도 이 설정으로 바꾸기");
    assert.equal(S.childrenLabel(0), "안에서 따로 정한 폴더 · 파일도 이 설정으로 바꾸기");
    assert.equal(S.holderOption({ name: "집 PC", online: true, this_device: true }), "집 PC (이 PC) · 켜짐");
    assert.equal(S.holderOption({ name: "연구실 PC", online: false, last_seen_at: "t" }, () => "3시간 전"), "연구실 PC · 마지막 접속 3시간 전");
  });
  test("요청 뒤 · 끝남 토스트", () => {
    assert.equal(S.requestToast({ to_local: 12 }, { holderName: "집 PC" }), "12개를 PC에만으로 바꾸는 중이에요. ‘집 PC’가 확인하면 서버에서 지워요.");
    assert.equal(S.requestToast({ to_cloud: 12, holder: { name: "집 PC" } }), "‘집 PC’가 12개를 서버에 올리고 있어요.");
    // 켜기 응답은 holder = null — 고른 논문의 보관 PC 이름, 모르면 이름 없이 ("‘고른 PC’" 같은 가짜 이름 없음)
    assert.equal(S.requestToast({ to_cloud: 12, holder: null }, { fromName: "집 PC" }), "‘집 PC’가 12개를 서버에 올리고 있어요.");
    assert.equal(S.requestToast({ to_cloud: 12, holder: null }), "파일을 가진 PC가 12개를 서버에 올리고 있어요.");
    assert.equal(S.doneToast({ count: 12, holder: "집 PC", bytes: 48 * 1024 * 1024 }), "12개를 ‘집 PC’에만 두었어요. 서버 공간 48MB를 비웠어요.");
    assert.equal(S.uploadLocalFolderText("개인"), "‘개인’ 폴더는 PC에만 두는 폴더예요. 웹에서 올린 파일은 서버에 저장했어요");
  });
  test("켜기 — 서버가 holder를 주지 않으면 고른 논문의 보관 PC · 크기 (uploadSource)", () => {
    const MB = 1024 * 1024;
    const a = { ...paper({ storage: "local", holder: HOME }, 1), pdf_size: 30 * MB, source_size: 0 };
    const b = { ...paper({ storage: "local", holder: HOME }, 2), pdf_size: 10 * MB, source_size: 8 * MB };
    const c = { ...paper({ storage: "local", holder: LAB }, 3), pdf_size: MB };
    const cloud = paper({}, 4);
    const src = S.uploadSource([a, b, cloud]);
    assert.deepEqual(src, { fromName: "집 PC", fromBytes: 48 * MB, fromCount: 2 });
    assert.equal(S.uploadSource([a, c]).fromName, ""); // 보관 PC가 둘이면 이름 없이
    assert.equal(S.uploadSource([paper({ storage: "local", holder: { ...HOME, gone: true } })]).fromCount, 0);
    const reply = { to_local: 0, to_cloud: 2, cancelled: 0, holder: null };
    const files = S.confirmText(reply, { target: { type: "files", count: 2 }, mode: "cloud", ...src });
    assert.equal(files.lead, "‘집 PC’가 파일 2개(48MB)를 서버에 올려요. 올리면 본문 검색 · 서버 AI · 다른 PC와 웹에서 읽기를 쓸 수 있어요. 다른 PC에도 파일이 내려가요.");
    assert.equal(files.note, "(‘집 PC’가 꺼져 있으면 켜질 때 올려요.)");
    // 올릴 편수와 고른 편수가 다르면 크기를 쓰지 않음 · 이름을 모르면 "파일을 가진 PC"
    assert.match(S.confirmText({ ...reply, to_cloud: 1 }, { target: { type: "files", count: 2 }, mode: "cloud", ...src }).lead, /^‘집 PC’가 파일 1개를 /);
    assert.match(S.confirmText(reply, { target: { type: "folder", name: "개인" }, mode: "cloud" }).lead, /^파일을 가진 PC가 파일 2개를 /);
  });
  test("파일 이름 조사 — 확장자를 뺀 이름에", () => {
    assert.equal(S.fileParticle("보고서.hwp"), "를");
    assert.equal(S.fileParticle("논문.pdf"), "을");
    assert.equal(S.fileParticle("Deep Learning.pdf"), "을");
    assert.equal(S.fileParticle("메모"), "를");
  });
  test("크기 표시", () => {
    assert.equal(S.sizeText(2.1 * 1024 * 1024), "2.1MB");
    assert.equal(S.sizeText(48 * 1024 * 1024), "48MB");
    assert.equal(S.sizeText(300 * 1024), "300KB");
    assert.equal(S.sizeText(1.5 * 1024 ** 3), "1.5GB");
  });
  test("원본 정리 전인 옛 문서(blocked needs_originals) — 확인 창 · 토스트에 한 줄 (7.2절)", () => {
    const LINE = "원본 정리 전인 문서 2개는 아직 PC에만으로 바꿀 수 없어요 (관리자가 원본 정리를 마치면 돼요)";
    const NO = [{ id: 5, code: "needs_originals" }, { id: 6, code: "needs_originals" }, { id: 8, code: "trashed" }];
    assert.equal(S.needsOriginalsCount({ blocked: NO }), 2);
    assert.equal(S.needsOriginalsCount({ blocked: [{ id: 8, code: "trashed" }] }), 0);
    assert.equal(S.needsOriginalsCount(null), 0);
    assert.equal(S.needsOriginalsText(2), LINE);
    assert.equal(S.needsOriginalsText(0), "");
    // 일부만 막힘: 끄기 창 그대로 + 안내 줄
    const some = S.confirmText({ ...off, blocked: NO }, { target: { type: "files", count: 14 }, mode: "local" });
    assert.equal(some.dir, "off");
    assert.ok(some.bullets.includes(LINE));
    // 모두 막힘(논문 요청): 바뀌는 것이 없음 — [확인] 없이 안내만
    const none = { to_local: 0, to_cloud: 0, cancelled: 0, unchanged: 0, no_file: 0, freed_bytes: 0, holder: null, other_pcs: [], blocked: NO.slice(0, 2) };
    const all = S.confirmText(none, { target: { type: "files", count: 2 }, mode: "local" });
    assert.equal(all.dir, "blocked");
    assert.equal(all.lead, LINE);
    assert.equal(all.ok, "");
    assert.equal(all.warn, "");
    const one = S.confirmText({ ...none, blocked: NO.slice(0, 1) }, { target: { type: "file", name: "보고서.docx" }, mode: "local" });
    assert.equal(one.lead, "원본 정리 전인 문서 1개는 아직 PC에만으로 바꿀 수 없어요 (관리자가 원본 정리를 마치면 돼요)");
    // 폴더 끄기: 폴더 설정은 바뀜 — 설정만 바꾸는 창 + 안내 줄
    const folder = S.confirmText(none, { target: { type: "folder", name: "개인 자료" }, mode: "local" });
    assert.equal(folder.dir, "none");
    assert.ok(folder.bullets.includes(LINE) && folder.warn);
    // 토스트: 막힌 것만이면 그 줄만, 다른 변화가 있으면 덧붙임
    assert.equal(S.requestToast(none), LINE);
    assert.equal(S.requestToast({ ...none, to_local: 3, blocked: NO }, { holderName: "집 PC" }),
      `3개를 PC에만으로 바꾸는 중이에요. ‘집 PC’가 확인하면 서버에서 지워요. ${LINE}`);
    assert.equal(S.requestToast({ ...none, unchanged: 1, blocked: NO }), `동기화 설정을 바꿨어요. ${LINE}`);
    assert.equal(S.requestToast({ ...none, to_local: 3, blocked: [] }, { holderName: "집 PC" }),"3개를 PC에만으로 바꾸는 중이에요. ‘집 PC’가 확인하면 서버에서 지워요.");
    // mergeReplies(200편씩 나눔)도 blocked를 합쳐서 셈
    assert.equal(S.needsOriginalsCount(S.mergeReplies([{ ...none, blocked: NO.slice(0, 1) }, { ...none, blocked: NO.slice(1) }])), 2);
  });
});

describe("읽기 화면 · AI 안내 (9.3 · 10.6 · 10.9절)", () => {
  test("열 수 있는 창: 이 PC 보관 + 다리(localFile) 있음 — 웹 · 옛 앱 · 남의 보관은 다른 곳 화면 (C-3)", () => {
    const p = paper({ storage: "local", holder: HOME });
    assert.equal(S.canOpenHere(p, APP), true);
    assert.equal(S.canOpenHere(p, { ...APP, bridge: false }), false);
    assert.equal(S.canOpenHere(p, WEB), false);
    assert.equal(S.canOpenHere(paper({ storage: "local", holder: LAB }), APP), false);
    assert.equal(S.canOpenHere(paper(), APP), false);
  });
  test("종류: PDF · 사진은 앱 안, 문서는 기본 앱", () => {
    assert.equal(S.readerKind({ file_name: "a.PDF" }), "pdf");
    assert.equal(S.readerKind({ file_name: "칠판.jpeg" }), "image");
    assert.equal(S.readerKind({ file_name: "보고서.hwp" }), "doc");
    assert.equal(S.readerKind({ file_name: "", source_name: "발표.pptx" }), "doc");
  });
  test("다른 곳 안내 · 해지된 PC", () => {
    assert.deepEqual(S.localNotice(paper({ storage: "local", holder: HOME })), { title: "이 파일은 ‘집 PC’에만 있어요",
      text: "PC에만 두기로 해서 서버에는 파일이 없어요. ‘집 PC’의 PaperLab 앱에서 열 수 있어요. 노트 · 하이라이트 · 정보는 여기서도 볼 수 있어요.", reupload: false });
    assert.equal(S.localNotice(paper({ storage: "local", holder: null })).reupload, true);
    assert.equal(S.elsewhereLine(paper({ storage: "local", holder: HOME })), "‘집 PC’에만 있어요 — 그 PC의 PaperLab 앱에서 열 수 있어요");
  });
  test("다리 실패 코드마다 문구", () => {
    for (const c of ["not_local", "missing", "changed", "too_big", "path", "sync_off", "unsupported", "busy", undefined]) assert.ok(S.localFileText(c), String(c));
    // openLocal의 open_failed(D의 C-3 보충)는 일반 문구가 아니라 앱을 찾지 못했다는 문구
    assert.match(S.localFileText("open_failed"), /열 앱을 찾지 못했어요/);
    assert.notEqual(S.localFileText("open_failed"), S.localFileText("새코드"));
  });
  test("AI 안내 한 줄: 보관 PC CLI만, 꺼져 있으면 켜지면 실행, 읽지 못하는 형식은 막음", () => {
    assert.equal(S.localAiNote(paper()), null);
    const on = S.localAiNote(paper({ storage: "local", holder: HOME, local_ai: "ok" }));
    assert.deepEqual(on, { text: "이 파일은 ‘집 PC’에만 있어서 ‘집 PC’의 AI(CLI)로 실행해요. 서버 AI 키는 쓰지 않아요.", tone: "info", disabled: false });
    assert.match(S.localAiNote(paper({ storage: "local", holder: LAB, local_ai: "ok" })).text, /‘연구실 PC’가 켜지면 실행돼요\.$/);
    const ppt = S.localAiNote(paper({ storage: "local", holder: HOME, local_ai: "unsupported" }, 1, "발표.ppt"));
    assert.equal(ppt.disabled, true);
    assert.match(ppt.text, /^옛 파워포인트\(\.ppt\)/);
    assert.match(S.localUnsupportedText("사진.png"), /^사진\(이미지\)/);
    assert.match(S.localUnsupportedText("옛.hwp"), /HWP 3\.0 이하/);
    assert.equal(S.EXPLAIN_LOCAL_TEXT, "이 PC에만 있는 파일은 선택 설명 · 번역을 쓸 수 없어요. [동기화 켜기]로 서버에 올리면 쓸 수 있어요.");
  });
  test("서재 질문 · 연결된 PC 줄 · 해지 확인", () => {
    assert.equal(S.excludedLocalText(3), "이 PC에만 있는 3편은 서재 질문에서 빠졌어요");
    assert.equal(S.excludedLocalText(0), "");
    assert.equal(S.deviceLocalText({ local_count: 4, local_bytes: 12 * 1024 * 1024 }), "이 PC에만 둔 파일 4개(12MB)");
    assert.equal(S.deviceLocalText({ local_count: 0 }), "");
    assert.match(S.revokeLocalText({ local_count: 4 }), /^이 PC에만 있는 파일 4개\(정보 · 노트는 남아요\)는 해지하면 서재에서 열 수 없어요/);
    assert.equal(S.revokeLocalText({}), "");
  });
});

describe("다른 PC 고르기 · 보관 PC 라디오 · 200편 나누기 (12장 · 10.5절 · QA)", () => {
  test("[다른 PC 고르기]는 논문 자기 설정을 그대로 보냄 (inherit 논문에 local을 쓰지 않음)", () => {
    const gone = { ...HOME, gone: true };
    assert.equal(S.pickMode(paper({ pending: "to_local", holder: gone, mode: "inherit" })), "inherit");
    assert.equal(S.pickMode(paper({ pending: "to_local", holder: gone, mode: "local" })), "local");
    assert.equal(S.pickMode({ id: 1, sync: { pending: "to_local" } }), "inherit");
  });
  test("라디오 처음 값: 앱 창이면 이 PC, 하나뿐이면 그 PC, 아니면 고르기 전", () => {
    const hs = [{ id: 7, name: "집 PC" }, { id: 9, name: "연구실 PC" }];
    assert.equal(S.defaultHolder(hs, 7), 7);
    assert.equal(S.defaultHolder(hs, null), null);
    assert.equal(S.defaultHolder(hs, 5), null); // 이 PC가 자격 없음(동기화 끔 등) — 웹처럼 고르게
    assert.equal(S.defaultHolder([{ id: 9 }], null), 9);
    assert.equal(S.defaultHolder([], 7), null);
  });
  test("200편씩 나누고 응답 숫자를 합침", () => {
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    assert.deepEqual(S.chunkIds(ids).map((c) => c.length), [200, 200, 50]);
    assert.deepEqual(S.chunkIds([3]), [[3]]);
    const r = (o) => ({ dry_run: true, to_local: 0, to_cloud: 0, cancelled: 0, unchanged: 0, no_file: 0, freed_bytes: 0, overrides: 0,
      holder: null, other_pcs: [], blocked: [], ...o });
    const m = S.mergeReplies([r({ to_local: 200, freed_bytes: 10, holder: { id: 7, name: "집 PC" }, other_pcs: [{ id: 9, name: "연구실 PC", files: 200 }] }),
      r({ to_local: 40, unchanged: 10, freed_bytes: 5, holder: { id: 7, name: "집 PC" }, other_pcs: [{ id: 9, name: "연구실 PC", files: 40 }], blocked: [{ id: 3, code: "trashed" }] })]);
    assert.equal(m.to_local, 240);
    assert.equal(m.unchanged, 10);
    assert.equal(m.freed_bytes, 15);
    assert.deepEqual(m.holder, { id: 7, name: "집 PC" });
    assert.deepEqual(m.other_pcs, [{ id: 9, name: "연구실 PC", files: 240 }]);
    assert.deepEqual(m.blocked, [{ id: 3, code: "trashed" }]);
  });
});

describe("연결된 PC 줄 · 대기 작업 줄 (10.7 · 10.6절)", async () => {
  globalThis.document ??= { addEventListener() {}, hidden: false, querySelector() { return null; }, querySelectorAll() { return []; } };
  globalThis.window ??= { addEventListener() {} };
  const D = await import("../../paperlab/static/js/dialogs.js");
  const J = await import("../../paperlab/static/js/jobs.js");
  test("프로토콜 1(0.3.x) PC는 마지막 상태가 idle이어도 멈춤 — 앱 업데이트 안내", () => {
    const dev = (protocol, state = "idle") => ({ online: true, revoked: false, local_count: 0,
      sync: { enabled: true, state, protocol, root_label: "논문", last_sync_at: null, counts: { files: 3 } } });
    for (const st of ["idle", "syncing", "update_required", "paused"]) {
      assert.deepEqual(D.syncWebLine(dev(1, st)), { text: S.OLD_PROTOCOL_TEXT, tone: "warn" }, st);
    }
    assert.match(D.syncWebLine(dev(2)).text, /^✓ 최신/);
    assert.match(D.syncWebLine(dev(null)).text, /^✓ 최신/);
    assert.match(D.syncWebLine({ ...dev(1), online: false }).text, /\(PC 꺼짐\)$/); // 꺼진 PC는 그대로
  });
  test("로컬 항목 작업이 보관 PC를 기다림(holder_offline) — 줄 · 카드가 깨지지 않고 서버 note를 씀", () => {
    const job = (o) => ({ id: 1, kind: "summary", status: "queued", runner: "cli", engine: "claude", route: [{ runner: "cli", engine: "claude" }],
      route_index: 0, waiting_reason: null, progress: {}, attempts: 0, error: "", error_code: "", history: [], device: null,
      cancel_requested: false, deadline_at: null, started_at: null, ...o });
    assert.equal(J.jobLine(job({ waiting_reason: "holder_offline", pinned_device: { id: 7, name: "집 PC", online: false, note: "‘집 PC’가 켜지면 실행돼요" } })),
      "PC에서 실행 대기 중 — ‘집 PC’가 켜지면 실행돼요");
    assert.equal(J.jobLine(job({ waiting_reason: "holder_offline", pinned_device: null })), "PC에서 실행 대기 중 — 파일을 가진 PC가 꺼져 있어요");
    assert.equal(J.jobLine(job({ waiting_reason: "새이유" })), "PC가 곧 작업을 가져가요"); // 모르는 이유여도 TypeError 없음
    assert.match(J.stepsHtml(job({ waiting_reason: "holder_offline", route: [{ runner: "cli", engine: "claude" }, { runner: "cli", engine: "codex" }] })), /파일을 가진 PC가 꺼져 있어요/);
  });
});

describe("코드 검사", () => {
  const src = (f) => readFileSync(new URL(`../../paperlab/static/js/${f}`, import.meta.url), "utf8");
  test("syncmode.js는 DOM · 저장소 · 네트워크를 쓰지 않음 (순수 함수)", () => {
    const s = src("syncmode.js");
    assert.ok(!/\bdocument\b|\bwindow\b|localStorage|fetch\(|\bapi\./.test(s));
  });
  test("로컬 파일 다리는 논문 id만 넘김 (경로 없음 — C-3) · 없으면 옛 앱(다른 곳 화면)", () => {
    const reader = src("reader.js");
    const lib = src("library.js");
    assert.match(reader, /paperlabDesktop\.localFile\(R\.pid\)/);
    assert.match(lib, /dk\.openLocal\(pid\)/);
    assert.match(lib, /typeof dk\.localHas !== "function"/);
    assert.match(src("dialogs.js"), /typeof dk\.localFile === "function"/);
    for (const s of [reader, lib]) assert.ok(!/localFile\([^)]*(path|rel|abs)/.test(s));
  });
  test("[다른 PC 고르기]는 보관 PC 라디오로 — 창 건너뛰기 없음 · 논문 설정 그대로 (QA)", () => {
    const lib = src("library.js");
    const dlg = src("dialogs.js");
    assert.match(lib, /if \(a === "pick"\) return syncModeDialog\(\{ ids: \[p\.id\], mode: pickMode\(p\), repick: true/);
    assert.ok(!/mode: a === "pick" \? "local"/.test(lib));
    const fn = dlg.slice(dlg.indexOf("export async function syncModeDialog"), dlg.indexOf("// [바꾸기 취소]"));
    assert.match(fn, /if \(repick\) \{\s*\/\/[^\n]*\n\s*holders = await loadHolders\(\);/);
    assert.match(fn, /if \(p && !repick && !holders && /); // 창 없이 바로 적용하는 길에 다시 고르기는 들어가지 않음
    assert.match(fn, /&& !needsOriginalsCount\(p\)\) return apply\(\);/); // 원본 정리 전 문서가 막혔으면 안내 창 (7.2절)
    assert.match(fn, /t\.dir === "blocked"/); // 모두 막힘이면 [확인] 없이 [닫기]만
    assert.match(fn, /typeof p\.overrides === "number" \? p\.overrides/); // 하위 항목 수는 서버 dry_run overrides
    assert.match(fn, /folder && children > 0 \? `<label class="check sync-children">/); // 따로 정한 항목이 있을 때만 체크 상자
    assert.match(fn, /chunkIds\(ids\)/);
  });
  test("동기화 화면 HTML 조각의 글(이름 · 제목 · 문구)은 esc()를 거침", () => {
    const cut = (s, a, b) => {
      const i = s.indexOf(a);
      assert.ok(i >= 0, a);
      return s.slice(i, s.indexOf(b, i));
    };
    const lib = src("library.js");
    const reader = src("reader.js");
    const parts = [
      cut(lib, "function drawFolderSwitch", "function emptyState"),
      cut(lib, "function fileLabel", "// ----------------------------------------------------------- detail panel"),
      cut(lib, "const local = isLocal(p);", 'panel.innerHTML = "";'),
      cut(reader, "// ------------------------------------------------- 로컬 항목", "// 받은 PDF 바이트"),
      cut(reader, "function localExplainTab", "function pageLink"),
      cut(src("dialogs.js"), "export async function syncModeDialog", "// [바꾸기 취소]"),
      cut(src("app.js"), "const mark = folderMark(f);", "const toggle ="),
    ];
    // 사용자 · 서버가 정한 글이 들어가는 이름이 esc() 밖에 남으면 실패 (숫자 · 상수 그림 · 참거짓은 괜찮음)
    const TEXTY = /\b(name|title|text|label|file_name|source_name|message|detail|holder|lead|warn|note|sub|state|ext)\b/;
    const shown = (b) => b.replace(/"[^"]*"/g, "").replace(/^[^?]*\?/, "").replace(/fmtNum\([^)]*\)/g, ""); // 조건식의 조건 · 숫자는 화면 글이 아님
    const leaks = parts.flatMap((part) => templateExprs(part).map(bare)).filter((b) => TEXTY.test(shown(b)));
    assert.deepEqual(leaks, []);
  });
});
