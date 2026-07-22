do $$declare f text:=pg_get_functiondef('public.audit_crm_qualification_promotion()'::regprocedure);begin
 if not exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
   where c.oid='public.crm_leads'::regclass and t.tgname='crm_lead_qualification_audit'and not t.tgisinternal)then
   raise exception'Qualification audit trigger missing';end if;
 if position('old.status'in lower(f))=0 or position('new.status'in lower(f))=0
   or position('opportunity_id'in f)=0 or position('actor_id'in f)=0
   or position('insert into public.audit_logs'in lower(f))=0 then
   raise exception'Qualification audit payload incomplete';end if;
 if not exists(select 1 from information_schema.columns where table_schema='public'
   and table_name='audit_logs'and column_name='created_at'and is_nullable='NO'and column_default is not null)then
   raise exception'Qualification audit timestamp contract missing';end if;
end$$;
select'crm_qualification_promotion_audit_ok'result;
