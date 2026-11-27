-- 示範資料(只在瀏覽器示範模式使用)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@demo',     '{"full_name":"王經理"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'committee@demo', '{"full_name":"張主任"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'mentor1@demo',   '{"full_name":"陳組長"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'mentor2@demo',   '{"full_name":"林組長"}'),
  ('00000000-0000-0000-0000-0000000000d1', 'tech1@demo',     '{"full_name":"小張"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'tech2@demo',     '{"full_name":"小李"}'),
  ('00000000-0000-0000-0000-0000000000d3', 'tech3@demo',     '{"full_name":"小黃"}');

update public.profiles set role = 'admin',     phone = '0912-000-001' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set role = 'committee', phone = '0912-000-002' where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set role = 'mentor',    phone = '0912-000-003' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set role = 'mentor',    phone = '0912-000-004' where id = '00000000-0000-0000-0000-0000000000b2';

insert into public.mentor_assignments (mentor_id, technician_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d2'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d3');

-- 已核准時數:小張 472 小時(差 8 小時),小李、小黃各 480 小時
insert into public.practice_hours (technician_id, work_date, hours, description, status, reviewer_id, reviewed_at)
select t.id, current_date - g - 2, 8,
       (array['跟車處理排水堵塞','熱水器更換','浴室漏水檢修','配電箱檢查','馬桶更換','水塔清洗'])[1 + g % 6],
       'approved', t.mentor, now()
from (values
  ('00000000-0000-0000-0000-0000000000d1'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, 59),
  ('00000000-0000-0000-0000-0000000000d2'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, 60),
  ('00000000-0000-0000-0000-0000000000d3'::uuid, '00000000-0000-0000-0000-0000000000b2'::uuid, 60)
) as t(id, mentor, n)
cross join lateral generate_series(1, t.n) g;

-- 待簽核時數
insert into public.practice_hours (technician_id, work_date, hours, case_ref, description) values
  ('00000000-0000-0000-0000-0000000000d1', current_date - 1, 8, 'WO-2311', '跟車:廚房排水管內視鏡檢測與疏通'),
  ('00000000-0000-0000-0000-0000000000d1', current_date,     4, null,      '倉庫工具整理與保養教學'),
  ('00000000-0000-0000-0000-0000000000d2', current_date - 1, 6, 'WO-2308', '跟車:電熱水器更換');

-- 案件(近 25 天)
insert into public.service_cases (external_ref, technician_id, completed_on, quoted, converted, is_callback, satisfaction, created_by)
select 'WO-' || (2000 + t.k * 100 + g), t.id, current_date - (g % 25), true,
       (g + t.k) % 3 <> 0, (g + t.k) % 13 = 0, case when (g + t.k) % 4 = 0 then 4 else 5 end, t.mentor
from (values
  ('00000000-0000-0000-0000-0000000000d1'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, 0, 30),
  ('00000000-0000-0000-0000-0000000000d2'::uuid, '00000000-0000-0000-0000-0000000000b1'::uuid, 1, 32),
  ('00000000-0000-0000-0000-0000000000d3'::uuid, '00000000-0000-0000-0000-0000000000b2'::uuid, 2, 34)
) as t(id, mentor, k, n)
cross join lateral generate_series(1, t.n) g;

-- SOP 評分:每位技師一半的案件有完整五節點評分
insert into public.sop_scores (case_id, node_id, technician_id, scorer_id, scorer_type, score)
select c.id, n.id, c.technician_id, c.created_by, 'mentor', 3 + ((n.sort_order + length(c.external_ref::text) + right(c.external_ref, 1)::int) % 3)
from public.service_cases c
cross join public.sop_nodes n
where right(c.external_ref, 1)::int % 2 = 0;

-- 小李、小黃已完成必修課與測驗
insert into public.unit_progress (technician_id, unit_id)
select t.id, u.id from public.course_units u
cross join (values ('00000000-0000-0000-0000-0000000000d2'::uuid), ('00000000-0000-0000-0000-0000000000d3'::uuid)) t(id);
insert into public.quiz_attempts (quiz_id, technician_id, answers, score, passed)
select q.id, t.id, '[1,1,1]', 100, true from public.quizzes q
cross join (values ('00000000-0000-0000-0000-0000000000d2'::uuid), ('00000000-0000-0000-0000-0000000000d3'::uuid)) t(id);
insert into public.course_completions (technician_id, course_id)
select t.id, c.id from public.courses c
cross join (values ('00000000-0000-0000-0000-0000000000d2'::uuid), ('00000000-0000-0000-0000-0000000000d3'::uuid)) t(id);

-- 小張已讀第一個單元
insert into public.unit_progress (technician_id, unit_id)
select '00000000-0000-0000-0000-0000000000d1', id from public.course_units order by sort_order limit 1;

-- 小李送出晉升申請(待陳組長推薦);小黃已由林組長推薦(待委員會核可)
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2"}', true);
select public.submit_promotion_request('最近獨立處理了 3 件熱水器更換,希望晉升初階');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3"}', true);
select public.submit_promotion_request(null);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2"}', true);
select public.recommend_promotion(
  (select id from public.promotion_requests where technician_id = '00000000-0000-0000-0000-0000000000d3'),
  true, '工法穩定,客戶評價好,推薦晉升');
select set_config('request.jwt.claims', '', true);
