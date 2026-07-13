do$$begin
 if to_regclass('public.crm_contact_attempts')is null or to_regclass('public.crm_recycle_pauses')is null then raise exception 'Automation tables missing';end if;
 if to_regprocedure('public.run_sales_automation_batch(text,timestamp with time zone)')is null then raise exception 'Batch RPC missing';end if;
 if position('Asia/Shanghai' in pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure))=0 then raise exception 'Beijing natural-day rules missing';end if;
 if position('skip locked' in lower(pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure)))=0 then raise exception 'Concurrent idempotent batch lock missing';end if;
 if position('today_cn - 1' in pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure))=0 or position('today_cn - 2' in pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure))=0 or position('today_cn - 15' in pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure))=0 then raise exception '24h/48h/15d rules missing';end if;
 if position('count(DISTINCT' in pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure))=0 or position('today_cn + 30' in pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure))=0 then raise exception 'Three-day/30-day nurture rule missing';end if;
 if position('supervisor_review' in pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure))=0
  or position('nurture_round = 1' in pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure))=0 then raise exception 'Round 1 to supervisor review transition missing';end if;
 if to_regprocedure('public.decide_crm_nurture_review(uuid,boolean,text)')is null
  or position('nurture_round = 2' in pg_get_functiondef('public.decide_crm_nurture_review(uuid,boolean,text)'::regprocedure))=0
  or position('nurture_review_rejected' in pg_get_functiondef('public.decide_crm_nurture_review(uuid,boolean,text)'::regprocedure))=0 then raise exception 'Supervisor round-2/reject decision missing';end if;
 if position('nurture_round = 2' in pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure))=0
  or position('nurture_round < 1' in pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure))=0 then raise exception 'Round 2 expiry/max-round cap missing';end if;
 if position('access_delegations' in pg_get_functiondef('public.crm_lead_recycle_paused(text,uuid,uuid,timestamp with time zone)'::regprocedure))=0 then raise exception 'Pause/delegation exception missing';end if;
 if to_regclass('public.crm_today_actions')is null or to_regclass('public.crm_supervisor_exceptions')is null then raise exception 'Action views missing';end if;
 if position('48 hours' in pg_get_viewdef('public.crm_supervisor_exceptions'::regclass,true))=0 then raise exception 'Supervisor 48h exception rule missing';end if;
 if has_function_privilege('authenticated','public.run_sales_automation_batch(text,timestamp with time zone)','EXECUTE')or has_function_privilege('anon','public.run_sales_automation_batch(text,timestamp with time zone)','EXECUTE')then raise exception 'Batch RPC exposed';end if;
 if(select count(*)from pg_policies where schemaname='public'and tablename in('crm_contact_attempts','crm_recycle_pauses')and policyname='sales os v3 server gate'and permissive='RESTRICTIVE')<>2 then raise exception 'Automation gates missing';end if;
 if (select array_agg(column_name::text order by ordinal_position)from information_schema.columns where table_schema='public'and table_name='crm_leads_visible')
  is distinct from array['id','read_scope','store_name','contact_name','masked_phone','district_name','business_type','source','created_at','next_action_at','stage','facts','lead_status','owner_display_name','claimable']then raise exception 'Lead pool view contract changed';end if;
 if exists(select 1 from information_schema.columns where table_schema='public'and table_name='crm_leads_visible'and column_name in('phone','owner_id','email','wechat_id'))then raise exception 'Lead pool view leaks sensitive owner/contact data';end if;
 if position('claimable' in lower(pg_get_viewdef('public.crm_leads_visible'::regclass,true)))=0
  or position('owner_id is null' in lower(pg_get_viewdef('public.crm_leads_visible'::regclass,true)))=0
  or position('status = ''public''' in lower(pg_get_viewdef('public.crm_leads_visible'::regclass,true)))=0 then raise exception 'Server claimable calculation missing';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public'and table_name='crm_opportunities'and column_name='decision_at')
  or to_regclass('public.crm_supervisor_board')is null then raise exception 'Closing opportunity supervisor board missing';end if;
 if position('7' in pg_get_viewdef('public.crm_supervisor_board'::regclass,true))=0 or position('deal_quotes' in pg_get_viewdef('public.crm_supervisor_board'::regclass,true))=0 then raise exception 'Quoted 0-7 day decision rule missing';end if;
 if to_regclass('public.supervisor_exception_resolutions')is null or to_regprocedure('public.resolve_supervisor_exception(text,uuid,uuid,timestamp with time zone,text)')is null then raise exception 'Supervisor resolution interface missing';end if;
 if position('p_owner_id' in pg_get_function_arguments('public.resolve_supervisor_exception(text,uuid,uuid,timestamp with time zone,text)'::regprocedure))=0
  or position('p_resolution_due_at' in pg_get_function_arguments('public.resolve_supervisor_exception(text,uuid,uuid,timestamp with time zone,text)'::regprocedure))=0
  or position('p_resolution_note' in pg_get_function_arguments('public.resolve_supervisor_exception(text,uuid,uuid,timestamp with time zone,text)'::regprocedure))=0 then raise exception 'Resolution owner/deadline/note contract missing';end if;
 if exists(select 1 from pg_policies where schemaname='public'and tablename='supervisor_exception_resolutions'and cmd in('UPDATE','DELETE','ALL'))then raise exception 'Supervisor resolution history mutable';end if;
 if not exists(select 1 from pg_policies where schemaname='public'and tablename='supervisor_exception_resolutions'and policyname='sales os v3 server gate'and permissive='RESTRICTIVE')
  or has_table_privilege('anon','public.crm_supervisor_board','SELECT')or has_function_privilege('anon','public.resolve_supervisor_exception(text,uuid,uuid,timestamp with time zone,text)','EXECUTE')then raise exception 'Supervisor board gate/grants unsafe';end if;
end$$;select'sales_automation_ok'result;
