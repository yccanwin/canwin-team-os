-- CanWin Team OS 3.0 lead automation and server-generated action queues.
alter table public.crm_leads add column if not exists attention_status text not null default 'normal' check(attention_status in('normal','uncontacted_24h'));
alter table public.crm_leads add column if not exists nurture_until date;
alter table public.crm_leads add column if not exists nurture_round integer not null default 0 check(nurture_round>=0);
alter table public.crm_leads add column if not exists next_action_kind text not null default 'normal' check(next_action_kind in('normal','appointment'));
create unique index if not exists crm_leads_team_id_key on public.crm_leads(team_id,id);
alter table public.crm_leads drop constraint if exists crm_leads_status_check;
alter table public.crm_leads add constraint crm_leads_status_check check(status in('public','claimed','qualified','nurturing','supervisor_review','recycled','closed'));
alter table public.crm_opportunities add column if not exists decision_at timestamptz;

-- Public-pool contract fields; no owner id, raw phone, email or messaging id.
create or replace view public.crm_leads_visible with(security_invoker=true)as
select l.id,case when l.owner_id=auth.uid()then'mine'::text else'region'::text end read_scope,
 coalesce(s.name,l.title)store_name,c.name contact_name,null::text masked_phone,r.name district_name,s.business_type,l.source,l.created_at,l.next_action_at,
 case when l.status='qualified'then'qualified'when l.status='claimed'and l.last_effective_followup_at is not null then'contacted'else'new'end::text stage,
 coalesce((select array_agg(coalesce(f.new_business_fact,f.customer_commitment)order by f.occurred_at)from public.crm_followups f where f.lead_id=l.id and f.is_effective),array[]::text[])facts,
 l.status::text lead_status,p.name::text owner_display_name,(l.status='public'and l.owner_id is null)::boolean claimable
from public.crm_leads l left join public.crm_stores s on s.id=l.store_id and s.team_id=l.team_id join public.sales_regions r on r.id=l.region_id and r.team_id=l.team_id
left join public.profiles p on p.id=l.owner_id and p.team_id=l.team_id
left join lateral(select contact.name from public.crm_contacts contact where contact.team_id=l.team_id and(contact.store_id=l.store_id or(l.store_id is null and contact.brand_id=l.brand_id))order by contact.is_key_person desc,contact.created_at limit 1)c on true
where public.is_feature_enabled(l.team_id,'sales_os_v3')and public.crm_can_access_region(l.team_id,l.region_id,l.owner_id);

create table public.crm_contact_attempts(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),lead_id uuid not null,
 actor_id uuid not null references public.profiles(id),result text not null check(result in('reached','unreachable','no_answer')),
 note text,occurred_at timestamptz not null default now(),created_at timestamptz not null default now(),unique(team_id,id),
 foreign key(team_id,lead_id) references public.crm_leads(team_id,id)
);
create table public.crm_recycle_pauses(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),lead_id uuid not null,
 starts_at timestamptz not null default now(),ends_at timestamptz not null,reason text not null,created_by uuid not null references public.profiles(id),
 revoked_at timestamptz,created_at timestamptz not null default now(),unique(team_id,id),foreign key(team_id,lead_id) references public.crm_leads(team_id,id),
 check(ends_at>starts_at)
);
create table public.supervisor_exception_resolutions(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id),item_type text not null check(item_type in('action_exception','closing_opportunity')),
 entity_id uuid not null,owner_id uuid not null,resolution_due_at timestamptz not null,resolution_note text not null,resolved_by uuid not null references public.profiles(id),resolved_at timestamptz not null default now(),
 unique(team_id,id),foreign key(team_id,owner_id)references public.profiles(team_id,id)
);

create or replace function public.crm_lead_recycle_paused(p_team text,p_lead uuid,p_owner uuid,p_at timestamptz default now())
returns boolean language sql security definer stable set search_path='' as $$
 select exists(select 1 from public.crm_recycle_pauses p where p.team_id=p_team and p.lead_id=p_lead and p.revoked_at is null and p_at>=p.starts_at and p_at<p.ends_at)
 or(p_owner is not null and exists(select 1 from public.access_delegations d where d.team_id=p_team and d.delegator_id=p_owner and d.status='active' and p_at>=d.starts_at and p_at<d.ends_at))
$$;

