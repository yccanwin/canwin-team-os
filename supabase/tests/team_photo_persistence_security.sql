-- Read-only contract test for 20260714053000_harden_team_photo_persistence.sql.
-- Run after migrations in a disposable/local Supabase database.

do $$
declare
  photo_select_qual text;
  photo_insert_check text;
  photo_update_qual text;
  photo_update_check text;
  photo_delete_qual text;
  storage_insert_check text;
  storage_delete_qual text;
  legacy_insert_check text;
begin
  if to_regclass('public.photos') is null then
    raise exception 'public.photos is missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.photos'::regclass) then
    raise exception 'photos RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.photos', 'SELECT')
    or has_table_privilege('anon', 'public.photos', 'INSERT')
    or has_table_privilege('anon', 'public.photos', 'UPDATE')
    or has_table_privilege('anon', 'public.photos', 'DELETE') then
    raise exception 'anon can access photos through the Data API';
  end if;

  if not has_table_privilege('authenticated', 'public.photos', 'SELECT')
    or not has_table_privilege('authenticated', 'public.photos', 'INSERT')
    or not has_table_privilege('authenticated', 'public.photos', 'UPDATE')
    or not has_table_privilege('authenticated', 'public.photos', 'DELETE') then
    raise exception 'authenticated is missing the required photos Data API grants';
  end if;

  if has_table_privilege('authenticated', 'public.photos', 'TRUNCATE')
    or has_table_privilege('authenticated', 'public.photos', 'REFERENCES')
    or has_table_privilege('authenticated', 'public.photos', 'TRIGGER') then
    raise exception 'authenticated received unnecessary photos privileges';
  end if;

  select lower(qual)
  into photo_select_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'photos'
    and policyname = 'active team members read photos';

  select lower(with_check)
  into photo_insert_check
  from pg_policies
  where schemaname = 'public'
    and tablename = 'photos'
    and policyname = 'active team members add own photos';

  select lower(qual), lower(with_check)
  into photo_update_qual, photo_update_check
  from pg_policies
  where schemaname = 'public'
    and tablename = 'photos'
    and policyname = 'uploaders or captains update photos';

  select lower(qual)
  into photo_delete_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'photos'
    and policyname = 'uploaders or captains delete photos';

  if photo_select_qual is null
    or position('canwin_team' in photo_select_qual) = 0
    or position('is_team_member' in photo_select_qual) = 0 then
    raise exception 'team photo read policy is incomplete';
  end if;

  if photo_insert_check is null
    or position('uploaded_by' in photo_insert_check) = 0
    or position('auth.uid' in photo_insert_check) = 0
    or position('is_team_member' in photo_insert_check) = 0 then
    raise exception 'team photo insert policy is incomplete';
  end if;

  if photo_update_qual is null or photo_update_check is null
    or position('canwin_team' in photo_update_qual) = 0
    or position('uploaded_by' in photo_update_qual) = 0
    or position('has_role' in photo_update_qual) = 0
    or position('admin' in photo_update_qual) = 0
    or position('captain' in photo_update_qual) = 0
    or position('is_team_member' in photo_update_qual) = 0
    or position('uploaded_by' in photo_update_check) = 0
    or position('has_role' in photo_update_check) = 0 then
    raise exception 'photo update is not restricted to uploader or captain/admin';
  end if;

  if photo_delete_qual is null
    or position('canwin_team' in photo_delete_qual) = 0
    or position('uploaded_by' in photo_delete_qual) = 0
    or position('has_role' in photo_delete_qual) = 0
    or position('admin' in photo_delete_qual) = 0
    or position('captain' in photo_delete_qual) = 0
    or position('is_team_member' in photo_delete_qual) = 0 then
    raise exception 'photo delete is not restricted to uploader or captain/admin';
  end if;

  select lower(with_check)
  into storage_insert_check
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'active members upload own team photos';

  select lower(qual)
  into storage_delete_qual
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'photo owners delete own team photos';

  select lower(with_check)
  into legacy_insert_check
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'team members upload non-photo canwin media';

  if storage_insert_check is null
    or position('canwin-media' in storage_insert_check) = 0
    or position('canwin_team' in storage_insert_check) = 0
    or position('photos' in storage_insert_check) = 0
    or position('auth.uid' in storage_insert_check) = 0
    or position('cardinality' in storage_insert_check) = 0 then
    raise exception 'photo storage insert path is not strictly scoped';
  end if;

  if storage_delete_qual is null
    or position('owner_id' in storage_delete_qual) = 0
    or position('auth.uid' in storage_delete_qual) = 0
    or position('has_role' in storage_delete_qual) = 0
    or position('admin' in storage_delete_qual) = 0
    or position('captain' in storage_delete_qual) = 0
    or position('photos' in storage_delete_qual) = 0
    or position('cardinality' in storage_delete_qual) = 0 then
    raise exception 'photo storage delete policy does not enforce ownership and path';
  end if;

  if position('owner_id' in split_part(storage_delete_qual, 'exists', 1)) = 0
    or position('auth.uid' in split_part(storage_delete_qual, 'exists', 1)) <> 0 then
    raise exception 'photo storage delete path must match owner_id, not the acting user';
  end if;

  if legacy_insert_check is null
    or position('<> ''photos''' in legacy_insert_check) = 0 then
    raise exception 'legacy media upload policy can still authorize photo paths';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'photos'
      and ('anon' = any(roles) or 'public' = any(roles))
  ) then
    raise exception 'anonymous/public photos policy found';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'photos'
      and policyname not in (
        'active team members read photos',
        'active team members add own photos',
        'uploaders or captains update photos',
        'uploaders or captains delete photos'
      )
  ) then
    raise exception 'unexpected photos policy could widen uploader/captain permissions';
  end if;
end $$;

select 'team_photo_persistence_security_ok' as result;
