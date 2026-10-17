-- 원고 AI 대화 (docs/specs/manuscript-ai-chat.md — 2026-10-17 사용자 요청 "자연어로 대화해서 수정하는 기능").
-- 원고마다 대화 한 줄기: 사용자 질문(user) · AI 답(assistant). 답의 수정 제안(proposals)은 화면이 바뀌는 부분을 보여 주고
-- [적용]을 누를 때만 원고에 넣는다(새 글을 몰래 덮어쓰지 않음). AI 실행은 ms_chat 작업(내 PC CLI · 내 API 키 — 서버 CLI 없음).
-- 추가만 한다 — 표 하나(기존 표 · 행 그대로). 다시 돌려도 안전(if not exists · drop … if exists).
-- jobs.kind 제약(ms_chat)은 20261017000006_ai_writing_kinds.sql 한 곳에서만 바꾼다.

create table if not exists paperlab.ms_chat_messages (
    id            bigint generated always as identity primary key,
    user_id       uuid not null references auth.users (id) on delete cascade,
    manuscript_id bigint not null,
    role          text not null check (role in ('user', 'assistant')),
    content       text not null check (char_length(content) <= 40000),
    -- 보낸 범위 {kind, label, from, to, fingerprint, chars} (범위 글은 작업 params에만 — 여기에는 넣지 않음).
    -- 답에는 reply_to(질문 id) · note도
    scope         jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(scope) = 'object' and octet_length(scope::text) <= 4096),
    -- 수정 제안 [{find, replace, at, state}] — at = 질문을 보낼 때 원고의 위치(UTF-16), state = applied | discarded
    proposals     jsonb not null default '[]'::jsonb
                  check (jsonb_typeof(proposals) = 'array' and octet_length(proposals::text) <= 262144),
    job_id        bigint,      -- 만든 · 답한 작업 (작업 행은 30일 뒤 지워지므로 외래 키 없음)
    created_at    timestamptz not null default now(),
    -- 원고를 지우면 대화도 (원고 주인과 같은 사용자만 — 복합 외래 키, manuscripts_id_user_uniq)
    constraint ms_chat_messages_manuscript_fk foreign key (manuscript_id, user_id)
        references paperlab.manuscripts (id, user_id) on delete cascade
);
create index if not exists ms_chat_messages_ms on paperlab.ms_chat_messages (user_id, manuscript_id, id desc);

alter table paperlab.ms_chat_messages enable row level security;
alter table paperlab.ms_chat_messages force row level security;
drop policy if exists own_rows on paperlab.ms_chat_messages;
create policy own_rows on paperlab.ms_chat_messages for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.ms_chat_messages to authenticated;
-- 백업(pg_dump --role=service_role)용 — 1단계 grant는 그때 있던 표에만 적용되므로 새 표에 다시 준다
grant select, insert, update, delete on paperlab.ms_chat_messages to service_role;
grant usage, select on all sequences in schema paperlab to service_role;
