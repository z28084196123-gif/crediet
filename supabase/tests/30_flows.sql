-- 驗收流程測試
\set t1 '''00000000-0000-0000-0000-0000000000d1'''
\set t2 '''00000000-0000-0000-0000-0000000000d2'''
\set m1 '''00000000-0000-0000-0000-0000000000b1'''
\set c1 '''00000000-0000-0000-0000-0000000000c1'''
\set a1 '''00000000-0000-0000-0000-0000000000a1'''

set role authenticated;

-- ① 學徒看得到自己的進度與下一級缺口
select test_login(:t1);
select test_assert(promotion_progress() -> 'current_level' ->> 'code' = 'apprentice', '學徒目前職級為學徒');
select test_assert(promotion_progress() -> 'next_level' ->> 'code' = 'junior', '下一級為初階技師');
select test_assert(jsonb_array_length(promotion_progress() -> 'requirements') = 4, '初階有 4 項條件');
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
select test_assert((submit_quiz((select id from quizzes limit 1), '[0,0,0]') ->> 'passed')::boolean = false, '答錯不及格');
select test_assert((select count(*) from course_completions) = 0, '測驗未及格,課程不算完成');
-- 答對
select test_assert((submit_quiz((select id from quizzes limit 1), '[1,1,1]') ->> 'score')::numeric = 100, '全對 100 分');
select test_assert((select count(*) from course_completions) = 1, '單元讀完 + 測驗及格 → 課程完成');

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
update quizzes set max_attempts = 2;
select test_login(:t1);
select test_expect_error($$select submit_quiz((select id from quizzes limit 1), '[1,1,1]')$$, '超過作答次數上限');

reset role;
