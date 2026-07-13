-- Minimal post-migration smoke test. Run in a disposable/local Supabase DB.
-- It is read-only and raises on missing objects or unsafe defaults.
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

  if public.is_feature_enabled('CANWIN_TEAM', 'sales_os_v3') then
    raise exception 'sales_os_v3 must default to disabled';
  end if;

  -- Compatibility bootstrap must fail closed: a legacy member is not
  -- implicitly a salesperson and receives no customer-management permission.
  if exists (
    select 1
    from public.profiles p
    join public.profile_access_roles par
      on par.profile_id = p.id and par.team_id = p.team_id
    join public.access_roles ar
      on ar.id = par.role_id and ar.team_id = par.team_id
    join public.access_role_permissions arp on arp.role_id = ar.id
    where p.role = 'member'
      and arp.permission_code = 'customers.manage'
  ) then
    raise exception 'Legacy member received implicit customers.manage permission';
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

select 'access_control_foundation_ok' as result;
