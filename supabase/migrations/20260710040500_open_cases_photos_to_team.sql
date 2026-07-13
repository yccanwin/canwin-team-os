drop policy if exists "captains manage achievements" on public.achievements;
drop policy if exists "team members add achievements" on public.achievements;
drop policy if exists "team members update achievements" on public.achievements;
drop policy if exists "team members delete achievements" on public.achievements;

create policy "team members add achievements"
on public.achievements for insert
to authenticated
with check (public.is_team_member(team_id) and created_by = auth.uid());

create policy "team members update achievements"
on public.achievements for update
to authenticated
using (public.is_team_member(team_id))
with check (public.is_team_member(team_id));

create policy "team members delete achievements"
on public.achievements for delete
to authenticated
using (public.is_team_member(team_id));

drop policy if exists "owners or captains manage photos" on public.photos;
drop policy if exists "team members update photos" on public.photos;
drop policy if exists "team members delete photos" on public.photos;

create policy "team members update photos"
on public.photos for update
to authenticated
using (public.is_team_member(team_id))
with check (public.is_team_member(team_id));

create policy "team members delete photos"
on public.photos for delete
to authenticated
using (public.is_team_member(team_id));

notify pgrst, 'reload schema';
