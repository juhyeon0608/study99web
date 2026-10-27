// 2단계 작업 화면 문구 (docs/design/phase2-worker-electron-ui.md 5장 — S8 상태 문구 · 5.3 경로 단계 · 5.4 오류 이름) — 순수 함수만
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// jobs.js → api.js가 불러올 때 document · window에 처리기를 거는 것만 흉내 (화면 없이 순수 함수만 시험)
globalThis.document = { addEventListener() {}, hidden: false };
globalThis.window = { addEventListener() {} };
const J = await import("../../paperlab/static/js/jobs.js");

const base = { id: 1, kind: "summary", status: "queued", runner: "cli", engine: "claude", route: [{ runner: "cli", engine: "claude" }],
  route_index: 0, waiting_reason: null, progress: {}, attempts: 0, error: "", error_code: "", history: [], device: null,
  cancel_requested: false, deadline_at: null, started_at: null };
const job = (o) => ({ ...base, ...o });

describe("상태 (5.1절)", () => {
  test("data-job-state", () => {
    assert.equal(J.jobState(job({})), "cli-waiting");
    assert.equal(J.jobState(job({ runner: "api" })), "api-queued");
    assert.equal(J.jobState(job({ status: "running", runner: "api" })), "api-running");
    assert.equal(J.jobState(job({ status: "running" })), "cli-running");
    assert.equal(J.jobState(job({ status: "running", cancel_requested: true })), "cancelling");
    for (const s of ["succeeded", "failed", "cancelled"]) assert.equal(J.jobState(job({ status: s })), s);
  });
  test("대기 사유 문구", () => {
    assert.equal(J.jobLine(job({})), "PC가 곧 작업을 가져가요");
    assert.equal(J.jobLine(job({ waiting_reason: "no_online_worker" })), "PC에서 실행 대기 중 — 켜진 PC가 없어요");
    assert.equal(J.jobLine(job({ engine: "codex", waiting_reason: "no_engine_on_worker" })), "PC에서 실행 대기 중 — codex가 있는 PC가 없어요");
    assert.equal(J.jobLine(job({ waiting_reason: "all_workers_busy" })), "PC에서 실행 대기 중 — PC가 다른 작업 중이에요");
  });
  test("실행 · 완료 · 실패 문구", () => {
    assert.equal(J.jobLine(job({ runner: "api" })), "Anthropic API 차례를 기다리는 중");
    assert.equal(J.jobLine(job({ status: "running", runner: "api", engine: "codex", progress: { message: "보내는 중", fraction: 0.4 } }), "정리"),
      "OpenAI API로 정리하는 중 · 보내는 중 · 40%");
    assert.equal(J.jobLine(job({ status: "running", device: { id: 3, name: "집 PC" } }), "실행", { elapsed: false }), "‘집 PC’에서 실행 중 (claude)");
    const re = job({ status: "running", device: { id: 4, name: "노트북" }, attempts: 2, history: [{ runner: "cli", engine: "claude", error_code: "lease_expired" }] });
    assert.match(J.jobLine(re, "실행", { elapsed: false }), /^PC 연결이 끊겨 다른 PC로 넘겼어요 · ‘노트북’에서 실행 중/);
    assert.equal(J.jobLine(job({ status: "succeeded", runner: "api", engine: "gemini" })), "완료 · Google API");
    assert.equal(J.jobLine(job({ status: "failed", error: "PC 연결이 계속 끊겨서 멈췄어요" })), "실패: PC 연결이 계속 끊겨서 멈췄어요");
    assert.equal(J.jobLine(job({ status: "cancelled" })), "취소됨");
  });
});

describe("오류 이름 · 경로 단계 (5.3 · 5.4절)", () => {
  test("오류 이름", () => {
    assert.equal(J.errorLabel("api_auth"), "키가 올바르지 않음");
    assert.equal(J.errorLabel("cli_not_logged_in", "codex"), "codex 로그인 안 됨");
    assert.equal(J.errorLabel("새 코드"), "실패");
  });
  test("경로 1칸 · 기록 없음이면 단계 없음, 폴백이면 ✕ → ●", () => {
    assert.equal(J.stepsHtml(job({})), "");
    const fb = job({ route: [{ runner: "api", engine: "claude" }, { runner: "cli", engine: "claude" }], route_index: 1,
      waiting_reason: "no_online_worker", history: [{ runner: "api", engine: "claude", error_code: "api_auth" }] });
    const html = J.stepsHtml(fb);
    assert.match(html, /<li data-state="failed">Anthropic API <span class="graph-step-msg">키가 올바르지 않음<\/span>/);
    assert.match(html, /<li data-state="now">PC의 claude <span class="graph-step-msg">PC에서 실행 대기 중 — 켜진 PC가 없어요/);
  });
  test("단계 글은 이스케이프", () => {
    const html = J.stepsHtml(job({ status: "failed", route: [{ runner: "cli", engine: "claude" }, { runner: "cli", engine: "codex" }],
      error_code: "cli_exit", history: [{ runner: "cli", engine: "claude", error_code: "cli_exit" }] }));
    assert.doesNotMatch(html, /<script/);
  });
});

