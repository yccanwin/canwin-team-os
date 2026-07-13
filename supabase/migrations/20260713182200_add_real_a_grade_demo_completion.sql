-- A-grade demo completion is a real audited server transition.
create or replace function public.complete_opportunity_demo(p_opportunity_id uuid)returns uuid
language plpgsql security definer set search_path=''as$$
declare r public.profiles;o public.crm_opportunities;before_at timestamptz;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into o from public.crm_opportunities where id=p_opportunity_id for update;
 if r.id is null or o.id is null or o.team_id<>r.team_id or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'customers.manage')or not(o.owner_id=r.id or public.can_act_for(r.team_id,o.owner_id)or public.has_permission(r.team_id,'customers.supervise'))then raise exception'DEMO_COMPLETE_FORBIDDEN'using errcode='42501';end if;
 if o.value_grade<>'A'or not o.qualification_valid or o.qualification_superseded_at is not null then raise exception'ACTIVE_A_OPPORTUNITY_REQUIRED'using errcode='23514';end if;
 before_at:=o.demo_completed_at;update public.crm_opportunities set demo_completed_at=coalesce(demo_completed_at,now()),stage=case when stage='discovery'then'demo'else stage end,updated_at=now()where id=o.id returning*into o;
 if before_at is null then insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(o.team_id,r.id,'crm.opportunity_demo_completed','crm_opportunity',o.id,jsonb_build_object('demo_completed_at',before_at),jsonb_build_object('demo_completed_at',o.demo_completed_at));end if;return o.id;
end$$;
revoke all on function public.complete_opportunity_demo(uuid)from public,anon;grant execute on function public.complete_opportunity_demo(uuid)to authenticated;notify pgrst,'reload schema';
