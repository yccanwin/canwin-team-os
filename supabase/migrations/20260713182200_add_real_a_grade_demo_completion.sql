-- A-grade demo completion is a real audited server transition.
create or replace function public.complete_opportunity_demo(p_opportunity_id uuid)returns uuid
language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles;v_opportunity public.crm_opportunities;v_before_at timestamptz;
begin
 select pr.* into v_profile from public.profiles as pr where pr.id=auth.uid()and pr.status='active';
 select opp.* into v_opportunity from public.crm_opportunities as opp where opp.id=p_opportunity_id for update;
 if v_profile.id is null or v_opportunity.id is null or v_opportunity.team_id<>v_profile.team_id or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')or not public.has_permission(v_profile.team_id,'customers.manage')or not(v_opportunity.owner_id=v_profile.id or public.can_act_for(v_profile.team_id,v_opportunity.owner_id)or public.has_permission(v_profile.team_id,'customers.supervise'))then raise exception'DEMO_COMPLETE_FORBIDDEN'using errcode='42501';end if;
 if v_opportunity.value_grade<>'A'or not v_opportunity.qualification_valid or v_opportunity.qualification_superseded_at is not null then raise exception'ACTIVE_A_OPPORTUNITY_REQUIRED'using errcode='23514';end if;
 v_before_at:=v_opportunity.demo_completed_at;
 update public.crm_opportunities as opp set demo_completed_at=coalesce(opp.demo_completed_at,now()),stage=case when opp.stage='discovery'then'demo'else opp.stage end,updated_at=now()where opp.id=v_opportunity.id returning opp.* into v_opportunity;
 if v_before_at is null then insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(v_opportunity.team_id,v_profile.id,'crm.opportunity_demo_completed','crm_opportunity',v_opportunity.id,jsonb_build_object('demo_completed_at',v_before_at),jsonb_build_object('demo_completed_at',v_opportunity.demo_completed_at));end if;return v_opportunity.id;
end$$;
revoke all on function public.complete_opportunity_demo(uuid)from public,anon;grant execute on function public.complete_opportunity_demo(uuid)to authenticated;notify pgrst,'reload schema';
