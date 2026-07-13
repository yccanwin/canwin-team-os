-- Safe read contract for the internal procurement payment workbench.
create or replace function public.get_internal_payment_workbench()
returns table(
  order_id uuid,quote_id uuid,store_name text,order_status text,
  internal_due numeric,internal_paid numeric,internal_remaining numeric,
  fulfillment_unlocked boolean,can_manage boolean
)language sql security definer stable set search_path='' as $$
  with me as(
    select p.id,p.team_id,
      public.has_permission(p.team_id,'finance.manage')as can_manage,
      public.has_access_role(p.team_id,array['owner'])as is_owner
    from public.profiles p
    where p.id=auth.uid()and p.status='active'
      and public.is_feature_enabled(p.team_id,'sales_os_v3')
  )
  select o.id,o.quote_id,coalesce(s.name,'未命名门店'),o.status,
    o.internal_due,o.internal_paid,greatest(o.internal_due-o.internal_paid,0),
    o.fulfillment_allowed_at is not null,m.can_manage
  from me m
  join public.deal_orders o on o.team_id=m.team_id
  join public.deal_quotes q on q.id=o.quote_id and q.team_id=o.team_id
  join public.crm_opportunities op on op.id=o.opportunity_id and op.team_id=o.team_id
  left join public.crm_stores s on s.id=op.store_id and s.team_id=op.team_id
  where (m.can_manage or (not m.is_owner and(
    q.owner_id=m.id or public.can_act_for(m.team_id,q.owner_id)
      or public.has_permission(m.team_id,'customers.supervise')
  )))
  order by (o.internal_due-o.internal_paid)>0 desc,o.created_at desc
$$;
revoke all on function public.get_internal_payment_workbench()from public,anon;
grant execute on function public.get_internal_payment_workbench()to authenticated;
notify pgrst,'reload schema';
