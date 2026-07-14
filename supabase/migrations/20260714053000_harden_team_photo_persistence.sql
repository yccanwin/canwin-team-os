-- Restore the minimum Data API contract required by the team album without
-- broadening access to other teams or to the whole private media bucket.

alter table public.photos enable row level security;

revoke all on table public.photos from anon;
revoke all on table public.photos from authenticated;
grant select, insert, update, delete on table public.photos to authenticated;

drop policy if exists "team members read photos" on public.photos;
drop policy if exists "team members add photos" on public.photos;
drop policy if exists "team members update photos" on public.photos;
drop policy if exists "team members delete photos" on public.photos;
drop policy if exists "owners or captains manage photos" on public.photos;

create policy "active team members read photos"
on public.photos for select to authenticated
using (team_id = 'CANWIN_TEAM' and public.is_team_member(team_id));

create policy "active team members add own photos"
on public.photos for insert to authenticated
with check (
  team_id = 'CANWIN_TEAM'
  and uploaded_by = (select auth.uid())
  and public.is_team_member(team_id)
);

create policy "uploaders or captains update photos"
on public.photos for update to authenticated
using (
  team_id = 'CANWIN_TEAM'
  and public.is_team_member(team_id)
  and (
    uploaded_by = (select auth.uid())
    or public.current_profile_role(team_id) in ('admin', 'captain')
  )
)
with check (
  team_id = 'CANWIN_TEAM'
  and public.is_team_member(team_id)
  and (
    uploaded_by = (select auth.uid())
    or public.current_profile_role(team_id) in ('admin', 'captain')
  )
);

create policy "uploaders or captains delete photos"
on public.photos for delete to authenticated
using (
  team_id = 'CANWIN_TEAM'
  and public.is_team_member(team_id)
  and (
    uploaded_by = (select auth.uid())
    or public.current_profile_role(team_id) in ('admin', 'captain')
  )
);

-- Preserve legacy non-photo uploads, but remove photos from the broad policy
-- so the strict policy below is authoritative.
drop policy if exists "team members upload canwin media" on storage.objects;
drop policy if exists "owners manage canwin media" on storage.objects;
drop policy if exists "owners delete canwin media" on storage.objects;
drop policy if exists "authenticated uploads canwin media" on storage.objects;
drop policy if exists "authenticated updates canwin media" on storage.objects;
drop policy if exists "authenticated deletes canwin media" on storage.objects;
drop policy if exists "active members upload own team photos" on storage.objects;
drop policy if exists "photo owners delete own team photos" on storage.objects;

create policy "team members upload non-photo canwin media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'canwin-media'
  and coalesce((storage.foldername(name))[2], '') <> 'photos'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.team_id = (storage.foldername(name))[1]
  )
);

create policy "owners manage non-photo canwin media"
on storage.objects for update to authenticated
using (
  bucket_id = 'canwin-media'
  and coalesce((storage.foldername(name))[2], '') <> 'photos'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.team_id = (storage.foldername(name))[1]
      and (owner_id = (select auth.uid())::text or public.has_permission(p.team_id, 'access.manage'))
  )
)
with check (
  bucket_id = 'canwin-media'
  and coalesce((storage.foldername(name))[2], '') <> 'photos'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.team_id = (storage.foldername(name))[1]
      and (owner_id = (select auth.uid())::text or public.has_permission(p.team_id, 'access.manage'))
  )
);

create policy "owners delete non-photo canwin media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'canwin-media'
  and coalesce((storage.foldername(name))[2], '') <> 'photos'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
      and p.team_id = (storage.foldername(name))[1]
      and (owner_id = (select auth.uid())::text or public.has_permission(p.team_id, 'access.manage'))
  )
);

create policy "active members upload own team photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'canwin-media'
  and (storage.foldername(name))[1] = 'CANWIN_TEAM'
  and (storage.foldername(name))[2] = 'photos'
  and (storage.foldername(name))[3] = (select auth.uid())::text
  and cardinality(storage.foldername(name)) = 3
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.team_id = 'CANWIN_TEAM'
      and p.status = 'active'
  )
);

create policy "photo owners delete own team photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'canwin-media'
  and (storage.foldername(name))[1] = 'CANWIN_TEAM'
  and (storage.foldername(name))[2] = 'photos'
  and (storage.foldername(name))[3] = owner_id
  and cardinality(storage.foldername(name)) = 3
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.team_id = 'CANWIN_TEAM'
      and p.status = 'active'
      and (
        owner_id = (select auth.uid())::text
        or public.current_profile_role(p.team_id) in ('admin', 'captain')
      )
  )
);

notify pgrst, 'reload schema';
