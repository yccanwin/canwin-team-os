-- CanWin Team OS 3.0 access administration operations.
-- Additive only. All mutations are admin RPCs with idempotency and audit logs.

insert into public.access_permissions(code,name,description) values
 ('customers.export','Export customer archive','Export customer data in bulk'),
 ('sales.margin.read_team','Read subordinate margins','Read sales margins for assigned subordinates'),
 ('profit.summary.read','Read company profit summary','Read company-level actual and forecast profit')
on conflict(code)do update set name=excluded.name,description=excluded.description;

insert into public.access_role_permissions(role_id,permission_code)
select ar.id,m.permission_code from public.access_roles ar join(values
 ('owner','profit.summary.read'),
 ('admin','customers.export'),
 ('supervisor','customers.export'),
 ('supervisor','sales.margin.read_team'),
 ('finance','profit.summary.read')
)m(role_code,permission_code)on m.role_code=ar.code
on conflict do nothing;

create table public.team_invitations(
 id uuid primary key default gen_random_uuid(),
 team_id text not null references public.teams(id)on delete cascade,
 email text not null,
 display_name text not null,
 role_codes text[]not null default'{}',
 status text not null default'pending'check(status in('pending','accepted','cancelled','expired')),
 invited_by uuid not null references public.profiles(id)on delete restrict,
 invited_at timestamptz not null default now(),
 accepted_by uuid references public.profiles(id)on delete set null,
 accepted_at timestamptz,
 cancelled_by uuid references public.profiles(id)on delete set null,
 cancelled_at timestamptz,
 check(email=lower(trim(email))),
 check(cardinality(role_codes)>0),
 check((status='accepted')=(accepted_at is not null)),
 unique(team_id,email,status)
);

create table public.access_admin_requests(
 team_id text not null references public.teams(id)on delete cascade,
 idempotency_key uuid not null,
 action text not null,
 payload jsonb not null,
 result jsonb not null,
 actor_id uuid not null references public.profiles(id)on delete restrict,
 created_at timestamptz not null default now(),
 primary key(team_id,idempotency_key)
);

alter table public.team_invitations enable row level security;
alter table public.access_admin_requests enable row level security;
alter table public.crm_owner_history drop constraint if exists crm_owner_history_entity_type_check;
alter table public.crm_owner_history add constraint crm_owner_history_entity_type_check
 check(entity_type in('brand','store','contact','lead','opportunity'));
create policy "access managers read invitations"on public.team_invitations for select to authenticated
 using(public.has_permission(team_id,'access.manage'));
create policy "access managers read own requests"on public.access_admin_requests for select to authenticated
 using(actor_id=auth.uid()and public.has_permission(team_id,'access.manage'));

