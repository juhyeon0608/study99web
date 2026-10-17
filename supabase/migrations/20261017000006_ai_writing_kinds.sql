-- AI 글쓰기 확장 (2026-10-17 사용자 요청): 원고 AI 대화 · 그림 만들기(SVG) · 맞춤법 점검 작업 종류.
-- 세 기능을 병렬로 개발하므로 jobs.kind 제약은 이 파일 한 곳에서만 넓힌다(다른 마이그레이션은 이 제약을 건드리지 않음).
-- 추가만 한다 — 기존 종류는 그대로. 다시 돌려도 안전하게 drop if exists → add.

alter table paperlab.jobs drop constraint if exists jobs_kind_check;
alter table paperlab.jobs add constraint jobs_kind_check
    check (kind in ('summary', 'chat', 'write', 'index', 'find', 'verify', 'explain', 'translate', 'translate_paper',
                    'ms_chat', 'figure', 'proofread'));
