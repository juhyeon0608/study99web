-- 3단계 여러 논문 RAG 질문 · 인용 검증 · AI로 찾기 (docs/specs/phase3-rag-verify-search.md 14.1절).
-- 벡터는 DB에 넣지 않는다(확정 U-2) — pgvector · 벡터 열 없음. papers에는 R2 벡터 파일 포인터(rag_key)와 색인 판(rag_version)만.
-- 1단계 규칙 그대로: 공통 user_id + 복합 외래 키, 같은 파일 안에서 RLS(enable + force + own_rows).

-- -------------------------------------------------------------------- papers
-- rag_key: '' = 파일 없음. 모양만 검사하고 uid가 그 행의 user_id와 같은지는 서버가 검사한다(8.1절)
alter table paperlab.papers
    add column rag_version text not null default '' check (rag_version ~ '^[a-z0-9]{0,16}$'),
    add column rag_key text not null default '' check (
        rag_key = '' or rag_key ~ '^users/[0-9a-f-]{36}/rag/[1-9][0-9]{0,18}\.v[a-z0-9]{1,16}\.[0-9a-f]{8}\.bin$');
create index papers_user_rag on paperlab.papers (user_id, rag_version);

-- ------------------------------------------------------------- chat_sessions
-- 범위 대화: 서재 전체(library) · 컬렉션 · 폴더. 범위마다 세션 하나. 컬렉션 · 폴더를 지우면 그 대화도 지워진다
alter table paperlab.chat_sessions drop constraint chat_sessions_scope_check;
alter table paperlab.chat_sessions
    add column collection_id bigint,
    add column folder_id bigint,
    add constraint chat_sessions_scope_check check (scope in ('paper', 'collection', 'folder', 'library')),
    add constraint chat_sessions_scope_ids check (
        (scope = 'paper' and collection_id is null and folder_id is null)
        or (scope = 'library' and paper_id is null and collection_id is null and folder_id is null)
        or (scope = 'collection' and paper_id is null and collection_id is not null and folder_id is null)
        or (scope = 'folder' and paper_id is null and collection_id is null and folder_id is not null)),
    add constraint chat_sessions_collection_fk foreign key (collection_id, user_id)
        references paperlab.collections (id, user_id) on delete cascade,
    add constraint chat_sessions_folder_fk foreign key (folder_id, user_id)
        references paperlab.folders (id, user_id) on delete cascade;
create unique index chat_sessions_library_uniq on paperlab.chat_sessions (user_id) where scope = 'library';
create unique index chat_sessions_collection_uniq on paperlab.chat_sessions (user_id, collection_id) where scope = 'collection';
create unique index chat_sessions_folder_uniq on paperlab.chat_sessions (user_id, folder_id) where scope = 'folder';

-- ------------------------------------------------------- manuscript_citations
-- 인용 검증 결과 캐시(12장). 복합 외래 키를 위해 manuscripts에 (id, user_id) 유일 제약을 더한다
alter table paperlab.manuscripts add constraint manuscripts_id_user_uniq unique (id, user_id);
create table paperlab.manuscript_citations (
    id            bigint generated always as identity primary key,
    user_id       uuid not null references auth.users (id) on delete cascade,
    manuscript_id bigint not null,
    claim_hash    text not null check (claim_hash ~ '^[0-9a-f]{64}$'),
    citekey       text not null default '' check (char_length(citekey) <= 200),
    paper_id      bigint,
    paper_sha     text not null default '' check (char_length(paper_sha) <= 64),
    method        text not null default 'none' check (method in ('quote', 'ai', 'none')),
    verdict       text not null check (verdict in ('supported', 'weak', 'unsupported', 'unchecked', 'pending')),
    reason        text not null default '' check (char_length(reason) <= 300),
    evidence      jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 3),
    checked_at    timestamptz not null default now(),
    unique (manuscript_id, claim_hash),
    foreign key (manuscript_id, user_id) references paperlab.manuscripts (id, user_id) on delete cascade,
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete set null (paper_id)
);
create index manuscript_citations_user on paperlab.manuscript_citations (user_id, manuscript_id);
alter table paperlab.manuscript_citations enable row level security;
alter table paperlab.manuscript_citations force row level security;
create policy own_rows on paperlab.manuscript_citations for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.manuscript_citations to authenticated;
-- 백업(pg_dump --role=service_role)용
grant select, insert, update, delete on paperlab.manuscript_citations to service_role;

-- ---------------------------------------------------------------------- jobs
-- 새 종류: index(서버 안 색인 — 엔진 local), find(AI로 찾기), verify(인용 검증). local은 index만
alter table paperlab.jobs drop constraint jobs_kind_check;
alter table paperlab.jobs drop constraint jobs_engine_check;
alter table paperlab.jobs
    add constraint jobs_kind_check check (kind in ('summary', 'chat', 'write', 'index', 'find', 'verify')),
    add constraint jobs_engine_check check (engine in ('claude', 'codex', 'gemini', 'local')),
    add constraint jobs_local_index check ((kind = 'index') = (engine = 'local'));
-- 사용자당 진행 중 색인 작업은 하나 (10.1절 — ensure_index_job이 on conflict do nothing)
create unique index jobs_one_index on paperlab.jobs (user_id, kind) where kind = 'index' and status in ('queued', 'running');

grant usage on all sequences in schema paperlab to authenticated;
grant usage, select on all sequences in schema paperlab to service_role;
