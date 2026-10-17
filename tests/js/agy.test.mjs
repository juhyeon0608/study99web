// Antigravity(agy) 엔진 웹 문구 (2026-10-17): 연결된 PC 칩 · 모델 고르기 · 엔진 순서 · 작업 문구 — 순수 함수만
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.document = { addEventListener() {}, hidden: false, querySelector() { return null; }, querySelectorAll() { return []; } };
globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
const D = await import("../../paperlab/static/js/dialogs.js");
const J = await import("../../paperlab/static/js/jobs.js");
const src = (f) => readFileSync(new URL(`../../paperlab/static/js/${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

const MODELS = [{ id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" }, { id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Thinking)" }];
const dev = (engines, o = {}) => ({ id: 1, name: "집 PC", online: true, paused: false, revoked: false, engines, ...o });
const text = (html) => html.replace(/<[^>]+>/g, "|").split("|").map((s) => s.trim()).filter(Boolean);

describe("연결된 PC 카드의 엔진 칩", () => {
  test("claude ✓ · codex 로그인 필요 · gemini 없음 · Antigravity ✓ 동시 1", () => {
    const html = D.engineChips(dev([{ name: "claude", version: "2.1.300", logged_in: true, slots: 2 }, { name: "codex", logged_in: false, slots: 1 },
      { name: "agy", version: "1.4.0", logged_in: true, slots: 1, models: MODELS }]));
    assert.deepEqual(text(html), ["claude ✓ · 동시 2", "codex ! 로그인 필요", "gemini 없음", "Antigravity ✓ · 동시 1"]);
    assert.match(html, /<span class="chip success" data-engine-chip="agy" title="Antigravity 1\.4\.0">/);
  });
  test("Antigravity 로그인 필요 · 없음", () => {
    assert.ok(text(D.engineChips(dev([{ name: "agy", logged_in: false, slots: 1 }]))).includes("Antigravity ! 로그인 필요"));
    assert.ok(text(D.engineChips(dev([]))).includes("Antigravity 없음"));
    assert.match(D.engineChips(dev([{ name: "agy", logged_in: false }])), /class="chip warn" data-engine-chip="agy"/);
  });
  test("버전 글은 이스케이프", () => {
    const html = D.engineChips(dev([{ name: "agy", version: '"><img src=x onerror=alert(1)>', logged_in: true, slots: 1 }]));
    assert.doesNotMatch(html, /<img/);
  });
});

describe("PC의 Antigravity 모델 고르기", () => {
  test("PaperLab 기본 + 연결된 PC들의 모델(합집합 · 해지 PC 제외)", () => {
    const other = dev([{ name: "agy", logged_in: true, models: [{ id: "gpt-oss-120b-medium", label: "GPT-OSS 120B (Medium)" }, MODELS[0]] }], { id: 2 });
    const gone = dev([{ name: "agy", logged_in: true, models: [{ id: "secret-model-x", label: "x" }] }], { id: 3, revoked: true });
    const opts = D.agyModelOptions([dev([{ name: "agy", logged_in: true, models: MODELS }]), other, gone], "default");
    assert.deepEqual(opts.map((o) => o.value), ["default", "gemini-3.8-flash-high", "gemini-3.8-flash-medium", "claude-sonnet-4-6", "gpt-oss-120b-medium"]);
    assert.equal(opts[0].label, "PaperLab 기본 (Gemini 3.8 Flash (Medium))");
    assert.equal(opts[0].selected, true);
    assert.equal(opts[3].label, "Claude Sonnet 4.6 (Thinking) · claude-sonnet-4-6");
  });
  test("고른 모델이 지금 목록에 없으면 남겨 둠 · PC가 없으면 기본만", () => {
    const opts = D.agyModelOptions([], "claude-opus-4-6-thinking");
    assert.deepEqual(opts.map((o) => [o.value, o.selected]), [["default", false], ["claude-opus-4-6-thinking", true]]);
    assert.equal(opts[0].label, "PaperLab 기본 (gemini-3.8-flash-medium)");
    assert.match(opts[1].label, /연결된 PC 목록에 없음/);
    const sel = D.agyModelOptions([dev([{ name: "agy", models: MODELS }])], "claude-sonnet-4-6");
    assert.equal(sel.find((o) => o.selected).value, "claude-sonnet-4-6");
  });
  test("설정 화면: 모델 · 생각 깊이를 cli_models.agy · cli_efforts.agy로 저장, 고른 값은 esc", () => {
    const s = src("dialogs.js");
    assert.match(s, /cli_models: \{ claude: [^}]*agy: \$\("#set-cli-agy", body\)\.value/);
    assert.match(s, /cli_efforts: \{ agy: \$\("#set-cli-agy-effort", body\)\.value/);
    assert.match(s, /value="\$\{esc\(o\.value\)\}"[^>]*>\$\{esc\(o\.label\)\}/);
    for (const k of ["cli_model_agy", "cli_effort_agy"]) assert.ok(s.includes(`"${k}"`), k); // 폼 칸은 그대로 보내지 않음
    for (const e of ["low", "medium", "high", "xhigh", "max"]) assert.ok(s.includes(`["${e}", `), e);
  });
});

describe("엔진 순서 · 작업 문구", () => {
  test("작업별 엔진 순서에 Antigravity를 고를 수 있음 (gemini는 그대로)", () => {
    assert.deepEqual(D.ROUTE_ENGINES, ["claude", "codex", "gemini", "agy"]);
    assert.match(src("dialogs.js"), /const ENGINE_LABEL = \{[^}]*gemini: "Gemini", agy: "Antigravity" \}/);
  });
  test("PC의 Antigravity · 대기 · 실행 · 완료 · 오류 이름", () => {
    const job = (o) => ({ id: 1, kind: "summary", status: "queued", runner: "cli", engine: "agy", route: [{ runner: "cli", engine: "agy" }], route_index: 0,
      waiting_reason: null, progress: {}, attempts: 0, error: "", error_code: "", history: [], device: null, cancel_requested: false, ...o });
    assert.equal(J.engineName("agy"), "Antigravity");
    assert.equal(J.engineName("codex"), "codex");
    assert.equal(J.slotName({ runner: "cli", engine: "agy" }), "PC의 Antigravity");
    assert.equal(J.jobLine(job({ waiting_reason: "no_engine_on_worker" })), "PC에서 실행 대기 중 — Antigravity가 있는 PC가 없어요");
    assert.match(J.jobLine(job({ status: "running", device: { name: "집 PC" } })), /^‘집 PC’에서 실행 중 \(Antigravity\)/);
    assert.equal(J.jobLine(job({ status: "succeeded", device: { name: "집 PC" } })), "완료 · ‘집 PC’(Antigravity)에서 실행");
    assert.equal(J.errorLabel("cli_not_logged_in", "agy"), "Antigravity 로그인 안 됨");
    assert.equal(J.errorLabel("cli_not_found", "codex"), "codex 설치 안 됨");
  });
});
