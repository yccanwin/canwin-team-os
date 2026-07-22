-- G2 performance acceptance support. This remains isolated from operating data.

alter index public.work_items_server_bucket_cursor_idx
  rename to work_items_server_queue_cursor_idx;

comment on index public.work_items_server_queue_cursor_idx is
  'G2 base-bucket keyset index matching list_work_items_v1 after company and assignee filters.';

create table private.g2_performance_runs (
  run_id text primary key,
  company_id uuid not null references public.companies(id) on delete restrict,
  target_project_ref text not null,
  business_date date not null,
  profile_ids uuid[] not null,
  generation_rule text not null unique,
  active_profile_count integer not null,
  work_item_count integer not null,
  status text not null default 'prepared',
  created_at timestamptz not null default now(),
  cleaned_at timestamptz,
  constraint g2_performance_runs_run_id check (
    run_id ~ '^g2-[a-z0-9][a-z0-9-]{5,80}$'
  ),
  constraint g2_performance_runs_target_project check (
    target_project_ref = 'jgcrhoabvaowxnqksvkq'
  ),
  constraint g2_performance_runs_profiles check (
    cardinality(profile_ids) = 30 and active_profile_count = 30
  ),
  constraint g2_performance_runs_items check (work_item_count = 100000),
  constraint g2_performance_runs_generation check (
    generation_rule = 'g2-performance:' || run_id
  ),
  constraint g2_performance_runs_status check (status in ('prepared', 'cleaned')),
  constraint g2_performance_runs_cleanup_state check (
    (status = 'prepared' and cleaned_at is null)
    or (status = 'cleaned' and cleaned_at is not null)
  )
);

alter table private.g2_performance_runs enable row level security;
revoke all on table private.g2_performance_runs from public, anon, authenticated;
grant select, insert, update on table private.g2_performance_runs to service_role;