create or replace function public.get_access_admin_snapshot()
returns jsonb language plpgsql security definer stable set search_path='' as $$
declare r public.profiles;out jsonb;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';
 if r.id is null or not public.has_permission(r.team_id,'access.manage')then raise exception'ACCESS_ADMIN_REQUIRED'using errcode='42501';end if;
 select jsonb_build_object(
  'currentUserIsAdmin',true,
  'featureFlags',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'key',f.key,'description',coalesce(f.description,''),'enabled',f.enabled)order by f.key),'[]'::jsonb)from public.feature_flags f where f.team_id=r.team_id),
  'members',(select coalesce(jsonb_agg(jsonb_build_object(
   'id',p.id,'name',p.name,'position',coalesce(p.position,''),'status',p.status,
   'roles',coalesce((select jsonb_agg(jsonb_build_object('id',ar.id,'code',ar.code,'name',ar.name)order by ar.name)from public.profile_access_roles par join public.access_roles ar on ar.id=par.role_id where par.team_id=p.team_id and par.profile_id=p.id),'[]'::jsonb),
   'regions',coalesce((select jsonb_agg(jsonb_build_object('id',sr.id,'code',sr.code,'name',sr.name,'primary',psr.is_primary)order by psr.is_primary desc,sr.name)from public.profile_sales_regions psr join public.sales_regions sr on sr.id=psr.region_id where psr.team_id=p.team_id and psr.profile_id=p.id),'[]'::jsonb)
  )order by(p.status='active')desc,p.name),'[]'::jsonb)from public.profiles p where p.team_id=r.team_id),
  'roles',(select coalesce(jsonb_agg(jsonb_build_object('id',ar.id,'code',ar.code,'name',ar.name,'description',coalesce(ar.description,''))order by ar.name),'[]'::jsonb)from public.access_roles ar where ar.team_id=r.team_id),
  'invitations',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'email',i.email,'displayName',i.display_name,'roleCodes',i.role_codes,'status',i.status,'invitedAt',i.invited_at)order by i.invited_at desc),'[]'::jsonb)from public.team_invitations i where i.team_id=r.team_id and i.status='pending'),
  'delegations',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'delegatorId',d.delegator_id,'delegateId',d.delegate_id,'startsAt',d.starts_at,'endsAt',d.ends_at,'reason',d.reason,'status',d.status)order by d.created_at desc),'[]'::jsonb)from public.access_delegations d where d.team_id=r.team_id and d.status='active'),
  'supervisorAssignments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'supervisorId',a.supervisor_id,'subordinateId',a.subordinate_id,'startsOn',a.starts_on,'endsOn',a.ends_on)order by a.created_at desc),'[]'::jsonb)from public.performance_supervisor_assignments a where a.team_id=r.team_id and(a.ends_on is null or a.ends_on>=current_date)),
  'sensitiveRules',jsonb_build_array(
   jsonb_build_object('key','customer_phone','label','客户电话','rule','本人/临时代理，或客户敏感信息权限'),
   jsonb_build_object('key','sales_margin','label','销售价差','rule','销售本人、明确绑定的直属主管、财务'),
   jsonb_build_object('key','company_profit','label','公司利润','rule','老板仅看汇总；财务可看财务明细'),
   jsonb_build_object('key','customer_export','label','客户批量导出','rule','管理员或主管；普通销售无权限')
  )
 )into out;
 return out;
end$$;

create or replace function public.admin_replace_profile_roles(p_profile_id uuid,p_role_codes text[],p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.profiles;t public.profiles;roles text[];payload jsonb;old jsonb;out jsonb;prior public.access_admin_requests;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into t from public.profiles where id=p_profile_id;
 if r.id is null or t.id is null or r.team_id<>t.team_id or not public.has_permission(r.team_id,'access.manage')then raise exception'ACCESS_ADMIN_REQUIRED'using errcode='42501';end if;
 if p_idempotency_key is null then raise exception'IDEMPOTENCY_KEY_REQUIRED'using errcode='22023';end if;
 select coalesce(array_agg(distinct x order by x),'{}')into roles from unnest(coalesce(p_role_codes,'{}'))x;
 if cardinality(roles)=0 or(select count(*)from public.access_roles where team_id=r.team_id and code=any(roles))<>cardinality(roles)then raise exception'INVALID_ROLE_SET'using errcode='23514';end if;
 payload:=jsonb_build_object('profileId',t.id,'roleCodes',roles);
 select*into prior from public.access_admin_requests where team_id=r.team_id and idempotency_key=p_idempotency_key;
 if prior.idempotency_key is not null then if prior.action<>'profile.roles.replace'or prior.payload<>payload then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return prior.result;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.team_id,617));
 select coalesce(jsonb_agg(ar.code order by ar.code),'[]')into old from public.profile_access_roles par join public.access_roles ar on ar.id=par.role_id where par.team_id=r.team_id and par.profile_id=t.id;
 delete from public.profile_access_roles where team_id=r.team_id and profile_id=t.id;
 insert into public.profile_access_roles(team_id,profile_id,role_id,assigned_by)select r.team_id,t.id,ar.id,r.id from public.access_roles ar where ar.team_id=r.team_id and ar.code=any(roles);
 out:=jsonb_build_object('profileId',t.id,'roleCodes',roles);
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(r.team_id,r.id,'profile.roles_replaced','profile',t.id,jsonb_build_object('roleCodes',old),out);
 insert into public.access_admin_requests values(r.team_id,p_idempotency_key,'profile.roles.replace',payload,out,r.id,now());return out;
end$$;

