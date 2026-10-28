-- 관리자 승인 가입 (2026-10-29 사용자 요청 "관리자 승인으로 바꾸는 건 안 되나?"): PAPERLAB_ALLOWLIST=approval 이면
-- 누구나 Google로 로그인할 수 있고, 처음 로그인한 계정은 여기 'pending'(승인 대기)으로 들어간다. 관리자(PAPERLAB_ADMIN_EMAILS)가
-- 앱에서 승인(approved) · 거절(rejected)한다. 서버만(system_tx · service_role) 읽고 쓴다 — 사용자 역할 정책 없음.
-- 지금까지 쓰던 계정은 모두 승인으로 넣어 둔다(바꾸는 날 아무도 막히지 않게). 추가만 한다 — 다시 돌려도 안전.

create table if not exists paperlab.access_requests (
    user_id      uuid primary key references auth.users (id) on delete cascade,
    email        text not null default '' check (char_length(email) <= 320),
    name         text not null default '' check (char_length(name) <= 200),
    status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    requested_at timestamptz not null default now(),
    decided_at   timestamptz,
    decided_by   text not null default '' check (char_length(decided_by) <= 320)
);
create index if not exists access_requests_status on paperlab.access_requests (status, requested_at desc);

alter table paperlab.access_requests enable row level security;
alter table paperlab.access_requests force row level security;
grant select, insert, update, delete on paperlab.access_requests to service_role;

insert into paperlab.access_requests (user_id, email, status, decided_at, decided_by)
select u.id, lower(coalesce(u.email, '')), 'approved', now(), 'migration' from auth.users u
on conflict (user_id) do nothing;
