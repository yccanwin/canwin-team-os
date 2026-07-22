-- G6 trusted case publication, redacted public projection, and archive boundary.
-- Object byte copying/deletion remains a trusted-server responsibility. The
-- database makes public reads disappear transactionally and queues byte cleanup;
-- it does not pretend that SQL can copy or delete Storage object bytes safely.

alter table public.case_candidates
  add column authorization_evidence_reference text;

alter table public.case_candidates
  drop constraint case_candidates_authorization_consistent;

alter table public.case_candidates
  add constraint case_candidates_authorization_consistent check (
    (
      display_authorization_valid
      and authorization_source is not null and btrim(authorization_source) <> ''
      and authorization_scope is not null and btrim(authorization_scope) <> ''
      and authorization_evidence_reference is not null
      and btrim(authorization_evidence_reference) <> ''
      and authorization_valid_from is not null
      and authorization_recorded_at is not null
      and authorization_withdrawn_at is null
      and authorization_withdrawn_by is null
      and authorization_withdrawal_reason is null
    )
    or not display_authorization_valid
  );

alter table public.cases
  add column sort_order integer not null default 0,
  add column brand_display_name text,
  add column store_display_name text,
  add column industry text,
  add column region text,
  add column store_kind text,
  add column products_and_services text,
  add column original_problem text,
  add column solution text,
  add column launch_result text,
  add column service_team_display text,
  add column unpublished_at timestamptz,
  add column unpublished_by uuid,
  add column archived_at timestamptz,
  add column archived_by uuid,
  add constraint cases_unpublisher_company_fk foreign key (unpublished_by, company_id)
    references public.profiles(id, company_id) on delete restrict,
  add constraint cases_archiver_company_fk foreign key (archived_by, company_id)
    references public.profiles(id, company_id) on delete restrict;

alter table public.cases drop constraint cases_status;
alter table public.cases
  add constraint cases_status check (status in ('draft', 'published', 'unpublished', 'archived'));

alter table public.cases drop constraint cases_publish_contract;
alter table public.cases
  add constraint cases_publish_contract check (
    (
      status = 'published'
      and authorization_valid
      and admin_reviewed_by is not null
      and admin_reviewed_at is not null
      and published_at is not null
      and archived_at is null
      and archived_by is null
    )
    or (
      status <> 'published'
      and published_at is null
      and not authorization_valid
    )
  ),
  add constraint cases_unpublish_consistent check (
    (unpublished_at is null and unpublished_by is null)
    or (unpublished_at is not null and unpublished_by is not null)
  ),
  add constraint cases_archive_consistent check (
    (status = 'archived' and archived_at is not null and archived_by is not null)
    or (status <> 'archived' and archived_at is null and archived_by is null)
  );

create table private.public_case_projection_rows (
  case_id uuid primary key,
  brand_display_name text not null,
  store_display_name text not null,
  industry text not null,
  region text not null,
  store_kind text not null,
  products_and_services text not null,
  original_problem text not null,
  solution text not null,
  launch_result text not null,
  service_team_display text not null,
  logo_public_path text,
  display_code_public_path text,
  sort_order integer not null default 0,
  authorization_valid_until timestamptz,
  published_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint public_case_projection_required_text check (
    btrim(brand_display_name) <> '' and btrim(store_display_name) <> ''
    and btrim(industry) <> '' and btrim(region) <> '' and btrim(store_kind) <> ''
    and btrim(products_and_services) <> '' and btrim(original_problem) <> ''
    and btrim(solution) <> '' and btrim(launch_result) <> ''
    and btrim(service_team_display) <> ''
  )
);

create table private.case_publication_cleanup_queue (
  id bigint generated always as identity primary key,
  case_id uuid not null,
  object_path text not null,
  reason text not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint case_publication_cleanup_path_not_blank check (btrim(object_path) <> ''),
  constraint case_publication_cleanup_reason_not_blank check (btrim(reason) <> ''),
  constraint case_publication_cleanup_unique_pending unique nulls not distinct (case_id, object_path, completed_at)
);

alter table private.public_case_projection_rows enable row level security;
alter table private.case_publication_cleanup_queue enable row level security;

revoke all on table private.public_case_projection_rows,
  private.case_publication_cleanup_queue from anon, authenticated;
grant usage on schema private to anon, authenticated;
grant select on table private.public_case_projection_rows to anon, authenticated;
grant all privileges on table private.public_case_projection_rows,
  private.case_publication_cleanup_queue to service_role;
grant usage, select on sequence private.case_publication_cleanup_queue_id_seq to service_role;

create policy public_case_projection_read
on private.public_case_projection_rows
for select
to anon, authenticated
using (authorization_valid_until is null or authorization_valid_until > (select now()));

create or replace view public.published_cases_public
with (security_invoker = true)
as
select
  brand_display_name,
  store_display_name,
  industry,
  region,
  store_kind,
  products_and_services,
  original_problem,
  solution,
  launch_result,
  service_team_display,
  logo_public_path,
  display_code_public_path,
  sort_order
