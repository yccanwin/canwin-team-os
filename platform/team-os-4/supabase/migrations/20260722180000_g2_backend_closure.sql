-- G2 backend closure: authoritative queue ordering, guarded state changes,
-- idempotent reassignment, and a server-side cursor contract.

do $preflight$
declare
  v_waiting_without_reason bigint;
  v_non_waiting_with_reason bigint;
begin
  select
    pg_catalog.count(*) filter (
      where status = 'waiting'
        and (blocked_reason is null or pg_catalog.btrim(blocked_reason) = '')
    ),
    pg_catalog.count(*) filter (
      where status <> 'waiting' and blocked_reason is not null
    )
  into v_waiting_without_reason, v_non_waiting_with_reason
  from public.work_items;

  if v_waiting_without_reason <> 0 or v_non_waiting_with_reason <> 0 then
    raise exception
      'G2_WAITING_PRECHECK_FAILED waiting_without_reason=% non_waiting_with_reason=%',
      v_waiting_without_reason,
      v_non_waiting_with_reason
      using errcode = '23514',
            hint = 'Correct only the reported Team OS 4.0 work_items rows, then run a new authorized migration attempt.';
  end if;
end;
$preflight$;

alter table public.work_items
  add column sort_bucket text not null default 'normal';

alter table public.work_items
  add constraint work_items_sort_bucket check (
    sort_bucket in (
      'overdue_blocking',
      'upcoming_business_date',
      'first_contact',
      'reclaim_soon',
      'renewal',
      'normal'
    )
  ),
  add constraint work_items_waiting_reason_consistent check (
    (status = 'waiting' and blocked_reason is not null and pg_catalog.btrim(blocked_reason) <> '')
    or (status <> 'waiting' and blocked_reason is null)
  );

alter table public.work_items
  add column sort_rank smallint generated always as (
    case sort_bucket
      -- Ranks 1 and 2 are derived from the Shanghai business day at query time.
      when 'overdue_blocking' then 3
      when 'upcoming_business_date' then 3
      when 'first_contact' then 4
      when 'reclaim_soon' then 5
      when 'renewal' then 6
      else 7
    end
  ) stored,
  add column waiting_rank smallint generated always as (
    case when status = 'waiting' then 0 else 1 end
  ) stored,
  add column sort_at timestamptz generated always as (
    coalesce(due_at, planned_at, created_at)
  ) stored,
  add column priority_rank smallint generated always as (
    case priority
      when 'urgent' then 1
      when 'high' then 2
      when 'normal' then 3
      else 4
    end
  ) stored;

create index work_items_server_due_cursor_idx
  on public.work_items(
    company_id,
    assignee_id,
    due_at,
    waiting_rank,
    sort_at,
    priority_rank,
    id
  ) include (status, role_type, sort_bucket);

create index work_items_server_bucket_cursor_idx
  on public.work_items(
    company_id,
    assignee_id,
    sort_rank,
    waiting_rank,
    sort_at,
    priority_rank,
    id
  ) include (status, role_type, sort_bucket, due_at);

