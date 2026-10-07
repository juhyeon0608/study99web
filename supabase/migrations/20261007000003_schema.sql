-- 1단계 표 (명세 5.5절). 모든 개인 표는 같은 파일 안에서 RLS를 켜고 정책을 둔다(명세 5.3 규칙, AC-20).
-- 공통 규칙
--   id: bigint identity(전역 순번), 같은 사용자 확인: 부모 unique (id, user_id) + 자식 복합 외래 키
--   시간: timestamptz, JSON: jsonb
--   RLS 틀: enable + force, own_rows 정책(authenticated, (select auth.uid()) = user_id), 표 권한은 authenticated에만

-- ------------------------------------------------------------------ profiles
create table paperlab.profiles (
    user_id      uuid primary key references auth.users (id) on delete cascade,
    email        text not null,
    display_name text not null default '',
    settings     jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
alter table paperlab.profiles enable row level security;
alter table paperlab.profiles force row level security;
create policy own_rows on paperlab.profiles for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.profiles to authenticated;

-- -------------------------------------------------------------- user_secrets
-- AES-256-GCM 암호문(명세 8.2). 평문은 DB에 없다.
create table paperlab.user_secrets (
    user_id    uuid not null references auth.users (id) on delete cascade,
    name       text not null check (name ~ '^[a-z0-9_]{1,64}$'),
    ciphertext bytea not null,
    nonce      bytea not null check (octet_length(nonce) = 12),
    key_id     text not null,
    hint       text not null default '',
    updated_at timestamptz not null default now(),
    primary key (user_id, name)
);
alter table paperlab.user_secrets enable row level security;
alter table paperlab.user_secrets force row level security;
create policy own_rows on paperlab.user_secrets for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.user_secrets to authenticated;

-- ------------------------------------------------------------------- folders
-- 논문 파일의 실제 위치(논문당 한 곳). 폴더를 지우면 서버가 안의 논문·하위 폴더를 부모로 먼저 옮긴다(확정 Q5).
create table paperlab.folders (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    name       text not null check (char_length(name) between 1 and 100 and name !~ '[/\\:*?"<>|]'),
    parent_id  bigint,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, user_id),
    -- 서버 처리 뒤에도 남은 연결이 있으면 parent_id만 비운다(user_id는 그대로)
    foreign key (parent_id, user_id) references paperlab.folders (id, user_id) on delete set null (parent_id)
);
create unique index folders_name_uniq on paperlab.folders (user_id, coalesce(parent_id, 0), lower(name));
alter table paperlab.folders enable row level security;
alter table paperlab.folders force row level security;
create policy own_rows on paperlab.folders for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.folders to authenticated;

-- -------------------------------------------------------------------- papers
create table paperlab.papers (
    id             bigint generated always as identity primary key,
    user_id        uuid not null references auth.users (id) on delete cascade,
    title          text not null default '',
    authors        jsonb not null default '[]'::jsonb,
    year           integer,
    venue          text not null default '',
    volume         text not null default '',
    issue          text not null default '',
    pages          text not null default '',
    publisher      text not null default '',
    doi            text not null default '',
    arxiv_id       text not null default '',
    openalex_id    text not null default '',
    s2_id          text not null default '',
    url            text not null default '',
    pdf_url        text not null default '',
    abstract       text not null default '',
    item_type      text not null default 'article',
    keywords       jsonb not null default '[]'::jsonb,
    issued         text not null default '',
    language       text not null default '',
    folder_id      bigint,
    pdf_key        text not null default '',
    pdf_sha256     text not null default '',
    pdf_size       bigint,
    page_count     integer,
    status         text not null default 'unread',
    starred        boolean not null default false,
    rating         integer not null default 0,
    cited_by_count integer,
    citekey        text not null default '',
    title_norm     text not null default '',
    added_at       timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    last_opened_at timestamptz,
    unique (id, user_id),
    foreign key (folder_id, user_id) references paperlab.folders (id, user_id) on delete set null (folder_id)
);
create index papers_user_doi on paperlab.papers (user_id, doi);
create index papers_user_arxiv on paperlab.papers (user_id, arxiv_id);
create index papers_user_title_norm on paperlab.papers (user_id, title_norm);
create index papers_user_citekey on paperlab.papers (user_id, citekey);
create index papers_user_folder on paperlab.papers (user_id, folder_id);
create index papers_user_added on paperlab.papers (user_id, added_at desc);
alter table paperlab.papers enable row level security;
alter table paperlab.papers force row level security;
create policy own_rows on paperlab.papers for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.papers to authenticated;