from private.public_case_projection_rows
where authorization_valid_until is null or authorization_valid_until > now();

revoke all on table public.published_cases_public from public;
grant select on table public.published_cases_public to anon, authenticated;

-- Anonymous visitors can read only the redacted projection, never internal case
-- or case-media rows. Authenticated internal reads remain admin-controlled.
drop policy if exists cases_public_select_published on public.cases;
drop policy if exists case_media_public_select_published on public.case_media;
revoke select on table public.cases, public.case_media from anon;

drop policy if exists team_os_4_public_case_media_read on storage.objects;
create policy team_os_4_public_case_media_read
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'team-os-4-public-cases'
  and exists (
    select 1
    from private.public_case_projection_rows as projection
    where storage.objects.name in (
      projection.logo_public_path,
      projection.display_code_public_path
    )
      and (
        projection.authorization_valid_until is null
        or projection.authorization_valid_until > (select now())
      )
  )
);

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
  insert into private.case_publication_cleanup_queue (case_id, object_path, reason)
  select p_case_id, path.object_path, p_reason
  from private.public_case_projection_rows as projection
  cross join lateral (
    values (projection.logo_public_path), (projection.display_code_public_path)
  ) as path(object_path)
  where projection.case_id = p_case_id
    and path.object_path is not null
  on conflict (case_id, object_path, completed_at) do nothing;

  delete from private.public_case_projection_rows where case_id = p_case_id;
end;
$function$;

revoke all on function private.queue_public_case_media_cleanup(uuid, text) from public;

create or replace function private.unpublish_case_on_authorization_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_case_id uuid;
begin
  if old.display_authorization_valid and not new.display_authorization_valid then
    for v_case_id in
      select c.id
      from public.cases as c
      where c.candidate_id = new.id and c.company_id = new.company_id
      for update
    loop
      perform private.queue_public_case_media_cleanup(v_case_id, 'authorization_withdrawn');
    end loop;

    update public.cases
    set status = case when status = 'archived' then 'archived' else 'unpublished' end,
        authorization_valid = false,
        published_at = null,
        unpublished_at = coalesce(unpublished_at, pg_catalog.now()),
        unpublished_by = coalesce(new.authorization_withdrawn_by, unpublished_by),
        updated_at = pg_catalog.now()
    where candidate_id = new.id and company_id = new.company_id;
  end if;
  return new;
end;
$function$;

revoke all on function private.unpublish_case_on_authorization_withdrawal() from public;

