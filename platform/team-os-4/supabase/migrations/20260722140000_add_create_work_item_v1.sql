-- G2 server-only idempotent work-item creation transaction.

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
  v_work_item_id uuid;
  v_event_id bigint;
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
    generation_rule, title, priority, planned_at, due_at, next_step
  ) values (
    p_company_id, p_assignee_id, p_role_type, p_kind,
    pg_catalog.btrim(p_source_business), p_source_id,
    pg_catalog.btrim(p_generation_rule), pg_catalog.btrim(p_title),
    p_priority, p_planned_at, p_due_at, pg_catalog.btrim(p_next_step)
  )
  on conflict (company_id, source_business, source_id, generation_rule) do nothing
  returning id into v_work_item_id;

  if v_work_item_id is null then
    select w.id into strict v_work_item_id
    from public.work_items as w
    where w.company_id = p_company_id
      and w.source_business = pg_catalog.btrim(p_source_business)
      and w.source_id = p_source_id
      and w.generation_rule = pg_catalog.btrim(p_generation_rule);

    return pg_catalog.jsonb_build_object(
      'status', 'existing',
      'idempotent', true,
      'work_item_id', v_work_item_id
    );
  end if;

  insert into public.business_events (
    company_id, work_item_id, event_type, actor_user_id, idempotency_key, payload
  ) values (
    p_company_id, v_work_item_id, 'created', p_actor_user_id,
    p_idempotency_key, p_payload
  )
  returning id into v_event_id;

  return pg_catalog.jsonb_build_object(
    'status', 'created',
    'idempotent', false,
    'work_item_id', v_work_item_id,
    'event_id', v_event_id
  );
end;
$function$;

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

comment on function public.create_work_item_v1(
  uuid, uuid, text, text, text, uuid, text, text, text,
  timestamptz, timestamptz, text, uuid, text, jsonb
) is 'Service-role-only G2 work-item creation transaction with one generation key and one created event.';
