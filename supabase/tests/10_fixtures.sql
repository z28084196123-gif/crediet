-- 測試用帳號(固定 UUID),四種角色都涵蓋
-- a1 管理員 / c1 委員會 / m1 督導甲(帶 t1,t2)/ m2 督導乙(帶 t3)/ t1 t2 t3 技師
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.local',     '{"full_name":"管理員"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'committee@test.local', '{"full_name":"工務主任"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'mentor1@test.local',   '{"full_name":"督導甲"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'mentor2@test.local',   '{"full_name":"督導乙"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'tech1@test.local',     '{"full_name":"學徒一"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'tech2@test.local',     '{"full_name":"學徒二"}'),
  ('00000000-0000-0000-0000-0000000000d3', 'tech3@test.local',     '{"full_name":"學徒三"}');

update public.profiles set role = 'admin'     where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'committee' where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set role = 'mentor'    where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');

insert into public.mentor_assignments (mentor_id, technician_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d3');

-- 方便測試切換身分
create or replace function public.test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
create or replace function public.test_assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception '❌ 測試失敗:%', msg; end if;
end $$;
-- 預期會失敗的語句
create or replace function public.test_expect_error(stmt text, msg text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception '❌ 測試失敗(預期錯誤卻成功):%', msg;
exception when others then
  if sqlerrm like '❌%' then raise; end if;
end $$;
