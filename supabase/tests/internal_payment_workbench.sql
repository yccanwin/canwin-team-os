do$$declare f text:=lower(pg_get_functiondef('public.get_internal_payment_workbench()'::regprocedure));begin
 if position('security definer'in f)=0 or position('finance.manage'in f)=0
   or position('internal_remaining'in f)=0 or position('fulfillment_unlocked'in f)=0 then
   raise exception'Internal payment workbench contract incomplete';end if;
 if position('deal_internal_settlements'in f)>0 then
   raise exception'Workbench leaks raw internal settlement ledger';end if;
 if position('not m.is_owner'in f)=0 then
   raise exception'Summary-only owner can read raw internal payment rows';end if;
 if has_function_privilege('anon','public.get_internal_payment_workbench()','EXECUTE')
   or not has_function_privilege('authenticated','public.get_internal_payment_workbench()','EXECUTE')then
   raise exception'Internal payment workbench grants unsafe';end if;
end$$;
select'internal_payment_workbench_ok'result;
