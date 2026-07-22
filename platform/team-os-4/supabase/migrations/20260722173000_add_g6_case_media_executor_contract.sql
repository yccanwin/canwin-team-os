-- G6 trusted case-media executor database contract.
-- Browser callers can request work only through JWT-authenticated, admin-checked
-- functions. The Edge Function owns Storage byte operations; no secret key is
-- returned to a client or accepted from request input.

alter table private.case_publication_cleanup_queue
  add column company_id uuid,
  add column claim_token uuid,
  add column claimed_at timestamptz,
  add column attempts integer not null default 0,
  add column last_error text;

update private.case_publication_cleanup_queue as queue
set company_id = cases.company_id
from public.cases as cases
where cases.id = queue.case_id;

alter table private.case_publication_cleanup_queue
  alter column company_id set not null,
  add constraint case_publication_cleanup_company_fk foreign key (company_id)
    references public.companies(id) on delete restrict,
  add constraint case_publication_cleanup_case_company_fk foreign key (case_id, company_id)
    references public.cases(id, company_id) on delete restrict,
  add constraint case_publication_cleanup_claim_consistent check (
    (claim_token is null and claimed_at is null)
    or (claim_token is not null and claimed_at is not null)
  ),
  add constraint case_publication_cleanup_attempts_nonnegative check (attempts >= 0);

create index case_publication_cleanup_pending_company_idx
  on private.case_publication_cleanup_queue (company_id, requested_at, id)
  where completed_at is null;

create or replace function private.queue_public_case_media_cleanup(
  p_case_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into private.case_publication_cleanup_queue (
    company_id,
    case_id,
    object_path,
    reason
  )
  select cases.company_id, p_case_id, path.object_path, p_reason
  from public.cases as cases
  join private.public_case_projection_rows as projection
    on projection.case_id = cases.id
  cross join lateral (
    values (projection.logo_public_path), (projection.display_code_public_path)
  ) as path(object_path)
  where cases.id = p_case_id
    and path.object_path is not null
  on conflict (case_id, object_path, completed_at) do nothing;

  delete from private.public_case_projection_rows where case_id = p_case_id;
end;
$function$;

revoke all on function private.queue_public_case_media_cleanup(uuid, text) from public;

create or replace function public.prepare_case_publication_v1(
  p_company_id uuid,
  p_case_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_candidate public.case_candidates%rowtype;
  v_status text;
  v_media jsonb;
begin
  if v_actor is null or not private.is_company_admin(p_company_id) then
    raise exception 'active company admin required' using errcode = '42501';
  end if;

  select cases.status, candidate
  into v_status, v_candidate
  from public.cases as cases
  join public.case_candidates as candidate
    on candidate.id = cases.candidate_id
   and candidate.company_id = cases.company_id
  where cases.id = p_case_id
    and cases.company_id = p_company_id
  for share of cases, candidate;

  if not found then
    raise exception 'case not found' using errcode = 'P0002';
  end if;
  if v_status = 'archived' then
    raise exception 'archived case cannot be published' using errcode = '55000';
  end if;
  if not v_candidate.display_authorization_valid
     or v_candidate.authorization_evidence_reference is null
     or btrim(v_candidate.authorization_evidence_reference) = ''
     or v_candidate.authorization_withdrawn_at is not null
     or (
       v_candidate.authorization_valid_until is not null
       and v_candidate.authorization_valid_until <= pg_catalog.now()
     ) then
    raise exception 'current display authorization with external evidence reference required'
      using errcode = '23514';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'media_type', media.media_type,
        'source_path', media.object_path,
        'public_path', media.object_path,
        'mime_type', media.mime_type,
        'size_bytes', media.size_bytes
      ) order by media.media_type
    ),
    '[]'::jsonb
  )
  into v_media
  from public.case_media as media
  where media.company_id = p_company_id
    and media.case_id = p_case_id;

  return pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'case_id', p_case_id,
    'authorization_checked_at', pg_catalog.now(),
    'media', v_media
  );
end;
$function$;

