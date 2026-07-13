do$$declare create_def text;replace_def text;read_def text;begin
 if has_table_privilege('authenticated','public.deal_quotes','INSERT,UPDATE,DELETE')
   or has_table_privilege('authenticated','public.deal_quote_lines','INSERT,UPDATE,DELETE')then
   raise exception'Direct quote writes remain';end if;
 if exists(select 1 from pg_policies where schemaname='public'and policyname in(
   'sales create quote drafts','sales edit own quote drafts','sales create draft quote lines',
   'sales edit draft quote lines','sales delete draft quote lines'))then
   raise exception'Legacy quote write policy remains';end if;
 create_def:=lower(pg_get_functiondef('public.create_deal_quote_draft(uuid)'::regprocedure));
 if position('for update'in create_def)=0 or position('qualification_valid'in create_def)=0
   or position('qualification_superseded_at'in create_def)=0 then
   raise exception'Draft create lacks lock or qualification gate';end if;
 replace_def:=lower(pg_get_functiondef('public.replace_deal_quote_lines(uuid,jsonb)'::regprocedure));
 if position('status = ''published'''in replace_def)=0 and position('status=''published'''in replace_def)=0 then
   raise exception'Draft lines accept unpublished catalog';end if;
 if position('quote_lines_required'in replace_def)=0 then raise exception'Empty replacement allowed';end if;
 read_def:=lower(pg_get_functiondef('public.get_deal_quote_draft_lines(uuid)'::regprocedure));
 if position('internal_unit_price'in read_def)>0 or position('procurement_cost'in read_def)>0 then
   raise exception'Draft line reader leaks internal cost';end if;
 if has_function_privilege('anon','public.get_deal_quote_draft_lines(uuid)','EXECUTE')then
   raise exception'Anonymous draft line read';end if;
end$$;
select'quote_draft_hardening_ok'result;