create or replace function public.record_crm_contact_attempt(p_lead_id uuid,p_result text,p_note text default null,p_occurred_at timestamptz default now())
returns public.crm_contact_attempts language plpgsql security definer set search_path='' as $$
declare l public.crm_leads;r public.profiles;a public.crm_contact_attempts;
begin if p_result not in('reached','unreachable','no_answer') then raise exception 'INVALID_CONTACT_RESULT' using errcode='22023';end if;
 select * into r from public.profiles where id=auth.uid() and status='active';select * into l from public.crm_leads where id=p_lead_id for update;
 if l.id is null or r.id is null or l.team_id<>r.team_id then raise exception 'LEAD_NOT_FOUND' using errcode='P0002';end if;
 if not public.is_feature_enabled(l.team_id,'sales_os_v3') or not(l.owner_id=r.id or public.can_act_for(l.team_id,l.owner_id) or public.has_permission(l.team_id,'customers.supervise')) then raise exception 'CONTACT_ATTEMPT_FORBIDDEN' using errcode='42501';end if;
 insert into public.crm_contact_attempts(team_id,lead_id,actor_id,result,note,occurred_at)values(l.team_id,l.id,r.id,p_result,p_note,p_occurred_at)returning * into a;
 update public.crm_leads set last_contact_attempt_at=greatest(coalesce(last_contact_attempt_at,p_occurred_at),p_occurred_at),attention_status='normal',updated_at=now() where id=l.id;return a;end$$;

create or replace function public.pause_crm_lead_recycle(p_lead_id uuid,p_ends_at timestamptz,p_reason text)
returns public.crm_recycle_pauses language plpgsql security definer set search_path='' as $$
declare l public.crm_leads;r public.profiles;p public.crm_recycle_pauses;
begin if p_ends_at<=now() or nullif(trim(p_reason),'')is null then raise exception 'VALID_PAUSE_REQUIRED' using errcode='22023';end if;
 select * into r from public.profiles where id=auth.uid() and status='active';select * into l from public.crm_leads where id=p_lead_id;
 if l.id is null or r.id is null or l.team_id<>r.team_id or not public.is_feature_enabled(l.team_id,'sales_os_v3') or not(l.owner_id=r.id or public.has_permission(l.team_id,'customers.supervise'))then raise exception 'PAUSE_FORBIDDEN' using errcode='42501';end if;
 insert into public.crm_recycle_pauses(team_id,lead_id,ends_at,reason,created_by)values(l.team_id,l.id,p_ends_at,trim(p_reason),r.id)returning * into p;return p;end$$;

create or replace function public.decide_crm_nurture_review(p_lead_id uuid,p_approved boolean,p_note text default null)
returns public.crm_leads language plpgsql security definer set search_path='' as $$
declare l public.crm_leads;r public.profiles;today_cn date:=(now()at time zone'Asia/Shanghai')::date;
begin select * into r from public.profiles where id=auth.uid()and status='active';select * into l from public.crm_leads where id=p_lead_id for update;
 if l.id is null or r.id is null or l.team_id<>r.team_id then raise exception 'LEAD_NOT_FOUND' using errcode='P0002';end if;
 if not public.is_feature_enabled(l.team_id,'sales_os_v3')or not public.has_permission(l.team_id,'customers.supervise')then raise exception 'SUPERVISOR_REVIEW_FORBIDDEN' using errcode='42501';end if;
 if l.status<>'supervisor_review'or l.nurture_round<>1 then raise exception 'LEAD_NOT_PENDING_FIRST_REVIEW' using errcode='55000';end if;
 if p_approved then update public.crm_leads set status='nurturing',nurture_round=2,nurture_until=today_cn+30,updated_at=now()where id=l.id returning * into l;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,r.id,'lead.nurture_round2_approved','crm_lead',l.id,null,jsonb_build_object('note',p_note,'nurture_until',l.nurture_until));
 else insert into public.crm_owner_history(team_id,entity_type,entity_id,previous_owner_id,new_owner_id,reason,changed_by)values(l.team_id,'lead',l.id,l.owner_id,null,'nurture_review_rejected',r.id);
  update public.crm_leads set owner_id=null,status='public',claimed_at=null,nurture_until=null,updated_at=now()where id=l.id returning * into l;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,r.id,'lead.nurture_review_rejected','crm_lead',l.id,null,jsonb_build_object('note',p_note,'status','public'));
 end if;return l;end$$;

