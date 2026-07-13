-- Convert a qualified-by-facts lead into customer entities without deleting lead history.
create table public.crm_lead_conversions(
 id uuid primary key default gen_random_uuid(),team_id text not null references public.teams(id)on delete cascade,
 lead_id uuid not null references public.crm_leads(id)on delete restrict,brand_id uuid not null references public.crm_brands(id)on delete restrict,
 store_id uuid not null references public.crm_stores(id)on delete restrict,contact_id uuid not null references public.crm_contacts(id)on delete restrict,
 converted_by uuid not null references public.profiles(id)on delete restrict,converted_at timestamptz not null default now(),unique(lead_id)
);
alter table public.crm_lead_conversions enable row level security;

create or replace function public.precheck_crm_lead_conversion(p_lead_id uuid,p_brand_name text,p_store_name text)returns jsonb
language plpgsql security definer stable set search_path='' as $$
declare r public.profiles;l public.crm_leads;v_phone text;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into l from public.crm_leads where id=p_lead_id;
 if r.id is null or l.id is null or l.team_id<>r.team_id then raise exception'LEAD_NOT_FOUND'using errcode='P0002';end if;
 if not public.is_feature_enabled(l.team_id,'sales_os_v3')or not public.has_permission(l.team_id,'customers.manage')or l.owner_id<>r.id or not public.crm_can_access_region(l.team_id,l.region_id,l.owner_id)then raise exception'LEAD_CONVERSION_FORBIDDEN'using errcode='42501';end if;
 if l.last_effective_followup_at is null then raise exception'EFFECTIVE_FOLLOWUP_REQUIRED'using errcode='55000';end if;
 select p.phone into v_phone from public.crm_lead_private p where p.lead_id=l.id and p.team_id=l.team_id;
 return jsonb_build_object(
  'brand_matches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'business_mode',b.business_mode))from public.crm_brands b where b.team_id=l.team_id and b.normalized_name=lower(trim(p_brand_name))),'[]'::jsonb),
  'store_matches',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'brand_id',s.brand_id))from public.crm_stores s where s.team_id=l.team_id and s.region_id=l.region_id and s.normalized_name=lower(trim(p_store_name))),'[]'::jsonb),
  'contact_matches',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'brand_id',c.brand_id,'store_id',c.store_id))from public.crm_contact_private cp join public.crm_contacts c on c.id=cp.contact_id and c.team_id=cp.team_id where cp.team_id=l.team_id and regexp_replace(cp.phone,'\D','','g')=regexp_replace(v_phone,'\D','','g')),'[]'::jsonb)
 );
end$$;

