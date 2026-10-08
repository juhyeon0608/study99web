-- 2단계 작업 큐 · 연결된 PC (docs/specs/phase2-worker-electron.md 5장).
-- 1단계 규칙 그대로: bigint identity, 공통 user_id + 복합 외래 키, 같은 파일 안에서 RLS(enable + force + own_rows).
-- 화면 · 워커 · API 실행기 모두 사용자 권한 트랜잭션으로 읽고 쓴다. service_role은 연결 코드 교환 · 복구 스캔만(5.6절).

-- ------------------------------------------------------------------- devices
create table paperlab.devices (
    id           bigint generated always as identity primary key,
    user_id      uuid not null references auth.users (id) on delete cascade,
    name         text not null check (char_length(name) between 1 and 60 and name !~ '[[:cntrl:]]'),
    token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),  -- 비밀 부분의 SHA-256. 원문은 저장하지 않음
    engines      jsonb not null default '[]'::jsonb check (jsonb_typeof(engines) = 'array'),
    features     jsonb not null default '["worker"]'::jsonb check (jsonb_typeof(features) = 'array'),
    app_version  text not null default '' check (char_length(app_version) <= 40),
    os           text not null default '' check (char_length(os) <= 120),
    last_seen_at timestamptz,
    paused       boolean not null default false,
    revoked_at   timestamptz,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    unique (id, user_id)
);
create index devices_user_revoked on paperlab.devices (user_id, revoked_at);
alter table paperlab.devices enable row level security;
alter table paperlab.devices force row level security;
create policy own_rows on paperlab.devices for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.devices to authenticated;

-- --------------------------------------------------------- device_pair_codes
create table paperlab.device_pair_codes (
    id         bigint generated always as identity primary key,
    user_id    uuid not null references auth.users (id) on delete cascade,
    code_hash  text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
    expires_at timestamptz not null,
    used_at    timestamptz,
    device_id  bigint,
    created_at timestamptz not null default now(),
    foreign key (device_id, user_id) references paperlab.devices (id, user_id) on delete set null (device_id)
);
create index device_pair_codes_user on paperlab.device_pair_codes (user_id, expires_at);
alter table paperlab.device_pair_codes enable row level security;
alter table paperlab.device_pair_codes force row level security;
create policy own_rows on paperlab.device_pair_codes for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.device_pair_codes to authenticated;

-- ---------------------------------------------------------------------- jobs
create table paperlab.jobs (
    id               bigint generated always as identity primary key,
    user_id          uuid not null references auth.users (id) on delete cascade,
    kind             text not null check (kind in ('summary', 'chat', 'write')),
    status           text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    runner           text not null check (runner in ('api', 'cli')),
    engine           text not null check (engine in ('claude', 'codex', 'gemini')),
    route            jsonb not null check (jsonb_typeof(route) = 'array' and jsonb_array_length(route) between 1 and 6),
    route_index      integer not null default 0 check (route_index >= 0),
    params           jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object' and octet_length(params::text) <= 65536),
    paper_id         bigint,
    parent_id        bigint,  -- 4단계 묶음 작업 자리 (2단계는 늘 null)
    device_id        bigint,
    lease_token      uuid,
    lease_until      timestamptz,
    leased_at        timestamptz,  -- 이번 잡기 시각 — 서버 쪽 절대 기한(leased_at + 시간 제한 + 5분, 11.5절)
    attempts         integer not null default 0 check (attempts >= 0),
    max_attempts     integer not null default 3 check (max_attempts between 1 and 10),
    excluded_devices jsonb not null default '[]'::jsonb check (jsonb_typeof(excluded_devices) = 'array'),
    cancel_requested boolean not null default false,
    progress         jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object'),
    result           jsonb,
    error_code       text not null default '' check (char_length(error_code) <= 40),
    error            text not null default '' check (char_length(error) <= 2000),
    history          jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array'),
    not_before       timestamptz not null default now(),
    deadline_at      timestamptz,
    created_at       timestamptz not null default now(),
    started_at       timestamptz,
    finished_at      timestamptz,
    updated_at       timestamptz not null default now(),
    unique (id, user_id),
    foreign key (paper_id, user_id) references paperlab.papers (id, user_id) on delete cascade,
    foreign key (parent_id, user_id) references paperlab.jobs (id, user_id) on delete cascade,
    foreign key (device_id, user_id) references paperlab.devices (id, user_id) on delete set null (device_id)
);
-- 4단계 큰 결과를 R2 키로 보고하는 자리 (2단계는 비움 — 3장). 이미 이 파일을 적용한 테스트 DB에도 같은 문장을 다시 실행해도 안전하게
alter table paperlab.jobs add column if not exists result_key text;
-- 대화 · 글쓰기 API SSE 작업(요청 안에서 실행): 실행기 · 복구 스캔은 다시 실행하지 않고 리스가 지나면 취소로 끝낸다
alter table paperlab.jobs add column if not exists interactive boolean not null default false;
create index jobs_claim on paperlab.jobs (user_id, runner, status, not_before, id) where status in ('queued', 'running');
create index jobs_user_created on paperlab.jobs (user_id, created_at desc);
create index jobs_user_paper_kind on paperlab.jobs (user_id, paper_id, kind);
-- 같은 논문 요약은 한 번에 하나 (7.1절 — 두 번 누르면 기존 작업)
create unique index jobs_one_summary on paperlab.jobs (user_id, paper_id, kind)
    where kind = 'summary' and status in ('queued', 'running');
alter table paperlab.jobs enable row level security;
alter table paperlab.jobs force row level security;
create policy own_rows on paperlab.jobs for all to authenticated
    using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on paperlab.jobs to authenticated;

-- service_role: 1단계 grant는 그때 있던 표에만 적용되므로 새 표에 다시 준다.
-- 사용처는 연결 코드 교환(device pairing)과 API 실행기 복구 스캔(api job recovery)뿐 — 백업(pg_dump)도 이 권한으로 읽음
grant select, insert, update, delete on paperlab.devices, paperlab.device_pair_codes, paperlab.jobs to service_role;
grant usage on all sequences in schema paperlab to authenticated;
grant usage, select on all sequences in schema paperlab to service_role;