create or replace function public.admin_create_team_invitation(p_email text,p_display_name text,p_role_codes text[],p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.profiles;mail text:=lower(trim(p_email));roles text[];payload jsonb;out jsonb;prior public.access_admin_requests;i public.team_invitations;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.has_permission(r.team_id,'access.manage')then raise exception'ACCESS_ADMIN_REQUIRED'using errcode='42501';end if;
 if p_idempotency_key is null or mail!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'or nullif(trim(p_display_name),'')is null then raise exception'INVALID_INVITATION'using errcode='22023';end if;
 select coalesce(array_agg(distinct x order by x),'{}')into roles from unnest(coalesce(p_role_codes,'{}'))x;
 if cardinality(roles)=0 or(select count(*)from public.access_roles where team_id=r.team_id and code=any(roles))<>cardinality(roles)then raise exception'INVALID_ROLE_SET'using errcode='23514';end if;
 payload:=jsonb_build_object('email',mail,'displayName',trim(p_display_name),'roleCodes',roles);select*into prior from public.access_admin_requests where team_id=r.team_id and idempotency_key=p_idempotency_key;
 if prior.idempotency_key is not null then if prior.action<>'invitation.create'or prior.payload<>payload then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return prior.result;end if;
 insert into public.team_invitations(team_id,email,display_name,role_codes,invited_by)values(r.team_id,mail,trim(p_display_name),roles,r.id)returning*into i;
 out:=jsonb_build_object('id',i.id,'email',i.email,'status',i.status,'roleCodes',i.role_codes);
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(r.team_id,r.id,'invitation.created','team_invitation',i.id,out);
 insert into public.access_admin_requests values(r.team_id,p_idempotency_key,'invitation.create',payload,out,r.id,now());return out;
end$$;

create or replace function public.admin_set_profile_status(p_profile_id uuid,p_status text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.profiles;t public.profiles;payload jsonb;out jsonb;prior public.access_admin_requests;owned integer;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into t from public.profiles where id=p_profile_id for update;
 if r.id is null or t.id is null or r.team_id<>t.team_id or not public.has_permission(r.team_id,'access.manage')then raise exception'ACCESS_ADMIN_REQUIRED'using errcode='42501';end if;
 if p_status not in('active','disabled')or p_idempotency_key is null or(t.id=r.id and p_status='disabled')then raise exception'INVALID_PROFILE_STATUS'using errcode='22023';end if;
 payload:=jsonb_build_object('profileId',t.id,'status',p_status);select*into prior from public.access_admin_requests where team_id=r.team_id and idempotency_key=p_idempotency_key;
 if prior.idempotency_key is not null then if prior.action<>'profile.status.set'or prior.payload<>payload then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return prior.result;end if;
 if p_status='disabled'then
  if exists(select 1 from public.profile_access_roles par join public.access_roles ar on ar.id=par.role_id where par.team_id=r.team_id and par.profile_id=t.id and ar.code='admin')and not exists(select 1 from public.profile_access_roles par join public.access_roles ar on ar.id=par.role_id join public.profiles p on p.id=par.profile_id where par.team_id=r.team_id and par.profile_id<>t.id and ar.code='admin'and p.status='active')then raise exception'LAST_ADMIN_REQUIRED'using errcode='23514';end if;
  select(select count(*)from public.crm_brands where team_id=r.team_id and owner_id=t.id)+(select count(*)from public.crm_stores where team_id=r.team_id and owner_id=t.id)+(select count(*)from public.crm_contacts where team_id=r.team_id and owner_id=t.id)+(select count(*)from public.crm_leads where team_id=r.team_id and owner_id=t.id)+(select count(*)from public.crm_opportunities where team_id=r.team_id and owner_id=t.id)into owned;if owned>0 then raise exception'REASSIGN_CUSTOMERS_FIRST'using errcode='55000';end if;
 end if;
 update public.profiles set status=p_status,updated_at=now()where id=t.id;
 if p_status='disabled'then update public.access_delegations set status='revoked',revoked_at=now(),revoked_by=r.id,updated_at=now()where team_id=r.team_id and status='active'and(delegator_id=t.id or delegate_id=t.id);end if;
 out:=jsonb_build_object('profileId',t.id,'status',p_status);insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(r.team_id,r.id,'profile.status_set','profile',t.id,jsonb_build_object('status',t.status),out);
 insert into public.access_admin_requests values(r.team_id,p_idempotency_key,'profile.status.set',payload,out,r.id,now());return out;
end$$;

create or replace function public.admin_create_delegation(p_delegator_id uuid,p_delegate_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.profiles;payload jsonb;out jsonb;prior public.access_admin_requests;d public.access_delegations;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.has_permission(r.team_id,'access.manage')then raise exception'ACCESS_ADMIN_REQUIRED'using errcode='42501';end if;
 if p_idempotency_key is null or p_delegator_id=p_delegate_id or p_ends_at<=p_starts_at or nullif(trim(p_reason),'')is null or not exists(select 1 from public.profiles where id=p_delegator_id and team_id=r.team_id and status='active')or not exists(select 1 from public.profiles where id=p_delegate_id and team_id=r.team_id and status='active')then raise exception'INVALID_DELEGATION'using errcode='22023';end if;
 payload:=jsonb_build_object('delegatorId',p_delegator_id,'delegateId',p_delegate_id,'startsAt',p_starts_at,'endsAt',p_ends_at,'reason',trim(p_reason));select*into prior from public.access_admin_requests where team_id=r.team_id and idempotency_key=p_idempotency_key;
 if prior.idempotency_key is not null then if prior.action<>'delegation.create'or prior.payload<>payload then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return prior.result;end if;
 if exists(select 1 from public.access_delegations where team_id=r.team_id and delegator_id=p_delegator_id and delegate_id=p_delegate_id and status='active'and tstzrange(starts_at,ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)'))then raise exception'DELEGATION_OVERLAP'using errcode='23P01';end if;
 insert into public.access_delegations(team_id,delegator_id,delegate_id,starts_at,ends_at,reason,created_by)values(r.team_id,p_delegator_id,p_delegate_id,p_starts_at,p_ends_at,trim(p_reason),r.id)returning*into d;
 out:=jsonb_build_object('id',d.id,'status',d.status);insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(r.team_id,r.id,'delegation.created','access_delegation',d.id,to_jsonb(d));insert into public.access_admin_requests values(r.team_id,p_idempotency_key,'delegation.create',payload,out,r.id,now());return out;
end$$;

create or replace function public.admin_replace_supervisor_subordinates(p_supervisor_id uuid,p_subordinate_ids uuid[],p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.profiles;subs uuid[];payload jsonb;out jsonb;prior public.access_admin_requests;old jsonb;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.has_permission(r.team_id,'access.manage')then raise exception'ACCESS_ADMIN_REQUIRED'using errcode='42501';end if;
 select coalesce(array_agg(distinct x order by x),'{}')into subs from unnest(coalesce(p_subordinate_ids,'{}'))x;
 if p_idempotency_key is null or p_supervisor_id=any(subs)or not exists(select 1 from public.profiles where id=p_supervisor_id and team_id=r.team_id and status='active')or(select count(*)from public.profiles where team_id=r.team_id and status='active'and id=any(subs))<>cardinality(subs)then raise exception'INVALID_SUPERVISOR_ASSIGNMENT'using errcode='23514';end if;
 payload:=jsonb_build_object('supervisorId',p_supervisor_id,'subordinateIds',subs);select*into prior from public.access_admin_requests where team_id=r.team_id and idempotency_key=p_idempotency_key;
 if prior.idempotency_key is not null then if prior.action<>'supervisor.subordinates.replace'or prior.payload<>payload then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return prior.result;end if;
 select coalesce(jsonb_agg(subordinate_id),'[]')into old from public.performance_supervisor_assignments where team_id=r.team_id and supervisor_id=p_supervisor_id and(ends_on is null or ends_on>=current_date);
 delete from public.performance_supervisor_assignments where team_id=r.team_id and supervisor_id=p_supervisor_id and starts_on>=current_date;
 update public.performance_supervisor_assignments set ends_on=current_date-1 where team_id=r.team_id and supervisor_id=p_supervisor_id and starts_on<current_date and(ends_on is null or ends_on>=current_date);
 insert into public.performance_supervisor_assignments(team_id,supervisor_id,subordinate_id,starts_on,created_by)select r.team_id,p_supervisor_id,x,current_date,r.id from unnest(subs)x;
 out:=payload;insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(r.team_id,r.id,'supervisor.subordinates_replaced','profile',p_supervisor_id,jsonb_build_object('subordinateIds',old),out);insert into public.access_admin_requests values(r.team_id,p_idempotency_key,'supervisor.subordinates.replace',payload,out,r.id,now());return out;
end$$;

create or replace function public.admin_reassign_crm_ownership(p_from_profile_id uuid,p_to_profile_id uuid,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.profiles;payload jsonb;out jsonb;prior public.access_admin_requests;counts jsonb:='{}';rec record;n integer;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';if r.id is null or not public.has_permission(r.team_id,'access.manage')then raise exception'ACCESS_ADMIN_REQUIRED'using errcode='42501';end if;
 if p_idempotency_key is null or p_from_profile_id=p_to_profile_id or nullif(trim(p_reason),'')is null or not exists(select 1 from public.profiles where id=p_from_profile_id and team_id=r.team_id)or not exists(select 1 from public.profiles where id=p_to_profile_id and team_id=r.team_id and status='active')then raise exception'INVALID_REASSIGNMENT'using errcode='22023';end if;
 payload:=jsonb_build_object('fromProfileId',p_from_profile_id,'toProfileId',p_to_profile_id,'reason',trim(p_reason));select*into prior from public.access_admin_requests where team_id=r.team_id and idempotency_key=p_idempotency_key;
 if prior.idempotency_key is not null then if prior.action<>'crm.ownership.reassign'or prior.payload<>payload then raise exception'IDEMPOTENCY_KEY_CONFLICT'using errcode='23505';end if;return prior.result;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(r.team_id,618));
 for rec in select'brand'::text kind,id from public.crm_brands where team_id=r.team_id and owner_id=p_from_profile_id union all select'store',id from public.crm_stores where team_id=r.team_id and owner_id=p_from_profile_id union all select'contact',id from public.crm_contacts where team_id=r.team_id and owner_id=p_from_profile_id union all select'lead',id from public.crm_leads where team_id=r.team_id and owner_id=p_from_profile_id union all select'opportunity',id from public.crm_opportunities where team_id=r.team_id and owner_id=p_from_profile_id loop insert into public.crm_owner_history(team_id,entity_type,entity_id,previous_owner_id,new_owner_id,reason,changed_by)values(r.team_id,rec.kind,rec.id,p_from_profile_id,p_to_profile_id,trim(p_reason),r.id);end loop;
 update public.crm_brands set owner_id=p_to_profile_id,updated_at=now()where team_id=r.team_id and owner_id=p_from_profile_id;get diagnostics n=row_count;counts:=counts||jsonb_build_object('brands',n);
 update public.crm_stores set owner_id=p_to_profile_id,updated_at=now()where team_id=r.team_id and owner_id=p_from_profile_id;get diagnostics n=row_count;counts:=counts||jsonb_build_object('stores',n);
 update public.crm_contacts set owner_id=p_to_profile_id,updated_at=now()where team_id=r.team_id and owner_id=p_from_profile_id;get diagnostics n=row_count;counts:=counts||jsonb_build_object('contacts',n);
 update public.crm_leads set owner_id=p_to_profile_id,updated_at=now()where team_id=r.team_id and owner_id=p_from_profile_id;get diagnostics n=row_count;counts:=counts||jsonb_build_object('leads',n);
 update public.crm_opportunities set owner_id=p_to_profile_id,updated_at=now()where team_id=r.team_id and owner_id=p_from_profile_id;get diagnostics n=row_count;counts:=counts||jsonb_build_object('opportunities',n);
 out:=payload||jsonb_build_object('counts',counts);insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,after_data)values(r.team_id,r.id,'crm.ownership_reassigned','profile',p_from_profile_id,out);insert into public.access_admin_requests values(r.team_id,p_idempotency_key,'crm.ownership.reassign',payload,out,r.id,now());return out;
end$$;

revoke all on function public.get_access_admin_snapshot(),public.admin_replace_profile_roles(uuid,text[],uuid),public.admin_create_team_invitation(text,text,text[],uuid),public.admin_set_profile_status(uuid,text,uuid),public.admin_create_delegation(uuid,uuid,timestamptz,timestamptz,text,uuid),public.admin_replace_supervisor_subordinates(uuid,uuid[],uuid),public.admin_reassign_crm_ownership(uuid,uuid,text,uuid)from public,anon;
grant execute on function public.get_access_admin_snapshot(),public.admin_replace_profile_roles(uuid,text[],uuid),public.admin_create_team_invitation(text,text,text[],uuid),public.admin_set_profile_status(uuid,text,uuid),public.admin_create_delegation(uuid,uuid,timestamptz,timestamptz,text,uuid),public.admin_replace_supervisor_subordinates(uuid,uuid[],uuid),public.admin_reassign_crm_ownership(uuid,uuid,text,uuid)to authenticated;
notify pgrst,'reload schema';
