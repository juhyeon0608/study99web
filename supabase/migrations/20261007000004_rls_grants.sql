-- 스키마 · 순번 권한 (명세 5.6). 표별 RLS 정책은 표를 만든 파일(…_schema.sql)에 있다.

-- anon(로그인 안 한 화면 키)에는 아무 권한도 주지 않는다
revoke all on schema paperlab from public;
revoke all on schema paperlab from anon;
revoke all on all tables in schema paperlab from anon;
revoke all on all sequences in schema paperlab from anon;

-- 사용자 역할: 스키마 사용 + identity 순번
grant usage on schema paperlab to authenticated;
grant usage on all sequences in schema paperlab to authenticated;

-- service_role: 시스템 작업(system_tx — 저장 공간 합계 · 상태 확인)과 백업(pg_dump --role=service_role)
grant usage on schema paperlab to service_role;
grant select, insert, update, delete on all tables in schema paperlab to service_role;
grant usage, select on all sequences in schema paperlab to service_role;