create or replace function public.complete_work_item_v1(
  p_company_id uuid,
  p_work_item_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item public.work_items%rowtype;
  v_event_id bigint;
  v_actor_authorized boolean;
begin
  if p_idempotency_key is null or pg_catalog.btrim(p_idempotency_key) = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  select w.* into v_item
  from public.work_items as w
  where w.id = p_work_item_id and w.company_id = p_company_id
  for update;

  if not found then
    raise exception 'work item not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.profiles as p
    join public.primary_roles as r
      on r.id = p.primary_role_id and r.company_id = p.company_id
    where p.id = p_actor_user_id
      and p.company_id = p_company_id
      and p.is_active
      and r.is_active
      and (p.id = v_item.assignee_id or r.role_key = 'admin')
  ) into v_actor_authorized;

  if not v_actor_authorized then
    raise exception 'actor is not the assignee or an active company administrator'
      using errcode = '42501';
  end if;

  if v_item.kind <> 'reminder' then
    raise exception 'business-action work items can only close inside their owning business transaction'
      using errcode = '55000';
  end if;

  if v_item.status = 'completed' then
    select e.id into v_event_id
    from public.business_events as e
    where e.company_id = p_company_id
      and e.work_item_id = p_work_item_id
      and e.event_type = 'completed'
      and e.idempotency_key = pg_catalog.btrim(p_idempotency_key);

    if v_event_id is null then
      raise exception 'work item already completed with a different idempotency key'
        using errcode = '23505';
    end if;

    return pg_catalog.jsonb_build_object(
      'status', 'completed',
      'idempotent', true,
      'work_item_id', p_work_item_id,
      'event_id', v_event_id,
      'kind', v_item.kind
    );
  end if;

  if v_item.status = 'cancelled' then
    raise exception 'cancelled work item cannot be completed' using errcode = '55000';
  end if;

  update public.work_items
  set status = 'completed',
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now(),
      blocked_reason = null
  where id = p_work_item_id and company_id = p_company_id;

  insert into public.business_events (
    company_id,
    work_item_id,
    event_type,
    actor_user_id,
    idempotency_key,
    payload
  ) values (
    p_company_id,
    p_work_item_id,
    'completed',
    p_actor_user_id,
    pg_catalog.btrim(p_idempotency_key),
    p_payload
  )
  returning id into v_event_id;

  return pg_catalog.jsonb_build_object(
    'status', 'completed',
    'idempotent', false,
    'work_item_id', p_work_item_id,
    'event_id', v_event_id,
    'kind', v_item.kind
  );
end;
$function$;

comment on function public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb) is
  'Service-role-only reminder completion. Business-action items are rejected and must close in their owning business transaction.';

create or replace function public.transition_work_item_v1(
  p_company_id uuid,
  p_work_item_id uuid,
  p_target_status text,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item public.work_items%rowtype;
  v_event_type text;
  v_event_id bigint;
  v_blocked_reason text;
  v_actor_authorized boolean;
begin
  if p_target_status = 'completed' then
    raise exception 'completed transitions require the owning completion transaction'
      using errcode = '55000';
  end if;
  if p_target_status not in ('in_progress', 'waiting', 'cancelled') then
    raise exception 'unsupported target status' using errcode = '22023';
  end if;
  if p_idempotency_key is null or pg_catalog.btrim(p_idempotency_key) = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  v_blocked_reason := nullif(pg_catalog.btrim(p_payload ->> 'blocked_reason'), '');
  if p_target_status = 'waiting' and v_blocked_reason is null then
    raise exception 'payload.blocked_reason is required when entering waiting'
      using errcode = '22023';
  end if;

  select w.* into v_item
  from public.work_items as w
  where w.id = p_work_item_id and w.company_id = p_company_id
  for update;

  if not found then
    raise exception 'work item not found' using errcode = 'P0002';
  end if;

  select exists (
    select 1
    from public.profiles as p
    join public.primary_roles as r
      on r.id = p.primary_role_id and r.company_id = p.company_id
    where p.id = p_actor_user_id
      and p.company_id = p_company_id
      and p.is_active
      and r.is_active
      and (p.id = v_item.assignee_id or r.role_key = 'admin')
  ) into v_actor_authorized;

  if not v_actor_authorized then
    raise exception 'actor is not the assignee or an active company administrator'
      using errcode = '42501';
  end if;

  v_event_type := case p_target_status
    when 'in_progress' then 'started'
    when 'waiting' then 'waiting'
    when 'cancelled' then 'cancelled'
  end;

  select e.id into v_event_id
  from public.business_events as e
  where e.company_id = p_company_id
    and e.work_item_id = p_work_item_id
    and e.event_type = v_event_type
    and e.idempotency_key = pg_catalog.btrim(p_idempotency_key);

  if v_event_id is not null then
    return pg_catalog.jsonb_build_object(
      'status', p_target_status,
      'idempotent', true,
      'work_item_id', p_work_item_id,
      'event_id', v_event_id
    );
  end if;

  if v_item.status in ('completed', 'cancelled') then
    raise exception 'terminal work item cannot transition' using errcode = '55000';
  end if;

  if not (
    (v_item.status = 'pending' and p_target_status in ('in_progress', 'cancelled'))
    or (v_item.status = 'in_progress' and p_target_status in ('waiting', 'cancelled'))
    or (v_item.status = 'waiting' and p_target_status in ('in_progress', 'cancelled'))
  ) then
    raise exception 'invalid work item transition: % -> %', v_item.status, p_target_status
      using errcode = '55000';
  end if;

  update public.work_items
  set status = p_target_status,
      completed_at = null,
      updated_at = pg_catalog.now(),
      blocked_reason = case when p_target_status = 'waiting' then v_blocked_reason else null end
  where id = p_work_item_id and company_id = p_company_id;

  insert into public.business_events (
    company_id, work_item_id, event_type, actor_user_id, idempotency_key, payload
  ) values (
    p_company_id, p_work_item_id, v_event_type, p_actor_user_id,
    pg_catalog.btrim(p_idempotency_key),
    case
      when p_target_status = 'waiting'
        then p_payload || pg_catalog.jsonb_build_object('blocked_reason', v_blocked_reason)
      else p_payload - 'blocked_reason'
    end
  )
  returning id into v_event_id;

  return pg_catalog.jsonb_build_object(
    'status', p_target_status,
    'idempotent', false,
    'work_item_id', p_work_item_id,
    'event_id', v_event_id,
    'blocked_reason', case when p_target_status = 'waiting' then v_blocked_reason else null end
  );
end;
$function$;

comment on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb) is
  'Service-role-only G2 state transition. Waiting requires payload.blocked_reason; leaving waiting clears it.';