-- --------------------------------------------------------------- collections
create table paperlab.collections (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    name       text not null,
    parent_id  bigint,
    created_at timestamptz not null default now(),
    unique (id, user_id),
    -- 지금처럼 하위 컬렉션도 지운다(논문은 안 지움)
    foreign key (parent_id, user_id) references paperlab.collections (id, user_id) on delete cascade
);
alter table paperlab.collections enable row level security;
alter table paperlab.collections force row level security;
create policy own_rows on paperlab.collections for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.collections to authenticated;

create table paperlab.paper_collections (
    user_id       uuid not null references auth.users (id) on delete cascade,
    paper_id      bigint not null,
    collection_id bigint not null,
    primary key (paper_id, collection_id),
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete cascade,
    foreign key (collection_id, user_id) references paperlab.collections (id, user_id) on delete cascade
);
create index paper_collections_collection on paperlab.paper_collections (collection_id);
alter table paperlab.paper_collections enable row level security;
alter table paperlab.paper_collections force row level security;
create policy own_rows on paperlab.paper_collections for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.paper_collections to authenticated;

-- ---------------------------------------------------------------------- tags
create table paperlab.tags (
    id      bigint generated always as identity primary key,
    user_id uuid not null references auth.users (id) on delete cascade,
    name    text not null,
    color   text not null default '',
    unique (id, user_id)
);
-- 지금 UNIQUE COLLATE NOCASE를 사용자별로
create unique index tags_user_name_uniq on paperlab.tags (user_id, lower(name));
alter table paperlab.tags enable row level security;
alter table paperlab.tags force row level security;
create policy own_rows on paperlab.tags for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.tags to authenticated;

create table paperlab.paper_tags (
    user_id  uuid not null references auth.users (id) on delete cascade,
    paper_id bigint not null,
    tag_id   bigint not null,
    primary key (paper_id, tag_id),
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete cascade,
    foreign key (tag_id, user_id) references paperlab.tags (id, user_id) on delete cascade
);
create index paper_tags_tag on paperlab.paper_tags (tag_id);
alter table paperlab.paper_tags enable row level security;
alter table paperlab.paper_tags force row level security;
create policy own_rows on paperlab.paper_tags for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.paper_tags to authenticated;

-- --------------------------------------------------------------- annotations
create table paperlab.annotations (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    paper_id   bigint not null,
    page       integer not null,
    kind       text not null default 'highlight',
    color      text not null default 'yellow',
    text       text not null default '',
    comment    text not null default '',
    rects      jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete cascade
);
create index annotations_paper_page on paperlab.annotations (paper_id, page);
alter table paperlab.annotations enable row level security;
alter table paperlab.annotations force row level security;
create policy own_rows on paperlab.annotations for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.annotations to authenticated;

-- --------------------------------------------------------------------- notes
create table paperlab.notes (
    paper_id   bigint primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    content    text not null default '',
    updated_at timestamptz not null default now(),
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete cascade
);
alter table paperlab.notes enable row level security;
alter table paperlab.notes force row level security;
create policy own_rows on paperlab.notes for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.notes to authenticated;

-- ---------------------------------------------------------------- page_texts
-- 쪽 단위 본문 (3단계 RAG도 이 단위를 씀). PGroonga 색인은 …_search.sql
create table paperlab.page_texts (
    user_id  uuid not null references auth.users (id) on delete cascade,
    paper_id bigint not null,
    page     integer not null,
    text     text not null,
    primary key (paper_id, page),
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete cascade
);
alter table paperlab.page_texts enable row level security;
alter table paperlab.page_texts force row level security;
create policy own_rows on paperlab.page_texts for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.page_texts to authenticated;

