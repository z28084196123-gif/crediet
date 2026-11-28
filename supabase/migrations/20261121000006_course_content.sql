-- =====================================================================
-- 006 測驗解說 + 入門教材題庫
--   ※ 題庫為「起始教材」,內容為一般水電實務原則;正式使用前請工務主任審閱,
--     並依公司工法與最新法規(用戶用電設備裝置規則、建築技術規則)調整。
-- =====================================================================

-- 測驗題解說(與正解一起放在技師讀不到的表)與「交卷後是否顯示正解」
alter table public.quiz_answer_keys add column explanation text;
alter table public.quizzes add column reveal_answers boolean not null default true;

-- 交卷後依設定回傳正解與解說
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

  for qq in select qs.id, k.correct_index, k.explanation from public.quiz_questions qs
            left join public.quiz_answer_keys k on k.question_id = qs.id
            where qs.quiz_id = p_quiz_id order by qs.sort_order, qs.id loop
    ok := (p_answers ->> i) is not null and (p_answers ->> i)::int = qq.correct_index;
    if ok then correct := correct + 1; end if;
    results := results || case when q.reveal_answers
      then jsonb_build_object('question_id', qq.id, 'correct', ok, 'correct_index', qq.correct_index, 'explanation', qq.explanation)
      else jsonb_build_object('question_id', qq.id, 'correct', ok) end;
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
-- 建立題目用的暫時函式(本檔結尾刪除)
-- ---------------------------------------------------------------------
create function public._seed_question(p_quiz uuid, p_sort int, p_prompt text, p_options jsonb, p_correct int, p_explain text)
returns void language plpgsql as $$
declare qid uuid;
begin
  insert into public.quiz_questions (quiz_id, prompt, options, sort_order)
  values (p_quiz, p_prompt, p_options, p_sort) returning id into qid;
  insert into public.quiz_answer_keys (question_id, correct_index, explanation) values (qid, p_correct, p_explain);
end $$;

create function public._seed_unit(p_course uuid, p_sort int, p_title text, p_body text)
returns void language sql as $$
  insert into public.course_units (course_id, title, unit_type, body, sort_order)
  values (p_course, p_title, 'text', p_body, p_sort);
$$;

do $$
declare
  c_elec  uuid;  q_elec  uuid;
  c_water uuid;  q_water uuid;
  c_gas   uuid;  q_gas   uuid;
  c_case  uuid;  q_case  uuid;