create or replace function public.run_sales_automation_batch(p_team_id text,p_now timestamptz default now())
returns table(marked_24h integer,recycled_48h integer,recycled_15d integer,nurtured_30d integer,review_pending integer,recycled_round2 integer)
language plpgsql security definer set search_path='' as $$
declare l public.crm_leads;today_cn date:=(p_now at time zone 'Asia/Shanghai')::date;
begin
 if current_setting('request.jwt.claim.role',true)<>'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 if not public.is_feature_enabled(p_team_id,'sales_os_v3') then raise exception 'SALES_OS_V3_DISABLED' using errcode='42501';end if;
 marked_24h:=0;recycled_48h:=0;recycled_15d:=0;nurtured_30d:=0;review_pending:=0;recycled_round2:=0;
 for l in select * from public.crm_leads where team_id=p_team_id and owner_id is not null and status='nurturing'and nurture_round=1 and nurture_until<=today_cn for update skip locked loop
  update public.crm_leads set status='supervisor_review',nurture_until=null,updated_at=p_now where id=l.id;review_pending:=review_pending+1;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,l.owner_id,'lead.nurture_round1_review','crm_lead',l.id,to_jsonb(l),jsonb_build_object('status','supervisor_review'));
 end loop;
 for l in select * from public.crm_leads where team_id=p_team_id and owner_id is not null and status='nurturing'and nurture_round=2 and nurture_until<=today_cn for update skip locked loop
  insert into public.crm_owner_history(team_id,entity_type,entity_id,previous_owner_id,new_owner_id,reason,changed_by)values(l.team_id,'lead',l.id,l.owner_id,null,'nurture_round2_expired',l.owner_id);
  update public.crm_leads set owner_id=null,status='public',claimed_at=null,nurture_until=null,updated_at=p_now where id=l.id;recycled_round2:=recycled_round2+1;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,l.owner_id,'lead.nurture_round2_expired','crm_lead',l.id,to_jsonb(l),jsonb_build_object('status','public'));
 end loop;
 update public.crm_leads set attention_status='uncontacted_24h',updated_at=p_now where team_id=p_team_id and owner_id is not null and last_contact_attempt_at is null
  and(created_at at time zone 'Asia/Shanghai')::date<=today_cn-1 and attention_status<>'uncontacted_24h';get diagnostics marked_24h=row_count;
 for l in select * from public.crm_leads where team_id=p_team_id and owner_id is not null and last_contact_attempt_at is null
   and(created_at at time zone 'Asia/Shanghai')::date<=today_cn-2 and not public.crm_lead_recycle_paused(team_id,id,owner_id,p_now) for update skip locked loop
  insert into public.crm_owner_history(team_id,entity_type,entity_id,previous_owner_id,new_owner_id,reason,changed_by)values(l.team_id,'lead',l.id,l.owner_id,null,'auto_recycle_48h',l.owner_id);
  update public.crm_leads set owner_id=null,status='public',claimed_at=null,attention_status='normal',updated_at=p_now where id=l.id;recycled_48h:=recycled_48h+1;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,l.owner_id,'lead.auto_recycled_48h','crm_lead',l.id,to_jsonb(l),jsonb_build_object('status','public'));
 end loop;
 for l in select * from public.crm_leads where team_id=p_team_id and owner_id is not null and status in('claimed','qualified')
   and(coalesce(last_effective_followup_at,claimed_at,created_at) at time zone 'Asia/Shanghai')::date<=today_cn-15
   and(select count(distinct(a.occurred_at at time zone 'Asia/Shanghai')::date)from public.crm_contact_attempts a where a.lead_id=crm_leads.id and a.team_id=crm_leads.team_id and a.result in('unreachable','no_answer'))<3
   and not public.crm_lead_recycle_paused(team_id,id,owner_id,p_now) for update skip locked loop
  insert into public.crm_owner_history(team_id,entity_type,entity_id,previous_owner_id,new_owner_id,reason,changed_by)values(l.team_id,'lead',l.id,l.owner_id,null,'auto_recycle_15d',l.owner_id);
  update public.crm_leads set owner_id=null,status='public',claimed_at=null,attention_status='normal',updated_at=p_now where id=l.id;recycled_15d:=recycled_15d+1;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,l.owner_id,'lead.auto_recycled_15d','crm_lead',l.id,to_jsonb(l),jsonb_build_object('status','public'));
 end loop;
 for l in select * from public.crm_leads where team_id=p_team_id and owner_id is not null and status not in('nurturing','supervisor_review','closed')and nurture_round<1
  and(select count(distinct(a.occurred_at at time zone 'Asia/Shanghai')::date)from public.crm_contact_attempts a where a.lead_id=crm_leads.id and a.team_id=crm_leads.team_id and a.result in('unreachable','no_answer'))>=3
  and not public.crm_lead_recycle_paused(team_id,id,owner_id,p_now) for update skip locked loop
  update public.crm_leads set status='nurturing',nurture_round=nurture_round+1,nurture_until=today_cn+30,updated_at=p_now where id=l.id;nurtured_30d:=nurtured_30d+1;
  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,l.owner_id,'lead.auto_nurtured_30d','crm_lead',l.id,to_jsonb(l),jsonb_build_object('nurture_until',today_cn+30));
 end loop;return next;end$$;

