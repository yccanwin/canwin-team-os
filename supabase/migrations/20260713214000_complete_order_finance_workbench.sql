-- C4: customer receipts, sales settlement, procurement payments and final sales margin.
-- Append-only ledgers remain authoritative. No inventory table is read or written.

alter table public.deal_orders
  add column if not exists final_sales_margin numeric(14,2),
  add column if not exists margin_finalized_at timestamptz,
  add column if not exists margin_finalized_by uuid references public.profiles(id);

create or replace function public.confirm_order_customer_payment(
  p_order_id uuid,p_amount numeric,p_recipient_type text,p_external_ref text,p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles;v_order public.deal_orders;v_existing public.deal_payments;
  v_payment public.deal_payments;v_paid numeric;v_reversed numeric;
begin
  if p_amount is null or p_amount<=0 or p_recipient_type not in('company','sales')
    or nullif(trim(p_external_ref),'')is null or p_idempotency_key is null then
    raise exception'VALID_CUSTOMER_PAYMENT_REQUIRED'using errcode='22023';
  end if;
  select p.* into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';
  select o.* into v_order from public.deal_orders o where o.id=p_order_id for update;
  if v_profile.id is null or v_order.id is null or v_profile.team_id<>v_order.team_id then raise exception'ORDER_NOT_FOUND'using errcode='P0002';end if;
  if not public.is_feature_enabled(v_order.team_id,'sales_os_v3')or not public.has_permission(v_order.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.team_id||':'||trim(p_external_ref),0));
  select p.* into v_existing from public.deal_payments p where p.team_id=v_order.team_id and p.idempotency_key=p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.order_id is distinct from v_order.id or v_existing.amount is distinct from p_amount
      or v_existing.recipient_type is distinct from p_recipient_type or v_existing.external_ref is distinct from trim(p_external_ref)
      or v_existing.payment_type not in('balance','full')then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;
    return v_existing.id;
  end if;
  if exists(select 1 from public.deal_payments p where p.team_id=v_order.team_id and p.external_ref=trim(p_external_ref))then raise exception'PAYMENT_REFERENCE_ALREADY_USED'using errcode='23505';end if;
  select coalesce(sum(p.amount),0)into v_paid from public.deal_payments p where p.team_id=v_order.team_id and p.order_id=v_order.id;
  select coalesce(sum(r.amount),0)into v_reversed from public.deal_payment_reversals r join public.deal_payments p on p.id=r.payment_id and p.team_id=r.team_id where p.team_id=v_order.team_id and p.order_id=v_order.id;
  if v_paid-v_reversed+p_amount>v_order.customer_total then raise exception'CUSTOMER_PAYMENT_EXCEEDS_TOTAL'using errcode='23514';end if;
  insert into public.deal_payments(team_id,order_id,payment_type,amount,recipient_type,external_ref,idempotency_key,confirmed_by)
  values(v_order.team_id,v_order.id,case when v_paid-v_reversed=0 and p_amount=v_order.customer_total then'full'else'balance'end,p_amount,p_recipient_type,trim(p_external_ref),p_idempotency_key,v_profile.id)returning*into v_payment;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(v_order.team_id,v_profile.id,'deal.customer_payment_confirmed','deal_order',v_order.id,jsonb_build_object('net_customer_paid',v_paid-v_reversed),jsonb_build_object('net_customer_paid',v_paid-v_reversed+p_amount,'payment_id',v_payment.id));
  return v_payment.id;
end$$;

