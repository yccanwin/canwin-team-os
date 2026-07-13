-- P0 compensation for quote drafting: RPC-only writes, published catalog only,
-- qualified active opportunities, serialized draft creation and safe line reads.

drop policy if exists "sales create quote drafts"on public.deal_quotes;
drop policy if exists "sales edit own quote drafts"on public.deal_quotes;
drop policy if exists "sales create draft quote lines"on public.deal_quote_lines;
drop policy if exists "sales edit draft quote lines"on public.deal_quote_lines;
drop policy if exists "sales delete draft quote lines"on public.deal_quote_lines;
revoke insert,update,delete on public.deal_quotes,public.deal_quote_lines from authenticated;
revoke all on public.deal_quotes,public.deal_quote_lines from anon;

alter table public.deal_quote_lines
  add column if not exists draft_source_kind text check(draft_source_kind in('package','hardware','addon')),
  add column if not exists draft_source_id uuid,
  add column if not exists draft_group_id uuid,
  add column if not exists draft_input_quantity numeric check(draft_input_quantity is null or draft_input_quantity>0),
  add column if not exists draft_input_customer_price numeric check(draft_input_customer_price is null or draft_input_customer_price>=0);

create or replace function public.create_deal_quote_draft(p_opportunity_id uuid)returns uuid
language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles;v_opportunity public.crm_opportunities;v_quote public.deal_quotes;v_version integer;
begin
 select pr.* into v_profile from public.profiles as pr where pr.id=auth.uid()and pr.status='active';
 if v_profile.id is null or not public.is_feature_enabled(v_profile.team_id,'sales_os_v3')
   or not public.has_permission(v_profile.team_id,'customers.manage')then
   raise exception'QUOTE_CREATE_FORBIDDEN'using errcode='42501';
 end if;
 -- The opportunity row is the per-opportunity transaction lock. Concurrent
 -- callers serialize here and the second caller reuses the first draft.
 select opp.* into v_opportunity from public.crm_opportunities as opp where opp.id=p_opportunity_id for update;
 if v_opportunity.id is null or v_opportunity.team_id<>v_profile.team_id or not v_opportunity.qualification_valid
   or v_opportunity.qualification_superseded_at is not null or v_opportunity.stage='lost'
   or not(v_opportunity.owner_id=v_profile.id or public.can_act_for(v_profile.team_id,v_opportunity.owner_id))then
   raise exception'ACTIVE_QUALIFIED_OPPORTUNITY_REQUIRED'using errcode='23514';
 end if;
 select dq.* into v_quote from public.deal_quotes as dq
 where dq.team_id=v_opportunity.team_id and dq.opportunity_id=v_opportunity.id and dq.status='draft'
 order by dq.version_no desc limit 1;
 if v_quote.id is not null then return v_quote.id;end if;
 select coalesce(max(dq.version_no),0)+1 into v_version from public.deal_quotes as dq
 where dq.team_id=v_opportunity.team_id and dq.opportunity_id=v_opportunity.id;
 insert into public.deal_quotes as dq(team_id,opportunity_id,owner_id,version_no,created_by)
 values(v_opportunity.team_id,v_opportunity.id,v_opportunity.owner_id,v_version,v_profile.id)returning dq.* into v_quote;
 return v_quote.id;
end$$;

create or replace function public.replace_deal_quote_lines(p_quote_id uuid,p_lines jsonb)returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.profiles;q public.deal_quotes;x jsonb;i public.deal_catalog_items;
 p public.deal_packages;pi record;qty numeric;price numeric;kind text;source uuid;
 weight numeric;total_weight numeric;group_id uuid;
