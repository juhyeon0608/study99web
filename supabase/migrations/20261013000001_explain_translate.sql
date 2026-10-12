-- 4단계 쉬운 설명 · 번역 (docs/specs/phase4-explain-translate.md 8.1절).
-- 1단계 규칙 그대로: bigint identity, 공통 user_id + 복합 외래 키, 같은 파일 안에서 RLS(enable + force + own_rows).
-- 큰 번역 본문은 R2 파일(users/{uid}/translations/{paper_id}.{gen}.json) — DB에는 작은 메타만(K-5).

-- -------------------------------------------------------------- explanations
-- 선택 설명 · 번역 기록 겸 캐시(K-4). 같은 (논문, 종류, 언어, 정규화 글 해시)는 한 행 — 다시 만들기(force)는 그 행을 갱신
create table paperlab.explanations (
    id          bigint generated always as identity primary key,
    user_id     uuid not null references auth.users (id) on delete cascade,
    paper_id    bigint not null,
    kind        text not null check (kind in ('explain', 'translate')),
    lang        text not null check (char_length(lang) between 1 and 20),
    sel_hash    text not null check (sel_hash ~ '^[0-9a-f]{64}$'),
    page        integer not null check (page between 1 and 100000),
    rects       jsonb not null default '[]'::jsonb check (jsonb_typeof(rects) = 'array' and jsonb_array_length(rects) <= 20),
    source_text text not null check (char_length(source_text) between 1 and 4000),
    result      jsonb not null check (jsonb_typeof(result) = 'object' and octet_length(result::text) <= 65536),
    engine      text not null default '' check (char_length(engine) <= 20),
    model       text not null default '' check (char_length(model) <= 100),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (user_id, paper_id, kind, lang, sel_hash),
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete cascade
);
create index explanations_user_paper on paperlab.explanations (user_id, paper_id, created_at desc);
create index explanations_user_updated on paperlab.explanations (user_id, updated_at);
alter table paperlab.explanations enable row level security;
alter table paperlab.explanations force row level security;
create policy own_rows on paperlab.explanations for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.explanations to authenticated;

-- -------------------------------------------------------------- translations
-- 논문당 번역본 하나. page_state = 쪽마다 한 글자(- 대기 · d 끝 · f 실패 · s 건너뜀 · r 참고문헌 이후 · . 범위 밖).
-- tr_key: 모양만 검사하고 uid가 그 행의 user_id와 같은지는 서버가 검사한다(8.2절)
create table paperlab.translations (
    id           bigint generated always as identity primary key,
    user_id      uuid not null references auth.users (id) on delete cascade,
    paper_id     bigint not null,
    lang         text not null check (lang in ('ko', 'en', 'ja', 'zh')),
    tr_key       text not null check (tr_key ~ '^users/[0-9a-f-]{36}/translations/[1-9][0-9]{0,18}\.[0-9a-f]{8}\.json$'),
    pdf_sha256   text not null default '' check (char_length(pdf_sha256) <= 64),
    page_state   text not null check (char_length(page_state) between 1 and 100000 and page_state ~ '^[-dfsr.]+$'),
    page_errors  jsonb not null default '{}'::jsonb check (jsonb_typeof(page_errors) = 'object'),
    include_refs boolean not null default false,
    refs_from    integer check (refs_from >= 1),
    engine       text not null default '' check (char_length(engine) <= 20),
    model        text not null default '' check (char_length(model) <= 100),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (user_id, paper_id),
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete cascade
);
alter table paperlab.translations enable row level security;
alter table paperlab.translations force row level security;
create policy own_rows on paperlab.translations for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.translations to authenticated;

-- 백업(pg_dump --role=service_role)용
grant select, insert, update, delete on paperlab.explanations, paperlab.translations to service_role;

-- ---------------------------------------------------------------------- jobs
-- 새 종류: explain · translate(선택 — SSE/큐), translate_paper(전체 번역 — 백그라운드). 엔진 local은 그대로 index만
alter table paperlab.jobs drop constraint jobs_kind_check;
alter table paperlab.jobs add constraint jobs_kind_check
    check (kind in ('summary', 'chat', 'write', 'index', 'find', 'verify', 'explain', 'translate', 'translate_paper'));
-- 진행 중 전체 번역은 논문당 하나 (6.1절 — 두 번 누르면 기존 작업)
create unique index jobs_one_translation on paperlab.jobs (user_id, paper_id, kind)
    where kind = 'translate_paper' and status in ('queued', 'running');

grant usage on all sequences in schema paperlab to authenticated;
grant usage, select on all sequences in schema paperlab to service_role;