create or replace function public.publish_case_v1(
  p_company_id uuid,
  p_case_id uuid,
  p_sort_order integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_case public.cases%rowtype;
  v_candidate public.case_candidates%rowtype;
  v_logo_path text;
  v_display_code_path text;
  v_missing_public_copy boolean;
begin
  if v_actor is null or not private.is_company_admin(p_company_id) then
    raise exception 'active company admin required' using errcode = '42501';
  end if;

  select c.* into v_case
  from public.cases as c
  where c.id = p_case_id and c.company_id = p_company_id
  for update;
  if not found then
    raise exception 'case not found' using errcode = 'P0002';
  end if;
  if v_case.status = 'archived' then
    raise exception 'archived case cannot be published' using errcode = '55000';
  end if;
  if exists (
    select 1
    from (values
      (v_case.brand_display_name), (v_case.store_display_name), (v_case.industry),
      (v_case.region), (v_case.store_kind), (v_case.products_and_services),
      (v_case.original_problem), (v_case.solution), (v_case.launch_result),
      (v_case.service_team_display)
    ) as required(value)
    where required.value is null or btrim(required.value) = ''
  ) then
    raise exception 'all redacted public case fields are required before publication'
      using errcode = '23514';
  end if;

  select candidate.* into v_candidate
  from public.case_candidates as candidate
  where candidate.id = v_case.candidate_id
    and candidate.company_id = p_company_id
    and candidate.display_authorization_valid
    and candidate.authorization_evidence_reference is not null
    and btrim(candidate.authorization_evidence_reference) <> ''
    and candidate.authorization_withdrawn_at is null
    and (candidate.authorization_valid_until is null or candidate.authorization_valid_until > pg_catalog.now())
  for update;
  if not found then
    raise exception 'current display authorization with external evidence reference required'
      using errcode = '23514';
  end if;

  select
    max(cm.object_path) filter (where cm.media_type = 'logo'),
    max(cm.object_path) filter (where cm.media_type = 'display_code')
  into v_logo_path, v_display_code_path
  from public.case_media as cm
  where cm.case_id = p_case_id and cm.company_id = p_company_id;

  select exists (
    select 1
    from (values (v_logo_path), (v_display_code_path)) as expected(object_path)
    where expected.object_path is not null
      and not exists (
        select 1 from storage.objects as object
        where object.bucket_id = 'team-os-4-public-cases'
          and object.name = expected.object_path
      )
  ) into v_missing_public_copy;

  if v_missing_public_copy then
    raise exception 'trusted server must copy authorized media to the public case bucket before publication'
      using errcode = '55000';
  end if;

  update public.cases
  set status = 'published',
      authorization_valid = true,
      admin_reviewed_by = v_actor,
      admin_reviewed_at = pg_catalog.now(),
      published_at = pg_catalog.now(),
      unpublished_at = null,
      unpublished_by = null,
      sort_order = p_sort_order,
      updated_at = pg_catalog.now()
  where id = p_case_id and company_id = p_company_id
  returning * into v_case;

  insert into private.public_case_projection_rows (
    case_id, brand_display_name, store_display_name, industry, region, store_kind,
    products_and_services, original_problem, solution, launch_result,
    service_team_display, logo_public_path, display_code_public_path,
    sort_order, authorization_valid_until, published_at, updated_at
  ) values (
    v_case.id, v_case.brand_display_name, v_case.store_display_name,
    v_case.industry, v_case.region, v_case.store_kind,
    v_case.products_and_services, v_case.original_problem, v_case.solution,
    v_case.launch_result, v_case.service_team_display, v_logo_path, v_display_code_path,
    v_case.sort_order, v_candidate.authorization_valid_until, v_case.published_at, pg_catalog.now()
  )
  on conflict (case_id) do update
  set brand_display_name = excluded.brand_display_name,
      store_display_name = excluded.store_display_name,
      industry = excluded.industry,
      region = excluded.region,
      store_kind = excluded.store_kind,
      products_and_services = excluded.products_and_services,
      original_problem = excluded.original_problem,
      solution = excluded.solution,
      launch_result = excluded.launch_result,
      service_team_display = excluded.service_team_display,
      logo_public_path = excluded.logo_public_path,
      display_code_public_path = excluded.display_code_public_path,
      sort_order = excluded.sort_order,
      authorization_valid_until = excluded.authorization_valid_until,
      published_at = excluded.published_at,
      updated_at = excluded.updated_at;

  return pg_catalog.jsonb_build_object(
    'case_id', p_case_id,
    'status', 'published',
    'public_projection_visible', true,
    'storage_copy_performed', false
  );
end;
$function$;

create or replace function public.unpublish_case_v1(
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
begin
  if v_actor is null or not private.is_company_admin(p_company_id) then
    raise exception 'active company admin required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.cases
    where id = p_case_id and company_id = p_company_id and status <> 'archived'
    for update
  ) then
    raise exception 'active case not found' using errcode = 'P0002';
  end if;

  perform private.queue_public_case_media_cleanup(p_case_id, 'case_unpublished');
  update public.cases
  set status = 'unpublished', authorization_valid = false, published_at = null,
      unpublished_at = pg_catalog.now(), unpublished_by = v_actor,
      updated_at = pg_catalog.now()
  where id = p_case_id and company_id = p_company_id;

  return pg_catalog.jsonb_build_object(
    'case_id', p_case_id,
    'status', 'unpublished',
    'public_projection_visible', false,
    'storage_delete_queued', true
  );
end;
$function$;

create or replace function public.archive_case_v1(
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
begin
  if v_actor is null or not private.is_company_admin(p_company_id) then
    raise exception 'active company admin required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.cases
    where id = p_case_id and company_id = p_company_id
    for update
  ) then
    raise exception 'case not found' using errcode = 'P0002';
  end if;

  perform private.queue_public_case_media_cleanup(p_case_id, 'case_archived');
  update public.cases
  set status = 'archived', authorization_valid = false, published_at = null,
      archived_at = pg_catalog.now(), archived_by = v_actor,
      updated_at = pg_catalog.now()
  where id = p_case_id and company_id = p_company_id;

  return pg_catalog.jsonb_build_object(
    'case_id', p_case_id,
    'status', 'archived',
    'public_projection_visible', false,
    'storage_delete_queued', true
  );
end;
$function$;

revoke all on function public.publish_case_v1(uuid, uuid, integer) from public, anon;
revoke all on function public.unpublish_case_v1(uuid, uuid) from public, anon;
revoke all on function public.archive_case_v1(uuid, uuid) from public, anon;
grant execute on function public.publish_case_v1(uuid, uuid, integer) to authenticated;
grant execute on function public.unpublish_case_v1(uuid, uuid) to authenticated;
grant execute on function public.archive_case_v1(uuid, uuid) to authenticated;

comment on column public.case_candidates.authorization_evidence_reference is
  'External customer authorization credential reference; evidence files are not stored in Team OS.';
comment on view public.published_cases_public is
  'Security-invoker redacted case projection. It contains no contacts, phones, addresses, prices, profits, or internal audit fields.';
comment on table private.case_publication_cleanup_queue is
  'Trusted-server Storage deletion queue. RLS makes public bytes unreadable immediately; a trusted worker performs physical deletion.';
comment on function public.publish_case_v1(uuid, uuid, integer) is
  'Admin-only trusted publication transaction. Public Storage bytes must already have been copied by the trusted server.';
