-- =====================================================================
-- 008 互動情境劇(情境演練)
--   每齣劇由多個場景組成;技師在場景中選擇回應,不同選擇走向不同場景與結局。
--   每個選擇有 0–3 分(0 錯誤/危險、1 不理想、2 可接受、3 最佳)並對應 SOP 節點,
--   計分與解說放在技師讀不到的表,由 RPC 回傳。
-- =====================================================================

create table public.scenarios (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  category        text,
  start_scene_key text not null default 'start',
  pass_score      numeric not null default 70 check (pass_score between 0 and 100),
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create type public.ending_type as enum ('good', 'ok', 'bad');

create table public.scenario_scenes (
  id             uuid primary key default gen_random_uuid(),
  scenario_id    uuid not null references public.scenarios(id) on delete cascade,
  key            text not null,
  sort_order     int not null default 0,
  location       text,          -- 場景地點,例如「陳太太家・廚房」
  speaker        text,          -- 說話的人
  line           text,          -- 對話台詞
  narration      text,          -- 旁白/現場狀況
  media_url      text,          -- 圖片或影片網址(選填,之後可放 AI 生成或自拍短劇)
  ending_type    public.ending_type,  -- 有值代表這是結局
  ending_summary text,
  mentor_comment text,
  unique (scenario_id, key)
);

create table public.scenario_choices (
  id             uuid primary key default gen_random_uuid(),
  scene_id       uuid not null references public.scenario_scenes(id) on delete cascade,
  label          text not null,
  next_scene_key text not null,
  sort_order     int not null default 0
);

-- 每個選擇的分數、對應 SOP 節點與講評(技師讀不到)
create table public.scenario_choice_keys (
  choice_id     uuid primary key references public.scenario_choices(id) on delete cascade,
  points        int not null check (points between 0 and 3),
  sop_node_code text,
  feedback      text
);

create table public.scenario_attempts (
  id            uuid primary key default gen_random_uuid(),
  scenario_id   uuid not null references public.scenarios(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete cascade,
  path          jsonb not null,
  ending_key    text not null,
  ending_type   public.ending_type not null,
  total_score   numeric not null,
  sop_scores    jsonb not null,
  passed        boolean not null,
  created_at    timestamptz not null default now()
);
create index on public.scenario_attempts (technician_id, scenario_id);

alter table public.level_requirements add column scenario_id uuid references public.scenarios(id) on delete cascade;
alter table public.level_requirements add constraint level_requirements_scenario_check
  check (req_type <> 'scenario' or scenario_id is not null);

create trigger scenarios_touch before update on public.scenarios
  for each row execute function public.touch_updated_at();
create trigger scenarios_audit after insert or update or delete on public.scenarios
  for each row execute function public.audit_trigger();

alter table public.scenarios            enable row level security;
alter table public.scenario_scenes      enable row level security;
alter table public.scenario_choices     enable row level security;
alter table public.scenario_choice_keys enable row level security;
alter table public.scenario_attempts    enable row level security;

create policy "scenarios: read" on public.scenarios for select to authenticated using (is_active or public.is_staff());
create policy "scenarios: write" on public.scenarios for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "scenes: read" on public.scenario_scenes for select to authenticated using (true);
create policy "scenes: write" on public.scenario_scenes for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "choices: read" on public.scenario_choices for select to authenticated using (true);
create policy "choices: write" on public.scenario_choices for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "choice_keys: staff only" on public.scenario_choice_keys for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "scenario_attempts: read" on public.scenario_attempts for select to authenticated using (public.can_view_tech(technician_id));

-- ---------------------------------------------------------------------
-- 演出中:選擇後立即回傳講評與分數
-- ---------------------------------------------------------------------
create or replace function public.scenario_choice_result(p_choice_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '42501'; end if;
  select jsonb_build_object('points', k.points, 'feedback', k.feedback, 'sop_node_code', k.sop_node_code,
                            'next_scene_key', c.next_scene_key)
  into r
  from public.scenario_choices c
  join public.scenario_scenes s on s.id = c.scene_id
  join public.scenarios sc on sc.id = s.scenario_id and sc.is_active
  left join public.scenario_choice_keys k on k.choice_id = c.id
  where c.id = p_choice_id;
  if r is null then raise exception '找不到選項'; end if;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 演完:驗證路徑、計分、存檔
--   分數 = 各次選擇得分平均 / 3 × 100;走到 bad 結局一律不及格
-- ---------------------------------------------------------------------
create or replace function public.submit_scenario(p_scenario_id uuid, p_choice_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sc      public.scenarios;
  cur     public.scenario_scenes;
  ch      record;
  cid     uuid;
  path    jsonb := '[]'::jsonb;
  pts     int[] := '{}';
  node_pts jsonb := '{}'::jsonb;
  sop     jsonb := '{}'::jsonb;
  v_score numeric;
  v_pass  boolean;
  k       text;
begin
  if auth.uid() is null then raise exception '請先登入' using errcode = '42501'; end if;
  select * into sc from public.scenarios where id = p_scenario_id and is_active;
  if sc.id is null then raise exception '找不到情境劇'; end if;
  select * into cur from public.scenario_scenes where scenario_id = sc.id and key = sc.start_scene_key;
  if cur.id is null then raise exception '情境劇缺少起始場景'; end if;
  if coalesce(array_length(p_choice_ids, 1), 0) = 0 then raise exception '沒有作答紀錄'; end if;

  foreach cid in array p_choice_ids loop
    if cur.ending_type is not null then raise exception '路徑錯誤:已到結局'; end if;
    select c.id, c.label, c.next_scene_key, c.scene_id, coalesce(kk.points, 0) as points, kk.sop_node_code, kk.feedback
    into ch
    from public.scenario_choices c left join public.scenario_choice_keys kk on kk.choice_id = c.id
    where c.id = cid;
    if ch.id is null or ch.scene_id <> cur.id then raise exception '路徑錯誤:選項不屬於目前場景'; end if;

    path := path || jsonb_build_object('scene_key', cur.key, 'line', cur.line, 'choice_id', ch.id, 'choice', ch.label,
                                       'points', ch.points, 'feedback', ch.feedback, 'sop_node_code', ch.sop_node_code);
    pts := pts || ch.points;
    if ch.sop_node_code is not null then
      node_pts := jsonb_set(node_pts, array[ch.sop_node_code],
                            coalesce(node_pts -> ch.sop_node_code, '[]'::jsonb) || to_jsonb(ch.points));
    end if;

    select * into cur from public.scenario_scenes where scenario_id = sc.id and key = ch.next_scene_key;
    if cur.id is null then raise exception '劇本錯誤:找不到場景 %', ch.next_scene_key; end if;
  end loop;

  if cur.ending_type is null then raise exception '尚未演到結局'; end if;

  v_score := round((select avg(x) from unnest(pts) x) / 3.0 * 100, 1);
  v_pass := v_score >= sc.pass_score and cur.ending_type <> 'bad';
  for k in select jsonb_object_keys(node_pts) loop
    sop := sop || jsonb_build_object(k, round((select avg(v::numeric) from jsonb_array_elements_text(node_pts -> k) v) / 3.0 * 100, 1));
  end loop;

  insert into public.scenario_attempts (scenario_id, technician_id, path, ending_key, ending_type, total_score, sop_scores, passed)
  values (sc.id, auth.uid(), path, cur.key, cur.ending_type, v_score, sop, v_pass);

  return jsonb_build_object('score', v_score, 'passed', v_pass, 'pass_score', sc.pass_score,
    'ending', jsonb_build_object('key', cur.key, 'type', cur.ending_type, 'narration', cur.narration,
                                 'summary', cur.ending_summary, 'mentor_comment', cur.mentor_comment),
    'sop_scores', sop, 'path', path);
end $$;

-- ---------------------------------------------------------------------
-- 晉升條件計算加入情境演練
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
  elsif r.req_type = 'scenario' then
    -- 走到 bad 結局的紀錄不計
    select coalesce(max(total_score), 0) into v from public.scenario_attempts
    where technician_id = p_tech and scenario_id = r.scenario_id and ending_type <> 'bad';
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
revoke execute on function public.requirement_current_value(uuid, public.level_requirements) from public, anon, authenticated;

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
        when 'scenario'         then '情境演練:' || (select title from public.scenarios where id = r.scenario_id)
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
      'scenario_id', r.scenario_id,
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

-- =====================================================================
-- 劇本(起始內容,請工務主任審閱後依公司實際政策調整)
-- =====================================================================
create function public._sc_scene(p_sc uuid, p_key text, p_sort int, p_loc text, p_speaker text, p_line text, p_narr text,
                                 p_end public.ending_type default null, p_summary text default null, p_comment text default null)
returns void language sql as $$
  insert into public.scenario_scenes (scenario_id, key, sort_order, location, speaker, line, narration, ending_type, ending_summary, mentor_comment)
  values (p_sc, p_key, p_sort, p_loc, p_speaker, p_line, p_narr, p_end, p_summary, p_comment);
$$;

create function public._sc_choice(p_sc uuid, p_scene text, p_sort int, p_label text, p_next text, p_points int, p_node text, p_feedback text)
returns void language plpgsql as $$
declare cid uuid;
begin
  insert into public.scenario_choices (scene_id, label, next_scene_key, sort_order)
  select id, p_label, p_next, p_sort from public.scenario_scenes where scenario_id = p_sc and key = p_scene
  returning id into cid;
  if cid is null then raise exception '找不到場景 %', p_scene; end if;
  insert into public.scenario_choice_keys (choice_id, points, sop_node_code, feedback) values (cid, p_points, p_node, p_feedback);
end $$;

do $$
declare s1 uuid; s2 uuid; s3 uuid; s4 uuid;
begin
  -- -----------------------------------------------------------------
  -- 劇本一:客戶嫌報價太貴
  -- -----------------------------------------------------------------
  insert into public.scenarios (title, description, category, sort_order)
  values ('客戶嫌報價太貴', '角閥鏽蝕漏水,客戶覺得價格太高、想用便宜材料。練習:讓客戶看見問題、提供方案,但不犧牲安全。', '報價溝通', 1)
  returning id into s1;

  perform public._sc_scene(s1, 'start', 1, '陳太太家・廚房', '陳太太',
    '這麼貴?網路上角閥一顆才一百多,你們是不是亂開價?',
    '你檢查完廚房水槽下方:兩顆角閥都已經鏽蝕,其中一顆正在滲水,櫃子底板已經泡軟。你報價「更換兩組不鏽鋼角閥與編織軟管,含工資 3,200 元」。');
  perform public._sc_scene(s1, 'explained', 2, '陳太太家・廚房', '陳太太',
    '原來鏽成這樣……那有沒有便宜一點的方法?我聽說塑膠軟管也可以用?',
    '陳太太看著平板上的照片,語氣緩和下來。');
  perform public._sc_scene(s1, 'cold', 3, '陳太太家・客廳', '陳太太',
    '喔……那我再考慮看看好了。',
    '陳太太開始收拾桌上的東西,看起來準備送客。');
  perform public._sc_scene(s1, 'discount', 4, '陳太太家・廚房', '陳太太',
    '你一下就降 700?那原本是不是坑我?算 2,000 我就做。',
    '陳太太雙手抱胸,看起來更不信任你了。');
  perform public._sc_scene(s1, 'end_good', 10, '陳太太家・廚房', null, null,
    '陳太太選擇先換漏水的那一組(1,800 元),另一組約下個月處理。完工後你請她摸摸看管路、確認不再滲水,並說明保固後完成簽收。',
    'good', '成交、客戶理解價格、留下下一次的服務機會。',
    '先讓客戶「看見」問題,再談價格,是報價節點的核心。拆成兩個方案讓客戶自己選,比直接降價好。');
  perform public._sc_scene(s1, 'end_lost', 11, '陳太太家・門口', null, null,
    '你禮貌告退。一週後公司接到陳太太的電話:櫃子底板整片泡爛,她找了別家師傅處理。',
    'ok', '沒成交,客戶的問題也變嚴重了。',
    '客戶說「考慮看看」通常是還沒被說服。你還沒讓她看見問題的嚴重性,就放棄了。');
  perform public._sc_scene(s1, 'end_cheap', 12, '公司・客服電話', null, null,
    '你用 2,000 元成交,扣掉材料幾乎沒有利潤。之後陳太太每次叫修都要求同樣的折扣。',
    'bad', '毛利過低,也讓客戶認為價格可以一直砍。',
    '隨意降價會讓客戶覺得原價灌水。要降低金額,應該是調整方案內容,而不是直接打折。');
  perform public._sc_scene(s1, 'end_burst', 13, '公司・客服電話', null, null,
    '兩週後陳太太打電話來:廚房櫃子整個泡水,塑膠軟管爆裂。她要求賠償櫃子,並在 Google 留下一星評論。',
    'bad', '回修、賠償、負評。',
    '為了成交降低材料標準,最後付出的代價更高。可以給便宜方案,但不能給不安全的方案。');

  perform public._sc_choice(s1, 'start', 1, '「網路上的不保證品質,我們的價格是公司統一的。」', 'cold', 1, 'quote',
    '這是防禦性的回答,沒有讓客戶理解價格的價值,反而更不信任。');
  perform public._sc_choice(s1, 'start', 2, '拿平板給她看剛拍的鏽蝕照片,逐項說明材料、工資與保固,並提供兩個方案。', 'explained', 3, 'quote',
    '很好。先讓客戶看見問題,再拆解價格,並給她選擇權。');
  perform public._sc_choice(s1, 'start', 3, '「不然算你 2,500 好了。」', 'discount', 1, 'quote',
    '沒有理由就降價,客戶會覺得原價灌水。');

  perform public._sc_choice(s1, 'explained', 1, '說明方案二:只換漏水的那一組 1,800 元;軟管要用不鏽鋼編織管才耐壓,不建議塑膠管。', 'end_good', 3, 'quote',
    '用調整範圍來降低金額,材料標準不打折,同時解釋原因。');
  perform public._sc_choice(s1, 'explained', 2, '「塑膠的也可以啦,反正能用。」', 'end_burst', 0, 'work',
    '為了成交降低安全標準,是最危險的選擇。');

  perform public._sc_choice(s1, 'cold', 1, '禮貌告退,留下名片。', 'end_lost', 1, 'quote',
    '有禮貌,但放棄得太快。客戶還不知道問題有多嚴重。');
  perform public._sc_choice(s1, 'cold', 2, '「我讓您看一下剛才拍的照片,了解一下嚴重程度再決定。」再說明方案。', 'explained', 2, 'quote',
    '補救得不錯。如果一開始就這樣做會更好。');

  perform public._sc_choice(s1, 'discount', 1, '「好啦,2,000 就 2,000。」', 'end_cheap', 0, 'quote',
    '一路被砍價,毛利沒了,也教會客戶殺價。');
  perform public._sc_choice(s1, 'discount', 2, '「抱歉,我剛才報價沒說清楚。我讓您看照片,說明兩個方案的差別。」', 'explained', 2, 'quote',
    '承認溝通不足並重新說明,可以挽回信任。');

  -- -----------------------------------------------------------------
  -- 劇本二:施工中發現追加問題
  -- -----------------------------------------------------------------
  insert into public.scenarios (title, description, category, sort_order)
  values ('施工中發現追加問題', '換水龍頭時發現牆內接頭嚴重鏽蝕。練習:停工告知、讓客戶看見、取得同意再追加。', '施工流程', 2)
  returning id into s2;

  perform public._sc_scene(s2, 'start', 1, '林先生家・浴室', null, null,
    '原本報價「更換浴室龍頭 2,000 元」。拆下舊龍頭後,你發現牆內的鍍鋅鐵管接頭鏽蝕嚴重,用手一碰就掉下鐵鏽。林先生在客廳看電視。');
  perform public._sc_scene(s2, 'told', 2, '林先生家・浴室', '林先生',
    '蛤?還要加錢?你們是不是故意找事情做?',
    '林先生走進浴室,皺著眉頭看你。');
  perform public._sc_scene(s2, 'argue', 3, '林先生家・浴室', '林先生',
    '你這是什麼態度?',
    '林先生的音量變大了。');
  perform public._sc_scene(s2, 'end_good', 10, '林先生家・浴室', null, null,
    '林先生看完影片,同意追加 1,500 元更換接頭,並在工單上簽名。完工後你放水測試給他看,他說:「還好你有講。」',
    'good', '追加經客戶同意並留下紀錄,避免日後糾紛與漏水。',
    '施工中發現新問題:停工、拍給客戶看、說明風險與費用、取得同意並記錄,一步都不能少。');
  perform public._sc_scene(s2, 'end_ok', 11, '林先生家・浴室', null, null,
    '林先生勉強同意追加,但事後在滿意度調查給了 2 分,備註「師傅態度很差」。',
    'ok', '問題處理了,但客戶體驗很差。',
    '說實話沒有錯,但「不換壞了別找我」聽起來像威脅。要說明風險,而不是推卸責任。');
  perform public._sc_scene(s2, 'end_complaint', 12, '公司・客服電話', null, null,
    '林先生打電話到公司客訴,要求換師傅,並拒絕支付追加費用。',
    'bad', '客訴、拒付。',
    '客戶情緒上來時,爭論對錯只會讓事情更糟。先道歉、再重新說明。');
  perform public._sc_scene(s2, 'end_bill', 13, '林先生家・客廳', null, null,
    '收款時帳單從 2,000 變成 3,500,林先生拒付追加部分,說你沒經過他同意,揚言要客訴。',
    'bad', '收款糾紛。',
    '沒有事先告知、沒有客戶同意的追加,客戶有權拒付。');
  perform public._sc_scene(s2, 'end_leak', 14, '公司・客服電話', null, null,
    '一個月後樓下鄰居天花板滲水,打牆後發現是那個接頭鏽穿了。林先生質疑:「你上次拆的時候明明有看到!」',
    'bad', '回修、賠償鄰居、商譽受損。',
    '看到問題卻不說,最後責任還是會回到你身上。告知是保護客戶,也是保護自己。');

  perform public._sc_choice(s2, 'start', 1, '先停工,拍照和錄影,請林先生過來看,說明鏽蝕的風險。', 'told', 3, 'work',
    '正確。發現報價以外的問題,先停下來讓客戶知道。');
  perform public._sc_choice(s2, 'start', 2, '直接一起把接頭換掉,收款時再跟他說。', 'end_bill', 0, 'quote',
    '沒有取得同意的追加,收款時一定出問題。');
  perform public._sc_choice(s2, 'start', 3, '裝回新龍頭就好,接頭的事不提。', 'end_leak', 0, 'diagnosis',
    '隱瞞已知風險,是最嚴重的錯誤。');

  perform public._sc_choice(s2, 'told', 1, '給他看影片,說明不換可能牆內漏水、打牆費用更高;報追加 1,500 元,讓他決定並在工單上簽名。', 'end_good', 3, 'quote',
    '讓客戶看見問題、說明不處理的代價、給他決定權,並留下書面紀錄。');
  perform public._sc_choice(s2, 'told', 2, '「不換的話,以後壞了不要找我們。」', 'argue', 1, 'quote',
    '這句話聽起來像威脅,會讓客戶更反感。');

  perform public._sc_choice(s2, 'argue', 1, '「抱歉,我剛才說得不好。我是擔心之後漏到樓下,您的損失更大。」再重新說明。', 'end_ok', 2, 'quote',
    '有道歉、有補救,但第一印象已經被扣分了。');
  perform public._sc_choice(s2, 'argue', 2, '「我只是說實話。」', 'end_complaint', 0, 'quote',
    '跟客戶爭論對錯,事情只會更糟。');

  -- -----------------------------------------------------------------
  -- 劇本三:封閉陽台的熱水器
  -- -----------------------------------------------------------------
  insert into public.scenarios (title, description, category, sort_order)
  values ('封閉陽台的熱水器', '去修水龍頭,卻看到一氧化碳中毒風險。練習:發現工作範圍外的安全問題時,怎麼告知、怎麼說服。', '安全判斷', 3)
  returning id into s3;

  perform public._sc_scene(s3, 'start', 1, '王奶奶家・陽台', null, null,
    '你是來修廚房水龍頭的。經過陽台時,你注意到陽台已經用鋁窗完全封起來,裡面裝的是屋外型(自然排氣)熱水器,窗戶全關,熱水器上方的牆面有一片燻黑。');
  perform public._sc_scene(s3, 'resist', 2, '王奶奶家・客廳', '王奶奶',
    '我用了十幾年都沒事啦。換一台要很多錢吧?',
    '王奶奶一邊倒茶,一邊揮揮手。');
  perform public._sc_scene(s3, 'vague', 3, '王奶奶家・門口', '王奶奶',
    '喔好好好,謝謝你喔。',
    '王奶奶點點頭,但看起來沒有真的聽懂。');
  perform public._sc_scene(s3, 'end_good', 10, '王奶奶家・客廳', null, null,
    '王奶奶決定先買一氧化碳警報器,並答應洗澡時一定開窗;她說會跟兒子商量換強制排氣型,你在工單上記錄「已告知 CO 風險並提供改善報價」。兩週後她兒子打電話來預約改裝。',
    'good', '客戶理解風險、有立即的降低風險做法,並留下紀錄。',
    '工作範圍外的安全問題一定要講。尊重客戶決定,但要給「今天就能做」的降低風險方法,並記錄已告知。');
  perform public._sc_scene(s3, 'end_ok', 11, '王奶奶家・門口', null, null,
    '你們聊完就結束了。王奶奶沒有做任何改變。',
    'ok', '有提醒,但客戶沒有採取任何行動。',
    '只說一次「很危險」不夠。要具體說明什麼時候最危險、今天能做什麼,並寫在工單上。');
  perform public._sc_scene(s3, 'end_pressure', 12, '公司・客服電話', null, null,
    '王奶奶的兒子打電話來客訴:「你們師傅嚇我媽說熱水器隨時會爆炸,就是想推銷!」',
    'bad', '客訴推銷、失去信任。',
    '誇大風險來成交會失去信任。實際的風險(一氧化碳)已經夠嚴重了,如實說明就好。');
  perform public._sc_scene(s3, 'end_tragedy', 13, '新聞', null, null,
    '兩週後寒流來襲,王奶奶關窗洗澡時頭暈倒下,送醫診斷為一氧化碳中毒。家屬得知你曾經到府,卻沒有提醒。',
    'bad', '最嚴重的後果。',
    '專業人員看到明顯的安全風險,就有責任告知,不論是不是這次的工作範圍。');

  perform public._sc_choice(s3, 'start', 1, '修完龍頭後,跟王奶奶說明:封閉陽台加上屋外型熱水器有一氧化碳中毒風險,牆上燻黑就是燃燒不完全的跡象。', 'resist', 3, 'diagnosis',
    '正確。用看得到的證據(燻黑)說明風險。');
  perform public._sc_choice(s3, 'start', 2, '不是這次的工作範圍,修完龍頭就走。', 'end_tragedy', 0, 'diagnosis',
    '安全問題不分工作範圍。');
  perform public._sc_choice(s3, 'start', 3, '離開前隨口說一句「熱水器那樣很危險喔,要換喔」。', 'vague', 1, 'diagnosis',
    '有提醒,但太籠統,客戶不會當一回事。');

  perform public._sc_choice(s3, 'resist', 1, '尊重她的決定,但具體說明冬天關窗洗澡最危險;建議先裝一氧化碳警報器、洗澡時一定開窗,並提供改裝報價,在工單記錄已告知。', 'end_good', 3, 'quote',
    '有立即可做的降低風險方法,也有長期方案,並留下紀錄。');
  perform public._sc_choice(s3, 'resist', 2, '「沒事就好,那就先這樣。」', 'end_ok', 1, 'quote',
    '客戶一推就放棄,風險還在。');
  perform public._sc_choice(s3, 'resist', 3, '「不換的話隨時會爆炸喔!」', 'end_pressure', 0, 'quote',
    '誇大不實,會被當成推銷。');

  perform public._sc_choice(s3, 'vague', 1, '回頭補充:具體說明一氧化碳的風險與燻黑痕跡,留下書面建議。', 'resist', 2, 'diagnosis',
    '補救得好,但第一次就該講清楚。');
  perform public._sc_choice(s3, 'vague', 2, '揮手道別離開。', 'end_tragedy', 0, 'diagnosis',
    '客戶沒聽懂,等於沒說。');

  -- -----------------------------------------------------------------
  -- 劇本四:回修客訴
  -- -----------------------------------------------------------------
  insert into public.scenarios (title, description, category, sort_order)
  values ('回修客訴', '客戶上週才修過的馬桶又在流水,一開門就很生氣。練習:安撫情緒、誠實面對、依公司政策處理。', '到府溝通', 4)
  returning id into s4;

  perform public._sc_scene(s4, 'start', 1, '張先生家・門口', '張先生',
    '你們上次到底有沒有修好?我還特地請假在家等!',
    '回修單:上週更換馬桶止水零件,今天又一直流水。門一打開,張先生就很生氣。');
  perform public._sc_scene(s4, 'inspect', 2, '張先生家・浴室', null, null,
    '你打開水箱檢查:上次換的止水皮沒有問題,是沖水拉桿的鏈條太長,卡在止水皮下面,讓止水皮蓋不緊。上次施工時沒有調整好鏈條長度。');
  perform public._sc_scene(s4, 'compensation', 3, '張先生家・浴室', '張先生',
    '好啦,修好就好。但我今天請假的損失怎麼算?',
    '張先生的語氣緩和了一些。');
  perform public._sc_scene(s4, 'end_good', 10, '張先生家・客廳', null, null,
    '你說明公司的回修政策(本次免費,並提供下次服務折扣),回報公司建立回修紀錄。張先生說:「至少你們願意認。」',
    'good', '客戶情緒被接住、問題誠實處理、公司有回修紀錄可以改善。',
    '回修時:先接住情緒,再誠實說明原因,最後依公司政策處理。回修紀錄是用來改善,不是用來究責的。');
  perform public._sc_scene(s4, 'end_ok', 11, '張先生家・客廳', null, null,
    '你自己掏了 500 元給張先生。他收下了,但公司沒有這次回修的紀錄。',
    'ok', '客戶暫時接受,但私下處理沒有紀錄,公司也無法改善。',
    '補償要依公司政策,不要私下用自己的錢處理。');
  perform public._sc_scene(s4, 'end_blame', 12, '公司・客服電話', null, null,
    '張先生直接打電話到公司客訴,要求換人,並在網路上寫負評。',
    'bad', '客訴與負評。',
    '客戶不在乎上次是誰修的,他在乎的是問題沒解決。推責任只會讓公司整體形象受損。');
  perform public._sc_scene(s4, 'end_lie', 13, '公司・客服電話', null, null,
    '張先生換了新馬桶。另一位師傅到場安裝時發現舊馬桶其實只是鏈條問題,張先生覺得被騙,要求退費。',
    'bad', '誠信問題、退費、負評。',
    '把施工失誤說成客戶設備的問題,一旦被拆穿,損失的是整家公司的信任。');

  perform public._sc_choice(s4, 'start', 1, '「上次不是我修的。」', 'end_blame', 0, 'arrival',
    '推責任只會讓客戶更生氣。對客戶來說,你就代表公司。');
  perform public._sc_choice(s4, 'start', 2, '先道歉,表示理解他請假的不便,說明會先找出原因,確認是零件還是其他問題。', 'inspect', 3, 'arrival',
    '先接住情緒,再處理問題。');
  perform public._sc_choice(s4, 'start', 3, '不說話,直接進浴室開始修。', 'inspect', 1, 'arrival',
    '沒有回應客戶的情緒,客戶會覺得不被重視。');

  perform public._sc_choice(s4, 'inspect', 1, '老實說明是上次鏈條長度沒調好,現場重新調整,沖水示範給他看,說明本次免費。', 'compensation', 3, 'work',
    '誠實說明、當場驗證,是重建信任最快的方法。');
  perform public._sc_choice(s4, 'inspect', 2, '說馬桶太舊了,建議他換新馬桶。', 'end_lie', 0, 'diagnosis',
    '把施工失誤推給設備,是誠信問題。');

  perform public._sc_choice(s4, 'compensation', 1, '依公司回修政策說明可以提供的補償(例如下次服務折扣),並回報公司建立回修紀錄。', 'end_good', 3, 'closing',
    '依政策處理並留下紀錄。');
  perform public._sc_choice(s4, 'compensation', 2, '自己掏 500 元給他。', 'end_ok', 1, 'closing',
    '私下處理沒有紀錄,也不符合公司政策。');

  -- -----------------------------------------------------------------
  -- 晉升條件:初階要「客戶嫌報價太貴」「回修客訴」;中階要「施工中發現追加問題」「封閉陽台的熱水器」
  -- -----------------------------------------------------------------
  insert into public.level_requirements (level_id, req_type, threshold, scenario_id, sort_order)
  select l.id, 'scenario', 70, x.sid, x.ord
  from public.career_levels l
  join (values ('junior', s1, 6), ('junior', s4, 7), ('mid', s2, 7), ('mid', s3, 8)) as x(code, sid, ord) on x.code = l.code;
end $$;

drop function public._sc_scene(uuid, text, int, text, text, text, text, public.ending_type, text, text);
drop function public._sc_choice(uuid, text, int, text, text, int, text, text);
