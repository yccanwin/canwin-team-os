do $$declare evidence_def text;store_def text;contact_def text;qualify_def text;begin
  if not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='audit_logs'and column_name='created_at'and is_nullable='NO'and column_default is not null)then
    raise exception 'Audit timestamp contract missing';end if;
  if to_regclass('public.crm_qualification_evidence_revocations')is null then
    raise exception 'Evidence revocation ledger missing';end if;
  if not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where c.oid='public.crm_qualification_evidence'::regclass
      and t.tgname='crm_qualification_evidence_append_only'and not t.tgisinternal)then
    raise exception 'Evidence overwrite/delete guard missing';end if;
  evidence_def:=pg_get_functiondef('public.record_crm_qualification_evidence(uuid,text,text,uuid,timestamp with time zone)'::regprocedure);
  if position('on conflict' in lower(evidence_def))>0 or position('update public.crm_qualification_evidence' in lower(evidence_def))>0 then
    raise exception 'Evidence RPC can overwrite history';end if;
  if position('insert into public.audit_logs' in lower(evidence_def))=0
    or position('actor_id' in lower(evidence_def))=0 or position('after_data' in lower(evidence_def))=0 then
    raise exception 'Evidence record audit missing';end if;
  if to_regprocedure('public.revoke_crm_qualification_evidence(uuid,text)')is null
    or position('crm_qualification_evidence_revocations' in pg_get_functiondef('public.revoke_crm_qualification_evidence(uuid,text)'::regprocedure))=0 then
    raise exception 'Separate evidence revocation RPC missing';end if;
  if position('insert into public.audit_logs' in lower(pg_get_functiondef('public.revoke_crm_qualification_evidence(uuid,text)'::regprocedure)))=0
    or position('before_data' in lower(pg_get_functiondef('public.revoke_crm_qualification_evidence(uuid,text)'::regprocedure)))=0
    or position('after_data' in lower(pg_get_functiondef('public.revoke_crm_qualification_evidence(uuid,text)'::regprocedure)))=0 then
    raise exception 'Evidence revocation audit missing';end if;
  store_def:=pg_get_functiondef('public.record_crm_store_qualification_facts(uuid,numeric,integer,boolean,boolean)'::regprocedure);
  contact_def:=pg_get_functiondef('public.upsert_crm_contact(uuid,uuid,uuid,text,text,boolean)'::regprocedure);
  if position('insert into public.audit_logs' in lower(store_def))=0
    or position('before_data' in lower(store_def))=0 or position('after_data' in lower(store_def))=0 then
    raise exception 'Store qualification audit missing';end if;
  if position('insert into public.audit_logs' in lower(contact_def))=0
    or position('before_data' in lower(contact_def))=0 or position('after_data' in lower(contact_def))=0
    or position('actor_id' in lower(contact_def))=0 then
    raise exception 'Key-person audit missing';end if;
  qualify_def:=pg_get_functiondef('public.qualify_crm_lead(uuid)'::regprocedure);
  if position('crm_qualification_evidence_revocations' in qualify_def)=0 then
    raise exception 'Qualification does not exclude revoked evidence';end if;
  if has_table_privilege('authenticated','public.crm_qualification_evidence','UPDATE')
    or has_table_privilege('authenticated','public.crm_qualification_evidence','DELETE')then
    raise exception 'Authenticated can mutate evidence directly';end if;
end $$;
select 'crm_qualification_append_only_ok' result;