alter table public.crm_contact_attempts enable row level security;alter table public.crm_recycle_pauses enable row level security;
create policy "sales os v3 server gate" on public.crm_contact_attempts as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "sales os v3 server gate" on public.crm_recycle_pauses as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
create policy "lead actors read attempts" on public.crm_contact_attempts for select to authenticated using(exists(select 1 from public.crm_leads l where l.id=lead_id and l.team_id=team_id and(l.owner_id=auth.uid() or public.can_act_for(team_id,l.owner_id)or public.has_permission(team_id,'customers.supervise'))));
create policy "lead actors read pauses" on public.crm_recycle_pauses for select to authenticated using(exists(select 1 from public.crm_leads l where l.id=lead_id and l.team_id=team_id and(l.owner_id=auth.uid() or public.can_act_for(team_id,l.owner_id)or public.has_permission(team_id,'customers.supervise'))));

create or replace view public.crm_today_actions with(security_invoker=true)as
select l.team_id,l.owner_id,l.id entity_id,'lead'::text entity_type,
 case when l.next_action_kind='appointment'then'appointment'else'follow_up'end action_type,l.next_action_at due_at,l.title,
 case when l.next_action_at<now()then'overdue'else'today'end urgency
from public.crm_leads l where public.is_feature_enabled(l.team_id,'sales_os_v3')and l.owner_id is not null and(l.owner_id=auth.uid()or public.can_act_for(l.team_id,l.owner_id)or public.has_permission(l.team_id,'customers.supervise'))
 and l.next_action_at is not null and(l.next_action_at at time zone'Asia/Shanghai')::date<=(now()at time zone'Asia/Shanghai')::date
union all select l.team_id,l.owner_id,l.id,'lead',case when l.attention_status='uncontacted_24h'then'uncontacted_24h'else'new_lead'end,
 l.created_at,l.title,case when l.attention_status='uncontacted_24h'then'overdue'else'today'end
from public.crm_leads l where public.is_feature_enabled(l.team_id,'sales_os_v3')and l.owner_id is not null and(l.owner_id=auth.uid()or public.can_act_for(l.team_id,l.owner_id)or public.has_permission(l.team_id,'customers.supervise'))
 and l.last_contact_attempt_at is null and((l.created_at at time zone'Asia/Shanghai')::date=(now()at time zone'Asia/Shanghai')::date or l.attention_status='uncontacted_24h')
union all select l.team_id,l.owner_id,l.id,'lead','recycle_risk',
 (case when l.last_contact_attempt_at is null then((l.created_at at time zone'Asia/Shanghai')::date+2)else((coalesce(l.last_effective_followup_at,l.claimed_at,l.created_at)at time zone'Asia/Shanghai')::date+15)end::timestamp at time zone'Asia/Shanghai'),l.title,'today'
from public.crm_leads l where public.is_feature_enabled(l.team_id,'sales_os_v3')and l.owner_id is not null and(l.owner_id=auth.uid()or public.can_act_for(l.team_id,l.owner_id)or public.has_permission(l.team_id,'customers.supervise'))
 and not public.crm_lead_recycle_paused(l.team_id,l.id,l.owner_id,now())and(case when l.last_contact_attempt_at is null then(l.created_at at time zone'Asia/Shanghai')::date+2 else(coalesce(l.last_effective_followup_at,l.claimed_at,l.created_at)at time zone'Asia/Shanghai')::date+15 end)<=(now()at time zone'Asia/Shanghai')::date+1
union all select e.team_id,q.owner_id,e.id,'delivery_exception','delivery_exception',e.created_at,e.details,'overdue'
from public.fulfillment_exceptions e join public.fulfillment_deliveries d on d.id=e.delivery_id and d.team_id=e.team_id join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id
where e.status='open'and(q.owner_id=auth.uid()or public.can_act_for(e.team_id,q.owner_id)or public.has_permission(e.team_id,'customers.supervise'))
union all select rm.team_id,q.owner_id,rm.id,'renewal','renewal_'||rm.days_before,(rm.due_on::timestamp at time zone'Asia/Shanghai'),s.name,
 case when rm.due_on<(now()at time zone'Asia/Shanghai')::date then'overdue'else'today'end
from public.fulfillment_renewal_milestones rm join public.fulfillment_deliveries d on d.id=rm.delivery_id and d.team_id=rm.team_id join public.deal_orders o on o.id=d.order_id and o.team_id=d.team_id join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id join public.crm_stores s on s.id=d.store_id and s.team_id=d.team_id
where rm.status='pending'and rm.due_on<=(now()at time zone'Asia/Shanghai')::date and(q.owner_id=auth.uid()or public.can_act_for(rm.team_id,q.owner_id)or public.has_permission(rm.team_id,'customers.supervise'));