create or replace function public.setup_g2_performance_fixture_v1(
  p_run_id text,
  p_company_id uuid,
  p_target_project_ref text,
  p_business_date date,
  p_profile_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role_id uuid;
  v_distinct_profiles integer;
  v_valid_auth_users integer;
  v_inserted_profiles integer;
  v_inserted_items integer;
  v_generation_rule text;
  v_day_start timestamptz;
begin
  if p_run_id is null or p_run_id !~ '^g2-[a-z0-9][a-z0-9-]{5,80}$' then
    raise exception 'invalid G2 performance run id' using errcode = '22023';
  end if;
  if p_target_project_ref is distinct from 'jgcrhoabvaowxnqksvkq' then
    raise exception 'G2 performance fixtures are restricted to the independent Team OS 4.0 test project'
      using errcode = '42501';
  end if;
  if p_business_date is distinct from (
    pg_catalog.timezone('Asia/Shanghai', pg_catalog.statement_timestamp())
  )::date then
    raise exception 'business date must equal the current Asia/Shanghai business date'
      using errcode = '22023';
  end if;
  if p_profile_ids is null or cardinality(p_profile_ids) <> 30 then
    raise exception 'exactly 30 temporary performance auth user ids are required'
      using errcode = '22023';
  end if;

  select pg_catalog.count(distinct supplied.profile_id)::integer
  into v_distinct_profiles
  from pg_catalog.unnest(p_profile_ids) as supplied(profile_id);
  if v_distinct_profiles <> 30 then
    raise exception 'temporary performance auth user ids must be distinct'
      using errcode = '22023';
  end if;

  if exists (select 1 from private.g2_performance_runs where run_id = p_run_id) then
    raise exception 'G2 performance run id already exists' using errcode = '23505';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.profiles where id = any(p_profile_ids)) then
    raise exception 'temporary auth user id already has a profile; permanent accounts are forbidden'
      using errcode = '23505';
  end if;

  select pg_catalog.count(*)::integer
  into v_valid_auth_users
  from auth.users as auth_user
  where auth_user.id = any(p_profile_ids)
    and auth_user.raw_app_meta_data ->> 'team_os_4_data_class' = 'g2-performance'
    and auth_user.raw_app_meta_data ->> 'team_os_4_run_id' = p_run_id
    and auth_user.raw_app_meta_data ->> 'team_os_4_project_ref' = p_target_project_ref;
  if v_valid_auth_users <> 30 then
    raise exception
      'all 30 auth users must be server-created temporary G2 performance users for this run and project'
      using errcode = '23514';
  end if;

  select role.id into v_role_id
  from public.primary_roles as role
  where role.company_id = p_company_id
    and role.role_key = 'sales'
    and role.is_active;
  if v_role_id is null then
    raise exception 'active sales role not found' using errcode = 'P0002';
  end if;

  insert into public.profiles (
    id, company_id, primary_role_id, display_name, is_active
  )
  select
    supplied.profile_id,
    p_company_id,
    v_role_id,
    'G2 performance ' || p_run_id || ' #' || supplied.ordinality::text,
    true
  from pg_catalog.unnest(p_profile_ids) with ordinality
    as supplied(profile_id, ordinality);
  get diagnostics v_inserted_profiles = row_count;
  if v_inserted_profiles <> 30 then
    raise exception 'G2 performance profile count mismatch: %', v_inserted_profiles
      using errcode = '23514';
  end if;

  v_generation_rule := 'g2-performance:' || p_run_id;
  v_day_start := pg_catalog.timezone('Asia/Shanghai', p_business_date::timestamp);

  insert into public.work_items (
    company_id,
    assignee_id,
    role_type,
    kind,
    source_business,
    source_id,
    generation_rule,
    title,
    status,
    priority,
    planned_at,
    due_at,
    next_step,
    blocked_reason,
    sort_bucket
  )
  select
    p_company_id,
    p_profile_ids[((item_number - 1) % 30) + 1],
    'sales',
    'reminder',
    'g2_performance',
    gen_random_uuid(),
    v_generation_rule,
    'G2 performance ' || p_run_id || ' item ' || item_number::text,
    case
      when item_number % 10 = 0 then 'waiting'
      when item_number % 3 = 0 then 'in_progress'
      else 'pending'
    end,
    case item_number % 4
      when 0 then 'urgent'
      when 1 then 'high'
      when 2 then 'normal'
      else 'low'
    end,
    v_day_start + ((item_number % 31) || ' days')::interval,
    case item_number % 7
      when 0 then v_day_start - interval '1 day' + ((item_number % 720) || ' minutes')::interval
      when 1 then v_day_start + ((item_number % 720) || ' minutes')::interval
      else v_day_start + (((item_number % 31) + 1) || ' days')::interval
    end,
    'Inspect G2 performance item ' || item_number::text,
    case when item_number % 10 = 0 then 'Waiting for synthetic performance dependency' else null end,
    case item_number % 6
      when 0 then 'overdue_blocking'
      when 1 then 'upcoming_business_date'
      when 2 then 'first_contact'
      when 3 then 'reclaim_soon'
      when 4 then 'renewal'
      else 'normal'
    end
  from pg_catalog.generate_series(1, 100000) as generated(item_number);
  get diagnostics v_inserted_items = row_count;
  if v_inserted_items <> 100000 then
    raise exception 'G2 performance work item count mismatch: %', v_inserted_items
      using errcode = '23514';
  end if;

  insert into private.g2_performance_runs (
    run_id,
    company_id,
    target_project_ref,
    business_date,
    profile_ids,
    generation_rule,
    active_profile_count,
    work_item_count
  ) values (
    p_run_id,
    p_company_id,
    p_target_project_ref,
    p_business_date,
    p_profile_ids,
    v_generation_rule,
    v_inserted_profiles,
    v_inserted_items
  );

  analyze public.work_items;

  return pg_catalog.jsonb_build_object(
    'run_id', p_run_id,
    'target_project_ref', p_target_project_ref,
    'data_class', 'g2-performance',
    'active_profile_count', v_inserted_profiles,
    'work_item_count', v_inserted_items,
    'generation_rule', v_generation_rule,
    'status', 'prepared'
  );
