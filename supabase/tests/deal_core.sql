do $$ declare missing int; begin
  select count(*) into missing from unnest(array['deal_catalog_versions','deal_catalog_items','deal_packages','deal_package_items','deal_quotes','deal_quote_lines','deal_quote_approvals','deal_orders','deal_payments','deal_payment_reversals','deal_internal_settlements'])x(n) where to_regclass('public.'||n) is null;
  if missing<>0 then raise exception 'Missing % deal tables',missing; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'deal_%' and c.relkind='r' and c.relrowsecurity) < 13 then raise exception 'Deal RLS missing'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename like 'deal_%' and policyname='sales os v3 server gate' and permissive='RESTRICTIVE')<>13 then raise exception 'Deal gates missing'; end if;
  if to_regprocedure('public.submit_deal_quote(uuid)') is null or to_regprocedure('public.confirm_deal_deposit(uuid,numeric,text,uuid,text)') is null or to_regprocedure('public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text)') is null or to_regprocedure('public.reverse_deal_payment(uuid,numeric,text,uuid)') is null or to_regprocedure('public.record_deal_procurement_cost(uuid,numeric,text,uuid)')is null or to_regprocedure('public.record_deal_sales_expense(uuid,numeric,text,uuid)')is null then raise exception 'Deal RPC missing'; end if;
  if position('A_GRADE_DEMO_REQUIRED' in pg_get_functiondef('public.submit_deal_quote(uuid)'::regprocedure))=0 or position('approval_pending' in pg_get_functiondef('public.submit_deal_quote(uuid)'::regprocedure))=0 then raise exception 'Quote submit gates missing'; end if;
  if position('for update' in lower(pg_get_functiondef('public.confirm_deal_deposit(uuid,numeric,text,uuid,text)'::regprocedure)))=0 or position('frozen' in pg_get_functiondef('public.confirm_deal_deposit(uuid,numeric,text,uuid,text)'::regprocedure))=0 then raise exception 'Deposit freeze/idempotency lock missing'; end if;
  if position('QUOTE_EXPIRED' in pg_get_functiondef('public.confirm_deal_deposit(uuid,numeric,text,uuid,text)'::regprocedure))=0
    or position('DEPOSIT_EXCEEDS_QUOTE_TOTAL' in pg_get_functiondef('public.confirm_deal_deposit(uuid,numeric,text,uuid,text)'::regprocedure))=0 then raise exception 'Deposit expiry/amount cap missing'; end if;
  if position('INTERNAL_PAYMENT_EXCEEDS_DUE' in pg_get_functiondef('public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text)'::regprocedure))=0 then raise exception 'Internal settlement cap missing'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in('deal_payments','deal_payment_reversals','deal_internal_settlements') and cmd in('UPDATE','DELETE','ALL')) then raise exception 'Financial history is mutable'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.deal_quote_lines'::regclass and contype='f') or not exists(select 1 from pg_constraint where conrelid='public.deal_payments'::regclass and contype='f') then raise exception 'Cross-team composite references missing'; end if;
  if has_function_privilege('anon','public.confirm_deal_deposit(uuid,numeric,text,uuid,text)','EXECUTE') then raise exception 'Anon can confirm deposit'; end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename in('deal_payments','deal_payment_reversals','deal_internal_settlements')
    and policyname<>'sales os v3 server gate' and (coalesce(qual,'') like '%customers.manage%' or coalesce(with_check,'') like '%customers.manage%')) then raise exception 'Sales permission leaks financial history'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename in('deal_payments','deal_payment_reversals','deal_internal_settlements')
    and cmd='SELECT' and qual like '%finance.%')<>3 then raise exception 'Finance-only read policies missing'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename in('deal_quotes','deal_orders') and cmd='SELECT'
    and qual like '%can_act_for%' and qual like '%customers.supervise%')<>2 then raise exception 'Quote/order owner-delegate-supervisor isolation missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public'and table_name='deal_payments'and column_name='recipient_type')
    or not exists(select 1 from information_schema.columns where table_schema='public'and table_name='deal_internal_settlements'and column_name='method')then raise exception'Dual-ledger routing fields missing';end if;
  if position('cash_remitted' in pg_get_functiondef('public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text)'::regprocedure))=0
    or position('withheld_from_company_receipt' in pg_get_functiondef('public.confirm_deal_internal_payment(uuid,numeric,text,uuid,text)'::regprocedure))=0 then raise exception'Internal settlement methods missing';end if;
  if exists(select 1 from pg_policies where schemaname='public'and tablename in('deal_procurement_cost_payments','deal_sales_expenses')and cmd in('INSERT','UPDATE','DELETE','ALL'))then raise exception'Dual-ledger history client-mutable';end if;
end $$;
select 'deal_core_ok' result;
