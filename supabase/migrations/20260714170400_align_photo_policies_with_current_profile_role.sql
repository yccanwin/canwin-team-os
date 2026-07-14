-- Align production photo authorization with the rebuilt migration chain.
-- Only replace the three photo mutation policies that previously used has_role.

drop policy if exists "uploaders or captains update photos" on public.photos;
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

drop policy if exists "uploaders or captains delete photos" on public.photos;
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

drop policy if exists "photo owners delete own team photos" on storage.objects;
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
