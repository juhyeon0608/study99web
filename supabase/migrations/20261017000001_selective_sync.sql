-- 선택 동기화(폴더 · 파일별 켜고 끄기) + PC 동기화 문서 원본 (docs/specs/selective-sync.md 6장).
-- 추가만 한다 — 새 열은 기존 행에 안전한 기본값('inherit' · 'cloud' · '' · null). 다시 돌려도 안전.
-- 기존 마이그레이션 파일은 고치지 않는다 — 6단계 트리거 함수 · 파일 이름 제약은 이 파일에서 create or replace · 다시 만들기로 넓힌다.

-- ------------------------------------------------------------------ papers
-- sync_mode: 사용자 설정(inherit = 위 폴더를 따름), storage: 실제 저장 위치, local_device_id: 보관 PC(holder),
-- mode_pending: 전환 대기(5.3절), source_sha256: 원본 표현의 해시(PC 파일 = 원본 — D-8)
alter table paperlab.papers
    add column if not exists sync_mode text not null default 'inherit',
    add column if not exists storage text not null default 'cloud',
    add column if not exists local_device_id bigint,
    add column if not exists mode_pending text not null default '',
    add column if not exists mode_requested_at timestamptz,
    add column if not exists mode_requested_by text not null default '',
    add column if not exists mode_error text not null default '',
    add column if not exists source_sha256 text not null default '';

alter table paperlab.papers drop constraint if exists papers_sync_mode_check;
alter table paperlab.papers add constraint papers_sync_mode_check check (sync_mode in ('inherit', 'cloud', 'local'));
alter table paperlab.papers drop constraint if exists papers_storage_check;
alter table paperlab.papers add constraint papers_storage_check check (storage in ('cloud', 'local'));
-- 로컬 항목은 R2 키 · 벡터가 없다 (P-2 — 코드가 빠뜨려도 DB가 막음)
alter table paperlab.papers drop constraint if exists papers_local_no_keys_check;
alter table paperlab.papers add constraint papers_local_no_keys_check check (
    storage = 'cloud' or (pdf_key = '' and source_key = '' and rag_key = ''));
alter table paperlab.papers drop constraint if exists papers_mode_pending_check;
alter table paperlab.papers add constraint papers_mode_pending_check check (
    mode_pending = '' or (mode_pending = 'to_local' and storage = 'cloud') or (mode_pending = 'to_cloud' and storage = 'local'));
alter table paperlab.papers drop constraint if exists papers_mode_requested_by_check;
alter table paperlab.papers add constraint papers_mode_requested_by_check check (mode_requested_by ~ '^(|web|device:[1-9][0-9]{0,18})$');
alter table paperlab.papers drop constraint if exists papers_mode_error_check;
alter table paperlab.papers add constraint papers_mode_error_check check (char_length(mode_error) <= 40 and mode_error ~ '^[a-z_]*$');
alter table paperlab.papers drop constraint if exists papers_source_sha256_check;
alter table paperlab.papers add constraint papers_source_sha256_check check (source_sha256 ~ '^([0-9a-f]{64})?$');
alter table paperlab.papers drop constraint if exists papers_local_device_fk;
alter table paperlab.papers add constraint papers_local_device_fk foreign key (local_device_id, user_id)
    references paperlab.devices (id, user_id) on delete set null (local_device_id);

-- PC 파일 이름: 6단계 규칙 + 확장자 목록(convert.ACCEPT_EXTS와 같음 — tests/test_selective_sync_contract.py가 맞춰 봄)
alter table paperlab.papers drop constraint if exists papers_file_name_check;
alter table paperlab.papers add constraint papers_file_name_check check (
    file_name = '' or (char_length(file_name) <= 200 and file_name !~ '[/\\:*?"<>|[:cntrl:]]'
                       and file_name ~* '\.(pdf|doc|docx|hwp|hwpx|ppt|pptx|xls|xlsx|odt|odp|ods|rtf|jpg|jpeg|png|gif|bmp|tif|tiff|webp)$'));

create index if not exists papers_user_local on paperlab.papers (user_id, local_device_id) where storage = 'local';
create index if not exists papers_user_pending on paperlab.papers (user_id) where mode_pending <> '';
create index if not exists papers_user_source_sha on paperlab.papers (user_id, source_sha256) where source_sha256 <> '';

-- ----------------------------------------------------------------- folders
alter table paperlab.folders add column if not exists sync_mode text not null default 'inherit';
alter table paperlab.folders drop constraint if exists folders_sync_mode_check;
alter table paperlab.folders add constraint folders_sync_mode_check check (sync_mode in ('inherit', 'cloud', 'local'));

-- ------------------------------------------------------------ sync_devices · jobs
-- protocol: 그 PC 앱의 동기화 프로토콜(머리글 X-PaperLab-Sync — D-7). 2 이상만 보관 PC로 고를 수 있다
alter table paperlab.sync_devices add column if not exists protocol smallint not null default 1;
alter table paperlab.sync_devices drop constraint if exists sync_devices_protocol_check;
alter table paperlab.sync_devices add constraint sync_devices_protocol_check check (protocol between 1 and 99);

-- 로컬 항목 AI(P-6): 그 작업은 보관 PC만 잡는다
alter table paperlab.jobs add column if not exists pinned_device_id bigint;
alter table paperlab.jobs drop constraint if exists jobs_pinned_device_fk;
alter table paperlab.jobs add constraint jobs_pinned_device_fk foreign key (pinned_device_id, user_id)
    references paperlab.devices (id, user_id) on delete set null (pinned_device_id);

-- ------------------------------------------------------------ 변경 로그 트리거 넓히기 (6단계 6.2절)
-- 논문 설정(sync_mode)은 넣지 않는다 — 엔진에는 실효 모드 변화가 mode_pending으로 온다(피드 줄이기, 6단계 AC-604 취지)
create or replace function paperlab.sync_bump_paper() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.folder_id, new.file_name, new.pdf_key, new.pdf_sha256, new.source_sha256, new.deleted_at,
                          new.storage, new.local_device_id, new.mode_pending)
       is distinct from (old.folder_id, old.file_name, old.pdf_key, old.pdf_sha256, old.source_sha256, old.deleted_at,
                         old.storage, old.local_device_id, old.mode_pending) then
    new.sync_rev := pg_catalog.nextval('paperlab.sync_rev_seq');
    new.sync_xid := pg_catalog.pg_current_xact_id();
  end if;
  return new;
end
$$;

create or replace function paperlab.sync_bump_folder() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.name, new.parent_id, new.sync_mode) is distinct from (old.name, old.parent_id, old.sync_mode) then
    new.sync_rev := pg_catalog.nextval('paperlab.sync_rev_seq');
    new.sync_xid := pg_catalog.pg_current_xact_id();
  end if;
  return new;
end
$$;
revoke execute on function paperlab.sync_bump_paper(), paperlab.sync_bump_folder() from public, anon, authenticated;

-- ------------------------------------------------------------ 이중 방어: 로컬 항목에는 본문을 쓰지 않는다 (P-2)
-- invoker 권한: 사용자 RLS로 papers를 읽는다(자기 논문만). 휴지통 논문 하위 표 insert는 6단계 hide_trashed_children가 막음
create or replace function paperlab.page_texts_local_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from paperlab.papers p where p.id = new.paper_id and p.storage = 'local') then
    raise exception 'local-only paper has no page text' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke execute on function paperlab.page_texts_local_guard() from public, anon, authenticated;
drop trigger if exists local_guard on paperlab.page_texts;
create trigger local_guard before insert on paperlab.page_texts
    for each row execute function paperlab.page_texts_local_guard();
