-- ============================================================
-- CanWin Team OS — Supabase 阶段 1 Schema
-- 在 Supabase SQL Editor 中执行。执行前先在 Auth 中创建唯一初始账号：
--   email: admin@yccanwin.com
--   password: 由项目所有者设置
-- ============================================================

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'canwin-media',
  'canwin-media',
  true,
  5242880,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "authenticated uploads canwin media" on storage.objects;
drop policy if exists "authenticated updates canwin media" on storage.objects;
drop policy if exists "authenticated deletes canwin media" on storage.objects;
create policy "authenticated uploads canwin media" on storage.objects for insert to authenticated with check (bucket_id = 'canwin-media');
create policy "authenticated updates canwin media" on storage.objects for update to authenticated using (bucket_id = 'canwin-media') with check (bucket_id = 'canwin-media');
create policy "authenticated deletes canwin media" on storage.objects for delete to authenticated using (bucket_id = 'canwin-media');

-- 旧整包同步表：只作为迁移期备份，不再作为长期主数据。
create table if not exists team_data (
  id uuid default gen_random_uuid() primary key,
  team_id text not null,
  table_name text not null,
  data jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique(team_id, table_name)
);

create table if not exists teams (
  id text primary key,
  name text not null,
  slug text unique,
  created_at timestamptz not null default now()
);

alter table teams add column if not exists slug text;
create unique index if not exists teams_slug_key on teams(slug);