begin
 select pr.* into r from public.profiles as pr where pr.id=auth.uid()and pr.status='active';
 select dq.* into q from public.deal_quotes as dq where dq.id=p_quote_id for update;
 if r.id is null or q.id is null or q.team_id<>r.team_id or q.status<>'draft'
   or not public.is_feature_enabled(r.team_id,'sales_os_v3')
   or not public.has_permission(r.team_id,'customers.manage')
   or not(q.owner_id=r.id or public.can_act_for(r.team_id,q.owner_id))then
   raise exception'QUOTE_EDIT_FORBIDDEN'using errcode='42501';
 end if;
 if jsonb_typeof(p_lines)<>'array'or jsonb_array_length(p_lines)=0 then
   raise exception'QUOTE_LINES_REQUIRED'using errcode='22023';end if;
 -- Validate every requested source before replacing saved rows. Errors roll
 -- back the transaction, so the previous draft can never become an empty one.
 for x in select line.value from jsonb_array_elements(p_lines)as line(value)loop
  kind:=x->>'kind';source:=nullif(x->>'source_id','')::uuid;
  qty:=(x->>'quantity')::numeric;price:=(x->>'customer_price')::numeric;
  if source is null or qty<=0 or price<0 or kind not in('package','hardware','addon')then
    raise exception'INVALID_QUOTE_LINE'using errcode='22023';end if;
  if kind='package'then
   select pkg.*into p from public.deal_packages pkg
   join public.deal_catalog_versions cv on cv.id=pkg.catalog_version_id and cv.team_id=pkg.team_id
   where pkg.id=source and pkg.team_id=q.team_id and cv.status='published';
   if p.id is null then raise exception'PUBLISHED_PACKAGE_REQUIRED'using errcode='P0002';end if;
   if not exists(select 1 from public.deal_package_items dpi
     join public.deal_catalog_items ci on ci.id=dpi.catalog_item_id and ci.team_id=dpi.team_id
     where dpi.package_id=p.id and dpi.team_id=q.team_id
       and ci.catalog_version_id=p.catalog_version_id)then
     raise exception'PACKAGE_EMPTY'using errcode='23514';end if;
  else
   select ci.*into i from public.deal_catalog_items ci
   join public.deal_catalog_versions cv on cv.id=ci.catalog_version_id and cv.team_id=ci.team_id
   where ci.id=source and ci.team_id=q.team_id and cv.status='published'
     and(case when kind='hardware'then ci.item_type='hardware'
       else ci.item_type in('software','service')end);
   if i.id is null then raise exception'PUBLISHED_CATALOG_ITEM_REQUIRED'using errcode='P0002';end if;
  end if;
 end loop;
 delete from public.deal_quote_lines as dql where dql.quote_id=q.id and dql.team_id=q.team_id;
 for x in select line.value from jsonb_array_elements(p_lines)as line(value)loop
  kind:=x->>'kind';source:=(x->>'source_id')::uuid;
  qty:=(x->>'quantity')::numeric;price:=(x->>'customer_price')::numeric;
  group_id:=gen_random_uuid();
  if kind='package'then
   select pkg.*into p from public.deal_packages pkg
   join public.deal_catalog_versions cv on cv.id=pkg.catalog_version_id and cv.team_id=pkg.team_id
   where pkg.id=source and pkg.team_id=q.team_id and cv.status='published';
   select sum(ci.customer_list_price*dpi.quantity)into total_weight
   from public.deal_package_items dpi
   join public.deal_catalog_items ci on ci.id=dpi.catalog_item_id and ci.team_id=dpi.team_id
     and ci.catalog_version_id=p.catalog_version_id
   where dpi.package_id=p.id and dpi.team_id=q.team_id;
   if coalesce(total_weight,0)<=0 then raise exception'PACKAGE_EMPTY'using errcode='23514';end if;
   for pi in select ci.*,dpi.quantity package_qty
    from public.deal_package_items dpi
    join public.deal_catalog_items ci on ci.id=dpi.catalog_item_id and ci.team_id=dpi.team_id
      and ci.catalog_version_id=p.catalog_version_id
    where dpi.package_id=p.id and dpi.team_id=q.team_id loop
    weight:=pi.customer_list_price*pi.package_qty/total_weight;
    insert into public.deal_quote_lines(team_id,quote_id,source_item_id,item_name_snapshot,
      sku_snapshot,item_type_snapshot,quantity,customer_unit_price,internal_unit_price,points_snapshot,
      draft_source_kind,draft_source_id,draft_group_id,draft_input_quantity,draft_input_customer_price)
    values(q.team_id,q.id,pi.id,p.name||' / '||pi.name,pi.sku,pi.item_type,
      qty*pi.package_qty,round(price*weight/pi.package_qty,2),round(pi.procurement_cost*1.10,2),pi.points,
      kind,source,group_id,qty,price);
   end loop;
  else
   select ci.*into i from public.deal_catalog_items ci
   join public.deal_catalog_versions cv on cv.id=ci.catalog_version_id and cv.team_id=ci.team_id
   where ci.id=source and ci.team_id=q.team_id and cv.status='published';
   insert into public.deal_quote_lines(team_id,quote_id,source_item_id,item_name_snapshot,
     sku_snapshot,item_type_snapshot,quantity,customer_unit_price,internal_unit_price,points_snapshot,
     draft_source_kind,draft_source_id,draft_group_id,draft_input_quantity,draft_input_customer_price)
   values(q.team_id,q.id,i.id,i.name,i.sku,i.item_type,qty,price,
     round(i.procurement_cost*1.10,2),i.points,kind,source,group_id,qty,price);
  end if;
 end loop;
 update public.deal_quotes as dq set updated_at=now()where dq.id=q.id;
 return q.id;
