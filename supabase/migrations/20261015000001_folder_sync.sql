-- 6단계 폴더 양방향 동기화 · 서재 휴지통 (docs/specs/phase6-folder-sync.md 13장 + 스파이크 반영 팀장 결정).
-- 추가만 한다 — 기존 열은 고치지 않고, 새 열은 기존 행에 안전한 기본값(nullable · '' · 0). 다시 돌려도 안전하게 if not exists.
-- 1단계 규칙 그대로: 공통 user_id + 복합 외래 키, 같은 파일 안에서 RLS(enable + force + own_rows).

-- ------------------------------------------------------------------ papers 열
alter table paperlab.papers
    add column if not exists file_name text not null default '',
    add column if not exists deleted_at timestamptz,
    add column if not exists deleted_by text not null default '',
    add column if not exists deleted_folder_path text not null default '',
    add column if not exists content_at timestamptz,
    add column if not exists content_device_id bigint,
    add column if not exists translation_cleared_at timestamptz,
    add column if not exists sync_rev bigint not null default 0,
    add column if not exists sync_xid xid8;

-- 파일 이름(8.2절): '' 또는 200자 이하 · 금지 문자 · 제어 문자 없음 · .pdf로 끝남. Windows 예약 이름은 서버 코드가 막는다
alter table paperlab.papers drop constraint if exists papers_file_name_check;
alter table paperlab.papers add constraint papers_file_name_check check (
    file_name = '' or (char_length(file_name) <= 200 and file_name !~ '[/\\:*?"<>|[:cntrl:]]'
                       and file_name ~ '\.[pP][dD][fF]$'));
alter table paperlab.papers drop constraint if exists papers_deleted_by_check;
alter table paperlab.papers add constraint papers_deleted_by_check check (deleted_by ~ '^(|web|device:[1-9][0-9]{0,18})$');
alter table paperlab.papers drop constraint if exists papers_deleted_folder_path_check;
alter table paperlab.papers add constraint papers_deleted_folder_path_check check (char_length(deleted_folder_path) <= 500);
alter table paperlab.papers drop constraint if exists papers_content_device_fk;
alter table paperlab.papers add constraint papers_content_device_fk foreign key (content_device_id, user_id)
    references paperlab.devices (id, user_id) on delete set null (content_device_id);

create index if not exists papers_user_sync on paperlab.papers (user_id, sync_xid, sync_rev);
create index if not exists papers_user_sha on paperlab.papers (user_id, pdf_sha256) where pdf_sha256 <> '';
create index if not exists papers_user_deleted on paperlab.papers (user_id, deleted_at) where deleted_at is not null;
create unique index if not exists papers_file_name_uniq on paperlab.papers (user_id, coalesce(folder_id, 0), lower(file_name))
    where file_name <> '' and deleted_at is null;

-- ----------------------------------------------------------------- folders 열
alter table paperlab.folders
    add column if not exists sync_rev bigint not null default 0,
    add column if not exists sync_xid xid8;
create index if not exists folders_user_sync on paperlab.folders (user_id, sync_xid, sync_rev);

-- ------------------------------------------------------------- 변경 로그 (6.2절 · K-4)
-- sync_rev: 전역 순번, sync_xid: 그 변경을 쓴 트랜잭션. 피드는 sync_xid < pg_snapshot_xmin(지금)인 행만 (xid, rev) 순으로
create sequence if not exists paperlab.sync_rev_seq;
-- 피드의 "서버보다 앞선 커서" 검사(last_value)만 — 번호를 쓰는 것은 아래 security definer 트리거
grant select on sequence paperlab.sync_rev_seq to authenticated;

