-- =====================================================================
-- 004 計算函式與 RPC
--   所有狀態變更(簽核、晉升、測驗評分)都走這裡,前端不能直接改狀態欄位。
-- =====================================================================

-- ---------------------------------------------------------------------
-- SOP 加權平均:節點權重 × 評分者權重(app_settings.sop_scorer_weights)
-- security invoker:呼叫者只會算到自己看得到的分數
-- ---------------------------------------------------------------------
create or replace function public.sop_weighted_avg(p_tech uuid, p_from date, p_to date)
returns numeric language sql stable as $$
  with w as (
    select coalesce(public.get_setting('sop_scorer_weights'), '{"mentor":1,"customer":1}'::jsonb) as v
  )
  select round(
           sum(s.score * n.weight * coalesce((w.v ->> s.scorer_type::text)::numeric, 1))
           / nullif(sum(n.weight * coalesce((w.v ->> s.scorer_type::text)::numeric, 1)), 0)
         , 2)
  from public.sop_scores s
  join public.sop_nodes n on n.id = s.node_id and n.is_active
  join public.service_cases c on c.id = s.case_id
  cross join w
  where s.technician_id = p_tech
    and c.completed_on between p_from and p_to
$$;

-- ---------------------------------------------------------------------
-- 單一條件的目前數值
-- ---------------------------------------------------------------------
create or replace function public.requirement_current_value(p_tech uuid, r public.level_requirements)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_from  date := case when r.window_days is null then date '1900-01-01'
                       else current_date - r.window_days end;
  v_since timestamptz := '-infinity';
  v       numeric;
begin
  if r.req_type = 'practice_hours' then
    -- 設定為 true 時,時數於每次晉升後重新累計
    if coalesce((public.get_setting('hours_reset_on_promotion'))::boolean, false) then
      select coalesce(max(created_at), '-infinity') into v_since
      from public.level_history where technician_id = p_tech;
    end if;
    select coalesce(sum(hours), 0) into v from public.practice_hours
    where technician_id = p_tech and status = 'approved'
      and work_date >= v_from and work_date >= v_since::date;
  elsif r.req_type = 'course' then
    select count(*) into v from public.course_completions
    where technician_id = p_tech and course_id = r.course_id;
  elsif r.req_type = 'quiz_score' then
    select coalesce(max(score), 0) into v from public.quiz_attempts
    where technician_id = p_tech and quiz_id = r.quiz_id;
  elsif r.req_type = 'case_count' then
    select count(*) into v from public.service_cases
    where technician_id = p_tech and completed_on >= v_from;
  elsif r.req_type = 'satisfaction_avg' then
    select round(avg(satisfaction), 2) into v from public.service_cases
    where technician_id = p_tech and completed_on >= v_from and satisfaction is not null;
  elsif r.req_type = 'sop_avg' then
    v := public.sop_weighted_avg(p_tech, v_from, current_date);
  end if;
  return coalesce(v, 0);
end $$;

