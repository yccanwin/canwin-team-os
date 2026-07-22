-- Minimal post-migration smoke test. Run in a disposable/local Supabase DB.
-- Synthetic legacy-member role cases are transactional and fully rolled back.
begin;

do $$
declare
  missing_count integer;
  unsafe_count integer;
begin
  select count(*) into missing_count
  from unnest(array[
    'access_roles', 'access_permissions', 'access_role_permissions',
    'profile_access_roles', 'sales_regions', 'profile_sales_regions',
    'access_delegations', 'feature_flags'
  ]) expected(name)
  where to_regclass('public.' || expected.name) is null;

  if missing_count <> 0 then
    raise exception 'Access foundation is missing % expected tables', missing_count;
  end if;

  select count(*) into unsafe_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = any(array[
      'access_roles', 'access_permissions', 'access_role_permissions',
      'profile_access_roles', 'sales_regions', 'profile_sales_regions',
      'access_delegations', 'feature_flags'
    ])
    and not c.relrowsecurity;

  if unsafe_count <> 0 then
    raise exception '% access tables do not have RLS enabled', unsafe_count;
  end if;

  -- The foundation migration inserts this flag disabled, then the immutable
  -- 20260713200000 pilot migration explicitly enables it. This post-chain test
  -- must verify the final 69-migration state rather than the earlier default.
  if not public.is_feature_enabled('CANWIN_TEAM', 'sales_os_v3') then
    raise exception 'sales_os_v3 pilot enable migration is missing';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'access_roles', 'access_permissions', 'access_role_permissions',
        'profile_access_roles', 'sales_regions', 'profile_sales_regions',
        'access_delegations', 'feature_flags'
      ])
      and ('anon' = any(roles) or 'public' = any(roles))
  ) then
    raise exception 'Anonymous/public access policy found on access tables';
  end if;

  if to_regprocedure('public.has_access_role(text,text[])') is null
     or to_regprocedure('public.has_permission(text,text)') is null
     or to_regprocedure('public.can_act_for(text,uuid)') is null
     or to_regprocedure('public.is_feature_enabled(text,text)') is null then
    raise exception 'One or more access helper functions are missing';
  end if;

  if to_regprocedure('public.manage_profile_access(uuid,text[],uuid[])')is null
    or position('INVALID_ROLE_FOR_TEAM' in pg_get_functiondef('public.manage_profile_access(uuid,text[],uuid[])'::regprocedure))=0
    or position('INVALID_REGION_FOR_TEAM' in pg_get_functiondef('public.manage_profile_access(uuid,text[],uuid[])'::regprocedure))=0 then
    raise exception 'Atomic same-team profile access RPC missing';
  end if;

  if not exists(select 1 from pg_trigger where tgrelid='public.profile_access_roles'::regclass and tgname='profile_access_roles_last_admin'and tgdeferrable and tginitdeferred)
    or position('LAST_ADMIN_REQUIRED' in pg_get_functiondef('public.protect_last_team_admin()'::regprocedure))=0 then
    raise exception 'Deferred last-admin protection missing';
  end if;

  if has_function_privilege('anon','public.manage_profile_access(uuid,text[],uuid[])','EXECUTE')then
    raise exception 'Anonymous profile access management exposed';
  end if;
end $$;

insert into auth.users(
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  -- Synthetic negative control plus the two owner-confirmed explicit-role shapes.
  ('d5100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'access-negative@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('d5100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'access-sales@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('d5100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'access-admin@example.invalid', '', now(), '{}', '{}', now(), now());

insert into public.profiles(id, team_id, name, role, status)
values
  ('d5100000-0000-4000-8000-000000000001', 'CANWIN_TEAM', 'Access Negative', 'member', 'active'),
  ('d5100000-0000-4000-8000-000000000002', 'CANWIN_TEAM', 'Access Sales', 'member', 'active'),
  ('d5100000-0000-4000-8000-000000000003', 'CANWIN_TEAM', 'Access Admin', 'member', 'active')
on conflict(id) do update
set team_id = excluded.team_id,
    name = excluded.name,
    role = excluded.role,
    status = excluded.status;

insert into public.profile_access_roles(team_id, profile_id, role_id, assignment_kind)
select 'CANWIN_TEAM', fixture.profile_id, ar.id, 'primary'
from (values
  ('d5100000-0000-4000-8000-000000000002'::uuid, 'sales'::text),
  ('d5100000-0000-4000-8000-000000000003'::uuid, 'admin'::text)
) fixture(profile_id, role_code)
join public.access_roles ar
  on ar.team_id = 'CANWIN_TEAM'
 and ar.code = fixture.role_code;

set constraints profile_access_roles_one_primary immediate;
set constraints profile_access_roles_one_primary deferred;

do $legacy_member_roles$
begin
  perform set_config('request.jwt.claim.sub', 'd5100000-0000-4000-8000-000000000001', true);
  if public.has_permission('CANWIN_TEAM', 'customers.manage')
    or public.has_permission('CANWIN_TEAM', 'access.manage') then
    raise exception 'Legacy member without an explicit primary role received managed access';
  end if;

  perform set_config('request.jwt.claim.sub', 'd5100000-0000-4000-8000-000000000002', true);
  if not public.has_permission('CANWIN_TEAM', 'customers.manage')
    or public.has_permission('CANWIN_TEAM', 'access.manage') then
    raise exception 'Explicit sales primary role permission contract failed';
  end if;

  perform set_config('request.jwt.claim.sub', 'd5100000-0000-4000-8000-000000000003', true);
  if not public.has_permission('CANWIN_TEAM', 'access.manage') then
    raise exception 'Explicit admin primary role permission contract failed';
  end if;
end
$legacy_member_roles$;

select 'access_control_foundation_ok' as result;
rollback;
