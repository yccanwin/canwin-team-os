-- G2 server-only non-completion work-item state transitions.

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
begin
  if p_target_status = 'completed' then
    raise exception 'completed transitions require complete_work_item_v1'
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
    and e.idempotency_key = p_idempotency_key;

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
      blocked_reason = case when p_target_status = 'waiting' then blocked_reason else null end
  where id = p_work_item_id and company_id = p_company_id;

  insert into public.business_events (
    company_id, work_item_id, event_type, actor_user_id, idempotency_key, payload
  ) values (
    p_company_id, p_work_item_id, v_event_type, p_actor_user_id,
    p_idempotency_key, p_payload
  )
  returning id into v_event_id;

  return pg_catalog.jsonb_build_object(
    'status', p_target_status,
    'idempotent', false,
    'work_item_id', p_work_item_id,
    'event_id', v_event_id
  );
end;
$function$;

revoke all on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb)
  from public;
revoke all on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb)
  from anon;
revoke all on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb)
  from authenticated;
grant execute on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb)
  to service_role;

comment on function public.transition_work_item_v1(uuid, uuid, text, text, uuid, jsonb) is
  'Service-role-only G2 non-completion transition transaction. Completion must use complete_work_item_v1.';