begin
  -- =================================================================
  -- 課程一:用電安全與停電作業(改寫 005 的範例課程,沿用其 id 與晉升條件)
  -- =================================================================
  select id into c_elec from public.courses order by created_at limit 1;
  select id into q_elec from public.quizzes where course_id = c_elec order by created_at limit 1;

  update public.courses set title = '用電安全與停電作業', category = '學徒必修', sort_order = 1,
    description = '停電作業程序、漏電斷路器與無熔絲開關、跳電判斷,以及施工中追加項目的處理'
  where id = c_elec;
  delete from public.course_units where course_id = c_elec;
  delete from public.quiz_questions where quiz_id = q_elec;
  update public.quizzes set title = '用電安全測驗', pass_score = 80 where id = q_elec;

  perform public._seed_unit(c_elec, 1, '停電作業五步驟',
'1. 確認要施工的迴路,在配電箱找到對應的分路開關。
2. 關閉該分路(不確定時關總開關)。
3. 上鎖掛牌:在開關上貼「施工中,禁止送電」,並告知屋主與家人不可自行送電。
4. 驗電:先在確定有電的插座測試驗電筆正常,再測施工點,必要時用電表量測電壓確認為 0。
5. 完工後清點工具、確認接線與絕緣,再送電測試,並請客戶一起確認。');
  perform public._seed_unit(c_elec, 2, '無熔絲開關與漏電斷路器',
'無熔絲開關(NFB):保護「過載」與「短路」,保護的是線路。
漏電斷路器(ELCB):偵測對地漏電,保護的是「人」。浴室、廚房、陽台、戶外等潮濕場所的插座迴路應設置。人員保護常用規格為額定感度電流 30mA、0.1 秒內動作的高感度高速型。
漏電斷路器上的「測試鈕」會模擬漏電,用來確認它能正常跳脫,建議每月測試一次。');
  perform public._seed_unit(c_elec, 3, '跳電怎麼判斷',
'先看「跳的是哪一顆」:
- 漏電斷路器跳脫:懷疑線路或電器絕緣不良、受潮。逐一拔除電器或分路找出來源,用絕緣電阻計量測絕緣。
- 無熔絲開關跳脫、使用一陣子才跳:多半是過載,同時用了吹風機、電暖器等大功率電器。
- 一送電就立刻跳,有焦味或火花:短路。不可再送電,要逐段檢查。
重要:開關容量要配合導線的安全電流。不能為了不跳電就把開關換大,導線會過熱起火。');
  perform public._seed_unit(c_elec, 4, '施工中發現額外問題',
'施工中發現報價以外的問題(例如管線鏽蝕、線路老化):
1. 先停下來,拍照或用內視鏡讓客戶看到問題。
2. 說明不處理的風險與處理方案。
3. 重新報價,客戶同意後再施工,並記錄在工單上。
不可以先做再說,也不可以隱瞞不講。');

  perform public._seed_question(q_elec, 1,
    '客戶浴室插座迴路跳電,配電箱中跳脫的是「漏電斷路器」。最優先懷疑什麼?',
    '["同時使用太多電器造成過載", "線路或電器絕緣不良、受潮漏電", "電力公司電壓不穩", "斷路器容量太小"]', 1,
    '漏電斷路器偵測的是對地漏電,不是過載。浴室潮濕,應先檢查插座、線路或電器是否受潮或絕緣劣化。');
  perform public._seed_question(q_elec, 2,
    '客戶說「常跳電,幫我把 20A 的開關換成 30A 就好」。正確的處理是?',
    '["照做,客戶要求優先", "直接換成漏電斷路器就好", "先確認導線線徑與實際負載;導線容量不足時不可只加大開關", "建議客戶少用電器就好,不用檢查"]', 2,
    '開關是保護導線的。導線安全電流不足卻換大開關,過載時開關不跳,導線會過熱甚至起火。要先確認線徑與負載,必要時增設迴路或更換導線。');
  perform public._seed_question(q_elec, 3,
    '停電作業時,關閉分路開關後,下一步應該?',
    '["上鎖掛牌、告知屋主不可送電,再驗電確認無電", "立即開始拆線", "請屋主在旁邊看著開關就好", "把總開關也關掉後直接施工"]', 0,
    '關開關之後要防止別人誤送電(上鎖掛牌、告知),並實際驗電確認無電,才能開始作業。');
  perform public._seed_question(q_elec, 4,
    '用驗電筆確認施工點沒電之前,應該先做什麼?',
    '["把驗電筆擦乾淨", "直接測施工點,沒亮就是沒電", "先在確定有電的插座測一次,確認驗電筆本身正常", "戴上手套就不用驗電"]', 2,
    '驗電筆可能沒電或故障。若沒先確認它正常,「沒亮」不代表沒電。');
  perform public._seed_question(q_elec, 5,
    '漏電斷路器上的「測試按鈕」用途是?',
    '["跳脫後用來復歸", "調整感度電流", "讓斷路器暫時不動作", "模擬漏電,確認斷路器能正常跳脫"]', 3,
    '按下測試鈕會製造模擬漏電,斷路器應立即跳脫。不會跳就代表故障,要更換。');
  perform public._seed_question(q_elec, 6,
    '人員觸電保護用的高感度漏電斷路器,最常見的額定感度電流是?',
    '["5mA", "30mA", "100mA", "500mA"]', 1,
    '住宅潮濕場所插座迴路的人員保護,常用 30mA、0.1 秒內動作的高感度高速型。100mA 以上多用於設備或火災保護。');
  perform public._seed_question(q_elec, 7,
    '某一間房間的燈和插座都沒電,但總開關與其他房間正常。最先檢查什麼?',
    '["電力公司是否停電", "電表是否故障", "該房間分路開關是否跳脫,或插座/接線盒是否鬆脫燒毀", "熱水器是否漏電"]', 2,
    '只有一區沒電,問題通常在該分路:分路開關跳脫、接點鬆脫或燒毀。先從配電箱該分路查起。');
  perform public._seed_question(q_elec, 8,
    '施工中發現原報價以外的問題(例如管線鏽蝕需要更換),應該?',
    '["先停下來,拍照讓客戶看並說明,重新報價經同意後再做", "直接一起修好,最後再一起收錢", "不告訴客戶,下次再來處理", "照原報價做完就好,其他不管"]', 0,
    '標準流程:先讓客戶看到問題,說明風險與方案,重新報價取得同意。這樣做才不會產生收款糾紛,也讓客戶信任。');

  -- =================================================================
  -- 課程二:給排水基礎與漏水判斷
  -- =================================================================
  insert into public.courses (title, description, category, sort_order)
  values ('給排水基礎與漏水判斷', '水錶測漏、存水彎與水封、排水坡度、浴室漏水分層判斷', '學徒必修', 2)
  returning id into c_water;
  insert into public.quizzes (course_id, title, pass_score) values (c_water, '給排水測驗', 80) returning id into q_water;

  perform public._seed_unit(c_water, 1, '用水錶判斷是否漏水',
'1. 關閉家中所有用水設備(水龍頭、馬桶、熱水器、洗衣機)。
2. 看水錶的小指針(或紅色三角形指針)是否轉動。
3. 有轉動,代表給水管線或設備在漏水。再逐一關閉各區水閥縮小範圍。
這是到府第一步,幾分鐘就能確認是不是給水管漏水。');
  perform public._seed_unit(c_water, 2, '存水彎與水封',
'存水彎(P 型、S 型)會留住一段水,稱為「水封」,阻擋排水管的臭氣與蟲。水封深度一般約 5–10 公分。
水封消失的常見原因:
- 久未使用,水蒸發乾掉
- 虹吸作用把水封吸走(通氣不良)
- 地排沒有存水彎或防臭蓋損壞
有臭味但排水正常,先查水封。');
  perform public._seed_unit(c_water, 3, '排水坡度',
'排水橫管需要適當坡度。
- 太平緩:流速不夠,汙物沉積容易堵。
- 太陡:水流太快,固體物跟不上被留在管內,反而容易堵。
管徑越大,需要的坡度越小,一般約在 1/50 到 1/100 之間,施工依設計與法規。');
  perform public._seed_unit(c_water, 4, '浴室漏到樓下:分層判斷',
'漏水來源分三層,逐一排除:
1. 給水管(冷熱水管):水管隨時有壓力,不用水也會漏。用水錶測試。
2. 排水管:只有用水排水時才漏。可灌水測試排水路徑。
3. 防水層:地面積水才會滲。做閉水試驗:封住排水口放水,觀察 24–48 小時樓下是否滲水。
先判斷是哪一層,再決定工法與報價。');

  perform public._seed_question(q_water, 1,
    '客戶懷疑家裡暗管漏水,最快的初步判斷方式是?',
    '["關閉所有用水後,觀察水錶小指針是否轉動", "敲牆聽聲音", "直接打牆找", "看這期水費有沒有變多"]', 0,
    '關閉所有用水後水錶仍在轉,就代表給水端有漏水,幾分鐘就能判斷,不用先破壞。');
  perform public._seed_question(q_water, 2,
    '浴室地板排水孔一直有臭味,但排水很順。最可能的原因是?',
    '["排水管堵塞", "水壓太高", "熱水器故障", "地排沒有存水彎,或水封乾掉、被吸走"]', 3,
    '排水順代表沒堵,臭味是因為沒有水封阻擋臭氣。檢查存水彎、防臭蓋與通氣狀況。');
  perform public._seed_question(q_water, 3,
    '屋主出國一個月回來,覺得浴室、陽台排水口很臭。最簡單的處理是?',
    '["更換整組排水管", "打開各排水口放水,讓存水彎重新形成水封", "噴芳香劑", "用膠帶封死排水孔"]', 1,
    '久未使用,存水彎的水蒸發了。放水讓水封恢復即可,不需要施工。');
  perform public._seed_question(q_water, 4,
    '排水橫管坡度做得太陡,可能造成什麼問題?',
    '["排水太慢", "水封變深", "水流太快,固體物留在管內,反而容易堵塞", "沒有任何影響"]', 2,
    '坡度不是越陡越好。水流太快會把固體物留在後面,一樣會堵。');
  perform public._seed_question(q_water, 5,
    '樓下天花板只在樓上「洗澡後」才滴水,平常不漏。最可能的來源是?',
    '["給水管(冷熱水管)破裂", "排水管接頭或浴室防水層", "樓下自己的給水管", "熱水器"]', 1,
    '給水管一直有壓力,破了會持續漏。只有用水排水後才漏,較可能是排水管或防水層。');
  perform public._seed_question(q_water, 6,
    '在浴室做「閉水試驗」的目的是?',
    '["確認地面防水層是否滲漏", "測試給水壓力", "清洗排水管", "檢查熱水器是否正常"]', 0,
    '閉水試驗是封住排水口放水靜置 24–48 小時,觀察樓下有無滲水,用來判斷防水層。');
  perform public._seed_question(q_water, 7,
    '馬桶水箱一直有細微流水聲,要判斷是不是止水皮漏水,怎麼做?',
    '["聽聲音判斷就好", "直接換新馬桶", "在水箱滴色素,不沖水,一段時間後看馬桶內是否有顏色", "關掉角閥看還有沒有聲音"]', 2,
    '止水皮漏水時,水箱的水會慢慢流進馬桶。色素測試可以清楚看到,也能拿給客戶看。');
  perform public._seed_question(q_water, 8,
    '面對水龍頭時,一般慣例的冷熱水位置是?',
    '["左冷右熱", "左熱右冷", "上冷下熱", "沒有慣例,隨意接"]', 1,
    '一般慣例是左熱右冷。接反會讓客戶誤觸熱水而燙傷,也容易被客訴。');

  -- =================================================================
  -- 課程三:燃氣熱水器安裝與安全
  -- =================================================================
  insert into public.courses (title, description, category, sort_order)
  values ('燃氣熱水器安裝與安全', '一氧化碳風險、安裝位置與排氣、測漏方式、常見故障判斷', '中階必修', 3)
  returning id into c_gas;
  insert into public.quizzes (course_id, title, pass_score) values (c_gas, '熱水器安全測驗', 80) returning id into q_gas;

  perform public._seed_unit(c_gas, 1, '一氧化碳的風險',
'燃氣燃燒不完全會產生一氧化碳(CO),無色無味,不容易察覺,吸入可能致命。
- 屋外型(自然排氣)熱水器只能裝在通風良好的戶外,陽台加裝窗戶封閉後就不再是戶外。
- 裝在室內必須用強制排氣型,排氣管要接到戶外。
到府看到不安全的安裝方式,一定要告知客戶並建議改善。');
  perform public._seed_unit(c_gas, 2, '安裝檢查重點',
'1. 瓦斯管接頭用肥皂水測漏,看是否冒泡。絕對不能用火測試。
2. 排氣管接頭要密合,出口必須在戶外,不可被遮擋,也不要朝向窗戶。
3. 安裝完成後試燒,確認點火、火焰與排氣正常,並向客戶說明使用注意事項。');
  perform public._seed_unit(c_gas, 3, '常見故障判斷',
'不點火:確認瓦斯開關、電池或電源,以及水量是否達到啟動水量(水壓太低或進水濾網堵塞都會不點火)。
忽冷忽熱:水量不穩、瓦斯壓力不足、熱交換器積垢。
使用多年後熱水變小或過熱跳機,常與熱交換器積垢有關。');

  perform public._seed_question(q_gas, 1,
    '客戶陽台已用鋁窗完全封起來,裡面裝的是屋外型(自然排氣)熱水器。你的建議是?',
    '["維持原狀即可", "窗戶開一點縫就好", "在陽台加一台抽風扇", "改裝強制排氣型並將排氣管接到戶外,或移到通風處"]', 3,
    '封閉陽台等於室內,自然排氣型會累積一氧化碳。開縫或加風扇都不可靠,應改用強制排氣型並把排氣接到戶外。');
  perform public._seed_question(q_gas, 2,
    '檢查瓦斯接頭是否漏氣的正確方法是?',
    '["塗肥皂水,看是否冒泡", "用打火機靠近看有沒有火", "聞味道就好", "把瓦斯開大聽聲音"]', 0,
    '用火測漏可能引發爆炸。肥皂水安全又直觀。');
  perform public._seed_question(q_gas, 3,
    '打開熱水龍頭熱水器卻不點火,而且出水量明顯偏小。優先檢查?',
    '["熱交換器", "排氣管", "進水濾網堵塞或水壓不足,未達啟動水量", "瓦斯表"]', 2,
    '熱水器要達到一定水量才會點火。出水量小,先查水壓與進水濾網。');
  perform public._seed_question(q_gas, 4,
    '關於一氧化碳,下列敘述何者正確?',
    '["有刺鼻臭味,很容易聞到", "無色無味,不容易察覺", "只會沉在地面", "只有電熱水器會產生"]', 1,
    '一氧化碳無色無味,這正是它危險的原因。燃氣燃燒不完全就會產生,和電熱水器無關。');
  perform public._seed_question(q_gas, 5,
    '強制排氣型熱水器的排氣管出口,安裝重點是?',
    '["可以接進天花板內", "接到浴室抽風機", "越長越好", "必須接到戶外,出口不可被遮擋或朝向窗戶"]', 3,
    '排氣要確實排到戶外,接進天花板或浴室抽風機都會讓廢氣回到室內。');
  perform public._seed_question(q_gas, 6,
    '用了很多年的熱水器,熱水忽冷忽熱。較可能的原因是?',
    '["熱交換器積垢,或水量、瓦斯壓力不穩", "冷水管太粗", "電壓太高", "客戶用法錯誤"]', 0,
    '長年使用會在熱交換器累積水垢,加上水量或瓦斯壓力不穩,就會忽冷忽熱。');

  -- =================================================================
  -- 課程四:現場故障排除情境題(中階)
  -- =================================================================
  insert into public.courses (title, description, category, sort_order)
  values ('現場故障排除情境題', '綜合用電、給排水、服務流程的實際案例判斷', '中階情境題', 4)
  returning id into c_case;
  insert into public.quizzes (course_id, title, pass_score) values (c_case, '現場情境判斷測驗', 80) returning id into q_case;

  perform public._seed_unit(c_case, 1, '作答說明',
'以下題目都是實際會遇到的狀況。重點不只是修好,還要找到根本原因、讓客戶看懂問題,並照標準流程報價與施工。
建議先完成「用電安全」「給排水」「熱水器」三門課再作答。');

  perform public._seed_question(q_case, 1,
    '客戶說每次用洗衣機就跳電,跳的是漏電斷路器。你用絕緣電阻計量測,洗衣機對地絕緣偏低。下一步?',
    '["把漏電斷路器換大一點", "拆掉漏電斷路器避免一直跳", "告知客戶洗衣機本體絕緣不良需送修或更換,並確認該插座有確實接地", "叫客戶改插延長線"]', 2,
    '量測已經指向洗衣機本體漏電,漏電斷路器只是在正常保護人。不可以拆除或加大,應處理漏電來源並確認接地。');
  perform public._seed_question(q_case, 2,
    '廚房水槽排水很慢,上次用通管器打通後兩週又塞。比較好的做法是?',
    '["用內視鏡檢查管內油垢、管徑變化或坡度問題,找出根本原因並給客戶看", "再通一次就好", "倒強酸疏通劑", "建議客戶少用水槽"]', 0,
    '反覆堵塞代表有根本原因。用內視鏡讓客戶看到問題,再提出改善方案(清洗、改管、調整坡度),才是長期解法。');
  perform public._seed_question(q_case, 3,
    '樓上浴室漏到樓下。水錶測試小指針不動;封住排水口做閉水試驗 48 小時後,樓下出現水痕。判斷是?',
    '["給水管漏水", "防水層失效", "樓下自己的排水管漏水", "冷氣冷凝水"]', 1,
    '水錶不動,排除給水管。閉水試驗沒有經過排水管也滲水,代表防水層失效。');
  perform public._seed_question(q_case, 4,
    '老公寓牆內是舊的鍍鋅鐵管,水龍頭出水帶黃色、水量變小。你的建議是?',
    '["只換水龍頭", "加裝淨水器就好", "加大加壓馬達", "說明管內鏽蝕,建議分段更換為合格管材,並提供方案與報價"]', 3,
    '黃水與水量變小是鍍鋅管內部鏽蝕造成的,換龍頭或加壓都治標不治本。');
  perform public._seed_question(q_case, 5,
    '送電後總開關立刻跳脫,並聞到焦味。正確的處理是?',
    '["再送一次電確認", "不再送電,逐一分路檢查找出短路點,排除後才復電", "換更大的總開關", "請客戶自己找電工"]', 1,
    '立刻跳加上焦味是短路的徵兆,再送電可能起火。要先找出短路點。');
  perform public._seed_question(q_case, 6,
    '沒人用水時,抽水(加壓)馬達也會一直反覆啟動。最可能的原因是?',
    '["馬達太新還在磨合", "電壓太低", "管線漏水,或逆止閥、浮球閥失效造成壓力下降", "水太乾淨"]', 2,
    '沒用水壓力卻一直下降,代表有地方在洩壓:管線漏水、逆止閥不密或水塔浮球問題。');
  perform public._seed_question(q_case, 7,
    '客戶覺得報價太貴,要求「不要保固,材料用最便宜的」,但便宜材料不符合安全要求。應該?',
    '["照客戶要求做", "說明安全風險,提供符合規範的替代方案;不接受不安全的施工", "不說明,直接用便宜材料", "直接拒絕並離開"]', 1,
    '可以調整方案降低價格,但不能犧牲安全。說清楚風險、提供替代方案,是專業也是保護公司。');
  perform public._seed_question(q_case, 8,
    '施工完成要收款時,客戶說「我還沒確認好不好用」。你應該?',
    '["陪客戶一起測試,說明施工內容與保固,確認後請客戶簽收再收款", "堅持先收款", "留下單據就離開", "主動打折讓客戶付款"]', 0,
    'SOP 的收款簽收節點:先讓客戶確認成果、了解保固,再簽收收款,可以減少糾紛與回修。');

  -- =================================================================
  -- 晉升條件:初階加上「給排水」;中階加上「熱水器」與「情境測驗」
  -- =================================================================
  insert into public.level_requirements (level_id, req_type, threshold, course_id, quiz_id, label, sort_order)
  select l.id, x.t::public.requirement_type, x.th, x.c, x.q, x.lbl, x.ord
  from public.career_levels l
  join (values
    ('junior', 'course',     1::numeric,  c_water, null::uuid, null::text, 5),
    ('mid',    'course',     1,           c_gas,   null,       null,       5),
    ('mid',    'quiz_score', 80,          null,    q_case,     null,       6)
  ) as x(code, t, th, c, q, lbl, ord) on x.code = l.code;
end $$;

drop function public._seed_question(uuid, int, text, jsonb, int, text);
drop function public._seed_unit(uuid, int, text, text);
