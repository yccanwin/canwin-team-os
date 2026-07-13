-- CanWin Team OS 3.0 integration security hardening.
-- This migration changes permissions and bucket metadata only. It never mutates
-- protected 2.0 finance_records, achievements, photos, or storage objects.

update storage.buckets
set public = false
where id = 'canwin-media';

drop policy if exists "authenticated uploads canwin media" on storage.objects;
drop policy if exists "authenticated updates canwin media" on storage.objects;
drop policy if exists "authenticated deletes canwin media" on storage.objects;
drop policy if exists "team members read canwin media" on storage.objects;
drop policy if exists "team members upload canwin media" on storage.objects;
drop policy if exists "owners manage canwin media" on storage.objects;

create policy "team members read canwin media"
on storage.objects for select to authenticated
using (
  bucket_id = 'canwin-media'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.team_id = split_part(name, '/', 1)
  )
);

create policy "team members upload canwin media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'canwin-media'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.team_id = split_part(name, '/', 1)
  )
);

create policy "owners manage canwin media"
on storage.objects for update to authenticated
using (
  bucket_id = 'canwin-media'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.team_id = split_part(name, '/', 1)
      and (owner_id = auth.uid()::text or public.has_permission(p.team_id, 'access.manage'))
  )
)
with check (
  bucket_id = 'canwin-media'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.team_id = split_part(name, '/', 1)
      and (owner_id = auth.uid()::text or public.has_permission(p.team_id, 'access.manage'))
  )
);

create policy "owners delete canwin media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'canwin-media'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and p.team_id = split_part(name, '/', 1)
      and (owner_id = auth.uid()::text or public.has_permission(p.team_id, 'access.manage'))
  )
);

-- New 3.0 business state is mutated only through authenticated RPCs. Direct
-- browser DML is revoked even if a future policy is accidentally permissive.
do $$
declare
  target record;
begin
  for target in
    select n.nspname, c.relname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and (
        c.relname like 'crm\_%' escape '\'
        or c.relname like 'deal\_%' escape '\'
        or c.relname like 'fulfillment\_%' escape '\'
        or c.relname like 'performance\_%' escape '\'
        or c.relname like 'official\_reconciliation\_%' escape '\'
        or c.relname like 'import\_%' escape '\'
        or c.relname in (
          'access_delegations', 'access_permissions', 'access_role_permissions',
          'access_roles', 'profile_access_roles', 'profile_sales_regions',
          'sales_regions', 'feature_flags', 'team_invitations',
          'access_admin_requests', 'customer_product_subscriptions',
          'notification_attempts', 'notification_jobs',
          'notification_supervisor_exceptions', 'profit_adjustments',
          'supervisor_exception_resolutions'
        )
      )
  loop
    execute pg_catalog.format('alter table %I.%I enable row level security', target.nspname, target.relname);
    execute pg_catalog.format('revoke insert, update, delete, truncate on table %I.%I from public, anon, authenticated', target.nspname, target.relname);
  end loop;
end
$$;

-- SECURITY DEFINER functions must resolve every object explicitly and must not
-- inherit PostgreSQL's default PUBLIC execute grant.
do $$
declare
  target record;
begin
  for target in
    select p.oid::pg_catalog.regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute pg_catalog.format('alter function %s set search_path = %L', target.signature, '');
    execute pg_catalog.format('revoke all on function %s from public, anon', target.signature);
  end loop;
end
$$;

-- Migration-time assertion: no 3.0 business table may be left without RLS.
do $$
declare
  missing text;
begin
  select pg_catalog.string_agg(c.relname, ', ' order by c.relname)
  into missing
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity
    and (
      c.relname like 'crm\_%' escape '\'
      or c.relname like 'deal\_%' escape '\'
      or c.relname like 'fulfillment\_%' escape '\'
      or c.relname like 'performance\_%' escape '\'
      or c.relname like 'official\_reconciliation\_%' escape '\'
      or c.relname like 'import\_%' escape '\'
      or c.relname in (
        'access_delegations', 'access_permissions', 'access_role_permissions',
        'access_roles', 'profile_access_roles', 'profile_sales_regions',
        'sales_regions', 'feature_flags', 'team_invitations',
        'access_admin_requests', 'customer_product_subscriptions',
        'notification_attempts', 'notification_jobs',
        'notification_supervisor_exceptions', 'profit_adjustments',
        'supervisor_exception_resolutions'
      )
    );

  if missing is not null then
    raise exception 'RLS_REQUIRED:%', missing using errcode = '42501';
  end if;
end
$$;

notify pgrst, 'reload schema';