create or replace function public.convert_crm_lead_to_customer(
 p_lead_id uuid,p_brand_id uuid,p_brand_name text,p_business_mode text,p_store_id uuid,p_store_name text,p_business_type text,p_address text,
 p_contact_id uuid,p_contact_name text,p_contact_title text,p_is_key_person boolean default false
)returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.profiles;l public.crm_leads;b public.crm_brands;s public.crm_stores;c public.crm_contacts;cv public.crm_lead_conversions;v_phone text;store_owner uuid;phone_matches integer;
begin
 select*into r from public.profiles where id=auth.uid()and status='active';select*into l from public.crm_leads where id=p_lead_id for update;
 if r.id is null or l.id is null or l.team_id<>r.team_id then raise exception'LEAD_NOT_FOUND'using errcode='P0002';end if;
 if not public.is_feature_enabled(l.team_id,'sales_os_v3')or not public.has_permission(l.team_id,'customers.manage')or l.owner_id<>r.id or not public.crm_can_access_region(l.team_id,l.region_id,l.owner_id)then raise exception'LEAD_CONVERSION_FORBIDDEN'using errcode='42501';end if;
 if l.last_effective_followup_at is null then raise exception'EFFECTIVE_FOLLOWUP_REQUIRED'using errcode='55000';end if;
 select*into cv from public.crm_lead_conversions where lead_id=l.id;if cv.id is not null then return jsonb_build_object('conversion_id',cv.id,'brand_id',cv.brand_id,'store_id',cv.store_id,'contact_id',cv.contact_id,'idempotent',true);end if;
 if nullif(trim(p_brand_name),'')is null or nullif(trim(p_store_name),'')is null or nullif(trim(p_contact_name),'')is null or p_business_mode not in('independent','direct_chain','franchise_chain')or p_business_type not in('fast_food','chinese','hotpot','barbecue','beverage','bakery','banquet','international')then raise exception'INVALID_CONVERSION_INPUT'using errcode='22023';end if;
 select p.phone into v_phone from public.crm_lead_private p where p.lead_id=l.id and p.team_id=l.team_id;if nullif(trim(v_phone),'')is null then raise exception'LEAD_PHONE_REQUIRED'using errcode='22023';end if;
 if p_brand_id is not null then select*into b from public.crm_brands where id=p_brand_id and team_id=l.team_id for update;if b.id is null then raise exception'BRAND_NOT_FOUND'using errcode='P0002';end if;
 else select*into b from public.crm_brands where team_id=l.team_id and normalized_name=lower(trim(p_brand_name))for update;if b.id is null then insert into public.crm_brands(team_id,name,business_mode,owner_id,created_by)values(l.team_id,trim(p_brand_name),p_business_mode,r.id,r.id)returning*into b;insert into public.crm_owner_history(team_id,entity_type,entity_id,previous_owner_id,new_owner_id,reason,changed_by)values(l.team_id,'brand',b.id,null,r.id,'lead_conversion_created',r.id);end if;end if;
 if b.owner_id is distinct from r.id and not public.has_permission(l.team_id,'customers.supervise')then raise exception'BRAND_OWNER_REQUIRED'using errcode='42501';end if;
 store_owner:=case when b.business_mode='direct_chain'then coalesce(b.owner_id,r.id)else r.id end;
 if p_store_id is not null then select*into s from public.crm_stores where id=p_store_id and team_id=l.team_id and region_id=l.region_id for update;if s.id is null or s.brand_id is distinct from b.id then raise exception'STORE_CONTEXT_MISMATCH'using errcode='22023';end if;if s.owner_id is distinct from r.id and not public.has_permission(l.team_id,'customers.supervise')then raise exception'STORE_OWNER_REQUIRED'using errcode='42501';end if;
 else select*into s from public.crm_stores where team_id=l.team_id and region_id=l.region_id and normalized_name=lower(trim(p_store_name))for update;if s.id is not null and s.brand_id is distinct from b.id then raise exception'STORE_DUPLICATE_OTHER_BRAND'using errcode='23505';end if;if s.id is null then insert into public.crm_stores(team_id,brand_id,region_id,name,address,business_type,owner_id,created_by)values(l.team_id,b.id,l.region_id,trim(p_store_name),nullif(trim(p_address),''),p_business_type,store_owner,r.id)returning*into s;insert into public.crm_owner_history(team_id,entity_type,entity_id,previous_owner_id,new_owner_id,reason,changed_by)values(l.team_id,'store',s.id,null,store_owner,'lead_conversion_created',r.id);end if;end if;
 if p_contact_id is not null then select*into c from public.crm_contacts where id=p_contact_id and team_id=l.team_id for update;if c.id is null or c.store_id is distinct from s.id then raise exception'CONTACT_CONTEXT_MISMATCH'using errcode='22023';end if;
 else select count(*),(array_agg(cp.contact_id))[1]into phone_matches,c.id from public.crm_contact_private cp where cp.team_id=l.team_id and regexp_replace(cp.phone,'\D','','g')=regexp_replace(v_phone,'\D','','g');if phone_matches>1 then raise exception'CONTACT_PHONE_AMBIGUOUS'using errcode='23505';end if;if c.id is not null then select*into c from public.crm_contacts where id=c.id for update;if c.store_id is distinct from s.id then raise exception'CONTACT_PHONE_CONTEXT_MISMATCH'using errcode='23505';end if;else insert into public.crm_contacts(team_id,brand_id,store_id,name,title,is_key_person,owner_id,created_by)values(l.team_id,b.id,s.id,trim(p_contact_name),nullif(trim(p_contact_title),''),p_is_key_person,store_owner,r.id)returning*into c;insert into public.crm_contact_private(contact_id,team_id,phone,updated_by)values(c.id,l.team_id,v_phone,r.id);end if;end if;
 update public.crm_leads set brand_id=b.id,store_id=s.id,updated_at=now()where id=l.id;
 insert into public.crm_lead_conversions(team_id,lead_id,brand_id,store_id,contact_id,converted_by)values(l.team_id,l.id,b.id,s.id,c.id,r.id)returning*into cv;
 insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)values(l.team_id,r.id,'crm.lead_converted','crm_lead',l.id,jsonb_build_object('brand_id',l.brand_id,'store_id',l.store_id),jsonb_build_object('brand_id',b.id,'store_id',s.id,'contact_id',c.id,'conversion_id',cv.id));
 return jsonb_build_object('conversion_id',cv.id,'brand_id',b.id,'store_id',s.id,'contact_id',c.id,'idempotent',false);
end$$;
revoke all on public.crm_lead_conversions from public,anon;
revoke all on function public.precheck_crm_lead_conversion(uuid,text,text),public.convert_crm_lead_to_customer(uuid,uuid,text,text,uuid,text,text,text,uuid,text,text,boolean)from public;
grant execute on function public.precheck_crm_lead_conversion(uuid,text,text),public.convert_crm_lead_to_customer(uuid,uuid,text,text,uuid,text,text,text,uuid,text,text,boolean)to authenticated;
notify pgrst,'reload schema';
