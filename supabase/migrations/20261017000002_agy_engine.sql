-- 새 PC 엔진 agy (Google Antigravity CLI — 제품 이름 "Antigravity", docs/specs/phase2-worker-electron.md 11.9절).
-- 사용자 PC의 PaperLab 앱 워커만 실행한다(API 칸 없음 — 서버 PC는 어떤 AI CLI도 실행하지 않음).
-- 작업 엔진 제약만 넓힌다. 다시 돌려도 안전(있으면 지우고 다시 만듦). 기존 행은 모두 새 제약을 만족한다.
alter table paperlab.jobs drop constraint if exists jobs_engine_check;
alter table paperlab.jobs
    add constraint jobs_engine_check check (engine in ('claude', 'codex', 'gemini', 'agy', 'local'));
