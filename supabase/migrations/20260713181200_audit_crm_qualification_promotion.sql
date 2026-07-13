-- Qualification promotion and its audit row are committed atomically.
create or replace function public.audit_crm_qualification_promotion()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_opportunity_id uuid;v_actor uuid;
begin
  if old.status is distinct from new.status and new.status='qualified' then
    select o.id into v_opportunity_id from public.crm_opportunities o
    where o.lead_id=new.id and o.team_id=new.team_id
      and o.qualification_superseded_at is null
    order by o.created_at desc limit 1;
    if v_opportunity_id is null then
      raise exception 'QUALIFIED_LEAD_REQUIRES_OPPORTUNITY' using errcode='23514';
    end if;
    select coalesce(auth.uid(),o.created_by)into v_actor
    from public.crm_opportunities o where o.id=v_opportunity_id;
    insert into public.audit_logs
      (team_id,actor_id,action,target_type,target_id,before_data,after_data)
    values(new.team_id,v_actor,'crm.lead_qualified','crm_lead',new.id,
      jsonb_build_object('status',old.status),
      jsonb_build_object('status',new.status,'opportunity_id',v_opportunity_id));
  end if;
  return new;
end $$;
drop trigger if exists crm_lead_qualification_audit on public.crm_leads;
create trigger crm_lead_qualification_audit after update of status on public.crm_leads
for each row execute function public.audit_crm_qualification_promotion();
revoke all on function public.audit_crm_qualification_promotion()from public;
notify pgrst,'reload schema';
