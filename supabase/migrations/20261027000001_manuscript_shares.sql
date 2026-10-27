-- 원고 공유 링크 · 의견 (2026-10-27 사용자 요청 — 지도교수님께 링크로 원고를 보여 주고 문장에 의견 받기).
-- 링크 주소의 토큰은 sha256만 저장(원문은 만들 때 한 번만 보여 줌). 공개 페이지(/s/토큰)는 서버가 system_tx로 토큰만 찾아 읽고,
-- 원고 주인은 자기 행만(RLS) 본다. 추가만 한다 — 새 표 둘. 다시 돌려도 안전(if not exists · drop … if exists).

create table if not exists paperlab.manuscript_shares (
    id             bigint generated always as identity primary key,
    user_id        uuid not null references auth.users (id) on delete cascade,
    manuscript_id  bigint not null,
    token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    label          text not null default '' check (char_length(label) <= 60 and label !~ '[[:cntrl:]]'),
    allow_comments boolean not null default true,
    expires_at     timestamptz,                 -- 없으면 끊을 때까지
    revoked_at     timestamptz,
    last_viewed_at timestamptz,
    created_at     timestamptz not null default now(),
    constraint manuscript_shares_manuscript_fk foreign key (manuscript_id, user_id)
        references paperlab.manuscripts (id, user_id) on delete cascade
);
create index if not exists manuscript_shares_ms on paperlab.manuscript_shares (user_id, manuscript_id, created_at desc);

create table if not exists paperlab.share_comments (
    id            bigint generated always as identity primary key,
    user_id       uuid not null references auth.users (id) on delete cascade,  -- 원고 주인 (의견을 쓴 사람은 author 이름만)
    share_id      bigint not null references paperlab.manuscript_shares (id) on delete cascade,
    manuscript_id bigint not null,
    author        text not null check (char_length(author) between 1 and 40 and author !~ '[[:cntrl:]]'),
    quote         text not null default '' check (char_length(quote) <= 500),
    body          text not null check (char_length(body) between 1 and 4000),
    resolved_at   timestamptz,
    created_at    timestamptz not null default now(),
    constraint share_comments_manuscript_fk foreign key (manuscript_id, user_id)
        references paperlab.manuscripts (id, user_id) on delete cascade
);
create index if not exists share_comments_ms on paperlab.share_comments (user_id, manuscript_id, created_at desc);
create index if not exists share_comments_share on paperlab.share_comments (share_id, created_at);

alter table paperlab.manuscript_shares enable row level security;
alter table paperlab.manuscript_shares force row level security;
drop policy if exists own_rows on paperlab.manuscript_shares;
create policy own_rows on paperlab.manuscript_shares for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter table paperlab.share_comments enable row level security;
alter table paperlab.share_comments force row level security;
drop policy if exists own_rows on paperlab.share_comments;
create policy own_rows on paperlab.share_comments for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on paperlab.manuscript_shares to authenticated;
grant select, insert, update, delete on paperlab.share_comments to authenticated;
grant select, insert, update, delete on paperlab.manuscript_shares to service_role;
grant select, insert, update, delete on paperlab.share_comments to service_role;
grant usage, select on all sequences in schema paperlab to service_role;
