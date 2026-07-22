-- G2 server-only idempotent work-item completion transaction.

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
begin
  if p_idempotency_key is null or pg_catalog.btrim(p_idempotency_key) = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles as p
    where p.id = p_actor_user_id
      and p.company_id = p_company_id
      and p.is_active
  ) then
    raise exception 'actor is not an active company profile' using errcode = '42501';
  end if;

  select w.* into v_item
  from public.work_items as w
  where w.id = p_work_item_id and w.company_id = p_company_id
  for update;

  if not found then
    raise exception 'work item not found' using errcode = 'P0002';
  end if;

  if v_item.status = 'completed' then
    select e.id into v_event_id
    from public.business_events as e
    where e.company_id = p_company_id
      and e.work_item_id = p_work_item_id
      and e.event_type = 'completed'
      and e.idempotency_key = p_idempotency_key;

    if v_event_id is null then
      raise exception 'work item already completed with a different idempotency key'
        using errcode = '23505';
    end if;

    return pg_catalog.jsonb_build_object(
      'status', 'completed',
      'idempotent', true,
      'work_item_id', p_work_item_id,
      'event_id', v_event_id
    );
  end if;

  if v_item.status = 'cancelled' then
    raise exception 'cancelled work item cannot be completed' using errcode = '55000';
  end if;

  -- Both reminder and business_action items complete only through this
  -- transaction; clients retain no direct table write privilege.
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
    p_idempotency_key,
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

revoke all on function public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb)
  from public;
revoke all on function public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb)
  from anon;
revoke all on function public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb)
  from authenticated;
grant execute on function public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb)
  to service_role;

comment on function public.complete_work_item_v1(uuid, uuid, text, uuid, jsonb) is
  'Service-role-only G2 completion transaction. Locks one work item, completes it once, and emits one idempotent business event.';
