-- 驗收流程測試
\set t1 '''00000000-0000-0000-0000-0000000000d1'''
\set t2 '''00000000-0000-0000-0000-0000000000d2'''
\set m1 '''00000000-0000-0000-0000-0000000000b1'''
\set c1 '''00000000-0000-0000-0000-0000000000c1'''
\set a1 '''00000000-0000-0000-0000-0000000000a1'''

-- 測試用:各測驗的正解陣列(以超級使用者身分先算好)
create temp table quiz_keys as
  select q.title, q.id as quiz_id, jsonb_agg(k.correct_index order by qq.sort_order, qq.id) as answers
  from quizzes q join quiz_questions qq on qq.quiz_id = q.id join quiz_answer_keys k on k.question_id = qq.id
  group by q.title, q.id;
grant select on quiz_keys to authenticated;

-- 測試用:每齣情境劇「每步都選最佳」的路徑,以及「第一步就選 0 分」的路徑
create temp table best_paths as
with recursive walk as (
  select sc.id as scenario_id, sc.title, s.id as scene_id, array[]::uuid[] as ids, 0 as depth
  from scenarios sc join scenario_scenes s on s.scenario_id = sc.id and s.key = sc.start_scene_key
  union all
  select w.scenario_id, w.title, ns.id, w.ids || c.id, w.depth + 1
  from walk w
  join scenario_choices c on c.scene_id = w.scene_id
  join scenario_choice_keys k on k.choice_id = c.id and k.points = 3
  join scenario_scenes ns on ns.scenario_id = w.scenario_id and ns.key = c.next_scene_key
  where w.depth < 10
)
select distinct on (w.title) w.title, w.scenario_id, w.ids
from walk w join scenario_scenes s on s.id = w.scene_id and s.ending_type is not null
order by w.title, w.depth;
grant select on best_paths to authenticated;

set role authenticated;

-- ① 學徒看得到自己的進度與下一級缺口
select test_login(:t1);
select test_assert(promotion_progress() -> 'current_level' ->> 'code' = 'apprentice', '學徒目前職級為學徒');
select test_assert(promotion_progress() -> 'next_level' ->> 'code' = 'junior', '下一級為初階技師');
select test_assert(jsonb_array_length(promotion_progress() -> 'requirements') = 7, '初階有 7 項條件');
select test_assert((promotion_progress() ->> 'eligible')::boolean = false, '尚未達標');

-- ② 時數經督導簽核後才計入
insert into practice_hours (hours, description, work_date) select 8, '跟車第 ' || g || ' 天', current_date - g from generate_series(1, 60) g;
select test_assert((select (r ->> 'current')::numeric from jsonb_array_elements(promotion_progress() -> 'requirements') r where r ->> 'req_type' = 'practice_hours') = 0, '未簽核時數不計入');
select test_expect_error($$select submit_promotion_request()$$, '未達標不可送晉升申請');

select test_login(:m1);
select review_practice_hours(id, true, 'OK') from practice_hours where technician_id = :t1 and status = 'pending';
select test_expect_error($$select review_practice_hours((select id from practice_hours where technician_id = '00000000-0000-0000-0000-0000000000d1' limit 1), true)$$, '已簽核的紀錄不可重複簽核');

select test_login(:t1);
select test_assert((select (r ->> 'current')::numeric from jsonb_array_elements(promotion_progress() -> 'requirements') r where r ->> 'req_type' = 'practice_hours') = 480, '簽核後時數計入 480');

-- ③ 課程與測驗
select mark_unit_complete(id) from course_units;
-- 答錯
select test_assert((submit_quiz((select quiz_id from quiz_keys where title = '用電安全測驗'), '[3,3,3,3,3,3,3,3]') ->> 'passed')::boolean = false, '答錯不及格');
select test_assert((select count(*) from course_completions) = 0, '測驗未及格,課程不算完成');
select test_assert((submit_quiz((select quiz_id from quiz_keys where title = '用電安全測驗'), '[3,3,3,3,3,3,3,3]') -> 'results' -> 0 ->> 'explanation') is not null, '交卷後回傳解說');
-- 答對
select test_assert((submit_quiz((select quiz_id from quiz_keys where title = '用電安全測驗'), (select answers from quiz_keys where title = '用電安全測驗')) ->> 'score')::numeric = 100, '全對 100 分');
select test_assert((select count(*) from course_completions) = 1, '單元讀完 + 測驗及格 → 課程完成');
select submit_quiz((select quiz_id from quiz_keys where title = '給排水測驗'), (select answers from quiz_keys where title = '給排水測驗'));
select test_assert((select count(*) from course_completions) = 2, '給排水課程完成');

