-- =====================================================================
-- 001 核心:角色、職級、個人檔案、督導對應、通用設定、稽核紀錄
-- =====================================================================

create type public.app_role as enum ('technician', 'mentor', 'committee', 'admin');

-- 職級定義(學徒 → 初階 → 中階 → 資深)。rank 越大越高。
create table public.career_levels (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  rank        int  not null unique check (rank > 0),
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  full_name        text not null default '',
  phone            text,
  role             public.app_role not null default 'technician',
  current_level_id uuid references public.career_levels(id),
  hired_on         date default current_date,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 督導/組長 ↔ 技師。ends_on 為 null 表示目前有效。
create table public.mentor_assignments (
  id            uuid primary key default gen_random_uuid(),
  mentor_id     uuid not null references public.profiles(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete cascade,
  starts_on     date not null default current_date,
  ends_on       date,
  created_at    timestamptz not null default now(),
  check (mentor_id <> technician_id)
);
create unique index mentor_assignments_one_active
  on public.mentor_assignments (technician_id) where ends_on is null;
create index on public.mentor_assignments (mentor_id) where ends_on is null;

-- 通用可調參數(值為 jsonb)
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

-- 稽核紀錄:誰、何時、改了什麼
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  action      text not null,
  table_name  text not null,
  record_id   text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index on public.audit_log (table_name, created_at desc);

-- ---------------------------------------------------------------------
-- 權限輔助函式(security definer 以避免 RLS 遞迴)
-- ---------------------------------------------------------------------
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

-- 委員會或管理員
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('committee', 'admin'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- 目前使用者是否為該技師的有效督導
create or replace function public.is_mentor_of(tech uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.mentor_assignments
    where mentor_id = auth.uid() and technician_id = tech
      and starts_on <= current_date and (ends_on is null or ends_on >= current_date)
  )
$$;

-- 可讀取該技師資料:本人、督導、委員會/管理員
create or replace function public.can_view_tech(tech uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select tech = auth.uid() or public.is_mentor_of(tech) or public.is_staff()
$$;

-- 可管理(簽核、評分)該技師:督導、委員會/管理員
create or replace function public.can_manage_tech(tech uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_mentor_of(tech) or public.is_staff()
$$;

create or replace function public.get_setting(k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.app_settings where key = k
$$;

-- ---------------------------------------------------------------------
-- 共用 trigger
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec_id text;
begin
  rec_id := coalesce(
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'id',
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'key'
  );
  insert into public.audit_log (actor_id, action, table_name, record_id, before, after)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    rec_id,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger career_levels_touch before update on public.career_levels
  for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

create trigger career_levels_audit after insert or update or delete on public.career_levels
  for each row execute function public.audit_trigger();
create trigger app_settings_audit after insert or update or delete on public.app_settings
  for each row execute function public.audit_trigger();
create trigger mentor_assignments_audit after insert or update or delete on public.mentor_assignments
  for each row execute function public.audit_trigger();

-- 職級與角色只能由管理員或晉升 RPC(設定 app.level_change = on)變更
create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not public.is_admin() and auth.uid() is not null then
    raise exception '只有管理員可以變更角色或啟用狀態';
  end if;
  if new.current_level_id is distinct from old.current_level_id
     and not public.is_admin()
     and coalesce(current_setting('app.level_change', true), '') <> 'on'
     and auth.uid() is not null then
    raise exception '職級只能透過晉升流程或管理員變更';
  end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_fields();

create trigger profiles_audit after update of role, current_level_id, is_active on public.profiles
  for each row execute function public.audit_trigger();

-- 新使用者註冊時自動建立 profile,職級為最低一級
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, current_level_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    (select id from public.career_levels where is_active order by rank limit 1)
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.career_levels      enable row level security;
alter table public.profiles           enable row level security;
alter table public.mentor_assignments enable row level security;
alter table public.app_settings       enable row level security;
alter table public.audit_log          enable row level security;

create policy "levels: 所有登入者可讀" on public.career_levels
  for select to authenticated using (true);
create policy "levels: 委員會/管理員可寫" on public.career_levels
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- 技師也可以看到自己督導的基本資料
create policy "profiles: 本人/督導/委員會可讀" on public.profiles
  for select to authenticated using (
    public.can_view_tech(id)
    or exists (select 1 from public.mentor_assignments m
               where m.mentor_id = profiles.id and m.technician_id = auth.uid() and m.ends_on is null)
  );
create policy "profiles: 本人或管理員可改" on public.profiles
  for update to authenticated using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy "mentor_assignments: 相關人可讀" on public.mentor_assignments
  for select to authenticated using (mentor_id = auth.uid() or technician_id = auth.uid() or public.is_staff());
create policy "mentor_assignments: 委員會/管理員可寫" on public.mentor_assignments
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy "settings: 所有登入者可讀" on public.app_settings
  for select to authenticated using (true);
create policy "settings: 管理員可寫" on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "audit: 委員會/管理員可讀" on public.audit_log
  for select to authenticated using (public.is_staff());
