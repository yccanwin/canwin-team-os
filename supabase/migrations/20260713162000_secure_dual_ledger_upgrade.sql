-- Complete the legacy dual-ledger upgrade without exposing raw ledgers to owners.
drop policy if exists "owner reads company internal settlements"on public.deal_internal_settlements;
drop policy if exists "owner reads company procurement costs"on public.deal_procurement_cost_payments;
drop policy if exists "owner reads company orders for forecast"on public.deal_orders;
drop policy if exists "owner reads company adjustments v2"on public.profit_adjustments;

create or replace function public.confirm_deal_deposit(p_quote_id uuid,p_amount numeric,p_external_ref text,p_idempotency_key uuid,p_recipient_type text default'company')
returns public.deal_orders language plpgsql security definer set search_path='' as $$declare q public.deal_quotes;r public.profiles;o public.deal_orders;begin
 if p_amount<=0 or p_recipient_type not in('company','sales')then raise exception'VALID_DEPOSIT_REQUIRED'using errcode='22023';end if;select*into r from public.profiles where id=auth.uid()and status='active';select*into q from public.deal_quotes where id=p_quote_id for update;
 if q.id is null or r.id is null or q.team_id<>r.team_id then raise exception'QUOTE_NOT_FOUND'using errcode='P0002';end if;if not public.is_feature_enabled(q.team_id,'sales_os_v3')or not public.has_permission(q.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 if current_date>q.valid_until then raise exception'QUOTE_EXPIRED'using errcode='23514';end if;if p_amount>q.customer_total then raise exception'DEPOSIT_EXCEEDS_QUOTE_TOTAL'using errcode='23514';end if;select*into o from public.deal_orders where team_id=q.team_id and quote_id=q.id;if o.id is not null then return o;end if;if q.status not in('submitted','approved')then raise exception'QUOTE_NOT_CONFIRMABLE'using errcode='55000';end if;
 update public.deal_quotes set status='frozen',frozen_at=now(),updated_at=now()where id=q.id;insert into public.deal_orders(team_id,quote_id,opportunity_id,customer_total,internal_due)values(q.team_id,q.id,q.opportunity_id,q.customer_total,q.internal_total)returning*into o;
 insert into public.deal_payments(team_id,order_id,payment_type,amount,recipient_type,external_ref,idempotency_key,confirmed_by)values(q.team_id,o.id,'deposit',p_amount,p_recipient_type,p_external_ref,p_idempotency_key,r.id);return o;end$$;

create or replace function public.confirm_deal_internal_payment(p_order_id uuid,p_amount numeric,p_external_ref text,p_idempotency_key uuid,p_method text default'cash_remitted')
returns public.deal_orders language plpgsql security definer set search_path='' as $$declare o public.deal_orders;r public.profiles;paid numeric;begin
 if p_amount<=0 or p_method not in('cash_remitted','withheld_from_company_receipt')or nullif(trim(p_external_ref),'')is null then raise exception'VALID_INTERNAL_SETTLEMENT_REQUIRED'using errcode='22023';end if;select*into r from public.profiles where id=auth.uid()and status='active';select*into o from public.deal_orders where id=p_order_id for update;
 if o.id is null or r.id is null or o.team_id<>r.team_id then raise exception'ORDER_NOT_FOUND'using errcode='P0002';end if;if not public.is_feature_enabled(o.team_id,'sales_os_v3')or not public.has_permission(o.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;if exists(select 1 from public.deal_internal_settlements where team_id=o.team_id and idempotency_key=p_idempotency_key)then return o;end if;
 select coalesce(sum(amount),0)into paid from public.deal_internal_settlements where team_id=o.team_id and order_id=o.id;if paid+p_amount>o.internal_due then raise exception'INTERNAL_PAYMENT_EXCEEDS_DUE'using errcode='23514';end if;
 insert into public.deal_internal_settlements(team_id,order_id,amount,method,external_ref,idempotency_key,confirmed_by)values(o.team_id,o.id,p_amount,p_method,p_external_ref,p_idempotency_key,r.id)on conflict(team_id,idempotency_key)do nothing;
 select coalesce(sum(amount),0)into o.internal_paid from public.deal_internal_settlements where team_id=o.team_id and order_id=o.id;update public.deal_orders set internal_paid=o.internal_paid,status=case when o.internal_paid>=internal_due then'internal_paid'else status end,fulfillment_allowed_at=case when o.internal_paid>=internal_due then coalesce(fulfillment_allowed_at,now())else null end where id=o.id returning*into o;return o;end$$;

create or replace function public.record_deal_procurement_cost(p_order_id uuid,p_amount numeric,p_external_ref text,p_idempotency_key uuid)
returns public.deal_procurement_cost_payments language plpgsql security definer set search_path='' as $$declare o public.deal_orders;r public.profiles;c public.deal_procurement_cost_payments;begin
 if p_amount<=0 or nullif(trim(p_external_ref),'')is null then raise exception'VALID_PROCUREMENT_PAYMENT_REQUIRED'using errcode='22023';end if;select*into r from public.profiles where id=auth.uid()and status='active';select*into o from public.deal_orders where id=p_order_id for update;
 if o.id is null or r.id is null or o.team_id<>r.team_id or not public.is_feature_enabled(o.team_id,'sales_os_v3')or not public.has_permission(o.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 insert into public.deal_procurement_cost_payments(team_id,order_id,amount,external_ref,idempotency_key,confirmed_by)values(o.team_id,o.id,p_amount,p_external_ref,p_idempotency_key,r.id)on conflict(team_id,idempotency_key)do update set idempotency_key=excluded.idempotency_key returning*into c;return c;end$$;

create or replace function public.record_deal_sales_expense(p_order_id uuid,p_amount numeric,p_reason text,p_idempotency_key uuid)
returns public.deal_sales_expenses language plpgsql security definer set search_path='' as $$declare o public.deal_orders;q public.deal_quotes;r public.profiles;e public.deal_sales_expenses;begin
 if p_amount<=0 or nullif(trim(p_reason),'')is null then raise exception'VALID_SALES_EXPENSE_REQUIRED'using errcode='22023';end if;select*into r from public.profiles where id=auth.uid()and status='active';select*into o from public.deal_orders where id=p_order_id for update;select*into q from public.deal_quotes where id=o.quote_id;
 if o.id is null or r.id is null or o.team_id<>r.team_id or not public.is_feature_enabled(o.team_id,'sales_os_v3')or not public.has_permission(o.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 insert into public.deal_sales_expenses(team_id,order_id,salesperson_id,amount,reason,idempotency_key,confirmed_by)values(o.team_id,o.id,q.owner_id,p_amount,trim(p_reason),p_idempotency_key,r.id)on conflict(team_id,idempotency_key)do update set idempotency_key=excluded.idempotency_key returning*into e;return e;end$$;

create or replace function public.get_company_profit_summary()
returns table(team_id text,quarter_start date,actual_profit numeric,forecast_profit numeric)language sql security definer stable set search_path='' as $$
 with me as(select p.team_id from public.profiles p where p.id=auth.uid()and p.status='active'and public.is_feature_enabled(p.team_id,'sales_os_v3')and(public.has_access_role(p.team_id,array['owner'])or public.has_permission(p.team_id,'finance.read'))),
 ledger as(select s.team_id,date_trunc('quarter',s.confirmed_at)::date quarter_start,s.amount value from public.deal_internal_settlements s join me on me.team_id=s.team_id union all select c.team_id,date_trunc('quarter',c.confirmed_at)::date,-c.amount from public.deal_procurement_cost_payments c join me on me.team_id=c.team_id union all select a.team_id,date_trunc('quarter',a.effective_on)::date,case when a.adjustment_type='quarterly_rebate'then a.amount else-a.amount end from public.profit_adjustments a join me on me.team_id=a.team_id),
 actual as(select ledger.team_id,ledger.quarter_start,sum(value)actual_profit from ledger group by ledger.team_id,ledger.quarter_start),forecast as(select o.team_id,date_trunc('quarter',o.created_at)::date quarter_start,sum(o.internal_due-(o.internal_due/1.10))forecast_profit from public.deal_orders o join me on me.team_id=o.team_id where o.status<>'cancelled'group by o.team_id,date_trunc('quarter',o.created_at)::date)
 select coalesce(a.team_id,f.team_id),coalesce(a.quarter_start,f.quarter_start),coalesce(a.actual_profit,0),coalesce(f.forecast_profit,0)from actual a full join forecast f using(team_id,quarter_start)
$$;
create or replace view public.company_profit_summary with(security_invoker=true)as select*from public.get_company_profit_summary();

revoke all on function public.confirm_deal_deposit(uuid,numeric,text,uuid,text),public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text),public.record_deal_procurement_cost(uuid,numeric,text,uuid),public.record_deal_sales_expense(uuid,numeric,text,uuid),public.get_company_profit_summary()from public;
grant execute on function public.confirm_deal_deposit(uuid,numeric,text,uuid,text),public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text),public.record_deal_procurement_cost(uuid,numeric,text,uuid),public.record_deal_sales_expense(uuid,numeric,text,uuid),public.get_company_profit_summary()to authenticated;
revoke all on public.company_profit_summary from public,anon;grant select on public.company_profit_summary to authenticated;
notify pgrst,'reload schema';