insert into teams (id, name, slug)
values ('CANWIN_TEAM', '翻身小队', 'canwin-team')
on conflict (id) do update set name = excluded.name, slug = excluded.slug;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  name text not null,
  role text not null default 'member' check (role in ('admin', 'captain', 'finance', 'warehouse', 'member')),
  position text default '',
  avatar_url text,
  join_date date default current_date,
  status text not null default 'active' check (status in ('active', 'disabled')),
  rest_days jsonb not null default '[]'::jsonb,
  communication_preference text,
  mood text,
  taboos text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  title text not null,
  type text not null default 'other',
  assignee_id uuid references profiles(id),
  status text not null default 'todo',
  deadline timestamptz,
  description text,
  is_important boolean not null default false,
  created_by uuid references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  title text not null,
  event_type text not null default 'other' check (event_type in ('rest_day', 'task_deadline', 'personal_goal_deadline', 'team_goal_deadline', 'visit', 'store_check', 'inventory_check', 'team_activity', 'finance_day', 'meeting', 'schedule', 'task', 'other')),
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  user_id uuid references profiles(id),
  related_type text,
  related_id uuid,
  visibility text not null default 'team' check (visibility in ('team', 'private', 'admin')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists finance_records (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  record_type text not null check (record_type in ('income', 'expense')),
  amount numeric(12,2) not null check (amount >= 0),
  category text not null,
  date date not null,
  note text,
  sensitive_note text,
  user_id uuid references profiles(id),
  visibility_level text not null default 'restricted' check (visibility_level in ('public', 'restricted', 'admin')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table finance_records add column if not exists user_id uuid references profiles(id);

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  name text not null,
  sku text,
  quantity numeric(12,2) not null default 0,
  unit text not null default '件',
  public_status text,
  low_stock_threshold numeric(12,2) not null default 0,
  unit_cost numeric(12,2),
  supplier text,
  sensitive_note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists inventory_logs (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  item_id uuid references inventory_items(id) on delete cascade,
  operation text not null check (operation in ('in', 'out', 'adjust')),
  quantity_change numeric(12,2) not null,
  operator_id uuid references profiles(id),
  finance_record_id uuid references finance_records(id),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  name text not null,
  category text,
  description text,
  purchase_date date,
  amount numeric(12,2),
  amount_visibility text not null default 'restricted' check (amount_visibility in ('public', 'restricted', 'admin')),
  status text not null default 'active',
  owner_id uuid references profiles(id),
  image_url text,
  finance_record_id uuid references finance_records(id),
  sensitive_note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists timeline_events (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  title text not null,
  event_date date not null,
  category text,
  description text,
  visibility text not null default 'team' check (visibility in ('team', 'private', 'admin')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists achievements (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  name text not null,
  category text,
  description text,
  achieved_date date,
  timeline_event_id uuid references timeline_events(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  title text,
  image_url text not null,
  album text,
  uploaded_by uuid references profiles(id),
  taken_at timestamptz,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  title text not null,
  description text,
  deadline timestamptz,
  status text not null default 'active',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vote_options (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references votes(id) on delete cascade,
  label text not null
);

create table if not exists vote_records (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references votes(id) on delete cascade,
  option_id uuid not null references vote_options(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  voted_at timestamptz not null default now(),
  unique(vote_id, user_id)
);

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  title text not null,
  content text not null,
  status text not null default 'draft',
  effective_date date,
  related_vote_id uuid references votes(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tools (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  title text not null,
  url text not null,
  description text,
  category text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists team_goals (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  title text not null,
  description text,
  target_amount numeric(12,2),
  current_amount numeric(12,2) not null default 0,
  deadline date,
  status text not null default 'active',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists personal_goals (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  description text,
  goal_type text,
  target_amount numeric(12,2),
  deadline date,
  visibility text not null default 'team' check (visibility in ('team', 'private')),
  lock_status text not null default 'cooldown' check (lock_status in ('cooldown', 'locked', 'review', 'unlocked')),
  locked_at timestamptz,
  unlock_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists goal_updates (
  id uuid primary key default gen_random_uuid(),
  goal_type text not null check (goal_type in ('team', 'personal')),
  goal_id uuid not null,
  content text not null,
  amount_delta numeric(12,2),
  image_url text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists badges (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  name text not null,
  description text,
  icon text,
  badge_type text not null default 'personal' check (badge_type in ('team', 'personal')),
  category text,
  trigger_rule jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists badge_awards (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  badge_id uuid not null references badges(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  awarded_at timestamptz not null default now(),
  source_type text,
  source_id uuid
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references teams(id) default 'CANWIN_TEAM',
  actor_id uuid references profiles(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_profile_role(target_team_id text default 'CANWIN_TEAM')
returns text
language sql
security definer
set search_path = public
stable
as $$
  select p.role
  from profiles p
  where p.id = auth.uid()
    and p.team_id = target_team_id
    and p.status = 'active'
  limit 1
$$;

create or replace function public.is_team_member(target_team_id text default 'CANWIN_TEAM')
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from profiles p
    where p.id = auth.uid()
      and p.team_id = target_team_id
      and p.status = 'active'
  )
$$;

create or replace function public.has_role(target_team_id text, allowed_roles text[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_profile_role(target_team_id) = any(allowed_roles), false)
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, team_id, name, role, position)
  values (
    new.id,
    'CANWIN_TEAM',
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), '成员'),
    case when lower(new.email) = 'admin@yccanwin.com' then 'admin' else 'member' end,
    case when lower(new.email) = 'admin@yccanwin.com' then '系统管理员' else '' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'team_data','teams','profiles','tasks','calendar_events','finance_records',
    'inventory_items','inventory_logs','assets','timeline_events','achievements',
    'photos','votes','vote_options','vote_records','announcements','tools',
    'team_goals','personal_goals','goal_updates','badges','badge_awards','audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

-- 清理旧宽松策略
drop policy if exists "Allow all on team_data" on team_data;
drop policy if exists "Allow all on teams" on teams;

create policy "authenticated can read teams" on teams for select to authenticated using (true);
create policy "admin can manage teams" on teams for all to authenticated using (public.has_role(id, array['admin'])) with check (public.has_role(id, array['admin']));

create policy "team members can read own team profiles" on profiles for select to authenticated using (public.is_team_member(team_id));
create policy "users can update own basic profile" on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and role = (select role from profiles where id = auth.uid()));
create policy "admin can manage profiles" on profiles for all to authenticated using (public.has_role(team_id, array['admin'])) with check (public.has_role(team_id, array['admin']));

create policy "team_data readonly backup" on team_data for select to authenticated using (public.has_role(team_id, array['admin']));

create policy "team members read tasks" on tasks for select to authenticated using (public.is_team_member(team_id));
create policy "captains manage tasks" on tasks for all to authenticated using (public.has_role(team_id, array['admin','captain'])) with check (public.has_role(team_id, array['admin','captain']));

create policy "team members read calendar events" on calendar_events for select to authenticated using (public.is_team_member(team_id) and visibility <> 'admin');
create policy "captains manage calendar events" on calendar_events for all to authenticated using (public.has_role(team_id, array['admin','captain'])) with check (public.has_role(team_id, array['admin','captain']));

drop policy if exists "warehouse reads own inventory finance records" on finance_records;
drop policy if exists "warehouse creates inventory finance records" on finance_records;
drop policy if exists "warehouse deletes own inventory finance records" on finance_records;
create policy "finance roles read finance records" on finance_records for select to authenticated using (public.has_role(team_id, array['admin','captain','finance']));
create policy "warehouse reads own inventory finance records" on finance_records for select to authenticated using (
  public.has_role(team_id, array['warehouse'])
  and created_by = auth.uid()
  and (note like '入库：%' or note like '出库：%')
);
create policy "finance roles manage finance records" on finance_records for all to authenticated using (public.has_role(team_id, array['admin','captain','finance'])) with check (public.has_role(team_id, array['admin','captain','finance']));
create policy "warehouse creates inventory finance records" on finance_records for insert to authenticated with check (
  public.has_role(team_id, array['warehouse'])
  and created_by = auth.uid()
  and (note like '入库：%' or note like '出库：%')
);
create policy "warehouse deletes own inventory finance records" on finance_records for delete to authenticated using (
  public.has_role(team_id, array['warehouse'])
  and created_by = auth.uid()
  and (note like '入库：%' or note like '出库：%')
);

create policy "inventory roles read inventory items" on inventory_items for select to authenticated using (public.has_role(team_id, array['admin','captain','warehouse']));
create policy "inventory roles manage inventory items" on inventory_items for all to authenticated using (public.has_role(team_id, array['admin','captain','warehouse'])) with check (public.has_role(team_id, array['admin','captain','warehouse']));
create policy "inventory roles read inventory logs" on inventory_logs for select to authenticated using (public.has_role(team_id, array['admin','captain','warehouse']));
create policy "inventory roles manage inventory logs" on inventory_logs for all to authenticated using (public.has_role(team_id, array['admin','captain','warehouse'])) with check (public.has_role(team_id, array['admin','captain','warehouse']));

create policy "team members read assets" on assets for select to authenticated using (public.is_team_member(team_id));
create policy "captains manage assets" on assets for all to authenticated using (public.has_role(team_id, array['admin','captain'])) with check (public.has_role(team_id, array['admin','captain']));

create policy "team members read timeline" on timeline_events for select to authenticated using (public.is_team_member(team_id) and visibility <> 'admin');
create policy "captains manage timeline" on timeline_events for all to authenticated using (public.has_role(team_id, array['admin','captain'])) with check (public.has_role(team_id, array['admin','captain']));

create policy "team members read achievements" on achievements for select to authenticated using (public.is_team_member(team_id));
create policy "captains manage achievements" on achievements for all to authenticated using (public.has_role(team_id, array['admin','captain'])) with check (public.has_role(team_id, array['admin','captain']));

create policy "team members read photos" on photos for select to authenticated using (public.is_team_member(team_id));
create policy "team members add photos" on photos for insert to authenticated with check (public.is_team_member(team_id) and uploaded_by = auth.uid());
create policy "owners or captains manage photos" on photos for update to authenticated using (uploaded_by = auth.uid() or public.has_role(team_id, array['admin','captain'])) with check (uploaded_by = auth.uid() or public.has_role(team_id, array['admin','captain']));
create policy "owners or captains delete photos" on photos for delete to authenticated using (uploaded_by = auth.uid() or public.has_role(team_id, array['admin','captain']));

create policy "team members read votes" on votes for select to authenticated using (public.is_team_member(team_id));
create policy "captains manage votes" on votes for all to authenticated using (public.has_role(team_id, array['admin','captain'])) with check (public.has_role(team_id, array['admin','captain']));
create policy "team members read vote options" on vote_options for select to authenticated using (exists (select 1 from votes v where v.id = vote_id and public.is_team_member(v.team_id)));
create policy "captains manage vote options" on vote_options for all to authenticated using (exists (select 1 from votes v where v.id = vote_id and public.has_role(v.team_id, array['admin','captain']))) with check (exists (select 1 from votes v where v.id = vote_id and public.has_role(v.team_id, array['admin','captain'])));
create policy "team members vote once" on vote_records for insert to authenticated with check (user_id = auth.uid() and exists (select 1 from votes v where v.id = vote_id and public.is_team_member(v.team_id)));
create policy "team members read vote records" on vote_records for select to authenticated using (exists (select 1 from votes v where v.id = vote_id and public.is_team_member(v.team_id)));

create policy "team members read announcements" on announcements for select to authenticated using (public.is_team_member(team_id));
create policy "captains manage announcements" on announcements for all to authenticated using (public.has_role(team_id, array['admin','captain'])) with check (public.has_role(team_id, array['admin','captain']));

create policy "team members read tools" on tools for select to authenticated using (public.is_team_member(team_id));
create policy "team members add tools" on tools for insert to authenticated with check (public.is_team_member(team_id) and created_by = auth.uid());
create policy "owners or captains manage tools" on tools for update to authenticated using (created_by = auth.uid() or public.has_role(team_id, array['admin','captain'])) with check (created_by = auth.uid() or public.has_role(team_id, array['admin','captain']));
create policy "owners or captains delete tools" on tools for delete to authenticated using (created_by = auth.uid() or public.has_role(team_id, array['admin','captain']));

create policy "team members read team goals" on team_goals for select to authenticated using (public.is_team_member(team_id));
create policy "captains manage team goals" on team_goals for all to authenticated using (public.has_role(team_id, array['admin','captain'])) with check (public.has_role(team_id, array['admin','captain']));

drop policy if exists "members read visible personal goals" on personal_goals;
drop policy if exists "users create own personal goals" on personal_goals;
drop policy if exists "users update own unlocked personal goals" on personal_goals;
drop policy if exists "admin can manage personal goals" on personal_goals;
create policy "members read visible personal goals" on personal_goals for select to authenticated using (public.is_team_member(team_id) and (visibility = 'team' or user_id = auth.uid()));
create policy "users create own personal goals" on personal_goals for insert to authenticated with check (public.is_team_member(team_id) and user_id = auth.uid());
create policy "users update own unlocked personal goals" on personal_goals for update to authenticated
  using (
    user_id = auth.uid()
    and (
      lock_status = 'unlocked'
      or (lock_status = 'cooldown' and created_at > now() - interval '24 hours')
    )
  )
  with check (
    user_id = auth.uid()
    and lock_status in ('cooldown', 'unlocked')
  );
create policy "admin can manage personal goals" on personal_goals for all to authenticated using (public.has_role(team_id, array['admin'])) with check (public.has_role(team_id, array['admin']));

drop policy if exists "team members read goal updates" on goal_updates;
drop policy if exists "team members create goal updates" on goal_updates;
create policy "team members read goal updates" on goal_updates for select to authenticated using (
  (
    goal_type = 'personal'
    and exists (
      select 1
      from personal_goals pg
      where pg.id = goal_id
        and public.is_team_member(pg.team_id)
        and (pg.visibility = 'team' or pg.user_id = auth.uid())
    )
  )
  or (
    goal_type = 'team'
    and exists (
      select 1
      from team_goals tg
      where tg.id = goal_id
        and public.is_team_member(tg.team_id)
    )
  )
);
create policy "team members create goal updates" on goal_updates for insert to authenticated with check (
  created_by = auth.uid()
  and (
    (
      goal_type = 'personal'
      and exists (
        select 1
        from personal_goals pg
        where pg.id = goal_id
          and pg.user_id = auth.uid()
      )
    )
    or (
      goal_type = 'team'
      and exists (
        select 1
        from team_goals tg
        where tg.id = goal_id
          and public.has_role(tg.team_id, array['admin','captain'])
      )
    )
  )
);

create policy "team members read badges" on badges for select to authenticated using (public.is_team_member(team_id));
create policy "captains manage badges" on badges for all to authenticated using (public.has_role(team_id, array['admin','captain'])) with check (public.has_role(team_id, array['admin','captain']));
create policy "team members read badge awards" on badge_awards for select to authenticated using (public.is_team_member(team_id));
create policy "captains manage badge awards" on badge_awards for all to authenticated using (public.has_role(team_id, array['admin','captain'])) with check (public.has_role(team_id, array['admin','captain']));

drop policy if exists "admin reads audit logs" on audit_logs;
drop policy if exists "system roles create audit logs" on audit_logs;
drop policy if exists "team members create audit logs" on audit_logs;
create policy "admin reads audit logs" on audit_logs for select to authenticated using (public.has_role(team_id, array['admin']));
create policy "team members create audit logs" on audit_logs for insert to authenticated with check (actor_id = auth.uid() and public.is_team_member(team_id));

create or replace view finance_public_summary
with (security_invoker = false) as
select
  team_id,
  date_trunc('month', date)::date as month,
  record_type,
  category,
  sum(amount) as total_amount,
  count(*) as record_count
from finance_records
group by team_id, date_trunc('month', date)::date, record_type, category;

create or replace view inventory_public_items
with (security_invoker = false) as
select
  id,
  team_id,
  name,
  sku,
  quantity,
  unit,
  public_status,
  low_stock_threshold,
  updated_at
from inventory_items;

grant select on finance_public_summary to authenticated;
grant select on inventory_public_items to authenticated;

create index if not exists idx_profiles_team on profiles(team_id);
create index if not exists idx_tasks_team_status on tasks(team_id, status);
create index if not exists idx_calendar_team_start on calendar_events(team_id, start_at);
create index if not exists idx_finance_team_date on finance_records(team_id, date desc);
create index if not exists idx_inventory_team on inventory_items(team_id);
create index if not exists idx_assets_team on assets(team_id);
create index if not exists idx_timeline_team_date on timeline_events(team_id, event_date desc);

-- 若 admin@yccanwin.com 已经在执行本 SQL 前创建，可补齐 profile：
insert into profiles (id, team_id, name, role, position)
select id, 'CANWIN_TEAM', 'admin', 'admin', '系统管理员'
from auth.users
where lower(email) = 'admin@yccanwin.com'
on conflict (id) do update
set role = 'admin',
    name = excluded.name,
    position = excluded.position,
    updated_at = now();