-- ③-2 情境劇
select test_assert((select count(*) from scenario_choice_keys) = 0, '技師看不到情境劇的計分');
select test_assert((scenario_choice_result((select ids[1] from best_paths where title = '客戶嫌報價太貴')) ->> 'points')::int = 3, '選擇後回傳分數與講評');
select test_expect_error($$select submit_scenario((select scenario_id from best_paths where title = '客戶嫌報價太貴'), (select array[ids[2]] from best_paths where title = '客戶嫌報價太貴'))$$, '路徑不合法(跳過起始場景)會被拒絕');
select test_expect_error($$select submit_scenario((select scenario_id from best_paths where title = '客戶嫌報價太貴'), (select array[ids[1]] from best_paths where title = '客戶嫌報價太貴'))$$, '沒演到結局不能交');
-- 走到最差結局:不及格且不計入晉升
select test_assert((submit_scenario(
  (select id from scenarios where title = '客戶嫌報價太貴'),
  array[(select c.id from scenario_choices c join scenario_scenes s on s.id = c.scene_id join scenarios sc on sc.id = s.scenario_id
         where sc.title = '客戶嫌報價太貴' and s.key = 'start' and c.label like '%2,500%'),
        (select c.id from scenario_choices c join scenario_scenes s on s.id = c.scene_id join scenarios sc on sc.id = s.scenario_id
         where sc.title = '客戶嫌報價太貴' and s.key = 'discount' and c.label like '%2,000 就%')]
) ->> 'passed')::boolean = false, '走到 bad 結局不及格');
select test_assert((select (r ->> 'current')::numeric from jsonb_array_elements(promotion_progress() -> 'requirements') r where r ->> 'label' like '%嫌報價%') = 0, 'bad 結局不計入晉升');
select test_assert((submit_scenario((select scenario_id from best_paths where title = '客戶嫌報價太貴'), (select ids from best_paths where title = '客戶嫌報價太貴')) ->> 'score')::numeric = 100, '最佳路徑 100 分');
select submit_scenario((select scenario_id from best_paths where title = '回修客訴'), (select ids from best_paths where title = '回修客訴'));
select test_assert((select count(*) from scenario_attempts) = 3, '演出紀錄存檔');

-- 案件 30 件(督導建立)
select test_login(:m1);
insert into service_cases (external_ref, technician_id, completed_on, quoted, converted, is_callback, satisfaction)
select 'WO-' || g, :t1, current_date - g, true, g % 2 = 0, g % 10 = 0, 4 + (g % 2) from generate_series(1, 30) g;

-- SOP 評分:案件 1~10 五個節點都評
insert into sop_scores (case_id, node_id, score, scorer_type)
select c.id, n.id, 4, 'mentor' from service_cases c cross join sop_nodes n
where c.technician_id = :t1 and c.external_ref in (select 'WO-' || g from generate_series(1, 10) g);
select test_assert((select count(distinct technician_id) from sop_scores) = 1 and (select technician_id from sop_scores limit 1) = :t1, 'SOP 分數的技師由案件自動帶入');

-- ④ 達標後送出晉升 → 督導推薦 → 委員會核可
select test_login(:t1);
select test_assert((promotion_progress() ->> 'eligible')::boolean, '四項條件皆達成');
select submit_promotion_request('申請晉升初階');
select test_expect_error($$select submit_promotion_request()$$, '同時只能有一筆進行中的申請');

select test_login(:c1);
select test_expect_error($$select decide_promotion((select id from promotion_requests limit 1), true)$$, '未經督導推薦,委員會不可直接核可');

select test_login(:m1);
select recommend_promotion((select id from promotion_requests where technician_id = :t1), true, '表現穩定,推薦');

select test_login(:t1);
select test_expect_error($$select decide_promotion((select id from promotion_requests limit 1), true)$$, '技師不可核可');

select test_login(:c1);
select decide_promotion((select id from promotion_requests where technician_id = :t1), true, '委員會核可');

select test_login(:t1);
select test_assert((select l.code from profiles p join career_levels l on l.id = p.current_level_id where p.id = auth.uid()) = 'junior', '核可後職級更新為初階');
select test_assert((select count(*) from level_history) = 1, '留下職級歷程');
select test_assert(promotion_progress() -> 'next_level' ->> 'code' = 'mid', '下一級變成中階');

reset role;
select test_assert((select count(*) from audit_log where table_name = 'promotion_requests') >= 3, '晉升流程寫入稽核紀錄');
select test_assert((select count(*) from audit_log where table_name = 'level_history') = 1, '職級歷程寫入稽核紀錄');
set role authenticated;

-- ⑤ 管理員改權重 → 計分板重算
select test_login(:m1);
create temp table sb1 as select * from compute_scoreboard(current_date - 60, current_date);
select test_assert((select count(*) from sb1) = 2, '督導的團隊計分板只有名下 2 位技師');

select test_login(:t1);
select test_assert((select count(*) from compute_scoreboard(current_date - 60, current_date)) = 1, '技師的計分板只有自己');

select test_login(:a1);
update scoreboard_metrics set weight = 0 where code <> 'callback_rate';
update scoreboard_metrics set weight = 100 where code = 'callback_rate';
-- 回修率 10%,norm 0–20,越低越好 → 50 分
select test_assert((select total_score from compute_scoreboard(current_date - 60, current_date) where technician_id = :t1) = 50, '改權重後總分只看回修率 = 50');
select test_assert((select total_score from compute_scoreboard(current_date - 60, current_date) where technician_id = :t1)
                   <> (select total_score from sb1 where technician_id = :t1), '改權重後分數改變');
select test_assert((select count(*) from audit_log where table_name = 'scoreboard_metrics' and action = 'update') >= 6, '權重修改留下稽核紀錄');

-- 結算快照
select test_assert(create_scoreboard_snapshot(current_date - 60, current_date) >= 3, '委員會/管理員可結算快照');
select test_login(:t1);
select test_assert((select count(*) from scoreboard_snapshots) = 1, '技師只看到自己的快照');
select test_expect_error($$select create_scoreboard_snapshot(current_date - 60, current_date)$$, '技師不可結算');

-- 測驗次數上限
select test_login(:a1);
update quizzes set max_attempts = 3 where title = '用電安全測驗';
select test_login(:t1);
select test_expect_error($$select submit_quiz((select quiz_id from quiz_keys where title = '用電安全測驗'), '[0,0,0,0,0,0,0,0]')$$, '超過作答次數上限');

reset role;