create or replace view public.crm_supervisor_exceptions with(security_invoker=true)as
select * from public.crm_today_actions a where public.has_permission(a.team_id,'customers.supervise')and a.due_at<case when a.action_type='appointment'or a.action_type like'renewal_%'then now()else now()-interval'48 hours'end;
create or replace view public.crm_supervisor_board with(security_invoker=true)as
select a.team_id,'action_exception'::text item_type,a.entity_id,a.owner_id,a.title,a.due_at,a.action_type details
from public.crm_supervisor_exceptions a
union all
select o.team_id,'closing_opportunity',o.id,o.owner_id,s.name,o.decision_at,'quoted_decision_0_7_days'
from public.crm_opportunities o join public.crm_stores s on s.id=o.store_id and s.team_id=o.team_id
where public.has_permission(o.team_id,'customers.supervise')and o.decision_at is not null
 and(o.decision_at at time zone'Asia/Shanghai')::date between(now()at time zone'Asia/Shanghai')::date and(now()at time zone'Asia/Shanghai')::date+7
 and exists(select 1 from public.deal_quotes q where q.team_id=o.team_id and q.opportunity_id=o.id and q.status in('submitted','approved','frozen'));

create or replace function public.resolve_supervisor_exception(p_item_type text,p_entity_id uuid,p_owner_id uuid,p_resolution_due_at timestamptz,p_resolution_note text)
returns public.supervisor_exception_resolutions language plpgsql security definer set search_path=''as$$
declare r public.profiles;x public.supervisor_exception_resolutions;
begin if p_item_type not in('action_exception','closing_opportunity')or p_resolution_due_at is null or nullif(trim(p_resolution_note),'')is null then raise exception'VALID_RESOLUTION_REQUIRED'using errcode='22023';end if;
 select*into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.is_feature_enabled(r.team_id,'sales_os_v3')or not public.has_permission(r.team_id,'customers.supervise')then raise exception'SUPERVISOR_REQUIRED'using errcode='42501';end if;
 if not exists(select 1 from public.crm_supervisor_board b where b.team_id=r.team_id and b.item_type=p_item_type and b.entity_id=p_entity_id and b.owner_id=p_owner_id)then raise exception'SUPERVISOR_ITEM_NOT_FOUND'using errcode='P0002';end if;
 insert into public.supervisor_exception_resolutions(team_id,item_type,entity_id,owner_id,resolution_due_at,resolution_note,resolved_by)values(r.team_id,p_item_type,p_entity_id,p_owner_id,p_resolution_due_at,trim(p_resolution_note),r.id)returning*into x;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(r.team_id,r.id,'supervisor.exception_resolved','supervisor_exception',x.id,to_jsonb(x));return x;end$$;

alter table public.supervisor_exception_resolutions enable row level security;
create policy"sales os v3 server gate"on public.supervisor_exception_resolutions as restrictive for all to authenticated using(public.is_feature_enabled(team_id,'sales_os_v3'))with check(public.is_feature_enabled(team_id,'sales_os_v3'));
create policy"supervisors read resolutions"on public.supervisor_exception_resolutions for select to authenticated using(public.has_permission(team_id,'customers.supervise'));
revoke all on public.crm_today_actions,public.crm_supervisor_exceptions,public.crm_supervisor_board from public,anon;grant select on public.crm_today_actions,public.crm_supervisor_exceptions,public.crm_supervisor_board to authenticated;
revoke all on function public.crm_lead_recycle_paused(text,uuid,uuid,timestamptz),public.record_crm_contact_attempt(uuid,text,text,timestamptz),public.pause_crm_lead_recycle(uuid,timestamptz,text),public.decide_crm_nurture_review(uuid,boolean,text),public.run_sales_automation_batch(text,timestamptz)from public;
grant execute on function public.crm_lead_recycle_paused(text,uuid,uuid,timestamptz),public.record_crm_contact_attempt(uuid,text,text,timestamptz),public.pause_crm_lead_recycle(uuid,timestamptz,text),public.decide_crm_nurture_review(uuid,boolean,text)to authenticated;
revoke all on function public.resolve_supervisor_exception(text,uuid,uuid,timestamptz,text)from public;grant execute on function public.resolve_supervisor_exception(text,uuid,uuid,timestamptz,text)to authenticated;
grant execute on function public.run_sales_automation_batch(text,timestamptz)to service_role;
notify pgrst,'reload schema';