create or replace function public.create_work_item_v1(
  p_company_id uuid,
  p_assignee_id uuid,
  p_role_type text,
  p_kind text,
  p_source_business text,
  p_source_id uuid,
  p_generation_rule text,
  p_title text,
  p_priority text,
  p_planned_at timestamptz,
  p_due_at timestamptz,
  p_next_step text,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item public.work_items%rowtype;
  v_work_item_id uuid;
  v_event_id bigint;
  v_sort_bucket text;
  v_changed boolean;
begin
  if p_role_type not in ('sales', 'implementation', 'operations', 'finance', 'admin') then
    raise exception 'unsupported role type' using errcode = '22023';
  end if;
  if p_kind not in ('reminder', 'business_action') then
    raise exception 'unsupported work item kind' using errcode = '22023';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'unsupported priority' using errcode = '22023';
  end if;
  if p_source_business is null or pg_catalog.btrim(p_source_business) = '' then
    raise exception 'source business is required' using errcode = '22023';
  end if;
  if p_generation_rule is null or pg_catalog.btrim(p_generation_rule) = '' then
    raise exception 'generation rule is required' using errcode = '22023';
  end if;
  if p_title is null or pg_catalog.btrim(p_title) = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;
  if p_next_step is null or pg_catalog.btrim(p_next_step) = '' then
    raise exception 'next step is required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or pg_catalog.btrim(p_idempotency_key) = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;

  v_sort_bucket := coalesce(
    nullif(pg_catalog.btrim(p_payload ->> 'sort_bucket'), ''),
    'normal'
  );
  if v_sort_bucket not in (
    'overdue_blocking', 'upcoming_business_date',
    'first_contact', 'reclaim_soon', 'renewal', 'normal'
  ) then
    raise exception
      'unsupported payload.sort_bucket; due_today is derived from due_at and the Asia/Shanghai business date'
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.profiles as p
    join public.primary_roles as r
      on r.id = p.primary_role_id and r.company_id = p.company_id
    where p.id = p_assignee_id
      and p.company_id = p_company_id
      and p.is_active
      and r.is_active
      and r.role_key = p_role_type
  ) then
    raise exception 'assignee is not active in the requested company and role'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles as p
    where p.id = p_actor_user_id
      and p.company_id = p_company_id
      and p.is_active
  ) then
    raise exception 'actor is not an active company profile' using errcode = '42501';
  end if;

  insert into public.work_items (
    company_id, assignee_id, role_type, kind, source_business, source_id,
    generation_rule, title, priority, planned_at, due_at, next_step, sort_bucket
  ) values (
    p_company_id, p_assignee_id, p_role_type, p_kind,
    pg_catalog.btrim(p_source_business), p_source_id,
    pg_catalog.btrim(p_generation_rule), pg_catalog.btrim(p_title),
    p_priority, p_planned_at, p_due_at, pg_catalog.btrim(p_next_step), v_sort_bucket
  )
  on conflict (company_id, source_business, source_id, generation_rule) do nothing
  returning id into v_work_item_id;

  if v_work_item_id is not null then
    insert into public.business_events (
      company_id, work_item_id, event_type, actor_user_id, idempotency_key, payload
    ) values (
      p_company_id, v_work_item_id, 'created', p_actor_user_id,
      'g2:create:' || pg_catalog.btrim(p_idempotency_key), p_payload
    )
    returning id into v_event_id;

    return pg_catalog.jsonb_build_object(
      'status', 'created',
      'idempotent', false,
      'work_item_id', v_work_item_id,
      'event_id', v_event_id
    );
  end if;

  select w.* into strict v_item
  from public.work_items as w
  where w.company_id = p_company_id
    and w.source_business = pg_catalog.btrim(p_source_business)
    and w.source_id = p_source_id
    and w.generation_rule = pg_catalog.btrim(p_generation_rule)
  for update;

  select e.id into v_event_id
  from public.business_events as e
  where e.company_id = p_company_id
    and e.work_item_id = v_item.id
    and e.event_type in ('created', 'assigned')
    and e.idempotency_key in (
      'g2:create:' || pg_catalog.btrim(p_idempotency_key),
      'g2:assign:' || pg_catalog.btrim(p_idempotency_key)
    );

  if v_event_id is not null then
    return pg_catalog.jsonb_build_object(
      'status', 'existing',
      'idempotent', true,
      'work_item_id', v_item.id,
      'event_id', v_event_id
    );
  end if;

  if v_item.kind <> p_kind then
    raise exception 'generation identity cannot change work item kind' using errcode = '23514';
  end if;

  if v_item.status in ('completed', 'cancelled') then
    return pg_catalog.jsonb_build_object(
      'status', 'existing',
      'idempotent', true,
      'work_item_id', v_item.id,
      'terminal', true
    );
  end if;

  v_changed :=
    v_item.assignee_id is distinct from p_assignee_id
    or v_item.role_type is distinct from p_role_type
    or v_item.title is distinct from pg_catalog.btrim(p_title)
    or v_item.priority is distinct from p_priority
    or v_item.planned_at is distinct from p_planned_at
    or v_item.due_at is distinct from p_due_at
    or v_item.next_step is distinct from pg_catalog.btrim(p_next_step)
    or v_item.sort_bucket is distinct from v_sort_bucket;

  if not v_changed then
    return pg_catalog.jsonb_build_object(
      'status', 'existing',
      'idempotent', true,
      'work_item_id', v_item.id
    );
  end if;

  update public.work_items
  set assignee_id = p_assignee_id,
      role_type = p_role_type,
      title = pg_catalog.btrim(p_title),
      priority = p_priority,
      planned_at = p_planned_at,
      due_at = p_due_at,
      next_step = pg_catalog.btrim(p_next_step),
      sort_bucket = v_sort_bucket,
      updated_at = pg_catalog.now()
  where id = v_item.id and company_id = p_company_id;

  insert into public.business_events (
    company_id, work_item_id, event_type, actor_user_id, idempotency_key, payload
  ) values (
    p_company_id,
    v_item.id,
    'assigned',
    p_actor_user_id,
    'g2:assign:' || pg_catalog.btrim(p_idempotency_key),
    p_payload || pg_catalog.jsonb_build_object(
      'previous_assignee_id', v_item.assignee_id,
      'assignee_id', p_assignee_id
    )
  )
  returning id into v_event_id;

  return pg_catalog.jsonb_build_object(
    'status', 'reassigned',
    'idempotent', false,
    'work_item_id', v_item.id,
    'event_id', v_event_id
  );
