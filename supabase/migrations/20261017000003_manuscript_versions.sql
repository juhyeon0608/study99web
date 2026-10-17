-- 원고 버전 기록 · 비교 · 되돌리기 (docs/specs/manuscript-history.md).
-- 자동 저장(PATCH)이 덮어쓰기 전 글 · AI 결과 넣기 전 · 되돌리기 전 · [지금 버전 저장]을 남긴다. 보관 정리는 paperlab/versions.py.
-- 추가만 한다 — 새 표 하나(기존 표 · 행은 그대로). 다시 돌려도 안전(if not exists · drop … if exists).

create table if not exists paperlab.manuscript_versions (
    id            bigint generated always as identity primary key,
    user_id       uuid not null references auth.users (id) on delete cascade,
    manuscript_id bigint not null,
    -- auto: 편집 중 10분마다 바뀌기 전 글 · ai_apply: AI 결과 넣기 전 · restore: 되돌리기 전 · manual: 직접 저장
    reason        text not null check (reason in ('auto', 'ai_apply', 'restore', 'manual')),
    -- 이름을 붙인 기록(과 manual)은 자동 정리에서 빠진다
    label         text not null default '' check (char_length(label) <= 60 and label !~ '[[:cntrl:]]'),
    content       text not null,
    size          integer not null,            -- UTF-8 바이트 (목록 · 보관 상한 계산에 본문을 읽지 않게)
    chars         integer not null,            -- 글자 수
    sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),   -- 마지막 기록과 같은 글이면 새로 남기지 않음
    created_at    timestamptz not null default now(),
    constraint manuscript_versions_size_check check (size = octet_length(content) and chars = char_length(content)
                                                     and size <= 4194304),
    -- 원고를 지우면 기록도 함께 (원고 주인과 같은 사용자만 — 복합 외래 키, manuscripts_id_user_uniq)
    constraint manuscript_versions_manuscript_fk foreign key (manuscript_id, user_id)
        references paperlab.manuscripts (id, user_id) on delete cascade
);
create index if not exists manuscript_versions_ms
    on paperlab.manuscript_versions (user_id, manuscript_id, created_at desc, id desc);

alter table paperlab.manuscript_versions enable row level security;
alter table paperlab.manuscript_versions force row level security;
drop policy if exists own_rows on paperlab.manuscript_versions;
create policy own_rows on paperlab.manuscript_versions for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.manuscript_versions to authenticated;
-- 백업(pg_dump --role=service_role)용 — 1단계 grant는 그때 있던 표에만 적용되므로 새 표에 다시 준다
grant select, insert, update, delete on paperlab.manuscript_versions to service_role;
grant usage, select on all sequences in schema paperlab to service_role;