create or replace function public.confirm_deal_internal_payment(p_order_id uuid,p_amount numeric,p_external_ref text,p_idempotency_key uuid,p_method text default'cash_remitted')
returns public.deal_orders language plpgsql security definer set search_path = '' as $$
declare v_order public.deal_orders;v_profile public.profiles;v_existing public.deal_internal_settlements;v_settlement public.deal_internal_settlements;v_paid numeric;
begin
 if p_amount is null or p_amount<=0 or p_method not in('cash_remitted','withheld_from_company_receipt')or nullif(trim(p_external_ref),'')is null or p_idempotency_key is null then raise exception'VALID_INTERNAL_SETTLEMENT_REQUIRED'using errcode='22023';end if;
 select p.* into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select o.* into v_order from public.deal_orders o where o.id=p_order_id for update;
 if v_order.id is null or v_profile.id is null or v_order.team_id<>v_profile.team_id then raise exception'ORDER_NOT_FOUND'using errcode='P0002';end if;
 if not public.is_feature_enabled(v_order.team_id,'sales_os_v3')or not public.has_permission(v_order.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.team_id||':'||trim(p_external_ref),0));
 select s.* into v_existing from public.deal_internal_settlements s where s.team_id=v_order.team_id and s.idempotency_key=p_idempotency_key;
 if v_existing.id is not null then
   if v_existing.order_id is distinct from v_order.id or v_existing.amount is distinct from p_amount or v_existing.method is distinct from p_method or v_existing.external_ref is distinct from trim(p_external_ref)then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return v_order;
 end if;
 if exists(select 1 from public.deal_internal_settlements s where s.team_id=v_order.team_id and s.external_ref=trim(p_external_ref))then raise exception'PAYMENT_REFERENCE_ALREADY_USED'using errcode='23505';end if;
 select coalesce(sum(s.amount),0)into v_paid from public.deal_internal_settlements s where s.team_id=v_order.team_id and s.order_id=v_order.id;
 if v_paid+p_amount>v_order.internal_due then raise exception'INTERNAL_PAYMENT_EXCEEDS_DUE'using errcode='23514';end if;
 insert into public.deal_internal_settlements(team_id,order_id,amount,method,external_ref,idempotency_key,confirmed_by)
 values(v_order.team_id,v_order.id,p_amount,p_method,trim(p_external_ref),p_idempotency_key,v_profile.id)returning*into v_settlement;
 v_paid:=v_paid+p_amount;
 update public.deal_orders o set internal_paid=v_paid,status=case when v_paid>=o.internal_due then'internal_paid'else o.status end,fulfillment_allowed_at=case when v_paid>=o.internal_due then coalesce(o.fulfillment_allowed_at,now())else null end where o.id=v_order.id returning*into v_order;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
 values(v_order.team_id,v_profile.id,'deal.internal_settlement_confirmed','deal_order',v_order.id,jsonb_build_object('internal_paid',v_paid-p_amount),jsonb_build_object('internal_paid',v_paid,'method',p_method,'fulfillment_unlocked',v_order.fulfillment_allowed_at is not null));
 return v_order;
end$$;

drop function if exists public.record_deal_procurement_cost(uuid,numeric,text,uuid);
create function public.record_deal_procurement_cost(p_order_id uuid,p_amount numeric,p_external_ref text,p_idempotency_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_order public.deal_orders;v_profile public.profiles;v_existing public.deal_procurement_cost_payments;v_payment public.deal_procurement_cost_payments;
begin
 if p_amount is null or p_amount<=0 or nullif(trim(p_external_ref),'')is null or p_idempotency_key is null then raise exception'VALID_PROCUREMENT_PAYMENT_REQUIRED'using errcode='22023';end if;
 select p.* into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select o.* into v_order from public.deal_orders o where o.id=p_order_id for update;
 if v_order.id is null or v_profile.id is null or v_order.team_id<>v_profile.team_id or not public.is_feature_enabled(v_order.team_id,'sales_os_v3')or not public.has_permission(v_order.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_order.team_id||':'||trim(p_external_ref),0));
 select p.* into v_existing from public.deal_procurement_cost_payments p where p.team_id=v_order.team_id and p.idempotency_key=p_idempotency_key;
 if v_existing.id is not null then if v_existing.order_id is distinct from v_order.id or v_existing.amount is distinct from p_amount or v_existing.external_ref is distinct from trim(p_external_ref)then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return v_existing.id;end if;
 if exists(select 1 from public.deal_procurement_cost_payments p where p.team_id=v_order.team_id and p.external_ref=trim(p_external_ref))then raise exception'PAYMENT_REFERENCE_ALREADY_USED'using errcode='23505';end if;
 insert into public.deal_procurement_cost_payments(team_id,order_id,amount,external_ref,idempotency_key,confirmed_by)values(v_order.team_id,v_order.id,p_amount,trim(p_external_ref),p_idempotency_key,v_profile.id)returning*into v_payment;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_order.team_id,v_profile.id,'deal.procurement_payment_recorded','deal_order',v_order.id,'{}',jsonb_build_object('procurement_payment_id',v_payment.id,'amount',p_amount));
 return v_payment.id;
end$$;

create or replace function public.finalize_order_sales_margin(p_order_id uuid)returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_order public.deal_orders;v_profile public.profiles;v_paid numeric;v_reversed numeric;v_expenses numeric;v_margin numeric;
begin
 select p.* into v_profile from public.profiles p where p.id=auth.uid()and p.status='active';select o.* into v_order from public.deal_orders o where o.id=p_order_id for update;
 if v_order.id is null or v_profile.id is null or v_order.team_id<>v_profile.team_id then raise exception'ORDER_NOT_FOUND'using errcode='P0002';end if;
 if not public.is_feature_enabled(v_order.team_id,'sales_os_v3')or not public.has_permission(v_order.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 if v_order.margin_finalized_at is not null then return v_order.id;end if;
 select coalesce(sum(p.amount),0)into v_paid from public.deal_payments p where p.team_id=v_order.team_id and p.order_id=v_order.id;
 select coalesce(sum(r.amount),0)into v_reversed from public.deal_payment_reversals r join public.deal_payments p on p.id=r.payment_id and p.team_id=r.team_id where p.team_id=v_order.team_id and p.order_id=v_order.id;
 select coalesce(sum(e.amount),0)into v_expenses from public.deal_sales_expenses e where e.team_id=v_order.team_id and e.order_id=v_order.id;
 if v_paid-v_reversed<v_order.customer_total then raise exception'CUSTOMER_PAYMENT_NOT_COMPLETE'using errcode='55000';end if;
 if v_order.internal_paid<v_order.internal_due or v_order.fulfillment_allowed_at is null then raise exception'INTERNAL_PAYMENT_NOT_COMPLETE'using errcode='55000';end if;
 v_margin:=v_paid-v_reversed-v_order.internal_due-v_expenses;
 update public.deal_orders o set final_sales_margin=v_margin,margin_finalized_at=now(),margin_finalized_by=v_profile.id where o.id=v_order.id;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_order.team_id,v_profile.id,'deal.sales_margin_finalized','deal_order',v_order.id,jsonb_build_object('final_sales_margin',null),jsonb_build_object('final_sales_margin',v_margin));
 return v_order.id;
