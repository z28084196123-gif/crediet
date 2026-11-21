-- =====================================================================
-- 002 訓練:課程、單元、測驗、完成紀錄、實作時數、職級條件
-- =====================================================================

create table public.courses (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  category    text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create type public.unit_type as enum ('text', 'video', 'image');

create table public.course_units (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses(id) on delete cascade,
  title      text not null,
  unit_type  public.unit_type not null default 'text',
  body       text,          -- 文字內容(markdown 純文字)
  media_url  text,          -- 影片連結或圖片網址
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.course_units (course_id, sort_order);

create table public.quizzes (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses(id) on delete cascade,
  title        text not null,
  pass_score   numeric not null default 80 check (pass_score between 0 and 100),
  max_attempts int check (max_attempts is null or max_attempts > 0),  -- null = 不限次數
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.quiz_questions (
  id         uuid primary key default gen_random_uuid(),
  quiz_id    uuid not null references public.quizzes(id) on delete cascade,
  prompt     text not null,
  options    jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2),
  sort_order int not null default 0
);

-- 正解分開存放,技師讀不到
create table public.quiz_answer_keys (
  question_id   uuid primary key references public.quiz_questions(id) on delete cascade,
  correct_index int not null check (correct_index >= 0)
);

create table public.quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       uuid not null references public.quizzes(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete cascade,
  answers       jsonb not null,
  score         numeric not null,
  passed        boolean not null,
  source        text not null default 'quiz',  -- quiz | ai_simulation(第二階段)
  created_at    timestamptz not null default now()
);
create index on public.quiz_attempts (technician_id, quiz_id);

create table public.unit_progress (
  technician_id uuid not null references public.profiles(id) on delete cascade,
  unit_id       uuid not null references public.course_units(id) on delete cascade,
  completed_at  timestamptz not null default now(),
  primary key (technician_id, unit_id)
);

create table public.course_completions (
  technician_id uuid not null references public.profiles(id) on delete cascade,
  course_id     uuid not null references public.courses(id) on delete cascade,
  completed_at  timestamptz not null default now(),
  primary key (technician_id, course_id)
);

-- ---------------------------------------------------------------------
-- 實作時數
-- ---------------------------------------------------------------------
create type public.review_status as enum ('pending', 'approved', 'rejected');

create table public.practice_hours (
  id            uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  work_date     date not null default current_date,
  hours         numeric(5, 2) not null check (hours > 0 and hours <= 24),
  case_ref      text,              -- 工單號(選填)
  description   text not null,
  status        public.review_status not null default 'pending',
  reviewer_id   uuid references public.profiles(id),
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now()
);
create index on public.practice_hours (technician_id, status);

create trigger practice_hours_audit after update or delete on public.practice_hours
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------
-- 職級晉升條件(到達某職級需要的條件)
-- ---------------------------------------------------------------------
create type public.requirement_type as enum (
  'practice_hours',    -- 已簽核實作時數 >= threshold
  'course',            -- 完成指定課程 (course_id)
  'quiz_score',        -- 指定測驗最佳成績 >= threshold (quiz_id)
  'case_count',        -- 完工案件數 >= threshold
  'satisfaction_avg',  -- 客戶滿意度平均 >= threshold
  'sop_avg'            -- SOP 節點平均分數 >= threshold
);

create table public.level_requirements (
  id          uuid primary key default gen_random_uuid(),
  level_id    uuid not null references public.career_levels(id) on delete cascade,
  req_type    public.requirement_type not null,
  threshold   numeric not null default 1,
  course_id   uuid references public.courses(id) on delete cascade,
  quiz_id     uuid references public.quizzes(id) on delete cascade,
  window_days int check (window_days is null or window_days > 0),  -- null = 累計全部
  label       text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (req_type <> 'course' or course_id is not null),
  check (req_type <> 'quiz_score' or quiz_id is not null)
);
create index on public.level_requirements (level_id);

create trigger courses_touch before update on public.courses
  for each row execute function public.touch_updated_at();
create trigger level_requirements_touch before update on public.level_requirements
  for each row execute function public.touch_updated_at();

create trigger level_requirements_audit after insert or update or delete on public.level_requirements
  for each row execute function public.audit_trigger();
create trigger courses_audit after insert or update or delete on public.courses
  for each row execute function public.audit_trigger();
create trigger quizzes_audit after insert or update or delete on public.quizzes
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.courses            enable row level security;
alter table public.course_units       enable row level security;
alter table public.quizzes            enable row level security;
alter table public.quiz_questions     enable row level security;
alter table public.quiz_answer_keys   enable row level security;
alter table public.quiz_attempts      enable row level security;
alter table public.unit_progress      enable row level security;
alter table public.course_completions enable row level security;
alter table public.practice_hours     enable row level security;
alter table public.level_requirements enable row level security;

-- 教材類:登入者可讀,委員會/管理員可寫
create policy "courses: read" on public.courses for select to authenticated using (is_active or public.is_staff());
create policy "courses: write" on public.courses for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "units: read" on public.course_units for select to authenticated using (true);
create policy "units: write" on public.course_units for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "quizzes: read" on public.quizzes for select to authenticated using (true);
create policy "quizzes: write" on public.quizzes for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "questions: read" on public.quiz_questions for select to authenticated using (true);
create policy "questions: write" on public.quiz_questions for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "answer_keys: staff only" on public.quiz_answer_keys for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "requirements: read" on public.level_requirements for select to authenticated using (true);
create policy "requirements: write" on public.level_requirements for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 個人紀錄:本人/督導/委員會可讀;寫入走 RPC
create policy "attempts: read" on public.quiz_attempts for select to authenticated using (public.can_view_tech(technician_id));
create policy "unit_progress: read" on public.unit_progress for select to authenticated using (public.can_view_tech(technician_id));
create policy "completions: read" on public.course_completions for select to authenticated using (public.can_view_tech(technician_id));

-- 實作時數:技師只能新增/修改/刪除自己「待簽核」的紀錄;簽核走 RPC
create policy "hours: read" on public.practice_hours for select to authenticated
  using (public.can_view_tech(technician_id));
create policy "hours: insert own pending" on public.practice_hours for insert to authenticated
  with check (technician_id = auth.uid() and status = 'pending' and reviewer_id is null and reviewed_at is null);
create policy "hours: update own pending" on public.practice_hours for update to authenticated
  using (technician_id = auth.uid() and status = 'pending')
  with check (technician_id = auth.uid() and status = 'pending' and reviewer_id is null and reviewed_at is null);
create policy "hours: delete own pending" on public.practice_hours for delete to authenticated
  using (technician_id = auth.uid() and status = 'pending');
