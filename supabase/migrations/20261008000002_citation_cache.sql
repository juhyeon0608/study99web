-- 인용 그래프 공용 캐시 (1B단계 — docs/specs/citation-graph.md 8장).
-- 공개 서지와 인용 관계 목록만 담는다. 사용자 · 요청 · 세션 · IP 열이 없고, 시각은 날짜(date)만이다(8.1 · 8.6절).
-- 읽기 = 로그인한 사용자 누구나(select 정책 하나), 쓰기 = 서버 system_tx(service_role)만.

-- ------------------------------------------------------------- external_works
-- 작품 하나 = 행 하나 (OpenAlex 번호 = W 뒤 숫자)
create table paperlab.external_works (
    id              bigint generated always as identity primary key,
    openalex_no     bigint unique check (openalex_no > 0),
    source          text not null default 'openalex' check (source in ('openalex')),
    doi             text not null default '' check (doi = '' or doi like '10.%'),
    arxiv_id        text not null default '' check (char_length(arxiv_id) <= 300),
    title           text not null check (char_length(title) <= 1000),
    title_norm      text not null default '',
    authors         jsonb not null default '[]'::jsonb check (jsonb_typeof(authors) = 'array'),
    author_count    integer not null default 0 check (author_count >= 0),
    year            integer,
    issued          text not null default '' check (char_length(issued) <= 300),
    venue           text not null default '' check (char_length(venue) <= 300),
    publisher       text not null default '' check (char_length(publisher) <= 300),
    volume          text not null default '' check (char_length(volume) <= 300),
    issue           text not null default '' check (char_length(issue) <= 300),
    pages           text not null default '' check (char_length(pages) <= 300),
    item_type       text not null default '' check (char_length(item_type) <= 300),
    language        text not null default '' check (char_length(language) <= 300),
    url             text not null default '' check (url = '' or url ~* '^https?://'),
    pdf_url         text not null default '' check (pdf_url = '' or pdf_url ~* '^https?://'),
    is_oa           boolean not null default false,
    cited_by_count  integer not null default 0 check (cited_by_count >= 0),
    reference_count integer not null default 0 check (reference_count >= 0),
    abstract        text check (abstract is null or char_length(abstract) <= 5000),  -- null = 아직 안 받음, '' = 없음
    meta_on         date not null,
    abstract_on     date
);
create index external_works_doi on paperlab.external_works (doi) where doi <> '';
create index external_works_title_norm on paperlab.external_works (title_norm);
create index external_works_meta_on on paperlab.external_works (meta_on);

-- ------------------------------------------------------------- citation_edges
-- 작품 하나 × 관계 종류 = 행 하나 (상대 작품 번호 배열 — 인접 목록, K-3)
create table paperlab.citation_edges (
    work_no    bigint not null check (work_no > 0),
    relation   text not null check (relation in ('references', 'related', 'cited_by_top', 'cited_by_recent')),
    nos        bigint[] not null,
    total      integer not null check (total >= 0),
    truncated  boolean not null default false,
    source     text not null default 'openalex' check (source in ('openalex', 's2')),
    fetched_on date not null,
    primary key (work_no, relation),
    check (cardinality(nos) <= case relation when 'references' then 500 when 'related' then 20 else 100 end)
);
-- 캐시에서 "이 작품들을 인용한 작품"을 찾을 때(함께 인용 단계를 캐시로 다시 만들기)
create index citation_edges_refs_gin on paperlab.citation_edges using gin (nos) where relation = 'references';

-- ------------------------------------------------------------- RLS · 권한 (8.4절)
alter table paperlab.external_works enable row level security;
alter table paperlab.external_works force row level security;
alter table paperlab.citation_edges enable row level security;
alter table paperlab.citation_edges force row level security;

revoke all on paperlab.external_works, paperlab.citation_edges from anon, authenticated, public;

-- 읽기: 로그인한 사용자 누구나 (공용 캐시 — 사용자 결정). 쓰기 정책 · 권한은 authenticated에 주지 않음
create policy shared_read on paperlab.external_works for select to authenticated using (true);
create policy shared_read on paperlab.citation_edges for select to authenticated using (true);
grant select on paperlab.external_works, paperlab.citation_edges to authenticated;

-- 쓰기: 서버 system_tx(service_role)만. 1단계 grant는 그때 있던 표에만 적용되므로 새 표에 다시 준다(백업도 이 권한으로 읽음)
grant select, insert, update, delete on paperlab.external_works, paperlab.citation_edges to service_role;
grant usage, select on all sequences in schema paperlab to service_role;