end$$;

create or replace function public.get_deal_quote_draft_lines(p_quote_id uuid)
returns table(line_id uuid,kind text,source_id uuid,item_name text,quantity numeric,customer_price numeric)
language plpgsql security definer stable set search_path='' as $$
declare r public.profiles;q public.deal_quotes;
begin
 select pr.* into r from public.profiles as pr where pr.id=auth.uid()and pr.status='active';
 select dq.* into q from public.deal_quotes as dq where dq.id=p_quote_id;
 if r.id is null or q.id is null or q.team_id<>r.team_id or q.status<>'draft'
   or not public.is_feature_enabled(r.team_id,'sales_os_v3')
   or not public.has_permission(r.team_id,'customers.manage')
   or not(q.owner_id=r.id or public.can_act_for(r.team_id,q.owner_id))then
   raise exception'QUOTE_READ_FORBIDDEN'using errcode='42501';
 end if;
 return query
 with restored as(
   select min(ql.id::text)::uuid line_id,ql.draft_source_kind kind,ql.draft_source_id source_id,
     case when ql.draft_source_kind='package'then split_part(min(ql.item_name_snapshot),' / ',1)
       else min(ql.item_name_snapshot)end item_name,
     max(ql.draft_input_quantity)quantity,max(ql.draft_input_customer_price)customer_price,
     min(ql.created_at)sort_at
   from public.deal_quote_lines ql
   where ql.team_id=q.team_id and ql.quote_id=q.id and ql.draft_group_id is not null
   group by ql.draft_group_id,ql.draft_source_kind,ql.draft_source_id
 ),legacy as(
   select ql.id line_id,case when ql.item_type_snapshot='hardware'then'hardware'else'addon'end kind,
     ql.source_item_id source_id,ql.item_name_snapshot item_name,ql.quantity,
     ql.customer_unit_price customer_price,ql.created_at sort_at
   from public.deal_quote_lines ql
   where ql.team_id=q.team_id and ql.quote_id=q.id and ql.draft_group_id is null
 )
 select x.line_id,x.kind,x.source_id,x.item_name,x.quantity,x.customer_price
 from(select*from restored union all select*from legacy)x order by x.sort_at,x.line_id;
end$$;

revoke all on function public.create_deal_quote_draft(uuid),
 public.replace_deal_quote_lines(uuid,jsonb),public.get_deal_quote_draft_lines(uuid)from public,anon;
grant execute on function public.create_deal_quote_draft(uuid),
 public.replace_deal_quote_lines(uuid,jsonb),public.get_deal_quote_draft_lines(uuid)to authenticated;
notify pgrst,'reload schema';