end;
$function$;

comment on function public.create_work_item_v1(
  uuid, uuid, text, text, text, uuid, text, text, text,
  timestamptz, timestamptz, text, uuid, text, jsonb
) is
  'Service-role-only G2 create-or-reassign transaction. One generation identity keeps one row; a new idempotency key may reassign the active row.';

revoke all on function public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb)
  from public;
revoke all on function public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb)
  from anon;
revoke all on function public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb)
  from authenticated;
grant execute on function public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb)
  to service_role;

revoke all on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb)
  from public;
revoke all on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb)
  from anon;
revoke all on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb)
  from authenticated;
grant execute on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb)
  to service_role;

revoke all on function public.create_work_item_v1(
  uuid, uuid, text, text, text, uuid, text, text, text,
  timestamptz, timestamptz, text, uuid, text, jsonb
) from public;
revoke all on function public.create_work_item_v1(
  uuid, uuid, text, text, text, uuid, text, text, text,
  timestamptz, timestamptz, text, uuid, text, jsonb
) from anon;
revoke all on function public.create_work_item_v1(
  uuid, uuid, text, text, text, uuid, text, text, text,
  timestamptz, timestamptz, text, uuid, text, jsonb
) from authenticated;
grant execute on function public.create_work_item_v1(
  uuid, uuid, text, text, text, uuid, text, text, text,
  timestamptz, timestamptz, text, uuid, text, jsonb
) to service_role;

