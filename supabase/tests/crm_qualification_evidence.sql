-- Static safety checks for 181000. Run after all migrations in a disposable DB.
do $$declare f text;begin
 if to_regclass('public.crm_qualification_evidence')is null then raise exception 'qualification evidence table missing';end if;
 if to_regprocedure('public.qualify_crm_lead(uuid)')is null or to_regprocedure('public.qualify_crm_lead(uuid,text,boolean,boolean,timestamp with time zone)')is not null then raise exception 'unsafe qualification signature remains';end if;
 if to_regprocedure('public.record_crm_qualification_evidence(uuid,text,text,uuid,timestamp with time zone)')is null or to_regprocedure('public.record_crm_store_qualification_facts(uuid,numeric,integer,boolean,boolean)')is null then raise exception 'controlled evidence RPC missing';end if;
 if not exists(select 1 from pg_indexes where schemaname='public'and indexname='crm_opportunities_one_active_per_lead_idx'and indexdef ilike '%unique%')then raise exception 'idempotency index missing';end if;
 if has_function_privilege('anon','public.qualify_crm_lead(uuid)','EXECUTE')or not has_function_privilege('authenticated','public.qualify_crm_lead(uuid)','EXECUTE')then raise exception 'qualification grants unsafe';end if;
 if has_table_privilege('authenticated','public.crm_opportunities','INSERT')or has_table_privilege('authenticated','public.crm_qualification_evidence','INSERT')then raise exception 'direct qualification mutation remains';end if;
 foreach f in array array['upsert_crm_brand(uuid,text,text)','upsert_crm_store(uuid,uuid,uuid,text,text,text)','upsert_crm_contact(uuid,uuid,uuid,text,text,boolean)','upsert_crm_lead(uuid,uuid,uuid,uuid,text,text)']loop
  if position('auth.uid()' in pg_get_functiondef(('public.'||f)::regprocedure))=0 or position('is_feature_enabled' in pg_get_functiondef(('public.'||f)::regprocedure))=0 then raise exception '% lacks explicit auth/flag gate',f;end if;
 end loop;
 if position('p_annual_fee_viable' in pg_get_function_arguments('public.qualify_crm_lead(uuid)'::regprocedure))>0 or position('crm_calculate_value_grade' in pg_get_functiondef('public.qualify_crm_lead(uuid)'::regprocedure))=0 or position('crm_qualification_evidence' in pg_get_functiondef('public.qualify_crm_lead(uuid)'::regprocedure))=0 then raise exception 'qualification still trusts client facts';end if;
 if position('s.region_id<>p_region_id' in replace(pg_get_functiondef('public.upsert_crm_lead(uuid,uuid,uuid,uuid,text,text)'::regprocedure),' ',''))=0 then raise exception 'lead store/region consistency missing';end if;
 if position('s.brand_idisdistinctfroml.brand_id' in replace(pg_get_functiondef('public.qualify_crm_lead(uuid)'::regprocedure),' ',''))=0 then raise exception 'qualification brand/store consistency missing';end if;
 if public.crm_calculate_value_grade(null)is not null then raise exception 'grade helper invalid null behavior';end if;
end$$;
select 'crm_qualification_evidence_ok' as result;