create or replace function public.claim_case_publication_cleanup_v1(
  p_company_id uuid,
  p_case_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_claim_token uuid := gen_random_uuid();
  v_items jsonb;
begin
  if v_actor is null or not private.is_company_admin(p_company_id) then
    raise exception 'active company admin required' using errcode = '42501';
  end if;
  if p_limit < 1 or p_limit > 50 then
    raise exception 'cleanup limit must be between 1 and 50' using errcode = '22023';
  end if;
  if p_case_id is not null and not exists (
    select 1 from public.cases
    where id = p_case_id and company_id = p_company_id
  ) then
    raise exception 'case not found' using errcode = 'P0002';
  end if;

  with candidates as (
    select queue.id
    from private.case_publication_cleanup_queue as queue
    where queue.company_id = p_company_id
      and queue.completed_at is null
      and (p_case_id is null or queue.case_id = p_case_id)
      and (
        queue.claim_token is null
        or queue.claimed_at < pg_catalog.now() - interval '5 minutes'
      )
    order by queue.requested_at, queue.id
    limit p_limit
    for update skip locked
  ), claimed as (
    update private.case_publication_cleanup_queue as queue
    set claim_token = v_claim_token,
        claimed_at = pg_catalog.now(),
        attempts = queue.attempts + 1,
        last_error = null
    from candidates
    where queue.id = candidates.id
    returning pg_catalog.jsonb_build_object(
      'id', queue.id,
      'case_id', queue.case_id,
      'object_path', queue.object_path,
      'attempt', queue.attempts
    ) as item
  )
  select coalesce(pg_catalog.jsonb_agg(claimed.item), '[]'::jsonb)
  into v_items
  from claimed;

  return pg_catalog.jsonb_build_object(
    'company_id', p_company_id,
    'claim_token', v_claim_token,
    'items', v_items
  );
end;
$function$;

create or replace function public.finish_case_publication_cleanup_v1(
  p_company_id uuid,
  p_cleanup_id bigint,
  p_claim_token uuid,
  p_succeeded boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not private.is_company_admin(p_company_id) then
    raise exception 'active company admin required' using errcode = '42501';
  end if;
  if p_succeeded and exists (
    select 1
    from private.case_publication_cleanup_queue
    where id = p_cleanup_id
      and company_id = p_company_id
      and completed_at is not null
  ) then
    return true;
  end if;

  update private.case_publication_cleanup_queue
  set completed_at = case when p_succeeded then pg_catalog.now() else null end,
      claim_token = null,
      claimed_at = null,
      last_error = case
        when p_succeeded then null
        else left(coalesce(nullif(btrim(p_error), ''), 'storage deletion failed'), 1000)
      end
  where id = p_cleanup_id
    and company_id = p_company_id
    and claim_token = p_claim_token
    and completed_at is null;

  if not found then
    raise exception 'cleanup claim not found or no longer owned' using errcode = 'P0002';
  end if;
  return p_succeeded;
end;
$function$;

revoke all on function public.prepare_case_publication_v1(uuid, uuid) from public, anon;
revoke all on function public.claim_case_publication_cleanup_v1(uuid, uuid, integer) from public, anon;
revoke all on function public.finish_case_publication_cleanup_v1(uuid, bigint, uuid, boolean, text) from public, anon;
grant execute on function public.prepare_case_publication_v1(uuid, uuid) to authenticated;
grant execute on function public.claim_case_publication_cleanup_v1(uuid, uuid, integer) to authenticated;
grant execute on function public.finish_case_publication_cleanup_v1(uuid, bigint, uuid, boolean, text) to authenticated;

comment on function public.prepare_case_publication_v1(uuid, uuid) is
  'JWT caller must be an active company admin; rechecks current authorization and returns the deterministic private-to-public media copy plan.';
comment on function public.claim_case_publication_cleanup_v1(uuid, uuid, integer) is
  'Admin-only, lease-based claim for idempotent trusted-server deletion of public case bytes.';
comment on function public.finish_case_publication_cleanup_v1(uuid, bigint, uuid, boolean, text) is
  'Completes or safely releases one cleanup lease after the trusted server attempts Storage deletion.';
