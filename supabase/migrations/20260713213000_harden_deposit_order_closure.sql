-- C3: finance-only, idempotent deposit confirmation and immutable quote/order closure.
-- No inventory table is read or written here; inventory starts only after a formal order exists.

alter table public.deal_orders
  add column if not exists order_number text;

update public.deal_orders
set order_number='CW-'||to_char(created_at at time zone 'Asia/Shanghai','YYYYMMDD')||'-'||upper(substr(replace(id::text,'-',''),1,8))
where order_number is null;

alter table public.deal_orders
  alter column order_number set not null;
create unique index if not exists deal_orders_team_order_number_key
  on public.deal_orders(team_id,order_number);

create or replace function public.confirm_deal_deposit(
  p_quote_id uuid,
  p_amount numeric,
  p_external_ref text,
  p_idempotency_key uuid,
  p_recipient_type text default 'company'
) returns public.deal_orders
language plpgsql security definer set search_path='' as $$
declare
  v_quote public.deal_quotes;
  v_profile public.profiles;
  v_order public.deal_orders;
  v_payment public.deal_payments;
  v_key_payment public.deal_payments;
begin
  if p_amount is null or p_amount<=0
     or p_recipient_type not in('company','sales')
     or nullif(trim(p_external_ref),'') is null
     or p_idempotency_key is null then
    raise exception 'VALID_DEPOSIT_REQUIRED' using errcode='22023';
  end if;

  select pr.* into v_profile
  from public.profiles as pr
  where pr.id=auth.uid() and pr.status='active';

  select dq.* into v_quote
  from public.deal_quotes as dq
  where dq.id=p_quote_id
  for update;

  if v_quote.id is null or v_profile.id is null or v_quote.team_id<>v_profile.team_id then
    raise exception 'QUOTE_NOT_FOUND' using errcode='P0002';
  end if;
  if not public.is_feature_enabled(v_quote.team_id,'sales_os_v3')
     or not public.has_permission(v_quote.team_id,'finance.manage') then
    raise exception 'FINANCE_FORBIDDEN' using errcode='42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_quote.team_id||':'||trim(p_external_ref),0)
  );

  select dp.* into v_key_payment
  from public.deal_payments as dp
  where dp.team_id=v_quote.team_id and dp.idempotency_key=p_idempotency_key;

  select orders.* into v_order
  from public.deal_orders as orders
  where orders.team_id=v_quote.team_id and orders.quote_id=v_quote.id;

  if v_key_payment.id is not null then
    if v_order.id is null
       or v_key_payment.order_id is distinct from v_order.id
       or v_key_payment.payment_type<>'deposit'
       or v_key_payment.amount is distinct from p_amount
       or v_key_payment.recipient_type is distinct from p_recipient_type
       or v_key_payment.external_ref is distinct from trim(p_external_ref) then
      raise exception 'IDEMPOTENCY_KEY_CONFLICT' using errcode='23505';
    end if;
    return v_order;
  end if;

  if v_order.id is not null then
    select dp.* into v_payment
    from public.deal_payments as dp
    where dp.team_id=v_order.team_id and dp.order_id=v_order.id and dp.payment_type='deposit'
    order by dp.confirmed_at
    limit 1;
    if v_payment.id is not null
       and v_payment.amount is not distinct from p_amount
       and v_payment.recipient_type is not distinct from p_recipient_type
       and v_payment.external_ref is not distinct from trim(p_external_ref) then
      return v_order;
    end if;
    raise exception 'DEPOSIT_ALREADY_CONFIRMED' using errcode='55000';
  end if;

  if exists(
    select 1 from public.deal_payments as dp
    where dp.team_id=v_quote.team_id and dp.external_ref=trim(p_external_ref)
  ) then
    raise exception 'PAYMENT_REFERENCE_ALREADY_USED' using errcode='23505';
  end if;
  if current_date>v_quote.valid_until then
    raise exception 'QUOTE_EXPIRED' using errcode='23514';
  end if;
  if p_amount>v_quote.customer_total then
    raise exception 'DEPOSIT_EXCEEDS_QUOTE_TOTAL' using errcode='23514';
  end if;
  if v_quote.status not in('submitted','approved') then
    raise exception 'QUOTE_NOT_CONFIRMABLE' using errcode='55000';
  end if;

  update public.deal_quotes as dq
  set status='frozen',frozen_at=now(),updated_at=now()
  where dq.id=v_quote.id;

  insert into public.deal_orders(team_id,quote_id,opportunity_id,customer_total,internal_due,order_number)
  values(
    v_quote.team_id,v_quote.id,v_quote.opportunity_id,v_quote.customer_total,v_quote.internal_total,
    'CW-'||to_char(now() at time zone 'Asia/Shanghai','YYYYMMDD')||'-'||upper(substr(replace(pg_catalog.gen_random_uuid()::text,'-',''),1,8))
  ) returning * into v_order;

  insert into public.deal_payments(
    team_id,order_id,payment_type,amount,recipient_type,external_ref,idempotency_key,confirmed_by
  ) values(
    v_quote.team_id,v_order.id,'deposit',p_amount,p_recipient_type,trim(p_external_ref),p_idempotency_key,v_profile.id
  ) returning * into v_payment;

  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(
    v_quote.team_id,v_profile.id,'deal.deposit_confirmed','deal_order',v_order.id,
    jsonb_build_object('quote_status',v_quote.status),
    jsonb_build_object('quote_status','frozen','order_number',v_order.order_number,'payment_id',v_payment.id)
  );

  return v_order;
end$$;

revoke all on function public.confirm_deal_deposit(uuid,numeric,text,uuid,text) from public,anon;
grant execute on function public.confirm_deal_deposit(uuid,numeric,text,uuid,text) to authenticated;
notify pgrst,'reload schema';
