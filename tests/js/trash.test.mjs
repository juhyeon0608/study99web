// 6단계 휴지통 · 동기화 웹 문구 (docs/design/phase6-folder-sync-ui.md 8 · 10장, AC-693) — 순수 함수만
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.document = { addEventListener() {}, hidden: false, querySelector() { return null; }, querySelectorAll() { return []; } };
globalThis.window = { addEventListener() {} };
const T = await import("../../paperlab/static/js/trash.js");
const D = await import("../../paperlab/static/js/dialogs.js");
const L = await import("../../paperlab/static/js/library.js");

const H = 3600000;
describe("휴지통 남은 날 (8.1절)", () => {
  test("칩 글", () => {
    const now = Date.parse("2026-10-13T00:00:00Z");
    const at = (h) => new Date(now + h * H).toISOString();
    assert.deepEqual(T.leftChip(at(5), now), { text: "오늘 영구 삭제", warn: true });
    assert.deepEqual(T.leftChip(at(30), now), { text: "내일 영구 삭제", warn: true });
    assert.deepEqual(T.leftChip(at(24 * 29 + 1), now), { text: "30일 남음", warn: false });
  });
});

describe("연결된 PC 동기화 줄 (10.1절 · 15.6절 전부)", () => {
  const dev = (sync, o = {}) => ({ online: true, revoked: false, sync, ...o });
  const s = (state, counts = {}, extra = {}) => ({ enabled: true, state, root_label: "논문", last_sync_at: null, counts, ...extra });
  test("켠 적 없음 · 해지 · 꺼짐", () => {
    assert.equal(D.syncWebLine(dev(null)), null);
    assert.equal(D.syncWebLine(dev(s("idle"), { revoked: true })), null);
    assert.match(D.syncWebLine(dev(s("off", {}, { enabled: false }))).text, /^꺼짐/);
    assert.match(D.syncWebLine(dev(s("idle"), { online: false })).text, /\(PC 꺼짐\)$/);
  });
  test("상태 값마다 문구가 있다", () => {
    for (const st of ["idle", "scanning", "preview", "syncing", "paused", "waiting_confirm", "root_missing", "offline",
      "storage_full", "update_required", "account_mismatch"]) {
      const line = D.syncWebLine(dev(s(st)));
      assert.ok(line && line.text, st);
    }
    assert.equal(D.syncWebLine(dev(s("storage_full", { reason: "sync_quota" }))).text, "! 올리기 멈춤 — 이 PC의 올리기 한도에 닿았어요");
    assert.equal(D.syncWebLine(dev(s("storage_full", { reason: "db" }))).tone, "warn");
    assert.equal(D.syncWebLine(dev(s("waiting_confirm", { waiting_confirm: 12 }))).text, "! 멈춤 — 이 PC에서 확인이 필요해요 (파일 12개 지우기)");
    assert.equal(D.syncWebLine(dev(s("idle", { files: 312, problems: 2 }))).text, "✓ 최신 · ‘논문’ 폴더 · 파일 312개 · 맞추지 못한 파일 2개");
  });
});

describe("충돌 사본 (10.4절)", () => {
  test("원래 이름 · 태그 표시", () => {
    assert.equal(L.conflictOriginal("Smith 2020 (충돌 사본 집 PC 2026-10-13).pdf"), "Smith 2020.pdf");
    assert.equal(L.conflictOriginal("Smith 2020 (충돌 사본 집 PC 2026-10-13 2).PDF"), "Smith 2020.PDF");
    assert.equal(L.conflictOriginal("plain.pdf"), "");
    assert.equal(L.tagKind({ name: "충돌 사본", color: "" }), ' data-tag-kind="conflict"');
    assert.equal(L.tagKind({ name: "충돌 사본", color: "#e03131" }), "");
  });
});

// 앱 창 로그인 대기를 웹에서 취소 · 시간 초과하면 앱(0.3.1+)의 대기도 풀게 알림 — 옛 앱은 함수가 없으니 옵셔널 호출, 결과는 기다리지 않음
describe("앱 로그인 취소 알림", () => {
  const app = readFileSync(new URL("../../paperlab/static/js/app.js", import.meta.url), "utf8");
  test("cancelGoogleLogin은 ?.()로만, await 없이", () => {
    assert.match(app, /window\.paperlabDesktop\?\.cancelGoogleLogin\?\.\(\)/);
    assert.ok(!/await[^;\n]*cancelGoogleLogin/.test(app));
  });
  test("[취소] 단추와 대기 시간 초과 둘 다 부름", () => {
    assert.match(app, /\[data-desktop-cancel\]", gate\)\.onclick = \(\) => \{[^}]*cancelDesktopLogin\(\)/);
    const wait = app.slice(app.indexOf("desktopWait = { selectAccount"), app.indexOf("DESKTOP_WAIT_MS) }"));
    assert.match(wait, /cancelDesktopLogin\(\)/);
  });
});