create table if not exists paperlab.sync_tombstones (
    id         bigint generated always as identity primary key,
    -- 묘비 FK cascade: 계정을 지우면 묘비도 함께 (스파이크 t3 — 트리거가 사용자 없음을 보고 건너뜀)
    user_id    uuid not null references auth.users (id) on delete cascade,
    kind       text not null check (kind in ('folder', 'paper')),
    entity_id  bigint not null,
    sync_rev   bigint not null,
    sync_xid   xid8 not null,
    created_at timestamptz not null default now()
);
create index if not exists sync_tombstones_user_sync on paperlab.sync_tombstones (user_id, sync_xid, sync_rev);
create index if not exists sync_tombstones_user_created on paperlab.sync_tombstones (user_id, created_at);
alter table paperlab.sync_tombstones enable row level security;
alter table paperlab.sync_tombstones force row level security;
drop policy if exists own_rows on paperlab.sync_tombstones;
create policy own_rows on paperlab.sync_tombstones for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- 묘비는 트리거(security definer)만 쓴다 — 사용자는 읽기 · 180일 정리(delete)만
grant select, delete on paperlab.sync_tombstones to authenticated;

-- 트리거 함수: 호출자가 누구든(사용자 · 실행기 · 계정 삭제 연쇄의 supabase_auth_admin) 실패하지 않게 security definer +
-- search_path 고정. 동기화에 관계된 열이 바뀔 때만 번호를 새로 쓴다(제목 · 읽음 상태 등은 그대로 — AC-604)
create or replace function paperlab.sync_bump_paper() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.folder_id, new.file_name, new.pdf_key, new.pdf_sha256, new.deleted_at)
       is distinct from (old.folder_id, old.file_name, old.pdf_key, old.pdf_sha256, old.deleted_at) then
    new.sync_rev := pg_catalog.nextval('paperlab.sync_rev_seq');
    new.sync_xid := pg_catalog.pg_current_xact_id();
  end if;
  return new;
end
$$;

create or replace function paperlab.sync_bump_folder() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.name, new.parent_id) is distinct from (old.name, old.parent_id) then
    new.sync_rev := pg_catalog.nextval('paperlab.sync_rev_seq');
    new.sync_xid := pg_catalog.pg_current_xact_id();
  end if;
  return new;
end
$$;

-- 묘비: 폴더 행 삭제 · 논문 영구 삭제. 계정 삭제 연쇄 중이면(auth.users 행이 이미 없음) 쓰지 않는다
create or replace function paperlab.sync_tombstone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  insert into paperlab.sync_tombstones (user_id, kind, entity_id, sync_rev, sync_xid)
  values (old.user_id, tg_argv[0], old.id, pg_catalog.nextval('paperlab.sync_rev_seq'), pg_catalog.pg_current_xact_id());
  return old;
end
$$;
revoke execute on function paperlab.sync_bump_paper(), paperlab.sync_bump_folder(), paperlab.sync_tombstone()
    from public, anon, authenticated;

drop trigger if exists sync_bump on paperlab.papers;
create trigger sync_bump before insert or update on paperlab.papers
    for each row execute function paperlab.sync_bump_paper();
drop trigger if exists sync_bump on paperlab.folders;
create trigger sync_bump before insert or update on paperlab.folders
    for each row execute function paperlab.sync_bump_folder();
drop trigger if exists sync_tombstone on paperlab.papers;
create trigger sync_tombstone after delete on paperlab.papers
    for each row execute function paperlab.sync_tombstone('paper');
drop trigger if exists sync_tombstone on paperlab.folders;
create trigger sync_tombstone after delete on paperlab.folders
    for each row execute function paperlab.sync_tombstone('folder');

-- ------------------------------------------------------------- 휴지통 (11.1절 · K-9)
-- 휴지통 논문은 트랜잭션 설정 paperlab.trash = 'on'(db.Library.trash_tx)일 때만 보인다. 지금 있는 모든 질의가 코드 수정 없이 숨김
drop policy if exists hide_trashed on paperlab.papers;
create policy hide_trashed on paperlab.papers as restrictive for select to authenticated
    using (deleted_at is null or current_setting('paperlab.trash', true) = 'on');

