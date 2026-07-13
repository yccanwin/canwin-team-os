-- Read-only follow-up history/context. Stage transitions remain service-side only.
create or replace function public.get_crm_lead_followup_context(p_lead_id uuid) returns jsonb
language plpgsql security definer stable set search_path='' as $$
declare r public.profiles;l public.crm_leads;activities jsonb;unreachable_days integer;
begin
  select * into r from public.profiles where id=auth.uid()and status='active';
  select * into l from public.crm_leads where id=p_lead_id;
  if r.id is null or l.id is null or l.team_id<>r.team_id then raise exception 'LEAD_NOT_FOUND' using errcode='P0002';end if;
  if not public.is_feature_enabled(l.team_id,'sales_os_v3')or not(l.owner_id=r.id or public.can_act_for(l.team_id,l.owner_id)or public.has_permission(l.team_id,'customers.supervise'))then raise exception 'LEAD_HISTORY_FORBIDDEN' using errcode='42501';end if;
  select count(distinct(a.occurred_at at time zone'Asia/Shanghai')::date) into unreachable_days from public.crm_contact_attempts a
  where a.team_id=l.team_id and a.lead_id=l.id and a.result in('no_answer','unreachable');
  select coalesce(jsonb_agg(to_jsonb(activity)order by activity.occurred_at desc),'[]'::jsonb)into activities from(
    select a.id,'attempt'::text activity_type,a.occurred_at,a.result::text outcome,null::text business_fact,null::text customer_commitment,null::timestamptz next_action_at
    from public.crm_contact_attempts a where a.team_id=l.team_id and a.lead_id=l.id
    union all
    select f.id,'effective_followup'::text,f.occurred_at,f.outcome::text,f.new_business_fact,f.customer_commitment,f.next_action_at
    from public.crm_followups f where f.team_id=l.team_id and f.lead_id=l.id and f.is_effective
  )activity;
  return jsonb_build_object('lead_status',l.status,'nurture_until',l.nurture_until,'unreachable_days',unreachable_days,'activities',activities);
end $$;
revoke all on function public.get_crm_lead_followup_context(uuid)from public;
grant execute on function public.get_crm_lead_followup_context(uuid)to authenticated;
notify pgrst,'reload schema';
