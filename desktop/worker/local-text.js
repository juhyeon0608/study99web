'use strict';
// 로컬 항목 AI의 본문 채우기 (명세 selective-sync.md 7.4 · 9.4절, 계약 C-4) — 순수 함수.
// 서버는 로컬 항목(PC에만 둔 파일)의 프롬프트에 본문 대신 표지(LOCAL_TEXT_MARKER)를 한 번 넣어 보낸다. 보관 PC 워커가 main 에
// 로컬 파일의 글 조각(PDF = 쪽, 문서 = 9.5.2절 단위)을 청해 Python ai.PaperContext.tagged_text 와 같은 모양으로 감싸 표지를 바꾼다.
// fence 는 Python ai.fence 와 같은 결과여야 한다(공유 시험 벡터 tests/fixtures/fence_vectors.json — AC-S54).
// 본문은 이 PC의 CLI 로만 가고 서버 · 로그 · 디스크에 남지 않는다(P-2 · 11장 7).

const LOCAL_TEXT_MARKER = '⁣PAPERLAB_LOCAL_PAPER_TEXT⁣';
const PROMPT_MAX = 4 * 1024 * 1024; // 서버 jobs.PROMPT_MAX 와 같음(UTF-8 바이트)

// Python: re.compile(r"<(/?)(paper|page|context|selection|abstract|sources?|evidence|claim|conversation|text)\b", re.I)
// \b(유니코드) = 뒤 글자가 단어 글자(문자 · 숫자 · _ — str.isalnum 또는 _)가 아님. 태그 이름은 늘 단어 글자로 끝나므로 부정 앞보기로 같음.
const FENCE_RE = /<(\/?)(paper|page|context|selection|abstract|sources?|evidence|claim|conversation|text)(?![\p{L}\p{N}_])/giu;

/** 자료 안의 우리 태그 모양을 무디게 — `<` → `‹` (Python ai.fence 와 같음) */
function fence(text) {
  return String(text == null ? '' : text).replace(FENCE_RE, (_m, slash, name) => `‹${slash}${name}`);
}

// Python str.strip() 의 공백(str.isspace) — JS trim() 과 다름(\x1c-\x1f · \x85 는 지우고 ﻿ 는 지우지 않음)
const PY_SPACE = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'g');
const pyStrip = (s) => String(s == null ? '' : s).replace(PY_STRIP, '');

/** 글 조각 배열 → '<page number="n">\n…\n</page>' 를 빈 줄로 이음(Python PaperContext.tagged_text 와 같음) */
function taggedText(pages) {
  return (pages || []).map((t, i) => `<page number="${i + 1}">\n${fence(pyStrip(t))}\n</page>`).join('\n\n');
}

class LocalTextError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const countMarker = (s) => String(s).split(LOCAL_TEXT_MARKER).length - 1;

/**
 * 표지를 본문으로 바꾼 프롬프트. 실패하면 LocalTextError(code):
 * bad_input(표지가 정확히 한 번이 아님) · local_no_text(글이 비었음) · input_too_large(4MB 넘음)
 */
function fillPrompt(prompt, pages) {
  const p = String(prompt == null ? '' : prompt);
  if (countMarker(p) !== 1) throw new LocalTextError('bad_input', '작업 프롬프트의 본문 자리 표지가 올바르지 않아요');
  const list = Array.isArray(pages) ? pages.map((t) => String(t == null ? '' : t)) : [];
  if (!list.some((t) => pyStrip(t))) throw new LocalTextError('local_no_text', '이 파일에서 글자를 읽지 못했어요(사진 · 스캔본)');
  const body = taggedText(list);
  const i = p.indexOf(LOCAL_TEXT_MARKER);
  const out = p.slice(0, i) + body + p.slice(i + LOCAL_TEXT_MARKER.length); // replace() 의 $ 패턴을 피함
  if (Buffer.byteLength(out, 'utf8') > PROMPT_MAX) throw new LocalTextError('input_too_large', '파일 내용이 너무 길어 AI에 보낼 수 없어요');
  return out;
}

// 실패 결과 문구(서버 DEFAULT_ERRORS 와 같은 뜻 — 화면은 서버 문구를 씀, 여기 문구는 결과 error 칸)
const MESSAGES = {
  local_file: '이 PC에서 파일을 찾지 못했어요(옮겼거나 고치는 중일 수 있어요). 잠시 뒤 다시 해 주세요.',
  local_unsupported: '이 PC에서 이 형식의 내용을 읽지 못해 AI를 쓸 수 없어요.',
  local_unreadable: '이 파일의 내용을 읽지 못했어요(손상 · 암호 · 배포용 문서이거나 너무 커요).',
  local_no_text: '이 파일에서 글자를 읽지 못했어요(사진 · 스캔본).',
  bad_input: '작업 프롬프트의 본문 자리 표지가 올바르지 않아요',
  input_too_large: '파일 내용이 너무 길어 AI에 보낼 수 없어요',
};
const LOCAL_CODES = new Set(['local_file', 'local_unsupported', 'local_unreadable', 'local_no_text']);

/** 작업의 local 필드 검사(C-4): {paper_id: 양의 정수, sha256: 64자 16진} — 아니면 null */
function localSpec(task) {
  const l = task && task.local;
  if (!l || typeof l !== 'object') return null;
  const pid = Number(l.paper_id);
  const sha = String(l.sha256 || '');
  if (!Number.isSafeInteger(pid) || pid <= 0 || !/^[0-9a-f]{64}$/.test(sha)) return null;
  return { paper_id: pid, sha256: sha, ext: String(l.ext || '').toLowerCase().slice(0, 8), kind: String(l.kind || '') };
}

module.exports = { LOCAL_TEXT_MARKER, PROMPT_MAX, fence, taggedText, fillPrompt, LocalTextError, MESSAGES, LOCAL_CODES, localSpec, pyStrip };