-- 이중 방어(K-39): 논문 아래 표는 그 논문이 보일 때만 읽고 쓴다(하위 표를 papers 없이 바로 읽는 질의 · 휴지통 논문에 쓰는 코드
-- 누락 대비). manuscript_citations는 넣지 않음 — 인용 검증 upsert(on conflict do update)가 휴지통 논문을 가리키는 숨은 행과
-- 겹치면 42501(실측)이라 원고 검증이 깨진다. 그 표는 코드(verify.py)가 보이는 논문만 쓴다
do $$
declare
  t text;
begin
  foreach t in array array['paper_collections', 'paper_tags', 'annotations', 'notes', 'page_texts', 'paper_search',
                           'ai_summaries', 'explanations', 'translations'] loop
    execute format('drop policy if exists hide_trashed_children on paperlab.%I', t);
    execute format('create policy hide_trashed_children on paperlab.%I as restrictive for all to authenticated '
                   'using (exists (select 1 from paperlab.papers p where p.id = paper_id))', t);
  end loop;
  foreach t in array array['chat_sessions', 'jobs'] loop
    execute format('drop policy if exists hide_trashed_children on paperlab.%I', t);
    execute format('create policy hide_trashed_children on paperlab.%I as restrictive for all to authenticated '
                   'using (paper_id is null or exists (select 1 from paperlab.papers p where p.id = paper_id))', t);
  end loop;
end
$$;

-- ------------------------------------------------------------- 기기별 동기화 요약 (웹 "연결된 PC")
create table if not exists paperlab.sync_devices (
    device_id    bigint primary key,
    user_id      uuid not null references auth.users (id) on delete cascade,
    enabled      boolean not null default false,
    root_label   text not null default '' check (char_length(root_label) <= 60 and root_label !~ '[[:cntrl:]]'),
    state        text not null default 'off' check (state in ('off', 'scanning', 'preview', 'syncing', 'idle', 'paused',
                     'waiting_confirm', 'root_missing', 'offline', 'storage_full', 'update_required',
                     'account_mismatch', 'revoked')),
    counts       jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object' and octet_length(counts::text) <= 2048),
    last_sync_at timestamptz,
    last_full_at timestamptz,
    updated_at   timestamptz not null default now(),
    foreign key (device_id, user_id) references paperlab.devices (id, user_id) on delete cascade
);
create index if not exists sync_devices_user on paperlab.sync_devices (user_id);
alter table paperlab.sync_devices enable row level security;
alter table paperlab.sync_devices force row level security;
drop policy if exists own_rows on paperlab.sync_devices;
create policy own_rows on paperlab.sync_devices for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.sync_devices to authenticated;

-- ------------------------------------------------------------- 멱등 기록 (K-22 — 7일)
create table if not exists paperlab.sync_ops (
    user_id    uuid not null references auth.users (id) on delete cascade,
    device_id  bigint not null,
    op_id      uuid not null,
    response   jsonb not null check (octet_length(response::text) <= 16384),
    created_at timestamptz not null default now(),
    primary key (device_id, op_id),
    foreign key (device_id, user_id) references paperlab.devices (id, user_id) on delete cascade
);
create index if not exists sync_ops_user_created on paperlab.sync_ops (user_id, created_at);
alter table paperlab.sync_ops enable row level security;
alter table paperlab.sync_ops force row level security;
drop policy if exists own_rows on paperlab.sync_ops;
create policy own_rows on paperlab.sync_ops for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.sync_ops to authenticated;

-- 백업(pg_dump --role=service_role)용
grant select, insert, update, delete on paperlab.sync_tombstones, paperlab.sync_devices, paperlab.sync_ops to service_role;
grant usage, select on all sequences in schema paperlab to service_role;

-- ------------------------------------------------------------- 앱 역할 (스파이크 t1)
-- 피드는 pg_snapshot_xmin 아래만 돌려주므로, 열어 둔 채 잊은 트랜잭션이 xmin을 붙잡지 않게 60초에 끊는다
alter role paperlab_app set idle_in_transaction_session_timeout = '60s';