end;
$function$;

create or replace function public.cleanup_g2_performance_fixture_v1(
  p_run_id text,
  p_target_project_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_run private.g2_performance_runs%rowtype;
  v_deleted_items integer;
  v_deleted_profiles integer;
begin
  if p_target_project_ref is distinct from 'jgcrhoabvaowxnqksvkq' then
    raise exception 'G2 performance cleanup is restricted to the independent Team OS 4.0 test project'
      using errcode = '42501';
  end if;

  select run.* into v_run
  from private.g2_performance_runs as run
  where run.run_id = p_run_id
    and run.target_project_ref = p_target_project_ref
  for update;
  if not found then
    raise exception 'G2 performance run not found' using errcode = 'P0002';
  end if;

  if v_run.status = 'cleaned' then
    return pg_catalog.jsonb_build_object(
      'run_id', p_run_id,
      'status', 'cleaned',
      'idempotent', true,
      'auth_user_ids', v_run.profile_ids,
      'auth_cleanup_required', true
    );
  end if;

  if (
    select pg_catalog.count(*)
    from public.work_items as item
    where item.company_id = v_run.company_id
      and item.source_business = 'g2_performance'
      and item.generation_rule = v_run.generation_rule
  ) <> 100000 then
    raise exception 'G2 performance work item cleanup preflight count mismatch'
      using errcode = '23514';
  end if;

  delete from public.work_items as item
  where item.company_id = v_run.company_id
    and item.source_business = 'g2_performance'
    and item.generation_rule = v_run.generation_rule;
  get diagnostics v_deleted_items = row_count;
  if v_deleted_items <> 100000 then
    raise exception 'G2 performance work item cleanup count mismatch: %', v_deleted_items
      using errcode = '23514';
  end if;

  delete from public.profiles as profile
  where profile.company_id = v_run.company_id
    and profile.id = any(v_run.profile_ids)
    and profile.display_name like 'G2 performance ' || p_run_id || ' #%';
  get diagnostics v_deleted_profiles = row_count;
  if v_deleted_profiles <> 30 then
    raise exception 'G2 performance profile cleanup count mismatch: %', v_deleted_profiles
      using errcode = '23514';
  end if;

  update private.g2_performance_runs
  set status = 'cleaned', cleaned_at = pg_catalog.now()
  where run_id = p_run_id;

  analyze public.work_items;

  return pg_catalog.jsonb_build_object(
    'run_id', p_run_id,
    'target_project_ref', p_target_project_ref,
    'status', 'cleaned',
    'idempotent', false,
    'deleted_work_items', v_deleted_items,
    'deleted_profiles', v_deleted_profiles,
    'auth_user_ids', v_run.profile_ids,
    'auth_cleanup_required', true
  );
end;
$function$;

revoke all on function public.setup_g2_performance_fixture_v1(
  text, uuid, text, date, uuid[]
) from public, anon, authenticated;
revoke all on function public.cleanup_g2_performance_fixture_v1(
  text, text
) from public, anon, authenticated;
grant execute on function public.setup_g2_performance_fixture_v1(
  text, uuid, text, date, uuid[]
) to service_role;
grant execute on function public.cleanup_g2_performance_fixture_v1(
  text, text
) to service_role;

comment on table private.g2_performance_runs is
  'G2 temporary performance fixture manifest. Cleaned rows remain as non-operating audit evidence.';
comment on function public.setup_g2_performance_fixture_v1(text, uuid, text, date, uuid[]) is
  'Creates exactly 30 active temporary profiles and 100000 run-marked work items after server-created Auth users pass app_metadata checks.';
comment on function public.cleanup_g2_performance_fixture_v1(text, text) is
  'Deletes only one run-marked G2 performance data set and returns its temporary Auth user ids for server-side Auth Admin deletion.';
