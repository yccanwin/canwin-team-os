-- Static post-migration regression. Safe for a connected database: no rows are
-- changed. Behavioral branches are asserted from the deployed function body.
do $test$
declare
  submit_def text;
  list_def text;
  automation_def text;
  automation_compact text;
  today_columns text[];
  policy_count integer;
begin
  if to_regclass('public.crm_lead_submissions')is null then
    raise exception 'crm_lead_submissions table missing';
  end if;
  if to_regprocedure('public.submit_operations_lead(text,text,text,text,text,text,text)')is null then
    raise exception 'operations lead submission RPC missing';
  end if;
  if to_regprocedure('public.get_my_lead_submissions(integer)')is null then
    raise exception 'own submission status RPC missing';
  end if;
  if to_regprocedure('public.get_operations_lead_intake_context(text,text)')is null then
    raise exception 'lead intake preview RPC missing';
  end if;

  select lower(pg_get_functiondef('public.submit_operations_lead(text,text,text,text,text,text,text)'::regprocedure))into submit_def;
  select lower(pg_get_functiondef('public.get_my_lead_submissions(integer)'::regprocedure))into list_def;
  select lower(pg_get_functiondef('public.run_sales_automation_batch(text,timestamp with time zone)'::regprocedure))into automation_def;
  automation_compact:=regexp_replace(automation_def,'\s+','','g');

  if position('security definer' in submit_def)=0
    or position('set search_path to ''''' in submit_def)=0
    or position('auth.uid() is null' in submit_def)=0
    or position('leads.submit' in submit_def)=0 then
    raise exception 'submission RPC security boundary incomplete';
  end if;
  if has_function_privilege('anon','public.submit_operations_lead(text,text,text,text,text,text,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.submit_operations_lead(text,text,text,text,text,text,text)','EXECUTE')then
    raise exception 'submission RPC grants unsafe';
  end if;
  if has_function_privilege('anon','public.get_operations_lead_intake_context(text,text)','EXECUTE')
    or not has_function_privilege('authenticated','public.get_operations_lead_intake_context(text,text)','EXECUTE')then
    raise exception 'preview RPC grants unsafe';
  end if;
  if has_function_privilege('anon','public.get_my_lead_submissions(integer)','EXECUTE')
    or not has_function_privilege('authenticated','public.get_my_lead_submissions(integer)','EXECUTE')then
    raise exception 'submission status RPC grants unsafe';
  end if;
  if exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where n.nspname='public'
      and p.proname=any(array[
        'get_operations_lead_intake_context',
        'submit_operations_lead',
        'get_my_lead_submissions'
      ])
      and acl.grantee=0
      and acl.privilege_type='EXECUTE'
  )then raise exception 'PUBLIC retains operations lead RPC execute';end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public'and c.relname='crm_lead_submissions'and c.relrowsecurity)then
    raise exception 'submission table RLS missing';
  end if;
  select count(*)into policy_count from pg_policies
  where schemaname='public'and tablename='crm_lead_submissions'
    and cmd='SELECT'and('authenticated'=any(roles));
  if policy_count<>1 then raise exception 'own submission select policy missing';end if;

  -- Permission is deliberately narrow: operations receives leads.submit but
  -- this migration never maps customers.manage, quote, or order permissions.
  if not exists(select 1 from public.access_role_permissions arp
    join public.access_roles ar on ar.id=arp.role_id
    where ar.code='operations'and arp.permission_code='leads.submit')then
    raise exception 'operations role lacks leads.submit';
  end if;
  if exists(select 1 from public.access_role_permissions arp
    join public.access_roles ar on ar.id=arp.role_id
    where ar.code='operations'and arp.permission_code='customers.manage')then
    raise exception 'operations role was widened to customers.manage';
  end if;

  -- Phone normalization + advisory lock + duplicate exit.
  if position('regexp_replace' in submit_def)=0
    or position('lead-phone:' in submit_def)=0
    or position('''duplicate'',true' in submit_def)=0 then
    raise exception 'phone duplicate protection incomplete';
  end if;
  -- Exact region match and no/ambiguous-region public-pool fallback.
  if position('lower(trim(sr.name))=lower(trim(p_region_text))' in submit_def)=0
    or position('unmatched_lead_pool' in submit_def)=0
    or position('''unmatched_pool''' in submit_def)=0
    or position('''regional_pool''' in submit_def)=0 then
    raise exception 'regional pool fallback incomplete';
  end if;
  -- One/many salesperson fairness uses eligible sales roles, least assignments,
  -- and a per-region transaction lock.
  if position('ar.code=''sales''' in submit_def)=0
    or position('lead-region:' in submit_def)=0
    or position('select count(*) from public.crm_lead_submissions' in submit_def)=0
    or position('assigned_owner_id=p.id' in submit_def)=0 then
    raise exception 'single/multiple salesperson assignment incomplete';
  end if;
  -- Claimed timer begins only for direct assignment; pools remain public/null.
  if position('case when target_owner.id is null then''public''else''claimed''end' in submit_def)=0
    or position('case when target_owner.id is null then null else now()end' in submit_def)=0 then
    raise exception 'claimed timing contract incomplete';
  end if;
  -- Submitter status lookup is own-team/own-user only even though it bypasses RLS.
  if position('s.submitted_by=actor.id' in list_def)=0
    or position('leads.submit' in list_def)=0
    or position('security definer' in list_def)=0 then
    raise exception 'own submission status boundary incomplete';
  end if;
  if position('owner_idisnotnullandclaimed_atisnotnullandlast_contact_attempt_atisnull' in automation_compact)=0
    or position('(claimed_atattimezone''asia/shanghai'')::date<=today_cn-1' in automation_compact)=0
    or position('(claimed_atattimezone''asia/shanghai'')::date<=today_cn-2' in automation_compact)=0
    or position('last_contact_attempt_atisnulland(created_atattimezone' in automation_compact)>0 then
    raise exception 'public-pool claim clock does not start at claimed_at';
  end if;
  -- Validate the action view through its stable database contract instead of
  -- parsing the complete decompiled view text. Decompiler output can change
  -- across PostgreSQL versions and can join unrelated CASE branches in a regex.
  select array_agg(a.attname order by a.attnum)into today_columns
  from pg_attribute a
  where a.attrelid='public.crm_today_actions'::regclass
    and a.attnum>0 and not a.attisdropped;
  if today_columns<>array[
    'team_id','owner_id','entity_id','entity_type',
    'action_type','due_at','title','urgency'
  ]::text[] then
    raise exception 'crm_today_actions column contract changed: %',today_columns;
  end if;
  if not exists(
    select 1 from pg_class c
    where c.oid='public.crm_today_actions'::regclass
      and c.relkind='v'
      and 'security_invoker=true'=any(coalesce(c.reloptions,array[]::text[]))
  )then raise exception 'crm_today_actions must remain a security-invoker view';end if;
  if has_table_privilege('anon','public.crm_today_actions','SELECT')
    or not has_table_privilege('authenticated','public.crm_today_actions','SELECT')then
    raise exception 'crm_today_actions grants unsafe';
  end if;
  -- This plans and executes the deployed view without reading or mutating rows.
  perform team_id,owner_id,entity_id,entity_type,action_type,due_at,title,urgency
  from public.crm_today_actions where false;

  if not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='profiles'and column_name='name')then raise exception 'profiles display name contract changed';end if;
  if not exists(select 1 from information_schema.check_constraints cc
    join information_schema.constraint_column_usage cu on cu.constraint_name=cc.constraint_name
    where cu.table_schema='public'and cu.table_name='crm_leads'and cu.column_name='status'
      and lower(cc.check_clause)like'%public%')then raise exception 'crm_leads public status missing';end if;
  if not exists(select 1 from public.access_roles where code='sales')then
    raise exception 'sales access role code missing';
  end if;
  if not exists(select 1 from pg_indexes where schemaname='public'and tablename='sales_regions'
    and indexdef ilike'%unique%'and indexdef ilike'%(team_id, code)%')then
    raise exception 'sales_regions team/code uniqueness missing';
  end if;
end
$test$;

select 'operations_lead_submission_ok' as result;
