-- 앱 전용 로그인 역할 (명세 5.2절 4번, 팀장 결정 T3)
-- 여기서는 NOLOGIN으로만 만든다. 비밀번호·LOGIN은 배포 때 `python -m paperlab.admin app-role`이 관리자 연결로 설정한다.
-- NOINHERIT: SET ROLE 없이 질의하면 권한 오류(누출이 아니라 오류). NOBYPASSRLS: RLS를 넘지 못함.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'paperlab_app') then
    create role paperlab_app nologin noinherit nobypassrls;
  end if;
end
$$;

alter role paperlab_app noinherit nobypassrls;

-- 사용자 요청: SET LOCAL ROLE authenticated / 시스템 작업(system_tx): SET LOCAL ROLE service_role
grant authenticated to paperlab_app;
grant service_role to paperlab_app;
