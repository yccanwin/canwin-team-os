-- A trigger record only exposes columns from its own table. Keep the table-name
-- dispatch outside field access so PostgreSQL never evaluates another table's
-- NEW fields (for example crm_contact_private.contact_id while inserting a lead).
create or replace function public.crm_validate_team_references()
returns trigger
language plpgsql
set search_path=''
as $function$
begin
  if tg_table_name='crm_brands' then
    if new.owner_id is not null
      and not exists (
        select 1 from public.profiles p
        where p.id=new.owner_id and p.team_id=new.team_id
      ) then
      raise exception 'CRM_CROSS_TEAM_BRAND' using errcode='23514';
    end if;

  elsif tg_table_name='crm_stores' then
    if not exists (
        select 1 from public.sales_regions r
        where r.id=new.region_id and r.team_id=new.team_id
      )
      or (new.brand_id is not null and not exists (
        select 1 from public.crm_brands b
        where b.id=new.brand_id and b.team_id=new.team_id
      ))
      or (new.owner_id is not null and not exists (
        select 1 from public.profiles p
        where p.id=new.owner_id and p.team_id=new.team_id
      )) then
      raise exception 'CRM_CROSS_TEAM_STORE' using errcode='23514';
    end if;

  elsif tg_table_name='crm_contacts' then
    if (new.brand_id is not null and not exists (
        select 1 from public.crm_brands b
        where b.id=new.brand_id and b.team_id=new.team_id
      ))
      or (new.store_id is not null and not exists (
        select 1 from public.crm_stores s
        where s.id=new.store_id and s.team_id=new.team_id
      ))
      or (new.owner_id is not null and not exists (
        select 1 from public.profiles p
        where p.id=new.owner_id and p.team_id=new.team_id
      )) then
      raise exception 'CRM_CROSS_TEAM_CONTACT' using errcode='23514';
    end if;

  elsif tg_table_name='crm_contact_private' then
    if not exists (
      select 1 from public.crm_contacts c
      where c.id=new.contact_id and c.team_id=new.team_id
    ) then
      raise exception 'CRM_CROSS_TEAM_PRIVATE_CONTACT' using errcode='23514';
    end if;

  elsif tg_table_name='crm_leads' then
    if not exists (
        select 1 from public.sales_regions r
        where r.id=new.region_id and r.team_id=new.team_id
      )
      or (new.brand_id is not null and not exists (
        select 1 from public.crm_brands b
        where b.id=new.brand_id and b.team_id=new.team_id
      ))
      or (new.store_id is not null and not exists (
        select 1 from public.crm_stores s
        where s.id=new.store_id and s.team_id=new.team_id
      ))
      or (new.owner_id is not null and not exists (
        select 1 from public.profiles p
        where p.id=new.owner_id and p.team_id=new.team_id
      )) then
      raise exception 'CRM_CROSS_TEAM_LEAD' using errcode='23514';
    end if;

  elsif tg_table_name='crm_opportunities' then
    if not exists (
        select 1 from public.sales_regions r
        where r.id=new.region_id and r.team_id=new.team_id
      )
      or not exists (
        select 1 from public.crm_stores s
        where s.id=new.store_id and s.team_id=new.team_id
      )
      or not exists (
        select 1 from public.profiles p
        where p.id=new.owner_id and p.team_id=new.team_id
      )
      or (new.lead_id is not null and not exists (
        select 1 from public.crm_leads l
        where l.id=new.lead_id and l.team_id=new.team_id
      ))
      or (new.brand_id is not null and not exists (
        select 1 from public.crm_brands b
        where b.id=new.brand_id and b.team_id=new.team_id
      )) then
      raise exception 'CRM_CROSS_TEAM_OPPORTUNITY' using errcode='23514';
    end if;

  elsif tg_table_name='crm_followups' then
    if not exists (
        select 1 from public.profiles p
        where p.id=new.actor_id and p.team_id=new.team_id
      )
      or (new.lead_id is not null and not exists (
        select 1 from public.crm_leads l
        where l.id=new.lead_id and l.team_id=new.team_id
      ))
      or (new.opportunity_id is not null and not exists (
        select 1 from public.crm_opportunities o
        where o.id=new.opportunity_id and o.team_id=new.team_id
      )) then
      raise exception 'CRM_CROSS_TEAM_FOLLOWUP' using errcode='23514';
    end if;

  elsif tg_table_name='crm_owner_history' then
    if (new.previous_owner_id is not null and not exists (
        select 1 from public.profiles p
        where p.id=new.previous_owner_id and p.team_id=new.team_id
      ))
      or (new.new_owner_id is not null and not exists (
        select 1 from public.profiles p
        where p.id=new.new_owner_id and p.team_id=new.team_id
      ))
      or not exists (
        select 1 from public.profiles p
        where p.id=new.changed_by and p.team_id=new.team_id
      ) then
      raise exception 'CRM_CROSS_TEAM_HISTORY' using errcode='23514';
    end if;
  end if;

  return new;
end
$function$;
