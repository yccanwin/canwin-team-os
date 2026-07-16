-- Fix ambiguous `name` references in canwin-media policies.
-- Inside the profile EXISTS subquery PostgreSQL resolved `name` as
-- profiles.name instead of storage.objects.name, which blocked signed URLs.
-- This migration changes policies only; it never mutates media or business rows.

drop policy if exists "team members read canwin media" on storage.objects;
drop policy if exists "team members upload non-photo canwin media" on storage.objects;
drop policy if exists "owners manage non-photo canwin media" on storage.objects;
drop policy if exists "owners delete non-photo canwin media" on storage.objects;

create policy "team members read canwin media"
on storage.objects for select to authenticated
using (
  bucket_id = 'canwin-media'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.team_id = (storage.foldername(storage.objects.name))[1]
  )
);

create policy "team members upload non-photo canwin media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'canwin-media'
  and coalesce((storage.foldername(storage.objects.name))[2], '') <> 'photos'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.team_id = (storage.foldername(storage.objects.name))[1]
  )
);

create policy "owners manage non-photo canwin media"
on storage.objects for update to authenticated
using (
  bucket_id = 'canwin-media'
  and coalesce((storage.foldername(storage.objects.name))[2], '') <> 'photos'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.team_id = (storage.foldername(storage.objects.name))[1]
      and (
        storage.objects.owner_id = (select auth.uid())::text
        or public.has_permission(p.team_id, 'access.manage')
      )
  )
)
with check (
  bucket_id = 'canwin-media'
  and coalesce((storage.foldername(storage.objects.name))[2], '') <> 'photos'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.team_id = (storage.foldername(storage.objects.name))[1]
      and (
        storage.objects.owner_id = (select auth.uid())::text
        or public.has_permission(p.team_id, 'access.manage')
      )
  )
);

create policy "owners delete non-photo canwin media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'canwin-media'
  and coalesce((storage.foldername(storage.objects.name))[2], '') <> 'photos'
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.team_id = (storage.foldername(storage.objects.name))[1]
      and (
        storage.objects.owner_id = (select auth.uid())::text
        or public.has_permission(p.team_id, 'access.manage')
      )
  )
);

do $check$
declare
  read_policy text;
begin
  select coalesce(qual, '')
  into read_policy
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'team members read canwin media';

  if read_policy not like '%foldername(%name)%' then
    raise exception 'canwin-media read policy does not use the object path';
  end if;

  if read_policy like '%split_part(p.name,%' or read_policy like '%storage.foldername(p.name)%' then
    raise exception 'canwin-media read policy still resolves the profile name';
  end if;
end
$check$;
