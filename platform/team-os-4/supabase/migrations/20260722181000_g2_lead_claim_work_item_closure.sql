-- G2 proof of a real business-action closure. Claiming a G3 lead and closing
-- its generated claim task happen in the same database transaction.

create or replace function public.claim_lead_v1(
  p_company_id uuid,
  p_claimant_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lead_id uuid;
  v_existing_claim boolean := false;
  v_claimed_owner_id uuid;
  v_item public.work_items%rowtype;
  v_event_id bigint;
  v_work_item_closed boolean := false;
  v_work_item_id uuid;
  v_event_key text;
begin
  if p_idempotency_key is null or pg_catalog.btrim(p_idempotency_key) = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles as p
    join public.primary_roles as r
      on r.id = p.primary_role_id and r.company_id = p.company_id
    where p.id = p_claimant_user_id
      and p.company_id = p_company_id
      and p.is_active
      and r.is_active
      and r.role_key = 'sales'
  ) then
    raise exception 'claimant is not an active sales profile' using errcode = '42501';
  end if;

  select l.id, l.owner_id
  into v_lead_id, v_claimed_owner_id
  from public.leads as l
  where l.company_id = p_company_id
    and l.claim_idempotency_key = pg_catalog.btrim(p_idempotency_key)
  for update;

  if v_lead_id is not null then
    if v_claimed_owner_id is distinct from p_claimant_user_id then
      raise exception 'idempotency key belongs to another claimant' using errcode = '23505';
    end if;
    v_existing_claim := true;
  else
    select l.id into v_lead_id
    from public.leads as l
    where l.company_id = p_company_id
      and l.pool_status = 'public_pool'
      and exists (
        select 1
        from public.profile_regions as pr
        where pr.company_id = l.company_id
          and pr.profile_id = p_claimant_user_id
          and pr.region = l.region
          and pr.is_active
      )
      and exists (
        select 1
        from public.work_items as candidate_task
        where candidate_task.company_id = l.company_id
          and candidate_task.source_business = 'lead'
          and candidate_task.source_id = l.id
          and candidate_task.generation_rule = 'claim_lead_v1'
          and candidate_task.kind = 'business_action'
          and candidate_task.role_type = 'sales'
          and candidate_task.assignee_id = p_claimant_user_id
          and candidate_task.status in ('pending', 'in_progress', 'waiting')
      )
    order by l.cleanup_due_at asc nulls last, l.created_at asc, l.id asc
    for update skip locked
    limit 1;

    if v_lead_id is null then
      raise exception 'no public-pool lead is available' using errcode = 'P0002';
    end if;

    update public.leads
    set owner_id = p_claimant_user_id,
        pool_status = 'claimed',
        cleanup_due_at = null,
        claim_idempotency_key = pg_catalog.btrim(p_idempotency_key),
        updated_at = pg_catalog.now()
    where id = v_lead_id and company_id = p_company_id;
  end if;

  select w.* into v_item
  from public.work_items as w
  where w.company_id = p_company_id
    and w.source_business = 'lead'
    and w.source_id = v_lead_id
    and w.generation_rule = 'claim_lead_v1'
  for update;

  if not found then
    raise exception 'lead claim requires its generated business-action work item'
      using errcode = 'P0002';
  end if;

  v_work_item_id := v_item.id;
    if v_item.kind <> 'business_action' then
      raise exception 'lead claim work item must be a business action' using errcode = '23514';
    end if;
    if v_item.assignee_id <> p_claimant_user_id then
      raise exception 'lead claim work item is assigned to another profile' using errcode = '42501';
    end if;
    if v_item.status = 'cancelled' then
      raise exception 'cancelled lead claim work item cannot close' using errcode = '55000';
    end if;

    v_event_key := 'g2:claim_lead:' || pg_catalog.btrim(p_idempotency_key);
    if v_item.status = 'completed' then
      select e.id into v_event_id
      from public.business_events as e
      where e.company_id = p_company_id
        and e.work_item_id = v_item.id
        and e.event_type = 'completed'
        and e.idempotency_key = v_event_key;

      if v_event_id is null then
        raise exception 'lead claim work item was completed by another transaction'
          using errcode = '23505';
      end if;
      v_work_item_closed := true;
    else
      update public.work_items
      set status = 'completed',
          completed_at = pg_catalog.now(),
          blocked_reason = null,
          updated_at = pg_catalog.now()
      where id = v_item.id and company_id = p_company_id;

      insert into public.business_events (
        company_id,
        work_item_id,
        event_type,
        actor_user_id,
        idempotency_key,
        payload
      ) values (
        p_company_id,
        v_item.id,
        'completed',
        p_claimant_user_id,
        v_event_key,
        pg_catalog.jsonb_build_object(
          'business_transaction', 'claim_lead_v1',
          'lead_id', v_lead_id,
          'claim_idempotency_key', pg_catalog.btrim(p_idempotency_key)
        )
      )
      returning id into v_event_id;

      v_work_item_closed := true;
    end if;

  return pg_catalog.jsonb_build_object(
    'status', 'claimed',
    'idempotent', v_existing_claim,
    'lead_id', v_lead_id,
    'work_item_id', v_work_item_id,
    'work_item_closed', v_work_item_closed,
    'work_item_event_id', v_event_id
  );
end;
$function$;

revoke all on function public.claim_lead_v1(uuid, uuid, text) from public;
revoke all on function public.claim_lead_v1(uuid, uuid, text) from anon;
revoke all on function public.claim_lead_v1(uuid, uuid, text) from authenticated;
grant execute on function public.claim_lead_v1(uuid, uuid, text) to service_role;

comment on function public.claim_lead_v1(uuid, uuid, text) is
  'Service-role-only lead claim. A matching lead/claim_lead_v1 business-action work item closes atomically and idempotently with the lead ownership change.';
