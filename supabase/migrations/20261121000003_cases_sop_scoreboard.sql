-- =====================================================================
-- 003 案件、SOP 節點評分、計分板設定與快照、晉升申請與歷程
-- =====================================================================

-- 服務案件。MVP 由督導手動建立;第二階段由億家系統 2.0 匯入(source = 'yijia2')。
create table public.service_cases (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'manual',
  external_ref  text,                                -- 工單編號
  technician_id uuid not null references public.profiles(id) on delete cascade,
  completed_on  date not null default current_date,
  quoted        boolean not null default true,       -- 是否有報價
  converted     boolean not null default false,      -- 報價是否成交
  is_callback   boolean not null default false,      -- 是否為回修案件
  satisfaction  numeric check (satisfaction is null or satisfaction between 1 and 5),
  dual_signoff  boolean,                             -- 雙簽核狀態(第二階段由系統 2.0 帶入)
  notes         text,
  raw           jsonb,                               -- 原始匯入資料(第二階段 adapter 保留)
  created_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (source, external_ref)
);
create index on public.service_cases (technician_id, completed_on);

create table public.sop_nodes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  description text,
  criteria    jsonb not null default '[]'::jsonb,   -- 評分項目(字串陣列)
  weight      numeric not null default 1 check (weight >= 0),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  updated_at  timestamptz not null default now()
);

create type public.scorer_type as enum ('mentor', 'customer');

create table public.sop_scores (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references public.service_cases(id) on delete cascade,
  node_id       uuid not null references public.sop_nodes(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete cascade,
  scorer_id     uuid references public.profiles(id) default auth.uid(),
  scorer_type   public.scorer_type not null default 'mentor',
  score         numeric not null check (score between 1 and 5),
  comment       text,
  created_at    timestamptz not null default now(),
  unique (case_id, node_id, scorer_type)
);
create index on public.sop_scores (technician_id);

-- 技師欄位一律由案件帶入,避免填錯
create or replace function public.sop_scores_fill_tech() returns trigger
language plpgsql as $$
begin
  select technician_id into new.technician_id from public.service_cases where id = new.case_id;
  return new;
end $$;
create trigger sop_scores_fill_tech before insert or update on public.sop_scores
  for each row execute function public.sop_scores_fill_tech();

-- 計分板指標。code 對應計算公式(見 metric_raw_values),其餘欄位皆可在後台調整。
create table public.scoreboard_metrics (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  description      text,
  weight           numeric not null default 0 check (weight >= 0),
  higher_is_better boolean not null default true,
  -- 正規化區間:原始值落在 [norm_min, norm_max] 線性對應到 0–100
  norm_min         numeric not null default 0,
  norm_max         numeric not null default 100,
  sort_order       int not null default 0,
  is_active        boolean not null default true,
  updated_at       timestamptz not null default now(),
  check (norm_max > norm_min)
);

create table public.scoreboard_snapshots (
  id            uuid primary key default gen_random_uuid(),
  period_start  date not null,
  period_end    date not null,
  technician_id uuid not null references public.profiles(id) on delete cascade,
  metrics       jsonb not null,
  total_score   numeric,
  weights       jsonb not null,     -- 計算當下使用的權重設定
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (period_start, period_end, technician_id)
);

-- ---------------------------------------------------------------------
-- 晉升申請與職級歷程
-- ---------------------------------------------------------------------
create type public.promotion_status as enum ('submitted', 'recommended', 'approved', 'rejected', 'withdrawn');

create table public.promotion_requests (
  id                uuid primary key default gen_random_uuid(),
  technician_id     uuid not null references public.profiles(id) on delete cascade,
  from_level_id     uuid references public.career_levels(id),
  to_level_id       uuid not null references public.career_levels(id),
  status            public.promotion_status not null default 'submitted',
  progress_snapshot jsonb not null,   -- 送出時各條件達成狀況
  technician_note   text,
  mentor_id         uuid references public.profiles(id),
  mentor_comment    text,
  mentor_at         timestamptz,
  decided_by        uuid references public.profiles(id),
  decision_comment  text,
  decided_at        timestamptz,
  created_at        timestamptz not null default now()
);
-- 同一技師同時只能有一筆進行中的申請
create unique index promotion_requests_one_open
  on public.promotion_requests (technician_id) where status in ('submitted', 'recommended');

create table public.level_history (
  id                   uuid primary key default gen_random_uuid(),
  technician_id        uuid not null references public.profiles(id) on delete cascade,
  from_level_id        uuid references public.career_levels(id),
  to_level_id          uuid not null references public.career_levels(id),
  promotion_request_id uuid references public.promotion_requests(id),
  changed_by           uuid references public.profiles(id),
  reason               text,
  created_at           timestamptz not null default now()
);
create index on public.level_history (technician_id, created_at desc);

create trigger sop_nodes_touch before update on public.sop_nodes
  for each row execute function public.touch_updated_at();
create trigger scoreboard_metrics_touch before update on public.scoreboard_metrics
  for each row execute function public.touch_updated_at();

create trigger sop_nodes_audit after insert or update or delete on public.sop_nodes
  for each row execute function public.audit_trigger();
create trigger scoreboard_metrics_audit after insert or update or delete on public.scoreboard_metrics
  for each row execute function public.audit_trigger();
create trigger promotion_requests_audit after insert or update on public.promotion_requests
  for each row execute function public.audit_trigger();
create trigger level_history_audit after insert on public.level_history
  for each row execute function public.audit_trigger();
create trigger service_cases_audit after update or delete on public.service_cases
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.service_cases        enable row level security;
alter table public.sop_nodes            enable row level security;
alter table public.sop_scores           enable row level security;
alter table public.scoreboard_metrics   enable row level security;
alter table public.scoreboard_snapshots enable row level security;
alter table public.promotion_requests   enable row level security;
alter table public.level_history        enable row level security;

create policy "cases: read" on public.service_cases for select to authenticated
  using (public.can_view_tech(technician_id));
create policy "cases: insert by mentor/staff" on public.service_cases for insert to authenticated
  with check (public.can_manage_tech(technician_id));
create policy "cases: update by mentor/staff" on public.service_cases for update to authenticated
  using (public.can_manage_tech(technician_id)) with check (public.can_manage_tech(technician_id));
create policy "cases: delete by staff" on public.service_cases for delete to authenticated
  using (public.is_staff());

create policy "sop_nodes: read" on public.sop_nodes for select to authenticated using (true);
create policy "sop_nodes: write" on public.sop_nodes for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy "sop_scores: read" on public.sop_scores for select to authenticated
  using (public.can_view_tech(technician_id));
create policy "sop_scores: write by mentor/staff" on public.sop_scores for insert to authenticated
  with check (public.can_manage_tech(technician_id) and scorer_id = auth.uid());
create policy "sop_scores: update by mentor/staff" on public.sop_scores for update to authenticated
  using (public.can_manage_tech(technician_id))
  with check (public.can_manage_tech(technician_id) and scorer_id = auth.uid());
create policy "sop_scores: delete by mentor/staff" on public.sop_scores for delete to authenticated
  using (public.can_manage_tech(technician_id));

create policy "metrics: read" on public.scoreboard_metrics for select to authenticated using (true);
create policy "metrics: write" on public.scoreboard_metrics for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy "snapshots: read" on public.scoreboard_snapshots for select to authenticated
  using (public.can_view_tech(technician_id));

create policy "promotions: read" on public.promotion_requests for select to authenticated
  using (public.can_view_tech(technician_id));
create policy "level_history: read" on public.level_history for select to authenticated
  using (public.can_view_tech(technician_id));
