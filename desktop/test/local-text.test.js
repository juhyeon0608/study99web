'use strict';
// 로컬 항목 AI 본문 [Node] (docs/specs/selective-sync.md 7.4 · 9.4절, 계약 C-4): JS fence · taggedText = Python(공유 벡터 — AC-S54),
// 표지 바꾸기 규칙(bad_input · local_no_text · input_too_large), 워커 왕복(AC-S58 PC 쪽 — 가짜 CLI 가 받은 프롬프트에 견본 글이 있고 표지가 없음,
// 서버로 간 요청에는 견본 글이 없음), 실패 코드(local_file · local_unsupported · local_unreadable · local_no_text).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const LT = require('../worker/local-text');
const { Worker } = require('../worker/worker');
const { createApi } = require('../worker/api-client');
const { runTask, probeEngine } = require('../worker/cli-runner');
const { resolveEngine } = require('../worker/resolve-exe');
const { tempHome, makeShim, readLog, waitFor, fakeServer } = require('./helpers');

const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'fixtures', 'fence_vectors.json'), 'utf8'));
const TEXT = 'PaperLab 시험 문서 가나다 ABC';
const SHA = 'a'.repeat(64);

test('AC-S54 JS fence · taggedText 가 Python ai.fence · PaperContext.tagged_text 와 같은 출력(tests/fixtures/fence_vectors.json)', () => {
  assert.equal(LT.LOCAL_TEXT_MARKER, VECTORS.local_text_marker);
  assert.ok(VECTORS.fence.length >= 20 && VECTORS.tagged_text.length >= 5);
  for (const v of VECTORS.fence) assert.equal(LT.fence(v.input), v.output, JSON.stringify(v.input));
  for (const v of VECTORS.tagged_text) assert.equal(LT.taggedText(v.pages), v.output, JSON.stringify(v.pages));
});