-- ---------------------------------------------------------------------
-- 晉升進度:目前職級、下一級、每項條件達成狀況
-- ---------------------------------------------------------------------
create or replace function public.promotion_progress(p_tech uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cur   public.career_levels;
  nxt   public.career_levels;
  items jsonb := '[]'::jsonb;
  r     public.level_requirements;
  v     numeric;
  all_met boolean := true;
  lbl   text;
begin
  if p_tech is null or not public.can_view_tech(p_tech) then
    raise exception '無權限查看此技師資料' using errcode = '42501';
  end if;

  select l.* into cur from public.profiles p
  left join public.career_levels l on l.id = p.current_level_id
  where p.id = p_tech;

  select * into nxt from public.career_levels
  where is_active and rank > coalesce(cur.rank, 0)
  order by rank limit 1;

  if nxt.id is null then
    return jsonb_build_object(
      'current_level', to_jsonb(cur), 'next_level', null,
      'requirements', '[]'::jsonb, 'eligible', false, 'is_top_level', true);
  end if;

  for r in select * from public.level_requirements
           where level_id = nxt.id and is_active order by sort_order, created_at loop
    v := public.requirement_current_value(p_tech, r);
    lbl := coalesce(r.label,
      case r.req_type
        when 'practice_hours'   then '實作時數'
        when 'course'           then '完成課程:' || (select title from public.courses where id = r.course_id)
        when 'quiz_score'       then '測驗成績:' || (select title from public.quizzes where id = r.quiz_id)
        when 'case_count'       then '完工案件數'
        when 'satisfaction_avg' then '客戶滿意度平均'
        when 'sop_avg'          then 'SOP 平均分數'
      end);
    items := items || jsonb_build_object(
      'requirement_id', r.id,
      'req_type', r.req_type,
      'label', lbl,
      'threshold', r.threshold,
      'current', v,
      'window_days', r.window_days,
      'course_id', r.course_id,
      'quiz_id', r.quiz_id,
      'met', v >= r.threshold
    );
    all_met := all_met and v >= r.threshold;
  end loop;

  return jsonb_build_object(
    'current_level', to_jsonb(cur),
    'next_level', to_jsonb(nxt),
    'requirements', items,
    'eligible', all_met,
    'is_top_level', false);
end $$;

-- ---------------------------------------------------------------------
-- 實作時數簽核
-- ---------------------------------------------------------------------
create or replace function public.review_practice_hours(p_id uuid, p_approve boolean, p_note text default null)
returns public.practice_hours language plpgsql security definer set search_path = public as $$
declare
  h public.practice_hours;
begin
  select * into h from public.practice_hours where id = p_id for update;
  if h.id is null then raise exception '找不到時數紀錄'; end if;
  if not public.can_manage_tech(h.technician_id) or h.technician_id = auth.uid() then
    raise exception '無權限簽核此紀錄' using errcode = '42501';
  end if;
  if h.status <> 'pending' then raise exception '此紀錄已簽核過'; end if;

  update public.practice_hours
     set status = case when p_approve then 'approved' else 'rejected' end::public.review_status,
         reviewer_id = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_id
  returning * into h;
  return h;
end $$;

-- ---------------------------------------------------------------------
-- 課程完成判定:所有單元已讀 + 所有啟用中的測驗皆及格
-- ---------------------------------------------------------------------
create or replace function public.refresh_course_completion(p_tech uuid, p_course uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  done boolean;
begin
  select
    not exists (select 1 from public.course_units u
                where u.course_id = p_course
                  and not exists (select 1 from public.unit_progress up
                                  where up.unit_id = u.id and up.technician_id = p_tech))
    and not exists (select 1 from public.quizzes q
                    where q.course_id = p_course and q.is_active
                      and not exists (select 1 from public.quiz_attempts a
                                      where a.quiz_id = q.id and a.technician_id = p_tech and a.passed))
  into done;

  if done then
    insert into public.course_completions (technician_id, course_id)
    values (p_tech, p_course) on conflict do nothing;
  end if;
  return done;
end $$;
revoke execute on function public.refresh_course_completion(uuid, uuid) from public, anon, authenticated;

create or replace function public.mark_unit_complete(p_unit_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_course uuid;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '42501'; end if;
  select course_id into v_course from public.course_units where id = p_unit_id;
  if v_course is null then raise exception '找不到單元'; end if;
  insert into public.unit_progress (technician_id, unit_id)
  values (auth.uid(), p_unit_id) on conflict do nothing;
  return public.refresh_course_completion(auth.uid(), v_course);
end $$;

-- ---------------------------------------------------------------------
-- 測驗作答與評分(正解不外流)
-- p_answers:依題目 sort_order 排列的選項索引陣列,例如 [0,2,1]
-- ---------------------------------------------------------------------
create or replace function public.submit_quiz(p_quiz_id uuid, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  q        public.quizzes;
  total    int;
  correct  int := 0;
  attempts int;
  i        int := 0;
  qq       record;
  results  jsonb := '[]'::jsonb;
  v_score  numeric;
  v_passed boolean;
  ok       boolean;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '42501'; end if;
  select * into q from public.quizzes where id = p_quiz_id and is_active;
  if q.id is null then raise exception '找不到測驗'; end if;

  select count(*) into attempts from public.quiz_attempts
  where quiz_id = p_quiz_id and technician_id = auth.uid();
  if q.max_attempts is not null and attempts >= q.max_attempts then
    raise exception '已達作答次數上限(% 次)', q.max_attempts;
  end if;

  select count(*) into total from public.quiz_questions where quiz_id = p_quiz_id;
  if total = 0 then raise exception '此測驗尚無題目'; end if;

  for qq in select qs.id, k.correct_index from public.quiz_questions qs
            left join public.quiz_answer_keys k on k.question_id = qs.id
            where qs.quiz_id = p_quiz_id order by qs.sort_order, qs.id loop
    ok := (p_answers ->> i) is not null and (p_answers ->> i)::int = qq.correct_index;
    if ok then correct := correct + 1; end if;
    results := results || jsonb_build_object('question_id', qq.id, 'correct', ok);
    i := i + 1;
  end loop;

  v_score := round(correct::numeric * 100 / total, 1);
  v_passed := v_score >= q.pass_score;

  insert into public.quiz_attempts (quiz_id, technician_id, answers, score, passed)
  values (p_quiz_id, auth.uid(), p_answers, v_score, v_passed);

  perform public.refresh_course_completion(auth.uid(), q.course_id);

  return jsonb_build_object('score', v_score, 'passed', v_passed, 'pass_score', q.pass_score,
                            'correct', correct, 'total', total, 'results', results);
end $$;

-- ---------------------------------------------------------------------
-- 晉升流程:技師送出 → 督導推薦 → 委員會核可
-- ---------------------------------------------------------------------
create or replace function public.submit_promotion_request(p_note text default null)
returns public.promotion_requests language plpgsql security definer set search_path = public as $$
declare
  prog jsonb;
  req  public.promotion_requests;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '42501'; end if;
  prog := public.promotion_progress(auth.uid());
  if (prog ->> 'is_top_level')::boolean then raise exception '已是最高職級'; end if;
  if not (prog ->> 'eligible')::boolean then raise exception '尚未達成所有晉升條件'; end if;
  if exists (select 1 from public.promotion_requests
             where technician_id = auth.uid() and status in ('submitted', 'recommended')) then
    raise exception '已有進行中的晉升申請';
  end if;

  insert into public.promotion_requests
    (technician_id, from_level_id, to_level_id, progress_snapshot, technician_note)
  values (auth.uid(),
          (prog -> 'current_level' ->> 'id')::uuid,
          (prog -> 'next_level' ->> 'id')::uuid,
          prog, p_note)
  returning * into req;
  return req;
end $$;

create or replace function public.withdraw_promotion_request(p_id uuid)
returns public.promotion_requests language plpgsql security definer set search_path = public as $$
declare
  req public.promotion_requests;
begin
  update public.promotion_requests set status = 'withdrawn'
  where id = p_id and technician_id = auth.uid() and status in ('submitted', 'recommended')
  returning * into req;
  if req.id is null then raise exception '無法撤回此申請'; end if;
  return req;
end $$;

create or replace function public.recommend_promotion(p_id uuid, p_recommend boolean, p_comment text default null)
returns public.promotion_requests language plpgsql security definer set search_path = public as $$
declare
  req public.promotion_requests;
begin
  select * into req from public.promotion_requests where id = p_id for update;
  if req.id is null then raise exception '找不到申請'; end if;
  if not public.can_manage_tech(req.technician_id) or req.technician_id = auth.uid() then
    raise exception '無權限處理此申請' using errcode = '42501';
  end if;
  if req.status <> 'submitted' then raise exception '此申請不在待推薦狀態'; end if;

  update public.promotion_requests
     set status = case when p_recommend then 'recommended' else 'rejected' end::public.promotion_status,
         mentor_id = auth.uid(), mentor_comment = p_comment, mentor_at = now()
   where id = p_id
  returning * into req;
  return req;
end $$;

create or replace function public.decide_promotion(p_id uuid, p_approve boolean, p_comment text default null)
returns public.promotion_requests language plpgsql security definer set search_path = public as $$
declare
  req public.promotion_requests;
  cur uuid;
  needs_mentor boolean := coalesce((public.get_setting('promotion_requires_mentor'))::boolean, true);
begin
  if not public.is_staff() then raise exception '只有委員會或管理員可以核可晉升' using errcode = '42501'; end if;
  select * into req from public.promotion_requests where id = p_id for update;
  if req.id is null then raise exception '找不到申請'; end if;
  if req.technician_id = auth.uid() then raise exception '不可核可自己的申請' using errcode = '42501'; end if;
  if not (req.status = 'recommended' or (req.status = 'submitted' and not needs_mentor)) then
    raise exception '此申請尚未經督導推薦或已結案';
  end if;

  select current_level_id into cur from public.profiles where id = req.technician_id for update;
  if p_approve and cur is distinct from req.from_level_id then
    raise exception '技師目前職級已變動,請退回後重新申請';
  end if;

  update public.promotion_requests
     set status = case when p_approve then 'approved' else 'rejected' end::public.promotion_status,
         decided_by = auth.uid(), decision_comment = p_comment, decided_at = now()
   where id = p_id
  returning * into req;

  if p_approve then
    perform set_config('app.level_change', 'on', true);
    update public.profiles set current_level_id = req.to_level_id where id = req.technician_id;
    perform set_config('app.level_change', 'off', true);
    insert into public.level_history (technician_id, from_level_id, to_level_id, promotion_request_id, changed_by, reason)
    values (req.technician_id, req.from_level_id, req.to_level_id, req.id, auth.uid(), p_comment);
  end if;
  return req;
end $$;

-- 管理員手動調整職級(更正用),同樣留下歷程
create or replace function public.admin_set_level(p_tech uuid, p_level uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  cur uuid;
begin
  if not public.is_admin() then raise exception '只有管理員可以手動調整職級' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception '請填寫調整原因'; end if;
  select current_level_id into cur from public.profiles where id = p_tech for update;
  if cur is not distinct from p_level then return; end if;
  update public.profiles set current_level_id = p_level where id = p_tech;
  insert into public.level_history (technician_id, from_level_id, to_level_id, changed_by, reason)
  values (p_tech, cur, p_level, auth.uid(), '[手動調整] ' || p_reason);
end $$;

-- ---------------------------------------------------------------------
-- 計分板
--   metric_raw_values:各指標原始值(code → 數值;沒有資料為 null)
--   compute_scoreboard:依目前權重即時計算,security invoker → 受 RLS 限制
-- ---------------------------------------------------------------------
create or replace function public.metric_raw_values(p_tech uuid, p_from date, p_to date)
returns jsonb language sql stable as $$
  with c as (
    select * from public.service_cases
    where technician_id = p_tech and completed_on between p_from and p_to
  ),
  active_nodes as (select id from public.sop_nodes where is_active),
  complete_cases as (
    select c.id from c
    where (select count(*) from active_nodes) > 0
      and not exists (select 1 from active_nodes n
                      where not exists (select 1 from public.sop_scores s
                                        where s.case_id = c.id and s.node_id = n.id))
  ),
  courses as (select id from public.courses where is_active)
  select jsonb_build_object(
    'satisfaction_avg',   (select round(avg(satisfaction), 2) from c where satisfaction is not null),
    'conversion_rate',    (select round(100.0 * count(*) filter (where converted) / nullif(count(*), 0), 1) from c where quoted),
    'callback_rate',      (select round(100.0 * count(*) filter (where is_callback) / nullif(count(*), 0), 1) from c),
    'sop_completion_rate',(select round(100.0 * (select count(*) from complete_cases) / nullif(count(*), 0), 1) from c),
    'training_completion',(select round(100.0 * count(cc.course_id) / nullif((select count(*) from courses), 0), 1)
                           from public.course_completions cc
                           where cc.technician_id = p_tech and cc.course_id in (select id from courses)),
    'sop_avg',            public.sop_weighted_avg(p_tech, p_from, p_to),
    'case_count',         (select count(*) from c)
  )
$$;

create or replace function public.compute_scoreboard(p_from date, p_to date, p_techs uuid[] default null)
returns table (technician_id uuid, full_name text, level_name text, metrics jsonb, total_score numeric)
language plpgsql stable as $$
declare
  t   record;
  m   record;
  raw jsonb;
  arr jsonb;
  rv  numeric;
  sc  numeric;
  wsum numeric;
  tot numeric;
begin
  for t in
    select p.id, p.full_name, l.name as level_name
    from public.profiles p
    left join public.career_levels l on l.id = p.current_level_id
    where p.is_active
      and (p_techs is null or p.id = any (p_techs))
      and (p.role = 'technician'
           or exists (select 1 from public.service_cases sc2
                      where sc2.technician_id = p.id and sc2.completed_on between p_from and p_to))
    order by p.full_name
  loop
    raw := public.metric_raw_values(t.id, p_from, p_to);
    arr := '[]'::jsonb; wsum := 0; tot := 0;
    for m in select * from public.scoreboard_metrics where is_active order by sort_order, code loop
      rv := (raw ->> m.code)::numeric;
      if rv is null then
        sc := null;
      else
        sc := greatest(0, least(1, (rv - m.norm_min) / (m.norm_max - m.norm_min))) * 100;
        if not m.higher_is_better then sc := 100 - sc; end if;
        sc := round(sc, 1);
        tot := tot + sc * m.weight;
        wsum := wsum + m.weight;
      end if;
      arr := arr || jsonb_build_object('code', m.code, 'name', m.name, 'raw', rv,
                                       'score', sc, 'weight', m.weight,
                                       'higher_is_better', m.higher_is_better);
    end loop;
    technician_id := t.id;
    full_name := t.full_name;
    level_name := t.level_name;
    metrics := jsonb_build_object('items', arr, 'case_count', raw -> 'case_count');
    -- 沒有資料的指標不列入,權重按比例重新分配
    total_score := case when wsum > 0 then round(tot / wsum, 1) end;
    return next;
  end loop;
end $$;

create or replace function public.create_scoreboard_snapshot(p_from date, p_to date)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
  w jsonb;
begin
  if not public.is_staff() then raise exception '只有委員會或管理員可以結算計分板' using errcode = '42501'; end if;
  select jsonb_agg(to_jsonb(m)) into w from public.scoreboard_metrics m where is_active;

  insert into public.scoreboard_snapshots (period_start, period_end, technician_id, metrics, total_score, weights, created_by)
  select p_from, p_to, s.technician_id, s.metrics, s.total_score, coalesce(w, '[]'::jsonb), auth.uid()
  from public.compute_scoreboard(p_from, p_to) s
  on conflict (period_start, period_end, technician_id)
  do update set metrics = excluded.metrics, total_score = excluded.total_score,
                weights = excluded.weights, created_by = excluded.created_by, created_at = now();
  get diagnostics n = row_count;

  insert into public.audit_log (actor_id, action, table_name, record_id, after)
  values (auth.uid(), 'snapshot', 'scoreboard_snapshots', p_from || '~' || p_to, jsonb_build_object('rows', n));
  return n;
end $$;

-- 內部函式不開放直接呼叫
revoke execute on function public.requirement_current_value(uuid, public.level_requirements) from public, anon, authenticated;
