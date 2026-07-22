-- G2 server-only idempotent schedule-event creation.

create or replace function public.create_schedule_event_v1(
  p_company_id uuid,
  p_owner_id uuid,
  p_work_item_id uuid,
  p_event_type text,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location text,
  p_notes text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_schedule_event_id uuid;
begin
  if p_event_type not in ('meeting', 'visit', 'break', 'personal') then
    raise exception 'unsupported schedule event type' using errcode = '22023';
  end if;
  if p_title is null or pg_catalog.btrim(p_title) = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'schedule end must be after start' using errcode = '22023';
  end if;
  if p_idempotency_key is null or pg_catalog.btrim(p_idempotency_key) = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles as p
    where p.id = p_owner_id
      and p.company_id = p_company_id
      and p.is_active
  ) then
    raise exception 'owner is not an active company profile' using errcode = '22023';
  end if;
  if p_work_item_id is not null and not exists (
    select 1 from public.work_items as w
    where w.id = p_work_item_id and w.company_id = p_company_id
  ) then
    raise exception 'work item is not in the requested company' using errcode = '22023';
  end if;

  insert into public.schedule_events (
    company_id, owner_id, work_item_id, event_type, title,
    starts_at, ends_at, location, notes, idempotency_key
  ) values (
    p_company_id, p_owner_id, p_work_item_id, p_event_type,
    pg_catalog.btrim(p_title), p_starts_at, p_ends_at,
    p_location, p_notes, pg_catalog.btrim(p_idempotency_key)
  )
  on conflict (company_id, idempotency_key) do nothing
  returning id into v_schedule_event_id;

  if v_schedule_event_id is null then
    select s.id into strict v_schedule_event_id
    from public.schedule_events as s
    where s.company_id = p_company_id
      and s.idempotency_key = pg_catalog.btrim(p_idempotency_key);

    return pg_catalog.jsonb_build_object(
      'status', 'existing',
      'idempotent', true,
      'schedule_event_id', v_schedule_event_id
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'created',
    'idempotent', false,
    'schedule_event_id', v_schedule_event_id
  );
end;
$function$;

revoke all on function public.create_schedule_event_v1(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, text, text
) from public;
revoke all on function public.create_schedule_event_v1(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, text, text
) from anon;
revoke all on function public.create_schedule_event_v1(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, text, text
) from authenticated;
grant execute on function public.create_schedule_event_v1(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, text, text
) to service_role;

comment on function public.create_schedule_event_v1(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, text, text
) is 'Service-role-only G2 schedule creation. It may link an existing work item but never creates one.';