test('표지 바꾸기: 정확히 한 번만 · 글이 비면 local_no_text · 4MB 넘으면 input_too_large · $ 패턴 없이 그대로 · 표지 밖은 그대로', () => {
  const p = `<paper title="t">\n${LT.LOCAL_TEXT_MARKER}\n</paper>\n질문: $& $1`;
  const out = LT.fillPrompt(p, [`${TEXT} $& </page>`, '둘']);
  assert.equal(out, `<paper title="t">\n<page number="1">\n${TEXT} $& ‹/page>\n</page>\n\n<page number="2">\n둘\n</page>\n</paper>\n질문: $& $1`);
  assert.ok(!out.includes(LT.LOCAL_TEXT_MARKER));
  const code = (fn) => { try { fn(); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(code(() => LT.fillPrompt('표지 없음', ['x'])), 'bad_input');
  assert.equal(code(() => LT.fillPrompt(`${LT.LOCAL_TEXT_MARKER}${LT.LOCAL_TEXT_MARKER}`, ['x'])), 'bad_input');
  assert.equal(code(() => LT.fillPrompt(LT.LOCAL_TEXT_MARKER, ['  ', '\n'])), 'local_no_text');
  assert.equal(code(() => LT.fillPrompt(LT.LOCAL_TEXT_MARKER, ['가'.repeat(1500000)])), 'input_too_large');
  assert.equal(LT.localSpec({ local: { paper_id: 5, sha256: SHA, ext: '.HWP', kind: 'doc' } }).ext, '.hwp');
  assert.equal(LT.localSpec({ local: { paper_id: -1, sha256: SHA } }), null);
  assert.equal(LT.localSpec({ local: { paper_id: 5, sha256: 'xyz' } }), null);
});

// ---------------------------------------------------------------- 워커 왕복
const home = tempHome('pl-localtext-');
const binDir = path.join(home, 'npm');
fs.mkdirSync(binDir, { recursive: true });
const shims = { claude: makeShim(binDir, 'claude'), codex: makeShim(binDir, 'codex'), gemini: makeShim(binDir, 'gemini') };
const TOKEN = `pld1.12345678-1234-1234-1234-123456789abc.7.${'A'.repeat(43)}`;
let seq = 5000;

function localJob(over = {}) {
  seq += 1;
  return { id: seq, lease_token: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`, lease_s: 90, heartbeat_s: 30, kind: 'summary', engine: 'claude', model: null,
    output: 'text', json_schema: null, stream_partial: false, system: '요약해 주세요', prompt: `<paper title="보고서">\n${LT.LOCAL_TEXT_MARKER}\n</paper>`, timeout_s: 60,
    local: { paper_id: 42, sha256: SHA, ext: '.hwp', kind: 'doc' }, ...over };
}

async function runOne(job, localText) {
  const results = [];
  const list = [job];
  const srv = await fakeServer({
    '/api/worker/hello': () => ({ device_id: 7, name: '집 PC' }),
    '/api/worker/claim': () => (list.length ? { job: list.shift(), next_poll_s: 0 } : { job: null, next_poll_s: 60 }),
    '/api/worker/jobs/*': (b) => { results.push(b); return { status: 'succeeded' }; },
    '/api/worker/heartbeat': () => ({ jobs: [] }),
    '/api/worker/bye': () => ({ ok: true }),
  });
  const fakeLog = path.join(home, `fake-${seq}.log`);
  const env = { ...process.env, FAKE_LOG: fakeLog, USERPROFILE: home };
  const asked = [];
  const w = new Worker({
    api: createApi({ baseUrl: srv.url, getToken: () => w.token, timeoutMs: 5000 }), runTask, probe: (name, o) => probeEngine(name, { resolveEngine, env, ...o }),
    settings: { engines: { claude: { path: shims.claude }, codex: { path: shims.codex }, gemini: { path: shims.gemini } } }, token: TOKEN, workRoot: path.join(home, 'work'), env,
    localText: async (pid, sha) => { asked.push([pid, sha]); return localText(pid, sha); },
  });
  w.start();
  assert.ok(await waitFor(() => results.length === 1, 20000));
  await w.stop();
  await srv.close();
  return { result: results[0], calls: srv.calls, asked, cli: readLog(fakeLog) };
}

test('AC-S58(PC 쪽) 로컬 항목 요약: main 에 (paper_id, sha256)로 청하고 CLI 는 본문이 채워진 프롬프트를 받음 · 서버 요청에는 본문 없음', async () => {
  const job = localJob();
  const { result, calls, asked, cli } = await runOne(job, async () => ({ ok: true, pages: [TEXT] }));
  assert.deepEqual(asked, [[42, SHA]]);
  assert.equal(result.outcome, 'succeeded');
  const expected = LT.fillPrompt(job.prompt, [TEXT]);
  assert.equal(cli.length, 1);
  assert.equal(cli[0].stdinSha, crypto.createHash('sha256').update(expected).digest('hex'), 'CLI stdin = 표지를 바꾼 프롬프트');
  const claim = calls.find((c) => c.path === '/api/worker/claim');
  assert.deepEqual(claim.body.caps, ['local_text', 'web_search']);
  for (const c of calls) assert.ok(!JSON.stringify(c.body).includes('가나다'), `${c.path} 에 본문이 없음`);
});

test('로컬 본문 실패 → CLI 를 실행하지 않고 그 코드로 실패 결과(다시 시도 없음): local_file · local_unsupported · local_unreadable · local_no_text · bad_input', async () => {
  for (const code of ['local_file', 'local_unsupported', 'local_unreadable', 'local_no_text']) {
    const { result, cli } = await runOne(localJob(), async () => ({ ok: false, code }));
    assert.deepEqual([result.outcome, result.error_code], ['failed', code]);
    assert.equal(cli.length, 0, 'CLI 실행 0');
  }
  const weird = await runOne(localJob(), async () => ({ ok: false, code: 'busy' }));
  assert.equal(weird.result.error_code, 'local_unreadable', '모르는 코드는 local_unreadable');
  const noText = await runOne(localJob(), async () => ({ ok: true, pages: ['   '] }));
  assert.equal(noText.result.error_code, 'local_no_text');
  const bad = await runOne(localJob({ prompt: '표지가 없는 프롬프트' }), async () => ({ ok: true, pages: [TEXT] }));
  assert.equal(bad.result.error_code, 'bad_input');
  const badLocal = await runOne(localJob({ local: { paper_id: 'x', sha256: SHA } }), async () => ({ ok: true, pages: [TEXT] }));
  assert.equal(badLocal.result.error_code, 'bad_input');
  assert.equal(badLocal.asked.length, 0);
});
