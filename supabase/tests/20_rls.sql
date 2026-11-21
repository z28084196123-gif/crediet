-- RLS:技師只看自己、督導只看名下技師、委員會看全部
\set t1 '''00000000-0000-0000-0000-0000000000d1'''
\set t2 '''00000000-0000-0000-0000-0000000000d2'''
\set t3 '''00000000-0000-0000-0000-0000000000d3'''
\set m1 '''00000000-0000-0000-0000-0000000000b1'''
\set c1 '''00000000-0000-0000-0000-0000000000c1'''

-- 每位技師各登錄一筆時數
set role authenticated;
select test_login(:t1); insert into practice_hours (hours, description) values (8, 't1 跟車');
select test_login(:t2); insert into practice_hours (hours, description) values (6, 't2 跟車');
select test_login(:t3); insert into practice_hours (hours, description) values (4, 't3 跟車');

-- 技師:只看到自己
select test_login(:t1);
select test_assert((select count(*) from practice_hours) = 1, '技師只能看到自己的時數');
select test_assert((select count(*) from profiles where role = 'technician') = 1, '技師只能看到自己的 profile');
select test_assert((select count(*) from profiles where id = :m1) = 1, '技師可以看到自己的督導');
select test_assert((select count(*) from audit_log) = 0, '技師看不到稽核紀錄');
select test_assert((select count(*) from quiz_answer_keys) = 0, '技師看不到測驗正解');
select test_expect_error($$insert into practice_hours (technician_id, hours, description) values ('00000000-0000-0000-0000-0000000000d2', 1, 'x')$$, '技師不可替他人登錄時數');
select test_expect_error($$insert into practice_hours (hours, description, status) values (1, 'x', 'approved')$$, '技師不可直接新增已核准時數');
select test_expect_error($$update practice_hours set status = 'approved'$$, '技師不可自行核准時數');
select test_expect_error($$select review_practice_hours((select id from practice_hours limit 1), true)$$, '技師不可簽核自己的時數');
select test_expect_error($$update profiles set current_level_id = (select id from career_levels where code='senior') where id = auth.uid()$$, '技師不可自行升級');
select test_expect_error($$update profiles set role = 'admin' where id = auth.uid()$$, '技師不可變更角色');
update scoreboard_metrics set weight = 99 where code = 'callback_rate';
select test_assert((select weight from scoreboard_metrics where code = 'callback_rate') <> 99, '技師不可修改權重');
select test_expect_error($$insert into service_cases (technician_id) values (auth.uid())$$, '技師不可自建案件');
select test_expect_error($$select promotion_progress('00000000-0000-0000-0000-0000000000d2')$$, '技師不可看他人晉升進度');

-- 督導甲:看到 t1、t2,看不到 t3
select test_login(:m1);
select test_assert((select count(*) from practice_hours) = 2, '督導只看名下技師的時數');
select test_assert((select count(*) from practice_hours where technician_id = :t3) = 0, '督導看不到非名下技師');
select test_assert((select count(*) from profiles where role = 'technician') = 2, '督導只看名下技師 profile');
select test_expect_error($$select review_practice_hours((select id from practice_hours where description = 't3 跟車'), true)$$, '督導不可簽核非名下技師');
select test_expect_error($$insert into service_cases (technician_id) values ('00000000-0000-0000-0000-0000000000d3')$$, '督導不可替非名下技師建案');
select test_expect_error($$select promotion_progress('00000000-0000-0000-0000-0000000000d3')$$, '督導不可看非名下技師進度');
select test_assert((promotion_progress(:t1) ->> 'eligible') is not null, '督導可看名下技師進度');

-- 委員會:看全部
select test_login(:c1);
select test_assert((select count(*) from practice_hours) = 3, '委員會看全部時數');
select test_assert((select count(*) from audit_log) > 0, '委員會可看稽核紀錄');
update app_settings set value = 'true' where key = 'hours_reset_on_promotion';
select test_assert((select value from app_settings where key = 'hours_reset_on_promotion') = 'false', '委員會不可改全域設定(僅管理員)');

-- 未登入(anon)什麼都看不到
reset role;
set role anon;
select set_config('request.jwt.claims', '', false);
select test_assert((select count(*) from practice_hours) = 0, '未登入看不到時數');
select test_assert((select count(*) from career_levels) = 0, '未登入看不到職級');
reset role;

-- 清掉這個檔案的資料,避免影響後續測試
delete from practice_hours;