create function public.list_work_items_v1(
  p_company_id uuid,
  p_assignee_id uuid,
  p_statuses text[] default null,
  p_role_types text[] default null,
  p_search text default null,
  p_limit integer default 50,
  p_cursor_rank integer default null,
  p_cursor_waiting_rank integer default null,
  p_cursor_sort_at timestamptz default null,
  p_cursor_priority_rank integer default null,
  p_cursor_id uuid default null,
  p_cursor_business_date date default null,
  p_business_date date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_items jsonb;
  v_has_more boolean;
  v_next_cursor jsonb;
  v_today_shanghai date;
  v_business_date date;
  v_day_start timestamptz;
  v_next_day_start timestamptz;
begin
  if p_company_id is null or p_assignee_id is null then
    raise exception 'company and assignee are required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'limit must be between 1 and 100' using errcode = '22023';
  end if;
  v_today_shanghai := (
    pg_catalog.timezone('Asia/Shanghai', pg_catalog.statement_timestamp())
  )::date;
  v_business_date := coalesce(p_business_date, v_today_shanghai);
  if v_business_date <> v_today_shanghai then
    raise exception 'business date must equal the current Asia/Shanghai business date'
      using errcode = '22023';
  end if;
  v_day_start := pg_catalog.timezone('Asia/Shanghai', v_business_date::timestamp);
  v_next_day_start := pg_catalog.timezone(
    'Asia/Shanghai',
    (v_business_date + 1)::timestamp
  );
  if pg_catalog.num_nonnulls(
    p_cursor_rank,
    p_cursor_waiting_rank,
    p_cursor_sort_at,
    p_cursor_priority_rank,
    p_cursor_id,
    p_cursor_business_date
  ) not in (0, 6) then
    raise exception 'cursor fields must be supplied together' using errcode = '22023';
  end if;
  if p_cursor_business_date is not null
     and p_cursor_business_date <> v_today_shanghai then
    raise exception 'cursor business date has expired in Asia/Shanghai; restart pagination'
      using errcode = '22023';
  end if;
  if p_statuses is not null and exists (
    select 1 from pg_catalog.unnest(p_statuses) as s(value)
    where s.value not in ('pending', 'in_progress', 'waiting', 'completed', 'cancelled')
  ) then
    raise exception 'unsupported status filter' using errcode = '22023';
  end if;
  if p_role_types is not null and exists (
    select 1 from pg_catalog.unnest(p_role_types) as r(value)
    where r.value not in ('sales', 'implementation', 'operations', 'finance', 'admin')
  ) then
    raise exception 'unsupported role filter' using errcode = '22023';
  end if;

  with candidates as not materialized (
    select
      w.*
    from public.work_items as w
    where w.company_id = p_company_id
      and w.assignee_id = p_assignee_id
      and (p_statuses is null or w.status = any(p_statuses))
      and (p_role_types is null or w.role_type = any(p_role_types))
      and (
        p_search is null
        or pg_catalog.btrim(p_search) = ''
        or pg_catalog.concat_ws(' ', w.title, w.next_step, w.source_business)
          ilike '%' || pg_catalog.btrim(p_search) || '%'
      )
  ),
  ranked as (
    select
      c.*,
      1::smallint as effective_sort_rank,
      'overdue_blocking'::text as effective_sort_bucket
    from candidates as c
    where c.sort_bucket = 'overdue_blocking'
      and c.due_at is not null
      and c.due_at < v_day_start

    union all

    select
      c.*,
      2::smallint as effective_sort_rank,
      'due_today'::text as effective_sort_bucket
    from candidates as c
    where c.due_at is not null
      and c.due_at >= v_day_start
      and c.due_at < v_next_day_start

    union all

    select
      c.*,
      c.sort_rank as effective_sort_rank,
      case
        when c.sort_bucket = 'overdue_blocking' then 'upcoming_business_date'
        else c.sort_bucket
      end as effective_sort_bucket
    from candidates as c
    where not (
      c.sort_bucket = 'overdue_blocking'
      and c.due_at is not null
      and c.due_at < v_day_start
    )
      and not (
        c.due_at is not null
        and c.due_at >= v_day_start
        and c.due_at < v_next_day_start
      )
  ),
  after_cursor as (
    select r.*
    from ranked as r
    where p_cursor_rank is null
      or (
        r.effective_sort_rank,
        r.waiting_rank,
        r.sort_at,
        r.priority_rank,
        r.id
      ) > (
        p_cursor_rank::smallint,
        p_cursor_waiting_rank::smallint,
        p_cursor_sort_at,
        p_cursor_priority_rank::smallint,
        p_cursor_id
      )
  ),
  page_rows as (
    select
      a.*,
      pg_catalog.row_number() over (
        order by
          a.effective_sort_rank,
          a.waiting_rank,
          a.sort_at,
          a.priority_rank,
          a.id
      ) as page_row_number
    from after_cursor as a
    order by
      a.effective_sort_rank,
      a.waiting_rank,
      a.sort_at,
      a.priority_rank,
      a.id
    limit p_limit + 1
  ),
  returned as (
    select p.* from page_rows as p where p.page_row_number <= p_limit
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', r.id,
          'company_id', r.company_id,
          'source_business', r.source_business,
          'source_id', r.source_id,
          'role_type', r.role_type,
          'assignee_id', r.assignee_id,
          'kind', r.kind,
          'title', r.title,
          'priority', r.priority,
          'status', r.status,
          'planned_at', r.planned_at,
          'due_at', r.due_at,
          'next_step', r.next_step,
          'blocked_reason', r.blocked_reason,
          'generation_rule', r.generation_rule,
          'completed_at', r.completed_at,
          'sort_bucket', r.effective_sort_bucket,
          'sort_rank', r.effective_sort_rank,
          'waiting_rank', r.waiting_rank,
          'sort_at', r.sort_at,
          'priority_rank', r.priority_rank
        )
        order by
          r.effective_sort_rank,
          r.waiting_rank,
          r.sort_at,
          r.priority_rank,
          r.id
      ),
      '[]'::jsonb
    ),
    (select pg_catalog.count(*) > p_limit from page_rows),
    (
      select pg_catalog.jsonb_build_object(
        'sort_rank', tail.effective_sort_rank,
        'waiting_rank', tail.waiting_rank,
        'sort_at', tail.sort_at,
        'priority_rank', tail.priority_rank,
        'id', tail.id,
        'business_date', v_business_date
      )
      from returned as tail
      order by
        tail.effective_sort_rank desc,
        tail.waiting_rank desc,
        tail.sort_at desc,
        tail.priority_rank desc,
        tail.id desc
      limit 1
    )
  into v_items, v_has_more, v_next_cursor
  from returned as r;

  return pg_catalog.jsonb_build_object(
    'items', v_items,
    'next_cursor', case when v_has_more then v_next_cursor else null end
  );
end;
$function$;

revoke all on function public.list_work_items_v1(
  uuid, uuid, text[], text[], text, integer,
  integer, integer, timestamptz, integer, uuid, date, date
) from public;
revoke all on function public.list_work_items_v1(
  uuid, uuid, text[], text[], text, integer,
  integer, integer, timestamptz, integer, uuid, date, date
) from anon;
grant execute on function public.list_work_items_v1(
  uuid, uuid, text[], text[], text, integer,
  integer, integer, timestamptz, integer, uuid, date, date
) to authenticated, service_role;

comment on function public.list_work_items_v1(
  uuid, uuid, text[], text[], text, integer,
  integer, integer, timestamptz, integer, uuid, date, date
) is
  'RLS-respecting G2 list API. Seven business buckets use the current Asia/Shanghai date; waiting sorts first inside its bucket; the keyset cursor freezes that business date.';
