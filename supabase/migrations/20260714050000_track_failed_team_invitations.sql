-- Keep failed member invitations auditable without presenting them as pending.
-- This is additive metadata only; existing invitations and Auth users are preserved.

alter table public.team_invitations
  drop constraint if exists team_invitations_status_check;

alter table public.team_invitations
  add constraint team_invitations_status_check
  check (status in ('pending', 'accepted', 'cancelled', 'expired', 'failed'));

alter table public.team_invitations
  add column if not exists failure_code text,
  add column if not exists failure_message text,
  add column if not exists failed_at timestamptz,
  add column if not exists auth_user_id uuid;

alter table public.team_invitations
  drop constraint if exists team_invitations_team_id_email_status_key;

create unique index if not exists team_invitations_one_pending_email_idx
  on public.team_invitations (team_id, email)
  where status = 'pending';

create index if not exists team_invitations_failed_at_idx
  on public.team_invitations (team_id, failed_at desc)
  where status = 'failed';

