-- Restore legacy profile helpers after integration hardening cleared every
-- SECURITY DEFINER search_path. Object references remain schema-qualified.

create or replace function public.current_profile_role(
  target_team_id text default 'CANWIN_TEAM'
)
returns text
language sql
security definer
set search_path = ''
stable
as $function$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.team_id = target_team_id
    and p.status = 'active'
  limit 1
$function$;

create or replace function public.is_team_member(
  target_team_id text default 'CANWIN_TEAM'
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.team_id = target_team_id
      and p.status = 'active'
  )
$function$;

notify pgrst, 'reload schema';
