-- =====================================================================
-- 005 預設資料(正式環境也會套用)
--   ※ 所有門檻、權重皆為「草案」,非 Mr. Rooter 官方數字,請由委員會在後台調整。
-- =====================================================================

insert into public.app_settings (key, value, description) values
  ('hours_reset_on_promotion', 'false', '晉升後實作時數是否重新累計(false = 從到職起累計)'),
  ('promotion_requires_mentor', 'true', '晉升申請是否必須先經督導推薦才能送委員會'),
  ('sop_scorer_weights', '{"mentor": 1, "customer": 1}', 'SOP 評分合併時督導與客戶評分的權重'),
  ('scoreboard_period', '"month"', '計分板預設期間:month 或 quarter');

insert into public.career_levels (code, name, rank, description) values
  ('apprentice', '學徒',     1, '新進人員,跟車學習基本工法與安全規範'),
  ('junior',     '初階技師', 2, '可在督導遠端支援下獨立處理一般案件'),
  ('mid',        '中階技師', 3, '可獨立處理多數案件,開始協助帶學徒'),
  ('senior',     '資深技師', 4, '處理複雜案件,具備擔任組長/督導資格');

insert into public.sop_nodes (code, name, sort_order, weight, description, criteria) values
  ('arrival',   '到府',     1, 1, '準時到達、儀容與第一印象',
     '["準時或提前通知延誤", "制服整潔、配戴識別證", "穿鞋套、鋪設保護墊", "自我介紹並確認客戶需求"]'),
  ('diagnosis', '診斷',     2, 1, '找出問題並讓客戶看見',
     '["依標準流程檢測", "使用內視鏡/儀器並給客戶看畫面", "以客戶聽得懂的方式說明原因", "拍照記錄現況"]'),
  ('quote',     '報價',     3, 1, '透明報價、提供選項',
     '["施工前提供書面/平板報價", "提供至少兩種方案", "清楚說明保固與注意事項", "客戶同意後才施工"]'),
  ('work',      '施工',     4, 1, '依工法施作並維持現場整潔',
     '["依標準工法施作", "安全防護到位", "完工測試並請客戶確認", "現場清潔復原"]'),
  ('closing',   '收款簽收', 5, 1, '完成收款、簽收與後續說明',
     '["開立單據並完成收款", "客戶簽收", "說明保固與保養建議", "邀請客戶留下評價"]');

insert into public.scoreboard_metrics (code, name, description, weight, higher_is_better, norm_min, norm_max, sort_order, is_active) values
  ('satisfaction_avg',    '客戶滿意度',   '期間內案件滿意度平均(1–5 分)',          30, true,  3,  5,   1, true),
  ('conversion_rate',     '成交轉換率',   '有報價案件中成交的比例(%)',             25, true,  30, 90,  2, true),
  ('callback_rate',       '回修率',       '期間內回修案件比例(%),越低越好',       20, false, 0,  20,  3, true),
  ('sop_completion_rate', '流程完成率',   '五個 SOP 節點都有評分的案件比例(%)',     15, true,  0,  100, 4, true),
  ('training_completion', '訓練完成度',   '已完成的啟用中課程比例(%)',             10, true,  0,  100, 5, true),
  ('sop_avg',             'SOP 平均分數', 'SOP 節點加權平均(1–5 分),預設不啟用', 0,  true,  1,  5,   6, false);

-- 範例課程(學徒必修)
with c as (
  insert into public.courses (title, description, category, sort_order)
  values ('新進學徒:工安與服務基本守則', '到府服務的安全規範、工具使用與服務禮儀', '必修', 1)
  returning id
), u as (
  insert into public.course_units (course_id, title, unit_type, body, sort_order)
  select c.id, x.title, 'text'::public.unit_type, x.body, x.ord from c, (values
    ('用電安全', '施工前務必確認斷電並以驗電筆確認;潮濕環境需使用漏電斷路器保護。', 1),
    ('服務禮儀', '進門前穿鞋套、自我介紹、說明今天的流程;離開前清潔現場並請客戶確認。', 2),
    ('工具與內視鏡使用', '內視鏡鏡頭使用後需清潔消毒;拍攝畫面時邀請客戶一起看,並說明問題位置。', 3)
  ) as x(title, body, ord)
  returning 1
), q as (
  insert into public.quizzes (course_id, title, pass_score)
  select c.id, '工安與服務守則小測驗', 80 from c
  returning id
), qs as (
  insert into public.quiz_questions (quiz_id, prompt, options, sort_order)
  select q.id, x.prompt, x.options::jsonb, x.ord from q, (values
    ('施工前確認斷電後,下一步應該?', '["直接開始施工","用驗電筆確認無電","請客戶幫忙確認"]', 1),
    ('進入客戶家中前應該?', '["直接進門","穿上鞋套並自我介紹","先報價"]', 2),
    ('使用內視鏡發現問題時,最好的做法是?', '["自己看完就好","邀請客戶一起看畫面並說明","拍照後刪除"]', 3)
  ) as x(prompt, options, ord)
  returning id, sort_order
)
insert into public.quiz_answer_keys (question_id, correct_index)
select id, 1 from qs;

-- 晉升條件(草案)
insert into public.level_requirements (level_id, req_type, threshold, course_id, quiz_id, window_days, label, sort_order)
select l.id, x.req_type::public.requirement_type, x.threshold,
       case when x.req_type = 'course' then (select id from public.courses order by created_at limit 1) end,
       case when x.req_type = 'quiz_score' then (select id from public.quizzes order by created_at limit 1) end,
       x.window_days, x.label, x.ord
from public.career_levels l
join (values
  ('junior', 'practice_hours',   480,  null::int, null::text, 1),
  ('junior', 'course',           1,    null,      null,       2),
  ('junior', 'quiz_score',       80,   null,      null,       3),
  ('junior', 'case_count',       30,   null,      null,       4),
  ('mid',    'practice_hours',   1500, null,      null,       1),
  ('mid',    'case_count',       150,  null,      null,       2),
  ('mid',    'satisfaction_avg', 4.3,  180,       '近 180 天客戶滿意度平均', 3),
  ('mid',    'sop_avg',          3.8,  180,       '近 180 天 SOP 平均分數', 4),
  ('senior', 'practice_hours',   3000, null,      null,       1),
  ('senior', 'case_count',       400,  null,      null,       2),
  ('senior', 'satisfaction_avg', 4.5,  180,       '近 180 天客戶滿意度平均', 3),
  ('senior', 'sop_avg',          4.2,  180,       '近 180 天 SOP 平均分數', 4)
) as x(level_code, req_type, threshold, window_days, label, ord) on x.level_code = l.code;