end$$;

drop function if exists public.get_internal_payment_workbench();
create function public.get_internal_payment_workbench()
returns table(order_id uuid,order_number text,quote_id uuid,store_name text,owner_name text,order_status text,customer_total numeric,customer_paid numeric,customer_remaining numeric,internal_due numeric,internal_paid numeric,internal_remaining numeric,procurement_paid numeric,estimated_margin numeric,final_margin numeric,margin_finalized boolean,fulfillment_unlocked boolean,can_manage boolean,can_view_margin boolean,lock_reason text)
language sql security definer stable set search_path = '' as $$
 with me as(select p.id,p.team_id,public.has_permission(p.team_id,'finance.manage')can_manage,public.has_access_role(p.team_id,array['owner'])is_owner from public.profiles p where p.id=auth.uid()and p.status='active'and public.is_feature_enabled(p.team_id,'sales_os_v3')),
 payment as(select p.team_id,p.order_id,sum(p.amount)paid from public.deal_payments p group by p.team_id,p.order_id),reversal as(select p.team_id,p.order_id,sum(r.amount)reversed from public.deal_payment_reversals r join public.deal_payments p on p.id=r.payment_id and p.team_id=r.team_id group by p.team_id,p.order_id),procurement as(select p.team_id,p.order_id,sum(p.amount)paid from public.deal_procurement_cost_payments p group by p.team_id,p.order_id)
 select o.id,o.order_number,o.quote_id,coalesce(s.name,'未命名门店'),coalesce(owner.name,'未命名销售'),o.status,o.customer_total,
  greatest(coalesce(pay.paid,0)-coalesce(rev.reversed,0),0),greatest(o.customer_total-(coalesce(pay.paid,0)-coalesce(rev.reversed,0)),0),o.internal_due,o.internal_paid,greatest(o.internal_due-o.internal_paid,0),case when m.can_manage then coalesce(pc.paid,0)else 0 end,
  case when m.can_manage or(not m.is_owner and(q.owner_id=m.id or public.can_supervise_performance(m.team_id,q.owner_id,current_date)))then o.customer_total-o.internal_due else null end,
  case when m.can_manage or(not m.is_owner and(q.owner_id=m.id or public.can_supervise_performance(m.team_id,q.owner_id,current_date)))then o.final_sales_margin else null end,
  o.margin_finalized_at is not null,o.fulfillment_allowed_at is not null,m.can_manage,
  m.can_manage or(not m.is_owner and(q.owner_id=m.id or public.can_supervise_performance(m.team_id,q.owner_id,current_date))),
  case when o.fulfillment_allowed_at is not null then'内部应付已结清，履约已解锁'else'内部应付尚欠'||greatest(o.internal_due-o.internal_paid,0)::text||'，履约保持锁定'end
 from me m join public.deal_orders o on o.team_id=m.team_id join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id join public.profiles owner on owner.id=q.owner_id left join public.crm_opportunities op on op.id=o.opportunity_id and op.team_id=o.team_id left join public.crm_stores s on s.id=op.store_id and s.team_id=op.team_id left join payment pay on pay.team_id=o.team_id and pay.order_id=o.id left join reversal rev on rev.team_id=o.team_id and rev.order_id=o.id left join procurement pc on pc.team_id=o.team_id and pc.order_id=o.id
 where m.can_manage or(not m.is_owner and(q.owner_id=m.id or public.can_act_for(m.team_id,q.owner_id)or public.can_supervise_performance(m.team_id,q.owner_id,current_date)))order by(o.internal_due-o.internal_paid)>0 desc,o.created_at desc
$$;

revoke all on function public.confirm_order_customer_payment(uuid,numeric,text,text,uuid),public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text),public.record_deal_procurement_cost(uuid,numeric,text,uuid),public.finalize_order_sales_margin(uuid),public.get_internal_payment_workbench()from public,anon;
grant execute on function public.confirm_order_customer_payment(uuid,numeric,text,text,uuid),public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text),public.record_deal_procurement_cost(uuid,numeric,text,uuid),public.finalize_order_sales_margin(uuid),public.get_internal_payment_workbench()to authenticated;
notify pgrst,'reload schema';
