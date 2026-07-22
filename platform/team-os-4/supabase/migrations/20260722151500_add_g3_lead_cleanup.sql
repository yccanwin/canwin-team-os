-- G3 controlled cleanup for expired, unclaimed public-pool leads.

alter table public.opportunities add column lead_id uuid;
alter table public.opportunities add constraint opportunities_lead_company_fk
  foreign key (lead_id, company_id)
  references public.leads(id, company_id)
  on delete restrict;
create index opportunities_lead_idx
  on public.opportunities(lead_id, company_id)
  where lead_id is not null;

create table public.lead_cleanup_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  region text not null,
  business_date date not null,
  deleted_at timestamptz not null default now(),
  reason text not null,
  task_version text not null,
  constraint lead_cleanup_audit_region_not_blank check (btrim(region) <> ''),
  constraint lead_cleanup_audit_reason_not_blank check (btrim(reason) <> ''),
  constraint lead_cleanup_audit_task_version_not_blank check (btrim(task_version) <> '')
);

alter table public.lead_cleanup_audit enable row level security;
revoke all on table public.lead_cleanup_audit from anon, authenticated;
grant select on table public.lead_cleanup_audit to authenticated;
grant all privileges on table public.lead_cleanup_audit to service_role;

create policy lead_cleanup_audit_select_admin
on public.lead_cleanup_audit for select to authenticated
using (private.is_company_admin(company_id));

create or replace function public.cleanup_expired_public_leads_v1(
  p_company_id uuid,
  p_business_date date,
  p_batch_size integer,
  p_task_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lead record;
  v_deleted integer := 0;
  v_now timestamptz := pg_catalog.now();
begin
  if p_business_date is null
     or p_business_date <> (v_now at time zone 'Asia/Shanghai')::date then
    raise exception 'business date must equal the current Asia/Shanghai date'
      using errcode = '22023';
  end if;
  if p_batch_size is null or p_batch_size < 1 or p_batch_size > 500 then
    raise exception 'batch size must be between 1 and 500' using errcode = '22023';
  end if;
  if p_task_version is null or pg_catalog.btrim(p_task_version) = '' then
    raise exception 'task version is required' using errcode = '22023';
  end if;

  for v_lead in
    select l.id, l.region
    from public.leads as l
    where l.company_id = p_company_id
      and l.pool_status = 'public_pool'
      and l.owner_id is null
      and l.cleanup_due_at is not null
      and l.cleanup_due_at <= v_now
      and not exists (
        select 1 from public.opportunities as o
        where o.company_id = l.company_id and o.lead_id = l.id
      )
      and not exists (
        select 1 from public.work_items as w
        where w.company_id = l.company_id
          and w.source_business = 'lead'
          and w.source_id = l.id
      )
    order by l.cleanup_due_at, l.created_at, l.id
    for update of l skip locked
    limit p_batch_size
  loop
    insert into public.lead_cleanup_audit (
      company_id, region, business_date,
      deleted_at, reason, task_version
    ) values (
      p_company_id, v_lead.region, p_business_date,
      v_now, 'expired_public_pool_unclaimed', pg_catalog.btrim(p_task_version)
    )
    ;

    delete from public.leads
    where id = v_lead.id
      and company_id = p_company_id
      and pool_status = 'public_pool'
      and owner_id is null;
    if found then v_deleted := v_deleted + 1; end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'status', 'completed',
    'business_date', p_business_date,
    'deleted', v_deleted,
    'task_version', pg_catalog.btrim(p_task_version)
  );
end;
$function$;

revoke all on function public.cleanup_expired_public_leads_v1(uuid, date, integer, text)
  from public;
revoke all on function public.cleanup_expired_public_leads_v1(uuid, date, integer, text)
  from anon;
revoke all on function public.cleanup_expired_public_leads_v1(uuid, date, integer, text)
  from authenticated;
grant execute on function public.cleanup_expired_public_leads_v1(uuid, date, integer, text)
  to service_role;