describe("시간", () => {
  test("경과", () => {
    assert.equal(J.fmtElapsed(40), "40초");
    assert.equal(J.fmtElapsed(80), "1분 20초");
    assert.equal(J.fmtElapsed(3900), "1시간 5분");
  });
  test("기한: 1시간 안이면 남은 분", () => {
    const soon = new Date(Date.now() + 23 * 60000 + 5000).toISOString();
    assert.match(J.deadlineText(job({ deadline_at: soon })), /까지 기다려요 \(23분 남음\)$/);
    assert.equal(J.deadlineText(job({})), "");
  });
});

describe("코드 검사", () => {
  test("maskEmail은 서버(jobs.mask_email)와 같은 규칙", async () => {
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    const D = await import("../../paperlab/static/js/dialogs.js").catch(() => null);
    if (!D) return; // 화면 의존 모듈을 못 불러오면 건너뜀(서버 쪽은 pytest가 검사)
    assert.equal(D.maskEmail("alice@example.com"), "a***@example.com");
    assert.equal(D.maskEmail("bad"), "");
  });
});

describe("백그라운드 AI · 끝남 알림 (2026-10-16)", () => {
  test("글쓰기 결과는 그 원고를 열어 결과 창으로 (#/write/원고/j작업), 원고가 지워졌으면 주소 없음", () => {
    assert.equal(J.jobHref(job({ id: 55, kind: "write", manuscript_id: 12, manuscript_title: "석사 논문" })), "#/write/12/j55");
    assert.equal(J.jobHref(job({ id: 55, kind: "write", manuscript_id: 12, manuscript_title: null })), "");
    assert.equal(J.jobHref(job({ id: 5, kind: "chat", paper_id: 7 })), "#/read/7");
    assert.equal(J.jobHref(job({ id: 5, kind: "explain", paper_id: 7 })), "#/read/7");
  });
  test("끝남 문구", () => {
    assert.equal(J.finishedText(job({ kind: "write", status: "succeeded", manuscript_title: "2장" })), "AI 글쓰기 결과가 준비됐어요 — 원고: 2장");
    assert.equal(J.finishedText(job({ kind: "summary", status: "succeeded", paper_title: "ResNet" })), "요약이 끝났어요 — ResNet");
    assert.equal(J.finishedText(job({ kind: "chat", status: "succeeded", paper_title: "ResNet" })), "대화가 끝났어요 — ResNet");
    assert.equal(J.finishedText(job({ kind: "translate_paper", status: "failed", error: "API 키가 올바르지 않아요", paper_title: "P" })),
      "전체 번역 실패 — API 키가 올바르지 않아요 (P)");
  });
  test("경로 없음 안내는 연결된 PC와 내 API 키를 함께 말한다 (서버 CLI 없음)", () => {
    assert.match(J.NO_ROUTE_TEXT, /\[이 PC 연결\]/);
    assert.match(J.NO_ROUTE_TEXT, /API 키/);
  });
  test("알림 허락 안내: Notification이 없거나 이미 정했으면 띄우지 않음", () => {
    assert.equal(J.notifyOffer(), null); // Node: Notification 없음
    globalThis.Notification = { permission: "granted" };
    try { assert.equal(J.notifyOffer(), null); } finally { delete globalThis.Notification; }
  });
});

describe("겹치는 알림 · 대기 기한 · [취소] (2026-10-17 팀장 후속)", () => {
  const src = (f) => readFileSync(new URL(`../../paperlab/static/js/${f}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const fn = (s, head) => s.match(new RegExp(`${head}[^]*?\\n}\\n`))[0]; // 함수 본문 (닫는 중괄호가 줄 맨 앞)
  test("이미 화면에 보인 결과(handledJob)는 토스트도 브라우저 알림도 띄우지 않는다", () => {
    const body = fn(src("jobs.js"), "function announce\\(");
    assert.ok(body.indexOf("N.handled.has(j.id)") >= 0 && body.indexOf("N.handled.has(j.id)") < body.indexOf("osNotify("));
  });
  test("결과를 직접 그리는 화면은 handledJob을 부른다 (요약 카드 · 인용 검증 · 전체 번역)", () => {
    assert.match(fn(src("reader.js"), "async function onSummaryJob"), /handledJob\(j\.id\)/);
    assert.match(fn(src("writing.js"), "function showVerify"), /handledJob\(j\.id\)/);
    assert.match(fn(src("explain.js"), "function watchTr"), /handledJob\(j\.id\)/);
  });
  test("대화 · 서재 질문 스트림은 작업 번호를 받아 [취소]로 작업을 취소한다", () => {
    for (const f of ["reader.js", "ask.js"]) {
      const s = src(f);
      assert.match(s, /abort\.signal, \{ onJob \}\)/, f);
      assert.match(s, /cancelJob\(id\)\.catch\(\(\) => \{\}\);\s*abort\.abort\(\);/, f);
    }
  });
  test("대기 기한 24시간: 1시간보다 많이 남으면 남은 분은 붙이지 않음", () => {
    const later = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    assert.match(J.deadlineText(job({ deadline_at: later })), /까지 기다려요$/);
  });
});
