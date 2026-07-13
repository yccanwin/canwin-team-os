-- C2: server-owned special quote marker and approval state read model.
-- This migration does not create orders or reserve inventory.

alter table public.deal_quotes
  add column if not exists special_content text;

create or replace function public.set_deal_quote_special_content(
  p_quote_id uuid,
  p_special_content text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
  v_profile public.profiles;
  v_quote public.deal_quotes;
  v_has_special boolean;
begin
  select pr.* into v_profile
  from public.profiles as pr
  where pr.id=auth.uid() and pr.status='active';

  select dq.* into v_quote
  from public.deal_quotes as dq
  where dq.id=p_quote_id
  for update;

  if v_profile.id is null or v_quote.id is null or v_quote.team_id<>v_profile.team_id then
    raise exception 'QUOTE_NOT_FOUND' using errcode='P0002';
  end if;
  if not public.is_feature_enabled(v_quote.team_id,'sales_os_v3')
     or not (v_quote.owner_id=v_profile.id
       or public.can_act_for(v_quote.team_id,v_quote.owner_id)
       or public.has_permission(v_quote.team_id,'customers.supervise')) then
    raise exception 'QUOTE_FORBIDDEN' using errcode='42501';
  end if;
  if v_quote.status<>'draft' then
    raise exception 'QUOTE_NOT_DRAFT' using errcode='55000';
  end if;

  v_has_special := nullif(trim(p_special_content),'') is not null;
  update public.deal_quotes as dq
  set has_special_content=v_has_special,
      special_content=case when v_has_special then trim(p_special_content) else null end,
      updated_at=now()
  where dq.id=v_quote.id;

  insert into public.audit_logs(team_id,actor_id,action,target_type,target_id,before_data,after_data)
  values(v_quote.team_id,v_profile.id,'deal.quote_special_content_changed','deal_quote',v_quote.id,
    jsonb_build_object('has_special_content',v_quote.has_special_content),
    jsonb_build_object('has_special_content',v_has_special));

  return v_quote.id;
end$$;

create or replace function public.get_deal_quote_approval_state(p_quote_id uuid)
returns table(status text,note text,decided_at timestamptz,can_decide boolean)
language plpgsql security definer stable set search_path='' as $$
declare
  v_profile public.profiles;
  v_quote public.deal_quotes;
begin
  select pr.* into v_profile
  from public.profiles as pr
  where pr.id=auth.uid() and pr.status='active';

  select dq.* into v_quote
  from public.deal_quotes as dq
  where dq.id=p_quote_id;

  if v_profile.id is null or v_quote.id is null or v_quote.team_id<>v_profile.team_id then
    raise exception 'QUOTE_NOT_FOUND' using errcode='P0002';
  end if;
  if not public.is_feature_enabled(v_quote.team_id,'sales_os_v3')
     or not (v_quote.owner_id=v_profile.id
       or public.can_act_for(v_quote.team_id,v_quote.owner_id)
       or public.has_permission(v_quote.team_id,'customers.supervise')
       or public.has_permission(v_quote.team_id,'finance.read')
       or public.has_permission(v_quote.team_id,'finance.manage')) then
    raise exception 'QUOTE_FORBIDDEN' using errcode='42501';
  end if;

  return query
  select coalesce(a.status,'not_required'),a.note,a.decided_at,
    public.has_permission(v_quote.team_id,'customers.supervise')
  from (select 1) as seed
  left join public.deal_quote_approvals as a on a.quote_id=v_quote.id and a.team_id=v_quote.team_id;
end$$;

revoke all on function public.set_deal_quote_special_content(uuid,text),
  public.get_deal_quote_approval_state(uuid) from public,anon;
grant execute on function public.set_deal_quote_special_content(uuid,text),
  public.get_deal_quote_approval_state(uuid) to authenticated;
notify pgrst,'reload schema';
