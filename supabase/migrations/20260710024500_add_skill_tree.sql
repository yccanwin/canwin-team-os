create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) default 'CANWIN_TEAM',
  name text not null,
  category text not null default 'other',
  level text not null default 'basic',
  description text,
  learning_url text,
  prerequisite_ids jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_skills (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) default 'CANWIN_TEAM',
  user_id uuid not null references public.profiles(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  note text,
  lit_at timestamptz not null default now(),
  unique (user_id, skill_id)
);

alter table public.skills enable row level security;
alter table public.user_skills enable row level security;

drop policy if exists "team members read skills" on public.skills;
drop policy if exists "captains manage skills" on public.skills;
drop policy if exists "team members read user skills" on public.user_skills;
drop policy if exists "users light own skills" on public.user_skills;
drop policy if exists "users update own skills" on public.user_skills;
drop policy if exists "users delete own skills" on public.user_skills;

create policy "team members read skills"
on public.skills for select
to authenticated
using (public.is_team_member(team_id));

create policy "captains manage skills"
on public.skills for all
to authenticated
using (public.has_role(team_id, array['admin','captain']))
with check (public.has_role(team_id, array['admin','captain']));

create policy "team members read user skills"
on public.user_skills for select
to authenticated
using (public.is_team_member(team_id));

create policy "users light own skills"
on public.user_skills for insert
to authenticated
with check (public.is_team_member(team_id) and user_id = auth.uid());

create policy "users update own skills"
on public.user_skills for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "users delete own skills"
on public.user_skills for delete
to authenticated
using (user_id = auth.uid());