-- -------------------------------------------------------------- paper_search
-- 검색용 메타: 제목·저자·초록·키워드+태그·노트+하이라이트를 줄바꿈으로 이은 것 (본문은 page_texts)
create table paperlab.paper_search (
    paper_id bigint primary key,
    user_id  uuid not null references auth.users (id) on delete cascade,
    meta     text not null default '',
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete cascade
);
alter table paperlab.paper_search enable row level security;
alter table paperlab.paper_search force row level security;
create policy own_rows on paperlab.paper_search for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.paper_search to authenticated;

-- -------------------------------------------------------------- ai_summaries
create table paperlab.ai_summaries (
    paper_id   bigint primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    data       jsonb not null,
    model      text not null default '',
    created_at timestamptz not null default now(),
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete cascade
);
alter table paperlab.ai_summaries enable row level security;
alter table paperlab.ai_summaries force row level security;
create policy own_rows on paperlab.ai_summaries for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.ai_summaries to authenticated;

-- ---------------------------------------------------- chat_sessions · messages
create table paperlab.chat_sessions (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    scope      text not null default 'paper' check (scope in ('paper')),
    paper_id   bigint,
    created_at timestamptz not null default now(),
    unique (id, user_id),
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete cascade
);
-- 1단계는 논문당 세션 하나
create unique index chat_sessions_paper_uniq on paperlab.chat_sessions (user_id, paper_id) where scope = 'paper';
alter table paperlab.chat_sessions enable row level security;
alter table paperlab.chat_sessions force row level security;
create policy own_rows on paperlab.chat_sessions for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.chat_sessions to authenticated;

create table paperlab.chat_messages (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    session_id bigint not null,
    role       text not null,
    content    text not null,
    citations  jsonb not null default '[]'::jsonb,
    created_at timestamptz not null default now(),
    foreign key (session_id, user_id) references paperlab.chat_sessions (id, user_id) on delete cascade
);
create index chat_messages_session on paperlab.chat_messages (session_id, id);
alter table paperlab.chat_messages enable row level security;
alter table paperlab.chat_messages force row level security;
create policy own_rows on paperlab.chat_messages for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.chat_messages to authenticated;

-- --------------------------------------------------------------- manuscripts
create table paperlab.manuscripts (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    title      text not null default '',
    content    text not null default '',
    template   text not null default '',
    style      text not null default '',
    doc_format text not null default 'default',
    cover      jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index manuscripts_user_updated on paperlab.manuscripts (user_id, updated_at desc);
alter table paperlab.manuscripts enable row level security;
alter table paperlab.manuscripts force row level security;
create policy own_rows on paperlab.manuscripts for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.manuscripts to authenticated;

-- --------------------------------------------------------------- doc_formats
-- id는 전역 순번이라 지운 양식 id(user-N)를 다시 쓰지 않는다
create table paperlab.doc_formats (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    name       text not null,
    base       text not null default 'default',
    data       jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index doc_formats_user on paperlab.doc_formats (user_id);
alter table paperlab.doc_formats enable row level security;
alter table paperlab.doc_formats force row level security;
create policy own_rows on paperlab.doc_formats for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.doc_formats to authenticated;

-- --------------------------------------------------------------- user_styles
-- 사용자 CSL 스타일 (명세 7.7, 팀장 결정 T9 — R2가 아니라 DB)
create table paperlab.user_styles (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    style_id   text not null check (style_id ~ '^[a-z0-9][a-z0-9\-]{0,120}$'),
    title      text not null default '',
    info       jsonb not null default '{}'::jsonb,
    xml        text not null check (octet_length(xml) <= 2097152),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, style_id)
);
alter table paperlab.user_styles enable row level security;
alter table paperlab.user_styles force row level security;
create policy own_rows on paperlab.user_styles for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.user_styles to authenticated;

-- ------------------------------------------------------------ allowed_emails
-- 시스템 표: RLS 켜고 사용자 정책 없음. 읽기는 Auth Hook(…_auth_hook.sql)과 관리자 연결(sync-allowlist)만.
create table paperlab.allowed_emails (
    email    text primary key check (email = lower(btrim(email)) and email <> ''),
    added_at timestamptz not null default now()
);
alter table paperlab.allowed_emails enable row level security;
alter table paperlab.allowed_emails force row level security;
