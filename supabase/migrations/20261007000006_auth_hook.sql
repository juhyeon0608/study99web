-- 허용 목록 Auth Hook "Before User Created" (명세 6.3 ①, 팀장 결정 T8)
-- 대시보드 Authentication → Hooks에서 이 함수를 연결한다(사람 손).
-- 반환: 허용이면 빈 객체, 아니면 {"error": {"http_code": 403, "message": …}} (Supabase 공식 문서 형식)
-- 구글 로그인 중 거부되면 Auth가 redirectTo 주소로 error · error_code · error_description을 붙여 돌려보낸다
-- (쿼리와 #조각 둘 다). 화면은 error_description에 "not_allowed"가 들어 있으면 D2(허용 안 됨) 화면을 띄운다.
-- error · error_code의 실제 값은 테스트 프로젝트에서 실측해 deploy/README.md에 적는다.
create or replace function paperlab.before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  addr text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if addr <> '' and exists (select 1 from paperlab.allowed_emails a where a.email = addr) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', '허용되지 않은 이메일이에요 (not_allowed)'));
end;
$$;

-- 실행 권한: Supabase Auth만 (사용자 역할은 실행·표 읽기 모두 불가 — AC-05)
revoke execute on function paperlab.before_user_created(jsonb) from public;
revoke execute on function paperlab.before_user_created(jsonb) from anon, authenticated;
grant usage on schema paperlab to supabase_auth_admin;
grant execute on function paperlab.before_user_created(jsonb) to supabase_auth_admin;
grant select on paperlab.allowed_emails to supabase_auth_admin;
-- 함수는 호출자(supabase_auth_admin) 권한으로 돈다(security definer 아님). allowed_emails는 RLS를 강제하므로
-- Auth 관리자 읽기 정책이 필요하다(Supabase 공식 훅 예제의 권한 패턴, 사용자 역할 대상 아님)
create policy auth_admin_read on paperlab.allowed_emails for select to supabase_auth_admin using (true);
