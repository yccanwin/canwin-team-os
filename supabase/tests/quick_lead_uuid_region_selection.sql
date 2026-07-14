do $$
declare
  context_definition text;
  create_definition text;
  create_arguments text;
begin
  if to_regprocedure('public.get_quick_lead_context()') is null then
    raise exception 'Quick lead context RPC missing';
  end if;
  if to_regprocedure('public.create_crm_lead_quick(text,text,text,uuid)') is null then
    raise exception 'Quick lead create RPC signature changed';
  end if;

  context_definition:=lower(pg_get_functiondef(
    'public.get_quick_lead_context()'::regprocedure
  ));
  create_definition:=lower(pg_get_functiondef(
    'public.create_crm_lead_quick(text,text,text,uuid)'::regprocedure
  ));
  create_arguments:=lower(pg_get_function_arguments(
    'public.create_crm_lead_quick(text,text,text,uuid)'::regprocedure
  ));

  if context_definition like '%max(%' or create_definition like '%max(%' then
    raise exception 'UUID aggregate regression in quick lead RPCs';
  end if;
  if position('order by psr.is_primary desc' in context_definition)=0
    or position('''[]''::jsonb' in context_definition)=0
    or position('region_count=1' in context_definition)=0
    or position('region_count>1' in context_definition)=0 then
    raise exception 'Quick lead context does not cover deterministic 0/1/many selection';
  end if;
  if position('lead_region_not_assigned' in create_definition)=0
    or position('lead_region_selection_required' in create_definition)=0
    or position('region_count=1' in create_definition)=0 then
    raise exception 'Quick lead create region validation contract incomplete';
  end if;
  if position('p_region_id uuid default null::uuid' in create_arguments)=0 then
    raise exception 'Quick lead create default parameter changed';
  end if;
end $$;
