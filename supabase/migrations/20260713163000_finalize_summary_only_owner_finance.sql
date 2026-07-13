-- Final 3.0 finance convergence. No 2.0 finance/case object is mutated here.

-- Owner is summary-only by default. Assigning the separate finance role remains explicit opt-in.
delete from public.access_role_permissions arp
using public.access_roles ar
where ar.id=arp.role_id and ar.code='owner'
  and arp.permission_code in('finance.read','finance.manage');

drop policy if exists "owner reads company internal settlements"on public.deal_internal_settlements;
drop policy if exists "owner reads company procurement costs"on public.deal_procurement_cost_payments;
drop policy if exists "owner reads company orders for forecast"on public.deal_orders;
drop policy if exists "owner reads company adjustments v2"on public.profit_adjustments;
drop policy if exists "owner finance reads adjustments"on public.profit_adjustments;
create policy "finance reads adjustments summary split"on public.profit_adjustments for select to authenticated
using(public.has_permission(team_id,'finance.read')or public.has_permission(team_id,'finance.manage'));

-- RESTRICTIVE policies prevent customers.supervise from becoming a finance bypass.
create policy "summary only owner raw catalog cost guard"on public.deal_catalog_items as restrictive for all to authenticated
using(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']))
with check(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']));
create policy "summary only owner raw quote guard"on public.deal_quotes as restrictive for all to authenticated
using(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']))
with check(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']));
create policy "summary only owner raw quote line guard"on public.deal_quote_lines as restrictive for all to authenticated
using(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']))
with check(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']));
create policy "summary only owner raw approval guard"on public.deal_quote_approvals as restrictive for all to authenticated
using(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']))
with check(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']));
create policy "summary only owner raw order guard"on public.deal_orders as restrictive for all to authenticated
using(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']))
with check(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']));
create policy "summary only owner raw payment guard"on public.deal_payments as restrictive for all to authenticated
using(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']))
with check(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']));
create policy "summary only owner raw reversal guard"on public.deal_payment_reversals as restrictive for all to authenticated
using(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']))
with check(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']));
create policy "summary only owner raw settlement guard"on public.deal_internal_settlements as restrictive for all to authenticated
using(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']))
with check(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']));
create policy "summary only owner raw procurement guard"on public.deal_procurement_cost_payments as restrictive for all to authenticated
using(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']))
with check(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']));
create policy "summary only owner raw expense guard"on public.deal_sales_expenses as restrictive for all to authenticated
using(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']))
with check(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']));
create policy "summary only owner raw adjustment guard"on public.profit_adjustments as restrictive for all to authenticated
using(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']))
with check(not public.has_access_role(team_id,array['owner'])or public.has_access_role(team_id,array['finance']));

create or replace function public.get_order_sales_ledger(p_team text,p_order uuid)
returns table(net_customer_payments numeric,internal_settlement_due numeric,sales_expenses numeric,sales_margin numeric)
language plpgsql security definer stable set search_path='' as $$
declare o public.deal_orders;q public.deal_quotes;paid numeric;reversed numeric;expenses numeric;
begin
 select*into o from public.deal_orders where id=p_order and team_id=p_team;
 select*into q from public.deal_quotes where id=o.quote_id and team_id=o.team_id;
 if o.id is null or not public.is_feature_enabled(p_team,'sales_os_v3')or not(
   public.has_permission(p_team,'finance.read')or(
     not public.has_access_role(p_team,array['owner'])and(
       q.owner_id=auth.uid()or public.can_supervise_performance(p_team,q.owner_id,current_date)
   )))then return;end if;
 select coalesce(sum(amount),0)into paid from public.deal_payments where team_id=p_team and order_id=o.id;
 select coalesce(sum(r.amount),0)into reversed from public.deal_payment_reversals r
 join public.deal_payments p on p.id=r.payment_id and p.team_id=r.team_id
 where p.team_id=p_team and p.order_id=o.id;
 select coalesce(sum(amount),0)into expenses from public.deal_sales_expenses where team_id=p_team and order_id=o.id;
 net_customer_payments:=paid-reversed;internal_settlement_due:=o.internal_due;
 sales_expenses:=expenses;sales_margin:=net_customer_payments-internal_settlement_due-sales_expenses;
 return next;
end$$;

create or replace function public.confirm_deal_deposit(p_quote_id uuid,p_amount numeric,p_external_ref text,p_idempotency_key uuid,p_recipient_type text default'company')
returns public.deal_orders language plpgsql security definer set search_path='' as $$
declare q public.deal_quotes;r public.profiles;o public.deal_orders;p public.deal_payments;key_row public.deal_payments;
begin
 if p_amount<=0 or p_recipient_type not in('company','sales')or p_idempotency_key is null then raise exception'VALID_DEPOSIT_REQUIRED'using errcode='22023';end if;
 select*into r from public.profiles where id=auth.uid()and status='active';select*into q from public.deal_quotes where id=p_quote_id for update;
 if q.id is null or r.id is null or q.team_id<>r.team_id then raise exception'QUOTE_NOT_FOUND'using errcode='P0002';end if;
 if not public.is_feature_enabled(q.team_id,'sales_os_v3')or not public.has_permission(q.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 select*into key_row from public.deal_payments where team_id=q.team_id and idempotency_key=p_idempotency_key;
 select*into o from public.deal_orders where team_id=q.team_id and quote_id=q.id;
 if key_row.id is not null then
   if o.id is null or key_row.order_id is distinct from o.id or key_row.payment_type<>'deposit'
     or key_row.amount is distinct from p_amount or key_row.recipient_type is distinct from p_recipient_type
     or key_row.external_ref is distinct from p_external_ref then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;
   return o;
 end if;
 if o.id is not null then raise exception'DEPOSIT_ALREADY_CONFIRMED'using errcode='55000';end if;
 if current_date>q.valid_until then raise exception'QUOTE_EXPIRED'using errcode='23514';end if;
 if p_amount>q.customer_total then raise exception'DEPOSIT_EXCEEDS_QUOTE_TOTAL'using errcode='23514';end if;
 if q.status not in('submitted','approved')then raise exception'QUOTE_NOT_CONFIRMABLE'using errcode='55000';end if;
 update public.deal_quotes set status='frozen',frozen_at=now(),updated_at=now()where id=q.id;
 insert into public.deal_orders(team_id,quote_id,opportunity_id,customer_total,internal_due)
 values(q.team_id,q.id,q.opportunity_id,q.customer_total,q.internal_total)returning*into o;
 insert into public.deal_payments(team_id,order_id,payment_type,amount,recipient_type,external_ref,idempotency_key,confirmed_by)
 values(q.team_id,o.id,'deposit',p_amount,p_recipient_type,p_external_ref,p_idempotency_key,r.id)returning*into p;
 return o;
end$$;

create or replace function public.confirm_deal_internal_payment(p_order_id uuid,p_amount numeric,p_external_ref text,p_idempotency_key uuid,p_method text default'cash_remitted')
returns public.deal_orders language plpgsql security definer set search_path='' as $$
declare o public.deal_orders;r public.profiles;paid numeric;s public.deal_internal_settlements;
begin
 if p_amount<=0 or p_method not in('cash_remitted','withheld_from_company_receipt')or nullif(trim(p_external_ref),'')is null or p_idempotency_key is null then raise exception'VALID_INTERNAL_SETTLEMENT_REQUIRED'using errcode='22023';end if;
 select*into r from public.profiles where id=auth.uid()and status='active';select*into o from public.deal_orders where id=p_order_id for update;
 if o.id is null or r.id is null or o.team_id<>r.team_id then raise exception'ORDER_NOT_FOUND'using errcode='P0002';end if;
 if not public.is_feature_enabled(o.team_id,'sales_os_v3')or not public.has_permission(o.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 select*into s from public.deal_internal_settlements where team_id=o.team_id and idempotency_key=p_idempotency_key;
 if s.id is not null then
   if s.order_id is distinct from o.id or s.amount is distinct from p_amount or s.method is distinct from p_method or s.external_ref is distinct from p_external_ref then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;
   return o;
 end if;
 select coalesce(sum(amount),0)into paid from public.deal_internal_settlements where team_id=o.team_id and order_id=o.id;
 if paid+p_amount>o.internal_due then raise exception'INTERNAL_PAYMENT_EXCEEDS_DUE'using errcode='23514';end if;
 insert into public.deal_internal_settlements(team_id,order_id,amount,method,external_ref,idempotency_key,confirmed_by)
 values(o.team_id,o.id,p_amount,p_method,p_external_ref,p_idempotency_key,r.id);
 select coalesce(sum(amount),0)into o.internal_paid from public.deal_internal_settlements where team_id=o.team_id and order_id=o.id;
 update public.deal_orders set internal_paid=o.internal_paid,status=case when o.internal_paid>=internal_due then'internal_paid'else status end,
 fulfillment_allowed_at=case when o.internal_paid>=internal_due then coalesce(fulfillment_allowed_at,now())else null end where id=o.id returning*into o;
 return o;
end$$;

create or replace function public.record_deal_procurement_cost(p_order_id uuid,p_amount numeric,p_external_ref text,p_idempotency_key uuid)
returns public.deal_procurement_cost_payments language plpgsql security definer set search_path='' as $$
declare o public.deal_orders;r public.profiles;c public.deal_procurement_cost_payments;
begin
 if p_amount<=0 or nullif(trim(p_external_ref),'')is null or p_idempotency_key is null then raise exception'VALID_PROCUREMENT_PAYMENT_REQUIRED'using errcode='22023';end if;
 select*into r from public.profiles where id=auth.uid()and status='active';select*into o from public.deal_orders where id=p_order_id for update;
 if o.id is null or r.id is null or o.team_id<>r.team_id or not public.is_feature_enabled(o.team_id,'sales_os_v3')or not public.has_permission(o.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 select*into c from public.deal_procurement_cost_payments where team_id=o.team_id and idempotency_key=p_idempotency_key;
 if c.id is not null then
   if c.order_id is distinct from o.id or c.amount is distinct from p_amount or c.external_ref is distinct from p_external_ref then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;
   return c;
 end if;
 insert into public.deal_procurement_cost_payments(team_id,order_id,amount,external_ref,idempotency_key,confirmed_by)
 values(o.team_id,o.id,p_amount,p_external_ref,p_idempotency_key,r.id)returning*into c;return c;
end$$;

create or replace function public.record_deal_sales_expense(p_order_id uuid,p_amount numeric,p_reason text,p_idempotency_key uuid)
returns public.deal_sales_expenses language plpgsql security definer set search_path='' as $$
declare o public.deal_orders;q public.deal_quotes;r public.profiles;e public.deal_sales_expenses;
begin
 if p_amount<=0 or nullif(trim(p_reason),'')is null or p_idempotency_key is null then raise exception'VALID_SALES_EXPENSE_REQUIRED'using errcode='22023';end if;
 select*into r from public.profiles where id=auth.uid()and status='active';select*into o from public.deal_orders where id=p_order_id for update;select*into q from public.deal_quotes where id=o.quote_id;
 if o.id is null or r.id is null or o.team_id<>r.team_id or not public.is_feature_enabled(o.team_id,'sales_os_v3')or not public.has_permission(o.team_id,'finance.manage')then raise exception'FINANCE_FORBIDDEN'using errcode='42501';end if;
 select*into e from public.deal_sales_expenses where team_id=o.team_id and idempotency_key=p_idempotency_key;
 if e.id is not null then
   if e.order_id is distinct from o.id or e.salesperson_id is distinct from q.owner_id or e.amount is distinct from p_amount or e.reason is distinct from trim(p_reason)then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;
   return e;
 end if;
 insert into public.deal_sales_expenses(team_id,order_id,salesperson_id,amount,reason,idempotency_key,confirmed_by)
 values(o.team_id,o.id,q.owner_id,p_amount,trim(p_reason),p_idempotency_key,r.id)returning*into e;return e;
end$$;

revoke all on function public.confirm_deal_deposit(uuid,numeric,text,uuid,text),
 public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text),
 public.record_deal_procurement_cost(uuid,numeric,text,uuid),
 public.record_deal_sales_expense(uuid,numeric,text,uuid)from public;
grant execute on function public.confirm_deal_deposit(uuid,numeric,text,uuid,text),
 public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text),
 public.record_deal_procurement_cost(uuid,numeric,text,uuid),
 public.record_deal_sales_expense(uuid,numeric,text,uuid)to authenticated;
notify pgrst,'reload schema';
