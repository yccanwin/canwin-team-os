-- Post-migration smoke checks for a disposable/local Supabase database.
do $$
declare missing_count integer; unsafe_count integer;
begin
  select count(*) into missing_count from unnest(array['crm_brands','crm_stores','crm_contacts',
    'crm_contact_private','crm_leads','crm_opportunities','crm_followups','crm_owner_history']) x(name)
  where to_regclass('public.' || x.name) is null;
  if missing_count <> 0 then raise exception 'Missing % CRM tables', missing_count; end if;

  select count(*) into unsafe_count from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname = any(array['crm_brands','crm_stores','crm_contacts',
    'crm_contact_private','crm_leads','crm_opportunities','crm_followups','crm_owner_history'])
    and not c.relrowsecurity;
  if unsafe_count <> 0 then raise exception '% CRM tables lack RLS', unsafe_count; end if;

  if exists (select 1 from pg_policies where schemaname='public'
    and tablename = any(array['crm_brands','crm_stores','crm_contacts','crm_contact_private',
      'crm_leads','crm_opportunities','crm_followups','crm_owner_history'])
    and ('anon'=any(roles) or 'public'=any(roles))) then
    raise exception 'Anonymous/public CRM policy found';
  end if;

  if to_regprocedure('public.claim_crm_lead(uuid)') is null
    or to_regprocedure('public.crm_is_valid_opportunity(text,boolean,boolean,timestamp with time zone)') is null
    or to_regprocedure('public.crm_can_access_region(text,uuid,uuid)') is null then
    raise exception 'CRM server functions missing';
  end if;

  if (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname = any(array['crm_brands','crm_stores','crm_contacts',
        'crm_contact_private','crm_leads','crm_opportunities','crm_followups','crm_owner_history'])
        and t.tgname like '%team_guard' and not t.tgisinternal) <> 8 then
    raise exception 'CRM cross-team guard triggers missing';
  end if;

  if position('is_feature_enabled' in pg_get_functiondef('public.claim_crm_lead(uuid)'::regprocedure)) = 0
    or position('is_feature_enabled' in pg_get_functiondef('public.crm_can_access_region(text,uuid,uuid)'::regprocedure)) = 0 then
    raise exception 'CRM RPC/helper lacks sales_os_v3 server gate';
  end if;

  if (select count(*) from pg_policies where schemaname='public'
      and tablename = any(array['crm_brands','crm_stores','crm_contacts','crm_contact_private',
        'crm_leads','crm_opportunities','crm_followups','crm_owner_history'])
      and policyname='sales os v3 server gate' and permissive='RESTRICTIVE'
      and coalesce(qual,'') like '%is_feature_enabled%') <> 8 then
    raise exception 'CRM restrictive feature-gate policies missing';
  end if;

  if public.crm_is_valid_opportunity('D',true,true,null)
    or public.crm_is_valid_opportunity('A',false,true,null)
    or public.crm_is_valid_opportunity('B',true,false,null)
    or not public.crm_is_valid_opportunity('C',true,true,null) then
    raise exception 'Qualification rule skeleton failed';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema='public'
    and table_name='crm_contact_private' and column_name='phone')
    or exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='crm_contacts' and column_name='phone') then
    raise exception 'Sensitive phone is not isolated';
  end if;

  if to_regclass('public.crm_leads_visible') is null
    or to_regprocedure('public.record_crm_follow_up(uuid,text,text,timestamp with time zone)') is null then
    raise exception 'Sales workbench SQL contract missing';
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='crm_leads_visible' and column_name='phone')
    or not exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='crm_leads_visible' and column_name='masked_phone') then
    raise exception 'Visible lead contract leaks phone or lacks masked_phone';
  end if;

  if (select array_agg(column_name::text order by ordinal_position)
      from information_schema.columns where table_schema='public' and table_name='crm_leads_visible')
    is distinct from array['id','read_scope','store_name','contact_name','masked_phone','district_name',
      'business_type','source','created_at','next_action_at','stage','facts','lead_status',
      'owner_display_name','claimable','active_opportunity_id'] then
    raise exception 'crm_leads_visible column contract changed';
  end if;

  if position('is_feature_enabled' in pg_get_viewdef('public.crm_leads_visible'::regclass,true))=0
    or position('is_feature_enabled' in pg_get_functiondef(
      'public.record_crm_follow_up(uuid,text,text,timestamp with time zone)'::regprocedure))=0 then
    raise exception 'Workbench view/RPC lacks sales_os_v3 server gate';
  end if;

  if position('for update' in lower(pg_get_functiondef(
      'public.record_crm_follow_up(uuid,text,text,timestamp with time zone)'::regprocedure)))=0
    or position('FOLLOW_UP_EVIDENCE_REQUIRED' in pg_get_functiondef(
      'public.record_crm_follow_up(uuid,text,text,timestamp with time zone)'::regprocedure))=0 then
    raise exception 'Follow-up RPC lacks atomic lock or OR-evidence validation';
  end if;

  if position('p_lead_id' in pg_get_function_arguments('public.claim_crm_lead(uuid)'::regprocedure))=0
    or position('p_lead_id' in pg_get_function_arguments(
      'public.record_crm_follow_up(uuid,text,text,timestamp with time zone)'::regprocedure))=0 then
    raise exception 'Workbench RPC parameter contract changed';
  end if;

  if has_function_privilege('anon','public.record_crm_follow_up(uuid,text,text,timestamp with time zone)','EXECUTE')
    or not has_function_privilege('authenticated','public.record_crm_follow_up(uuid,text,text,timestamp with time zone)','EXECUTE')
    or has_table_privilege('anon','public.crm_leads_visible','SELECT')
    or not has_table_privilege('authenticated','public.crm_leads_visible','SELECT') then
    raise exception 'Workbench SQL contract grants are unsafe';
  end if;
end $$;
select 'crm_core_ok' as result;
