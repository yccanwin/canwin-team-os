do$$declare f text;begin
 if exists(select 1 from public.access_role_permissions arp join public.access_roles ar on ar.id=arp.role_id where ar.code='owner'and arp.permission_code in('finance.read','finance.manage'))then raise exception'Owner retains implicit finance permission';end if;
 if exists(select 1 from pg_policies where schemaname='public'and policyname in('owner reads company internal settlements','owner reads company procurement costs','owner reads company orders for forecast','owner reads company adjustments v2','owner finance reads adjustments'))then raise exception'Legacy owner raw policy remains';end if;
 if to_regprocedure('public.get_company_profit_summary()')is null or not has_function_privilege('authenticated','public.get_company_profit_summary()','EXECUTE')then raise exception'Owner summary contract missing';end if;
 if (select count(*)from pg_policies where schemaname='public'and policyname like'summary only owner raw % guard'and permissive='RESTRICTIVE')<>11 then raise exception'Owner raw finance restrictive guards incomplete';end if;
 f:=lower(pg_get_functiondef('public.get_order_sales_ledger(text,uuid)'::regprocedure));if position('not public.has_access_role'in f)=0 then raise exception'Owner still has order ledger detail';end if;
 foreach f in array array['confirm_deal_deposit(uuid,numeric,text,uuid,text)','confirm_deal_internal_payment(uuid,numeric,text,uuid,text)','record_deal_procurement_cost(uuid,numeric,text,uuid)','record_deal_sales_expense(uuid,numeric,text,uuid)']loop
  if position('IDEMPOTENCY_KEY_CONFLICT'in pg_get_functiondef(('public.'||f)::regprocedure))=0 or position('is distinct from'in pg_get_functiondef(('public.'||f)::regprocedure))=0 then raise exception'% does not reject mismatched idempotency reuse',f;end if;
 end loop;
end$$;
select'finance_summary_only_owner_ok'result;
